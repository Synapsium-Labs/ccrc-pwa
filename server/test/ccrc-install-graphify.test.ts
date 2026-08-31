// `ccrc install` — the graphify engine step (`_inst_graphify_engine`). This
// file mirrors `ccrc-install.test.ts`'s fixture idiom (freshBox / ccrcEnv /
// runInstall / installFixtureTree / healthyDoctorBox) rather than importing
// it: that file's helpers are not exported (only `installFixtureTree` is),
// and importing a sibling `.test.ts` module for its side-effecting
// `describe()` blocks would register that whole suite a second time. The
// copy is deliberate, not drift — see that file's own header comment for the
// full reasoning behind each piece copied below.
//
// HOME is a throwaway `mkTmp` directory in every test, exactly as in
// `ccrc-install.test.ts`: this verb writes `~/.ccrc/*` and, as of this task,
// `~/.ccrc/graphify-venv/` and `~/.ccrc/graphify.pin`. Nothing here may ever
// run against a real $HOME.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync,
  chmodSync, readdirSync, rmSync,
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

const BASH = realPath('bash');
const RSYNC = realPath('rsync');

/** Same list `ccrc-install.test.ts` builds its fixture tree from — copied
 *  rather than imported for the reason at the top of this file. Grows only
 *  in step with that file's own list. */
const TREE_FILES = [
  'ccd/ccrc',
  'ccd/ccrc-doctor-checks',
  'ccd/ccrc-wrapper-shape',
  'ccd/ccrc-adopt',
  'deploy/gen-accounts.mjs',
  'deploy/gen-wrappers.mjs',
  'deploy/accounts.default.json',
  'shared/generate.mjs',
  'shared/mark.mjs',
  'shared/roster-json.mjs',
  'shared/wrapper.mjs',
  'server/package.json',
  'agent/package.json',
  'ccd/ccd',
  'ccd/ccd-cap-scopes',
  // graphify Task 10 (O3/O6b): the fourth `_inst_bins` executable.
  'ccd/ccd-graph-sweep',
  'ccd/session-hook.sh',
  'ccd/install-session-hooks.sh',
  'ccd/tmux.conf',
  'ccd/statusline-command.sh',
  'deploy/notify.sh',
  'deploy/systemd',
  'deploy/ccrc.service',
  'ccd/claude-session@.service',
  'deploy/verify-service.sh',
  'deploy/ccrc-agent.service',
  'deploy/gen-auth-hash.mjs',
  'ccd/coordinator-skill',
  'ccd/worker-skill',
  'ccd/install-coordinator-skill.sh',
  'ccd/install-worker-skill.sh',
  // graphify Task 3: `_inst_graphify_skill` stages this beside the other two,
  // right after `_inst_skills`, through the same `_inst_atomic`. Without it
  // in the fixture tree every test in this file (all of which run the full
  // spine on a role other than `server`) dies at that step.
  'ccd/install-graphify-skill.sh',
];

const TREE_STUBS: Record<string, string> = {
  'server/dist/server/src/index.js': '// fixture: stands in for the built server\n',
  // D-1159: `ccrc install` preflights the agent build for every role but
  // `server`, and every test in this file installs a fleet-capable box.
  'agent/dist/agent/src/index.js': '// fixture: stands in for the built agent\n',
  'server/dist-pwa/index.html': '<!doctype html><title>fixture PWA</title>\n',
};

const treeRoot = (home: string): string => join(home, 'checkout');
const ccrcIn = (root: string): string => join(root, 'ccd', 'ccrc');

