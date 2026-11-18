// The act-key claim's oracle and mutant set (Overlord W1 door process A1, plan `w1-door-process.md` Task 1 Step 5; its
// Global Constraints' "Mutation floors"). `actKeyClaimVerdict`'s cases are written ONCE here, as suite cases over a module:
// `continuity-act-key.test.ts` runs them against the real module, and `mutation-floors.test.ts` against each textual mutant.
// The plan's mutants: each arm deleted; arms 3 and 4 swapped; the hash compare negated; a `null` hash read as a match. The
// plan's "arms 5 and 6 swapped" is an EQUIVALENT mutant, so it is not in the set (slug arms-5-and-6-are-exclusive): a start
// whose generation is not minted has no state, so the two arms can never both hold, and no input tells their order apart.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import type { ClaimFacts, ClaimRead, StartFact } from '../../src/continuity/actKey.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type ActKeyModule = typeof import('../../src/continuity/actKey.js');

const H = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ok = <T>(value: T): ClaimRead<T> => ({ ok: true, value });
const lost: ClaimRead<never> = { ok: false, detail: 'continuity_act_keys read failed: no such table' };
const startOf = (startId: number, nonceSha256: string | null, generation: StartFact['generation']): StartFact =>
  ({ startId, nonceSha256, generation });
const minted = (id: number, n: number, state: 'active' | 'carded' | 'ended' = 'carded'): StartFact['generation'] => ({ id, n, state });
const both = (s: StartFact): Pick<ClaimFacts, 'newest' | 'matching'> => ({ newest: ok(s), matching: ok(s) });
const facts = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({ presented: H, spent: ok('none'), ...both(startOf(7, H, minted(3, 2))), ...over });
const refused = (error: string, why: string): unknown => ({ kind: 'refuse', error, why });

/** One case per arm in its order, the order itself, and the four restarts. */
export function actKeyCases(m: ActKeyModule): Record<string, SuiteCase> {
  const v = m.actKeyClaimVerdict;
  return {
    '1. any read unmeasured: unmeasured (store-unreadable), each read on its own': () => {
      for (const k of ['spent', 'newest', 'matching'] as const) expect(v(facts({ [k]: lost })), k).toEqual(refused('unmeasured', 'store-unreadable'));
    },
    '2. the nonce already spent: stale-generation (nonce-spent)': () => {
      expect(v(facts({ spent: ok({ generationId: 3 }) }))).toEqual(refused('stale-generation', 'nonce-spent'));
    },
    '3. no start carries the hash: renewing (start-unreported); a start with no hash, or another hash, never matches': () => {
      expect(v(facts({ matching: ok('none') }))).toEqual(refused('renewing', 'start-unreported'));
      expect(v(facts(both(startOf(7, null, minted(3, 2)))))).toEqual(refused('renewing', 'start-unreported'));
      expect(v(facts(both(startOf(7, OTHER, minted(3, 2)))))).toEqual(refused('renewing', 'start-unreported'));
    },
    '4. the matching start is not the newest: stale-generation (superseded)': () => {
      expect(v(facts({ newest: ok(startOf(9, OTHER, 'not-minted')) }))).toEqual(refused('stale-generation', 'superseded'));
      expect(v(facts({ newest: ok(startOf(9, OTHER, minted(5, 3))) }))).toEqual(refused('stale-generation', 'superseded'));
    },
    '5. the matching start\'s generation is not minted yet: renewing (not-minted)': () => {
      expect(v(facts(both(startOf(7, H, 'not-minted'))))).toEqual(refused('renewing', 'not-minted'));
    },
    '6. that generation has ended: stale-generation (generation-ended)': () => {
      expect(v(facts(both(startOf(7, H, minted(3, 2, 'ended')))))).toEqual(refused('stale-generation', 'generation-ended'));
    },
    '7. otherwise issue, for that generation, at any live state': () => {
      expect(v(facts())).toEqual({ kind: 'issue', generationId: 3, n: 2 });
      expect(v(facts(both(startOf(7, H, minted(3, 2, 'active')))))).toEqual({ kind: 'issue', generationId: 3, n: 2 });
    },
    'ORDER: a spent nonce whose start is superseded answers nonce-spent': () => {
      expect(v(facts({ spent: ok({ generationId: 3 }), newest: ok(startOf(9, OTHER, 'not-minted')) }))).toEqual(refused('stale-generation', 'nonce-spent'));
    },
    'ORDER: an unmeasured matching beside a spent nonce answers unmeasured': () => {
      expect(v(facts({ spent: ok({ generationId: 3 }), matching: lost }))).toEqual(refused('unmeasured', 'store-unreadable'));
    },
    'ORDER: a start nobody reported answers start-unreported even when a newer start exists (arm 3 before arm 4)': () => {
      expect(v(facts({ newest: ok(startOf(9, OTHER, 'not-minted')), matching: ok('none') }))).toEqual(refused('renewing', 'start-unreported'));
    },
    'ORDER: a superseded start that is not minted answers superseded, not renewing (arm 4 before arm 5)': () => {
      expect(v(facts({ newest: ok(startOf(9, OTHER, 'not-minted')), matching: ok(startOf(7, H, 'not-minted')) })))
        .toEqual(refused('stale-generation', 'superseded'));
    },
    'the four restarts (a crash respawn, a Restart, a swap landing, a wake): renewing (not-minted), then issue, never stale-generation': () => {
      // The old generation (id 3, n 2) stays live; its start (7) bound an older nonce. The restart's spawn bound H to start 8.
      expect(v(facts(both(startOf(8, H, 'not-minted'))))).toEqual(refused('renewing', 'not-minted'));
      expect(v(facts(both(startOf(8, H, minted(4, 3)))))).toEqual({ kind: 'issue', generationId: 4, n: 3 });
    },
    'a spooled start (none carries the hash yet) answers renewing (start-unreported)': () => {
      expect(v(facts({ newest: ok(startOf(7, OTHER, minted(3, 2))), matching: ok('none') }))).toEqual(refused('renewing', 'start-unreported'));
    },
  };
}

