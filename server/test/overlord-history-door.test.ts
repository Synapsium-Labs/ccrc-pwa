// Overlord W1, PR B1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md` Task 5; spec §3.2, C47, H3,
// H10): the history door, `POST /api/overlord/history`. Its two deciders (`coord/overlordHistory.ts`), the port's remote
// adapter (`remote/io.ts#createIo`'s `overlordHistory`) through a fake client, and the door through the REAL gate runner over
// a fixture `coord.db`, the REAL read runner and a real `OperatorModelStore` on a fixture file, with a fake port. Fixture
// names only; no agent, no history store and no live HOME is touched.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import * as deciders from '../src/coord/overlordHistory.js';
import type { HistoryLink, OverlordHistoryAsked } from '../src/coord/overlordHistory.js';
import { HISTORY_ROWS as ROWS, historyAgentForCases, historyDoorAnswerCases } from './sim/overlordHistoryDoorSets.js';
import { OVERLORD_HISTORY_BODY_LIMIT_BYTES, registerOverlordHistoryRoutes } from '../src/coord/overlordHistoryRoutes.js';
import { runOverlordRead } from '../src/coord/overlordRead.js';
import { CoordStore } from '../src/coord/store.js';
import { SecretMasker } from '../src/accounts/mask.js';
import { RUN_MIN_BYTES } from '../src/accounts/shapes.js';
import { localIO, type FleetIO } from '../src/io.js';
import { createIo, OVERLORD_HISTORY_REQUEST_TIMEOUT_MS } from '../src/remote/io.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/errors.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { answerMasked, WRITE_ANSWER_EXEMPT } from '../src/server.js';
import { OVERLORD_HISTORY_DEADLINE_MS } from '../../agent/src/historyOp.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { ACT_COUNTER_HEADER, ACT_GENERATION_HEADER, ACT_KEY_HEADER, WITNESS_KEY_HEADER } from '../../shared/continuity-door.js';
import { OVERLORD_HISTORY_OP } from '../../shared/agent-protocol.js';
import { SCOPE_FAMILIES_JSON_MAX } from '../../ccd/history/lib.mjs';
import { SECRET_MASK_TOO_LARGE } from '../../shared/api.js';
import type { ReadTurnState } from '../../shared/operatorMessages.js';
import {
  OVERLORD_HISTORY_ANSWER_MAX_BYTES, OVERLORD_HISTORY_REQUEST_MAX_BYTES, type OverlordHistoryAnswer, type OverlordHistoryRequest, readOverlordHistoryRequest,
  readOverlordHistoryAnswer, OVERLORD_HISTORY_SCOPE_FAMILIES_MAX,
} from '../../shared/overlordHistory.js';
import { READ_CEILINGS } from '../../shared/overlordInbox.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'a'.repeat(64);
const BODY = 'lane-a-overlord';            // the Overlord's session id
const OTHER = 'lane-b-project-a';          // any other session
const INC = 'inc-1';
const DESIGNATED = (): DesignationRead => ({
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term: 1, designatedTerm: 1 },
}) as unknown as DesignationRead;
const issuer = (): PrivacyIssuer => {
  let last = 0;
  return { kind: 'ready', issue: (high) => { last = Math.max(high ?? 0, last) + 1; return { ok: true, id: last }; } };
};

const SCOPE = ROWS.scope;
const answer = (a: OverlordHistoryAnswer): OverlordHistoryAsked => ({ kind: 'answer', answer: a });

// ── the deciders: their cases are written once, in `sim/overlordHistoryDoorSets.ts`, and the mutation floors run them too ──
describe('historyAgentFor: the one connected link that advertises overlord-history', () => {
  for (const [name, run] of Object.entries(historyAgentForCases(deciders))) it(name, run);
});

describe('historyDoorAnswer: every outcome of a history read has one home (Table 2)', () => {
  for (const [name, run] of Object.entries(historyDoorAnswerCases(deciders))) it(name, run);
  it('the 503 is the word history-unreachable\'s own status, and the 400 bad-request\'s', () => {
    expect(REFUSAL_STATUS['history-unreachable']).toBe(503);
    expect(REFUSAL_STATUS['bad-request']).toBe(400);
  });
});

