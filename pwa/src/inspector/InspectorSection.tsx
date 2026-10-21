// One inspector section's frame (W2 Task S8, D-5474): a labelled region with its heading, so every section reads as a
// landmark-free group a screen reader can jump between by heading, in both skins.
import { useId } from 'react';
import type { ReactNode } from 'react';

export function InspectorSection({ id, title, children }: { id: string; title: string; children?: ReactNode }): ReactNode {
  const headingId = useId();
  return (
    <section className="insp-section" data-section={id} aria-labelledby={headingId}>
      <h2 id={headingId} className="insp-heading">{title}</h2>
      {children}
    </section>
  );
}
