// `ccrc install` — the verb that converges a single box from the shipped tree.
// Stage 2d Task 6 builds its SPINE and the three SEEDING steps
// (`_inst_roster`, `_inst_accounts_sh`, `_inst_env`); Tasks 7-9 add the tree
// copy, the executables and stamp, the units, hooks and wrappers, and the
// doctor tail. This file grows with them, which is why the fixture below is a
// tree rather than a pair of files.
//
// ── WHY THE FIXTURE IS A COPIED TREE, NOT SYMLINKS ────────────────────────
// `ccrc-doctor.test.ts` installs `ccrc` into its fixture as SYMLINKS at
// `<home>/ccrc/ccd/` — the shape of a deployed box — and that is right for
// doctor, which only ever READS the tree it is run from. Install is the other
// half: it reads the tree AND writes the box, and Task 7 makes it COPY that
// tree to `~/ccrc`. Two consequences decide the fixture here:
//
//   1. The tree is a CHECKOUT, at `<home>/checkout`, not `<home>/ccrc`.
//      Otherwise Task 7's `_inst_tree` would be copying a directory onto
//      itself, and every "the tree landed at ~/ccrc" assertion would pass
//      against a fixture that never moved a byte.
//   2. Every file is a real COPY, so a test may CORRUPT one (the shipped
//      roster seed, below) without touching this checkout. Through a symlink,
//      "corrupt the seed in the fixture tree" would mean corrupting
//      `deploy/accounts.default.json` in the repository — which is the sort of
//      test that passes once and then breaks everything.
//
// ── WHAT THE TREE HOLDS, AND WHY EACH PIECE IS IN IT ──────────────────────
// `TREE_FILES` is the whole list and is meant to GROW one line at a time as
// later tasks reach for more of the tree. Every entry is there because
// something the verb runs resolves it RELATIVE TO `ccrc` ITSELF (`CCRC_HERE`),
// so a missing entry does not read as "the fixture is thin" — it reads as the
// verb being broken. `the fixture tree is the one the generator needs` below
// is the guard that keeps that failure legible.
//
// ── CONTAINMENT ───────────────────────────────────────────────────────────
// `ccrcEnv`'s three boundaries, same as `ccrc-cli.test.ts` (whose comments own
// the reasoning): `ghContainedEnv`'s poisoned `gh` at the head of PATH, a
// hand-planted `curl`/`systemctl`/`loginctl` beside it, and every `CCRC_*`
// input deleted BY NAME so the fixture decides and never the ambient shell.
// The rest of PATH is left real on purpose — this verb RUNS `node`
// (deploy/gen-accounts.mjs projects the roster into bash), and a fixture-only
// PATH would be testing a box nobody has.
//
// HOME is a throwaway `mkTmp` directory in every test, because this verb
// WRITES: `~/.ccrc/accounts.json`, `~/.ccrc/accounts.sh`, `~/.ccrc/ccrc.env`
// today, and most of a box by Task 8. Nothing here may ever run against a real
// $HOME.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync,
  chmodSync, readdirSync, rmSync, symlinkSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** `command -v <name>` under THIS process's real PATH. */
function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}

/** bash's absolute path, resolved ONCE, for the same reason
 *  `ccrc-doctor.test.ts:62` resolves it: libuv looks the executable up in the
 *  CHILD's environment, and one runner below hands the child a PATH with no
 *  system directory on it at all — spawning bare `bash` there is ENOENT, which
 *  surfaces as a spawn failure (`status === null`) rather than as anything the
 *  test is about. */
const BASH = realPath('bash');

/** The real `rsync`, resolved once. Module scope, and a hard throw when the
 *  box has none, is the honest failure: `_inst_tree` REFUSES BY NAME without
 *  rsync, so a box that cannot run rsync cannot run `ccrc install` at all and
 *  there is no version of this suite that could still be measuring the verb. */
const RSYNC = realPath('rsync');

/** Every path the fixture tree is built from, repo-relative. Tasks 8-9 add
 *  lines here (the unit files) as the steps that read them land.
 *
 *  A DIRECTORY entry is copied whole; every other entry is one file. The
 *  recursive branch exists because `deploy/systemd/` is four drop-ins under
 *  three directories and listing them one by one is a fixture that goes stale
 *  the moment a fifth lands (Task 6 review, Minor 5). */
const TREE_FILES = [
  // The four executables that ship in `ccd/` and resolve each other through
  // `CCRC_HERE`: `ccrc` itself, plus the check table, the wrapper-shape
  // contract and `ccrc-adopt`. Absent siblings are not a smaller fixture —
  // `cmd_doctor` and `cmd_wrappers` refuse by name when one is missing, so the
  // doctor tail (Task 8) would fail for a fixture reason.
  'ccd/ccrc',
  'ccd/ccrc-doctor-checks',
  'ccd/ccrc-wrapper-shape',
  'ccd/ccrc-adopt',
  // The generators, reached as `$CCRC_HERE/../deploy/<name>.mjs` — the same
  // "one directory up from this script" resolution `cmd_wrappers` uses, true
  // in a checkout and at `~/ccrc/deploy` on a deployed box.
  'deploy/gen-accounts.mjs',
  'deploy/gen-wrappers.mjs',
  // The roster SEED `_inst_roster` places on a box that has none…
  'deploy/accounts.default.json',
  // …and the five-account roster this fleet really runs, which ships beside it
  // (deploy.sh:196-206). It is not a seed candidate for a single box; it is
  // here because it is the realistic "the operator already has a roster" fixture
  // — a roster with `claude-corp` in it, so "generated FROM the installed
  // roster" is provable rather than merely plausible.
  'deploy/accounts.migration.json',
  // `gen-accounts.mjs` imports the first three; `gen-wrappers.mjs` imports
  // `wrapper.mjs` and two of the same three. They were written dependency-free
  // for exactly this bare-`node` caller, so this is the complete transitive
  // set — `the fixture tree is the one the generator needs` proves it by
  // running the generator inside the fixture rather than by re-reading the
  // imports here.
  'shared/generate.mjs',
  'shared/mark.mjs',
  'shared/roster-json.mjs',
  'shared/wrapper.mjs',
  // The node floor doctor reads out of the shipped `package.json`, for BOTH
  // box roles (`_check_node` looks for the server's, then the agent's). The
  // doctor tail arrives in Task 8; the files are cheap and their absence would
  // make that task's first run fail for a fixture reason.
  'server/package.json',
  'agent/package.json',
  // ── Task 7: what `_inst_bins` and `_inst_files` place ──────────────────
  // `ccd` itself is 570 KB and is copied whole rather than stubbed, because
  // the assertion it serves ("`~/.local/bin/ccd` is a byte copy of the tree's
  // ccd") is satisfied by any two identical stubs — while the things that
  // actually go wrong are installing a symlink, a truncated copy, or the
  // wrong file, all of which a real payload catches and a 12-byte one does
  // not.
  'ccd/ccd',
  'ccd/ccd-cap-scopes',
  'ccd/session-hook.sh',
  'ccd/install-session-hooks.sh',
  'ccd/tmux.conf',
  'ccd/statusline-command.sh',
  'deploy/notify.sh',
  // The first DIRECTORY entry. Nothing in Task 7 reads it — `_inst_tree`
  // copies it as part of `deploy/`, and Task 8's `_inst_units` installs the
  // drop-ins out of it. It is here now so the recursive branch above ships
  // with a user rather than as untested fixture machinery.
  'deploy/systemd',
];

