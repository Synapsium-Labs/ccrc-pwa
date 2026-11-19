// The worktrees a session holds, in its own details (D-8782): they moved here from the fleet list's rows, with the row's
// words and its three controls (Keep worktree, Attach to…, Not delegated), going through the same doors and refusals.
// The words are `delegationWords.ts`'s and the controls `WorktreeControls`'; this draws what they say and decides nothing.
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { WorkLine } from '../fleet/WorkLine';
import { WorktreeControls } from '../fleet/WorktreeControls';
import { WorksOnChip } from '../fleet/SessionLine';
import { workingOnCard } from '../fleet/fleetTree';
import type { SessionWorktree } from '../fleet/sessionWorktrees';
import {
  creatorChip, inferredChip, offerOf, worktreeControls, worktreeLine, worktreeStateParts,
} from '../fleet/delegationWords';

/** The session's worktrees, one row each, under a heading the controls hand the focus back to. Nothing when it holds none. */
export function SessionWorktrees({ worktrees, project, nowMs }: {
  worktrees: readonly SessionWorktree[];
  /** This session's project: a worktree of another project's code says so, as the fleet row did. */
  project: string;
  nowMs?: number;
}): ReactNode {
  const heading = useRef<HTMLSpanElement>(null);
  // Where the focus goes when the last row leaves while a control holds it: the section goes with its heading, so the details
  // region that held it (`tabIndex=-1`, `SessionDetails`) takes it. Kept from the last render that had a section.
  const host = useRef<HTMLElement | null>(null);
  const keepHost = (el: HTMLElement | null): void => { if (el !== null) host.current = el.closest<HTMLElement>('.chat-facts'); };
  if (worktrees.length === 0) return null;
  const now = nowMs ?? Date.now();
  return (
    <div className="sess-worktrees" ref={keepHost}>
      <span className="chat-fact sess-entries-note" ref={heading} tabIndex={-1}>Worktrees</span>
      {worktrees.map(({ lease: l, viaLabel, attachLabel }) => {
        const w = worktreeLine(l, viaLabel, workingOnCard({ project: l.project }, project));
        // D-6999: the chips are words, never colour alone, and nothing acts on the row but the operator's own tap (PR10). A row
        // from an older server (without PR7's fields) adds no word and no control (W5-U10).
        const chips = [inferredChip(l), creatorChip(l)];
        const controls = worktreeControls(l, attachLabel);
        return (
          <WorkLine key={l.leaseId} parts={[...w.parts, ...worktreeStateParts(l, now)]} title={w.title} nameAt={w.nameAt}>
            {w.sourceProject !== null && <WorksOnChip project={w.sourceProject} />}
            {chips.map((c, i) => c === null ? null : <span key={i} className="proj-work-chip" title={c.title}>{c.text}</span>)}
            {controls !== null && <WorktreeControls leaseId={l.leaseId} worktree={l.adminRecord} controls={controls}
              offer={offerOf(l.leaseId, controls, l)} nowMs={now} getHeading={() => heading.current ?? host.current} />}
          </WorkLine>
        );
      })}
    </div>
  );
}
