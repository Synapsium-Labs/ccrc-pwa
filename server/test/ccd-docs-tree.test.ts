// `docs-tree`'s ref resolution, pinned as helper units (docs reader spec 2026-10-01 §2 (c); §2 (j) rows 17-23 and
// R11's shallow case). Each case builds a fixture project, finds it with the shipped helper's own `discover`, and
// calls `resolve` (or one of its parts) directly through `unitJson`, which imports `_docs_py` out of `ccd/ccd` as a
// module. The assembled verb lands later in the plan, with the end-to-end samples.
//
// Later tasks APPEND below, each under import names of its own. What this header gives every appended block:
// `describe`/`it`/`expect`, and `h`, a fresh `makeCcdHarness('ccd-docs-')` per test from the top-level hooks.
// Fixture refs are moved with `h.git` (the real binary, the fixture identity, the host PATH), never through the
// PATH recorder, so a recorder planted here sees only the helper's own calls.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { docsHelperSource, pyLiteral, unitJson } from './docsHelperPy.js';
import { commitOn, danglingOriginHead, plantGitRecorder, setOriginHead, shapeBranch } from './ccdDocsHelpers.js';

type Tried = { ref: string; result: string };
type Counterpart = { ref: string; commit: string; ahead: number | null; behind: number | null; count: string };
type Ref = {
  requested: string | null; served: string; name: string; side: 'local' | 'origin'; commit: string;
  via: string; tried: Tried[]; relation: string; counterpart: Counterpart | null;
};
type Failed = {
  ok: false; failure: string; tried?: Tried[]; suggest?: string; hint?: string; ref?: string; type?: string;
  step?: string; rc?: number; stderrHead?: string;
};
type Answer = { ok: true; value: Ref } | Failed;

const ORIGIN_HEAD = 'refs/remotes/origin/HEAD';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-'); });
afterEach(() => { h.cleanup(); });

/** A python string literal, or None. Every value these units pass is ASCII. */
const pyStr = (s: string | null): string => (s === null ? 'None' : JSON.stringify(s));

/** Python that discovers `project` in `h`'s fixture HOME exactly as a verb does, then prints `{ok:true, value:
 *  <expr>}` (`expr` may read `repo` and `dl`), or the `Fail` it raised as `{ok:false, failure, ...ctx}`. `pre` runs
 *  first, after `H` is loaded (a `Sys` swap). */
const unitBody = (project: string, expr: string, pre: readonly string[] = []): string => [
  ...pre,
  `ctx = H.Ctx('docs-tree', ${pyStr(path.join(h.home, 'projects'))}, ${pyStr(path.join(h.home, 'worktrees'))},`,
  `            ${pyStr(path.join(h.home, '.cc-sessions'))}, H.SYS.monotonic())`,
  "dl = H.Deadline(H.HELPER_DEADLINE_S['docs-tree'])",
  'try:',
  `    repo = H.discover(ctx, ${pyStr(project)}, dl)`,
  `    out({'ok': True, 'value': ${expr}})`,
  'except H.Fail as e:',
  '    out(dict(e.ctx, ok=False, failure=e.word))',
  '',
].join('\n');

/** A `Sys` whose `spawn` answers every git call whose argv carries `subcommand` as one that ran out (what the real
 *  spawn reports after its killpg), and runs every other call for real. */
const timesOut = (subcommand: string): string[] => [
  'class RunsOut(H.Sys):',
  '    def spawn(self, argv, *a, **k):',
  `        if ${pyStr(subcommand)} in argv:`,
  "            return H.Spawned(rc=-15, out=b'', err=b'', timed_out=True, overflow=False)",
  '        return H.Sys.spawn(self, argv, *a, **k)',
  'H.SYS = RunsOut()',
];

const resolveIn = (project: string, ref: string | null, pre: readonly string[] = []): Answer =>
  unitJson<Answer>(h.home, unitBody(project, `H.resolve(repo, ${pyStr(ref)}, dl)`, pre));
const served = (a: Answer): Ref => {
  expect(a, JSON.stringify(a)).toMatchObject({ ok: true });
  return (a as { ok: true; value: Ref }).value;
};
const refused = (a: Answer): Failed => {
  expect(a, JSON.stringify(a)).toMatchObject({ ok: false });
  return a as Failed;
};
const rev = (dir: string, ref: string): string => h.git(dir, 'rev-parse', ref);
const fer = (dir: string, fmt: string, pattern: string): string =>
  h.git(dir, 'for-each-ref', `--format=${fmt}`, pattern);

describe('docs ref resolution: the literal and the pure parts', () => {
  it('FER_FORMAT is §2 (c) 1\'s format, one line, bound once', () => {
    expect(pyLiteral(docsHelperSource(), 'FER_FORMAT'))
      .toBe("'%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)'");
  });

  it('parse_for_each_ref keys by exact refname; usable_commit peels a tag of a commit and nothing else', () => {
    const got = unitJson<{
      rows: Record<string, string[]>; usable: Record<string, string | null>; peeled: Record<string, string>;
      results: Record<string, string>; broken: [string, Record<string, unknown>] | null;
      counterparts: string[]; wire: string[];
    }>(h.home, String.raw`
canned = (b'refs/heads/a\x00commit\x00' + b'1' * 40 + b'\x00\x00\n'
          + b'refs/remotes/origin/t\x00tag\x00' + b'2' * 40 + b'\x00commit\x00' + b'3' * 40 + b'\n'
          + b'refs/remotes/origin/u\x00tag\x00' + b'4' * 40 + b'\x00blob\x00' + b'5' * 40 + b'\n'
          + b'refs/remotes/origin/v\x00tree\x00' + b'6' * 40 + b'\x00\x00\n')
rows = H.parse_for_each_ref(canned)
try:
    H.parse_for_each_ref(b'refs/heads/a\x00commit\n')
    broken = None
except H.Fail as e:
    broken = [e.word, e.ctx]
out({'rows': rows,
     'usable': dict((k, H.usable_commit(v)) for k, v in rows.items()),
     'peeled': dict((k, H.peeled_type(v)) for k, v in rows.items()),
     'results': dict((k, H.ref_result(rows.get(k))) for k in list(rows) + ['refs/heads/none']),
     'broken': broken,
     'counterparts': [H.counterpart_ref('refs/heads/ws/a'), H.counterpart_ref('refs/remotes/origin/ws/a')],
     'wire': [H.wire_relation('local', 'behind'), H.wire_relation('local', 'ahead'),
              H.wire_relation('origin', 'behind'), H.wire_relation('origin', 'ahead'),
              H.wire_relation('origin', 'diverged'), H.wire_relation('local', 'unmeasured')]})
`);
    const [c1, c2, c3, c4, c5, c6] = ['1', '2', '3', '4', '5', '6'].map((d) => d.repeat(40));
    expect(got.rows).toEqual({
      'refs/heads/a': ['commit', c1, '', ''],
      'refs/remotes/origin/t': ['tag', c2, 'commit', c3],
      'refs/remotes/origin/u': ['tag', c4, 'blob', c5],
      'refs/remotes/origin/v': ['tree', c6, '', ''],
    });
    expect(got.usable).toEqual({
      'refs/heads/a': c1, 'refs/remotes/origin/t': c3, 'refs/remotes/origin/u': null, 'refs/remotes/origin/v': null,
    });
    expect(got.peeled).toEqual({
      'refs/heads/a': 'commit', 'refs/remotes/origin/t': 'commit', 'refs/remotes/origin/u': 'blob',
      'refs/remotes/origin/v': 'tree',
    });
    expect(got.results).toEqual({
      'refs/heads/a': 'resolved', 'refs/remotes/origin/t': 'resolved', 'refs/remotes/origin/u': 'not-a-commit',
      'refs/remotes/origin/v': 'not-a-commit', 'refs/heads/none': 'absent',
    });
    expect(got.broken).toEqual(['git-failed', { step: 'for-each-ref', detail: 'a for-each-ref record with 2 fields' }]);
    expect(got.counterparts).toEqual(['refs/remotes/origin/ws/a', 'refs/heads/ws/a']);
    expect(got.wire).toEqual(['local-behind', 'local-ahead', 'local-ahead', 'local-behind', 'diverged', 'unmeasured']);
  });
});

describe('docs ref resolution: the default chain (row 19, MM4)', () => {
  it('origin/HEAD set: serves its target via default:origin-head; tried names origin/HEAD alone', () => {
    const main = h.makeRepo('demo');
    expect(served(resolveIn('demo', null))).toEqual({
      requested: null, served: 'refs/remotes/origin/main', name: 'main', side: 'origin',
      commit: rev(main, 'refs/remotes/origin/main'), via: 'default:origin-head',
      tried: [{ ref: ORIGIN_HEAD, result: 'resolved' }], relation: 'equal',
      counterpart: { ref: 'refs/heads/main', commit: rev(main, 'refs/heads/main'), ahead: 0, behind: 0, count: 'measured' },
    });
  });

  it('origin/HEAD at a branch that is not main: rung 1 serves the target, whose counterpart gets its own lookup', () => {
    const main = h.makeRepo('demo');
    const trunk = commitOn(h, main, rev(main, 'refs/heads/main'), 'trunk');
    h.git(main, 'update-ref', 'refs/remotes/origin/trunk', trunk);
    setOriginHead(h, main, 'refs/remotes/origin/trunk');
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/trunk', name: 'trunk', commit: trunk, via: 'default:origin-head',
      tried: [{ ref: ORIGIN_HEAD, result: 'resolved' }], relation: 'origin-only', counterpart: null,
    });
    // refs/heads/trunk is outside the chain's one for-each-ref, so only its own call can find it.
    h.git(main, 'update-ref', 'refs/heads/trunk', trunk);
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/trunk', relation: 'equal',
      counterpart: { ref: 'refs/heads/trunk', commit: trunk, ahead: 0, behind: 0, count: 'measured' },
    });
  });

  it('after `remote set-head -d`: default:origin-main, with tried[0] absent', () => {
    const main = h.makeRepo('demo');
    setOriginHead(h, main, null);
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/main', side: 'origin', via: 'default:origin-main',
      tried: [{ ref: ORIGIN_HEAD, result: 'absent' }, { ref: 'refs/remotes/origin/main', result: 'resolved' }],
    });
  });

  it('a dangling origin/HEAD: tried[0] dangling, then origin/main (MM4: only symbolic-ref sees it)', () => {
    const main = h.makeRepo('demo');
    danglingOriginHead(h, main);
    // CONTROL: for-each-ref omits the dangling symref without a word, so it alone could never say `dangling`.
    expect(fer(main, '%(refname)', ORIGIN_HEAD)).toBe('');
    expect(h.git(main, 'symbolic-ref', '-q', ORIGIN_HEAD)).toBe('refs/remotes/origin/gone');
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/main', via: 'default:origin-main',
      tried: [{ ref: ORIGIN_HEAD, result: 'dangling' }, { ref: 'refs/remotes/origin/main', result: 'resolved' }],
    });
  });

  it.each([
    ['outside refs/remotes/origin/', 'refs/heads/main'],
    ['outside the bare grammar, though git accepts it (R11)', 'refs/remotes/origin/x@y'],
  ])('an origin/HEAD target %s is malformed, and the chain moves on', (_what, target) => {
    const main = h.makeRepo('demo');
    setOriginHead(h, main, target);
    // CONTROL: git stored exactly that target.
    expect(h.git(main, 'symbolic-ref', '-q', ORIGIN_HEAD)).toBe(target);
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/main', via: 'default:origin-main',
      tried: [{ ref: ORIGIN_HEAD, result: 'malformed' }, { ref: 'refs/remotes/origin/main', result: 'resolved' }],
    });
  });

  it('master rungs: origin/master before any local rung, then local master', () => {
    const main = h.makeRepo('demo');
    setOriginHead(h, main, null);
    h.git(main, 'update-ref', 'refs/remotes/origin/master', rev(main, 'refs/remotes/origin/main'));
    h.git(main, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/master', via: 'default:origin-master' });
    h.git(main, 'remote', 'remove', 'origin');
    h.git(main, 'branch', '-m', 'main', 'master');
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/heads/master', side: 'local', via: 'default:local-master', relation: 'local-only', counterpart: null,
    });
  });

  it('no remotes: default:local-main, local-only, with every origin rung tried first', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'remote', 'remove', 'origin');
    expect(served(resolveIn('demo', null))).toEqual({
      requested: null, served: 'refs/heads/main', name: 'main', side: 'local', commit: rev(main, 'refs/heads/main'),
      via: 'default:local-main',
      tried: [
        { ref: ORIGIN_HEAD, result: 'absent' },
        { ref: 'refs/remotes/origin/main', result: 'absent' },
        { ref: 'refs/remotes/origin/master', result: 'absent' },
        { ref: 'refs/heads/main', result: 'resolved' },
      ],
      relation: 'local-only', counterpart: null,
    });
  });

  it('nothing at all: no-default-branch {tried} naming all five rungs', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'remote', 'remove', 'origin');
    h.git(main, 'branch', '-m', 'main', 'trunk');
    expect(refused(resolveIn('demo', null))).toEqual({
      ok: false, failure: 'no-default-branch',
      tried: [
        { ref: ORIGIN_HEAD, result: 'absent' },
        { ref: 'refs/remotes/origin/main', result: 'absent' },
        { ref: 'refs/remotes/origin/master', result: 'absent' },
        { ref: 'refs/heads/main', result: 'absent' },
        { ref: 'refs/heads/master', result: 'absent' },
      ],
    });
  });

  it('a local main ahead of origin/main is never served while an origin rung resolves', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '-q', '--allow-empty', '-m', 'local only');
    expect(served(resolveIn('demo', null))).toMatchObject({
      served: 'refs/remotes/origin/main', commit: rev(main, 'refs/remotes/origin/main'), relation: 'local-ahead',
      counterpart: { ref: 'refs/heads/main', commit: rev(main, 'refs/heads/main'), ahead: 0, behind: 1, count: 'measured' },
    });
  });

  it('default_branch_name answers [name, via], or None when no rung resolves', () => {
    const main = h.makeRepo('demo');
    const pick = (): unknown => unitJson(h.home, unitBody('demo', 'H.default_branch_name(repo, dl)'));
    expect(pick()).toEqual({ ok: true, value: ['main', 'default:origin-head'] });
    setOriginHead(h, main, null);
    expect(pick()).toEqual({ ok: true, value: ['main', 'default:origin-main'] });
    h.git(main, 'remote', 'remove', 'origin');
    h.git(main, 'branch', '-m', 'main', 'trunk');
    expect(pick()).toEqual({ ok: true, value: null });
  });
});

