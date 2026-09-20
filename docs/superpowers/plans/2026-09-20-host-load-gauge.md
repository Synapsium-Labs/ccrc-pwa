# Host Load Gauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put one instrument in ccrc's accounts strip that reads the load on the box the sessions actually run on — CPU with its two hottest threads, and memory split used/cache/swap — and never shows a zero it did not measure.

**Architecture:** One L0 module (`shared/hoststat.ts`) owns the `/proc` parsers and the sampling algorithm with its reader, clock and sleep injected, so the fleet box and a local-mode server compute identical numbers from identical text. The agent exposes it as one additive, PATHLESS frame (`op: 'hostStat'`) — `/proc` is never added to the read whitelist. The server wraps two adapters (agent / local io) behind one port with a 5s cache and a shared in-flight request, and serves `GET /api/host`. The PWA polls that route every 6s and draws one tile pinned to the right edge of the strip.

**Tech Stack:** TypeScript (ESM, `"type":"module"` per package), Node ≥22.13, Fastify 5, React 19 + vitest/jsdom, no new dependencies in any package.

**Spec:** `docs/superpowers/specs/2026-09-20-host-load-gauge-design.md` — read it first; its §2.1 lists nine decisions the operator made and two he reversed mid-review. This plan argues from it.

## Working context

- Work happens in THIS ccd-managed worktree (`/home/expo/worktrees/ccrc-pwa/swift-canyon`) on its
  workspace branch. Do NOT create a second git worktree: ccd owns workspaces, and the isolation the
  `using-git-worktrees` skill asks for already exists here.
- A suite-green REFERENCE implementation of this whole plan is parked on `wip/host-load-gauge`
  (`33f10b54`). Every code block below is that code. Read the reference when a step is unclear
  (`git show wip/host-load-gauge:<path>`), but write the test first and let it fail first — the point
  of this lane is that the tests are earned, not copied in behind a green suite.
- `npm ci` cannot finish here (`node-pty` needs `make`, absent). If `node_modules` is missing in
  `server/` or `agent/`, copy it from a sibling worktree: `cp -a ../bright-canyon/server/node_modules
  server/node_modules` (its `ccrc-agent` entry is a RELATIVE symlink and repoints itself).
- Run one suite as `cd <pkg> && ./node_modules/.bin/vitest run test/<file>` — never bare `npx vitest`.
  Full suites run in the FOREGROUND with a ≥600000ms timeout.
- `strace` is absent here, so `server/test/session-hook.test.ts`'s five strace tests fail on every
  branch. That is the box, not your change.

## Global Constraints

- **L0 purity:** `shared/*.ts` imports no runtime module and no `node:*` — the PWA bundles that tree.
  `shared/hoststat.ts` may import TYPES from `shared/agent-protocol.ts` and nothing else.
- **Wire discipline:** frames are ADDITIVE. Do NOT bump `FLEET_PROTO` (=1) for a new op or field.
- **Exec/read surface is closed:** `EXEC_COMMANDS = ['tmux','ccd']` stays as it is, and `/proc` is
  NEVER added to the agent's read whitelist (`agent/src/whitelist.ts`).
- **No overloaded null at a seam:** two conditions a caller handles differently may not collapse to
  one value. The six failure conditions are `absent | unreadable | unparsable | unsupported | offline
  | timeout`.
- **An adapter may not narrow a distinction it received:** the per-CPU list crosses every seam whole;
  the "two hottest" reduction happens in the component.
- **Single definition:** `server/test/single-definition.test.ts` text-scans `shared/`, `server/src`,
  `pwa/src`, `agent/src` and fails the build on a second copy of an enumerated value.
- **Mutation-table discipline:** every guard ships with a test that goes RED when the guard is
  deleted. TDD, red first, measured — not asserted in a comment.
- **Deviation numbers are ISSUED, never chosen:** `POST /api/ledger/deviations` mints them. A session
  that cannot reach it writes `D-TBD-<slug>` and reports. Do not copy a number out of another file.
- **AGENT-FIRST:** this touches `agent/`, so the agent lane deploys before the server lane.
- Node floor `>=22.13.0` across all three engines — do not touch it.

## Review Focus

Five input classes the spec implies, that the obvious tests would miss, each with the test that pins
it folded into the task that owns the code:

1. **A `why` token this build has never heard of** (a newer server naming a seventh condition) must
   still render a word, not `undefined`. The union is closed at compile time and open on the wire —
   absence-permits cuts both ways. → Task 6.
2. **Counters that go backwards between two samples** (a reboot, or a 32-bit wrap) must read
   `unparsable`, never a negative or a wrapped-around percentage. → Task 1.
3. **`Shmem` larger than `Cached + SReclaimable`** would make cache negative; it must clamp to zero
   AND leave used+cache+free still summing to the total, or the bar overflows its track. → Task 1.
4. **A 128-thread box**: the two hottest must be picked correctly out of the whole list, and the tile
   must still draw exactly two ticks. → Tasks 1 and 6.
5. **A version-skewed agent answering a well-formed frame with a garbled `stat` payload** must become
   `unparsable`, never a half-built reading handed to the PWA. → Task 4.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `shared/hoststat.ts` | L0: the failure vocabulary, the wire shapes, the `/proc` parsers, the sampler |
| `agent/src/hoststat.ts` | binds the sampler to `node:fs` + node's clock — ~25 lines, no logic |
| `server/src/hoststat.ts` | the `HostStatPort`, its local and remote adapters, and the cache |
| `pwa/src/fleet/HostGauge.tsx` | the tile |
| `server/test/hoststat.test.ts` | parsers + sampler (Tasks 1–2) |
| `server/test/host-port.test.ts` | port, adapters, cache (Task 4) |
| `server/test/host-route.test.ts` | `GET /api/host` (Task 5) |
| `agent/test/hoststat.test.ts` | the op, and the whitelist guard (Task 3) |
| `pwa/test/host-gauge.test.tsx` | the tile, its states, its placement (Tasks 6–7) |

**Modified**

| File | Change |
|---|---|
| `shared/agent-protocol.ts` | `HostStatReq`, the `AgentReq` union, the payload census comment |
| `agent/src/fileops.ts` | `readWholeMeasured`; `readWhole` derives from it |
| `agent/src/server.ts` | `procRoot` option, `ConnCtx.hostStat`, the `hostStat` case in both switches |
| `server/src/server.ts` | `Deps.hostStat`, `GET /api/host` |
| `server/src/index.ts` | builds the port in both modes |
| `server/src/auth/gate.ts` | route-count docstring |
| `server/test/auth-gate.test.ts` | the four pinned route counts |
| `pwa/src/lib/api.ts` | `host()` |
| `pwa/src/fleet/fleet.css` | the tile's styles |
| `pwa/src/styles/shell.css` | the desktop bar's two columns and the fixed host column |
| `pwa/src/app.tsx` | desktop mount |
| `pwa/src/screens/FleetScreen.tsx` | phone mount |
| `pwa/design/audit.mjs` | contrast grounds for the four new colour rules |
| `README.md` | the operator-facing section |

---

## Task 1: The L0 vocabulary and the `/proc` parsers

**Files:**
- Create: `shared/hoststat.ts`
- Test: `server/test/hoststat.test.ts`

**Interfaces:**
- Consumes: `ReadFailure` from `shared/agent-protocol.ts` (type-only).
- Produces: `HostStatFailure`, `CpuTimes`, `CpuSample`, `CpuLoad`, `HostCpuReading`, `HostMemReading`,
  `HostCpu`, `HostMem`, `HostStat`, `HostFileRead`, `HostProbe`, `HostSamplerOptions`,
  `parseProcStat(text): CpuSample | null`, `cpuBetween(prev, next): HostCpuReading | null`,
  `hottestCpus(perCpu, n): readonly CpuLoad[]`, `parseMeminfo(text): HostMemReading | null`,
  `hostStatFailed(why, at): HostStat`.

- [ ] **Step 1: Write the failing test**

Create `server/test/hoststat.test.ts`:

```ts
// The host reading, from /proc text to the wire.
//
// Every guard in `shared/hoststat.ts` is here with a case that goes RED when the
// guard is deleted — the parsers' `null`s especially, because each one stands
// between the widget and a fabricated zero. The distinction these tests exist to
// protect: NOT MEASURED is not 0%.
import { describe, it, expect } from 'vitest';
import {
  cpuBetween,
  hostStatFailed,
  hottestCpus,
  parseMeminfo,
  parseProcStat,
} from '../../shared/hoststat.js';

// Two readings of a two-CPU box 100 jiffies apart: the box is 50% busy over the
// window, cpu0 spent all of it working and cpu1 spent all of it idle. Numbers
// chosen so every assertion is exact.
export const STAT_A = [
  'cpu  1000 0 500 8000 100 0 0 0 0 0',
  'cpu0 500 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4000 50 0 0 0 0 0',
  'intr 98765 1 2 3',
  'ctxt 4242',
].join('\n');

export const STAT_B = [
  'cpu  1100 0 500 8100 100 0 0 0 0 0',
  'cpu0 600 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4100 50 0 0 0 0 0',
  'intr 98999 1 2 3',
  'ctxt 4343',
].join('\n');

export const MEMINFO = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          4000000 kB',
  'SwapCached:            0 kB',
  'SwapTotal:       2000000 kB',
  'SwapFree:        1500000 kB',
  'SReclaimable:     500000 kB',
  'Shmem:            200000 kB',
  '',
].join('\n');

describe('parseProcStat', () => {
  it('reads ids from the NAMES, so an offline CPU cannot shift the others', () => {
    // cpu1 is offline: the kernel omits its line entirely. Positionally, cpu2 is
    // "the second one"; by id it is cpu2, and a widget that says "#2 is pegged"
    // has to mean the CPU the operator can go and look at.
    const s = parseProcStat(['cpu  10 0 10 80 0', 'cpu0 5 0 5 40 0', 'cpu2 5 0 5 40 0'].join('\n'));
    expect(s?.cpus.map((c) => c.id)).toEqual([0, 2]);
  });

  it('counts iowait as IDLE — a disk-bound box is waiting, not working', () => {
    const busyOnly = parseProcStat('cpu  100 0 0 0 0');
    const allIowait = parseProcStat('cpu  0 0 0 0 100');
    expect(busyOnly?.all.busy).toBe(100);
    expect(allIowait?.all.busy).toBe(0);
    expect(allIowait?.all.total).toBe(100);
  });

  it('answers null — never an empty reading — for a shape it does not understand', () => {
    expect(parseProcStat('')).toBeNull();
    expect(parseProcStat('intr 1 2 3\nctxt 9')).toBeNull();       // no cpu line at all
    expect(parseProcStat('cpu0 1 2 3 4\nintr 1')).toBeNull();     // no aggregate line
    expect(parseProcStat('cpu  1 2 3')).toBeNull();               // too few columns
    expect(parseProcStat('cpu  1 2 three 4')).toBeNull();         // not a number
    expect(parseProcStat('cpu  1 2 3 -4')).toBeNull();            // counters do not go negative
  });
});

describe('parseMeminfo', () => {
  it('splits memory the way htop does — used, reclaimable cache, swap', () => {
    const m = parseMeminfo(MEMINFO);
    expect(m).not.toBeNull();
    expect(m?.cacheKb).toBe(500000 + 4000000 + 500000 - 200000);
    expect(m?.usedKb).toBe(16000000 - 2000000 - 4800000);
    expect((m?.usedKb ?? 0) + (m?.cacheKb ?? 0) + 2000000).toBe(m?.totalKb);
    expect(m?.swapUsedKb).toBe(500000);
    expect(m?.availableKb).toBe(6000000);
  });

  it('derives MemAvailable when the kernel does not report it, and reads no swap as zero', () => {
    const m = parseMeminfo([
      'MemTotal:        1000 kB', 'MemFree:          400 kB', 'Buffers:          100 kB', 'Cached:           100 kB',
    ].join('\n'));
    expect(m?.availableKb).toBe(600);
    expect(m?.swapTotalKb).toBe(0);
    expect(m?.swapUsedKb).toBe(0);
  });

  // REVIEW FOCUS 3: a box where Shmem outweighs the reclaimable pools. Cache
  // must clamp to zero AND the three segments must still sum to the total, or
  // the bar overflows its own track.
  it('clamps a negative cache to zero and keeps the three segments summing to the total', () => {
    const m = parseMeminfo([
      'MemTotal:        1000 kB', 'MemFree:          400 kB', 'Buffers:            0 kB',
      'Cached:           100 kB', 'SReclaimable:       0 kB', 'Shmem:            900 kB',
    ].join('\n'));
    expect(m?.cacheKb).toBe(0);
    expect(m?.usedKb).toBe(600);
    expect((m?.usedKb ?? 0) + (m?.cacheKb ?? 0) + 400).toBe(1000);
  });

  it('answers null when a field the split needs is missing', () => {
    expect(parseMeminfo('MemFree: 400 kB\nBuffers: 1 kB\nCached: 1 kB')).toBeNull();
    expect(parseMeminfo('MemTotal: 0 kB\nMemFree: 0 kB\nBuffers: 0 kB\nCached: 0 kB')).toBeNull();
    expect(parseMeminfo('')).toBeNull();
  });
});

describe('cpuBetween', () => {
  const a = { ...parseProcStat(STAT_A)!, at: 1000 };
  const b = { ...parseProcStat(STAT_B)!, at: 6000 };

  it('measures the window, per CPU, by id', () => {
    const r = cpuBetween(a, b);
    expect(r?.total).toBe(50);
    expect(r?.windowMs).toBe(5000);
    expect(r?.perCpu).toEqual([{ id: 0, pct: 100 }, { id: 1, pct: 0 }]);
  });

  it('drops a CPU that appears in only one sample rather than reading its whole counter as one window', () => {
    const grown = { ...parseProcStat([STAT_B, 'cpu2 900 0 100 10 0'].join('\n'))!, at: 6000 };
    expect(cpuBetween(a, grown)?.perCpu.map((c) => c.id)).toEqual([0, 1]);
  });

  // REVIEW FOCUS 2: a reboot or a counter wrap between two samples.
  it('answers null when the pair says nothing — a still counter is not a zero, and a rewound one is not a reading', () => {
    expect(cpuBetween(a, { ...a, at: 6000 })).toBeNull();   // counters did not move
    expect(cpuBetween(b, { ...a, at: 6000 })).toBeNull();   // went backwards
    expect(cpuBetween(a, { ...b, at: 1000 })).toBeNull();   // no window
  });
});

describe('hottestCpus', () => {
  it('is hottest-first and breaks ties by id, so two equal threads do not swap places between polls', () => {
    const load = [{ id: 0, pct: 40 }, { id: 3, pct: 91 }, { id: 7, pct: 91 }, { id: 5, pct: 78 }];
    expect(hottestCpus(load, 2)).toEqual([{ id: 3, pct: 91 }, { id: 7, pct: 91 }]);
  });

  // REVIEW FOCUS 4: a 128-thread box. The reduction must look at the whole list.
  it('finds the two hottest in a 128-thread list wherever they sit', () => {
    const many = Array.from({ length: 128 }, (_, id) => ({ id, pct: id === 97 ? 99 : id === 12 ? 96 : 3 }));
    expect(hottestCpus(many, 2)).toEqual([{ id: 97, pct: 99 }, { id: 12, pct: 96 }]);
  });
});

describe('hostStatFailed', () => {
  it('fails both halves with one reason, from one writer', () => {
    const stat = hostStatFailed('offline', 42);
    expect(stat).toEqual({ at: 42, cpu: { ok: false, why: 'offline' }, mem: { ok: false, why: 'offline' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/hoststat.test.ts`
