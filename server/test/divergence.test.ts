// §1.6's census. THE ENFORCEMENT CLAUSE IS ONLY REAL IF THE CLASSES ARE
// INDIVIDUALLY PINNED: one test per kind, each red when its kind is deleted.
import { describe, it, expect } from 'vitest';
import { DIVERGENCE_KINDS, SESSION_LIFECYCLES, isDivergenceKind } from '../../shared/api.js';
import { divergences, unclaimedWorktrees, type DivergenceInput } from '../src/divergence.js';

const rec = (over: Partial<DivergenceInput['records'][number]> = {}) => ({
  id: 'demo-quiet-basin', project: 'demo', workspace: 'quiet-basin',
  workdir: '/home/u/worktrees/demo/quiet-basin', branch: 'ws/quiet-basin',
  held: null as string | null, archivedAt: null as number | null, ...over,
});

/** The registry directory listing for one healthy `demo-quiet-basin`, in
 *  `cmd_ws_add`'s own write order — the second half of the claim evidence. */
const REG_NAMES = ['wrapper', 'project', 'workdir', 'uuid', 'workspace', 'base', 'branch']
  .map((f) => `demo-quiet-basin.${f}`);

/** `unclaimedLastSweep` defaults to EMPTY, so a test that wants an
 *  `unregistered-worktree` reported has to say that the previous sweep saw it
 *  too. That is the debounce, and making every such test spell it is the point:
 *  a single observation is not a finding. */
