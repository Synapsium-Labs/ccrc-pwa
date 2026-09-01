// server/src/auto/routes.ts — L4. The ten routes spec §10 names, `get`/`post`
// only, each a union -> status-code map and NOTHING ELSE — this file is not
// allowed to DECIDE (CLAUDE.md's ring rule); every decision (the schedule
// arithmetic, the precondition ladder, the act) lives in `./schedulepolicy.js`
// / `./fire.js`, already L1.
//
// GATING (spec §10 "Gating"): session-cookie ONLY. Nothing here calls
// `requireMailToken`, nothing is added to `auth/gate.ts`'s `EXEMPT`. The
// global `onRequest` hook (`installGate`, wired once in `server.ts`) already
// stands in front of every route in every file — that is the whole point of
// a ONE-HOOK gate (`auth/gate.ts`'s own docstring) — so a route registered
// here needs no gate wiring of its own to be covered by the 401 sweep
// (`auth-gate.test.ts`). The box token authenticates the FLEET HOST, and
// every session on that single-uid box holds it; a schedule the fleet could
// write is a schedule any session could install for itself, standing and
// unattended — strictly wider than the path `gh` was refused. Never add a
// fourth ungated door here: the three that exist (`POST /api/coord/pause`,
// `POST /api/runs/:id/abandon`, `POST /api/claims/:id/break`) are pinned
// shut at exactly three by `coord-pause-route.test.ts`'s `UNGATED` set.
//
// D-280 — RUN-NOW CONSTRUCTS ITS DANGEROUS FIELDS AS LITERALS AT THE CALL
// SITE. `POST /:id/run` reads NOTHING off the request body: `project`,
// `prompt`, `trigger` and every other fact that ends up on the fleet come off
// the STORED automation row this server already trusted, never off what the
// caller typed today. This is what makes "the phone can trigger; the phone
// can never re-target" structural rather than a promise — see the source
// scan in `automations-routes.test.ts`.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Deps } from '../server.js';
import { fireAutomation, type FireDeps } from './fire.js';
import { planSchedule, type AutomationRow as PolicyAutomationRow } from './schedulepolicy.js';
import {
  toAutomationSummary, type AutomationEdit, type AutomationEditResult, type AutomationFilter,
  type AutomationRow as StoreAutomationRow, type AutomationTransitionResult, type ArmResult,
  type NewAutomation,
} from '../coord/store.js';
import type { Cadence, StoredCadence } from '../../../shared/schedule.js';
import {
  AUTOMATION_GRACE_MS_DEFAULT, AUTOMATION_PROMPT_MAX_BYTES,
  isAutomationOutcome, isAutomationState,
} from '../../../shared/api.js';

const notConfigured = (reply: FastifyReply) => reply.code(501).send({ ok: false, error: 'not-configured' });

/** A stored (possibly-degraded) cadence, narrowed to what `planSchedule`
 *  accepts — `'unknown'` (a rollback fact, never something a producer wrote,
 *  `schedulepolicy.ts:30-32`) degrades to `null`, exactly as
 *  `AutomationRow.cadence` documents for the fire-path reader. */
const cadenceOf = (sc: StoredCadence): Cadence | null => (sc.kind === 'unknown' ? null : sc);

/** The store's own `AutomationRow` (wire summary + lease triple) -> the
 *  fire-path's `AutomationRow` (`schedulepolicy.ts`) — TWO DIFFERENT shapes
 *  under one name, by design (L2 ports are declared BY THE CONSUMER; see
 *  `fire.ts`'s own docstring on why it does not import the store's type).
 *  `fireAutomation` needs the FULL shape, not a `Pick`, so this is a real
 *  conversion rather than a structural pass-through — `cadence` in
 *  particular is a different TYPE on each side (`StoredCadence` vs `Cadence
 *  | null`), which is exactly the seam `cadenceOf` above closes. */
