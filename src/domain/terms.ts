import type { Course } from './types';
import { dayKey } from './time';

const SEASON_ORDER: Record<string, number> = { winter: 1, spring: 1, summer: 2, fall: 3, autumn: 3 };

function parseTerm(term: string): { season: string; year: number } | null {
  const match = term.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  return { season: match[1].toLowerCase(), year: Number(match[2]) };
}

/** Newest term first. Unrecognised names sort after recognised ones, alphabetically. */
export function compareTermsDesc(a: string, b: string): number {
  const pa = parseTerm(a);
  const pb = parseTerm(b);
  if (pa && pb) {
    if (pa.year !== pb.year) return pb.year - pa.year;
    return (SEASON_ORDER[pb.season] ?? 0) - (SEASON_ORDER[pa.season] ?? 0);
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b);
}

/** Term a new course most likely belongs to, from the calendar (Spring = Jan–Apr, Summer = May–Aug, Fall = Sep–Dec). */
export function guessTerm(now: Date, tz: string): string {
  const [year, month] = dayKey(now, tz).split('-').map(Number);
  const season = month <= 4 ? 'Spring' : month <= 8 ? 'Summer' : 'Fall';
  return `${season} ${year}`;
}

export function nextTermName(term: string): string {
  const parsed = parseTerm(term);
  if (!parsed) return '';
  const { season, year } = parsed;
  if (season === 'fall' || season === 'autumn') return `Spring ${year + 1}`;
  if (season === 'spring' || season === 'winter') return `Summer ${year}`;
  return `Fall ${year}`;
}

/** The term of the most recently created active course; falls back to the calendar. */
export function currentTerm(courses: Course[], now: Date, tz: string): string {
  const live = courses.filter((c) => !c.deletedAt);
  const active = live.filter((c) => c.active);
  const pool = active.length ? active : live;
  if (!pool.length) return guessTerm(now, tz);
  return pool.reduce((latest, c) => (c.createdAt > latest.createdAt ? c : latest)).term;
}

export function allTerms(courses: Course[]): string[] {
  return [...new Set(courses.filter((c) => !c.deletedAt).map((c) => c.term))].sort(compareTermsDesc);
}
