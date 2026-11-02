// Programme ledgers (plan PL3): the coordinator's routes for operator items and goals. L4 delivery, context
// Coordination: it parses a request, asks the store, and answers; every decision it relies on is somewhere else
// (`nextItemState` in `shared/ledgers.ts` decides a move, `claimsProgramme` decides ownership, `isSpecPath` and
// `isSlotSlug` decide shapes). The box-token routes of this file are LANES for `box-token-census.test.ts`, which reads
// this file as a lane source of its own beside `coord/routes.ts`, `update/routes.ts` and `token/routes.ts`: the routes
// are registered from `registerCoordRoutes`, but their handlers live here so `routes.ts` does not take another
// 400 lines (ARCH-01, `growth-check`).
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
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import {
  ITEM_KINDS, ITEM_OPTIONS_MAX, ITEM_STEPS_MAX, ITEM_TEXT_MAX, ITEM_TITLE_MAX, NEEDED_BY_LEVELS, SOON_LABEL_MAX,
  isSlotSlug, isSpecPath, type ItemKind, type ItemView, type NeededBy,
} from '../../../shared/ledgers.js';
import type { CoordStore, ItemEventRow, ItemRow } from './store.js';

/** What the coordinator routes need. `requireMailToken` and `requireAttribution` are `registerCoordRoutes`'s own closures,
 *  handed in rather than rebuilt, so the gate and the sender check are one implementation for every lane. */
export interface LedgerCoordinatorDeps {
  coord: CoordStore | undefined;
  requireMailToken: (req: FastifyRequest, reply: FastifyReply, route: string) => boolean;
  requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  notice: NoticeSink;
  bus: Bus;
  now: () => number;
}

/** A reason for `ruling` on a modification: the programme ledger's entry id or a short pointer, never prose. */
const RULING_MAX = 600;
/** The coordinator's note when it sends an item back (spec §3.3). */
const RETURN_NOTE_MAX = 600;
/** The sentence of one In short copy (spec §4). */
const IN_SHORT_MAX = 1200;

/** One item as the console reads it. `stale` is `false` until PL4 computes it; `secretSet` is `null` until PL6 stores one. */
export function itemViewOf(row: ItemRow, events: readonly ItemEventRow[]): ItemView {
  return {
    id: row.id, program: row.program, runId: row.runId, kind: row.kind, title: row.title, why: row.why, how: row.how,
    options: row.options, neededBy: row.neededBy, soonLabel: row.soonLabel, state: row.state, stale: false,
    raisedAt: row.raisedAt, tickedAt: row.tickedAt, closedAt: row.closedAt, answer: row.answer, note: row.note,
    secretSlot: row.secretSlot, secretSet: null,
    history: events.map((e) => ({ at: e.at, act: e.act, note: e.note })),
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
  return { ok: true, v: { runId, kind, title, why, how: how as string[], options, neededBy, soonLabel, secretSlot } };
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
    deps.notice({ kind: 'coord', sessionId: '', runId: item.runId, title: 'Waiting on you', body: item.title }, 'push',
      { tag: `item-${item.id}` });
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
    return reply.code(200).send({ ok: true, items: [...open, ...cleared].map((r) => itemViewOf(r, coord.itemHistory(r.id))) });
  });

  // ── one item: confirm, send back, withdraw, and the blocking switch ─────────────────────────────────────────────────

  /** The shared head of the four item routes below (each has checked the token): the id, the body's identity, attribution, the item, and the
   *  item's OWN programme's ownership. Returns the item and the caller, or null with the refusal sent. */
  const itemHead = async (req: FastifyRequest, reply: FastifyReply, coord: CoordStore):
    Promise<{ item: ItemRow; byId: string; body: Body } | null> => {
    const rawId = (req.params as { id: string }).id;
    const id = /^[1-9][0-9]{0,15}$/.test(rawId) ? Number(rawId) : null;
    const body = req.body ?? {};
    const who = identityOf(body);
    if (id === null) { bad(reply, 'the item id is a positive integer'); return null; }
    if (who === null) { bad(reply, 'byId and byUuid are required strings'); return null; }
    if (!(await deps.requireAttribution(reply, who.byId, who.byUuid, 'byUuid'))) return null;
    const item = coord.itemById(id);
    if (item === null) { refuseRoute(reply, 'unknown-item', { detail: `no item ${id}` }); return null; }
    if (!owns(coord, reply, who.byId, item.program)) return null;
    return { item, byId: who.byId, body: body as Body };
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
    const head = await itemHead(req, reply, coord);
    if (head === null) return;
    return move(coord, reply, head.item, 'confirm', null);
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
    const head = await itemHead(req, reply, coord);
    if (head === null) return;
    return move(coord, reply, head.item, 'return', note);
  });

  app.post('/api/items/:id/withdraw', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/items/:id/withdraw')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const head = await itemHead(req, reply, coord);
    if (head === null) return;
    return move(coord, reply, head.item, 'withdraw', null);
  });

  app.post('/api/items/:id/blocking', async (req, reply) => {
    if (!deps.requireMailToken(req, reply, 'POST /api/items/:id/blocking')) return;
    const coord = deps.coord;
    if (!coord) return notConfigured(reply);
    const flag = isObject(req.body) ? req.body['blocking'] : undefined;
    if (isObject(req.body) && typeof flag !== 'boolean') return bad(reply, 'blocking is true or false');
    const head = await itemHead(req, reply, coord);
    if (head === null) return;
    const blocking = flag === true;
    const res = coord.setBlocking(head.item.id, blocking, deps.now());
    if (!res.ok) return refuseRoute(reply, res.why, { detail: `item ${head.item.id} is closed` });
    // The store decides, inside its transaction, whether the level moved; the push and the emit follow its answer.
    if (res.changed) {
      if (blocking) pushBlocking(head.item);
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
