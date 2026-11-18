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
const EDGE_VERDICT_TS = path.join(ROOT, 'server/src/coord/edgeVerdict.ts');

export type RemainingDeciders = typeof import('../../src/coord/programmeRemaining.js');
export type EdgeVerdictDecider = typeof import('../../src/coord/edgeVerdict.js');

export const REMAINING_BODY_KEY = 'server/src/coord/programmeRemaining.ts#remainingBodyOf';
export const EDGE_TARGET_KEY = 'server/src/coord/programmeRemaining.ts#edgeTargetVerdict';
export const EDGE_VERDICT_KEY = 'server/src/coord/edgeVerdict.ts#edgeVerdict';

export const NOW = 1_790_000_000_000;
/** The bounds, written out: `shared/programmeFacts.ts`' constants, so a mutant of a bound cannot move the expectation. */
export const WAVES_MAX = 99;
export const REASON_MAX = 300;
export const WHY_MAX = 200;
export const EDGES_MAX = 10;
/** Remaining work B's bounds, written out: `EDGE_EVIDENCE_MAX` and `EDGE_UNMEASURABLE_AFTER_MS`. */
export const EVIDENCE_MAX = 300;
export const UNMEASURABLE_AFTER_MS = 7 * 86_400_000;

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
  const run = (program: string) => ({ program });
  return {
    'run-closed: a run of another programme is ok; of this one, or none, is refused': () => {
      const t = { predicate: 'run-closed', runId: 41 } as const;
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'run-closed', run: run('prog-b') }))).toBe('ok');
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'run-closed', run: run('prog-a') }))).toMatch(/is a run of programme prog-a/);
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'run-closed', run: null }))).toMatch(/run 41 does not exist/);
    },
    'pr-merged: any pull request on a run that exists, of any programme (review 2381 N1)': () => {
      const t = { predicate: 'pr-merged', runId: 41, pr: 7 } as const;
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: run('prog-b') }))).toBe('ok');
      expect(word(m.edgeTargetVerdict('prog-a', t, { predicate: 'pr-merged', run: run('prog-a') }))).toBe('ok');
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

// ── Remaining work B: an edge's verdict (Task 4) ─────────────────────────────────────────────────────────────────────

type Answer = NonNullable<Parameters<EdgeVerdictDecider['edgeVerdict']>[1]>;
type VEdge = Parameters<EdgeVerdictDecider['edgeVerdict']>[0];
export const OPEN_EDGE: VEdge = { state: 'open', unmeasuredSince: null };
export const A_PASSED: Answer = { kind: 'passed', evidence: 'pr-7' };
export const A_ENDED: Answer = { kind: 'ended', evidence: 'pr-7-not-merged' };
export const A_PENDING: Answer = { kind: 'pending', evidence: 'run-41-working' };
export const A_UNMEASURED: Answer = { kind: 'unmeasured', why: 'Error' };
export const A_UNMEASURABLE: Answer = { kind: 'unmeasurable', why: 'lineage-unattributed' };
export const ANSWERS: readonly Answer[] = [A_PASSED, A_ENDED, A_PENDING, A_UNMEASURED, A_UNMEASURABLE];

/** The verdict word and what the writer is handed, as one comparable value. */
export const settleOf = (v: ReturnType<EdgeVerdictDecider['edgeVerdict']>): unknown => (v.verdict === 'none' ? 'none' : [v.verdict, v.settle]);

