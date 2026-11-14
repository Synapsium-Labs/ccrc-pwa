// The continuity routes (Overlord spec §3.3.11, §11.2, W1a). L4: they own the reply and decide nothing; the record is
// `continuityStore.ts`'s, the sender check is `coord/attribution.ts`'s `attributionVerdict`, the gate every box-token
// lane shares. This file is a lane source of its own for `box-token-census.test.ts`, as `linking/routes.ts` is.
//
// W1a registers the start report, the card door and the timer doors (the session's three, box-token lanes, and the
// operator's two, session-gated). W1's loaded-file report and witness extend this file (Table 11.1e, "The hook's reports").
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SHAPE_ONLY_MASKER, type SecretMasker } from '../accounts/mask.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { REG_GENERATION_SHAPE, shapeProgramSlug } from '../../../shared/api.js';
import { CARD_BUDGET_TOKENS } from '../../../shared/continuity-card.js';
import { timerNoteFits, type TimerView } from '../../../shared/continuity-timers.js';
import { timerCapOf } from '../../../shared/fleetRoles.js';
import { CARD_REFUSALS } from '../../../shared/refusal.js';
import { cardPages, renderCard, snapshotFactsJson, trimCard } from './card.js';
import { gatherCardFacts, sessionRoleRead, type CardFactsDeps } from './cardFacts.js';
import type { TimerRow } from './continuityStore.js';
import { timerBodyVerdict, timerCancelVerdict, timerSetVerdict, type SetFacts } from './timers.js';

export interface ContinuityRouteDeps {
  /** The coordination store, or undefined on a server without one (a test, a script): the report answers `unavailable`. */
  coord: CoordStore | undefined;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check (`attributionVerdict` over the registry). */
  attribute: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The server's wall clock (`deps.time.clock.wall`): `receivedAt`, what every reader ages a start from (§11.5). */
  wall: () => number;
  /** The card door's sender check: `attributionVerdict` over the registry, on the query's `byUuid`. */
  attributeReader: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The card's registry reads (`gatherCardFacts`' ports other than the store); the timer set door's role read reuses them. */
  cardRegistry: Omit<CardFactsDeps, 'coord'>;
  /** The setter's stamp: `incarnationOf`'s two agreeing reads of `$REG/<id>.generation`. NOT `cardRegistry.incarnation`, its
   *  single read (slug setter-stamp-is-a-double-read): the stamp keys a timer whose mismatch later cancels it, irreversibly,
   *  so a file that changes between the reads answers `unmeasured` and the set refuses `timer-unmeasured`, where the card's
   *  read only keys a declared-intent lookup that degrades to an unmeasured line. Legitimately different by safety direction. */
  setterStamp: (id: string) => Promise<{ kind: 'measured'; incarnation: string } | { kind: 'unmeasured'; reason: string }>;
  /** The egress masker (`deps.masker`): the card is masked once, whole, before it is hashed and paged. Absent, the shapes. */
  masker?: SecretMasker;
  /** How many conversations' partly served cards the door remembers (`CARD_MEMO_MAX` when absent; a test sets a small one). */
  cardMemoMax?: number;
}

/** The identity pair's grammar, the linking read's and the Linear proxy's: `SESSION_ID_RE`'s, so an id the timer doors
 *  store always fits a timer mail (review 2038 F4). */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** The hook's own id for one report: a resend carries the same one, so it is recorded once. */
const REPORT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SOURCE_MAX = 32;
const MODEL_MAX = 128;

const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

const isSafeNat = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** A card page's number in the query, and a card hash (a sha256 in hex). */
const PAGE_RE = /^[1-9][0-9]{0,5}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
/** At most this many conversations' partly served cards are remembered (the door's memo, below). */
const CARD_MEMO_MAX = 512;
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A timer's id in a path: a positive decimal integer with no leading zero. */
const TIMER_ID_RE = /^[1-9][0-9]{0,15}$/;
/** The hourly rate's window (`TIMER_SETS_PER_HOUR`). */
const RATE_WINDOW_MS = 3_600_000;
const timerIdOf = (raw: unknown): number | null =>
  typeof raw === 'string' && TIMER_ID_RE.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
/** One pending timer as the doors answer it; the one answer hook masks it on the way out (`MASKED_GET_ROUTES`). */
const timerView = (t: TimerRow): TimerView =>
  ({ id: t.id, setAt: t.setAt, dueAt: t.dueAt, note: t.note, runId: t.runId, programme: t.programme, untrusted: true });

