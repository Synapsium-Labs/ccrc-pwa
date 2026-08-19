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
  // ── Task 8: the two unit files that do NOT live under `deploy/systemd/`,
  // and the script `_inst_enable` runs after the service is started. The
  // supervisor unit ships in `ccd/` beside the script that instantiates it;
  // `ccrc.service` ships at the top of `deploy/`. `verify-service.sh` is
  // reached as `$CCRC_HERE/../deploy/verify-service.sh`, so it has to be in
  // the tree the verb is RUN from and not merely in the one it places.
  'deploy/ccrc.service',
  'ccd/claude-session@.service',
  'deploy/verify-service.sh',
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

/** ── THE DOCTOR HALF OF THE FIXTURE (Task 8) ────────────────────────────
 *  `cmd_install` now ENDS with `cmd_doctor`, and its exit code is doctor's, so
 *  every `expect(r.code).toBe(0)` in this file is now also an assertion about
 *  16 checks measuring this fixture. That is the intended coupling — a box
 *  whose doctor fails is not a finished install — but it means the fixture has
 *  to be a box doctor can pass, which it was not: measured on the Task 7
 *  fixture, doctor answered `FAIL gh_auth` (the poisoned gh exits 97),
 *  `FAIL git_email` (a throwaway HOME has no ~/.gitconfig), `FAIL linger` and
 *  `FAIL wrappers` (the roster's upstream account has no binary).
 *
 *  This is `ccrc-doctor.test.ts`'s `healthy()`, adapted: the same stub shapes,
 *  minus everything the INSTALL itself now provides. It plants no roster (the
 *  verb seeds one), no `ccrc.env` (the verb writes one), no unit files (the
 *  verb installs them) and no `systemctl`/`loginctl` (the runner's recorders
 *  answer for both halves) — so what is left is the four things a doctor run
 *  measures that an install does not create.
 *
 *  `node`, `tmux`, `jq`, `python3`, `flock` and `timeout` are NOT stubbed out
 *  of existence the way the doctor suite stubs them: this fixture's PATH keeps
 *  the real system directories, because the verb runs `node`, `jq` and `rsync`
 *  for real. `df` is the one exception — see below. */
