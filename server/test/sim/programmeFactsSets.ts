// Overlord W2 remaining work A (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md, Task 1): the cases
// over `remainingBodyOf` and `edgeTargetVerdict`, written once here as suite cases over a module. `programme-remaining.test.ts`
// runs them against the real module, and `mutation-floors.test.ts` runs them against each named mutant. The expected words
// and bounds are written out, never read from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DECIDER_TS = path.join(ROOT, 'server/src/coord/programmeRemaining.ts');

export type RemainingDeciders = typeof import('../../src/coord/programmeRemaining.js');

export const REMAINING_BODY_KEY = 'server/src/coord/programmeRemaining.ts#remainingBodyOf';
export const EDGE_TARGET_KEY = 'server/src/coord/programmeRemaining.ts#edgeTargetVerdict';

export const NOW = 1_790_000_000_000;
/** The bounds, written out: `shared/programmeFacts.ts`' constants, so a mutant of a bound cannot move the expectation. */
export const WAVES_MAX = 99;
export const REASON_MAX = 300;
export const WHY_MAX = 200;
export const EDGES_MAX = 10;

export const LANDED = { kind: 'needs-landed', target: { predicate: 'run-closed', runId: 41 }, why: 'prog-b lands the schema first' };
export const MERGED = { kind: 'needs-landed', target: { predicate: 'pr-merged', runId: 41, pr: 7 }, why: 'the store PR merges first' };
export const DECIDE = { kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId: 9 }, why: 'the operator picks the name' };
/** A body row 10 accepts, with every optional field present. */
export const GOOD = { lo: 2, hi: 3, reason: 'wave 4 of the plan, and its review', runId: 123, edges: [LANDED, MERGED, DECIDE] };

type Body = ReturnType<RemainingDeciders['remainingBodyOf']>;
/** The refusal's detail, or `accepted`. */
const detailOf = (b: Body): string => (b.ok ? 'accepted' : b.detail);

