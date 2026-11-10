// D-8126 (autonomy plan Task A9-3, spec §9.3): L1. Which running coordinators are owed the one rollout mail for a skill
// revision, and its words. Pure: no store, no clock, no I/O. `skillRolloutLane.ts` (L4) reads the claimants, asks the feed
// whether each was told, queues the mail and writes the feed row this file keys.

/** One mail owed: the recipient, the once-only feed key, the subject (also the mail queue's own dedupe key) and the body. */
export interface RolloutMail {
  readonly toId: string;
  readonly key: string;
  readonly subject: string;
  readonly body: string;
}

/** The once-only key (`CoordStore.hasNotice`, D-5860): one per revision per session. */
export const rolloutKey = (revision: string, sessionId: string): string => `skill-rollout:${revision}:${sessionId}`;

/** The revision as a person reads it: `clause-21` is "clause 21". */
const revisionWords = (revision: string): string => revision.replace(/-/g, ' ');

export const rolloutMailSubject = (revision: string): string => `coordinator skill changed (${revisionWords(revision)})`;

export const rolloutMailBody = (revision: string): string =>
  `The coordinator skill changed (${revisionWords(revision)}). Re-read \`ccrc-coordinator\`, then \`goals show\` for your programme.`;

/**
 * The mails due: each distinct claimant, in the order given, that `sent` does not already answer for. The caller passes
 * claimants only (a child is not one, decided where the bindings are read); this decides the once-per-revision rule.
 */
export function rolloutMailsDue(
  claimants: readonly string[], sent: (sessionId: string) => boolean, revision: string,
): RolloutMail[] {
  const out: RolloutMail[] = [];
  const seen = new Set<string>();
  for (const toId of claimants) {
    if (seen.has(toId)) continue;
    seen.add(toId);
    if (sent(toId)) continue;
    out.push({ toId, key: rolloutKey(revision, toId), subject: rolloutMailSubject(revision), body: rolloutMailBody(revision) });
  }
  return out;
}
