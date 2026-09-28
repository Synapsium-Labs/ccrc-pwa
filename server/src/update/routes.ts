import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../server.js';
import type { FleetWatcher } from '../watch.js';
import type { GateDecision } from '../auth/gate.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from '../coord/token.js';
import {
  NODE_ID_RE, type CoordStore, type NodeRow, type ReleaseRow, type RequestNodeResult, type SetIntentResult,
  type UpdateIntentPatch, type UpdateIntentRow,
} from '../coord/store.js';
import { autoGateBlockers, isIngestibleReleaseTag, renderProjection, resolveNodeIntent } from './resolve.js';
import {
  CATALOGUE_MAX_REQUESTS_PER_POLL, CATALOGUE_POLL_INTERVAL_MS, UNAUTHENTICATED_HOURLY_REQUEST_BUDGET,
} from './catalogue.js';
import { resolveAndProject, resolveInputFor } from './project.js';
import { SERVER_LABEL, buildInfoOfRow } from './inventory.js';
import { dispatchViewsFor } from './converge.js';
import {
  DETACH_CAP, ROLLBACK_CAP, dispatchRefusalDetail, fleetGate, isHalting, moveRefusal, type DispatchNodeView, type FleetGate,
} from './dispatch.js';
import { UPDATE_OP } from '../../../shared/agent-protocol.js';
import {
  isAutoMode, isNotifyMode, isReleaseTag, isUpdateChannel, compareDispatchOrder, dispatchRank, SETTLED_UPDATE_STATES, UPDATE_GATE_CAP,
  type AckAnswer, type CatalogueState, type DispatchRefusal, type IntentWriteAnswer, type MoveRequestAnswer,
  type MoveSkip, type MoveSkipWhy, type NodeWire, type ReleaseWire, type RequestKind,
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
 * THE CREDENTIALS. Six routes are session-only and carry NO box-token check at
 * all (decision 15: the box token is one shared secret every fleet session
 * holds, so a box-token write would let any session on the box steer the
 * fleet's updates). They need no gate code: `installGate` fronts every route and
 * none of the six is named in `auth/gate.ts`'s EXEMPT table, so armed they sit
 * behind the passkey and, being non-GET, the origin check; dark they are open,
 * as every route is (`gate.ts`'s unarmed-exposure note). The seventh, the
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

/** Fix round 2 (R1, D-3218; corrected C3): DERIVED, never a hand-typed
 *  interval, and never against the door alone. D-3215's own text claimed
 *  "one request a minute" was well under the unauthenticated 60/hour budget,
 *  but a poll now costs up to `CATALOGUE_MAX_REQUESTS_PER_POLL` requests (the
 *  latest-release probe, the listing, and the rare moved-away tag check) —
 *  admitting a poll once a MINUTE let a thumb spend up to 180 requests an
 *  hour, three times the budget. R1's own fix (fix round 2) derived the
 *  interval as if the refresh door were the ONLY source of requests, which
 *  ignores the SCHEDULED poll (`watch.ts`'s `tick()`, on its own
 *  `CATALOGUE_POLL_INTERVAL_MS` clock, independent of this door's clock):
 *  the true worst case per hour is (door polls + scheduled polls) ×
 *  `CATALOGUE_MAX_REQUESTS_PER_POLL`. `SCHEDULED_POLLS_PER_HOUR` is derived
 *  from that SAME cadence constant catalogue.ts owns (never a hand-typed
 *  2).
 *
 *  Fix round 3 (B3, D-3218 amended, review 146): that derivation left ZERO
 *  headroom — 18 door polls plus 2 scheduled polls, times 3 requests, lands
 *  EXACTLY on the 60/hour budget — so two real shapes still exceeded it: (a)
 *  a restart, whose `requestedAt`/`lastCatalogueAt` both live only in
 *  process memory and both reset to nothing, so `watch.ts`'s first tick
 *  polls immediately (D-3182) on top of whatever the door had already
 *  spent that hour; (b) a request stamped at the poll's shared start `now`
 *  rather than its own send time, undercounting a poll whose tag check or
 *  listing goes out a deadline later (see `catalogue.ts`'s `stampRequest`).
 *  `MARGIN_POLLS_PER_HOUR` leaves room for exactly ONE such extra poll
 *  inside the hour — a single NAMED term in the one formula, never a
 *  hand-typed result — and the door's interval is sized so the door, the
 *  scheduled lane AND that margin TOGETHER fit the budget: `HOUR_MS ·
 *  CATALOGUE_MAX_REQUESTS_PER_POLL / (BUDGET − (SCHEDULED_POLLS_PER_HOUR +
 *  MARGIN_POLLS_PER_HOUR) · CATALOGUE_MAX_REQUESTS_PER_POLL)`, rounded UP
 *  (`Math.ceil`) so a fractional remainder never under-shoots and re-opens
 *  the door early — with today's values, 3600000·3 / (60 − (2+1)·3) =
 *  211,764.7… ms, so 211,765 ms. The 429 answer shape is unchanged; only the
 *  interval's value and its derivation change. */
const HOUR_MS = 3_600_000;
const SCHEDULED_POLLS_PER_HOUR = HOUR_MS / CATALOGUE_POLL_INTERVAL_MS;
/** Fix round 3 (B3, D-3218 amended, review 146): see the derivation above —
 *  one extra poll's worth of headroom inside the hour, covering a restart's
 *  immediate first poll and the send-time stamping fix together, never a
 *  hand-typed slice of the formula's result. */
const MARGIN_POLLS_PER_HOUR = 1;
export const REFRESH_MIN_INTERVAL_MS = Math.ceil(
  (HOUR_MS * CATALOGUE_MAX_REQUESTS_PER_POLL) /
  (UNAUTHENTICATED_HOURLY_REQUEST_BUDGET - (SCHEDULED_POLLS_PER_HOUR + MARGIN_POLLS_PER_HOUR) * CATALOGUE_MAX_REQUESTS_PER_POLL),
);
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

/** `POST /api/updates/apply`'s keys (design 2026-09-20 §12, update-management wave 5). */
export const APPLY_BODY_KEYS = ['nodeId', 'all', 'tag'] as const;
/** `POST /api/updates/rollback`'s keys (§12). */
export const ROLLBACK_BODY_KEYS = ['nodeId', 'to'] as const;

type TagField = { ok: true; tag: string | null } | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** An OPTIONAL tag field through the one guard: absent → null; a string `isIngestibleReleaseTag` accepts → itself; any
 *  other string → `bad-tag` (§12's own answer); anything else — `null` included, because absence is spelled by
 *  leaving the key out — → `bad-request` naming the field. */
function tagField(o: Record<string, unknown>, field: string): TagField {
  if (!(field in o)) return { ok: true, tag: null };
  const v = o[field];
  if (typeof v !== 'string') return { ok: false, error: 'bad-request', field };
  if (!isIngestibleReleaseTag(v)) return { ok: false, error: 'bad-tag', field };   // D-3216: the intent route's pin guard, one predicate
  return { ok: true, tag: v };
}

export type ParsedApplyBody =
  | { ok: true; target: { nodeId: string } | { all: true }; tag: string | null }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** The apply body: EXACTLY ONE of `nodeId` (a non-empty string) and `all` (`true`, and nothing truthy in its
 *  place) names what moves — both is ambiguous and names the extra key, `all`; neither names `nodeId`. An
 *  unknown key is `bad-request` naming it, the `parseIntentBody` rule. */
export function parseApplyBody(body: unknown): ParsedApplyBody {
  const bad = (field: string): ParsedApplyBody => ({ ok: false, error: 'bad-request', field });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(APPLY_BODY_KEYS as readonly string[]).includes(k)) return bad(k);
  }
  const hasNode = 'nodeId' in o;
  const hasAll = 'all' in o;
  if (hasNode === hasAll) return bad(hasNode ? 'all' : 'nodeId');
  let target: { nodeId: string } | { all: true };
  if (hasAll) {
    if (o.all !== true) return bad('all');
    target = { all: true };
  } else {
    const nodeId = o.nodeId;
    if (typeof nodeId !== 'string' || nodeId === '') return bad('nodeId');
    target = { nodeId };
  }
  const tag = tagField(o, 'tag');
  if (!tag.ok) return tag;
  return { ok: true, target, tag: tag.tag };
}

export type ParsedRollbackBody =
  | { ok: true; nodeId: string; to: string | null }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** The rollback body: a `nodeId`, and an optional `to` through the one guard. */
export function parseRollbackBody(body: unknown): ParsedRollbackBody {
  const bad = (field: string): ParsedRollbackBody => ({ ok: false, error: 'bad-request', field });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(ROLLBACK_BODY_KEYS as readonly string[]).includes(k)) return bad(k);
  }
  const nodeId = o.nodeId;
  if (typeof nodeId !== 'string' || nodeId === '') return bad('nodeId');
  const to = tagField(o, 'to');
  if (!to.ok) return to;
  return { ok: true, nodeId, to: to.tag };
}

