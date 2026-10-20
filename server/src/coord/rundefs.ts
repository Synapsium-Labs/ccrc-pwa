import type { OpenSibling } from './store.js';
import {
  HOLD_REASON_MAX_CHARS,
  holdReason as serializeHoldReason,
  isPositiveDecimalSafeInteger,
} from '../../../shared/api.js';

/**
 * Shared by `routes.ts` (the `POST /api/runs` open route, and
 * `POST /api/runs/:id/advance`) and the two L1 decision functions this file
 * is split out FOR — `dispatch.ts`'s `dispatchRun` and `close.ts`'s
 * `closeRun` (architecture doc increment 4). None of these five belong to
 * only one of "decide" or "act through a route": `holdReason` is pure
 * formatting the open route needs too, and `queueSystemMail` is the
 * coordinator's own mail write, used by dispatch (the wave brief), close (a
 * done-claim rejection) and advance (an advance rejection) alike. A single
 * shared home means the three call sites can never drift onto three
 * different reason strings or three different system-mail shapes.
 *
 * THIS IS THE PURE HALF (D-5896, ARCH-05). The mail writes, which run under
 * `tx`, are in `rundefsTx.ts`. This file holds no handle and imports no
 * transaction, so a policy file that wants a marker loads nothing else.
 * `coord-policy-rings.test.ts` walks its runtime imports.
 */

/** The 40-hex `SHA` shape check `fingerprint.ts`'s `verifyDone` runs on a
 *  done claim — mirrored here (fix, review findings 6/18), NOT imported,
 *  because `verifyDone` is deliberately SKIPPED on an explicit abandon
 *  (`state:'failed'`, D-49) and `runs.handoffCommit` had exactly ONE writer
 *  either way that ran the check: before this fix, an abandon's own
 *  `claim.handoffCommit` reached `coord.setHandoffCommit` with no shape
 *  validation at all — the 40-hex test and the `handoffCommit === branchTip`
 *  correspondence rule lived in exactly the one place (`verifyDone`) the
 *  abandon path bypasses. Correspondence is NOT re-checked here on purpose:
 *  an abandon has no re-measured `branchTip` to correspond against (that is
 *  what D-49 skips), so this route only ever asserts the SHAPE, never the
 *  match. */
export const HANDOFF_SHA = /^[0-9a-f]{40}$/;

/** `$REG/mail-disabled` — the SAME kill-switch `watch.ts`'s `sweepMail`
 *  gates on; both reach its one definition, its `shared/switches.ts` row
 *  (D-5855). Dispatch reads it (fix, review finding 17) from its own registry
 *  listing, which already covers `COORDINATOR_PAUSE_MARKER` below. Before
 *  this fix, dispatch consulted ONLY the
 *  coordinator-pause marker: an operator who `touch`ed this one to silence
 *  injection mid-debugging still got `ccd ensure` + an injected `/clear`
 *  wiping the worker's context, with the wave brief queued but held by the
 *  very kill-switch the operator raised — the worker sat in an EMPTY,
 *  `/clear`ed context for as long as the marker stood, invisible to anything
 *  short of reading the pane. */
export { MAIL_DISABLED_MARKER } from '../../../shared/switches.js';

/** `$REG/coordinator-paused` — spec:199-205: "no verb, no route, no way for
 *  the coordinator to unpause itself." Deliberately not `-disabled`-suffixed
 *  like `mail-disabled`: `limits.ts:134-142` filters `<name>-disabled`
 *  markers out of `/api/accounts` as candidate wrapper names, and this is not
 *  a lane kill-switch — it must not read as one there. */
export { COORDINATOR_PAUSE_MARKER } from '../../../shared/switches.js';

/** `$REG/reclaim-paused` — the fleet-wide kill-switch on the AUTOMATIC
 *  reclamation of child workspaces (child-reclamation spec §5.8). Written only
 *  by `ccd reclaim-pause` (through `POST /api/coord/reclaim-pause`), read by
 *  FOUR parties, spec §5.8's four: the watcher's frame (`emitCoord`, which
 *  renders it); the watcher's sweep (`sweepChildReclaim`, which skips before
 *  asking); the one executor both triggers share (`reclaimChild`, through
 *  `childReclaimPauseRead` in `childReclaimOutcome`, which defers
 *  `paused-at-server` after its sibling re-read and before presence or any
 *  argv — that is the close path's skip, and the sweep's for a reclaim that
 *  was queued before the switch went up); and — the one that matters —
 *  `ws-reclaim` itself on the box, which refuses `paused`. Not
 *  `-disabled`-suffixed, for `COORDINATOR_PAUSE_MARKER`'s reason: `limits.ts`
 *  reads `<name>-disabled` as a wrapper's lane switch. */
