# Overlord W1a: the Simulator's Skeleton and the First Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax. This piece
> adds test code only. It follows the time-ports piece (`w1a-time-ports.md`), which must be merged first. It changes
> no lane, no route and no shipped behaviour.

**Goal:** a deterministic, seeded harness in `server/test/sim/` that drives pure deciders through the time-ports
piece's fake (`fakeTime`: its `Clock`, `Scheduler` and seeded `Entropy`) and checks invariants over the lines it
records, proved on a decider that ships today, with a seed-replay convention, mutation floors for new deciders, and
W0's model run from the suite.

**Why:** the Overlord design has six machines that interact: generations, holds, readiness and the breaker, the
ladder, grants and requests. A red test per guard proves each guard exists, not that the machines compose (H33).
§11.7 answers that with a small model, stateful property tests, a deterministic simulator and an invariant monitor.
W1a owes the simulator's skeleton and the mutation floors (Table 14), and this piece also brings in W0's model. Each
later wave then adds its machine as a scenario and its decider as a mutant set, with no new mechanism.

**Architecture:** none of the Overlord's deciders exist yet, so the skeleton proves itself on the stall watch's
coord-blocked arm, which carries an episode from sweep to sweep and loses it on a restart. A `SimWorld` wraps the
time-ports piece's fake clock and scheduler and adds only a crash and a skew between the server's wall clock and the
host's; the fake's seeded `Entropy` is the only chance; a scenario appends lines in the shape of `overlord_sequence`
(§10.4), so a predicate written here is the predicate the W1 invariant monitor runs. A small in-tree runner applies
textual mutants to a decider and runs a scenario against each.

**Tech Stack:** TypeScript and vitest in `server/`, no new dependency; Python 3's standard library for the model, run
by `python3 -I -B` from a vitest test.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` (#2491): §11.7 (Tables 11.7a and 11.7b: I1's shape is
the worked example's reach invariant), §11.5 ("Ports for time and chance") and Table 11.1c's `Clock`, `Scheduler`,
`Entropy` row (K, L2, given by L5, W1a), §10.4 (the line's shape), and §14, Table 14, W1a ("the ports for time and
chance; the simulator's skeleton; mutation floors for new deciders").

Not here: the ports, their rules, the fake clock, scheduler and seeded chance, the system adapters, the L5 wiring and
the ambient-call scan (the time-ports piece, merged first), `renewalDue` and its exhaustive test (the renewal piece),
the invariant monitor and `overlord_sequence` (W1), the real-lane simulator with SQLite and a fake agent link (W1 and
later, see D-TBD-sim-pure-deciders-first).

## What exists today

- **No property-test or mutation library.** No `package.json` names `fast-check` or Stryker; the only lockfile hit
  is a funding URL on `pure-rand` in `ui/package-lock.json`. This plan adds no dependency.
- **A seeded generator, nine times.** `mulberry32` is written out in nine server suites: `docs-grammar.test.ts` (the
  fuzz corpus, seed `0x5eed`), `child-reclaim-sweep-policy.test.ts` (its P0 row's 300 seeds),
  `child-reclaim-sweep.test.ts`, `child-reclaim-persistent-tier.test.ts`, `delegation-recovery.test.ts` (RB-PAR,
  inside a `describe`), `delegation-model.test.ts` (inside a `describe`), `delegation-correlation.test.ts` (seed
  `0x6268`), `delegation-correlation-cost.test.ts` and `delegation-correlation-bound.test.ts`, all under
  `server/test/`. Eight are one text up to hex case and digit separators; RB-PAR's reorders the same operations. Both
  spellings compute the same sequence (measured for seeds `0x5eed`, `1` and `0x6268`). The time-ports piece adds the
  one exported copy, in `server/test/fakeTime.ts`, and leaves the nine in place: their move onto it is this plan's
  (D-TBD-one-mulberry32).
- **The ports for time and chance come from the time-ports piece, merged first.** Today's `main` has no `Clock`,
  `Scheduler` or `Entropy`; its only clock shape is `server/src/laneRunner.ts#LaneClocks`, which that piece replaces
  with `Clock`. This plan imports what it exports and defines none of it again:
  - `server/src/time/ports.ts`: `Clock` (`wall()`, `mono()`); `Cancel`, a function (`() => void`), idempotent;
    `Scheduler` (`after(ms, fn: () => unknown): Cancel`, one-shot); `Entropy` (`hex(bytes)`, `uuid()`, and
    `below(n)`, a uniform integer in [0, n), RangeError for n outside [1, 2^32]); `TimePorts`
    (`{ clock, scheduler, entropy }`).
  - `server/test/fakeTime.ts`: `fakeTime({ wallMs?, monoMs?, seed? })` answers a `FakeTime` with `ports`,
    `warnings`, `advance(ms)`, `stepWall(deltaMs)`, `restart(gapMs)` and `pending()`; `FAKE_T0`; and
    `mulberry32(seed)`, the generator its entropy draws from, one unsigned 32-bit draw per `below`. Its `advance`
    fires calls in due order, equal dues in scheduling order, with both clocks at each one's due time. A call that
    throws or rejects becomes one `warnings` line, never an error to the caller.
- **Seeded property tests exist, ad hoc.** `child-reclaim-sweep-policy.test.ts`'s P0 row loops seeds 1 to 300 and
  names the seed in each assertion message. `delegation-recovery.test.ts`'s RB-PAR derives a step list from a seed.
  Neither has a replay switch or a shared harness.
- **How whole input domains are tested today.** `server/test/hibernate-verdict.test.ts` builds one base input that
  hibernates, then one case per member of `HIBERNATE_HOLDS` (`server/src/coord/hibernate.ts#HIBERNATE_HOLDS`), each
  changing one fact, held equal to the list. `server/test/stall-coord-blocked.test.ts` builds inputs from file-local
  factories and passes every clock as an argument. No shared helper enumerates a whole domain.
- **The worked example's decider.** `server/src/coord/stall.ts#stallCoordBlockedStep(input, now)` returns
  `{ verdict, episode }`; its input (`StallCoordBlockedInput`) is `{ session, child, runs, episode }`. The lane keeps
  the episode in memory (`server/src/watch.ts`, the field `stallCoordEpisodes`) and, for a run-less push, latches it
  in memory too, on `stall.ts#stallPushRoute`'s tag (the field `stallLatch`, slug
  `run-less-push-latches-are-in-memory`, D-3751), so a restart loses both. The sweep reads `now` from `Date.now()`
  and runs on the `stalls` row of `server/src/laneSchedule.ts#LANE_SCHEDULE`, every `STALL_SWEEP_MS` (60 000 ms) on
  the monotonic clock. Its documented contract: an episode runs while any mail to the coordinator stays held; its rung
  "never falls, so an escalation is never followed by a lower push"; "a server restart re-opens a standing episode
  and pushes it once more".
- **A Python mutation runner exists, for Python only.** `ccd/coordinator-skill/references/mutation-run.py`: textual
  `{id, old, new}` mutants, `old` must occur exactly once (else `invalid`, and the run exits 2), a baseline run first,
  statuses `killed`, `survived`, `uncovered`, `invalid` and `carried`. Task 5's TypeScript runner copies its contract
  for `killed`, `survived` and `invalid`, with no coverage trace and no carry.
