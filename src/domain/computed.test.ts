import { describe, expect, it } from 'vitest';
import { compareUrgency, courseStats, dueIn, formatGrade, isInNow, nextStatus, sortByUrgency, urgency } from './computed';
import { zonedToUtc } from './time';
import type { Status, WorkItem } from './types';

// The spec's reference clock: Fri 2026-09-25, 3:00 pm.
const TZ = 'America/Vancouver';
const NOW = zonedToUtc('2026-09-25', '15:00', TZ);

/** Due at a local wall-clock time; a date with no time means 11:59 pm. */
function due(date: string, time = '23:59', tz = TZ): string {
  return zonedToUtc(date, time, tz).toISOString();
}

function item(overrides: Partial<WorkItem> & { due: string }): Pick<WorkItem, 'due' | 'status' | 'weight' | 'doDate'> {
  return { status: 'Not started' as Status, weight: null, doDate: null, ...overrides };
}

describe('Due in (spec cases, now = Fri 2026-09-25 3:00 pm)', () => {
  const cases: [string, string, string | null, string | null][] = [
    ['Due Thu 24 at 11:59 pm', due('2026-09-24', '23:59'), 'Overdue 16h', 'red'],
    ['Due Tue 22 at 11:59 pm', due('2026-09-22', '23:59'), 'Overdue 2d', 'red'],
    ['Due today at 11:59 pm', due('2026-09-25', '23:59'), 'Today 11:59 pm', 'red'],
    ['Due Sat 26 at 9:00 am', due('2026-09-26', '09:00'), 'Tomorrow 9:00 am', 'orange'],
    ['Due Mon 28', due('2026-09-28'), 'In 3d', 'orange'],
    ['Due Mon Oct 5', due('2026-10-05'), 'In 10d', 'neutral'],
  ];

  it.each(cases)('%s → %s', (_name, dueAt, label, tone) => {
    expect(dueIn(item({ due: dueAt }), NOW, TZ)).toEqual({ label, tone });
  });

  it('Submitted item → blank', () => {
    expect(dueIn(item({ due: due('2026-09-24'), status: 'Submitted' }), NOW, TZ)).toBeNull();
  });

  it('gives the same answers in any device zone', () => {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Australia/Adelaide']) {
      const now = zonedToUtc('2026-09-25', '15:00', tz);
      expect(dueIn(item({ due: due('2026-09-24', '23:59', tz) }), now, tz)?.label).toBe('Overdue 16h');
      expect(dueIn(item({ due: due('2026-09-26', '09:00', tz) }), now, tz)?.label).toBe('Tomorrow 9:00 am');
      expect(dueIn(item({ due: due('2026-09-28', '23:59', tz) }), now, tz)?.label).toBe('In 3d');
    }
  });
});

describe('Due in (edges)', () => {
  it('rounds hours late up', () => {
    expect(dueIn(item({ due: due('2026-09-25', '14:59') }), NOW, TZ)?.label).toBe('Overdue 1h');
  });

  it('switches to days at exactly 24 hours late, rounding down', () => {
    expect(dueIn(item({ due: due('2026-09-24', '15:00') }), NOW, TZ)?.label).toBe('Overdue 1d');
    expect(dueIn(item({ due: due('2026-09-23', '15:01') }), NOW, TZ)?.label).toBe('Overdue 1d');
  });

  it('due later today is Today, even minutes away', () => {
    expect(dueIn(item({ due: due('2026-09-25', '15:30') }), NOW, TZ)).toEqual({ label: 'Today 3:30 pm', tone: 'red' });
  });

  it('two calendar days out is orange, four is neutral', () => {
    expect(dueIn(item({ due: due('2026-09-27', '00:30') }), NOW, TZ)).toEqual({ label: 'In 2d', tone: 'orange' });
    expect(dueIn(item({ due: due('2026-09-29', '08:00') }), NOW, TZ)).toEqual({ label: 'In 4d', tone: 'neutral' });
  });

  it('counts calendar days across a DST change', () => {
    // Clocks fall back in Vancouver on Sun 2026-11-01.
    const now = zonedToUtc('2026-10-30', '15:00', TZ);
    expect(dueIn(item({ due: due('2026-11-02', '09:00') }), now, TZ)?.label).toBe('In 3d');
  });
});

