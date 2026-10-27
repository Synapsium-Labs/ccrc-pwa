// The fixture for ccd-land-probe's two test files (landing-order wave 3b): a fixture origin the project's `origin`
// URL is rewritten to (an `insteadOf` line in the fixture HOME's ~/.gitconfig, the `makeGhRepo` pattern), a
// project main checkout under $HOME/projects, registry rows, a conf, the two pause markers, a functional stub
// for the forge CLI (handed over through CCD_LAND_PROBE_GH, never a PATH lookup), a git wrapper for the slow and
// signalled cases, and the spawn of the probe under the contained env.
//
// Every repository here is BUILT with GIT_CONFIG_GLOBAL=/dev/null so the fixture HOME's own ~/.gitconfig (the
// insteadOf line, and the hooks path of the not-written case) cannot reach a fixture build. The probe itself runs
// with the HOME gitconfig in force, which is how its fetch URL is rewritten to the local bare repository.
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ghContainedEnv, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

export const PROBE = path.resolve(__dirname, '../../ccd/ccd-land-probe');

export interface PrRow { number: number; headRefName: string; headRefOid: string; isCrossRepository: boolean }
export interface RunResult { status: number | null; stdout: string; stderr: string }
export interface StubAnswers { prList?: PrRow[] | 'fail'; sleepS?: number }
export interface LandOpts { project?: string; slug?: string; originUrl?: string }

/** A pid that is gone, or a zombie awaiting its reaper (kill 0 answers for a zombie). */
export function pidGone(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return /\) Z /.test(stat);
  } catch { return true; }
}

/** Wait until `fn` holds, or the budget (ms) is spent; the last answer. */
export async function until(fn: () => boolean, ms = 10_000, stepMs = 50): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

