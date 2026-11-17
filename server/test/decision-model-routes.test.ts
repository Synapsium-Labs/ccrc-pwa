// Overlord W2, decision model B, Task 7: the operator's doors (`server/src/coord/decisionModelRoutes.ts`, six doors on five
// paths) over a Fastify app with a real `coord.db`, a real authority journal and guard in a fixture directory, a fake account
// gate (records each call's ask, can refuse `auth-off` and `step-up-required`), a fake resolver, a fixture ccrc dir for the
// key slot and a notice spy. Never the live HOME. Fixture keys only.
//
// THE STEP-UP IS THE COORDINATOR'S RULING (spec 7.5, `decisionLines.ts#decisionStepUp`): a widening asks it, a narrowing
// never does. So `shadow` to off passes without it and an armed gate's off asks it (the plan's "shadow to off asks too" is
// reversed).
//
// THE KEY NEVER LEAVES: every response body and every notice body of every case is searched for the key's text and its last
// four characters.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountGate, AccountGateAsk } from '../src/accounts/gate.js';
import { refuseRoute } from '../src/refuse.js';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME } from '../src/coord/overlordAuthority.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import { registerDecisionModelRoutes } from '../src/coord/decisionModelRoutes.js';
import {
  admitDecisionLine, decisionArmingStore, decisionAskStore, decisionHostRead, decisionRowRead, decisionRowSideOf, moveDecisionRowInTx, recordCanary,
  setDecisionHostInTx,
} from '../src/coord/decisionModelStore.js';
import { gatherDecisions } from '../src/coord/decisionModelAsk.js';
import { planDecision } from '../src/coord/decisionModel.js';
import { decisionRowDirection } from '../src/coord/decisionLines.js';
import { readServerSecretMeta, readServerSecretValue, writeServerSecret, type RegisterSecret } from '../src/coord/ledgersSecrets.js';
import { readDecisionModelKey } from '../src/coord/decisionModelHttp.js';
import type { DecisionModel } from '../src/coord/decisionModelPort.js';
import type { NoticeRecord, NoticeSink } from '../src/notice.js';
import {
  DECISION_MODEL_KEY_SLOT, DECISION_QUESTIONS, readDecisionModelView, type DecisionHostKind, type DecisionRowId, type DecisionRowSide,
} from '../../shared/decisionModel.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const T0 = Date.parse('2026-11-16T10:00:00.000Z');
const KEY = 'fixture-key-0123456789abcdef-not-real';
const KEY2 = 'fixture-key-fedcba9876543210-not-real';
const LOCAL = { kind: 'local' as const, endpoint: 'http://127.0.0.1:9000/v1', origin: 'http://127.0.0.1:9000', modelId: 'model-a' };
const HOSTED_ENDPOINT = 'https://api.example.test/v1';
const OFF: DecisionRowSide = { mode: 'off', ceiling: 600, armedLine: null, held: false };
const side = (o: Partial<DecisionRowSide> = {}): DecisionRowSide => ({ ...OFF, ...o });
const GATE: DecisionRowId = 'scope.widens';
const ADVICE: DecisionRowId = 'relay.method';
const PRIVATE_ADVICE: DecisionRowId = 'readback.omits';

afterEach(() => removeTmpFixtures());

let template: Buffer;
beforeAll(() => {
  const file = path.join(mkTmp('ccrc-decision-routes-template-'), 'coord.db');
  openCoordDb(file).close();
  template = readFileSync(file);
});

interface GateState { auth: 'on' | 'off'; stepUp: 'fresh' | 'stale'; calls: AccountGateAsk[] }
interface Rig {
  app: FastifyInstance; db: DatabaseSync; dir: string; ccrcDir: string; journal: OverlordAuthorityJournal; guard: OverlordAuthorityGuard;
  gate: GateState; bodies: string[]; notices: NoticeRecord[]; registered: string[]; resolves: Map<string, string[]>;
  lines(): { kind: string; row: string; gate: boolean; from: DecisionRowSide; to: DecisionRowSide }[];
  call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  /** One store move in its own `tx()` (the planting of a state, never a door). */
  move(row: DecisionRowId, expected: DecisionRowSide, to: DecisionRowSide, heldCause?: 'drift' | 'canary' | 'line-key' | 'no-key' | null): void;
  host(h?: { kind: DecisionHostKind; endpoint: string; origin: string; modelId: string }, keySetAt?: number | null): void;
  key(value?: string, bound?: string): Promise<void>;
  /** A line under `host` for `row`, with its canary asked and crossed. Answers its id. */
  line(row: DecisionRowId, o?: { asked?: number; crossed?: number; line?: number }): number;
  /** A gate armed on a held canary line under the local host, key set. Answers the line's id. */
  armedGate(): number;
  json(res: LightMyRequestResponse): Record<string, unknown>;
}

let n = 0;
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

