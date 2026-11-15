// A generation day: the real generations lane and the renewal acts, over a fake host, under port failures, agent-link drops,
// server crashes (between passes, inside one, between a pass and its acts, at the port call) and freezes (Overlord W1a, renewal
// deciders Task 6 and renewal act Task 5; spec §3.3.11, §11.5, §11.7). The control rows prove each invariant goes red on a
// hand-made sequence; the seeded rows run the real lane and acts, and each mutation row hands the scenario a mutant of one
// decider or of the acts' runner, which the named invariant must catch. G7 and G8 keep their first meaning, so the renewal
// act's invariants are G9 (one fresh conversation per renewal), G10 (every renewal ends), G11 (mail is held and none lost) and G12 (a renewal that reaches clearing makes its call).
import { describe, expect, it } from 'vitest';
import * as machine from '../../src/continuity/generationMachine.js';
import * as renewal from '../../src/continuity/renewalDue.js';
import * as soft from '../../src/continuity/softRenewal.js';
import * as observed from '../../src/time/observed.js';
import { GEN_DAY_INVARIANTS, generationDay, type GenDayModules } from './generationDay.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as feed from '../../src/continuity/renewalFeed.js';
import type { runRenewalActs } from '../../src/continuity/renewalActs.js';
import { rewriteRelativeImports } from './mutate.js';
import { mkTmp } from '../tmpHelpers.js';
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
    const arm = (state: string): Row => ['arm', 'continuity', state, 'sim'];
    expect(byName('G2').check(seqOf([arm('live'), at(0), at(H), at(2 * H), at(6 * H - 1)]))?.invariant).toBe('G2');
    // In shadow the lane's one stamp per row undercounts a would-be renewal that went back to active (the report's finding).
    expect(byName('G2').check(seqOf([arm('shadow'), at(0), at(H), at(2 * H), at(6 * H - 1)]))).toBeNull();
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
  it('CONTROL: G9 is red on a second renew call that started a fresh conversation in one renewal, green across two renewals of one generation', () => {
    const began: Row = ['renewal', 'c#1', 'began;proven=1;from=active', 'lane'];
    const start: Row = ['renew-start', 'c#1', 'after=3000', 'host'];
    expect(byName('G9').check(seqOf([began, start, start]))?.invariant).toBe('G9');
    expect(byName('G9').check(seqOf([began, start]))).toBeNull();
    // A renewal that failed, and a later one of the same generation, are two renewals.
    expect(byName('G9').check(seqOf([began, start, ['gen', 'c#1', 'active', 'lane'], began, start]))).toBeNull();
    expect(byName('G9').check(seqOf([began, start, ['renew-start', 'c#2', 'after=1', 'host'], start]))?.invariant).toBe('G9');
  });
  it('CONTROL: G10 is red on a renewal that never ends, on an unproven generation back in active, and on a back to active that is never given a hold-off', () => {
    const began = (proven: number): Row => ['renewal', 'c#1', `began;proven=${proven};from=active`, 'lane'];
    const live: Row = ['arm', 'continuity', 'live', 'sim'];
    // A renewal in clearing for longer than the budget plus one period per state, with the day running on.
    expect(byName('G10').check(timed([[...live, 0] as TRow, ['gen', 'c#1', 'draining', 'lane', 0], [...began(1), 0] as TRow, ['gen', 'c#1', 'clearing', 'lane', 1_000],
      ['sim', 'generation-day', 'end', 'sim', 1_000 + 480_001]]))?.invariant).toBe('G10');
    expect(byName('G10').check(timed([[...live, 0] as TRow, [...began(1), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000], ['sim', 'generation-day', 'end', 'sim', 1_000 + 480_000]]))).toBeNull();
    // A crash waives the time bound.
    expect(byName('G10').check(timed([[...live, 0] as TRow, [...began(1), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000], ['server', 'crash', 'down', 'sim', 2_000],
      ['sim', 'generation-day', 'end', 'sim', 900_000]]))).toBeNull();
    // Back to active: an unproven generation ends in degraded; a proven one needs its hold-off before it renews again or the day ends.
    expect(byName('G10').check(timed([[...live, 0] as TRow, [...began(0), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000], ['gen', 'c#1', 'active', 'lane', 2_000]]))?.invariant).toBe('G10');
    expect(byName('G10').check(timed([[...live, 0] as TRow, [...began(0), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000], ['gen', 'c#1', 'degraded', 'lane', 2_000],
      ['sim', 'generation-day', 'end', 'sim', 3_000]]))).toBeNull();
    const back = (hold: boolean, between?: TRow): SequenceLine[] => timed([[...live, 0] as TRow, [...began(1), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000],
      ['gen', 'c#1', 'active', 'lane', 2_000], ...(between === undefined ? [] : [between]), ...(hold ? [['hold-off', 'c#1', 'until=1', 'lane', 3_000] as TRow] : []),
      ['sim', 'generation-day', 'end', 'sim', 400_000]]);
    expect(byName('G10').check(back(true))).toBeNull();
    expect(byName('G10').check(back(false))?.invariant).toBe('G10');
    // The act that sets the hold-off follows the step, so a crash between them excuses it.
    expect(byName('G10').check(back(false, ['server', 'crash', 'down', 'sim', 2_500]))).toBeNull();
    expect(byName('G10').check(timed([[...live, 0] as TRow, [...began(1), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000], ['gen', 'c#1', 'active', 'lane', 2_000],
      [...began(1), 3_000]]))?.invariant).toBe('G10');
    // In shadow nothing is acted on, so no hold-off is owed.
    expect(byName('G10').check(timed([['arm', 'continuity', 'shadow', 'sim', 0], [...began(1), 0], ['gen', 'c#1', 'clearing', 'lane', 1_000],
      ['gen', 'c#1', 'active', 'lane', 2_000], ['sim', 'generation-day', 'end', 'sim', 400_000]]))).toBeNull();
  });
  it('CONTROL: G11 is red on a delivery while the recipient renews, on one delivered twice, and on one never delivered', () => {
    const q: Row = ['mail', 'c', 'queued;mail=1', 'host'];
    const d = (gen: string): Row => ['mail', 'c', `delivered;mail=1;gen=${gen}`, 'server'];
    expect(byName('G11').check(seqOf([q, d('probing')]))?.invariant).toBe('G11');
    expect(byName('G11').check(seqOf([q, d('draining')]))?.invariant).toBe('G11');
    expect(byName('G11').check(seqOf([q, d('active')]))).toBeNull();
    expect(byName('G11').check(seqOf([q, d('degraded')]))).toBeNull();
    expect(byName('G11').check(seqOf([q, d('active'), d('active')]))?.invariant).toBe('G11');
    expect(byName('G11').check(timed([['mail', 'c', 'queued;mail=1', 'host', 0], ['sim', 'generation-day', 'end', 'sim', H + 1]]))?.invariant).toBe('G11');
    expect(byName('G11').check(timed([['mail', 'c', 'queued;mail=1', 'host', 0], ['sim', 'generation-day', 'end', 'sim', H]]))).toBeNull();
  });
  it('CONTROL: G12 is red on a live renewal that leaves clearing with no renew call, green when one reached the host or the server died', () => {
    const live: Row = ['arm', 'continuity', 'live', 'sim'];
    const clearing: Row = ['gen', 'c#1', 'clearing', 'lane'];
    expect(byName('G12').check(seqOf([live, clearing, ['gen', 'c#1', 'active', 'lane']]))?.invariant).toBe('G12');
    expect(byName('G12').check(seqOf([live, clearing, ['gen', 'c#1', 'degraded', 'lane']]))?.invariant).toBe('G12');
    expect(byName('G12').check(seqOf([live, clearing, ['renew-call', 'c#1', 'reached', 'host'], ['gen', 'c#1', 'active', 'lane']]))).toBeNull();
    expect(byName('G12').check(seqOf([live, clearing, ['server', 'crash', 'down', 'sim'], ['gen', 'c#1', 'active', 'lane']]))).toBeNull();
    expect(byName('G12').check(seqOf([['arm', 'continuity', 'shadow', 'sim'], clearing, ['gen', 'c#1', 'active', 'lane']]))).toBeNull();
    // The second renewal of one generation is held to the same rule.
    expect(byName('G12').check(seqOf([live, clearing, ['renew-call', 'c#1', 'reached', 'host'], ['gen', 'c#1', 'active', 'lane'], clearing, ['gen', 'c#1', 'active', 'lane']]))?.invariant).toBe('G12');
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
/** The renewal acts' runner from a copy of `renewalActs.ts` with `old` replaced once by `now`, written under a temp directory and
 *  imported (relative imports made absolute, as `mutate.ts` does), so a mutant of the acts themselves reaches the scenario. */
async function mutantActs(old: string, now: string): Promise<typeof runRenewalActs> {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/renewalActs.ts');
  const source = readFileSync(file, 'utf8');
  if (source.split(old).length !== 2) throw new Error(`mutantActs: ${JSON.stringify(old)} does not occur exactly once`);
  const dir = mkTmp('ccrc-mutant-acts-');
  mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, 'renewalActs.ts');
  writeFileSync(copy, rewriteRelativeImports(source.replace(old, () => now), path.dirname(file)));
  return ((await import(/* @vite-ignore */ pathToFileURL(copy).href)) as { runRenewalActs: typeof runRenewalActs }).runRenewalActs;
}
type Observe = typeof observed.observeTime;
const withObserve = (f: Observe): GenDayModules => ({ ...REAL, observed: { ...observed, observeTime: f } });

describe('the generation day over seeded runs', () => {
  it('holds G1 to G12 on every seed and reaches every edge', async () => {
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

  it('MUTATION: a renewalFeed that offers every due as a hard one lets a soft due drain a degraded generation, and goes red on G7 within the CI seeds (review 1912, F9)', async () => {
    expect(await redSeed({ ...REAL, feed: { renewalFeed: (f) => feed.renewalFeed({ ...f, due: f.due === null ? null : { cls: 'hard' } }) } }, 'G7')).not.toBeNull();
  }, BOUND_MS);

  it('MUTATION: a renewal act that reads no receipt before a retry starts a second fresh conversation and goes red on G9 within the CI seeds (Task 5)', async () => {
    const acts = await mutantActs("if (tryN > 1) {", "if (tryN > 1 && false) {");
    expect(await redSeed({ ...REAL, acts }, 'G9')).not.toBeNull();
  }, BOUND_MS);
});
