import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../server.js';
import type { Bus } from '../bus.js';
import { measuredIdentity, readRegistry, readRegistryMeasured } from '../registry.js';
import { assembleFleet } from '../fleet.js';
import { peerDeliverable, archiveContradicted } from './peers.js';
import { CCD_ARGV, verbSupported, sweepDec } from '../ccdargv.js';
import { tx } from './db.js';
import { toRunSummary, type CoordStore } from './store.js';
import { renderEnvelope } from './envelope.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from './token.js';
import { NO_SESSION, type GateDecision } from '../auth/gate.js';
import { verifyDone, type DoneClaim } from './fingerprint.js';
import { dispatchRun, type DispatchOutcome, type DispatchRunDeps } from './dispatch.js';
import { closeRun, type CloseOutcome, type CloseRunDeps } from './close.js';
import { settleItems, type SettleItemsOutcome } from './items.js';
import { holdReason, queueSystemMail } from './rundefs.js';
import {
  isRunState, isSendableMailKind, MAIL_ARTIFACTS_MAX, MAIL_ARTIFACT_PATH_MAX_BYTES, MAIL_BODY_MAX_BYTES,
  MAIL_SUBJECT_MAX_BYTES, PEER_ETIQUETTE, PEER_MAIL_HOURLY, PEER_MAIL_MAX_OUTSTANDING, RUN_TRANSITIONS,
  type LifecycleQueryResult, type MailRejectCode, type PeerSummary, type RunState,
  type RunSummary,
} from '../../../shared/api.js';

/**
 * One coordinator-wide async mutex, serialising the WRITE routes' bodies
 * (open, dispatch, close, advance) — fix, review findings 4/11/23/24: every
 * one of those findings has the identical shape, a READ-ONLY precondition
 * (the transition guard, the caps count) separated from the WRITE that
 * commits it by several `await`s over live fleet acts (`ccd ws-add`,
 * `sendPrompt`), with Fastify serving requests concurrently and nothing in
 * the route serialising them. `CoordStore` itself cannot close this gap: it
 * is synchronous `DatabaseSync`, so its OWN transactions never interleave,
 * but the fleet acts BETWEEN one request's precondition read and its store
 * write are awaits a second, concurrent request sails straight through —
 * `deps.queue` (`KeyedQueue`) only wraps `sendPrompt` itself, per session,
 * never a route's whole body, and `ccdRunner` is a bare async call with no
 * mutex of its own.
 *
 * This queues the ENTIRE body of each write route behind whichever one is
 * already running — cheap, because dispatch/close/advance are
 * operator-cadence calls, not a hot path, and correct, because it turns
 * every one of the named races into what the routes' own review comments
 * already say they should have been: a CLAIM, not a read. Concretely: a
 * retried dispatch for the SAME run now only ever starts after the first
 * one has fully committed (or failed), so its precondition read sees the
 * true, current state instead of a stale `planned`; two dispatches for
 * DIFFERENT runs against a shared `maxConcurrentWorkers` cap can no longer
 * both read the count before either writes it.
 *
 * One instance PER `registerCoordRoutes` CALL (i.e. per server), not a
 * module-level singleton — the same "one coordinator, one chokepoint" model
 * spec:192-198 states for the whole coordination API, and it keeps
 * independent test servers (`run-routes.test.ts` builds many, sequentially,
 * in one process) from sharing a lock across app instances that have
 * nothing to do with each other.
 */
class CoordMutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * `dispatchRun`'s typed result union -> HTTP status + body (architecture doc
 * increment 4: "the routes become union->status maps"). The ONLY place in
 * this file that turns a `DispatchOutcome` into wire JSON — every shape
 * below is byte-identical to what the route used to build inline, field for
 * field, so the response contract this suite pins did not move even though
 * the decision that produces it did.
 *
 * TOTALITY (fix round 1, finding 1/3): `server/tsconfig.json` sets neither
 * `noImplicitReturns` nor anything else that would make a `switch` with no
 * `default` a compile error, and this was — measured — the first
 * union->status switch in the tree: adding a member to `DispatchOutcome` and
 * handling it nowhere typechecked clean (`npx tsc --noEmit` exit 0), and at
 * runtime the switch falls off its end, this function returns `undefined`,
 * and an async Fastify handler resolving to `undefined` with `reply.send()`
 * never called answers `FST_ERR_PROMISE_NOT_FULFILLED` — a 500 on exactly
 * the path this typed union promised was total. The `default` arm below
 * makes that a TYPE error instead: `r` is narrowed to `never` by every case
 * above being exhaustive, so a future variant with no arm here fails
 * `const _exhaustive: never = r` at compile time, before it ever reaches a
 * request. The runtime 500 is the fallback for the one case the type system
 * cannot prevent — a built artefact running against a `DispatchOutcome`
 * shape newer than itself.
 */
function sendDispatchOutcome(reply: FastifyReply, r: DispatchOutcome) {
  if (r.ok) {
    return reply.code(200).send({
      ok: true, id: r.id, sessionId: r.sessionId, resumed: r.resumed, clearedAt: r.clearedAt,
      briefQueued: r.briefQueued, ...(r.clearError !== null ? { clearError: r.clearError } : {}),
      // §1.5. UNCONDITIONAL, not spread-when-interesting: the coordinator sees
      // nothing but this JSON, and `adopted:false`/`spawnState:null` is itself the
      // answer to "did that pane come up clean?". Dropping either here would be an
      // L4 adapter narrowing a distinction it received — and
      // `coordinator-skill/references/wave-lifecycle.md` documents both by name.
      adopted: r.adopted, spawnState: r.spawnState,
    });
  }
  switch (r.kind) {
    case 'unknown-run': return reply.code(404).send({ ok: false, error: 'unknown-run' });
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from, to: r.to });
    case 'bad-request': return reply.code(400).send({ ok: false, error: 'bad-request' });
    // `detail` rides along unconditionally — it is a distinction this adapter
    // RECEIVED (which of the two sizes, and by how much), and the sender cannot
    // recompute it: the brief they hold is not the body the cap measured. The
    // sentence itself is L1's, spelled beside the check that refuses.
    case 'oversize':
      return reply.code(413).send({ ok: false, error: 'oversize', limit: r.limit, detail: r.detail });
    case 'refused': {
      const extra: Record<string, number> = {};
      if (r.limit !== undefined) extra.limit = r.limit;
      if (r.running !== undefined) extra.running = r.running;
      if (r.used !== undefined) extra.used = r.used;
      if (r.candidates !== undefined) extra.candidates = r.candidates;
      return reply.code(409).send({ ok: false, refused: r.code, ...extra });
    }
    // The `stderr` spread, not `stderr: r.stderr`: an L4 adapter may not narrow a
    // distinction it received, and this member's `stderr` distinguishes by
    // PRESENCE — "ccd also failed, and this is what it said" from "ccd is not the
    // failing party". Naming it unconditionally would put `undefined` on the wire
    // for the second case, which JSON drops anyway; spreading says so on purpose.
    case 'registry-unmeasurable':
      return reply.code(502).send({
        ok: false, error: 'registry-unmeasurable',
        ...(r.stderr === undefined ? {} : { stderr: r.stderr }),
      });
    case 'unsupported': return reply.code(501).send({ ok: false, error: 'unsupported' });
    case 'fleetFailed': return reply.code(502).send({ ok: false, stderr: r.stderr });
    case 'advanceFailed': return reply.code(409).send(r.adv);
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
    }
  }
}

/** `closeRun`'s typed result union -> HTTP status + body. Same discipline as
 *  `sendDispatchOutcome` just above: byte-identical to the shapes the route
 *  used to build inline, and the same totality guard (fix round 1,
 *  finding 1/3) — see that function's own docstring for the measurement. */
function sendCloseOutcome(reply: FastifyReply, r: CloseOutcome) {
  if (r.ok) return reply.code(200).send({ ok: true, id: r.id, state: r.state, released: r.released });
  switch (r.kind) {
    case 'unknown-run': return reply.code(404).send({ ok: false, error: 'unknown-run' });
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from, to: r.to });
    case 'bad-request': return reply.code(400).send({ ok: false, error: 'bad-request' });
    case 'refused': return reply.code(409).send({ ok: false, refused: r.code });
    case 'doneVerdict': return reply.code(409).send({ ok: false, error: r.code, detail: r.detail });
    case 'unsupported': return reply.code(501).send({ ok: false, error: 'unsupported' });
    case 'fleetFailed': return reply.code(502).send({ ok: false, stderr: r.stderr });
    case 'advanceFailed': return reply.code(409).send(r.adv);
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
    }
  }
}

