// D-8126 (autonomy plan Task A9-3, spec §9.3; review focus F14): L1. Which running coordinators are owed the one
// rollout mail for a coordinator-skill revision, and its words. Pure: no store, no clock, no I/O. The lane
// (`skillRolloutLane.ts`, L4) reads the claimants, each one's registry row and whether it was told, and acts on the
// answer: it queues the mail and records the feed row this file keys.
//
// THE RULE, ONCE PER CLAIMANT PER REVISION: a claimant of an open run that is not a child and was not told is mailed. A
// child (its `.child` marker, read by the registry) is a worker and never mailed. While `mail-disabled` stands, or cannot
// be read, nothing is mailed and the pass is not settled, so the lane asks again on its next beat. A claimant whose row
// cannot be read, or whose id the listing refused, is held the same way: never told on a guess. A claimant with no row is
// settled without a mail: there is no session to tell, and one revived later starts on the new cards (A9-1, A9-2).
import type { MarkerState } from '../../../shared/api.js';

/** The revision of the coordinator skill's contract this build carries: clause 21 of `ccd/coordinator-skill/SKILL.md`
 *  (A5). A later contract change bumps this word, and every running coordinator is told once more. */
export const COORDINATOR_SKILL_REVISION = 'clause-21';

/** One mail owed: the recipient, the once-only feed key, the subject (the durable reader's key too) and the body. */
export interface RolloutMail {
  readonly toId: string;
  readonly key: string;
  readonly subject: string;
  readonly body: string;
}

/** What the lane read for one claimant: its registry row's `.child` reading (`unlisted`: no row; `refused`: the listing
 *  refused its id), and whether a rollout mail or its feed row for this revision already exists. */
export interface RolloutClaimant {
  readonly id: string;
  readonly child: 'none' | 'child' | 'unreadable' | 'unlisted' | 'refused';
  readonly told: boolean;
}

export interface RolloutFacts {
  readonly revision: string;
  /** `$REG/mail-disabled` on this beat's listing (`readSwitches`): only `clear` lets a mail go. */
  readonly mailDisabled: MarkerState;
  readonly claimants: readonly RolloutClaimant[];
}

/** Why a pass is not settled: the mail switch, or a claimant that could not be measured. */
export type RolloutHold = { readonly why: 'mail-disabled' } | { readonly why: 'unmeasured'; readonly id: string };

export interface RolloutPlan {
  readonly mails: readonly RolloutMail[];
  readonly holds: readonly RolloutHold[];
  /** No hold: once the mails are queued, this revision is done for this process. */
  readonly settled: boolean;
}

/** The once-only feed key (`CoordStore.hasNotice`, D-5860): one per revision per session. */
export const rolloutKey = (revision: string, sessionId: string): string => `skill-rollout:${revision}:${sessionId}`;

/** The revision as a person reads it: `clause-21` is "clause 21". */
const revisionWords = (revision: string): string => revision.replace(/-/g, ' ');

export const rolloutMailSubject = (revision: string): string => `coordinator skill changed (${revisionWords(revision)})`;

export const rolloutMailBody = (revision: string): string =>
  `The coordinator skill changed (${revisionWords(revision)}). Re-read \`ccrc-coordinator\`, then \`goals show\` for your programme.`;

/** The pass's decision: each distinct claimant once, in the order given. */
export function decideRollout(f: RolloutFacts): RolloutPlan {
  if (f.mailDisabled !== 'clear') return { mails: [], holds: [{ why: 'mail-disabled' }], settled: false };
  const mails: RolloutMail[] = [];
  const holds: RolloutHold[] = [];
  const seen = new Set<string>();
  for (const c of f.claimants) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.told || c.child === 'child' || c.child === 'unlisted') continue;
    if (c.child !== 'none') { holds.push({ why: 'unmeasured', id: c.id }); continue; }
    mails.push({ toId: c.id, key: rolloutKey(f.revision, c.id), subject: rolloutMailSubject(f.revision), body: rolloutMailBody(f.revision) });
  }
  return { mails, holds, settled: holds.length === 0 };
}
