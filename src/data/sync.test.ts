import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCourse, createItem } from '../domain/factory';
import { zonedToUtc } from '../domain/time';
import type { WorkItem } from '../domain/types';
import { setRemoteConfig } from './remote';
import { Store } from './store';
import { SyncEngine, fromRemoteRow, toRemoteRow } from './sync';
import { generateSyncKey, normalizeSyncKey } from './syncKey';

const TZ = 'America/Vancouver';
const NOW = zonedToUtc('2026-09-25', '15:00', TZ);
let dbCount = 0;

async function freshStore() {
  const name = `test-${dbCount++}`;
  const store = new Store(name);
  await store.init();
  return { store, name };
}

function sampleItem(): WorkItem {
  return createItem({ name: 'Lab 4', courseId: 'c1', dueDate: '2026-09-28', tz: TZ }, NOW);
}

describe('Local-first store', () => {
  it('saves locally and queues the change for sync', async () => {
    const { store, name } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: item }]);
    expect(store.getSnapshot().items.map((i) => i.name)).toEqual(['Lab 4']);
    expect(store.getSnapshot().pending).toBe(1);

    await store.whenSaved();
    const reopened = new Store(name);
    await reopened.init();
    expect(reopened.getSnapshot().items.map((i) => i.name)).toEqual(['Lab 4']);
    expect(reopened.getSnapshot().pending).toBe(1);
  });

  it('keeps one outbox entry per record however many times it changes offline', async () => {
    const { store } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: item }]);
    store.write([{ table: 'items', row: { ...item, status: 'In progress' } }]);
    store.write([{ table: 'items', row: { ...item, status: 'Submitted' } }]);
    expect(store.getSnapshot().pending).toBe(1);
    expect(store.getSnapshot().items[0].status).toBe('Submitted');
  });

  it('stamps every write with a strictly increasing updatedAt', async () => {
    const { store } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: item }]);
    const first = store.getRaw('items', item.id)!.updatedAt;
    store.write([{ table: 'items', row: { ...item, name: 'Lab 4b' } }]);
    expect(store.getRaw('items', item.id)!.updatedAt > first).toBe(true);
  });

  it('deletes are tombstones, hidden from screens but kept for sync', async () => {
    const { store } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: item }]);
    store.write([{ table: 'items', row: { ...item, deletedAt: NOW.toISOString() } }]);
    expect(store.getSnapshot().items).toEqual([]);
    expect(store.getRaw('items', item.id)?.deletedAt).toBeTruthy();
    expect(store.getSnapshot().pending).toBe(1);
  });
});

describe('Merging pulled changes (last write wins)', () => {
  it('applies a newer remote edit and drops the stale local one', async () => {
    const { store } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: item }]);
    const local = store.getRaw('items', item.id)!;
    const remote = { ...local, name: 'Edited on laptop', updatedAt: new Date(Date.parse(local.updatedAt) + 60_000).toISOString() };
    expect(await store.mergeRemote('items', [remote])).toBe(1);
    expect(store.getSnapshot().items[0].name).toBe('Edited on laptop');
    expect(store.getSnapshot().pending).toBe(0);
  });

  it('keeps a newer local edit over an older remote one', async () => {
    const { store } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: { ...item, name: 'Newer local' } }]);
    const remote = { ...item, name: 'Older remote', updatedAt: '2020-01-01T00:00:00.000Z' };
    expect(await store.mergeRemote('items', [remote])).toBe(0);
    expect(store.getSnapshot().items[0].name).toBe('Newer local');
    expect(store.getSnapshot().pending).toBe(1);
  });

  it('ignores its own write echoing back', async () => {
    const { store } = await freshStore();
    store.write([{ table: 'items', row: sampleItem() }]);
    const local = store.getSnapshot().items[0];
    await store.markPushed(store.pendingEntries());
    expect(await store.mergeRemote('items', [{ ...local }])).toBe(0);
  });

  it('only clears pushed entries that did not change during the push', async () => {
    const { store } = await freshStore();
    const item = sampleItem();
    store.write([{ table: 'items', row: item }]);
    const inFlight = store.pendingEntries();
    store.write([{ table: 'items', row: { ...item, status: 'In progress' } }]);
    await store.markPushed(inFlight);
    expect(store.getSnapshot().pending).toBe(1);
    await store.markPushed(store.pendingEntries());
    expect(store.getSnapshot().pending).toBe(0);
  });
});

