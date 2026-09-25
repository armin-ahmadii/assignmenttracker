import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Course, RecurringRule, WorkItem } from '../domain/types';

export type TableName = 'courses' | 'rules' | 'items';
export const TABLES: TableName[] = ['courses', 'rules', 'items'];

export interface TableRow {
  courses: Course;
  rules: RecurringRule;
  items: WorkItem;
}
export type AnyRow = TableRow[TableName];

/** A local change waiting to reach the server. One entry per record; the newest edit wins. */
export interface OutboxEntry {
  key: string;
  table: TableName;
  id: string;
  updatedAt: string;
}

interface Schema extends DBSchema {
  courses: { key: string; value: Course };
  rules: { key: string; value: RecurringRule };
  items: { key: string; value: WorkItem };
  outbox: { key: string; value: OutboxEntry };
  meta: { key: string; value: unknown };
}

export type Db = IDBPDatabase<Schema>;

const connections = new Map<string, Promise<Db>>();

export function openDb(name = 'due'): Promise<Db> {
  let dbPromise = connections.get(name);
  if (!dbPromise) {
    dbPromise = openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('courses', { keyPath: 'id' });
        db.createObjectStore('rules', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: 'key' });
        db.createObjectStore('meta');
      },
    });
    connections.set(name, dbPromise);
  }
  return dbPromise;
}

export function outboxKey(table: TableName, id: string): string {
  return `${table}:${id}`;
}

export async function loadAll(db: Db) {
  const tx = db.transaction(['courses', 'rules', 'items', 'outbox'], 'readonly');
  const [courses, rules, items, outbox] = await Promise.all([
    tx.objectStore('courses').getAll(),
    tx.objectStore('rules').getAll(),
    tx.objectStore('items').getAll(),
    tx.objectStore('outbox').getAll(),
  ]);
  await tx.done;
  return { courses, rules, items, outbox };
}

/** Save local edits and queue them for upload in one transaction, so a crash can't lose either half. */
export async function saveLocal(db: Db, changes: { table: TableName; row: AnyRow }[]) {
  const tx = db.transaction(['courses', 'rules', 'items', 'outbox'], 'readwrite');
  for (const { table, row } of changes) {
    void tx.objectStore(table).put(row as never);
    void tx.objectStore('outbox').put({ key: outboxKey(table, row.id), table, id: row.id, updatedAt: row.updatedAt });
  }
  await tx.done;
}

/** Store rows that came from the server; drops any outbox entry they supersede. */
export async function saveRemote(db: Db, changes: { table: TableName; row: AnyRow }[], supersededKeys: string[]) {
  const tx = db.transaction(['courses', 'rules', 'items', 'outbox'], 'readwrite');
  for (const { table, row } of changes) void tx.objectStore(table).put(row as never);
  for (const key of supersededKeys) void tx.objectStore('outbox').delete(key);
  await tx.done;
}

/** Remove outbox entries that were pushed, unless the record changed again while the push was in flight. */
export async function clearPushed(db: Db, pushed: OutboxEntry[]): Promise<OutboxEntry[]> {
  const tx = db.transaction('outbox', 'readwrite');
  const cleared: OutboxEntry[] = [];
  for (const entry of pushed) {
    const current = await tx.store.get(entry.key);
    if (current && current.updatedAt === entry.updatedAt) {
      await tx.store.delete(entry.key);
      cleared.push(entry);
    }
  }
  await tx.done;
  return cleared;
}

export async function getMeta<T>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}

export async function setMeta(db: Db, key: string, value: unknown) {
  await db.put('meta', value, key);
}

export async function wipe(db: Db) {
  const tx = db.transaction(['courses', 'rules', 'items', 'outbox', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('courses').clear(),
    tx.objectStore('rules').clear(),
    tx.objectStore('items').clear(),
    tx.objectStore('outbox').clear(),
    tx.objectStore('meta').clear(),
  ]);
  await tx.done;
}
