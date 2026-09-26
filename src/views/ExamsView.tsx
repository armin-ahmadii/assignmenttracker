import { checklistProgress, isOpen, sortByDue } from '../domain/computed';
import { checklistLabel } from '../domain/factory';
import { formatDay, formatTime } from '../domain/time';
import { useStore } from '../data/store';
import { useClock } from '../ui/clock';
import { activeItems, useRowContext } from '../ui/selectors';
import { WorkRow } from '../ui/WorkRow';
import { ViewHeading } from './ViewHeading';

/** Quizzes and exams not yet submitted, by date, with topic progress. */
export function ExamsView() {
  const snapshot = useStore();
  const rowContext = useRowContext();
  const { tz } = useClock();
  const items = sortByDue(activeItems(snapshot).filter((i) => isOpen(i) && (i.type === 'Exam' || i.type === 'Quiz')));

  return (
    <section className="exams-view" aria-labelledby="view-title">
      <ViewHeading eyebrow="Quizzes and exams" title="Exams" />
      {items.length ? (
        <div className="work-list">
          {items.map((item, index) => {
            const ctx = rowContext(item);
            const progress = checklistProgress(item);
            return (
              <WorkRow
                key={item.id}
                item={item}
                index={index}
                {...ctx}
                meta={
                  <>
                    <span>{ctx.course?.code}</span>
                    <span className="meta-separator" />
                    <span>{item.type}</span>
                    <span className="meta-separator" />
                    <span>
                      {formatDay(item.due, tz)}, {formatTime(item.due, tz)}
                    </span>
                    {progress.total > 0 && (
                      <>
                        <span className="meta-separator" />
                        <span>
                          {checklistLabel(item.type)} {progress.done}/{progress.total}
                        </span>
                      </>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      ) : (
        <p className="empty-state">No quizzes or exams coming up.</p>
      )}
    </section>
  );
}