async function rig(): Promise<Rig> {
  const dir = mkTmp('ccrc-decision-routes-');
  const ccrcDir = path.join(dir, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'coord.db'), template);
  const db = openCoordDb(path.join(ccrcDir, 'coord.db'));
  const leaf = path.join(ccrcDir, OVERLORD_AUTHORITY_BASENAME);
  const time = fakeTime({ wallMs: T0 }).ports;
  let journal!: OverlordAuthorityJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) });
  journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(ccrcDir), { clock: time.clock }, guard);
  guard.bootVerdict(journal.measure(db));

  const gate: GateState = { auth: 'on', stepUp: 'fresh', calls: [] };
  const account: AccountGate = (req, reply, ask) => {
    gate.calls.push(ask);
    if (gate.auth === 'off') { void refuseRoute(reply, 'auth-off'); return { pass: false }; }
    if (ask.stepUp === true && gate.stepUp === 'stale') { void refuseRoute(reply, 'step-up-required'); return { pass: false }; }
    return { pass: true, actor: { label: 'device-a', idHash8: '00000000', toString: () => 'device-a 00000000' }, sessionIdHash: 'h' };
  };
  const notices: NoticeRecord[] = [];
  const notice: NoticeSink = (event) => { notices.push(event); return { archived: true } as never; };
  const registered: string[] = [];
  const registerSecret: RegisterSecret = (_lane, value) => { registered.push(value); return 'masked'; };
  const resolves = new Map<string, string[]>([['api.example.test', ['203.0.113.10']]]);
  const app = Fastify({ logger: false });
  apps.push(app);
  registerDecisionModelRoutes(app, {
    store: () => decisionArmingStore(db, journal), ccrcDir, gate: account, time, notice, actorOf: () => 'device-a', registerSecret,
    resolve: async (h) => resolves.get(h) ?? [h], slotWaitMs: 2000,
  });
  await app.ready();
  const bodies: string[] = [];
  const r: Rig = {
    app, db, dir, ccrcDir, journal, guard, gate, bodies, notices, registered, resolves,
    lines: () => (existsSync(leaf) ? readFileSync(leaf, 'utf8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as { entry: never }).entry) : []),
    call: async (method, url, payload) => {
      const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
      bodies.push(res.body);
      return res;
    },
    move: (row, expected, to, heldCause = null) => {
      const m = tx(db, () => moveDecisionRowInTx(db, journal, { row, expected, to, heldCause, actor: 'device-a', at: T0, opKey: `op-${++n}` }));
      if (!m.ok) throw new Error(`plant refused: ${JSON.stringify(m)}`);
    },
    host: (h = LOCAL, keySetAt = T0) => { tx(db, () => setDecisionHostInTx(db, { ...h, keySetAt }, 'device-a', T0)); },
    key: async (value = KEY, bound = LOCAL.origin) => { await writeServerSecret(ccrcDir, DECISION_MODEL_KEY_SLOT, value, T0, registerSecret, { tail: 'none', bound }); },
    line: (row, o = {}) => {
      const q = DECISION_QUESTIONS[row];
      const id = admitDecisionLine(db, { row, revision: q.revision, hostKind: LOCAL.kind, origin: LOCAL.origin, modelId: LOCAL.modelId,
        line: o.line ?? 0.9, labelled: 100, errors: 0, bound: 0.02, canaryExpected: 295, baseline: [], admittedAt: T0 });
      recordCanary(db, id, o.asked ?? 295, o.crossed ?? 0);
      return id;
    },
    armedGate: () => {
      r.host();
      const id = r.line(GATE);
      r.move(GATE, OFF, side({ mode: 'shadow' }));
      r.move(GATE, side({ mode: 'shadow' }), side({ mode: 'armed', armedLine: { id, line: 0.9 } }));
      return id;
    },
    json: (res) => JSON.parse(res.body) as Record<string, unknown>,
  };
  await r.key();
  return r;
}

let r: Rig;
beforeEach(async () => { r = await rig(); });
afterEach(() => {
  // The headline of the suite: nothing any door said carries the key or its last four characters.
  for (const secret of [KEY, KEY.slice(-4), KEY2]) {
    r.bodies.forEach((b, i) => expect(b.includes(secret), `response #${i} holds the key`).toBe(false));
    r.notices.forEach((x, i) => expect(JSON.stringify(x).includes(secret), `notice #${i} holds the key`).toBe(false));
  }
  if (r.db.isOpen) r.db.close();
});

const arm = (id: string, body: unknown) => r.call('POST', `/api/decision-model/rows/${id}/arm`, body);
const off = (id: string, body: unknown) => r.call('POST', `/api/decision-model/rows/${id}/off`, body);
const ceiling = (id: string, body: unknown) => r.call('POST', `/api/decision-model/rows/${id}/ceiling`, body);
const putKey = (body: unknown) => r.call('PUT', '/api/decision-model/key', body);
const delKey = () => r.call('DELETE', '/api/decision-model/key');
const rowCount = (): number => (r.db.prepare('SELECT COUNT(*) AS c FROM decision_rows').get() as { c: number }).c;
const stateOf = (row: DecisionRowId) => {
  const s = decisionRowRead(r.db, row);
  if (s.kind !== 'row') throw new Error('unreadable');
  return s.state;
};
const LOCAL_BODY = { kind: 'local', endpoint: LOCAL.endpoint, modelId: LOCAL.modelId };
const OTHER = { endpoint: 'http://127.0.0.1:9001/v1', origin: 'http://127.0.0.1:9001' };
const OTHER_BODY = { kind: 'local', endpoint: OTHER.endpoint, modelId: LOCAL.modelId };
/** The `.server` directory of the key's slot: a mode that is not private makes every write and removal of the slot refuse. */
const serverDir = (): string => path.join(r.ccrcDir, 'operator-secrets', '.server');
const hostOrigin = (): string | null => { const h = decisionHostRead(r.db); return h.kind === 'host' ? h.host.origin : null; };
/** Plants a `decision_rows` row no reader accepts (an unknown held cause), so the door's transaction throws at its holds. It is the
 *  FIRST row `holdRows` visits, so no hold has been journalled when it throws. */
const plantUnreadableRow = (row: DecisionRowId = 'programme.pick'): void => {
  r.db.prepare(`INSERT INTO decision_rows (row, mode, ceiling, armedLineId, armedLineValue, heldCause, heldAt, updatedAt, actor)
    VALUES (?, 'shadow', 600, NULL, NULL, 'not-a-cause', NULL, ?, 'device-a')`).run(row, T0);
};

describe('sign-in dark: every write refuses auth-off, and writes nothing', () => {
  it('all five writes', async () => {
    r.gate.auth = 'off';
    r.host();
    const answers = [
      await arm(ADVICE, { mode: 'shadow', expected: OFF }),
      await off(ADVICE, { expected: OFF }),
      await ceiling(ADVICE, { ceiling: 300, expected: OFF }),
      await putKey({ ...LOCAL_BODY, key: KEY2 }),
      await delKey(),
    ];
    for (const a of answers) {
      expect(a.statusCode).toBe(501);
      expect(r.json(a)).toMatchObject({ ok: false, error: 'auth-off' });
    }
    expect(rowCount()).toBe(0);
    expect(r.lines()).toEqual([]);
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toEqual({ state: 'value', value: KEY });
    expect(r.notices).toEqual([]);
  });
});

describe('the step-up: a widening asks it, a narrowing never does', () => {
  beforeEach(() => { r.gate.stepUp = 'stale'; });
  const nobodyAsked = (): void => expect(r.gate.calls.filter((c) => c.stepUp === true)).toEqual([]);

  it('arm and key PUT always ask', async () => {
    r.host();
    const a = await arm(ADVICE, { mode: 'shadow', expected: OFF });
    expect(a.statusCode).toBe(403);
    expect(r.json(a)).toMatchObject({ error: 'step-up-required' });
    const p = await putKey({ ...LOCAL_BODY, key: KEY2 });
    expect(p.statusCode).toBe(403);
    expect(r.json(p)).toMatchObject({ error: 'step-up-required' });
    expect(rowCount()).toBe(0);
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toEqual({ state: 'value', value: KEY });
  });

  it('an armed gate\'s off asks, and a ceiling raise asks; both leave the row as it was', async () => {
    const lineId = r.armedGate();
    const armed = side({ mode: 'armed', armedLine: { id: lineId, line: 0.9 } });
    const o = await off(GATE, { expected: armed });
    expect(o.statusCode).toBe(403);
    expect(r.json(o)).toMatchObject({ error: 'step-up-required' });
    const c = await ceiling(GATE, { ceiling: 900, expected: armed });
    expect(c.statusCode).toBe(403);
    expect(r.json(c)).toMatchObject({ error: 'step-up-required' });
    expect(decisionRowSideOf(r.db, GATE)).toEqual(armed);
    expect(r.notices).toEqual([]);
  });

  it('shadow to off, an advice row off, a lower ceiling and a key DELETE pass with no step-up asked', async () => {
    r.host();
    r.move(GATE, OFF, side({ mode: 'shadow' }));
    r.move(ADVICE, OFF, side({ mode: 'armed' }));
    r.move(PRIVATE_ADVICE, OFF, side({ mode: 'shadow' }));
    expect((await off(GATE, { expected: side({ mode: 'shadow' }) })).statusCode).toBe(200);
    expect((await off(ADVICE, { expected: side({ mode: 'armed' }) })).statusCode).toBe(200);
    expect((await ceiling(PRIVATE_ADVICE, { ceiling: 300, expected: side({ mode: 'shadow' }) })).statusCode).toBe(200);
    expect((await delKey()).statusCode).toBe(200);
    expect(decisionRowSideOf(r.db, GATE).mode).toBe('off');
    expect(decisionRowSideOf(r.db, ADVICE).mode).toBe('off');
    expect(decisionRowSideOf(r.db, PRIVATE_ADVICE).ceiling).toBe(300);
    nobodyAsked();
  });
});

describe('the off door', () => {
  it('turns an armed gate off with one authority-decision-row record that widens', async () => {
    const lineId = r.armedGate();
    const armed = side({ mode: 'armed', armedLine: { id: lineId, line: 0.9 } });
    const before = r.lines().length;
    const res = await off(GATE, { expected: armed });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.json(res)).toMatchObject({ ok: true, row: GATE, state: 'off', side: { mode: 'off', armedLine: null, held: false } });
    const added = r.lines().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'authority-decision-row', row: GATE, gate: true, from: armed, to: side() });
    expect(decisionRowDirection(true, added[0]!.from, added[0]!.to)).toBe('widens');
    expect(r.gate.calls.filter((c) => c.stepUp === true)).toHaveLength(1);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ kind: 'coord', title: 'decision model changed' });
    expect(r.notices[0]!.body).toContain('by device-a');
  });

  describe('over a rolled-back journal', () => {
    it('writes held (off-refused) as row-only and answers offRefused; the next serve gather of the gate makes no call', async () => {
      const lineId = r.armedGate();
      const armed = side({ mode: 'armed', armedLine: { id: lineId, line: 0.9 } });
      r.guard.writerFailed('ahead');
      const before = r.lines().length;
      const res = await off(GATE, { expected: armed });
      expect(res.statusCode, res.body).toBe(200);
      expect(r.json(res)).toMatchObject({ ok: true, state: 'held', offRefused: true, row: GATE, side: { mode: 'armed', held: true } });
      expect(typeof r.json(res)['cause']).toBe('string');
      expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: true, heldCause: 'off-refused', armedLine: { id: lineId, line: 0.9 } });
      expect(r.lines()).toHaveLength(before);

      // The next serve gather: planned `not-asked` (held), the model never built.
      let built = 0;
      const host = decisionHostRead(r.db);
      if (host.kind !== 'host') throw new Error('no host');
      const checks = await gatherDecisions({
        store: decisionAskStore(r.db), time: fakeTime({ wallMs: T0 }).ports, arming: (row) => decisionRowSideOf(r.db, row), currentLine: () => null,
        host: () => host.host, keySet: () => true,
        modelFor: () => { built++; return {} as DecisionModel; }, egress: () => 'clear', stateHash: () => 'state-hash',
      }, { rows: [GATE], fields: new Map([[GATE, { goals: ['goals a'] }]]), refs: new Map() });
      expect(checks).toEqual([expect.objectContaining({ row: GATE, outcome: 'not-asked', why: 'held' })]);
      expect(built).toBe(0);
    });

    it('a gate already held: off answers the same and writes nothing', async () => {
      const lineId = r.armedGate();
      const armed = side({ mode: 'armed', armedLine: { id: lineId, line: 0.9 } });
      r.guard.writerFailed('ahead');
      await off(GATE, { expected: armed });
      const lines = r.lines().length;
      const notices = r.notices.length;
      const again = await off(GATE, { expected: { ...armed, held: true } });
      expect(again.statusCode).toBe(200);
      expect(r.json(again)).toMatchObject({ ok: true, state: 'held', offRefused: true });
      expect(r.lines()).toHaveLength(lines);
      expect(r.notices).toHaveLength(notices);
    });
  });

  it('maps decision-row-unknown, row-changed and a malformed body each to its own word', async () => {
    const unknown = await off('no.such.row', { expected: OFF });
    expect(unknown.statusCode).toBe(404);
    expect(r.json(unknown)).toMatchObject({ error: 'decision-row-unknown' });
    r.move(ADVICE, OFF, side({ mode: 'shadow' }));
    const changed = await off(ADVICE, { expected: side({ mode: 'shadow', ceiling: 601 }) });
    expect(changed.statusCode).toBe(409);
    expect(r.json(changed)).toMatchObject({ error: 'row-changed' });
    for (const body of [{}, { expected: 'shadow' }, { expected: side({ mode: 'shadow' }), extra: 1 }, [side()]]) {
      const bad = await off(ADVICE, body);
      expect(bad.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json(bad)).toMatchObject({ error: 'bad-request' });
    }
    expect(decisionRowSideOf(r.db, ADVICE)).toEqual(side({ mode: 'shadow' }));
  });
});

