// "Is it alive" and "is it idle", read once (consolidation spec K3 and K4; ARCH-47, #782). L1, pure: no clock, no I/O.
//
// `readSession` is the one function over FACTS; who supplies the facts is the caller's. A display surface feeds it the
// tick's reading, a destructive caller feeds it a fresh one-row read at the act (D-1144: the extra listing is paid by
// `readSessionRecord`, which names a listed-but-unassembled row `unmeasurable` itself since D-1145). Only the function
// is shared, never the reading. It imports L0 alone.
//
// THE LIVENESS TRUTH TABLE lives in `test/session-reading-truth-table.test.ts`: one row per input, the same rows driven
// through this function, through `measureClaimant` and through the real `ccd-tmp-sweep` on fixture HOMEs. The sweep's box-side predicate stays
// (it runs without the server); the table records, row by row, whether it protects the session's temp directory, and
// names the rows where that differs from `presence` (it protects any row with a `.hibernated` file, whatever its
// lifecycle, and it knows no heartbeat or tmux). The other readers of
// the old ladders (`liveStatus`, the fleet frame, `liveRowFor`, `resolve`, `claimProbe`, the dead-coordinator
// predicate) are pinned on the same rows in `test/session-ladders-characterization.test.ts`.
//
// THE SHAPE IS THE SPEC'S (consolidation spec C1, SessionReading): five parts, not one word. `substrate` is whether the
// session's process is there (`present | absent | unmeasurable`), `lifecycle` is the `sessionLifecycle` word, `turn` is
// `busy | idle | shell | unknown` with the `why` of an unknown, `sleep` is `awake | asleep since T`, and `viewer` is
// `none | open | visible`, or `not-fed` while no caller supplies one (the viewer registry is a different fact under the
// same word, renamed by its own ticket; nothing feeds it yet). `presence` stays, but as a DERIVED word over the parts
// (the wire's `alive | asleep | dead | unknown`): it is computed in one place below and holds no fact of its own.
//
// DOUBT IS NEVER DEAD. Only a proven absence (`absent`) and a lifecycle `lifecycleIsDead` names are `dead`; a listed
// row that could not be assembled, an unlistable registry, an id that is not a registry id and a tmux that did not
// answer are `unknown`. A hibernated session whose pane is gone is `asleep`, not dead (D-5242). A lifecycle that reads
// `unmeasurable` with the pane gone is `unknown` too, `why: 'lifecycleDoubt'`. The destructive door answers that one
// doubt `alive` (D-1140, in `measureClaimant`'s switch on `why`): fail-shut is that caller's policy, not the reading's,
// so a display reader of `presence` sees the doubt as a doubt.
import { lifecycleIsDead, type SessionLifecycle } from '../../shared/api.js';

/** What the registry said about the one id: `SingleRead`'s kinds, with `found` spelled `present`. */
export type RowFact = 'present' | 'absent' | 'unmeasurable' | 'unlistable' | 'bad-id';
/** tmux's verdict on the pane, or `null` when it was not asked (a row that is not present is never taken to tmux). */
export type PaneFact = 'live' | 'gone' | 'unknown' | null;
/** The status word, from the status file first and the pane second; `null` when nothing measured it. */
export type TurnFact = 'busy' | 'idle' | 'shell' | null;
/** The viewer registry's word for this session, when a caller has it. */
export type ViewerWord = 'none' | 'open' | 'visible';

export interface SessionFacts {
  readonly row: RowFact;
  readonly pane: PaneFact;
  /** The registry row's lifecycle; read only when the row is present and the pane is gone. */
  readonly lifecycle: SessionLifecycle | null;
  /** When the row's `.hibernated` marker says the session went to sleep (epoch ms); `null` when it carries none. */
  readonly hibernatedAt: number | null;
  readonly turn: TurnFact;
  /** Optional: no caller feeds the viewer yet, and an absent one reads `not-fed`, never `none`. */
  readonly viewer?: ViewerWord;
}

export type Presence = 'alive' | 'asleep' | 'dead' | 'unknown';
export type Turn = 'busy' | 'idle' | 'shell' | 'unknown';
/** Which death: the registry never listed the id, or one of the lifecycle words `lifecycleIsDead` names. */
export type DeadCause = 'absent' | Extract<SessionLifecycle, 'stopped' | 'orphan' | 'never-started'>;

/** Whether the session's process is there. `absent` is a proven absence (no row, or a pane tmux says is gone);
 *  `unmeasurable` is every doubt: an unlistable registry, a bad id, a row that could not be assembled, a tmux that did
 *  not answer or was never asked. */
