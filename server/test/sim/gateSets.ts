// The gates piece's oracles and mutant sets (Overlord W1, `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md`, Task 1
// and, in PR B, the gate order's deciders). Each reader's cases are written ONCE here, as suite cases over a module:
// `overlord-identity-vocab.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs them against each
// named mutant (D-8217's every-run floors, `GATE_MUTANT_SETS`). The expected words are written out, not read from the code
// the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import { mulberry32 } from '../fakeTime.js';
import { OVERLORD_DOORS } from '../../src/coord/overlordDoors.js';
import type { OverlordDoorRow } from '../../src/coord/overlordDoors.js';
import type { DesignationRead, DesignationView } from '../../../shared/overlord-designation.js';

const IDENTITY_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/overlord-identity.ts');
export const READ_ACTOR_COLUMNS_KEY = 'shared/overlord-identity.ts#readActorColumns';

export type OverlordIdentityModule = typeof import('../../../shared/overlord-identity.js');

const KINDS = ['operator', 'session', 'server'];
const ISSUERS = ['account-gate', 'session-cookie', 'attribution', 'server'];
const STRENGTHS = ['attributed', 'workload', 'operator'];
const unreadable = (column: string) => ({ kind: 'unreadable', column });

/** `readActorColumns`' cases: the good row, each column's bad values, the order of the answer, the subject's bounds. */
export function readActorColumnsCases(m: OverlordIdentityModule): Record<string, SuiteCase> {
  const read = (s: unknown, k: unknown, i: unknown, st: unknown) => m.readActorColumns(s, k, i, st);
  return {
    'every kind, issuer and strength word reads, and the actor carries the columns as given': () => {
      for (const k of KINDS) for (const i of ISSUERS) for (const st of STRENGTHS) {
        expect(read('device:lane-a', k, i, st), `${k} ${i} ${st}`).toEqual({ kind: 'read', actor: { kind: k, subject: 'device:lane-a', issuer: i, strength: st } });
      }
    },
    'a subject that is not a string, or is empty, is unreadable': () => {
      for (const s of [undefined, null, 42, true, ['a'], { a: 1 }, '']) expect(read(s, 'session', 'attribution', 'attributed'), String(s)).toEqual(unreadable('subject'));
    },
    'a subject of exactly 200 characters reads and one of 201 does not': () => {
      expect(read('a'.repeat(200), 'session', 'attribution', 'attributed').kind).toBe('read');
      expect(read('a'.repeat(201), 'session', 'attribution', 'attributed')).toEqual(unreadable('subject'));
    },
    'a subject with a control character is unreadable, wherever it sits': () => {
      for (const s of ['a\nb', '\u0000a', 'a\u007f', 'a\tb', '\u009fa', 'a\rb']) expect(read(s, 'session', 'attribution', 'attributed'), JSON.stringify(s)).toEqual(unreadable('subject'));
    },
    'a kind outside the words, an inherited name or a non-string is unreadable': () => {
      for (const k of ['', 'Operator', 'admin', 'constructor', 'toString', '__proto__', null, undefined, 1, {}, ['operator']]) expect(read('s', k, 'server', 'operator'), String(k)).toEqual(unreadable('kind'));
    },
    'an issuer outside the words, an inherited name or a non-string is unreadable': () => {
      for (const i of ['', 'Server', 'cookie', 'constructor', 'hasOwnProperty', null, undefined, 1, {}, ['server']]) expect(read('s', 'server', i, 'operator'), String(i)).toEqual(unreadable('issuer'));
    },
    'a strength outside the words, an inherited name or a non-string is unreadable': () => {
      for (const st of ['', 'Operator', 'strong', 'constructor', 'valueOf', null, undefined, 1, {}, ['operator']]) expect(read('s', 'server', 'server', st), String(st)).toEqual(unreadable('strength'));
    },
    'the first unreadable column is named, in the order subject, kind, issuer, strength': () => {
      expect(read('', 'x', 'x', 'x')).toEqual(unreadable('subject'));
      expect(read('s', 'x', 'x', 'x')).toEqual(unreadable('kind'));
      expect(read('s', 'session', 'x', 'x')).toEqual(unreadable('issuer'));
      expect(read('s', 'session', 'attribution', 'x')).toEqual(unreadable('strength'));
      expect(read('s', 'session', 'x', 'attributed')).toEqual(unreadable('issuer'));
      expect(read('s', 'x', 'attribution', 'attributed')).toEqual(unreadable('kind'));
    },
  };
}

const suite = (m: OverlordIdentityModule): Record<string, SuiteCase> => readActorColumnsCases(m);

export const READ_ACTOR_COLUMNS_SET: MutantSet<OverlordIdentityModule> = {
  modulePath: IDENTITY_TS,
  suite,
  mutants: [
    // The plan's red check: the strength column is not read.
    { id: 'G-1', old: "  if (!isWord(CALLER_STRENGTH_MAP, strength)) return { kind: 'unreadable', column: 'strength' };\n", new: '' },
    { id: 'G-2', old: "  if (!isWord(ACTOR_ISSUER_MAP, issuer)) return { kind: 'unreadable', column: 'issuer' };\n", new: '' },
    { id: 'G-3', old: "  if (!isWord(ACTOR_KIND_MAP, kind)) return { kind: 'unreadable', column: 'kind' };\n", new: '' },
    { id: 'G-4', old: "typeof subject !== 'string' || subject === '' ||", new: "typeof subject !== 'string' ||" },
    { id: 'G-5', old: 'subject.length > ACTOR_SUBJECT_MAX', new: 'subject.length >= ACTOR_SUBJECT_MAX' },
    { id: 'G-6', old: 'subject.length > ACTOR_SUBJECT_MAX', new: 'subject.length > ACTOR_SUBJECT_MAX + 1' },
    { id: 'G-7', old: ' || /\\p{Cc}/u.test(subject)', new: '' },
    { id: 'G-8', old: "typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)", new: "typeof v === 'string' && v in map" },
    { id: 'G-9', old: "typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)", new: 'Object.prototype.hasOwnProperty.call(map, v as string)' },
    { id: 'G-10', old: "return { kind: 'unreadable', column: 'kind' };", new: "return { kind: 'unreadable', column: 'subject' };" },
    { id: 'G-11', old: "return { kind: 'read', actor: { kind, subject, issuer, strength } };", new: "return { kind: 'read', actor: { kind, subject, issuer: kind as never, strength } };" },
  ],
};

// ---- The gate order's deciders (Overlord W1, gates B, plan Task 4): `server/src/coord/overlordGate.ts`. ----
// The expected answers are written out below, never read from the module the cases judge. `overlord-gate.test.ts` runs
// these cases against the real module and adds its own.
const GATE_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/overlordGate.ts');
export const CALLER_STANDING_KEY = 'server/src/coord/overlordGate.ts#callerStandingOf';
export const FENCE_VERDICT_KEY = 'server/src/coord/overlordGate.ts#fenceVerdict';
export const COUNTER_VERDICT_KEY = 'server/src/coord/overlordGate.ts#counterVerdict';
export const OVERLORD_GATE_KEY = 'server/src/coord/overlordGate.ts#overlordGate';

export type OverlordGateModule = typeof import('../../src/coord/overlordGate.js');

