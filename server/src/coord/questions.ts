// OPERATOR QUESTIONS (consolidation spec K5, C6; W3 Task Q3b, D-7026; ARCH-56 (#791)). One owner for the questions a
// coordinator or the operator answers: a child's AskUserQuestion (the `asks` table), a child's permission prompt (the
// `approvals` table) and the dialog the pane shows. It reads `CoordStore` and holds no route, no auth check, no
// timer and no `reply` (spec §2.5); the doors stay in `coord/routes.ts` and `server.ts` and call in here.
//
// THE READ SIDE (Q3b). Every read of the two tables outside the store goes through one function below, each a plain
// function over a `CoordStore` and stateless. Each answers the store's measured result UNCHANGED: a refusal
// (`{ok:false, detail}`) stays that refusal, never an empty list or map, and a throw still throws, so the caller that
// catches it today keeps catching it. What a bad read MEANS stays the caller's, in today's direction: the fleet frame
// degrades every row and warns its sentence (`fleet.ts`), the digest and the correction refuse (`coord/digest.ts`),
// the drift lane records nothing (`coord/driftLane.ts`), and a route answers its refusal (`coord/routes.ts`).
//
// THE OWNER OF QUESTION STATE. `createQuestions(deps)` makes one instance per composition: `FleetWatcher` makes one in
// its constructor (`watcher.questions`), and `buildServer` uses the watcher's when it is given one and makes its own
// otherwise. State (the hold carrier `questionHolds` with `reseedLoaded` and `asksDisabled`, Q3d; `approvalInputs`, Q3e)
// lives ONLY as closure locals of `createQuestions`, never at module scope, never as a class field and never as a
// property of the returned object: two apps or two watchers in one process share nothing
// (`census-w3/questions.ts#questionHoldCarriers` reads exactly that shape, and `single-definition/ask-digest.test.ts`
// holds this file to no module-scope state).
//
// THE HOLD (Q3d, D-7028; OA-C6 ruled (a), 2026-10-26). The watcher's four maps (`heldAsks`, `lapsedAsks`,
// `heldApprovals`, `pendingReseed`) are ONE carrier here, keyed by question, kept in memory for D-2169's reason (the asks
// table's schema comment) and re-seeded from the rows at boot (D-5925). `raise` is the one decision every hold goes
// through (D-5290); the re-seed, the settles, the two lapse halves and the door-ins act on the same carrier. The module
// never pushes: `raise` and the door-ins answer what to push, and the two lapse halves hand each push to the caller's
// sink at the moment today's sweep pushed it (slug q3d-lapse-sink), so a throw part-way through a sweep still leaves every
// earlier push sent, as before. The pane-edge maps (`dialogIds`, `actionlessAsks`, `settlingAsks`) stay the watcher's:
// they record what the pane showed, and the watcher hands in the one fact a member needs from them.
//
// THE RAISE (Q3e, D-7029). `raiseApproval` is `POST /api/approvals`'s ladder after the kill switch and attribution
// (steps 6 to 15), which the route keeps inline in today's order. It answers one closed verdict the route maps byte for
// byte. RING: this file stays L1. What the ladder needs from an outer ring (the claimant rule `heldFor`, L3; the
// single-box gate `rulingsAllowedHere`, L3; the signer, the deny and version reads and the journal, closures of
// `registerCoordRoutes`) is passed in as `ApprovalRaiseDeps` and imported here by type only, so `fleet.ts`'s runtime
// import of `currentFor` stays inward and `rings/outward-edges.data.ts` gains no pair.
import { createHash } from 'node:crypto';
import {
  APPROVAL_CWD_TRUSTED, APPROVAL_HOOK_VERSIONS, approvalDigestBytes, canonicalJson, isAskState,
  type ApprovalMintReleaseReason, type ApprovalState, type AskMintReleaseReason, type AskState, type Dialog, type HookAsk,
  type HookAskQuestion,
} from '../../../shared/api.js';
import { answeredByBody, approvalRuledBody, askPushBody } from '../askbody.js';
import { askActions, askKey } from '../askkey.js';
import { approvalWindowMs, askNotifyAt } from '../askwindow.js';
import type { HookState } from '../hookstate.js';
import type { PushPayload } from '../push.js';
import { readRegistry, type SessionRecord } from '../registry.js';
import { approvalClass, rootsForChild } from './approvalguard.js';
import { renderApprovalBrief } from './approvalbrief.js';
import type { ApprovalSigner, rulingsAllowedHere } from './approvalsign.js';
import type { heldFor } from './heldFor.js';
import { decideApprovalLapse, decideAskLapse, decideDeferredApprovalPush, type AskLapse, type QuestionHoldPhase } from './questionPolicy.js';
import type { ReclaimDeps } from './reclaim.js';
import { redactCommand, redactedStored } from './redact.js';
import { approvalNudgeSubject, askNudgeSubject } from './rundefs.js';
import { queueSystemMail } from './rundefsTx.js';
import type { ApprovalRow, AskReadResult, AskRow, CoordStore } from './store.js';
import { UNTRUSTED_CAP_BYTES, untrustedBlock } from './untrusted.js';

// ── the aggregate ────────────────────────────────────────────────────────────────────────────────────────────────

/** What every operator question has, whichever table (or pane) it comes from. `at` is when it was put to its holder
 *  (an ask's mint, an approval's ask); `notifyAt` is when the operator is told, or null for a question held for
 *  nobody. */
interface QuestionCommon {
  readonly childId: string;
  readonly at: number;
}

/** The operator question, a discriminated union over the two tables and the pane. The `ask` and `approval` arms carry
 *  their row UNCHANGED (`row`), so nothing a reader needs is lost in the lift; the `dialog` arm is what the pane shows,
 *  which no table records and no coordinator holds. */
export type OperatorQuestion =
  | QuestionCommon & {
    readonly kind: 'ask'; readonly parentId: string; readonly runId: number | null; readonly state: AskState;
    readonly notifyAt: number; readonly row: AskRow;
  }
  | QuestionCommon & {
    readonly kind: 'approval'; readonly parentId: string; readonly runId: number | null; readonly state: ApprovalState;
    readonly notifyAt: number; readonly row: ApprovalRow;
  }
  | QuestionCommon & {
    readonly kind: 'dialog'; readonly parentId: null; readonly runId: null; readonly state: 'shown';
    readonly notifyAt: null; readonly dialogId: string;
  };

/** An asks row as an operator question: its window counts from the mint (`askNotifyAt(row.at)`, D-5364), never from
 *  `askAt`. */
export function askQuestion(row: AskRow): Extract<OperatorQuestion, { kind: 'ask' }> {
  return { kind: 'ask', childId: row.childId, parentId: row.parentId, runId: row.runId, state: row.state, at: row.at,
    notifyAt: askNotifyAt(row.at), row };
}

/** An approvals row as an operator question: asked at `askAt`, its window the row's own `notifyAt` (D-5441). */
export function approvalQuestion(row: ApprovalRow): Extract<OperatorQuestion, { kind: 'approval' }> {
  return { kind: 'approval', childId: row.childId, parentId: row.parentId, runId: row.runId, state: row.state,
    at: row.askAt, notifyAt: row.notifyAt, row };
}

/** A dialog the pane shows as an operator question: held for nobody, with no window. */
export function dialogQuestion(d: { childId: string; dialogId: string; at: number }): Extract<OperatorQuestion, { kind: 'dialog' }> {
  return { kind: 'dialog', childId: d.childId, parentId: null, runId: null, state: 'shown', at: d.at, notifyAt: null,
    dialogId: d.dialogId };
}

// ── the read side: one function per reader, each the store's answer unchanged ─────────────────────────────────────

type HeldApprovalsResult = ReturnType<CoordStore['heldApprovalsFor']>;

/** The fleet frame's question per child (`fleet.ts`): `'ask'`, the newest asks row per child (`currentAsksFor`);
 *  `'approval'`, the held approvals row per child (`heldApprovalsFor`). Two reads, never one: each is its own
 *  guarded read in the caller, so one that fails leaves the other's rows standing. */
export function currentFor(store: Pick<CoordStore, 'currentAsksFor'>, childIds: readonly string[], kind: 'ask'): ReturnType<CoordStore['currentAsksFor']>;
export function currentFor(store: Pick<CoordStore, 'heldApprovalsFor'>, childIds: readonly string[], kind: 'approval'): HeldApprovalsResult;
export function currentFor(
  store: Pick<CoordStore, 'currentAsksFor'> | Pick<CoordStore, 'heldApprovalsFor'>, childIds: readonly string[], kind: 'ask' | 'approval',
): ReturnType<CoordStore['currentAsksFor']> | HeldApprovalsResult {
  return kind === 'ask'
    ? (store as Pick<CoordStore, 'currentAsksFor'>).currentAsksFor(childIds)
    : (store as Pick<CoordStore, 'heldApprovalsFor'>).heldApprovalsFor(childIds);
}

/** `GET /api/asks`' scoped read: the asks rows held for `parentId`, in `state` when given. */
export function openFor(store: Pick<CoordStore, 'asksForParent'>, parentId: string, state?: AskState): ReturnType<CoordStore['asksForParent']> {
  return store.asksForParent(parentId, state);
}

/** `GET /api/approvals/:id`'s read: one approvals row by id. */
export function approvalFor(store: Pick<CoordStore, 'approvalById'>, id: number): ReturnType<CoordStore['approvalById']> {
  return store.approvalById(id);
}

/** The digest's read (`buildDigest`): every asks row and every approvals row with an instant inside
 *  `[fromMs, toMs)`. The asks first; a refusal of either is that refusal, and a refused asks read reads no approvals. */
export function decidedIn(store: Pick<CoordStore, 'digestAsks' | 'digestApprovals'>, window: { fromMs: number; toMs: number }):
  | { ok: true; asks: Extract<ReturnType<CoordStore['digestAsks']>, { ok: true }>['rows']; approvals: ApprovalRow[] }
  | { ok: false; detail: string } {
  const asks = store.digestAsks(window.fromMs, window.toMs);
  if (!asks.ok) return asks;
  const approvals = store.digestApprovals(window.fromMs, window.toMs);
  if (!approvals.ok) return approvals;
  return { ok: true, asks: asks.rows, approvals: approvals.rows };
}

/** The correction's read (`correctDigestRow`): the asks row with its `corrected` mark, or the approvals row. */
export function forCorrection(store: Pick<CoordStore, 'askForCorrection'>, kind: 'ask', id: number): ReturnType<CoordStore['askForCorrection']>;
export function forCorrection(store: Pick<CoordStore, 'approvalById'>, kind: 'approval', id: number): ReturnType<CoordStore['approvalById']>;
export function forCorrection(
  store: Pick<CoordStore, 'askForCorrection'> | Pick<CoordStore, 'approvalById'>, kind: 'ask' | 'approval', id: number,
): ReturnType<CoordStore['askForCorrection']> | ReturnType<CoordStore['approvalById']> {
  return kind === 'ask'
    ? (store as Pick<CoordStore, 'askForCorrection'>).askForCorrection(id)
    : (store as Pick<CoordStore, 'approvalById'>).approvalById(id);
}