/** The two BUILD ARTIFACTS `_inst_tree` refuses to place a tree without. They
 *  are build output, not repository files, so the fixture WRITES them instead
 *  of copying them — and it writes placeholders, because the step measures
 *  that the path EXISTS (a box cannot run a server it never built) and a real
 *  bundle would make every test in this file slower for nothing. The tests
 *  that want the refusal delete one. */
const TREE_STUBS: Record<string, string> = {
  'server/dist/server/src/index.js': '// fixture: stands in for the built server\n',
  'server/dist-pwa/index.html': '<!doctype html><title>fixture PWA</title>\n',
};

/** `<home>/checkout` — the shipped tree this box installs FROM. */
const treeRoot = (home: string): string => join(home, 'checkout');
/** The `ccrc` a test runs: the one INSIDE the fixture tree, so `CCRC_HERE`
 *  resolves to the fixture's `ccd/` and every sibling it reaches is a fixture
 *  file. */
const ccrcIn = (root: string): string => join(root, 'ccd', 'ccrc');
const treeFile = (home: string, rel: string): string => join(treeRoot(home), rel);
/** `<home>/ccrc` — where `_inst_tree` PLACES the tree, and the layout the PATH
 *  shim, `_dr_pkg_candidates` and both deploy lanes already assume. */
const placed = (home: string, ...rel: string[]): string => join(home, 'ccrc', ...rel);

/** Builds a fixture tree out of `TREE_FILES` + `TREE_STUBS`, preserving each
 *  file's mode (the `ccd/` scripts are 0755 in the repository and one of them
 *  is `exec`d by `cmd_adopt`). `sub` is the directory under `$HOME` it lands
 *  in: `checkout` for the ordinary case, `ccrc` for the one test that runs the
 *  verb from the tree it would otherwise be copying onto itself. Returns the
 *  tree root. */
export function installFixtureTree(home: string, sub = 'checkout'): string {
  const root = join(home, sub);
  for (const rel of TREE_FILES) {
    const src = join(REPO, rel);
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (statSync(src).isDirectory()) { cpSync(src, dest, { recursive: true }); continue; }
    copyFileSync(src, dest);
    chmodSync(dest, statSync(src).mode & 0o777);
  }
  for (const [rel, body] of Object.entries(TREE_STUBS)) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  }
  return root;
}

/** A box with a shipped tree on it and nothing else — no `~/.ccrc`, no
 *  `~/.local/bin` beyond the poisons the runner plants. */
function freshBox(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  return home;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc-cli.test.ts:73-95`'s runner environment, and its reasoning applies
 *  here unchanged. The one addition a future task must remember: any new
 *  `CCRC_*` variable this verb learns to read goes in the delete list below,
 *  or a maintainer with it exported in their shell gets a different install
 *  than the fixture asked for. */
function ccrcEnv(home: string, omit: string[] = []): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  const plant = (name: string, body: string): void => {
    if (omit.includes(name)) { rmSync(join(home, '.local', 'bin', name), { force: true }); return; }
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  };
  const poison = (name: string, says: string): void =>
    plant(name,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`);
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never drive this box\'s real systemd');
  // `loginctl` joins the pair here (it is not in ccrc-cli's runner) because
  // Task 8's `_inst_linger` runs `loginctl enable-linger` — a WRITE to this
  // production box's logind, which the poison must be in front of before the
  // step that calls it exists, not after.
  poison('loginctl', 'ccrc tests must never touch this box\'s real logind');
  // ── the two tools `_inst_tree` shells out to, contained differently ──────
  // `npm` is a POISON in the strict sense: `npm ci` in a fixture would reach
  // the real registry, take minutes, and install a dependency tree into a
  // directory about to be deleted. The stub records its argv AND its cwd — the
  // step's `cd "$dest/server"` is half of what it promises — and makes the
  // `node_modules` a real run would, so the next run's `rsync --delete` has
  // something to (not) destroy.
  plant('npm',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/npm-argv"\n'
    + 'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"\nmkdir -p node_modules\nexit 0\n');
  // `rsync` is a RECORDER, not a poison: it logs its argv and then EXECS THE
  // REAL BINARY. Both halves are load-bearing. Asserting on argv alone passes
  // against a step that composes a perfect command line and copies nothing;
  // asserting on the placed tree alone cannot tell "the excludes are spelled
  // correctly" from "the fixture happened to hold nothing they match".
  plant('rsync',
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/rsync-argv"\nexec ${RSYNC} "$@"\n`);
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];
  return env;
}

/** `opts.umask` runs the verb under an explicit file-creation mask instead of
 *  the ambient one. It exists because a `chmod` this verb makes is invisible
 *  under a permissive umask: `0644` is what a plain `>` redirect produces
 *  anyway at `umask 022`, so a test asserting `0644` there passes with the
 *  `chmod` DELETED (measured — round-1 review, Minor 1: the guard reddened only
 *  on the reviewer's `umask 0002` box, i.e. by accident of whose shell ran it).
 *  Under a hostile mask the mode can only come from the `chmod`.
 *
 *  `opts.stubs` plants executables into the fixture's `.local/bin` AFTER the
 *  runner's own, so a test can model one tool BEHAVING BADLY (an `npm` that
 *  fails, a `git` that refuses) rather than merely being absent — the two
 *  conditions a step must not collapse. It is applied last for a reason: the
 *  runner re-plants its defaults on every call, so a stub written before this
 *  point is silently overwritten. */
