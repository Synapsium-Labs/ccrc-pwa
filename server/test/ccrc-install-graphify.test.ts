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
  chmodSync, readdirSync, rmSync, symlinkSync, lstatSync, realpathSync, readlinkSync,
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
  // D-1160: the sweep's shipped default noise list. `_inst_graph_noise`
  // refuses a tree without it, which is the point — a placed tree missing it
  // would leave the box refusing builds over ccrc's own artifacts.
  'ccd/graph-noise.default.list',
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
// D-1243: the always-on block the read rule is assembled FROM. It is read out
// of the pinned venv's package rather than vendored (the rule
// `install-graphify-skill.sh`'s header states for the skill), so the fixture
// has to carry a package for the resolver to find — and the fixture's `python`
// has to answer the one probe that resolves it.
const ALWAYS_ON_FIXTURE = [
  '## graphify',
  '',
  'This project has a knowledge graph at graphify-out/.',
  '',
  'Rules:',
  '- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists.',
  '- After modifying code, run `graphify update .` to keep the graph current.',
  '',
].join('\n');

// THE SAME DIRECTORY `ccrcEnv` points `CCRC_GRAPHIFY_PKG` at. D-1244: this
// helper first planted a package under the venv, which the env override then
// shadowed — so the block a test wrote was never the block the step read, and
// every D-1244 case failed for a fixture reason. One package dir, one override,
// one place a test can rewrite the shipped block.
function fakePkgDir(home: string): string {
  return path.join(home, 'fixture-graphify-pkg');
}

function plantFakeVenv(home: string, version = '0.9.9'): string {
  const bin = path.join(home, '.ccrc', 'graphify-venv', 'bin');
  mkdirSync(bin, { recursive: true });
  const pkg = fakePkgDir(home);
  mkdirSync(path.join(pkg, 'always_on'), { recursive: true });
  writeFileSync(path.join(pkg, 'always_on', 'claude-md.md'), ALWAYS_ON_FIXTURE);
  writeFileSync(path.join(bin, 'python'),
    `#!/bin/sh\necho "$@" >> "$HOME/venv-python-calls"\n`
    + `case "$*" in *"import graphify"*) echo "${pkg}" ;; esac\nexit 0\n`, { mode: 0o755 });
  // the env override names this same dir, so the probe and the override agree
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

describe('ccrc install: the default noise list (_inst_graph_noise, D-1160)', () => {
  it('converges ccrc\'s own footprint into ~/.ccrc/graph-noise/_default.list', () => {
    // ccrc's tooling writes `.remember/`, `.superpowers/`, `.claude/` and a
    // `CLAUDE.local.md` into every repo a session touches. The sweep's corpus
    // guard then held those untracked files against the repo and refused its
    // build for ever — 186 of the reference fleet's 304 breach paths, and five
    // repos blocked by nothing but ccrc's own mess. This list is how ccrc stops
    // poisoning corpora it does not own.
    const home = freshBox('ccrc-inst-gfx-noise-');
    plantFakeVenv(home);
    // The default role, like every other test in this file: `--role fleet`
    // additionally prompts for the agent token and refuses on a non-tty, which
    // is a different refusal from the one under test. `both` runs the step.
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    const listed = readFileSync(join(home, '.ccrc', 'graph-noise', '_default.list'), 'utf8');
    for (const name of ['.claude/', '.remember/', '.superpowers/', 'CLAUDE.local.md']) {
      expect(listed, `${name} must be in the shipped default`).toContain(name);
    }
    // A '!' anywhere in this file refuses every build on the box (spec 3.6), so
    // the shipped list must never carry one — asserted here rather than trusted.
    expect(listed.split('\n').filter((l) => /^\s*!/.test(l)),
      "a '!' in the default would refuse every build on this box").toEqual([]);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-noise-server-');
    plantFakeVenv(home);
    runInstall(home, ['install', '--role', 'server']);
    expect(existsSync(join(home, '.ccrc', 'graph-noise', '_default.list')),
      'a server box runs no sweep, so it is owed no noise list').toBe(false);
  });

  it('lands ATOMICALLY at 644, replacing a symlink rather than writing through it (D-1161)', () => {
    // The first draft used a bare `cp` after an unchecked `mkdir -p` and printed
    // "converged" whatever happened — the one install-time converger in this
    // file that bypassed `_inst_atomic`, while its own sibling on the deploy
    // lane used `install_atomic`. Two measurable differences, and both matter
    // here: the sweep timer reads this file every 15 minutes, so a non-atomic
    // write has a live reader; and `cp` writes THROUGH a symlink at the
    // destination instead of replacing it, which turns a planted link into a
    // write to wherever it points.
    const home = freshBox('ccrc-inst-gfx-noise-atomic-');
    plantFakeVenv(home);
    const dir = join(home, '.ccrc', 'graph-noise');
    mkdirSync(dir, { recursive: true });
    const decoy = join(home, 'decoy.list');
    writeFileSync(decoy, 'ORIGINAL\n');
    symlinkSync(decoy, join(dir, '_default.list'));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(join(dir, '_default.list')).isSymbolicLink(),
      'the symlink was written through, not replaced').toBe(false);
    expect(readFileSync(decoy, 'utf8'), 'the write followed the link off-target').toBe('ORIGINAL\n');
    expect(statSync(join(dir, '_default.list')).mode & 0o777).toBe(0o644);
  });
});

