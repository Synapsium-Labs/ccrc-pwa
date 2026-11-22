// The mail lane's choice of line and resume rule for one due delivery (Overlord W1 private store, Task 5; review 2550 N1). Ring L4,
// context C11: it decides nothing itself. `FleetWatcher.mailPass` asks it once per delivery it is about to type, instead of holding the
// operator-message branch inline; the line and the id come from `mailNudgeOf` and the rule from `resumeRuleOf` (both L1, in
// `coord/envelope.ts`), and the one read it makes is the box, and only for an operator message's line, whose resume rule needs it.
import { mailNudgeOf, resumeRuleOf } from '../coord/envelope.js';

/** What `mailPass` needs of one delivery's nudge: the line (the parked-box probe compares against it), the operator message it
 *  names or null, and the resume rule to spread into `sendPrompt`'s options. */
export interface OperatorNudge {
  readonly line: string;
  readonly operatorMessageId: number | null;
  readonly rule: ReturnType<typeof resumeRuleOf>;
}

/** `readBox` is `readBoxText` bound to the lane's tmux and queue; an unreadable box (`null`, or a read that throws) is `null` to the
 *  rule. A generic mail reads no box at all. */
export async function operatorNudgeFor(
  readBox: (sessionId: string) => Promise<string | null>, toId: string,
  origin: { readonly fromId: string; readonly subject: string } | null,
): Promise<OperatorNudge> {
  const nudge = mailNudgeOf(toId, origin);
  const box = nudge.operatorMessageId === null ? null : await readBox(toId).catch(() => null);
  return { line: nudge.line, operatorMessageId: nudge.operatorMessageId, rule: resumeRuleOf(nudge, box) };
}