describe('docs ref resolution: the default ignores the checkout (row 20)', () => {
  it('with the main checkout on feat/x, the served ref is still refs/remotes/origin/main', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'checkout', '-q', '-b', 'feat/x');
    h.git(main, 'commit', '-q', '--allow-empty', '-m', 'on feat/x');
    expect(h.git(main, 'symbolic-ref', 'HEAD')).toBe('refs/heads/feat/x');
    const r = served(resolveIn('demo', null));
    expect(r).toMatchObject({ served: 'refs/remotes/origin/main', via: 'default:origin-head',
      commit: rev(main, 'refs/remotes/origin/main') });
    expect(r.commit).not.toBe(rev(main, 'HEAD'));
  });
});

describe('docs ref resolution: fully qualified, exact names (rows 17, 18)', () => {
  it('row 17: a tag x and a branch x at different commits; --ref x serves the branch', () => {
    const main = h.makeRepo('demo');
    const base = rev(main, 'refs/heads/main');
    const branch = commitOn(h, main, base, 'x');
    h.git(main, 'update-ref', 'refs/heads/x', branch);
    h.git(main, 'tag', 'x', base);
    expect(served(resolveIn('demo', 'x'))).toEqual({
      requested: 'x', served: 'refs/heads/x', name: 'x', side: 'local', commit: branch, via: 'local',
      tried: [{ ref: 'refs/heads/x', result: 'resolved' }, { ref: 'refs/remotes/origin/x', result: 'absent' }],
      relation: 'local-only', counterpart: null,
    });
  });

  it('row 18: local ws2/foo beside origin ws2; --ref ws2 serves origin ws2, never ws2/foo as its local side', () => {
    const main = h.makeRepo('demo');
    const base = rev(main, 'refs/heads/main');
    const foo = commitOn(h, main, base, 'ws2/foo');
    const ws2 = commitOn(h, main, base, 'ws2');
    // refs/heads/ws2 and refs/heads/ws2/foo cannot both exist (git refuses the directory/file conflict,
    // measured), so the two names sit on the two sides.
    h.git(main, 'update-ref', 'refs/heads/ws2/foo', foo);
    h.git(main, 'update-ref', 'refs/remotes/origin/ws2', ws2);
    // CONTROL: the pattern refs/heads/ws2 DOES match refs/heads/ws2/foo (MM3), so only an exact name is safe.
    expect(fer(main, '%(refname)', 'refs/heads/ws2')).toBe('refs/heads/ws2/foo');
    expect(served(resolveIn('demo', 'ws2'))).toMatchObject({
      served: 'refs/remotes/origin/ws2', side: 'origin', commit: ws2, relation: 'origin-only', counterpart: null,
      tried: [{ ref: 'refs/heads/ws2', result: 'absent' }, { ref: 'refs/remotes/origin/ws2', result: 'resolved' }],
    });
  });

  it('row 18, the other way round: local ws2 beside origin ws2/foo; --ref ws2 serves ws2, with no counterpart', () => {
    const main = h.makeRepo('demo');
    const base = rev(main, 'refs/heads/main');
    const ws2 = commitOn(h, main, base, 'ws2');
    h.git(main, 'update-ref', 'refs/heads/ws2', ws2);
    h.git(main, 'update-ref', 'refs/remotes/origin/ws2/foo', commitOn(h, main, base, 'ws2/foo'));
    expect(served(resolveIn('demo', 'ws2'))).toMatchObject({
      served: 'refs/heads/ws2', side: 'local', commit: ws2, relation: 'local-only', counterpart: null,
    });
  });
});

describe('docs ref resolution: Q2, the newer side wins (row 21)', () => {
  it.each([
    ['local-behind', 'refs/remotes/origin/feat', 'origin', { ahead: 1, behind: 0 }],
    ['local-ahead', 'refs/heads/feat', 'local', { ahead: 1, behind: 0 }],
    ['diverged', 'refs/heads/feat', 'local', { ahead: 1, behind: 1 }],
    ['equal', 'refs/heads/feat', 'local', { ahead: 0, behind: 0 }],
  ] as const)('%s serves %s, with the counts measured from the served side', (shape, want, side, counts) => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', shape);
    const other = side === 'local' ? 'refs/remotes/origin/feat' : 'refs/heads/feat';
    expect(served(resolveIn('demo', 'feat'))).toEqual({
      requested: 'feat', served: want, name: 'feat', side, commit: side === 'local' ? c.local : c.origin, via: side,
      tried: [{ ref: 'refs/heads/feat', result: 'resolved' }, { ref: 'refs/remotes/origin/feat', result: 'resolved' }],
      relation: shape,
      counterpart: { ref: other, commit: side === 'local' ? c.origin : c.local, ...counts, count: 'measured' },
    });
  });

  it.each([
    ['local-only', 'refs/heads/feat', 'local'],
    ['origin-only', 'refs/remotes/origin/feat', 'origin'],
  ] as const)('%s serves the one side, with counterpart null', (shape, want, side) => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', shape);
    expect(served(resolveIn('demo', 'feat'))).toMatchObject({
      served: want, side, via: side, relation: shape, counterpart: null });
  });

  it('a qualified ref never falls back: refs/remotes/origin/ws/local-only answers unresolved-ref, tried of one', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'ws/local-only', 'local-only');
    const f = refused(resolveIn('demo', 'refs/remotes/origin/ws/local-only'));
    expect(f).toEqual({ ok: false, failure: 'unresolved-ref',
      tried: [{ ref: 'refs/remotes/origin/ws/local-only', result: 'absent' }] });
    expect(f.tried).toHaveLength(1);
  });

  it('a qualified ref picks the side and nothing else: relation is still measured against the counterpart', () => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', 'local-behind');
    expect(served(resolveIn('demo', 'refs/heads/feat'))).toEqual({
      requested: 'refs/heads/feat', served: 'refs/heads/feat', name: 'feat', side: 'local', commit: c.local,
      via: 'qualified', tried: [{ ref: 'refs/heads/feat', result: 'resolved' }], relation: 'local-behind',
      counterpart: { ref: 'refs/remotes/origin/feat', commit: c.origin, ahead: 0, behind: 1, count: 'measured' },
    });
    expect(served(resolveIn('demo', 'refs/remotes/origin/feat'))).toMatchObject({
      served: 'refs/remotes/origin/feat', side: 'origin', commit: c.origin, via: 'qualified', relation: 'local-behind',
      counterpart: { ref: 'refs/heads/feat', commit: c.local, ahead: 1, behind: 0, count: 'measured' },
    });
  });
});

describe('docs ref resolution: the peel (row 22, MM3)', () => {
  it('a remote-tracking ref holding a tag of a blob answers ref-not-commit {ref, type}, qualified or bare', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'tag', '-a', 'blob-tag', '-m', 'a blob', rev(main, 'refs/heads/main:README.md'));
    h.git(main, 'update-ref', 'refs/remotes/origin/t', rev(main, 'refs/tags/blob-tag'));
    expect(refused(resolveIn('demo', 'refs/remotes/origin/t')))
      .toEqual({ ok: false, failure: 'ref-not-commit', ref: 'refs/remotes/origin/t', type: 'blob' });
    expect(refused(resolveIn('demo', 't')))
      .toEqual({ ok: false, failure: 'ref-not-commit', ref: 'refs/remotes/origin/t', type: 'blob' });
  });

  it('an annotated tag of a commit resolves, to the commit it peels to', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'tag', '-a', 'commit-tag', '-m', 'a commit', 'refs/heads/main');
    h.git(main, 'update-ref', 'refs/remotes/origin/at', rev(main, 'refs/tags/commit-tag'));
    // CONTROL: the ref names the TAG object, so serving it at all is the peel's doing.
    expect(fer(main, '%(objecttype)', 'refs/remotes/origin/at')).toBe('tag');
    expect(served(resolveIn('demo', 'refs/remotes/origin/at'))).toMatchObject({
      served: 'refs/remotes/origin/at', commit: rev(main, 'refs/heads/main'), via: 'qualified', relation: 'origin-only',
    });
    expect(served(resolveIn('demo', 'at'))).toMatchObject({ served: 'refs/remotes/origin/at', relation: 'origin-only' });
  });

  it('a remote side that is not a commit is excluded: the local side is served, as local-only', () => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', 'local-only');
    h.git(main, 'tag', '-a', 'blob-tag', '-m', 'a blob', rev(main, 'refs/heads/main:README.md'));
    h.git(main, 'update-ref', 'refs/remotes/origin/feat', rev(main, 'refs/tags/blob-tag'));
    expect(served(resolveIn('demo', 'feat'))).toMatchObject({
      served: 'refs/heads/feat', commit: c.local, relation: 'local-only', counterpart: null,
      tried: [{ ref: 'refs/heads/feat', result: 'resolved' }, { ref: 'refs/remotes/origin/feat', result: 'not-a-commit' }],
    });
  });
});

describe('docs ref resolution: unresolved names (row 23)', () => {
  it('--ref origin/feat with refs/remotes/origin/feat present: unresolved-ref carrying suggest', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'origin-only');
    expect(refused(resolveIn('demo', 'origin/feat'))).toEqual({
      ok: false, failure: 'unresolved-ref', suggest: 'refs/remotes/origin/feat',
      tried: [{ ref: 'refs/heads/origin/feat', result: 'absent' }, { ref: 'refs/remotes/origin/origin/feat', result: 'absent' }],
    });
  });

  it('suggest is set only when the remainder resolves on origin', () => {
    h.makeRepo('demo');
    expect(refused(resolveIn('demo', 'origin/nothing'))).toEqual({
      ok: false, failure: 'unresolved-ref',
      tried: [{ ref: 'refs/heads/origin/nothing', result: 'absent' }, { ref: 'refs/remotes/origin/origin/nothing', result: 'absent' }],
    });
  });

  it("a name that exists only as a tag answers unresolved-ref with hint:'tag', and the tag is never served", () => {
    const main = h.makeRepo('demo');
    h.git(main, 'tag', 'v1', 'refs/heads/main');
    expect(refused(resolveIn('demo', 'v1'))).toEqual({
      ok: false, failure: 'unresolved-ref', hint: 'tag',
      tried: [{ ref: 'refs/heads/v1', result: 'absent' }, { ref: 'refs/remotes/origin/v1', result: 'absent' }],
    });
  });
});

