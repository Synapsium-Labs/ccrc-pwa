// The cases of `mayActW2` (W2's one door into the decider) and of the policy port's one ask, written ONCE here as suite cases
// over a module (Overlord W2, the act catalogue B; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Tasks
// B3 and B4): `overlord-may-act-w2.test.ts` and `overlord-policy.test.ts` run them against the real modules, and
// `mutation-floors.test.ts` against each textual mutant. Every expected value is written out.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import { OVERLORD_ACT_KIND_LIST, type OverlordActKind } from '../../../shared/overlord.js';
import type { ActTarget, MayActAnswer } from '../../src/coord/overlordMayAct.js';
import { mayActW2 as realMayActW2 } from '../../src/coord/overlordMayActW2.js';
import type { OverlordPolicy, PolicyQuestion } from '../../src/coord/overlordPolicy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type W2Module = typeof import('../../src/coord/overlordMayActW2.js');
export type AskModule = typeof import('../../src/coord/overlordPolicyAsk.js');
type Gathered = Parameters<W2Module['mayActW2']>[3];

export const W2_TARGET: ActTarget = { programme: { id: 7, incarnation: 1 }, startedBy: 'operator' };
const SEPARATE = { kind: 'measured', word: 'separate-user', cause: 'other-user' } as const;
export const W2_BASE: Gathered = {
  caller: 'attributed', isolation: SEPARATE, request: { kind: 'none' }, effectCeiling: { pass: true }, cell: 'allow',
  naturalKey: 'key-1', generation: 3,
};
const OPERATOR_REQUEST = { kind: 'bound', id: 11, origin: 'operator', namesTarget: true } as const;
/** What a caller might try to pass through a gathered object, each a fact that would let the decider allow. */
const SMUGGLED = {
  command: { id: 5, live: true, forThisProposal: true, targetsMoved: false },
  statedEntry: { kind: 'cited', id: 9, active: true, stated: true, restsOnOperatorMessage: true, confirmedOrWhole: true, subjectMatches: true },
  answer: { kind: 'answer', evidence: 'enough', askOrAct: 'act', blindCheck: 'clear-yes' },
  grants: [{ id: 21, effect: 'approve-spec', scope: { programme: 7, incarnation: 1 }, state: 'live', expiresAt: 10_000, leastStrength: 'attributed', conditions: [] }],
  grantFacts: { modelClass: 'opus', usesToday: { 21: 0 }, recommendedByCoordinator: true, suspendedNow: [] },
  armedLive: true,
};
const smuggled = (over: Partial<Gathered>): Gathered => ({ ...W2_BASE, ...over, ...SMUGGLED }) as unknown as Gathered;
const said = (a: MayActAnswer): string =>
  (a.kind === 'allowed' ? `${a.allow.word}:${a.allow.mode}:${a.allow.authority.kind}` : a.kind === 'refused' ? a.word : `ceiling:${a.verdict.word}`);

export function mayActW2Cases(m: W2Module): Record<string, SuiteCase> {
  return {
    'a relay carrying a widening an operator request names is allowed, by the request': () => {
      const a = m.mayActW2('relay', 'widen-scope', W2_TARGET, { ...W2_BASE, request: OPERATOR_REQUEST }, 1);
      expect(said(a)).toBe('allow:act:request');
      expect(a.kind === 'allowed' && a.allow.authority).toEqual({ kind: 'request', id: 11 });
    },
    'a command in the gathered object is not seen: a start with no request is operator-only': () => {
      expect(said(m.mayActW2('start-programme', null, W2_TARGET, smuggled({ caller: 'operator' }), 1))).toBe('operator-only');
    },
    'a stated entry in the gathered object is not seen: a fact is operator-only': () => {
      expect(said(m.mayActW2('state-a-fact', null, W2_TARGET, smuggled({ caller: 'operator' }), 1))).toBe('operator-only');
    },
    'answer verdicts in the gathered object are not seen: an answer is unmeasured': () => {
      expect(said(m.mayActW2('answer-item', 'close-request', W2_TARGET, smuggled({}), 1))).toBe('unmeasured');
    },
    'a grant in the gathered object is not seen: a by-grant approval is operator-only': () => {
      expect(said(m.mayActW2('approve-spec', null, W2_TARGET, smuggled({ caller: 'operator', cell: 'by-grant' }), 1))).toBe('operator-only');
    },
    'the arming is unmeasured whatever is gathered: an armed cell refuses unmeasured': () => {
      expect(said(m.mayActW2('read', null, W2_TARGET, smuggled({ cell: 'armed' }), 1))).toBe('unmeasured');
    },
    'what it gathers reaches the decider: the cell, the key, the generation, the target and a refusing ceiling': () => {
      const a = m.mayActW2('rekick-coordinator', null, W2_TARGET, { ...W2_BASE, cell: 'proposal', naturalKey: 'key-9', generation: 12 }, 1);
      expect(a.kind).toBe('allowed');
      if (a.kind !== 'allowed') return;
      expect({ word: a.allow.word, mode: a.allow.mode, cell: a.allow.cell, naturalKey: a.allow.naturalKey, generation: a.allow.generation, target: a.allow.target })
        .toEqual({ word: 'staged', mode: 'proposal', cell: 'proposal', naturalKey: 'key-9', generation: 12, target: { programme: 7, incarnation: 1 } });
      const verdict = { pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'all', limit: 3, latch: 'act-ceiling-hit' } as const;
      const c = m.mayActW2('relay', 'widen-scope', W2_TARGET, { ...W2_BASE, request: OPERATOR_REQUEST, effectCeiling: verdict }, 1);
      expect(c.kind === 'ceiling' && c.verdict).toBe(verdict);
      expect(said(m.mayActW2('relay', 'widen-scope', W2_TARGET, { ...W2_BASE, request: { ...OPERATOR_REQUEST, namesTarget: 'unmeasured' } }, 1))).toBe('unmeasured');
    },
    'on the real rows W2 answers allow and staged (a proposal), operator-only, unmeasured and the ceiling\'s words, never identity-too-weak': () => {
      const seen = new Set<string>();
      const effects: (string | null)[] = [null, ...OVERLORD_ACT_KIND_LIST, 'no-such-kind'];
      for (const act of OVERLORD_ACT_KIND_LIST) for (const effect of effects) for (const cell of ['allow', 'proposal', 'armed', 'by-grant'] as const) {
        for (const request of [{ kind: 'none' } as const, OPERATOR_REQUEST]) for (const caller of ['attributed', 'operator'] as const) {
          seen.add(said(m.mayActW2(act as OverlordActKind, effect, W2_TARGET, { ...W2_BASE, cell, request, caller, effectCeiling: { pass: true } }, 1)));
        }
      }
      expect([...seen].sort()).toEqual(['allow:act:none', 'allow:act:request', 'operator-only', 'staged:proposal:none', 'staged:proposal:request', 'unmeasured']);
    },
  };
}

