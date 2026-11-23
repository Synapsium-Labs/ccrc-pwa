// #1170. L4: the host-pressure beat. It asks the fleet io for the host's PSI on its own clock and records what came
// back (the reading, or that the ask went unanswered, or that it is still out); every decision is `pressure.ts`'s.
// D-8920: it holds the host's size too, and records the automatic run cap that size puts in force.
// `watch.ts` owns one of these and calls `sweep()` from its tick ABOVE the registry read's fail-shut return: a thrash
// is exactly when that read fails, and the last reading before it is the evidence.
import type { HostMachineReading, HostPressureHealth } from '../../shared/pressure.js';
import type { Deps } from './deps.js';
import type { WatcherCoordPort } from './coord/ports.js';
import type { NotifyLog } from './notifylog.js';
import type { MeasuredPressure } from './io.js';
import { CAPS_FEED_TITLE, capAutomaticNotice } from './coord/caps.js';
import { capNow } from './coord/dispatch.js';
import { notify } from './notice.js';
import { EMPTY_PRESSURE, machineAfter, machineReadingOf, memoryReadingOf, pressureAskDue, pressureBlock, type PressureState } from './pressure.js';

/** What the lane reads: the fleet io for the beat, and, for the automatic cap's feed record, the store members it asks
 *  and the ring it records to. Without a store there is no record. */
export interface PressureLaneDeps extends Pick<Deps, 'io'> {
  readonly coord?: Pick<WatcherCoordPort, 'caps' | 'capMode' | 'capsUpdatedAt' | 'hasNotice' | 'recordFeedEvent'> | undefined;
  readonly notifyLog?: NotifyLog | undefined;
}

export class PressureLane {
  /** The wall clock the pass last started on (0: never). */
  private lastSweep = 0;
  private state: PressureState = EMPTY_PRESSURE;
  /** The key `noteAutomaticCap` last recorded or found recorded, or null. */
  private capNoticeSettled: string | null = null;

  constructor(private readonly deps: () => PressureLaneDeps, private readonly now: () => number = Date.now) {}

  /** The block for `GET /api/fleet/health`, with the link as the route reads it (`linkUp`), or `null` before the first
   *  ask: absence on the wire reads as UNKNOWN. */
  block(linkUp: boolean): HostPressureHealth | null {
    return this.lastSweep === 0 ? null : pressureBlock(this.state, linkUp, this.now());
  }

  /** D-8122: the last fresh reading's level and headroom, for the automatic wakes' memory gate. Issues no read. */
  memoryReading(): ReturnType<typeof memoryReadingOf> {
    return memoryReadingOf(this.state, this.now());
  }

  /** D-8920: the host's size as last measured, for the automatic run cap. Issues no read. */
  machineReading(): HostMachineReading {
    return machineReadingOf(this.state);
  }

  /** One pass, throttled on its own clock (`pressureAskDue`), and never two asks out at once (a stalled one stays the evidence). Never
   *  rejects; PUBLIC through the watcher because `tick()` dispatches it with `void`. */
  async sweep(): Promise<void> {
    const at = this.now();
    if (this.state.inflightSince !== null) return;
    if (!pressureAskDue(this.state, this.lastSweep, at)) return;
    this.lastSweep = at;
    this.state = { ...this.state, inflightSince: at };
    let read: MeasuredPressure;
    try { read = await this.deps().io.pressureMeasured(); } catch { read = { ok: false, reason: 'unanswered', machine: { kind: 'unmeasured', why: 'no-reading' } }; }
    const done = this.now();
    // D-8920: the size rides every answer, with or without a PSI reading (`machineAfter` decides).
    const machine = machineAfter(this.state.machine, read.machine);
    if (read.ok) this.state = { last: { at: done, psi: read.psi, headroomBytes: read.headroomBytes ?? null }, unansweredAt: null, inflightSince: null, machine };
    else if (read.reason === 'unanswered') this.state = { ...this.state, unansweredAt: done, inflightSince: null, machine };
    else this.state = { ...this.state, inflightSince: null, machine };
    this.noteAutomaticCap();
  }

  /** D-8920: ONE feed row when the cap in force is the derived one and differs from the stored number
   *  (`coord/caps.ts#capAutomaticNotice` decides, and words it): the upgrade's first reading, a boot's, a host that
   *  derives a new cap. It rides this beat because the beat is what lands the size the cap is derived from. Record-only,
   *  never a push. Once per key: the archive is asked before the write (`hasNotice`), so a restart and the caps route's
   *  own record of the same move write nothing twice, and the key last settled is remembered so a quiet beat asks the
   *  archive nothing. Synchronous, one step: no write lands between the reads and the record. A throw is logged and
   *  the next beat asks again. */
  private noteAutomaticCap(): void {
    const { coord, notifyLog } = this.deps();
    if (!coord) return;
    try {
      const n = capAutomaticNotice(coord.caps(), coord.capsUpdatedAt(), capNow(coord, () => this.machineReading()));
      if (n === null || n.dedupeKey === this.capNoticeSettled) return;
      if (!coord.hasNotice('coord', '', n.dedupeKey)) {
        notify({ notifyLog, coord }, { kind: 'coord', sessionId: '', runId: null, title: CAPS_FEED_TITLE, body: n.body },
          'record-only', { dedupeKey: n.dedupeKey, lane: 'run cap', degraded: 'the automatic cap is in force, feed archive degraded' });
      }
      this.capNoticeSettled = n.dedupeKey;
    } catch (err) {
      console.warn(`ccrc-server: run cap: the automatic cap's feed record failed (${err instanceof Error ? err.message : String(err)}); asked again next beat`);
    }
  }
}