describe('docs ref resolution: the counterpart (§2 (c) 4-5, R11)', () => {
  it('a rev-list that runs out gives count:timeout with null counts; the relation is still measured', () => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', 'diverged');
    expect(served(resolveIn('demo', 'feat', timesOut('rev-list')))).toMatchObject({
      served: 'refs/heads/feat', relation: 'diverged',
      counterpart: { ref: 'refs/remotes/origin/feat', commit: c.origin, ahead: null, behind: null, count: 'timeout' },
    });
  });

  it('a merge-base that runs out gives unmeasured, and Q2 then serves local', () => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', 'local-behind');
    expect(served(resolveIn('demo', 'feat', timesOut('merge-base')))).toMatchObject({
      served: 'refs/heads/feat', commit: c.local, relation: 'unmeasured',
      counterpart: { ref: 'refs/remotes/origin/feat', commit: c.origin, ahead: 0, behind: 1, count: 'measured' },
    });
  });

  it('a rev-list that fails without running out is git-failed {step:rev-list}, never a count word', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'diverged');
    plantGitRecorder(h.home, { failWhen: ['rev-list'] });
    expect(refused(resolveIn('demo', 'feat'))).toEqual({
      ok: false, failure: 'git-failed', step: 'rev-list', rc: 128, stderrHead: 'git recorder: planted failure',
    });
  });

  it('the ref calls are hard: a for-each-ref that fails is git-failed, and a symbolic-ref that runs out is git-timeout', () => {
    h.makeRepo('demo');
    plantGitRecorder(h.home, { failWhen: ['for-each-ref'] });
    expect(refused(resolveIn('demo', 'feat'))).toEqual({
      ok: false, failure: 'git-failed', step: 'for-each-ref', rc: 128, stderrHead: 'git recorder: planted failure',
    });
    plantGitRecorder(h.home);
    expect(refused(resolveIn('demo', null, timesOut('symbolic-ref'))))
      .toEqual({ ok: false, failure: 'git-timeout', step: 'symbolic-ref' });
  });

  it('a --depth 1 clone: relation unmeasured, count shallow, and neither merge-base nor rev-list runs', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '-q', '--allow-empty', '-m', 'second');
    h.git(main, 'push', '-q', 'origin', 'main');
    const shallow = path.join(h.home, 'projects', 'shallow');
    h.git(h.home, 'clone', '-q', '--depth', '1', `file://${path.join(h.home, 'origins', 'demo.git')}`, shallow);
    h.git(shallow, 'commit', '-q', '--allow-empty', '-m', 'local');
    // CONTROL: the clone really is shallow, and its two sides really differ.
    expect(h.git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(rev(shallow, 'refs/heads/main')).not.toBe(rev(shallow, 'refs/remotes/origin/main'));
    const rec = plantGitRecorder(h.home);
    expect(served(resolveIn('shallow', null))).toMatchObject({
      served: 'refs/remotes/origin/main', relation: 'unmeasured',
      counterpart: { ref: 'refs/heads/main', ahead: null, behind: null, count: 'shallow' },
    });
    expect(served(resolveIn('shallow', 'main'))).toMatchObject({ served: 'refs/heads/main', relation: 'unmeasured' });
    const argvs = rec.calls().map((c) => c.argv);
    expect(argvs.some((a) => a.includes('for-each-ref'))).toBe(true);
    expect(argvs.filter((a) => a.includes('merge-base') || a.includes('rev-list'))).toEqual([]);
  });

  it('an EQUAL pair in a --depth 1 clone: relation is equal (equality is checked first), count is shallow (shallowness is checked first)', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '-q', '--allow-empty', '-m', 'second');
    h.git(main, 'push', '-q', 'origin', 'main');
    const shallow = path.join(h.home, 'projects', 'shallow');
    h.git(h.home, 'clone', '-q', '--depth', '1', `file://${path.join(h.home, 'origins', 'demo.git')}`, shallow);
    // CONTROL: the clone really is shallow, and its two sides really are one commit.
    expect(h.git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(rev(shallow, 'refs/heads/main')).toBe(rev(shallow, 'refs/remotes/origin/main'));
    expect(served(resolveIn('shallow', null))).toMatchObject({
      served: 'refs/remotes/origin/main', relation: 'equal',
      counterpart: { ref: 'refs/heads/main', ahead: null, behind: null, count: 'shallow' },
    });
  });

  it('a second remote is never read: no recorded call names refs/remotes/upstream', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'remote', 'add', 'upstream', path.join(h.home, 'origins', 'demo.git'));
    const up = commitOn(h, main, rev(main, 'refs/heads/main'), 'upstream');
    h.git(main, 'update-ref', 'refs/remotes/upstream/main', up);
    h.git(main, 'update-ref', 'refs/remotes/upstream/feat', up);
    h.git(main, 'symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/main');
    shapeBranch(h, main, 'feat', 'local-only');
    const rec = plantGitRecorder(h.home);
    expect(served(resolveIn('demo', null))).toMatchObject({ served: 'refs/remotes/origin/main', relation: 'equal' });
    expect(served(resolveIn('demo', 'feat'))).toMatchObject({ served: 'refs/heads/feat', relation: 'local-only', counterpart: null });
    const argvs = rec.calls().map((c) => c.argv);
    // CONTROL: the recorder saw the helper's own git, so an empty match below is not an empty log.
    expect(argvs.some((a) => a.includes('for-each-ref'))).toBe(true);
    expect(argvs.filter((a) => a.some((t) => t.includes('upstream')))).toEqual([]);
  });

  it('every for-each-ref pattern is a full refname under heads, origin or tags', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'diverged');
    const rec = plantGitRecorder(h.home);
    served(resolveIn('demo', 'feat'));
    served(resolveIn('demo', null));
    served(resolveIn('demo', 'refs/heads/feat'));
    const patterns = rec.calls().map((c) => c.argv).filter((a) => a.includes('for-each-ref'))
      .flatMap((a) => a.slice(a.indexOf('--end-of-options') + 1));
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.filter((p) => !/^refs\/(heads|remotes\/origin|tags)\//.test(p))).toEqual([]);
  });
});

// Guards this task adds that the table above leaves open (controller ruling G8): each case below goes red when its
// guard is deleted or mutated (measured in a scratch copy; the rows are R9-1..R9-16 in the plan's Task 19 table).
describe('docs ref resolution: the guards the table leaves open', () => {
  /** A `Sys` whose `spawn` answers the `nth` (1-based) git call carrying `subcommand` with `spawned` (a python
   *  `H.Spawned(...)` expression) and runs every other call for real. */
  const nthAnswers = (subcommand: string, nth: number, spawned: string): string[] => [
    'class Nth(H.Sys):',
    '    seen = 0',
    '    def spawn(self, argv, *a, **k):',
    `        if ${pyStr(subcommand)} in argv:`,
    '            Nth.seen += 1',
    `            if Nth.seen == ${nth}:`,
    `                return ${spawned}`,
    '        return H.Sys.spawn(self, argv, *a, **k)',
    'H.SYS = Nth()',
  ];
  const spawned = (rc: number, out: string): string =>
    `H.Spawned(rc=${rc}, out=${out}, err=b'', timed_out=False, overflow=False)`;

  it('a first merge-base at rc 2 and up is unmeasured, never read as "not an ancestor"', () => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', 'local-behind');
    expect(served(resolveIn('demo', 'feat', nthAnswers('merge-base', 1, spawned(128, "b''"))))).toMatchObject({
      served: 'refs/heads/feat', commit: c.local, relation: 'unmeasured' });
  });

  it('a first merge-base that overflows is unmeasured', () => {
    const main = h.makeRepo('demo');
    const c = shapeBranch(h, main, 'feat', 'local-behind');
    const over = "H.Spawned(rc=0, out=b'', err=b'', timed_out=False, overflow=True)";
    expect(served(resolveIn('demo', 'feat', nthAnswers('merge-base', 1, over)))).toMatchObject({
      served: 'refs/heads/feat', commit: c.local, relation: 'unmeasured' });
  });

  it('a SECOND merge-base at rc 2 and up is unmeasured, never read as diverged', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'local-ahead');
    // CONTROL: unswapped, the same fixture measures local-ahead, so `unmeasured` below is the swap's doing.
    expect(served(resolveIn('demo', 'feat'))).toMatchObject({ relation: 'local-ahead' });
    expect(served(resolveIn('demo', 'feat', nthAnswers('merge-base', 2, spawned(128, "b''"))))).toMatchObject({
      served: 'refs/heads/feat', relation: 'unmeasured' });
  });

  it('a SECOND merge-base that runs out of its bound is unmeasured, never git-timeout (it is a soft call)', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'local-ahead');
    // CONTROL: unswapped, the same fixture measures local-ahead, so `unmeasured` below is the swap's doing.
    expect(served(resolveIn('demo', 'feat'))).toMatchObject({ relation: 'local-ahead' });
    const out = "H.Spawned(rc=-15, out=b'', err=b'', timed_out=True, overflow=False)";
    expect(served(resolveIn('demo', 'feat', nthAnswers('merge-base', 2, out)))).toMatchObject({
      served: 'refs/heads/feat', relation: 'unmeasured' });
  });

  /** Every git call's (subcommand, timeout_s) as the helper hands it to the one door, over one `resolve`: a `Sys`
   *  that records and then runs the call for real. The subcommand is the word after `-C <path>`. */
  const bounds = (ref: string | null): [string, number][] => {
    const pre = [
      'REC = []',
      'class Records(H.Sys):',
      '    def spawn(self, argv, env, cwd, timeout_s, *a, **k):',
      "        REC.append([argv[argv.index('-C') + 2], timeout_s])",
      '        return H.Sys.spawn(self, argv, env, cwd, timeout_s, *a, **k)',
      'H.SYS = Records()',
    ];
    const a = unitJson<{ ok: true; value: [string, number][] } | Failed>(h.home,
      unitBody('demo', `(H.resolve(repo, ${pyStr(ref)}, dl), REC)[1]`, pre));
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true });
    return (a as { ok: true; value: [string, number][] }).value;
  };
  const of = (calls: [string, number][], sub: string): number[] => calls.filter(([s]) => s === sub).map(([, t]) => t);

  it('the ref calls run under the 5 s ref class and the relation and count calls under the 2 s count class', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'diverged');
    const calls = bounds('feat');
    // CONTROLS: the diverged shape reaches both merge-bases and the rev-list, so the lists below are not vacuous.
    expect(of(calls, 'merge-base')).toHaveLength(2);
    expect(of(calls, 'rev-list')).toHaveLength(1);
    expect(of(calls, 'for-each-ref')).toEqual([5]);
    expect(of(calls, 'merge-base')).toEqual([2, 2]);
    expect(of(calls, 'rev-list')).toEqual([2]);
    // The default path reads origin/HEAD with symbolic-ref, under the ref class.
    expect(of(bounds(null), 'symbolic-ref')).toEqual([5]);
  });

  it('a rev-list that answers rc 0 with output that is not two counts is git-failed {step:rev-list}', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'diverged');
    expect(refused(resolveIn('demo', 'feat', nthAnswers('rev-list', 1, spawned(0, "b'garbage\\n'")))))
      .toMatchObject({ ok: false, failure: 'git-failed', step: 'rev-list' });
  });

  it('a rev-list that overflows is git-failed {step:rev-list}, even with well-formed counts', () => {
    const main = h.makeRepo('demo');
    shapeBranch(h, main, 'feat', 'diverged');
    const over = "H.Spawned(rc=0, out=b'1\\t1\\n', err=b'', timed_out=False, overflow=True)";
    expect(refused(resolveIn('demo', 'feat', nthAnswers('rev-list', 1, over))))
      .toMatchObject({ ok: false, failure: 'git-failed', step: 'rev-list' });
  });

  it('a symbolic-ref that fails at rc 128 is git-failed {step:symbolic-ref}, never an unset origin/HEAD', () => {
    h.makeRepo('demo');
    plantGitRecorder(h.home, { failWhen: ['symbolic-ref'] });
    expect(refused(resolveIn('demo', null))).toEqual({
      ok: false, failure: 'git-failed', step: 'symbolic-ref', rc: 128, stderrHead: 'git recorder: planted failure',
    });
  });

  it('an origin/HEAD target that is not UTF-8 is malformed, and the chain moves on', () => {
    h.makeRepo('demo');
    const bad = String.raw`H.Spawned(rc=0, out=b'refs/remotes/origin/\xff\n', err=b'', timed_out=False, overflow=False)`;
    expect(served(resolveIn('demo', null, nthAnswers('symbolic-ref', 1, bad)))).toMatchObject({
      served: 'refs/remotes/origin/main', via: 'default:origin-main',
      tried: [{ ref: ORIGIN_HEAD, result: 'malformed' }, { ref: 'refs/remotes/origin/main', result: 'resolved' }],
    });
  });

  it('resolve itself refuses a ref the grammar does not admit as bad-ref, never serving nothing', () => {
    h.makeRepo('demo');
    expect(refused(resolveIn('demo', 'a..b'))).toEqual({ ok: false, failure: 'bad-ref' });
  });

  it('a LOCAL side that is not a commit answers ref-not-commit naming the local ref', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'tag', '-a', 'blob-tag', '-m', 'a blob', rev(main, 'refs/heads/main:README.md'));
    // git's own update-ref refuses a non-commit under refs/heads, so the loose ref is written the way a corrupt or
    // hand-edited repository would hold it.
    fs.writeFileSync(path.join(main, '.git', 'refs', 'heads', 't'), `${rev(main, 'refs/tags/blob-tag')}\n`);
    // CONTROL: git itself lists it, as a tag object.
    expect(fer(main, '%(objecttype)', 'refs/heads/t')).toBe('tag');
    expect(refused(resolveIn('demo', 't')))
      .toEqual({ ok: false, failure: 'ref-not-commit', ref: 'refs/heads/t', type: 'blob' });
  });
});