function runInstall(home: string, args: string[] = ['install'],
  extraEnv: NodeJS.ProcessEnv = {},
  opts: {
    umask?: string; omit?: string[]; from?: string; stubs?: Record<string, string>;
  } = {}): Result {
  const env = { ...ccrcEnv(home, opts.omit ?? []), ...extraEnv };
  for (const [name, body] of Object.entries(opts.stubs ?? {})) {
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  }
  const ccrc = opts.from ?? ccrcIn(treeRoot(home));
  const r = opts.umask === undefined
    ? spawnSync(BASH, [ccrc, ...args], { env, encoding: 'utf8' })
    : spawnSync(BASH, ['-c', `umask ${opts.umask}; exec ${BASH} "$0" "$@"`,
      ccrc, ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A PATH with everything this verb shells out to EXCEPT one named tool: the
 *  poison directory at the head (so `gh`/`curl`/`systemctl`/`loginctl` stay
 *  contained) then a directory of symlinks to the real binaries the steps use.
 *  Removing a system directory wholesale would not model this — on most boxes
 *  `node` sits beside `cp` and `mkdir`, and a box missing THOSE is not the
 *  condition under test. This is the doctor suite's `stub-bin` + `linkReal`
 *  idiom, used here to model exactly one absence.
 *
 *  A tool the fixture itself plants into `.local/bin` (`npm`, `rsync`) must
 *  ALSO be named in `runInstall`'s `omit`, or the runner re-plants it at the
 *  head of this very PATH and the absence never happens. */
function pathWithout(home: string, missing: string): string {
  const d = join(home, `no-${missing}-bin`);
  mkdirSync(d, { recursive: true });
  for (const b of ['mkdir', 'cp', 'mv', 'rm', 'cat', 'chmod', 'cmp', 'date',
    'node', 'git', 'npm', 'rsync']) {
    if (b === missing || existsSync(join(d, b))) continue;
    symlinkSync(realPath(b), join(d, b));
  }
  return `${join(home, '.local', 'bin')}:${d}`;
}

const read = (p: string): string => readFileSync(p, 'utf8');
const dotCcrc = (home: string, name: string): string => join(home, '.ccrc', name);
const mtime = (p: string): number => statSync(p).mtimeMs;

/** Writes `~/.ccrc/<name>` before a run — how a test says "this box already
 *  had one of these". */
function preexisting(home: string, name: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(dotCcrc(home, name), text);
}

/** Every directory an install step writes a temp sibling into. It is the list
 *  of destinations, not a guess: `_inst_atomic` stages beside its TARGET, so a
 *  step that installs into a directory absent from this list leaks strays no
 *  assertion here can see. `''` is `$HOME` itself, which `~/.tmux.conf` makes a
 *  destination directory. Task 8 adds `.config/systemd/user`. */
const STRAY_DIRS = ['', '.ccrc', '.local/bin', '.cc-sessions', '.claude', 'ccrc'];

/** Every `<file>.tmp.<pid>` left anywhere a step writes. Each one writes
 *  through a temp sibling and renames; a leftover means a step died between the
 *  two — and a stray under `~/.local/bin` is worse than untidy, because that
 *  directory is ON PATH and `_inst_atomic` copies the source's mode onto the
 *  temp before the rename. */
const strays = (home: string): string[] => {
  const out: string[] = [];
  for (const rel of STRAY_DIRS) {
    const d = join(home, rel);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/\.tmp\./.test(f)) out.push(join(rel, f));
  }
  return out;
};

const DEFAULT_SEED = read(join(REPO, 'deploy', 'accounts.default.json'));
const MIGRATION_ROSTER = read(join(REPO, 'deploy', 'accounts.migration.json'));

/** Turns a fixture tree into a REAL one-commit git repository, which is what
 *  `_inst_stamp` measures. A fake `.git` directory would not do: the step runs
 *  `git rev-parse HEAD` and `git diff --quiet`, so the fixture has to be
 *  something git itself answers for. Identity comes from the environment
 *  rather than `git config`, so a box whose user has no global identity (CI)
 *  still commits. */
function gitInit(root: string): string {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    // A commit template or hooks path from the ambient config would make this
    // fixture depend on whose box runs the suite.
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const git = (...args: string[]): void => {
    const r = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  };
  git('init', '-q', '-b', 'fixture-branch');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture tree');
  return spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' })
    .stdout.trim();
}

describe('ccrc install: the shipped tree lands at $HOME/ccrc', () => {
  // WHY THE TREE IS COPIED AT ALL, since the verb is already running out of
  // one: `~/ccrc` is the layout every sibling contract assumes — the PATH shim
  // execs `~/ccrc/ccd/ccrc`, `_dr_pkg_candidates` reads the node floor at
  // `$CCRC_HERE/../{server,agent}/package.json`, and both deploy lanes rsync
  // into exactly this directory. An install that left the tree in a checkout
  // would leave a box that works only as long as nobody deletes the clone.
  it('refuses BY ARTIFACT when the checkout carries no server build', () => {
    // The refusal names the artifact and the command that makes it. "install
    // failed" would send an operator to read this script; "no server build at
    // <path>" sends them to `bash install.sh`, which is the whole distance
    // between the two messages.
    const home = freshBox('ccrc-install-nodist-');
    rmSync(treeFile(home, 'server/dist/server/src/index.js'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: no server build at .*\/checkout\/server\/dist — build first: bash install\.sh \(or npm run build in server\/ and pwa\/\)$/m);
    // BEFORE anything moved: the preflight is worth nothing if it fires after
    // the copy it is meant to gate.
    expect(existsSync(placed(home)), 'the tree was placed before it was checked').toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran anyway').toBe(false);
  });

  it('refuses BY ARTIFACT when the PWA bundle is missing — a different sentence', () => {
    // Two artifacts, two builds, two remedies (`npm run build` in server/ vs
    // in pwa/). Collapsing them into one "the tree is not built" is the
    // overloaded-seam mistake this file's own header bans.
    const home = freshBox('ccrc-install-nopwa-');
    rmSync(treeFile(home, 'server/dist-pwa/index.html'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: no PWA bundle at .*\/checkout\/server\/dist-pwa — build first: bash install\.sh \(or npm run build in pwa\/\)$/m);
    expect(existsSync(placed(home))).toBe(false);
  });

  it('places the five directories a box runs out of, with the builds inside them', () => {
    const home = freshBox('ccrc-install-tree-placed-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    for (const d of ['server', 'agent', 'shared', 'deploy', 'ccd']) {
      expect(existsSync(placed(home, d)), `${d} did not reach $HOME/ccrc`).toBe(true);
    }
    // The shim's target, by the path the shim spells.
    expect(existsSync(placed(home, 'ccd', 'ccrc'))).toBe(true);
    // dist and dist-pwa are INCLUDED, and that is the deliberate divergence
    // from `deploy.sh` (which excludes `dist` and builds on the box): install
    // IS the box, so it ships the build the checkout already made.
    expect(existsSync(placed(home, 'server', 'dist', 'server', 'src', 'index.js'))).toBe(true);
    expect(read(placed(home, 'server', 'dist-pwa', 'index.html')))
      .toBe(TREE_STUBS['server/dist-pwa/index.html']);
    expect(r.stdout).toMatch(/^install: tree: placed at \$HOME\/ccrc$/m);
  });

  it('leaves node_modules, .git, env files and the mail token in the checkout', () => {
    // Every one of these is a real thing a checkout holds at install time. The
    // two secrets are the sharp ones: `deploy/ccrc.env` and
    // `deploy/ccrc-mail.token` are gitignored files carrying live tokens, and
    // rsync's `-a` would copy them at whatever mode the checkout has (0644
    // under a plain umask) into a second, unmanaged location — deploy.sh's own
    // excludes exist for exactly that (`:319-326`).
    const home = freshBox('ccrc-install-excludes-');
    mkdirSync(treeFile(home, 'server/node_modules/leftpad'), { recursive: true });
    writeFileSync(treeFile(home, 'server/node_modules/leftpad/index.js'), 'module.exports = 1\n');
    writeFileSync(treeFile(home, 'deploy/ccrc.env'), 'CCRC_AGENT_TOKEN=live-secret\n');
    writeFileSync(treeFile(home, 'deploy/ccrc-mail.token'), 'live-shared-secret\n');
    gitInit(treeRoot(home));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(placed(home, 'server', 'node_modules', 'leftpad'))).toBe(false);
    expect(existsSync(placed(home, '.git')), 'the placed tree is a git repository').toBe(false);
    expect(existsSync(placed(home, 'deploy', 'ccrc.env'))).toBe(false);
    expect(existsSync(placed(home, 'deploy', 'ccrc-mail.token'))).toBe(false);
    // …and the excludes were spelled to rsync, not achieved by the fixture
    // being empty of them: the recorder saw the flags on the real command line.
    const argv = read(join(home, 'rsync-argv'));
    for (const ex of ['--exclude node_modules', '--exclude .git',
      "--exclude *.env", '--exclude ccrc-mail.token']) {
      expect(argv).toContain(ex);
    }
  });

  it('installs the server runtime deps INTO THE PLACED TREE, production only', () => {
    // `npm ci --omit=dev` and not `npm run build`: the divergence from deploy
    // recorded in the step's own comment. deploy builds on the box because it
    // ships sources across boxes; install IS the box, so the build is already
    // in the tree it just placed and only the runtime dependencies are missing.
    const home = freshBox('ccrc-install-npm-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(join(home, 'npm-argv')).trim()).toBe('ci --omit=dev --no-audit --no-fund');
    // In `$HOME/ccrc/server`, never in the checkout: a box whose service boots
    // out of `~/ccrc` needs the deps THERE.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(placed(home, 'server'));
    expect(existsSync(placed(home, 'server', 'node_modules'))).toBe(true);
    expect(r.stdout).toMatch(/^install: tree: server runtime deps in place$/m);
  });

  it('lets npm SAY WHY when the dependency install fails', () => {
    // FIX ROUND 1, IMPORTANT 2. This is the verb's most likely failure — a
    // registry hiccup, no network, a lockfile out of step with package.json —
    // and `>/dev/null 2>&1` left the operator with "npm ci … failed" and no
    // way to see which. The rule is written down one step over
    // (`_inst_accounts_sh`: "stderr is deliberately NOT captured … re-wording a
    // fix into a shrug helps nobody") and deploy already obeys it, since its
    // `npm ci` runs over ssh with both streams attached.
    //
    // npm's STDOUT is redirected to stderr rather than kept: an install
    // transcript is one `install: <step>: <result>` line per step on stdout,
    // and "added 41 packages in 3s" is not this run's result. Both halves are
    // asserted — the diagnosis reaches stderr, and stdout stays a transcript.
    const home = freshBox('ccrc-install-npm-fails-');
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        npm: '#!/bin/sh\necho "npm notice: reaching the registry" \n'
          + 'echo "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n',
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr, 'npm\'s own diagnosis never reached the operator')
      .toContain('npm ERR! code ENOTFOUND registry.npmjs.org');
    // …and the step's refusal still stands beside it, naming the consequence.
    expect(r.stderr).toMatch(
      /^ccrc: npm ci in \$HOME\/ccrc\/server failed — the service cannot start without runtime deps$/m);
    expect(r.stdout, 'npm\'s chatter landed in the install transcript')
      .not.toContain('npm notice');
    expect(r.stdout).not.toMatch(/^install: tree: server runtime deps in place$/m);
  });

  it('does not copy the tree onto itself when it IS $HOME/ccrc', () => {
    // The box a deploy already touched, and the box a second `ccrc install`
    // runs on: `ccrc` is at `~/ccrc/ccd/ccrc`, so source and destination are
    // one directory. `rsync -a --delete X X/` is not a no-op — it is a copy of
    // the tree INTO ITSELF (`~/ccrc/ccrc/…`) whose `--delete` pass then runs
    // over the live tree. The guard is compared on RESOLVED paths, and the
    // assertion is that rsync was never invoked at all.
    const home = mkTmp('ccrc-install-selfcopy-');
    const root = installFixtureTree(home, 'ccrc');
    const r = runInstall(home, ['install'], {}, { from: ccrcIn(root) });
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync was invoked on the tree itself').toBe(false);
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(existsSync(placed(home, 'ccrc')), 'the tree was copied inside itself').toBe(false);
    // …and the step still finishes its other half: the deps are installed
    // whether or not the tree had to move.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(placed(home, 'server'));
  });

  it('refuses BY NAME when rsync is not on this box', () => {
    // The one tool this verb cannot substitute for. Without a by-name refusal
    // the failure arrives as `rsync: command not found` on stderr plus
    // "placing the tree at … failed", which names neither the missing package
    // nor the fix.
    const home = freshBox('ccrc-install-norsync-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'rsync') },
      { omit: ['rsync'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rsync is required to place the tree — sudo apt install rsync$/m);
    expect(existsSync(placed(home)), 'a half-made $HOME/ccrc was left behind').toBe(false);
  });

  it('a second run keeps the runtime deps the first one installed', () => {
    // `--delete` with `--exclude node_modules` protects the excluded path on
    // the RECEIVER (rsync does not delete what it was told to ignore, absent
    // `--delete-excluded`). Drop that exclude and every re-install wipes
    // `~/ccrc/server/node_modules` — on the live box, that is a server with no
    // runtime deps for however long the reinstall takes.
    const home = freshBox('ccrc-install-deps-survive-');
    expect(runInstall(home).code).toBe(0);
    writeFileSync(placed(home, 'server', 'node_modules', 'marker'), 'installed by run 1\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(placed(home, 'server', 'node_modules', 'marker'))).toBe(true);
  });
});

describe('ccrc install: the fixture tree', () => {
  it('is the one the generator needs — proven by running it inside the fixture', () => {
    // A scan over an empty list passes everything, and a fixture missing one
    // `shared/*.mjs` fails as "install died" three describes further down,
    // where the reason is invisible. This runs the generator the way the verb
    // runs it — from inside the tree, against the tree's own seed — so a
    // TREE_FILES list that has gone incomplete says so HERE, in one line.
    const home = freshBox('ccrc-install-tree-');
    const r = spawnSync('node',
      [treeFile(home, 'deploy/gen-accounts.mjs'), treeFile(home, 'deploy/accounts.default.json')],
      { encoding: 'utf8' });
    expect(r.stderr, 'the fixture tree cannot run its own generator').toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/m);
  });

  it('is a COPY — a test may corrupt it without touching this checkout', () => {
    const home = freshBox('ccrc-install-tree-copy-');
    writeFileSync(treeFile(home, 'deploy/accounts.default.json'), 'clobbered');
    expect(read(join(REPO, 'deploy', 'accounts.default.json'))).toBe(DEFAULT_SEED);
  });
});

describe('ccrc install: a fresh box', () => {
  it('seeds the roster with the shipped default, byte for byte', () => {
    // BYTE FOR BYTE, not "an equivalent roster": `~/.ccrc/accounts.json` is
    // USER-OWNED config that ccrc will never rewrite, so whatever lands here
    // is what the operator inherits and edits. A seed that had been
    // re-serialised (key order, indentation) would be a file the operator did
    // not choose and cannot diff against the tree they installed from.
    const home = freshBox('ccrc-install-fresh-roster-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(DEFAULT_SEED);
    expect(r.stdout).toMatch(/^install: roster: seeded single-account default$/m);
  });

  it('generates accounts.sh from it — marked, parseable, and 644 under any umask', () => {
    // RUN UNDER `umask 077`, deliberately (round-1 review, Minor 1). The mode
    // assertion below is about `_inst_accounts_sh`'s explicit `chmod 644`, and
    // under the ordinary `umask 022` a plain `>` redirect produces 0644 all by
    // itself — so the assertion passed with the `chmod` DELETED, measured. The
    // guard's redness was an accident of whose shell ran the suite (this box
    // masks 0002 and did go red; CI at 022 did not). At 077 the redirect
    // produces 0600 and 0644 can only come from the chmod: re-measured, the
    // deletion is now 1 red here.
    const home = freshBox('ccrc-install-fresh-accounts-sh-');
    const r = runInstall(home, ['install'], {}, { umask: '077' });
    expect(r.code, r.stderr).toBe(0);
    const sh = dotCcrc(home, 'accounts.sh');
    // The provenance marker `shared/mark.mjs` writes. Its presence is what
    // makes this file recognisably ccrc-OWNED — the opposite rule to the two
    // seeded files, and what lets a later run replace it without asking.
    expect(read(sh)).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/m);
    // `ccd` SOURCES this file on every invocation and dies without it, so
    // "bash can parse it" is the minimum bar for a box that works at all.
    const parsed = spawnSync('bash', ['-n', sh], { encoding: 'utf8' });
    expect(parsed.stderr).toBe('');
    expect(parsed.status).toBe(0);
    expect(statSync(sh).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(/^install: accounts\.sh: generated from \$HOME\/\.ccrc\/accounts\.json$/m);
  });

  it('writes ccrc.env for a single box: local fleet mode, localhost, this HOME', () => {
    const home = freshBox('ccrc-install-fresh-env-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const env = read(dotCcrc(home, 'ccrc.env'));
    expect(env).toMatch(/^CCRC_FLEET=local$/m);
    expect(env).toMatch(/^CCRC_HOST=127\.0\.0\.1$/m);
    expect(env).toMatch(/^CCRC_PORT=7788$/m);
    // Expanded at WRITE time, not left as a `$HOME` this file's readers would
    // have to expand: `_box_env_value` reads values literally and the server
    // reads this file through systemd's `EnvironmentFile=`, which does no
    // shell expansion at all.
    expect(env).toMatch(new RegExp(`^CCRC_PROJECTS_ROOT=${home}/projects$`, 'm'));
    // …and it points at the file that documents the keys it does NOT carry
    // (the tokens), rather than shipping them empty here.
    expect(env).toMatch(/deploy\/ccrc\.env\.example/);
    expect(r.stdout).toMatch(/^install: ccrc\.env: written \(localhost, local fleet mode\)$/m);
  });

  it('names the box and the tree — the two things it measured — before it changes anything', () => {
    // The two inputs every step is computed from. A run under the wrong HOME
    // (sudo) or out of the wrong tree (a stale `~/ccrc` rather than the
    // checkout just edited) SUCCEEDS at the wrong thing, so both are stated in
    // the transcript rather than deduced from the result.
    //
    // BOTH LINES ARE PINNED WHOLE, because the banner is the one thing here
    // that prints without deciding anything, and a printer nothing can go red
    // for is a comment. Measured: deleting the `tree` line, and garbling the
    // `box` line's format string, each turn this test red on its own.
    const home = freshBox('ccrc-install-banner-');
    const r = runInstall(home);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe(`install: box: ${home}`);
    expect(lines[1]).toBe(`install: tree: ${treeRoot(home)}`);
    // …and it CLAIMS nothing. The banner used to end "— single-box, local fleet
    // mode on localhost", asserted before a byte had been read; the arm in
    // `the files the operator owns` below is the box where that is false.
    expect(lines[0]).not.toMatch(/fleet mode|localhost|127\.0\.0\.1/);
  });

  it('finishes clean: exit 0, nothing on stderr, no temp files left behind', () => {
    const home = freshBox('ccrc-install-clean-');
    const r = runInstall(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(strays(home)).toEqual([]);
  });
});

describe('ccrc install: the files the operator owns', () => {
  // The rule `deploy/deploy.sh:196-206` states and this verb inherits:
  // `accounts.json` and `ccrc.env` are created once and never overwritten.
  // Everything in this describe is one half of that.
  it('keeps a roster the box already had, and generates accounts.sh FROM IT', () => {
    // The five-account roster this fleet really runs. `claude-corp` appears in
    // it and in nothing the seed could produce, so its presence in the
    // generated bash is proof the generator read the INSTALLED roster rather
    // than the shipped default — the local translation of deploy's
    // read-the-box's-copy-back rule.
    const home = freshBox('ccrc-install-kept-roster-');
    preexisting(home, 'accounts.json', MIGRATION_ROSTER);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(MIGRATION_ROSTER);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-corp');
    expect(r.stdout).toMatch(/^install: roster: kept \(user-owned, never overwritten\)$/m);
  });

  it('keeps a ccrc.env the operator wrote, byte for byte', () => {
    // A real one carries tokens. Overwriting it — or "merging" into it — would
    // be this verb's most damaging possible bug, so the assertion is on the
    // whole file's bytes rather than on the keys it happens to name.
    const home = freshBox('ccrc-install-kept-env-');
    const mine = [
      '# my box, my rules',
      'CCRC_FLEET=remote',
      'CCRC_HOST=203.0.113.7',
      'CCRC_PORT=9999',
      'CCRC_AGENT_TOKEN=not-a-real-token-but-it-is-mine',
      '',
    ].join('\n');
    preexisting(home, 'ccrc.env', mine);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'ccrc.env'))).toBe(mine);
    expect(r.stdout).toMatch(/^install: ccrc\.env: kept \(user-owned, never overwritten\)$/m);
    // …and the transcript does not tell this operator their box is in local
    // fleet mode on localhost, which is what the banner used to assert
    // unconditionally (round-1 review, Minor 2). This box says `remote`, the
    // run kept that file, and nothing in the run established otherwise: a
    // transcript that claimed it would be describing a box nobody has.
    expect(r.stdout).not.toMatch(/local fleet mode|localhost/);
  });
});

describe('ccrc install: a roster that does not validate', () => {
  // "Validate before you mutate" in both directions: the roster the box HAS
  // and the seed the tree SHIPS. A box seeded with an unusable roster is
  // poisoned permanently — the very rule that makes the file safe to own
  // (never overwritten) is what stops the next run from repairing it.
  const BROKEN = '{"version":1,"accounts":[]}';

  it('refuses, passes the generator\'s own remedy through, and writes nothing', () => {
    const home = freshBox('ccrc-install-bad-roster-');
    preexisting(home, 'accounts.json', BROKEN);
    const r = runInstall(home);
    expect(r.code).toBe(1);
    // The generator's diagnosis reaches the operator VERBATIM, remedy line and
    // all, because `_inst_accounts_sh` captures stdout only. Re-wording it here
    // would replace a fix with a shrug.
    expect(r.stderr).toMatch(/^gen-accounts: remedy: Add at least one account/m);
    expect(r.stderr).toMatch(/^ccrc: \$HOME\/\.ccrc\/accounts\.json does not validate/m);
    // NOTHING else was written: not the bash projection of a roster that does
    // not parse, and not the env file two steps later. An install that half-ran
    // leaves a box in a state no one designed.
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(BROKEN);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'ccrc.env'))).toBe(false);
    expect(strays(home)).toEqual([]);
  });

  it('refuses to SEED a shipped seed that does not validate — before it lands', () => {
    // The tree's own seed, corrupted. This is `deploy.sh`'s `check_local_roster`
    // (F1) translated to one box, and the assertion that matters is the
    // ORDERING one: `accounts.json` must not exist afterwards. Placing it and
    // discovering the problem one step later would leave exactly the permanent
    // poisoning the check exists to prevent.
    const home = freshBox('ccrc-install-bad-seed-');
    writeFileSync(treeFile(home, 'deploy/accounts.default.json'), '{"version":1,"accounts":[]}');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    // FIRST, and before the message: with the validation call deleted the run
    // still exits 1 (the generator refuses one step later, on the same bytes),
    // so an assertion order that checked the wording first would report the
    // mutation as a message change rather than as the permanent-poisoning bug
    // it is. Measured: this line is what goes red.
    expect(existsSync(dotCcrc(home, 'accounts.json')),
      'the seed was placed before it was validated').toBe(false);
    expect(r.stderr).toMatch(/^ccrc: the shipped roster seed does not validate/m);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(strays(home)).toEqual([]);
  });

  it('refuses by NAME when the tree has no seed at all', () => {
    // "Run install from inside the shipped tree" is a different instruction
    // from "your roster is broken", and an operator who ran `ccrc install` off
    // a half-copied directory needs the first one.
    const home = freshBox('ccrc-install-no-seed-');
    rmSync(treeFile(home, 'deploy/accounts.default.json'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: no roster seed at .*deploy\/accounts\.default\.json — run install from inside the shipped tree$/m);
    expect(existsSync(dotCcrc(home, 'accounts.json'))).toBe(false);
  });
});

describe('ccrc install: a box with no node', () => {
  // Round-1 review, Important 1. `install` is the ONE verb an operator runs on
  // a box that may genuinely not have node yet — and every roster step runs
  // `deploy/gen-accounts.mjs`, which IS node. Without a by-name probe the
  // interpreter's absence arrives as the generator "failing", i.e. as "your
  // config does not validate": a missing DEPENDENCY and a corrupt FILE
  // collapsed into one signal, which is the overloaded-seam mistake this
  // file's own header bans and which `cmd_wrappers` (ccd/ccrc:1080-1086)
  // already refuses in exactly this shape, ten lines up.
  it('refuses by name, before touching anything, and does not blame the config', () => {
    const home = freshBox('ccrc-install-no-node-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: node is required by 'ccrc install'/m);
    // The half that matters: nothing in the refusal points at the operator's
    // config. "does not validate" sends someone to debug a file that is fine.
    expect(r.stderr).not.toMatch(/does not validate/);
    expect(r.stderr).not.toMatch(/roster/);
    // …and it fires BEFORE the first step, so the run has neither printed a
    // transcript it is not going to finish nor created `~/.ccrc`.
    expect(r.stdout).toBe('');
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });

  it('never tells the operator to move a roster they already have aside', () => {
    // The sharper half of the same finding: on an already-seeded box the
    // collapsed message read "$HOME/.ccrc/accounts.json does not validate — fix
    // it (or move it aside to reseed) and re-run" — a confident instruction to
    // disturb USER-OWNED config for a cause that has nothing to do with it.
    // The roster here is the five-account one this fleet really runs, and it is
    // perfectly valid.
    const home = freshBox('ccrc-install-no-node-seeded-');
    preexisting(home, 'accounts.json', MIGRATION_ROSTER);
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).not.toMatch(/move it aside/);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(MIGRATION_ROSTER);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'ccrc.env'))).toBe(false);
  });
});

