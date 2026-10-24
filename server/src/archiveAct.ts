/**
 * The archive door's ACTS (ARCH-36, #559): what `POST /api/sessions/:id/archive` does once `admitArchive` has admitted
 * it and `decideArchive` has planned it — the refusal's reply, the stop, then `ws-archive`. L4: it owns the reply and
 * the ccd calls and decides nothing the deciders (`coord/archiveAdmission.ts`, `coord/archiveDoor.ts`) already did; the
 * conditions it branches on are the plan's (`stop`, `wsArchive`) and the verdicts they and the ports answer. Moved out
 * of `server.ts` so the route stays a wiring of measurements to acts (the template's point).
 */
import type { FastifyReply } from 'fastify';
import type { RouteRefusal } from '../../shared/refusal.js';
import { ARCHIVE_REFUSALS } from '../../shared/api.js';
import type { CcdArgv } from './ccdargv.js';
import type { CcdResult } from './lifecycle.js';
import type { ArchiveDecision, ArchiveFlags, TurnVerdict } from './coord/archiveDoor.js';
import { archiveOutcome, refusedAtStop } from './coord/archiveDoor.js';
import { refuseRoute } from './refuse.js';
import { withoutCcdRefusal } from '../../shared/ccd-refusal.js';

/** What the route reads and runs on the act's behalf. The turn is re-read at the act, fail-closed. */
export interface ArchiveActPorts {
  turnVerdict(): Promise<TurnVerdict>;
  stopArgv(): CcdArgv;
  /** `tmux` proves the session's pane is up. */
  paneLive(): Promise<boolean>;
  runCcd(argv: CcdArgv): Promise<CcdResult>;
}

type Planned = Extract<ArchiveDecision, { ok: true }>;
type Refused = Extract<ArchiveDecision, { ok: false }>;

/** A plan that refused, answered through the one refusal helper at the word's one status. A store this box could not
 *  read refuses fail-shut WITH its detail, and the server says so in its log (workspace lifecycle wave 3b: the base
 *  dropped both). */
export function replyArchiveRefused(reply: FastifyReply, id: string, plan: Refused): FastifyReply {
  const { ok: _ok, error, ...extra } = plan.reply.body as { ok: false; error: RouteRefusal } & Record<string, unknown>;
  if (typeof extra.detail === 'string'
      && (error === ARCHIVE_REFUSALS.runOpen || error === ARCHIVE_REFUSALS.coordinatorHasOpenRuns)) {
    console.warn(`ccrc-server: archive ${id}: the coordination store could not be read (${extra.detail}) — refused fail-shut`);
  }
  return refuseRoute(reply, error, extra);
}

type RefusedBody = { ok: false; error: RouteRefusal } & Record<string, unknown>;

/** A refusal body the planner or ccd's answer built, sent through `refuseRoute` so its status is the table's. */
function sendRefused(reply: FastifyReply, body: RefusedBody): FastifyReply {
  const { ok: _ok, error, ...extra } = body;
  return refuseRoute(reply, error, extra);
}

export async function actArchive(
  reply: FastifyReply, plan: Planned, flags: ArchiveFlags, archiveArgv: CcdArgv | null, ports: ArchiveActPorts,
): Promise<FastifyReply | { ok: true; archived: true; stopped: boolean; ended: Planned['ended'] }> {
  const endedSpread = plan.ended.length > 0 ? { ended: plan.ended } : {};
  let stopped = false;
  if (plan.stop) {
    // Re-read at the act, fail-closed, unless the operator consented to lose the turn. A turn measured in progress
    // is `session-busy`, a state nobody could read `status-unknown` — the word is `refusedAtStop`'s (3881).
    const verdict = flags.interrupt ? 'idle' : await ports.turnVerdict();
    if (verdict !== 'idle') {
      const refused = refusedAtStop(verdict, plan.ended);
      return sendRefused(reply, refused.body as RefusedBody);
    }
    const res = await ports.runCcd(ports.stopArgv());
    if (!res.ok) return reply.code(502).send({ ok: false, stderr: withoutCcdRefusal(res.stderr), ...endedSpread });
    stopped = true;
  }
  if (archiveArgv === null || !plan.wsArchive) return { ok: true, archived: true, stopped, ended: plan.ended };
  const archived = await ports.runCcd(archiveArgv);
  // REVIEW 240's F1 (workspace lifecycle wave 3b): `ws-archive` answers `already archived <id>` at exit 0 having
  // stopped NOTHING — a row archived earlier whose pane came back without a spawn path clearing the stamp (a pre-#143
  // pane). Read as `archived:true` alone, the door said a session was put away that tmux still runs. A pane tmux
  // PROVES up is stopped here, as the archive's own act would have — but only after the turn is re-read at the act,
  // fail-closed (`turnVerdictFor`, the rule for a stop nobody agreed to: this branch is never `interrupt`'s, whose
  // stop has already run), because `ws-archive`'s own fail-closed `_ws_status` is skipped on `already archived` and
  // the turn the door measured came from the frame's row. Only an `idle` answer stops; a busy or unreadable turn, a
  // pane gone, or one tmux cannot be asked about, is left as before — archived, not stopped.
  if (archived.ok && !stopped && /^already archived /m.test(archived.stdout)
      && (await ports.paneLive()) && (await ports.turnVerdict()) === 'idle') {
    const res = await ports.runCcd(ports.stopArgv());
    if (!res.ok) return reply.code(502).send({ ok: false, stderr: withoutCcdRefusal(res.stderr), ...endedSpread });
    stopped = true;
  }
  const out = archiveOutcome(stopped, plan.ended, archived);
  // The 409 arm is a refusal and answers through the one helper; the 200 and the 502 `{ stderr }` arms are not words.
  return out.status === 409 ? sendRefused(reply, out.body as RefusedBody) : reply.code(out.status).send(out.body);
}