// ===========================================================================
// Task 10: the committed listing and the listing wire guard (spec 2026-10-01
// §2 (f) Committed steps 2-3, §2 (b) final guards, §2 (h) 7, §6.1 "Listing
// bound"; rows 15 (listing half), 25 (tree half), 30, and M6.8 as a unit).
//
// APPENDED to this file, so it imports under names of its own: a second
// import that binds a local name an earlier block already bound is a
// SyntaxError, and this block neither restates nor leans on those imports.
// Every top-level name it declares ends in T10 for the same reason.
import * as vT10 from 'vitest';
import * as cpT10 from 'node:child_process';
import * as fsT10 from 'node:fs';
import * as pathT10 from 'node:path';
import { makeCcdHarness as makeHarnessT10, type CcdHarness as HarnessT10 } from './ccdWsHelpers.js';
import { unitJson as unitJsonT10 } from './docsHelperPy.js';
import { plantGitRecorder as plantGitRecorderT10 } from './ccdDocsHelpers.js';

/** git for the fixtures below, in the fixture HOME, with `h.git`'s identity plus stdin and extra env. It runs the
 *  real binary off this process's PATH, so the PATH recorder never sees a fixture call. */
const gitT10 = (h: HarnessT10, dir: string, args: readonly string[], input?: Buffer, env: NodeJS.ProcessEnv = {}): string =>
  cpT10.execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
    env: {
      ...process.env, HOME: h.home, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x', ...env,
    },
  }).trim();

const blobT10 = (h: HarnessT10, dir: string, content: string): string =>
  gitT10(h, dir, ['hash-object', '-w', '--stdin'], Buffer.from(content, 'utf8'));

type RowT10 = readonly [mode: string, oid: string, repoPath: string | Buffer];

/** One commit whose tree holds exactly `rows`, written through a scratch index: a name no checkout could hold (a
 *  `\xff` byte, a 256-byte component) commits as easily as `a.md`. No ref names the commit, and neither the work
 *  tree nor the repository's own index is touched. */
const commitRowsT10 = (h: HarnessT10, dir: string, rows: readonly RowT10[]): string => {
  const index = pathT10.join(h.home, 'docs-listing.index');
  fsT10.rmSync(index, { force: true });
  const input = Buffer.concat(rows.map(([mode, oid, p]) => Buffer.concat([
    Buffer.from(`${mode} ${oid}\t`, 'utf8'), Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf8'), Buffer.from([0]),
  ])));
  gitT10(h, dir, ['update-index', '-z', '--add', '--index-info'], input, { GIT_INDEX_FILE: index });
  const tree = gitT10(h, dir, ['write-tree'], undefined, { GIT_INDEX_FILE: index });
  return gitT10(h, dir, ['commit-tree', tree, '-m', 'docs listing fixture']);
};

/** A helper-unit prologue: the Ctx a docs-tree call carries, a fresh deadline, and `repo` discovered for `project`
 *  exactly as every verb discovers it. */
const prologueT10 = (h: HarnessT10, project: string): string => String.raw`import json
ctx = H.Ctx('docs-tree', ${JSON.stringify(pathT10.join(h.home, 'projects'))}, ${JSON.stringify(pathT10.join(h.home, 'worktrees'))}, ${JSON.stringify(pathT10.join(h.home, '.cc-sessions'))}, H.SYS.monotonic())
dl = H.Deadline(12)
repo = H.discover(ctx, ${JSON.stringify(project)}, dl)
`;

interface ListedT10 {
  sections: { slug: string; path: string; state: string; count: number }[];
  entries: { section: string; path: string; committed: { kind: string; blob: string; size: number | null }; draft: null }[];
  unlisted: { count: number; byReason: Record<string, number> };
  blobs: [string, string, string, string, number | null][];
}
interface FailedT10 { failure: string; ctx: Record<string, unknown> }

/** `H.list_committed(repo, commit, dl<extraArgs>)` after `setup` (python run between discovery and the call): the
 *  four results, `blobs` as sorted [section, rel, kind, blob, size] rows, or the Fail's word and context. */
const listT10 = (h: HarnessT10, project: string, commit: string, opts: { setup?: string; extraArgs?: string } = {}): ListedT10 & Partial<FailedT10> =>
  unitJsonT10<ListedT10 & Partial<FailedT10>>(h.home, prologueT10(h, project) + String.raw`${opts.setup ?? ''}
try:
    sections, entries, unlisted, blobs = H.list_committed(repo, ${JSON.stringify(commit)}, dl${opts.extraArgs ?? ''})
except H.Fail as e:
    out({'failure': e.word, 'ctx': e.ctx})
else:
    out({'sections': sections, 'entries': entries, 'unlisted': unlisted,
         'blobs': sorted([k[0], k[1], v[0], v[1], v[2]] for k, v in blobs.items())})
`);

const S_T10 = 'docs/superpowers/specs';
const SECTION_PATHS_T10 = ['docs/superpowers/specs', 'docs/superpowers/plans', 'docs/product-design', 'docs/conventions'];

vT10.describe('docs listing: parse_ls_tree_long (§2 (f) Committed step 2)', () => {
  let h: HarnessT10;
  vT10.beforeAll(() => { h = makeHarnessT10('ccd-docs-'); });
  vT10.afterAll(() => { h.cleanup(); });

  /** Canned `ls-tree -r -z --long` records, built the way git writes them: size right-aligned in 7 columns. */
  const REC = String.raw`OID = b'ce013625030ba8dba906f756967f9e9ca394464a'
SUB = b'4b1ba40adc15533292cd1689591bd1e8af49a6c2'
def rec(mode, typ, oid, size, path):
    return mode + b' ' + typ + b' ' + oid + b' ' + size.rjust(7) + b'\t' + path + b'\0'
`;

  vT10.it('parses file, exec, symlink and gitlink records, splitting each at its FIRST tab', () => {
    const got = unitJsonT10<unknown[]>(h.home, REC + String.raw`buf = (rec(b'100644', b'blob', OID, b'6', b'docs/superpowers/specs/a.md')
       + rec(b'100755', b'blob', OID, b'12', b'docs/superpowers/specs/run.sh')
       + rec(b'120000', b'blob', OID, b'4', b'docs/superpowers/specs/link.md')
       + rec(b'160000', b'commit', SUB, b'-', b'docs/superpowers/specs/sub')
       + rec(b'100644', b'blob', OID, b'6', b'docs/superpowers/specs/t\tab\nnl.md'))
out([[m, t, o, s, p.decode('utf-8')] for m, t, o, s, p in H.parse_ls_tree_long(buf)])
`);
    const OID = 'ce013625030ba8dba906f756967f9e9ca394464a';
    vT10.expect(got).toEqual([
      ['100644', 'blob', OID, 6, `${S_T10}/a.md`],
      ['100755', 'blob', OID, 12, `${S_T10}/run.sh`],
      ['120000', 'blob', OID, 4, `${S_T10}/link.md`],
      ['160000', 'commit', '4b1ba40adc15533292cd1689591bd1e8af49a6c2', null, `${S_T10}/sub`],
      ['100644', 'blob', OID, 6, `${S_T10}/t\tab\nnl.md`],
    ]);
  });

  vT10.it('reads empty output as no records: an empty listing is not malformed', () => {
    vT10.expect(unitJsonT10<unknown[]>(h.home, String.raw`out(H.parse_ls_tree_long(b''))`)).toEqual([]);
  });

  vT10.it.each([
    ["a '-' size on a blob", String.raw`rec(b'100644', b'blob', OID, b'-', b'docs/a.md')`],
    ['a digit size on a gitlink', String.raw`rec(b'160000', b'commit', SUB, b'0', b'docs/sub')`],
    ['a record with no tab', String.raw`b'100644 blob ' + OID + b'       6 docs/a.md\0'`],
    ['output that does not end on a NUL', String.raw`rec(b'100644', b'blob', OID, b'6', b'docs/a.md')[:-1]`],
    ['a tree record, which -r without -t never writes', String.raw`rec(b'040000', b'tree', OID, b'-', b'docs/d')`],
    ['a type that disagrees with its mode', String.raw`rec(b'100644', b'commit', OID, b'6', b'docs/a.md')`],
    ['a 39-hex object name', String.raw`rec(b'100644', b'blob', OID[:39], b'6', b'docs/a.md')`],
  ])('refuses %s as git-failed {step:ls-tree}, never a guess', (_label, expr) => {
    const got = unitJsonT10<FailedT10 | { parsed: unknown }>(h.home, REC + String.raw`try:
    out({'parsed': [list(r[:4]) for r in H.parse_ls_tree_long(${expr})]})
except H.Fail as e:
    out({'failure': e.word, 'ctx': e.ctx})
`);
    vT10.expect(got).toMatchObject({ failure: 'git-failed', ctx: { step: 'ls-tree' } });
  });

  // Guards the brief's table leaves unreached (controller ruling G8): each goes red when its test is dropped.
  vT10.it.each([
    ['an empty path', String.raw`rec(b'100644', b'blob', OID, b'6', b'')`],
    ['a header of five fields', String.raw`b'100644 blob ' + OID + b'       6 extra\tdocs/a.md\0'`],
    ['a mode outside the four git prints', String.raw`rec(b'100664', b'blob', OID, b'6', b'docs/a.md')`],
  ])('refuses %s as git-failed {step:ls-tree}', (_label, expr) => {
    const got = unitJsonT10<FailedT10 | { parsed: unknown }>(h.home, REC + String.raw`try:
    out({'parsed': [list(r[:4]) for r in H.parse_ls_tree_long(${expr})]})
except H.Fail as e:
    out({'failure': e.word, 'ctx': e.ctx})
`);
    vT10.expect(got).toMatchObject({ failure: 'git-failed', ctx: { step: 'ls-tree' } });
  });

  vT10.it('reads a 64-hex object name (a sha256 repository) as it reads a 40-hex one', () => {
    const got = unitJsonT10<unknown[]>(h.home, REC + String.raw`o64 = b'ab' * 32
out([[m, t, o, s] for m, t, o, s, _p in H.parse_ls_tree_long(rec(b'100644', b'blob', o64, b'6', b'docs/a.md'))])
`);
    vT10.expect(got).toEqual([['100644', 'blob', 'ab'.repeat(32), 6]]);
  });
});

