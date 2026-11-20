// The oracles and mutant sets of the hook reports' three readings (Overlord W1 door process B1, plan `w1-door-process.md`
// Task 9): `offModelOf`, `modelDriftOf` and `readersRunning`. The cases are written ONCE here as suite cases over the module:
// `continuity-readings.test.ts` runs them against the real module and `mutation-floors.test.ts` against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import { READER_STALE_MS } from '../../../shared/continuity-reports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export type HookReportsModule = typeof import('../../src/continuity/hookReports.js');

const ok = <T>(value: T) => ({ ok: true as const, value });
const bad = { ok: false as const, detail: 'read failed' };
const fresh = (cls: string | null) => ({ kind: 'fresh' as const, class: cls });
const STALE = { kind: 'stale' as const };
const ABSENT = { kind: 'absent' as const };
const sw = (how: 'switched' | 'typed-refused', toClass: string | null) => ({ how, toClass });

const unmeasured = (v: { ok: boolean }) => expect(v.ok).toBe(false);

export function offModelCases(m: HookReportsModule): Record<string, SuiteCase> {
  const off = m.offModelOf;
  const base = { designatedClass: 'fable', startClass: 'fable', switches: ok([]), sidecarClass: ABSENT };
  return {
    'on the designated class everywhere is false': () => {
      expect(off(base)).toEqual(ok(false));
      expect(off({ ...base, sidecarClass: fresh('fable') })).toEqual(ok(false));
      expect(off({ ...base, switches: ok([sw('switched', 'fable')]) })).toEqual(ok(false));
    },
    'a start class that differs is true': () => { expect(off({ ...base, startClass: 'opus' })).toEqual(ok(true)); },
    'a reported switch to another class is true, a typed-refused one changed nothing': () => {
      expect(off({ ...base, switches: ok([sw('switched', 'opus')]) })).toEqual(ok(true));
      expect(off({ ...base, switches: ok([sw('typed-refused', 'opus')]) })).toEqual(ok(false));
      expect(off({ ...base, switches: ok([sw('typed-refused', null)]) })).toEqual(ok(false));
    },
    'a fresh sidecar class that differs is true': () => { expect(off({ ...base, sidecarClass: fresh('opus') })).toEqual(ok(true)); },
    'a stale or absent sidecar is no evidence either way': () => {
      expect(off({ ...base, sidecarClass: STALE })).toEqual(ok(false));
      expect(off({ ...base, sidecarClass: ABSENT })).toEqual(ok(false));
      expect(off({ ...base, startClass: 'opus', sidecarClass: STALE })).toEqual(ok(true));
      unmeasured(off({ ...base, startClass: null, sidecarClass: STALE }));
    },
    'an unknown start class is unmeasured, never false': () => {
      const v = off({ ...base, startClass: null });
      unmeasured(v);
      if (!v.ok) expect(v.detail).toMatch(/start/);
    },
    'a failed switches read is unmeasured, never false': () => {
      const v = off({ ...base, switches: bad });
      unmeasured(v);
      if (!v.ok) expect(v.detail).toMatch(/switch/);
    },
    'a switch to an unknown class is unmeasured, never false': () => { unmeasured(off({ ...base, switches: ok([sw('switched', null)]) })); },
    'a fresh sidecar with no class is no evidence': () => {
      expect(off({ ...base, sidecarClass: fresh(null) })).toEqual(ok(false));
    },
    'a measured difference outranks an unmeasured input': () => {
      expect(off({ ...base, startClass: null, sidecarClass: fresh('opus') })).toEqual(ok(true));
      expect(off({ ...base, switches: bad, sidecarClass: fresh('opus') })).toEqual(ok(true));
      expect(off({ ...base, switches: bad, startClass: 'opus' })).toEqual(ok(true));
    },
  };
}

