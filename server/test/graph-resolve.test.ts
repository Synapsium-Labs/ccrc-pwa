// Graphify revision 2, Task GR3 (D-7349; spec §2.1, §2.2): ccd/graph-resolve's store, repository key and source
// ref. These are the ONLY definitions of the three (plan review focus 8); every reader sources this library.
//
//   _gr_store            the store root's realpath, refusing a relative path, `/`, $HOME, and anything inside
//                        $HOME/projects or $HOME/worktrees (compared as realpaths); the reason in GR_WHY;
//   _gr_store_init       creates the root (0755) and its .ccrc-graph-store marker; refuses a non-empty root
//                        without the marker (D-7360: one function, later called by the sweep and install);
//   _gr_repo_key         `<basename of the main checkout>-<first 8 hex of sha256(realpath(common dir))>`;
//   _gr_source_ref       SOURCE_REF, origin/HEAD, origin/main, origin/master, the local default branch; prints
//                        `<full ref> <commit>`, or rc 1 (no-source).
//
// Every run sources the real ccd/ccrc and ccd/graph-resolve in a fixture HOME through one fixed driver; paths and
// values are its arguments, never spliced into the script.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const RESOLVE = path.join(REPO, 'ccd', 'graph-resolve');

/** $1 ccd/ccrc, $2 ccd/graph-resolve, $3 `knobs` (GK from `_gr_knobs`, the sweep's mode) or `direct` (GK holds
 *  only CCRC_GRAPH_STORE=$4 and CCRC_GRAPH_SOURCE_REF=$5, bypassing the shape check), $6 the function, the rest its
 *  arguments. Prints the function's stdout, then `RC<TAB>n` and `WHY<TAB>GR_WHY`. */
const DRIVER = `. "$1" || exit 90
. "$2" || exit 91
mode="$3" store="$4" ref="$5" fn="$6"; shift 6
if [ "$mode" = knobs ]; then _gr_knobs || exit 92
else declare -gA GK=([CCRC_GRAPH_STORE]="$store" [CCRC_GRAPH_SOURCE_REF]="$ref"); fi
GR_WHY=""
"$fn" "$@"; rc=$?
printf 'RC\\t%s\\nWHY\\t%s\\n' "$rc" "$GR_WHY"
`;

interface Out { out: string[]; rc: number; why: string; stderr: string }
function call(home: string, how: { mode: 'knobs' | 'direct'; store?: string; ref?: string; env?: NodeJS.ProcessEnv },
  fn: string, ...args: string[]): Out {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('GIT_')) env[k] = v;
  Object.assign(env, { HOME: home }, how.env ?? {});
  const r = spawnSync('bash', ['-c', DRIVER, 'graph-resolve-driver', CCRC, RESOLVE, how.mode, how.store ?? '', how.ref ?? '', fn, ...args],
    { env, encoding: 'utf8', cwd: home, timeout: 60000 });
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  const rc = Number(/^RC\t(\d+)$/m.exec(r.stdout ?? '')?.[1] ?? 'NaN');
  const why = /^WHY\t(.*)$/m.exec(r.stdout ?? '')?.[1] ?? '(no WHY line)';
  return { out: lines.filter((l) => !/^(RC|WHY)\t/.test(l)), rc, why, stderr: r.stderr ?? '' };
}
const direct = (store: string, ref = 'origin/HEAD') => ({ mode: 'direct' as const, store, ref });

const git = (cwd: string, ...args: string[]): string => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  Object.assign(env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
};
const home = (): string => { const h = mkTmp('graph-resolve-'); mkdirSync(path.join(h, '.ccrc'), { recursive: true }); return h; };
/** A main checkout `project-a` with one commit on `branch`, under `<h>/projects`. */
function checkout(h: string, name = 'project-a', branch = 'main'): string {
  const d = path.join(h, 'projects', name);
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', branch);
  writeFileSync(path.join(d, 'a.txt'), 'a\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'one');
  return d;
}
const sha8 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 8);