const ARM = {
  a1: "  if (!f.spent.ok || !f.newest.ok || !f.matching.ok) return refuse('unmeasured', 'store-unreadable');\n",
  a2: "  if (f.spent.value !== 'none') return refuse('stale-generation', 'nonce-spent');\n",
  a3: "  if (matching === 'none' || matching.nonceSha256 === null || matching.nonceSha256 !== f.presented) {\n    return refuse('renewing', 'start-unreported');\n  }\n",
  a4: "  if (newest === 'none' || newest.startId !== matching.startId) return refuse('stale-generation', 'superseded');\n",
  a5: "  if (matching.generation === 'not-minted') return refuse('renewing', 'not-minted');\n",
  a6: "  if (matching.generation.state === 'ended') return refuse('stale-generation', 'generation-ended');\n",
} as const;
const NEWEST = '  const newest = f.newest.value;\n';

const ACT_KEY_SET: MutantSet<ActKeyModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/actKey.ts'),
  mutants: [
    { id: 'K1 the unmeasured arm deleted', old: ARM.a1, new: '' },
    { id: 'K2 the spent arm deleted', old: ARM.a2, new: '' },
    { id: 'K3 the unreported arm deleted', old: ARM.a3, new: "  if (matching === 'none') return refuse('renewing', 'start-unreported');\n" },
    { id: 'K4 the superseded arm deleted', old: ARM.a4, new: '' },
    { id: 'K5 the not-minted arm deleted', old: ARM.a5, new: "  if (matching.generation === 'not-minted') return { kind: 'issue', generationId: 0, n: 0 };\n" },
    { id: 'K6 the ended arm deleted', old: ARM.a6, new: '' },
    { id: 'K7 arms 3 and 4 swapped', old: ARM.a3 + NEWEST + ARM.a4,
      new: NEWEST + "  if (newest === 'none' || matching === 'none' || newest.startId !== matching.startId) return refuse('stale-generation', 'superseded');\n"
        + ARM.a3 },
    { id: 'K8 the hash compare negated', old: 'matching.nonceSha256 !== f.presented', new: 'matching.nonceSha256 === f.presented' },
    { id: 'K9 a null hash read as a match', old: 'matching.nonceSha256 === null || matching.nonceSha256 !== f.presented',
      new: '(matching.nonceSha256 !== null && matching.nonceSha256 !== f.presented)' },
  ],
  suite: actKeyCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const ACT_KEY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/actKey.ts#actKeyClaimVerdict': ACT_KEY_SET as MutantSet<never>,
};
