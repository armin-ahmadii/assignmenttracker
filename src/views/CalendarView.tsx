import { useMemo, useState } from 'react';
import type { WorkItem } from '../domain/types';
import { sortByDue } from '../domain/computed';
import { addDaysToKey, dayKey, dayNumber, formatDayKey, keyFromDayNumber, weekdayOfKey } from '../domain/time';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { useClock } from '../ui/clock';
import { activeItems, useRowContext } from '../ui/selectors';
import { WorkRow } from '../ui/WorkRow';
import { ViewHeading } from './ViewHeading';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function shiftMonth(startKey: string, delta: number): string {
  const [y, m] = startKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 10);
}

/** Items by Due day, so crunch weeks stand out. Submitted work stays, greyed. */
export function CalendarView() {
  const snapshot = useStore();
  const rowContext = useRowContext();
  const { now, tz } = useClock();
  const today = dayKey(now, tz);
  const [month, setMonth] = useState(() => monthStart(today));
  const [selected, setSelected] = useState(today);

  const byDay = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    for (const item of sortByDue(activeItems(snapshot))) {
      const key = dayKey(item.due, tz);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [snapshot, tz]);

  const weeks = useMemo(() => {
    const first = month;
    const last = addDaysToKey(shiftMonth(month, 1), -1);
    const start = dayNumber(first) - weekdayOfKey(first);
    const end = dayNumber(last) + (6 - weekdayOfKey(last));
    const rows: string[][] = [];
    for (let n = start; n <= end; n += 7) rows.push(Array.from({ length: 7 }, (_, i) => keyFromDayNumber(n + i)));
    return rows;
  }, [month]);

  const dayItems = byDay.get(selected) ?? [];
  const monthCount = [...byDay.entries()].filter(([k]) => k.startsWith(month.slice(0, 7))).reduce((n, [, l]) => n + l.length, 0);

  const pick = (key: string) => {
    setSelected(key);
    if (!key.startsWith(month.slice(0, 7))) setMonth(monthStart(key));
  };

  return (
    <section className="calendar-view" aria-labelledby="view-title">
      <ViewHeading eyebrow="By due date" title="Calendar" />
      <div className="calendar">
        <div className="cal-nav">
          <button type="button" className="action icon-button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="left" />
          </button>
          <h2>{formatDayKey(month, 'MMMM yyyy')}</h2>
          <button type="button" className="action icon-button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <Icon name="arrow" />
          </button>
          <button
            type="button"
            className="action more-button cal-today"
            onClick={() => {
              setMonth(monthStart(today));
              setSelected(today);
            }}
          >
            Today
          </button>
        </div>
        <div className="cal-grid" role="grid" aria-label={formatDayKey(month, 'MMMM yyyy')}>
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="cal-weekday" aria-hidden="true">
              {d}
            </span>
          ))}
          {weeks.flat().map((key) => {
            const list = byDay.get(key) ?? [];
            const open = list.filter((i) => i.status !== 'Submitted').length;
            const load = Math.min(3, open);
            return (
              <button
                type="button"
                key={key}
                className="cal-day"
                data-outside={!key.startsWith(month.slice(0, 7)) || undefined}
                data-today={key === today || undefined}
                data-selected={key === selected || undefined}
                data-load={load}
                aria-label={`${formatDayKey(key, 'EEEE, MMMM d')}: ${list.length ? `${list.length} due` : 'nothing due'}`}
                onClick={() => pick(key)}
              >
                <span className="cal-num">{Number(key.slice(8))}</span>
                {list.length > 0 && (
                  <span className="cal-count" data-done={open === 0 || undefined}>
                    {list.length}
                  </span>
                )}
                <span className="cal-peek">
                  {list.slice(0, 3).map((item) => (
                    <span key={item.id} data-done={item.status === 'Submitted' || undefined}>
                      {item.name}
                    </span>
                  ))}
                  {list.length > 3 && <span>+{list.length - 3} more</span>}
                </span>
              </button>
            );
          })}
        </div>
        {monthCount === 0 && <p className="cal-empty">Nothing due in {formatDayKey(month, 'MMMM')}.</p>}
      </div>

      <div className="day-list">
        <div className="list-labels">
          <span>{selected === today ? 'Today' : formatDayKey(selected, 'EEEE, MMMM d')}</span>
          <span>{dayItems.length ? `${dayItems.length} due` : ''}</span>
        </div>
        {dayItems.length ? (
          <div className="work-list">
            {dayItems.map((item, index) => (
              <WorkRow key={item.id} item={item} index={index} {...rowContext(item)} />
            ))}
          </div>
        ) : (
          <p className="empty-state small">Nothing due this day.</p>
        )}
      </div>
    </section>
  );
}