describe('the ceiling door', () => {
  it('lowers a held gate\'s ceiling over a rolled-back journal (row-only); the row is still held and armed', async () => {
    const lineId = r.armedGate();
    const armed = side({ mode: 'armed', armedLine: { id: lineId, line: 0.9 } });
    r.move(GATE, armed, { ...armed, held: true }, 'drift');
    r.guard.writerFailed('ahead');
    const before = r.lines().length;
    const res = await ceiling(GATE, { ceiling: 300, expected: { ...armed, held: true } });
    expect(res.statusCode, res.body).toBe(200);
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', ceiling: 300, held: true, heldCause: 'drift', armedLine: { id: lineId, line: 0.9 } });
    expect(r.lines()).toHaveLength(before);
    expect(r.gate.calls.filter((c) => c.stepUp === true)).toEqual([]);
  });

  it('raising it over a rolled-back journal answers authority-rolled-back and writes nothing', async () => {
    r.move(ADVICE, OFF, side({ mode: 'shadow', ceiling: 300 }));
    r.guard.writerFailed('ahead');
    const before = r.lines().length;
    const res = await ceiling(ADVICE, { ceiling: 600, expected: side({ mode: 'shadow', ceiling: 300 }) });
    expect(res.statusCode).toBe(503);
    expect(r.json(res)).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(decisionRowSideOf(r.db, ADVICE)).toEqual(side({ mode: 'shadow', ceiling: 300 }));
    expect(r.lines()).toHaveLength(before);
    expect(r.notices).toEqual([]);
  });

  it('bad-ceiling outside 50 to 5000, bad-request for a non-integer, decision-row-unknown, row-changed', async () => {
    for (const c of [49, 5001]) {
      const res = await ceiling(ADVICE, { ceiling: c, expected: OFF });
      expect([res.statusCode, r.json(res)['error']]).toEqual([400, 'bad-ceiling']);
    }
    for (const c of [1.5, '300', null]) {
      const res = await ceiling(ADVICE, { ceiling: c, expected: OFF });
      expect([res.statusCode, r.json(res)['error']]).toEqual([400, 'bad-request']);
    }
    expect((await ceiling('no.such.row', { ceiling: 300, expected: OFF })).statusCode).toBe(404);
    const changed = await ceiling(ADVICE, { ceiling: 300, expected: side({ mode: 'shadow' }) });
    expect([changed.statusCode, r.json(changed)['error']]).toEqual([409, 'row-changed']);
  });
});

