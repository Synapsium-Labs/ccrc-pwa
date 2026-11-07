// A card is always a project; a line is always a session. No bare path.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DelegationProjectionWire, FleetSession, PoolsEnforcement, ProjectPoolWire, ProjectPoolsWire, RunSummary } from '../../shared/api';
import { fleetSession, hibernatedSession, DEAD_LIFECYCLE } from './fleetFixture';
import type { ProjectPlacementRead } from '../src/fleet/placementWords';
import { SPAWN_STALL_MS } from '../../shared/api';
import { groupFleet, type FleetGroup } from '../src/fleet/groupFleet';
import { NEST_BRACKET, POOL_UNAVAILABLE_TEXT, ProjectCard as Card } from '../src/fleet/ProjectCard';
import { withRunBinding } from './runBindingFixture';

/** The card as a current server feeds it (D-7182, C7d): each of the group's sessions carries the run binding the server
 *  sends over the runs this render hands the card (`runBindingFixture.ts`), so a worker of a run on the card is that
 *  run's bound worker, as it is on the wire. Every assertion below reads the real card. */
const ProjectCard = (p: Parameters<typeof Card>[0]): ReturnType<typeof Card> =>
  <Card {...p} group={{ ...p.group, sessions: withRunBinding(p.group.sessions, p.runs ?? []) }} />;
import { waveLabel } from '../src/fleet/runWords';
import { TEST_ROSTER } from './rosterFixture';
import { fleetTree } from '../src/fleet/fleetTree';
import { TOOL_USE_ID, activity, frame, lease, unowned } from './delegationFixture';
import { NO_ROLLUP_PREFS, rollupCard, toggleChildren, type RollupPrefs } from '../src/fleet/rollup';
import { WARN_GLYPH } from '@ccrc/ui';
import { COORD_A, LEASE_ID, cardElement, okJson, renderCard, worldWithLease, worldWithUnowned } from './leaseCardFixture';
import { clearAuthLost } from '../src/lib/auth';
import { GROUP_WORDS } from '../src/fleet/delegationWords';

// vitest runs without globals, so RTL's auto-cleanup never registers itself —
// without this, rerender/multi-render tests below leak DOM across `it` blocks.
afterEach(cleanup);

const sess = (over: Partial<FleetSession> = {}): FleetSession => (fleetSession({ id: 'demo-quiet-mesa', workspace: 'quiet-mesa', ...over }));

const grp = (over: Partial<FleetGroup> = {}): FleetGroup => ({
  project: 'demo', sessions: [sess()], attention: false, busy: 0, unseen: 0, pin: { state: 'shared', home: 'claude' },
  stranded: 0, archived: [], released: [], elsewhere: [], ...over,
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

  it('shows the live session count, as a number with its noun (T3a, D-6331)', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'b', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('shows no count for a project holding one session', () => {
    const { container } = render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card-count')).toBeNull();
  });

  it('renders NO pin chip on an empty card — nothing is pinned and nothing disagrees', () => {
    const { container } = render(
      <ProjectCard group={grp({ sessions: [], pin: { state: 'empty' } })} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card-pin')).toBeNull();
    expect(screen.getByText('demo')).toBeInTheDocument();
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
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
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
    render(<ProjectCard group={grp({ pin: { state: 'shared', home: 'claude-acme' } })} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.getByText('team·b')).toBeInTheDocument();
  });

  it('says "several accounts" when the sessions disagree rather than picking one (T3a, D-6331)', () => {
    render(<ProjectCard group={grp({ pin: { state: 'mixed' } })} onOpen={() => {}} onActions={() => {}} />);
    const chip = screen.getByText('several accounts');
    expect(chip).toBeInTheDocument();
    // The chip measures each session's PINNED account (ccd `home`), not where it runs, so its title says "pinned".
    expect(chip).toHaveAttribute('title', 'The sessions here are pinned to different accounts');
    expect(chip).toHaveAttribute('aria-label', 'pinned accounts differ');
    expect(chip).toHaveAttribute('data-mixed');
    expect(screen.queryByText('mixed')).not.toBeInTheDocument();
  });

  it('names the pin for assistive tech — a bare label reads as decoration', () => {
    render(<ProjectCard group={grp({ pin: { state: 'shared', home: 'claude' } })} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText('pinned to team·max')).toBeInTheDocument();
  });
});

describe('the + is icon-only', () => {
  const projected = { wrapper: 'claude9', score: 9 };

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
    const [g] = groupFleet([sess({ bucket: 'attention' })], []);
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
    ], []);
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
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
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
  project: 'demo', homeProject: null, sessionId: null, workspace: null, branch: null,
  state: 'dispatched', kind: 'work', reviews: null,
  claimedBy: 'demo-quiet-mesa', resumed: false, clearedAt: null,
  openedAt: FROZEN - 1_000_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  // F7's per-run health facts. All-clear, deliberately: every case in this file
  // predates the warn row and must keep rendering exactly as it did.
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
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
    // By its label, not its index: a worker of a programme elsewhere is drawn under its own sub-heading (Task G2).
    const before = [...flat.container.querySelectorAll('.sess-line')]
      .find((el) => el.querySelector('.sess-label')?.textContent === 'still-cove')?.outerHTML;
    expect(before).toBeDefined();
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
    // The constant, never a literal: it carries U+FE0E (D-5100).
    expect(container.querySelector('.proj-pending-glyph')?.textContent).toBe(WARN_GLYPH);
  });

  it('D-7563: the stalled run bound to its returned child clears the wedge, and the child is drawn under its coordinator', () => {
    // The server's auto-bind leaves the run planned and its stamp as it was, and names the child workspace as its
    // session. BOTH directions on the same group: unbound, the wedge; bound, the child's own row and no wedge.
    const stalled = spawning({ dispatchStartedAt: FROZEN - SPAWN_STALL_MS * 600 });
    const unbound = render(
      <ProjectCard group={pair} runs={[stalled]} nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('spawn never completed')).toBeInTheDocument();
    unbound.unmount();
    const { container } = render(
      <ProjectCard group={pair} runs={[{ ...stalled, sessionId: 'demo-still-cove' }]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('spawn never completed')).toBeNull();
    expect(container.querySelector('.proj-pending')).toBeNull();
    expect(container.querySelector('.proj-nest[data-depth="1"] .sess-label')?.textContent).toBe('still-cove');
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

  // C7d's behaviour row, OA-C15 (a) (D-7265): the door follows the wire's binding. A run that names the session by id
  // but that the server binds to no incarnation of it (#746's recycled id, or an older server's frame with no binding)
  // is not the session's run, so the hold reads as the inert text it is (a door before C7d).
  it('opens no door for an open run that names the session but that the wire does not bind to it', () => {
    render(<ProjectCard group={grp({ sessions: [{ ...heldWorker, run: null, openRun: null }] })} runs={[childRun]} nowMs={FROZEN}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(cell()?.tagName).toBe('SPAN');
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

// Account pools, wave 4, spec §5.10 and §11 row 24. The card is the only place
// a project's pool is stated, so every measured state — plus the condition
// where nobody said anything — has a distinct rendering.
describe('the pool chip', () => {
  const listed = (byProject: Record<string, ProjectPoolWire>, enforcement: PoolsEnforcement = 'enforced'):
    ProjectPoolsWire => ({ listed: true, byProject, enforcement });
  const measured = (pool: ProjectPoolWire): ProjectPlacementRead => ({
    kind: 'measured', pool, placement: { kind: 'unmeasurable' },
  });

  it('renders NOTHING when no pools frame has arrived — absence is not a measurement', () => {
    // The mutant this kills: defaulting a missing pool to `untagged` flags every
    // project on a server that predates the pools frame.
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.queryByText(/pool/i)).not.toBeInTheDocument();
    expect(screen.queryByText('no pool')).not.toBeInTheDocument();
    expect(screen.queryByText('Set pool')).not.toBeInTheDocument();
  });

  it('names the pool a tagged project is in', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'tagged', name: 'pool-a' })}
                        pools={listed({ demo: { state: 'tagged', name: 'pool-a' } })} />);
    expect(screen.getByLabelText('project pool pool-a')).toHaveTextContent('pool-a');
  });

  it('flags a MEASURED untagged project — ruling 3\'s worklist', () => {
    // No handler: nowhere to go, so the chip is a span and keeps the state's own words — a word that names an action
    // must not appear where there is no door to take it (T3a, D-6331).
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'untagged' })} pools={listed({})} />);
    const chip = screen.getByText('no pool');
    expect(chip).toHaveAttribute('data-pool', 'untagged');
    expect(chip.tagName).toBe('SPAN');
    expect(screen.queryByText('Set pool')).not.toBeInTheDocument();
  });

  it("an untagged project's chip reads 'Set pool' and is still the button that opens the pool sheet", () => {
    const onPool = vi.fn();
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'untagged' })} pools={listed({})} onPool={onPool} />);
    const chip = screen.getByText('Set pool');
    expect(chip.tagName).toBe('BUTTON');
    // Ruling 3's attention ink keys on this attribute (`fleet.css`), so the new word keeps it.
    expect(chip).toHaveAttribute('data-pool', 'untagged');
    // The accessible name begins with the words the door shows (WCAG 2.5.3, R121 Q6; C12 item 10), then the state's
    // sentence; the tooltip stays the sentence.
    expect(chip).toHaveAccessibleName('Set pool — no project pool — any account may serve this project');
    expect(chip).toHaveAttribute('title', 'no project pool — any account may serve this project');
    expect(screen.queryByText('no pool')).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(onPool).toHaveBeenCalledTimes(1);
    expect(onPool).toHaveBeenCalledWith('demo');
  });

  it('a dim untagged chip (the fleet ccd predates pools) keeps its state word, not the action word', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'untagged' })}
                        pools={listed({}, 'unavailable')} onPool={() => {}} />);
    expect(screen.queryByText('Set pool')).not.toBeInTheDocument();
    expect(screen.getByText('no pool').tagName).toBe('SPAN');
  });

  it('tells malformed from unreadable, in two aria-labels that each carry the full path', () => {
    // Two conditions with two remedies — rewrite the file, or fix its
    // permissions. One shared "bad tag" chip would send the operator to the
    // wrong one half the time.
    const { rerender } = render(
      <ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                   placement={measured({ state: 'malformed' })}
                   pools={listed({ demo: { state: 'malformed' } })} />);
    const malformed = screen.getByText('pool malformed');
    expect(malformed.getAttribute('aria-label')).toMatch(/malformed/i);
    expect(malformed.getAttribute('aria-label')).toContain('~/.cc-sessions/pools/demo');
    const malformedLabel = malformed.getAttribute('aria-label');

    rerender(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                          placement={measured({ state: 'unreadable' })}
                          pools={listed({ demo: { state: 'unreadable' } })} />);
    const unreadable = screen.getByText('pool unreadable');
    expect(unreadable.getAttribute('aria-label')).toMatch(/could not be read/i);
    expect(unreadable.getAttribute('aria-label')).toContain('~/.cc-sessions/pools/demo');
    expect(unreadable.getAttribute('aria-label')).not.toBe(malformedLabel);
  });

  it('reads every project as unreadable when the whole listing failed', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'unreadable' })}
                        pools={{ listed: false, enforcement: 'enforced' }} />);
    expect(screen.getByText('pool unreadable')).toBeInTheDocument();
  });

  it('says an unrecognised runtime state needs a newer app, never names its raw residue', () => {
    // The wire type names the states this bundle understands. A newer fleet can
    // still send another runtime value, so this is deliberately a raw cast.
    const residue = { state: 'archived', name: 'pool-z' } as unknown as ProjectPoolWire;
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured(residue)} pools={listed({ demo: residue })} />);
    const chip = screen.getByText(/app older than fleet; reload/i);
    expect(chip).toHaveAttribute('data-pool', 'unrecognised');
    expect(chip).toHaveAccessibleName(/app bundle is older than the fleet; reload/i);
    for (const absent of ['pool-z', 'pool unreadable', 'pool malformed', 'no pool', 'Set pool']) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });

  it('opens the sheet on a tap, and is a tappable button only when there is somewhere to go', () => {
    const onPool = vi.fn();
    const { rerender } = render(
      <ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                   placement={measured({ state: 'tagged', name: 'pool-a' })}
                   pools={listed({ demo: { state: 'tagged', name: 'pool-a' } })} onPool={onPool} />);
    fireEvent.click(screen.getByRole('button', { name: 'project pool pool-a' }));
    expect(onPool).toHaveBeenCalledWith('demo');

    // No handler: the chip still STATES the pool — it just is not a control.
    rerender(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                          placement={measured({ state: 'tagged', name: 'pool-a' })}
                          pools={listed({ demo: { state: 'tagged', name: 'pool-a' } })} />);
    expect(screen.queryByRole('button', { name: 'project pool pool-a' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('project pool pool-a')).toBeInTheDocument();
  });

  it('dims and stops being a control when the fleet ccd predates pools', () => {
    // `unavailable` says hand-written tags display but nothing enforces them;
    // a tap could only fail with 501.
    const onPool = vi.fn();
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'tagged', name: 'pool-a' })}
                        pools={listed({ demo: { state: 'tagged', name: 'pool-a' } }, 'unavailable')}
                        onPool={onPool} />);
    const chip = screen.getByLabelText('project pool pool-a');
    expect(screen.queryByRole('button', { name: 'project pool pool-a' })).not.toBeInTheDocument();
    expect(chip).toHaveAttribute('data-dim', 'true');
    expect(chip).toHaveAttribute('title', POOL_UNAVAILABLE_TEXT);
  });

  it('stays quiet under enforcement "unknown" — a chip that dims when nothing was checked stops being read', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        placement={measured({ state: 'tagged', name: 'pool-a' })}
                        pools={listed({ demo: { state: 'tagged', name: 'pool-a' } }, 'unknown')} />);
    expect(screen.getByLabelText('project pool pool-a')).not.toHaveAttribute('data-dim');
  });
});