describe('README: the graphify step enumeration is DERIVED, not remembered (D-1243)', () => {
  // The README calls itself the canonical system overview, and its graphify
  // paragraph said "four role-gated steps" for TWO deviations after the count
  // became five and then six — D-1160 added the noise list and D-1243 the
  // always-on rule, and neither updated the sentence. A previous review caught
  // the same class of staleness in the paragraph immediately below it. A prose
  // count that nothing checks is a comment, so this checks it.
  const ccrc = readFileSync(path.resolve(here, '../../ccd/ccrc'), 'utf8');
  const readme = readFileSync(path.resolve(here, '../../README.md'), 'utf8');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  const steps = (): string[] => {
    const body = ccrc.slice(ccrc.indexOf('cmd_install() {'));
    const seq = body.slice(0, body.indexOf('\n}\n'));
    return [...seq.matchAll(/^\s*(_inst_graph(?:ify)?_\w+)\s*$/gm)].map((m) => m[1]!);
  };

  it('every graphify step in cmd_install is role-gated, and there are more than a couple', () => {
    const found = steps();
    expect(found.length, 'the cmd_install scan went vacuous').toBeGreaterThan(3);
    for (const fn of found) {
      const at = ccrc.indexOf(`\n${fn}() {`);
      expect(at, `${fn} is called by cmd_install but never defined`).toBeGreaterThan(-1);
      expect(ccrc.slice(at, at + 400),
        `${fn} is not gated off a server box, unlike every other graphify step`)
        .toMatch(/\[ "\$INST_ROLE" = server \] && return 0/);
    }
  });

  it("the README's count matches the number of steps that actually run", () => {
    const n = steps().length;
    // WHITESPACE-INSENSITIVE. The first draft embedded the paragraph's exact
    // line wrap, so re-flowing identical prose reddened the build — a guard
    // that punishes an editor for touching the file it exists to keep correct
    // trains people to delete it. Collapse whitespace, then match.
    const flat = readme.replace(/\s+/g, ' ');
    const m = flat.match(/provision it in (\w+) role-gated steps \(a server box has no rostered wrapper homes to graph, so all (\w+) skip there\)/);
    expect(m, "the README's graphify enumeration sentence moved or was reworded — re-derive this guard")
      .not.toBeNull();
    expect(m![1], `cmd_install runs ${n} graphify steps; the README says "${m![1]}"`).toBe(WORDS[n]);
    expect(m![2], 'the two counts in the same sentence disagree with each other').toBe(WORDS[n]);
  });

  it('the README documents the read side as it now is — hook, skill, PATH, counter', () => {
    // The whole point of this plan, and the thing the canonical overview would
    // otherwise still describe as a block in somebody else's CLAUDE.md.
    //
    // THE TOKEN THAT WAS NOT ONE (D-1355). This test's ancestor asserted
    // `toMatch(/_inst_graph_always_on/)` — and after Task 4 the README's only
    // occurrence of that string sits INSIDE the name of the remover,
    // `_inst_graph_always_on_off`, so the assertion passed as a prefix of the
    // very word that proves the writer is gone. A README describing nothing
    // but the retired write side satisfied it, which is exactly the mutated
    // state spec §4's last row ("README describes the read side as a
    // `CLAUDE.md` block") exists to redden. Each token below is therefore
    // matched WHOLE via `toContain`, and each names a mechanism that only
    // exists on the read side: a substring of one of them cannot be a
    // survivor of the block this plan retired.
    expect(readme, 'the canonical overview never mentions querying the graph')
      .toMatch(/graphify query/);
    for (const token of [
      '_inst_graph_always_on_off',   // R0, the remover
      'SessionStart',                // R1, the card
      // …and the key the card actually writes, for the same measured reason
      // `graphReadCount` is below: `SessionStart` alone does NOT bind R1's
      // bullet — the README names that event twice outside this section (the
      // D-1245 history sentence and the presence hook), so the card could be
      // deleted whole with this loop still green. `additionalContext` is the
      // one field the card emits and nothing else in the file mentions.
      'additionalContext',
      'clause 12',                   // R2, the worker skill
      'graphify-path',               // R3, the doctor check
      'graphQueries',                // R4, the counter
      // AND its single tolerant reader, because `graphQueries` alone does NOT
      // bind R4's bullet: the R5 decline below it names the counter too ("a
      // `graphQueries` of 0"), legitimately, so deleting the bullet outright
      // left that token still present and this test still green — MEASURED,
      // which is why the sixth token is here. `graphReadCount` is named
      // nowhere else in the file, and it is the mechanism D-1251 shipped: one
      // reader for both chips, so an older server's omitted field cannot paint
      // an ignorant row as one that reported.
      'graphReadCount',
    ]) {
      expect(readme, `the README never mentions ${token}`).toContain(token);
    }
    // R5 is a DECISION, and the spec asks for it in writing ("Recorded so it
    // is not re-derived", §2 R5) for the same reason the ledger exists: a
    // decline nobody wrote down is re-proposed by the next reader of the same
    // design. It is the one read-side item with no code to point at, so
    // nothing but this asserts it survives an edit.
    expect(readme.replace(/\s+/g, ' '),
      'the README does not record the DECLINED PreToolUse speed bump — an undocumented decline gets re-derived')
      .toMatch(/PreToolUse[\s\S]{0,240}?declined/i);
  });

  it('never again describes the read side as something ccrc writes into a CLAUDE.md (D-1245)', () => {
    // THE RULE THIS GUARD ENFORCES, in one sentence, so the next editor of
    // README.md does not trip it by accident: the README may say what D-1243
    // DID — past tense, and that history is the whole point of the paragraph
    // above — and may say that `_inst_graph_always_on_off` TAKES a block back;
    // what it may never say again is that ccrc, in the PRESENT tense, puts one
    // into a `CLAUDE.md`. Both patterns therefore hinge on a present-tense
    // verb, and neither fires on `converged`/`wrote`/`appended`/`planted`.
    //
    // DERIVED, not a spelling test. The second pattern was once written as a
    // bare `always_on/claude-md\.md` preceded by `into` — no verb at all — and
    // it matched the honest history sentence in the paragraph above, forcing a
    // choice between the guard and the record. A guard that forbids the truth
    // is a guard nobody can keep.
    const flat = readme.replace(/\s+/g, ' ');
    const NOW = /\b(converges|writes|installs|plants|puts)\b/.source;
    expect(flat, 'the README describes ccrc writing a read rule into a CLAUDE.md again')
      .not.toMatch(new RegExp(`${NOW}[^.]{0,140}\\b(block|read rule)\\b[^.]{0,140}CLAUDE\\.md`, 'i'));
    expect(flat, "the README says ccrc installs graphify's packaged block again")
      .not.toMatch(new RegExp(`${NOW}[^.]{0,140}always_on/claude-md\\.md`, 'i'));
  });
});

