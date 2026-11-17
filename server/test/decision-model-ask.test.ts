// Overlord W2, the server's one caller of the decision model (plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 5): `gatherDecisions` with a double port over a
// real `coord.db` in a fixture home. No test reaches a network or a real model.
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DECISION_ROW_DEFAULT, type DecisionCheck, type DecisionHostKind, type DecisionRowId, type DecisionRowSide,
} from '../../shared/decisionModel.js';
import { openCoordDb } from '../src/coord/db.js';
import { isPrivateAddress } from '../src/coord/decisionModel.js';
import { gatherDecisions, type DecisionAskDeps } from '../src/coord/decisionModelAsk.js';
import { createHttpDecisionModel } from '../src/coord/decisionModelHttp.js';
import type { DecisionCall, DecisionModel, DecisionWireRequest } from '../src/coord/decisionModelPort.js';
import { decisionAskStore } from '../src/coord/decisionModelStore.js';
import { FIELDS } from './decisionModelCases.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const LOCAL_HOST = { kind: 'local' as const, endpoint: 'http://127.0.0.1:9000/ask', origin: 'http://127.0.0.1:9000', modelId: 'model-a' };
const HOSTED_HOST = { kind: 'hosted' as const, endpoint: 'https://model-host-a.example/ask', origin: 'https://model-host-a.example', modelId: 'model-a' };
const SHADOW: DecisionRowSide = { ...DECISION_ROW_DEFAULT, mode: 'shadow' };

/** An answer to every question of a request: yes-or-no at `p`, a choice of the first option. */
const answerAll = (req: DecisionWireRequest, p = 0.9, model = 'model-a') => ({
  model,
  answers: Object.fromEntries(Object.entries(req.questions).map(([k, q]) => [k, q.type === 'noul'
    ? { type: 'noul', noul: p }
    : { type: 'choice', choice: Object.keys(q.criteria as object)[0] === undefined ? '' : Object.keys(q.criteria as object).sort()[0], confidence: p }])),
});

interface Double { calls: DecisionWireRequest[]; built: { kind: DecisionHostKind; endpoint: string }[] }

let db: DatabaseSync;
beforeEach(() => { db = openCoordDb(path.join(mkTmp('ccrc-decision-ask-'), '.ccrc', 'coord.db')); });

const counts = (row: DecisionRowId) => db.prepare('SELECT serve, maintain, reserved, unavailableMs FROM decision_days WHERE row = ?')
  .get(row) as { serve: number; maintain: number; reserved: number; unavailableMs: number } | undefined;
const records = (): number => (db.prepare('SELECT COUNT(*) AS n FROM decision_records').get() as { n: number }).n;

const setup = (o: {
  arming?: Partial<Record<DecisionRowId, DecisionRowSide>>; host?: typeof LOCAL_HOST | typeof HOSTED_HOST | null;
  answer?: (req: DecisionWireRequest) => DecisionCall | Promise<DecisionCall>; modelKind?: DecisionHostKind;
  currentLine?: { id: number; line: number } | null; egress?: 'clear' | 'hit' | 'no-list' | 'unreadable';
  screen?: (texts: readonly string[]) => 'clear' | 'hit' | 'no-list' | 'unreadable';
  model?: (h: { kind: DecisionHostKind; endpoint: string }, time: DecisionAskDeps['time']) => DecisionModel;
  settleFails?: boolean;
} = {}) => {
  const ft = fakeTime();
  const d: Double = { calls: [], built: [] };
  const store = decisionAskStore(db);
  const deps: DecisionAskDeps = {
    store: o.settleFails ? { ...store, settle: () => false } : store,
    time: ft.ports,
    arming: (row) => o.arming?.[row] ?? DECISION_ROW_DEFAULT,
    currentLine: () => o.currentLine ?? null,
    host: () => (o.host === undefined ? LOCAL_HOST : o.host),
    keySet: () => true,
    modelFor: (h): DecisionModel => {
      d.built.push(h);
      if (o.model !== undefined) return o.model(h, ft.ports);
      return {
        kind: o.modelKind ?? h.kind, origin: new URL(h.endpoint).origin,
        ask: async (req) => {
          d.calls.push(req);
          return o.answer === undefined ? { ok: true, answer: answerAll(req), ms: 30, attempts: 1 } : o.answer(req);
        },
      };
    },
    egress: (texts) => o.screen?.(texts) ?? o.egress ?? 'clear',
    stateHash: (state) => createHash('sha256').update(JSON.stringify(state)).digest('hex'),
  };
  return { deps, d, ft };
};
afterEach(() => { vi.restoreAllMocks(); });
const one = (row: DecisionRowId, extra: object = {}) => ({ rows: [row], fields: new Map([[row, FIELDS[row]]]), refs: new Map(), ...extra });

