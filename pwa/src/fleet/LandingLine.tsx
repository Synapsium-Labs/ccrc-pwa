// One project's landing line on its card, and its pause control (landing order wave 5k). L4: it draws the view model
// (`landingLineView.ts`) and sends the operator's taps; it decides nothing about the line (the plan's section 4.5).
//
// - `none` draws no block; `line` draws a named region: the title, the status in `role="status"`, the stale sentence when
//   the last read failed, the pause control, and one row per open entry, each with `Withdraw…` (R1).
// - The pause label comes only from the read: a tap shows the busy label, then re-reads; the label changes when a read
//   does (row M8). The button is never disabled while busy, so focus stays on it; a second tap sends nothing.
// - The sheet outlives the block (F1): while a sheet is open it is drawn whatever the state, so a withdrawal of the
//   line's only entry, or a refusal on a line the re-read empties, keeps its sentence until the operator closes it.
// - Focus (m7, R6): after `Done` the pause button, else the card; after `Cancel` the row's `Withdraw…`, else the pause
//   button, else the card. When the block removes itself while focus is inside it (Resume on a line with no entries),
//   the card. Each is moved in an effect, after the sheet primitive has given the focus back to its opener.
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
  /** True while focus is inside the block (R6). */
  const focusInside = useRef(false);
  /** Whether the open sheet's withdrawal was answered, read when it closes. */
  const answered = useRef(false);
  const drawn = state.kind === 'line';

  // Focus after the sheet closes (m7, R6): after the sheet primitive's own give-back, which a re-read may have removed.
  useEffect(() => {
    if (closed === null) return;
    const order = closed.after === 'done'
      ? [pauseRef.current, focusFallback.current]
      : [rowButtons.current.get(closed.entryId), pauseRef.current, focusFallback.current];
    firstInDocument(order)?.focus({ preventScroll: true });
  }, [closed, focusFallback]);

  // The block removed itself while focus was inside it and no sheet is open (R6): focus goes to the card.
  const wasDrawn = useRef(drawn);
  useEffect(() => {
    const active = document.activeElement;
    if (wasDrawn.current && !drawn && sheet === null && focusInside.current && (active === null || active === document.body)) {
      focusFallback.current?.focus({ preventScroll: true });
    }
    if (!drawn) focusInside.current = false;
    wasDrawn.current = drawn;
  }, [drawn, sheet, focusFallback]);

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
  const openSheet = (entryId: number, pr: number): void => {
    answered.current = false;
    setSheet({ entryId, pr });
  };
  const closeSheet = (): void => {
    if (sheet === null) return;
    setClosed((c) => ({ n: (c?.n ?? 0) + 1, after: answered.current ? 'done' : 'cancel', entryId: sheet.entryId }));
    setSheet(null);
  };
  const sheetWithdraw: LandingWithdrawer = (p, pr, pinnedAt) =>
    withdraw(p, pr, pinnedAt).then((a) => { answered.current = true; return a; });

  const block = state.kind === 'line' ? (() => {
    const { card, stale } = state;
    const label = busy ? card.pauseBusyLabel : card.pauseLabel;
    return (
      <section
        ref={sectionRef}
        className="landing-line"
        aria-label={`Landing line of ${project}`}
        onFocus={() => { focusInside.current = true; }}
        onBlur={(e) => {
          const next = e.relatedTarget;
          if (next instanceof Node && !(sectionRef.current?.contains(next) ?? false)) focusInside.current = false;
        }}
      >
        <div className="landing-line-head">
          <p className="landing-line-title">{LINE_TITLE}</p>
          <Button ref={pauseRef} variant="quiet" size="fit" aria-label={PAUSE_NAME(label, project)} onClick={() => tapPause(card)}>
            {label}
          </Button>
        </div>
        <p className="landing-line-status" role="status" aria-live="polite">{card.statusText}</p>
        {stale !== null && <p className="landing-line-stale">{STALE_PREFIX + stale.text}</p>}
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
          onReload={() => onReload?.()}
          withdraw={sheetWithdraw}
        />
      )}
    </>
  );
}
