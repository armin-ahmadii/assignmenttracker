import { useEffect, useSyncExternalStore } from 'react';
import { runRecurring } from './data/actions';
import { useAuth } from './data/auth';
import { useStore } from './data/store';
import { Icon } from './ui/Icon';
import { ClockProvider, useClock } from './ui/clock';
import { ConfirmHost } from './ui/confirm';
import { VIEWS, goTo, openOverlay, useNav, type Overlay, type ViewId } from './ui/nav';
import { undoToast, useToastState } from './ui/toast';
import { BoardView } from './views/BoardView';
import { ByCourseView } from './views/ByCourseView';
import { CalendarView } from './views/CalendarView';
import { CourseEditor, CoursesSheet } from './views/CoursesSheet';
import { CoursesPanel, CoursesStrip } from './views/CoursesPanel';
import { DoneView } from './views/DoneView';
import { ExamsView } from './views/ExamsView';
import { ItemDetail } from './views/ItemDetail';
import { NewTermSheet } from './views/NewTermSheet';
import { NowView } from './views/NowView';
import { QuickAdd } from './views/QuickAdd';
import { SearchSheet } from './views/SearchSheet';
import { SettingsSheet } from './views/SettingsSheet';
import { SignIn } from './views/SignIn';

export function App() {
  const auth = useAuth();
  const { ready } = useStore();
  if (!ready || auth.status === 'checking') return <div className="boot" aria-busy="true" />;
  if (auth.status === 'signed-out') return <SignIn />;
  return (
    <ClockProvider>
      <Shell />
    </ClockProvider>
  );
}

const VIEW_COMPONENTS: Record<ViewId, () => React.JSX.Element> = {
  now: NowView,
  board: BoardView,
  calendar: CalendarView,
  'by-course': ByCourseView,
  exams: ExamsView,
  done: DoneView,
};

/**
 * Focus a hidden input inside the tap itself, so iOS raises the keyboard;
 * the quick-add Name field then takes focus from it once the sheet renders.
 */
export function openQuickAdd() {
  document.getElementById('focus-sink')?.focus({ preventScroll: true });
  openOverlay({ kind: 'add' });
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('online', l);
      window.addEventListener('offline', l);
      return () => {
        window.removeEventListener('online', l);
        window.removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
  );
}

function Shell() {
  const { view, overlays } = useNav();
  const { now } = useClock();
  const online = useOnline();
  const View = VIEW_COMPONENTS[view];

  // Recurring labs appear on schedule while the app is open.
  useEffect(() => runRecurring(now), [now]);

  // Laptop shortcuts: N adds, / searches.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (overlays.length || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'n' || event.key === '+') {
        event.preventDefault();
        openOverlay({ kind: 'add' });
      } else if (event.key === '/') {
        event.preventDefault();
        openOverlay({ kind: 'search' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlays.length]);

  return (
    <div className="app-shell">
      <input id="focus-sink" className="focus-sink" aria-hidden="true" tabIndex={-1} />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">d</span>
          <span>Due</span>
          {!online && (
            <span className="offline-pill" title="Changes are saved on this device and sync when you're back online">
              <Icon name="offline" /> Offline
            </span>
          )}
        </div>
        <Tabs view={view} />
        <div className="top-actions">
          <button type="button" className="action icon-button" aria-label="Search" onClick={() => openOverlay({ kind: 'search' })}>
            <Icon name="search" />
          </button>
          <button type="button" className="action icon-button" aria-label="Settings" onClick={() => openOverlay({ kind: 'settings' })}>
            <Icon name="settings" />
          </button>
          <button type="button" className="action add-button" onClick={openQuickAdd}>
            <Icon name="plus" />
            <span>Add work</span>
          </button>
        </div>
      </header>

      <div className="mobile-tabs">
        <Tabs view={view} />
      </div>

      <main className="workspace" data-view={view}>
        <div className="main-panel">
          <View />
        </div>
        <CoursesPanel />
      </main>

      {view === 'now' && <CoursesStrip />}

      <button type="button" className="action mobile-fab" aria-label="Add work" onClick={openQuickAdd}>
        <Icon name="plus" />
      </button>

      {overlays.map((overlay, index) => (
        <div className="overlay-slot" key={index} hidden={index < overlays.length - 1}>
          <OverlayView overlay={overlay} />
        </div>
      ))}
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}

function Tabs({ view }: { view: ViewId }) {
  return (
    <nav className="tabs" aria-label="Views">
      {VIEWS.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={`tab ${tab.id === view ? 'active' : ''}`}
          aria-current={tab.id === view ? 'page' : undefined}
          onClick={() => {
            goTo(tab.id);
            window.scrollTo({ top: 0 });
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function OverlayView({ overlay }: { overlay: Overlay }) {
  switch (overlay.kind) {
    case 'add':
      return <QuickAdd parentId={overlay.parentId} />;
    case 'item':
      return <ItemDetail id={overlay.id} />;
    case 'search':
      return <SearchSheet />;
    case 'settings':
      return <SettingsSheet />;
    case 'courses':
      return <CoursesSheet />;
    case 'course':
      return <CourseEditor key={overlay.id ?? 'new'} id={overlay.id} />;
    case 'new-term':
      return <NewTermSheet />;
  }
}

function ToastHost() {
  const { toast } = useToastState();
  return (
    <div className="toast-region" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="action toast-undo" onClick={undoToast}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