describe('Row mapping', () => {
  it('round-trips records through the snake_case columns', () => {
    const item = sampleItem();
    const row = toRemoteRow(item);
    expect(row).toMatchObject({ course_id: 'c1', due_tz: TZ, submitted_at: null, parent_id: null });
    expect(fromRemoteRow({ ...row, server_updated_at: '2026-09-25T22:00:00.123456+00:00' })).toEqual(item);

    const course = createCourse({ code: 'CMPT 276', term: 'Fall 2026' }, NOW);
    expect(fromRemoteRow(toRemoteRow(course))).toEqual(course);
  });

  it('normalises Postgres timestamps so comparisons are exact', () => {
    const back = fromRemoteRow({ id: 'x', updated_at: '2026-09-25T22:00:00.5+00:00', due: '2026-09-29T06:59:00+00:00' }) as WorkItem;
    expect(back.updatedAt).toBe('2026-09-25T22:00:00.500Z');
    expect(back.due).toBe('2026-09-29T06:59:00.000Z');
  });
});

describe('Sync key', () => {
  it('is 25 characters in groups of five, from an unambiguous alphabet', () => {
    const key = generateSyncKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    expect(generateSyncKey()).not.toBe(key);
  });

  it('accepts sloppy typing or a whole connect link', () => {
    const key = '7K2QX-M4TD0-19ABC-DEFGH-JKMNP';
    expect(normalizeSyncKey('7k2qx m4tdo 19abc defgh jkmnp')).toBe(key);
    expect(normalizeSyncKey('7K2QXM4TD0I9ABCDEFGHJKMNP')).toBe(key);
    expect(normalizeSyncKey(`https://due.example/#connect=${key}`)).toBe(key);
    expect(normalizeSyncKey('too short')).toBeNull();
  });
});

/**
 * Stands in for the Postgres functions in supabase/migrations: one key,
 * last-write-wins upserts, and pulls ordered by a server-side change clock.
 */
class FakeDatabase {
  key: string | null = null;
  tables: Record<string, Map<string, Record<string, unknown>>> = {
    courses: new Map(),
    work_items: new Map(),
    recurring_rules: new Map(),
  };
  private tick = 0;
  requests: string[] = [];

  handle(fn: string, args: Record<string, unknown>): unknown {
    this.requests.push(fn);
    const authorised = args.key === this.key && this.key != null;
    switch (fn) {
      case 'due_claim':
        if (this.key) return false;
        this.key = args.key as string;
        return true;
      case 'due_check':
        return authorised;
      case 'due_push': {
        if (!authorised) throw Object.assign(new Error('invalid sync key'), { code: '28000' });
        const table = this.tables[args.tbl as string];
        let n = 0;
        for (const row of args.rows as Record<string, unknown>[]) {
          const existing = table.get(row.id as string);
          if (existing && (row.updated_at as string) < (existing.updated_at as string)) continue;
          table.set(row.id as string, { ...row, server_updated_at: new Date(Date.UTC(2026, 8, 25, 0, 0, ++this.tick)).toISOString() });
          n += 1;
        }
        return n;
      }
      case 'due_pull': {
        if (!authorised) throw Object.assign(new Error('invalid sync key'), { code: '28000' });
        const since = args.since as string | null;
        return [...this.tables[args.tbl as string].values()]
          .filter((r) => !since || (r.server_updated_at as string) > since)
          .sort((a, b) => (a.server_updated_at as string).localeCompare(b.server_updated_at as string))
          .slice(0, args.max_rows as number);
      }
    }
    throw new Error(`unknown function ${fn}`);
  }

  install() {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const fn = String(url).split('/rest/v1/rpc/')[1];
      expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
      try {
        const result = this.handle(fn, JSON.parse(String(init.body)));
        return new Response(JSON.stringify(result), { status: 200 });
      } catch (err) {
        const { message, code } = err as Error & { code?: string };
        return new Response(JSON.stringify({ message, code }), { status: 403 });
      }
    }) as typeof fetch;
  }
}