export type Substrate = 'present' | 'absent' | 'unmeasurable';

/** Why the turn reads `unknown` (or that it was measured): the arm of the ladder that decided it. */
export type TurnWhy = 'measured' | 'unmeasured' | 'noRow' | 'noPane' | 'paneUnknown';
export interface TurnReading { readonly word: Turn; readonly why: TurnWhy }

export type SleepReading =
  | { readonly kind: 'awake' }
  /** `since` is the marker's epoch ms. A marker whose stamp cannot be read parses to `null` upstream and is no marker. */
  | { readonly kind: 'asleep'; readonly since: number };

/** `not-fed` is a declared arm, not a measurement: the caller supplied no viewer fact. */
export type ViewerReading = ViewerWord | 'not-fed';

/** Why the presence is what it is, one word per arm of the ladder (a caller words its own sentence from it). */
export type PresenceWhy =
  | 'rowAbsent' | 'rowUnassembled' | 'rowUnlistable' | 'badId'
  | 'paneLive' | 'paneUnknown' | 'hibernated' | 'lifecycleDead' | 'lifecycleAlive' | 'lifecycleDoubt';

export interface SessionReading {
  readonly substrate: Substrate;
  /** The registry row's lifecycle word; `null` when it was not read (no row, or a pane that is live or unanswered). */
  readonly lifecycle: SessionLifecycle | null;
  readonly turn: TurnReading;
  readonly sleep: SleepReading;
  readonly viewer: ViewerReading;
  /** DERIVED from the parts above by `readSession`'s ladder, never a second fact. */
  readonly presence: Presence;
  readonly why: PresenceWhy;
  /** Set exactly when `presence` is `dead`. */
  readonly deadCause: DeadCause | null;
}

interface Verdict {
  readonly presence: Presence;
  readonly why: PresenceWhy;
  readonly substrate: Substrate;
  readonly deadCause?: DeadCause;
  readonly asleep?: true;
}

/** The ladder: facts to presence, one arm per `PresenceWhy`. */
function presenceOf(f: SessionFacts): Verdict {
  switch (f.row) {
    case 'absent': return { presence: 'dead', why: 'rowAbsent', substrate: 'absent', deadCause: 'absent' };
    case 'unmeasurable': return { presence: 'unknown', why: 'rowUnassembled', substrate: 'unmeasurable' };
    case 'unlistable': return { presence: 'unknown', why: 'rowUnlistable', substrate: 'unmeasurable' };
    case 'bad-id': return { presence: 'unknown', why: 'badId', substrate: 'unmeasurable' };
    case 'present': break;
    default: {
      const _x: never = f.row;
      return _x;
    }
  }
  if (f.pane === 'live') return { presence: 'alive', why: 'paneLive', substrate: 'present' };
  // `null` on a present row is a caller that never asked tmux: nothing measured the pane.
  if (f.pane === 'unknown' || f.pane === null) return { presence: 'unknown', why: 'paneUnknown', substrate: 'unmeasurable' };
  const lc = f.lifecycle;
  if (lc === 'stopped' && f.hibernatedAt !== null) return { presence: 'asleep', why: 'hibernated', substrate: 'absent', asleep: true };
  if (lc === null || lc === 'unmeasurable') return { presence: 'unknown', why: 'lifecycleDoubt', substrate: 'absent' };
  if (lifecycleIsDead(lc)) return { presence: 'dead', why: 'lifecycleDead', substrate: 'absent', deadCause: lc as DeadCause };
  return { presence: 'alive', why: 'lifecycleAlive', substrate: 'absent' };
}

const turnOf = (f: SessionFacts): TurnReading => {
  if (f.row !== 'present') return { word: 'unknown', why: 'noRow' };
  if (f.pane === 'gone') return { word: 'unknown', why: 'noPane' };
  if (f.pane !== 'live') return { word: 'unknown', why: 'paneUnknown' };
  return f.turn === null ? { word: 'unknown', why: 'unmeasured' } : { word: f.turn, why: 'measured' };
};

export function readSession(f: SessionFacts): SessionReading {
  const v = presenceOf(f);
  return {
    substrate: v.substrate,
    lifecycle: f.row === 'present' && f.pane === 'gone' ? f.lifecycle : null,
    turn: turnOf(f),
    sleep: v.asleep === true && f.hibernatedAt !== null ? { kind: 'asleep', since: f.hibernatedAt } : { kind: 'awake' },
    viewer: f.viewer ?? 'not-fed',
    presence: v.presence,
    why: v.why,
    deadCause: v.deadCause ?? null,
  };
}
