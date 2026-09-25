import { describe, expect, it } from 'vitest';
import { canBeParent, createCourse, createItem, createRule } from './factory';
import { firstUpcomingN, occurrenceDay, pendingOccurrences } from './recurring';
import { codeTaken, parseCodes, planRollover } from './rollover';
import { currentTerm, guessTerm, nextTermName } from './terms';
import { buildExport, itemsCsv, toCsv } from './export';
import { formatTime, zonedToUtc } from './time';

const TZ = 'America/Vancouver';
const NOW = zonedToUtc('2026-09-25', '15:00', TZ);

describe('Creating items', () => {
  it('a date with no time becomes 11:59 pm local', () => {
    const item = createItem({ name: 'Lab 4', courseId: 'c', dueDate: '2026-09-28', tz: TZ }, NOW);
    expect(formatTime(item.due, TZ)).toBe('11:59 pm');
    expect(item.dueTz).toBe(TZ);
  });

  it('defaults to Assignment, Not started, with the submission checklist', () => {
    const item = createItem({ name: ' Essay ', courseId: 'c', dueDate: '2026-09-28', tz: TZ }, NOW);
    expect(item.name).toBe('Essay');
    expect(item.type).toBe('Assignment');
    expect(item.status).toBe('Not started');
    expect(item.checklist.map((c) => c.text)).toEqual([
      'Correct file and format',
      'Named per the instructions',
      'All parts attempted',
      'Uploaded',
      'Confirmation seen',
    ]);
  });

  it('fills each type from its template', () => {
    const make = (type: 'Lab' | 'Exam' | 'Quiz' | 'Reading' | 'Project') =>
      createItem({ name: 'x', courseId: 'c', dueDate: '2026-09-28', tz: TZ, type }, NOW);
    expect(make('Lab').checklist.map((c) => c.text)).toEqual(['Pre-lab', 'In lab', 'Write-up']);
    expect(make('Exam').checklist).toEqual([]);
    expect(make('Quiz').checklist).toEqual([]);
    expect(make('Reading').checklist).toEqual([]);
    expect(make('Project').checklist).toEqual([]);
  });

  it('only top-level projects can have milestones', () => {
    expect(canBeParent({ type: 'Project', parentId: null })).toBe(true);
    expect(canBeParent({ type: 'Project', parentId: 'p' })).toBe(false);
    expect(canBeParent({ type: 'Lab', parentId: null })).toBe(false);
  });
});

describe('Recurring rules', () => {
  const course = createCourse({ code: 'cmpt 225', term: 'Fall 2026' }, NOW);
  // Labs due Thursdays at 11:59 pm, from Tue Sep 8.
  const rule = createRule(
    { courseId: course.id, type: 'Lab', namePattern: 'Lab {n}', weekday: 4, dueTime: '23:59', startDate: '2026-09-08', endDate: null, tz: TZ },
    NOW,
  );

  it('places occurrence n on the matching weekday', () => {
    expect(occurrenceDay(rule, 1)).toBe('2026-09-10');
    expect(occurrenceDay(rule, 4)).toBe('2026-10-01');
  });

  it('starts at the first occurrence that is not already past', () => {
    // Lab 3 was due Thu Sep 24; Lab 4 (Oct 1) is next.
    expect(firstUpcomingN(rule, NOW)).toBe(4);
  });

  it('creates each occurrence 7 days before it is due, numbered automatically', () => {
    const { items, nextN } = pendingOccurrences({ ...rule, nextN: 4 }, course, NOW);
    expect(items.map((i) => i.name)).toEqual(['Lab 4']);
    expect(items[0].type).toBe('Lab');
    expect(items[0].id).toBe(`${rule.id}-4`);
    expect(nextN).toBe(5);

    const later = pendingOccurrences({ ...rule, nextN: 5 }, course, zonedToUtc('2026-10-01', '23:59', TZ));
    expect(later.items.map((i) => i.name)).toEqual(['Lab 5']);
  });

  it('does not create an occurrence earlier than 7 days out', () => {
    const { items } = pendingOccurrences({ ...rule, nextN: 5 }, course, NOW);
    expect(items).toEqual([]);
  });

  it('stops when the course is turned off', () => {
    const { items } = pendingOccurrences({ ...rule, nextN: 4 }, { ...course, active: false }, NOW);
    expect(items).toEqual([]);
  });

  it('stops when the end date passes', () => {
    expect(pendingOccurrences({ ...rule, nextN: 4, endDate: '2026-09-30' }, course, NOW).items).toEqual([]);
    expect(pendingOccurrences({ ...rule, nextN: 4, endDate: '2026-09-20' }, course, NOW).items).toEqual([]);
    expect(pendingOccurrences({ ...rule, nextN: 4, endDate: '2026-10-01' }, course, NOW).items).toHaveLength(1);
  });
});

describe('Semester rollover', () => {
  const fall = [
    createCourse({ code: 'CMPT 225', term: 'Fall 2026' }, NOW),
    createCourse({ code: 'MATH 232', term: 'Fall 2026' }, NOW),
  ];

  it('parses codes one per line, normalised and de-duplicated', () => {
    expect(parseCodes('cmpt 300\n  CMPT   300 \n\nstat 270')).toEqual(['CMPT 300', 'STAT 270']);
  });

  it('creates the new courses and offers every active old course for turning off', () => {
    const plan = planRollover(fall, 'Spring 2027', 'CMPT 300\nSTAT 270', NOW);
    expect(plan.create.map((c) => [c.code, c.term, c.active])).toEqual([
      ['CMPT 300', 'Spring 2027', true],
      ['STAT 270', 'Spring 2027', true],
    ]);
    expect(plan.previous.map((c) => c.code)).toEqual(['CMPT 225', 'MATH 232']);
  });

  it('keeps course codes unique within a term', () => {
    expect(codeTaken(fall, 'cmpt 225', 'Fall 2026')).toBe(true);
    expect(codeTaken(fall, 'CMPT 225', 'Spring 2027')).toBe(false);
    expect(codeTaken(fall, 'CMPT 225', 'Fall 2026', fall[0].id)).toBe(false);
  });

  it('names terms sensibly', () => {
    expect(nextTermName('Fall 2026')).toBe('Spring 2027');
    expect(nextTermName('Spring 2027')).toBe('Summer 2027');
    expect(nextTermName('Summer 2027')).toBe('Fall 2027');
    expect(guessTerm(NOW, TZ)).toBe('Fall 2026');
    expect(currentTerm(fall, NOW, TZ)).toBe('Fall 2026');
  });
});

describe('Export', () => {
  it('escapes CSV cells', () => {
    expect(toCsv(['a', 'b'], [['x, y', 'say "hi"\nthere']])).toBe('a,b\r\n"x, y","say ""hi""\nthere"\r\n');
  });

  it('contains every live record and drops tombstones', () => {
    const course = createCourse({ code: 'CMPT 276', term: 'Fall 2026' }, NOW);
    const kept = createItem({ name: 'Keep', courseId: course.id, dueDate: '2026-09-28', tz: TZ }, NOW);
    const gone = { ...createItem({ name: 'Gone', courseId: course.id, dueDate: '2026-09-28', tz: TZ }, NOW), deletedAt: NOW.toISOString() };
    const data = buildExport([course], [kept, gone], [], NOW);
    expect(data.items.map((i) => i.name)).toEqual(['Keep']);
    const csv = itemsCsv(data);
    expect(csv).toContain('Keep');
    expect(csv).toContain('CMPT 276');
    expect(csv).not.toContain('Gone');
  });
});