// ── the port's remote adapter ───────────────────────────────────────────────────────────────────────────────────────
describe("the server's reader of the agent's answer bounds the whole answer (review 3730 F7)", () => {
  const fam = (i: number) => ({ ccrc_id: `lane-a-project-${i}`, generation: `g-${i}`, first_seen_ms: i });
  it("the scope's families are capped at lib's own cap (the scope counts the rest), a hand copy checked here", () => {
    expect(OVERLORD_HISTORY_SCOPE_FAMILIES_MAX).toBe(SCOPE_FAMILIES_JSON_MAX);
    const families = (n: number) => ({ ...ROWS, scope: { ...ROWS.scope, families: Array.from({ length: n }, (_, i) => fam(i)), families_total: n } });
    expect(readOverlordHistoryAnswer(families(OVERLORD_HISTORY_SCOPE_FAMILIES_MAX))).not.toBe('off-shape');
    expect(readOverlordHistoryAnswer(families(OVERLORD_HISTORY_SCOPE_FAMILIES_MAX + 1))).toBe('off-shape');
  });
  it("the scope's project is bounded like its id", () => {
    expect(readOverlordHistoryAnswer({ ...ROWS, scope: { ...ROWS.scope, project: 'p'.repeat(512) } })).not.toBe('off-shape');
    expect(readOverlordHistoryAnswer({ ...ROWS, scope: { ...ROWS.scope, project: 'p'.repeat(513) } })).toBe('off-shape');
  });
  it('items within their own bound are still off-shape when the whole answer is past it', () => {
    const shell = Buffer.byteLength(JSON.stringify([{ trust: 'untrusted', text: '' }]));
    const items = [{ trust: 'untrusted' as const, text: 'x'.repeat(OVERLORD_HISTORY_ANSWER_MAX_BYTES - shell) }];
    expect(Buffer.byteLength(JSON.stringify(items))).toBe(OVERLORD_HISTORY_ANSWER_MAX_BYTES);
    expect(readOverlordHistoryAnswer({ ...ROWS, items })).toBe('off-shape');
    const fits = [{ trust: 'untrusted' as const, text: 'x'.repeat(OVERLORD_HISTORY_ANSWER_MAX_BYTES - 2_000) }];
    expect(readOverlordHistoryAnswer({ ...ROWS, items: fits })).not.toBe('off-shape');
  });
});