- **Python in the test tree.** Tests already run `python3 -I` (`server/test/measure-continuity-pressure-kills.test.ts`)
  and `python3 -I -B` (`server/test/history-recall.test.ts`), and gate on `server/test/ccgptHarness.ts#pythonOrSkip`
  with `describe.skipIf(PY === null)` (`server/test/ccrc-doctorFixture.ts#describeCodex`). `-I` ignores
  `PYTHONDONTWRITEBYTECODE`, so only `-B` keeps a `__pycache__` out of the tree.
- **Merge-base reads.** `server/test/mergeBase.ts#mergeBaseText(cwd, rel)` reads a file at the merge-base with
  `origin/main`, or null when there is no `origin/main` or the file is not there. `citations.test.ts` uses the same
  module (`mergeBaseDiff`) for its ratchet.
- **The suite's budget.** `server/vitest.config.ts` sets `testTimeout` to 20 000 ms on Linux (90 000 ms on macOS)
  and includes `test/**/*.test.ts`, so `server/test/sim/` needs no config change.
- **Ring and context totality.** `server/test/rings/totality.test.ts` gives every non-test file under `server/src` one
  ring and one context, read from the `ring-context-map` block of
  `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`. Test code is outside the map, and this piece
  adds no `server/src` file, so it needs no row.
- **The first model, in the tree as research.** `docs/superpowers/research/2026-11-10-overlord-model-check/model.py` (1 228 lines) and `check.py` (648 lines), Python standard library
  only (`sys`, `time`, `array`, `collections`), an explicit-state breadth-first search over holds, readiness,
  generations, grants and restore, with 15 scenarios, 24 ambiguity switches and 14 planted mutations (12 expected to
  be caught, 2 marked "none expected"), and a bound of 3 000 000 states (`explore`'s `max_states`). Its headers cite
  an earlier draft of the spec, not this edition. Its matrix, measured 2026-11-10 on a dev laptop: at
  the defaults every scenario holds every invariant and ends under the bound. Ten finish in 1.1 s or less (push,
  pause, race, asks, value, lineage, nohold, deadpush, restore, rebind); core and grants take about 3 s; renewal,
  genmachine and readiness about 12 s each. The mutation table has not been re-run on this draft. An earlier draft
  measured `rebind MUTATION=no_fence` caught by I5. `python3 -I check.py` fails with
  `ModuleNotFoundError: No module named 'model'`, because `-I` drops the script's directory from `sys.path`.

## Global Constraints

- **Follows the time-ports piece.** `w1a-time-ports.md` is merged first. This plan defines no port, no fake clock or
  scheduler, no seeded generator and no second home for one. It imports `server/src/time/ports.ts` and
  `server/test/fakeTime.ts` and uses their names and shapes as they are.
- **Test first.** Every task writes its test and watches it go red before the code; a move has its characterization
  test green on the old code first.
- **One commit per task** unless a step says otherwise, on the workspace branch.
- **Touch only the files a task names.** Everything lives under `server/test/`.
- **Run one suite** from inside `server/`: `./node_modules/.bin/vitest run test/sim/<file>.test.ts`, in the
  foreground, timeout at least 600000 ms. Never bare `npx vitest`.
- **Cite code by symbol or anchor,** never by line.
- **No private names.** Fixture ids are neutral (`lane-a-coordinator`, `lane-a-worker`, `project-a`); the model's
  files carry none today, and keep none.
- **No D-numbers invented.** Departures are `D-TBD-<slug>` below; the programme mints the numbers.
- **The simulator imports only L0, L1 and L2** from `server/src` and `shared/`, never an L3 adapter, a store or
  `watch.ts`.
- **Every clock is an argument.** A scenario reads time and chance from its `SimWorld`'s ports only. Task 3's ambient
  guard makes any other read fail.

## Review Focus

1. **Nothing here defines time or chance again.** Task 1 changes imports only, and Task 2's world wraps `fakeTime`
   with the fake's own types and method names; no queue, port or generator is declared under `server/test/sim/`.
2. **A world event falls while the server is down.** It runs at its own time, before the boot, and no clock moves
   backwards. Task 2's downtime row.
3. **A decider that throws inside a scheduled call.** The fake turns the throw into a `warnings` line, so `simulate`
   throws on any warning, and the run fails. Task 3's throwing-call row.
4. **Both replay variables are set, or one is mistyped.** `simSeeds` throws rather than running zero seeds or
   picking one silently. Task 3's `simSeeds` row.
5. **A mutant that does not load.** A syntax error or a loader fault is `invalid`, never a kill, and a baseline that
   ran no case is a failure. Task 5's syntax row and the BASELINE row's case count.
6. **A failed scenario leaves the stubs in place.** `Date.now` and the timers are back after a run that threw. Task 3's
   last row.
7. **Running the model writes into the tree.** `-I` ignores `PYTHONDONTWRITEBYTECODE`, so `-B` is passed and no
   `__pycache__` appears beside the model. Task 6's bytecode row.

---

### Task 1: One seeded generator for the test tree

**Files:**
- Modify: the nine suites under "What exists today" (each: delete the local `mulberry32`, import the one in
  `server/test/fakeTime.ts`)
- Test: `server/test/sim/mulberry32.test.ts`

**Interfaces:**
- Consumes: `mulberry32(seed: number): () => number` from `server/test/fakeTime.ts` (the time-ports piece), with
  that name and signature.
- Produces: nothing new. This task changes imports only: it adds no generator and no home for one, and it does not
  edit `fakeTime.ts`.

- [ ] **Step 1: Characterization first.** Write the test against the copy `fakeTime.ts` exports. The values were
  measured on both of today's spellings, which agree:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../fakeTime.js';

describe('the one mulberry32 (D-TBD-one-mulberry32)', () => {
  it('draws the sequence the nine suites drew (pinned on the old copies)', () => {
    const a = mulberry32(0x5eed);
    expect([a(), a(), a(), a()]).toEqual([0.7100320369936526, 0.286336648510769, 0.9519026265479624, 0.10175976227037609]);
    const b = mulberry32(1);
    expect([b(), b(), b(), b()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]);
    const c = mulberry32(0x6268);
    expect([c(), c(), c(), c()]).toEqual([0.6481923549436033, 0.6919607364106923, 0.76711018034257, 0.8820702126249671]);
  });
});
```

  Run `./node_modules/.bin/vitest run test/sim/mulberry32.test.ts`. Expected: green (the time-ports piece copied it
  verbatim).
- [ ] **Step 2: Commit.** `test(sim): the one mulberry32's draws, pinned on today's nine copies`
- [ ] **Step 3: The move.** Run the nine suites and record each one's test count. In each, delete the local function
  (three sit inside a `describe` or a function) and add `import { mulberry32 } from './fakeTime.js';` at the top.
  Change nothing else. Run the nine files and `sim/mulberry32.test.ts`. Expected: green, with the recorded counts.
- [ ] **Step 4: Commit.** `refactor(test): the nine suites draw from fakeTime's mulberry32 (imports only)`

### Task 2: The world: a crash and a skew on the fake clock and scheduler

**Files:**
- Create: `server/test/sim/world.ts`
- Test: `server/test/sim/world.test.ts`

**Interfaces:**
- Consumes: `Clock`, `Scheduler`, `Cancel`, `Entropy`, `TimePorts` from `server/src/time/ports.ts`; `fakeTime` and
  `FakeTime` from `server/test/fakeTime.ts`.
- Produces:

```ts
/** The time-ports fake, plus what it has not: a crash that drops the server's timers and boots it again as a world
 *  event, and a skew between the server's wall clock and the host's. Mono starts at 0 and runs on across a crash. */
export class SimWorld {
  constructor(opts: { readonly wallMs: number; readonly seed: number });
  /** The one fake underneath: the host's clock, every timer, and the one seeded chance. */
  readonly time: FakeTime;
  /** What the server under test is handed: the host's clock with its wall skewed by skewWall(), a scheduler whose
   *  pending calls crash() cancels, and the fake's entropy. */
  readonly server: TimePorts;
  /** The world's own timer (the fleet, the operator, the coordinator): the fake's `after`. Survives crash(). */
  envAfter(ms: number, fn: () => unknown): Cancel;
  /** Registers a boot routine and runs it now; each boot after a crash runs every routine again. */
  onBoot(run: () => void): void;
  /** `time.advance` to the mono time untilMono: the fake runs every timer due by then, server and world alike, in
   *  (due time, scheduling order) order, with both clocks at each one's due time, then stands at untilMono. */
  runUntil(untilMono: number): void;
  /** The server dies now: its pending timers are cancelled, and the boot routines run again downMs later, as a world
   *  timer, so world timers due meanwhile run at their own times first. Throws while the server is down. */
  crash(downMs: number): void;
  /** True from a crash until its boot routines have run. */
  isDown(): boolean;
  /** From now on the server's wall clock reads ms earlier than the host's. Mono and the host clock are untouched. A
   *  step of the one wall clock, for both, is the fake's own `time.stepWall`. */
  skewWall(ms: number): void;
}
/** True with probability p: `entropy.below(2 ** 32) < p * 2 ** 32`. One draw. */
export function chance(entropy: Entropy, p: number): boolean;
/** `xs[entropy.below(xs.length)]`. One draw; an empty list throws the fake's RangeError. */
export function pick<T>(entropy: Entropy, xs: readonly T[]): T;
```

  An integer draw is `entropy.below(n)` itself; the world adds no helper for it.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, it, expect } from 'vitest';
