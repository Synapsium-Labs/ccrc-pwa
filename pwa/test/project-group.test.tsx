import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ProjectGroup } from '../src/fleet/ProjectGroup';
import type { FleetGroup } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

afterEach(cleanup);

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, ...over,
});

const s1 = s({ id: 'a' });
const s2 = s({ id: 'b', workspace: 'quiet-mesa' });

const g = (over: Partial<FleetGroup>): FleetGroup => ({
  project: 'alpha',
  sessions: [s1],
  grouped: false,
  attention: false,
  busy: 0,
  ...over,
});

describe('ProjectGroup', () => {
  it('renders an ungrouped project as bare cards, with no header', () => {
    // The old assertion queried /collapse|expand/i, which matches nothing the
    // toggle is ever called — so it stayed green with the header rendered.
    // These name the header's actual parts instead: deleting the bare-Fragment
    // guard in ProjectGroup turns every one of them red.
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}}
                         onAddWorkspace={() => {}} />);
    expect(document.querySelector('.proj-group')).toBeNull();
    expect(document.querySelector('.proj-group-head')).toBeNull();
    expect(document.querySelector('.proj-group-chevron')).toBeNull();
    expect(document.querySelector('.proj-group-count')).toBeNull();
    // The toggle is the only aria-expanded control there is, and it is titled
    // by the project name.
    expect(screen.queryByRole('button', { expanded: true })).toBeNull();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.queryByText('alpha')).toBeNull();
    // The card itself is untouched — one session still renders exactly as it
    // did before workspaces existed.
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('still offers a + on an ungrouped project — the first workspace has to start somewhere', () => {
    // A group needs 2+ sessions, and all nine live projects have exactly one:
    // with the + confined to the grouped header it renders NOWHERE, and a first
    // workspace can only be made over SSH.
    const onAdd = vi.fn();
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}} onAddWorkspace={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    expect(onAdd).toHaveBeenCalledWith('alpha');
  });

  it('renders a header with a session count when grouped', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('collapses and expands', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}} />);
    const toggle = screen.getByRole('button', { name: /alpha/i });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(toggle);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('shows attention on a COLLAPSED header — folding must not hide it', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2], attention: true })}
                         onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    expect(screen.getByLabelText(/waiting on you/i)).toBeInTheDocument();
  });
});

describe('the + says where the workspace will land', () => {
  // Spec, "Account assignment": "A workspace that silently lands on an
  // exhausted account presents as a stalled session with no explanation, which
  // is the worst possible version of this. The affordance shows the account it
  // is about to assign and its current headroom."
  const projected = { wrapper: 'claude', score: 18 };

  it('names the account and its headroom before the tap', () => {
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}}
                         onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByText(/team·max · 82% free/)).toBeInTheDocument();
  });

  it('says it on a grouped header too', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}}
                         onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByText(/team·max · 82% free/)).toBeInTheDocument();
  });

  it('carries the account into the accessible name, not just the pixels', () => {
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}}
                         onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByRole('button', { name: /New workspace on alpha — team·max, 82% free/i }))
      .toBeInTheDocument();
  });

  it('flags a landing on an exhausted account', () => {
    // ccd's rule has no availability filter: with every account pinned it still
    // returns one, and this is the only warning the user gets.
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}} onAddWorkspace={() => {}}
                         projected={{ wrapper: 'claude-corp', score: 99 }} />);
    const note = screen.getByText(/team·shared · 1% free/);
    expect(note).toHaveAttribute('data-low', 'true');
  });

  it('does not flag a healthy account', () => {
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}}
                         onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByText(/team·max · 82% free/)).not.toHaveAttribute('data-low');
  });

  it('still renders the + when the projection has not arrived yet', () => {
    // /api/accounts is polled; the + must never wait on it.
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}} onAddWorkspace={() => {}} />);
    expect(screen.getByRole('button', { name: /New workspace on alpha/i })).toBeInTheDocument();
    expect(screen.queryByText(/free/)).toBeNull();
  });

  it('disables its own + while a request is outstanding', () => {
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}}
                         onAddWorkspace={() => {}} adding />);
    expect(screen.getByRole('button', { name: /New workspace on alpha/i })).toBeDisabled();
  });
});
