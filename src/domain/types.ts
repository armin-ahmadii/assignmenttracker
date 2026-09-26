export const ITEM_TYPES = ['Assignment', 'Lab', 'Quiz', 'Exam', 'Project', 'Reading'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = ['Not started', 'In progress', 'Submitted'] as const;
export type Status = (typeof STATUSES)[number];

export const EFFORTS = ['S', 'M', 'L'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}

export interface LinkEntry {
  id: string;
  url: string;
  label: string;
}

/** Fields every synced record carries. Timestamps are ISO-8601 UTC strings. */
export interface SyncFields {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete tombstone so deletions reach other devices. */
  deletedAt: string | null;
}

export interface WorkItem extends SyncFields {
  name: string;
  courseId: string;
  type: ItemType;
  /** Due instant in UTC. */
  due: string;
  /** IANA time zone the due time was entered in. Display uses the device zone. */
  dueTz: string;
  status: Status;
  /** Planned work day, `YYYY-MM-DD`. */
  doDate: string | null;
  /** Share of the final grade, 0–100. */
  weight: number | null;
  effort: Effort | null;
  link: string | null;
  /** 0–100, filled in once returned. */
  grade: number | null;
  notes: string;
  checklist: ChecklistEntry[];
  /** Only set on project milestones. */
  parentId: string | null;
  submittedAt: string | null;
  /** Assignment template: pasted spec. */
  requirements: string;
  /** Exam template: "When / where" line. */
  whenWhere: string;
  /** Exam template: practice-material links. */
  links: LinkEntry[];
  /** Set when the item was created by a recurring rule. */
  ruleId: string | null;
}

export interface Course extends SyncFields {
  code: string;
  term: string;
  active: boolean;
  site: string | null;
}

export interface RecurringRule extends SyncFields {
  courseId: string;
  type: ItemType;
  /** e.g. "Lab {n}" */
  namePattern: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** `HH:mm`, 24-hour */
  dueTime: string;
  /** `YYYY-MM-DD` */
  startDate: string;
  endDate: string | null;
  /** Zone the rule's wall-clock times are interpreted in. */
  tz: string;
  /** Next occurrence number to create. Occurrence 1 is the first matching weekday on or after startDate. */
  nextN: number;
}

export type Tone = 'red' | 'orange' | 'neutral';

export interface DueIn {
  label: string;
  tone: Tone;
}
