// A generation day: the renewal deciders under crash and gap injection (Overlord W1a, renewal deciders Task 6; spec
// §3.3.11, §11.5, §11.7). The control rows prove each invariant goes red on a hand-made sequence; the seeded rows run
// the real deciders, and one hands the scenario a softRenewalMay that ignores the budget, which G2 must catch.
import { describe, expect, it } from 'vitest';
import * as machine from '../../src/continuity/generationMachine.js';
import * as renewal from '../../src/continuity/renewalDue.js';
import * as soft from '../../src/continuity/softRenewal.js';
import * as observed from '../../src/time/observed.js';
import { GEN_DAY_INVARIANTS, generationDay, type GenDayModules } from './generationDay.js';
import { assertScenario, simSeeds, simulate } from './run.js';
import type { SequenceLine } from './sequence.js';

type Row = [kind: string, id: string, state: string, actor: string];
const seqOf = (rows: readonly Row[]): SequenceLine[] =>
  rows.map(([kind, id, state, actor], i) => ({ seq: i + 1, at: i * 1_000, kind, id, state, actor }));
const byName = (n: string) => GEN_DAY_INVARIANTS.find((i) => i.name === n)!;
const REAL: GenDayModules = { renewal, soft, machine, observed };
const FILE = 'test/sim/generation-day.test.ts';
/** 200 seeds in CI; CCRC_SIM=full runs 5,000. */
const DEFAULTS = Array.from({ length: process.env.CCRC_SIM === 'full' ? 5_000 : 200 }, (_, i) => i + 1);
const H = 3_600_000;

describe('the generation day\'s invariants go red on a hand-made sequence', () => {
  it('CONTROL: G1 is red on a minted generation that is active without a passed round', () => {
    const l = seqOf([['gen', 'o#2', 'carded', 'mint'], ['gen', 'o#2', 'probing', 'lane'], ['gen', 'o#2', 'active', 'lane']]);
    expect(byName('G1').check(l)?.invariant).toBe('G1');
    const ok = seqOf([['gen', 'o#2', 'carded', 'mint'], ['gen', 'o#2', 'probing', 'lane'], ['probes', 'o#2', 'passed', 'session'], ['gen', 'o#2', 'active', 'lane']]);
    expect(byName('G1').check(ok)).toBeNull();
  });
  it('CONTROL: G2 is red on a fourth soft renewal inside six observed hours, green on one just outside', () => {
    const at = (ms: number): Row => ['soft-renewal', 'o', `obs=${ms};age=${H}`, 'lane'];
    expect(byName('G2').check(seqOf([at(0), at(H), at(2 * H), at(6 * H - 1)]))?.invariant).toBe('G2');
    expect(byName('G2').check(seqOf([at(0), at(H), at(2 * H), at(6 * H)]))).toBeNull();
  });
  it('CONTROL: G3 is red on a soft renewal at 29 observed minutes', () => {
    expect(byName('G3').check(seqOf([['soft-renewal', 'o', `obs=1;age=${29 * 60_000}`, 'lane']]))?.invariant).toBe('G3');
    expect(byName('G3').check(seqOf([['soft-renewal', 'o', `obs=1;age=${30 * 60_000}`, 'lane']]))).toBeNull();
  });
  it('CONTROL: G4 is red when observed time moves across a gap, falls, or a deadline fires twice', () => {
    const gap = (after: number): SequenceLine[] => seqOf([['obs', 'server', 'ms=500', 'lane'], ['server', 'crash', 'down', 'sim'],
      ['server', 'boot', 'up', 'sim'], ['obs', 'server', `ms=${after}`, 'lane']]);
    expect(byName('G4').check(gap(900))?.invariant).toBe('G4');
    expect(byName('G4').check(gap(500))).toBeNull();
    expect(byName('G4').check(seqOf([['obs', 'server', 'ms=5', 'lane'], ['obs', 'server', 'ms=4', 'lane']]))?.invariant).toBe('G4');
    expect(byName('G4').check(seqOf([['deadline', 'o#1:draining:9', 'fired', 'lane'], ['deadline', 'o#1:draining:9', 'fired', 'lane']]))?.invariant).toBe('G4');
  });
  it('CONTROL: G5 is red on a mint with no start, and on a start that minted nothing', () => {
    expect(byName('G5').check(seqOf([['gen', 'o#2', 'carded', 'mint']]))?.invariant).toBe('G5');
    expect(byName('G5').check(seqOf([['start', 'o', 'applied', 'host'], ['sim', 'generation-day', 'end', 'sim']]))?.invariant).toBe('G5');
    expect(byName('G5').check(seqOf([['start', 'o', 'applied', 'host'], ['gen', 'o#2', 'carded', 'mint'], ['sim', 'g', 'end', 'sim']]))).toBeNull();
  });
});

describe('the generation day over seeded runs', () => {
  it('holds G1 to G5 on every seed and reaches every edge', async () => {
    await assertScenario(generationDay(REAL), GEN_DAY_INVARIANTS, { seeds: simSeeds(DEFAULTS), testFile: FILE });
  }, 600_000);

  it('MUTATION: a softRenewalMay that ignores the budget goes red on G2 within the CI seeds', async () => {
    const noBudget: GenDayModules = { ...REAL, soft: { softRenewalMay: (i) => soft.softRenewalMay({ ...i, softRenewalsInWindow: 0 }) } };
    let red: string | null = null;
    for (const seed of DEFAULTS) {
      const r = await simulate(generationDay(noBudget), seed, GEN_DAY_INVARIANTS);
      if (r.violations.some((v) => v.invariant === 'G2')) { red = `seed ${seed}`; break; }
    }
    expect(red).not.toBeNull();
  }, 600_000);
});
