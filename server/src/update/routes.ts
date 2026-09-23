import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../server.js';
import type { FleetWatcher } from '../watch.js';
import type { GateDecision } from '../auth/gate.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from '../coord/token.js';
import { NODE_ID_RE, type NodeRow, type ReleaseRow, type SetIntentResult, type UpdateIntentPatch, type UpdateIntentRow } from '../coord/store.js';
import { autoGateBlockers, isIngestibleReleaseTag, renderProjection, resolveNodeIntent } from './resolve.js';
import { CATALOGUE_MAX_REQUESTS_PER_POLL, UNAUTHENTICATED_HOURLY_REQUEST_BUDGET } from './catalogue.js';
import { resolveAndProject, resolveInputFor } from './project.js';
import { SERVER_LABEL, buildInfoOfRow } from './inventory.js';
import {
  isAutoMode, isNotifyMode, isUpdateChannel,
  type AckAnswer, type CatalogueState, type IntentWriteAnswer, type NodeWire, type ReleaseWire,
  type UpdateIntentWire, type UpdateRouteRefusal, type UpdatesView,
} from '../../../shared/api.js';

/**
 * THE UPDATE CONTROL PLANE'S ROUTES (design 2026-09-20 §12, update-management W2).
 * L4: it owns fastify and the clock and DECIDES NOTHING the resolver does not —
 * the auto-gate predicate is `autoGateBlockers`, the desired tag and every
 * resolve sentence are `resolveNodeIntent`'s, the projection's grammar is
 * `renderProjection`'s. What is decided here is only HTTP: which refusal maps to
 * which status.
 *
 * THE CREDENTIALS. Four routes are session-only and carry NO box-token check at
 * all (decision 15: the box token is one shared secret every fleet session
 * holds, so a box-token write would let any session on the box steer the
 * fleet's updates). They need no gate code: `installGate` fronts every route and
 * none of the four is named in `auth/gate.ts`'s EXEMPT table, so armed they sit
 * behind the passkey and, being non-GET, the origin check; dark they are open,
 * as every route is (`gate.ts`'s unarmed-exposure note). The fifth, the
 * projection read, is EXEMPT-BUT-AUTHENTICATED in `GET /api/pools/epoch`'s exact
 * shape — session first, the box token as the fallback, and BEFORE
 * `not-configured` or `unknown-node`, so an anonymous caller learns nothing —
 * because its caller from W4 is a fleet node's timer holding the box token and
 * no cookie jar.
 *
 * THE FILE'S ORDER IS PART OF ITS CENSUS. `box-token-census.test.ts` and
 * `auth-gate.test.ts` read this file as a third route source, slicing it from
 * one registration to the next and counting a box-token call anywhere in a
 * slice — prose included. So the session-only handlers come first and never
 * name the box-token functions, and the projection read is registered LAST.
 */

/** A refusal, typed as the one union every update route answers with. */
const refuse = (reply: FastifyReply, code: number, body: Omit<UpdateRouteRefusal, 'ok'>): FastifyReply =>
  reply.code(code).send({ ok: false, ...body } satisfies UpdateRouteRefusal);

/** Fix round 2 (R1, D-3218): DERIVED, never a hand-typed interval. D-3215's
 *  own text claimed "one request a minute" was well under the unauthenticated
 *  60/hour budget, but a poll now costs up to `CATALOGUE_MAX_REQUESTS_PER_POLL`
 *  requests (the latest-release probe, the listing, and the rare moved-away
 *  tag check) — admitting a poll once a MINUTE let a thumb spend up to
 *  180 requests an hour, three times the budget. The derived gap admits one
 *  poll's WORST CASE once per gap, which lands exactly on the budget:
 *  `CATALOGUE_MAX_REQUESTS_PER_POLL / UNAUTHENTICATED_HOURLY_REQUEST_BUDGET`
 *  of an hour, in ms. */