/** The set door's bound key, measured once (slug bound-key-must-be-live): a run is the caller's own when it is among its
 *  open bindings, claimed or worked (`bindingsOf`), and a programme when it coordinates it and the plan has not ended. A
 *  binding read that fails or throws is `unmeasured`, never `not-own`: a box fault never reads as "not yours". */
function bindingOf(coord: CoordStore, id: string, bound: { runId: number | null; programme: string | null }): SetFacts['binding'] {
  try {
    if (bound.runId !== null) {
      const b = coord.bindingsOf(id);
      const claimed = b.claimant(); const worked = b.worker();
      if (!claimed.ok || !worked.ok) return 'unmeasured';
      return [...claimed.siblings, ...worked.siblings].some((r) => r.id === bound.runId) ? 'own' : 'not-own';
    }
    if (bound.programme !== null) return coord.claimsProgramme(id, bound.programme) && coord.programmeLive(bound.programme) ? 'own' : 'not-own';
    return 'none';
  } catch {
    return 'unmeasured';
  }
}

export function registerContinuityRoutes(app: FastifyInstance, deps: ContinuityRouteDeps): void {
  /**
   * `POST /api/sessions/:id/start`: the hook reports one SessionStart of a session that is not a child (its source, the
   * conversation's uuid, the model, the row's incarnation). A box-token machine lane, an `auth/gate.ts` EXEMPT entry:
   * the token first (never the cookie), then the path's session is the sender (`not-owner`), then the body's shape (cheap,
   * so a malformed report never costs a registry read), then the registry's attribution of the SENDER, `fromUuid`
   * (`stale-uuid` for a uuid the registry has not followed yet, which the hook keeps and resends), then the one writer,
   * which records `startedUuid`, the reported conversation's uuid, or `fromUuid` when the body has none. `202 { ok, id,
   * fresh }`; a resend of a recorded report is `fresh: false`.
   */
  app.post('/api/sessions/:id/start', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/start');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    if (b['fromId'] !== id) return refuseRoute(reply, 'not-owner', { detail: 'fromId must be the session the path names' });
    const uuid = b['fromUuid'];
    if (!IDENTITY_RE.test(id) || typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) {
      return refuseRoute(reply, 'bad-request', { detail: 'fromId and fromUuid' });
    }
    const { reportId, source, reportedAt } = b;
    const model = b['model'] ?? null;
    const rowIncarnation = b['rowIncarnation'] ?? null;
    if (typeof reportId !== 'string' || !REPORT_ID_RE.test(reportId)) return refuseRoute(reply, 'bad-request', { detail: 'reportId' });
    if (typeof source !== 'string' || source.length === 0 || source.length > SOURCE_MAX) return refuseRoute(reply, 'bad-request', { detail: 'source' });
    if (!isSafeNat(reportedAt)) return refuseRoute(reply, 'bad-request', { detail: 'reportedAt' });
    if (model !== null && (typeof model !== 'string' || model.length > MODEL_MAX)) return refuseRoute(reply, 'bad-request', { detail: 'model' });
    if (rowIncarnation !== null && (typeof rowIncarnation !== 'string' || !REG_GENERATION_SHAPE.test(rowIncarnation))) return refuseRoute(reply, 'bad-request', { detail: 'rowIncarnation' });
    // The reported conversation's uuid is DATA (review 1911, F4): a resend carries the uuid it was spooled under here and
    // the sender's current one in `fromUuid`, which alone is attributed. Absent or null (an older hook), it is `fromUuid`.
    const startedUuid = b['startedUuid'] ?? uuid;
    if (typeof startedUuid !== 'string' || !IDENTITY_RE.test(startedUuid)) return refuseRoute(reply, 'bad-request', { detail: 'startedUuid' });
    const attributed = await deps.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });

    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.insertStart({ sessionId: id, reportId, uuid: startedUuid, source, model, rowIncarnation, reportedAt, receivedAt: deps.wall() });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_starts could not be written' });
    return reply.code(202).send({ ok: true, id: r.id, fresh: r.fresh });
  });

  // THE MEMO OF SERVED PAGES (slug card-read-is-the-last-page): which pages of one card hash this door served to one
  // conversation. A full read is recorded only when every page of that hash was served to it; a different hash starts
  // over. Bookkeeping, never a decision's durable state: a restart forgets a card half read, so every answer says whether
  // it `recorded` the read, and `ccrc-api card` tells a caller whose last page recorded nothing to read the card again.
  // A write that failed puts the memo back, so a retry of that page records it. Bounded, the oldest conversation dropped
  // first.
  type Memo = { hash: string; pages: Set<number> };
  const served = new Map<string, Memo>();
  const remember = (key: string, memo: Memo): void => {
    served.set(key, memo);
    if (served.size > (deps.cardMemoMax ?? CARD_MEMO_MAX)) served.delete(served.keys().next().value!);
  };

  /**
   * `GET /api/sessions/:id/card?byId&byUuid&page&hash`: the caller's own card (spec §3.3.3 C38, §11.2). A box-token lane,
   * an `auth/gate.ts` EXEMPT entry: the token first (never the cookie), then the path's session is the caller
   * (`not-owner`), then the query's shape, then the registry's attribution of `byUuid` (`stale-uuid`,
   * `registry-unmeasurable` 502), then the gather, the role's renderer and the trim to `CARD_BUDGET_TOKENS`. The card hash
   * is the sha256 of the trimmed text; the snapshot (its facts, the time of rendering left out) is stored once per id.
   * `page` (default 1) is one `CARD_PAGE_CHARS` slice; a later page names its card's `hash`, and a hash that is no longer
   * the current render answers 409 `card-changed` with the current one (the caller starts again at page 1). When every page
   * of one hash has been served to the conversation, the read is recorded. The card carries text sessions wrote, so the
   * trimmed text is masked here, once and whole, before it is hashed and paged: a secret that crosses a page edge is masked
   * as one string (review 2023 F2; `secret-mask.test.ts` lists the route under INLINE, as `/api/mail/inbox`). `200 { ok,
   * hash, snapshotId, page, pages, text, recorded }`, `recorded` true when this answer recorded the full read.
   */
  app.get('/api/sessions/:id/card', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/sessions/:id/card');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = (typeof req.query === 'object' && req.query !== null ? req.query : {}) as Record<string, unknown>;
    if (q['byId'] !== id) return refuseRoute(reply, 'not-owner', { detail: 'byId must be the session the path names: a session reads its own card' });
    const uuid = q['byUuid'];
    if (!IDENTITY_RE.test(id) || typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const pageRaw = q['page'] ?? '1';
    if (typeof pageRaw !== 'string' || !PAGE_RE.test(pageRaw)) return refuseRoute(reply, 'bad-request', { detail: 'page is a positive integer' });
    const page = Number(pageRaw);
    const asked = q['hash'];
    if (asked !== undefined && (typeof asked !== 'string' || !HASH_RE.test(asked))) return refuseRoute(reply, 'bad-request', { detail: 'hash is a card hash' });
    if (page > 1 && asked === undefined) return refuseRoute(reply, 'bad-request', { detail: 'a page after the first names its card hash' });
    const attributed = await deps.attributeReader(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });

    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const at = deps.wall();
    const { facts, renderer } = await gatherCardFacts({ coord, ...deps.cardRegistry }, id, at);
    const text = (deps.masker ?? SHAPE_ONLY_MASKER).maskText(trimCard(renderCard(renderer, facts), CARD_BUDGET_TOKENS).text);
    const hash = sha256(text);
    const factsJson = snapshotFactsJson(facts);
    const snapshotId = sha256(factsJson);
    const stored = coord.insertSnapshot({ id: snapshotId, sessionId: id, at, facts: factsJson, hash });
    if (!stored.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_snapshots could not be written' });
    if (asked !== undefined && asked !== hash) return refuseRoute(reply, CARD_REFUSALS.cardChanged, { hash, detail: 'the card changed: read it again from page 1' });
    const slices = cardPages(text);
    if (page > slices.length) return refuseRoute(reply, 'bad-request', { detail: `the card has ${slices.length} page(s)` });

    const key = `${id}\n${uuid}`;
    const prior = served.get(key);
    const memo: Memo = prior !== undefined && prior.hash === hash ? prior : { hash, pages: new Set() };
    served.delete(key);
    memo.pages.add(page);
    let recorded = false;
    if (memo.pages.size === slices.length) {
      const r = coord.insertCardRead({ sessionId: id, uuid, snapshotId, hash, pages: slices.length, at });
      if (!r.ok) {
        remember(key, memo);
        return refuseRoute(reply, 'write-failed', { detail: 'continuity_card_reads could not be written' });
      }
      recorded = true;
    } else remember(key, memo);
    return reply.code(200).send({ ok: true, hash, snapshotId, page, pages: slices.length, text: slices[page - 1], recorded });
  });

  /**
   * `POST /api/timers`: a session sets itself a timer (spec §3.3.12 C61, C64; Table 11.1e). A box-token lane, an
   * `auth/gate.ts` EXEMPT entry, the caller's own identity only: it takes no target. The token first; then the body's
   * shape (`bad-request`) and the note and duration (`timerBodyVerdict`, the egress masker deciding `timer-masked`), before
   * any read; then the registry's attribution of `fromUuid`; then the facts, each read once: the setter's stamp (the double
   * read), the bound run or programme (`bindingOf`), the role (`sessionRoleRead`, the card's) and its cap, and, in ONE
   * synchronous segment with the verdict and the write, the pending count and the hourly rate, so two concurrent sets
   * cannot both pass the cap or the rate. `201 { ok, id, dueAt }`, `dueAt` the server's clock plus the duration.
   */
  app.post('/api/timers', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/timers');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const b = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const { fromId, fromUuid } = b;
    if (typeof fromId !== 'string' || !IDENTITY_RE.test(fromId) || typeof fromUuid !== 'string' || !IDENTITY_RE.test(fromUuid)) {
      return refuseRoute(reply, 'bad-request', { detail: 'fromId and fromUuid' });
    }
    const runId = b['runId'] ?? null;
    if (runId !== null && !(typeof runId === 'number' && Number.isSafeInteger(runId) && runId > 0)) return refuseRoute(reply, 'bad-request', { detail: 'runId is a run id' });
    const programme = b['programme'] ?? null;
    if (programme !== null) {
      const shaped = typeof programme === 'string' ? shapeProgramSlug(programme) : null;
      if (shaped === null || !shaped.ok || shaped.slug !== programme) return refuseRoute(reply, 'bad-request', { detail: 'programme is a programme slug' });
    }
    if (runId !== null && programme !== null) return refuseRoute(reply, 'bad-request', { detail: 'a timer binds a run or a programme, not both' });
    // The masker reads a note only within its bound (`timerNoteFits`): one that is not is refused too long by the verdict.
    const note = b['note'];
    const body = timerBodyVerdict({
      durationMs: b['durationMs'], note, masked: timerNoteFits(note) && (deps.masker ?? SHAPE_ONLY_MASKER).maskText(note) !== note,
    });
    if (!body.ok) return refuseRoute(reply, body.refusal);
    const attributed = await deps.attribute(fromId, fromUuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });

    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    let stamp: Awaited<ReturnType<ContinuityRouteDeps['setterStamp']>>;
    try { stamp = await deps.setterStamp(fromId); } catch { stamp = { kind: 'unmeasured', reason: 'unreadable' }; }
    const binding = bindingOf(coord, fromId, { runId: runId as number | null, programme: programme as string | null });
    const { role } = await sessionRoleRead({ coord, ...deps.cardRegistry }, fromId);
    // From here to the write, nothing awaits.
    const now = deps.wall();
    const pending = coord.pendingTimersOf(fromId);
    let setsLastHour: number;
    try { setsLastHour = coord.setsSince(fromId, now - RATE_WINDOW_MS); } catch { return refuseRoute(reply, 'timer-unmeasured', { detail: 'the sets of the last hour could not be read' }); }
    if (!pending.ok) return refuseRoute(reply, 'timer-unmeasured', { detail: pending.detail });
    const verdict = timerSetVerdict({
      incarnation: stamp.kind === 'measured' ? { kind: 'measured', v: stamp.incarnation } : { kind: 'unmeasured' },
      binding, pending: pending.rows.length, cap: timerCapOf(role), setsLastHour,
    });
    if (!verdict.ok) return refuseRoute(reply, verdict.refusal);
    if (stamp.kind !== 'measured') return refuseRoute(reply, 'timer-unmeasured');
    const dueAt = now + body.durationMs;
    const r = coord.insertTimer({
      setter: fromId, setterIncarnation: stamp.incarnation, setById: fromId, setByUuid: fromUuid, role, note: body.note,
      runId: runId as number | null, programme: programme as string | null, setAt: now, dueAt,
    });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_timers could not be written' });
    return reply.code(201).send({ ok: true, id: r.id, dueAt });
  });

  /**
   * `GET /api/timers?byId&byUuid`: a session reads its own pending timers. A box-token lane, an `auth/gate.ts` EXEMPT entry:
   * the token, the query's shape, the registry's attribution of `byUuid`, then the caller's pending timers, each note
   * marked untrusted, masked by the one answer hook. `200 { ok, timers }`; a read that failed is `timer-unmeasured`.
   */
  app.get('/api/timers', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/timers');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const q = (typeof req.query === 'object' && req.query !== null ? req.query : {}) as Record<string, unknown>;
    const { byId, byUuid } = q;
    if (typeof byId !== 'string' || !IDENTITY_RE.test(byId) || typeof byUuid !== 'string' || !IDENTITY_RE.test(byUuid)) {
      return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    }
    const attributed = await deps.attributeReader(byId, byUuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.pendingTimersOf(byId);
    if (!r.ok) return refuseRoute(reply, 'timer-unmeasured', { detail: r.detail });
    return reply.code(200).send({ ok: true, timers: r.rows.map(timerView) });
  });

  /**
   * `POST /api/timers/:id/cancel`: a session cancels one of its own pending timers. A box-token lane, an `auth/gate.ts`
   * EXEMPT entry: the token, the path's and the body's shape, the registry's attribution, then the row by its id and
   * `timerCancelVerdict` (an id that names no row answers `timer-not-yours`, as another identity's does: no oracle), then
   * the one writer, `cancelTimer` by `setter-cancel` with reason `setter`. A row the lane moved between the read and the
   * write answers `timer-not-pending`. `200 { ok, id }`.
   */
  app.post('/api/timers/:id/cancel', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/timers/:id/cancel');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const id = timerIdOf((req.params as { id: string }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'the path names a timer id' });
    const b = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const { fromId, fromUuid } = b;
    if (typeof fromId !== 'string' || !IDENTITY_RE.test(fromId) || typeof fromUuid !== 'string' || !IDENTITY_RE.test(fromUuid)) {
      return refuseRoute(reply, 'bad-request', { detail: 'fromId and fromUuid' });
    }
    const attributed = await deps.attribute(fromId, fromUuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const t = coord.timerById(id);
    if (!t.ok) return refuseRoute(reply, 'timer-unmeasured', { detail: t.detail });
    const verdict = timerCancelVerdict(t.row, fromId);
    if (verdict !== 'ok') return refuseRoute(reply, verdict);
    if (!coord.cancelTimer(id, 'setter-cancel', 'setter', deps.wall()).changed) return refuseRoute(reply, 'timer-not-pending');
    return reply.code(200).send({ ok: true, id });
  });

  // THE OPERATOR'S DOORS (Task 6): session-gated, no box token, and not in EXEMPT, so armed they sit behind the auth gate
  // like every PWA-surface write. `box-token-census.test.ts`'s `CONTINUITY_SESSION_DOORS` names each, both directions.

  /**
   * `GET /api/sessions/:id/timers`: the operator reads one session's pending timers, each note marked untrusted for the
   * console to render as data, masked by the one answer hook. In W1 it adds the Overlord's timers for the session the
   * designation binds; in W1a there are none. `200 { ok, timers }`.
   */
  app.get('/api/sessions/:id/timers', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!IDENTITY_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'the path names a session id' });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.pendingTimersOf(id);
    if (!r.ok) return refuseRoute(reply, 'timer-unmeasured', { detail: r.detail });
    return reply.code(200).send({ ok: true, timers: r.rows.map(timerView) });
  });

  /**
   * `POST /api/sessions/:id/timers/:timerId/cancel`: the operator cancels one of a session's pending timers. The timer must
   * be that session's (`timer-not-yours`) and pending (`timer-not-pending`), then `cancelTimer` by `operator-cancel` with
   * reason `operator`. `200 { ok, id }`.
   */
  app.post('/api/sessions/:id/timers/:timerId/cancel', async (req, reply) => {
    const p = req.params as { id: string; timerId: string };
    const timerId = timerIdOf(p.timerId);
    if (!IDENTITY_RE.test(p.id) || timerId === null) return refuseRoute(reply, 'bad-request', { detail: 'the path names a session and a timer id' });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const t = coord.timerById(timerId);
    if (!t.ok) return refuseRoute(reply, 'timer-unmeasured', { detail: t.detail });
    const verdict = timerCancelVerdict(t.row, p.id);
    if (verdict !== 'ok') return refuseRoute(reply, verdict);
    if (!coord.cancelTimer(timerId, 'operator-cancel', 'operator', deps.wall()).changed) return refuseRoute(reply, 'timer-not-pending');
    return reply.code(200).send({ ok: true, id: timerId });
  });
}
