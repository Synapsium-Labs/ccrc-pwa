// The ccd file split's pure-move pin and its slice tool (docs/superpowers/plans/2026-11-06-ccd-file-split.md, Task 1;
// D-8048, D-8634).
//
// A slice moves functions out of `ccd/ccd` into `ccd/lib/<library>.sh`, byte for byte, leaving one `# @ccd-lib:<id>`
// pointer line per run. What this suite holds:
//   * PURITY (`pureMoveVerdict`): a diff that adds a pointer is judged. The one `__CCD_LIBS=(` line may gain exactly the
//     libraries the diff adds, order kept, and `spliceCcd` of both sides, pointer lines left over removed, must be equal
//     byte for byte. A diff that adds no pointer is a feature, and is not judged here. Nor is one whose new pointers all
//     name NEW code, a region defining no function the base program defined anywhere (as a new library's does), when it
//     removes no function from ccd/ccd: the verdict is pure and names them in `newCode` (the coordinator's ruling for the
//     Overlord W1 pool set, slug new-code-library-is-not-a-move). A region that mixes moved and new code, a pointer with
//     no region, and a diff that also removes a function from ccd/ccd are still judged in full.
//   * ONE DEFINITION (`duplicateDefinitions`): a feature PR merged across a move that keeps its old copy of a function
//     defines it twice, and goes red instead of running two definitions (Review Focus 1).
//   * THE DUMP (`programDump`): `declare -f` and `declare -p` of the sourced program, which sees a swallowed global that
//     the splice cannot (it puts the moved bytes back where they were; Review Focus 6).
//   * THE REGION RULE (`regionProblems`, through `.github/ci/ccd-split.py check-regions`): one implementation, the tool's.
//   * THE YIELD CHECK (S1, D-8634): the tool refuses a slice any open PR head touches, naming the head; offline, from a
//     heads file the caller writes, never through gh.
//   * REAL rows judged from `moveBase` at test time, so a change that lands on main while a move queues sits on both
//     sides of every comparison and cannot eject it (Review Focus 8). They skip without origin/main, as growth-check does.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { spliceCcd } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import {
  CCD_SPLIT_TOOL, NEW_CODE_NOT_JUDGED, duplicateDefinitions, moveBase, programDump, pureMoveVerdict, recordsAdded, regionProblems, treeAt,
  type Tree,
} from './ccdSplit.js';

const REPO = path.resolve(__dirname, '..', '..');

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
const SHEBANG = '#!/usr/bin/env bash\n# a fixture program\n\n';
const FA = 'fa() {\n  echo a\n}\n';
const FB_LEAD = '# lead of fb\n';
const FB = 'fb() { echo b; }\n';
const DECL = 'declare -A _M=([k]=v)\n';
const LOADER = '_load() { local w; for w in "${__CCD_LIBS[@]}"; do eval "$(<"${BASH_SOURCE[0]%/*}/lib/$w.sh")"; done; }\n_load\n';
const LIB_HEAD = (n: string) => `# ccd/lib/${n}.sh — a fixture library\n\n`;
const lib = (n: string, ...regions: [string, string][]) =>
  LIB_HEAD(n) + regions.map(([id, text]) => `# @ccd-lib:${id}\n${text}`).join('\n');

const base: Tree = { 'ccd/ccd': SHEBANG + FA + 'X=1\n' + FB_LEAD + FB + DECL + '__CCD_LIBS=()\n' };
const movedByteForByte: Tree = {
  'ccd/ccd': SHEBANG + FA + 'X=1\n' + '# @ccd-lib:t_1 — `fb` moved to ccd/lib/t.sh\n' + DECL + '__CCD_LIBS=(t)\n',
  'ccd/lib/t.sh': lib('t', ['t_1', FB_LEAD + FB]),
};
const movedAndEdited: Tree = { ...movedByteForByte, 'ccd/lib/t.sh': lib('t', ['t_1', FB_LEAD + 'fb() { echo B; }\n']) };
const featureEdit: Tree = { 'ccd/ccd': base['ccd/ccd']!.replace('echo a', 'echo A') };

