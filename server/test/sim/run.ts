// Runs one scenario on the simulator's world, checks its invariants, and holds the seed-replay convention (Overlord
// spec §11.7). The convention, written once, here:
// - A sim test runs a fixed list of default seeds, 1 to 32 unless it says otherwise.
// - CCRC_SIM_SEED=<n> runs that one seed, and skips the coverage check (one seed need not reach every edge).
// - CCRC_SIM_SEEDS=<n> runs seeds 1 to n and the defaults, for a local soak. Neither is set in CI.
// - Any value of either variable that is not a positive safe integer throws, and so does setting both, so a typo never
//   runs zero seeds and passes.
// - A failure names the scenario, the seed, the invariant, the line, the replay command and the 20 lines before it.
// - A seed that found a defect becomes a unit row in the decider's own test file, with the inputs the trace shows. A
//   seed's meaning depends on the order of the scenario's draws, so the seed alone is not a regression test.
// - entropy.below, chance and pick each take exactly one draw. A scenario draws in a fixed order on each beat, whether
//   or not the draw is used, so adding a branch does not shift every later draw.
import type { Entropy } from '../../src/time/ports.js';
import { SimSequence, type Invariant, type SequenceLine, type Violation } from './sequence.js';
import { SimWorld } from './world.js';

export interface SimContext<E extends string> {
  readonly world: SimWorld; readonly seq: SimSequence; cover(edge: E): void;
  /** `world.server.entropy`: the fake's one seeded chance. */
  readonly entropy: Entropy;
}
export interface Scenario<E extends string> {
  readonly name: string; readonly startWallMs: number; readonly durationMs: number;
  /** Every edge the scenario must reach across its default seeds (Table 11.7b's reach coverage). */
  readonly edges: readonly E[];
  setup(ctx: SimContext<E>): void;
}
export interface SimResult<E extends string> {
  readonly seed: number; readonly lines: readonly SequenceLine[]; readonly covered: ReadonlySet<E>;
  readonly violations: readonly Violation[];
}

/** Replaces the six ambient time and randomness sources with throwers; returns the restore. */
function stubAmbient(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = {
    dateNow: Date.now, perfNow: performance.now, random: Math.random,
    setTimeout: g.setTimeout, setInterval: g.setInterval, setImmediate: g.setImmediate,
  };
  const refuse = (name: string) => (): never => { throw new Error(`ambient ${name} inside the simulator`); };
  const restore = (): void => {
    Date.now = saved.dateNow; performance.now = saved.perfNow; Math.random = saved.random;
    g.setTimeout = saved.setTimeout; g.setInterval = saved.setInterval; g.setImmediate = saved.setImmediate;
  };
  try {
    Date.now = refuse('Date.now');
    performance.now = refuse('performance.now');
    Math.random = refuse('Math.random');
    g.setTimeout = refuse('setTimeout');
    g.setInterval = refuse('setInterval');
    g.setImmediate = refuse('setImmediate');
  } catch (err) { restore(); throw err; }
  return restore;
}

export function simulate<E extends string>(s: Scenario<E>, seed: number, inv: readonly Invariant[]): SimResult<E> {
  const restore = stubAmbient();
  try {
    const world = new SimWorld({ wallMs: s.startWallMs, seed });
    const seq = new SimSequence(world.server.clock);
    const covered = new Set<E>();
    s.setup({ world, seq, cover: (edge) => { covered.add(edge); }, entropy: world.server.entropy });
    world.runUntil(s.durationMs);
    const warning = world.time.warnings[0];
    if (warning !== undefined) throw new Error(`scenario ${s.name}, seed ${seed}: ${warning}`);
    seq.append({ kind: 'sim', id: s.name, state: 'end', actor: 'sim' });
    const lines = seq.lines();
    const violations: Violation[] = [];
    for (const i of inv) {
      const v = i.check(lines);
      if (v !== null) violations.push(v);
    }
    return { seed, lines, covered, violations };
  } finally {
    restore();
  }
}

const DIGITS = /^[0-9]+$/;

function readSeed(vars: Readonly<Record<string, string | undefined>>, name: string): number | undefined {
  const raw = vars[name];
  if (raw === undefined) return undefined;
  const n = DIGITS.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive safe integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** The seeds a sim test runs: the defaults, one replayed seed, or a soak of 1..n plus the defaults. */
export function simSeeds(
  defaults: readonly number[], vars: Readonly<Record<string, string | undefined>> = process.env,
): number[] {
  const one = readSeed(vars, 'CCRC_SIM_SEED');
  const many = readSeed(vars, 'CCRC_SIM_SEEDS');
  if (one !== undefined && many !== undefined) throw new Error('CCRC_SIM_SEED and CCRC_SIM_SEEDS are both set; set one');
  if (one !== undefined) return [one];
  if (many !== undefined) {
    const out: number[] = [];
    for (let i = 1; i <= many; i++) out.push(i);
    return [...out, ...defaults.filter((d) => d > many || d < 1)];
  }
  return [...defaults];
}

export function replayCommand(testFile: string, seed: number): string {
  return `cd server && CCRC_SIM_SEED=${seed} ./node_modules/.bin/vitest run ${testFile}`;
}

function failureMessage(name: string, seed: number, v: Violation, lines: readonly SequenceLine[], testFile: string): string {
  const at = lines.findIndex((l) => l.seq === v.seq);
  const end = at < 0 ? lines.length : at + 1;
  const base = lines.length > 0 ? lines[0]!.at : 0;
  const tail = lines.slice(Math.max(0, end - 21), end)
    .map((l) => `  #${l.seq} +${l.at - base}ms ${l.kind} ${l.id} ${l.state} ${l.actor}`);
  return [
    `scenario ${name}, seed ${seed}: ${v.invariant}: ${v.message} (line ${v.seq})`,
    `replay: ${replayCommand(testFile, seed)}`,
    ...tail,
  ].join('\n');
}

/** Throws on the first seed with a violation, then on any edge no seed covered (skipped when the variables carry
 *  CCRC_SIM_SEED). The variables default to process.env. */
export function assertScenario<E extends string>(
  s: Scenario<E>, inv: readonly Invariant[],
  o: { readonly seeds: readonly number[]; readonly testFile: string; readonly env?: Readonly<Record<string, string | undefined>> },
): void {
  const vars = o.env ?? process.env;
  const covered = new Set<E>();
  for (const seed of o.seeds) {
    const r = simulate(s, seed, inv);
    const v = r.violations[0];
    if (v !== undefined) throw new Error(failureMessage(s.name, seed, v, r.lines, o.testFile));
    for (const e of r.covered) covered.add(e);
  }
  if (vars.CCRC_SIM_SEED !== undefined) return;
  const missing = s.edges.filter((e) => !covered.has(e));
  if (missing.length > 0) throw new Error(`scenario ${s.name}: never reached: ${missing.join(', ')}`);
}