Expected: FAIL — `Failed to resolve import "../../shared/hoststat.js"`.

- [ ] **Step 3: Write the module**

Create `shared/hoststat.ts` with exactly this content:

```ts
// Host load — what the box the SESSIONS run on is actually doing: overall CPU,
// every logical CPU's own share (so a single pegged thread is visible behind a
// calm average), and one memory reading split the way htop splits it.
//
// L0, so this file imports no runtime module and no `node:*` (the PWA bundles
// it). That constraint is what makes ONE implementation serve both boxes: the
// parsers are pure text, and the sampler takes its reader, its clock and its
// sleep as arguments. The agent injects `node:fs` (agent/src/hoststat.ts), a
// local-mode server injects its own `FleetIO` (server/src/hoststat.ts), and a
// test injects a map of strings — nobody re-implements the algorithm, so there
// is nothing for the two boxes to disagree about.
//
// WHY A DEDICATED AGENT OP AND NOT TWO `read`s: `/proc` is not on the agent's
// read whitelist and must not be put there (agent/src/whitelist.ts refuses a
// widened read root by design). Sampling on the box also keeps the two /proc
// reads a fixed interval apart — over the WS they would be two round trips
// apart, which is a window nobody measured.
import type { ReadFailure } from './agent-protocol.js';

/**
 * Why a reading is missing. SIX conditions, never collapsed into one silence,
 * because a reader (and an operator) acts differently on each:
 *
 *  - `absent`      — `/proc/stat` is genuinely not there: not a Linux box.
 *  - `unreadable`  — it IS there and this process cannot read it (EACCES).
 *  - `unparsable`  — read fine, shape not understood.
 *  - `unsupported` — the agent on the fleet box predates the `hostStat` op.
 *  - `offline`     — no agent link at all. Nothing was asked.
 *  - `timeout`     — asked, nothing came back inside the request budget.
 *
 * The first three are answers from the box itself and cross the wire; the last
 * three are the SERVER's own account of why it has nothing. `ReadFailure` is
 * imported rather than restated so `absent`/`unreadable` keep meaning exactly
 * what every other read on this wire means by them.
 */
export type HostStatFailure = ReadFailure | 'unparsable' | 'unsupported' | 'offline' | 'timeout';

/** One CPU's jiffy counters at one instant. `id` is the number in the
 *  `/proc/stat` line's name (`cpu7` → 7), never the line's position: an
 *  offline CPU is simply absent from the file, so positions shift under you
 *  and ids do not. `-1` is the aggregate `cpu` line. */
export interface CpuTimes {
  readonly id: number;
  readonly busy: number;
  readonly total: number;
}

/** One whole `/proc/stat` reading, stamped with when it was taken. */
export interface CpuSample {
  readonly at: number;
  readonly all: CpuTimes;
  readonly cpus: readonly CpuTimes[];
}

/** One logical CPU's load over a window, 0..100. */
export interface CpuLoad {
  readonly id: number;
  readonly pct: number;
}

export interface HostCpuReading {
  /** The whole box over `windowMs`, from the aggregate `cpu` line — not the
   *  mean of `perCpu`, which drifts from it when a CPU goes offline mid-window. */
  readonly total: number;
  /** Every logical CPU, in id order. Carried WHOLE rather than pre-reduced to
   *  the two hottest: the reduction is a rendering decision, and an adapter may
   *  not narrow a distinction it received. */
  readonly perCpu: readonly CpuLoad[];
  /** The interval the percentages actually cover, so a reader can tell a 400ms
   *  burst reading from a smooth 6s one instead of assuming a cadence. */
  readonly windowMs: number;
}

export interface HostMemReading {
  readonly totalKb: number;
  /** htop's "used": everything that is neither free nor reclaimable. Shared
   *  memory (Shmem) counts here, as it does in htop. */
  readonly usedKb: number;
  /** Buffers + Cached + SReclaimable − Shmem: the part the kernel will hand
   *  back under pressure. Drawn as its own segment because "94% full" means
   *  nothing until you know which half of it is cache. */
  readonly cacheKb: number;
  /** MemAvailable when the kernel reports it, else free + cache. */
  readonly availableKb: number;
  readonly swapTotalKb: number;
  readonly swapUsedKb: number;
}

export type HostCpu =
  | ({ readonly ok: true } & HostCpuReading)
  | { readonly ok: false; readonly why: HostStatFailure };

export type HostMem =
  | ({ readonly ok: true } & HostMemReading)
  | { readonly ok: false; readonly why: HostStatFailure };

/**
 * One reading of one host. CPU and memory fail INDEPENDENTLY on purpose: a box
 * that answers `/proc/meminfo` and not `/proc/stat` should show the memory bar
 * and say why the other line is missing, rather than going dark on both.
 *
 * `at` is stamped by whoever produced the reading; the server restamps it with
 * its own clock before it reaches the PWA, so the staleness the widget shows is
 * measured against one clock and not against the fleet box's.
 */
export interface HostStat {
  readonly at: number;
  readonly cpu: HostCpu;
  readonly mem: HostMem;
}

/** What a reader hands the sampler: content, or WHICH failure it was. */
export type HostFileRead =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: ReadFailure };

export interface HostProbe {
  read(path: string): Promise<HostFileRead>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface HostSamplerOptions {
  /** Default `/proc`. A test points this at a fixture directory. */
  procRoot?: string;
  /** How far apart the two samples are taken when there is no usable previous
   *  one. Short enough not to stall a poll, long enough that the jiffy deltas
   *  are not noise. */
  windowMs?: number;
  /** A previous sample younger than this is treated as the SAME instant —
   *  reusing it would divide by a near-zero window. */
  reuseMinMs?: number;
  /** A previous sample older than this is stale: counters may have wrapped or
   *  the box may have rebooted, so a fresh pair is taken instead. */
  reuseMaxMs?: number;
}

export const HOST_WINDOW_MS = 400;
export const HOST_REUSE_MIN_MS = 900;
export const HOST_REUSE_MAX_MS = 60_000;

const clampPct = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/**
 * `/proc/stat`'s CPU lines. `null` means UNPARSABLE — the caller must not read
 * it as "no CPUs", which is why the empty case answers `null` too: a file with
 * no `cpu` line at all is a shape this parser does not understand, never a box
 * with nothing to report.
 *
 * Columns: user nice system idle iowait irq softirq steal guest guest_nice.
 * Idle time is `idle + iowait` — a CPU waiting on IO is not doing work, and
 * counting iowait as busy is how a disk-bound box reads as pegged. Columns past
 * the fourth are optional: a kernel that prints fewer still parses, the missing
 * ones reading as zero, which is exactly what they mean.
 */
export function parseProcStat(text: string): CpuSample | null {
  let all: CpuTimes | null = null;
  const cpus: CpuTimes[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.startsWith('cpu')) continue;
    const parts = raw.trim().split(/\s+/);
    // `?? ''` and the `?? 0`s below are the tsconfig's `noUncheckedIndexedAccess`
    // being honest: a split can hand back a shorter array than the shape this
    // parser expects, and the empty name simply matches no branch.
    const name = parts[0] ?? '';
    const aggregate = name === 'cpu';
    if (!aggregate && !/^cpu\d+$/.test(name)) continue;
    const nums = parts.slice(1).map(Number);
    // Four columns is the floor (user nice system idle); anything non-finite or
    // negative is a shape this parser has no business guessing at.
    if (nums.length < 4 || nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    const total = nums.reduce((a, b) => a + b, 0);
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
    const times: CpuTimes = { id: aggregate ? -1 : Number(name.slice(3)), busy: total - idle, total };
    if (aggregate) all = times;
    else cpus.push(times);
  }
  if (all === null) return null;
  return { at: 0, all, cpus: cpus.sort((a, b) => a.id - b.id) };
}

/** One CPU's percentage between two readings of its counters. `null` when the
 *  counters did not move (a window too short to say anything) or went
 *  backwards (a reboot, or a counter wrap) — never 0%, which is a measurement
 *  and this is the absence of one. */
function pctBetween(prev: CpuTimes, next: CpuTimes): number | null {
  const total = next.total - prev.total;
  const busy = next.busy - prev.busy;
  if (total <= 0 || busy < 0) return null;
  return clampPct((busy / total) * 100);
}

/**
 * The load between two samples. `null` when the pair says nothing — the caller
 * then takes a fresh pair rather than publishing a made-up zero.
 *
 * Per-CPU entries are matched BY ID, and an id present in only one of the two
 * samples is dropped: a CPU that came online mid-window has no delta, and
 * pretending its whole counter is one window's work would draw it as 100%.
 */
export function cpuBetween(prev: CpuSample, next: CpuSample): HostCpuReading | null {
  const windowMs = next.at - prev.at;
  if (windowMs <= 0) return null;
  const total = pctBetween(prev.all, next.all);
  if (total === null) return null;
  const before = new Map(prev.cpus.map((c) => [c.id, c]));
  const perCpu: CpuLoad[] = [];
  for (const c of next.cpus) {
    const was = before.get(c.id);
    if (was === undefined) continue;
    const pct = pctBetween(was, c);
    if (pct !== null) perCpu.push({ id: c.id, pct });
  }
  return { total, perCpu, windowMs };
}

/** The `n` busiest logical CPUs, hottest first, ties broken by id so the
 *  widget's two readouts do not swap places between polls at equal load. */
export function hottestCpus(perCpu: readonly CpuLoad[], n: number): readonly CpuLoad[] {
  return [...perCpu].sort((a, b) => (b.pct - a.pct) || (a.id - b.id)).slice(0, Math.max(0, n));
}

const KB_LINE = /^(\w+):\s+(\d+)\s*kB$/;

/**
 * `/proc/meminfo`. `null` is UNPARSABLE, and the four fields it insists on —
 * MemTotal, MemFree, Buffers, Cached — are the ones the split cannot be
 * computed without. SReclaimable and Shmem default to zero because a kernel old
 * enough to omit them genuinely has nothing to subtract; Swap* default to zero
 * because a box with swap off reports zero anyway. MemAvailable is derived when
 * missing rather than demanded.
 */
export function parseMeminfo(text: string): HostMemReading | null {
  const kb = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const m = KB_LINE.exec(raw.trim());
    const key = m?.[1];
    const value = Number(m?.[2]);
    if (key !== undefined && Number.isFinite(value)) kb.set(key, value);
  }
  const total = kb.get('MemTotal');
  const free = kb.get('MemFree');
  const buffers = kb.get('Buffers');
  const cached = kb.get('Cached');
  if (total === undefined || free === undefined || buffers === undefined || cached === undefined) return null;
  if (total <= 0) return null;
  const reclaimable = kb.get('SReclaimable') ?? 0;
  const shmem = kb.get('Shmem') ?? 0;
  const swapTotalKb = kb.get('SwapTotal') ?? 0;
  const swapFree = kb.get('SwapFree') ?? swapTotalKb;
  // Clamped, then `used` is computed FROM the clamped cache, so the three
  // segments always sum to the total and the bar can never overflow its track.
  const cacheKb = Math.max(0, Math.min(total - free, buffers + cached + reclaimable - shmem));
  const usedKb = Math.max(0, total - free - cacheKb);
  return {
    totalKb: total,
    usedKb,
    cacheKb,
    availableKb: kb.get('MemAvailable') ?? free + cacheKb,
    swapTotalKb,
    swapUsedKb: Math.max(0, swapTotalKb - swapFree),
  };
}

/** A whole reading that failed for one reason — the shape every adapter
 *  answers with when it never got as far as the box (`offline`, `timeout`,
 *  `unsupported`). One writer, so the two halves can never drift apart. */
export function hostStatFailed(why: HostStatFailure, at: number): HostStat {
  return { at, cpu: { ok: false, why }, mem: { ok: false, why } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/hoststat.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck both trees that compile this file**

Run: `cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && cd ../pwa && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output. (`noUncheckedIndexedAccess` is on in the PWA tree — the `?? ''`/`?? 0` guards above are why this passes.)

- [ ] **Step 6: Commit**

```bash
git add shared/hoststat.ts server/test/hoststat.test.ts
git commit -m "feat(shared): /proc parsers for the host-load reading

Ids come from the line NAMES, iowait counts as idle, and every shape the
parser does not understand answers null rather than an empty reading — a
fabricated zero is indistinguishable from an idle box."
```

---

## Task 2: The sampler

**Files:**
- Modify: `shared/hoststat.ts` (append `createHostSampler`)
- Test: `server/test/hoststat.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: Task 1's `HostProbe`, `parseProcStat`, `parseMeminfo`, `cpuBetween`.
- Produces: `createHostSampler(probe: HostProbe, opts?: HostSamplerOptions): () => Promise<HostStat>`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/hoststat.test.ts`. Its import block gains the sampler and three types — the
fixtures (`STAT_A`, `STAT_B`, `MEMINFO`) are already exported from Task 1's half of this file:

```ts
import {
  createHostSampler,
  cpuBetween,
  hostStatFailed,
  hottestCpus,
  parseMeminfo,
  parseProcStat,
  type HostFileRead,
  type HostProbe,
  type HostStatFailure,
} from '../../shared/hoststat.js';
```