// --- callerStandingOf ---
type IncFixture = { kind: 'measured'; incarnation: string } | { kind: 'unmeasured'; reason: string } | 'not-asked';
const POOLS = { pools: [] as string[], untagged: true };
const BOUND = { sessionId: 'lane-a', generation: 'inc-a' };
const pending = (sessionId: string, kind: 'designate' | 'rebind', generation: string | null) =>
  ({ sessionId, kind, deadlineAt: 2000, since: 1000, actor: 'device-a', generation });
const viewOf = (bound: DesignationView['bound'], pend: DesignationView['pending']): DesignationView => ({
  bound, pending: pend, term: 5, designatedTerm: 5, model: 'opus', accountPools: POOLS, pastIds: [], actor: 'device-a',
  lastAttempt: null, stopsOwed: [],
});
export const DESIGNATION_FIXTURES: Record<string, DesignationRead> = {
  'designated, a bound row': { kind: 'designated', sessionId: 'lane-a', term: 5, row: viewOf(BOUND, null) },
  'not designated, a pending designate with its incarnation': { kind: 'not-designated', row: viewOf(null, pending('lane-b', 'designate', 'inc-b')) },
  'not designated, a pending designate not recorded yet': { kind: 'not-designated', row: viewOf(null, pending('lane-b', 'designate', null)) },
  'not designated, a pending rebind': { kind: 'not-designated', row: viewOf(null, pending('lane-c', 'rebind', 'inc-c')) },
  'designated, with a pending rebind beside the binding': { kind: 'designated', sessionId: 'lane-a', term: 5, row: viewOf(BOUND, pending('lane-c', 'rebind', 'inc-c')) },
  'not designated, no row': { kind: 'not-designated', row: null },
  'unmeasured': { kind: 'unmeasured', why: 'the row is unreadable' },
};
const IDS = ['lane-a', 'lane-b', 'lane-c', 'lane-x'];
/** Where an id sits in a fixture, and the incarnation the designation recorded for it: written out per fixture. */
const PLACES: Record<string, Record<string, { place: 'bound' | 'pending' | 'none'; recorded: string | null }>> = {
  'designated, a bound row': { 'lane-a': { place: 'bound', recorded: 'inc-a' } },
  'not designated, a pending designate with its incarnation': { 'lane-b': { place: 'pending', recorded: 'inc-b' } },
  'not designated, a pending designate not recorded yet': { 'lane-b': { place: 'pending', recorded: null } },
  'designated, with a pending rebind beside the binding': { 'lane-a': { place: 'bound', recorded: 'inc-a' } },
};
type Standing = { kind: string; word?: string };
function expectedStanding(fixture: string, id: string, inc: IncFixture): Standing {
  if (fixture === 'unmeasured') return { kind: 'unmeasured', word: 'unavailable' };
  const at = PLACES[fixture]?.[id] ?? { place: 'none', recorded: null };
  if (at.place === 'none') return { kind: 'other' };
  if (inc === 'not-asked') return { kind: 'unmeasured', word: 'unavailable' };
  if (at.recorded === null) return { kind: 'pending-unrecorded' };
  if (inc.kind === 'unmeasured') return inc.reason === 'absent' ? { kind: 'other-incarnation' } : { kind: 'unmeasured', word: 'registry-unmeasurable' };
  if (inc.incarnation !== at.recorded) return { kind: 'other-incarnation' };
  return { kind: at.place === 'bound' ? 'designated' : 'designated-pending' };
}
const incsFor = (recorded: string | null): Record<string, IncFixture> => ({
  agreeing: { kind: 'measured', incarnation: recorded ?? 'inc-a' },
  differing: { kind: 'measured', incarnation: 'inc-other' },
  absent: { kind: 'unmeasured', reason: 'absent' },
  'another unmeasured reason': { kind: 'unmeasured', reason: 'registry-read-failed' },
  'not asked': 'not-asked',
});
const standOf = (m: OverlordGateModule, id: string, inc: IncFixture, d: DesignationRead) =>
  m.callerStandingOf({ sessionId: id, incarnation: inc as never }, d) as Standing;

export function callerStandingCases(m: OverlordGateModule): Record<string, SuiteCase> {
  return {
    'every designation arm x caller id x incarnation answers the written table': () => {
      let n = 0;
      for (const [name, d] of Object.entries(DESIGNATION_FIXTURES)) {
        for (const id of IDS) {
          for (const [iname, inc] of Object.entries(incsFor(PLACES[name]?.[id]?.recorded ?? null))) {
            const want = expectedStanding(name, id, inc);
            const got = standOf(m, id, inc, d);
            expect(got.kind, `${name} / ${id} / ${iname}`).toBe(want.kind);
            if (want.word !== undefined) expect(got.word, `${name} / ${id} / ${iname}`).toBe(want.word);
            n++;
          }
        }
      }
      expect(n).toBe(7 * 4 * 5);
    },
    'literal pins: a rebind body is other, a differing or absent incarnation is other-incarnation': () => {
      const d = DESIGNATION_FIXTURES['not designated, a pending rebind']!;
      expect(standOf(m, 'lane-c', { kind: 'measured', incarnation: 'inc-c' }, d).kind).toBe('other');
      const bound = DESIGNATION_FIXTURES['designated, a bound row']!;
      expect(standOf(m, 'lane-a', { kind: 'measured', incarnation: 'inc-a' }, bound).kind).toBe('designated');
      expect(standOf(m, 'lane-a', { kind: 'measured', incarnation: 'inc-z' }, bound).kind).toBe('other-incarnation');
      expect(standOf(m, 'lane-a', { kind: 'unmeasured', reason: 'absent' }, bound).kind).toBe('other-incarnation');
      const un = standOf(m, 'lane-a', { kind: 'unmeasured', reason: 'boom' }, bound);
      expect([un.kind, un.word]).toEqual(['unmeasured', 'registry-unmeasurable']);
      const na = standOf(m, 'lane-a', 'not-asked', bound);
      expect([na.kind, na.word]).toEqual(['unmeasured', 'unavailable']);
    },
    'a pending designate whose incarnation is not recorded is pending-unrecorded, whatever the caller read': () => {
      const d = DESIGNATION_FIXTURES['not designated, a pending designate not recorded yet']!;
      for (const inc of [{ kind: 'measured', incarnation: 'inc-b' }, { kind: 'unmeasured', reason: 'absent' }, { kind: 'unmeasured', reason: 'x' }] as IncFixture[]) {
        expect(standOf(m, 'lane-b', inc, d).kind).toBe('pending-unrecorded');
      }
      expect(standOf(m, 'lane-b', 'not-asked', d).kind).toBe('unmeasured');
    },
    'a bound id on a not-designated read is other, never the binding': () => {
      const d: DesignationRead = { kind: 'not-designated', row: viewOf(BOUND, null) };
      expect(standOf(m, 'lane-a', { kind: 'measured', incarnation: 'inc-a' }, d).kind).toBe('other');
    },
    'the unmeasured designation is unavailable for every caller, the reason carried': () => {
      const d = DESIGNATION_FIXTURES.unmeasured!;
      for (const id of IDS) {
        const s = m.callerStandingOf({ sessionId: id, incarnation: 'not-asked' }, d);
        expect(s.kind === 'unmeasured' && s.word).toBe('unavailable');
        expect(s.kind === 'unmeasured' && s.why).toContain('the row is unreadable');
      }
    },
    'incarnationNeeded is true exactly for the bound id and a pending designate id': () => {
      for (const [name, d] of Object.entries(DESIGNATION_FIXTURES)) {
        for (const id of IDS) {
          const want = (PLACES[name]?.[id]?.place ?? 'none') !== 'none';
          expect(m.incarnationNeeded(id, d), `${name} / ${id}`).toBe(want);
        }
      }
    },
  };
}

