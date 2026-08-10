import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../server.js';
import type { Bus } from '../bus.js';
import { measuredIdentity, readRegistry, readRegistryMeasured } from '../registry.js';
import { readHookState } from '../hookstate.js';
import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { sendPrompt } from '../inject/send.js';
import { tx } from './db.js';
import { toRunSummary, type CoordStore, type RunRow } from './store.js';
import { renderEnvelope } from './envelope.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from './token.js';
import { readPrHistory } from './prhistory.js';
import { verifyDone, type DoneClaim } from './fingerprint.js';
import {
  isRunState, isSendableMailKind, MAIL_ARTIFACTS_MAX, MAIL_ARTIFACT_PATH_MAX_BYTES, MAIL_BODY_MAX_BYTES,
  MAIL_SUBJECT_MAX_BYTES, RUN_TRANSITIONS, type MailKind, type MailRejectCode, type RunState,
  type RunSummary,
} from '../../../shared/api.js';

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
const HANDOFF_SHA = /^[0-9a-f]{40}$/;

/** `$REG/mail-disabled` — the SAME kill-switch `watch.ts`'s `sweepMail`
 *  already gates on (its own `MAIL_DISABLED_MARKER`), read a second time
 *  here rather than imported (fix, review finding 17): dispatch's own
 *  registry listing already covers `COORDINATOR_PAUSE_MARKER` below, and a
 *  second literal is lower-risk than an import into a file `watch.ts`
 *  itself does not depend on. Before this fix, dispatch consulted ONLY the
 *  coordinator-pause marker: an operator who `touch`ed this one to silence
 *  injection mid-debugging still got `ccd ensure` + an injected `/clear`
 *  wiping the worker's context, with the wave brief queued but held by the
 *  very kill-switch the operator raised — the worker sat in an EMPTY,
 *  `/clear`ed context for as long as the marker stood, invisible to
 *  anything short of reading the pane. */
const MAIL_DISABLED_MARKER = 'mail-disabled';

/** `$REG/coordinator-paused` — spec:199-205: "no verb, no route, no way for
 *  the coordinator to unpause itself." Deliberately not `-disabled`-suffixed
 *  like `mail-disabled`: `limits.ts:134-142` filters `<name>-disabled`
 *  markers out of `/api/accounts` as candidate wrapper names, and this is not
 *  a lane kill-switch — it must not read as one there. */
const COORDINATOR_PAUSE_MARKER = 'coordinator-paused';

/** The standing hold-reason convention (`registry.ts:26-46`, spec:120-123):
 *  DISPLAY-ONLY, never parsed back anywhere in this tree — the run row's own
 *  `program`/`wave`/`waveOf` columns are what every route and the store
 *  actually read. Shared by the open route's immediate hold, dispatch's own
 *  hold, and close's hold-reason update to the next wave, so the three
 *  places this string is built can never drift apart from one another. */
const holdReason = (program: string, wave: number, waveOf: number | null): string =>
  `program:${program} wave:${wave}${waveOf === null ? '' : `/${waveOf}`}`;

/**
 * The coordinator's OWN mail — the wave brief (dispatch) and a done-claim
 * rejection mailed back (close) — queued DIRECTLY rather than through
 * `POST /api/mail`'s ingress. The ingress exists to police attribution for a
 * message this server did not originate (spec:136-148: a box token
 * authenticates the box, `{fromId,fromUuid}` is verified against the
 * registry); a message the SERVER itself is sending has no sender session to
 * be stale about, so re-entering that gate would be checking a fact that
 * cannot fail against itself. `'coordinator'` is used as both `fromId` and
 * `fromUuid` — a fixed ROLE identity, not a registry row, the same role
 * `resolveCoordinator`'s own docstring already treats `toId:'coordinator'`
 * as. Mirrors the ingress route's own tx shape exactly (insert mail, insert
 * delivery so its own id exists, render the envelope AGAINST THE DELIVERY ID,
 * land it) — see that route's comment on `setDeliveryEnvelope` for why the
 * two ids cannot be assumed to walk together.
 */
