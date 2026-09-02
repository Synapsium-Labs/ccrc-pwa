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
  chmodSync, readdirSync, rmSync, symlinkSync, lstatSync,
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

describe('ccrc install: the read rule refuses malformed files rather than splicing (D-1244)', () => {
  // Every case here was raised by an adversarial review of D-1243 and MEASURED
  // against the shipped code before it was fixed. The header of the function
  // claimed "content outside them is never read or rewritten" and "NEVER
  // CLOBBERS"; all of these falsified one or both.
  const START = '<!-- ccrc:graphify-always-on:start -->';
  const END = '<!-- ccrc:graphify-always-on:end -->';
  const claudeMd = (home: string) => join(home, '.claude', 'CLAUDE.md');
  const seed = (home: string, text: string, mode = 0o644): string => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(claudeMd(home), text, { mode });
    return claudeMd(home);
  };

  it('a START marker with no END marker is skipped, not spliced — everything after it survives', () => {
    // Measured on the shipped code: the tail piece never set `seen`, printed
    // nothing, and the splice emitted prefix+block — deleting every line after
    // the start marker while reporting "converged". One hand-edit that drops a
    // marker line is enough, and CLAUDE.md is a file people edit by hand.
    const home = freshBox('ccrc-inst-gfx-halfblock-');
    plantFakeVenv(home);
    const text = `# head\n\n${START}\nstale\n\n## OPERATOR TAIL\n- keep me\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8'), 'a malformed file was spliced instead of skipped').toBe(text);
    expect(r.stderr).toMatch(/malformed, left untouched/);
  });

  it('two blocks are skipped, not silently carried forward and rewritten on every run', () => {
    // The old convergence predicate re-armed at each start marker and returned
    // both regions concatenated, so it could never equal the wanted block: the
    // file reached a fixed point the predicate still called "not converged",
    // and every install rewrote it and cut another backup, forever.
    const home = freshBox('ccrc-inst-gfx-twoblocks-');
    plantFakeVenv(home);
    const one = `${START}\nA\n${END}\n`;
    const text = `# head\n\n${one}\n${one}\n# tail\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect(r.stderr).toMatch(/2 start and 2 end markers/);
  });

  it('markers QUOTED inside the operator\'s prose are not markers — whole-line match only', () => {
    // Measured on the shipped code: a sentence mentioning the markers was cut
    // at the mention, a fresh block planted there, and the real block below
    // left stale forever — the precise drift this deviation exists to prevent.
    const home = freshBox('ccrc-inst-gfx-quoted-');
    plantFakeVenv(home);
    const text = `# head\n\nccrc writes between ${START} and ${END} in this file.\n\n## rules\n- keep\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    const out = readFileSync(f, 'utf8');
    expect(out, "the operator's sentence was cut at its mention of the markers")
      .toContain('ccrc writes between');
    expect(out).toContain('- keep');
    // it is an append, so exactly one real pair now exists
    expect(out.split('\n').filter((l) => l === START)).toHaveLength(1);
    expect(out.split('\n').filter((l) => l === END)).toHaveLength(1);
  });

  it('a symlink this box cannot resolve is SKIPPED, never written through', () => {
    // `readlink -f` answers empty for a link whose target's parent does not
    // exist (a dotfiles repo not yet cloned) and does not exist at all on older
    // macOS. The first draft fell back to the LINK path, so "resolved" and
    // "could not resolve" collapsed to one value and the failure case replaced
    // the link — the overloaded null this codebase forbids at a seam.
    const home = freshBox('ccrc-inst-gfx-badlink-');
    plantFakeVenv(home);
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(join(home, 'not-cloned-yet', 'CLAUDE.md'), claudeMd(home));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(claudeMd(home)).isSymbolicLink(), 'the unresolvable link was replaced').toBe(true);
    expect(existsSync(claudeMd(home)), 'a file was created at the link target').toBe(false);
    expect(r.stderr).toMatch(/symlink this box cannot resolve/);
  });

  it("preserves the file's own mode instead of widening it to 644", () => {
    // A symlink is resolved first, so the file being re-moded may not even sit
    // inside a ccrc home — forcing 644 could widen an operator's restricted
    // file anywhere on the box.
    const home = freshBox('ccrc-inst-gfx-mode-');
    plantFakeVenv(home);
    const f = seed(home, '# private\n', 0o600);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toContain(START);
    expect(statSync(f).mode & 0o777, 'a 0600 CLAUDE.md was silently widened').toBe(0o600);
  });

  it('replaces a block that sits at LINE 1 without duplicating its start marker', () => {
    // `sed -n "1,0p"` does not print nothing: an addr2 at or below addr1 makes
    // sed match the one line at addr1, so the start marker was re-emitted and
    // the block appended after it. Line 1 is exactly where the append path puts
    // the block for a home that had no CLAUDE.md at all.
    const home = freshBox('ccrc-inst-gfx-line1-');
    plantFakeVenv(home);
    seed(home, `${START}\nOLD BODY\n${END}\n`);
    writeFileSync(join(fakePkgDir(home), 'always_on', 'claude-md.md'),
      '## graphify\n\n- first run `graphify query "<q>"` — REVISED.\n');
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    const out = readFileSync(claudeMd(home), 'utf8');
    expect(out.split('\n').filter((l) => l === START), 'the start marker was duplicated').toHaveLength(1);
    expect(out).toContain('REVISED');
    expect(out, 'the superseded body survived').not.toContain('OLD BODY');
  });

  it('a skipped home makes the install report DEGRADED, not "every step converged"', () => {
    const home = freshBox('ccrc-inst-gfx-degraded-');
    plantFakeVenv(home);
    seed(home, `# head\n${START}\nno end marker follows\n`);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, 'a home was skipped and the install still claimed everything converged')
      .not.toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('leaves no CLAUDE.md.tmp.<pid> behind when it refuses', () => {
    const home = freshBox('ccrc-inst-gfx-notmp-');
    plantFakeVenv(home);
    seed(home, `${START}\nhalf\n`);
    runInstall(home, ['install']);
    expect(readdirSync(join(home, '.claude')).filter((n) => n.includes('CLAUDE.md.tmp')),
      'a temp file was left in the operator\'s config directory').toEqual([]);
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

  it('the README documents the READ side, not only the write side', () => {
    // The whole point of D-1243, and the thing the canonical overview omitted
    // entirely while describing five other steps in detail.
    expect(readme, 'the canonical overview never mentions querying the graph')
      .toMatch(/graphify query/);
    expect(readme).toMatch(/_inst_graph_always_on/);
  });
});

describe('ccrc install: the always-on READ rule (_inst_graph_always_on, D-1243)', () => {
  // Everything else graphify ships on this box serves the WRITE path — engine,
  // skill, excludes, noise list, the 15-minute sweep — and all of it keeps
  // graphs fresh. Nothing made a session READ one. Measured before this step:
  // the only always-on instruction any rostered home carried said "when the
  // user types `/graphify`", an explicit slash command; the query-first rule
  // was in zero of five homes.
  const START = '<!-- ccrc:graphify-always-on:start -->';
  const END = '<!-- ccrc:graphify-always-on:end -->';

  it('converges the block into every rostered home, carrying the query-first rule', () => {
    const home = freshBox('ccrc-inst-gfx-alwayson-');
    plantFakeVenv(home);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    let seen = 0;
    for (const dir of readdirSync(home).filter((d) => d.startsWith('.claude'))) {
      const f = join(home, dir, 'CLAUDE.md');
      if (!existsSync(f)) continue;
      const txt = readFileSync(f, 'utf8');
      if (!txt.includes(START)) continue;
      seen++;
      expect(txt, 'the block landed without its end marker — convergence would be ambiguous').toContain(END);
      expect(txt, 'the READ rule is the whole point of this step').toMatch(/first run `graphify query/);
    }
    expect(seen, 'no rostered home received the always-on block').toBeGreaterThan(0);
    expect(r.stdout).toMatch(/^install: graphify: always-on read rule — \d+ home\(s\) converged/m);
  });

  it('appends without disturbing a line of what was already there', () => {
    const home = freshBox('ccrc-inst-gfx-alwayson-keep-');
    plantFakeVenv(home);
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    const prior = '# User instructions\n\nSomething the operator wrote.\n';
    writeFileSync(join(dir, 'CLAUDE.md'), prior);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    const txt = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(txt.startsWith(prior), "the operator's own text was rewritten or reordered").toBe(true);
    expect(txt).toContain(START);
  });

  it('is idempotent — a second install neither duplicates the block nor rewrites the file', () => {
    const home = freshBox('ccrc-inst-gfx-alwayson-idem-');
    plantFakeVenv(home);
    runInstall(home, ['install']);
    const f = join(home, '.claude', 'CLAUDE.md');
    const after1 = readFileSync(f, 'utf8');
    const mtime1 = statSync(f).mtimeMs;
    const r2 = runInstall(home, ['install']);
    expect(r2.code, r2.stderr).toBe(0);
    const after2 = readFileSync(f, 'utf8');
    expect(after2).toBe(after1);
    expect(after2.split(START).length - 1, 'the block was appended a second time').toBe(1);
    expect(statSync(f).mtimeMs, 'an already-current file was rewritten anyway').toBe(mtime1);
    expect(r2.stdout).toMatch(/already current/);
  });

  it('REPLACES between its markers when the shipped block changes, never appending a rival copy', () => {
    const home = freshBox('ccrc-inst-gfx-alwayson-repl-');
    plantFakeVenv(home);
    runInstall(home, ['install']);
    const f = join(home, '.claude', 'CLAUDE.md');
    writeFileSync(join(fakePkgDir(home), 'always_on', 'claude-md.md'),
      '## graphify\n\nRules:\n- For codebase questions, first run `graphify query "<q>"` — REVISED.\n');
    const r2 = runInstall(home, ['install']);
    expect(r2.code, r2.stderr).toBe(0);
    const txt = readFileSync(f, 'utf8');
    expect(txt.split(START).length - 1, 'a second copy was appended instead of converging').toBe(1);
    expect(txt).toContain('REVISED');
    expect(txt, 'the superseded wording survived the replace').not.toMatch(/graph\.json exists/);
  });

  it("SKIPS and reports a home carrying an unmarked '## graphify' section — that text is not ours", () => {
    const home = freshBox('ccrc-inst-gfx-alwayson-foreign-');
    plantFakeVenv(home);
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    const foreign = '## graphify\n\nHand-written or written by `graphify install`.\n';
    writeFileSync(join(dir, 'CLAUDE.md'), foreign);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), 'a section ccrc did not write was rewritten')
      .toBe(foreign);
    expect(r.stderr).toMatch(/carries an unmarked '## graphify' section/);
    expect(r.stdout).toMatch(/\d+ skipped/);
  });

  it('writes THROUGH a symlinked CLAUDE.md, never replacing the link (D-1243)', () => {
    // Two homes deliberately sharing one file is a real configuration, not a
    // hypothetical: on the reference fleet `.claude-gpt/CLAUDE.md` IS a symlink
    // to `.claude/CLAUDE.md`. The staged `mv` would replace that link with a
    // regular file and sever the sharing silently — and the first draft only
    // survived it by ROSTER ORDER, which is luck rather than design.
    //
    // THE LINK MUST BE ON THE HOME THAT IS CONVERGED FIRST. The first draft of
    // this test symlinked a LATER home at an earlier one's file and stayed
    // GREEN with the fix removed: by the time the link was reached the shared
    // file already carried the block, so the already-converged branch skipped
    // the write and no `mv` ever ran. It pinned the roster order, not the fix.
    // Pointing the FIRST home's CLAUDE.md at a file outside the homes — the
    // dotfiles case — puts the link squarely on the write path.
    const home = freshBox('ccrc-inst-gfx-alwayson-link-');
    plantFakeVenv(home);
    const dots = join(home, 'dotfiles');
    mkdirSync(dots, { recursive: true });
    const target = join(dots, 'CLAUDE.md');
    writeFileSync(target, '# lives in a dotfiles repo\n');
    const first = join(home, '.claude');
    mkdirSync(first, { recursive: true });
    symlinkSync(target, join(first, 'CLAUDE.md'));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(join(first, 'CLAUDE.md')).isSymbolicLink(),
      'the link an operator made deliberately was replaced by a regular file').toBe(true);
    const txt = readFileSync(target, 'utf8');
    expect(txt, 'the block went to the link, not through it to the real file')
      .toContain('<!-- ccrc:graphify-always-on:start -->');
    expect(txt).toContain('# lives in a dotfiles repo');
    expect(txt.split('<!-- ccrc:graphify-always-on:start -->').length - 1,
      'the shared file received the block more than once').toBe(1);
  });

  it('DEGRADES, never dies: a graphify build shipping no always-on block still installs clean', () => {
    // The first draft of this step used `_ccrc_die` on all three availability
    // gates. A fixture with no package then took the WHOLE install down — a fix
    // for a missing nicety that was worse than the nicety being missing.
    // `_inst_enable` already states the rule for the sweep timer: a convenience
    // "must not turn an otherwise-converged install into a failed one".
    const home = freshBox('ccrc-inst-gfx-alwayson-none-');
    plantFakeVenv(home);
    rmSync(join(fakePkgDir(home), 'always_on', 'claude-md.md'));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/ships no always-on block .* read rule SKIPPED, nothing invented/);
    // and it invents nothing in its place
    for (const dir of readdirSync(home).filter((d) => d.startsWith('.claude'))) {
      const f = join(home, dir, 'CLAUDE.md');
      if (existsSync(f)) {
        expect(readFileSync(f, 'utf8'), 'a block was written from nowhere')
          .not.toContain('<!-- ccrc:graphify-always-on:start -->');
      }
    }
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
    const src = readFileSync(path.resolve(here, '../../ccd/ccrc'), 'utf8');
    const at = src.indexOf('_inst_graph_always_on() {');
    expect(at, 'the function scan went vacuous').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body, 'the sed splice went missing').toMatch(/sed -n "1,\$\(\(ls-1\)\)p"/);
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
    const home = freshBox('ccrc-inst-gfx-alwayson-server-');
    plantFakeVenv(home);
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.stdout).not.toMatch(/always-on read rule/);
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