import { fakeTime } from '../fakeTime.js';
import { SimWorld, chance, pick } from './world.js';

const T0 = Date.parse('2026-10-12T00:00:00Z');
const world = (): SimWorld => new SimWorld({ wallMs: T0, seed: 1 });

describe('the simulator world, on the time-ports fake', () => {
  it('server and world timers due at the same instant run in the order they were scheduled', () => {
    const w = world(); const ran: string[] = [];
    w.server.scheduler.after(60_000, () => ran.push('a')); w.envAfter(60_000, () => ran.push('b'));
    w.server.scheduler.after(60_000, () => ran.push('c'));
    w.runUntil(60_000);
    expect(ran).toEqual(['a', 'b', 'c']);
  });
  it('runUntil moves both clocks to each timer, then to its end', () => {
    const w = world(); const c = w.server.clock; const seen: [number, number][] = [];
    w.server.scheduler.after(30_000, () => seen.push([c.wall(), c.mono()]));
    w.runUntil(90_000);
    expect(seen).toEqual([[T0 + 30_000, 30_000]]);
    expect([c.wall(), c.mono()]).toEqual([T0 + 90_000, 90_000]);
  });
  it('a cancelled server timer never runs', () => {
    const w = world(); let ran = false;
    const cancel = w.server.scheduler.after(10, () => { ran = true; }); cancel(); w.runUntil(20);
    expect(ran).toBe(false);
  });
  it('crash(600_000) drops server timers, keeps world timers and boots again 600 000 ms later', () => {
    const w = world(); const ran: string[] = [];
    w.onBoot(() => ran.push(`boot ${w.server.clock.mono()}`));
    w.server.scheduler.after(1_000_000, () => ran.push('server')); w.envAfter(1_000_000, () => ran.push('world'));
    w.crash(600_000);
    expect(w.isDown()).toBe(true);
    expect(() => w.crash(1)).toThrow(/down/);
    w.runUntil(2_000_000);
    expect(ran).toEqual(['boot 0', 'boot 600000', 'world']);
    expect(w.isDown()).toBe(false);
  });
  it('a world timer due while the server is down runs at its own time, before the boot', () => {
    const w = world(); const c = w.server.clock; const seen: [string, number, number][] = [];
    w.onBoot(() => seen.push(['boot', c.wall(), c.mono()]));
    w.envAfter(300_000, () => seen.push(['world', c.wall(), c.mono()]));
    w.crash(600_000); w.runUntil(600_000);
    expect(seen).toEqual([['boot', T0, 0], ['world', T0 + 300_000, 300_000], ['boot', T0 + 600_000, 600_000]]);
  });
  it('skewWall(5_000) moves the server\'s wall back and leaves mono and the host clock alone', () => {
    const w = world(); w.skewWall(5_000);
    expect([w.server.clock.wall(), w.server.clock.mono(), w.time.ports.clock.wall()]).toEqual([T0 - 5_000, 0, T0]);
  });
  it('server and world timers refuse a delay the fake refuses', () => {
    const w = world();
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => w.server.scheduler.after(ms, () => {})).toThrow(RangeError);
      expect(() => w.envAfter(ms, () => {})).toThrow(RangeError);
    }
  });
  it('the server is handed the fake\'s one seeded chance', () => {
    const w = world();
    expect(w.server.entropy).toBe(w.time.ports.entropy);
  });
  it('chance and pick each take exactly one draw through below', () => {
    expect(chance(fakeTime({ seed: 1 }).ports.entropy, 0.5)).toBe(false);          // 2693262067 is not below 2 ** 31
    expect(pick(fakeTime({ seed: 1 }).ports.entropy, ['a', 'b', 'c', 'd'])).toBe('c'); // floor(2693262067 * 4 / 2 ** 32)
    const e = fakeTime({ seed: 1 }).ports.entropy; chance(e, 0.5);
    expect(e.below(2 ** 32)).toBe(11749833);                                         // the second draw
    expect(() => pick(e, [])).toThrow(RangeError);
  });
});
```

  The draws are the fake's golden values for seed 1 (`w1a-time-ports.md`, Task 3). Run
  `./node_modules/.bin/vitest run test/sim/world.test.ts`. Expected: red (no module).
- [ ] **Step 2: Implement.** Build one `fakeTime({ wallMs, seed })` as `time`. `server.clock` reads
  `time.ports.clock`, with the skew taken off `wall()`. `server.scheduler.after(ms, fn)` hands
  `time.ports.scheduler.after` a call that first forgets its own Cancel and then returns `fn()`; it keeps that Cancel
  in a live set and returns a Cancel that forgets it and calls the fake's. `server.entropy` is `time.ports.entropy`.
  `envAfter` is `time.ports.scheduler.after`, untracked. `crash` calls every Cancel in the live set, clears it, sets
  the down flag and queues the boot with `time.ports.scheduler.after(downMs, ...)`; the boot runs every routine, then
  clears the flag. `runUntil(untilMono)` is `time.advance(untilMono - time.ports.clock.mono())`. `chance` and `pick`
  are one line each over `below`. The world keeps no queue, no tie order and no generator of its own: the fake orders
  every timer and draws every number.
- [ ] **Step 3: Run it.** Expected: green.
- [ ] **Step 4: The guards' mutations.** Give `envAfter` a queue of its own, run after each `time.advance`: the first
  row goes red (`['a', 'c', 'b']`). Make `crash` keep server timers: the crash row goes red. Make `crash` call
  `time.restart(downMs)` instead of queueing the boot: the downtime row goes red. Drop the down check in `crash`: the
  crash row goes red. Apply the skew with `time.stepWall(-ms)`: the skew row goes red. Make `chance` draw twice: the
  one-draw row goes red.
- [ ] **Step 5: Commit.** `test(sim): the world on the time-ports fake, with a crash and a server clock skew`

### Task 3: The sequence, invariants, `simulate`, and the seed-replay convention

**Files:**
- Create: `server/test/sim/sequence.ts`, `server/test/sim/run.ts`
- Test: `server/test/sim/run.test.ts`

**Interfaces:**
- Consumes: `SimWorld` and `chance` (Task 2); `Clock` and `Entropy` from `server/src/time/ports.ts`.
- Produces:

```ts
// sequence.ts: the line has overlord_sequence's shape (§10.4): ids, kinds, states and actors only, never a body.
export interface SequenceLine {
  readonly seq: number; readonly at: number; readonly kind: string; readonly id: string; readonly state: string;
  readonly actor: string;
}
export type LineInput = Omit<SequenceLine, 'seq' | 'at'>;
export class SimSequence {
  constructor(clock: Clock);
  append(line: LineInput): SequenceLine;     // seq from 1, at = clock.wall()
  lines(): readonly SequenceLine[];
}
export interface Violation { readonly invariant: string; readonly seq: number; readonly message: string }
/** A predicate over the whole sequence; the first violation, or null. */
export interface Invariant {
  readonly name: string; readonly says: string; check(lines: readonly SequenceLine[]): Violation | null;
}