describe('_gr_store: the store root, as a realpath, never a root the sweep or ccd enumerates (spec §2.2)', () => {
  it('the default ($HOME/.ccrc/graphs, through _gr_knobs) is printed as a realpath even before it exists', () => {
    const h = home();
    const r = call(h, { mode: 'knobs' }, '_gr_store');
    expect(r.rc, r.stderr).toBe(0);
    expect(r.out).toEqual([path.join(h, '.ccrc', 'graphs')]);
    expect(r.why).toBe('');
  });

  it('a store reached through a link prints the link\'s target', () => {
    const h = home();
    mkdirSync(path.join(h, 'data', 'graphs'), { recursive: true });
    symlinkSync(path.join(h, 'data'), path.join(h, 'alias'));
    const r = call(h, direct(path.join(h, 'alias', 'graphs')), '_gr_store');
    expect(r.rc, r.stderr).toBe(0);
    expect(r.out).toEqual([path.join(h, 'data', 'graphs')]);
  });

  it.each([
    ['a relative path', () => 'graphs', /is not an absolute path/],
    ['the filesystem root', () => '/', /is the filesystem root/],
    ['the home directory', (h: string) => h, /is the home directory/],
    ['the home directory, spelled with a trailing slash', (h: string) => `${h}/`, /is the home directory/],
    ['the projects root', (h: string) => path.join(h, 'projects'), /is inside ~\/projects, which the sweep and ccd enumerate/],
    ['inside the projects root', (h: string) => path.join(h, 'projects', 'project-a', 'graphs'), /is inside ~\/projects/],
    ['inside the worktrees root', (h: string) => path.join(h, 'worktrees', 'lane-a', 'graphs'), /is inside ~\/worktrees/],
    ['inside a root through a link', (h: string) => path.join(h, 'alias', 'graphs'), /is inside ~\/projects/],
    ['a missing part named ..', (h: string) => path.join(h, 'missing') + '/../graphs', /cannot be resolved to a real path/],
    ['empty', () => '', /is not set/],
  ])('refuses %s, with the reason in GR_WHY and nothing printed', (_name, store, why) => {
    const h = home();
    mkdirSync(path.join(h, 'projects'), { recursive: true });
    mkdirSync(path.join(h, 'worktrees'), { recursive: true });
    symlinkSync(path.join(h, 'projects'), path.join(h, 'alias'));
    const r = call(h, direct(store(h)), '_gr_store');
    expect(r.rc, r.stderr).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.why).toMatch(why);
  });

  it('a relative CCRC_GRAPH_STORE in the environment never reaches _gr_store: _gr_knobs keeps the default', () => {
    const h = home();
    const r = call(h, { mode: 'knobs', env: { CCRC_GRAPH_STORE: 'graphs' } }, '_gr_store');
    expect(r.rc, r.stderr).toBe(0);
    expect(r.out).toEqual([path.join(h, '.ccrc', 'graphs')]);
  });

  it('an absolute CCRC_GRAPH_STORE in the environment is the store (the sweep\'s mode)', () => {
    const h = home();
    const r = call(h, { mode: 'knobs', env: { CCRC_GRAPH_STORE: path.join(h, 'srv', 'graphs') } }, '_gr_store');
    expect(r.rc, r.stderr).toBe(0);
    expect(r.out).toEqual([path.join(h, 'srv', 'graphs')]);
  });
});