describe('the arm door', () => {
  it('refuses armed for a row never in shadow with no admitted line: line-not-admitted', async () => {
    r.host();
    const res = await arm(GATE, { mode: 'armed', expected: OFF });
    expect([res.statusCode, r.json(res)['error']]).toEqual([409, 'line-not-admitted']);
    expect(rowCount()).toBe(0);
  });

  it('refuses a partial canary (100 of 295 asked, 0 crossed): canary-unmet; a line named that is not the current one is line-not-admitted', async () => {
    r.host();
    const id = r.line(GATE, { asked: 100, crossed: 0 });
    r.move(GATE, OFF, side({ mode: 'shadow' }));
    const partial = await arm(GATE, { mode: 'armed', line: id, expected: side({ mode: 'shadow' }) });
    expect([partial.statusCode, r.json(partial)['error']]).toEqual([409, 'canary-unmet']);
    const other = await arm(GATE, { mode: 'armed', line: id + 7, expected: side({ mode: 'shadow' }) });
    expect([other.statusCode, r.json(other)['error']]).toEqual([409, 'line-not-admitted']);
    expect(decisionRowSideOf(r.db, GATE)).toEqual(side({ mode: 'shadow' }));
  });

  it('arms a gate on its current line when the canary held; the answer names the row, its side and the armed line', async () => {
    r.host();
    const id = r.line(GATE);
    r.move(GATE, OFF, side({ mode: 'shadow' }));
    const res = await arm(GATE, { mode: 'armed', expected: side({ mode: 'shadow' }) });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.json(res)).toMatchObject({ ok: true, row: GATE, side: { mode: 'armed', held: false, armedLine: { id, line: 0.9 } }, heldWhy: null });
    expect(r.gate.calls.some((c) => c.stepUp === true)).toBe(true);
    expect(r.notices).toHaveLength(1);
  });

  it('keeps a held gate\'s armedLine when line is omitted, though a newer line is current (ruling F4)', async () => {
    const first = r.armedGate();
    const armed = side({ mode: 'armed', armedLine: { id: first, line: 0.9 } });
    r.move(GATE, armed, { ...armed, held: true }, 'drift');
    const newer = r.line(GATE, { line: 0.95 });
    expect(newer).toBeGreaterThan(first);
    const res = await arm(GATE, { mode: 'armed', expected: { ...armed, held: true } });
    expect(res.statusCode, res.body).toBe(200);
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: false, heldCause: null, armedLine: { id: first, line: 0.9 } });
  });

  it('refuses private-state-host for scope.widens on a hosted host, and key-unset with no host or no key', async () => {
    const noHost = await arm(ADVICE, { mode: 'shadow', expected: OFF });
    expect([noHost.statusCode, r.json(noHost)['error']]).toEqual([409, 'key-unset']);
    r.host({ kind: 'hosted', endpoint: HOSTED_ENDPOINT, origin: 'https://api.example.test', modelId: 'model-a' });
    await r.key(KEY, 'https://api.example.test'); // the key is bound to the origin it was entered for
    const hosted = await arm(GATE, { mode: 'shadow', expected: OFF });
    expect([hosted.statusCode, r.json(hosted)['error']]).toEqual([409, 'private-state-host']);
    // an advice row that is not private state is fine on a hosted host
    expect((await arm(ADVICE, { mode: 'shadow', expected: OFF })).statusCode).toBe(200);
    // the key removed: key-unset again
    await delKey();
    const noKey = await arm('goals.conflict', { mode: 'shadow', expected: OFF });
    expect([noKey.statusCode, r.json(noKey)['error']]).toEqual([409, 'key-unset']);
  });

  it('maps decision-row-unknown, a malformed body and a changed row to their own words', async () => {
    r.host();
    expect((await arm('no.such.row', { mode: 'shadow', expected: OFF })).statusCode).toBe(404);
    for (const body of [{}, { mode: 'off', expected: OFF }, { mode: 'shadow' }, { mode: 'armed', line: 0, expected: OFF }, { mode: 'shadow', expected: OFF, x: 1 }]) {
      const res = await arm(ADVICE, body);
      expect([res.statusCode, r.json(res)['error']], JSON.stringify(body)).toEqual([400, 'bad-request']);
    }
    const changed = await arm(ADVICE, { mode: 'shadow', expected: side({ ceiling: 601 }) });
    expect([changed.statusCode, r.json(changed)['error']]).toEqual([409, 'row-changed']);
  });

  it('a widening over a rolled-back journal answers authority-rolled-back and writes nothing', async () => {
    r.host();
    r.guard.writerFailed('ahead');
    const res = await arm(ADVICE, { mode: 'shadow', expected: OFF });
    expect([res.statusCode, r.json(res)['error']]).toEqual([503, 'authority-rolled-back']);
    expect(rowCount()).toBe(0);
  });
});

