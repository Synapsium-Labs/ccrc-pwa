// The compact row that replaces SessionCard in the fleet list.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { SessionLine } from '../src/fleet/SessionLine';
import { TEST_ROSTER } from './rosterFixture';

// vitest runs without globals, so RTL's auto-cleanup never registers itself
// (see test/message-links.test.tsx et al.) — without this, rerender/multi-render
// tests below leak DOM across `it` blocks.
afterEach(cleanup);

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null, title: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
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
    render(<SessionLine session={s({ status: 'dead', bucket: 'dead' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  it('reads waiting from the server bucket, not from status or dialogPending', () => {
    render(<SessionLine session={s({ status: 'busy', dialogPending: true, bucket: 'attention' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.queryByText('working')).not.toBeInTheDocument();
  });

  // Task 6: the defensive client-side OR of `hookState === 'waiting'` into
  // dialogPending is DELETED, not merely unused — SessionLine reads
  // `session.bucket` and nothing else. A session the server still calls
  // `idle` renders `idle`, even with a hook actively reporting `waiting`,
  // because the client no longer re-derives the bucket it was given.
  it('does not re-derive attention from hookState — only session.bucket decides', () => {
    render(<SessionLine session={s({ status: 'busy', dialogPending: false, hookState: 'waiting', bucket: 'idle' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('waiting')).not.toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('renders a check for done, distinct from idle', () => {
    render(<SessionLine session={s({ bucket: 'done' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'finished' })).toBeTruthy();
  });

  it('renders the cleanup bucket with its merge facts and no destructive control', () => {
    render(<SessionLine session={s({
      bucket: 'cleanup', archivedBytes: 1_200_000_000,
      pr: { phase: 'merged', number: 157 } as never,
    })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText(/#157/)).toBeTruthy();
    expect(screen.getByText(/1\.2 GB/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /remove|delete/i })).toBeNull();
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
                        onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText('running on team·alt, pinned to team·max')).toBeInTheDocument();
  });

  it('never marks a dead session — it is not running anywhere', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude', status: 'dead' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).not.toHaveAttribute('data-away');
  });
});

// Task 7: the passive `⑂ N` glyph became a disclosure — tap it to see WHICH
// subagents and for how long, rather than only how many.
describe('subagent disclosure', () => {
  it('renders a collapsed toggle with the count and a singular aria-label for one', () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: '1 subagent' });
    expect(toggle).toHaveTextContent('⑂ 1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('pluralizes the aria-label for more than one', () => {
    render(<SessionLine session={s({
      subagents: [{ name: 'a', startedAt: 1 , description: null }, { name: 'b', startedAt: 2 , description: null }],
    })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: '2 subagents' })).toHaveTextContent('⑂ 2');
  });

  it('renders no disclosure when subagents is null — no fresh hook data', () => {
    render(<SessionLine session={s({ subagents: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /subagent/ })).toBeNull();
  });

  // `[]` is a MEASUREMENT — fresh hook data, nothing running — and `null` is
  // no hook data. Both render nothing; neither is an error.
  it('shows no subagent disclosure when the hook reported an empty set', () => {
    render(<SessionLine session={s({ subagents: [] })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /subagent/ })).toBeNull();
  });

  it('expands the subagent tally into named rows with elapsed time', async () => {
    const now = Date.now();
    render(<SessionLine session={s({ bucket: 'working',
      subagents: [{ name: 'code-reviewer', startedAt: now - 65_000 , description: null }] })}
      onOpen={() => {}} onActions={() => {}} />);

    expect(screen.queryByText('code-reviewer')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('code-reviewer')).toBeTruthy();
    // EXACT, not /1m/: that regex also matches the '<1m' fallback, so it
    // cannot tell correct output from the off-by-one it exists to catch
    // (`m < 1` -> `m < 2` renders '<1m' here and passes a /1m/ match).
    expect(screen.getByText('1m')).toBeTruthy();
    expect(screen.getByRole('button', { name: /1 subagent/ })).toHaveAttribute('aria-expanded', 'true');
  });

  // The toggle is a REAL <button>: fix round 1 shipped a `role="button"` span
  // with tabIndex nested inside `.sess-open`, which is invalid (a <button>'s
  // content model forbids any descendant carrying tabindex) and, worse,
  // flattened away by the button role's children-presentational rule — under
  // VoiceOver the whole row is one element and the disclosure is unreachable.
  // getByRole cannot see that, so these assert the DOM shape directly.
  it('is a real <button>, not a control nested inside another control', () => {
    const { container } = render(
      <SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
                   onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: '1 subagent' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).not.toHaveAttribute('tabindex');
    // No ancestor of ANY control on this row is itself a control.
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.parentElement?.closest('button')).toBeNull();
    }
  });

  // aria-expanded has to be about something a screen reader can be taken to —
  // the repo's own OptionPreview (DialogSheet.tsx) pairs useId + aria-controls
  // for exactly this. Round 1 had neither, and the list was not even a DOM
  // sibling of the toggle.
  it('points aria-controls at the list it opens', async () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: '1 subagent' });
    await userEvent.click(toggle);
    const id = toggle.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    const list = document.getElementById(id!);
    expect(list).not.toBeNull();
    expect(list).toHaveClass('sess-subagent-list');
    expect(list!.contains(screen.getByText('reviewer'))).toBe(true);
  });

  // …and NOT while it is closed. The <ul> is conditionally rendered, so a
  // constant `aria-controls` was an IDREF resolving to nothing in exactly the
  // state a user would follow it from — the collapsed row. `aria-expanded`
  // carries the whole contract there.
  it('carries no aria-controls while the list it would name does not exist', () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: '1 subagent' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(document.querySelector('.sess-subagent-list')).toBeNull();
  });

  // Keyboard activation was the one part of round 1 with zero coverage, and
  // it was hand-rolled (`e.key !== 'Enter' && e.key !== ' '`) precisely
  // because the element was not a button. It is a button now, so activation
  // is native — and the click it dispatches bubbles into `.sess-body`'s
  // forwarder exactly as a tap does, which is what this also pins: pressing
  // Enter must toggle the disclosure and NOT navigate to the session.
  it('toggles on Enter and on Space, without opening the session', async () => {
    const onOpen = vi.fn();
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
                        onOpen={onOpen} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: '1 subagent' });
    toggle.focus();

    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard(' ');
    expect(screen.queryByText('reviewer')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('lists every subagent, not just the first', async () => {
    const now = Date.now();
    render(<SessionLine session={s({
      subagents: [
        { name: 'code-reviewer', startedAt: now - 65_000 , description: null },
        { name: 'test-runner', startedAt: now - 5_000 , description: null },
      ],
    })} onOpen={() => {}} onActions={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /2 subagents/ }));
    expect(screen.getByText('code-reviewer')).toBeInTheDocument();
    expect(screen.getByText('test-runner')).toBeInTheDocument();
  });

  // No invented state: Claude's SubagentStart/Stop hooks give a name and a
  // start time and nothing else, so an Orca-style working/blocked glyph
  // would be a claim this row cannot source — a row is exactly two children,
  // the name and the elapsed time, never a third.
  //
  // THAT RULING SURVIVES THE LAUNCH-RECORD JOIN, and this pin is the proof.
  // What changed is what the FIRST cell says, not how many cells there are:
  // per-subagent STATE is still unsourceable (the launch record has no status
  // field and SubagentStart carries only `{agent_id, agent_type}`), so it
  // still gets no glyph. A description is a fact Claude Code wrote down; a
  // state would be one we invented.
  it('says what the subagent is DOING, not just its type', async () => {
    // `name` is the hook's `.agent_name // .subagent_name // .agent_type`
    // ladder and the first two keys are not in the shipped schema — so it is
    // ALWAYS the agent type. Measured live: five concurrent rows all reading
    // `workflow-subagent`, a count wearing a name. The description comes from
    // the launch record Claude Code already wrote, joined on `agent_id`.
    render(<SessionLine session={s({ subagents: [
      { name: 'workflow-subagent', startedAt: Date.now(), description: 'Judge offline evidence blind' },
      { name: 'workflow-subagent', startedAt: Date.now(), description: 'Inventory the provider' },
    ] })} onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /2 subagents/ }));
    expect(screen.getByText('Judge offline evidence blind')).toBeInTheDocument();
    expect(screen.getByText('Inventory the provider')).toBeInTheDocument();
    // The type no longer occupies the cell — it moved to the tooltip.
    expect(screen.queryByText('workflow-subagent')).toBeNull();
  });

  it('falls back to the type when the join found nothing', async () => {
    // Null description = an older hook with no id to join on, or a record that
    // did not read. Byte-identical to what this row has always shown, which is
    // what makes the whole feature safe to ship before the join is proven.
    render(<SessionLine session={s({ subagents: [
      { name: 'reviewer', startedAt: Date.now(), description: null },
    ] })} onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('reviewer')).toBeInTheDocument();
  });

  it('keeps both facts in the tooltip when both exist', async () => {
    // The type is still worth having — it is just not worth the cell.
    render(<SessionLine session={s({ subagents: [
      { name: 'Explore', startedAt: Date.now(), description: 'Map the auth seam' },
    ] })} onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('Map the auth seam').getAttribute('title'))
      .toBe('Explore — Map the auth seam');
  });

  it('shows no invented state — a name and an elapsed time, nothing else', async () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: Date.now() , description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    const row = screen.getByText('reviewer').closest('.sess-subagent-row')!;
    expect(row.children).toHaveLength(2);
  });

  // `.sess-body` (the block the row's tap surface now lives on) forwards a
  // click to `open()` only when no real control was hit — drop its
  // `closest('button')` guard and tapping the toggle navigates away instead
  // of expanding.
  it('does not open the session when the toggle is tapped', async () => {
    const onOpen = vi.fn();
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: Date.now() , description: null }] })}
                        onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  // The other half of that guard: the dead space between meta cells still
  // opens the session, so the row did not lose its full-block tap surface
  // when the wrapping <button> became a <div>.
  it('still opens the session from the dead space around the meta cells', async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
                   onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(container.querySelector('.sess-meta')!);
    expect(onOpen).toHaveBeenCalledWith('demo-quiet-mesa');
  });

  // …and the list itself is not dead space. It renders INSIDE .sess-body, so
  // the forwarder used to navigate for any tap on it: the operator opened the
  // disclosure, reached for a name, and lost the fleet screen. A truncated
  // name also had no way to be read — you could not even select it.
  it('does not open the session when a subagent row is tapped', async () => {
    const onOpen = vi.fn();
    render(<SessionLine session={s({ subagents: [{ name: 'code-reviewer', startedAt: Date.now() , description: null }] })}
                        onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    onOpen.mockClear();

    await userEvent.click(screen.getByText('code-reviewer'));
    await userEvent.click(document.querySelector('.sess-subagent-row')!);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('carries the full name in a title, since the row ellipsises it', async () => {
    render(<SessionLine session={s({ subagents: [{ name: 'a-very-long-subagent-name', startedAt: 1 , description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('a-very-long-subagent-name'))
      .toHaveAttribute('title', 'a-very-long-subagent-name');
  });

  it('collapses again on a second tap', async () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: Date.now() , description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: /1 subagent/ });
    await userEvent.click(toggle);
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText('reviewer')).toBeNull();
  });

  it('never shows the disclosure on a dead session, even with stale hook data', () => {
    render(<SessionLine session={s({ status: 'dead', bucket: 'dead',
      subagents: [{ name: 'reviewer', startedAt: 1 , description: null }] })}
      onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /subagent/ })).toBeNull();
  });
});

