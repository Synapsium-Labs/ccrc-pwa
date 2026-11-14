// L1, context C3 (Session Conversation): what a reported start does to a long-lived identity's generations (Overlord spec
// §3.3.11, H12, "every start mints"; §3.3.9's keys), and the wave-boundary fact a coordinator's renewal row reads. Pure: the
// generations lane (`generationsLane.ts`, L4) gathers the facts, asks here, and writes through the store.
//
// A start mints the identity's next generation unless it is not a new life of that identity: a compaction (the same
// conversation, summarised), a fork (another conversation in the same pane, never this identity's next life), a start of a
// row the registry no longer lists, a start whose conversation is not the row's own (a nested process in the pane can land a
// `clear`, `resume` or `compact` as the row's: reviews 1949 G2, 1975 H2), a start older than the live generation's (id order
// is receipt order: review 1949 G3), or a start of a role that is not long-lived or that cannot be told. A start a failed
// registry read skipped is held for a later pass, bounded (`startHeld`, review 2003 F2).
import { TERMINAL_RUN_STATES } from '../../../shared/api.js';
import { RENEWAL_LANE_PERIOD_MS, type GenerationOutcome, type GenerationState, type StartSource } from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { RoleReading } from '../roleOf.js';
import { RENEWAL_ROWS } from './renewalDue.js';

const START_SKIP_MAP = {
  compact: 'a compaction: the same conversation, summarised',
  fork: 'a fork: another conversation in the same pane',
  unregistered: 'the registry does not list the row',
  'uuid-unmeasured': "the registry's uuid for the row could not be read",
  'foreign-uuid': "the started conversation is not the one the registry names for the row",
  late: "older than the live generation's start",
  undecided: 'the role could not be told',
  'not-long-lived': 'the role is not long-lived: its wave is its renewal',
} as const;
export type StartSkip = keyof typeof START_SKIP_MAP;
export const START_SKIPS = Object.keys(START_SKIP_MAP) as StartSkip[];

/** The skips a read that failed this pass gives (review 2003 F2): the start is held, the cursor stays at it and later
 *  passes judge it again, for at most `START_RETRY_MS` after the server received it; past that it is skipped for good. */
const RETRIED_SKIPS: ReadonlySet<StartSkip> = new Set<StartSkip>(['unregistered', 'uuid-unmeasured']);
/** About five passes of the lane: how long a start whose registry read failed is held before it is skipped. */
export const START_RETRY_MS = 5 * RENEWAL_LANE_PERIOD_MS;

/** Is a start that answered `skip` held for a later pass? Only for a retried skip, and only while the server's clock reads
 *  it as received less than `START_RETRY_MS` ago; a clock that reads it as received in the future holds it no longer. */
export function startHeld(skip: StartSkip, receivedAt: number, now: number): boolean {
  return RETRIED_SKIPS.has(skip) && now >= receivedAt && now - receivedAt < START_RETRY_MS;
}

/** A long-lived role is one `renewalDue` has rows for (Table 3.3.11b): every other role's wave is its renewal. */
export function longLived(role: FleetRole): boolean {
  return RENEWAL_ROWS[role].length > 0;
}

/** What the lane read about one start. */
export interface StartFacts {
  readonly source: StartSource;
  /** The started conversation's uuid (`continuity_starts.uuid`). */
  readonly uuid: string;
  /** The hook's clock: a session's start order. */
  readonly reportedAt: number;
  /** The registry row's incarnation the start carried, or null. */
  readonly rowIncarnation: string | null;
  /** The registry, at the pass: the row's current conversation (null: unreadable) and its account, or absent. */
  readonly registry: { readonly kind: 'row'; readonly uuid: string | null; readonly lane: string | null } | { readonly kind: 'absent' };
  readonly role: RoleReading;
  /** Whether this is the identity's newest start the pass judges (review 2003 F4): the registry is read at the pass, not
   *  at the start, so its account describes only the newest start. An older one's outcome is `unmeasured` and it records
   *  no account. */
  readonly newest: boolean;
  /** The identity's live generation: its `state` column (what the session lived; a shadow walk's would-be state is not
   *  what happened to it, review 2003 F1), its start's `reportedAt`, its incarnation and its account. */
  readonly live: {
    readonly state: GenerationState; readonly reportedAt: number;
    readonly rowIncarnation: string | null; readonly lane: string | null;
  } | null;
}

