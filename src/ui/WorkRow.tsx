import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Course, WorkItem } from '../domain/types';
import { dueIn, nextStatus } from '../domain/computed';
import { Icon } from './Icon';
import { changeStatus } from './toast';
import { openOverlay } from './nav';
import { useClock } from './clock';

interface WorkRowProps {
  item: WorkItem;
  course?: Course;
  /** The project, when this row is a milestone. */
  parent?: WorkItem;
  /** "2/4 milestones", for project rows. */
  milestones?: { done: number; total: number };
  index?: number;
  /** Replaces the default "Course · Type" line. */
  meta?: ReactNode;
  /** Replaces the Due in chip. */
  trailing?: ReactNode;
  onOpen?: (item: WorkItem) => void;
}

const SWIPE_THRESHOLD = 88;

export function typeLabel(item: WorkItem, parent?: WorkItem): string {
  return parent || item.parentId ? 'Milestone' : item.type;
}

export function StatusChip({ item, size = 'dot' }: { item: WorkItem; size?: 'dot' | 'pill' }) {
  const next = nextStatus(item.status);
  const label = next ? `Status: ${item.status}. Move to ${next}` : `Status: ${item.status}`;
  return (
    <button
      type="button"
      className={size === 'dot' ? 'status-chip' : 'status-pill'}
      data-status={item.status}
      aria-label={label}
      title={label}
      disabled={!next}
      onClick={(event) => {
        event.stopPropagation();
        if (next) changeStatus(item, next);
      }}
    >
      {size === 'dot' ? (
        <span className="status-dot" data-status={item.status}>
          {item.status === 'Submitted' && <Icon name="check" />}
        </span>
      ) : (
        <>
          <span className="status-dot" data-status={item.status}>
            {item.status === 'Submitted' && <Icon name="check" />}
          </span>
          {item.status}
        </>
      )}
    </button>
  );
}

export function DueChip({ item }: { item: WorkItem }) {
  const { now, tz } = useClock();
  const due = dueIn(item, now, tz);
  if (!due) return <span className="due-chip done">Submitted</span>;
  return <span className={`due-chip ${due.tone}`}>{due.label}</span>;
}

/**
 * One work item: status chip, name, course · type, and the Due in chip.
 * Swipe right (or tap the chip) to move it forward a status; tap to open.
 */
export function WorkRow({ item, course, parent, milestones, index = 0, meta, trailing, onOpen }: WorkRowProps) {
  const [dx, setDx] = useState(0);
  const gesture = useRef<{ x: number; y: number; id: number; mode: 'pending' | 'swipe' | 'scroll' } | null>(null);
  const suppressClick = useRef(false);
  const next = nextStatus(item.status);
  const open = onOpen ?? ((it: WorkItem) => openOverlay({ kind: 'item', id: it.id }));

  const onPointerDown = (event: React.PointerEvent) => {
    if (!next || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.status-chip, input, a')) return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, mode: 'pending' };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const moveX = event.clientX - g.x;
    const moveY = event.clientY - g.y;
    if (g.mode === 'pending') {
      if (moveX > 10 && Math.abs(moveX) > Math.abs(moveY) * 1.3) {
        g.mode = 'swipe';
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } else if (Math.abs(moveY) > 10 || moveX < -10) {
        g.mode = 'scroll';
      }
    }
    if (g.mode === 'swipe') {
      const x = Math.max(0, moveX);
      // Resist past the threshold so it feels like a detent.
      setDx(x > SWIPE_THRESHOLD ? SWIPE_THRESHOLD + (x - SWIPE_THRESHOLD) * 0.35 : x);
    }
  };

  const finish = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.mode === 'swipe') {
      suppressClick.current = true;
      if (commit && dx >= SWIPE_THRESHOLD && next) changeStatus(item, next);
      setDx(0);
    }
  };

  const armed = dx >= SWIPE_THRESHOLD;
  const nameNode = parent ? (
    <>
      <span className="name-parent">{parent.name} › </span>
      {item.name}
    </>
  ) : (
    item.name
  );

  return (
    <div
      className="row-wrap"
      data-status={item.status}
      data-swiping={dx > 0 || undefined}
      style={{ '--row': Math.min(index, 12) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      {next && (
        <div className="swipe-reveal" data-armed={armed || undefined} aria-hidden="true">
          <Icon name={next === 'Submitted' ? 'check' : 'arrow'} />
          <span>{next}</span>
        </div>
      )}
      <div className="work-row" style={dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}>
        <StatusChip item={item} />
        <button type="button" className="row-open" onClick={() => open(item)}>
          <span className="work-copy">
            <span className="work-name">{nameNode}</span>
            <span className="work-meta">
              {meta ?? (
                <>
                  <span>{course?.code ?? 'No course'}</span>
                  <span className="meta-separator" />
                  <span>{typeLabel(item, parent)}</span>
                  {milestones && milestones.total > 0 && (
                    <>
                      <span className="meta-separator" />
                      <span>
                        {milestones.done}/{milestones.total} milestones
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
          </span>
          {trailing ?? <DueChip item={item} />}
          <span className="row-arrow">
            <Icon name="arrow" />
          </span>
        </button>
      </div>
    </div>
  );
}
