// Desktop polish C48 (D-8782): the fleet list draws no row for a session's subagents or workflows. The operator's words,
// 2026-11-19: "the number of subagents in a session is noise at this point on the left panel. It's information useful only
// inside the session running them." C46 took the counts off the row; this takes the rows too.
// What stays, and is held here so a removal cannot over-reach: lease rows, unowned rows, and the session's own details.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { DelegationProjectionWire } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { fleetTree } from '../src/fleet/fleetTree';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { activitiesStartedBy, delegatedChip, readDelegation } from '../src/fleet/delegationWords';
import { activity, frame, lease, unowned } from './delegationFixture';

afterEach(cleanup);

const coordA = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a' });

/** The one card of project-a, as the fleet list draws it. */
const cardFor = (w: DelegationProjectionWire) => fleetTree([coordA], [], [], {}, w).find((g) => g.project === 'project-a')!;

const agent = activity({ activityId: 'a-agent', parentId: 'coord-a', sourceKind: 'agent', displayName: 'map the tree' });
const workflow = activity({ activityId: 'a-flow', parentId: 'coord-a', sourceKind: 'workflow', displayName: 'nightly sweep',
  openedAt: '2026-10-26T10:00:30.000Z' });

/** Every string a card exposes to a reader: its text, plus each accessible name and title. */
const spoken = (root: HTMLElement): string => {
  const named = [...root.querySelectorAll('*')].flatMap((el) => [el.getAttribute('aria-label'), el.getAttribute('title')])
    .filter((x): x is string => x !== null);
  return `${root.textContent} ${named.join(' ')}`;
};

describe('C48 (D-8782): the fleet list draws no activity row', () => {
  it('a session with an agent, a workflow and one worktree draws the session row and the worktree row, and nothing of the two activities', () => {
    const w = frame({ activities: [agent, workflow], leases: [lease({ sourceKind: 'raw' })] });
    const { container } = render(<ProjectCard group={cardFor(w)} onOpen={() => {}} onActions={() => {}} />);
    // Positive controls: the session row and the lease row are drawn, so the absences below are not an empty card.
    expect(container.textContent).toContain('coord-a');
    expect(container.querySelectorAll('.proj-work')).toHaveLength(1);
    expect(container.querySelector('.proj-work')!.textContent).toContain('worktree');
    // The worktree row's own words ("agent-a1") would match the word `agent`, so read the card without it.
    const rest = container.cloneNode(true) as HTMLElement;
    rest.querySelectorAll('.proj-work').forEach((el) => el.remove());
    expect(rest.textContent).toContain('coord-a');
    const said = spoken(rest);
    expect(said).not.toMatch(/\bagent\b/i);
    expect(said).not.toMatch(/workflow/i);
    expect(said).not.toContain('not confirmed');
    expect(said).not.toContain('map the tree');
    expect(said).not.toContain('nightly sweep');
  });

  it('an offline coordinator\'s activities draw no row and no group header; its worktree keeps its group', () => {
    // The server files it `offline-coordinator` while the parent is still listed on the card, which is how a card ever carries one
    // (`fleetTree` routes an activity by its parent: a parent not on the list puts it on no card).
    const w = frame({
      activities: [activity({ activityId: 'a-off', parentId: 'coord-a', group: 'offline-coordinator', displayName: 'orphan helper' })],
    });
    const { container } = render(<ProjectCard group={cardFor(w)} onOpen={() => {}} onActions={() => {}} offlineOpen />);
    expect(container.textContent).toContain('coord-a');
    expect(container.querySelectorAll('.proj-work')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/offline coordinator/i);
    expect(container.textContent).not.toContain('orphan helper');
    // The group's other member is a worktree: it still draws, and its header counts it alone.
    const withLease = frame({
      activities: w.activities,
      leases: [lease({ leaseId: 'l-gone', parentId: 'coord-gone', group: 'offline-coordinator', adminRecord: 'agent-o1',
        canonicalPath: '/work/project-a/.claude/worktrees/agent-o1' })],
    });
    const both = render(<ProjectCard group={cardFor(withLease)} onOpen={() => {}} onActions={() => {}} offlineOpen />);
    expect(both.container.textContent).toContain('Offline coordinator (1)');
    expect(both.container.querySelectorAll('.proj-work')).toHaveLength(1);
    expect(both.container.textContent).not.toContain('orphan helper');
  });

  it('the tree carries no row of kind activity, whatever the activity\'s group or placement', () => {
    const rows = cardFor(frame({
      activities: [agent, workflow, activity({ activityId: 'a-chip', placement: 'chip' }),
        activity({ activityId: 'a-off', group: 'offline-coordinator' })],
      leases: [lease()], unowned: [unowned()],
    })).rows;
    expect(rows.map((r) => r.kind)).not.toContain('activity');
    // Positive control: the worktree and the unowned row (and the header that holds the unowned one) are still emitted.
    expect(rows.map((r) => r.kind)).toEqual(['session', 'lease', 'delegation-group', 'unowned']);
  });

  it('a group header whose only members were activities goes with them', () => {
    const rows = cardFor(frame({ activities: [activity({ activityId: 'a-off', parentId: 'coord-a', group: 'offline-coordinator' })] })).rows;
    expect(rows.map((r) => r.kind)).toEqual(['session']);
  });

  it('unowned rows stay', () => {
    const { container } = render(<ProjectCard group={cardFor(frame({ activities: [agent], unowned: [unowned()] }))}
      onOpen={() => {}} onActions={() => {}} unownedOpen />);
    expect(container.textContent).toContain('Unowned work (1)');
    expect(container.querySelectorAll('.proj-work')).toHaveLength(1);
  });

  it('the same session\'s details still list both activities, each with its word and title (SessionDetails reads the frame, never the list\'s rows)', () => {
    const w = readDelegation(frame({ activities: [agent, workflow], leases: [lease()] }));
    const entries = activitiesStartedBy('coord-a', w);
    expect(entries.map((a) => a.activityId)).toEqual(['a-agent', 'a-flow']);
    const chip = delegatedChip(entries);
    expect(chip?.text).toBe('2 delegated');
    expect(chip?.rows.map((r) => r.parts)).toEqual([
      ['agent', 'map the tree', 'not confirmed'],
      ['workflow', 'nightly sweep', 'not confirmed'],
    ]);
  });
});
