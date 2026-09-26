import { useSyncExternalStore } from 'react';
import { TABLES, clearMeta, getMeta, setMeta, type AnyRow, type TableName } from './db';
import { store as defaultStore, type Store } from './store';
import { isKeyRejected, rpc } from './remote';

export const REMOTE_TABLE: Record<TableName, string> = {
  courses: 'courses',
  rules: 'recurring_rules',
  items: 'work_items',
};

const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt', 'due', 'submittedAt']);
const PAGE = 1000;
const PUSH_BATCH = 200;
/** Re-read a few seconds behind the cursor in case transactions committed out of order. */
const CURSOR_OVERLAP_MS = 5000;

const toSnake = (key: string) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function toRemoteRow(row: AnyRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[toSnake(key)] = value;
  return out;
}

export function fromRemoteRow(row: Record<string, unknown>): AnyRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'server_updated_at') continue;
    const name = toCamel(key);
    // Postgres returns "+00:00" offsets and microseconds; keep one canonical ISO form so comparisons work.
    out[name] = TIMESTAMP_FIELDS.has(name) && typeof value === 'string' ? new Date(value).toISOString() : value;
  }
  return out as unknown as AnyRow;
}

/** `rejected`: the server doesn't recognise this device's sync key. */
export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'rejected';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
}

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Pushes the outbox, then pulls rows changed since the last pull. Runs 1.5 s
 * after a local change, when the app comes back to the foreground or online,
 * and every minute while it's open.
 */
export class SyncEngine {
  private state: SyncState = { status: 'off', lastSyncedAt: null, error: null };
  private listeners = new Set<() => void>();
  private key: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  /** Runs after each successful pull (recurring labs are generated here). */
  afterPull: (() => void) | null = null;

  constructor(private readonly store: Store) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  start(key: string, { runNow = true } = {}) {
    if (this.key === key) return;
    this.stop();
    this.key = key;
    this.store.onLocalChange = () => this.schedule(1500);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onWake);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onWake);
      this.interval = setInterval(() => visible() && void this.run(), 60_000);
    }
    this.set({ status: online() ? 'idle' : 'offline', error: null });
    if (runNow) void this.run();
  }

  stop() {
    this.key = null;
    this.store.onLocalChange = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onWake);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onWake);
    }
    clearInterval(this.interval);
    clearTimeout(this.timer);
    this.set({ status: 'off', lastSyncedAt: null, error: null });
  }

  schedule(delay = 0) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  /** One full push + pull. Concurrent calls collapse into one follow-up run. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runOnce().finally(() => {
      this.running = null;
      if (this.again && this.key) {
        this.again = false;
        this.schedule(0);
      }
    });
    return this.running;
  }

  private async runOnce() {
    const key = this.key;
    if (!key) return;
    if (!online()) {
      this.set({ status: 'offline' });
      return;
    }
    this.set({ status: 'syncing', error: null });
    try {
      await this.push(key);
      await this.pull(key);
      this.set({ status: 'idle', lastSyncedAt: new Date().toISOString() });
      this.afterPull?.();
    } catch (err) {
      if (isKeyRejected(err)) {
        this.set({ status: 'rejected', error: null });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.set({ status: online() ? 'error' : 'offline', error: message });
    }
  }

  private async push(key: string) {
    const { store } = this;
    const entries = store.pendingEntries();
    for (const table of TABLES) {
      const forTable = entries.filter((e) => e.table === table);
      for (let i = 0; i < forTable.length; i += PUSH_BATCH) {
        const chunk = forTable.slice(i, i + PUSH_BATCH);
        const rows = chunk
          .map((e) => store.getRaw(table, e.id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .map(toRemoteRow);
        if (rows.length) await rpc<number>('due_push', { key, tbl: REMOTE_TABLE[table], rows });
        await store.markPushed(chunk);
      }
    }
  }

  private async pull(key: string) {
    const { store } = this;
    const db = store.database;
    if (!db) return;
    for (const table of TABLES) {
      const cursorKey = `cursor:${table}`;
      let cursor = (await getMeta<string>(db, cursorKey)) ?? null;
      let since = cursor ? new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
      for (;;) {
        const rows = await rpc<Record<string, unknown>[]>('due_pull', {
          key,
          tbl: REMOTE_TABLE[table],
          since,
          max_rows: PAGE,
        });
        if (!rows?.length) break;
        await store.mergeRemote(table, rows.map(fromRemoteRow));
        cursor = rows[rows.length - 1].server_updated_at as string;
        await setMeta(db, cursorKey, cursor);
        if (rows.length < PAGE) break;
        since = cursor;
      }
    }
  }

  /** Forget pull positions so the next sync reads everything (used when connecting a device). */
  async resetCursors() {
    const db = this.store.database;
    if (db) await clearMeta(db, TABLES.map((t) => `cursor:${t}`));
  }

  private onWake = () => {
    if (visible()) this.schedule(0);
  };

  private onOffline = () => this.set({ status: 'offline' });

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const sync = new SyncEngine(defaultStore);

export function useSyncState(): SyncState {
  return useSyncExternalStore(sync.subscribe, sync.getState);
}
