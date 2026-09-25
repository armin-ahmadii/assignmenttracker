import type { Course, RecurringRule, Status, WorkItem } from '../domain/types';
import { canBeParent, createCourse, createItem, createRule, type NewItemInput } from '../domain/factory';
import { firstUpcomingN, pendingOccurrences } from '../domain/recurring';
import type { RolloverPlan } from '../domain/rollover';
import { store } from './store';

const LAST_COURSE_KEY = 'due:lastCourse';

export function lastCourseId(): string | null {
  try {
    return localStorage.getItem(LAST_COURSE_KEY);
  } catch {
    return null;
  }
}

function rememberCourse(id: string) {
  try {
    localStorage.setItem(LAST_COURSE_KEY, id);
  } catch {
    // Private mode: the default just falls back to the first course.
  }
}

export function addItem(input: Omit<NewItemInput, 'id' | 'ruleId'>): WorkItem {
  if (input.parentId) {
    const parent = store.getRaw('items', input.parentId);
    if (!parent || !canBeParent(parent)) throw new Error('Only projects can have milestones.');
  }
  const item = createItem(input, new Date());
  store.write([{ table: 'items', row: item }]);
  if (!input.parentId) rememberCourse(item.courseId);
  return item;
}

export function updateItem(id: string, patch: Partial<WorkItem>) {
  const item = store.getRaw('items', id);
  if (!item) return;
  const next: WorkItem = { ...item, ...patch };
  // Milestones follow their project's course.
  const changes = [{ table: 'items' as const, row: next }];
  if (patch.courseId && patch.courseId !== item.courseId) {
    for (const child of store.getSnapshot().items) {
      if (child.parentId === id) changes.push({ table: 'items', row: { ...child, courseId: patch.courseId } });
    }
  }
  store.write(changes);
}

/** Returns the fields needed to undo the change. */
export function setStatus(id: string, status: Status): Pick<WorkItem, 'status' | 'submittedAt'> | null {
  const item = store.getRaw('items', id);
  if (!item || item.status === status) return null;
  const previous = { status: item.status, submittedAt: item.submittedAt };
  updateItem(id, {
    status,
    submittedAt: status === 'Submitted' ? new Date().toISOString() : null,
  });
  return previous;
}

/** Deletes the item and, for a project, its milestones. */
export function deleteItem(id: string) {
  const now = new Date().toISOString();
  const doomed = store.getSnapshot().items.filter((i) => i.id === id || i.parentId === id);
  store.write(doomed.map((row) => ({ table: 'items' as const, row: { ...row, deletedAt: now } })));
}

export function addCourse(input: { code: string; term: string; site?: string | null }): Course {
  const course = createCourse(input, new Date());
  store.write([{ table: 'courses', row: course }]);
  return course;
}

export function updateCourse(id: string, patch: Partial<Course>) {
  const course = store.getRaw('courses', id);
  if (!course) return;
  const changes: { table: 'courses' | 'rules'; row: Course | RecurringRule }[] = [
    { table: 'courses', row: { ...course, ...patch } },
  ];
  // Turning a course back on shouldn't back-fill every lab it missed while off.
  if (patch.active && !course.active) {
    const now = new Date();
    for (const rule of store.getSnapshot().rules) {
      if (rule.courseId !== id) continue;
      const nextN = Math.max(rule.nextN, firstUpcomingN(rule, now));
      if (nextN !== rule.nextN) changes.push({ table: 'rules', row: { ...rule, nextN } });
    }
  }
  store.write(changes);
}

/** Only courses with no work attached can be deleted; otherwise they're turned off. */
export function deleteCourse(id: string) {
  const course = store.getRaw('courses', id);
  if (!course) return;
  const snapshot = store.getSnapshot();
  if (snapshot.items.some((i) => i.courseId === id)) throw new Error('Course still has work items.');
  const now = new Date().toISOString();
  store.write([
    { table: 'courses', row: { ...course, deletedAt: now } },
    ...snapshot.rules
      .filter((r) => r.courseId === id)
      .map((r) => ({ table: 'rules' as const, row: { ...r, deletedAt: now } })),
  ]);
}

export function addRule(input: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'nextN'>) {
  const now = new Date();
  const rule = createRule({ ...input, nextN: firstUpcomingN(input, now) }, now);
  store.write([{ table: 'rules', row: rule }]);
  runRecurring(now);
  return rule;
}

export function deleteRule(id: string) {
  const rule = store.getRaw('rules', id);
  if (rule) store.write([{ table: 'rules', row: { ...rule, deletedAt: new Date().toISOString() } }]);
}

/** Create any recurring occurrences that have come within 7 days of being due. */
export function runRecurring(now = new Date()) {
  const snapshot = store.getSnapshot();
  const changes: { table: 'items' | 'rules'; row: WorkItem | RecurringRule }[] = [];
  for (const rule of snapshot.rules) {
    const { items, nextN } = pendingOccurrences(rule, snapshot.coursesById.get(rule.courseId), now);
    if (nextN === rule.nextN) continue;
    for (const item of items) {
      // Another device may already have made (or deleted) this occurrence.
      if (!store.getRaw('items', item.id)) changes.push({ table: 'items', row: item });
    }
    changes.push({ table: 'rules', row: { ...rule, nextN } });
  }
  store.write(changes);
}

export function startTerm(plan: RolloverPlan, turnOff: Set<string>) {
  const changes: { table: 'courses'; row: Course }[] = [
    ...plan.create.map((row) => ({ table: 'courses' as const, row })),
    ...plan.reactivate.map((c) => ({ table: 'courses' as const, row: { ...c, active: true } })),
    ...plan.previous
      .filter((c) => turnOff.has(c.id))
      .map((c) => ({ table: 'courses' as const, row: { ...c, active: false } })),
  ];
  store.write(changes);
  const first = plan.create[0] ?? plan.reactivate[0];
  if (first) rememberCourse(first.id);
}