describe('route-owned pool handoff to session rows', () => {
  const roster = TEST_ROSTER.map((account) => ({
    ...account,
    pool: account.id === 'claude9' ? 'pool-b' : null,
  }));
  const placement: ProjectPlacementRead = {
    kind: 'measured',
    pool: { state: 'tagged', name: 'pool-a' },
    placement: { kind: 'unmeasurable' },
  };
  const conflictingFrame: ProjectPoolsWire = {
    listed: true,
    byProject: { demo: { state: 'tagged', name: 'pool-b' } },
    enforcement: 'enforced',
  };

  it('passes the route pool to an active row when the pools frame disagrees', () => {
    const active = sess({ wrapper: 'claude9', home: 'claude9' });
    render(<ProjectCard group={grp({ sessions: [active] })} placement={placement}
                        pools={conflictingFrame} roster={roster}
                        onOpen={() => {}} onActions={() => {}} />);

    // D-5545: the account cell left the card; off-pool is the row's marker, its sentence the title.
    expect(screen.getByTitle('running on team·alt (pool pool-b), project is pool pool-a')).toHaveTextContent('off-pool');
  });

  it('keeps an expanded archived dead row neutral when the pools frame disagrees', () => {
    // Archived membership is the dead/archived wire shape. `SessionLine`
    // intentionally suppresses off-pool on dead rows: nothing is running, so
    // the route-owned prop is inert here. Its direct suite pins that policy;
    // the active case above independently pins ProjectCard's handoff.
    const archived = sess({
      id: 'demo-quiet-basin', wrapper: 'claude9', home: 'claude9',
      workspace: 'quiet-basin', status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'archived',
      archivedAt: 1_785_300_000,
    });
    render(<ProjectCard group={grp({ archived: [archived] })} placement={placement}
                        pools={conflictingFrame} roster={roster} archivedOpen
                        onOpen={() => {}} onActions={() => {}} />);

    expect(screen.queryByText('off-pool')).not.toBeInTheDocument();
  });
});

// Task 4 fix round 1 (review finding, Important): after the key flip a MOVED
// row (`s.project !== group.project`) must be judged against ITS OWN
// project's pool, never the card's — `~/.cc-sessions/pools/<project>` is
// keyed by the session's own project, and a card's `placement`/`pool` is one
// `/api/projects` read for `group.project` alone.
describe('a moved row is judged against its OWN project\'s pool, never the card\'s (Task 4 fix round 1)', () => {
  // The card (`demo`) is tagged pool-a — DIFFERENT from the moved row's own
  // project (`beta`, tagged pool-b via `poolFor`), so a card-pool judgment and
  // an own-project judgment disagree in both directions these two cases probe.
  const cardPlacement: ProjectPlacementRead = {
    kind: 'measured',
    pool: { state: 'tagged', name: 'pool-a' },
    placement: { kind: 'unmeasurable' },
  };
  const poolFor = (project: string): ProjectPoolWire | null =>
    project === 'beta' ? { state: 'tagged', name: 'pool-b' } : null;
  const moved = () => sess({
    id: 'beta-still-cove', project: 'beta', boardProject: 'demo',
    wrapper: 'claude9', home: 'claude9', workspace: 'still-cove',
  });

  it('no off-pool label when the moved row\'s account matches ITS OWN project\'s pool, though the card is tagged differently', () => {
    // claude9 is in pool-b, the moved row's own project (beta) is pool-b:
    // they agree. Judged against the CARD's pool-a instead, this would be a
    // false off-pool warning — exactly the defect the finding named.
    const roster = TEST_ROSTER.map((a) => ({ ...a, pool: a.id === 'claude9' ? 'pool-b' : null }));
    render(<ProjectCard group={grp({ sessions: [moved()] })} placement={cardPlacement}
                        poolFor={poolFor} roster={roster}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('off-pool')).not.toBeInTheDocument();
  });

  it('names the moved row\'s OWN project\'s pool when its account disagrees — never the card\'s pool', () => {
    // claude9 is in pool-a, the moved row's own project (beta) is pool-b:
    // they disagree, and the label must name pool-b (beta's own tag), not
    // pool-a (the card's tag, which happens to equal the account's pool here
    // — a judgment against the card would swallow the warning entirely).
    const roster = TEST_ROSTER.map((a) => ({ ...a, pool: a.id === 'claude9' ? 'pool-a' : null }));
    render(<ProjectCard group={grp({ sessions: [moved()] })} placement={cardPlacement}
                        poolFor={poolFor} roster={roster}
                        onOpen={() => {}} onActions={() => {}} />);
    // D-5545: the account cell left the card; off-pool is the row's marker, its sentence the title.
    expect(screen.getByTitle('running on team·alt (pool pool-a), project is pool pool-b')).toHaveTextContent('off-pool');
  });

  it('CONTROL: a same-project row is still judged against the card\'s own pool, exactly as before', () => {
    // group.project === s.project here (both 'demo'), so poolOf must return
    // `pool` (the card's), never call `poolFor` at all.
    const roster = TEST_ROSTER.map((a) => ({ ...a, pool: a.id === 'claude9' ? 'pool-b' : null }));
    render(<ProjectCard group={grp({ sessions: [sess({ wrapper: 'claude9', home: 'claude9' })] })}
                        placement={cardPlacement} poolFor={poolFor} roster={roster}
                        onOpen={() => {}} onActions={() => {}} />);
    // D-5545: the account cell left the card; off-pool is the row's marker, its sentence the title.
    expect(screen.getByTitle('running on team·alt (pool pool-b), project is pool pool-a')).toHaveTextContent('off-pool');
  });
});

