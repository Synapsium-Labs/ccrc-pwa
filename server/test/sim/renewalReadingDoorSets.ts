// The renewal readings' door process mappers (Overlord W1, plan `w1-renewal-readings.md`, PR E, Task 8): `modelDriftInputOf`,
// `modelDriftReadingOf` and `readersRunningReadingOf`. Their cases are written ONCE here, as suite cases over a module:
// `continuity-renewal-readings-door.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs them
// against each textual mutant, through `renewalReadingSets.ts`'s map. A file of its own, so this pull request adds no hunk
// beside a peer's cases (slug door-readings-tests-in-own-files).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { READER_STALE_MS } from '../../../shared/continuity-reports.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/continuity/renewalReadings.ts');

type DoorModule = typeof import('../../src/continuity/renewalReadings.js');
type SidecarRead = import('../../src/continuity/renewalReadings.js').SidecarRead;

/** The generation's start, by the fleet node's clock (ms), and a sidecar written a minute after it (seconds). */
const START = Date.UTC(2026, 5, 10, 12, 0, 0);
const AFTER_S = START / 1000 + 60;
const sidecar = (cls: string | null, o: { stale?: boolean; ts?: number } = {}): SidecarRead =>
  ({ kind: 'reading', usage: { class: cls, ts: o.ts ?? AFTER_S, stale: o.stale ?? false } });
const measured = <T>(value: T) => ({ kind: 'measured' as const, value });
const NO_SWITCHES = { ok: true as const, value: [] };
const drift = (m: DoorModule, o: { startModel?: string | null; switches?: Parameters<DoorModule['modelDriftReadingOf']>[0]['switches']; usage?: SidecarRead }) =>
  m.modelDriftReadingOf({ startModel: o.startModel === undefined ? 'claude-opus-5-5' : o.startModel, startReportedAt: START,
    switches: o.switches ?? NO_SWITCHES, usage: o.usage ?? sidecar('opus') });
const isUnmeasured = (r: { readonly kind: string; readonly why?: string }, why: RegExp): void => {
  expect(r.kind).toBe('unmeasured');
  expect(r.why).toMatch(why);
};

// ------------------------------------------------------------------------------------------------- modelDriftInputOf

export function modelDriftInputCases(m: DoorModule): Record<string, SuiteCase> {
  return {
    'a fresh sidecar written after the start is fresh evidence, its class kept': () => {
      expect(m.modelDriftInputOf(sidecar('fable'), START)).toEqual({ sidecar: { kind: 'fresh', class: 'fable' }, why: null });
      expect(m.modelDriftInputOf(sidecar(null), START)).toEqual({ sidecar: { kind: 'fresh', class: null }, why: null });
    },
    'a stale sidecar is stale, never fresh': () => {
      expect(m.modelDriftInputOf(sidecar('fable', { stale: true }), START)).toEqual({ sidecar: { kind: 'stale' }, why: 'usage stale' });
    },
    'a sidecar written at or before the start is the predecessor\'s: stale, never fresh': () => {
      for (const ts of [START / 1000, START / 1000 - 1, Math.floor((START - 1) / 1000)]) {
        expect(m.modelDriftInputOf(sidecar('fable', { ts }), START), String(ts)).toEqual({ sidecar: { kind: 'stale' }, why: 'usage from before the start' });
      }
      expect(m.modelDriftInputOf(sidecar('fable', { ts: START / 1000 + 1 }), START).sidecar.kind).toBe('fresh');
    },
    'an absent, unreadable or malformed usage is absent evidence and keeps its own word': () => {
      for (const kind of ['absent', 'unreadable', 'malformed'] as const) {
        expect(m.modelDriftInputOf({ kind }, START), kind).toEqual({ sidecar: { kind: 'absent' }, why: `usage ${kind}` });
      }
    },
  };
}

