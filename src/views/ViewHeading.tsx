import type { ReactNode } from 'react';

export function ViewHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="view-title">{title}</h1>
      </div>
      {children}
    </div>
  );
}
