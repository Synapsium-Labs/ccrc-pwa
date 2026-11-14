// The generations piece's deciders, their oracles and mutant sets (Overlord W1a, the generations plan): `startVerdict`
// (what a reported start does to an identity's generations) and `waveBoundaryOf`. The cases are written ONCE here, as
// suite cases over a module: `continuity-generation-start.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  GENERATION_STATES, RENEWAL_LANE_PERIOD_MS, START_SOURCES, type GenerationOutcome, type GenerationState, type StartSource,
} from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { RoleReading } from '../../src/roleOf.js';
import type { HoldClock, PlanStart, StartFacts, StartSkip, StartVerdict } from '../../src/continuity/generationStart.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type GenerationStartModule = typeof import('../../src/continuity/generationStart.js');

const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T = 1_000_000;

const roles: RoleReading[] = [
  ...(['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain'] as FleetRole[]).map((role) => ({ kind: 'role' as const, role })),
  { kind: 'undecided', between: 'coordinator-or-plain' }, { kind: 'undecided', between: 'worker-or-reviewer' },
];
const registries: StartFacts['registry'][] = [
  { kind: 'absent' },
  { kind: 'row', uuid: OWN, lane: 'lane-a' }, { kind: 'row', uuid: OWN, lane: 'lane-b' },
  { kind: 'row', uuid: OTHER, lane: 'lane-a' }, { kind: 'row', uuid: null, lane: 'lane-a' }, { kind: 'row', uuid: OWN, lane: null },
];
const lives: StartFacts['live'][] = [null,
  ...(['active', 'degraded', 'carded', 'probing', 'draining', 'checkpointed', 'clearing'] as GenerationState[]).flatMap((state) => [
    { state, reportedAt: T - 10, rowIncarnation: 'inc-1', lane: 'lane-a' },
    { state, reportedAt: T - 10, rowIncarnation: 'inc-2', lane: 'lane-a' },
    { state, reportedAt: T + 10, rowIncarnation: 'inc-1', lane: 'lane-a' },
    { state, reportedAt: T, rowIncarnation: null, lane: null },
  ]),
];

/** Every combination: six sources, six registry reads, nine role readings, 29 live rows, two incarnations, and whether
 *  the start is its identity's newest in the pass (review 2003 F4). */
export function startFactCases(): StartFacts[] {
  const out: StartFacts[] = [];
  for (const source of START_SOURCES as StartSource[])
    for (const registry of registries) for (const role of roles) for (const live of lives)
      for (const rowIncarnation of ['inc-1', null]) for (const newest of [true, false]) {
        out.push({ source, uuid: OWN, reportedAt: T, rowIncarnation, registry, role, newest, live });
      }
  return out;
}

/** The plan's and the reviews' words, written out rather than read off `startVerdict`'s code. */
export function expectedStart(f: StartFacts): StartVerdict {
  const no = (skip: Extract<StartVerdict, { mint: false }>['skip']): StartVerdict => ({ mint: false, skip });
  if (f.source === 'compact' || f.source === 'fork') return no(f.source);
  if (f.registry.kind === 'absent') return no('unregistered');
  if (f.source !== 'startup' && f.registry.uuid === null) return no('uuid-unmeasured');
  if (f.source !== 'startup' && f.registry.uuid !== f.uuid) return no('foreign-uuid');
  if (f.live !== null && f.reportedAt < f.live.reportedAt) return no('late');
  if (f.role.kind === 'undecided') return no('undecided');
  if (!(f.role.role === 'overlord' || f.role.role === 'coordinator')) return no('not-long-lived');
  // Only the identity's newest start in the pass is read against the registry's account (review 2003 F4).
  let outcome: GenerationOutcome = 'woken';
  const old = f.live;
  const lane = f.registry.lane;
  if (!f.newest) outcome = 'unmeasured';
  else if (old !== null && old.state === 'clearing') outcome = 'renewed';
  else if (old !== null && (lane === null || old.lane === null)) outcome = 'unmeasured';
  else if (old !== null && lane !== old.lane) outcome = 'swapped';
  // A `/clear` is not a crash (review 2006): on the same row and account it reads `cleared`, whatever the state.
  else if (old !== null && f.source === 'clear' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) outcome = 'cleared';
  else if (old !== null && old.state === 'active' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) outcome = 'crashed';
  return { mint: true, role: f.role.role, outcome, resumed: f.source === 'resume', lane: f.newest ? lane : null };
}

