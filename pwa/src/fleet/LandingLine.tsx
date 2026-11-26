// One project's landing line on its card, and its pause control (landing order wave 5k). L4: it draws the view model
// (`landingLineView.ts`) and sends the operator's taps; it decides nothing about the line (the plan's section 4.5).
//
// - `none` draws no block; `line` draws a named region: the title, the status in `role="status"`, the stale sentence when
//   the last read failed, the pause control, and one row per open entry, each with `Withdraw…` (R1). That is also the
//   document order (section 11); the stylesheet places the pause button on the title row, and it is the only control
//   there, so the tab order still follows what is seen.
// - The pause label comes only from the read: a tap shows the busy label, then re-reads; the label changes when a read
//   does (row M8). The button is never disabled while busy, so focus stays on it; a second tap sends nothing.
// - The sheet outlives the block (F1): while a sheet is open it is drawn whatever the state, so a withdrawal of the
//   line's only entry, or a refusal on a line the re-read empties, keeps its sentence until the operator closes it.
// - The re-read on every answer of the withdraw door is this component's act (fix round 1, F1): it stays mounted when
//   the sheet is closed while the call is in flight, so it re-reads once per answer, the sheet open or not.
// - Focus (m7, R6): after `Done` the pause button, else the card; after `Cancel` the row's `Withdraw…`, else the pause
//   button, else the card. When a read removes the control that held focus (the row's `Withdraw…` after a sheet closed
//   mid-flight, or the pause button when the block removes itself) and focus has fallen to the page: the pause button,
//   else the card. Each is moved in an effect, after the sheet primitive has given the focus back to its opener.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button, Chip } from '@ccrc/ui';
import type { LandingPauseAnswer } from '../../../shared/landingLine';
import { api } from '../lib/api';
import type { LandingCardState, LandingLineCard } from './landingLineView';
import {
  LINE_TITLE, PAUSE_NAME, STALE_PREFIX, TAG_FIXES_MAIN, TAG_NO_RUN, WITHDRAW_LABEL, WITHDRAW_VISIBLE, landingFailureOf,
} from './landingWords';
import { LandingWithdrawSheet, type LandingWithdrawer } from './LandingWithdrawSheet';
import './landing-line.css';

export type LandingPauser = (project: string, paused: boolean) => Promise<{ ok: true } & LandingPauseAnswer>;
export interface LandingLineProps {
  /** Absent is a no-op (F12): `ProjectCard.tsx` has no `noop` in scope, so the card passes its optional prop straight on. */
  project: string; state: LandingCardState; onReload?: () => void;
  /** The card's own `<section>`, focused when the block has gone (m7, R6). */
  focusFallback: RefObject<HTMLElement | null>;
  pause?: LandingPauser; withdraw?: LandingWithdrawer;   // default api.landingPause, api.landingWithdraw
}

type OpenSheet = { entryId: number; pr: number };
type Closed = { n: number; after: 'done' | 'cancel'; entryId: number };
const firstInDocument = (els: (HTMLElement | null | undefined)[]): HTMLElement | undefined =>
  els.find((el): el is HTMLElement => el !== null && el !== undefined && el.isConnected);