export const REFRESH_MIN_INTERVAL_MS =
  (CATALOGUE_MAX_REQUESTS_PER_POLL / UNAUTHENTICATED_HOURLY_REQUEST_BUDGET) * 60 * 60_000;
export const INTENT_BODY_KEYS = ['scope', 'channel', 'pinnedTag', 'auto', 'notify'] as const;

export function toReleaseWire(row: ReleaseRow): ReleaseWire {
  return {
    tag: row.tag, version: row.version, channel: row.channel, publishedAt: row.publishedAt,
    commitSha: row.commitSha, bundleListed: row.bundleListed, yanked: row.yanked,
    refused: row.refused.map((r) => ({ by: r.by, at: r.at })), notes: row.notes,
  };
}

/** One live `nodes` row on the wire. `current` is the five `current*` columns
 *  through `buildInfoOfRow` — null unless the stamp read `ok`, so an EACCES never
 *  presents an old stamp as this node's build. `request` needs all three request
 *  columns (the wire's `at` is a number); `report` exists iff a phase was read.
 *  `floorRead`/`previousRead` (fix round 2, R4): ALWAYS sent, never omitted —
 *  `NodeWire`'s optionality is for an older build's fixture/consumer, not for
 *  this mapper, which always has the row's own `TagFileRead` to hand. */
export function toNodeWire(row: NodeRow): NodeWire {
  return {
    nodeId: row.nodeId, role: row.role, label: row.label, os: row.os,
    current: buildInfoOfRow(row), stampRead: row.stampRead, installState: row.installState,
    provenance: row.provenance, caps: [...row.caps], agentOps: row.agentOps === null ? null : [...row.agentOps],
    highestVersion: row.highestVersion, previousVersion: row.previousVersion,
    floorRead: row.floorRead, previousRead: row.previousRead,
    measuredAt: row.measuredAt, reachable: row.reachable, unreachableSince: row.unreachableSince,
    channel: row.channel, desiredTag: row.desiredTag, resolveDetail: row.resolveDetail,
    request: row.requestedTag !== null && row.requestedKind !== null && row.requestedAt !== null
      ? { tag: row.requestedTag, kind: row.requestedKind, at: row.requestedAt }
      : null,
    report: row.reportedPhase === null ? null : {
      phase: row.reportedPhase, target: row.reportedTarget, startedAt: row.reportedStartedAt,
      updatedAt: row.reportedUpdatedAt, detail: row.reportedDetail,
    },
    update: { state: row.updateState, target: row.updateTarget, startedAt: row.updateStartedAt, detail: row.updateDetail },
  };
}

export function toIntentWire(row: UpdateIntentRow): UpdateIntentWire {
  return {
    scope: row.scope, channel: row.channel, pinnedTag: row.pinnedTag, auto: row.auto, notify: row.notify,
    setAt: row.setAt, setBy: row.setBy,
  };
}

