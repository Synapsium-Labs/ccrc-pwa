// The Docs reading container (native Docs reader, reader-mode plan Task XR1.2 as amended 2026-11-24, D-8975; spec 2026-11-20
// sections 4.1 and 6.5). Ring L4 delivery. It wraps the Docs screen's body on EVERY Docs page and in every view, with no React key
// on the path from the screen to the reader host, so adding it remounts nothing and reader mode never re-parents the frame.
// In the normal view it is `display: contents` (docs.css): no box, no z-index, transform or clip.
//
// It holds, in order: the leading focus guard, the body, `div.docs-reading-controls` (ccrc's overlay controls draw there, a later
// task), the trailing focus guard, the polite live region (inside the container, so the console's hiding never silences it) and
// `div.docs-reading-portal`, which it hands to every `Sheet` under the body as its portal target (`SheetPortalContext`), so a
// sheet is drawn inside the element that goes full screen, in both views, and is never moved as reader mode starts or ends.
// The guards are `tabindex` 0 while reader mode is on and -1 otherwise: focus on the leading one wraps to the last ccrc control
// (or, with none drawn, into the frame), focus on the trailing one goes into the frame.
import { useRef, useState, type ReactNode } from 'react';
import { SheetPortalContext } from '@ccrc/ui';
import type { ReaderModeContainer } from './useReaderMode';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DocsReading(p: { reading: ReaderModeContainer; children: ReactNode }): ReactNode {
  const { reading } = p;
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const controls = useRef<HTMLDivElement>(null);
  const tabIndex = reading.on ? 0 : -1;
  const onLeadingGuard = (): void => {
    if (!reading.on) return;
    const found = controls.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const last = found !== undefined && found.length > 0 ? found[found.length - 1] : undefined;
    if (last !== undefined) last.focus();
    else reading.focusFrame();
  };
  const onTrailingGuard = (): void => {
    if (reading.on) reading.focusFrame();
  };
  return (
    <div className="docs-reading" ref={reading.setContainer} data-reader-mode={reading.how}>
      <span className="docs-reading-guard" tabIndex={tabIndex} onFocus={onLeadingGuard} />
      <SheetPortalContext value={portal}>{p.children}</SheetPortalContext>
      <div className="docs-reading-controls" ref={controls} />
      <span className="docs-reading-guard" tabIndex={tabIndex} onFocus={onTrailingGuard} />
      <p className="docs-reading-live sr-only" aria-live="polite">{reading.live}</p>
      <div className="docs-reading-portal" ref={setPortal} />
    </div>
  );
}
