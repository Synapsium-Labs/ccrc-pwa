// Workspace lifecycle wave 2 (spec §5.2): the archive door's L0 vocabulary and the two predicates the board and the
// door share — `inArchivedFold` (the Archived fold's one membership rule) and `archiveInterrupts` (busy, either kind).
import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_REFUSALS, ARCHIVE_REFUSAL_CODES, ARCHIVE_STOP_ONLY, archiveInterrupts, archivedFoldSince, inArchivedFold,
  isArchiveRefusal, type FleetSession,
} from '../../shared/api.js';

const base: FleetSession = {
  id: 'demo-amber', wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: '/data/projects/demo',
  workspace: 'amber', name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
};
const row = (over: Partial<FleetSession>): FleetSession => ({ ...base, ...over });
const STOP = { at: 1_790_000_000_000, surface: 'pwa' as const };

describe('ARCHIVE_REFUSALS — the door vocabulary, declared once', () => {
  it('holds the spec\'s four codes and the three the phone cannot fix, and nothing else', () => {
    expect([...ARCHIVE_REFUSAL_CODES].sort()).toEqual([
      'coordinator-has-open-runs', 'manifest-unbuildable', 'programme-partly-ended', 'run-open',
      'session-busy', 'status-unknown', 'worktree-gone',
    ]);
    expect(ARCHIVE_REFUSAL_CODES).toEqual(Object.values(ARCHIVE_REFUSALS));
  });

  it('offers "Stop only" after exactly the three refusals the phone cannot fix', () => {
    expect([...ARCHIVE_STOP_ONLY].sort()).toEqual(['manifest-unbuildable', 'status-unknown', 'worktree-gone']);
    for (const c of ARCHIVE_STOP_ONLY) expect(ARCHIVE_REFUSAL_CODES).toContain(c);
  });

  it('isArchiveRefusal accepts exactly the codes', () => {
    for (const c of ARCHIVE_REFUSAL_CODES) expect(isArchiveRefusal(c)).toBe(true);
    for (const v of ['busy', 'Run-open', '', null, undefined, 7]) expect(isArchiveRefusal(v)).toBe(false);
  });
});

describe('inArchivedFold — every row shape (spec §5.2)', () => {
  it.each([
    ['an archived workspace', row({ status: 'dead', archivedAt: 1_790_000_000, bucket: 'archived', bucketSince: 1 }), true],
    ['a stopped main checkout', row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: STOP }), true],
    ['a main checkout started again — the stop stamp is gone', row({ workspace: null, status: 'idle', stoppedBy: null }), false],
    ['a main checkout that is live while the stamp still reads (a revive in flight)',
      row({ workspace: null, status: 'busy', bucket: 'working', stoppedBy: STOP }), false],
    ['a crashed main checkout — dead, never stopped', row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: null }), false],
    ['a stopped WORKSPACE that is not archived — it stays top-level with Archive again',
      row({ status: 'dead', bucket: 'dead', stoppedBy: STOP }), false],
    ['a merged-and-archived workspace — `cleanup` stays in the live list', row({
      status: 'dead', archivedAt: 1_790_000_000, bucket: 'cleanup', bucketSince: 1, stoppedBy: STOP,
    }), false],
    ['a live idle workspace', row({}), false],
  ] as const)('%s', (_label, s, want) => {
    expect(inArchivedFold(s)).toBe(want);
  });

  it('reads a row from a server older than `stoppedBy` (the key absent on a cast frame) as not folded', () => {
    const { stoppedBy: _drop, ...rest } = row({ workspace: null, status: 'dead', bucket: 'dead' });
    expect(inArchivedFold(rest as FleetSession)).toBe(false);
  });
});

describe('archivedFoldSince — the fold\'s sort key', () => {
  it('is the archive time for a workspace, the stop time for a main checkout, null for neither', () => {
    expect(archivedFoldSince(row({ bucket: 'archived', bucketSince: 1234, stoppedBy: STOP }))).toBe(1234);
    expect(archivedFoldSince(row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: STOP }))).toBe(STOP.at);
    expect(archivedFoldSince(row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: null }))).toBeNull();
  });
});

describe('archiveInterrupts — busy, either kind', () => {
  it.each([
    ['Claude Code\'s own word is busy', row({ status: 'busy', bucket: 'working' }), true],
    ['the live file says busy but the hook says the turn finished', row({ status: 'busy', bucket: 'done' }), true],
    ['the hook says a turn is in flight while the live file reads idle', row({ status: 'idle', bucket: 'working' }), true],
    ['a question is waiting on the operator', row({ status: 'idle', bucket: 'attention' }), true],
    ['idle', row({ status: 'idle', bucket: 'idle' }), false],
    ['done', row({ status: 'idle', bucket: 'done' }), false],
    ['dead', row({ status: 'dead', bucket: 'dead' }), false],
    ['archived', row({ status: 'dead', bucket: 'archived' }), false],
  ] as const)('%s', (_label, s, want) => {
    expect(archiveInterrupts(s)).toBe(want);
  });
});
