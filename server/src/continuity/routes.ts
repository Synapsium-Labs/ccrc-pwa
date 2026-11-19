// The continuity routes (Overlord spec §3.3.11, §11.2, W1a). L4: they own the reply and decide nothing; the record is
// `continuityStore.ts`'s, the sender check is `coord/attribution.ts`'s `attributionVerdict`, the gate every box-token
// lane shares. This file is a lane source of its own for `box-token-census.test.ts`, as `linking/routes.ts` is.
//
// W1a registers the start report, the card door, the note door (the notes piece: a note, the live notes, the handover
// note), the timer doors (the session's three, box-token lanes, and the operator's two, session-gated) and the probe door (the
// probes piece: a session's open round, and its answers). W1's loaded-file report and witness extend this file (Table 11.1e,
// "The hook's reports"), and W1's renewal readings add the daily backstop's two operator doors, beside the timer doors.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SHAPE_ONLY_MASKER, type SecretMasker } from '../accounts/mask.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { REG_GENERATION_SHAPE, shapeProgramSlug } from '../../../shared/api.js';
import { CARD_BUDGET_TOKENS, isAnchorForm, type AnchorForm, type Fact } from '../../../shared/continuity-card.js';
import {
  PROBE_ROUND_MAX, RENEWAL_MODES, RENEWAL_MODE_DEFAULT, isNoteKeyKind, isNoteKind, isRenewalMode, noteKeyText, type ContinuityReadDoor,
  type HandoverNote, type HandoverThread, type KeyFact, type NoteKey, type RenewalModeView,
} from '../../../shared/continuity.js';
import { timerNoteFits, type TimerView } from '../../../shared/continuity-timers.js';
import { BACKSTOP_ZONE_MAX, isBackstopHour, isBackstopZone, type BackstopRead } from '../../../shared/renewal-readings.js';
import { timerCapOf } from '../../../shared/fleetRoles.js';
import { ANCHOR_SLOT_LANE, CONTINUITY_LANE, laneArmGate } from '../../../shared/lane-arm.js';
import { utf8Bytes } from '../../../shared/utf8.js';
import { CARD_REFUSALS, NOTE_REFUSALS, PROBE_REFUSALS, START_LOADS_REFUSALS } from '../../../shared/refusal.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import { anchorAnswer, anchorGeneration, renderAnchor, type AnchorGenRow, type AnchorStart } from './anchor.js';
import { cardPages, renderCard, snapshotFactsJson, trimCard } from './card.js';
import { gatherCardFacts, sessionRoleRead, type CardFactsDeps } from './cardFacts.js';
import {
  RENEW_REQUESTS_CURSOR, effectiveGeneration, newestMintedStartOf, sessionLiveGeneration, startByNonce, type TimerRow,
} from './continuityStore.js';
import { renewDoorVerdict, renewalModeOf, type RenewDoorFacts } from './renewNow.js';
import type { NoticeSink } from '../notice.js';
import { designationReadOf, liveGenerationOf } from './liveGeneration.js';
import { noteKeyReader, type NoteKeysMessages } from './noteKeys.js';
import { PROBE_ANSWER_MAX_CHARS, bookOf, gradeAnswers, maskedQuestion, probePages, type LastRead } from './probeDoor.js';
import { roundVerdict } from './probes.js';
import { REPORT_ID_RE, startLoadsOf } from './startLoads.js';
import {
  NOTE_LIST_LIMIT, handoverAsked, handoverVerdict, noteKeyFact, noteListBytes, notesPage, noteVerdict, revisedNoteFact, type NoteInput,
  type NoteVerdictRefusal, type RevisedFact,
} from './notes.js';
import { timerBodyVerdict, timerCancelVerdict, timerSetVerdict, type SetFacts } from './timers.js';
import { identityOf as generationIdentityOf } from '../roleOf.js';
import type { Entropy } from '../time/ports.js';
import { NONCE_SHA256_SHAPE, claimWhyText } from '../../../shared/continuity-door.js';
import { actKeyClaimVerdict } from './actKey.js';
import { actKeyByNonce, issueActKey, noteRefusedClaim } from './actKeyStore.js';
import type { GateClaim, GateRun } from '../coord/overlordGateRun.js';

export interface ContinuityRouteDeps {
  /** The coordination store, or undefined on a server without one (a test, a script): the report answers `unavailable`. */
  coord: CoordStore | undefined;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check (`attributionVerdict` over the registry). */
  attribute: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The server's wall clock (`deps.time.clock.wall`): `receivedAt`, what every reader ages a start from (§11.5). */
  wall: () => number;
  /** The server's entropy (`deps.time.entropy`): the act key the claim door mints, 32 bytes as hex. Absent on a server built
   *  without one (a test of another door): the claim door answers `unavailable`, as for an absent store. */
  entropy?: Pick<Entropy, 'hex'>;
  /** The timer read's sender check: `attributionVerdict` over the registry, on the query's `byUuid`. */
  attributeReader: (id: string, uuid: string) => Promise<AttributionRead>;
  /** THE ONE GATE (Overlord W1 gates B, §11.2; `coord/overlordGateRun.ts`): the six start doors and the card's recording page
   *  ask it with their own row's key, after their token and shape checks and before any store access, and stop on `refused`.
   *  It runs the same attribution the doors ran before; a session that is not the Overlord is answered `hook` and served as
   *  before. Absent (a server built without it, a test of another door): every start door answers `unavailable`, as for an
   *  absent store (slug gate-dep-optional-fails-closed). */
  gate?: (req: FastifyRequest, reply: FastifyReply, key: string, claim: GateClaim) => Promise<GateRun>;
  /** The card's registry reads (`gatherCardFacts`' ports other than the store); the timer set door's role read reuses them. */
  cardRegistry: Omit<CardFactsDeps, 'coord'>;
  /** The private store's text-free message read, for a `miss` note's key (`NoteKeysMessages`), resolved per request. Absent, or
   *  null while the store is not open: a `message` key then reads `unmeasured` and the door refuses `unmeasured`. */
  operatorModel?: () => NoteKeysMessages | null | undefined;
  /** The setter's stamp: `incarnationOf`'s two agreeing reads of `$REG/<id>.generation`. NOT `cardRegistry.incarnation`, its
   *  single read (slug setter-stamp-is-a-double-read): the stamp keys a timer whose mismatch later cancels it, irreversibly,
   *  so a file that changes between the reads answers `unmeasured` and the set refuses `timer-unmeasured`, where the card's
   *  read only keys a declared-intent lookup that degrades to an unmeasured line. Legitimately different by safety direction. */
  setterStamp: (id: string) => Promise<{ kind: 'measured'; incarnation: string } | { kind: 'unmeasured'; reason: string }>;
  /** The egress masker (`deps.masker`): the card is masked once, whole, before it is hashed and paged. Absent, the shapes. */
  masker?: SecretMasker;
  /** How many conversations' partly served cards the door remembers (`CARD_MEMO_MAX` when absent; a test sets a small one). */
  cardMemoMax?: number;
  /** The continuity row's gate (`laneArmGate`), unless a test opens it to drive a live walk, as the generations lane's. */
  continuityGate?: (lane: typeof CONTINUITY_LANE) => string | null;
  /** Who the operator's doors record as the actor: the signed-in device, or `flag-off` while sign-in is dark. Absent: `flag-off`. */
  operatorActor?: (req: FastifyRequest) => string;
  /** The feed's notice sink (`noticeSink`): a Settings change is a record-only row naming the actor. Absent: no row. */
  notice?: NoticeSink;
}