describe('_gr_store_init: the root and its .ccrc-graph-store marker, one function (D-7360)', () => {
  it('creates a missing root 0755 with the marker, prints it, and is a no-op the second time', () => {
    const h = home();
    const store = path.join(h, 'srv', 'graphs');
    const a = call(h, direct(store), '_gr_store_init');
    expect(a.rc, a.stderr + a.why).toBe(0);
    expect(a.out).toEqual([store]);
    expect(statSync(store).mode & 0o777).toBe(0o755);
    const marker = readFileSync(path.join(store, '.ccrc-graph-store'), 'utf8');
    expect(marker).not.toBe('');
    writeFileSync(path.join(store, 'kept'), 'x');
    const b = call(h, direct(store), '_gr_store_init');
    expect(b.rc, b.why).toBe(0);
    expect(b.out).toEqual([store]);
    expect(readFileSync(path.join(store, 'kept'), 'utf8')).toBe('x');
    expect(readFileSync(path.join(store, '.ccrc-graph-store'), 'utf8')).toBe(marker);
  });

  it('adopts an existing EMPTY directory', () => {
    const h = home();
    const store = path.join(h, 'graphs');
    mkdirSync(store);
    const r = call(h, direct(store), '_gr_store_init');
    expect(r.rc, r.why).toBe(0);
    expect(existsSync(path.join(store, '.ccrc-graph-store'))).toBe(true);
  });

  it('refuses a non-empty root without the marker and writes nothing into it', () => {
    const h = home();
    const store = path.join(h, 'graphs');
    mkdirSync(store);
    writeFileSync(path.join(store, '.someone-elses'), 'x');
    const r = call(h, direct(store), '_gr_store_init');
    expect(r.rc).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.why).toMatch(/is not empty and has no \.ccrc-graph-store marker; refusing to adopt it/);
    expect(existsSync(path.join(store, '.ccrc-graph-store'))).toBe(false);
  });

  it('refuses a root that is a file', () => {
    const h = home();
    writeFileSync(path.join(h, 'graphs'), 'x');
    const r = call(h, direct(path.join(h, 'graphs')), '_gr_store_init');
    expect(r.rc).toBe(1);
    expect(r.why).toMatch(/exists and is not a directory/);
  });

  it('refuses whatever _gr_store refuses, creating nothing', () => {
    const h = home();
    const store = path.join(h, 'projects', 'graphs');
    const r = call(h, direct(store), '_gr_store_init');
    expect(r.rc).toBe(1);
    expect(r.why).toMatch(/is inside ~\/projects/);
    expect(existsSync(store)).toBe(false);
  });
});