function healthyDoctorBox(home: string): void {
  const d = join(home, 'doctor-stubs');
  mkdirSync(d, { recursive: true });
  const stub = (name: string, body: string): void =>
    writeFileSync(join(d, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  // `gh auth status --hostname github.com`, answered with the shape a box
  // authenticated for the 'repo' scope really prints (ccrc-doctor.test.ts's
  // GH_OK). It REPLACES `ghContainedEnv`'s poison, and the containment is not
  // weakened by that: this stub never execs the real gh either, and unlike the
  // poison it exits 90 — loudly — on any argv but the one ccrc asks.
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

  // The ONE network call ccrc makes, answered locally. `mode: local` is the
  // truthful answer for the box this verb builds — a single box whose server
  // drives the fleet itself — and `_check_fleet` SKIPS on it ("there is no
  // second box to disagree with"), which is a check that ran and had nothing
  // to compare rather than a check that failed.
  stub('curl', [
    'printf \'%s\\n\' "$*" >> "$HOME/curl-calls"',
    'body=\'{"mode":"local","connected":true,"downSince":null,"build":"agreed","roster":"agreed"}\'',
    '[ -f "$HOME/fixture-health-body" ] && IFS= read -r body < "$HOME/fixture-health-body"',
    'code=200',
    '[ -f "$HOME/fixture-health-code" ] && IFS= read -r code < "$HOME/fixture-health-code"',
    'printf \'%s\\n%s\' "$body" "$code"',
  ].join('\n'));

  // `df -Pk` is stubbed for DETERMINISM, not containment: real `df` answers for
  // whatever filesystem the suite happens to run on, so `_check_disk`'s 2 GiB
  // floor would make every test in this file depend on how full the developer's
  // disk is that afternoon. Same table shape as the doctor suite's.
  stub('df', [
    'printf \'%s\\n\' "$*" >> "$HOME/df-calls"',
    '[ "$1" = "-Pk" ] && [ -n "$2" ] || { echo "fixture df: unexpected argv: $*" >&2; exit 90; }',
    'echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    'echo "/dev/fixture0    104857600  20971520 42991616      21% /"',
  ].join('\n'));

  // `_check_git_email` reads `git config --global user.email`, i.e. THIS
  // fixture's `~/.gitconfig` — so the fixture writes one rather than stubbing
  // `git`, which `_inst_stamp` needs to be the real thing. Deliberately not a
  // repo-local identity: the check refuses to read one (Task 4 review), and a
  // fixture that supplied it that way would pass a check that measures nothing.
  writeFileSync(join(home, '.gitconfig'),
    '[user]\n\tname = ccrc fixture\n\temail = fixture@example.invalid\n');

  // The upstream account's binary, which the roster this verb seeds declares
  // and `_check_wrappers` looks for. A few bytes of ELF prove "not a script"
  // without the real ~300 MB (ccrc-doctor.test.ts's `writeBinary`).
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'claude'),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
}

/** The names `healthyDoctorBox` and the runner between them put in
 *  `~/.local/bin`. Everything else there was written by the verb — which is
 *  what the "the default roster generates no wrappers" assertion measures. */
const FIXTURE_BINS = ['gh', 'curl', 'journalctl', 'systemctl', 'loginctl', 'npm', 'rsync',
  'df', 'claude'];

/** A box with a shipped tree on it and nothing else — no `~/.ccrc`, no
 *  `~/.local/bin` beyond the stubs the runner plants. Doctor-healthy, because
 *  the verb ends by running doctor against it and hands back its exit code. */
function freshBox(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  healthyDoctorBox(home);
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
  // `journalctl` is a pure poison and always will be: nothing in this verb
  // reads it, and the one path that reaches it (verify-service.sh's `fail`,
  // which dumps the unit's last 60 journal lines) would otherwise read THIS
  // box's real journal from inside a test.
  poison('journalctl', 'ccrc tests must never read this box\'s real journal');
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
    // A named unit whose `enable --now` refuses — the shape of a unit file
    // systemd will not accept, which must reach the operator as a refusal
    // naming that unit.
    '    if [ -f "$HOME/fixture-enable-fail" ]; then',
    '      IFS= read -r bad < "$HOME/fixture-enable-fail"',
    '      [ "$3" = "$bad" ] && { echo "Failed to enable unit $3: fixture" >&2; exit 1; }',
    '    fi',
    '    exit 0 ;;',
    // `restart` is the line `_inst_enable` gained in fix round 1 — deploy's
    // own (deploy.sh:719-721), and the one that makes a re-run replace the
    // RUNNING server rather than only the files it runs from. Contained the
    // same way as `enable`: recorded, answered, never a real systemctl.
    '  restart)',
    '    [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    if [ -f "$HOME/fixture-restart-fail" ]; then',
    '      echo "Job for $2 failed: fixture" >&2; exit 1',
    '    fi',
    '    exit 0 ;;',
    // `is-active` answers from `<home>/fixture-unit-<unit>` when a test has an
    // opinion. The DEFAULT is `active`, unlike the doctor suite's stub, and the
    // difference is the fixture's subject: there, a unit is whatever the test
    // planted; here, `_inst_enable` has just started it, so "active" is what a
    // working box answers and a test that wants otherwise says so.
    '  is-active)',
    '    f="$HOME/fixture-unit-$2"',
    '    if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; [ "$v" = active ] && exit 0; exit 3; fi',
    '    echo active; exit 0 ;;',
    // verify-service.sh's two MainPID samples. Stable by default (a service
    // that stayed up); `fixture-mainpid-drift` makes the SECOND sample differ,
    // which is exactly how a crash loop shows itself.
    '  show)',
    '    [ "$2" = "-p" ] && [ "$3" = "MainPID" ] && [ "$4" = "--value" ] \\',
    '      || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    p=4242',
    '    if [ -f "$HOME/fixture-mainpid-drift" ]; then',
    '      n=0; [ -f "$HOME/fixture-mainpid-seen" ] && IFS= read -r n < "$HOME/fixture-mainpid-seen"',
    '      n=$((n + 1)); printf \'%s\\n\' "$n" > "$HOME/fixture-mainpid-seen"; p="42$n"',
    '    fi',
    '    echo "$p"; exit 0 ;;',
    // Read-only, and reached only from verify-service.sh's failure dump.
    '  status) echo "fixture systemctl status: $*"; exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  // `enable-linger` WRITES the fixture's linger state, so the doctor run at the
  // end of the same install reads what the step in the middle of it did — the
  // causal chain the real box has, rather than two unrelated fixtures that
  // happen to agree. `fixture-linger-refuse` is the box whose operator has no
  // sudo: logind refuses, and the state file is never written.
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
  // `verify-service.sh`'s own knobs, at the values its header says a test uses:
  // the production defaults sleep 3 + 5 seconds per call, and `_inst_enable`
  // makes one call per install. Zeroed here rather than per test, for the
  // reason `ccrc-doctor.test.ts` zeroes `CCRC_DOCTOR_GH_TIMEOUT` in its own
  // runner — a knob whose only reason to exist is that a test must not wait out
  // a production timeout, and one call site is where it cannot be forgotten.
  env['CCRC_VERIFY_SETTLE'] = '0';
  env['CCRC_VERIFY_WINDOW'] = '0';
  return env;
}

/** `<home>/doctor-stubs/` — executables re-planted into `.local/bin` on every
 *  run, AFTER the runner's own and BEFORE `opts.stubs`.
 *
 *  It exists because of an ordering fact rather than a preference: `ccrcEnv`
 *  re-plants its defaults (and `ghContainedEnv` re-plants the poisoned `gh`) on
 *  every single call, so anything a fixture builder wrote into `.local/bin`
 *  once, at construction time, is silently overwritten before the verb runs.
 *  `healthyDoctorBox` needs three tools to ANSWER rather than refuse — and only
 *  for the doctor half of the verb — so it leaves them here and this re-plants
 *  them. A test that wants one of them to misbehave still wins: `opts.stubs`
 *  lands after this. */
function replantDoctorStubs(home: string): void {
  const d = join(home, 'doctor-stubs');
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) {
    copyFileSync(join(d, f), join(home, '.local', 'bin', f));
    chmodSync(join(home, '.local', 'bin', f), 0o755);
  }
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
  replantDoctorStubs(home);
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
  // The list grew in Task 8 with everything the six new steps shell out to —
  // `bash` and `sleep` (verify-service.sh), `jq`, `date` and `basename`
  // (install-session-hooks.sh), `mktemp` (the wrapper converger) — and with the
  // four tools doctor merely LOOKS FOR at the end of the same run. A PATH
  // missing those is a fixture about six absences at once, and the point of
  // this helper is to model exactly one.
  for (const b of ['mkdir', 'cp', 'mv', 'rm', 'cat', 'chmod', 'cmp', 'date',
    'node', 'git', 'npm', 'rsync', 'bash', 'sleep', 'jq', 'mktemp', 'basename',
    'tmux', 'python3', 'flock', 'timeout']) {
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
const STRAY_DIRS = ['', '.ccrc', '.local/bin', '.cc-sessions', '.claude', 'ccrc',
  // Task 8: `_inst_units` stages six temp siblings across three directories,
  // and the third one's name carries systemd's `\x2d` escape — spelled here as
  // it is on disk, because a sweep that looked in the unescaped directory would
  // report "no strays" about a directory that does not exist.
  '.config/systemd/user',
  '.config/systemd/user/claude-session@.service.d',
  '.config/systemd/user/app-claude\\x2dsession.slice.d'];

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
    // The only fixture in this file that does not come from `freshBox` (its
    // tree has to BE `~/ccrc`), so it asks for the doctor half by hand — the
    // run below asserts exit 0, which is now doctor's verdict as well.
    healthyDoctorBox(home);
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
    // `gpt` is that roster's EXTERNAL account — somebody else's hand-written
    // launcher, which no ccrc verb ever writes. On the reference box it is 142
    // lines of bash; here it only has to exist, because doctor's `wrappers`
    // check runs at the end of this same install and an external account with
    // no executable is a genuine FAIL. (The three `generated` accounts need no
    // fixture: `_inst_wrappers` writes those itself, which is the point.)
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\n# somebody else\'s launcher; ccrc never writes this\nexec /usr/bin/env gpt "$@"\n',
      { mode: 0o755 });
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
      // Both agent keys, because `CCRC_FLEET=remote` with either one missing is
      // a config the server REFUSES TO BOOT on (server/src/index.ts:75-79), and
      // doctor's `config` check reproduces that refusal at the end of this same
      // run. A half-configured remote box is a real state and it has its own
      // test in ccrc-doctor.test.ts; this test is about a file being kept, and
      // a fixture that was also secretly a broken-config fixture would fail for
      // the wrong reason.
      'CCRC_AGENT_URL=ws://100.119.90.29:7789',
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

describe('ccrc install: a box with no systemd', () => {
  // The sibling of the node probe above, added in fix round 1 (Minor 2). Every
  // ccrc service and every ccd session is a `systemd --user` unit, so a box
  // with no systemctl cannot run a fleet — but until the probe existed it
  // found that out at STEP 10, having already written `~/.ccrc`,
  // `~/.local/bin`, `~/ccrc` and the operator's `~/.tmux.conf`, and it said so
  // in a sentence whose remedy named the command the box does not have
  // (`systemctl --user status ccrc.service`).
  it('refuses by name BEFORE the first write, and does not blame the units', () => {
    const home = freshBox('ccrc-install-nosystemd-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'systemctl') },
      { omit: ['systemctl'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: systemctl is required by 'ccrc install' — every ccrc service and every ccd session is a systemd --user unit, and this box has no systemctl on PATH\./m);
    // The two conditions stay apart: this is not "systemd refused these units".
    expect(r.stderr).not.toMatch(/daemon-reload failed/);
    // NOTHING was written — the whole point of probing before the first step.
    // (`.local/bin` exists because the runner plants its stubs there; what must
    // not be in it is anything this verb installs.)
    expect(existsSync(join(home, '.ccrc')), '$HOME/.ccrc was created anyway').toBe(false);
    expect(existsSync(placed(home)), 'the tree was placed anyway').toBe(false);
    expect(existsSync(join(home, '.local', 'bin', 'ccd'))).toBe(false);
    expect(existsSync(join(home, '.tmux.conf'))).toBe(false);
    expect(r.stdout).toBe('');
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
    // The external account that roster declares — see the kept-roster test
    // above: doctor's `wrappers` check runs at the end of this install too, and
    // an `external` account with no executable is a FAIL nobody here is asking
    // about.
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
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
      // Task 8. Three orderings in this half are load-bearing and each one is
      // measured by a test of its own below: the units land before anything
      // enables them, the account config dirs exist before the hooks installer
      // walks them, and the wrapper converger runs before doctor judges what it
      // wrote.
      '_inst_units',
      '_inst_enable',
      '_inst_linger',
      '_inst_dirs',
      '_inst_hooks',
      '_inst_wrappers',
    ]);
  });

  it('ends with cmd_doctor, and nothing runs after it', () => {
    // THE VERB'S EXIT CODE IS DOCTOR'S, and that is only true while doctor is
    // the LAST command in the function: a line added after it — a summary, a
    // tidy-up, one more echo — silently replaces the verdict with that line's
    // own exit status, and every "a broken box exits 1" assertion in this file
    // would go green against an install that reported success on a failing box.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    const lines = body![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(lines[lines.length - 1]).toBe('cmd_doctor');
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
        // `config` is handed to the real git, and the rest refuses. The two are
        // different questions — "is this directory a repository I will read"
        // and "what is this box's commit identity" — and only the first is this
        // test's subject; doctor's `git_email` check asks the second at the end
        // of the same run, so a stub that refused both would make this a test
        // about two things.
        git: '#!/bin/sh\n'
          + `case "\${1:-}" in config) exec ${realPath('git')} "$@" ;; esac\n`
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
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(no git on PATH\) — ccrc version will say unstamped$/m);
    expect(r.stdout).not.toMatch(/not a git checkout/);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
    // …AND THE VERB EXITS 1, which is doctor's verdict and not this step's:
    // every install step converged (the transcript above says so, and the
    // wrappers summary is the last of them), and then doctor said this box has
    // no git. That is the coupling Task 8 introduced — `cmd_install` ends with
    // `cmd_doctor` and hands back its exit code — and a box with no git really
    // is not a finished fleet box: `ccd` clones a workspace per session. The
    // two FAIL lines name the cause, so the 1 cannot be mistaken for the stamp
    // step having failed (it did not; it SKIPPED, at exit 0).
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL git: /m);
    expect(r.stdout).toMatch(/^install: wrappers: converged/m);
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
        // `config` to the real git, for the reason the arm above states.
        git: '#!/bin/sh\n'
          + `case "\${1:-}" in config) exec ${realPath('git')} "$@" ;; esac\n`
          + 'printf \'fatal: \\033[31mred\\010\\010\\010nope\\r and more\\n'
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

// ── Task 8: the units, the enablement, and the box's last word ────────────

/** `~/.config/systemd/user/…` — the directory `systemd --user` searches and
 *  both deploy lanes copy into. Spelled here in TypeScript exactly once; the
 *  test at the end of the units describe is what keeps it, `ccrc`'s
 *  `BOX_UNIT_DIR` and the check table's `CCRC_UNIT_DIR` from drifting apart. */
const unitDir = (home: string, ...rel: string[]): string =>
  join(home, '.config', 'systemd', 'user', ...rel);

/** systemd's escape of the `-` in the unit name `app-claude-session.slice`.
 *  The REPOSITORY directory is plainly named; the DESTINATION must be this or
 *  systemd never reads the drop-in (deploy.sh:404-407). In TypeScript the
 *  backslash is doubled; on disk the name carries the four literal characters
 *  `\x2d`, which is what the assertions below are about. */
const SLICE_DIR = 'app-claude\\x2dsession.slice.d';

/** Every file `_inst_units` is supposed to leave in that directory, by the name
 *  it must have there, beside the tree path it must be a copy of. */
const UNIT_FILES: Array<[string, string]> = [
  ['ccrc.service', 'deploy/ccrc.service'],
  ['claude-session@.service', 'ccd/claude-session@.service'],
  ['ccd-cap-scopes.service', 'deploy/systemd/ccd-cap-scopes.service'],
  ['ccd-cap-scopes.timer', 'deploy/systemd/ccd-cap-scopes.timer'],
  ['claude-session@.service.d/limits.conf', 'deploy/systemd/claude-session@.service.d/limits.conf'],
  [`${SLICE_DIR}/limits.conf`, 'deploy/systemd/app-claude-session.slice.d/limits.conf'],
];

/** The runner's `systemctl` records one line per call: the argv, a tab, then
 *  every file that was under `~/.config/systemd/user` at that moment. The
 *  second field is what turns "the enables run after every unit file landed"
 *  into a measurement — see the stub's own comment. */
const systemctlCalls = (home: string): Array<{ argv: string; onDisk: string[] }> => {
  const p = join(home, 'systemctl-calls');
  if (!existsSync(p)) return [];
  return read(p).split('\n').filter(Boolean).map((l) => {
    const [argv, have] = l.split('\t');
    return { argv: argv ?? '', onDisk: (have ?? '').split(',').filter(Boolean) };
  });
};

const loginctlCalls = (home: string): string[] => {
  const p = join(home, 'loginctl-calls');
  return existsSync(p) ? read(p).split('\n').filter(Boolean) : [];
};

describe('ccrc install: the units, and the one this box must not be given', () => {
  /** One install, shared by the read-only assertions. `umask 077` for the
   *  reason the artifacts describe gives: at 022 a plain `cp` reproduces 0644
   *  by itself and the `chmod` could be deleted unnoticed. */
  const units = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-units-');
    return { home, r: runInstall(home, ['install'], {}, { umask: '077' }) };
  })();

  it('the run this describe measures succeeded', () => {
    expect(units.r.code, units.r.stderr).toBe(0);
    expect(units.r.stdout).toMatch(/^install: units: /m);
    expect(units.r.stdout).toMatch(/^install: services: /m);
  });

  it('installs four unit files and two drop-ins, byte for byte, at 644', () => {
    // `deploy.sh:402-417`'s copy set. Byte equality rather than existence,
    // because the failure this catches is not an absent file: it is a unit
    // installed from the wrong place (the checkout instead of the placed tree,
    // or a stale copy), which exists, parses, and runs the wrong thing.
    const { home } = units;
    for (const [dest, src] of UNIT_FILES) {
      const p = unitDir(home, ...dest.split('/'));
      expect(existsSync(p), `${dest} never reached ~/.config/systemd/user`).toBe(true);
      expect(readFileSync(p), `${dest} is not the shipped file`)
        .toEqual(readFileSync(placed(home, ...src.split('/'))));
      expect(statSync(p).mode & 0o777, `${dest} has the wrong mode`).toBe(0o644);
    }
  });

  it('puts the slice drop-in in the ESCAPED directory name, and nowhere else', () => {
    // THE MUTATION THIS TEST EXISTS FOR: drop the `\x2d` and the drop-in lands
    // in `app-claude-session.slice.d`, where systemd — which escapes `-` in a
    // unit name before it looks — never reads it. Nothing fails, nothing warns:
    // every pane on the box just runs without its memory cap. So the assertion
    // is on the literal bytes of the directory name, and on the absence of the
    // plausible-looking one beside it.
    const { home } = units;
    expect(readdirSync(unitDir(home))).toContain(SLICE_DIR);
    expect(readdirSync(unitDir(home)),
      'the drop-in dir carries the repository spelling, which systemd never reads')
      .not.toContain('app-claude-session.slice.d');
    expect(existsSync(unitDir(home, SLICE_DIR, 'limits.conf'))).toBe(true);
  });

  it('does NOT install ccrc-agent.service — a required EnvironmentFile with no file', () => {
    // The one unit in deploy's set this verb refuses to place. Its
    // `EnvironmentFile=%h/.ccrc/agent.env` has no leading `-`, so systemd
    // REQUIRES the file; a single box in local mode has no agent and no
    // agent.env, and installing the unit would manufacture one that can only
    // fail — visible for ever in `systemctl --user` and in doctor's own
    // `services` check, describing something nobody asked for.
    const { home } = units;
    expect(existsSync(unitDir(home, 'ccrc-agent.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-agent.service.d'))).toBe(false);
    // …and no enable was attempted for it either, which is the half a mere
    // file-absence assertion would miss.
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-agent');
  });

  it('reloads and enables in that order, and only after every unit file landed', () => {
    // TWO ORDERINGS IN ONE ASSERTION, because they fail the same way. systemd
    // reads the directory at `daemon-reload`; a unit enabled before its drop-in
    // exists runs WITHOUT the drop-in until something reloads again, and for
    // the slice cap that is a box whose panes are uncapped while its transcript
    // says they are not. The recorded snapshot is what each call SAW.
    const { home } = units;
    const calls = systemctlCalls(home).filter((c) => !c.argv.includes('is-active')
      && !c.argv.includes('show'));
    expect(calls.map((c) => c.argv)).toEqual([
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      // THE RESTART, in deploy's own position (deploy.sh:719-721): after both
      // enables, before the verify. `enable --now` on an already-active unit is
      // a no-op, and `ccrc.service` runs `node ~/ccrc/server/dist/…` — a process
      // pinned to the dist it started with. Without this line the SECOND
      // `ccrc install` rsyncs a new dist, stamps the new sha, prints "every step
      // above converged", and leaves the box serving the old code, with nothing
      // on a single box able to notice (`_check_fleet` SKIPs in local mode).
      // It is also what makes `verify-service.sh` — "Post-restart verification"
      // by its own header — measure this install's process rather than the
      // previous one's.
      '--user restart ccrc.service',
    ]);
    for (const c of calls) {
      expect(c.onDisk, `${c.argv} ran before the unit files landed`)
        .toEqual(expect.arrayContaining(UNIT_FILES.map(([dest]) => dest)));
    }
  });

  it('refuses BY UNIT when systemd will not enable one', () => {
    // The remedy names the unit and the command that says why. "install failed"
    // would send an operator to read this script; `systemctl --user status
    // ccd-cap-scopes.timer` sends them to systemd's own sentence about it.
    const home = freshBox('ccrc-install-enable-fails-');
    writeFileSync(join(home, 'fixture-enable-fail'), 'ccd-cap-scopes.timer\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: systemctl --user enable --now ccd-cap-scopes\.timer failed — read what it says: systemctl --user status ccd-cap-scopes\.timer$/m);
    // …and the run stopped there rather than carrying on to report a box it
    // could not finish converging.
    expect(r.stdout).not.toMatch(/^install: linger:/m);
  });

  it('fails the install when the started service does not stay up', () => {
    // `systemctl enable --now` returns the moment systemd FORKS, which is the
    // whole reason `deploy/verify-service.sh` exists: a server that throws
    // during ESM evaluation crash-loops every RestartSec=3 behind an install
    // that exited 0. Here the MainPID changes across the observation window —
    // the shape of a crash loop, and the one thing a single `is-active` sample
    // cannot see.
    const home = freshBox('ccrc-install-crashloop-');
    writeFileSync(join(home, 'fixture-mainpid-drift'), 'yes\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/CRASH-LOOPING/);
    expect(r.stderr).toMatch(
      /^ccrc: ccrc\.service was restarted and did not stay up, so this box has the unit and not the service/m);
    expect(r.stdout).not.toMatch(/^install: linger:/m);
  });

  it('refuses when the restart itself fails — the old server is still the one running', () => {
    // A restart systemd refuses (a unit that will not start at all) is a
    // different condition from a service that starts and then dies, and the two
    // remedies an operator reaches for are the same command with different
    // output. What must not happen is either being silent: the box is then
    // running the PREVIOUS install's server while every other artifact on it
    // claims the new build.
    const home = freshBox('ccrc-install-restart-fails-');
    writeFileSync(join(home, 'fixture-restart-fail'), 'yes\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: systemctl --user restart ccrc\.service failed, so this box is still running the server the previous install started — read what it says: systemctl --user status ccrc\.service$/m);
    expect(r.stdout).not.toMatch(/^install: linger:/m);
  });

  it('says on the transcript that the service was restarted onto the new tree', () => {
    // The step's own line is what an operator reads when they wonder whether a
    // re-run actually replaced the running server. It names the thing the
    // restart is FOR — the tree this run placed — rather than saying "enabled"
    // and leaving the process question unanswered.
    expect(units.r.stdout).toMatch(
      /^install: services: ccrc\.service and ccd-cap-scopes\.timer enabled, and ccrc\.service restarted onto the tree this run placed$/m);
  });

  it('honours the CCRC_VERIFY_* knobs rather than waiting out a production window', () => {
    // The knobs are `verify-service.sh`'s own and this verb passes none of them
    // — it just does not clobber them. Proof that the script really ran (and
    // ran against the fixture's systemctl) is its verdict line in the
    // transcript, naming the MainPID the stub answered with.
    expect(units.r.stdout).toMatch(/^verified: ccrc\.service active, MainPID 4242 stable across 0s$/m);
  });

  it('names the same unit directory the doctor check table does', () => {
    // THE DELIBERATE SECOND SPELLING, held by a mechanism instead of a promise
    // (D-92, and `_check_path`'s own note about `WRAPPER_BIN_DIR` for the same
    // trade). `ccrc-doctor-checks` cannot read `ccrc`'s variable: it is sourced
    // under `set -u` by things that are not `ccrc` — ccrc-doctor.test.ts's
    // `tableNames()` does exactly that — so a top-level
    // `CCRC_UNIT_DIR="$BOX_UNIT_DIR"` would make sourcing it fail outright, and
    // a `:-` fallback IS the second spelling with a branch in front. So: two
    // literals, compared.
    const ccrcSrc = read(join(REPO, 'ccd', 'ccrc'));
    const checksSrc = read(join(REPO, 'ccd', 'ccrc-doctor-checks'));
    const box = /^BOX_UNIT_DIR="([^"]+)"$/m.exec(ccrcSrc);
    const table = /^CCRC_UNIT_DIR="([^"]+)"$/m.exec(checksSrc);
    expect(box, 'ccd/ccrc declares no BOX_UNIT_DIR').toBeTruthy();
    expect(table, 'ccd/ccrc-doctor-checks declares no CCRC_UNIT_DIR').toBeTruthy();
    expect(box![1]).toBe(table![1]);
    // …and it is the directory this fixture really found the units in, so the
    // agreement is with the box rather than only with itself.
    expect(box![1]).toBe('$HOME/.config/systemd/user');
  });
});

