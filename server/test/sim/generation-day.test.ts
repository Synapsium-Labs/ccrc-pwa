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
type TRow = [...Row, at: number];
const timed = (rows: readonly TRow[]): SequenceLine[] => rows.map(([kind, id, state, actor, at], i) => ({ seq: i + 1, at, kind, id, state, actor }));
const byName = (n: string) => GEN_DAY_INVARIANTS.find((i) => i.name === n)!;
const REAL: GenDayModules = { renewal, soft, machine, observed };
const FILE = 'test/sim/generation-day.test.ts';
/** 200 seeds in CI; CCRC_SIM=full runs 5,000. */
const DEFAULTS = Array.from({ length: process.env.CCRC_SIM === 'full' ? 5_000 : 200 }, (_, i) => i + 1);
const H = 3_600_000;

describe('the generation day\'s invariants go red on a hand-made sequence', () => {
  it('CONTROL: G1 is red on a minted generation that is active without a passed round', () => {
    const l = seqOf([['gen', 'o#2', 'carded', 'mint'], ['card', 'o#2', 'match', 'lane'], ['gen', 'o#2', 'probing', 'lane'], ['gen', 'o#2', 'active', 'lane']]);
    expect(byName('G1').check(l)?.invariant).toBe('G1');
    const mismatch = seqOf([['gen', 'o#2', 'carded', 'mint'], ['card', 'o#2', 'mismatch', 'lane'], ['gen', 'o#2', 'probing', 'lane'],
      ['probes', 'o#2', 'passed', 'lane'], ['gen', 'o#2', 'active', 'lane']]);
    expect(byName('G1').check(mismatch)?.invariant).toBe('G1');
    const ok = seqOf([['gen', 'o#2', 'carded', 'mint'], ['card', 'o#2', 'match', 'lane'], ['gen', 'o#2', 'probing', 'lane'],
      ['probes', 'o#2', 'passed', 'lane'], ['gen', 'o#2', 'active', 'lane']]);
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
  it('CONTROL: G4 reads a freeze as observed time advanced by the cap, never frozen and never past it (review 1894, F1)', () => {
    const freeze = (after: number): SequenceLine[] => seqOf([['obs', 'server', 'ms=500', 'lane'],
      ['obs-gap', 'server', 'kind=step;deltaMs=600000', 'lane'], ['obs', 'server', `ms=${after}`, 'lane']]);
    expect(byName('G4').check(freeze(500 + 60_000))).toBeNull();
    expect(byName('G4').check(freeze(500))?.invariant).toBe('G4');
    expect(byName('G4').check(freeze(500 + 30_000))?.invariant).toBe('G4');
    expect(byName('G4').check(freeze(500 + 60_001))?.invariant).toBe('G4');
    expect(byName('G4').check(timed([['obs', 'server', 'ms=0', 'lane', 0], ['obs', 'server', 'ms=60001', 'lane', 90_000]]))?.invariant).toBe('G4');
    expect(byName('G4').check(timed([['obs', 'server', 'ms=0', 'lane', 0], ['obs', 'server', 'ms=30000', 'lane', 30_000]]))).toBeNull();
  });
  it('CONTROL: G4 is red when observed time runs ahead of the clock or behind it within one process, and on a freeze with no step gap (review 1912, F2 and F7; review 1920, R5)', () => {
    expect(byName('G4').check(timed([['obs', 'server', 'ms=0', 'lane', 0], ['obs', 'server', 'ms=30001', 'lane', 30_000]]))?.invariant).toBe('G4');
    expect(byName('G4').check(timed([['obs', 'server', 'ms=0', 'lane', 0], ['obs', 'server', 'ms=29999', 'lane', 30_000]]))?.invariant).toBe('G4');
    expect(byName('G4').check(timed([['obs', 'server', 'ms=0', 'lane', 0], ['obs', 'server', 'ms=30000', 'lane', 30_000]]))).toBeNull();
    // A freeze before the first observation: the first stamp has nothing to step from, so it answers no gap (R1).
    expect(byName('G4').check(timed([['server', 'freeze', 'frozen;for=360000', 'sim', 15_000], ['obs', 'server', 'ms=0', 'lane', 390_000],
      ['obs', 'server', 'ms=30000', 'lane', 420_000]]))).toBeNull();
    const thaw = (gap: boolean): SequenceLine[] => timed([['obs', 'server', 'ms=0', 'lane', 0], ['server', 'freeze', 'frozen;for=300000', 'sim', 10_000],
      ...(gap ? [['obs-gap', 'server', 'kind=step;deltaMs=330000', 'lane', 330_000] as TRow] : []), ['obs', 'server', 'ms=60000', 'lane', 330_000]]);
    expect(byName('G4').check(thaw(true))).toBeNull();
    expect(byName('G4').check(thaw(false))?.invariant).toBe('G4');
  });
  it('CONTROL: G6 bounds each transient state at its deadline plus one lane period, and a landed renewal at the budget plus one period per state; a crash or a freeze waives both (review 1912, F10)', () => {
    // Every state at its bound: checkpointed 60+30, clearing 90+30, carded 45+30, probing 165+30, 480 s in all.
    const run = (end: number, waive?: TRow): SequenceLine[] => timed([['gen', 'o#1', 'checkpointed', 'lane', 0],
      ...(waive === undefined ? [] : [waive]),
      ['gen', 'o#1', 'clearing', 'lane', 90_000], ['start', 'o', 'applied', 'host', 210_000], ['gen', 'o#1', 'ended', 'lane', 210_000],
      ['gen', 'o#2', 'carded', 'mint', 210_000], ['gen', 'o#2', 'probing', 'lane', 285_000], ['gen', 'o#2', 'active', 'lane', end]]);
    expect(byName('G6').check(run(480_000))).toBeNull();
    expect(byName('G6').check(run(480_001))?.invariant).toBe('G6');
    expect(byName('G6').check(run(480_001, ['server', 'crash', 'down', 'sim', 1_000]))?.invariant).toBe('G6');   // o#2 entered after it
    const late = (waive?: TRow): SequenceLine[] => timed([['gen', 'o#1', 'draining', 'lane', 0], ...(waive === undefined ? [] : [waive]),
      ['gen', 'o#1', 'active', 'lane', 150_001]]);
    expect(byName('G6').check(late())?.invariant).toBe('G6');
    expect(byName('G6').check(late(['server', 'crash', 'down', 'sim', 1_000]))).toBeNull();
    expect(byName('G6').check(late(['server', 'freeze', 'frozen;for=600000', 'sim', 1_000]))).toBeNull();
    // A back() to active of the same generation is not a landed renewal.
    expect(byName('G6').check(timed([['gen', 'o#1', 'checkpointed', 'lane', 0], ['gen', 'o#1', 'clearing', 'lane', 60_000],
      ['gen', 'o#1', 'active', 'lane', 100_000]]))).toBeNull();
  });
  it('CONTROL: G7 is red on a soft renewal from degraded, and on one inside the hold-off (review 1912, F9)', () => {
    const soft = (age: number, from = 'active'): Row => ['soft-renewal', 'o', `obs=1;age=${age};n=1;from=${from}`, 'lane'];
    expect(byName('G7').check(seqOf([soft(H, 'degraded')]))?.invariant).toBe('G7');
    expect(byName('G7').check(seqOf([['hold-off', 'o#1', `until=${H}`, 'lane'], soft(H - 1)]))?.invariant).toBe('G7');
    expect(byName('G7').check(seqOf([['hold-off', 'o#1', `until=${H}`, 'lane'], soft(H)]))).toBeNull();
    expect(byName('G7').check(seqOf([['hold-off', 'o#2', `until=${H}`, 'lane'], soft(H - 1)]))).toBeNull();
  });
  it('CONTROL: G5 is red on a mint with no start, and on a start that minted nothing', () => {
    expect(byName('G5').check(seqOf([['gen', 'o#2', 'carded', 'mint']]))?.invariant).toBe('G5');
    expect(byName('G5').check(seqOf([['start', 'o', 'applied', 'host'], ['sim', 'generation-day', 'end', 'sim']]))?.invariant).toBe('G5');
    expect(byName('G5').check(seqOf([['start', 'o', 'applied', 'host'], ['gen', 'o#2', 'carded', 'mint'], ['sim', 'g', 'end', 'sim']]))).toBeNull();
    expect(byName('G5').check(seqOf([['start', 'o', 'applied', 'host'], ['gen', 'o#3', 'carded', 'mint']]))?.invariant).toBe('G5');   // not the next number (F18)
  });
});

/** The first CI seed on which `mods` breaks `invariant`, or null. */
async function redSeed(mods: GenDayModules, invariant: string): Promise<string | null> {
  for (const seed of DEFAULTS) {
    const r = await simulate(generationDay(mods), seed, GEN_DAY_INVARIANTS);
    if (r.violations.some((v) => v.invariant === invariant)) return `seed ${seed}`;
  }
  return null;
}
type Observe = typeof observed.observeTime;
const withObserve = (f: Observe): GenDayModules => ({ ...REAL, observed: { ...observed, observeTime: f } });

describe('the generation day over seeded runs', () => {
  it('holds G1 to G7 on every seed and reaches every edge', async () => {
    await assertScenario(generationDay(REAL), GEN_DAY_INVARIANTS, { seeds: simSeeds(DEFAULTS), testFile: FILE });
  }, 600_000);

  it('MUTATION: a generationStep that takes any card read as a match goes red on G1 within the CI seeds (review I4)', async () => {
    expect(await redSeed({ ...REAL, machine: { ...machine,
      generationStep: (g, e) => machine.generationStep(g, e.kind === 'card-read' ? { kind: 'card-read', hashMatches: true } : e) } }, 'G1')).not.toBeNull();
  }, 600_000);

  it('MUTATION: an observeTime that advances nothing across a freeze goes red on G4 within the CI seeds (review 1894, F1)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap?.kind === 'step' && p !== null ? { at: { ...st.at, ms: p.ms }, gap: st.gap } : st;
    }), 'G4')).not.toBeNull();
  }, 600_000);

  it('MUTATION: an observeTime that counts each step twice, under the cap, goes red on G4 within the CI seeds (review 1912, F2)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap === null && p !== null ? { ...st, at: { ...st.at, ms: p.ms + Math.min(cap, 2 * (st.at.ms - p.ms)) } } : st;
    }), 'G4')).not.toBeNull();
  }, 600_000);

  it('MUTATION: an observeTime that counts half of each step goes red on G4 within the CI seeds (review 1920, R5)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap === null && p !== null ? { ...st, at: { ...st.at, ms: p.ms + Math.floor((st.at.ms - p.ms) / 2) } } : st;
    }), 'G4')).not.toBeNull();
  }, 600_000);

  it('MUTATION: an observeTime that answers no gap for a freeze goes red on G4 within the CI seeds (review 1912, F7)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap?.kind === 'step' ? { ...st, gap: null } : st;
    }), 'G4')).not.toBeNull();
  }, 600_000);

  it('MUTATION: a softRenewalMay that ignores the budget goes red on G2 within the CI seeds', async () => {
    expect(await redSeed({ ...REAL, soft: { softRenewalMay: (i) => soft.softRenewalMay({ ...i, softRenewalsInWindow: 0 }) } }, 'G2')).not.toBeNull();
  }, 600_000);

  it('MUTATION: a softRenewalMay that ignores the hold-off goes red on G7 within the CI seeds (review 1912, F9)', async () => {
    expect(await redSeed({ ...REAL, soft: { softRenewalMay: (i) => soft.softRenewalMay({ ...i, holdOffUntilObservedMs: null }) } }, 'G7')).not.toBeNull();
  }, 600_000);

  it('MUTATION: a generationStep that drains on a soft due in degraded goes red on G7 within the CI seeds (review 1912, F9)', async () => {
    expect(await redSeed({ ...REAL, machine: { ...machine,
      generationStep: (g, e) => machine.generationStep(g, e.kind === 'due' && g.state === 'degraded' ? { kind: 'due', cls: 'hard' } : e) } }, 'G7')).not.toBeNull();
  }, 600_000);
});
