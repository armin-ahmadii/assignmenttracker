import { dueIn } from '../domain/computed';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { useClock } from '../ui/clock';
import { goTo, openOverlay } from '../ui/nav';
import { activeCourses, useCourseStats, useCurrentTerm } from '../ui/selectors';

export function goToCourse(courseId: string) {
  goTo('by-course');
  requestAnimationFrame(() => document.getElementById(`course-${courseId}`)?.scrollIntoView({ block: 'start' }));
}

function useCourseRows() {
  const snapshot = useStore();
  const stats = useCourseStats();
  const { now, tz } = useClock();
  // Soonest next due first, like the Now list; courses with nothing open go last.
  const nextDueAt = (id: string) => {
    const next = stats.get(id)?.nextDue;
    return next ? Date.parse(next.due) : Infinity;
  };
  return activeCourses(snapshot)
    .sort((a, b) => nextDueAt(a.id) - nextDueAt(b.id) || 0)
    .map((course) => {
      const s = stats.get(course.id);
      const next = s?.nextDue ? dueIn(s.nextDue, now, tz) : null;
      return { course, open: s?.open ?? 0, next };
    });
}

/** Laptop: the Courses side panel. */
export function CoursesPanel() {
  const rows = useCourseRows();
  const term = useCurrentTerm();
  return (
    <aside className="courses-panel" aria-label="Courses">
      <div className="course-heading">
        <div>
          <p className="eyebrow">{term}</p>
          <h2>Courses</h2>
        </div>
        <button type="button" className="action more-button" onClick={() => openOverlay({ kind: 'courses' })}>
          Manage
        </button>
      </div>
      <div className="course-list">
        {rows.map(({ course, open, next }) => (
          <button type="button" className="course-row" key={course.id} onClick={() => goToCourse(course.id)}>
            <span>
              <strong>{course.code}</strong>
              <small>{open} open</small>
            </span>
            <span className={`course-due ${next?.tone ?? ''}`}>{next?.label ?? 'Nothing due'}</span>
          </button>
        ))}
        {!rows.length && (
          <button type="button" className="course-row course-empty" onClick={() => openOverlay({ kind: 'course', id: null })}>
            <span>
              <strong>Add your first course</strong>
              <small>Just the code, e.g. CMPT 276</small>
            </span>
          </button>
        )}
      </div>
      <button type="button" className="new-term" onClick={() => openOverlay({ kind: 'new-term' })}>
        <span className="new-term-plus">
          <Icon name="plus" />
        </span>
        <span>
          <strong>New term</strong>
          <small>Move semesters in about a minute</small>
        </span>
      </button>
    </aside>
  );
}

/** Phone: the compact Courses strip under the Now list. */
export function CoursesStrip() {
  const rows = useCourseRows();
  const term = useCurrentTerm();
  return (
    <section className="mobile-courses" aria-label="Courses">
      <div className="mobile-course-title">
        <div>
          <p className="eyebrow">{term}</p>
          <h2>Courses</h2>
        </div>
        <button type="button" onClick={() => openOverlay({ kind: 'courses' })}>
          Manage
        </button>
      </div>
      <div className="course-strip">
        {rows.map(({ course, open, next }) => (
          <button type="button" className="course-card" key={course.id} onClick={() => goToCourse(course.id)}>
            <span className="course-code">{course.code}</span>
            <span>{open} open</span>
            <span className={next?.tone ?? ''}>{next?.label ?? 'Nothing due'}</span>
          </button>
        ))}
        {!rows.length && (
          <button type="button" className="course-card" onClick={() => openOverlay({ kind: 'course', id: null })}>
            <span className="course-code">Add a course</span>
            <span>Just the code</span>
          </button>
        )}
      </div>
    </section>
  );
}
