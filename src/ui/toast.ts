import { useSyncExternalStore } from 'react';
import type { Status, WorkItem } from '../domain/types';
import { setStatus, updateItem } from '../data/actions';

export const UNDO_MS = 5000;

export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
  /** Runs once when the toast goes away, whether by timeout, undo or being replaced. */
  onClose?: () => void;
}

interface ToastState {
  toast: Toast | null;
  /** Items just submitted: they stay on active screens until their undo window closes. */
  lingering: ReadonlySet<string>;
}

let state: ToastState = { toast: null, lingering: new Set() };
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const listeners = new Set<() => void>();

function set(patch: Partial<ToastState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useToastState(): ToastState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function showToast(toast: Omit<Toast, 'id'>) {
  dismissToast();
  const id = nextId++;
  set({ toast: { ...toast, id } });
  timer = setTimeout(() => dismissToast(id), UNDO_MS);
}

export function dismissToast(id?: number) {
  const current = state.toast;
  if (!current || (id != null && current.id !== id)) return;
  clearTimeout(timer);
  set({ toast: null });
  current.onClose?.();
}

export function undoToast() {
  const current = state.toast;
  if (!current?.undo) return;
  current.undo();
  dismissToast(current.id);
}

function linger(id: string, on: boolean) {
  const next = new Set(state.lingering);
  if (on) next.add(id);
  else next.delete(id);
  set({ lingering: next });
}

/** Every status change goes through here so it always gets its 5-second undo. */
export function changeStatus(item: WorkItem, status: Status) {
  const previous = setStatus(item.id, status);
  if (!previous) return;
  // Close the previous toast first: its onClose may end a linger for this same item.
  dismissToast();
  if (status === 'Submitted') linger(item.id, true);
  showToast({
    message: status === 'Submitted' ? `Submitted “${item.name}”` : `“${item.name}” → ${status}`,
    undo: () => updateItem(item.id, previous),
    onClose: () => linger(item.id, false),
  });
}
