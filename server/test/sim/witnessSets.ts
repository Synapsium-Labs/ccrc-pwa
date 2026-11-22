// `witnessVerdict`'s and `unwitnessedLatchDue`'s oracles and mutant sets (Overlord W1 door process B1, plan `w1-door-process.md`
// Task 9 Step 5; its Global Constraints' "Mutation floors"). The cases are written ONCE here, as suite cases over a module:
// `continuity-witness.test.ts` runs them against the real module, and `mutation-floors.test.ts` against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import { WITNESS_WINDOW_MS } from '../../../shared/continuity-reports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type HookReportsModule = typeof import('../../src/continuity/hookReports.js');

const KEY = 'ab'.repeat(32);
const NOW = 10_000_000;
const W = WITNESS_WINDOW_MS;
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const bad = (detail: string): { ok: false; detail: string } => ({ ok: false, detail });
const w = (id: number, receivedAt: number, agentId: string | null = null) => ({ id, agentId, receivedAt });
const NONE = new Set<number>();

export function witnessVerdictCases(m: HookReportsModule): Record<string, SuiteCase> {
  const v = (over: Record<string, unknown> = {}) => m.witnessVerdict({
    witnesses: ok([]), used: ok(NONE), key: KEY, generationStartedAt: 0, now: NOW, ...over,
  } as never);
  return {
    'a fresh main-thread unused witness for the key is witnessed with its id': () => {
      expect(v({ witnesses: ok([w(7, NOW - 1000)]) })).toEqual({ kind: 'witnessed', witnessId: 7 });
    },
    'a missing key is unwitnessed none, whatever is stored or unreadable': () => {
      expect(v({ key: null, witnesses: ok([w(7, NOW - 1000)]) })).toEqual({ kind: 'unwitnessed', why: 'none' });
      expect(v({ key: null, witnesses: bad('x'), used: bad('y') })).toEqual({ kind: 'unwitnessed', why: 'none' });
    },
    'no witness at all is unwitnessed none': () => { expect(v()).toEqual({ kind: 'unwitnessed', why: 'none' }); },
    'the window: exactly 120 s before now counts, one ms past is stale': () => {
      expect(v({ witnesses: ok([w(1, NOW - W)]) })).toEqual({ kind: 'witnessed', witnessId: 1 });
      expect(v({ witnesses: ok([w(1, NOW - W - 1)]) })).toEqual({ kind: 'unwitnessed', why: 'stale' });
    },
    'the generation start: a witness at the start counts, one ms before is before-generation': () => {
      const start = NOW - 1000;
      expect(v({ witnesses: ok([w(1, start)]), generationStartedAt: start })).toEqual({ kind: 'witnessed', witnessId: 1 });
      expect(v({ witnesses: ok([w(1, start - 1)]), generationStartedAt: start })).toEqual({ kind: 'unwitnessed', why: 'before-generation' });
    },
    'a used witness is unwitnessed used': () => {
      expect(v({ witnesses: ok([w(7, NOW - 1000)]), used: ok(new Set([7])) })).toEqual({ kind: 'unwitnessed', why: 'used' });
    },
    'a witness carrying an agent id (a reader) is never main-thread': () => {
      expect(v({ witnesses: ok([w(7, NOW - 1000, 'agent-1')]) })).toEqual({ kind: 'unwitnessed', why: 'reader-scope' });
      expect(v({ witnesses: ok([w(7, NOW - 1000, 'agent-1'), w(8, NOW - 2000, 'agent-2')]) })).toEqual({ kind: 'unwitnessed', why: 'reader-scope' });
    },
    'a reader\'s witness beside a main-thread one never replaces it': () => {
      expect(v({ witnesses: ok([w(9, NOW - 100, 'agent-1'), w(7, NOW - 1000)]) })).toEqual({ kind: 'witnessed', witnessId: 7 });
    },
    'two for one key: the newest unused one is taken, an older unused one when the newest is used': () => {
      expect(v({ witnesses: ok([w(8, NOW - 500), w(7, NOW - 1000)]) })).toEqual({ kind: 'witnessed', witnessId: 8 });
      expect(v({ witnesses: ok([w(7, NOW - 1000), w(8, NOW - 500)]) })).toEqual({ kind: 'witnessed', witnessId: 8 });
      expect(v({ witnesses: ok([w(8, NOW - 500), w(7, NOW - 1000)]), used: ok(new Set([8])) })).toEqual({ kind: 'witnessed', witnessId: 7 });
      expect(v({ witnesses: ok([w(8, NOW - 500), w(7, NOW - 1000)]), used: ok(new Set([8, 7])) })).toEqual({ kind: 'unwitnessed', why: 'used' });
    },
    'the same receipt time breaks to the higher id': () => {
      expect(v({ witnesses: ok([w(7, NOW - 500), w(8, NOW - 500)]) })).toEqual({ kind: 'witnessed', witnessId: 8 });
      expect(v({ witnesses: ok([w(8, NOW - 500), w(7, NOW - 500)]) })).toEqual({ kind: 'witnessed', witnessId: 8 });
    },
    'a stale or early witness never stands in for a fresh one that is used': () => {
      expect(v({ witnesses: ok([w(1, NOW - 100), w(2, NOW - W - 5)]), used: ok(new Set([1])) })).toEqual({ kind: 'unwitnessed', why: 'used' });
    },
    'the reason when several kinds of witness fail: used, then before-generation, then stale, then reader-scope': () => {
      const start = NOW - 5000;
      const used = w(1, NOW - 100);
      const early = w(2, NOW - 6000);
      const stale = w(3, NOW - W - 100);
      const reader = w(4, NOW - 100, 'agent-1');
      const u = ok(new Set([1]));
      const x = (ws: ReturnType<typeof w>[], usedSet = u) => v({ witnesses: ok(ws), used: usedSet, generationStartedAt: start });
      expect(x([reader, stale, early, used])).toEqual({ kind: 'unwitnessed', why: 'used' });
      expect(x([reader, stale, early])).toEqual({ kind: 'unwitnessed', why: 'before-generation' });
      expect(x([reader, stale])).toEqual({ kind: 'unwitnessed', why: 'stale' });
      expect(x([reader])).toEqual({ kind: 'unwitnessed', why: 'reader-scope' });
    },
    'a failed witnesses read is unmeasured, never none': () => {
      expect(v({ witnesses: bad('table gone') })).toEqual({ kind: 'unmeasured', why: 'table gone' });
    },
    'a failed used read is unmeasured, even when a witness would stand': () => {
      expect(v({ witnesses: ok([w(7, NOW - 1000)]), used: bad('checks gone') })).toEqual({ kind: 'unmeasured', why: 'checks gone' });
      expect(v({ witnesses: ok([]), used: bad('checks gone') })).toEqual({ kind: 'unmeasured', why: 'checks gone' });
    },
  };
}

