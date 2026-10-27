// THE QUESTION SWEEP'S DECIDERS (consolidation spec K5, C6; W3 Task Q3c, D-7027; ARCH-56 (#791), second PR). Pure:
// no fs, no store, no clock, no timer. Each decider takes one input shape and answers one word of its union; the acts
// (`pushOne`, the store CAS, the carrier edits, the warn sentences) stay with the sweep that asks, in `watch.ts`
// (`FleetWatcher#sweepAsks` and `FleetWatcher#sweepApprovals`, the two halves `FleetWatcher#sweepQuestions` dispatches).
// Decide in L1, act in L4. The words are today's branches, named; nothing here changes what the sweep does.
//
// Its one runtime import is `askwindow.ts`, a pure L1 module with no imports of its own, where `ASK_ANSWERING_MAX_MS`
// lives (slug q3c-policy-askwindow). `APPROVAL_RULED_GRACE_MS` stays `watch.ts`'s and is handed in (slug
// q3c-grace-param).
import type { AskState } from '../../../shared/api.js';
import { APPROVAL_HOOK_WAIT_S } from '../../../shared/api.js';
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

/** What the approval half does with one row: `lapse` (`held` -> `released`, its window `notifyAt` ended), `stale`
 *  (`held` or `released` past the hook's ceiling, `askAt + APPROVAL_HOOK_WAIT_S`), or `none`. */
export type ApprovalLapse = 'lapse' | 'stale' | 'none';
export const APPROVAL_LAPSE_ANSWERS: Readonly<Record<ApprovalLapse, true>> = { lapse: true, stale: true, none: true };

/** The row fields the decision reads. */
export type ApprovalLapseRow = Pick<ApprovalRow, 'state' | 'askAt' | 'notifyAt'>;

/** One approval row's next act at `now` (D-5298, D-5441): a `held` row at or past `notifyAt` lapses first; otherwise a
 *  `held` or `released` row at or past the hook's ceiling is `stale`; otherwise `none`. A `held` row due for both
 *  answers `lapse`; the lapsed row it becomes is `released`, and asked again it answers `stale`. */
export function decideApprovalLapse(row: ApprovalLapseRow, now: number): ApprovalLapse {
  if (row.state === 'held' && now >= row.notifyAt) return 'lapse';
  if ((row.state === 'held' || row.state === 'released') && now >= row.askAt + APPROVAL_HOOK_WAIT_S * 1000) return 'stale';
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

/** One deferred push at `now` (D-5298, D-5440): an unreadable read `wait`s (retried next sweep); a covered row still
 *  `held` inside its window `wait`s; every covered row ruled within the last `graceMs` (the ruled grace, measured
 *  from each row's `ruledAt`: the hook is printing the ruling and the dialog is about to clear) `wait`s; otherwise the
 *  entry goes, `push` while its dialog is still `painted` and `drop` when it is not. */
export function decideDeferredApprovalPush(
  entry: DeferredApprovalEntry, rows: DeferredApprovalRows, now: number, painted: boolean, graceMs: number,
): DeferredApprovalPush {
  if (!rows.ok) return 'wait';
  const mine = rows.rows.filter((x) => entry.rowIds.includes(x.id));
  if (mine.some((x) => x.state === 'held' && now < x.notifyAt)) return 'wait';
  const ruledRecently = mine.length === entry.rowIds.length && mine.length > 0
    && mine.every((x) => x.state !== 'held' && x.ruledAt !== null && now < x.ruledAt + graceMs);
  if (ruledRecently) return 'wait';
  return painted ? 'push' : 'drop';
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
 *  Derived from the tables above. */
export function isQuestionPolicyKebab(tok: string): boolean {
  return Object.hasOwn(ASK_LAPSE_ANSWERS, tok) || Object.hasOwn(ASK_LAPSE_READ_KINDS, tok)
    || Object.hasOwn(APPROVAL_LAPSE_ANSWERS, tok) || Object.hasOwn(DEFERRED_APPROVAL_PUSH_ANSWERS, tok)
    || Object.hasOwn(QUESTION_HOLD_PHASES, tok);
}