describe('ccrc install: re-running converges', () => {
  it('leaves the two seeded files alone and does not rewrite accounts.sh', () => {
    // Idempotence measured on MTIME, not on bytes: "the file still says the
    // right thing" is satisfied by a step that rewrites it every run, and a
    // converger that rewrites what it did not change is one an operator cannot
    // use to see what a run actually did. `_inst_accounts_sh` generates into a
    // variable and compares before it writes; this is the assertion that says
    // so.
    const home = freshBox('ccrc-install-idempotent-');
    expect(runInstall(home).code).toBe(0);
    const before = {
      roster: read(dotCcrc(home, 'accounts.json')),
      env: read(dotCcrc(home, 'ccrc.env')),
      shMtime: mtime(dotCcrc(home, 'accounts.sh')),
      sh: read(dotCcrc(home, 'accounts.sh')),
    };
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(before.roster);
    expect(read(dotCcrc(home, 'ccrc.env'))).toBe(before.env);
    expect(read(dotCcrc(home, 'accounts.sh'))).toBe(before.sh);
    expect(mtime(dotCcrc(home, 'accounts.sh'))).toBe(before.shMtime);
    expect(r.stdout).toMatch(/^install: accounts\.sh: converged$/m);
    expect(strays(home)).toEqual([]);
  });

  it('DOES rewrite accounts.sh when the operator has edited the roster', () => {
    // The other half, and the reason the mtime assertion above is not simply
    // "this step never writes": a roster the operator changed between runs
    // must reach the bash projection `ccd` sources, or the box would run on a
    // roster nobody has any more.
    const home = freshBox('ccrc-install-regenerate-');
    expect(runInstall(home).code).toBe(0);
    const before = mtime(dotCcrc(home, 'accounts.sh'));
    writeFileSync(dotCcrc(home, 'accounts.json'), MIGRATION_ROSTER);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-corp');
    expect(mtime(dotCcrc(home, 'accounts.sh'))).not.toBe(before);
    expect(r.stdout).toMatch(/^install: accounts\.sh: generated from \$HOME\/\.ccrc\/accounts\.json$/m);
  });
});