describe('Syncing two devices through the database', () => {
  const realFetch = globalThis.fetch;
  let db: FakeDatabase;
  let engines: SyncEngine[] = [];
  const KEY = '7K2QX-M4TD0-19ABC-DEFGH-JKMNP';

  beforeEach(() => {
    db = new FakeDatabase();
    db.key = KEY;
    db.install();
    setRemoteConfig({ url: 'https://project.supabase.test', apiKey: 'sb_publishable_test' });
  });

  afterEach(() => {
    for (const engine of engines) engine.stop();
    engines = [];
    globalThis.fetch = realFetch;
    setRemoteConfig(null);
  });

  async function device(key = KEY) {
    const { store } = await freshStore();
    const engine = new SyncEngine(store);
    engine.start(key, { runNow: false });
    engines.push(engine);
    return { store, engine };
  }

  it('work added on one device shows up on the other', async () => {
    const laptop = await device();
    const phone = await device();
    const course = createCourse({ code: 'CMPT 225', term: 'Fall 2026' }, NOW);
    const item = createItem({ name: 'Lab 4', courseId: course.id, dueDate: '2026-09-28', tz: TZ, type: 'Lab' }, NOW);
    laptop.store.write([
      { table: 'courses', row: course },
      { table: 'items', row: item },
    ]);

    await laptop.engine.run();
    expect(laptop.store.getSnapshot().pending).toBe(0);
    expect(laptop.engine.getState().status).toBe('idle');

    await phone.engine.run();
    expect(phone.store.getSnapshot().courses.map((c) => c.code)).toEqual(['CMPT 225']);
    expect(phone.store.getSnapshot().items[0]).toMatchObject({ name: 'Lab 4', type: 'Lab', status: 'Not started' });
    expect(phone.store.getSnapshot().items[0].checklist.map((c) => c.text)).toEqual(['Pre-lab', 'In lab', 'Write-up']);
  });

  it('status changes and deletes flow both ways, and the newest edit wins', async () => {
    const laptop = await device();
    const phone = await device();
    const item = sampleItem();
    laptop.store.write([{ table: 'items', row: item }]);
    await laptop.engine.run();
    await phone.engine.run();

    // Both edit while out of touch; the phone's edit is later.
    laptop.store.write([{ table: 'items', row: { ...laptop.store.getRaw('items', item.id)!, status: 'In progress' } }]);
    await new Promise((r) => setTimeout(r, 5));
    phone.store.write([{ table: 'items', row: { ...phone.store.getRaw('items', item.id)!, status: 'Submitted' } }]);
    await phone.engine.run();
    await laptop.engine.run();
    await phone.engine.run();
    expect(laptop.store.getSnapshot().items[0].status).toBe('Submitted');
    expect(phone.store.getSnapshot().items[0].status).toBe('Submitted');

    // A delete on the phone removes it from the laptop too.
    phone.store.write([{ table: 'items', row: { ...phone.store.getRaw('items', item.id)!, deletedAt: new Date().toISOString() } }]);
    await phone.engine.run();
    await laptop.engine.run();
    expect(laptop.store.getSnapshot().items).toEqual([]);
  });

  it('a wrong key is reported and nothing local is lost', async () => {
    const stranger = await device('WRONG-WRONG-WRONG-WRONG-WRONG');
    stranger.store.write([{ table: 'items', row: sampleItem() }]);
    await stranger.engine.run();
    expect(stranger.engine.getState().status).toBe('rejected');
    expect(stranger.store.getSnapshot().pending).toBe(1);
    expect(db.tables.work_items.size).toBe(0);
  });

  it('a network failure leaves changes queued for the next try', async () => {
    const laptop = await device();
    laptop.store.write([{ table: 'items', row: sampleItem() }]);
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await laptop.engine.run();
    expect(laptop.engine.getState().status).toBe('error');
    expect(laptop.store.getSnapshot().pending).toBe(1);

    db.install();
    await laptop.engine.run();
    expect(laptop.engine.getState().status).toBe('idle');
    expect(laptop.store.getSnapshot().pending).toBe(0);
    expect(db.tables.work_items.size).toBe(1);
  });
});
