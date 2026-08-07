// A card is always a project; a line is always a session. No bare path.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { groupFleet, type FleetGroup } from '../src/fleet/groupFleet';
import { ProjectCard } from '../src/fleet/ProjectCard';

// vitest runs without globals, so RTL's auto-cleanup never registers itself —
// without this, rerender/multi-render tests below leak DOM across `it` blocks.
afterEach(cleanup);

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'quiet-mesa', name: null, status: 'idle',
  statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, ...over,
});

const grp = (over: Partial<FleetGroup> = {}): FleetGroup => ({
  project: 'demo', sessions: [sess()], attention: false, busy: 0, unseen: 0, pin: 'claude', archived: [], ...over,
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
  // surface. The header wears the group's urgency either way. Two sessions,
  // not one — the count itself only renders at 2+ (see 'session count' below).
  it('keeps the count and the attention dot while collapsed', () => {
    const g = grp({
      attention: true,
      sessions: [sess({ dialogPending: true }), sess({ id: 'demo-still-cove', workspace: 'still-cove' })],
    });
    render(<ProjectCard group={g} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
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
  // account and headroom now live only in the accessible name (see 'the + is
  // icon-only' below), but a second account/score pair here still guards
  // against the aria-label format regressing unnoticed.
  it('carries the account into the accessible name, not just the pixels', () => {
    render(<ProjectCard group={grp()} projected={{ wrapper: 'claude', score: 18 }}
                        onAddWorkspace={() => {}} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /New workspace on demo — team·max, 82% free/i }))
      .toBeInTheDocument();
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

describe('the + is icon-only', () => {
  const projected = { wrapper: 'claude2', score: 9 };

  it('renders no visible projection text in the header', () => {
    const { container } = render(
      <ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                   onAddWorkspace={() => {}} projected={projected} />);
    // Structural, not CSS: the element is gone, not hidden.
    expect(container.querySelector('.proj-add-acct')).toBeNull();
    expect(screen.queryByText(/% free/)).not.toBeInTheDocument();
  });

  it('keeps the account and headroom in the accessible name', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByLabelText('New workspace on demo — alt·max, 91% free'))
      .toBeInTheDocument();
  });

  it('carries them as a tooltip too, for a pointer that can hover', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByLabelText(/New workspace on demo/))
      .toHaveAttribute('title', 'New workspace on demo — alt·max, 91% free');
  });

  it('falls back to the plain name before the accounts poll lands', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={null} />);
    expect(screen.getByLabelText('New workspace on demo')).toBeInTheDocument();
  });
});