export function remainingBodyCases(m: Pick<RemainingDeciders, 'remainingBodyOf'>): Record<string, SuiteCase> {
  const of = (raw: unknown): Body => m.remainingBodyOf(raw, NOW);
  const d = (raw: unknown): string => detailOf(of(raw));
  const ok = (raw: unknown) => {
    const b = of(raw);
    if (!b.ok) throw new Error(`refused: ${b.detail}`);
    return b;
  };
  const edges = (n: number) => Array.from({ length: n }, (_, i) => ({ ...LANDED, target: { predicate: 'run-closed', runId: i + 1 } }));
  return {
    'row 10: a good body is accepted whole': () => {
      const b = ok(GOOD);
      expect(b.statement).toEqual({ lo: 2, hi: 3, reason: 'wave 4 of the plan, and its review', runId: 123 });
      expect(b.edges).toEqual([LANDED, MERGED, DECIDE]);
    },
    'row 10: runId and edges are optional': () => {
      const b = ok({ lo: 0, hi: 0, reason: 'done' });
      expect(b.statement.runId).toBeNull();
      expect(b.edges).toEqual([]);
    },
    'row 1: not a JSON object': () => {
      for (const raw of [null, 3, 'x', [], [GOOD]]) expect(d(raw)).toMatch(/^the body must be a JSON object/);
    },
    'row 2: lo or hi not a whole number of waves in 0 to 99, naming the field': () => {
      for (const v of [undefined, -1, 1.5, '2', null, WAVES_MAX + 1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(d({ ...GOOD, lo: v })).toMatch(/^lo must/);
        expect(d({ ...GOOD, hi: v })).toMatch(/^hi must/);
      }
      expect(d({ ...GOOD, lo: 'x', hi: 'y' })).toMatch(/^lo must/);
    },
    'row 2: the wave bounds are inclusive': () => {
      ok({ ...GOOD, lo: 0, hi: 0 });
      ok({ ...GOOD, lo: WAVES_MAX, hi: WAVES_MAX });
      expect(d({ ...GOOD, lo: 0, hi: WAVES_MAX + 1 })).toMatch(/^hi must/);
    },
    'row 3: lo above hi': () => {
      expect(d({ ...GOOD, lo: 4, hi: 3 })).toBe('lo must not exceed hi');
      ok({ ...GOOD, lo: 3, hi: 3 });
    },
    'row 4: reason not one line of 1 to 300 characters': () => {
      for (const v of [undefined, '', '   ', 5, null, 'a\nb', 'a\rb', 'x'.repeat(REASON_MAX + 1)]) {
        expect(d({ ...GOOD, reason: v })).toMatch(/^reason must be one line/);
      }
      expect(ok({ ...GOOD, reason: 'x'.repeat(REASON_MAX) }).statement.reason).toBe('x'.repeat(REASON_MAX));
    },
    'row 4: a reason holding a key comes back masked': () => {
      const secret = 'sk-' + 'Zq9'.repeat(10);
      const reason = ok({ ...GOOD, reason: `waits on ${secret} rotating` }).statement.reason;
      for (let i = 0; i + 8 <= secret.length; i++) expect(reason.includes(secret.slice(i, i + 8))).toBe(false);
      expect(reason.length).toBeGreaterThan(0);
    },
    'row 5: runId present and not a positive integer': () => {
      for (const v of [0, -3, 1.5, '7', null, true]) expect(d({ ...GOOD, runId: v })).toMatch(/^runId must/);
    },
    'row 6: edges not a list of at most ten': () => {
      for (const v of ['x', null, {}, 3]) expect(d({ ...GOOD, edges: v })).toMatch(/^edges must/);
      expect(ok({ ...GOOD, edges: edges(EDGES_MAX) }).edges).toHaveLength(EDGES_MAX);
      expect(d({ ...GOOD, edges: edges(EDGES_MAX + 1) })).toMatch(/^edges must/);
    },
    'row 7: an edge that is not an object, or of an unknown kind': () => {
      expect(d({ ...GOOD, edges: ['x'] })).toMatch(/^edge 0 must be a JSON object/);
      expect(d({ ...GOOD, edges: [LANDED, { ...LANDED, kind: 'needs-x' }] })).toMatch(/^edge 1: kind/);
      expect(d({ ...GOOD, edges: [{ ...LANDED, kind: undefined }] })).toMatch(/^edge 0: kind/);
    },
    'row 7: a target that is none of the three shapes': () => {
      for (const t of [undefined, null, 'run-closed', { predicate: 'review-passed', runId: 1 }, { runId: 1 },
        { predicate: 'run-closed', runId: 1, pr: 2 }, { predicate: 'pr-merged', runId: 1 }, { predicate: 'operator-confirms', runId: 1 }]) {
        expect(d({ ...GOOD, edges: [{ ...LANDED, target: t }] })).toMatch(/^edge 0: target must be one of the shapes/);
      }
    },
    'row 7: a kind that is not the kind its target takes': () => {
      expect(d({ ...GOOD, edges: [{ ...LANDED, kind: 'needs-decision' }] })).toMatch(/^edge 0: a run-closed target is a needs-landed edge/);
      expect(d({ ...GOOD, edges: [{ ...MERGED, kind: 'needs-decision' }] })).toMatch(/^edge 0: a pr-merged target is a needs-landed edge/);
      expect(d({ ...GOOD, edges: [{ ...DECIDE, kind: 'needs-landed' }] })).toMatch(/^edge 0: a operator-confirms target is a needs-decision edge/);
    },
    'row 7: a why that is not one line of 1 to 200 characters': () => {
      for (const v of [undefined, '', 'a\nb', 4, 'w'.repeat(WHY_MAX + 1)]) {
        expect(d({ ...GOOD, edges: [{ ...LANDED, why: v }] })).toMatch(/^edge 0: why must be one line/);
      }
      expect(ok({ ...GOOD, edges: [{ ...LANDED, why: 'w'.repeat(WHY_MAX) }] }).edges[0]!.why).toBe('w'.repeat(WHY_MAX));
    },
    'row 8: a target id that is not a positive integer, naming it': () => {
      expect(d({ ...GOOD, edges: [{ ...LANDED, target: { predicate: 'run-closed', runId: 0 } }] })).toMatch(/^edge 0: target runId must be a positive integer/);
      expect(d({ ...GOOD, edges: [{ ...MERGED, target: { predicate: 'pr-merged', runId: 4, pr: '7' } }] })).toMatch(/^edge 0: target pr must/);
      expect(d({ ...GOOD, edges: [{ ...DECIDE, target: { predicate: 'operator-confirms', itemId: 1.5 } }] })).toMatch(/^edge 0: target itemId must/);
    },
    'row 7 over every edge wins over row 8 on an earlier edge': () => {
      const bad8 = { ...LANDED, target: { predicate: 'run-closed', runId: -1 } };
      expect(d({ ...GOOD, edges: [bad8, { ...LANDED, kind: 'needs-x' }] })).toMatch(/^edge 1: kind/);
    },
    'row 9: two edges with the same kind and target, whatever their key order': () => {
      expect(d({ ...GOOD, edges: [LANDED, { ...LANDED, why: 'said twice' }] })).toMatch(/^edge 1: duplicate edge/);
      const swapped = { ...MERGED, target: { pr: 7, predicate: 'pr-merged', runId: 41 } };
      expect(d({ ...GOOD, edges: [MERGED, swapped] })).toMatch(/^edge 1: duplicate edge/);
      ok({ ...GOOD, edges: [MERGED, { ...MERGED, target: { predicate: 'pr-merged', runId: 41, pr: 8 } }] });
    },
    'row 10: a why holding a key comes back masked, and the target in its canonical key order': () => {
      const secret = 'sk-' + 'Zq9'.repeat(10);
      const b = ok({ ...GOOD, edges: [{ ...MERGED, why: `key ${secret}`, target: { pr: 7, runId: 41, predicate: 'pr-merged' } }] });
      for (let i = 0; i + 8 <= secret.length; i++) expect(b.edges[0]!.why.includes(secret.slice(i, i + 8))).toBe(false);
      expect(Object.keys(b.edges[0]!.target)).toEqual(['predicate', 'runId', 'pr']);
    },
  };
}

type Verdict = ReturnType<RemainingDeciders['edgeTargetVerdict']>;
const word = (v: Verdict): string => (v.ok ? 'ok' : v.detail);

export function edgeTargetCases(m: Pick<RemainingDeciders, 'edgeTargetVerdict'>): Record<string, SuiteCase> {
  const run = (program: string, prs: number[] = []) => ({ program, prs });
  return {
    'run-closed: a run of another programme is ok; of this one, or none, is refused': () => {
      const t = { predicate: 'run-closed', runId: 41 } as const;
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'run-closed', run: run('prog-b') }))).toBe('ok');
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'run-closed', run: run('prog-a') }))).toMatch(/is a run of programme prog-a/);
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'run-closed', run: null }))).toMatch(/run 41 does not exist/);
    },
    'pr-merged: only a pull request the run\'s lineage lists': () => {
      const t = { predicate: 'pr-merged', runId: 41, pr: 7 } as const;
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: run('prog-b', [6, 7]) }))).toBe('ok');
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: run('prog-a', [7]) }))).toBe('ok');
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: run('prog-b', [6]) }))).toMatch(/does not list pull request 7/);
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: run('prog-b') }))).toMatch(/does not list pull request 7/);
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: null }))).toMatch(/run 41 does not exist/);
    },
    'operator-confirms: only a waiting item of this programme': () => {
      const t = { predicate: 'operator-confirms', itemId: 9 } as const;
      const item = (program: string, state: string) => ({ predicate: 'operator-confirms', item: { program, state } }) as const;
      for (const s of ['open', 'checking']) expect(word(m.edgeTargetVerdict('prog-a', t, item('prog-a', s)))).toBe('ok');
      expect(word(m.edgeTargetVerdict('prog-a', t, item('prog-b', 'open')))).toMatch(/not an item of programme prog-a/);
      for (const s of ['done', 'withdrawn', 'dismissed', 'paused']) {
        expect(word(m.edgeTargetVerdict('prog-a', t, item('prog-a', s)))).toMatch(/no longer open/);
      }
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'operator-confirms', item: null }))).toMatch(/item 9 does not exist/);
    },
  };
}