```ts
/** A probe with no clock of its own: `sleep` ADVANCES the fake clock, so a test
 *  can assert the window a reading claims without waiting for it. */
function fakeProbe(plan: {
  stat?: readonly (string | HostStatFailure)[];
  meminfo?: string | HostStatFailure;
  startAt?: number;
}): { probe: HostProbe; reads: string[]; clock: { t: number } } {
  const reads: string[] = [];
  const clock = { t: plan.startAt ?? 1_000_000 };
  let statIndex = 0;
  const answer = (v: string | HostStatFailure | undefined): HostFileRead => {
    if (v === undefined) return { ok: false, reason: 'absent' };
    if (v === 'absent' || v === 'unreadable') return { ok: false, reason: v };
    return { ok: true, content: v };
  };
  return {
    reads,
    clock,
    probe: {
      read: async (p: string): Promise<HostFileRead> => {
        reads.push(p);
        if (p.endsWith('/meminfo')) return answer(plan.meminfo ?? MEMINFO);
        const list = plan.stat ?? [STAT_A, STAT_B];
        // The last entry repeats: a sampler asked twice more than the fixture
        // plans for reads a file that simply stopped changing, which is a real
        // condition and not a fixture running out.
        const v = list[Math.min(statIndex++, list.length - 1)];
        return answer(v);
      },
      now: () => clock.t,
      sleep: async (ms: number): Promise<void> => { clock.t += ms; },
    },
  };
}

describe('createHostSampler', () => {
  it('takes a PAIR on the first call and reports over the interval it slept', async () => {
    const { probe, reads, clock } = fakeProbe({});
    const stat = await createHostSampler(probe, { windowMs: 400 })();
    expect(reads.filter((p) => p.endsWith('/stat'))).toHaveLength(2);
    expect(stat.cpu.ok && stat.cpu.total).toBe(50);
    expect(stat.cpu.ok && stat.cpu.windowMs).toBe(400);
    expect(stat.at).toBe(clock.t);
  });

  it('reuses the previous sample on the next poll — ONE read, and the window is the poll interval', async () => {
    const { probe, reads, clock } = fakeProbe({ stat: [STAT_A, STAT_A, STAT_B] });
    const sample = createHostSampler(probe, { windowMs: 400, reuseMinMs: 900, reuseMaxMs: 60_000 });
    await sample();
    const before = reads.length;
    clock.t += 6_000;
    const stat = await sample();
    expect(reads.length - before).toBe(2);          // one /proc/stat, one /proc/meminfo
    expect(stat.cpu.ok && stat.cpu.windowMs).toBe(6_000);
  });

  it('takes a fresh pair when the previous sample is too old to trust', async () => {
    const { probe, reads, clock } = fakeProbe({ stat: [STAT_A, STAT_A, STAT_A, STAT_B] });
    const sample = createHostSampler(probe, { windowMs: 400, reuseMaxMs: 60_000 });
    await sample();
    const before = reads.filter((p) => p.endsWith('/stat')).length;
    clock.t += 10 * 60_000;
    await sample();
    expect(reads.filter((p) => p.endsWith('/stat')).length - before).toBe(2);
  });

  it('keeps absent and unreadable apart — the first says "not Linux", the second says "fix the permissions"', async () => {
    const absent = await createHostSampler(fakeProbe({ stat: ['absent'], meminfo: 'absent' }).probe)();
    const denied = await createHostSampler(fakeProbe({ stat: ['unreadable'], meminfo: 'unreadable' }).probe)();
    expect(absent.cpu.ok === false && absent.cpu.why).toBe('absent');
    expect(denied.cpu.ok === false && denied.cpu.why).toBe('unreadable');
    expect(absent.mem.ok === false && absent.mem.why).toBe('absent');
    expect(denied.mem.ok === false && denied.mem.why).toBe('unreadable');
  });

  it('fails the two halves INDEPENDENTLY — an unreadable meminfo does not blank the cpu row', async () => {
    const stat = await createHostSampler(fakeProbe({ meminfo: 'unreadable' }).probe)();
    expect(stat.cpu.ok).toBe(true);
    expect(stat.mem.ok === false && stat.mem.why).toBe('unreadable');
  });

  it('calls a file that never moves unparsable rather than reporting 0%', async () => {
    const stat = await createHostSampler(fakeProbe({ stat: [STAT_A] }).probe)();
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('unparsable');
  });

  it('reads exactly the two files, under the root it was given, and never a path from a caller', async () => {
    const { probe, reads } = fakeProbe({});
    await createHostSampler(probe, { procRoot: '/fixture/proc' })();
    expect(new Set(reads)).toEqual(new Set(['/fixture/proc/stat', '/fixture/proc/meminfo']));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/hoststat.test.ts`
Expected: FAIL — `createHostSampler is not exported`.

- [ ] **Step 3: Implement the sampler**

Append to `shared/hoststat.ts`, above `hostStatFailed`:

```ts
/**
 * A sampler bound to one probe, holding the previous `/proc/stat` reading so a
 * poll that arrives while it is still fresh costs ONE read and no sleep, and
 * reports over the poll's own interval instead of a 400ms burst. The first
 * poll, and any poll after a long quiet spell, takes the pair itself.
 *
 * The state is per-sampler, not module-global, so a test owns its own and two
 * of them never share a window.
 */
export function createHostSampler(probe: HostProbe, opts: HostSamplerOptions = {}): () => Promise<HostStat> {
  const procRoot = opts.procRoot ?? '/proc';
  const windowMs = opts.windowMs ?? HOST_WINDOW_MS;
  const reuseMinMs = opts.reuseMinMs ?? HOST_REUSE_MIN_MS;
  const reuseMaxMs = opts.reuseMaxMs ?? HOST_REUSE_MAX_MS;
  let previous: CpuSample | null = null;

  const readSample = async (): Promise<CpuSample | HostStatFailure> => {
    const r = await probe.read(`${procRoot}/stat`);
    if (!r.ok) return r.reason;
    const parsed = parseProcStat(r.content);
    if (parsed === null) return 'unparsable';
    return { ...parsed, at: probe.now() };
  };

  const readCpu = async (): Promise<HostCpu> => {
    const first = await readSample();
    if (typeof first === 'string') return { ok: false, why: first };
    const prior = previous;
    previous = first;
    if (prior !== null) {
      const age = first.at - prior.at;
      if (age >= reuseMinMs && age <= reuseMaxMs) {
        const reading = cpuBetween(prior, first);
        if (reading !== null) return { ok: true, ...reading };
      }
    }
    await probe.sleep(windowMs);
    const second = await readSample();
    if (typeof second === 'string') return { ok: false, why: second };
    previous = second;
    const reading = cpuBetween(first, second);
    // A pair taken deliberately apart that still says nothing is a file whose
    // counters do not advance — not a reading, and not a zero.
    return reading === null ? { ok: false, why: 'unparsable' } : { ok: true, ...reading };
  };

  const readMem = async (): Promise<HostMem> => {
    const r = await probe.read(`${procRoot}/meminfo`);
    if (!r.ok) return { ok: false, why: r.reason };
    const parsed = parseMeminfo(r.content);
    return parsed === null ? { ok: false, why: 'unparsable' } : { ok: true, ...parsed };
  };

  return async (): Promise<HostStat> => {
    // Memory is awaited alongside: it never sleeps, so running it concurrently
    // with the CPU pair costs nothing and keeps one slow read from deciding the
    // other's fate.
    const [cpu, mem] = await Promise.all([readCpu(), readMem()]);
    return { at: probe.now(), cpu, mem };
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/hoststat.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/hoststat.ts server/test/hoststat.test.ts
git commit -m "feat(shared): the host sampler, with its reader, clock and sleep injected

One implementation for both boxes: an ordinary poll costs one read and
reports over the poll's own interval; the first takes a measured pair."
```

---

## Task 3: The agent's `hostStat` op

**Files:**
- Modify: `shared/agent-protocol.ts`
- Modify: `agent/src/fileops.ts`
- Create: `agent/src/hoststat.ts`
- Modify: `agent/src/server.ts`
- Test: `agent/test/hoststat.test.ts`

**Interfaces:**
- Consumes: Task 2's `createHostSampler`, `HostStat`.
- Produces: the wire frame `{t:'req', id, op:'hostStat'}` → `{t:'res', id, ok:true, stat: HostStat}`;
  `createAgentHostSampler(procRoot?: string): () => Promise<HostStat>`;
  `readWholeMeasured(p: string): Promise<{ok:true;content:string}|{ok:false;reason:ReadFailure}>`;
  `AgentOpts.procRoot?: string`.

- [ ] **Step 1: Write the failing test**

Create `agent/test/hoststat.test.ts`:

```ts
// The `hostStat` op — the fleet box's own load, and the one op on this wire
// that takes no path.
//
// The load-bearing test in this file is the LAST one: `/proc` must still be
// unreachable through `read`. The whole reason this op exists rather than two
// `read` calls is that widening the read whitelist to `/proc` would hand the
// PWA every `/proc/<pid>/environ` on the box along with the CPU numbers.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostStat } from '../../shared/hoststat.js';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface HostRes { ok: boolean; stat?: HostStat; err?: string }

const STAT = [
  'cpu  1000 0 500 8000 100 0 0 0 0 0',
  'cpu0 500 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4000 50 0 0 0 0 0',
].join('\n');

const MEMINFO = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          4000000 kB',
  'SwapTotal:       2000000 kB',
  'SwapFree:        1500000 kB',
  'SReclaimable:     500000 kB',
  'Shmem:            200000 kB',
].join('\n');

/** A fixture `/proc` INSIDE the fixture home, which is exactly the point of the
 *  final test: this path is under the read whitelist's root and the op still
 *  does not take paths from callers. */
function seedProc(home: string): string {
  const root = path.join(home, 'proc');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'stat'), STAT);
  writeFileSync(path.join(root, 'meminfo'), MEMINFO);
  return root;
}

describe('hostStat op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('answers a reading from the box it runs on, computed there', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: seedProc(fixture.home) });
    client = new TestClient(agent.port);
    await client.hello();

    const res = await client.req<HostRes>(1, { op: 'hostStat' });
    expect(res.ok).toBe(true);
    const mem = res.stat?.mem;
    expect(mem?.ok).toBe(true);
    // The numbers the agent computed, not the file it read: nothing on this
    // wire carries raw jiffies or kB lines for the server to re-derive.
    expect(mem?.ok === true && mem.usedKb).toBe(9200000);
    expect(mem?.ok === true && mem.swapUsedKb).toBe(500000);
  });

  it('never rejects a box it cannot measure — it says WHICH condition it is', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: path.join(fixture.home, 'no-proc-here') });
    client = new TestClient(agent.port);
    await client.hello();

    const res = await client.req<HostRes>(1, { op: 'hostStat' });
    // `ok: true` with a named failure inside, not `ok: false`: a rejection would
    // leave the server unable to tell "this box has no /proc" from "the agent
    // refused", and those are different sentences on the tile.
    expect(res.ok).toBe(true);
    expect(res.stat?.cpu.ok === false && res.stat.cpu.why).toBe('absent');
    expect(res.stat?.mem.ok === false && res.stat.mem.why).toBe('absent');
  });

  it('takes no path, and an attempt to send one changes nothing', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: seedProc(fixture.home) });
    client = new TestClient(agent.port);
    await client.hello();

    // `validateReq` builds the frame from the op alone, so a smuggled `path` is
    // dropped before any handler sees it.
    const res = await client.req<HostRes>(1, { op: 'hostStat', path: '/etc/shadow' });
    expect(res.ok).toBe(true);
    expect(res.stat?.mem.ok).toBe(true);
  });

  it.runIf(process.platform === 'linux')('reads the real /proc when no fixture root is configured', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    const res = await client.req<HostRes>(1, { op: 'hostStat' });
    const cpu = res.stat?.cpu;
    expect(cpu?.ok).toBe(true);
    expect(cpu?.ok === true && cpu.perCpu.length).toBeGreaterThan(0);
    expect(res.stat?.mem.ok).toBe(true);
  });

  it('did NOT widen the read whitelist: /proc is still unreachable through `read`', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: seedProc(fixture.home) });
    client = new TestClient(agent.port);
    await client.hello();

    // Both the real one and the fixture one. The fixture copy lives under the
    // whitelist ROOT ($HOME) and is still refused, because the whitelist names
    // subdirectories, not the home itself — so this also pins that `procRoot`
    // is not a back door into it.
    for (const p of ['/proc/stat', '/proc/meminfo', path.join(fixture.home, 'proc', 'stat')]) {
      expect(await client.req<{ ok: boolean; err?: string }>(2, { op: 'read', path: p }))
        .toMatchObject({ ok: false, err: 'forbidden' });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/hoststat.test.ts`
Expected: FAIL — `procRoot` is not an `AgentOpts` field, and the op answers `bad-request`.

- [ ] **Step 3: Declare the frame**

In `shared/agent-protocol.ts`, after the `CapsReq` line, add:

```ts
/** The fleet box's own load — CPU per logical thread and one memory reading.
 *  PATHLESS, and that is the whole design: `/proc` is NOT on the read
 *  whitelist and must not be put there (`agent/src/whitelist.ts` refuses a
 *  widened read root, and a whitelist entry would open every `/proc/<pid>`
 *  to the PWA). The agent reads its own two fixed files, samples them a
 *  measured interval apart and answers the computed reading, so the widest
 *  thing this op can ever disclose is the box's load. An agent that predates
 *  it rejects the frame in `validateReq` (`bad-request`), which the server
 *  reads as `unsupported` — a positive answer meaning "deploy the agent",
 *  never as a box with nothing to report. */
export interface HostStatReq { t: 'req'; id: number; op: 'hostStat' }
```

Add `HostStatReq` to the union (append, never reorder):

```ts
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq|HostStatReq;
```

And extend the payload census comment under `ResErr`, after the `caps` line:

```ts
// hostStat → {stat: HostStat} (`shared/hoststat.ts`). The payload carries the READING, not the two
//   /proc files: the sampling window is a property of the box that owns the counters, and two
//   `read` round trips would put an unmeasured interval between them. Its `cpu` and `mem` halves
//   fail independently, each naming WHICH condition it was — the D-114 shape, one file down.
```

- [ ] **Step 4: Give `fileops` a measured whole-file read**

In `agent/src/fileops.ts`, replace the existing `readWhole` with a measured sibling plus a derived
`readWhole` (same file, same `failureFor`):

```ts
/** The same read, keeping the distinction `ReadResult` throws away. The comment
 *  above says `readWhole` "predates `ReadFailure` with no caller that needs the
 *  finer distinction" — the `hostStat` op IS that caller: `/proc/stat` missing
 *  means this box is not Linux (permanent, say so), while unreadable means a
 *  container the operator can open up, and the widget prints a different
 *  sentence for each. `readWhole` now DERIVES from this and keeps its exact
 *  wire meaning, so no existing caller changes behaviour. */
export type MeasuredReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: ReadFailure };

export async function readWholeMeasured(p: string): Promise<MeasuredReadResult> {
  try {
    return { ok: true, content: await readFile(p, 'utf8') };
  } catch (e) {
    return { ok: false, reason: failureFor(e) };
  }
}

export async function readWhole(p: string): Promise<ReadResult> {
  const r = await readWholeMeasured(p);
  return r.ok ? { data: r.content, absent: false } : { data: null, absent: r.reason === 'absent' };
}
```

