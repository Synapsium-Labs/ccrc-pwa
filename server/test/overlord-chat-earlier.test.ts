// The Overlord chat's earlier-generation door (Overlord W1, the chat, Task 3; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, questions 1, 2 and 12).
//
// FIRST, THE MEASUREMENT (Task 3 Step 1, a characterization case): on a fixture history store, through the Overlord's own read
// (`ccd/history/overlord-read.mjs` in its worker, as the agent runs it), which verb names a conversation's newest entries. The
// answer decides the arm the door builds: `paged`, or `not-pageable`. Every HOME is a fixture under the per-run temp root.
import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readOverlordHistoryAnswer } from '../../shared/overlordHistory.js';
import { makeHistoryBox, runSweep, seedFamily, REPO, type HistoryBox } from './historyHelpers.js';
import { userRow, assistantRow, type Row } from './historyFixtures.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Bus } from '../src/bus.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { endOverlordGeneration, type MintInput } from '../src/continuity/continuityStore.js';
import type { OverlordAuthorityJournal } from '../src/coord/overlordAuthorityJournal.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import type { ReadLine } from '../../shared/operatorMessages.js';
import type { OverlordHistoryRequest } from '../../shared/overlordHistory.js';
import { OVERLORD_HISTORY_OP } from '../../shared/agent-protocol.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { seedRoster } from './helpers.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { sourceFiles } from './consolidationCensus.js';
import { codeOnly } from './sourceScan.js';

removeTmpFixturesEachTest();

const HEAVY = 180_000;
const WORKER = path.join(REPO, 'ccd', 'history', 'overlord-worker.mjs');