const MODEL_DRIFT_INPUT_SET: MutantSet<DoorModule> = {
  modulePath: MODULE,
  mutants: [
    // The plan's two (Task 8, Step 5): a stale sidecar read as fresh; an unread usage read as no class.
    { id: 'I1', old: "if (usage.usage.stale) return { sidecar: { kind: 'stale' }, why: 'usage stale' };\n", new: '' },
    { id: 'I2', old: "return { sidecar: { kind: 'absent' }, why: `usage ${usage.kind}` };", new: "return { sidecar: { kind: 'fresh', class: null }, why: null };" },
    { id: 'I3', old: "  if (usage.usage.ts * 1000 <= startReportedAt) return { sidecar: { kind: 'stale' }, why: 'usage from before the start' };\n", new: '' },
    { id: 'I4', old: 'usage.usage.ts * 1000 <= startReportedAt', new: 'usage.usage.ts * 1000 < startReportedAt' },
    { id: 'I5', old: "return { sidecar: { kind: 'fresh', class: usage.usage.class }, why: null };", new: "return { sidecar: { kind: 'stale' }, why: null };" },
  ],
  suite: modelDriftInputCases,
};

// ------------------------------------------------------------------------------------------------- modelDriftReadingOf

export function modelDriftReadingCases(m: DoorModule): Record<string, SuiteCase> {
  return {
    'a switch since the start makes the drift measured true': () => {
      expect(drift(m, { switches: { ok: true, value: [{ how: 'switched', to: 'claude-fable-5-2' }] } })).toEqual(measured(true));
    },
    'a typed-refused switch changes nothing: with a fresh sidecar of the start\'s class, measured false': () => {
      expect(drift(m, { switches: { ok: true, value: [{ how: 'typed-refused', to: 'claude-fable-5-2' }] } })).toEqual(measured(false));
    },
    'a fresh sidecar of another class than the start\'s is measured true': () => {
      expect(drift(m, { usage: sidecar('fable') })).toEqual(measured(true));
    },
    'the start and a sidecar name the class in different spellings: measured false': () => {
      expect(drift(m, { startModel: 'claude-opus-5-5[1m]', usage: sidecar('opus') })).toEqual(measured(false));
    },
    'a stale sidecar with no switch reads unmeasured, never false, and names the stale usage': () => {
      isUnmeasured(drift(m, { usage: sidecar('opus', { stale: true }) }), /\(usage stale\)$/);
    },
    'a stale sidecar of ANOTHER class never fires the hard row': () => {
      isUnmeasured(drift(m, { usage: sidecar('fable', { stale: true }) }), /usage stale/);
    },
    'the predecessor\'s sidecar of another class never fires the hard row (a renewal that changed the class)': () => {
      isUnmeasured(drift(m, { usage: sidecar('fable', { ts: START / 1000 - 30 }) }), /usage from before the start/);
    },
    'an absent or unreadable usage with no switch reads unmeasured with its word, never true or false': () => {
      for (const kind of ['absent', 'unreadable', 'malformed'] as const) isUnmeasured(drift(m, { usage: { kind } }), new RegExp(`\\(usage ${kind}\\)$`));
    },
    'an unknown start model reads unmeasured, even beside a fresh sidecar of some class': () => {
      isUnmeasured(drift(m, { startModel: null, usage: sidecar('fable') }), /start model class is unknown/);
      isUnmeasured(drift(m, { startModel: 'not-a-model', usage: sidecar('fable') }), /start model class is unknown/);
    },
    'switches that could not be read read unmeasured with the detail, unless a fresh sidecar already differs': () => {
      isUnmeasured(drift(m, { switches: { ok: false, detail: 'locked' } }), /could not be read: locked/);
      expect(drift(m, { switches: { ok: false, detail: 'locked' }, usage: sidecar('fable') })).toEqual(measured(true));
    },
    'a fresh sidecar that names no class says nothing: unmeasured, without a usage word': () => {
      const r = drift(m, { usage: sidecar(null) });
      isUnmeasured(r, /no fresh sidecar class/);
      expect(r.kind === 'unmeasured' ? r.why : '').not.toMatch(/\(usage/);
    },
  };
}

const MODEL_DRIFT_READING_SET: MutantSet<DoorModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'R1', old: "if (a.ok) return { kind: 'measured', value: a.value };", new: "if (a.ok) return { kind: 'measured', value: true };" },
    { id: 'R2', old: 'return unmeasured(side.why === null ? a.detail : `${a.detail} (${side.why})`);', new: "return { kind: 'measured', value: false };" },
    { id: 'R3', old: 'return unmeasured(side.why === null ? a.detail : `${a.detail} (${side.why})`);', new: 'return unmeasured(a.detail);' },
    { id: 'R4', old: 'startClass: i.startModel === null ? null : familyClassOf(i.startModel)', new: 'startClass: i.startModel' },
    { id: 'R5', old: 'const side = modelDriftInputOf(i.usage, i.startReportedAt);', new: 'const side = modelDriftInputOf(i.usage, 0);' },
  ],
  suite: modelDriftReadingCases,
};