describe('ccrc install: linger, the account dirs, the hooks and the wrappers', () => {
  const converged = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-converge-');
    return { home, r: runInstall(home) };
  })();

  it('the run this describe measures succeeded', () => {
    expect(converged.r.code, converged.r.stderr).toBe(0);
  });

  it('asks logind for linger, by uid, and says so', () => {
    // Every ccd session is a `systemd --user` unit; without linger,
    // /run/user/$UID is torn down with the last login session and the whole
    // fleet goes with it. The remedy doctor prints uses the UID too, so the
    // call and the advice are one command.
    const { home, r } = converged;
    expect(loginctlCalls(home).some((c) => /^enable-linger \d+$/.test(c)),
      'nothing ever asked logind to enable linger').toBe(true);
    expect(r.stdout).toMatch(/^install: linger: enabled for uid \d+ — this box's units survive logout$/m);
  });

  it('reports a linger it cannot enable and CONTINUES — doctor is what says so', () => {
    // THE ONE STEP THAT SURVIVES ITS OWN FAILURE. Enabling linger needs a
    // privilege the operator may not have (`sudo loginctl enable-linger` is the
    // remedy, and this process is not root). Dying here would abort an install
    // at its tenth step, on a box where everything before it converged, over a
    // thing one command fixes — so the step prints that command and returns 0,
    // and the four steps after it still run. The verdict comes from doctor,
    // which is the last word by design: FAIL linger, exit 1.
    const home = freshBox('ccrc-install-linger-refused-');
    writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    const r = runInstall(home);
    expect(r.stdout).toMatch(/^install: linger: could not enable — run: sudo loginctl enable-linger \d+$/m);
    // …the steps AFTER it ran, which is the half that makes this a "continue"
    // rather than a die with a friendlier sentence.
    for (const step of ['dirs: ', 'hooks: ', 'wrappers: ',
      'done — converged with 1 degraded step \\(linger\\)']) {
      expect(r.stdout, `the install stopped at linger: no "install: ${step}" line`)
        .toMatch(new RegExp(`^install: ${step}`, 'm'));
    }
    // …and the box is still reported honestly: doctor's own linger check FAILs,
    // with the same remedy, and its exit code is the verb's.
    expect(r.stdout).toMatch(/^FAIL linger: /m);
    expect(r.stdout).toMatch(/^ {2}remedy: run: sudo loginctl enable-linger \d+$/m);
    expect(r.code).toBe(1);
  });

  it('creates every account config dir the roster names, so the hooks land in all of them', () => {
    // THE GAP THIS STEP CLOSES: `install-session-hooks.sh` iterates the roster's
    // config dirs and `continue`s past any that is not there — right for a
    // deploy onto a months-old fleet host, and exactly wrong on a fresh box,
    // where NONE of them exists. Without `_inst_dirs` the installer walks the
    // whole roster, skips every entry and exits 0, leaving a box whose sessions
    // report nothing. Measured with the five-account roster, because the
    // default one's single dir is created by `_inst_files` anyway and would
    // make this assertion pass with the step deleted.
    const home = freshBox('ccrc-install-dirs-');
    preexisting(home, 'accounts.json', MIGRATION_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: dirs: config directory in place for 5 account\(s\) named by \$HOME\/\.ccrc\/accounts\.sh$/m);
    for (const d of ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt', '.claude-dev0']) {
      expect(existsSync(join(home, d)), `${d} was never created`).toBe(true);
      // …and the hooks installer, run from the INSTALLED path right after,
      // found each one and converged its settings.json.
      const s = join(home, d, 'settings.json');
      expect(existsSync(s), `${d}/settings.json — the hooks installer skipped this dir`).toBe(true);
      const j = JSON.parse(read(s)) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
        statusLine: { command: string };
      };
      expect(j.hooks['SessionStart']![0]!.hooks[0]!.command).toContain('/session-hook.sh');
      expect(j.statusLine.command).toContain('/statusline-command.sh');
    }
  });

  it('runs the wrapper converger with no flags, and the default roster writes none', () => {
    // `cmd_wrappers` is called as a FUNCTION (same file), so its own lines —
    // per-account verdicts, refusals with remedies, the summary — reach the
    // operator unaltered. The default roster holds one `upstream` account,
    // which this verb never writes under any flag, so the converged answer is
    // zero wrappers written: the run proves the roster and `$HOME/.local/bin`
    // agree, which is what doctor judges two steps later.
    const { home, r } = converged;
    expect(r.stdout).toMatch(
      /^summary: 1 account\(s\) in .*\/\.ccrc\/accounts\.json — 0 generated, 1 upstream, 0 external \(upstream and external are never written\); 0 written, /m);
    expect(r.stdout).toMatch(/^install: wrappers: converged /m);
    // Nothing but the three executables `_inst_bins` installs — no wrapper, no
    // temp file, no staged leftover — beside what the fixture itself planted.
    expect(readdirSync(join(home, '.local', 'bin'))
      .filter((b) => !FIXTURE_BINS.includes(b)).sort())
      .toEqual(['ccd', 'ccd-cap-scopes', 'ccrc']);
  });

  it('never calls ccrc\'s own executables orphans (D-93)', () => {
    // MEASURED BEFORE THE FIX: every install printed
    //   ORPHAN ccd: …/.local/bin/ccd carries ccrc's marker and no account in
    //   the roster claims it
    //   remedy: add an account "ccd" … or remove …/.local/bin/ccd by hand
    // four lines above this same transcript's own closing advice, "next: add
    // your first session with: ccd menu". Self-destructive advice about the
    // binary the next line tells the operator to run, on the first verb a new
    // user types.
    //
    // The cause is not a mistake to be undone: `ccd/ccd:2` carries the
    // provenance marker DELIBERATELY (41bdf60, gated by ownership.test.ts), so
    // that ccrc's own shipped `ccd` reads `ccrc-unmodified` and the installer
    // may replace it. The orphan walk simply must not treat ccrc's own
    // toolchain as a candidate account wrapper — `TOOLCHAIN_EXECUTABLES` in
    // deploy/gen-wrappers.mjs.
    const { home, r } = converged;
    expect(existsSync(join(home, '.local', 'bin', 'ccd')),
      'the fixture never installed the ccd this is about').toBe(true);
    expect(r.stdout, 'ccrc told the operator to delete its own ccd')
      .not.toMatch(/^ORPHAN /m);
    // …and the count in the converger's own summary agrees, which is the field
    // the pre-existing assertion stopped one short of.
    expect(r.stdout).toMatch(/^summary: 1 account\(s\) in .*; 0 written, 0 converged, 0 refused, 0 orphaned$/m);
    // The general orphan REPORT is untouched — ccrc-wrappers.test.ts pins a
    // synthetic leftover still being reported, and this must not have widened
    // into "no orphans are ever named".
  });

  it('a refused wrapper is a failed install', () => {
    // `--force`/`--adopt` are the flags that decide what may be overwritten and
    // this step passes neither, so a file ccrc did not write is REFUSED — with
    // the converger's own remedy — and the install stops. The alternative is an
    // install that reports success over a box whose wrappers it could not
    // converge, which is the state `ccrc wrappers` exists to make impossible.
    const home = freshBox('ccrc-install-wrappers-refused-');
    preexisting(home, 'accounts.json', MIGRATION_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    // A file at a GENERATED account's path that ccrc did not write: neither
    // ccrc-unmodified nor equivalent, so no flag this step passes can rewrite
    // it.
    writeFileSync(join(home, '.local', 'bin', 'claude-corp'),
      '#!/bin/sh\n# mine, and not ccrc\'s\nexec /usr/bin/env claude "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: wrapper convergence refused — read the lines above$/m);
    // The converger's own account-level refusal is what "the lines above" means,
    // and it is still on stdout rather than re-worded into the die.
    expect(r.stdout).toMatch(/^REFUSE claude-corp: /m);
    // …and it did not run doctor over a box it had just refused to finish.
    expect(r.stdout).not.toMatch(/^summary: \d+ checks/m);
  });
});