const ID_A = 'lane-a-overlord';
const GA = '0189abcd-1234-4678-9abc-0123456789ab';
const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const rid = (t: string, n: number): string => `${t.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const iso = (k: number): string => new Date(T0 + k * 1000).toISOString();

/** `n` turns of neutral text: a user turn and an assistant reply each. */
function turns(t: string, n: number): Row[] {
  const rows: Row[] = [];
  const base = { sessionId: t, cwd: '/home/u/worktrees/p/quiet-basin' };
  for (let k = 1; k <= n; k += 1) {
    rows.push(userRow({ ...base, uuid: rid(t, 2 * k - 1), ts: iso(2 * k), text: `fixture question ${k}` }));
    rows.push(assistantRow({ ...base, uuid: rid(t, 2 * k), ts: iso(2 * k + 1), text: `Fixture answer ${k}.`, requestId: `req_${k}`, msgId: `msg_${k}` }));
  }
  return rows;
}

type Answer = Record<string, unknown> & { outcome: string };

/** overlord-worker.mjs in a file worker started as the agent starts it, inside a child process (overlord-read.test.ts' form). */
function read(box: HistoryBox, request: object): Answer {
  const runner = path.join(box.home, `runner-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(runner, [
    "import { Worker } from 'node:worker_threads';",
    `const w = new Worker(${JSON.stringify(WORKER)}, { workerData: { home: ${JSON.stringify(box.home)}, request: ${JSON.stringify(request)}, nowMs: Date.now() }, env: {}, stdout: true, stderr: true });`,
    "let answer = null;",
    "w.stdout.on('data', () => {}); w.stderr.on('data', () => {});",
    "w.on('message', (m) => { answer = m; });",
    "w.on('error', () => { answer = { outcome: 'worker-error' }; });",
    "w.on('exit', () => { process.stdout.write(JSON.stringify(answer)); });",
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--no-warnings', runner], { encoding: 'utf8', timeout: 120_000, env: box.env });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Answer;
}

describe('Task 3 Step 1: which verb pages one conversation (the characterization case)', () => {
  // MEASURED on this fixture: no read verb names a conversation's newest entries by its conversation id. `expand <conversation
  // id>` reads the id as an entry uuid and finds none (exit 3, no items); `describe` takes node ids only (`bad-args`). So the
  // door builds the `not-pageable` arm (question 2): every earlier divider reads "Read generation n in ccrc history", and a
  // first page is refused. `expand --around <entry>` does page one transcript, and its items carry `uuid`, `role`, `type`,
  // `ts_ms` and `text`, and NO conversation id: when paging joins (the history door's cursor), the ledger scope names the
  // `around` (step 7's second arm).
  it('a conversation id names no entry and no node; --around pages one transcript, and its items carry no conversation id', () => {
    const box = makeHistoryBox('ccrc-chat-earlier-measure-');
    seedFamily(box, { id: ID_A, project: 'project-a', uuid: TA, generation: GA, rows: turns(TA, 3) });
    expect(runSweep(box).code).toBe(0);
    const target = { kind: 'session', session: ID_A };
    const expanded = read(box, { verb: 'expand', target, agents: false, args: [TA] });
    expect([expanded.outcome, expanded['exit'], expanded['total']], 'expand of a conversation id finds nothing').toEqual(['rows', 3, 0]);
    const described = read(box, { verb: 'describe', target, agents: false, args: [TA] });
    expect([described.outcome, described['word']], 'describe takes a node id only').toEqual(['verb-refused', 'bad-args']);
    const around = read(box, { verb: 'expand', target, agents: false, args: ['--around', rid(TA, 6), '--before', '40', '--after', '0'] });
    expect(readOverlordHistoryAnswer(around), 'the wire reader accepts it').not.toBe('off-shape');
    expect([around.outcome, around['exit']]).toEqual(['rows', 0]);
    const items = around['items'] as Record<string, unknown>[];
    expect(items.map((i) => i['uuid']), 'the entries before it, and it, in file order').toEqual([1, 2, 3, 4, 5, 6].map((k) => rid(TA, k)));
    expect(items.map((i) => [i['role'], i['text']])).toEqual([
      ['user', 'fixture question 1'], ['assistant', 'Fixture answer 1.'], ['user', 'fixture question 2'],
      ['assistant', 'Fixture answer 2.'], ['user', 'fixture question 3'], ['assistant', 'Fixture answer 3.'],
    ]);
    for (const it of items) {
      expect(it['trust']).toBe('untrusted');
      expect(Object.values(it), 'no item field carries the conversation id').not.toContain(TA);
    }
  }, HEAVY);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The earlier-generation door, `GET /api/overlord/chat/earlier?term=<t>&n=<n>[&around=<uuid>]` (Task 3 Step 1's route cases).
// RED until the door exists: every route case below fails today on the missing route (404) and on nothing else; the census at the
// end is not tied to a live door and is green now. The imports sit here, with the cases they serve, so the measurement above stays
// exactly as it was. Fixture HOMEs only, neutral names, neutral text.
//
// THE HARNESS is `overlord-prompt-record.test.ts`'s `rig`, copied: the real server over a fixture HOME, a real `CoordStore` whose
// `designationRead` is spied, a real `OperatorModelStore` (privacy-journal double), the armed account gate and a real sign-in. The
// agent link is `deps.fleetState` (a connected agent advertising `overlord-history`, as `registerOverlordHistoryRoutes` is handed it
// in `buildServer`) and `deps.io.overlordHistory` is a fake that RECORDS every request it is asked to send.
//
// THE MEASURED ARM: `CHAT_EARLIER_PAGEABLE` is false (the first case above), so the door NEVER sends the history op: every case in
// this file asserts the fake saw zero requests. An earlier generation answers 400 `bad-request` `not-pageable`, the live one
// `current`, an unknown one `no-generation`, each past the ceiling with ONE read-ledger line (door `chat-history`, caller `operator`,
// count 0, the refusal's own word as the outcome, `not-a-session`, a null turn state).
//
// WHEN THE HISTORY DOOR GAINS ITS CURSOR (`CHAT_EARLIER_PAGEABLE` true), the paged arm's route cases join this file, through the
// same fake port and rig:
//   - a first page of generation (1, 1): the port receives `{ verb: 'expand', target: { kind: 'session', session: <the row's own
//     session> }, agents: false, args: [<the start's conversation id>] }`, the answer is `{ ok: true, gen, page }` with each item
//     still `trust: 'untrusted'`, and its line is `rows` with the item count;
//   - an older page by `around`: the port receives `args: ['--around', <uuid>, '--before', '40', '--after', '0']`, and the line's
//     scope names the `around` (the items carry no conversation id);
//   - the rebind: a generation of term 1 run by the old body is read in THAT session's family, whoever is designated;
//   - `history-unreachable`, each cause through the fake port: no connected agent advertising the op (`no-agent`), two
//     (`many-agents`), an older agent (`unsupported`), a frame that never left (`not-started`), a lost answer (`lost`), a wait that
//     expired (`timeout`): each answers 503 with its cause and STILL writes its line, never an empty page;
//   - `request-refused` maps to `bad-request`, `busy` and `deadline` are other 200s with their outcome word and no served line.
// The deciders' unit cases (`earlierPagePlan`, `earlierStep`, `earlierComposed`, `historyDoorAnswer`) are in
// `overlord-chat-compose.test.ts` already and cover each of these arms without a door.

vi.setConfig({ testTimeout: 90_000 });

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const LANE_A = 'lane-a-overlord';
const LANE_B = 'lane-b-overlord';
const BOX_TOKEN = 'box-token-fixture-0123456789';
const VIEW = {} as never;
const designated = (sessionId: string, term = 1): DesignationRead => ({ kind: 'designated', sessionId, term, row: VIEW });
const NOT_DESIGNATED: DesignationRead = { kind: 'not-designated', row: null };
const UNMEASURED: DesignationRead = { kind: 'unmeasured', why: 'fixture' };
const AROUND = '55555555-5555-4555-8555-555555555555';
const NOW = FAKE_T0;
const EARLIER = '/api/overlord/chat/earlier';

function issuerDouble(): PrivacyIssuer {
  const records: number[] = [];
  return { kind: 'ready', issue(storeHighest) { const id = Math.max(storeHighest ?? 0, records.at(-1) ?? 0) + 1; records.push(id); return { ok: true, id }; } };
}

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
  vi.restoreAllMocks();
});

interface EarlierRig { app: FastifyInstance; coord: CoordStore; store: OperatorModelStore; cookie: string; asked: OverlordHistoryRequest[] }
interface EarlierRigOpts { auth?: boolean; origin?: string; designation?: DesignationRead }

async function earlierRig(opts: EarlierRigOpts = {}): Promise<EarlierRig> {
  const home = mkTmp('ccrc-chat-earlier-');
  seedRoster(home);
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  const base = loadConfig({ CCRC_HOME: home });
  const cfg = { ...base, authEnabled: opts.auth ?? true, cookieSecure: false, ...(opts.origin === undefined ? {} : { origin: opts.origin }) };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  vi.spyOn(coord, 'designationRead').mockReturnValue(opts.designation ?? designated(LANE_A, 1));
  const store = new OperatorModelStore(openOperatorModelDb(defaultOperatorModelDbPath(home)), issuerDouble());
  const journal = { appendInTx: () => ({ ok: false, error: 'authority-unmeasured', detail: 'a fixture journal appends nothing' }) } as unknown as OverlordAuthorityJournal;
  const asked: OverlordHistoryRequest[] = [];
  const io: FleetIO = { ...localIO, overlordHistory: async (req) => { asked.push(req); return { kind: 'unsupported' }; } };
  const fleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: [OVERLORD_HISTORY_OP] } satisfies NonNullable<Deps['fleetState']>;
  const time = fakeTime();
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue(), time: time.ports, coord, mailToken: BOX_TOKEN,
    operatorModel: store, overlordAuthority: journal, fleetState };
  const app = await buildServer(deps, new Bus());
  await app.ready();
  apps.push(app);
  let cookie = '';
  if (cfg.authEnabled) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  return { app, coord, store, cookie, asked };
}