/** The identity pair's grammar, the linking read's and the Linear proxy's: `SESSION_ID_RE`'s, so an id the timer doors
 *  store always fits a timer mail (review 2038 F4). */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;
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
/** The page `part=anchor` asks for: one no older server serves (its pages start at 1), so it refuses the anchor's read
 *  before it reads, stores or records anything (fix round 1, F1). */
const ANCHOR_PAGE = '0';
/** At most this many conversations' partly served cards are remembered (the door's memo, below). */
const CARD_MEMO_MAX = 512;
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
/** A note's key as the body carries it, or null when it is not one. */
function noteKeyOf(v: unknown): NoteKey | null {
  if (typeof v !== 'object' || v === null) return null;
  const k = v as Record<string, unknown>;
  if (!isNoteKeyKind(k['kind'])) return null;
  if (k['kind'] === 'programme') {
    // The one programme slug grammar (`shapeProgramSlug`), held exactly: a slug it would trim is not this slug.
    const shaped = typeof k['slug'] === 'string' ? shapeProgramSlug(k['slug']) : null;
    return shaped !== null && shaped.ok && shaped.slug === k['slug'] ? { kind: 'programme', slug: shaped.slug } : null;
  }
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
  'bad-request': 'a thread names its next act (next is not blank), a miss is keyed to a message and only a miss is, and a close names the note it closes in revises',
};
/** A round's id, as the lane mints it, and a question's id inside its round. */
const ROUND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const QID_RE = /^p[1-9]$/;
/** A list query's positive whole number (`before`, `limit`). */
const QUERY_NAT_RE = /^[1-9][0-9]{0,15}$/;
/** The handover door's body limit: a handover at every field cap, in four-byte or escaped text, parses, so the decider
 *  refuses it `note-too-long` (`HANDOVER_MAX_BYTES`) rather than the parser answering 413 (review 2039, F3). The box
 *  token is checked before the body is read. */
const HANDOVER_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
/** A timer's id in a path: a positive decimal integer with no leading zero. */
const TIMER_ID_RE = /^[1-9][0-9]{0,15}$/;
/** The hourly rate's window (`TIMER_SETS_PER_HOUR`). */
const RATE_WINDOW_MS = 3_600_000;
const timerIdOf = (raw: unknown): number | null =>
  typeof raw === 'string' && TIMER_ID_RE.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
/** One pending timer as the doors answer it; the one answer hook masks it on the way out (`MASKED_GET_ROUTES`). */
const timerView = (t: TimerRow): TimerView =>
  ({ id: t.id, setAt: t.setAt, dueAt: t.dueAt, note: t.note, runId: t.runId, programme: t.programme, untrusted: true });

/** The cancel's one write, by `actor` with `reason`, in the timer doors' failure contract (review 2052 F1): a row the lane
 *  moved between the read and the write is `timer-not-pending`, and a statement that throws is `write-failed` (503), never
 *  a 500 out of the handler. */
