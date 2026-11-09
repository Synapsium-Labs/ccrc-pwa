/**
 * ONE MAIL-PACE TABLE, KEYED BY ROLE (Overlord spec §6.4, C24 and H19).
 *
 * L1, pure, C5 (the `coord/**` row of the ring-context map): this file declares
 * values and imports nothing. The mail lane is Coordination's, and C3's
 * `turnidle.ts` keeps taking the threshold as an argument.
 *
 * The key is `MailPaceRole` until the role table (`FLEET_ROLES`) exists. Both of
 * today's keys are members of that vocabulary, so the later change only adds
 * rows: `MAIL_PACE` becomes `satisfies Readonly<Record<FleetRole, MailPace>>`
 * (a role with no row is then a compile error) and `mailPaceRoleOf` gives way to
 * `roleOf`. The Overlord's row arrives with the role table (spec §3.3.9, C49);
 * until then the Overlord reads the worker row, the row every session that is
 * not the claimant of an open run reads today.
 */

/** One role's mail pace. Both are measured by the mail lane (`watch.ts`, `mailPass`). */
export interface MailPace {
  /** How long the session's main loop must have read idle before a nudge (`mailTurnIdle`'s `quietMs`). */
  readonly quietMs: number;
  /** No second nudge into one session inside this, from its last landed nudge. */
  readonly cooldownMs: number;
}

export const MAIL_PACE = {
  /** The row every session that is not the claimant of an open run reads:
   *  workers, reviewers and plain sessions alike.
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
} as const satisfies Readonly<Record<string, MailPace>>;

export type MailPaceRole = keyof typeof MAIL_PACE;

/** THE one choice of a session's pace row until `roleOf` exists: the claimant of an open run is a coordinator. */
export function mailPaceRoleOf(sessionId: string, openCoordinators: ReadonlySet<string>): MailPaceRole {
  return openCoordinators.has(sessionId) ? 'coordinator' : 'worker';
}