const getEarlier = (r: EarlierRig, qs: string) =>
  r.app.inject({ method: 'GET', url: qs === '' ? EARLIER : `${EARLIER}?${qs}`, headers: r.cookie === '' ? {} : { cookie: r.cookie } });

const earlierStoreDb = (s: OperatorModelStore): DatabaseSync => (s as never as { db: DatabaseSync }).db;
interface EarlierLedgerRow { door: string; caller: string; scope: string; count: number; outcome: string; generation: number | null; generationRead: string; turnState: string | null }
const earlierLedger = (r: EarlierRig): EarlierLedgerRow[] =>
  (earlierStoreDb(r.store).prepare('SELECT door, caller, scope, count, outcome, generation, generationRead, turnState FROM read_ledger ORDER BY id').all() as unknown as EarlierLedgerRow[])
    .map((x) => ({ ...x }));
const lineOf = (scope: string, outcome: string): EarlierLedgerRow =>
  ({ door: 'chat-history', caller: 'operator', scope, count: 0, outcome, generation: null, generationRead: 'not-a-session', turnState: null });

function earlierSeedLines(r: EarlierRig, n: number, over: Partial<ReadLine>): void {
  for (let i = 0; i < n; i += 1) {
    const w = r.store.recordRead({ at: NOW - 1_000, door: 'chat-history', caller: 'operator', scope: `session:${LANE_A}:term:1:gen:1`, count: 1, outcome: 'rows',
      generation: null, generationRead: 'not-a-session', turnState: null, ...over });
    if (!w.ok) throw new Error(`seed line ${i}: ${w.error} ${w.detail}`);
  }
}
const OVERLORD_SIDE: Partial<ReadLine> = { caller: 'overlord', generation: 1, generationRead: 'measured', turnState: 'done' };

