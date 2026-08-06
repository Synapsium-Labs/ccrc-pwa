// The compact row that replaces SessionCard in the fleet list.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

// Task 7: the passive `⑂ N` glyph became a disclosure — tap it to see WHICH
// subagents and for how long, rather than only how many.
describe('subagent disclosure', () => {
  it('renders a collapsed toggle with the count and a singular aria-label for one', () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: 1 }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: '1 subagent' });
    expect(toggle).toHaveTextContent('⑂ 1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('pluralizes the aria-label for more than one', () => {
    render(<SessionLine session={s({
      subagents: [{ name: 'a', startedAt: 1 }, { name: 'b', startedAt: 2 }],
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
      subagents: [{ name: 'code-reviewer', startedAt: now - 65_000 }] })}
      onOpen={() => {}} onActions={() => {}} />);

    expect(screen.queryByText('code-reviewer')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('code-reviewer')).toBeTruthy();
    expect(screen.getByText(/1m/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /1 subagent/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists every subagent, not just the first', async () => {
    const now = Date.now();
    render(<SessionLine session={s({
      subagents: [
        { name: 'code-reviewer', startedAt: now - 65_000 },
        { name: 'test-runner', startedAt: now - 5_000 },
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
  it('shows no invented state — a name and an elapsed time, nothing else', async () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: Date.now() }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    const row = screen.getByText('reviewer').closest('.sess-subagent-row')!;
    expect(row.children).toHaveLength(2);
  });

  // The toggle is nested inside `.sess-open` (this row's own tap target) as
  // a `role="button"` span, not a real `<button>` — a `<button>` cannot
  // contain another one. Without `stopPropagation` a tap here would bubble
  // into `.sess-open`'s own `onClick` and navigate to the session too.
  it('does not open the session when the toggle is tapped', async () => {
    const onOpen = vi.fn();
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: Date.now() }] })}
                        onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('collapses again on a second tap', async () => {
    render(<SessionLine session={s({ subagents: [{ name: 'reviewer', startedAt: Date.now() }] })}
                        onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: /1 subagent/ });
    await userEvent.click(toggle);
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText('reviewer')).toBeNull();
  });

  it('never shows the disclosure on a dead session, even with stale hook data', () => {
    render(<SessionLine session={s({ status: 'dead', bucket: 'dead',
      subagents: [{ name: 'reviewer', startedAt: 1 }] })}
      onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /subagent/ })).toBeNull();
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