/** A column that should hold a tag, read through the one guard — a value off the shape names no move. */
const tagOrNull = (v: string | null): string | null => (isReleaseTag(v) ? v : null);

/** The fleet's halt SET ASIDE: `{all: true}` asks each node only the per-node question — would the dispatcher
 *  refuse THIS node this move whatever the rest of the fleet is doing. The halt itself is the dispatcher's to
 *  enforce at dispatch time, and a request written while the fleet is halted waits for the `ack`. */
const NO_HALT: FleetGate = { haltedBy: [], leaseHeldBy: null };

type MoveRouteWord = Exclude<DispatchRefusal, 'no-update-gate' | 'waiting-for-fleet'>;

/** A dispatcher refusal as a route word. `moveRefusal` never answers `no-update-gate` for an operator request
 *  (that is auto's), and `waiting-for-fleet` is `planDispatch`'s, never `moveRefusal`'s — so either one here
 *  means the dispatcher's contract changed, and it is thrown (a 500 naming it), never folded into another word. */
function routeWord(r: DispatchRefusal): MoveRouteWord {
  if (r === 'no-update-gate' || r === 'waiting-for-fleet') {
    throw new Error(`update: moveRefusal answered ${r} for an operator request — the dispatcher's contract changed`);
  }
  return r;
}