interface EarlierGenSeed { sessionId: string; term: number; at: number }
let earlierReports = 0;
/** Generations of the identity `overlord` (`continuity-generations-of.test.ts`'s recipe): a mint in the same term ends the live row, a
 *  mint in a new term follows the previous body's retirement (a rebind). The last one is live. */
function seedEarlierGenerations(coord: CoordStore, seeds: readonly EarlierGenSeed[]): void {
  seeds.forEach((g, i) => {
    earlierReports += 1;
    const uuid = `${String((i % 9) + 1).repeat(8)}-2222-4222-8222-2222222${String(earlierReports).padStart(5, '0')}`;
    const start = coord.insertStart({ sessionId: g.sessionId, reportId: `r-${earlierReports}`, uuid, source: 'clear', model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: g.at, receivedAt: g.at });
    if (!start.ok) throw new Error('start not recorded');
    const live = coord.liveGenerationOfIdentity('overlord');
    if (!live.ok) throw new Error('live generation unreadable');
    const prev = i === 0 ? null : seeds[i - 1]!;
    let ended: Parameters<CoordStore['mintGeneration']>[1] = null;
    if (live.row !== null && prev !== null) {
      if (prev.term === g.term) ended = live.row;
      else tx(coord.db, () => { endOverlordGeneration(coord.db, prev.sessionId, g.at - 1); });
    }
    const input: MintInput = {
      identity: 'overlord', sessionId: g.sessionId, role: 'coordinator', term: g.term, rowIncarnation: null, startId: start.id, startReportedAt: g.at, resumed: false,
      model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: g.at,
    };
    const m = coord.mintGeneration(input, ended, true);
    if (!m.ok) throw new Error(`mint ${m.kind}`);
  });
}
/** Term 1 with two generations ((1,1) ended, (1,2) live), designated at term 1. */
const oneTerm = (r: EarlierRig): void => seedEarlierGenerations(r.coord, [{ sessionId: LANE_A, term: 1, at: NOW - 5_000 }, { sessionId: LANE_A, term: 1, at: NOW - 3_000 }]);
/** A rebind: term 1 run by LANE_A ((1,1) and (1,2) ended), term 2 run by LANE_B ((2,1) live); LANE_B is designated at term 2. */
const rebound = (r: EarlierRig): void => seedEarlierGenerations(r.coord, [
  { sessionId: LANE_A, term: 1, at: NOW - 8_000 }, { sessionId: LANE_A, term: 1, at: NOW - 6_000 }, { sessionId: LANE_B, term: 2, at: NOW - 4_000 },
]);

