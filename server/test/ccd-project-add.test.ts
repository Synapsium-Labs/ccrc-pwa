// `ccd project-add --name <n> (--url <github-url> | --empty)` — a NEW project directory under `$PROJECTS_ROOT`, cloned
// from GitHub or `git init`ed empty (add-project spec 2026-11-04 §4). The verb is the only writer of the new
// directory: it validates the name and the url before it touches anything, refuses a name that already exists in any
// form, builds the tree in a dot-named temp directory the project walk skips, and moves it into place only after a
// second existence check. A failure removes that temp directory and nothing else.
//
// Everything runs under the harness's fixture HOME, and the verb is run as a PROGRAM (`bash ccd project-add …`), so the
// dispatcher arm, the exit code and the stream a refusal lands on are what is asserted. No clone leaves the box: a
// `url.<fixture origins>/.insteadOf=https://github.com/` pair (GIT_CONFIG_*) resolves `https://github.com/<o>/<r>.git`
// to a local bare repository, and the SSH shape reaches the harness's recording `ssh` poison only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, ghContainedEnv, ccdSource, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: CcdHarness;
let home: string;
let projects: string;
let origins: string;

beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-project-add-');
  home = h.home; projects = path.join(home, 'projects'); origins = path.join(home, 'origins');
});
afterEach(() => { h.cleanup(); });

interface Ran { status: number | null; stdout: string; stderr: string }

/** GitHub, rewritten to the fixture's origins directory: `https://github.com/o/r.git` is `<home>/origins/o/r.git`. */
const localGithub = (): NodeJS.ProcessEnv => ({
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${origins}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/',
});

/** The developer's environment minus what would choose a transport or a config for ccd's git: an inherited
 *  GIT_SSH_COMMAND or GIT_SSH would run instead of the harness's ssh poison (a real ssh to github.com), and the box's
 *  system or global config could carry a `core.sshCommand` that turns ccd's batch-mode default off. */
const ownEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...inheritedEnv(), HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
  delete env.GIT_SSH_COMMAND; delete env.GIT_SSH; delete env.GIT_CONFIG_GLOBAL;
  return env;
};

