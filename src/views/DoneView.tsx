import { useMemo, useState } from 'react';
import type { Course, WorkItem } from '../domain/types';
import { courseStats, formatGrade } from '../domain/computed';
import { compareTermsDesc } from '../domain/terms';
import { formatDay } from '../domain/time';
import { updateItem } from '../data/actions';
import { useStore } from '../data/store';
import { useClock } from '../ui/clock';
import { openOverlay } from '../ui/nav';
import { useCurrentTerm, useRowContext } from '../ui/selectors';
import { StatusChip, typeLabel } from '../ui/WorkRow';
import { ViewHeading } from './ViewHeading';

interface CourseGroup {
  course: Course | undefined;
  items: WorkItem[];
}

/** Submitted work across all terms. The only screen that shows grades. */
export function DoneView() {
  const { items, courses, coursesById } = useStore();
  const current = useCurrentTerm();

  const terms = useMemo(() => {
    const submitted = items.filter((i) => i.status === 'Submitted');
    const byCourse = new Map<string, WorkItem[]>();
    for (const item of submitted) {
      const list = byCourse.get(item.courseId) ?? [];
      list.push(item);
      byCourse.set(item.courseId, list);
    }
    const byTerm = new Map<string, CourseGroup[]>();
    for (const [courseId, list] of byCourse) {
      const course = coursesById.get(courseId);
      const term = course?.term ?? 'No term';
      const groups = byTerm.get(term) ?? [];
      groups.push({
        course,
        items: list.sort((a, b) => (b.submittedAt ?? b.due).localeCompare(a.submittedAt ?? a.due)),
      });
      byTerm.set(term, groups);
    }
    return [...byTerm.entries()]
      .map(([term, groups]) => ({
        term,
        groups: groups.sort((a, b) => (a.course?.code ?? '').localeCompare(b.course?.code ?? '', undefined, { numeric: true })),
        count: groups.reduce((n, g) => n + g.items.length, 0),
      }))
      .sort((a, b) => (a.term === current ? -1 : b.term === current ? 1 : compareTermsDesc(a.term, b.term)));
    // `courses` is listed so a course rename/term move regroups the page.
  }, [items, courses, coursesById, current]);

  return (
    <section className="done-view" aria-labelledby="view-title">
      <ViewHeading eyebrow="Submitted work, every term" title="Done" />
      {!terms.length && <p className="empty-state">Submitted work shows up here, with grades once they're back.</p>}
      {terms.map(({ term, groups, count }) =>
        term === current ? (
          <div className="term-block" key={term}>
            <h2 className="term-heading">
              {term} <span>{count} submitted</span>
            </h2>
            {groups.map((g) => (
              <DoneCourse key={g.course?.id ?? 'none'} group={g} allItems={items} />
            ))}
          </div>
        ) : (
          <details className="term-block" key={term}>
            <summary className="term-heading">
              {term} <span>{count} submitted</span>
            </summary>
            {groups.map((g) => (
              <DoneCourse key={g.course?.id ?? 'none'} group={g} allItems={items} />
            ))}
          </details>
        ),
      )}
    </section>
  );
}

function DoneCourse({ group, allItems }: { group: CourseGroup; allItems: WorkItem[] }) {
  const grade = group.course ? courseStats(group.course, allItems).gradeSoFar : null;
  return (
    <section className="course-section" aria-label={group.course?.code ?? 'No course'}>
      <header className="course-section-head">
        <div className="course-title static">
          <h3>{group.course?.code ?? 'No course'}</h3>
          {group.course && !group.course.active && <span>Off</span>}
        </div>
        {grade != null && (
          <span className="grade-so-far">
            <small>Grade so far</small> {formatGrade(grade)}
          </span>
        )}
      </header>
      <div className="work-list">
        {group.items.map((item) => (
          <DoneRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function DoneRow({ item }: { item: WorkItem }) {
  const { tz } = useClock();
  const rowContext = useRowContext();
  const { parent } = rowContext(item);
  return (
    <div className="row-wrap" data-status={item.status}>
      <div className="work-row done-row">
        <StatusChip item={item} />
        <button type="button" className="row-open" onClick={() => openOverlay({ kind: 'item', id: item.id })}>
          <span className="work-copy">
            <span className="work-name">
              {parent && <span className="name-parent">{parent.name} › </span>}
              {item.name}
            </span>
            <span className="work-meta">
              <span>{typeLabel(item, parent)}</span>
              <span className="meta-separator" />
              <span>Submitted {formatDay(item.submittedAt ?? item.due, tz, 'MMM d')}</span>
            </span>
          </span>
        </button>
        <span className="weight-cell" title="Weight">
          <small>Weight</small>
          {item.weight == null ? '—' : `${item.weight}%`}
        </span>
        <GradeInput item={item} />
      </div>
    </div>
  );
}

function GradeInput({ item }: { item: WorkItem }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (item.grade == null ? '' : String(item.grade));
  const commit = () => {
    if (draft == null) return;
    const text = draft.trim();
    const number = Number(text);
    if (text === '') updateItem(item.id, { grade: null });
    else if (Number.isFinite(number) && number >= 0 && number <= 100) updateItem(item.id, { grade: number });
    setDraft(null);
  };
  return (
    <label className="grade-cell">
      <small>Grade</small>
      <span className="grade-input">
        <input
          inputMode="decimal"
          value={value}
          placeholder="—"
          aria-label={`Grade for ${item.name}, percent`}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
        %
      </span>
    </label>
  );
}
