// Overlord W1 door process B1, Task 9 (the witness half; plan `w1-door-process.md`): `witnessVerdict` and the latch's deciders
// (the shared oracles the mutation floor runs too), the hook report store's witness-check writer and reads, and the ports the
// composition root hands gates B's runner (`continuity/witnessPorts.ts`): the capability gate, the verdict over a real
// fixture `coord.db`, the recorder's three answers, and THE LATCH (the third unwitnessed in a day).
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { describe, it, expect, afterEach, afterAll, beforeAll, vi } from 'vitest';
import path from 'node:path';
import * as hookReports from '../src/continuity/hookReports.js';
import { unwitnessedLatchCases, witnessVerdictCases } from './sim/witnessSets.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { genExpectOf, type MintInput } from '../src/continuity/continuityStore.js';
import {
  insertHookReport, recordWitnessCheck, startReceivedAtOf, unwitnessedSince, usedWitnesses, type WitnessCheckInput,
} from '../src/continuity/hookReportStore.js';
import { witnessPorts } from '../src/continuity/witnessPorts.js';
import { DOOR_WITNESS_CAP } from '../src/ccdargv.js';
import { NO_LADDER_AUTHORITY } from '../src/coord/overlordAuthorityJournal.js';
import type { WitnessCheck } from '../src/coord/overlordGateRun.js';
import { REPORT_KEEP_MS, WITNESS_WINDOW_MS } from '../../shared/continuity-reports.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// ONE coord.db for the file (opening one runs every migration, which is slow on a loaded box): each case wipes the tables it
// reads, and a case that needs a table missing renames it away (`gone`) and the hook below puts it back.
let shared: CoordStore | undefined;
const renamed: { s: CoordStore; t: string }[] = [];
const restoreGone = (): void => { for (const { s, t } of renamed.splice(0)) s.db.exec(`ALTER TABLE ${t}_gone RENAME TO ${t}`); };
afterEach(() => { restoreGone(); vi.restoreAllMocks(); });
afterAll(() => { shared?.db.close(); removeTmpFixtures(); });
const gone = (s: CoordStore, t: string): void => { s.db.exec(`ALTER TABLE ${t} RENAME TO ${t}_gone`); renamed.push({ s, t }); };

const NOW = 1_800_000_000_000;
const START_AT = NOW - 600_000;
const SESSION = 'lane-a-overlord';
const KEY = 'ab'.repeat(32);
const DAY = 24 * 3_600_000;

describe('witnessVerdict: the shared oracle (the mutation floor runs the same cases)', () => {
  for (const [name, fn] of Object.entries(witnessVerdictCases(hookReports))) it(name, fn);
});
describe('unwitnessedLatchDue and latchWindowStart: the shared oracle', () => {
  for (const [name, fn] of Object.entries(unwitnessedLatchCases(hookReports))) it(name, fn);
});