export function startVerdictCases(m: GenerationStartModule): Record<string, SuiteCase> {
  const cases = startFactCases();
  return {
    'enumerates 37584 cases': () => { expect(cases.length).toBe(37_584); },
    'startVerdict answers the plan\'s rules for every case': () => {
      for (const f of cases) {
        const got = m.startVerdict(f);
        const want = expectedStart(f);
        if (JSON.stringify(got) !== JSON.stringify(want)) expect(got, JSON.stringify(f)).toEqual(want);
      }
    },
    'every skip word is reachable, and the long-lived roles are the ones with renewal rows': () => {
      const seen = new Set(cases.map((f) => { const v = m.startVerdict(f); return v.mint ? 'mint' : v.skip; }));
      expect([...seen].sort()).toEqual(['mint', ...m.START_SKIPS].sort());
      expect((['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain'] as FleetRole[]).filter(m.longLived))
        .toEqual(['overlord', 'coordinator']);
    },
  };
}

const runRows = (...xs: [string, string][]): { state: string; program: string }[] => xs.map(([state, program]) => ({ state, program }));

export function waveBoundaryCases(m: GenerationStartModule): Record<string, SuiteCase> {
  return {
    'the newest work run open and the one before it closed, of one programme, is a boundary': () => {
      expect(m.waveBoundaryOf(runRows(['working', 'p'], ['done', 'p']))).toBe(true);
      expect(m.waveBoundaryOf(runRows(['dispatched', 'p'], ['failed', 'p']))).toBe(true);
    },
    'anything else is not': () => {
      expect(m.waveBoundaryOf([])).toBe(false);
      expect(m.waveBoundaryOf(runRows(['working', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['working', 'p'], ['working', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['done', 'p'], ['done', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['done', 'p'], ['working', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['working', 'p'], ['done', 'q']))).toBe(false);
    },
  };
}

const START_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'S1 compact mints', old: "  if (f.source === 'compact') return 'compact';\n", new: '' },
    { id: 'S2 fork mints', old: "  if (f.source === 'fork') return 'fork';\n", new: '' },
    { id: 'S3 an unlisted row mints', old: "  if (f.registry.kind === 'absent') return 'unregistered';\n", new: '' },
    { id: 'S4 startup checked too', old: "  if (f.source !== 'startup') {", new: '  if (true) {' },
    { id: 'S5 no uuid check', old: "    if (f.registry.uuid !== f.uuid) return 'foreign-uuid';\n", new: '' },
    { id: 'S6 an unreadable uuid passes', old: "    if (f.registry.uuid === null) return 'uuid-unmeasured';\n", new: '' },
    { id: 'S7 late by receipt only', old: 'f.reportedAt < f.live.reportedAt', new: 'f.reportedAt < f.live.reportedAt - 100' },
    { id: 'S8 late inclusive', old: 'f.reportedAt < f.live.reportedAt', new: 'f.reportedAt <= f.live.reportedAt' },
    { id: 'S9 undecided mints as its first role', old: "  if (f.role.kind === 'undecided') return skip('undecided');\n", new: "  if (f.role.kind === 'undecided') return { mint: true, role: 'coordinator', outcome: startOutcome(f), resumed: false, lane: null };\n" },
    { id: 'S10 every role long-lived', old: 'return RENEWAL_ROWS[role].length > 0;', new: 'return RENEWAL_ROWS[role] !== undefined;' },
    { id: 'S11 never renewed', old: "if (old.state === 'clearing') return 'renewed';", new: '' },
    { id: 'S12 swap ignored', old: "  if (lane !== old.lane) return 'swapped';\n", new: '' },
    { id: 'S13 crash on any state', old: "if (sameRow && old.state === 'active') return 'crashed';", new: "if (sameRow) return 'crashed';" },
    { id: 'S14 crash across incarnations', old: 'const sameRow = f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation;', new: 'const sameRow = f.rowIncarnation !== null;' },
    { id: 'S15 resumed on every source', old: "resumed: f.source === 'resume'", new: "resumed: f.source !== 'startup'" },
    { id: 'S16 crash before swap', old: "  if (lane !== old.lane) return 'swapped';\n  const sameRow = f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation;\n", new: "  const sameRow = f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation;\n  if (sameRow && old.state === 'active' && f.source !== 'clear') return 'crashed';\n  if (lane !== old.lane) return 'swapped';\n" },
    { id: 'S17 an unknown account is read as the same', old: "  if (lane === null || old.lane === null) return 'unmeasured';\n", new: "  if (lane === null || old.lane === null) return 'woken';\n" },
    { id: 'S18 an older start\'s outcome trusted', old: "outcome: f.newest ? startOutcome(f) : 'unmeasured'", new: 'outcome: startOutcome(f)' },
    { id: 'S19 an older start records the account', old: "const lane = f.newest && f.registry.kind === 'row'", new: "const lane = f.registry.kind === 'row'" },
    { id: 'S20 a clear reads crashed', old: "  if (sameRow && f.source === 'clear') return 'cleared';\n", new: '' },
    { id: 'S21 every planned-looking source reads cleared', old: "if (sameRow && f.source === 'clear')", new: "if (sameRow && f.source !== 'startup')" },
    { id: 'S22 a clear on another incarnation reads cleared', old: "if (sameRow && f.source === 'clear')", new: "if (f.source === 'clear')" },
  ],
  suite: startVerdictCases,
};

const WAVE_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'W1 any programme', old: 'newest.program === before.program\n    && ', new: '' },
    { id: 'W2 newest may be closed', old: '!closed(newest.state) && ', new: '' },
    { id: 'W3 before may be open', old: ' && closed(before.state);', new: ';' },
    { id: 'W4 one run is enough', old: 'newest !== undefined && before !== undefined && newest.program === before.program', new: 'newest !== undefined && (before === undefined || newest.program === before.program)' },
  ],
  suite: waveBoundaryCases,
};