/** The same, for `{all: true}`'s skip list: under `NO_HALT` an update move is never `halted`, never asked for
 *  the rollback cap, and never auto's `no-update-gate`. */
function skipWord(r: DispatchRefusal): MoveSkipWhy {
  if (r === 'halted' || r === 'no-update-gate' || r === 'no-rollback-cap' || r === 'waiting-for-fleet') {
    throw new Error(`update: moveRefusal answered ${r} for an unhalted update request — the dispatcher's contract changed`);
  }
  return r;
}

type SkipSentence = (view: DispatchNodeView, target: string) => string;
/** `{all: true}`'s note for a node it did NOT request, in the PAST tense (spec §12 keeps it on the row through
 *  `updateDetail`). `dispatchRefusalDetail`'s sentences are the dispatcher's, in the present tense — "waits", "has no
 *  detach" — and are re-planned and rewritten every run while the condition holds; this note is written ONCE, at the
 *  request, and nothing clears it, so a present-tense sentence would go on claiming a state the node has left. Each
 *  says what was measured when the request was made. One Record over the words `moveRefusal` can answer, spelled
 *  from the dispatcher's own vocabulary (`DETACH_CAP`, `ROLLBACK_CAP`, `UPDATE_GATE_CAP`, `UPDATE_OP`), so a word
 *  added to `DISPATCH_REFUSALS` without its sentence is a compile error here, as it is in `REFUSAL_SENTENCE`. */