describe('gatherDecisions: the one caller (Task 5)', () => {
  it('with every row off it makes no call, and every check is disarmed', async () => {
    const { deps, d } = setup();
    const rows = ['programme.pick', 'scope.widens', 'relay.method', 'readback.omits', 'readback.adds', 'goals.conflict'] as DecisionRowId[];
    const checks = await gatherDecisions(deps, { rows, fields: new Map(rows.map((r) => [r, FIELDS[r]])), refs: new Map() });
    expect(checks.map((c) => [c.row, c.outcome])).toEqual(rows.map((r) => [r, 'disarmed']));
    expect(d.calls).toHaveLength(0);
    expect(d.built).toHaveLength(0);
    expect(records()).toBe(0);
  });

  it('a row in shadow: one call, recorded, one attempt counted; the same state again reuses it with no call', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW } });
    const [c] = await gatherDecisions(deps, one('relay.method', { refs: new Map([['relay.method', { part: 'mail-1' }]]) }));
    expect(c).toMatchObject({ row: 'relay.method', outcome: 'answered', verdict: 'yes', p: 0.9, band: 'very-likely', attempts: 1,
      reused: false, egress: 'not-hosted', hostKind: 'local', modelId: 'model-a', lineGen: 0, ms: 30 });
    expect((c as Extract<DecisionCheck, { outcome: 'answered' }>).recordId).toEqual(expect.any(Number));
    expect(d.calls).toHaveLength(1);
    expect(records()).toBe(1);
    expect(counts('relay.method')).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
    expect(db.prepare('SELECT refs, inline FROM decision_records').get()).toEqual({ refs: '{"part":"mail-1"}', inline: '{"part":"use a map"}' });
    const [again] = await gatherDecisions(deps, one('relay.method'));
    expect(again).toMatchObject({ outcome: 'answered', reused: true, attempts: 0, recordId: (c as { recordId: number }).recordId });
    expect(d.calls).toHaveLength(1);
    expect(counts('relay.method')).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('fresh: calls again, records nothing, and counts maintenance', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW } });
    await gatherDecisions(deps, one('relay.method'));
    const [c] = await gatherDecisions(deps, one('relay.method', { fresh: true, kind: 'maintain' }));
    expect(c).toMatchObject({ outcome: 'answered', reused: false, recordId: null, attempts: 1 });
    expect(d.calls).toHaveLength(2);
    expect(records()).toBe(1);
    expect(counts('relay.method')).toEqual({ serve: 1, maintain: 1, reserved: 0, unavailableMs: 0 });
  });

  it('programme.pick alone brings in programme.any: one request, one attempt counted once on each row, one check back', async () => {
    const { deps, d } = setup({ arming: { 'programme.pick': SHADOW, 'programme.any': SHADOW } });
    const checks = await gatherDecisions(deps, one('programme.pick'));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ row: 'programme.pick', outcome: 'answered', verdict: { option: expect.any(String) } });
    expect(d.calls).toHaveLength(1);
    expect(Object.keys(d.calls[0]!.questions)).toHaveLength(3);
    expect(counts('programme.pick')).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
    expect(counts('programme.any')).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
    expect(records()).toBe(2);
  });

  it('inside an open transaction it throws before any call', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW } });
    db.exec('BEGIN');
    await expect(gatherDecisions(deps, one('relay.method'))).rejects.toThrow(/never inside a transaction/);
    db.exec('ROLLBACK');
    expect(d.calls).toHaveLength(0);
    expect(d.built).toHaveLength(0);
  });

  it('a private-state row on a hosted host makes no call, writes no record and counts no call', async () => {
    const { deps, d } = setup({ arming: { 'scope.widens': SHADOW }, host: HOSTED_HOST });
    const [c] = await gatherDecisions(deps, one('scope.widens'));
    expect(c).toEqual({ row: 'scope.widens', outcome: 'not-asked', why: 'private-state-hosted', ms: 0, attempts: 0 });
    expect(d.calls).toHaveLength(0);
    expect(records()).toBe(0);
    expect(counts('scope.widens')).toBeUndefined();
  });

  it('a hosted advice row is screened: a hit is not asked; no-list is asked and recorded as skipped-no-list', async () => {
    const hit = setup({ arming: { 'relay.method': SHADOW }, host: HOSTED_HOST, egress: 'hit' });
    expect(await gatherDecisions(hit.deps, one('relay.method'))).toEqual([{ row: 'relay.method', outcome: 'not-asked', why: 'egress-hit', ms: 0, attempts: 0 }]);
    expect(hit.d.calls).toHaveLength(0);
    const none = setup({ arming: { 'relay.method': SHADOW }, host: HOSTED_HOST, egress: 'no-list' });
    expect((await gatherDecisions(none.deps, one('relay.method')))[0]).toMatchObject({ outcome: 'answered', egress: 'skipped-no-list', hostKind: 'hosted' });
  });

  it('a held armed gate makes no call and answers not-asked, held (ruling F1)', async () => {
    const held: DecisionRowSide = { mode: 'armed', ceiling: 600, armedLine: { id: 4, line: 0.9 }, held: true };
    const { deps, d } = setup({ arming: { 'scope.widens': held } });
    expect(await gatherDecisions(deps, one('scope.widens'))).toEqual([{ row: 'scope.widens', outcome: 'not-asked', why: 'held', ms: 0, attempts: 0 }]);
    expect(d.calls).toHaveLength(0);
    expect(counts('scope.widens')).toBeUndefined();
  });

  it('an armed gate is gathered under its armedLine while a newer current line exists (review 2262 F3)', async () => {
    const armed: DecisionRowSide = { mode: 'armed', ceiling: 600, armedLine: { id: 4, line: 0.9 }, held: false };
    const { deps } = setup({ arming: { 'scope.widens': armed, 'relay.method': SHADOW }, currentLine: { id: 9, line: 0.8 } });
    const [gate, advice] = await gatherDecisions(deps, { rows: ['scope.widens', 'relay.method'],
      fields: new Map([['scope.widens', FIELDS['scope.widens']], ['relay.method', FIELDS['relay.method']]]), refs: new Map() });
    expect(gate).toMatchObject({ outcome: 'answered', lineGen: 4 });
    expect(advice).toMatchObject({ outcome: 'answered', lineGen: 9 });
    expect(db.prepare("SELECT lineGen, inline FROM decision_records WHERE row = 'scope.widens'").get()).toEqual({ lineGen: 4, inline: null });
  });

  it.each([
    [{ ok: false, outcome: 'unavailable', why: 'server-error', status: 503, ms: 900, attempts: 2 }, 'server-error', 2, 900],
    [{ ok: false, outcome: 'unavailable', why: 'timeout', status: null, ms: 2000, attempts: 1 }, 'timeout', 1, 2000],
    [{ ok: false, outcome: 'auth-failed', status: 401, ms: 20, attempts: 1 }, null, 1, 0],
    [{ ok: false, outcome: 'refused', status: 400, ms: 20, attempts: 1 }, null, 1, 0],
    [{ ok: false, outcome: 'over-size', status: 413, ms: 20, attempts: 1 }, null, 1, 0],
    [{ ok: false, outcome: 'malformed', why: 'not-json', ms: 20, attempts: 1 }, 'not-json', 1, 0],
    [{ ok: false, outcome: 'unavailable', why: 'endpoint-not-private', status: null, ms: 1, attempts: 0 }, 'endpoint-not-private', 0, 1],
  ] as [DecisionCall & { ok: false }, string | null, number, number][])('a port answer %#: its outcome, no record, its attempts and time counted', async (call, why, attempts, unavailableMs) => {
    const { deps } = setup({ arming: { 'relay.method': SHADOW }, answer: () => call });
    const [c] = await gatherDecisions(deps, one('relay.method'));
    expect(c).toEqual({ row: 'relay.method', outcome: call.outcome, why, ms: call.ms, attempts });
    expect(records()).toBe(0);
    expect(counts('relay.method')).toEqual({ serve: attempts, maintain: 0, reserved: 0, unavailableMs });
  });

  it('an answer under another model id is malformed, counted, and not recorded', async () => {
    const { deps } = setup({ arming: { 'relay.method': SHADOW }, answer: (req) => ({ ok: true, answer: answerAll(req, 0.9, 'model-b'), ms: 10, attempts: 1 }) });
    expect(await gatherDecisions(deps, one('relay.method'))).toEqual([{ row: 'relay.method', outcome: 'malformed', why: 'model', ms: 10, attempts: 1 }]);
    expect(records()).toBe(0);
    expect(counts('relay.method')).toMatchObject({ serve: 1, reserved: 0 });
  });

  it('two gathers started together at 597 of 600 with a reservation of 2: exactly one asks', async () => {
    db.prepare("INSERT INTO decision_days (row, day, serve) VALUES ('relay.method', ?, 597)").run(new Date(fakeTime().ports.clock.wall()).toISOString().slice(0, 10));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW }, answer: async (req) => { await gate; return { ok: true, answer: answerAll(req), ms: 5, attempts: 1 }; } });
    const a = gatherDecisions(deps, one('relay.method'));
    const b = gatherDecisions(deps, one('relay.method', { fresh: true }));
    release();
    const [[ca], [cb]] = await Promise.all([a, b]);
    expect([ca!.outcome, cb!.outcome].sort()).toEqual(['answered', 'over-ceiling']);
    expect(d.calls).toHaveLength(1);
    expect(counts('relay.method')).toEqual({ serve: 598, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('modelFor returning an adapter of another kind: no request, unavailable host-changed, the reservation released', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW }, modelKind: 'hosted' });
    expect(await gatherDecisions(deps, one('relay.method'))).toEqual([{ row: 'relay.method', outcome: 'unavailable', why: 'host-changed', ms: 0, attempts: 0 }]);
    expect(d.built).toEqual([{ kind: 'local', endpoint: LOCAL_HOST.endpoint }]);
    expect(d.calls).toHaveLength(0);
    expect(counts('relay.method')).toEqual({ serve: 0, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('a count that cannot be read plans over-ceiling and asks nothing', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW } });
    db.exec('DROP TABLE decision_days');
    expect(await gatherDecisions(deps, one('relay.method'))).toEqual([{ row: 'relay.method', outcome: 'over-ceiling', why: null, ms: 0, attempts: 0 }]);
    expect(d.calls).toHaveLength(0);
  });

  it('with no host every row in shadow answers unavailable, host-unset, and no adapter is built', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW }, host: null });
    expect(await gatherDecisions(deps, one('relay.method'))).toEqual([{ row: 'relay.method', outcome: 'unavailable', why: 'host-unset', ms: 0, attempts: 0 }]);
    expect(d.built).toHaveLength(0);
  });
});

