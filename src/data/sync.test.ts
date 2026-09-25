import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createCourse, createItem } from '../domain/factory';
import { zonedToUtc } from '../domain/time';
import type { WorkItem } from '../domain/types';
import { Store } from './store';
import { fromRemoteRow, toRemoteRow } from './sync';

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
    const row = toRemoteRow(item, 'user-1');
    expect(row).toMatchObject({ user_id: 'user-1', course_id: 'c1', due_tz: TZ, submitted_at: null, parent_id: null });
    expect(fromRemoteRow({ ...row, server_updated_at: '2026-09-25T22:00:00.123456+00:00' })).toEqual(item);

    const course = createCourse({ code: 'CMPT 276', term: 'Fall 2026' }, NOW);
    expect(fromRemoteRow(toRemoteRow(course, 'user-1'))).toEqual(course);
  });

  it('normalises Postgres timestamps so comparisons are exact', () => {
    const back = fromRemoteRow({ id: 'x', updated_at: '2026-09-25T22:00:00.5+00:00', due: '2026-09-29T06:59:00+00:00' }) as WorkItem;
    expect(back.updatedAt).toBe('2026-09-25T22:00:00.500Z');
    expect(back.due).toBe('2026-09-29T06:59:00.000Z');
  });
});