// A program that already loads one library, `one`, through its `__CCD_LIBS` line, inside a function as ccd does.
const ONE = lib('one', ['one_1', 'fo() { :; }\n']);
const withArray = (words: string, middle: string): string =>
  SHEBANG + FA + 'X=1\n' + middle + DECL + '# @ccd-lib:one_1 — `fo` moved to ccd/lib/one.sh\n'
  + `__CCD_LIBS=(${words})\n` + LOADER;
const baseWithArray: Tree = { 'ccd/ccd': withArray('one', FB_LEAD + FB), 'ccd/lib/one.sh': ONE };
const movedWithOneNewWord: Tree = {
  'ccd/ccd': withArray('one t', '# @ccd-lib:t_1 — `fb` moved to ccd/lib/t.sh\n'),
  'ccd/lib/one.sh': ONE, 'ccd/lib/t.sh': lib('t', ['t_1', FB_LEAD + FB]),
};
const movedWithAnotherWordDropped: Tree = { ...movedWithOneNewWord, 'ccd/ccd': movedWithOneNewWord['ccd/ccd']!.replace('(one t)', '(t)') };
// The region took the bare `declare -A` below it: inside the load's function it turns local, and the global is gone.
const movedWithBareDeclare: Tree = {
  'ccd/ccd': withArray('one t', '# @ccd-lib:t_1 — `fb` moved to ccd/lib/t.sh\n').replace(DECL, ''),
  'ccd/lib/one.sh': ONE, 'ccd/lib/t.sh': lib('t', ['t_1', FB_LEAD + FB + DECL]),
};
// An older pointer sits between fa and fb; a run that takes fa through fb carries it into the library, where nothing splices it.
const baseWithPointer: Tree = {
  'ccd/ccd': SHEBANG + FA + '# @ccd-lib:one_1 — `fo` moved to ccd/lib/one.sh\n' + FB_LEAD + FB + 'X=1\n__CCD_LIBS=(one)\n' + LOADER,
  'ccd/lib/one.sh': ONE,
};
const movedOverThePointer: Tree = {
  'ccd/ccd': SHEBANG + '# @ccd-lib:t_1 — `fa`, `fb` moved to ccd/lib/t.sh\n' + 'X=1\n__CCD_LIBS=(one t)\n' + LOADER,
  'ccd/lib/one.sh': ONE,
  'ccd/lib/t.sh': lib('t', ['t_1', FA + '# @ccd-lib:one_1 — `fo` moved to ccd/lib/one.sh\n' + FB_LEAD + FB]),
};
const mainAndLibWithSameFn: Tree = { 'ccd/ccd': SHEBANG + FA + FB, 'ccd/lib/t.sh': lib('t', ['t_1', FA]) };
// A library of NEW code (the Overlord W1 pool set's ccd/lib/pool-set.sh, the case #2810's pin did not foresee): a pointer
// whose region defines no function ccd/ccd defined at the base, beside a feature edit in ccd/ccd. A feature, not a move.
const FN = 'fn_new() { echo new; }\n';
const newCodeLibrary: Tree = {
  'ccd/ccd': base['ccd/ccd']!.replace('echo a', 'echo A').replace('X=1\n', 'X=1\n# @ccd-lib:n_1 — new code in ccd/lib/n.sh\n'),
  'ccd/lib/n.sh': lib('n', ['n_1', 'N_MAX=1\n' + FN]),
};
// The same new-code pointer beside a real move that edits what it moves: the move is still judged, and still caught.
const newCodeBesideAnEditedMove: Tree = {
  ...newCodeLibrary,
  'ccd/ccd': movedAndEdited['ccd/ccd']!.replace('X=1\n', 'X=1\n# @ccd-lib:n_1 — new code in ccd/lib/n.sh\n'),
  'ccd/lib/t.sh': movedAndEdited['ccd/lib/t.sh']!,
};
// The new-code fixture with one function moved out of ccd/ccd into the SAME region: a region that mixes moved and new code.
const newCodeMixedWithAMove: Tree = {
  'ccd/ccd': newCodeLibrary['ccd/ccd']!.replace(FB_LEAD + FB, ''),
  'ccd/lib/n.sh': lib('n', ['n_1', 'N_MAX=1\n' + FN + FB_LEAD + FB]),
};
// New code, but the diff also drops a function from ccd/ccd that went nowhere: judged in full.
const newCodeWhileRemovingFromMain: Tree = { ...newCodeLibrary, 'ccd/ccd': newCodeLibrary['ccd/ccd']!.replace(FB_LEAD + FB, '') };
// A region holding a function a base LIBRARY defined is not new code either.
const baseWithOneLib: Tree = { ...base, 'ccd/lib/one.sh': ONE };
const newPointerOverALibFunction: Tree = {
  ...newCodeLibrary, 'ccd/lib/one.sh': ONE, 'ccd/lib/n.sh': lib('n', ['n_1', 'N_MAX=1\nfo() { :; }\n']),
};
// A "new" library whose region holds a function ccd/ccd defined at the base is a move, however its pointer reads.
const moveCalledNewCode: Tree = {
  'ccd/ccd': movedAndEdited['ccd/ccd']!.replace('# @ccd-lib:t_1 — `fb` moved to ccd/lib/t.sh', '# @ccd-lib:t_1 — new code in ccd/lib/t.sh'),
  'ccd/lib/t.sh': movedAndEdited['ccd/lib/t.sh']!,
};
const oneLinerThenAssignment = 'fa() { :; }\nX=1\n';
const regionHoldingTwoFunctions = 'fa() { :; }; fb() { :; }\n';