describe('ccrc install: the landing block, and doctor as the last word', () => {
  it('ends with doctor, and a box that passes every check exits 0', () => {
    const home = freshBox('ccrc-install-doctor-ok-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    // The CLEAN variant of the closing line — the degraded one is asserted on
    // its own fixture in the doctor-fails test below.
    expect(r.stdout).toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).not.toMatch(/degraded/);
    // Doctor's summary is the LAST line, because doctor is the last command:
    // the verb's exit code is its verdict.
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines[lines.length - 1]).toMatch(/^summary: \d+ checks \(\d+ skipped\), /);
    expect(r.stdout).toMatch(/^summary: \d+ checks \(\d+ skipped\), \d+ verdicts — \d+ passed, 0 warned, 0 failed$/m);
  });

  it('reads the PWA address back out of the env file it installed', () => {
    // ONE SOURCE OF TRUTH, and the case that makes it matter: an operator whose
    // `ccrc.env` says something other than the default. That file is
    // user-owned, so a re-run keeps it — and a landing block that printed
    // `127.0.0.1:7788` regardless would be telling that operator to open an
    // address their box does not listen on.
    const home = freshBox('ccrc-install-addr-');
    preexisting(home, 'ccrc.env', 'CCRC_FLEET=local\nCCRC_HOST=box.example.invalid\nCCRC_PORT=8123\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: PWA: http:\/\/box\.example\.invalid:8123\/ \(CCRC_HOST\/CCRC_PORT in .*\/\.ccrc\/ccrc\.env change this\)$/m);
    expect(r.stdout).toMatch(/^install: next: add your first session with: ccd menu {3}\(and read .*\/\.ccrc\/ccrc\.env\)$/m);
  });

  it('falls back to the documented default when the env file names neither key', () => {
    // The fallback is not a guess either: `server/src/config.ts` boots on the
    // same two values when the file is silent, so this line describes the box
    // rather than merely being polite about it.
    const home = freshBox('ccrc-install-addr-default-');
    preexisting(home, 'ccrc.env', '# an operator who deleted everything but the comment\n');
    const r = runInstall(home);
    expect(r.stdout).toMatch(/^install: PWA: http:\/\/127\.0\.0\.1:7788\//m);
  });

  it('a box doctor fails on exits 1, with every install step still printed', () => {
    // The two halves are one contract: the exit code is doctor's verdict, and
    // the transcript above it is the install's. Losing either — a 0 beside a
    // FAIL, or a 1 with no record of what converged — leaves an operator with a
    // number and no way to tell which half of the run it is about.
    const home = freshBox('ccrc-install-doctor-fails-');
    writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL linger: /m);
    for (const step of ['roster', 'accounts\\.sh', 'ccrc\\.env', 'tree', 'bins', 'files',
      'stamp', 'units', 'services', 'linger', 'dirs', 'hooks', 'wrappers']) {
      expect(r.stdout, `no "install: ${step}:" line survived the failing doctor`)
        .toMatch(new RegExp(`^install: ${step}: `, 'm'));
    }
    // …and the closing line MEASURES rather than claims: this run had a step
    // that neither converged nor died, and says so. "every step above
    // converged" here would be a false sentence four lines under the step that
    // reported it could not (fix round 1, Minor 1).
    expect(r.stdout).toMatch(/^install: done — converged with 1 degraded step \(linger\)$/m);
    expect(r.stdout).not.toMatch(/^install: done — every step above converged$/m);
  });
});

