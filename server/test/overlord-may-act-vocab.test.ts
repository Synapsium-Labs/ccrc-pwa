// The decider's vocabulary (Overlord W2, the act catalogue B; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`
// Task B1): the answer words, the authority words and the modes, each list from its map; the strengths' order, derived from the
// identity file's one list; and `policy-refused` (plan question 7) in the Overlord's refusal group at 403. Every expected value
// is written out here, never read from the map it judges.
import { describe, expect, it } from 'vitest';
import {
  ACT_AUTHORITY_KINDS, ALLOW_MODES, MAY_ACT_ALLOW_WORDS, MAY_ACT_WORDS,
} from '../../shared/overlord.js';
import * as identity from '../../shared/overlord-identity.js';
import { OVERLORD_REFUSALS, REFUSAL_STATUS } from '../../shared/refusal.js';
import { strengthCases } from './sim/mayActW2Sets.js';

describe('the answer words, the authorities and the modes', () => {
  it('the plan\'s nine answers and unmeasured, the coordinator\'s item 5, in their order', () => {
    expect(MAY_ACT_WORDS).toEqual(['allow', 'allow-by-grant', 'staged', 'defer', 'ask-is-cheaper', 'evidence-too-weak',
      'identity-too-weak', 'server-not-isolated', 'operator-only', 'unmeasured']);
  });
  it('only allow, allow-by-grant and staged mint an allow', () => {
    expect(MAY_ACT_ALLOW_WORDS).toEqual(['allow', 'allow-by-grant', 'staged']);
  });
  it('five authorities and four modes', () => {
    expect(ACT_AUTHORITY_KINDS).toEqual(['none', 'command', 'request', 'entry', 'grant']);
    expect(ALLOW_MODES).toEqual(['act', 'proposal', 'live', 'shadow']);
  });
});

describe('the strengths\' order (its cases live once in sim/mayActW2Sets.ts, run against each mutant too)', () => {
  for (const [name, run] of Object.entries(strengthCases(identity))) it(name, run);
});

describe('policy-refused (plan question 7)', () => {
  it('is in the Overlord\'s group and the route table at 403', () => {
    expect((OVERLORD_REFUSALS as Readonly<Record<string, number>>)['policy-refused']).toBe(403);
    expect((REFUSAL_STATUS as Readonly<Record<string, number>>)['policy-refused']).toBe(403);
  });
});
