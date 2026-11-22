// The one sequence's deciders' cases and mutant sets (Overlord W1 sequence, plan `w1-sequence-monitor.md` Tasks 1 and 3). The
// cases are written ONCE here, as suite cases over a module: `overlord-sequence.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { GENERATION_STATES } from '../../../shared/continuity.js';
import { DESIGNATION_SEQUENCE_STATES } from '../../../shared/overlord-designation.js';
import { SEQUENCE_KEEP_MS, SEQUENCE_PAGE_MAX, type SequenceWireLine } from '../../../shared/overlord-sequence.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/overlordSequence.ts');
const KEY = 'server/src/coord/overlordSequence.ts';

export type SequenceModule = typeof import('../../src/coord/overlordSequence.js');

// ------------------------------------------------------------------------------------------------------------ fixtures

type LineIn = Parameters<SequenceModule['sequenceLineVerdict']>[0];
const GOOD: LineIn = { kind: 'generation', id: '7', state: 'carded', actor: 'server', actorKind: 'server', at: 1_800_000_000_000 };
const with_ = (over: Partial<LineIn>): LineIn => ({ ...GOOD, ...over });

const wire = (seq: number, over: Partial<SequenceWireLine> = {}): SequenceWireLine =>
  ({ seq, at: seq * 1000, kind: 'generation', id: String(seq), state: 'active', actor: 'server', actorKind: 'server', known: true, ...over });
const linesFrom = (from: number, to: number): SequenceWireLine[] => Array.from({ length: to - from + 1 }, (_, i) => wire(from + i));

// ------------------------------------------------------------------------------------------------- sequenceLineVerdict

export function sequenceLineVerdictCases(m: SequenceModule): Record<string, SuiteCase> {
  const refusal = (l: LineIn): string | null => { const v = m.sequenceLineVerdict(l); return v.ok ? null : v.refusal; };
  return {
    'a well-formed line of each kind and each of its states is written': () => {
      for (const state of GENERATION_STATES) expect(refusal(with_({ kind: 'generation', state }))).toBeNull();
      for (const state of DESIGNATION_SEQUENCE_STATES) expect(refusal(with_({ kind: 'designation', state, id: 'overlord-a' }))).toBeNull();
    },
    'a kind outside the table is unknown-kind, before every other check': () => {
      for (const kind of ['', 'Generation', 'ladder-rung', 'constructor', '__proto__', 'toString']) {
        expect(refusal(with_({ kind, state: 'nope', id: '', actor: '', actorKind: 'nope', at: -1 }))).toBe('unknown-kind');
      }
    },
    "a state of another kind, or no kind's, is unknown-state": () => {
      expect(refusal(with_({ kind: 'generation', state: 'live' }))).toBe('unknown-state');
      expect(refusal(with_({ kind: 'designation', state: 'carded' }))).toBe('unknown-state');
      expect(refusal(with_({ kind: 'generation', state: '' }))).toBe('unknown-state');
      expect(refusal(with_({ kind: 'generation', state: 'CARDED', id: '' }))).toBe('unknown-state');
    },
    'the id is non-empty and at most 200 characters, checked before the actor': () => {
      expect(refusal(with_({ id: 'x'.repeat(200) }))).toBeNull();
      expect(refusal(with_({ id: 'x'.repeat(201) }))).toBe('bad-id');
      expect(refusal(with_({ id: '' , actor: '' }))).toBe('bad-id');
    },
    'the actor is non-empty and at most 200 characters, checked before its kind': () => {
      expect(refusal(with_({ actor: 'a'.repeat(200) }))).toBeNull();
      expect(refusal(with_({ actor: 'a'.repeat(201) }))).toBe('bad-actor');
      expect(refusal(with_({ actor: '', actorKind: 'nope' }))).toBe('bad-actor');
    },
    "the actor kind is one of gates A's three words, checked before the time": () => {
      for (const actorKind of ['operator', 'session', 'server']) expect(refusal(with_({ actorKind }))).toBeNull();
      for (const actorKind of ['', 'Server', 'robot', 'unknown', 'constructor']) expect(refusal(with_({ actorKind, at: -1 }))).toBe('bad-actor-kind');
    },
    'the time is a non-negative integer': () => {
      expect(refusal(with_({ at: 0 }))).toBeNull();
      expect(refusal(with_({ at: Number.MAX_SAFE_INTEGER }))).toBeNull();
      for (const at of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) expect(refusal(with_({ at }))).toBe('bad-at');
    },
  };
}

// --------------------------------------------------------------------------------------------------- sequenceLineKnown