describe('status owns the perimeter only for attention', () => {
  it('never puts busy on the card border', () => {
    // On a one-session project (9 of 9 live) `group.busy > 0` is the same
    // predicate the row already renders three times — the lamp's hue, its
    // glow + breathe, and the word `working` — and green on a frame was being
    // read as "this is the project I have selected".
    const { container } = render(
      <ProjectCard group={grp({ busy: 1, sessions: [sess({ status: 'busy', bucket: 'working' })] })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card')).not.toHaveClass('proj-card--busy');
  });

  it('still puts attention on it', () => {
    // Control — green before and after. Attention is the one status that asks
    // the reader to ACT, and with green gone it is the only coloured
    // perimeter left, so it reads as an exception rather than as wallpaper.
    const { container } = render(
      <ProjectCard group={grp({ attention: true, sessions: [sess({ dialogPending: true, bucket: 'attention' })] })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card')).toHaveClass('proj-card--attention');
  });

  it('says what is running inside a folded card as a WORD, not a second dot', () => {
    // A green ● beside the amber ● would separate the two most opposite
    // meanings on this screen by hue alone, at 1.06:1 luminance, with no
    // tempo and no word. ATTENTION IS A MARK, BUSY IS A WORD.
    render(
      <ProjectCard collapsed
                   group={grp({ busy: 2, sessions: [
                     sess({ status: 'busy', bucket: 'working' }),
                     sess({ id: 'demo-still-cove', workspace: 'still-cove', status: 'busy', bucket: 'working' }),
                   ] })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2 working')).toBeInTheDocument();
    // A dot would also duplicate StatusDot's own role=img/"working" name.
    expect(screen.queryByRole('img', { name: /working/ })).toBeNull();
  });

  // These two build the group with the REAL groupFleet rather than the `grp`
  // literal, over sessions whose `bucket` the fixture sets directly (as the
  // server would). Folded and expanded are asserted in one `it` each, because
  // the invariant IS agreement between them.
  it('does not say working over a single row that says waiting', () => {
    // Before Task 6, `group.busy` counted `status === 'busy'` while
    // SessionLine ranked attention first (`busy = !attention && status ===
    // 'busy'`) — TWO derivations of the same fact, kept in sync by a comment.
    // One busy session with a pending dialog could render `▸ demo … ●
    // working` folded and `waiting` expanded: the amber "act now" mark and
    // the word "working" describing the SAME session. Both derivations are
    // gone now — `bucket` is the one field both `group.busy` and the row's
    // own word read — so this is structurally impossible rather than merely
    // untested; the assertions below are the same ones that caught it.
    const [g] = groupFleet([sess({ bucket: 'attention' })]);
    const { rerender } = render(
      <ProjectCard collapsed group={g!} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('working')).toBeNull();
    rerender(<ProjectCard group={g!} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('waiting')).toBeInTheDocument();
  });

  it('counts only the rows that will say working, not every busy status', () => {
    // The border never carried a count (a boolean over a count); the word does,
    // so the number is a claim. Two sessions, one of them waiting on the
    // reader, must fold to `working` (one row), never `2 working`.
    const [g] = groupFleet([
      sess({ bucket: 'attention' }),
      sess({ id: 'demo-still-cove', workspace: 'still-cove', bucket: 'working' }),
    ]);
    const { rerender } = render(
      <ProjectCard collapsed group={g!} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('2 working')).toBeNull();
    expect(screen.getByText('working')).toBeInTheDocument();
    rerender(<ProjectCard group={g!} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getAllByText('working')).toHaveLength(1);
  });

  it('leaves the header silent about busy while the rows are visible', () => {
    // Control — green before and after, and the guard that stops anyone
    // "improving" the word into an always-on header rollup, re-creating the
    // exact duplication the green border was deleted for.
    render(
      <ProjectCard group={grp({ busy: 1, sessions: [sess({ status: 'busy', bucket: 'working' })] })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getAllByText('working')).toHaveLength(1);
  });
});

describe('a fold must not hide the selection either', () => {
  it('marks a folded card that holds the selected session', () => {
    // Selection is a fact about the reader, not about the project, so it
    // never touches the perimeter — but a fold hides the selected row exactly
    // as it would hide a pending dialog, so the header carries it (as the
    // slab, at chip scale) while folded.
    const { container } = render(
      <ProjectCard collapsed selectedId="demo-quiet-mesa" group={grp()}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card')).toHaveAttribute('data-holds-selection');
  });

  it('does not mark an expanded card — the row itself is showing', () => {
    // Control.
    const { container } = render(
      <ProjectCard selectedId="demo-quiet-mesa" group={grp()}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card')).not.toHaveAttribute('data-holds-selection');
  });

  it('does not mark a folded card holding no selected session', () => {
    // Control.
    const { container } = render(
      <ProjectCard collapsed selectedId="other-loud-fjord" group={grp()}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card')).not.toHaveAttribute('data-holds-selection');
  });
});

describe('session count', () => {
  it('is absent when a project holds one — a constant badge says nothing', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('renders from two upwards', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('the archived sub-fold', () => {
  const archived = (id: string) => ({ ...sess({ id, workspace: id.slice(5) }), archivedAt: 1785300000 });

  it('renders nothing when a project has no archived rows', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/^Archived/)).not.toBeInTheDocument();
  });

  it('shows a collapsed Archived (n) fold at the bottom of the card', () => {
    const g = grp({ archived: [archived('demo-quiet-basin'), archived('demo-still-cove')] });
    const { container } = render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: /archived \(2\)/i });
    expect(toggle).toBeInTheDocument();
    // Collapsed by DEFAULT: archived rows are context, not the fleet — and
    // the toggle says so via aria-expanded, not only via what's absent from
    // the DOM (which a hardcoded aria-expanded value would not catch).
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('▸');
    expect(container.querySelectorAll('.proj-archived-body .sess-line')).toHaveLength(0);
  });

  it('hides the archived fold along with the rest of the card when collapsed', () => {
    // The project fold and the archive fold are two independent booleans
    // (`collapsed` and `archivedOpen`) guarding the SAME block — collapsing
    // the card must still hide the archived toggle, not just the live rows.
    const g = grp({ archived: [archived('demo-quiet-basin')] });
    render(<ProjectCard collapsed group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument();
  });

  it('expands to the rows, which still open', () => {
    // ProjectCard is a pure, controlled component (fold state lives in
    // FleetScreen, per this file's own header comment) — a click here only
    // fires onToggle with the composite key; it is the RE-RENDER with
    // archivedOpen flipped (FleetScreen's real response to that callback)
    // that reveals the rows. Asserting the composite key itself doubles as
    // the guard against it colliding with the project's own fold key.
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const g = grp({ archived: [archived('demo-quiet-basin')] });
    const { rerender } = render(
      <ProjectCard group={g} onOpen={onOpen} onToggle={onToggle} onActions={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /archived \(1\)/i }));
    expect(onToggle).toHaveBeenCalledWith('demo::archived');
    rerender(
      <ProjectCard group={g} onOpen={onOpen} onToggle={onToggle} onActions={() => {}} archivedOpen />);
    const toggle = screen.getByRole('button', { name: /archived \(1\)/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('▾');
    fireEvent.click(screen.getByText('quiet-basin'));
    expect(onOpen).toHaveBeenCalledWith('demo-quiet-basin');
  });

  it('carries selection into an archived row exactly as a live row would', () => {
    const g = grp({ archived: [archived('demo-quiet-basin')] });
    const { container } = render(
      <ProjectCard group={g} selectedId="demo-quiet-basin" archivedOpen
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-archived-body .sess-line--active')).not.toBeNull();
  });
});
