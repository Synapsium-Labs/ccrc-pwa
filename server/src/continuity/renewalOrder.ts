// L1, context C3 (Session Conversation): `overlordFirst`, the order in which long-lived sessions renew (Overlord spec
// §3.3.11, C50; W1a renewal act Task 4). Pure.
//
// The Overlord renews first: no coordinator's renewal starts, a hard one included, while the Overlord's live generation is
// outside `active` or cannot be read (the coordinator's ruling F11 on review 1894, slug overlord-renews-first-hard-included).
// This module owns that ordering for hard and soft renewals alike: the lane asks it before it feeds a coordinator's `due`,
// and `softRenewalMay`'s `overlordOutsideActive` input is fed from it, so the two never disagree. In W1a there is no
// Overlord generation (the Overlord arrives in W1), so the answer is `true` for every coordinator until one is minted.
import type { GenerationState } from '../../../shared/continuity.js';

/** The Overlord's live generation as the lane read it: its effective state, `none` when no Overlord generation is live,
 *  or `unmeasured` when the generations could not be read. */
export type OverlordGenerationReading = GenerationState | 'none' | 'unmeasured';

/** May a coordinator's renewal start? True when the Overlord's live generation is `active`, or no Overlord generation is
 *  live; false while it renews (any other state) or cannot be read. */
export function overlordFirst(overlord: OverlordGenerationReading): boolean {
  return overlord === 'none' || overlord === 'active';
}
