# Overlord W1a: the ports for time and chance (`Clock`, `Scheduler`, `Entropy`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to carry out this plan task by task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status:** Draft piece of the Overlord programme's W1a plan, written against today's `main`. It defines
> no D-numbers: every decision below is a `D-TBD-<slug>` until the programme mints them.

**Goal:** Add the `Clock`, `Scheduler` and `Entropy` ports in the clock kernel, their system adapters, a test-side fake
that drives them, their one construction in the composition root, and a scan that keeps new Overlord and continuity
modules off ambient time and chance.

**Why:** The Overlord and continuity code must run on a fake clock in tests and in the deterministic simulator (spec
§11.7), and its deadlines are durable columns read through a clock, never timers that live in one process (§11.5,
§3.3.11). Today the server reads time and chance ambiently: about 250 `Date.now()` calls, 19 `new Date(`, 28
`setTimeout(`, 12 `setInterval(`, 20 `performance.now`, and `randomUUID`, `randomBytes` or `Math.random` in 17 files.

**Architecture:** Three L2 ports in `server/src/time/` (context K), one L1 rules module that holds every bound and the
wall clamp, one L3 module of system adapters, and a fake under `server/test/`. It rewrites no existing module. It
extends what exists: the lane runner's two-clock shape (`LaneClocks`) becomes the `Clock` port, so "a wall clock and a
monotonic clock" has one definition, and repeating work stays a `LANE_SCHEDULE` row, so `Scheduler` is one-shot only.

**Tech Stack:** TypeScript on Node 22.16 or later, `node:crypto`, vitest (its fake timers for the system adapters'
contract row), the repository's scan helpers under `server/test/scan/` and `server/test/rings/`.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`: §11.5 (the bullet "Ports for time and chance", and
the clock half of "Two kinds of timer": a wall reading earlier than the last stored time is treated as that time);
§3.6 H2 (the bullet "`Clock`, `Scheduler` and `Entropy`", and "Deadlines are durable columns"); §11.1 (the row
"`Clock`, `Scheduler`, `Entropy` | K, L2; given by L5 | W1a"); §11.7 Table 11.7b (the fake clock the simulator's
skeleton runs on; the simulator itself is another piece); §14 Table 14, W1a ("the ports for time and chance").

## What exists today

Read at the branch point. Cite by symbol, never by line.