const NOW = 50_000_000;
const RETRY_MS = 5 * RENEWAL_LANE_PERIOD_MS;
const AGES = [-1, 0, 1, RETRY_MS - 1, RETRY_MS, RETRY_MS + 1];
/** The hold's words, written out (review 2003 F2; review 2006 R1 and R3): a start received at or after the listing waits,
 *  whatever its skip; else only a failed registry read holds it, while it is younger than about five passes by a clock
 *  clamped to its receipt, and past that until this process has held it once. */
const expectedHold = (skip: StartSkip | null, age: number, listedAfterReceipt: number, retried: boolean): 'listing' | 'read' | null => {
  if (listedAfterReceipt <= 0) return 'listing';
  if (skip !== 'unregistered' && skip !== 'uuid-unmeasured') return null;
  const aged = Math.max(age, 0) >= RETRY_MS;
  return !aged || !retried ? 'read' : null;
};

export function startHoldCases(m: GenerationStartModule): Record<string, SuiteCase> {
  return {
    'START_RETRY_MS is five lane periods': () => { expect(m.START_RETRY_MS).toBe(RETRY_MS); },
    'a start waits when the listing may predate it, or for a failed read inside the bound, or until this process held it once': () => {
      for (const skip of [...m.START_SKIPS, null]) for (const age of AGES) for (const listed of [-1, 0, 1]) for (const retried of [true, false]) {
        const receivedAt = NOW - age;
        const at: HoldClock = { now: NOW, listedAt: receivedAt + listed, retried: new Set(retried ? [7] : [8]) };
        expect(m.startHold(skip, { id: 7, receivedAt }, at), `${skip} at ${age}, listed ${listed}, retried ${retried}`)
          .toBe(expectedHold(skip, age, listed, retried));
      }
    },
  };
}

const ps = (id: number, sessionId: string, source: StartSource, reportedAt: number, receivedAt: number, uuid = OWN): PlanStart & { rowIncarnation: string | null } =>
  ({ id, sessionId, source, uuid, reportedAt, receivedAt, rowIncarnation: 'inc-1' });