function toPolicyRow(row: StoreAutomationRow): PolicyAutomationRow {
  return {
    id: row.id, name: row.name, state: row.state, project: row.project, prompt: row.prompt,
    cadence: cadenceOf(row.cadence), graceMs: row.graceMs,
    provedAt: row.provedAt, nextRunAt: row.nextRunAt, scheduleError: row.scheduleError,
    lastFireAt: row.lastFireAt, lastOutcome: row.lastOutcome, lastRefusal: row.lastRefusal,
    leaseUntil: row.leaseUntil, leaseHardUntil: row.leaseHardUntil,
    consecutiveFailures: row.consecutiveFailures, runsEvicted: row.runsEvicted,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

/** `req.body`/`req.query`'s unknown shape, parsed by hand — no schema layer
 *  in this tree (`coord/routes.ts`'s own idiom throughout). */
function parseCadence(v: unknown): Cadence | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'wall-clock') {
    if (typeof o.days !== 'number' || typeof o.minuteOfDay !== 'number' || typeof o.tz !== 'string') {
      return null;
    }
    return { kind: 'wall-clock', days: o.days, minuteOfDay: o.minuteOfDay, tz: o.tz };
  }
  if (o.kind === 'interval') {
    if (typeof o.everyMinutes !== 'number') return null;
    return { kind: 'interval', everyMinutes: o.everyMinutes };
  }
  return null;
}

interface ParsedAutomationBody {
  readonly name: string; readonly project: string; readonly prompt: string;
  readonly cadence: Cadence; readonly graceMs: number;
}

/** create/edit share every field. `'invalid'` is its own return arm rather
 *  than `null` — the caller's ONE 400 site distinguishes "the shape was
 *  wrong" from a cadence this build cannot schedule, which is `409
 *  bad-schedule`'s job, one call site down (GC 9 — no overloaded null at a
 *  seam). */
function parseAutomationBody(body: unknown): ParsedAutomationBody | 'invalid' {
  if (body === null || typeof body !== 'object') return 'invalid';
  const o = body as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.trim() === '') return 'invalid';
  if (typeof o.project !== 'string' || o.project.trim() === '') return 'invalid';
  if (typeof o.prompt !== 'string') return 'invalid';
  const cadence = parseCadence(o.cadence);
  if (cadence === null) return 'invalid';
  let graceMs = AUTOMATION_GRACE_MS_DEFAULT;
  if (o.graceMs !== undefined) {
    if (typeof o.graceMs !== 'number' || !Number.isFinite(o.graceMs) || o.graceMs <= 0) return 'invalid';
    graceMs = o.graceMs;
  }
  return { name: o.name, project: o.project, prompt: o.prompt, cadence, graceMs };
}

function sendArmOutcome(reply: FastifyReply, r: ArmResult) {
  if (r.ok) return reply.code(200).send({ ok: true, nextRunAt: r.nextRunAt });
  switch (r.why) {
    case 'unknown-automation': return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    case 'never-run-by-hand': return reply.code(409).send({ ok: false, error: 'never-run-by-hand' });
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from });
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', why: (_exhaustive as { why: string }).why });
    }
  }
}

function sendStateOutcome(reply: FastifyReply, r: AutomationTransitionResult) {
  if (r.ok) return reply.code(200).send({ ok: true, state: r.state });
  switch (r.why) {
    case 'unknown-automation': return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from });
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', why: (_exhaustive as { why: string }).why });
    }
  }
}

function sendEditOutcome(reply: FastifyReply, r: AutomationEditResult) {
  if (r.ok) return reply.code(200).send({ ok: true, automation: toAutomationSummary(r.row) });
  switch (r.why) {
    case 'unknown-automation': return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from });
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', why: (_exhaustive as { why: string }).why });
    }
  }
}