// run.ts
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
export function simulate<E extends string>(s: Scenario<E>, seed: number, inv: readonly Invariant[]): SimResult<E>;
export function simSeeds(defaults: readonly number[], env?: Readonly<Record<string, string | undefined>>): number[];
export function replayCommand(testFile: string, seed: number): string;
/** Throws on the first seed with a violation, then on any edge no seed covered (skipped when env.CCRC_SIM_SEED is
 *  set). `env` defaults to process.env. */
export function assertScenario<E extends string>(
  s: Scenario<E>, inv: readonly Invariant[],
  o: { readonly seeds: readonly number[]; readonly testFile: string; readonly env?: Readonly<Record<string, string | undefined>> },
): void;
```

`simulate` builds `new SimWorld({ wallMs: s.startWallMs, seed })` and a `SimSequence` on `world.server.clock`, runs
`setup`, then `world.runUntil(s.durationMs)`. If the fake recorded a warning (a scheduled call threw, and the fake
caught it), `simulate` throws `scenario <name>, seed <n>: <the first warning>`, so a decider's throw fails the run.
Otherwise it appends `{ kind: 'sim', id: s.name, state: 'end', actor: 'sim' }` and runs every invariant over the
lines. From before `setup` until after the last check, it replaces `Date.now`, `performance.now`, `Math.random`,
`setTimeout`, `setInterval` and `setImmediate` with functions that throw `ambient <name> inside the simulator`, and
restores them in a `finally`. `new Date()` with no argument is not caught here; the time-ports piece's static scan
(`ambientUses`) catches it in the new modules it scopes.

**The seed-replay convention** (written once, in `run.ts`'s header):
- A sim test runs a fixed list of default seeds, `1` to `32` unless it says otherwise.
- `CCRC_SIM_SEED=<n>` runs that one seed, and skips the coverage check (one seed need not reach every edge).
- `CCRC_SIM_SEEDS=<n>` runs seeds `1` to `n` and the defaults, for a local soak. Neither is set in CI.
- Any value of either variable that is not a positive safe integer throws, and so does setting both, so a typo never
  runs zero seeds and passes.
- A failure names the scenario, the seed, the invariant, the line, the replay command and the 20 lines before it.
- A seed that found a defect becomes a unit row in the decider's own test file, with the inputs the trace shows. A
  seed's meaning depends on the order of the scenario's draws, so the seed alone is not a regression test.
- `entropy.below`, `chance` and `pick` each take exactly one draw. A scenario draws in a fixed order on each beat,
  whether or not the draw is used, so adding a branch does not shift every later draw.

- [ ] **Step 1: Write the failing tests.** A toy scenario `coin`, test-local, of type `Scenario<CoinEdge>` with
  `CoinEdge` `'heads' | 'tails'`: every minute (`world.envAfter`, each beat scheduling the next), it appends
  `{ kind: 'coin', id: 'c', state, actor: 'sim' }` with `state` `heads` when `chance(entropy, 0.5)` is true and
  `tails` otherwise, and covers that state; it lasts one hour; edges `['heads', 'tails']`.

```ts
it('the same seed gives the same lines, twice', () => {
  expect(simulate(coin, 7, []).lines).toEqual(simulate(coin, 7, []).lines);
});
it('two seeds give different lines', () => {
  expect(simulate(coin, 1, []).lines).not.toEqual(simulate(coin, 2, []).lines);
});
it('simSeeds: the defaults, one replayed seed, a soak, and a typo', () => {
  expect(simSeeds([5, 6], {})).toEqual([5, 6]);
  expect(simSeeds([5, 6], { CCRC_SIM_SEED: '17' })).toEqual([17]);
  expect(simSeeds([5], { CCRC_SIM_SEEDS: '3' })).toEqual([1, 2, 3, 5]);
  expect(() => simSeeds([5], { CCRC_SIM_SEED: 'x' })).toThrow(/CCRC_SIM_SEED/);
  expect(() => simSeeds([5], { CCRC_SIM_SEEDS: '0' })).toThrow(/CCRC_SIM_SEEDS/);
  expect(() => simSeeds([5], { CCRC_SIM_SEED: '1', CCRC_SIM_SEEDS: '3' })).toThrow(/CCRC_SIM_SEED/);
});
it('a violation names the scenario, seed, invariant, line and replay command', () => {
  const neverTails: Invariant = { name: 'never-tails', says: 'no tails', check: (ls) => {
    const l = ls.find((x) => x.state === 'tails'); return l ? { invariant: 'never-tails', seq: l.seq, message: 'tails' } : null; } };
  expect(() => assertScenario(coin, [neverTails], { seeds: [1], testFile: 'test/sim/run.test.ts', env: {} })).toThrow(
    /scenario coin, seed 1: never-tails: tails \(line \d+\)\nreplay: cd server && CCRC_SIM_SEED=1 \.\/node_modules\/\.bin\/vitest run test\/sim\/run\.test\.ts/);
});
it('an edge no seed reaches is red, and names the edge', () => {
  const never = { ...coin, edges: ['heads', 'tails', 'edge'] as const };
  expect(() => assertScenario(never, [], { seeds: [1, 2, 3], testFile: 't', env: {} })).toThrow(/never reached: edge/);
  expect(() => assertScenario(never, [], { seeds: [1], testFile: 't', env: { CCRC_SIM_SEED: '1' } })).not.toThrow();
});
it.each(['Date.now', 'performance.now', 'Math.random', 'setTimeout'])('the ambient guard refuses %s', (name) => {
  const bad = { ...coin, setup: () => { AMBIENT_CALLS[name]!(); } };
  expect(() => simulate(bad, 1, [])).toThrow(`ambient ${name} inside the simulator`);
});
it('a scheduled call that throws fails the run, not only a warning line', () => {
  const bad = { ...coin, setup: (ctx: SimContext<CoinEdge>) => {
    ctx.world.server.scheduler.after(1, () => { throw new Error('boom'); }); } };
  expect(() => simulate(bad, 1, [])).toThrow('scenario coin, seed 1: ccrc-server: a scheduled call failed: boom');
});
it('the real functions are back after a run, a failed one included', () => {
  const now = Date.now; const bad = { ...coin, setup: () => { throw new Error('boom'); } };
  expect(() => simulate(bad, 1, [])).toThrow('boom');
  expect(Date.now).toBe(now);
});
```

  `AMBIENT_CALLS` is a test-local record from each name to a call of it. Run
  `./node_modules/.bin/vitest run test/sim/run.test.ts`. Expected: red (no module).
- [ ] **Step 2: Implement** `sequence.ts` and `run.ts` to the signatures above.
- [ ] **Step 3: Run it.** Expected: green.
- [ ] **Step 4: The guards' mutations.** Drop the `Date.now` stub: its `it.each` row goes red. Ignore the fake's
  warnings: the throwing-call row goes red. Move the restore out of the `finally`: the last row goes red. Make
  `simSeeds` return `[]` on a bad value: the typo row goes red. Let `CCRC_SIM_SEED` win when both are set: the same
  row goes red. Drop the coverage check: the edge row goes red.
- [ ] **Step 5: Commit.** `test(sim): one sequence, invariants as predicates, and the seed-replay convention`

### Task 4: The worked example: the coord-blocked arm over a seeded day

**Files:**
- Create: `server/test/sim/coordBlockedDay.ts` (the scenario, its edges and its invariants)
- Test: `server/test/sim/stall-coord-blocked-day.test.ts`

**Interfaces:**
- Consumes: `stallCoordBlockedStep`, `stallPushRoute`, `COORD_BLOCKED_HELD_MS`, and the types
  `StallCoordBlockedInput`, `StallSessionInput`, `StallChildFact`, `StallCoordEpisode`, `StallMailRow`,
  `StallDeliveryRow`, `StallRunRow`, `StallWorker`, `TurnMark`, `TurnMarkRead` from `server/src/coord/stall.ts`;
  `STALL_SWEEP_MS` from `server/src/laneSchedule.ts`; `SimWorld`, `chance` and `pick` (Task 2); Task 3.
- Produces:

```ts
/** The decider's module, passed in so that Task 5 can hand a mutant to the same scenario. */
export type CoordBlockedModule = Pick<typeof import('../../src/coord/stall.js'), 'stallCoordBlockedStep' | 'stallPushRoute'>;
export const COORD_BLOCKED_EDGES = ['rung-1', 'rung-2', 'rung-2-direct', 'held', 'episode-closed',
  'reopened-after-boot', 'stretch-ended-while-held'] as const;