export function modelDriftCases(m: HookReportsModule): Record<string, SuiteCase> {
  const drift = m.modelDriftOf;
  const base = { startClass: 'fable', switches: ok([]), sidecarClass: fresh('fable') };
  return {
    'a fresh sidecar on the start class with no switch is false': () => { expect(drift(base)).toEqual(ok(false)); },
    'a reported switch other than typed-refused is true, whatever the sidecar': () => {
      for (const sidecarClass of [fresh('fable'), STALE, ABSENT]) expect(drift({ ...base, switches: ok([sw('switched', 'fable')]), sidecarClass })).toEqual(ok(true));
      expect(drift({ ...base, startClass: null, switches: ok([sw('switched', 'opus')]), sidecarClass: STALE })).toEqual(ok(true));
    },
    'a typed-refused switch alone is no drift': () => {
      expect(drift({ ...base, switches: ok([sw('typed-refused', 'opus')]) })).toEqual(ok(false));
    },
    'a fresh sidecar class that differs from the start is true': () => {
      expect(drift({ ...base, sidecarClass: fresh('opus') })).toEqual(ok(true));
      expect(drift({ ...base, switches: bad, sidecarClass: fresh('opus') })).toEqual(ok(true));
    },
    'a stale or absent sidecar with no switch report is unmeasured, never false': () => {
      unmeasured(drift({ ...base, sidecarClass: STALE }));
      unmeasured(drift({ ...base, sidecarClass: ABSENT }));
      unmeasured(drift({ ...base, sidecarClass: fresh(null) }));
    },
    'an unknown start class with no switch is unmeasured': () => {
      unmeasured(drift({ ...base, startClass: null }));
      unmeasured(drift({ ...base, startClass: null, sidecarClass: STALE }));
    },
    'a failed switches read with a sidecar that agrees is unmeasured': () => {
      const v = drift({ ...base, switches: bad });
      unmeasured(v);
      if (!v.ok) expect(v.detail).toMatch(/switch/);
    },
  };
}

export function readersRunningCases(m: HookReportsModule): Record<string, SuiteCase> {
  const run = m.readersRunning;
  const T0 = 1_000_000;
  const start = (agentId: string, receivedAt: number) => ({ kind: 'reader-start' as const, agentId, receivedAt });
  const stop = (agentId: string, receivedAt: number) => ({ kind: 'reader-stop' as const, agentId, receivedAt });
  const clear = (receivedAt: number) => ({ kind: 'readers-clear' as const, receivedAt });
  const at = (events: readonly unknown[], now: number, generationStartedAt = T0) =>
    run({ events: ok(events) as never, generationStartedAt, now });
  return {
    'no events is zero, measured': () => { expect(at([], T0 + 5)).toEqual(ok(0)); },
    'a start with no stop counts, a matched stop does not': () => {
      expect(at([start('a', T0 + 1)], T0 + 10)).toEqual(ok(1));
      expect(at([start('a', T0 + 1), start('b', T0 + 2)], T0 + 10)).toEqual(ok(2));
      expect(at([start('a', T0 + 1), start('b', T0 + 2), stop('a', T0 + 3)], T0 + 10)).toEqual(ok(1));
      expect(at([start('a', T0 + 1), stop('a', T0 + 3)], T0 + 10)).toEqual(ok(0));
    },
    'a restart of one id counts once': () => {
      expect(at([start('a', T0 + 1), start('a', T0 + 2)], T0 + 10)).toEqual(ok(1));
    },
    'events before the generation started are not counted': () => {
      expect(at([start('a', T0 - 1)], T0 + 10)).toEqual(ok(0));
      expect(at([start('a', T0)], T0 + 10)).toEqual(ok(1));
      expect(at([start('a', T0 - 5), start('b', T0 + 1)], T0 + 10)).toEqual(ok(1));
    },
    'a readers-clear ends every start before it, and only those': () => {
      expect(at([start('a', T0 + 1), start('b', T0 + 2), clear(T0 + 3)], T0 + 10)).toEqual(ok(0));
      expect(at([start('a', T0 + 1), clear(T0 + 3), start('b', T0 + 4)], T0 + 10)).toEqual(ok(1));
    },
    'a readers-clear heals a lost stop, and a stale start': () => {
      const old = T0 + 1;
      const now = old + READER_STALE_MS + 5;
      unmeasured(at([start('a', old)], now));
      expect(at([start('a', old), clear(old + 10)], now)).toEqual(ok(0));
    },
    'a stop for an id never started changes nothing': () => {
      expect(at([stop('z', T0 + 1), start('a', T0 + 2)], T0 + 10)).toEqual(ok(1));
    },
    'a start past READER_STALE_MS with no stop is unmeasured, naming the agent id': () => {
      const v = at([start('agent-old', T0 + 1)], T0 + 1 + READER_STALE_MS + 1);
      unmeasured(v);
      if (!v.ok) expect(v.detail).toContain('agent-old');
      const w = at([start('agent-old', T0 + 1), start('agent-new', T0 + READER_STALE_MS)], T0 + 1 + READER_STALE_MS + 1);
      unmeasured(w);
      if (!w.ok) { expect(w.detail).toContain('agent-old'); expect(w.detail).not.toContain('agent-new'); }
    },
    'a start exactly READER_STALE_MS old still counts': () => {
      expect(at([start('a', T0 + 1)], T0 + 1 + READER_STALE_MS)).toEqual(ok(1));
    },
    'a stale start that did stop is not stale': () => {
      expect(at([start('a', T0 + 1), stop('a', T0 + 2)], T0 + 1 + READER_STALE_MS * 3)).toEqual(ok(0));
    },
    'a failed events read is unmeasured, never zero': () => {
      const v = run({ events: bad, generationStartedAt: T0, now: T0 + 1 });
      unmeasured(v);
      if (!v.ok) expect(v.detail).toBe('read failed');
    },
    'events given out of order are walked in time order': () => {
      expect(at([stop('a', T0 + 3), start('a', T0 + 1)], T0 + 10)).toEqual(ok(0));
    },
  };
}