describe('ccrc install: running the WHOLE verb twice', () => {
  // Tasks 6-7 measured idempotence per step. This is the same property for the
  // finished verb: the promise in `--help` ("re-running converges; it never
  // damages an existing install") is about `ccrc install`, not about eight of
  // its fourteen steps, and the steps that arrived in Task 8 are the ones with
  // the most to damage — a settings.json an operator has customised, a wrapper
  // they wrote, a unit systemd is running out of right now.
  it('changes nothing but the build stamp, and leaves no temp file anywhere', () => {
    const home = freshBox('ccrc-install-idem-whole-');
    gitInit(treeRoot(home));   // so the stamp step really writes, and rewrites
    const first = runInstall(home);
    expect(first.code, first.stderr).toBe(0);

    // Every `_inst_atomic` destination, plus the ccrc-owned file written by
    // other means. `build.json` is DELIBERATELY ABSENT from this list: its
    // `builtAt` measures the run that wrote it, so rewriting it is what that
    // step is for — assertion 4 below is that it DID change, which is the other
    // half of the same rule.
    const targets = [
      join(home, '.ccrc', 'accounts.sh'),
      join(home, '.local', 'bin', 'ccd'),
      join(home, '.local', 'bin', 'ccd-cap-scopes'),
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      join(home, '.tmux.conf'),
      join(home, '.claude', 'statusline-command.sh'),
      ...UNIT_FILES.map(([dest]) => unitDir(home, ...dest.split('/'))),
    ];
    const before = targets.map(mtime);
    const jsonBefore = read(join(home, '.ccrc', 'accounts.json'));
    const envBefore = read(join(home, '.ccrc', 'ccrc.env'));
    const settingsBefore = read(join(home, '.claude', 'settings.json'));
    const stampBefore = read(join(home, '.ccrc', 'build.json'));
    const callsBefore = systemctlCalls(home).map((c) => c.argv);

    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);

    // 1. The two USER-OWNED files are byte-identical, which is the rule this
    //    verb would do the most damage by breaking.
    expect(read(join(home, '.ccrc', 'accounts.json'))).toBe(jsonBefore);
    expect(read(join(home, '.ccrc', 'ccrc.env'))).toBe(envBefore);
    // 2. …and so is the settings.json the hooks installer converged: it
    //    re-derives the same JSON and skips the write, so an operator's own
    //    statusLine (which it seeds only when absent) survives every re-run.
    expect(read(join(home, '.claude', 'settings.json'))).toBe(settingsBefore);
    // 3. Every converger target keeps its mtime — the measurement that
    //    separates "the file still says the right thing" from "nothing was
    //    rewritten", and the only one an operator can use to see what a run
    //    actually did.
    expect(targets.map(mtime)).toEqual(before);
    // 4. …except the stamp, which measures THIS run and must not be stale.
    expect(read(join(home, '.ccrc', 'build.json'))).not.toBe(stampBefore);
    // 5. The systemd calls are the same three, in the same order. `enable
    //    --now` on an enabled unit is a no-op by design; what would NOT be safe
    //    is a second run that started restarting things, which is how an
    //    install turns into an outage on a box with live sessions.
    expect(systemctlCalls(home).map((c) => c.argv).slice(callsBefore.length))
      .toEqual(callsBefore);
    // 6. And no run left a temp sibling behind, in any directory a step writes
    //    into — including the two drop-in dirs and the escaped one.
    expect(strays(home)).toEqual([]);
  });
});