export function unwitnessedLatchCases(m: HookReportsModule): Record<string, SuiteCase> {
  return {
    'the latch is due at three unwitnessed and no standing latch, not at two': () => {
      expect(m.unwitnessedLatchDue({ count: 0, latchStanding: false })).toBe(false);
      expect(m.unwitnessedLatchDue({ count: 2, latchStanding: false })).toBe(false);
      expect(m.unwitnessedLatchDue({ count: 3, latchStanding: false })).toBe(true);
    },
    'a count above three is still due, and a standing latch is never due again': () => {
      expect(m.unwitnessedLatchDue({ count: 4, latchStanding: false })).toBe(true);
      expect(m.unwitnessedLatchDue({ count: 3, latchStanding: true })).toBe(false);
      expect(m.unwitnessedLatchDue({ count: 40, latchStanding: true })).toBe(false);
    },
    'the count window starts at the later of 24 hours ago and the last clear': () => {
      const day = 24 * 3_600_000;
      expect(m.latchWindowStart({ now: 10 * day, clearedAt: null })).toBe(9 * day);
      expect(m.latchWindowStart({ now: 10 * day, clearedAt: 9 * day + 5 })).toBe(9 * day + 5);
      expect(m.latchWindowStart({ now: 10 * day, clearedAt: 8 * day })).toBe(9 * day);
    },
  };
}