describe('GET /api/overlord/chat/earlier: the account gate, before any read', () => {
  it('sign-in off answers auth-off (501), a plain-HTTP origin insecure-origin (403), an unsigned caller unauthenticated (401); each writes no line and sends nothing to the history port', async () => {
    const off = await earlierRig({ auth: false });
    const a = await getEarlier(off, 'term=1&n=1');
    expect([a.statusCode, a.json().error]).toEqual([REFUSAL_STATUS['auth-off'], 'auth-off']);
    const insecure = await earlierRig({ origin: 'http://example.test' });
    const b = await getEarlier(insecure, 'term=1&n=1');
    expect([b.statusCode, b.json().error]).toEqual([REFUSAL_STATUS['insecure-origin'], 'insecure-origin']);
    const armed = await earlierRig();
    armed.cookie = '';
    const c = await getEarlier(armed, 'term=1&n=1');
    expect([c.statusCode, c.json().error]).toEqual([REFUSAL_STATUS['unauthenticated'], 'unauthenticated']);
    for (const r of [off, insecure, armed]) { expect(earlierLedger(r)).toEqual([]); expect(r.asked).toEqual([]); }
  });
});

describe('GET /api/overlord/chat/earlier: the query', () => {
  it('a query readChatEarlierQuery refuses (term=0, a missing n, around=x, a target, no query at all) answers bad-request (400) before any read: no line, no port call', async () => {
    const r = await earlierRig();
    oneTerm(r);
    const bad = [
      'term=0&n=1', 'term=1', 'n=1', 'term=1&n=0', 'term=1&n=1.5', 'term=-1&n=1', 'term=01&n=1', 'term=1&n=1&around=x',
      `term=1&n=1&around=${AROUND.toUpperCase()}`, `term=1&n=1&around=${AROUND}&around=${AROUND}`,
      `term=1&n=1&target=${LANE_B}`, `term=1&n=1&session=${LANE_B}`, '',
    ];
    for (const q of bad) {
      const res = await getEarlier(r, q);
      expect([res.statusCode, res.json().error], q).toEqual([REFUSAL_STATUS['bad-request'], 'bad-request']);
    }
    expect(earlierLedger(r)).toEqual([]);
    expect(r.asked).toEqual([]);
  });
});

describe('GET /api/overlord/chat/earlier: the designation', () => {
  it('an unreadable designation answers 502 unmeasured: no line, no port call', async () => {
    const r = await earlierRig({ designation: UNMEASURED });
    const res = await getEarlier(r, 'term=1&n=1');
    expect([res.statusCode, res.json().error]).toEqual([REFUSAL_STATUS['unmeasured'], 'unmeasured']);
    expect(earlierLedger(r)).toEqual([]);
    expect(r.asked).toEqual([]);
  });

  it('no designation has no generation to read: 400 bad-request with detail no-generation, no line, no port call', async () => {
    const r = await earlierRig({ designation: NOT_DESIGNATED });
    oneTerm(r);
    const res = await getEarlier(r, 'term=1&n=1');
    expect([res.statusCode, res.json().error, res.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'bad-request', 'no-generation']);
    expect(earlierLedger(r)).toEqual([]);
    expect(r.asked).toEqual([]);
  });
});

describe('GET /api/overlord/chat/earlier: the read ceiling (door chat-history, 240 an hour, the operator\'s lines only)', () => {
  it('240 served operator lines of door chat-history answer 429 read-ceiling with retryAfterS, send nothing to the port, and write the one ceiling line', async () => {
    const r = await earlierRig();
    oneTerm(r);
    earlierSeedLines(r, 240, {});
    const res = await getEarlier(r, 'term=1&n=1');
    expect([res.statusCode, res.json().error]).toEqual([REFUSAL_STATUS['read-ceiling'], 'read-ceiling']);
    expect(res.json().retryAfterS, 'the oldest line leaves the hour in 3599 s').toBe(3_599);
    expect(r.asked).toEqual([]);
    const lines = earlierLedger(r);
    expect(lines).toHaveLength(241);
    expect(lines.at(-1)).toEqual(lineOf('chat-history', 'read-ceiling'));
  });

  it('239 operator lines still serve (the boundary), and 240 lines of the Overlord on this door and 240 of the console on door chat do not move it', async () => {
    const r = await earlierRig();
    oneTerm(r);
    earlierSeedLines(r, 239, {});
    const edge = await getEarlier(r, 'term=1&n=1');
    expect([edge.statusCode, edge.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'not-pageable']);
    const other = await earlierRig();
    oneTerm(other);
    earlierSeedLines(other, 240, { ...OVERLORD_SIDE, scope: 'overlord-fixture' });
    earlierSeedLines(other, 240, { door: 'chat', scope: `session:${LANE_A}` });
    const res = await getEarlier(other, 'term=1&n=1');
    expect([res.statusCode, res.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'not-pageable']);
    expect(r.asked).toEqual([]);
    expect(other.asked).toEqual([]);
  });
});

