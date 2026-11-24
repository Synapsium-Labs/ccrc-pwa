// Overlord W1, PR B1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md` Task 5; spec §3.2, C47, H3,
// H10): the history door, `POST /api/overlord/history`. Its two deciders (`coord/overlordHistory.ts`), the port's remote
// adapter (`remote/io.ts#createIo`'s `overlordHistory`) through a fake client, and the door through the REAL gate runner over
// a fixture `coord.db`, the REAL read runner and a real `OperatorModelStore` on a fixture file, with a fake port. Fixture
// names only; no agent, no history store and no live HOME is touched.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import {
  HISTORY_UNREACHABLE_CAUSES, historyAgentFor, historyDoorAnswer, type HistoryLink, type HistoryReadOutcome, type OverlordHistoryAsked,
} from '../src/coord/overlordHistory.js';
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
import { SECRET_MASK_TOO_LARGE } from '../../shared/api.js';
import type { ReadTurnState } from '../../shared/operatorMessages.js';
import {
  OVERLORD_HISTORY_ANSWER_MAX_BYTES, OVERLORD_HISTORY_REQUEST_MAX_BYTES, type OverlordHistoryAnswer, type OverlordHistoryRequest,
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

const SCOPE = { kind: 'overlord', id: 'all', project: null, families: [], families_total: 0, transcripts: 0 } as const;
const ROWS: OverlordHistoryAnswer = { outcome: 'rows', exit: 0, items: [{ trust: 'untrusted', text: 'TEXT-MARKER in project-a' }], shown: 1, total: 1, scope: SCOPE };
const answer = (a: OverlordHistoryAnswer): OverlordHistoryAsked => ({ kind: 'answer', answer: a });

// ── the choice ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('historyAgentFor: the one connected link that advertises overlord-history', () => {
  const up = (ops?: string[]): HistoryLink => ({ connected: true, ...(ops === undefined ? {} : { agentOps: ops }) });
  it('zero links give no-agent', () => { expect(historyAgentFor([])).toEqual({ kind: 'no-agent' }); });
  it('one connected link without the word gives no-agent (no ops at all, too)', () => {
    expect(historyAgentFor([up(['disk'])])).toEqual({ kind: 'no-agent' });
    expect(historyAgentFor([up()])).toEqual({ kind: 'no-agent' });
  });
  it('one connected link with it gives that link', () => {
    const l = up(['disk', OVERLORD_HISTORY_OP]);
    expect(historyAgentFor([l])).toEqual({ kind: 'agent', link: l });
  });
  it('a disconnected link with the word gives no-agent (the link keeps its ops across a drop)', () => {
    expect(historyAgentFor([{ connected: false, agentOps: [OVERLORD_HISTORY_OP] }])).toEqual({ kind: 'no-agent' });
  });
  it('two connected links with it give many-agents', () => {
    expect(historyAgentFor([up([OVERLORD_HISTORY_OP]), up([OVERLORD_HISTORY_OP])])).toEqual({ kind: 'many-agents' });
  });
  it('two connected links where one has it give that one, wherever it stands', () => {
    const l = up([OVERLORD_HISTORY_OP]);
    expect(historyAgentFor([up(['disk']), l])).toEqual({ kind: 'agent', link: l });
    expect(historyAgentFor([l, up(['disk'])])).toEqual({ kind: 'agent', link: l });
    expect(historyAgentFor([{ connected: false, agentOps: [OVERLORD_HISTORY_OP] }, l])).toEqual({ kind: 'agent', link: l });
  });
});

