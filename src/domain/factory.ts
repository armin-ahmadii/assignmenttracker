import type { ChecklistEntry, Course, ItemType, RecurringRule, WorkItem } from './types';
import { END_OF_DAY, zonedToUtc } from './time';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for very old browsers; ids only need to be unique per user.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const SUBMISSION_CHECKLIST = [
  'Correct file and format',
  'Named per the instructions',
  'All parts attempted',
  'Uploaded',
  'Confirmation seen',
];

const LAB_CHECKLIST = ['Pre-lab', 'In lab', 'Write-up'];

export function templateChecklist(type: ItemType): ChecklistEntry[] {
  const texts = type === 'Assignment' ? SUBMISSION_CHECKLIST : type === 'Lab' ? LAB_CHECKLIST : [];
  return texts.map((text) => ({ id: newId(), text, done: false }));
}

/** What the checklist is called in the item's layout. */
export function checklistLabel(type: ItemType): string {
  if (type === 'Assignment') return 'Submission checklist';
  if (type === 'Exam') return 'Topics';
  return 'Checklist';
}

export interface NewItemInput {
  name: string;
  courseId: string;
  type?: ItemType;
  /** `YYYY-MM-DD` in `tz` */
  dueDate: string;
  /** `HH:mm`; empty means 11:59 pm */
  dueTime?: string;
  tz: string;
  parentId?: string | null;
  ruleId?: string | null;
  id?: string;
}

export function createItem(input: NewItemInput, now: Date): WorkItem {
  const type = input.type ?? 'Assignment';
  const stamp = now.toISOString();
  return {
    id: input.id ?? newId(),
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    name: input.name.trim(),
    courseId: input.courseId,
    type,
    due: zonedToUtc(input.dueDate, input.dueTime || END_OF_DAY, input.tz).toISOString(),
    dueTz: input.tz,
    status: 'Not started',
    doDate: null,
    weight: null,
    effort: null,
    link: null,
    grade: null,
    notes: '',
    // Milestones are plain sub-tasks: they don't get the project's template.
    checklist: input.parentId ? [] : templateChecklist(type),
    parentId: input.parentId ?? null,
    submittedAt: null,
    requirements: '',
    whenWhere: '',
    links: [],
    ruleId: input.ruleId ?? null,
  };
}

export function createCourse(input: { code: string; term: string; site?: string | null }, now: Date): Course {
  const stamp = now.toISOString();
  return {
    id: newId(),
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    code: normalizeCode(input.code),
    term: input.term.trim(),
    active: true,
    site: input.site?.trim() || null,
  };
}

export function createRule(
  input: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'nextN'> & { nextN?: number },
  now: Date,
): RecurringRule {
  const stamp = now.toISOString();
  return { id: newId(), createdAt: stamp, updatedAt: stamp, deletedAt: null, nextN: 1, ...input };
}

/** "cmpt  276" → "CMPT 276" */
export function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Parent must be a top-level Project; only projects get sub-items. */
export function canBeParent(item: Pick<WorkItem, 'type' | 'parentId'>): boolean {
  return item.type === 'Project' && item.parentId == null;
}
