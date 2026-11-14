// L1, context C3 (Session Conversation): what a reported start does to a long-lived identity's generations (Overlord spec
// §3.3.11, H12, "every start mints"; §3.3.9's keys), and the wave-boundary fact a coordinator's renewal row reads. Pure: the
// generations lane (`generationsLane.ts`, L4) gathers the facts, asks here, and writes through the store.
//
// A start mints the identity's next generation unless it is not a new life of that identity: a compaction (the same
// conversation, summarised), a fork (another conversation in the same pane, never this identity's next life), a start of a
// row the registry no longer lists, a start whose conversation is not the row's own (a nested process in the pane can land a
// `clear`, `resume` or `compact` as the row's: reviews 1949 G2, 1975 H2), a start older than the live generation's (id order
// is receipt order: review 1949 G3), or a start of a role that is not long-lived or that cannot be told.
import { TERMINAL_RUN_STATES } from '../../../shared/api.js';
import type { GenerationOutcome, GenerationState, StartSource } from '../../../shared/continuity.js';
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
  /** The identity's live generation: its effective state, its start's `reportedAt`, its incarnation and its account. */
  readonly live: {
    readonly state: GenerationState; readonly reportedAt: number;
    readonly rowIncarnation: string | null; readonly lane: string | null;
  } | null;
}

export type StartVerdict =
  | { readonly mint: false; readonly skip: StartSkip }
  | { readonly mint: true; readonly role: FleetRole; readonly outcome: GenerationOutcome; readonly resumed: boolean };

const skip = (s: StartSkip): StartVerdict => ({ mint: false, skip: s });

/** Does this start mint the identity's next generation, and with what outcome for the one it ends? A `startup` is
 *  attributed by the door against the registry at its send and keeps its own sender (review 1949 G2), so it is not
 *  checked against the registry's current conversation, which a later `/clear` may have moved on; every other source is
 *  the row's own only when the registry names its conversation now (slug uuid-checked-against-the-current-row). */
export function startVerdict(f: StartFacts): StartVerdict {
  if (f.source === 'compact') return skip('compact');
  if (f.source === 'fork') return skip('fork');
  if (f.registry.kind === 'absent') return skip('unregistered');
  if (f.source !== 'startup') {
    if (f.registry.uuid === null) return skip('uuid-unmeasured');
    if (f.registry.uuid !== f.uuid) return skip('foreign-uuid');
  }
  if (f.live !== null && f.reportedAt < f.live.reportedAt) return skip('late');
  if (f.role.kind === 'undecided') return skip('undecided');
  if (!longLived(f.role.role)) return skip('not-long-lived');
  return { mint: true, role: f.role.role, outcome: startOutcome(f), resumed: f.source === 'resume' };
}

/** The outcome written on the generation a start ends (slug outcome-from-the-start): `renewed` for the start a renewal
 *  asked for (the generation was `clearing`); otherwise `swapped` when the account changed, `crashed` when the generation
 *  was `active` on the same row incarnation, and `woken` for the rest. With no live generation nothing is ended, and the
 *  answer is not written. */
export function startOutcome(f: Pick<StartFacts, 'registry' | 'live' | 'rowIncarnation'>): GenerationOutcome {
  const old = f.live;
  if (old === null) return 'woken';
  if (old.state === 'clearing') return 'renewed';
  const lane = f.registry.kind === 'row' ? f.registry.lane : null;
  if (lane !== null && old.lane !== null && lane !== old.lane) return 'swapped';
  if (old.state === 'active' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) return 'crashed';
  return 'woken';
}

/** Table 3.3.11b's wave boundary: the coordinator's newest work run is open and the one before it, of the same programme,
 *  is closed. `runs` is newest first, as `newestClaimedWorkRuns` reads them. */
export function waveBoundaryOf(runs: readonly { readonly state: string; readonly program: string }[]): boolean {
  const closed = (s: string): boolean => (TERMINAL_RUN_STATES as readonly string[]).includes(s);
  const [newest, before] = runs;
  return newest !== undefined && before !== undefined && newest.program === before.program
    && !closed(newest.state) && closed(before.state);
}
