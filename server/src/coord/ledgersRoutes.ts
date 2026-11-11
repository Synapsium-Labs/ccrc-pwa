// Programme ledgers (plan PL3): the coordinator's routes for operator items and goals. L4 delivery, context
// Coordination: it parses a request, asks the store, and answers; every decision it relies on is somewhere else
// (`nextItemState` in `shared/ledgers.ts` decides a move, `claimsProgramme` decides ownership, `isSpecPath` and
// `isSlotSlug` decide shapes). The box-token routes of this file are LANES for `box-token-census.test.ts`, which reads
// this file as a lane source of its own beside `coord/routes.ts`, `update/routes.ts` and `token/routes.ts`: the routes
// are registered from `registerCoordRoutes`, but their handlers live here so `routes.ts` does not take another
// 400 lines (ARCH-01, `growth-check`).
//
// The OPERATOR'S routes (plan PL4) are in the same file, registered by `registerLedgerOperatorRoutes` from `server.ts`
// beside `/api/digest/correct`: session-gated only (they sit behind the auth gate when it is armed), no box token, except the goals read (D-8126), which takes a
// session OR the box token and is a lane of the census. One of them,
// `PUT /api/items/:id/secret` (plan PL6), is a credential act and takes the account gate with a step-up as well. They are
// the doors `box-token-census.test.ts` names as session-only, and they decide nothing themselves: a move is `nextItemState`'s,
// the stale label is `itemIsStale`'s (L1, `shared/ledgers.ts`), and ONE builder, `viewOfItem`, makes an `ItemView` for the
// routes of both lanes and for the `/ws/fleet` frame.
//
// THE ORDER EVERY ROUTE KEEPS (plan PL3 Step 3): the box token before any `await`; the body's shape; attribution
// (`byId`/`byUuid`); ownership (`claimsProgramme(byId, program)`, else 403 `not-your-programme`; a throw from it, an
// unreadable run series, is 503 `run-unreadable`, never a bare 500); the decider; the write; the emit; the answer. A
// refusal at any step writes nothing and emits nothing.
//
// A coordinator writes only its own programme's ledgers (spec §3.4): an item route also checks the ITEM's programme, so a
// coordinator acting on another programme's item is `not-your-programme`. A secret's value never reaches these routes
// (spec §5): the item names a slot, never a path.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Bus } from '../bus.js';
import type { NoticeSink } from '../notice.js';
import { refuseRoute } from '../refuse.js';
import type { GateDecision } from '../auth/gate.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import { LEDGER_ROUTE_REFUSALS, type RouteRefusal } from '../../../shared/refusal.js';
import {
  ABANDON_REFUSED_PREFIX, ABANDON_REQUESTED_PREFIX, ANSWER_MAX, ITEM_KINDS, ITEM_OPTIONS_MAX, ITEM_STEPS_MAX, ITEM_TEXT_MAX, ITEM_TITLE_MAX, NEEDED_BY_LEVELS, RECOMMEND_WHY_MAX, SECRET_VALUE_MAX,
  SOON_LABEL_MAX,
  actAbandons, doneWhenOf, earlierTickBlocks, isCloseRefusedAction, isEndRunAction, isOneLine, isSecretValue, isSlotSlug, isSpecPath, itemIsStale,
  nextItemState, outsideDocLink, secretAnswer, secretTailOf,
  type CoordinatorPresence, type GoalsRead, type ItemKind, type ItemView, type NeededBy, type SecretRemoveAnswer,
  type StoredSecret, type StoredSecretsAnswer, type WaitingView,
} from '../../../shared/ledgers.js';
import type { CoordStore, ItemEventRow, ItemRow } from './store.js';
import { operatorWasShown } from './ledgersStore.js';
import type { CoordRoutesHandle } from './routes.js';
import type { CloseOutcome } from './close.js';
import { TERMINAL_RUN_STATES } from '../../../shared/api.js';
import { endRequestEndedMail, itemMailSubject, tickMail } from './ledgersMail.js';
import { callViewOf } from './coordCalls.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { credentialBodyRoute, noStoreRoute, type AccountGate } from '../accounts/gate.js';
import {
  OperatorSecretNameCollides, OperatorSecretStoredUnrecorded, operatorSecretLaneId, operatorSlotNamesValid, readOperatorSecretMeta, readStoredSecrets,
  removeOperatorSecret, programmeChainKey, sweepOperatorSecretTemps, writeOperatorSecret, type OperatorSecretMeta, type OperatorSecretState,
  type RegisterSecret,
} from './ledgersSecrets.js';

/** What the coordinator routes need. `requireMailToken` and `requireAttribution` are `registerCoordRoutes`'s own closures,
 *  handed in rather than rebuilt, so the gate and the sender check are one implementation for every lane. */
export interface LedgerCoordinatorDeps {
  coord: CoordStore | undefined;
  requireMailToken: (req: FastifyRequest, reply: FastifyReply, route: string) => boolean;
  requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  notice: NoticeSink;
  bus: Bus;
  now: () => number;
  /** The coordinator's presence as the server last measured it (`coordinatorPresenceIn` over the fleet frame it last
   *  broadcast and the ids of the registry listing it last took), for an item's stale label and for the duplicate guard. */
  presenceOf: (sessionId: string) => CoordinatorPresence;
  /** A secret item's slot state for its view (plan PL6): the coordinator learns only that it is set. */
  secretOf: SecretMetaOf;
}

/** The PWA route a blocking item's push opens on tap: the Waiting on you list (`pwa/src/lib/routes.ts`'s `waiting` row). */
const WAITING_URL = '/waiting';
/** A reason for `ruling` on a modification: the programme ledger's entry id or a short pointer, never prose. */
const RULING_MAX = 600;
/** The coordinator's note when it sends an item back (spec §3.3). */
const RETURN_NOTE_MAX = 600;
/** The sentence of one In short copy (spec §4). */
const IN_SHORT_MAX = 1200;

/** A slot's state (plan PL6): its metadata, `{setAt: null}` when it holds a value with no readable record (review 1416 F4),
 *  `{unreadable: true}` when its value file cannot be measured (review 1418 F2), or `null` when it holds no value:
 *  `readOperatorSecretMeta` over the server's `ccrcDir`. */
export type SecretMetaOf = (program: string, slot: string) => OperatorSecretState | null;
const NO_SECRETS: SecretMetaOf = () => null;

/** One item as the console reads it, with the stale verdict its builder measured and, for a secret item, its slot's state
 *  (never the value: the metadata holds none). */
export function itemViewOf(row: ItemRow, events: readonly ItemEventRow[], stale: boolean, secret: OperatorSecretState | null = null): ItemView {
  return {
    id: row.id, program: row.program, runId: row.runId, kind: row.kind, title: row.title, why: row.why, how: row.how,
    options: row.options, recommended: row.recommended, recommendedWhy: row.recommendedWhy,
    neededBy: row.neededBy, soonLabel: row.soonLabel, state: row.state, stale,
    raisedAt: row.raisedAt, tickedAt: row.tickedAt, closedAt: row.closedAt, answer: row.answer, note: row.note,
    secretSlot: row.secretSlot, action: row.action,
    secretSet: secret === null ? null
      : 'unreadable' in secret ? { unreadable: true }
        // `tail: ''` for a console from before the PL6 follow-up, which reads `tail` and would say "Ends in undefined" (review
        // 1418 F3): no character of the value, which is true of this state. No `masked`: it is not known (departure
        // pl6f-r1-unrecorded-state).
        : secret.setAt === null ? { at: null, tail: '' }
          : { at: secret.setAt, tail: secret.tail, masked: secret.masked, ...(secret.why === undefined ? {} : { why: secret.why }) },
    history: events.map((e) => ({ at: e.at, act: e.act, note: e.note, actor: e.actor })),
  };
}