/** ccd as a program: the dispatcher arm, the real exit status and both streams. */
const ccd = (args: string[], extra: NodeJS.ProcessEnv = {}): Ran => {
  const r = spawnSync('bash', [CCD, 'project-add', ...args], {
    encoding: 'utf8', cwd: home,
    env: ghContainedEnv(home, { ...ownEnv(), ...extra }, { systemd: true, tmux: true, net: true }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

/** A bare origin at `<home>/origins/<owner>/<repo>.git` with one commit on `main`, built outside the projects root. */
const githubRepo = (owner: string, repo: string): string => {
  const bare = path.join(origins, owner, `${repo}.git`);
  const seed = path.join(home, 'seed');
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  h.git(home, 'init', '--quiet', '--bare', '-b', 'main', bare);
  h.git(home, 'init', '--quiet', '-b', 'main', seed);
  fs.writeFileSync(path.join(seed, 'README.md'), 'hi\n');
  h.git(seed, 'add', 'README.md');
  h.git(seed, 'commit', '--quiet', '-m', 'init');
  h.git(seed, 'push', '--quiet', bare, 'main');
  fs.rmSync(seed, { recursive: true, force: true });
  return bare;
};

/** What the projects root holds, dot names included: a refusal must leave it exactly as it was. */
const listing = (): string[] | null => (fs.existsSync(projects) ? fs.readdirSync(projects).sort() : null);

const refused = (r: Ran, needle: string): void => {
  expect(r.stdout).toBe('');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(needle);
};

// Built with `AT` so the public tree carries no contiguous address-shaped token (topology-clean's email class).
const AT = '@';

describe('project-add: the argv is exact', () => {
  const USAGE = 'ccd: usage: ccd project-add --name <n> (--url <url>|--empty)';
  it.each([
    ['no flags', []],
    ['a name alone', ['--name', 'demo']],
    ['both --url and --empty', ['--name', 'demo', '--url', 'https://github.com/o/r.git', '--empty']],
    ['--empty before --url', ['--name', 'demo', '--empty', '--url', 'https://github.com/o/r.git']],
    ['an unknown flag', ['--name', 'demo', '--bogus']],
    ['an unknown flag with a value', ['--name', 'demo', '--branch', 'main']],
    ['a repeated --name', ['--name', 'demo', '--name', 'other']],
    ['a missing --url value', ['--name', 'demo', '--url']],
    ['a missing --name value', ['--name']],
    ['--url before --name', ['--url', 'https://github.com/o/r.git', '--name', 'demo']],
    ['a positional name', ['demo', '--empty']],
    ['--empty with a value', ['--name', 'demo', '--empty', 'yes']],
  ])('refuses %s with the usage line and touches nothing', (_label, args) => {
    const r = ccd(args);
    refused(r, USAGE);
    expect(listing()).toBeNull();
  });
});

describe('project-add: the name is a NEW project name', () => {
  it.each([
    ['a leading dash', '-demo'],
    ['a leading dot', '.demo'],
    ['a leading underscore', '_demo'],
    ['65 bytes', 'a'.repeat(65)],
    ['a .git suffix', 'demo.git'],
    ['a slash', 'a/b'],
    ['a dot-dot', '..'],
    ['an empty name', ''],
    ['a space', 'a b'],
    ['a non-ASCII letter', 'café'],
  ])('refuses %s before it touches anything', (_label, name) => {
    refused(ccd(['--name', name, '--empty']), `ccd: invalid project '${name}'`);
    expect(listing()).toBeNull();
  });

  it('takes a name of exactly 64 bytes', () => {
    const name = 'a'.repeat(64);
    const r = ccd(['--name', name, '--empty']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(listing()).toEqual([name]);
  });
});

describe('project-add: the url is one of two exact GitHub shapes', () => {
  it.each([
    ['another host', 'https://gitlab.com/o/r.git'],
    ['the ext:: transport', 'ext::sh -c touch% /tmp/x'],
    ['a file:// url', 'file:///tmp/r.git'],
    ['a bare local path', '/tmp/r.git'],
    ['an extra path segment', 'https://github.com/o/r/x.git'],
    ['a leading dash', '-uhttps://github.com/o/r.git'],
    ['no .git suffix', 'https://github.com/o/r'],
    ['a trailing slash', 'https://github.com/o/r.git/'],
    ['the short owner/repo form', 'o/r'],
    ['a doubled .git', 'https://github.com/o/r.git.git'],
    ['plain http', 'http://github.com/o/r.git'],
    ['userinfo before the host', `https://x${AT}github.com/o/r.git`],
    ['an ssh:// url', 'ssh://git@github.com/o/r.git'],
    ['the SSH shape without .git', 'git@github.com:o/r'],
    ['a dash-leading owner', 'https://github.com/-o/r.git'],
    ['an empty url', ''],
  ])('refuses %s before it touches anything', (_label, url) => {
    refused(ccd(['--name', 'demo', '--url', url]), `ccd: invalid url '${url}'`);
    expect(listing()).toBeNull();
  });
});

describe('project-add: an existing name is never replaced', () => {
  const seedTarget = (kind: 'dir' | 'file' | 'dangling'): string => {
    fs.mkdirSync(projects, { recursive: true });
    const p = path.join(projects, 'demo');
    if (kind === 'dir') { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'keep'), 'mine\n'); }
    if (kind === 'file') fs.writeFileSync(p, 'mine\n');
    if (kind === 'dangling') fs.symlinkSync(path.join(home, 'nowhere'), p);
    return p;
  };
  it.each(['dir', 'file', 'dangling'] as const)('refuses a %s already at the name, on both arms', (kind) => {
    const p = seedTarget(kind);
    githubRepo('o', 'r');
    const arms = [['--name', 'demo', '--empty'], ['--name', 'demo', '--url', 'https://github.com/o/r.git'],
      ['--name', 'demo', '--url', 'git@github.com:o/r.git']];
    for (const args of arms) {
      refused(ccd(args, localGithub()), 'ccd: project exists: demo');
      expect(listing()).toEqual(['demo']);
    }
    // Refused BEFORE any clone: the SSH arm never reached the transport.
    expect(fs.existsSync(path.join(home, 'ssh-poison')), 'a clone was attempted').toBe(false);
    if (kind === 'dir') expect(fs.readdirSync(p)).toEqual(['keep']);
    if (kind === 'file') expect(fs.readFileSync(p, 'utf8')).toBe('mine\n');
    if (kind === 'dangling') expect(fs.readlinkSync(p)).toBe(path.join(home, 'nowhere'));
  });
});

describe('project-add --url: a clone', () => {
  it('clones the repository into place, with origin and origin/HEAD set, and says so', () => {
    githubRepo('owner', 'repo');
    const r = ccd(['--name', 'repo', '--url', 'https://github.com/owner/repo.git'], localGithub());
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('added repo\n');
    const main = path.join(projects, 'repo');
    expect(listing()).toEqual(['repo']);
    expect(fs.statSync(path.join(main, '.git')).isDirectory()).toBe(true);
    expect(h.git(main, 'config', '--get', 'remote.origin.url')).toBe('https://github.com/owner/repo.git');
    expect(h.git(main, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toBe('refs/remotes/origin/main');
    expect(fs.readFileSync(path.join(main, 'README.md'), 'utf8')).toBe('hi\n');
  });

  it('takes a name that differs from the repository', () => {
    githubRepo('owner', 'repo');
    const r = ccd(['--name', 'renamed', '--url', 'https://github.com/owner/repo.git'], localGithub());
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('added renamed\n');
    expect(listing()).toEqual(['renamed']);
  });

  it('creates the projects root when the box has none yet', () => {
    githubRepo('owner', 'repo');
    expect(listing()).toBeNull();
    expect(ccd(['--name', 'repo', '--url', 'https://github.com/owner/repo.git'], localGithub()).status).toBe(0);
    expect(listing()).toEqual(['repo']);
  });

  it('a failed clone passes git\'s message through and leaves no directory and no temp behind', () => {
    fs.mkdirSync(projects, { recursive: true });
    const r = ccd(['--name', 'missing', '--url', 'https://github.com/owner/missing.git'], localGithub());
    expect(r.stdout).toBe('');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccd: git clone failed for missing: /);
    expect(r.stderr).toMatch(/does not exist|not found|not appear to be a git repository/);
    expect(listing()).toEqual([]);
  });

  /** `localGithub()` plus a `post-checkout` hook (`core.hooksPath`) with `body`: it runs inside the clone, after the
   *  tree is written into the temp directory and before ccd's second existence check. */
  const withHook = (body: string): NodeJS.ProcessEnv => {
    const hooks = path.join(home, 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'post-checkout'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return { ...localGithub(), GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: hooks };
  };

  it('a clone git fails after writing its tree (a failing hook) leaves no temp behind either', () => {
    githubRepo('owner', 'repo');
    fs.mkdirSync(projects, { recursive: true });
    const r = ccd(['--name', 'repo', '--url', 'https://github.com/owner/repo.git'], withHook('exit 3'));
    expect(r.stdout).toBe('');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccd: git clone failed for repo: /);
    expect(listing()).toEqual([]);
  });

  it('a name taken WHILE the clone ran is refused at the second check, and the taker\'s directory is kept', () => {
    githubRepo('owner', 'repo');
    fs.mkdirSync(projects, { recursive: true });
    const racer = path.join(projects, 'repo');
    const r = ccd(['--name', 'repo', '--url', 'https://github.com/owner/repo.git'],
      withHook(`mkdir '${racer}' && echo theirs > '${racer}/keep'`));
    refused(r, 'ccd: project exists: repo');
    expect(listing()).toEqual(['repo']);
    expect(fs.readdirSync(racer)).toEqual(['keep']);
  });

  /** An ssh stand-in that records its argv in `<home>/probe` and fails, as a missing credential does. */
  const sshProbe = (): string => {
    const p = path.join(home, 'ssh-probe');
    fs.writeFileSync(p, '#!/bin/sh\nprintf "%s " "$@" > "$HOME/probe"; exit 1\n', { mode: 0o755 });
    return p;
  };
  const sshClone = (extra: NodeJS.ProcessEnv = {}): Ran => {
    fs.mkdirSync(projects, { recursive: true });
    return ccd(['--name', 'repo', '--url', 'git@github.com:owner/repo.git'], extra);
  };

  it('defaults GIT_SSH_COMMAND to a batch-mode ssh, so a missing credential fails rather than prompts', () => {
    // The developer's shell may export an ssh command, and the box a system config: neither reaches ccd's git here.
    const sys = path.join(home, 'system-gitconfig');
    fs.writeFileSync(sys, `[core]\n\tsshCommand = ${sshProbe()}\n`);
    const saved = { cmd: process.env.GIT_SSH_COMMAND, sys: process.env.GIT_CONFIG_SYSTEM };
    process.env.GIT_SSH_COMMAND = sshProbe(); process.env.GIT_CONFIG_SYSTEM = sys;
    let r: Ran;
    try { r = sshClone(); } finally {
      if (saved.cmd === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = saved.cmd;
      if (saved.sys === undefined) delete process.env.GIT_CONFIG_SYSTEM; else process.env.GIT_CONFIG_SYSTEM = saved.sys;
    }
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccd: git clone failed for repo: /);
    expect(fs.existsSync(path.join(home, 'probe')), 'an inherited ssh command ran').toBe(false);
    const ssh = fs.readFileSync(path.join(home, 'ssh-poison'), 'utf8');
    expect(ssh).toContain('-o BatchMode=yes');
    expect(ssh).toContain('git@github.com');
    expect(listing()).toEqual([]);
  });

  it.each([
    ['core.sshCommand in the box\'s git config', (p: string): NodeJS.ProcessEnv =>
      ({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: p })],
    ['GIT_SSH', (p: string): NodeJS.ProcessEnv => ({ GIT_SSH: p })],
  ])('leaves the ssh alone when the box chose its own through %s', (_label, chose) => {
    const r = sshClone(chose(sshProbe()));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccd: git clone failed for repo: /);
    expect(fs.readFileSync(path.join(home, 'probe'), 'utf8')).toContain('git@github.com');
    expect(fs.readFileSync(path.join(home, 'probe'), 'utf8')).not.toContain('BatchMode');
    expect(fs.existsSync(path.join(home, 'ssh-poison')), 'ccd replaced the box\'s ssh').toBe(false);
    expect(listing()).toEqual([]);
  });

  it('keeps a GIT_SSH_COMMAND the caller set, and forces GIT_TERMINAL_PROMPT=0 whatever the caller set', () => {
    fs.mkdirSync(projects, { recursive: true });
    const probe = 'printf "%s|" "$GIT_TERMINAL_PROMPT" > "$HOME/probe"; exit 1; true';
    const r = ccd(['--name', 'repo', '--url', 'git@github.com:owner/repo.git'],
      { GIT_SSH_COMMAND: probe, GIT_TERMINAL_PROMPT: '1' });
    expect(r.status).toBe(1);
    expect(fs.readFileSync(path.join(home, 'probe'), 'utf8')).toBe('0|');
    expect(fs.existsSync(path.join(home, 'ssh-poison'))).toBe(false);
    expect(listing()).toEqual([]);
  });
});

describe('project-add: git is bounded inside ccd', () => {
  const RUNNER = fs.readFileSync(path.join(path.dirname(CCD), '..', 'server', 'src', 'remote', 'runner.ts'), 'utf8');
  const CCD_SRC = ccdSource();

  it('the bound, plus _plat_timeout\'s largest kill grace, ends before the runner\'s row for the verb', () => {
    const bound = /^PROJECT_ADD_GIT_S=(\d+)\b/m.exec(CCD_SRC);
    const row = /'project-add': ([\d_]+),/.exec(RUNNER);
    expect(bound, 'ccd names PROJECT_ADD_GIT_S once, at the top level').not.toBeNull();
    expect(row, 'the runner has a project-add row').not.toBeNull();
    const graceMax = 8;   // `_plat_timeout`'s clamp on CCD_TIMEOUT_KILL_AFTER
    expect(Number(bound?.[1]) + graceMax).toBeLessThan(Number(row?.[1].replace(/_/g, '')) / 1000);
  });

  it('a git that overruns the bound is killed, its temp removed, and ccd says it timed out', () => {
    // A fake `git` first on PATH: the clone writes into its target and then sleeps; anything else is the real git.
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    const bin = path.join(home, 'fakebin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
[ "$1" = clone ] || exec '${real}' "$@"
for a; do last=$a; done
mkdir -p "$last" && echo partial > "$last/x" && echo $$ > "$HOME/git.pid"
exec sleep 60
`, { mode: 0o755 });
    const t0 = Date.now();
    const out = h.sh(`export PATH="${bin}:$PATH"; PROJECT_ADD_GIT_S=1; `
      + '( cmd_project_add --name demo --url https://github.com/o/r.git ) 2>&1; echo "rc=$?"');
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(out).toBe('ccd: git clone timed out for demo after 1s\nrc=1');
    expect(listing()).toEqual([]);
    const pid = Number(fs.readFileSync(path.join(home, 'git.pid'), 'utf8'));
    expect(() => process.kill(pid, 0), 'the clone outlived ccd').toThrow();
  });
});

// D-8193: an empty project is BORN READY for a workspace. It gets a local bare origin under ccd's origins directory
// (`$REG/origins` by default, `~/.ccrc/project-origins` names another), one empty commit on `main` there, and the project
// is cloned from it, so `origin`, `origin/HEAD` and `main`'s upstream are what a GitHub clone has.
describe('project-add --empty: a project born ready for a workspace (D-8193)', () => {
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const originAt = (dir: string, name: string): string => path.join(dir, `${name}.git`);
  const defaultOrigins = (): string => path.join(home, '.cc-sessions', 'origins');
  const gitStatus = (cwd: string, ...args: string[]): number | null =>
    spawnSync('git', ['-C', cwd, ...args], { env: { ...inheritedEnv(), HOME: home } }).status;

  it('makes a local bare origin, an empty commit on main pushed to it, and origin/HEAD, and says so', () => {
    const r = ccd(['--name', 'fresh', '--empty']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('added fresh\n');
    const main = path.join(projects, 'fresh');
    const origin = originAt(defaultOrigins(), 'fresh');
    expect(listing()).toEqual(['fresh']);
    expect(fs.statSync(path.join(main, '.git')).isDirectory()).toBe(true);
    expect(h.git(main, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(h.git(main, 'config', '--get', 'remote.origin.url')).toBe(origin);
    expect(h.git(main, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toBe('refs/remotes/origin/main');
    expect(h.git(main, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main');
    // One commit, with the empty tree: ccd adds no file to the operator's project.
    expect(h.git(main, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(h.git(main, 'rev-parse', 'HEAD^{tree}')).toBe(EMPTY_TREE);
    expect(h.git(main, 'rev-parse', 'HEAD')).toBe(h.git(main, 'rev-parse', 'origin/main'));
    expect(fs.readdirSync(main)).toEqual(['.git']);
    // The origin is bare, says it is ccd's for this name, and holds the same main.
    expect(h.git(home, '--git-dir', origin, 'rev-parse', '--is-bare-repository')).toBe('true');
    expect(h.git(home, '--git-dir', origin, 'config', '--get', 'ccd.emptyorigin')).toBe('fresh');
    expect(h.git(home, '--git-dir', origin, 'rev-parse', 'refs/heads/main')).toBe(h.git(main, 'rev-parse', 'HEAD'));
    // No dot-named temp is left in either directory.
    expect(fs.readdirSync(defaultOrigins())).toEqual(['fresh.git']);
  });

  it('then takes a workspace with no extra step: ws-add succeeds', () => {
    expect(ccd(['--name', 'fresh', '--empty']).status).toBe(0);
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add fresh`);
    const wt = path.join(home, 'worktrees', 'fresh', 'quiet-mesa');
    expect(fs.existsSync(path.join(wt, '.git'))).toBe(true);
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.git(wt, 'rev-parse', 'HEAD')).toBe(h.git(path.join(projects, 'fresh'), 'rev-parse', 'origin/main'));
    expect(h.reg('fresh-quiet-mesa', 'uuid')).not.toBeNull();
    expect(h.reg('fresh-quiet-mesa', 'workspace')).not.toBeNull();
  });

  it('puts the origin where ~/.ccrc/project-origins says, creating that directory', () => {
    const dir = path.join(home, 'elsewhere', 'origins');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'project-origins'), `${dir}\n`);
    const r = ccd(['--name', 'fresh', '--empty']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(h.git(path.join(projects, 'fresh'), 'config', '--get', 'remote.origin.url')).toBe(originAt(dir, 'fresh'));
    expect(fs.existsSync(defaultOrigins())).toBe(false);
  });

  it.each([
    ['a relative path', 'origins\n'],
    ['an empty first line', '\n'],
    ['nothing at all', ''],
  ])('refuses ~/.ccrc/project-origins naming %s, and touches nothing', (_label, body) => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'project-origins'), body);
    refused(ccd(['--name', 'fresh', '--empty']), 'project-origins');
    expect(listing()).toBeNull();
    expect(fs.existsSync(defaultOrigins())).toBe(false);
  });

  it('a re-run adopts the origin an earlier run left behind, and keeps its history', () => {
    expect(ccd(['--name', 'fresh', '--empty']).status).toBe(0);
    const origin = originAt(defaultOrigins(), 'fresh');
    const first = h.git(home, '--git-dir', origin, 'rev-parse', 'refs/heads/main');
    // The project is gone (an earlier run killed after the origin, or the operator removed the checkout).
    fs.rmSync(path.join(projects, 'fresh'), { recursive: true, force: true });
    const r = ccd(['--name', 'fresh', '--empty']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('added fresh\n');
    const main = path.join(projects, 'fresh');
    expect(h.git(main, 'rev-parse', 'HEAD')).toBe(first);
    expect(h.git(home, '--git-dir', origin, 'rev-parse', 'refs/heads/main')).toBe(first);
    expect(h.git(main, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toBe('refs/remotes/origin/main');
  });

  it('a re-run of ours with no main yet (an origin made but never seeded) seeds it', () => {
    const origin = originAt(defaultOrigins(), 'fresh');
    fs.mkdirSync(defaultOrigins(), { recursive: true });
    h.git(home, 'init', '--quiet', '--bare', '-b', 'main', origin);
    h.git(home, '--git-dir', origin, 'config', 'ccd.emptyorigin', 'fresh');
    const r = ccd(['--name', 'fresh', '--empty']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(h.git(path.join(projects, 'fresh'), 'rev-parse', 'HEAD^{tree}')).toBe(EMPTY_TREE);
    expect(gitStatus(home, '--git-dir', origin, 'rev-parse', '--verify', '--quiet', 'refs/heads/main')).toBe(0);
  });

  const seedForeign = (kind: 'dir' | 'file' | 'link' | 'bare' | 'other-name'): string => {
    const origin = originAt(defaultOrigins(), 'fresh');
    fs.mkdirSync(defaultOrigins(), { recursive: true });
    if (kind === 'dir') { fs.mkdirSync(origin); fs.writeFileSync(path.join(origin, 'keep'), 'mine\n'); }
    if (kind === 'file') fs.writeFileSync(origin, 'mine\n');
    if (kind === 'link') fs.symlinkSync(path.join(home, 'nowhere'), origin);
    if (kind === 'bare' || kind === 'other-name') h.git(home, 'init', '--quiet', '--bare', '-b', 'main', origin);
    if (kind === 'other-name') h.git(home, '--git-dir', origin, 'config', 'ccd.emptyorigin', 'other');
    return origin;
  };

  it.each(['dir', 'file', 'link', 'bare', 'other-name'] as const)(
    'refuses when a %s that is not ccd\'s stands at the origin, and touches nothing', (kind) => {
      const origin = seedForeign(kind);
      const before = kind === 'link' ? fs.readlinkSync(origin) : JSON.stringify(fs.lstatSync(origin).mtimeMs);
      refused(ccd(['--name', 'fresh', '--empty']), `ccd: an origin that is not ccd's stands at ${origin}`);
      expect(listing()).toBeNull();
      expect(fs.readdirSync(defaultOrigins())).toEqual(['fresh.git']);
      expect(kind === 'link' ? fs.readlinkSync(origin) : JSON.stringify(fs.lstatSync(origin).mtimeMs)).toBe(before);
      if (kind === 'dir') expect(fs.readdirSync(origin)).toEqual(['keep']);
      if (kind === 'bare') expect(gitStatus(home, '--git-dir', origin, 'config', '--get', 'ccd.emptyorigin')).not.toBe(0);
    });

  it('an existing project is still refused before the origin is looked at', () => {
    fs.mkdirSync(path.join(projects, 'fresh'), { recursive: true });
    refused(ccd(['--name', 'fresh', '--empty']), 'ccd: project exists: fresh');
    expect(fs.existsSync(defaultOrigins())).toBe(false);
  });
});

describe('project-add: a temp of an earlier run is never adopted or deleted', () => {
  it('refuses when its own pid\'s temp already stands, and leaves that temp as it found it', () => {
    // Sourced, so `$$` inside the subshell is the pid ccd names its temp after.
    const out = h.sh('t="$PROJECTS_ROOT/.project-add.demo.$$"; mkdir -p "$t" && echo mine > "$t/keep"; '
      + '( cmd_project_add --name demo --empty ) 2>&1; echo "rc=$?"; ls -A "$t"');
    expect(out).toMatch(/^ccd: a temp of an earlier project-add stands at .*\/projects\/\.project-add\.demo\.\d+ — remove it by hand\nrc=1\nkeep$/);
    expect(listing()?.filter((n) => !n.startsWith('.project-add.demo.'))).toEqual([]);
  });
});