export type ParsedIntentBody =
  | { ok: true; scope: string; patch: UpdateIntentPatch }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** The intent body, through the one guard per field. A string `pinnedTag` off
 *  the tag shape is `bad-tag` (§12's own answer for it); every other malformed
 *  input — an unknown key, a non-string scope, a value outside its vocabulary,
 *  a body that is not an object — is `bad-request` naming the field. An EMPTY
 *  patch is not refused here: `setIntent` refuses it, and one refusal is enough.
 *
 *  F11 EXTENSION (fix round 1, D-3216, coordinator's ruling on mail 2210):
 *  this route accepts a `pinnedTag` whether or not it is already a catalogue
 *  row — nothing here or in `setIntent` checks catalogue membership, so the
 *  catalogue's own ingress bound does NOT cover a pin. `isIngestibleReleaseTag`
 *  (imported from `resolve.ts`, never a second copy) is applied here too, so
 *  `v0.0.010` is refused `bad-tag` before it ever reaches the store, the same
 *  way it is skipped at the catalogue's own element parse. */
export function parseIntentBody(body: unknown): ParsedIntentBody {
  const bad = (field: string): ParsedIntentBody => ({ ok: false, error: 'bad-request', field });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(INTENT_BODY_KEYS as readonly string[]).includes(k)) return bad(k);
  }
  const scope = o.scope;
  if (typeof scope !== 'string' || scope === '') return bad('scope');
  const patch: UpdateIntentPatch = {};
  if ('channel' in o) {
    const channel = o.channel;
    if (!isUpdateChannel(channel)) return bad('channel');
    patch.channel = channel;
  }
  if ('pinnedTag' in o) {
    const pinnedTag = o.pinnedTag;
    if (pinnedTag === null) patch.pinnedTag = null;
    else if (typeof pinnedTag !== 'string') return bad('pinnedTag');
    // Fix round 1, review round 2 (minor): `isIngestibleReleaseTag` calls
    // `isReleaseTag` itself, so checking both here was redundant.
    else if (!isIngestibleReleaseTag(pinnedTag)) {
      return { ok: false, error: 'bad-tag', field: 'pinnedTag' };
    } else patch.pinnedTag = pinnedTag;
  }
  if ('auto' in o) {
    const auto = o.auto;
    if (!isAutoMode(auto)) return bad('auto');
    patch.auto = auto;
  }
  if ('notify' in o) {
    const notify = o.notify;
    if (!isNotifyMode(notify)) return bad('notify');
    patch.notify = notify;
  }
  return { ok: true, scope, patch };
}

/** `setIntent`'s refusals as HTTP. `bad-field` cannot arrive past `parseIntentBody`
 *  and is mapped anyway, so a store that learns a new field refusal answers 400
 *  rather than 500.
 *
 *  THE TWO JOURNAL ARMS NEVER PASS `r.detail` TO THE CLIENT (fix round 1,
 *  finding 1): it is `err.message` off a thrown `fs` error, which on an
 *  EACCES/EROFS/ENOSPC carries the server's own absolute `~/.ccrc` path — a
 *  publicly reachable server must not hand that to whoever is asking it to
 *  set an intent. The body carries a fixed sentence instead; the raw
 *  `r.detail` is logged SERVER-SIDE ONLY, by the caller, which has the
 *  request's logger and this function does not. */
function intentRefusal(r: Exclude<SetIntentResult, { ok: true }>): { code: number; body: Omit<UpdateRouteRefusal, 'ok'> } {
  switch (r.why) {
    case 'empty-patch': return { code: 400, body: { error: 'bad-request', field: 'body', detail: 'empty-patch' } };
    case 'bad-field': return { code: 400, body: { error: r.field === 'pinnedTag' ? 'bad-tag' : 'bad-request', field: r.field } };
    case 'unknown-scope': return { code: 404, body: { error: 'unknown-scope', detail: r.scope } };
    // The merge base's stored channel reads null (a token this build cannot
    // name) and the patch names none: a state of the stored row, not of the
    // request — so 409, naming the scope whose row holds it.
    case 'no-channel': return { code: 409, body: { error: 'no-channel', detail: r.base } };
    case 'journal-unreadable':
      return { code: 503, body: { error: 'journal-unreadable', detail: 'the intent journal could not be read — see the server log' } };
    case 'journal-unwritable':
      return { code: 503, body: { error: 'journal-unwritable', detail: 'the intent journal could not be written — see the server log' } };
  }
}

/** `{nodeId}` and nothing else. */
function parseAckBody(body: unknown): { ok: true; nodeId: string } | { ok: false; field: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'body' };
  for (const k of Object.keys(body)) if (k !== 'nodeId') return { ok: false, field: k };
  const nodeId = (body as { nodeId?: unknown }).nodeId;
  return typeof nodeId === 'string' && nodeId !== '' ? { ok: true, nodeId } : { ok: false, field: 'nodeId' };
}