describe('gatherDecisions: review 2324', () => {
  it('F1: two routing rows with different states: the secret in the second is screened, and never sent', async () => {
    const SECRET = 'SECRET-PRIVATE-VALUE';
    const screened: string[][] = [];
    const { deps, d } = setup({ arming: { 'programme.pick': SHADOW, 'programme.any': SHADOW }, host: HOSTED_HOST,
      screen: (texts) => { screened.push([...texts]); return texts.some((t) => t.includes(SECRET)) ? 'hit' : 'clear'; } });
    const first = FIELDS['programme.pick'];
    await gatherDecisions(deps, { rows: ['programme.pick'], fields: new Map([['programme.pick', first]]), refs: new Map() });
    expect(d.calls).toHaveLength(1);
    const second = { ...FIELDS['programme.any'], request: SECRET };
    const checks = await gatherDecisions(deps, { rows: ['programme.pick', 'programme.any'],
      fields: new Map([['programme.pick', first], ['programme.any', second]]), refs: new Map() });
    expect(checks[0]).toMatchObject({ row: 'programme.pick', outcome: 'answered', reused: true });
    expect(checks[1]).toEqual({ row: 'programme.any', outcome: 'not-asked', why: 'egress-hit', ms: 0, attempts: 0 });
    for (const call of d.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    expect(screened.some((t) => t.includes(SECRET))).toBe(true);
    expect(counts('programme.any')).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('F1: a row is recorded under the state it was asked with', async () => {
    const { deps, d } = setup({ arming: { 'programme.pick': SHADOW, 'programme.any': SHADOW } });
    const second = { ...FIELDS['programme.any'], request: 'another request' };
    await gatherDecisions(deps, { rows: ['programme.pick', 'programme.any'],
      fields: new Map([['programme.pick', FIELDS['programme.pick']], ['programme.any', second]]), refs: new Map() });
    expect(d.calls).toHaveLength(2);
    expect(d.calls.map((c) => (c.state['request'] as { quoted: string }).quoted)).toEqual(['add a door', 'another request']);
    const hashes = db.prepare('SELECT row, stateHash FROM decision_records ORDER BY id').all() as { row: string; stateHash: string }[];
    expect(hashes.find((h) => h.row === 'programme.any')!.stateHash)
      .toBe(createHash('sha256').update(JSON.stringify(second)).digest('hex'));
  });

  it('F3: an ask that throws: the gather throws, and no reservation stands', async () => {
    const { deps } = setup({ arming: { 'relay.method': SHADOW }, answer: () => { throw new Error('adapter bug'); } });
    await expect(gatherDecisions(deps, one('relay.method'))).rejects.toThrow(/adapter bug/);
    expect(counts('relay.method')).toEqual({ serve: 0, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('F3: a key reader that throws, through the one adapter: no-key, no request, and no reservation stands', async () => {
    let fetched = 0;
    const { deps } = setup({ arming: { 'relay.method': SHADOW }, model: (h, time) => createHttpDecisionModel(h,
      () => { throw new Error('the key store broke'); },
      { fetch: async () => { fetched += 1; throw new Error('no fetch'); }, resolve: async () => ['127.0.0.1'], time, isPrivateAddress }) });
    expect(await gatherDecisions(deps, one('relay.method')))
      .toEqual([{ row: 'relay.method', outcome: 'unavailable', why: 'no-key', ms: 0, attempts: 0 }]);
    expect(fetched).toBe(0);
    expect(counts('relay.method')).toEqual({ serve: 0, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('F3: a settle the store could not write is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps } = setup({ arming: { 'relay.method': SHADOW }, settleFails: true });
    await gatherDecisions(deps, one('relay.method'));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^ccrc-server: decision model: the settle of relay\.method on .* failed/));
  });

  it('F4: an adapter whose endpoint does not parse: endpoint-unparseable, never host-changed, the reservation released', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW },
      model: (h) => ({ kind: h.kind, origin: null, ask: async () => { throw new Error('never asked'); } }) });
    expect(await gatherDecisions(deps, one('relay.method')))
      .toEqual([{ row: 'relay.method', outcome: 'unavailable', why: 'endpoint-unparseable', ms: 0, attempts: 0 }]);
    expect(d.calls).toHaveLength(0);
    expect(counts('relay.method')).toEqual({ serve: 0, maintain: 0, reserved: 0, unavailableMs: 0 });
  });

  it('F5: a key holding an unreadable record: asked again, and the check names no record for this answer', async () => {
    const { deps, d } = setup({ arming: { 'relay.method': SHADOW } });
    await gatherDecisions(deps, one('relay.method'));
    db.prepare("UPDATE decision_records SET verdict = 'maybe'").run();
    const [c] = await gatherDecisions(deps, one('relay.method'));
    expect(c).toMatchObject({ outcome: 'answered', reused: false, recordId: null });
    expect(d.calls).toHaveLength(2);
    expect(records()).toBe(1);
  });
});