const input = (over: Partial<DivergenceInput> = {}): DivergenceInput => ({
  records: [rec()],
  worktrees: [{ project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' }],
  headBranch: new Map([['demo/quiet-basin', 'ws/quiet-basin']]),
  openRunSessionIds: new Set<string>(),
  registryNames: REG_NAMES,
  unclaimedLastSweep: new Set<string>(),
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
      unclaimedLastSweep: new Set(['demo/alertwire']),
    }));
    expect(out).toEqual([{ kind: 'unregistered-worktree', id: null,
      path: '/home/u/worktrees/alertwire', detail: expect.any(String) }]);
  });

  it('THE FIRST SIGHTING IS NOT A FINDING — one interval of evidence, then the name', () => {
    // The debounce, in the shape the sweep actually runs it: the same input as
    // the test above with an EMPTY memory says nothing, and the second pass —
    // which is handed the first pass's own measurement — names it. What this
    // buys is the instant no signal can cover: `git worktree add` writes
    // `.git/worktrees/<slug>/` before it starts the checkout, and on a large
    // repo the checkout is not milliseconds, so a sweep can land with git's
    // record present and ccd's first `_reg_set` not yet run.
    const worktrees = [
      { project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' },
      { project: 'demo', name: 'alertwire', path: '/home/u/worktrees/alertwire' },
    ];
    expect(divergences(input({ worktrees })), 'a first sighting was reported as a finding').toEqual([]);
    const seen = unclaimedWorktrees(input({ worktrees }));
    expect(seen).toEqual(['demo/alertwire']);
    expect(divergences(input({ worktrees, unclaimedLastSweep: new Set(seen) })))
      .toEqual([{ kind: 'unregistered-worktree', id: null,
                  path: '/home/u/worktrees/alertwire', detail: expect.any(String) }]);
  });

  describe('a workspace mid-ws-add is CLAIMED, though no parsed row says so', () => {
    // The false positive this rule exists for, and it would have fired on every
    // single `ws-add`: git writes `.git/worktrees/<slug>/` first, then ccd
    // writes the registry field by field — `.wrapper`, `.project`, `.workdir`,
    // `.uuid`, `.workspace`. `readRegistry` derives its ids from `*.uuid`, so
    // there is no row at all until the fourth write, and the row that appears
    // then still has a null `workspace` until the fifth. Both states are
    // seeded below EXACTLY as ccd leaves them, and neither may be reported —
    // the repair this kind points at (`ws-gc`) deletes worktrees.
    const mid = (names: string[], records: DivergenceInput['records']) => divergences(input({
      records,
      worktrees: [{ project: 'demo', name: 'newborn', path: '/home/u/worktrees/demo/newborn' }],
      headBranch: new Map(),
      registryNames: [...REG_NAMES, ...names],
      // The worst case for the fix: the PREVIOUS sweep saw it unclaimed, so the
      // debounce is spent and only the claim rule can be doing the work here.
      unclaimedLastSweep: new Set(['demo/newborn']),
    }));

    it('after `.wrapper`, before `.uuid` — no row exists yet, and the listing is the only evidence', () => {
      expect(mid(['demo-newborn.wrapper', 'demo-newborn.project', 'demo-newborn.workdir'], [rec()]))
        .toEqual([]);
    });

    it('after `.uuid`, before `.workspace` — the row exists and claims no workspace', () => {
      expect(mid(
        ['demo-newborn.wrapper', 'demo-newborn.project', 'demo-newborn.workdir', 'demo-newborn.uuid'],
        [rec(), rec({ id: 'demo-newborn', workspace: null, branch: null,
                      workdir: '/home/u/worktrees/demo/newborn' })],
      )).toEqual([]);
    });

    it('residue alone claims it too — the same any-field rule `_ws_slug_free` refuses a slug on', () => {
      // Verification round 3, P1: an interrupted purge leaves `.archived` and
      // `.reaping` behind, and ccd will not hand that slug out again. Calling
      // its worktree unclaimed would contradict the writer.
      expect(mid(['demo-newborn.reaping'], [rec()])).toEqual([]);
    });

    it('a NESTED id\'s field is not evidence for this one — ccd\'s own dot rule', () => {
      // `_ws_slug_free` skips a suffix that holds a further dot: `x.hookstate.json`
      // is a field of `x.hookstate`, not of `x`. So a listing that only holds
      // those is no claim at all, and the worktree is named.
      expect(mid(['demo-newborn.hookstate.json'], [rec()]))
        .toEqual([{ kind: 'unregistered-worktree', id: null,
                    path: '/home/u/worktrees/demo/newborn', detail: expect.any(String) }]);
    });

    describe('and the relation to `ws-gc`, the repair this kind names, holds in BOTH directions', () => {
      // The two predicates are deliberately different (see `unclaimedWorktrees`'s
      // own docstring for the full set relation). What has to stay true is the
      // DIRECTION of the difference, and neither half was pinned before: the
      // tests above all prove the census is wider on claim than `.uuid`, and none
      // proved it never goes NARROWER than it.

      it('`.uuid` ALONE claims it — the census never names what ws-gc would call tracked', () => {
        // `[[ ! -f "$REG/$project-$slug.uuid" ]]` is ws-gc's whole orphan test.
        // So everything this census names must have no `.uuid`, or it would be
        // naming a divergence whose repair reads the slug as a live workspace
        // and refuses to touch it. `.uuid` is a suffix with no further dot, so
        // the any-field rule already covers it — this asserts that it does,
        // because every other test here proves the claim through some OTHER
        // field and a narrowing that dropped `.uuid` specifically would pass
        // all of them.
        expect(mid(['demo-newborn.uuid'], [rec()])).toEqual([]);
      });

      it('`.archived` alone claims it, though ws-gc would call that same slug an ORPHAN', () => {
        // The deliberate direction, and it is not symmetric with the one above.
        // `_ws_gc_row` tests orphan FIRST — before `.reaping` and before
        // `.archived` — so a residue with no `.uuid` reads as `orphan` there
        // while it reads as CLAIMED here. That silence is the point: this kind's
        // repair deletes worktrees, `_ws_slug_free` will not re-hand this slug
        // out, and naming it would contradict the writer.
        expect(mid(['demo-newborn.archived'], [rec()])).toEqual([]);
      });
    });
  });

  describe('the FLAT layout, with GIT\'S OWN admin name — not the one a fixture wishes for', () => {
    // MEASURED, 2026-08-17, `/…/projects/custom-tools/.git/worktrees/`:
    //
    //   brisk-ridge             gitdir -> /home/u/worktrees/custom-tools/brisk-ridge/.git
    //   calm-river              gitdir -> /home/u/worktrees/custom-tools/calm-river/.git
    //   dat30-consumer          gitdir -> /home/u/worktrees/custom-tools/dat30-consumer/.git
    //   custom-tools-alertwire  gitdir -> /home/u/worktrees/custom-tools-alertwire/.git
    //
    // The admin directory's name is the LAST SEGMENT OF THE CHECKOUT PATH, whatever
    // that path is — `<slug>` under the nested layout ccd builds, and the WHOLE
    // `<project>-<slug>` directory under the flat one. These tests used to pass
    // `name: 'alertwire'` for the flat row, which is not a name git has ever
    // written; that fixture is what let the id derivation below stay wrong.
    const flat = (over: Partial<DivergenceInput> = {}) => input({
      records: [],
      headBranch: new Map(),
      registryNames: [],
      worktrees: [{ project: 'custom-tools', name: 'custom-tools-alertwire',
                    path: '/home/u/worktrees/custom-tools-alertwire' }],
      unclaimedLastSweep: new Set(['custom-tools/custom-tools-alertwire']),
      ...over,
    });

    it('finds a FLAT worktree, not only a nested one', () => {
      // A detector globbing `~/worktrees/*/*/` misses it — which is why this reads
      // git's OWN admin records rather than the directory layout.
      expect(divergences(flat()).map((d) => d.kind)).toEqual(['unregistered-worktree']);
    });

    it('a registry row DOES claim it, and the claim is seen — the id comes from the PATH', () => {
      // The defect this pins. Composing `${project}-${name}` out of git's admin
      // name reads the flat worktree as `custom-tools-custom-tools-alertwire`,
      // an id no registry row can ever hold — so the claim below could never
      // match and the census named this worktree on EVERY sweep, for ever, on
      // the one kind whose repair deletes worktrees.
      expect(divergences(flat({ registryNames: ['custom-tools-alertwire.uuid'] }))).toEqual([]);
    });

    it('and a stranger\'s id is still not a claim', () => {
      // The other direction, so the fix cannot be "match anything that looks
      // close": `custom-tools-alertwire` is the id, and `custom-tools-alert` is
      // a different workspace's.
      expect(divergences(flat({ registryNames: ['custom-tools-alert.uuid'] }))
        .map((d) => d.kind)).toEqual(['unregistered-worktree']);
    });
  });

  describe('a NESTED slug that itself begins with the project name', () => {
    // Why the layout is settled by the PARENT DIRECTORY and never by a prefix
    // test on the name. `~/worktrees/demo/demo-fix` is ccd's `demo-demo-fix`,
    // while `~/worktrees/demo-fix` is `demo-fix` — the two are different
    // workspaces whose admin names are the same string, and only the path tells
    // them apart. A heuristic (`name.startsWith(project + '-') ? name : …`)
    // reads the nested one as `demo-fix` and hands a stranger's registry row
    // the power to claim it.
    const nested = (registryNames: string[]) => divergences(input({
      records: [],
      headBranch: new Map(),
      registryNames,
      worktrees: [{ project: 'demo', name: 'demo-fix',
                    path: '/home/u/worktrees/demo/demo-fix' }],
      unclaimedLastSweep: new Set(['demo/demo-fix']),
    }));

    it('is claimed by `demo-demo-fix`, its real id', () => {
      expect(nested(['demo-demo-fix.uuid'])).toEqual([]);
    });

    it('is NOT claimed by `demo-fix`, which names the flat worktree beside it', () => {
      expect(nested(['demo-fix.uuid']).map((d) => d.kind)).toEqual(['unregistered-worktree']);
    });
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
      registryNames: ['demo-quiet-basin', 'demo-still-cove', 'demo-warm-ridge']
        .flatMap((id) => [`${id}.uuid`, `${id}.workspace`]),
      unclaimedLastSweep: new Set(['demo/nobody']),
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
