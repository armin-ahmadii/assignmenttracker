import { useEffect, useRef, type ReactNode } from 'react';
import { closeOverlay } from './nav';

interface SheetProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider dialog on laptop, near full height on phone. */
  size?: 'compact' | 'large';
  onClose?: () => void;
  /** Rendered in the header in place of the title (e.g. an editable name). */
  header?: ReactNode;
  className?: string;
}

/** Open layers, bottom to top; only the top one answers Escape. */
const layers: object[] = [];

export function useTopLayerEscape(onEscape: () => void) {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    const me = {};
    layers.push(me);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && layers[layers.length - 1] === me) {
        event.preventDefault();
        handler.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      layers.splice(layers.indexOf(me), 1);
    };
  }, []);
}

/** Centered dialog on laptop, bottom sheet on phone (styles in index.css). */
export function Sheet({ title, eyebrow, children, footer, size = 'compact', onClose = closeOverlay, header, className = '' }: SheetProps) {
  useTopLayerEscape(onClose);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className={`sheet sheet-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          {header ?? (
            <div>
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2>{title}</h2>
            </div>
          )}
          <button type="button" className="action close-button" onClick={onClose} aria-label={`Close ${title}`}>
            <span>Close</span>
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </section>
    </div>
  );
}