export type CoordBlockedEdge = (typeof COORD_BLOCKED_EDGES)[number];
export function coordBlockedDay(mod: CoordBlockedModule): Scenario<CoordBlockedEdge>;
export const COORD_BLOCKED_INVARIANTS: readonly Invariant[];   // CB-reach, CB-rung-never-falls
```

**The scenario.** One coordinator, `lane-a-coordinator`, claiming one active work run (id 67, state `working`,
worker `lane-a-worker`, project `project-a`), child marker `{ kind: 'none' }`, arming
`{ disabled: false, live: true, escalate: true }`. Its worker fact is `present: true`, lifecycle `running`, limits
null, no dialog, not stranded or swap-blocked, no ask, no auto-continue hold, `unmeasured` from the link, and a live
word `{ ok: true, word, since: stamp }`; `liveStartedAt` is the scenario's start, so a marker written after it is
current. It starts at `2026-10-12T00:00:00Z` and lasts 24 hours.
- **Durable state** (survives a crash): the mail rows, the delivery rows, the link, and the coordinator's word, its
  stamp and its turn marker.
- **Volatile state** (lost on a crash), held in the boot routine's closure as `watch.ts` holds it: the episode, the
  push latch (a set of `stallPushRoute(verdict, coordinator, null).tag`, as `stallLatch`), and what the last sweep
  saw (for the `held` and `verdict` lines).
- **The lane** (`world.onBoot`): on each boot, start with no episode and an empty latch, and schedule a sweep at once
  (`world.server.scheduler.after(0, ...)`), then every `STALL_SWEEP_MS`, each sweep scheduling the next. A sweep
  builds the input from the state, calls `mod.stallCoordBlockedStep(input, world.server.clock.wall())`, keeps the
  episode, and applies the verdict: a `notify` whose tag is not latched is latched and pushed.
- **The world**, a beat every 5 minutes (`world.envAfter`, each beat scheduling the next), six draws on the context's
  `entropy` in this order, every one taken on every beat whether or not it is used:
  1. `chance(entropy, 0.25)`: the worker queues a `question` mail to the coordinator, with a `queued` delivery.
  2. `chance(entropy, 0.2)`: the word changes, with its stamp at now, to
  3. `pick(entropy, ['busy-turn', 'busy-background', 'waiting', 'idle', 'idle-blocked'])`. `busy-turn` is live `busy`
     over a current `working` marker (its `turnAt` the stamp); `busy-background` is `busy` over a current `done`
     marker; `waiting` is live `waiting`; `idle` is live `idle`; `idle-blocked` is live `idle` that does not receive
     mail (input text). A pick equal to the current word changes nothing.
  4. `chance(entropy, 0.01)`: the agent link flips between measured and unmeasured (`worker.unmeasured`), which is
     hold 1.
  5. `chance(entropy, 0.007)`: the server crashes (`world.crash`), unless it is already down,
  6. for `entropy.below(11)` minutes.

  After the draws, with no draw of its own: when the word is `idle` and the server is up (`!world.isDown()`), every
  queued delivery becomes `delivered`, as the mail lane would deliver it.
- **The lines** the scenario appends (kind, id, state, actor):
  `mail <mailId> queued|delivered worker|gate`; `word <coord> <word> coordinator`; `link <coord> measured|unmeasured
  sim`; `server boot up sim` (from the boot routine); `held <coord> some|none stalls` (when a sweep's held set changes
  between empty and not); `episode <key> open|closed stalls`; `verdict <coord> none|hold|rung-1|rung-2 stalls` (on
  change only); `push <key> rung-1|rung-2 stalls`.
- **The edges:** `rung-1` and `rung-2` on a push of that rung; `rung-2-direct` on a rung-2 push for a key with no
  rung-1 push before it; `held` on a `hold` verdict; `episode-closed` on an episode going to null;
  `reopened-after-boot` on the first sweep after a boot opening an episode whose key was pushed before the crash;
  `stretch-ended-while-held` on a sweep that finds the word `idle` or `idle-blocked` and some mail held, in an
  episode that has pushed rung 2.

**The invariants.** Each is evaluated at every line before the line is applied, and at the `sim end` line.

```ts
// CB-reach (I1's shape, fails towards the operator): a mail held past the threshold reaches the operator
// within one sweep, unless the link is unmeasured. The clock restarts at a boot and at a re-measured link.
// State while scanning: queued (mail id to queue time), pushedSinceNothingHeld (starts false), steadySince (starts
// at the first line's time), measured (starts true). `mail queued` adds, `mail delivered` removes; `held none`
// resets pushedSinceNothingHeld; `push` sets it; `server boot` and `link measured` set steadySince.
// Violation at line L: measured && !pushedSinceNothingHeld && some queued m with
//   L.at > Math.max(m + COORD_BLOCKED_HELD_MS, steadySince) + STALL_SWEEP_MS.
// CB-rung-never-falls (the decider's own contract): between two `server boot` lines, inside one open
// episode (from its `episode <key> open` line to its `closed` line), no `verdict rung-1` line follows a
// `verdict rung-2` line.
```

Each violation's `seq` is the line it was found at; its message names the mail id (CB-reach) or the episode key
(CB-rung-never-falls).

- [ ] **Step 1: Write the test, the control rows first.**

```ts
const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const FILE = 'test/sim/stall-coord-blocked-day.test.ts';
describe('the coord-blocked arm over a seeded day (Overlord W1a worked example, §11.7)', () => {
  it('CONTROL: CB-reach goes red on a mail held 31 minutes with no push', () => {
    const lines = seqOf([['mail', '1', 'queued', 'worker', 0], ['held', C, 'some', 'stalls', 60_000],
      ['sim', 'x', 'end', 'sim', COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS + 1]]);
    expect(byName('CB-reach').check(lines)?.invariant).toBe('CB-reach');
  });
  it('CONTROL: CB-reach stays green while the link is unmeasured', () => {
    const lines = seqOf([['link', C, 'unmeasured', 'sim', 0], ['mail', '1', 'queued', 'worker', 0],
      ['held', C, 'some', 'stalls', 60_000], ['sim', 'x', 'end', 'sim', COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS + 1]]);
    expect(byName('CB-reach').check(lines)).toBeNull();
  });
  it('CONTROL: CB-rung-never-falls goes red on rung-2 then rung-1 in one episode, and not across a boot', () => {
    const open: Row = ['episode', '0', 'open', 'stalls', 0];
    const two: Row = ['verdict', C, 'rung-2', 'stalls', 60_000];
    const one: Row = ['verdict', C, 'rung-1', 'stalls', 180_000];
    expect(byName('CB-rung-never-falls').check(seqOf([open, two, one]))?.invariant).toBe('CB-rung-never-falls');
    const boot: Row = ['server', 'boot', 'up', 'sim', 120_000];
    const reopen: Row = ['episode', '0', 'open', 'stalls', 120_000];
    expect(byName('CB-rung-never-falls').check(seqOf([open, two, boot, reopen, one]))).toBeNull();
  });
  it('holds both invariants on every seed, and the seeds reach every edge', () => {
    assertScenario(coordBlockedDay(stall), COORD_BLOCKED_INVARIANTS, { seeds: simSeeds(SEEDS), testFile: FILE });
  });
});
```

  Test-local: `type Row = [kind: string, id: string, state: string, actor: string, atOffset: number]`; `seqOf` builds
  lines from rows with `seq` from 1 and `at` = start + `atOffset`; `C` is `'lane-a-coordinator'`; `byName(n)` is the
  member of `COORD_BLOCKED_INVARIANTS` named `n`; `stall` is `import * as stall from '../../src/coord/stall.js'`. Run
  `./node_modules/.bin/vitest run test/sim/stall-coord-blocked-day.test.ts`. Expected: red (no module).
- [ ] **Step 2: Implement** `coordBlockedDay.ts`. Build the input from the state with small builders of its own; do
  not import the factories of `stall-coord-blocked.test.ts`, which are file-local.
- [ ] **Step 3: Run it.** Expected: the control rows green. If the seeded row reports an edge never reached, change
  the world's probabilities, never the edge list, and say which in the PR. If it reports a violation, replay the seed
  with `CCRC_SIM_SEED=<n>` and read the 20 lines: a violation on today's decider is a finding (see "Where things
  stand", question 2), reported before anything is changed.
- [ ] **Step 4: Measure the mutations, by hand, before and after.** Each edit is to `server/src/coord/stall.ts`, made
  and reverted in the working tree, never committed. Record the red invariant and the seed in the PR body.

| Id | Edit | Expected red |
|---|---|---|
| M1 | `if (now - oldest.since < COORD_BLOCKED_HELD_MS) return 0;` to `... < COORD_BLOCKED_OLD_MS) return 0;` | CB-reach |
| M2 | `Math.max(prev.rung, stallCoordRungNow(si, oldest, now))` to `stallCoordRungNow(si, oldest, now)` | CB-rung-never-falls |
| M3 | `input.episode ?? { since: oldest.since, rung: 0 }` to `{ since: oldest.since, rung: 0 }` | CB-rung-never-falls |
| M4 | `if (oldest === undefined) return closed;` to `if (oldest === undefined) return { verdict: VERDICT_NONE, episode: input.episode };` | CB-reach |

  Each `old` text occurs exactly once in `stall.ts` today (checked). M2 and M3 are only red on a seed that reaches
  `stretch-ended-while-held` with its oldest held mail under `COORD_BLOCKED_OLD_MS`, which is why that edge is
  asserted. M4 is red on a seed where an episode that pushed closes and new mail is then held past the threshold in
  the same boot: the kept episode re-uses the old, latched key.
- [ ] **Step 5: Commit.** `test(sim): the coord-blocked arm driven for a seeded day, its reach and rung invariants`

### Task 5: Mutation floors for deciders

**Files:**
- Create: `server/test/sim/mutate.ts`, `server/test/sim/mutation-floors.json`
- Test: `server/test/sim/mutation-floors.test.ts`

**Interfaces:**
- Consumes: `mkTmp` from `server/test/tmpHelpers.ts`; `mergeBaseText` from `server/test/mergeBase.ts`; Task 4's
  `coordBlockedDay`, `COORD_BLOCKED_INVARIANTS`, `CoordBlockedModule`; `simulate` (Task 3).
- Produces:

```ts
export interface Mutant { readonly id: string; readonly old: string; readonly new: string }
export type MutantStatus = 'killed' | 'survived' | 'invalid';
export interface MutantResult { readonly id: string; readonly status: MutantStatus; readonly detail: string }
/** score = killed / results.length; baselineCases = the suite cases the unmutated copy ran and passed. */
export interface MutationReport {
  readonly results: readonly MutantResult[]; readonly score: number; readonly baselineCases: number;
}
export interface MutantSet<M> {
  readonly modulePath: string; readonly mutants: readonly Mutant[];
  suite(mod: M): Readonly<Record<string, () => void>>;   // method syntax, so sets of different M share one record
}
/** Relative `from '…'` and `import('…')` specifiers become absolute file URLs, resolved against fromDir. */
export function rewriteRelativeImports(source: string, fromDir: string): string;
/** mutation-run.py's contract in TypeScript: `old` must occur exactly once; a baseline copy must pass first, else it
 *  throws; each mutant is written under one mkTmp directory, imported, and handed to `suite`; a suite case that
 *  throws kills it. A mutant whose `old` is absent or repeated, or whose copy fails to import, is `invalid`, and the
 *  run then throws `invalid: <id>: <detail>` after the last mutant. */
