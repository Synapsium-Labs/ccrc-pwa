// The fleet-wide subagent list. The properties worth pinning are the ones that
// keep it honest: an idle fleet pays nothing, a DEAD session's stale roster is
// never listed, and no copy claims the roster is live.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
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
      s({ id: 'dead', bucket: 'dead', subagents: [sub('ghost', 'Should not appear'), sub('g2', 'Nor this')] }),
      s({ id: 'live', subagents: [sub('real', 'Should appear')] }),
    ]);
    expect(await screen.findByText('1 subagent · 1 session')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
    expect(screen.queryByText('Should not appear')).toBeNull();
    expect(screen.queryByText('Nor this')).toBeNull();
    expect(screen.getByText('Should appear')).toBeTruthy();
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
