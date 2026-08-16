// §1.6's census. THE ENFORCEMENT CLAUSE IS ONLY REAL IF THE CLASSES ARE
// INDIVIDUALLY PINNED: one test per kind, each red when its kind is deleted.
import { describe, it, expect } from 'vitest';
import { DIVERGENCE_KINDS, SESSION_LIFECYCLES, isDivergenceKind } from '../../shared/api.js';
import { divergences, type DivergenceInput } from '../src/divergence.js';

const rec = (over: Partial<DivergenceInput['records'][number]> = {}) => ({
  id: 'demo-quiet-basin', project: 'demo', workspace: 'quiet-basin',
  workdir: '/home/u/worktrees/demo/quiet-basin', branch: 'ws/quiet-basin',
  held: null as string | null, archivedAt: null as number | null, ...over,
});

const input = (over: Partial<DivergenceInput> = {}): DivergenceInput => ({
  records: [rec()],
  worktrees: [{ project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' }],
  headBranch: new Map([['demo/quiet-basin', 'ws/quiet-basin']]),
  openRunSessionIds: new Set<string>(),
  ...over,
});

describe('divergences — the three kinds, individually', () => {
  it('A HEALTHY FLEET PRODUCES AN EMPTY CENSUS', () => {
    // The direction that decides whether the surface is ignorable. A census that
    // is never empty is a census nobody reads.
    expect(divergences(input())).toEqual([]);
  });

  it('unregistered-worktree: git records a worktree no registry row claims', () => {
    const out = divergences(input({
      worktrees: [
        { project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' },
        { project: 'demo', name: 'alertwire', path: '/home/u/worktrees/alertwire' },
      ],
    }));
    expect(out).toEqual([{ kind: 'unregistered-worktree', id: null,
      path: '/home/u/worktrees/alertwire', detail: expect.any(String) }]);
  });

  it('finds a FLAT worktree, not only a nested one', () => {
    // Measured live: `custom-tools-alertwire` sits directly under `~/worktrees/`.
    // A detector globbing `~/worktrees/*/*/` misses it — which is why this reads
    // git's OWN admin records rather than the directory layout.
    const out = divergences(input({
      records: [],
      worktrees: [{ project: 'custom-tools', name: 'alertwire',
                    path: '/home/u/worktrees/custom-tools-alertwire' }],
    }));
    expect(out.map((d) => d.kind)).toEqual(['unregistered-worktree']);
  });

  it('branch-drift: the registry and the worktree HEAD name different branches', () => {
    const out = divergences(input({ headBranch: new Map([['demo/quiet-basin', 'feat/renamed']]) }));
    expect(out).toEqual([{ kind: 'branch-drift', id: 'demo-quiet-basin',
      path: '/home/u/worktrees/demo/quiet-basin', detail: expect.stringContaining('feat/renamed') }]);
  });

  it('a HEAD that could not be read yields NO drift — not knowing is not a disagreement', () => {
    expect(divergences(input({ headBranch: new Map([['demo/quiet-basin', null]]) }))).toEqual([]);
    expect(divergences(input({ headBranch: new Map() }))).toEqual([]);
  });

  it('a registry row with no branch of its own yields no drift either', () => {
    expect(divergences(input({ records: [rec({ branch: null })] }))).toEqual([]);
  });

  it('an ARCHIVED row never drifts — its worktree is gone by construction', () => {
    expect(divergences(input({
      records: [rec({ archivedAt: 1_785_300_000 })],
      headBranch: new Map([['demo/quiet-basin', 'feat/renamed']]),
    }))).toEqual([]);
  });

  it('claim-divergence: a hold with no open run', () => {
    const out = divergences(input({ records: [rec({ held: 'program:build8 wave:2/4' })] }));
    expect(out).toEqual([{ kind: 'claim-divergence', id: 'demo-quiet-basin', path: null,
      detail: expect.any(String) }]);
  });

  it('claim-divergence: an open run whose session has no hold', () => {
    const out = divergences(input({ openRunSessionIds: new Set(['demo-quiet-basin']) }));
    expect(out).toEqual([{ kind: 'claim-divergence', id: 'demo-quiet-basin', path: null,
      detail: expect.any(String) }]);
  });

  it('a hold WITH its open run is not a divergence', () => {
    expect(divergences(input({
      records: [rec({ held: 'program:build8 wave:2/4' })],
      openRunSessionIds: new Set(['demo-quiet-basin']),
    }))).toEqual([]);
  });

  it('an open run naming a session with no registry row at all is a claim-divergence', () => {
    const out = divergences(input({ records: [], worktrees: [],
      openRunSessionIds: new Set(['demo-gone']) }));
    expect(out).toEqual([{ kind: 'claim-divergence', id: 'demo-gone', path: null,
      detail: expect.any(String) }]);
  });

  it('a fixture with one row in EACH class produces exactly that census and no more', () => {
    const out = divergences({
      records: [
        rec(),
        rec({ id: 'demo-still-cove', workspace: 'still-cove',
              workdir: '/home/u/worktrees/demo/still-cove', branch: 'ws/still-cove' }),
        rec({ id: 'demo-warm-ridge', workspace: 'warm-ridge',
              workdir: '/home/u/worktrees/demo/warm-ridge', branch: 'ws/warm-ridge',
              held: 'program:x wave:1/2' }),
      ],
      worktrees: [
        { project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' },
        { project: 'demo', name: 'still-cove', path: '/home/u/worktrees/demo/still-cove' },
        { project: 'demo', name: 'warm-ridge', path: '/home/u/worktrees/demo/warm-ridge' },
        { project: 'demo', name: 'nobody', path: '/home/u/worktrees/demo/nobody' },
      ],
      headBranch: new Map([
        ['demo/quiet-basin', 'ws/quiet-basin'],
        ['demo/still-cove', 'feat/renamed'],
        ['demo/warm-ridge', 'ws/warm-ridge'],
      ]),
      openRunSessionIds: new Set<string>(),
    });
    expect(out.map((d) => d.kind).sort()).toEqual(
      ['branch-drift', 'claim-divergence', 'unregistered-worktree']);
  });
});

describe('the vocabulary', () => {
  it('is exactly three kinds — dead-row/unsupervised/not-boot-persistent are DELETED', () => {
    expect([...DIVERGENCE_KINDS].sort()).toEqual(
      ['branch-drift', 'claim-divergence', 'unregistered-worktree']);
    // `dead-row` IS `lifecycle === 'orphan'` and strictly broader; the other two
    // would cost one `ws-audit` exec per session per sweep (see the type's own
    // docstring — the objection is COST, not capability: ws-audit is already
    // whitelisted and now reports `unit`).
    for (const dead of ['dead-row', 'unsupervised', 'not-boot-persistent', 'unclaimed-session']) {
      expect(isDivergenceKind(dead)).toBe(false);
    }
  });

  it('shares NO token with SessionLifecycle — a second name for one fact is the defect', () => {
    for (const k of DIVERGENCE_KINDS) {
      expect((SESSION_LIFECYCLES as readonly string[]).includes(k)).toBe(false);
    }
  });
});