function realGit(): string {
  for (const d of (process.env['PATH'] ?? '').split(':')) {
    const p = path.join(d, 'git');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  throw new Error('no git on PATH');
}

const STUB = `#!/usr/bin/env python3
import json, os, sys, time
here = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
with open(os.path.join(os.environ['HOME'], 'gh-stub-calls'), 'a') as f:
    f.write(' '.join(args) + '\\n')
with open(os.path.join(here, 'gh-answers.json')) as f:
    a = json.load(f)
if a.get('sleepS'):
    time.sleep(a['sleepS'])
if args[:2] == ['pr', 'list']:
    repo = args[args.index('--repo') + 1] if '--repo' in args else ''
    rows = a.get('repos', {}).get(repo)
    if rows is None:
        sys.stderr.write('stub: pr list failed\\n')
        sys.exit(1)
    print(json.dumps(rows))
    sys.exit(0)
sys.stderr.write('stub: no answer\\n')
sys.exit(2)
`;

export function makeLandFixture(h: CcdHarness, opts: LandOpts = {}) {
  const home = h.home;
  const project = opts.project ?? 'proj-a';
  const slug = opts.slug ?? 'o/r';
  const land = path.join(home, 'land');
  const origin = path.join(land, 'origins', `${project}.git`);
  const work = path.join(land, 'work', project);
  const repo = path.join(home, 'projects', project);
  const reg = path.join(home, '.cc-sessions');
  const tmp = path.join(home, 'tmp');
  const stubDir = path.join(land, 'stub');
  const stubPath = path.join(stubDir, 'gh');
  const wrapDir = path.join(land, 'wrap');
  const heads: Array<{ n: number; branch: string; sha: string }> = [];
  let explicit: StubAnswers | undefined;
  let explicitSleep = 0;

  const gitEnv = (): NodeJS.ProcessEnv => ({
    ...inheritedEnv(), HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
    GIT_TERMINAL_PROMPT: '0',
  });
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() }).trim();
  const gitconfig = path.join(home, '.gitconfig');
  const insteadOf = (from: string): void => {
    fs.appendFileSync(gitconfig, `[url "file://${origin}"]\n\tinsteadOf = ${from}\n`);
  };

  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(stubDir, { recursive: true });
  fs.mkdirSync(path.dirname(origin), { recursive: true });
  fs.mkdirSync(path.dirname(work), { recursive: true });
  fs.mkdirSync(path.dirname(repo), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: gitEnv() });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: gitEnv() });
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', opts.originUrl ?? `https://github.com/${slug}.git`);
  git(repo, 'push', '-q', origin, 'main');
  execFileSync('git', ['clone', '-q', origin, work], { env: gitEnv() });
  insteadOf(opts.originUrl ?? `https://github.com/${slug}.git`);
  fs.writeFileSync(stubPath, STUB, { mode: 0o755 });
  fs.chmodSync(stubPath, 0o755);

  const answersFile = path.join(stubDir, 'gh-answers.json');
  const readAnswers = (): { repos: Record<string, PrRow[] | null>; sleepS?: number } =>
    fs.existsSync(answersFile) ? JSON.parse(fs.readFileSync(answersFile, 'utf8')) : { repos: {} };
  /** Write this fixture's rows into the shared stub: the explicit answer, else every head added so far. */
  const writeStub = (): void => {
    const a = readAnswers();
    const want = explicit?.prList;
    a.repos[slug] = want === 'fail' ? null
      : want ?? heads.map((x) => ({ number: x.n, headRefName: x.branch, headRefOid: x.sha, isCrossRepository: false }));
    a.sleepS = explicitSleep;
    fs.writeFileSync(answersFile, JSON.stringify(a));
  };
  writeStub();

  const writeFiles = (dir: string, files: Record<string, string>): void => {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
  };

  const pathEnv = (): string => (fs.existsSync(path.join(wrapDir, 'git')) ? `${wrapDir}:` : '') + (process.env['PATH'] ?? '');

  const fx = {
    project, slug, origin, repo, reg, tmp, home, stubPath,
    landDir: path.join(reg, 'landing', project),
    confPath: (p = project): string => path.join(home, '.ccrc', 'landing', `${p}.conf`),
    ghCalls: (): string[] => {
      const p = path.join(home, 'gh-stub-calls');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
    },
    /** A PR head on the fixture origin: a branch off origin's main as it stands, and refs/pull/<n>/head. */
    addHead(n: number, files: Record<string, string>, o: { branch?: string } = {}): string {
      const branch = o.branch ?? `feature/pr-${n}`;
      git(work, 'fetch', '-q', 'origin');
      git(work, 'checkout', '-q', '-B', branch, 'origin/main');
      writeFiles(work, files);
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', `pr ${n}`);
      git(work, 'push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`, `HEAD:refs/pull/${n}/head`);
      const sha = git(work, 'rev-parse', 'HEAD');
      heads.push({ n, branch, sha });
      writeStub();
      return sha;
    },
    /** A new commit on origin's main (the project checkout stays behind, as on a fleet box between pulls). */
    advanceMain(files: Record<string, string>): string {
      git(work, 'fetch', '-q', 'origin');
      git(work, 'checkout', '-q', '-B', 'main', 'origin/main');
      writeFiles(work, files);
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'main moves');
      git(work, 'push', '-q', 'origin', 'main');
      return git(work, 'rev-parse', 'HEAD');
    },
    originMain: (): string => git(origin, 'rev-parse', 'main'),
    /** A registry row of this project; a ws/ branch also gets its local branch in the project checkout. */
    addRow(id: string, branch: string, o: { local?: boolean } = {}): void {
      fs.mkdirSync(reg, { recursive: true });
      fs.writeFileSync(path.join(reg, `${id}.project`), `${project}\n`);
      fs.writeFileSync(path.join(reg, `${id}.branch`), `${branch}\n`);
      if (o.local ?? branch.startsWith('ws/')) git(repo, 'branch', '-f', branch, 'main');
    },
    conf(p: string, text: string): void {
      fs.mkdirSync(path.join(home, '.ccrc', 'landing'), { recursive: true });
      fs.writeFileSync(path.join(home, '.ccrc', 'landing', `${p}.conf`), text);
    },
    pause(scope: 'global' | 'project'): void {
      if (scope === 'global') { fs.mkdirSync(reg, { recursive: true }); fs.writeFileSync(path.join(reg, 'land-probe-paused'), ''); return; }
      fs.mkdirSync(path.join(reg, 'landing', project), { recursive: true });
      fs.writeFileSync(path.join(reg, 'landing', project, 'paused'), '');
    },
    /** Point the project's origin at another URL, and the fixture origin behind it. */
    setOrigin(url: string): void {
      git(repo, 'config', 'remote.origin.url', url);
      insteadOf(url);
    },
    /** What the stub answers to `pr list` for this project: rows, 'fail', or (omitted) every head added. */
    stubGh(answers: StubAnswers = {}): void {
      explicit = answers;
      explicitSleep = answers.sleepS ?? 0;
      writeStub();
    },
    /** A `git` first on the probe's PATH: `body` runs first (it may exec, or exit), then the real git. */
    wrapGit(body: string): void {
      fs.mkdirSync(wrapDir, { recursive: true });
      fs.writeFileSync(path.join(wrapDir, 'git'), `#!/bin/bash\nREAL='${realGit()}'\n${body}\nexec "$REAL" "$@"\n`, { mode: 0o755 });
      fs.chmodSync(path.join(wrapDir, 'git'), 0o755);
    },
    /** The hook directory of the not-written case: ~/.gitconfig gains core.hooksPath (keeping its insteadOf line),
     *  and both hooks write the canary. Nothing has run yet: the canary does not exist. */
    armHooks(): string {
      const hooks = path.join(land, 'hooks');
      const canary = path.join(land, 'canary');
      fs.mkdirSync(hooks, { recursive: true });
      for (const n of ['reference-transaction', 'post-checkout']) {
        fs.writeFileSync(path.join(hooks, n), `#!/bin/sh\necho ${n} >> '${canary}'\n`, { mode: 0o755 });
        fs.chmodSync(path.join(hooks, n), 0o755);
      }
      fs.appendFileSync(gitconfig, `[core]\n\thooksPath = ${hooks}\n`);
      if (fs.existsSync(canary)) throw new Error('canary exists before any probe ran');
      return canary;
    },
    /** The project checkout's four read-only measurements. */
    snapshot(): Record<string, string> {
      return {
        refs: git(repo, 'for-each-ref'),
        objects: git(repo, 'count-objects', '-v'),
        config: git(repo, 'config', '--list'),
        hooks: fs.readdirSync(path.join(repo, '.git', 'hooks')).sort().join('\n'),
      };
    },
    gitIn: (cwd: string, ...args: string[]): string => git(cwd, ...args),
    readJson(name: string): any {
      return JSON.parse(fs.readFileSync(path.join(reg, 'landing', project, name), 'utf8'));
    },
    exists: (name: string): boolean => fs.existsSync(path.join(reg, 'landing', project, name)),
    run(extra: NodeJS.ProcessEnv = {}, args: string[] = []): RunResult {
      writeStub();
      const r = spawnSync('bash', [PROBE, ...args], {
        encoding: 'utf8', cwd: home, timeout: 150_000,
        env: ghContainedEnv(home, { ...inheritedEnv(), HOME: home, TMPDIR: tmp, CCD_LAND_PROBE_GH: stubPath, PATH: pathEnv(), ...extra },
          { systemd: true, tmux: true, net: true }),
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    /** The same spawn, asynchronous: for a case that signals the probe while it runs. */
    start(extra: NodeJS.ProcessEnv = {}): { child: ChildProcess; done: Promise<RunResult> } {
      writeStub();
      const child = spawn('bash', [PROBE], {
        cwd: home,
        env: ghContainedEnv(home, { ...inheritedEnv(), HOME: home, TMPDIR: tmp, CCD_LAND_PROBE_GH: stubPath, PATH: pathEnv(), ...extra },
          { systemd: true, tmux: true, net: true }),
      });
      let stdout = ''; let stderr = '';
      child.stdout?.on('data', (d) => { stdout += String(d); });
      child.stderr?.on('data', (d) => { stderr += String(d); });
      const done = new Promise<RunResult>((resolve) => { child.on('close', (status) => resolve({ status, stdout, stderr })); });
      return { child, done };
    },
    /** The validate-only self-test: JSON lines in, one verdict per line out. */
    selftest(lines: unknown[], extra: NodeJS.ProcessEnv = {}): RunResult {
      const r = spawnSync('bash', [PROBE], {
        encoding: 'utf8', cwd: home, timeout: 60_000, input: lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
        env: ghContainedEnv(home, { ...inheritedEnv(), HOME: home, TMPDIR: tmp, CCD_LAND_PROBE_SELFTEST: 'git_ro', ...extra },
          { systemd: true, tmux: true, net: true }),
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
  };
  return fx;
}

export type LandFixture = ReturnType<typeof makeLandFixture>;
