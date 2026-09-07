// The fleet-wide subagent list. The properties worth pinning are the ones that
// keep it honest: an idle fleet pays nothing, a DEAD session's stale roster is
// never listed, and no copy claims the roster is live.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { subagentDescription, type FleetSession } from '../../shared/api';
import { SubagentsStrip } from '../src/fleet/SubagentsStrip';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-eng-1234', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'eng-1234', name: null, title: null,
  status: 'busy', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, unmeasured: [],
  statusUnmeasured: false, lifecycle: null, lifecycleUnmeasured: [], clips: null,
  substrate: null, stopSurface: null, started: true, bucket: 'working',
  spawnState: null, ...over,
} as FleetSession);

const sub = (name: string, description: string | null, startedAt = Date.now()) =>
  ({ name, startedAt, description });

const draw = (sessions: FleetSession[]) =>
  render(<SubagentsStrip sessions={sessions} roster={[]} onOpen={() => {}} />);

describe('SubagentsStrip', () => {
  it('renders NOTHING when no live session has a subagent', () => {
    // An idle fleet must not pay a row. `null` (no hook data) and `[]` (a
    // measurement of zero) are different facts and neither is a subagent.
    const { container } = draw([s({ subagents: null }), s({ id: 'b', subagents: [] })]);
    expect(container.querySelector('.subagents-strip')).toBeNull();
  });

  it('counts subagents and sessions in the headline', async () => {
    draw([
      s({ id: 'a', subagents: [sub('x', 'One'), sub('y', 'Two')] }),
      s({ id: 'b', subagents: [sub('z', 'Three')] }),
    ]);
    expect(await screen.findByText('3 subagents · 2 sessions')).toBeTruthy();
  });

  it('a DEAD session’s subagents are never listed', async () => {
    // THE PRIMARY GUARD. The wire still carries a dead session's pre-exit
    // roster — subagents of a session with no pane are not running, and
    // SessionLine makes the same judgement client-side. A second consumer has
    // to repeat it or the discipline is pointless.
    draw([
      // `status` too, not only `bucket`: `sessionBucket` derives `dead` FROM
      // `status === 'dead'`, so a row carrying one without the other is a
      // shape the wire cannot produce, and a guard tested only against an
      // impossible row is a guard nobody has measured.
      s({ id: 'dead', status: 'dead', bucket: 'dead',
          subagents: [sub('ghost', 'Should not appear'), sub('g2', 'Nor this')] }),
      s({ id: 'live', subagents: [sub('real', 'Should appear')] }),
    ]);
    expect(await screen.findByText('1 subagent · 1 session')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.queryByText('Should not appear')).toBeNull();
    expect(screen.queryByText('Nor this')).toBeNull();
    expect(screen.getByText('Should appear')).toBeTruthy();
  });

  it('an ARCHIVED session’s subagents are never listed either', async () => {
    // The second of THREE pane-less buckets, and the one a predicate spelled
    // `bucket !== 'dead'` admitted — it kept listing the roster the workspace
    // held at the moment it was archived, elapsed clock counting up beside a
    // subagent that stopped existing when the pane did.
    //
    // `archivedAt` is epoch SECONDS — it is the one field on `FleetSession`
    // that is, and `sessionBucket` says so where it multiplies by 1000. Seeded
    // in ms this row is off by 1000x on the very field that makes its own
    // bucket derivable, in the test whose sibling above argues that a guard
    // measured only against an impossible row is a guard nobody measured.
    draw([
      s({ id: 'arch', status: 'dead', bucket: 'archived',
          archivedAt: Math.floor(Date.now() / 1000) - 60,
          subagents: [sub('stale', 'Was running when the pane went')] }),
      s({ id: 'live', subagents: [sub('real', 'Should appear')] }),
    ]);
    expect(await screen.findByText('1 subagent · 1 session')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.queryByText('Was running when the pane went')).toBeNull();
    expect(screen.getByText('Should appear')).toBeTruthy();
  });

  it('a CLEANUP session’s subagents are never listed — the third pane-less bucket', async () => {
    // THE ONE A BUCKET LIST MISSED. `sessionBucket` gates `cleanup`,
    // `archived` and `dead` all behind `status === 'dead'`, and returns
    // `cleanup` for an archived workspace whose PR merged — so `cleanup` is
    // pane-less by construction, and it is the bucket the AUTO path lands in:
    // `sweepPr` flips the phase and `archiveMerged` archives seconds later,
    // while `archived` is what a hand-run `ccd ws-archive` leaves. A filter
    // naming `['dead','archived']` therefore listed a dead roster on the
    // COMMON path while passing the test for the rare one.
    draw([
      s({ id: 'clean', status: 'dead', bucket: 'cleanup',
          archivedAt: Math.floor(Date.now() / 1000) - 60,
          pr: { number: 7, phase: 'merged', url: null, checks: null, reason: null,
                retryAt: null, mergedAt: Date.now() - 60_000 } as never,
          subagents: [sub('ghost-of-merge', 'Was running when the PR merged')] }),
      s({ id: 'live', subagents: [sub('real', 'Should appear')] }),
    ]);
    expect(await screen.findByText('1 subagent · 1 session')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.queryByText('Was running when the PR merged')).toBeNull();
    expect(screen.getByText('Should appear')).toBeTruthy();
  });

  it('renders the agent TYPE when the server omits `description` entirely (D-1251’s shape)', async () => {
    // The live frame is CAST, not revived, so a server predating this field
    // omits the KEY — and `sub()` above cannot produce that, it always sets it.
    // Read raw, `undefined ?? sa.name` still yields the name but
    // `undefined === null` is FALSE, so the title became "type — undefined".
    // This is the test that pins both arms going through `subagentDescription`.
    const row = sub('reviewer', null) as Record<string, unknown>;
    delete row['description'];
    draw([s({ id: 'old', subagents: [row] as never })]);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    const name = document.querySelector('.subagents-strip-name');
    expect(name?.textContent).toBe('reviewer');
    expect(name?.getAttribute('title'),
      'an omitted description must not reach the title as "undefined"').toBe('reviewer');
  });

  it('expands to indented rows saying what each subagent is doing', async () => {
    draw([s({ subagents: [sub('workflow-subagent', 'Judge offline evidence blind')] })]);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('Judge offline evidence blind')).toBeTruthy();
    // The type moved to the tooltip, as on the card's own disclosure.
    expect(screen.queryByText('workflow-subagent')).toBeNull();
  });

  it('falls back to the type when the join found nothing', async () => {
    draw([s({ subagents: [sub('reviewer', null)] })]);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText('reviewer')).toBeTruthy();
  });

  it('never claims the roster is live', async () => {
    // `hookUpdatedAt` is not a wire field, so the strip cannot know how old a
    // roster is — and a missed SubagentStop lingers until the hookstate ages
    // out. The copy says what it actually knows.
    draw([s({ subagents: [sub('x', 'Doing a thing')] })]);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.getByText(/hooks last reported/)).toBeTruthy();
    expect(screen.queryByText(/running now/i)).toBeNull();
  });

  it('shows no per-subagent state glyph — there is none to source', async () => {
    // The launch record has no status field and SubagentStart sends only
    // `{agent_id, agent_type}`. Orca's literal ask stays refused; a row is the
    // bracket, the text and the elapsed time.
    const { container } = draw([s({ subagents: [sub('x', 'Doing a thing')] })]);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    const row = container.querySelector('.subagents-strip-row')!;
    expect(row.children).toHaveLength(3);
    expect(row.querySelector('.status-dot')).toBeNull();
  });

  it('opens the session when its parent row is tapped', async () => {
    const onOpen = vi.fn();
    render(<SubagentsStrip
      sessions={[s({ id: 'demo-eng-1234', subagents: [sub('x', 'A thing')] })]}
      roster={[]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    await userEvent.click(screen.getByRole('button', { name: /eng-1234/ }));
    expect(onOpen).toHaveBeenCalledWith('demo-eng-1234');
  });
});

