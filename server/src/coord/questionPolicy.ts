// THE QUESTION SWEEP'S DECIDERS (consolidation spec K5, C6; W3 Task Q3c, D-7027; ARCH-56 (#791), second PR). Pure:
// no fs, no store, no clock, no timer. Each decider takes one input shape and answers one word of its union; the acts
// (`pushOne`, the store CAS, the carrier edits, the warn sentences) stay with the sweep that asks, in `watch.ts`
// (`FleetWatcher#sweepAsks` and `FleetWatcher#sweepApprovals`, the two halves `FleetWatcher#sweepQuestions` dispatches).
// Decide in L1, act in L4. The words are today's branches, named; nothing here changes what the sweep does.
//
// Its one runtime import is `askwindow.ts`, a pure L1 module with no imports of its own, where `ASK_ANSWERING_MAX_MS`
// lives (slug q3c-policy-askwindow). `APPROVAL_RULED_GRACE_MS` lives there too since approvals PR 3, and is still handed in
// (slug q3c-grace-param).
import type { AskState } from '../../../shared/api.js';
import { APPROVAL_HOOK_WAIT_S, DIALOG_MULTI_REFUSE_CODES, DIALOG_TEXT_REFUSE_CODES, QUESTION_DOOR_REFUSALS } from '../../../shared/api.js';
import { ASK_ANSWERING_MAX_MS } from '../askwindow.js';
import type { ApprovalRow } from './store.js';

// ── The ask half: one held ask's lapse ──────────────────────────────────────────────────────────────────────────

/** What the ask half does with one held ask:
 *  - `wait`: its window (`until`) is still open; nothing is tried;
 *  - `keep`: the hold stays, and a later sweep retries (also the answer for a due hold before its release is tried:
 *    the release CAS is the next act);
 *  - `keep-reset`: the hold stays and its `answeringSince` is reset (a fresh `answering` episode starts from null);
 *  - `drop`: the hold goes and nothing is pushed (somebody already resolved the question);
 *  - `push-and-drop`: the hold goes and its snapshotted push is sent (after a won release CAS the sweep also records
 *    the lapse for a late answer, D-5289). */
export type AskLapse = 'wait' | 'push-and-drop' | 'drop' | 'keep' | 'keep-reset';
export const ASK_LAPSE_ANSWERS: Readonly<Record<AskLapse, true>> = { wait: true, 'push-and-drop': true, drop: true, keep: true, 'keep-reset': true };

/** What the ask half has read so far for one held ask, in the order it reads it (slug q3c-ask-lapse-stages):
 *  `window` before the release CAS is tried; then the CAS's own outcome (`release-threw`, `release-won`); then, the CAS
 *  lost, the row re-read (`row-refused`, `row-threw`, or the `row`, `null` when it is gone). */
export type AskLapseRead =
  | { readonly kind: 'window' }
  | { readonly kind: 'release-threw' }
  | { readonly kind: 'release-won' }
  | { readonly kind: 'row-refused' }
  | { readonly kind: 'row-threw' }
  | { readonly kind: 'row'; readonly row: { readonly state: AskState } | null };

const ASK_LAPSE_READ_KINDS: Readonly<Record<AskLapseRead['kind'], true>> = {
  window: true, 'release-threw': true, 'release-won': true, 'row-refused': true, 'row-threw': true, row: true,
};

/** The carrier fields the decision reads: the window's end and the first `answering` sighting. */
export interface AskLapseCarrier { readonly until: number; readonly answeringSince: number | null }

/** One held ask's lapse, at `now` (today's `askPass` arms, RULING F9 and fix round 1):
 *  - before the release CAS (`window`): `wait` while the window is open, else `keep` (the release is tried next). Only
 *    this stage reads the window: once the sweep has tried the release, its outcome decides;
 *  - the release threw, or the re-read was refused or threw (D-2545): `keep`, retried next sweep;
 *  - the release CAS won: `push-and-drop`;
 *  - the row gone: `push-and-drop` (its loss is free by design);
 *  - `answering`: `keep` under `ASK_ANSWERING_MAX_MS` since the first sighting, `push-and-drop` at or past it (the
 *    sweep stamps `answeringSince` on the first sighting before it asks, so a null reads as `now`);
 *  - `answered`, `released`, `declined`, `stale`: `drop`;
 *  - `held` (the CAS lost against a row still held: a race): `keep-reset`;
 *  - `unknown`, or any state outside the vocabulary: `push-and-drop`. */
