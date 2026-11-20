// D-8808 (Linear hierarchy wave 8, Task 8.3): the attached-issues reader. Linear attaches an issue to the pull requests that
// name it; this asks each connected workspace which issues are attached to this repository's recent merged pull request URLs
// (`attachmentsForUrl`, one URL a call, read-only, as the ccrc actor through `runCcrcOp` and the one rate service) and counts
// the DISTINCT issues per (workspace, team key) pair. The count is the team link's evidence (`teamLink.ts`, kind
// `pr-attachments`). It reads and writes nothing of the repository, so it serves a public repository.
//
// OFF BY DEFAULT: nothing calls this reader. It is built and tested on a CONSTRUCTED fixture and is wired into the lane only
// after the operator's go for one live capture of the answer (`TeamLinkInputs.attached`, `visibilityLane.ts`).
//
// The counting is a pure helper (`tallyAttached`); the I/O is `readAttachedIssues`, which never throws.
import { runCcrcOp, type CcrcCallDeps } from '../linear/ccrcCall.js';
import type { LinearRouteSlot } from '../linear/route.js';
import type { AttachedPair, AttachedTally } from './teamLink.js';

/** The most pull request URLs one read asks of each slot. */
export const ATTACHED_URLS_MAX = 10;

/** One attached issue as a slot answered it. */
export interface AttachedIssue { workspaceId: string; issueId: string; teamKey: string }

/** The distinct issues of `found` (one per workspace and issue id, however many URLs name it), per (workspace, key). */
export function tallyAttached(found: readonly AttachedIssue[]): AttachedTally {
  const seen = new Map<string, AttachedIssue>();
  for (const i of found) seen.set(`${i.workspaceId}\u0000${i.issueId}`, i);
  const pairs = new Map<string, AttachedPair>();
  for (const i of seen.values()) {
    const key = i.teamKey.toUpperCase();
    const id = `${i.workspaceId}\u0000${key}`;
    const p = pairs.get(id);
    if (p === undefined) pairs.set(id, { workspaceId: i.workspaceId, key, ids: 1 });
    else p.ids += 1;
  }
  return { total: seen.size, pairs: [...pairs.values()] };
}

/** One slot's attached issues over every URL, or null at its first failure word (a slot that failed answers nothing, so a
 *  count never rests on part of its URLs). */
async function readSlot(deps: CcrcCallDeps, slot: LinearRouteSlot, urls: readonly string[]): Promise<AttachedIssue[] | null> {
  const out: AttachedIssue[] = [];
  for (const url of urls) {
    // `plan-sync` is attribution only, on a read: no journal row, no policy ask.
    const r = await runCcrcOp(deps, {
      op: 'attachmentsForUrl', pass: 'plan-sync', lane: 'sync', slot: slot.ref, workspaceId: slot.workspaceId,
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
 * `unmeasured` when no slot answered all of them (no slot, no URL, every slot failed or answered out of shape: never a zero).
 * A failing slot does not stop another. Never throws.
 */
export async function readAttachedIssues(
  deps: CcrcCallDeps, slots: readonly LinearRouteSlot[], urls: readonly string[],
): Promise<AttachedTally | 'unmeasured'> {
  const asked = urls.slice(0, ATTACHED_URLS_MAX);
  if (asked.length === 0) return 'unmeasured';
  const found: AttachedIssue[] = [];
  let answered = 0;
  for (const slot of slots) {
    const got = await readSlot(deps, slot, asked);
    if (got === null) continue;
    answered += 1;
    found.push(...got);
  }
  return answered === 0 ? 'unmeasured' : tallyAttached(found);
}