const listed = (now: number, retried: readonly number[] = []): HoldClock => ({ now, listedAt: now, retried: new Set(retried) });
const own: StartFacts['registry'] = { kind: 'row', uuid: OWN, lane: 'lane-a' };
const unread: StartFacts['registry'] = { kind: 'row', uuid: null, lane: 'lane-a' };
const ids = (xs: readonly { id: number }[]): number[] => xs.map((x) => x.id);

export function startBatchCases(m: GenerationStartModule): Record<string, SuiteCase> {
  const plan = (starts: Parameters<GenerationStartModule['planStartBatch']>[0], reg: (id: string) => StartFacts['registry'], at: HoldClock, from = 0) =>
    m.planStartBatch(starts, from, reg, at);
  return {
    'no starts: nothing judged and the cursor stays': () => {
      expect(plan([], () => own, listed(NOW))).toEqual({ judged: [], waiting: [], heldForRead: [], advanceTo: null });
    },
    'every start judged in its session\'s own order, and the cursor moves past the highest id': () => {
      const p = plan([ps(3, 'a', 'clear', 10, NOW - 9), ps(2, 'a', 'startup', 20, NOW - 9), ps(4, 'b', 'startup', 5, NOW - 9)], () => own, listed(NOW));
      expect(ids(p.judged.map((j) => j.start))).toEqual([4, 3, 2]);
      expect(p.waiting).toEqual([]);
      expect(p.advanceTo).toBe(4);
    },
    'a failed read holds its start and every start after it, and the cursor stays just below the lowest waiting id': () => {
      const reg = (id: string): StartFacts['registry'] => (id === 'h' ? unread : own);
      const p = plan([ps(5, 'a', 'clear', 10, NOW - 9), ps(6, 'h', 'clear', 20, NOW - 9), ps(4, 'b', 'startup', 30, NOW - 9), ps(7, 'b', 'clear', 40, NOW - 9)], reg, listed(NOW), 3);
      expect(ids(p.judged.map((j) => j.start))).toEqual([5]);
      expect(ids(p.waiting)).toEqual([6, 4, 7]);
      expect(p.heldForRead).toEqual([6]);
      expect(p.advanceTo).toBeNull();   // the lowest waiting id is 4, so the cursor would stay at 3
      const q = plan([ps(5, 'a', 'clear', 10, NOW - 9), ps(6, 'h', 'clear', 20, NOW - 9), ps(8, 'b', 'startup', 30, NOW - 9)], reg, listed(NOW), 3);
      expect(q.advanceTo).toBe(5);
    },
    'a start received at or after the listing waits a pass, whatever its skip, and is not a read\'s hold (review 2006 R1)': () => {
      const p = plan([ps(5, 'a', 'clear', 10, NOW - 9), ps(6, 'a', 'clear', 20, NOW), ps(7, 'b', 'compact', 30, NOW + 1)], () => own, listed(NOW));
      expect(ids(p.judged.map((j) => j.start))).toEqual([5]);
      expect(ids(p.waiting)).toEqual([6, 7]);
      expect(p.heldForRead).toEqual([]);
      expect(p.advanceTo).toBe(5);
    },
    'a start that has itself waited out the bound is judged past another\'s hold (review 2006 R8)': () => {
      const reg = (id: string): StartFacts['registry'] => (id === 'h' ? unread : own);
      const p = plan([ps(1, 'h', 'clear', 10, NOW - 9), ps(2, 'b', 'startup', 20, NOW - RETRY_MS), ps(3, 'c', 'startup', 30, NOW - RETRY_MS + 1)], reg, listed(NOW));
      expect(ids(p.judged.map((j) => j.start))).toEqual([2]);
      expect(ids(p.waiting)).toEqual([1, 3]);
      expect(p.advanceTo).toBeNull();
    },
    'newest: only a later start of the same identity that can move the account makes a start older (review 2006 R6)': () => {
      const p = plan([ps(1, 'a', 'clear', 10, NOW - 9), ps(2, 'a', 'compact', 20, NOW - 9), ps(3, 'a', 'fork', 30, NOW - 9),
        ps(4, 'b', 'clear', 10, NOW - 9), ps(5, 'b', 'resume', 20, NOW - 9), ps(6, 'c', 'clear', 50, NOW - 9)], () => own, listed(NOW));
      const newest = Object.fromEntries(p.judged.map((j) => [j.start.id, j.newest]));
      expect(newest).toEqual({ 1: true, 2: true, 3: true, 4: false, 5: true, 6: true });
      // Equal report times fall to id order.
      expect(m.newestStart(ps(1, 'a', 'clear', 10, 0), [ps(1, 'a', 'clear', 10, 0), ps(2, 'a', 'clear', 10, 0)])).toBe(false);
      expect(m.newestStart(ps(2, 'a', 'clear', 10, 0), [ps(1, 'a', 'clear', 10, 0), ps(2, 'a', 'clear', 10, 0)])).toBe(true);
    },
  };
}

