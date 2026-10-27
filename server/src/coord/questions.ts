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
// `single-definition/ask-digest.test.ts` holds this file to no module-scope state). Q3e: `approvalInputs`.
//
// THE RAISE (Q3e, D-7029). `raiseApproval` is `POST /api/approvals`'s ladder after the kill switch and attribution
// (steps 6 to 15), which the route keeps inline in today's order. It answers one closed verdict the route maps byte for
// byte. RING: this file stays L1. What the ladder needs from an outer ring (the claimant rule `heldFor`, L3; the
// single-box gate `rulingsAllowedHere`, L3; the signer, the deny and version reads and the journal, closures of
// `registerCoordRoutes`) is passed in as `ApprovalRaiseDeps` and imported here by type only, so `fleet.ts`'s runtime
// import of `currentFor` stays inward and `rings/outward-edges.data.ts` gains no pair.
import { createHash } from 'node:crypto';
import {
  APPROVAL_CWD_TRUSTED, APPROVAL_HOOK_VERSIONS, approvalDigestBytes, canonicalJson,
  type ApprovalMintReleaseReason, type ApprovalState, type AskState,
} from '../../../shared/api.js';
import { approvalWindowMs, askNotifyAt } from '../askwindow.js';
import { readRegistry, type SessionRecord } from '../registry.js';
import { approvalClass, rootsForChild } from './approvalguard.js';
import { renderApprovalBrief } from './approvalbrief.js';
import type { ApprovalSigner, rulingsAllowedHere } from './approvalsign.js';
import type { heldFor } from './heldFor.js';
import type { ReclaimDeps } from './reclaim.js';
import { redactedStored } from './redact.js';
import { approvalNudgeSubject } from './rundefs.js';
import { queueSystemMail } from './rundefsTx.js';
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

/** One composition's owner of question state. Q3e: the raise and the approval inputs it holds. Q3d adds the hold
 *  carrier and `raise`, as closure locals of `createQuestions` too. */
export interface Questions {
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

/** A new owner of question state for one composition: one per `FleetWatcher`, one per server. Holds nothing at module
 *  scope, so every call is independent of every other. */
export function createQuestions(_deps: QuestionsDeps): Questions {
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

  return {
    raiseApproval,
    approvalInput: (id, now) => { forgetExpiredInputs(now); return approvalInputs.get(id); },
    forgetApprovalInput: (id) => { approvalInputs.delete(id); },
  };
}