| Fact | Where |
|---|---|
| The lane runner's clock shape, `interface LaneClocks { wall(): number; mono(): number }`, used only by `LaneRunner`'s constructor. Nothing else imports the name. `LaneRunner` is built in `watch.ts`, `lane-schedule.test.ts` and `disk-retention-beats.test.ts`, each from an object literal | `server/src/laneRunner.ts#LaneClocks`, `server/src/laneRunner.ts#LaneRunner` |
| The watcher builds that runner from ambient calls: `{ wall: () => Date.now(), mono: () => this.deps.monotonicMs?.() ?? performance.now() }` | `server/src/watch.ts#FleetWatcher` (its `lanes` field) |
| `Deps.monotonicMs?: () => number`, unset in production, set by tests (`withFakeClock` defaults it to `Date.now`). Its docstring says the child-reclaim lane alone reads it; in fact every lane's throttle does, through the runner above | `server/src/deps.ts#Deps`, `server/test/helpers.ts#withFakeClock` |
| `LANE_SCHEDULE`, the one table of lane cadences (consolidation K11): every row throttles on `mono`; verdicts keep the wall clock | `server/src/laneSchedule.ts#LANE_SCHEDULE` |
| The kernel's stated aim: "an injected `now()` for L1" (consolidation spec §2.3, the "Clock and schedule" row) | `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` |
| Precedents of injected time and chance: `now`, `monotonicMs` and `randomUUID` on the delegation applier, wired in `watch.ts` from `Date.now`, `this.mono()` and `randomUUID`; `now?: () => number` on readiness; `new LinearRateService(Date.now)` in `index.ts` | `server/src/coord/delegation-checkpoint.ts#DelegationDurabilityDeps`, `server/src/readiness.ts`, `server/src/linear/rate.ts#LinearRateService` |
| Two per-file ambient scans, each an inline regex in its own test | `server/test/delegation-compaction.test.ts`, `server/test/delegation-policy.test.ts` |
| The parser the scans use: `parsedFile`, `identifierReferences` (every reference to a named identifier, with its parent's text), `sqlStatementsInFile` | `server/test/scan/symbols.ts#parsedFile`, `server/test/scan/parse.ts#identifierReferences`, `server/test/scan/symbols.ts#sqlStatementsInFile` |
| The ring classifier and the file walk with a floor. `serverRing` answers `{ ring, why }`; a header that declares a ring (`// L2 ports: …`) moves a file outward of its facts, so a types-only file is told by `why === 'every top-level statement is a type'`, not by `ring` alone | `server/test/rings/ring.ts#serverRing`, `server/test/rings/walkSrc.ts#walkSrc` |
| The test-side `Deps` builders: `testDeps` builds one literal; about 95 other literals in about 34 test files build a `Deps` from scratch and are type-checked as one (most in `secret-mask.test.ts` 12, `sessionws.test.ts` 11, `routes.test.ts`, `lifecycle.test.ts` and `dialog.test.ts` 8 each). A literal that spreads `testDeps(…)` needs nothing, and a literal cast `as never as Deps` is not checked. `typecheck-tests.test.ts` runs `tsc` over `test/tsconfig.tests.json` | `server/test/helpers.ts#testDeps`, `server/test/typecheck-tests.test.ts` |
| The context table every `server/src` file must be named by (a new directory needs a `dir/**` row in the same PR) | the `ring-context-map` block of `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, read by `server/test/rings/totality.test.ts` |
| SQL that reads the clock or chance (`CURRENT_TIMESTAMP`, `'now'`, `unixepoch()`, `random()`, `randomblob(`): none in `server/src` by grep (the only `'now'` hits are TypeScript `Pick<…, 'now'>` keys) | measured again in Task 6 |
| `server/src/time/`, `server/src/overlord/`, `server/src/continuity/`: do not exist today | |
| No time-zone setting exists. The digest keys its day on a UTC hour | `server/src/coord/digest.ts#digestDayFor` |

## Global Constraints

- **Test first.** Every step that adds behaviour writes its failing test and runs it red before the code.
- **One commit per task**, on the workspace branch, with the message the task gives.
- **Touch only the files a task names.** No existing call to `Date.now`, `setTimeout` or `randomUUID` changes.
- **Run one suite from inside its package, in the foreground**, timeout at least 600000 ms:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
  Typecheck: `cd server && ./node_modules/.bin/tsc --noEmit`.
- **Cite code by symbol or anchor** (`file.ts#symbol`), never by line number, in code comments and commit messages.
- **No private names.** Fixtures use neutral names (`lane-a`, `project-a`); no hosts, accounts, people or home paths.
- **No D-numbers invented.** Use the `D-TBD-<slug>` names below until the programme mints numbers.
- **One definition.** Every bound is one named constant in `server/src/time/rules.ts`, which the system adapters and
  the fake both call (Task 2). The fake never ships: it lives under `server/test/` (Task 5 pins it).
- **Secrets stay cryptographic.** The system `Entropy` draws from `node:crypto` only.

## Review Focus

1. **A wall clock that steps back** (NTP, a VM resume) must never pull a stored time earlier: Task 2's row "the clock
   stepped back" and the `wallNotBefore` property test.
2. **A delay over Node's timer ceiling** must be refused, never fired after 1 ms: Task 2's refused delays, and the
   contract row "a delay it cannot keep is refused" on both the fake and the system adapters (Tasks 3 and 4).
3. **A scheduled call that throws or rejects** must be one warning line, never an unhandled error that stops the
   process: the contract row "a throwing or rejecting call" on both rows (Tasks 3 and 4).
4. **A pending call at shutdown** must not hold the process open: Task 4's "a scheduled call does not hold the process
   open".
5. **A new Overlord or continuity module that reads `Date.now()`** must turn the suite red, and today's code must not:
   Task 6's RED and GREEN controls, its scope control, and "no scoped file reads an ambient clock, timer or chance".

---

### Task 1: The three ports, and the lane runner takes `Clock`

**Files:**
- Create: `server/src/time/ports.ts` (ring L2: every top-level statement is a type; context K)
- Modify: `server/src/laneRunner.ts#LaneClocks` (deleted), `server/src/laneRunner.ts#LaneRunner` (constructor type)
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, the `ring-context-map` block's K row:
  add `` `time/**` `` to its `server/src` cell
- Test: create `server/test/single-definition/time-ports.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all in `server/src/time/ports.ts`):

```ts
/** The server's two clocks. `wall()`: epoch milliseconds; it may step back or forward (NTP, a VM resume), so a deadline
 *  that fails towards the operator reads it through `wallNotBefore` (time/rules.ts). `mono()`: milliseconds on this
 *  process's monotonic clock; it never steps back, starts near zero at each process start, and means nothing across
 *  a restart, so it is never stored. Failure contract: neither throws. */
export interface Clock { wall(): number; mono(): number }

/** Idempotent; harmless after the call fired. */
export type Cancel = () => void;

/** One-shot calls on this process's event loop, timed on `Clock.mono`. Never a cadence (a cadence is a LANE_SCHEDULE
 *  row) and never a durable deadline (a deadline is a column read through `Clock`). Failure contract: `after` throws
 *  RangeError for a delay `checkDelayMs` refuses; a call that throws or rejects is reported as one
 *  `ccrc-server: a scheduled call failed: <message>` line and never reaches the caller or the process. */
export interface Scheduler { after(ms: number, fn: () => unknown): Cancel }

/** Chance. Failure contract: each method throws RangeError for an argument the rules refuse, and never answers a
 *  weaker value instead. */
export interface Entropy {
  /** `bytes` random bytes as lowercase hex (2 x bytes characters). For secrets and ids. */
  hex(bytes: number): string;
  /** A lowercase version-4 UUID. */
  uuid(): string;
  /** A uniform integer in [0, n). For a sample, a jitter or a seed (`below(2 ** 32)`). */
  below(n: number): number;
}

/** The three, as the composition root hands them on. */
export interface TimePorts { readonly clock: Clock; readonly scheduler: Scheduler; readonly entropy: Entropy }
```

- `LaneRunner`'s constructor becomes `constructor(private readonly clocks: Clock, rows?, warn?)` with
  `import type { Clock } from './time/ports.js'`. The name `LaneClocks` is gone.

- [ ] **Step 1: Characterization.** On the base, run
  `cd server && ./node_modules/.bin/vitest run test/lane-schedule.test.ts test/disk-retention-beats.test.ts`.
  Expect green. Both build a `LaneRunner` from an object literal, and both run unedited through the change.
- [ ] **Step 2: Write the failing test** in `server/test/single-definition/time-ports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { codeOnly, serverRing } from '../rings/ring.js';
import { REPO, walkSrc } from '../rings/walkSrc.js';

describe('the time ports (Overlord spec §11.5, §3.6 H2): one definition, in the clock kernel', () => {
  it('ports.ts is types only, so L2 by its facts, not by its header', () => {
    expect(serverRing('server/src/time/ports.ts')).toEqual({ ring: 'L2', why: 'every top-level statement is a type' });
  });

  it('the two-clock shape is declared once: the lane runner takes Clock and declares no clock of its own', () => {
    const shape = /\binterface\s+\w+\s*\{[^}]*\bwall\(\)\s*:\s*number[^}]*\bmono\(\)\s*:\s*number/;
    const holders = walkSrc({ roots: ['server/src'], min: 150 })
      .filter((f) => shape.test(codeOnly(readFileSync(path.join(REPO, f), 'utf8'))));
    expect(holders).toEqual(['server/src/time/ports.ts']);
    const edge = parsedFile('server/src/laneRunner.ts').imports.find((e) => e.specifier === './time/ports.js');
    expect(edge?.names).toContain('Clock');
  });
});
```

- [ ] **Step 3: Run it.** `cd server && ./node_modules/.bin/vitest run test/single-definition/time-ports.test.ts`.
  Expect red: `serverRing` throws on the missing file, and the holders list is `['server/src/laneRunner.ts']`.
- [ ] **Step 4: Implement.** Create `ports.ts` as above, with a header comment that names its ring and kernel
  (`// L2 ports: the clock kernel's time and chance (Overlord spec §11.5) ...`). In `laneRunner.ts` delete
  `LaneClocks` and type the constructor's first parameter `Clock`. Add `` `time/**` `` to the K row of the
  `ring-context-map` block.
- [ ] **Step 5: Run.** The new test, the two Step 1 files and `test/rings/totality.test.ts`: expect green.
  `cd server && ./node_modules/.bin/tsc --noEmit`: expect clean.
- [ ] **Step 6: Commit.**

```bash
git add server/src/time/ports.ts server/src/laneRunner.ts server/test/single-definition/time-ports.test.ts \
  docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md
git commit -m "feat(time): the Clock, Scheduler and Entropy ports in the clock kernel; the lane runner takes Clock"
```

Guards: put a value in `ports.ts` (an `export const`) and the L2 test goes red (the header still says L2, so only the
`why` tells). Restore an `interface LaneClocks
{ wall(): number; mono(): number }` in `laneRunner.ts` and the one-definition test goes red. Drop the `time/**` row
and `totality.test.ts` goes red (an unmapped file).

Mechanical: yes.

### Task 2: The time rules: every bound once, and the wall clamp

**Files:**
- Create: `server/src/time/rules.ts` (ring L1: imports nothing, no timer; context K)
- Test: create `server/test/time-rules.test.ts`; add one block to `server/test/single-definition/time-ports.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
/** Node clamps a longer setTimeout delay to 1 ms, so a longer one is refused, never shortened. */
export const TIMER_MAX_MS = 2_147_483_647;
/** The fewest bytes `Entropy.hex` will draw: a secret is never weaker than 128 bits. */
export const ENTROPY_MIN_BYTES = 16;
export const ENTROPY_MAX_BYTES = 1024;
/** `Entropy.below`'s largest n, so a seed is a full 32-bit draw. */
export const ENTROPY_MAX_BOUND = 2 ** 32;

/** Answers `ms`, or throws RangeError unless it is finite and 0 <= ms <= TIMER_MAX_MS. */
export function checkDelayMs(ms: number): number;
/** Answers `n`, or throws RangeError unless it is an integer in [ENTROPY_MIN_BYTES, ENTROPY_MAX_BYTES]. */
export function checkEntropyBytes(n: number): number;
/** Answers `n`, or throws RangeError unless it is an integer in [1, ENTROPY_MAX_BOUND]. */
export function checkEntropyBound(n: number): number;
/** §11.5: a wall reading earlier than the last stored time is treated as that time. `lastStoredMs` null: nothing is
 *  stored yet, so the reading stands. For timers that fail towards the operator only. */
export function wallNotBefore(readingMs: number, lastStoredMs: number | null): number;
```

Each RangeError's message names the argument and the bound, for example
`Scheduler.after: 2147483648 ms is over TIMER_MAX_MS (2147483647)`.

- [ ] **Step 1: Write the failing tests** in `server/test/time-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TIMER_MAX_MS, ENTROPY_MIN_BYTES, ENTROPY_MAX_BYTES, ENTROPY_MAX_BOUND,
  checkDelayMs, checkEntropyBytes, checkEntropyBound, wallNotBefore,
} from '../src/time/rules.js';

describe('time rules (Overlord spec §11.5)', () => {
  it('the bounds', () => {
    expect([TIMER_MAX_MS, ENTROPY_MIN_BYTES, ENTROPY_MAX_BYTES, ENTROPY_MAX_BOUND])
      .toEqual([2_147_483_647, 16, 1024, 4_294_967_296]);
  });
  it.each([0, 0.5, 1, 60_000, 2_147_483_647])('a delay of %s ms is kept', (ms) => expect(checkDelayMs(ms)).toBe(ms));
  it.each([-1, 2_147_483_648, NaN, Infinity, -Infinity])('a delay of %s ms is refused',
    (ms) => expect(() => checkDelayMs(ms)).toThrow(RangeError));
  it.each([16, 32, 1024])('%s bytes are drawn', (n) => expect(checkEntropyBytes(n)).toBe(n));
  it.each([0, 15, 1025, 16.5, NaN])('%s bytes are refused', (n) => expect(() => checkEntropyBytes(n)).toThrow(RangeError));
  it.each([1, 2, 8, 2 ** 32])('a bound of %s is kept', (n) => expect(checkEntropyBound(n)).toBe(n));
  it.each([0, -1, 2 ** 32 + 1, 1.5, NaN])('a bound of %s is refused', (n) => expect(() => checkEntropyBound(n)).toThrow(RangeError));
  it('wallNotBefore: rows', () => {
    expect(wallNotBefore(1000, null)).toBe(1000);
    expect(wallNotBefore(1000, 999)).toBe(1000);
    expect(wallNotBefore(1000, 1000)).toBe(1000);
    expect(wallNotBefore(999, 1000)).toBe(1000);    // the clock stepped back: the stored time stands
  });
  it('wallNotBefore: never below either input, always one of them, monotonic in the reading', () => {
    const xs = [0, 1, 999, 1000, 1001, 1_786_000_000_000];
    for (const r of xs) for (const s of [null, ...xs]) {
      const out = wallNotBefore(r, s);
      expect(out).toBeGreaterThanOrEqual(r);
      if (s !== null) expect(out).toBeGreaterThanOrEqual(s);
      expect([r, s]).toContain(out);
      for (const r2 of xs) if (r2 >= r) expect(wallNotBefore(r2, s)).toBeGreaterThanOrEqual(out);
    }
  });
});
```

  And in `time-ports.test.ts`, a single-definition pin that the timer ceiling is spelled once:

```ts
it('the Node timer ceiling is spelled once, in time/rules.ts', () => {
  const spelled = /\b2_?147_?483_?647\b/;
  const holders = walkSrc({ roots: ['server/src', 'shared'], min: 300 })
    .filter((f) => spelled.test(codeOnly(readFileSync(path.join(REPO, f), 'utf8'))));
  expect(holders).toEqual(['server/src/time/rules.ts']);
});
```

- [ ] **Step 2: Run them.** Expect red: the module does not exist.
- [ ] **Step 3: Implement** `rules.ts`. Its header comment states "L1 policy" and the clock kernel. `wallNotBefore` is
  `lastStoredMs === null ? readingMs : Math.max(readingMs, lastStoredMs)`.
- [ ] **Step 4: Run** both files. Expect green.
- [ ] **Step 5: Commit.**

```bash
git add server/src/time/rules.ts server/test/time-rules.test.ts server/test/single-definition/time-ports.test.ts
git commit -m "feat(time): the time rules, one definition of each bound and of the wall clamp"
```

Guards: delete the `> TIMER_MAX_MS` arm and "a delay of 2147483648 ms is refused" goes red; delete the
`ENTROPY_MIN_BYTES` arm and "15 bytes are refused" goes red; make `wallNotBefore` answer the reading and the row
"the clock stepped back" goes red. `rules.ts` is an L1 module, so it enters the daily mutation floor (§11.7) with the
other new deciders.

Mechanical: yes.

### Task 3: The fake: a clock, a scheduler and seeded chance that a test drives

**Files:**
- Create: `server/test/fakeTime.ts` (test-side; not a `server/src` file, so no ring)
- Create: `server/test/time-ports-contract.test.ts`

**Interfaces:**
- Consumes: `Clock`, `Scheduler`, `Entropy`, `TimePorts` (Task 1); `checkDelayMs`, `checkEntropyBytes`,
  `checkEntropyBound` (Task 2).
- Produces:

```ts
export const FAKE_T0 = 1_786_000_000_000;
export interface FakeTime {
  readonly ports: TimePorts;
  /** Every `ccrc-server: a scheduled call failed: …` line, in order. */
  readonly warnings: string[];
  /** Moves wall and mono forward by `ms` (finite and >= 0, else RangeError; no ceiling, since a simulator advances
   *  days). Fires each call that falls due, in due order, equal dues in scheduling order, with both clocks standing at
   *  its due time; a call scheduled by a firing call fires in the same advance if it falls due within it. */
  advance(ms: number): void;
  /** Steps the wall clock alone (finite, else RangeError; negative steps back), as an NTP step or a VM resume does.
   *  Fires nothing. */
  stepWall(deltaMs: number): void;
  /** A process restart after a gap (finite and >= 0, else RangeError): drops every pending call, moves the wall by
   *  `gapMs`, and starts mono at 0. */
  restart(gapMs: number): void;
  /** Calls scheduled and neither fired nor cancelled. */
  pending(): number;
}
export function fakeTime(opts?: { wallMs?: number; monoMs?: number; seed?: number }): FakeTime;
```

```ts
/** A seeded PRNG: draws in [0, 1). Copied verbatim from `server/test/docs-grammar.test.ts#mulberry32`, one of nine
 *  local copies in the test tree today; this is the first exported one (D-8225). */
export function mulberry32(seed: number): () => number;
```

Defaults: `wallMs` `FAKE_T0`, `monoMs` 0, `seed` 1. Chance is `const next = mulberry32(seed)`, read as one unsigned
32-bit draw per call: `draw = next() * 2 ** 32` (exact, since each value is an integer over 2^32). `below(n)` is
`Math.floor(draw * n / 2 ** 32)`. `hex(k)` takes k bytes, four from each draw, low byte first, and drops the unused
bytes of its last draw. `uuid()` takes 16 bytes the same way (four draws), then sets byte 6 to `(b & 0x0f) | 0x40` and
byte 8 to `(b & 0x3f) | 0x80`. The golden values below pin the algorithm (measured on `docs-grammar.test.ts`'s copy),
so a seed recorded by a red simulator run replays the same on any later build.

- [ ] **Step 1: Write the failing tests** in `server/test/time-ports-contract.test.ts`. The contract is a function over
  a rig, so Task 4 adds the real adapter as a second row:

```ts
import { describe, it, expect } from 'vitest';
import type { TimePorts } from '../src/time/ports.js';
import { TIMER_MAX_MS } from '../src/time/rules.js';
import { fakeTime, FAKE_T0, mulberry32 } from './fakeTime.js';

interface Rig { ports: TimePorts; tick(ms: number): void; warnings(): string[] }
const flush = (): Promise<void> => new Promise((r) => { setImmediate(r); });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function timeContract(name: string, make: () => Rig): void {
  describe(`the time ports contract: ${name}`, () => {
    it('a call fires once, no sooner than its delay, with the clock at its due time', () => {
      const r = make(); const seen: number[] = [];
      const m0 = r.ports.clock.mono();
      r.ports.scheduler.after(1000, () => { seen.push(r.ports.clock.mono() - m0); });
      r.tick(999); expect(seen).toEqual([]);
      r.tick(1); expect(seen).toEqual([1000]);
      r.tick(5000); expect(seen).toEqual([1000]);
    });
    it('calls fire in due order, equal dues in scheduling order', () => {
      const r = make(); const order: string[] = [];
      r.ports.scheduler.after(20, () => order.push('b'));
      r.ports.scheduler.after(10, () => order.push('a'));
      r.ports.scheduler.after(20, () => order.push('c'));
      r.tick(20); expect(order).toEqual(['a', 'b', 'c']);
    });
    it('a cancelled call never fires; cancel is idempotent and harmless after firing', () => {
      const r = make(); let n = 0;
      const cancel = r.ports.scheduler.after(10, () => { n++; });
      cancel(); cancel(); r.tick(10); expect(n).toBe(0);
      const late = r.ports.scheduler.after(10, () => { n++; });
      r.tick(10); late(); expect(n).toBe(1);
    });
    it('a throwing or rejecting call is one warning line, and the next call still fires', async () => {
      const r = make(); const after: number[] = [];
      r.ports.scheduler.after(10, () => { throw new Error('boom'); });
      r.ports.scheduler.after(10, async () => { throw new Error('late'); });
      r.ports.scheduler.after(20, () => after.push(1));
      r.tick(20); await flush();
      expect(r.warnings()).toEqual(['ccrc-server: a scheduled call failed: boom', 'ccrc-server: a scheduled call failed: late']);
      expect(after).toEqual([1]);
    });
    it('a delay it cannot keep is refused, never shortened', () => {
      const r = make();
      for (const ms of [-1, NaN, TIMER_MAX_MS + 1]) expect(() => r.ports.scheduler.after(ms, () => {})).toThrow(RangeError);
    });
    it('wall and mono move together as time passes', () => {
      const r = make(); const w0 = r.ports.clock.wall(); const m0 = r.ports.clock.mono();
      r.tick(1500);
      expect(r.ports.clock.wall() - w0).toBe(1500);
      expect(r.ports.clock.mono() - m0).toBe(1500);
    });
    it('entropy: shapes and ranges', () => {
      const e = make().ports.entropy;
      expect(e.hex(16)).toMatch(/^[0-9a-f]{32}$/);
      expect(() => e.hex(15)).toThrow(RangeError);
      expect(e.uuid()).toMatch(UUID_V4);
      expect(e.below(1)).toBe(0);
      const seen = new Set(Array.from({ length: 200 }, () => e.below(8)));
      expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(() => e.below(0)).toThrow(RangeError);
      expect(() => e.below(2 ** 32 + 1)).toThrow(RangeError);
    });
  });
}

timeContract('the fake', () => { const f = fakeTime(); return { ports: f.ports, tick: (ms) => f.advance(ms), warnings: () => f.warnings }; });

describe('the fake alone', () => {
  it('starts at FAKE_T0 and mono 0 by default', () => {
    const f = fakeTime();
    expect([f.ports.clock.wall(), f.ports.clock.mono()]).toEqual([FAKE_T0, 0]);
  });
  it('mulberry32 is the test tree\'s generator: seed 1 draws what docs-grammar.test.ts\'s copy draws', () => {
    const n = mulberry32(1);
    expect([n(), n()]).toEqual([0.6270739405881613, 0.002735721180215478]);
  });
  it('golden draws for seed 1, so a recorded seed replays on any build', () => {
    const e = fakeTime({ seed: 1 }).ports.entropy;
    expect([e.below(2 ** 32), e.below(2 ** 32), e.below(2 ** 32)]).toEqual([2693262067, 11749833, 2265367787]);
    expect(fakeTime({ seed: 1 }).ports.entropy.hex(16)).toBe('f3ea87a0c949b300ebc40687fd2726fb');
    expect(fakeTime({ seed: 1 }).ports.entropy.uuid()).toBe('f3ea87a0-c949-4300-abc4-0687fd2726fb');
    expect(fakeTime({ seed: 2 }).ports.entropy.below(2 ** 32)).toBe(3153583793);
  });
  it('stepWall moves the wall alone and fires nothing', () => {
    const f = fakeTime(); let n = 0;
    f.ports.scheduler.after(10, () => { n++; });
    f.stepWall(-60_000);
    expect([f.ports.clock.wall(), f.ports.clock.mono(), n, f.pending()]).toEqual([FAKE_T0 - 60_000, 0, 0, 1]);
  });
  it('restart drops every pending call, moves the wall by the gap, and starts mono at 0', () => {
    const f = fakeTime(); let n = 0;
    f.advance(5000);
    f.ports.scheduler.after(10, () => { n++; });
    f.restart(3_600_000);
    f.advance(10);
    expect([f.ports.clock.wall(), f.ports.clock.mono(), n, f.pending()]).toEqual([FAKE_T0 + 5000 + 3_600_000 + 10, 10, 0, 0]);
  });
  it('a call scheduled by a firing call fires in the same advance when it falls due', () => {
    const f = fakeTime(); const at: number[] = [];
    f.ports.scheduler.after(10, () => { f.ports.scheduler.after(5, () => at.push(f.ports.clock.mono())); });
    f.advance(15);
    expect(at).toEqual([15]);
  });
});
```

- [ ] **Step 2: Run it.** `cd server && ./node_modules/.bin/vitest run test/time-ports-contract.test.ts`.
  Expect red: the fake does not exist.
- [ ] **Step 3: Implement** `server/test/fakeTime.ts`. The pending calls are an array of `{ due, seq, fn, live }`;
  `advance` repeatedly takes the live entry with the least `(due, seq)` at or before the target. A call's throw is
  caught and pushed to `warnings`; a returned promise gets a `.catch` that does the same. `after`, `hex` and `below`
  validate through the Task 2 checks, never a copy of them; `advance`, `stepWall` and `restart` check their own
  arguments as their docstrings say.
- [ ] **Step 4: Run it.** Expect green.
- [ ] **Step 5: Commit.**

```bash
git add server/test/fakeTime.ts server/test/time-ports-contract.test.ts
git commit -m "test(time): a fake clock, scheduler and seeded chance that a test or the simulator drives"
```

Mechanical: yes, given the semantics above.

### Task 4: The system adapters, held to the same contract

**Files:**
- Create: `server/src/time/system.ts` (ring L3: its `setTimeout` handle is a local of one `after` call, so a deadline
  timer by the ring rule; its header declares "L3 adapters"; context K)
- Modify: `server/test/time-ports-contract.test.ts` (a second contract row); `time-ports.test.ts` (one block)

**Interfaces:**
- Consumes: Task 1's ports, Task 2's checks.
- Produces:

```ts
/** wall: Date.now(); mono: performance.now(), on the GLOBAL `performance`, read at each call. Never import it from
 *  node:perf_hooks: vitest's fake timers replace the global object, so an imported binding would stay real. */
export const systemClock: Clock;
/** hex: randomBytes(checkEntropyBytes(n)).toString('hex'); uuid: randomUUID(); below: randomInt(checkEntropyBound(n)).
 *  All from node:crypto. */
export const systemEntropy: Entropy;
/** after: checkDelayMs, then a local setTimeout whose callback catches a throw and a rejection into `warn`, unref'd, and
 *  a Cancel that calls clearTimeout. */
export function systemScheduler(warn: (message: string) => void): Scheduler;
/** The three. `warn` defaults to console.warn: the server runs with Fastify's logger off. */
export function systemTimePorts(warn?: (message: string) => void): TimePorts;
```

- [ ] **Step 1: Write the failing tests.** In `time-ports-contract.test.ts`, add the real row. Vitest's fake timers fake
  `setTimeout`, `Date` and `performance` for the system adapters, so the row is deterministic under load. `flush`
  uses `setImmediate`, which stays real. Merge the imports below into the file's existing ones:

```ts
import { vi, afterEach } from 'vitest';
import { systemTimePorts } from '../src/time/system.js';

timeContract('the system adapters, under vitest fake timers', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'], now: FAKE_T0 });
  const lines: string[] = [];
  return { ports: systemTimePorts((m) => lines.push(m)), tick: (ms) => vi.advanceTimersByTime(ms), warnings: () => lines };
});
afterEach(() => { vi.useRealTimers(); });