export function firstMintCases(m: GenerationStartModule): Record<string, SuiteCase> {
  const coordinator: RoleReading = { kind: 'role', role: 'coordinator' };
  const first = (starts: ReturnType<typeof ps>[], passed: number, reg: StartFacts['registry'], at: HoldClock) =>
    m.firstMintOf(starts, passed, reg, coordinator, at);
  const pick = (r: ReturnType<typeof first>): unknown => (r.kind === 'none' ? 'none' : [r.kind, r.start.id]);
  return {
    'no start the cursor has passed: none': () => {
      expect(pick(first([], 9, own, listed(NOW)))).toBe('none');
      expect(pick(first([ps(5, 'c', 'startup', 10, NOW - 9)], 4, own, listed(NOW)))).toBe('none');
    },
    'the newest start that mints, among those the cursor has passed': () => {
      const starts = [ps(1, 'c', 'startup', 10, NOW - 99), ps(2, 'c', 'clear', 20, NOW - 99), ps(3, 'c', 'clear', 30, NOW - 9)];
      expect(pick(first(starts, 2, own, listed(NOW)))).toEqual(['mint', 2]);
      expect(pick(first(starts, 3, own, listed(NOW)))).toEqual(['mint', 3]);
    },
    'the walk stops at a held start rather than falling through to an older conversation (review 2006 R2)': () => {
      const starts = [ps(1, 'c', 'startup', 10, NOW - 99), ps(2, 'c', 'clear', 20, NOW - 99)];
      expect(pick(first(starts, 2, unread, listed(NOW)))).toEqual(['held', 2]);
      // Past the bound, once this process has held it, it falls through as the batch does.
      expect(pick(first([ps(1, 'c', 'startup', 10, NOW - RETRY_MS), ps(2, 'c', 'clear', 20, NOW - RETRY_MS)], 2, unread, listed(NOW, [2])))).toEqual(['mint', 1]);
    },
    'a start that does not mint falls through, and an older start records no account': () => {
      const foreign = { kind: 'row' as const, uuid: OTHER, lane: 'lane-a' };
      const r = first([ps(1, 'c', 'startup', 10, NOW - 99), ps(2, 'c', 'clear', 20, NOW - 99)], 2, foreign, listed(NOW));
      expect(pick(r)).toEqual(['mint', 1]);
      expect(r.kind === 'mint' ? r.verdict.lane : 'no').toBeNull();
      // A later compaction does not make the clear older: it records the account.
      const k = first([ps(1, 'c', 'clear', 10, NOW - 99), ps(2, 'c', 'compact', 20, NOW - 99)], 2, own, listed(NOW));
      expect(k.kind === 'mint' ? [k.start.id, k.verdict.lane] : 'no').toEqual([1, 'lane-a']);
    },
  };
}

export function judgedForDueCases(m: GenerationStartModule): Record<string, SuiteCase> {
  return {
    'judged when the state column is active or degraded, and never on a live walk': () => {
      for (const state of GENERATION_STATES) expect(m.judgedForDue({ state }), state).toBe(state === 'active' || state === 'degraded');
    },
  };
}

