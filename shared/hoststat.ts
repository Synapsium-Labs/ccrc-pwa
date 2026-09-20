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

/** A whole reading that failed for one reason — the shape every adapter
 *  answers with when it never got as far as the box (`offline`, `timeout`,
 *  `unsupported`). One writer, so the two halves can never drift apart. */
export function hostStatFailed(why: HostStatFailure, at: number): HostStat {
  return { at, cpu: { ok: false, why }, mem: { ok: false, why } };
}
