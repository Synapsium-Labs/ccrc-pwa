// THE ONE CONTAINER of every ask surface, chosen by WIDTH (D-6326, plan docs/superpowers/plans/2026-10-22-desktop-polish.md,
// Task T1c; D-6325 made it one container for every kind of surface, this makes it two for the two kinds of screen).
//
//  - Below 900 (a phone, a narrow window): T1b's `Sheet`, unchanged: the drawer, its scrim and its dismissal.
//  - At the desk and `open`: an INLINE CARD in the session pane, a `<section data-ask-surface="inline">` that
//    `SessionScreen` seats between the transcript and the strips. It covers nothing and blocks nothing, so it has no ✕,
//    no scrim and no portal, and its Escape does nothing at all (`escapeStaysInCard`). At the desk and not `open`: nothing.
//
// EXACTLY ONE CONTAINER IS MOUNTED AT ANY WIDTH, by `useDesk()` (the one spelling of the width, never a media-query
// literal here: `sheet-desktop-arm.test.tsx`). A crossing of 900 swaps the container and keeps `DialogSheet`'s state,
// which is the controller's, not this file's.
//
// The card says what it is to its content through `AskContainer`: `TerminalCta` drops "Not now" inline, since a card
// that covers nothing has nothing to put off.
//
// `onInline` reports whether the card is mounted, in a layout effect that lives exactly as long as the `<section>`, so
// `SessionScreen` can stop the transcript's card pointing at it (`askBelow`), stand the Escape interrupt down and hold
// the composer's Send while a question is up, all from one fact. `raise` is a nonce (0 inert, as `DialogSheet`'s own):
// at the desk a change to a non-zero value scrolls the card into view and focuses its first option.
import { createContext, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { EYEBROW, Sheet, useDesk } from '@ccrc/ui';
import { escapeHidesOnly, escapeStaysInCard } from './AskParts';
import './chat.css';

/** Which container the content is drawn in: read by the parts whose copy depends on it (`TerminalCta`'s dismissal). */
export type AskContainerKind = 'sheet' | 'inline';
export const AskContainer = createContext<AskContainerKind>('sheet');

export interface AskSurfaceProps {
  open: boolean;
  onClose: () => void;
  eyebrow: ReactNode;
  title: string;
  /** A nonce (D-286): a change to a non-zero value raises the inline card. `0`, or absent, is inert. */
  raise?: number;
  /** Told `true` while the inline card is mounted and `false` when it leaves (or never was): a phone's sheet reports nothing. */
  onInline?: (mounted: boolean) => void;
  children: ReactNode;
}

export function AskSurface({ open, onClose, eyebrow, title, raise = 0, onInline, children }: AskSurfaceProps): ReactNode {
  const desk = useDesk();
  if (!desk) {
    return (
      <AskContainer.Provider value="sheet">
        <Sheet open={open} onClose={onClose} onEscapeKeyDown={escapeHidesOnly} eyebrow={eyebrow} title={title} titleScroll={false}>
          {children}
        </Sheet>
      </AskContainer.Provider>
    );
  }
  if (!open) return null;
  return (
    <AskContainer.Provider value="inline">
      <InlineCard eyebrow={eyebrow} title={title} raise={raise} onInline={onInline}>
        {children}
      </InlineCard>
    </AskContainer.Provider>
  );
}

/** The inline card: the header (T1b's `AskHeader`, passed as the eyebrow), then ONE scroller holding the title and the
 *  surface, so a long question and its options scroll as one and a short one has no scrollbar. `aria-labelledby` names
 *  it by the question; `tabIndex={-1}` lets a click on its text put focus inside, which is what makes its keys act. */
function InlineCard({ eyebrow, title, raise, onInline, children }: Omit<AskSurfaceProps, 'open' | 'onClose'> & { raise: number }): ReactNode {
  const titleId = useId();
  const section = useRef<HTMLElement | null>(null);

  // Mounted exactly while the section is: the cleanup runs when the card leaves (the ask ended, or the width crossed).
  useLayoutEffect(() => {
    onInline?.(true);
    return () => onInline?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A raise is a CHANGE to a non-zero value after the card is up: a card that mounts under a standing nonce (the ask
  // arriving after an earlier raise) takes no focus, as an arriving ask never does.
  const seen = useRef(raise);
  useEffect(() => {
    if (raise === 0 || raise === seen.current) return;
    seen.current = raise;
    const card = section.current;
    if (card === null) return;
    // jsdom has no `scrollIntoView`; a browser always has.
    card.scrollIntoView?.({ block: 'nearest' });
    const first = card.querySelector<HTMLElement>('.opt[tabindex="0"]')
      ?? card.querySelector<HTMLElement>('.opt:not(:disabled):not([aria-disabled="true"])')
      ?? card;
    first.focus({ preventScroll: true });
  }, [raise]);

  return (
    <section
      ref={section}
      data-ask-surface="inline"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="ask-inline"
      onKeyDown={escapeStaysInCard}
    >
      <p className={`ask-inline-eyebrow ${EYEBROW}`}>{eyebrow}</p>
      <div className="ask-inline-body">
        <h2 id={titleId} className="ask-inline-title">{title}</h2>
        {children}
      </div>
    </section>
  );
}