/** A question over an allow the decider minted, through the real W2 door (the only way to make one). The actor is a fixture
 *  cast: only the identity port mints a recorded actor, and the ask never reads it. */
const question = (): PolicyQuestion => {
  const a = realMayActW2('read', null, W2_TARGET, W2_BASE, 1);
  if (a.kind !== 'allowed') throw new Error('the fixture allow was not minted');
  return { allow: a.allow, verbClass: 'operate',
    actor: { kind: 'session', subject: 'lane-a', issuer: 'attribution', strength: 'attributed' } as unknown as PolicyQuestion['actor'] };
};
const policyOf = (check: OverlordPolicy['check']): OverlordPolicy => ({ check });

export function askPolicyCases(m: AskModule): Record<string, SuiteCase> {
  return {
    'a pass passes': () => { expect(m.askPolicy(policyOf(() => ({ ok: true })), question())).toEqual({ ok: true }); },
    'an adapter\'s refusal is policy-refused, with its reason': () => {
      expect(m.askPolicy(policyOf(() => ({ ok: false, why: 'outside hours' })), question()))
        .toEqual({ ok: false, word: 'policy-refused', cause: 'refused', why: 'outside hours' });
    },
    'a throw is policy-refused, never a pass and never a rethrow (F15)': () => {
      const v = m.askPolicy(policyOf(() => { throw new Error('authoriser down'); }), question());
      expect(v).toEqual({ ok: false, word: 'policy-refused', cause: 'threw', why: 'the policy threw: authoriser down' });
      expect(m.askPolicy(policyOf(() => { throw 'a string'; }), question())).toMatchObject({ ok: false, cause: 'threw', why: 'the policy threw: a string' });
    },
    'an answer that is not a check is policy-refused, malformed': () => {
      for (const bad of [undefined, null, 'ok', { ok: 'true' }, { ok: false }, { ok: false, why: 3 }, { ok: 1 }, []]) {
        expect(m.askPolicy(policyOf(() => bad as never), question()), JSON.stringify(bad)).toEqual({
          ok: false, word: 'policy-refused', cause: 'malformed', why: 'the policy answered something that is not a check',
        });
      }
    },
    'the adapter is asked once, with the question it was given': () => {
      const seen: PolicyQuestion[] = [];
      const q = question();
      m.askPolicy(policyOf((x) => { seen.push(x); return { ok: true }; }), q);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(q);
    },
  };
}

// ------------------------------------------------------------------------------------------------ the strengths' order

export type IdentityModule = typeof import('../../../shared/overlord-identity.js');
export function strengthCases(m: IdentityModule): Record<string, SuiteCase> {
  return {
    'the rank is each strength\'s place in CALLER_STRENGTHS, weakest first': () => {
      expect(m.CALLER_STRENGTHS).toEqual(['attributed', 'workload', 'operator']);
      expect(m.CALLER_STRENGTH_RANK).toEqual({ attributed: 0, workload: 1, operator: 2 });
    },
    'strengthAtLeast over the nine pairs': () => {
      const yes = ['attributed>=attributed', 'workload>=attributed', 'workload>=workload', 'operator>=attributed', 'operator>=workload', 'operator>=operator'];
      for (const have of m.CALLER_STRENGTHS) for (const need of m.CALLER_STRENGTHS) {
        expect(m.strengthAtLeast(have, need), `${have} >= ${need}`).toBe(yes.includes(`${have}>=${need}`));
      }
    },
  };
}

