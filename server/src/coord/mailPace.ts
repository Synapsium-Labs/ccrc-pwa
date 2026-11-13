import type { FleetRole } from '../../../shared/fleetRoles.js';
import { ROLE_AMBIGUITIES, type RoleReading } from '../roleOf.js';

/**
 * ONE MAIL-PACE TABLE, KEYED BY ROLE (Overlord spec §6.4, C24 and H19; §3.3.9, C49).
 *
 * L1, pure, C5 (the `coord/**` row of the ring-context map): this file declares values and decides, with no I/O. Its
 * imports are types from L0 and `ROLE_AMBIGUITIES` from `../roleOf.js` (L1, which imports only L0). The mail lane is
 * Coordination's, and C3's `turnidle.ts` keeps taking the threshold as an argument.
 *
 * The key is `FleetRole` (`shared/fleetRoles.ts`), and the table `satisfies Readonly<Record<FleetRole, MailPace>>`,
 * so a role with no row is a compile error and a stray row is one too (spec §3.3.9: "Each is total over the roles").
 * The mail lane picks a session's row through the fleet's one role reader, `mailPaceOf(roleOf(facts))`: `roleOf`
 * decides the role and `mailPaceOf` the row, both in L1.
 *
 * The lane measures two facts, the recipient's `.child` mark and whether it claims an open run, and passes every other
 * as `roleOf.ts`'s `ROLE_FACTS_CHILD_AXIS` spells "not read on this path". It assembles no facts of its own: the one
 * assembly of `RoleFacts` belongs to `roleFactsOf` (the renewal deciders' piece), and the lane can move onto it with the
 * same two inputs once it lands. Declared coordinator intent stays `unmeasured`: reading it would move a session with
 * intent and no open run onto the coordinator row, which spec §6.4 rules a change of behaviour for a commit of its own.
 * A non-claimant therefore reads undecided between coordinator and plain, and takes `plain`'s row, the worker pair.
 * The designation has no reader before W1, so no live session reads the Overlord's row until then, and no audit or
 * replay lane exists before §9.5, so none reads theirs either.
 */

/** One role's mail pace. Both are measured by the mail lane (`watch.ts`, `mailPass`). */
export interface MailPace {
  /** How long the session's main loop must have read idle before a nudge (`mailTurnIdle`'s `quietMs`). */
  readonly quietMs: number;
  /** No second nudge into one session inside this, from its last landed nudge. */
  readonly cooldownMs: number;
}

/** Rows in `FLEET_ROLES`' order (Table 3.3.9a). Each row is its own literal, never a reference to another row, so a
 *  measure can move one role's pace without moving another's. */