/** THE ONE BUILDER of an `ItemView` (plan PL4, review 1331 A3): the coordinator's list, the operator's routes and the
 *  `/ws/fleet` frame all come through here, so a label cannot differ between them. It MEASURES the inputs of `itemIsStale`
 *  (the newest tick mail's delivery state, the coordinator's presence) and hands them to that L1 decider; it decides
 *  nothing itself. Only a `checking` item is measured: an item with no coordinator at all reads `absent`. */
export function viewOfItem(
  coord: CoordStore, row: ItemRow, now: number, presenceOf: (sessionId: string) => CoordinatorPresence, secretOf: SecretMetaOf = NO_SECRETS,
): ItemView {
  let stale = false;
  if (row.state === 'checking') {
    const coordinator = coord.programmeCoordinator(row.program);
    // The newest tick mail by its subject alone, whoever it went to (review 1335 F2): a takeover leaves it unacknowledged.
    const mail = coord.newestTickMail(itemMailSubject(row));
    stale = itemIsStale({
      state: row.state, tickedAt: row.tickedAt, now,
      mail: mail === null ? 'none' : mail.state,
      coordinator: coordinator === null ? 'absent' : presenceOf(coordinator),
    });
  }
  const secret = row.kind === 'secret' && row.secretSlot !== null ? secretOf(row.program, row.secretSlot) : null;
  return itemViewOf(row, coord.itemHistory(row.id), stale, secret);
}

/** The goals read's window on a programme's big calls (D-8126). */
const GOALS_BIG_CALLS_MAX = 20;

/** What waits on the operator, whole: every programme's open and checking items, the Recently cleared trail, and goals for
 *  each programme that holds an item or a spec pin (slug order). The read route and the live frame both answer this. */
/** The note an end-request item closes with when its run had closed before the operator's act reached it (spec §10, step 4). */
const RUN_ALREADY_CLOSED_NOTE = 'The run had already closed.';

export function waitingViewOf(
  coord: CoordStore, now: number, presenceOf: (sessionId: string) => CoordinatorPresence, secretOf: SecretMetaOf = NO_SECRETS,
): WaitingView {
  // A death between the operator's act and its item leaves an open end request on a closed run: the next read closes it.
  coord.settleEndRequestsOfClosedRuns(RUN_ALREADY_CLOSED_NOTE, now);
  const { open, cleared } = coord.itemsFor(null, now);
  const groups = coord.callsForOperator(now);
  const programmes = [...new Set([...open.map((i) => i.program), ...cleared.map((i) => i.program), ...coord.pinnedProgrammes()])].sort();
  return {
    items: open.map((r) => viewOfItem(coord, r, now, presenceOf, secretOf)),
    cleared: cleared.map((r) => viewOfItem(coord, r, now, presenceOf, secretOf)),
    goals: programmes.map((p) => coord.goalsFor(p)),
    calls: groups.open.map(callViewOf),
    callsCleared: groups.cleared.map(callViewOf),
  };
}

/** One programme's goals read, once for every door (`GET /api/programmes/:slug/goals`): the pin and the programme's open items
 *  (`open` and `checking`, oldest first), each item cut to `id`, `kind`, `title` and `neededBy` (F1: nothing else of an item,
 *  and no secret's slot or state, leaves by this route). */
export function goalsReadOf(coord: CoordStore, slug: string, now: number): GoalsRead {
  return {
    goals: coord.goalsFor(slug),
    openItems: coord.itemsFor(slug, now).open.map((i) => ({ id: i.id, kind: i.kind, title: i.title, neededBy: i.neededBy })),
    bigCalls: coord.bigCallsFor(slug, GOALS_BIG_CALLS_MAX).map(callViewOf),
  };
}

type Body = Record<string, unknown>;
const isObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null;
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : null);

/** The attribution pair, from a body or a query. Both must be non-empty strings. */
const identityOf = (src: unknown): { byId: string; byUuid: string } | null =>
  isObject(src) && typeof src['byId'] === 'string' && src['byId'] !== '' && typeof src['byUuid'] === 'string' && src['byUuid'] !== ''
    ? { byId: src['byId'], byUuid: src['byUuid'] } : null;

/** The first violation in a raise body, or the fields ready to store. Bounds are PL1's constants. */
function parseRaise(b: Body):
  { ok: true; v: { runId: number | null; kind: ItemKind; title: string; why: string; how: string[]; options: string[] | null;
    recommended: number | null; recommendedWhy: string | null;
    neededBy: NeededBy; soonLabel: string | null; secretSlot: string | null } } | { ok: false; detail: string } {
  const no = (detail: string) => ({ ok: false, detail }) as const;
  const kind = ITEM_KINDS.find((k) => k === b['kind']);
  if (kind === undefined) return no(`kind is one of ${ITEM_KINDS.join(', ')}`);
  const neededBy = NEEDED_BY_LEVELS.find((n) => n === b['neededBy']);
  if (neededBy === undefined) return no(`neededBy is one of ${NEEDED_BY_LEVELS.join(', ')}`);
  const title = text(b['title'], ITEM_TITLE_MAX);
  if (title === null) return no(`title is 1 to ${ITEM_TITLE_MAX} characters`);
  const why = text(b['why'], ITEM_TEXT_MAX);
  if (why === null) return no(`why is 1 to ${ITEM_TEXT_MAX} characters`);
  const rawHow = b['how'];
  if (!Array.isArray(rawHow) || rawHow.length > ITEM_STEPS_MAX) return no(`how is a list of at most ${ITEM_STEPS_MAX} steps`);
  const how = rawHow.map((s) => text(s, ITEM_TEXT_MAX));
  if (how.some((s) => s === null)) return no(`each step of how is 1 to ${ITEM_TEXT_MAX} characters`);
  let options: string[] | null = null;
  if (b['options'] !== undefined && b['options'] !== null) {
    const raw = b['options'];
    if (!Array.isArray(raw)) return no('options is a list');
    const opts = raw.map((o) => text(o, ITEM_TITLE_MAX));
    if (opts.some((o) => o === null)) return no(`each option is 1 to ${ITEM_TITLE_MAX} characters`);
    options = opts as string[];
  }
  if (kind === 'decide') {
    if (options === null || options.length < 2 || options.length > ITEM_OPTIONS_MAX) return no(`a decide item carries 2 to ${ITEM_OPTIONS_MAX} options`);
  } else if (options !== null) {
    return no('only a decide item carries options');
  }
  // The recommendation (plan PL9, spec §3.2, D24): a decide item names the option its raiser recommends, by its 0-based index
  // among the options, and why it beats each alternative. Both are required of a decide item; a null is "not given", so on
  // any other kind null is the same as leaving them out, and anything else is refused.
  const given = (v: unknown): boolean => v !== undefined && v !== null;
  let recommended: number | null = null;
  let recommendedWhy: string | null = null;
  if (kind === 'decide') {
    const index = b['recommended'];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= (options as string[]).length) {
      return no(`a decide item names the option it recommends: recommended is the 0-based index of one of its ${(options as string[]).length} options`);
    }
    recommended = index;
    recommendedWhy = text(b['recommendedWhy'], RECOMMEND_WHY_MAX);
    if (recommendedWhy === null) return no(`a decide item says why it recommends that option: recommendedWhy is 1 to ${RECOMMEND_WHY_MAX} characters`);
  } else if (given(b['recommended']) || given(b['recommendedWhy'])) {
    return no('only a decide item carries a recommendation (recommended and recommendedWhy)');
  }
  let secretSlot: string | null = null;
  if (b['secretSlot'] !== undefined && b['secretSlot'] !== null) {
    if (typeof b['secretSlot'] !== 'string') return no('secretSlot is a slug');
    secretSlot = b['secretSlot'];
  }
  if (kind === 'secret') {
    if (secretSlot === null || !isSlotSlug(secretSlot)) return no('a secret item names a slot: a lower-case slug of at most 40 characters, never a path');
  } else if (secretSlot !== null) {
    return no('only a secret item names a slot');
  }
  let soonLabel: string | null = null;
  if (b['soonLabel'] !== undefined && b['soonLabel'] !== null) {
    soonLabel = text(b['soonLabel'], SOON_LABEL_MAX);
    if (soonLabel === null) return no(`soonLabel is 1 to ${SOON_LABEL_MAX} characters`);
    if (neededBy === 'later') return no('a soonLabel goes with soon or blocking, not later');
  }
  let runId: number | null = null;
  if (b['runId'] !== undefined && b['runId'] !== null) {
    runId = posInt(b['runId']);
    if (runId === null) return no('runId is a positive integer when given');
  }
  return { ok: true, v: { runId, kind, title, why, how: how as string[], options, recommended, recommendedWhy, neededBy, soonLabel, secretSlot } };
}

