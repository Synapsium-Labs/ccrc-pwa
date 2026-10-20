// D-5896 (ARCH-05, #551): the TRANSACTION half of `rundefs.ts`. The server's own mail writes live here. They are
// `queueSystemMail`, its body `insertSystemMailTx`, and the stall watch's `queueStallNotice`. Each runs under `tx`.
// `rundefs.ts` keeps the pure half: the markers, the hold-reason rule, the sibling rule and the mail vocabulary.
// A policy file that needs only a marker now loads no transaction code. `tx` comes from `./tx.js` and not
// `./db.js`, so even the two policy files that queue mail (`close.ts`, `kickoff.ts`) load no `node:sqlite`.
// `coord-policy-rings.test.ts` pins both halves.
import { tx } from './tx.js';
import { renderEnvelope } from './envelope.js';
import type { CoordStore, RunRow, StallObservation } from './store.js';
import type { SystemMailSender } from './rundefs.js';
import type { MailKind } from '../../../shared/api.js';

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