const SKIP_SENTENCE: Record<DispatchRefusal, SkipSentence> = {
  'unknown-tag': (v, t) => `${t} was not a release ${v.row.label} could be moved to (no eligible catalogue row for it)`,
  'not-newer': (v, t) => `${t} was not newer than ${v.row.label}'s ${v.row.currentVersion ?? 'version'}`,
  'refused-by-node': (v, t) => `${v.row.label} had refused ${t} on a provenance verdict`,
  'stamp-unread': (v) => `${v.row.label}'s build stamp read ${v.row.stampRead}, so its version was unknown`,
  'floor-unread': (v) => `${v.row.label}'s floor had not been measured`,
  'no-detach-cap': (v) => `${v.row.label}'s ccrc-caps had no ${DETACH_CAP}`,
  'no-update-gate': (v) => `${v.row.label}'s ccrc-caps had no ${UPDATE_GATE_CAP}`,
  'no-rollback-cap': (v) => `${v.row.label}'s ccrc-caps had no ${ROLLBACK_CAP}`,
  'agent-predates-update-op': (v) => `${v.row.label}'s agent did not advertise the ${UPDATE_OP} op`,
  halted: (v, t) => `a failed or reverted node was halting every move, so ${v.row.label} was not asked for ${t}`,
  'waiting-for-fleet': (v, t) => `a fleet node was holding a request, so ${v.row.label} was not asked for ${t}`,
};

/** `not requested: ${word} — ${what was measured}`. The one builder of a `{all: true}` skip note. */
function skipDetail(refusal: DispatchRefusal, view: DispatchNodeView, target: string): string {
  return `not requested: ${refusal} — ${SKIP_SENTENCE[refusal](view, target)}`;
}

type SingleMove =
  | { ok: true; target: string }
  | { ok: false; code: number; body: Omit<UpdateRouteRefusal, 'ok'> };

/**
 * THE SINGLE-NODE PREDICATE a move route answers with (spec §12: "the route evaluates the dispatcher's own
 * predicates synchronously … and answers the 409 the dispatcher would"). In order: the row (404, 409
 * superseded); the target — the named tag, else the resolved `desiredTag` for an update (409 no-desired, with
 * the resolver's sentence) or the measured `previousVersion` for a rollback (409 no-previous: never fetched);
 * the node's OWN lease (409 busy, D-3386 — another node's lease is a turn, not a
 * refusal); then `moveRefusal` over the views the dispatcher itself plans from (`dispatchViewsFor`), with the
 * catalogue through `resolveInputFor` — W2's one mapping of the releases table — so a route 409 and the
 * dispatcher's refusal are one function's answer, never two copies of it. `halted` names the halting rows;
 * every other word carries the dispatcher's own sentence.
 */
function singleNodeMove(coord: CoordStore, nodeId: string, kind: RequestKind, named: string | null): SingleMove {
  const row = coord.node(nodeId);
  if (row === null) return { ok: false, code: 404, body: { error: 'unknown-node' } };
  if (row.supersededBy !== null) return { ok: false, code: 409, body: { error: 'superseded', detail: row.supersededBy } };
  const target = named ?? tagOrNull(kind === 'rollback' ? row.previousVersion : row.desiredTag);
  if (target === null) {
    if (kind === 'rollback') return { ok: false, code: 409, body: { error: 'no-previous', ...(row.previousRead === 'unmeasured' ? { detail: 'the previous release has not been measured yet — name one with to' } : {}) } };   // D-3495 (D-3213: NULL is "none" only when previousRead is absent)
    return {
      ok: false, code: 409,
      body: row.resolveDetail === null ? { error: 'no-desired' } : { error: 'no-desired', detail: row.resolveDetail },
    };
  }
  if (!(SETTLED_UPDATE_STATES as readonly string[]).includes(row.updateState)) {
    return { ok: false, code: 409, body: { error: 'busy', detail: row.updateState } };
  }
  const views = dispatchViewsFor(coord);
  const view = views.find((v) => v.row.nodeId === nodeId);
  if (view === undefined) return { ok: false, code: 404, body: { error: 'unknown-node' } };
  const gate = fleetGate(views.map((v) => v.row));
  const refusal = moveRefusal(view, { kind, target, source: 'request' }, resolveInputFor(coord, row).releases, gate);
  if (refusal === null) return { ok: true, target };
  const error = routeWord(refusal);
  const detail = error === 'halted' ? gate.haltedBy.join(', ') : dispatchRefusalDetail(error, view, target);
  return { ok: false, code: 409, body: { error, detail } };
}