export { RECLAIM_PAUSE_MARKER } from '../../../shared/switches.js';

/**
 * `run_events.detail` for a dispatch whose post-resume `/clear` was refused
 * (D-47) — built here rather than spelled at the two ends, because for the
 * first time both ends exist: `dispatch.ts` WRITES it, and (Task 407)
 * `CoordStore.strandedClear` READS it back as the proof that this system
 * typed those four characters into a worker's box. Two hand-spelled copies of
 * a token one side writes and the other matches is how a permission gate
 * silently stops opening — or, worse, opens on a prefix nobody meant.
 */
export const clearRefusedDetail = (code: string): string => `clear-refused:${code}`;

/**
 * The ONE refusal that strands the literal `/clear` in the box with the server
 * having WATCHED it get there: the echo loop proved the box held it and both
 * Enters were swallowed (`sendPrompt`'s `enter-ignored`).
 *
 * Deliberately not a set. `verify-failed` also leaves the text in the box
 * since Build 8, but it means the opposite about the EVIDENCE — the box never
 * showed our text on any poll, so what sits there now is exactly what this
 * gate must not guess at. Operator ruling, Task 407: no proof, refuse.
 */
export const CLEAR_REFUSED_STRANDS_TEXT = clearRefusedDetail('enter-ignored');

/** Re-export the L0 policy and serializer from their historical server home so
 *  existing server consumers do not grow a second spelling. */
export { HOLD_REASON_MAX_CHARS };
export const holdReason = serializeHoldReason;

export type HoldReasonVerdict =
  | { ok: true; reason: string }
  | { ok: false; kind: 'hold-oversize'; limit: number; detail: string }
  | { ok: false; kind: 'hold-invalid'; detail: string };

const HOLD_REASON_PATTERN =
  /^program:[A-Za-z0-9._-]+ wave:[0-9]+(?:\/[0-9]+)?(?: run:[0-9]+)?$/;

/** Validate exactly what the hook accepts: a complete in-cap hold whose slug
 *  and optional positive-decimal numbers satisfy its grammar. `waveOf` and
 *  `runId` are nullable only because the two documented display forms omit
 *  them; whenever present they share the wave's positive-safe-integer domain. */
export const holdReasonVerdict = (
  program: string,
  wave: number,
  waveOf: number | null,
  runId: number | null,
): HoldReasonVerdict => {
  const reason = holdReason(program, wave, waveOf, runId);
  // GRAMMAR AND DOMAIN FIRST, LENGTH SECOND, and the order is the whole
  // difference between the two codes meaning what they say. A reconstructed row
  // can be malformed AND over-cap at once; answering `hold-oversize` for it
  // sends the coordinator to SKILL.md's remedy for that code — shorten the slug
  // and retry — which cannot repair a stored programme the grammar rejects, so
  // the retry earns a second refusal under a different name. Checking the
  // grammar first means `hold-oversize` is only ever reported for a hold that
  // is otherwise entirely valid, which is exactly the claim its remedy rests on.
  if (!isPositiveDecimalSafeInteger(wave)
      || (waveOf !== null && !isPositiveDecimalSafeInteger(waveOf))
      || (runId !== null && !isPositiveDecimalSafeInteger(runId))
      || !HOLD_REASON_PATTERN.test(reason)) {
    return {
      ok: false,
      kind: 'hold-invalid',
      detail: 'hold reason does not satisfy the session-card grammar',
    };
  }
  if (reason.length > HOLD_REASON_MAX_CHARS) {
    return {
      ok: false,
      kind: 'hold-oversize',
      limit: HOLD_REASON_MAX_CHARS,
      detail:
        `hold reason ${reason.length} characters exceeds the ` +
        `${HOLD_REASON_MAX_CHARS} character session-card cap`,
    };
  }
  return { ok: true, reason };
};

