// A card is always a project; a line is always a session. No bare path.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession, RunSummary } from '../../shared/api';
import { SPAWN_STALL_MS } from '../../shared/api';
import { groupFleet, type FleetGroup } from '../src/fleet/groupFleet';
import { NEST_BRACKET, ProjectCard } from '../src/fleet/ProjectCard';
import { TEST_ROSTER } from './rosterFixture';

// vitest runs without globals, so RTL's auto-cleanup never registers itself —
// without this, rerender/multi-render tests below leak DOM across `it` blocks.
afterEach(cleanup);

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'quiet-mesa', name: null, title: null, status: 'idle',
  statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
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
    // /api/accounts has its own poll; the + must never wait on it. Before the
    // first poll lands (or while every poll has failed) useProjectedHome
    // yields `undefined`, NOT `null` — `null` is the server's own "nothing is
    // placeable", a fact this render has not observed, so the label must not
    // claim it (that claim is pinned separately below).
    render(<ProjectCard group={grp()} projected={undefined} onAddWorkspace={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    const btn = screen.getByRole('button', { name: /new workspace on demo/i });
    expect(btn).toBeEnabled();
    expect(btn).toHaveAccessibleName('New workspace on demo');
  });

  it('disables itself while that project has an add in flight', () => {
    // ccd refuses the second concurrent ws-add for a project now (a per-project
    // `flock -n` in `cmd_ws_add`), so disabling the button is a courtesy that
    // saves a round trip and a refusal toast, not the thing that prevents two
    // worktrees.
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
                        onAddWorkspace={() => {}} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.getByRole('button', { name: /New workspace on demo — team·max, 82% free/i }))
      .toBeInTheDocument();
  });
});

