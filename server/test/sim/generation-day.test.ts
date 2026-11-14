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
import type { CoordStore } from '../../src/coord/store.js';
import type { GenerationsCoord } from '../../src/continuity/generationsLane.js';
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
/** A case's time bound: about 0.3 s a seed since the day runs the real lane and store, so 5,000 seeds need more. */
const BOUND_MS = process.env.CCRC_SIM === 'full' ? 3_600_000 : 600_000;

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
    const freeze = (after: number): SequenceLine[] => seqOf([['obs', 'server', 'ms=500', 'lane'], ['server', 'freeze', 'frozen;for=600000', 'sim'],
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
  it('CONTROL: G4 is red on a step gap no freeze, crash or boot caused, unless the clock itself stepped that far (review 2006 R7)', () => {
    const step = (before: TRow | null, deltaMs: number): SequenceLine[] => timed([['obs', 'server', 'ms=0', 'lane', 0],
      ...(before === null ? [] : [before]), ['obs-gap', 'server', `kind=step;deltaMs=${deltaMs};mono=30000`, 'lane', 30_000],
      ['obs', 'server', 'ms=60000', 'lane', 30_000]]);
    // A stored stamp skewed 31 s behind: the clock stepped 30 s, the gap says 61 s.
    expect(byName('G4').check(step(null, 61_000))?.invariant).toBe('G4');
    expect(byName('G4').check(step(['server', 'freeze', 'frozen;for=31000', 'sim', 10_000], 61_000))).toBeNull();
    // A crash or a boot is a cause too (what G4 then says of the restart is its own rule, not this one).
    expect(byName('G4').check(step(['server', 'crash', 'down', 'sim', 10_000], 61_000))?.message ?? '').not.toContain('R7');
    expect(byName('G4').check(step(['server', 'boot', 'up', 'sim', 10_000], 61_000))?.message ?? '').not.toContain('R7');
    // A gap whose delta is the clock's own step needs no other cause.
    expect(byName('G4').check(step(null, 30_000))).toBeNull();
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
  it('CONTROL: G8 is red when a pass leaves the live generation minted by a start older than the newest reported one', () => {
    const day = (live: number): SequenceLine[] => seqOf([['report', 'c', 'start=1', 'host'], ['pass', 'server', 'c=1', 'lane'],
      ['report', 'c', 'start=2', 'host'], ['server', 'crash', 'down', 'sim'], ['server', 'boot', 'up', 'sim'],
      ['pass', 'server', `c=${live}`, 'lane']]);
    expect(byName('G8').check(day(1))?.invariant).toBe('G8');
    expect(byName('G8').check(day(2))).toBeNull();
  });
  it('CONTROL: G5 counts the reported starts (review 2003 F7): red on a mint with no start, and on a start that had to mint and did not', () => {
    const r = (n: number, uuid = 'u1', source = 'clear'): Row => ['report', 'o', `start=${n};source=${source};uuid=${uuid}`, 'host'];
    const pass: Row = ['pass', 'server', 'o=1', 'lane'];
    // The day's first start is n=1's; a mint beyond the starts reported after it is a mint with no start.
    expect(byName('G5').check(seqOf([r(1), ['gen', 'o#2', 'carded', 'mint']]))?.invariant).toBe('G5');
    expect(byName('G5').check(seqOf([r(1), r(2), pass]))?.invariant).toBe('G5');
    expect(byName('G5').check(seqOf([r(1), r(2), ['gen', 'o#2', 'carded', 'mint'], pass]))).toBeNull();
    // Two starts of the current conversation in one batch, the older skipped: G8 stays green (the newest minted), G5 does not.
    const skippedOlder = seqOf([r(1), r(2), r(3), ['gen', 'o#2', 'carded', 'mint'], ['pass', 'server', 'o=3', 'lane']]);
    expect(byName('G5').check(skippedOlder)?.invariant).toBe('G5');
    expect(byName('G8').check(skippedOlder)).toBeNull();
    // A start whose conversation a later start replaced before a pass judged it may mint nothing (the uuid rule's cost).
    expect(byName('G5').check(seqOf([r(1), r(2, 'u1', 'resume'), r(3, 'u2'), ['gen', 'o#2', 'carded', 'mint'], pass]))).toBeNull();
    // ... but once a completed pass found it current, it had to mint.
    expect(byName('G5').check(seqOf([r(1), r(2, 'u1', 'resume'), pass, r(3, 'u2'), ['gen', 'o#2', 'carded', 'mint'], pass]))?.invariant).toBe('G5');
    // A pass an abort cut short writes no pass line: the starts it left are judged at the next one.
    expect(byName('G5').check(seqOf([r(1), r(2), ['server', 'crash', 'down', 'sim']]))).toBeNull();
    expect(byName('G5').check(seqOf([r(1), r(2), ['gen', 'o#3', 'carded', 'mint']]))?.invariant).toBe('G5');   // not the next number (F18)
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
  it('holds G1 to G8 on every seed and reaches every edge', async () => {
    await assertScenario(generationDay(REAL), GEN_DAY_INVARIANTS, { seeds: simSeeds(DEFAULTS), testFile: FILE });
  }, BOUND_MS);

  it('MUTATION: a generationStep that takes any card read as a match goes red on G1 within the CI seeds (review I4)', async () => {
    expect(await redSeed({ ...REAL, machine: { ...machine,
      generationStep: (g, e) => machine.generationStep(g, e.kind === 'card-read' ? { kind: 'card-read', hashMatches: true } : e) } }, 'G1')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: an observeTime that advances nothing across a freeze goes red on G4 within the CI seeds (review 1894, F1)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap?.kind === 'step' && p !== null ? { at: { ...st.at, ms: p.ms }, gap: st.gap } : st;
    }), 'G4')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: an observeTime that counts each step twice, under the cap, goes red on G4 within the CI seeds (review 1912, F2)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap === null && p !== null ? { ...st, at: { ...st.at, ms: p.ms + Math.min(cap, 2 * (st.at.ms - p.ms)) } } : st;
    }), 'G4')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: an observeTime that counts half of each step goes red on G4 within the CI seeds (review 1920, R5)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap === null && p !== null ? { ...st, at: { ...st.at, ms: p.ms + Math.floor((st.at.ms - p.ms) / 2) } } : st;
    }), 'G4')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: an observeTime that answers no gap for a freeze goes red on G4 within the CI seeds (review 1912, F7)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return st.gap?.kind === 'step' ? { ...st, gap: null } : st;
    }), 'G4')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: an observeTime that leaves the stored mono stale goes red on G4 within the CI seeds (review 2003 F6: the oracle is the scenario\'s clock)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      // Every pass, a gap's included: under the old oracle (an obs line only when the stored mono was the clock's) no line
      // was ever written after the first, and G4 held vacuously.
      return p !== null ? { ...st, at: { ...st.at, mono: p.mono } } : st;
    }), 'G4')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: an observeTime that stores a mono 31 s behind the clock goes red on G4 within the CI seeds (review 2006 R7: each beat then answers a step gap)', async () => {
    expect(await redSeed(withObserve((p, mono, proc, cap) => {
      const st = observed.observeTime(p, mono, proc, cap);
      return { ...st, at: { ...st.at, mono: st.at.mono - 31_000 } };
    }), 'G4')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: a cursor advanced before the mint it covers goes red on G8 within the CI seeds (review 2003 F9)', async () => {
    const cursorFirst = (store: CoordStore): GenerationsCoord => Object.assign(Object.create(store) as CoordStore, {
      mintGeneration: (...[i, e, live, c]: Parameters<CoordStore['mintGeneration']>) => {
        if (c !== null && c !== undefined) store.advanceCursor(c);
        return store.mintGeneration(i, e, live, null);
      },
    });
    expect(await redSeed({ ...REAL, coord: cursorFirst }, 'G8')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: a softRenewalMay that ignores the budget goes red on G2 within the CI seeds', async () => {
    expect(await redSeed({ ...REAL, soft: { softRenewalMay: (i) => soft.softRenewalMay({ ...i, softRenewalsInWindow: 0 }) } }, 'G2')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: a softRenewalMay that ignores the hold-off goes red on G7 within the CI seeds (review 1912, F9)', async () => {
    expect(await redSeed({ ...REAL, soft: { softRenewalMay: (i) => soft.softRenewalMay({ ...i, holdOffUntilObservedMs: null }) } }, 'G7')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: a generationStep that drains on a soft due in degraded goes red on G7 within the CI seeds (review 1912, F9)', async () => {
    expect(await redSeed({ ...REAL, machine: { ...machine,
      generationStep: (g, e) => machine.generationStep(g, e.kind === 'due' && g.state === 'degraded' ? { kind: 'due', cls: 'hard' } : e) } }, 'G7')).not.toBeNull();
  }, BOUND_MS);
});
