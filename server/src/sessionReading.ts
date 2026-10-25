// "Is it alive" and "is it idle", read once (consolidation spec K3 and K4; ARCH-47, #782). L1, pure: no clock, no I/O.
//
// `readSession` is the one function over FACTS; who supplies the facts is the caller's. A display surface feeds it the
// tick's reading, a destructive caller feeds it a fresh one-row read at the act (D-1144: the extra listing is paid by
// `readSessionRecord`, which names a listed-but-unassembled row `unmeasurable` itself since D-1145). Only the function
// is shared, never the reading. It imports L0 alone.
//
// THE LIVENESS TRUTH TABLE lives in `test/session-reading-truth-table.test.ts`: one row per input, the same rows driven
// through this function, through `measureClaimant` and against `ccd-tmp-sweep`'s box-side predicate, which stays (it
// runs without the server) and whose protected set the table holds equal to `alive` and `asleep`.
//
// DOUBT IS NEVER DEAD. Only a proven absence (`absent`) and a lifecycle `lifecycleIsDead` names are `dead`; a listed
// row that could not be assembled, an unlistable registry, an id that is not a registry id and a tmux that did not
// answer are `unknown`. A hibernated session whose pane is gone is `asleep`, not dead (D-5242). A lifecycle that reads
// `unmeasurable` with the pane gone is answered `alive`, on purpose and as the destructive ladder always has (D-1140):
// the word is a doubt, and the caller that acts on `dead` must be refused.
import { lifecycleIsDead, type SessionLifecycle } from '../../shared/api.js';

/** What the registry said about the one id: `SingleRead`'s kinds, with `found` spelled `present`. */
export type RowFact = 'present' | 'absent' | 'unmeasurable' | 'unlistable' | 'bad-id';
/** tmux's verdict on the pane, or `null` when it was not asked (a row that is not present is never taken to tmux). */
export type PaneFact = 'live' | 'gone' | 'unknown' | null;
/** The status word, from the status file first and the pane second; `null` when nothing measured it. */
export type TurnFact = 'busy' | 'idle' | 'shell' | null;

export interface SessionFacts {
  readonly row: RowFact;
  readonly pane: PaneFact;
  /** The registry row's lifecycle; read only when the row is present and the pane is gone. */
  readonly lifecycle: SessionLifecycle | null;
  /** The row carries `.hibernated`. */
  readonly hibernated: boolean;
  readonly turn: TurnFact;
}

export type Presence = 'alive' | 'asleep' | 'dead' | 'unknown';
export type Turn = 'busy' | 'idle' | 'shell' | 'unknown';
/** Which death: the registry never listed the id, or one of the lifecycle words `lifecycleIsDead` names. */
export type DeadCause = 'absent' | Extract<SessionLifecycle, 'stopped' | 'orphan' | 'never-started'>;

/** Why the presence is what it is, one word per arm of the ladder (a caller words its own sentence from it). */
export type PresenceWhy =
  | 'rowAbsent' | 'rowUnassembled' | 'rowUnlistable' | 'badId'
  | 'paneLive' | 'paneUnknown' | 'hibernated' | 'lifecycleDead' | 'lifecycleAlive' | 'lifecycleDoubt';

export interface SessionReading {
  readonly presence: Presence;
  readonly why: PresenceWhy;
  /** Set exactly when `presence` is `dead`. */
  readonly deadCause: DeadCause | null;
  readonly turn: Turn;
}

const reading = (presence: Presence, why: PresenceWhy, turn: TurnFact, deadCause: DeadCause | null = null): SessionReading =>
  ({ presence, why, deadCause, turn: turn ?? 'unknown' });

export function readSession(f: SessionFacts): SessionReading {
  switch (f.row) {
    case 'absent': return reading('dead', 'rowAbsent', null, 'absent');
    case 'unmeasurable': return reading('unknown', 'rowUnassembled', null);
    case 'unlistable': return reading('unknown', 'rowUnlistable', null);
    case 'bad-id': return reading('unknown', 'badId', null);
    case 'present': break;
    default: {
      const _x: never = f.row;
      return _x;
    }
  }
  if (f.pane === 'live') return reading('alive', 'paneLive', f.turn);
  // `null` on a present row is a caller that never asked tmux: nothing measured the pane.
  if (f.pane === 'unknown' || f.pane === null) return reading('unknown', 'paneUnknown', null);
  const lc = f.lifecycle;
  if (lc === 'stopped' && f.hibernated) return reading('asleep', 'hibernated', null);
  if (lc === null || lc === 'unmeasurable') return reading('alive', 'lifecycleDoubt', null);
  if (lifecycleIsDead(lc)) return reading('dead', 'lifecycleDead', null, lc as DeadCause);
  return reading('alive', 'lifecycleAlive', null);
}