describe('_gr_repo_key: one key per repository, the same from every tree of it (spec §2.1)', () => {
  it('the main checkout and a linked worktree of one repository get one key: basename + sha8 of the common dir\'s realpath', () => {
    const h = home();
    const main = checkout(h);
    const wt = path.join(h, 'worktrees', 'lane-a');
    mkdirSync(path.dirname(wt), { recursive: true });
    git(main, 'worktree', 'add', '-q', '-b', 'lane-a', wt);
    const fromMain = git(main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const fromWt = git(wt, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const a = call(h, direct(''), '_gr_repo_key', fromMain);
    const b = call(h, direct(''), '_gr_repo_key', fromWt);
    expect(a.rc, a.why).toBe(0);
    expect(b.rc, b.why).toBe(0);
    const want = `project-a-${sha8(realpathSync(path.join(main, '.git')))}`;
    expect(a.out).toEqual([want]);
    expect(b.out).toEqual([want]);
    expect(want).toMatch(/^[A-Za-z0-9._-]+-[0-9a-f]{8}$/);
  });

  it('a common dir reached through a link gives the same key as its realpath', () => {
    const h = home();
    const main = checkout(h);
    symlinkSync(path.join(h, 'projects'), path.join(h, 'alias'));
    const a = call(h, direct(''), '_gr_repo_key', path.join(main, '.git'));
    const b = call(h, direct(''), '_gr_repo_key', path.join(h, 'alias', 'project-a', '.git'));
    expect(a.out).toEqual([`project-a-${sha8(realpathSync(path.join(main, '.git')))}`]);
    expect(b.out).toEqual(a.out);
  });

  it('two repositories with one basename get two keys; a bare repository drops its .git suffix', () => {
    const h = home();
    const one = checkout(h);
    const two = path.join(h, 'other', 'project-a');
    mkdirSync(two, { recursive: true });
    git(two, 'init', '-q');
    const bare = path.join(h, 'lane-a.git');
    git(h, 'init', '-q', '--bare', bare);
    const k1 = call(h, direct(''), '_gr_repo_key', path.join(one, '.git')).out[0];
    const k2 = call(h, direct(''), '_gr_repo_key', path.join(two, '.git')).out[0];
    const k3 = call(h, direct(''), '_gr_repo_key', bare).out[0];
    expect(k1).toMatch(/^project-a-[0-9a-f]{8}$/);
    expect(k2).toMatch(/^project-a-[0-9a-f]{8}$/);
    expect(k1).not.toBe(k2);
    expect(k3).toBe(`lane-a-${sha8(realpathSync(bare))}`);
  });

  it('a missing common dir is refused with GR_WHY', () => {
    const h = home();
    const r = call(h, direct(''), '_gr_repo_key', path.join(h, 'nowhere', '.git'));
    expect(r.rc).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.why).toMatch(/does not exist/);
  });
});

describe('_gr_source_ref: the source ref and its commit, or no-source (spec §2.2, §5.4)', () => {
  /** A main checkout cloned from an upstream with branches main, master and release; origin/HEAD set to main. */
  function cloned(h: string): { co: string; common: string; up: string } {
    const up = checkout(h, 'upstream', 'main');
    git(up, 'branch', 'master');
    git(up, 'checkout', '-q', '-b', 'release');
    writeFileSync(path.join(up, 'r.txt'), 'r\n');
    git(up, 'add', '-A');
    git(up, 'commit', '-q', '-m', 'release');
    git(up, 'checkout', '-q', 'main');
    const co = path.join(h, 'projects', 'project-a');
    git(h, 'clone', '-q', up, co);
    return { co, common: path.join(co, '.git'), up };
  }
  const head = (co: string, ref: string): string => git(co, 'rev-parse', ref);

  it('the default, origin/HEAD, prints the ref it points at and its commit', () => {
    const h = home();
    const { co, common } = cloned(h);
    const r = call(h, { mode: 'knobs' }, '_gr_source_ref', common);
    expect(r.rc, r.why).toBe(0);
    expect(r.out).toEqual([`refs/remotes/origin/main ${head(co, 'origin/main')}`]);
  });

  it('CCRC_GRAPH_SOURCE_REF wins when it names a commit', () => {
    const h = home();
    const { co, common } = cloned(h);
    const r = call(h, { mode: 'knobs', env: { CCRC_GRAPH_SOURCE_REF: 'origin/release' } }, '_gr_source_ref', common);
    expect(r.out).toEqual([`refs/remotes/origin/release ${head(co, 'origin/release')}`]);
  });

  it('a SOURCE_REF that names nothing falls back to origin/HEAD', () => {
    const h = home();
    const { co, common } = cloned(h);
    const r = call(h, direct('', 'origin/gone'), '_gr_source_ref', common);
    expect(r.out).toEqual([`refs/remotes/origin/main ${head(co, 'origin/main')}`]);
  });

  it('no origin/HEAD: origin/main; no origin/main either: origin/master', () => {
    const h = home();
    const { co, common } = cloned(h);
    git(co, 'remote', 'set-head', 'origin', '-d');
    expect(call(h, direct('', 'origin/HEAD'), '_gr_source_ref', common).out).toEqual([`refs/remotes/origin/main ${head(co, 'origin/main')}`]);
    git(co, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(call(h, direct('', 'origin/HEAD'), '_gr_source_ref', common).out).toEqual([`refs/remotes/origin/master ${head(co, 'origin/master')}`]);
  });

  it('no remote at all: the local default branch (the branch the main checkout\'s HEAD names)', () => {
    const h = home();
    const co = checkout(h, 'project-a', 'trunk');
    const r = call(h, direct('', 'origin/HEAD'), '_gr_source_ref', path.join(co, '.git'));
    expect(r.rc, r.why).toBe(0);
    expect(r.out).toEqual([`refs/heads/trunk ${head(co, 'trunk')}`]);
  });

  it('nothing names a commit (an empty repository): rc 1, no-source', () => {
    const h = home();
    const d = path.join(h, 'projects', 'project-a');
    mkdirSync(d, { recursive: true });
    git(d, 'init', '-q');
    const r = call(h, direct('', 'origin/HEAD'), '_gr_source_ref', path.join(d, '.git'));
    expect(r.rc).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.why).toMatch(/^no-source: /);
  });

  it('a GIT_DIR in the caller\'s environment does not answer for the common dir named', () => {
    const h = home();
    const { co, common } = cloned(h);
    // Another repository with objects of its own (a commit of its own content, so no commit id is shared).
    const other = path.join(h, 'projects', 'lane-a');
    mkdirSync(other, { recursive: true });
    git(other, 'init', '-q', '-b', 'other');
    writeFileSync(path.join(other, 'only-here.txt'), 'lane-a\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'lane-a only');
    const env = { GIT_DIR: path.join(other, '.git'), GIT_COMMON_DIR: path.join(other, '.git'), GIT_OBJECT_DIRECTORY: path.join(other, '.git', 'objects') };
    const r = call(h, { ...direct('', 'origin/HEAD'), env }, '_gr_source_ref', common);
    expect(r.out).toEqual([`refs/remotes/origin/main ${head(co, 'origin/main')}`]);
  });
});

// ── one definition ────────────────────────────────────────────────────────
const DEF = /^\s*(_gr_store|_gr_store_init|_gr_repo_key|_gr_source_ref)\s*\(\)/;
/** Every code-line definition of the four names, and every file spelling the marker's name in code. */
function definitions(files: Map<string, string>): { defs: string[]; markers: string[] } {
  const defs: string[] = [];
  const markers = new Set<string>();
  for (const [f, t] of files) {
    for (const l of t.split('\n')) {
      if (/^\s*#/.test(l)) continue;
      const d = DEF.exec(l);
      if (d) defs.push(`${f}#${d[1]}`);
      if (l.includes('.ccrc-graph-store')) markers.add(f);
    }
  }
  return { defs, markers: [...markers] };
}
function ccdAndDeploy(): Map<string, string> {
  const files = new Map<string, string>();
  for (const f of execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'ccd', 'deploy'],
    { cwd: REPO, encoding: 'utf8' }).split('\0')) {
    if (f === '' || !existsSync(path.join(REPO, f))) continue;
    const t = readFileSync(path.join(REPO, f), 'utf8');
    if (!t.includes('\0')) files.set(f, t);
  }
  return files;
}
const ONE = {
  defs: ['ccd/graph-resolve#_gr_store', 'ccd/graph-resolve#_gr_store_init', 'ccd/graph-resolve#_gr_repo_key', 'ccd/graph-resolve#_gr_source_ref'],
  markers: ['ccd/graph-resolve'],
};

describe('one definition (plan review focus 8)', () => {
  it('the store, the marker, the repository key and the source ref are defined in ccd/graph-resolve alone, each once', () => {
    expect(definitions(ccdAndDeploy())).toEqual(ONE);
  });

  it('calibration: a second spelling in another file goes red; a comment naming one does not', () => {
    const files = ccdAndDeploy();
    files.set('ccd/probe', '# _gr_repo_key() is defined in graph-resolve\n_gr_repo_key() {   # a copy\n  :\n}\n');
    expect(definitions(files).defs).toContain('ccd/probe#_gr_repo_key');
    expect(definitions(files)).not.toEqual(ONE);
    files.set('ccd/probe', 'touch "$store/.ccrc-graph-store"\n');
    expect(definitions(files).markers).toContain('ccd/probe');
  });
});