export function decideAskLapse(carrier: AskLapseCarrier, read: AskLapseRead, now: number): AskLapse {
  switch (read.kind) {
    case 'window':
      return carrier.until > now ? 'wait' : 'keep';
    case 'release-threw':
    case 'row-refused':
    case 'row-threw':
      return 'keep';
    case 'release-won':
      return 'push-and-drop';
    case 'row':
      break;
  }
  const row = read.row;
  if (row === null) return 'push-and-drop';
  switch (row.state) {
    case 'answering':
      return now - (carrier.answeringSince ?? now) >= ASK_ANSWERING_MAX_MS ? 'push-and-drop' : 'keep';
    case 'answered':
    case 'released':
    case 'declined':
    case 'stale':
      return 'drop';
    case 'held':
      return 'keep-reset';
    case 'unknown':
      return 'push-and-drop';
    default: {
      const _exhaustive: never = row.state;
      void _exhaustive;
      return 'push-and-drop';
    }
  }
}

// ── The approval half: one row's clock ──────────────────────────────────────────────────────────────────────────

/** What the approval half does with one row: `lapse` (`held` -> `released`, its window `notifyAt` ended), `shadow-park`
 *  (the same lapse, recording `wouldPark`: the row's stored word is `shadow`, so it would have parked had the lane been
 *  live), `park` (approvals PR 3: -> `parked`, through `parkApproval` only), `stale` (`held` or `released` past the hook's
 *  ceiling, `askAt + APPROVAL_HOOK_WAIT_S`, or a `parked` row whose park reached its horizon or went void), or `none`. */
export type ApprovalLapse = 'lapse' | 'shadow-park' | 'park' | 'stale' | 'none';
export const APPROVAL_LAPSE_ANSWERS: Readonly<Record<ApprovalLapse, true>> = {
  lapse: true, 'shadow-park': true, park: true, stale: true, none: true,
};

/** The row fields the decision reads: the stored `parkWord` (decided at mint, F1; null on a row minted before PR 3) and
 *  `fetchedAt` (the ruling read's first serve, F8-c). Optional only so a caller that predates PR 3 reads as before. */
export type ApprovalLapseRow = Pick<ApprovalRow, 'state' | 'askAt' | 'notifyAt'> & Partial<Pick<ApprovalRow, 'parkWord' | 'fetchedAt'>>;

/** The park as the decision reads it (approvals PR 3): its horizon (null while nothing has parked on it) and whether it is
 *  void (its run closed, or a pane answer voided it). `null`: the row has no park, or it could not be read. */
export interface ApprovalLapsePark { readonly horizon: number | null; readonly void: boolean }

/** One approval row's next act at `now` (D-5298, D-5441; approvals PR 3, F1, F2, F8). It reads the row's STORED
 *  `parkWord`, never the live lane:
 *  - a `held` row at or past `notifyAt`: `park` when its word is `live`; `shadow-park` when it is `shadow`; else `lapse`;
 *  - a `parked` row: `stale` when its park is missing, void, or at or past its horizon; else `none`;
 *  - the last-poll move (F2): an `allowed` or `denied` row the hook never fetched (`fetchedAt` null), whose word is `live`
 *    (so never a row minted in shadow, nor one minted before PR 3), at or past `notifyAt` plus `graceMs` and before the
 *    hook's ceiling: `park` (its ruling moves onto the park, so the retry meets it);
 *  - otherwise a `held` or `released` row at or past the hook's ceiling is `stale`; otherwise `none`.
 *  A `held` row due for both a lapse and the ceiling answers its lapse first; the `released` row it becomes, asked again,
 *  answers `stale`. */
export function decideApprovalLapse(row: ApprovalLapseRow, now: number, graceMs = 0, park: ApprovalLapsePark | null = null): ApprovalLapse {
  const ceiling = row.askAt + APPROVAL_HOOK_WAIT_S * 1000;
  if (row.state === 'held' && now >= row.notifyAt) {
    return row.parkWord === 'live' ? 'park' : row.parkWord === 'shadow' ? 'shadow-park' : 'lapse';
  }
  if (row.state === 'parked') return park === null || park.void || (park.horizon !== null && now >= park.horizon) ? 'stale' : 'none';
  if ((row.state === 'allowed' || row.state === 'denied') && row.fetchedAt === null && row.parkWord === 'live'
      && now >= row.notifyAt + graceMs && now < ceiling) return 'park';
  if ((row.state === 'held' || row.state === 'released') && now >= ceiling) return 'stale';
  return 'none';
}