// ------------------------------------------------------------------------------------------------- readersRunningReadingOf

export function readersRunningReadingCases(m: DoorModule): Record<string, SuiteCase> {
  const NOW = START + 10 * 60_000;
  const ev = (kind: 'reader-start' | 'reader-stop', agentId: string, receivedAt: number) => ({ kind, agentId, receivedAt });
  const read = (events: readonly ReturnType<typeof ev>[] | readonly { kind: 'readers-clear'; receivedAt: number }[], since = START) =>
    ({ ok: true as const, value: { since, events } });
  return {
    'three reader starts with one stop read 2': () => {
      expect(m.readersRunningReadingOf(read([ev('reader-start', 'a1', START + 1), ev('reader-start', 'a2', START + 2),
        ev('reader-start', 'a3', START + 3), ev('reader-stop', 'a2', START + 4)]), NOW)).toEqual(measured(2));
    },
    'no events read a measured 0': () => {
      expect(m.readersRunningReadingOf(read([]), NOW)).toEqual(measured(0));
    },
    'a start older than READER_STALE_MS with no stop reads unmeasured, never a count that leaves it out': () => {
      const old = START + 1;
      isUnmeasured(m.readersRunningReadingOf(read([ev('reader-start', 'a1', old)]), old + READER_STALE_MS + 1), /reader a1 started over/);
    },
    'events before the start the read names are not counted': () => {
      expect(m.readersRunningReadingOf(read([ev('reader-start', 'a1', START - 5)]), NOW)).toEqual(measured(0));
    },
    'a read that failed is unmeasured with its detail, never 0': () => {
      expect(m.readersRunningReadingOf({ ok: false, detail: 'no start row 9' }, NOW)).toEqual({ kind: 'unmeasured', why: 'no start row 9' });
    },
  };
}

const READERS_RUNNING_READING_SET: MutantSet<DoorModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'N1', old: 'if (!read.ok) return unmeasured(read.detail);', new: "if (!read.ok) return { kind: 'measured', value: 0 };" },
    { id: 'N2', old: 'generationStartedAt: read.value.since', new: 'generationStartedAt: 0' },
    { id: 'N3', old: "return a.ok ? { kind: 'measured', value: a.value } : unmeasured(a.detail);", new: "return { kind: 'measured', value: a.ok ? a.value : 0 };" },
    { id: 'N4', old: 'now: nowMs });', new: 'now: read.value.since });' },
  ],
  suite: readersRunningReadingCases,
};

export const RENEWAL_DOOR_READING_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalReadings.ts#modelDriftInputOf': MODEL_DRIFT_INPUT_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#modelDriftReadingOf': MODEL_DRIFT_READING_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#readersRunningReadingOf': READERS_RUNNING_READING_SET as MutantSet<never>,
};