// ── the mapping (Table 2) ───────────────────────────────────────────────────────────────────────────────────────────
describe('historyDoorAnswer: every outcome of a history read has one home (Table 2)', () => {
  const unreachable = (cause: string) => ({ kind: 'refuse', status: 503, word: 'history-unreachable', outcome: cause, extra: { cause } });
  const rows: [string, HistoryReadOutcome, unknown][] = [
    ['no connected link advertises', { kind: 'no-agent' }, unreachable('no-agent')],
    ['two or more', { kind: 'many-agents' }, unreachable('many-agents')],
    ['unsupported', { kind: 'unsupported' }, unreachable('unsupported')],
    ['not-started', { kind: 'not-started' }, unreachable('not-started')],
    ['lost', { kind: 'lost' }, unreachable('lost')],
    ['timeout (the client\'s own)', { kind: 'timeout' }, unreachable('timeout')],
    ['agent rows', answer(ROWS), { kind: 'rows', status: 200, body: { ok: true, ...ROWS }, count: 1 }],
    ['agent verb-refused', answer({ outcome: 'verb-refused', word: 'not-indexed' }),
      { kind: 'answer', status: 200, body: { ok: true, outcome: 'verb-refused', word: 'not-indexed' }, outcome: 'verb-refused' }],
    ['agent store-refused', answer({ outcome: 'store-refused', word: 'store-absent' }),
      { kind: 'answer', status: 200, body: { ok: true, outcome: 'store-refused', word: 'store-absent' }, outcome: 'store-refused' }],
    ['agent request-refused', answer({ outcome: 'request-refused', word: 'regex' }),
      { kind: 'refuse', status: 400, word: 'bad-request', outcome: 'request-refused', extra: { refusal: 'regex' } }],
    ['agent busy', answer({ outcome: 'busy' }), { kind: 'answer', status: 200, body: { ok: true, outcome: 'busy' }, outcome: 'busy' }],
    ['agent deadline', answer({ outcome: 'deadline' }), { kind: 'answer', status: 200, body: { ok: true, outcome: 'deadline' }, outcome: 'deadline' }],
    ['agent too-large', answer({ outcome: 'too-large', bytes: 70_000 }),
      { kind: 'answer', status: 200, body: { ok: true, outcome: 'too-large', bytes: 70_000 }, outcome: 'too-large' }],
    ['agent failed', answer({ outcome: 'failed', word: 'internal' }),
      { kind: 'answer', status: 200, body: { ok: true, outcome: 'failed', word: 'internal' }, outcome: 'failed' }],
  ];
  it.each(rows)('%s', (_n, o, want) => { expect(historyDoorAnswer(o)).toEqual(want); });

  it('the 503 is the word history-unreachable\'s own status, and every cause is a row above', () => {
    expect(REFUSAL_STATUS['history-unreachable']).toBe(503);
    expect(REFUSAL_STATUS['bad-request']).toBe(400);
    const causes = rows.map(([, , w]) => (w as { extra?: { cause?: string } }).extra?.cause).filter((c) => c !== undefined);
    expect([...causes].sort()).toEqual([...HISTORY_UNREACHABLE_CAUSES].sort());
  });
});

// ── the port's remote adapter ───────────────────────────────────────────────────────────────────────────────────────
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
}
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
  };
  const asked: OverlordHistoryRequest[] = [];
  const port = o.port ?? (async () => answer(ROWS));
  const io: Pick<FleetIO, 'overlordHistory'> = o.io ?? { overlordHistory: async (req) => { asked.push(req); return port(req); } };
  const app = Fastify({ logger: false });
  apps.push(app);
  registerOverlordHistoryRoutes(app, {
    mailToken: () => TOKEN, gate: overlordGateRun(gateDeps),
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

  it('the designated id without the act key is refused stale-generation, and no agent is asked', async () => {
    const r = await rig();
    expect((await history(r, SEARCH, BODY, {})).statusCode).toBe(REFUSAL_STATUS['stale-generation']);
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

  it('a request past its own bound is bad-request 400 oversize; a body past the route bound is bad-request 413', async () => {
    const r = await rig();
    const big = { ...SEARCH, args: [...Array.from({ length: 8 }, () => 'x'.repeat(1000)), 'x'.repeat(300)] };
    expect(Buffer.byteLength(JSON.stringify({ byId: BODY, byUuid: 'u-1', ...big }))).toBeLessThan(OVERLORD_HISTORY_BODY_LIMIT_BYTES);
    const over = await history(r, big);
    expect(over.statusCode, over.body).toBe(400);
    expect(json(over)).toMatchObject({ error: 'bad-request', refusal: 'oversize' });
    const huge = await history(r, { ...SEARCH, pad: 'x'.repeat(OVERLORD_HISTORY_BODY_LIMIT_BYTES) });
    expect(huge.statusCode, huge.body).toBe(413);
    expect(json(huge)).toEqual({ ok: false, error: 'bad-request', refusal: 'oversize' });
    expect(r.asked).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('a request at its bound with the longest pair the shape check takes still reaches the agent: the pair is outside the request\'s bound', async () => {
    const r = await rig();
    // nine arguments (one past 1024 characters would be bad-args), filled so the request is exactly at its bound
    const empty = Buffer.byteLength(JSON.stringify({ verb: 'search', target: { kind: 'all' }, args: Array.from({ length: 9 }, () => '') }));
    const room = OVERLORD_HISTORY_REQUEST_MAX_BYTES - empty;
    const args = Array.from({ length: 9 }, (_, i) => 'y'.repeat(Math.floor(room / 9) + (i < room % 9 ? 1 : 0)));
    const parts = { verb: 'search', target: { kind: 'all' }, args };
    expect(Buffer.byteLength(JSON.stringify(parts))).toBe(OVERLORD_HISTORY_REQUEST_MAX_BYTES);
    const res = await r.app.inject({ method: 'POST', url: '/api/overlord/history', headers: { ...HEADERS, ...r.act() },
      payload: { ...parts, byId: BODY, byUuid: 'u'.repeat(128) } });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(r.asked).toHaveLength(1);
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