/** May this close END the claim on the workspace, or must it hand the claim
 *  to whoever else still owns it?
 *
 *  L1, pure: no `fs`, no `reply`, no clock, no database handle. Trivial today
 *  — `length === 0` — and that is the point: `closeRun` asks this question at
 *  FOUR distinct fleet acts (abandon, final, non-final, failed-with-archive),
 *  and before this constant existed each of them would have spelled it
 *  itself. One home, one test, one mutant. */
export const releaseIsSafe = (openSiblings: readonly OpenSibling[]): boolean =>
  openSiblings.length === 0;

/** The claim that survives a close (or a spent-child refusal): the MOST
 *  RECENTLY opened run, because the coordinator protocol opens wave N+1
 *  before closing wave N. With the ordinary one-sibling case this is a
 *  distinction without a difference; it is written down so two siblings
 *  produce a DETERMINISTIC reason rather than a coin toss
 *  (`openRunsForSession` is `ORDER BY id`).
 *
 *  Hoisted here (fix round B, F13) so `close.ts` and `dispatch.ts` share ONE
 *  survivor rule instead of two independent spellings of the same
 *  `s[s.length - 1] ?? null` — no test pinned the two doors equal before this
 *  move, and a future edit to one would have silently drifted from the
 *  other. */
export const survivorOf = (s: readonly OpenSibling[]): OpenSibling | null => s[s.length - 1] ?? null;

/**
 * The two SYSTEM MAIL senders. Neither is a registry row: both are fixed ROLE
 * identities, the same way `resolveCoordinator`'s own docstring already treats
 * `toId:'coordinator'`. Enumerated once, here, and DERIVED into `MAIL_ROLE_IDS`
 * below rather than hand-listed twice — `watch.ts` is the second reader and a
 * second copy is exactly the drift `single-definition.test.ts` exists to refuse.
 *
 * `'operator'` joined the vocabulary in program-leverage wave 4 (D-1040) for the
 * program kickoff. It is not a coinage: `coord/schema.ts`'s `run_events.causedBy`
 * has read `'coordinator' | 'operator' | <session id>` since Build 4, and
 * `closeRun` takes exactly that pair. The kickoff needed it because the message
 * is sent BY the operator TO the session that is about to become the
 * coordinator — a mail from `'coordinator'` to the coordinator-to-be would be a
 * false statement on the face of its own envelope, and, worse, would send
 * `tellSender` through `resolveCoordinator(null)`, whose answer is whichever
 * program happens to be the single active one.
 *
 * WIDENED BY THE ASK LANE (whole-branch review M4). `'operator'`'s gloss below
 * said "through a PWA-surface route", which was every one of its senders until
 * this branch: the ask nudge is the first `'operator'` mail THE WATCHER ITSELF
 * raises, off a pane scrape, with no request and nobody at the phone. The
 * sender is still right — the question is the operator's to answer, and the
 * mail exists to let a parent answer it first — but "a route" is no longer how
 * it gets sent, so the gloss says both.
 *
 * WIDENED AGAIN BY THE STALL WATCH (wave 1). The watcher's stall lane is the
 * second raiser the operator did not tap for. Its stall-check to a silent worker
 * and its report to that run's coordinator are both operator mail, sent by
 * `queueStallNotice` off a measured silence. The reasoning is the ask nudge's:
 * the operator is who the watch speaks for, and no session is.
 */
const SYSTEM_MAIL_SENDER_MAP = {
  coordinator: "the program's own coordinator session, speaking as the role",
  operator: 'the operator — either through a PWA-surface route or raised by the ' +
    'watcher on their behalf (the ask nudge, the stall watch, the landing notices); never a session speaking for itself',
} as const;

export type SystemMailSender = keyof typeof SYSTEM_MAIL_SENDER_MAP;

/** Sender ids that are ROLES, not registry rows. Anything that would read a
 *  `mail.fromId` AS a session id — push targets, presence gates, tags — must
 *  consult this first; see `watch.ts`'s `tellSender`, which pushed at whatever
 *  `fromId` said before wave 4 taught it the difference. */
export const MAIL_ROLE_IDS: ReadonlySet<string> = new Set(Object.keys(SYSTEM_MAIL_SENDER_MAP));

