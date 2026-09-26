import type { Course, RecurringRule, WorkItem } from './types';

export interface ExportData {
  app: 'due';
  version: 1;
  exportedAt: string;
  courses: Course[];
  items: WorkItem[];
  rules: RecurringRule[];
}

export function buildExport(courses: Course[], items: WorkItem[], rules: RecurringRule[], now: Date): ExportData {
  const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
  return {
    app: 'due',
    version: 1,
    exportedAt: now.toISOString(),
    courses: live(courses),
    items: live(items),
    rules: live(rules),
  };
}

function cell(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function itemsCsv(data: ExportData): string {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const headers = [
    'id', 'name', 'course', 'term', 'type', 'due_utc', 'due_tz', 'status', 'do_date', 'weight', 'effort',
    'link', 'grade', 'notes', 'checklist', 'parent_id', 'submitted_at', 'requirements', 'when_where',
    'links', 'rule_id', 'course_id', 'created_at', 'updated_at',
  ];
  const rows = data.items.map((i) => {
    const course = courses.get(i.courseId);
    return [
      i.id, i.name, course?.code, course?.term, i.type, i.due, i.dueTz, i.status, i.doDate, i.weight, i.effort,
      i.link, i.grade, i.notes, i.checklist, i.parentId, i.submittedAt, i.requirements, i.whenWhere,
      i.links, i.ruleId, i.courseId, i.createdAt, i.updatedAt,
    ];
  });
  return toCsv(headers, rows);
}

export function coursesCsv(data: ExportData): string {
  const headers = ['id', 'code', 'term', 'active', 'site', 'created_at', 'updated_at'];
  return toCsv(headers, data.courses.map((c) => [c.id, c.code, c.term, c.active, c.site, c.createdAt, c.updatedAt]));
}

export function rulesCsv(data: ExportData): string {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const headers = [
    'id', 'course', 'term', 'type', 'name_pattern', 'weekday', 'due_time', 'start_date', 'end_date', 'tz',
    'next_n', 'course_id',
  ];
  return toCsv(
    headers,
    data.rules.map((r) => [
      r.id, courses.get(r.courseId)?.code, courses.get(r.courseId)?.term, r.type, r.namePattern, r.weekday,
      r.dueTime, r.startDate, r.endDate, r.tz, r.nextN, r.courseId,
    ]),
  );
}