/** `null` only when the state draws nothing AND no sheet is open (F1). */
export function LandingLine({
  project, state, onReload, focusFallback, pause = api.landingPause, withdraw = api.landingWithdraw,
}: LandingLineProps): ReactNode {
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Closed | null>(null);
  // `LiftCapSheet`'s generation guard: an answer that lands after this component has gone acts on nothing.
  const gen = useRef(0);
  useEffect(() => () => { gen.current += 1; }, []);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<number, HTMLButtonElement>());
  const sectionRef = useRef<HTMLElement>(null);
  /** The control in the block that last held focus, until focus moves to an element outside the block (R6). */
  const lastFocused = useRef<HTMLElement | null>(null);

  // Focus after the sheet closes (m7, R6): after the sheet primitive's own give-back, which a re-read may have removed.
  useEffect(() => {
    if (closed === null) return;
    const order = closed.after === 'done'
      ? [pauseRef.current, focusFallback.current]
      : [rowButtons.current.get(closed.entryId), pauseRef.current, focusFallback.current];
    firstInDocument(order)?.focus({ preventScroll: true });
  }, [closed, focusFallback]);

  // A read removed the control that held focus, no sheet is open, and focus fell to the page (R6; fix round 1, F1): the
  // pause button, else the card.
  useEffect(() => {
    const held = lastFocused.current;
    if (sheet !== null || held === null || held.isConnected) return;
    lastFocused.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    firstInDocument([pauseRef.current, focusFallback.current])?.focus({ preventScroll: true });
  }, [state, sheet, focusFallback]);

  const tapPause = (card: LandingLineCard): void => {
    if (busy) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    pause(project, card.pauseNext).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(false);
        onReload?.();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        setError(landingFailureOf(err, 'pause').text);
        onReload?.();
      },
    );
  };
  const openSheet = (entryId: number, pr: number): void => setSheet({ entryId, pr });
  const closeSheet = (after: 'done' | 'cancel'): void => {
    if (sheet === null) return;
    setClosed((c) => ({ n: (c?.n ?? 0) + 1, after, entryId: sheet.entryId }));
    setSheet(null);
  };
  /** The sheet's call: one re-read per answer, refusal or not, whether the sheet is still open (F1); none once this
   *  component has gone (the generation ref, as for the pause tap). */
  const sheetWithdraw: LandingWithdrawer = (p, pr, pinnedAt) => {
    const mine = gen.current;
    const reread = (): void => { if (gen.current === mine) onReload?.(); };
    return withdraw(p, pr, pinnedAt).then((a) => { reread(); return a; }, (err: unknown) => { reread(); throw err; });
  };

  const block = state.kind === 'line' ? (() => {
    const { card, stale } = state;
    const label = busy ? card.pauseBusyLabel : card.pauseLabel;
    return (
      <section
        ref={sectionRef}
        className="landing-line"
        aria-label={`Landing line of ${project}`}
        onFocus={(e) => { if (e.target instanceof HTMLElement) lastFocused.current = e.target; }}
        onBlur={(e) => {
          // Only a move to an element outside the block forgets the control: a blur to nowhere (the window lost focus,
          // or the control was removed) keeps it, so the effect above can still put focus back.
          const next = e.relatedTarget;
          if (next instanceof Node && !(sectionRef.current?.contains(next) ?? false)) lastFocused.current = null;
        }}
      >
        <p className="landing-line-title">{LINE_TITLE}</p>
        <p className="landing-line-status" role="status" aria-live="polite">{card.statusText}</p>
        {stale !== null && <p className="landing-line-stale">{STALE_PREFIX + stale.text}</p>}
        <Button
          ref={pauseRef}
          className="landing-line-pause"
          variant="quiet"
          size="fit"
          aria-label={PAUSE_NAME(label, project)}
          onClick={() => tapPause(card)}
        >
          {label}
        </Button>
        {error !== null && <p className="landing-line-error" role="alert">{error}</p>}
        {card.rows.length > 0 && (
          <ul className="landing-line-rows">
            {card.rows.map((r) => (
              <li key={r.entryId} className="landing-line-row">
                <span className="landing-line-pr">#{r.pr}</span>
                <span className="landing-line-role">
                  <span>{r.text}</span>
                  {r.fixesMain && <Chip>{TAG_FIXES_MAIN}</Chip>}
                  {r.runless && <Chip>{TAG_NO_RUN}</Chip>}
                </span>
                <Button
                  ref={(el: HTMLButtonElement | null) => { if (el === null) rowButtons.current.delete(r.entryId); else rowButtons.current.set(r.entryId, el); }}
                  className="landing-line-act"
                  variant="danger-ghost"
                  size="fit"
                  aria-label={WITHDRAW_LABEL(r.pr, project)}
                  onClick={() => openSheet(r.entryId, r.pr)}
                >
                  {WITHDRAW_VISIBLE}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  })() : null;

  if (block === null && sheet === null) return null;
  return (
    <>
      {block}
      {sheet !== null && (
        <LandingWithdrawSheet
          project={project}
          view={state.kind === 'line' ? state.view : null}
          entryId={sheet.entryId}
          pr={sheet.pr}
          onClose={closeSheet}
          withdraw={sheetWithdraw}
        />
      )}
    </>
  );
}