function cancelOf(coord: CoordStore, id: number, actor: 'setter-cancel' | 'operator-cancel', reason: 'setter' | 'operator', at: number):
  'ok' | 'timer-not-pending' | 'write-failed' {
  try {
    return coord.cancelTimer(id, actor, reason, at).changed ? 'ok' : 'timer-not-pending';
  } catch {
    return 'write-failed';
  }
}

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
  const gate = deps.gate ?? (async (_req: FastifyRequest, reply: FastifyReply): Promise<GateRun> => {
    await refuseRoute(reply, 'unavailable', { detail: 'this server has no Overlord gate' });
    return { kind: 'refused' };
  });
  // THE MEMO OF SERVED PAGES (slug card-read-is-the-last-page): which pages of one card hash this door served to one
  // conversation. A full read is recorded only when every page of that hash was served to it; a different hash starts
  // over. Bookkeeping, never a decision's durable state: a restart forgets a card half read, so every answer says whether
  // it `recorded` the read, and `ccrc-api card` tells a caller whose last page recorded nothing to read the card again.
  // A write that failed puts the memo back, so a retry of that page records it. Bounded, the oldest conversation dropped
  // first. A new start of a conversation forgets its partly served card (the start door, below; review 2027 N4): a resumed
  // conversation keeps its uuid, and pages served to its previous generation are no read of the new one's card. So each memo
  // carries the start it belongs to (`starts`, a stamp per conversation that every fresh start raises; review 2087 F3), and a
  // page whose request began before the conversation's latest start is served but joins no memo: a request of the old
  // generation still in flight when the new one starts cannot complete the new one's read. A stamp dropped by the bound
  // reads as no start, which only ever starts a memo over (a read asked again), never completes one.
  type Memo = { hash: string; start: number; pages: Set<number> };
  const memoKey = (sessionId: string, uuid: string): string => `${sessionId}\n${uuid}`;
  const served = new Map<string, Memo>();
  const remember = (key: string, memo: Memo): void => {
    served.set(key, memo);
    if (served.size > (deps.cardMemoMax ?? CARD_MEMO_MAX)) served.delete(served.keys().next().value!);
  };
  const starts = new Map<string, number>();
  let startSeq = 0;
  const startOf = (key: string): number => starts.get(key) ?? 0;
  const noteStart = (key: string): void => {
    starts.delete(key);
    starts.set(key, startSeq += 1);
    if (starts.size > (deps.cardMemoMax ?? CARD_MEMO_MAX)) starts.delete(starts.keys().next().value!);
    served.delete(key);
  };

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
    // The launch nonce's sha256 the spawn bound (the door process, Overlord W1): absent or null (an older hook, a start no spawn
    // bound) is stored null and binds no nonce; any other value must be the shape.
    const doorNonceSha256 = b['doorNonceSha256'] ?? null;
    if (doorNonceSha256 !== null && (typeof doorNonceSha256 !== 'string' || !NONCE_SHA256_SHAPE.test(doorNonceSha256))) {
      return refuseRoute(reply, 'bad-request', { detail: 'doorNonceSha256' });
    }
    const attributed = await deps.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });

    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.insertStart({ sessionId: id, reportId, uuid: startedUuid, source, model, rowIncarnation, reportedAt, receivedAt: deps.wall(),
      doorNonceSha256 });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_starts could not be written' });
    if (r.fresh) noteStart(memoKey(id, startedUuid));
    return reply.code(202).send({ ok: true, id: r.id, fresh: r.fresh });
  });

  /**
   * `POST /api/sessions/:id/start/loads` (Overlord W1 sandbox, Task 5; spec §3.6 H4, Table 11.1e): the hook reports what a
   * `startup` or `resume` start of a surfaced session loaded. A box-token machine lane, an `auth/gate.ts` EXEMPT entry, as
   * the start report is: the token first, then the path's session is the sender (`not-owner`), then `startLoadsOf`, the
   * body's one narrowing (`bad-request` naming the field), then the registry's attribution of `fromUuid`, then the one
   * writer, which finds the start the `reportId` names for that session (`unknown-start`, 404, which the hook keeps and
   * resends) and keeps the first body; a resend of the same body, or a different one (which sets `conflicted`), answers
   * `fresh: false`. `202 { ok, startId, fresh }`. The door decides nothing: no verdict is stored (PR B computes it on read).
   */
  app.post('/api/sessions/:id/start/loads', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/start/loads');
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
    const v = startLoadsOf(b);
    if (!v.ok) return refuseRoute(reply, 'bad-request', { detail: v.field });
    const attributed = await deps.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.insertStartLoads(id, v.report, deps.wall());
    if (!r.ok && r.kind === 'unknown-start') {
      return refuseRoute(reply, START_LOADS_REFUSALS.unknownStart, { detail: 'no start of this session carries that reportId yet' });
    }
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_start_loads could not be written' });
    return reply.code(202).send({ ok: true, startId: r.startId, fresh: r.fresh });
  });

  /**
   * `POST /api/sessions/:id/act-key` (Overlord W1 door process A1; spec §3.3.11 H12 "The fence", §3.6 H1): the door process's
   * one claim. A box-token machine lane, an `auth/gate.ts` EXEMPT entry, as the start report is: the token first, then the
   * path's session is the sender (`not-owner`), then the body's shape (`fromUuid`, and `nonce`, 64 lowercase hex: 400
   * `bad-request` with no echo of the value), then the registry's attribution of `fromUuid`, then the facts, each read once in
   * one synchronous stretch (`actKeyByNonce`, `newestMintedStartOf`, `startByNonce`), then `actKeyClaimVerdict`. On `issue` it mints
   * the key (`entropy.hex(32)`), stores only its sha256 through `issueActKey`, and answers `200 { ok, generation, key }` only on
   * `{ ok: true }`: a refused insert (two claims racing) answers `stale-generation` (`nonce-spent`), never a key. A refusal is
   * 409 `stale-generation` or `renewing`, or 502 `unmeasured`, its why in `detail`; a spent nonce raises `claimsRefused` on the row only when its generation is this session's. THE
   * NONCE AND THE KEY ARE SECRETS: no line this door logs names either, only the session, the start and the why.
   */
  app.post('/api/sessions/:id/act-key', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/act-key');
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
    const nonce = b['nonce'];
    if (typeof nonce !== 'string' || !NONCE_SHA256_SHAPE.test(nonce)) return refuseRoute(reply, 'bad-request', { detail: 'nonce: 64 lowercase hex' });
    const attributed = await deps.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const coord = deps.coord;
    const entropy = deps.entropy;
    if (coord === undefined || entropy === undefined) return refuseRoute(reply, 'unavailable');
    const presented = sha256(nonce);
    const v = actKeyClaimVerdict({
      presented, spent: actKeyByNonce(coord.db, presented), newest: newestMintedStartOf(coord.db, id), matching: startByNonce(coord.db, id, presented),
    });
    const refused = (error: 'renewing' | 'stale-generation' | 'unmeasured', why: Parameters<typeof claimWhyText>[0]): FastifyReply => {
      if (why === 'nonce-spent') noteRefusedClaim(coord.db, presented, id, deps.wall());
      console.warn(`ccrc-server: act-key: the claim of ${id} refused ${error} (${why})`);
      return refuseRoute(reply, error, { detail: `${why}: ${claimWhyText(why)}` });
    };
    if (v.kind === 'refuse') return refused(v.error, v.why);
    const key = entropy.hex(32);
    const issued = issueActKey(coord.db, { generationId: v.generationId, nonceSha256: presented, keySha256: sha256(key), issuedAt: deps.wall() });
    if (!issued.ok) return issued.error === 'refused' ? refused('stale-generation', 'nonce-spent')
      : refuseRoute(reply, 'write-failed', { detail: 'continuity_act_keys could not be written' });
    console.warn(`ccrc-server: act-key: issued to ${id} for generation ${v.n}`);
    return reply.code(200).send({ ok: true, generation: v.n, key });
  });

  /** A card or notes read served: the probe door marks an answer after it `open` (closed-book, Review Focus 3). A stamp that
   *  could not be written leaves the answer `unmeasured`, which claims nothing, so the read is served and the miss logged. */
  const stampRead = (coord: CoordStore, id: string, door: ContinuityReadDoor): void => {
    if (!coord.stampContinuityRead(id, door, deps.wall()).ok) console.warn(`ccrc-server: continuity: the ${door} read of ${id} could not be stamped`);
  };

  // THE ANCHOR'S SHADOW RECORD (the anchor piece): while the `anchor-slot` row is shadow the door renders each anchor it
  // would serve and logs its size, once per session, form and card hash, so the shadow week measures it without a line per
  // start. Bookkeeping, bounded as the memo above; a restart logs again.
  const anchorLogged = new Map<string, string>();
  const logShadowAnchor = (id: string, form: AnchorForm, hash: string, text: string): void => {
    const key = `${id}\n${form}`;
    if (anchorLogged.get(key) === hash) return;
    anchorLogged.delete(key);
    anchorLogged.set(key, hash);
    if (anchorLogged.size > (deps.cardMemoMax ?? CARD_MEMO_MAX)) anchorLogged.delete(anchorLogged.keys().next().value!);
    console.warn(`ccrc-server: anchor-slot shadow: the ${form} anchor for ${id} is ${[...text].length} characters, ${utf8Bytes(text)} bytes (card ${hash.slice(0, 12)}); not served`);
  };
  /** The generation canary's two reads: the identity's live generation, and the session's newest start. */
  const anchorReads = (coord: CoordStore, id: string): { live: Fact<AnchorGenRow | null>; newest: Fact<AnchorStart | null> } => {
    const gens = coord.liveGenerations();
    const starts = coord.startsOf(id, 1);
    const fact = designationReadOf(coord);
    return {
      live: gens.ok && fact !== 'unmeasured' ? { kind: 'read', value: gens.rows.find((g) => g.identity === generationIdentityOf(id, fact)) ?? null }
        : { kind: 'unmeasured', what: gens.ok ? 'the designation' : 'the generations' },
      newest: starts.ok ? { kind: 'read', value: starts.rows[0] ?? null } : { kind: 'unmeasured', what: "the session's starts" },
    };
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
   *
   * `part=anchor&form=start|prompt|fork` (the anchor piece, C38): the card's short part, for the session hook. The same
   * checks, gather, render, trim and mask, so the anchor names the hash of the card the same facts render, then
   * `renderAnchor` (L1) with the same masker; it stores no snapshot and records no read. It asks for `page=0` and names no
   * hash: an older server, which ignores `part`, refuses page 0 before it reads anything, so the hook's read never stores a
   * snapshot or records a card read there (fix round 1, F1). Its answer is `anchorAnswer`'s, every one carrying `part` and
   * the form it served: `{ dark }` with no text while the Shadow lanes row `anchor-slot` is shadow (the door still renders,
   * and logs the size to the server journal once per card), and once it is live `{ hash, text }`, or, for a fork,
   * `{ live }` alone, read before any gather.
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
    const part = q['part'];
    const pageRaw = q['page'] ?? '1';
    if (part === 'anchor' && (pageRaw !== ANCHOR_PAGE || q['hash'] !== undefined)) return refuseRoute(reply, 'bad-request', { detail: 'part=anchor asks for page 0 and names no hash' });
    if (part !== 'anchor' && (typeof pageRaw !== 'string' || !PAGE_RE.test(pageRaw))) return refuseRoute(reply, 'bad-request', { detail: 'page is a positive integer' });
    const page = Number(pageRaw);
    const asked = q['hash'];
    if (asked !== undefined && (typeof asked !== 'string' || !HASH_RE.test(asked))) return refuseRoute(reply, 'bad-request', { detail: 'hash is a card hash' });
    if (page > 1 && asked === undefined) return refuseRoute(reply, 'bad-request', { detail: 'a page after the first names its card hash' });
    const form = q['form'] ?? 'start';
    if (part !== undefined && part !== 'anchor') return refuseRoute(reply, 'bad-request', { detail: 'part is anchor, or absent for the card' });
    if (part === undefined && q['form'] !== undefined) return refuseRoute(reply, 'bad-request', { detail: 'form is part=anchor\'s' });
    if (!isAnchorForm(form)) return refuseRoute(reply, 'bad-request', { detail: 'form is start, prompt, fork or delta' });
    // The conversation's start as this request began, before its first await (review 2087 F3).
    const key = memoKey(id, uuid);
    const begun = startOf(key);
    const g = await gate(req, reply, 'card', { sessionId: id, uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;

    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const anchorLive = part === 'anchor' && laneArmRowViewOf(ANCHOR_SLOT_LANE, coord.laneArmSetting(ANCHOR_SLOT_LANE), laneArmGate(ANCHOR_SLOT_LANE)).live;
    if (part === 'anchor' && form === 'fork') return reply.code(200).send(anchorAnswer(anchorLive, { form }));
    const at = deps.wall();
    const masker = deps.masker ?? SHAPE_ONLY_MASKER;
    const { facts, renderer } = await gatherCardFacts({ coord, ...deps.cardRegistry, messages: deps.operatorModel }, id, at);
    const text = masker.maskText(trimCard(renderCard(renderer, facts), CARD_BUDGET_TOKENS).text);
    const hash = sha256(text);
    if (part === 'anchor') {
      const { live, newest } = anchorReads(coord, id);
      const textForm = form === 'prompt' || form === 'delta' ? form : 'start';
      const anchor = renderAnchor(facts, { cardHash: hash, generation: anchorGeneration(live, newest) }, textForm, (t) => masker.maskText(t));
      // The delta is fetched every minute by the door process, so its shadow is not logged (slug delta-shadow-not-logged).
      if (!anchorLive && textForm !== 'delta') logShadowAnchor(id, form, hash, anchor);
      return reply.code(200).send(anchorAnswer(anchorLive, { form: textForm, hash, text: anchor }));
    }
    const factsJson = snapshotFactsJson(facts);
    const snapshotId = sha256(factsJson);
    const stored = coord.insertSnapshot({ id: snapshotId, sessionId: id, at, facts: factsJson, hash });
    if (!stored.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_snapshots could not be written' });
    if (asked !== undefined && asked !== hash) return refuseRoute(reply, CARD_REFUSALS.cardChanged, { hash, detail: 'the card changed: read it again from page 1' });
    const slices = cardPages(text);
    if (page > slices.length) return refuseRoute(reply, 'bad-request', { detail: `the card has ${slices.length} page(s)` });

    const start = startOf(key);
    const prior = served.get(key);
    const memo: Memo = prior !== undefined && prior.hash === hash && prior.start === start ? prior : { hash, start, pages: new Set() };
    let recorded = false;
    // A start of this conversation that arrived while the request was in flight leaves the page served and in no memo.
    if (begun === start) {
      served.delete(key);
      memo.pages.add(page);
      if (memo.pages.size === slices.length) {
        // The Overlord's read that completes its card is a fenced write (slug card-record-is-fenced): its own row, before the
        // record. A refusal records nothing, and the memo stands, so a retry of this page may record it.
        if (g.kind === 'pass') {
          const fenced = await gate(req, reply, 'card-record', { sessionId: id, uuid, uuidField: 'byUuid' });
          if (fenced.kind === 'refused') { remember(key, memo); return reply; }
        }
        const r = coord.insertCardRead({ sessionId: id, uuid, snapshotId, hash, pages: slices.length, at });
        if (!r.ok) {
          remember(key, memo);
          return refuseRoute(reply, 'write-failed', { detail: 'continuity_card_reads could not be written' });
        }
        recorded = true;
      } else remember(key, memo);
    }
    stampRead(coord, id, 'card');
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
  const caller = async (req: FastifyRequest, reply: FastifyReply, keeps = 'keeps its own notes'):
    Promise<{ id: string; b: Record<string, unknown> } | null> => {
    const { id, by } = identityOf(req);
    if (by['byId'] !== id) { await refuseRoute(reply, 'not-owner', { detail: `byId must be the session the path names: a session ${keeps}` }); return null; }
    const uuid = by['byUuid'];
    if (!IDENTITY_RE.test(id) || typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) { await refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' }); return null; }
    return { id, b: by };
  };
  const refuseNote = (reply: FastifyReply, r: NoteVerdictRefusal, more = '') => refuseRoute(reply, r, { detail: `${NOTE_DETAIL[r]}${more}` });

  /**
   * `POST /api/sessions/:id/notes { byId, byUuid, key, kind, waitsOn, next, revises?, closes? }`: append one note. A
   * revision names the note it supersedes (`revises`); a close is a revision with `closes: true` and takes the closed
   * note's key and kind (its `key`, `kind`, `waitsOn` and `next` are not read). `202 { ok, id }`. Refusals: `note-key-unknown`
   * 403, `note-cap` 409, `note-too-long` 400, `bad-request` 400 (a thread with a blank `next`, review 2039 F1), `unmeasured`
   * 502 (a row it needs could not be read). A detail names the key only when the revised note, if any, is the caller's and
   * live; otherwise `note <revises>` (F5). A revision may change the note's key and kind (slug revision-may-rekey).
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
    const g = await gate(req, reply, 'notes-write', { sessionId: id, uuid: b['byUuid'] as string, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');

    // The revised note, as read. A close takes its key and kind; when it is not a live note of the caller's, `revised` is
    // not `live` and the verdict refuses, so that key is never written, and the refusal names the note's id, never its key
    // (review 2039 F5: a refusal never tells what another identity's note is keyed to).
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
    const keyFact: KeyFact = closes ? 'unmeasured' : noteKeyFact(noteKeyReader(coord, id, deps.operatorModel?.() ?? undefined)(input.key), id);
    const live = coord.liveNotes(id);
    const gen = liveGenerationOf(coord, id, deps.continuityGate);
    if (gen === 'unmeasured') return refuseNote(reply, 'unmeasured', ' (the generations)');
    const verdict = noteVerdict(input, keyFact, live.ok ? live.notes.length : 'unmeasured', revised);
    // The detail names the key only when the revised note, if any, is a live note of the caller's; else the note's id.
    const named = revises !== null && revised !== 'live' ? `note ${revises}` : noteKeyText(input.key);
    if (!verdict.ok) return refuseNote(reply, verdict.refusal, ` (${named})`);
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
   * `GET /api/sessions/:id/notes?byId&byUuid[&before][&limit]`: one page of the caller's live notes, newest first, each with
   * its key's fact now (`live`, `gone`, `not-yours` or `unmeasured`: a note whose key is gone is reported as such, never
   * dropped). A page holds the notes older than `before` (every one when absent), at most `limit` (`NOTE_LIST_LIMIT`), and
   * stays under the tool result cut (`notesPage`); `more` says older ones remain, read `before` the last id. The answer is
   * masked by the one answer hook (`MASKED_GET_ROUTES` in `server.ts` lists the route). `200 { ok, notes, more }`.
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
    const g = await gate(req, reply, 'notes-read', { sessionId: c.id, uuid: c.b['byUuid'] as string, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const rawBefore = c.b['before']; const rawLimit = c.b['limit'];
    if ((rawBefore !== undefined && (typeof rawBefore !== 'string' || !QUERY_NAT_RE.test(rawBefore)))
      || (rawLimit !== undefined && (typeof rawLimit !== 'string' || !QUERY_NAT_RE.test(rawLimit) || Number(rawLimit) > NOTE_LIST_LIMIT.max))) {
      return refuseRoute(reply, 'bad-request', { detail: `before is a note id, and limit a whole number from 1 to ${NOTE_LIST_LIMIT.max}` });
    }
    const live = coord.liveNotes(c.id);
    if (!live.ok) return refuseRoute(reply, 'unmeasured', { detail: 'could not check: continuity_notes could not be read' });
    const read = noteKeyReader(coord, c.id, deps.operatorModel?.() ?? undefined);
    const wire = live.notes.map((n) => ({
      id: n.id, key: n.key, kind: n.kind, waitsOn: n.waitsOn, next: n.next, revises: n.revises, at: n.at,
    }));
    const { page, more } = notesPage(wire, rawBefore === undefined ? null : Number(rawBefore),
      rawLimit === undefined ? NOTE_LIST_LIMIT.default : Number(rawLimit), noteListBytes);
    stampRead(coord, c.id, 'notes');
    return reply.code(200).send({ ok: true, notes: page.map((n) => ({ ...n, keyFact: noteKeyFact(read(n.key), c.id) })), more });
  });

  /**
   * `POST /api/sessions/:id/handover { byId, byUuid, threads: [{ ref, waitsOn, next }], cautions, tone }`: the handover note
   * (C37), accepted only while the caller's live generation is `checkpointed` as `effectiveGeneration` reads it (otherwise
   * `note-not-asked` 409; `unmeasured` 502 when the generations could not be read). Every thread's reference must be a live
   * row of the caller's (`reference-unknown` 400; `unmeasured` 502 when one could not be read); status words are dropped
   * and counted. One row per generation: `202 { ok, generationId, dropped, fresh }`, `fresh: false` when one was stored, and
   * then `dropped` is the stored row's count (review 2039, F6).
   */
  app.post('/api/sessions/:id/handover', {
    bodyLimit: HANDOVER_BODY_LIMIT_BYTES,
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
    const g = await gate(req, reply, 'handover', { sessionId: id, uuid: b['byUuid'] as string, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');

    const gen = liveGenerationOf(coord, id, deps.continuityGate);
    const asked = handoverAsked(typeof gen === 'string' ? gen : gen.state);
    if (asked !== 'asked' || typeof gen === 'string') {
      return refuseNote(reply, asked === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.notAsked, asked === 'unmeasured' ? ' (the generations)' : '');
    }
    const read = noteKeyReader(coord, id, deps.operatorModel?.() ?? undefined);
    const note: HandoverNote = { threads, cautions: cautions as string[], tone };
    const verdict = handoverVerdict(note, threads.map((t) => noteKeyFact(read(t.ref), id)));
    if (!verdict.ok) return refuseNote(reply, verdict.refusal);
    const r = coord.putHandover({ generationId: gen.row.id, note: verdict.cleaned, dropped: verdict.dropped, at: deps.wall() });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_handovers could not be written' });
    return reply.code(202).send({ ok: true, generationId: gen.row.id, dropped: r.dropped, fresh: r.fresh });
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
    const { role } = await sessionRoleRead({ coord, ...deps.cardRegistry }, fromId);
    // From here to the write, nothing awaits: the binding, the pending count and the rate are read with the verdict and the
    // write, so a run that closes while the role is read is refused, never stored bound (review 2052 F3).
    const binding = bindingOf(coord, fromId, { runId: runId as number | null, programme: programme as string | null });
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
    const cut = cancelOf(coord, id, 'setter-cancel', 'setter', deps.wall());
    if (cut !== 'ok') return refuseRoute(reply, cut, cut === 'write-failed' ? { detail: 'continuity_timers could not be written' } : {});
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
   * be that session's (`timer-not-yours`) and pending (`timer-not-pending`); an id that names no row is `timer-not-found`,
   * because the signed-in operator may know which ids exist (review 2052 F5). Then `cancelTimer` by `operator-cancel` with
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
    const verdict = timerCancelVerdict(t.row, p.id, 'operator');
    if (verdict !== 'ok') return refuseRoute(reply, verdict);
    const cut = cancelOf(coord, timerId, 'operator-cancel', 'operator', deps.wall());
    if (cut !== 'ok') return refuseRoute(reply, cut, cut === 'write-failed' ? { detail: 'continuity_timers could not be written' } : {});
    return reply.code(200).send({ ok: true, id: timerId });
  });

  /**
   * `POST /api/sessions/:id/renew`: the operator's Renew now (Table 11.1e, W1a; the hand-offs piece, Task 1). Session-gated
   * like the timer doors above, in `CONTINUITY_SESSION_DOORS`. It records a request (`continuity_renew_requests`, this door its
   * one writer) and decides nothing about the renewal: the generations lane reads the request after its own cursor and makes
   * the session's live generation due `operator` (hard), so every check the lane makes still applies. The request carries
   * whether the `continuity` row was live when it was pressed: a press in shadow is recorded for the record only, and the lane
   * never turns it into a due, then or after the row is armed (ruling F1 on review 2312). Refused `renew-not-long-lived`
   * (409) for a session with no live generation of a long-lived role, `renew-pending` (409) while a request of its waits for
   * the lane, `unmeasured` (502) when a row could not be read. `200 { ok, id, shadow }`, `shadow` true for a press in shadow.
   */
  app.post('/api/sessions/:id/renew', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!IDENTITY_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'the path names a session id' });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const gens = coord.liveGenerations();
    const live: RenewDoorFacts['live'] = !gens.ok ? 'unmeasured' : sessionLiveGeneration(gens.rows, id);
    const cursor = coord.generationsCursor(RENEW_REQUESTS_CURSOR);
    const after = cursor.ok ? coord.renewRequestsAfter(cursor.lastStartId, 1, id) : null;
    const verdict = renewDoorVerdict({ live, pending: after === null || !after.ok ? 'unmeasured' : after.rows.length > 0 });
    if (verdict !== 'ok') {
      return refuseRoute(reply, verdict, verdict === 'unmeasured' ? { detail: 'the generations or the requests could not be read' } : {});
    }
    const armed = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), (deps.continuityGate ?? laneArmGate)(CONTINUITY_LANE)).live;
    const w = coord.insertRenewRequest({ sessionId: id, actor: deps.operatorActor?.(req) ?? 'flag-off', at: deps.wall(), live: armed });
    if (!w.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_renew_requests could not be written' });
    return reply.code(200).send({ ok: true, id: w.id, shadow: !armed });
  });

  /** `GET`/`POST /api/coord/renewal-mode` — Settings › Automation › "When soft renewals happen" (the hand-offs piece, Task 4;
   *  spec §3.3.11 R19, Table 11.1d): `when-away` (the default) or `on-schedule`. The roll-idle door's shape, registered here
   *  beside Renew now because it is a continuity setting (slug renewal-mode-door-in-continuity-routes): session-gated when
   *  sign-in is armed, open dark, in `CONTINUITY_SESSION_DOORS`; it moves no session while the `continuity` row is shadow. The
   *  one writer is `CoordStore.setRenewalMode`; a change is a record-only feed row naming the actor. */
  const renewalModeView = (coord: CoordStore): RenewalModeView =>
    ({ mode: renewalModeOf(coord.renewalModeSetting()), default: RENEWAL_MODE_DEFAULT, choices: RENEWAL_MODES });
  app.get('/api/coord/renewal-mode', async (_req, reply) => {
    if (deps.coord === undefined) return refuseRoute(reply, 'unavailable');
    return reply.code(200).send({ ok: true, ...renewalModeView(deps.coord) });
  });
  app.post('/api/coord/renewal-mode', async (req, reply) => {
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const body = req.body as { mode?: unknown } | null | undefined;
    const mode = body !== null && typeof body === 'object' ? body.mode : undefined;
    if (!isRenewalMode(mode)) return refuseRoute(reply, 'bad-request', { detail: `mode must be one of ${RENEWAL_MODES.join(', ')}` });
    let before: ReturnType<typeof renewalModeOf>;
    try { before = renewalModeOf(coord.setRenewalMode(mode, deps.wall()).before); } catch {
      return refuseRoute(reply, 'write-failed', { detail: 'renewal_mode_settings could not be written' });
    }
    if (before !== mode) {
      deps.notice?.({ kind: 'coord', sessionId: '', title: 'renewal mode changed', runId: null,
        body: `when soft renewals happen: ${before ?? 'unreadable'} -> ${mode}; by ${deps.operatorActor?.(req) ?? 'flag-off'}` },
      'record-only', { degraded: 'renewal mode written, feed archive degraded' });
    }
    return reply.code(200).send({ ok: true, ...renewalModeView(coord) });
  });

  // THE DAILY BACKSTOP'S DOORS (R19, Table 11.1d's Settings row; W1, plan `w1-renewal-readings.md` Task 2, slug
  // backstop-door-in-continuity-routes): the operator's, session-gated when sign-in is armed, never EXEMPT, consulting no
  // box token, the `plain-auto-memory` shape. No step-up: the backstop grants no authority, and it is not journalled (§7.6
  // journals authority only). `box-token-census.test.ts`'s `CONTINUITY_SESSION_DOORS` names the path once per method.
  const backstopView = (r: Extract<BackstopRead, { ok: true }>) =>
    ({ ok: true, hour: r.backstop.hour, zone: r.backstop.zone, isDefault: r.backstop.isDefault, setAt: r.backstop.setAt });

  /** `GET /api/continuity/renewal-backstop`: the backstop's hour, zone, whether it is still the default, and when it was set.
   *  A row the store cannot read answers `unavailable` with the store's detail, never the default in its place. */
  app.get('/api/continuity/renewal-backstop', async (_req, reply) => {
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.backstopRead();
    if (!r.ok) return refuseRoute(reply, 'unavailable', { detail: r.detail });
    return reply.code(200).send(backstopView(r));
  });

  /** `POST /api/continuity/renewal-backstop { hour, zone }`: the operator sets the backstop. `bad-request` for an hour that is
   *  not a whole number from 0 to 23, or a zone `Intl` does not take; `write-failed` when the store could not write it; then
   *  the row read back, as the `GET` answers it. `setBackstop` is the row's one writer. */
  app.post('/api/continuity/renewal-backstop', async (req, reply) => {
    const body = req.body as { hour?: unknown; zone?: unknown } | null | undefined;
    const hour = body !== null && typeof body === 'object' ? body.hour : undefined;
    const zone = body !== null && typeof body === 'object' ? body.zone : undefined;
    if (!isBackstopHour(hour)) return refuseRoute(reply, 'bad-request', { detail: 'hour must be a whole number from 0 to 23' });
    if (!isBackstopZone(zone)) return refuseRoute(reply, 'bad-request', { detail: `zone must be an IANA time zone name of at most ${BACKSTOP_ZONE_MAX} characters` });
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    if (!coord.setBackstop({ hour, zone, at: deps.wall() }).ok) return refuseRoute(reply, 'write-failed', { detail: 'renewal_backstop_settings could not be written' });
    const r = coord.backstopRead();
    if (!r.ok) return refuseRoute(reply, 'unavailable', { detail: r.detail });
    return reply.code(200).send(backstopView(r));
  });

  // THE PROBE DOOR (spec §3.3.5 C41, §3.3.9 C52; the probes piece, Task 4). Two box-token lanes, each an `auth/gate.ts` EXEMPT
  // entry: the token first (never the cookie), then the path's session is the caller (`not-owner`), then the shape, then the
  // registry's attribution of `byUuid`. A session reads and answers only its own rounds; the generations lane opens them. The
  // door masks every question once with the card's masker (`maskedQuestion`) and asks the deciders (`probeDoor.ts`, L1) what
  // to serve, how each answer grades and what the book state is; it decides nothing itself. Everything after the
  // attribution is synchronous, so no other request runs between the read of a round and its answer.
  const mask = (text: string): string => (deps.masker ?? SHAPE_ONLY_MASKER).maskText(text);

  /**
   * `GET /api/sessions/:id/probe?byId&byUuid[&page][&door=1]`: the caller's open round (its newest with no answer), every question
   * masked and rendered as untrusted data, never with what it expects. One page per call (`probePages`, the card's pager):
   * `200 { ok, roundId, kind, page, pages, questions: [{ id, cls }], text }`. `probe-none-open` 409 when no round of the
   * caller's is open; `unmeasured` 502 when the rounds could not be read. The text carries session-written text and is masked
   * here, field by field before it is rendered (`secret-mask.test.ts` lists the route under INLINE, as the card). `door=1` (the
   * door process's read) phrases the page's tail as the `probe_answer` door, not a shell command.
   */
  app.get('/api/sessions/:id/probe', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/sessions/:id/probe');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = await caller(req, reply, 'answers its own probes');
    if (c === null) return reply;
    const pageRaw = c.b['page'] ?? '1';
    if (typeof pageRaw !== 'string' || !PAGE_RE.test(pageRaw)) return refuseRoute(reply, 'bad-request', { detail: 'page is a positive integer' });
    const g = await gate(req, reply, 'probe-read', { sessionId: c.id, uuid: c.b['byUuid'] as string, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const open = coord.openProbeRound(c.id);
    if (!open.ok) return refuseRoute(reply, 'unmeasured', { detail: 'could not check: continuity_probes could not be read' });
    const first = open.rows[0];
    if (first === undefined) return refuseRoute(reply, PROBE_REFUSALS.noneOpen, { detail: 'no probe round of yours is open' });
    const questions = open.rows.map((r) => maskedQuestion(r, mask));
    const pages = probePages(first.roundId, first.kind, questions, c.b['door'] === '1');
    const page = Number(pageRaw);
    if (page > pages.length) return refuseRoute(reply, 'bad-request', { detail: `the round has ${pages.length} page(s)` });
    return reply.code(200).send({
      ok: true, roundId: first.roundId, kind: first.kind, page, pages: pages.length, questions: questions.map((q) => ({ id: q.id, cls: q.cls })),
      text: pages[page - 1],
    });
  });

  /**
   * `POST /api/sessions/:id/probe { byId, byUuid, roundId, answers: [{ id, answer }] }`: answer every question of one open
   * round of the caller's live generation, in one call. Each answer is graded closed-form (`gradeAnswers`: against the
   * masked question when it carries a placeholder, the stored one otherwise; a question left out fails), the book state is `open` after a card or notes read since the round was asked and `unmeasured`
   * otherwise (`bookOf`), and the round's verdict is `roundVerdict`'s. `200 { ok, roundId, verdict, grades: [{ id, grade }],
   * book }`; what a question expected is never answered. `probe-none-open` 409 when no round of the caller's live generation
   * carries the id (another session's round, and one left open by an earlier generation, are invisible, as on the GET), `probe-closed` 409 when it was answered already, `bad-request` 400 for an answer
   * id the round does not ask, a repeated id, or an answer over `PROBE_ANSWER_MAX_CHARS`. The answer is stored masked.
   */
  app.post('/api/sessions/:id/probe', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/probe');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = await caller(req, reply, 'answers its own probes');
    if (c === null) return reply;
    const { id, b } = c;
    const roundId = b['roundId']; const raw = b['answers'];
    if (typeof roundId !== 'string' || !ROUND_ID_RE.test(roundId)) return refuseRoute(reply, 'bad-request', { detail: 'roundId is the id the round was served with' });
    if (!Array.isArray(raw) || raw.length > PROBE_ROUND_MAX) return refuseRoute(reply, 'bad-request', { detail: `answers is a list of at most ${PROBE_ROUND_MAX}` });
    const answers = new Map<string, string>();
    for (const a of raw as unknown[]) {
      const o = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>;
      const qid = o['id']; const text = o['answer'];
      if (typeof qid !== 'string' || !QID_RE.test(qid) || typeof text !== 'string' || [...text].length > PROBE_ANSWER_MAX_CHARS || answers.has(qid)) {
        return refuseRoute(reply, 'bad-request', { detail: `an answer is { id, answer }: each id once, each answer at most ${PROBE_ANSWER_MAX_CHARS} characters` });
      }
      answers.set(qid, text);
    }
    const g = await gate(req, reply, 'probe-answer', { sessionId: id, uuid: b['byUuid'] as string, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');

    const round = coord.probeRoundRows(roundId, id);
    if (!round.ok) return refuseRoute(reply, 'unmeasured', { detail: 'could not check: continuity_probes could not be read' });
    const first = round.rows[0];
    if (first === undefined) return refuseRoute(reply, PROBE_REFUSALS.noneOpen, { detail: `no probe round of yours is ${roundId}` });
    const asked = new Set(round.rows.map((r) => r.qid));
    const stray = [...answers.keys()].filter((q) => !asked.has(q));
    if (stray.length > 0) return refuseRoute(reply, 'bad-request', { detail: `round ${roundId} asks no ${stray.join(', ')}` });
    // An answer copied from a masked choice is graded masked, one given whole from memory against the stored question.
    const graded = gradeAnswers(round.rows, answers, mask);
    const last = coord.lastContinuityRead(id);
    const lastRead: LastRead = last.ok ? { kind: 'read', at: last.at } : { kind: 'unmeasured' };
    const book = bookOf(lastRead, first.askedAt);
    // `answerRound` compares and sets on every question being unanswered: a round answered already is refused there.
    const w = coord.answerRound(roundId, id, graded, book, deps.wall());
    if (!w.ok) {
      return w.kind === 'closed' ? refuseRoute(reply, PROBE_REFUSALS.closed, { detail: `round ${roundId} was answered or closed already` })
        : refuseRoute(reply, 'write-failed', { detail: 'continuity_probes could not be written' });
    }
    return reply.code(200).send({
      ok: true, roundId, verdict: roundVerdict(graded.map((g) => g.grade), first.roundUnmeasured),
      grades: graded.map((g) => ({ id: g.qid, grade: g.grade })), book,
    });
  });
}
