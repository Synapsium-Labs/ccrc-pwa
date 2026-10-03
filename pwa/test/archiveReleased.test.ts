import { describe, it, expect, vi } from 'vitest';
import { archivableReleased, archiveReleased, archiveReleasedSummary } from '../src/fleet/archiveReleased';
import type { FleetSession, ReleasedFrom } from '../../shared/api';

const rel = (child = false): ReleasedFrom =>
  ({ runId: 1, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt: 100, child });

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: 'w', name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: rel(), ...over,
});

const deps = (rows: FleetSession[], archive: (id: string) => Promise<unknown> = vi.fn(async () => undefined)) => ({
  current: (id: string) => rows.find((r) => r.id === id),
  archive,
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
});

describe('archivableReleased', () => {
  it('is a folded row that is not a child', () => {
    expect(archivableReleased(s({}))).toBe(true);
    expect(archivableReleased(s({ releasedFrom: rel(true) }))).toBe(false);
    expect(archivableReleased(s({ bucket: 'working' }))).toBe(false);
    expect(archivableReleased(s({ releasedFrom: null }))).toBe(false);
  });

  it('reads the child flag off releasedFrom, not off FleetSession.child — one decision, one field', () => {
    expect(archivableReleased(s({ child: { kind: 'child', runId: 7 } }))).toBe(true);
  });
});

describe('archiveReleased — plain archives, one at a time', () => {
  it('sends each row with its id ALONE — never force, never any option', async () => {
    const archive = vi.fn(async (_id: string): Promise<unknown> => undefined);
    const rows = [s({ id: 'a' }), s({ id: 'b' })];
    const out = await archiveReleased(['a', 'b'], deps(rows, archive));
    expect(archive.mock.calls).toEqual([['a'], ['b']]);
    expect(out).toEqual({ archived: ['a', 'b'], skipped: [], refused: [] });
  });

  it('is sequential — the second request starts only after the first settles', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const archive = vi.fn(async (id: string) => {
      order.push(`start ${id}`);
      if (id === 'a') await gate;
      order.push(`end ${id}`);
    });
    const done = archiveReleased(['a', 'b'], deps([s({ id: 'a' }), s({ id: 'b' })], archive));
    await Promise.resolve();
    expect(order).toEqual(['start a']);
    release();
    await done;
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('skips a child, and a row that left the fold or the fleet before its turn — re-read each time', async () => {
    const rows = [s({ id: 'a' }), s({ id: 'kid', releasedFrom: rel(true) }), s({ id: 'busy' })];
    const archive = vi.fn(async (id: string) => {
      // The first archive lands, and meanwhile `busy` starts a turn: the NEXT read must see it.
      if (id === 'a') rows[2] = s({ id: 'busy', bucket: 'working' });
    });
    const out = await archiveReleased(['a', 'kid', 'busy', 'gone'], deps(rows, archive));
    expect(archive.mock.calls).toEqual([['a']]);
    expect(out).toEqual({ archived: ['a'], skipped: ['kid', 'busy', 'gone'], refused: [] });
  });

  it('a refusal is kept with its reason and does not stop the loop', async () => {
    const archive = vi.fn(async (id: string) => { if (id === 'a') throw new Error('busy: a turn is in progress'); });
    const out = await archiveReleased(['a', 'b'], deps([s({ id: 'a' }), s({ id: 'b' })], archive));
    expect(out).toEqual({ archived: ['b'], skipped: [], refused: [{ id: 'a', reason: 'busy: a turn is in progress' }] });
  });
});

describe('archiveReleasedSummary', () => {
  it('counts, and names every refusal with the server’s reason', () => {
    expect(archiveReleasedSummary({ archived: ['a'], skipped: ['k'], refused: [] }))
      .toBe('Archived 1, skipped 1, refused 0.');
    expect(archiveReleasedSummary({ archived: [], skipped: [], refused: [{ id: 'a', reason: 'busy' }, { id: 'b', reason: 'gone' }] }))
      .toBe('Archived 0, skipped 0, refused 2: a — busy; b — gone');
  });
});