const REMAINING_BODY_SET: MutantSet<RemainingDeciders> = {
  modulePath: DECIDER_TS,
  suite: (mod) => remainingBodyCases(mod),
  mutants: [
    { id: 'RW-1 lo above hi accepted', old: "if (lo > hi) return refuse('lo must not exceed hi');", new: '' },
    { id: 'RW-2 wave bound raised by one', old: 'v >= 0 && v <= REMAINING_WAVES_MAX;', new: 'v >= 0 && v <= REMAINING_WAVES_MAX + 1;' },
    { id: 'RW-3 duplicate check skipped', old: 'if (seen.has(key)) return', new: 'if (false) return' },
    { id: 'RW-4 kind-of-predicate check skipped', old: 'if (EDGE_KIND_OF_PREDICATE[predicate] !== e.kind) {', new: 'if (false) {' },
    { id: 'RW-5 multi-line reason accepted', old: 'callText(raw.reason, REMAINING_REASON_MAX, true)', new: 'callText(raw.reason, REMAINING_REASON_MAX, false)' },
    { id: 'RW-6 a zero id accepted', old: 'Number.isSafeInteger(v) && v > 0;', new: 'Number.isSafeInteger(v) && v >= 0;' },
    { id: 'RW-7 eleven edges accepted', old: 'list.length > EDGES_PER_STATEMENT_MAX', new: 'list.length > EDGES_PER_STATEMENT_MAX + 1' },
    { id: 'RW-8 extra target keys accepted', old: 'keys.length === TARGET_KEYS[p].length && ', new: '' },
    { id: 'RW-9 multi-line why accepted', old: 'callText(e.why, EDGE_WHY_MAX, true)', new: 'callText(e.why, EDGE_WHY_MAX, false)' },
    { id: 'RW-10 a negative wave accepted', old: 'v >= 0 && v <= REMAINING_WAVES_MAX;', new: 'v >= -1 && v <= REMAINING_WAVES_MAX;' },
  ],
};