export function registerLedgerCoordinatorRoutes(app: FastifyInstance, deps: LedgerCoordinatorDeps): void {
  const bad = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'bad-request', { detail });
  const notConfigured = (reply: FastifyReply) => refuseRoute(reply, 'not-configured');
  const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  /** Ownership (spec §3.4): `claimsProgramme` or a refusal sent. Its throw (an unreadable run series, D-2545) is 503
   *  `run-unreadable`, so a coordinator with a row this box cannot represent is never told "not your programme" and never
   *  gets a bare 500 (review 1328 F3; `endDeadCoordinator.ts` maps the same reader the same way). */
  const owns = (coord: CoordStore, reply: FastifyReply, byId: string, program: string): boolean => {
    try {
      if (coord.claimsProgramme(byId, program)) return true;
    } catch (err) {
      refuseRoute(reply, 'run-unreadable', { detail: errText(err) });
      return false;
    }
    refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${byId} holds no open run of programme ${program}` });
    return false;
  };

  /** Every successful write tells the live frame to re-read (PL4's listener); it carries no payload. */
  const changed = (): void => { deps.bus.emit('waiting'); };

  /** A blocking item must reach the operator. It is a `coord` notice with no session: a `run` notice naming the
   *  coordinator's session is held back while the operator views that session, and a `run` notice with an empty
   *  session is the review-cap notice's shape alone (D-6911). */
  const pushBlocking = (item: ItemRow): void => {
    // `url` is the list a tap opens (review 1331 F1; review 1332 F6 measured that `opts.url` reaches `sendPush`). The feed
    // row gets no target: `NotifyEvent` carries no url and widening it is not this programme's.
    deps.notice({ kind: 'coord', sessionId: '', runId: item.runId, title: 'Waiting on you', body: item.title }, 'push',
      { tag: `item-${item.id}`, url: WAITING_URL });
  };

  /** The refusal of a text that links a document outside the console (`outsideDocLink`, spec D28): the raise route's and the
   *  return route's, as the console draws both through `linkRuns` (review 1466 F5). */
  const refuseOutsideDocLink = (reply: FastifyReply, address: string) => refuseRoute(reply, LEDGER_ROUTE_REFUSALS.outsideDocLink, {
    detail: `${address} links a document outside the console: write its repository path (docs/superpowers/specs/<file>.md), which the console opens in the Docs reader`,
  });

  // ── raise, and read a programme's items ────────────────────────────────────────────────────────────────────────────

  app.post('/api/programmes/:slug/items', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/programmes/:slug/items')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const slug = (req.params as { slug: string }).slug;
    const body = req.body;
    const who = identityOf(body);
    if (who === null) return bad(reply, 'byId and byUuid are required strings');
    const parsed = parseRaise(body as Body);
    if (!parsed.ok) return bad(reply, parsed.detail);
    // A link to a document is its repository path, which the console opens in the Docs reader (desktop-polish PL10, D-7952;
    // spec D28): an artifact page or an outside document server in any field the operator reads is refused before any write.
    const outside = outsideDocLink([parsed.v.title, parsed.v.why, ...parsed.v.how, ...(parsed.v.options ?? []),
      ...(parsed.v.recommendedWhy === null ? [] : [parsed.v.recommendedWhy]), ...(parsed.v.soonLabel === null ? [] : [parsed.v.soonLabel])]);
    if (outside !== null) return refuseOutsideDocLink(reply, outside);
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    const v = parsed.v;
    if (v.runId !== null) {
      const read = coord.run(v.runId);
      if (!read.ok) return refuseRoute(reply, 'run-unreadable', { detail: read.detail });
      if (read.run === null) return refuseRoute(reply, 'unknown-run', { detail: `no run ${v.runId}` });
      if (read.run.program !== slug) return bad(reply, `run ${v.runId} belongs to another programme`);
    }
    const now = deps.now();
    const id = coord.raiseItem({ program: slug, raisedBy: who.byId, ...v }, now);
    if (v.neededBy === 'blocking') pushBlocking(coord.itemById(id) as ItemRow);
    changed();
    return reply.code(200).send({ ok: true, id });
  });

  app.get('/api/programmes/:slug/items', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'GET /api/programmes/:slug/items')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const slug = (req.params as { slug: string }).slug;
    const who = identityOf(req.query);
    if (who === null) return bad(reply, 'byId and byUuid are required query values');
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    const { open, cleared } = coord.itemsFor(slug, deps.now());
    return reply.code(200).send({ ok: true, items: [...open, ...cleared].map((r) => viewOfItem(coord, r, deps.now(), deps.presenceOf, deps.secretOf)) });
  });

  // ── one item: confirm, send back, withdraw, and the blocking switch ─────────────────────────────────────────────────

  /** The head of the four item routes below (each has checked the token): the id, the body's identity and attribution. It
   *  decides NO ownership: attribution is the route's last await, and `ownedItem` reads and checks the item after it. Returns
   *  the caller's id, or null with the refusal sent. */
  const itemHead = async (req: FastifyRequest, reply: FastifyReply):
    Promise<{ id: number; byId: string; body: Body } | null> => {
    const rawId = (req.params as { id: string }).id;
    const id = /^[1-9][0-9]{0,15}$/.test(rawId) ? Number(rawId) : null;
    const body = req.body ?? {};
    const who = identityOf(body);
    if (id === null) { bad(reply, 'the item id is a positive integer'); return null; }
    if (who === null) { bad(reply, 'byId and byUuid are required strings'); return null; }
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return null;
    return { id, byId: who.byId, body: body as Body };
  };

  /** The item and its OWN programme's ownership, or null with the refusal sent. SYNCHRONOUS, and called right before the
   *  write with no await between them, so the ownership a route acts on is the ownership it read. */
  const ownedItem = (coord: CoordStore, reply: FastifyReply, head: { id: number; byId: string }): ItemRow | null => {
    const item = coord.itemById(head.id);
    if (item === null) { refuseRoute(reply, 'unknown-item', { detail: `no item ${head.id}` }); return null; }
    if (!owns(coord, reply, head.byId, item.program)) return null;
    return item;
  };

  /** A move by the coordinator. The programme has an open run by construction (`claimsProgramme` held), and only
   *  `dismiss` reads that, so the context says what is true. */
  const move = (coord: CoordStore, reply: FastifyReply, item: ItemRow, act: 'confirm' | 'return' | 'withdraw', note: string | null, byId: string | null = null) => {
    // A withdrawn end request tells its asker, in the move's own transaction (A22). The coordinator's own request tells nobody.
    if (act === 'withdraw' && isActing(coord, item.id)) return refuseRoute(reply, 'not-open', { detail: ACT_IN_FLIGHT_DETAIL(item.id) });
    const ending = act === 'withdraw' && isEndRunAction(item.action) ? item.action : null;
    const asker = ending !== null && item.raisedBy !== byId ? item.raisedBy : null;
    const res = asker !== null && ending !== null
      ? coord.moveItemWithMail(item.id, act, 'coordinator', {}, deps.now(), { programmeHasOpenRun: true }, (moved) => {
        const endedMail = endRequestEndedMail(moved, ending.runId, 'withdrawn');
        return insertSystemMailTx(coord, null, { fromId: 'coordinator', toId: asker, runId: null, kind: 'status', subject: endedMail.subject, body: endedMail.body });
      })
      : coord.moveItem(item.id, act, 'coordinator', act === 'return' ? { note } : {}, deps.now(), { programmeHasOpenRun: true });
    if (!res.ok) return refuseRoute(reply, res.why, { detail: `item ${item.id} cannot be ${act === 'return' ? 'returned' : act === 'confirm' ? 'confirmed' : 'withdrawn'} from here` });
    changed();
    return reply.code(200).send({ ok: true });
  };

  app.post('/api/items/:id/confirm', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/items/:id/confirm')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const head = await itemHead(req, reply);
    if (head === null) return;
    const item = ownedItem(coord, reply, head);
    if (item === null) return;
    return move(coord, reply, item, 'confirm', null);
  });

  app.post('/api/items/:id/return', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/items/:id/return')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const noteIn = isObject(req.body) ? req.body['note'] : undefined;
    const note = text(noteIn, RETURN_NOTE_MAX);
    // The note is checked ahead of attribution, as the body's shape is (the order the plan names); a missing note
    // reaches here as null and is refused before any item is read.
    if (isObject(req.body) && note === null) return bad(reply, `a returned item needs a note of 1 to ${RETURN_NOTE_MAX} characters`);
    // The console draws the note through `linkRuns` ("sent back: …"), so it is held to the raise route's rule (spec D28; review
    // 1466 F5): of the coordinator's other notes, a confirm and a withdraw take none, and no tick answer or modification text is
    // drawn through it.
    const outside = note === null ? null : outsideDocLink([note]);
    if (outside !== null) return refuseOutsideDocLink(reply, outside);
    const head = await itemHead(req, reply);
    if (head === null) return;
    const item = ownedItem(coord, reply, head);
    if (item === null) return;
    return move(coord, reply, item, 'return', note);
  });

  app.post('/api/items/:id/withdraw', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/items/:id/withdraw')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const head = await itemHead(req, reply);
    if (head === null) return;
    const item = ownedItem(coord, reply, head);
    if (item === null) return;
    return move(coord, reply, item, 'withdraw', null, head.byId);
  });

  app.post('/api/items/:id/blocking', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/items/:id/blocking')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const flag = isObject(req.body) ? req.body['blocking'] : undefined;
    if (isObject(req.body) && typeof flag !== 'boolean') return bad(reply, 'blocking is true or false');
    const head = await itemHead(req, reply);
    if (head === null) return;
    const item = ownedItem(coord, reply, head);
    if (item === null) return;
    const blocking = flag === true;
    const res = coord.setBlocking(item.id, blocking, deps.now());
    if (!res.ok) return refuseRoute(reply, res.why, { detail: `item ${item.id} is closed` });
    // The store decides, inside its transaction, whether the level moved; the push and the emit follow its answer.
    if (res.changed) {
      if (blocking) pushBlocking(item);
      changed();
    }
    return reply.code(200).send({ ok: true });
  });

  // ── Goals: the spec pin and its modifications ──────────────────────────────────────────────────────────────────────

  app.post('/api/programmes/:slug/spec', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/programmes/:slug/spec')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const slug = (req.params as { slug: string }).slug;
    const who = identityOf(req.body);
    if (who === null) return bad(reply, 'byId and byUuid are required strings');
    const b = req.body as Body;
    const specPath = b['specPath'];
    if (typeof specPath !== 'string' || !isSpecPath(specPath)) {
      return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badSpecPath, { detail: 'specPath is a .md file under docs/superpowers/specs/, with no .. in it' });
    }
    const inShort = text(b['inShort'], IN_SHORT_MAX);
    if (inShort === null) return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badInShort, { detail: `inShort is 1 to ${IN_SHORT_MAX} characters` });
    let doneWhen: string[] | null = null;
    if (b['doneWhen'] !== undefined && b['doneWhen'] !== null) {
      const dw = doneWhenOf(b['doneWhen']);
      if (!dw.ok) return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badDoneWhen, { detail: dw.detail });
      doneWhen = dw.doneWhen;
    }
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    // The definition of done is operator-only (O3): a pin sets it only while none is stored; a different list over a stored
    // one is a modification, which cites a ruling or an item (`goals modify`) and leaves a dated row.
    if (doneWhen !== null) {
      const stored = coord.goalsFor(slug).doneWhen ?? null;
      if (stored !== null && JSON.stringify(stored) !== JSON.stringify(doneWhen)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.doneWhenNeedsRuling, { detail: 'this programme already has a definition of done; change it with goals modify, citing a ruling or an itemId' });
      }
    }
    coord.setSpecPin(slug, specPath, inShort, deps.now(), doneWhen);
    changed();
    return reply.code(200).send({ ok: true });
  });

  app.post('/api/programmes/:slug/modifications', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/programmes/:slug/modifications')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const slug = (req.params as { slug: string }).slug;
    const who = identityOf(req.body);
    if (who === null) return bad(reply, 'byId and byUuid are required strings');
    const b = req.body as Body;
    const modText = text(b['text'], ITEM_TEXT_MAX);
    if (modText === null) return bad(reply, `text is 1 to ${ITEM_TEXT_MAX} characters`);
    let ruling: string | null = null;
    if (b['ruling'] !== undefined && b['ruling'] !== null) {
      ruling = text(b['ruling'], RULING_MAX);
      if (ruling === null) return bad(reply, `ruling is 1 to ${RULING_MAX} characters when given`);
    }
    let itemId: number | null = null;
    if (b['itemId'] !== undefined && b['itemId'] !== null) {
      itemId = posInt(b['itemId']);
      if (itemId === null) return bad(reply, 'itemId is a positive integer when given');
    }
    let pr: number | null = null;
    if (b['pr'] !== undefined && b['pr'] !== null) {
      pr = posInt(b['pr']);
      if (pr === null) return bad(reply, 'pr is a positive integer when given');
    }
    let doneWhen: string[] | null = null;
    if (b['doneWhen'] !== undefined && b['doneWhen'] !== null) {
      const dw = doneWhenOf(b['doneWhen']);
      if (!dw.ok) return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badDoneWhen, { detail: dw.detail });
      if (ruling === null && itemId === null) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.doneWhenNeedsRuling, { detail: 'a new definition of done needs a ruling or an itemId to stand on' });
      }
      doneWhen = dw.doneWhen;
    }
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    if (itemId !== null) {
      const item = coord.itemById(itemId);
      if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${itemId}` });
      if (item.program !== slug) return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `item ${itemId} belongs to another programme` });
    }
    const id = coord.addModification(slug, { text: modText, ruling, itemId, pr, doneWhen }, deps.now());
    changed();
    return reply.code(200).send({ ok: true, id });
  });

  app.post('/api/programmes/:slug/modifications/merged', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/programmes/:slug/modifications/merged')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const slug = (req.params as { slug: string }).slug;
    const who = identityOf(req.body);
    if (who === null) return bad(reply, 'byId and byUuid are required strings');
    const pr = posInt((req.body as Body)['pr']);
    if (pr === null) return bad(reply, 'pr is a positive integer');
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    const marked = coord.markModificationsMerged(slug, pr, deps.now());
    if (marked > 0) changed();
    return reply.code(200).send({ ok: true, marked });
  });
}

