import type { Course, RecurringRule, WorkItem } from './types';
import { createItem } from './factory';
import { addDaysToKey, dayKey, weekdayOfKey, zonedToUtc } from './time';

const DAY_MS = 86_400_000;
/** Occurrences appear this long before they're due. */
export const LEAD_DAYS = 7;

/** Due day of occurrence `n` (1-based): the first matching weekday on or after the start date, then weekly. */
export function occurrenceDay(rule: Pick<RecurringRule, 'startDate' | 'weekday'>, n: number): string {
  const offset = (rule.weekday - weekdayOfKey(rule.startDate) + 7) % 7;
  return addDaysToKey(rule.startDate, offset + (n - 1) * 7);
}

export function occurrenceDue(rule: Pick<RecurringRule, 'startDate' | 'weekday' | 'dueTime' | 'tz'>, n: number): Date {
  return zonedToUtc(occurrenceDay(rule, n), rule.dueTime, rule.tz);
}

export function occurrenceName(pattern: string, n: number): string {
  return pattern.includes('{n}') ? pattern.replaceAll('{n}', String(n)) : `${pattern} ${n}`;
}

/** First occurrence that isn't already past due, so a rule started mid-term doesn't back-fill old labs. */
export function firstUpcomingN(rule: Pick<RecurringRule, 'startDate' | 'weekday' | 'dueTime' | 'tz' | 'endDate'>, now: Date): number {
  let n = 1;
  while (occurrenceDue(rule, n).getTime() < now.getTime() && n < 520) n += 1;
  return n;
}

/** A rule stops when its course is turned off or its end date passes. */
export function isRuleRunning(rule: RecurringRule, course: Course | undefined, now: Date): boolean {
  if (rule.deletedAt) return false;
  if (!course || course.deletedAt || !course.active) return false;
  if (rule.endDate && dayKey(now, rule.tz) > rule.endDate) return false;
  return true;
}

/**
 * Occurrences that should exist by `now` but haven't been created yet.
 * Each becomes an ordinary work item; ids are derived from the rule so two
 * offline devices generating the same lab converge on one row.
 */
export function pendingOccurrences(
  rule: RecurringRule,
  course: Course | undefined,
  now: Date,
): { items: WorkItem[]; nextN: number } {
  const items: WorkItem[] = [];
  let n = rule.nextN;
  if (!isRuleRunning(rule, course, now)) return { items, nextN: n };

  while (items.length < 52) {
    const day = occurrenceDay(rule, n);
    if (rule.endDate && day > rule.endDate) break;
    const due = zonedToUtc(day, rule.dueTime, rule.tz);
    if (due.getTime() - LEAD_DAYS * DAY_MS > now.getTime()) break;
    items.push(
      createItem(
        {
          id: `${rule.id}-${n}`,
          name: occurrenceName(rule.namePattern, n),
          courseId: rule.courseId,
          type: rule.type,
          dueDate: day,
          dueTime: rule.dueTime,
          tz: rule.tz,
          ruleId: rule.id,
        },
        now,
      ),
    );
    n += 1;
  }
  return { items, nextN: n };
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
