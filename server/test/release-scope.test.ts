// deploy/release-scope.mjs: the one list of what a release never ships (centralised update W25; D-6390 to D-6393,
// D-6396, D-6402), and the guard that holds that list against what the build reads.
//
// Three describes. The first two pin the classifier: the rule table and the CLI over fixture repos. The third is the
// guard (D-6396): it derives build-release.sh's inputs from the file's own text, the package scripts npm runs and the
// configs those read, and goes red when an input falls under NOT_SHIPPED or when the build grows a shape the
// derivation does not model. The derivation below is the test's model of the build, not a second list of what ships.
//
// Hermetic: fixture repos live under mkTmp with GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM at /dev/null, so a
// developer's `diff.renames` cannot change an answer; no network.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { stripTs } from './growthCheck.js';
import { NOT_SHIPPED, notShipped, decide } from '../../deploy/release-scope.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const HELPER = join(REPO, 'deploy', 'release-scope.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

describe('W25 the rule table', () => {
  it.each([
    ['docs/a.md', true], ['docs/superpowers/plans/x.md', true], ['README.md', true], ['CLAUDE.md', true],
    ['SECURITY.md', true], ['LICENSE', true], ['server/test/a.test.ts', true], ['server/test/fixtures/x/y.json', true],
    ['server/test-e2e/a.ts', true], ['agent/test/a.test.ts', true],
    ['ccd/worker-skill/SKILL.md', false], ['ccd/coordinator-skill/references/resume.md', false],
    ['agent/CLAUDE.md', false], ['ui/README.md', false], ['pwa/src/docs/DocsLeaf.tsx', false],
    ['server/src/docs/x.ts', false], ['pwa/test/a.test.tsx', false], ['server/testx/a.ts', false],
    ['docsx/a.md', false], ['LICENSE.txt', false], ['server/vitest.config.ts', false],
    ['.github/workflows/release-main.yml', false], ['install.sh', false], ['ui/src/index.ts', false],
  ])('W25-S1: notShipped(%j) is %s', (p, want) => { expect(notShipped(p)).toBe(want); });

  it('W25-S2: six rules, each with a reason, trees bare (no slash at either end, no glob)', () => {
    expect(NOT_SHIPPED).toHaveLength(6);
    expect(Object.isFrozen(NOT_SHIPPED)).toBe(true);
    for (const r of NOT_SHIPPED) {
      expect(r.why.length).toBeGreaterThan(0);
      if ('tree' in r) expect(r.tree).toMatch(/^[a-z][a-z0-9/-]*[a-z0-9]$/);
    }
  });

  it('W25-S12: decide counts every path when none ships, and only the shipped ones when some do', () => {
    expect(decide(['docs/a.md', 'ccd/b', 'agent/test/c', 'deploy/d'])).toEqual({ word: 'changed', count: 2, first: 'ccd/b' });
    expect(decide([])).toEqual({ word: 'unchanged', count: 0 });
  });
});