/** `requestNode`'s refusals as HTTP. Every arm is unreachable past `singleNodeMove` in the same synchronous
 *  stretch, and each is mapped anyway, so a store that learns a refusal answers its word rather than a 500. */
function requestRefusal(r: Exclude<RequestNodeResult, { ok: true }>, tagKey: 'tag' | 'to'): { code: number; body: Omit<UpdateRouteRefusal, 'ok'> } {
  switch (r.why) {
    case 'unknown-node': return { code: 404, body: { error: 'unknown-node' } };
    case 'superseded': return { code: 409, body: { error: 'superseded', detail: r.supersededBy } };
    case 'bad-tag': return { code: 400, body: { error: 'bad-tag', field: tagKey } };
    case 'bad-kind': return { code: 400, body: { error: 'bad-request', field: 'kind' } };
  }
}

/**
 * `{all: true}` — every live node, in DISPATCH order (`compareDispatchOrder`, fleet first), so `requested`
 * reads in the order the dispatcher will move them. A request is written only for a node the move can take
 * FORWARD: with no tag named and no `desiredTag`, it is skipped `no-desired`; a node whose OWN lease is already
 * busy is skipped `busy` BEFORE `moveRefusal` is even asked (D-3406) — `settleNode` clears a row's request
 * unconditionally the moment that running move settles, so a request written here would be erased under the
 * operator's own newer tap, and the single-node route already answers `409 busy` for the same row rather than
 * writing a doomed request; otherwise it is skipped with the dispatcher's own refusal of that node, the fleet's
 * halt set aside (`NO_HALT`) — `not-newer`, `stamp-unread` (D-3385), `floor-unread` (a floor never measured, W2
 * D-3213), or a word the node cannot outgrow by waiting, `no-detach-cap` and the rest (D-3401: a request the
 * dispatcher can only refuse stands until `ack`, and on a fleet row it would hold every server move behind it,
 * D-3381). Always 202 (§12).
 *
 * A ROW THAT IS ITSELF HALTING IS SKIPPED FIRST (D-3408): `isHalting(row)` — a `failed`/
 * `reverted` row that is not a provenance verdict — is checked BEFORE `moveRefusal`, `why: 'halted'`, with no
 * request and no note written. The only door out of a halt is `ack`, and `ackNode` clears the request columns
 * in the same transaction — a request written onto a halting row here would be silently erased by that same
 * `ack`, exactly the hazard D-3406 already names for a busy row's own lease. Its `updateDetail` is already the
 * verdict `isHalting` reads, so nothing is noted either. A halt caused by ANOTHER row is a different thing
 * entirely — the fleet's halt is enforced at dispatch time, not here (`NO_HALT` is passed to `moveRefusal` on
 * purpose), so a row that is not itself halting still gets its request even while the fleet is halted by some
 * other row.
 *
 * THE SERVER NEVER MOVES AHEAD OF A SKIPPED FLEET ROW (D-3408): while ANY live fleet-role row
 * (`dispatchRank(row.role) === 0`) was skipped in this same call for its OWN lease (`busy`) or its OWN halt
 * (`halted`) — never for a capability word or `not-newer`, which do not block the row's peers — every row whose
 * rank is not fleet's is skipped `waiting-for-fleet` instead of being asked anything else, with no request and
 * no note. `compareDispatchOrder` sorts fleet rows first, so this is decided as the loop reaches them: without
 * it, a request written on the server in the same breath as a skipped fleet row would move the server AHEAD of
 * the fleet node the operator's tap could not reach, inverting the fleet-first order D-3381 already holds for a
 * halt caused by another row.
 *
 * A SKIP IS SAID ON THE ROW, not only in the reply (§12: "reports per-node refusals through `updateDetail`").
 * A skipped node gets no request, so `planDispatch` never considers it and the dispatcher's own note never
 * reaches it — the route notes the refusal itself, through the dispatcher's writer and its own PAST-tense
 * sentence (`noteDispatchRefusal`, `skipDetail`): the note is written once and nothing clears it, so it says what was
 * measured when the request was made, never a state the node may since have left. That writer answers `not-idle` for a `failed`/`reverted`/
 * busy row (a verdict or a lease keeps its detail) and `changed: false` for a repeated text. `not-newer` is not
 * noted: that node was not refused a capability — it already runs the tag or a newer one, or it was rolled back
 * below a floor at or above the tag (D-3403) — and its row already reads what it runs
 * and its floor; the 202's `skipped` says it. A `busy` skip is likewise never noted: `noteDispatchRefusal`
 * refuses a busy row anyway (D-3375), and the row's own lease detail already says what it is doing. Neither is
 * `halted` or `waiting-for-fleet` (above): the first's detail is already the verdict, and the second names no
 * refusal of the row at all.
 */