// --- fenceVerdict and counterVerdict ---
const LIVE = { id: 1, n: 3, term: 5, key: 'match' as const, counter: 4 };
const PRES = { generation: 3, counter: 5, key: true };
const readOf = (live: typeof LIVE | null | Record<string, unknown>) => ({ kind: 'read' as const, live: live as never });
const HEX64 = /[0-9a-f]{64}/;
type FV = { kind: string; word?: string; detail?: string; why?: string | null };

export function fenceVerdictCases(m: OverlordGateModule): Record<string, SuiteCase> {
  const f = (step: 'term' | 'generation', p: Record<string, unknown>, term: number | null, facts: unknown) =>
    m.fenceVerdict(step, p as never, term, facts as never) as FV;
  const refusal = (v: FV, word: string, why: string | null, label: string) => {
    expect([v.kind, v.word, v.why ?? null], label).toEqual(['refuse', word, why]);
    expect(v.detail, label).not.toMatch(HEX64);
    expect(typeof v.detail, label).toBe('string');
  };
  return {
    'step term: no live generation, a null designation term, a null row term, a term that differs, all stale-designation': () => {
      refusal(f('term', PRES, 5, readOf(null)), 'stale-designation', null, 'no live');
      refusal(f('term', PRES, null, readOf(LIVE)), 'stale-designation', null, 'designation term null');
      refusal(f('term', PRES, 5, readOf({ ...LIVE, term: null })), 'stale-designation', null, 'row term null');
      refusal(f('term', PRES, 5, readOf({ ...LIVE, term: 4 })), 'stale-designation', null, 'row term lower');
      refusal(f('term', PRES, 5, readOf({ ...LIVE, term: 6 })), 'stale-designation', null, 'row term higher');
      refusal(f('term', PRES, null, readOf({ ...LIVE, term: null })), 'stale-designation', null, 'both terms null');
    },
    'step term: each missing side is named in the detail': () => {
      expect(f('term', PRES, null, readOf(LIVE)).detail).toContain('no term');
      expect(f('term', PRES, 5, readOf({ ...LIVE, term: null })).detail).toContain('does not read');
      expect(f('term', PRES, null, readOf(null)).detail).toContain('no live generation');
    },
    'step term: the term detail names both terms and never a digest': () => {
      const v = f('term', PRES, 5, readOf({ ...LIVE, term: 4 }));
      expect(v.detail).toContain('4');
      expect(v.detail).toContain('5');
    },
    'step term: a matching term passes whatever the generation, key and counter say': () => {
      expect(f('term', PRES, 5, readOf(LIVE))).toEqual({ kind: 'pass' });
      expect(f('term', { generation: null, counter: null, key: false }, 5, readOf({ ...LIVE, key: 'mismatch' }))).toEqual({ kind: 'pass' });
      expect(f('term', PRES, 0, readOf({ ...LIVE, term: 0 }))).toEqual({ kind: 'pass' });
    },
    'step generation: each refusal, with its exact word and why': () => {
      refusal(f('generation', PRES, 5, readOf(null)), 'stale-generation', 'no-live-generation', 'no live');
      refusal(f('generation', { ...PRES, key: false }, 5, readOf(LIVE)), 'stale-generation', 'no-key', 'no key');
      refusal(f('generation', { ...PRES, generation: 2 }, 5, readOf(LIVE)), 'stale-generation', 'generation-mismatch', 'older');
      refusal(f('generation', { ...PRES, generation: 4 }, 5, readOf(LIVE)), 'stale-generation', 'generation-mismatch', 'newer');
      refusal(f('generation', { ...PRES, generation: null }, 5, readOf(LIVE)), 'stale-generation', 'generation-mismatch', 'null generation');
      refusal(f('generation', PRES, 5, readOf({ ...LIVE, key: 'unissued' })), 'stale-generation', 'key-unissued', 'unissued');
      refusal(f('generation', PRES, 5, readOf({ ...LIVE, key: 'mismatch' })), 'stale-generation', 'key-mismatch', 'mismatch');
      refusal(f('generation', { ...PRES, counter: 4 }, 5, readOf(LIVE)), 'stale-generation', 'fork', 'equal counter');
      refusal(f('generation', { ...PRES, counter: 3 }, 5, readOf(LIVE)), 'stale-generation', 'fork', 'lower counter');
      refusal(f('generation', { ...PRES, counter: null }, 5, readOf(LIVE)), 'stale-generation', 'fork', 'null counter');
      // a null counter refuses on its own, not by coercing to 0 (a stored counter below 0 is synthetic)
      refusal(f('generation', { ...PRES, counter: null }, 5, readOf({ ...LIVE, counter: -1 })), 'stale-generation', 'fork', 'null counter over a negative stored one');
    },
    'step generation: the order is no live, no key, generation, unissued, mismatch, counter': () => {
      const everything = { ...PRES, key: false, generation: 9, counter: 0 };
      refusal(f('generation', everything, 5, readOf(null)), 'stale-generation', 'no-live-generation', 'a');
      refusal(f('generation', everything, 5, readOf({ ...LIVE, key: 'unissued' })), 'stale-generation', 'no-key', 'b');
      refusal(f('generation', { ...everything, key: true }, 5, readOf({ ...LIVE, key: 'unissued' })), 'stale-generation', 'generation-mismatch', 'c');
      refusal(f('generation', { ...everything, key: true, generation: 3 }, 5, readOf({ ...LIVE, key: 'unissued' })), 'stale-generation', 'key-unissued', 'd');
      refusal(f('generation', { ...everything, key: true, generation: 3 }, 5, readOf({ ...LIVE, key: 'mismatch' })), 'stale-generation', 'key-mismatch', 'e');
      refusal(f('generation', { ...everything, key: true, generation: 3 }, 5, readOf(LIVE)), 'stale-generation', 'fork', 'f');
    },
    'step generation: a pass, a counter one above the stored, and the designation term ignored': () => {
      expect(f('generation', PRES, 5, readOf(LIVE))).toEqual({ kind: 'pass' });
      expect(f('generation', { ...PRES, counter: 5 }, null, readOf({ ...LIVE, term: null }))).toEqual({ kind: 'pass' });
      expect(f('generation', { ...PRES, counter: 1 }, 5, readOf({ ...LIVE, counter: 0 }))).toEqual({ kind: 'pass' });
    },
    'an unmeasured facts read answers unavailable at both steps, never a pass': () => {
      const un = { kind: 'unmeasured', why: 'the rows could not be read' };
      for (const step of ['term', 'generation'] as const) {
        const v = f(step, PRES, 5, un);
        refusal(v, 'unavailable', null, step);
        expect(v.detail).toContain('the rows could not be read');
      }
    },
  };
}

