// The palette's one session builder (D-6714, plan 2026-10-22-desktop-polish Task T5a): every session's entry and the
// terms it is found by, the same for the top search and the "Open session…" page. Every found or not-found case asks
// through `rankCommands`, never the `terms` array, so a term that is listed but never scored reds as surely as one that
// is missing; the tier and label cases read the entry itself.
import { describe, expect, it, vi } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { rankCommands, type CommandContext } from '../src/command/registry';
import { sessionEntries } from '../src/command/sessionEntries';
import { sessionLabel } from '../src/fleet/sessionLabel';
import { fleetSession } from './fleetFixture';

const worker = fleetSession({
  id: 'project-a-one', project: 'project-a', name: 'first', workspace: 'ws-a', branch: 'ws/ws-a', bucket: 'attention',
});
const lead = fleetSession({ id: 'project-a-lead', project: 'project-a', name: 'lead', role: 'coordinator', bucket: 'idle' });

/** A run with only the fields the builder reads named; the rest are a working wave's. */
const run = (over: Partial<RunSummary>): RunSummary => ({
  id: 1, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  state: 'working', closedAt: null, claimedBy: null, sessionId: null, kind: 'work',
  ...over,
} as RunSummary);

const found = (q: string, sessions: readonly FleetSession[], runs: readonly RunSummary[] = []): string[] =>
  rankCommands(q, sessionEntries(sessions, runs, 'top')).map((c) => c.id);

describe('sessionEntries (D-6714)', () => {
  it('an entry is titled sessionLabel, grouped by its project, and its run opens /s/<encoded id>', () => {
    const odd = fleetSession({ id: 'project-a/odd id', project: 'project-a', branch: 'feature-x' });
    const [e] = sessionEntries([odd], [], 'top');
    expect(e!.id).toBe('open-session-project-a/odd id');
    expect(e!.title).toBe(sessionLabel(odd));
    expect(e!.group).toBe('project-a');
    const navigate = vi.fn();
    e!.run({ navigate } as unknown as CommandContext);
    expect(navigate).toHaveBeenCalledWith(`/s/${encodeURIComponent('project-a/odd id')}`);
  });

  it('a session is found by its workspace slug, its branch, its project and its card', () => {
    const s = fleetSession({
      id: 'x-1', project: 'project-a', name: 'first', workspace: 'ws-slug', branch: 'feature-branch', boardProject: 'card-b',
    });
    const other = fleetSession({ id: 'y-1', project: 'project-z', name: 'zed' });
    expect(found('ws-slug', [s, other])).toEqual(['open-session-x-1']);
    expect(found('feature-branch', [s, other])).toEqual(['open-session-x-1']);
    expect(found('project-a', [s, other])).toEqual(['open-session-x-1']);
    expect(found('card-b', [s, other])).toEqual(['open-session-x-1']);
    expect(found('first', [s, other]), 'and by its title, as the page always was').toEqual(['open-session-x-1']);
  });

  it('a null workspace and branch are not terms, and ranking such a session never throws', () => {
    const bare = fleetSession({ id: 'bare', project: 'project-a', name: 'bare', workspace: null, branch: null });
    const blank = fleetSession({ id: 'blank', project: 'project-a', name: 'blank', workspace: '  ', branch: '' });
    expect(() => found('null', [bare, blank])).not.toThrow();
    expect(found('null', [bare, blank]), 'a null is never the word "null"').toEqual([]);
    expect(found('undefined', [bare, blank])).toEqual([]);
  });

  it("a session that claims an open run is found by that programme's title and slug; a closed run's programme finds nothing", () => {
    const runs = [
      run({ id: 1, program: 'prog-a', programTitle: 'Programme A', claimedBy: lead.id }),
      run({ id: 2, program: 'prog-b', programTitle: 'Programme B', claimedBy: lead.id, state: 'done' }),
    ];
    expect(found('Programme A', [worker, lead], runs)).toEqual([`open-session-${lead.id}`]);
    expect(found('prog-a', [worker, lead], runs)).toEqual([`open-session-${lead.id}`]);
    expect(found('Programme B', [worker, lead], runs)).toEqual([]);
    expect(found('prog-b', [worker, lead], runs)).toEqual([]);
  });

  it("a worker is not found by its coordinator's programme", () => {
    const runs = [run({ claimedBy: lead.id, sessionId: worker.id, state: 'working', program: 'prog-a', programTitle: 'Programme A' })];
    const ids = found('Programme A', [worker, lead], runs);
    expect(ids).toContain(`open-session-${lead.id}`);
    expect(ids).not.toContain(`open-session-${worker.id}`);
    expect(found('prog-a', [worker, lead], runs)).not.toContain(`open-session-${worker.id}`);
  });

  it("labels are exact: a worker's is 'first, project-a', a coordinator's 'lead, coordinator, project-a'", () => {
    const [w, l] = sessionEntries([worker, lead], [], 'top');
    expect(w!.label).toBe('first, project-a');
    expect(l!.label).toBe('lead, coordinator, project-a');
    expect(w!.group).toBe('project-a');
    expect(l!.group).toBe('coordinator · project-a');
  });

  it('tiers: coordinator 1, worker 2, exited 3 whatever the role', () => {
    const deadLead = fleetSession({ id: 'dl', project: 'project-a', role: 'coordinator', bucket: 'dead', status: 'dead' });
    const deadWorker = fleetSession({ id: 'dw', project: 'project-a', bucket: 'dead', status: 'dead' });
    expect(sessionEntries([lead, worker, deadLead, deadWorker], [], 'top').map((e) => e.tier)).toEqual([1, 2, 3, 3]);
  });

  it('a null or absent role is a worker, even when the session claims a run', () => {
    const claimant = fleetSession({ id: 'claimant', project: 'project-a', name: 'claimant', role: null });
    // An older server's row: no `role` key at all.
    const { role: _role, ...rest } = fleetSession({ id: 'absent', project: 'project-a', name: 'absent' });
    const absent = rest as unknown as FleetSession;
    expect('role' in absent).toBe(false);
    const runs = [run({ claimedBy: 'claimant' }), run({ id: 2, claimedBy: 'absent' })];
    const entries = sessionEntries([claimant, absent], runs, 'top');
    expect(entries.map((e) => e.tier)).toEqual([2, 2]);
    expect(entries.map((e) => e.label)).toEqual(['claimant, project-a', 'absent, project-a']);
    expect(found('Programme A', [claimant, absent], runs), 'the programme terms still go to the claimant')
      .toEqual(['open-session-claimant', 'open-session-absent']);
  });

  it("'top' entries are search-only; 'page' entries are not, and are otherwise equal", () => {
    const runs = [run({ claimedBy: lead.id })];
    const strip = (e: { run: unknown; searchOnly?: boolean }): object => {
      const { run: _run, searchOnly: _so, ...rest } = e;
      return rest;
    };
    const top = sessionEntries([worker, lead], runs, 'top');
    const page = sessionEntries([worker, lead], runs, 'page');
    expect(top.map((e) => e.searchOnly)).toEqual([true, true]);
    expect(page.map((e) => e.searchOnly === true)).toEqual([false, false]);
    expect(page.map(strip)).toEqual(top.map(strip));
    expect(rankCommands('', page).map((c) => c.id), "the page's empty list is the whole fleet, in its order")
      .toEqual([`open-session-${worker.id}`, `open-session-${lead.id}`]);
  });
});