export function registerUpdateRoutes(
  app: FastifyInstance, deps: Deps,
  /** `buildServer`'s `sessionAuth` — read by the projection read alone; the four
   *  session-only routes leave the session to the gate. */
  sessionAuth: (req: FastifyRequest) => GateDecision,
  watcher?: FleetWatcher,
): void {
  /**
   * BEFORE THE FIRST SWEEP THERE IS NO ROW FOR THIS BOX, and an empty node list
   * reads as "no box" — spec §12's pin is "never an empty list". So a read that
   * finds no live `server` row joins the watcher's single-flight inventory run
   * once (`inventoryNow()`, which also resolves and projects). With no watcher —
   * `index.ts` always passes one; a test may not — it answers what is stored. A
   * failed sweep is logged and the stored rows answered: the read must not 500
   * on a measurement that has its own error columns.
   */
  const ensureInventory = async (req: FastifyRequest): Promise<void> => {
    if (!deps.coord || !watcher || deps.coord.nodeByLabel(SERVER_LABEL) !== null) return;
    try {
      await watcher.inventoryNow();
    } catch (err) {
      // `Fastify({ logger: false })` (server.ts) makes `req.log.*` a NOOP
      // (fix round 2, finding 1, verified under fastify 5.10.0) — `console.warn`
      // is the house pattern (`server.ts`'s `/api/notify` refusal, ~1487).
      console.warn(`ccrc-server: update: the on-demand inventory sweep failed; answering the stored ` +
        `rows: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * RESOLVE EVERY LIVE NODE AND WRITE THIS BOX'S OWN PROJECTION, in the request
   * that changed an input — spec §9: the server-role writer runs "at every
   * resolution AND on every inventory sweep". Its outcome is logged, never the
   * request's answer: the write it follows has already happened, and a
   * projection that could not be written is re-attempted by the next sweep.
   * It does NOT go through the watcher's single-flight: a write route must not
   * wait out a whole sweep's agent reads. What keeps this run and a sweep's run
   * from interleaving two writers of the file is `resolveAndProject`'s own
   * per-directory queue (Task 12). It snapshots only after the run ahead of it
   * has renamed, so a sweep that read epoch E0 before this request's write can
   * never land its document after this one's E1.
   */
  const reproject = async (req: FastifyRequest): Promise<void> => {
    if (!deps.coord) return;
    try {
      const run = await resolveAndProject({ store: deps.coord, role: deps.cfg.role, ccrcDir: deps.cfg.ccrcDir }, Date.now());
      // `Fastify({ logger: false })` makes `req.log.*` a NOOP (fix round 2,
      // finding 1) — `console.warn` in the house form is the only place any
      // of the three outcomes below reaches an operator.
      if (!run.projection.ok && run.projection.why === 'unwritable') {
        console.warn(`ccrc-server: update: the server-role projection could not be written: ${run.projection.detail}`);
      }
      for (const r of run.refused) {
        console.warn(`ccrc-server: update: a node resolution was refused: ${r.nodeId} (${r.why})`);
      }
    } catch (err) {
      console.warn(`ccrc-server: update: resolution after a write failed; the next inventory sweep retries it: ` +
        `${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** The whole surface the PWA's /settings reads (W3). Superseded rows are
   *  excluded by `nodes()` itself. Session-only: not in EXEMPT. */
  app.get('/api/updates', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    await ensureInventory(req);
    const view: UpdatesView = {
      catalogue: deps.catalogue?.state() ?? { lastOkAt: null, lastError: null },
      releases: deps.coord.releases().map(toReleaseWire),
      nodes: deps.coord.nodes().map(toNodeWire),
      intent: deps.coord.intents().map(toIntentWire),
    };
    return view;
  });

  /**
   * The operator's desired state. The auto gate is ADVISORY (spec §9 — the
   * dispatcher is the enforcement, at dispatch time, programme wave 5):
   * `auto ≠ off` is refused while any node in scope, reachable or not, lacks
   * `update-gate` in its measured caps — which in W2 is every node, since no
   * W2 spine writes the word. This is a 409 on the WRITE, nothing more: an
   * EMPTY inventory (`ensureInventory` returned with no watcher, or a sweep's
   * server-row throw) passes `autoGateBlockers` vacuously — `nodes()` can be
   * `[]`, and `autoGateBlockers('*', [])` is `[]` — so `auto` can still be set
   * before any node has ever been measured (fix round 1, F7). Nothing here
   * enforces the gate again later; that is the dispatcher's job.
   */
  app.post('/api/updates/intent', async (req, reply) => {
    if (!deps.coord || !deps.updateIntentLog) return refuse(reply, 501, { error: 'not-configured' });
    const parsed = parseIntentBody(req.body);
    if (!parsed.ok) return refuse(reply, 400, { error: parsed.error, field: parsed.field });
    if (parsed.patch.auto !== undefined && parsed.patch.auto !== 'off') {
      // EXCEPTION to `reproject`'s "a write route must not wait out a whole
      // sweep's agent reads" (below): the auto gate must be measured, not
      // stale, before it lets `auto` through, so this ONE write path — unlike
      // every other write in this file — awaits `ensureInventory`'s full
      // single-flight sweep on a box with no `server` row yet (fix round 1,
      // finding 7). It still costs nothing when the row exists, which it does
      // after the first tick.
      await ensureInventory(req);
      const blockers = autoGateBlockers(parsed.scope,
        deps.coord.nodes().map((n) => ({ nodeId: n.nodeId, caps: n.caps })));
      if (blockers.length > 0) return refuse(reply, 409, { error: 'auto-needs-rollback-gate', nodes: blockers });
    }
    const written = deps.coord.setIntent(parsed.scope, parsed.patch, deps.updateIntentLog, Date.now());
    if (!written.ok) {
      // The raw fs error (which may embed the server's own ~/.ccrc path) is
      // logged here, server-side only — `intentRefusal` never sees it (fix
      // round 1, finding 1). `console.warn`, not `req.log.warn`: this server
      // runs `Fastify({ logger: false })`, so `req.log.*` is a silent noop
      // (fix round 2, finding 1) — `console.warn` in the house form
      // (`server.ts`'s `/api/notify` refusal) is the only line that reaches
      // an operator.
      if (written.why === 'journal-unreadable' || written.why === 'journal-unwritable') {
        console.warn(`ccrc-server: update: the intent journal failed (${written.why}): ${written.detail}`);
      }
      const { code, body } = intentRefusal(written);
      return refuse(reply, code, body);
    }
    await reproject(req);
    // The epoch RE-MEASURED after the write, the `POST /api/pools/accounts/:id`
    // idiom: the answer reports the store, not the write's own return value.
    const answer: IntentWriteAnswer = { ok: true, intent: toIntentWire(written.row), epoch: deps.coord.updateEpoch().epoch };
    return answer;
  });

  /**
   * An on-demand catalogue poll. RATE-LIMITED to one POLL per
   * `REFRESH_MIN_INTERVAL_MS` (spec §7: the unauthenticated budget is
   * 60/hour and a 304 still spends one), measured against the poller's own
   * `lastRequestAt()` — so the scheduled 30-minute poll counts too, and a
   * refresh inside the interval of it answers 429 (D-3203). Fix round 2
   * (R1, D-3218): D-3215's own text called this "one request a minute" — but
   * a single poll now costs up to `CATALOGUE_MAX_REQUESTS_PER_POLL`
   * requests, so a door open once a minute admitted up to 180 requests an
   * hour, three times the budget. `REFRESH_MIN_INTERVAL_MS` is DERIVED from
   * that same per-poll maximum and the hourly budget (never a hand-typed
   * interval), landing exactly on it. The 429 answer shape is unchanged. A
   * `lastRequestAt` in the FUTURE (the clock stepped back) does not lock the
   * door: only an elapsed time in `[0, REFRESH_MIN_INTERVAL_MS)` refuses.
   */
  app.post('/api/updates/refresh', async (req, reply) => {
    if (!deps.coord || !deps.catalogue) return refuse(reply, 501, { error: 'not-configured' });
    const now = Date.now();
    const last = deps.catalogue.lastRequestAt();
    if (last !== null) {
      const since = now - last;
      if (since >= 0 && since < REFRESH_MIN_INTERVAL_MS) {
        const retryAfterS = Math.max(1, Math.ceil((REFRESH_MIN_INTERVAL_MS - since) / 1000));
        reply.header('retry-after', String(retryAfterS));
        return refuse(reply, 429, { error: 'rate-limited', retryAfterS });
      }
    }
    const state: CatalogueState = await deps.catalogue.poll(now);
    await reproject(req);
    return state;
  });

  /**
   * The operator acknowledges a halted node (spec §12): back to `idle`, the
   * request cleared and THIS node's refusals cleared, in `ackNode`'s one
   * transaction (D-3183) — then re-resolved in this request, so a
   * release the node had refused is eligible again on the answer itself.
   */
  app.post('/api/updates/ack', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const body = parseAckBody(req.body);
    if (!body.ok) return refuse(reply, 400, { error: 'bad-request', field: body.field });
    const acked = deps.coord.ackNode(body.nodeId);
    if (!acked.ok) {
      if (acked.why === 'unknown-node') return refuse(reply, 404, { error: 'unknown-node' });
      if (acked.why === 'superseded') return refuse(reply, 409, { error: 'superseded', detail: acked.supersededBy });
      return refuse(reply, 409, { error: 'busy', detail: acked.state });
    }
    await reproject(req);
    const row = deps.coord.node(body.nodeId);
    if (row === null) return refuse(reply, 404, { error: 'unknown-node' });
    const answer: AckAnswer = { ok: true, node: toNodeWire(row) };
    return answer;
  });

  /**
   * THE PROJECTION READ — the §9 document for one node, resolved on the read
   * (the stored columns hold no `desired-stable`/`desired-dev`), in unix SECONDS
   * (`server.ts`'s C1 lesson on `GET /api/pools/epoch`). EXEMPT-BUT-AUTHENTICATED:
   * `GET /api/pools/epoch`'s guard copied shape for shape — session FIRST, the
   * box token as the fallback, 401 only when both fail, and BEFORE
   * `not-configured` and before the node lookup, so an anonymous caller learns
   * neither whether this box has a control plane nor whether a node-id exists.
   * Registered LAST in this file (see the module docstring).
   */
  app.get('/api/updates/intent/:nodeId', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return refuse(reply, 401, { error: 'unauthenticated', verdict: session.verdict });
        }
      }
    }
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const { nodeId } = req.params as { nodeId: string };
    // A `:nodeId` that is not a measured node-id (`NODE_ID_RE`, Global
    // Constraint "a node-id is a lowercase UUID") can never be a live row's
    // key — the SAME 404 the missing-node arm answers, not a distinct shape
    // that would tell a caller its malformed id was at least well-formed
    // (fix round 1, finding 4).
    if (!NODE_ID_RE.test(nodeId)) return refuse(reply, 404, { error: 'unknown-node' });
    const row = deps.coord.node(nodeId);
    if (row === null) return refuse(reply, 404, { error: 'unknown-node' });
    if (row.supersededBy !== null) return refuse(reply, 409, { error: 'superseded', detail: row.supersededBy });
    const resolution = resolveNodeIntent(resolveInputFor(deps.coord, row));
    const rendered = renderProjection(resolution, deps.coord.updateEpoch().epoch, Math.floor(Date.now() / 1000));
    if (!rendered.ok) return refuse(reply, 409, { error: 'no-channel', detail: rendered.detail });
    return reply.type('text/plain; charset=utf-8').send(rendered.text);
  });
}