export function counterVerdictCases(m: OverlordGateModule): Record<string, SuiteCase> {
  const c = (a: 'advanced' | 'not-above' | 'ended' | 'unmeasured') => m.counterVerdict(a) as FV;
  return {
    'advanced passes': () => { expect(c('advanced')).toEqual({ kind: 'pass' }); },
    'not-above is a late fork': () => {
      const v = c('not-above');
      expect([v.kind, v.word, v.why]).toEqual(['refuse', 'stale-generation', 'fork']);
      expect(v.detail).not.toMatch(HEX64);
    },
    'ended is stale-generation with why ended': () => {
      const v = c('ended');
      expect([v.kind, v.word, v.why]).toEqual(['refuse', 'stale-generation', 'ended']);
    },
    'unmeasured is unavailable with no why': () => {
      const v = c('unmeasured');
      expect([v.kind, v.word, v.why ?? null]).toEqual(['refuse', 'unavailable', null]);
    },
  };
}

// --- overlordGate ---
type Gf = Parameters<OverlordGateModule['overlordGate']>[0];
type GateOut = { kind: string; word?: string; step?: string; record?: string | null; why?: string | null; detail?: string };
export const GATE_DOOR_KEYS = Object.keys(OVERLORD_DOORS).filter((k) => OVERLORD_DOORS[k]!.group === 'overlord');
const doorOf = (key: string, over: Partial<OverlordDoorRow> = {}): OverlordDoorRow => ({ ...(OVERLORD_DOORS[key] as OverlordDoorRow), ...over });
export const isStart = (d: OverlordDoorRow) => d.ladderClass === 'card-probe-note';
const FULL = { rung: 'full', operatorRung: 'full', binding: [], readBy: [] };
const ladderRead = (over: Record<string, unknown> = {}) => ({ kind: 'read' as const, rung: { ...FULL, ...over } });

/** Every fact a door passes on: the base every case edits. */
export function passFacts(door: OverlordDoorRow, over: Record<string, unknown> = {}): Gf {
  const start = isStart(door);
  return {
    door, standing: { kind: 'designated' }, serverWords: [door.word], authority: { kind: 'coherent' },
    ladder: start ? 'start-door' : ladderRead(), term: 5,
    fence: door.write ? { presented: PRES, facts: readOf(LIVE) } : 'read-door',
    witness: door.write ? { kind: 'witnessed', witnessId: 7 } : 'read-door',
    card: 'read-current', generation: { kind: 'state', state: 'active' },
    ...over,
  } as unknown as Gf;
}

const RENEWING = ['draining', 'checkpointed', 'clearing', 'carded', 'probing', 'ended'];
const SERVING = ['active', 'degraded'];
type Res = { kind: 'pass' } | { kind: 'hook' } | { kind: 'refuse'; word: string; step: string; record: string | null };
const refuseOf = (word: string, step: string, record: string | null = null): Res => ({ kind: 'refuse', word, step, record });

/** The order of §11.2 written out as data: each step a predicate over the facts, returning its refusal or null. It names
 *  no helper of the module under test. */
export const ORACLE_STEPS: ReadonlyArray<(f: Gf) => Res | null> = [
  // 1: who calls
  (f) => {
    const k = f.standing.kind;
    if (k === 'other') return f.door.others === 'hook' ? { kind: 'hook' } : refuseOf('not-the-overlord', '1');
    if (k === 'other-incarnation') return refuseOf('not-the-overlord', '1');
    if (f.standing.kind === 'unmeasured') return refuseOf(f.standing.word, '1');
    if (k === 'pending-unrecorded') return refuseOf('renewing', '1');
    return null;
  },
  // 2: the capability word
  (f) => (f.serverWords.includes(f.door.word) ? null : refuseOf('capability-missing', '2')),
  // 3: the authority guard, not at a start door
  (f) => (!isStart(f.door) && f.authority.kind !== 'coherent' ? refuseOf('authority-rolled-back', '3') : null),
  // 4: the ladder read, then the operator's own rung (never the effective one)
  (f) => {
    if (isStart(f.door)) return null;
    if (f.ladder === 'start-door' || f.ladder.kind !== 'read') return refuseOf('unavailable', '4');
    return f.ladder.rung.operatorRung === 'off' ? refuseOf('overlord-off', '4') : null;
  },
  // 5: the term, at a write
  (f) => {
    if (!f.door.write) return null;
    if (f.fence === 'read-door') return refuseOf('unavailable', '5');
    const facts = f.fence.facts;
    if (facts.kind !== 'read') return refuseOf('unavailable', '5');
    if (facts.live === null || f.term === null || facts.live.term === null || facts.live.term !== f.term) return refuseOf('stale-designation', '5');
    return null;
  },
  // 6: the launch profile
  (f) => {
    if (isStart(f.door) || f.ladder === 'start-door' || f.ladder.kind !== 'read') return null;
    return f.ladder.rung.readBy.some((e) => e.reader === 'launch-profile-unmet') ? refuseOf('launch-profile-unmet', '6') : null;
  },
  // 7: generation, key, counter
  (f) => {
    if (!f.door.write || f.fence === 'read-door') return null;
    const facts = f.fence.facts;
    if (facts.kind !== 'read') return refuseOf('unavailable', '7');
    const stale = refuseOf('stale-generation', '7', 'fence-refusal');
    if (facts.live === null || !f.fence.presented.key || f.fence.presented.generation !== facts.live.n || facts.live.key !== 'match') return stale;
    if (f.fence.presented.counter === null || f.fence.presented.counter <= facts.live.counter) return stale;
    return null;
  },
  // 7a: the witness
  (f) => {
    if (!f.door.write || f.fence === 'read-door') return null;
    if (f.witness === 'read-door' || f.witness.kind === 'unmeasured') return refuseOf('unmeasured', '7a');
    return f.witness.kind === 'unwitnessed' ? refuseOf('unwitnessed', '7a', 'witness-unwitnessed') : null;
  },
  // 9 at a start door: the card's recording page, for a pending body
  (f) => (isStart(f.door) && f.door.write && f.door.act === 'read' && f.standing.kind === 'designated-pending' ? refuseOf('renewing', '9') : null),
  // 8: the card
  (f) => {
    if (isStart(f.door)) return null;
    if (typeof f.card === 'object') return refuseOf('unavailable', '8');
    return f.card === 'read-current' ? null : refuseOf('card-unread', '8');
  },
  // 9: the generation
  (f) => {
    if (isStart(f.door)) return null;
    if (f.standing.kind === 'designated-pending') return refuseOf('renewing', '9');
    if (f.generation.kind === 'unmeasured') return refuseOf('unavailable', '9');
    if (f.generation.kind === 'none') return refuseOf('renewing', '9');
    return RENEWING.includes(f.generation.state) ? refuseOf('renewing', '9') : null;
  },
  // 10: the effective rung; every W1 act is allowed at every rung above off
  (f) => {
    if (isStart(f.door) || f.ladder === 'start-door' || f.ladder.kind !== 'read') return null;
    return f.ladder.rung.rung === 'off' ? refuseOf('rung-below', '10') : null;
  },
];
export const oracle = (f: Gf): Res => {
  for (const step of ORACLE_STEPS) { const r = step(f); if (r !== null) return r; }
  return { kind: 'pass' };
};
const shape = (v: GateOut): Res => (v.kind === 'refuse'
  ? { kind: 'refuse', word: v.word!, step: v.step!, record: v.record ?? null } : { kind: v.kind } as Res);

