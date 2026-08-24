/**
 * The deliverability table as DATA — the single source both implementations
 * are driven against (the sessionLifecycleFixture.ts idiom): `sweepMail`'s
 * real ladder consumes each row as seeded files + a scripted tmux, and
 * `peerDeliverable` consumes the same row as a PeerProbe via `probeOf`.
 * Rows are stated in registry-native terms (stamp AGES in whole seconds,
 * a tmux word, a pid boolean) because that is the one vocabulary both
 * sides can be built from.
 */
import { sessionLifecycle, type PeerDeliverable } from '../../shared/api.js';
import type { PeerProbe } from '../src/coord/peers.js';

export const PARITY_NOW = 1_800_000_000_000;
export const PARITY_PID = 4242;

export interface DeliverabilityRow {
  /** Doubles as the `it` title in both suites. */
  readonly name: string;
  readonly registry: PeerProbe['registry'];
  /** Typed off the PROBE, and used to drive the real Tmux stub — this one
   *  field is what keeps the probe's consumer-declared verdict words and
   *  exec.ts's SessionVerdict words from drifting silently. */
  readonly tmux: PeerProbe['tmux'];
  readonly panePid: boolean;
  readonly supervisedAgoSec: number | null;
  readonly stoppedAgoSec: number | null;
  readonly started: boolean;
  /** true = every TRANSIENT gate open (idle, quiet, no ask, off cooldown);
   *  false = the live-state is affirmatively NOT quiet — busy, not gone. */
  readonly quiet: boolean;
  readonly expect: PeerDeliverable;
}

export const DELIVERABILITY_FIXTURE: readonly DeliverabilityRow[] = [
  { name: 'a live, supervised, quiet peer is yes — and the sweep sends',
    registry: 'measured', tmux: 'live', panePid: true,
    supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true, expect: 'yes' },

  { name: 'an UNSUPERVISED live pane is still yes — mail lands in the pane, not the supervisor',
    registry: 'measured', tmux: 'live', panePid: true,
    supervisedAgoSec: null, stoppedAgoSec: null, started: true, quiet: true, expect: 'yes' },

  { name: 'no registry row at all is no:not-in-registry — proven absence',
    registry: 'absent', tmux: 'live', panePid: true,
    supervisedAgoSec: null, stoppedAgoSec: null, started: false, quiet: true,
    expect: 'no:not-in-registry' },

  { name: "a registry row listed but unreadable is unknown — one dropped round trip is not a reaping",
    registry: 'unmeasurable', tmux: 'live', panePid: true,
    supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true, expect: 'unknown' },

  { name: 'a session tmux proves gone is no:session-gone',
    registry: 'measured', tmux: 'gone', panePid: true,
    supervisedAgoSec: null, stoppedAgoSec: 90, started: true, quiet: true,
    expect: 'no:session-gone' },

  { name: 'a session tmux cannot answer for is unknown — substrate silence is not death',
    registry: 'measured', tmux: 'unknown', panePid: true,
    supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true, expect: 'unknown' },

  { name: 'a live session with no pane pid is no:no-pane',
    registry: 'measured', tmux: 'live', panePid: false,
    supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true,
    expect: 'no:no-pane' },

  { name: 'a BUSY peer is yes and gets nothing sent — transient lane state is not unreachability (R2)',
    registry: 'measured', tmux: 'live', panePid: true,
    supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: false, expect: 'yes' },
];

/** One fixture row -> the pure ladder's own input shape. `alive` for the
 *  lifecycle input is the row's tmux verdict — the same measurement the
 *  sweep's rung 2 makes — so the two arms read one world. */
export function probeOf(row: DeliverabilityRow, nowMs: number = PARITY_NOW): PeerProbe {
  return {
    registry: row.registry,
    tmux: row.tmux,
    panePid: row.panePid ? PARITY_PID : null,
    lifecycle: sessionLifecycle({
      alive: row.tmux === 'live',
      supervisedAt: row.supervisedAgoSec === null ? null : nowMs - row.supervisedAgoSec * 1000,
      stoppedAt: row.stoppedAgoSec === null ? null : nowMs - row.stoppedAgoSec * 1000,
      stopSurface: row.stoppedAgoSec === null ? null : 'pwa',
      started: row.started,
      unmeasured: [],
      nowMs,
    }),
  };
}