export type StartVerdict =
  | { readonly mint: false; readonly skip: StartSkip }
  | {
    readonly mint: true; readonly role: FleetRole; readonly outcome: GenerationOutcome; readonly resumed: boolean;
    /** The account the new generation records: the registry's, for the newest start only. */
    readonly lane: string | null;
  };

const skip = (s: StartSkip): StartVerdict => ({ mint: false, skip: s });

/** The skips decided by the start and the registry alone, before the live generation or the role is asked: by source,
 *  then the row, then (for every source but `startup`) its conversation. The lane asks this first to find a start a
 *  failed read holds (`startHeld`); `startVerdict` asks it first too, so the two never disagree. */
export function startReadSkip(f: Pick<StartFacts, 'source' | 'uuid' | 'registry'>): StartSkip | null {
  if (f.source === 'compact') return 'compact';
  if (f.source === 'fork') return 'fork';
  if (f.registry.kind === 'absent') return 'unregistered';
  if (f.source !== 'startup') {
    if (f.registry.uuid === null) return 'uuid-unmeasured';
    if (f.registry.uuid !== f.uuid) return 'foreign-uuid';
  }
  return null;
}

/** Does this start mint the identity's next generation, and with what outcome for the one it ends? A `startup` is
 *  attributed by the door against the registry at its send and keeps its own sender (review 1949 G2), so it is not
 *  checked against the registry's current conversation, which a later `/clear` may have moved on; every other source is
 *  the row's own only when the registry names its conversation now (slug uuid-checked-against-the-current-row). */
export function startVerdict(f: StartFacts): StartVerdict {
  const read = startReadSkip(f);
  if (read !== null) return skip(read);
  if (f.live !== null && f.reportedAt < f.live.reportedAt) return skip('late');
  if (f.role.kind === 'undecided') return skip('undecided');
  if (!longLived(f.role.role)) return skip('not-long-lived');
  const lane = f.newest && f.registry.kind === 'row' ? f.registry.lane : null;
  return { mint: true, role: f.role.role, outcome: f.newest ? startOutcome(f) : 'unmeasured', resumed: f.source === 'resume', lane };
}

/** The outcome written on the generation a start ends (slug outcome-from-the-start): `renewed` for the start a renewal
 *  asked for (the generation was `clearing`); otherwise `unmeasured` when either account is not known (a swap cannot be
 *  ruled out, review 2003 F4), `swapped` when the account changed, `crashed` when the generation was `active` on the same
 *  row incarnation, and `woken` for the rest. With no live generation nothing is ended, and the answer is not written. */
export function startOutcome(f: Pick<StartFacts, 'registry' | 'live' | 'rowIncarnation'>): GenerationOutcome {
  const old = f.live;
  if (old === null) return 'woken';
  if (old.state === 'clearing') return 'renewed';
  const lane = f.registry.kind === 'row' ? f.registry.lane : null;
  if (lane === null || old.lane === null) return 'unmeasured';
  if (lane !== old.lane) return 'swapped';
  if (old.state === 'active' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) return 'crashed';
  return 'woken';
}

/** Is a generation judged for due, and gathered for? When its `state` column is `active` or `degraded`, whatever a shadow
 *  walk holds in `shadowState` (review 2003 F1): the due record does not depend on the walk. A generation on a live walk
 *  (`state` past `active`) is not judged. */
export function judgedForDue(g: { readonly state: GenerationState }): boolean {
  return g.state === 'active' || g.state === 'degraded';
}

/** Table 3.3.11b's wave boundary: the coordinator's newest work run is open and the one before it, of the same programme,
 *  is closed. `runs` is newest first, as `newestClaimedWorkRuns` reads them. */
export function waveBoundaryOf(runs: readonly { readonly state: string; readonly program: string }[]): boolean {
  const closed = (s: string): boolean => (TERMINAL_RUN_STATES as readonly string[]).includes(s);
  const [newest, before] = runs;
  return newest !== undefined && before !== undefined && newest.program === before.program
    && !closed(newest.state) && closed(before.state);
}