function requestAll(coord: CoordStore, tag: string | null, now: number): MoveRequestAnswer {
  const requested: string[] = [];
  const skipped: MoveSkip[] = [];
  const views = new Map(dispatchViewsFor(coord).map((v) => [v.row.nodeId, v] as const));
  // Set once any live fleet-role row is skipped THIS call for its own lease or its own halt — read only for a
  // rank!=0 row, and only fleet rows (sorted first by compareDispatchOrder) ever set it.
  let fleetSelfSkipped = false;
  for (const row of [...coord.nodes()].sort(compareDispatchOrder)) {
    const view = views.get(row.nodeId);
    if (view === undefined) {
      throw new Error(`update: live node ${row.nodeId} has no dispatch view in the same synchronous read`);
    }
    const isFleetRow = dispatchRank(row.role) === 0;
    if (isHalting(row)) {
      skipped.push({ nodeId: row.nodeId, why: 'halted' });
      if (isFleetRow) fleetSelfSkipped = true;
      continue;
    }
    if (!isFleetRow && fleetSelfSkipped) {
      skipped.push({ nodeId: row.nodeId, why: 'waiting-for-fleet' });
      continue;
    }
    const target = tag ?? tagOrNull(row.desiredTag);
    if (target === null) {
      skipped.push({ nodeId: row.nodeId, why: 'no-desired' });
      continue;
    }
    // D-3406: this row's OWN lease, checked BEFORE moveRefusal — a request written beside it is erased,
    // unconditionally, the instant that running move settles (`settleNode`), so it is never written.
    if (!(SETTLED_UPDATE_STATES as readonly string[]).includes(row.updateState)) {
      skipped.push({ nodeId: row.nodeId, why: 'busy' });
      if (isFleetRow) fleetSelfSkipped = true;
      continue;
    }
    const refusal = moveRefusal(view, { kind: 'update', target, source: 'request' }, resolveInputFor(coord, row).releases, NO_HALT);
    if (refusal !== null) {
      const why = skipWord(refusal);
      skipped.push({ nodeId: row.nodeId, why });
      if (why !== 'not-newer') {
        const noted = coord.noteDispatchRefusal(row.nodeId, skipDetail(refusal, view, target));
        if (!noted.ok && noted.why !== 'not-idle') {
          throw new Error(`update: noteDispatchRefusal refused live node ${row.nodeId} (${noted.why}) in the same synchronous read`);
        }
      }
      continue;
    }
    const written = coord.requestNode(row.nodeId, target, 'update', now);
    if (!written.ok) {
      throw new Error(`update: requestNode refused live node ${row.nodeId} (${written.why}) in the same synchronous read`);
    }
    requested.push(row.nodeId);
  }
  return { ok: true, requested, skipped };
}