const WIPED = ['continuity_witness_checks', 'continuity_hook_reports', 'overlord_latches', 'continuity_generations', 'continuity_act_keys', 'continuity_starts'];
const store = (): CoordStore => {
  shared ??= new CoordStore(openCoordDb(path.join(mkTmp('ccrc-witness-'), '.ccrc', 'coord.db')));
  for (const t of WIPED) shared.db.exec(`DELETE FROM ${t}`);
  return shared;
};
let reports = 0;
/** A store holding one live generation whose start was received at `startAt`. */
function withGeneration(startAt = START_AT): { s: CoordStore; g: number; startId: number } {
  const s = store();
  reports += 1;
  const r = s.insertStart({ sessionId: SESSION, reportId: `r-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: startAt - 5_000, receivedAt: startAt, doorNonceSha256: null });
  if (!r.ok) throw new Error('start not recorded');
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((x) => x.identity === 'overlord');
  const mint: MintInput = {
    identity: 'overlord', sessionId: SESSION, role: 'coordinator', term: 1, rowIncarnation: null, startId: r.id, startReportedAt: startAt,
    resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: startAt,
  };
  const m = s.mintGeneration(mint, old === undefined ? null : genExpectOf(old), true);
  if (!m.ok) throw new Error('not minted');
  return { s, g: m.id, startId: r.id };
}

const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const caller = { actor: undefined as never as Awaited<ReturnType<typeof identity.session>> extends infer C ? (C extends { ok: true; actor: infer A } ? A : never) : never };
beforeAll(async () => {
  const c = await identity.session(SESSION, 'uuid-a', 'byUuid');
  if (!c.ok) throw new Error('fixture caller');
  (caller as { actor: unknown }).actor = c.actor;
});

const witnessRow = (s: CoordStore, receivedAt: number, over: { agentId?: string | null; key?: string } = {}): number => {
  const r = insertHookReport(s.db, SESSION, { kind: 'witness', key: over.key ?? KEY, tool: 'mcp__door__notes', agentId: over.agentId ?? null, at: receivedAt }, receivedAt);
  if (!r.ok) throw new Error('witness not stored');
  return r.value.id;
};
const checkRows = (s: CoordStore): { witnessId: number | null; outcome: string; why: string | null; at: number }[] =>
  s.db.prepare('SELECT witnessId, outcome, why, at FROM continuity_witness_checks ORDER BY id').all() as never;
const check = (over: Partial<WitnessCheckInput> = {}): WitnessCheckInput =>
  ({ sessionId: SESSION, generationId: 1, outcome: 'unwitnessed', witnessId: null, why: 'none', at: NOW, ...over });

describe('recordWitnessCheck', () => {
  it('writes a used row and an unwitnessed row, answering the row id', () => {
    const { s } = withGeneration();
    const a = recordWitnessCheck(s.db, check({ outcome: 'used', witnessId: 7, why: null }));
    expect(a).toEqual({ ok: true, value: { id: expect.any(Number) } });
    expect(recordWitnessCheck(s.db, check({ why: 'stale' })).ok).toBe(true);
    expect(recordWitnessCheck(s.db, check({ why: 'stale' })).ok).toBe(true);
    expect(checkRows(s)).toEqual([
      { witnessId: 7, outcome: 'used', why: null, at: NOW }, { witnessId: null, outcome: 'unwitnessed', why: 'stale', at: NOW },
      { witnessId: null, outcome: 'unwitnessed', why: 'stale', at: NOW },
    ]);
  });
  it('a second use of the same witness is REFUSED, never thrown, and writes nothing', () => {
    const { s } = withGeneration();
    expect(recordWitnessCheck(s.db, check({ outcome: 'used', witnessId: 7, why: null })).ok).toBe(true);
    const again = recordWitnessCheck(s.db, check({ outcome: 'used', witnessId: 7, why: null, at: NOW + 5 }));
    expect(again).toMatchObject({ ok: false, error: 'refused' });
    expect(checkRows(s)).toHaveLength(1);
  });
  it('a write that fails is write-failed, apart from a refusal', () => {
    const { s } = withGeneration();
    gone(s, 'continuity_witness_checks');
    expect(recordWitnessCheck(s.db, check())).toMatchObject({ ok: false, error: 'write-failed' });
  });
  it('prunes this table\'s rows older than the keep in the same transaction, and keeps a row at the boundary', () => {
    const { s } = withGeneration();
    const ins = s.db.prepare("INSERT INTO continuity_witness_checks (sessionId, generationId, witnessKey, witnessId, outcome, why, at) VALUES (?, 1, NULL, ?, 'used', NULL, ?)");
    ins.run(SESSION, 1, NOW - REPORT_KEEP_MS - 1);
    ins.run(SESSION, 2, NOW - REPORT_KEEP_MS);
    expect(recordWitnessCheck(s.db, check()).ok).toBe(true);
    expect(checkRows(s).map((r) => r.witnessId)).toEqual([2, null]);
  });
  it('a refused write prunes nothing (the one transaction rolled back)', () => {
    const { s } = withGeneration();
    const ins = s.db.prepare("INSERT INTO continuity_witness_checks (sessionId, generationId, witnessKey, witnessId, outcome, why, at) VALUES (?, 1, NULL, ?, 'used', NULL, ?)");
    ins.run(SESSION, 2, NOW - REPORT_KEEP_MS - 10);   // expired: the write's prune would delete it
    ins.run(SESSION, 1, NOW - 1);
    expect(recordWitnessCheck(s.db, check({ outcome: 'used', witnessId: 1, why: null }))).toMatchObject({ ok: false, error: 'refused' });
    expect(checkRows(s).map((r) => r.witnessId)).toEqual([2, 1]);
  });
});

describe('the witness-check reads keep unmeasured apart', () => {
  it('usedWitnesses: an empty id list is a measured empty set; found ids come back; a failed read is unmeasured', () => {
    const { s } = withGeneration();
    recordWitnessCheck(s.db, check({ outcome: 'used', witnessId: 7, why: null }));
    expect(usedWitnesses(s.db, [])).toEqual({ ok: true, value: new Set() });
    expect(usedWitnesses(s.db, [6, 7, 8])).toEqual({ ok: true, value: new Set([7]) });
    gone(s, 'continuity_witness_checks');
    expect(usedWitnesses(s.db, [7])).toMatchObject({ ok: false, detail: expect.stringContaining('continuity_witness_checks') });
  });
  it('unwitnessedSince: only this session\'s unwitnessed rows at or after since; zero is measured; a failed read is unmeasured', () => {
    const { s } = withGeneration();
    expect(unwitnessedSince(s.db, SESSION, 0)).toEqual({ ok: true, value: 0 });
    recordWitnessCheck(s.db, check({ at: 100 }));
    recordWitnessCheck(s.db, check({ at: 200 }));
    recordWitnessCheck(s.db, check({ sessionId: 'lane-a-other', at: 200 }));
    recordWitnessCheck(s.db, check({ outcome: 'used', witnessId: 9, why: null, at: 200 }));
    expect(unwitnessedSince(s.db, SESSION, 0)).toEqual({ ok: true, value: 2 });
    expect(unwitnessedSince(s.db, SESSION, 200)).toEqual({ ok: true, value: 1 });
    expect(unwitnessedSince(s.db, SESSION, 201)).toEqual({ ok: true, value: 0 });
    gone(s, 'continuity_witness_checks');
    expect(unwitnessedSince(s.db, SESSION, 0)).toMatchObject({ ok: false });
  });
  it('startReceivedAtOf: the start row\'s server receipt time; an absent row and a failed read are unmeasured', () => {
    const { s, startId } = withGeneration();
    expect(startReceivedAtOf(s.db, startId)).toEqual({ ok: true, value: START_AT });
    expect(startReceivedAtOf(s.db, startId + 99)).toMatchObject({ ok: false });
    gone(s, 'continuity_starts');
    expect(startReceivedAtOf(s.db, startId)).toMatchObject({ ok: false });
  });
});

interface Rig {
  s: CoordStore; g: number; ports: ReturnType<typeof witnessPorts>; pushes: { title: string; body: string }[];
  clock: { now: number }; fresh: () => ReturnType<typeof witnessPorts>;
}
function rig(opts: { verbs?: readonly string[] | null; journal?: Parameters<typeof witnessPorts>[0]['journal']; startAt?: number } = {}): Rig {
  const { s, g } = withGeneration(opts.startAt);
  const clock = { now: NOW };
  const pushes: { title: string; body: string }[] = [];
  let n = 0;
  const verbs = opts.verbs === undefined ? [DOOR_WITNESS_CAP] : opts.verbs;
  const fresh = () => witnessPorts({
    coord: s, fleetState: () => ({ ccdVerbs: verbs === null ? null : [...verbs] }), journal: opts.journal ?? NO_LADDER_AUTHORITY,
    clock: { wall: () => clock.now }, entropy: { hex: () => { n += 1; return String(n).padStart(32, '0'); } },
    push: (p) => { pushes.push(p); },
  });
  return { s, g, ports: fresh(), pushes, clock, fresh };
}
const unw = (r: Rig, ports = r.ports, at = r.clock.now): boolean => {
  r.clock.now = at;
  const c: WitnessCheck = { sessionId: SESSION, generationId: r.g, door: 'notes-write', outcome: 'unwitnessed', witnessId: null, why: 'none', at, actor: caller.actor };
  return ports.recordWitness(c);
};
const latchRows = (s: CoordStore): { cause: string; cap: string; clearedAt: number | null }[] =>
  s.db.prepare("SELECT cause, cap, clearedAt FROM overlord_latches WHERE cause = 'unwitnessed-third' ORDER BY id").all() as never;

describe('the witness port', () => {
  it('answers unmeasured until the fleet node\'s ccd advertises door-witness-v1 (no evidence is no word)', () => {
    for (const verbs of [null, [], ['keep-awake-v1']] as const) {
      const r = rig({ verbs });
      witnessRow(r.s, NOW - 1000);
      expect(r.ports.witness(SESSION, r.g, KEY), String(verbs)).toEqual({ kind: 'unmeasured', why: 'the fleet\'s hook sends no witness yet' });
    }
  });
  it('with the word it answers the verdict over the stored witnesses', () => {
    const r = rig();
    expect(r.ports.witness(SESSION, r.g, KEY)).toEqual({ kind: 'unwitnessed', why: 'none' });
    expect(r.ports.witness(SESSION, r.g, null)).toEqual({ kind: 'unwitnessed', why: 'none' });
    const id = witnessRow(r.s, NOW - 1000);
    expect(r.ports.witness(SESSION, r.g, KEY)).toEqual({ kind: 'witnessed', witnessId: id });
    expect(r.ports.witness(SESSION, r.g, 'cd'.repeat(32))).toEqual({ kind: 'unwitnessed', why: 'none' });
    r.clock.now = NOW + WITNESS_WINDOW_MS;
    expect(r.ports.witness(SESSION, r.g, KEY)).toEqual({ kind: 'unwitnessed', why: 'stale' });
  });
  it('a witness received before the generation\'s start is before-generation; a reader\'s is reader-scope', () => {
    const r = rig({ startAt: NOW - 30_000 });
    witnessRow(r.s, NOW - 30_001);
    expect(r.ports.witness(SESSION, r.g, KEY)).toEqual({ kind: 'unwitnessed', why: 'before-generation' });
    const r2 = rig();
    witnessRow(r2.s, NOW - 10, { agentId: 'agent-1' });
    expect(r2.ports.witness(SESSION, r2.g, KEY)).toEqual({ kind: 'unwitnessed', why: 'reader-scope' });
  });
  it('a used witness is used, and a spent one is not taken twice', () => {
    const r = rig();
    const id = witnessRow(r.s, NOW - 1000);
    expect(r.ports.recordWitness({ sessionId: SESSION, generationId: r.g, door: 'notes-write', outcome: 'used', witnessId: id, why: null, at: NOW, actor: caller.actor })).toBe(true);
    expect(r.ports.witness(SESSION, r.g, KEY)).toEqual({ kind: 'unwitnessed', why: 'used' });
  });
  it('answers unmeasured for a generation it cannot find, a start it cannot read and a store it cannot read', () => {
    const r = rig();
    expect(r.ports.witness(SESSION, r.g + 99, KEY)).toMatchObject({ kind: 'unmeasured' });
    gone(r.s, 'continuity_hook_reports');
    expect(r.ports.witness(SESSION, r.g, KEY)).toMatchObject({ kind: 'unmeasured' });
    restoreGone();
    const q = rig();
    gone(q.s, 'continuity_witness_checks');
    witnessRow(q.s, NOW - 10);
    expect(q.ports.witness(SESSION, q.g, KEY)).toMatchObject({ kind: 'unmeasured' });
  });
  it('with no coordination store both ports refuse: unmeasured, and a recorder that did not record', () => {
    const ports = witnessPorts({ coord: undefined, fleetState: () => ({ ccdVerbs: [DOOR_WITNESS_CAP] }), journal: NO_LADDER_AUTHORITY,
      clock: { wall: () => NOW }, entropy: { hex: () => 'a'.repeat(32) }, push: () => undefined });
    expect(ports.witness(SESSION, 1, KEY)).toMatchObject({ kind: 'unmeasured' });
    expect(ports.recordWitness({ sessionId: SESSION, generationId: 1, door: 'd', outcome: 'unwitnessed', witnessId: null, why: 'none', at: NOW, actor: caller.actor })).toBe(false);
  });
});

describe('the recorder', () => {
  it('writes used and unwitnessed and answers true only when it wrote', () => {
    const r = rig();
    const id = witnessRow(r.s, NOW - 1000);
    const used: WitnessCheck = { sessionId: SESSION, generationId: r.g, door: 'notes-write', outcome: 'used', witnessId: id, why: null, at: NOW, actor: caller.actor };
    expect(r.ports.recordWitness(used)).toBe(true);
    expect(r.ports.recordWitness(used)).toBe(false);   // the witness is already used: refused, not spent twice
    expect(unw(r)).toBe(true);
    expect(checkRows(r.s)).toEqual([
      { witnessId: id, outcome: 'used', why: null, at: NOW }, { witnessId: null, outcome: 'unwitnessed', why: 'none', at: NOW },
    ]);
  });
  it('answers false when the write failed', () => {
    const r = rig();
    gone(r.s, 'continuity_witness_checks');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(unw(r)).toBe(false);
  });
});

describe('the unwitnessed latch', () => {
  it('the third unwitnessed in 24 hours raises it once (cap advise) and pushes once; a fourth raises and pushes nothing', () => {
    const r = rig();
    expect(unw(r)).toBe(true);
    expect(unw(r, r.ports, NOW + 1)).toBe(true);
    expect(latchRows(r.s)).toEqual([]);
    expect(r.pushes).toHaveLength(0);
    expect(unw(r, r.ports, NOW + 2)).toBe(true);
    expect(latchRows(r.s)).toEqual([{ cause: 'unwitnessed-third', cap: 'advise', clearedAt: null }]);
    // Raised under the attributed caller's actor: a brake takes only a minted actor, and the server has none (slug latch-raised-under-the-callers-actor).
    expect(r.s.db.prepare("SELECT raisedBy FROM overlord_latches WHERE cause = 'unwitnessed-third'").all()).toEqual([{ raisedBy: SESSION }]);
    expect(r.pushes).toHaveLength(1);
    expect(unw(r, r.ports, NOW + 3)).toBe(true);
    expect(latchRows(r.s)).toHaveLength(1);
    expect(r.pushes).toHaveLength(1);
  });
  it('an unwitnessed older than 24 hours is not counted', () => {
    const r = rig();
    unw(r, r.ports, NOW);
    unw(r, r.ports, NOW + 1);
    unw(r, r.ports, NOW + DAY + 2);
    expect(latchRows(r.s)).toEqual([]);
    unw(r, r.ports, NOW + DAY + 3);
    expect(latchRows(r.s)).toEqual([]);
    unw(r, r.ports, NOW + DAY + 4);
    expect(latchRows(r.s)).toHaveLength(1);
  });
  it('after the operator\'s clear, two more do not raise it and a third does', () => {
    const r = rig();
    for (let i = 0; i < 3; i += 1) unw(r, r.ports, NOW + i);
    expect(r.pushes).toHaveLength(1);
    r.s.db.prepare("UPDATE overlord_latches SET clearedAt = ?, clearedBy = 'operator', clearSequence = 1 WHERE cause = 'unwitnessed-third'").run(NOW + 10);
    unw(r, r.ports, NOW + 11);
    unw(r, r.ports, NOW + 12);
    expect(latchRows(r.s).filter((l) => l.clearedAt === null)).toEqual([]);
    expect(r.pushes).toHaveLength(1);
    unw(r, r.ports, NOW + 13);
    expect(latchRows(r.s).filter((l) => l.clearedAt === null)).toHaveLength(1);
    expect(r.pushes).toHaveLength(2);
  });
  it('the count survives a restart: a new ports object over the same database', () => {
    const r = rig();
    unw(r, r.ports, NOW);
    unw(r, r.ports, NOW + 1);
    const restarted = r.fresh();
    unw(r, restarted, NOW + 2);
    expect(latchRows(r.s)).toHaveLength(1);
    expect(r.pushes).toHaveLength(1);
  });
  it('a latch path that fails is logged and never changes the recorder\'s answer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig({ journal: { appendInTx: () => { throw new Error('journal gone'); } } });
    for (let i = 0; i < 3; i += 1) expect(unw(r, r.ports, NOW + i)).toBe(true);
    expect(latchRows(r.s)).toEqual([]);
    expect(r.pushes).toHaveLength(0);
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('ccrc-server: '))).toBe(true);
  });
  it('a push that throws is logged and never changes the recorder\'s answer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { s, g } = withGeneration();
    const ports = witnessPorts({ coord: s, fleetState: () => ({ ccdVerbs: [DOOR_WITNESS_CAP] }), journal: NO_LADDER_AUTHORITY,
      clock: { wall: () => NOW }, entropy: { hex: () => 'b'.repeat(32) }, push: () => { throw new Error('push down'); } });
    const c: WitnessCheck = { sessionId: SESSION, generationId: g, door: 'd', outcome: 'unwitnessed', witnessId: null, why: 'none', at: NOW, actor: caller.actor };
    expect([ports.recordWitness(c), ports.recordWitness(c), ports.recordWitness(c)]).toEqual([true, true, true]);
    expect(latchRows(s)).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });
  it('a used record never counts toward the latch', () => {
    const r = rig();
    for (let i = 0; i < 4; i += 1) {
      const id = witnessRow(r.s, NOW - 1000 + i);
      r.ports.recordWitness({ sessionId: SESSION, generationId: r.g, door: 'd', outcome: 'used', witnessId: id, why: null, at: NOW + i, actor: caller.actor });
    }
    expect(latchRows(r.s)).toEqual([]);
  });
});
