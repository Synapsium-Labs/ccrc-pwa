// D-8808 (Linear hierarchy wave 8, Task 8.3): the attached-issues reader. Linear attaches an issue to the pull requests that
// name it; this asks each connected workspace which issues are attached to this repository's recent merged pull request URLs
// (`attachmentsForUrl`, one URL a call, read-only, as the ccrc actor through `runCcrcOp` and the one rate service) and counts
// the DISTINCT issues per (workspace, team key) pair. The count is the team link's evidence (`teamLink.ts`, kind
// `pr-attachments`). It reads and writes nothing of the repository, so it serves a public repository.
//
// OFF BY DEFAULT: nothing calls this reader. It is built and tested on a CONSTRUCTED fixture and is wired into the lane only
// after the operator's go for one live capture of the answer (`TeamLinkInputs.attached`, `visibilityLane.ts`).
//
// L4 DELIVERY around `teamLink.ts`'s pure counting (`tallyAttached`, and `attachedAnswer`'s rule that a count is a measurement
// only when every slot asked answered): this file only asks and hands each slot's answer over; `readAttachedIssues` never throws.
import { runCcrcOp, type CcrcCallDeps } from '../linear/ccrcCall.js';
import type { LinearRouteSlot } from '../linear/route.js';
import { attachedAnswer, type AttachedIssue, type AttachedTally } from './teamLink.js';

/** The most pull request URLs one read asks of each slot. */
export const ATTACHED_URLS_MAX = 10;

/** One slot's attached issues over every URL, or null at its first failure word (a slot that failed answers nothing). */
async function readSlot(deps: CcrcCallDeps, slot: LinearRouteSlot, urls: readonly string[]): Promise<AttachedIssue[] | null> {
  const out: AttachedIssue[] = [];
  for (const url of urls) {
    // The `team-link` pass is attribution only, on a read: no journal row, no policy ask.
    const r = await runCcrcOp(deps, {
      op: 'attachmentsForUrl', pass: 'team-link', lane: 'sync', slot: slot.ref, workspaceId: slot.workspaceId,
      teamKey: null, target: null, fields: [], input: { url },
    });
    if (!r.ok) return null;
    const nodes = r.value['nodes'];
    if (!Array.isArray(nodes)) return null;
    for (const n of nodes as Array<{ issueId: string; teamKey: string }>) out.push({ workspaceId: slot.workspaceId, issueId: n.issueId, teamKey: n.teamKey });
  }
  return out;
}

/**
 * The distinct attached issues per pair over `urls` (at most {@link ATTACHED_URLS_MAX}), asked of each routable slot, or
 * `unmeasured` unless every slot asked answered all of them (`attachedAnswer`). A failing slot does not stop another from
 * being asked. Never throws.
 */
export async function readAttachedIssues(
  deps: CcrcCallDeps, slots: readonly LinearRouteSlot[], urls: readonly string[],
): Promise<AttachedTally | 'unmeasured'> {
  const asked = urls.slice(0, ATTACHED_URLS_MAX);
  if (asked.length === 0) return 'unmeasured';
  const answers: Array<AttachedIssue[] | null> = [];
  for (const slot of slots) answers.push(await readSlot(deps, slot, asked));
  return attachedAnswer(answers);
}
