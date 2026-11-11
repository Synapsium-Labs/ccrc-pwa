// The test side of the clock kernel's ports (Overlord spec §11.5, §11.7 Table 11.7b): a clock, a one-shot scheduler
// and seeded chance that a test or the simulator drives by hand. It never ships: it lives under server/test/, and
// `single-definition/time-ports.test.ts` refuses a server/src import of it. Its argument checks are the rules'
// (`server/src/time/rules.ts`), never a copy, so the fake and the system adapters refuse the same inputs.
import type { Cancel, Clock, Entropy, Scheduler, TimePorts } from '../src/time/ports.js';
import { checkDelayMs, checkEntropyBound, checkEntropyBytes } from '../src/time/rules.js';

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
   *  `gapMs`, and starts mono at 0. `advance` and `restart` throw RangeError when a scheduled call calls them. */
  restart(gapMs: number): void;
  /** Calls scheduled and neither fired nor cancelled. */
  pending(): number;
}

/** A seeded PRNG: draws in [0, 1). Copied verbatim from `server/test/docs-grammar.test.ts#mulberry32`, one of nine
 *  local copies in the test tree today; this is the first exported one (D-8225). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pending { readonly due: number; readonly seq: number; readonly fn: () => unknown; live: boolean }

const TWO_32 = 2 ** 32;

function failureLine(err: unknown): string {
  return `ccrc-server: a scheduled call failed: ${err instanceof Error ? err.message : String(err)}`;
}

function checkStep(what: string, ms: number, mayBeNegative: boolean): void {
  if (!Number.isFinite(ms) || (!mayBeNegative && ms < 0)) {
    throw new RangeError(`fakeTime.${what}: ${ms} ms is not a finite ${mayBeNegative ? 'step' : 'step of 0 or more'}`);
  }
}

export function fakeTime(opts: { wallMs?: number; monoMs?: number; seed?: number } = {}): FakeTime {
  let wall = opts.wallMs ?? FAKE_T0;
  let mono = opts.monoMs ?? 0;
  let seq = 0;
  let queue: Pending[] = [];
  const warnings: string[] = [];
  const next = mulberry32(opts.seed ?? 1);

  /** One unsigned 32-bit draw (exact: each mulberry32 value is an integer over 2^32). */
  const draw = (): number => next() * TWO_32;
  const bytes = (k: number): number[] => {
    const out: number[] = [];
    while (out.length < k) {
      const d = draw();
      for (let i = 0; i < 4 && out.length < k; i++) out.push(Math.floor(d / 2 ** (8 * i)) & 0xff);
    }
    return out;
  };
  const toHex = (bs: readonly number[]): string => bs.map((b) => b.toString(16).padStart(2, '0')).join('');

  let firing = false;
  const fire = (p: Pending): void => {
    firing = true;
    try {
      const out = p.fn();
      if (out instanceof Promise) out.catch((err: unknown) => { warnings.push(failureLine(err)); });
    } catch (err) {
      warnings.push(failureLine(err));
    } finally {
      firing = false;
    }
  };
  /** `advance` and `restart` move both clocks to a target they computed before firing anything, so a firing call that
   *  re-enters one of them would see its own move undone (mono set back, a wall gap counted twice). Refused instead. */
  const notWhileFiring = (what: string): void => {
    if (firing) throw new RangeError(`fakeTime.${what}: called from a scheduled call; schedule the step instead`);
  };

  const clock: Clock = { wall: () => wall, mono: () => mono };
  const scheduler: Scheduler = {
    after(ms: number, fn: () => unknown): Cancel {
      const p: Pending = { due: mono + checkDelayMs(ms), seq: seq++, fn, live: true };
      queue.push(p);
      return () => { p.live = false; };
    },
  };
  const entropy: Entropy = {
    hex: (n) => toHex(bytes(checkEntropyBytes(n))),
    uuid: () => {
      const b = bytes(16);
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const h = toHex(b);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    below: (n) => {
      const bound = checkEntropyBound(n);   // checked before the draw, so a refused call consumes none
      return Math.floor(draw() * bound / TWO_32);
    },
  };

  return {
    ports: { clock, scheduler, entropy },
    warnings,
    advance(ms: number): void {
      notWhileFiring('advance');
      checkStep('advance', ms, false);
      const target = mono + ms;
      for (;;) {
        queue = queue.filter((p) => p.live);
        let first: Pending | undefined;
        for (const p of queue) {
          if (p.due <= target && (first === undefined || p.due < first.due || (p.due === first.due && p.seq < first.seq))) first = p;
        }
        if (first === undefined) break;
        first.live = false;
        wall += first.due - mono;
        mono = first.due;
        fire(first);
      }
      wall += target - mono;
      mono = target;
    },
    stepWall(deltaMs: number): void { checkStep('stepWall', deltaMs, true); wall += deltaMs; },
    restart(gapMs: number): void {
      notWhileFiring('restart');
      checkStep('restart', gapMs, false);
      for (const p of queue) p.live = false;
      queue = [];
      wall += gapMs;
      mono = 0;
    },
    pending: () => queue.filter((p) => p.live).length,
  };
}
