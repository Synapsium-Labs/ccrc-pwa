// A card is always a project; a line is always a session. No bare path.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import type { FleetGroup } from '../src/fleet/groupFleet';
import { ProjectCard } from '../src/fleet/ProjectCard';

// vitest runs without globals, so RTL's auto-cleanup never registers itself —
// without this, rerender/multi-render tests below leak DOM across `it` blocks.
afterEach(cleanup);

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'quiet-mesa', name: null, status: 'idle',
  statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: null, tasks: null, ...over,
});

const grp = (over: Partial<FleetGroup> = {}): FleetGroup => ({
  project: 'demo', sessions: [sess()], attention: false, busy: 0, pin: 'claude', ...over,
});

describe('uniform shape', () => {
  // The defect this whole restructure exists to fix: ProjectGroup showed a
  // header only at two-or-more members, and the live fleet is nine projects
  // holding one session each — so the header rendered nowhere at all.
  it('renders a header for a project holding ONE session', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('demo')).toBeInTheDocument();
  });

  it('renders the same shape for a project holding several', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByText('quiet-mesa')).toBeInTheDocument();
    expect(screen.getByText('still-cove')).toBeInTheDocument();
  });

  it('shows the live session count', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'b', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('folding', () => {
  it('hides the lines when collapsed', () => {
    render(<ProjectCard group={grp()} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('quiet-mesa')).not.toBeInTheDocument();
  });

  // A fold must never be able to hide the one thing this screen exists to
  // surface. The header wears the group's urgency either way.
  it('keeps the count and the attention dot while collapsed', () => {
    const g = grp({ attention: true, sessions: [sess({ dialogPending: true })] });
    render(<ProjectCard group={g} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByLabelText('waiting on you')).toBeInTheDocument();
  });

  it('reports the toggle with its project name', async () => {
    const onToggle = vi.fn();
    render(<ProjectCard group={grp()} onToggle={onToggle} onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { expanded: true }));
    expect(onToggle).toHaveBeenCalledWith('demo');
  });
});

describe('the + button', () => {
  it('names the projected account and its headroom', () => {
    render(<ProjectCard group={grp()} projected={{ wrapper: 'claude', score: 9 }}
                        onAddWorkspace={() => {}} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText(/91% free/)).toBeInTheDocument();
  });

  it('still offers a + before any projection has landed', () => {
    // /api/accounts has its own poll; the + must never wait on it.
    render(<ProjectCard group={grp()} projected={null} onAddWorkspace={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /new workspace on demo/i })).toBeEnabled();
  });

  it('disables itself while that project has an add in flight', () => {
    // ccd does not dedupe concurrent ws-adds: two calls draw two slugs and
    // create two worktrees, two branches and two systemd units.
    render(<ProjectCard group={grp()} adding onAddWorkspace={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /new workspace on demo/i })).toBeDisabled();
  });

  // Ported from the deleted project-group.test.tsx (git show ab11b66) — the
  // production code carried over unchanged, but without a test here a future
  // edit to this aria-label or the LOW_HEADROOM threshold regresses silently.
  it('carries the account into the accessible name, not just the pixels', () => {
    render(<ProjectCard group={grp()} projected={{ wrapper: 'claude', score: 18 }}
                        onAddWorkspace={() => {}} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /New workspace on demo — team·max, 82% free/i }))
      .toBeInTheDocument();
  });

  it('flags a landing on an exhausted account', () => {
    // ccd's rule has no availability filter: with every account pinned it
    // still returns one, and this is the only warning the user gets.
    render(<ProjectCard group={grp()} onAddWorkspace={() => {}} onOpen={() => {}}
                        onActions={() => {}} projected={{ wrapper: 'claude-corp', score: 99 }} />);
    const note = screen.getByText(/team·shared · 1% free/);
    expect(note).toHaveAttribute('data-low', 'true');
  });

  it('does not flag a healthy account', () => {
    render(<ProjectCard group={grp()} projected={{ wrapper: 'claude', score: 18 }}
                        onAddWorkspace={() => {}} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText(/team·max · 82% free/)).not.toHaveAttribute('data-low');
  });

  // The score: 99 / score: 18 cases above sit far from LOW_HEADROOM (75), so a
  // `>=` → `>` flip or a 75 → 80 drift in the threshold would pass unnoticed.
  // These two pin the actual boundary: 75 is the first score that flags,
  // matching the accounts strip's own `crit` threshold.
  it('flags exactly at the LOW_HEADROOM boundary (score 75, the first exhausted value)', () => {
    render(<ProjectCard group={grp()} onAddWorkspace={() => {}} onOpen={() => {}}
                        onActions={() => {}} projected={{ wrapper: 'claude', score: 75 }} />);
    const note = screen.getByText(/team·max · 25% free/);
    expect(note).toHaveAttribute('data-low', 'true');
  });

  it('does not flag just below the boundary (score 74)', () => {
    render(<ProjectCard group={grp()} onAddWorkspace={() => {}} onOpen={() => {}}
                        onActions={() => {}} projected={{ wrapper: 'claude', score: 74 }} />);
    expect(screen.getByText(/team·max · 26% free/)).not.toHaveAttribute('data-low');
  });
});

describe('pinned account', () => {
  it('shows the account the project is pinned to', () => {
    render(<ProjectCard group={grp({ pin: 'claude-corp' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·shared')).toBeInTheDocument();
  });

  it('says "mixed" when the sessions disagree rather than picking one', () => {
    render(<ProjectCard group={grp({ pin: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('mixed')).toBeInTheDocument();
  });

  it('names the pin for assistive tech — a bare label reads as decoration', () => {
    render(<ProjectCard group={grp({ pin: 'claude' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('pinned to team·max')).toBeInTheDocument();
  });
});