export async function runMutants<M>(set: MutantSet<M>): Promise<MutationReport>;
/** The keys whose floor fell from `was` to `now`, a missing key included. */
export function floorsFallen(was: Readonly<Record<string, number>>, now: Readonly<Record<string, number>>): string[];
```

`mutation-floors.json` holds one score per decider, keyed `<path>#<symbol>`:
`{ "server/src/coord/stall.ts#stallCoordBlockedStep": 1 }`. The mutant lists live in the test file as one record,
`MUTANT_SETS: Record<string, MutantSet<never>>`, whose keys are the floors' keys. The first set, `KEY`
(`server/src/coord/stall.ts#stallCoordBlockedStep`), is M1 to M4 from Task 4, typed `MutantSet<CoordBlockedModule>`;
its suite has one case per default seed, each throwing when `simulate(coordBlockedDay(mod), seed,
COORD_BLOCKED_INVARIANTS)` reports a violation. Test-local: `FLOORS` is the parsed JSON, `ROOT` the repository root.

- [ ] **Step 1: Write the failing tests.**

```ts
it('rewriteRelativeImports makes ./ and ../ absolute and leaves bare specifiers', () => {
  const out = rewriteRelativeImports(`import { a } from '../x.js';\nimport b from 'node:fs';\n`, '/r/src/coord');
  expect(out).toContain(`from '${pathToFileURL('/r/src/x.js').href}'`);
  expect(out).toContain(`from 'node:fs'`);
});
it('BASELINE: an unmutated copy loaded the same way runs and passes every suite case', async () => {
  const r = await runMutants({ ...MUTANT_SETS[KEY]!, mutants: [] });
  expect([r.results, r.baselineCases]).toEqual([[], 32]);
}, 60_000);
it('a mutant whose old text is absent is invalid, and the run throws', async () => {
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [{ id: 'x', old: 'no such text', new: '' }] }))
    .rejects.toThrow(/invalid: x/);
}, 60_000);
it('a mutant that does not compile is invalid, never killed', async () => {
  const old = 'if (oldest === undefined) return closed;';
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [{ id: 'syntax', old, new: 'if (' }] }))
    .rejects.toThrow(/invalid: syntax/);
}, 60_000);
it.each(Object.keys(MUTANT_SETS))('%s: every mutant is killed, and the score is at least its floor', async (key) => {
  const r = await runMutants(MUTANT_SETS[key]!);
  expect(r.results.filter((x) => x.status !== 'killed')).toEqual([]);
  expect(r.score).toBeGreaterThanOrEqual(FLOORS[key]!);
}, 120_000);
it('the floors and the mutant sets name the same deciders', () => {
  expect(Object.keys(FLOORS).sort()).toEqual(Object.keys(MUTANT_SETS).sort());
});
it('CONTROL: floorsFallen names a lowered floor and a removed one, and nothing else', () => {
  expect(floorsFallen({ a: 1, b: 0.5, c: 0.5 }, { a: 0.75, b: 0.75 })).toEqual(['a', 'c']);
});
it('no floor falls below its value at the merge-base with origin/main', () => {
  const base = mergeBaseText(ROOT, 'server/test/sim/mutation-floors.json');
  if (base === null) { console.warn('mutation-floors: no floors file at the merge-base with origin/main, skipped'); return; }
  expect(floorsFallen(JSON.parse(base) as Record<string, number>, FLOORS)).toEqual([]);
});
```

  Run `./node_modules/.bin/vitest run test/sim/mutation-floors.test.ts`. Expected: red (no module).