const pick = <T,>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
/** One random case: a door (a row with `write` and `ladderClass` flipped at random, `others` drawn), and each fact one of its
 *  arms, passing with probability `pPass`. */
export function genCase(rnd: () => number): Gf {
  const base = OVERLORD_DOORS[pick(rnd, GATE_DOOR_KEYS)] as OverlordDoorRow;
  const door: OverlordDoorRow = {
    ...base, write: rnd() < 0.5, ladderClass: rnd() < 0.5 ? 'card-probe-note' : 'other', others: rnd() < 0.5 ? 'hook' : 'refuse',
  };
  const pPass = 0.5 + rnd() * 0.5;
  const ok = () => rnd() < pPass;
  const standing = ok() ? { kind: 'designated' } : pick(rnd, [
    { kind: 'designated-pending' }, { kind: 'pending-unrecorded' }, { kind: 'other-incarnation' }, { kind: 'other' },
    { kind: 'unmeasured', word: 'unavailable', why: 'x' }, { kind: 'unmeasured', word: 'registry-unmeasurable', why: 'y' },
  ]);
  const rungs = ['off', 'chat', 'advise', 'full'];
  const ladder = isStart(door)
    ? (rnd() < 0.8 ? 'start-door' : pick(rnd, [ladderRead(), { kind: 'unmeasured', why: 'z' }]))
    : (ok() ? ladderRead() : pick(rnd, [
      { kind: 'unmeasured', why: 'z' }, 'start-door',
      ladderRead({ operatorRung: 'off' }), ladderRead({ rung: 'off' }), ladderRead({ rung: 'off', operatorRung: 'off' }),
      ladderRead({ rung: pick(rnd, rungs), operatorRung: pick(rnd, rungs) }),
      ladderRead({ readBy: [{ cause: 'c', reader: 'launch-profile-unmet', reading: 'standing' }] }),
    ]));
  const liveOk = ok();
  const live = liveOk ? LIVE : pick(rnd, [null, { ...LIVE, term: 4 }, { ...LIVE, term: null }, { ...LIVE, key: 'mismatch' }, { ...LIVE, key: 'unissued' }, { ...LIVE, counter: 9 }, { ...LIVE, n: 8 }]);
  const presented = ok() ? PRES : pick(rnd, [{ ...PRES, key: false }, { ...PRES, generation: null }, { ...PRES, counter: null }, { ...PRES, counter: 4 }, { ...PRES, generation: 2 }]);
  const factsRead = rnd() < 0.05 ? { kind: 'unmeasured', why: 'q' } : readOf(live as never);
  const fence = door.write && rnd() < 0.03 ? 'read-door' : { presented, facts: factsRead };
  const witness = ok() ? { kind: 'witnessed', witnessId: 7 } : pick(rnd, [
    { kind: 'unwitnessed', why: 'none' }, { kind: 'unwitnessed', why: 'stale' }, { kind: 'unmeasured', why: 'w' }, 'read-door',
  ]);
  const card = ok() ? 'read-current' : pick(rnd, ['read-stale', 'none', { kind: 'unmeasured', why: 'c' }]);
  const generation = ok() ? { kind: 'state', state: pick(rnd, SERVING) } : pick(rnd, [
    { kind: 'state', state: pick(rnd, RENEWING) }, { kind: 'none' }, { kind: 'unmeasured', why: 'g' }]);
  return {
    door, standing, serverWords: ok() ? [door.word, 'timers-v1'] : pick(rnd, [[], ['timers-v1']]),
    authority: ok() ? { kind: 'coherent' } : pick(rnd, [{ kind: 'rolled-back', cause: 'behind' }, { kind: 'unmeasured', why: 'journal' }]),
    ladder, term: rnd() < 0.9 ? 5 : null, fence, witness, card, generation,
  } as unknown as Gf;
}

/** What replacing one fact by its unmeasured arm does at its step, for the facts the door reads. */
const UNMEASURED_ARMS: ReadonlyArray<{ fact: string; step: string; reads: (d: OverlordDoorRow) => boolean; swap: (f: Gf) => Gf }> = [
  { fact: 'standing', step: '1', reads: () => true, swap: (f) => ({ ...f, standing: { kind: 'unmeasured', word: 'unavailable', why: 'u' } }) as Gf },
  { fact: 'authority', step: '3', reads: (d) => !isStart(d), swap: (f) => ({ ...f, authority: { kind: 'unmeasured', why: 'journal' } }) as Gf },
  { fact: 'ladder', step: '4', reads: (d) => !isStart(d), swap: (f) => ({ ...f, ladder: { kind: 'unmeasured', why: 'u' } }) as Gf },
  { fact: 'fence facts', step: '5', reads: (d) => d.write, swap: (f) => ({ ...f, fence: f.fence === 'read-door' ? f.fence : { ...f.fence, facts: { kind: 'unmeasured', why: 'u' } } }) as Gf },
  { fact: 'witness', step: '7a', reads: (d) => d.write, swap: (f) => ({ ...f, witness: { kind: 'unmeasured', why: 'u' } }) as Gf },
  { fact: 'card', step: '8', reads: (d) => !isStart(d), swap: (f) => ({ ...f, card: { kind: 'unmeasured', why: 'u' } }) as Gf },
  { fact: 'generation', step: '9', reads: (d) => !isStart(d), swap: (f) => ({ ...f, generation: { kind: 'unmeasured', why: 'u' } }) as Gf },
];

