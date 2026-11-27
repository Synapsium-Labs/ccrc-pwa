// The sequence doors' deciders' cases and mutant sets (Overlord W1, sequence C, plan `w1-sequence-monitor.md` Task 7). The cases
// are written ONCE here, as suite cases over a module: `overlord-sequence-door.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant. They live apart from `sequenceSets.ts` and `invariantSets.ts`
// (the sequence's and the monitor's own deciders, other runs' files).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { SEQUENCE_PAGE_MAX, type SequenceWireLine } from '../../../shared/overlord-sequence.js';
import type { FindingRow } from '../../src/coord/invariantFindingsStore.js';
import { INVARIANT_NAMES, type InvariantName, type InvariantVerdict } from '../../src/coord/invariants.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/overlordSequenceDoor.ts');
const KEY = 'server/src/coord/overlordSequenceDoor.ts';

export type SequenceDoorModule = typeof import('../../src/coord/overlordSequenceDoor.js');
type M = SequenceDoorModule;

// ------------------------------------------------------------------------------------------------------------ fixtures

const line = (seq: number, over: Partial<SequenceWireLine> = {}): SequenceWireLine =>
  ({ seq, at: seq * 1000, kind: 'generation', id: String(seq), state: 'active', actor: 'server', actorKind: 'server', known: true, ...over });
const measured = <V>(value: V) => ({ kind: 'measured', value }) as const;
const read = (head: number, prunedThrough: number | null, lines: readonly SequenceWireLine[]) =>
  measured({ facts: { head, prunedThrough }, lines });
const row = (id: number, over: Partial<FindingRow> = {}): FindingRow => ({
  id, invariant: 'I17', subject: `timer:${id}`, mode: 'shadow', seq: null, message: 'a fixture message', foundAt: 1000 + id,
  resolvedAt: null, latched: null, itemId: null, ...over,
});
const tally = { total: 0, open: 0, byInvariant: {} };
const COUNTS = measured({ live: tally, shadow: { total: 2, open: 1, byInvariant: { I17: 2 } } });

// ------------------------------------------------------------------------------------------------------------ the query