describe('the system adapters alone', () => {
  it('a scheduled call does not hold the process open', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const cancel = systemTimePorts().scheduler.after(60_000, () => {});
    const handle = spy.mock.results[0]!.value as NodeJS.Timeout;
    expect(handle.hasRef()).toBe(false);
    cancel(); spy.mockRestore();
  });
});
```

  The `entropy` block's 200 draws of `below(8)` miss a value with probability about 2e-11, so the real row cannot flake
  on it. In `time-ports.test.ts`:

```ts
it('system.ts is L3, and its chance comes from node:crypto alone', () => {
  expect(serverRing('server/src/time/system.ts').ring).toBe('L3');
  const p = parsedFile('server/src/time/system.ts');
  const crypto = p.imports.filter((e) => e.specifier === 'node:crypto').flatMap((e) => e.names);
  expect(crypto).toEqual(expect.arrayContaining(['randomBytes', 'randomUUID', 'randomInt']));
  expect(p.calls.map((c) => c.callee)).not.toContain('Math.random');
});
```

- [ ] **Step 2: Run both files.** Expect red: `system.ts` does not exist.
- [ ] **Step 3: Implement** `system.ts`. The warning line is
  `` `ccrc-server: a scheduled call failed: ${err instanceof Error ? err.message : String(err)}` ``. Keep the
  `setTimeout` handle in a `const` local to `after` (the ring rule reads a module-scope or field handle as a
  scheduler, which would make the file L4).
- [ ] **Step 4: Run both files.** Expect green. Run `test/rings/totality.test.ts`: expect green (`time/**` is K, and
  the file's ring is L3).
- [ ] **Step 5: Commit.**

```bash
git add server/src/time/system.ts server/test/time-ports-contract.test.ts server/test/single-definition/time-ports.test.ts
git commit -m "feat(time): the system adapters for time and chance, held to the fake's contract"
```

Guards: remove the `try`/`catch` and the real row's "a throwing or rejecting call" goes red (the throw escapes
`advanceTimersByTime`); remove `clearTimeout` from the Cancel and "a cancelled call never fires" goes red; drop
`.unref()` and "does not hold the process open" goes red; swap `randomBytes` for `Math.random` and the node:crypto
test goes red; drop `checkDelayMs` and "a delay it cannot keep is refused" goes red on the real row; import
`performance` from `node:perf_hooks` and the real row's "wall and mono move together" goes red.

Mechanical: yes.

### Task 5: The composition root builds the ports once and hands them on `Deps`

**Files:**
- Modify: `server/src/deps.ts#Deps`: add a required `time: TimePorts`
  (`import type { TimePorts } from './time/ports.js'`)
- Modify: `server/src/index.ts`: `import { systemTimePorts } from './time/system.js'`; build
  `const time = systemTimePorts();` once, beside the one `KeyedQueue` above the mode branch, with a comment that it is
  the process's one set of time ports; add `time` to both arms' `deps` literals
- Modify: `server/test/helpers.ts#testDeps`: add `time: fakeTime().ports`
- Modify: every test file with a `Deps` literal that `tsc` checks and that does not spread `testDeps(…)`: about 95
  sites in about 34 files (see "What exists today"). Each site gains `time: fakeTime().ports`, and each file one
  import of `fakeTime`, and nothing else. A literal that spreads `testDeps(…)` (as in `collect-lane-route.test.ts`,
  `step-up.test.ts`, `authRouteRig.ts`, `docs-headers.test.ts`, `update-rollout-follow.test.ts`) needs no edit, and a
  literal cast `as never as Deps` is left alone. The list is whatever
  `cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit` names after the `Deps` edit, each error
  a missing `time`.
- Test: `time-ports.test.ts` (one block)

**Interfaces:**
- Consumes: `systemTimePorts` (Task 4), `fakeTime` (Task 3).
- Produces: `Deps.time: TimePorts`, so `buildServer` and `FleetWatcher` (through `WatcherDeps`) can hand the ports to
  new Overlord and continuity code. Nothing reads it yet.

- [ ] **Step 1: Write the failing test** in `time-ports.test.ts`:

```ts
it('only the composition root takes the system adapters, and it builds them once', () => {
  const ADAPTER = 'server/src/time/system.ts';
  const target = (f: string, spec: string): string =>
    path.posix.join(path.posix.dirname(f), spec.replace(/\.js$/, '.ts'));
  const files = walkSrc({ roots: ['server/src'], min: 150 });
  expect(files.filter((f) => parsedFile(f).imports.some((e) => target(f, e.specifier) === ADAPTER)))
    .toEqual(['server/src/index.ts']);
  expect(parsedFile('server/src/index.ts').calls.filter((c) => c.callee === 'systemTimePorts')).toHaveLength(1);
  expect(files.filter((f) => parsedFile(f).imports.some((e) => /(^|\/)test\//.test(e.specifier)))).toEqual([]);
});
```

- [ ] **Step 2: Run it.** Expect red: `index.ts` does not import the adapter yet.
- [ ] **Step 3: Implement** the modifications above, in that order: `Deps.time` (with a docstring: the process's one
  set of time ports, built by `index.ts`; a test hands `fakeTime().ports`), `index.ts`, `testDeps`, then each site the
  tests' `tsc` names.
- [ ] **Step 4: Run.** The new block: green. `cd server && ./node_modules/.bin/tsc --noEmit`: clean (a `deps` arm
  without `time` fails here). `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`: green (a test
  literal without `time` fails here). `test/sessionws.test.ts`, `test/secret-mask.test.ts` and
  `test/fleet-health.test.ts`: green, unedited but for the field.
- [ ] **Step 5: Commit.**

```bash
git add server/src/deps.ts server/src/index.ts server/test
git commit -m "feat(time): the composition root builds the time ports once and hands them on Deps"
```

Guards: the field is required, so deleting `time` from either `deps` arm is a compile error (`tsc --noEmit`, CI's
`typecheck (server)`); importing `./time/system.js` from any other `server/src` file, calling `systemTimePorts`
twice in `index.ts`, or importing `../test/fakeTime.js` from a `server/src` file turns the block above red.

Mechanical: yes.

### Task 6: The ratchet: new modules read no ambient clock, timer or chance; SQL reads neither anywhere

**Files:**
- Create: `server/test/scan/ambient.ts` (test-side helper)
- Modify: `server/test/single-definition/time-ports.test.ts` (three blocks)

**Interfaces:**
- Consumes: `identifierReferences` (`server/test/scan/parse.ts`), `parsedFile` and `sqlStatementsInFile`
  (`server/test/scan/symbols.ts`), `walkSrc`.
- Produces:

```ts
export interface AmbientUse { line: number; what: string }
/** Every ambient read of time or chance in `text`: `Date.now` (called or passed), `new Date()` and `Date()` with no
 *  argument, any `performance` reference, `process.hrtime` and `process.uptime`, `setTimeout` and `setInterval` (any
 *  reference, an import from `node:timers` or `node:timers/promises` included), `Math.random`, and any reference to
 *  `randomUUID`, `randomBytes`, `randomInt`, `randomFill`, `randomFillSync` or `getRandomValues`. Not ambient:
 *  `new Date(x)`, `Date.parse`, `Date.UTC`, `Date` as a type, and `setImmediate` (a yield, not a timer). */