/** The drift lane's read: the questions still held, for its orphaned-question finding. */
export function heldForDrift(store: Pick<CoordStore, 'driftHeldQuestions'>): ReturnType<CoordStore['driftHeldQuestions']> {
  return store.driftHeldQuestions();
}

// ── the owner of question state ──────────────────────────────────────────────────────────────────────────────────

/** What a `Questions` instance is made from: the composition's own store (`Deps.coord`) and, for the hold's claimant
 *  rule (Q3d), the composition's `io`, `cfg` and `tmux`, read at the call, never copied. */
export interface QuestionsDeps {
  readonly coord?: CoordStore | undefined;
  readonly io?: ReclaimDeps['io'];
  readonly cfg?: ReclaimDeps['cfg'];
  readonly tmux?: ReclaimDeps['tmux'];
}

/** The outer-ring rule the hold reads (Q3d): the claimant decision `coord/heldFor.ts#heldFor` (L3, D-5530), passed in
 *  by the watcher that makes the instance so this file imports no outer ring at runtime (the ring stays L1, as for
 *  `raiseApproval`'s `ApprovalRaiseDeps`). An instance made without it (a server's own, which never raises) answers
 *  `none` from `raise`, through the hold's own any-failure arm. */
export interface QuestionRules {
  readonly heldFor: typeof heldFor;
}

// ── the hold carrier (Q3d, D-7028) ───────────────────────────────────────────────────────────────────────────────

/** The push a held question defers, as the watcher sends it (`FleetWatcher#pushOne`'s event). */
export interface QuestionPush {
  readonly kind: 'ask';
  readonly sessionId: string;
  readonly project: string;
  readonly title: string;
  readonly body: string;
  readonly actions?: PushPayload['actions'];
}

/** The record a hold sends at the mint instead of the push (D-2172): the same event, recorded, never pushed. */
export type QuestionRecord = QuestionPush & { readonly recordAlways: true; readonly recordOnly: true };

/** A held ask: today's `heldAsks` value (`until`, `askId`, `ev`, `answeringSince`), for its child. */
export interface HeldAsk {
  readonly childId: string;
  readonly until: number;
  readonly askId: number;
  readonly ev: QuestionPush;
  answeringSince: number | null;
}

/** A held prompt: today's `heldApprovals` value (`until`, `dialogId`, `rowIds`, `ev`), for its child. */
export interface HeldApproval {
  readonly childId: string;
  readonly until: number;
  readonly dialogId: string;
  readonly rowIds: number[];
  readonly ev: QuestionPush;
}

/** One entry of the carrier, keyed by question: `ask-<rowId>` for an ask (held, lapsed or still to be re-seeded), and
 *  `approval-child-<childId>` for a child's main-thread prompt (held, or still to be re-seeded). The phases replace
 *  today's maps: `held` is `heldAsks` and `heldApprovals`, `lapsed` is `lapsedAsks`, `reseed-pending` is `pendingReseed`'s
 *  two halves. */
type QuestionHold =
  | ({ readonly kind: 'ask'; readonly phase: 'held' } & HeldAsk)
  | { readonly kind: 'ask'; readonly phase: 'lapsed'; readonly childId: string; readonly askId: number; readonly ev: QuestionPush }
  | { readonly kind: 'ask'; readonly phase: 'reseed-pending'; readonly childId: string; readonly row: AskRow }
  | ({ readonly kind: 'approval'; readonly phase: 'held' } & HeldApproval)
  | { readonly kind: 'approval'; readonly phase: 'reseed-pending'; readonly childId: string; readonly rows: ReadonlyArray<{ id: number; notifyAt: number }> };

/** What `raise` answers: `none` (raise to the operator as today), `held` (minted `held` or a prompt deferred, the parent
 *  mailed for an ask, and `record` to send now), or `released` (minted `released` with its reason, `push` to send now). */
export type RaiseVerdict =
  | { readonly kind: 'none' }
  | { readonly kind: 'held'; readonly parent: string; readonly record: QuestionRecord }
  | { readonly kind: 'released'; readonly push: QuestionPush };

/** What a re-seed of one child decided this tick (D-5925): `reseeded` (a hold was re-seeded), `waiting` (doubt, left for
 *  a later tick) or `none` (nothing pending, or the pane disproved it and today's path takes over). */
export type ReseedVerdict = 'none' | 'reseeded' | 'waiting';

/**
 * The push a held question defers (D-5925): what the mint snapshots and what the restart re-seed rebuilds from the
 * dialog's current sighting, so the two can never drift apart. Pure: built from the record, this tick's hookstate, the
 * painted dialog and the actions `askActions` derived, and nothing else. `actions` `null` (an approval's deferred push,
 * which offers no answer buttons) omits the field.
 */
export function askHoldPayload(
  r: Pick<SessionRecord, 'id' | 'project'>, hs: HookState | null, dialog: Dialog, actions: PushPayload['actions'] | null,
): { kind: 'ask'; sessionId: string; project: string; title: string; body: string; actions?: PushPayload['actions'] } {
  return {
    kind: 'ask', sessionId: r.id, project: r.project,
    title: '❓ Question', body: askPushBody(hs, dialog),
    ...(actions === null ? {} : { actions }),
  };
}

/**
 * The parent's ENTIRE evidentiary surface (design spec §6.1) is this ask row
 * plus its own artifacts — no route, ws feed, or ccd verb lets one session
 * read another's transcript. So this states the child's id, the moment the
 * operator is notified (D-5294), the question and its options in order, the
 * ready-to-run commands a parent may act through, and the lazy role invocation
 * (design spec §4) — this session is that child's parent, and
 * `ccrc-coordinator` is the skill for the job. That sentence is why nothing has
 * to happen at session creation: the role arrives with its first duty.
 *
 * D-5294 (coordinator-first spec §5.4, §6.7):
 * - the deadline is `notifyAt` (`askNotifyAt`, the one computation the sweep
 *   also acts on), printed in UTC, with the late-answer sentence D-5289 makes
 *   true; it counts from the mint (the row's `at`), not the row's `askAt`
 *   (D-5364);
 * - the question and the option labels are the child's text, so they ride
 *   inside `untrustedBlock` and nowhere else; outside it the brief names
 *   options only by index;
 * - the commands (D-5365) are the coordinator skill's own client form
 *   (`wave-lifecycle.md`'s ask lane): `"$API"`, `$id` and `$uuid` are the
 *   names the skill's preamble sets, so the heredoc is UNQUOTED and the shell
 *   expands them into the attribution the route requires. Nothing the child
 *   wrote is inside a heredoc: the ask id and the index are integers this
 *   server minted;
 * - the question and its labels arrive already redacted (`redactCommand`,
 *   applied by `hold` before the row stores them; plan Task 16 closed
 *   D-5366), and are fenced here.
 */
function renderAskBrief(
  askId: number, childId: string, question: string, options: string[], notifyAt: number,
): string {
  const asked = `${question}\n${options.map((label, i) => `  ${i}. ${label}`).join('\n')}`;
  const deadline = new Date(notifyAt).toISOString().slice(11, 19);
  const who = '"fromId":"$id","fromUuid":"$uuid"';
  const answers = options.map((_label, i) =>
    `Option ${i}:\n"$API" asks answer ${askId} --json - <<JSON\n{${who},"optionIndexes":[${i}]}\nJSON\n`).join('');
  return `You are the parent of session \`${childId}\`, which is waiting on a question it cannot answer itself.\n` +
    `The operator is notified at ${deadline} UTC unless you answer or hand over; ` +
    `a later answer still counts until the operator acts.\n\n` +
    `${untrustedBlock(asked, UNTRUSTED_CAP_BYTES, 'on the ask row (`"$API" asks list` shows it while the row is held, not after the lapse)')}\n\n` +
    `Rule from your own artifacts — spec, plan, ledger, branch, your prior rulings — never from the child's ` +
    `reasoning, which you cannot see.\n\n` +
    `Answer with the index of the option you rule for ("$API", $id and $uuid are the ccrc-coordinator skill's):\n` +
    answers +
    `\nDecline (not yours to rule — fires the operator's own notification at once, and is final):\n` +
    `"$API" asks release ${askId} --json - <<JSON\n{${who}}\nJSON\n\n` +
    `Run the ccrc-coordinator skill.`;
}

// ── the raise: `POST /api/approvals` after the kill switch and attribution (Q3e, D-7029) ───────────────────────────

/** The request the route hands in once its own ladder (store, box token, body shape, kill switch, attribution) has
 *  passed: the body's fields, already shape-checked. Exactly one of `canonical` and `truncated` is present. */
export interface ApprovalRaiseRequest {
  readonly sessionId: string;
  readonly digest: string;
  readonly nonce: string;
  readonly canonical?: string;
  readonly truncated?: true;
}

/** What `raiseApproval` reads, named and passed in, never reached for. Built ONCE in `registerCoordRoutes` from its own
 *  closures, unchanged: `signerFor` stays there (`GET /api/approvals/key` and the rule handler read it too),
 *  `denyEngaged` stays there (round 2's D-6205 edits it where it is), and so do `liveVersionOf` and
 *  `journalDigestMismatch`. `heldFor` and `rulingsAllowedHere` are the real functions, passed so this file imports no
 *  outer ring at runtime. `coord`, `io`, `cfg` and `tmux` are the server's, for `readRegistry`, `heldFor`,
 *  `rootsForChild` and `queueSystemMail`. */
export interface ApprovalRaiseDeps {
  readonly coord: CoordStore;
  readonly io: ReclaimDeps['io'];
  readonly cfg: ReclaimDeps['cfg'];
  readonly tmux: ReclaimDeps['tmux'];
  /** The egress masker (`deps.masker ?? SHAPE_ONLY_MASKER`): the exact-bytes pass over the stored input. */
  readonly masker: { maskText(text: string): string };
  readonly signerFor: () => ApprovalSigner | null;
  readonly rulingsAllowedHere: typeof rulingsAllowedHere;
  readonly heldFor: typeof heldFor;
  readonly denyEngaged: (rec: SessionRecord) => Promise<boolean>;
  readonly liveVersionOf: (rec: SessionRecord) => Promise<string | null>;
  readonly journalDigestMismatch: (sessionId: string, now: number) => void;
}

/** `raiseApproval`'s answer: one arm per refusal word, in ladder order, each carrying the detail the route prints, and
 *  the mint. A new arm with no mapping is a type error in the route (`satisfies never`). */
export type ApprovalRaiseVerdict =
  | { readonly kind: 'single-box'; readonly detail: string }
  | { readonly kind: 'internal'; readonly detail: string }
  | { readonly kind: 'not-a-child' }
  | { readonly kind: 'deny-not-engaged' }
  | { readonly kind: 'version-unverified'; readonly detail: string }
  | { readonly kind: 'digest-mismatch' }
  | { readonly kind: 'run-unreadable'; readonly detail: string }
  | { readonly kind: 'approval-released'; readonly id: number; readonly releaseReason: ApprovalMintReleaseReason }
  | { readonly kind: 'minted'; readonly id: number; readonly waitS: number };