/** The landing lane's two notice subjects live in `landing.ts` (L1: the lane's verdict spells them, and this
 *  file once held the database handle an L1 file may not reach); re-exported so `watch.ts` and the coordinator-skill
 *  test keep the import they always had. Spelled ONCE, there. */
export { dequeuedSubject, mergedSubject } from './landing.js';

/** The ask pre-emption lane's own nudge-mail subject prefix — the ONE source
 *  `askNudgeSubject` (the queue side) and `isAskNudgeMail` (the reader side)
 *  both derive from (fix round 2, item 3), so the two can no longer spell
 *  `ask:` as two independent literals that a future edit drifts apart. */
const ASK_NUDGE_SUBJECT_PREFIX = 'ask:';

/** Build the ask pre-emption lane's nudge-mail subject for one ask id —
 * `FleetWatcher.hold`'s own construction, moved here so `isAskNudgeMail`
 * below has one definition to agree with instead of a second hand-spelled
 * copy of the same shape. */
export const askNudgeSubject = (askId: number): string => `${ASK_NUDGE_SUBJECT_PREFIX}${askId}`;

/**
 * Is this mail row the ask pre-emption lane's own nudge to a parent
 * (`FleetWatcher.hold`, `server/src/watch.ts`) — the message that exists
 * SOLELY to wake a parent so it can rule before the operator's phone does?
 *
 * Fix round 1, item 1 (CRITICAL): before this predicate existed, that nudge's
 * own delivery fired an ordinary `kind:'mail'` push through
 * `FleetWatcher.pushNewMail` a tick after `hold()` queued it — buzzing the
 * operator's phone about the very question the hold exists to keep off it,
 * with no answer buttons, no tag collapse against the eventual `ask-<child>`
 * push, and no presence suppression for an operator watching the CHILD's
 * pane (the mail's presence key is the PARENT, `m.toId`). The lane deferred
 * nothing.
 *
 * `fromId === 'operator'` ALONE is not the shape — `queueProgramKickoff`
 * also sends from `'operator'`, and ITS push is wanted, so this must not
 * broaden to every `'operator'` mail. What singles out an ask nudge is the
 * full triple: the sender, `runId === null` (deliberate — `hold`'s own
 * reasoning: this rides the run-less peer-mail lane, never a run's
 * lifecycle), and a subject shaped exactly `ASK_NUDGE_SUBJECT_PREFIX<n>` —
 * matched against the SAME prefix `askNudgeSubject` builds from, not a
 * second copy of the literal. Exported and used from BOTH sides — `hold`
 * calls `askNudgeSubject` to construct the subject this predicate must
 * recognise, and `pushNewMail` reads it back — so the mail QUEUE and the
 * mail PUSH lane share one definition instead of two that can drift.
 */
export function isAskNudgeMail(m: { fromId: string; runId: number | null; subject: string }): boolean {
  return m.fromId === 'operator' && m.runId === null &&
    m.subject.startsWith(ASK_NUDGE_SUBJECT_PREFIX) &&
    /^\d+$/.test(m.subject.slice(ASK_NUDGE_SUBJECT_PREFIX.length));
}

/** The approvals lane's nudge-mail subject prefix (plan Task 16, D-5298): the mail that wakes a child's claimant to
 *  rule on its permission prompt. One source for the queue side (`approvalNudgeSubject`) and the reader side
 *  (`isApprovalNudgeMail`), as the ask nudge's pair has. */
const APPROVAL_NUDGE_SUBJECT_PREFIX = 'approval:';

export const approvalNudgeSubject = (approvalId: number): string => `${APPROVAL_NUDGE_SUBJECT_PREFIX}${approvalId}`;

/** Is this mail row an approval nudge? Recorded and never pushed, for the ask nudge's reason (`isAskNudgeMail`): it
 *  exists to keep the prompt off the operator's phone during the window, so its own delivery must not buzz it. */
export function isApprovalNudgeMail(m: { fromId: string; runId: number | null; subject: string }): boolean {
  return m.fromId === 'operator' && m.runId === null &&
    m.subject.startsWith(APPROVAL_NUDGE_SUBJECT_PREFIX) &&
    /^\d+$/.test(m.subject.slice(APPROVAL_NUDGE_SUBJECT_PREFIX.length));
}