export function sequenceLineKnownCases(m: SequenceModule): Record<string, SuiteCase> {
  return {
    "a line of a known kind, one of its states and one of gates A's actor kinds is known": () => {
      for (const s of GENERATION_STATES) expect(m.sequenceLineKnown('generation', s, 'server')).toBe(true);
      for (const s of DESIGNATION_SEQUENCE_STATES) for (const k of ['operator', 'session', 'server']) expect(m.sequenceLineKnown('designation', s, k)).toBe(true);
    },
    'a later kind, a state of another kind or an unknown actor kind is not known': () => {
      expect(m.sequenceLineKnown('ladder-rung', 'chat', 'operator')).toBe(false);
      expect(m.sequenceLineKnown('generation', 'live', 'server')).toBe(false);
      expect(m.sequenceLineKnown('designation', 'carded', 'operator')).toBe(false);
      expect(m.sequenceLineKnown('generation', 'active', 'robot')).toBe(false);
      expect(m.sequenceLineKnown('constructor', 'active', 'server')).toBe(false);
    },
  };
}

// -------------------------------------------------------------------------------------------------------- sequencePage

export function sequencePageCases(m: SequenceModule): Record<string, SuiteCase> {
  const facts = (head: number, prunedThrough: number | null = null) => ({ head, prunedThrough });
  return {
    'a cursor past the head answers ahead, never an empty page': () => {
      expect(m.sequencePage(11, 10, facts(10), [], 3)).toEqual({ kind: 'ahead', after: 11, head: 10, restoreGeneration: 3 });
      expect(m.sequencePage(1, 10, facts(0), [], 'unmeasured')).toEqual({ kind: 'ahead', after: 1, head: 0, restoreGeneration: 'unmeasured' });
    },
    'a cursor below the floor answers gap naming the floor, and the floor itself is no gap': () => {
      expect(m.sequencePage(4, 10, facts(10, 5), linesFrom(6, 10), 0)).toEqual({ kind: 'gap', after: 4, prunedThrough: 5, head: 10, restoreGeneration: 0 });
      expect(m.sequencePage(0, 10, facts(10, 1), linesFrom(2, 10), 0).kind).toBe('gap');
      const at = m.sequencePage(5, 10, facts(10, 5), linesFrom(6, 10), 0);
      expect(at).toEqual({ kind: 'page', lines: linesFrom(6, 10), next: 10, head: 10, restoreGeneration: 0 });
    },
    'ahead is decided before gap': () => {
      expect(m.sequencePage(12, 10, facts(10, 20), [], 0).kind).toBe('ahead');
    },
    'a page holds at most limit lines, in seq order, and next is the last line served': () => {
      const p = m.sequencePage(0, 3, facts(10), [...linesFrom(1, 10)].reverse(), 0);
      expect(p).toEqual({ kind: 'page', lines: linesFrom(1, 3), next: 3, head: 10, restoreGeneration: 0 });
    },
    'a line at or below the cursor is never served': () => {
      const p = m.sequencePage(5, 10, facts(10), linesFrom(1, 10), 0);
      expect(p.kind === 'page' && p.lines.map((l) => l.seq)).toEqual([6, 7, 8, 9, 10]);
    },
    'a caught-up reader gets an empty page with next at its cursor': () => {
      expect(m.sequencePage(10, 10, facts(10), [], 2)).toEqual({ kind: 'page', lines: [], next: 10, head: 10, restoreGeneration: 2 });
      expect(m.sequencePage(0, 10, facts(0), [], 2)).toEqual({ kind: 'page', lines: [], next: 0, head: 0, restoreGeneration: 2 });
    },
    'an emptied table with a floor answers gap below it and an empty page at it': () => {
      expect(m.sequencePage(3, 10, facts(9, 9), [], 0).kind).toBe('gap');
      expect(m.sequencePage(9, 10, facts(9, 9), [], 0)).toEqual({ kind: 'page', lines: [], next: 9, head: 9, restoreGeneration: 0 });
    },
    'the limit is at least one and at most SEQUENCE_PAGE_MAX': () => {
      const many = linesFrom(1, SEQUENCE_PAGE_MAX + 5);
      const big = m.sequencePage(0, SEQUENCE_PAGE_MAX + 5, facts(SEQUENCE_PAGE_MAX + 5), many, 0);
      expect(big.kind === 'page' && big.lines.length).toBe(SEQUENCE_PAGE_MAX);
      for (const limit of [0, -4, Number.NaN, 0.5]) {
        const one = m.sequencePage(0, limit, facts(10), linesFrom(1, 10), 0);
        expect(one.kind === 'page' && one.lines.map((l) => l.seq)).toEqual([1]);
      }
      const trunc = m.sequencePage(0, 2.9, facts(10), linesFrom(1, 10), 0);
      expect(trunc.kind === 'page' && trunc.lines.length).toBe(2);
    },
    'an opaque line is served as it came, never dropped': () => {
      const opaque = wire(2, { kind: 'ladder-rung', state: 'chat', known: false, actorKind: 'unknown' });
      const p = m.sequencePage(0, 10, facts(3), [wire(1), opaque, wire(3)], 0);
      expect(p.kind === 'page' && p.lines).toEqual([wire(1), opaque, wire(3)]);
    },
  };
}

