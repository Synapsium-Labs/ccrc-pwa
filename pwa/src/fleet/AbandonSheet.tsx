// The abandon sheet — the run board's release valve for a wedged run (spec
// §4.3, Task 12). Two taps: the row's own `.run-abandon` control (D-287 (was D-B4-14),
// RunsScreen.tsx) opens this sheet, and THIS sheet's own confirm button is
// the second tap that actually sends `POST /api/runs/:id/abandon`.
//
// On `Sheet`, not `QuickConfirm` (brief, Step 3): `QuickConfirm`'s confirm
// button runs `onConfirm(); onClose();` unconditionally
// (`components/QuickConfirm.tsx:33-34`) — it closes on every tap, win or
// lose. An abandon can be REFUSED (409 bad-transition, 404, 501, 502) and
// each refusal needs its own sentence rendered IN the sheet, which stays
// open so the operator can read it and retry — the exact shape
// `QuickConfirm`'s close-on-confirm forbids.
//
// "The phone can abandon; the phone can never archive" (spec §4.3, global
// constraint): the route this sheet calls (`api.abandonRun`) takes no body
// at all, so there is structurally no field here that could carry an
// archive flag even by accident — and this sheet offers no archive control
// of any kind, anywhere, which is a negative pin (`abandon-sheet.test.tsx`).
//
// "A release destroys nothing" (spec §4.3) — for a workspace that is not a
// child: the worktree survives, the record stays, so the two-tap confirm
// naming the run and its workspace IS the whole ceremony here, not a
// truncated one (unlike the reap flow's audit -> confirmed-destroy ceremony,
// `ReapSheet.tsx`). A CHILD's abandon is a finished close (child-reclamation
// spec §5.7): the close, or the server's sweep once nothing keeps the child,
// hands it to the reclaim, which pins its work in the attic and then removes
// it. The sheet cannot know before the tap what will keep it, so
// `abandonConsequence` says what happens WHEN nothing does and never that it
// will; it branches on the workspace's child mark, read only through
// `childMarkOf` (`runWords.ts`), by `abandonChildOf`. The abandon door is
// ungated against the box token (D-282; the route's UNGATED note,
// `server/src/coord/routes.ts`); its reaching that destructive act is inside
// the single-user trust model: recorded, not changed.
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { isRunState, type FleetSession, type RunSummary } from '../../../shared/api';
import { RUN_WORD, childMarkOf, coordinatorGoneOf, runRowName, runWaitLine } from './runWords';
import { CLOSE_RUN_REASONS } from './closeWords';
import { CLOSE_REASON_MAX, type ItemActBody } from '../../../shared/ledgers';
import type { PlanEndOutcome } from '../../../shared/plan';
import type { CoordinatorPresence } from './presence';
import { inAppClick } from './settingsText';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, RadioFieldset, Sheet, TextInput, cn, toast } from '@ccrc/ui';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { ApiError, COORD_UNSUPPORTED_TEXT, UNKNOWN_RUN_TEXT, api, isRegistryUnmeasurable, type ReadOpts } from '../lib/api';
import { LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import { navigate } from '../lib/router';
import { runPath } from '../lib/routes';
import './fleet.css';

/** The refusal vocabulary this sheet renders its OWN sentence for. A total
 *  `Record`, per the brief's own interface — `unknown` is the designated
 *  catch-all for a refusal this build has never heard of (a `RunRefuseCode`
 *  under `refused`, or any other shape), the same "never a blank cell"
 *  discipline `runWords.ts`'s own `RUN_WORD.unknown` already uses one file
 *  over. Deliberately NOT keyed on every `RunRefuseCode` member: D-274 (was D-B4-1) and D-275 (was D-B4-2)
 *  make `not-dispatched`, `prhistory-unreadable` and the five `verifyDone`
 *  codes structurally unreachable on THIS route (pinned server-side,
 *  `coord-abandon.test.ts`) — adding members for them here would be
 *  copy-pasting a vocabulary this route can never actually speak. The one
 *  exception is `registry-unmeasurable` (D-5971): the abandon route's close
 *  outcome does not send it today, but it is the shared fleet-read refusal,
 *  so the sheet names it defensively instead of calling it a failed release. */
export const ABANDON_COPY: Record<
  'unknown-run' | 'bad-transition' | 'unsupported' | 'fleet-failed' | 'registry-unmeasurable' | 'unknown',
  string
> = {
  'unknown-run': UNKNOWN_RUN_TEXT,
  'bad-transition': 'This run already closed',
  // Review, M2: this used to be a byte-identical literal of `CoordBanner`'s
  // own 501 arm. One box, one skew, one sentence — see the constant's own
  // docstring (`lib/api.ts`) for why it lives there and not in either
  // component.
  unsupported: COORD_UNSUPPORTED_TEXT,
  'fleet-failed': 'The release failed.',
  // D-5971: the box could not read the registry, so it could not look — not a release that failed.
  'registry-unmeasurable': 'the registry could not be read, so the box could not finish the abandon — try again',
  unknown: 'the abandon was refused, for a reason this build does not recognise',
};

/** `err` -> the sentence to render inline in the sheet. Same status-first
 *  dispatch as `CoordBanner.tsx`'s own `inlinePauseError` (Task 11) — 404,
 *  409, 501, 502 each get their OWN read of `err.body`, never a single
 *  generic "request failed". Unlike that banner, every branch here returns a
 *  string (never `null`): this sheet has no ordinary-toast fallback to defer
 *  to — a failed abandon has nowhere else to be said. */
export function abandonErrorText(err: unknown): AbandonError {
  const said = abandonSentence(err);
  // "This run already closed." comes with a door to the record (spec 9.1): the close is the proof.
  const closed = err instanceof ApiError && err.status === 409 && said.startsWith(ABANDON_COPY['bad-transition']);
  if (err instanceof ApiError && err.status === 502 && !isRegistryUnmeasurable(err)) {
    const stderr = typeof err.body === 'object' && err.body !== null ? (err.body as { stderr?: unknown }).stderr : undefined;
    // The release failed, then the server's own words (spec 9.1).
    if (typeof stderr === 'string' && stderr.trim().length > 0) return { lead: ABANDON_COPY['fleet-failed'], text: stderr.trim(), record: false };
  }
  return { lead: null, text: closed ? `${said}.` : said, record: closed };
}

/** The two refusals `POST /api/items/:id/act` adds to the abandon route's own: the item moved or is gone. The arm's refusals
 *  after them are the route's, read by `abandonErrorText`. */
const ITEM_ACT_REFUSAL_TEXT: Readonly<Record<'not-open' | 'unknown-item', string>> = {
  'not-open': LEDGER_REFUSAL_TEXT['not-open'],
  'unknown-item': LEDGER_REFUSAL_TEXT['unknown-item'],
};

/** `abandonErrorText` for a confirm that went through an item's act: the item's own two refusals first. */
function itemActErrorText(err: unknown): AbandonError {
  const said = refusalText(err, ITEM_ACT_REFUSAL_TEXT);
  return said === null ? abandonErrorText(err) : { lead: null, text: said, record: false };
}

/** What the sheet says under a refusal: an optional lead sentence, the text, and whether a link to the record follows. */
export interface AbandonError { readonly lead: string | null; readonly text: string; readonly record: boolean }

function abandonSentence(err: unknown): string {
  if (!(err instanceof ApiError)) return ABANDON_COPY.unknown;
  // D-5971: the word, at any status. ccd's stderr, when it came too, is the more specific fact.
  if (isRegistryUnmeasurable(err)) {
    const stderr = (err.body as { stderr?: unknown }).stderr;
    return typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : ABANDON_COPY['registry-unmeasurable'];
  }
  if (err.status === 404) return ABANDON_COPY['unknown-run'];
  if (err.status === 409) {
    const body = err.body;
    const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
    if (code === 'bad-transition') {
      // `from` is the state the run was ALREADY in — the fact that makes
      // "this run already closed" a measurement rather than a guess. A
      // hardcoded "it was already done" would pass every test that only
      // ever sent `from: 'done'`; reading it back off the body is what a
      // `from: 'failed'` case actually exercises.
      const from = typeof body === 'object' && body !== null ? (body as { from?: unknown }).from : undefined;
      const word = isRunState(from) ? RUN_WORD[from] : null;
      return word === null ? ABANDON_COPY['bad-transition'] : `${ABANDON_COPY['bad-transition']} — it was already ${word}`;
    }
    // Review fix round 1, Minor 4: `sendCloseOutcome`'s `advanceFailed` arm
    // (`server/src/coord/routes.ts:141`) forwards `AdvanceResult`'s failure
    // VERBATIM, and one of its two members is `{ok:false, error:'unknown-run'}`
    // at 409 (not 404) — reachable if the run vanishes between
    // `coord.run(id)` and the transaction commit. Without this branch that
    // landed on the total map's `unknown` catch-all ("a reason this build
    // does not recognise") instead of the accurate, already-defined sentence.
    if (code === 'unknown-run') return ABANDON_COPY['unknown-run'];
    // A `409 {refused: RunRefuseCode}` shape — structurally unreachable on
    // this route today (see ABANDON_COPY's own docstring), but the client
    // does not get to assume the server can never send it; `unknown` is the
    // total map's designated answer for a refusal this build has never
    // heard of, not a crash and not a blank sheet.
    return ABANDON_COPY.unknown;
  }
  if (err.status === 501) return ABANDON_COPY.unsupported;
  if (err.status === 502) {
    // ccd's own stderr, verbatim — more specific than anything this sheet
    // could say, the same priority `apiErrorText` (`lib/api.ts`) already
    // gives it for every other lifecycle route.
    const stderr = typeof err.body === 'object' && err.body !== null
      ? (err.body as { stderr?: unknown }).stderr
      : undefined;
    return typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : ABANDON_COPY['fleet-failed'];
  }
  // 400 `hold-invalid` and 413 `hold-oversize` carry the server's `detail`, which names the surviving run's hold and is
  // shown in full (F23). A body with no `detail` falls to the catch-all.
  if (err.status === 400 || err.status === 413) {
    const detail = typeof err.body === 'object' && err.body !== null ? (err.body as { detail?: unknown }).detail : undefined;
    if (typeof detail === 'string' && detail.trim().length > 0) return detail;
  }
  // 400 bad-request (non-integer id) is not reachable from the UI (the phone
  // always has a real run id) and falls to the same total catch-all.
  //
  // `hold-oversize` (413) and `hold-invalid` (400) ARE reachable here now — the
  // abandon path re-holds a surviving sibling, and that hold is validated — so
  // "anything else this route has never sent" stopped being true. They
  // deliberately keep the catch-all rather than gaining copy: both mean the
  // SURVIVING run's stored programme or numbers cannot be written as a hold,
  // which is an operator-side repair on a row this sheet is not abandoning and
  // cannot name, and the one action this sheet offers (abandon THIS run) is not
  // the remedy for either. The generic sentence sends the operator to the
  // server's own `detail`, which does name it.
  return ABANDON_COPY.unknown;
}

/** Which consequence the confirm line states: the sheet's own three-way answer about
 *  the run's workspace. A run with no session is decided on `run.sessionId` alone. */
export type AbandonChild = 'child' | 'not-child' | 'unknown';

/** The fleet row -> the confirm line's case. `undefined` means no fleet row for this
 *  session (no frame yet, or the registry does not list it): the board cannot tell,
 *  so the line hedges. Reads the mark ONLY through `childMarkOf`. */
export function abandonChildOf(session: FleetSession | undefined): AbandonChild {
  if (session === undefined) return 'unknown';
  const mark = childMarkOf(session);
  if (mark.kind === 'child') return 'child';
  if (mark.kind === 'none') return 'not-child';
  return 'unknown';
}

/** What the sheet calls the run's workspace (spec 9.1, A44): the recorded workspace, or a branch as "the workspace on <branch>",
 *  or "its workspace" when neither is recorded. It never falls back to the run number. `Subject` opens a sentence. */
export function workspaceSubject(run: Pick<RunSummary, 'workspace' | 'branch'>): { subject: string; Subject: string } {
  if (run.workspace !== null && run.workspace !== '') return { subject: run.workspace, Subject: run.workspace };
  if (run.branch !== null && run.branch !== '') return { subject: `the workspace on ${run.branch}`, Subject: `The workspace on ${run.branch}` };
  return { subject: 'its workspace', Subject: 'Its workspace' };
}

/** The confirm line, without the title's "Abandon run N?" (check 13). Says what happens WHEN nothing keeps a child, never that
 *  it will: the sheet cannot know before the tap what will keep it. */
export function abandonConsequence(
  run: Pick<RunSummary, 'id' | 'sessionId' | 'workspace' | 'branch'>, child: AbandonChild,
): string {
  // Decided on `run.sessionId` alone: a run with no session names no workspace,
  // so it names no child (close.ts's abandon arm does no fleet act for it).
  if (run.sessionId === null) {
    return 'It holds no workspace of its own, so it has none to release or reclaim.';
  }
  const ws = workspaceSubject(run);
  const RELEASE_TAIL = 'A release destroys nothing: the worktree survives, the record stays.';
  switch (child) {
    case 'not-child': {
      if (run.workspace !== null && run.workspace !== '') return `Its workspace is ${run.workspace}. ${RELEASE_TAIL}`;
      if (run.branch !== null && run.branch !== '') return `Its branch is ${run.branch}. ${RELEASE_TAIL}`;
      return RELEASE_TAIL;
    }
    case 'child':
      return `${ws.Subject} is a child workspace, so the server reclaims it when nothing keeps it: its commits and uncommitted work (not ignored or secret-shaped files) are pinned in the attic and its transcripts kept, then its session is stopped, its worktree, branch, clips and temp root are removed, and its registry row is purged.`;
    case 'unknown':
      return `This board cannot tell whether ${ws.subject} is a child workspace. If it is, the server reclaims it when nothing keeps it, pinning its commits and uncommitted work (not ignored or secret-shaped files) in the attic first; if not, a release destroys nothing.`;
  }
}

/** What `abandonRun` resolves with: `released` as before, and the child reclaim's two facts when the server sent them (F24). */
export interface AbandonAnswer {
  readonly released: boolean;
  readonly childReclaim?: 'queued' | 'not-queued';
  /** The act found its run already closed and only settled the item: nothing was abandoned. */
  readonly alreadyClosed?: boolean;
}

export interface AbandonSheetProps {
  run: RunSummary | null;
  /** The run's workspace's child mark, as `abandonChildOf` reads it off the fleet
   *  row. Absent means the caller did not say, which reads 'unknown'. */
  workspaceChild?: AbandonChild;
  /** The row's context line, verbatim (F8). Absent, the sheet reads the same line the row does, `runWaitLine`; a stuck run's
   *  line is the stuck band's, which hands it in. */
  contextLine?: string | null;
  /** The run's coordinator as the board reads it, for `coordinatorGoneOf` when the server sent no verdict. */
  coordinatorPresence?: CoordinatorPresence;
  onClose: () => void;
  onDone?: () => void;
  /** The end-request item this sheet's confirm acts for (spec 2026-11-04 §10): the confirm then calls
   *  `POST /api/items/:id/act`, which runs the same abandon arm and closes the item itself. Absent, it calls the run's
   *  own abandon route. */
  itemId?: number;
  /** The "Abandon anyway" door of a refused close (spec §12.2): the same act, and the sheet adds that the branch stays on disk. */
  anyway?: boolean;
  /** D-8558: the "Close this run" door of a refused close whose coordinator the registry no longer holds: the same act, with the
   *  operator's reason, and, when the item offers it (`offerEnd`), the programme's end; `endFirst` opens with "done" picked. */
  closeRun?: { readonly offerEnd: boolean; readonly endFirst: boolean };
}

/** D-8558: the close-run mode's words, once. */
export const CLOSE_RUN_WORDS = {
  title: (id: number) => `Close run ${id}?`, confirm: 'Close this run', busy: 'Closing…', keep: 'Keep it',
  why: 'Why', other: 'Something else', otherLabel: 'The reason, in a few words',
  programme: 'The programme', keepOpen: 'Keep its plan open', endDone: 'End it: its work is done', endAbandoned: 'End it: abandoned',
} as const;

/** The programme choice of the close-run mode: keep it, or end it done or abandoned. */
type ProgrammeChoice = 'keep' | PlanEndOutcome;

/** D-8558: the reason the close-run mode sends, from the picked option and the typed text, or null while there is none. */
export function closeRunReason(pick: string | null, typed: string): string | null {
  if (pick === null) return null;
  const said = pick === 'other' ? typed.trim() : pick;
  return said === '' ? null : [...said].slice(0, CLOSE_REASON_MAX).join('');
}

/** The toast a landed close-run says: the run, and the programme's end when one was asked. */
export function closeRunToast(runId: number, programme: ProgrammeChoice): string {
  return programme === 'keep' ? `Run ${runId} closed.` : `Run ${runId} closed. Its programme is ended: ${programme}.`;
}

/** The line "Abandon anyway" adds: the unpushed commits are on the branch, and the close does not remove it. */
export const ABANDON_ANYWAY_LINE = 'The branch stays on disk.';

export function AbandonSheet({
  run,
  workspaceChild = 'unknown',
  contextLine,
  coordinatorPresence = 'unknown',
  onClose,
  onDone,
  itemId,
  anyway = false,
  closeRun,
  abandonRun = api.abandonRun,
  actItem = api.actItem,
}: AbandonSheetProps & {
  /** Injectable for tests, same shape `CoordBanner`'s own `coordPause` prop
   *  uses — defaults to the real `api.abandonRun`, whose own URL/method are
   *  pinned separately in `api.test.ts` so this injection is never the ONLY
   *  coverage of the write path. */
  abandonRun?: (id: number, opts?: ReadOpts) => Promise<AbandonAnswer>;
  /** Injectable like `abandonRun`; the item act's URL and method are pinned in `api.test.ts`. */
  actItem?: (itemId: number, opts?: ReadOpts, body?: ItemActBody) => Promise<AbandonAnswer>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AbandonError | null>(null);
  const [reasonPick, setReasonPick] = useState<string | null>(null);
  const [reasonTyped, setReasonTyped] = useState('');
  const [programme, setProgramme] = useState<ProgrammeChoice>('keep');

  // Review fix round 1, Important 1 — the same defect class `ReapSheet`
  // already litigated (`session/ReapSheet.tsx:124-186`, findings 17-F1/F2)
  // one directory over: this sheet is mounted UNCONDITIONALLY at screen
  // level and `run === null` merely renders nothing (below) — it does not
  // unmount, so `busy`/`error` used to survive every close and every switch
  // of target. Two reachable bugs that followed: (1) abandon run 3 → 502 →
  // Cancel → open run 7's sheet → run 7 opens already showing run 3's
  // refusal; (2) abandon run 3 (in flight) → dismiss via scrim/Esc (NOT
  // gated on `busy`, unlike the two buttons) → open run 7's sheet, which
  // then rendered disabled/"Abandoning…" for a request it never made, and
  // eventually had run 3's LATE response close it out from under the
  // operator and fire `loadCold()` for a run they never touched.
  //
  // `gen`, ReapSheet's own idiom: the generation the sheet is currently
  // willing to accept an answer for. `targetId` is the dependency (not
  // `open`/`run` themselves — this sheet has no separate `open` prop,
  // `run !== null` IS open) — every close (`run` → `null`) and every switch
  // of target bumps it in the effect's OWN cleanup, and the effect's body
  // resets `busy`/`error` for the (possibly new) target on the same tick.
  // `confirm()` below captures the generation it was issued under and
  // refuses to act if a newer one has since taken over — there is no path
  // by which a superseded response reaches `setBusy`/`setError`/`onDone`/
  // `onClose`.
  const gen = useRef(0);
  const targetId = run?.id ?? null;
  const endFirst = closeRun?.endFirst === true;
  useEffect(() => {
    setBusy(false);
    setError(null);
    setReasonPick(null);
    setReasonTyped('');
    setProgramme(endFirst ? 'done' : 'keep');
    return () => { gen.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, endFirst]);

  if (run === null) return null;

  const ws = workspaceSubject(run).subject;
  const line = contextLine !== undefined ? contextLine : runWaitLine(run, Date.now());
  const told = run.claimedBy !== null && !coordinatorGoneOf(run, coordinatorPresence);

  const toRecord = (e: MouseEvent<HTMLAnchorElement>): void => { inAppClick(runPath(run.id))(e); onClose(); };

  const reason = closeRunReason(reasonPick, reasonTyped);
  const closing = closeRun !== undefined && itemId !== undefined;
  const confirm = (): void => {
    if (busy || (closing && reason === null)) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    const body: ItemActBody | null = closing && reason !== null
      ? { reason, ...(closeRun.offerEnd && programme !== 'keep' ? { programme } : {}) } : null;
    void (itemId === undefined ? abandonRun(run.id) : body === null ? actItem(itemId) : actItem(itemId, undefined, body)).then(
      (res) => {
        if (gen.current !== mine) return; // superseded — a different run's sheet is open now
        setBusy(false);
        // The toast is the proof, and its action opens the record (spec 9.1, F9). It is not silent for a close that could not
        // release: `released:false` is the negation of one fact, not one fact (`CloseOutcome.released`'s docstring), so it is
        // gated on `run.sessionId`: a `planned` run with no session does no fleet act, and no sibling holds a workspace that
        // was never allocated. A queued child reclaim is exclusive with a sibling's hold: the close never re-held it.
        const action = { label: 'Open record', onClick: () => navigate(runPath(run.id)) };
        if (res.alreadyClosed === true) {
          toast(`Run ${run.id} had already closed, so nothing was abandoned.`, 'info', action);
        } else if (body !== null) {
          toast(closeRunToast(run.id, body.programme ?? 'keep'), 'info', action);
        } else if (res.childReclaim === 'queued') {
          toast(`Run ${run.id} abandoned. Its workspace is being reclaimed.`, 'info', action);
        } else if (!res.released && run.sessionId !== null) {
          toast(`Run ${run.id} abandoned — ${ws} is still claimed by another open run.`, 'info', action);
        } else {
          toast(`Run ${run.id} abandoned.`, 'info', action);
        }
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return; // superseded — this refusal belongs to a run no longer shown
        setBusy(false);
        setError(itemId === undefined ? abandonErrorText(err) : itemActErrorText(err));
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={closing ? CLOSE_RUN_WORDS.title(run.id) : `Abandon run ${run.id}?`}
      // The answers are pinned in the Sheet's footer (D-5932).
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="danger" disabled={busy || (closing && reason === null)} onClick={confirm}>
            {closing ? (busy ? CLOSE_RUN_WORDS.busy : CLOSE_RUN_WORDS.confirm) : busy ? 'Abandoning…' : `Abandon run ${run.id}`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {CLOSE_RUN_WORDS.keep}
          </Button>
        </div>
      }
    >
      <div className="abandon-sheet">
        <p className="abandon-name">{runRowName(run)}</p>
        {line !== null && <p className="abandon-line">{line}</p>}
        <p className={QC_CONSEQUENCE}>
          {abandonConsequence(run, workspaceChild)}
        </p>
        {anyway && <p className="abandon-note">{ABANDON_ANYWAY_LINE}</p>}
        {closing && (
          <div className="abandon-close-run" data-close-run={run.id}>
            <RadioFieldset legend={CLOSE_RUN_WORDS.why} name={`close-reason-${run.id}`} disabled={busy} value={reasonPick}
                           onPick={setReasonPick}
                           options={[...CLOSE_RUN_REASONS.map((r) => ({ value: r, label: r[0]!.toUpperCase() + r.slice(1) })),
                             { value: 'other', label: CLOSE_RUN_WORDS.other }]} />
            {reasonPick === 'other' && (
              <TextInput aria-label={CLOSE_RUN_WORDS.otherLabel} placeholder={CLOSE_RUN_WORDS.otherLabel} maxLength={CLOSE_REASON_MAX}
                         disabled={busy} value={reasonTyped} onChange={(e) => setReasonTyped(e.target.value)} />
            )}
            {closeRun.offerEnd && (
              <RadioFieldset<ProgrammeChoice> legend={CLOSE_RUN_WORDS.programme} name={`close-programme-${run.id}`} disabled={busy}
                             value={programme} onPick={setProgramme}
                             options={[{ value: 'keep', label: CLOSE_RUN_WORDS.keepOpen }, { value: 'done', label: CLOSE_RUN_WORDS.endDone },
                               { value: 'abandoned', label: CLOSE_RUN_WORDS.endAbandoned }]} />
            )}
          </div>
        )}
        {run.waitsOn === 'worker' && <p className="abandon-note">Its worker is still running.</p>}
        {told && <p className="abandon-note">Its coordinator is told.</p>}
        <p className="abandon-note abandon-links">
          <a className={cn(GHOST_ANCHOR, 'abandon-link')} href={runPath(run.id)} onClick={toRecord}>See this run</a>
        </p>
        {error !== null && (
          <>
            {error.lead !== null && <p className="abandon-error">{error.lead}</p>}
            <p className="abandon-error">{error.text}</p>
            {error.record && (
              <p className="abandon-note">
                <a className={cn(GHOST_ANCHOR, 'abandon-link')} href={runPath(run.id)} onClick={toRecord}>Open record</a>
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
