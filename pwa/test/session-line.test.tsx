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
  tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, ...over,
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

  // The server already ORs a fresh hookState === 'waiting' into dialogPending
  // (fleet.ts), so this pins the DEFENSIVE client-side OR: hookState alone,
  // with dialogPending false, still renders the attention treatment.
  it('reads waiting from hookState alone, even when dialogPending is false', () => {
    render(<SessionLine session={s({ status: 'busy', dialogPending: false, hookState: 'waiting' })}
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

  it('omits the tally and warn cells entirely when there is nothing to show', () => {
    // .sess-meta is a flex row now, not a grid track — a missing sibling
    // cannot shift anything, so the always-rendered-but-empty placeholder
    // that a grid layout needed is dead weight here. Restored to a plain
    // conditional render.
    const { container } = render(
      <SessionLine session={s({ tasks: null, limits: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-tally')).not.toBeInTheDocument();
    expect(container.querySelector('.sess-warn')).not.toBeInTheDocument();
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

describe('the selected row', () => {
  it('announces itself to assistive tech, not just to the stylesheet', () => {
    // Selection reached nothing but a className before this — there is no
    // other aria-current in src. The row navigates to /s/<id>, so `page` is
    // the correct token; this is not a listbox option.
    const { rerender } = render(
      <SessionLine session={s()} selected onOpen={() => {}} onActions={() => {}} />);
    const button = screen.getByText('quiet-mesa').closest('button')!;
    expect(button).toHaveAttribute('aria-current', 'page');
    rerender(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    expect(button).not.toHaveAttribute('aria-current');
  });

  it('DROPS the inline account hue rather than overriding it', () => {
    // Inline styles beat every selector short of !important, so
    // .sess-line--active's achromatic override could never win against this
    // one — and the hue measures 1.46:1 on the dark slab. The account
    // survives as its mono name. Fails the moment acctStyle goes back to a
    // plain CSSProperties.
    const { container, rerender } = render(
      <SessionLine session={s()} selected onOpen={() => {}} onActions={() => {}} />);
    const acct = container.querySelector<HTMLElement>('.sess-acct')!;
    expect(acct.style.color).toBe('');
    rerender(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector<HTMLElement>('.sess-acct')!.style.color).not.toBe('');
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

describe('subagent chip', () => {
  it('renders a chip with the count and a singular aria-label for one', () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const chip = screen.getByLabelText('1 subagent');
    expect(chip).toHaveTextContent('⑂ 1');
  });

  it('pluralizes the aria-label for more than one', () => {
    render(<SessionLine session={s({
      subagents: [{ name: 'a', startedAt: 1 }, { name: 'b', startedAt: 2 }],
    })} onOpen={() => {}} onActions={() => {}} />);
    const chip = screen.getByLabelText('2 subagents');
    expect(chip).toHaveTextContent('⑂ 2');
  });

  it('renders nothing when subagents is null', () => {
    const { container } = render(
      <SessionLine session={s({ subagents: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-subagents')).not.toBeInTheDocument();
  });

  it('renders nothing when subagents is empty', () => {
    const { container } = render(
      <SessionLine session={s({ subagents: [] })} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-subagents')).not.toBeInTheDocument();
  });
});

describe('ask summary', () => {
  it('shows the muted ask line when waiting and a summary is present', () => {
    render(<SessionLine session={s({ hookState: 'waiting', askSummary: 'Deploy now?' })}
                        onOpen={() => {}} onActions={() => {}} />);
    const line = screen.getByText('Deploy now?');
    expect(line).toHaveClass('sess-ask');
  });

  it('is absent when waiting but no summary has landed yet', () => {
    const { container } = render(
      <SessionLine session={s({ hookState: 'waiting', askSummary: null })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-ask')).not.toBeInTheDocument();
  });

  it('is absent when a summary exists but the hook is not waiting', () => {
    const { container } = render(
      <SessionLine session={s({ hookState: 'working', askSummary: 'Deploy now?' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-ask')).not.toBeInTheDocument();
  });
});
