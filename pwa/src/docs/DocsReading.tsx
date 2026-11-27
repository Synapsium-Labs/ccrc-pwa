// The Docs reading container (native Docs reader, reader-mode plan Task XR1.2 as amended 2026-11-24, D-8975; spec 2026-11-20
// sections 4.1 and 6.5). Ring L4 delivery. It wraps the Docs screen's body on EVERY Docs page and in every view, with no React key
// on the path from the screen to the reader host, so adding it remounts nothing and reader mode never re-parents the frame.
// In the normal view it is `display: contents` (docs.css): no box, no z-index, transform or clip.
//
// It holds, in order: the leading focus guard, the body, `div.docs-reading-controls` (ccrc's overlay draws there, only while
// reader mode is on and its state says the overlay is shown: `ReaderModeOverlay`, X6 XR2.1; and, while reader mode is on with no frame
// standing, the Exit alone: `ReaderModeExitOnly`, as `readerModeExitShown` says), the trailing focus guard, the polite
// live region (inside the container, so the console's hiding never silences it) and `div.docs-reading-portal`, which it hands to
// every `Sheet` under the body as its portal target (`SheetPortalContext`), so a sheet is drawn inside the element that goes full
// screen, in both views, and is never moved as reader mode starts or ends.
// The guards are `tabindex` 0 while reader mode is on and -1 otherwise: focus on the leading one is decided by the state, not by
// searching the DOM: while the overlay is shown it goes to the overlay's last control, and while it is hidden into the frame;
// focus on the trailing one goes into the frame.
import { useContext, useRef, useState, type ReactNode } from 'react';
import { SheetPortalContext } from '@ccrc/ui';
import { ReaderModeExitOnly, ReaderModeOverlay, type ReaderModeOverlayHandle } from './ReaderModeOverlay';
import { readerModeExitShown, readerModeGuardTarget } from './reader/readerMode';
import { ReaderModeContext, type ReaderModeContainer } from './useReaderMode';

/** One focus guard of the reading container's wrap (spec §6.5): in the tab order only while reader mode is on, and moving the focus
 *  on as `onFocus` says. The two guards are this one element. */
function FocusGuard(p: { tabIndex: number; onFocus: () => void }): ReactNode {
  return <span className="docs-reading-guard" tabIndex={p.tabIndex} onFocus={p.onFocus} />;
}

export function DocsReading(p: { reading: ReaderModeContainer; children: ReactNode }): ReactNode {
  const { reading } = p;
  const ctx = useContext(ReaderModeContext);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const overlay = useRef<ReaderModeOverlayHandle>(null);
  const tabIndex = reading.on ? 0 : -1;
  // What the state says: the overlay is drawn only while reader mode is on, it is shown, and a frame stands to give its title.
  const shown = ctx !== null && ctx.state.on && ctx.state.overlay && ctx.frame !== null ? ctx.frame : null;
  // With reader mode on and no frame standing (the leaf is changing or failed), the Exit alone is drawn with no tap (X6 XR fix
  // round 1): `readerModeExitShown` decides, and no phone has a key or a browser Back to leave with.
  const exitOnly = ctx !== null && readerModeExitShown({ on: ctx.state.on, frameStands: ctx.frame !== null });
  /** A guard was reached: `readerModeGuardTarget` says where focus goes, this only does it. */
  const onGuard = (guard: 'leading' | 'trailing'): void => {
    const target = readerModeGuardTarget({
      on: reading.on, frameStands: ctx === null || ctx.frame !== null, overlayShown: shown !== null, guard,
    });
    if (target === 'overlay-last' || target === 'exit-only') overlay.current?.focusLast();
    else if (target === 'frame') reading.focusFrame();
  };
  return (
    <div className="docs-reading" ref={reading.setContainer} data-reader-mode={reading.how}>
      <FocusGuard tabIndex={tabIndex} onFocus={() => onGuard('leading')} />
      <SheetPortalContext value={portal}>{p.children}</SheetPortalContext>
      <div className="docs-reading-controls">
        {ctx !== null && shown !== null && (
          <ReaderModeOverlay
            ref={overlay} title={shown.title} progress={shown.progress}
            onExit={() => ctx.exit('exit-tap')} onAa={ctx.aa} onDismiss={ctx.dismiss} onEsc={ctx.escOverlay} onActivity={ctx.activity}
            turn={ctx.turn} onTurn={ctx.setTurn}
            {...(shown.readingMinutes === undefined ? {} : { readingMinutes: shown.readingMinutes })}
          />
        )}
        {ctx !== null && exitOnly && <ReaderModeExitOnly ref={overlay} onExit={() => ctx.exit('exit-tap')} onActivity={ctx.activity} />}
      </div>
      <FocusGuard tabIndex={tabIndex} onFocus={() => onGuard('trailing')} />
      <p className="docs-reading-live sr-only" aria-live="polite">{reading.live}</p>
      <div className="docs-reading-portal" ref={setPortal} />
    </div>
  );
}
