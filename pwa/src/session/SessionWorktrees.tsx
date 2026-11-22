// The worktrees a session holds, in its own details (D-8782): they moved here from the fleet list's rows, with the row's
// words and its three controls (Keep worktree, Attach to…, Not delegated), going through the same doors and refusals.
// The words are `delegationWords.ts`'s and the controls `WorktreeControls`'; this draws what they say and decides nothing.
// A row says its path, its disposition and its controls, and no liveness word (session helpers H3, D-8875; spec §4.4); a
// presence on disk not measured is said once, in the section's head.
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { WorkLine } from '../fleet/WorkLine';
import { WorktreeControls } from '../fleet/WorktreeControls';
import { WorksOnChip } from '../fleet/SessionLine';
import { workingOnCard } from '../fleet/fleetTree';
import type { SessionWorktree } from '../fleet/sessionWorktrees';
import {
  creatorChip, inferredChip, offerOf, presenceUnmeasured, presenceWord, worktreeControls, worktreeLine, worktreeStateParts,
} from '../fleet/delegationWords';

/** The section's note-sized heading line (its title, then the presence line when there is one). */
const NOTE_CLASS = 'chat-fact sess-entries-note';

/** The session's worktrees, one row each, under a heading the controls hand the focus back to. Nothing when it holds none. */
export function SessionWorktrees({ worktrees, project, nowMs, detailsStay = () => true }: {
  worktrees: readonly SessionWorktree[];
  /** Whether the details region that holds this section is drawn by the render now committing (`SessionDetails`' own answer,
   *  review 2995 F2): when it is not, it goes with the last worktree, so the focus the controls hand back rests on the header's
   *  title, not on a region that is leaving. Asked when the focus moves, never kept from an earlier render. */
  detailsStay?: () => boolean;
  /** This session's project: a worktree of another project's code says so, as the fleet row did. */
  project: string;
  nowMs?: number;
}): ReactNode {
  const heading = useRef<HTMLSpanElement>(null);
  // Read through a ref, never a closure: a control registers its leave-time hand-off once, at mount, so a prop read there would be
  // the first render's. The getter it holds asks the details' render of now (review 2995 F2).
  const stays = useRef(detailsStay);
  stays.current = detailsStay;
  // Where the focus goes when the last row leaves while a control holds it: the section goes with its heading, so the details
  // region that held it (`tabIndex=-1`, `SessionDetails`) takes it, or the header's title when that region goes too. Kept from the last render that had a section. Refined
  // draws that region as `display: contents`, which has no box and so cannot hold the focus (measured in a real Chrome,
  // review 2864 F4): the focus then goes to the nearest ancestor that has one, made a script-focus target if it is not.
  const host = useRef<HTMLElement | null>(null);
  const keepHost = (el: HTMLElement | null): void => { if (el !== null) host.current = el.closest<HTMLElement>('.chat-facts'); };
  const restFocusAt = (): HTMLElement | null => {
    let el = host.current;
    // When the last worktree was the details row's only fact, the row goes with it (`detailsHaveFacts`, desktop polish C51 review
    // 2963 F3) and the region that held the focus is gone: the header's own title takes it, never `body`.
    if (!stays.current() || el === null || !el.isConnected) el = document.querySelector<HTMLElement>('.chat-head .chat-title');
    while (el !== null && getComputedStyle(el).display === 'contents') el = el.parentElement;
    if (el !== null && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    return el;
  };
  if (worktrees.length === 0) return null;
  const now = nowMs ?? Date.now();
  // The presence on disk the wire did not measure, said once in the head (spec §4.4), in the Archive's words and by its count
  // (`presenceWord`, `presenceUnmeasured`).
  const presence = presenceWord(presenceUnmeasured(worktrees.map(({ lease: l }) => l)));
  return (
    <div className="sess-worktrees" ref={keepHost}>
      <span className={NOTE_CLASS} ref={heading} tabIndex={-1}>Worktrees</span>
      {presence !== null && <span className={NOTE_CLASS} data-presence="">{` · ${presence}`}</span>}
      {worktrees.map(({ lease: l, viaLabel, attachLabel }) => {
        const w = worktreeLine(l, viaLabel, workingOnCard({ project: l.project }, project));
        // D-6999: the chips are words, never colour alone, and nothing acts on the row but the operator's own tap (PR10). A row
        // from an older server (without PR7's fields) adds no word and no control (W5-U10).
        const chips = [inferredChip(l), creatorChip(l)];
        const controls = worktreeControls(l, attachLabel);
        return (
          <WorkLine key={l.leaseId} parts={[...w.parts, ...worktreeStateParts(l, now)]} title={w.title} nameAt={w.nameAt}>
            {w.sourceProject !== null && <WorksOnChip project={w.sourceProject} />}
            {chips.some((c) => c !== null) && (
              // One box, so the row wraps the pair together (D-6999: side by side; review 3123 F6).
              <span className="proj-work-chips">
                {chips.map((c, i) => c === null ? null : <span key={i} className="proj-work-chip" title={c.title}>{c.text}</span>)}
              </span>
            )}
            {controls !== null && <WorktreeControls leaseId={l.leaseId} worktree={l.adminRecord} controls={controls}
              offer={offerOf(l.leaseId, controls, l)} nowMs={now} getHeading={() => heading.current ?? restFocusAt()} />}
          </WorkLine>
        );
      })}
    </div>
  );
}