/** The unredacted input a held row was classified from, as the instance holds it for the row's window. */
export interface HeldApprovalInput {
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly cwd: string | null;
  readonly until: number;
}

/** What `lapseApprovals` reads from its caller (Q3d): the hold's grace after every covered row was ruled
 *  (`watch.ts`'s `APPROVAL_RULED_GRACE_MS`, handed in unchanged as Q3c's decider takes it), the dialog the pane shows
 *  for a child (the watcher's pane-edge map `dialogIds`), and the sink a deferred push is sent through. */
export interface ApprovalLapseInput {
  readonly now: number;
  readonly graceMs: number;
  readonly paintedDialogOf: (childId: string) => string | undefined;
  readonly push: (ev: QuestionPush) => void;
}

/** One composition's owner of question state. Q3e: the raise and the approval inputs it holds. Q3d: the hold carrier
 *  and every act on it, as closure locals of `createQuestions` too. */
export interface Questions {
  /** D-5290 (coordinator-first routing spec §5.2): THE ONE DECISION every hold goes through, for the dialog `r`'s pane
   *  paints with this tick's hookstate `hs`: a permission prompt's deferral, or an eligible ask's mint. Answers what to
   *  send now; the caller sends it. */
  raise(r: SessionRecord, dialog: Dialog, hs: HookState | null, actions: PushPayload['actions'] | null, recs: readonly SessionRecord[]): Promise<RaiseVerdict>;
  /** D-5925: read the boot's snapshot of held rows, once per instance (a later call is a no-op). */
  loadReseed(): void;
  /** D-5925: decide child `r` from the rows the boot found, against this tick's pane, dialog and hookstate. */
  reseed(r: SessionRecord, pane: string | null, dialog: Dialog | null, hs: HookState | null): ReseedVerdict;
  /** D-5925, spec §5.2 step 3: settle every re-seed candidate whose child is measured absent from `listing`. */
  reseedGone(listing: readonly string[], recs: readonly Pick<SessionRecord, 'id'>[]): void;
  /** The pane showed a NEW dialog for `childId` where `last` was (or nothing was known): the old question's holds end. */
  settleReplaced(childId: string, last: string | undefined): void;
  /** The pane's dialog `dialogId` for `childId` went away with nothing to replace it: its holds end, nothing pushed. */
  settleCleared(childId: string, dialogId: string): void;
  /** D-2403: the same dialog `dialogId` is still painted for `childId`: re-stamp its held ask's `askAt` to `hs`. */
  restamp(childId: string, dialogId: string, hs: HookState | null): void;
  /** The ask half's switch read (D-5864): `asks-disabled` as this pass's listing shows it, which later holds read. */
  noteAsksSwitch(disabled: boolean): void;
  /** The ask half's lapse at `now`: each push it sends goes through `push`, in today's order. */
  lapseAsks(now: number, push: (ev: QuestionPush) => void): void;
  /** The approval half's lapse, ceiling and deferred pushes (`ApprovalLapseInput`); a throwing store read throws. */
  lapseApprovals(input: ApprovalLapseInput): void;
  /** The approval half's daily retention (spec §6.7): approval inputs, then the asks' question text. */
  prune(now: number): void;
  /** `POST /api/asks/:id/release`'s door in: the held ask's snapshot to push now, or null. */
  released(childId: string): QuestionPush | null;
  /** D-5289: `POST /api/asks/:id/answer` settled row `askId` late; the push that replaces its lapse, or null. */
  answeredLate(childId: string, askId: number, parent: string): QuestionPush | null;
  /** D-5440: `POST /api/approvals/:id/release`'s door in, with the dialog the pane shows: the deferred push, or null. */
  approvalReleased(childId: string, paintedDialogId: string | undefined): QuestionPush | null;
  /** `POST /api/approvals/:id/rule`'s door in: the push replacing an earlier prompt notification, or null. */
  approvalRuled(childId: string, agentId: string, parent: string, verdict: 'allow' | 'deny', painted: boolean, projectOf: () => string): QuestionPush | null;
  /** The stall lane's read (`watch.ts#stallWorkerFor`): the child's newest asks row, the store's answer unchanged. */
  currentAskOf(childId: string): AskReadResult;
  /** `POST /api/approvals`'s steps 6 to 15 (spec §6.3 server steps 1 to 3), cheapest refusal first, nothing minted on
   *  any refusal above the mint: the single-box opt-in, the signer, the registry's `ChildMark`, Task 15's spawn fields,
   *  the live version, the digest and the re-canonicalisation (journaled), and the claimant rule (`heldFor`, D-5530):
   *  `not-a-child` with nothing minted, or a row minted `released` with its reason, or held. A held request whose class
   *  is `forbidden` is minted `released` too, never mailed. Then the mint, the input held, the mail, and `{id, waitS}`,
   *  the window in seconds (D-5441). */
  raiseApproval(request: ApprovalRaiseRequest, raiseDeps: ApprovalRaiseDeps, now: number): Promise<ApprovalRaiseVerdict>;
  /** The input held for row `id`, after forgetting every input whose window has passed at `now`; undefined when none
   *  is held (a restarted server, a released row, a ruled or handed-over one). */
  approvalInput(id: number, now: number): HeldApprovalInput | undefined;
  /** Forget row `id`'s input (a ruling stored, a hand-over). */
  forgetApprovalInput(id: number): void;
}

/** The test-only view of one instance's carrier (`questionsTestView`), by the shapes the watcher's maps had: the held
 *  asks and held prompts per child (fresh maps over the live entries), a door to plant a held ask as `hold()` would
 *  have left it, and the ask hold's switch. */
export interface QuestionsTestView {
  heldAsks(): Map<string, HeldAsk>;
  heldApprovals(): Map<string, HeldApproval>;
  /** `ev` may carry a fixture's own `tag`, which a production push does not; it rides to the push as it did. */
  plantHeldAsk(childId: string, held: Omit<HeldAsk, 'childId' | 'ev'> & { readonly ev: QuestionPush & { readonly tag?: string } }): void;
  asksDisabled(): boolean;
}

/** The key the instance's test view hangs on: a property no production reader names, and no state of its own. */
const TEST_VIEW: unique symbol = Symbol('questionsTestView');

/** TEST-ONLY: the carrier of `questions`, for the suites that read the watcher's private maps by cast before W3 Q3d
 *  (named exception 1). It reads no global: the view is the instance's own. */
export function questionsTestView(questions: Questions): QuestionsTestView {
  return (questions as Questions & { readonly [TEST_VIEW]: QuestionsTestView })[TEST_VIEW];
}

/** A new owner of question state for one composition: one per `FleetWatcher`, one per server. Holds nothing at module
 *  scope, so every call is independent of every other. `rules` is the hold's claimant rule (Q3d), which the watcher
 *  passes and a server's own instance does without. */
