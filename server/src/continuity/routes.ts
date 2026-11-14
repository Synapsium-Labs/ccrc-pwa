// The continuity routes (Overlord spec §3.3.11, §11.2, W1a). L4: they own the reply and decide nothing; the record is
// `continuityStore.ts`'s, the sender check is `coord/attribution.ts`'s `attributionVerdict`, the gate every box-token
// lane shares. This file is a lane source of its own for `box-token-census.test.ts`, as `linking/routes.ts` is.
//
// W1a registers the start report and the card door. W1's loaded-file report and witness extend this file (Table 11.1e,
// "The hook's reports").
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SHAPE_ONLY_MASKER, type SecretMasker } from '../accounts/mask.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { REG_GENERATION_SHAPE } from '../../../shared/api.js';
import { CARD_BUDGET_TOKENS } from '../../../shared/continuity-card.js';
import { CARD_REFUSALS } from '../../../shared/refusal.js';
import { cardPages, renderCard, snapshotFactsJson, trimCard } from './card.js';
import { gatherCardFacts, type CardFactsDeps } from './cardFacts.js';

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
  /** The card's registry reads (`gatherCardFacts`' ports other than the store). */
  cardRegistry: Omit<CardFactsDeps, 'coord'>;
  /** The egress masker (`deps.masker`): the card is masked once, whole, before it is hashed and paged. Absent, the shapes. */
  masker?: SecretMasker;
  /** How many conversations' partly served cards the door remembers (`CARD_MEMO_MAX` when absent; a test sets a small one). */
  cardMemoMax?: number;
}

/** The identity pair's grammar, the linking read's and the Linear proxy's. */
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
}
