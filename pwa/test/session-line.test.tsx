// The compact row that replaces SessionCard in the fleet list.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { SessionLine } from '../src/fleet/SessionLine';

// vitest runs without globals, so RTL's auto-cleanup never registers itself
// (see test/message-links.test.tsx et al.) — without this, rerender/multi-render
// tests below leak DOM across `it` blocks.
afterEach(cleanup);

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, ...over,
});

describe('label', () => {
  // Spec order: name ?? branch ?? workspace ?? id. Branch outranks the slug
  // because Phase 2 renames the branch to something descriptive while
  // `workspace` keeps the slug it was born with.
  it('prefers the live session name', () => {
    render(<SessionLine session={s({ name: 'refactor-auth', branch: 'ws/quiet-mesa' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('refactor-auth')).toBeInTheDocument();
  });

  it('falls back to the branch', () => {
    render(<SessionLine session={s({ branch: 'ws/quiet-mesa' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();
  });

  it('falls back to the workspace slug', () => {
    render(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('quiet-mesa')).toBeInTheDocument();
  });

  it('falls back to the id — the tail Phase 1 shipped untested', () => {
    // Legacy rows have no workspace. A mutation proved nothing caught this.
    render(<SessionLine session={s({ workspace: null, id: 'claude-legacy' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('claude-legacy')).toBeInTheDocument();
  });
});

describe('state', () => {
  it('reads exited when dead', () => {
    render(<SessionLine session={s({ status: 'dead' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  it('reads waiting on a pending dialog, and outranks busy', () => {
    render(<SessionLine session={s({ status: 'busy', dialogPending: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.queryByText('working')).not.toBeInTheDocument();
  });

  it('shows the task tally, and hides it on a dead session', () => {
    const tasks = { done: 4, total: 7, running: 0, active: null };
    const { rerender } = render(
      <SessionLine session={s({ tasks })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('4/7')).toBeInTheDocument();
    rerender(<SessionLine session={s({ tasks, status: 'dead' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('4/7')).not.toBeInTheDocument();
  });

  it('renders the tally and warn cells even when empty — the grid needs them', () => {
    // A conditional cell makes every cell to its right slide, which is what
    // made 4/5 and 65/73 float mid-row.
    const { container } = render(
      <SessionLine session={s({ tasks: null, limits: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-tally')).toBeInTheDocument();
    expect(container.querySelector('.sess-tally')).toHaveTextContent('');
    expect(container.querySelector('.sess-warn')).toBeInTheDocument();
  });

  it('warns when a limit window is critical, but never on a dead session', () => {
    const limits = { five: 82, seven: 10 };
    const { rerender } = render(
      <SessionLine session={s({ limits })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('account limit near')).toBeInTheDocument();
    rerender(<SessionLine session={s({ limits, status: 'dead' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByLabelText('account limit near')).not.toBeInTheDocument();
  });

  // The 5h-critical case above never exercises the `seven` half of the `||` —
  // a mutation there (`seven > CRITICAL` -> `<`) would still leave this
  // green. Pin it with the 7d window as the ONLY one over threshold.
  it('warns when only the 7d window is critical', () => {
    render(<SessionLine session={s({ limits: { five: 10, seven: 82 } })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('account limit near')).toBeInTheDocument();
  });
});

describe('interaction', () => {
  it('opens the session on tap', async () => {
    const onOpen = vi.fn();
    render(<SessionLine session={s()} onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(screen.getByText('quiet-mesa'));
    expect(onOpen).toHaveBeenCalledWith('demo-quiet-mesa');
  });

  // THE untested invariant this restructure is most likely to break. The stamp
  // pairs the tapped label with the chat header (session/chat.css:61); without
  // it the card->chat shared-element animation silently stops working.
  it('stamps session-title on the tapped label for the view transition', async () => {
    render(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    const button = screen.getByText('quiet-mesa').closest('button')!;
    expect(button.style.viewTransitionName).toBe('');
    await userEvent.click(button);
    expect(button.style.viewTransitionName).toBe('session-title');
  });

  it('hands the session up when the actions button is pressed', async () => {
    const onActions = vi.fn();
    render(<SessionLine session={s()} onOpen={() => {}} onActions={onActions} />);
    await userEvent.click(screen.getByRole('button', { name: /actions for/i }));
    expect(onActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-quiet-mesa' }));
  });

  // Only one element may hold `view-transition-name: session-title` at a time
  // — a second aborts the transition entirely. These nodes are key-stable
  // across navigation and the stamp is never cleared on its own, so tapping a
  // second line has to release the first's stamp or two lines end up wearing
  // it (mobile: tap A -> back -> tap B).
  it('releases the previous stamp when a different line is tapped', async () => {
    render(
      <>
        <SessionLine session={s({ id: 'a', workspace: 'line-a' })}
                    onOpen={() => {}} onActions={() => {}} />
        <SessionLine session={s({ id: 'b', workspace: 'line-b' })}
                    onOpen={() => {}} onActions={() => {}} />
      </>,
    );
    const buttonA = screen.getByText('line-a').closest('button')!;
    const buttonB = screen.getByText('line-b').closest('button')!;

    await userEvent.click(buttonA);
    expect(buttonA.style.viewTransitionName).toBe('session-title');

    await userEvent.click(buttonB);
    expect(buttonA.style.viewTransitionName).toBe('');
    expect(buttonB.style.viewTransitionName).toBe('session-title');
  });
});

describe('away from home', () => {
  it('marks the account chip when the session is not on its pinned account', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).toHaveAttribute('data-away');
  });

  it('does not mark it when the session is home', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude', home: 'claude' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).not.toHaveAttribute('data-away');
  });

  it('says so for assistive tech, which cannot see a colour', () => {
    render(<SessionLine session={s({ wrapper: 'claude2', home: 'claude' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('running on alt·max, pinned to team·max')).toBeInTheDocument();
  });

  it('never marks a dead session — it is not running anywhere', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude', status: 'dead' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).not.toHaveAttribute('data-away');
  });
});
