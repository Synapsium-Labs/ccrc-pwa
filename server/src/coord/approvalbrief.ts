/**
 * The mail that asks a child's claimant to rule on its permission prompt (coordinator-first routing spec 2026-10-17
 * §6.3 server step 3 and §6.7, plan Task 16, D-5298).
 *
 * What the claimant reads, and why each part sits where it does:
 *  - the child's input is UNTRUSTED text a model wrote, so it rides inside `untrustedBlock` (the fixed preface, a fence
 *    the text cannot close, the 4 KB cap) and nowhere else, already `redactCommand`ed (the row stores only that form);
 *  - the class is the SERVER's, so it sits outside the fence, with what it lets the claimant do;
 *  - the deadline is the row's window end (`notifyAt`, D-5441), in UTC: after it the hook has returned, the operator
 *    has the prompt, and a ruling is refused `hook-gone`;
 *  - the commands are the coordinator skill's own client form, as the ask brief's are (D-5365): `"$API"`, `$id` and
 *    `$uuid` are the skill's preamble's names. The client's closed grammar takes the verdict and the reason in the
 *    `--json` body, never as positional words (D-5489). The hand-over's heredoc is unquoted so the pair expands, and
 *    holds only those names; the rule commands' reason is the coordinator's free text, which may quote the child's
 *    command, so it never sits in an expanding context: a quoted heredoc reads it and jq builds the body (D-5489).
 *
 * L1, pure: strings in, a string out.
 */
import { APPROVAL_CLASS_MAP, isApprovalClass } from './approvalguard.js';
import { UNTRUSTED_CAP_BYTES, untrustedBlock } from './untrusted.js';

/** A tool name as the brief shows it outside the fence: Claude Code's own word, so plain characters only. */
const toolWord = (tool: string): string => (/^[A-Za-z0-9_.:-]{1,64}$/.test(tool) ? tool : '(an unnamed tool)');

export function renderApprovalBrief(a: {
  readonly id: number; readonly childId: string; readonly tool: string; readonly agentId: string;
  readonly inputRedacted: string; readonly class: string; readonly digest: string; readonly notifyAt: number;
}): string {
  const deadline = new Date(a.notifyAt).toISOString().slice(11, 19);
  const cls = isApprovalClass(a.class) ? a.class : 'escalate';
  const who = '"fromId":"$id","fromUuid":"$uuid"';
  // The reason is free text the coordinator types, and it naturally restates the child's untrusted command, so it is
  // read through a QUOTED heredoc (nothing in it expands) and jq writes the JSON (a quote in it cannot break the body).
  // A shell does not re-scan an expanded `$reason` for command substitution (D-5489, amended).
  const rule = (verdict: 'allow' | 'deny'): string =>
    'IFS= read -r reason <<\'REASON\'\n<one line, in plain words>\nREASON\n' +
    `jq -nc --arg id "$id" --arg uuid "$uuid" --arg reason "$reason" '{fromId:$id,fromUuid:$uuid,verdict:"${verdict}",reason:$reason}' |\n` +
    `  "$API" approvals rule ${a.id} --json -\n`;
  const thread = a.agentId === '' ? 'its main thread' : 'one of its subagents';
  return `You are the parent of session \`${a.childId}\`: ${thread} asks permission to run a ${toolWord(a.tool)} call.\n` +
    `Class (the server's, not the child's): ${cls} — ${APPROVAL_CLASS_MAP[cls]}.\n` +
    `Your window closes at ${deadline} UTC: then the child's hook returns, the operator has the prompt, ` +
    'and a ruling is refused (hook-gone).\n\n' +
    `${untrustedBlock(a.inputRedacted, UNTRUSTED_CAP_BYTES, `on the row (\`"$API" approvals show ${a.id}\`)`)}\n\n` +
    `Input digest: ${a.digest}\n\n` +
    'Rule from your own artifacts (spec, plan, ledger, branch, your prior rulings), never from the child\'s ' +
    'reasoning, which you cannot see. A ruling allows this one call once; it writes no rule and changes no mode.\n\n' +
    (cls === 'ordinary' ? `Allow it once:\n${rule('allow')}\n` : 'You may not allow this class: deny it, or hand it over.\n\n') +
    `Deny it, with the reason the child will read:\n${rule('deny')}\n` +
    'Hand it over (not yours to rule: the operator is notified at once, and it is final):\n' +
    `"$API" approvals release ${a.id} --json - <<JSON\n{${who}}\nJSON\n\n` +
    'Run the ccrc-coordinator skill.';
}