// -------------------------------------------------------------------------------------------------------- retentionCut

export function retentionCutCases(m: SequenceModule): Record<string, SuiteCase> {
  const NOW = 200 * 86_400_000;
  const OLD = NOW - SEQUENCE_KEEP_MS - 1;   // one ms past the keep
  const EDGE = NOW - SEQUENCE_KEEP_MS;      // exactly the keep: not yet old
  const row = (seq: number, at: number, keep = false) => ({ seq, at, keep });
  return {
    'nothing when every line is younger than the keep, or there are none': () => {
      expect(m.retentionCut(NOW, [])).toEqual({ through: null });
      expect(m.retentionCut(NOW, [row(1, EDGE), row(2, NOW)])).toEqual({ through: null });
    },
    'the highest seq of the leading old run, and nothing after the first young line': () => {
      expect(m.retentionCut(NOW, [row(1, OLD - 5), row(2, OLD), row(3, EDGE), row(4, OLD)])).toEqual({ through: 2, keep: [] });
    },
    'the lines are read in seq order whatever order they arrive in': () => {
      expect(m.retentionCut(NOW, [row(3, NOW), row(1, OLD), row(2, OLD)])).toEqual({ through: 2, keep: [] });
    },
    'a kept line inside the run is named and does not stop it': () => {
      expect(m.retentionCut(NOW, [row(1, OLD), row(2, OLD, true), row(3, OLD), row(4, NOW)])).toEqual({ through: 3, keep: [2] });
    },
    'a kept line that is young stops the run like any young line': () => {
      expect(m.retentionCut(NOW, [row(1, OLD), row(2, NOW, true), row(3, OLD)])).toEqual({ through: 1, keep: [] });
    },
    'ninety days are kept by the wall clock, and a clock stepped back deletes nothing new': () => {
      expect(SEQUENCE_KEEP_MS).toBe(90 * 86_400_000);
      const rows = [row(1, OLD), row(2, OLD + 10)];
      expect(m.retentionCut(NOW, rows)).toEqual({ through: 1, keep: [] });
      expect(m.retentionCut(NOW - 1_000, rows)).toEqual({ through: null });
    },
  };
}

// -------------------------------------------------------------------------------------------------------- mutant sets

const set = (cases: (m: SequenceModule) => Record<string, SuiteCase>, mutants: MutantSet<SequenceModule>['mutants']): MutantSet<SequenceModule> =>
  ({ modulePath: MODULE, mutants, suite: cases });

const VERDICT_SET = set(sequenceLineVerdictCases, [
  { id: 'V1 any kind is in the table', old: "if (!isSequenceKind(l.kind)) return { ok: false, refusal: 'unknown-kind' };", new: '' },
  { id: 'V2 any state is the kind\'s', old: "  if (!(SEQUENCE_KIND_MAP[l.kind].states as readonly string[]).includes(l.state)) return { ok: false, refusal: 'unknown-state' };\n", new: '' },
  { id: 'V3 the id may be empty', old: 'const textWithin = (v: string, max: number): boolean => v.length > 0 && v.length <= max;', new: 'const textWithin = (v: string, max: number): boolean => v.length >= 0 && v.length <= max;' },
  { id: 'V4 the bound is exclusive', old: 'v.length > 0 && v.length <= max', new: 'v.length > 0 && v.length < max' },
  { id: 'V5 the id is unbounded', old: 'if (!textWithin(l.id, SEQUENCE_ID_MAX))', new: 'if (!textWithin(l.id, Infinity))' },
  { id: 'V6 the actor is not checked', old: "  if (!textWithin(l.actor, SEQUENCE_ACTOR_MAX)) return { ok: false, refusal: 'bad-actor' };\n", new: '' },
  { id: 'V7 any actor kind', old: "  if (!Object.hasOwn(ACTOR_KIND_MAP, l.actorKind)) return { ok: false, refusal: 'bad-actor-kind' };\n", new: '' },
  { id: 'V8 a fraction or NaN is a time', old: 'if (!Number.isSafeInteger(l.at) || l.at < 0)', new: 'if (l.at < 0)' },
  { id: 'V9 a negative time', old: 'if (!Number.isSafeInteger(l.at) || l.at < 0)', new: 'if (!Number.isSafeInteger(l.at))' },
  { id: 'V10 the order: actor before id', old: "  if (!textWithin(l.id, SEQUENCE_ID_MAX)) return { ok: false, refusal: 'bad-id' };\n  if (!textWithin(l.actor, SEQUENCE_ACTOR_MAX)) return { ok: false, refusal: 'bad-actor' };", new: "  if (!textWithin(l.actor, SEQUENCE_ACTOR_MAX)) return { ok: false, refusal: 'bad-actor' };\n  if (!textWithin(l.id, SEQUENCE_ID_MAX)) return { ok: false, refusal: 'bad-id' };" },
]);