describe('the pure-move pin (fixtures)', () => {
  it('FIXTURE: a diff that adds a pointer is a pure move', () => {
    expect(pureMoveVerdict(base, movedByteForByte)).toEqual({ pure: true, differing: [] });
    expect(pureMoveVerdict(base, movedAndEdited)).toEqual({ pure: false, differing: ['fb'] });
    // A library nothing loads is not a move: without the `__CCD_LIBS` word its functions would vanish.
    const unloaded = { ...movedByteForByte, 'ccd/ccd': movedByteForByte['ccd/ccd']!.replace('__CCD_LIBS=(t)\n', '') };
    expect(pureMoveVerdict(base, unloaded)!.differing).toContain('__CCD_LIBS');
  });

  it('FIXTURE: a diff with no new pointer is not judged', () => {
    expect(pureMoveVerdict(base, featureEdit)).toBeNull();
  });

  it('FIXTURE: a new pointer to NEW code is not judged as a move, and the verdict says so; a move beside it, in it or under its name still is (new-code-library-is-not-a-move)', () => {
    expect(pureMoveVerdict(base, newCodeLibrary)).toEqual({ pure: true, differing: [], newCode: { ids: ['n_1'], note: NEW_CODE_NOT_JUDGED } });
    expect(NEW_CODE_NOT_JUDGED).toBe('new library code, not judged as a move');
    const mixed = pureMoveVerdict(base, newCodeMixedWithAMove);
    expect(mixed?.pure, 'one function moved into the new-code region').toBe(false);
    expect(mixed?.newCode).toBeUndefined();
    expect(pureMoveVerdict(base, newCodeWhileRemovingFromMain)?.pure, 'a function left ccd/ccd in the same diff').toBe(false);
    expect(pureMoveVerdict(baseWithOneLib, newPointerOverALibFunction)?.pure, 'a base library\'s function is not new code').toBe(false);
    const beside = pureMoveVerdict(base, newCodeBesideAnEditedMove);
    expect(beside?.pure).toBe(false);
    expect(beside?.differing).toContain('fb');
    expect(pureMoveVerdict(base, moveCalledNewCode)).toEqual({ pure: false, differing: ['fb'] });
    // A new pointer with no region anywhere stays judged: `fb` left ccd/ccd and went nowhere.
    const vanished: Tree = { 'ccd/ccd': movedByteForByte['ccd/ccd']! };
    expect(pureMoveVerdict(base, vanished)?.pure).toBe(false);
  });

  it('FIXTURE: the __CCD_LIBS line may gain the moved library and nothing else', () => {
    expect(pureMoveVerdict(baseWithArray, movedWithOneNewWord)).toEqual({ pure: true, differing: [] });
    expect(pureMoveVerdict(baseWithArray, movedWithAnotherWordDropped)).toEqual({ pure: false, differing: ['__CCD_LIBS'] });
  });

  it('FIXTURE: a run that crosses an older pointer is not pure', () => {
    expect(pureMoveVerdict(baseWithPointer, movedOverThePointer)!.pure).toBe(false);
  });

  it('FIXTURE: a rebase that keeps the old function reds as a double definition', () => {
    expect(duplicateDefinitions(mainAndLibWithSameFn)).toEqual(['fa']);
    expect(duplicateDefinitions(movedByteForByte)).toEqual([]);
  });

  it('FIXTURE: the dump ignores __CCD_LIBS and sees a swallowed global', () => {
    expect(programDump(movedWithOneNewWord)).toBe(programDump(baseWithArray));
    expect(programDump(movedWithBareDeclare)).not.toBe(programDump(baseWithArray));
    expect(programDump(baseWithArray)).toContain('declare -A _M=');
  });

  it('FIXTURE: a region refuses a top-level line, a second definition or a variable', () => {
    expect(regionProblems(oneLinerThenAssignment)).toEqual([]);   // the assignment stays out of the region
    expect(regionProblems(regionHoldingTwoFunctions)).toEqual(['two definitions']);
    expect(regionProblems('fa() { :; }; Y=2\n')).toEqual(['sets a variable: Y']);
  });

  it('FIXTURE: moveBase is the queue\'s base_sha in a merge_group run, else the merge-base with origin/main', () => {
    const dir = fixtureRepo({ 'a.txt': 'a\n' });
    const first = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', first);
    write(dir, 'a.txt', 'b\n');
    git(dir, 'commit', '-qam', 'b');
    expect(moveBase({}, dir)).toBe(first);
    const ev = path.join(dir, 'event.json');
    writeFileSync(ev, JSON.stringify({ merge_group: { base_sha: 'f'.repeat(40) } }));
    expect(moveBase({ GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: ev }, dir)).toBe('f'.repeat(40));
    writeFileSync(ev, '{}');
    expect(() => moveBase({ GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: ev }, dir)).toThrow(/base_sha/);
  });
});

