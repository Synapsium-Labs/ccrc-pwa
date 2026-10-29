/**
 * THE ROLL TARGET (D-7443, the operator's rule of 2026-10-29): L1, pure.
 *
 * "Always auto-roll all coordinators when they go idle, but never auto-roll any non-coordinators." Many idle children
 * will never do real work again, and a useful one may be working constantly, so rolling a child is either waste or
 * disruption. A coordinator should follow the new rules (a new release, a new binary, new skill text) as soon as it is
 * idle. A session this skips is not held from anything else: it picks up the new build the next time it starts for
 * another reason (a wake, a swap, an operator's ensure).
 *
 * This is the ONE predicate every AUTOMATIC roll picker calls, before it spends a slot (the binary-lifecycle W5
 * scheduler's candidate step). The role comes from `FleetSession.role`, which is `sessionRoleOf` (`shared/api.ts`),
 * the fleet's one derivation: no `.child` marker is a `coordinator`, so an operator-made session is one (D-5301).
 * `idle` is the existing roll verdict's answer (its quiet window and holds); this module never measures idleness.
 * A MANUAL roll never calls this: the operator chose the session.
 */
import type { SessionRole } from '../../../shared/api.js';
import type { ClaudeRollTargets } from '../../../shared/claudeVersion.js';

/** Why the picker passed a session over, in the order they are tested. Each is a name the shadow log prints. */
const ROLL_TARGET_SKIP_MAP = { 'role-unknown': true, 'not-coordinator': true, busy: true } as const;
export type RollTargetSkip = keyof typeof ROLL_TARGET_SKIP_MAP;
export const ROLL_TARGET_SKIPS: readonly RollTargetSkip[] = Object.keys(ROLL_TARGET_SKIP_MAP) as RollTargetSkip[];

export interface RollTargetInput {
  /** `FleetSession.role`; null when the row did not say (an older build's snapshot). */
  readonly role: SessionRole | null;
  /** The roll verdict found the session idle past its quiet window, with no hold. */
  readonly idle: boolean;
}

export type RollTargetVerdict = { readonly take: true } | { readonly take: false; readonly skip: RollTargetSkip };

/** May an automatic roll take this session? The role is tested before idleness, so a child is journalled as
 *  `not-coordinator` whether or not it is busy, and an unknown role is never taken under any setting. */
export function rollTargetVerdict(targets: ClaudeRollTargets, i: RollTargetInput): RollTargetVerdict {
  if (i.role === null) return { take: false, skip: 'role-unknown' };
  if (targets === 'coordinators' && i.role !== 'coordinator') return { take: false, skip: 'not-coordinator' };
  if (!i.idle) return { take: false, skip: 'busy' };
  return { take: true };
}