- [ ] **Step 2: Implement** `mutate.ts`. The baseline runs the suite on an unmutated copy under the same rewrite and
  directory, so a loader fault reads as a failed baseline, never as a kill. Every temp file is under one `mkTmp`
  directory, which the run tmp parent removes.
- [ ] **Step 3: Run it.** Expected: green, M1 to M4 killed, score 1. If the vitest transform does not resolve the
  `file:` URLs, rewrite to absolute paths instead (and the first row's expectation with them). If it refuses a module
  outside the package root either way, stop and report: the fallback is a `.mutant-<id>.ts` sibling, which writes
  into the tree and needs a ruling first.
- [ ] **Step 4: The guards' mutations.** Make `floorsFallen` ignore a missing key: the CONTROL row goes red. Add a
  floor key with no set: the naming row goes red. Make `runMutants` skip the baseline: the BASELINE row goes red.
  Count an import failure as a kill: the syntax row goes red. Break the rewrite (leave the specifiers relative): the
  BASELINE row goes red. The ratchet row itself first bites on the pull request after this one, when the floors file
  exists at the merge-base.
- [ ] **Step 5: Commit.** `test(sim): mutation floors for deciders, a score per decider that only rises`

**How a later wave uses this.** A new L1 decider (`renewalDue`, `mayHold`, `overlordReadiness`, ...) adds one entry to
`MUTANT_SETS` (its module, its textual mutants, its exhaustive test or scenario as the suite) and one floor, measured
at its merge. A mutant that survives is either killed by a new test row or removed with a one-line reason in the PR.

### Task 6: The first model, in the test tree

Waits for W0's model, revised to this edition ("Where things stand", question 1).

**Files:**
- Create: `server/test/model/overlord/model.py`, `server/test/model/overlord/check.py` (W0's files)
- Modify: `check.py`: insert its own directory into `sys.path` before `import model`; add `--json`; exit 3 on the
  state bound
- Test: `server/test/overlord-model.test.ts`

**Interfaces:**
- Consumes: `pythonOrSkip` from `server/test/ccgptHarness.ts`.
- Produces: `python3 -I -B check.py --json SCENARIO [KEY=VALUE ...]` prints one JSON object
  `{"scenario": str, "overrides": {...}, "states": int, "transitions": int, "violated": [str, ...]}` and exits 0; on
  `state bound exceeded` it prints `{"scenario": str, "bound": true}` and exits 3. `check.py --json --mutations`
  prints one JSON array of `{"mutation": str, "scenario": str, "expected": str, "caught": [str, ...]}`, `caught` being
  the violations new against the unmutated run, as the table's "caught by" column is today. `--list` is unchanged.

- [ ] **Step 1: Write the failing test.** `FAST` is the scenarios W0's final matrix measures at 1.1 s or less at the
  defaults; on today's draft, `['push', 'pause', 'race', 'asks', 'value', 'lineage', 'nohold', 'deadpush', 'restore',
  'rebind']`.

```ts
const PY = pythonOrSkip();
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'model/overlord');
const CHECK = path.join(DIR, 'check.py');
const py = (args: string[], timeout = 60_000) =>
  execFileSync(PY!, ['-I', '-B', CHECK, ...args], { encoding: 'utf8', timeout });