describe('ccrc install: the env file is named once in the whole CLI', () => {
  it('install writes the file status and doctor read — through BOX_ENV_FILE', () => {
    // D-88. `ccd/ccrc:91-101` spells `~/.ccrc/ccrc.env` exactly once and says
    // why: "three copies of a path is how two of them end up reading a file the
    // third does not write." Task 6 made this file the WRITER as well as a
    // reader, so that sentence acquired a subject — and a second spelling in
    // `_inst_env` is precisely the drift it warns about. Text-scanned, in the
    // shape `single-definition.test.ts` uses for the build stamp: prose may
    // discuss the path anywhere, but a LINE OF SHELL that names it may exist
    // only once.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => l.includes('.ccrc/ccrc.env'))).toEqual([
      'BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"',
    ]);
    // …and the writer really goes through it, rather than merely not spelling
    // the path (which deleting the step would also satisfy).
    const body = /_inst_env\(\)[\s\S]*?\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _inst_env').toBeTruthy();
    expect(body![0]).toContain('BOX_ENV_FILE');
  });
});

describe('ccrc install: the executables and files it installs', () => {
  // Every one of these is an artifact the fleet host RUNS and that no
  // installer placed before stage 1 (`deploy.sh:381-387`'s own note). They
  // divide into two kinds and the division is what `_inst_atomic` is for:
  //   - COPIES of a file in the tree (`ccd`, the cap-scopes enforcer, the two
  //     session hooks, notify, tmux.conf, the statusline), and
  //   - one GENERATED file, the launcher, whose bytes are pinned to the
  //     generator in deploy.sh (see its own test below).
  // `install_atomic`'s reasoning applies unchanged to all of them: bash
  // executes a script lazily from a saved byte offset, so overwriting the
  // inode of a script a process is running makes that process resume inside
  // the new bytes at the old offset. Every one lands by rename.

  /** One install onto a fresh box, shared by the read-only assertions below.
   *  Run at `umask 077`, which is what makes a mode assertion mean anything:
   *  at the ordinary 022 a plain `cp` reproduces the source's 0755 all by
   *  itself and the `chmod` could be deleted unnoticed (round-1 review, Minor
   *  1, measured on `_inst_accounts_sh`). At 077 the copy is 0700/0600 and any
   *  other mode can only come from the chmod. */
  const installed = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-artifacts-');
    return { home, r: runInstall(home, ['install'], {}, { umask: '077' }) };
  })();
  const mode = (p: string): number => statSync(p).mode & 0o777;

  it('the run this describe measures succeeded', () => {
    expect(installed.r.code, installed.r.stderr).toBe(0);
    expect(installed.r.stdout).toMatch(/^install: bins: /m);
    expect(installed.r.stdout).toMatch(/^install: files: /m);
  });

  it('ccd reaches PATH as an executable byte copy of the tree it was placed from', () => {
    // FROM THE PLACED TREE, not from the checkout. After `_inst_tree` the two
    // are identical, so the assertion cannot tell them apart — but the box's
    // own invariant can: the `ccd` on PATH and the `ccd` inside the tree the
    // launcher execs must be one version, and installing out of `~/ccrc` is
    // what makes that true by construction rather than by both happening to
    // come from the same run.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd');
    expect(existsSync(bin), 'ccd never reached $HOME/.local/bin').toBe(true);
    // `'ccd/ccd'` as ONE segment, deliberately. `single-definition.test.ts`'s
    // extraction guard treats two adjacent quoted `ccd` arguments as a second
    // path to the REPOSITORY's ccd script (which must be reached only through
    // `ccdWsHelpers.ts`). This is a different file — the copy inside a fixture
    // box's `~/ccrc` — so the answer is to not wear that shape, rather than to
    // add this file to the guard's exclusion list and blind it to a real second
    // spelling arriving here later.
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd/ccd')));
    expect(mode(bin)).toBe(0o755);
  });

  it('ccd-cap-scopes lands beside it — the OOM guardrail is an executable too', () => {
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-cap-scopes');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-cap-scopes')));
    expect(mode(bin)).toBe(0o755);
  });

  it('the launcher is BYTE FOR BYTE what deploy.sh generates', () => {
    // THE AGREEMENT PIN. The launcher now has two generators — `deploy.sh`'s
    // `install_ccrc_shim` for a box reached over ssh, and `_inst_shim` for a
    // box installing itself — and two generators of one artifact is a drift
    // waiting to happen: a box whose launcher came from the older of them
    // fails in a way neither generator's own tests can see. Extract deploy's
    // heredoc (the mechanics `agent/test/deploy-verify.test.ts:1470-1496`
    // uses) and compare it to the bytes THIS verb actually installed.
    //
    // It also means the behaviour tests deploy-verify already runs against
    // those bytes — argv forwarded, exit code passed through, a by-name
    // refusal when `~/ccrc/ccd/ccrc` is gone — hold for this copy without
    // being written twice.
    const deploySh = read(join(REPO, 'deploy', 'deploy.sh'));
    const fn = /install_ccrc_shim\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no install_ccrc_shim() helper').toBeTruthy();
    const heredoc = /<<'CCRC_SHIM'\n([\s\S]*?)\nCCRC_SHIM\n/.exec(fn![1]!);
    expect(heredoc, 'install_ccrc_shim does not generate the shim from a quoted heredoc')
      .toBeTruthy();

    const { home } = installed;
    const shim = join(home, '.local', 'bin', 'ccrc');
    expect(existsSync(shim), 'no ccrc launcher reached $HOME/.local/bin').toBe(true);
    expect(read(shim)).toBe(`${heredoc![1]!}\n`);
    expect(mode(shim)).toBe(0o755);
  });

  it('the installed launcher runs the shipped ccrc', () => {
    // Extracted-and-compared is not the same as works: the bytes could agree
    // and still be a launcher pointing at a tree this verb never placed. Run
    // it against the fixture HOME and let it answer.
    const { home } = installed;
    const r = spawnSync(BASH, [join(home, '.local', 'bin', 'ccrc'), 'version'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status, 'the launcher did not reach the shipped ccrc').toBe(0);
    expect(r.stdout).toMatch(/^ccrc /);
  });

  it('the session hooks, notify and the tmux/statusline config land at their modes', () => {
    // The four artifacts stage 1 found the fleet host RUNNING with nothing
    // installing them, plus the hooks installer that converges settings.json.
    // `statusline-command.sh` is the sharp mode case: it is 0644 in the
    // repository and must be 0755 on the box, so a copy that preserved the
    // source mode (or a missing chmod) produces a statusline that never runs
    // and a box that silently writes no `~/.cc-limits` telemetry.
    const { home } = installed;
    const cases: Array<[string, string, number]> = [
      [join(home, '.cc-sessions', 'session-hook.sh'), placed(home, 'ccd', 'session-hook.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-session-hooks.sh'),
        placed(home, 'ccd', 'install-session-hooks.sh'), 0o755],
      [join(home, '.cc-sessions', 'notify.sh'), placed(home, 'deploy', 'notify.sh'), 0o755],
      [join(home, '.tmux.conf'), placed(home, 'ccd', 'tmux.conf'), 0o644],
      [join(home, '.claude', 'statusline-command.sh'),
        placed(home, 'ccd', 'statusline-command.sh'), 0o755],
    ];
    for (const [dest, src, want] of cases) {
      expect(existsSync(dest), `${dest} was never installed`).toBe(true);
      expect(readFileSync(dest), `${dest} is not the shipped file`).toEqual(readFileSync(src));
      expect(mode(dest), `${dest} has the wrong mode`).toBe(want);
    }
  });

  it('a second run rewrites none of them, and leaves no temp file behind', () => {
    // Idempotence measured on MTIME, for `_inst_accounts_sh`'s reason: "the
    // file still says the right thing" is satisfied by a step that rewrites it
    // every run, and a converger that rewrites what it did not change is one
    // an operator cannot use to see what a run actually did. `_inst_atomic`
    // compares bytes before it stages anything; this is the assertion that
    // says so.
    const home = freshBox('ccrc-install-artifacts-idem-');
    expect(runInstall(home).code).toBe(0);
    const targets = [
      join(home, '.local', 'bin', 'ccd'),
      join(home, '.local', 'bin', 'ccd-cap-scopes'),
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      join(home, '.tmux.conf'),
      join(home, '.claude', 'statusline-command.sh'),
    ];
    const before = targets.map(mtime);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(targets.map(mtime)).toEqual(before);
    expect(strays(home)).toEqual([]);
  });

  it('repairs a mode someone changed — without rewriting the file', () => {
    // The other half of the byte-compare skip, and the reason it is a `chmod`
    // rather than an early `return`: a `ccd` an operator (or a bad copy) left
    // at 0600 is a box where every session supervisor gets EACCES, and bytes
    // that already match must not make the converger blind to it. `chmod`
    // moves ctime, never mtime, so repairing costs nothing the assertion above
    // measures.
    const home = freshBox('ccrc-install-mode-repair-');
    expect(runInstall(home).code).toBe(0);
    const bin = join(home, '.local', 'bin', 'ccd');
    chmodSync(bin, 0o600);
    const was = mtime(bin);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(mode(bin), 'a mode nobody repaired').toBe(0o755);
    expect(mtime(bin), 'the file was rewritten to fix a mode').toBe(was);
  });

  it('keeps a personal ~/.tmux.conf aside before replacing it', () => {
    // The two files this verb installs into the OPERATOR's namespace rather
    // than into ccrc's own (`~/.tmux.conf`, `~/.claude/statusline-command.sh`)
    // may already be somebody's, written years before ccrc arrived. deploy.sh
    // overwrites both without asking because it runs against a box that is,
    // by definition, a fleet host; `ccrc install` runs against whatever
    // machine an operator typed it on. So the file that is about to be
    // replaced is copied aside first — `cmd_wrappers`' rule, and the same
    // naming shape, so the copy is never mistaken for something ccrc manages.
    const home = freshBox('ccrc-install-personal-');
    writeFileSync(join(home, '.tmux.conf'), '# mine, from 2019\nset -g mouse on\n');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'statusline-command.sh'), '#!/bin/sh\necho mine\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const saved = readdirSync(home).filter((f) => f.startsWith('.tmux.conf.pre-ccrc-'));
    expect(saved.length, 'the operator tmux.conf was replaced without a copy').toBe(1);
    expect(read(join(home, saved[0]!))).toBe('# mine, from 2019\nset -g mouse on\n');
    const savedStatus = readdirSync(join(home, '.claude'))
      .filter((f) => f.startsWith('statusline-command.sh.pre-ccrc-'));
    expect(savedStatus.length).toBe(1);
    // …and the shipped ones did land: keeping a copy is not declining to converge.
    expect(readFileSync(join(home, '.tmux.conf')))
      .toEqual(readFileSync(placed(home, 'ccd', 'tmux.conf')));
    expect(r.stdout).toMatch(/^install: files: kept .*\.tmux\.conf\.pre-ccrc-/m);
  });

  it('a second run makes no second copy — the file it would save is its own', () => {
    const home = freshBox('ccrc-install-personal-idem-');
    writeFileSync(join(home, '.tmux.conf'), '# mine\n');
    expect(runInstall(home).code).toBe(0);
    expect(runInstall(home).code).toBe(0);
    expect(readdirSync(home).filter((f) => f.startsWith('.tmux.conf.pre-ccrc-')).length).toBe(1);
  });
});

