import { tx } from './db.js';
import { renderEnvelope } from './envelope.js';
import type { CoordStore, OpenSibling, RunRow } from './store.js';
import type { MailKind } from '../../../shared/api.js';

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

/** The standing hold-reason convention (`SessionRecord.held`, `registry.ts`; spec:120-123):
 *  DISPLAY-ONLY, never parsed back anywhere in this tree — the run row's own
 *  `program`/`wave`/`waveOf` columns are what every route and the store
 *  actually read. Shared by the open route's immediate hold, dispatch's own
 *  hold, and close's hold-reason update to the next wave, so the three
 *  places this string is built can never drift apart from one another.
 *
 *  `run:<id>` (Wave 2) is what lets a human reading `~/.cc-sessions` answer
 *  "whose claim is this?" from the box alone — the question that had no
 *  answer during the F9 incident. STILL DISPLAY-ONLY: run-awareness comes
 *  from `coord.db` (`CoordStore.openRunsForSession`), never from parsing
 *  this string, and `run-routes.test.ts` pins that nothing does. A HAND hold
 *  has no run and passes `null`, so it gets no suffix. */
export const holdReason = (program: string, wave: number, waveOf: number | null,
                           runId: number | null): string =>
  `program:${program} wave:${wave}${waveOf === null ? '' : `/${waveOf}`}` +
  `${runId === null ? '' : ` run:${runId}`}`;

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
 */
const SYSTEM_MAIL_SENDER_MAP = {
  coordinator: "the program's own coordinator session, speaking as the role",
  operator: 'the operator, through a PWA-surface route — no session sent it',
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
 * mailed back (close, advance), and the program kickoff (kickoff.ts) — queued
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
  let out: SystemMailQueued = { queued: false };
  tx(coord.db, () => {
    const inserted = coord.insertMail({ fromId: m.fromId, fromUuid: m.fromId, toId: m.toId,
      runId: m.runId, kind: m.kind, subject: m.subject, body: m.body, artifacts: [] });
    const delivery = coord.queueDelivery(inserted.id, m.toId, '');
    const envelope = renderEnvelope({ id: delivery.id, fromId: m.fromId, toId: m.toId, runId: m.runId,
      program: run?.program ?? null, wave: run?.wave ?? null, waveOf: run?.waveOf ?? null,
      kind: m.kind, subject: m.subject, body: m.body, artifacts: [] });
    const stamped = coord.setDeliveryEnvelope(delivery.id, envelope);
    // Structurally impossible inside this transaction — the row was inserted
    // six lines up and nothing else can see it. THROWN rather than ignored
    // because `tx` rolls back on throw and rethrows: if the impossible
    // happens, the whole mail is withdrawn rather than accepted with the
    // placeholder envelope, which carries no `ack:` line and so names no
    // delivery id for any recipient to ack against. The throw ESCAPES
    // `queueSystemMail` — callers `close.ts:248`, `dispatch.ts:661`,
    // `kickoff.ts:156`, `routes.ts:1204` — deliberately: `{ queued: false }`
    // already means "the dedupe guard suppressed it", a different and true
    // statement this must not borrow.
    if (!stamped.ok) throw new Error(`delivery ${delivery.id} unstampable: ${stamped.why}`);
    out = { queued: true, mailId: inserted.id, deliveryId: delivery.id };
  });
  return out;
}
