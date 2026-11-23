import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import type { ModelClass } from '../../shared/models.js';
import type { FleetIO } from './io.js';
import { readLaneModels } from './laneModels.js';
import {
  modelsActAuditWord, modelsActVerdict, parseModelsActBody, revertGateVerdict, type ModelsDoorAction,
} from './laneModelsAct.js';
import { refuseRoute } from './refuse.js';

/**
 * THE MODELS SHEET'S WRITE DOOR (programme model-class-advance, wave R4; plan 2026-10-15-model-class-auto-advance-codex-arm.md,
 * Task 19's POST as re-planned, D-8686, D-8687; the audit's actor is D-5229; revert-holds-until-newer, D-8757):
 * `POST /api/models/:lane`, body exactly `{action: 'revert', class}`. It runs `ccrc models <lane> revert <class>` on the
 * fleet's box through `FleetIO.models` (the agent's `models` op, or the local arm), and answers
 * `{ok, lane, action, class, changed, partial, models}` (`changed` is always `null`; the key stays for an older console).
 * The read beside it, `GET /api/models/:lane`, stays in `server.ts`.
 *
 *  - REVERT ONLY. Hold and Release are refused `bad-action` before any read or write: they remain the shell's and the
 *    agent's verbs (`ccrc models <lane> hold|release`), and the sheet no longer offers them.
 *  - A FRESH CAPABILITY READ BEFORE THE ACT. After the lane and the body, the door reads the lane (`readLaneModels` with
 *    `{ fresh: true }`: a `show` of its own, never one already in flight) and asks `revertGateVerdict`. It writes only when
 *    that read carries `revertHoldEnds: true`, because a hold the box would never end by itself must not be written from the
 *    console: an older or unreadable box proves nothing. A refusal there is a word, writes nothing and audits nothing (the
 *    audit line is one per write op ASKED). No atomicity is promised across a box being replaced between that read and the
 *    act: the act's own answer still decides what the sheet is told.
 *
 *  - SESSION-GATED, NO BOX TOKEN. The global auth gate takes it like every PWA-surface write (it is in no EXEMPT table);
 *    a session's own hand never reaches it, the operator's device does. The box-token census lists it as `MODELS_DOORS`.
 *  - NON-OPTIMISTIC. The sheet moves only on the answer: a 200 carries the FRESH read of the lane (`readLaneModels` with
 *    `{ fresh: true }`, asked after the act and only on a done), so what the screen shows is what the box now holds, never
 *    what the tap hoped. "Fresh" is a guarantee about WHEN the read began: it starts a `show` of its own after the act
 *    ended and never joins one a `GET /api/models/:lane` had already in flight, which on the local arm (no gate, and `show`
 *    takes no lane lock) may have read the lane before the act wrote. On the agent arm a `show` during an act is `busy`.
 *  - A REFUSAL IS A WORD, NEVER THE VERB'S SENTENCE. The verb's `detail` can carry paths and commands, so only its kebab
 *    code crosses, as `verbCode` on `lane-act-refused`; the accounts routes' rule (`accounts/routes.ts`).
 *  - AN UNKNOWN OUTCOME IS SAID SO. A timeout, an output past its cap, a lost answer and a stdout off the grammar answer
 *    `outcome-unknown` with a cause: the verb may have run. Nothing is retried, and the sheet re-reads before it says more.
 *  - THE LANE IS THE ROSTER'S, ASKED BEFORE THE PARSED BODY IS READ: an unknown lane is `not-found` before the handler
 *    looks at the body or sends an op. Fastify parses the JSON body BEFORE the handler runs, so a body that is not JSON
 *    gets Fastify's own 400 and a non-JSON content type its own 415, for any lane, known or not; the handler's `bad-body`
 *    is for JSON of the wrong shape.
 *  - AUDIT BY DEVICE. One `console.warn` line per op that was asked, naming the device the gate measured (`device:<label>`,
 *    D-5229), never a session id or cookie: `ccrc-server: models: <action> <lane> <class> by <actor> -> <outcome>`.
 *
 * L4: it reads the request and answers on the reply. Every decision is `laneModelsAct.ts` (L1, pure); the read and the act
 * are the `FleetIO` the composition root wires. Not registered here: `server.ts` calls `registerLaneModelsRoutes`.
 */
export interface LaneModelsRouteDeps {
  readonly io: FleetIO;
  readonly ccrcDir: string;
  /** Whether the roster holds this lane. */
  readonly hasLane: (lane: string) => boolean;
  /** The device label the gate measured, as `device:<label>` (or the gate's own `unmeasured`); never a session id. */
  readonly actorOf: (req: FastifyRequest) => string;
}

export function registerLaneModelsRoutes(app: FastifyInstance, deps: LaneModelsRouteDeps): void {
  app.post('/api/models/:lane', async (req, reply) => {
    const { lane } = req.params as { lane: string };
    if (!deps.hasLane(lane)) return refuseRoute(reply, 'not-found');
    const parsed = parseModelsActBody(lane, req.body);
    if (!parsed.ok) return refuseRoute(reply, 'bad-request', { why: parsed.why });
    const { action, cls } = parsed;
    // The capability read, fresh, before any write: a refusal here asks the op nothing and writes no audit line.
    const gate = revertGateVerdict(await readLaneModels(deps.io, deps.ccrcDir, lane, { fresh: true }));
    if (gate.kind === 'refuse') return refuseRoute(reply, gate.error, gate.extra);
    // The act. A rejected promise is a contract breach of the seam: the frame may have left, so it reads as lost.
    let asked: ModelsAsked;
    try { asked = await deps.io.models(lane, action, cls); } catch { asked = { kind: 'lost' }; }
    const verdict = modelsActVerdict(lane, action, cls, asked);
    audit(action, lane, cls, deps.actorOf(req), modelsActAuditWord(verdict));
    if (verdict.kind === 'refuse') return refuseRoute(reply, verdict.error, verdict.extra);
    reply.header('cache-control', 'no-store');
    return {
      ok: true, lane, action, class: cls, changed: verdict.changed, partial: verdict.partial,
      models: await readLaneModels(deps.io, deps.ccrcDir, lane, { fresh: true }),
    };
  });
}

/** The one audit line of an op that was asked (D-5229). The server runs `Fastify({ logger: false })`, so `req.log` is a no-op. */
function audit(action: ModelsDoorAction, lane: string, cls: ModelClass, actor: string, outcome: string): void {
  console.warn(`ccrc-server: models: ${action} ${lane} ${cls} by ${actor} -> ${outcome}`);
}