/** What the approval half does with one deferred push (`heldApprovals`'s entry): `wait` (it stays deferred), `push`
 *  (it goes and is sent, its dialog still painted), `drop` (it goes, its dialog no longer painted). */
export type DeferredApprovalPush = 'wait' | 'push' | 'drop';
export const DEFERRED_APPROVAL_PUSH_ANSWERS: Readonly<Record<DeferredApprovalPush, true>> = { wait: true, push: true, drop: true };

/** The entry fields the decision reads: the row ids its push covers. */
export interface DeferredApprovalEntry { readonly rowIds: readonly number[] }

/** The child's rows as the sweep read them (`held`, `allowed`, `denied`), or `unreadable` when the read was refused. */
export type DeferredApprovalRows = { readonly ok: true; readonly rows: readonly Pick<ApprovalRow, 'id' | 'state' | 'notifyAt' | 'ruledAt'>[] } | { readonly ok: false };

/** One deferred push at `now` (D-5298, D-5440): an unreadable read `wait`s (retried next sweep); an entry covering a
 *  `parked` row is never pushed (approvals PR 3, F4, F16: a parked row's push is sent at park time, and the dialog is never
 *  pushed for a pane press): it `wait`s while its dialog is painted, so the operator's press on that dialog still reaches
 *  the parked row and voids its park (approvals PR 3c, F-A), and is `drop`ped once it is not; a covered row still `held`
 *  inside its window `wait`s; every covered row ruled within the last
 *  `graceMs` (the ruled grace, measured from each row's `ruledAt`: the hook is printing the ruling and the dialog is about
 *  to clear) `wait`s; otherwise the entry goes, `push` while its dialog is still `painted` and `drop` when it is not. */
export function decideDeferredApprovalPush(
  entry: DeferredApprovalEntry, rows: DeferredApprovalRows, now: number, painted: boolean, graceMs: number,
): DeferredApprovalPush {
  if (!rows.ok) return 'wait';
  const mine = rows.rows.filter((x) => entry.rowIds.includes(x.id));
  if (mine.some((x) => x.state === 'parked')) return painted ? 'wait' : 'drop';
  if (mine.some((x) => x.state === 'held' && now < x.notifyAt)) return 'wait';
  const ruledRecently = mine.length === entry.rowIds.length && mine.length > 0
    && mine.every((x) => x.state !== 'held' && x.ruledAt !== null && now < x.ruledAt + graceMs);
  if (ruledRecently) return 'wait';
  return painted ? 'push' : 'drop';
}

/** How long before a `held` `live` row's `notifyAt` a cleared dialog is read as the hook's park deny, not as a press
 *  (approvals PR 3c, F-A; review 3022 F4). Measured from the hook: its deadline is its own clock at the `201` plus
 *  `waitS * 1000`, and windows are whole seconds with `waitS` taken from the same `now` as `notifyAt`, so the floor loses
 *  nothing today; the one early source is the hook's whole-second clock fallback (`_hook_epoch_ms`, where `EPOCHREALTIME`
 *  and `date +%s%3N` both fail), up to 1 s. 1.5 s covers it with half a second of margin against a clock step. Every extra
 *  second here is a second in which a pane answer is lost (read as the deny), and the settle compares the slack with the
 *  tick that SEES the clear, so the lost window is this slack plus the poll's lag (the note's residuals). */
export const APPROVAL_PARK_CLEAR_SLACK_MS = 1_500;

/** The child's rows a cleared-dialog settle reads (`held`, `released`, `parked`), or `unreadable`. */
export type ClearSettleRows = { readonly ok: true; readonly rows: readonly Pick<ApprovalRow, 'id' | 'state' | 'notifyAt' | 'parkWord'>[] } | { readonly ok: false };
type ClearSettleRow = Extract<ClearSettleRows, { ok: true }>['rows'][number];

/** The rows a painted approval dialog's clear marks `operator` (spec §6.3 server step 5; approvals PR 3c, F-A): of the
 *  rows its deferred push covers, each `held` or `released` one, EXCEPT a `held` row stored `live` at or past its
 *  `notifyAt` less `APPROVAL_PARK_CLEAR_SLACK_MS` (the hook printed the park deny, which cleared the dialog; the sweep parks
 *  the row, in this tick or the next). A `parked` row is never settled by a clear: after the park a clear is the park deny,
 *  and only the operator's press on that dialog voids the park. An unreadable read settles nothing: the sweep rules each
 *  held row by its own clock. Covered ids, in the entry's order. */