export type LadderModule = typeof import('../../src/coord/overlordLadder.js');
export function offModelReadingCases(m: LadderModule): Record<string, SuiteCase> {
  const designated = { kind: 'designated', sessionId: 'lane-a', term: 1, row: { model: 'fable' } } as never;
  const yes = { ok: true as const, value: true }; const no = { ok: true as const, value: false };
  return {
    'no designation, and a designated session with no live generation, read lifted': () => {
      expect(m.offModelReading({ kind: 'not-designated', row: null }, 'no-generation', bad)).toBe('lifted');
      expect(m.offModelReading({ kind: 'not-designated', row: null }, 'unmeasured', bad)).toBe('lifted');
      expect(m.offModelReading(designated, 'no-generation', bad)).toBe('lifted');
    },
    'an unreadable designation or generation reads unmeasured, never lifted': () => {
      expect(m.offModelReading({ kind: 'unmeasured', why: 'x' }, 'present', no)).toBe('unmeasured');
      expect(m.offModelReading({ kind: 'unmeasured', why: 'x' }, 'no-generation', no)).toBe('unmeasured');
      expect(m.offModelReading(designated, 'unmeasured', no)).toBe('unmeasured');
    },
    'a measured answer is standing or lifted, an unmeasured one is unmeasured': () => {
      expect(m.offModelReading(designated, 'present', yes)).toBe('standing');
      expect(m.offModelReading(designated, 'present', no)).toBe('lifted');
      expect(m.offModelReading(designated, 'present', bad)).toBe('unmeasured');
    },
  };
}

const OFF_MUTANTS = [
  { id: 'O1 unknown start class folded into false', old: "if (startClass === null) unmeasuredWhy = 'the generation start model class is unknown';", new: '' },
  { id: 'O2 a typed-refused switch counted', old: "if (s.how !== 'switched') continue;", new: '' },
  { id: 'O3 a failed switches read folded into false', old: "if (!switches.ok) unmeasuredWhy ??= `the model switches could not be read: ${switches.detail}`;", new: '' },
  { id: 'O4 the sidecar ignored', old: "if (sidecarClass.kind === 'fresh' && sidecarClass.class !== null && sidecarClass.class !== designatedClass) return { ok: true, value: true };", new: '' },
  { id: 'O5 a stale sidecar read as evidence', old: "sidecarClass.kind === 'fresh' && sidecarClass.class !== null && sidecarClass.class !== designatedClass", new: "sidecarClass.kind !== 'absent' && (sidecarClass as { class?: string | null }).class !== designatedClass" },
  { id: 'O6 a switch to an unknown class folded into false', old: "if (s.toClass === null) unmeasuredWhy ??= 'a reported switch names no known class';", new: '' },
  { id: 'O7 the switches never compared', old: "if (s.toClass !== null && s.toClass !== designatedClass) return { ok: true, value: true };", new: '' },
  { id: 'O8 the start class never compared', old: "if (startClass !== null && startClass !== designatedClass) return { ok: true, value: true };", new: '' },
] as const;

const DRIFT_MUTANTS = [
  { id: 'D1 a typed-refused switch counted as drift', old: "const moved = switches.value.some((s) => s.how === 'switched');", new: 'const moved = switches.value.length > 0;' },
  { id: 'D2 the sidecar never compared with the start', old: "if (sidecarClass.kind === 'fresh' && sidecarClass.class !== null && startClass !== null && sidecarClass.class !== startClass) return { ok: true, value: true };", new: '' },
  { id: 'D3 a stale sidecar with no switch read as no drift', old: "if (sidecarClass.kind !== 'fresh' || sidecarClass.class === null) return { ok: false, detail: 'no fresh sidecar class and no switch report: a switch Claude Code makes itself may fire no event' };", new: '' },
  { id: 'D4 an unknown start class read as no drift', old: "if (startClass === null) return { ok: false, detail: 'the generation start model class is unknown' };", new: '' },
  { id: 'D5 a failed switches read folded into no drift', old: "if (!switches.ok) return { ok: false, detail: `the model switches could not be read: ${switches.detail}` };", new: '' },
  { id: 'D6 a reported switch never counted', old: "if (moved) return { ok: true, value: true };", new: '' },
] as const;