describe('createIo(client).overlordHistory: the port half of Table 2', () => {
  const REQ: OverlordHistoryRequest = { verb: 'search', target: { kind: 'all' }, agents: false, args: ['deploy'] };
  const fake = (onReq: (f: Record<string, unknown>, ms?: number, signal?: AbortSignal) => Promise<unknown>, ops: string[] | 'no-ready' = [OVERLORD_HISTORY_OP]) => {
    const frames: Array<{ f: Record<string, unknown>; ms?: number }> = [];
    const client = {
      state: ops === 'no-ready' ? {} : { agentOps: ops },
      request: async (f: Record<string, unknown>, ms?: number, signal?: AbortSignal) => { frames.push({ f, ms }); return onReq(f, ms, signal); },
    };
    return { io: createIo(client as never), frames };
  };

  it.each([
    ['an agent bad-request (it predates the op)', 'unsupported', () => Promise.reject(new AgentOpError('bad-request', null))],
    ['LinkNotSentError (the frame never left)', 'not-started', () => Promise.reject(new LinkNotSentError('disconnected'))],
    ["the client's own new Error('timeout')", 'timeout', () => Promise.reject(new Error('timeout'))],
    ["the agent's own AgentOpError timeout", 'lost', () => Promise.reject(new AgentOpError('timeout', null))],
    ['an abort after the send', 'lost', () => Promise.reject(new Error('aborted'))],
    ['a dropped link after the send', 'lost', () => Promise.reject(new Error('disconnected'))],
    ['an off-shape reply', 'lost', () => Promise.resolve({ t: 'res', id: 1, ok: true, outcome: 'rows', items: 'not a list' })],
    ['a reply in no outcome at all', 'lost', () => Promise.resolve({ t: 'res', id: 1, ok: true })],
  ] as const)('%s reads %s', async (_n, kind, onReq) => {
    const f = fake(onReq);
    expect(await f.io.overlordHistory(REQ)).toEqual({ kind });
    expect(f.frames).toHaveLength(1);
  });

  it('a reply on the grammar reads as the agent\'s answer, and the frame carries the request\'s fields beside the op word', async () => {
    const f = fake(async () => ({ t: 'res', id: 1, ok: true, ...ROWS }));
    expect(await f.io.overlordHistory(REQ)).toEqual({ kind: 'answer', answer: ROWS });
    expect(f.frames[0]!.f).toEqual({ t: 'req', op: OVERLORD_HISTORY_OP, ...REQ });
    expect(f.frames[0]!.ms).toBe(OVERLORD_HISTORY_REQUEST_TIMEOUT_MS);
  });

  it('an agent whose ready frame does not name the op (or no ready yet) is unsupported, and nothing is sent', async () => {
    for (const ops of [['disk'], [], 'no-ready'] as const) {
      const f = fake(async () => { throw new Error('never asked'); }, ops === 'no-ready' ? ops : [...ops]);
      expect(await f.io.overlordHistory(REQ)).toEqual({ kind: 'unsupported' });
      expect(f.frames).toEqual([]);
    }
  });

  it('the signal reaches the client, and the bare localIO answers unsupported', async () => {
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    const f = fake(async (_f, _ms, signal) => { seen = signal; return { t: 'res', id: 1, ok: true, outcome: 'busy' }; });
    expect(await f.io.overlordHistory(REQ, ac.signal)).toEqual({ kind: 'answer', answer: { outcome: 'busy' } });
    expect(seen).toBe(ac.signal);
    expect(await localIO.overlordHistory(REQ)).toEqual({ kind: 'unsupported' });
  });

  it("the server's wait is above the agent's deadline and below ccrc-api's curl -m 30", () => {
    expect(OVERLORD_HISTORY_REQUEST_TIMEOUT_MS).toBeGreaterThan(OVERLORD_HISTORY_DEADLINE_MS);
    expect(OVERLORD_HISTORY_REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
  });
});

// ── the door ────────────────────────────────────────────────────────────────────────────────────────────────────────
let s: CoordStore;
let seq = 0;
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-history-door-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const apps: FastifyInstance[] = [];
const dbs: DatabaseSync[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  await Promise.all(apps.splice(0).map((a) => a.close()));
  s.db.exec('DELETE FROM overlord_fence_refusals');
});