export function overlordGateCases(m: OverlordGateModule): Record<string, SuiteCase> {
  const g = (f: Gf) => m.overlordGate(f) as GateOut;
  const refused = (f: Gf, word: string, step: string, label: string, record: string | null = null) => {
    const v = g(f);
    expect([v.kind, v.word, v.step, v.record ?? null], label).toEqual(['refuse', word, step, record]);
  };
  const door = (key: string, over: Partial<OverlordDoorRow> = {}) => doorOf(key, over);
  return {
    'first-refusal: 2000 generated cases agree with the written order, in kind, word, step and record': () => {
      const rnd = mulberry32(8_4_2026);
      const seen = new Set<string>();
      for (let i = 0; i < 2000; i++) {
        const f = genCase(rnd);
        const want = oracle(f);
        const got = shape(g(f));
        expect(got, `case ${i}: ${JSON.stringify(f)}`).toEqual(want);
        seen.add(want.kind === 'refuse' ? `${want.step}:${want.word}` : want.kind);
      }
      // the generator reaches every step's refusal, the hook and a pass
      for (const k of ['pass', 'hook', '1:not-the-overlord', '1:renewing', '1:unavailable', '1:registry-unmeasurable', '2:capability-missing',
        '3:authority-rolled-back', '4:unavailable', '4:overlord-off', '5:stale-designation', '5:unavailable', '6:launch-profile-unmet',
        '7:stale-generation', '7a:unwitnessed', '7a:unmeasured', '9:renewing', '8:card-unread', '8:unavailable', '9:unavailable', '10:rung-below']) {
        expect(seen.has(k), `the generator never reached ${k}`).toBe(true);
      }
    },
    'unmeasured-never-passes: an unmeasured fact turns a pass into a refusal at its step, and a refusal is never a pass': () => {
      const rnd = mulberry32(20261119);
      let passes = 0;
      const stepsSeen = new Set<string>();
      for (let i = 0; i < 2000; i++) {
        const f = genCase(rnd);
        const before = g(f);
        for (const arm of UNMEASURED_ARMS) {
          if (!arm.reads(f.door)) continue;
          const after = g(arm.swap(f));
          const label = `case ${i} ${arm.fact}`;
          if (before.kind === 'pass') {
            passes++;
            expect(after.kind, label).toBe('refuse');
            expect(after.step, label).toBe(arm.step);
            stepsSeen.add(arm.fact);
          } else if (before.kind === 'refuse') {
            expect(after.kind, label).not.toBe('pass');
          }
        }
      }
      expect(passes).toBeGreaterThan(200);
      expect([...stepsSeen].sort()).toEqual(UNMEASURED_ARMS.map((a) => a.fact).sort());
    },
    'every door of the table passes on passing facts, whatever its write and class flags': () => {
      for (const key of GATE_DOOR_KEYS) for (const write of [true, false]) for (const cls of ['card-probe-note', 'other'] as const) {
        const d = door(key, { write, ladderClass: cls });
        // a door that is a read at a start door never meets the card-record arm; a pending body is not used here
        expect(g(passFacts(d)), `${key} ${write} ${cls}`).toEqual({ kind: 'pass' });
      }
    },
    'start doors skip steps 3, 4, 6, 8, 9 and 10': () => {
      const d = door('notes-write', { write: false });
      const f = passFacts(d, {
        authority: { kind: 'rolled-back', cause: 'behind' }, ladder: { kind: 'unmeasured', why: 'z' },
        card: 'none', generation: { kind: 'none' },
      });
      expect(g(f)).toEqual({ kind: 'pass' });
      expect(g(passFacts(d, { ladder: ladderRead({ operatorRung: 'off', rung: 'off', readBy: [{ cause: 'c', reader: 'launch-profile-unmet', reading: 'standing' }] }) }))).toEqual({ kind: 'pass' });
      expect(g(passFacts(d, { generation: { kind: 'state', state: 'draining' } }))).toEqual({ kind: 'pass' });
      expect(g(passFacts(d, { card: { kind: 'unmeasured', why: 'u' } }))).toEqual({ kind: 'pass' });
      // not step 1, 2 (and, at a write, 5, 7, 7a)
      refused(passFacts(d, { serverWords: [] }), 'capability-missing', '2', 'step 2');
      const w = door('notes-write');
      refused(passFacts(w, { fence: { presented: PRES, facts: readOf({ ...LIVE, term: 4 }) } }), 'stale-designation', '5', 'step 5 at a start write');
      refused(passFacts(w, { fence: { presented: { ...PRES, counter: 1 }, facts: readOf(LIVE) } }), 'stale-generation', '7', 'step 7 at a start write', 'fence-refusal');
      refused(passFacts(w, { witness: { kind: 'unwitnessed', why: 'none' } }), 'unwitnessed', '7a', 'step 7a at a start write', 'witness-unwitnessed');
      // a start door still serves a pending body (the one arm is the card's recording page)
      expect(g(passFacts(w, { standing: { kind: 'designated-pending' } }))).toEqual({ kind: 'pass' });
    },
    'read doors skip steps 5, 7 and 7a, and read the rest': () => {
      const d = door('card', { ladderClass: 'other', write: false });
      const f = passFacts(d, { fence: 'read-door', witness: 'read-door', term: null });
      expect(g(f)).toEqual({ kind: 'pass' });
      expect(g({ ...f, fence: { presented: { generation: null, counter: null, key: false }, facts: { kind: 'unmeasured', why: 'u' } } } as unknown as Gf)).toEqual({ kind: 'pass' });
      refused(passFacts(d, { authority: { kind: 'rolled-back', cause: 'behind' } }), 'authority-rolled-back', '3', 'step 3');
      refused(passFacts(d, { ladder: ladderRead({ operatorRung: 'off' }) }), 'overlord-off', '4', 'step 4');
      refused(passFacts(d, { ladder: ladderRead({ readBy: [{ cause: 'c', reader: 'launch-profile-unmet', reading: 'unmeasured' }] }) }), 'launch-profile-unmet', '6', 'step 6');
      refused(passFacts(d, { card: 'read-stale' }), 'card-unread', '8', 'step 8 stale');
      refused(passFacts(d, { card: 'none' }), 'card-unread', '8', 'step 8 none');
      refused(passFacts(d, { generation: { kind: 'state', state: 'probing' } }), 'renewing', '9', 'step 9');
      refused(passFacts(d, { ladder: ladderRead({ rung: 'off' }) }), 'rung-below', '10', 'step 10');
    },
    'step 4 reads the operator rung, step 10 the effective rung': () => {
      const d = door('card', { ladderClass: 'other', write: false });
      refused(passFacts(d, { ladder: ladderRead({ operatorRung: 'off', rung: 'full' }) }), 'overlord-off', '4', 'operator off, effective full');
      refused(passFacts(d, { ladder: ladderRead({ operatorRung: 'full', rung: 'off' }) }), 'rung-below', '10', 'operator full, effective off');
      expect(g(passFacts(d, { ladder: ladderRead({ operatorRung: 'chat', rung: 'chat' }) }))).toEqual({ kind: 'pass' });
    },
    'step 5 comes before step 6, and step 6 before step 7': () => {
      const d = door('notes-write', { ladderClass: 'other' });
      const unmet = ladderRead({ readBy: [{ cause: 'c', reader: 'launch-profile-unmet', reading: 'standing' }] });
      const badTerm = { presented: PRES, facts: readOf({ ...LIVE, term: 4 }) };
      const badGen = { presented: { ...PRES, counter: 0 }, facts: readOf(LIVE) };
      refused(passFacts(d, { ladder: unmet, fence: badTerm }), 'stale-designation', '5', '5 before 6');
      refused(passFacts(d, { ladder: unmet, fence: badGen }), 'launch-profile-unmet', '6', '6 before 7');
      refused(passFacts(d, { fence: badGen, card: 'none' }), 'stale-generation', '7', '7 before 8', 'fence-refusal');
    },
    'step 7a follows the fence and precedes the card': () => {
      const d = door('notes-write', { ladderClass: 'other' });
      refused(passFacts(d, { witness: { kind: 'unwitnessed', why: 'used' }, card: 'none' }), 'unwitnessed', '7a', '7a before 8', 'witness-unwitnessed');
      refused(passFacts(d, { witness: 'read-door' }), 'unmeasured', '7a', 'witness not read');
      refused(passFacts(d, { witness: { kind: 'unmeasured', why: 'u' } }), 'unmeasured', '7a', 'witness unmeasured');
    },
    'a fence refusal carries its why, and a step 5 refusal records nothing': () => {
      const d = door('notes-write', { ladderClass: 'other' });
      const gen = (over: Record<string, unknown>, live: unknown = LIVE) => g(passFacts(d, { fence: { presented: { ...PRES, ...over }, facts: readOf(live as never) } }));
      expect(gen({ key: false }).why).toBe('no-key');
      expect(gen({ generation: 1 }).why).toBe('generation-mismatch');
      expect(gen({}, { ...LIVE, key: 'unissued' }).why).toBe('key-unissued');
      expect(gen({}, { ...LIVE, key: 'mismatch' }).why).toBe('key-mismatch');
      expect(gen({ counter: 4 }).why).toBe('fork');
      expect(gen({}, null).word).toBe('stale-designation');
      const t = gen({}, { ...LIVE, term: 9 });
      expect([t.word, t.step, t.record ?? null, t.why ?? null]).toEqual(['stale-designation', '5', null, null]);
      const fenceNull = g(passFacts(d, { term: null }));
      expect([fenceNull.word, fenceNull.step]).toEqual(['stale-designation', '5']);
      expect(g(passFacts(d, { fence: 'read-door' }))).toMatchObject({ word: 'unavailable', step: '5' });
    },
    'standing: other-incarnation refuses not-the-overlord at a start door, other follows the door, pending-unrecorded is renewing': () => {
      for (const others of ['hook', 'refuse'] as const) {
        const d = door('notes-write', { others });
        refused(passFacts(d, { standing: { kind: 'other-incarnation' } }), 'not-the-overlord', '1', `other-incarnation ${others}`);
        refused(passFacts(d, { standing: { kind: 'pending-unrecorded' } }), 'renewing', '1', `pending-unrecorded ${others}`);
      }
      expect(g(passFacts(door('notes-write', { others: 'hook' }), { standing: { kind: 'other' } }))).toEqual({ kind: 'hook' });
      refused(passFacts(door('notes-write', { others: 'refuse' }), { standing: { kind: 'other' } }), 'not-the-overlord', '1', 'other refuse');
      refused(passFacts(door('notes-write'), { standing: { kind: 'unmeasured', word: 'registry-unmeasurable', why: 'r' } }), 'registry-unmeasurable', '1', 'unmeasured');
      refused(passFacts(door('notes-write'), { standing: { kind: 'unmeasured', word: 'unavailable', why: 'r' }, serverWords: [] }), 'unavailable', '1', 'step 1 before 2');
    },
    'the standing verdict is step 1 alone: null for a designated or a pending body': () => {
      const d = door('notes-write');
      expect(m.standingVerdict(d, { kind: 'designated' })).toBeNull();
      expect(m.standingVerdict(d, { kind: 'designated-pending' })).toBeNull();
      expect(m.standingVerdict(d, { kind: 'other' })).toEqual({ kind: 'hook' });
      expect(m.standingVerdict(door('notes-write', { others: 'refuse' }), { kind: 'other' })).toMatchObject({ kind: 'refuse', word: 'not-the-overlord', step: '1' });
    },
    'the card door ruling: a recorded read by a pending body refuses renewing at step 9, a designated body passes': () => {
      const rec = doorOf('card-record');
      expect(rec.write && rec.act === 'read' && isStart(rec)).toBe(true);
      refused(passFacts(rec, { standing: { kind: 'designated-pending' } }), 'renewing', '9', 'pending at card-record');
      expect(g(passFacts(rec, { standing: { kind: 'designated' } }))).toEqual({ kind: 'pass' });
      // after step 7a: a failing witness or fence shows first
      refused(passFacts(rec, { standing: { kind: 'designated-pending' }, witness: { kind: 'unwitnessed', why: 'none' } }), 'unwitnessed', '7a', 'witness first', 'witness-unwitnessed');
      refused(passFacts(rec, { standing: { kind: 'designated-pending' }, fence: { presented: PRES, facts: readOf({ ...LIVE, term: 1 }) } }), 'stale-designation', '5', 'term first');
      // only a recorded read: a note door's pending body, and the card read door, are served
      expect(g(passFacts(doorOf('notes-write'), { standing: { kind: 'designated-pending' } }))).toEqual({ kind: 'pass' });
      expect(g(passFacts(doorOf('card'), { standing: { kind: 'designated-pending' } }))).toEqual({ kind: 'pass' });
    },
    'step 9 reads every renewing state as renewing, an ended generation included, and active and degraded as serving': () => {
      const d = door('card', { ladderClass: 'other', write: false });
      for (const s of RENEWING) refused(passFacts(d, { generation: { kind: 'state', state: s } }), 'renewing', '9', s);
      for (const s of SERVING) expect(g(passFacts(d, { generation: { kind: 'state', state: s } })), s).toEqual({ kind: 'pass' });
      refused(passFacts(d, { generation: { kind: 'none' } }), 'renewing', '9', 'none');
      refused(passFacts(d, { generation: { kind: 'unmeasured', why: 'u' } }), 'unavailable', '9', 'unmeasured');
      refused(passFacts(d, { standing: { kind: 'designated-pending' } }), 'renewing', '9', 'pending at a read door');
    },
    'gateReads: what each door reads': () => {
      for (const key of GATE_DOOR_KEYS) for (const write of [true, false]) for (const cls of ['card-probe-note', 'other'] as const) {
        const d = door(key, { write, ladderClass: cls });
        expect(m.gateReads(d), `${key} ${write} ${cls}`).toEqual({ ladder: cls === 'other', card: cls === 'other', fence: write });
      }
    },
  };
}