// --------------------------------------------------------------------------------------------------------- mutant sets

const W2_TS = path.join(ROOT, 'server/src/coord/overlordMayActW2.ts');
const ASK_TS = path.join(ROOT, 'server/src/coord/overlordPolicyAsk.ts');
const IDENTITY_TS = path.join(ROOT, 'shared/overlord-identity.ts');
const passed = (field: string, fallback: string): string => `${field}: (g as unknown as Record<string, never>).${field} ?? ${fallback},`;

/** The W2 wrapper's mutants. Three are left out as equivalent in W2, measured: the grant facts (read only beside a grant, and
 *  none is passed), the caller and the isolation (on the real rows only a grant or a command path reads them past step 4,
 *  and every row a door performs needs `attributed`, the weakest). */
export const MAY_ACT_W2_SET: MutantSet<W2Module> = {
  modulePath: W2_TS, suite: mayActW2Cases,
  mutants: [
    { id: 'W1 a grant passed through', old: 'return overlordMayAct(act, effect, target, [], {', new: 'return overlordMayAct(act, effect, target, (g as unknown as { grants?: never[] }).grants ?? [], {' },
    { id: 'W2 a command passed through', old: 'command: null,', new: passed('command', 'null') },
    { id: 'W3 a stated entry passed through', old: 'statedEntry: NO_ENTRY,', new: passed('statedEntry', 'NO_ENTRY') },
    { id: 'W4 answer verdicts passed through', old: 'answer: NOT_AN_ANSWER,', new: passed('answer', 'NOT_AN_ANSWER') },
    { id: 'W5 the arming read as live', old: "armedLive: 'unmeasured',", new: 'armedLive: true,' },
    { id: 'W6 the request dropped', old: 'request: g.request,', new: "request: { kind: 'none' }," },
    { id: 'W7 the cell fixed at allow', old: 'cell: g.cell,', new: "cell: 'allow'," },
    { id: 'W8 the effect ceiling dropped', old: 'effectCeiling: g.effectCeiling,', new: 'effectCeiling: { pass: true },' },
    { id: 'W9 the natural key dropped', old: 'naturalKey: g.naturalKey,', new: "naturalKey: ''," },
    { id: 'W10 the generation dropped', old: 'generation: g.generation,', new: 'generation: 0,' },
  ],
};

export const ASK_POLICY_SET: MutantSet<AskModule> = {
  modulePath: ASK_TS, suite: askPolicyCases,
  mutants: [
    { id: 'P1 a throw rethrown', old: "    return { ok: false, word: 'policy-refused', cause: 'threw', why: `the policy threw: ${whyOf(e)}` };", new: '    throw e;' },
    { id: 'P2 a throw passes', old: "    return { ok: false, word: 'policy-refused', cause: 'threw', why: `the policy threw: ${whyOf(e)}` };", new: '    return { ok: true };' },
    { id: 'P3 a malformed answer passes', old: "  return { ok: false, word: 'policy-refused', cause: 'malformed', why: 'the policy answered something that is not a check' };", new: '  return { ok: true };' },
    { id: 'P4 the reason dropped', old: "cause: 'refused', why: a.why };", new: "cause: 'refused', why: '' };" },
    { id: 'P5 a truthy ok passes', old: 'if (a.ok === true) return { ok: true };', new: 'if (a.ok) return { ok: true };' },
    { id: 'P6 a refusal with no reason read as one', old: "if (a.ok === false && typeof a.why === 'string')", new: 'if (a.ok === false)' },
    { id: 'P7 a refusal named a throw', old: "cause: 'refused', why: a.why", new: "cause: 'threw', why: a.why" },
    { id: 'P8 the adapter asked twice', old: '    answer = p.check(q);', new: '    answer = (p.check(q), p.check(q));' },
  ],
};

export const STRENGTH_SET: MutantSet<IdentityModule> = {
  modulePath: IDENTITY_TS, suite: strengthCases,
  mutants: [
    { id: 'S1 > for >=', old: 'return CALLER_STRENGTH_RANK[have] >= CALLER_STRENGTH_RANK[need];', new: 'return CALLER_STRENGTH_RANK[have] > CALLER_STRENGTH_RANK[need];' },
    { id: 'S2 the comparison reversed', old: 'return CALLER_STRENGTH_RANK[have] >= CALLER_STRENGTH_RANK[need];', new: 'return CALLER_STRENGTH_RANK[need] >= CALLER_STRENGTH_RANK[have];' },
    { id: 'S3 the order reversed', old: 'CALLER_STRENGTHS.map((s, i) => [s, i])', new: 'CALLER_STRENGTHS.map((s, i) => [s, CALLER_STRENGTHS.length - i])' },
    { id: 'S4 every strength equal', old: 'CALLER_STRENGTHS.map((s, i) => [s, i])', new: 'CALLER_STRENGTHS.map((s) => [s, 0])' },
  ],
};