export function readSequenceQueryCases(m: M): Record<string, SuiteCase> {
  const q = m.readSequenceQuery;
  const refused = (raw: unknown, detail: RegExp): void => {
    const r = q(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(detail);
  };
  return {
    'no cursor keys: after 0 and a full page': () => {
      expect(q({ byId: 'overlord-a', byUuid: 'u' })).toEqual({ ok: true, after: 0, limit: SEQUENCE_PAGE_MAX });
      expect(q({})).toEqual({ ok: true, after: 0, limit: SEQUENCE_PAGE_MAX });
    },
    'after and limit read as canonical decimal integers': () => {
      expect(q({ after: '0', limit: '1' })).toEqual({ ok: true, after: 0, limit: 1 });
      expect(q({ after: '42', limit: String(SEQUENCE_PAGE_MAX) })).toEqual({ ok: true, after: 42, limit: SEQUENCE_PAGE_MAX });
      expect(q({ after: String(Number.MAX_SAFE_INTEGER) })).toEqual({ ok: true, after: Number.MAX_SAFE_INTEGER, limit: SEQUENCE_PAGE_MAX });
    },
    'a bad after is refused, naming the key and never the value': () => {
      for (const after of ['-1', '1.5', 'x', '', '01', ' 1', '1e3', '99999999999999999', '9999999999999999', ['5'], 5]) refused({ after }, /^after: /);
      const r = q({ after: 'a-secret-value' });
      expect(!r.ok && r.detail).not.toContain('a-secret-value');
    },
    'a limit of 0, past the page bound, or not an integer is refused': () => {
      for (const limit of ['0', String(SEQUENCE_PAGE_MAX + 1), '-1', 'all', ['5'], '007']) refused({ limit }, /^limit: /);
    },
    'a key the door does not take is refused': () => {
      refused({ after: '1', cursor: '2' }, /after and limit only/);
      refused({ byId: 'overlord-a', byUuid: 'u', limit: '5', extra: 'x' }, /after and limit only/);
    },
    'a query that is not a set of keys is refused': () => {
      for (const raw of [null, [], 'after=1', 3]) refused(raw, /not a set of keys/);
    },
  };
}

export function restoreGenerationOfCases(m: M): Record<string, SuiteCase> {
  const r = m.restoreGenerationOf;
  return {
    'a measured counter is served as its number, zero included': () => {
      expect(r({ kind: 'measured', n: 3 })).toBe(3);
      expect(r({ kind: 'measured', n: 0 })).toBe(0);
    },
    'unmeasured, a negative or a non-integer counter is the word unmeasured, never zero': () => {
      expect(r({ kind: 'unmeasured' })).toBe('unmeasured');
      expect(r({ kind: 'measured', n: -1 })).toBe('unmeasured');
      expect(r({ kind: 'measured', n: 1.5 })).toBe('unmeasured');
      expect(r({ kind: 'measured', n: Number.NaN })).toBe('unmeasured');
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ the answer

export function sequenceDoorAnswerCases(m: M): Record<string, SuiteCase> {
  const a = m.sequenceDoorAnswer;
  const lines = [line(4), line(5), line(6, { kind: 'drill', state: 'marked', known: false })];
  return {
    'a page is served rows: its lines, next, head and restore generation, counted for the ledger line': () => {
      expect(a(read(6, 3, lines), { after: 3, limit: 2 }, 7)).toEqual({
        kind: 'rows', scope: 'after=3', count: 2,
        body: { ok: true, kind: 'page', lines: [line(4), line(5)], next: 5, head: 6, restoreGeneration: 7 },
      });
    },
    'a line this build cannot name is served opaque, never dropped': () => {
      const r = a(read(6, null, lines), { after: 5, limit: 10 }, 'unmeasured');
      expect(r).toMatchObject({ kind: 'rows', count: 1, body: { lines: [{ seq: 6, kind: 'drill', state: 'marked', known: false }] } });
    },
    'a caught-up reader gets a page with no lines, its cursor unmoved': () => {
      expect(a(read(6, null, []), { after: 6, limit: 10 }, 0)).toEqual({
        kind: 'rows', scope: 'after=6', count: 0, body: { ok: true, kind: 'page', lines: [], next: 6, head: 6, restoreGeneration: 0 },
      });
    },
    'a cursor below the prune floor answers gap, naming the floor, never an empty page': () => {
      expect(a(read(9, 5, [line(6)]), { after: 2, limit: 10 }, 'unmeasured')).toEqual({
        kind: 'answer', scope: 'after=2', outcome: 'gap',
        body: { ok: true, kind: 'gap', after: 2, prunedThrough: 5, head: 9, restoreGeneration: 'unmeasured' },
      });
    },
    'a cursor past the head answers ahead, never an empty page': () => {
      expect(a(read(9, null, []), { after: 12, limit: 10 }, 2)).toEqual({
        kind: 'answer', scope: 'after=12', outcome: 'ahead', body: { ok: true, kind: 'ahead', after: 12, head: 9, restoreGeneration: 2 },
      });
    },
    'an unreadable sequence is unavailable with an unmeasured line, never a page': () => {
      expect(a({ kind: 'unmeasured', why: 'the sequence could not be read: x' }, { after: 0, limit: 10 }, 1)).toEqual({
        kind: 'refuse', word: 'unavailable', detail: 'the sequence could not be read: x', scope: 'after=0', outcome: 'unmeasured',
      });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ the operator's read

export function invariantsReadAnswerCases(m: M): Record<string, SuiteCase> {
  const a = m.invariantsReadAnswer;
  const verdicts = new Map<InvariantName, InvariantVerdict>([
    ['I17', { kind: 'violated', findings: [{ invariant: 'I17', subject: 'timer:1', seq: null, message: 'm' }], unmeasured: [] }],
    ['I2', { kind: 'holds' }],
  ]);
  const last = { at: 5000, mode: 'shadow' as const, verdicts };
  const base = { mode: 'shadow' as const, last, open: measured([row(2)]), resolved: measured([row(1, { resolvedAt: 4000 })]), counts: COUNTS };
  return {
    'before the first pass: no-pass-yet with the mode, never an empty list': () => {
      expect(a({ ...base, last: null })).toEqual({ ok: true, kind: 'no-pass-yet', mode: 'shadow' });
    },
    'after a pass: the mode now, the pass with every invariant in the table\'s order, both lists and the counts': () => {
      const r = a({ ...base, mode: 'live' });
      expect(r.kind).toBe('pass');
      if (r.kind !== 'pass') return;
      expect(r.mode).toBe('live');
      expect(r.lastPass.mode).toBe('shadow');
      expect(r.lastPass.at).toBe(5000);
      expect(r.lastPass.verdicts.map((v) => v.invariant)).toEqual([...INVARIANT_NAMES]);
      expect(r.lastPass.verdicts.find((v) => v.invariant === 'I17')?.verdict).toEqual(verdicts.get('I17'));
      expect(r.lastPass.verdicts.find((v) => v.invariant === 'I2')?.verdict).toEqual({ kind: 'holds' });
      expect(r.findings).toEqual({ open: [row(2)], openCut: false, resolved: [row(1, { resolvedAt: 4000 })], resolvedCut: false });
      expect(r.counts).toEqual(COUNTS.value);
    },
    'an invariant the pass did not answer reads unmeasured, never holds': () => {
      const r = a(base);
      expect(r.kind === 'pass' && r.lastPass.verdicts.find((v) => v.invariant === 'I5')?.verdict)
        .toEqual({ kind: 'unmeasured', why: 'the pass did not answer it' });
    },
    'an unreadable findings list or count is unmeasured, naming it, never an empty list': () => {
      const un = { kind: 'unmeasured', why: 'x' } as const;
      expect(a({ ...base, open: un })).toEqual({ kind: 'unmeasured', why: 'the open findings could not be read: x' });
      expect(a({ ...base, resolved: un })).toEqual({ kind: 'unmeasured', why: 'the resolved findings could not be read: x' });
      expect(a({ ...base, counts: un })).toEqual({ kind: 'unmeasured', why: 'the findings could not be counted: x' });
    },
    'each list is cut at its bound, and says so; a list at the bound is whole': () => {
      const max = m.INVARIANTS_READ_ROWS_MAX;
      const many = Array.from({ length: max + 1 }, (_, i) => row(max + 1 - i));
      const r = a({ ...base, open: measured(many), resolved: measured(many.slice(0, max)) });
      expect(r.kind === 'pass' && [r.findings.open.length, r.findings.openCut, r.findings.resolved.length, r.findings.resolvedCut])
        .toEqual([max, true, max, false]);
      expect(r.kind === 'pass' && r.findings.open[0]?.id).toBe(max + 1);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ the mutant sets

const set = (cases: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<M> =>
  ({ modulePath: MODULE, mutants, suite: cases });

const QUERY_SET = set(readSequenceQueryCases, [
  { id: 'Q1 an unknown key is admitted', old: '  if (other !== undefined) return', new: '  if (false) return' },
  { id: 'Q2 after defaults to 1', old: "q['after'] === undefined ? 0 :", new: "q['after'] === undefined ? 1 :" },
  { id: 'Q3 a leading zero is admitted', old: 'const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;', new: 'const DECIMAL = /^[0-9]{1,16}$/;' },
  { id: 'Q4 an unsafe integer is admitted', old: 'return Number.isSafeInteger(n) ? n : null;', new: 'return n;' },
  { id: 'Q5 a limit of 0 is admitted', old: 'limit < 1 ||', new: 'limit < 0 ||' },
  { id: 'Q6 no page bound', old: ' || limit > SEQUENCE_PAGE_MAX)', new: ')' },
  { id: 'Q7 the limit defaults to 1', old: "q['limit'] === undefined ? SEQUENCE_PAGE_MAX :", new: "q['limit'] === undefined ? 1 :" },
  { id: 'Q8 an array query is admitted', old: "if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return", new: "if (typeof raw !== 'object' || raw === null) return" },
  { id: 'Q9 a repeated key is admitted', old: "if (typeof v !== 'string' || !DECIMAL.test(v)) return null;", new: 'if (!DECIMAL.test(String(v))) return null;' },
]);

const RESTORE_SET = set(restoreGenerationOfCases, [
  { id: 'R1 unmeasured reads zero', old: ": 'unmeasured';\n}", new: ': 0;\n}' },
  { id: 'R2 a negative counter is served', old: ' && r.n >= 0 ?', new: ' ?' },
  { id: 'R3 a non-integer counter is served', old: "r.kind === 'measured' && Number.isSafeInteger(r.n) &&", new: "r.kind === 'measured' &&" },
]);

const ANSWER_SET = set(sequenceDoorAnswerCases, [
  { id: 'S1 an unreadable sequence is an empty page', old: "if (read.kind === 'unmeasured') return { kind: 'refuse', word: 'unavailable', detail: read.why, scope, outcome: 'unmeasured' };",
    new: "if (read.kind === 'unmeasured') return { kind: 'rows', body: { ok: true, kind: 'page', lines: [], next: q.after, head: q.after, restoreGeneration }, scope, count: 0 };" },
  { id: 'S2 a gap is written as ahead', old: "case 'gap': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'gap' };", new: "case 'gap': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'ahead' };" },
  { id: 'S3 a gap is served as rows', old: "case 'gap': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'gap' };", new: "case 'gap': return { kind: 'rows', body: { ok: true, kind: 'page', lines: [], next: q.after, head: page.head, restoreGeneration }, scope, count: 0 };" },
  { id: 'S4 a page counts nothing', old: 'count: page.lines.length', new: 'count: 0' },
  { id: 'S5 the scope loses the cursor', old: 'const scope = `after=${q.after}`;', new: "const scope = 'sequence';" },
  { id: 'S6 the restore generation is dropped', old: 'read.value.lines, restoreGeneration);', new: "read.value.lines, 'unmeasured');" },
  { id: 'S7 ahead is written as gap', old: "case 'ahead': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'ahead' };", new: "case 'ahead': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'gap' };" },
]);

const INVARIANTS_SET = set(invariantsReadAnswerCases, [
  { id: 'V1 a missing verdict reads holds', old: "?? { kind: 'unmeasured' as const, why: 'the pass did not answer it' }", new: "?? { kind: 'holds' as const }" },
  { id: 'V2 a cut is never told', old: 'cut: rows.length > INVARIANTS_READ_ROWS_MAX })', new: 'cut: false })' },
  { id: 'V3 a list at the bound reads cut', old: 'cut: rows.length > INVARIANTS_READ_ROWS_MAX })', new: 'cut: rows.length >= INVARIANTS_READ_ROWS_MAX })' },
  { id: 'V4 nothing is cut', old: 'rows: rows.slice(0, INVARIANTS_READ_ROWS_MAX),', new: 'rows,' },
  { id: 'V5 the mode is the pass\'s', old: "ok: true, kind: 'pass', mode: i.mode,", new: "ok: true, kind: 'pass', mode: last.mode," },
  { id: 'V6 an unreadable count is served as zero', old: "  if (i.counts.kind === 'unmeasured') return { kind: 'unmeasured', why: `the findings could not be counted: ${i.counts.why}` };\n", new: '' },
  { id: 'V7 an unreadable open list is served empty', old: "  if (i.open.kind === 'unmeasured') return { kind: 'unmeasured', why: `the open findings could not be read: ${i.open.why}` };\n", new: '' },
  { id: 'V8 no pass reads a pass', old: "  if (i.last === null) return { ok: true, kind: 'no-pass-yet', mode: i.mode };\n", new: '' },
]);

export const SEQUENCE_DOOR_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#readSequenceQuery`]: QUERY_SET as MutantSet<never>,
  [`${KEY}#restoreGenerationOf`]: RESTORE_SET as MutantSet<never>,
  [`${KEY}#sequenceDoorAnswer`]: ANSWER_SET as MutantSet<never>,
  [`${KEY}#invariantsReadAnswer`]: INVARIANTS_SET as MutantSet<never>,
};