const G = (id: string, old: string, neu: string) => ({ id, old, new: neu });

export const CALLER_STANDING_SET: MutantSet<OverlordGateModule> = {
  modulePath: GATE_TS,
  suite: callerStandingCases,
  mutants: [
    G('S-1', 'caller.incarnation.incarnation !== place.incarnation', 'caller.incarnation.incarnation === place.incarnation'),
    G('S-2', "if (place.incarnation === null) return { kind: 'pending-unrecorded' };", "if (place.incarnation === null) return { kind: 'designated-pending' };"),
    G('S-3', "if (caller.incarnation.reason === 'absent') return { kind: 'other-incarnation' };", "if (caller.incarnation.reason === 'never') return { kind: 'other-incarnation' };"),
    G('S-4', "return place.kind === 'bound' ? { kind: 'designated' } : { kind: 'designated-pending' };", "return { kind: 'designated' };"),
    G('S-5', "if (caller.incarnation === 'not-asked') return { kind: 'unmeasured', word: 'unavailable', why: 'the incarnation was not read' };", "if (caller.incarnation === 'not-asked') return { kind: 'other' };"),
    G('S-6', "pending.kind === 'designate' && pending.sessionId === sessionId", 'pending.sessionId === sessionId'),
    G('S-7', "word: 'unavailable', why: `the designation row", "word: 'registry-unmeasurable', why: `the designation row"),
    G('S-8', "const bound = designation.kind === 'designated' ? designation.row.bound : null;", 'const bound = designation.row?.bound ?? null;'),
    G('S-9', 'placeOf(sessionId, designation) !== null;', 'placeOf(sessionId, designation) === null;'),
    G('S-10', "word: 'registry-unmeasurable', why: `the incarnation could not be read", "word: 'unavailable', why: `the incarnation could not be read"),
    G('S-11', "if (place === null) return { kind: 'other' };", "if (place === null) return { kind: 'other-incarnation' };"),
  ],
};

