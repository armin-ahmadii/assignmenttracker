import type { Course } from './types';
import { createCourse, normalizeCode } from './factory';

export function parseCodes(text: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const line of text.split(/[\n,;]+/)) {
    const code = normalizeCode(line);
    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

export interface RolloverPlan {
  term: string;
  /** Brand-new courses for the term. */
  create: Course[];
  /** Courses already in the term (e.g. added earlier) that just need turning on. */
  reactivate: Course[];
  /** Currently active courses from other terms: the "Turn off" candidates. */
  previous: Course[];
}

export function planRollover(courses: Course[], term: string, codesText: string, now: Date): RolloverPlan {
  const name = term.trim();
  const live = courses.filter((c) => !c.deletedAt);
  const inTerm = new Map(live.filter((c) => c.term === name).map((c) => [c.code, c]));
  const create: Course[] = [];
  const reactivate: Course[] = [];
  for (const code of parseCodes(codesText)) {
    const existing = inTerm.get(code);
    if (existing) {
      if (!existing.active) reactivate.push(existing);
    } else {
      create.push(createCourse({ code, term: name }, now));
    }
  }
  const previous = live.filter((c) => c.active && c.term !== name);
  return { term: name, create, reactivate, previous };
}

/** Code must be unique within a term. */
export function codeTaken(courses: Course[], code: string, term: string, exceptId?: string): boolean {
  const normalized = normalizeCode(code);
  return courses.some((c) => !c.deletedAt && c.id !== exceptId && c.term === term.trim() && c.code === normalized);
}