const check = (...args: string[]) => JSON.parse(py(['--json', ...args]));
describe.skipIf(PY === null)('the Overlord model (§11.7, the first model)', () => {
  it.each(FAST)('%s holds every invariant at the defaults', (sc) => {
    expect(check(sc)).toMatchObject({ scenario: sc, violated: [] });
  }, 60_000);
  it('no_fence on rebind is caught by I5', () => {
    expect(check('rebind', 'MUTATION=no_fence').violated).toContain('I5');
  }, 60_000);
  it('the model imports only the standard library', () => {
    const allowed = new Set(['array', 'collections', 'json', 'os', 'sys', 'time', 'model']);
    for (const f of ['model.py', 'check.py']) for (const m of importsOf(path.join(DIR, f)))
      expect(allowed.has(m), `${f} imports ${m}`).toBe(true);
  });
  it('a run writes no bytecode beside the model', () => {
    const pyc = path.join(DIR, '__pycache__'); const before = existsSync(pyc);
    check('lineage');
    if (!before) expect(existsSync(pyc)).toBe(false);
  }, 60_000);
  describe.runIf(process.env['CCRC_MODEL'] === 'full')('the whole matrix (by hand: CCRC_MODEL=full)', () => {
    it('every scenario holds every invariant at the defaults and ends under the bound', () => {
      const names = py(['--list']).split('\n')[0]!.replace(/^scenarios: /, '').split(', ');
      for (const sc of names) expect(check(sc), sc).toMatchObject({ scenario: sc, violated: [] });
    }, 600_000);
    it('every planted mutation that names an invariant is caught by it', () => {
      for (const r of JSON.parse(py(['--json', '--mutations'], 600_000)) as { mutation: string; expected: string; caught: string[] }[])
        if (/^[IXD]\d/.test(r.expected)) expect(r.caught, r.mutation).toContain(r.expected);
    }, 600_000);
  });
});
```

  `importsOf(file)` is test-local: the first name of every `import a` and `from a import` line. Run
  `./node_modules/.bin/vitest run test/overlord-model.test.ts`. Expected: red (no files). W0's draft brought in
  unchanged would also be red: `-I` cannot import `model`.
- [ ] **Step 2: Bring the files in** as W0 left them, with the `check.py` changes. Their headers cite this edition's
  section numbers and the spec's committed path, not an earlier draft. Set `FAST` from W0's final matrix.
- [ ] **Step 3: Run it.** Expected: green, about 4 s on a dev laptop. Then run once by hand with `CCRC_MODEL=full`
  and paste `check.py --matrix` and `check.py --mutations` into the PR. A scenario that hits the bound is cut down
  (fewer ticks or slots) until it ends, never left out silently.
- [ ] **Step 4: The guards' mutations.** Set the `no_fence` mutation to a no-op in `model.py`: the I5 row goes red.
  Add `import fractions` to `model.py`: the standard-library row goes red. Drop `-B` (with no `__pycache__` there
  first): the bytecode row goes red.
- [ ] **Step 5: Commit.** `test(model): the Overlord's first model runs in the suite, its fast scenarios on every run`

---

## Deviations found

The programme mints real numbers when its run opens; until then each entry is named by its slug.

- **D-TBD-sim-pure-deciders-first.** Table 11.7b's simulator runs "the real lanes and SQLite on a fake clock and a fake
  agent link", with "crash, restore and gap injection". The skeleton drives pure deciders through a lane double in
  test code, and injects crashes, gaps (a crash's downtime) and wall skew, but no restore: no decider that reads a
  restore exists yet. The time-ports piece hands the ports on `Deps.time`, but no lane reads them yet (the stall lane
  reads `Date.now()` inside `FleetWatcher`), so a real-lane simulator needs a lane that takes its time from the ports
  first. The skeleton's API (`Scenario`, `SimWorld`, `SequenceLine`) is the one the real-lane simulator extends.
- **D-TBD-sim-line-is-sequence-line.** The simulator records lines in `overlord_sequence`'s shape (§10.4), not a
  free-form event log, so a predicate written for the simulator runs unchanged in the W1 monitor.
- **D-TBD-model-stays-python.** §11.7 recommends "a TypeScript-bridged model checker". The model is kept in Python's
  standard library, run by `python3 -I -B` from a vitest test, as the tree already does for other Python. No toolchain
  or dependency is added. Porting it to TypeScript would rewrite about 1 900 lines for no new check.
- **D-TBD-mutation-runner-in-tree.** §11.7 recommends "a mutation runner". The plan writes a small TypeScript runner
  with `mutation-run.py`'s contract (textual mutants, `old` exactly once, a baseline first) instead of adding Stryker.
  Its mutants are listed by hand per decider, so the score is over a chosen set, not over every operator.
- **D-TBD-no-property-library-yet.** §11.7 also recommends "a property-test library". This piece adds none: the
  skeleton's seeded scenarios need only the fake's seeded `Entropy`, and the stateful property tests arrive with each
  machine's wave (Table 11.7b), which decides then whether `fast-check` earns its dependency.
- **D-TBD-mutation-floors-every-run.** Table 11.7b says "Daily". The floor test costs a few seconds (Task 5 Step 3
  measures it, and the PR records the figure), so it runs wherever the suite selects it (a pull request whose change
  reaches it, the merge queue and the daily run). A daily-only job would need a `.github/` change. When a later set
  grows heavy, it moves behind an env gate and a daily job then.
- **D-TBD-one-mulberry32.** The nine test copies of `mulberry32` move onto the one the time-ports piece exports from
  `server/test/fakeTime.ts` (the same slug there), so the simulator's chance is not a tenth. The move changes imports
  only.

## Where things stand

**Before it starts:** the spec is committed as `docs/superpowers/specs/2026-11-09-overlord-design.md`, and the
time-ports piece (`w1a-time-ports.md`) is merged: this plan imports its ports (`server/src/time/ports.ts`), its fake
(`fakeTime`) and its seeded generator (`mulberry32`), and defines none of them again. Tasks 1 to 5 need nothing else.
Task 6 waits for W0's model, revised to this edition (question 1).

**What depends on it:** the renewal piece (`renewalDue`'s mutant set and floor, and the exhaustive-domain helpers);
W1 (the invariant monitor reuses `Invariant` and `SequenceLine`, and the real-lane simulator extends `Scenario` and
`SimWorld`); every later wave's scenario and mutant set.

**Open questions for the operator,** most important first:
1. **The model is not yet the first model of this edition.** W0's draft cites an earlier draft of the spec. On
   2026-11-10 every scenario holds every invariant at its defaults and ends under the bound, but its mutation table
   has not been re-run. Recommendation: W0 revises it to this edition (each switch the spec now settles becomes a
   constant, with its section) and re-runs `--matrix` and `--mutations`; any violation left at the defaults goes to
   the spec's owner as a finding before Task 6 lands. Task 6 never pins a red result as expected.
2. **The rung may fall across a restart.** The run-less push latch is in memory (D-3751), so a restart forgets every
   push. If an episode reached rung 2 on a busy stretch, the stretch has ended by the restart and the oldest held
   mail is still under `COORD_BLOCKED_OLD_MS`, the re-opened episode pushes rung 1 after a rung 2. `stall.ts`
   documents "pushes it once more", not a lower push. The worked example states CB-rung-never-falls between boots, as
   documented, and its `reopened-after-boot` edge shows how often it happens. Recommendation: the stall owner rules
   whether a lower push after a restart is intended; if not, it is a fix of its own, never folded into this piece.
3. **Where the heavy model scenarios run.** renewal, genmachine and readiness take about 12 s each on a dev laptop,
   close to the 20 s per-test budget on a Linux runner. Recommendation: the fast scenarios on every run, the rest by
   hand with `CCRC_MODEL=full` before a PR that touches the model, and a daily job when W1 adds the real lanes.
4. **Exhaustive-domain helpers.** §11.7 wants every first-match decider tested over its whole domain, with a
   monotonicity property. This skeleton adds no `product` or `monotone` helper, because no first-match decider of
   this design exists yet. Recommendation: the renewal piece adds them to `server/test/sim/` with `renewalDue`.
5. **M24's count of seeds run and red.** Nothing records it yet. Recommendation: leave it to W1's monitor, which owns
   M24's other figures.
