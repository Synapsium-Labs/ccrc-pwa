// Programme ledgers (plan PL3): the coordinator's routes for operator items and goals. L4 delivery, context
// Coordination: it parses a request, asks the store, and answers; every decision it relies on is somewhere else
// (`nextItemState` in `shared/ledgers.ts` decides a move, `claimsProgramme` decides ownership, `isSpecPath` and
// `isSlotSlug` decide shapes). The box-token routes of this file are LANES for `box-token-census.test.ts`, which reads
// this file as a lane source of its own beside `coord/routes.ts`, `update/routes.ts` and `token/routes.ts`: the routes
// are registered from `registerCoordRoutes`, but their handlers live here so `routes.ts` does not take another
// 400 lines (ARCH-01, `growth-check`).
//
// The OPERATOR'S routes (plan PL4) are in the same file, registered by `registerLedgerOperatorRoutes` from `server.ts`
// beside `/api/digest/correct`: session-gated only (they sit behind the auth gate when it is armed), no box token. One of them,
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
import { LEDGER_ROUTE_REFUSALS, type RouteRefusal } from '../../../shared/refusal.js';
import {
  ANSWER_MAX, ITEM_KINDS, ITEM_OPTIONS_MAX, ITEM_STEPS_MAX, ITEM_TEXT_MAX, ITEM_TITLE_MAX, NEEDED_BY_LEVELS, RECOMMEND_WHY_MAX, SECRET_VALUE_MAX,
  SOON_LABEL_MAX,
  isOneLine, isSecretValue, isSlotSlug, isSpecPath, itemIsStale, nextItemState, secretAnswer, secretTailOf, tickMailLeftBehind,
  type CoordinatorPresence, type ItemKind, type ItemView, type NeededBy, type SecretRemoveAnswer,
  type StoredSecret, type StoredSecretsAnswer, type WaitingView,
} from '../../../shared/ledgers.js';
import type { CoordStore, ItemEventRow, ItemRow } from './store.js';
import { itemMailSubject, tickMail } from './ledgersMail.js';
import { OUTSTANDING_DELIVERY_STATES } from '../../../shared/api.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { credentialBodyRoute, type AccountGate } from '../accounts/gate.js';
import {
  OperatorSecretStoredUnrecorded, operatorSecretLaneId, operatorSlotNamesValid, readOperatorSecretMeta, readStoredSecrets,
  removeOperatorSecret, sweepOperatorSecretTemps, writeOperatorSecret, type OperatorSecretMeta, type OperatorSecretState,
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

/** A slot's state (plan PL6): its metadata, `{setAt: null}` when it holds a value with no readable record (review 1416 F4), or
 *  `null` when it holds no value: `readOperatorSecretMeta` over the server's `ccrcDir`. */
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
    secretSlot: row.secretSlot,
    secretSet: secret === null ? null
      : secret.setAt === null ? { at: null }
        : { at: secret.setAt, tail: secret.tail, masked: secret.masked, ...(secret.why === undefined ? {} : { why: secret.why }) },
    history: events.map((e) => ({ at: e.at, act: e.act, note: e.note })),
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

/** What waits on the operator, whole: every programme's open and checking items, the Recently cleared trail, and goals for
 *  each programme that holds an item or a spec pin (slug order). The read route and the live frame both answer this. */
export function waitingViewOf(
  coord: CoordStore, now: number, presenceOf: (sessionId: string) => CoordinatorPresence, secretOf: SecretMetaOf = NO_SECRETS,
): WaitingView {
  const { open, cleared } = coord.itemsFor(null, now);
  const programmes = [...new Set([...open.map((i) => i.program), ...cleared.map((i) => i.program), ...coord.pinnedProgrammes()])].sort();
  return {
    items: open.map((r) => viewOfItem(coord, r, now, presenceOf, secretOf)),
    cleared: cleared.map((r) => viewOfItem(coord, r, now, presenceOf, secretOf)),
    goals: programmes.map((p) => coord.goalsFor(p)),
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
  const move = (coord: CoordStore, reply: FastifyReply, item: ItemRow, act: 'confirm' | 'return' | 'withdraw', note: string | null) => {
    const res = coord.moveItem(item.id, act, 'coordinator', act === 'return' ? { note } : {}, deps.now(), { programmeHasOpenRun: true });
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
    return move(coord, reply, item, 'withdraw', null);
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
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    coord.setSpecPin(slug, specPath, inShort, deps.now());
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
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return;
    if (!owns(coord, reply, who.byId, slug)) return;
    if (itemId !== null) {
      const item = coord.itemById(itemId);
      if (item === null) return refuseRoute(reply, 'unknown-item', { detail: `no item ${itemId}` });
      if (item.program !== slug) return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `item ${itemId} belongs to another programme` });
    }
    const id = coord.addModification(slug, { text: modText, ruling, itemId, pr }, deps.now());
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
    // The newest tick mail of this item, whoever it went to and whatever run it rode (review 1335 F2): one still outstanding
    // blocks a second, so a takeover cannot queue it twice either. Except one left behind (review 1336 F1): its recipient is
    // no longer the coordinator and reads dead or absent, so nothing will ever acknowledge it.
    const earlier = coord.newestTickMail(mail.subject);
    if (earlier !== null && OUTSTANDING_DELIVERY_STATES.includes(earlier.state)
      && !tickMailLeftBehind({ recipient: earlier.toId, coordinator, recipientPresence: deps.presenceOf(earlier.toId) })) {
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

  app.get('/api/programmes/:slug/goals', (req, reply) => {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    return reply.code(200).send({ ok: true, goals: coord.goalsFor((req.params as { slug: string }).slug) });
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
   * ONE SAVE OF A SLOT AT A TIME (review 1389 F2): everything after the gate runs on the slot's own chain (`underSlot`), so a
   * second save of the same slot starts only once the first has ticked, and then meets `not-open` before it writes anything.
   * The file, its metadata and the masker's row are always one save's. A Remove of the slot rides the same chain. An act that
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
  /** `Cache-Control: no-store` on every answer of the two stored-secret doors, refusals included, from `onRequest`: the hook
   *  the secret's PUT already takes (`credentialBodyRoute`, `accounts/gate.ts`), so no second spelling of it lives here. */
  const noStore = credentialBodyRoute(SECRET_BODY_LIMIT).onRequest;
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
    // The chain's key is the slot the item names; inside it every check is made again, on the item as it is then.
    return underSlot(`${first.program}\u0000${first.secretSlot ?? ''}`, async () => {
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
   * process and nothing reloads it after a restart. Nothing stored: `secret-not-stored` (the lane is retired all the same, so a
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
    return underSlot(`${slug}\u0000${slot}`, async () => {
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