export function ambientUses(fileName: string, text: string): AmbientUse[];
/** SQL that reads the clock or chance. */
export const SQL_CLOCK: RegExp;   // /\bCURRENT_(?:TIMESTAMP|DATE|TIME)\b|'now'|\bunixepoch\s*\(\s*\)|\brandom\s*\(\s*\)|\brandomblob\s*\(/i
```

The scope is a constant in the test, not the helper:

```ts
/** The NEW Overlord and continuity modules (spec §11.5). A new directory or file family joins by an edit here, in the
 *  pull request that creates it. Today's code is outside it and is not rewritten. */
const TIME_PORT_SCOPE = new RegExp('^(?:server/src/(?:time|overlord|continuity|operatorModel)/'
  + '|server/src/(?:[\\w-]+/)*(?:overlord|continuity)[\\w-]*\\.ts$'
  + '|shared/(?:overlord|continuity)[\\w-]*\\.(?:ts|mjs)$)');
/** The one file allowed to read the ambient sources: the system adapters. */
const THE_ADAPTER = 'server/src/time/system.ts';
```

- [ ] **Step 1: Measure.** On the base, run
  `grep -rniE "current_(timestamp|date|time)|unixepoch|randomblob|random\(\)|'now'" server/src`
  and read each hit: only SQL text counts. Expected: no SQL; the `'now'` hits are TypeScript `Pick<…, 'now'>` keys. If
  SQL hits exist, scope the SQL block to `TIME_PORT_SCOPE` instead and record it under D-8224.
- [ ] **Step 2: Write the failing tests** in `time-ports.test.ts`:

```ts
import { ambientUses, SQL_CLOCK } from '../scan/ambient.js';
import { parseSource, type ParsedFile } from '../scan/parse.js';
import { sqlStatementsInFile } from '../scan/symbols.js';   // merge with the file's existing import of parsedFile