describe('W25 the CLI over fixture repositories', () => {
  /** A repo under a fresh home, tag v0.0.1 on a commit holding the shipped and unshipped kinds. */
  function fixture(): { home: string; root: string } {
    const home = mkTmp('ccrc-scope-');
    const root = join(home, 'repo');
    const files: Record<string, [string, number]> = {
      'install.sh': ['#!/usr/bin/env bash\necho install\n', 0o755],
      'deploy/x.sh': ['#!/usr/bin/env bash\necho x\n', 0o755],
      'ccd/worker-skill/SKILL.md': ['# skill\n', 0o644],
      'docs/a.md': ['# a\n', 0o644],
      'README.md': ['# readme\n', 0o644],
    };
    for (const [rel, [body, mode]] of Object.entries(files)) {
      mkdirSync(path.dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body, { mode });
    }
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'first');
    git(root, 'tag', 'v0.0.1');
    return { home, root };
  }

  function put(root: string, rel: string, body: string): void {
    mkdirSync(path.dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }

  function commit(root: string, msg = 'change'): void {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '--allow-empty', '-m', msg);
  }

  function run(root: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('node', [HELPER, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  const answer = (root: string, base = 'v0.0.1') => run(root, '--repo', root, '--base', base);

  it('W25-S3: an empty commit changes nothing', () => {
    const { root } = fixture();
    commit(root);
    const r = answer(root);
    expect([r.status, r.stdout]).toEqual([0, 'unchanged 0\n']);
  });

  it('W25-S4: docs, a root markdown file and a server test are all unchanged', () => {
    const { root } = fixture();
    put(root, 'docs/a.md', '# a2\n');
    put(root, 'README.md', '# readme2\n');
    put(root, 'server/test/x.test.ts', 'export {};\n');
    commit(root);
    const r = answer(root);
    expect([r.status, r.stdout]).toEqual([0, 'unchanged 3\n']);
  });

  it('W25-S5: a skill file is shipped, and named', () => {
    const { root } = fixture();
    put(root, 'ccd/worker-skill/SKILL.md', '# skill2\n');
    commit(root);
    const r = answer(root);
    expect([r.status, r.stdout]).toEqual([0, 'changed 1 "ccd/worker-skill/SKILL.md"\n']);
  });

  it('W25-S6: a move out of a shipped tree into docs still names the shipped side (no rename detection)', () => {
    const { root } = fixture();
    git(root, 'mv', 'deploy/x.sh', 'docs/x.sh');
    commit(root);
    const r = answer(root);
    expect([r.status, r.stdout]).toEqual([0, 'changed 1 "deploy/x.sh"\n']);
  });

  it('W25-S7: a mode change alone is a change', () => {
    const { root } = fixture();
    chmodSync(join(root, 'install.sh'), 0o644);
    commit(root);
    const r = answer(root);
    expect([r.status, r.stdout]).toEqual([0, 'changed 1 "install.sh"\n']);
  });

  it('W25-S8: the base is the tag, not HEAD^', () => {
    const { root } = fixture();
    put(root, 'deploy/x.sh', '#!/usr/bin/env bash\necho x2\n');
    commit(root, 'a');
    put(root, 'docs/a.md', '# a3\n');
    commit(root, 'b');
    const r = answer(root);
    expect([r.status, r.stdout]).toEqual([0, 'changed 1 "deploy/x.sh"\n']);
  });

  it('W25-S9: an unknown ref exits 1 with nothing on stdout, and a dash-leading base is refused before git runs', () => {
    const { home, root } = fixture();
    const unknown = answer(root, 'v9.9.9');
    expect([unknown.status, unknown.stdout]).toEqual([1, '']);
    const leak = join(home, 'leak');
    const dash = answer(root, `--output=${leak}`);
    expect(dash.status).not.toBe(0);
    expect(dash.stdout).toBe('');
    expect(readdirSync(home).filter((n) => n.startsWith('leak'))).toEqual([]);
    expect(existsSync(leak)).toBe(false);
  });

  it('W25-S10: an unknown or missing argument exits 2 with nothing on stdout', () => {
    const { root } = fixture();
    const bogus = run(root, '--repo', root, '--base', 'v0.0.1', '--bogus');
    expect([bogus.status, bogus.stdout]).toEqual([2, '']);
    const noBase = run(root, '--repo', root);
    expect([noBase.status, noBase.stdout]).toEqual([2, '']);
    const noRepo = run(root, '--base', 'v0.0.1');
    expect([noRepo.status, noRepo.stdout]).toEqual([2, '']);
  });

  it('W25-S14: the helper answers through a symlinked path, one line, never silence', () => {
    const { home, root } = fixture();
    commit(root);
    symlinkSync(join(REPO, 'deploy'), join(home, 'linked'));
    const r = spawnSync('node', [join(home, 'linked', 'release-scope.mjs'), '--repo', root, '--base', 'v0.0.1'],
      { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
    expect([r.status, r.stdout]).toEqual([0, 'unchanged 0\n']);
  });

  it('W25-S11: a path with a space is read whole (NUL-separated output)', () => {
    const a = fixture();
    put(a.root, 'docs/a b.md', 'x\n');
    commit(a.root);
    expect(answer(a.root).stdout).toBe('unchanged 1\n');
    const b = fixture();
    put(b.root, 'ccd/a b', 'x\n');
    commit(b.root);
    expect(answer(b.root).stdout).toBe('changed 1 "ccd/a b"\n');
  });
});

// ── The guard (D-6396) ────────────────────────────────────────────────────────────────────────────────────────────
type Read = (rel: string) => string | null;
/** `fileDeps`: package name -> repo-relative package dir. `alias`: the repo-relative directory an `@/` specifier resolves into. */
interface Derived { inputs: string[]; fileDeps: Map<string, string>; alias: string }

const readCache = new Map<string, string | null>();
const real: Read = (rel) => {
  if (!readCache.has(rel)) {
    try { readCache.set(rel, readFileSync(join(REPO, rel), 'utf8')); } catch { readCache.set(rel, null); }
  }
  return readCache.get(rel)!;
};

/** What `npm run build` and npm's own lifecycle run in each package the builder installs: the test's model of the
 *  build. A script outside this table is a build step nobody has read the inputs of. */
const SCRIPT_MODEL: Record<string, { runsBuild: boolean; scripts: Record<string, string> }> = {
  server: { runsBuild: true, scripts: { build: 'tsc', postinstall: 'node scripts/fix-node-pty-helper.mjs' } },
  ui: { runsBuild: false, scripts: {} },
  pwa: { runsBuild: true, scripts: { build: 'tsc --noEmit && vite build' } },
  agent: { runsBuild: true, scripts: { build: 'tsc' } },
};
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'preprepare', 'prepare', 'postprepare'];
const BUILD_HOOKS = ['prebuild', 'build', 'postbuild'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** `entry` cut at its first glob segment. */
function cutGlob(entry: string): string {
  const keep: string[] = [];
  for (const seg of entry.split('/')) {
    if (/[*?{[]/.test(seg)) break;
    keep.push(seg);
  }
  return keep.join('/');
}

/** A repo-relative path from `entry` resolved against `dir`, cut at its first glob segment. */
function resolveIn(dir: string, entry: string, what: string): string {
  const cut = cutGlob(entry) || '.';
  const out = path.posix.normalize(path.posix.join(dir, cut)).replace(/\/+$/, '');
  if (out === '..' || out.startsWith('../') || path.posix.isAbsolute(out)) {
    throw new Error(`${what}: ${entry} resolves outside the repository`);
  }
  return out === '.' ? '' : out;
}

/** The directory an `@/` specifier resolves into, derived twice: from the alias `pwa/vite.config.ts` names and from the
 *  `paths` entry `ui/tsconfig.json` names. Throws when either is missing, is not the modelled shape, or they disagree. */
function deriveAlias(read: Read): string {
  const vite = read('pwa/vite.config.ts');
  if (vite === null) throw new Error('pwa/vite.config.ts is unreadable');
  const bare = stripTs(vite);
  const keys = (bare.match(/(['"])@\1\s*:/g) ?? []).length;
  const forms = [...bare.matchAll(/(['"])@\1\s*:\s*fileURLToPath\(\s*new URL\(\s*(['"])([^'"\n]+)\2\s*,\s*import\.meta\.url\s*\)\s*\)/g)];
  if (keys !== 1 || forms.length !== 1) throw new Error(`pwa/vite.config.ts has ${keys} '@' alias keys, ${forms.length} in the modelled fileURLToPath(new URL(...)) shape: the derivation models exactly one`);
  const fromVite = resolveIn('pwa', forms[0]![3]!, "pwa/vite.config.ts alias '@'");
  const tsText = read('ui/tsconfig.json');
  if (tsText === null) throw new Error('ui/tsconfig.json is unreadable');
  const co = (JSON.parse(stripTs(tsText)) as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
  const targets = ((co['paths'] ?? {}) as Record<string, string[]>)['@/*'];
  if (!Array.isArray(targets) || targets.length !== 1 || !targets[0]!.endsWith('/*')) {
    throw new Error('ui/tsconfig.json paths has no single "@/*" entry ending in /*: the alias cannot be derived');
  }
  const baseDir = typeof co['baseUrl'] === 'string' ? resolveIn('ui', co['baseUrl'], 'ui/tsconfig.json baseUrl') || '.' : 'ui';
  const fromTs = resolveIn(baseDir, targets[0]!.slice(0, -2), 'ui/tsconfig.json paths "@/*"');
  if (fromVite !== fromTs) throw new Error(`the '@' alias differs: pwa/vite.config.ts says ${fromVite || '.'}, ui/tsconfig.json says ${fromTs || '.'}`);
  return fromVite;
}

/** build-release.sh's inputs, from its own text, the package scripts npm runs and the configs those read; throws on any shape it does not model. */
function deriveReleaseInputs(read: Read): Derived {
  const sh = read('deploy/build-release.sh');
  if (sh === null) throw new Error('deploy/build-release.sh is unreadable');
  const code = sh.split('\n').filter((l) => !/^\s*#/.test(l));
  const text = code.join('\n');
  const inputs = new Set<string>();
  const fileDeps = new Map<string, string>();

  // 1. Every `$ROOT` read in the builder must be a shape this derivation models.
  const onlyRoot = [
    /^\s*\[ -n "\$OUT_DIR" \] \|\| OUT_DIR="\$ROOT\/release-out"\s*$/,
    /^\s*\|\| die "[^"]*"\s*$/,
    /^\s*\[ -[fd] "\$ROOT\/[a-z]+\/dist[^"]*" \]( \\)?\s*$/,
    /^\s*cp -a "\$ROOT\/[a-z]+\/dist[^"]*"\s+"\$TOP\/[^"]*"\s*$/,
    /^\s*\( cd "\$ROOT\/[a-z]+"\s*&& npm ci\b[^&;|)]*(?:&& npm run build )?\)\s*$/,
  ];
  const gitRoot = /git -C "\$ROOT" (?:status|tag|rev-parse|ls-tree|archive)\b/g;
  for (const line of code) {
    if (!/\$\{?ROOT\b/.test(line)) continue;
    if (onlyRoot.some((re) => re.test(line))) continue;
    if (/\$\{?ROOT\b/.test(line.replace(gitRoot, ''))) {
      throw new Error(`build-release.sh reads "$ROOT" in a shape this derivation does not model: ${line.trim()}`);
    }
  }
  // A dist source path: pkg and the rest of the path after `$ROOT/<pkg>/`, checked once the installed packages are known.
  const distReads: { pkg: string; rest: string; line: string }[] = [];
  for (const line of code) {
    const m = /(?:\[ -[fd] |cp -a )"\$ROOT\/([a-z]+)\/(dist[^"]*)"/.exec(line);
    if (m !== null) distReads.push({ pkg: m[1]!, rest: m[2]!, line: line.trim() });
  }
  const archives = code.filter((l) => /git -C "\$ROOT" archive\b/.test(l)).length;
  if (archives !== 1) throw new Error(`build-release.sh has ${archives} git archive lines, the derivation models exactly one`);
  // The one archive line is pinned to its exact text: its pathspec is PATHSPEC and nothing else.
  const archiveShape = /^git -C "\$ROOT" archive --format=tar HEAD -- "\$\{PATHSPEC\[@\]\}" \| tar -x -C "\$TOP"$/;
  for (const line of code) {
    if (/git -C "\$ROOT" archive\b/.test(line) && !archiveShape.test(line)) {
      throw new Error(`build-release.sh git archive line differs from the modelled shape: ${line.trim()}`);
    }
  }

  // 2. The pathspec: its literal tokens, and the per-package additions inside the `for pkg in …` loop.
  const spec = [...text.matchAll(/^PATHSPEC=\(([^)]*)\)/gm)];
  if (spec.length !== 1) throw new Error(`build-release.sh has ${spec.length} PATHSPEC=( lines, the derivation models exactly one`);
  for (const tok of spec[0]![1]!.split(/\s+/).filter(Boolean)) {
    if (!/^[A-Za-z0-9._/-]+$/.test(tok)) throw new Error(`build-release.sh PATHSPEC token ${JSON.stringify(tok)} is not a plain path`);
    inputs.add(tok);
  }
  let matched = 0;
  for (const loop of text.matchAll(/for pkg in ([a-z ]+); do\n([\s\S]*?)\n\s*done/g)) {
    const pkgs = loop[1]!.trim().split(/\s+/);
    for (const add of loop[2]!.matchAll(/PATHSPEC\+=\("\$pkg\/([^"]+)"\)/g)) {
      matched += 1;
      for (const pkg of pkgs) inputs.add(`${pkg}/${add[1]!}`);
    }
  }
  const adds = (text.match(/PATHSPEC\+=/g) ?? []).length;
  if (adds !== matched) throw new Error(`build-release.sh has ${adds} PATHSPEC+= occurrences, the loop parse matched ${matched}`);

  // 3. The packages npm installs (and builds), and what each one reads.
  const installs = [...text.matchAll(/^\( cd "\$ROOT\/([a-z]+)"\s*&& npm ci\b([^\n]*)$/gm)];
  const cds = (text.match(/\( cd "\$ROOT\//g) ?? []).length;
  if (cds !== installs.length) throw new Error(`build-release.sh has ${cds} ( cd "$ROOT/ lines, the npm ci parse matched ${installs.length}`);
  const installed = new Set(installs.map((m) => m[1]!));
  for (const { pkg, rest, line } of distReads) {
    if (!installed.has(pkg)) throw new Error(`build-release.sh reads ${pkg}/${rest}, but ${pkg} is not an installed package: ${line}`);
    if (rest.split('/').includes('..')) throw new Error(`build-release.sh reads a dist path with a .. segment: ${line}`);
    if (/[$`]/.test(rest)) throw new Error(`build-release.sh reads a dist path with an expansion, which the derivation does not model: ${line}`);
  }
  for (const m of installs) {
    const pkg = m[1]!;
    const model = SCRIPT_MODEL[pkg];
    if (model === undefined) throw new Error(`npm ci in ${pkg}: no script model for this package`);
    const runsBuild = /&& npm run build\b/.test(m[2]!);
    if (runsBuild !== model.runsBuild) throw new Error(`npm run build in ${pkg}: the line differs from the script model`);
    for (const f of ['package.json', 'package-lock.json', 'tsconfig.json']) inputs.add(`${pkg}/${f}`);

    const pkgText = read(`${pkg}/package.json`);
    if (pkgText === null) throw new Error(`${pkg}/package.json is unreadable`);
    const pj = JSON.parse(pkgText) as Record<string, unknown>;
    const scripts = (pj['scripts'] ?? {}) as Record<string, string>;
    const keys = runsBuild ? [...LIFECYCLE, ...BUILD_HOOKS] : LIFECYCLE;
    const actual: Record<string, string> = {};
    for (const k of keys) if (scripts[k] !== undefined) actual[k] = scripts[k];
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(model.scripts).sort())) {
      throw new Error(`${pkg}/package.json scripts npm runs differ from the script model: ${JSON.stringify(actual)}`);
    }
    for (const v of Object.values(actual)) {
      const node = /^node (\S+)\s*$/.exec(v);
      if (node !== null) inputs.add(resolveIn(pkg, node[1]!, `${pkg} script`));
    }
    for (const field of DEP_FIELDS) {
      for (const [name, spec2] of Object.entries((pj[field] ?? {}) as Record<string, string>)) {
        if (!/^(?:file|link):/.test(spec2)) continue;
        const dir = resolveIn(pkg, spec2.replace(/^(?:file|link):/, ''), `${pkg} dependency ${name}`);
        if (!installed.has(dir)) throw new Error(`${pkg}/package.json ${field} ${name} is ${spec2}, outside the installed packages`);
        fileDeps.set(name, dir);
      }
    }

    // The tsconfig tsc reads, and the paths it names.
    const tsText = read(`${pkg}/tsconfig.json`);
    if (tsText === null) throw new Error(`${pkg}/tsconfig.json is unreadable`);
    const ts = JSON.parse(stripTs(tsText)) as { compilerOptions?: Record<string, unknown>; include?: string[] } & Record<string, unknown>;
    for (const k of ['extends', 'files', 'references']) {
      if (ts[k] !== undefined) throw new Error(`${pkg}/tsconfig.json has ${k}, which the derivation does not model`);
    }
    for (const entry of ts.include ?? ['.']) inputs.add(resolveIn(pkg, entry, `${pkg}/tsconfig.json include`));
    const co = ts.compilerOptions ?? {};
    const baseDir = typeof co['baseUrl'] === 'string' ? resolveIn(pkg, co['baseUrl'], `${pkg}/tsconfig.json baseUrl`) || '.' : pkg;
    for (const targets of Object.values((co['paths'] ?? {}) as Record<string, string[]>)) {
      for (const t of targets) inputs.add(resolveIn(baseDir, t, `${pkg}/tsconfig.json paths`));
    }
    for (const k of ['rootDirs', 'typeRoots']) {
      for (const entry of (co[k] ?? []) as string[]) inputs.add(resolveIn(pkg, entry, `${pkg}/tsconfig.json ${k}`));
    }

    // The vite config, when the package has one.
    const vite = read(`${pkg}/vite.config.ts`);
    if (vite !== null) {
      const bare = stripTs(vite);
      const bad = /\b(publicDir|root|envDir|input)\s*:/.exec(bare);
      if (bad !== null) throw new Error(`${pkg}/vite.config.ts sets ${bad[1]!}, which the derivation does not model`);
      for (const f of ['vite.config.ts', 'index.html', 'public']) inputs.add(`${pkg}/${f}`);
      for (const u of bare.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
        inputs.add(resolveIn(pkg, u[2]!, `${pkg}/vite.config.ts new URL`));
      }
    }
  }
  // One spelling per input: `./docs` is `docs`, and `.` is the repository root, written ''.
  const norm = (i: string): string => {
    const n = path.posix.normalize(i).replace(/^\.\//, '').replace(/\/+$/, '');
    return n === '.' ? '' : n;
  };
  return { inputs: [...new Set([...inputs].map(norm))].sort(), fileDeps, alias: deriveAlias(read) };
}

/** `input` is a path or '' for the repository root, which every file is under. */
const under = (file: string, input: string): boolean => input === '' || file === input || file.startsWith(`${input}/`);

/** The NOT_SHIPPED trees that a path reads whole: every tree when the path is the repository root, and a tree below it otherwise. */
function treesBelow(p: string): string[] {
  const root = p === '' || p === '.';
  const out: string[] = [];
  for (const r of NOT_SHIPPED) if ('tree' in r && (root || r.tree.startsWith(`${p}/`))) out.push(r.tree);
  return out;
}

/** True when a build reading `p` reaches NOT_SHIPPED: the path is claimed, or it is the root or an ancestor of a tree rule (the root covers the root-file rules). */
const reachesNotShipped = (p: string): boolean => notShipped(p) || p === '' || p === '.' || treesBelow(p).length > 0;

/** Every tracked file at or under a derived input that notShipped claims, plus every input notShipped claims. */
function shippedViolations(inputs: string[], files: string[]): string[] {
  const out = new Set<string>();
  for (const input of inputs) {
    if (notShipped(input)) out.add(input);
    // An input that is the root or an ancestor of a tree rule reads the whole of that tree.
    for (const tree of treesBelow(input)) out.add(`${input || '.'} contains ${tree}`);
    for (const f of files) if (under(f, input) && notShipped(f)) out.add(f);
  }
  return [...out].sort();
}

/** `<link> -> <resolved>` for every tracked symlink at or under an input whose target resolves to a notShipped path. */
function linkEscapes(inputs: string[], links: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [link, target] of links) {
    if (!inputs.some((i) => under(link, i))) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(link), target)).replace(/\/+$/, '');
    if (reachesNotShipped(resolved)) out.push(`${link} -> ${resolved}`);
  }
  return out.sort();
}

const JS_EXT = /\.(?:[cm]?[jt]s|tsx)$/;

/** `src` without its CSS block comments, string-aware (a quoted glob can hold the two characters that open or close one). An unterminated comment drops the rest. */
function dropCssComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (j < src.length && src[j] === c) { out += src.slice(i, j + 1); i = j + 1; continue; }
      out += c; i += 1; continue; // no closing quote on this line: a bare quote character
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close < 0) return out;
      i = close + 2;
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** `src` without its `<!-- -->` comments, found by indexOf: an unterminated comment drops the rest. */
function dropHtmlComments(src: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = src.indexOf('<!--', at);
    if (open < 0) return out + src.slice(at);
    out += src.slice(at, open);
    const close = src.indexOf('-->', open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

const strings = (src: string): string[] => [...src.matchAll(/(['"])([^'"\n]+)\1/g)].map((m) => m[2]!);

/** The path-like values a source file names, by kind. HTML resolves a leading slash from the package dir and its public/. */
function specifiers(file: string, src: string): string[] {
  const out: string[] = [];
  if (JS_EXT.test(file)) {
    const bare = stripTs(src);
    for (const re of [
      /\bfrom\s*(['"])([^'"\n]+)\1/g, /\bimport\s*(['"])([^'"\n]+)\1/g, /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
      /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g, /\bnew URL\(\s*(['"])([^'"\n]+)\1/g,
    ]) for (const m of bare.matchAll(re)) out.push(m[2]!);
    for (const m of bare.matchAll(/\bimport\.meta\.glob\(([^)]*)\)/g)) out.push(...strings(m[1]!));
    for (const m of src.matchAll(/^\s*\/\/\/\s*<reference\s+path=(['"])([^'"\n]+)\1/gm)) out.push(m[2]!);
  } else if (file.endsWith('.css')) {
    const bare = dropCssComments(src);
    // Forms that name a path by a route the extractors below do not follow: refused, not skipped.
    for (const [re, form] of [[/\bsource\(/i, 'source('], [/@plugin\b/i, '@plugin'], [/@config\b/i, '@config'], [/@reference\b/i, '@reference']] as const) {
      if (re.test(bare)) throw new Error(`${file} uses ${form}, which the derivation does not model`);
    }
    for (const re of [
      /@import\s*(['"])([^'"\n]+)\1/gi, /@source\s*(?:not\s*)?(['"])([^'"\n]+)\1/gi, /\burl\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,
    ]) for (const m of bare.matchAll(re)) out.push(m[2]!);
  } else if (file.endsWith('.html')) {
    const bare = dropHtmlComments(src);
    for (const m of bare.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]*)\1/g)) out.push(m[2]!);
  }
  return out;
}

/** `<file> -> <resolved>` for every path in an input source file that resolves to a notShipped path. */
function importEscapes(d: Derived, files: string[], read: Read): string[] {
  const out = new Set<string>();
  for (const file of files) {
    if (!d.inputs.some((i) => under(file, i))) continue;
    if (!JS_EXT.test(file) && !/\.(?:css|html)$/.test(file)) continue;
    const src = read(file);
    if (src === null) continue;
    const pkg = file.split('/')[0]!;
    for (const raw of specifiers(file, src)) {
      const value = raw.split('?')[0]!;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue; // http:, https:, data:, mailto:, protocol-relative, fragment
      const candidates: string[] = [];
      const dep = [...d.fileDeps].find(([name]) => value.startsWith(`${name}/`));
      // Relative: `./`, `../`, an exact `.` or `..` in JS, and every CSS path (Tailwind's resolver prefers a relative one).
      const relative = value.startsWith('./') || value.startsWith('../') || (JS_EXT.test(file) && (value === '.' || value === '..')) || file.endsWith('.css');
      if (relative) candidates.push(path.posix.join(path.posix.dirname(file), value));
      if (value.startsWith('@/')) candidates.push(path.posix.join(d.alias, value.slice(2)));
      if (dep !== undefined) candidates.push(path.posix.join(dep[1], value.slice(dep[0].length + 1)));
      if (file.endsWith('.html') && !relative && dep === undefined) {
        if (value.startsWith('/')) candidates.push(path.posix.join(pkg, value), path.posix.join(pkg, 'public', value));
        else if (value !== '') candidates.push(path.posix.join(path.posix.dirname(file), value));
      }
      for (const c of candidates) {
        const resolved = path.posix.normalize(cutGlob(c) || '.').replace(/\/+$/, '');
        if (reachesNotShipped(resolved)) out.add(`${file} -> ${resolved}`);
      }
    }
  }
  return [...out].sort();
}

// Each G5 row scans every tracked source file under a build input; a loaded box needs more than vitest's 20 s.
describe('W25 the guard: no build input is on the NOT_SHIPPED list', { timeout: 180_000 }, () => {
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0').filter(Boolean);
  const links = new Map<string, string>();
  for (const line of execFileSync('git', ['-C', REPO, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0')) {
    const m = /^120000 \S+ 0\t(.+)$/.exec(line);
    if (m !== null) links.set(m[1]!, readlinkSync(join(REPO, m[1]!)));
  }
  const derived = deriveReleaseInputs(real);
  /** A reader that serves `fn(real text)` for `rel` and the real text for everything else. */
  const mutated = (rel: string, fn: (text: string) => string): Read => (r) => {
    const text = real(r);
    if (r !== rel || text === null) return text;
    const out = fn(text);
    expect(out, `the mutation of ${rel} changed nothing`).not.toBe(text);
    return out;
  };
  const withJson = (fn: (o: Record<string, any>) => void) => (t: string): string => {
    const o = JSON.parse(t) as Record<string, any>;
    fn(o);
    return JSON.stringify(o, null, 2);
  };
  const BUILDER = 'deploy/build-release.sh';

  it('W25-G1: the derivation is not vacuous', () => {
    for (const want of ['install.sh', 'shared', 'ccd', 'deploy', 'server/package.json', 'server/scripts',
      'server/scripts/fix-node-pty-helper.mjs', 'server/src', 'agent/src', 'pwa/src', 'pwa/test', 'pwa/index.html',
      'pwa/public', 'ui/src', 'ui/package.json']) {
      expect(derived.inputs, want).toContain(want);
    }
    expect(Object.fromEntries(derived.fileDeps)).toEqual({ '@ccrc/ui': 'ui', 'ccrc-agent': 'agent' });
  });

  it('W25-G2: no tracked file at or under a build input is on the NOT_SHIPPED list', () => {
    expect(shippedViolations(derived.inputs, files)).toEqual([]);
  });

  it.each([
    ['PATHSPEC gains docs', BUILDER, (t: string) => t.replace('PATHSPEC=(install.sh shared ccd deploy', 'PATHSPEC=(install.sh shared ccd deploy docs')],
    ['PATHSPEC gains server', BUILDER, (t: string) => t.replace('PATHSPEC=(install.sh shared ccd deploy', 'PATHSPEC=(install.sh shared ccd deploy server')],
    ['PATHSPEC gains README.md', BUILDER, (t: string) => t.replace('PATHSPEC=(install.sh shared ccd deploy', 'PATHSPEC=(install.sh shared ccd deploy README.md')],
    ['PATHSPEC gains the root as .', BUILDER, (t: string) => t.replace('PATHSPEC=(install.sh shared ccd deploy', 'PATHSPEC=(install.sh shared ccd deploy .')],
    ['PATHSPEC gains ./docs', BUILDER, (t: string) => t.replace('PATHSPEC=(install.sh shared ccd deploy', 'PATHSPEC=(install.sh shared ccd deploy ./docs')],
    ['server tsconfig include gains test', 'server/tsconfig.json', (t: string) => t.replace('"src/**/*.ts",', '"src/**/*.ts", "test/**/*.ts",')],
    ['pwa tsconfig paths reach docs', 'pwa/tsconfig.json', (t: string) => t.replace('"compilerOptions": {', '"compilerOptions": { "paths": { "#d/*": ["../docs/*"] },')],
    ['pwa tsconfig typeRoots reach server/test', 'pwa/tsconfig.json', (t: string) => t.replace('"compilerOptions": {', '"compilerOptions": { "typeRoots": ["../server/test"],')],
    ['pwa vite config names docs by URL', 'pwa/vite.config.ts', (t: string) => `${t}\nexport const w25 = new URL('../docs', import.meta.url);\n`],
  ])('W25-G3: %s and the guard reports it', (_name, rel, fn) => {
    expect(shippedViolations(deriveReleaseInputs(mutated(rel, fn)).inputs, files).length).toBeGreaterThan(0);
  });

  it.each([
    ['a PATHSPEC+= line outside the loop', BUILDER, (t: string) => `${t}\nPATHSPEC+=(extra)\n`, /PATHSPEC\+=/],
    ['a second npm run build line', BUILDER, (t: string) => `${t}\n( cd "$ROOT/x" && npm run build )\n`, /\$ROOT/],
    ['a cp of a root file', BUILDER, (t: string) => `${t}\ncp -a "$ROOT/LICENSE" "$TOP/LICENSE"\n`, /"\$ROOT" in a shape/],
    ['a second git archive', BUILDER, (t: string) => `${t}\ngit -C "$ROOT" archive --format=tar HEAD -- docs | tar -x -C "$TOP"\n`, /git archive/],
    ['the exact modelled git archive line twice', BUILDER, (t: string) => `${t}\n` + 'git -C "$ROOT" archive --format=tar HEAD -- "${PATHSPEC[@]}" | tar -x -C "$TOP"\n', /2 git archive lines/],
    ['git archive with an extra pathspec', BUILDER, (t: string) => t.replace('"${PATHSPEC[@]}" | tar', '"${PATHSPEC[@]}" docs | tar'), /git archive line differs/],
    ['an indented ( cd "$ROOT/ line the install parse never sees', BUILDER, (t: string) => `${t}\n  ( cd "$ROOT/docs" && npm ci --no-audit )\n`, /\( cd "\$ROOT\/ lines/],
    ['pwa postbuild reading docs', 'pwa/package.json', withJson((o) => { o['scripts']['postbuild'] = 'node scripts/embed-changelog.mjs ../docs/changelog.md'; }), /pwa\/package.json scripts/],
    ['pwa build with another tsconfig', 'pwa/package.json', withJson((o) => { o['scripts']['build'] = 'tsc --noEmit -p tsconfig.app.json && vite build'; }), /pwa\/package.json scripts/],
    ['ui prepare script', 'ui/package.json', withJson((o) => { o['scripts']['prepare'] = 'node x.mjs'; }), /ui\/package.json scripts/],
    ['a file: dependency on docs', 'server/package.json', withJson((o) => { o['devDependencies']['x'] = 'file:../docs'; }), /outside the installed packages/],
    ['a tsconfig extends', 'server/tsconfig.json', (t: string) => t.replace('"compilerOptions": {', '"extends": "./base.json", "compilerOptions": {'), /extends/],
    ['a cp from dist that climbs out to docs', BUILDER, (t: string) => `${t}\ncp -a "$ROOT/server/dist/../../docs" "$TOP/docs"\n`, /\.\. segment/],
    ['a cp from dist that climbs out to server/test', BUILDER, (t: string) => `${t}\ncp -a "$ROOT/server/dist/../test" "$TOP/t"\n`, /\.\. segment/],
    ['a cp from a dist of a package that is not installed', BUILDER, (t: string) => `${t}\ncp -a "$ROOT/docs/dist" "$TOP/x"\n`, /not an installed package/],
    ['a test of a dist path with an expansion', BUILDER, (t: string) => `${t}\n[ -d "$ROOT/server/dist$SUB" ]\n`, /expansion/],
    ['an @ alias that pwa and ui disagree on', 'pwa/vite.config.ts', (t: string) => t.replace("'../ui/src'", "'../docs'"), /alias differs/],
    ['an @ alias ui/tsconfig.json no longer names', 'ui/tsconfig.json', (t: string) => t.replace('"@/*"', '"#/*"'), /cannot be derived/],
    ['an @ alias pwa/vite.config.ts no longer names', 'pwa/vite.config.ts', (t: string) => t.replace("'@': fileURLToPath", "'~': fileURLToPath"), /'@' alias keys/],
    ['a vite publicDir', 'pwa/vite.config.ts', (t: string) => `${t}\nexport const w25 = { publicDir: '../docs', };\n`, /publicDir/],
  ])('W25-G4: %s throws instead of passing unread', (_name, rel, fn, shape) => {
    expect(() => deriveReleaseInputs(mutated(rel, fn))).toThrow(shape);
  });

  describe('W25-G5: no path a build input names resolves into NOT_SHIPPED', () => {
    /** The real files plus planted ones, served by a reader that knows them. */
    const planted = (add: Record<string, string>, over: Record<string, (t: string) => string> = {}) => {
      const read: Read = (r) => {
        if (add[r] !== undefined) return add[r]!;
        const text = real(r);
        return text !== null && over[r] !== undefined ? over[r]!(text) : text;
      };
      return importEscapes(derived, [...files, ...Object.keys(add)], read);
    };

    it('the checkout has none', () => {
      expect(importEscapes(derived, files, real)).toEqual([]);
    });

    it.each([
      ['a relative import of a server test helper', { 'server/src/w25.ts': "import { h } from '../test/helpers.js';\n" }, 'server/test/helpers.js'],
      ['a raw import of a docs file', { 'pwa/src/w25.ts': "import md from '../../docs/a.md?raw';\n" }, 'docs/a.md'],
      ['a triple-slash reference', { 'server/src/w25.ts': '/// <reference path="../test/x.d.ts" />\n' }, 'server/test/x.d.ts'],
      ['a file: dependency subpath', { 'server/src/w25.ts': "import 'ccrc-agent/test/x.js';\n" }, 'agent/test/x.js'],
      ['a css @source', { 'pwa/src/styles/w25.css': "@source '../../../docs/**/*.md';\n" }, 'docs'],
      ['a css @import', { 'pwa/src/styles/w25.css': "@import '../../../docs/a.css';\n" }, 'docs/a.css'],
      ['a css @source of the repository root', { 'pwa/src/styles/w25.css': "@source '../../../';\n" }, '.'],
      ['an @/ import that climbs out of the alias to a docs file', { 'pwa/src/w25.ts': "import md from '@/../../docs/a.md?raw';\n" }, 'docs/a.md'],
      ['a css @source of a bare .. (an ancestor of server/test)', { 'server/src/w25.css': "@source '..';\n" }, 'server'],
      ['a css @import of a bare relative path into docs', { 'pwa/src/styles/w25.css': "@import '../../../docs/a.css';\n@import 'tailwindcss';\n" }, 'docs/a.css'],
      ['a css url( of a bare relative path into docs', { 'pwa/src/styles/w25.css': ".a { background: url(../../../docs/a.png); }\n" }, 'docs/a.png'],
      ['an upper-case css @IMPORT', { 'pwa/src/styles/w25.css': "@IMPORT '../../../docs/a.css';\n" }, 'docs/a.css'],
      ['a mixed-case css @Source', { 'pwa/src/styles/w25.css': "@Source '../../../docs';\n" }, 'docs'],
      ['a css @source with no space before the string', { 'pwa/src/styles/w25.css': '@source"../../../docs";\n' }, 'docs'],
      ['a mixed-case css URL(', { 'pwa/src/styles/w25.css': ".a { background: URL(../../../docs/a.png); }\n" }, 'docs/a.png'],
      ['a css @import with no space before the string', { 'pwa/src/styles/w25.css': '@import"../../../docs/a.css";\n' }, 'docs/a.css'],
      ['a css @import through the @ alias', { 'pwa/src/styles/w25.css': "@import '@/../../docs/a.css';\n" }, 'docs/a.css'],
      ['a JS import of an exact ..', { 'deploy/w25.ts': "import x from '..';\n" }, '.'],
      ['an import.meta.glob of an ancestor of a tree rule', { 'pwa/src/w25.ts': "const m = import.meta.glob('../../server/**/*.ts');\n" }, 'server'],
    ])('%s is reported', (_name, add, resolved) => {
      const got = planted(add);
      expect(got.length).toBeGreaterThan(0);
      expect(got.join('\n')).toContain(`-> ${resolved}`);
    });

    it.each([
      ['source(', "@import 'tailwindcss/utilities.css' layer(utilities) source('../../../');\n"],
      ['@plugin', '@plugin "../../../docs/p.js";\n'],
      ['@config', '@config "../../../docs/c.js";\n'],
      ['@reference', '@reference "../../../docs/r.css";\n'],
    ])('a css %s throws instead of passing unread', (form, css) => {
      expect(() => planted({ 'pwa/src/styles/w25.css': css })).toThrow(new RegExp(form.replace(/[()@]/g, '\\$&')));
    });

    it('a path in a comment is not reported, and a quoted glob is not a comment', () => {
      expect(planted({ 'pwa/src/styles/w25.css': "/* @import '../../../docs/a.css'; @plugin 'x'; */\n.a { color: red; }\n" })).toEqual([]);
      expect(planted({ 'pwa/src/styles/w25.css': "@source '../../../docs/**/*.md';\n/* later */\n" }).join()).toContain('-> docs');
      expect(planted({ 'pwa/src/styles/w25.css': ".a { content: 'it\\'s'; }\n/* unterminated @import '../../../docs/a.css';\n" })).toEqual([]);
      const html = (body: string) => planted({}, { 'pwa/index.html': (t) => t.replace('</head>', `${body}</head>`) });
      expect(html('<!-- <link rel="stylesheet" href="../docs/a.css"> -->')).toEqual([]);
      expect(html('<!-- x --><link rel="stylesheet" href="../docs/a.css"><!-- y -->')).toEqual(['pwa/index.html -> docs/a.css']);
      expect(html('<!-- unterminated <link rel="stylesheet" href="../docs/a.css">')).toEqual([]);
      expect(html('<<!-- x -->!-- <link rel="stylesheet" href="../docs/a.css"> -->')).toEqual(['pwa/index.html -> docs/a.css']);
    });

    it('an html href is reported', () => {
      const got = planted({}, { 'pwa/index.html': (t) => t.replace('</head>', '<link rel="stylesheet" href="../docs/a.css"></head>') });
      expect(got).toEqual(['pwa/index.html -> docs/a.css']);
    });

    it('a pwa/src/docs import is not reported, because that tree ships', () => {
      expect(planted({ 'pwa/src/screens/w25.ts': "import { DocsLeaf } from '../docs/DocsLeaf';\n" })).toEqual([]);
    });
  });

  it('W25-G6: no tracked symlink at or under a build input points into NOT_SHIPPED', () => {
    expect(linkEscapes(derived.inputs, links)).toEqual([]);
    const planted = new Map(links).set('pwa/src/w25', '../../docs/a.md');
    expect(linkEscapes(derived.inputs, planted)).toEqual(['pwa/src/w25 -> docs/a.md']);
    const toRoot = new Map(links).set('pwa/src/w25', '../..');
    expect(linkEscapes(derived.inputs, toRoot).length).toBeGreaterThan(0);
  });
});

describe('README names exactly NOT_SHIPPED (W25-d, D-6399)', () => {
  it('W25-S13: the parenthesis after "on its `NOT_SHIPPED` list (" lists the same six rules as NOT_SHIPPED', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8').replace(/\s+/g, ' ');
    const anchor = 'on its `NOT_SHIPPED` list (';
    const at = readme.indexOf(anchor);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(readme.indexOf(anchor, at + 1)).toBe(-1);
    const rest = readme.slice(at + anchor.length);
    const tokens = [...rest.slice(0, rest.indexOf(')')).matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
    const want = NOT_SHIPPED.map((r) => ('tree' in r ? `${r.tree}/` : 'rootExt' in r ? `*${r.rootExt}` : r.rootName)).sort();
    expect(tokens).toEqual(want);
  });
});
