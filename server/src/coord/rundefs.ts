import { tx } from './db.js';
import { renderEnvelope } from './envelope.js';
import type { CoordStore, OpenSibling, RunRow, StallObservation } from './store.js';
import {
  HOLD_REASON_MAX_CHARS,
  holdReason as serializeHoldReason,
  isPositiveDecimalSafeInteger,
  type MailKind,
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
 *  already gates on (its own `MAIL_DISABLED_MARKER`), duplicated as a literal
 *  there rather than imported (fix, review finding 17): dispatch's own
 *  registry listing already covers `COORDINATOR_PAUSE_MARKER` below, and a
 *  second literal is lower-risk than an import into a file `watch.ts` itself
 *  does not depend on. Before this fix, dispatch consulted ONLY the
 *  coordinator-pause marker: an operator who `touch`ed this one to silence
 *  injection mid-debugging still got `ccd ensure` + an injected `/clear`
 *  wiping the worker's context, with the wave brief queued but held by the
 *  very kill-switch the operator raised — the worker sat in an EMPTY,
 *  `/clear`ed context for as long as the marker stood, invisible to anything
 *  short of reading the pane. */
export const MAIL_DISABLED_MARKER = 'mail-disabled';

/** `$REG/coordinator-paused` — spec:199-205: "no verb, no route, no way for
 *  the coordinator to unpause itself." Deliberately not `-disabled`-suffixed
 *  like `mail-disabled`: `limits.ts:134-142` filters `<name>-disabled`
 *  markers out of `/api/accounts` as candidate wrapper names, and this is not
 *  a lane kill-switch — it must not read as one there. */
export const COORDINATOR_PAUSE_MARKER = 'coordinator-paused';

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
export const RECLAIM_PAUSE_MARKER = 'reclaim-paused';

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

/**
 * What `queueSystemMail` did, said out loud (D-1042). It used to return `void`
 * and short-circuit its dedupe with a bare `return`, so "queued just now" and
 * "an identical one is already outstanding" reached every caller as the same
 * non-answer — the overloaded seam this codebase treats as a defect class. The
 * three run-mail callers can live without the distinction (each has at most one
 * instance in flight per run by construction); a route that must answer an
 * operator cannot, and wave 5's re-kickoff — which most often targets a session
 * that still has an unacked kickoff — least of all.
 *
 * The false arm carries no reason string on purpose: there is exactly ONE
 * condition under which this function declines, and a vocabulary with a single
 * member is a distinction pretending to exist.
 */
export type SystemMailQueued =
  | { queued: true; mailId: number; deliveryId: number }
  | { queued: false };

/**
 * The SERVER's OWN mail — the wave brief (dispatch), a done-claim rejection
 * mailed back (close, advance, and the review close's `review-done-rejected`),
 * the program kickoff (kickoff.ts), and the ask pre-emption lane's parent nudge
 * (`watch.ts`'s `FleetWatcher.hold`) — queued
 * DIRECTLY rather than through `POST /api/mail`'s ingress. The ingress exists to
 * police attribution for a message this server did not originate (spec:136-148: a
 * box token authenticates the box, `{fromId,fromUuid}` is verified against
 * the registry); a message the SERVER itself is sending has no sender
 * session to be stale about, so re-entering that gate would be checking a
 * fact that cannot fail against itself. The sender is used as both `fromId` and
 * `fromUuid` — a fixed ROLE identity, not a registry row. Mirrors the ingress
 * route's own tx shape exactly (insert mail, insert delivery so its own id
 * exists, render the envelope AGAINST THE DELIVERY ID, land it) — see that
 * route's comment on `setDeliveryEnvelope` for why the two ids cannot be assumed
 * to walk together.
 *
 * `run` and `m.runId` are nullable since wave 4 (D-1039/D-1040): the program
 * kickoff is sent BEFORE run 1 exists, because opening run 1 is the first thing
 * it asks its recipient to do. The alternative — synthesising a
 * `{program: slug, wave: 0, waveOf: null}` at the call site — compiles and even
 * works, since `renderEnvelope` skips all three fields when `runId === null`, but
 * it asserts a run that does not exist. The type expresses the condition instead.
 *
 * ITS BODY IS `insertSystemMailTx` below (stall watch wave 1). This function is
 * that body's dedupe plus the one transaction around it, and it behaves exactly
 * as it did before the split. `queueStallNotice` is the body's second caller: it
 * dedupes on a `run_events` observation row instead, and opens its own
 * transaction, because `tx` is not re-entrant.
 */
export function queueSystemMail(
  coord: CoordStore,
  run: Pick<RunRow, 'program' | 'wave' | 'waveOf'> | null,
  m: { fromId: SystemMailSender; toId: string; runId: number | null;
       kind: MailKind; subject: string; body: string },
): SystemMailQueued {
  // Review finding 33: don't requeue an identical outstanding system mail.
  // The calls in this file — `wave-brief` (dispatch), `wave-done-rejected`
  // (close, on a re-measurement refusal) and `wave-advance-rejected`
  // (advance) — each have at most ONE outstanding instance in flight per run
  // by construction; a retry landing here again (the coordinator's own retry
  // loop, or a few taps of a PWA button) is restating a fact the recipient
  // has already been told, not a new one, and previously inserted a fresh
  // `mail` + `mail_deliveries` row — a fresh, non-collapsing push
  // (spec:236-237) and a fresh `feed_events` row — on EVERY retry, unbounded.
  // `recordRejection` (the caller's own audit log) is unaffected: this only
  // guards the MAIL queue, never the record of the refusal itself.
  if (coord.hasOutstandingMail(m.fromId, m.runId, m.toId, m.subject)) return { queued: false };
  const q = tx(coord.db, () => insertSystemMailTx(coord, run, m));
  return { queued: true, mailId: q.mailId, deliveryId: q.deliveryId };
}

/**
 * `queueSystemMail`'s BODY, extracted (stall watch wave 1) so a second caller
 * can run it inside a transaction that also holds its own row. It inserts the
 * mail, inserts the delivery so the delivery id exists, renders the envelope
 * AGAINST THAT ID, and lands it (`setDeliveryEnvelope`'s docstring says why the
 * two ids cannot be assumed to walk together). It OPENS NO TRANSACTION: `tx` is
 * `BEGIN IMMEDIATE` and not re-entrant, so each caller holds one around it
 * (`queueSystemMail` above, `queueStallNotice` below). It never dedupes: that is
 * each caller's own rule.
 */
export function insertSystemMailTx(
  coord: CoordStore,
  run: Pick<RunRow, 'program' | 'wave' | 'waveOf'> | null,
  m: { fromId: SystemMailSender; toId: string; runId: number | null;
       kind: MailKind; subject: string; body: string },
): { mailId: number; deliveryId: number } {
  const inserted = coord.insertMail({ fromId: m.fromId, fromUuid: m.fromId, toId: m.toId,
    runId: m.runId, kind: m.kind, subject: m.subject, body: m.body, artifacts: [] });
  const delivery = coord.queueDelivery(inserted.id, m.toId, '');
  const envelope = renderEnvelope({ id: delivery.id, fromId: m.fromId, toId: m.toId, runId: m.runId,
    program: run?.program ?? null, wave: run?.wave ?? null, waveOf: run?.waveOf ?? null,
    kind: m.kind, subject: m.subject, body: m.body, artifacts: [] });
  const stamped = coord.setDeliveryEnvelope(delivery.id, envelope);
  // Structurally impossible inside the caller's transaction — the row was
  // inserted three lines up and nothing else can see it. THROWN rather than
  // ignored because both callers run this under `tx`, which rolls back on
  // throw and rethrows. If the impossible happens, the whole mail is withdrawn
  // (and, under `queueStallNotice`, a run notice's observation row with it: a
  // run-less notice writes none) rather than accepted with the placeholder
  // envelope, which carries no `ack:` line and so names no delivery id to ack.
  //
  // The throw ESCAPES to every caller, deliberately. Two functions call this
  // one. The first is `queueSystemMail`, and through it that function's seven
  // callers in five files: `close.ts`'s `closeRun` and its module-private
  // `closeReviewRun` (the review close's own rejection), `dispatch.ts`'s
  // `dispatchRun`, `kickoff.ts`'s `queueProgramKickoff`, `routes.ts`'s
  // `POST /api/runs/:id/advance` handler, and `watch.ts`'s `FleetWatcher.hold`
  // (the ask pre-emption lane's parent nudge) and `FleetWatcher.sweepLanding`
  // (the merge queue's two landing notices, landing-order wave 2, which
  // catches the throw per row). The second is `queueStallNotice`
  // below, the stall watch's notices, on a run or run-less. Both callers' false arms already mean
  // "declined", a different and true statement a failure must not borrow.
  //
  // THAT LIST NAMES ITS CALLERS, and carries no line numbers, deliberately.
  // It cited lines through two corrections, and the second went stale inside
  // a single wave: an edit anywhere ABOVE a call site moves it while the call
  // itself does not change. The enclosing function is what identifies a
  // caller. It said "all five" for waves while `closeReviewRun` was a sixth.
  if (!stamped.ok) throw new Error(`delivery ${delivery.id} unstampable: ${stamped.why}`);
  return { mailId: inserted.id, deliveryId: delivery.id };
}

/** What `queueStallNotice` did. `why` is `StallObservation`'s own refusal,
 *  derived rather than respelled: a run notice declines exactly when its
 *  observation row does, and a run-less one answers `duplicate` when its
 *  subject was already sent. `eventId` is the observation row's id, and null
 *  for a run-less notice, which writes none. */
export type StallNoticeQueued =
  | { queued: true; mailId: number; deliveryId: number; eventId: number | null }
  | { queued: false; why: Extract<StallObservation, { recorded: false }>['why'] };

/**
 * The stall watch's run notice (spec 2026-09-29 §4.2): r1's stall-check to the
 * worker and r2's report to the coordinator. It runs in ONE transaction: first
 * the `run_events` observation row that dedupes the rung
 * (`insertStallObservation`), then the mail from `operator`
 * (`insertSystemMailTx`). If the mail write throws, the row rolls back with it,
 * so a failed send never burns its rung. If the row is a duplicate or the run
 * is gone (absent or no longer active, D-3584), no mail is written.
 *
 * NOT `queueSystemMail`'s dedupe. That one sees only OUTSTANDING mail, so an
 * acked stall-check would not stop a second one, and a restart would re-send
 * every rung. The observation row is durable, and the lane's ladder reads its
 * rung times back from it.
 *
 * `run === null` is the RUN-LESS notice (stall watch wave 2, `run-less-stall-notice` (D-3640)):
 * a session verdict about a coordinator, or about a registry row with no run
 * (an `orphaned:` or `failed:` self-wake, or its failed rung 2), has no
 * `run_events` row to dedupe on. Its durable dedupe is
 * `hasMailWithSubject('operator', null, toId, subject)`, over EVERY delivery
 * state, read INSIDE the same transaction as the insert, so the check and the
 * write cannot be split. It holds because the subject names the episode to the
 * day and the minute (`self-mail-subjects-carry-the-date` (D-3668)) and `mail` is never
 * pruned. It writes no observation row: `eventId` is null, and `detail` and
 * `at` are unused. `tx` is not re-entrant, so no caller may hold one around
 * either arm.
 */
export function queueStallNotice(
  coord: CoordStore,
  run: Pick<RunRow, 'id' | 'program' | 'wave' | 'waveOf'> | null,
  n: { detail: string; at: number; toId: string; kind: MailKind; subject: string; body: string },
): StallNoticeQueued {
  return tx(coord.db, (): StallNoticeQueued => {
    if (run === null) {
      if (coord.hasMailWithSubject('operator', null, n.toId, n.subject)) return { queued: false, why: 'duplicate' };
      const q = insertSystemMailTx(coord, null, { fromId: 'operator', toId: n.toId, runId: null,
        kind: n.kind, subject: n.subject, body: n.body });
      return { queued: true, mailId: q.mailId, deliveryId: q.deliveryId, eventId: null };
    }
    const seen = coord.insertStallObservation(run.id, n.detail, n.at);
    if (!seen.recorded) return { queued: false, why: seen.why };
    const q = insertSystemMailTx(coord, run, { fromId: 'operator', toId: n.toId, runId: run.id,
      kind: n.kind, subject: n.subject, body: n.body });
    return { queued: true, mailId: q.mailId, deliveryId: q.deliveryId, eventId: seen.eventId };
  });
}

/** The landing lane's two notice subjects live in `landing.ts` (L1: the lane's verdict spells them, and this
 *  file holds the database handle an L1 file may not reach); re-exported so `watch.ts` and the coordinator-skill
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