// ── the OPERATOR'S routes (plan PL4) ─────────────────────────────────────────────────────────────────────────────
//
// Session-gated, no box token: like `/api/digest/correct`, the operator's door. What they need.
export interface LedgerOperatorDeps {
  coord: CoordStore | undefined;
  bus: Bus;
  now: () => number;
  presenceOf: (sessionId: string) => CoordinatorPresence;
  /** The account gate (D-5511): the secret's route is a credential act, so it asks for a step-up first (plan PL6). */
  gate: AccountGate;
  /** Where the operator-secret slots live (`cfg.ccrcDir`, `coord/ledgersSecrets.ts`). */
  ccrcDir: string;
  /** The egress masker's one registration of a server-held secret (`SecretMasker.ingestSecret`), `beside` the lane's rows when
   *  the write could not prove what its slot holds (review 1416 F1). */
  registerSecret: RegisterSecret;
  /** The egress masker's retirement of a removed slot's lane (`SecretMasker.retireSecret`): masked for the life of this process,
   *  never reloaded after. */
  retireSecret: (laneId: string) => void;
  /** The coordination serialiser's abandon hold (`CoordRoutesHandle.withAbandon`): the operator's `act` on an end-request item
   *  runs the abandon arm inside it, exactly as the abandon route does (D-8076; spec 2026-11-04 §10, "The act"). */
  withAbandon: CoordRoutesHandle['withAbandon'];
  /** `closeRun`'s typed result as the abandon route sends it (`sendCloseOutcome`), so the act answers in the same shapes and
   *  the sheet reads the same refusals and `childReclaim` fields (A23). */
  sendClose: (reply: FastifyReply, outcome: CloseOutcome) => FastifyReply;
  /** Whether the sign-in gate is armed (`cfg.authEnabled`): the goals read authenticates for itself (EXEMPT-BUT-AUTHENTICATED). */
  authEnabled: boolean;
  /** The gate's session verdict for a request, and the box token read at request time: the goals read's two credentials. */
  sessionAuth: (req: FastifyRequest) => GateDecision;
  mailToken: () => string | BoxTokenHolder | null;
  /** How long an act waits for the slot's previous act before it answers `slot-busy` (`SLOT_WAIT_MS`; a test passes its own). */
  slotWaitMs?: number;
}

