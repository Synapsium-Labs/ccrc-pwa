// The serviceability clause's Overlord arms: oracles and mutant sets (the serviceability plan,
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`, Task 2, Step 5). Each decider's cases are written
// ONCE here, as suite cases over a module: `serviceability.test.ts` runs them against the real module and
// `mutation-floors.test.ts` against each named mutant (D-8217's every-run floors). The expected words are written out,
// not read from the code the cases judge. The bash twin is held by `ccd-serviceable.test.ts` over the shared row table.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { LaneFacts } from '../../../shared/serviceability.js';
import type { SessionPoolSide } from '../../../shared/poolrule.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVICEABILITY_MODULE = path.join(ROOT, 'shared/serviceability.ts');
const ROSTER_FACTS_MODULE = path.join(ROOT, 'shared/rosterFacts.ts');

export type ServiceabilityModule = typeof import('../../../shared/serviceability.js');
export type RosterFactsModule = typeof import('../../../shared/rosterFacts.js');

const NOW = 1_800_000_000;
const lane = (o: Partial<LaneFacts> = {}): LaneFacts => ({
  anthropic: true, seven: 20, share: { estimatePct: 10, finishedAtS: NOW - 60 },
  fableBilling: 'included', continuity: 'recorded', ...o,
});
const SHARE_STALE_S = 28_801;
const unservable = (why: string) => ({ kind: 'unservable', why });

// ---------- serviceability ----------

export function serviceabilityCases(m: Pick<ServiceabilityModule, 'serviceability'>): Record<string, SuiteCase> {
  const svc = m.serviceability;
  return {
    'the continuity arm answers every class, default included, for a set-side asker (F8)': () => {
      for (const c of ['default', 'fable', 'opus', 'sonnet', 'haiku'] as const) {
        expect(svc(c, lane({ continuity: 'none' }), 'set-side', NOW), `${c} none`).toStrictEqual(unservable('no-continuity'));
        expect(svc(c, lane({ continuity: 'unread' }), 'set-side', NOW), `${c} unread`).toStrictEqual(unservable('continuity-unread'));
      }
    },
    'a recorded lane leaves a set-side default skipped': () => {
      expect(svc('default', lane(), 'set-side', NOW)).toStrictEqual({ kind: 'skipped' });
    },
    'the continuity word applies on top of the base answer (F1): it replaces a servable or unmeasured one, never an unservable one': () => {
      expect(svc('fable', lane({ continuity: 'none', share: null }), 'set-side', NOW)).toStrictEqual(unservable('no-continuity'));
      expect(svc('fable', lane({ continuity: 'none', share: { estimatePct: 5, finishedAtS: NOW - SHARE_STALE_S } }), 'set-side', NOW)).toStrictEqual(unservable('no-continuity'));
      expect(svc('fable', lane({ continuity: 'none' }), 'set-side', NOW)).toStrictEqual(unservable('no-continuity'));
      expect(svc('opus', lane({ continuity: 'unread', seven: null }), 'set-side', NOW)).toStrictEqual(unservable('continuity-unread'));
      expect(svc('opus', lane({ continuity: 'none' }), 'set-side', NOW)).toStrictEqual(unservable('no-continuity'));
    },
    'no record never softens a base refusal (F1): backend, credits, unset, unread and the ceilings keep their own word': () => {
      expect(svc('fable', lane({ continuity: 'none', anthropic: false, fableBilling: 'credits' }), 'set-side', NOW)).toStrictEqual(unservable('backend'));
      expect(svc('fable', lane({ continuity: 'none', fableBilling: 'credits' }), 'set-side', NOW)).toStrictEqual(unservable('credits'));
      expect(svc('fable', lane({ continuity: 'none', fableBilling: 'unset' }), 'set-side', NOW)).toStrictEqual(unservable('billing-unset'));
      expect(svc('fable', lane({ continuity: 'unread', fableBilling: 'unread' }), 'set-side', NOW)).toStrictEqual(unservable('billing-unread'));
      expect(svc('fable', lane({ continuity: 'none', share: { estimatePct: 40, finishedAtS: NOW } }), 'set-side', NOW))
        .toStrictEqual({ kind: 'unservable', why: 'ceiling', figurePct: 40, ceilingPct: 40 });
      expect(svc('opus', lane({ continuity: 'none', seven: 98 }), 'set-side', NOW))
        .toStrictEqual({ kind: 'unservable', why: 'ceiling', figurePct: 98, ceilingPct: 98 });
    },
    'backend comes before billing': () => {
      expect(svc('fable', lane({ anthropic: false, fableBilling: 'credits' }), 'set-side', NOW)).toStrictEqual(unservable('backend'));
      expect(svc('fable', lane({ anthropic: false, fableBilling: 'unset' }), 'set-side', NOW)).toStrictEqual(unservable('backend'));
    },
    'billing comes before the figure: credits, unset and unread each have their own word': () => {
      expect(svc('fable', lane({ fableBilling: 'credits' }), 'set-side', NOW)).toStrictEqual(unservable('credits'));
      expect(svc('fable', lane({ fableBilling: 'unset' }), 'set-side', NOW)).toStrictEqual(unservable('billing-unset'));
      expect(svc('fable', lane({ fableBilling: 'unread' }), 'set-side', NOW)).toStrictEqual(unservable('billing-unread'));
      expect(svc('fable', lane({ fableBilling: 'credits', share: null }), 'set-side', NOW)).toStrictEqual(unservable('credits'));
    },
    'included billing serves on the figure, as an `other` asker does': () => {
      expect(svc('fable', lane(), 'set-side', NOW)).toStrictEqual({ kind: 'servable', figurePct: 10 });
      expect(svc('fable', lane({ share: { estimatePct: 40, finishedAtS: NOW } }), 'set-side', NOW))
        .toStrictEqual({ kind: 'unservable', why: 'ceiling', figurePct: 40, ceilingPct: 40 });
    },
    'billing is Fable\'s alone': () => {
      for (const c of ['opus', 'sonnet', 'haiku'] as const) {
        expect(svc(c, lane({ fableBilling: 'credits' }), 'set-side', NOW), c).toStrictEqual({ kind: 'servable', figurePct: 20 });
        expect(svc(c, lane({ fableBilling: 'unread' }), 'set-side', NOW), c).toStrictEqual({ kind: 'servable', figurePct: 20 });
      }
    },
    'an `other` asker never meets either fact': () => {
      expect(svc('fable', lane({ fableBilling: 'credits', continuity: 'none' }), 'other', NOW)).toStrictEqual({ kind: 'servable', figurePct: 10 });
      expect(svc('opus', lane({ fableBilling: 'unread', continuity: 'unread' }), 'other', NOW)).toStrictEqual({ kind: 'servable', figurePct: 20 });
      expect(svc('default', lane({ continuity: 'none' }), 'other', NOW)).toStrictEqual({ kind: 'skipped' });
    },
  };
}

const SERVICEABILITY_SET: MutantSet<ServiceabilityModule> = {
  modulePath: SERVICEABILITY_MODULE,
  mutants: [
    {
      id: 'S1 billing before backend',
      old: "    if (!lane.anthropic) return { kind: 'unservable', why: 'backend' };\n    // Billing is Fable's alone, after the backend word. Unset and unread refuse as credits would (H16: fail closed).\n    if (asking === 'set-side' && lane.fableBilling !== 'included') {\n      return { kind: 'unservable', why: lane.fableBilling === 'credits' ? 'credits' : lane.fableBilling === 'unread' ? 'billing-unread' : 'billing-unset' };\n    }\n",
      new: "    if (asking === 'set-side' && lane.fableBilling !== 'included') {\n      return { kind: 'unservable', why: lane.fableBilling === 'credits' ? 'credits' : lane.fableBilling === 'unread' ? 'billing-unread' : 'billing-unset' };\n    }\n    if (!lane.anthropic) return { kind: 'unservable', why: 'backend' };\n",
    },
    {
      id: 'S2 the continuity arm skips the default class',
      old: "|| base.kind === 'unservable') return base;",
      new: "|| base.kind === 'unservable' || cls === 'default') return base;",
    },
    {
      id: 'S3 the continuity arm is DROPPED (no asker ever meets it)',
      old: "asking !== 'set-side' || lane.continuity === 'recorded' ||",
      new: "true ||",
    },
    { id: 'S4 no-continuity read as continuity-unread', old: "lane.continuity === 'unread' ? 'continuity-unread' : 'no-continuity'", new: "lane.continuity === 'unread' ? 'no-continuity' : 'continuity-unread'" },
    { id: 'S5 credits read as billing-unset', old: "lane.fableBilling === 'credits' ? 'credits' :", new: "lane.fableBilling === 'credits' ? 'billing-unset' :" },
    { id: 'S6 billing-unread read as billing-unset', old: "lane.fableBilling === 'unread' ? 'billing-unread' : 'billing-unset'", new: "lane.fableBilling === 'unread' ? 'billing-unset' : 'billing-unread'" },
    { id: 'S7 an unset billing fact reads as credits', old: "lane.fableBilling === 'credits' ? 'credits' : lane.fableBilling === 'unread' ? 'billing-unread' : 'billing-unset'", new: "lane.fableBilling === 'unread' ? 'billing-unread' : 'credits'" },
    { id: 'S8 the billing arm also gates the lower classes', old: "  if (cls === 'default') return { kind: 'skipped' };\n  if (cls === 'fable') {", new: "  if (cls === 'default') return { kind: 'skipped' };\n  if (asking === 'set-side' && lane.fableBilling === 'credits') return { kind: 'unservable', why: 'credits' };\n  if (cls === 'fable') {" },
    { id: 'S9 the billing arm asks every asker', old: "if (asking === 'set-side' && lane.fableBilling !== 'included') {", new: "if (lane.fableBilling !== 'included') {" },
    { id: 'S10 the continuity arm asks every asker', old: "asking !== 'set-side' || lane.continuity === 'recorded'", new: "lane.continuity === 'recorded'" },
    { id: 'S11 the continuity word outranks an unservable base (F1)', old: "|| base.kind === 'unservable') return base;", new: ") return base;" },
  ],
  suite: serviceabilityCases,
};

// ---------- askingOf ----------

export function askingOfCases(m: Pick<ServiceabilityModule, 'askingOf'>): Record<string, SuiteCase> {
  const of = (side: SessionPoolSide) => m.askingOf(side);
  return {
    'a set asks as a set-side session': () => {
      expect(of({ state: 'set', set: { pools: ['pool-a'], untagged: false } })).toBe('set-side');
    },
    'an unreadable set asks as a set-side session': () => { expect(of({ state: 'set-unreadable' })).toBe('set-side'); },
    'a malformed set asks as a set-side session': () => { expect(of({ state: 'set-malformed' })).toBe('set-side'); },
    'every project word asks as other': () => {
      for (const side of [{ state: 'tagged', name: 'pool-a' }, { state: 'untagged' }, { state: 'malformed' }, { state: 'unreadable' }] as const) {
        expect(of(side), side.state).toBe('other');
      }
    },
  };
}

const ASKING_SET: MutantSet<ServiceabilityModule> = {
  modulePath: SERVICEABILITY_MODULE,
  mutants: [
    { id: 'A1 a set is not a set-side asker', old: "case 'set': case 'set-unreadable'", new: "case 'set-unreadable'" },
    { id: 'A2 an unreadable set is not a set-side asker', old: "case 'set-unreadable': case 'set-malformed'", new: "case 'set': case 'set-malformed'" },
    { id: 'A3 a malformed set is not a set-side asker', old: "case 'set-malformed': return 'set-side';", new: "return 'set-side';" },
    { id: 'A4 every project word is a set-side asker', old: "case 'malformed': return 'other';", new: "case 'malformed': return 'set-side';" },
  ],
  suite: askingOfCases,
};

// ---------- factsChangeWidens ----------

export function factsChangeWidensCases(m: Pick<RosterFactsModule, 'factsChangeWidens'>): Record<string, SuiteCase> {
  const widens = m.factsChangeWidens;
  return {
    'a widening value takes the step-up, whatever is stored': () => {
      expect(widens({ fableBilling: 'included' })).toBe(true);
      expect(widens({ continuity: 'on' })).toBe(true);
      expect(widens({ fableBilling: 'credits', continuity: 'on' })).toBe(true);
      expect(widens({ fableBilling: 'included', continuity: 'off' })).toBe(true);
    },
    'a narrowing value never does': () => {
      expect(widens({ fableBilling: 'credits' })).toBe(false);
      expect(widens({ continuity: 'off' })).toBe(false);
      expect(widens({ fableBilling: 'credits', continuity: 'off' })).toBe(false);
      expect(widens({})).toBe(false);
    },
  };
}

const WIDENS_SET: MutantSet<RosterFactsModule> = {
  modulePath: ROSTER_FACTS_MODULE,
  mutants: [
    { id: 'W1 on does not widen', old: "c.fableBilling === 'included' || c.continuity === 'on'", new: "c.fableBilling === 'included'" },
    { id: 'W2 credits widens', old: "c.fableBilling === 'included' || c.continuity === 'on'", new: "c.fableBilling === 'included' || c.continuity === 'on' || c.fableBilling === 'credits'" },
    { id: 'W3 included does not widen', old: "c.fableBilling === 'included' || c.continuity === 'on'", new: "c.continuity === 'on'" },
    { id: 'W4 off widens', old: "c.fableBilling === 'included' || c.continuity === 'on'", new: "c.fableBilling === 'included' || c.continuity !== undefined" },
  ],
  suite: factsChangeWidensCases,
};

export const SERVICEABILITY_KEY = 'shared/serviceability.ts#serviceability';
export const ASKING_OF_KEY = 'shared/serviceability.ts#askingOf';
export const FACTS_CHANGE_WIDENS_KEY = 'shared/rosterFacts.ts#factsChangeWidens';

export const SERVICEABILITY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [SERVICEABILITY_KEY]: SERVICEABILITY_SET as MutantSet<never>,
  [ASKING_OF_KEY]: ASKING_SET as MutantSet<never>,
  [FACTS_CHANGE_WIDENS_KEY]: WIDENS_SET as MutantSet<never>,
};