describe('GET /api/overlord/chat/earlier: the measured arm (CHAT_EARLIER_PAGEABLE is false: the history port is never asked)', () => {
  it('an ended generation answers bad-request not-pageable and writes ONE line: door chat-history, caller operator, scope session:<its session>:term:1:gen:1, count 0, outcome not-pageable', async () => {
    const r = await earlierRig();
    oneTerm(r);
    const res = await getEarlier(r, 'term=1&n=1');
    expect([res.statusCode, res.json().error, res.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'bad-request', 'not-pageable']);
    expect(earlierLedger(r)).toEqual([lineOf(`session:${LANE_A}:term:1:gen:1`, 'not-pageable')]);
    expect(r.asked).toEqual([]);
  });

  it('the live generation answers bad-request current, with its own line', async () => {
    const r = await earlierRig();
    oneTerm(r);
    const res = await getEarlier(r, 'term=1&n=2');
    expect([res.statusCode, res.json().error, res.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'bad-request', 'current']);
    expect(earlierLedger(r)).toEqual([lineOf(`session:${LANE_A}:term:1:gen:2`, 'current')]);
    expect(r.asked).toEqual([]);
  });

  it('an unknown (term, n) answers bad-request no-generation; its line\'s scope names no session, only term:<t>:gen:<n>', async () => {
    const r = await earlierRig();
    oneTerm(r);
    for (const q of ['term=3&n=1', 'term=1&n=9']) {
      const res = await getEarlier(r, q);
      expect([res.statusCode, res.json().error, res.json().detail], q).toEqual([REFUSAL_STATUS['bad-request'], 'bad-request', 'no-generation']);
    }
    expect(earlierLedger(r)).toEqual([lineOf('term:3:gen:1', 'no-generation'), lineOf('term:1:gen:9', 'no-generation')]);
    expect(r.asked).toEqual([]);
  });

  it('a generation of term 1 run by the rebound body\'s old session names that session in its line, while the new body is designated; the new body\'s own generation is current', async () => {
    const r = await earlierRig({ designation: designated(LANE_B, 2) });
    rebound(r);
    const old = await getEarlier(r, 'term=1&n=1');
    expect([old.statusCode, old.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'not-pageable']);
    const live = await getEarlier(r, 'term=2&n=1');
    expect([live.statusCode, live.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'current']);
    expect(earlierLedger(r)).toEqual([
      lineOf(`session:${LANE_A}:term:1:gen:1`, 'not-pageable'),
      lineOf(`session:${LANE_B}:term:2:gen:1`, 'current'),
    ]);
    expect(r.asked, 'a query names no target, and the measured arm asks nobody').toEqual([]);
  });

  it('a query with around names it in the line\'s scope (the items carry no conversation id), and still asks nobody', async () => {
    const r = await earlierRig();
    oneTerm(r);
    const res = await getEarlier(r, `term=1&n=1&around=${AROUND}`);
    expect([res.statusCode, res.json().detail]).toEqual([REFUSAL_STATUS['bad-request'], 'not-pageable']);
    expect(earlierLedger(r)).toEqual([lineOf(`session:${LANE_A}:term:1:gen:1:around:${AROUND}`, 'not-pageable')]);
    expect(r.asked).toEqual([]);
  });

  it('generations that cannot be read answer 502 unmeasured with their own line (scope term:<t>:gen:<n>, outcome generations-unmeasured) and ask nobody', async () => {
    const r = await earlierRig();
    oneTerm(r);
    r.coord.db.exec("UPDATE continuity_generations SET term = 'x' WHERE n = 2");
    const res = await getEarlier(r, 'term=1&n=1');
    expect([res.statusCode, res.json().error]).toEqual([REFUSAL_STATUS['unmeasured'], 'unmeasured']);
    expect(earlierLedger(r)).toEqual([lineOf('term:1:gen:1', 'generations-unmeasured')]);
    expect(r.asked).toEqual([]);
  });
});