describe('the key door', () => {
  it('a first PUT with a key stores the host and answers its record; no answer or feed row carries the key', async () => {
    r.db.exec('DELETE FROM decision_host');
    // the rig wrote a key; remove it so the door's first PUT is a first PUT
    await delKey();
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT).state).toBe('absent');
    r.notices.length = 0;
    const res = await putKey({ ...LOCAL_BODY, key: KEY2 });
    expect(res.statusCode, res.body).toBe(200);
    const body = r.json(res);
    expect(body).toMatchObject({ ok: true, host: { kind: 'local', endpoint: LOCAL.endpoint, origin: LOCAL.origin, modelId: 'model-a' }, held: [],
      key: { setAt: T0, masked: true } });
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toEqual({ state: 'value', value: KEY2 });
    expect(r.registered).toContain(KEY2);
    expect(decisionHostRead(r.db)).toMatchObject({ kind: 'host', host: { kind: 'local', origin: LOCAL.origin, keySetAt: T0 } });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]!.body).toContain('key set');
  });

  it('a PUT without a key on the same origin keeps the stored key and changes the model; a changed model holds an armed gate', async () => {
    const lineId = r.armedGate();
    const res = await putKey({ ...LOCAL_BODY, modelId: 'model-b' });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.json(res)).toMatchObject({ held: [GATE] });
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toEqual({ state: 'value', value: KEY });
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: true, heldCause: 'line-key', armedLine: { id: lineId, line: 0.9 } });
  });

  it('a host change to another origin with the key holds an armed gate with line-key, in the door\'s transaction', async () => {
    const lineId = r.armedGate();
    const lines = r.lines().length;
    const res = await putKey({ kind: 'local', endpoint: 'http://127.0.0.1:9001/v1', modelId: 'model-a', key: KEY2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.json(res)).toMatchObject({ ok: true, held: [GATE], host: { origin: 'http://127.0.0.1:9001' } });
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: true, heldCause: 'line-key', armedLine: { id: lineId, line: 0.9 } });
    expect(decisionHostRead(r.db)).toMatchObject({ host: { origin: 'http://127.0.0.1:9001' } });
    // the hold is one authority record that narrows
    const added = r.lines().slice(lines);
    expect(added).toHaveLength(1);
    expect(decisionRowDirection(true, added[0]!.from, added[0]!.to)).toBe('narrows');
    expect(r.notices[r.notices.length - 1]!.body).toContain(`held ${GATE}`);
  });

  it('a host change to hosted leaves a private-state row\'s mode as it was; the row is then not-asked (private-state-hosted)', async () => {
    r.host();
    r.move(PRIVATE_ADVICE, OFF, side({ mode: 'shadow' }));
    const res = await putKey({ kind: 'hosted', endpoint: HOSTED_ENDPOINT, modelId: 'model-a', key: KEY2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.json(res)).toMatchObject({ held: [], host: { kind: 'hosted', origin: 'https://api.example.test' } });
    expect(decisionRowSideOf(r.db, PRIVATE_ADVICE)).toEqual(side({ mode: 'shadow' }));
    const plan = planDecision({ row: PRIVATE_ADVICE, kind: 'serve', fresh: false, side: decisionRowSideOf(r.db, PRIVATE_ADVICE),
      host: { kind: 'hosted', modelId: 'model-a', origin: 'https://api.example.test' }, keySet: true, fields: {}, requestBytes: 0,
      egress: 'clear', record: null, usage: { measured: false } });
    expect(plan).toEqual({ do: 'skip', outcome: 'not-asked', why: 'private-state-hosted' });
  });

  it('a new origin with no key refuses key-required and changes nothing', async () => {
    r.host();
    const res = await putKey({ kind: 'local', endpoint: 'http://127.0.0.1:9001/v1', modelId: 'model-a' });
    expect([res.statusCode, r.json(res)['error']]).toEqual([409, 'key-required']);
    expect(decisionHostRead(r.db)).toMatchObject({ host: { origin: LOCAL.origin } });
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toEqual({ state: 'value', value: KEY });
  });

  it('bad-endpoint for userinfo, a query, an empty query, a fragment and a non-https hosted endpoint; the key is not stored', async () => {
    await delKey();
    const bad = [
      { kind: 'hosted', endpoint: 'https://user@api.example.test/v1' },
      { kind: 'hosted', endpoint: 'https://api.example.test/v1?q=1' },
      { kind: 'hosted', endpoint: 'https://api.example.test/v1?' },
      { kind: 'hosted', endpoint: 'https://api.example.test/v1#frag' },
      { kind: 'hosted', endpoint: 'http://api.example.test/v1' },
      { kind: 'hosted', endpoint: 'ftp://api.example.test/v1' },
      { kind: 'local', endpoint: 'https://api.example.test/v1' },
    ];
    for (const b of bad) {
      const res = await putKey({ ...b, modelId: 'model-a', key: KEY2 });
      expect([res.statusCode, r.json(res)['error']], b.endpoint).toEqual([400, 'bad-endpoint']);
    }
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT).state).toBe('absent');
    expect(decisionHostRead(r.db)).toEqual({ kind: 'none' });
  });

  it('bad-request for a malformed body, a key with a newline, or an oversize key; key-unset for no key and none stored', async () => {
    await delKey();
    for (const b of [{}, { ...LOCAL_BODY, key: '' }, { ...LOCAL_BODY, key: `${KEY2}\nx` }, { ...LOCAL_BODY, modelId: '' }, { ...LOCAL_BODY, kind: 'other', key: KEY2 },
      { ...LOCAL_BODY, key: 'k'.repeat(4097) }]) {
      const res = await putKey(b);
      expect([res.statusCode, r.json(res)['error']], JSON.stringify(b).slice(0, 60)).toEqual([400, 'bad-request']);
    }
    const none = await putKey(LOCAL_BODY);
    expect([none.statusCode, r.json(none)['error']]).toEqual([409, 'key-unset']);
  });

  it('DELETE removes the slot, sets keySetAt null and holds every armed gate with no-key; an armed advice row is left', async () => {
    const lineId = r.armedGate();
    r.move(ADVICE, OFF, side({ mode: 'armed' }));
    const res = await delKey();
    expect(res.statusCode, res.body).toBe(200);
    expect(r.json(res)).toMatchObject({ ok: true, key: null, keySetAt: null, held: [GATE], host: { kind: 'local', origin: LOCAL.origin } });
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT).state).toBe('absent');
    expect(decisionHostRead(r.db)).toMatchObject({ host: { keySetAt: null } });
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: true, heldCause: 'no-key', armedLine: { id: lineId, line: 0.9 } });
    expect(stateOf(ADVICE)).toMatchObject({ mode: 'armed', held: false });
    // a second DELETE has nothing to hold and nothing to remove, and still answers
    const again = await delKey();
    expect(again.statusCode).toBe(200);
    expect(r.json(again)).toMatchObject({ held: [] });
  });
});

