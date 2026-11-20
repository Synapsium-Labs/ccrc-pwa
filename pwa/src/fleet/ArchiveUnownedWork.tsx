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
import { offerOf, presenceWord, unownedWork, type WorktreeControl } from './delegationWords';
import { WorktreeControls } from './WorktreeControls';
import './archiveUnownedWork.css';

export const UNOWNED_TITLE = 'Work no session owns';
export const UNOWNED_PURPOSE = 'Delegated worktrees the broker could not give one owner, and worktrees whose two sessions are both gone.';

/** One row, whichever kind: where it is, one line of words, and the acts the words module gave it. */
function UnownedRow({ kind, project, where, meta, act, offer, nowMs, getHeading }: {
  kind: 'tree' | 'lease'; project: string; where: string; meta: readonly string[];
  act: { readonly leaseId: string; readonly worktree: string; readonly controls: readonly WorktreeControl[] } | null;
  offer: string; nowMs: number; getHeading: () => HTMLElement | null;
}): ReactNode {
  return (
    <div className="archive-unowned-row" data-unowned-row={kind}>
      <div className="archive-unowned-what">
        <span className="archive-unowned-where"><span>{project}</span> · <span className="archive-unowned-path">{where}</span></span>
        {meta.length > 0 && <span className="archive-unowned-meta">{meta.join(' · ')}</span>}
      </div>
      {act !== null && act.controls.length > 0 && (
        <WorktreeControls leaseId={act.leaseId} worktree={act.worktree} controls={act.controls} offer={offer} nowMs={nowMs} getHeading={getHeading} />
      )}
    </div>
  );
}

/** A kind of row under its subhead and its count. */
function Group({ title, count, children }: { title: string; count: number; children: ReactNode }): ReactNode {
  return (
    <div className="archive-unowned-group">
      <h3 className="archive-unowned-sub">{title}<span className="archive-unowned-count">{count}</span></h3>
      {children}
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
        <Group title="No single owner" count={work.trees.length}>
          {work.trees.map((r) => (
            <UnownedRow key={r.key} kind="tree" project={r.project} where={r.where} meta={r.meta}
              act={r.act === null ? null : { leaseId: r.act.leaseId, worktree: r.worktree, controls: r.act.controls }}
              offer={r.act === null ? '' : offerOf(r.act.leaseId, r.act.controls)} nowMs={now} getHeading={getHeading} />
          ))}
        </Group>
      )}
      {work.leases.length > 0 && (
        <Group title="Neither session listed" count={work.leases.length}>
          {work.leases.map((r) => (
            <UnownedRow key={r.key} kind="lease" project={r.project} where={r.where} meta={r.state}
              act={r.controls === null ? null : { leaseId: r.lease.leaseId, worktree: r.worktree, controls: r.controls }}
              offer={r.controls === null ? '' : offerOf(r.lease.leaseId, r.controls, r.lease)} nowMs={now} getHeading={getHeading} />
          ))}
        </Group>
      )}
    </Section>
  );
}