describe('subagentDescription — the single reader for an ADDITIVE field', () => {
  // The two render sites are pinned above and in session-line.test.tsx; this
  // pins the RULE, including the one arm no writer in this tree can currently
  // reach. `readLaunchRecord` already refuses a blank description server-side,
  // so `''` arrives only from a peer that does not — which is exactly the
  // absence-permits case a single reader exists to absorb, and an untested
  // clause is a claim rather than a mechanism.
  it('folds every not-a-description to null, and passes a real one through', () => {
    expect(subagentDescription({ description: 'Judge offline evidence' })).toBe('Judge offline evidence');
    expect(subagentDescription({ description: null }), 'an explicit null').toBeNull();
    expect(subagentDescription({}), 'the key OMITTED — the cast-frame case').toBeNull();
    expect(subagentDescription({ description: undefined }), 'an explicit undefined').toBeNull();
    expect(subagentDescription({ description: '' }), 'empty is not a description').toBeNull();
    expect(subagentDescription({ description: '   ' }), 'whitespace is not a description').toBeNull();
    expect(subagentDescription({ description: '\t\n ' }), 'nor other blanks').toBeNull();
  });

  it('does NOT trim what it returns — the server already did', () => {
    // `readLaunchRecord` stores `o['description'].trim()`, so padding here
    // means a peer that did not trim, and silently rewriting its text would
    // make this reader a second authority on the value instead of a guard on
    // its absence.
    expect(subagentDescription({ description: '  padded  ' })).toBe('  padded  ');
  });
});