describe('the key door: the host and holds first, the key second, the key bound to its origin (review 2418 F1, F6)', () => {
  it('a PUT binds the key to the origin it was entered for; a key stored for another origin is no key for the host', async () => {
    const res = await putKey({ ...OTHER_BODY, key: KEY2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(readServerSecretMeta(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toMatchObject({ bound: OTHER.origin });
    expect(readDecisionModelKey(r.ccrcDir, OTHER.origin)).toEqual({ kind: 'value', value: KEY2 });
    expect(readDecisionModelKey(r.ccrcDir, LOCAL.origin)).toEqual({ kind: 'not-bound' });
  });

  it('a key bound to another origin than the stored host reads as no key: arm refuses key-unset', async () => {
    r.host();
    await r.key(KEY, OTHER.origin);
    const res = await arm(ADVICE, { mode: 'shadow', expected: OFF });
    expect([res.statusCode, r.json(res)['error']]).toEqual([409, 'key-unset']);
  });

  it('PUT: a key write that fails after the transaction answers stored-not-applied; the host reads B, the armed gate is held line-key, no key is bound to B', async () => {
    const lineId = r.armedGate();
    chmodSync(serverDir(), 0o755); // not private: the slot's write refuses before it changes anything
    const res = await putKey({ ...OTHER_BODY, key: KEY2 });
    chmodSync(serverDir(), 0o700);
    expect(res.statusCode, res.body).toBe(503);
    expect(r.json(res)).toMatchObject({ ok: false, error: 'stored-not-applied' });
    expect(hostOrigin()).toBe(OTHER.origin);
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: true, heldCause: 'line-key', armedLine: { id: lineId, line: 0.9 } });
    expect(readDecisionModelKey(r.ccrcDir, OTHER.origin).kind).not.toBe('value');
    // the slot still holds the old key, bound to the old origin, which the new host never sends
    expect(readDecisionModelKey(r.ccrcDir, LOCAL.origin)).toEqual({ kind: 'value', value: KEY });
    expect(r.notices[r.notices.length - 1]!.body).toContain('the key was not stored');
  });

  it('PUT: a failed transaction changes nothing (write-failed): the slot keeps the old key and its record, the host still reads A, the gate is not held', async () => {
    const lineId = r.armedGate();
    plantUnreadableRow();
    const lines = r.lines().length;
    const res = await putKey({ ...OTHER_BODY, key: KEY2 });
    expect(res.statusCode, res.body).toBe(503);
    expect(r.json(res)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(readServerSecretValue(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toEqual({ state: 'value', value: KEY });
    expect(readServerSecretMeta(r.ccrcDir, DECISION_MODEL_KEY_SLOT)).toMatchObject({ bound: LOCAL.origin });
    expect(readDecisionModelKey(r.ccrcDir, LOCAL.origin)).toEqual({ kind: 'value', value: KEY });
    expect(readDecisionModelKey(r.ccrcDir, OTHER.origin)).toEqual({ kind: 'not-bound' });
    expect(hostOrigin()).toBe(LOCAL.origin);
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: false, armedLine: { id: lineId, line: 0.9 } });
    expect(r.lines()).toHaveLength(lines);
    expect(r.registered).not.toContain(KEY2);
    expect(r.notices).toEqual([]);
  });

  it('PUT: an unreadable row AFTER the armed gate fails the transaction before any hold is journalled (no record without its row)', async () => {
    r.armedGate();
    plantUnreadableRow('goals.conflict'); // read after scope.widens, the armed gate a host change would hold
    const lines = r.lines().length;
    const res = await putKey({ ...OTHER_BODY, key: KEY2 });
    expect(r.json(res)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: false });
    expect(r.lines()).toHaveLength(lines);
  });

  it('DELETE holds first (F6): a removal that fails answers stored-not-applied with the armed gate held no-key and keySetAt null', async () => {
    const lineId = r.armedGate();
    chmodSync(serverDir(), 0o755);
    const res = await delKey();
    chmodSync(serverDir(), 0o700);
    expect(res.statusCode, res.body).toBe(503);
    expect(r.json(res)).toMatchObject({ ok: false, error: 'stored-not-applied' });
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: true, heldCause: 'no-key', armedLine: { id: lineId, line: 0.9 } });
    expect(decisionHostRead(r.db)).toMatchObject({ host: { keySetAt: null } });
    expect(r.notices[r.notices.length - 1]!.body).toContain('key not removed');
  });

  it('DELETE: a failed transaction changes nothing (write-failed): the key is still stored and no gate is held', async () => {
    const lineId = r.armedGate();
    plantUnreadableRow();
    const res = await delKey();
    expect(res.statusCode, res.body).toBe(503);
    expect(r.json(res)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(readDecisionModelKey(r.ccrcDir, LOCAL.origin)).toEqual({ kind: 'value', value: KEY });
    expect(stateOf(GATE)).toMatchObject({ mode: 'armed', held: false, heldCause: null, armedLine: { id: lineId, line: 0.9 } });
    expect(decisionHostRead(r.db)).toMatchObject({ host: { keySetAt: T0 } });
    expect(r.notices).toEqual([]);
  });
});

describe('the key door: what a key and a model id may be (review 2418 F9)', () => {
  const refused = async (body: unknown, label: string): Promise<void> => {
    const res = await putKey(body);
    expect([res.statusCode, r.json(res)['error']], label).toEqual([400, 'bad-request']);
    expect(readDecisionModelKey(r.ccrcDir, LOCAL.origin), label).toEqual({ kind: 'value', value: KEY });
    expect(rowCount()).toBe(0);
  };

  it('bad-request for a model id with a line break, of every kind', async () => {
    for (const ch of ['\n', '\r', '\u000b', '\u000c', '\u0085', ' ', ' ']) {
      await refused({ ...LOCAL_BODY, modelId: `m${ch}x`, key: KEY2 }, `modelId ${JSON.stringify(ch)}`);
    }
  });

  it('bad-request for a key with a NUL, a character above U+00FF, an emoji, or a line break', async () => {
    await refused({ ...LOCAL_BODY, key: `${KEY2}\u0000` }, 'NUL');
    await refused({ ...LOCAL_BODY, key: `${KEY2}Ā` }, 'U+0100');
    await refused({ ...LOCAL_BODY, key: `${KEY2}\u{1F511}` }, 'emoji');
    await refused({ ...LOCAL_BODY, key: `${KEY2}\u0085x` }, 'U+0085');
  });

  it('bad-request for a key of 19 ASCII bytes, and a key of exactly 20 bytes passes', async () => {
    const short = 'k'.repeat(19);
    const res = await putKey({ ...LOCAL_BODY, key: short });
    expect([res.statusCode, r.json(res)['error']]).toEqual([400, 'bad-request']);
    expect(res.body.includes(short)).toBe(false);
    expect(r.notices).toEqual([]);
    const exact = 'k'.repeat(20);
    const ok = await putKey({ ...LOCAL_BODY, key: exact });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.body.includes(exact)).toBe(false);
    expect(readDecisionModelKey(r.ccrcDir, LOCAL.origin)).toEqual({ kind: 'value', value: exact });
    r.notices.forEach((x) => expect(JSON.stringify(x).includes(exact)).toBe(false));
  });

  it('a key counts UTF-8 bytes, not characters: ten two-byte characters pass the floor', async () => {
    const key = 'é'.repeat(10);
    const res = await putKey({ ...LOCAL_BODY, key });
    expect(res.statusCode, res.body).toBe(200);
    const nine = await putKey({ ...LOCAL_BODY, key: 'é'.repeat(9) });
    expect([nine.statusCode, r.json(nine)['error']]).toEqual([400, 'bad-request']);
  });
});