export function registerUpdateRoutes(
  app: FastifyInstance, deps: Deps,
  /** `buildServer`'s `sessionAuth` — read by the projection read alone; the six
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
    // A request is not the only write that makes a node dispatchable: an `auto` write does
    // too, once the resolution above has stored its `desiredTag` (spec §10's triggers).
    watcher?.triggerDispatch();
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
   * that same per-poll maximum, the hourly budget AND the scheduled poll's
   * own cadence (fix round 2, C3 — the two lanes share one budget), never a
   * hand-typed interval. The 429 answer shape is unchanged. A
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
    // Plan W3 Task 3: *Check now* polls here, outside `tick()`, so a release this poll listed is decided in this
    // request rather than a minute later on the inventory run. Synchronous and never throws; the answer is the
    // catalogue state whatever it decides (with no watcher — a test's `open()` — there is nothing to decide).
    watcher?.pushReleaseAfterPoll(Date.now());
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
   * THE ONE-TAP (spec §12, update-management wave 5). A REQUEST, not a dispatch: the request columns are
   * written (`requestNode`), and the dispatcher is asked to run in the same turn. When no run is in flight,
   * `triggerDispatch()` starts one synchronously and it acquires the lease before its first await (Task 5), so a
   * node the dispatcher can move already reads `pending` when this reply is read; when a run IS in flight,
   * `dispatchNow` JOINS it and the one follow-up runs only after it settles (up to the ~30 s op deadline), so the
   * node may still read `idle` with its request standing when the reply is read. The result is learned by
   * re-measurement (the inventory sweep), never from this answer. Session-only: no box-token check at all,
   * not in EXEMPT (decision 15). A single named node answers the dispatcher's own 409 synchronously
   * (`singleNodeMove`); `{all: true}` always answers 202, with what it skipped and why, each refusal also
   * noted on its node's row (`requestAll`).
   */
  app.post('/api/updates/apply', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const parsed = parseApplyBody(req.body);
    if (!parsed.ok) return refuse(reply, 400, { error: parsed.error, field: parsed.field });
    const now = Date.now();
    if ('all' in parsed.target) {
      const all = requestAll(deps.coord, parsed.tag, now);
      if (all.requested.length > 0) watcher?.triggerDispatch();
      return reply.code(202).send(all);
    }
    const { nodeId } = parsed.target;
    const move = singleNodeMove(deps.coord, nodeId, 'update', parsed.tag);
    if (!move.ok) return refuse(reply, move.code, move.body);
    const written = deps.coord.requestNode(nodeId, move.target, 'update', now);
    if (!written.ok) {
      const { code, body } = requestRefusal(written, 'tag');
      return refuse(reply, code, body);
    }
    watcher?.triggerDispatch();
    const answer: MoveRequestAnswer = { ok: true, requested: [nodeId], skipped: [] };
    return reply.code(202).send(answer);
  });

  /**
   * MOVING DOWN is its own verb (decision 8): an explicit request, never a resolver outcome — which is why the
   * store's lease acquire for a rollback also requires this request (D-3376).
   * `to` defaults to the MEASURED `previousVersion` (409 no-previous when there is none — never fetched), and
   * must be a releases row (yanked permitted) this node has not refused, so a forged or mistyped body cannot
   * send a node fetching an arbitrary tag (§12). The same single-node predicate as apply, so it also answers
   * the op's own words, `no-detach-cap` and `agent-predates-update-op` (D-3387).
   */
  app.post('/api/updates/rollback', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const parsed = parseRollbackBody(req.body);
    if (!parsed.ok) return refuse(reply, 400, { error: parsed.error, field: parsed.field });
    const move = singleNodeMove(deps.coord, parsed.nodeId, 'rollback', parsed.to);
    if (!move.ok) return refuse(reply, move.code, move.body);
    const written = deps.coord.requestNode(parsed.nodeId, move.target, 'rollback', Date.now());
    if (!written.ok) {
      const { code, body } = requestRefusal(written, 'to');
      return refuse(reply, code, body);
    }
    watcher?.triggerDispatch();
    const answer: MoveRequestAnswer = { ok: true, requested: [parsed.nodeId], skipped: [] };
    return reply.code(202).send(answer);
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
