import { useSyncExternalStore } from 'react';
import { useTopLayerEscape } from './Sheet';

interface Request {
  title: string;
  body?: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

let current: Request | null = null;
const listeners = new Set<() => void>();

function set(next: Request | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** Promise-based confirmation, used for destructive actions. */
export function confirmAction(options: { title: string; body?: string; confirmLabel?: string }): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => set({ confirmLabel: 'Delete', ...options, resolve }));
}

export function ConfirmHost() {
  const request = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!request) return null;
  return <ConfirmDialog request={request} />;
}

function ConfirmDialog({ request }: { request: Request }) {
  const answer = (ok: boolean) => {
    set(null);
    request.resolve(ok);
  };
  useTopLayerEscape(() => answer(false));

  return (
    <div className="modal-layer confirm-layer" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <section className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{request.title}</h2>
        {request.body && <p>{request.body}</p>}
        <div className="confirm-actions">
          <button type="button" className="action secondary-button" onClick={() => answer(false)} autoFocus>
            Cancel
          </button>
          <button type="button" className="action danger-button" onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