export function createQuestions(deps: QuestionsDeps, rules?: QuestionRules): Questions {
  /** The unredacted input a held row was classified from, kept ONLY in memory and only for the row's window (spec
   *  §6.7: the server holds the unredacted input only for the request), so the rule route can run the guard again
   *  (spec §6.3 server step 5). A server restarted mid-window has none, and then an allow is refused `guard-escalate`
   *  (the guard cannot be re-run, and unknown means escalate); a deny still lands (D-5491). */
  const approvalInputs = new Map<number, HeldApprovalInput>();
  const forgetExpiredInputs = (now: number): void => {
    for (const [k, v] of approvalInputs) if (v.until <= now) approvalInputs.delete(k);
  };

  const raiseApproval = async (request: ApprovalRaiseRequest, d: ApprovalRaiseDeps, now: number): Promise<ApprovalRaiseVerdict> => {
    const { sessionId, digest, nonce, canonical, truncated } = request;
    const coord = d.coord;
    if (!d.rulingsAllowedHere(d.cfg.role, d.cfg.fleetMode, d.cfg.ccrcDir)) {
      return { kind: 'single-box', detail: 'this server shares one box with the sessions; place ~/.ccrc/approvals-single-box to opt in' };
    }
    const signer = d.signerFor();
    if (signer === null) return { kind: 'internal', detail: 'the approval signing key is not loaded' };

    // [registry-refused:refuses] a refused row is in no `recs`: the request answers `not-a-child`, and a refused claimant reads as `parent-not-live` in `heldFor`, which leaves the prompt the operator's.
    const recs = await readRegistry(d.io, d.cfg);
    const rec = recs.find((r) => r.id === sessionId) ?? null;
    if (rec === null || rec.child.kind !== 'child') return { kind: 'not-a-child' };
    if (!(await d.denyEngaged(rec))) return { kind: 'deny-not-engaged' };
    const version = await d.liveVersionOf(rec);
    if (version === null || !APPROVAL_HOOK_VERSIONS.includes(version)) {
      return { kind: 'version-unverified', detail: `this child's live Claude Code version (${version ?? 'unread'}) is not one the rig verified` };
    }

    // The digest, then the re-canonicalisation: the server's own sha256 over the string sent, and that string parsed and
    // canonicalised again by `approvalDigestBytes`, the one home of the form (spec §6.3 "The canonical form, exactly").
    let parsedRequest: { sessionId: unknown; agentId: unknown; tool: unknown; cwd: unknown; input: unknown } | null = null;
    if (typeof canonical === 'string') {
      let parsed: unknown = undefined;
      try { parsed = JSON.parse(canonical); } catch { parsed = undefined; }
      const arr = Array.isArray(parsed) && parsed.length === 5 ? parsed : null;
      const again = arr === null ? null : approvalDigestBytes({
        session_id: arr[0], agent_id: arr[1], tool_name: arr[2], cwd: arr[3], tool_input: arr[4],
      });
      if (createHash('sha256').update(canonical, 'utf8').digest('hex') !== digest || again !== canonical || arr === null) {
        d.journalDigestMismatch(sessionId, now);
        return { kind: 'digest-mismatch' };
      }
      parsedRequest = { sessionId: arr[0], agentId: arr[1], tool: arr[2], cwd: arr[3], input: arr[4] };
    }

    let verdict: Awaited<ReturnType<typeof heldFor>>;
    try {
      verdict = await d.heldFor({ coord, io: d.io, cfg: d.cfg, tmux: d.tmux }, rec.id, rec.child, recs, now);
    } catch (err) {
      return { kind: 'run-unreadable', detail: err instanceof Error ? err.message : String(err) };
    }
    if (verdict.kind === 'not-a-child') return { kind: 'not-a-child' };

    // The request's own shape: a truncated request has no input to judge, and a canonical array whose fields are not a
    // request's is unparseable. Both are minted `released` (the operator has them), never held.
    const shaped = parsedRequest !== null && typeof parsedRequest.agentId === 'string' && typeof parsedRequest.tool === 'string'
      && (parsedRequest.cwd === null || typeof parsedRequest.cwd === 'string')
      && parsedRequest.input !== null && typeof parsedRequest.input === 'object' && !Array.isArray(parsedRequest.input);
    const agentId = shaped ? parsedRequest!.agentId as string : '';
    const tool = shaped ? parsedRequest!.tool as string : '';
    const input = shaped ? parsedRequest!.input as Record<string, unknown> : {};
    const cwd = shaped ? parsedRequest!.cwd as string | null : null;
    const cwdTrusted = APPROVAL_CWD_TRUSTED.includes(version);
    const roots = rootsForChild(rec, d.cfg.home) ?? { worktree: null, tmpRoot: null, scratch: null, home: d.cfg.home };
    const cls = shaped ? approvalClass(tool, input, { ...roots, cwd: cwdTrusted ? cwd : null }) : 'escalate';
    const shown = shaped ? (typeof input['command'] === 'string' ? input['command'] : (canonicalJson(input) ?? '')) : '';
    const releaseReason: ApprovalMintReleaseReason | null = truncated === true ? 'truncated'
      : !shaped ? 'unparseable'
      : verdict.kind === 'released' ? verdict.reason
      : cls === 'forbidden' ? 'forbidden'
      : null;
    const parent = verdict.parent;
    const notifyAt = now + approvalWindowMs(agentId);
    // The stored input is what the signed ruling carries unmasked (`GET /api/approvals/:id/ruling`), so the
    // exact-bytes pass runs HERE, on the raw input before the redactor and the cap: a fingerprinted lane key that has
    // no shape is masked in the row, the brief and the ruling alike (D-5995 (10), D-6057 (3)). The digest
    // the ruling is signed over is of the unredacted input, so this changes no signature.
    const stored = redactedStored(d.masker.maskText(shown));
    const id = coord.insertApproval({
      childId: rec.id, parentId: parent, runId: verdict.runId, digest, nonce, agentId, tool,
      inputRedacted: stored, truncated: truncated === true, class: cls, askAt: now, notifyAt,
      ...(releaseReason === null ? {} : { releaseReason }),
    });
    if (releaseReason !== null) {
      // Released at once: the hook prints nothing, the menu stays with the operator, and nobody is mailed.
      return { kind: 'approval-released', id, releaseReason };
    }
    approvalInputs.set(id, { tool, input, cwd: cwdTrusted ? cwd : null, until: notifyAt });
    queueSystemMail(coord, null, {
      fromId: 'operator', toId: parent, runId: null, kind: 'question', subject: approvalNudgeSubject(id),
      body: renderApprovalBrief({ id, childId: rec.id, tool, agentId, inputRedacted: stored, class: cls, digest, notifyAt }),
    });
    return { kind: 'minted', id, waitS: Math.floor((notifyAt - now) / 1000) };
  };

  // ── the hold carrier (Q3d, D-7028) ─────────────────────────────────────────────────────────────────────────────

  /**
   * THE ONE CARRIER of this instance's held questions, keyed by question (`ask-<rowId>`, `approval-child-<childId>`).
   * IN MEMORY BY DESIGN and not in coord.db (D-2169): it is the only carrier of a deferred push, so a lost database must
   * not be able to swallow it. A server restart empties it; since D-5925 the boot re-seeds it FROM THE ROWS (the
   * `reseed-pending` entries): a `held` or `answering` row whose dialog the pane is measured still painting, with the
   * same `askKey`, is held again until `askNotifyAt(at)`, so the deferred push still fires (late if the deadline passed
   * while the server was down). A lost `coord.db` has no rows, and the restart then re-pushes nothing, as before D-5925:
   * the watcher is unprimed on the first tick after boot and its `dialogIds` suppresses the second.
   *
   * A HELD ASK (today's `heldAsks` value) is cleared in TWO places, both keyed off the dialog leaving the pane: the
   * orphan-settle (`settleReplaced`), when a NEW dialog silently replaces an old one with no intervening clear tick; and
   * (Task 8) the clear (`settleCleared`), when the dialog goes away with nothing to replace it — an unanswered
   * `AskUserQuestion` the operator escaped, or the session interrupted, cleared, swapped, or killed out from under it.
   * Either way the dialog's own departure from the pane is the end of the hold; the second case settles the row `stale`
   * and pushes nothing, since a cleared dialog is a question that no longer exists. `answeringSince` (fix round 1, item
   * 1): `null` until the ask half first observes the row `'answering'`, then that sweep's own `now` — never re-derived,
   * and reset to `null` the moment the row is observed back at `'held'` (a sweep decision, not `hold`'s — see
   * `ASK_ANSWERING_MAX_MS`'s own docstring).
   *
   * A LAPSED ASK (D-5289, late answer wins; today's `lapsedAsks`): the push the lapse fired, per child, kept so a parent's
   * answer after the deadline can replace that notification under the same tag (`answeredLate`). Set only by the ask
   * half's own lapse (a parent's `declined` never lands here: its push is the parent's own act), dropped when replaced and
   * whenever the child's dialog clears or is replaced, so at most one per child sitting on a lapsed question. Its loss on
   * a restart is free: the operator keeps the lapse's notification, today's behaviour.
   *
   * A HELD PROMPT (D-5298, plan Task 16; today's `heldApprovals`): the operator's deferred push for a child whose painted
   * permission prompt has an approvals row held for its claimant (`raise`'s approval arm). `until` is the latest
   * `notifyAt` of the rows it covers; `rowIds` are those rows (the main thread's only, D-5491), so a cleared dialog marks
   * only them `operator`. The approval half pushes `ev` once no covered row is held any more and the dialog is still
   * painted. In memory only, as a held ask is: a restart empties it, and since D-5925 the boot re-seeds it from a
   * snapshot of the child's main-thread rows still `held` at boot, once the pane is measured painting a permission
   * prompt; a row already `released` at boot is never re-seeded (its lapse may have pushed before the restart). Before
   * D-5925 a restart lost the deferral and the dialog never raised: `dialogIds` suppresses every sighting after the
   * unprimed boot tick.
   *
   * A RE-SEED CANDIDATE (D-5925, held questions survive a restart; today's `pendingReseed`): what the boot found held in
   * `coord.db`, per child, still to be matched against a MEASURED pane. Filled once, on the first unprimed tick (before
   * that tick's approval half), and consumed by every tick before `raise` can run for the child (`reseed`), so a pane the
   * boot tick could not measure is decided by a later tick and never mints a second row. Bounded by the number of
   * children with a held row: at most one ask row per child (the newest) and that child's held main-thread approval rows
   * (`id`, `notifyAt`). An entry leaves when its half is decided.
   *
   * ORDER. A Map iterates in insertion order, and the two lapse halves push in it. An entry that changes phase is deleted
   * and set again, so it moves to the end as it did when it moved from one of today's maps to another; an entry that
   * replaces its child's entry of the same phase takes that entry's place, as `Map.set` on today's child key did.
   */
  const questionHolds = new Map<string, QuestionHold>();
  /** Set once the boot snapshot behind the `reseed-pending` entries has been read (or there was no store to read). */
  let reseedLoaded = false;
  /** Fail-shut kill switch for the hold, `$REG/asks-disabled`, as the last ask pass read it (`noteAsksSwitch`, off the
   *  same registry listing `sweepMail` reads for `MAIL_DISABLED_MARKER`): `listing === null` ("can't tell") reads as
   *  disabled, never as license to keep holding. `raise` reads it. */
  let asksDisabled = false;

  const askHoldKey = (askId: number): string => `ask-${askId}`;
  const approvalHoldKey = (childId: string): string => `approval-child-${childId}`;
  /** The key and entry of `childId`'s ask in `phase`, or undefined (at most one per child and phase). */
  const askEntry = <P extends QuestionHoldPhase>(childId: string, phase: P):
    [string, Extract<QuestionHold, { kind: 'ask'; phase: P }>] | undefined => {
    for (const [k, v] of questionHolds) {
      if (v.kind === 'ask' && v.phase === phase && v.childId === childId) return [k, v as Extract<QuestionHold, { kind: 'ask'; phase: P }>];
    }
    return undefined;
  };
  const approvalEntry = <P extends Exclude<QuestionHoldPhase, 'lapsed'>>(childId: string, phase: P):
    Extract<QuestionHold, { kind: 'approval'; phase: P }> | undefined => {
    const v = questionHolds.get(approvalHoldKey(childId));
    return v !== undefined && v.kind === 'approval' && v.phase === phase ? v as Extract<QuestionHold, { kind: 'approval'; phase: P }> : undefined;
  };
  /** Put `value` at `key`. When `replacing` names an entry it takes that entry's place in the order; otherwise it goes
   *  to the end (an existing `key` is deleted first, so a phase change moves to the end). */
  const put = (key: string, value: QuestionHold, replacing?: string): void => {
    if (replacing !== undefined && questionHolds.has(replacing)) {
      const all = [...questionHolds];
      questionHolds.clear();
      for (const [k, v] of all) {
        if (k === replacing) questionHolds.set(key, value);
        else if (k !== key) questionHolds.set(k, v);
      }
      return;
    }
    questionHolds.delete(key);
    questionHolds.set(key, value);
  };
  /** `heldAsks.set(childId, held)`. */
  const setHeldAsk = (childId: string, held: Omit<HeldAsk, 'childId'>): void => {
    put(askHoldKey(held.askId), { kind: 'ask', phase: 'held', childId, ...held }, askEntry(childId, 'held')?.[0]);
  };
  /** `lapsedAsks.set(childId, lapsed)`. */
  const setLapsedAsk = (childId: string, askId: number, ev: QuestionPush): void => {
    put(askHoldKey(askId), { kind: 'ask', phase: 'lapsed', childId, askId, ev }, askEntry(childId, 'lapsed')?.[0]);
  };
  /** `heldApprovals.set(childId, held)`: the child's key, kept in place when it already holds a prompt. */
  const setHeldApproval = (childId: string, held: Omit<HeldApproval, 'childId'>): void => {
    const key = approvalHoldKey(childId);
    const value: QuestionHold = { kind: 'approval', phase: 'held', childId, ...held };
    if (approvalEntry(childId, 'held') !== undefined) questionHolds.set(key, value);
    else put(key, value);
  };
  const dropAsk = (childId: string, phase: QuestionHoldPhase): void => {
    const e = askEntry(childId, phase);
    if (e !== undefined) questionHolds.delete(e[0]);
  };
  const dropApproval = (childId: string, phase: Exclude<QuestionHoldPhase, 'lapsed'>): void => {
    if (approvalEntry(childId, phase) !== undefined) questionHolds.delete(approvalHoldKey(childId));
  };
  const heldAskEntries = (): Array<Extract<QuestionHold, { kind: 'ask'; phase: 'held' }>> =>
    [...questionHolds.values()].filter((v): v is Extract<QuestionHold, { kind: 'ask'; phase: 'held' }> => v.kind === 'ask' && v.phase === 'held');
  const hasReseedPending = (): boolean => [...questionHolds.values()].some((v) => v.phase === 'reseed-pending');

  // ── raise: the one hold decision (D-5290) ──────────────────────────────────────────────────────────────────────

  /**
   * Mint the ask row, snapshot the push `raise()` would have sent, and queue
   * the mail that wakes the parent. Called ONLY from `raise`, which has
   * already proven `actions !== null` (so `ask` is a single-question envelope
   * with readable labels), the child mark and `parent !== null && parent !==
   * r.id`. With a `releaseReason` (D-5290) the row is minted `released` and no
   * mail is queued; the caller pushes `ev` at once.
   *
   * `ev` is snapshotted here, not re-derived at release (Task 7's
   * `sweepAsks`) or at answer time — nothing persists a tick-local closure
   * past its tick, and `detectDialogs`'s two triggers (`last !== dialog.id`
   * there, the amendment branch beside it) are one-shot edges: `dialogIds` is
   * stamped on first sighting whether or not a push was raised, so there is
   * no second chance to re-build the same object later.
   */
  const hold = (
    r: SessionRecord, dialog: Dialog, actions: PushPayload['actions'],
    hs: HookState, ask: Extract<HookAsk, { questions: HookAskQuestion[] }>, parent: string,
    releaseReason: AskMintReleaseReason | null,
  ): { until: number; askId: number; ev: QuestionPush; answeringSince: number | null } => {
    const q = ask.questions[0]!;
    const key = askKey(ask);
    // `actions !== null` (askActions) already proved a key exists — this
    // throw is unreachable by construction and exists only so a future
    // drift between `askActions` and `askKey` fails loudly instead of
    // minting a row with a null key.
    if (key === null) throw new Error(`hold: eligible ask on ${r.id} produced no askKey`);
    // D-5298 (spec §5.4, §6.7; D-5366 closed): the question and its option labels are a child's text, so they are
    // redacted before the row stores them and before the brief carries them. The pane is answered by index, never by
    // label, so a masked label presses the same option.
    const question = redactCommand(q.question);
    const options = q.options.map((o) => redactCommand(o.label));
    const now = Date.now();
    // D-5294: the one deadline, read by the sweep (`until`) and stated in the brief.
    const until = askNotifyAt(now);
    // Same run `parentOfSession` derived the parent from — `openRunsForSession`
    // mirrors its `ORDER BY id DESC LIMIT 1` pick via "last of the ASC list",
    // the same idiom `sweepMerged` in `watch.ts` already uses. Recorded on the ask
    // row for provenance; the OPERATOR MAIL below deliberately does NOT carry
    // it (see that call's own comment).
    // D-2545. ABORT THE MINT rather than hold a question against a run this
    // box could not read: `hold` is called inside `raise`'s try/catch,
    // which answers `none`, so the caller falls back to the EXISTING immediate-operator-push `raise()` —
    // minting no ask row and no parent mail, which is exactly the ruled
    // behaviour. Reached by a typed result rather than by `node:sqlite`'s bare
    // `RangeError`, but landing in the same place on purpose, and it throws
    // BEFORE `insertAsk` so there is nothing to compensate.
    const sib = deps.coord!.bindingsOf(r.id).worker();
    if (!sib.ok) throw new Error(`hold: ${sib.detail}`);
    const openRuns = sib.siblings;
    const runId = openRuns.length > 0 ? openRuns[openRuns.length - 1]!.id : null;
    const askId = deps.coord!.insertAsk({
      childId: r.id, parentId: parent, runId, askKey: key, askAt: hs.updatedAt,
      dialogId: dialog.id, question, options, now,
      ...(releaseReason === null ? {} : { releaseReason }),
    });
    const ev = askHoldPayload(r, hs, dialog, actions);
    // The parent is asleep and nothing else will wake it. Ordinary mail, so
    // the existing idle gating applies unchanged — and the latency does not
    // gate the operator, because the operator's own push is racing this hold
    // on its own clock. The subject is unique BY CONSTRUCTION: mail dedupe is
    // subject-keyed, so a fixed subject would refuse the second ask of the
    // day as a restatement of the first. `runId: null` and `run: null`,
    // deliberately, mirroring `queueProgramKickoff`'s own reasoning: this
    // message is not a wave artifact — it rides the run-less peer-mail lane
    // (bounded by its own quota) rather than a run's lifecycle, and
    // `renderEnvelope` skips the program/wave/waveOf fields whenever `runId`
    // is null, so nothing is lost by not attaching the run we just derived.
    // `askNudgeSubject` (fix round 2, item 3), not a hand-spelled `` `ask:` ``
    // literal: `isAskNudgeMail` in the same module must recognise exactly
    // this shape, and a queue/reader pair spelling one convention twice is
    // the kind of thing that drifts.
    // D-5290: a row minted released mails nobody — nobody is held for it
    // (D-5530's fail-closed reasons), and the operator already has the push.
    if (releaseReason === null) {
      queueSystemMail(deps.coord!, null, {
        fromId: 'operator', toId: parent, runId: null, kind: 'question',
        subject: askNudgeSubject(askId), body: renderAskBrief(askId, r.id, question, options, until),
      });
    }
    return { until, askId, ev, answeringSince: null };
  };

  /**
   * `raise`'s approval arm (plan Task 16, D-5298): the child's rows that are `held` and still inside their window.
   * With one or more, the operator's push is snapshotted and recorded (D-2172: the record is the operator's durable
   * trace) but not sent, and the approval half sends it when the window ends, the claimant hands the prompt over, or
   * the hook has not resolved a ruled prompt. Any failure answers `none`: the prompt raises as today.
   */
  const holdApproval = (r: SessionRecord, dialog: Dialog, hs: HookState): RaiseVerdict => {
    const coord = deps.coord;
    if (!coord) return { kind: 'none' };
    try {
      const now = Date.now();
      const read = coord.approvalsForChild(r.id, ['held']);
      if (!read.ok) return { kind: 'none' };
      // Only the main thread's rows (D-5491): the painted menu is the main thread's, because a background subagent's
      // is painted only after its hook returns (D-5440; a fleet child's subagents are background ones, D-5443). A
      // subagent's held row neither withholds this push nor is marked `operator` when this dialog clears.
      const open = read.rows.filter((x) => x.agentId === '' && now < x.notifyAt && x.releaseReason === null);
      if (open.length === 0) return { kind: 'none' };
      const ev = askHoldPayload(r, hs, dialog, null); // the builder the restart re-seed shares (D-5925)
      setHeldApproval(r.id, { until: Math.max(...open.map((x) => x.notifyAt)), dialogId: dialog.id, rowIds: open.map((x) => x.id), ev });
      return { kind: 'held', parent: open[open.length - 1]!.parentId, record: { ...ev, recordAlways: true, recordOnly: true } };
    } catch (err) {
      console.warn(`ccrc-server: approval hold failed for ${r.id} (${err instanceof Error ? err.message : String(err)}) — falling back to an immediate push`);
      return { kind: 'none' };
    }
  };

  /**
   * D-5290 (coordinator-first routing spec §5.2): THE ONE DECISION every hold
   * goes through — `detectDialogs`' first sighting, its deferred first raise
   * and its amendment branch alike, so the envelope that arrives a tick after
   * the menu is held exactly as one that arrived with it. Answers `none` (raise
   * to the operator as today), `held` (minted `held`, the parent mailed, the
   * operator's push deferred, and the record the caller sends now) or `released`
   * (minted `released` with its reason, and the push the caller sends on this tick).
   *
   * The checks, in order, each `none` when it fails:
   *  - D-2173: ELIGIBILITY IS `askActions`, and nothing else. Its own contract
   *    is "offer an action only where `answerAsk` would accept it", so every
   *    ask it refuses — an approval, a multi-question envelope, a
   *    multi-select, a free-text ask, a blank label — is one no principal
   *    could answer through this lane. `'questions' in ask` is redundant with
   *    `actions !== null` at runtime; it exists so the compiler knows
   *    `ask.questions[0]` is safe to read inside `hold`.
   *  - the kill switch (`$REG/asks-disabled`, `asksDisabled`).
   *  - THE CHILD MARK (spec §4): the registry row's `ChildMark` is
   *    `{kind: 'child'}`. `none` and `unreadable` never hold: a run can name
   *    any session (`POST /api/runs`, until Task 11b), so `parentOfSession`
   *    alone does not make an operator-created session a child.
   *  - the self-claim guard (`parentOfSession` answering `r.id` itself), the
   *    run the mark names exists, and some open run names the child at all
   *    (none is not a child, spec §4).
   *  Then, past those, the row is minted either way (D-5530,
   *  cross-project-claimant-holds-asks, the operator's ruling of 2026-10-18:
   *  the ask is held for the child's run's recorded claimant WHEREVER that
   *  claimant sits — no project is compared — and everything else fails
   *  CLOSED, released to the operator with a reason that says why):
   *  - the run has a claimant: `parentOfSession` answers one and the run the
   *    mark names records one (else `run-unclaimed`, held for nobody, so the
   *    row's parent is `ASK_OPERATOR_PRINCIPAL`);
   *  - the parent is the claimant of the run the mark names — the minting
   *    run (else `run-other-programme`, the same). Compared by claimant, not by
   *    run id: a wave N >= 2 run resumes the SAME workspace (`dispatch.ts`'s
   *    resume arm), whose marker still names wave 1, and `reclaimProgram`
   *    moves every run of a programme to its heir together, so the claimant
   *    is the one fact the binding run and the minting run share;
   *  - the minting run's claimant was ATTRIBUTED (D-5531, the ruling's
   *    "correctly attributed"): the run is not journaled `unattributed` and
   *    carries its `coordProject` stamp (else `run-unattributed`, the same —
   *    held for nobody). A run opened with no `claimedByUuid` before the fleet
   *    carried the client, or before the attributed binding, records a
   *    `claimedBy` nobody proved, and a recorded name alone is not a parent;
   *  - the parent's registry row exists, is neither archived nor stopped, and
   *    is not measured dead by `claimantMeasuredDead`, the predicate
   *    `sweepDeadCoordinators` reads (else `parent-not-live`);
   *  - the claimant ladder could measure it (else `parent-unmeasured`: doubt
   *    is not a hold).
   *
   * Fix round 1, item 2 (Important): `parentOfSession` and everything `hold`
   * does (`openRunsForSession`, the WRITE `insertAsk`, `queueSystemMail`'s own
   * `tx()`/`BEGIN IMMEDIATE`, plus `hold`'s own throw on a key-derivation
   * drift) reach `node:sqlite` directly, unguarded — and `tick()` is fired as
   * `void this.tick()` with no `unhandledRejection` handler anywhere in this
   * tree, so an unguarded throw here would kill the whole process. ANY FAILURE
   * ANSWERS `none`, so the caller falls back to `raise()`: the lane degrades to
   * today's ordinary immediate push rather than losing the question or the
   * process.
   */
  const raise = async (
    r: SessionRecord, dialog: Dialog, hs: HookState | null, actions: PushPayload['actions'] | null, recs: readonly SessionRecord[],
  ): Promise<RaiseVerdict> => {
    const none = { kind: 'none' } as const;
    const ask = hs?.ask ?? null;
    // D-5298 (plan Task 16): a permission prompt is held when its child's hook already asked and the server minted a
    // row HELD for the claimant (`POST /api/approvals` decided the claimant rule, the kill switches and the gates); the
    // push waits for that row's window. No row, or none still inside its window: the prompt raises as today.
    if (hs !== null && ask !== null && 'approval' in ask) return holdApproval(r, dialog, hs);
    if (actions === null || hs === null || ask === null || !('questions' in ask)) return none;
    const coord = deps.coord;
    if (!coord || asksDisabled) return none;
    const mark = r.child;
    if (mark.kind !== 'child') return none;
    try {
      if (rules === undefined || deps.io === undefined || deps.cfg === undefined || deps.tmux === undefined) {
        throw new Error('this Questions instance was made without the claimant rule');
      }
      // D-5530, D-5531: the one claimant decision, shared with the approvals lane (`coord/heldFor.ts`).
      const verdict = await rules.heldFor(
        { coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, r.id, mark, recs, Date.now());
      if (verdict.kind === 'not-a-child') return none;
      const held = { parent: verdict.parent, reason: verdict.kind === 'released' ? verdict.reason : null };
      const reason = held.reason;
      const mint = hold(r, dialog, actions, hs, ask, held.parent, reason);
      if (reason !== null) {
        // Released at once: the operator's answerable push fires on THIS
        // tick, never after the window, and no hold is kept for the sweep.
        return { kind: 'released', push: mint.ev };
      }
      // D-2172: the RECORD is minted now, not at release. `pushOne` returns
      // before `notifyLog.record` when the operator is looking, so suppressing
      // the raise without recording would delete the operator's only durable
      // trace of a question their parent then answered in their name. The
      // caller sends `record` (slug q3d-record-after-hold).
      setHeldAsk(r.id, mint);
      return { kind: 'held', parent: held.parent, record: { ...mint.ev, recordAlways: true, recordOnly: true } };
    } catch (err) {
      console.warn(`ccrc-server: ask hold failed for ${r.id} (${err instanceof Error ? err.message : String(err)}) — falling back to an immediate push`);
      // Fix round 2, item 2: `insertAsk` and `queueSystemMail` are SEPARATE
      // transactions inside `hold()` — a throw after the first commits (inside
      // `queueSystemMail`'s own `tx()`, or in the carrier write after it)
      // would otherwise leave an ask row `held` with NO held entry:
      // unreachable by Task 7's carrier-keyed sweep and Task 8's dialog-keyed
      // `staleAsk`, while the fallback `raise()` means the operator gets the
      // push AND a nudged parent may still act on the very question that push
      // just escalated. Settle whatever may have committed — a no-op (0 rows
      // changed) in the common case where nothing did — wrapped so the
      // compensation itself cannot throw OUT of this catch.
      try {
        coord.staleAsk(dialog.id, r.id, Date.now());
      } catch (compErr) {
        console.warn(`ccrc-server: ask hold compensation failed for ${r.id} (${compErr instanceof Error ? compErr.message : String(compErr)}) — a held row may remain orphaned`);
      }
      return none;
    }
  };

  // ── the re-seed (D-5925) ───────────────────────────────────────────────────────────────────────────────────────

  /** A re-seed candidate the pane disproved, settled `stale` through the existing CAS; guarded, as its neighbours are
   *  (a synchronous `node:sqlite` UPDATE on the 2 s poll). */
  const staleReseedRow = (childId: string, row: AskRow): void => {
    try {
      deps.coord?.staleAsk(row.dialogId, childId, Date.now());
    } catch (err) {
      console.warn(`ccrc-server: settling a held ask at boot failed for ${childId} (${err instanceof Error ? err.message : String(err)}) — a held row may remain in coord.db`);
    }
  };

  /** D-5925: the boot's one read of the held rows into the `reseed-pending` entries (spec §5.2 step 1, §5.3). At most
   *  one ask row per child, the newest by `id`: a child paints one question at a time, so an older held row of the same
   *  child is settled `stale` at once (when it names the same dialog, `staleAsk`'s `dialogId` key settles it with the
   *  newest instead). The approvals half is the main thread's `held` rows only, never `released` ones. A read that fails
   *  re-seeds that half from nothing: the restart behaves as it did before D-5925. Once per instance. */
  const loadReseed = (): void => {
    if (reseedLoaded) return;
    reseedLoaded = true;
    const coord = deps.coord;
    if (!coord) return;
    try {
      const asks = coord.heldQuestionRows();
      if (!asks.ok) console.warn(`ccrc-server: held asks unreadable at boot (${asks.detail}) — none re-seeded`);
      else for (const row of asks.asks) {
        const prev = askEntry(row.childId, 'reseed-pending');
        if (prev !== undefined && prev[1].row.dialogId !== row.dialogId) staleReseedRow(row.childId, prev[1].row);
        put(askHoldKey(row.id), { kind: 'ask', phase: 'reseed-pending', childId: row.childId, row }, prev?.[0]);
      }
      const approvals = coord.heldApprovalRowsByChild();
      if (!approvals.ok) console.warn(`ccrc-server: held approvals unreadable at boot (${approvals.detail}) — none re-seeded`);
      else for (const [child, rows] of approvals.rows) {
        put(approvalHoldKey(child), { kind: 'approval', phase: 'reseed-pending', childId: child, rows: rows.map((x) => ({ id: x.id, notifyAt: x.notifyAt })) });
      }
    } catch (err) {
      console.warn(`ccrc-server: reading held rows at boot failed (${err instanceof Error ? err.message : String(err)}) — none re-seeded`);
    }
  };

  /**
   * D-5925 (spec §5.2 step 2, §5.3): decide a child the boot found holding a question or a permission prompt, from
   * THIS tick's pane and hookstate. Answers `reseeded` (a hold was re-seeded this tick), `waiting` (doubt: left for
   * a later tick) or `none` (nothing pending, or the pane disproved it and today's path takes over). Never settles on
   * doubt: an unmeasured pane, or a matching dialog whose hookstate is unreadable, leaves the row and the entry.
   *
   * The ask: a painted dialog with the row's `dialogId` and a hookstate ask hashing to its `askKey` re-seeds a held
   * ask (`until = askNotifyAt(at)`, `answeringSince` null, the payload `hold()` builds) after re-stamping
   * `askAt` through `restampAsk`'s CAS. `askAt` is deliberately not matched: it is the field that moves while the
   * question does not (D-2403). No `insertAsk`, no parent mail: the parent already has its brief. No dialog, or
   * another one, settles the row `stale`.
   *
   * The prompt: a painted permission prompt re-seeds a held prompt from the snapshot's rows, whatever state a later
   * tick finds them in (the approval half pushes once none is held). A pane with no prompt drops the snapshot and
   * leaves the rows (their cleared-dialog path needs a dialog the server never saw).
   */
  const reseed = (r: SessionRecord, pane: string | null, dialog: Dialog | null, hs: HookState | null): ReseedVerdict => {
    const pendingAsk = askEntry(r.id, 'reseed-pending');
    const pendingApprovals = approvalEntry(r.id, 'reseed-pending');
    if (pendingAsk === undefined && pendingApprovals === undefined) return 'none';
    if (pane === null) return 'waiting';
    let waiting = false;
    let reseeded = false;
    if (pendingAsk !== undefined) {
      const row = pendingAsk[1].row;
      if (dialog === null || dialog.id !== row.dialogId) {
        questionHolds.delete(pendingAsk[0]);
        staleReseedRow(r.id, row);
      } else if (hs === null) {
        waiting = true;
      } else {
        const key = hs.ask === null ? null : askKey(hs.ask);
        questionHolds.delete(pendingAsk[0]);
        if (key !== row.askKey) {
          staleReseedRow(r.id, row);
        } else {
          try {
            deps.coord?.restampAsk({ id: row.id, dialogId: dialog.id, askKey: key, askAt: hs.updatedAt });
          } catch (err) {
            console.warn(`ccrc-server: re-stamping a re-seeded ask failed for ${r.id} (${err instanceof Error ? err.message : String(err)}) — a parent answer may refuse ask-moved until the next tick`);
          }
          setHeldAsk(r.id, {
            until: askNotifyAt(row.at), askId: row.id, answeringSince: null,
            ev: askHoldPayload(r, hs, dialog, askActions(hs)),
          });
          reseeded = true;
        }
      }
    }
    if (pendingApprovals !== undefined) {
      if (dialog === null) {
        dropApproval(r.id, 'reseed-pending');
      } else if (hs === null) {
        waiting = true;
      } else {
        const rows = pendingApprovals.rows;
        dropApproval(r.id, 'reseed-pending');
        if (hs.ask !== null && 'approval' in hs.ask) {
          setHeldApproval(r.id, {
            until: Math.max(...rows.map((x) => x.notifyAt)), dialogId: dialog.id, rowIds: rows.map((x) => x.id),
            ev: askHoldPayload(r, hs, dialog, null),
          });
          reseeded = true;
        }
      }
    }
    return waiting ? 'waiting' : reseeded ? 'reseeded' : 'none';
  };

  /** D-5925, spec §5.2 step 3: a child measured ABSENT from the listing (its `.uuid` gone, not a refused or unreadable
   *  row, and never on an unlistable tick, which returns before this) holds no question any more. */
  const reseedGone = (listing: readonly string[], recs: readonly Pick<SessionRecord, 'id'>[]): void => {
    if (!hasReseedPending()) return;
    const listed = new Set(recs.map((x) => x.id));
    const children: string[] = [];
    for (const v of questionHolds.values()) if (v.phase === 'reseed-pending' && !children.includes(v.childId)) children.push(v.childId);
    for (const id of children) {
      if (listed.has(id) || listing.includes(`${id}.uuid`)) continue;
      const pendingAsk = askEntry(id, 'reseed-pending');
      if (pendingAsk !== undefined) questionHolds.delete(pendingAsk[0]);
      dropApproval(id, 'reseed-pending');
      if (pendingAsk !== undefined) staleReseedRow(id, pendingAsk[1].row);
    }
  };

  // ── the settles (the dialog left the pane) ─────────────────────────────────────────────────────────────────────

  /** A painted approval dialog went away: its deferred push is dropped, and its rows that no principal ruled become
   *  `operator` — the prompt was answered in the pane (spec §6.3 server step 5). Only the rows its deferred push
   *  covered, so a background subagent's hidden wait (D-5440) is not ended by it (D-5491). */
  const settleClearedApproval = (childId: string, dialogId: string): void => {
    const entry = approvalEntry(childId, 'held');
    if (entry === undefined || entry.dialogId !== dialogId) return;
    dropApproval(childId, 'held');
    try {
      deps.coord?.markApprovalOperatorRows(entry.rowIds, Date.now());
    } catch (err) {
      console.warn(`ccrc-server: settling a cleared approval hold failed for ${childId} (${err instanceof Error ? err.message : String(err)})`);
    }
  };

  /**
   * Fix round 1, item 4 (Important): a new dialog can replace the old one with NO intervening clear tick —
   * `parseDialog`'s id hashes the menu's title+labels, so two single-question dialogs back to back both take
   * `detectDialogs`' `last !== dialog.id` branch, never its clear branch. Left alone, `raise`'s carrier write would
   * silently overwrite an OLD held row, orphaning it forever: the ask half is keyed by the carrier (the entry is gone,
   * so it never fires `releaseAsk`) and the clear's `staleAsk` is CAS'd on `(dialogId, childId)` for the CURRENT dialog
   * only, so it can never reach a row minted against a dialog that left `dialogIds` without a clear edge. Settling it
   * here, against `last` (the id it was actually minted under), is the only place left that can still name it — done
   * unconditionally, before eligibility is even asked for the NEW dialog, because the OLD one is gone from the pane
   * either way. D-5289: a lapsed question this child replaced is no longer one a late parent answer could land in, so
   * its notification is final.
   */
  const settleReplaced = (childId: string, last: string | undefined): void => {
    dropAsk(childId, 'lapsed');
    if (last !== undefined) settleClearedApproval(childId, last);
    const orphaned = askEntry(childId, 'held');
    if (orphaned !== undefined && last !== undefined) {
      // The carrier entry is dropped unconditionally, BEFORE the guarded
      // write below — fix round 2, item 1: a failing `staleAsk` must
      // not leave the entry to be retried (and re-warned about) forever
      // on every subsequent tick; the in-memory hold is over either
      // way, since the dialog it was minted under is already gone.
      questionHolds.delete(orphaned[0]);
      // Guarded (fix round 2, item 1): this is a synchronous
      // `node:sqlite` UPDATE sitting directly on the 2 s poll, run
      // BEFORE the `notify` gate in `detectDialogs` — i.e. on every tick shape, not
      // just the mint edge — so an unguarded throw here would kill the
      // whole process exactly as `raise`'s own guard exists to prevent.
      try {
        deps.coord?.staleAsk(last, childId, Date.now());
      } catch (err) {
        console.warn(`ccrc-server: settling an orphaned ask hold failed for ${childId} (${err instanceof Error ? err.message : String(err)}) — a held row may remain orphaned in coord.db`);
      }
    }
  };

  /**
   * Task 8: the dialog went away with nothing to replace it — the operator hit escape at the terminal, or the session
   * was interrupted, cleared, swapped, or died. The pane is the only signal that cannot lie here: `cmd_swap` does not
   * rotate the session uuid, so hookstate's identity gate is blind to a swap and the file still reads `waiting` behind
   * a pane that is gone. Also closes the clear-then-remint gap: the orphan-settle (`settleReplaced`) only fires when a
   * NEW dialog silently replaces a live one, so settling the held ask on the way out, here, leaves nothing for it to
   * miss. D-5289: a lapsed question whose dialog cleared was acted on (or went away); no late parent answer can land in
   * it, so its notification is final.
   */
  const settleCleared = (childId: string, dialogId: string): void => {
    dropAsk(childId, 'lapsed');
    settleClearedApproval(childId, dialogId);
    const held = askEntry(childId, 'held');
    if (held !== undefined) {
      // Dropped unconditionally, BEFORE the guarded write below — same
      // shape as the orphan-settle: a failing `staleAsk` must not
      // leave the entry to be retried (and re-warned about) forever: the
      // in-memory hold is over either way, since the dialog it was
      // minted under is already gone from the pane.
      questionHolds.delete(held[0]);
      // Guarded: a synchronous `node:sqlite` UPDATE sitting directly on
      // the 2 s poll, and `detectDialogs` is AWAITED by `tick()`, which
      // has no `catch` of its own (`void this.tick()` in the timer) —
      // an unguarded throw here would kill the whole process. Never
      // pushes: a cleared dialog is a question that no longer exists,
      // so there is nothing to notify the operator about.
      try {
        deps.coord?.staleAsk(dialogId, childId, Date.now());
      } catch (err) {
        console.warn(`ccrc-server: settling a cleared ask hold failed for ${childId} (${err instanceof Error ? err.message : String(err)}) — a held row may remain orphaned in coord.db`);
      }
    }
  };

  /** Advance a held ask's `askAt` to the child's CURRENT hookstate, but only
   *  where this tick has just proved the menu on screen is unchanged.
   *
   *  Called from the `last === dialog.id` arm of `detectDialogs`, so the
   *  pane witness is already established by the caller; this adds the second
   *  one, `askKey`, from the same tick's hookstate (`hs`, rebuilt by
   *  `sweepHookStates` immediately before `detectDialogs` — see the ordering
   *  note in `tick()`). Both are handed to `restampAsk`'s CAS rather than
   *  trusted here, so a row that has moved on for any reason changes zero rows
   *  and keeps the `askAt` it had.
   *
   *  Every early return is a REFUSAL TO ADVANCE, which is the fail-shut
   *  direction: no held row, an unreadable or stale hookstate, an ask that
   *  has gone from the envelope, or an envelope `askKey` will not hash — each
   *  leaves the stored `askAt` exactly where it was, so the guard stays as
   *  strict as it was before this method existed.
   *
   *  Guarded, for the same reason its neighbours are: a synchronous
   *  `node:sqlite` UPDATE sitting directly on the 2 s poll, on every tick
   *  shape rather than a mint edge, where an unguarded throw would take the
   *  whole process down. */
  const restamp = (childId: string, dialogId: string, hs: HookState | null): void => {
    const held = askEntry(childId, 'held')?.[1];
    if (held === undefined) return;
    if (hs === null || hs.ask === null) return;
    const key = askKey(hs.ask);
    if (key === null) return;
    try {
      deps.coord?.restampAsk({
        id: held.askId, dialogId, askKey: key, askAt: hs.updatedAt,
      });
    } catch (err) {
      console.warn(`ccrc-server: re-stamping the ask hold failed for ${childId} (${err instanceof Error ? err.message : String(err)}) — a parent answer may refuse ask-moved until the next tick`);
    }
  };

  // ── the two lapse halves ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * Fire every held ask whose grace window has lapsed. The payload pushed is the one `hold` snapshotted at mint time,
   * pushed VERBATIM — `detectDialogs`'s two triggers (`last !== dialog.id`, the amendment branch) are one-shot edges:
   * `dialogIds`/`actionlessAsks` are stamped on first sighting regardless of whether a push was actually raised, so
   * there is no second chance to re-derive the same object later; re-deriving it here would find nothing to re-raise.
   *
   * `store.releaseAsk` is the CAS gate: it fires the push only when THIS call is the one that moved the row `held ->
   * released`. A `false` return means something else moved the row first, and RULING F9 (task-7-brief) is the reason
   * this branches on the row's actual state instead of dropping the held entry unconditionally the moment the CAS
   * fails — the naive "delete, then consult the result" order (the brief's own Step 3, before the ruling) drops the
   * deferred push forever whenever a parent is mid-answer, which is the exact failure this lane exists to prevent:
   *  - `'answering'` — a principal has taken the row and may still submit an answer. KEEP the entry so a later sweep
   *    can retry once that resolves; pushing now would buzz the operator over a question someone is actively
   *    answering. BOUNDED (fix round 1, item 1): this sweep is the ONLY collector a held ask has (the orphan-settle
   *    fires only on a NEW dialog id, and a session blocked on `AskUserQuestion` does not repaint), so an unbounded
   *    keep here would let a principal that took the row and never came back — the press refused, `answerAsk` threw,
   *    the request abandoned, a restart mid-call — strand the question forever, silently. Past `ASK_ANSWERING_MAX_MS`
   *    since first observed `'answering'`, this degrades exactly like the missing-row arm below: push, drop.
   *  - `'answered'` | `'released'` | `'declined'` | `'stale'` — somebody already resolved it (an answer landed, an
   *    explicit `POST /api/asks/:id/release`, which is `'declined'` since D-5289, or the orphan-settle). Drop the
   *    entry, no push — the question is already closed.
   *  - `'held'` — the CAS above just failed against this exact state, so under ordinary single-threaded execution this
   *    is unreachable; the only way to see it is a genuine race with another writer between the `releaseAsk` attempt
   *    and this read. KEEP (fix round 1, item 2): the row is demonstrably still open and unclaimed, so the NEXT sweep's
   *    `releaseAsk` simply succeeds and pushes on its own — dropping here would both lose the question AND orphan the
   *    row, since Task 8's `staleAsk` (guarded on the held entry) could then never reach it either. Warned, not silent
   *    — an unreachable branch that fires is worth knowing about even though it is handled safely.
   *  - `'unknown'` — an out-of-vocabulary state token read back off disk (`hydrateAsk`'s own degrade). This IS the
   *    "cannot tell" case F9's missing-row arm already rules on: push and drop, warned.
   *  - the row itself is gone (`askById` returns `null`, e.g. a lost `coord.db` file) — its loss is free BY DESIGN (the
   *    carrier's own docstring): drop the entry and push, degrading to exactly today's ordinary immediate-notification
   *    behaviour rather than swallowing the question.
   * The decisions are `coord/questionPolicy.ts#decideAskLapse`'s (W3 Q3c, D-7027), asked at each stage of what this
   * sweep reads (the window, the release CAS, the re-read row).
   */
  const lapseAsks = (now: number, push: (ev: QuestionPush) => void): void => {
    const store = deps.coord;
    if (!store) return;
    const holds = heldAskEntries();
    if (holds.length === 0) return;
    for (const held of holds) {
      const id = held.childId;
      const key = askHoldKey(held.askId);
      // `recordLapse` says whether this sweep's own CAS moved the row: only that lapse is recorded for a late answer
      // (D-5289).
      const act = (answer: AskLapse, recordLapse = false): void => {
        switch (answer) {
          case 'wait':
          case 'keep':
            return;                    // the hold stays; a later sweep retries
          case 'keep-reset':
            held.answeringSince = null;
            return;
          case 'drop':
            questionHolds.delete(key);   // settled by someone else — no push
            return;
          case 'push-and-drop':
            questionHolds.delete(key);
            if (recordLapse) setLapsedAsk(id, held.askId, held.ev);
            push(held.ev);
            return;
        }
      };
      if (decideAskLapse(held, { kind: 'window' }, now) === 'wait') continue;

      let released: boolean;
      try {
        released = store.releaseAsk(held.askId, now);
      } catch (err) {
        console.warn(`ccrc-server: releaseAsk failed for ask ${held.askId} (session ${id}) (${err instanceof Error ? err.message : String(err)}) — leaving the hold in place to retry next sweep`);
        act(decideAskLapse(held, { kind: 'release-threw' }, now));
        continue;
      }
      if (released) {
        act(decideAskLapse(held, { kind: 'release-won' }, now), true);
        continue;
      }

      // Beaten: the CAS did not move the row. Re-check its actual state
      // before touching the carrier entry — see this member's own docstring
      // and RULING F9.
      let row: AskRow | null;
      try {
        const read = store.askById(held.askId);
        // D-2545: the SAME degrade as the throw arm below — leave the hold in
        // place and retry next sweep. A row this box could not read is not a
        // row that is gone, and `row === null` below fires the push.
        if (!read.ok) {
          console.warn(`ccrc-server: askById refused for ask ${held.askId} (session ${id}) (${read.detail}) — leaving the hold in place to retry next sweep`);
          act(decideAskLapse(held, { kind: 'row-refused' }, now));
          continue;
        }
        row = read.ask;
      } catch (err) {
        console.warn(`ccrc-server: askById failed for ask ${held.askId} (session ${id}) (${err instanceof Error ? err.message : String(err)}) — leaving the hold in place to retry next sweep`);
        act(decideAskLapse(held, { kind: 'row-threw' }, now));
        continue;
      }
      // Bounded (fix round 1, item 1) — see `ASK_ANSWERING_MAX_MS`'s own
      // docstring and this member's own. `answeringSince` is set on the
      // sweep that FIRST observes this row `'answering'`, never
      // re-derived, so the bound is measured from the first sighting,
      // not from whenever `takeAskForAnswer` actually ran.
      if (row !== null && row.state === 'answering' && held.answeringSince === null) held.answeringSince = now;
      const answer = decideAskLapse(held, { kind: 'row', row }, now);
      // The warn sentences follow the decider's answer: `keep-reset` is the `held` race, and a `push-and-drop` of a row
      // that is not `answering` is a state this sweep cannot read.
      if (answer === 'keep-reset') {
        // Unreachable under ordinary single-threaded execution (see this
        // member's own docstring) — a genuine race with another writer,
        // not a defect this sweep can fix. KEEP: the row is demonstrably
        // still open, so the next sweep's `releaseAsk` simply succeeds and
        // pushes on its own; dropping here would orphan the row instead.
        // Reset the answering timer too — a LATER `'answering'` sighting
        // for this same entry is a fresh episode, not a continuation of
        // whatever earlier one (if any) left a stale timestamp behind.
        console.warn(`ccrc-server: sweepAsks saw ask ${held.askId} (session ${id}) unexpectedly still 'held' after a failed release — keeping the hold for the next sweep to resolve`);
      } else if (answer === 'push-and-drop' && row !== null && row.state === 'unknown') {
        // An out-of-vocabulary state token read back off disk
        // (`hydrateAsk`'s own degrade) — the "cannot tell" case F9's
        // missing-row arm already rules on: degrade to notifying the
        // operator rather than swallowing the question.
        console.warn(`ccrc-server: sweepAsks saw ask ${held.askId} (session ${id}) in an unrecognised state after a failed release — pushing and dropping the hold`);
      } else if (answer === 'push-and-drop' && row !== null && !isAskState(row.state)) {
        console.warn(`ccrc-server: sweepAsks saw ask ${held.askId} (session ${id}) in an unrecognised state '${String(row.state)}' after a failed release — pushing and dropping the hold`);
      }
      act(answer);
    }
  };

  /**
   * The approvals lane's clock (plan Task 16, D-5298, D-5441), every tick:
   *  - a `held` row at or past its `notifyAt` lapses to `released` (the hook has stopped, or stops on its next poll);
   *  - a `held` or `released` row past `askAt + APPROVAL_HOOK_WAIT_S` is `stale` (the hook's ceiling);
   *  - a deferred push whose rows are none of them `held` any more is sent while its dialog is still painted — unless
   *    every one of them was ruled within the last `graceMs` (`APPROVAL_RULED_GRACE_MS`), where the hook is printing
   *    the ruling and the dialog is about to clear.
   * The decisions are `coord/questionPolicy.ts`'s (W3 Q3c, D-7027). Each pass asks of a row as the state its read
   * selected. Synchronous; a store read that throws throws to the caller, whose one guard warns and lets the next sweep
   * retry, with every push before the throw already sent.
   */
  const lapseApprovals = ({ now, graceMs, paintedDialogOf, push }: ApprovalLapseInput): void => {
    const coord = deps.coord;
    if (!coord) return;
    // This read's rows are `held` rows.
    const held = coord.approvalsInState('held');
    if (held.ok) for (const row of held.rows) if (decideApprovalLapse({ ...row, state: 'held' }, now) === 'lapse') coord.lapseApproval(row.id);
    for (const st of ['held', 'released'] as const) {
      const rows = coord.approvalsInState(st);
      // The hook's ceiling, asked of each row as the `released` row it is or lapses to: the ceiling reads `askAt` alone,
      // so a `held` row still due its lapse (the read above was refused) is marked `stale` all the same.
      if (rows.ok) for (const row of rows.rows) if (decideApprovalLapse({ ...row, state: 'released' }, now) === 'stale') coord.staleApproval(row.id);
    }
    for (const [key, entry] of questionHolds) {
      if (entry.kind !== 'approval' || entry.phase !== 'held') continue;
      const childId = entry.childId;
      const read = coord.approvalsForChild(childId, ['held', 'allowed', 'denied']);
      const answer = decideDeferredApprovalPush(entry, read, now, paintedDialogOf(childId) === entry.dialogId, graceMs);
      if (answer === 'wait') continue;
      questionHolds.delete(key);
      if (answer === 'push') push(entry.ev);
    }
  };

  /** Once a day (the `approvalPrune` row), `pruneApprovalInputs` and the asks' question-text retention (spec §6.7). */
  const prune = (now: number): void => {
    const coord = deps.coord;
    if (!coord) return;
    coord.pruneApprovalInputs(now);
    coord.pruneAskQuestions(now);
  };

  // ── the door-ins: each answers what to push; the caller pushes ─────────────────────────────────────────────────

  /**
   * `POST /api/asks/:id/release` (Task 10, the decline route): a parent has DECLINED to rule on its child's question,
   * so the grace window ends NOW rather than at `held.until` — the verb that makes the window a CEILING rather than a
   * flat tax on every ask the parent cannot rule on. The route has already CAS'd the store row before its door-in
   * calls this — this member's whole job is the in-memory half the ask half would otherwise wait up to `ASK_SWEEP_MS`
   * to notice on its own: drop the hold and answer the SNAPSHOTTED push, exactly the ask half's own `released` branch.
   * A `childId` with no held ask (the grace window already lapsed and the sweep beat this call to it, a server restart
   * forgot the hold, or this ask was never held by THIS instance) answers null: the store row is released either way,
   * and there is no snapshotted `ev` left to push.
   */
  const released = (childId: string): QuestionPush | null => {
    const held = askEntry(childId, 'held');
    if (held === undefined) return null;
    questionHolds.delete(held[0]);
    return held[1].ev;
  };

  /**
   * D-5289, late answer wins: `POST /api/asks/:id/answer` settled a row it took from `'released'`, so the lapse already
   * notified the operator. Replace that notification under the same tag (`pushOne`'s default `${kind}-${sessionId}`,
   * the lapse's own) with `answeredByBody(parent)`, and no actions: the question is answered, so the lock-screen buttons
   * must go. Only for the lapse this instance snapshotted for THIS row (`askId`), and once: a restart, a cleared dialog
   * or another row's answer replaces nothing.
   *
   * A known race, benign: a tick that captures the pane while the route is still awaiting `sendKey` can see the dialog
   * already cleared and drop the lapsed entry before this runs, so the operator keeps the lapse's original
   * notification (today's behaviour). Open follow-up, not this member's: a `'released'` row whose dialog clears with
   * nobody answering never moves to `'stale'` (`staleAsk` takes `held`/`answering` only).
   */
  const answeredLate = (childId: string, askId: number, parent: string): QuestionPush | null => {
    const lapsed = askEntry(childId, 'lapsed');
    if (lapsed === undefined || lapsed[1].askId !== askId) return null;
    questionHolds.delete(lapsed[0]);
    return { ...lapsed[1].ev, body: answeredByBody(parent), actions: undefined };
  };

  /** `POST /api/approvals/:id/release`'s door in (D-5440): the claimant handed the prompt over, so the deferred push
   *  fires now, while the dialog is painted. A child with no deferred push (a background subagent's prompt, whose menu
   *  paints only after its hook returns) raises on its first sighting instead. */
  const approvalReleased = (childId: string, paintedDialogId: string | undefined): QuestionPush | null => {
    const entry = approvalEntry(childId, 'held');
    if (entry === undefined) return null;
    const coord = deps.coord;
    try {
      const read = coord?.approvalsForChild(childId, ['held']);
      if (read?.ok && read.rows.some((x) => entry.rowIds.includes(x.id) && Date.now() < x.notifyAt)) return null;
    } catch { /* unread: push, the operator's direction */ }
    dropApproval(childId, 'held');
    return paintedDialogId === entry.dialogId ? entry.ev : null;
  };

  /** `POST /api/approvals/:id/rule`'s door in: a deferred push stays deferred (the hook prints the ruling and the
   *  dialog clears; the approval half pushes if it does not). A prompt the operator was already pushed about (its menu
   *  was sighted before the row was minted: `painted`, with no held prompt) has that notification replaced, same tag,
   *  by who ruled. */
  const approvalRuled = (
    childId: string, agentId: string, parent: string, verdict: 'allow' | 'deny', painted: boolean, projectOf: () => string,
  ): QuestionPush | null => {
    // A subagent's ruling is not the painted prompt's (D-5491): the operator's notification for that prompt stays.
    if (agentId !== '' || approvalEntry(childId, 'held') !== undefined || !painted) return null;
    return { kind: 'ask', sessionId: childId, project: projectOf(), title: '❓ Question', body: approvalRuledBody(parent, verdict) };
  };

  /** The stall lane's read: the child's newest asks row (`currentAskFor`), the store's answer unchanged. */
  const currentAskOf = (childId: string): AskReadResult => {
    const coord = deps.coord;
    if (!coord) return { ok: false, kind: 'ask-unreadable', detail: 'no coordination database' };
    return coord.currentAskFor(childId);
  };

  /** The test-only view (`questionsTestView`): this instance's carrier, by the shapes today's watcher maps had. */
  const testView: QuestionsTestView = {
    heldAsks: () => new Map(heldAskEntries().map((v) => [v.childId, v])),
    heldApprovals: () => new Map([...questionHolds.values()]
      .filter((v): v is Extract<QuestionHold, { kind: 'approval'; phase: 'held' }> => v.kind === 'approval' && v.phase === 'held')
      .map((v) => [v.childId, v])),
    plantHeldAsk: (childId, held) => { setHeldAsk(childId, held); },
    asksDisabled: () => asksDisabled,
  };

  const questions: Questions & { readonly [TEST_VIEW]: QuestionsTestView } = {
    raiseApproval,
    approvalInput: (id, now) => { forgetExpiredInputs(now); return approvalInputs.get(id); },
    forgetApprovalInput: (id) => { approvalInputs.delete(id); },
    raise, loadReseed, reseed, reseedGone, settleReplaced, settleCleared, restamp,
    noteAsksSwitch: (disabled) => { asksDisabled = disabled; },
    lapseAsks, lapseApprovals, prune, released, answeredLate, approvalReleased, approvalRuled, currentAskOf,
    [TEST_VIEW]: testView,
  };
  return questions;
}