const READERS_MUTANTS = [
  { id: 'R1 a failed events read folded into zero', old: "if (!events.ok) return { ok: false, detail: events.detail };", new: 'if (!events.ok) return { ok: true, value: 0 };' },
  { id: 'R2 a clear does not end the readers', old: "else if (e.kind === 'readers-clear') open.clear();", new: '' },
  { id: 'R3 a stop does not end its reader', old: "else if (e.kind === 'reader-stop') open.delete(e.agentId);", new: '' },
  { id: 'R4 events before the generation counted', old: 'if (e.receivedAt < generationStartedAt) continue;', new: '' },
  { id: 'R5 a stale start never unmeasured', old: 'if (now - startedAt > READER_STALE_MS)', new: 'if (false as boolean)' },
  { id: 'R6 the stale bound off by one', old: 'if (now - startedAt > READER_STALE_MS)', new: 'if (now - startedAt >= READER_STALE_MS)' },
  { id: 'R7 events not walked in time order', old: '.sort((a, b) => a.e.receivedAt - b.e.receivedAt || a.i - b.i)', new: '.sort((a, b) => a.i - b.i)' },
  { id: 'R8 a restart counted twice', old: "if (e.kind === 'reader-start') open.set(e.agentId, e.receivedAt);", new: "if (e.kind === 'reader-start') open.set(`${e.agentId}#${open.size}`, e.receivedAt);" },
] as const;

const modulePath = path.join(ROOT, 'server/src/continuity/hookReports.ts');
const OFF_READING_MUTANTS = [
  { id: 'M1 an unreadable designation read as lifted', old: "  if (designation.kind === 'unmeasured') return 'unmeasured';\n  if (designation.kind === 'not-designated') return 'lifted';\n  if (live === 'unmeasured') return 'unmeasured';\n  if (live === 'no-generation') return 'lifted';\n  if (!answer.ok)", new: "  if (designation.kind !== 'designated') return 'lifted';\n  if (live === 'unmeasured') return 'unmeasured';\n  if (live === 'no-generation') return 'lifted';\n  if (!answer.ok)" },
  { id: 'M2 no generation read as standing', old: "  if (live === 'no-generation') return 'lifted';\n  if (!answer.ok)", new: "  if (!answer.ok)" },
  { id: 'M3 an unreadable generation read as lifted', old: "  if (live === 'unmeasured') return 'unmeasured';\n  if (live === 'no-generation') return 'lifted';\n  if (!answer.ok)", new: "  if (live === 'unmeasured' || live === 'no-generation') return 'lifted';\n  if (!answer.ok)" },
  { id: 'M4 an unmeasured answer read as lifted', old: "if (!answer.ok) return 'unmeasured';\n  return answer.value", new: "if (!answer.ok) return 'lifted';\n  return answer.value" },
  { id: 'M5 a measured answer inverted', old: "return answer.value ? 'standing' : 'lifted';", new: "return answer.value ? 'lifted' : 'standing';" },
  { id: 'M6 no designation read as unmeasured', old: "  if (designation.kind === 'not-designated') return 'lifted';\n  if (live === 'unmeasured') return 'unmeasured';\n  if (live === 'no-generation') return 'lifted';\n  if (!answer.ok)", new: "  if (live === 'unmeasured') return 'unmeasured';\n  if (live === 'no-generation') return 'lifted';\n  if (!answer.ok)" },
] as const;

export const HOOK_READING_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/hookReports.ts#offModelOf': { modulePath, mutants: OFF_MUTANTS, suite: offModelCases } as MutantSet<never>,
  'server/src/continuity/hookReports.ts#modelDriftOf': { modulePath, mutants: DRIFT_MUTANTS, suite: modelDriftCases } as MutantSet<never>,
  'server/src/coord/overlordLadder.ts#offModelReading': { modulePath: path.join(ROOT, 'server/src/coord/overlordLadder.ts'), mutants: OFF_READING_MUTANTS, suite: offModelReadingCases } as MutantSet<never>,
  'server/src/continuity/hookReports.ts#readersRunning': { modulePath, mutants: READERS_MUTANTS, suite: readersRunningCases } as MutantSet<never>,
};