const MUTANTS = [
  { id: 'W1 the missing-key arm removed', old: "  if (i.key === null) return { kind: 'unwitnessed', why: 'none' };\n", new: '' },
  { id: 'W2 the witnesses read failure folded into none', old: "  if (!i.witnesses.ok) return { kind: 'unmeasured', why: i.witnesses.detail };\n", new: "  if (!i.witnesses.ok) return { kind: 'unwitnessed', why: 'none' };\n" },
  { id: 'W3 the used read failure ignored', old: "  if (!i.used.ok) return { kind: 'unmeasured', why: i.used.detail };\n", new: '' },
  { id: 'W4 the window edge moved one ms in', old: 'w.receivedAt < i.now - WITNESS_WINDOW_MS', new: 'w.receivedAt <= i.now - WITNESS_WINDOW_MS' },
  { id: 'W5 the window edge moved one ms out', old: 'w.receivedAt < i.now - WITNESS_WINDOW_MS', new: 'w.receivedAt < i.now - WITNESS_WINDOW_MS - 1' },
  { id: 'W6 the generation edge moved one ms in', old: 'w.receivedAt < i.generationStartedAt', new: 'w.receivedAt <= i.generationStartedAt' },
  { id: 'W7 the generation edge moved one ms out', old: 'w.receivedAt < i.generationStartedAt', new: 'w.receivedAt < i.generationStartedAt - 1' },
  { id: 'W8 the before-generation arm dropped', old: "    if (w.receivedAt < i.generationStartedAt) { miss.add('before-generation'); continue; }\n", new: '' },
  { id: 'W9 the stale arm dropped', old: "    if (w.receivedAt < i.now - WITNESS_WINDOW_MS) { miss.add('stale'); continue; }\n", new: '' },
  { id: 'W10 a reader witness read as main-thread', old: "    if (w.agentId !== null) { miss.add('reader-scope'); continue; }\n", new: '' },
  { id: 'W11 the used set ignored', old: "    if (i.used.value.has(w.id)) { miss.add('used'); continue; }\n", new: '' },
  { id: 'W12 the oldest qualifying witness taken, not the newest', old: 'best === null || newer(w, best)', new: 'best === null' },
  { id: 'W13 the tie on receipt time broken to the lower id', old: 'a.receivedAt > b.receivedAt || (a.receivedAt === b.receivedAt && a.id > b.id)', new: 'a.receivedAt > b.receivedAt || (a.receivedAt === b.receivedAt && a.id < b.id)' },
  { id: 'W14 the reason precedence reversed (reader-scope first)', old: "  for (const why of ['used', 'before-generation', 'stale', 'reader-scope'] as const) {", new: "  for (const why of ['reader-scope', 'stale', 'before-generation', 'used'] as const) {" },
  { id: 'W15 no witness at all not none (reads stale)', old: "  return { kind: 'unwitnessed', why: 'none' };\n}", new: "  return { kind: 'unwitnessed', why: 'stale' };\n}" },
] as const;

const LATCH_MUTANTS = [
  { id: 'L1 the threshold lowered to two', old: 'i.count >= UNWITNESSED_LATCH_AT', new: 'i.count >= UNWITNESSED_LATCH_AT - 1' },
  { id: 'L2 the threshold raised to four', old: 'i.count >= UNWITNESSED_LATCH_AT', new: 'i.count >= UNWITNESSED_LATCH_AT + 1' },
  { id: 'L3 the count compared for equality', old: 'i.count >= UNWITNESSED_LATCH_AT', new: 'i.count === UNWITNESSED_LATCH_AT' },
  { id: 'L4 a standing latch ignored', old: 'return !i.latchStanding && ', new: 'return ' },
  { id: 'L5 the window ignores the last clear', old: 'Math.max(i.now - UNWITNESSED_WINDOW_MS, i.clearedAt ?? -Infinity)', new: 'i.now - UNWITNESSED_WINDOW_MS' },
  { id: 'L6 the window ignores the day', old: 'Math.max(i.now - UNWITNESSED_WINDOW_MS, i.clearedAt ?? -Infinity)', new: 'i.clearedAt ?? 0' },
  { id: 'L7 the window takes the earlier, not the later', old: 'Math.max(i.now - UNWITNESSED_WINDOW_MS, i.clearedAt ?? -Infinity)', new: 'Math.min(i.now - UNWITNESSED_WINDOW_MS, i.clearedAt ?? Infinity)' },
] as const;

const modulePath = path.join(ROOT, 'server/src/continuity/hookReports.ts');

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const WITNESS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/hookReports.ts#witnessVerdict': { modulePath, mutants: MUTANTS, suite: witnessVerdictCases } as MutantSet<never>,
  'server/src/continuity/hookReports.ts#unwitnessedLatchDue': { modulePath, mutants: LATCH_MUTANTS, suite: unwitnessedLatchCases } as MutantSet<never>,
};