/** `settleItems`' typed result union -> HTTP status + body (Build 4, Task 3).
 *  Same discipline and the same totality guard as the two maps above. The two
 *  refusals split on the code rather than on a third union member because
 *  they are one KIND of answer — "this write names an item it may not move" —
 *  told apart only by which HTTP status says so: `unknown-item` is a 404 (this
 *  run has no such item) and `item-terminal` a 409 (it has one, already
 *  settled). `state` rides along only on the second, which is the only one
 *  that has one. */
function sendSettleItemsOutcome(reply: FastifyReply, r: SettleItemsOutcome) {
  if (r.ok) return reply.code(200).send({ ok: true, id: r.id, items: r.items });
  switch (r.kind) {
    case 'unknown-run': return reply.code(404).send({ ok: false, error: 'unknown-run' });
    case 'bad-request': return reply.code(400).send({ ok: false, error: 'bad-request' });
    case 'refused':
      return reply.code(r.code === 'unknown-item' ? 404 : 409)
        .send({ ok: false, refused: r.code, itemId: r.itemId, ...(r.state ? { state: r.state } : {}) });
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
    }
  }
}

/**
 * The coordination routes. Registered from `buildServer` rather than declared
 * there, because `server.ts` is already the file whose whole discipline is not
 * holding a second copy of a contract, and six more routes inline would be six
 * more places the token gate has to be remembered.
 *
 * EVERY ROUTE HERE ANSWERS 501 `{ok:false,error:'not-configured'}` WITHOUT A
 * STORE, the same shape the push routes and `/api/notifications/catchup`
 * already use (`server.ts:186-215`): a box with no coordination database is
 * not broken, it simply has none.
 *
 * MAIL LIVES HERE; RUN ROUTES ARE TASK 9's, in this same file — both share the
 * token+attribution gate, and splitting it would be two copies of that gate.
 * Dispatch's and close's own DECISIONS live in `dispatch.ts`/`close.ts`
 * (architecture doc increment 4); this file keeps the token gate, the
 * `CoordMutex` and the union->status maps.
 */