vT10.describe('docs listing: list_committed at a commit (§2 (f) Committed steps 2-3, §2 (h) 7)', () => {
  let h: HarnessT10;
  let demo: string;
  let B: string;
  vT10.beforeAll(() => {
    h = makeHarnessT10('ccd-docs-');
    demo = h.makeRepo('demo');
    B = blobT10(h, demo, 'hello\n');
  });
  vT10.afterAll(() => { h.cleanup(); });

  vT10.it('answers all four sections in SECTIONS order, each present or absent, and never lists a path outside them', () => {
    const c = commitRowsT10(h, demo, [
      ['100644', B, `${S_T10}/a.md`],
      ['100644', B, 'docs/product-design/m.html'],
      ['100644', B, 'README.md'],
      ['100644', B, 'docs/other.md'],
      ['100644', B, 'docs/superpowers/specs.md'],
      ['100644', B, 'docs/superpowers/specsX/b.md'],
      ['100644', B, 'docs/conventions-old/c.md'],
    ]);
    const r = listT10(h, 'demo', c);
    vT10.expect(r.sections).toEqual([
      { slug: 'specs', path: 'docs/superpowers/specs', state: 'present', count: 1 },
      { slug: 'plans', path: 'docs/superpowers/plans', state: 'absent', count: 0 },
      { slug: 'product-design', path: 'docs/product-design', state: 'present', count: 1 },
      { slug: 'conventions', path: 'docs/conventions', state: 'absent', count: 0 },
    ]);
    vT10.expect(r.entries.map((e) => [e.section, e.path])).toEqual([['specs', 'a.md'], ['product-design', 'm.html']]);
    vT10.expect(r.blobs.map((b) => [b[0], b[1]])).toEqual([['product-design', 'm.html'], ['specs', 'a.md']]);
    vT10.expect(r.unlisted).toEqual({ count: 0, byReason: {} });
  });

  vT10.it('answers a commit with no docs at all as four absent sections and no entries: not an error (§2 (h) 7)', () => {
    const r = listT10(h, 'demo', commitRowsT10(h, demo, [['100644', B, 'README.md']]));
    vT10.expect(r.failure).toBeUndefined();
    vT10.expect(r.sections.map((s) => [s.slug, s.state, s.count])).toEqual([
      ['specs', 'absent', 0], ['plans', 'absent', 0], ['product-design', 'absent', 0], ['conventions', 'absent', 0],
    ]);
    vT10.expect(r.entries).toEqual([]);
    vT10.expect(r.blobs).toEqual([]);
  });

  vT10.it('answers a section under an ancestor that is not a directory as absent: git holds nothing at that path', () => {
    // A symlinked docs/superpowers: git lists neither it nor anything under the two sections it would hold, so
    // specs and plans are absent (docs-show answers absent-path there alike), and the other two are untouched.
    const c = commitRowsT10(h, demo, [
      ['120000', blobT10(h, demo, 'elsewhere'), 'docs/superpowers'],
      ['100644', B, 'docs/product-design/m.html'],
    ]);
    const r = listT10(h, 'demo', c);
    vT10.expect(r.sections.map((s) => [s.slug, s.state, s.count])).toEqual([
      ['specs', 'absent', 0], ['plans', 'absent', 0], ['product-design', 'present', 1], ['conventions', 'absent', 0],
    ]);
    vT10.expect(r.entries.map((e) => [e.section, e.path])).toEqual([['product-design', 'm.html']]);
  });

  vT10.it('answers a section committed as a symlink, a gitlink or a file as not-a-directory, listing nothing in it (row 25, tree half)', () => {
    const head = gitT10(h, demo, ['rev-parse', 'HEAD']);
    const c = commitRowsT10(h, demo, [
      ['100644', B, S_T10],
      ['100644', B, 'docs/superpowers/plans/p.md'],
      ['160000', head, 'docs/product-design'],
      ['120000', blobT10(h, demo, 'superpowers/specs'), 'docs/conventions'],
    ]);
    const r = listT10(h, 'demo', c);
    vT10.expect(r.sections.map((s) => [s.slug, s.state, s.count])).toEqual([
      ['specs', 'not-a-directory', 0], ['plans', 'present', 1],
      ['product-design', 'not-a-directory', 0], ['conventions', 'not-a-directory', 0],
    ]);
    vT10.expect(r.entries.map((e) => [e.section, e.path])).toEqual([['plans', 'p.md']]);
    vT10.expect(r.blobs.map((b) => [b[0], b[1]])).toEqual([['plans', 'p.md']]);
  });

  vT10.it('carries kind, blob and size on every entry; a submodule names its commit and has size null', () => {
    const head = gitT10(h, demo, ['rev-parse', 'HEAD']);
    const link = blobT10(h, demo, '../x');
    const c = commitRowsT10(h, demo, [
      ['100644', B, `${S_T10}/a.md`],
      ['100755', B, `${S_T10}/run.sh`],
      ['120000', link, `${S_T10}/link.md`],
      ['160000', head, `${S_T10}/sub`],
    ]);
    const r = listT10(h, 'demo', c);
    vT10.expect(r.entries).toEqual([
      { section: 'specs', path: 'a.md', committed: { kind: 'file', blob: B, size: 6 }, draft: null },
      { section: 'specs', path: 'link.md', committed: { kind: 'symlink', blob: link, size: 4 }, draft: null },
      { section: 'specs', path: 'run.sh', committed: { kind: 'exec', blob: B, size: 6 }, draft: null },
      { section: 'specs', path: 'sub', committed: { kind: 'submodule', blob: head, size: null }, draft: null },
    ]);
    vT10.expect(r.blobs).toEqual([
      ['specs', 'a.md', 'file', B, 6],
      ['specs', 'link.md', 'symlink', link, 4],
      ['specs', 'run.sh', 'exec', B, 6],
      ['specs', 'sub', 'submodule', head, null],
    ]);
  });

  vT10.it('counts a name docs-show could never be asked for under its reason, and never lists it', () => {
    const deep17 = 'a/'.repeat(16) + 'deep.md';
    const deep16 = 'b/'.repeat(15) + 'ok.md';
    const long1034 = ('z'.repeat(250) + '/').repeat(4) + 'e'.repeat(30);
    const c = commitRowsT10(h, demo, [
      ['100644', B, `${S_T10}/a.md`],
      ['100644', B, Buffer.concat([Buffer.from(`${S_T10}/`), Buffer.from([0xff]), Buffer.from('.md')])],
      ['100644', B, `${S_T10}/${String.fromCodePoint(0x202e)}.md`],
      ['100644', B, `${S_T10}/${'x'.repeat(256)}`],
      ['100644', B, `${S_T10}/${long1034}`],
      ['100644', B, `${S_T10}/${deep17}`],
      ['100644', B, `${S_T10}/${'y'.repeat(255)}`],
      ['100644', B, `${S_T10}/${deep16}`],
    ]);
    const r = listT10(h, 'demo', c);
    vT10.expect(r.unlisted).toEqual({
      count: 5, byReason: { 'invalid-utf8': 1, 'unsafe-char': 1, 'too-long': 2, 'too-deep': 1 },
    });
    // The two boundary names, 255 bytes in one component and 16 components deep, ARE listed: the reasons above
    // are not wider than the grammar docs-show validates --path with.
    vT10.expect(r.entries.map((e) => e.path).sort()).toEqual(['a.md', deep16, 'y'.repeat(255)].sort());
    vT10.expect(r.sections[0]).toEqual({ slug: 'specs', path: S_T10, state: 'present', count: 3 });
    vT10.expect(r.blobs.map((b) => b[1]).sort()).toEqual(['a.md', deep16, 'y'.repeat(255)].sort());
  });

  vT10.it('counts a name that is both too deep and over the path bound as too-long: the reasons keep their order', () => {
    const both = `${'q'.repeat(70)}/`.repeat(16) + 'q'.repeat(70);
    const c = commitRowsT10(h, demo, [['100644', B, `${S_T10}/${both}`]]);
    const r = listT10(h, 'demo', c);
    vT10.expect(r.unlisted).toEqual({ count: 1, byReason: { 'too-long': 1 } });
    vT10.expect(r.entries).toEqual([]);
  });

  vT10.it('makes ONE git call, the fixed ls-tree over the four section paths, under the read env', () => {
    const g = makeHarnessT10('ccd-docs-');
    try {
      const dir = g.makeRepo('demo');
      const c = commitRowsT10(g, dir, [['100644', blobT10(g, dir, 'x\n'), `${S_T10}/a.md`]]);
      const rec = plantGitRecorderT10(g.home);
      const r = listT10(g, 'demo', c);
      vT10.expect(r.entries.map((e) => e.path)).toEqual(['a.md']);
      const lsTree = rec.calls().filter((k) => k.argv.includes('ls-tree'));
      vT10.expect(lsTree).toHaveLength(1);
      const argv = lsTree[0]!.argv;
      // The caller's commit is the one value in it, after --end-of-options; the pathspecs are this file's own four.
      vT10.expect(argv.slice(argv.indexOf('ls-tree'))).toEqual([
        'ls-tree', '-r', '-z', '--long', '--full-tree', '--end-of-options', c, '--', ...SECTION_PATHS_T10,
      ]);
      vT10.expect(lsTree[0]!.env).toMatchObject({
        GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C',
        GIT_CEILING_DIRECTORIES: fsT10.realpathSync(pathT10.join(g.home, 'projects')),
      });
    } finally { g.cleanup(); }
  });

  vT10.it('lists the committed object after `git replace`, never the replacement (row 15, listing half)', () => {
    const dir = h.makeRepo('replace-demo');
    const original = blobT10(h, dir, 'original\n');
    const swapped = blobT10(h, dir, 'replacement bytes, longer\n');
    const c = commitRowsT10(h, dir, [['100644', original, `${S_T10}/a.md`]]);
    gitT10(h, dir, ['replace', '-f', original, swapped]);
    // CONTROL: plain git follows the replace ref, so ls-tree --long reports the replacement's 26 bytes.
    vT10.expect(gitT10(h, dir, ['ls-tree', '-r', '--long', c, '--', S_T10])).toMatch(/ 26\tdocs\/superpowers\/specs\/a\.md$/);
    const r = listT10(h, 'replace-demo', c);
    vT10.expect(r.entries).toEqual([
      { section: 'specs', path: 'a.md', committed: { kind: 'file', blob: original, size: 9 }, draft: null },
    ]);
    // A replaced COMMIT: plain git lists the replacement's tree; the helper lists C's own.
    const c2 = commitRowsT10(h, dir, [['100644', original, `${S_T10}/a.md`], ['100644', swapped, 'docs/superpowers/plans/swapped.md']]);
    gitT10(h, dir, ['replace', '-f', c, c2]);
    vT10.expect(gitT10(h, dir, ['ls-tree', '-r', '--name-only', c, '--', 'docs/superpowers'])).toContain('swapped.md');
    const again = listT10(h, 'replace-demo', c);
    vT10.expect(again.entries.map((e) => [e.section, e.path])).toEqual([['specs', 'a.md']]);
    vT10.expect(again.sections[1]).toMatchObject({ slug: 'plans', state: 'absent' });
  });

  vT10.it('answers an unknown commit as git-failed {step:ls-tree, rc, stderrHead}', () => {
    const r = listT10(h, 'demo', '1'.repeat(40));
    vT10.expect(r.failure).toBe('git-failed');
    vT10.expect(r.ctx).toMatchObject({ step: 'ls-tree', rc: 128 });
    vT10.expect(String(r.ctx!['stderrHead'])).toMatch(/fatal/);
  });

  vT10.it('answers ls-tree output over its stdout cap as too-many-entries {count, bytes}, never a partial listing', () => {
    const rows: RowT10[] = Array.from({ length: 200 }, (_v, i) => ['100644', B, `${S_T10}/f${i}.md`] as const);
    const r = listT10(h, 'demo', commitRowsT10(h, demo, rows), { extraArgs: ', stdout_cap=1024' });
    vT10.expect(r.failure).toBe('too-many-entries');
    vT10.expect(r.entries).toBeUndefined();
    vT10.expect(r.ctx!['bytes']).toBe(1024);
    // The records read before the cap: a lower bound, so more than none and fewer than the 200 committed.
    vT10.expect(r.ctx!['count']).toBeGreaterThan(0);
    vT10.expect(r.ctx!['count']).toBeLessThan(200);
  });

  vT10.it('answers an ls-tree past its bound as git-timeout {step:ls-tree} (a Sys whose spawn runs out)', () => {
    const c = commitRowsT10(h, demo, [['100644', B, `${S_T10}/a.md`]]);
    const r = listT10(h, 'demo', c, {
      setup: String.raw`class _SlowLsTree(H.Sys):
    def spawn(self, argv, *args, **kw):
        if 'ls-tree' in argv:
            return H.Spawned(rc=-15, out=b'', err=b'', timed_out=True, overflow=False)
        return H.Sys.spawn(self, argv, *args, **kw)
H.SYS = _SlowLsTree()`,
    });
    vT10.expect(r.failure).toBe('git-timeout');
    vT10.expect(r.ctx).toEqual({ step: 'ls-tree' });
    vT10.expect(r.entries).toBeUndefined();
  });
});