/** Mint the Overlord identity's next generation with its own act key (as the inbox routes' test does). */
function fresh(): { gen: GenRow; key: string } {
  seq += 1;
  const key = createHash('sha256').update(`key-${seq}`).digest('hex');
  const r0 = s.insertStart({ sessionId: BODY, reportId: `rr-${seq}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: NOW + seq, receivedAt: NOW + seq, doorNonceSha256: null });
  if (!r0.ok) throw new Error('start not recorded');
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((g) => g.identity === 'overlord');
  const mint: MintInput = { identity: 'overlord', sessionId: BODY, role: 'coordinator', term: 1, rowIncarnation: null, startId: r0.id,
    startReportedAt: NOW + seq, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000 + seq,
    proc: `p${seq}`, now: NOW };
  const m = s.mintGeneration(mint, old === undefined ? null : genExpectOf(old), true);
  if (!m.ok) throw new Error('not minted');
  s.db.prepare("UPDATE continuity_generations SET state = 'active', deadlineAt = NULL WHERE id = ?").run(m.id);
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  const gen = after.rows.find((g) => g.id === m.id)!;
  const issued = issueActKey(s.db, { generationId: gen.id, nonceSha256: createHash('sha256').update(`n-${seq}`).digest('hex'),
    keySha256: createHash('sha256').update(key, 'utf8').digest('hex'), issuedAt: NOW });
  if (!issued.ok) throw new Error('key not issued');
  return { gen, key };
}

interface Rig {
  app: FastifyInstance; gen: GenRow;
  /** The requests the port was asked, in order. */
  asked: OverlordHistoryRequest[];
  act: () => Record<string, string>;
  lines: () => Record<string, unknown>[];
}
interface RigOpts {
  words?: readonly string[];
  links?: readonly HistoryLink[];
  port?: (req: OverlordHistoryRequest) => Promise<OverlordHistoryAsked>;
  /** The whole port, for local mode. */
  io?: Pick<FleetIO, 'overlordHistory'>;
  turn?: () => Promise<ReadTurnState>;
  /** Gate facts to replace (a refusal driven through the real gate). */
  gate?: Partial<OverlordGateDeps>;
  /** Run after the real gate answers, before the handler goes on (a caller that leaves during the gate). */
  afterGate?: (reply: FastifyReply) => void;
}
const gateOf = (g: ReturnType<typeof overlordGateRun>, after?: (reply: FastifyReply) => void): ReturnType<typeof overlordGateRun> =>
  after === undefined ? g : (async (req, reply, key, who) => { const v = await g(req, reply, key, who); after(reply); return v; }) as ReturnType<typeof overlordGateRun>;
const AGENT: HistoryLink = { connected: true, agentOps: [OVERLORD_HISTORY_OP] };
async function rig(o: RigOpts = {}): Promise<Rig> {
  const { gen, key } = fresh();
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-history-door-store-')));
  dbs.push(db);
  const store = new OperatorModelStore(db, issuer());
  const gateDeps: OverlordGateDeps = {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: INC }) as never,
    },
    designation: DESIGNATED,
    authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }),
    generations: () => s.liveGenerations(),
    continuityLive: () => true,
    cardRead: () => ({ ok: true, read: { current: true } as never }),
    actKey: (g, k) => actKeyFact(s.db, g, k),
    counter: (g, c) => advanceCounterGuarded(s.db, g, c),
    witness: () => ({ kind: 'witnessed', witnessId: 7 }),
    recordWitness: () => true,
    recordFenceRefusal: (r) => { recordFenceRefusal(s.db, r); },
    serverWords: () => o.words ?? ['overlord-v1'],
    now: () => NOW,
    ...o.gate,
  };
  const asked: OverlordHistoryRequest[] = [];
  const port = o.port ?? (async () => answer(ROWS));
  const io: Pick<FleetIO, 'overlordHistory'> = o.io ?? { overlordHistory: async (req) => { asked.push(req); return port(req); } };
  const app = Fastify({ logger: false });
  apps.push(app);
  registerOverlordHistoryRoutes(app, {
    mailToken: () => TOKEN, gate: gateOf(overlordGateRun(gateDeps), o.afterGate),
    readRunner: runOverlordRead({ ledger: store, turn: o.turn ?? (async () => 'done'), now: () => NOW }),
    links: () => o.links ?? [AGENT], io,
  });
  await app.ready();
  let counter = 0;
  return {
    app, gen, asked,
    act: () => { counter += 1; return { [ACT_KEY_HEADER]: key, [ACT_GENERATION_HEADER]: String(gen.n), [ACT_COUNTER_HEADER]: String(counter), [WITNESS_KEY_HEADER]: 'w-1' }; },
    lines: () => db.prepare('SELECT door, caller, scope, count, outcome, generation, generationRead, turnState FROM read_ledger ORDER BY id').all() as never,
  };
}

const HEADERS = { 'x-ccrc-mail-token': TOKEN };
const SEARCH = { verb: 'search', target: { kind: 'all' }, args: ['deploy'] };
const history = (r: Rig, payload: unknown = SEARCH, who = BODY, headers: Record<string, string> = r.act()): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: '/api/overlord/history', headers: { ...HEADERS, ...headers },
    payload: typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? { byId: who, byUuid: 'u-1', ...payload } : payload as never });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const line = (gen: GenRow, scope: string, count: number, outcome: string, turnState = 'done') =>
  ({ door: 'history', caller: 'overlord', scope, count, outcome, generation: gen.n, generationRead: 'measured', turnState });

describe('the door: the token, the pair, then the gate, before anything is read', () => {
  it('a call with no box token, or a wrong one, is 401 and no agent is asked', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'POST', url: '/api/overlord/history', headers: r.act(), payload: { byId: BODY, byUuid: 'u-1', ...SEARCH } })).statusCode)
      .toBe(REFUSAL_STATUS.unauthenticated);
    expect((await history(r, SEARCH, BODY, { 'x-ccrc-mail-token': 'b'.repeat(64), ...r.act() })).statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    expect(r.asked).toEqual([]);
  });

  it('a caller that is not the designated session gets not-the-overlord before any agent is asked, and no line', async () => {
    const r = await rig();
    const res = await history(r, SEARCH, OTHER);
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-the-overlord']);
    expect(json(res)).toMatchObject({ ok: false, error: 'not-the-overlord' });
    // …and a request the reader would refuse still reads not-the-overlord: the grammar is read only past the gate
    expect((await history(r, { ...SEARCH, regex: true }, OTHER)).statusCode).toBe(REFUSAL_STATUS['not-the-overlord']);
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('without the overlord-v1 word the door answers capability-missing, and no agent is asked', async () => {
    const r = await rig({ words: ['continuity-v1'] });
    const res = await history(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['capability-missing']);
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  // Board B2, call 1590 (slug history-and-board-reads-attributed-not-proven): the history row is not a write, so the door runs no
  // fence: the designated id with no act key is served, attributed to the Overlord and not proven its own (a reader's read
  // through the door process's read tool carries none), and its line is a served line the ceiling counts.
  it('the designated id without the act key is served: the row is not fenced, so the read is attributed, not proven', async () => {
    const r = await rig();
    const res = await history(r, SEARCH, BODY, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(r.asked).toHaveLength(1);
    expect(r.lines()).toHaveLength(1);
  });

  // The plan's other gate refusals, driven through the real gate on this route's own wiring (review 3730 F8).
  it.each([
    ['card-unread', 'an unread card', (): RigOpts => ({ gate: { cardRead: () => ({ ok: true, read: null }) } })],
    ['overlord-off', "the operator's rung off", (): RigOpts => ({ gate: { ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'off', binding: [], readBy: [] } }) as never } })],
  ] as const)('%s (%s) is refused before any agent is asked, and no line', async (word, _what, opts) => {
    const r = await rig(opts());
    const res = await history(r);
    expect([res.statusCode, json(res)['error']], res.body).toEqual([REFUSAL_STATUS[word], word]);
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('renewing (the generation draining) is refused before any agent is asked, and no line', async () => {
    const r = await rig();
    s.db.prepare("UPDATE continuity_generations SET state = 'draining' WHERE id = ?").run(r.gen.id);
    const res = await history(r);
    expect([res.statusCode, json(res)['error']], res.body).toEqual([REFUSAL_STATUS.renewing, 'renewing']);
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('a caller that goes away during the gate starts no read: no agent is asked, no line, no ceiling (review 3730 F4)', async () => {
    let handlerDone!: () => void;
    const settled = new Promise<void>((res) => { handlerDone = res; });
    const r = await rig({ afterGate: (reply) => { reply.raw.emit('close'); reply.raw.once('finish', () => handlerDone()); setTimeout(handlerDone, 2_000); } });
    // The test client reads a closed response as destroyed; the handler goes on, and what it does next is measured.
    await expect(history(r)).rejects.toThrow(/destroyed/);
    await settled;
    await new Promise((res) => setTimeout(res, 50));
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('a missing caller pair is 400 bad-request before the gate', async () => {
    const r = await rig();
    const res = await r.app.inject({ method: 'POST', url: '/api/overlord/history', headers: { ...HEADERS, ...r.act() }, payload: SEARCH });
    expect(res.statusCode).toBe(400);
    expect(r.asked).toEqual([]);
  });
});

describe('the door: the request', () => {
  it.each([
    ['regex as a key', { ...SEARCH, regex: true }, 'regex'],
    ['--regex as an argument', { ...SEARCH, args: ['--regex', 'x'] }, 'regex'],
    ['a scope argument', { ...SEARCH, args: ['--project', 'project-a'] }, 'bad-args'],
    ['an unknown verb', { ...SEARCH, verb: 'apply' }, 'bad-verb'],
    ['no target', { verb: 'search', args: ['x'] }, 'bad-target'],
    ['a bad project name', { ...SEARCH, target: { kind: 'project', project: '../x' } }, 'bad-project'],
  ])('%s answers bad-request 400 with its word before any agent is asked, and no line', async (_n, payload, refusal) => {
    const r = await rig();
    const res = await history(r, payload);
    expect(res.statusCode, res.body).toBe(400);
    expect(json(res)).toEqual({ ok: false, error: 'bad-request', refusal });
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('a request past its own bound is bad-request 400 oversize; a body past the route bound is oversize 413', async () => {
    const r = await rig();
    const big = { ...SEARCH, args: [...Array.from({ length: 8 }, () => 'x'.repeat(1000)), 'x'.repeat(300)] };
    expect(Buffer.byteLength(JSON.stringify({ byId: BODY, byUuid: 'u-1', ...big }))).toBeLessThan(OVERLORD_HISTORY_BODY_LIMIT_BYTES);
    const over = await history(r, big);
    expect(over.statusCode, over.body).toBe(400);
    expect(json(over)).toMatchObject({ error: 'bad-request', refusal: 'oversize' });
    const huge = await history(r, { ...SEARCH, pad: 'x'.repeat(OVERLORD_HISTORY_BODY_LIMIT_BYTES) });
    expect(huge.statusCode, huge.body).toBe(413);
    expect(json(huge)).toEqual({ ok: false, error: 'oversize' });
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  // Nine arguments (one past 1024 characters would be bad-args), filled so the TYPED request (agents and args present) is
  // exactly `bytes` long: the form the agent reads, since the server sends the typed request.
  const atBound = (bytes: number) => {
    const empty = Buffer.byteLength(JSON.stringify({ verb: 'search', target: { kind: 'all' }, agents: false, args: Array.from({ length: 9 }, () => '') }));
    const room = bytes - empty;
    return { verb: 'search', target: { kind: 'all' }, agents: false, args: Array.from({ length: 9 }, (_, i) => 'y'.repeat(Math.floor(room / 9) + (i < room % 9 ? 1 : 0))) };
  };

  it('a request at its bound with the longest pair the shape check takes still reaches the agent, and the agent reads what the port is handed alike', async () => {
    const r = await rig();
    const parts = atBound(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(parts))).toBe(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
    const res = await r.app.inject({ method: 'POST', url: '/api/overlord/history', headers: { ...HEADERS, ...r.act() },
      payload: { ...parts, byId: BODY, byUuid: 'u'.repeat(128) } });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(r.asked).toHaveLength(1);
    // What the port is handed is what the server sends; the agent's own validator (the same reader) passes it at its bound.
    expect(Buffer.byteLength(JSON.stringify(r.asked[0]))).toBe(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
    expect(readOverlordHistoryRequest(r.asked[0])).toEqual({ ok: true, request: parts });
  });

  it('a request that leaves agents out is measured as typed, so the door refuses what the agent would (review 3730 F2)', async () => {
    const r = await rig();
    // The typed request is one byte past its bound; the body as sent, without `"agents":false,`, is under it.
    const { agents: _a, ...sent } = atBound(OVERLORD_HISTORY_REQUEST_MAX_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(sent))).toBeLessThan(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
    expect(readOverlordHistoryRequest({ ...sent, agents: false }), 'the agent').toEqual({ ok: false, refusal: 'oversize' });
    const res = await history(r, sent);
    expect(res.statusCode, res.body).toBe(400);
    expect(json(res)).toEqual({ ok: false, error: 'bad-request', refusal: 'oversize' });
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
    // At the bound, the same request without agents passes, and the port is handed its typed form.
    const { agents: _b, ...ok } = atBound(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
    expect((await history(r, ok)).statusCode).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(r.asked[0]))).toBe(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
  });

  it('the port is handed the request the reader read, without the caller pair; a project name holding a dot travels whole', async () => {
    const r = await rig();
    const res = await history(r, { verb: 'describe', target: { kind: 'project', project: 'project-a.v2' }, agents: true, args: ['n-1'], extra: 'ignored' });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.asked).toEqual([{ verb: 'describe', target: { kind: 'project', project: 'project-a.v2' }, agents: true, args: ['n-1'] }]);
    expect(r.lines()).toEqual([line(r.gen, 'project:project-a.v2', 1, 'rows')]);
  });
});

describe('the door: every outcome, its answer, and its one line', () => {
  it.each([
    ['unsupported', { kind: 'unsupported' }],
    ['not-started', { kind: 'not-started' }],
    ['lost', { kind: 'lost' }],
    ['timeout', { kind: 'timeout' }],
  ] as const)('the port\'s %s answers history-unreachable 503 with that cause, and writes its line', async (cause, asked) => {
    const r = await rig({ port: async () => asked });
    const res = await history(r);
    expect(res.statusCode).toBe(503);
    expect(json(res)).toEqual({ ok: false, error: 'history-unreachable', cause });
    expect(r.asked).toHaveLength(1);
    expect(r.lines()).toEqual([line(r.gen, 'all', 0, cause)]);
  });

  it('no advertising link (none connected, or a link without the word) answers no-agent, two answer many-agents; the port is never asked', async () => {
    for (const [links, cause] of [
      [[], 'no-agent'], [[{ connected: true, agentOps: ['disk'] }], 'no-agent'], [[{ connected: false, agentOps: [OVERLORD_HISTORY_OP] }], 'no-agent'],
      [[AGENT, AGENT], 'many-agents'],
    ] as const) {
      const r = await rig({ links });
      const res = await history(r);
      expect(res.statusCode).toBe(503);
      expect(json(res)).toEqual({ ok: false, error: 'history-unreachable', cause });
      expect(r.asked).toEqual([]);
      expect(r.lines()).toEqual([line(r.gen, 'all', 0, cause)]);
    }
  });

  it('agent rows answer 200 with exit, items, shown, total and scope, and a counted rows line', async () => {
    const r = await rig();
    const res = await history(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, ...ROWS });
    expect(r.lines()).toEqual([line(r.gen, 'all', 1, 'rows')]);
  });

  it.each([
    [{ outcome: 'verb-refused', word: 'not-indexed' }],
    [{ outcome: 'store-refused', word: 'no-store' }],
    [{ outcome: 'busy' }],
    [{ outcome: 'deadline' }],
    [{ outcome: 'too-large', bytes: 70_000 }],
    [{ outcome: 'failed', word: 'internal' }],
  ] as const)('agent %o answers 200 with the outcome, and a line with its outcome word', async (a) => {
    const r = await rig({ port: async () => answer(a as OverlordHistoryAnswer) });
    const res = await history(r, { verb: 'search', target: { kind: 'session', session: 'lane-a-project-a' }, args: ['x'] });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, ...a });
    expect(r.lines()).toEqual([line(r.gen, 'session:lane-a-project-a', 0, a.outcome)]);
  });

  it('the agent\'s request-refused answers bad-request 400 with its word, and a request-refused line', async () => {
    const r = await rig({ port: async () => answer({ outcome: 'request-refused', word: 'separator' }) });
    const res = await history(r);
    expect(res.statusCode).toBe(400);
    expect(json(res)).toEqual({ ok: false, error: 'bad-request', refusal: 'separator' });
    expect(r.lines()).toEqual([line(r.gen, 'all', 0, 'request-refused')]);
  });

  it('an absent turn marker writes absent, an unmeasurable one unmeasured, and a reader that throws unmeasured', async () => {
    for (const [turn, want] of [
      [async () => 'absent' as const, 'absent'], [async () => 'unmeasured' as const, 'unmeasured'], [async () => { throw new Error('gone'); }, 'unmeasured'],
    ] as const) {
      const r = await rig({ turn });
      expect((await history(r)).statusCode).toBe(200);
      expect(r.lines()).toEqual([line(r.gen, 'all', 1, 'rows', want)]);
    }
  });
});

describe('the door: the read ceiling counts served lines only (ruled R8)', () => {
  it('sixty-one busy answers in an hour leave the next rows read served', async () => {
    let busy = true;
    const r = await rig({ port: async () => (busy ? answer({ outcome: 'busy' }) : answer(ROWS)) });
    for (let i = 0; i < READ_CEILINGS.history.perHour + 1; i += 1) expect((await history(r)).statusCode).toBe(200);
    busy = false;
    const res = await history(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ outcome: 'rows' });
  });

  it('a rows read past the ceiling gets read-ceiling with retryAfterS, and no agent is asked', async () => {
    const r = await rig();
    for (let i = 0; i < READ_CEILINGS.history.perHour; i += 1) expect((await history(r)).statusCode).toBe(200);
    const asked = r.asked.length;
    const res = await history(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    expect(json(res)).toMatchObject({ ok: false, error: 'read-ceiling', retryAfterS: expect.any(Number) });
    expect(r.asked.length).toBe(asked);
  });
});

describe('local mode and an agent built from main', () => {
  it("a door on local mode's fleet state (no agent ops) answers no-agent, and localIO records no call", async () => {
    const calls: unknown[] = [];
    const io: Pick<FleetIO, 'overlordHistory'> = { overlordHistory: async (req, signal) => { calls.push(req); return localIO.overlordHistory(req, signal); } };
    const r = await rig({ io, links: [{ connected: true }] });
    const res = await history(r);
    expect(res.statusCode).toBe(503);
    expect(json(res)).toEqual({ ok: false, error: 'history-unreachable', cause: 'no-agent' });
    expect(calls).toEqual([]);
  });

  it("an agent from main without the word (a ready frame naming other ops) answers no-agent, and no op is sent", async () => {
    const frames: unknown[] = [];
    const client = { state: { connected: true, agentOps: ['disk', 'backup'] }, request: async (f: unknown) => { frames.push(f); throw new Error('never'); } };
    const r = await rig({ io: createIo(client as never), links: [client.state] });
    const res = await history(r);
    expect(json(res)).toEqual({ ok: false, error: 'history-unreachable', cause: 'no-agent' });
    expect(frames).toEqual([]);
  });
});

describe('the masker (question 14)', () => {
  it('the POST answer is masked by the write-answer rule: the path is not exempt', () => {
    expect(WRITE_ANSWER_EXEMPT.test('/api/overlord/history')).toBe(false);
    expect(answerMasked('POST', '/api/overlord/history')).toBe(true);
  });

  it("a row holding a secret the store's belt never recorded is masked by the server's masker", async () => {
    const SECRET = 'Zq7'.repeat(12);
    const db = openCoordDb(path.join(mkTmp('ccrc-history-door-mask-'), '.ccrc', 'coord.db'));
    dbs.push(db);
    const masker = new SecretMasker({ db, token: () => TOKEN, log: () => {} });
    expect(masker.ingestSecret('lane-a', SECRET)).toBe('masked');
    const leaky: OverlordHistoryAnswer = { ...ROWS, items: [{ trust: 'untrusted', text: `the key was ${SECRET} in project-a` }] };
    const r = await rig({ port: async () => answer(leaky) });
    const res = await history(r);
    expect(res.body).toContain(SECRET);   // the control: the fake port's text carries it, and only the masker hides it
    const masked = JSON.stringify(masker.maskDeep(JSON.parse(res.body)));
    expect(masked).not.toContain(SECRET);
    expect(masked).toContain('project-a');
  });

  it('the densest answer the agent may send stays within the per-frame budget: no fail-closed cut', () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-history-door-budget-'), '.ccrc', 'coord.db'));
    dbs.push(db);
    const masker = new SecretMasker({ db, token: () => TOKEN, log: () => {} });
    // A secret at the floor length, so every run of that length is a candidate the masker must hash.
    masker.ingestSecret('lane-a', 'K'.repeat(RUN_MIN_BYTES));
    const run = (i: number): string => `r${String(i).padStart(RUN_MIN_BYTES - 1, '0')}`;
    const items: { trust: 'untrusted'; text: string }[] = [];
    let bytes = 0;
    for (let n = 0; ; n += 1) {
      const text = Array.from({ length: 40 }, (_, j) => run(n * 40 + j)).join(' ');
      items.push({ trust: 'untrusted', text });
      bytes = Buffer.byteLength(JSON.stringify(items));
      if (bytes > OVERLORD_HISTORY_ANSWER_MAX_BYTES) { items.pop(); break; }
    }
    expect(items.length * 40).toBeGreaterThan(2500);   // the page is dense: thousands of candidate runs
    const body = { ok: true, outcome: 'rows', exit: 0, items, shown: items.length, total: items.length, scope: SCOPE };
    expect(Buffer.byteLength(JSON.stringify(items))).toBeLessThanOrEqual(OVERLORD_HISTORY_ANSWER_MAX_BYTES);
    expect(JSON.stringify(masker.maskDeep(body))).not.toContain(SECRET_MASK_TOO_LARGE);
  });
});