export function registerCoordRoutes(
  app: FastifyInstance, deps: Deps,
  // Unused by the mail routes below; kept in the signature because Task 9's
  // run routes land in this same file and share it — a signature that grows
  // per-task would be a second copy of the token+attribution gate wiring.
  _bus: Bus,
  /**
   * Does this request carry a live session? Supplied by `buildServer`, because
   * the session store deliberately does NOT live in `Deps` — it must be loaded
   * exactly once, at boot, and `buildServer` is the one function every caller
   * goes through (see its own comment, D-122's read-side mirror).
   *
   * A FUNCTION RETURNING THE DECISION, not a boolean: `GET /api/runs` needs the
   * `verdict` as well as the yes/no, so its refusal can carry the same
   * `AuthVerdict` the gate would have sent and the PWA's one login screen keeps
   * working (D-149). Defaulted, so the handful of tests that construct these
   * routes without a session layer are unchanged — and defaulted to "no
   * session", which DENIES, so a caller that forgets to wire it falls back on
   * the box token rather than on nothing.
   */
  sessionAuth: (req: FastifyRequest) => GateDecision = () => NO_SESSION,
): void {
  const notConfigured = (reply: FastifyReply) => reply.code(501).send({ ok: false, error: 'not-configured' });

  // One instance for this server (see `CoordMutex`'s own docstring) —
  // serialises the WRITE routes' bodies below: open, dispatch, close, advance.
  const coordMutex = new CoordMutex();

  /**
   * The box-token gate (fix, review findings 3/10/27): `POST /api/runs`,
   * `POST /api/runs/:id/dispatch`, `POST /api/runs/:id/close`,
   * `POST /api/runs/:id/advance` and `GET /api/mail?to=` now carry the SAME
   * gate `/api/mail`/`/api/mail/:id/ack` already did — PR J's own "Interfaces
   * assumed from PR I" contract item 6 states all six coordinator write
   * routes are authenticated by the box token, in so many words, and this
   * build used to leave three of them wide open on the tailnet while the
   * mail pair refused even an UNCONFIGURED token. The asymmetry was real: an
   * unauthenticated `POST .../dispatch` on a wave-N>=2 run runs `ccd ensure`
   * and injects `/clear` into a LIVE worker — destroying the wave's context —
   * and an unauthenticated `POST .../close` can `ws-archive` a workspace with
   * `verifyDone` skipped (`state:'failed'`) — strictly more dangerous acts
   * than inserting a `mail` row, which required the token all along.
   *
   * Same shape as the mail routes' own inline gate (not a shared function
   * there either — see check 1's own comment on `/api/mail`): `'legacy'` and
   * `'unconfigured'` both refuse here exactly as they do there. There is no
   * legacy caller of these routes to protect (they are new in this build,
   * same argument `/api/mail`'s own docstring already makes for itself), so
   * neither tolerance applies.
   */
  const requireMailToken = (req: FastifyRequest, reply: FastifyReply, route: string): boolean => {
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
    if (verdict === 'ok') return true;
    const detail = verdict === 'legacy'
      ? `no box token presented — ${route} grants no legacy tolerance (that is /api/notify only)`
      : verdict === 'unconfigured'
        ? `no box token is configured on this server — ${route} fails shut on an unconfigured token, ` +
          'it does not fail open'
        : 'wrong box token';
    reply.code(401).send({ ok: false, error: 'unauthenticated', detail });
    return false;
  };

  /** One refusal, recorded and answered. The record is the point: spec:147-148
   *  makes a rejected message a fact about the fleet, and the operator's first
   *  question when a worker says "I told the coordinator" is whether the
   *  message ever arrived. `ctx` never carries `code`/`detail` itself — both
   *  are this function's own parameters, spread on top so a call site cannot
   *  accidentally supply a stale one. */
  const refuse = (
    reply: FastifyReply, status: number, code: MailRejectCode,
    ctx: Omit<Parameters<CoordStore['recordRejection']>[0], 'code' | 'detail'>,
    detail: string,
  ) => {
    deps.coord!.recordRejection({ ...ctx, code, detail });
    return reply.code(status).send({ ok: false, error: code, detail });
  };

  /**
   * The ingress. `spec:136-148`: box token authenticates the box; `{fromId,
   * fromUuid}` rides as attribution and is checked against the registry with
   * the hookstate gate's exact shape; rejection codes are typed and total;
   * every rejection is itself recorded.
   *
   * THE ATTRIBUTION GATE IS COPIED, NOT RE-DERIVED, from `hookstate.ts:149-150`
   * — the one identity gate already in this tree. And it carries the same
   * honesty the spec insists on: this is freshness, not forgery-proofness.
   * Every session on the box can read every `.uuid` file and could present a
   * neighbour's pair. What it catches is a STALE sender — a session that was
   * `/clear`ed or compacted since it read its own uuid, which `_sync_uuid`
   * rotates every 5s (`ccd/ccd:9004`, cadence at `ccd/ccd:10472`) — and an honest mistake.
   *
   * The order below IS the design: a cheaper refusal must never be reached
   * after an expensive one.
   */
  app.post('/api/mail', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;

    // 1: box token. Same shared check `/api/notify` uses, but NOT the same
    // gate: `/api/notify`'s one-deploy-generation `legacy` tolerance
    // (spec:150-155) is scoped to that route by name, because it is the one
    // route with a pre-existing deployed caller a rollout could go dark
    // under. `/api/mail` is new in this very build — there is no old caller
    // to protect, and the spec lists `unauthenticated` as a plain, total
    // rejection code for it (spec:136-148) with no tolerance carved out
    // (fix-round finding 3/5: an earlier draft of this gate read `'legacy'`
    // as pass-through here too, treating notify's rollout excuse as if it
    // transferred — it does not; see coord/token.ts's `checkMailToken`
    // docstring). `ok` is the only verdict that proceeds; `'legacy'`,
    // `'unconfigured'` and `'bad'` all refuse, and — unlike `/api/notify`,
    // which has no coordination store to record into — all three land in
    // `mail_rejections` via `refuse()` below, so "was a tokenless POST ever
    // accepted" is an answerable question, not a silent gap.
    //
    // `'unconfigured'` (Task 7 fix-round finding 3 / D-39): a server whose
    // token file was never minted must not run this route open, the way
    // `/api/notify` is still entitled to — `/api/mail` has no pre-existing
    // deployed caller a strict gate could strand, the identical argument
    // that already ruled out a `'legacy'` tolerance here.
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
    if (verdict !== 'ok') {
      const detail = verdict === 'legacy'
        ? 'no box token presented — /api/mail grants no legacy tolerance (that is /api/notify only)'
        : verdict === 'unconfigured'
          ? 'no box token is configured on this server — /api/mail fails shut on an unconfigured ' +
            'token, it does not fail open (fix-round finding 3)'
          : 'wrong box token';
      return refuse(reply, 401, 'unauthenticated', {}, detail);
    }

    // 2: body shape. fromId/fromUuid/toId/subject/body must all be strings;
    // artifacts (when given) must be an array of ABSOLUTE PATHS — spec:52-53,
    // "artifact = paths, never payloads" — and runId (when given) must be an
    // integer. All three failures are the same code: the body did not have
    // the shape this route can act on at all.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fromId = body['fromId'];
    const fromUuid = body['fromUuid'];
    const toId = body['toId'];
    const subject = body['subject'];
    const msgBody = body['body'];
    const kind = body['kind'];
    const runIdRaw = body['runId'];
    const artifactsRaw = body['artifacts'];

    if (typeof fromId !== 'string' || typeof fromUuid !== 'string' || typeof toId !== 'string' ||
        typeof subject !== 'string' || typeof msgBody !== 'string') {
      return refuse(reply, 400, 'bad-kind',
        { fromId: typeof fromId === 'string' ? fromId : undefined,
          toId: typeof toId === 'string' ? toId : undefined },
        'fromId/fromUuid/toId/subject/body must all be strings');
    }

    const artifacts = artifactsRaw === undefined ? [] : artifactsRaw;
    if (!Array.isArray(artifacts) || !artifacts.every((a) => typeof a === 'string' && path.isAbsolute(a))) {
      return refuse(reply, 400, 'bad-kind', { fromId, toId, subject },
        'artifacts must be an array of absolute paths — paths, never payloads (spec:52-53)');
    }

    let runId: number | null;
    if (runIdRaw === undefined || runIdRaw === null) {
      runId = null;
    } else if (typeof runIdRaw === 'number' && Number.isInteger(runIdRaw)) {
      runId = runIdRaw;
    } else {
      return refuse(reply, 400, 'bad-kind', { fromId, toId, subject },
        'runId must be an integer when given');
    }

    // 3: sendable kind. `isSendableMailKind` deliberately excludes `unknown` —
    // a sender cannot ask for the we-do-not-know bucket.
    if (!isSendableMailKind(kind)) {
      return refuse(reply, 400, 'bad-kind', { fromId, toId, subject, runId },
        `unrecognised or missing mail kind: ${JSON.stringify(kind)}`);
    }

    // 4: size caps, measured in UTF-8 BYTES — hookstate.ts:128-135 already had
    // to learn this distinction; a body of astral characters is twice the
    // string length in bytes. `subject` and `artifacts` are capped here too
    // (fix-round finding 8 / D-44): `subject` renders as ONE envelope line
    // and `artifacts` renders ONE LINE PER ENTRY (`envelope.ts`), and
    // `sendPrompt` costs one agent round trip PER LINE — an uncapped
    // `artifacts` array is a way to smuggle tens of thousands of injection
    // round trips through a request that never touches the body cap and
    // stays well under Fastify's default 1 MiB body limit (`server.ts`
    // builds `Fastify({ logger: false })` with no `bodyLimit` override).
    if (Buffer.byteLength(msgBody, 'utf8') > MAIL_BODY_MAX_BYTES) {
      return refuse(reply, 413, 'oversize', { fromId, toId, kind, subject, runId },
        `body exceeds ${MAIL_BODY_MAX_BYTES} bytes`);
    }
    if (Buffer.byteLength(subject, 'utf8') > MAIL_SUBJECT_MAX_BYTES) {
      return refuse(reply, 413, 'oversize', { fromId, toId, kind, subject, runId },
        `subject exceeds ${MAIL_SUBJECT_MAX_BYTES} bytes`);
    }
    if (artifacts.length > MAIL_ARTIFACTS_MAX) {
      return refuse(reply, 413, 'oversize', { fromId, toId, kind, subject, runId },
        `artifacts exceeds ${MAIL_ARTIFACTS_MAX} entries`);
    }
    if ((artifacts as string[]).some((a) => Buffer.byteLength(a, 'utf8') > MAIL_ARTIFACT_PATH_MAX_BYTES)) {
      return refuse(reply, 413, 'oversize', { fromId, toId, kind, subject, runId },
        `an artifact path exceeds ${MAIL_ARTIFACT_PATH_MAX_BYTES} bytes`);
    }

    // 5/6/7 all read the registry, and the registry read ITSELF can fail —
    // `io.readdir` returning `null` (an ordinary transient failure in remote
    // mode: one dropped agent-WS round trip) is not evidence that no session
    // exists anywhere on the fleet, and `readRegistry` collapses exactly that
    // failure to `[]` (`registry.ts:104`). Reading `[]` as "the sender does
    // not exist" turns a transient hiccup into a PERMANENT, recorded
    // `unknown-sender` for a session that is plainly alive — the same
    // NOT-KNOWING-IS-NOT-`[]` rule `tip-unmeasurable`/`pr-unmeasurable`
    // already state for the done-authority checks, inverted here (fix-round
    // finding 1 / D-37): a fact this route could not measure must never read
    // as a fact that MISMATCHED either. `names` — the raw directory listing —
    // is read directly, ONCE, and reused below rather than re-derived,
    // mirroring the same fail-shut-on-unlistable-registry idiom Task 8's
    // `sweepMail` and Task 9's dispatch-pause check both use for the same
    // directory.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      return refuse(reply, 502, 'registry-unmeasurable', { fromId, toId, kind, subject, runId },
        'the registry directory could not be listed — transient, not a fact about the sender');
    }
    const registry = await readRegistry(deps.io, deps.cfg);

    // 5: sender — a registry row must exist for fromId.
    const sender = registry.find((r) => r.id === fromId);
    if (!sender) {
      // `readRegistry` also drops a row that WAS listed (its `.uuid` file
      // exists in `names`) when a sibling field read fails (`registry.ts:123`,
      // "incomplete registry entry — skip, don't crash") — ALSO transient,
      // not "this session does not exist". `names` proves presence
      // independently of whether every field could be read, the same
      // evidence `registry.ts`'s own `HOLD_UNREADABLE` sentinel already
      // trusts for `.hold`.
      if (names.includes(`${fromId}.uuid`)) {
        return refuse(reply, 502, 'registry-unmeasurable', { fromId, toId, kind, subject, runId },
          `registry row for ${fromId} is listed but unreadable — transient, not a fact about the sender`);
      }
      return refuse(reply, 403, 'unknown-sender', { fromId, toId, kind, subject, runId },
        `no registry row for ${fromId}`);
    }

    // 5.5: unmeasured identity (registry ladder, architecture doc increment
    // 1's second half) — a sender row IS found (its `.uuid` is listed and
    // survived `buildRecord`), but one or more of `uuid`/`wrapper`/`workdir`
    // could not be read this pass. `measuredIdentity` is the one door to the
    // triple, and it is null here for exactly that reason. Without this
    // gate, an unmeasured `sender.uuid` reads as `''` (never `null` — see
    // `SessionRecord.unmeasured`'s own docstring) and check 6 below would
    // silently downgrade it to `stale-uuid` — a TERMINAL, 403 refusal
    // recorded against a sender that is plainly still there, for what is
    // only a transient read failure. `registry-unmeasurable` is the SAME
    // transient, 502-retryable shape check 5 already answers for a
    // listed-but-dropped row; this is its sibling for a listed-and-degraded
    // one.
    const senderIdentity = measuredIdentity(sender);
    if (senderIdentity === null) {
      return refuse(reply, 502, 'registry-unmeasurable', { fromId, toId, kind, subject, runId },
        `registry row for ${fromId} is listed but its identity could not be measured — ` +
          'transient, not a fact about the sender');
    }

    // 6: attribution — fromUuid === $REG/<id>.uuid, non-empty (guaranteed by
    // `measuredIdentity` above — a MEASURED triple member is never the empty
    // string, only a DEGRADED one is, and check 5.5 already refused that).
    if (senderIdentity.uuid !== fromUuid) {
      return refuse(reply, 403, 'stale-uuid', { fromId, fromUuid, toId, kind, subject, runId },
        'fromUuid does not match the registry — stale sender');
    }

    // 7: recipient shape — the literal role 'coordinator', or an existing
    // registry row. Resolving the ROLE to a concrete session id happens below,
    // after runId (check 8) is known to be real. Same transient-vs-terminal
    // split as check 5, reusing the same `names`/`registry` reads rather than
    // a second round trip.
    if (toId !== 'coordinator' && !registry.some((r) => r.id === toId)) {
      if (names.includes(`${toId}.uuid`)) {
        return refuse(reply, 502, 'registry-unmeasurable', { fromId, fromUuid, toId, kind, subject, runId },
          `registry row for ${toId} is listed but unreadable — transient, not a fact about the recipient`);
      }
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId },
        `no registry row for ${toId}`);
    }

    // 8: runId, when given, must name a run that exists. One lookup, reused
    // below for the envelope's program/wave — a second `coord.run(runId)`
    // after this would be the same read twice for no reason.
    const run = runId !== null ? coord.run(runId) : null;
    if (runId !== null && run === null) {
      return refuse(reply, 404, 'unknown-run', { fromId, fromUuid, toId, kind, subject, runId },
        `no run ${runId}`);
    }

    // Resolving 'coordinator'. It is a ROLE, not a session id: the store
    // resolves it to the claimedBy of the run named in runId; with no runId,
    // to the claimedBy of the single active program. Ambiguous or absent →
    // unknown-recipient, recorded — no guessing: an agent-to-agent message
    // delivered to the wrong session is worse than one refused with a reason.
    const resolvedToId = toId === 'coordinator' ? coord.resolveCoordinator(runId) : toId;
    if (resolvedToId === null) {
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId },
        "the 'coordinator' role has no single claimed active program to resolve to");
    }

    // 9: peer-mail bounds — `runId === null` ONLY (Build 9b wave 0, D10 hole
    // 2). Run mail is bounded by its run's own lifecycle and stays
    // byte-identical (the dark pin in mail-peer-quota.test.ts). Nothing ever
    // DELETEs from mail/mail_deliveries — "bound the producer, never the
    // record" — so the cap lives here at the door or nowhere.
    //
    // Placed LAST, deliberately bending this route's cheap-before-expensive
    // rule, for two reasons: the pair and the dedupe are keyed on the
    // RESOLVED recipient — the id mail_deliveries.toId actually joins on,
    // which does not exist before check 8 and the role resolution above —
    // and a quota verdict is only ever computed for a sender attribution has
    // already proven current (checks 5.5/6): a stale-uuid request keeps
    // getting its own 403, never a 429 charged against the id it presented.
    //
    // 'duplicate' first: the most specific refusal — "your message is
    // already queued" tells the caller not to resend at all, where
    // 'peer-quota' invites a retry later.
    if (runId === null) {
      if (coord.hasOutstandingPeerDuplicate(fromId, resolvedToId, subject)) {
        return refuse(reply, 409, 'duplicate', { fromId, fromUuid, toId, kind, subject, runId },
          `an outstanding peer mail from ${fromId} to ${resolvedToId} with this subject is already queued`);
      }
      if (coord.outstandingPeerCount(fromId, resolvedToId) >= PEER_MAIL_MAX_OUTSTANDING) {
        return refuse(reply, 429, 'peer-quota', { fromId, fromUuid, toId, kind, subject, runId },
          `${PEER_MAIL_MAX_OUTSTANDING} peer mails from ${fromId} to ${resolvedToId} are already outstanding`);
      }
      if (coord.peerMailInLastHour(fromId, Date.now()) >= PEER_MAIL_HOURLY) {
        return refuse(reply, 429, 'peer-quota', { fromId, fromUuid, toId, kind, subject, runId },
          `${fromId} has sent ${PEER_MAIL_HOURLY} peer mails in the last hour`);
      }
    }

    // One tx: insert the mail row, insert the delivery row (so its own id
    // exists), render the envelope AGAINST THE DELIVERY ID (not the mail id
    // — fix-round finding 5 / D-41: `envelope.ts`'s `ack:` line is the only
    // ack instruction the recipient ever sees, and the ack route resolves
    // its `:id` param against `mail_deliveries`, a SEPARATE `AUTOINCREMENT`
    // sequence from `mail` — the two only happen to walk together while
    // every mail resolves to exactly one delivery), then land the real
    // envelope with `setDeliveryEnvelope`. `renderEnvelope` still runs
    // exactly ONCE, here, at queue time — spec:176-177's "verbatim, never
    // re-rendered"; `setDeliveryEnvelope` is the second half of the same
    // INSERT, not a second render.
    const artifactPaths = artifacts as string[];
    const { id } = tx(coord.db, () => {
      const inserted = coord.insertMail({ fromId, fromUuid, toId, runId, kind, subject, body: msgBody,
        artifacts: artifactPaths });
      const delivery = coord.queueDelivery(inserted.id, resolvedToId, '');
      const envelope = renderEnvelope({
        id: delivery.id, fromId, toId: resolvedToId, runId,
        program: run?.program ?? null, wave: run?.wave ?? null, waveOf: run?.waveOf ?? null,
        kind, subject, body: msgBody, artifacts: artifactPaths,
      });
      coord.setDeliveryEnvelope(delivery.id, envelope);
      return inserted;
    });

    // 202, not 200: the server has ACCEPTED the message, not delivered it —
    // the delivery lane is minutes away by design (MAIL_SWEEP_MS, Task 8).
    return reply.code(202).send({ ok: true, id });
  });

  /**
   * `POST /api/mail/:id/ack` — checks 1, 5 and 6 unchanged, then one more:
   * the delivery must be addressed to the ACKING session. A session acking
   * someone else's mail (or a delivery id that names no row at all) is
   * `unknown-recipient` — the same code, because from the server's side that
   * is exactly what it is: this is not a delivery to you.
   *
   * A second ack of an already-acked delivery is not an error — `markAcked`
   * is idempotent — but it is not a second ack either: `already: true`.
   */
  app.post('/api/mail/:id/ack', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;

    // Same gate, same reasoning: see the ingress route above (fix-round
    // finding 3/5) — `/api/mail/:id/ack` has no legacy caller either, and
    // (fix-round finding 3 / D-39) no unconfigured-token pass-through either.
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
    if (verdict !== 'ok') {
      const detail = verdict === 'legacy'
        ? 'no box token presented — /api/mail/:id/ack grants no legacy tolerance (that is /api/notify only)'
        : verdict === 'unconfigured'
          ? 'no box token is configured on this server — /api/mail/:id/ack fails shut on an ' +
            'unconfigured token, it does not fail open (fix-round finding 3)'
          : 'wrong box token';
      return refuse(reply, 401, 'unauthenticated', {}, detail);
    }

    const body = (req.body ?? {}) as { fromId?: unknown; fromUuid?: unknown };
    if (typeof body.fromId !== 'string' || typeof body.fromUuid !== 'string') {
      return refuse(reply, 400, 'bad-kind', {}, 'fromId/fromUuid must both be strings');
    }
    const { fromId, fromUuid } = body;

    // Same transient-vs-terminal split as the ingress route's checks 5/6
    // (fix-round finding 1 / D-37): `io.readdir` failing outright is not
    // evidence the acking session does not exist — the cost here is lower
    // (a replay just retries the ack next sweep) but a recorded, permanent
    // `unknown-sender` would be equally false.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      return refuse(reply, 502, 'registry-unmeasurable', { fromId },
        'the registry directory could not be listed — transient, not a fact about the sender');
    }
    const registry = await readRegistry(deps.io, deps.cfg);
    const sender = registry.find((r) => r.id === fromId);
    if (!sender) {
      if (names.includes(`${fromId}.uuid`)) {
        return refuse(reply, 502, 'registry-unmeasurable', { fromId },
          `registry row for ${fromId} is listed but unreadable — transient, not a fact about the sender`);
      }
      return refuse(reply, 403, 'unknown-sender', { fromId }, `no registry row for ${fromId}`);
    }
    // 5.5: same gate the ingress route carries — see its own comment.
    const senderIdentity = measuredIdentity(sender);
    if (senderIdentity === null) {
      return refuse(reply, 502, 'registry-unmeasurable', { fromId },
        `registry row for ${fromId} is listed but its identity could not be measured — ` +
          'transient, not a fact about the sender');
    }
    if (senderIdentity.uuid !== fromUuid) {
      return refuse(reply, 403, 'stale-uuid', { fromId, fromUuid },
        'fromUuid does not match the registry — stale sender');
    }

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return refuse(reply, 400, 'bad-kind', { fromId, fromUuid }, 'bad delivery id');
    }

    const delivery = coord.delivery(id);
    if (!delivery || delivery.toId !== fromId) {
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid },
        'this delivery is not addressed to you');
    }

    const landed = coord.markAcked(id, Date.now());
    return reply.code(200).send({ ok: true, already: !landed });
  });

  /**
   * `GET /api/mail?to=<id>` (fix, review findings 1/15: this route fell in
   * the seam between the two Build 7 plans, each naming the other as its
   * author — PR I's own D-9 pointed at PR J for `POST /api/runs/:id/advance`
   * and PR J's own "Interfaces assumed from PR I" contract item 6 pointed
   * back here for THIS route; neither shipped it). A session's own
   * outstanding mail — `MailStrip`'s read route, the one PR J's own plan
   * names and this build otherwise has no way to answer: the delivery lane
   * only ever WRITES the recipient's mail (`sweepMail`'s injected envelope),
   * it never lets anything READ the row back. Token-gated the same as the
   * other coordinator routes (contract item 6): unlike the ingress and ack
   * routes, this is a read with no attribution to check — the box token
   * alone is the gate.
   *
   * Default state predicate (fix, review findings 4/21): this docstring has
   * called it "outstanding mail" since it was written, but until now the
   * query underneath was `mailForRecipient` — full history, every state,
   * `queued`/`delivered`/`acked`/`rejected` alike, with no state predicate at
   * all. `wave-lifecycle.md:83` tells the coordinator "to see what is
   * outstanding" this is the call to make; a coordinator that took that
   * literally got back every delivery it had already acked and acted on too,
   * indistinguishable from new work. `outstandingMailFor` (`queued`/
   * `delivered`, plus a delivery the lane gave up retrying before anyone
   * ever acted on it — `OUTSTANDING_OR_ABANDONED_SQL`, fix, review finding
   * 2) is the definition this build already gave `MailStrip`'s own frame
   * (`store.ts`) — this route now answers with the SAME definition by
   * default, so there is exactly one meaning of "outstanding" in the tree.
   * `?all=1` opts back into the unfiltered
   * history read for a caller that genuinely wants it (a debugging session,
   * an operator inspecting `/mail`) — `mailForRecipient` is not deleted, only
   * no longer the default a doc calls "outstanding".
   *
   * Each row's `id` is the MAIL id, not the delivery id (blocking review
   * finding, re-opened D-41) — use `deliveryId` (`store.ts`'s
   * `MAIL_ROW_COLUMNS`) for `GET /api/mail/:id` and `POST /api/mail/:id/ack`
   * immediately below, both of which key on `mail_deliveries.id`. The
   * reference nudge (`renderMailNudge`, `coord/envelope.ts`) that points a
   * worker at this route tells it exactly that.
   */
  app.get('/api/mail', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'GET /api/mail')) return;
    const coord = deps.coord;

    const q = req.query as { to?: unknown; limit?: unknown; all?: unknown };
    if (typeof q.to !== 'string' || q.to.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    const all = q.all === '1' || q.all === 'true';
    const mail = all ? coord.mailForRecipient(q.to, limit) : coord.outstandingMailFor(q.to, limit);
    return reply.code(200).send({ ok: true, mail });
  });

  /**
   * `GET /api/mail/:id` (robust-mail-delivery spec §1.2) — the body channel
   * the reference nudge (`coord/envelope.ts`'s `renderMailNudge`) points a
   * worker at instead of typing the envelope into its pane. Serves the
   * STORED envelope verbatim (`coord.deliveryEnvelope`) — `renderEnvelope` is
   * not called here and must never be: spec:176-177's "verbatim, never
   * re-rendered" applies to every reader, not only the delivery lane that
   * originally queued it.
   *
   * Token-only, matching `GET /api/mail?to=`'s own convention immediately
   * above: this is a read with no attribution to check, so the box token
   * alone is the gate — there is no sender identity to verify the way the
   * ingress and ack routes do.
   *
   * A distinct path from `POST /api/mail/:id/ack` (`:id` vs `:id/ack`) —
   * Fastify's router disambiguates on the literal `/ack` suffix, so there is
   * no ordering hazard between the two route registrations.
   */
  app.get('/api/mail/:id', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'GET /api/mail/:id')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    const row = coord.deliveryEnvelope(id);
    if (!row) return reply.code(404).send({ ok: false, error: 'not-found' });
    return reply.code(200).send({ ok: true, id: row.id, toId: row.toId, state: row.state, envelope: row.envelope });
  });

  // ── runs (Task 9) ──────────────────────────────────────────────────────
  //
  // spec:192-198: "It acts through the server's HTTP API, not raw ccd… One
  // chokepoint means caps are ENFORCED, every act is RECORDED on the run, and
  // the PWA sees everything." Four routes (dispatch/close's sibling
  // `POST /api/runs/:id/advance` joins them below, closing review finding 1),
  // ZERO NEW CCD VERBS — every argv below is one of the five already granted
  // (`agent/src/whitelist.ts:310-336`): `wsAdd`/`ensure` are dispatch,
  // `wsHold` is the claim, `wsRelease` the close, `wsArchive` the one
  // explicit-abandon escape hatch.
  //
  // TOKEN-GATED (fix, review findings 3/10/27 — reversing this file's earlier
  // "UNAUTHENTICATED, deliberately" stance): these routes drive `ccd ws-add`,
  // inject `/clear` into a live worker's pane, and run `ws-release`/
  // `ws-archive` on a held workspace — strictly more dangerous fleet acts
  // than `POST /api/mail`'s own insert-a-row, which required the box token
  // all along. PR J's own "Interfaces assumed from PR I" contract item 6
  // states plainly that ALL SIX coordinator write routes are authenticated by
  // the box token; leaving three of them open while the mail pair fails shut
  // on even an UNCONFIGURED token was the asymmetry review finding 3 named:
  // "the box token authenticates a mail row; ccd ws-add, an injected /clear
  // and ws-release/ws-archive do not." The `/api/sessions/*` precedent this
  // file's comment used to cite is real but does not extend the exemption:
  // that surface predates the box token entirely and spec's operator ruling
  // (§4) is what closed the anonymous box->server ingress THIS build adds —
  // reopening three routes of it because a DIFFERENT, older surface is also
  // open is the redesign, not gating them.

  /**
   * Open a run.
   *
   * THE LEDGER IS NOT WRITTEN HERE, AND IT IS NOT READ HERE. Opening a run
   * expects the coordinator to have committed `docs/superpowers/programs/
   * <slug>.md` in the project's own repo — that is what a fresh session, and a
   * human reviewing a handoff, read to learn where the program stands
   * (`docs/superpowers/programs/TEMPLATE.md:5-9`). The server cannot verify it
   * and deliberately does not try: the ledger is prose for humans and PARSED BY
   * NOTHING (spec:93-95, spec:246-248). What it CAN do is name the path in the
   * response, so a coordinator that forgot has been told once, in the place it
   * would notice.
   *
   * The two records are joined by the program slug and neither is derived from
   * the other. If the database is lost, the ledger plus the registry plus
   * `.prhistory` are what rebuild the runs (spec:82-85, and
   * `CoordStore.reconstruct` with its drill).
   */
  app.post('/api/runs', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs')) return;
    const coord = deps.coord;

    return coordMutex.run(async () => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { program, title, project, wave, waveOf, claimedBy, sessionId } = body;
    if (typeof program !== 'string' || program.trim() === '' ||
        typeof title !== 'string' || title.trim() === '' ||
        typeof project !== 'string' || project.trim() === '' ||
        typeof claimedBy !== 'string' || claimedBy.trim() === '' ||
        typeof wave !== 'number' || !Number.isInteger(wave) || wave < 1 ||
        !(waveOf === undefined || waveOf === null || (typeof waveOf === 'number' && Number.isInteger(waveOf))) ||
        !(sessionId === undefined || (typeof sessionId === 'string' && sessionId.trim() !== ''))) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const waveOfVal = (waveOf ?? null) as number | null;

    // `openRun` refuses a second coordinator (spec:291-292) rather than
    // arbitrating — the run is NOT opened, nothing else below runs. It is
    // also now IDEMPOTENT for a retry naming the same (program, wave,
    // claimedBy) against an existing `planned` row (fix, review findings
    // 19/32) — see its own docstring.
    const opened = coord.openRun({ program, title, project, wave, waveOf: waveOfVal, claimedBy });
    if ('refused' in opened) {
      return reply.code(409).send({ ok: false, refused: opened.refused, by: opened.by });
    }

    // `sessionId` names an existing workspace (wave N>=2, reclaiming what
    // wave 1 held): place the hold immediately, and persist the id onto the
    // row (`CoordStore.setSession`, this task's own deviation D-45) so the
    // dispatch route can later read `run.sessionId` back and know to `ensure`
    // rather than `ws-add` (deviation D-1).
    if (typeof sessionId === 'string') {
      coord.setSession(opened.id, sessionId);
      const argv = CCD_ARGV.wsHold(sessionId,
        holdReason(program, wave, waveOfVal, opened.id),
        sweepDec(deps.fleetState, `run:${opened.id} open`));
      if (!verbSupported(deps.fleetState, argv)) {
        return reply.code(501).send({ ok: false, error: 'unsupported' });
      }
      const res = await deps.runCcd(argv);
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    }

    return reply.code(200).send({
      ok: true, id: opened.id, program: opened.program, state: opened.state,
      ledgerPath: `docs/superpowers/programs/${program}.md`,
    });
    });
  });

  /**
   * Dispatch a run. THE DECISION — pause/caps preconditions, the fresh-spawn
   * vs resume+/clear branch (D-1), the hold, the transition and the brief —
   * lives in `dispatch.ts`'s `dispatchRun` (architecture doc increment 4,
   * "deciding split from acting"). This route is now a union->status map:
   * parse `:id` and the body, run the decision behind the SAME `coordMutex`
   * that used to wrap the whole closure (unmoved — see that class's own
   * docstring above), and translate its typed result onto a status code and
   * body (`sendDispatchOutcome`, just above `registerCoordRoutes`).
   */
  app.post('/api/runs/:id/dispatch', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs/:id/dispatch')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    const body = (req.body ?? {}) as { brief?: unknown; items?: unknown };
    const dispatchDeps: DispatchRunDeps = { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd,
      fleetState: deps.fleetState, tmux: deps.tmux, queue: deps.queue };
    const outcome = await coordMutex.run(() => dispatchRun(dispatchDeps, id, body.brief, body.items));
    return sendDispatchOutcome(reply, outcome);
  });

  /**
   * Close a run. THE DECISION — re-measure the done claim (skipped on an
   * explicit abandon, D-49), fold `.prhistory`, the FLEET ACT, then only once
   * it succeeds the transition (D-48: the fleet act runs AHEAD of the commit,
   * so a failed `ws-release` leaves the run retryable, never wedged terminal)
   * — lives in `close.ts`'s `closeRun` (architecture doc increment 4). This
   * route is a union->status map, the same shape as dispatch's
   * (`sendCloseOutcome`, just above `registerCoordRoutes`).
   */
  app.post('/api/runs/:id/close', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs/:id/close')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    const closeDeps: CloseRunDeps = { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd,
      fleetState: deps.fleetState };
    const outcome = await coordMutex.run(() => closeRun(closeDeps, id, req.body, 'coordinator'));
    return sendCloseOutcome(reply, outcome);
  });

  /**
   * `POST /api/runs/:id/abandon` — the operator's release valve for a wedged
   * run. Same L1 decision as `POST .../close` (`close.ts`'s `closeRun`), same
   * union→status map (`sendCloseOutcome`): increment 4's split is not
   * duplicated for a second caller.
   *
   * THE REQUEST BODY IS NEVER READ (D-B4-7). `{intent:'abandon'}` is
   * constructed here, so `archive` is not a field a caller can send — "the
   * phone can abandon; the phone can never archive" is structural rather than
   * a validation a later edit can loosen. Destruction keeps its existing
   * ceremony (audit → reap, typed `expect`); a release destroys nothing, so
   * the two-tap confirm in the sheet is the whole ceremony here.
   *
   * UNGATED — deliberately NOT behind `requireMailToken`, for
   * `POST /api/coord/pause`'s own reason (D-B4-9 and spec §4.1): the box token
   * authenticates the fleet host and the coordinator holds it, so gating the
   * release valve for a run wedged BY a stuck coordinator behind that same
   * coordinator's key would leave the wedge with no door at all. The act names
   * its cause — `causedBy: 'operator'`, never `'coordinator'`.
   */
  app.post('/api/runs/:id/abandon', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    const closeDeps: CloseRunDeps = { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd,
      fleetState: deps.fleetState };
    const outcome = await coordMutex.run(() => closeRun(closeDeps, id, { intent: 'abandon' }, 'operator'));
    return sendCloseOutcome(reply, outcome);
  });

  /**
   * `POST /api/runs/:id/advance` (fix, review findings 1/15: neither Build 7
   * plan actually authored this route — PR I's own D-9 said "PR J's
   * `POST /api/runs/:id/advance` is what reaches [awaiting-review/merging];
   * PR I never does", and PR J's own "Interfaces assumed from PR I" listed
   * it as consumed-here/authored-there. Without it, `working`, `awaiting-
   * review` and `merging` were unreachable in the WHOLE tree: `dispatch`
   * only ever writes `dispatched`, `close` only ever writes `closing` then
   * `done`/`failed`, and nothing else calls `CoordStore.advance` with any
   * other target — three of `RUN_TRANSITIONS`' nine states with a table
   * entry and no writer).
   *
   * Body: `{ to: RunState; fingerprint: {branchTip, prNumber, prPhase,
   * handoffCommit} }`. SCOPED to the three states this build's own dispatch
   * and close routes structurally cannot reach — `to` must be one of
   * `working` / `awaiting-review` / `merging`; every other target (including
   * `closing`/`done`/`failed`, which stay `POST .../close`'s own job, fleet
   * acts and all) is refused as `bad-transition` here rather than
   * duplicating a fleet interaction this route does not perform. Moving
   * FORWARD toward a review claim (`to: 'awaiting-review'` or `'merging'`)
   * re-measures the fingerprint through the SAME `verifyDone` the close
   * route uses (D-6: "the server re-measures again server-side and its
   * answer is authoritative") — a claim of "this wave opened a PR" or "this
   * PR is ready to merge" is exactly the shape `verifyDone` already knows
   * how to check. Moving BACKWARD to `'working'` (a review sending work
   * back, or a merge losing a race — `RUN_TRANSITIONS`' own docstring names
   * both as "the ordinary case, not a failure") re-measures NOTHING, the
   * same D-49 reasoning close's own abandon path already uses: retreating to
   * `working` asserts no new claim of doneness for the server to check.
   */
  app.post('/api/runs/:id/advance', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs/:id/advance')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    const body = (req.body ?? {}) as
      { to?: unknown;
        fingerprint?: { branchTip?: unknown; prNumber?: unknown; prPhase?: unknown; handoffCommit?: unknown } };
    const fp = body.fingerprint;
    if (!isRunState(body.to) ||
        typeof fp !== 'object' || fp === null ||
        typeof fp.branchTip !== 'string' || typeof fp.handoffCommit !== 'string' ||
        typeof fp.prPhase !== 'string' || !(fp.prNumber === null || typeof fp.prNumber === 'number')) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const to = body.to;
    const ADVANCE_TARGETS: readonly RunState[] = ['working', 'awaiting-review', 'merging'];
    if (!ADVANCE_TARGETS.includes(to)) {
      return reply.code(409).send({ ok: false,
        reject: { code: 'bad-transition', detail: `POST /api/runs/:id/advance only reaches ${ADVANCE_TARGETS.join('/')} — ` +
          "'planned'/'dispatched' are POST .../dispatch's job and 'closing'/'done'/'failed' are POST .../close's" } });
    }
    const claim: DoneClaim = { branchTip: fp.branchTip, prNumber: fp.prNumber as number | null,
      prPhase: fp.prPhase as DoneClaim['prPhase'], handoffCommit: fp.handoffCommit };

    return coordMutex.run(async () => {
    const run = coord.run(id);
    if (!run) return reply.code(404).send({ ok: false, reject: { code: 'unknown-run' } });
    if (!(RUN_TRANSITIONS[run.state] as readonly RunState[]).includes(to)) {
      return reply.code(409).send({ ok: false, reject: { code: 'bad-transition', from: run.state, to } });
    }
    if (run.sessionId === null) {
      return reply.code(409).send({ ok: false, reject: { code: 'not-dispatched' } });
    }

    // Forward motion toward a review claim re-measures; retreating to
    // `working` does not — see this route's own docstring.
    if (to === 'awaiting-review' || to === 'merging') {
      const verdict = await verifyDone(
        { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
        { sessionId: run.sessionId, project: run.project, branch: run.branch ?? '' },
        claim,
      );
      if (!verdict.ok) {
        coord.recordRejection({ code: verdict.code, runId: id, toId: run.sessionId, detail: verdict.detail });
        queueSystemMail(coord, run, { toId: run.sessionId, runId: id, kind: 'status',
          subject: 'wave-advance-rejected', body: `${verdict.code}: ${verdict.detail}` });
        return reply.code(409).send({ ok: false, reject: { code: verdict.code, detail: verdict.detail } });
      }
    }

    const adv = coord.advance(id, to, 'coordinator');
    if (!adv.ok) return reply.code(409).send({ ok: false, reject: adv });
    return reply.code(200).send({ ok: true, run: toRunSummary(coord.run(id)!) });
    });
  });

  /**
   * `POST /api/runs/:id/items` (Build 4, spec §3.2) — the coordinator settles
   * the ledger it declared at dispatch. THE DECISION is `items.ts`'s
   * `settleItems` (architecture increment 4), which validates and maps; the
   * all-or-nothing COMMIT is `CoordStore.settleItems`, in the ring that holds
   * the database handle (D-B4-16). This route is the union->status map.
   *
   * Box-token gated like every other coordination write route. It is the
   * COORDINATOR's write, made AFTER `POST .../advance` (or `/close`)
   * re-measured the worker's claim — "which is the moment ccrc is allowed to
   * believe a worker". Nothing here re-measures anything: done-authority is a
   * fingerprint, and the fingerprint was checked one call earlier. The mail
   * bus is not taught to route on `subject` for this, deliberately (spec
   * §3.2's own argument): a tally that flips to 5/5 off an unverified worker
   * mail is a lie on the console, and the console is the product.
   *
   * Behind the SAME `coordMutex` as the other write routes, for the ordinary
   * reason — a settle and a close racing on one run would otherwise interleave
   * a ledger write with the transition that closes it.
   */
  app.post('/api/runs/:id/items', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs/:id/items')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    const outcome = await coordMutex.run(async () => settleItems({ coord }, id, req.body));
    return sendSettleItemsOutcome(reply, outcome);
  });

  /**
   * `POST /api/coord/pause` — the OPERATOR's door, and one of the TWO routes in
   * this file that are UNGATED: deliberately NOT behind `requireMailToken`
   * (D-B4-9). The other is `POST /api/runs/:id/abandon` above, added by this
   * same build and ungated for this same reason. Between them they are the
   * WHOLE unauthenticated write surface of this file — a claim `coord-pause-
   * route.test.ts`'s `UNGATED` set holds to exactly these two names, in both
   * directions.
   *
   * The box token authenticates the FLEET HOST (build7:136-143) and the
   * coordinator holds it by design. `$REG/coordinator-paused` exists precisely
   * so the coordinator CANNOT unpause itself — "no verb, no route, no way"
   * (`rundefs.ts:47-52`). A pause route gated by that token would hand the
   * coordinator its own unpause: the same key, both sides of a boundary that
   * only means anything because the two callers are different. So this rides
   * the PWA's existing unauthenticated surface, the same perimeter
   * `hold`/`release`/`archive`/`reap`/`prompt`/`ask` have always ridden
   * (`pwa/src/lib/api.ts` sends no token of any kind).
   *
   * Honesty clause, in the register of Build 7's own spec: on a single-uid box
   * any session can `rm` this marker directly. This route removes no
   * enforcement that ever existed — the skill's contract (clause 4) plus a
   * recorded chokepoint is the boundary, and it is convention with a speed
   * bump, named as exactly that.
   *
   * NO `notConfigured` ARM. Every other route here needs `deps.coord`; a pause
   * is a file on the fleet host and a box with no coordination database can
   * still be paused — answering 501 would be a lie about what the act needs.
   */
  app.post('/api/coord/pause', async (req, reply) => {
    const body = (req.body ?? {}) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') return reply.code(400).send({ ok: false, error: 'bad-request' });
    const argv = CCD_ARGV.coordPause(body.paused ? 'on' : 'off');
    if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({ ok: false, error: 'unsupported' });
    const res = await deps.runCcd(argv);
    if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    // `requested`, never `paused`: this route ran a verb, it did not READ the
    // marker. The authoritative answer is the `{type:'coord'}` frame (Task 8),
    // and the toggle settles on that — never on this response (spec §4.2).
    return reply.code(200).send({ ok: true, requested: body.paused });
  });

  /**
   * `GET /api/runs?closed=1` — cold start, and the archive of finished runs
   * (spec:225-227). Strips `prLineage` on the way out (`toRunSummary`).
   *
   * EXEMPT FROM THE SESSION GATE, AND AUTHENTICATED HERE INSTEAD — the
   * `GET /api/auth/status` pattern, for a reason no task-level review could
   * see (D-149).
   *
   * THIS ROUTE HAS TWO CALLERS, NOT ONE. `gate.ts` used to say "GET /api/runs
   * is the PWA read", and that is false one corpus over:
   * `ccd/coordinator-skill/references/wave-lifecycle.md` makes this read part of
   * the PINNED protocol, performed COOKIELESS from the fleet host —
   *   - `:34` "never parse a hold reason to learn what wave you are on. Ask
   *     `GET /api/runs` and read the run row's own `wave`" — the standing
   *     re-orientation instruction, i.e. what a coordinator does after EVERY
   *     compaction or resume in a multi-day program;
   *   - `:95`/`:386` the documented recovery for `unknown-run`;
   *   - `:375` the ledger tally.
   * Gated, an armed box answers `401 no-session` to all four, and the
   * coordinator is wedged out of the run it owns at exactly the two moments it
   * is least able to diagnose itself — orientation and recovery — with the
   * pause files untouched and nothing red anywhere. Workers are unaffected:
   * their whole surface is `GET/POST /api/mail*`, which are exempt box-token
   * lanes already.
   *
   * SOFTENING THE SKILL WOULD HAVE BEEN THE WRONG FIX. Re-measure-not-parse is
   * load-bearing there and `server/test/coordinator-skill.test.ts` pins those
   * clauses verbatim.
   *
   * EITHER CREDENTIAL, NEVER NEITHER. A live session passes (the PWA); failing
   * that, a valid box token is REQUIRED (the coordinator). So the
   * confidentiality the method-keyed table bought is unchanged — open programs
   * are still not published to anyone on the tailnet — while the credentialed
   * read is restored. This is the ONE route where either credential works, so
   * both directions are pinned by tests and by mutation.
   *
   * FLAG-AWARE, and that ordering is load-bearing: with `CCRC_AUTH` off this
   * check does not run at all, so a dark box behaves exactly as it did before
   * the slice — which is the whole promise, and which a bare
   * `requireMailToken` here would have broken for every PWA on every dark box.
   *
   * THE REFUSAL CARRIES THE SESSION'S OWN `verdict`, not this file's usual
   * bare-`detail` 401. That is deliberate: `pwa/src/lib/api.ts` raises the one
   * login screen from a 401 body naming an `AuthVerdict`, so answering the way
   * `/api/mail` does would leave a browser with a lapsed cookie silently failing
   * this call instead of being told to sign in — and would lose D-127's
   * `expired`-vs-`no-session` distinction on the way. The `detail` names the
   * token half for whoever is holding a terminal.
   */
  app.get('/api/runs', async (req, reply) => {
    // AUTHENTICATE BEFORE ANSWERING ANYTHING, INCLUDING `501 not-configured`.
    // On a gated route the hook would have refused before the handler ran, so
    // moving the check in here means keeping that order by hand: a `501` tells
    // an anonymous tailnet caller whether this box runs coordination at all,
    // which is a fact the gate never published about any other route.
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({
            ok: false,
            error: 'unauthenticated',
            verdict: session.verdict,
            detail: 'GET /api/runs takes a session cookie OR the box token ' +
              `(${MAIL_TOKEN_HEADER}); the coordinator skill reads it cookieless from the fleet host`,
          });
        }
      }
    }
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { closed?: string };
    const runs = deps.coord.runs({ includeClosed: q.closed === '1' });
    const summaries: RunSummary[] = runs.map(toRunSummary);
    return { runs: summaries };
  });

  /**
   * `GET /api/feed?limit=<n>` (Task 10, orchestrator-added scope: PR J
   * interface 5) — the durable archive behind `NotifyLog`'s in-memory ring,
   * oldest-first. Survives both a ring eviction (the ring keeps only the
   * newest 200, `notifylog.ts`'s `RING`) and a restart (a fresh `NotifyLog`
   * mints a new epoch and an empty ring; this table is untouched by either).
   * `limit` clamping is `CoordStore.feedEvents`'s own job, not repeated here
   * — same division of labour as `GET /api/runs`'s `closed` flag above.
   */
  app.get('/api/feed', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { limit?: string };
    const limit = Number(q.limit);
    return { events: deps.coord.feedEvents(limit) };
  });

  /**
   * `GET /api/lifecycle?session=<id>&limit=<n>` — one session's past tense,
   * oldest-first, plus the mirror's own holes.
   *
   * EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled for this route by D16),
   * and the reason is `GET /api/runs`'s exactly: A WORKER MUST BE ABLE TO ASK
   * "WHAT HAPPENED TO MY WORKSPACE" WITHOUT A BROWSER. It runs on the fleet
   * host with no cookie jar, and the answer it needs is about a workspace that
   * may no longer exist — `_reg_purge` (`ccd:458-556`) has already deleted
   * every per-session field by then, which is the whole reason the journal is
   * a dot-prefixed DIRECTORY. Gated, an armed box answers `401 no-session` and
   * the one surface that survives a destruction is unreachable from the box
   * that performed it.
   *
   * AUTHENTICATE BEFORE ANSWERING ANYTHING, INCLUDING `501 not-configured` —
   * on a gated route the hook would have refused before the handler ran, so
   * keeping that order here is by hand. A `501` tells an anonymous tailnet
   * caller whether this box runs coordination at all.
   *
   * EITHER CREDENTIAL, NEVER NEITHER; flag-aware, so a dark box is unchanged;
   * and the refusal carries the session's own `verdict` so the PWA's one login
   * screen keeps working and D-127's expired-vs-no-session survives. All four
   * properties are `GET /api/runs`'s and are pinned the same way.
   *
   * NAMED IN `ccd/coordinator-skill/references/wave-lifecycle.md`, because
   * `coordinator-skill.test.ts` requires every route registered in this file
   * to be named in that corpus minus its own EXEMPT set — and that parity test
   * is this program's rollout-ordering mechanism, not an inconvenience.
   */
  app.get('/api/lifecycle', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({
            ok: false,
            error: 'unauthenticated',
            verdict: session.verdict,
            detail: 'GET /api/lifecycle takes a session cookie OR the box token ' +
              `(${MAIL_TOKEN_HEADER}); a worker reads it cookieless from the fleet host`,
          });
        }
      }
    }
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { session?: string; limit?: string };
    // Clamping is `CoordStore`'s own job, not repeated here — the same division
    // of labour `GET /api/feed`'s `limit` and `GET /api/runs`'s `closed` use.
    // `Number(undefined)` is `NaN` on purpose: `lifecycleFor`'s
    // `Number.isFinite` guard answers that with the page maximum, so an absent
    // `limit` and a garbage one take the same honest path. Do not "fix" this
    // into `?? undefined`.
    const out: LifecycleQueryResult = {
      events: deps.coord.lifecycleFor({ sessionId: q.session ?? null, limit: Number(q.limit) }),
      gaps: deps.coord.lifecycleGaps(),
    };
    return out;
  });

  /**
   * `GET /api/peers?project=<slug>` or `?of=<sessionId>` — exactly one (D9).
   * Same-project discovery, the thing `ListAgents` structurally cannot do
   * (ccrc's load balancer scatters a project across accounts, and an account
   * IS a config dir).
   *
   * EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled for this route by build 9
   * D9): a fleet-host session asks "who else is on my project" COOKIELESS, and
   * the PWA asks the same question with a cookie. Either credential, never
   * neither; flag-aware, so a dark box is unchanged; auth precedes even the
   * 501; the refusal carries the session's own `verdict`. All four properties
   * are `GET /api/runs`'s and are pinned the same way.
   *
   * THE ROUTE DOES NOT FILTER ON `.archived` AT ALL, and there is no boolean
   * called `addressable`: `archivedAt` rides verbatim and decides nothing (a
   * field that is silently false must not be laundered into a filter — 4 of 8
   * archived rows were live and heartbeating when measured), `archivedStale`
   * NAMES the contradiction, and `deliverable` is decided by `peerDeliverable`
   * (L1) from the STRUCTURAL rungs only — the transient rungs are sweepMail's
   * lane state, and reporting them here would call a busy peer unreachable,
   * the exact lie R2 forbids. `'unknown'` is not `'no'`.
   *
   * `projects[]` — every project measured this pass — replaces a
   * `projectKnown` boolean: a typo'd project is this feature's central failure
   * mode (a worker reads `[]` as "I am alone" and conflicts), and the obvious
   * fix, one `io.stat` of the project dir, is built on the call the tree
   * already knows lies (D-114: the agent's stat answers EACCES as
   * `{missing:true}`).
   *
   * Each row is the L0 `PeerSummary` minus `archivedReason`, plus
   * `claimedPaths` (additive wire, one reader per field): `readRegistry`
   * parses no `.archivedreason`, so the honest choices at this seam are a new
   * per-row read this route was not designed around, a `null` that would claim
   * "never archived" beside a stamp saying otherwise (the overloaded-null the
   * seam rule forbids), or omission — omission states nothing false.
   * `claimedPaths` rides beside `intent` because both come off the same live
   * claim rows and the session line renders both (D12 ruling 3).
   */
  app.get('/api/peers', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({
            ok: false,
            error: 'unauthenticated',
            verdict: session.verdict,
            detail: 'GET /api/peers takes a session cookie OR the box token ' +
              `(${MAIL_TOKEN_HEADER}); a session reads it cookieless from the fleet host`,
          });
        }
      }
    }
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;

    const q = req.query as { project?: unknown; of?: unknown };
    const hasProject = typeof q.project === 'string' && q.project.trim() !== '';
    const hasOf = typeof q.of === 'string' && q.of.trim() !== '';
    if (hasProject === hasOf) {   // neither, or both
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'exactly one of ?project= or ?of= — a peer list is scoped or it is nothing' });
    }

    // ONE listing, reused below for the presence ladder — the same
    // fail-shut-on-unlistable idiom the mail ingress uses for this directory.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      return reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed — transient, not a fact about any peer' });
    }
    // The records are read ONCE and handed to `assembleFleet` (its own
    // `records` parameter's contract: every lane of one pass describes one
    // observation) — this route needs them itself for `uuid`, which
    // `FleetSession` does not carry.
    const recs = await readRegistry(deps.io, deps.cfg);
    const recById = new Map(recs.map((r) => [r.id, r]));
    const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux,
      undefined, undefined, undefined, undefined, undefined, undefined, recs);

    let project: string;
    let selfId: string | null = null;
    if (hasOf) {
      selfId = (q.of as string).trim();
      const own = sessions.find((s) => s.id === selfId);
      if (!own) {
        if (names.includes(`${selfId}.uuid`)) {
          return reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
            detail: `registry row for ${selfId} is listed but unreadable — transient, not absence` });
        }
        return reply.code(404).send({ ok: false, error: 'unknown-session',
          detail: `no registry row for ${selfId}` });
      }
      project = own.project;
    } else {
      project = (q.project as string).trim();
    }

    // The claim table is the intent signal that REPLACES the frozen ai-title
    // (D12 ruling 3): a branch name is written once, an intent can be written
    // every ten minutes. `expiresAt > now` is derived by this reader (D4's
    // doctrine) rather than trusted to the sweep's cadence: `claimsForProject`
    // answers the stored word, and a lapsed-but-unswept row is not live.
    const now = Date.now();
    const live = coord.claimsForProject(project).filter((c) => c.expiresAt > now);
    const byHolder = new Map<string, { intent: string; paths: string[] }>();
    for (const c of live) {
      const held = byHolder.get(c.heldBy) ?? { intent: c.intent, paths: [] };
      held.intent = c.intent;   // rows come oldest-first: the newest live intent wins
      held.paths.push(...c.paths);
      byHolder.set(c.heldBy, held);
    }

    const peers: (Omit<PeerSummary, 'archivedReason'>
      & { readonly claimedPaths: readonly string[] })[] = sessions
      .filter((s) => s.project === project && s.id !== selfId)
      .map((s) => {
        const lifecycle = s.lifecycle ?? 'unmeasurable';
        // Rungs 2-3 of the ladder (tmux verdict, pane pid) are already FOLDED
        // into `lifecycle` at this seam — `sessionLifecycle`'s own input
        // carries the pane verdict, so a dead pane with a stop stamp reads
        // `stopped`, not `session-gone` — so they enter as pass-through values
        // and the ladder decides on rungs 1 and 4, the two facts this pass
        // measured separately. Registry presence mirrors the identity triple:
        // a degraded row is `unmeasurable`, never absent (it is in the list).
        const deliverable = peerDeliverable({
          registry: s.unmeasured.length > 0 ? 'unmeasurable' : 'measured',
          tmux: 'live', panePid: 0, lifecycle,
        });
        const rec = recById.get(s.id);
        return {
          id: s.id,
          uuid: rec === undefined || rec.unmeasured.includes('uuid') ? null : rec.uuid,
          project: s.project, wrapper: s.wrapper,
          workspace: s.workspace, branch: s.branch,
          lifecycle, deliverable,
          archivedAt: s.archivedAt,
          archivedStale: archiveContradicted(s.archivedAt, lifecycle),
          held: s.held,
          intent: byHolder.get(s.id)?.intent ?? null,
          claimedPaths: byHolder.get(s.id)?.paths ?? [],
        };
      });

    const projects = [...new Set(sessions.map((s) => s.project))].sort();
    return reply.code(200).send({ ok: true, peers, projects, etiquette: PEER_ETIQUETTE });
  });
}