describe('time and chance come through the ports in new Overlord and continuity code (spec §11.5)', () => {
  const RED: ReadonlyArray<readonly [string, string]> = [
    ['Date.now()', 'Date.now'], ['const f = Date.now;', 'Date.now'], ['new Date()', 'new Date()'], ['Date()', 'Date()'],
    ['performance.now()', 'performance'], ['process.hrtime.bigint()', 'process.hrtime'], ['process.uptime()', 'process.uptime'],
    ['setTimeout(f, 1)', 'setTimeout'], ['setInterval(f, 1)', 'setInterval'], ['Math.random()', 'Math.random'],
    ["import { randomUUID } from 'node:crypto';", 'randomUUID'], ['crypto.randomUUID()', 'randomUUID'],
    ['randomBytes(8)', 'randomBytes'], ['randomInt(8)', 'randomInt'], ['crypto.getRandomValues(a)', 'getRandomValues'],
    ["import { setTimeout as wait } from 'node:timers/promises';", 'setTimeout'],
  ];
  const GREEN = ['new Date(ms).toISOString()', 'Date.parse(s)', 'Date.UTC(2026, 0, 1)', 'let d: Date | null = null;',
    'clock.wall()', 'scheduler.after(5, f)', 'entropy.uuid()', 'setImmediate(f)'];

  it.each(RED)('CONTROL: %s is ambient (%s)', (code, what) => {
    expect(ambientUses('fixture.ts', code).map((u) => u.what)).toContain(what);
  });
  it.each(GREEN)('CONTROL: %s is not ambient', (code) => { expect(ambientUses('fixture.ts', code)).toEqual([]); });

  it('CONTROL: the scope', () => {
    for (const f of ['server/src/time/rules.ts', 'server/src/overlord/doors.ts', 'server/src/continuity/lane.ts',
      'server/src/operatorModel/store.ts', 'server/src/coord/overlordActs.ts', 'shared/overlord.ts']) {
      expect(TIME_PORT_SCOPE.test(f), f).toBe(true);
    }
    for (const f of ['server/src/watch.ts', 'server/src/coord/store.ts', 'shared/api.ts']) expect(TIME_PORT_SCOPE.test(f), f).toBe(false);
  });

  it('no scoped file reads an ambient clock, timer or chance', () => {
    const files = walkSrc({ roots: ['server/src', 'shared'], min: 300 })
      .filter((f) => TIME_PORT_SCOPE.test(f) && f !== THE_ADAPTER);
    expect(files.length, 'the scope matched nothing: the walk is over the wrong tree').toBeGreaterThanOrEqual(2);
    const uses = files.flatMap((f) => ambientUses(f, readFileSync(path.join(REPO, f), 'utf8'))
      .map((u) => `${f}:${u.line} ${u.what}`));
    expect(uses).toEqual([]);
  });

  /** Ambient uses inside `CoordStore` methods named for the Overlord or continuity, as `<line> <what>`. */
  const storeMethodUses = (p: ParsedFile): string[] => {
    const spans = p.symbols.filter((s) => /^CoordStore\.\w*(?:overlord|continuity)/i.test(s.name));
    return ambientUses(p.path, p.text).filter((u) => spans.some((s) => s.line <= u.line && u.line <= s.endLine))
      .map((u) => `${u.line} ${u.what}`);
  };
  it('CONTROL: a CoordStore method named for the Overlord that reads Date.now is found; others are not', () => {
    const p = parseSource('class CoordStore {\n  overlordStamp(): number { return Date.now(); }\n'
      + '  other(): number { return Date.now(); }\n}\n', 'store.ts');
    expect(storeMethodUses(p)).toEqual(['2 Date.now']);
  });
  it('CoordStore\'s Overlord and continuity methods read no clock: they take the time as an argument', () => {
    expect(storeMethodUses(parsedFile('server/src/coord/store.ts'))).toEqual([]);
  });
});