- [ ] **Step 5: Bind the sampler to node**

Create `agent/src/hoststat.ts`:

```ts
// The agent's binding of the shared host sampler: node:fs for the two /proc
// files, node's clock, node's sleep. No algorithm lives here — that is
// `shared/hoststat.ts`, so this box and a local-mode server compute the same
// numbers from the same text and cannot drift.
//
// The two paths are FIXED (`<procRoot>/stat`, `<procRoot>/meminfo`) and never
// come off a request: the `hostStat` frame carries no path, so nothing a caller
// sends can steer this read. `procRoot` exists for fixtures only — `startAgent`
// leaves it at `/proc`.
import { setTimeout as sleep } from 'node:timers/promises';
import { createHostSampler, type HostStat } from '../../shared/hoststat.js';
import { readWholeMeasured } from './fileops.js';

/** One sampler per agent PROCESS, not per connection: it carries the previous
 *  `/proc/stat` reading, and that is what lets an ordinary poll cost one read
 *  and report over the poll's own interval instead of a 400ms burst. */
export function createAgentHostSampler(procRoot?: string): () => Promise<HostStat> {
  return createHostSampler(
    {
      read: readWholeMeasured,
      now: () => Date.now(),
      sleep: async (ms) => { await sleep(ms); },
    },
    procRoot === undefined ? {} : { procRoot },
  );
}
```

- [ ] **Step 6: Wire the op into the agent**

Six edits in `agent/src/server.ts`:

1. Imports — add `HostStatReq` to the type import from `../../shared/agent-protocol.js`, then:

```ts
import type { HostStat } from '../../shared/hoststat.js';
import { createAgentHostSampler } from './hoststat.js';
```

2. `AgentOpts` gains:

```ts
  /** Where `hostStat` reads its two files. Default `/proc`; a test points it at
   *  a fixture directory so the numbers it asserts are numbers it wrote. NOT a
   *  whitelist root and not reachable from any request — see `hoststat.ts`. */
  procRoot?: string;
```

3. `ConnCtx` gains:

```ts
  /** The process-wide sampler, handed in by reference so every connection
   *  shares one previous-sample window (`hoststat.ts`). */
  hostStat: () => Promise<HostStat>;
```

4. `handleReq` — a new case directly after `case 'caps'`:

```ts
    case 'hostStat': {
      // No `checkPath` because there is no path: this op reads two fixed files
      // and answers a computed reading. It never rejects — a box with no
      // `/proc` answers a reading whose halves say WHY they are empty, which
      // the server can render, unlike a `forbidden` it would have to guess at.
      send(ws, ok(req.id, { stat: await ctx.hostStat() }));
      return;
    }
```

5. `validateReq` — a new case directly after `case 'caps'`:

```ts
    case 'hostStat':
      return { t: 'req', id, op: 'hostStat' } satisfies HostStatReq;
```

6. `handleConnection` takes the sampler and puts it on the ctx; `startAgent` builds ONE and passes it:

```ts
function handleConnection(
  ws: WebSocket,
  opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>,
  helloTimeoutMs: number,
  verbCache: VerbCache,
  hostStat: () => Promise<HostStat>,
): void {
```

```ts
    nextPtyId: 1,
    spawnPty: opts.spawnPty,
    hostStat,
  };
```

```ts
    projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),
    spawnPty: rawOpts.spawnPty ?? spawnFleetPty,
    procRoot: rawOpts.procRoot ?? '/proc',
  };
  // ONE sampler for the process — `hoststat.ts` says why it may not be
  // per-connection.
  const hostStat = createAgentHostSampler(opts.procRoot);
```

```ts
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache, hostStat));
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd agent && ./node_modules/.bin/vitest run test/hoststat.test.ts`
Expected: PASS, 5 tests (the real-`/proc` one runs on Linux).

- [ ] **Step 8: Run the whole agent suite — the whitelist pins live there**

Run: `cd agent && npm run test`
Expected: PASS, 20 files. If `whitelist-noghosts`, `whitelist-structural` or `whitelist-prototype`
goes red, STOP: those are safety hardware, and nothing in this task may touch what they guard.

- [ ] **Step 9: Commit**

```bash
git add shared/agent-protocol.ts agent/src/fileops.ts agent/src/hoststat.ts agent/src/server.ts agent/test/hoststat.test.ts
git commit -m "feat(agent): a pathless hostStat op, so /proc never joins the read whitelist

The agent reads its own two /proc files a measured interval apart and
answers the computed reading. An older agent's bad-request is what the
server reads as 'unsupported'."
```

---

## Task 4: The server port, its two adapters and the cache

**Files:**
- Create: `server/src/hoststat.ts`
- Test: `server/test/host-port.test.ts`

**Interfaces:**
- Consumes: Task 2's `createHostSampler`/`hostStatFailed`, `FleetIO` (`server/src/io.ts`),
  `FleetClient` (`server/src/remote/client.ts`).
- Produces: `HostStatPort { read(): Promise<HostStat> }`, `localHostStat(io, procRoot?)`,
  `remoteHostStat(client, timeoutMs?)`, `cachedHostStat(port, ttlMs?)`, `HOST_CACHE_MS`,
  `HOST_REQUEST_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing test**

Create `server/test/host-port.test.ts`:

```ts
// The port between `GET /api/host` and whichever box actually has the /proc.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostStat } from '../../shared/hoststat.js';
import { cachedHostStat, localHostStat, remoteHostStat } from '../src/hoststat.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const MEMINFO = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          4000000 kB',
  'SwapTotal:       2000000 kB',
  'SwapFree:        1500000 kB',
  'SReclaimable:     500000 kB',
  'Shmem:            200000 kB',
].join('\n');

const STAT_A = [
  'cpu  1000 0 500 8000 100 0 0 0 0 0',
  'cpu0 500 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4000 50 0 0 0 0 0',
].join('\n');

const reading = (at: number): HostStat => ({
  at, cpu: { ok: true, total: 12, perCpu: [{ id: 0, pct: 12 }], windowMs: 6000 },
  mem: { ok: false, why: 'absent' },
});

describe('localHostStat', () => {
  it('measures a memory reading from the root it is pointed at', async () => {
    const root = path.join(mkTmp('ccrc-host-'), 'proc');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'meminfo'), MEMINFO);
    writeFileSync(path.join(root, 'stat'), STAT_A);
    const stat = await localHostStat(localIO, root).read();
    expect(stat.mem.ok && stat.mem.usedKb).toBe(9200000);
    // The static fixture's CPU counters never advance, and the sampler says so
    // instead of drawing an idle box — the guard proved here through the REAL
    // io rather than a fake probe.
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('unparsable');
  });

  it('says absent — not unreadable, not zero — when the root has no /proc at all', async () => {
    const stat = await localHostStat(localIO, path.join(mkTmp('ccrc-host-'), 'nowhere')).read();
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('absent');
    expect(stat.mem.ok === false && stat.mem.why).toBe('absent');
  });

  it.runIf(process.platform === 'linux')('measures this box\'s own /proc end to end', async () => {
    const stat = await localHostStat(localIO).read();
    expect(stat.cpu.ok).toBe(true);
    expect(stat.mem.ok).toBe(true);
    if (stat.cpu.ok) {
      expect(stat.cpu.perCpu.length).toBeGreaterThan(0);
      expect(stat.cpu.total).toBeGreaterThanOrEqual(0);
      expect(stat.cpu.total).toBeLessThanOrEqual(100);
    }
  });
});

describe('remoteHostStat', () => {
  // A stand-in for FleetClient: only `request` is reached from this adapter.
  const clientThat = (answer: () => Promise<unknown>) =>
    ({ request: async () => answer() } as unknown as Parameters<typeof remoteHostStat>[0]);

  it('carries the agent\'s reading through, restamped with this box\'s clock', async () => {
    const before = Date.now();
    const stat = await remoteHostStat(clientThat(async () => ({ stat: reading(1) }))).read();
    expect(stat.cpu.ok && stat.cpu.total).toBe(12);
    // NOT the agent's `at: 1` — the PWA compares `at` to its own clock, and
    // across two boxes that comparison is what would lie.
    expect(stat.at).toBeGreaterThanOrEqual(before);
  });

  it('names each transport failure as its own condition', async () => {
    const why = async (message: string): Promise<string> => {
      const stat = await remoteHostStat(clientThat(async () => { throw new Error(message); })).read();
      return stat.cpu.ok === false ? stat.cpu.why : 'measured';
    };
    expect(await why('timeout')).toBe('timeout');
    // `bad-request` is what an agent's validateReq answers for an op it has
    // never heard of: the AGENT-FIRST deploy lag, and nothing else.
    expect(await why('bad-request')).toBe('unsupported');
    expect(await why('disconnected')).toBe('offline');
  });

  // REVIEW FOCUS 5: version skew. A frame that arrives well-formed and carries
  // a garbled payload must not reach the PWA as a half-built reading.
  it('refuses a payload it cannot recognise rather than passing a half-built reading on', async () => {
    for (const payload of [{}, { stat: null }, { stat: { at: 'now', cpu: {}, mem: {} } }, { stat: { at: 1, cpu: { ok: true }, mem: { ok: true } } }]) {
      const stat = await remoteHostStat(clientThat(async () => payload)).read();
      expect(stat.cpu.ok === false && stat.cpu.why).toBe('unparsable');
    }
  });
});