const HOLD_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'H1 every skip held', old: 'if (skip === null || !RETRIED_SKIPS.has(skip)) return null;', new: 'if (skip === null) return null;' },
    { id: 'H2 held for ever', old: "return !startAged(s.receivedAt, at.now) || !at.retried.has(s.id) ? 'read' : null;", new: "return 'read';" },
    { id: 'H3 bound inclusive', old: '- receivedAt >= START_RETRY_MS;', new: '- receivedAt > START_RETRY_MS;' },
    { id: 'H4 a clock behind the receipt reads as aged', old: 'return Math.max(now, receivedAt) - receivedAt >= START_RETRY_MS;', new: 'return now < receivedAt || now - receivedAt >= START_RETRY_MS;' },
    { id: 'H5 a foreign uuid is held too', old: "new Set<StartSkip>(['unregistered', 'uuid-unmeasured'])", new: "new Set<StartSkip>(['unregistered', 'uuid-unmeasured', 'foreign-uuid'])" },
    { id: 'H6 a bound of one pass', old: 'export const START_RETRY_MS = 5 * RENEWAL_LANE_PERIOD_MS;', new: 'export const START_RETRY_MS = RENEWAL_LANE_PERIOD_MS;' },
    { id: 'H7 no listing hold', old: "  if (s.receivedAt >= at.listedAt) return 'listing';\n", new: '' },
    { id: 'H8 a start received at the listing is not held', old: 's.receivedAt >= at.listedAt', new: 's.receivedAt > at.listedAt' },
    { id: 'H9 no retry in this process', old: " || !at.retried.has(s.id) ? 'read'", new: " ? 'read'" },
  ],
  suite: startHoldCases,
};

const BATCH_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'B1 a hold stops nothing after it', old: '    } else if (holding && !startAged(s.receivedAt, at.now)) waiting.push(s);\n    else judged.push(s);', new: '    } else judged.push(s);' },
    { id: 'B2 another\'s hold is unbounded', old: 'holding && !startAged(s.receivedAt, at.now)', new: 'holding' },
    { id: 'B3 receipt order', old: 'const ordered = [...starts].sort(startBefore);', new: 'const ordered = [...starts].sort((a, b) => a.id - b.id);' },
    { id: 'B4 the cursor passes the waiting', old: ': Math.min(...waiting.map((s) => s.id)) - 1;', new: ': Math.max(...ordered.map((s) => s.id));' },
    { id: 'B5 the cursor may stay as a move', old: 'advanceTo: to > from ? to : null', new: 'advanceTo: to' },
    { id: 'B6 a compaction makes a start older', old: ' || ACCOUNT_KEEPING.has(n.source)', new: '' },
    { id: 'B7 every start newest', old: 'return all.every(', new: 'return true || all.every(' },
    { id: 'B8 another identity\'s start makes a start older', old: 'n.sessionId !== s.sessionId || ', new: '' },
    { id: 'B9 a listing hold counts as a read\'s', old: "if (why === 'read') heldForRead.push(s.id);", new: 'heldForRead.push(s.id);' },
  ],
  suite: startBatchCases,
};

const FIRST_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'F1 a start above the cursor mints', old: 'starts.filter((s) => s.id <= passed)', new: 'starts.filter(() => true)' },
    { id: 'F2 oldest first', old: '.sort((a, b) => startBefore(b, a))', new: '.sort(startBefore)' },
    { id: 'F3 falls through a held start', old: "    if (why !== null) return { kind: 'held', start: s, why };\n", new: '' },
    { id: 'F4 every start newest', old: 'live: null, newest: newestStart(s, starts),', new: 'live: null, newest: true,' },
  ],
  suite: firstMintCases,
};

const JUDGED_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'J1 degraded not judged', old: "return g.state === 'active' || g.state === 'degraded';", new: "return g.state === 'active';" },
    { id: 'J2 every state judged', old: "return g.state === 'active' || g.state === 'degraded';", new: "return g.state !== 'ended';" },
  ],
  suite: judgedForDueCases,
};

/** This plan's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const GENERATION_START_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/generationStart.ts#startVerdict': START_SET as MutantSet<never>,
  'server/src/continuity/generationStart.ts#waveBoundaryOf': WAVE_SET as MutantSet<never>,
  'server/src/continuity/generationStart.ts#startHold': HOLD_SET as MutantSet<never>,
  'server/src/continuity/generationStart.ts#planStartBatch': BATCH_SET as MutantSet<never>,
  'server/src/continuity/generationStart.ts#firstMintOf': FIRST_SET as MutantSet<never>,
  'server/src/continuity/generationStart.ts#judgedForDue': JUDGED_SET as MutantSet<never>,
};