describe('SQL never reads the clock or chance (spec §11.5)', () => {
  it.each(["UPDATE t SET at = CURRENT_TIMESTAMP WHERE id = ?", "SELECT strftime('%s','now') FROM t",
    'SELECT unixepoch() FROM t', 'SELECT id FROM t ORDER BY random()', 'INSERT INTO t (k) VALUES (randomblob(16))'])(
    'CONTROL: %s reads one', (sql) => expect(SQL_CLOCK.test(sql)).toBe(true));
  it.each(['UPDATE t SET at = ? WHERE id = ?', 'SELECT now_ms FROM t'])('CONTROL: %s reads none',
    (sql) => expect(SQL_CLOCK.test(sql)).toBe(false));
  it('no statement in server/src', () => {
    const hits = walkSrc({ roots: ['server/src'], min: 150 })
      .flatMap((f) => sqlStatementsInFile(f).filter((s) => SQL_CLOCK.test(s.text)).map((s) => `${f}:${s.line}`));
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it.** Expect red: `scan/ambient.ts` does not exist.
- [ ] **Step 4: Implement** `ambientUses` over `identifierReferences(text, fileName, NAMES)` with
  `NAMES = new Set(['Date', 'performance', 'process', 'Math', 'setTimeout', 'setInterval', 'randomUUID', 'randomBytes',
  'randomInt', 'randomFill', 'randomFillSync', 'getRandomValues'])`, classifying each reference by its `context` (the
  parent node's text):
  - `Date`: not ambient when the context is `Date` alone (a type), starts `Date.parse` or `Date.UTC`, or is a
    `new Date(…)` with an argument. Otherwise ambient, with `what` `Date.now` for a context starting `Date.now`,
    `new Date()` for a `new Date` with no argument, `Date()` for a call, and the context itself for anything else.
  - `process`: ambient only for a context starting `process.hrtime` or `process.uptime`, with that as `what`.
  - `Math`: ambient only for a context starting `Math.random`, `what` `Math.random`.
  - `performance`: always ambient, `what` `performance`.
  - every other name: ambient wherever it appears, `what` the name. An import such as
    `import { setTimeout as wait } from 'node:timers/promises'` is caught by its specifier's `setTimeout`.
  Keep `SQL_CLOCK` exactly as above.
- [ ] **Step 5: Run it.** Expect green: the scope today holds `time/ports.ts` and `time/rules.ts`.
- [ ] **Step 6: Commit.**

```bash
git add server/test/scan/ambient.ts server/test/single-definition/time-ports.test.ts
git commit -m "test(time): new Overlord and continuity modules read no ambient clock, timer or chance; SQL reads none"
```

Guards: delete a name from `NAMES` and its `RED` row goes red; narrow `TIME_PORT_SCOPE` and the scope CONTROL goes red;
plant `Date.now()` in `server/src/time/rules.ts` and "no scoped file" goes red; drop the method-name filter from
`storeMethodUses` and its CONTROL goes red (the `other` method is counted); plant `CURRENT_TIMESTAMP` in any SQL string
and "no statement in server/src" goes red. The `CoordStore` block passes over nothing today: no such method exists yet,
and its CONTROL is what proves it would see one.

Mechanical: mostly. Judgement: the `context` classification of `Date` in `ambientUses` (the fixtures pin it).

## Deviations found

The programme's run (1774) minted these numbers on 2026-11-11. They are defined in the programme's index plan,
`docs/superpowers/plans/2026-11-10-overlord.md`; each entry here gives the whole decision, after its number and old slug.

- **D-8221, lane-clocks-is-clock, consolidation** — `laneRunner.ts`'s `LaneClocks` is deleted and `LaneRunner` takes
  `Clock`: one definition of the two-clock shape. A type change only; `lane-schedule.test.ts` and
  `disk-retention-beats.test.ts` run unedited.
- **D-8222, scheduler-is-one-shot, shape** — `Scheduler` has `after` only. A cadence is a `LANE_SCHEDULE` row run by
  `LaneRunner`, and a deadline is a column read through `Clock`, so a repeating timer here would be a second lane
  mechanism.
- **D-8223, time-bounds, values the spec does not pin** — `TIMER_MAX_MS` 2,147,483,647 (Node's ceiling, refused rather
  than clamped to 1 ms); `ENTROPY_MIN_BYTES` 16 and `ENTROPY_MAX_BYTES` 1024; `ENTROPY_MAX_BOUND` 2^32.
- **D-8224, sql-clock-repo-wide, tightening** — "SQL never reads the clock" is held over all of `server/src`, because
  today's count is zero (measured in Task 6 Step 1). Chance in SQL (`random()`, `randomblob`) is held with it.
- **D-8225, one-mulberry32, consolidation** — the test tree holds nine local copies of `mulberry32` today
  (`docs-grammar`, `child-reclaim-sweep-policy`, `child-reclaim-sweep`, `child-reclaim-persistent-tier`,
  `delegation-recovery`, `delegation-model`, `delegation-correlation`, `delegation-correlation-cost`,
  `delegation-correlation-bound`). The fake does not add a tenth: `server/test/fakeTime.ts` exports one, copied
  verbatim, and the move of the nine onto it is the simulator piece's characterized move.
- **D-8226, deps-time-required, shape** — `Deps.time` is required, so the composition root cannot omit it. About 95
  type-checked `Deps` literals in about 34 test files gain the field; literals that spread `testDeps` get it from there.
- **D-8227, two-monotonic-readers, open consolidation** — `Deps.monotonicMs` (a test seam, unset in production) and
  `Deps.time.clock.mono` both carry the monotonic clock until the first is folded into the second. This is not a
  "legitimately different" pair: it is one fact with two carriers, kept only because folding it rewrites the watcher's
  lane wiring and the 36 test files that set `monotonicMs` (33 call `withFakeClock`). See the fourth question below.
- **D-8232, sql-clock-reads-argumentless-date-functions, tightening** — the plan pinned `SQL_CLOCK`, but the
  whole-branch review measured on `node:sqlite` that `datetime()`, `date()`, `time()`, `julianday()` and
  `strftime('<format>')` with no time value all answer the current time, and the pinned pattern let every one of them
  through. `SQL_CLOCK` now also matches those functions called with no argument, `strftime` with a format alone, and
  any of them given `'subsec'` or `'subsecond'` as the only time value (review 1780's F3).
  Called with a time value (`datetime(at, 'unixepoch')`, `strftime('%s', at)`, `date(at)`) they still pass. Today's
  count in `server/src` stays zero, so D-8224's repo-wide scope holds.
- **D-8233, ambient-scan-sees-abort-timeouts-and-timer-modules, tightening** — `ambientUses` also reports
  `AbortSignal.timeout(…)` (a timer, and the usual way to bound a `fetch`), and any value import of `node:timers` or
  `node:timers/promises`, by its specifier. A name list cannot catch the second: `scheduler.wait` from
  `node:timers/promises` shares its name with the `Scheduler` port. After review 1780 (F1), the `process`, `Math` and
  `AbortSignal` arms also accept a `globalThis.` prefix and optional chaining, and a value import of `node:process` is
  reported by its specifier. An alias of `process`, bracket access and destructuring are recorded gaps.
- **D-8234, fake-refuses-re-entry, shape** — `fakeTime`'s `advance` and `restart` throw `RangeError` when a scheduled
  call calls them. Without it, a firing call that re-entered them moved mono backwards, or counted a restart's wall gap
  twice, and nothing reported it. The simulator piece models a restart as a step it takes between calls, never as a
  call it schedules.

**Settled by the spec's later edition, so no longer deviations:** the three ports are declared
once in the clock kernel, K (§3.6 H2). The scan covers the new Overlord and continuity modules, and existing code is
not rewritten for it (§11.5); `TIME_PORT_SCOPE` names those modules and grows by edit as they land.

## Where things stand

**Before it starts:** nothing. It needs only today's `main`; W1a waits on neither prerequisite (§14).

**Order:** this piece lands first. The simulator piece (`w1a-simulator.md`) builds on its ports
(`server/src/time/ports.ts`), its fake (`fakeTime`) and its seeded generator (`mulberry32` in
`server/test/fakeTime.ts`), defines none of them again, and needs this piece merged before it starts.

**What depends on it:** every W1a piece that reads time or chance (the renewal lane and its durable deadlines, the note
and probe doors, the act key's draw, the trigger table's stall arms) and the simulator's skeleton, which runs on
`fakeTime`. Each takes `TimePorts` from `Deps.time` or from the composition root, and each new directory joins
`TIME_PORT_SCOPE` in the pull request that creates it.

**Open questions for the operator, most important first:**

1. **Where do the other W1a and W1 pieces put their files?** The scope assumes `server/src/overlord/` (C5),
   `server/src/continuity/` (C3), `server/src/operatorModel/` (C10's own directory; §11.1 gives it one but does not
   name it), and files named `overlord*` or `continuity*` elsewhere. The other W1a drafts so far put their files in
   `server/src/coord/` (`mailPace.ts`, `practiceCases.ts`, `casesLane.ts`), `server/src/roleOf.ts` and `shared/`
   (`fleetRoles.ts`, `practice-triggers.ts`), none of which the scope reaches. Recommendation: the programme fixes
   these names before W1a's first merge, and each piece's plan names its directory; `TIME_PORT_SCOPE` and the context
   table follow them.
2. **Is a required `Deps.time` worth about 95 one-line edits across about 34 test files, before anything reads it?**
   Recommendation: yes. The compiler is then the guard that the composition root hands the ports on, and the edits are
   mechanical. The alternative, an optional field, would make every reader choose a default, which is a second
   construction.
3. **Observed time** (§11.5: a timer whose expiry permits something counts only time the server observed). `mono` does
   not survive a restart. It is first needed in W1a, not W3: Table 11.5b's renewal hold-off (10 minutes), a
   generation's least age (30 minutes) and the soft renewal budget (three in six hours) are W1a rows on the observed
   clock. Settled: the renewal lane's piece adds one L1 accumulator to `time/rules.ts` (observed milliseconds as
   a stored column, advanced by mono deltas within one process and never across a gap), never a second clock (§11.5).
4. **When is `Deps.monotonicMs` folded into `Deps.time.clock`?** Recommendation: in the simulator skeleton's piece, as
   a characterized move (the lane suites green first, then the watcher's runner reads `deps.time.clock`, then the field
   goes), because the simulator needs the watcher's runner on the fake clock anyway.
5. **Should the fake also drive vitest's fake timers**, so legacy code under a simulator run reads the same time?
   Today's lanes are throttled on `Date.now()` and `performance.now()` in `watch.ts`, and the questions owner, where
   W3's holds land, stamps `Date.now()` inline, so "the real lanes on a fake clock" (§11.7) does not hold for them.
   Recommendation: decide in the simulator piece; this fake stays independent of vitest.
6. **Should the two existing per-file ambient scans** (`delegation-compaction.test.ts`, `delegation-policy.test.ts`)
   call `ambientUses`? Recommendation: yes, later, in a test-only pull request; they are not in this piece's way.
