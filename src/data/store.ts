import { useSyncExternalStore } from 'react';
import type { Course, RecurringRule, WorkItem } from '../domain/types';
import {
  TABLES,
  clearPushed,
  loadAll,
  openDb,
  outboxKey,
  saveLocal,
  saveRemote,
  type AnyRow,
  type Db,
  type OutboxEntry,
  type TableName,
  type TableRow,
} from './db';

export interface Snapshot {
  ready: boolean;
  /** Live (not deleted) records. */
  courses: Course[];
  rules: RecurringRule[];
  items: WorkItem[];
  coursesById: Map<string, Course>;
  itemsById: Map<string, WorkItem>;
  /** Local changes not yet on the server. */
  pending: number;
}

type Change = { table: TableName; row: AnyRow };

const EMPTY: Snapshot = {
  ready: false,
  courses: [],
  rules: [],
  items: [],
  coursesById: new Map(),
  itemsById: new Map(),
  pending: 0,
};

/**
 * In-memory copy of everything, backed by IndexedDB. Reads are synchronous so
 * screens render straight from memory; every write lands locally first and is
 * queued in the outbox for the sync engine.
 */
export class Store {
  private raw: { [K in TableName]: Map<string, TableRow[K]> } = {
    courses: new Map(),
    rules: new Map(),
    items: new Map(),
  };
  private outbox = new Map<string, OutboxEntry>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = EMPTY;
  private db: Db | null = null;
  private dbName: string;
  private saving: Promise<unknown> = Promise.resolve();
  /** Called after every local write; the sync engine hooks in here. */
  onLocalChange: (() => void) | null = null;

  constructor(dbName = 'due') {
    this.dbName = dbName;
  }

  async init() {
    this.db = await openDb(this.dbName);
    const data = await loadAll(this.db);
    for (const table of TABLES) {
      this.raw[table].clear();
      for (const row of data[table]) (this.raw[table] as Map<string, AnyRow>).set(row.id, row);
    }
    this.outbox = new Map(data.outbox.map((e) => [e.key, e]));
    this.emit(true);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  get database(): Db | null {
    return this.db;
  }

  /** Includes tombstones. */
  getRaw<T extends TableName>(table: T, id: string): TableRow[T] | undefined {
    return this.raw[table].get(id);
  }

  /** Write records locally (stamping updatedAt) and queue them for sync. */
  write(changes: Change[]) {
    if (!changes.length) return;
    const stamped: Change[] = changes.map(({ table, row }) => {
      const prev = this.raw[table].get(row.id);
      const time = Math.max(Date.now(), prev ? Date.parse(prev.updatedAt) + 1 : 0);
      const next = { ...row, updatedAt: new Date(time).toISOString() } as AnyRow;
      (this.raw[table] as Map<string, AnyRow>).set(row.id, next);
      const key = outboxKey(table, row.id);
      this.outbox.set(key, { key, table, id: row.id, updatedAt: next.updatedAt });
      return { table, row: next };
    });
    this.emit();
    void this.persist((db) => saveLocal(db, stamped));
    this.onLocalChange?.();
  }

  /** IndexedDB writes run one after another, in the order the changes happened. */
  private persist<T>(task: (db: Db) => Promise<T>): Promise<T | undefined> {
    const db = this.db;
    if (!db) return Promise.resolve(undefined);
    const run = this.saving.then(() => task(db));
    this.saving = run.catch((err) => console.error('Saving locally failed', err));
    return run;
  }

  /** Resolves once every local write so far is on disk. */
  whenSaved(): Promise<void> {
    return this.saving.then(() => undefined);
  }

  /**
   * Merge rows pulled from the server. Last write wins by updatedAt; a newer
   * remote edit also cancels the now-stale local change waiting in the outbox.
   */
  async mergeRemote(table: TableName, rows: AnyRow[]): Promise<number> {
    const applied: Change[] = [];
    const superseded: string[] = [];
    for (const row of rows) {
      const local = this.raw[table].get(row.id);
      const key = outboxKey(table, row.id);
      // Equal timestamps mean it's our own write echoing back.
      if (local && row.updatedAt <= local.updatedAt) continue;
      (this.raw[table] as Map<string, AnyRow>).set(row.id, row);
      applied.push({ table, row });
      if (this.outbox.delete(key)) superseded.push(key);
    }
    if (applied.length) {
      this.emit();
      await this.persist((db) => saveRemote(db, applied, superseded));
    }
    return applied.length;
  }

  pendingEntries(): OutboxEntry[] {
    return [...this.outbox.values()];
  }

  async markPushed(entries: OutboxEntry[]) {
    const cleared = (await this.persist((db) => clearPushed(db, entries))) ?? [];
    for (const entry of cleared) {
      if (this.outbox.get(entry.key)?.updatedAt === entry.updatedAt) this.outbox.delete(entry.key);
    }
    this.emit();
  }

  private emit(markReady = false) {
    const live = <T extends { deletedAt: string | null }>(map: Map<string, T>) =>
      [...map.values()].filter((r) => !r.deletedAt);
    const courses = live(this.raw.courses);
    const items = live(this.raw.items);
    this.snapshot = {
      ready: markReady || this.snapshot.ready,
      courses,
      rules: live(this.raw.rules),
      items,
      coursesById: new Map(courses.map((c) => [c.id, c])),
      itemsById: new Map(items.map((i) => [i.id, i])),
      pending: this.outbox.size,
    };
    for (const listener of this.listeners) listener();
  }
}

export const store = new Store();

export function useStore(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
