// The mail lane's choice of line and resume rule for one due delivery (Overlord W1 private store, Task 5; review 2550 N1). Ring L4,
// context C11: it decides nothing itself. `FleetWatcher.mailPass` asks it once per delivery it is about to type, instead of holding the
// operator-message branch inline; the line and the id come from `mailNudgeOf` and the rule from `resumeRuleOf` (both L1, in
// `coord/envelope.ts`), and the one read it makes is the box, and only for a fixed line of the table, whose resume rule needs it.
import { mailNudgeOf, resumeRuleOf, type MailNudge, type SweepDesignation } from '../coord/envelope.js';

/** What `mailPass` needs of one delivery's nudge: the line (the parked-box probe compares against it), the operator message it
 *  names or null, what its first delivery moves besides the ack (`firstDelivery`, set for a fixed line that moves nothing else) and
 *  the resume rule to spread into `sendPrompt`'s options. */
export interface OperatorNudge extends MailNudge {
  readonly rule: ReturnType<typeof resumeRuleOf>;
}

/** `readBox` is `readBoxText` bound to the lane's tmux and queue; an unreadable box (`null`, or a read that throws) is `null` to the
 *  rule. A generic mail reads no box at all; every fixed line of the table reads it, for its resume rule. `designated` is the
 *  sweep's one designation read and `now` the clock at typing (the wake's time left). */
export async function operatorNudgeFor(
  readBox: (sessionId: string) => Promise<string | null>, toId: string,
  origin: { readonly fromId: string; readonly subject: string; readonly body?: string } | null,
  designated: SweepDesignation, now: number,
): Promise<OperatorNudge> {
  const nudge = mailNudgeOf(toId, origin, designated, now);
  const fixed = nudge.operatorMessageId !== null || nudge.firstDelivery !== undefined;
  const box = fixed ? await readBox(toId).catch(() => null) : null;
  return { ...nudge, rule: resumeRuleOf(nudge, box) };
}