describe('ccrc install: the order is stated in one place', () => {
  it('cmd_install is the sequence, and the roster precedes the ccd it installs', () => {
    // `ccd` refuses to run AT ALL without `~/.ccrc/accounts.sh` — its own
    // `|| die`, on every invocation — so an install that put `ccd` on PATH
    // before the roster projection existed would leave a box whose every ccd
    // command dies, for exactly as long as the gap. That is `deploy.sh:348-353`'s
    // "THE ROSTER LANDS BEFORE ccd" rule, and it is the reason `cmd_install`
    // is a fixed sequence rather than a set of steps.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no cmd_install').toBeTruthy();
    const steps = body![1]!.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^_inst_[a-z_]+$/.test(l));
    expect(steps).toEqual([
      '_inst_banner',
      '_inst_roster',
      '_inst_accounts_sh',
      '_inst_env',
      '_inst_tree',
      '_inst_bins',
      '_inst_files',
      '_inst_stamp',
    ]);
  });
});

describe('ccrc install: the build stamp', () => {
  // `~/.ccrc/build.json` is what a box SAYS it is running, and `ccrc version`
  // and `ccrc status` both read it. Until this task the only writer was
  // `deploy.sh`'s `stamp_build`, so a box installed by `ccrc install` reported
  // "unstamped" for ever — honest, and useless: a self-installed box could not
  // answer the one question every incident starts with.
  //
  // The same measurement-forgery rule deploy's own header states applies here:
  // a dirty tree may install, but the stamp SAYS dirty. A clean sha nobody
  // measured is the class this repo bans by name.
  const stampOf = (home: string): Record<string, unknown> =>
    JSON.parse(read(dotCcrc(home, 'build.json'))) as Record<string, unknown>;

  it('stamps the box with the sha, ref and cleanliness of the checkout it installed from', () => {
    const home = freshBox('ccrc-install-stamp-');
    const sha = gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], {}, { umask: '077' });
    expect(r.code, r.stderr).toBe(0);
    const stamp = stampOf(home);
    expect(stamp['sha']).toBe(sha);
    expect(stamp['ref']).toBe('fixture-branch');
    expect(stamp['dirty']).toBe(false);
    expect(stamp['builtAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // 0644 like deploy's, and asserted under a hostile umask so the mode can
    // only have come from a chmod — at 077 a plain redirect makes it 0600.
    expect(statSync(dotCcrc(home, 'build.json')).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(new RegExp(`^install: stamp: ${sha}`, 'm'));
  });

  it('says dirty when the checkout has uncommitted work', () => {
    const home = freshBox('ccrc-install-stamp-dirty-');
    gitInit(treeRoot(home));
    writeFileSync(treeFile(home, 'ccd/tmux.conf'),
      `${read(treeFile(home, 'ccd/tmux.conf'))}# edited after the commit\n`);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(stampOf(home)['dirty'], 'a dirty checkout stamped clean').toBe(true);
    expect(r.stdout).toMatch(/^install: stamp: [0-9a-f]{40} \(fixture-branch, dirty\)$/m);
  });

  it('skips — and says what that costs — when the tree is not a git checkout', () => {
    // The ordinary state of a DEPLOYED box: `~/ccrc` is an rsync of a tree,
    // never a repository (`deploy.sh:75-81` says so), so a re-install there has
    // nothing to measure. Skipping is the honest answer; inventing a sha, or
    // carrying the previous one forward, is the forgery. The line names the
    // consequence so an operator who later reads "unstamped" knows why.
    //
    // THE CAUSE IS GIT'S OWN SENTENCE, not this file's guess about it (fix
    // round 1, Important 1). In this arm the two agree — git says "not a git
    // repository" and it is not one — but that agreement is a fact of THIS
    // fixture, and the two arms below are where a single hand-written sentence
    // starts lying.
    const home = freshBox('ccrc-install-stamp-nogit-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(git rev-parse HEAD exited 128: .*not a git repository.*\) — ccrc version will say unstamped$/m);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
  });

  it('does not call a real checkout "not a git checkout" when git REFUSES it', () => {
    // FIX ROUND 1, IMPORTANT 1 — measured by the reviewer, reproduced here.
    // `detected dubious ownership` is git exiting 128 on a repository that IS
    // one: a clone owned by another user, or the same clone reached under
    // sudo. The old arm answered "not a git checkout", which sends the
    // operator to look for a repository that is right in front of them while
    // the box goes on reporting `unstamped` for ever — the exact condition
    // this step exists to end.
    const home = freshBox('ccrc-install-stamp-refused-');
    gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        git: '#!/bin/sh\n'
          + 'echo "fatal: detected dubious ownership in repository at \'/home/other/ccrc\'" >&2\n'
          + 'exit 128\n',
      },
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, 'the skip still claims a cause it did not measure')
      .not.toMatch(/not a git checkout/);
    expect(r.stdout).toMatch(/^install: stamp: skipped \(git rev-parse HEAD exited 128: fatal: detected dubious ownership in repository at '\/home\/other\/ccrc'\) — ccrc version will say unstamped$/m);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
  });

  it('says GIT IS ABSENT when git is absent — a different sentence again', () => {
    // The third cause the one sentence used to cover. "not a git checkout"
    // sends an operator to inspect a directory; `apt install git` is the fix.
    // Same rule as `cmd_install`'s own node probe (round-1 review, Important
    // 1): a missing DEPENDENCY and a fact about the tree are two conditions an
    // operator acts on completely differently.
    const home = freshBox('ccrc-install-stamp-gitless-');
    gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'git') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(no git on PATH\) — ccrc version will say unstamped$/m);
    expect(r.stdout).not.toMatch(/not a git checkout/);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
  });

  it('never echoes raw control bytes out of git', () => {
    // Passing a foreign tool's stderr through is only safe if what reaches the
    // terminal cannot MOVE THE CURSOR: `_box_build_fields:264-267` rejects a
    // stamp field carrying a control byte for exactly this reason ("a
    // backspace would let the printed sha lie on a terminal"). Same rule
    // here, one register over — and the line is truncated, because a git that
    // writes a megabyte of stderr must not become the install transcript.
    const home = freshBox('ccrc-install-stamp-cntrl-');
    gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        git: '#!/bin/sh\nprintf \'fatal: \\033[31mred\\010\\010\\010nope\\r and more\\n'
          + 'second line nobody asked for\\n\' >&2\nexit 128\n',
      },
    });
    expect(r.code, r.stderr).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('install: stamp:'))!;
    expect(line, 'a control byte reached the transcript')
      .not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(line, 'git\'s second line rode along').not.toContain('second line nobody asked for');
    expect(line).toContain('fatal:');
  });

  it('and `ccrc version` on the installed box reads exactly what it wrote', () => {
    // The cross-verb proof, run through the launcher this same install put on
    // PATH: one writer, one reader, one box. A stamp only this suite can parse
    // would be a file, not a fact.
    const home = freshBox('ccrc-install-stamp-version-');
    const sha = gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const r = spawnSync(BASH, [join(home, '.local', 'bin', 'ccrc'), 'version'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(sha);
    expect(r.stdout).toContain('fixture-branch');
  });

  it('writes the stamp through BOX_STAMP_FILE — the path is spelled once', () => {
    // D-88's rule, applied to the file this task turns into a written one.
    // `single-definition.test.ts` already pins that `$HOME/.ccrc/build.json`
    // appears in exactly one line of shell in this file; this is the other
    // half — that the new WRITER goes through that line rather than merely not
    // duplicating it (which deleting the step would also satisfy).
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /_inst_stamp\(\)[\s\S]*?\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _inst_stamp').toBeTruthy();
    expect(body![0]).toContain('BOX_STAMP_FILE');
    // Comment lines dropped, `single-definition.test.ts`'s own rule: the step's
    // prose is where the reasoning lives and may name the file freely; only a
    // LINE OF SHELL that names it is a second spelling.
    expect(body![0].split('\n').filter((l) => !l.trim().startsWith('#'))
      .filter((l) => l.includes('.ccrc/build.json')),
    'the stamp path is spelled out in a line of shell inside _inst_stamp').toEqual([]);
  });
});