// ── the census: no second reader of the history store ──────────────────────────────────────────────────────────────────────

/** What in one file's CODE (comments dropped, string literals kept) opens the history store or runs `ccrc history`: a name of the store's
 *  file, an import of anything under `ccd/history/`, or a process spawn whose command line names `ccrc` and `history`. A label that only
 *  NAMES the command (`{ verb: 'ccrc history describe' }`, a console sentence) spawns nothing and is not one. */
const HISTORY_OPENERS: readonly (readonly [string, RegExp])[] = [
  ['names history.db', /history\.db\b/],
  ['imports from ccd/history/', /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"`][^'"`\n]*\bccd\/history\//],
  ['spawns ccrc history', /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\([^;]{0,240}?\bccrc\b[^;]{0,40}?\bhistory\b/],
];
const historyOpeningsOf = (text: string): string[] => {
  const code = codeOnly(text);
  return HISTORY_OPENERS.filter(([, re]) => re.test(code)).map(([why]) => why);
};
/** Every file under `server/src` and `pwa/src` of `root` with what it opens, `file: why`. */
function historyOpeningsUnder(root: string): string[] {
  const out: string[] = [];
  for (const dir of ['server/src', 'pwa/src']) {
    for (const f of sourceFiles(root, dir)) {
      for (const why of historyOpeningsOf(fs.readFileSync(f, 'utf8'))) out.push(`${path.relative(root, f).split(path.sep).join('/')}: ${why}`);
    }
  }
  return out;
}

describe('census: nothing in the server or the console reads the history store itself', () => {
  it('no file under server/src or pwa/src names history.db, imports from ccd/history/, or spawns a command line that holds ccrc history', () => {
    expect(historyOpeningsUnder(REPO)).toEqual([]);
  });

  it('the scanner bites: each way of opening the store is flagged, in a string it reads and in a planted tree; a label, a sentence and a comment are not', () => {
    expect(historyOpeningsOf("const db = new DatabaseSync(path.join(home, '.ccrc', 'history', 'history.db'));")).toEqual(['names history.db']);
    expect(historyOpeningsOf("import { openHistory } from '../../ccd/history/lib.mjs';")).toEqual(['imports from ccd/history/']);
    expect(historyOpeningsOf("const m = await import('../../../ccd/history/recall.mjs');")).toEqual(['imports from ccd/history/']);
    expect(historyOpeningsOf("const lib = require('../ccd/history/lib.mjs');")).toEqual(['imports from ccd/history/']);
    for (const spawned of [
      "spawn('ccrc', ['history', 'describe']);", "execFileSync('ccrc', ['history', 'expand', id]);", "exec('ccrc history describe');",
      'spawnSync(`ccrc history ${verb}`, { shell: true });',
    ]) expect(historyOpeningsOf(spawned), spawned).toEqual(['spawns ccrc history']);
    for (const benign of [
      "const CARD_HISTORY = { verb: 'ccrc history describe', node: null };", "return `Read generation ${n} in ccrc history`;",
      "// new DatabaseSync('history.db') is what a comment says", "/* spawn('ccrc history describe') */", "spawn('ccd', ['status']);",
    ]) expect(historyOpeningsOf(benign), benign).toEqual([]);
    // the same, on a tree: a planted file in each of the two roots is found by its path, and a clean file beside it is not
    const root = mkTmp('ccrc-chat-history-census-');
    fs.mkdirSync(path.join(root, 'server', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pwa', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server', 'src', 'planted.ts'), "export const open = () => spawn('ccrc', ['history', 'describe']);\n");
    fs.writeFileSync(path.join(root, 'pwa', 'src', 'planted.tsx'), "export const f = 'history.db';\n");
    fs.writeFileSync(path.join(root, 'server', 'src', 'clean.ts'), "export const label = { verb: 'ccrc history describe' };\n");
    expect(historyOpeningsUnder(root)).toEqual(['server/src/planted.ts: spawns ccrc history', 'pwa/src/planted.tsx: names history.db']);
  });
});