export const MAIL_PACE = {
  /** THE OVERLORD'S OWN ROW (spec §6.4, C24 and H19). It claims no run, so before this row it read the worker pair, and
   *  W0-20 measured what that costs: each mail waited p50 90.3 s from send to nudge, against at most 3.4 s from the
   *  nudge to its first tool call (`docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md`). The gate was the
   *  whole of its latency, and the second hold of any two-minute burst would lapse however short its turns were.
   *
   *  It starts at 15 s of quiet and 30 s between nudges, the spec's starting point, because the Overlord, like a
   *  coordinator, ends its turn and waits. W0-20 bears the pair out: its turns ran p50 6.3 s and at most 20.1 s from the
   *  nudge to a delivered reply, all inside the 30 s cooldown, so the cooldown spaces mail without cutting into the
   *  turn that answers it; and a quiet time under the lane's own 10 s sweep (`MAIL_SWEEP_MS`) would buy nothing. The
   *  hold lapse measure (M3) moves it; if lapses stay above 10% a week, the plan adds an Overlord-only delivery mode,
   *  never a longer window. Read by no live session until W1's designation reader passes `designation`. */
  overlord: { quietMs: 15_000, cooldownMs: 30_000 },

  /** An audit body (§9.5). No audit lane exists before its wave, so no session reads this row; it takes the worker
   *  pair, a short-lived body mid-task, until that lane measures otherwise. */
  auditor: { quietMs: 60_000, cooldownMs: 120_000 },

  /** A replay body (§9.5). No replay lane exists before its wave, so no session reads this row; it takes the worker
   *  pair, for the auditor row's reason, until that lane measures otherwise. */
  replay: { quietMs: 60_000, cooldownMs: 120_000 },

  /** A dispatched child on a work run, and the row every session reads whose role is undecided between worker and
   *  reviewer.
   *
   *  The quiet time is ccd's own `COMPACT_QUIET` (`ccd/ccd`'s constant), taken
   *  rather than re-derived: this is the same judgement about the same panes,
   *  and two numbers for one policy is two numbers to get out of step. Measured
   *  from `statusUpdatedAt`, which Claude Code rewrites only when the live word
   *  changes: under `idle` or `shell` the main loop has been idle at least that
   *  long (the worker stall watch design's §3.1), which is all this quiet
   *  needs. `mailTurnIdle` (`turnidle.ts`) applies it.
   *
   *  The pair is sized for a worker mid-thought: a minute of measured idle
   *  before the lane may interrupt, and no second injection inside two. A
   *  fan-out of six findings arriving as six prompts in ninety seconds is a
   *  denial of service dressed as coordination, and the cooldown is what
   *  refuses it: no session gets two injections inside that window, however
   *  much mail is queued for it. */
  worker: { quietMs: 60_000, cooldownMs: 120_000 },

  /** A dispatched child on a review run. Mid-read like a worker mid-thought, so the worker pair, for the worker
   *  row's reason. */
  reviewer: { quietMs: 60_000, cooldownMs: 120_000 },

  /** The same two questions the worker row asks, asked of a COORDINATOR: a
   *  session whose id is the `claimedBy` of a non-terminal run.
   *
   *  A coordinator at a wave boundary is not mid-anything. Its own contract
   *  (clause 7, `ccd/coordinator-skill/SKILL.md`) MANDATES that it end its turn
   *  and wait, so the state the worker floor exists to protect is the state the
   *  coordinator is required to be in, and the floor becomes a delay with
   *  nothing behind it, on the one session every other session in a program is
   *  waiting for.
   *
   *  Fifteen seconds is still an idle floor and not the absence of one: it is
   *  read off the same `statusUpdatedAt` and answers the same question, so a
   *  coordinator genuinely mid-turn is still not interrupted. Thirty seconds
   *  keeps the worker row's own promise, no fan-out arriving as a burst of
   *  prompts, at a boundary where two messages are a handoff rather than a
   *  denial of service. */
  coordinator: { quietMs: 15_000, cooldownMs: 30_000 },

  /** A session that neither is a child nor coordinates (`roleOf` reads it from both facts measured `no`), and the row
   *  every session reads whose role is undecided between coordinator and plain: the slower member. Plain sessions
   *  and every non-claimant read the worker pair before this table, and still do, for the worker row's reason. */
  plain: { quietMs: 60_000, cooldownMs: 120_000 },
} as const satisfies Readonly<Record<FleetRole, MailPace>>;

const slower = (a: MailPace, b: MailPace): MailPace =>
  b.quietMs > a.quietMs || (b.quietMs === a.quietMs && b.cooldownMs > a.cooldownMs) ? b : a;

/** A reading's row. A decided role reads its own; an undecided one takes the slowest of its members' rows, the member
 *  that does less (spec §3.3.9: "it takes the slower mail pace"). `mail-pace.test.ts` pins that every ambiguity has a
 *  member slowest on both fields, so the choice never trades one field against the other. */
export function mailPaceOf(reading: RoleReading): MailPace {
  if (reading.kind === 'role') return MAIL_PACE[reading.role];
  return ROLE_AMBIGUITIES[reading.between].map((role): MailPace => MAIL_PACE[role]).reduce(slower);
}