describe('cachedHostStat', () => {
  it('serves one reading per window — twenty phones cost the fleet box one sample', async () => {
    let calls = 0;
    const port = cachedHostStat({ read: async () => { calls++; return reading(Date.now()); } }, 60_000);
    await port.read();
    await port.read();
    await port.read();
    expect(calls).toBe(1);
  });

  it('shares one IN-FLIGHT call, which a TTL alone would not: simultaneous polls all miss together', async () => {
    let calls = 0;
    let release = (): void => {};
    const gate = new Promise<void>((r) => { release = r; });
    const port = cachedHostStat({ read: async () => { calls++; await gate; return reading(Date.now()); } }, 60_000);
    const all = Promise.all([port.read(), port.read(), port.read()]);
    release();
    await all;
    expect(calls).toBe(1);
  });

  it('turns a port that breaks its never-throw contract into a named failure, not a rejection', async () => {
    const port = cachedHostStat({ read: async () => { throw new Error('timeout'); } }, 0);
    const stat = await port.read();
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('timeout');
    // And it does not wedge: the next read runs the port again rather than
    // waiting forever on a promise that already rejected.
    expect((await port.read()).cpu.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/host-port.test.ts`
Expected: FAIL — `Failed to resolve import "../src/hoststat.js"`.

- [ ] **Step 3: Write the port**

Create `server/src/hoststat.ts`:

```ts
// The server's two ways of getting one host reading, behind one port.
//
// WHICH BOX: the one the SESSIONS run on, always — the agent's box in remote
// mode, this box in local mode. That is the box whose CPU a wedged build eats
// and whose memory an OOM takes, so it is the only one the widget asks about.
// Nothing here can report on a second box, and that is deliberate rather than
// pending: a reading that might be about either box is worse than no reading.
//
// The ALGORITHM is not here — `shared/hoststat.ts` owns it, and both adapters
// below just give it a reader (local) or carry its answer across the wire
// (remote), so the two modes cannot produce different numbers from the same
// /proc text.
import {
  createHostSampler,
  hostStatFailed,
  type HostStat,
  type HostStatFailure,
} from '../../shared/hoststat.js';
import type { FleetIO } from './io.js';
import type { FleetClient } from './remote/client.js';

/** The port, declared by its consumer (`GET /api/host`): one question, one
 *  answer, never a throw — every failure is already a named `why` inside the
 *  reading. A route that has to try/catch a metrics call ends up inventing its
 *  own vocabulary for the catch arm, which is the second copy this avoids. */
export interface HostStatPort {
  read(): Promise<HostStat>;
}

/** How long a `hostStat` frame may take before the reading is reported as
 *  `timeout`. Deliberately well under the client's default 15s: this sits in
 *  front of a 6s PWA poll, and a widget that waits fifteen seconds to say
 *  nothing is worse than one that says `timeout` in four. */
export const HOST_REQUEST_TIMEOUT_MS = 4_000;

/** The route's cache window. Just under the PWA's poll so a lone client still
 *  gets a fresh reading every poll, while twenty clients on twenty phones still
 *  cost the fleet box one sample. */
export const HOST_CACHE_MS = 5_000;

/** Local mode: read this box's own `/proc` through the same `FleetIO` every
 *  other read goes through, so `absent`/`unreadable` mean here exactly what
 *  they mean everywhere else (`readFileMeasured`'s own vocabulary — the
 *  measured read exists precisely so this adapter does not have to fold the
 *  two into one null). */
export function localHostStat(io: FleetIO, procRoot?: string): HostStatPort {
  const sample = createHostSampler(
    {
      read: (p) => io.readFileMeasured(p),
      now: () => Date.now(),
      sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    },
    procRoot === undefined ? {} : { procRoot },
  );
  return { read: sample };
}

/** Shape-check an answer that came from ANOTHER BOX. Same posture as
 *  `FleetClient.caps()`: a frame from a version-skewed or buggy peer is data,
 *  not a promise, and a malformed one must degrade to a named failure rather
 *  than reach the PWA as a half-built reading. */
function isHostStat(v: unknown): v is HostStat {
  if (typeof v !== 'object' || v === null) return false;
  const { at, cpu, mem } = v as { at?: unknown; cpu?: unknown; mem?: unknown };
  if (typeof at !== 'number') return false;
  return isHalf(cpu, ['total', 'windowMs']) && isHalf(mem, ['totalKb', 'usedKb', 'cacheKb']);
}

function isHalf(v: unknown, numbers: readonly string[]): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const half = v as Record<string, unknown>;
  if (half.ok === false) return typeof half.why === 'string';
  if (half.ok !== true) return false;
  return numbers.every((k) => typeof half[k] === 'number');
}

/** Why a request that never reached `/proc` produced nothing. Each arm is a
 *  different sentence and a different fix, so none of them may collapse into
 *  another: `bad-request` is what an agent's `validateReq` answers for an op it
 *  has never heard of, which is the AGENT-FIRST deploy lag and nothing else. */
function whyFrom(err: unknown): HostStatFailure {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'timeout') return 'timeout';
  if (msg === 'bad-request' || msg === 'not-implemented') return 'unsupported';
  // 'disconnected', 'aborted' and anything the transport invents: the link,
  // not the box, is what failed.
  return 'offline';
}

/**
 * Remote mode: ask the fleet box for the reading it computed itself.
 *
 * `at` is RESTAMPED with this server's clock. The agent's stamp is honest about
 * the agent's clock, and the PWA compares `at` against its own clock to decide
 * "stale" — across two boxes whose clocks drift by a minute, that comparison is
 * what would lie, not the reading.
 */
export function remoteHostStat(client: FleetClient, timeoutMs = HOST_REQUEST_TIMEOUT_MS): HostStatPort {
  return {
    async read(): Promise<HostStat> {
      try {
        const res = await client.request({ t: 'req', op: 'hostStat' }, timeoutMs);
        const stat = (res as { stat?: unknown }).stat;
        if (!isHostStat(stat)) return hostStatFailed('unparsable', Date.now());
        return { ...stat, at: Date.now() };
      } catch (err) {
        return hostStatFailed(whyFrom(err), Date.now());
      }
    },
  };
}

/**
 * One reading per `ttlMs`, and one IN FLIGHT at a time.
 *
 * Both halves matter and for different reasons: the TTL bounds how often a
 * quiet fleet box is sampled at all, and the single-flight share is what keeps
 * ten clients polling at the same second from becoming ten agent round trips —
 * a cache alone would not, since they all miss it together.
 *
 * A failed reading is cached exactly like a good one: an offline agent
 * answering `offline` ten times a second is the same wasted work, and the
 * widget wants the failure to be as steady as the number it replaces.
 */
export function cachedHostStat(port: HostStatPort, ttlMs = HOST_CACHE_MS): HostStatPort {
  let at = 0;
  let last: HostStat | null = null;
  let inFlight: Promise<HostStat> | null = null;
  return {
    async read(): Promise<HostStat> {
      const now = Date.now();
      if (last !== null && now - at < ttlMs) return last;
      if (inFlight !== null) return inFlight;
      const run = port.read().then(
        (stat) => { last = stat; at = Date.now(); inFlight = null; return stat; },
        (err: unknown) => {
          // The port contract says never throw; a port that breaks it must not
          // wedge `inFlight` forever, and the reason it gives is the honest one
          // for "we asked and got nothing back".
          inFlight = null;
          const stat = hostStatFailed(whyFrom(err), Date.now());
          last = stat;
          at = Date.now();
          return stat;
        },
      );
      inFlight = run;
      return run;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/host-port.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/hoststat.ts server/test/host-port.test.ts
git commit -m "feat(server): the host-stat port, its two adapters and the cache

One reading per 5s window and one request in flight, so twenty phones
cost the fleet box one sample; every transport failure keeps its own name."
```

---

## Task 5: `GET /api/host`

**Files:**
- Modify: `server/src/server.ts` (the `Deps` interface, and a new route beside `/api/fleet/health`)
- Modify: `server/src/index.ts` (both composition arms)
- Modify: `server/src/auth/gate.ts` (the route-count docstring)
- Modify: `server/test/auth-gate.test.ts` (four pinned counts)
- Test: `server/test/host-route.test.ts`

**Interfaces:**
- Consumes: Task 4's `HostStatPort`, `cachedHostStat`, `localHostStat`, `remoteHostStat`; Task 1's
  `hostStatFailed`, `HostStat`.
- Produces: `Deps.hostStat?: HostStatPort`; `GET /api/host` answering a `HostStat` with status 200.

- [ ] **Step 1: Write the failing test**

Create `server/test/host-route.test.ts`:

```ts
// GET /api/host — the one door the tile has.
import { describe, it, expect } from 'vitest';
import { hostStatFailed, type HostStat } from '../../shared/hoststat.js';
import type { HostStatPort } from '../src/hoststat.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const fixed: HostStat = {
  at: 1_700_000_000_000,
  cpu: { ok: true, total: 34, perCpu: [{ id: 0, pct: 91 }, { id: 1, pct: 12 }], windowMs: 6000 },
  mem: { ok: true, totalKb: 16000000, usedKb: 9200000, cacheKb: 4800000, availableKb: 6000000, swapTotalKb: 2000000, swapUsedKb: 500000 },
};

async function get(port?: HostStatPort): Promise<{ code: number; body: HostStat }> {
  const home = mkTmp('ccrc-host-route-');
  const app = await buildServer({ ...testDeps(home), ...(port ? { hostStat: port } : {}) });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/host' });
    return { code: res.statusCode, body: res.json() as HostStat };
  } finally {
    await app.close();
  }
}

describe('GET /api/host', () => {
  it('answers the reading its port produced, per-CPU list intact', async () => {
    const { code, body } = await get({ read: async () => fixed });
    expect(code).toBe(200);
    // Whole, not pre-reduced to the two hottest: the reduction is a rendering
    // decision, and an adapter may not narrow a distinction it received.
    expect(body).toEqual(fixed);
  });

  it('answers 200 with a NAMED failure when there is no reading to be had', async () => {
    // Not a 500 and not an empty body: "the agent is too old" is something the
    // operator has to be able to read off the tile.
    const { code, body } = await get({ read: async () => hostStatFailed('unsupported', 1) });
    expect(code).toBe(200);
    expect(body.cpu.ok === false && body.cpu.why).toBe('unsupported');
    expect(body.mem.ok === false && body.mem.why).toBe('unsupported');
  });

  it('is mounted even on a Deps with no host port, and says which condition that is', async () => {
    const { code, body } = await get();
    expect(code).toBe(200);
    expect(body.cpu.ok === false && body.cpu.why).toBe('unsupported');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/host-route.test.ts`
Expected: FAIL — 404 from Fastify (`Route GET:/api/host not found`).

- [ ] **Step 3: Add the dependency and the route**

In `server/src/server.ts`, add the imports:

```ts
import { type HostStatPort } from './hoststat.js';
import { hostStatFailed, type HostStat } from '../../shared/hoststat.js';
```

Add the field at the end of `interface Deps`:

```ts
  /** Host load for the box the SESSIONS run on — the agent's box in remote
   *  mode, this one in local mode (`hoststat.ts` builds both). Optional the
   *  way `push` is: a `Deps` assembled some other way (a test) simply has no
   *  reading, and `GET /api/host` says `unsupported` rather than inventing
   *  one. It is NOT optional in the sense of degradable — `index.ts` always
   *  sets it, in both modes. */
  hostStat?: HostStatPort;
```

Register the route immediately before the `POST /api/fleet/reboot` block:

```ts
  /**
   * The load on the box the sessions run on. ONE tile in the PWA's strip, so
   * one route and one reading.
   *
   * NOT box-token gated and not exempt from the session gate: it is an
   * ordinary PWA-surface READ, so with `CCRC_AUTH` armed it sits behind the
   * session gate like `/api/fleet`, and with auth off it is as open as the
   * rest of the console on a loopback port.
   *
   * Never 5xx, and never an empty body: a reading whose halves say WHY they
   * are empty is the answer here (`HostStatFailure`), because "the agent is
   * too old" and "this box has no /proc" are things the operator needs to
   * READ, not a spinner that never resolves. The cache and the single-flight
   * share live in `cachedHostStat`, one layer down, so twenty phones polling
   * together still cost the fleet box one sample.
   */
  app.get('/api/host', async (): Promise<HostStat> => {
    const port = deps.hostStat;
    if (port === undefined) return hostStatFailed('unsupported', Date.now());
    return port.read();
  });
```

- [ ] **Step 4: Build the port in the composition root**

In `server/src/index.ts`, add the import:

```ts
import { cachedHostStat, localHostStat, remoteHostStat } from './hoststat.js';
```

In the `fleetMode === 'remote'` arm, add to the `deps` literal:

```ts
    // The FLEET box's load, asked of the agent — never this box's. In remote
    // mode this process runs somewhere the sessions do not, and its own
    // /proc would be a reading about the wrong machine.
    hostStat: cachedHostStat(remoteHostStat(fleet.client)),
```

In the local arm, add to the `deps` literal:

```ts
    // Local mode drives ccd on this same box, so the sessions run here and
    // this box's own /proc IS the answer — the same sampler, a different
    // reader.
    hostStat: cachedHostStat(localHostStat(localIO)),
```

- [ ] **Step 5: Run the route test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/host-route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Re-derive the pinned route counts**

Run: `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts`
Expected: FAIL, 5 tests. Each failure prints `expected <derived> to be <prose>` — the DERIVED number
is the truth and the prose is what you edit. On `083aeb10` that means: `server.ts` scan 49 → **50**,
`ROUTES.length` 79 → **80**, the two "all 76 HTTP routes" claims → **77**, and "79 scanned + the
static wildcard" → **80**. Re-derive rather than copying these if main has moved under you.

Edit `server/test/auth-gate.test.ts`, keeping the file's running commentary style — the count line
gains a sentence saying what the new route is and why it is not exempt:

```ts
    // 50 since `GET /api/host` (the host-load gauge) — a READ of the box the
    // sessions run on, registered in `server.ts`, NOT EXEMPT and carrying no
    // box token: it is an ordinary PWA-surface read, so it is session-gated
    // when armed exactly like `GET /api/fleet` beside it, and it raises the
    // scanned count and the gated count while leaving the exempt one alone.
    expect(scanRoutes('server.ts').length).toBe(50);
```

```ts
    // so the merged tree now reads 49 + 30 = 79. The host gauge's own
    // `GET /api/host` took the `server.ts` half 49 -> 50: 50 + 30 = 80.
    expect(ROUTES.length).toBe(80);
```

And in `server/src/auth/gate.ts`, the docstring's own count:

```ts
 * THE GATE. One `onRequest` hook stands in front of all 77 routes, the static
```

- [ ] **Step 7: Run the gate suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts`
Expected: PASS, 146 tests. The gate itself needed no code change — a new route is NOT-EXEMPT by
default, which is the posture this route wants.

- [ ] **Step 8: Commit**

```bash
git add server/src/server.ts server/src/index.ts server/src/auth/gate.ts server/test/auth-gate.test.ts server/test/host-route.test.ts
git commit -m "feat(server): GET /api/host, session-gated like any other PWA read

Never 5xx and never empty — a named failure is the answer. The four
pinned route counts and gate.ts's docstring move with it."
```

---

## Task 6: The tile

**Files:**
- Modify: `pwa/src/lib/api.ts`
- Create: `pwa/src/fleet/HostGauge.tsx`
- Modify: `pwa/src/fleet/fleet.css`
- Modify: `pwa/design/audit.mjs`
- Test: `pwa/test/host-gauge.test.tsx`

**Interfaces:**
- Consumes: Task 5's `GET /api/host`; Task 1's `HostStat`, `HostStatFailure`, `hottestCpus`.
- Produces: `HostGauge()` (default-exportless named export), `memBand(pct)`, `failureWord(why)`,
  `failureSentence(why)`, `HOST_POLL_MS`, `HOST_STALE_MS`; `api.host()`.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/host-gauge.test.tsx`:

```tsx
// The host gauge: what it draws and what it refuses to draw. (Where it sits is
// Task 7's file-level concern and is tested there.)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { HostStat, HostStatFailure } from '../../shared/hoststat';
import { HostGauge, failureWord, memBand } from '../src/fleet/HostGauge';
import { api } from '../src/lib/api';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const reading = (over: Partial<HostStat> = {}): HostStat => ({
  at: Date.now(),
  cpu: { ok: true, total: 34, perCpu: [{ id: 0, pct: 12 }, { id: 3, pct: 91 }, { id: 7, pct: 78 }], windowMs: 6000 },
  mem: {
    ok: true, totalKb: 16000000, usedKb: 9200000, cacheKb: 4800000,
    availableKb: 6000000, swapTotalKb: 2000000, swapUsedKb: 500000,
  },
  ...over,
});

const stub = (stat: HostStat): void => { vi.spyOn(api, 'host').mockResolvedValue(stat); };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('HostGauge readings', () => {
  it('draws the average, the two hottest threads and the memory split', async () => {
    stub(reading());
    render(<HostGauge />);
    expect(await screen.findByText('34%')).toBeTruthy();
    expect(screen.getByText('↑91·78')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();       // 9.2G used of 16.0G
    expect(screen.getByText('sw 0.5G')).toBeTruthy();   // swap displaces the totals
    const ticks = document.querySelectorAll('.host-tick');
    expect(ticks).toHaveLength(2);
    expect(ticks[0]?.getAttribute('data-hot')).toBe('true');   // 91% is pegged
    expect(ticks[1]?.getAttribute('data-hot')).toBeNull();     // 78% is not
    // A tick can only ever sit on the empty part of the track: no average
    // outruns its own maximum.
    expect((ticks[0] as HTMLElement).style.left).toContain('91%');
  });

  it('shows the totals instead when nothing is swapping, and draws no swap track at all', async () => {
    stub(reading({ mem: { ok: true, totalKb: 16000000, usedKb: 4000000, cacheKb: 2000000, availableKb: 12000000, swapTotalKb: 2000000, swapUsedKb: 0 } }));
    render(<HostGauge />);
    expect(await screen.findByText('3.8/15.3G')).toBeTruthy();
    // Configured swap that nobody is using draws nothing: one bar, not one bar
    // and an empty promise of another. The row keeps its height either way.
    expect(document.querySelector('.host-swap')).toBeNull();
    expect(declValue(ruleIn(fleetCss, '.host-mem'), 'grid-template-rows')).toBe('5px 3px');
  });

  it('puts swap on its OWN track, on its OWN scale — it can never overlap the RAM segments', async () => {
    // The box closest to an OOM is the one this has to get right: 93% used and
    // nearly all of swap gone. Pinned into the RAM track, the violet would be
    // drawn on top of the red exactly here.
    stub(reading({
      mem: { ok: true, totalKb: 16000000, usedKb: 14900000, cacheKb: 400000, availableKb: 700000, swapTotalKb: 2000000, swapUsedKb: 1900000 },
    }));
    render(<HostGauge />);
    await screen.findByText('93%');
    const swap = document.querySelector('.host-swap');
    expect(swap).not.toBeNull();
    // A SIBLING of the RAM track, never a child of it — the structural half of
    // "cannot overlap"; the visual half is the two grid rows.
    expect(swap?.closest('.host-meter')).toBeNull();
    expect(swap?.parentElement?.className).toBe('host-mem');
    // 1.9G of 2.0G swap = 95%, NOT 1.9G of 16G RAM = 12%.
    expect((document.querySelector('.host-swap-fill') as HTMLElement).style.width).toBe('95%');
    expect(screen.getByText('sw 1.8G')).toBeTruthy();
  });

  it('draws memory as one pill in two tones — the cap belongs to the last segment', async () => {
    // The join between used and cache must not carry a rounded cap: at 5px high
    // that is a notch with the dark track showing through it.
    stub(reading());
    render(<HostGauge />);
    await screen.findByText('57%');
    expect(document.querySelector('.host-fill--mem')?.getAttribute('data-tail')).toBeNull();
    expect(declValue(ruleIn(fleetCss, '.host-fill--mem'), 'border-radius')).toBe('0');
    cleanup();
    // …and with no cache worth drawing, the used fill takes the cap back, so
    // the bar never ends in a square edge.
    stub(reading({ mem: { ok: true, totalKb: 16000000, usedKb: 9200000, cacheKb: 0, availableKb: 6800000, swapTotalKb: 0, swapUsedKb: 0 } }));
    render(<HostGauge />);
    await screen.findByText('57%');
    expect(document.querySelector('.host-fill--mem')?.getAttribute('data-tail')).toBe('true');
    expect(document.querySelector('.host-seg-cache')).toBeNull();
  });

  it('draws no ticks on a single-thread box — the hottest thread IS the average there', async () => {
    stub(reading({ cpu: { ok: true, total: 61, perCpu: [{ id: 0, pct: 61 }], windowMs: 6000 } }));
    render(<HostGauge />);
    expect(await screen.findByText('61%')).toBeTruthy();
    expect(document.querySelectorAll('.host-tick')).toHaveLength(0);
  });

  // REVIEW FOCUS 4: a 128-thread box still gets exactly two ticks, and they are
  // the right two.
  it('draws two ticks and only two on a 128-thread box', async () => {
    const perCpu = Array.from({ length: 128 }, (_, id) => ({ id, pct: id === 97 ? 99 : id === 12 ? 96 : 3 }));
    stub(reading({ cpu: { ok: true, total: 9, perCpu, windowMs: 6000 } }));
    render(<HostGauge />);
    expect(await screen.findByText('↑99·96')).toBeTruthy();
    expect(document.querySelectorAll('.host-tick')).toHaveLength(2);
  });

  it('bands memory at 75/90, not the account ladder\'s 50/75', async () => {
    expect(memBand(60)).toBe('ok');
    expect(memBand(75)).toBe('warn');
    expect(memBand(91)).toBe('crit');
    stub(reading({ mem: { ok: true, totalKb: 1000, usedKb: 950, cacheKb: 20, availableKb: 30, swapTotalKb: 0, swapUsedKb: 0 } }));
    render(<HostGauge />);
    await screen.findByText('95%');
    expect(document.querySelector('.host-fill--mem')?.getAttribute('data-band')).toBe('crit');
  });

  it('never bands the cpu row — a busy fleet box is doing its job', async () => {
    stub(reading({ cpu: { ok: true, total: 97, perCpu: [{ id: 0, pct: 99 }, { id: 1, pct: 95 }], windowMs: 6000 } }));
    render(<HostGauge />);
    await screen.findByText('97%');
    expect(document.querySelector('.host-fill--cpu')?.getAttribute('data-band')).toBeNull();
  });
});

describe('HostGauge when there is no reading', () => {
  const WHYS: readonly HostStatFailure[] = ['offline', 'timeout', 'unsupported', 'absent', 'unreadable', 'unparsable'];

  it('gives each of the six conditions its own word — they are six different fixes', () => {
    expect(new Set(WHYS.map(failureWord)).size).toBe(WHYS.length);
  });

  // REVIEW FOCUS 1: the union is closed at compile time and OPEN on the wire.
  it('renders a word for a condition this build has never heard of', () => {
    // A newer server naming a seventh condition must not print `undefined` in
    // the cell. Absence-permits cuts both ways.
    expect(failureWord('brand-new' as HostStatFailure)).toBe('no reading');
  });

  it('renders a dash and the condition, never a zero', async () => {
    stub(reading({ cpu: { ok: false, why: 'unsupported' }, mem: { ok: false, why: 'unsupported' } }));
    render(<HostGauge />);
    // BOTH rows say it: the two halves fail separately and each says so.
    expect(await screen.findAllByText('agent old')).toHaveLength(2);
    expect(screen.queryByText('0%')).toBeNull();
    expect(document.querySelectorAll('.host-fill')).toHaveLength(0);
  });

  it('fails the two rows independently — an unreadable /proc/meminfo leaves the cpu row measured', async () => {
    stub(reading({ mem: { ok: false, why: 'unreadable' } }));
    render(<HostGauge />);
    expect(await screen.findByText('34%')).toBeTruthy();
    expect(screen.getByText('no access')).toBeTruthy();
  });

  it('keeps the last reading when the body is one it cannot read', async () => {
    // A type is not a guard: several fixtures in this suite answer an unmatched
    // route with a bare `{}`, and `cpu.ok` on that throws inside render.
    vi.spyOn(api, 'host').mockResolvedValue({} as unknown as HostStat);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<HostGauge />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);   // still the placeholder, not a crash
  });

  it('greys a reading that has stopped arriving instead of letting it read as live', async () => {
    stub(reading({ at: Date.now() - 5 * 60_000 }));
    render(<HostGauge />);
    await screen.findByText('34%');
    expect(document.querySelector('.host-gauge')?.getAttribute('data-stale')).toBe('true');
    expect(screen.getByText(/old$/)).toBeTruthy();
    // The greying is CSS, and jsdom applies none — so the rule itself is read
    // as text. Deleting it would leave a frozen bar looking like live pressure.
    expect(ruleIn(fleetCss, ".host-gauge[data-stale='true'] .host-fill")).toContain('var(--edge-subtle)');
  });

  it('does not poll a tab nobody is looking at, and snaps current when it comes back', async () => {
    const spy = vi.spyOn(api, 'host').mockResolvedValue(reading());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<HostGauge />);
    expect(spy).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pwa && ./node_modules/.bin/vitest run test/host-gauge.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/fleet/HostGauge"`.

- [ ] **Step 3: Add the client call**

In `pwa/src/lib/api.ts`, add the type import and the method next to `fleetHealth`:

```ts
import type { HostStat } from '../../../shared/hoststat';
```

```ts
    // The load on the box the sessions run on. `HostStat`, imported rather
    // than restated for the reason `accounts` below spells out: a hand-written
    // twin of a server shape is how a client goes on declaring a field the
    // server stopped sending. Never rejects for a box that cannot be measured
    // — the failure is INSIDE the reading, so the widget renders it instead of
    // guessing from a caught exception.
    host: () => getJson<HostStat>('/api/host'),
```

- [ ] **Step 4: Write the component**

Create `pwa/src/fleet/HostGauge.tsx` with the content of **Appendix A** at the end of this plan.
Read it before you paste it; the guards that matter are the shape check (a type is not a guard), the
`mine === issued` out-of-order drop, the `hasCache >= 0.5` threshold that decides which segment
carries the right-hand cap, and the swap hairline being a SIBLING of the RAM track rather than a
child of it. Two functions in it answer an unknown token, which the parked reference does not
(Review Focus 1):

```tsx
export function failureWord(why: HostStatFailure): string {
  switch (why) {
    case 'offline': return 'no agent';
    case 'timeout': return 'no answer';
    case 'unsupported': return 'agent old';
    case 'absent': return 'no /proc';
    case 'unreadable': return 'no access';
    case 'unparsable': return 'bad format';
  }
  // A token this build has never heard of — a newer server naming a seventh
  // condition. The union is closed at COMPILE time (the `never` below stops
  // compiling the day a member is added without a case) and open on the WIRE,
  // where absence-permits cuts both ways: render something honest rather than
  // the `undefined` an exhaustive switch would otherwise return.
  const unknown: never = why;
  void unknown;
  return 'no reading';
}

export function failureSentence(why: HostStatFailure): string {
  switch (why) {
    case 'offline': return 'no link to the fleet host — nothing was asked';
    case 'timeout': return 'the fleet host was asked and did not answer in time';
    case 'unsupported': return 'the agent on the fleet host predates this reading — deploy the agent lane';
    case 'absent': return 'this host has no /proc — not a Linux box';
    case 'unreadable': return 'this host has /proc and would not let it be read';
    case 'unparsable': return '/proc was read and its shape was not understood';
  }
  const unknown: never = why;
  void unknown;
  return 'this build does not know why there is no reading';
}
```

The rest of the file — the header comment explaining the two rows, `memBand`, `isReading`/`isHalf`,
`track`, `Row`, `CpuRow`, `MemRow` and `HostGauge` itself — is in Appendix A.

- [ ] **Step 5: Add the styles**

In `pwa/src/fleet/fleet.css`, directly after the `.acct-reset` rule, add the whole block in
**Appendix B** at the end of this plan. The rules that
carry a decision, and must keep their comments: `.host-fill--mem { border-radius: 0; }` plus the
shared right-hand cap on `[data-tail='true']`/`.host-seg-cache` (one pill, two tones); `.host-mem`'s
`grid-template-rows: 5px 3px` (memory is two tracks); `.host-tick[data-hot='true']` placed AFTER the
`[data-rank='second']` rule (equal specificity — source order is the mechanism).

- [ ] **Step 6: Register the new colour rules with the contrast gate**

In `pwa/design/audit.mjs`, add four entries to `INHERITED_GROUNDS` (before the
`'fleet.css .route-field-label'` entry):

```js
  // ── the host gauge ──────────────────────────────────────────────────────
  // Four rules on the host tile. Their selectors DO name a painted ancestor
  // (`.host-gauge` paints --bg-surface in fleet.css), but that is the PHONE
  // ground; on desktop shell.css repaints the same tile --bg-raised, which is
  // the darker of the two in the light theme and the lighter in the dark one.
  // Registered against --bg-raised on purpose: measuring the looser ground
  // would be measuring the case that cannot fail.
  'fleet.css .host-gauge .host-label': {
    under: ['var(--bg-raised)'],
    why: 'the tile\'s name. `.host-gauge` paints --bg-surface (fleet.css) and `.shell-accounts .host-gauge` repaints it --bg-raised (shell.css) for the desktop top bar; --bg-raised is the worse of the two grounds and is what this measures',
  },
  'fleet.css .host-gauge .host-trail': {
    under: ['var(--bg-raised)'],
    why: 'the trailing readout (the hottest threads, the swap figure, or the word for a condition that has no reading). Same tile and same two grounds as .host-label above',
  },
  'fleet.css .host-gauge .host-stale': {
    under: ['var(--bg-raised)'],
    why: 'the "2m old" marker on a reading that stopped arriving. Same tile and same two grounds as .host-label above',
  },
  'fleet.css .acct-pct[data-dim=\'true\']': {
    under: ['var(--bg-raised)'],
    why: 'the em-dash a host row shows when its half has no reading. Rendered only inside .host-gauge (HostGauge.tsx), so it takes that tile\'s grounds; --bg-raised is the worse of the two',
  },
```

- [ ] **Step 7: Run both suites to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/host-gauge.test.tsx test/contrast.test.ts`
Expected: PASS — 14 in the gauge file, 242 in the contrast gate. If contrast reports
`uncovered ... contains no identities beyond the grandfathered blind spots`, a selector you added is
not in the registry above: add it with its ground and its reason, never by widening the exemption.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/lib/api.ts pwa/src/fleet/HostGauge.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/host-gauge.test.tsx
git commit -m "feat(pwa): the host tile — two rows, six named silences

cpu with the two hottest threads as ticks, memory as one pill in two
tones with swap on its own hairline, and a word for every condition in
which there is no reading."
```

---

## Task 7: Where it sits — the fixed right-hand column, and the phone row

**Files:**
- Modify: `pwa/src/styles/shell.css`
- Modify: `pwa/src/app.tsx`
- Modify: `pwa/src/screens/FleetScreen.tsx`
- Test: `pwa/test/host-gauge.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: Task 6's `HostGauge`.
- Produces: the DOM contract `.accounts-bar > (.accounts-strip | .host-col > .host-gauge)` on desktop;
  one `.host-gauge` in the document and never two.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/host-gauge.test.tsx` (the imports gain `App` and `navigate`):

```tsx
import { App } from '../src/app';
import { navigate } from '../src/lib/router';

const shellCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');

const desktop = (): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width'),
    media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
};

/** The tile carries no role and no aria-label by design (HostGauge.tsx says
 *  why), so it is found the way the stylesheet finds it. */
const findGauge = async (): Promise<HTMLElement> => {
  await screen.findByText('host');
  const el = document.querySelector('.host-gauge');
  expect(el).not.toBeNull();
  return el as HTMLElement;
};

describe('where the gauge sits', () => {
  it('is NOT inside the accounts strip — that whole grid is one link to /accounts', async () => {
    stub(reading());
    render(<App />);
    const gauge = await findGauge();
    expect(gauge.closest('[role="link"]')).toBeNull();
    expect(gauge.closest('.accounts-strip')).toBeNull();
  });

  it('rides the desktop top bar in its OWN column, beside the strip rather than inside it', async () => {
    desktop();
    stub(reading());
    render(<App />);
    const gauge = await findGauge();
    expect(gauge.closest('.host-col')).not.toBeNull();
    expect(gauge.closest('.accounts-bar')).not.toBeNull();
    expect(gauge.closest('.accounts-strip')).toBeNull();
    // Exactly one — the mobile mount and the top bar are alternatives, never
    // both, or the box would be polled twice and drawn twice.
    expect(document.querySelectorAll('.host-gauge')).toHaveLength(1);
  });

  it('keeps a fixed column at the right edge, so its place does not depend on how many accounts there are', () => {
    // The requirement in one line of CSS: the bar is `1fr auto`, the accounts
    // take the elastic column and the gauge's own column is a fixed width. A
    // mutant that drops the width, or folds the gauge back into the accounts
    // grid, moves the tile every time a lane is added or disabled.
    expect(declValue(ruleIn(shellCss, '.shell-accounts .accounts-bar'), 'grid-template-columns'))
      .toBe('minmax(0,1fr)auto');   // declValue normalises whitespace
    expect(declValue(ruleIn(shellCss, '.shell-accounts .host-gauge'), 'width')).toBe('264px');
    // The accounts grid keeps its own auto-fit reflow — the two columns are
    // independent, which is what makes the gauge's position stable while the
    // strip's contents move.
    expect(declValue(ruleIn(shellCss, '.shell-accounts .accounts-strip'), 'grid-template-columns'))
      .toContain('auto-fit');
  });
});
```

Also extend the file's `afterEach` so the stubs and the route do not leak:

```tsx
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); navigate('/'); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pwa && ./node_modules/.bin/vitest run test/host-gauge.test.tsx`
Expected: FAIL — `findGauge` finds no `.host-gauge` in the App render (nothing mounts it yet).

- [ ] **Step 3: Give the desktop bar its two columns**

In `pwa/src/styles/shell.css`, inside the desktop media block, directly after the
`.shell-accounts .acct-meter { height: 5px; }` rule:

```css
  /* THE BAR IS TWO COLUMNS, and the second one is fixed. The accounts grid
     takes whatever is left and reflows as lanes come and go (auto-fit, above);
     the host gauge does not move when it does. That is the whole point of the
     column: an operator glancing at box load looks at the right edge, not at
     wherever the fifth tile happened to land this week. When the accounts wrap
     to a second row the column stays put at the top right — `align-items:
     start`, not a stretched tile with its two rows floating in the middle. */
  .shell-accounts .accounts-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--sp-3);
    align-items: start;
  }
  /* The divider lives on the COLUMN, not on the tile: it separates the two
     kinds of instrument, and a border on the tile would just look like a
     thicker tile. */
  .shell-accounts .host-col {
    padding-left: var(--sp-3);
    border-left: 1px solid var(--edge-subtle);
  }
  /* Same chrome as an account gauge at this width — label beside the rows,
     raised fill — so the panel reads as one row of instruments. 264px is what
     the two rows need with the trailing readouts intact; it is fixed rather
     than fluid because a gauge that changes width as accounts come and go is
     the thing this column exists to prevent. */
  .shell-accounts .host-gauge {
    width: 264px;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin: 0;
    padding: 2px var(--sp-3);
    background: var(--bg-raised);
  }
  .shell-accounts .host-gauge .host-label {
    flex: none;
    font-size: var(--text-xs);
  }
  .shell-accounts .host-gauge .acct-rows {
    flex: 1;
    min-width: 0;
  }
  /* The stale marker is the one thing that does not fit the flex row: it sits
     under the rows rather than beside them, so it never squeezes a meter. */
  .shell-accounts .host-gauge .host-stale {
    flex: none;
  }
```

- [ ] **Step 4: Mount it on desktop**

In `pwa/src/app.tsx`, add `import { HostGauge } from './fleet/HostGauge';` and replace the
`.shell-accounts` body:

```tsx
          <div className="shell-accounts">
            {/* TWO COLUMNS, and the host gauge owns the right one outright
                (shell.css `.accounts-bar`). It is a SIBLING of the strip, never
                a cell inside it: `.accounts-strip` is one role="link" onto
                /accounts, so a tap on the host tile from inside it would open a
                screen that says nothing about this box — and its position would
                then depend on how many accounts the roster happens to carry. */}
            <div className="accounts-bar">
              <AccountsStrip />
              <div className="host-col"><HostGauge /></div>
            </div>
          </div>
```

- [ ] **Step 5: Mount it on the phone**

In `pwa/src/screens/FleetScreen.tsx`, add `import { HostGauge } from '../fleet/HostGauge';` and put
the tile directly under the strip, on the same flag:

```tsx
      {showAccounts && <AccountsStrip />}
      {/* The host gauge rides the same flag, for one reason and not the
          strip's: `showAccounts` is which SURFACE owns the instruments — the
          desktop top bar (app.tsx, where this tile has its own right-hand
          column) or this list. Mounted unconditionally it would render twice
          on desktop, once in each. Here it is the last, full-width row under
          the strip: a fixed place that does not move as accounts come and
          go. */}
      {showAccounts && <HostGauge />}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd pwa && ./node_modules/.bin/vitest run test/host-gauge.test.tsx`
Expected: PASS, 17 tests.

- [ ] **Step 7: Run the suites the mounts can break**

Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx test/app.test.tsx test/accounts-strip.test.tsx test/fleet-css.test.ts`
Expected: PASS. `fleet-screen.test.tsx`'s "adds no landmark per bucket" is the one that will go red if
the tile ever grows a `role="group"` — that is the assertion behind the "no role" decision, and it
enumerates every group in that screen.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/styles/shell.css pwa/src/app.tsx pwa/src/screens/FleetScreen.tsx pwa/test/host-gauge.test.tsx
git commit -m "feat(pwa): pin the host tile to the right edge, outside the accounts link

Its own fixed column on desktop and the last full-width row on the
phone, so the operator's eye goes to the same place whatever the roster
is doing."
```

---

## Task 8: Document it, and verify the whole branch

**Files:**
- Modify: `README.md`
- No new tests; this task runs the three full suites and reports them.

- [ ] **Step 1: Document the op in the agent's security model**

In `README.md`, in `### Agent security model`, after the `- **pty**:` bullet:

```markdown
- **`hostStat`**: the one op that carries no path. It exists so the host-load
  gauge (below) does not need `/proc` on the read whitelist — the agent reads
  its own `/proc/stat` and `/proc/meminfo`, samples them a measured interval
  apart and answers the computed reading. `/proc` stays unreachable through
  `read`, which is what keeps every `/proc/<pid>/environ` on that box out of
  the PWA's reach (`agent/test/hoststat.test.ts` pins it).
```

- [ ] **Step 2: Document the gauge**

In `README.md`, between that bullet list and `### Degraded mode`:

```markdown
### Host load: the box the sessions run on

The accounts strip's last instrument is not an account. `GET /api/host`
answers one reading of the box the SESSIONS run on — the fleet host in remote
mode, this box in local mode — and the PWA draws it in two rows:

- `cpu` — the whole box's average over the reading's own window, with the two
  busiest logical threads marked as ticks on the same track. A pegged single
  thread is invisible in a 20% average on a 16-thread box, and that is the
  state worth catching. The row is deliberately NOT banded amber/red: a fleet
  box at 80% CPU is a fleet box doing its job.
- `mem` — used · cache (the part the kernel hands back) on the RAM bar,
  banded at 75/90, with SWAP on its own violet hairline under it, scaled to
  the swap total. Two tracks, as htop keeps Mem and Swp apart: swap is a
  different device with its own total, and crammed into the RAM bar it would
  land on the red segment exactly on the box closest to an OOM. Both rows are
  a fixed height, so nothing shifts on the poll where swap first appears.

It sits in its own fixed column at the right edge of the desktop bar (and as
the last full-width row on a phone), so its position does not move as accounts
are added, disabled or removed — and it is a SIBLING of the accounts strip,
never a cell inside it, because that strip is one tap target onto `/accounts`.

A reading that cannot be taken says WHICH condition it is, never 0%: `absent`
(no `/proc` — not a Linux box), `unreadable` (there and denied), `unparsable`,
`unsupported` (the agent predates the op — deploy the agent lane), `offline`
(no agent link) and `timeout`. The two halves fail independently, so an
unreadable `/proc/meminfo` still leaves the CPU row measured. The server
caches the reading for 5 s and shares one in-flight request, so twenty phones
polling together still cost the fleet box one sample.
```

- [ ] **Step 3: Run the prose gates**

Run: `cd server && ./node_modules/.bin/vitest run test/oss-metadata.test.ts test/box-token-census.test.ts test/pools-prose.test.ts test/license.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts`
Expected: PASS, 244 tests. These are the suites that read `README.md` and scan the four source roots.

- [ ] **Step 4: Run all three suites, in the foreground**

Run, each with a ≥600000ms timeout:

```bash
cd pwa    && npm run test
cd agent  && npm run test
cd server && npm run test
```

Expected: `pwa` 93/93 files; `agent` 20/20; `server` 359/360 — the one red file is
`session-hook.test.ts`, whose five strace tests cannot run on a box with no `strace`. Confirm that is
the only red and say so explicitly when reporting; do not call the suite green without naming it.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: the host-load gauge, and the pathless op it rides on"
```

- [ ] **Step 6: Report the deploy order**

Tell your human partner, in the completion message: this branch is **AGENT-FIRST**. The agent lane
(`bash deploy/deploy.sh agent <host>`) ships before the server lane, because the server's remote
adapter asks for an op the deployed agent does not have yet. Until the agent lands, the tile reads
`agent old` — which is the designed degradation and is worth looking at once on the real fleet, since
it is the only failure arm that a local test cannot produce for real.

---

## Deviations found

No behavioural deviation, so no `D-N` was owed and none was issued.

Five `Ruling:` lines were recorded instead, in
`.superpowers/sdd/2026-09-20-host-load-gauge/progress.md`, and they are all the same finding: this plan's
PREDICTED test counts are wrong. A reader who works Task 1 Step 4 will be told "PASS, 11 tests" and measure
13; the same gap appears at Task 2 (18 vs 20), Task 3 (20 agent files vs 19), Task 6 (14 vs 15), Task 7
(17 vs 18) and Task 8 (359 server files vs 362, which this plan's own three new files explain). In every case
the test BODIES this plan dictates were kept verbatim and the measured number was read as the truth. Measure,
do not copy the count.

Numbers are **ISSUED, never chosen**: `POST /api/ledger/deviations` mints a contiguous block, and
those are the only numbers you may define. Allocate and DEFINE IN THE SAME ACT. A session that
cannot reach the allocator (it is box-token gated) writes `D-TBD-<slug>` here and reports it, per
the worker skill's clause 11 — it does not copy a number out of another file, and it does not read
`GET /api/ledger`'s `floor` as a number it may take.

Record a deviation whenever the work departs from this plan in a way a reader of the plan would not
predict — including a guard this plan asks for that turns out to be wrong, a test that cannot be
written as specified, or an interface renamed after Task N published it.

## Self-review notes (from the plan author)

- **Spec coverage:** §2.1's nine decisions map to Tasks 6 and 7 (1, 2, 3, 4, 5 → Task 6; 6, 7 →
  Task 7; 8 → Tasks 1–6, each failure arm; 9 → Task 6's stale test). §3.1 → Task 3. §3.2 → Tasks 1–2.
  §3.3 → Tasks 4–5. §3.4 → Task 6. §4's four "must not forget" items are Steps inside Tasks 3, 5, 6
  and 8. §5's acceptance list is covered test-for-test.
- **One improvement over the reference:** `failureWord`/`failureSentence` gain an unknown-token arm
  (Review Focus 1). The parked branch returns `undefined` there, which React renders as an empty
  cell — honest-looking and wrong.
- **Interfaces:** every name a later task consumes is published in an earlier task's **Produces**
  block. `HostStatPort` (Task 4) is what `Deps.hostStat` (Task 5) holds; `hottestCpus` (Task 1) is
  what `CpuRow` (Task 6) calls; `HOST_CACHE_MS` (Task 4) is the number `HOST_POLL_MS` (Task 6) sits
  just above.

---

## Appendix A — `pwa/src/fleet/HostGauge.tsx`, in full (Task 6, Step 4)

Inlined rather than fetched: `wip/host-load-gauge` is a convenience, not a dependency, and this plan
must still be executable the day that branch is deleted. `failureWord`/`failureSentence` below are
the Review-Focus-1 versions, which is the one place this differs from the parked reference.

```tsx
// Host gauge — the load on the box the SESSIONS run on, in the shape of an
// account gauge so the strip reads as one row of instruments: two mono rows,
// a 5px meter each, a percentage, a trailing readout.
//
// It is NOT an account, and two things keep it from being mistaken for one:
// the cyan label, and its position. It sits in its own column, pinned to the
// RIGHT EDGE of the bar (`.accounts-bar`, shell.css) rather than in the
// accounts grid — so its place does not move when an account is added,
// removed or disabled, and an operator's eye can go to the same spot every
// time. On the phone it is the last, full-width row under the strip, for the
// same reason: a fixed place, not a place that depends on the count.
//
// It is also deliberately OUTSIDE `AccountsStrip`'s `role="link"`: that whole
// grid is one tap target onto /accounts, and a tap on the host tile must not
// open the accounts screen — there is nothing there about this box.
//
// WHAT THE TWO ROWS SAY:
//  - `cpu` — the green fill is the whole box's average over the reading's own
//    window; the two ticks are the two busiest logical threads. A pegged
//    single thread (one build, one test run, one wedged process) is invisible
//    in a 20%-average bar on a 16-thread box, and that is exactly the state
//    worth catching. A tick can never land inside the fill: no average
//    outruns its own maximum.
//  - `mem` — used (banded) · cache (grey, the part the kernel gives back) on
//    one RAM track, and swap on its own hairline UNDER it, scaled to the swap
//    total rather than to RAM.
//
// WHY SWAP IS NOT IN THE RAM BAR. It was, pinned to the right edge, and that
// is wrong twice over: the two cannot share a scale (swap is a different
// device with its own total), and on the box that matters most — the one
// nearly out of memory — the violet segment lands ON TOP of the red one,
// so the single worst reading is the one that draws as a collision. htop
// keeps Mem and Swp as separate bars for the same reason. The hairline sits
// inside the row's existing height (5px bar + 2px gap + 3px hairline = 10px,
// under the 15px the percentage cell already sets), so nothing grew and
// nothing can overlap.
//
// CPU IS NOT BANDED, on purpose. The account meters go amber at 50% and red
// at 75% because usage there is a budget being spent. A fleet box at 80% CPU
// is a fleet box doing its job. Colouring that red trains the eye to ignore
// the one row — memory — where red really does mean an OOM is coming.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { hottestCpus, type HostStat, type HostStatFailure } from '../../../shared/hoststat';
import { api } from '../lib/api';
import { elapsedWords } from '../lib/elapsed';
import { useNow } from '../lib/useNow';
import './fleet.css';

/** Poll cadence. The server caches just under this (`HOST_CACHE_MS`), so one
 *  client gets a fresh reading every poll and twenty clients still cost the
 *  fleet box one sample. */
export const HOST_POLL_MS = 6_000;

/** When a reading starts reading as STALE. A minute, not two poll intervals:
 *  `elapsedWords` declines to name anything under a minute ("moments"), and a
 *  six-second hiccup is not a state worth a word. Below this the tile shows
 *  the last reading plainly — it is still the truth about a box that was fine
 *  six seconds ago. */
export const HOST_STALE_MS = 60_000;

/** Memory's own bands, deliberately NOT `limitBand`'s 50/75 (components/
 *  LimitBar.tsx). That ladder is a spend-rate policy for account windows;
 *  this one is about headroom on a box, where half the RAM in use is normal
 *  and 90% is the last warning before the OOM killer picks a session. */
export function memBand(pct: number): 'ok' | 'warn' | 'crit' {
  if (pct > 90) return 'crit';
  if (pct >= 75) return 'warn';
  return 'ok';
}

/** A tick this hot is worth the amber: one thread at 90%+ is one thread that
 *  has stopped waiting for anything. */
const HOT_THREAD_PCT = 90;

/** The trailing word for a half that has no reading — short enough for the
 *  cell, and a different word per condition, because each has a different
 *  fix. The sentence version rides `title` for whoever has a pointer. */
export function failureWord(why: HostStatFailure): string {
  switch (why) {
    case 'offline': return 'no agent';
    case 'timeout': return 'no answer';
    case 'unsupported': return 'agent old';
    case 'absent': return 'no /proc';
    case 'unreadable': return 'no access';
    case 'unparsable': return 'bad format';
  }
  // A token this build has never heard of — a newer server naming a seventh
  // condition. The union is closed at COMPILE time (the `never` below stops
  // compiling the day a member is added without a case) and open on the WIRE,
  // where absence-permits cuts both ways: render something honest rather than
  // the `undefined` an exhaustive switch would otherwise return.
  const unknown: never = why;
  void unknown;
  return 'no reading';
}

export function failureSentence(why: HostStatFailure): string {
  switch (why) {
    case 'offline': return 'no link to the fleet host — nothing was asked';
    case 'timeout': return 'the fleet host was asked and did not answer in time';
    case 'unsupported': return 'the agent on the fleet host predates this reading — deploy the agent lane';
    case 'absent': return 'this host has no /proc — not a Linux box';
    case 'unreadable': return 'this host has /proc and would not let it be read';
    case 'unparsable': return '/proc was read and its shape was not understood';
  }
  const unknown: never = why;
  void unknown;
  return 'this build does not know why there is no reading';
}

/** A body this component is willing to render. `api.host()` is typed, and a
 *  TYPE IS NOT A GUARD: a fetch stub answering an unmatched route with a bare
 *  `{}` (several fixtures across this suite do exactly that) hands back
 *  `undefined` for both halves, and `cpu.ok` on it throws inside render —
 *  taking the whole screen down, not just this tile. The same lesson
 *  `AccountsStrip` records for its roster array, one component over. A
 *  malformed body keeps the last good reading, which then ages into `stale`. */
function isReading(v: unknown): v is HostStat {
  if (typeof v !== 'object' || v === null) return false;
  const { at, cpu, mem } = v as { at?: unknown; cpu?: unknown; mem?: unknown };
  return typeof at === 'number' && isHalf(cpu) && isHalf(mem);
}

function isHalf(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const half = v as { ok?: unknown; why?: unknown };
  return half.ok === true || (half.ok === false && typeof half.why === 'string');
}

const gib = (kb: number): string => (kb / 1048576).toFixed(1);
const pctOf = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.min(100, Math.max(0, (part / whole) * 100)));

/** One track, the shape `.acct-meter` has everywhere else in the strip. */
const track = (inner: ReactNode): ReactNode => <span className="acct-meter host-meter">{inner}</span>;

function Row({ label, cell, pct, trail, title, dim }: {
  label: string;
  /** The whole middle column — one track for cpu, a track plus the swap
   *  hairline for memory. Passed whole rather than wrapped here, because the
   *  two rows are genuinely different shapes and a `swap?:` prop on this
   *  component would be a second way to say the same thing. */
  cell: ReactNode;
  pct: string;
  trail: string;
  title: string;
  dim: boolean;
}): ReactNode {
  return (
    <div className="acct-row" title={title}>
      <span className="acct-win">{label}</span>
      {cell}
      <span className="acct-pct" data-dim={dim ? 'true' : undefined}>{pct}</span>
      <span className="host-trail">{trail}</span>
    </div>
  );
}

function CpuRow({ stat }: { stat: HostStat }): ReactNode {
  const cpu = stat.cpu;
  if (!cpu.ok) {
    return <Row label="cpu" cell={track(null)} pct="—" trail={failureWord(cpu.why)} title={failureSentence(cpu.why)} dim />;
  }
  // Two ticks, and only when there is more than one thread to distinguish: on
  // a single-CPU box the hottest thread IS the average, and a tick sitting on
  // the fill's own edge would be noise dressed as information.
  const hot = cpu.perCpu.length > 1 ? hottestCpus(cpu.perCpu, 2) : [];
  const title = [
    `cpu ${Math.round(cpu.total)}% over ${(cpu.windowMs / 1000).toFixed(1)}s`,
    cpu.perCpu.length > 0 ? `${cpu.perCpu.length} threads` : null,
    hot.length > 0 ? `hottest ${hot.map((h) => `#${h.id} ${Math.round(h.pct)}%`).join(', ')}` : null,
  ].filter((p) => p !== null).join(' · ');
  return (
    <Row
      label="cpu"
      cell={track(
        <>
          <span className="host-fill host-fill--cpu" style={{ width: `${cpu.total.toFixed(2)}%` }} />
          {hot.map((h, i) => (
            <span
              key={h.id}
              className="host-tick"
              data-hot={h.pct >= HOT_THREAD_PCT ? 'true' : undefined}
              data-rank={i === 0 ? 'first' : 'second'}
              style={{ left: `calc(${h.pct.toFixed(2)}% - 1px)` }}
            />
          ))}
        </>,
      )}
      pct={`${Math.round(cpu.total)}%`}
      trail={hot.length > 0 ? `↑${hot.map((h) => Math.round(h.pct)).join('·')}` : ''}
      title={title}
      dim={false}
    />
  );
}

function MemRow({ stat }: { stat: HostStat }): ReactNode {
  const mem = stat.mem;
  if (!mem.ok) {
    return <Row label="mem" cell={track(null)} pct="—" trail={failureWord(mem.why)} title={failureSentence(mem.why)} dim />;
  }
  const used = pctOf(mem.usedKb, mem.totalKb);
  const cache = pctOf(mem.cacheKb, mem.totalKb);
  // Swap is measured against the SWAP TOTAL, on its own hairline: it is a
  // different device, and a bar that mixes the two scales answers neither
  // "how full is memory" nor "how deep into swap are we". A box with swap
  // configured but none in use draws no hairline at all — the row keeps its
  // height either way, so nothing shifts when it appears.
  const swap = pctOf(mem.swapUsedKb, mem.swapTotalKb);
  // Under half a percent is a segment nobody can see and a cap nobody can
  // read: below that the used fill simply keeps the right-hand cap itself.
  // NOTE for a reader looking at the bar: cache is NOT always the smaller of
  // the two, and it is not always the larger either — `parseMeminfo` computes
  // `used = total − free − cache`, so the pair always sums to the bar and
  // either can dominate. A box full of long-lived node processes reads mostly
  // used; a box that has just finished a big build reads a lot of cache.
  const hasCache = cache >= 0.5;
  const title = [
    `${gib(mem.usedKb)}G used of ${gib(mem.totalKb)}G`,
    `cache ${gib(mem.cacheKb)}G`,
    `available ${gib(mem.availableKb)}G`,
    mem.swapTotalKb > 0 ? `swap ${gib(mem.swapUsedKb)}G of ${gib(mem.swapTotalKb)}G` : 'no swap',
  ].join(' · ');
  return (
    <Row
      label="mem"
      cell={(
        <span className="host-mem">
          {track(
            <>
              {/* ONE PILL IN TWO TONES. The track clips both outer ends round,
                  the join between them stays square, and the right-hand cap
                  belongs to whichever segment is last — so a box with no cache
                  worth drawing still ends in a cap and does not look clipped. */}
              <span
                className="host-fill host-fill--mem"
                data-band={memBand(used)}
                data-tail={hasCache ? undefined : 'true'}
                style={{ width: `${used.toFixed(2)}%` }}
              />
              {hasCache && <span className="host-seg-cache" style={{ left: `${used.toFixed(2)}%`, width: `${cache.toFixed(2)}%` }} />}
            </>,
          )}
          {mem.swapUsedKb > 0 && (
            <span className="host-swap" title={`swap ${gib(mem.swapUsedKb)}G of ${gib(mem.swapTotalKb)}G`}>
              <span className="host-swap-fill" style={{ width: `${swap.toFixed(2)}%` }} />
            </span>
          )}
        </span>
      )}
      pct={`${Math.round(used)}%`}
      // The swap figure displaces the totals when there is any: a box that has
      // started swapping has one number worth the cell, and it is that one.
      trail={mem.swapUsedKb > 0 ? `sw ${gib(mem.swapUsedKb)}G` : `${gib(mem.usedKb)}/${gib(mem.totalKb)}G`}
      title={title}
      dim={false}
    />
  );
}

export function HostGauge(): ReactNode {
  const [stat, setStat] = useState<HostStat | null>(null);
  const now = useNow(HOST_POLL_MS);

  useEffect(() => {
    let live = true;
    let issued = 0;
    const load = (): void => {
      // A hidden tab is a tab nobody is reading a gauge in. The listener below
      // snaps it current the moment it comes back, so the cost of skipping is
      // one stale frame nobody saw.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const mine = ++issued;
      // `mine === issued` drops an out-of-order answer (FleetHostBanner's
      // idiom): a slow poll landing after a fast one would otherwise walk the
      // reading backwards. A failed poll sets nothing — the last reading
      // stands and ages into `stale`, which is the honest rendering of "the
      // box was fine six seconds ago and nobody can reach it now".
      void api.host().then((h) => {
        if (!live || mine !== issued) return;
        if (isReading(h)) { setStat(h); return; }
        console.warn('ccrc: GET /api/host answered a body this gauge cannot read; keeping the last reading.', h);
      }).catch(() => {});
    };
    load();
    const timer = setInterval(load, HOST_POLL_MS);
    const onVisible = (): void => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const stale = stat !== null && now - stat.at > HOST_STALE_MS;
  // NO `role="group"`/`aria-label` on the tile: the account gauges beside it
  // carry neither, its rows already read in order ("host · cpu 34% ↑91·78 ·
  // mem 57% sw 0.5G"), and FleetScreen's group census is its bucket chips —
  // a second kind of group in that list is one more dead end in the rotor
  // (fleet-screen.test.tsx, "adds no landmark per bucket").
  return (
    <div className="host-gauge" data-stale={stale ? 'true' : undefined}>
      <span className="host-label">host</span>
      <div className="acct-rows">
        {stat === null ? (
          <>
            <Row label="cpu" cell={track(null)} pct="—" trail="checking…" title="waiting for the first reading" dim />
            <Row label="mem" cell={track(null)} pct="—" trail="" title="waiting for the first reading" dim />
          </>
        ) : (
          <>
            <CpuRow stat={stat} />
            <MemRow stat={stat} />
          </>
        )}
      </div>
      {stale && <span className="host-stale" title="no fresh reading has landed">{elapsedWords(now - stat.at)} old</span>}
    </div>
  );
}
```

## Appendix B — the `fleet.css` host block, in full (Task 6, Step 5)

Goes directly after the existing `.acct-reset` rule.

```css
.acct-pct[data-dim='true'] { color: var(--ink-tertiary); }

/* ── host gauge ───────────────────────────────────────────────────
   The load on the box the SESSIONS run on, built from the accounts strip's
   own row chrome (.acct-row/.acct-meter/.acct-pct) so the two read as one
   instrument panel — but NOT inside .accounts-strip, which is a single
   role="link" onto /accounts and has nothing to say about this box.

   On the phone this is the last, full-width element under the strip; on
   desktop shell.css pins it to a fixed column at the right edge. Both are
   the same decision: a position that does not move when an account is added
   or removed, so the eye goes to one place. */
.host-gauge {
  display: grid;
  gap: 1px;
  padding: 3px var(--sp-2) 4px;
  background: var(--bg-surface);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  margin-bottom: var(--sp-2);
}
.host-gauge .host-label {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  line-height: 1.25;
  /* Cyan, not an account hue drawn from the roster: this tile is not an
     account, and the one colour no wrapper can be assigned is the one that
     says so. */
  color: var(--acct-cyan);
}
/* The meter positions its own segments, unlike .acct-fill's single flow
   child: memory is two segments and cpu carries two ticks. */
.host-gauge .host-meter { position: relative; }
.host-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: var(--r-full);
  /* CPU's default: the "working" green, never a limit band. A busy fleet box
     is a fleet box doing its job — see HostGauge.tsx. */
  background: var(--status-busy);
  transition: width var(--dur-base) var(--ease-swift);
}
/* Memory, and only memory, is banded — 75/90, not the account ladder's
   50/75 (HostGauge.tsx's `memBand` carries the reason). */
.host-fill[data-band='ok']   { background: var(--limit-ok); }
.host-fill[data-band='warn'] { background: var(--limit-warn); }
.host-fill[data-band='crit'] { background: var(--limit-critical); }
/* Cache: present, but the part the kernel hands back under pressure, so it
   reads as filled-but-not-spent.
   ONE PILL IN TWO TONES, not two pills: `.host-fill`'s own full radius would
   put a rounded cap in the MIDDLE of the bar where `used` meets `cache`, and
   the track's dark corners would show through the notch. So the mem fill
   carries no radius of its own, the track's `overflow: hidden` rounds the
   left end, and the right-hand cap goes on whichever segment is last. (A 1px
   divider stood here for one round and read as a gap punched in the bar
   rather than as two readings.) */
.host-fill--mem { border-radius: 0; }
.host-fill--mem[data-tail='true'],
.host-seg-cache {
  border-radius: 0 var(--r-full) var(--r-full) 0;
}
.host-seg-cache {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--ink-tertiary);
}
/* MEMORY IS TWO TRACKS, not one track with swap crammed into it: RAM on top,
   swap on a hairline under it. Swap is a different device with its own total,
   so it cannot share RAM's scale — and pinned into RAM's track it would land
   ON the red segment exactly on the box that is closest to an OOM, drawing
   the worst reading in the fleet as a collision.

   Fixed rows, always both: 5 + 2 + 3 = 10px, inside the 15px the percentage
   cell already gives this row, so the tile does not grow and nothing shifts
   on the poll where swap first appears. */
.host-mem {
  display: grid;
  grid-template-rows: 5px 3px;
  gap: 2px;
  align-content: center;
  min-width: 0;
}
/* Rendered only when some swap is in use — a box that never swaps shows one
   bar, not one bar and an empty promise of another. */
.host-swap {
  position: relative;
  display: block;
  border-radius: var(--r-full);
  background: var(--bg-well);
  overflow: hidden;
}
.host-swap-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  min-width: 2px;
  border-radius: var(--r-full);
  background: var(--acct-violet);
  transition: width var(--dur-base) var(--ease-swift);
}
/* The two hottest threads, on the cpu track. They can only ever fall on the
   empty part of it: no average outruns its own maximum. */
.host-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--ink-primary);
}
.host-tick[data-rank='second'] { background: var(--ink-secondary); }
/* AFTER the rank rule on purpose — equal specificity, so source order is what
   makes a pegged second thread amber rather than quiet grey. */
.host-tick[data-hot='true'] { background: var(--status-attention); }
.host-gauge .host-trail { color: var(--ink-tertiary); white-space: nowrap; }
.host-gauge .host-stale {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--ink-tertiary);
}
/* A frozen reading must not keep reading as live pressure — the same
   treatment, for the same reason, that a disabled account lane's meter gets
   (`.accounts-row[data-disabled='true'] .acct-fill`, further down this file).
   Greying the fills rather than fading the tile keeps every label at its
   measured contrast. */
.host-gauge[data-stale='true'] .host-fill,
.host-gauge[data-stale='true'] .host-seg-cache,
.host-gauge[data-stale='true'] .host-swap-fill,
.host-gauge[data-stale='true'] .host-tick { background: var(--edge-subtle); }
```
