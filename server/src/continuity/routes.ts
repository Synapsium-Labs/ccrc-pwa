// The continuity routes (Overlord spec §3.3.11, §11.2, W1a). L4: they own the reply and decide nothing; the record is
// `continuityStore.ts`'s, the sender check is `coord/attribution.ts`'s `attributionVerdict`, the gate every box-token
// lane shares. This file is a lane source of its own for `box-token-census.test.ts`, as `linking/routes.ts` is.
//
// W1a registers the start report, the card door and the note door (the notes piece: a note, the live notes, the handover
// note). W1's loaded-file report and witness extend this file (Table 11.1e, "The hook's reports").
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SHAPE_ONLY_MASKER, type SecretMasker } from '../accounts/mask.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { REG_GENERATION_SHAPE } from '../../../shared/api.js';
import { CARD_BUDGET_TOKENS } from '../../../shared/continuity-card.js';
import {
  isNoteKeyKind, isNoteKind, noteKeyText, type HandoverNote, type HandoverThread, type KeyFact, type NoteKey,
} from '../../../shared/continuity.js';
import { CONTINUITY_LANE, laneArmGate } from '../../../shared/lane-arm.js';
import { CARD_REFUSALS, NOTE_REFUSALS } from '../../../shared/refusal.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import { cardPages, renderCard, snapshotFactsJson, trimCard } from './card.js';
import { gatherCardFacts, type CardFactsDeps } from './cardFacts.js';
import { effectiveGeneration } from './continuityStore.js';
import { noteKeyReader } from './noteKeys.js';
import {
  handoverAsked, handoverVerdict, noteKeyFact, noteVerdict, revisedNoteFact, type NoteInput, type NoteVerdictRefusal, type RevisedFact,
} from './notes.js';

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
  /** The continuity row's gate (`laneArmGate`), unless a test opens it to drive a live walk, as the generations lane's. */
  continuityGate?: (lane: typeof CONTINUITY_LANE) => string | null;
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