/** The tick's words to the operator, and the reasons behind the two programme refusals. */
const PROGRAMME_ENDED_SENTENCE = 'the programme has no open run, so no coordinator is waiting on this tick: dismiss the item instead';
const PROGRAMME_UNCLAIMED_SENTENCE =
  'the programme\'s open run has no coordinator to mail: end that run with the operator\'s abandon door first (a dismiss is refused while it is open)';

/** The secret route's body cap: a value of `SECRET_VALUE_MAX` characters each JSON-escaped to six bytes (`\u0001`, the longest
 *  escape), the `{"value":""}` around it and room to spare (plan PL6; review 1391 A-9: 16384 refused a value the panel takes).
 *  On the secret's route the body IS the secret, so its body errors are fixed words (`credentialBodyRoute`). */
export const SECRET_BODY_LIMIT = SECRET_VALUE_MAX * 6 + 1024;
/** How long an act on a slot waits for that slot's previous act (review 1391 A-3): past it the act answers `slot-busy` and does
 *  nothing, so a write stuck on a sick disk never queues requests behind it without bound. */
export const SLOT_WAIT_MS = 30_000;

/** The end-request items whose Abandon run is in flight, per store. The abandon's fleet act awaits before it commits, and
 *  the coordinator's withdraw and the operator's decline take no coordination hold, so while an item is in this set both
 *  refuse it: the asker is never told "Nothing was ended" about a run the operator is ending (D-8076). */
const actingItems = new WeakMap<CoordStore, Set<number>>();
const isActing = (coord: CoordStore, id: number): boolean => actingItems.get(coord)?.has(id) === true;
const ACT_IN_FLIGHT_DETAIL = (id: number): string => `item ${id} is being acted on: the operator's Abandon run is in progress`;
const RUN_ABANDONED_NOTE = 'The operator abandoned the run.';

/** Why an operator's `act` or `decline` cannot take an item, or null: it must be open (`nextItemState`'s word), not held (the
 *  operator never saw a held item), and carry an action that may abandon (`act`: `end-run`, or `close-refused` with an abandoning
 *  door) or an `end-run` (`decline`). */
function endRunItemRefusal(item: ItemRow, act: 'act' | 'decline', now: number): { why: RouteRefusal; detail: string } | null {
  const verdict = nextItemState(item.state, act, 'operator', { programmeHasOpenRun: true });
  if (!verdict.ok) return { why: verdict.why, detail: `item ${item.id} is ${item.state}, not open` };
  // `act` abandons: an end request, or a refused close with an abandoning door. `decline` applies to an end request alone.
  const may = act === 'decline' ? isEndRunAction(item.action) : actAbandons(item.action);
  if (!may) return { why: 'not-open', detail: `item ${item.id} carries no action the operator can ${act}` };
  if (item.heldUntil !== null && item.heldUntil > now) return { why: 'not-open', detail: `item ${item.id} is held and is not yet on the operator's list` };
  return null;
}