const KNOWN_SET = set(sequenceLineKnownCases, [
  { id: 'K1 any kind is known', old: 'return isSequenceKind(kind) && (SEQUENCE_KIND_MAP', new: 'return (SEQUENCE_KIND_MAP' },
  { id: 'K2 any state is known', old: '(SEQUENCE_KIND_MAP[kind].states as readonly string[]).includes(state)\n    && Object', new: 'true\n    && Object' },
  { id: 'K3 any actor kind is known', old: '    && Object.hasOwn(ACTOR_KIND_MAP, actorKind);', new: ';' },
]);

const PAGE_SET = set(sequencePageCases, [
  { id: 'P1 no ahead arm', old: "  if (after > f.head) return { kind: 'ahead', after, head: f.head, restoreGeneration };\n", new: '' },
  { id: 'P2 ahead at the head', old: 'if (after > f.head)', new: 'if (after >= f.head)' },
  { id: 'P3 no gap arm', old: 'if (f.prunedThrough !== null && after < f.prunedThrough)', new: 'if (false)' },
  { id: 'P4 the floor itself is a gap', old: 'after < f.prunedThrough', new: 'after <= f.prunedThrough' },
  { id: 'P5 a gap is an empty page', old: "    return { kind: 'gap', after, prunedThrough: f.prunedThrough, head: f.head, restoreGeneration };", new: "    return { kind: 'page', lines: [], next: after, head: f.head, restoreGeneration };" },
  { id: 'P6 the cursor line is served', old: 'lines.filter((l) => l.seq > after)', new: 'lines.filter((l) => l.seq >= after)' },
  { id: 'P7 unsorted', old: 'lines.filter((l) => l.seq > after).sort((a, b) => a.seq - b.seq)', new: 'lines.filter((l) => l.seq > after)' },
  { id: 'P8 no limit', old: '.slice(0, pageSize(limit))', new: '' },
  { id: 'P9 no ceiling on the limit', old: 'Math.min(SEQUENCE_PAGE_MAX, Math.max(', new: 'Math.min(Infinity, Math.max(' },
  { id: 'P10 a zero limit serves nothing', old: 'Math.max(1, Number.isFinite', new: 'Math.max(0, Number.isFinite' },
  { id: 'P11 next is the head', old: 'next: served.length === 0 ? after : served[served.length - 1]!.seq', new: 'next: f.head' },
  { id: 'P12 an empty page moves the cursor to zero', old: 'served.length === 0 ? after :', new: 'served.length === 0 ? 0 :' },
  { id: 'P13 an opaque line is dropped', old: 'lines.filter((l) => l.seq > after)', new: 'lines.filter((l) => l.seq > after && l.known)' },
]);

const CUT_SET = set(retentionCutCases, [
  { id: 'C1 the run does not stop at a young line', old: '    if (!(l.at < cutoff)) break;\n', new: '    if (!(l.at < cutoff)) continue;\n' },
  { id: 'C2 the keep edge is old', old: 'if (!(l.at < cutoff))', new: 'if (!(l.at <= cutoff))' },
  { id: 'C3 a kept line is not named', old: '    if (l.keep) keep.push(l.seq);\n', new: '' },
  { id: 'C4 a kept line stops the run', old: '    through = l.seq;\n    if (l.keep) keep.push(l.seq);', new: '    if (l.keep) break;\n    through = l.seq;' },
  { id: 'C5 arrival order', old: '[...oldest].sort((a, b) => a.seq - b.seq)', new: '[...oldest]' },
  { id: 'C6 no keep window', old: 'const cutoff = now - SEQUENCE_KEEP_MS;', new: 'const cutoff = now;' },
]);

export const SEQUENCE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#sequenceLineVerdict`]: VERDICT_SET as MutantSet<never>,
  [`${KEY}#sequenceLineKnown`]: KNOWN_SET as MutantSet<never>,
  [`${KEY}#sequencePage`]: PAGE_SET as MutantSet<never>,
  [`${KEY}#retentionCut`]: CUT_SET as MutantSet<never>,
};