describe('the read', () => {
  it('answers a view that readDecisionModelView accepts, with host.endpoint beside origin, and never the key', async () => {
    const lineId = r.armedGate();
    r.move(ADVICE, OFF, side({ mode: 'shadow' }));
    const res = await r.call('GET', '/api/decision-model');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const read = readDecisionModelView(JSON.parse(res.body));
    expect(read.ok, read.ok ? '' : read.detail).toBe(true);
    if (!read.ok) return;
    const v = read.view;
    expect(v.host).toEqual({ kind: 'local', endpoint: LOCAL.endpoint, origin: LOCAL.origin, modelId: 'model-a' });
    expect(v.key).toEqual({ setAt: T0, masked: true });
    expect(v.rows.map((x) => x.id)).toEqual(Object.keys(DECISION_QUESTIONS));
    const gate = v.rows.find((x) => x.id === GATE)!;
    expect(gate).toMatchObject({ side: { mode: 'armed', armedLine: { id: lineId, line: 0.9 } }, direction: 'gate', privateState: true,
      line: { id: lineId, canaryAsked: 295, canaryExpected: 295, canaryCrossed: 0 }, offered: null });
    expect(v.rows.find((x) => x.id === ADVICE)).toMatchObject({ side: { mode: 'shadow' }, line: null, offered: null, direction: 'advice' });
    expect(v.fleetToday).toBe(0);
    expect(v.fleetCap).toBeGreaterThan(0);
    expect(res.body.includes(KEY)).toBe(false);
  });

  it('offers an armed gate a newer current line, and with no host and no key answers null for both', async () => {
    const first = r.armedGate();
    const newer = r.line(GATE, { line: 0.95 });
    const v = readDecisionModelView(JSON.parse((await r.call('GET', '/api/decision-model')).body));
    expect(v.ok && v.view.rows.find((x) => x.id === GATE)).toMatchObject({ side: { armedLine: { id: first } }, line: { id: newer }, offered: { id: newer, line: 0.95 } });

    await delKey();
    r.db.exec('DELETE FROM decision_host');
    const empty = readDecisionModelView(JSON.parse((await r.call('GET', '/api/decision-model')).body));
    expect(empty.ok && empty.view.host).toBeNull();
    expect(empty.ok && empty.view.key).toBeNull();
  });
});