export function registerLedgerOperatorRoutes(app: FastifyInstance, deps: LedgerOperatorDeps): void {
  const bad = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'bad-request', { detail });
  const itemIdOf = (req: FastifyRequest): number | null => {
    const raw = (req.params as { id: string }).id;
    return /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : null;
  };
  const secretOf: SecretMetaOf = (program, slot) => readOperatorSecretMeta(deps.ccrcDir, program, slot);
  // On start, before any route below can write: every slot's leftover temp files across the store (review 1416 A-S6).
  sweepOperatorSecretTemps(deps.ccrcDir);

  /**
   * WHAT A TICK NEEDS, once for both doors (the tick and the secret's route): the programme's coordinator, the tick's mail,
   * and no outstanding earlier tick of the item. Synchronous and pure over what it reads: it answers the coordinator and
   * the mail ready to queue, or the refusal (its word and detail), which each door sends in its own words.
   */
  type TickPlan = { ok: true; coordinator: string; mail: { subject: string; body: string } } | { ok: false; why: RouteRefusal; detail: string };
  const tickPlan = (coord: CoordStore, item: ItemRow, answer: string | null): TickPlan => {
    const coordinator = coord.programmeCoordinator(item.program);
    if (coordinator === null) {
      return coord.programmeHasOpenRun(item.program)
        ? { ok: false, why: LEDGER_ROUTE_REFUSALS.programmeUnclaimed, detail: PROGRAMME_UNCLAIMED_SENTENCE }
        : { ok: false, why: LEDGER_ROUTE_REFUSALS.programmeEnded, detail: PROGRAMME_ENDED_SENTENCE };
    }
    const mail = tickMail(item, answer);
    if (!mail.ok) {
      return { ok: false, why: LEDGER_ROUTE_REFUSALS.tooLarge, detail: `the mail to the coordinator would be ${mail.bytes} bytes, past the ${mail.limit} byte cap` };
    }
    // The newest tick mail of this item, whoever it went to and whatever run it rode (review 1335 F2): whether it holds this
    // tick is `earlierTickBlocks`'s to decide, once (outstanding, and not left behind: review 1336 F1, review 1338).
    const earlier = coord.newestTickMail(mail.subject);
    if (earlier !== null && earlierTickBlocks({
      state: earlier.state, recipient: earlier.toId, coordinator, recipientPresence: deps.presenceOf(earlier.toId),
    })) {
      return { ok: false, why: 'duplicate', detail: `an earlier tick of this item went to ${earlier.toId}, which has not acknowledged it` };
    }
    return { ok: true, coordinator, mail: { subject: mail.subject, body: mail.body } };
  };

  /** The tick with its mail, in one transaction (`tickWithMail` re-decides the move inside it). The mail rides NO run (review
   *  1335 F1): the run it would ride is the one the coordinator closes when the wave ends, and `closeRun` parks every
   *  unacknowledged mail of the run it closes. System mail to a literal session id with no run is deliverable whatever the
   *  runs do (the digest's correction is the same shape). */
  const tickNow = (coord: CoordStore, id: number, answer: string | null, plan: { coordinator: string; mail: { subject: string; body: string } }, now: number) =>
    coord.tickWithMail(id, answer, now, () => insertSystemMailTx(coord, null, {
      fromId: 'operator', toId: plan.coordinator, runId: null, kind: 'answer', subject: plan.mail.subject, body: plan.mail.body,
    }));

  // NO AWAIT in the two moves below, deliberately: the handlers are synchronous, so the state they read (the item, the
  // programme's runs, the outstanding mail) is the state they write against; `tickWithMail` and `moveItem` re-decide inside
  // their own transaction. `ledgers-operator-routes.test.ts` pins it by call order (a microtask queued at the first item read
  // must run after the write), for these two and for PL3's four item routes.

  app.get('/api/waiting', (_req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    return reply.code(200).send({ ok: true, waiting: waitingViewOf(coord, deps.now(), deps.presenceOf, secretOf) });
  });

  // D-8194: one item by its id, whatever its state and however long ago it closed, so an item opened by its number (a link in
  // another item's text, a page kept open) still opens, read-only, after it has left the Recently cleared window. The
  // operator's read beside the list: session-gated, no box token. An item the operator was never shown (held, or settled
  // inside its hold: `operatorWasShown`, the list's own rule) is `unknown-item`, as is a number no item has.
  app.get('/api/items/:id', (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = itemIdOf(req);
    if (id === null) return bad(reply, 'the item id is a positive integer');
    const now = deps.now();
    const item = coord.itemById(id);
    if (item === null || !operatorWasShown(item, now)) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
    return reply.code(200).send({ ok: true, item: viewOfItem(coord, item, now, deps.presenceOf, secretOf) });
  });

  // EXEMPT-BUT-AUTHENTICATED (D-149's pattern, D-8126): a live session OR the box token, 401 only when both fail, and before
  // the `not-configured` answer so an anonymous caller learns nothing. No ownership check (a coordinator reads another
  // programme's pin). The `onRequest` is the whole check; the handler below it is synchronous.
  app.get('/api/programmes/:slug/goals', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!deps.authEnabled) return undefined;
      const session = deps.sessionAuth(req);
      if (session.reason === 'session') return undefined;
      if (checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/programmes/:slug/goals') === 'ok') return undefined;
      return refuseRoute(reply, 'unauthenticated', {
        verdict: session.verdict,
        detail: `this read takes a session cookie OR the box token (${MAIL_TOKEN_HEADER})`,
      });
    },
  }, (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    return reply.code(200).send({ ok: true, ...goalsReadOf(coord, (req.params as { slug: string }).slug, deps.now()) });
  });

  app.post('/api/items/:id/tick', (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = itemIdOf(req);
    if (id === null) return bad(reply, 'the item id is a positive integer');
    const body = req.body ?? {};
    if (!isObject(body)) return bad(reply, 'the body is an object');
    // The order of the plan's Interfaces block: the item is there; a secret takes its own route; then the item must be open
    // (Review Focus 3: a double tap is `not-open`, and `tickWithMail` re-decides it inside its transaction); the answer's rules;
    // the coordinator; the duplicate guard; the tick with its mail.
    const item = coord.itemById(id);
    if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
    if (item.kind === 'secret') {
      return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.useSecretRoute, { detail: 'a secret is given on its own route; it never rides a tick' });
    }
    // An item that carries an action is answered by `act` or `decline` alone; a tick would strand it in `checking`, where both are refused.
    if (item.action !== null) return refuseRoute(reply, 'not-open', { detail: `item ${id} is answered with the controls on its row, not ticked` });
    if (item.heldUntil !== null && item.heldUntil > deps.now()) return refuseRoute(reply, 'not-open', { detail: `item ${id} is held and is not yet on the operator's list` });
    const verdict = nextItemState(item.state, 'tick', 'operator', { programmeHasOpenRun: false });
    if (!verdict.ok) return refuseRoute(reply, verdict.why, { detail: `item ${id} is ${item.state}, not open` });
    const given = body['answer'];
    let answer: string | null = null;
    if (item.kind === 'do') {
      if (given !== undefined && given !== null) return bad(reply, 'a do item takes no answer');
    } else {
      answer = text(given, ANSWER_MAX);
      if (answer === null) return bad(reply, `a ${item.kind} item needs an answer of 1 to ${ANSWER_MAX} characters`);
    }
    const plan = tickPlan(coord, item, answer);
    if (!plan.ok) return refuseRoute(reply, plan.why, { detail: plan.detail });
    const now = deps.now();
    const res = tickNow(coord, id, answer, plan, now);
    if (!res.ok) return refuseRoute(reply, res.why, { detail: `item ${id} cannot be ticked from here` });
    deps.bus.emit('waiting');
    return reply.code(200).send({ ok: true, item: viewOfItem(coord, res.item, now, deps.presenceOf, secretOf) });
  });

  /**
   * `POST /api/items/:id/act` (D-8076; spec 2026-11-04 §10, "The act"): the operator's Abandon run on an end-request item, and Abandon or Abandon anyway on a refused-close item (Task 27,
   * D-8077; `endRunItemRefusal` says which items may). Decline stays an end request's alone.
   * SESSION ONLY and BODY-LESS: no box token, and no field of the request is read, so a caller cannot name another run or an
   * archive (the abandon route's own rule, D-280). The whole act runs inside `withAbandon`'s coordMutex hold, in the spec's
   * order: read the item (open, not held, carrying an action that may abandon); run the abandon arm as the operator
   * with `abandon:requested:<item>` (`abandon:refused:<item>` on a refused-close item, which no session asked for); move the item `act` (open to done); and a run that had already closed closes the item
   * with a note and is success. The abandon's fleet act runs before its commit, so the item's move is a second step: a death
   * between the two is mended by `settleEndRequestsOfClosedRuns` on the next read. A refusal of the arm is the abandon route's
   * answer, sent as it sends it, and the item stays raised.
   */
  app.post('/api/items/:id/act', async (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = itemIdOf(req);
    if (id === null) return bad(reply, 'the item id is a positive integer');
    if (coord.itemById(id) === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
    return deps.withAbandon(coord, async (abandon) => {
      // Read again inside the hold: the item may have moved while this act waited for it.
      const item = coord.itemById(id);
      if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
      const now = deps.now();
      const refusal = endRunItemRefusal(item, 'act', now);
      if (refusal !== null) return refuseRoute(reply, refusal.why, { detail: refusal.detail });
      const runId = (item.action as { runId: number }).runId;
      const read = coord.run(runId);
      if (read.ok && read.run !== null && (TERMINAL_RUN_STATES as readonly string[]).includes(read.run.state)) {
        const settled = coord.moveItem(id, 'settle', 'ccrc', { note: RUN_ALREADY_CLOSED_NOTE }, now, { programmeHasOpenRun: true });
        if (!settled.ok) return refuseRoute(reply, settled.why, { detail: `item ${id} cannot be closed from here` });
        deps.bus.emit('waiting');
        // `alreadyClosed` tells the sheet nothing was abandoned here: the run closed before the operator's tap, so it must not claim
        // an abandon nor a sibling's hold on the workspace.
        return reply.code(200).send({ ok: true, id: runId, state: read.run.state, released: false, childReclaim: 'not-queued', alreadyClosed: true });
      }
      // Held from the check above to the move below: a withdraw or a decline in between is refused (`isActing`).
      const holds = actingItems.get(coord) ?? new Set<number>();
      actingItems.set(coord, holds);
      holds.add(id);
      try {
        const outcome = await abandon(runId, `${isCloseRefusedAction(item.action) ? ABANDON_REFUSED_PREFIX : ABANDON_REQUESTED_PREFIX}${id}`);
        if (!outcome.ok) return deps.sendClose(reply, outcome);
        let moved = coord.moveItem(id, 'act', 'operator', {}, deps.now(), { programmeHasOpenRun: true });
        // The run is abandoned either way. A refused move is mended with a settle; an item the mender already closed is fine;
        // anything else is a fault the operator is told about, never a silent success.
        if (!moved.ok && coord.itemById(id)?.state !== 'done') {
          moved = coord.moveItem(id, 'settle', 'ccrc', { note: RUN_ABANDONED_NOTE }, deps.now(), { programmeHasOpenRun: true });
          if (!moved.ok) {
            deps.bus.emit('waiting');
            return refuseRoute(reply, 'write-failed', { detail: `run ${runId} was abandoned, but item ${id} could not be closed (${moved.why}); it settles on the next read` });
          }
        }
        deps.bus.emit('waiting');
        return deps.sendClose(reply, outcome);
      } finally {
        holds.delete(id);
      }
    });
  });

  /**
   * `POST /api/items/:id/decline` (D-8076; spec §10): Keep the run. SESSION ONLY and BODY-LESS. The item moves `decline` (open to
   * dismissed) and its asker is mailed in the move's own transaction (A22), so a declined item always has its mail and a failed
   * mail leaves the item open. Applies to an end-request item alone. No await: the item is read and moved in one step.
   */
  app.post('/api/items/:id/decline', (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = itemIdOf(req);
    if (id === null) return bad(reply, 'the item id is a positive integer');
    const item = coord.itemById(id);
    if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
    const now = deps.now();
    const refusal = endRunItemRefusal(item, 'decline', now);
    if (refusal !== null) return refuseRoute(reply, refusal.why, { detail: refusal.detail });
    if (isActing(coord, id)) return refuseRoute(reply, 'not-open', { detail: ACT_IN_FLIGHT_DETAIL(id) });
    const action = item.action as { runId: number };
    const res = coord.moveItemWithMail(id, 'decline', 'operator', {}, now, { programmeHasOpenRun: true }, (moved) => {
      const mail = endRequestEndedMail(moved, action.runId, 'declined');
      return insertSystemMailTx(coord, null, { fromId: 'operator', toId: moved.raisedBy, runId: null, kind: 'status', subject: mail.subject, body: mail.body });
    });
    if (!res.ok) return refuseRoute(reply, res.why, { detail: `item ${id} cannot be declined from here` });
    deps.bus.emit('waiting');
    return reply.code(200).send({ ok: true, item: viewOfItem(coord, res.item, now, deps.presenceOf, secretOf) });
  });

  /** D-8126: the operator's Seen on a big call. Session-gated like the tick; no box token. Idempotent: a second Seen answers the
   *  same 200 and leaves `seenAt` as the first wrote it. A row that is not a big call has nothing to be Seen (`not-big`). */
  app.post('/api/calls/:id/seen', (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const raw = (req.params as { id: string }).id;
    if (!/^[1-9][0-9]{0,15}$/.test(raw)) return bad(reply, 'the call id is a positive integer');
    const id = Number(raw);
    const res = coord.markCallSeen(id, deps.now());
    if (res === 'unknown') return refuseRoute(reply, 'unknown-call', { detail: `no call ${id}` });
    if (res === 'not-big') return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notBig, { detail: `call ${id} is not a big call: only a big call is Seen` });
    if (res === 'seen') deps.bus.emit('waiting');
    const row = coord.callById(id);
    return reply.code(200).send({ ok: true, call: row === null ? null : callViewOf(row) });
  });

  app.post('/api/items/:id/dismiss', (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = itemIdOf(req);
    if (id === null) return bad(reply, 'the item id is a positive integer');
    const item = coord.itemById(id);
    if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
    const now = deps.now();
    // Spec D15: the operator may dismiss only while the programme has no open run; `nextItemState` decides it from this.
    const res = coord.moveItem(id, 'dismiss', 'operator', {}, now, { programmeHasOpenRun: coord.programmeHasOpenRun(item.program) });
    if (!res.ok) return refuseRoute(reply, res.why, { detail: `item ${id} cannot be dismissed from here` });
    deps.bus.emit('waiting');
    return reply.code(200).send({ ok: true, item: viewOfItem(coord, res.item, now, deps.presenceOf, secretOf) });
  });

  /**
   * `PUT /api/items/:id/secret` (plan PL6, spec §5): the operator pastes a secret straight into its slot. A CREDENTIAL ACT, so
   * the account gate runs FIRST, with a step-up, before the body is used: refused while sign-in is not armed (`auth-off`),
   * from a plain-HTTP origin (`insecure-origin`) and without a recent step-up; it never falls back to an unconfirmed save.
   * Then the item: a secret item (`not-a-secret-item`), open (`not-open`), whose programme and slot pass their shapes
   * (`bad-slot`, re-checked before any path is built); the value, 1 to `SECRET_VALUE_MAX` characters and bytes, and ONE line
   * (`secret-not-one-line`: no line break of any kind, `isOneLine`, the operator's rulings on programme item 8 and review 1416
   * A-R5); the tick's
   * preconditions (its coordinator, its mail, no outstanding earlier tick), checked BEFORE the write so a refused tick stores
   * nothing; the write and the masker's registration (`writeOperatorSecret`); then the tick, with the answer
   * `secretAnswer` builds: set and the time, and the tail only when the masker catches the value (`masked`), NEVER the value.
   *
   * ONE SAVE OF A SLOT AT A TIME (review 1389 F2): everything after the gate runs on its programme's chain (`underSlot`, keyed by
   * `programmeChainKey`: every slot and spelling of the programme, review 1466 F11 and F12), so a second save of the same slot
   * starts only once the first has ticked, and then meets `not-open` before it writes anything. The file, its metadata and the
   * masker's row are always one save's. A Remove rides the same chain. An act that
   * waits past `SLOT_WAIT_MS` answers `slot-busy` and does nothing (review 1391 A-3).
   *
   * AFTER THE VALUE IS IN ITS SLOT, EVERY FAILURE IS ONE WORD (review 1389 F3): `stored-not-ticked`, whether the fsync or the
   * metadata after the rename failed, the tick was refused (the coordinator went in between), or the tick or the answer's
   * view threw. Each is caught here, so the route's body error handler never sees it. Saving again replaces the value.
   *
   * THE VALUE GOES NOWHERE ELSE. Not into a refusal, a detail, a log line, the item, the mail or the answer: every refusal
   * below is a fixed word with a fixed detail, a write failure included, and `Cache-Control: no-store` is on every answer.
   */
  const slotChains = new Map<string, Promise<void>>();
  /** Runs `act` once the slot's previous act has finished, or answers `busy` when that takes longer than the deadline (review
   *  1391 A-3). A waiter that gives up releases its own place at once, so the one after it waits only for the act still
   *  running, and the map entry stays until that act is done: the deadline never lets two acts of one slot run together. */
  const slotWait = deps.slotWaitMs ?? SLOT_WAIT_MS;
  const underSlot = async <T>(key: string, act: () => Promise<T>, busy: () => T): Promise<T> => {
    const before = slotChains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const chain = before.then(() => mine);
    slotChains.set(key, chain);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), slotWait); });
    const first = await Promise.race([before.then(() => 'ready' as const), late]);
    clearTimeout(timer);
    if (first === 'late') {
      release();
      return busy();
    }
    try {
      return await act();
    } finally {
      release();
      if (slotChains.get(key) === chain) slotChains.delete(key);
    }
  };
  /** `Cache-Control: no-store` on every answer of the two stored-secret doors, refusals included, from `onRequest`: the
   *  account gate's one spelling of it (`noStoreRoute`, `accounts/gate.ts`), which the secret's PUT takes too. */
  const noStore = noStoreRoute.onRequest;
  const slotBusy = (reply: FastifyReply) =>
    refuseRoute(reply, LEDGER_ROUTE_REFUSALS.slotBusy, { detail: 'an earlier save or removal of this secret has not finished; nothing was done, try again' });
  const storedNotTicked = (reply: FastifyReply, id: number) =>
    refuseRoute(reply, LEDGER_ROUTE_REFUSALS.storedNotTicked, { detail: `the secret is stored, but item ${id} was not marked done; save it again` });

  app.put('/api/items/:id/secret', credentialBodyRoute(SECRET_BODY_LIMIT), async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = itemIdOf(req);
    if (id === null) return bad(reply, 'the item id is a positive integer');
    const first = coord.itemById(id);
    if (first === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
    // The chain's key is the programme the item names (`programmeChainKey`); inside it every check is made again, on the item as
    // it is then.
    return underSlot(programmeChainKey(first.program), async () => {
      const item = coord.itemById(id);
      if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` });
      if (item.kind !== 'secret') return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notSecretItem, { detail: `item ${id} does not ask for a secret` });
      const verdict = nextItemState(item.state, 'tick', 'operator', { programmeHasOpenRun: false });
      if (!verdict.ok) return refuseRoute(reply, verdict.why, { detail: `item ${id} is ${item.state}, not open` });
      const slot = item.secretSlot;
      if (slot === null || !operatorSlotNamesValid(item.program, slot)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badSlot, { detail: `item ${id} names a slot this server will not store a secret in` });
      }
      const body: unknown = req.body;
      const value = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Body)['value'] : undefined;
      if (!isSecretValue(value)) return bad(reply, `the value is 1 to ${SECRET_VALUE_MAX} characters`);
      if (!isOneLine(value)) return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.secretNotOneLine, { detail: 'a secret is one line: it holds no line break' });
      const before = tickPlan(coord, item, secretAnswer({ setAt: deps.now(), tail: secretTailOf(value) }));
      if (!before.ok) return refuseRoute(reply, before.why, { detail: before.detail });
      const setAt = deps.now();
      let meta: OperatorSecretMeta;
      try {
        meta = await writeOperatorSecret(deps.ccrcDir, item.program, slot, value, setAt, deps.registerSecret, id);
      } catch (e) {
        if (e instanceof OperatorSecretStoredUnrecorded) return storedNotTicked(reply, id);
        if (e instanceof OperatorSecretNameCollides) {
          return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.secretNameCollides, {
            detail: 'the box already stores a secret under a programme or slot name that differs from this one only by case; nothing was stored',
          });
        }
        return refuseRoute(reply, 'write-failed', { detail: 'the secret could not be stored; nothing was sent to the coordinator' });
      }
      let ticked: ItemRow;
      try {
        const answer = secretAnswer({ setAt: meta.setAt, tail: meta.tail });
        const fresh = coord.itemById(id);
        if (fresh === null) return storedNotTicked(reply, id);
        const plan = tickPlan(coord, fresh, answer);
        if (!plan.ok) return storedNotTicked(reply, id);
        const res = tickNow(coord, id, answer, plan, setAt);
        if (!res.ok) return storedNotTicked(reply, id);
        ticked = res.item;
      } catch {
        return storedNotTicked(reply, id);
      }
      let view: ItemView;
      try {
        view = viewOfItem(coord, ticked, setAt, deps.presenceOf, secretOf);
      } catch {
        deps.bus.emit('waiting');
        return storedNotTicked(reply, id);
      }
      deps.bus.emit('waiting');
      return reply.code(200).send({ ok: true, secret: meta, item: view });
    }, () => slotBusy(reply));
  });

  /**
   * `GET /api/programmes/:slug/secrets` (the operator's ruling on programme item 9): the programme's stored secrets, by slot
   * name, with when each was saved and the item that asked for it (`StoredSecretsAnswer`). NAMES AND RECORDS ONLY: no part of
   * any value, no tail, no length. A store that could not be read is `secrets-unreadable`, never an answer with no slots; a
   * programme name that fails its shape is `bad-slot`, before any path is built. Session-gated, no box token, no step-up: it
   * reads no value.
   */
  app.get('/api/programmes/:slug/secrets', { onRequest: noStore }, (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const read = readStoredSecrets(deps.ccrcDir, slug);
    if (read.state === 'invalid') return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badSlot, { detail: 'that programme name is not one this server stores secrets under' });
    if (read.state === 'unreadable') {
      return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.secretsUnreadable, { detail: 'the stored secrets of this programme could not be read' });
    }
    const coord = deps.coord;
    const slots: StoredSecret[] = read.slots.map((s) => {
      const item = s.item === null || !coord ? null : coord.itemById(s.item);
      return { slot: s.slot, setAt: s.setAt, item: item !== null && item.program === slug ? { id: item.id, title: item.title } : null };
    });
    const answer: StoredSecretsAnswer = { ok: true, program: slug, slots };
    return reply.code(200).send(answer);
  });

  /**
   * `DELETE /api/programmes/:slug/secrets/:slot` (the operator's ruling on programme item 9): removes one stored secret. A
   * CREDENTIAL ACT, in the PUT's order: the account gate with a step-up FIRST, then both names re-checked (`bad-slot`), then,
   * on the slot's chain, the path built and the slot removed (`removeOperatorSecret`: the value file, its record, its leftover
   * temps). Then the masker retires the slot's lane (`retireSecret`): the removed value is still masked for the life of this
   * process, and its rows leave the table, so nothing reloads them after a restart, EXCEPT in two arms that keep them there
   * (review 1418 A2): a retire whose read of the lane's rows failed (they stay in the table, review 1416 A-S5), and a delete
   * still held on a busy coord.db when the process stops. Those rows reload after a restart and go on masking the removed
   * value (the safe side) until a save of the slot replaces them, unless a rotation came before the restart: then they match
   * nothing, because previous box tokens are memory-only (`accounts/mask.ts`'s module header, A ROTATION …; review 1440 F5), and only keep the re-key retrying
   * (review 1426 F-E). Nothing on disk is unmasked by it: the value file is gone. Nothing stored: `secret-not-stored` (the lane is retired all the same, so a
   * row left by a slot removed by hand stops being re-keyed, review 1391 A-2). A value file that cannot be removed:
   * `remove-failed`, and nothing else changes. Every answer is a fixed word with a fixed detail; none carries the value, which
   * this door never reads.
   */
  app.delete('/api/programmes/:slug/secrets/:slot', { onRequest: noStore }, async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const { slug, slot } = req.params as { slug: string; slot: string };
    if (!operatorSlotNamesValid(slug, slot)) {
      return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.badSlot, { detail: 'that programme or slot name is not one this server stores a secret under' });
    }
    return underSlot(programmeChainKey(slug), async () => {
      let done: 'removed' | 'none';
      try {
        done = await removeOperatorSecret(deps.ccrcDir, slug, slot);
      } catch {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.removeFailed, { detail: 'the stored secret could not be removed; nothing was changed' });
      }
      deps.retireSecret(operatorSecretLaneId(slug, slot));
      deps.bus.emit('waiting');
      if (done === 'none') return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.secretNotStored, { detail: `no secret is stored in ${slot}` });
      const answer: SecretRemoveAnswer = { ok: true, slot };
      return reply.code(200).send(answer);
    }, () => slotBusy(reply));
  });
}