function queueSystemMail(
  coord: CoordStore,
  run: Pick<RunRow, 'program' | 'wave' | 'waveOf'>,
  m: { toId: string; runId: number; kind: MailKind; subject: string; body: string },
): void {
  // Review finding 33: don't requeue an identical outstanding system mail.
  // The two calls in this file — `wave-brief` (dispatch) and
  // `wave-done-rejected` (close, on a re-measurement refusal) — each have
  // at most ONE outstanding instance in flight per run by construction; a
  // retry landing here again (the coordinator's own retry loop, or a few
  // taps of a PWA button) is restating a fact the recipient has already
  // been told, not a new one, and previously inserted a fresh `mail` +
  // `mail_deliveries` row — a fresh, non-collapsing push (spec:236-237) and
  // a fresh `feed_events` row — on EVERY retry, unbounded. `recordRejection`
  // (the close route's own audit log) is unaffected: this only guards the
  // MAIL queue, never the record of the refusal itself.
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
 */
export function registerCoordRoutes(
  app: FastifyInstance, deps: Deps,
  // Unused by the mail routes below; kept in the signature because Task 9's
  // run routes land in this same file and share it — a signature that grows
  // per-task would be a second copy of the token+attribution gate wiring.
  _bus: Bus,
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
   * rotates every 5s (`ccd/ccd:6425-6437`) — and an honest mistake.
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
   */
  app.get('/api/mail', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'GET /api/mail')) return;
    const coord = deps.coord;

    const q = req.query as { to?: unknown; limit?: unknown };
    if (typeof q.to !== 'string' || q.to.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    return reply.code(200).send({ ok: true, mail: coord.mailForRecipient(q.to, limit) });
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
      const argv = CCD_ARGV.wsHold(sessionId, holdReason(program, wave, waveOfVal));
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
   * Dispatch a run: pause and caps checked FIRST, then either a fresh
   * workspace (wave 1) or a resumed one with an injected `/clear` (wave N>=2,
   * deviation D-1), then the hold, then the transition, then the brief — as
   * MAIL, never injected directly (a fresh pane is `working` for its first
   * seconds, and the delivery lane's own gate is exactly the thing that knows
   * when it is not).
   */
  app.post('/api/runs/:id/dispatch', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs/:id/dispatch')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    return coordMutex.run(async () => {
    // Read again, INSIDE the mutex (fix, review findings 4/11/23/24): a
    // second `POST .../dispatch` for the SAME run now only ever starts
    // running its body after the FIRST one has fully committed (or failed)
    // — `coordMutex` above queues the whole route body, so this read is no
    // longer separated from the write that settles it by the several
    // `await`s over live fleet acts that used to let a retried request
    // read a still-`planned` row and run `ccd ensure`/`/clear` a SECOND
    // time into a worker the first request had already resumed and briefed.
    const run = coord.run(id);
    if (!run) return reply.code(404).send({ ok: false, error: 'unknown-run' });
    // Precondition (D-46; now genuinely a CLAIM rather than a stale read —
    // see the mutex comment just above): `RUN_TRANSITIONS.dispatched` has no
    // self-edge (`dispatched -> dispatched` is illegal). `advance()` below
    // still re-checks the live row and is still the only WRITER of `state`;
    // this only answers the question early enough that `ccd ensure`/
    // `/clear`/`ws-add`/`ws-hold` never fire for a transition that was
    // always going to be refused.
    if (run.state !== 'planned') {
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: run.state, to: 'dispatched' });
    }

    const body = (req.body ?? {}) as { brief?: unknown };
    if (typeof body.brief !== 'string' || body.brief.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // Fix, review finding 2: the SAME byte cap `POST /api/mail` enforces on
    // its own `body`, applied to the brief — `queueSystemMail` below is a
    // SECOND producer of `mail`/`mail_deliveries` rows that used to bypass
    // every cap the envelope's own cost model depends on (`envelope.ts`'s
    // COST paragraph: the caps exist "precisely so this paragraph's 'a few
    // hundred' [round trips] stays the true worst case"). `server.ts` builds
    // Fastify with no `bodyLimit` override, so without this the ceiling was
    // Fastify's default 1 MiB — a whole plan document pasted as a wave brief
    // types as tens of thousands of `sendPrompt` round trips, one per line,
    // inside this session's single `KeyedQueue` slot.
    if (Buffer.byteLength(body.brief, 'utf8') > MAIL_BODY_MAX_BYTES) {
      return reply.code(413).send({ ok: false, error: 'oversize', limit: MAIL_BODY_MAX_BYTES });
    }
    const brief = body.brief;

    // 1: PAUSE / KILL-SWITCH FIRST, before anything is counted or spawned. A
    // directory we cannot list is a pause we cannot rule out — fail-shut,
    // the identical idiom `watch.ts`'s mail sweep uses for its own
    // `mail-disabled` kill-switch marker, and for the same reason.
    // spec:201-205: "no verb, no route, no way for the coordinator to
    // unpause itself" — there is deliberately no
    // `POST /api/coordinator/resume` anywhere in this build.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null || names.includes(COORDINATOR_PAUSE_MARKER)) {
      return reply.code(409).send({ ok: false, refused: 'paused' });
    }
    // Fix, review finding 17: dispatch used to consult ONLY the pause
    // marker, so an operator who raised `mail-disabled` to silence
    // injection mid-debugging still got `ccd ensure` + an injected `/clear`
    // wiping the worker's context — the wave brief then queued but held by
    // the very kill-switch the operator raised, leaving the worker sitting
    // in an EMPTY, `/clear`ed context with no instructions and nothing
    // surfacing why. Refusing outright (rather than merely skipping the
    // `/clear`) means the run stays `planned` and the retry, once the
    // operator lifts the marker, gets a genuinely fresh dispatch.
    if (names.includes(MAIL_DISABLED_MARKER)) {
      return reply.code(409).send({ ok: false, refused: 'mail-disabled' });
    }

    // 2: caps. The refusal carries the numbers — a cap that refuses without
    // saying what it is is indistinguishable from a bug.
    const caps = coord.caps();
    const usage = coord.capsUsage();
    if (usage.running >= caps.maxConcurrentWorkers) {
      return reply.code(409).send({ ok: false, refused: 'cap-concurrency',
        limit: caps.maxConcurrentWorkers, running: usage.running });
    }
    if (usage.dispatchedIn24h >= caps.maxSessionsPerDay) {
      return reply.code(409).send({ ok: false, refused: 'cap-daily',
        limit: caps.maxSessionsPerDay, used: usage.dispatchedIn24h });
    }

    let sessionId: string; let workspace: string | null; let branch: string | null;
    let resumed: boolean; let clearedAt: number | null = null; let clearError: string | null = null;

    if (run.sessionId === null) {
      // 3/4: fresh spawn — wave 1. Learn the new id by REGISTRY DIFF, never
      // by parsing ccd's own echoed sentence (`workspace <id> on <wrapper> —
      // <path> (branch …)`, `ccd/ccd:1116`) — a prose line nobody wrote a
      // contract for, and this repo has already paid for one of those. Read
      // the registry before and after; exactly one new `workspace !== null`
      // row for this project is the run's session.
      // BEFORE tolerates degradation, deliberately — the question it answers
      // ("which ids already exist") is "does this still exist", and that
      // question tolerates degradation the same way `readRegistry`'s plain,
      // old signature always has (a degraded or dropped row just doesn't
      // count as pre-existing, which is always the SAFE direction to be
      // wrong in here: at worst a real id gets treated as new and trips
      // `ambiguous-dispatch` below, never silently misbound).
      const before = await readRegistry(deps.io, deps.cfg);
      const beforeIds = new Set(before.map((r) => r.id));
      const argv = CCD_ARGV.wsAdd(run.project);
      const res = await deps.runCcd(argv);
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
      // AFTER never tolerates degradation — the question here is "is this
      // NEW", the identity-by-subtraction this whole block performs, and
      // THAT one must not guess. Two drops (or, under the ladder, two
      // degraded same-project rows) could otherwise make an unrelated LIVE
      // workspace the SOLE "new" candidate below, which this route then
      // binds, holds and /clear's — a running worker's context destroyed
      // because of a read failure on a DIFFERENT session entirely. This is
      // the asymmetry to preserve on any future "simplification" of this
      // block back to a plain `readRegistry` call: BEFORE answers "does this
      // still exist" (tolerant); AFTER answers "is this new" (never
      // tolerant).
      const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
      if (!afterRead.listed ||
          afterRead.records.some((r) => r.project === run.project && measuredIdentity(r) === null)) {
        return reply.code(502).send({ ok: false, error: 'registry-unmeasurable' });
      }
      const after = afterRead.records;
      const candidates = after.filter((r) =>
        !beforeIds.has(r.id) && r.project === run.project && r.workspace !== null);
      if (candidates.length !== 1) {
        // Nothing claimed on a guess: the run stays `planned`, no hold placed
        // — the operator resolves it.
        return reply.code(409).send({ ok: false, refused: 'ambiguous-dispatch', candidates: candidates.length });
      }
      const winner = candidates[0]!;
      sessionId = winner.id; workspace = winner.workspace; branch = winner.branch;
      resumed = false;
      // Fix, review finding 7: persist the spawn onto the run row RIGHT AWAY
      // — before the hold, which can still 501/502 two steps below. Without
      // this, a workspace `ws-add` just spawned was invisible to
      // `capsUsage()` (keyed on `dispatchedAt`, still null) and to the run
      // row (`sessionId` still null) until `markDispatched` at the very end
      // — so a failed hold left an ORPHAN workspace that no row, cap or
      // route knew about, and a retry (now reading `run.sessionId === null`
      // again) spawned a SECOND one. `CoordStore.setSession` already existed
      // for the open route's own wave-N>=2 reclaim; this is the same write,
      // moved earlier on the wave-1 path.
      coord.setSession(id, sessionId);
    } else {
      // Wave N>=2: resume the SAME workspace (deviation D-1 — no ccd verb can
      // spawn fresh into an existing one), then discard the resumed context
      // with an injected `/clear` through `sendPrompt`'s full proof
      // discipline (echo verified, draft-present refused, dialog-open
      // refused) inside the session's own `KeyedQueue` slot — the exact move
      // ccd itself makes with `/compact` from `_auto_compact_check`, upgraded
      // from blind send-keys to the verified path. `/clear` rotates the
      // harness uuid (`_sync_uuid` refreshes the registry copy within one
      // supervise tick), so mail attribution re-arms itself in a genuinely
      // fresh context.
      sessionId = run.sessionId;
      const argv = CCD_ARGV.ensure(sessionId);
      const res = await deps.runCcd(argv);
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
      resumed = true;
      // The live registry, falling back to the run row — the identical
      // fallback `fingerprint.ts`'s `verifyDone` uses for the same reason
      // (see `DoneRun`'s own docstring): the live registry is the fresher
      // source, the run row is what is left when it cannot answer.
      //
      // REFUSE before the busy gate and before EITHER of workspace/branch is
      // persisted onto the run row below (`coord.markDispatched`) — registry
      // ladder, and the spot the design names as most likely to get
      // "simplified" back into a bug, so the reasoning is written at the
      // call site rather than only in the spec: an unmeasured value
      // persisted by `markDispatched` STOPS being a transient read and
      // BECOMES a fact the run row carries forever; and a degraded
      // `record.uuid` (`''`) fed to `readHookState` below looks up a
      // hookstate file that matches no real one, reading back `null` —
      // which the busy gate treats as "not busy" — silently turning a
      // FAIL-SHUT busy gate FAIL-OPEN on a session this read simply could
      // not measure, not one this read proved idle.
      //
      // Fix (blocking review finding 7): the registry read ITSELF must not
      // reopen that same fail-open door one level up. `readRegistry`'s old
      // signature collapses a whole-fleet `io.readdir` failure to `[]` —
      // exactly the shape "no such session" wears — so `record` used to come
      // back `undefined` for TWO different facts this route must tell
      // apart: the session's row is genuinely absent from a LISTABLE
      // registry (the pre-existing, tolerated "honest stale" case
      // `DoneRun`'s own docstring names, which keeps falling back to
      // `run.workspace`/`run.branch` below, same as always), and the
      // registry directory itself could not be listed at all — which proves
      // NOTHING about this session and must refuse exactly like the AFTER
      // read 30-odd lines above already does. `readRegistryMeasured` draws
      // that line explicitly: `!listed` refuses OUTRIGHT, before `record` is
      // ever computed, so `record === undefined` past this point means only
      // the first, tolerated case — never the second.
      const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
      if (!registryRead.listed) {
        return reply.code(502).send({ ok: false, error: 'registry-unmeasurable' });
      }
      const record = registryRead.records.find((r) => r.id === sessionId);
      const recordIdentity = record !== undefined ? measuredIdentity(record) : null;
      if (record !== undefined && recordIdentity === null) {
        return reply.code(502).send({ ok: false, error: 'registry-unmeasurable' });
      }
      workspace = record?.workspace ?? run.workspace;
      branch = record?.branch ?? run.branch;
      // Fix, review finding 12: refuse to `/clear` a session that is
      // OBSERVABLY mid-turn. `sendPrompt`'s `ok:true` can mean only "the
      // text left the input box" — `watch.ts`'s own mail-sweep comment and
      // `hookstate.ts`'s own docstring both say so in as many words: Claude
      // Code silently QUEUES a prompt sent mid-turn, so "the box reads
      // empty" is not "nothing is pending", and a `clearedAt` stamped from
      // `sendPrompt`'s return alone would assert a measurement the server
      // never made. This reads the SAME hookstate the mail lane's own gate
      // reads; when it is present and says the session is still working, the
      // dispatch is refused OUTRIGHT rather than risking exactly that false
      // record. An UNREADABLE/absent hookstate (no prior turn, or a session
      // whose harness has not written one yet — the ordinary shape for a
      // workspace this fresh) is not, by itself, proof of busy-ness and is
      // left to proceed, same as it always has.
      const hs = recordIdentity
        ? await readHookState(deps.io, deps.cfg.registryDir, sessionId, recordIdentity.uuid, Date.now())
        : null;
      if (hs !== null && hs.state !== 'done') {
        return reply.code(409).send({ ok: false, refused: 'worker-busy' });
      }
      const clearRes = await sendPrompt({ tmux: deps.tmux, queue: deps.queue }, sessionId, '/clear');
      // A refused `/clear` (dialog open, draft present, an ignored Enter…) is
      // not fatal to dispatch itself — the run still lands in `dispatched`
      // below, with `clearedAt` left null as the honest record that the
      // second step has not run yet; a coordinator that notices retries it
      // like any other failed step (D-1, orchestrator amendment). What
      // "recorded" and "retried" actually need — the refusal CODE, and never
      // queuing a brief into a context D-1's own "genuinely fresh" guarantee
      // was never met for — is deviation D-47 below.
      clearedAt = clearRes.ok ? Date.now() : null;
      clearError = clearRes.ok ? null : clearRes.error;
    }

    // 5: hold, behind `verbSupported` — the standing convention reason
    // string, DISPLAY-ONLY and never parsed back (`registry.ts:26-46`).
    const holdArgv = CCD_ARGV.wsHold(sessionId, holdReason(run.program, run.wave, run.waveOf));
    if (!verbSupported(deps.fleetState, holdArgv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const holdRes = await deps.runCcd(holdArgv);
    if (!holdRes.ok) return reply.code(502).send({ ok: false, stderr: holdRes.stderr });

    // 6: one call each, so the `run_events` row happens and is independently
    // attributable from the dispatch write (`markDispatched`'s own
    // docstring). A `/clear` refusal is now RECORDED (deviation D-47, found
    // in Task 9 review) — D-1's own amended text promises "the refusal
    // recorded" and nothing did: `run_events.detail` carries the typed
    // `sendPrompt` error code (`dialog-open`/`draft-present`/`verify-failed`/
    // `enter-ignored`/…) an operator (or Task 11's own record) can otherwise
    // only guess at.
    coord.markDispatched(id, sessionId, workspace, branch, resumed);
    if (clearedAt !== null) coord.setClearedAt(id, clearedAt);
    const adv = coord.advance(id, 'dispatched', 'coordinator',
      clearError !== null ? `clear-refused:${clearError}` : undefined);
    if (!adv.ok) return reply.code(409).send(adv);

    // 7: the brief, as MAIL (kind `status`, subject `wave-brief`) — never
    // injected directly, and (deviation D-47) queued ONLY when the worker's
    // context is one it can actually land in: wave 1 has never had anything
    // else written into it, and wave N>=2's `/clear` must have actually
    // VERIFIED. Queuing unconditionally, as before, meant a refused `/clear`
    // still queued a brief into the resumed, un-cleared context — the exact
    // hazard D-1's "genuinely fresh context" sentence exists to make
    // mechanical rather than hopeful. Concretely, on `enter-ignored` the
    // literal text `/clear` is left sitting in the worker's own input box
    // (`send.ts`'s own `draft` return); the delivery lane's very next sweep
    // calls `sendPrompt` with no `replaceDraft`, so it would hit
    // `draft-present` immediately and keep hitting it — parking the brief
    // `rejected('undeliverable')` after `MAIL_MAX_ATTEMPTS`, with nothing
    // surfacing WHY. `clearError` (this response's own field) is the signal
    // a coordinator needs to decide what to do next; `POST /api/mail` stays
    // open to send the brief directly once the context is actually fresh.
    const briefQueued = !resumed || clearedAt !== null;
    if (briefQueued) {
      queueSystemMail(coord, run, { toId: sessionId, runId: id, kind: 'status', subject: 'wave-brief', body: brief });
    }

    return reply.code(200).send({
      ok: true, id, sessionId, resumed, clearedAt, briefQueued,
      ...(clearError !== null ? { clearError } : {}),
    });
    });
  });

  /**
   * Close a run: re-measure the done claim (never believe it) — UNLESS the
   * operator is explicitly ABANDONING the run (`state:'failed'`, deviation
   * D-49): that is not a done-claim at all, so there is nothing to
   * re-measure, and gating an abandon on the same re-measurement a done
   * claim gets left a run whose branch tip becomes genuinely unmeasurable
   * (a deleted branch, a reaped worktree) permanently unclosable — wedging
   * `capsUsage().running` forever with no route in this PR able to free it.
   * Then fold `.prhistory` (refusing to close on an unreadable ledger — a run
   * record saying "retired no PRs" because a file could not be read is the
   * forgery `ccd/ccd:2018-2035` names), then the FLEET ACT, then — only once
   * it has actually succeeded — the transition (deviation D-48: the fleet
   * act used to run AFTER the transition committed, so a 501/502 on
   * `ws-release` wedged a run terminally `done`/`failed` with its hold never
   * released and `RUN_TRANSITIONS.done = []`/`.failed = []` giving no retry
   * at all). The fleet act is a RELEASE (deviation D-5), never an autonomous
   * archive: `FleetWatcher.archiveMerged` does that on its own clock, through
   * its own `archiveSafety` gate.
   */
  app.post('/api/runs/:id/close', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'POST /api/runs/:id/close')) return;
    const coord = deps.coord;

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    return coordMutex.run(async () => {
    // Read INSIDE the mutex (fix, review findings 4/25): a second, concurrent
    // close for the SAME run now only starts after the first has fully
    // committed (or failed) — see the dispatch route's identical comment on
    // `coordMutex` above.
    const run = coord.run(id);
    if (!run) return reply.code(404).send({ ok: false, error: 'unknown-run' });
    if (run.sessionId === null) {
      // Never dispatched: there is no worker session for `verifyDone` to
      // re-measure against and no worker to mail a rejection back to. Not one
      // of D-3's typed `MailRejectCode`s (this is not a mail refusal) or of
      // `AdvanceResult`'s (this is not a transition refusal either) — its own
      // local, honest shape, on the same `refused` convention dispatch's own
      // `ambiguous-dispatch`/`paused`/`cap-*` refusals already use.
      return reply.code(409).send({ ok: false, refused: 'not-dispatched' });
    }
    // A second precondition, read-only, checked BEFORE the fleet act (fix,
    // found in Task 9 review — D-48, the close-route half of D-46's same
    // ordering fix for dispatch): a run that cannot legally reach `closing`
    // from its CURRENT state — already `done`/`failed` (a second close), or
    // still `planned` (sessionId set at OPEN time for a wave N>=2 reclaim,
    // but never actually dispatched) — must never reach the fleet act at
    // all. Without this, moving the fleet act ahead of the transition commit
    // below would have made a double-close run `ws-release`/`ws-hold`/
    // `ws-archive` a SECOND time before discovering the transition was
    // always going to be refused — trading one wedge for another.
    // `advance()` below still re-checks the live row and is still the only
    // WRITER of `state`.
    if (!RUN_TRANSITIONS[run.state].includes('closing')) {
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: run.state, to: 'closing' });
    }

    const body = (req.body ?? {}) as
      { fingerprint?: { branchTip?: unknown; prNumber?: unknown; prPhase?: unknown; handoffCommit?: unknown };
        final?: unknown; state?: unknown; archive?: unknown };
    const fp = body.fingerprint;
    if (typeof fp !== 'object' || fp === null ||
        typeof fp.branchTip !== 'string' || typeof fp.handoffCommit !== 'string' ||
        typeof fp.prPhase !== 'string' || !(fp.prNumber === null || typeof fp.prNumber === 'number') ||
        typeof body.final !== 'boolean' ||
        (body.state !== undefined && body.state !== 'done' && body.state !== 'failed') ||
        (body.archive !== undefined && typeof body.archive !== 'boolean')) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // The claim is UNTRUSTED off the wire (`DoneClaim`'s own docstring):
    // `verifyDone` re-validates `branchTip`/`handoffCommit`/`prPhase`/
    // `prNumber` itself, on the strength of nothing this route asserts — when
    // it runs at all (see D-49, step 1 below).
    const claim: DoneClaim = { branchTip: fp.branchTip, prNumber: fp.prNumber as number | null,
      prPhase: fp.prPhase as DoneClaim['prPhase'], handoffCommit: fp.handoffCommit };
    const final = body.final;
    const state: 'done' | 'failed' = body.state === 'failed' ? 'failed' : 'done';
    const archive = body.archive === true;

    // 1: verifyDone re-measures a DONE CLAIM (spec:127-129, "never believe a
    // done claim"). `state:'failed'` is an explicit operator ABANDON, not a
    // claim of doneness — there is nothing here to re-measure against
    // (deviation D-49) — so it skips this step entirely rather than being
    // permanently refused the moment the branch/worktree it would measure
    // against stops existing. The run is NOT touched here either way
    // (`fingerprint.ts`'s own docstring); this route decides.
    if (state !== 'failed') {
      const verdict = await verifyDone(
        { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
        { sessionId: run.sessionId, project: run.project, branch: run.branch ?? '' },
        claim,
      );
      if (!verdict.ok) {
        // The run state is UNCHANGED. The rejection is recorded (spec:147-148's
        // "a rejected message is a fact about the fleet" — done-authority
        // rejections get the identical courtesy), and a `status` mail carrying
        // the code and detail is mailed back to the worker (spec:129-131).
        coord.recordRejection({ code: verdict.code, runId: id, toId: run.sessionId, detail: verdict.detail });
        queueSystemMail(coord, run, { toId: run.sessionId, runId: id, kind: 'status',
          subject: 'wave-done-rejected', body: `${verdict.code}: ${verdict.detail}` });
        return reply.code(409).send({ ok: false, error: verdict.code, detail: verdict.detail });
      }
    }

    // 2: `.prhistory` — refuse to close on an unreadable ledger; nothing
    // closes.
    const history = await readPrHistory(deps.io, deps.cfg.registryDir, run.sessionId);
    if (!history.ok) {
      return reply.code(409).send({ ok: false, refused: 'prhistory-unreadable' });
    }
    coord.foldPrLineage(id, history.entries);

    // 3: the fleet act — moved ahead of the transition commit (deviation
    // D-48). It is a RELEASE (D-5), never an autonomous archive.
    // `state:'failed'` with `archive:true` is the ONE explicit `wsArchive`
    // call in the whole coordination lane, mirroring
    // `POST /api/sessions/:id/archive` including its 501 — a claim this
    // route can now actually keep: a 501/502 here leaves `run.state`
    // untouched, exactly like that route's own precondition-first shape,
    // rather than arriving after the run was already committed terminal.
    if (state === 'failed' && archive) {
      const argv = CCD_ARGV.wsArchive(run.sessionId);
      if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({ ok: false, error: 'unsupported' });
      const res = await deps.runCcd(argv);
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    } else if (final) {
      const argv = CCD_ARGV.wsRelease(run.sessionId);
      if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({ ok: false, error: 'unsupported' });
      const res = await deps.runCcd(argv);
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    } else {
      const nextReason = holdReason(run.program, run.wave + 1, run.waveOf);
      const argv = CCD_ARGV.wsHold(run.sessionId, nextReason);
      if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({ ok: false, error: 'unsupported' });
      const res = await deps.runCcd(argv);
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    }

    // 4: the transition, the handoff commit, the outstanding-delivery
    // cancellation and the program-retirement check — as ONE transaction
    // now (fix, review finding 25: `closeRun` below replaces two
    // INDEPENDENT `advance()` calls that used to let a crash, a full-disk
    // write failure, or a SIGTERM landing between them wedge the run in
    // `closing` PERMANENTLY — see `CoordStore.closeRun`'s own docstring for
    // the full reasoning, including why it also folds in review findings
    // 8/14's delivery cancellation and D-51's program retirement). Only a
    // SHAPE-VALID handoff commit is ever passed through to be written (fix,
    // review findings 6/18): `verifyDone` is skipped entirely on an
    // abandon (`state:'failed'`, D-49), so its own 40-hex `SHA` check never
    // ran over `claim.handoffCommit` on that path — checking it again here,
    // independent of whether `verifyDone` ran, closes the gap without
    // reintroducing a re-measurement an abandon has nothing left to
    // re-measure against.
    const handoffCommit = HANDOFF_SHA.test(claim.handoffCommit) ? claim.handoffCommit : null;
    const closed = coord.closeRun({
      runId: id, finalState: state, causedBy: 'coordinator', handoffCommit, program: run.program,
    });
    if (!closed.ok) return reply.code(409).send(closed);

    return reply.code(200).send({ ok: true, id, state });
    });
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

  /** `GET /api/runs?closed=1` — cold start, and the archive of finished runs
   *  (spec:225-227). Strips `prLineage` on the way out (`toRunSummary`). */
  app.get('/api/runs', async (req, reply) => {
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
}
