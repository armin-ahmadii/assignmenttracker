import { dueIn } from '../domain/computed';
import { formatDay } from '../domain/time';
import { useClock } from '../ui/clock';
import { useNowItems, useRowContext } from '../ui/selectors';
import { WorkRow } from '../ui/WorkRow';
import { ViewHeading } from './ViewHeading';

export function NowView() {
  const items = useNowItems();
  const rowContext = useRowContext();
  const { now, tz } = useClock();

  const open = items.filter((i) => i.status !== 'Submitted');
  const attention = open.filter((i) => dueIn(i, now, tz)?.tone === 'red').length;
  const rest = open.length - attention;

  return (
    <section className="now-panel" aria-labelledby="view-title">
      <ViewHeading eyebrow={formatDay(now, tz, 'EEEE, MMMM d')} title="Now">
        {open.length > 0 && (
          <p className="section-summary">
            {attention > 0 ? (
              <>
                <strong>
                  {attention} {attention === 1 ? 'needs' : 'need'} attention.
                </strong>{' '}
                {rest > 0 ? `${rest} more this week.` : 'Then the week is clear.'}
              </>
            ) : (
              <>
                <strong>Nothing due today.</strong> {rest} coming up this week.
              </>
            )}
          </p>
        )}
      </ViewHeading>

      {items.length ? (
        <>
          <div className="list-labels">
            <span>Next up</span>
            <span>
              {open.length} {open.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <div className="work-list">
            {items.map((item, index) => (
              <WorkRow key={item.id} item={item} index={index} {...rowContext(item)} />
            ))}
          </div>
        </>
      ) : (
        <p className="empty-state">Nothing overdue or due in the next 7 days.</p>
      )}
    </section>
  );
}