describe('pinned account', () => {
  it('shows the account the project is pinned to', () => {
    render(<ProjectCard group={grp({ pin: 'claude-corp' })} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.getByText('team·b')).toBeInTheDocument();
  });

  it('says "mixed" when the sessions disagree rather than picking one', () => {
    render(<ProjectCard group={grp({ pin: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('mixed')).toBeInTheDocument();
  });

  it('names the pin for assistive tech — a bare label reads as decoration', () => {
    render(<ProjectCard group={grp({ pin: 'claude' })} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
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
                        onAddWorkspace={() => {}} projected={projected} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText('New workspace on demo — team·alt, 91% free'))
      .toBeInTheDocument();
  });

  it('carries them as a tooltip too, for a pointer that can hover', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={projected} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText(/New workspace on demo/))
      .toHaveAttribute('title', 'New workspace on demo — team·alt, 91% free');
  });

  // `null` is the server's OWN answer (every home-able lane disabled) — a
  // fact distinct from `undefined` ("no poll has landed yet", pinned above).
  // Only `null` earns this copy; see the comment above addLabel in
  // ProjectCard. The button itself stays enabled either way (asserted in
  // 'the + button' above).
  it('names the four HOME_ABLE lanes individually when the server projects nothing — never "all accounts" (gpt is never consulted for this fact but renders as an account row on the same screen)', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={null} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText('New workspace on demo — team·max, team·alt, team·b and team·d all disabled'))
      .toBeInTheDocument();
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

// ── Task 4: children nest under the programme that owns them ────────────────
//
// The operator's own words (2026-08-25): "I'd like to basically see nesting via
// L bracket under the programme owner for any child workspaces". The DECISION
// is `nestFleet`'s — pinned rule by rule in nestFleet.test.ts — and everything
// below is about what the card DRAWS for one: a bracket where there is a
// parent, nothing where there is not, and a line for the child that does not
// exist yet.

/** A fixed wall clock, carrying a sub-second remainder for the same reason
 *  runs-screen.test.tsx's own `FROZEN` does: the dispatch window's boundary is
 *  `SPAWN_STALL_MS`, a MILLISECOND constant, so a whole-second instant would
 *  make flooring the clock anywhere on the path a no-op and every claim about
 *  millisecond fidelity untestable. Passed in as `nowMs` rather than faked,
 *  because this component is pure and controlled — the tick belongs to
 *  FleetScreen, which is where it is pinned. */
const FROZEN = 1_800_000_000_499;

const runFor = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 1, program: 'build9b', programTitle: 'Build 9b', wave: 1, waveOf: 3,
  project: 'demo', sessionId: null, workspace: null, branch: null,
  state: 'dispatched', claimedBy: 'demo-quiet-mesa', resumed: false, clearedAt: null,
  openedAt: FROZEN - 1_000_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0, ...over,
});

const worker = sess({ id: 'demo-still-cove', workspace: 'still-cove' });
/** `coord` is the default fixture session (`demo-quiet-mesa`), which every
 *  `runFor` above already names as `claimedBy` — so a group of the two is a
 *  real parent/child pair with nothing else to arrange. */
const pair = grp({ sessions: [sess(), worker] });
const childRun = runFor({ id: 10, sessionId: 'demo-still-cove' });

describe('the nesting bracket', () => {
  it('brackets and indents a child row', () => {
    const { container } = render(
      <ProjectCard group={pair} runs={[childRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    const nested = container.querySelectorAll('.proj-nest');
    expect(nested).toHaveLength(1);
    expect(nested[0]).toHaveAttribute('data-depth', '1');
    expect(nested[0]?.querySelector('.proj-nest-bracket')?.textContent).toBe(NEST_BRACKET);
    // The bracketed row is the WORKER, not the coordinator.
    expect(nested[0]?.querySelector('.sess-label')?.textContent).toBe('still-cove');
  });

  it('renders neither bracket nor indent on a top-level row — a bracket that is always there is not a bracket', () => {
    // BOTH directions, and this is the half a decorative prefix passes by
    // accident: with no run to draw an edge from, the card is byte-identical
    // to the one that shipped before this task.
    const { container } = render(
      <ProjectCard group={pair} runs={[]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).toBeNull();
    expect(container.querySelector('.proj-nest-bracket')).toBeNull();
    expect(screen.queryByText(NEST_BRACKET)).toBeNull();
    expect(container.querySelectorAll('.sess-line')).toHaveLength(2);
  });

  it('leaves every affordance on a nested row exactly as it is on a top-level one', () => {
    // Nesting changes POSITION and PREFIX, nothing else: the row keeps its own
    // tap surface, its actions control, its chips and its held string. Rendered
    // twice — bracketed and not — and compared, so this cannot pass by
    // asserting whatever the nested row happens to do.
    const held = sess({ id: 'demo-still-cove', workspace: 'still-cove', held: 'program:build9b wave:1/3 run:10' });
    const g = grp({ sessions: [sess(), held] });
    // THE CONTROL CARRIES A RUN TOO (Task 5). It used to be `runs={[]}`, which
    // stopped being a matched control the moment a run naming this session
    // started deciding something about the row — the hold reason's door. The
    // two renders would then have differed in the RUN DATA as well as in the
    // nesting, and this pin would have reported that difference as if nesting
    // had caused it. `orphaned` names the same worker as `childRun` and a
    // parent that is NOT on this card, so `nestFleet`'s rule 3 keeps the row at
    // top level (measured just below, in its own case) while everything the row
    // reads off a run stays identical. Nesting is then the only variable left.
    const orphaned = runFor({ id: 11, sessionId: 'demo-still-cove', claimedBy: 'other-project-coordinator' });
    const flat = render(<ProjectCard group={g} runs={[orphaned]} nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    const before = flat.container.querySelectorAll('.sess-line')[1]?.outerHTML;
    cleanup();
    const { container } = render(
      <ProjectCard group={g} runs={[childRun]} nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    const after = container.querySelector('.proj-nest > .sess-line')?.outerHTML;
    expect(after).toBe(before);
  });

  it('still opens a nested row when it is tapped', () => {
    const onOpen = vi.fn();
    render(<ProjectCard group={pair} runs={[childRun]} nowMs={FROZEN}
                        onOpen={onOpen} onActions={() => {}} />);
    fireEvent.click(screen.getByText('still-cove'));
    expect(onOpen).toHaveBeenCalledWith('demo-still-cove');
  });

  it('hides the whole tree along with the rest of the card when collapsed', () => {
    const { container } = render(
      <ProjectCard collapsed group={pair} runs={[childRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).toBeNull();
    expect(screen.queryByText('still-cove')).not.toBeInTheDocument();
  });
});

describe('the pending child — a spawn the operator can watch arrive', () => {
  const spawning = (over: Partial<RunSummary> = {}): RunSummary =>
    runFor({ id: 12, wave: 2, state: 'planned', sessionId: null,
             dispatchStartedAt: FROZEN - 42_000, ...over });

  it('renders under the coordinator that asked for it, with the programme and a live elapsed clock', () => {
    const { container } = render(
      <ProjectCard group={grp()} runs={[spawning()]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    const row = container.querySelector('.proj-pending');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-phase')).toBe('in-flight');
    expect(screen.getByText('spawning a worker')).toBeInTheDocument();
    expect(screen.getByText('build9b')).toBeInTheDocument();
    // 42 seconds, not 41: the stamp is 42_000 ms before a `now` that carries a
    // 499 ms remainder, so a clock floored to seconds anywhere on this path
    // reads one second short.
    expect(screen.getByText('0:42')).toBeInTheDocument();
    // Two cues, the standing rule: a word AND a glyph.
    expect(row?.querySelector('.proj-pending-glyph')?.textContent).toBe('⟳');
    // It is a CHILD — bracketed under the coordinator, at depth 1.
    expect(container.querySelector('.proj-nest[data-depth="1"] .proj-pending')).not.toBeNull();
  });

  it('is not tappable and carries no session id — there is no session to open', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <ProjectCard group={grp()} runs={[spawning()]} nowMs={FROZEN}
                   onOpen={onOpen} onActions={() => {}} />);
    const row = container.querySelector('.proj-pending')!;
    expect(row.querySelector('button')).toBeNull();
    expect(row.querySelector('.sess-line')).toBeNull();
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('says the wedge once the threshold has passed, and stops saying it is spawning', () => {
    // `dispatch.ts`'s own "a run stuck in `planned` beside an unexplained new
    // workspace is a state no verb names" — rendered on the fleet card for the
    // first time. BOTH directions: the wedge present, the in-flight sentence
    // gone.
    const { container } = render(
      <ProjectCard group={grp()} runs={[spawning({ dispatchStartedAt: FROZEN - SPAWN_STALL_MS })]}
                   nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-pending')?.getAttribute('data-phase')).toBe('stalled');
    expect(screen.getByText('spawn never completed')).toBeInTheDocument();
    expect(screen.queryByText('spawning a worker')).toBeNull();
    expect(container.querySelector('.proj-pending-glyph')?.textContent).toBe('⚠');
  });

  it('renders nothing at all for a planned run nobody has dispatched', () => {
    // The no-regression pin, and the reason the STAMP is the signal: a wave N+1
    // opened and waiting, and every wave N>=2 resume, carry no stamp and have
    // no spawn to narrate.
    const { container } = render(
      <ProjectCard group={grp()} runs={[spawning({ dispatchStartedAt: null })]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-pending')).toBeNull();
    expect(screen.queryByText('spawning a worker')).toBeNull();
  });

  it('renders at top level, unbracketed, when the coordinator is not on this card', () => {
    const { container } = render(
      <ProjectCard group={grp()} runs={[spawning({ claimedBy: 'other-project-coord' })]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-pending')).not.toBeNull();
    expect(container.querySelector('.proj-nest')).toBeNull();
  });
});

// ── Task 5: the hold reason becomes a door, and the card decides ───────────
//
// `SessionLine` renders two forms of one cell and picks neither: whether there
// is anywhere to send the tap is a question about this project's ACTIVE runs,
// which this card already holds (Task 4 threaded them down for the tree) and
// the row does not. It is answered from the run rows themselves — never by
// reading the run id out of the hold string, which `rundefs.ts` keeps
// display-only and `run-routes.test.ts` scans `pwa/src` to enforce.
describe('the held cell opens the run board when a run is actually on it (Task 5)', () => {
  const heldWorker = sess({
    id: 'demo-still-cove', workspace: 'still-cove', held: 'program:build9b wave:1/3 run:10',
  });
  const cell = (): HTMLElement | null => document.querySelector('.sess-held');

  it('is a door when an active run on this card names the session', () => {
    render(<ProjectCard group={grp({ sessions: [heldWorker] })} runs={[childRun]} nowMs={FROZEN}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(cell()?.tagName).toBe('BUTTON');
  });

  it('leads to /runs, and not into the session underneath it', () => {
    const onOpen = vi.fn();
    history.pushState(null, '', '/');
    render(<ProjectCard group={grp({ sessions: [heldWorker] })} runs={[childRun]} nowMs={FROZEN}
                        onOpen={onOpen} onActions={() => {}} />);
    fireEvent.click(cell()!);
    expect(location.pathname).toBe('/runs');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is today’s inert text when no run on this card names the session — never a dead tap', () => {
    // A hand hold (`ccd ws-hold` with no programme behind it), a hold left
    // behind by a run that has already closed, or a coordinator's own claim on
    // a card whose runs have not landed yet. All three read the same way: the
    // board has no row to show, so there is no door.
    render(<ProjectCard group={grp({ sessions: [heldWorker] })} runs={[]} nowMs={FROZEN}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(cell()?.tagName).toBe('SPAN');
    expect(document.querySelector('button.sess-held')).toBeNull();
  });

  it('opens no door for a run that names a DIFFERENT session on the same card', () => {
    // The edge is `run.sessionId === session.id` and nothing looser. A card
    // carrying one run and two held rows must not light both.
    const other = sess({ id: 'demo-far-ridge', workspace: 'far-ridge', held: 'program:build9b wave:1/3 run:10' });
    render(<ProjectCard group={grp({ sessions: [other] })} runs={[childRun]} nowMs={FROZEN}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(cell()?.tagName).toBe('SPAN');
  });
});