export function edgeVerdictCases(m: Pick<EdgeVerdictDecider, 'edgeVerdict'>): Record<string, SuiteCase> {
  const v = (e: VEdge, a: Answer | null, now = NOW) => settleOf(m.edgeVerdict(e, a, now));
  return {
    'row 1: an edge that is not open, or whose state is unreadable, is none for every answer': () => {
      for (const state of ['met', 'target-ended', 'target-unmeasurable'] as const) {
        for (const a of ANSWERS) expect(v({ state, unmeasuredSince: null }, a)).toBe('none');
      }
      for (const a of ANSWERS) {
        expect(v({ state: 'open', stateUnreadable: true, unmeasuredSince: null }, a)).toBe('none');
        expect(v({ state: 'open', stateUnreadable: true, unmeasuredSince: NOW - UNMEASURABLE_AFTER_MS }, a)).toBe('none');
      }
    },
    'row 1: an open edge whose kind or target this build cannot read, or whose target was not asked, is none': () => {
      for (const a of ANSWERS) {
        expect(v({ state: 'open', kindUnreadable: true, unmeasuredSince: null }, a)).toBe('none');
        expect(v({ state: 'open', targetUnreadable: true, unmeasuredSince: NOW - UNMEASURABLE_AFTER_MS }, a)).toBe('none');
      }
      expect(v(OPEN_EDGE, null)).toBe('none');
      expect(v({ state: 'open', unmeasuredSince: NOW - UNMEASURABLE_AFTER_MS }, null)).toBe('none');
    },
    'row 2: unmeasured for exactly seven days ends the block as target-unmeasurable, naming the first time': () => {
      const since = NOW - UNMEASURABLE_AFTER_MS;
      expect(v({ state: 'open', unmeasuredSince: since }, A_UNMEASURED)).toEqual(
        ['unmeasurable', { kind: 'end', state: 'target-unmeasurable', evidence: `unmeasured since ${since}: Error` }]);
      expect(v({ state: 'open', unmeasuredSince: since - 1 }, A_UNMEASURED)).toEqual(
        ['unmeasurable', { kind: 'end', state: 'target-unmeasurable', evidence: `unmeasured since ${since - 1}: Error` }]);
    },
    'row 3: unmeasured one millisecond short of seven days keeps the edge open and its first time': () => {
      const since = NOW - UNMEASURABLE_AFTER_MS + 1;
      expect(v({ state: 'open', unmeasuredSince: since }, A_UNMEASURED)).toEqual(['unmeasured', { kind: 'clock', unmeasuredSince: since }]);
    },
    'row 3: the first unmeasured answer starts the clock at now': () => {
      expect(v(OPEN_EDGE, A_UNMEASURED)).toEqual(['unmeasured', { kind: 'clock', unmeasuredSince: NOW }]);
    },
    'row 4: an unmeasurable answer ends the block at once, whatever the clock (review 2381 N1)': () => {
      for (const since of [null, NOW, NOW - UNMEASURABLE_AFTER_MS]) {
        expect(v({ state: 'open', unmeasuredSince: since }, A_UNMEASURABLE)).toEqual(
          ['unmeasurable', { kind: 'end', state: 'target-unmeasurable', evidence: 'unmeasurable: lineage-unattributed' }]);
      }
    },
    'row 5: a passed target is met, with the reader\'s evidence': () => {
      expect(v(OPEN_EDGE, A_PASSED)).toEqual(['met', { kind: 'end', state: 'met', evidence: 'pr-7' }]);
      expect(v({ state: 'open', unmeasuredSince: NOW - UNMEASURABLE_AFTER_MS }, A_PASSED)).toEqual(['met', { kind: 'end', state: 'met', evidence: 'pr-7' }]);
    },
    'row 6: an ended target is target-ended, with the reader\'s evidence': () => {
      expect(v(OPEN_EDGE, A_ENDED)).toEqual(['ended', { kind: 'end', state: 'target-ended', evidence: 'pr-7-not-merged' }]);
    },
    'row 7: a pending target keeps the edge open and clears its clock': () => {
      expect(v({ state: 'open', unmeasuredSince: NOW - 5 }, A_PENDING)).toEqual(['pending', { kind: 'clock', unmeasuredSince: null }]);
      expect(v({ state: 'open', unmeasuredSince: NOW - UNMEASURABLE_AFTER_MS }, A_PENDING)).toEqual(['pending', { kind: 'clock', unmeasuredSince: null }]);
      expect(v(OPEN_EDGE, A_PENDING)).toEqual(['pending', { kind: 'clock', unmeasuredSince: null }]);
    },
    'evidence over the bound comes back cut whole, and a key in it masked': () => {
      const secret = 'sk-' + 'Zq9'.repeat(10);
      const long = `${'word '.repeat(70)}${secret}`;
      const r = m.edgeVerdict(OPEN_EDGE, { kind: 'passed', evidence: long }, NOW);
      if (r.verdict === 'none' || r.settle.kind !== 'end') throw new Error('not an end');
      expect(r.settle.evidence.length).toBeLessThanOrEqual(EVIDENCE_MAX);
      expect(r.settle.evidence.endsWith('word')).toBe(true);
      const short = m.edgeVerdict(OPEN_EDGE, { kind: 'ended', evidence: `closed ${secret}` }, NOW);
      if (short.verdict === 'none' || short.settle.kind !== 'end') throw new Error('not an end');
      for (let i = 0; i + 8 <= secret.length; i++) expect(short.settle.evidence.includes(secret.slice(i, i + 8))).toBe(false);
      expect(short.settle.evidence.startsWith('closed')).toBe(true);
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
    { id: 'ET-4 a pull request on this programme\'s run refused', old: "if (target.predicate === 'run-closed') {", new: "if (target.predicate === 'run-closed' || run.program === slug) {" },
    { id: 'ET-5 a missing run accepted', old: 'if (run === null) return refuse(`run ${target.runId} does not exist`);', new: 'if (run === null) return { ok: true };' },
    { id: 'ET-6 a missing item accepted', old: 'if (item === null) return refuse(`item ${target.itemId} does not exist`);', new: 'if (item === null) return { ok: true };' },
  ],
};

const EDGE_VERDICT_SET: MutantSet<EdgeVerdictDecider> = {
  modulePath: EDGE_VERDICT_TS,
  suite: (mod) => edgeVerdictCases(mod),
  mutants: [
    { id: 'EV-1 unmeasured read as met', old: "if (answer.kind === 'unmeasured') {", new: "if (answer.kind === 'unmeasured') { return end('met', 'met', answer.why);" },
    { id: 'EV-2 not-open guard skipped', old: "if (edge.state !== 'open' || edge.stateUnreadable", new: "if (false || edge.stateUnreadable" },
    { id: 'EV-3 met and ended swapped', old: "if (answer.kind === 'passed') return end('met', 'met', answer.evidence);", new: "if (answer.kind === 'passed') return end('ended', 'target-ended', answer.evidence);" },
    { id: 'EV-4 row 2 age check dropped', old: 'since !== null && now - since >= EDGE_UNMEASURABLE_AFTER_MS', new: 'since !== null' },
    { id: 'EV-5 pending keeps the clock', old: "return { verdict: 'pending', settle: { kind: 'clock', unmeasuredSince: null } };", new: "return { verdict: 'pending', settle: { kind: 'clock', unmeasuredSince: edge.unmeasuredSince } };" },
    { id: 'EV-6 unreadable state settled', old: " || edge.stateUnreadable === true || edge.kindUnreadable", new: " || edge.kindUnreadable" },
    { id: 'EV-12 unreadable kind settled', old: " || edge.kindUnreadable === true || edge.targetUnreadable", new: " || edge.targetUnreadable" },
    { id: 'EV-13 unreadable target settled', old: " || edge.targetUnreadable === true\n    || answer === null)", new: "\n    || answer === null)" },
    { id: 'EV-7 seven days by more than, not at least', old: 'now - since >= EDGE_UNMEASURABLE_AFTER_MS', new: 'now - since > EDGE_UNMEASURABLE_AFTER_MS' },
    { id: 'EV-8 unmeasurable read as transient', old: "if (answer.kind === 'unmeasurable') return end(", new: "if (answer.kind === 'unmeasurable') return { verdict: 'unmeasured', settle: { kind: 'clock', unmeasuredSince: edge.unmeasuredSince ?? now } }; if (false) return end(" },
    { id: 'EV-9 clock restarted on every unmeasured answer', old: 'unmeasuredSince: since ?? now', new: 'unmeasuredSince: now' },
    { id: 'EV-10 evidence not masked', old: 'cutWhole(redactCommand(text), EDGE_EVIDENCE_MAX)', new: 'cutWhole(text, EDGE_EVIDENCE_MAX)' },
    { id: 'EV-11 evidence not cut', old: 'cutWhole(redactCommand(text), EDGE_EVIDENCE_MAX)', new: 'redactCommand(text)' },
  ],
};

export const PROGRAMME_FACTS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [REMAINING_BODY_KEY]: REMAINING_BODY_SET as MutantSet<never>,
  [EDGE_TARGET_KEY]: EDGE_TARGET_SET as MutantSet<never>,
  [EDGE_VERDICT_KEY]: EDGE_VERDICT_SET as MutantSet<never>,
};