vT10.describe('docs listing: the wire guard (§2 (b) final guards, §6.1 Listing bound)', () => {
  let h: HarnessT10;
  let demo: string;
  vT10.beforeAll(() => {
    h = makeHarnessT10('ccd-docs-');
    demo = h.makeRepo('demo');
  });
  vT10.afterAll(() => { h.cleanup(); });

  vT10.it('refuses 5001 committed files in specs as too-many-entries {count:5001}; 5000 passes unchanged (row 30)', () => {
    const B = blobT10(h, demo, 'x\n');
    const many = (n: number): RowT10[] => Array.from({ length: n }, (_v, i) => ['100644', B, `${S_T10}/f${i}.md`] as const);
    const c5001 = commitRowsT10(h, demo, many(5001));
    const c5000 = commitRowsT10(h, demo, many(5000));
    type Res = { listed: number; same: boolean; framed: number; answer: Record<string, unknown> | null };
    const got = unitJsonT10<Record<'c5001' | 'c5000', Res>>(h.home, prologueT10(h, 'demo') + String.raw`res = {}
for name, c in (('c5001', ${JSON.stringify(c5001)}), ('c5000', ${JSON.stringify(c5000)})):
    sections, entries, unlisted, blobs = H.list_committed(repo, c, H.Deadline(12))
    obj = {'v': 1, 'verb': 'docs-tree', 'ok': True, 'elapsedMs': 0, 'project': 'demo',
           'sections': sections, 'entries': entries, 'unlisted': unlisted}
    line = H.line_of(obj)
    g = H.guard_listing(obj, line)
    res[name] = {'listed': len(entries), 'same': g == line, 'framed': H.framed_len(line),
                 'answer': None if g == line else json.loads(g.decode('utf-8'))}
out(res)
`);
    vT10.expect(got.c5001.listed).toBe(5001);
    vT10.expect(got.c5001.same).toBe(false);
    vT10.expect(got.c5001.answer).toEqual({
      v: 1, verb: 'docs-tree', ok: false, elapsedMs: 0, failure: 'too-many-entries', count: 5001, bytes: got.c5001.framed,
    });
    // The COUNT refused it: the framed line is inside the byte bound.
    vT10.expect(got.c5001.framed).toBeLessThanOrEqual(1048576);
    vT10.expect(got.c5000).toMatchObject({ listed: 5000, same: true, answer: null });
  });

  vT10.it('measures the FRAMED length: quote-heavy paths under 1 MiB raw but over it framed give too-many-entries {bytes} (M6.8)', () => {
    type Res = { raw: number; framed: number; same: boolean; answer: Record<string, unknown> };
    const got = unitJsonT10<Res>(h.home, String.raw`import json
ents = [{'section': 'specs', 'path': 'q%04d/' % i + '"' * 200 + '.md',
         'committed': {'kind': 'file', 'blob': '0' * 40, 'size': 1}, 'draft': None} for i in range(1500)]
obj = {'v': 1, 'verb': 'docs-tree', 'ok': True, 'elapsedMs': 7, 'project': 'demo', 'entries': ents}
line = H.line_of(obj)
g = H.guard_listing(obj, line)
out({'raw': len(line), 'framed': H.framed_len(line), 'same': g == line, 'answer': json.loads(g.decode('utf-8'))})
`);
    // CONTROL: the raw line alone is inside the bound, so a guard that measured it would have admitted this answer.
    vT10.expect(got.raw).toBeLessThan(1048576);
    vT10.expect(got.framed).toBeGreaterThan(1048576);
    vT10.expect(got.same).toBe(false);
    vT10.expect(got.answer).toEqual({
      v: 1, verb: 'docs-tree', ok: false, elapsedMs: 7, failure: 'too-many-entries', count: 1500, bytes: got.framed,
    });
  });

  vT10.it('counts an index answer by its projects: 5001 rows refused, 5000 unchanged', () => {
    type Res = Record<'n5001' | 'n5000', { same: boolean; answer: Record<string, unknown> | null }>;
    const got = unitJsonT10<Res>(h.home, String.raw`import json
res = {}
for n in (5001, 5000):
    obj = {'v': 1, 'verb': 'docs-index', 'ok': True, 'elapsedMs': 0, 'unlisted': 0, 'duplicates': [],
           'projects': [{'project': 'demo', 'state': 'ready', 'github': {'state': 'none'}}] * n}
    line = H.line_of(obj)
    g = H.guard_listing(obj, line)
    res['n%d' % n] = {'same': g == line, 'answer': None if g == line else json.loads(g.decode('utf-8'))}
out(res)
`);
    vT10.expect(got.n5001.answer).toMatchObject({ verb: 'docs-index', ok: false, failure: 'too-many-entries', count: 5001 });
    vT10.expect(got.n5000).toEqual({ same: true, answer: null });
  });

  vT10.it('admits a framed length of exactly 1048576 and refuses one byte more: the bound is inclusive', () => {
    type Res = Record<'at' | 'over', { framed: number; same: boolean }>;
    const got = unitJsonT10<Res>(h.home, String.raw`res = {}
base = {'v': 1, 'verb': 'docs-tree', 'ok': True, 'elapsedMs': 0, 'project': 'demo', 'entries': [], 'pad': ''}
room = H.DOCS_MAX_LISTING_WIRE_BYTES - H.framed_len(H.line_of(base))
for name, extra in (('at', 0), ('over', 1)):
    obj = dict(base, pad='x' * (room + extra))
    line = H.line_of(obj)
    res[name] = {'framed': H.framed_len(line), 'same': H.guard_listing(obj, line) == line}
out(res)
`);
    vT10.expect(got.at).toEqual({ framed: 1048576, same: true });
    vT10.expect(got.over).toEqual({ framed: 1048577, same: false });
  });

  vT10.it('passes a failure answer through untouched: a failure line is never a listing', () => {
    const got = unitJsonT10<{ same: boolean }>(h.home, String.raw`obj = {'v': 1, 'verb': 'docs-tree', 'ok': False, 'elapsedMs': 0, 'failure': 'bad-ref'}
line = H.line_of(obj)
out({'same': H.guard_listing(obj, line) == line})
`);
    vT10.expect(got).toEqual({ same: true });
  });

  vT10.it('is applied by run to docs-tree and docs-index answers', () => {
    type Ans = { ok: boolean; failure: string | null; count: number | null; rows: number };
    const root = pathT10.join(h.home, 'projects');
    const wt = pathT10.join(h.home, 'worktrees');
    const reg = pathT10.join(h.home, '.cc-sessions');
    // Each stand-in verb answers a BODY, as a real verb does: run adds the envelope, then the guard.
    const got = unitJsonT10<Record<string, Ans>>(h.home, String.raw`import json
ROW = {'section': 'specs', 'path': 'a.md', 'committed': {'kind': 'file', 'blob': '0' * 40, 'size': 1}, 'draft': None}
PROJ = {'project': 'demo', 'state': 'ready', 'github': {'state': 'none'}}
def fake(verb, n):
    def answer(ctx, a):
        if verb == 'docs-tree':
            return {'project': 'demo', 'entries': [ROW] * n}
        return {'unlisted': 0, 'duplicates': [], 'projects': [PROJ] * n}
    return answer
def ask(verb, n, rest):
    H.VERBS[verb] = fake(verb, n)
    a = json.loads(H.run([verb, ${JSON.stringify(root)}, ${JSON.stringify(wt)}, ${JSON.stringify(reg)}] + rest).decode('utf-8'))
    return {'ok': a['ok'], 'failure': a.get('failure'), 'count': a.get('count'),
            'rows': len(a.get('entries', a.get('projects', [])))}
out({'tree5001': ask('docs-tree', 5001, ['--project', 'demo']), 'tree5000': ask('docs-tree', 5000, ['--project', 'demo']),
     'index5001': ask('docs-index', 5001, ['--all']), 'index5000': ask('docs-index', 5000, ['--all'])})
`);
    vT10.expect(got['tree5001']).toEqual({ ok: false, failure: 'too-many-entries', count: 5001, rows: 0 });
    vT10.expect(got['index5001']).toEqual({ ok: false, failure: 'too-many-entries', count: 5001, rows: 0 });
    // CONTROL: the same run, at the bound, answers the verb's own line.
    vT10.expect(got['tree5000']).toEqual({ ok: true, failure: null, count: null, rows: 5000 });
    vT10.expect(got['index5000']).toEqual({ ok: true, failure: null, count: null, rows: 5000 });
  });
});

// ── docs W1a Task 13: draft holders and holder trust (spec 2026-10-01 §2 (d)) ──
// Rows 31, 32, 33 and the tree half of 55, and R15. Helper units over fixture worktrees in the file's
// own per-test harness `h`; what a fixture HOME cannot create (another uid, a dev/ino swap, dubious
// ownership) is a `Sys` subclass swapped in as `H.SYS`, never an env or argv hook. This block is
// APPENDED below the file's own imports: it uses their `describe`/`it`/`expect`, `h`, `unitJson` and
// `plantGitRecorder`, and imports what else it needs under a `t13` alias no earlier block binds.
import * as t13fs from 'node:fs';
import * as t13path from 'node:path';

type T13Facts = Record<string, unknown>;

/** A python body written indented in this file, moved to column 0 and newline-terminated. */
const t13py = (s: string): string => {
  const lines = s.split('\n');
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const pad = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length));
  return `${lines.map((l) => l.slice(pad)).join('\n')}\n`;
};
const t13projects = (): string => t13path.join(h.home, 'projects');
const t13worktrees = (): string => t13path.join(h.home, 'worktrees');
const t13real = (p: string): string => t13fs.realpathSync(p);
/** What git records for a path whose own directory may be gone: the real path of its parent, plus its name. */
const t13recorded = (p: string): string => t13path.join(t13real(t13path.dirname(p)), t13path.basename(p));

/** The helper's context over this fixture HOME's roots, a 12 s deadline, and `os`/`stat`/`time`. */
const t13ctx = (): string => t13py(`
  import os, stat, time
  WT = ${JSON.stringify(t13worktrees())}
  CTX = H.Ctx(verb='docs-tree', root=${JSON.stringify(t13projects())}, worktrees=WT,
              reg=${JSON.stringify(t13path.join(h.home, '.cc-sessions'))}, t0=H.SYS.monotonic())
  DL = H.Deadline(12)
`);
/** ...plus `demo` discovered as REPO, and `holders_of(bd)`, which closes any Trusted fd it is handed. */
const t13repo = (): string => t13ctx() + t13py(`
  REPO = H.discover(CTX, 'demo', DL)
  def holders_of(bd, **kw):
      e = H.enumerate_drafts_holder(CTX, REPO, bd, DL, **kw)
      if e.trusted is not None:
          os.close(e.trusted.fd)
      return e
`);
/** The DraftsFacts `enumerate_drafts_holder` gives for `bd` in `demo`, after `pre` (a `Sys` swap). */
const t13facts = (bd: string, pre = ''): T13Facts =>
  unitJson<T13Facts>(h.home, `${t13repo()}${t13py(pre)}out(holders_of(${JSON.stringify(bd)}).facts)\n`);

/** `demo` with a second branch `ws/a` at the same commit; returns M. */
const t13demo = (): string => {
  const m = h.makeRepo('demo');
  h.git(m, 'branch', 'ws/a');
  return m;
};
/** `demo` with `ws/a` held by one linked worktree under the worktrees root; returns W. */
const t13heldA = (): string => {
  const m = t13demo();
  const w = t13path.join(t13worktrees(), 'demo', 'a');
  h.git(m, 'worktree', 'add', w, 'ws/a');
  return w;
};
/** A `Sys` subclass whose fstat answers with one stat field moved by +1 (1 = st_ino, 2 = st_dev, 4 = st_uid). */
const t13fstatShift = (index: number): string => `
  class Shifted(H.Sys):
      def fstat(self, fd):
          f = list(super().fstat(fd)[:10])
          f[${index}] = f[${index}] + 1
          return os.stat_result(f)
  H.SYS = Shifted()
`;

