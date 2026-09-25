import { useEffect, useRef, useState } from 'react';
import { STATUSES, type Status, type WorkItem } from '../domain/types';
import { useNowItems, useRowContext, type RowContext } from '../ui/selectors';
import { changeStatus } from '../ui/toast';
import { openOverlay } from '../ui/nav';
import { DueChip, StatusChip, typeLabel } from '../ui/WorkRow';
import { ViewHeading } from './ViewHeading';

interface DragState {
  item: WorkItem;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  over: Status | null;
}

const LONG_PRESS_MS = 350;

export function BoardView() {
  const items = useNowItems();
  const rowContext = useRowContext();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [visibleColumn, setVisibleColumn] = useState<Status>('Not started');

  const columns = STATUSES.map((status) => ({ status, items: items.filter((i) => i.status === status) }));

  // Phone: keep the column switcher in step with horizontal scrolling.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const index = Math.round(el.scrollLeft / Math.max(1, el.scrollWidth / STATUSES.length));
      setVisibleColumn(STATUSES[Math.min(STATUSES.length - 1, index)]);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToColumn = (status: Status) => {
    document.getElementById(`column-${status.replace(' ', '-')}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  return (
    <section className="board-view" aria-labelledby="view-title">
      <ViewHeading eyebrow="Overdue and next 7 days" title="Board" />
      <div className="column-switch" role="tablist" aria-label="Columns">
        {columns.map(({ status, items: colItems }) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={visibleColumn === status}
            className={visibleColumn === status ? 'active' : ''}
            onClick={() => scrollToColumn(status)}
          >
            {status} <span>{colItems.length}</span>
          </button>
        ))}
      </div>
      <div className="board" ref={scroller}>
        {columns.map(({ status, items: colItems }) => (
          <section
            key={status}
            id={`column-${status.replace(' ', '-')}`}
            className="board-col"
            data-column={status}
            data-over={drag?.over === status || undefined}
            aria-label={status}
          >
            <header className="board-col-head">
              <span>{status}</span>
              <span>{colItems.length}</span>
            </header>
            <div className="board-cards">
              {colItems.map((item) => (
                <BoardCard
                  key={item.id}
                  item={item}
                  context={rowContext(item)}
                  dragging={drag?.item.id === item.id}
                  scroller={scroller}
                  onDrag={setDrag}
                />
              ))}
              {status === 'Submitted' ? (
                <p className="drop-hint">{colItems.length ? 'Leaves the board after 5 seconds' : 'Drop here to submit'}</p>
              ) : (
                !colItems.length && <p className="drop-hint">Nothing here</p>
              )}
            </div>
          </section>
        ))}
      </div>
      {!items.length && <p className="empty-state">Nothing overdue or due in the next 7 days.</p>}
      {drag && (
        <div
          className="board-card drag-ghost"
          style={{ width: drag.width, transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px) rotate(-1.5deg)` }}
          aria-hidden="true"
        >
          <span className="card-name">{drag.item.name}</span>
          <span className="card-meta">{drag.over ? `Move to ${drag.over}` : ' '}</span>
        </div>
      )}
    </section>
  );
}

interface BoardCardProps {
  item: WorkItem;
  context: RowContext;
  dragging: boolean;
  scroller: React.RefObject<HTMLDivElement | null>;
  onDrag: (drag: DragState | null) => void;
}

/** Long-press (touch) or drag (mouse) a card onto another column. */
function BoardCard({ item, context, dragging, scroller, onDrag }: BoardCardProps) {
  const ref = useRef<HTMLElement>(null);
  const active = useRef(false);
  const suppressClick = useRef(false);

  // While dragging on touch, stop the page from scrolling under the finger.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (event: TouchEvent) => {
      if (active.current) event.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.status-pill')) return;
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const touch = event.pointerType !== 'mouse';
    let state: DragState | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let edgeScroll: ReturnType<typeof setInterval> | undefined;

    const columnAt = (x: number, y: number): Status | null => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-column]');
      return (hit?.dataset.column as Status | undefined) ?? null;
    };

    const activate = (x: number, y: number) => {
      active.current = true;
      el.setPointerCapture?.(event.pointerId);
      navigator.vibrate?.(8);
      state = { item, x, y, offsetX: start.x - rect.left, offsetY: start.y - rect.top, width: rect.width, over: item.status };
      onDrag(state);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!active.current) {
        if (touch && distance > 8) cleanup(); // the finger is scrolling, not dragging
        else if (!touch && distance > 5) activate(e.clientX, e.clientY);
        return;
      }
      state = { ...state!, x: e.clientX, y: e.clientY, over: columnAt(e.clientX, e.clientY) };
      onDrag(state);
      // Near the edge of the phone board, scroll to the neighbouring column.
      clearInterval(edgeScroll);
      const box = scroller.current?.getBoundingClientRect();
      if (box && scroller.current!.scrollWidth > box.width + 4) {
        const edge = e.clientX < box.left + 36 ? -1 : e.clientX > box.right - 36 ? 1 : 0;
        if (edge) edgeScroll = setInterval(() => scroller.current?.scrollBy({ left: edge * 8 }), 16);
      }
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      if (active.current && state) {
        suppressClick.current = true;
        const target = columnAt(e.clientX, e.clientY);
        if (target && target !== item.status) changeStatus(item, target);
      }
      cleanup();
    };

    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(edgeScroll);
      active.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cleanup);
      onDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cleanup);
    if (touch) timer = setTimeout(() => activate(start.x, start.y), LONG_PRESS_MS);
  };

  return (
    <article
      ref={ref}
      className="board-card"
      data-status={item.status}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="card-open"
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            return;
          }
          openOverlay({ kind: 'item', id: item.id });
        }}
      >
        <span className="card-name">
          {context.parent && <span className="name-parent">{context.parent.name} › </span>}
          {item.name}
        </span>
        <span className="card-meta">
          {context.course?.code} · {typeLabel(item, context.parent)}
          {context.milestones?.total ? ` · ${context.milestones.done}/${context.milestones.total} milestones` : ''}
        </span>
      </button>
      <div className="card-foot">
        <DueChip item={item} />
        <StatusChip item={item} size="pill" />
      </div>
    </article>
  );
}