export const FENCE_VERDICT_SET: MutantSet<OverlordGateModule> = {
  modulePath: GATE_TS,
  suite: fenceVerdictCases,
  mutants: [
    G('F-1', 'if (live.term !== designationTerm)', 'if (live.term === designationTerm)'),
    G('F-2', "    if (designationTerm === null) return fenceRefuse('stale-designation', 'the designation read has no term');\n", ''),
    G('F-3', "    if (live.term === null) return fenceRefuse('stale-designation', \"the live generation row's term does not read\");\n", ''),
    G('F-4', 'presented.counter <= live.counter', 'presented.counter < live.counter'),
    G('F-5', "if (live.key === 'unissued')", "if (live.key === 'mismatch')"),
    G('F-6', "  if (!presented.key) return fenceRefuse('stale-generation', 'no act key presented', 'no-key');\n", ''),
    G('F-7', 'presented.generation !== live.n', 'presented.generation < live.n'),
    G('F-8', "fenceRefuse('unavailable', `the generations or the act key", "fenceRefuse('stale-generation', `the generations or the act key"),
    G('F-9', "'no live generation for this identity', 'no-live-generation'", "'no live generation for this identity', 'no-key'"),
    G('F-10', "    return { kind: 'pass' };\n  }\n  if (live === null) return fenceRefuse('stale-generation'", "  }\n  if (live === null) return fenceRefuse('stale-generation'"),
    G('F-11', "if (presented.counter === null || presented.counter <= live.counter)", 'if (presented.counter <= live.counter)'),
    G('F-12', "if (live === null) return fenceRefuse('stale-designation', 'no live generation for this identity');", "if (live === null) return fenceRefuse('stale-generation', 'no live generation for this identity');"),
  ],
};

export const COUNTER_VERDICT_SET: MutantSet<OverlordGateModule> = {
  modulePath: GATE_TS,
  suite: counterVerdictCases,
  mutants: [
    G('K-1', "if (answer === 'not-above') return fenceRefuse('stale-generation', 'the act counter is not above the last one: a fork', 'fork');", "if (answer === 'not-above') return { kind: 'pass' };"),
    G('K-2', "'the generation ended', 'ended')", "'the generation ended', 'fork')"),
    G('K-3', "return fenceRefuse('unavailable', 'the act counter could not be advanced');", "return fenceRefuse('stale-generation', 'the act counter could not be advanced');"),
    G('K-4', "if (answer === 'advanced') return { kind: 'pass' };", "if (answer === 'advanced') return fenceRefuse('unavailable', 'x');"),
    G('K-5', "if (answer === 'not-above') return fenceRefuse('stale-generation', 'the act counter is not above the last one: a fork', 'fork');", "if (answer === 'not-above') return fenceRefuse('stale-generation', 'the act counter is not above the last one: a fork', 'ended');"),
    G('K-6', "if (answer === 'ended') return fenceRefuse('stale-generation', 'the generation ended', 'ended');", "if (answer === 'ended') return { kind: 'pass' };"),
    G('K-7', "if (answer === 'not-above') return fenceRefuse('stale-generation',", "if (answer === 'not-above') return fenceRefuse('stale-designation' as never,"),
    G('K-8', "return fenceRefuse('unavailable', 'the act counter could not be advanced');", "return { kind: 'pass' };"),
  ],
};

export const OVERLORD_GATE_SET: MutantSet<OverlordGateModule> = {
  modulePath: GATE_TS,
  suite: overlordGateCases,
  mutants: [
    // step 6 runs before step 5 (the duplicate that follows is then harmless)
    G('O-1', "  // Step 5: the term, at a write.\n  const fence = f.fence;", "  if (!start && ladder !== 'start-door' && ladder.kind === 'read') {\n    const unmet0 = ladder.rung.readBy.find((e) => e.reader === 'launch-profile-unmet');\n    if (unmet0 !== undefined) return refuse('launch-profile-unmet', '6', 'x');\n  }\n  const fence = f.fence;"),
    G('O-2', 'offStep(ladder.rung.operatorRung, door.ladderClass)', 'offStep(ladder.rung.rung, door.ladderClass)'),
    G('O-3', "if (s.kind === 'other-incarnation') return refuse('not-the-overlord', '1', \"the caller's incarnation is not the designation's\");", "if (s.kind === 'other-incarnation') return door.others === 'hook' ? { kind: 'hook' } : refuse('not-the-overlord', '1', 'x');"),
    G('O-4', "if (door.write && fence !== 'read-door') {", "if (door.write && !start && fence !== 'read-door') {"),
    G('O-5', "if (s.kind === 'pending-unrecorded') return refuse('renewing', '1', \"the designated body's incarnation is not recorded yet\");", "if (s.kind === 'pending-unrecorded') return null;"),
    G('O-6', '!f.serverWords.includes(door.word)', 'f.serverWords.includes(door.word)'),
    G('O-7', "if (!start && f.authority.kind !== 'coherent') {", "if (f.authority.kind !== 'coherent') {"),
    G('O-8', "'witness-unwitnessed');", 'null);'),
    G('O-9', "draining: true, checkpointed: true, clearing: true, carded: true, probing: true, ended: true,", "draining: true, checkpointed: true, clearing: true, carded: true, probing: true, ended: false,"),
    G('O-10', "door.write && door.act === 'read' && s.kind === 'designated-pending'", "door.write && s.kind === 'designated-pending'"),
    G('O-11', "if (start && door.write && door.act === 'read' && s.kind === 'designated-pending') return refuse(", "if (false) return refuse("),
    G('O-12', "if (card !== 'read-current') return refuse(", "if (card === 'none') return refuse("),
    G('O-13', 'rungStep(ladder.rung.rung, door.ladderClass, door.act)', 'rungStep(ladder.rung.operatorRung, door.ladderClass, door.act)'),
    G('O-14', "e.reader === 'launch-profile-unmet'", "e.reader === 'launch-profile-unmet-x'"),
    G('O-15', "if (term.kind === 'refuse') return refuse(term.word, '5', term.detail);", ''),
    G('O-16', "if (g.kind === 'none') return refuse('renewing', '9', 'no live generation');", ''),
    G('O-17', "if (s.kind === 'other') return door.others === 'hook' ?", "if (s.kind === 'other') return door.others !== 'hook' ?"),
    G('O-18', "if (!start && ladder !== 'start-door' && ladder.kind === 'read') {\n    const unmet", "if (start && ladder !== 'start-door' && ladder.kind === 'read') {\n    const unmet"),
  ],
};

export const GATE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [READ_ACTOR_COLUMNS_KEY]: READ_ACTOR_COLUMNS_SET as MutantSet<never>,
  [CALLER_STANDING_KEY]: CALLER_STANDING_SET as MutantSet<never>,
  [FENCE_VERDICT_KEY]: FENCE_VERDICT_SET as MutantSet<never>,
  [COUNTER_VERDICT_KEY]: COUNTER_VERDICT_SET as MutantSet<never>,
  [OVERLORD_GATE_KEY]: OVERLORD_GATE_SET as MutantSet<never>,
};