// The elapsed cell is the row's only COMPUTED value, and the brief's own
// assertion for it (`getByText(/1m/)`) matches the '<1m' fallback as well as
// '1m' — it could not fail on the off-by-one it existed to catch. Every
// branch of `subagentElapsed` gets an exact expected string here instead.
describe('subagent elapsed time', () => {
  /** Render one subagent started `ageMs` ago, expand, return its elapsed cell. */
  const elapsedFor = async (startedAt: number): Promise<string> => {
    cleanup();
    render(<SessionLine session={s({ subagents: [{ name: 'sub', startedAt, description: null }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    return document.querySelector('.sess-subagent-elapsed')!.textContent!;
  };
  const agedMs = (ms: number): Promise<string> => elapsedFor(Date.now() - ms);

  it('reads <1m below a minute, and never rounds up into it', async () => {
    expect(await agedMs(5_000)).toBe('<1m');
    // 59s, not 59_999ms: `agedMs` reads the clock, the component reads it
    // again a few ms later, so a boundary-exact age is a flaky one.
    expect(await agedMs(59_000)).toBe('<1m');
  });

  it('reads whole minutes from exactly one minute up', async () => {
    expect(await agedMs(60_000)).toBe('1m');
    expect(await agedMs(65_000)).toBe('1m');
    expect(await agedMs(59 * 60_000)).toBe('59m');
  });

  it('switches to hours at 60 minutes', async () => {
    expect(await agedMs(60 * 60_000)).toBe('1h');
    expect(await agedMs(90 * 60_000)).toBe('1h');
    expect(await agedMs(23 * 60 * 60_000)).toBe('23h');
  });

  it('switches to days at 24 hours', async () => {
    expect(await agedMs(24 * 60 * 60_000)).toBe('1d');
    expect(await agedMs(49 * 60 * 60_000)).toBe('2d');
  });

  // `startedAt: 1` is the placeholder four other tests in this file pass and
  // none of them assert. It is 1ms after the epoch, so the only correct
  // rendering is a four-figure number of DAYS — an 'h' or 'm' here would mean
  // the unit ladder stopped climbing.
  it('renders the epoch placeholder the other tests pass as days', async () => {
    expect(await elapsedFor(1)).toMatch(/^\d{4,}d$/);
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

describe('held chip', () => {
  it('shows the held chip with the reason verbatim', () => {
    render(<SessionLine session={s({ held: 'program:agent-evals wave:2/4' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('program:agent-evals wave:2/4')).toBeInTheDocument();
  });

  it('shows no chip when unheld — null is the wire default, not a state to render', () => {
    render(<SessionLine session={s({ held: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/program:/)).toBeNull();
    expect(document.querySelector('[data-held]')).toBeNull();
  });

  it('marks the chip data-held for tests, and carries the full reason as a title', () => {
    render(<SessionLine session={s({ held: 'program:x wave:2/4' })}
                        onOpen={() => {}} onActions={() => {}} />);
    const chip = document.querySelector('[data-held]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('title', 'program:x wave:2/4');
  });
});

// Registry ladder (Task 2): a degraded row's small, honest note — the
// `PrKeycap` grey+reason idiom, never a new banner. Same `data-*`/`title`
// pattern as the held chip above.
describe('degraded (unmeasured identity) note', () => {
  it('shows no note on a fully-measured row — the wire default, not a state to render', () => {
    render(<SessionLine session={s({ unmeasured: [] })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('unreadable')).toBeNull();
    expect(document.querySelector('[data-unmeasured]')).toBeNull();
  });

  it('shows the note when the row carries an unmeasured identity field', () => {
    render(<SessionLine session={s({ unmeasured: ['uuid'] })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('unreadable')).toBeInTheDocument();
  });

  it('marks the note data-unmeasured for tests, and carries which field(s) as a title', () => {
    render(<SessionLine session={s({ unmeasured: ['wrapper', 'workdir'] })} onOpen={() => {}} onActions={() => {}} />);
    const note = document.querySelector('[data-unmeasured]');
    expect(note).not.toBeNull();
    expect(note).toHaveAttribute('title', 'registry wrapper/workdir temporarily unreadable — retrying');
  });

  it('a degraded row still renders its OTHER fields normally — this is a note, not a takeover of the row', () => {
    render(<SessionLine session={s({ unmeasured: ['uuid'], held: 'program:x wave:1/4' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('unreadable')).toBeInTheDocument();
    expect(screen.getByText('program:x wave:1/4')).toBeInTheDocument();
  });

  // Blocking review finding 2: a LIVE `fleet` frame is cast, not revived
  // (`stores/fleet.ts`'s `asFleetMsg`), so a row from a server that predates
  // this field can lack the `unmeasured` KEY entirely at runtime, even though
  // `FleetSession` types it required — `s({unmeasured: []})` above cannot
  // catch this, it always sets the key. Simulated the same way, via `delete`
  // on a plain object cast back to `FleetSession` — the whole point is that
  // this is not a shape `s()`'s own literal can produce.
  it('does not throw, and shows no note, on a row that omits `unmeasured` entirely (an older server)', () => {
    const raw = s({ unmeasured: ['uuid'] }) as unknown as Record<string, unknown>;
    delete raw['unmeasured'];
    expect(() => render(
      <SessionLine session={raw as unknown as FleetSession} onOpen={() => {}} onActions={() => {}} />,
    )).not.toThrow();
    expect(screen.queryByText('unreadable')).toBeNull();
    expect(document.querySelector('[data-unmeasured]')).toBeNull();
  });
});

// The supervisor's standing substrate fault (spec §4) — the console cannot
// see this session, and the row says so. Same `data-*`/`title` pattern as the
// held chip and the unmeasured note above: generic words on the cell, the
// verbatim reason in `title`, never parsed.
describe('substrate chip — the console cannot see this session, and says so (spec §4)', () => {
  it('shows no chip when substrate is null — the wire default, not a state to render', () => {
    render(<SessionLine session={s({ substrate: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('unreachable tmux')).toBeNull();
    expect(document.querySelector('[data-substrate]')).toBeNull();
  });

  it('shows the chip with the verbatim reason in title, dated by the marker stamp', () => {
    render(<SessionLine session={s({ substrate: { at: 1755620112000, text: 'protocol version mismatch' } })}
                        onOpen={() => {}} onActions={() => {}} />);
    const chip = screen.getByText('unreachable tmux');
    expect(chip).toHaveClass('sess-substrate');
    expect(chip.getAttribute('title')).toContain('protocol version mismatch');
    expect(chip.getAttribute('title')).toMatch(/tmux unreachable since/);
  });

  // The live `fleet` frame is cast, not revived (`stores/fleet.ts`'s
  // `asFleetMsg`), so a row from a server that predates this field can lack
  // the KEY entirely at runtime — `s({substrate: null})` above cannot catch
  // this, it always sets the key. Simulated via `delete` on a plain object
  // cast back to `FleetSession`, the `unmeasured` block's own idiom: the
  // whole point is that this is not a shape `s()`'s literal can produce.
  // This is also the test that pins the read going through `substrateFault`
  // (shared/api.ts) rather than `session.substrate` directly.
  it('does not throw, and shows no chip, on a row that omits `substrate` entirely (an older server)', () => {
    const raw = s({ substrate: { at: 1, text: 'x' } }) as unknown as Record<string, unknown>;
    delete raw['substrate'];
    expect(() => render(
      <SessionLine session={raw as unknown as FleetSession} onOpen={() => {}} onActions={() => {}} />,
    )).not.toThrow();
    expect(screen.queryByText('unreachable tmux')).toBeNull();
    expect(document.querySelector('[data-substrate]')).toBeNull();
  });

  it('at === 0 (unreadable marker) renders the reason without a fabricated 1970 timestamp', () => {
    // `at: 0` is the registry's "marker listed but unreadable" degrade — the
    // fault is real, its date is not. A `since` clause built from epoch 0
    // would claim tmux has been unreachable since 1970.
    render(<SessionLine session={s({ substrate: { at: 0, text: 'the marker would not read' } })}
                        onOpen={() => {}} onActions={() => {}} />);
    const chip = screen.getByText('unreachable tmux');
    expect(chip.getAttribute('title')).toContain('the marker would not read');
    expect(chip.getAttribute('title')).not.toContain('since');
  });
});

// `WORD` was exported "so FleetScreen's bucket-section headers use the
// identical words" — FleetScreen imports nothing from this file and renders
// its own SECTION_LABEL ('Attention'/'Cleanup'/'Dead'), so the export had zero
// importers and the comment pointed a maintainer retitling a HEADING at the
// table that spells every ROW's word. Checked by reading, the way
// seen.test.ts checks its own rationale block.
describe('the row\'s state vocabulary', () => {
  const srcDir = path.join(import.meta.dirname, '..', 'src');
  const src = readFileSync(path.join(srcDir, 'fleet', 'SessionLine.tsx'), 'utf8');
  const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*(?:export )?const WORD/
    .exec(src)![1]!
    .replace(/^[ \t]*\*[ \t]?/gm, '')
    .replace(/\s+/g, ' ');

  /** Every .ts/.tsx under src that imports the name WORD from this module. */
  const importers = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      if (!/\.tsx?$/.test(e.name)) return [];
      const text = readFileSync(full, 'utf8');
      return /import\s*\{[^}]*\bWORD\b[^}]*\}\s*from\s*['"][^'"]*SessionLine['"]/.test(text)
        ? [path.relative(srcDir, full)]
        : [];
    });
  })(srcDir);

  it('is private, because nothing outside this file reads it', () => {
    expect(importers).toEqual([]);
    expect(src).not.toMatch(/export\s+const\s+WORD\b/);
  });

  it('does not name the fleet screen\'s section headings as its consumer', () => {
    // They are a different vocabulary on purpose — 'Cleanup' the heading vs
    // `merged` the row word — and FleetScreen does not import this file.
    expect(doc).not.toMatch(/identical words/i);
    expect(doc).not.toMatch(/bucket-section headers/i);
    expect(readFileSync(path.join(srcDir, 'screens', 'FleetScreen.tsx'), 'utf8'))
      .not.toMatch(/from '\.\.\/fleet\/SessionLine'/);
  });
});

describe('the spawn chip (§1.6b)', () => {
  const chip = () => document.querySelector('.sess-spawn');

  it('renders NOTHING for the overwhelmingly common shape: no stamp, claimed', () => {
    // THE FALSE-POSITIVE DIRECTION, and the reason the rule is not "chip on
    // anything not ready": `null` satisfies "not ready", and all 18 live sessions
    // carry `null` because they have not spawned since PR #50 shipped the field.
    render(<SessionLine session={s({ spawnState: null, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).toBeNull();
  });

  it('renders `unstarted` for swift-harbor\'s exact shape — no stamp, no claim', () => {
    render(<SessionLine session={s({ spawnState: null, started: false })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()?.textContent).toBe('unstarted');
    expect(chip()?.getAttribute('data-spawn')).toBe('unstarted');
  });

  it('says nothing for a clean spawn — a member whose WORD is null, not a missing member', () => {
    // The two are different facts and the lookup has to ask which. `SPAWN_WORD`
    // is typed `string | null` so a member can be deliberately silent (`ready`
    // is today's only one, and its docstring says why); a `?? unnameableVerdict`
    // fallback fires on BOTH that and a member this bundle has no row for, so
    // the next silent member would render `? <token>` — the very collapse §1.7
    // undid one level up. `ready` reaching the table at all is the pin: with
    // the presence check gone it renders `? ready`.
    render(<SessionLine session={s({ spawnState: 'ready', started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).toBeNull();
  });

  it.each([
    ['blocked', 'blocked'], ['login', 'login'], ['vanished', 'vanished'],
    ['expired', 'unconfirmed'], ['unrecognised', 'unknown'],
  ] as const)('renders %s as %s', (state, word) => {
    render(<SessionLine session={s({ spawnState: state, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()?.textContent).toBe(word);
    expect(chip()?.getAttribute('data-spawn')).toBe(state);
  });

  // §1.7. THE VERDICT THIS BUILD HAS NO ROW FOR. `stores/fleet.ts`'s `asFleetMsg`
  // validates FRAMES, not members, so the live path CASTS `FleetSession` — a
  // server one deploy ahead can put a `SpawnVerdict` member in this field that
  // this bundle's `SPAWN_WORD` was compiled without. The server/PWA deploy lanes
  // are separate scripts with no version handshake between them, so the window is
  // real, not theoretical.
  //
  // The old `SPAWN_WORD[spawnState] ?? null` turned that into NO CHIP — byte for
  // byte the healthy row. A verdict the operator was meant to see disappeared
  // BECAUSE it was new, which is the failure mode the whole increment is about:
  // a value this build cannot NAME must be shown as itself, never as a member it
  // is not, and least of all as silence.
  it('shows an UNNAMEABLE verdict as itself — a newer server must not render as healthy', () => {
    render(<SessionLine session={s({ spawnState: 'proxy-refused' as never, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).not.toBeNull();
    expect(chip()?.textContent).toBe('? proxy-refused');
    // And NOT filed under `unrecognised`, which is a real member meaning
    // something else — ccd recorded an rc THE SERVER could not name. This is one
    // layer further out: the server named it fine and the CLIENT cannot.
    expect(chip()?.getAttribute('data-spawn')).toBe('proxy-refused');
  });

  it('truncates an unnameable verdict rather than let the wire size a cell', () => {
    // The token is untrusted text off the socket. React escapes it, so this is
    // about LAYOUT, not injection: `.sess-spawn` is `flex: none` and would take
    // whatever length it is given, squeezing `.sess-held` — the one shrinkable
    // cell — out of the row.
    render(<SessionLine session={s({ spawnState: 'z'.repeat(200) as never, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()?.textContent?.length).toBeLessThanOrEqual(20);
  });

  it('a non-string verdict is still a visible chip, never a crash and never silence', () => {
    // Cast, not revived: the field's runtime type is whatever arrived.
    render(<SessionLine session={s({ spawnState: 42 as never, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()?.textContent).toBe('? unnameable');
  });

  it('never renders a chip on a dead row — the exemption critical/subagentList already take', () => {
    render(<SessionLine session={s({ status: 'dead', bucket: 'dead', spawnState: 'blocked', started: false })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).toBeNull();
  });

  it('renders ONE chip, never two — a failed spawn and an absent claim are one cell', () => {
    render(<SessionLine session={s({ spawnState: 'expired', started: false })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelectorAll('.sess-spawn')).toHaveLength(1);
    expect(chip()?.textContent).toBe('unconfirmed');
  });

  it('sits at position 2, immediately after .sess-state', () => {
    // `.sess-meta` has NO flex-wrap and NO `order`: DOM order IS visual order.
    render(<SessionLine session={s({ spawnState: 'blocked', started: true, held: 'program:x wave:2/4' })}
                        onOpen={() => {}} onActions={() => {}} />);
    const cells = [...(document.querySelector('.sess-meta')?.children ?? [])];
    expect(cells[0]?.className).toContain('sess-state');
    expect(cells[1]?.className).toContain('sess-spawn');
  });

  it('does not clip the hold reason away — .sess-held is the one shrinkable cell', () => {
    // §2.4 LENGTHENS the hold reason (` run:<id>`) in the same build, and
    // `.sess-held` is the only cell with `overflow: hidden`/`text-overflow:
    // ellipsis` and no `flex: none`. The two changes compound: a new cell that
    // is not `flex: none` steals room from it first.
    render(<SessionLine session={s({ spawnState: 'blocked', started: true, held: 'program:build8 wave:2/4 run:17' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-held')?.textContent).toBe('program:build8 wave:2/4 run:17');
  });

  it('reads both fields DEFENSIVELY — a live `fleet` frame is CAST, never revived', () => {
    // `stores/fleet.ts`'s `asFleetMsg` validates frames, not MEMBERS, so a row
    // from a server that predates these fields lacks the keys at RUNTIME even
    // though `FleetSession` types them as present. Same reason `unmeasuredFields`
    // exists — the last time this was skipped a TypeError took the renderer down.
    const legacy = { ...s() } as Record<string, unknown>;
    delete legacy['spawnState'];
    delete legacy['started'];
    expect(() =>
      render(<SessionLine session={legacy as unknown as FleetSession}
                          onOpen={() => {}} onActions={() => {}} />)).not.toThrow();
    expect(chip()).toBeNull();
  });
});

// ── Task 5: the hold reason becomes a door ─────────────────────────────────
//
// The cell has said `program:<slug> wave:N/M run:<id>` since Wave 2 and has
// been unreachable text the whole time: the operator reads that a programme
// owns this workspace and then has to find /runs by hand from the fleet
// footer. The DECISION about whether there is anywhere to go is the CALLER's
// (`ProjectCard`, which holds this project's active runs) — this component
// only renders the two forms, and `onOpenRun === null` is the one that has to
// stay byte-identical to what shipped.
describe('the held cell is a door only when there is somewhere to go (Task 5)', () => {
  const heldOf = (): HTMLElement | null => document.querySelector('.sess-held');

  it('is inert text with no handler — exactly the cell that shipped', () => {
    render(<SessionLine session={s({ held: 'program:x wave:2/4' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(heldOf()?.tagName).toBe('SPAN');
    expect(document.querySelector('button.sess-held')).toBeNull();
  });

  it('is a real button when the caller hands it a run to open', () => {
    render(<SessionLine session={s({ held: 'program:x wave:2/4' })} onOpenRun={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(heldOf()?.tagName).toBe('BUTTON');
  });

  it('renders the SAME text and title in both forms — the door changes the element, not the fact', () => {
    // The reason string is the display (`shared/api.ts`'s `FleetSession.held`):
    // verbatim, never parsed, `title` carrying the full text past the cell's
    // own ellipsis. A door that also reworded the cell would be two changes
    // wearing one commit.
    const held = 'program:build9b wave:1/3 run:10';
    const inert = render(<SessionLine session={s({ held })} onOpen={() => {}} onActions={() => {}} />);
    const before = inert.container.querySelector('.sess-held');
    const text = before?.textContent;
    const title = before?.getAttribute('title');
    cleanup();
    render(<SessionLine session={s({ held })} onOpenRun={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(heldOf()?.textContent).toBe(text);
    expect(heldOf()).toHaveAttribute('title', title!);
    expect(heldOf()).toHaveAttribute('data-held', 'true');
  });

  it('opens the run and NOT the session — the row’s own tap must not fire underneath it', async () => {
    // `.sess-body`'s click forwarder stands down on `closest('button')`, which
    // is why this cell had to become a real `<button>` rather than a span with
    // a handler: the forwarder is what would otherwise navigate to the session
    // on the same tap, and the operator would land somewhere they did not ask
    // for roughly half the time.
    const onOpenRun = vi.fn();
    const onOpen = vi.fn();
    render(<SessionLine session={s({ held: 'program:x wave:2/4' })} onOpenRun={onOpenRun}
                        onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(heldOf()!);
    expect(onOpenRun).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders no cell at all for an unheld session, whatever the caller passes', () => {
    // The run only decides whether the cell is a DOOR. Whether there is a cell
    // at all is still `held !== null`, and a session nobody has claimed has
    // nothing to say here.
    render(<SessionLine session={s({ held: null })} onOpenRun={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(heldOf()).toBeNull();
  });
});