describe('docs draft holders and holder trust (docs W1a Task 13)', () => {
  describe('parse_worktrees and find_holders, on canned records', () => {
    it('parse_worktrees reads each NUL record into path_bytes, head, branch, detached, prunable and bare', () => {
      const r = unitJson<T13Facts[]>(h.home, t13ctx() + t13py(String.raw`
        Z = b'\x00'
        A = b'a' * 40
        buf = (b'worktree /x/main' + Z + b'HEAD ' + A + Z + b'branch refs/heads/main' + Z + Z +
               b'worktree /x/det' + Z + b'HEAD ' + A + Z + b'detached' + Z + Z +
               b'worktree /x/gone wt' + Z + b'HEAD ' + A + Z + b'branch refs/heads/ws/a' + Z +
               b'prunable gitdir file points to non-existent location' + Z + Z +
               b'worktree /x/locked' + Z + b'HEAD ' + A + Z + b'branch refs/heads/ws/b' + Z + b'locked my reason' + Z + Z +
               b'worktree /x/unborn' + Z + b'HEAD ' + b'0' * 40 + Z + b'branch refs/heads/orph' + Z + Z +
               b'worktree /x/bare.git' + Z + b'bare' + Z + Z)
        recs = H.parse_worktrees(buf)
        for rec in recs:
            rec['path_bytes'] = rec['path_bytes'].decode()
        out(recs)
      `));
      const base = { head: 'a'.repeat(40), branch: null, detached: false, prunable: false, bare: false };
      expect(r).toEqual([
        { ...base, path_bytes: '/x/main', branch: 'refs/heads/main' },
        { ...base, path_bytes: '/x/det', detached: true },
        { ...base, path_bytes: '/x/gone wt', branch: 'refs/heads/ws/a', prunable: true },
        { ...base, path_bytes: '/x/locked', branch: 'refs/heads/ws/b' },
        { ...base, path_bytes: '/x/unborn', head: '0'.repeat(40), branch: 'refs/heads/orph' },
        { ...base, path_bytes: '/x/bare.git', head: null, bare: true },
      ]);
    });

    it('parse_worktrees refuses a list it cannot read whole, so a cut list never reads as fewer holders', () => {
      const r = unitJson<T13Facts>(h.home, t13ctx() + t13py(String.raw`
        Z = b'\x00'
        A = b'a' * 40
        def verdict(b):
            try:
                H.parse_worktrees(b)
                return 'parsed'
            except ValueError:
                return 'ValueError'
        out({
            'no-worktree-line': verdict(b'HEAD ' + A + Z + Z),
            'two-worktree-lines': verdict(b'worktree /a' + Z + b'worktree /b' + Z + b'HEAD ' + A + Z + Z),
            'no-head': verdict(b'worktree /a' + Z + b'branch refs/heads/x' + Z + Z),
            'bad-head': verdict(b'worktree /a' + Z + b'HEAD xyz' + Z + Z),
            'empty-path': verdict(b'worktree ' + Z + b'HEAD ' + A + Z + Z),
            'unterminated': verdict(b'worktree /a' + Z + b'HEAD ' + A + Z),
            'no-final-nul': verdict(b'worktree /a' + Z + b'HEAD ' + A),
            'well-formed': verdict(b'worktree /a' + Z + b'HEAD ' + A + Z + Z),
            'empty': H.parse_worktrees(b''),
        })
      `));
      expect(r).toEqual({
        'no-worktree-line': 'ValueError', 'two-worktree-lines': 'ValueError', 'no-head': 'ValueError',
        'bad-head': 'ValueError', 'empty-path': 'ValueError', unterminated: 'ValueError', 'no-final-nul': 'ValueError',
        'well-formed': 'parsed', empty: [],
      });
    });

    it('find_holders takes exactly refs/heads/<Bd> and skips prunable, unsafe-path and missing-dir records (row 31)', () => {
      const r = unitJson<T13Facts>(h.home, t13ctx() + t13py(String.raw`
        Z = b'\x00'
        A = b'a' * 40
        HOME_B = os.fsencode(${JSON.stringify(h.home)})
        def rec(path, *attrs):
            return b'worktree ' + path + Z + b'HEAD ' + A + Z + b''.join(a + Z for a in attrs) + Z
        buf = (rec(b'/x/main', b'branch refs/heads/main') +
               rec(b'/x/\xff-wt', b'branch refs/heads/ws/a') +
               rec(b'rel/wt', b'branch refs/heads/ws/a') +
               rec(b'/x/gone', b'branch refs/heads/ws/a', b'prunable gitdir file points to non-existent location') +
               rec(HOME_B, b'branch refs/heads/ws/a') +
               rec(b'/nowhere/at/all', b'branch refs/heads/ws/a') +
               rec(b'/x/twin', b'branch refs/heads/ws/ab') +
               rec(b'/x/det', b'detached') +
               rec(b'/x/other-gone', b'branch refs/heads/ws/b', b'prunable gitdir file points to non-existent location'))
        holders, skipped, main = H.find_holders(CTX, H.parse_worktrees(buf), 'ws/a')
        out({'holders': [x['path'] for x in holders], 'skipped': skipped, 'main': main['path_bytes'].decode(),
             'none': H.find_holders(CTX, [], 'ws/a')})
      `));
      expect(r).toEqual({
        holders: [h.home],
        skipped: [
          { path: '/x/\\xff-wt', why: 'unsafe-path' },
          { path: 'rel/wt', why: 'unsafe-path' },
          { path: '/x/gone', why: 'prunable' },
          { path: '/nowhere/at/all', why: 'missing-dir' },
        ],
        main: '/x/main',
        none: [[], [], null],
      });
    });
  });

  describe('row 31: holder rules, on fixture worktrees', () => {
    it('a holder whose directory was removed is skipped as prunable, and the branch has no holder', () => {
      const w = t13heldA();
      t13fs.rmSync(w, { recursive: true, force: true });
      expect(t13facts('ws/a')).toEqual({ state: 'none', branch: 'ws/a', skipped: [{ path: t13recorded(w), why: 'prunable' }] });
    });

    it('a locked holder whose directory moved away is skipped as missing-dir (git does not call it prunable)', () => {
      const w = t13heldA();
      const m = t13path.join(t13projects(), 'demo');
      h.git(m, 'worktree', 'lock', w);
      t13fs.renameSync(w, t13path.join(h.home, 'moved-away'));
      // CONTROL: git's own record says locked, not prunable, so only the directory probe can skip it.
      const list = h.git(m, 'worktree', 'list', '--porcelain');
      expect(list).toContain('locked');
      expect(list).not.toContain('prunable');
      expect(t13facts('ws/a')).toEqual({ state: 'none', branch: 'ws/a', skipped: [{ path: t13recorded(w), why: 'missing-dir' }] });
    });

    // APFS refuses a filename that is not UTF-8 (EILSEQ), so this fixture cannot exist on macOS. The canned
    // find_holders case above pins the same rule on every platform; this one proves it on a real record.
    it.skipIf(process.platform === 'darwin')('a holder whose path is not strict UTF-8 is skipped as unsafe-path, shown backslash-escaped', () => {
      const m = t13demo();
      const scratch = t13path.join(h.home, 'scratch');
      t13fs.mkdirSync(scratch);
      // A JS string cannot carry the byte 0xff in an argv, so python adds the worktree, with the host's real git.
      const r = unitJson<T13Facts>(h.home, t13repo() + t13py(String.raw`
        import subprocess
        W = os.fsencode(${JSON.stringify(scratch)}) + b'/\xff-wt'
        added = subprocess.run([b'git', b'-C', os.fsencode(${JSON.stringify(m)}), b'worktree', b'add', b'-q', W, b'ws/a'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
        out({'added': added, 'isdir': os.path.isdir(W), 'facts': holders_of('ws/a').facts})
      `));
      expect(r).toEqual({
        added: 0, isdir: true,
        facts: { state: 'none', branch: 'ws/a', skipped: [{ path: `${t13real(scratch)}/\\xff-wt`, why: 'unsafe-path' }] },
      });
    });

    it('a detached worktree at the branch tip is never a holder', () => {
      const m = t13demo();
      const w = t13path.join(t13worktrees(), 'demo', 'det');
      h.git(m, 'worktree', 'add', '--detach', w, 'ws/a');
      // CONTROL: it sits exactly at the tip; only its detached HEAD keeps it out.
      expect(h.git(w, 'rev-parse', 'HEAD')).toBe(h.git(m, 'rev-parse', 'refs/heads/ws/a'));
      expect(t13facts('ws/a')).toEqual({ state: 'none', branch: 'ws/a', skipped: [] });
    });

    it('two holders via `worktree add --force` are ambiguous with both candidates, and neither is picked', () => {
      const w1 = t13heldA();
      const w2 = t13path.join(h.home, 'scratch', 'b');
      h.git(t13path.join(t13projects(), 'demo'), 'worktree', 'add', '--force', w2, 'ws/a');
      const r = unitJson<T13Facts>(h.home, t13repo() + t13py(`
        e = holders_of('ws/a')
        out({'facts': e.facts, 'trusted': e.trusted is not None})
      `));
      const facts = r['facts'] as { state: string; branch: string; candidates: string[] };
      expect({ ...facts, candidates: [...facts.candidates].sort() }).toEqual({
        state: 'ambiguous', branch: 'ws/a', candidates: [t13real(w1), t13real(w2)].sort(),
      });
      expect(r['trusted']).toBe(false);
    });

    it('holders are found wherever git records them, and only their class says where: main, workspace, other', () => {
      const m = t13demo();
      const agent = t13path.join(m, '.claude', 'worktrees', 'agent-x');
      const scratch = t13path.join(h.home, 'scratch', 'c');
      const ws = t13path.join(t13worktrees(), 'demo', 'quiet-mesa');
      h.git(m, 'worktree', 'add', '-b', 'ws/b', agent);
      h.git(m, 'worktree', 'add', '-b', 'ws/c', scratch);
      h.git(m, 'worktree', 'add', '-b', 'ws/quiet-mesa', ws);
      const head = h.git(m, 'rev-parse', 'HEAD');
      const r = unitJson<T13Facts>(h.home, t13repo() + t13py(`
        got = dict((bd, holders_of(bd).facts) for bd in ('main', 'ws/b', 'ws/c', 'ws/quiet-mesa'))
        got['root-itself'] = H.holder_class(CTX, REPO, WT)
        got['prefix-twin'] = H.holder_class(CTX, REPO, WT + '-old/demo/x')
        out(got)
      `));
      const holder = (branch: string, p: string, cls: string): T13Facts => ({
        state: 'holder', branch, worktree: { path: t13real(p), head, class: cls },
      });
      expect(r).toEqual({
        main: holder('main', m, 'main'),
        'ws/b': holder('ws/b', agent, 'other'),
        'ws/c': holder('ws/c', scratch, 'other'),
        'ws/quiet-mesa': holder('ws/quiet-mesa', ws, 'workspace'),
        'root-itself': 'other',
        'prefix-twin': 'other',
      });
    });
  });

  describe('rows 32 and 55: holder trust, every check in order', () => {
    it('one holder that passes every check is Trusted: its record HEAD, an O_DIRECTORY fd at stat(W), and W\'s own ceiling', () => {
      const w = t13heldA();
      const rec = plantGitRecorder(h.home);
      const r = unitJson<T13Facts>(h.home, t13repo() + t13py(`
        W = ${JSON.stringify(t13real(w))}
        records, detail = H.worktree_records(REPO, DL)
        holders, skipped, main = H.find_holders(CTX, records, 'ws/a')
        t = H.trust_holder(REPO, holders[0], DL)
        st = os.stat(W)
        fd_is_dir = stat.S_ISDIR(os.fstat(t.fd).st_mode)
        os.close(t.fd)
        out({'detail': detail, 'holders': len(holders), 'skipped': skipped, 'trusted': isinstance(t, H.Trusted),
             'path': t.path, 'head': t.head, 'sameAsStat': [t.dev, t.ino] == [st.st_dev, st.st_ino],
             'fdIsDir': fd_is_dir, 'main': main['path_bytes'].decode()})
      `));
      expect(r).toEqual({
        detail: null, holders: 1, skipped: [], trusted: true, path: t13real(w),
        head: h.git(w, 'rev-parse', 'HEAD'), sameAsStat: true, fdIsDir: true,
        main: t13real(t13path.join(t13projects(), 'demo')),
      });
      // The list runs in M under M's ceiling; the trust rev-parse runs in W with the ceiling at W's parent.
      const list = rec.calls().filter((c) => c.argv.join(' ').includes('worktree list --porcelain -z'));
      expect(list).toHaveLength(1);
      expect(list[0]!.env['GIT_CEILING_DIRECTORIES']).toBe(t13real(t13projects()));
      const trust = rec.calls().filter((c) => c.argv.join(' ').includes(`-C ${t13real(w)} rev-parse`));
      expect(trust.map((c) => c.argv.slice(c.argv.indexOf('rev-parse')))).toEqual([
        ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'],
      ]);
      expect(trust[0]!.env['GIT_CEILING_DIRECTORIES']).toBe(t13real(t13path.dirname(w)));
    });

    it('a stray `git init` where a holder was is untrusted {why:common-dir} (row 32)', () => {
      const w = t13heldA();
      t13fs.rmSync(w, { recursive: true, force: true });
      h.git(h.home, 'init', '-q', w);
      // CONTROL: git still records W as a live holder of ws/a, and W now answers for a repository of its own.
      expect(h.git(t13path.join(t13projects(), 'demo'), 'worktree', 'list', '--porcelain')).not.toContain('prunable');
      expect(h.git(w, 'rev-parse', '--path-format=absolute', '--git-common-dir')).toBe(t13path.join(t13real(w), '.git'));
      expect(t13facts('ws/a')).toEqual({ state: 'untrusted', branch: 'ws/a', worktree: t13real(w), why: 'common-dir' });
    });

    it('a per-worktree core.worktree pointing W elsewhere is untrusted {why:toplevel-mismatch} (row 55, MM9)', () => {
      const w = t13heldA();
      const other = t13path.join(h.home, 'elsewhere');
      t13fs.mkdirSync(other);
      t13fs.writeFileSync(t13path.join(other, 'README.md'), 'SENTINEL-OTHER-DIR\n');
      h.git(w, 'config', 'extensions.worktreeConfig', 'true');
      h.git(w, 'config', '--worktree', 'core.worktree', other);
      // CONTROL: a plain status in W reads the OTHER directory. W's own README is untouched, so the
      // modification git reports is the other directory's bytes.
      expect(t13fs.readFileSync(t13path.join(w, 'README.md'), 'utf8')).toBe('hi\n');
      expect(h.git(w, 'status', '--porcelain')).toContain('README.md');
      expect(h.git(w, 'rev-parse', '--show-toplevel')).toBe(t13real(other));
      const facts = t13facts('ws/a');
      expect(facts).toEqual({ state: 'untrusted', branch: 'ws/a', worktree: t13real(w), why: 'toplevel-mismatch' });
      expect(JSON.stringify(facts)).not.toContain('SENTINEL-OTHER-DIR');
    });

    it('`detected dubious ownership` on the trust rev-parse is untrusted {why:dubious-ownership} (row 32, R15: canned)', () => {
      const w = t13heldA();
      const r = unitJson<T13Facts>(h.home, t13repo() + t13py(`
        W = ${JSON.stringify(t13real(w))}
        plain = holders_of('ws/a').facts['state']
        class Dubious(H.Sys):
            def spawn(self, argv, *args, **kw):
                if 'rev-parse' in argv and '--show-toplevel' in argv and W in argv:
                    err = b"fatal: detected dubious ownership in repository at '" + os.fsencode(W) + b"'\\n"
                    return H.Spawned(rc=128, out=b'', err=err, timed_out=False, overflow=False)
                return super().spawn(argv, *args, **kw)
        H.SYS = Dubious()
        out({'plain': plain, 'canned': holders_of('ws/a').facts})
      `));
      expect(r).toEqual({
        plain: 'holder',
        canned: { state: 'untrusted', branch: 'ws/a', worktree: t13real(w), why: 'dubious-ownership' },
      });
    });

    it('an fstat whose st_uid is not geteuid() is untrusted {why:foreign-owner} (row 55, R15: injected)', () => {
      const w = t13heldA();
      expect(t13facts('ws/a')['state']).toBe('holder');
      expect(t13facts('ws/a', t13fstatShift(4)))
        .toEqual({ state: 'untrusted', branch: 'ws/a', worktree: t13real(w), why: 'foreign-owner' });
    });

    it('an fd whose st_dev or st_ino is not stat(W)\'s is untrusted {why:identity-changed} (row 55, R15: injected)', () => {
      const w = t13heldA();
      const changed = { state: 'untrusted', branch: 'ws/a', worktree: t13real(w), why: 'identity-changed' };
      expect(t13facts('ws/a')['state']).toBe('holder');
      expect(t13facts('ws/a', t13fstatShift(1))).toEqual(changed);
      expect(t13facts('ws/a', t13fstatShift(2))).toEqual(changed);
    });

    it('a trust rev-parse that fails without the dubious-ownership answer measured nothing: unreadable, never a verdict', () => {
      const w = t13heldA();
      t13fs.writeFileSync(t13path.join(w, '.git'), 'not a gitfile\n');
      // CONTROL: git still lists W as a live holder; only W's own rev-parse refuses.
      expect(h.git(t13path.join(t13projects(), 'demo'), 'worktree', 'list', '--porcelain')).not.toContain('prunable');
      const facts = t13facts('ws/a');
      expect(facts).toMatchObject({ state: 'unreadable', branch: 'ws/a', worktree: t13real(w), step: 'worktree-list' });
      expect(String(facts['detail'])).toMatch(/^rev-parse rc 128: /);
    });

    it('trust_verdict is pure and checks in order: common-dir, toplevel-mismatch, dubious-ownership, foreign-owner, identity-changed (R15)', () => {
      const r = unitJson<T13Facts>(h.home, t13ctx() + t13py(`
        base = {'common_dir': '/r/.git', 'project_common_dir': '/r/.git', 'toplevel': '/w', 'realpath': '/w',
                'dubious': False, 'uid': 1000, 'euid': 1000, 'stat_id': [1, 2], 'fd_id': [1, 2]}
        def v(**kw):
            d = dict(base)
            d.update(kw)
            return H.trust_verdict(d)
        out({
            'clean': v(),
            'common-dir': v(common_dir='/elsewhere/.git'),
            'toplevel-mismatch': v(toplevel='/other'),
            'dubious-ownership': v(common_dir=None, toplevel=None, dubious=True, uid=None, fd_id=None),
            'foreign-owner': v(uid=1001),
            'identity-ino': v(fd_id=[1, 3]),
            'identity-dev': v(fd_id=[9, 2]),
            'no-fd': v(fd_id=None),
            'common-dir-before-toplevel': v(common_dir='/x/.git', toplevel='/other'),
            'toplevel-before-dubious': v(toplevel='/other', dubious=True),
            'dubious-before-owner': v(common_dir=None, toplevel=None, dubious=True, uid=1001),
            'owner-before-identity': v(uid=1001, fd_id=[1, 3]),
            'unmeasured-common-dir': v(common_dir=None),
            'unmeasured-toplevel': v(toplevel=None),
        })
      `));
      expect(r).toEqual({
        clean: null,
        'common-dir': 'common-dir',
        'toplevel-mismatch': 'toplevel-mismatch',
        'dubious-ownership': 'dubious-ownership',
        'foreign-owner': 'foreign-owner',
        'identity-ino': 'identity-changed',
        'identity-dev': 'identity-changed',
        'no-fd': 'identity-changed',
        'common-dir-before-toplevel': 'common-dir',
        'toplevel-before-dubious': 'toplevel-mismatch',
        'dubious-before-owner': 'dubious-ownership',
        'owner-before-identity': 'foreign-owner',
        'unmeasured-common-dir': 'common-dir',
        'unmeasured-toplevel': 'toplevel-mismatch',
      });
    });
  });

  describe('row 33: an enumeration that failed is never "none"', () => {
    it('a `worktree list` that fails is unreadable {step:worktree-list}, from exactly one list call', () => {
      t13heldA();
      const rec = plantGitRecorder(h.home, { failWhen: ['worktree list'] });
      const r = unitJson<{ facts: T13Facts; main: unknown }>(h.home, t13repo() + t13py(`
        e = holders_of('ws/a')
        out({'facts': e.facts, 'main': e.main})
      `));
      expect(r.facts).toEqual({
        state: 'unreadable', branch: 'ws/a', worktree: null, step: 'worktree-list',
        detail: 'worktree list rc 128: git recorder: planted failure',
      });
      expect(r.main).toBeNull();
      expect(rec.calls().filter((c) => c.argv.join(' ').includes('worktree list'))).toHaveLength(1);
    });

    it('a sleeping `worktree list` under a lowered call_s is unreadable {detail:timeout} within the bound', () => {
      t13heldA();
      plantGitRecorder(h.home, { sleepWhen: ['worktree list'], sleepS: 5 });
      const r = unitJson<{ facts: T13Facts; elapsed: number }>(h.home, t13repo() + t13py(`
        t0 = time.monotonic()
        e = holders_of('ws/a', call_s=1)
        out({'facts': e.facts, 'elapsed': time.monotonic() - t0})
      `));
      expect(r.facts).toEqual({ state: 'unreadable', branch: 'ws/a', worktree: null, step: 'worktree-list', detail: 'timeout' });
      expect(r.elapsed).toBeLessThan(4);
    });
  });
});