describe("README: the retirement's evidence sentence names the window its numbers came from (D-1357)", () => {
  // THE DEFECT THIS EXISTS FOR. The README's justification for retiring D-1243
  // is one measurement, and the design spec that measured it reports TWO
  // windows over the same query log:
  //
  //   | last 7 days                        | 265 | 11 | 0 |
  //   | since D-1243 deployed (2026-09-01) | 109 |  4 | 0 |
  //
  // The block shipped 2026-09-01 and was measured 2026-09-02, so 109/4 is a
  // ONE-DAY figure. The README (and both copies in the plan) paired the
  // week-shaped window WORD with the other row's NUMBERS: "Measured over the
  // week it was deployed: 109 … across 4 corpora". The conclusion survives
  // either row — ccrc-pwa measures zero in both — but this repo's own doctrine
  // is that a measurement is stated with its window, and this is the single
  // sentence carrying the evidence for the whole retirement.
  //
  // DERIVED, not a spelling test. Nothing here hard-codes 109, 4 or "one day":
  // the spec's §0 table is parsed, the README's figures are looked up IN it,
  // and the sentence is then held to the row it actually quotes. Re-measure
  // the block over a different window, update both files, and this stays
  // green; quote one row's numbers under another row's window word and it
  // goes red whichever pair you swap.
  const readme = readFileSync(path.resolve(REPO, 'README.md'), 'utf8');
  const spec = readFileSync(path.resolve(
    REPO, 'docs/superpowers/specs/2026-09-02-graphify-read-side-ccrc-level-design.md'), 'utf8');

  /** Rows of §0's measured-effect table: `| window | queries | corpora | ccrc-pwa |`. */
  const specRows = (): { window: string; queries: number; corpora: number }[] => {
    const at = spec.indexOf('**Measured effect of the block**');
    expect(at, "the spec's measured-effect table moved or was retitled — re-derive this guard")
      .toBeGreaterThan(-1);
    const end = spec.indexOf('\n## ', at);
    const section = spec.slice(at, end === -1 ? spec.length : end);
    return [...section.matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*\d+\s*\|\s*$/gm)]
      .map((m) => ({ window: m[1]!, queries: Number(m[2]), corpora: Number(m[3]) }));
  };

  /** The README's one measurement sentence, split into window phrase and figures. */
  const readmeClaim = (): { window: string; queries: number; corpora: number } => {
    const flat = readme.replace(/\s+/g, ' ');
    const m = flat.match(
      /Measured over ([^:]{1,160}): (\d+) `query`\/`path`\/`explain` calls across (\d+) corpora/);
    expect(m, "the README's measured-effect sentence moved or was reworded — re-derive this guard")
      .not.toBeNull();
    return { window: m![1]!, queries: Number(m![2]), corpora: Number(m![3]) };
  };

  const WEEKISH = /\bweeks?\b|\b7\s*days\b|\bseven\s*days\b/i;

  it('the spec still reports more than one window, which is what makes this confusable', () => {
    const rows = specRows();
    expect(rows.length, "the spec's table went vacuous — this guard would pass on anything")
      .toBeGreaterThan(1);
    expect(rows.some((r) => WEEKISH.test(r.window)),
      'no week-shaped row left in the spec — re-derive this guard').toBe(true);
  });

  it("the README's figures are one spec row's, and its window word is THAT row's", () => {
    const claim = readmeClaim();
    const rows = specRows();
    const hit = rows.filter((r) => r.queries === claim.queries && r.corpora === claim.corpora);
    expect(hit.length,
      `the README quotes ${claim.queries} calls across ${claim.corpora} corpora, which matches ` +
      `no single row of the spec's table (${rows.map((r) => `${r.window}=${r.queries}/${r.corpora}`).join('; ')})`)
      .toBe(1);
    const row = hit[0]!;
    expect(WEEKISH.test(claim.window),
      `the README states the window as "${claim.window}" but quotes the "${row.window}" row's ` +
      'figures — one row\'s numbers under another row\'s window')
      .toBe(WEEKISH.test(row.window));
    // A row whose window is anchored to a date must be quoted with that date:
    // "since it was deployed" is only a window once the reader knows when.
    const day = row.window.match(/\d{4}-\d{2}-\d{2}/);
    if (day) {
      expect(claim.window,
        `the "${row.window}" row is anchored to ${day[0]}; the README's window phrase ` +
        `("${claim.window}") does not say when, so the reader cannot size it`)
        .toContain(day[0]);
    }
  });
});