function installFixtureTree(home: string, sub = 'checkout'): string {
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

/** `ccrc-install.test.ts`'s `healthyDoctorBox`, copied: the stub shapes a
 *  fresh box needs so the install's closing `ccrc doctor` passes. Graphify's
 *  own fixture (`plantFakeVenv`, below) is planted separately by each test —
 *  this function stays scoped to what doctor measures, exactly as its
 *  original does. */
function healthyDoctorBox(home: string): void {
  const d = join(home, 'doctor-stubs');
  mkdirSync(d, { recursive: true });
  const stub = (name: string, body: string): void =>
    writeFileSync(join(d, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  stub('tmux', [
    'if [ "$1" = "-V" ]; then echo "tmux 9.9"; exit 0; fi',
    'if [ "$1" = "display-message" ]; then echo "9.9"; exit 0; fi',
    'echo "fixture tmux: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));

  stub('gh', [
    'printf \'%s\\n\' "$*" >> "$HOME/gh-calls"',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
    '  echo "github.com" >&2',
    '  echo "  - Logged in to github.com account fixture-bot (keyring)" >&2',
    '  echo "  - Token: gho_************************************" >&2',
    '  echo "  - Token scopes: \'gist\', \'read:org\', \'repo\', \'workflow\'" >&2',
    '  exit 0',
    'fi',
    'echo "fixture gh: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));

  stub('curl', [
    'printf \'%s\\n\' "$*" >> "$HOME/curl-calls"',
    'url=; for a in "$@"; do url="$a"; done',
    'case "$url" in',
    '  */api/fleet/health*) ;;',
    '  */health*)',
    '    sha=',
    '    [ -f "$HOME/.ccrc/build.json" ] && sha="$(jq -r .sha "$HOME/.ccrc/build.json" 2>/dev/null)"',
    '    printf \'{"ok":true,"build":{"sha":"%s","ref":"fixture","builtAt":"fixture","dirty":false}}\\n200\' "$sha"',
    '    exit 0 ;;',
    'esac',
    'body=\'{"mode":"local","connected":true,"downSince":null,"build":"agreed","roster":"agreed"}\'',
    '[ -f "$HOME/fixture-health-body" ] && IFS= read -r body < "$HOME/fixture-health-body"',
    'code=200',
    '[ -f "$HOME/fixture-health-code" ] && IFS= read -r code < "$HOME/fixture-health-code"',
    'printf \'%s\\n%s\' "$body" "$code"',
  ].join('\n'));

  stub('df', [
    'printf \'%s\\n\' "$*" >> "$HOME/df-calls"',
    '[ "$1" = "-Pk" ] && [ -n "$2" ] || { echo "fixture df: unexpected argv: $*" >&2; exit 90; }',
    'echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    'echo "/dev/fixture0    104857600  20971520 42991616      21% /"',
  ].join('\n'));

  writeFileSync(join(home, '.gitconfig'),
    '[user]\n\tname = ccrc fixture\n\temail = fixture@example.invalid\n');

  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'claude'),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
}

/** A box with a shipped tree and nothing else — `ccrc-install.test.ts`'s
 *  `freshBox`, copied. */
function freshBox(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  healthyDoctorBox(home);
  return home;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc-install.test.ts`'s `ccrcEnv`, copied unchanged. */
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
  poison('journalctl', 'ccrc tests must never read this box\'s real journal');
  plant('systemctl', [
    '#!/bin/sh',
    'have=',
    'for f in "$HOME/.config/systemd/user"/* "$HOME/.config/systemd/user"/*/*; do',
    '  [ -e "$f" ] || continue',
    '  have="$have${have:+,}${f##*/.config/systemd/user/}"',
    'done',
    'printf \'%s\\t%s\\n\' "$*" "$have" >> "$HOME/systemctl-calls"',
    '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    'case "$1" in',
    '  daemon-reload) exit 0 ;;',
    '  enable)',
    '    [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    if [ -f "$HOME/fixture-enable-fail" ]; then',
    '      IFS= read -r bad < "$HOME/fixture-enable-fail"',
    '      [ "$3" = "$bad" ] && { echo "Failed to enable unit $3: fixture" >&2; exit 1; }',
    '    fi',
    '    exit 0 ;;',
    '  restart)',
    '    [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    if [ -f "$HOME/fixture-restart-fail" ]; then',
    '      echo "Job for $2 failed: fixture" >&2; exit 1',
    '    fi',
    '    exit 0 ;;',
    '  is-active)',
    '    f="$HOME/fixture-unit-$2"',
    '    if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; [ "$v" = active ] && exit 0; exit 3; fi',
    '    echo active; exit 0 ;;',
    '  show)',
    '    [ "$2" = "-p" ] && [ "$3" = "MainPID" ] && [ "$4" = "--value" ] \\',
    '      || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    p=4242',
    '    if [ -f "$HOME/fixture-mainpid-drift" ]; then',
    '      n=0; [ -f "$HOME/fixture-mainpid-seen" ] && IFS= read -r n < "$HOME/fixture-mainpid-seen"',
    '      n=$((n + 1)); printf \'%s\\n\' "$n" > "$HOME/fixture-mainpid-seen"; p="42$n"',
    '    fi',
    '    echo "$p"; exit 0 ;;',
    '  status) echo "fixture systemctl status: $*"; exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  // Darwin stubs, copied verbatim from ccrc-install.test.ts's ccrcEnv (the
  // macos lane landed on main after this suite forked the helper; without
  // these the install dies at _inst_enable_darwin's launchctl bootstrap
  // BEFORE the graphify steps this suite exists to test — measured on the
  // macos CI leg, 7 failures all downstream of that one death).
  // ── systemctl and loginctl: RECORDERS, not poisons (Task 8) ─────────────
  // Both were plain refusals until this task, and both had to change on the
  // same day for the same reason: `ccrc install` now DRIVES them
  // (`_inst_enable` reloads and enables two units, `_inst_linger` enables
  // linger), so a stub that can only exit 97 makes every install fail at step
  // 9 and no assertion below could ever measure the units.
  //
  // The containment is unchanged and is the point: neither stub ever execs the
  // real binary, so this box's systemd and logind are as unreachable as they
  // were behind the refusal. What changed is that they now ANSWER the shapes
  // ccrc asks — and, per `ccrc-doctor.test.ts`'s stub discipline, exit 90 on
  // any argv they do not recognise, so a step that started mutating a unit
  // nobody authorised is a loud failure rather than a silent success.
  //
  // Every call is recorded with WHAT WAS ON DISK when it arrived: the argv,
  // then a tab, then every file under `~/.config/systemd/user`. That second
  // field is what makes "the enables run after every unit file landed" a
  // measurement instead of a hope — the assertion reads the daemon-reload
  // line's own snapshot rather than inferring order from a later `ls`.
  // ── THE LAUNCHD FIXTURE, systemctl's counterpart ────────────────────────
  // Same discipline, same containment: every argv recorded, every shape ccrc
  // asks answered, exit 90 on anything else so a step that started driving a
  // job nobody authorised is loud rather than silently green.
  //
  // IT MATTERS MORE HERE THAN IT DOES FOR systemctl. `$HOME` isolates every
  // other path this suite touches; launchctl ignores it. Without this stub on
  // PATH the platform layer's own guard refuses the call (correctly — that is
  // what stops a test run from registering jobs in the developer's real
  // session), and `_inst_enable`'s Darwin arm then dies by design.
  plant('launchctl', [
    '#!/bin/sh',
    'have=',
    'for f in "$HOME/Library/LaunchAgents"/*; do',
    '  [ -e "$f" ] || continue',
    '  have="$have${have:+,}${f##*/LaunchAgents/}"',
    'done',
    'printf \'%s\\t%s\\n\' "$*" "$have" >> "$HOME/launchctl-calls"',
    'case "$1" in',
    // bootstrap takes a DOMAIN and a plist path; the file must exist, which is
    // the fixture's stand-in for launchd parsing it.
    '  bootstrap)',
    '    [ -n "$2" ] && [ -f "$3" ] || { echo "fixture launchctl: bootstrap: no such job file: $3" >&2; exit 1; }',
    '    if [ -f "$HOME/fixture-bootstrap-fail" ]; then',
    '      echo "Bootstrap failed: fixture" >&2; exit 1',
    '    fi',
    '    printf \'%s\\n\' "${3##*/LaunchAgents/}" >> "$HOME/launchctl-loaded"',
    '    exit 0 ;;',
    '  bootout)',
    '    [ -n "$2" ] || { echo "fixture launchctl: unexpected argv: $*" >&2; exit 90; }',
    '    exit 0 ;;',
    '  enable|disable)',
    '    [ -n "$2" ] || { echo "fixture launchctl: unexpected argv: $*" >&2; exit 90; }',
    '    exit 0 ;;',
    '  kickstart)',
    '    exit 0 ;;',
    // `print` is how `_svc_is_active` and `_svc_is_loaded` read a job. A test
    // with an opinion writes it to fixture-unit-<label>; the default is a job
    // that was bootstrapped and is running, which is what a working box
    // answers right after `_inst_enable`.
    '  print)',
    '    lbl="${2##*/}"',
    '    f="$HOME/fixture-unit-$lbl"',
    '    if [ -f "$f" ]; then IFS= read -r v < "$f"; [ "$v" = active ] || exit 113; fi',
    '    if [ -f "$HOME/launchctl-loaded" ] && grep -q "^$lbl.plist$" "$HOME/launchctl-loaded"; then',
    '      echo "	state = running"',
    // The stay-up gate (`_ccrc_job_stayed_up`) samples `pid = ` twice: the
    // default is one stable pid (a job that stayed up); `fixture-pid-churn`
    // makes every print answer a fresh one — a crash loop as launchd shows
    // it. $((…)) strips wc's BSD padding so the pid is always bare digits.
    '      if [ -f "$HOME/fixture-pid-churn" ]; then',
    '        echo "	pid = $(($(wc -l < "$HOME/launchctl-calls") + 4000))"',
    '      else',
    '        echo "	pid = 4242"',
    '      fi',
    '      exit 0',
    '    fi',
    '    exit 113 ;;',
    '  *) echo "fixture launchctl: unexpected argv: $*" >&2; exit 90 ;;',
    'esac',
  ].join('\n') + '\n');

  // `plutil -lint` guards the generated plist before it is installed. The
  // fixture answers valid so the install proceeds; a test that wants the
  // refusal plants its own.
  plant('plutil', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/plutil-calls"',
    'exit 0',
  ].join('\n') + '\n');
  plant('loginctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/loginctl-calls"',
    'case "$1" in',
    '  enable-linger)',
    '    [ -n "$2" ] || { echo "fixture loginctl: enable-linger with no uid" >&2; exit 90; }',
    '    if [ -f "$HOME/fixture-linger-refuse" ]; then',
    '      echo "Failed to enable linger: Interactive authentication required." >&2; exit 1',
    '    fi',
    '    printf \'yes\\n\' > "$HOME/fixture-linger"; exit 0 ;;',
    '  show-user)',
    '    if [ -f "$HOME/fixture-linger" ]; then',
    '      IFS= read -r v < "$HOME/fixture-linger"; echo "Linger=$v"; exit 0',
    '    fi',
    '    echo "Failed to get user: User ID is not logged in or lingering" >&2; exit 1 ;;',
    'esac',
    'echo "fixture loginctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  plant('npm',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/npm-argv"\n'
    + 'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"\nmkdir -p node_modules\nexit 0\n');
  plant('rsync',
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/rsync-argv"\nexec ${RSYNC} "$@"\n`);
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];
  env['CCRC_VERIFY_SETTLE'] = '0';
  env['CCRC_VERIFY_WINDOW'] = '0';
  // graphify Task 3: skips `install-graphify-skill.sh`'s venv-python PKG
  // resolution, exactly as `ccrc-install.test.ts`'s own `ccrcEnv` now does.
  // `plantFakeVenv` below builds `bin/python` as a fake that logs argv and
  // prints nothing, so the installer's `"$VENV/bin/python" -c 'import
  // graphify…'` would read PKG="" and refuse — a fixture reason, not
  // anything this file's three tests are about.
  const gfxPkg = join(home, 'fixture-graphify-pkg');
  mkdirSync(join(gfxPkg, 'skills', 'claude', 'references'), { recursive: true });
  writeFileSync(join(gfxPkg, 'skill.md'), '# fixture graphify skill\n');
  writeFileSync(join(gfxPkg, 'skills', 'claude', 'references', 'fixture-ref.md'), 'fixture ref\n');
  env['CCRC_GRAPHIFY_PKG'] = gfxPkg;
  return env;
}

/** `ccrc-install.test.ts`'s `replantDoctorStubs`, copied unchanged. */
function replantDoctorStubs(home: string): void {
  const d = join(home, 'doctor-stubs');
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) {
    copyFileSync(join(d, f), join(home, '.local', 'bin', f));
    chmodSync(join(home, '.local', 'bin', f), 0o755);
  }
}

/** `ccrc-install.test.ts`'s `runInstall`, copied unchanged (minus the
 *  `umask`/`from` options this file's tests never reach for). */
function runInstall(home: string, args: string[] = ['install'],
  extraEnv: NodeJS.ProcessEnv = {},
  opts: { omit?: string[]; stubs?: Record<string, string> } = {}): Result {
  const env = { ...ccrcEnv(home, opts.omit ?? []), ...extraEnv };
  replantDoctorStubs(home);
  for (const [name, body] of Object.entries(opts.stubs ?? {})) {
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  }
  const ccrc = ccrcIn(treeRoot(home));
  const r = spawnSync(BASH, [ccrc, ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A PRE-EXISTING `~/.ccrc/graphify-venv/bin/{python,graphify}` — the venv
 *  seam `_inst_graphify_engine` skips `python3 -m venv` for. `python` is a
 *  fake that logs its argv (standing in for `pip install`, since the real
 *  step always execs `$venv/bin/python -m pip install …`) and `graphify` is a
 *  fake that answers `--version` with whatever version this test wants the
 *  venv to already be converged to. */
function plantFakeVenv(home: string, version = '0.9.9'): string {
  const bin = path.join(home, '.ccrc', 'graphify-venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'python'),
    `#!/bin/sh\necho "$@" >> "$HOME/venv-python-calls"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'graphify'),
    `#!/bin/sh\n[ "$1" = --version ] && { echo "graphify ${version}"; exit 0; }\nexit 0\n`,
    { mode: 0o755 });
  return bin;
}

describe('ccrc install: graphify engine step', () => {
  it('installs the pin into the venv and writes the stamp', () => {
    const home = freshBox('ccrc-inst-gfx-');
    plantFakeVenv(home);
    runInstall(home, ['install']);
    const calls = readFileSync(path.join(home, 'venv-python-calls'), 'utf8');
    expect(calls).toContain('-m pip install');
    expect(calls).toContain('graphifyy==0.9.9');
    expect(readFileSync(path.join(home, '.ccrc', 'graphify.pin'), 'utf8')).toBe('0.9.9\n');
  });

  it('dies loudly when the installed version disagrees with the pin', () => {
    const home = freshBox('ccrc-inst-gfx-bad-');
    plantFakeVenv(home, '0.9.50');
    const r = runInstall(home, ['install']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('did not converge');
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-server-');
    plantFakeVenv(home);
    runInstall(home, ['install', '--role', 'server']);
    expect(existsSync(path.join(home, '.ccrc', 'graphify.pin'))).toBe(false);
  });
});

// D-996/D' (graphify Task 4): the install-side half of the exclude writer.
// `makeFixtureRepo` is exported — Task 10 uses it too, for the doctor check
// this same writer is a precondition for.
/** A real, minimal git repo with one commit — real enough for
 *  `_inst_graph_excludes` to walk (it calls `git -C "$d" rev-parse
 *  --is-inside-work-tree` and `--git-common-dir`) and for a worktree to be
 *  added off it. */
export function makeFixtureRepo(home: string, rel: string): string {
  const d = join(home, rel);
  mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d]);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  writeFileSync(join(d, 'a.py'), 'x = 1\n');
  execFileSync('git', ['-C', d, 'add', '.'], { env });
  execFileSync('git', ['-C', d, 'commit', '-qm', 'init'], { env });
  return d;
}

describe('ccrc install: graphify exclude writer (_inst_graph_excludes)', () => {
  it('converges the common-dir exclude for a project AND its worktree, ignored from the worktree', () => {
    const home = freshBox('ccrc-inst-gfx-excl-');
    plantFakeVenv(home);
    const repoA = makeFixtureRepo(home, 'projects/repoA');
    mkdirSync(join(home, 'worktrees', 'repoA'), { recursive: true });
    const ws1 = join(home, 'worktrees', 'repoA', 'ws1');
    execFileSync('git', ['-C', repoA, 'worktree', 'add', ws1, '-b', 'ws1']);

    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: graphify: exclude lines converged \(graphify-out\/, \.graphifyignore; \d+ new\)$/m);

    const excludeFile = join(repoA, '.git', 'info', 'exclude');
    const excl = readFileSync(excludeFile, 'utf8');
    expect(excl).toContain('graphify-out/');
    expect(excl).toContain('.graphifyignore');

    // `graphify-out/` is a directory-only pattern: `check-ignore` (no
    // trailing slash on the query) lstats the path, so the directory has to
    // exist — exactly the state graphify itself leaves a workspace in the
    // first time it runs there. This is the sweep's own precondition gate.
    mkdirSync(join(ws1, 'graphify-out'));
    expect(() => execFileSync('git', ['-C', ws1, 'check-ignore', '-q', 'graphify-out']))
      .not.toThrow();
    rmSync(join(ws1, 'graphify-out'), { recursive: true });

    // A second run converges the same lines, not a second copy of them.
    const first = readFileSync(excludeFile, 'utf8');
    const r2 = runInstall(home, ['install']);
    expect(r2.code, r2.stderr).toBe(0);
    expect(readFileSync(excludeFile, 'utf8')).toBe(first);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-excl-server-');
    plantFakeVenv(home);
    const repoA = makeFixtureRepo(home, 'projects/repoA');
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    const excludeFile = join(repoA, '.git', 'info', 'exclude');
    expect(existsSync(excludeFile) && readFileSync(excludeFile, 'utf8').includes('graphify-out/'))
      .toBe(false);
  });
});

// O6(b) (graphify Task 10): the legacy git hooks graphify's own installer
// left behind, before ccrc owned any of this. Task 0 step 4 measured all 9
// hooked repos' post-commit AND post-checkout as byte-identical and WHOLLY
// graphify's own output: line 1 the shebang, line 2 the opening marker
// (`# graphify-hook-start` for post-commit, `# graphify-checkout-hook-start`
// for post-checkout), a body, and the matching closing marker as the file's
// LAST NON-EMPTY line, nothing after it. The fixtures below use that real
// shape — not the plan's original placeholder text — because it is what
// `_inst_graph_hooks_off`'s own marker-based detection (see its header in
// `ccd/ccrc`) is actually measured against.
describe('ccrc install: legacy graphify hook removal (_inst_graph_hooks_off, O6b)', () => {
  const HOOK_COMMIT_WHOLLY = '#!/bin/sh\n# graphify-hook-start\n'
    + "_PINNED='/usr/bin/python3'\n"
    + '"$_PINNED" -m graphify.hooks.post_commit "$@" || true\n'
    + '# graphify-hook-end\n';
  // Chained: the operator's own line sits BEFORE graphify's block, so line 2
  // is not the opening marker — the shape an operator who appended graphify's
  // hook below something they already had leaves behind.
  const HOOK_CHECKOUT_CHAINED = '#!/bin/sh\necho mine\n# graphify-checkout-hook-start\n'
    + "_PINNED='/usr/bin/python3'\n"
    + '"$_PINNED" -m graphify.hooks.post_checkout "$@" || true\n'
    + '# graphify-checkout-hook-end\n';

  it('O6(b): removes a wholly-graphify post-commit hook, refuses a chained one', () => {
    const home = freshBox('ccrc-inst-gfx-hooks-');
    plantFakeVenv(home);
    const repo = makeFixtureRepo(home, 'projects/hooked');
    const hooks = join(repo, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'post-commit'), HOOK_COMMIT_WHOLLY, { mode: 0o755 });
    writeFileSync(join(hooks, 'post-checkout'), HOOK_CHECKOUT_CHAINED, { mode: 0o755 });
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(hooks, 'post-commit'))).toBe(false);        // wholly ours: removed
    expect(existsSync(join(hooks, 'post-checkout'))).toBe(true);       // chained: kept
    expect(r.stdout + r.stderr).toContain('post-checkout');            // ...and reported

    // Backed up: at least one ~/ccrc-backups/<ts>/ dir holds a copy of the
    // removed post-commit hook. Task 10 adjustment: NOT a global
    // `readdirSync(ccrc-backups).length === 1` count — this same fresh
    // install may also back up a skill directory under ~/ccrc-backups if a
    // skill installer finds something pre-existing to overwrite (it does not
    // on THIS fixture, but the assertion should not depend on that staying
    // true), so it is scoped to what this step backs up rather than to the
    // directory's total child count.
    const backupsRoot = join(home, 'ccrc-backups');
    const backupDirs = readdirSync(backupsRoot);
    expect(backupDirs.length).toBeGreaterThanOrEqual(1);
    const hookBackedUp = backupDirs.some((d) =>
      readdirSync(join(backupsRoot, d)).some((f) => f.endsWith('_post-commit')));
    expect(hookBackedUp, 'no backup dir holds the removed post-commit hook').toBe(true);
  });

  it('is idempotent: a second run finds nothing left to remove', () => {
    const home = freshBox('ccrc-inst-gfx-hooks-idem-');
    plantFakeVenv(home);
    const repo = makeFixtureRepo(home, 'projects/hooked');
    const hooks = join(repo, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'post-commit'), HOOK_COMMIT_WHOLLY, { mode: 0o755 });
    const first = runInstall(home, ['install']);
    expect(first.code, first.stderr).toBe(0);
    expect(existsSync(join(hooks, 'post-commit'))).toBe(false);
    const second = runInstall(home, ['install']);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toMatch(
      /^install: graphify: legacy git hooks — 0 removed \(backed up\), 0 chained ones reported$/m);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-hooks-server-');
    plantFakeVenv(home);
    const repo = makeFixtureRepo(home, 'projects/hooked');
    const hooks = join(repo, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'post-commit'), HOOK_COMMIT_WHOLLY, { mode: 0o755 });
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(hooks, 'post-commit'))).toBe(true);
  });
});