describe('Urgency (spec cases)', () => {
  it('25% due in 4 days ranks above 2% due in 5 days', () => {
    const big = item({ due: due('2026-09-29', '15:00'), weight: 25 });
    const small = item({ due: due('2026-09-30', '15:00'), weight: 2 });
    expect(urgency(big, NOW)).toBeGreaterThan(urgency(small, NOW));
    expect(sortByUrgency([small, big], NOW)[0]).toBe(big);
  });

  it('2% due tonight ranks above 25% due in 4 days', () => {
    const tonight = item({ due: due('2026-09-25', '23:59'), weight: 2 });
    const big = item({ due: due('2026-09-29', '15:00'), weight: 25 });
    expect(urgency(tonight, NOW)).toBeGreaterThan(urgency(big, NOW));
    expect(sortByUrgency([big, tonight], NOW)[0]).toBe(tonight);
  });

  it('an overdue item ranks above one due in 6 hours', () => {
    const overdue = item({ due: due('2026-09-24', '23:59') });
    const soon = item({ due: due('2026-09-25', '21:00') });
    expect(urgency(overdue, NOW)).toBeGreaterThan(urgency(soon, NOW));
    expect(sortByUrgency([soon, overdue], NOW)[0]).toBe(overdue);
  });

  it('no weight and 5% weight with the same due time rank equal', () => {
    const at = due('2026-10-02', '12:00');
    const unweighted = item({ due: at, weight: null });
    const five = item({ due: at, weight: 5 });
    expect(urgency(unweighted, NOW)).toBe(urgency(five, NOW));
    expect(compareUrgency(unweighted, five, NOW)).toBe(0);
  });

  it('breaks ties with the earlier Due', () => {
    // Both inside 24 h would differ; use far-out items with equal score: 10% in 10d vs 5% in 5d.
    const a = item({ due: zonedToUtc('2026-10-05', '15:00', TZ).toISOString(), weight: 10 });
    const b = item({ due: zonedToUtc('2026-09-30', '15:00', TZ).toISOString(), weight: 5 });
    expect(urgency(a, NOW)).toBeCloseTo(urgency(b, NOW));
    expect(sortByUrgency([a, b], NOW)[0]).toBe(b);
  });

  it('most overdue comes first', () => {
    const older = item({ due: due('2026-09-20') });
    const newer = item({ due: due('2026-09-24') });
    expect(sortByUrgency([newer, older], NOW)[0]).toBe(older);
  });
});

describe('Now list membership', () => {
  it('includes overdue and anything focused within 7 days, excludes submitted', () => {
    expect(isInNow(item({ due: due('2026-09-01') }), NOW, TZ)).toBe(true);
    expect(isInNow(item({ due: due('2026-10-02') }), NOW, TZ)).toBe(true);
    expect(isInNow(item({ due: due('2026-10-03') }), NOW, TZ)).toBe(false);
    expect(isInNow(item({ due: due('2026-09-26'), status: 'Submitted' }), NOW, TZ)).toBe(false);
  });

  it('uses the Do date when one is set', () => {
    expect(isInNow(item({ due: due('2026-10-20'), doDate: '2026-09-28' }), NOW, TZ)).toBe(true);
    expect(isInNow(item({ due: due('2026-10-20'), doDate: '2026-10-10' }), NOW, TZ)).toBe(false);
  });
});

describe('Status', () => {
  it('moves forward only', () => {
    expect(nextStatus('Not started')).toBe('In progress');
    expect(nextStatus('In progress')).toBe('Submitted');
    expect(nextStatus('Submitted')).toBeNull();
  });
});

describe('Course stats', () => {
  const base = { courseId: 'c1', status: 'Submitted' as Status, weight: null, grade: null, due: due('2026-09-20') };
  const rows = [
    { ...base, weight: 20, grade: 80 },
    { ...base, weight: 10, grade: 95 },
    { ...base, weight: 30, grade: null },
    { ...base, weight: null, grade: 50 },
    { ...base, status: 'Not started' as Status, due: due('2026-10-01') },
    { ...base, status: 'In progress' as Status, due: due('2026-09-28') },
    { ...base, courseId: 'c2', status: 'Not started' as Status },
  ] as WorkItem[];

  it('grade so far counts only items with both weight and grade', () => {
    const stats = courseStats({ id: 'c1' }, rows);
    expect(stats.gradeSoFar).toBeCloseTo((20 * 80 + 10 * 95) / 30);
    expect(formatGrade(stats.gradeSoFar)).toBe('85.0%');
  });

  it('open count and next due', () => {
    const stats = courseStats({ id: 'c1' }, rows);
    expect(stats.open).toBe(2);
    expect(stats.nextDue?.due).toBe(due('2026-09-28'));
  });

  it('grade so far is blank when nothing is graded', () => {
    expect(courseStats({ id: 'c2' }, rows).gradeSoFar).toBeNull();
    expect(formatGrade(null)).toBe('');
  });
});