// ── R0: the block ccrc should never have written, removed ─────────────────
// D-1243 put a PROJECT-scoped instruction ("This project has a knowledge graph
// at graphify-out/") into an ACCOUNT-WIDE file — every rostered home's
// `~/.claude*/CLAUDE.md`, which Claude Code loads for every session under that
// account in every project, including the trees the sweep refuses. And that
// file is the OPERATOR's, not ccrc's: every one of D-1244's six data-loss
// classes existed only because ccrc was rewriting a file it does not own.
//
// The remover is D-1244's own hardened census doing its last job — same
// whole-line marker census, same exactly-one-ordered-pair rule, same symlink
// resolution, same mode preservation, same "left in place; remove by hand"
// for anything that is not provably wholly ccrc's — deleting lines ls..le
// instead of splicing a block in. `_inst_graph_hooks_off` is the idiom: ccrc
// already has a step whose whole job is removing what an earlier layer
// planted.
describe('ccrc install: the always-on block is REMOVED (_inst_graph_always_on_off, D-1245)', () => {
  const START = '<!-- ccrc:graphify-always-on:start -->';
  const END = '<!-- ccrc:graphify-always-on:end -->';
  const BLOCK = `${START}\n## graphify\n\n- first run \`graphify query\`\n${END}`;
  const claudeMd = (home: string) => join(home, '.claude', 'CLAUDE.md');
  const seed = (home: string, text: string, mode = 0o644): string => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(claudeMd(home), text, { mode });
    return claudeMd(home);
  };
  const backupDirs = (home: string): string[] => {
    const d = join(home, 'ccrc-backups');
    return existsSync(d) ? readdirSync(d) : [];
  };

  it('removes a well-formed block from mid-file, byte-identically around it', () => {
    const home = freshBox('ccrc-inst-gfx-off-mid-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n- operator line\n\n${BLOCK}\n\n## OPERATOR TAIL\n- keep me\n`);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    // The block AND the one separating blank line the append path wrote.
    expect(readFileSync(f, 'utf8')).toBe('# head\n\n- operator line\n\n## OPERATOR TAIL\n- keep me\n');
    expect(r.stdout).toMatch(/always-on read rule — 1 home\(s\) cleared/);
  });

  it('removes a block that sits at LINE 1 without eating the line after it', () => {
    // `sed -n "1,0p"` does NOT print nothing — an addr2 at or below addr1 makes
    // sed match the ONE line at addr1 — and line 1 is exactly where the append
    // path put the block for a home that had no CLAUDE.md at all.
    //
    // NO BLANK LINE AFTER THE BLOCK, and that is the fixture being faithful
    // rather than convenient: the append path (`ccd/ccrc:5321-5326`) writes the
    // block LAST, `printf '%s\n' "$want"` with nothing after it, so a trailing
    // blank is never a shape the converge produced. `lb` only ever absorbs the
    // ONE blank line the append path wrote BEFORE a block, and at line 1 there
    // is none — the remover must not learn to eat a trailing blank, because
    // that whitespace would be the operator's, not ccrc's.
    const home = freshBox('ccrc-inst-gfx-off-line1-');
    plantFakeVenv(home);
    const f = seed(home, `${BLOCK}\n## OPERATOR\n- keep me\n`);
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('## OPERATOR\n- keep me\n');
  });

  it('removes a block that ends the file, leaving the operator text intact', () => {
    const home = freshBox('ccrc-inst-gfx-off-eof-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n- keep me\n\n${BLOCK}\n`);
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# head\n\n- keep me\n');
  });

  it('leaves a HALF block in place, reports it, and degrades the install', () => {
    const home = freshBox('ccrc-inst-gfx-off-half-');
    plantFakeVenv(home);
    const text = `# head\n\n${START}\nstale\n\n## OPERATOR TAIL\n- keep me\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8'), 'a half block was deleted instead of reported').toBe(text);
    // SEMICOLON, not an em dash: the tree's own idiom for this refusal is
    // `— left in place; remove by hand`, said in `_inst_graph_hooks_off`'s
    // chained-content refusal — the one other place the tree says it. Cited by
    // NAME, not by line (D-1343): the plan prescribed `ccd/ccrc:5411 and :5249`
    // verbatim, and :5249 was the converge's unmarked-`## graphify` refusal,
    // which R0's own commit deletes. The spec quotes the phrase with a second
    // em dash; the tree is what ships, and D-1247 records the divergence rather
    // than making this file the odd one out.
    expect(r.stderr).toMatch(/left in place; remove by hand/);
    expect(r.stdout).not.toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('leaves TWO blocks in place rather than guessing which one is ccrc\'s', () => {
    const home = freshBox('ccrc-inst-gfx-off-two-');
    plantFakeVenv(home);
    const text = `# head\n\n${BLOCK}\n\n${BLOCK}\n\n# tail\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect(r.stderr).toMatch(/2 start and 2 end markers/);
  });

  it('leaves a CHAINED file — end marker before start — in place', () => {
    const home = freshBox('ccrc-inst-gfx-off-chained-');
    plantFakeVenv(home);
    const text = `# head\n${END}\nsomething\n${START}\n# tail\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect(r.stderr).toMatch(/end marker before its start marker/);
  });

  it('treats markers QUOTED in the operator\'s prose as prose, not as markers', () => {
    const home = freshBox('ccrc-inst-gfx-off-quoted-');
    plantFakeVenv(home);
    const text = `# head\n\nccrc wrote between ${START} and ${END} in this file.\n\n- keep\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8'), 'a sentence mentioning the markers was cut').toBe(text);
    // THE POSITIVE HALF, and the census mutation's only red. Byte-identity
    // alone is satisfied by a substring census too: with `grep -cF` the prose
    // line makes ns=1/ne=1, `grep -nxF` then finds no line, `ls`/`le` come back
    // EMPTY, every `[` on them errors non-zero (this file runs `set -uo
    // pipefail`, never `-e`), the splice fails and the `if !` arm leaves the
    // file untouched — the same bytes, arrived at by accident. What that path
    // cannot fake is the count: it takes the refusal branch, so `kept` is 1.
    expect(r.stdout, 'the census matched a marker QUOTED in prose')
      .toMatch(/always-on read rule — 0 home\(s\) cleared, 0 left in place/);
  });

  it('SKIPS a symlink this box cannot resolve — never writes through one', () => {
    const home = freshBox('ccrc-inst-gfx-off-badlink-');
    plantFakeVenv(home);
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(join(home, 'not-cloned-yet', 'CLAUDE.md'), claudeMd(home));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(claudeMd(home)).isSymbolicLink(), 'the unresolvable link was replaced').toBe(true);
    expect(existsSync(claudeMd(home)), 'a file was created at the link target').toBe(false);
    expect(r.stderr).toMatch(/symlink this box cannot resolve/);
  });

  it('writes through a RESOLVABLE symlink to the TARGET, and the link stays a link', () => {
    const home = freshBox('ccrc-inst-gfx-off-link-');
    plantFakeVenv(home);
    const target = join(home, 'dotfiles', 'CLAUDE.md');
    mkdirSync(join(home, 'dotfiles'), { recursive: true });
    writeFileSync(target, `# shared\n\n${BLOCK}\n`);
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(target, claudeMd(home));
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(lstatSync(claudeMd(home)).isSymbolicLink(), 'the link was replaced by a file').toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('# shared\n');
  });

  it('preserves the file\'s own mode instead of widening it to 644', () => {
    const home = freshBox('ccrc-inst-gfx-off-mode-');
    plantFakeVenv(home);
    const f = seed(home, `# private\n\n${BLOCK}\n`, 0o600);
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# private\n');
    expect(statSync(f).mode & 0o777, 'a 0600 CLAUDE.md was silently widened').toBe(0o600);
  });

  it('leaves no CLAUDE.md.tmp.<pid> behind, on the write path or the refusal path', () => {
    const home = freshBox('ccrc-inst-gfx-off-notmp-');
    plantFakeVenv(home);
    seed(home, `# head\n\n${BLOCK}\n`);
    runInstall(home, ['install']);
    expect(readdirSync(join(home, '.claude')).filter((n) => n.includes('CLAUDE.md.tmp')),
      'a temp file was left in the operator\'s config directory').toEqual([]);
  });

  it('REFUSES to rewrite a file it could not back up, and degrades the install', () => {
    // THE BACKUP IS THE ONLY COPY of the operator's CLAUDE.md that exists
    // before a destructive delete, so the guard that refuses the rewrite when
    // the backup fails needs a fixture in which it CAN fail — without one, the
    // whole `if ! { mkdir -p && cp -a; }` chain can be replaced by an
    // unconditional `mkdir -p; cp -a … || true` and every other row here stays
    // green (measured). `~/ccrc-backups` planted as a REGULAR FILE makes
    // `mkdir -p "$HOME/ccrc-backups/<ts>"` fail, and that fixture is safe in
    // this suite because the only other install step that writes there
    // (`_inst_graph_hooks_off`) backs up solely what it finds pre-existing,
    // which a `freshBox` has none of.
    const home = freshBox('ccrc-inst-gfx-off-nobackup-');
    plantFakeVenv(home);
    const text = `# head\n\n- operator line\n\n${BLOCK}\n\n## OPERATOR TAIL\n- keep me\n`;
    const f = seed(home, text);
    writeFileSync(join(home, 'ccrc-backups'), 'not a directory\n');
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8'), 'the block was deleted with no backup of the file taken')
      .toBe(text);
    expect(r.stderr).toMatch(/left in place rather than rewritten unbacked/);
    expect(r.stdout).toMatch(/always-on read rule — 0 home\(s\) cleared, 1 left in place/);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('is idempotent: the second run removes nothing and cuts no backup', () => {
    const home = freshBox('ccrc-inst-gfx-off-idem-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n${BLOCK}\n`);
    const first = runInstall(home, ['install']);
    expect(first.code, first.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# head\n');
    // SCOPED TO THE FILE THIS STEP BACKS UP, not a bare directory count —
    // `_inst_graph_hooks_off`'s own backup assertion (below) refuses a global
    // count for the same reason: some other install step may back something up
    // under `~/ccrc-backups/<ts>/` on this same fresh box, and a count of
    // timestamp directories says nothing about WHICH file was copied. The
    // backup name is the absolute path with `/` → `_`, so it ends `_CLAUDE.md`.
    const backupsRoot = join(home, 'ccrc-backups');
    const dirs = backupDirs(home);
    const claudeBackedUp = dirs.some((d) =>
      readdirSync(join(backupsRoot, d)).some((b) => b.endsWith('_CLAUDE.md')));
    expect(claudeBackedUp, 'no backup dir holds a copy of the CLAUDE.md the first run rewrote')
      .toBe(true);
    const after = dirs.length;
    const second = runInstall(home, ['install']);
    expect(second.code, second.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# head\n');
    expect(second.stdout).toMatch(/always-on read rule — 0 home\(s\) cleared/);
    expect(backupDirs(home).length, 'a second run cut a backup of a file it did not touch')
      .toBe(after);
  });

  it('splices with line-addressed sed and no awk at all — the BSD -v hazard is retired, not guarded', () => {
    // D-1244. The previous guard scanned for `awk[^\n]*-v ... "$want"`, which
    // is anchored to ONE physical line: writing the same defect with a `\`
    // continuation — the spelling ccd/ccrc uses everywhere — stayed GREEN
    // (measured). A source scan that only catches one spelling of a defect it
    // is the sole defence against is worse than no scan, because it reads as
    // cover. The function now uses `sed` with LINE ADDRESSES computed from a
    // marker census, so there is no awk to get wrong and nothing multi-line is
    // passed to any tool. This asserts that structural fact instead.
    //
    // D-1245 carried it over from the retired converge's describe: the remover
    // reuses the very same `sed -n "1,$((…-1))p"` construction, and this is the
    // tree's ONLY defence against awk returning to it — `macos-platform.test.ts`
    // does not ban awk at all.
    const src = readFileSync(path.resolve(here, '../../ccd/ccrc'), 'utf8');
    const at = src.indexOf('_inst_graph_always_on_off() {');
    expect(at, 'the function scan went vacuous').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body, 'the sed splice went missing').toMatch(/sed -n "1,\$\(\(lb-1\)\)p"/);
    // EXECUTABLE LINES ONLY — the rule `ccrc-api-ship.test.ts` states for
    // deploy.sh: this function's comments discuss awk by name at length, and a
    // scrape that counted prose would redden on its own explanation. And
    // continuations are joined first, so a backslash-wrapped invocation cannot
    // hide from this scan the way it hid from the one it replaced.
    const code = body.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')).join('\n')
      .replace(/\\\n\s*/g, ' ');
    expect(code, 'the executable-line scan went vacuous').toMatch(/sed -n/);
    expect(code, 'awk is back in this function; the BSD -v newline hazard returns with it')
      .not.toMatch(/(^|[^a-z])awk\s/m);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-off-server-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n${BLOCK}\n`);
    runInstall(home, ['install', '--role', 'server']);
    expect(readFileSync(f, 'utf8'), 'a server box has no rostered homes to clear')
      .toContain(START);
  });
});

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

// ── R3: what a session runs when it types `graphify` ──────────────────────
// MEASURED on the reference fleet: `command -v graphify` resolved to
// `~/.local/bin/graphify`, a pip console-script shim importing a July copy of
// the package with no dist-info and no `__version__`, while the venv the sweep
// builds every graph with is pinned at 0.9.9. The WRITE side resolves the
// engine by absolute path everywhere; the READ side was never given a path at
// all, so it ran whatever was on PATH.
describe('ccrc install: ~/.local/bin/graphify converges onto the pinned venv (R3)', () => {
  const link = (home: string) => join(home, '.local', 'bin', 'graphify');
  const venv = (home: string) => join(home, '.ccrc', 'graphify-venv', 'bin', 'graphify');
  const SHIM = '#!/usr/bin/python3\n# -*- coding: utf-8 -*-\nimport sys\n'
    + 'from graphify.__main__ import main\nsys.exit(main())\n';

  it('WRITES the link when nothing is there', () => {
    const home = freshBox('ccrc-inst-gfx-path-new-');
    plantFakeVenv(home);
    rmSync(link(home), { force: true });
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(link(home)).isSymbolicLink()).toBe(true);
    expect(realpathSync(link(home))).toBe(realpathSync(venv(home)));
  });

  it('REPLACES a pip console-script shim — detected by content, not assumed', () => {
    const home = freshBox('ccrc-inst-gfx-path-shim-');
    plantFakeVenv(home);
    writeFileSync(link(home), SHIM, { mode: 0o755 });
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(link(home)).isSymbolicLink(), 'the stale pip shim survived').toBe(true);
    expect(realpathSync(link(home))).toBe(realpathSync(venv(home)));
    // …AND THE SHIM IT DESTROYED IS STILL ON DISK (D-1349). The step's own
    // comment claims `cmd_wrappers`' discipline, and that discipline is a
    // `cp -p` copy aside BEFORE the overwrite — this arm had none, so a file
    // ccrc did not write was unlinked with nothing kept. `cmd_wrappers`' name
    // shape exactly: `<name>.pre-ccrc-<UTC>`, the "." keeping it out of every
    // wrapper scan.
    const bin = readdirSync(join(home, '.local', 'bin'));
    const backups = bin.filter((f) => f.startsWith('graphify.pre-ccrc-'));
    expect(backups.length, "the operator's pip shim was replaced with no copy kept").toBe(1);
    expect(readFileSync(join(home, '.local', 'bin', backups[0]!), 'utf8')).toBe(SHIM);
    expect(r.stdout).toMatch(/the shim it replaced is at /);
    // The swap staged a temp name and renamed it; nothing of it survives.
    expect(bin.filter((f) => f.startsWith('.graphify.tmp')), 'a staged temp link leaked').toEqual([]);
  });

  it('is a NO-OP on a link that already points into the venv, and cuts no backup', () => {
    const home = freshBox('ccrc-inst-gfx-path-noop-');
    plantFakeVenv(home);
    rmSync(link(home), { force: true });
    symlinkSync(venv(home), link(home));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/graphify on \$PATH already points at the pinned venv/);
    expect(readdirSync(join(home, '.local', 'bin')).filter((f) => f.startsWith('graphify.pre-ccrc-')),
      'a converged link was backed up as if it had been replaced').toEqual([]);
  });

  it('REPLACES a shim reached THROUGH a symlink, and orphans nothing (D-1351)', () => {
    // THE COMMONEST REAL STATE, and the one no fixture reached: a box that ran
    // `pipx install graphify` has a LINK on PATH pointing into a pipx venv,
    // and the file at the end of it is a console-script shim. "Symlink" is not
    // a verdict — this one resolves fine and is not the pinned venv, so the
    // content probes answer it, following the link exactly as `[ -f ]` does.
    // The arm that runs is REPLACE-with-backup, deliberately: content proves
    // what the thing is, and being reached through a link does not make it the
    // operator's hand-written launcher. Two consequences are pinned here
    // because they are surprising and were previously unspecified — `cp -p`
    // DEREFERENCES, so the keep-aside is a regular-file copy of the shim
    // rather than a copy of the link, and the pipx-owned file the link pointed
    // at is left untouched where it lies.
    const home = freshBox('ccrc-inst-gfx-path-linkshim-');
    plantFakeVenv(home);
    const pipx = join(home, '.local', 'pipx', 'venvs', 'graphify', 'bin');
    mkdirSync(pipx, { recursive: true });
    writeFileSync(join(pipx, 'graphify'), SHIM, { mode: 0o755 });
    rmSync(link(home), { force: true });
    symlinkSync(join(pipx, 'graphify'), link(home));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/was a pip console-script shim -> repointed at the pinned venv/);
    expect(realpathSync(link(home)), 'a shim behind a link was not repointed')
      .toBe(realpathSync(venv(home)));
    const backups = readdirSync(join(home, '.local', 'bin'))
      .filter((f) => f.startsWith('graphify.pre-ccrc-'));
    expect(backups.length, 'the shim behind the link was replaced with no copy kept').toBe(1);
    const bak = join(home, '.local', 'bin', backups[0]!);
    expect(lstatSync(bak).isSymbolicLink(), 'the keep-aside is documented as a dereferenced COPY')
      .toBe(false);
    expect(readFileSync(bak, 'utf8')).toBe(SHIM);
    // The pipx install itself is somebody else's tree: ccrc unlinked its own
    // `$HOME/.local/bin` entry and touched nothing at the far end.
    expect(readFileSync(join(pipx, 'graphify'), 'utf8'), "a file outside ccrc's own bin was altered")
      .toBe(SHIM);
  });

  it('REFUSES a symlink at a NON-SHIM engine — the state the no-op arm used to swallow', () => {
    // A moved venv, an older layout's link, anything whose target is a real
    // engine that is NOT a console-script shim: the file is a SYMLINK, so the
    // arm that judges links is the one that answers, and what it points at is
    // an engine that is not the pinned one. (A link whose target IS a shim
    // takes the replace arm instead — the case above; the fixture here plants
    // a `#!/bin/sh` launcher precisely so the content probes say no.) Before
    // D-1348 no fixture in this suite ever planted this state — the four it
    // planted were absent, a pip shim, a link INTO the venv, and a
    // hand-written launcher — so the resolution comparison, the whole
    // mechanism of that arm, could be deleted with every test still green.
    const home = freshBox('ccrc-inst-gfx-path-stale-');
    plantFakeVenv(home);
    const stale = join(home, '.ccrc', 'graphify-venv.old', 'bin');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'graphify'),
      '#!/bin/sh\necho "graphify 0.9.1"\nexit 0\n', { mode: 0o755 });
    rmSync(link(home), { force: true });
    symlinkSync(join(stale, 'graphify'), link(home));
    const r = runInstall(home, ['install']);
    // EXIT 1, and that is the CORRECT answer, not a fixture wart: the install
    // ran to completion (its `done — converged with N degraded step(s)` line
    // is asserted below) and its closing `ccrc doctor` then FAILed
    // `graphify-path`, because this box really does answer `graphify` with an
    // engine ccrc does not pin. Same shape as the hand-written-launcher case
    // below, which has never asserted a zero either.
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout, 'a link at a different engine was called converged')
      .not.toMatch(/already points at the pinned venv/);
    expect(realpathSync(link(home)), 'the link ccrc refused was repointed anyway')
      .toBe(realpathSync(join(stale, 'graphify')));
    expect(r.stderr).toMatch(/ccrc did not write it/);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('LEAVES a link this box cannot resolve in place, degraded — empty is not "equal"', () => {
    // macOS below 12.3 has no `readlink -f` (`macos-platform.test.ts`: a floor
    // this repo accepts rather than shims). Both resolutions come back EMPTY
    // there, and an inline `[ "$(readlink -f a)" = "$(readlink -f b)" ]`
    // answers TRUE for every link on the box. The stub is that userland: one
    // hop still works, `-f` does not.
    const home = freshBox('ccrc-inst-gfx-path-noresolve-');
    plantFakeVenv(home);
    const stale = join(home, '.ccrc', 'graphify-venv.old', 'bin');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'graphify'),
      '#!/bin/sh\necho "graphify 0.9.1"\nexit 0\n', { mode: 0o755 });
    rmSync(link(home), { force: true });
    symlinkSync(join(stale, 'graphify'), link(home));
    const r = runInstall(home, ['install'], {}, { stubs: {
      readlink: '#!/bin/sh\ncase "$1" in\n  -f) echo "readlink: illegal option -- f" >&2; exit 1 ;;\nesac\n'
        + `exec ${realPath('readlink')} "$@"\n`,
    } });
    // Exit 1 for the reason the case above states: the closing doctor resolves
    // with the REAL `realpath` (this stub only breaks `readlink -f`), sees the
    // stale engine, and FAILs `graphify-path`. The install step's own answer —
    // left in place, said out loud, counted degraded — is what is asserted.
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout, 'an unresolved comparison was reported as converged')
      .not.toMatch(/already points at the pinned venv/);
    expect(r.stderr).toMatch(/is a symlink this box cannot resolve/);
    expect(r.stdout).toMatch(/degraded step/);
    expect(realpathSync(link(home))).toBe(realpathSync(join(stale, 'graphify')));
  });

  it('names a BROKEN link for what it measured — not for a cause it guessed (D-1352)', () => {
    // EMPTY FROM `readlink -f` IS ITSELF OVERLOADED. Measured with GNU
    // coreutils 9.4 on the box this was written on: `ln -s
    // /gone/deeper/bin/graphify x; readlink -f x` exits 1 printing nothing,
    // because `-f` requires every component but the last to exist. So a
    // perfectly capable userland reaches the empty that the "cannot resolve"
    // arm answers — and that arm's first cut told the operator their readlink
    // had no `-f`. The real trigger is ordinary: `pipx uninstall graphify`
    // leaves exactly this link behind. Both shapes are planted, because they
    // take different routes to the same arm and only the arm makes them agree:
    // parents GONE (`readlink -f` empty, would otherwise hit "cannot resolve")
    // and parents PRESENT (`readlink -f` answers a path, so the comparison is
    // unequal and it would otherwise fall through to the not-a-shim refusal).
    for (const [tag, mkdirParent] of [['gone', false], ['present', true]] as const) {
      const home = freshBox(`ccrc-inst-gfx-path-dangling-${tag}-`);
      plantFakeVenv(home);
      const target = join(home, '.local', 'pipx', 'venvs', 'graphify', 'bin', 'graphify');
      if (mkdirParent) mkdirSync(dirname(target), { recursive: true });
      rmSync(link(home), { force: true });
      symlinkSync(target, link(home));
      const r = runInstall(home, ['install']);
      expect(r.stderr, `${tag}: a broken link was not named as one`)
        .toMatch(/is a symlink whose target this box cannot reach/);
      expect(r.stderr, `${tag}: the target it read is not in the message`).toContain(target);
      expect(r.stderr, `${tag}: a cause nothing measured was asserted`)
        .not.toMatch(/readlink has no/);
      expect(r.stdout).toMatch(/degraded step/);
      expect(lstatSync(link(home)).isSymbolicLink(), `${tag}: the link was not left in place`)
        .toBe(true);
      expect(readlinkSync(link(home)), `${tag}: the link was repointed`).toBe(target);
    }
  });

  it('REFUSES a hand-written launcher with a remedy, and does not fail the install', () => {
    // A launcher ccrc did not write is the operator's, and this verb has no
    // --force: the `cmd_wrappers` rule, which refuses rather than destroying
    // something on the strength of a judgement it never made.
    const home = freshBox('ccrc-inst-gfx-path-hand-');
    plantFakeVenv(home);
    const hand = '#!/bin/bash\n# my own launcher\nexec /opt/graphify/bin/graphify "$@"\n';
    writeFileSync(link(home), hand, { mode: 0o755 });
    const r = runInstall(home, ['install']);
    expect(readFileSync(link(home), 'utf8'), 'a hand-written launcher was overwritten').toBe(hand);
    expect(r.stderr).toMatch(/ccrc did not write it/);
    expect(r.stderr).toMatch(/move it aside/);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('never touches /usr/local/bin/graphify', () => {
    // THE SLICE STARTS AT THE SIGNATURE, so the function's HEADER comment —
    // which does name that path, and should, since it is the reason the write
    // side resolves the engine absolutely — is outside it. Everything from
    // `_inst_graphify_engine() {` to the closing brace is in, comments
    // included, so no sentence inside the body may spell the path either.
    // `ccd/ccrc` carries three other mentions of `_inst_graphify_engine`
    // (the pin's single-definition comment, `cmd_install`'s sequence, and the
    // hooks-off header), none of them followed by `() {`, so the anchor is
    // unambiguous.
    const home = freshBox('ccrc-inst-gfx-path-root-');
    plantFakeVenv(home);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    const src = readFileSync(join(treeRoot(home), 'ccd', 'ccrc'), 'utf8');
    const at = src.indexOf('_inst_graphify_engine() {');
    expect(at, 'the function scan went vacuous').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body, 'the converge names a path outside $HOME').not.toMatch(/\/usr\/local\/bin/);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-path-server-');
    plantFakeVenv(home);
    rmSync(link(home), { force: true });
    runInstall(home, ['install', '--role', 'server']);
    expect(existsSync(link(home)), 'a server box runs no graphify').toBe(false);
  });
});
