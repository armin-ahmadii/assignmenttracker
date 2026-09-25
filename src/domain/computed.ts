import type { Course, DueIn, Status, WorkItem } from './types';
import { calendarDaysBetween, dayKey, dayNumber, formatTime } from './time';

const HOUR_MS = 3_600_000;

// Everything here is pure: `now` and the display zone are always passed in,
// so the rules can be tested without touching the clock.

/** Do date if one is set, otherwise the Due day (`YYYY-MM-DD`). */
export function focusDate(item: Pick<WorkItem, 'doDate' | 'due'>, tz: string): string {
  return item.doDate ?? dayKey(item.due, tz);
}

/** The "Due in" label, or null when the item is submitted. */
export function dueIn(item: Pick<WorkItem, 'due' | 'status'>, now: Date, tz: string): DueIn | null {
  if (item.status === 'Submitted') return null;

  const due = new Date(item.due);
  const diffMs = due.getTime() - now.getTime();

  if (diffMs < 0) {
    const hoursLate = -diffMs / HOUR_MS;
    if (hoursLate < 24) return { label: `Overdue ${Math.ceil(hoursLate)}h`, tone: 'red' };
    return { label: `Overdue ${Math.floor(hoursLate / 24)}d`, tone: 'red' };
  }

  const days = calendarDaysBetween(now, due, tz);
  if (days === 0) return { label: `Today ${formatTime(due, tz)}`, tone: 'red' };
  if (days === 1) return { label: `Tomorrow ${formatTime(due, tz)}`, tone: 'orange' };
  if (days <= 3) return { label: `In ${days}d`, tone: 'orange' };
  return { label: `In ${days}d`, tone: 'neutral' };
}

/** Sort key, never shown. Higher means more urgent. */
export function urgency(item: Pick<WorkItem, 'due' | 'weight'>, now: Date): number {
  const hours = (Date.parse(item.due) - now.getTime()) / HOUR_MS;
  if (hours < 24) return 1000 - hours;
  const w = item.weight ?? 5;
  return w / Math.max(hours / 24, 0.5);
}

/** Most urgent first; ties go to the earlier Due. */
export function compareUrgency(
  a: Pick<WorkItem, 'due' | 'weight'>,
  b: Pick<WorkItem, 'due' | 'weight'>,
  now: Date,
): number {
  const diff = urgency(b, now) - urgency(a, now);
  if (diff !== 0) return diff;
  return Date.parse(a.due) - Date.parse(b.due);
}

export function sortByUrgency<T extends Pick<WorkItem, 'due' | 'weight'>>(items: T[], now: Date): T[] {
  return [...items].sort((a, b) => compareUrgency(a, b, now));
}

export function sortByDue<T extends Pick<WorkItem, 'due'>>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
}

export function isOpen(item: Pick<WorkItem, 'status'>): boolean {
  return item.status !== 'Submitted';
}

export function isOverdue(item: Pick<WorkItem, 'status' | 'due'>, now: Date): boolean {
  return isOpen(item) && Date.parse(item.due) < now.getTime();
}

/** Belongs on the Now list: not submitted, and overdue or focused within the next 7 days. */
export function isInNow(item: Pick<WorkItem, 'status' | 'due' | 'doDate'>, now: Date, tz: string): boolean {
  if (!isOpen(item)) return false;
  if (isOverdue(item, now)) return true;
  return dayNumber(focusDate(item, tz)) <= dayNumber(dayKey(now, tz)) + 7;
}

export function nextStatus(status: Status): Status | null {
  if (status === 'Not started') return 'In progress';
  if (status === 'In progress') return 'Submitted';
  return null;
}

export interface CourseStats {
  open: number;
  nextDue: WorkItem | null;
  /** Σ(weight × grade) ÷ Σ(weight), or null when nothing is graded. */
  gradeSoFar: number | null;
}

export function courseStats(course: Pick<Course, 'id'>, items: WorkItem[]): CourseStats {
  let open = 0;
  let nextDue: WorkItem | null = null;
  let weighted = 0;
  let weights = 0;
  for (const item of items) {
    if (item.courseId !== course.id) continue;
    if (isOpen(item)) {
      open += 1;
      if (!nextDue || Date.parse(item.due) < Date.parse(nextDue.due)) nextDue = item;
    }
    if (item.weight != null && item.grade != null) {
      weighted += item.weight * item.grade;
      weights += item.weight;
    }
  }
  return { open, nextDue, gradeSoFar: weights > 0 ? weighted / weights : null };
}

export function formatGrade(grade: number | null): string {
  return grade == null ? '' : `${grade.toFixed(1)}%`;
}

export function checklistProgress(item: Pick<WorkItem, 'checklist'>): { done: number; total: number } {
  return { done: item.checklist.filter((c) => c.done).length, total: item.checklist.length };
}
