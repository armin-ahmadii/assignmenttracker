import { isOpen, sortByDue } from '../domain/computed';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { openOverlay } from '../ui/nav';
import { activeCourses, activeItems, useCurrentTerm, useRowContext } from '../ui/selectors';
import { WorkRow } from '../ui/WorkRow';
import { ViewHeading } from './ViewHeading';

export function ByCourseView() {
  const snapshot = useStore();
  const rowContext = useRowContext();
  const term = useCurrentTerm();
  const courses = activeCourses(snapshot);
  const open = activeItems(snapshot).filter(isOpen);

  return (
    <section className="by-course-view" aria-labelledby="view-title">
      <ViewHeading eyebrow={term} title="By course" />
      {!courses.length && (
        <div className="empty-state">
          <p>Add a course to start tracking work.</p>
          <button type="button" className="action secondary-button" onClick={() => openOverlay({ kind: 'course', id: null })}>
            Add course
          </button>
        </div>
      )}
      {courses.map((course) => {
        const items = sortByDue(open.filter((i) => i.courseId === course.id));
        return (
          <section className="course-section" id={`course-${course.id}`} key={course.id} aria-label={course.code}>
            <header className="course-section-head">
              <button type="button" className="course-title" onClick={() => openOverlay({ kind: 'course', id: course.id })}>
                <h2>{course.code}</h2>
                <span>{items.length} open</span>
              </button>
              {course.site && (
                <a className="action more-button" href={course.site} target="_blank" rel="noreferrer">
                  Course site <Icon name="external" />
                </a>
              )}
            </header>
            {items.length ? (
              <div className="work-list">
                {items.map((item, index) => (
                  <WorkRow key={item.id} item={item} index={index} {...rowContext(item)} />
                ))}
              </div>
            ) : (
              <p className="empty-state small">Nothing open.</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
