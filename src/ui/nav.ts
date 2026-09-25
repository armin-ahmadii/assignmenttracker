import { useSyncExternalStore } from 'react';

export const VIEWS = [
  { id: 'now', label: 'Now' },
  { id: 'board', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'by-course', label: 'By course' },
  { id: 'exams', label: 'Exams' },
  { id: 'done', label: 'Done' },
] as const;

export type ViewId = (typeof VIEWS)[number]['id'];

export type Overlay =
  | { kind: 'add'; parentId?: string }
  | { kind: 'item'; id: string }
  | { kind: 'search' }
  | { kind: 'settings' }
  | { kind: 'courses' }
  | { kind: 'course'; id: string | null }
  | { kind: 'new-term' };

interface NavState {
  view: ViewId;
  overlays: Overlay[];
}

function viewFromHash(): ViewId {
  const id = window.location.hash.replace(/^#\/?/, '');
  return VIEWS.some((v) => v.id === id) ? (id as ViewId) : 'now';
}

let state: NavState = { view: 'now', overlays: [] };
const listeners = new Set<() => void>();

function set(next: NavState) {
  state = next;
  for (const listener of listeners) listener();
}

export function useNav(): NavState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/**
 * Tabs replace the history entry (Back never walks through tabs); each sheet
 * pushes one, so the phone's Back gesture closes the top sheet.
 */
export function initNav() {
  // The installed app always opens on Now; deep links to a tab still work in a browser tab.
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const view = standalone ? 'now' : viewFromHash();
  window.history.replaceState({ depth: 0 }, '', `#/${view}`);
  state = { view, overlays: [] };
  window.addEventListener('popstate', (event) => {
    const depth = (event.state as { depth?: number } | null)?.depth ?? 0;
    set({ view: viewFromHash(), overlays: state.overlays.slice(0, depth) });
  });
}

export function goTo(view: ViewId) {
  window.history.replaceState(window.history.state, '', `#/${view}`);
  set({ ...state, view });
}

export function openOverlay(overlay: Overlay) {
  const overlays = [...state.overlays, overlay];
  window.history.pushState({ depth: overlays.length }, '', window.location.hash);
  set({ ...state, overlays });
}

/** Swap the top sheet for another without growing history (e.g. search result → item). */
export function replaceOverlay(overlay: Overlay) {
  if (!state.overlays.length) return openOverlay(overlay);
  set({ ...state, overlays: [...state.overlays.slice(0, -1), overlay] });
}

export function closeOverlay() {
  if (state.overlays.length) window.history.back();
}

export function closeAllOverlays() {
  const n = state.overlays.length;
  if (n) window.history.go(-n);
}