describe('the stranded cell', () => {
  it('does not surface a stranded aggregate for a sole dead marker-bearing row', () => {
    const marker = { at: 1, reason: 'no account in pool pool-a can take it' };
    const [group] = groupFleet([
      sess({ status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead', stranded: marker }),
    ], []);
    render(<ProjectCard group={group!} onOpen={() => {}} onActions={() => {}} />);

    expect(screen.queryByText(/stranded/)).not.toBeInTheDocument();
  });

  it('says how many members have nowhere in their pool to go, folded or not', () => {
    const { rerender } = render(
      <ProjectCard group={grp({ stranded: 2 })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2 stranded')).toBeInTheDocument();
    rerender(<ProjectCard group={grp({ stranded: 2 })} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2 stranded')).toBeInTheDocument();
  });

  it('renders nothing at zero', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/stranded/)).not.toBeInTheDocument();
  });
});

describe('the + names in-pool accounts, never "all accounts"', () => {
  const pooled = (byId: Record<string, string>) =>
    TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

  it('leaves the untagged copy byte-identical', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText('New workspace on demo — team·max, team·alt, team·b and team·d all disabled'))
      .toBeInTheDocument();
  });

  it('names only the accounts the project\'s pool admits', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null}
                        placement={{ kind: 'measured', pool: { state: 'tagged', name: 'pool-b' }, placement: { kind: 'none', pool: 'pool-b' } }}
                        roster={pooled({ claude: 'pool-a', claude9: 'pool-b', 'claude-acme': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-b' } }, enforcement: 'enforced' }} />);
    const btn = screen.getByRole('button', { name: /New workspace on demo/ });
    expect(btn.getAttribute('aria-label')).toContain('team·alt and team·d');
    expect(btn.getAttribute('aria-label')).not.toContain('team·max');
  });

  it('says the pool is empty rather than listing nobody', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null}
                        placement={{ kind: 'measured', pool: { state: 'tagged', name: 'pool-b' }, placement: { kind: 'none', pool: 'pool-b' } }}
                        roster={pooled({ claude: 'pool-a', claude9: 'pool-a', 'claude-acme': 'pool-a', 'claude-lab0': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-b' } }, enforcement: 'enforced' }} />);
    expect(screen.getByRole('button', { name: 'New workspace on demo — nothing is in pool pool-b' }))
      .toBeInTheDocument();
  });

  it('names the class rather than the pool when a `?class=` read measures every lane unservable for it (routing slice 4, Task 6)', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null}
                        placement={{ kind: 'measured', pool: { state: 'tagged', name: 'pool-b' }, placement: { kind: 'none', pool: 'pool-b', class: 'fable' } }}
                        roster={pooled({ claude: 'pool-a', claude9: 'pool-a', 'claude-acme': 'pool-a', 'claude-lab0': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-b' } }, enforcement: 'enforced' }} />);
    expect(screen.getByRole('button', { name: 'New workspace on demo — no lane can serve fable' }))
      .toBeInTheDocument();
  });

  it('uses the project placement over a truthy out-of-pool global projection (D-2643)', () => {
    const placement: ProjectPlacementRead = {
      kind: 'measured',
      pool: { state: 'tagged', name: 'pool-b' },
      placement: { kind: 'projected', wrapper: 'claude9', score: 9 },
    };
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={{ wrapper: 'claude', score: 18 }} placement={placement}
                        roster={pooled({ claude: 'pool-a', claude9: 'pool-b', 'claude-acme': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-b' } }, enforcement: 'enforced' }} />);
    const button = screen.getByRole('button', { name: /New workspace on demo/ });
    expect(button).toHaveAccessibleName('New workspace on demo — team·alt, 91% free');
    expect(button.getAttribute('aria-label')).not.toContain('team·max');
  });

  it('keeps a route-measured pool with its placement when the pools frame disagrees', () => {
    const placement: ProjectPlacementRead = {
      kind: 'measured',
      pool: { state: 'tagged', name: 'pool-b' },
      placement: { kind: 'none', pool: 'pool-a' },
    };
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={{ wrapper: 'claude', score: 18 }} placement={placement}
                        roster={pooled({ claude: 'pool-a', claude9: 'pool-b', 'claude-acme': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced' }} />);

    expect(screen.getByLabelText('project pool pool-b')).toHaveTextContent('pool-b');
    const button = screen.getByRole('button', { name: /New workspace on demo/ });
    expect(button.getAttribute('aria-label')).toContain('nothing in pool pool-b is placeable');
    expect(button.getAttribute('aria-label')).toContain('team·alt and team·d all disabled');
    expect(button.getAttribute('aria-label')).not.toContain('pool-a');
  });

  it('preserves measured none and unmeasurable without falling back to the global projection', () => {
    const common = {
      group: grp(), onOpen: () => {}, onActions: () => {}, onAddWorkspace: () => {},
      projected: { wrapper: 'claude', score: 18 },
      roster: pooled({ claude: 'pool-a', claude9: 'pool-b', 'claude-acme': 'pool-a' }),
      pools: { listed: true, byProject: { demo: { state: 'tagged' as const, name: 'pool-b' } }, enforcement: 'enforced' as const },
    };
    const { rerender } = render(
      <ProjectCard {...common} placement={{ kind: 'measured', pool: { state: 'tagged', name: 'pool-b' }, placement: { kind: 'none', pool: 'pool-b' } }} />,
    );
    expect(screen.getByRole('button', { name: /New workspace on demo/ }).getAttribute('aria-label'))
      .toContain('nothing in pool pool-b is placeable');
    expect(screen.getByRole('button', { name: /New workspace on demo/ }).getAttribute('aria-label'))
      .not.toContain('team·max, 82% free');

    rerender(<ProjectCard {...common} placement={{ kind: 'measured', pool: { state: 'tagged', name: 'pool-b' }, placement: { kind: 'unmeasurable' } }} />);
    expect(screen.getByRole('button', { name: /New workspace on demo/ }))
      .toHaveAccessibleName('New workspace on demo');

    rerender(<ProjectCard {...common} projected={null}
                          placement={{ kind: 'measured', pool: { state: 'tagged', name: 'pool-b' }, placement: { kind: 'unmeasurable' } }} />);
    expect(screen.getByRole('button', { name: /New workspace on demo/ }))
      .toHaveAccessibleName('New workspace on demo');
  });

  it('gives failed and missing route reads distinct recovery copy', () => {
    const common = {
      group: grp(), onOpen: () => {}, onActions: () => {}, onAddWorkspace: () => {},
      projected: { wrapper: 'claude', score: 18 }, roster: TEST_ROSTER,
    };
    const { rerender } = render(<ProjectCard {...common} placement={{ kind: 'failed' }} />);
    const failed = screen.getByRole('button', { name: /New workspace on demo/ });
    const failedLabel = 'New workspace on demo — placement check failed; reopen ccrc to retry';
    expect(failed).toHaveAccessibleName(failedLabel);
    expect(failed).toHaveAttribute('title', failedLabel);

    rerender(<ProjectCard {...common} placement={{ kind: 'missing' }} />);
    const missing = screen.getByRole('button', { name: /New workspace on demo/ });
    expect(missing).toHaveAccessibleName(
      'New workspace on demo — project absent from the latest placement check; reload ccrc',
    );
    expect(missing).toHaveAttribute('title', missing.getAttribute('aria-label'));
    expect(missing).not.toHaveAccessibleName(failedLabel);
  });

  it('uses the legacy global projection without inventing pool state from a newer frame', () => {
    const common = {
      group: grp(), onOpen: () => {}, onActions: () => {}, onAddWorkspace: () => {},
      projected: { wrapper: 'claude', score: 18 }, roster: TEST_ROSTER,
      placement: { kind: 'legacy' as const },
    };
    const { rerender } = render(<ProjectCard {...common} />);
    expect(screen.getByRole('button', { name: /New workspace on demo/ }))
      .toHaveAccessibleName('New workspace on demo — team·max, 82% free');

    rerender(<ProjectCard {...common}
                          pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced' }} />);
    expect(screen.getByRole('button', { name: /New workspace on demo/ }))
      .toHaveAccessibleName('New workspace on demo — team·max, 82% free');
    expect(screen.queryByLabelText('project pool pool-a')).not.toBeInTheDocument();

    rerender(<ProjectCard {...common} projected={null} />);
    expect(screen.getByRole('button', { name: /New workspace on demo/ }))
      .toHaveAccessibleName('New workspace on demo — team·max, team·alt, team·b and team·d all disabled');
  });
});

// ── cross-repo wave 2: the orphan gets a marker (spec §3 F4; D-5545) ─────────
//
// `nestFleet`'s rule 3 is right and stays: a worker whose coordinator sits on
// another project's card is NOT bracketed, because a `└─` may not cross two
// cards. Until D-5545 the card explained it with a SECOND LINE under the row —
// `⇄ <programme> wave 2/3 · coordinator gone` — which repeated the programme and
// wave the row itself already names. Now the row carries it as its one attention
// marker: "coordinator gone" (or "coordinator hibernated"), the guidance and the
// home clause in its title. A coordinator the frame has not measured says nothing.
describe('the orphan worker\'s marker rides its row', () => {
  const orphanRun = runFor({
    id: 11, program: 'build9b', wave: 2, waveOf: 3,
    project: 'demo', sessionId: 'demo-still-cove', claimedBy: 'off-card-coordinator',
    homeProject: 'home-repo',
  });
  const worker = (): FleetSession => sess({
    id: 'demo-still-cove', workspace: 'still-cove', role: 'child',
    child: { kind: 'child', runId: 11 }, held: 'program:build9b wave:2/3 run:11',
  });
  const orphans = (): FleetGroup => grp({ sessions: [sess(), worker()] });
  const deadCoord = sess({ id: 'off-card-coordinator', project: 'elsewhere', status: 'dead', bucket: 'dead', lifecycle: 'orphan' });
  const marker = (c: HTMLElement): HTMLElement | null => c.querySelector('[data-marker^="coordinator-"]');

  it('draws no second line: the row names its programme and wave once, and the tree does not move', () => {
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).toBeNull();
    expect(container.querySelector('.proj-crossing')).toBeNull();
    // Task G2: a worker whose coordinator is off this card sits under "Workers of programmes elsewhere".
    const row = [...container.querySelectorAll('.sess-line')].find((el) => el.querySelector('.sess-label')?.textContent === 'still-cove')!;
    expect(row.closest('.pg-elsewhere')).not.toBeNull();
    expect(row.textContent!.split('build9b').length - 1).toBe(1);
    expect(row.textContent).toContain('build9b · wave 2 of 3');
  });

  it('marks NO row when the coordinator is on this very card — the bracket already says it', () => {
    const { container } = render(
      <ProjectCard group={pair} runs={[childRun]} nowMs={FROZEN} frameSeen coordOf={() => deadCoord}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).not.toBeNull();
    expect(marker(container)).toBeNull();
  });

  it('marks no row at RULE 4 either, where a worker that is also a parent stays flat', () => {
    // `nestFleet` rule 4: a session that is both a child of one run and the parent of another renders at TOP
    // level. A depth-0 row is NOT evidence that its coordinator is off this card; `orphanNote`'s
    // `group.sessions.some(...)` guard is the only thing that silences it, and this case is its witness.
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' }), sess({ id: 'demo-far-bank', workspace: 'far-bank' })] });
    const { container } = render(
      <ProjectCard group={g} frameSeen coordOf={() => deadCoord}
        runs={[
          runFor({ id: 20, sessionId: 'demo-still-cove', claimedBy: 'demo-quiet-mesa' }),
          runFor({ id: 21, sessionId: 'demo-far-bank', claimedBy: 'demo-still-cove' }),
        ]}
        nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelectorAll('.proj-nest')).toHaveLength(1);
    expect(marker(container)).toBeNull();
  });

  it('keeps the marked row its own line — no marker wrapper, no sibling line', () => {
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? deadCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    const row = [...container.querySelectorAll('.sess-line')].find((el) => el.querySelector('.sess-label')?.textContent === 'still-cove')!;
    // Task G2: its one wrapper is the elsewhere group's row slot (the programme's hue), never a marker line.
    expect(row.parentElement?.classList.contains('pg-far')).toBe(true);
    expect(row.parentElement?.childElementCount).toBe(1);
    expect(row.parentElement?.parentElement?.parentElement).toBe(container.querySelector('.proj-card-body'));
    expect(row.nextElementSibling?.classList.contains('proj-crossing') ?? false).toBe(false);
    expect(marker(row as HTMLElement)).not.toBeNull();
  });

  it('marks no row for a SELF-CLAIMED or an UNCLAIMED run', () => {
    for (const claimedBy of ['demo-still-cove', null]) {
      cleanup();
      const { container } = render(
        <ProjectCard group={orphans()} runs={[runFor({ id: 13, sessionId: 'demo-still-cove', claimedBy })]} nowMs={FROZEN}
                     frameSeen coordOf={() => deadCoord} onOpen={() => {}} onActions={() => {}} />);
      expect(marker(container), String(claimedBy)).toBeNull();
    }
  });

  it('says the coordinator is GONE when the fleet measures it dead, naming the run board and the home in its title', () => {
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? deadCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    const m = marker(container)!;
    expect(m.getAttribute('data-marker')).toBe('coordinator-gone');
    // IN THE TEXT (final fix round): a title is invisible on touch.
    expect(m.textContent).toBe('coordinator gone');
    expect(m.getAttribute('title')).toContain('reclaim');
    expect(m.getAttribute('title')).toContain('homed in home-repo');
  });

  it('compares the home against the CARD\'s own project, not the run\'s (D-2576)', () => {
    const abroadRun = { ...orphanRun, project: 'other', homeProject: 'other' };
    const { container } = render(
      <ProjectCard group={orphans()} runs={[abroadRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? deadCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(marker(container)!.getAttribute('title')).toContain('homed in other');
  });

  it('says nothing about home when the measured home IS the card\'s own project', () => {
    const { container } = render(
      <ProjectCard group={orphans()} runs={[{ ...orphanRun, homeProject: 'demo' }]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? deadCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(marker(container)!.getAttribute('title')).not.toContain('homed');
  });

  it('says the coordinator is HIBERNATED, not gone, when it sleeps — and names the wake, not the reclaim (D-5242)', () => {
    const sleepingCoord = hibernatedSession(FROZEN - 3_600_000, { id: 'off-card-coordinator', project: 'elsewhere' });
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? sleepingCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    const m = marker(container)!;
    expect(m.getAttribute('data-marker')).toBe('coordinator-hibernated');
    expect(m.textContent).toBe('coordinator hibernated');
  });

  // D-7371: a hibernated orphan or never-started coordinator (the server reads it `dead`) is asleep, never gone.
  it.each(['orphan', 'never-started'] as const)('says HIBERNATED, not gone, for a hibernated %s coordinator (D-7371)', (lifecycle) => {
    const sleepingCoord = fleetSession({ id: 'off-card-coordinator', project: 'elsewhere', status: 'dead', bucket: 'dead',
      lifecycle, hibernatedAt: FROZEN - 3_600_000 });
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? sleepingCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    const m = marker(container)!;
    expect(m.getAttribute('data-marker')).toBe('coordinator-hibernated');
    expect(container.textContent).not.toContain('coordinator gone');
  });

  // D-7370: a substrate stamp over a pane tmux called gone is doubt (D-309): no marker, no "coordinator gone".
  it('claims nothing about a coordinator whose gone pane carries a substrate stamp (D-7370)', () => {
    const stamped = fleetSession({ id: 'off-card-coordinator', project: 'elsewhere', status: 'dead', bucket: 'dead',
      lifecycle: 'orphan', substrate: { at: 1, text: 'tmux: no server running' } });
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? stamped : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(marker(container)).toBeNull();
    expect(container.textContent).not.toContain('coordinator gone');
  });

  it('claims nothing about a coordinator the frame has not measured', () => {
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(marker(container)).toBeNull();
    expect(container.textContent).not.toContain('coordinator gone');
  });

  it('reads dead as unknown while frameSeen is not passed — D-1138\'s half: a dead session alone is not enough', () => {
    const { container } = render(
      <ProjectCard group={orphans()} runs={[orphanRun]} nowMs={FROZEN} coordOf={() => deadCoord}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(marker(container)).toBeNull();
  });
});

// ── cross-repo wave 2: the home card knows where its waves went ──────────────
//
// A crossing programme's home card would otherwise show nothing at all for the
// wave that is running: the worker's session lives in the other repo, so it is
// on the other card, and this card's own `runs` filter (by `run.project`) cannot
// see it BY CONSTRUCTION. The second list is additive and the tree never sees
// it — `nestFleet` is called with `runs`, exactly as before.
describe('the home card lists the waves running abroad', () => {
  const away = runFor({
    id: 30, program: 'build9b', wave: 2, waveOf: 3,
    project: 'other-repo', sessionId: 'other-repo-far-bank',
    claimedBy: 'demo-quiet-mesa', homeProject: 'demo',
  });

  it('renders one line per wave abroad, naming the programme, the wave and the repo', () => {
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} abroad={[away]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    const lines = container.querySelectorAll('.proj-abroad-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toContain('build9b');
    expect(lines[0]?.textContent).toContain(waveLabel({ wave: 2, waveOf: 3 }));
    expect(lines[0]?.textContent).toContain('other-repo');
  });

  it('renders one line per wave, not one per programme', () => {
    const second = { ...away, id: 31, wave: 3, project: 'third-repo' };
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} abroad={[away, second]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelectorAll('.proj-abroad-line')).toHaveLength(2);
  });

  it('renders nothing at all when nothing is abroad — the prop is additive', () => {
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-abroad')).toBeNull();
  });

  it('hides the list with the rest of the card when collapsed', () => {
    // A fold hides the body; the abroad lines are body, not header. The one
    // thing a fold may never hide is attention, and this is not that.
    const { container } = render(
      <ProjectCard collapsed group={grp()} runs={[]} abroad={[away]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-abroad')).toBeNull();
  });

  it('does not draw the abroad run into the tree — nestFleet is called with `runs` alone', () => {
    // The run names `demo-quiet-mesa` as its coordinator, which IS on this card.
    // If the abroad list ever reached `nestFleet`, a pending child would appear
    // under that session for a workspace that is not in this repo. Shaped
    // PENDING (`state: 'planned'` plus a stamp) rather than left at `away`'s
    // default `dispatched`, because `dispatchWindow` answers `none` for any
    // non-`planned` state regardless of what `nestFleet` was handed — the
    // shared `away` fixture cannot exercise this path at all, so this case
    // builds its own pending-shaped run rather than touching `away` itself
    // (D-2581; a first ruling that this fixture alone would be a complete
    // witness was wrong — see the sibling case below for the half it missed).
    const pendingAway: RunSummary = { ...away, state: 'planned', dispatchStartedAt: FROZEN - 1_000 };
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} abroad={[pendingAway]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).toBeNull();
    expect(container.querySelector('.proj-pending')).toBeNull();
  });

  it('does not draw the abroad run into the tree via the SETTLED path either — a shared session id must not bracket it (D-2581)', () => {
    // `nestFleet`'s settled path keys ONLY on `sessionId`/`claimedBy` being on
    // THIS card's session list — it never reads the run's own `project`. An
    // abroad run whose `sessionId` happens to name a session already on this
    // card is not a hypothetical: nothing in `pwa/` enforces "a run's worker
    // session lives in the run's own project" (that invariant, if it holds at
    // all, is a SERVER fact, and this component may not lean on it — the same
    // lean D-2576 was minted for, one layer out). Without this case the guard
    // above proved only the pending half; this one is the settled half, and it
    // is the one that is actually reachable and observably regresses (measured
    // RED under the abroad-into-nestFleet mutation, GREEN against the shipped
    // tree — D-2581).
    const settledAway = { ...away, sessionId: 'demo-still-cove' };
    const { container } = render(
      <ProjectCard group={grp({ sessions: [sess(), worker] })} runs={[]} abroad={[settledAway]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).toBeNull();
  });

  it('renders the elsewhere lines as text with no control, and nothing when nothing moved', () => {
    const { container, rerender } = render(
      <ProjectCard group={grp({ sessions: [], pin: { state: 'empty' }, elsewhere: [{ project: 'project-n', count: 2 }] })}
                   onOpen={() => {}} onActions={() => {}} />);
    const line = container.querySelector('.proj-elsewhere-line')!;
    expect(line.textContent).toBe('2 workspaces under project-n');
    expect(container.querySelectorAll('.proj-elsewhere button, .proj-elsewhere a')).toHaveLength(0);
    rerender(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-elsewhere')).toBeNull();
  });
});

// D-5545: spec §6's repo label left the row. A row whose project differs from its card's carries the cross-project
// chip (D-5527) inside its button instead, which keeps two same-slug rows two accessible names; the session header
// names the repository.
describe('the repo label appears only where the card stops implying it (spec §6, Task 6)', () => {
  const moved = sess({ id: 'project-d-still-river', project: 'project-d', workspace: 'still-river', boardProject: 'demo' });

  it('labels no row with a repo: a moved row says whose code it works on instead', () => {
    render(<ProjectCard group={grp({ sessions: [sess(), moved] })} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-repo')).toBeNull();
    expect(screen.getByRole('button', { name: /still-river.*works on.*project-d/ })).toBeInTheDocument();
  });
  it('two colliding slugs on one card are two distinct accessible names', () => {
    const own = sess({ id: 'demo-still-river', workspace: 'still-river' });
    render(<ProjectCard group={grp({ sessions: [own, moved] })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: 'still-river' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /still-river.*works on.*project-d/ })).toBeInTheDocument();
  });
});

describe('the Released (n) fold (workspace lifecycle spec §5.1)', () => {
  const released = (id: string, program: string, closedAt: number, over: Partial<FleetSession> = {}, child = false): FleetSession =>
    sess({
      id, workspace: id.slice(5), bucket: 'done',
      releasedFrom: { runId: closedAt, program, programTitle: program === 'alpha' ? 'Alpha programme' : null, claimedBy: 'coord', closedAt, child },
      ...over,
    });
  const archivedRow = sess({ id: 'demo-old-bay', workspace: 'old-bay', status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'archived', archivedAt: 1_785_300_000 });

  it('renders nothing when nothing is released', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.proj-released')).toBeNull();
  });

  it('is collapsed by default, and sits directly ABOVE the Archived fold', () => {
    const g = grp({ released: [released('demo-amber-delta', 'alpha', 200)], archived: [archivedRow] });
    const { container } = render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: /released \(1\)/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('.proj-released-body .sess-line')).toHaveLength(0);
    const folds = [...container.querySelectorAll('.proj-released, .proj-archived')].map((e) => e.className);
    expect(folds).toEqual(['proj-released', 'proj-archived']);
  });

  it('hides along with the rest of the card when the card is collapsed', () => {
    render(<ProjectCard collapsed group={grp({ released: [released('demo-amber-delta', 'alpha', 200)] })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /released/i })).not.toBeInTheDocument();
  });

  it('toggles under its own composite key, and expands to rows grouped by programme that still open', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const g = grp({ released: [
      released('demo-amber-delta', 'alpha', 200),
      released('demo-still-cove', 'beta', 300),
      released('demo-quiet-bay', 'alpha', 100),
    ] });
    const { container, rerender } = render(<ProjectCard group={g} onOpen={onOpen} onToggle={onToggle} onActions={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /released \(3\)/i }));
    expect(onToggle).toHaveBeenCalledWith('demo::released');
    rerender(<ProjectCard group={g} onOpen={onOpen} onToggle={onToggle} onActions={() => {}} releasedOpen />);
    const headings = [...container.querySelectorAll('.proj-released-heading')].map((e) => e.textContent);
    expect(headings).toEqual(['beta', 'alpha · Alpha programme']);
    const rows = [...container.querySelectorAll('.proj-released-body .sess-line')].map((e) => e.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('amber-delta');
    expect(rows[2]).toContain('quiet-bay');
    fireEvent.click(screen.getByText('amber-delta'));
    expect(onOpen).toHaveBeenCalledWith('demo-amber-delta');
  });

  it('"Archive all" counts only the rows it would send, and names the children it skips', () => {
    const onArchiveReleased = vi.fn();
    const g = grp({ released: [
      released('demo-amber-delta', 'alpha', 200),
      released('demo-kid-one', 'alpha', 150, {}, true),
    ] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} releasedOpen onArchiveReleased={onArchiveReleased} />);
    const button = screen.getByRole('button', { name: 'Archive all 1 released workspace in demo' });
    expect(button).toHaveTextContent('Archive all (1)');
    fireEvent.click(button);
    expect(onArchiveReleased).toHaveBeenCalledWith('demo');
    expect(screen.getByText('Archive all skips 1 child workspace.')).toBeInTheDocument();
  });

  it('no button without a handler, none when every row is a child, and a disabled one while the loop runs', () => {
    const one = grp({ released: [released('demo-amber-delta', 'alpha', 200)] });
    const { rerender } = render(<ProjectCard group={one} onOpen={() => {}} onActions={() => {}} releasedOpen />);
    expect(screen.queryByRole('button', { name: /archive all/i })).not.toBeInTheDocument();
    rerender(<ProjectCard group={grp({ released: [released('demo-kid-one', 'alpha', 150, {}, true)] })}
      onOpen={() => {}} onActions={() => {}} releasedOpen onArchiveReleased={() => {}} />);
    expect(screen.queryByRole('button', { name: /archive all/i })).not.toBeInTheDocument();
    rerender(<ProjectCard group={one} onOpen={() => {}} onActions={() => {}} releasedOpen onArchiveReleased={() => {}} archivingReleased />);
    const running = screen.getByRole('button', { name: 'Archiving released workspaces in demo' });
    expect(running).toBeDisabled();
    expect(running).toHaveTextContent('Archiving…');
  });

  it('shows itself while it holds the selected row — a release is not the operator\u2019s act, so the row being read must not vanish', () => {
    const g = grp({ released: [released('demo-amber-delta', 'alpha', 200)] });
    const { container, rerender } = render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelectorAll('.proj-released-body .sess-line')).toHaveLength(0);
    rerender(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} selectedId="demo-amber-delta" />);
    expect(screen.getByRole('button', { name: /released \(1\)/i })).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelectorAll('.proj-released-body .sess-line')).toHaveLength(1);
  });

  it('the toggle is disabled while the selected row holds the fold open, and live otherwise', () => {
    // Forced open by the selection, a tap could not collapse the fold — it would only invert the stored key.
    const g = grp({ released: [released('demo-amber-delta', 'alpha', 200)] });
    const onToggle = vi.fn();
    const { rerender } = render(<ProjectCard group={g} onOpen={() => {}} onToggle={onToggle} onActions={() => {}} selectedId="demo-amber-delta" />);
    const held = screen.getByRole('button', { name: /released \(1\)/i });
    expect(held).toBeDisabled();
    fireEvent.click(held);
    expect(onToggle).not.toHaveBeenCalled();
    // The control: a selection elsewhere leaves the toggle live.
    rerender(<ProjectCard group={g} onOpen={() => {}} onToggle={onToggle} onActions={() => {}} selectedId="demo-elsewhere" />);
    const free = screen.getByRole('button', { name: /released \(1\)/i });
    expect(free).toBeEnabled();
    fireEvent.click(free);
    expect(onToggle).toHaveBeenCalledWith('demo::released');
    // And a fold the operator opened (`releasedOpen`) with the selection elsewhere: shown, yet its toggle is live,
    // so the operator can close what they opened. Only the selection disables it, never the fold being shown.
    onToggle.mockClear();
    rerender(<ProjectCard group={g} onOpen={() => {}} onToggle={onToggle} onActions={() => {}} releasedOpen selectedId="demo-elsewhere" />);
    const opened = screen.getByRole('button', { name: /released \(1\)/i });
    expect(opened).toHaveAttribute('aria-expanded', 'true');
    expect(opened).toBeEnabled();
    fireEvent.click(opened);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('demo::released');
  });

  it('a COLLAPSED card still marks the selection when the selected row sits only in Released', () => {
    // Before the fold a released row lived in `group.sessions`, so the folded header carried the mark; the row now
    // lives in `group.released`, and the mark must follow it.
    const g = grp({ released: [released('demo-amber-delta', 'alpha', 200)] });
    const { container } = render(
      <ProjectCard collapsed selectedId="demo-amber-delta" group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card')).toHaveAttribute('data-holds-selection');
  });
});

// Delegation broker wave 4, PR2 Task 2.7: delegated work, worktrees and the two groups on a project card. The card
// draws `fleetTree`'s rows and the words module's labels; it decides nothing of its own.
describe('delegation rows on a project card (delegation broker wave 4)', () => {
  const coordA = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a' });
  const workerA = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', role: 'child' });
  const prun = (over: Partial<RunSummary>): RunSummary => ({
    id: 7, program: 'port-api', programTitle: 'Port the API', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
    sessionId: 'worker-a', workspace: 'worker-a', branch: null, state: 'dispatched', kind: 'work', reviews: null,
    claimedBy: 'coord-a', resumed: false, clearedAt: null, openedAt: 1, dispatchStartedAt: null, dispatchedAt: null,
    closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
    health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true,
      clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
  });
  const cardFor = (w: DelegationProjectionWire, sessions = [coordA], runs: RunSummary[] = []) =>
    fleetTree(withRunBinding(sessions, runs), [], runs, {}, w).find((g) => g.project === 'project-a')!;
  const countText = (root: HTMLElement, text: string): number =>
    [...root.querySelectorAll('*')].filter((el) => el.childElementCount === 0 && el.textContent === text).length;

  it('W4-U28: a raw worktree under its parent reads inferred and its Bash call, with no control of its own', () => {
    const { container } = render(<ProjectCard group={cardFor(frame({ leases: [lease({ sourceKind: 'raw' })] }))}
      onOpen={() => {}} onActions={() => {}} />);
    const row = container.querySelector<HTMLElement>('.proj-work');
    if (row === null) throw new Error('no worktree row');
    expect(row.closest('.proj-nest')?.querySelector('.proj-nest-bracket')?.textContent).toBe(NEST_BRACKET);
    const chips = [...row.querySelectorAll('.proj-work-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['inferred', 'Bash call …est_0001']);
    expect(chips[1]!.getAttribute('title')).toContain(TOOL_USE_ID);
    expect(chips[0]!.getAttribute('title')).toContain(TOOL_USE_ID);
    expect(row.querySelector('button')).toBeNull();
    expect(row.closest('.proj-nest')!.querySelector('button')).toBeNull();
    // No user-facing word says "lease": the operator's word is "worktree".
    expect(container.textContent).not.toMatch(/lease/i);
  });

  it('W4-U29: every raw worktree wears inferred wherever it lands: nested, via a worker, and in the opened groups', () => {
    const w = frame({
      leases: [
        lease({ leaseId: 'l-nested', sourceKind: 'raw' }),
        lease({ leaseId: 'l-via', sourceKind: 'raw', via: 'worker-a', adminRecord: 'agent-v1', canonicalPath: '/work/project-a/.claude/worktrees/agent-v1' }),
        lease({ leaseId: 'l-off', sourceKind: 'raw', parentId: 'coord-gone', adminRecord: 'agent-o1', canonicalPath: '/work/project-a/.claude/worktrees/agent-o1' }),
        lease({ leaseId: 'l-agent', sourceKind: 'agent', adminRecord: 'agent-g1', canonicalPath: '/work/project-a/.claude/worktrees/agent-g1' }),
      ],
      unowned: [unowned({ verdict: 'conflicting', adminRecord: 'agent-a1' })],
    });
    const { container } = render(<ProjectCard group={cardFor(w, [coordA, workerA], [prun({})])} onOpen={() => {}} onActions={() => {}}
      offlineOpen unownedOpen />);
    expect(countText(container, 'inferred')).toBe(3);
    const via = [...container.querySelectorAll('.proj-work')].find((r) => r.textContent?.includes('via '));
    expect(via?.textContent).toContain('inferred');
    expect(container.textContent).toContain('Offline coordinator (1)');
    expect(container.textContent).toContain('Unowned work (1)');
  });

  it('R9 on the card: a programme worker\'s live activity is a chip on its row, never a row of its own', () => {
    const w = frame({ activities: [activity({ activityId: 'a-w', parentId: 'worker-a', placement: 'chip' })] });
    const { container } = render(<ProjectCard group={cardFor(w, [coordA, workerA], [prun({})])} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelectorAll('.proj-work')).toHaveLength(0);
    const chips = [...container.querySelectorAll('.sess-meta-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['1 delegated']);
    expect(chips[0]!.closest('.proj-nest')).not.toBeNull();
  });

  it('a session in no programme folds three delegated activities into one line, as the rollup decided (main\'s boxes)', () => {
    const w = frame({ activities: ['a1', 'a2', 'a3'].map((id) => activity({ activityId: id, parentId: 'coord-a' })) });
    // A working session, so the card is active and open by default (rollup rule 2).
    const g = cardFor(w, [{ ...coordA, status: 'busy', bucket: 'working' }]);
    const drawn = (prefs: RollupPrefs) => render(<ProjectCard group={g} rollup={rollupCard(g, prefs, Date.now(), null)}
      onOpen={() => {}} onActions={() => {}} onToggleChildren={() => {}} />);
    const { container, unmount } = drawn(NO_ROLLUP_PREFS);
    expect(container.querySelector('section.pg-box'), 'coord-a claims no run: it is no box').toBeNull();
    const line = screen.getByRole('button', { name: '3 delegated' });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(line.closest('.proj-nest')?.querySelector('.proj-nest-bracket')?.textContent).toBe(NEST_BRACKET);
    expect(container.querySelectorAll('.proj-work')).toHaveLength(0);
    unmount();
    const open = drawn(toggleChildren(NO_ROLLUP_PREFS, 'coord-a'));
    expect(screen.getByRole('button', { name: '3 delegated' }).getAttribute('aria-expanded')).toBe('true');
    expect(open.container.querySelectorAll('.proj-work')).toHaveLength(3);
  });

  it('W4-U30: a group is a closed disclosure by default, opened under its composite key', async () => {
    const w = frame({ unowned: [unowned({ adminRecord: 'u1' }), unowned({ adminRecord: 'u2' }), unowned({ adminRecord: 'u3' })] });
    const onToggle = vi.fn();
    const { container, rerender } = render(<ProjectCard group={cardFor(w)} onOpen={() => {}} onActions={() => {}} onToggle={onToggle} />);
    const toggle = screen.getByRole('button', { name: /Unowned work \(3\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('title')).toContain('never makes one eligible for removal');
    expect(container.querySelectorAll('.proj-work')).toHaveLength(0);
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('project-a::unowned');
    rerender(<ProjectCard group={cardFor(w)} onOpen={() => {}} onActions={() => {}} onToggle={onToggle} unownedOpen />);
    expect(screen.getByRole('button', { name: /Unowned work \(3\)/ }).getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('.proj-work')).toHaveLength(3);
  });

  it('VIS-P1: an offline-group row names the session it came from: its listed label, else its raw id', () => {
    const arch = fleetSession({ id: 'coord-arch', project: 'project-a', workspace: null, name: 'old coordinator', archivedAt: 1_800_000_000_000 });
    const w = frame({
      activities: [activity({ activityId: 'a-arch', parentId: 'coord-arch', displayName: 'old work' })],
      leases: [lease({ leaseId: 'l-gone', parentId: 'coord-gone', adminRecord: 'agent-o1', canonicalPath: '/work/project-a/.claude/worktrees/agent-o1' })],
    });
    const parts = (root: HTMLElement): (string | null)[][] =>
      [...root.querySelectorAll('.proj-work')].map((r) => [...r.querySelectorAll('.proj-work-part')].map((p) => p.textContent));
    const off = render(<ProjectCard group={cardFor(w, [coordA, arch])} onOpen={() => {}} onActions={() => {}}
      coordOf={(id) => (id === arch.id ? arch : null)} offlineOpen />);
    expect(parts(off.container)).toEqual([
      ['agent worktree', 'agent-o1', 'not confirmed', 'from coord-gone'],
      ['agent', 'old work', 'not confirmed', 'from old coordinator'],
    ]);
    off.unmount();
    // A row under its own session names no parent.
    const nested = render(<ProjectCard group={cardFor(frame({ activities: [activity({ parentId: 'coord-a' })] }))}
      onOpen={() => {}} onActions={() => {}} />);
    expect(parts(nested.container)).toEqual([['agent', 'explore the tree', 'not confirmed']]);
  });
});

// Delegation broker wave 5, PR10 (Task 5.10.2): the worktree controls on a card's rows. The words module decides which control a
// row offers and spells every word; the card draws them, asks first where the words say so, calls the door, and says a
// refusal in worktree words (D-8097). O5-8 (c) (D-7847) and D-8095: an unowned row offers Not delegated only, and only
// through the lease the projection hid on its tree. Fix round 1 (review 1615): focus after an act (F2), the refusal's
// region (F3), Attach only with a live own session (F4), tone, focus, toast and busy pinned (F6), and F9's details. Fix round 2
// (review 1623): a door refusal only at a door's status (F2), focus and the regions while a row offers none (F3), an ask
// closed by its row (F4), a dead session's Attach (F5), and F8's details. F1's one-post rows are `worktree-confirm-close`'s.
describe('worktree controls on a project card (delegation broker wave 5, PR10)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearAuthLost(); });
  type Call = { url: string; body: unknown };
  const accepted = (expiresAt: string | null = '2026-11-24T12:00:00.000Z') => okJson({ ok: true, lease: LEASE_ID, generation: 2,
    disposition: 'retained', expiresAt, carrier: 'pending' });
  const recorder = (answer: (url: string) => Response | Promise<Response> = () => accepted()) => {
    const calls: Call[] = [];
    return { calls, fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      return answer(url);
    } };
  };
  const RESOLVE = new RegExp(`/api/leases/${LEASE_ID}/resolve$`);
  const rowOf = (container: HTMLElement, worktree = 'agent-a1'): HTMLElement =>
    [...container.querySelectorAll<HTMLElement>('.proj-work')].find((r) => r.textContent?.includes(worktree))!;
  /** F2: the focus sits on a live element in the row (never a disabled control). */
  const focusInRow = (row: HTMLElement): void => {
    const at = document.activeElement as HTMLElement | null;
    expect(at !== null && row.contains(at), `focus is in the row, not on ${at?.tagName}.${at?.className}`).toBe(true);
    expect((at as HTMLButtonElement).disabled ?? false, 'focus is not on a disabled control').toBe(false);
  };
  const confirmButton = (dialog: HTMLElement, name: string): HTMLElement => within(dialog).getByRole('button', { name });

  it('W5-U4: an adopted row says it is kept until its date once, and Keep calls operator-retain, toasts its date and keeps the focus', async () => {
    const r = recorder();
    const { container, getByRole, getByText } = renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }),
      { fetch: r.fetch });
    expect(getByText('worktree kept until 17 Nov')).toBeTruthy();
    expect(container.textContent).not.toMatch(/kept\b.*\bkept until/);
    await userEvent.click(getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(r.calls.map((c) => c.url)).toEqual([expect.stringMatching(/\/api\/leases\/[0-9a-f-]{36}\/operator-retain$/)]);
    expect(await screen.findByText('Worktree kept until 24 Nov')).toBeTruthy();
    focusInRow(rowOf(container));
  });

  it('W5-U5: an inferred row\'s Attach offers only its own session, posts {action:\'attach\', parent}, says its date and keeps the focus', async () => {
    const r = recorder();
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw' }), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(r.calls).toEqual([]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Attach this worktree to coord-a?');
    // The one choice is the worktree's own session: no picker, no list of sessions.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(confirmButton(dialog, 'Attach to coord-a'));
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'attach', parent: 'coord-a' } }]);
    expect(await screen.findByText('Worktree attached to coord-a, kept until 24 Nov')).toBeTruthy();
    focusInRow(rowOf(container));
  });

  it('W5-U5 (R9): a programme worker\'s inferred worktree attaches to the worker, never to the coordinator it is drawn under', async () => {
    const worker = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', role: 'child' });
    const r = recorder();
    renderCard(worldWithLease({ sourceKind: 'raw', parentId: 'coord-a', via: 'worker-a' }, [COORD_A, worker]), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Attach to worker-a' }));
    expect(screen.queryByRole('button', { name: 'Attach to coord-a' })).toBeNull();
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'attach', parent: 'worker-a' } }]);
  });

  it('F4: Attach shows only while the worktree\'s own session is listed live; a raw row whose session is gone offers none', () => {
    const worker = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', role: 'child' });
    const gone = renderCard(worldWithLease({ sourceKind: 'raw', parentId: 'coord-gone', group: 'offline-coordinator' }));
    const row = rowOf(gone.container);
    expect(row.textContent).toContain('from coord-gone');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Not delegated']);
    gone.unmount();
    // CONTROL: the same offline row whose own session (`via`) is listed live offers Attach to it.
    const live = renderCard(worldWithLease({ sourceKind: 'raw', parentId: 'coord-gone', via: 'worker-a', group: 'offline-coordinator' },
      [COORD_A, worker]));
    expect(within(rowOf(live.container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
  });

  it('W5-U6: an unowned row with a hidden lease offers Not delegated only, posting to that lease; with none it offers nothing', async () => {
    const r = recorder();
    const { container, unmount } = renderCard(worldWithUnowned({ verdict: 'conflicting', leaseId: LEASE_ID }), { fetch: r.fetch });
    const row = container.querySelector<HTMLElement>('.proj-work')!;
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Not delegated']);
    // D-8095: the wire carries no parent for the hidden lease, so no attach can be posted from this row.
    expect(screen.queryByRole('button', { name: /^Attach/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-u1)' }));
    await userEvent.click(confirmButton(await screen.findByRole('dialog'), 'Not delegated'));
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'foreign' } }]);
    unmount();
    const none = renderCard(worldWithUnowned({ verdict: 'conflicting' }));
    expect(none.container.querySelector('.proj-work')).not.toBeNull();
    expect(none.container.querySelector('.proj-work button')).toBeNull();
    expect(none.container.querySelector('.proj-work-controls')).toBeNull();
  });

  it('W5-U7 (F6): Not delegated asks first in the danger tone with Cancel focused, says what it means, and posts only after it', async () => {
    const r = recorder();
    const { container } = renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      'This worktree is not delegated work. It will no longer be shown here, and it is not held back from the disk sweep.');
    expect(confirmButton(dialog, 'Not delegated').className, 'the danger tone').toMatch(/\bbtn-danger\b/);
    expect(document.activeElement, 'Cancel holds the focus').toBe(confirmButton(dialog, 'Cancel'));
    expect(r.calls).toEqual([]);
    await userEvent.click(confirmButton(dialog, 'Cancel'));
    expect(r.calls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await userEvent.click(confirmButton(await screen.findByRole('dialog'), 'Not delegated'));
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'foreign' } }]);
    expect(await screen.findByText('Worktree marked not delegated')).toBeTruthy();
    focusInRow(rowOf(container));
  });

  it('F2: a row that leaves while it holds the focus hands it to its card\'s toggle', async () => {
    const r = recorder();
    const world = worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' });
    const { container, rerender } = renderCard(world, { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await userEvent.click(confirmButton(await screen.findByRole('dialog'), 'Not delegated'));
    await screen.findByText('Worktree marked not delegated');
    focusInRow(rowOf(container));
    // The next frame carries no row for it.
    rerender(cardElement({ ...world, frame: { ...world.frame, leases: [] } }));
    expect(container.querySelector('.proj-work')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.proj-card-toggle'));
  });

  it('W5-U8: a transferring row says "moving to a run" and offers no control; a promoted one offers only Not delegated', () => {
    const { container, unmount } = renderCard(worldWithLease({ disposition: 'transferring', expiresAt: '2026-11-17T12:00:00.000Z' }));
    expect(screen.getByText('moving to a run')).toBeTruthy();
    expect(container.querySelector('.proj-work button')).toBeNull();
    expect(container.textContent).not.toContain('kept until');
    unmount();
    const promoted = renderCard(worldWithLease({ disposition: 'promoted' }));
    expect(screen.getByText('moved to a run')).toBeTruthy();
    expect([...promoted.container.querySelectorAll('.proj-work button')].map((b) => b.textContent)).toEqual(['Not delegated']);
  });

  it('W5-U9 (D-8097, F3): a refusal is said in worktree words in a region mounted empty, its detail never drawn, and nothing retries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const detail = 'lease 0b0c3f8e is behind its carrier; retry operator-retain later';
    const r = recorder(() => okJson({ ok: false, error: 'carrier-behind', detail }, 409));
    const { container } = renderCard(worldWithLease({ disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' }), { fetch: r.fetch });
    const row = rowOf(container);
    const region = within(row).getByRole('alert');
    expect(region.textContent, 'the region is mounted empty, before it has anything to say').toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await within(row).findByText('The fleet box has not caught up with this worktree yet. Try again shortly.')).toBe(region);
    expect(within(row).getByRole('alert'), 'the same region, its text swapped').toBe(region);
    expect(document.body.textContent).not.toContain(detail);
    expect(document.body.textContent).not.toMatch(/operator-retain|carrier-behind/);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(r.calls, 'nothing is retried by itself').toHaveLength(1);
  });

  it('D-8097: a refusal word this build does not know says one plain sentence; a failure that is no answer says the app\'s words', async () => {
    const unknown = recorder(() => okJson({ ok: false, error: 'future-word', detail: 'a newer lease rule refused this' }, 409));
    const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: unknown.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await within(rowOf(container)).findByText('The server refused this.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/future-word|newer lease rule/);
    cleanup();
    const broken = recorder(() => okJson({ error: 'internal' }, 500));
    renderCard(worldWithLease({ disposition: 'retained' }), { fetch: broken.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await screen.findByText(/^Couldn't keep the worktree/)).toBeTruthy();
    expect(broken.calls).toHaveLength(1);
  });

  it('F1 (measured, not a departure): a raw row on a conflicting tree, and a box without the hold, each say their refusal', async () => {
    for (const [error, sentence] of [
      ['lease-conflicting', 'Two sessions claimed this worktree, so it cannot be kept until that is settled.'],
      ['box-unsupported', 'The fleet box cannot hold this worktree back from the disk sweep until its ccrc is updated.'],
    ] as const) {
      const r = recorder(() => okJson({ ok: false, error, detail: 'lease refused' }, error === 'box-unsupported' ? 503 : 409));
      const { container } = renderCard(worldWithLease({ sourceKind: 'raw', disposition: 'ephemeral' }), { fetch: r.fetch });
      await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
      expect(await within(rowOf(container)).findByText(sentence), error).toBeTruthy();
      cleanup();
    }
  });

  it('F6: every control is disabled while an act is in flight, and comes back when it ends', async () => {
    let release: (r: Response) => void = () => {};
    const r = recorder(() => new Promise<Response>((res) => { release = res; }));
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw', disposition: 'retained' }), { fetch: r.fetch });
    const buttons = () => within(rowOf(container)).getAllByRole('button') as HTMLButtonElement[];
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(buttons().map((b) => b.disabled)).toEqual([true, true, true]);
    focusInRow(rowOf(container));
    await act(async () => { release(accepted()); });
    await screen.findByText('Worktree kept until 24 Nov');
    expect(buttons().map((b) => b.disabled)).toEqual([false, false, false]);
  });

  // F9 (a), the confirm's words as it closes, is `worktree-confirm-close.test.tsx`'s: jsdom unmounts a closed sheet at once.
  it('F9 (b): an ask is dropped when its row stops offering the act, and it never reopens or posts by itself', async () => {
    const r = recorder();
    const world = (disposition: 'adopted' | 'transferring') => worldWithLease({ disposition, expiresAt: '2026-11-17T12:00:00.000Z' });
    const { rerender } = renderCard(world('adopted'), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    rerender(cardElement(world('transferring')));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(cardElement(world('adopted')));
    expect(screen.queryByRole('dialog'), 'the ask does not come back with the control').toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('F9 (c): a 2xx whose body is not JSON says the act was accepted and its answer unread, with no thrown parse', async () => {
    const r = recorder(() => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
    const row = rowOf(container);
    const status = within(row).getByRole('status');
    expect(status.textContent, 'the status region is mounted empty').toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    // F8 (b) (review 1623): an accepted act is no error, so it is said politely, never in the alert.
    expect(await within(row).findByText(
      'The server accepted this, but its answer could not be read; the row updates with its next change.')).toBe(status);
    expect(within(row).getByRole('alert').textContent).toBe('');
  });

  it('F8 (a) (review 1623): a 2xx that says ok with no expiresAt reads it as no date known, as the wire\'s own reader does', async () => {
    const r = recorder(() => okJson({ ok: true }));
    const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await screen.findByText('Worktree kept')).toBeTruthy();
    expect(rowOf(container).textContent).not.toContain('could not be read');
  });

  it('F2 (review 1623): a refusal that is no door\'s answer (the server\'s real 401, 403, 429 and 501 bodies, a door word at another status) says the app\'s words', async () => {
    for (const [status, body] of [
      [401, { ok: false, error: 'unauthenticated', verdict: 'no-session' }],
      [501, { ok: false, error: 'not-configured' }],
      [403, { ok: false, error: 'foreign-origin' }],
      [429, { ok: false, error: 'rate-limited' }],
      [409, { ok: false, error: 'not-ready', detail: 'a door word at a status it is never sent with' }],
    ] as const) {
      const r = recorder(() => okJson(body, status));
      const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
      await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
      const alert = within(rowOf(container)).getByRole('alert');
      await vi.waitFor(() => expect(alert.textContent, `${status} ${body.error}`).toMatch(/^Couldn't keep the worktree — /));
      expect(alert.textContent, `${status} ${body.error}`).not.toBe('The server refused this.');
      cleanup();
      clearAuthLost();
    }
  });

  it('F5 (review 1623): a session in the dead bucket is still listed, so its inferred worktree offers Attach to it', () => {
    const dead = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a', bucket: 'dead' });
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw' }, [dead]));
    expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
  });

  it('F4 (review 1623): Attach removed by its session leaving the list while its confirm is open closes it; Keep and Not delegated stay; nothing posts', async () => {
    const r = recorder();
    const world = worldWithLease({ sourceKind: 'raw' });
    const { container, rerender } = renderCard(world, { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    rerender(cardElement({ ...world, sessions: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Not delegated']);
    rerender(cardElement(world));
    expect(screen.queryByRole('dialog'), 'the ask does not come back with the control').toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('F4 (review 1623): an open Attach closes when the worktree\'s own session changes, and never posts the old one', async () => {
    const worker = (id: string) => fleetSession({ id, project: 'project-a', workspace: id, workdir: `/work/project-a/.ws/${id}`, role: 'child' });
    const sessions = [COORD_A, worker('worker-a'), worker('worker-b')];
    const r = recorder();
    const at = (via: string) => worldWithLease({ sourceKind: 'raw', parentId: 'coord-a', via }, sessions);
    const { rerender } = renderCard(at('worker-a'), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Attach this worktree to worker-a?');
    rerender(cardElement(at('worker-b')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('F3 (a) (review 1623): a row that goes transferring while its box holds the focus hands it to the card\'s toggle, its regions kept', async () => {
    const r = recorder();
    const world = (disposition: 'retained' | 'transferring') => worldWithLease({ disposition, expiresAt: '2026-11-17T12:00:00.000Z' });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    const alert = within(rowOf(container)).getByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await screen.findByText('Worktree kept until 24 Nov');
    expect(document.activeElement).toBe(container.querySelector('.proj-work-controls'));
    rerender(cardElement(world('transferring')));
    expect(container.querySelector('.proj-work button')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.proj-card-toggle'));
    expect(within(rowOf(container)).getByRole('alert'), 'the region stays mounted while the row offers none').toBe(alert);
  });

  it('F3 (a) (review 1623): in a delegation group, the focus goes to the group\'s toggle, the nearest heading still drawn', async () => {
    const r = recorder();
    const world = (disposition: 'retained' | 'transferring') =>
      worldWithLease({ disposition, parentId: 'coord-gone', group: 'offline-coordinator' });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await screen.findByText(/^Worktree kept/);
    rerender(cardElement(world('transferring')));
    const toggles = [...container.querySelectorAll('.proj-group-toggle')];
    expect(toggles.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(toggles.find((t) => t.textContent?.includes(GROUP_WORDS['offline-coordinator'].label)));
  });

  it('F3 (b) (review 1623): a row first drawn with none that later offers a control and loses it, focused, hands the focus over', () => {
    const world = (disposition: 'transferring' | 'promoted') => worldWithLease({ disposition });
    const { container, rerender } = renderCard(world('transferring'));
    expect(container.querySelector('.proj-work button')).toBeNull();
    rerender(cardElement(world('promoted')));
    act(() => { screen.getByRole('button', { name: 'Not delegated (agent-a1)' }).focus(); });
    rerender(cardElement(world('transferring')));
    expect(document.activeElement).toBe(container.querySelector('.proj-card-toggle'));
  });

  it('F3 (c) (review 1623): a refusal that settles while the row offers none is said then, in the same region, which never remounts', async () => {
    let release: (r: Response) => void = () => {};
    const r = recorder(() => new Promise<Response>((res) => { release = res; }));
    const world = (disposition: 'retained' | 'transferring') => worldWithLease({ disposition });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    const alert = within(rowOf(container)).getByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    rerender(cardElement(world('transferring')));
    await act(async () => { release(okJson({ ok: false, error: 'wrong-disposition', detail: 'x' }, 409)); });
    expect(alert.isConnected).toBe(true);
    await vi.waitFor(() => expect(alert.textContent).toBe("This worktree's state does not allow that now."));
    rerender(cardElement(world('retained')));
    expect(within(rowOf(container)).getByRole('alert'), 'the same element: the sentence is not drawn again as new').toBe(alert);
  });

  it('W5-U10: an older server\'s rows (no disposition, no hidden lease) render byte for byte as on the base', () => {
    // Measured on the base (67121c031) with this fixture, before PR10's card change.
    const BASE = [
    "<div class=\"proj-work\" title=\"/work/project-a/.claude/worktrees/agent-a1; Execution not confirmed: its session is live in the run that started it, but nothing shows the helper itself is still working\"><span class=\"proj-work-parts\"><span class=\"proj-work-part\">agent worktree</span><span class=\"proj-work-part proj-work-name\"><span class=\"proj-work-name-text\">agent-a1</span></span><span class=\"proj-work-part\">not confirmed</span></span></div>",
    "<div class=\"proj-work\" title=\"/work/project-a/.claude/worktrees/agent-r1; Execution not confirmed: its session is live in the run that started it, but nothing shows the helper itself is still working\"><span class=\"proj-work-parts\"><span class=\"proj-work-part\">worktree</span><span class=\"proj-work-part proj-work-name\"><span class=\"proj-work-name-text\">agent-r1</span></span><span class=\"proj-work-part\">not confirmed</span></span><span class=\"proj-work-chip\" title=\"linked by the worktree listing taken before and after Bash call toolu_test_0001, with no other session's listing overlapping it; no upstream id confirms it, and nothing acts on it automatically\">inferred</span><span class=\"proj-work-chip\" title=\"the Bash call that created this worktree: toolu_test_0001\">Bash call …est_0001</span></div>",
    "<div class=\"proj-work\" title=\"/work/project-a/.claude/worktrees/agent-u1: no-correlating-evidence\"><span class=\"proj-work-parts\"><span class=\"proj-work-part proj-work-name\"><span class=\"proj-work-name-text\">agent-u1</span></span><span class=\"proj-work-part\">two owners claimed it</span></span></div>",
    ];
    const { container } = renderCard({ frame: frame({ leases: [lease({ leaseId: LEASE_ID }), lease({ leaseId: 'l-raw', sourceKind: 'raw',
      adminRecord: 'agent-r1', canonicalPath: '/work/project-a/.claude/worktrees/agent-r1' })],
      unowned: [unowned({ verdict: 'conflicting' })] }), sessions: [COORD_A] });
    expect([...container.querySelectorAll('.proj-work')].map((r) => r.outerHTML)).toEqual(BASE);
  });

  it('W5-U11 (F9 (f)): the three controls are buttons named by their words and their worktree, drawn by the design system\'s Button', () => {
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw', disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' }));
    const row = rowOf(container);
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Keep worktree (agent-a1)', 'Attach to… (agent-a1)', 'Not delegated (agent-a1)']);
    // `Button` (@ccrc/ui) carries its own tap floor, which is why control-census registers no `<Button>` call site.
    for (const b of within(row).getAllByRole('button')) expect(b.className).toMatch(/\bmin-h-tap\b/);
    expect(row.textContent).not.toMatch(/lease|adopt|retain|clean|spool|running/i);
    // F8 (c), (d) (review 1623): the controls carry no tooltip of the row's (an empty title ends its reach), and sit in a
    // group named by the row's worktree.
    for (const b of within(row).getAllByRole('button')) expect(b.closest('[title]')?.getAttribute('title')).toBe('');
    expect(within(row).getByRole('group', { name: 'Worktree agent-a1' })).toBe(row.querySelector('.proj-work-controls'));
  });
});