// ── docs W1a Task 13, ruling G8: the failure arms the block above leaves to the type checker ──
// Each case swaps `H.SYS` for a `Sys` subclass that answers one outcome the fixture HOME cannot make
// (an overflowing or cut `worktree list`, a timed-out or malformed trust rev-parse, an OSError on W,
// a raising fstat) and pins the word or the closed fd that outcome must produce.
const t13holder = (): string => t13py(`
  import errno
  records, detail = H.worktree_records(REPO, DL)
  holders, skipped, main = H.find_holders(CTX, records, 'ws/a')
  REC = holders[0]
  W = REC['path']
  class Canned(H.Sys):
      match = ()
      result = None
      def spawn(self, argv, *args, **kw):
          if all(m in argv for m in self.match):
              return self.result
          return super().spawn(argv, *args, **kw)
  def canned(match, **kw):
      c = Canned()
      c.match = match
      c.result = H.Spawned(**dict({'rc': 0, 'out': b'', 'err': b'', 'timed_out': False, 'overflow': False}, **kw))
      return c
  opened = []
  closed = []
  class Track(H.Sys):
      def open(self, path, flags, dir_fd=None):
          fd = super().open(path, flags, dir_fd)
          if path == W:
              opened.append(fd)
          return fd
      def close(self, fd):
          closed.append(fd)
          return super().close(fd)
  def leaked():
      return [fd for fd in opened if fd not in closed]
`);
const t13trustUnit = (body: string): unknown =>
  unitJson<unknown>(h.home, t13repo() + t13holder() + t13py(body));

describe('docs draft holders and holder trust: failure arms (docs W1a Task 13, G8)', () => {
  const listOutcome = (spawned: string): unknown => t13trustUnit(`
    control = H.worktree_records(REPO, DL)[1]
    H.SYS = canned(('worktree', 'list'), ${spawned})
    e = H.enumerate_drafts_holder(CTX, REPO, 'ws/a', DL)
    out({'control': control, 'got': H.worktree_records(REPO, DL), 'facts': e.facts})
  `);
  const unreadable = (detail: string): T13Facts => ({
    state: 'unreadable', branch: 'ws/a', worktree: null, step: 'worktree-list', detail,
  });

  it('a `worktree list` that overflowed the stdout cap is unreadable {detail:overflow}, never none', () => {
    t13heldA();
    expect(listOutcome('overflow=True')).toEqual({ control: null, got: [null, 'overflow'], facts: unreadable('overflow') });
  });

  it('a `worktree list` cut before its last NUL is unreadable {detail:malformed}, never fewer holders', () => {
    t13heldA();
    expect(listOutcome("out=b'worktree /x' + b'\\x00' + b'HEAD ' + b'a' * 40 + b'\\x00'"))
      .toEqual({ control: null, got: [null, 'malformed'], facts: unreadable('malformed') });
  });

  it('an empty `worktree list` is unreadable {detail:malformed}: git always prints the main checkout', () => {
    t13heldA();
    expect(listOutcome("out=b''")).toEqual({ control: null, got: [null, 'malformed'], facts: unreadable('malformed') });
  });

  it('a trust rev-parse that timed out is unreadable {detail:timeout}, never a verdict', () => {
    t13heldA();
    expect(t13trustUnit(`
      H.SYS = canned(('rev-parse', '--show-toplevel'), rc=None, timed_out=True)
      out(H.trust_holder(REPO, REC, DL))
    `)).toEqual(['unreadable', 'worktree-list', 'timeout']);
  });

  it('a trust rev-parse that overflowed is unreadable {detail:overflow}, never a verdict', () => {
    t13heldA();
    expect(t13trustUnit(`
      H.SYS = canned(('rev-parse', '--show-toplevel'), overflow=True)
      out(H.trust_holder(REPO, REC, DL))
    `)).toEqual(['unreadable', 'worktree-list', 'overflow']);
  });

  it('a stat(W) that fails is unreadable {detail:"stat: ..."}', () => {
    t13heldA();
    expect(t13trustUnit(`
      class NoStat(H.Sys):
          def stat(self, p):
              if p == W:
                  raise OSError(errno.EACCES, 'denied')
              return super().stat(p)
      H.SYS = NoStat()
      out(H.trust_holder(REPO, REC, DL))
    `)).toEqual(['unreadable', 'worktree-list', 'stat: denied']);
  });

  it('an open(W) that fails is unreadable {detail:"open: ..."}', () => {
    t13heldA();
    expect(t13trustUnit(`
      class NoOpen(H.Sys):
          def open(self, path, flags, dir_fd=None):
              if path == W:
                  raise OSError(errno.EACCES, 'denied')
              return super().open(path, flags, dir_fd)
      H.SYS = NoOpen()
      out(H.trust_holder(REPO, REC, DL))
    `)).toEqual(['unreadable', 'worktree-list', 'open: denied']);
  });

  it('a trust rev-parse answer that is not exactly two paths fails closed as untrusted {common-dir}', () => {
    t13heldA();
    expect(t13trustUnit(`
      two = os.fsencode(REPO.common_dir) + b'\\n' + os.fsencode(W) + b'\\n'
      def verdict(raw):
          H.SYS = canned(('rev-parse', '--show-toplevel'), out=raw)
          got = H.trust_holder(REPO, REC, DL)
          if isinstance(got, H.Trusted):
              os.close(got.fd)
              return 'trusted'
          return got
      out({'exactly-two': verdict(two), 'one': verdict(b'/only-one-line\\n'), 'three': verdict(two + b'/extra-line\\n')})
    `)).toEqual({ 'exactly-two': 'trusted', one: ['untrusted', 'common-dir'], three: ['untrusted', 'common-dir'] });
  });

  it('an untrusted verdict closes the fd it opened; the Trusted control keeps its fd open for the caller', () => {
    t13heldA();
    expect(t13trustUnit(`
      class Foreign(Track):
          def fstat(self, fd):
              f = list(super().fstat(fd)[:10])
              f[4] = f[4] + 1
              return os.stat_result(f)
      H.SYS = Track()
      t = H.trust_holder(REPO, REC, DL)
      control = [isinstance(t, H.Trusted), len(opened), len(leaked())]
      os.close(t.fd)
      del opened[:]
      H.SYS = Foreign()
      got = H.trust_holder(REPO, REC, DL)
      out({'control': control, 'got': got, 'opened': len(opened), 'leaked': leaked()})
    `)).toEqual({ control: [true, 1, 1], got: ['untrusted', 'foreign-owner'], opened: 1, leaked: [] });
  });

  it('an fstat that raises closes the fd it opened before the error propagates', () => {
    t13heldA();
    expect(t13trustUnit(`
      class Boom(Track):
          def fstat(self, fd):
              raise RuntimeError('boom')
      H.SYS = Boom()
      try:
          H.trust_holder(REPO, REC, DL)
          raised = False
      except RuntimeError:
          raised = True
      out({'raised': raised, 'opened': len(opened), 'leaked': leaked()})
    `)).toEqual({ raised: true, opened: 1, leaked: [] });
  });

  it('a dubious-ownership answer opens no fd on W: the holder is never entered', () => {
    t13heldA();
    expect(t13trustUnit(`
      err = b"fatal: detected dubious ownership in repository at '" + os.fsencode(W) + b"'\\n"
      class DubiousTrack(Track):
          def spawn(self, argv, *args, **kw):
              if 'rev-parse' in argv and '--show-toplevel' in argv and W in argv:
                  return H.Spawned(rc=128, out=b'', err=err, timed_out=False, overflow=False)
              return super().spawn(argv, *args, **kw)
      H.SYS = DubiousTrack()
      got = H.trust_holder(REPO, REC, DL)
      out({'got': got, 'opened': len(opened)})
    `)).toEqual({ got: ['untrusted', 'dubious-ownership'], opened: 0 });
  });
});
