import { useSyncExternalStore } from 'react';
import { TABLES, getMeta, setMeta, type AnyRow, type TableName } from './db';
import { store } from './store';
import { getClient } from './supabase';

export const REMOTE_TABLE: Record<TableName, string> = {
  courses: 'courses',
  rules: 'recurring_rules',
  items: 'work_items',
};

const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt', 'due', 'submittedAt']);
const PAGE = 1000;
/** Re-read a few seconds behind the cursor in case transactions committed out of order. */
const CURSOR_OVERLAP_MS = 5000;

const toSnake = (key: string) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function toRemoteRow(row: AnyRow, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: userId };
  for (const [key, value] of Object.entries(row)) out[toSnake(key)] = value;
  return out;
}

export function fromRemoteRow(row: Record<string, unknown>): AnyRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'user_id' || key === 'server_updated_at') continue;
    const name = toCamel(key);
    // Postgres returns "+00:00" offsets and microseconds; keep one canonical ISO form so comparisons work.
    out[name] = TIMESTAMP_FIELDS.has(name) && typeof value === 'string' ? new Date(value).toISOString() : value;
  }
  return out as unknown as AnyRow;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
}

class SyncEngine {
  private state: SyncState = { status: 'off', lastSyncedAt: null, error: null };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  /** Runs after each successful pull (recurring labs are generated here). */
  afterPull: (() => void) | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  start(userId: string) {
    if (this.userId === userId) return;
    this.userId = userId;
    store.onLocalChange = () => this.schedule(1500);
    window.addEventListener('online', this.onWake);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onWake);
    this.interval = setInterval(() => document.visibilityState === 'visible' && this.run(), 60_000);
    this.set({ status: navigator.onLine ? 'idle' : 'offline' });
    void this.run();
  }

  stop() {
    this.userId = null;
    store.onLocalChange = null;
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onWake);
    clearInterval(this.interval);
    clearTimeout(this.timer);
    this.set({ status: 'off', lastSyncedAt: null, error: null });
  }

  schedule(delay = 0) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  async run(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    if (!navigator.onLine) {
      this.set({ status: 'offline' });
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.set({ status: 'syncing', error: null });
    try {
      const client = await getClient();
      await this.push(client, userId);
      await this.pull(client);
      this.set({ status: 'idle', lastSyncedAt: new Date().toISOString() });
      this.afterPull?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
      this.set({ status: navigator.onLine ? 'error' : 'offline', error: message });
    } finally {
      this.running = false;
      if (this.again && this.userId) {
        this.again = false;
        this.schedule(0);
      }
    }
  }

  private async push(client: Awaited<ReturnType<typeof getClient>>, userId: string) {
    const entries = store.pendingEntries();
    for (const table of TABLES) {
      const forTable = entries.filter((e) => e.table === table);
      for (let i = 0; i < forTable.length; i += 200) {
        const chunk = forTable.slice(i, i + 200);
        const rows = chunk
          .map((e) => store.getRaw(table, e.id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .map((r) => toRemoteRow(r, userId));
        if (rows.length) {
          const { error } = await client.from(REMOTE_TABLE[table]).upsert(rows, { onConflict: 'id' });
          if (error) throw error;
        }
        await store.markPushed(chunk);
      }
    }
  }

  private async pull(client: Awaited<ReturnType<typeof getClient>>) {
    const db = store.database;
    if (!db) return;
    for (const table of TABLES) {
      const cursorKey = `cursor:${table}`;
      let cursor = (await getMeta<string>(db, cursorKey)) ?? null;
      let since = cursor ? new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
      for (;;) {
        let query = client.from(REMOTE_TABLE[table]).select('*').order('server_updated_at').limit(PAGE);
        if (since) query = query.gt('server_updated_at', since);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;
        await store.mergeRemote(table, data.map(fromRemoteRow));
        cursor = data[data.length - 1].server_updated_at as string;
        await setMeta(db, cursorKey, cursor);
        if (data.length < PAGE) break;
        since = cursor;
      }
    }
  }

  private onWake = () => {
    if (document.visibilityState === 'visible') this.schedule(0);
  };

  private onOffline = () => this.set({ status: 'offline' });

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const sync = new SyncEngine();

export function useSyncState(): SyncState {
  return useSyncExternalStore(sync.subscribe, sync.getState);
}
