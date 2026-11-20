// The Archive screen's "Work no session owns" section (session helpers design 2026-11-19, §6 and Table 8; desktop polish H4,
// D-8828). C48 took unowned trees and the leases of two unlisted sessions off the fleet list; this is where they live now.
// Two kinds of row, under two subheads: a tree the broker could not give one owner, and a worktree whose parent and worker are
// both unlisted. `unownedWork` (`delegationWords.ts`, L1) decides every row, count and word; this draws what it says, and its
// acts are `WorktreeControls`' (the same two doors and the same asking first as the session's own worktree rows). It draws
// no liveness word and no bare `unmeasured`, and no `title`: a phone shows none (§4.4). With nothing to draw it draws nothing.
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import type { DelegationProjectionWire, FleetSession } from '../../../shared/api';
import { offerOf, presenceWord, unownedWork, type UnlistedLeaseRow, type UnownedTreeRow } from './delegationWords';
import { WorktreeControls } from './WorktreeControls';
import './archiveUnownedWork.css';

export const UNOWNED_TITLE = 'Work no session owns';
export const UNOWNED_PURPOSE = 'Delegated worktrees the broker could not give one owner, and worktrees whose two sessions are both gone.';

function TreeRow({ row, nowMs, getHeading }: { row: UnownedTreeRow; nowMs: number; getHeading: () => HTMLElement | null }): ReactNode {
  return (
    <div className="archive-unowned-row" data-unowned-row="tree">
      <div className="archive-unowned-what">
        <span className="archive-unowned-where"><span>{row.project}</span> · <span className="archive-unowned-path">{row.where}</span></span>
        <span className="archive-unowned-meta">{[row.verdict, row.tried].filter((p): p is string => p !== null).join(' · ')}</span>
      </div>
      {row.act !== null && (
        <WorktreeControls leaseId={row.act.leaseId} worktree={row.worktree} controls={row.act.controls}
          offer={offerOf(row.act.leaseId, row.act.controls)} nowMs={nowMs} getHeading={getHeading} />
      )}
    </div>
  );
}

function LeaseRow({ row, nowMs, getHeading }: { row: UnlistedLeaseRow; nowMs: number; getHeading: () => HTMLElement | null }): ReactNode {
  return (
    <div className="archive-unowned-row" data-unowned-row="lease">
      <div className="archive-unowned-what">
        <span className="archive-unowned-where"><span>{row.project}</span> · <span className="archive-unowned-path">{row.where}</span></span>
        {row.state.length > 0 && <span className="archive-unowned-meta">{row.state.join(' · ')}</span>}
      </div>
      {row.controls !== null && row.controls.length > 0 && (
        <WorktreeControls leaseId={row.lease.leaseId} worktree={row.worktree} controls={row.controls}
          offer={offerOf(row.lease.leaseId, row.controls, row.lease)} nowMs={nowMs} getHeading={getHeading} />
      )}
    </div>
  );
}

export function ArchiveUnownedWork({ delegation, sessions, nowMs }: {
  delegation: DelegationProjectionWire | null;
  sessions: readonly FleetSession[];
  /** The clock, for the attempt's age and a held worktree's date; the screen's now by default. */
  nowMs?: number;
}): ReactNode {
  const heading = useRef<HTMLSpanElement>(null);
  const now = nowMs ?? Date.now();
  const work = unownedWork(delegation, sessions, now);
  if (work.total === 0) return null;
  const presence = presenceWord(work.unmeasured);
  // Where the focus goes when the row that held it leaves: the section's own heading.
  const getHeading = (): HTMLElement | null => heading.current;
  return (
    <Section
      title={<span ref={heading} tabIndex={-1}>
        {UNOWNED_TITLE}{' '}<span className="archive-unowned-count">{work.total}</span>
        {presence !== null && <>{' '}<span className="archive-unowned-count">· {presence}</span></>}
      </span>}
      purpose={UNOWNED_PURPOSE}>
      {work.trees.length > 0 && (
        <div className="archive-unowned-group">
          <h3 className="archive-unowned-sub">No single owner<span className="archive-unowned-count">{work.trees.length}</span></h3>
          {work.trees.map((r) => <TreeRow key={r.key} row={r} nowMs={now} getHeading={getHeading} />)}
        </div>
      )}
      {work.leases.length > 0 && (
        <div className="archive-unowned-group">
          <h3 className="archive-unowned-sub">Neither session listed<span className="archive-unowned-count">{work.leases.length}</span></h3>
          {work.leases.map((r) => <LeaseRow key={r.key} row={r} nowMs={now} getHeading={getHeading} />)}
        </div>
      )}
    </Section>
  );
}
