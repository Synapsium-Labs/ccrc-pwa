// The simulator's world on the time-ports fake (Overlord spec §11.7): the fake's clock, timers and seeded chance, plus
// a crash that drops the server's timers and boots it again, and a skew between the server's wall clock and the host's.
// The world keeps no queue, tie order or generator of its own: the fake orders every timer and draws every number.
import type { Cancel, Clock, Entropy, Scheduler, TimePorts } from '../../src/time/ports.js';
import { fakeTime, type FakeTime } from '../fakeTime.js';

/** How many microtask turns settle() waits at most for the promises scheduled calls returned. */
const SETTLE_TURNS = 10_000;

/** The time-ports fake, plus what it has not: a crash that drops the server's timers and boots it again as a world
 *  event, and a skew between the server's wall clock and the host's. Mono starts at 0 and runs on across a crash. */
export class SimWorld {
  /** The one fake underneath: the host's clock, every timer, and the one seeded chance. */
  readonly time: FakeTime;
  /** What the server under test is handed: the host's clock with its wall skewed by skewWall(), a scheduler whose
   *  pending calls crash() cancels, and the fake's entropy. */
  readonly server: TimePorts;
  private skew = 0;
  private down = false;
  private readonly boots: Array<() => void> = [];
  // The server's pending Cancels. Under server/src a stored handle like this would make a file a scheduler under the
  // ring rule (and the ring reader cannot see it yet); under server/test/ the ring rule does not apply.
  private readonly live = new Set<Cancel>();
  // A budget of scheduled calls per world: a counter, not a queue, so it orders nothing. The fake's advance loops while
  // a call is due, so a timer that re-arms at 0 ms would never let it return; past the budget the call is not made, the
  // throw becomes the fake's warning, the re-arm stops and simulate fails on the warning.
  private readonly maxCalls: number;
  private calls = 0;
  // Every promise a scheduled call returned and that has not settled yet, so that settle() can wait for them. The fake
  // records a rejection in a `.catch` it attaches after the call returns, so the rejection lands one microtask later.
  private readonly unsettled = new Set<Promise<unknown>>();

  constructor(opts: { readonly wallMs: number; readonly seed: number; readonly maxCalls?: number }) {
    this.maxCalls = opts.maxCalls ?? 200_000;
    this.time = fakeTime({ wallMs: opts.wallMs, seed: opts.seed });
    const host = this.time.ports;
    const clock: Clock = { wall: () => host.clock.wall() - this.skew, mono: () => host.clock.mono() };
    const scheduler: Scheduler = {
      after: (ms, fn) => {
        const inner: Cancel = host.scheduler.after(ms, this.budgeted(() => { this.live.delete(cancel); return fn(); }));
        const cancel: Cancel = () => { this.live.delete(cancel); inner(); };
        this.live.add(cancel);
        return cancel;
      },
    };
    const entropy: Entropy = host.entropy;
    this.server = { clock, scheduler, entropy };
  }

  /** The world's own timer (the fleet, the operator, the coordinator): the fake's `after`. Survives crash(). */
  envAfter(ms: number, fn: () => unknown): Cancel { return this.time.ports.scheduler.after(ms, this.budgeted(fn)); }

  /** Wraps a scheduled call: counts it, past maxCalls throws instead of calling fn, and keeps a promise it returns
   *  until that promise settles. */
  private budgeted(fn: () => unknown): () => unknown {
    return () => {
      if (++this.calls > this.maxCalls) {
        throw new RangeError(`SimWorld: more than ${this.maxCalls} scheduled calls; a timer re-arms itself without end?`);
      }
      const out = fn();
      if (out instanceof Promise) {
        this.unsettled.add(out);
        const drop = (): void => { this.unsettled.delete(out); };
        out.then(drop, drop);
      }
      return out;
    };
  }

  /** Waits, on microtasks only, until every promise a scheduled call returned has settled, or until `SETTLE_TURNS`
   *  turns have passed (a promise waiting on a timer the run never reached stays pending), and one turn more so that
   *  the fake's own `.catch` has recorded a rejection. It never yields to a timer or to I/O, so nothing outside the
   *  scenario runs while the ambient sources are stubbed. */
  async settle(): Promise<void> {
    for (let turn = 0; this.unsettled.size > 0 && turn < SETTLE_TURNS; turn++) await Promise.resolve();
    await Promise.resolve();
  }

  /** Registers a boot routine and runs it now; each boot after a crash runs every routine again. */
  onBoot(run: () => void): void { this.boots.push(run); run(); }

  /** `time.advance` to the mono time untilMono: the fake runs every timer due by then, server and world alike, in
   *  (due time, scheduling order) order, with both clocks at each one's due time, then stands at untilMono. */
  runUntil(untilMono: number): void { this.time.advance(untilMono - this.time.ports.clock.mono()); }

  /** The server dies now: its pending timers are cancelled, and the boot routines run again downMs later, as a world
   *  timer, so world timers due meanwhile run at their own times first. Throws while the server is down. */
  crash(downMs: number): void {
    if (this.down) throw new RangeError('SimWorld.crash: the server is already down');
    for (const cancel of [...this.live]) cancel();
    this.live.clear();
    this.down = true;
    this.time.ports.scheduler.after(downMs, this.budgeted(() => {
      for (const run of this.boots) run();
      this.down = false;
    }));
  }

  /** True from a crash until its boot routines have run. */
  isDown(): boolean { return this.down; }

  /** From now on the server's wall clock reads ms earlier than the host's. Mono and the host clock are untouched. A
   *  step of the one wall clock, for both, is the fake's own `time.stepWall`. */
  skewWall(ms: number): void { this.skew = ms; }
}

/** True with probability p: `entropy.below(2 ** 32) < p * 2 ** 32`. One draw. */
export function chance(entropy: Entropy, p: number): boolean { return entropy.below(2 ** 32) < p * 2 ** 32; }

/** `xs[entropy.below(xs.length)]`. One draw; an empty list throws the fake's RangeError. */
export function pick<T>(entropy: Entropy, xs: readonly T[]): T { return xs[entropy.below(xs.length)] as T; }

