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

/** The standing hold-reason convention (`registry.ts:26-46`, spec:120-123):
 *  DISPLAY-ONLY, never parsed back anywhere in this tree — the run row's own
 *  `program`/`wave`/`waveOf` columns are what every route and the store
 *  actually read. Shared by the open route's immediate hold, dispatch's own
 *  hold, and close's hold-reason update to the next wave, so the three
 *  places this string is built can never drift apart from one another. */
export const holdReason = (program: string, wave: number, waveOf: number | null): string =>
  `program:${program} wave:${wave}${waveOf === null ? '' : `/${waveOf}`}`;

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
 * The coordinator's OWN mail — the wave brief (dispatch) and a done-claim
 * rejection mailed back (close, advance) — queued DIRECTLY rather than
 * through `POST /api/mail`'s ingress. The ingress exists to police
 * attribution for a message this server did not originate (spec:136-148: a
 * box token authenticates the box, `{fromId,fromUuid}` is verified against
 * the registry); a message the SERVER itself is sending has no sender
 * session to be stale about, so re-entering that gate would be checking a
 * fact that cannot fail against itself. `'coordinator'` is used as both
 * `fromId` and `fromUuid` — a fixed ROLE identity, not a registry row, the
 * same role `resolveCoordinator`'s own docstring already treats
 * `toId:'coordinator'` as. Mirrors the ingress route's own tx shape exactly
 * (insert mail, insert delivery so its own id exists, render the envelope
 * AGAINST THE DELIVERY ID, land it) — see that route's comment on
 * `setDeliveryEnvelope` for why the two ids cannot be assumed to walk
 * together.
 */
export function queueSystemMail(
  coord: CoordStore,
  run: Pick<RunRow, 'program' | 'wave' | 'waveOf'>,
  m: { toId: string; runId: number; kind: MailKind; subject: string; body: string },
): void {
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
  if (coord.hasOutstandingMail(m.runId, m.toId, m.subject)) return;
  tx(coord.db, () => {
    const inserted = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: m.toId,
      runId: m.runId, kind: m.kind, subject: m.subject, body: m.body, artifacts: [] });
    const delivery = coord.queueDelivery(inserted.id, m.toId, '');
    const envelope = renderEnvelope({ id: delivery.id, fromId: 'coordinator', toId: m.toId, runId: m.runId,
      program: run.program, wave: run.wave, waveOf: run.waveOf,
      kind: m.kind, subject: m.subject, body: m.body, artifacts: [] });
    coord.setDeliveryEnvelope(delivery.id, envelope);
  });
}
