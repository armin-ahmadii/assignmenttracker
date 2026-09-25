import { useMemo } from 'react';
import type { Course, WorkItem } from '../domain/types';
import { courseStats, isInNow, sortByUrgency, type CourseStats } from '../domain/computed';
import { compareTermsDesc, currentTerm } from '../domain/terms';
import { useStore, type Snapshot } from '../data/store';
import { useClock } from './clock';
import { useToastState } from './toast';

export interface RowContext {
  course?: Course;
  parent?: WorkItem;
  milestones?: { done: number; total: number };
}

/** Everything a row needs besides the item itself. */
export function useRowContext(): (item: WorkItem) => RowContext {
  const { items, itemsById, coursesById } = useStore();
  return useMemo(() => {
    const counts = new Map<string, { done: number; total: number }>();
    for (const item of items) {
      if (!item.parentId) continue;
      const entry = counts.get(item.parentId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (item.status === 'Submitted') entry.done += 1;
      counts.set(item.parentId, entry);
    }
    return (item: WorkItem) => ({
      course: coursesById.get(item.courseId),
      parent: item.parentId ? itemsById.get(item.parentId) : undefined,
      milestones: item.type === 'Project' && !item.parentId ? counts.get(item.id) : undefined,
    });
  }, [items, itemsById, coursesById]);
}

/** Items whose course is turned on: what every screen but Done and search works from. */
export function activeItems(snapshot: Snapshot): WorkItem[] {
  return snapshot.items.filter((i) => snapshot.coursesById.get(i.courseId)?.active);
}

export function activeCourses(snapshot: Snapshot): Course[] {
  return snapshot.courses.filter((c) => c.active).sort(compareCourses);
}

export function compareCourses(a: Course, b: Course): number {
  return compareTermsDesc(a.term, b.term) || a.code.localeCompare(b.code, undefined, { numeric: true });
}

/**
 * The Now list: open, overdue or focused within 7 days, most urgent first.
 * Just-submitted items stay (greyed) until their undo window closes.
 */
export function useNowItems(): WorkItem[] {
  const snapshot = useStore();
  const { now, tz } = useClock();
  const { lingering } = useToastState();
  return useMemo(
    () => sortByUrgency(activeItems(snapshot).filter((i) => isInNow(i, now, tz) || lingering.has(i.id)), now),
    [snapshot, now, tz, lingering],
  );
}

export function useCurrentTerm(): string {
  const { courses } = useStore();
  const { now, tz } = useClock();
  return useMemo(() => currentTerm(courses, now, tz), [courses, now, tz]);
}

export function useCourseStats(): Map<string, CourseStats> {
  const { courses, items } = useStore();
  return useMemo(() => new Map(courses.map((c) => [c.id, courseStats(c, items)])), [courses, items]);
}