// ── the slice tool on a fixture repository ──────────────────────────────────────────────────────────────────────
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const GIT_ENV = {
  ...inheritedEnv(), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: 'pipe' }).trim();
const write = (dir: string, rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};
function fixtureRepo(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ccd-split-')));
  made.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
const tool = (dir: string, ...args: string[]) => {
  const r = spawnSyncGroup('python3', ['-I', CCD_SPLIT_TOOL, '--root', dir, ...args],
    { cwd: dir, encoding: 'utf8', timeout: 120_000, env: GIT_ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

// Three C9 functions and one C5, with top-level lines between them and the load at the foot.
const PROGRAM = SHEBANG
  + '# lead of d_one\nd_one() {\n  echo one\n}\n\n# between, carried with the run\nd_two() { echo two; }\n'
  + 'TOP=1\n'
  + 'c_one() {\n  echo c\n}\n'
  + '# lead of d_three\nd_three() {\n  local x=1\n  echo "$x"\n}\n'
  + DECL + '__CCD_LIBS=()\n' + LOADER;
const CONTEXTS = '# fixture manifest\nd_one\tC9\nd_two\tC9\nc_one\tC5\nd_three\tC9\n';
const TABLE = '# fixture table\n1\tdocs\tC9\t.\n2\tcoordination\tC5\t.\n';
const toolRepo = (program = PROGRAM): string =>
  fixtureRepo({ 'ccd/ccd': program, 'ccd/contexts.tsv': CONTEXTS, '.github/ci/ccd-split-slices.tsv': TABLE });
const treeOf = (dir: string): Tree => {
  const t: Record<string, string> = { 'ccd/ccd': readFileSync(path.join(dir, 'ccd/ccd'), 'utf8') };
  for (const n of ['docs', 'coordination']) {
    const p = path.join(dir, `ccd/lib/${n}.sh`);
    if (existsSync(p)) t[`ccd/lib/${n}.sh`] = readFileSync(p, 'utf8');
  }
  return t;
};
/** A PR head on its own branch: `edit` applied to ccd/ccd, committed, and main checked out again. */
const prHead = (dir: string, name: string, edit: (s: string) => string): string => {
  git(dir, 'checkout', '-qb', name);
  write(dir, 'ccd/ccd', edit(readFileSync(path.join(dir, 'ccd/ccd'), 'utf8')));
  git(dir, 'commit', '-qam', name);
  const sha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  return sha;
};

describe('the slice tool (fixtures)', () => {
  it('FIXTURE: plan counts the slice: functions, lines and runs by the region rule', () => {
    const dir = toolRepo();
    const r = tool(dir, 'plan', 'docs');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('slice 1 docs: 3 functions, 12 lines, 2 runs');
  });

  it('FIXTURE: move is pure, byte for byte and in the dump, and unmove puts every byte back', () => {
    const dir = toolRepo();
    const heads = path.join(dir, 'heads');
    writeFileSync(heads, '');
    const before = treeOf(dir);
    const r = tool(dir, 'move', 'docs', '--heads', heads);
    expect(r.status, r.err).toBe(0);
    const after = treeOf(dir);
    expect(after['ccd/ccd']).toContain('__CCD_LIBS=(docs)\n');
    expect(pureMoveVerdict(before, after)).toEqual({ pure: true, differing: [] });
    expect(spliceCcd(after['ccd/ccd']!, [after['ccd/lib/docs.sh']!]))
      .toBe(before['ccd/ccd']!.replace('__CCD_LIBS=()', '__CCD_LIBS=(docs)'));
    expect(programDump(after)).toBe(programDump(before));
    expect(readFileSync(path.join(dir, 'ccd/contexts.tsv'), 'utf8')).toBe('# fixture manifest\nc_one\tC5\nd_one\tC9\nd_two\tC9\nd_three\tC9\n');
    const back = tool(dir, 'unmove', 'docs');
    expect(back.status, back.err).toBe(0);
    expect(treeOf(dir)).toEqual(before);
    expect(readFileSync(path.join(dir, 'ccd/contexts.tsv'), 'utf8')).toBe(CONTEXTS);
  });

  it('FIXTURE: move refuses without a __CCD_LIBS line, and a table row that names K', () => {
    const dir = toolRepo(PROGRAM.replace('__CCD_LIBS=()\n', ''));
    const heads = path.join(dir, 'heads');
    writeFileSync(heads, '');
    const r = tool(dir, 'move', 'docs', '--heads', heads);
    expect(r.status).toBe(1);
    expect(r.err).toContain('no `__CCD_LIBS=(` line');
    write(dir, '.github/ci/ccd-split-slices.tsv', '1\tkernels\tK\t.\n');
    expect(tool(dir, 'plan', 'kernels').err).toContain('K stays in the spine');
  });

  it('FIXTURE: the yield check (S1): a slice an open PR head touches is refused, naming the head; others move', () => {
    const dir = toolRepo();
    const inBody = prHead(dir, 'pr-body', (s) => s.replace('  echo "$x"', '  echo "$x" >&2'));
    const inLead = prHead(dir, 'pr-lead', (s) => s.replace('# between, carried with the run', '# between, reworded'));
    const topLevel = prHead(dir, 'pr-top', (s) => s.replace('TOP=1', 'TOP=2'));
    const heads = path.join(dir, 'heads');
    writeFileSync(heads, `# open PR heads, written by the caller\n${inBody} #101\n${inLead} #102\n${topLevel} #103\n`);
    const pre = tool(dir, 'preflight', 'docs', '--heads', heads);
    expect(pre.status).toBe(1);
    expect(pre.err).toContain(`#101 (${inBody}): d_three`);
    expect(pre.err).toContain(`#102 (${inLead}): d_two`);
    expect(pre.err).not.toContain('#103');
    // The C5 slice is clear: no open head touches c_one.
    expect(tool(dir, 'preflight', 'coordination', '--heads', heads).status).toBe(0);
    // move runs the same check first, and writes nothing when it refuses.
    const before = treeOf(dir);
    const mv = tool(dir, 'move', 'docs', '--heads', heads);
    expect(mv.status).toBe(1);
    expect(mv.err).toContain('#101');
    expect(treeOf(dir)).toEqual(before);
    // An insertion inside a function touches it too.
    const insert = prHead(dir, 'pr-insert', (s) => s.replace('  local x=1\n', '  local x=1\n  : inserted\n'));
    writeFileSync(heads, `${insert} #104\n`);
    expect(tool(dir, 'preflight', 'docs', '--heads', heads).err).toContain('#104');
    // A head this repository does not hold refuses: the tool never fetches.
    writeFileSync(heads, `${'0'.repeat(40)} #105\n`);
    const gone = tool(dir, 'preflight', 'coordination', '--heads', heads);
    expect(gone.status).toBe(1);
    expect(gone.err).toContain('is not in this repository: fetch it first');
  });
});

// ── the real tree, judged from moveBase at test time ───────────────────────────────────────────────────────────
function resolveBase(): string | null {
  try {
    return moveBase(process.env, REPO);
  } catch (e) {
    if (process.env['GITHUB_EVENT_NAME'] === 'merge_group') throw e;
    console.log(`ccd-split-pin: the REAL rows skip: ${(e as Error).message.split('\n')[0]}`);
    return null;
  }
}

describe('the pure-move pin (the real tree)', () => {
  it('REAL: this diff, against moveBase, is pure if it adds a pointer', (ctx) => {
    const b = resolveBase();
    if (b === null) return ctx.skip();
    const verdict = pureMoveVerdict(treeAt(b, REPO), treeAt('HEAD', REPO));
    if (verdict !== null) expect(verdict, 'a diff that adds a pointer moves bytes and changes none').toMatchObject({ pure: true, differing: [] });
  });

  it('REAL: a record added in this diff holds', (ctx) => {
    const b = resolveBase();
    if (b === null) return ctx.skip();
    const records = recordsAdded(b, 'HEAD', REPO);
    if (records.length === 0) return;
    const before = treeAt(b, REPO);
    const after = treeAt('HEAD', REPO);
    expect(programDump(after), 'the program a move leaves is the program it found').toBe(programDump(before));
    const defs = (text: string | undefined): string[] =>
      [...(text ?? '').matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{/gm)].map((m) => m[1]!);
    const moved = records.flatMap((r) => r.functions);
    expect(defs(after['ccd/ccd']).length, 'the spine loses exactly the records\' functions')
      .toBe(defs(before['ccd/ccd']).length - moved.length);
    expect(duplicateDefinitions(after)).toEqual([]);
    for (const r of records) {
      for (const f of r.functions) {
        expect(defs(before['ccd/ccd']), `${f} sat in ccd/ccd before the move`).toContain(f);
        expect(defs(after[`ccd/lib/${r.library}.sh`]), `${f} sits in ccd/lib/${r.library}.sh after it`).toContain(f);
      }
    }
  });
});