/** A programme slug in a note's key: a bounded line with no control or separator character. */
const KEY_SLUG_RE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]{1,128}$/u;
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
/** A note's key as the body carries it, or null when it is not one. */
function noteKeyOf(v: unknown): NoteKey | null {
  if (typeof v !== 'object' || v === null) return null;
  const k = v as Record<string, unknown>;
  if (!isNoteKeyKind(k['kind'])) return null;
  if (k['kind'] === 'programme') return typeof k['slug'] === 'string' && KEY_SLUG_RE.test(k['slug']) ? { kind: 'programme', slug: k['slug'] } : null;
  return isPosInt(k['id']) ? { kind: k['kind'], id: k['id'] } : null;
}
/** Each note refusal's detail: what the caller can do about it. */
const NOTE_DETAIL: Readonly<Record<NoteVerdictRefusal, string>> = {
  [NOTE_REFUSALS.keyUnknown]: "the key names no live programme, open item or non-terminal run of yours, or the note it revises is not a live note of yours",
  [NOTE_REFUSALS.cap]: 'you hold the cap of live notes: close or revise one first',
  [NOTE_REFUSALS.tooLong]: 'a field is over its length cap',
  [NOTE_REFUSALS.referenceUnknown]: 'a thread names no live programme, open item or non-terminal run of yours',
  [NOTE_REFUSALS.notAsked]: 'no handover was asked: your generation is not checkpointed',
  unmeasured: 'could not check: a row it needs could not be read; try again',
};

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

  // THE NOTE DOOR (spec §3.3.2 C37, the notes piece). Three box-token lanes, each an `auth/gate.ts` EXEMPT entry: the token
  // first (never the cookie), then the path's session is the caller (`not-owner`), then the shape, then the registry's
  // attribution of `byUuid`. The door measures (the key, the revised note, the live count, the generation) and asks the
  // deciders (`notes.ts`, L1); it decides nothing itself. A session writes and reads only its own notes; the identity is the
  // session id. Everything after the attribution is synchronous, so no other request runs between a measure and its write.
  const identityOf = (req: FastifyRequest): { id: string; by: Record<string, unknown> } => {
    const { id } = req.params as { id: string };
    const by = (req.method === 'GET' ? req.query : req.body) as unknown;
    return { id, by: (typeof by === 'object' && by !== null ? by : {}) as Record<string, unknown> };
  };
  /** The caller, attributed, or the refusal already sent. */
  const caller = async (req: FastifyRequest, reply: FastifyReply): Promise<{ id: string; b: Record<string, unknown> } | null> => {
    const { id, by } = identityOf(req);
    if (by['byId'] !== id) { await refuseRoute(reply, 'not-owner', { detail: 'byId must be the session the path names: a session keeps its own notes' }); return null; }
    const uuid = by['byUuid'];
    if (!IDENTITY_RE.test(id) || typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) { await refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' }); return null; }
    return { id, b: by };
  };
  const refuseNote = (reply: FastifyReply, r: NoteVerdictRefusal, more = '') => refuseRoute(reply, r, { detail: `${NOTE_DETAIL[r]}${more}` });
  /** The identity's live generation, as the one accessor reads it (`effectiveGeneration`), or what kept it from being read. */
  const liveGenerationOf = (coord: CoordStore, id: string) => {
    const gens = coord.liveGenerations();
    if (!gens.ok) return 'unmeasured' as const;
    const row = gens.rows.find((g) => g.identity === id);
    if (row === undefined) return 'no-generation' as const;
    const live = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), (deps.continuityGate ?? laneArmGate)(CONTINUITY_LANE)).live;
    return { row, state: effectiveGeneration(row, live).state };
  };

  /**
   * `POST /api/sessions/:id/notes { byId, byUuid, key, kind, waitsOn, next, revises?, closes? }`: append one note. A
   * revision names the note it supersedes (`revises`); a close is a revision with `closes: true` and takes the closed
   * note's key and kind (its `key`, `kind`, `waitsOn` and `next` are not read). `202 { ok, id }`. Refusals: `note-key-unknown`
   * 403, `note-cap` 409, `note-too-long` 400, `unmeasured` 502 (a row it needs could not be read).
   */
  app.post('/api/sessions/:id/notes', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/notes');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = await caller(req, reply);
    if (c === null) return reply;
    const { id, b } = c;
    const closes = b['closes'] ?? false;
    const revises = b['revises'] ?? null;
    if (typeof closes !== 'boolean') return refuseRoute(reply, 'bad-request', { detail: 'closes is a boolean' });
    if (revises !== null && !isPosInt(revises)) return refuseRoute(reply, 'bad-request', { detail: 'revises is a note id' });
    if (closes && revises === null) return refuseRoute(reply, 'bad-request', { detail: 'a close names the note it closes in revises' });
    const key = closes ? null : noteKeyOf(b['key']);
    if (!closes && key === null) return refuseRoute(reply, 'bad-request', { detail: 'key is { kind: programme, slug } or { kind: item | run, id }' });
    const kind = closes ? null : b['kind'];
    if (!closes && !isNoteKind(kind)) return refuseRoute(reply, 'bad-request', { detail: 'kind is thread or caution' });
    const waitsOn = closes ? '' : b['waitsOn'];
    const next = closes ? '' : b['next'];
    if (typeof waitsOn !== 'string' || typeof next !== 'string') return refuseRoute(reply, 'bad-request', { detail: 'waitsOn and next are strings' });
    const attributed = await deps.attributeReader(id, b['byUuid'] as string);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');

    // The revised note, as read. A close takes its key and kind; when it could not be read or there is none, `revised` is
    // not `live` and the verdict refuses, so the stand-in key below is never written.
    let revised: RevisedFact = 'not-revising';
    let closed: { key: NoteKey; kind: NoteInput['kind'] } | null = null;
    if (revises !== null) {
      const r = coord.noteById(revises);
      revised = revisedNoteFact(!r.ok ? 'unmeasured' : r.note === null ? 'absent' : r.note, id);
      if (r.ok && r.note !== null) closed = { key: r.note.key, kind: r.note.kind };
    }
    const input: NoteInput = closes
      ? { key: closed?.key ?? { kind: 'run', id: revises! }, kind: closed?.kind ?? 'thread', waitsOn: '', next: '', revises, closes }
      : { key: key!, kind: kind as NoteInput['kind'], waitsOn, next, revises, closes };
    // A close's key is not read (`noteVerdict` skips it: close-needs-no-live-key), so it is not measured either.
    const keyFact: KeyFact = closes ? 'unmeasured' : noteKeyFact(noteKeyReader(coord, id)(input.key), id);
    const live = coord.liveNotes(id);
    const gen = liveGenerationOf(coord, id);
    if (gen === 'unmeasured') return refuseNote(reply, 'unmeasured', ' (the generations)');
    const verdict = noteVerdict(input, keyFact, live.ok ? live.notes.length : 'unmeasured', revised);
    if (!verdict.ok) return refuseNote(reply, verdict.refusal, ` (${noteKeyText(input.key)})`);
    const r = coord.appendNote({
      identity: id, sessionId: id, generationId: gen === 'no-generation' ? null : gen.row.id, key: input.key, kind: input.kind,
      waitsOn: input.waitsOn, next: input.next, revises, closes, at: deps.wall(),
    });
    if (!r.ok) {
      return r.kind === 'superseded' ? refuseNote(reply, NOTE_REFUSALS.keyUnknown, ': the note it revises was revised first')
        : refuseRoute(reply, 'write-failed', { detail: 'continuity_notes could not be written' });
    }
    return reply.code(202).send({ ok: true, id: r.id });
  });

  /**
   * `GET /api/sessions/:id/notes?byId&byUuid`: the caller's live notes, newest first, each with its key's fact now (`live`,
   * `gone`, `not-yours` or `unmeasured`: a note whose key is gone is reported as such, never dropped). The answer is masked
   * by the one answer hook (`MASKED_GET_ROUTES` in `server.ts` lists the route). `200 { ok, notes }`.
   */
  app.get('/api/sessions/:id/notes', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/sessions/:id/notes');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = await caller(req, reply);
    if (c === null) return reply;
    const attributed = await deps.attributeReader(c.id, c.b['byUuid'] as string);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const live = coord.liveNotes(c.id);
    if (!live.ok) return refuseRoute(reply, 'unmeasured', { detail: 'could not check: continuity_notes could not be read' });
    const read = noteKeyReader(coord, c.id);
    return reply.code(200).send({
      ok: true,
      notes: live.notes.map((n) => ({
        id: n.id, key: n.key, kind: n.kind, waitsOn: n.waitsOn, next: n.next, revises: n.revises, at: n.at,
        keyFact: noteKeyFact(read(n.key), c.id),
      })),
    });
  });

  /**
   * `POST /api/sessions/:id/handover { byId, byUuid, threads: [{ ref, waitsOn, next }], cautions, tone }`: the handover note
   * (C37), accepted only while the caller's live generation is `checkpointed` as `effectiveGeneration` reads it (otherwise
   * `note-not-asked` 409; `unmeasured` 502 when the generations could not be read). Every thread's reference must be a live
   * row of the caller's (`reference-unknown` 400; `unmeasured` 502 when one could not be read); status words are dropped
   * and counted. One row per generation: `202 { ok, generationId, dropped, fresh }`, `fresh: false` when one was stored.
   */
  app.post('/api/sessions/:id/handover', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/handover');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = await caller(req, reply);
    if (c === null) return reply;
    const { id, b } = c;
    const rawThreads = b['threads']; const cautions = b['cautions']; const tone = b['tone'];
    if (!Array.isArray(rawThreads) || !Array.isArray(cautions) || !cautions.every((x) => typeof x === 'string') || typeof tone !== 'string') {
      return refuseRoute(reply, 'bad-request', { detail: 'threads and cautions are lists, tone a string' });
    }
    const threads: HandoverThread[] = [];
    for (const t of rawThreads as unknown[]) {
      const o = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
      const ref = noteKeyOf(o['ref']);
      if (ref === null || typeof o['waitsOn'] !== 'string' || typeof o['next'] !== 'string') {
        return refuseRoute(reply, 'bad-request', { detail: 'a thread is { ref, waitsOn, next }' });
      }
      threads.push({ ref, waitsOn: o['waitsOn'], next: o['next'] });
    }
    const attributed = await deps.attributeReader(id, b['byUuid'] as string);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');

    const gen = liveGenerationOf(coord, id);
    const asked = handoverAsked(typeof gen === 'string' ? gen : gen.state);
    if (asked !== 'asked' || typeof gen === 'string') {
      return refuseNote(reply, asked === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.notAsked, asked === 'unmeasured' ? ' (the generations)' : '');
    }
    const read = noteKeyReader(coord, id);
    const note: HandoverNote = { threads, cautions: cautions as string[], tone };
    const verdict = handoverVerdict(note, threads.map((t) => noteKeyFact(read(t.ref), id)));
    if (!verdict.ok) return refuseNote(reply, verdict.refusal);
    const r = coord.putHandover({ generationId: gen.row.id, note: verdict.cleaned, dropped: verdict.dropped, at: deps.wall() });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_handovers could not be written' });
    return reply.code(202).send({ ok: true, generationId: gen.row.id, dropped: verdict.dropped, fresh: r.fresh });
  });
}
