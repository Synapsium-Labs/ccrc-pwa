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
// otherwise. State (the hold carrier, Q3d; `approvalInputs`, Q3e) lives ONLY as closure locals of `createQuestions`,
// never at module scope, never as a class field and never as a property of the returned object: two apps or two
// watchers in one process share nothing (`census-w3/questions.ts#questionHoldCarriers` reads exactly that shape, and
// `single-definition/ask-digest.test.ts` holds this file to no module-scope state). In Q3b the instance holds none yet.
import type { ApprovalState, AskState } from '../../../shared/api.js';
import { askNotifyAt } from '../askwindow.js';
import type { ApprovalRow, AskRow, CoordStore } from './store.js';

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

/** What a `Questions` instance is made from: the composition's own store (`Deps.coord`). */
export interface QuestionsDeps {
  readonly coord?: CoordStore | undefined;
}

/** One composition's owner of question state. Q3b: no state and no member yet. Q3e adds `raiseApproval` and
 *  `approvalInputs`, Q3d the hold carrier and `raise`, each as closure locals of `createQuestions`. */
export interface Questions {}

/** A new owner of question state for one composition: one per `FleetWatcher`, one per server. Holds nothing at module
 *  scope, so every call is independent of every other. */
export function createQuestions(_deps: QuestionsDeps): Questions {
  return {};
}