export function registerAutoRoutes(app: FastifyInstance, deps: Deps): void {
  // ── GET /api/automations — list ────────────────────────────────────────
  app.get('/api/automations', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const q = req.query as { state?: unknown; project?: unknown; last?: unknown };
    const filter: AutomationFilter = {
      ...(typeof q.state === 'string' && isAutomationState(q.state) ? { state: q.state } : {}),
      ...(typeof q.project === 'string' && q.project.trim() !== '' ? { project: q.project } : {}),
      ...(q.last === 'never-ran'
        ? { last: 'never-ran' as const }
        : typeof q.last === 'string' && isAutomationOutcome(q.last) ? { last: q.last } : {}),
    };
    return reply.code(200).send({ ok: true, automations: coord.automations(filter).map(toAutomationSummary) });
  });

  // ── POST /api/automations — create, always `paused` (§7's arm gate) ────
  app.post('/api/automations', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const parsed = parseAutomationBody(req.body);
    if (parsed === 'invalid') return reply.code(400).send({ ok: false, error: 'bad-request' });
    const bytes = Buffer.byteLength(parsed.prompt, 'utf8');
    if (bytes > AUTOMATION_PROMPT_MAX_BYTES) {
      return reply.code(413).send({ ok: false, error: 'oversize', limit: AUTOMATION_PROMPT_MAX_BYTES, bytes });
    }
    const now = Date.now();
    const plan = planSchedule(parsed.cadence, now, null);
    if (plan.scheduleError !== null) {
      return reply.code(409).send({ ok: false, error: 'bad-schedule', scheduleError: plan.scheduleError });
    }
    const input: NewAutomation = {
      name: parsed.name, project: parsed.project, prompt: parsed.prompt,
      cadence: parsed.cadence, graceMs: parsed.graceMs,
    };
    const { id } = coord.insertAutomation(input, now);
    return reply.code(201).send({ ok: true, automation: toAutomationSummary(coord.automation(id)!) });
  });

  // ── GET /api/automations/:id — one, with its recent runs ────────────────
  app.get('/api/automations/:id', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const row = coord.automation(id);
    if (!row) return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    return reply.code(200).send({
      ok: true, automation: toAutomationSummary(row), runs: coord.automationRuns(id, 20),
    });
  });

  // ── POST /api/automations/:id — edit ────────────────────────────────────
  app.post('/api/automations/:id', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const parsed = parseAutomationBody(req.body);
    if (parsed === 'invalid') return reply.code(400).send({ ok: false, error: 'bad-request' });
    const bytes = Buffer.byteLength(parsed.prompt, 'utf8');
    if (bytes > AUTOMATION_PROMPT_MAX_BYTES) {
      return reply.code(413).send({ ok: false, error: 'oversize', limit: AUTOMATION_PROMPT_MAX_BYTES, bytes });
    }
    const now = Date.now();
    const plan = planSchedule(parsed.cadence, now, null);
    if (plan.scheduleError !== null) {
      return reply.code(409).send({ ok: false, error: 'bad-schedule', scheduleError: plan.scheduleError });
    }
    const edit: AutomationEdit = {
      name: parsed.name, project: parsed.project, prompt: parsed.prompt,
      cadence: parsed.cadence, graceMs: parsed.graceMs, nextRunAt: plan.nextRunAt,
    };
    return sendEditOutcome(reply, coord.updateAutomation(id, edit, now));
  });

  // ── POST /api/automations/:id/arm — refuses `never-run-by-hand` ────────
  app.post('/api/automations/:id/arm', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const row = coord.automation(id);
    if (!row) return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    const now = Date.now();
    const plan = planSchedule(cadenceOf(row.cadence), now, null);
    if (plan.scheduleError !== null) {
      return reply.code(409).send({ ok: false, error: 'bad-schedule', scheduleError: plan.scheduleError });
    }
    return sendArmOutcome(reply, coord.armAutomation(id, plan.nextRunAt, now));
  });

  // ── POST /api/automations/:id/state — pause | retire ────────────────────
  app.post('/api/automations/:id/state', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const body = (req.body ?? {}) as { state?: unknown };
    const now = Date.now();
    // Any token but the two live transitions — `'armed'` included, arming has
    // exactly ONE door (`POST /:id/arm`, §7's gate) — is `409 bad-transition`.
    // Spec §10's status map for this route carries no `400`.
    if (body.state !== 'paused' && body.state !== 'retired') {
      const row = coord.automation(id);
      if (!row) return reply.code(404).send({ ok: false, error: 'unknown-automation' });
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: row.state });
    }
    return sendStateOutcome(reply, coord.setAutomationState(id, body.state, now));
  });

  // ── POST /api/automations/:id/run — *Run now*, D-280 ────────────────────
  //
  // NEVER reads `req.body` — see the file banner. `trigger:'manual'` and the
  // automation's own `project`/`prompt` are the ONLY facts this call carries,
  // and both come off the row this server already trusted, never off today's
  // request. Fires on ANY state but `retired` (spec §6 "A manual run does not
  // ride the sweep"), ignoring `provedAt`/`nextRunAt` — this is the ONLY door
  // that can fire an unarmed automation, which is what makes the arm gate
  // (§7) reachable at all: a new automation is `paused` with `provedAt`
  // NULL, so the sweep's due predicate excludes it by construction.
  app.post('/api/automations/:id/run', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const row = coord.automation(id);
    if (!row) return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    if (row.state === 'retired') {
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: row.state });
    }
    const now = Date.now();
    const claim = coord.claimAndOpenRun({ automationId: id, now, occurrence: { trigger: 'manual' } });
    if ('refused' in claim) {
      if (claim.refused === 'unknown-automation') {
        return reply.code(404).send({ ok: false, error: 'unknown-automation' });
      }
      return reply.code(409).send({ ok: false, refused: claim.refused, leaseUntil: claim.leaseUntil });
    }
    const fireDeps: FireDeps = {
      coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState,
      tmux: deps.tmux, queue: deps.queue,
    };
    // `fireAutomation` calls `checkPostClaim` itself (spec §6 step 5, rungs
    // 3-9 — never rungs 1-2, the due predicate, or `decideFire`: those are
    // the sweep's alone) and, on success, performs the whole act (spawn,
    // identify, adopt, prompt, close) — AWAITED here rather than
    // fired-and-forgotten, because `fireAutomation` is the SINGLE place
    // `checkPostClaim` may run (its own docstring: "runs exactly once, in
    // one place, for both doors") and this route holds no duplicate of that
    // ladder to answer 409 any earlier.
    const outcome = await fireAutomation(fireDeps, toPolicyRow(row), claim.runId, now);
    if ('settle' in outcome && outcome.settle === 'refused') {
      return reply.code(409).send({ ok: false, refused: outcome.refusal, detail: outcome.detail });
    }
    return reply.code(202).send({ ok: true, runId: claim.runId });
  });

  // ── GET /api/automations/:id/runs — history, clamped to the ceiling ─────
  app.get('/api/automations/:id/runs', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    // A retired automation still serves its runs (spec §9 "retire, never
    // delete") — this read does not filter by state at all.
    if (!coord.automation(id)) return reply.code(404).send({ ok: false, error: 'unknown-automation' });
    const q = req.query as { limit?: unknown };
    const limit = typeof q.limit === 'string' && q.limit.trim() !== '' && Number.isFinite(Number(q.limit))
      ? Number(q.limit) : undefined;
    return reply.code(200).send({ ok: true, runs: coord.automationRuns(id, limit) });
  });

  // ── GET /api/automations/runs/:runId — one run and its steps ────────────
  app.get('/api/automations/runs/:runId', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const runId = Number((req.params as { runId: string }).runId);
    if (!Number.isInteger(runId)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const run = coord.automationRun(runId);
    if (!run) return reply.code(404).send({ ok: false, error: 'unknown-run' });
    return reply.code(200).send({ ok: true, run, steps: coord.automationRunEvents(runId) });
  });

  // ── POST /api/automations/pause — the global kill switch ────────────────
  app.post('/api/automations/pause', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const body = (req.body ?? {}) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') return reply.code(400).send({ ok: false, error: 'bad-request' });
    coord.setAutomationsPaused(body.paused, Date.now());
    return reply.code(200).send({ ok: true, paused: body.paused });
  });
}