const EDGE_TARGET_SET: MutantSet<RemainingDeciders> = {
  modulePath: DECIDER_TS,
  suite: (mod) => edgeTargetCases(mod),
  mutants: [
    { id: 'ET-1 another programme\'s item accepted', old: 'if (item.program !== slug) return', new: 'if (false) return' },
    { id: 'ET-2 a closed item accepted', old: 'if (!(OPEN_ITEM_STATES as readonly string[]).includes(item.state)) return', new: 'if (false) return' },
    { id: 'ET-3 own run accepted for run-closed', old: 'return run.program === slug ? refuse(', new: 'return false ? refuse(' },
    { id: 'ET-4 any pull request accepted', old: 'return run.prs.includes(target.pr) ?', new: 'return true ?' },
    { id: 'ET-5 a missing run accepted', old: 'if (run === null) return refuse(`run ${target.runId} does not exist`);', new: 'if (run === null) return { ok: true };' },
    { id: 'ET-6 a missing item accepted', old: 'if (item === null) return refuse(`item ${target.itemId} does not exist`);', new: 'if (item === null) return { ok: true };' },
  ],
};

export const PROGRAMME_FACTS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [REMAINING_BODY_KEY]: REMAINING_BODY_SET as MutantSet<never>,
  [EDGE_TARGET_KEY]: EDGE_TARGET_SET as MutantSet<never>,
};