export function clearSettledApprovalIds(rowIds: readonly number[], rows: ClearSettleRows, now: number): number[] {
  if (!rows.ok) return [];
  const settles = (x: ClearSettleRow): boolean =>
    x.state === 'released' || (x.state === 'held' && !(x.parkWord === 'live' && now >= x.notifyAt - APPROVAL_PARK_CLEAR_SLACK_MS));
  return rowIds.filter((id) => rows.rows.some((x) => x.id === id && settles(x)));
}

/** The painted prompt a held entry was held for (approvals PR 3c, review 3022 F1): the hook envelope's own stamp, and the
 *  subagent whose entry it is (`''` for hook state's own `ask`). A main-thread wait keeps its `updatedAt` across subagent
 *  events (the hook's `_hook_keep_stamp`), and a subagent's entry carries its PermissionRequest's stamp as `at`, so the
 *  stamp names one prompt while it stands. */
export interface HeldPrompt { readonly agentId: string; readonly at: number }

/** What a press's check reads of hook state now (`hookstate.ts#HookState` has these fields), or null when none was read. */
export interface PressHookState {
  readonly ask: object | null;
  readonly updatedAt: number;
  readonly approvals?: readonly { readonly agentId: string; readonly at: number }[] | undefined;
}

/** Whether an operator's press on a held entry's dialog answers THAT entry's prompt (approvals PR 3c, review 3022 F1). The
 *  dialog id hashes the menu's labels and first title line, not its command, so a second prompt with the same menu can
 *  paint under the same id before the poll sees the first clear. The press reaches the entry's rows only while hook state
 *  still names the held prompt: the main thread's wait at the same stamp, with an approval `ask`; a subagent's entry, by
 *  its agent and stamp, still in the hook's list. No hook state read: it does not. */
export function pressAnswersHeldPrompt(held: HeldPrompt, hs: PressHookState | null): boolean {
  if (hs === null) return false;
  if (held.agentId === '') return hs.ask !== null && 'approval' in hs.ask && hs.updatedAt === held.at;
  return (hs.approvals ?? []).some((e) => e.agentId === held.agentId && e.at === held.at);
}

/** The phases of an entry in the hold carrier (`coord/questions.ts#createQuestions`'s `questionHolds`, W3 Q3d, D-7028):
 *  `held` (today's `heldAsks` and `heldApprovals`), `lapsed` (today's `lapsedAsks`) and `reseed-pending` (today's
 *  `pendingReseed`, D-5925). Declared here, beside the sweep's other words, with its sibling map (slug
 *  q3d-hold-phase-words). */
export type QuestionHoldPhase = 'held' | 'lapsed' | 'reseed-pending';
export const QUESTION_HOLD_PHASES: Readonly<Record<QuestionHoldPhase, true>> = { held: true, lapsed: true, 'reseed-pending': true };

/** Whether `tok` is one of this module's words (the three answer unions, the ask read's stages and the carrier's
 *  phases), for `mail-routes.test.ts`'s scan of quoted kebab tokens under `server/src/coord` (slug q3c-kebab-union):
 *  none is a mail rejection or a run refusal; they ride the sweep's decisions and the carrier, and never reach a route.
 *  And (W3 Q3f, D-7030) the question door family's own refusal, `kind-mismatch` (`shared/api.ts#QUESTION_DOOR_REFUSALS`,
 *  read and never re-spelled): a route refusal of the family's front ladder, never a mail rejection or a run refusal;
 *  and the free-text and multiSelect presses' words (`DIALOG_TEXT_REFUSE_CODES`, `DIALOG_MULTI_REFUSE_CODES`), which
 *  the operator's core names to pick a door's status (`bad-text`, `bad-indexes`: 400), a press's answer and never a mail
 *  rejection or a run refusal. Derived from the tables above. */
export function isQuestionPolicyKebab(tok: string): boolean {
  return Object.hasOwn(ASK_LAPSE_ANSWERS, tok) || Object.hasOwn(ASK_LAPSE_READ_KINDS, tok)
    || Object.hasOwn(APPROVAL_LAPSE_ANSWERS, tok) || Object.hasOwn(DEFERRED_APPROVAL_PUSH_ANSWERS, tok)
    || Object.hasOwn(QUESTION_HOLD_PHASES, tok) || Object.hasOwn(QUESTION_DOOR_REFUSALS, tok)
    || (DIALOG_TEXT_REFUSE_CODES as readonly string[]).includes(tok) || (DIALOG_MULTI_REFUSE_CODES as readonly string[]).includes(tok);
}
