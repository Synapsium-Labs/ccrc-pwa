// #1170. L4: the host-pressure beat. It asks the fleet io for the host's PSI on its own clock and records what came
// back (the reading, or that the ask went unanswered, or that it is still out); every decision is `pressure.ts`'s.
// `watch.ts` owns one of these and calls `sweep()` from its tick ABOVE the registry read's fail-shut return: a thrash
// is exactly when that read fails, and the last reading before it is the evidence.
import type { HostPressureHealth } from '../../shared/pressure.js';
import type { Deps } from './deps.js';
import type { MeasuredPressure } from './io.js';
import { EMPTY_PRESSURE, PRESSURE_SWEEP_MS, pressureBlock, type PressureState } from './pressure.js';

export class PressureLane {
  /** The wall clock the pass last started on (0: never). */
  private lastSweep = 0;
  private state: PressureState = EMPTY_PRESSURE;

  constructor(private readonly deps: () => Pick<Deps, 'io'>, private readonly now: () => number = Date.now) {}

  /** The block for `GET /api/fleet/health`, with the link as the route reads it (`linkUp`), or `null` before the first
   *  ask: absence on the wire reads as UNKNOWN. */
  block(linkUp: boolean): HostPressureHealth | null {
    return this.lastSweep === 0 ? null : pressureBlock(this.state, linkUp, this.now());
  }

  /** One pass, throttled on its own clock, and never two asks out at once (a stalled one stays the evidence). Never
   *  rejects; PUBLIC through the watcher because `tick()` dispatches it with `void`. */
  async sweep(): Promise<void> {
    const at = this.now();
    if (this.state.inflightSince !== null) return;
    if (this.lastSweep !== 0 && at - this.lastSweep < PRESSURE_SWEEP_MS) return;
    this.lastSweep = at;
    this.state = { ...this.state, inflightSince: at };
    let read: MeasuredPressure;
    try { read = await this.deps().io.pressureMeasured(); } catch { read = { ok: false, reason: 'unanswered' }; }
    const done = this.now();
    if (read.ok) this.state = { last: { at: done, psi: read.psi }, unansweredAt: null, inflightSince: null };
    else if (read.reason === 'unanswered') this.state = { ...this.state, unansweredAt: done, inflightSince: null };
    else this.state = { ...this.state, inflightSince: null };
  }
}
