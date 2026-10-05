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
//
// ── LOAD-TIME INSTALLS: THIS FILE RUNS `ccrc install` WHEN IT LOADS ─────────
// Five describes run a whole `runInstall` in a describe-level IIFE, and Vitest
// calls every describe body while COLLECTING the file, before any `-t` filter
// applies (a skipped describe's body included):
//   - `installed` — 'ccrc install: the executables and files it installs'
//   - `units` — 'ccrc install: the units, and the one this box must not be
//     given', a `describeLinux` block whose body still runs on macOS
//   - `box` — 'ccrc install: the launchd job, and what macOS deliberately
//     does not get', a `describeDarwin` block whose body STILL RUNS on Linux
//   - `converged` — 'ccrc install: linger, the account dirs, the hooks and
//     the wrappers'
//   - `skillBox` — 'ccrc install: all three skills reach every rostered
//     account'
// So a mutation of any containment line these runs depend on reaches a real
// `ccrc install` the moment the file is imported, whatever `-t` says. That
// covers `ccrcEnv`'s plants, `runInstall`'s check, and codexLaneFixture.ts'
// fronts and checks. Only the guard under test then stands between that
// install and the box's live user manager. Never RUN this file with such a
// line mutated unless every runner's spawn target is first redirected to a
// recorder. Measure containment pins through `ccrc-uninstall.test.ts`'s
// harness-level cases instead, which build envs and call checks and never a
// verb (Task 11 review fix round 3).
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as pty from 'node-pty';
import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync,
  chmodSync, readdirSync, rmSync, symlinkSync, utimesSync, lstatSync, readlinkSync, realpathSync,
  appendFileSync, renameSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { renderCcdEntry } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { CONTAINED_TOOLS, assertNoRealTool, plantPoison } from './containedTools.js';
import { describeLinux, describeDarwin, itLinux, itDarwin, python3ProgramArm, IS_DARWIN } from './platformFixtures.js';
import { PKG_DESCRIPTION, skillMd } from './graphifySkillFixture.js';
import { TREE_STUBS, installFixtureTree, installVersionedTree, keepDigest, rsyncRecorder } from './installTreeFixture.js';
import { verifyMarker } from '../../shared/mark.mjs';
import {
  plantFakeRuntime, codexRoster, plantSystemd, killLaneProcesses, spawnListener, adoptPlantedSystemd,
  assertSpineFrontContained, spineSystemctlArms, spineSystemdRun, SPINE_CONTAINMENT_PROBE, managerCalls,
  spineRunCalls, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls, ccrcFunction, ccrcLine,
  recordingStub, lockStub, freeLanes, portAccepts, laneAnswer, plantLaneAuth, plantLaneConfig, fakeLitellmSource,
  laneUnits, registerLaneCleanup, GPT_LANE_BINS, codexAuthDir, authDirOf, eventually, plantLiveShape,
  foreignSnapshot, externalCodexRow, REHEARSAL_REGISTRY, writeRehearsalCatalogue, doctorClasses, doctorTable,
  stateCallsNaming, liveShapeRefreshes, foreignCcgptCalls, foreignProbeCalls, assertForeignFront, FOREIGN_MARK,
  withForeignProxyRunning, type ForeignEntry, type RefreshObservation, type StubRc, type LanePorts,
} from './codexLaneFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** The GPT lane's four as `_inst_bins`' closing line names them — FLANKED, so
 *  a longer sibling containing one never satisfies it — derived from the one
 *  test-side list rather than typed again (final review F4). */
const LANE_BINS_IN_LINE = `(?<![\\w-])${GPT_LANE_BINS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(', ')}(?![\\w-])`;

/** `command -v <name>` under THIS process's real PATH. */
function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}

/** bash's absolute path, resolved ONCE, for the same reason
 *  `ccrc-doctor.test.ts:66` resolves it: libuv looks the executable up in the
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

/** The real `python3`, resolved once — NEVER the fixture's own stub (`plant`
 *  in this file's `ccrcEnv`, which answers only `-m venv <path>` and exits 90
 *  on anything else). Fix round 1 item 0(a) / batch B rereview N1's negative
 *  pin spawns this directly, bypassing the fixture PATH, so its parent argv
 *  is genuinely `python3 <path>/ccrc update`, not the fixture's poison. */
const PYTHON3 = realPath('python3');

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
/** The version directory `~/ccrc` points at (W6 Task 2), read from the link
 *  itself — since W6 `_inst_tree` places into `~/ccrc-versions/<name>/` and
 *  flips the link, so `placed()` reads through the link and this names the
 *  directory the verb really wrote (npm's cwd, rsync's destination). */
const versionDir = (home: string, ...rel: string[]): string =>
  join(readlinkSync(join(home, 'ccrc')), ...rel);

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
 *  `node`, `tmux`, `jq`, `flock` and `timeout` are NOT stubbed out of
 *  existence the way the doctor suite stubs them: this fixture's PATH keeps
 *  the real system directories, because the verb runs `node`, `jq` and `rsync`
 *  for real. `df` is the one exception — see below. `python3` left that list
 *  in graphify Task 2: `command -v python3` still resolves it (doctor's own
 *  `_check_python3` is presence-only and stays green), but `ccrcEnv` below
 *  now shadows it with a stub that intercepts `-m venv` — see that stub's own
 *  comment for why a real venv-per-test would be wrong here.
 *
 *  `opts.upstream = false` (A2-NEW) builds the box WITHOUT planting the
 *  upstream binary below — the state the 2d fixtures hid: a truly fresh VM,
 *  where `bash install.sh` has seeded the default roster's one `upstream`
 *  account but nothing has ever installed Claude Code. Every other stub still
 *  lands, because the point is to isolate this ONE absence, not to also break
 *  gh/curl/df/git and drown the assertion in unrelated FAILs. */
function healthyDoctorBox(home: string, opts: { upstream?: boolean } = {}): void {
  const d = join(home, 'doctor-stubs');
  mkdirSync(d, { recursive: true });
  const stub = (name: string, body: string): void =>
    writeFileSync(join(d, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  // `gh auth status --hostname github.com`, answered with the shape a box
  // authenticated for the 'repo' scope really prints (ccrc-doctor.test.ts's
  // GH_OK). It REPLACES `ghContainedEnv`'s poison, and the containment is not
  // weakened by that: this stub never execs the real gh either, and unlike the
  // poison it exits 90 — loudly — on any argv but the one ccrc asks.
  // Hermetic doctor tail (branch review, confirmed major): without this stub
  // the skew check dialed whatever tmux server holds this UID's REAL socket —
  // the verdict depended on the host (red on a legitimately-skewed box, and a
  // wedged server stalled every full-verb test 15s). Versions 9.9/9.9: numbers
  // no packaged tmux prints, so an assertion seeing them proves the host was
  // never asked. Replanted into `.local/bin` on every run, so it shadows both
  // the system tmux and pathWithout's real-tmux symlink. Any argv beyond the
  // two the doctor asks is a loud 90, the fixture's own gh idiom.
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

  // The TWO network calls ccrc makes, answered locally (intended extension,
  // Stage 4 Task 9 — this stub answered one). `mode: local` is the truthful
  // answer for the box this verb builds — a single box whose server drives
  // the fleet itself — and `_check_fleet` SKIPS on it ("there is no second
  // box to disagree with"), which is a check that ran and had nothing to
  // compare rather than a check that failed. `_check_build`'s question — GET
  // /health — is answered with the sha `_inst_stamp` just wrote (read at RUN
  // time, so the answer is the running-server-agrees case whatever sha the
  // fixture repo has), which is what a freshly installed-and-restarted box
  // really reports; the doctor tail therefore PASSes `build`, keeping the
  // "0 warned, 0 failed" close green for its original reason.
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
  //
  // `mkdir` runs UNCONDITIONALLY (A2-NEW): `~/.local/bin` itself is not what
  // `opts.upstream = false` is testing the absence of — it is the shipped
  // stubs' own directory (gh/curl/df above already live there by the time
  // this line runs), and the doctor-side "no $HOME/.local/bin at all" FAIL is
  // a different check with its own test elsewhere in this suite.
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  if (opts.upstream ?? true) {
    writeFileSync(join(home, '.local', 'bin', 'claude'),
      '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
  }
}

/** The names `healthyDoctorBox` and the runner between them put in
 *  `~/.local/bin`. Everything else there was written by the verb — which is
 *  what the "the default roster generates no wrappers" assertion measures. */
const FIXTURE_BINS = [...new Set(['gh', 'curl', 'journalctl', 'systemctl', 'loginctl', 'npm', 'rsync',
  'df', 'claude', 'tmux',
  // graphify Task 2: `python3 -m venv` is stubbed here, never real.
  'python3',
  // macOS: the service manager this box's install actually drives. It is in
  // the list for systemctl's reason — the fixture must ANSWER the shapes ccrc
  // asks without ever reaching the developer's own launchd, whose per-user
  // domain is keyed on the UID and therefore is NOT isolated by $HOME.
  // `flock` is on this list for tmux's reason: ccd refuses BY NAME without it,
  // and macOS does not ship it — so a fixture box that lacks it is testing the
  // refusal rather than the install.
  'launchctl', 'plutil', 'flock',
  // Plan 2b-2 Task 10: the transient-unit launcher's FRONT (every run), and
  // the pair a test's `plantSystemd` left, moved aside as the delegate.
  'systemd-run', '.codex-systemctl', '.codex-systemd-run',
  // Wave 9 R10d (D-3818): every contained name — `ccrcContainedEnv` plants `ssh` and `scp` poisons beside the rest —
  // derived from the one list, so the exact-listing readers do not read a poison as the verb's.
  ...CONTAINED_TOOLS])];

/** A box with a shipped tree on it and nothing else — no `~/.ccrc`, no
 *  `~/.local/bin` beyond the stubs the runner plants. Doctor-healthy, because
 *  the verb ends by running doctor against it and hands back its exit code. */
function freshBox(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  healthyDoctorBox(home);
  return home;
}

/** The e2e the 2d fixtures hid (A2-NEW): `freshBox` above always plants the
 *  fake upstream binary, so no test in this file ever ran the FULL `ccrc
 *  install` transcript against the box a real fresh VM actually starts as —
 *  roster seeded, Claude Code never installed. Everything else is identical
 *  to `freshBox`; only the one binary is missing. */
function freshBoxNoUpstream(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  healthyDoctorBox(home, { upstream: false });
  return home;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc-cli.test.ts:73-95`'s runner environment, and its reasoning applies
 *  here unchanged. The one addition a future task must remember: any new
 *  `CCRC_*` variable this verb learns to read goes in the delete list below,
 *  or a maintainer with it exported in their shell gets a different install
 *  than the fixture asked for. */
/** Plan 2b-2 Task 10: the venv python the `python3` stub writes into a CODEX
 *  runtime generation when no template is planted. It is m-spine H5's shape
 *  kept on purpose, as the positive-marker control: it answers pip honestly
 *  (the `--report` file exists), drains a program on stdin, and exits 0 with
 *  NOTHING on stdout for everything else. A builder that accepted rc 0 alone
 *  would take it for a passing runtime; `ccgpt-runtime` must refuse it at
 *  `probe`. */
const VACUOUS_RUNTIME_PYTHON = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/vacuous-python-calls"',
  'case " $* " in *" - "*) cat >/dev/null ;; esac',
  'if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then',
  '  prev=""',
  '  for a in "$@"; do',
  '    [ "$prev" = "--report" ] && printf \'{"version": "1", "install": []}\\n\' > "$a"',
  '    prev="$a"',
  '  done',
  'fi',
  'exit 0',
].join('\n') + '\n';

function ccrcEnv(home: string, omit: string[] = []): NodeJS.ProcessEnv {
  // Wave 9 R10d (D-3818): a SPINE builder, so `managers: false` — it fronts its own systemctl/systemd-run below,
  // after `adoptPlantedSystemd`, which would rename an unmarked poison to a `.codex-*` delegate (`assertSpineFrontContained`
  // pins those two names). The curl below is a poison, planted over `ccrcContainedEnv`'s.
  const env = ccrcContainedEnv(home, process.env, { managers: false, curl: 'poison' });
  // Task 11's `graphify` doctor check makes `command -v graphify` a real
  // finding (a WARN when PATH resolves it anywhere but the pinned venv), and
  // unlike gh/curl/systemctl below there is no stub-bin entry that can
  // shadow it deterministically: the venv's own bin dir is deliberately
  // never on PATH (`_inst_graphify_engine`'s own header — PATH resolution is
  // the exact footgun the venv exists to avoid), so ANY earlier `graphify`,
  // stub or real, is a shadow the check correctly reports. Same
  // "determinism, not containment" reasoning the `df` stub below already
  // states for "whatever the developer's box happens to have" — this one
  // developer's box carries a real, root-owned /usr/local/bin/graphify (an
  // unrelated, real-world graphify install), which would otherwise WARN on
  // every test in this file's suite, non-deterministically, on exactly one
  // machine.
  //
  // D-1158 GENERALISED THIS FILTER. It used to drop exactly `/usr/local/bin` —
  // the one directory the box this comment was written on happened to keep a
  // stray graphify in. Containment pinned to a path is containment for one
  // machine: a second box keeps an unrelated `graphify` in `$HOME/.local/bin`
  // (dated 2026-07-07, nothing to do with ccrc), so `command -v graphify`
  // resolved THAT, the shadow WARN fired, and `ends with doctor …` failed on a
  // clean tree — while CI, which carries no stray graphify in any directory,
  // stayed green and could never have caught it. The filter is now the PROPERTY
  // the paragraph above always described: no directory but the fixture's own
  // bin may resolve `graphify`.
  const fixtureBin = join(home, '.local', 'bin');
  if (env['PATH']) {
    env['PATH'] = env['PATH'].split(':')
      .filter((p) => p === fixtureBin || !existsSync(join(p, 'graphify')))
      .join(':');
  }
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

  // ── Plan 2b-2 Task 10: the transient-unit launcher, contained ──────────
  // `_inst_codex_tiers` stops and starts tiers through `_svc_run_supervised`,
  // which calls `systemd-run`, and until this task nothing here planted one
  // (m-platform §3.2). The FRONT records and refuses (97) unless a test
  // planted `plantSystemd`, which is adopted as its delegate FIRST, before the
  // `systemctl` below overwrites the planted one (see codexLaneFixture.ts).
  adoptPlantedSystemd(home);
  plant('systemd-run', spineSystemdRun());

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
    // Plan 2b-2 Task 10: the codex tiers' verbs, BEFORE this stub's own arms —
    // its `is-active` answers `active` for every unit, which would read every
    // rostered codex lane as a FOREIGN tier (m-platform §3.3).
    ...spineSystemctlArms(),
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
    // Plan 3a Task 6: EVERY timer refused at once, except the one whose
    // refusal is fatal, so one install measures every degrading enable.
    '    if [ -f "$HOME/fixture-enable-fail-timers" ] && [ "$3" != ccd-cap-scopes.timer ]; then',
    '      case "$3" in *.timer) echo "Failed to enable unit $3: fixture" >&2; exit 1 ;; esac',
    '    fi',
    // Plan 3a Task 6: an instance of ccrc's usage template is enabled the way
    // systemd enables one, by its `timers.target.wants` link, so the doctor at
    // the end of the SAME install reads what this step did (`enable-linger`'s
    // causal chain, below). Only these instances: nothing reads another
    // timer's link.
    '    case "$3" in ccrc-codex-usage@*.timer)',
    '      mkdir -p "$HOME/.config/systemd/user/timers.target.wants"',
    '      ln -sfn "$HOME/.config/systemd/user/ccrc-codex-usage@.timer" "$HOME/.config/systemd/user/timers.target.wants/$3" ;;',
    '    esac',
    '    exit 0 ;;',
    // Plan 3a Task 6: `_inst_codex_usage` withdraws a ccrc usage timer whose
    // lane is no longer a codex lane. Recorded, answered, never a real one;
    // the wants link goes as a manager's `disable` removes it.
    '  disable)',
    '    [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3"',
    '    exit 0 ;;',
    // `restart` is the line `_inst_enable` gained in fix round 1 — deploy's
    // own (deploy.sh:808-810), and the one that makes a re-run replace the
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
    // W6 Task 5 — spec §11's GC reads `show -p ExecStart <unit>`, answered in
    // systemd's REAL struct form (measured on a user unit, 2026-09-23):
    // `path=` is `/usr/bin/env` and the tree path is inside `argv[]`, so a
    // reader of `path=` protects nothing. The argv is the shipped unit's
    // ExecStart with %h expanded (deploy/ccrc.service:19,
    // deploy/ccrc-agent.service:7), `fixture-execstart-<unit>`'s one line
    // when a test plants it; `fixture-execstart-raw` is printed VERBATIM
    // (the unparseable case). Never a bare path.
    '    if [ "$2" = "-p" ] && [ "$3" = "ExecStart" ] && [ -n "$4" ]; then',
    '      if [ -f "$HOME/fixture-execstart-raw" ]; then cat "$HOME/fixture-execstart-raw"; exit 0; fi',
    '      case "$4" in',
    '        ccrc.service) a="/usr/bin/env node $HOME/ccrc/server/dist/server/src/index.js" ;;',
    '        ccrc-agent.service) a="/usr/bin/env node $HOME/ccrc/agent/dist/agent/src/index.js" ;;',
    '        *) echo "fixture systemctl: unexpected argv: $*" >&2; exit 90 ;;',
    '      esac',
    '      if [ -f "$HOME/fixture-execstart-$4" ]; then IFS= read -r a < "$HOME/fixture-execstart-$4"; fi',
    '      echo "ExecStart={ path=/usr/bin/env ; argv[]=$a ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }"',
    '      exit 0',
    '    fi',
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
  // `rsync` is a RECORDER, not a poison: it logs the argv of each call ccrc
  // makes and then EXECS THE REAL BINARY (`rsyncRecorder`, which skips only the
  // implementation's own `--server` re-exec — wave 9 M6). Both halves are
  // load-bearing. Asserting on argv alone passes
  // against a step that composes a perfect command line and copies nothing;
  // asserting on the placed tree alone cannot tell "the excludes are spelled
  // correctly" from "the fixture happened to hold nothing they match".
  plant('rsync', rsyncRecorder(RSYNC));
  // ── python3: graphify's engine venv, contained the same way (Task 2) ─────
  // `_inst_graphify_engine` (graphify Task 2) now runs, on every role but
  // `server`, `python3 -m venv "$venv"` followed by a REAL
  // `"$venv/bin/python" -m pip install "graphifyy==$GRAPHIFY_PIN"` against
  // whatever venv that command just built. Left alone, every `freshBox` in
  // this file — dozens of tests asserting something that has nothing to do
  // with graphify — would build a real venv and reach a real package index:
  // exactly the network dependency `curl`'s poison exists to keep this suite
  // free of, arriving here through a different tool. This stub answers only
  // `-m venv <path>`: it builds the venv's `bin/` itself, with a fake
  // `python` (a recorder — `$HOME/venv-python-calls` — so a test that wants
  // to can still assert on the pip invocation `_inst_graphify_engine` makes
  // through it) and a fake `graphify --version` that agrees with the pin, so
  // the step converges silently for every fixture that plants no venv of its
  // own. `ccrc-install-graphify.test.ts` is the file that actually exercises
  // this step's behaviour (a pre-existing real venv, a version mismatch, the
  // server-role skip); this stub exists only so THIS file's unrelated tests
  // stay hermetic and fast. Any other invocation is a loud refusal — nothing
  // here calls python3 any other way today, and a future one deserves to be
  // seen rather than silently mishandled.
  // Plan 2b-2 Task 10: a CODEX runtime generation (`ccgpt-runtime build`'s
  // `python3 -m venv <gen>`, positional exactly as this stub has always
  // matched, m-runtime-probe HR11) gets either the TEMPLATE a test planted
  // (`fixture-runtime-template` names its directory — copied whole, minus
  // any stamp or pip report, so the builder writes its own) or the VACUOUS
  // python above. Nothing else changes: graphify's venv takes the arm below.
  writeFileSync(join(home, 'fixture-vacuous-python'), VACUOUS_RUNTIME_PYTHON, { mode: 0o755 });
  plant('python3', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/python3-argv"',
    'if [ "$1" = "-m" ] && [ "$2" = "venv" ] && [ -n "$3" ]; then',
    '  case "$3" in',
    '    "$HOME"/.ccrc/runtime/codex/*)',
    '      mkdir -p "$3" || exit 1',
    '      tpl=""',
    '      [ -f "$HOME/fixture-runtime-template" ] && IFS= read -r tpl < "$HOME/fixture-runtime-template"',
    '      if [ -n "$tpl" ] && [ -d "$tpl" ]; then',
    '        cp -R "$tpl/." "$3/" || exit 1',
    '        rm -f "$3/.ccrc-runtime.json" "$3/.ccrc-pip-report.json"',
    '      else',
    '        mkdir -p "$3/bin" && cp "$HOME/fixture-vacuous-python" "$3/bin/python" && chmod 755 "$3/bin/python" || exit 1',
    '      fi',
    '      exit 0 ;;',
    '  esac',
    '  bin="$3/bin"; mkdir -p "$bin" || exit 1',
    '  printf \'#!/bin/sh\\necho "$@" >> "$HOME/venv-python-calls"\\nexit 0\\n\' > "$bin/python"',
    '  chmod 755 "$bin/python"',
    '  printf \'#!/bin/sh\\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\\nexit 0\\n\' > "$bin/graphify"',
    '  chmod 755 "$bin/graphify"',
    '  exit 0',
    'fi',
    // W6 Task 2: the Darwin flip (`_plat_ln_swap`) is `python3 -c` running
    // `os.replace` — a local rename, no index, no network — and the Darwin
    // preflight proves python3 runs with `python3 -c 'import os'`. Those two
    // programs, and ONLY those, go to the REAL interpreter (or every macOS
    // leg dies at its preflight); any other `-c` falls through to the
    // refusal below, which is this stub's contract.
    ...python3ProgramArm(PYTHON3),
    'echo "fixture python3: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT', 'CCRC_VERSIONS_KEEP', 'CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S']) delete env[k];
  // `verify-service.sh`'s own knobs, at the values its header says a test uses:
  // the production defaults sleep 3 + 5 seconds per call, and `_inst_enable`
  // makes one call per install. Zeroed here rather than per test, for the
  // reason `ccrc-doctor.test.ts` zeroes `CCRC_DOCTOR_GH_TIMEOUT` in its own
  // runner — a knob whose only reason to exist is that a test must not wait out
  // a production timeout, and one call site is where it cannot be forgotten.
  env['CCRC_VERIFY_SETTLE'] = '0';
  env['CCRC_VERIFY_WINDOW'] = '0';
  // ── graphify Task 3: CCRC_GRAPHIFY_PKG skips the venv-python PKG
  // resolution `_inst_graphify_skill` would otherwise run. The `python3`
  // stub above only intercepts `-m venv` — the venv it BUILDS carries a
  // fake `bin/python` that answers any argv with exit 0 and no stdout
  // (recorded to `venv-python-calls`, for the engine step's own assertions).
  // Left alone, `install-graphify-skill.sh`'s
  // `"$VENV/bin/python" -c 'import graphify…'` would read that empty stdout
  // as PKG="" and refuse — a fixture reason breaking every unrelated test in
  // this file that runs the full spine (role != server). Pointing this env
  // var at a minimal fixture package here, once, is the smaller change than
  // teaching the shared fake venv python to answer a `-c` argv.
  const gfxPkg = join(home, 'fixture-graphify-pkg');
  mkdirSync(join(gfxPkg, 'skills', 'claude', 'references'), { recursive: true });
  writeFileSync(join(gfxPkg, 'skill.md'), skillMd(PKG_DESCRIPTION));  // the shipped description, not a stub (D-1366)
  writeFileSync(join(gfxPkg, 'skills', 'claude', 'references', 'fixture-ref.md'), 'fixture ref\n');
  // D-1244: `_inst_graph_always_on` reads its block from the same package. A
  // fixture without one made the step SKIP, and a skip is now (correctly) a
  // DEGRADED step — which broke four landing-block tests that assert a clean
  // install says "every step above converged". The fixture, not the rule, was
  // wrong: a box whose engine step converged always has this file.
  mkdirSync(join(gfxPkg, 'always_on'), { recursive: true });
  writeFileSync(join(gfxPkg, 'always_on', 'claude-md.md'),
    '## graphify\n\n- For codebase questions, first run `graphify query "<q>"`.\n');
  env['CCRC_GRAPHIFY_PKG'] = gfxPkg;
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
    noManager?: true;
  } = {}): Result {
  const env = { ...ccrcEnv(home, opts.omit ?? []), ...extraEnv };
  replantDoctorStubs(home);
  for (const [name, body] of Object.entries(opts.stubs ?? {})) {
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  }
  // Fix round 2 (N1/N5): on the FINAL merged env — after extraEnv, the
  // doctor-stub replant and opts.stubs have all landed, immediately before
  // the spawn. `opts.omit`'s own `systemctl`/`systemd-run` entries (if any)
  // are one of exactly TWO legitimate "this call reaches no manager at all"
  // cases in this file (`ccrc install: a box with no systemd`, which also
  // strips both names from every real PATH directory via `pathWithout`). The
  // other is `opts.noManager` (wave 9 M7, D-3812): the `describeDarwin`
  // missing-dependency block's PATH deliberately drops `~/.local/bin`, so
  // neither `systemctl` nor `systemd-run` resolves. Every other call keeps the
  // full strict check.
  const expectAbsent = opts.noManager
    ? ['systemd-run', 'systemctl']
    : (opts.omit ?? []).filter((n) => n === 'systemctl' || n === 'systemd-run');
  assertSpineFrontContained(env, home, { expectAbsent });
  assertNoRealTool(env, home);
  const ccrc = opts.from ?? ccrcIn(treeRoot(home));
  const r = opts.umask === undefined
    ? spawnSync(BASH, [ccrc, ...args], { env, encoding: 'utf8' })
    : spawnSync(BASH, ['-c', `umask ${opts.umask}; exec ${BASH} "$0" "$@"`,
      ccrc, ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The tool `_plat_sha256` runs on this platform (the platform layer's two arms). */
const SHA256_TOOL = process.platform === 'darwin' ? 'shasum' : 'sha256sum';

/** `ccrc version` through the launcher an install placed at
 *  `~/.local/bin/ccrc` — which runs the SHIPPED ccrc, so it is a runner like
 *  `runInstall` and gets the same containment (Task 11 review fix round 3,
 *  C1). Its two callers used to spawn it with `{ ...process.env, HOME }`, so
 *  both manager names resolved to the box's real binaries, and only
 *  `cmd_version` reading nothing but files kept that harmless. `ccrcEnv`
 *  fronts them, and the check refuses the env if it did not. */
function runLauncherVersion(home: string): Result {
  // Wave 9 R10d: `ccrc-uninstall.test.ts`'s N2c pin wants `const r = ` on the line after the spine check (a literal
  // shape), so the real-tool check rides the spawn's own `env` argument: it still runs on the final env, before the spawn.
  const env = ccrcEnv(home);
  assertSpineFrontContained(env, home);
  const r = spawnSync(BASH, [join(home, '.local', 'bin', 'ccrc'), 'version'],
    { env: checkedEnv(env, home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `env`, after `assertNoRealTool` has passed on it (it throws otherwise) — for a spawn that checks inline. */
function checkedEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  assertNoRealTool(env, home);
  return env;
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
  //
  // `diff` joins the list in worker-skill Task 4: all three skill installers
  // refuse by name without it ("refusing rather than rewriting blind"), and
  // `_inst_tree_copy`'s convergence check is a `diff -r -q` too. Without this
  // link, `pathWithout(home, 'git')` — a fixture about ONE absence, which runs
  // the whole verb through to the wrappers step — would instead die at the
  // skills step for a reason the test is not about.
  //
  // `stat` joins it for precisely that reason in D-156: `cmd_wrappers` now
  // names it as an up-front dependency, because the witness index size-gates
  // every file it reads out of ~/.local/bin and a size gate that reads the file
  // anyway when it cannot measure it is not a gate. Measured when the lock
  // landed: without this entry, the git fixture died at the wrappers step and
  // `says GIT IS ABSENT when git is absent` went red — the test's own trap,
  // sprung by a new dependency rather than by anything about git.
  //
  // `awk` joins it in graphify Task 2, for the identical trap: `python3`
  // above is a STUB, so it never reaches real PATH resolution, but the
  // `awk '{print $2}'` `_inst_graphify_engine` pipes `graphify --version`
  // through is a real invocation, unconditional on every role but `server`,
  // and it now runs before the git-absent test's own subject (doctor's `FAIL
  // git`) is ever reached. Measured the same way `stat` was: without this
  // entry, `pathWithout(home, 'git')` died at the new step instead.
  //
  // `realpath` joins it in graphify Task 3, same trap again: measured red —
  // `install-graphify-skill.sh`'s realpath-de-dup block (`_inst_graphify_skill`,
  // right after `_inst_skills`, unconditional on every role but `server`) has
  // no fixture stub, so a PATH missing it fails every home's `realpath
  // "$dir/skills"` and the step's own `rc=1` dies the whole install before the
  // git-absent test's subject is ever reached.
  //
  // grep is the launchctl STUB's own dependency (its `print` arm greps the
  // loaded-labels file): without it every print answers 113, the job reads
  // as never-up, and the enable step's stay-up gate fails the install — a
  // second, hidden absence inside a fixture whose whole subject is ONE
  // absence (measured on the macos leg's second run).
  //
  // `ln` and `readlink` join it in W6 Task 2, the two tools the versioned tree
  // adds to the install path: `_plat_ln_swap` stages the `~/ccrc` flip with
  // `ln -sfn`, and `_ver_layout` reads the link back with plain `readlink`.
  // A PATH without them is a box that places a whole tree and then cannot
  // point at it — a second absence inside a fixture about one.
  //
  // `sha256sum` (`shasum` on macOS — `_plat_sha256`'s two arms) joins it in
  // review 179 fix round 1 (M2), for the same trap in a fourth shape: it is
  // now an INSTALL-path tool. Every placing run measures the tree's digest
  // through it (`_ver_digest_r1`, D-3465), and a PATH without it makes that
  // measurement impossible — so `pathWithout(home, 'git')` would have been a
  // fixture about TWO absences, whose placing run keeps nothing with a WARN.
  // The absence that IS the subject has its own case (`pathWithout(home,
  // SHA256_TOOL)`): the digest is uncomputable, so the version is not kept.
  for (const b of ['mkdir', 'cp', 'mv', 'rm', 'cat', 'chmod', 'cmp', 'date',
    'node', 'git', 'npm', 'rsync', 'bash', 'sleep', 'jq', 'mktemp', 'basename',
    'diff', 'tmux', 'python3', 'flock', 'timeout', 'stat', 'grep', 'awk', 'realpath',
    'ln', 'readlink', SHA256_TOOL,
    // macOS: the service manager, its plist linter, and `uname`. The last one
    // is not decoration — `ccd`'s platform detection prefers bash's own
    // `$OSTYPE` precisely so a PATH without `uname` cannot silently answer
    // "linux", and this list is where that PATH gets built.
    //
    // `uuidgen` and `tr` join the darwin arm for the same trap the entries
    // above document, in the one shape this list had not yet seen: a new
    // dependency that is INVISIBLE ON LINUX. `_inst_node_id` (the W1 part B
    // seed-once identity, `ccd/ccrc:9506`) calls `_plat_uuid`, whose linux arm
    // is `cat /proc/sys/kernel/random/uuid` — a read, no binary at all — and
    // whose darwin arm is `uuidgen | tr 'A-F' 'a-f'`, two of them. So the
    // fixture stayed green on every linux leg while the macos leg died at the
    // new step with `uuidgen: command not found` / `tr: command not found` and
    // then `ccrc: could not mint a node id`, before either test's own subject
    // was reached: measured on run 35598474369, where `says GIT IS ABSENT when
    // git is absent` lost its stamp line and `refuses without rsync` never got
    // to print its refusal. The verb itself is correct there — it names its
    // cause and changes nothing — so the gap is this PATH, not the spine.
    ...(process.platform === 'darwin' ? ['launchctl', 'plutil', 'uname', 'uuidgen', 'tr'] : [])]) {
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
  '.config/systemd/user/app-claude\\x2dsession.slice.d',
  // Worker-skill Task 4: `_inst_tree_copy` stages a whole DIRECTORY beside its
  // target under `.cc-sessions` (already listed above), and each skill
  // installer stages one beside ITS target, inside the account config dir's
  // `skills/`. The default roster's single account is `claude`, so that is the
  // one this sweep can reach on a `freshBox`; a temp left there is a
  // half-copied skill tree sitting where a session resolves its skills.
  '.claude/skills'];

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
/** The five-account test roster as file bytes — the "operator already has a
 *  roster" fixture. Serialised from `DEFAULT_TEST_ROSTER` (the root copy)
 *  rather than read from a shipped file: the shipped migration roster this
 *  used to read left the tree with the stage-5 de-brand (spec §5, D-202). */
const FIVE_ACCOUNT_ROSTER = `${JSON.stringify(DEFAULT_TEST_ROSTER, null, 2)}\n`;

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

// Wave 9 M6 (D-3811). openrsync — macOS's /usr/bin/rsync — copies locally by
// forking `rsync --server …` through PATH, so a recorder first on PATH is
// reached a second time by the implementation's own re-exec. Samba rsync on
// Linux copies in-process and never does, so this twin runs a fake that DOES
// re-exec on every platform. The recorder must log the call ccrc made and
// hand the `--server` call straight on.
describe('the rsync recorder logs only the call ccrc made (wave 9 M6)', () => {
  const setup = (fakeBody: string): { dir: string; env: NodeJS.ProcessEnv } => {
    const dir = mkTmp('ccrc-rsync-recorder-');
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'poison'));
    writeFileSync(join(dir, 'bin', 'rsync'), rsyncRecorder(join(dir, 'fake-openrsync')), { mode: 0o755 });
    writeFileSync(join(dir, 'fake-openrsync'), fakeBody, { mode: 0o755 });
    // A recorder that was not executable would fall through to this, never to the real rsync.
    writeFileSync(join(dir, 'poison', 'rsync'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/rsync-poison"\nexit 97\n', { mode: 0o755 });
    return { dir, env: { HOME: dir, PATH: `${dir}/bin:${dir}/poison:/usr/bin:/bin` } };
  };

  it('a local copy that re-execs `rsync --server` through PATH reaches the recorder twice and is logged once', () => {
    const { dir, env } = setup('#!/bin/sh\nif [ "$1" = --server ]; then touch "$HOME/server-ran"; exit 0; fi\n'
      + 'rsync --server --sender -logDtpre.iLsfxC . "$2"\nexit 0\n');
    const r = spawnSync('sh', [join(dir, 'bin', 'rsync'), '-a', 'src/', 'dst/'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'rsync-argv'), 'utf8')).toBe('-a src/ dst/\n');
    expect(existsSync(join(dir, 'server-ran')), 'the fake\'s --server arm never ran through the recorder').toBe(true);
    expect(existsSync(join(dir, 'rsync-poison')), 'the recorder fell through to the poison').toBe(false);
  });

  it('control: a copy that never re-execs is logged once too', () => {
    const { dir, env } = setup('#!/bin/sh\nexit 0\n');
    const r = spawnSync('sh', [join(dir, 'bin', 'rsync'), '-a', 'src/', 'dst/'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'rsync-argv'), 'utf8')).toBe('-a src/ dst/\n');
    expect(existsSync(join(dir, 'rsync-poison'))).toBe(false);
  });
});

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

  it('refuses BY ARTIFACT when the agent build is missing — and only for a role that runs one (D-1159)', () => {
    // The third artifact, the third sentence. This one is role-gated because
    // the artifact is: `fleet` is the ONLY role that installs the agent unit
    // (`_inst_units`) or enables and restarts it (`_inst_enable`) — both test
    // `[ "$INST_ROLE" = fleet ]`. D-1161 corrected this gate from `!= server`,
    // which refused the DEFAULT role over a unit that role never installs, and
    // corrected this comment, which had asserted the opposite.
    //
    // WHAT THIS COSTS WHEN IT IS MISSING, measured on the reference fleet
    // before the preflight existed: `install.sh` builds server and pwa only, so
    // `ccrc install --role fleet` from a source checkout placed the tree, then
    // restarted a LIVE fleet's agent onto a directory with no entry point. The
    // agent died with MODULE_NOT_FOUND and the server lost its only path to the
    // box. A refusal before the copy is the whole difference.
    const home = freshBox('ccrc-install-noagent-');
    rmSync(treeFile(home, 'agent/dist/agent/src/index.js'));
    // `--role fleet` asks for the agent's URL and bearer token when
    // `~/.ccrc/agent.env` is absent, and refuses on a non-tty long before the
    // preflight under test. A box that has already been configured — which is
    // every box a re-install runs on, and the one this outage happened on —
    // carries it, so the fixture does too.
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: no agent build at .*\/checkout\/agent\/dist — build first: bash install\.sh \(or npm run build in agent\/\)$/m);
    // BEFORE anything moved — the same property the two preflights above pin.
    expect(existsSync(placed(home)), 'the tree was placed before it was checked').toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran anyway').toBe(false);
  });

  it('does NOT demand an agent build for --role both, the DEFAULT role (D-1161)', () => {
    // The gate's sharp edge. `both` is a single box that serves AND runs
    // sessions, and it drives ccd directly in `local` mode — `_inst_units`
    // gives it `ccrc.service`, never `ccrc-agent.service`, and `_inst_enable`
    // never starts one. The first draft of the D-1159 preflight gated on
    // `!= server`, so it refused the default install over an artifact that role
    // has no use for: a new failure mode introduced by the fix for an old one.
    const home = freshBox('ccrc-install-noagent-both-');
    rmSync(treeFile(home, 'agent/dist/agent/src/index.js'));
    const r = runInstall(home, ['install', '--role', 'both']);
    expect(r.stderr, 'the default role must not be refused for a unit it never installs')
      .not.toMatch(/no agent build at/);
    expect(r.code, r.stderr).toBe(0);
  });

  it('--role server skips every per-account step — no config dir, hooks, skills, wrappers or session files are written on a box that hosts no sessions', () => {
    // 2026-09-19, measured on the live server box: the spine converged 17
    // accounts there — dirs, settings.json hooks (the operator's own ~/.claude
    // included), skills, wrappers, and their statusline moved aside — while
    // doctor's `skills` check SKIPs that role as "hosts no sessions". The
    // installer now says the same thing the doctor says.
    const home = freshBox('ccrc-install-server-skips-accounts-');
    gitInit(treeRoot(home));   // a readable stamp, so the record can name a sha
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    for (const step of ['files', 'dirs', 'hooks', 'skills', 'wrappers']) {
      expect(r.stdout).toMatch(new RegExp(`^install: ${step}: skipped — a server-role box hosts no sessions`, 'm'));
    }
    expect(existsSync(join(home, '.claude', 'skills', 'ccrc-worker')), 'a skill was placed on a server-role box').toBe(false);
    expect(existsSync(join(home, '.claude', 'settings.json')), 'hooks were registered on a server-role box').toBe(false);
    expect(existsSync(join(home, '.cc-sessions', 'session-hook.sh')), 'session files were placed on a server-role box').toBe(false);
    // …and the record is still written LAST, so `update --check` reads a completed install.
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(true);
  });

  it('does NOT demand an agent build for --role server (D-1159)', () => {
    // The gate is not decoration: a server-only box runs no agent unit, so an
    // absent agent build is not a fault there. Without this the preflight would
    // refuse installs it has no business refusing.
    const home = freshBox('ccrc-install-noagent-server-');
    rmSync(treeFile(home, 'agent/dist/agent/src/index.js'));
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.stderr, 'a server-role install must not be refused for a missing agent')
      .not.toMatch(/no agent build at/);
  });

  it('installs the AGENT runtime deps too, on a fleet box (D-1161)', () => {
    // D-1159 made the agent's ENTRY POINT exist. It did not make the tree
    // STARTABLE: `_inst_tree`'s rsync excludes `node_modules` in both
    // directions and this step ran npm in `server/` only, so a fleet install
    // placed `agent/dist` beside no `agent/node_modules` — and `agent/src/
    // server.ts` imports `ws` on line 6. `_inst_enable` then restarts
    // `ccrc-agent.service` and node dies with the SAME ERR_MODULE_NOT_FOUND,
    // one import further in. The reference fleet escaped it only because an
    // earlier `deploy.sh agent` had left a node_modules behind, which is why
    // the postmortem saw the missing dist and stopped there.
    const home = freshBox('ccrc-install-npm-agent-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code, r.stderr).toBe(0);
    // TWO npm ci calls, production-only, in that order — and in the PLACED
    // tree both times, never in the checkout.
    expect(read(join(home, 'npm-argv')).trim().split('\n')).toEqual([
      'ci --omit=dev --no-audit --no-fund',
      'ci --omit=dev --no-audit --no-fund',
    ]);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([
      versionDir(home, 'server'),
      versionDir(home, 'agent'),
    ]);
    expect(existsSync(placed(home, 'agent', 'node_modules'))).toBe(true);
    expect(r.stdout).toMatch(/^install: tree: agent runtime deps in place$/m);
  });

  it('does NOT run npm in the agent on a role that runs no agent (D-1161)', () => {
    // The other side of the same gate: a `both` box has no agent unit, so an
    // npm ci there is work for nothing — and would fail on a tree whose agent
    // lockfile the box never needed.
    const home = freshBox('ccrc-install-npm-both-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([versionDir(home, 'server')]);
    expect(r.stdout).not.toMatch(/agent runtime deps/);
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
    // W6 Task 2: placed into the version directory and flipped to; a
    // checkout nothing measures is `unstamped-<12 hex>`.
    expect(r.stdout).toMatch(/^install: tree: placed unstamped-[0-9a-f]{12} at \$HOME\/ccrc-versions\/unstamped-[0-9a-f]{12}$/m);
  });

  it('leaves node_modules, .git, env files and the mail token in the checkout', () => {
    // Every one of these is a real thing a checkout holds at install time. The
    // two secrets are the sharp ones: `deploy/ccrc.env` and
    // `deploy/ccrc-mail.token` are gitignored files carrying live tokens, and
    // rsync's `-a` would copy them at whatever mode the checkout has (0644
    // under a plain umask) into a second, unmanaged location — deploy.sh's own
    // excludes exist for exactly that (`:335-342`).
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
    // In the placed version's `server/`, never in the checkout: a box whose
    // service boots out of `~/ccrc` needs the deps in the tree it points at.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(versionDir(home, 'server'));
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
      /^ccrc: npm ci in \$HOME\/ccrc-versions\/unstamped-[0-9a-f]{12}\/server failed — the service cannot start without runtime deps$/m);
    expect(r.stdout, 'npm\'s chatter landed in the install transcript')
      .not.toContain('npm notice');
    expect(r.stdout).not.toMatch(/^install: tree: server runtime deps in place$/m);
  });

  it('run FROM a real $HOME/ccrc, it MIGRATES rather than copying onto itself: the tree is placed as a version, $HOME/ccrc becomes the link, and the old directory goes only once the doctor gate has passed (W6 Task 3)', () => {
    // The box a deploy already touched, and the box a second pre-W6 `ccrc
    // install` ran on: `ccrc` is at `~/ccrc/ccd/ccrc`, a real directory. It
    // is no longer the destination — the tree goes to ~/ccrc-versions/<name>,
    // so there is nothing to copy onto itself — and the directory is moved
    // aside, not deleted, until this install's own gate (its doctor, with
    // the update lock free) has passed.
    const home = mkTmp('ccrc-install-selfcopy-');
    const root = installFixtureTree(home, 'ccrc');
    // The only fixture in this describe that does not come from `freshBox`
    // (its tree has to BE `~/ccrc`), so it asks for the doctor half by hand.
    healthyDoctorBox(home);
    const r = runInstall(home, ['install'], {}, { from: ccrcIn(root) });
    expect(r.code, r.stderr).toBe(0);
    // No git, no build.json and no box stamp: the source names itself
    // `unstamped-<12 hex>` (D-3425), read back off the link.
    const target = readlinkSync(placed(home));
    const name = path.basename(target);
    expect(name).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(target).toBe(join(home, 'ccrc-versions', name));
    // ONE rsync, from the directory INTO the version — never onto itself.
    const argv = read(join(home, 'rsync-argv')).trim().split('\n');
    expect(argv).toHaveLength(1);
    expect(argv[0]!.endsWith(` ${join(home, 'ccrc-versions', name)}/`), argv[0]).toBe(true);
    expect(existsSync(join(home, 'ccrc-versions', name, 'ccrc')), 'the tree was copied inside itself').toBe(false);
    const lines = r.stdout.split('\n');
    expect(lines).toContain(`install: tree: migrating — $HOME/ccrc is a directory; ${name} is complete at $HOME/ccrc-versions/${name}`);
    expect(lines).toContain(`install: tree: $HOME/ccrc -> $HOME/ccrc-versions/${name} (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)`);
    // The old tree went AFTER the doctor had measured the box — the removal
    // line follows doctor's summary — and the marker went with it.
    const summary = r.stdout.lastIndexOf('\nsummary: ');
    const removed = r.stdout.indexOf('install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate');
    expect(summary, 'doctor printed no summary').toBeGreaterThan(-1);
    expect(removed, r.stdout).toBeGreaterThan(summary);
    expect(existsSync(join(home, 'ccrc.migrating'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'migrating-to'))).toBe(false);
    // …and the deps were installed in the VERSION, whose tree now runs.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(join(home, 'ccrc-versions', name, 'server'));
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
    expect(existsSync(join(home, 'ccrc-versions')), 'the versions root was made before rsync was known to be there').toBe(false);
  });

  it('replaces a file whose size and mtime are unchanged but whose content is not', () => {
    // The release tarball is reproducible (`build-release.sh`: `--mtime=@0`),
    // so every file `ccrc update` extracts — and therefore every file it placed
    // last time — has mtime 0. rsync's default quick check compares size and
    // mtime only, so a changed file that kept its size was SKIPPED. v0.0.11 hit
    // exactly that: dist-pwa/index.html and sw.js are fixed-size templates
    // around equal-length content hashes, so the new bundle landed, --delete
    // removed the old one, and the old index.html kept pointing at it — a
    // black screen on any load the service worker did not answer.
    const home = freshBox('ccrc-install-same-size-');
    // W6 Task 2: one commit, so both runs name the same version and the
    // second rsyncs IN PLACE — the only placement where a file of the same
    // size and mtime is already at the destination for the quick check to skip.
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const rel = 'server/dist-pwa/index.html';
    const before = read(placed(home, ...rel.split('/')));
    const after = before.replace(/./, c => (c === 'X' ? 'Y' : 'X'));
    expect(after.length).toBe(before.length);
    expect(after).not.toBe(before);
    writeFileSync(treeFile(home, rel), after);
    utimesSync(treeFile(home, rel), 0, 0);
    utimesSync(placed(home, ...rel.split('/')), 0, 0);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: reinstalled untagged-[0-9a-f]{12} in place at \$HOME\/ccrc-versions\/untagged-[0-9a-f]{12} \(the version \$HOME\/ccrc points at; same name, same release\)$/m);
    expect(read(placed(home, ...rel.split('/')))).toBe(after);
    expect(read(join(home, 'rsync-argv'))).toContain('--checksum');
  });

  it('a second run keeps the runtime deps the first one installed', () => {
    // `--delete` with `--exclude node_modules` protects the excluded path on
    // the RECEIVER (rsync does not delete what it was told to ignore, absent
    // `--delete-excluded`). Drop that exclude and every re-install wipes
    // `~/ccrc/server/node_modules` — on the live box, that is a server with no
    // runtime deps for however long the reinstall takes.
    const home = freshBox('ccrc-install-deps-survive-');
    // W6 Task 2: one commit, so the second run is the same version, in place.
    gitInit(treeRoot(home));
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

  it('the fixture tree carries the four GPT-lane executables the repository ships, and no `ccgpt`', () => {
    // Plan 2b-2 wrote `ccgpt-runtime` and the launcher `ccrc-codex` unplaced,
    // because a file may land before its install line but never after it.
    // Both then joined `_inst_bins` and this fixture in one commit, so all
    // four are COPIED from the repository like every other executable. They
    // are never stubbed: a stub once let a placement pass here while a real
    // tree would die (D-3165). The pin this case replaced held both OUT of the
    // fixture tree (and `ccgpt-runtime` in the repository) until that commit,
    // and flipping it was that commit's intended red.
    //
    // And NOT `ccgpt` (D-3478): on a live fleet box `$HOME/.local/bin/ccgpt`
    // is another repository's launcher, so the repository ships no file of that
    // name for any installer to place over it.
    const home = mkTmp('ccrc-tree-ccgpt-');
    const root = installFixtureTree(home);
    for (const rel of GPT_LANE_BINS.map((n) => `ccd/${n}`)) {
      const p = join(root, rel);
      expect(existsSync(p), `${rel} missing from the fixture tree`).toBe(true);
      expect(readFileSync(p), `${rel} is not the repository's bytes`).toEqual(readFileSync(join(REPO, rel)));
      // 0o111 — all four are placed 755 by `_inst_bins`, and copied at the repo's mode.
      expect(statSync(p).mode & 0o111, `${rel} is not executable`).toBeGreaterThan(0);
    }
    expect(existsSync(join(REPO, 'ccd', 'ccgpt')),
      'the repository ships ccd/ccgpt — an installer could place it over another repository\'s live launcher').toBe(false);
    expect(existsSync(join(root, 'ccd', 'ccgpt')), 'the fixture tree carries a ccd/ccgpt').toBe(false);
  });

  it('GPT_LANE_BINS is what _inst_bins\' GPT-lane gate places, in the order its closing line names them (final review F4, a text pin)', () => {
    // The ONE test-side list the install and uninstall suites share. The
    // product's two spellings of it, both inside the `!= server` gate: the
    // `_inst_atomic` calls, and the `lane_bins=` literal the closing line
    // carries. A fifth executable, a rename or a new order in either reds
    // here, before any case written from the constant can drift.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_inst_bins\(\) \{[^\n]*\n[\s\S]*?\n\}\n/m.exec(src)?.[0] ?? '';
    const gate = /^ {2}if \[ "\$INST_ROLE" != server \]; then\n([\s\S]*?)\n {2}fi\n/m.exec(fn)?.[1] ?? '';
    expect(gate, 'no `!= server` gate in _inst_bins this pin can read — re-anchor it').not.toBe('');
    const placed = [...gate.matchAll(/^\s*_inst_atomic "\$tree\/ccd\/([^"]+)"\s+"\$bin\/\1"\s+755$/gm)].map((m) => m[1]);
    expect(placed).toEqual([...GPT_LANE_BINS]);
    const said = /^\s*lane_bins=", ([^"]+)" lane_note=""$/m.exec(gate)?.[1];
    expect(said?.split(', ')).toEqual([...GPT_LANE_BINS]);
  });

  it('the whole-spine cases the final review measured near the 20 s default carry an explicit bound (final review F4, a text pin)', () => {
    // Each one's closing line, found from its own title: dropping a bound
    // reds here rather than as a load flake a week later.
    const src = read(fileURLToPath(import.meta.url));
    for (const title of [
      'writes ~/.ccrc/installed LAST, naming the stamped sha',
      'floor: written by the LAST step from the stamped tag',
      'ccrc version says when the install was placed unsigned',
      'a codex lane and a passing runtime: built, stamped',
      'a runtime whose probe FAILS degrades the install',
    ]) {
      const at = src.indexOf(`  it('${title}`);
      expect(at, `no case titled ${title}`).toBeGreaterThan(-1);
      const close = /^ {2}\}(?:, ([0-9_]+))?\);$/m.exec(src.slice(at));
      expect(close?.[1], `'${title}' runs under the default bound again`).toBe('60_000');
    }
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

  it("seeds the remote-control flag OFF — one line, and the trailing newline its reader requires", () => {
    // Stage 2e, Task 2. THE ASSERTION IS ON THE BYTES, and that is the whole
    // point of it: `ccd`'s `_rc_enabled` reads this file with
    // `IFS= read -r first < "$CCRC_RC_FILE"`, and bash's `read` returns
    // NON-ZERO at EOF-before-delimiter — so `printf 'on' > file` (no newline)
    // reads as OFF. The direction is fail-safe and deliberately left that way
    // (D-99), which makes the trailing newline this writer's obligation rather
    // than the reader's problem. A `toContain('off')` would pass with the
    // newline dropped, i.e. against a writer that produces a file whose only
    // honest reading is "unparseable".
    //
    // OFF on a FRESH box, not on: `--remote-control` publishes a session to
    // claude.ai, and a box nobody asked that of must not start doing it
    // because an installer defaulted it. The reference fleet gets `on` from
    // the other lane (deploy.sh), where the box's existing behaviour is the
    // reason.
    const home = freshBox('ccrc-install-fresh-rc-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'remote-control'))).toBe('off\n');
    expect(r.stdout).toMatch(
      /^install: remote-control: off \(fresh installs default off — edit ~\/\.ccrc\/remote-control to 'on' for claude\.ai discoverability\)$/m);
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
    // The five-account test roster. `claude-b` appears in
    // it and in nothing the seed could produce, so its presence in the
    // generated bash is proof the generator read the INSTALLED roster rather
    // than the shipped default — the local translation of deploy's
    // read-the-box's-copy-back rule.
    const home = freshBox('ccrc-install-kept-roster-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
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
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(FIVE_ACCOUNT_ROSTER);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-b');
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
      // LOOPBACK, and not by accident (W4, design 2026-09-20 §12): with the
      // gate off, a routable bind is exactly what doctor's `update-exposure`
      // check FAILs — this box's routes answer anyone who can reach it — and
      // this test is about a file being KEPT, not about that finding. The
      // `fleet`/`config` reasoning below is the same rule.
      'CCRC_HOST=127.0.0.1',
      'CCRC_PORT=9999',
      // Both agent keys, because `CCRC_FLEET=remote` with either one missing is
      // a config the server REFUSES TO BOOT on (server/src/index.ts:75-79), and
      // doctor's `config` check reproduces that refusal at the end of this same
      // run. A half-configured remote box is a real state and it has its own
      // test in ccrc-doctor.test.ts; this test is about a file being kept, and
      // a fixture that was also secretly a broken-config fixture would fail for
      // the wrong reason.
      'CCRC_AGENT_URL=ws://198.51.100.7:7789',
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

  it('keeps a remote-control flag the box already had, byte for byte, on every re-run', () => {
    // The THIRD file on the user-owned side of `deploy.sh:196-206`'s rule, and
    // the one whose overwrite is loudest: this flag decides what every session
    // on the box is SPAWNED AS, so a step that rewrote it would change the
    // shape of ~11 live panes at their next respawn — the exact outage D-99
    // records and the reason Task 1's ccd was deploy-blocked until this step
    // existed.
    //
    // TWO RUNS, because "seed once" and "never overwrite" are two claims and
    // only the second one is about a box that has already been installed. The
    // bytes are compared whole (not "contains on") for `_inst_env`'s reason:
    // an operator's file is theirs, including the newline they ended it with.
    const home = freshBox('ccrc-install-kept-rc-');
    preexisting(home, 'remote-control', 'on\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'remote-control'))).toBe('on\n');
    expect(r.stdout).toMatch(/^install: remote-control: kept \(operator-owned\)$/m);
    const again = runInstall(home);
    expect(again.code, again.stderr).toBe(0);
    expect(read(dotCcrc(home, 'remote-control'))).toBe('on\n');
    expect(again.stdout).toMatch(/^install: remote-control: kept \(operator-owned\)$/m);
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
  // file's own header bans and which `cmd_wrappers` (ccd/ccrc:1184-1190)
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
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).not.toMatch(/move it aside/);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(FIVE_ACCOUNT_ROSTER);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'ccrc.env'))).toBe(false);
  });
});

describeLinux('ccrc install: a box with no systemd', () => {
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

describe('ccrcEnv: containment (wave 9 R10d)', () => {
  it('ccrcEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('ccrc-install-contained-');
    expect(() => assertNoRealTool(ccrcEnv(home), home)).not.toThrow();
  });
});

// The same probe, on the platform where the missing dependency is real. macOS
// ships neither tmux nor flock, and its /bin/bash is 3.2.57 — so on this
// platform the refusal an operator actually meets is one of THOSE, and it
// carries the same three promises the systemd one does: by name, before the
// first write, with a remedy that works.
// Wave 9 M7 (D-3812): runInstall's `noManager` option.
describe('runInstall: the noManager option (wave 9 M7)', () => {
  itLinux('noManager makes the final-env check require BOTH manager names absent — under ccrcEnv they resolve to the fixture front, so it refuses (wave 9 M7)', () => {
    expect(() => runInstall(freshBox('ccrc-install-nomgr-'), ['install'], {}, { noManager: true }))
      .toThrow(/systemd-run was expected absent/);
  }, 60_000);   // freshBox builds a whole tree: measured past the 20 s default under load 30-50 (final review)
});

describeDarwin('ccrc install: a macOS box missing what ccd needs', () => {
  // `omit` alone is not enough here: `runInstall` calls `replantDoctorStubs`
  // on every run, which copies `healthyDoctorBox`'s stubs back into
  // ~/.local/bin — so a tool this test wants ABSENT has to leave both places.
  // (Measured: without the second delete, tmux was re-planted, the gate never
  // fired, and the run died at the wrappers step for a reason this test is
  // not about.)
  // THE PATH IS BUILT EXPLICITLY, not by `pathWithout` alone, and the reason
  // is worth stating: `pathWithout` puts `~/.local/bin` at the HEAD, and that
  // directory is where the fixture's own stubs live — `ccrcEnv` plants them
  // and `replantDoctorStubs` puts them back on every run. A test about a tool
  // being ABSENT cannot leave that directory on PATH, because the stub of the
  // very tool it removed is in it. (Measured: with it, `launchctl` resolved to
  // the stub, the gate never fired, and the run died at the wrappers step for
  // a reason this test is not about.)
  //
  // Dropping it costs nothing HERE as to STUBS: every one of these probes
  // runs BEFORE the first of the fourteen steps, so no step is reached that
  // would want `claude`, `gh` or any other planted stub. It DOES cost something
  // on the macOS runner (wave 9 R10d, D-3821): `pathMissing` would keep only
  // `<home>/no-<tool>-bin`, which symlinks real binaries (`pathWithout`'s list)
  // — always `tmux` and, on darwin, `launchctl` — so with `~/.local/bin` gone a
  // real tmux and a real launchctl would resolve (gh, curl and ssh resolve
  // nowhere). So the PATH leads with a poison dir of its own, FIRST: a recording
  // poison for every contained name but the tool this case removes and the two
  // managers (the case reaches no manager — `noManager`). The probes only ask
  // `command -v` (the darwin dependency probes in ccd/ccrc), so a poison satisfies
  // a probe it is not the subject of.
  const pathMissing = (home: string, tool: string): string => {
    const full = pathWithout(home, tool);
    const poison = join(home, `no-${tool}-poison-bin`);
    mkdirSync(poison, { recursive: true });
    for (const n of CONTAINED_TOOLS) if (n !== tool && n !== 'systemctl' && n !== 'systemd-run') plantPoison(poison, n);
    return [poison, ...full.split(':').slice(1)].join(':');
  };

  it('refuses by name BEFORE the first write when tmux is absent', () => {
    const home = freshBox('ccrc-install-notmux-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'tmux') },
      { omit: ['tmux'], noManager: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tmux is required by ccrc/);
    expect(r.stderr).toMatch(/brew install tmux/);
    // NOTHING was written — the promise this probe exists to keep, and the
    // reason it sits ahead of the fourteen steps rather than inside them.
    expect(existsSync(join(home, '.ccrc')), '$HOME/.ccrc was created anyway').toBe(false);
    expect(existsSync(placed(home)), 'the tree was placed anyway').toBe(false);
    expect(existsSync(join(home, '.tmux.conf'))).toBe(false);
    expect(r.stdout).toBe('');
  });

  it('refuses when flock is absent, naming the formula that provides it', () => {
    const home = freshBox('ccrc-install-noflock-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'flock') },
      { omit: ['flock'], noManager: true });
    expect(r.code).toBe(1);
    // ccd already refuses BY NAME at three workspace sites without it, so the
    // outcome this prevents is a box that installs cleanly and then cannot
    // make a single workspace.
    expect(r.stderr).toMatch(/flock is required by ccrc/);
    expect(r.stderr).toMatch(/brew install flock/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(r.stdout).toBe('');
  });

  it('refuses when launchctl is absent — systemd\'s probe, on this platform', () => {
    const home = freshBox('ccrc-install-nolaunchctl-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'launchctl') },
      { omit: ['launchctl'], noManager: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/launchctl is required by 'ccrc install'/);
    // The two conditions stay apart, exactly as they do on Linux: this is not
    // "launchd refused these jobs".
    expect(r.stderr).not.toMatch(/bootstrap failed/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
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
    writeFileSync(dotCcrc(home, 'accounts.json'), FIVE_ACCOUNT_ROSTER);
    // The external account that roster declares — see the kept-roster test
    // above: doctor's `wrappers` check runs at the end of this install too, and
    // an `external` account with no executable is a FAIL nobody here is asking
    // about.
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-b');
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
    // D-3696: what reaches PATH is now the LAUNCHER rendered from the placed
    // tree's template, and the byte copy is the BODY at libexec — the pair is
    // asserted whole below the original case.
    const { home } = installed;
    const bin = join(home, '.local', 'libexec', 'ccrc', 'ccd');
    expect(existsSync(bin), 'ccd\'s body never reached $HOME/.local/libexec/ccrc').toBe(true);
    // `'ccd/ccd'` as ONE segment, deliberately. `single-definition.test.ts`'s
    // extraction guard treats two adjacent quoted `ccd` arguments as a second
    // path to the REPOSITORY's ccd script (which must be reached only through
    // `ccdWsHelpers.ts`). This is a different file — the copy inside a fixture
    // box's `~/ccrc` — so the answer is to not wear that shape, rather than to
    // add this file to the guard's exclusion list and blind it to a real second
    // spelling arriving here later.
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd/ccd')));
    expect(mode(bin)).toBe(0o644);
    // The launcher: the placed template rendered for the canonical python3 its
    // own shebang names and the body's digest — nothing else, byte for byte.
    const entry = join(home, '.local', 'bin', 'ccd');
    const python = /^#!(\S+) -IS\n/.exec(read(entry))?.[1];
    expect(python, 'the launcher does not open with an absolute isolated-python shebang').toMatch(/^\//);
    expect(read(entry)).toBe(renderCcdEntry(read(placed(home, 'ccd/ccd-entry.py')), python!,
      createHash('sha256').update(readFileSync(bin)).digest('hex')));
    expect(mode(entry)).toBe(0o755);
  });

  itLinux('ccd-cap-scopes lands beside it — the OOM guardrail is an executable too', () => {
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-cap-scopes');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-cap-scopes')));
    expect(mode(bin)).toBe(0o755);
  });

  it('ccd-account-auth lands beside them on EVERY platform — macOS is supported', () => {
    // A plain `it`, where the two around it are `itLinux`. That is not an
    // oversight: `login` and `paste` drive a plain pipe and touch no
    // `script(1)`, so a Mac gets the DEFAULT path from this binary rather than
    // a no-op, and only the two pane methods degrade — inside the helper, at
    // runtime, with `pane-unsupported-here`.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-account-auth');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-account-auth')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-graph-sweep lands beside it too (graphify Task 10, O3/O6b) — every role, but not Darwin', () => {
    // Mirrors the `ccd-cap-scopes` case above, byte for byte: `_inst_bins`
    // ships this one on every role the same way, and rides the same darwin
    // carve-out (its systemd timer never installs there; the script needs
    // GNU stat/date and flock(1)). Its UNIT and ENABLE are additionally
    // role-gated (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-graph-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-graph-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-telemetry-keepalive lands beside it too (spec 2026-09-07 §C) — every role, but not Darwin', () => {
    // Mirrors the `ccd-graph-sweep` case above, byte for byte: `_inst_bins`
    // ships this one on every role the same way, and rides the same darwin
    // carve-out (its systemd timer never installs there; the script needs GNU
    // date/stat, flock(1) and jq). Its UNIT and ENABLE are additionally
    // role-gated (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-telemetry-keepalive');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-telemetry-keepalive')));
    expect(mode(bin)).toBe(0o755);
  });

  it('places the four GPT-lane executables on PATH, 755 — both platform arms', () => {
    // Unlike the three darwin-gated cases above, none of these is a timer-only
    // tool reserved to the systemd arm. `ccrc-codex` is the launcher every
    // generated Codex wrapper execs and `ccgpt-runtime` builds the runtime its
    // tiers run on — commands, on both arms, because the lifecycle's `nohup`
    // fallback makes a box with no user manager a supported one.
    // `ccgpt-proxy.py` is the shim a tier runs, and `ccgpt-usage.py` is placed
    // so an operator can run it by hand (no installer places its timer yet).
    // They ARE role-gated, `!= server` (spec §11): this install is role `both`,
    // the fleet describe pins `fleet`, and the `--role server` case pins their
    // absence.
    //
    // Fix round 1, Finding 1: each name joined `_inst_bins` no earlier than
    // the commit that wrote its source, because `_inst_atomic` dies on a
    // missing source by design. So this case covered only the two `.py`
    // files until Plan 2b-2 placed `ccgpt-runtime` and `ccrc-codex`, and it
    // was extended to four in the commit that placed them.
    const { home } = installed;
    for (const name of GPT_LANE_BINS) {
      const bin = join(home, '.local', 'bin', name);
      expect(readFileSync(bin), `${name} was not placed`).toEqual(readFileSync(placed(home, 'ccd', name)));
      expect(mode(bin), `${name} mode`).toBe(0o755);
    }
  });

  itLinux('the DARWIN arm of _inst_bins, forced on Linux (OSTYPE=darwin23): the four GPT-lane executables on both and fleet, none on server', () => {
    // Final review F-8 (DAR-1): the two-arm placement and the Darwin closing
    // line were pinned only by `itDarwin`/`process.platform` branches, and no
    // CI leg runs those. `ccd/ccrc` takes its arm from `$OSTYPE` first
    // (ccd/ccrc's platform block), and bash keeps an OSTYPE it inherits, so
    // the child runs the Darwin arm here — `install: units:` naming
    // `$HOME/Library/LaunchAgents` is the control that it did.
    //
    // FORCED THROUGH `_inst_bins`, NOT THROUGH THE VERB. A later step of a
    // `both`/`fleet` install (the wrapper converger's `stat`) speaks BSD
    // userland on that arm, which a Linux box does not have, so the run exits
    // nonzero AFTER this function's work is done (measured: `stat answered for
    // 85 of the 17 id-shaped files`). The exit code is therefore not asserted:
    // what is asserted is everything `_inst_bins` did, which a step failing
    // later cannot undo.
    for (const role of ['both', 'fleet', 'server'] as const) {
      const home = freshBox(`ccrc-install-darwin-arm-${role}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'agent.env'),
        'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
      const r = runInstall(home, ['install', '--role', role], { OSTYPE: 'darwin23' });
      expect(r.stdout, `--role ${role}: the Darwin arm was not taken\n${r.stderr}`)
        .toMatch(/^install: units: .* in \$HOME\/Library\/LaunchAgents \(launchd\)$/m);
      const lane: string[] = role === 'server' ? [] : [...GPT_LANE_BINS];
      const bins = readdirSync(join(home, '.local', 'bin'))
        .filter((b) => !FIXTURE_BINS.includes(b) && b !== 'graphify').sort();
      expect(bins, `--role ${role}: what the Darwin arm of _inst_bins placed`)
        .toEqual(['ccd', 'ccd-account-auth', ...lane, 'ccrc'].sort());
      for (const name of lane) {
        const bin = join(home, '.local', 'bin', name);
        expect(readFileSync(bin), `${name} is not the placed tree's copy`).toEqual(readFileSync(placed(home, 'ccd', name)));
        expect(statSync(bin).mode & 0o777, `${name} mode`).toBe(0o755);
      }
      const line = r.stdout.split('\n').find((l) => l.startsWith('install: bins:'));
      expect(line, `--role ${role}: no \`install: bins:\` line`).toBeDefined();
      expect(line!, `--role ${role}: not the Darwin closing line`).toContain('macOS has none');
      if (role === 'server') {
        expect(line!, 'the server-role Darwin closing line claims a GPT-lane executable').not.toMatch(/ccgpt|ccrc-codex/);
      } else {
        expect(line!).toMatch(new RegExp(LANE_BINS_IN_LINE));
      }
    }
  });

  itLinux('ccd-tmp-sweep lands beside it too (the temp-dir reaper) — every role, but not Darwin', () => {
    // Mirrors the `ccd-graph-sweep` case above: `_inst_bins` ships it on every
    // role, on the same darwin carve-out (its only runner is a systemd timer
    // and it reads /proc). Its UNIT and ENABLE are additionally role-gated
    // (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-tmp-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-tmp-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  it('the launcher is BYTE FOR BYTE what deploy.sh generates', () => {
    // THE AGREEMENT PIN. The launcher now has two generators — `deploy.sh`'s
    // `install_ccrc_shim` for a box reached over ssh, and `_inst_shim` for a
    // box installing itself — and two generators of one artifact is a drift
    // waiting to happen: a box whose launcher came from the older of them
    // fails in a way neither generator's own tests can see. Extract deploy's
    // heredoc (the mechanics `agent/test/deploy-verify.test.ts:1750-1776`
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
    const r = runLauncherVersion(home);
    expect(r.stderr).toBe('');
    expect(r.code, 'the launcher did not reach the shipped ccrc').toBe(0);
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
      // The compaction card's helper (compaction-card spec §2): 0644, a script
      // `node` runs under the hook's `timeout`, never executed directly.
      [join(home, '.cc-sessions', 'compact-card.mjs'), placed(home, 'ccd', 'compact-card.mjs'), 0o644],
      [join(home, '.cc-sessions', 'session-hook.sh'), placed(home, 'ccd', 'session-hook.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-session-hooks.sh'),
        placed(home, 'ccd', 'install-session-hooks.sh'), 0o755],
      [join(home, '.cc-sessions', 'notify.sh'), placed(home, 'deploy', 'notify.sh'), 0o755],
      // The three skill installers (worker-skill Task 4, reviewer-skill
      // Task 10) are the same kind of artifact as the hooks installer beside
      // them — a script the box EXECUTES — and land through the same
      // `_inst_atomic`. 0755 is not decoration here: `_inst_skills` runs each
      // one immediately afterwards, and a copy that arrived at the source's
      // mode under this describe's hostile umask would be a step that
      // installs a skill installer nobody can run.
      [join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
        placed(home, 'ccd', 'install-coordinator-skill.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-worker-skill.sh'),
        placed(home, 'ccd', 'install-worker-skill.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-reviewer-skill.sh'),
        placed(home, 'ccd', 'install-reviewer-skill.sh'), 0o755],
      // graphify Task 3: `_inst_graphify_skill` stages this beside the other
      // two, through the same `_inst_atomic`, right after `_inst_skills`.
      [join(home, '.cc-sessions', 'install-graphify-skill.sh'),
        placed(home, 'ccd', 'install-graphify-skill.sh'), 0o755],
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
      // `ccd-cap-scopes` caps tmux pane CGROUP scopes, so `_inst_bins` does not
      // place it on macOS — a binary that could only ever be a no-op there.
      // Listing it unconditionally would make this test stat a file the verb
      // was right not to install.
      // graphify Task 10: the sweep rides the same darwin carve-out — its
      // systemd timer never installs there, and the script needs GNU stat/date
      // and flock(1), which macOS does not ship.
      ...(process.platform === 'darwin'
        ? [] : [join(home, '.local', 'bin', 'ccd-cap-scopes'),
                join(home, '.local', 'bin', 'ccd-graph-sweep')]),
      // NOT in the spread above: this one is on both arms.
      join(home, '.local', 'bin', 'ccd-account-auth'),
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'compact-card.mjs'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      // The three skill installers `_inst_skills` stages beside them, through
      // the same `_inst_atomic` (worker-skill Task 4, reviewer-skill Task 10).
      join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
      join(home, '.cc-sessions', 'install-worker-skill.sh'),
      join(home, '.cc-sessions', 'install-reviewer-skill.sh'),
      // graphify Task 3: staged beside them, through the same `_inst_atomic`.
      join(home, '.cc-sessions', 'install-graphify-skill.sh'),
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
    // Both halves of ccd's pair (D-3696), each at its own mode.
    for (const [bin, want] of [[join(home, '.local', 'bin', 'ccd'), 0o755], [join(home, '.local', 'libexec', 'ccrc', 'ccd'), 0o644]] as const) {
      chmodSync(bin, 0o600);
      const was = mtime(bin);
      const r = runInstall(home);
      expect(r.code, r.stderr).toBe(0);
      expect(mode(bin), 'a mode nobody repaired').toBe(want);
      expect(mtime(bin), 'the file was rewritten to fix a mode').toBe(was);
    }
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
    // D-3241 (W4 Task 4): the sequence is `CCRC_INST_SPINE`,
    // declared ONCE, because `cmd_update`'s spine-death classifier must know
    // which steps precede `_inst_tree` and a second hand list of the spine
    // would be the two-copies defect single-definition.test.ts refuses.
    // `cmd_install` iterates it through `_inst_step`, which writes the
    // install-step marker before each step.
    const spine = /^CCRC_INST_SPINE=\(([\s\S]*?)\n\)/m.exec(src);
    expect(spine, 'ccd/ccrc has no CCRC_INST_SPINE').toBeTruthy();
    const steps = spine![1]!.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    // Every line of the array is exactly one step name — a line the order
    // assertion below could not read is a step it would not see.
    expect(steps.filter((l) => !/^_inst_[a-z_]+$/.test(l))).toEqual([]);
    for (const s of steps) expect(src, `${s} is in the spine but never defined`).toMatch(new RegExp(`^${s}\\(\\) \\{`, 'm'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no cmd_install').toBeTruthy();
    // No step is called outside the array: a bare call runs with no
    // install-step marker, so a death in it would be misclassified.
    // W6 Task 3: the two doctor tails — the fleet arm's and the verb's last
    // line — are the ONLY bare `_inst_*` calls left. `_inst_doctor_tail` is
    // not a step: it runs after `_inst_installed` removed the marker, where
    // a death leaves the completed-install record (D-3114's reading), so no
    // marker has anything to name. Named exactly, so a real step called bare
    // still reds this line.
    expect(body![1]!.split('\n').map((l) => l.trim()).filter((l) => /^_inst_[a-z_]+$/.test(l)),
      'cmd_install calls a step outside CCRC_INST_SPINE').toEqual(['_inst_doctor_tail', '_inst_doctor_tail']);
    expect(body![1]).toMatch(/^\s*for inst_fn in "\$\{CCRC_INST_SPINE\[@\]\}"; do _inst_step "\$inst_fn"; done$/m);
    expect(steps).toEqual([
      '_inst_banner',
      '_inst_roster',
      '_inst_accounts_sh',
      '_inst_env',
      // Stage 4, Task 5. In the seed-once cluster (it writes a user-owned
      // file, or keeps it) and BEFORE `_inst_units`: on a fleet box the agent
      // unit's REQUIRED EnvironmentFile must exist by the time the unit lands
      // and `_inst_enable` asks systemd to start it. On every other role the
      // step is a silent no-op, which is what keeps the default transcript
      // byte-identical to Stage 2d's.
      '_inst_agent_env',
      // Stage 2e, Task 2. Beside the other two seed-once steps and BEFORE the
      // tree: nothing later in this sequence reads the flag, so its position
      // is a grouping rather than a dependency — the three files an operator
      // owns are seeded together, and the transcript reads that way too.
      '_inst_rc',
      // design 2026-09-20 §3: seed-once identity, with the other seed-once files
      '_inst_node_id',
      '_inst_tree',
      '_inst_bins',
      '_inst_files',
      '_inst_stamp',
      // §9: what THIS install can do, beside the stamp that says what it is
      '_inst_caps',
      // Task 8. Three orderings in this half are load-bearing and each one is
      // measured by a test of its own below: the units land before anything
      // enables them, the account config dirs exist before the hooks installer
      // walks them, and the wrapper converger runs before doctor judges what it
      // wrote.
      '_inst_units',
      // Plan 2b-2 Task 10 (D-3485). The Codex lanes' LiteLLM runtime,
      // BEFORE `_inst_enable`, for two measured reasons. First, `_inst_enable`
      // arms `ccrc-models.timer`, whose `ccrc models refresh --all` re-renders
      // a codex lane's config and stops/starts its tiers through the functions
      // that resolve `ccgpt-runtime python` — so the generation they resolve
      // must already be this run's. Second, `_inst_codex_tiers` below measures
      // staleness AGAINST it: a build placed after the restart step restarts
      // tiers onto the OLD runtime (m-spine H4). After `_inst_bins`, which
      // places the builder. A failed build DEGRADES (`codex-runtime`).
      '_inst_codex_runtime',
      '_inst_enable',
      // Plan 2b-2 Task 10 (D-3485). Restart-after-update as a BARE
      // step rather than code inside `_inst_enable`: it is visible in this
      // list, and `_inst_enable` returns early on Darwin, where the nohup
      // arm's tiers must still be restarted. Not `_upd_sweep` — the one
      // sanctioned toucher of `claude-session@*` (spec §7.4). After
      // `_inst_bins` (the shim's code) and `_inst_codex_runtime` (the
      // generation): the two things a tier's staleness is measured against.
      // Only running, verified-own, stale tiers, by stop+start; a failure
      // DEGRADES (`codex-tiers`).
      '_inst_codex_tiers',
      '_inst_linger',
      '_inst_dirs',
      // graphify Task 2. After `_inst_dirs` and before `_inst_hooks`, per the
      // task brief: the engine venv has no dependency on the account config
      // dirs or the hooks installer either way, so the position is the
      // brief's own placement rather than a dependency this file measures.
      '_inst_graphify_engine',
      '_inst_hooks',
      // Worker-skill Task 4. Beside `_inst_hooks` and after it, in deploy.sh's
      // own order (`install-session-hooks.sh`, then the three skill installers):
      // both steps run an INSTALLED converge script over the config dirs
      // `_inst_dirs` has just created, and neither reads what the other wrote.
      // What IS load-bearing is that it follows `_inst_dirs` — the skill
      // installers `continue` past a config dir that does not exist, so on a
      // fresh box run before that step they would skip the whole roster and
      // exit 0.
      '_inst_skills',
      // graphify Task 3. Right after `_inst_skills`, a SEPARATE function
      // rather than a third name inside its loop: that loop pins
      // `CCRC_SKILL_SRC` to a vendored `~/.cc-sessions` tree, and this
      // skill's source of truth is the installed package instead (spec §B).
      '_inst_graphify_skill',
      // D-1160. Immediately before the exclude writer, because the two are the
      // sweep's two preconditions and they read best together: this one keeps
      // ccrc's OWN artifacts (`.remember/`, `.superpowers/`, `.claude/`,
      // `CLAUDE.local.md`) out of every corpus, the next keeps `graphify-out/`
      // out of every `git status`. Neither reads what the other wrote, so the
      // position is a grouping rather than a dependency — but it must follow
      // `_inst_tree`, since it copies the list out of the PLACED tree.
      // D-1245. The READ side moved OUT of the operator's account-wide
      // CLAUDE.md and into the artifacts ccrc owns outright (the session
      // hook's SessionStart card, worker clause 12, the PATH converge, and
      // the `graphQueries` counter the hook already writes). What
      // is left here is the REMOVER, in `_inst_graph_hooks_off`'s own shape:
      // a step whose whole job is taking back what an earlier layer planted.
      '_inst_graph_always_on_off',
      '_inst_graph_noise',
      // graphify Task 4 (D-996/D'). Right after `_inst_graphify_skill`, per
      // the task brief: the sweep's `check-ignore` precondition needs a
      // writer that converges every project/worktree's common-dir exclude.
      // No later step reads what this one writes, so the position is the
      // brief's own placement rather than a measured dependency.
      '_inst_graph_excludes',
      // Workspace-cleanup fix. Right after `_inst_graph_excludes`, same walk
      // and same reason: `ws-add` writes the `node_modules`/`cdk.out` exclude
      // pair into every NEW workspace, and this is the backfill for a
      // project or workspace `ws-add` never touched, or touched before the
      // pair existed. Position is a grouping (both converge the same
      // per-project info/exclude), not a measured dependency.
      '_inst_ws_build_excludes',
      // graphify Task 10 (O3/O6b). Right after `_inst_graph_excludes`, per
      // the task brief: no later step reads what it does, so the position is
      // the brief's own placement rather than a measured dependency.
      '_inst_graph_hooks_off',
      '_inst_wrappers',
      // Release/rollout design §5, Task 3. LAST, deliberately: this is the
      // completed-install record, so it must run only once every step above
      // has already converged or died.
      '_inst_installed',
    ]);
  });

  it('ends with _inst_doctor_tail, whose exit code is cmd_doctor\'s, and nothing runs after it (W6 Task 3)', () => {
    // THE VERB'S EXIT CODE IS DOCTOR'S, and that is only true while the tail
    // is the LAST command in the function AND the tail hands doctor's rc back
    // untouched: a line added after either — a summary, a tidy-up, one more
    // echo — silently replaces the verdict with that line's own status, and
    // every "a broken box exits 1" assertion in this file would go green
    // against an install that reported success on a failing box. The tail
    // runs doctor FIRST and captures its rc, because what it does next (the
    // migration's gate) must never become the verdict.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    const lines = body![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(lines[lines.length - 1]).toBe('_inst_doctor_tail');
    const tail = /^_inst_doctor_tail\(\) \{\n([\s\S]*?)\n\}/m.exec(src);
    expect(tail, 'ccd/ccrc has no _inst_doctor_tail').not.toBeNull();
    const t = tail![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(t[1], 'the tail does something before it runs doctor').toBe('cmd_doctor || drc=$?');
    expect(t[t.length - 1]).toBe('return "$drc"');
  });
});

// ── W6 Task 2: the versioned tree ─────────────────────────────────────────
// `_inst_tree` places into `~/ccrc-versions/<name>/` and flips `~/ccrc` (a
// symlink since W6) onto it with one rename, after the deps. The subjects,
// in order: the layout reader and the namer, measured by SOURCING the ccrc
// under test (its BASH_SOURCE guard keeps the verb table from dispatching);
// then the verb itself on every guard arm — a fresh box, a new name while
// another version runs, a re-run from the running version, a run of another
// placed version's own ccrc, an incomplete one, a failing npm, the refusals;
// then the kept stamp and record, and the Darwin preflight.
describe('ccrc install: the versioned tree (W6 Task 2)', () => {
  const REAL_MV = realPath('mv');
  const vroot = (home: string, ...rel: string[]): string => join(home, 'ccrc-versions', ...rel);

  /** Every file under `dir`, relative path -> bytes (base64), links as their
   *  value: the "byte-unchanged" measurement a running version is held to. */
  const treeBytes = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, prefix: string): void => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        const rel = prefix === '' ? e : `${prefix}/${e}`;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
        else if (st.isDirectory()) walk(p, rel);
        else out[rel] = readFileSync(p).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  };

  /** Runs `snippet` in a bash that has sourced `ccrc`, HOME the fixture's,
   *  `gh` contained, every CCRC_* input deleted (`ccrcEnv`'s rule), and the
   *  tools a placement would reach — npm, rsync, curl, systemctl, launchctl —
   *  POISONED at the head of PATH: a snippet that got further than it should
   *  (the red run of the crashed-arm case, say) must fail loudly, never fetch
   *  or copy for real. */
  const sourcedEnv = (home: string): NodeJS.ProcessEnv => {
    const poison = join(home, 'sourced-poison');
    mkdirSync(poison, { recursive: true });
    for (const t of ['npm', 'rsync', 'curl', 'systemctl', 'launchctl']) {
      writeFileSync(join(poison, t), `#!/bin/sh\necho "sourced harness: ${t} must not run" >&2\nexit 97\n`, { mode: 0o755 });
    }
    // Wave 9 R10d (D-3818): from `ccrcContainedEnv`, with its own `sourced-poison` still prepended — it answers first.
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    env['PATH'] = `${poison}:${env['PATH'] ?? ''}`;
    for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
    return env;
  };
  const sourced = (home: string, ccrc: string, snippet: string): Result => {
    const env = sourcedEnv(home);
    const r = spawnSync(BASH, ['-c', `source "$1" || exit 99\n${snippet}`, 'sourced', ccrc],
      { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const layout = (home: string): string =>
    sourced(home, join(REPO, 'ccd', 'ccrc'),
      '_ver_layout; printf \'%s|%s|%s\\n\' "$VER_LAYOUT" "$VER_CURRENT" "$VER_WHY"').stdout.trim();
  const nameOf = (home: string, src: string): string =>
    sourced(home, join(REPO, 'ccd', 'ccrc'), `_inst_version_name "$(cd '${src}' && pwd -P)"`).stdout.trim();

  /** A stamp in `build-release.sh`'s shape, written into a source tree. */
  const shipStamp = (root: string, sha: string, version?: string): void => {
    writeFileSync(join(root, 'build.json'), `${JSON.stringify({
      sha, ref: 'release', builtAt: '2026-09-23T00:00:00Z', dirty: false,
      ...(version === undefined ? {} : { version }),
    })}\n`);
  };

  /** `mv`, recorded by nothing and executed for real — except at the two
   *  kept-copy renames, where a knob file makes it SIGKILL the ccrc that ran
   *  it (the stamp copy) or refuse (the record copy). `_plat_mv_notdir` runs
   *  in ccrc's own shell, so `$PPID` is the run itself. */
  const mvKnobs = [
    '#!/bin/sh',
    'for last in "$@"; do :; done',
    'case "$last" in',
    '  */.ccrc-stamp.json) [ -f "$HOME/fixture-kill-at-stamp-copy" ] && { kill -KILL "$PPID"; exit 1; } ;;',
    '  */.ccrc-digest) [ -f "$HOME/fixture-kill-at-digest-copy" ] && { kill -KILL "$PPID"; exit 1; }',
    '                  [ -f "$HOME/fixture-fail-at-digest-copy" ] && { echo "fixture mv: refusing $last" >&2; exit 1; } ;;',
    '  */.ccrc-installed) [ -f "$HOME/fixture-fail-at-record-copy" ] && { echo "fixture mv: refusing $last" >&2; exit 1; } ;;',
    'esac',
    `exec ${REAL_MV} "$@"`,
  ].join('\n') + '\n';
  /** `ln`, recorded (argv, one line per call) and executed for real: the
   *  call-site half of spec §18's "the flip is a rename" — `_inst_tree` must
   *  stage `~/ccrc.new` and rename it, never `ln -sfn` onto `~/ccrc` itself. */
  const lnRecorder = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/ln-argv"\nexec ${realPath('ln')} "$@"\n`;

  it('sourcedEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('ccrc-sourced-contained-');
    expect(() => assertNoRealTool(sourcedEnv(home), home)).not.toThrow();
  });

  it('_ver_layout: seven words, one per shape of ~/ccrc — and a WHY built from its own words, never the link\'s', () => {
    const home = mkTmp('ccrc-ver-layout-');
    expect(layout(home)).toBe('absent||');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toBe('crashed||');
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    mkdirSync(join(home, 'ccrc'));
    expect(layout(home)).toBe('directory||');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toMatch(/^unreadable\|\|a directory beside a \$HOME\/ccrc\.migrating — two trees/);
    rmSync(join(home, 'ccrc'), { recursive: true });
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    installVersionedTree(home, 'v1.2.3');
    expect(layout(home)).toBe('linked|v1.2.3|');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toBe('migrated|v1.2.3|');
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    // FOREIGN: every link this ccrc would never have written — a RELATIVE
    // target, a path outside the versions root, a dangling version name, a
    // directory under the root whose name is not a version name, a version
    // name that is itself a link.
    const foreign = /^foreign\|\|a link whose target is not a version directory under \$HOME\/ccrc-versions$/;
    const relink = (target: string): void => {
      rmSync(join(home, 'ccrc'));
      symlinkSync(target, join(home, 'ccrc'));
    };
    relink(join('ccrc-versions', 'v1.2.3'));
    expect(layout(home)).toMatch(foreign);
    mkdirSync(join(home, 'elsewhere-9f3c'));
    relink(join(home, 'elsewhere-9f3c'));
    expect(layout(home)).toMatch(foreign);
    expect(layout(home), 'the link\'s bytes reached VER_WHY').not.toContain('elsewhere-9f3c');
    relink(vroot(home, 'v9.9.9'));
    expect(layout(home)).toMatch(foreign);
    mkdirSync(vroot(home, 'not-a-version'));
    relink(vroot(home, 'not-a-version'));
    expect(layout(home)).toMatch(foreign);
    // …and a version NAME under the root that is itself a link, to a real
    // directory elsewhere: `-d` follows it and the name and the prefix both
    // match, so only the `[ -L "$val" ]` clause sees it (mutation M8b).
    mkdirSync(join(home, 'elsewhere-2'));
    symlinkSync(join(home, 'elsewhere-2'), vroot(home, 'v1.2.4'));
    relink(vroot(home, 'v1.2.4'));
    expect(layout(home)).toMatch(foreign);
    // UNREADABLE: a regular file at the name; a .migrating that is not a dir.
    rmSync(join(home, 'ccrc'));
    writeFileSync(join(home, 'ccrc'), 'not a tree\n');
    expect(layout(home)).toBe('unreadable||neither a directory nor a link');
    rmSync(join(home, 'ccrc'));
    writeFileSync(join(home, 'ccrc.migrating'), 'not a tree\n');
    expect(layout(home)).toBe('unreadable||absent beside a $HOME/ccrc.migrating that is not a directory');
  });

  it('_inst_version_name: a placed version names itself; git beats a stray build.json; build.json names an artifact; a deploy.sh tree is named by the box stamp; nothing measured is unstamped, fresh each time', () => {
    const home = mkTmp('ccrc-ver-name-');
    // 1. a placed version — and a dot-named sibling under the root is NOT one
    installVersionedTree(home, 'v1.2.3', { link: false });
    expect(nameOf(home, vroot(home, 'v1.2.3'))).toBe('v1.2.3');
    const incoming = vroot(home, '.v4.5.6.incoming.1');
    mkdirSync(incoming, { recursive: true });
    shipStamp(incoming, 'd'.repeat(40), 'v4.5.6');
    expect(nameOf(home, incoming)).toBe('v4.5.6');
    // 2. git: untagged, then a non-release tag (still untagged), then a release tag;
    //    a stray build.json beside the repository never outvotes it
    const repo = join(home, 'repo');
    installFixtureTree(home, 'repo');
    const sha = gitInit(repo);
    shipStamp(repo, 'e'.repeat(40), 'v9.9.9');
    expect(nameOf(home, repo)).toBe(`untagged-${sha.slice(0, 12)}`);
    const tag = (t: string): void => {
      const r = spawnSync('git', ['-C', repo, 'tag', t],
        { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
    };
    tag('release-7');
    expect(nameOf(home, repo)).toBe(`untagged-${sha.slice(0, 12)}`);
    tag('v2.3.4');
    expect(nameOf(home, repo)).toBe('v2.3.4');
    // 3. an artifact's build.json: its version; no version -> untagged-<sha12>;
    //    a sha that is not hex names nothing and falls through
    const art = join(home, 'artifact');
    mkdirSync(art);
    shipStamp(art, 'f'.repeat(40), 'v3.0.1');
    expect(nameOf(home, art)).toBe('v3.0.1');
    shipStamp(art, '0123456789abcdef0123456789abcdef01234567');
    expect(nameOf(home, art)).toBe('untagged-0123456789ab');
    shipStamp(art, 'not-a-sha');
    expect(nameOf(home, art)).toMatch(/^unstamped-[0-9a-f]{12}$/);
    // 4. the live ~/ccrc of a pre-versioned box, named by the box's own stamp
    const deployed = mkTmp('ccrc-ver-name-deployed-');
    mkdirSync(join(deployed, 'ccrc'));
    mkdirSync(join(deployed, '.ccrc'));
    writeFileSync(join(deployed, '.ccrc', 'build.json'),
      '{"sha":"1111111111111111111111111111111111111111","ref":"main","builtAt":"2026-09-01T00:00:00Z","dirty":false,"version":"v0.0.7"}\n');
    expect(nameOf(deployed, join(deployed, 'ccrc'))).toBe('v0.0.7');
    // 5. nothing measures it: unstamped, and never the same name twice
    const bare = join(home, 'bare');
    mkdirSync(bare);
    const a = nameOf(home, bare);
    const b = nameOf(home, bare);
    expect(a).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(b).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('a staged tree INSIDE another git work tree is named and stamped by its own build.json, never by the enclosing repository\'s HEAD (D-3463)', () => {
    // A TMPDIR under a git-tracked HOME: the release tarball is extracted into
    // an untracked subdirectory of a repository. `git -C <stage> rev-parse
    // HEAD` answers for the ENCLOSING repository there.
    const home = mkTmp('ccrc-ver-name-enclosed-');
    const encl = join(home, 'encl');
    installFixtureTree(home, 'encl');
    const esha = gitInit(encl);
    const stage = join(encl, 'stage');
    mkdirSync(join(stage, 'ccd'), { recursive: true });
    shipStamp(stage, 'c'.repeat(40), 'v1.5.0');
    // git really does answer for the enclosing repository from here (the hazard exists)
    expect(spawnSync('git', ['-C', stage, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()).toBe(esha);
    expect(nameOf(home, stage)).toBe('v1.5.0');
    // no build.json either: not the enclosing commit — unstamped
    rmSync(join(stage, 'build.json'));
    expect(nameOf(home, stage)).toMatch(/^unstamped-[0-9a-f]{12}$/);
    // and the enclosing repository ITSELF (its own top level) is still named from git
    expect(nameOf(home, encl)).toBe(`untagged-${esha.slice(0, 12)}`);
    // the stamp: `_inst_stamp` reads the shipped build.json of the enclosed tree
    shipStamp(stage, 'c'.repeat(40), 'v1.5.0');
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'), `CCRC_HERE='${stage}/ccd'; _inst_stamp`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`install: stamp: ${'c'.repeat(40)} (release, v1.5.0, shipped in the release artifact)`);
    const stamp = readFileSync(join(home, '.ccrc', 'build.json'), 'utf8');
    expect(stamp).toContain('c'.repeat(40));
    expect(stamp, 'the stamp took the enclosing repository\'s sha').not.toContain(esha);
  });

  it('an exported GIT_DIR naming ANOTHER repository changes nothing a git read answers: the name, the stamp\'s sha, ref, dirty and version all come from the source\'s own repository (final-review fix wave, Step 0c; fix round 1)', () => {
    // `git -C <src> <verb>` under an ambient GIT_DIR answers for that
    // repository, and `_inst_git_own` (which unsets it) then agrees that <src>
    // is a top level — a name and a stamp taken from another tree's commit,
    // branch, tag and worktree state. `other` differs from `repo` in all four:
    // another commit, a `v9.9.9` release tag at its HEAD, another branch, and a
    // modified tracked file.
    const home = mkTmp('ccrc-ver-name-git-dir-');
    installFixtureTree(home, 'repo');
    installFixtureTree(home, 'other');
    const repo = join(home, 'repo');
    const other = join(home, 'other');
    writeFileSync(join(other, 'ONLY-IN-OTHER'), 'a different commit\n');
    const sha = gitInit(repo);
    const osha = gitInit(other);
    expect(osha, 'the two fixture repositories share a commit — the pin would prove nothing').not.toBe(sha);
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    const ogit = (...args: string[]): void => {
      const r = spawnSync('git', ['-C', other, ...args], { env: gitEnv, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
    };
    ogit('tag', 'v9.9.9');
    ogit('checkout', '-q', '-b', 'other-branch');
    // Dirty in the INDEX and in the WORKTREE, both: stage one change, then
    // modify the file again. `git add` alone leaves the worktree clean (so an
    // ambient-GIT_DIR read of `diff --quiet` would answer clean and the pin
    // would not see it), and an edit alone leaves the index clean (so the same
    // is true of `diff --cached --quiet`). Each of `_inst_stamp`'s two dirty
    // reads answers `other`'s state as dirty if it is ever unshielded.
    writeFileSync(join(other, 'ONLY-IN-OTHER'), 'staged after the commit\n');
    ogit('add', 'ONLY-IN-OTHER');
    writeFileSync(join(other, 'ONLY-IN-OTHER'), 'modified again after it was staged\n');
    // (`other`'s tracked file is now dirty in its index AND its worktree; `repo` is clean, on fixture-branch, untagged.)
    const env = `export GIT_DIR='${other}/.git' GIT_WORK_TREE='${other}'; `;
    const n = sourced(home, join(REPO, 'ccd', 'ccrc'), `${env}_inst_version_name "$(cd '${repo}' && pwd -P)"`);
    expect(n.code, n.stderr).toBe(0);
    expect(n.stdout.trim(), 'the name took the ambient GIT_DIR repository\'s release tag').toBe(`untagged-${sha.slice(0, 12)}`);
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'), `${env}CCRC_HERE='${repo}/ccd'; _inst_stamp`);
    expect(r.code, r.stderr).toBe(0);
    const stamp = JSON.parse(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')) as Record<string, unknown>;
    expect(stamp['sha']).toBe(sha);
    expect(stamp['ref'], 'the stamp\'s ref is another repository\'s branch').toBe('fixture-branch');
    expect(stamp['dirty'], 'the stamp\'s dirty is another repository\'s index or worktree state').toBe(false);
    expect('version' in stamp, 'the stamp carries another repository\'s release tag').toBe(false);
  });

  it('a fresh box: the tree lands in ~/ccrc-versions/<name>/, never at the live name, and ~/ccrc becomes an absolute link to it — after the deps, by one rename', () => {
    const home = freshBox('ccrc-install-ver-fresh-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), '~/ccrc is not a link').toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, name));
    // The rsync's destination is the version directory, never $HOME/ccrc.
    const argv = read(join(home, 'rsync-argv')).trim().split('\n');
    expect(argv).toHaveLength(1);
    expect(argv[0]!.split(' ').at(-1)).toBe(`${vroot(home, name)}/`);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, name, 'server')]);
    const lines = r.stdout.split('\n');
    const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const placedAt = at(new RegExp(`^install: tree: placed ${name} at \\$HOME/ccrc-versions/${name}$`));
    const depsAt = at(/^install: tree: server runtime deps in place$/);
    const flipAt = at(new RegExp(`^install: tree: \\$HOME/ccrc -> \\$HOME/ccrc-versions/${name} \\(was nothing\\) — one rename$`));
    expect(placedAt, r.stdout).toBeGreaterThanOrEqual(0);
    expect(depsAt).toBeGreaterThan(placedAt);
    expect(flipAt, 'the flip ran before the deps were in place').toBeGreaterThan(depsAt);
    expect(existsSync(join(home, 'ccrc.new')), 'the staged link was left behind').toBe(false);
    // The version keeps the box's stamp and record, written after the record.
    expect(read(vroot(home, name, '.ccrc-stamp.json'))).toBe(read(join(home, '.ccrc', 'build.json')));
    expect(read(vroot(home, name, '.ccrc-installed'))).toBe(read(join(home, '.ccrc', 'installed')));
    expect(statSync(vroot(home, name, '.ccrc-installed')).mode & 0o777).toBe(0o644);
    const keptAt = at(new RegExp(`^install: versions: kept ${name}'s stamp and install record in \\$HOME/ccrc-versions/${name} — what a flip back restores$`));
    expect(keptAt, r.stdout).toBeGreaterThan(at(/^install: installed: /));
    expect(strays(home)).toEqual([]);
  });

  it('a new name while ~/ccrc points at another version: rsync into ~/ccrc-versions/<new>/, flip, and the running version\'s directory is byte-unchanged', () => {
    const home = freshBox('ccrc-install-ver-new-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // A file only the RUNNING version has. Its tree is otherwise the source's
    // own bytes, so an rsync that landed in it would rewrite equal bytes and
    // the digest below would stay green; `--delete` removes this one.
    writeFileSync(vroot(home, 'v9.9.0', 'server', 'ONLY-IN-THE-RUNNING-VERSION'), 'a unit may be running this\n');
    keepDigest(vroot(home, 'v9.9.0'), home);   // the plant is part of v9.9.0's kept bytes (D-3465)
    const before = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnRecorder } });
    // FIRST, before the exit code: a run that wrote into the running version
    // dies later, at its own exit code, and this is the assertion that must
    // name the defect (review 179 item 15).
    expect(treeBytes(vroot(home, 'v9.9.0')), 'the running version was written into').toEqual(before);
    expect(r.code, r.stderr).toBe(0);
    // The flip went through the staged name: `ln` wrote `~/ccrc.new`, and no
    // `ln` in the whole run targeted `~/ccrc` itself (unlink + symlink).
    const lns = read(join(home, 'ln-argv')).trim().split('\n');
    expect(lns.filter((l) => l.endsWith(` ${join(home, 'ccrc.new')}`))).toEqual([
      `-sfn -- ${vroot(home, 'v9.9.1')} ${join(home, 'ccrc.new')}`,
    ]);
    expect(lns.filter((l) => l.endsWith(` ${join(home, 'ccrc')}`)), 'an ln targeted the live link').toEqual([]);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.1'));
    expect(read(join(home, 'rsync-argv')).trim().split(' ').at(-1)).toBe(`${vroot(home, 'v9.9.1')}/`);
    expect(r.stdout).toMatch(/^install: tree: placed v9\.9\.1 at \$HOME\/ccrc-versions\/v9\.9\.1$/m);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v9\.9\.1 \(was \$HOME\/ccrc-versions\/v9\.9\.0\) — one rename$/m);
    expect(JSON.parse(read(vroot(home, 'v9.9.1', '.ccrc-stamp.json'))).version).toBe('v9.9.1');
  });

  it.each(['a symlink to a real directory', 'a regular file'] as const)('a version NAME that is %s is refused BEFORE any write: nothing is voided, copied or installed into whatever it names (D-3464)', (kind) => {
    const home = freshBox('ccrc-install-ver-linked-name-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // The name the run would place into. A link into a directory that even
    // carries a kept record — the record the copy arm voids first.
    const elsewhere = join(home, 'elsewhere-3');
    if (kind === 'a regular file') {
      writeFileSync(vroot(home, 'v9.9.1'), 'not a tree\n');
    } else {
      mkdirSync(join(elsewhere, 'server'), { recursive: true });
      writeFileSync(join(elsewhere, 'server', 'MINE'), 'not ccrc\n');
      writeFileSync(join(elsewhere, '.ccrc-installed'), `${'b'.repeat(40)}\n`);
      symlinkSync(elsewhere, vroot(home, 'v9.9.1'));
    }
    const before = kind === 'a regular file' ? '' : treeBytes(elsewhere);
    const running = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnRecorder } });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc-versions/v9.9.1 is not a directory ccrc placed — nothing was written; $HOME/ccrc and $HOME/ccrc-versions were not touched');
    if (kind !== 'a regular file') {
      expect(treeBytes(elsewhere), 'the link\'s target was written through').toEqual(before);
      expect(existsSync(join(elsewhere, '.ccrc-installed')), 'the target\'s kept record was voided').toBe(true);
    } else {
      expect(readFileSync(vroot(home, 'v9.9.1'), 'utf8')).toBe('not a tree\n');
    }
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran').toBe(false);
    expect(existsSync(join(home, 'npm-argv')), 'npm ci ran').toBe(false);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.0'));
    expect(treeBytes(vroot(home, 'v9.9.0'))).toEqual(running);
  });

  it('a re-run from the version ~/ccrc points at: the pre-W6 sentence, no copy, no npm ci, no flip — and the stamp comes from the version\'s own kept copy', () => {
    const home = mkTmp('ccrc-install-ver-rerun-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    healthyDoctorBox(home);
    const digestBefore = read(vroot(home, 'v9.9.0', '.ccrc-digest'));
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran against the running version').toBe(false);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.0 is kept \(its install record is present and its digest re-measures equal\) — no npm ci$/m);
    expect(existsSync(join(home, 'npm-argv')), 'npm ci emptied the running version\'s node_modules').toBe(false);
    expect(r.stdout).not.toMatch(/one rename$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.0'));
    expect(r.stdout).toMatch(/^install: stamp: 9{40} \(main, v9\.9\.0, kept with its version\)$/m);
    expect(JSON.parse(read(join(home, '.ccrc', 'build.json'))).version).toBe('v9.9.0');
    // D-3465 (b): a CLEAN version re-takes its keep on the digest it recorded,
    // which this run leaves as it was.
    expect(r.stdout).toMatch(/^install: versions: kept v9\.9\.0's stamp and install record in \$HOME\/ccrc-versions\/v9\.9\.0/m);
    expect(read(vroot(home, 'v9.9.0', '.ccrc-digest'))).toBe(digestBefore);
  });

  it('a run of ANOTHER placed version\'s own ccrc flips to it without copying; a complete one fetches no deps, an incomplete one does', () => {
    const home = mkTmp('ccrc-install-ver-other-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    const before = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at \$HOME\/ccrc-versions\/v9\.9\.1 — installing from it, no copy$/m);
    expect(existsSync(join(home, 'rsync-argv')), 'a placed version was copied onto itself').toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v9\.9\.1 \(was \$HOME\/ccrc-versions\/v9\.9\.0\) — one rename$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.1'));
    expect(treeBytes(vroot(home, 'v9.9.0'))).toEqual(before);

    const inc = mkTmp('ccrc-install-ver-incomplete-');
    installVersionedTree(inc, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    installVersionedTree(inc, 'v9.9.1', { link: false, complete: false });
    healthyDoctorBox(inc);
    const ri = runInstall(inc, ['install'], {}, { from: vroot(inc, 'v9.9.1', 'ccd', 'ccrc') });
    expect(ri.code, ri.stderr).toBe(0);
    expect(read(join(inc, 'npm-cwd')).trim().split('\n')).toEqual([vroot(inc, 'v9.9.1', 'server')]);
    expect(readlinkSync(join(inc, 'ccrc'))).toBe(vroot(inc, 'v9.9.1'));
  });

  it('an npm ci that fails leaves ~/ccrc where it was — the flip is the LAST act of _inst_tree', () => {
    const home = freshBox('ccrc-install-ver-npmfail-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    const r = runInstall(home, ['install'], {}, {
      stubs: { npm: '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: npm ci in \$HOME\/ccrc-versions\/v9\.9\.1\/server failed — the service cannot start without runtime deps$/m);
    expect(readlinkSync(join(home, 'ccrc')), '~/ccrc was flipped onto a tree with no deps').toBe(vroot(home, 'v9.9.0'));
    expect(r.stdout).not.toMatch(/one rename$/m);
  });

  it('a re-placement that dies leaves its version INCOMPLETE — the kept record goes before the first byte is written', () => {
    const home = freshBox('ccrc-install-ver-void-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    expect(runInstall(home).code).toBe(0);
    expect(existsSync(vroot(home, name, '.ccrc-installed')), 'the first run kept no record').toBe(true);
    expect(existsSync(vroot(home, name, '.ccrc-digest')), 'the first run kept no digest').toBe(true);
    const r = runInstall(home, ['install'], {}, {
      stubs: { npm: '#!/bin/sh\necho "npm ERR! fixture" >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^install: tree: reinstalled ${name} in place at `, 'm'));
    expect(existsSync(vroot(home, name, '.ccrc-installed')),
      'a version whose re-placement died still says it holds a finished install').toBe(false);
    // D-3465 (e): the digest goes with the record — it describes the bytes the rsync replaced.
    expect(existsSync(vroot(home, name, '.ccrc-digest')),
      'a version whose re-placement died still carries the digest of the bytes it replaced').toBe(false);
  });

  it('refuses to place or flip over a ~/ccrc this ccrc did not make — a foreign link, a regular file — and touches neither it nor the versions root', () => {
    const home = freshBox('ccrc-install-ver-foreign-');
    mkdirSync(join(home, 'elsewhere'));
    symlinkSync(join(home, 'elsewhere'), join(home, 'ccrc'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: \$HOME\/ccrc is a link whose target is not a version directory under \$HOME\/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; \$HOME\/ccrc and \$HOME\/ccrc-versions were not touched$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'elsewhere'));
    expect(readdirSync(join(home, 'elsewhere'))).toEqual([]);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'rsync-argv'))).toBe(false);

    const file = freshBox('ccrc-install-ver-file-');
    writeFileSync(join(file, 'ccrc'), 'not a tree\n');
    const rf = runInstall(file);
    expect(rf.code).toBe(1);
    expect(rf.stderr).toMatch(/^ccrc: \$HOME\/ccrc is neither a directory nor a link — refusing to place or flip/m);
    expect(read(join(file, 'ccrc'))).toBe('not a tree\n');
    expect(existsSync(vroot(file))).toBe(false);
  });

  it('_inst_tree names a crashed migration a bug and places nothing (the resume that precedes it is W6 Task 3\'s)', () => {
    const home = freshBox('ccrc-install-ver-crashed-');
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    const r = sourced(home, ccrcIn(treeRoot(home)), 'INST_ROLE=both; _inst_tree');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: a migration of \$HOME\/ccrc is incomplete — this run should have completed it first$/m);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('the kept record is written LAST: a run killed at the stamp copy leaves no record copy, and a refused record copy takes the stamp copy with it', () => {
    const killed = freshBox('ccrc-install-ver-kill-');
    const sha = gitInit(treeRoot(killed));
    const name = `untagged-${sha.slice(0, 12)}`;
    writeFileSync(join(killed, 'fixture-kill-at-stamp-copy'), '');
    const r = runInstall(killed, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(r.code, 'the run was not killed at the stamp copy').toBe(-1);
    expect(existsSync(join(killed, '.ccrc', 'installed')), 'the fixture killed the run before the record').toBe(true);
    expect(existsSync(vroot(killed, name, '.ccrc-installed')),
      'a version that never kept its stamp is marked complete').toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-stamp.json'))).toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-digest')), 'a digest was written before the stamp copy').toBe(false);

    const refused = freshBox('ccrc-install-ver-refuse-');
    const rsha = gitInit(treeRoot(refused));
    const rname = `untagged-${rsha.slice(0, 12)}`;
    writeFileSync(join(refused, 'fixture-fail-at-record-copy'), '');
    const rr = runInstall(refused, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(rr.code, rr.stderr).toBe(0);
    expect(rr.stdout).toMatch(new RegExp(`^install: versions: WARN: could not keep ${rname}'s stamp and install record in its directory — no flip can return to it; arm 2 still can$`, 'm'));
    expect(existsSync(vroot(refused, rname, '.ccrc-stamp.json')), 'half a pair survived').toBe(false);
    expect(existsSync(vroot(refused, rname, '.ccrc-installed'))).toBe(false);
    expect(existsSync(vroot(refused, rname, '.ccrc-digest')), 'half a set survived: the digest outlived its refused record').toBe(false);
    expect(strays(refused)).toEqual([]);
  });

  // D-3465: the record is still LAST, and the digest goes BEFORE it.
  it('the kept DIGEST is written before the record: a run killed at the digest copy leaves a stamp copy and NO record; a refused digest copy takes the stamp copy with it and writes no record', () => {
    const killed = freshBox('ccrc-install-ver-digest-kill-');
    const sha = gitInit(treeRoot(killed));
    const name = `untagged-${sha.slice(0, 12)}`;
    writeFileSync(join(killed, 'fixture-kill-at-digest-copy'), '');
    const r = runInstall(killed, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(r.code, 'the run was not killed at the digest copy').toBe(-1);
    expect(existsSync(vroot(killed, name, '.ccrc-stamp.json')), 'the fixture killed the run before the stamp copy landed').toBe(true);
    expect(existsSync(vroot(killed, name, '.ccrc-installed')),
      'the record was written before the digest: a version marked complete with nothing to say what its bytes are').toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-digest'))).toBe(false);

    const refused = freshBox('ccrc-install-ver-digest-refuse-');
    const rsha = gitInit(treeRoot(refused));
    const rname = `untagged-${rsha.slice(0, 12)}`;
    writeFileSync(join(refused, 'fixture-fail-at-digest-copy'), '');
    const rr = runInstall(refused, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(rr.code, rr.stderr).toBe(0);
    expect(rr.stdout).toMatch(new RegExp(`^install: versions: WARN: could not keep ${rname}'s stamp and install record in its directory — no flip can return to it; arm 2 still can$`, 'm'));
    for (const f of ['.ccrc-stamp.json', '.ccrc-digest', '.ccrc-installed']) {
      expect(existsSync(vroot(refused, rname, f)), `${f} survived a refused digest copy`).toBe(false);
    }
    expect(strays(refused)).toEqual([]);
  });

  /** `_ver_kept <name> <role>` on the fixture box, sourced: `rc=<n> why=<VER_WHY>`. */
  const keptAnswer = (home: string, name: string, role = 'both'): string => {
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'),
      `rc=0; _ver_kept '${name}' '${role}' || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    return r.stdout.split('\n').find((l) => l.startsWith('rc=')) ?? `no answer: ${r.stderr}`;
  };

  it('a run that PLACES the tree (how=copy) records a fresh digest: `1:<64 hex>`, mode 644, equal to a re-measure of the version through the shipped recipe — and the version reads kept', () => {
    const home = freshBox('ccrc-install-ver-digest-recorded-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const digest = read(vroot(home, name, '.ccrc-digest'));
    expect(digest).toMatch(/^1:[0-9a-f]{64}\n$/);
    expect(statSync(vroot(home, name, '.ccrc-digest')).mode & 0o777).toBe(0o644);
    const again = sourced(home, join(REPO, 'ccd', 'ccrc'),
      `_ver_digest_of 1 '${vroot(home, name)}' && printf '%s\\n' "$VER_DIGEST_NOW"`);
    expect(again.stdout.trim()).toBe(digest.trim());
    expect(keptAnswer(home, name)).toBe('rc=0 why=');
    expect(strays(home)).toEqual([]);
  });

  it('a placing run whose digest CANNOT be measured keeps nothing: the WARN names why, and neither the stamp copy, the digest nor the record survives — never a kept version with no statement about its bytes (D-3465 (c))', () => {
    const home = mkTmp('ccrc-install-ver-digest-unmeasured-');
    const root = installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(root, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'), "_plat_sha256() { return 1; }; _ver_keep_state install v9.9.0");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("install: versions: WARN: could not keep v9.9.0's stamp and install record in its directory (its digest could not be measured (a file could not be read)) — no flip can return to it; arm 2 still can");
    for (const f of ['.ccrc-stamp.json', '.ccrc-digest', '.ccrc-installed']) {
      expect(existsSync(join(root, f)), `${f} survived`).toBe(false);
    }
  });

  // ── (b) and (d): the launcher over a tree something wrote through ─────────
  /** A W6 box whose pointed-at v9.9.0 is kept, then written through the way
   *  deploy.sh does (a file into the tree; the BOX stamp reshaped to another
   *  build and its record rewritten) — the input the review reproduced. */
  const writtenThroughBox = (prefix: string, opts: { digest?: boolean } = {}): { home: string; kept: string; boxStamp: string } => {
    const home = mkTmp(prefix);
    const kept = installVersionedTree(home, 'v9.9.0', { digest: opts.digest, stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    healthyDoctorBox(home);
    writeFileSync(join(kept, 'agent', 'WRITTEN-THROUGH'), 'a working tree X, rsynced through the link\n');
    const boxStamp = `${JSON.stringify({ sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-25T00:00:00Z', dirty: false })}\n`;
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), boxStamp);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'e'.repeat(40)}\n`);
    return { home, kept, boxStamp };
  };

  it('`ccrc install` from the launcher over a WRITTEN-THROUGH pointed-at version: its keep is NOT taken again, the kept stamp is not installed as the box\'s, npm ci runs (the skip is gone) — and the version stays not kept (D-3465 (b), (d); review 179 F2)', () => {
    const { home, kept, boxStamp } = writtenThroughBox('ccrc-install-ver-launcher-wt-');
    expect(keptAnswer(home, 'v9.9.0'), 'the control is broken: the written-through tree must read as such').toMatch(/^rc=3 /);
    const stampBefore = read(join(kept, '.ccrc-stamp.json'));
    const recordBefore = read(join(kept, '.ccrc-installed'));
    const digestBefore = read(join(kept, '.ccrc-digest'));
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    // (d) the npm-ci skip takes the bytes' answer: this is an in-place npm ci.
    expect(r.stdout).not.toMatch(/is kept \(its install record is present and its digest re-measures equal\) — no npm ci/);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, 'v9.9.0', 'server')]);
    // (d) the kept-stamp fallback takes it too: the box keeps ITS stamp.
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.0's kept stamp is not installed — it is not a kept version \(its tree is no longer the one that was kept /m);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(boxStamp);
    // (b) the keep is not taken again, and nothing the version kept moved.
    expect(r.stdout).toMatch(/^install: versions: v9\.9\.0 is NOT kept again by this run — its tree is no longer the one that was kept /m);
    expect(r.stdout).not.toMatch(/^install: versions: kept v9\.9\.0's stamp/m);
    expect(read(join(kept, '.ccrc-stamp.json'))).toBe(stampBefore);
    expect(read(join(kept, '.ccrc-installed'))).toBe(recordBefore);
    expect(read(join(kept, '.ccrc-digest'))).toBe(digestBefore);
    expect(keptAnswer(home, 'v9.9.0'), 'the launcher made a written-through version kept').toMatch(/^rc=3 /);
  });

  it('`ccrc install` from the launcher over a version kept BEFORE digests existed: the recorded digest it needs is absent, so it is not kept again — no digest is invented by a run that placed nothing — and npm ci runs', () => {
    const { home, kept } = writtenThroughBox('ccrc-install-ver-launcher-nodigest-', { digest: false });
    rmSync(join(kept, 'agent', 'WRITTEN-THROUGH'));   // clean bytes: the ONLY defect is the missing digest
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, 'v9.9.0', 'server')]);
    expect(r.stdout).toMatch(/^install: versions: v9\.9\.0 is NOT kept again by this run — no kept digest /m);
    expect(existsSync(join(kept, '.ccrc-digest')), 'a run that placed nothing recorded a digest').toBe(false);
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
  });

  it('a run of ANOTHER placed version\'s ccrc, that version written through: it is flipped to (an operator\'s explicit act) but not kept again, its kept stamp is not installed, and it runs npm ci (D-3465 (b), (d))', () => {
    const home = mkTmp('ccrc-install-ver-other-wt-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const other = installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    writeFileSync(join(other, 'shared', 'WRITTEN-THROUGH'), 'x\n');
    const digestBefore = read(join(other, '.ccrc-digest'));
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at /m);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, 'v9.9.1', 'server')]);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version /m);
    // With no kept stamp installed the box has no stamp at all, so no record is written and nothing is kept.
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
    expect(r.stdout).not.toMatch(/^install: versions: kept v9\.9\.1's stamp/m);
    expect(read(join(other, '.ccrc-digest'))).toBe(digestBefore);
    expect(keptAnswer(home, 'v9.9.1')).toMatch(/^rc=3 /);
  });

  it('the other refusal: a source tree that is NOT a placed version but carries a stray kept stamp is PLACED by copy (how=copy) — its kept stamp is refused as "not a version under $HOME/ccrc-versions", and because that run flipped `~/ccrc` the stale box stamp is removed too (review 179 I1)', () => {
    const home = freshBox('ccrc-install-ver-stray-stamp-');
    const tree = treeRoot(home);
    writeFileSync(join(tree, '.ccrc-stamp.json'), `${JSON.stringify({ sha: 'd'.repeat(40), ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false, version: 'v9.9.9' })}\n`);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), `${JSON.stringify({ sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-20T00:00:00Z', dirty: false })}\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'e'.repeat(40)}\n`);
    const r = runInstall(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: placed /m);
    expect(r.stdout).toMatch(/^install: stamp: the kept stamp beside this tree is not installed — this run placed the tree by copy, and only a version already placed under \$HOME\/ccrc-versions is read for its kept stamp$/m);
    expect(r.stdout).toMatch(/^install: stamp: removed the box's stamp \(it names untagged-eeeeeeeeeeee, not unstamped-[0-9a-f]{12}, the version this run moved \$HOME\/ccrc to\) — ccrc version will say unstamped$/m);
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the box kept a stamp naming a build it no longer runs').toBe(false);
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
  });

  it('`_inst_stamp_shipped` resolves no path physically: it reads the version name `_inst_tree` measured (`INST_TREE_HOW`/`INST_TREE_NAME`) — constraint 3 lists the only physical resolutions, and a second `pwd -P` on `~/ccrc` is not among them (review 179 M6). A literal-absence pin, honest as one', () => {
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const start = src.indexOf('\n_inst_stamp_shipped() {');
    expect(start, '_inst_stamp_shipped is gone or renamed — update this pin WITH the name').toBeGreaterThan(0);
    const end = src.indexOf('\n}\n', start);
    const body = src.slice(start, end);
    expect(body).toContain('INST_TREE_NAME');
    for (const banned of ['pwd -P', 'readlink -f', 'realpath', 'cd -P']) {
      expect(body, `_inst_stamp_shipped resolves a path physically (${banned})`).not.toContain(banned);
    }
  });

  it('the digest is an install-path tool now: with `sha256sum` (`shasum` on macOS) ABSENT from PATH a placing run cannot measure the tree, so it keeps NOTHING — the WARN names why, no stamp copy, digest or record is written, and the version never reads kept (review 179 M2, D-3465 (c))', () => {
    const home = freshBox('ccrc-install-ver-no-sha256-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, SHA256_TOOL) });
    expect(r.stdout, `stderr: ${r.stderr}`).toMatch(new RegExp(`^install: versions: WARN: could not keep ${name}'s stamp and install record in its directory \\(its digest could not be measured \\(`, 'm'));
    for (const f of ['.ccrc-stamp.json', '.ccrc-digest', '.ccrc-installed']) {
      expect(existsSync(vroot(home, name, f)), `${f} was written by a run that could not measure the tree`).toBe(false);
    }
    // never "kept": a version with no record reads incomplete (rc 2), whatever the PATH
    expect(keptAnswer(home, name)).toMatch(/^rc=2 why=no /);
  });

  it('_ver_keep_state records a fresh digest only for the version THIS run placed: a placed name that `~/ccrc` no longer names records nothing — a concurrent plain install re-pointed the link between this run\'s flip and its keep (review 179 M3, D-3465 (b))', () => {
    const home = mkTmp('ccrc-install-ver-placed-name-');
    const root = installVersionedTree(home, 'v9.9.0', { digest: false, stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(root, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
    // this run placed v9.9.1, but ~/ccrc names v9.9.0 by now: the bytes under v9.9.0 are not this run's
    const other = sourced(home, join(REPO, 'ccd', 'ccrc'), '_ver_keep_state install v9.9.1');
    expect(other.code, other.stderr).toBe(0);
    expect(other.stdout).toContain('install: versions: this run placed v9.9.1, but $HOME/ccrc names v9.9.0 by now — no fresh digest is recorded for bytes this run did not place');
    expect(other.stdout).toMatch(/^install: versions: v9\.9\.0 is NOT kept again by this run — no kept digest /m);
    expect(existsSync(join(root, '.ccrc-digest')), 'a digest was blessed over bytes this run did not place').toBe(false);
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
    // control: the name it placed IS the name ~/ccrc has — a fresh digest, and the version reads kept
    const same = sourced(home, join(REPO, 'ccd', 'ccrc'), '_ver_keep_state install v9.9.0');
    expect(same.code, same.stderr).toBe(0);
    expect(same.stdout).toMatch(/^install: versions: kept v9\.9\.0's stamp and install record /m);
    expect(read(join(root, '.ccrc-digest'))).toMatch(/^1:[0-9a-f]{64}\n$/);
    expect(keptAnswer(home, 'v9.9.0')).toBe('rc=0 why=');
  });

  it('_ver_keep_state with NO placed name (a `running`/`placed` spine, or a pre-W6 spine that wrote in place) takes the keep again exactly when the recorded digest re-measures equal — re-placed bytes that measure equal are re-kept, bytes that differ are not (review 179 M4; D-3465 (b))', () => {
    const home = mkTmp('ccrc-install-ver-rekeep-');
    const root = installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(root, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    const digest = read(join(root, '.ccrc-digest'));
    const eq = sourced(home, join(REPO, 'ccd', 'ccrc'), "_ver_keep_state update ''");
    expect(eq.stdout).toMatch(/^update: versions: kept v9\.9\.0's stamp and install record /m);
    expect(read(join(root, '.ccrc-digest'))).toBe(digest);
    writeFileSync(join(root, 'shared', 'WRITTEN-THROUGH'), 'x\n');
    const differ = sourced(home, join(REPO, 'ccd', 'ccrc'), "_ver_keep_state update ''");
    expect(differ.stdout).toMatch(/^update: versions: v9\.9\.0 is NOT kept again by this run — its tree is no longer the one that was kept /m);
    expect(read(join(root, '.ccrc-digest')), 'the digest was rewritten over bytes this run did not place').toBe(digest);
  });

  /** A W6 box that ALREADY completed an install of v9.9.0 (pointed at, kept,
   *  its stamp and record in `~/.ccrc`) plus a second placed version v9.9.1
   *  that is not pointed at. The state the review's I1 probe started from —
   *  the existing `ANOTHER placed version` pin starts from a box with NO
   *  stamp, which is why it could not see the carry-forward. */
  const stampedBoxWithOther = (prefix: string, other: { writeThrough: boolean }): { home: string; oldRoot: string; otherRoot: string } => {
    const home = mkTmp(prefix);
    const oldRoot = installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const otherRoot = installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(oldRoot, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    if (other.writeThrough) writeFileSync(join(otherRoot, 'shared', 'WRITTEN-THROUGH'), 'x\n');
    return { home, oldRoot, otherRoot };
  };

  it('a run of ANOTHER placed version\'s ccrc, that version written through, from a box that ALREADY carries a stamp: the flip happens, so the box stamp that names the build the box LEFT is removed — the install is not recorded as completed for a build that is not running, and `ccrc version` says unstamped (D-3465 (d); review 179 I1)', () => {
    const { home, otherRoot } = stampedBoxWithOther('ccrc-install-ver-other-wt-stamped-', { writeThrough: true });
    expect(keptAnswer(home, 'v9.9.1'), 'the control is broken: the placed tree must read as written through').toMatch(/^rc=3 /);
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at /m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(otherRoot);
    // the stamp that named v9.9.0's build is gone, and the run says so
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the box kept a stamp naming the build it just left').toBe(false);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version /m);
    expect(r.stdout).toMatch(/^install: stamp: removed the box's stamp \(it names v9\.9\.0, not v9\.9\.1, the version this run moved \$HOME\/ccrc to\) — ccrc version will say unstamped$/m);
    // so `_inst_installed` takes its no-stamp arm: nothing is recorded as completed, nothing is kept
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
    expect(r.stdout).not.toMatch(/^install: installed: 9{40} /m);
    expect(r.stdout).not.toMatch(/^install: versions: kept v9\.9\.1's stamp/m);
    // what the box then says of itself
    const v = runInstall(home, ['version'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(`${v.stdout}${v.stderr}`).toMatch(/unstamped \(no /m);
    expect(keptAnswer(home, 'v9.9.1')).toMatch(/^rc=3 /);
  });

  it('control: the same flip onto a version that IS kept installs that version\'s kept stamp, so the box names the build it now runs (nothing is removed)', () => {
    const { home } = stampedBoxWithOther('ccrc-install-ver-other-kept-stamped-', { writeThrough: false });
    expect(keptAnswer(home, 'v9.9.1')).toBe('rc=0 why=');
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/removed the box's stamp/);
    expect(JSON.parse(read(join(home, '.ccrc', 'build.json'))).sha).toBe('c'.repeat(40));
  });

  it('control: `ccrc install` from the LAUNCHER (how=running) over a written-through pointed-at version keeps the box stamp — it names the version `~/ccrc` still points at, so nothing is removed', () => {
    const { home, boxStamp } = writtenThroughBox('ccrc-install-ver-launcher-wt-stamp-keep-');
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/removed the box's stamp/);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(boxStamp);
  });

  // Wave 9 R8i (D-3828): a skip writes nothing, so a box stamp that is still there afterwards STAYS — and the
  // skip line must not say `ccrc version will say unstamped` over it. The run is FROM the version `~/ccrc` points
  // at, so `_inst_tree` itself answers `running` (INST_TREE_HOW is set in-process, never read from the environment)
  // and `_inst_stamp_unname` returns 1 for it before it touches the stamp; the tree carries no `build.json`, the
  // kept stamp beside it is the fallback `_inst_stamp_shipped` reads, that version is NOT kept (no digest, rc 2),
  // and git is off PATH, so `_inst_stamp` lands on its no-git skip with the box's stamp still on disk.
  it('a skipped stamp over a box stamp that STAYS says so — the launcher run, no build.json in the tree, the version not kept, git off PATH: the line names the existing stamp, never `unstamped` (wave 9 R8i, D-3828)', () => {
    const { home, boxStamp } = writtenThroughBox('ccrc-install-stamp-stays-skip-', { digest: false });
    expect(existsSync(join(home, 'ccrc', 'build.json')), 'the control is broken: the tree must carry no build.json').toBe(false);
    expect(keptAnswer(home, 'v9.9.0'), 'the control is broken: the version must be not kept').toMatch(/^rc=2 why=no kept digest /);
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'git') }, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(no git on PATH\) — the box's existing stamp \(~\/\.ccrc\/build\.json\) stays — ccrc version reports what it says$/m);
    expect(r.stdout, 'a stamp that stays was called unstamped').not.toMatch(/will say unstamped/);
    expect(read(join(home, '.ccrc', 'build.json')), 'the skip rewrote or removed the stamp').toBe(boxStamp);
  });

  // ── N1 (re-review of fix round 1): the removal is for a stamp that names
  //    ANOTHER version. The name compared is the one `_inst_tree` placed or
  //    flipped to (`INST_TREE_NAME`): the stamp's `version` when it has one,
  //    else `untagged-<sha12>`; an `unstamped-*` target is never a stamp's
  //    name, and a stamp that cannot be read names nothing comparable.
  it('a hand repair onto a digestless version whose box stamp ALREADY names it (a killed flip\'s leftovers): the flip is a no-op, the stamp stays, the install is recorded for the build that runs, and no line says the box "just left" it (D-3465 (d); re-review N1 shape A)', () => {
    const home = mkTmp('ccrc-install-ver-stamp-names-target-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const other = installVersionedTree(home, 'v9.9.1', { link: false, digest: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    // the killed flip's leftovers: the stamp is v9.9.1's, the record is not written
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(other, '.ccrc-stamp.json')));
    const stampBefore = read(join(home, '.ccrc', 'build.json'));
    expect(keptAnswer(home, 'v9.9.1'), 'the control is broken: the version must read digestless (unmeasured)').toMatch(/^rc=2 why=no kept digest /);
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version /m);
    expect(r.stdout, 'the run says the box left the build it is moving to').not.toMatch(/removed the box's stamp/);
    expect(r.stdout).toMatch(/^install: stamp: the box's stamp already names v9\.9\.1, the version this run moved \$HOME\/ccrc to — it stays$/m);
    expect(r.stdout, 'a stamp that stays is not "skipped, ccrc version will say unstamped"').not.toMatch(/^install: stamp: skipped/m);
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the stamp that names the version this run moved to was removed').toBe(true);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(stampBefore);
    expect(r.stdout).toMatch(/^install: installed: c{40} /m);
    expect(read(join(home, '.ccrc', 'installed'))).toBe(`${'c'.repeat(40)}\nunsigned\n`);
  });

  it('the same hand repair onto a version that is WRITTEN THROUGH (its digest re-measures unequal): the box stamp names it, but nothing shows those bytes to be that build — the stamp is removed whatever it names, no completed install is recorded, and `ccrc version` does not read `complete` (D-3465 (d); FX-A2 review M1)', () => {
    const home = mkTmp('ccrc-install-ver-stamp-names-written-through-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const other = installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    // the killed flip's leftovers, exactly as the digestless pin plants them ...
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(other, '.ccrc-stamp.json')));
    // ... but the version was kept WITH a digest and something has written through it since
    mkdirSync(join(other, 'shared'), { recursive: true });
    writeFileSync(join(other, 'shared', 'WRITTEN-THROUGH'), 'a deploy.sh rsync through the link\n');
    expect(keptAnswer(home, 'v9.9.1'), 'the control is broken: the version must read written through').toMatch(/^rc=3 why=its tree is no longer the one that was kept/);
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version \(its tree is no longer the one that was kept/m);
    expect(r.stdout, 'a stamp over written-through bytes stayed because it names the target').not.toMatch(/already names/);
    expect(r.stdout).toMatch(/^install: stamp: removed the box's stamp \(it names v9\.9\.1, the version this run moved \$HOME\/ccrc to, but that version's tree was written through since it was kept/m);
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the stamp survived over written-through bytes').toBe(false);
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'a completed install was recorded over written-through bytes').toBe(false);
    const v = runInstall(home, ['version'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(v.stdout).not.toMatch(/^install: complete/m);
    expect(v.stdout).toMatch(/unstamped/);
    expect(keptAnswer(home, 'v9.9.1'), 'the run laundered a keep').toMatch(/^rc=3 /);
  });

  it('a launcher migration of a real ~/ccrc whose target directory holds a LEFTOVER kept stamp: the box stamp names the migrated version, so it stays, and no line says "this tree is not a version" of a tree that IS the version by then (D-3465 (d); re-review N1 shape B)', () => {
    const home = mkTmp('ccrc-install-ver-migrate-leftover-');
    const root = installFixtureTree(home, 'ccrc');
    healthyDoctorBox(home);
    const stamp = `${JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false, version: 'v9.9.2' })}\n`;
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), stamp);
    // the migrated version's name is the stamp's version; its directory already holds a kept stamp
    mkdirSync(vroot(home, 'v9.9.2'), { recursive: true });
    writeFileSync(vroot(home, 'v9.9.2', '.ccrc-stamp.json'), stamp);
    const r = runInstall(home, ['install'], {}, { from: ccrcIn(root) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: migrating — \$HOME\/ccrc is a directory; v9\.9\.2 is complete at /m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.2'));
    expect(r.stdout, 'a false "not a version" line: the migration had just made it one').not.toMatch(/this tree is not a version under/);
    expect(r.stdout).not.toMatch(/removed the box's stamp/);
    expect(r.stdout).toMatch(/^install: stamp: the box's stamp already names v9\.9\.2, the version this run moved \$HOME\/ccrc to — it stays$/m);
    expect(r.stdout, 'a stamp that stays is not "skipped, ccrc version will say unstamped"').not.toMatch(/^install: stamp: skipped/m);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(stamp);
    expect(r.stdout).toMatch(/^install: installed: a{40} /m);
    // the migration made the copy the version `~/ccrc` names, so it is kept with a fresh digest
    expect(keptAnswer(home, 'v9.9.2')).toBe('rc=0 why=');
  });

  it('a stamp with NO `version` names `untagged-<sha12>`: flipped onto that very name it stays; a stamp that cannot be read names nothing comparable, so it is removed and the line says it could not be read (D-3465 (d); N1\'s rule)', () => {
    const untagged = `untagged-${'c'.repeat(12)}`;
    const mk = (prefix: string): { home: string; other: string } => {
      const home = mkTmp(prefix);
      installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
      const other = installVersionedTree(home, untagged, { link: false, digest: false, stamp: { sha: 'c'.repeat(40) } });
      healthyDoctorBox(home);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      return { home, other };
    };
    const a = mk('ccrc-install-ver-stamp-untagged-');
    writeFileSync(join(a.home, '.ccrc', 'build.json'), read(join(a.other, '.ccrc-stamp.json')));
    const ra = runInstall(a.home, ['install'], {}, { from: vroot(a.home, untagged, 'ccd', 'ccrc') });
    expect(ra.code, `stderr: ${ra.stderr}\nstdout: ${ra.stdout}`).toBe(0);
    expect(readlinkSync(join(a.home, 'ccrc'))).toBe(a.other);
    expect(ra.stdout).not.toMatch(/removed the box's stamp/);
    expect(ra.stdout).toMatch(new RegExp(`^install: stamp: the box's stamp already names ${untagged}, the version this run moved \\$HOME/ccrc to — it stays$`, 'm'));
    expect(ra.stdout, 'a stamp that stays is not "skipped, ccrc version will say unstamped"').not.toMatch(/^install: stamp: skipped/m);
    expect(existsSync(join(a.home, '.ccrc', 'build.json'))).toBe(true);
    expect(read(join(a.home, '.ccrc', 'build.json')), 'the stamp that names the target changed').toBe(read(join(a.other, '.ccrc-stamp.json')));
    expect(read(join(a.home, '.ccrc', 'installed')), 'the install was not recorded for the build that runs').toBe(`${'c'.repeat(40)}\nunsigned\n`);
    const u = mk('ccrc-install-ver-stamp-unreadable-');
    writeFileSync(join(u.home, '.ccrc', 'build.json'), 'not json {\n');
    const ru = runInstall(u.home, ['install'], {}, { from: vroot(u.home, untagged, 'ccd', 'ccrc') });
    expect(ru.code, `stderr: ${ru.stderr}\nstdout: ${ru.stdout}`).toBe(0);
    expect(ru.stdout).toMatch(/^install: stamp: removed the box's stamp \(it could not be read, so it cannot be shown to name a version this box is on\) — ccrc version will say unstamped$/m);
    expect(existsSync(join(u.home, '.ccrc', 'build.json'))).toBe(false);
  });

  itDarwin('refuses on macOS without python3, before anything is written — the flip is one rename through os.replace', () => {
    const home = freshBox('ccrc-install-ver-nopython-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'python3') }, { omit: ['python3'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('the macOS python3 preflight, measured on a gating leg: CCD_OS forced to darwin, a python3 that is on PATH but does not run is refused before anything is written (F7, C-Minor-3)', () => {
    const home = freshBox('ccrc-install-ver-darwin-forced-');
    const bin = join(home, 'forced-darwin-bin');
    mkdirSync(bin, { recursive: true });
    for (const t of ['launchctl', 'tmux', 'flock']) writeFileSync(join(bin, t), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'python3'),
      '#!/bin/sh\necho "xcode-select: note: No developer tools were found, requesting install." >&2\nexit 1\n', { mode: 0o755 });
    // The stubs shadow everything after them; the real PATH follows for bash's own tools.
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'),
      `PATH='${bin}':"$PATH"; CCD_OS=darwin; cmd_install --role both; echo "survived rc=$?"`);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).not.toContain('survived');
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  itDarwin('refuses on macOS when the python3 on PATH does not RUN — /usr/bin/python3 is an xcode-select stub until the Command Line Tools are installed — before anything is written', () => {
    // The shape a real Mac without the Command Line Tools has: `command -v
    // python3` answers /usr/bin/python3, and running it prints the
    // xcode-select note and exits non-zero. The case above (no python3 on
    // PATH at all) cannot happen on macOS; this one is the one that does.
    const home = freshBox('ccrc-install-ver-stubpython-');
    const r = runInstall(home, ['install'], {}, {
      stubs: { python3: '#!/bin/sh\necho "xcode-select: note: No developer tools were found, requesting install." >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'a tree was placed before the refusal').toBe(false);
  });

  // PLATFORM-ONLY: the GC's running-unit read on macOS is plutil over the
  // job's plist, which this harness's plutil stub answers with nothing — an
  // unmeasured read, so a macOS install WARNs and prunes nothing (the safe
  // direction, pinned in ccrc-update.test.ts, where the Darwin read itself is
  // measured by forcing CCD_OS in a sourced shell).
  itLinux('after an install whose doctor passed, the GC keeps the newest CCRC_VERSIONS_KEEP beside the pointed-at one and prunes the rest (W6 Task 5)', () => {
    const home = freshBox('ccrc-install-w6-gc-');
    ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0'].forEach((n, i) => {
      const root = installVersionedTree(home, n, { link: i === 0, stamp: { sha: 'b'.repeat(40), version: n } });
      const t = 1_800_000_000 - i * 100;
      utimesSync(join(root, '.ccrc-installed'), t, t);
    });
    // The projection a `both` box reads (W2's server writes it): in force and
    // naming no tag, so every one of the GC's inputs measures.
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update-intent'), [
      'epoch 1', `issued ${now - 60}`, `lease ${now + 840}`, 'channel stable',
      'desired none', 'desired-stable none', 'desired-dev none', 'auto off', 'end',
    ].join('\n') + '\n', { mode: 0o600 });
    const r = runInstall(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 3\)$/m);
    expect(r.stdout).toMatch(/^install: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 3\)$/m);
    const left = readdirSync(join(home, 'ccrc-versions')).sort();
    const placedName = left.find((n) => n.startsWith('unstamped-'));
    expect(placedName, left.join(' ')).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(left).toEqual([placedName!, 'v1.0.2', 'v1.0.3', 'v1.0.4'].sort());
    // …and it ran BEHIND the gate: after doctor's summary, never before it.
    expect(r.stdout.indexOf('install: versions: pruned'))
      .toBeGreaterThan(r.stdout.search(/^summary: /m));
  });

  // W6 Task 5 introduces a remover that can run BESIDE a plain install, which
  // takes no lock: `ccrc versions --prune` removes an incomplete directory
  // (the one this run is placing), and another run's automatic GC removes a
  // complete one that nothing protects yet. `_plat_ln_swap` never checks its
  // target, so the flip measures it again (D-3456).
  it('a new version removed before the flip — a prune beside a plain install — is refused, and ~/ccrc keeps the version it names (W6 Task 5)', () => {
    const home = freshBox('ccrc-install-w6-vanished-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // This run's last npm ci (the default role runs none in the agent)
    // succeeds and then stands in for the concurrent prune: the directory
    // it ran in is gone before the flip.
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        npm: '#!/bin/sh\nmkdir -p node_modules\n'
          + 'case "$PWD" in */ccrc-versions/v9.9.1/server) rm -rf -- "${PWD%/server}" ;; esac\nexit 0\n',
      },
    });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the new tree at \$HOME\/ccrc-versions\/v9\.9\.1 is gone before the flip — a prune may have run beside this install; \$HOME\/ccrc was not touched, and the install can be run again$/m);
    expect(readlinkSync(join(home, 'ccrc')), '~/ccrc was flipped onto a tree that is gone').toBe(vroot(home, 'v9.9.0'));
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc'))).toBe(true);
    expect(r.stdout).not.toMatch(/one rename$/m);
  });
});

describe('ccrc install: the one-time migration and its crash recovery (W6 Task 3)', () => {
  // A box installed before versioned installs has a REAL directory at
  // `~/ccrc`. The first W6 install places the incoming tree FULLY at
  // `~/ccrc-versions/<name>`, moves the directory aside to `~/ccrc.migrating`
  // and links `~/ccrc` in its place — two syscalls, once per node (spec §11).
  // The old tree goes only after a gate has passed: a plain install's own
  // doctor while `~/.ccrc/update.lock` is FREE, an updater's `_upd_gate`
  // otherwise (D-3431). A crash inside the window is
  // completed FIRST by the next run, from `~/.ccrc/migrating-to` alone.
  const holders: ChildProcess[] = [];
  afterEach(() => {
    for (const h of holders.splice(0)) h.kill('SIGKILL');
  });
  const REAL_LN = realPath('ln');
  const lockPath = (home: string): string => dotCcrc(home, 'update.lock');
  /** A FRESH open and a non-blocking flock — wave 4's probe, from outside. */
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const waitUntil = (cond: () => boolean, what: string): void => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
      spawnSync('sleep', ['0.05']);
    }
  };
  /** Wave 4's real holder: ONE process takes the flock and then becomes
   *  `sleep` (exec keeps the pid and the descriptor), so the pid killed is
   *  the pid holding it. Returns once a fresh probe fails. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    waitUntil(() => !lockFree(home), 'the fixture holder to take the lock');
    return h;
  };
  /** lstat, never stat: an absent or dangling `~/ccrc` must read `absent`,
   *  and a link must read as the link it is, not as its target. */
  const lkind = (p: string): 'absent' | 'link' | 'dir' | 'other' => {
    try {
      const st = lstatSync(p);
      return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'other';
    } catch { return 'absent'; }
  };
  /** Every entry under `dir`, relative path → its bytes — "byte-identical"
   *  as a value two listings can be compared by. */
  const treeBytes = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, prefix: string): void => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        const rel = prefix === '' ? e : `${prefix}/${e}`;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
        else if (st.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p, rel); }
        else out[rel] = readFileSync(p).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  };
  /** Makes this box's doctor FAIL on a check no install step touches — the
   *  per-platform lever `a box doctor fails on exits 1` uses. */
  const failDoctor = (home: string): void => {
    if (process.platform === 'darwin') {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'exposure.env'),
        'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n', { mode: 0o644 });
    } else {
      writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    }
  };
  const healDoctor = (home: string): void => {
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    rmSync(join(home, 'fixture-linger-refuse'), { force: true });
  };
  const migrating = (home: string): string => join(home, 'ccrc.migrating');
  /** A box with a PRE-W6 install: a real `~/ccrc` directory (with a marker
   *  file of its own), and a checkout that is a real one-commit repository,
   *  so the incoming tree's name is `untagged-<sha12>` — known in advance. */
  const preW6Box = (prefix: string): { home: string; name: string; before: Record<string, string> } => {
    const home = freshBox(prefix);
    const sha = gitInit(treeRoot(home));
    installFixtureTree(home, 'ccrc');
    writeFileSync(placed(home, 'OLD-MARKER'), 'the pre-versioned tree\n');
    return { home, name: `untagged-${sha.slice(0, 12)}`, before: treeBytes(placed(home)) };
  };
  const RESUMED = (name: string): string =>
    `install: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/${name} (named by ~/.ccrc/migrating-to)`;
  const REMOVED = 'install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate';
  /** An `ln` that does `act` ONCE — to the first `ln` whose last argument is
   *  `~/ccrc`, the migration's link, while `$HOME/<knob>` exists, removing
   *  the knob first — and is the real `ln` for everything else. */
  const lnOnce = (knob: string, act: string): string => '#!/bin/sh\n'
    + 'for last in "$@"; do :; done\n'
    + `if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/${knob}" ]; then rm -f "$HOME/${knob}"; ${act}; fi\n`
    + `exec ${REAL_LN} "$@"\n`;

  it('a doctor that FAILS keeps ~/ccrc.migrating byte for byte, beside its marker — and the next install whose doctor passes removes both (§18 "the migration keeps the old tree until the gate")', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-doctor-fail-');
    failDoctor(home);
    let r = runInstall(home);
    expect(r.code, 'the lever did not make doctor fail — the keep below would be vacuous').toBe(1);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
    expect(treeBytes(migrating(home))).toEqual(before);
    expect(read(dotCcrc(home, 'migrating-to'))).toBe(`${name}\n`);
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — ccrc doctor did not pass; the next install or update whose gate passes removes it$/m);
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
    // THE CONTROL: the same box with its doctor healed — the directory goes.
    healDoctor(home);
    r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
    expect(existsSync(dotCcrc(home, 'migrating-to'))).toBe(false);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
  });

  it('a spine run while ~/.ccrc/update.lock is held is a STAGED spine: its doctor passing is not the gate, so ~/ccrc.migrating stays for the updater\'s gate to decide (D-3431)', () => {
    const { home } = preW6Box('ccrc-install-migrate-lock-held-');
    const h = holdLock(home);
    let r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — an update holds ~\/\.ccrc\/update\.lock, and its health gate decides$/m);
    expect(lkind(migrating(home))).toBe('dir');
    expect(lockFree(home), 'the install took, or broke, a lock it did not hold').toBe(false);
    // THE CONTROL: the holder gone, the identical install is its own gate.
    h.kill('SIGKILL');
    waitUntil(() => lockFree(home), 'the fixture holder to release the lock');
    r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lockFree(home), 'the install left ~/.ccrc/update.lock held').toBe(true);
  });

  it('a crash inside the two-syscall window leaves exactly ~/ccrc.migrating and ~/.ccrc/migrating-to; the next install, run by the placed version\'s own path, links it BEFORE its banner (§18 "a crashed migration is completed first")', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-crash-');
    const vdir = join(home, 'ccrc-versions', name);
    writeFileSync(join(home, 'fixture-ln-crash'), 'yes\n');
    // The migration's `ln -sn` runs in ccrc's OWN shell, so $PPID is the run.
    const lnStub = '#!/bin/sh\n'
      + 'printf \'%s\\n\' "$*" >> "$HOME/ln-argv"\n'
      + 'for last in "$@"; do :; done\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-crash" ]; then kill -KILL "$PPID"; exit 1; fi\n'
      + `exec ${REAL_LN} "$@"\n`;
    let r = runInstall(home, ['install'], {}, { stubs: { ln: lnStub } });
    expect(r.code, 'the run was not killed inside the window (-1 is the runner\'s null status)').toBe(-1);
    expect(r.stdout.split('\n')).toContain(`install: tree: migrating — $HOME/ccrc is a directory; ${name} is complete at $HOME/ccrc-versions/${name}`);
    // The link is placed with -n (D-3434).
    const lnCalls = read(join(home, 'ln-argv')).trim().split('\n');
    expect(lnCalls[lnCalls.length - 1]).toBe(`-sn -- ${vdir} ${placed(home)}`);
    // Exactly the crash pair: the old tree aside, the marker, the new version
    // FULLY placed before the window opened — and no ~/ccrc at all.
    expect(lkind(placed(home))).toBe('absent');
    expect(treeBytes(migrating(home))).toEqual(before);
    expect(read(dotCcrc(home, 'migrating-to'))).toBe(`${name}\n`);
    expect(existsSync(join(vdir, 'ccd', 'ccrc'))).toBe(true);
    expect(existsSync(join(vdir, 'server', 'node_modules')), 'the version was not placed FULLY before the window').toBe(true);
    // THE COMPLETION: disarmed, and run by the path the die sentence names
    // (the launcher shim cannot run with no ~/ccrc).
    rmSync(join(home, 'fixture-ln-crash'));
    r = runInstall(home, ['install'], {}, { from: join(vdir, 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0], 'the link was not completed FIRST').toBe(RESUMED(name));
    expect(lines[1]).toBe(`install: box: ${home}`);
    expect(readlinkSync(placed(home))).toBe(vdir);
    // A placed version installing from itself copies nothing (Task 2's (a)).
    expect(lines).toContain('install: tree: already running from $HOME/ccrc');
    expect(lines).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
  });

  it('the resume links what ~/.ccrc/migrating-to names — never a guess such as the newest directory (D-3432)', () => {
    const home = freshBox('ccrc-install-migrate-marker-');
    installFixtureTree(home, 'ccrc.migrating');
    const kept = installVersionedTree(home, 'v1.0.0', { link: false });
    // NEWER and incomplete: the directory a crashed run could have been
    // half-way through placing when it died.
    const newer = installVersionedTree(home, 'v9.9.9', { link: false, complete: false });
    utimesSync(kept, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(newer, new Date(), new Date());
    preexisting(home, 'migrating-to', 'v1.0.0\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe(RESUMED('v1.0.0'));
    expect(lkind(placed(home))).toBe('link');
  });

  const refusals: Array<[string, string | null, string]> = [
    ['is absent', null, 'is absent'],
    ['names a version nobody placed', 'v7.7.7\n', 'does not name a placed version'],
    ['is not a version name at all', '../../etc\n', 'does not name a placed version'],
  ];
  it.each(refusals)('a crash pair whose ~/.ccrc/migrating-to %s is REFUSED before the banner, with both by-hand remedies, and nothing is changed', (_label, marker, says) => {
    const home = freshBox('ccrc-install-migrate-refused-');
    installFixtureTree(home, 'ccrc.migrating');
    installVersionedTree(home, 'v1.0.0', { link: false });
    if (marker !== null) preexisting(home, 'migrating-to', marker);
    const before = treeBytes(migrating(home));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`ccrc: a migration of $HOME/ccrc crashed and ~/.ccrc/migrating-to ${says} — nothing was changed. To go back: mv $HOME/ccrc.migrating $HOME/ccrc — or, to go forward: ln -s $HOME/ccrc-versions/<name> $HOME/ccrc`);
    expect(r.stdout, 'a step ran past the refusal').not.toMatch(/^install: /m);
    expect(lkind(placed(home))).toBe('absent');
    expect(treeBytes(migrating(home))).toEqual(before);
  });

  it('a lock that cannot be MEASURED is neither free nor held: ~/ccrc.migrating is kept with its own sentence even though the doctor passed (ruling R16)', () => {
    const { home, name } = preW6Box('ccrc-install-migrate-lock-unmeasured-');
    // A DIRECTORY at the lock path: the open fails whatever the uid (wave 4
    // Task 3's idiom), so `_ver_lock_try` answers 3.
    mkdirSync(lockPath(home), { recursive: true });
    const r = runInstall(home);
    // Measured red first (Step 4): if the directory also moved the doctor's
    // verdict, the keep below would be the doctor's, not the lock arm's.
    expect(r.code, `the doctor must pass here — ${r.stderr}`).toBe(0);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — ~\/\.ccrc\/update\.lock could not be taken or measured \(unmeasured\), so no gate is known to have passed$/m);
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('dir');
  });

  it('a link that cannot be placed moves ~/ccrc BACK: the pre-versioned directory byte for byte, no marker, the version complete — never a crash pair left for an updater to complete (D-3436)', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-ln-fail-');
    const vdir = join(home, 'ccrc-versions', name);
    const stub = lnOnce('fixture-ln-fail-once', 'echo "ln: fixture refusal" >&2; exit 1');
    writeFileSync(join(home, 'fixture-ln-fail-once'), 'yes\n');
    let r = runInstall(home, ['install'], {}, { stubs: { ln: stub } });
    expect(existsSync(join(home, 'fixture-ln-fail-once')), 'the refusal never fired').toBe(false);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`ccrc: $HOME/ccrc could not be linked to $HOME/ccrc-versions/${name}, so it was moved back — nothing moved; $HOME/ccrc is still the directory it was, and ${name} is complete at $HOME/ccrc-versions/${name}`);
    expect(lkind(placed(home))).toBe('dir');
    expect(treeBytes(placed(home))).toEqual(before);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lkind(dotCcrc(home, 'migrating-to'))).toBe('absent');
    expect(existsSync(join(vdir, 'ccd', 'ccrc'))).toBe(true);
    // THE CONTROL: the knob is spent, so the identical install migrates.
    r = runInstall(home, ['install'], {}, { stubs: { ln: stub } });
    expect(r.code, r.stderr).toBe(0);
    expect(readlinkSync(placed(home))).toBe(vdir);
    expect(r.stdout.split('\n')).toContain(REMOVED);
  });

  it('a link nested INSIDE a real directory that appeared at ~/ccrc is refused by the [ -L ] check, never reported as placed (D-3434)', () => {
    const { home, name } = preW6Box('ccrc-install-migrate-ln-nest-');
    writeFileSync(join(home, 'fixture-ln-nest-once'), 'yes\n');
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnOnce('fixture-ln-nest-once', 'mkdir -p "$HOME/ccrc"') } });
    expect(existsSync(join(home, 'fixture-ln-nest-once')), 'the stub never fired').toBe(false);
    // The real `ln -sn` nested the link and exited 0 — the shape `-n` cannot
    // refuse. Without it the case would be vacuous.
    expect(lkind(join(placed(home), name)), 'the real ln did not nest').toBe('link');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc was moved to $HOME/ccrc.migrating but the link could not be placed');
    expect(r.stdout.split('\n')).not.toContain(`install: tree: $HOME/ccrc -> $HOME/ccrc-versions/${name} (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)`);
    // The move back cannot replace the non-empty directory now standing at
    // ~/ccrc, so the old tree stays aside, whole.
    expect(lkind(migrating(home))).toBe('dir');
  });

  it('_inst_migrate re-measures the layout before it moves anything: a ~/ccrc that stopped being a directory while the version was placed is refused, and nothing moves (its step 0)', () => {
    const home = freshBox('ccrc-install-migrate-changed-');
    const v1 = installVersionedTree(home, 'v1.0.0');   // ~/ccrc is a LINK now
    installVersionedTree(home, 'v2.0.0', { link: false });
    const r = spawnSync(BASH, ['-c', '. "$1"; _inst_migrate v2.0.0', '_', ccrcIn(treeRoot(home))],
      { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc changed while this run placed v2.0.0 (it now reads linked) — nothing moved; v2.0.0 is complete at $HOME/ccrc-versions/v2.0.0');
    expect(readlinkSync(placed(home))).toBe(v1);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lkind(dotCcrc(home, 'migrating-to'))).toBe('absent');
  });
});

describe('ccrc install: workspace build-artifact excludes (_inst_ws_build_excludes)', () => {
  it('converges node_modules/cdk.out into a project AND its worktree, ignoring a node_modules SYMLINK there', () => {
    const home = freshBox('ccrc-install-ws-excl-');
    const repoA = join(home, 'projects', 'repoA');
    mkdirSync(repoA, { recursive: true });
    writeFileSync(join(repoA, 'a.txt'), 'x\n');
    gitInit(repoA);
    const ws1 = join(home, 'worktrees', 'repoA', 'ws1');
    mkdirSync(join(home, 'worktrees', 'repoA'), { recursive: true });
    const wtAdd = spawnSync('git', ['-C', repoA, 'worktree', 'add', ws1, '-b', 'ws1'], { encoding: 'utf8' });
    expect(wtAdd.status, wtAdd.stderr).toBe(0);

    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: workspace: build-artifact excludes converged \(node_modules, cdk\.out; \d+ new\)$/m);

    // EXACT LINES, for the reason ccd-workspaces.test.ts states beside its own
    // copy: a substring assertion is satisfied by the trailing-slash spelling,
    // which IS the bug. The absence pin is the half that reds on a regression.
    const excludeFile = join(repoA, '.git', 'info', 'exclude');
    const excl = readFileSync(excludeFile, 'utf8').split('\n');
    expect(excl).toContain('node_modules');
    expect(excl).toContain('cdk.out');
    expect(excl).not.toContain('node_modules/');
    expect(excl).not.toContain('cdk.out/');

    // The real defect (measured live on the fleet): a workspace whose
    // node_modules is a SYMLINK to a shared cache, which a trailing-slash
    // pattern does not match. This backfill's lines carry no trailing slash.
    mkdirSync(join(home, 'shared-cache'));
    symlinkSync(join(home, 'shared-cache'), join(ws1, 'node_modules'), 'dir');
    const checkIgnore = spawnSync('git', ['-C', ws1, 'check-ignore', '-q', 'node_modules'], { encoding: 'utf8' });
    expect(checkIgnore.status).toBe(0);
    const status = spawnSync('git', ['-C', ws1, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(status.stdout).toBe('');

    // A second run converges the same lines, not a second copy of them.
    const first = readFileSync(excludeFile, 'utf8');
    const r2 = runInstall(home, ['install']);
    expect(r2.code, r2.stderr).toBe(0);
    expect(readFileSync(excludeFile, 'utf8')).toBe(first);
  });

  it('retrofits a repository reachable only through $HOME/worktrees', () => {
    const home = freshBox('ccrc-install-ws-excl-worktree-only-');
    const externalRepo = join(home, 'external', 'repoB');
    mkdirSync(externalRepo, { recursive: true });
    writeFileSync(join(externalRepo, 'b.txt'), 'x\n');
    gitInit(externalRepo);

    const wsOnly = join(home, 'worktrees', 'repoB', 'ws-only');
    mkdirSync(join(home, 'worktrees', 'repoB'), { recursive: true });
    const wtAdd = spawnSync(
      'git', ['-C', externalRepo, 'worktree', 'add', wsOnly, '-b', 'ws-only'],
      { encoding: 'utf8' },
    );
    expect(wtAdd.status, wtAdd.stderr).toBe(0);

    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);

    // The main checkout is deliberately outside $HOME/projects. Only the
    // linked worktree makes this repository discoverable, so deleting the
    // $HOME/worktrees scan root leaves this assertion red.
    const excludeFile = join(externalRepo, '.git', 'info', 'exclude');
    const excl = readFileSync(excludeFile, 'utf8').split('\n');
    expect(excl).toContain('node_modules');
    expect(excl).toContain('cdk.out');
    expect(excl).not.toContain('node_modules/');
    expect(excl).not.toContain('cdk.out/');
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-install-ws-excl-server-');
    const repoA = join(home, 'projects', 'repoA');
    mkdirSync(repoA, { recursive: true });
    writeFileSync(join(repoA, 'a.txt'), 'x\n');
    gitInit(repoA);

    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    const excludeFile = join(repoA, '.git', 'info', 'exclude');
    expect(existsSync(excludeFile) && readFileSync(excludeFile, 'utf8').includes('node_modules'))
      .toBe(false);
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
    // Stage 4, Task 1: no v* tag points at the fixture commit, so the stamp
    // carries NO version key at all — additive absence, not an empty value.
    expect('version' in stamp).toBe(false);
    // 0644 like deploy's, and asserted under a hostile umask so the mode can
    // only have come from a chmod — at 077 a plain redirect makes it 0600.
    expect(statSync(dotCcrc(home, 'build.json')).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(new RegExp(`^install: stamp: ${sha}`, 'm'));
  });

  it('stamps the version when a v* tag points at the installed commit (Stage 4, Task 1)', () => {
    // The tag IS the release identity, measured by `git tag --points-at HEAD`
    // — never assumed. The transcript line carries it too, so an operator
    // watching an install sees the release they got.
    const home = freshBox('ccrc-install-stamp-tag-');
    const root = treeRoot(home);
    const sha = gitInit(root);
    const tag = (name: string): void => {
      const r = spawnSync('git', ['-C', root, 'tag', name], {
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
    };
    // A non-release tag at the same commit must NOT become the version — the
    // stamp claims an identity only a vX.Y.Z tag states.
    tag('release-candidate');
    tag('v2.0.1');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const stamp = stampOf(home);
    expect(stamp['sha']).toBe(sha);
    expect(stamp['version']).toBe('v2.0.1');
    expect(r.stdout).toMatch(/^install: stamp: [0-9a-f]{40} \(fixture-branch, v2\.0\.1\)$/m);
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
    const r = runLauncherVersion(home);
    expect(r.code, r.stderr).toBe(0);
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
  // graphify Task 10 (O3/O6b): ROLE-GATED — `_inst_units` skips both on a
  // `--role server` box, unlike every other row above. The default fixture
  // install below is role `both`, so they land on the box this describe's
  // shared install measures; the server-role describe further down asserts
  // their absence explicitly.
  ['ccd-graph-sweep.service', 'deploy/systemd/ccd-graph-sweep.service'],
  ['ccd-graph-sweep.timer', 'deploy/systemd/ccd-graph-sweep.timer'],
  // ROLE-GATED on the sweep's exact terms: a server box holds no wrapper HOMEs
  // and no ~/.cc-secrets, so it has no credential to probe.
  ['ccd-account-health.service', 'deploy/systemd/ccd-account-health.service'],
  ['ccd-account-health.timer', 'deploy/systemd/ccd-account-health.timer'],
  // spec 2026-09-07 §C: ROLE-GATED the same way — `_inst_units` skips both on
  // a `--role server` box. The default fixture install is role `both`.
  ['ccd-telemetry-keepalive.service', 'deploy/systemd/ccd-telemetry-keepalive.service'],
  ['ccd-telemetry-keepalive.timer', 'deploy/systemd/ccd-telemetry-keepalive.timer'],
  // C5: ROLE-GATED on the same terms as the three pairs above — a server box
  // holds no account lanes and no `~/.ccrc/models` registries to refresh.
  // Before this fix `_inst_units` had never heard of this pair at all: the
  // only installer was `deploy/deploy.sh`'s agent lane, so `ccrc install
  // --role fleet` shipped the verbs and the probe but never armed the timer
  // that is supposed to run them hourly.
  ['ccrc-models.service', 'deploy/systemd/ccrc-models.service'],
  ['ccrc-models.timer', 'deploy/systemd/ccrc-models.timer'],
  // Plan 3a Task 6: ccrc's OWN usage pair (D-3717),
  // ROLE-GATED `!= server` like the pairs above it, Linux only. The template
  // lands on every fleet/both box. Its INSTANCES are armed per codex lane by
  // `_inst_codex_usage`, and this describe's roster has none, so none is.
  ['ccrc-codex-usage@.service', 'deploy/systemd/ccrc-codex-usage@.service'],
  ['ccrc-codex-usage@.timer', 'deploy/systemd/ccrc-codex-usage@.timer'],
  // The temp-dir reaper: ROLE-GATED on the same terms — a server box runs no
  // Claude Code sessions, so it has no /tmp/claude-<uid> to reap.
  ['ccd-tmp-sweep.service', 'deploy/systemd/ccd-tmp-sweep.service'],
  ['ccd-tmp-sweep.timer', 'deploy/systemd/ccd-tmp-sweep.timer'],
  // W4a Task 9 (design §11): the server-role watchdog's pair — ROLE-GATED the
  // OTHER way round from the pairs above: `_inst_units` places it on `server`
  // and `both` (this list's role) and never on `fleet`, whose node the
  // server's own deadline covers. The fleet describe asserts its absence.
  ['ccrc-update-watchdog.service', 'deploy/systemd/ccrc-update-watchdog.service'],
  ['ccrc-update-watchdog.timer', 'deploy/systemd/ccrc-update-watchdog.timer'],
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

describeLinux('ccrc install: the units, and the one this box must not be given', () => {
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

  // The count is DERIVED from `UNIT_FILES` itself, not hand-written: fix
  // round 1 (Finding 4) measured the title stuck at "ten" while the census
  // had grown to fourteen, the exact staleness this avoids repeating.
  //
  // Split by SUFFIX, not by position. `UNIT_FILES.length - 2` was the first
  // spelling and it is a hand-maintained constant wearing a derivation's
  // clothes: it is correct only while the two drop-ins are the last two rows,
  // so appending a unit file below them silently makes the title wrong by one
  // — the same defect, one wave later and harder to see. Every drop-in is a
  // `.conf`; no unit file is.
  const dropIns = UNIT_FILES.filter(([dest]) => dest.endsWith('.conf'));
  const unitFiles = UNIT_FILES.filter(([dest]) => !dest.endsWith('.conf'));
  it(`installs ${unitFiles.length} unit files and ${dropIns.length} drop-ins, byte for byte, at 644`, () => {
    // `deploy.sh:402-417`'s copy set, plus graphify Task 10's role-gated
    // sweep pair (the default install here is role `both`, so both land).
    // Byte equality rather than existence,
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

  itLinux('places ccrc\'s OWN usage pair on both and fleet, and still writes no ccgpt-usage@ name on any role (Plan 3a Task 6)', () => {
    // 2b-1 item 13, rewritten deliberately. Until Plan 3a no role placed a
    // usage pair at all (D-3172): its only name was another repository's live
    // template on the fleet box (final review F-1). The pair now ships as
    // `ccrc-codex-usage@` and lands on both and fleet. The foreign name is
    // still never written, and with no codex lane rostered no instance is
    // enabled, which is the live box's shape once this merges. The
    // `--role server` describe pins the third role.
    const home = freshBox('ccrc-install-codex-usage-fleet-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code, r.stderr).toBe(0);
    for (const [role, h, out] of [['both', units.home, units.r.stdout], ['fleet', home, r.stdout]] as const) {
      for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
        expect(readFileSync(unitDir(h, u)), `--role ${role}: ${u} is not the placed tree's copy`)
          .toEqual(readFileSync(placed(h, 'deploy', 'systemd', u)));
      }
      expect(readdirSync(unitDir(h)).filter((n) => n.startsWith('ccgpt-usage')),
        `--role ${role} wrote a name another repository owns on the live fleet box`).toEqual([]);
      expect(existsSync(placed(h, 'deploy', 'systemd', 'ccgpt-usage@.service')),
        'the old template name still ships in the placed tree').toBe(false);
      const argv = systemctlCalls(h).map((c) => c.argv).join('\n');
      expect(argv, `--role ${role}: a systemctl verb named another repository's unit`).not.toContain('ccgpt-usage');
      expect(argv, `--role ${role}: an instance was armed on a roster with no codex lane`).not.toContain('ccrc-codex-usage@');
      expect(out).toMatch(/^install: codex-usage: none — no codex lane in the roster$/m);
    }
  });

  itLinux('a FOREIGN ccgpt-usage@ unit pair and its enabled instance survive install --role fleet and uninstall, byte for byte', () => {
    // The live fleet box's shape (F-1), in a fixture HOME: another
    // repository's template pair at the two names, and an ENABLED instance of
    // it (the `timers.target.wants/` link `systemctl enable` makes). Every
    // fixture HOME before this case was empty there, so nothing could see an
    // install overwrite that pair or an uninstall delete it.
    const home = freshBox('ccrc-install-foreign-ccgpt-usage-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const svc = unitDir(home, 'ccgpt-usage@.service');
    const timer = unitDir(home, 'ccgpt-usage@.timer');
    const wants = unitDir(home, 'timers.target.wants', 'ccgpt-usage@x.timer');
    mkdirSync(unitDir(home, 'timers.target.wants'), { recursive: true });
    const foreignSvc = '# FOREIGN-FIXTURE-7f3a: another repository owns this template\n[Service]\nType=oneshot\nExecStart=/bin/true %i\n';
    const foreignTimer = '# FOREIGN-FIXTURE-7f3a: another repository owns this template\n[Timer]\nOnCalendar=*:0/7\n';
    writeFileSync(svc, foreignSvc, { mode: 0o644 });
    writeFileSync(timer, foreignTimer, { mode: 0o644 });
    symlinkSync(timer, wants);
    const untouched = (stage: string): void => {
      expect(read(svc), `${stage}: the foreign ccgpt-usage@.service changed`).toBe(foreignSvc);
      expect(read(timer), `${stage}: the foreign ccgpt-usage@.timer changed`).toBe(foreignTimer);
      expect(lstatSync(wants).isSymbolicLink(), `${stage}: the enabled instance's wants link is gone`).toBe(true);
      expect(readlinkSync(wants), `${stage}: the wants link was repointed`).toBe(timer);
    };
    const inst = runInstall(home, ['install', '--role', 'fleet']);
    expect(inst.code, inst.stderr).toBe(0);
    untouched('after install --role fleet');
    // Plan 3a Task 6: ccrc's OWN pair lands BESIDE the foreign one, under its
    // own name, and (below) leaves with uninstall while the foreign one stays.
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `install --role fleet did not place ccrc's own ${u} beside the foreign pair`).toBe(true);
    }
    const un = runInstall(home, ['uninstall']);
    expect(un.code, `stderr: ${un.stderr}\nstdout: ${un.stdout}`).toBe(0);
    untouched('after uninstall');
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `uninstall left ccrc's own ${u}`).toBe(false);
    }
    expect(systemctlCalls(home).map((c) => c.argv).join('\n'), 'a systemctl verb named the foreign unit')
      .not.toContain('ccgpt-usage');
  });

  it('ccrc-codex-usage@.service runs the isolated runtime\'s interpreter under -I, with the cost map local and a start bound (D-3486, Plan 3a Task 6)', () => {
    // D-3164, the half Plan 2b-2 owns: the publisher's shebang is `env
    // python3`, and on the operator's fleet box that python imports a
    // third-party litellm fork from user site-packages — a SILENT wrong
    // interpreter. The unit now names the runtime `ccgpt-runtime` builds, and
    // this case holds it there in two halves: the TEXT (one ExecStart, `-I`,
    // the cost map local, no PATH line) and the AGREEMENT — the interpreter the
    // unit names, resolved, is the one `ccgpt-runtime python` answers on a box
    // that has a runtime. Plan 3a places the pair under ccrc's own name and arms
    // one instance per codex lane (the cases above and the converge describe).
    const unit = read(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.service'));
    const code = unit.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    const execs = code.filter((l) => l.startsWith('ExecStart='));
    expect(execs, 'the unit must carry exactly one ExecStart').toHaveLength(1);
    expect(execs[0]).toBe('ExecStart=%h/.ccrc/runtime/codex/current/bin/python -I %h/.local/bin/ccgpt-usage.py');
    expect(code, 'the cost map is not local — every poll would fetch a mutable remote JSON (D-3484)')
      .toContain('Environment=LITELLM_LOCAL_MODEL_COST_MAP=True');
    expect(code).toContain('Environment=CCGPT_ACCOUNT_ID=%i');
    // Plan 3a Task 1: a oneshot has NO start timeout by default. The
    // publisher refuses a device sign-in in-process; this bounds everything
    // else a wedged refresh could hold. Task 6's rename carries the line.
    expect(code.filter((l) => l.startsWith('TimeoutStartSec=')), 'the usage poll must be bounded')
      .toEqual(['TimeoutStartSec=300']);
    expect(code.filter((l) => /^Environment=["']?PATH=/.test(l)), 'a PATH line cannot choose the interpreter (D-3164)')
      .toEqual([]);
    // A oneshot has no start timeout by default, and its timer starts no
    // second instance while one runs: a poll that hung would silence the
    // lane's usage row for good. Bounded, and inside one timer cycle. Its
    // count is Task 1's one exact pin above.
    const bound = code.filter((l) => /^TimeoutStartSec=\d+$/.test(l));
    const timer = read(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.timer'))
      .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    const cycle = timer.map((l) => /^OnUnitActiveSec=(\d+)min$/.exec(l)).find((m) => m !== null);
    expect(cycle, 'the usage timer\'s OnUnitActiveSec is not spelled in minutes — this pin has gone stale').toBeDefined();
    expect(Number(bound[0]!.slice('TimeoutStartSec='.length)), 'a poll may still be running when the next one is due')
      .toBeLessThan(Number(cycle![1]) * 60);
    // The converge, uninstall, account removal and doctor read ENABLEMENT as
    // this target's wants link (D-3726):
    // another target and every one of those readers goes blind.
    expect(timer, 'the usage timer is no longer wanted by timers.target').toContain('WantedBy=timers.target');

    // The agreement half, in a fixture HOME only. The runtime is planted by
    // `codexLaneFixture.ts`' `plantFakeRuntime`, the one planter of the
    // builder's layout in the test tree: a `gen-<UTC>-<n>` generation, a
    // RELATIVE `current` symlink, and a stamp derived from the shipped
    // `ccd/ccgpt-runtime`. So this case types no second copy of that layout.
    const home = mkTmp('ccrc-usage-unit-interp-');
    const rt = plantFakeRuntime(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccgpt-runtime'), 'python'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status, `ccgpt-runtime python: ${r.stderr}`).toBe(0);
    expect(realpathSync(r.stdout.trim()), 'ccgpt-runtime python answered an interpreter the fixture did not plant')
      .toBe(realpathSync(rt.python));
    const named = execs[0]!.slice('ExecStart='.length).split(' ')[0]!.replace(/^%h\//, `${home}/`);
    expect(realpathSync(named), 'the unit names an interpreter the runtime builder does not answer')
      .toBe(realpathSync(r.stdout.trim()));
  });

  it('the installed ccrc.service reads ccrc.env first, then exposure.env, both optional', () => {
    // Stage 3b Task 1 (spec D3): exposure keys live in their own
    // ~/.ccrc/exposure.env, written by `ccrc expose`, never by touching the
    // seed-once ccrc.env. systemd's EnvironmentFile semantics make the LATER
    // file win for a key present in both — so the order below is the whole
    // mechanism by which `expose` overrides a hand-set placeholder — and the
    // leading `-` on each is what lets a box that never ran the verb (or has
    // no env file at all) boot anyway. Asserted as the exact ordered list, so
    // a dropped `-`, a swapped order, or a third line all land here.
    const unit = read(unitDir(units.home, 'ccrc.service'));
    expect(unit.split('\n').filter((l) => l.startsWith('EnvironmentFile='))).toEqual([
      'EnvironmentFile=-%h/.ccrc/ccrc.env',
      'EnvironmentFile=-%h/.ccrc/exposure.env',
    ]);
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

  it('installs no ccd-update-sync pair on the default role — the server process writes the projection there', () => {
    // programme wave 4 (design 2026-09-20 §9): the default role is `both`,
    // and on `both` the SERVER is the writer of `~/.ccrc/update-intent`. A
    // timer here would be a second writer of one path whose binary refuses
    // every 60 seconds (no agent.env), under a timer `_check_services` reads
    // as active. The BINARY is still on PATH — graph-sweep's rule: the timer
    // is the gate, never the binary.
    const { home } = units;
    expect(existsSync(unitDir(home, 'ccd-update-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-update-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-update-sync');
    expect(existsSync(join(home, '.local', 'bin', 'ccd-update-sync')),
      'the puller binary is missing on the default role').toBe(true);
  });

  it('reloads and enables in that order, and only after every unit file landed', () => {
    // TWO ORDERINGS IN ONE ASSERTION, because they fail the same way. systemd
    // reads the directory at `daemon-reload`; a unit enabled before its drop-in
    // exists runs WITHOUT the drop-in until something reloads again, and for
    // the slice cap that is a box whose panes are uncapped while its transcript
    // says they are not. The recorded snapshot is what each call SAW.
    const { home } = units;
    // The filter keeps STATE-CHANGING calls only; `is-active`, `show` and
    // `list-units` are all reads. `list-units` joined them when `_check_scopes`
    // landed — `cmd_install` ends with `cmd_doctor`, so every read doctor makes
    // is made during an install too, and a read has no place in an assertion
    // about the order of mutations.
    const calls = systemctlCalls(home).filter((c) => !c.argv.includes('is-active')
      && !c.argv.includes('show') && !c.argv.includes('list-units'));
    expect(calls.map((c) => c.argv)).toEqual([
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      // account-pool-membership wave 1, Task 4 fix round 2 (ruling T4-R1):
      // `ccd-pool-sync.timer` is ABSENT here, and its absence is the
      // assertion. This describe's install is the default role, `both`, and
      // `both` is not `fleet` — so it gets no `~/.ccrc/agent.env`, which is
      // the one file `ccd-pool-sync` refuses without. Arming the timer here
      // would enable a oneshot that exits 1 every 60 seconds forever while
      // the TIMER (which is what `_check_services` measures) stays active, so
      // `ccrc doctor` would print PASS on a box the sync has never worked on.
      // The fleet-role describe below is where this enable is pinned present.
      // graphify Task 10 (O3/O6b): a THIRD enable, beside cap-scopes', for the
      // role-gated sweep timer — the default install here is role `both`, so
      // it fires. Degrades rather than dies on failure (`_inst_linger`'s own
      // idiom), which is why it is not folded into the `_ccrc_die`-guarded
      // loop above it.
      '--user enable --now ccd-graph-sweep.timer',
      // Routing slice 0 Task 7: another degrade-rather-than-die enable, on the
      // graph-sweep's own terms, for the usage-accounting sweep's timer.
      '--user enable --now ccd-usage-sweep.timer',
      // The temp-dir reaper's timer, on the same gate and the same
      // degrade-rather-than-die idiom as the two sweeps above it.
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-account-health.timer',
      // spec 2026-09-07 §C: a FOURTH enable, role-gated exactly as the sweep's
      // and degrading rather than dying for the same reason.
      '--user enable --now ccd-telemetry-keepalive.timer',
      // C5: a FIFTH enable, role-gated on the same terms and degrading the
      // same way — a server box has no lanes for this timer to refresh.
      '--user enable --now ccrc-models.timer',
      // W4a Task 9: the server-role watchdog's timer — `!= fleet`, so this
      // role enables it — degrading rather than dying like every timer in
      // this list, and taking no restart (a oneshot holds no code).
      '--user enable --now ccrc-update-watchdog.timer',
      // THE RESTART, in deploy's own position (deploy.sh:803-805): after both
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

  it('a systemd that will not take the watchdog timer DEGRADES the install, never fails it', () => {
    // The watchdog bounds a FUTURE update; an install that converged must not
    // be failed over it. `_inst_linger`'s idiom, and every other timer's here.
    const home = freshBox('ccrc-install-watchdog-enable-fails-');
    writeFileSync(join(home, 'fixture-enable-fail'), 'ccrc-update-watchdog.timer\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(
      /^install: update-watchdog: could not enable ccrc-update-watchdog\.timer — run: systemctl --user enable --now ccrc-update-watchdog\.timer$/m);
    expect(r.stdout, 'the closing line claims a convergence the watchdog timer never had')
      .toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bccrc-update-watchdog\.timer\b[^)]*\)$/m);
    expect(systemctlCalls(home).map((c) => c.argv)).toContain('--user restart ccrc.service');
  });

  it('the watchdog unit SKIPS on a tree with no watchdog verb: a restore or rollback onto an older release never turns it into a failed oneshot a minute', () => {
    // An arm-2 restore (Task 6) or `ccrc rollback --to` (Task 7) onto a
    // release older than W4a runs THAT release's spine, which neither knows
    // nor removes this pair. The timer stays enabled, and the launcher execs
    // whatever tree ~/ccrc holds. `ExecCondition=` rc 1-254 skips the run
    // without marking the unit failed (systemd.service(5)). Only 255 or a
    // signal counts as a failure.
    const unit = readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-update-watchdog.service'), 'utf8');
    const conds = unit.split('\n').filter((l) => l.startsWith('ExecCondition='));
    expect(conds).toEqual([`ExecCondition=/bin/sh -c 'grep -q "^cmd_watchdog()" %h/ccrc/ccd/ccrc'`]);
    // It precedes ExecStart, so it cannot be read as a second command after it.
    expect(unit.indexOf('ExecCondition=')).toBeLessThan(unit.indexOf('ExecStart='));
    const script = /^ExecCondition=\/bin\/sh -c '(.*)'$/.exec(conds[0]!)![1]!;
    const cond = (home: string): number | null =>
      spawnSync('/bin/sh', ['-c', script.replace(/%h/g, home)]).status;
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const plant = (prefix: string, body: string): string => {
      const home = mkTmp(prefix);
      mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
      writeFileSync(join(home, 'ccrc', 'ccd', 'ccrc'), body);
      return home;
    };
    // This tree has the verb: the condition passes and ExecStart runs.
    expect(cond(plant('ccrc-watchdog-cond-this-', src))).toBe(0);
    // An older tree, which is this file without the verb's definition line:
    // skipped, and not a failure.
    const old = src.split('\n').filter((l) => !l.startsWith('cmd_watchdog()')).join('\n');
    expect(old).not.toBe(src);
    const rcOld = cond(plant('ccrc-watchdog-cond-old-', old));
    expect(rcOld).toBeGreaterThanOrEqual(1);
    expect(rcOld).toBeLessThanOrEqual(254);
    // No tree at all (grep's rc 2): skipped too, never 255.
    const rcNone = cond(mkTmp('ccrc-watchdog-cond-none-'));
    expect(rcNone).toBeGreaterThanOrEqual(1);
    expect(rcNone).toBeLessThanOrEqual(254);
  });

  it('the watchdog unit PREPENDS ~/.local/bin to the PATH it inherits, never REPLACES it (D-3282)', () => {
    // `ccrc.service` (ExecStart=/usr/bin/env node …) finds `node` through the
    // user manager's PATH — systemd defaults plus every environment.d
    // fragment (e.g. /snap/bin). A bare `Environment=PATH=…` on this unit
    // would REPLACE that PATH rather than extend it, so on a box whose node
    // is reachable only through one of those fragments, the rollback this
    // unit's one real act runs (`ccrc rollback --from watchdog`, a whole
    // `ccrc update`) would die at its own node preflight — silently
    // disabling the watchdog on exactly the boxes whose layout differs from
    // the four hard-coded directories.
    const unit = readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-update-watchdog.service'), 'utf8');
    const lines = unit.split('\n');
    expect(lines.some((l) => l.startsWith('Environment=PATH='))).toBe(false);
    const execStart = lines.filter((l) => l.startsWith('ExecStart='));
    expect(execStart).toEqual([
      `ExecStart=/bin/sh -c 'PATH="%h/.local/bin:$$PATH" exec %h/.local/bin/ccrc watchdog'`,
    ]);
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

});

// PLATFORM-NEUTRAL, so it lives outside the Linux-only describe above: the
// property it pins — the two files name the SAME set of unit directories — is
// true on both platforms and is exactly what a half-finished port breaks.
// The Linux describe above measures four unit files, two drop-ins and a
// slice. macOS gets ONE job file, and the difference is not an omission —
// launchd has no template units (so there is nothing to install once for all
// sessions; `ccd` mints a plist per session), no drop-ins, and no cgroups (so
// there is no memory ceiling to install and no `ccd-cap-scopes` to run). What
// it DOES have to keep is every promise that survives translation: the job
// lands at 644, it is a valid plist, it reads the same two env files in the
// same order, and it is bootstrapped rather than merely written.
describeDarwin('ccrc install: the launchd job, and what macOS deliberately does not get', () => {
  const box = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-launchd-');
    return { home, r: runInstall(home, ['install'], {}, { umask: '077' }) };
  })();

  const plist = (): string =>
    join(box.home, 'Library', 'LaunchAgents', 'app.ccrc.ccrc.plist');

  it('the run this describe measures succeeded', () => {
    expect(box.r.code, box.r.stderr).toBe(0);
    expect(box.r.stdout).toMatch(/^install: units: /m);
  });

  it('installs exactly one job file, at 644', () => {
    expect(existsSync(plist()), 'app.ccrc.ccrc.plist never reached ~/Library/LaunchAgents')
      .toBe(true);
    expect(statSync(plist()).mode & 0o777, 'the job file has the wrong mode').toBe(0o644);
    // ONE file, not a directory of them: no template, no drop-ins, no timer.
    const dir = join(box.home, 'Library', 'LaunchAgents');
    expect(readdirSync(dir).sort()).toEqual(['app.ccrc.ccrc.plist']);
  });

  it('reads ccrc.env first, then exposure.env, both optional — systemd\'s EnvironmentFile order, kept', () => {
    // launchd cannot read an env file at all, so the job is a shell that
    // sources them. The ORDER is the mechanism by which `ccrc expose`
    // overrides a hand-set placeholder, and the `[ -f ]` guards are the `-`
    // that lets a box which never ran the verb boot anyway. Both must survive
    // the translation or the platform quietly loses a feature.
    const body = read(plist());
    const env1 = body.indexOf('/.ccrc/ccrc.env');
    const env2 = body.indexOf('/.ccrc/exposure.env');
    expect(env1, 'the job never reads ccrc.env').toBeGreaterThan(-1);
    expect(env2, 'the job never reads exposure.env').toBeGreaterThan(-1);
    expect(env1, 'exposure.env must be sourced AFTER ccrc.env — later wins')
      .toBeLessThan(env2);
    expect(body).toMatch(/\[ -f '[^']*\/\.ccrc\/ccrc\.env' \]/);
    expect(body).toMatch(/\[ -f '[^']*\/\.ccrc\/exposure\.env' \]/);
    expect(body, 'the assignments must be EXPORTED, which is what an EnvironmentFile does')
      .toContain('set -a;');
  });

  it('is a plist the system parser accepts', () => {
    // `launchctl bootstrap` answers a malformed plist with "Could not find
    // specified service" — a message about the wrong thing entirely. The
    // install lints before it places, and this is that guarantee measured
    // against the file that actually landed.
    const r = spawnSync('plutil', ['-lint', plist()], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('carries PATH explicitly — a LaunchAgent does not inherit the login shell\'s', () => {
    // The difference between a working box and a mystery: launchd hands a job
    // its own minimal PATH, which holds neither Homebrew's bash (ccd needs
    // >= 4.2 and macOS ships 3.2) nor tmux.
    expect(read(plist())).toMatch(/<key>PATH<\/key>/);
  });

  it('bootstraps the job rather than only writing it', () => {
    const calls = read(join(box.home, 'launchctl-calls'));
    expect(calls, 'nothing was ever bootstrapped').toMatch(/^bootstrap gui\//m);
    expect(box.r.stdout).toMatch(/^install: services: app\.ccrc\.ccrc bootstrapped/m);
  });

  it('installs no ccd-cap-scopes, and says why', () => {
    // It caps tmux pane CGROUP scopes. macOS has none, so the binary would be
    // a permanent no-op on PATH and the transcript would name it as though the
    // box had gained something.
    expect(existsSync(join(box.home, '.local', 'bin', 'ccd-cap-scopes')),
      'an inert cap-scopes binary was installed anyway').toBe(false);
    expect(box.r.stdout).toMatch(/no ccd-cap-scopes/);
  });

  it('states the missing memory ceiling instead of implying parity', () => {
    expect(box.r.stdout).toMatch(/no per-session or fleet-wide memory ceiling/);
  });

  it('converges cleanly — linger is not a degraded step on a platform that has none', () => {
    // A degraded step is one that was supposed to happen and did not. Counting
    // linger here would make EVERY macOS install report DEGRADED forever,
    // which trains an operator to ignore the word on the day it means
    // something. The fact is carried by `ccrc doctor` as a standing WARN.
    expect(box.r.stdout).toMatch(/^install: linger: not a macOS concept/m);
    expect(box.r.stdout).toMatch(/^install: done — every step above converged$/m);
  });
});

// The launchd FAILURE branches — the Darwin siblings of the Linux describe's
// three failure tests, minus the one macOS does not implement: there is no
// separate `restart` step in `_inst_enable_darwin` (bootout+bootstrap IS the
// reload), so "refuses when the restart itself fails" has no Darwin condition
// to test. What remains is the refusal and the stay-up gate, and both were
// shipped without a test that reaches them — the `fixture-bootstrap-fail`
// knob in the launchctl stub existed with no writer.
describeDarwin('ccrc install: the launchd failure branches — the refusal, and the stay-up gate', () => {
  it('refuses BY LABEL when launchd will not bootstrap the job — the sibling of "refuses BY UNIT when systemd will not enable one"', () => {
    const home = freshBox('ccrc-install-bootfail-');
    writeFileSync(join(home, 'fixture-bootstrap-fail'), 'yes\n');
    const r = runInstall(home);
    expect(r.code, 'a bootstrap launchd refused must FAIL the install').not.toBe(0);
    expect(r.stderr).toMatch(/launchctl bootstrap failed for app\.ccrc\.ccrc/);
    // The remedy names the command this box actually has.
    expect(r.stderr).toMatch(/launchctl print gui\//);
    expect(r.stdout, 'the install must not report the step as done')
      .not.toMatch(/^install: services: app\.ccrc\.ccrc bootstrapped/m);
  });

  it('fails the install when the bootstrapped job does not stay up — fork-time success is not a service', () => {
    // Every `launchctl print` answers a fresh pid: a crash loop as launchd
    // shows one, while `bootstrap` itself still exits 0. The doctrine above
    // `_inst_enable` binds this arm too: a box whose service will not stay
    // up is a FAILED install, not a warning.
    const home = freshBox('ccrc-install-stayup-');
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    const r = runInstall(home);
    expect(r.code, 'a job that did not stay up must FAIL the install').not.toBe(0);
    expect(r.stderr).toMatch(/did not stay up/);
    expect(r.stderr).toMatch(/launchctl print gui\//);
  });
});

// The fleet lane's Darwin half. The Linux tests above pin `ccrc-agent.service`
// byte for byte against the shipped unit; there is no shipped plist to compare
// against — `_inst_units` GENERATES one — so what is pinned here is the
// property those tests are really about: a fleet box gets the AGENT's job and
// must never be given the server's.
describeDarwin('ccrc install --role fleet: the agent job, and the one this box must not be given', () => {
  // THROUGH A PTY, like the Linux fleet tests: `--role fleet` reads the agent
  // URL and token from a terminal ON PURPOSE and refuses a pipe, because under
  // `curl … | bash` stdin is the installer script and a read there would take
  // a line of shell as this fleet's bearer token.
  let once: Promise<{ home: string; r: Result }> | null = null;
  const box = (): Promise<{ home: string; r: Result }> => (once ??= (async () => {
    const home = freshBox('ccrc-install-fleet-launchd-');
    const r = await runInstallTty(home, ['install', '--role', 'fleet'], [FLEET_URL, FLEET_TOKEN]);
    return { home, r };
  })());

  it('the run this describe measures succeeded', async () => {
    const { r } = await box();
    expect(r.code, r.stdout).toBe(0);
  });

  it('installs the AGENT job and NOT the server one', async () => {
    const { home } = await box();
    expect(readdirSync(join(home, 'Library', 'LaunchAgents')).sort())
      .toEqual(['app.ccrc.ccrc-agent.plist']);
  });

  it('bootstraps the agent, and never mentions the server job', async () => {
    const { home, r } = await box();
    const calls = read(join(home, 'launchctl-calls'));
    expect(calls).toMatch(/bootstrap /);
    expect(calls, 'the server job was named on a fleet box')
      .not.toContain('app.ccrc.ccrc.plist');
    expect(r.stdout).toMatch(/^install: services: app\.ccrc\.ccrc-agent bootstrapped/m);
  });
});

describe('ccrc install: the unit directory is spelled the same in both files', () => {
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
    //
    // TWO DIRECTORIES PER FILE SINCE macOS ARRIVED — systemd's unit directory
    // and launchd's LaunchAgents — so the property is now two pairs rather
    // than one, and this check got STRONGER rather than looser: it pins both.
    // A port that translated one file's arm and not the other's is exactly
    // the drift D-92 wrote this test for.
    const all = (re: RegExp, src: string) =>
      [...src.matchAll(re)].map((m) => m[1]!);
    const box = all(/^\s*BOX_UNIT_DIR="([^"]+)"$/gm, ccrcSrc);
    const table = all(/^\s*CCRC_UNIT_DIR="([^"]+)"$/gm, checksSrc);
    expect(box, 'ccd/ccrc declares no BOX_UNIT_DIR').not.toHaveLength(0);
    expect(table, 'ccd/ccrc-doctor-checks declares no CCRC_UNIT_DIR').not.toHaveLength(0);
    // Compared as SETS: the two files order their platform arms
    // independently, and what matters is that neither knows a directory the
    // other does not.
    expect([...box].sort()).toEqual([...table].sort());
    // …and they are the real directories, so the agreement is with the box
    // rather than only with itself. The Linux one is what this fixture really
    // found the units in.
    expect(box).toContain('$HOME/.config/systemd/user');
    expect(box).toContain('$HOME/Library/LaunchAgents');
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

  itLinux('asks logind for linger, by uid, and says so', () => {
    // Every ccd session is a `systemd --user` unit; without linger,
    // /run/user/$UID is torn down with the last login session and the whole
    // fleet goes with it. The remedy doctor prints uses the UID too, so the
    // call and the advice are one command.
    const { home, r } = converged;
    expect(loginctlCalls(home).some((c) => /^enable-linger \d+$/.test(c)),
      'nothing ever asked logind to enable linger').toBe(true);
    expect(r.stdout).toMatch(/^install: linger: enabled for uid \d+ — this box's units survive logout$/m);
  });

  itLinux('reports a linger it cannot enable and CONTINUES — doctor is what says so', () => {
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
    for (const step of ['dirs: ', 'hooks: ', 'skills: ', 'wrappers: ',
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

  // macOS's half of the same step. There is nothing to ask and nothing that
  // could fail, so the assertions are about what the transcript SAYS: the
  // operator has to learn that this box loses a guarantee a Linux fleet host
  // keeps, and they must not learn it as a degraded step (see the launchd
  // describe above for why that distinction is load-bearing).
  itDarwin('says linger is not a macOS concept, asks logind nothing, and does not degrade', () => {
    expect(converged.r.code, converged.r.stderr).toBe(0);
    expect(converged.r.stdout).toMatch(/^install: linger: not a macOS concept/m);
    // Names the guarantee that is missing, in the operator's terms.
    expect(converged.r.stdout).toMatch(/stop at logout and start again at login/);
    // And points at the standing report rather than leaving it to this one run.
    expect(converged.r.stdout).toMatch(/ccrc doctor/);
    expect(existsSync(join(converged.home, 'loginctl-calls')),
      'logind was asked something on a box that has none').toBe(false);
    expect(converged.r.stdout).toMatch(/^install: done — every step above converged$/m);
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
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: dirs: config directory in place for 5 account\(s\) named by \$HOME\/\.ccrc\/accounts\.sh$/m);
    for (const d of ['.claude', '.claude-a', '.claude-b', '.claude-gpt', '.claude-d']) {
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
      /^summary: 1 account\(s\) in .*\/\.ccrc\/accounts\.json — 0 generated, 1 upstream, 0 external, 0 codex \(upstream and external are never written\); 0 written, /m);
    expect(r.stdout).toMatch(/^install: wrappers: converged /m);
    // Nothing but the five executables `_inst_bins` installs (graphify Task 10
    // adds `ccd-graph-sweep`) and R3's one SYMLINK — no wrapper, no temp file,
    // no staged leftover — beside what the fixture itself planted.
    //
    // `graphify` is here because `_inst_graphify_engine` now converges
    // `$HOME/.local/bin/graphify` onto the pinned venv (R3, D-1346): the one
    // path a session's bare `graphify` resolves to. It is on BOTH platform
    // arms, unlike the two above it — `_inst_bins` gates `ccd-cap-scopes` on
    // cgroups and `ccd-graph-sweep` on a systemd timer, while the converge is
    // gated only on the server role, which this fixture is not.
    expect(readdirSync(join(home, '.local', 'bin'))
      .filter((b) => !FIXTURE_BINS.includes(b)).sort())
      .toEqual(process.platform === 'darwin'
        // `ccd-account-auth` is on BOTH arms — unlike cap-scopes (cgroup-bound)
        // and the three timer-bound ones, macOS is a supported box for it. The
        // GPT lane's four join it for the same reason: none is timer-bound to
        // this arm — `ccrc-codex` (the launcher every Codex wrapper execs) and
        // `ccgpt-runtime` are commands, `ccgpt-proxy.py` is the shim a tier
        // runs, `ccgpt-usage.py` is placed for hand-running. Gated `!= server`,
        // which this `both` install is not. `ccrc-codex` and `ccgpt-runtime`
        // joined in the commit that placed them, and no earlier than the
        // commits that wrote them (fix round 1, Finding 1). NEVER `ccgpt`
        // (D-3478).
        ? ['ccd', 'ccd-account-auth', 'ccrc', 'graphify', ...GPT_LANE_BINS].sort()
        // account-pool-membership wave 1, Task 4 fix round 1 (F1): `ccd-pool-sync`
        // joins the non-Darwin list on the timer-bound names' own terms. THIS
        // ASSERTION IS THE MUTATION SITE for that line in `_inst_bins`: it is
        // an exact set, so deleting the install reds here rather than leaving
        // `ccd-pool-sync.timer` enabled against a 203/EXEC. Programme wave 4:
        // `ccd-update-sync` joins on the same terms, and this set is the
        // mutation site for its line too (spec §18 "the puller is installed
        // where its timer looks").
        : ['ccd', 'ccd-account-auth', 'ccd-account-health', 'ccd-cap-scopes', 'ccd-graph-sweep',
           'ccd-pool-sync', 'ccd-telemetry-keepalive', 'ccd-tmp-sweep', 'ccd-update-sync', 'ccd-usage-sweep',
           'ccd-usage-sweep.py', 'ccrc', 'graphify', ...GPT_LANE_BINS].sort());
  });

  it('_inst_bins\' own closing line names every executable it placed', () => {
    // account-pool-membership wave 1, Task 4 fix round 2 (B6). That echo is a
    // SECOND, hand-kept census of the same set the assertion above measures,
    // and it shipped one wave behind it: `ccd-pool-sync` landed in
    // `_inst_bins` in fix round 1 and the sentence that tells the operator
    // what arrived never gained the name. Nothing could see it, because the
    // only pin on that line was `/^install: bins: /`.
    //
    // DERIVED FROM THE BIN DIRECTORY, so the next executable added is caught
    // by the same mechanism rather than by someone remembering this line —
    // `macos-platform.test.ts:184-189`'s rule under D-1250. `graphify` is
    // excluded because `_inst_graphify_engine`'s symlink into the pinned venv
    // is not one of `_inst_bins`' copies.
    //
    // Plan 2b-1 Task 2: the blanket `!b.endsWith('.py')` this line used to
    // carry is gone. A `.py` file is exempt only when a non-`.py` SIBLING
    // execs it and that sibling's own name in the echo covers it — named
    // explicitly, not by suffix, so a `.py` with no such sibling is caught
    // rather than silently waved through. Fix round 1, Finding 4: the
    // reviewer mutated this list both ways — dropping `ccd-usage-sweep.py`
    // reds, dropping `ccgpt-proxy.py` stayed GREEN, because the echo names
    // `ccgpt-proxy.py` explicitly regardless (it is not a timer-only
    // artifact), so it bound nothing and is gone. One entry survives:
    const PY_SIDECARS_COVERED_BY_SIBLING = [
      'ccd-usage-sweep.py', // engine carried by ccd-usage-sweep's own name
    ];
    // `ccgpt-usage.py` (and `ccgpt-proxy.py`, above) have NO such sibling —
    // each must be named explicitly in the echo below on its own, and so must
    // `ccgpt-runtime` and `ccrc-codex`, which are dotless and so never exempt.
    const { home, r } = converged;
    const line = r.stdout.split('\n').find((l) => l.startsWith('install: bins:'));
    expect(line, 'no `install: bins:` line in the transcript at all').toBeDefined();
    const placed = readdirSync(join(home, '.local', 'bin'))
      .filter((b) => !FIXTURE_BINS.includes(b) && b !== 'graphify'
        && !PY_SIDECARS_COVERED_BY_SIBLING.includes(b))
      .sort();
    // Fix round 1, Finding 5: the floor is the DARWIN-ARM minimum — `ccd`,
    // `ccd-account-auth`, the GPT lane's four and `ccrc`, seven since Plan 2b-2
    // placed `ccgpt-runtime` and `ccrc-codex` — the smaller of the two
    // platforms, so it holds on both. Like `gen-wrappers.test.ts`'s
    // `TOOLCHAIN_EXECUTABLES` floor, this is a RATCHET: it only ever needs to
    // rise as names are added, never fall, and a fall here means the
    // derivation lost members rather than that fewer names shipped.
    expect(placed.length, 'the bin directory listed nothing — the derivation, not the echo, is broken')
      .toBeGreaterThanOrEqual(7);
    // C-I (fix wave B, item 14): `.toContain(b)` is SUBSTRING containment on
    // `line`, one whole string — `ccd` and `ccd-usage-sweep` are each a
    // PREFIX of another name this same census carries (`ccd-account-auth`,
    // `ccd-cap-scopes`, … and `ccd-usage-sweep.py` respectively), so deleting
    // either bare name from the real echo would leave this pin GREEN as long
    // as its longer sibling still printed. PLAIN `\b` does not close this —
    // a hyphen is a NON-word character, so `\bccd\b` still matches the `ccd`
    // inside `ccd-account-auth` (the boundary fires on the hyphen itself,
    // measured). The name must not be immediately flanked by a word
    // character OR a hyphen on either side.
    for (const b of placed) {
      const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(line, `${b} is in $HOME/.local/bin and the install transcript never says it arrived`)
        .toMatch(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`));
    }
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
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    // A file at a GENERATED account's path that ccrc did not write: neither
    // ccrc-unmodified nor equivalent, so no flag this step passes can rewrite
    // it.
    writeFileSync(join(home, '.local', 'bin', 'claude-b'),
      '#!/bin/sh\n# mine, and not ccrc\'s\nexec /usr/bin/env claude "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: wrapper convergence refused — read the lines above$/m);
    // The converger's own account-level refusal is what "the lines above" means,
    // and it is still on stdout rather than re-worded into the die.
    expect(r.stdout).toMatch(/^REFUSE claude-b: /m);
    // …and it did not run doctor over a box it had just refused to finish.
    expect(r.stdout).not.toMatch(/^summary: \d+ checks/m);
  });
});

describe('ccrc install: all three skills reach every rostered account', () => {
  // ── THE ASYMMETRY THIS STEP CLOSES ──────────────────────────────────────
  // `deploy/deploy.sh agent <host>` has shipped the coordinator skill to the
  // fleet host since Build 7 and now ships the worker and reviewer skills
  // beside it — but a box that installs ITSELF got none of them, because no
  // step of this verb had ever heard of a skill. That is not a cosmetic gap:
  // all three installers exist because skills resolve per `CLAUDE_CONFIG_DIR`
  // and a session's ACCOUNT drifts on swap while its id does not, so a
  // coordinator (or a worker, or a reviewer) placed with no pinned account
  // must find its skill in EVERY rostered home. On a
  // self-installed box it found one in none of them, and the failure is silent:
  // the model simply does not have the protocol and improvises.
  //
  // Measured with the FIVE-account roster deliberately, exactly as `_inst_dirs`
  // is: the default roster's single `.claude` is created by `_inst_files`
  // anyway, so a one-dir fixture would go green against an installer that only
  // ever touched the first home.
  const skillBox = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-skills-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    return { home, r: runInstall(home) };
  })();
  const ROSTER_DIRS = ['.claude', '.claude-a', '.claude-b', '.claude-gpt', '.claude-d'];

  it('the run this describe measures succeeded, and says what it did in one line', () => {
    expect(skillBox.r.code, skillBox.r.stderr).toBe(0);
    expect(skillBox.r.stdout).toMatch(/^install: skills: /m);
  });

  it('lands ALL THREE skills in every account config dir the roster names', () => {
    const { home } = skillBox;
    for (const d of ROSTER_DIRS) {
      for (const [name, src] of [
        ['ccrc-coordinator', 'coordinator-skill'], ['ccrc-worker', 'worker-skill'],
        ['ccrc-reviewer', 'reviewer-skill'],
      ] as const) {
        const md = join(home, d, 'skills', name, 'SKILL.md');
        expect(existsSync(md), `${d}: ${name} never reached this home`).toBe(true);
        expect(readFileSync(md), `${d}: ${name} is not the shipped skill`)
          .toEqual(readFileSync(placed(home, 'ccd', src, 'SKILL.md')));
      }
      // …and the coordinator's tree arrived WHOLE, not as its first file. Its
      // own installer refuses a partial source by name, so this is the
      // assertion that says the refusal never had to fire — and the worker
      // skill points a live worker at exactly these paths, relative to its own
      // installed directory.
      const refs = join(home, d, 'skills', 'ccrc-coordinator', 'references');
      expect(readdirSync(refs).sort(), `${d}: the coordinator's references/ is incomplete`)
        .toEqual(readdirSync(join(REPO, 'ccd', 'coordinator-skill', 'references')).sort());
    }
  });

  it('stages each skill tree under ~/.cc-sessions, where the fleet deploy puts it', () => {
    // ONE PATH FOR BOTH LANES. `deploy.sh` rsyncs each tree to
    // `~/.cc-sessions/<name>` and runs the installer against that copy; this
    // verb places the same three directories at the same three paths from the
    // tree it just put at `~/ccrc`. A box therefore looks the same afterwards
    // whichever lane converged it — which is what makes the installers' own
    // `CCRC_SKILL_SRC` default correct on a self-installed box.
    const { home } = skillBox;
    for (const name of ['coordinator-skill', 'worker-skill', 'reviewer-skill']) {
      const staged = join(home, '.cc-sessions', name);
      expect(existsSync(staged), `${name} was never staged in ~/.cc-sessions`).toBe(true);
      expect(readFileSync(join(staged, 'SKILL.md')))
        .toEqual(readFileSync(placed(home, 'ccd', name, 'SKILL.md')));
    }
    expect(readdirSync(join(home, '.cc-sessions', 'coordinator-skill', 'references')).sort())
      .toEqual(readdirSync(join(REPO, 'ccd', 'coordinator-skill', 'references')).sort());
  });

  it('runs each installer against the copy it staged, never out of the tree', () => {
    // `_inst_hooks`' doctrine, applied to the two installers that arrived with
    // it: the box's OWN copy is the one that runs, because that is the copy
    // every future run and every operator reaches, and running the tree's copy
    // instead leaves the installed one untested by the very run that placed it.
    //
    // MEASURED AS TEXT, and the reason is a property of this step rather than a
    // shortcut: `_inst_tree_copy` makes the staging copy FROM the placed tree
    // in the same step, so at the moment the installer runs the two sources are
    // byte-identical and no fixture can tell them apart by outcome. The same
    // situation `_inst_stamp`'s path pin and `_inst_env`'s are in, and the same
    // answer — scan the shell, in the function's own body.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /_inst_skills\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _inst_skills').toBeTruthy();
    const lines = body![1]!.split('\n').filter((l) => l.includes('CCRC_SKILL_SRC'));
    expect(lines.length, 'no line in _inst_skills sets CCRC_SKILL_SRC at all')
      .toBeGreaterThan(0);
    for (const l of lines) {
      expect(l, 'the installer must read the copy staged under $HOME/.cc-sessions')
        .toContain('CCRC_SKILL_SRC="$HOME/.cc-sessions/');
      expect(l, 'CCRC_SKILL_SRC points back into the placed tree').not.toContain('BOX_TREE_DIR');
      expect(l, 'CCRC_SKILL_SRC points back into the placed tree').not.toContain('$tree');
    }
    // …and the SCRIPT that runs is the staged one too, by the same rule: every
    // `bash` this step invokes reaches into `$HOME/.cc-sessions`, never into
    // the tree it placed.
    const runs = body![1]!.split('\n').filter((l) => /\bbash\b/.test(l));
    expect(runs.length, '_inst_skills runs no installer at all').toBeGreaterThan(0);
    for (const l of runs) {
      expect(l, 'the installer that RUNS must be the box’s own copy')
        .toContain('bash "$HOME/.cc-sessions/install-');
    }
  });

  it('a second run rewrites neither skill — the installers converge, and so does the staging', () => {
    // Idempotence measured on the INODE, which is what the installers' own
    // `diff -r -q` check promises: a rewrite replaces the file rather than
    // leaving it. `_inst_tree_copy` owes the same on the staging side, and for
    // the same reason `_inst_atomic` does — a converger that rewrites what it
    // did not change is one an operator cannot use to see what a run did.
    const home = freshBox('ccrc-install-skills-idem-');
    expect(runInstall(home).code).toBe(0);
    const watched = [
      join(home, '.claude', 'skills', 'ccrc-coordinator', 'SKILL.md'),
      join(home, '.claude', 'skills', 'ccrc-coordinator', 'references', 'wave-lifecycle.md'),
      join(home, '.claude', 'skills', 'ccrc-worker', 'SKILL.md'),
      join(home, '.claude', 'skills', 'ccrc-reviewer', 'SKILL.md'),
      join(home, '.cc-sessions', 'coordinator-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'worker-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'reviewer-skill', 'SKILL.md'),
    ];
    const before = watched.map((p) => [statSync(p).ino, mtime(p)]);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(watched.map((p) => [statSync(p).ino, mtime(p)])).toEqual(before);
    // No backup directory either: the installers back a home up only when they
    // are about to REPLACE it, so a second run that made one is a second run
    // that rewrote a converged home.
    expect(existsSync(join(home, 'ccrc-backups')), 'a converged re-run took a backup').toBe(false);
    expect(strays(home)).toEqual([]);
  });

  it('an installer that refuses is a FAILED install, named, and doctor never runs', () => {
    // The step contract, and `_inst_hooks`' reasoning applied to skills: a box
    // whose sessions have no protocol is not a finished install, and the one
    // thing worse than failing here is reporting success over it. The die names
    // the installer, so "read its lines above" points at the refusal that
    // actually happened rather than re-wording it.
    const home = freshBox('ccrc-install-skills-refused-');
    const blocked = join(home, '.claude', 'skills');
    mkdirSync(blocked, { recursive: true });
    chmodSync(blocked, 0o500);
    try {
      const r = runInstall(home);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: install-coordinator-skill\.sh refused/m);
      // The installer's OWN sentence is what "the lines above" means, and it is
      // still there in its own words.
      expect(r.stderr).toMatch(/install-coordinator-skill: could not stage into /);
      // …and the run STOPPED: the steps after it never ran, and doctor — the
      // verb's last word — never got to report on a box this install did not
      // finish.
      expect(r.stdout).toMatch(/^install: hooks: /m);
      expect(r.stdout).not.toMatch(/^install: skills: /m);
      expect(r.stdout).not.toMatch(/^install: wrappers: /m);
      expect(r.stdout).not.toMatch(/^summary: \d+ checks/m);
    } finally {
      chmodSync(blocked, 0o700);
    }
  });
});

describe('ccrc install: the landing block, and doctor as the last word', () => {
  it("the doctor tail's tmux_skew verdict comes from the FIXTURE's tmux, never the host's (branch review)", () => {
    // Hermeticity pin: before the fixture grew its own tmux stub, the skew
    // check dialed whatever server holds this UID's real socket — the verdict
    // depended on the HOST (red on a legitimately-skewed box, a 15s stall per
    // full-verb test under a wedged one). The stub's versions are 9.9/9.9 —
    // numbers no packaged tmux prints — so this line proving 9.9 is what
    // proves the host was never asked.
    const home = freshBox('ccrc-install-doctor-hermetic-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^PASS tmux_skew: client 9\.9, running server 9\.9 — versions agree$/m);
  });

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
    // A FRESH INSTALL ENDS GREEN — operator ruling, Task 9 review (D-139).
    // `auth` joined the table in stage 3a and first shipped WARNing about the
    // box this verb deliberately leaves without a passphrase, which turned
    // every clean install yellow and taught operators to skim the colour that
    // is supposed to mean something. It PASSes now, carrying the arming
    // instructions as next-steps text, and this line is back to `0 warned`.
    // A macOS box closes green with EXACTLY ONE warn, and it is not a fault
    // this verb could have avoided: `linger` has no counterpart on a platform
    // where a LaunchAgent lives and dies with the login session. `0 failed` is
    // the part that means "this install worked", and it holds on both.
    const warned = process.platform === 'darwin' ? 1 : 0;
    expect(r.stdout).toMatch(new RegExp(
      `^summary: \\d+ checks \\(\\d+ skipped\\), \\d+ verdicts — \\d+ passed, ${warned} warned, 0 failed$`, 'm'));
    // …and the gate check really RAN and really found the box uncredentialed:
    // `0 warned` must not be reachable by the check having vanished.
    expect(r.stdout).toMatch(/^PASS auth: no passphrase file at .*nothing is gated/m);
  });

  it('writes ~/.ccrc/installed LAST, naming the stamped sha — and a spine that dies before its end leaves none', () => {
    // The completed-install record (spec §5). It cannot ride in build.json:
    // `_inst_stamp` sits mid-spine because the server restarted by
    // `_inst_enable` reads the stamp at boot, so a stamp-only signal would
    // read "installed" on a box whose skills never landed.
    const home = freshBox('ccrc-install-installed-');
    const sha = gitInit(treeRoot(home));
    const ok = runInstall(home);
    expect(ok.code, ok.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
    // Line 2 (design §5, D-3117): `unsigned` unless the
    // updater asserted it verified the bundle — a plain `ccrc install` from
    // a checkout verified nothing. Fix round 1 item 20 / review 155 C35:
    // CCRC_UPDATE_VERIFIED is honoured ONLY from `cmd_update`'s own staged
    // spine (its `CCRC_UPDATE_SPINE=$$` marker, checked by $PPID) — this
    // verb is invoked directly, with no such marker, so a hand-exported
    // CCRC_UPDATE_VERIFIED=1 must be stripped exactly like install.sh
    // already strips it, and the record still reads unsigned.
    const verified = freshBox('ccrc-install-installed-verified-');
    const vsha = gitInit(treeRoot(verified));
    expect(runInstall(verified, ['install'], { CCRC_UPDATE_VERIFIED: '1' }).code).toBe(0);
    expect(readFileSync(join(verified, '.ccrc', 'installed'), 'utf8')).toBe(`${vsha}\nunsigned\n`);

    expect(ok.stdout).toMatch(/^install: installed: [0-9a-f]{40} \(the spine completed/m);
    // Ordering: the line is printed AFTER the wrappers step's own line.
    const lines = ok.stdout.split('\n');
    expect(lines.findIndex((l) => l.startsWith('install: installed:')))
      .toBeGreaterThan(lines.findIndex((l) => l.startsWith('install: wrappers:')));

    // A fault INSIDE the spine, after the stamp: the reviewer skill's
    // installer refuses when its SKILL.md is missing, which kills
    // `_inst_skills` — the exact shape of the 2026-09-17 incident.
    const broken = freshBox('ccrc-install-installed-fault-');
    gitInit(treeRoot(broken));
    rmSync(treeFile(broken, 'ccd/reviewer-skill/SKILL.md'));
    const r = runInstall(broken);
    expect(r.code).toBe(1);
    expect(existsSync(join(broken, '.ccrc', 'build.json')), 'the stamp is written mid-spine, as designed').toBe(true);
    expect(existsSync(join(broken, '.ccrc', 'installed')), 'a spine that died must leave NO completed-install record').toBe(false);
    // AN EXPLICIT BOUND (final review F4): three whole install spines, legitimately. Measured alone
    // (one file, `-t`): 6.8 s at load average 12 (2026-09-28), 7.6 s at load 30 (the final review) —
    // a third of the 20 s default before any load spike, which is the bound that was wrong.
  }, 60_000);

  // Review fix round 1 I1: EVERY released `cmd_update` before this wave ran
  // its staged spine as `env CCRC_UPDATE_VERIFIED=1 bash "$UPD_TREE/ccd/ccrc"
  // install`, with no `CCRC_UPDATE_SPINE` at all — so the first update onto
  // this wave's build would record a genuinely verified install as
  // unsigned, fleet-wide. `_inst_legacy_verified_parent` is the transition
  // arm: it honours CCRC_UPDATE_VERIFIED=1 when this process's OWN PARENT
  // (measured, `ps -o args=`) is itself a `ccrc … update` invocation.
  // Emulated here as a FORK (not an exec), so the install process's own
  // $PPID resolves, via `ps`, to the fixture's argv — exactly the shape a
  // real legacy `cmd_update` leaves behind. The fixture is named `ccrc`
  // itself (in its own directory), so the process `ps -o args=` reports for
  // it names a word ending in `ccrc` — the shape
  // `_inst_legacy_verified_parent` matches.
  it('CCRC_UPDATE_VERIFIED is honoured when the PARENT process is a legacy `ccrc … update` (review fix round 1 I1)', () => {
    const legacy = freshBox('ccrc-install-installed-legacy-parent-');
    const legacySha = gitInit(treeRoot(legacy));
    const legacyDir = join(legacy, 'legacy-ccrc-fixture');
    mkdirSync(legacyDir, { recursive: true });
    const legacyCcrc = join(legacyDir, 'ccrc');
    writeFileSync(legacyCcrc,
      '#!/bin/sh\n'
      + `env CCRC_UPDATE_VERIFIED=1 bash '${ccrcIn(treeRoot(legacy))}' install\n`
      + 'exit $?\n', { mode: 0o755 });
    expect(runInstall(legacy, ['update'], {}, { from: legacyCcrc }).code).toBe(0);
    expect(readFileSync(join(legacy, '.ccrc', 'installed'), 'utf8')).toBe(`${legacySha}\n`);
  });

  // Pin (2): the SAME fixture, but the parent's own verb is NOT `update` —
  // the transition arm must not fire, and the record stays unsigned.
  it('CCRC_UPDATE_VERIFIED stays stripped when the parent\'s verb is NOT `update` (review fix round 1 I1)', () => {
    const legacyOther = freshBox('ccrc-install-installed-legacy-other-verb-');
    const legacyOtherSha = gitInit(treeRoot(legacyOther));
    const legacyOtherDir = join(legacyOther, 'legacy-ccrc-fixture');
    mkdirSync(legacyOtherDir, { recursive: true });
    const legacyOtherCcrc = join(legacyOtherDir, 'ccrc');
    writeFileSync(legacyOtherCcrc,
      '#!/bin/sh\n'
      + `env CCRC_UPDATE_VERIFIED=1 bash '${ccrcIn(treeRoot(legacyOther))}' install\n`
      + 'exit $?\n', { mode: 0o755 });
    expect(runInstall(legacyOther, ['rollback'], {}, { from: legacyOtherCcrc }).code).toBe(0);
    expect(readFileSync(join(legacyOther, '.ccrc', 'installed'), 'utf8')).toBe(`${legacyOtherSha}\nunsigned\n`);
  });

  // Pin (3), fix round 1 item 0 / batch A rereview N1: the tightened regex is
  // ANCHORED at the start of the parent's own argv, not a substring search —
  // a `bash -c '…'` command STRING whose TEXT happens to contain the words
  // `ccrc update` (a compound `ssh box 'ccrc update --to vX --force || ccrc
  // install'`, or a Bash-tool shell whose command text mentions both) must
  // NOT match: argv[1] there is the literal `-c`, never a path ending in
  // `ccrc`. Built by hand (not `runInstall`'s `from`, which always shapes the
  // parent as `bash <script-path> <args>`): the parent here IS the `bash -c`
  // invocation itself — the `install` child is forked (not exec'd) from
  // inside that `-c` string, so its own $PPID resolves, via `ps`, to this
  // exact `bash -c '…'` argv.
  it('CCRC_UPDATE_VERIFIED stays stripped when the parent is a `bash -c` STRING that only MENTIONS `ccrc update` (fix round 1 item 0 / batch A rereview N1)', () => {
    const home = freshBox('ccrc-install-installed-bashc-mention-');
    const sha = gitInit(treeRoot(home));
    const ccrc = ccrcIn(treeRoot(home));
    const env = ccrcEnv(home);
    replantDoctorStubs(home);
    // The trailing `exit $?` (the fixture legacy-parent tests' own idiom,
    // above) is LOAD-BEARING: without a statement after the install
    // command, bash's own tail-call exec optimisation would REPLACE this
    // `bash -c` process's image with the install process directly, so the
    // install's own $PPID would resolve to whatever spawned THIS test's
    // `bash -c` (the test runner), never to a `bash -c '...'` argv at all —
    // the mutation this pin exists to catch would then be invisible to it.
    const cmd = 'bash probe.sh; true # ccrc update --to v1\n'
      + `env CCRC_UPDATE_VERIFIED=1 bash '${ccrc}' install\n`
      + 'exit $?\n';
    const r = spawnSync(BASH, ['-c', cmd], { env, encoding: 'utf8' });
    expect(r.status, r.stderr ?? '').toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  // Pin (4), fix round 1 item 0(a) / batch B rereview N1: the regex's
  // optional leading word is narrowed to a bash/sh interpreter (basename
  // only, an optional path before it), never ANY word — a
  // `python3 <path>/ccrc update` parent is N1's own forging shape and must
  // NOT honour CCRC_UPDATE_VERIFIED. Spawned via `PYTHON3` directly (never
  // the fixture's own stub, which answers only `-m venv <path>` and exits 90
  // on anything else), against a FILE NAMED `ccrc` so its own path ends in
  // `ccrc` — the same shape the legacy-parent fixtures above use. The
  // python script does `subprocess.run` (never `os.exec*`), for the same
  // reason the `bash -c` pin's trailing `exit $?` is load-bearing: python3
  // must stay the running parent throughout, so the install child's own
  // $PPID resolves, via `ps`, to this exact `python3 <path>/ccrc update`
  // argv.
  it('CCRC_UPDATE_VERIFIED stays stripped when the parent is `python3 <path>/ccrc update`, not a bash/sh interpreter (fix round 1 item 0 / batch B rereview N1)', () => {
    const home = freshBox('ccrc-install-installed-python-parent-');
    const sha = gitInit(treeRoot(home));
    const ccrc = ccrcIn(treeRoot(home));
    const pyDir = join(home, 'legacy-ccrc-fixture-py');
    mkdirSync(pyDir, { recursive: true });
    const pyCcrc = join(pyDir, 'ccrc');
    writeFileSync(pyCcrc,
      'import os, subprocess, sys\n'
      + 'env = dict(os.environ)\n'
      + "env['CCRC_UPDATE_VERIFIED'] = '1'\n"
      + `r = subprocess.run(['${BASH}', ${JSON.stringify(ccrc)}, 'install'], env=env)\n`
      + 'sys.exit(r.returncode)\n');
    const env = ccrcEnv(home);
    replantDoctorStubs(home);
    const r = spawnSync(PYTHON3, [pyCcrc, 'update'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr ?? '').toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('says, in one line, that it wrote no passphrase and what arming the gate takes', () => {
    // Three variables in one sentence, because `CCRC_AUTH=on` alone produces a
    // console that can read and cannot act: the same unvalidated `CCRC_ORIGIN`
    // gates every /ws/* upgrade and every non-exempt write, and the server
    // cannot warn about a wrong one at boot (behind `tailscale serve` it never
    // learns the hostname it is reached under). An operator working from this
    // transcript is the one who needs to be told all three at once.
    const home = freshBox('ccrc-install-gate-line-');
    const r = runInstall(home);
    const line = r.stdout.split('\n').find((l) => l.startsWith('install: gate: ')) ?? '';
    expect(line, r.stdout).toContain('NO PWA passphrase');
    expect(line).toContain('ccrc passwd');
    expect(line).toContain('CCRC_AUTH=on');
    expect(line).toContain('CCRC_RP_ID');
    expect(line).toContain('CCRC_ORIGIN');
    // …and the install really did not write one. A passphrase this run invented
    // would be a credential nobody chose, and one it PROMPTED for cannot be
    // read at all under `curl … | bash`, where stdin is the script itself.
    expect(existsSync(join(home, '.ccrc', 'auth.scrypt'))).toBe(false);
  });

  // ── wave 8 item G, D-3598: the gate line follows the FILE too ────────────
  // A fresh install cannot say "no passphrase" honestly on a box that already
  // has one — a re-run over an already-passworded, already-exposed box lands
  // here too. The file is resolved through `_box_auth_path`, the flag through
  // `_box_unit_env`. With a passphrase file, an exposure file that cannot be
  // read prints "not measured"; otherwise a measured CCRC_AUTH=on, from
  // either file with the later one winning, names the file that decides, and
  // so does the OFF remedy — it names ccrc.env by default, or the exposure
  // file when that is the one that would arm it. With no passphrase file, a
  // measured CCRC_AUTH=on names the file that decides too. Wave 9 R10b
  // (D-3829) corrects the rest of this block: there, an exposure file that
  // cannot be read prints its own "not measured" line (G2g), and an exposure
  // file that decides the flag without turning it on gets an arming remedy
  // naming that file (G2h); every other case (the flag read from ccrc.env, or
  // no file at all) prints main's else-arm line, naming ccrc.env.
  const gateLine = (out: string): string => out.split('\n').find((l) => l.startsWith('install: gate: ')) ?? '';

  it('G2b: a passphrase file at the default path with the flag OFF — "a PWA passphrase file is at", and the OFF remedy names ccrc.env', () => {
    const home = freshBox('ccrc-install-gate-file-off-');
    preexisting(home, 'auth.scrypt', 'fixture-not-a-real-secret\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toContain('a PWA passphrase file is at');
    expect(line).toContain(join(home, '.ccrc', 'auth.scrypt'));
    expect(line).toContain('the gate is OFF');
    expect(line).toContain(join(home, '.ccrc', 'ccrc.env'));
    expect(line).not.toContain('NO PWA passphrase');
  });

  it('G2c: an absolute CCRC_AUTH_SECRET_PATH, with the file present there and absent at the default — the present arm, naming the redirected path', () => {
    const home = freshBox('ccrc-install-gate-redirect-');
    const elsewhere = join(home, 'secrets', 'gate.scrypt');
    mkdirSync(join(home, 'secrets'), { recursive: true });
    writeFileSync(elsewhere, 'fixture-not-a-real-secret\n');
    preexisting(home, 'ccrc.env', `CCRC_AUTH_SECRET_PATH=${elsewhere}\n`);
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toContain('a PWA passphrase file is at');
    expect(line).toContain(elsewhere);
    expect(line).not.toContain(join(home, '.ccrc', 'auth.scrypt'));
  });

  it('G2d: a RELATIVE CCRC_AUTH_SECRET_PATH — install cannot say whether this box has a passphrase', () => {
    const home = freshBox('ccrc-install-gate-relative-');
    preexisting(home, 'ccrc.env', 'CCRC_AUTH_SECRET_PATH=secrets/gate.scrypt\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(/RELATIVE \(secrets\/gate\.scrypt\)/);
    expect(line).toContain('make it absolute');
    expect(line).toContain("ccrc doctor's auth check");
  });

  it('G2e: a passphrase present and the exposure file CCRC_AUTH=on — names the file that decided it, and never says "armed"', () => {
    const home = freshBox('ccrc-install-gate-exp-on-');
    preexisting(home, 'auth.scrypt', 'fixture-not-a-real-secret\n');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    // Anchored at the START — the OFF branch's own remedy text ALSO contains
    // the substring "CCRC_AUTH=on in <exposure file>" (its arming words), so
    // an unanchored `.toContain` cannot tell the ARMED line from the OFF
    // line's own next-steps text.
    expect(line, r.stdout).toMatch(
      new RegExp(`^install: gate: CCRC_AUTH=on in ${join(home, '.ccrc', 'exposure.env').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, and a PWA passphrase file is at `));
    expect(line).not.toContain('the gate is OFF');
    expect(line).not.toContain('armed');
  });

  it('G2f: no passphrase file and the exposure file CCRC_AUTH=on — failing SHUT, no "To arm the gate"', () => {
    const home = freshBox('ccrc-install-gate-exp-shut-');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toContain('the gate is failing SHUT');
    expect(line).toContain(`CCRC_AUTH=on in ${join(home, '.ccrc', 'exposure.env')}`);
    expect(line).not.toContain('To arm the gate');
  });

  // ── wave 9 R10b (D-3829): the no-passphrase arm's two own lines ──────────
  // D-3598 kept the no-passphrase line byte-identical in every case but a measured `on`. Two cases now print their
  // own: the exposure file there and unreadable (rc 2) — "not measured", as the present-passphrase arm says — and
  // the exposure file deciding the flag (`BUE_SRC` is the exposure file), whose arming remedy names that file, as
  // that arm's `gate_how` already does. The fresh-box line (the pin above) is byte-identical in every other case.
  it.skipIf(IS_DARWIN || process.getuid?.() === 0)('G2g: no passphrase and an UNREADABLE exposure file — "not measured", naming the file, never the fresh-box arming line (wave 9 R10b)', () => {
    const home = freshBox('ccrc-install-gate-nopass-exp-unreadable-');
    const exposure = join(home, '.ccrc', 'exposure.env');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n');
    chmodSync(exposure, 0o000);
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toBe(
      `install: gate: this box has NO PWA passphrase, and ${exposure} is there and cannot be read, so whether CCRC_AUTH is on (and the gate failing shut) was not measured — ccrc doctor's auth check says what to do`);
    expect(line).not.toContain('To arm the gate');
  });

  it('G2h: no passphrase and the exposure file CCRC_AUTH=off — the arming remedy names the exposure file, which overrides ccrc.env, not ccrc.env alone (wave 9 R10b)', () => {
    const home = freshBox('ccrc-install-gate-nopass-exp-off-');
    const exposure = join(home, '.ccrc', 'exposure.env');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=off\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(new RegExp(
      `^install: gate: this box has NO PWA passphrase — install never writes one\\. To arm the gate: ccrc passwd, then set CCRC_AUTH=on in ${
        exposure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, which overrides ${
        join(home, '.ccrc', 'ccrc.env').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(ccrc expose writes it with CCRC_RP_ID and CCRC_ORIGIN\\), then: .+$`));
    expect(line).not.toContain('together with CCRC_RP_ID and CCRC_ORIGIN in');
    expect(line).not.toContain('not measured');
  });

  // ── wave 9 R10e (D-3823): a SECOND unmeasured state, rc 3 ─────────────────
  // A readable env file names the flag in a shape the reader cannot decide (on macOS: either file is not plain
  // assignments). The line says so from `_box_unit_env`'s own `BUE_WHY`, in both arms; it never borrows the rc-2
  // sentence ("is there and cannot be read"), which is about an exposure file the reader cannot open.
  /** The platform's own clause of a not-measured verdict about `file` (ccrc-doctor.test.ts's `expectUndecided`). */
  const expectUndecided = (detail: string, file: string): void => {
    expect(detail).toContain(file);
    expect(detail).toContain('was not measured');
    expect(detail).not.toContain('cannot be read');
    if (IS_DARWIN) expect(detail).toContain(`${file} line `);
    else expect(detail).toContain('in a shape this reader does not decide');
  };

  it('I1: a passphrase present and the exposure file `CCRC_AUTH = on` — "not measured", worded from the reader\'s own cause, never as an unreadable file', () => {
    const home = freshBox('ccrc-install-gate-exp-spaced-');
    preexisting(home, 'auth.scrypt', 'fixture-not-a-real-secret\n');
    const exposure = join(home, '.ccrc', 'exposure.env');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH = on\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(new RegExp(
      `^install: gate: a PWA passphrase file is at .*auth\\.scrypt, and ${exposure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(line).toContain('so whether CCRC_AUTH is on was not measured');
    expectUndecided(line, exposure);
  });

  it('I2: no passphrase and ccrc.env `CCRC_AUTH = on` — the rc-3 line naming ccrc.env, not the fresh-box line', () => {
    const home = freshBox('ccrc-install-gate-env-spaced-');
    preexisting(home, 'ccrc.env', 'CCRC_FLEET=local\nCCRC_AUTH = on\n');
    const envFile = join(home, '.ccrc', 'ccrc.env');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(new RegExp(
      `^install: gate: this box has NO PWA passphrase, and ${envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(line).toContain('so whether CCRC_AUTH is on was not measured');
    expectUndecided(line, envFile);
    expect(line).not.toContain('install never writes one');
  });

  it('reads the PWA address back out of the env file it installed', () => {
    // ONE SOURCE OF TRUTH, and the case that makes it matter: an operator whose
    // `ccrc.env` says something other than the default. That file is
    // user-owned, so a re-run keeps it — and a landing block that printed
    // `127.0.0.1:7788` regardless would be telling that operator to open an
    // address their box does not listen on.
    const home = freshBox('ccrc-install-addr-');
    // `localhost`, not a routable name: both differ from the default this
    // line would print if it ignored the file, and only a LOOPBACK one keeps
    // doctor's `update-exposure` check (W4, design 2026-09-20 §12) from
    // FAILing a box whose gate this run deliberately left off.
    preexisting(home, 'ccrc.env', 'CCRC_FLEET=local\nCCRC_HOST=localhost\nCCRC_PORT=8123\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: PWA: http:\/\/localhost:8123\/ \(CCRC_HOST\/CCRC_PORT in .*\/\.ccrc\/ccrc\.env change this\)$/m);
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
    // THE LEVER IS PLATFORM-SPECIFIC, THE CONTRACT IS NOT. Linger is how a
    // Linux box is made to fail doctor; on macOS linger is a standing WARN by
    // construction and can never be a FAIL. The first cut's Darwin lever was
    // a downed service (`fixture-unit-…` = inactive) — which stopped being a
    // doctor-only lever the day `_inst_enable_darwin` gained its stay-up
    // gate: ONE launchctl stub serves the install spine and the doctor tail
    // alike, so a job that reads down fails the INSTALL at step 10 and
    // doctor never runs (measured on the macos leg, twice — the second time
    // because the fix script asserted this block existed and forgot to
    // replace it). The lever is now a world-readable exposure.env: doctor's
    // exposure check FAILs on the mode, and no install step ever reads it.
    const failing = process.platform === 'darwin' ? 'exposure' : 'linger';
    if (failing === 'exposure') {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'exposure.env'),
        'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n',
        { mode: 0o644 });
    } else {
      writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    }
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^FAIL ${failing}: `, 'm'));
    for (const step of ['roster', 'accounts\\.sh', 'ccrc\\.env', 'tree', 'bins', 'files',
      'stamp', 'units', 'services', 'linger', 'dirs', 'hooks', 'skills', 'wrappers']) {
      expect(r.stdout, `no "install: ${step}:" line survived the failing doctor`)
        .toMatch(new RegExp(`^install: ${step}: `, 'm'));
    }
    // …and the closing line MEASURES rather than claims: this run had a step
    // that neither converged nor died, and says so. "every step above
    // converged" here would be a false sentence four lines under the step that
    // reported it could not (fix round 1, Minor 1).
    // The closing line MEASURES this run. On Linux the fixture's refused
    // linger is a degraded step and the line counts it; on macOS linger is not
    // a step that can degrade — there is nothing to enable — so a correct run
    // closes clean even though doctor went on to fail on something else.
    // Which is the point of the two halves being separate sentences.
    expect(r.stdout).toMatch(process.platform === 'darwin'
      ? /^install: done — every step above converged$/m
      : /^install: done — converged with 1 degraded step \(linger\)$/m);
    // The NEGATIVE half belongs to the Linux case only: there, claiming
    // "every step converged" four lines under a step that said it could not
    // would be the false sentence this assertion was written to catch. On
    // macOS that sentence is the TRUE one, because no step degraded.
    if (process.platform !== 'darwin') {
      expect(r.stdout).not.toMatch(/^install: done — every step above converged$/m);
    }
  });

  it('a fresh VM with no Claude Code installed is told to install it, not to edit its roster (A2-NEW)', () => {
    // The e2e the 2d fixtures hid: `freshBox` always planted the fake upstream
    // binary, so no test in this file ever ran the FULL `ccrc install`
    // transcript against the box a real fresh VM actually is — `bash
    // install.sh` seeded the default roster (one `upstream` account,
    // `claude`), Claude Code was never installed, and the closing `ccrc
    // doctor` is the FIRST thing that measures the gap. The first sentence a
    // fresh operator reads has to be actionable.
    const home = freshBoxNoUpstream('ccrc-install-no-claude-');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude has no executable at \$HOME\/\.local\/bin\/claude/);
    // MEASURED RED (before A2-NEW): this remedy read "the roster is the
    // source of truth … 'ccrc adopt --out /tmp/accounts.json'" — the
    // roster-sync remedy, which cannot fix an absent binary and sends a
    // fresh-VM operator looking at the wrong file.
    expect(lines[i + 1]).toMatch(/install Claude Code/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    // …and every install step above still converged clean — `_inst_wrappers`
    // only writes GENERATED accounts, the default roster has none, so there
    // is nothing for that step to degrade on. This is doctor's OWN verdict,
    // run as the verb's last word, over an install that otherwise finished:
    // the FIRST sentence a fresh operator reads is actionable precisely
    // because it is not buried under an unrelated step failure.
    expect(r.stdout).toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).not.toMatch(/degraded/);
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
      // `ccd-cap-scopes` caps tmux pane CGROUP scopes, so `_inst_bins` does not
      // place it on macOS — a binary that could only ever be a no-op there.
      // Listing it unconditionally would make this test stat a file the verb
      // was right not to install.
      // graphify Task 10: the sweep rides the same darwin carve-out — its
      // systemd timer never installs there, and the script needs GNU stat/date
      // and flock(1), which macOS does not ship.
      ...(process.platform === 'darwin'
        ? [] : [join(home, '.local', 'bin', 'ccd-cap-scopes'),
                join(home, '.local', 'bin', 'ccd-graph-sweep')]),
      // NOT in the spread above: this one is on both arms.
      join(home, '.local', 'bin', 'ccd-account-auth'),
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
      join(home, '.cc-sessions', 'install-worker-skill.sh'),
      join(home, '.cc-sessions', 'install-reviewer-skill.sh'),
      // graphify Task 3: staged beside them, through the same `_inst_atomic`.
      join(home, '.cc-sessions', 'install-graphify-skill.sh'),
      // …and the three staged skill TREES, which are not `_inst_atomic`
      // destinations at all: `_inst_tree_copy` converges a directory, and the
      // file inside it is what a re-run must not rewrite (worker-skill Task 4,
      // reviewer-skill Task 10).
      join(home, '.cc-sessions', 'coordinator-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'worker-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'reviewer-skill', 'SKILL.md'),
      join(home, '.tmux.conf'),
      join(home, '.claude', 'statusline-command.sh'),
      // THE JOB FILES THIS PLATFORM ACTUALLY HAS. `UNIT_FILES` is systemd's
      // set — four units and two drop-ins — and none of it exists on macOS,
      // where `_inst_units` writes exactly one plist and launchd has neither
      // templates nor drop-ins.
      ...(process.platform === 'darwin'
        ? [join(home, 'Library', 'LaunchAgents', 'app.ccrc.ccrc.plist')]
        : UNIT_FILES.map(([dest]) => unitDir(home, ...dest.split('/')))),
    ];
    const before = targets.map(mtime);
    const jsonBefore = read(join(home, '.ccrc', 'accounts.json'));
    const envBefore = read(join(home, '.ccrc', 'ccrc.env'));
    const settingsBefore = read(join(home, '.claude', 'settings.json'));
    const stampBefore = read(join(home, '.ccrc', 'build.json'));
    const stampMtimeBefore = mtime(join(home, '.ccrc', 'build.json'));
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
    //    MEASURED BY MTIME, not by content, and the difference is a real flake
    //    this assertion had: `builtAt` is `date -u +%Y-%m-%dT%H:%M:%SZ`
    //    (ccrc:2381) — SECOND resolution — while `sha`, `ref` and `dirty` are
    //    identical across two runs of one checkout. Two installs completing
    //    inside the same wall-clock second therefore produce a byte-identical
    //    stamp, and a content comparison calls that a failure to rewrite. It is
    //    not: mtime is the measurement this test already trusts for every other
    //    target three lines up, and "was rewritten" is what assertion 4 means.
    //    The content check that survives is the one that is time-independent:
    //    the stamp still describes THIS checkout, so a stale or absent rewrite
    //    is still caught by the sha.
    const stampAfter = read(join(home, '.ccrc', 'build.json'));
    expect(mtime(join(home, '.ccrc', 'build.json'))).not.toBe(stampMtimeBefore);
    expect(JSON.parse(stampAfter).sha).toBe(JSON.parse(stampBefore).sha);
    expect(String(JSON.parse(stampAfter).sha)).toMatch(/^[0-9a-f]{40}$/);
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

// ── Stage 4 Task 5: `--role server|fleet|both` — D-73 closes ──────────────
// A fleet box (the one that runs `ccrc-agent` and the sessions, but no server)
// had NO installer path: `_inst_units` refused `ccrc-agent.service` outright
// because its REQUIRED `EnvironmentFile=%h/.ccrc/agent.env` had no writer. The
// role gate replaces that blanket refusal: `--role fleet` writes `agent.env`
// (tty prompts, 0600, seed-once) and installs/enables the AGENT unit instead
// of `ccrc.service`; `--role both` (the default) is byte-identical to today;
// `--role server` is today's spine minus nothing.

/** The two values the fleet prompts are answered with. The token is the
 *  fixture's own — a value the transcript must NEVER contain. */
const FLEET_URL = 'ws://203.0.113.7:7788';
const FLEET_TOKEN = 'fixture-agent-token-8b1f2c4d';

/** `ccrc install --role fleet` on a REAL terminal — `ccrc-passwd.test.ts`'s
 *  pty idiom, for the same reason: `_inst_agent_env` is `[ -t 0 ]` plus a
 *  `read -rs`, so without a terminal the only reachable branch is the refusal.
 *  Entries are typed when their prompts appear (the URL prompt echoes; the
 *  token prompt must not). A pty merges the two streams into `stdout`. */
function runInstallTty(home: string, args: string[], entries: string[]): Promise<Result> {
  // `runInstall`'s order, which is load-bearing: `ccrcEnv` re-plants the
  // poisons (gh, curl) on every call, so the doctor stubs must land AFTER it
  // or the doctor tail measures a poisoned box.
  const raw = ccrcEnv(home);
  replantDoctorStubs(home);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) env[k] = v;
  // Fix round 2 (N5): on the final env, before the pty spawn below — this
  // runner has no `omit`/PATH-override path, so the full strict check applies.
  assertSpineFrontContained(env, home);
  assertNoRealTool(env, home);
  return new Promise((resolve) => {
    const p = pty.spawn(BASH, [ccrcIn(treeRoot(home)), ...args], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: home, env,
    });
    let out = '';
    let sent = 0;
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: '' });
    };
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 19_000);
    p.onData((d) => {
      out += d;
      // One entry per prompt SEEN, so a run that refuses before the second
      // prompt is typed one entry and no more.
      const prompts = (out.match(/(Server WS URL|Agent token)/g) ?? []).length;
      while (sent < prompts && sent < entries.length) p.write(`${entries[sent++]}\r`);
    });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

describe('ccrc install --role: the fleet lane (Stage 4, Task 5)', () => {
  /** One fleet install on a pty, shared by the read-only assertions. The
   *  re-run test at the bottom runs against the same box, LAST, so nothing
   *  here reads state it rewrote.
   *
   *  LAZY, not a module-scope IIFE, and the difference is the pty's own 19s
   *  guard: the earlier describes run whole installs through `spawnSync` AT
   *  MODULE SCOPE, which blocks the event loop for the better part of a
   *  minute — an eagerly-started pty child would sit unanswered (its onData
   *  never runs) until the guard fires the moment the loop unblocks. First
   *  `await` starts the run, inside a test, where the loop is free. */
  let fleetRun: Promise<{ home: string; r: Result }> | undefined;
  const fleet = (): Promise<{ home: string; r: Result }> => (fleetRun ??= (async () => {
    const home = freshBox('ccrc-install-role-fleet-');
    const r = await runInstallTty(home, ['install', '--role', 'fleet'], [FLEET_URL, FLEET_TOKEN]);
    return { home, r };
  })());

  it('the run this describe measures succeeded, ending with doctor at exit 0', async () => {
    const { r } = await fleet();
    expect(r.code, r.stdout).toBe(0);
  });

  it('writes ~/.ccrc/agent.env at 0600 with both keys SET', async () => {
    const { home } = await fleet();
    const p = dotCcrc(home, 'agent.env');
    expect(existsSync(p)).toBe(true);
    // 0600 under the ambient umask 022, where a plain redirect produces 0644 —
    // so the mode can only come from the step's own chmod, and this file holds
    // the bearer token the whole agent surface authenticates by.
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const env = read(p);
    expect(env).toMatch(new RegExp(`^CCRC_AGENT_TOKEN=${FLEET_TOKEN}$`, 'm'));
    expect(env).toMatch(/^CCRC_SERVER_URL=ws:\/\/203\.0\.113\.7:7788$/m);
  });

  it('never echoes the token — its only destination is the 0600 file', async () => {
    // The pty transcript is everything a shoulder-surfer (or a pasted terminal
    // log) sees: the URL is typed at an echoing prompt and may appear, the
    // token was read with -s and must not — not as an echo, not in the step's
    // result line, not in doctor's tail.
    const { r } = await fleet();
    expect(r.stdout).not.toContain(FLEET_TOKEN);
    expect(r.stdout).toContain('install: agent.env: written');
  });

  it('records the role in ccrc.env\'s first write', async () => {
    const { home } = await fleet();
    expect(read(dotCcrc(home, 'ccrc.env'))).toMatch(/^CCRC_ROLE=fleet$/m);
  });

  it('places the four GPT-lane executables, and the closing line names them — the role a lane runs under', async () => {
    // Final review F-2 (spec §11): `_inst_bins` gates them `!= server`, on
    // both platform arms, so a fleet box gets all four. The server-role case
    // in the next describe pins the other side of that gate.
    const { home, r } = await fleet();
    for (const name of GPT_LANE_BINS) {
      const bin = join(home, '.local', 'bin', name);
      expect(existsSync(bin), `--role fleet did not place ${name}`).toBe(true);
      expect(readFileSync(bin), `${name} is not the placed tree's copy`).toEqual(readFileSync(placed(home, 'ccd', name)));
      expect(statSync(bin).mode & 0o777, `${name} mode`).toBe(0o755);
    }
    expect(r.stdout).toMatch(new RegExp(`^install: bins: .*${LANE_BINS_IN_LINE}`, 'm'));
  });

  itLinux('installs ccrc-agent.service — byte for byte — and NOT ccrc.service', async () => {
    const { home } = await fleet();
    const agent = unitDir(home, 'ccrc-agent.service');
    expect(existsSync(agent)).toBe(true);
    expect(readFileSync(agent)).toEqual(readFileSync(placed(home, 'deploy', 'ccrc-agent.service')));
    expect(statSync(agent).mode & 0o777).toBe(0o644);
    expect(existsSync(unitDir(home, 'ccrc.service'))).toBe(false);
    // …while the four role-independent units and drop-ins still land.
    for (const [dest] of UNIT_FILES) {
      // W4a Task 9: the watchdog pair is `!= fleet` — asserted ABSENT below.
      if (dest === 'ccrc.service' || dest.startsWith('ccrc-update-watchdog.')) continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    // Ruling T4-R1: the pool-sync pair lands HERE AND ONLY HERE. It is not in
    // `UNIT_FILES` — that list is what a role-`both` install places, and this
    // pair deliberately is not — so it takes its own two lines. This is the
    // role that gets `~/.ccrc/agent.env` (asserted three tests up), which is
    // the only precondition under which `ccd-pool-sync` can ever exit 0.
    expect(existsSync(unitDir(home, 'ccd-pool-sync.service'))).toBe(true);
    expect(existsSync(unitDir(home, 'ccd-pool-sync.timer'))).toBe(true);
    // programme wave 4 (design 2026-09-20 §9): the update-intent puller's
    // pair lands on this role and ONLY this one — the pool-sync pair's own
    // precondition (the agent.env this role's install wrote) and its own
    // gate. Byte for byte from the PLACED tree, at 644.
    for (const u of ['ccd-update-sync.service', 'ccd-update-sync.timer']) {
      const p = unitDir(home, u);
      expect(existsSync(p), `${u} never reached ~/.config/systemd/user on the fleet role`).toBe(true);
      expect(readFileSync(p), `${u} is not the shipped file`)
        .toEqual(readFileSync(placed(home, 'deploy', 'systemd', u)));
      expect(statSync(p).mode & 0o777, `${u} has the wrong mode`).toBe(0o644);
    }
    // W4a Task 9: the watchdog pair lands on every role BUT this one — a
    // fleet node runs no server, and the server's own deadline covers it.
    expect(existsSync(unitDir(home, 'ccrc-update-watchdog.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-update-watchdog.timer'))).toBe(false);
  });

  itLinux('enables and restarts the AGENT unit, and never asks systemd about ccrc.service', async () => {
    const { home, r } = await fleet();
    const argv = systemctlCalls(home).map((c) => c.argv);
    expect(argv).toContain('--user enable --now ccrc-agent.service');
    expect(argv).toContain('--user enable --now ccd-cap-scopes.timer');
    // graphify Task 10 (O3/O6b): fleet is not server, so the sweep timer
    // enables here too.
    expect(argv).toContain('--user enable --now ccd-graph-sweep.timer');
    // C5: fleet is not server, so the models timer enables here too.
    expect(argv).toContain('--user enable --now ccrc-models.timer');
    // Fleet is the role that runs sessions, so the temp-dir reaper arms here.
    expect(argv).toContain('--user enable --now ccd-tmp-sweep.timer');
    // Ruling T4-R1: and the pool-sync timer, which enables on THIS ROLE ONLY
    // — the role whose install wrote the `~/.ccrc/agent.env` the binary
    // refuses without. `--role both` and `--role server` below assert the
    // matching absence, so the pair of claims cannot both be satisfied by a
    // gate that is simply always true or always false.
    expect(argv).toContain('--user enable --now ccd-pool-sync.timer');
    // programme wave 4: the update-intent puller's timer, on the same gate.
    expect(argv).toContain('--user enable --now ccd-update-sync.timer');
    expect(argv.indexOf('--user enable --now ccd-update-sync.timer'),
      'the puller timer was enabled before daemon-reload read its unit file')
      .toBeGreaterThan(argv.indexOf('--user daemon-reload'));
    expect(argv).toContain('--user restart ccrc-agent.service');
    // The blanket half of the old refusal, inverted: on a fleet box it is
    // ccrc.service that must never be touched — there is no server here.
    expect(argv.join('\n')).not.toMatch(/\bccrc\.service\b/);
    expect(argv.join('\n')).not.toContain('ccrc-update-watchdog');
    expect(r.stdout).toContain(
      'install: services: ccrc-agent.service and ccd-cap-scopes.timer enabled, and ccrc-agent.service restarted onto the tree this run placed');
  });

  it('skips the server-only landing lines — no PWA address, no passphrase gate', async () => {
    const { r } = await fleet();
    expect(r.stdout).not.toContain('install: PWA:');
    expect(r.stdout).not.toContain('install: gate:');
  });

  it('a re-run needs no terminal and keeps agent.env byte for byte (seed-once)', async () => {
    // LAST in this describe, because it re-runs the verb against the shared
    // box. Piped stdin on purpose: the file exists, so the tty gate must not
    // even be reached — which is what makes `ccrc update`'s non-interactive
    // re-run of this spine possible on a converged fleet box.
    const { home } = await fleet();
    const p = dotCcrc(home, 'agent.env');
    const before = read(p);
    const mtimeBefore = mtime(p);
    const r2 = runInstall(home, ['install', '--role', 'fleet']);
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.stdout).toMatch(/^install: agent\.env: kept \(user-owned, never overwritten\)$/m);
    expect(read(p)).toBe(before);
    expect(mtime(p)).toBe(mtimeBefore);
  });
});

describe('ccrc install --role: the refusals and the default', () => {
  it('with no terminal on a fresh box, --role fleet refuses before prompting and writes no agent.env', () => {
    // `cmd_passwd`'s refusal, for the same hazard: under `curl … | bash` stdin
    // is the INSTALLER SCRIPT, so a read here would take a line of shell as
    // the fleet's bearer token.
    const home = freshBox('ccrc-install-role-piped-');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/stdin is not a terminal/);
    expect(existsSync(dotCcrc(home, 'agent.env'))).toBe(false);
    // …and the run stopped there: no unit landed, no systemd call was made.
    expect(r.stdout).not.toMatch(/^install: units:/m);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });

  itLinux('--role both is byte-identical to a plain install — same units, same calls, no agent.env', () => {
    const home = freshBox('ccrc-install-role-both-');
    const r = runInstall(home, ['install', '--role', 'both']);
    expect(r.code, r.stderr).toBe(0);
    for (const [dest] of UNIT_FILES) {
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccrc-agent.service'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'agent.env'))).toBe(false);
    // Ruling T4-R1, the unit-file half: `_inst_units` gates the pool-sync
    // pair on `fleet` too, so a `both` box is never given a unit file for the
    // timer it is not supposed to arm.
    expect(existsSync(unitDir(home, 'ccd-pool-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-pool-sync.timer'))).toBe(false);
    // programme wave 4: the update-intent puller's pair is gated on `fleet`
    // exactly as the pool-sync pair is — `both` gets no agent.env, and on
    // `both` the server process writes the projection itself.
    expect(existsSync(unitDir(home, 'ccd-update-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-update-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-update-sync');
    expect(read(dotCcrc(home, 'ccrc.env'))).toMatch(/^CCRC_ROLE=both$/m);
    const calls = systemctlCalls(home)
      // Reads dropped, mutations kept — see the sibling assertion above for why
      // `list-units` is one of them.
      .filter((c) => !c.argv.includes('is-active') && !c.argv.includes('show')
        && !c.argv.includes('list-units'))
      .map((c) => c.argv);
    expect(calls).toEqual([
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      // Ruling T4-R1: `ccd-pool-sync.timer` is absent from BOTH lists, which
      // is what keeps "byte-identical to a plain install" true — and `both`
      // is precisely the role the old unconditional enable got wrong, because
      // it is the DEFAULT and it is the role the `existsSync(agent.env)` line
      // above proves gets no agent.env.
      '--user enable --now ccd-graph-sweep.timer',
      '--user enable --now ccd-usage-sweep.timer',
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-account-health.timer',
      '--user enable --now ccd-telemetry-keepalive.timer',
      '--user enable --now ccrc-models.timer',
      // W4a Task 9: the server-role watchdog's timer — `!= fleet`, so this
      // role enables it — degrading rather than dying like every timer in
      // this list, and taking no restart (a oneshot holds no code).
      '--user enable --now ccrc-update-watchdog.timer',
      '--user restart ccrc.service',
    ]);
    expect(r.stdout).toMatch(
      /^install: units: ccrc\.service, claude-session@\.service, ccd-cap-scopes\.\{service,timer\} and both drop-ins in \$HOME\/\.config\/systemd\/user$/m);
  });

  itLinux('--role server is today\'s spine minus nothing — the difference from both is reserved', () => {
    const home = freshBox('ccrc-install-role-server-');
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(unitDir(home, 'ccrc.service'))).toBe(true);
    expect(existsSync(unitDir(home, 'ccrc-agent.service'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'agent.env'))).toBe(false);
    // graphify Task 10 (O3/O6b): the sweep pair is role-gated OUT on server —
    // it runs no per-tree AST sweep — while every unit this verb shipped
    // before this task still lands unchanged. C5: the models pair joins the
    // same gate — a server box has no lanes to refresh. Another repository's
    // ccgpt-usage@ name is written on NO role (F-1), and ccrc's own usage pair
    // is `!= server` (Plan 3a): both absences are asserted here, for the third
    // role.
    for (const [dest] of UNIT_FILES) {
      if (dest.startsWith('ccd-graph-sweep.') || dest.startsWith('ccd-account-health.')
        || dest.startsWith('ccd-telemetry-keepalive.') || dest.startsWith('ccrc-models.')
        || dest.startsWith('ccd-tmp-sweep.') || dest.startsWith('ccrc-codex-usage@')) continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-account-health.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-account-health.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-telemetry-keepalive.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-telemetry-keepalive.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-models.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-models.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccgpt-usage@.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccgpt-usage@.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-codex-usage@.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-codex-usage@.timer'))).toBe(false);
    // The temp-dir reaper: a server box runs no sessions, so no temp dir to reap.
    expect(existsSync(unitDir(home, 'ccd-tmp-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-tmp-sweep.timer'))).toBe(false);
    // Ruling T4-R1: the pool-sync pair is gated OUT here too — but on a
    // NARROWER gate than the four pairs above it. Those are `!= server`;
    // this one is `= fleet`, because `both` gets no agent.env either. A
    // server box failing this assertion under the sibling gate would look
    // identical, which is why `--role both` above asserts the same absence.
    expect(existsSync(unitDir(home, 'ccd-pool-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-pool-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-pool-sync');
    // programme wave 4: and the update-intent puller's pair, on the pool-sync
    // pair's narrower `= fleet` gate — the server process is this box's
    // projection writer.
    expect(existsSync(unitDir(home, 'ccd-update-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-update-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-update-sync');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-graph-sweep');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-account-health');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-telemetry-keepalive');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-models');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccgpt-usage');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-codex-usage');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-tmp-sweep');
    // W4a Task 9: the watchdog is the SERVER's — its pair landed through the
    // UNIT_FILES loop above (not skipped there), and its timer is enabled.
    expect(systemctlCalls(home).map((c) => c.argv)).toContain('--user enable --now ccrc-update-watchdog.timer');
    // Final review F-2 (spec §11): the two GPT-lane executables are gated
    // `!= server` — the lane needs a converged per-account launcher, and a
    // server-role box converges nothing per account (D-3111) — and the
    // closing line must not claim what the gate skipped.
    for (const name of GPT_LANE_BINS) {
      expect(existsSync(join(home, '.local', 'bin', name)), `--role server placed ${name}`).toBe(false);
    }
    const bins = r.stdout.split('\n').find((l) => l.startsWith('install: bins:'));
    expect(bins, 'no `install: bins:` line in the transcript').toBeDefined();
    expect(bins!, 'the server-role closing line claims a GPT-lane executable').not.toMatch(/ccgpt|ccrc-codex/);
    expect(read(dotCcrc(home, 'ccrc.env'))).toMatch(/^CCRC_ROLE=server$/m);
    expect(r.stdout).toMatch(/^install: gate: /m);
  });

  it('an unknown role is a usage error at exit 2, refused before the first step', () => {
    const home = freshBox('ccrc-install-role-bogus-');
    const r = runInstall(home, ['install', '--role', 'bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--role/);
    expect(r.stderr).toMatch(/usage: ccrc/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });

  it('--role with no value is the same usage error', () => {
    const home = freshBox('ccrc-install-role-empty-');
    const r = runInstall(home, ['install', '--role']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--role/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });
});

describe('install.sh: the bootstrap that hands off to ccrc install', () => {
  // Task 9. `install-sh.test.ts` measures install.sh's OWN logic (the node
  // floor, `-h`/`--help`) against a thin fixture that has none of `ccd/` or
  // `pwa/` — those tests refuse before install.sh would ever look at either.
  // This is the other half: the fixture tree Tasks 6-8 already built here has
  // both, so this is where "install.sh really builds, in order, then really
  // hands off to THIS TREE's own verb" is provable — without paying for the
  // whole doctor-tail convergence a second time, which `ccrc-install` itself
  // already measures end to end.
  //
  // Two substitutions make this fast and hermetic: `npm` is `ccrcEnv`'s
  // existing recorder (records argv AND cwd, `mkdir -p node_modules`, exits
  // 0 instantly — the same stub every other test in this file already trusts
  // for "the npm argv sequence is X"), and `ccd/ccrc` — the verb install.sh
  // hands off to — is REPLACED with a recorder of its own, because this test
  // is about the HANDOFF, not a second run of the converger.
  it('builds server, pwa, server dist — in that order — then execs its OWN ccd/ccrc install', () => {
    const home = mkTmp('ccrc-installsh-e2e-');
    const root = installFixtureTree(home);
    copyFileSync(join(REPO, 'install.sh'), join(root, 'install.sh'));
    chmodSync(join(root, 'install.sh'), 0o755);
    // `TREE_FILES` carries nothing under `pwa/` — nothing `ccrc install`
    // itself reads resolves there. install.sh's `cd "$ROOT/pwa"` does, so the
    // directory has to exist for the (stubbed) `npm ci`/`npm run build` calls
    // to run at all; its contents are never read, since npm is a recorder.
    mkdirSync(join(root, 'pwa'), { recursive: true });
    // The recorder REPLACES the copy `installFixtureTree` already placed at
    // `<root>/ccd/ccrc` (from TREE_FILES) — proof that install.sh resolves
    // `ccd/ccrc` relative to ITSELF (`$ROOT`, from its own `BASH_SOURCE`)
    // rather than to the real repo this suite runs from: `$0` inside the
    // recorder can only equal the FIXTURE's path if that resolution held.
    writeFileSync(join(root, 'ccd', 'ccrc'), [
      '#!/bin/sh',
      'printf \'argv:%s\\n\' "$*" >> "$HOME/ccrc-exec-log"',
      'printf \'path:%s\\n\' "$0" >> "$HOME/ccrc-exec-log"',
      'exit 0',
    ].join('\n'), { mode: 0o755 });

    // `ccrcEnv` is `runInstall`'s environment builder, reused as-is: its `npm`
    // recorder (argv AND cwd, one line per call) is exactly the fixture this
    // test needs, and reusing it rather than re-declaring a second stub is
    // the same rule `single-definition.test.ts` enforces for everything else
    // in this tree. The rsync/systemctl/loginctl/gh/journalctl machinery it
    // also plants is unused here (the recorder below never reaches any of
    // them) and harmless.
    const env = ccrcEnv(home);
    // Fix round 2 (N5, defense-in-depth): the fake `ccd/ccrc` recorder above
    // means this spawn never reaches a manager either way, but the check is
    // cheap and this is still a runner that spawns install.sh with a planted spine.
    assertSpineFrontContained(env, home);
    assertNoRealTool(env, home);
    const r = spawnSync(BASH, [join(root, 'install.sh')], { env, encoding: 'utf8' });
    expect(r.status ?? -1, r.stderr ?? '').toBe(0);

    // The build order install.sh's pinned code spells: ci in server, then
    // ci+build in pwa, then build in server, then ci+build in agent (D-1159 —
    // the agent joined because `ccrc install` refuses without its dist for
    // every role but `server`, and until it did, a fleet-role install from
    // source restarted a live fleet's agent onto a tree with no entry point).
    expect(read(join(home, 'npm-argv')).trim().split('\n')).toEqual([
      'ci --no-audit --no-fund',
      'ci --no-audit --no-fund',
      'run build',
      'run build',
      'ci --no-audit --no-fund',
      'run build',
    ]);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([
      join(root, 'server'),
      join(root, 'pwa'),
      join(root, 'pwa'),
      join(root, 'server'),
      join(root, 'agent'),
      join(root, 'agent'),
    ]);

    // The handoff: `install install`'s argv, and — the hermetic proof — the
    // path it ran FROM is the fixture's own tree, never the repo this test
    // itself lives in.
    const execLog = read(join(home, 'ccrc-exec-log')).trim().split('\n');
    expect(execLog[0]).toBe('argv:install');
    expect(execLog[1]).toBe(`path:${join(root, 'ccd', 'ccrc')}`);
  });
});

describe('ccrc install: the node\'s three files (design 2026-09-20 §3, §9)', () => {
  const tagFixture = (home: string, tag: string): void => {
    const r = spawnSync('git', ['-C', treeRoot(home), 'tag', tag],
      { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/;

  // Each wave's spine ADDS its own words (design 2026-09-20 §9): W1's three,
  // W4's four — `detach` on Linux only (decision 17: `--detach` refuses on
  // Darwin) — and W6's `versions`, so a Linux install writes eight words and
  // a Darwin one seven. LITERALS, not a read of ccd/ccrc's arrays: a pin
  // derived from the list it pins could never red on the list being wrong.
  const CAPS_ALL = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback', 'versions'];
  const CAPS_LINUX = [...CAPS_ALL, 'detach'];
  const CAPS_HERE = process.platform === 'darwin' ? CAPS_ALL : CAPS_LINUX;

  it('node-id: minted once as a lowercase uuid, kept byte-identical by a second run', () => {
    const home = freshBox('ccrc-install-nodeid-');
    gitInit(treeRoot(home));
    const a = runInstall(home);
    expect(a.code, a.stderr).toBe(0);
    const id = readFileSync(join(home, '.ccrc', 'node-id'), 'utf8');
    expect(id).toMatch(UUID);
    expect(a.stdout).toMatch(/^install: node-id: minted [0-9a-f-]{36} /m);
    const b = runInstall(home);
    expect(b.code, b.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'node-id'), 'utf8')).toBe(id);
    expect(b.stdout).toMatch(/^install: node-id: kept /m);
  });

  it('node-id: a file that is not a uuid is refused, never overwritten — it identifies this node to the console', () => {
    const home = freshBox('ccrc-install-nodeid-bad-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'node-id'), 'not-a-uuid\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/node-id exists but is not a uuid/);
    expect(readFileSync(join(home, '.ccrc', 'node-id'), 'utf8')).toBe('not-a-uuid\n');
  });

  it('ccrc-caps: line 1 is the os, then each wave\'s words — W1\'s three, W4\'s four, W6\'s versions, detach on Linux only (§18 "_inst_caps writes each wave\'s words")', () => {
    const home = freshBox('ccrc-install-caps-');
    gitInit(treeRoot(home));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const os = process.platform === 'darwin' ? 'darwin' : 'linux';
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(`os ${os}\n${CAPS_HERE.join('\n')}\n`);
    expect(statSync(join(home, '.ccrc', 'ccrc-caps')).mode & 0o777).toBe(0o644);
    // The transcript names the same words, in the same order, as the file.
    expect(r.stdout).toMatch(new RegExp(`^install: caps: ${CAPS_HERE.join(' ')} \\(os ${os}; `, 'm'));
    // F6 (review 167): the line names the file as `~/.ccrc/ccrc-caps`, and the
    // fixture's absolute home appears nowhere in the line a rollout would relay.
    expect(r.stdout).toMatch(/^install: caps: .* \(os \w+; ~\/\.ccrc\/ccrc-caps — /m);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('install: caps:')).join('\n')).not.toContain(home);
  });

  it('ccrc-caps: eight words on Linux, seven on Darwin, whichever box runs this suite — both arms of the real _inst_caps', () => {
    // A real install reaches only the host's own arm. The other is reached by
    // running the real `_inst_caps` and `_ccrc_cap_words` out of ccd/ccrc with
    // CCD_OS set — the extraction harness the `_inst_installed` cases below
    // use — so a word moved between the two arrays reds on either platform.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const harness = [
      pick(/^PROG=.*$/m, 'PROG='),
      // Review fix round 1, N1: `_ccrc_die` now calls `_upd_redact` — this
      // harness does not trigger a die on its green path, but a regression
      // that DID would hit "_upd_redact: command not found" rather than
      // the real refusal, so it is picked up here too.
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
      pick(/^CCRC_CAP_WORDS=\(.*\)$/m, 'CCRC_CAP_WORDS=(…)'),
      pick(/^CCRC_CAP_WORDS_LINUX=\(.*\)$/m, 'CCRC_CAP_WORDS_LINUX=(…)'),
      pick(/^_ccrc_cap_words\(\) \{[\s\S]*?\n\}/m, '_ccrc_cap_words'),
      pick(/^_inst_caps\(\) \{[\s\S]*?\n\}/m, '_inst_caps'),
    ];
    for (const [os, words] of [['linux', CAPS_LINUX], ['darwin', CAPS_ALL]] as const) {
      const home = mkTmp(`ccrc-inst-caps-arm-${os}-`);
      const caps = join(home, '.ccrc', 'ccrc-caps');
      const p = spawnSync('bash', ['-c', [
        'set -uo pipefail', ...harness, `CCD_OS=${os}`, `BOX_CAPS_FILE=${JSON.stringify(caps)}`, '_inst_caps',
      ].join('\n')], {
        // Wave 9 R10d (D-3818): an extracted-function harness (`_inst_caps` and its helpers call builtins plus
        // mkdir/mv/rm/date), so it is exempt from assertNoRealTool — but it no longer inherits the real bus or tools.
        encoding: 'utf8', env: ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }),
      });
      expect(p.status, `${os}: ${p.stderr}`).toBe(0);
      expect(readFileSync(caps, 'utf8'), os).toBe(`os ${os}\n${words.join('\n')}\n`);
      // W6 Task 8A, F6: the path is the box's own home, so it is spelled `~` —
      // never the absolute fixture home this run wrote under.
      expect(p.stdout, os).toBe(`install: caps: ${words.join(' ')} (os ${os}; ~/.ccrc/ccrc-caps — what this install's ccrc can do, read by the server)\n`);
      expect(p.stdout, os).not.toContain(home);
    }
  });

  it('every cap word names machinery THIS ccrc ships — a word is a capability, never an intention (design §9)', () => {
    // The server dispatches on these words (no `update-gate` → auto-apply
    // refused; no `detach` → a detached apply refused; no `rollback` → the
    // rollback control refused), so a word listed before its code lands is a
    // node that says yes and then fails. A PRESENCE pin, stated as one: each
    // word's own describe proves the behaviour; this proves the word and its
    // machinery ship in the same tree. The words are read from the arrays so
    // that a NEW word with no entry here reds too.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const BACKING: Record<string, RegExp[]> = {
      verify: [/^_upd_fetch\(\) \{/m, /\/deploy\/verify-provenance\.mjs"/],
      'node-id': [/^_inst_node_id\(\) \{/m],
      floor: [/^_upd_floor_check\(\) \{/m],
      'update-json': [/^_upd_phase\(\) \{/m],
      'update-gate': [/^_upd_gate\(\) \{/m, /^\s*--no-gate\) no_gate=1 ;;$/m],
      rollback: [/^cmd_rollback\(\) \{/m, /^\s*rollback\)\s+cmd_rollback "\$@" ;;$/m],
      // W6 Task 4: a kept version is a flip — restore arm 1 and rollback by flip.
      versions: [/^_upd_restore_arm1\(\) \{/m, /^_ver_flip_back\(\) \{/m],
      detach: [/^_upd_detach\(\) \{/m, /^\s*--detach\) detach=1 ;;$/m],
    };
    const arr = (name: string): string[] => {
      const m = new RegExp(`^${name}=\\((.*)\\)$`, 'm').exec(src);
      expect(m, `ccd/ccrc has no ${name}=(…)`).not.toBeNull();
      return m![1]!.split(/\s+/).filter(Boolean);
    };
    const words = [...arr('CCRC_CAP_WORDS'), ...arr('CCRC_CAP_WORDS_LINUX')];
    expect(words).toEqual(CAPS_LINUX);
    for (const w of words) {
      expect(BACKING[w], `cap word '${w}' has no entry here — name the machinery it promises`).toBeDefined();
      for (const re of BACKING[w]!) expect(src, `cap word '${w}': ccd/ccrc has no ${re}`).toMatch(re);
    }
    // …and `detach` sits in the Linux-only array BECAUSE the verb refuses it
    // on Darwin (Task 3's `_upd_detach_os_check`): the two statements agree.
    expect(arr('CCRC_CAP_WORDS')).not.toContain('detach');
    expect(src).toMatch(/_ccrc_die "--detach is Linux-only \(decision 17\)"/);
  });

  it('floor: written by the LAST step from the stamped tag; only ever raised (§18 "the floor never lowers")', () => {
    const home = freshBox('ccrc-install-floor-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    const a = runInstall(home);
    expect(a.code, a.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v1.0.0\n');
    expect(a.stdout).toMatch(/^install: floor: v1\.0\.0 \(none before/m);
    // The floor line prints AFTER the installed line — it is part of the last step.
    const lines = a.stdout.split('\n');
    expect(lines.findIndex((l) => l.startsWith('install: floor:')))
      .toBeGreaterThan(lines.findIndex((l) => l.startsWith('install: installed:')));
    // A higher floor already on the box is KEPT by a lower install (a restore).
    writeFileSync(join(home, '.ccrc', 'floor'), 'v9.9.9\n');
    const b = runInstall(home);
    expect(b.code, b.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v9.9.9\n');
    expect(b.stdout).toMatch(/^install: floor: kept at v9\.9\.9 \(v1\.0\.0 is not above it/m);
    // A stamp with no version raises nothing.
    const untagged = freshBox('ccrc-install-floor-untagged-');
    gitInit(treeRoot(untagged));
    const c = runInstall(untagged);
    expect(c.code, c.stderr).toBe(0);
    expect(existsSync(join(untagged, '.ccrc', 'floor'))).toBe(false);
    expect(c.stdout).toMatch(/^install: floor: not raised — this stamp carries no version/m);
    // AN EXPLICIT BOUND (final review F4): three whole install spines. Measured alone (one file, `-t`):
    // 8.2 s at load average 12 (2026-09-28), 10.1 s at load 30 (the final review) — half the 20 s default.
  }, 60_000);

  it('_ver_newer agrees with sort -V on a fixture list, and the v is stripped nowhere else', () => {
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_ver_newer\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _ver_newer').not.toBeNull();
    const list = ['v0.0.1', 'v0.0.10', 'v0.0.9', 'v0.1.0', 'v1.0.0', 'v1.9.9', 'v1.9.10', 'v2.0.0', 'v10.0.0'];
    const sorted = spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V', '--', ...list], { encoding: 'utf8' }).stdout.trim().split('\n');
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = 0; j < sorted.length; j += 1) {
        const r = spawnSync('bash', ['-c', `${fn![0]}\n_ver_newer "$1" "$2"`, '--', sorted[i]!, sorted[j]!], { encoding: 'utf8' });
        expect(r.status, `${sorted[i]} newer than ${sorted[j]}?`).toBe(i > j ? 0 : 1);
      }
    }
    // "the v is stripped nowhere else" (D-3136 minor 4) — MEASURED, not just
    // claimed by the title: exactly one line of ccd/ccrc performs `#v}`
    // stripping, and it is this function's own `local a=…/b=…` line.
    const stripLines = src.split('\n').filter((l) => l.includes('#v}'));
    expect(stripLines, 'a second `#v}` strip site appeared in ccd/ccrc').toEqual([
      '  local a="${1#v}" b="${2#v}" i',
    ]);
  });

  it('ccrc version says when the install was placed unsigned', () => {
    const home = freshBox('ccrc-install-version-unsigned-');
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const r = runInstall(home, ['version']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: complete \(unsigned — placed without a verified provenance bundle/m);
    // Fix round 1 item 20 / review 155 C35: a direct `ccrc install` carries
    // no CCRC_UPDATE_SPINE marker (only `cmd_update`'s own staged-spine call
    // sets one), so CCRC_UPDATE_VERIFIED=1 hand-exported here is stripped —
    // `ccrc version` still reads unsigned, exactly as the unverified case
    // above. The genuine verified case (a real provenance bundle, verified
    // through `cmd_update`'s own spine) is ccrc-update.test.ts's happy path.
    const verified = freshBox('ccrc-install-version-verified-');
    gitInit(treeRoot(verified));
    expect(runInstall(verified, ['install'], { CCRC_UPDATE_VERIFIED: '1' }).code).toBe(0);
    expect(runInstall(verified, ['version']).stdout).toMatch(/^install: complete \(unsigned — placed without a verified provenance bundle/m);
  }, 60_000);

  it('ccrc version: the incomplete arm carries no provenance suffix — the record names a different, stale install (D-3136 minor 5)', () => {
    const home = freshBox('ccrc-install-version-incomplete-');
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    // The box moved on: the completed-install record still names an OLDER
    // sha, itself unsigned — but that label describes the stale install,
    // not the box's current (incomplete) state, so it must not be said.
    writeFileSync(join(home, '.ccrc', 'installed'), 'stalesha00000000000000000000000000000000\nunsigned\n');
    const r = runInstall(home, ['version']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: incomplete — stamp [0-9a-f]{40}, completed-install record names stalesha00000000000000000000000000000000$/m);
  });

  it('ccrc-caps: rewritten on every install — a stale file is replaced with current content, not merged (D-3136 minor 6)', () => {
    const home = freshBox('ccrc-install-caps-rewrite-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os plan9\nverify\n');
    expect(runInstall(home).code).toBe(0);
    const os = process.platform === 'darwin' ? 'darwin' : 'linux';
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(`os ${os}\n${CAPS_HERE.join('\n')}\n`);
  });

  it('floor: a malformed ~/.ccrc/floor is left untouched, never treated as absent (D-3136)', () => {
    const home = freshBox('ccrc-install-floor-malformed-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), 'three\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('three\n');
    expect(r.stdout).toMatch(/^install: floor: ~\/\.ccrc\/floor is malformed \(got: 'three'\) — left untouched; fix it by hand$/m);
  });

  // D-3146: `_inst_installed`'s floor block used to guard its read with `-f`
  // alone, so a PRESENT-but-UNREADABLE floor read as `cur=""`, fell through
  // every branch, and was silently REPLACED by the `mv -f` (which needs
  // write permission on ~/.ccrc, not read permission on the file) —
  // possibly with a LOWER version. Mirrors `_upd_floor_check`'s own `-r`
  // test (Task 11, D-3136) and the idiom of the update-side unreadable-floor
  // pin: root bypasses permission bits, so this is not measurable running
  // as root — skipped there, and said so.
  it.skipIf(process.getuid?.() === 0)('floor: an UNREADABLE ~/.ccrc/floor is left untouched and named by its own sentence, distinct from "malformed" (D-3146)', () => {
    const home = freshBox('ccrc-install-floor-unreadable-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const floorFile = join(home, '.ccrc', 'floor');
    writeFileSync(floorFile, 'v9.9.9\n');
    chmodSync(floorFile, 0o000);
    let r: Result;
    try {
      r = runInstall(home);
    } finally {
      chmodSync(floorFile, 0o644);   // restore so the assertion below can read it back
    }
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: floor: ~\/\.ccrc\/floor is unreadable — left untouched; fix its permissions by hand$/m);
    expect(r.stdout).not.toMatch(/malformed/);
    expect(readFileSync(floorFile, 'utf8')).toBe('v9.9.9\n');
  });

  it('_inst_installed: the marker write is ONE checked group — no printf sits before an unchecked chmod (D-3135, structural)', () => {
    // The two behavioural cases below prove exit 1 / one die line / no
    // leftover file under two REAL failure conditions (mv blocked, open()
    // denied) — but neither actually distinguishes the fixed code from the
    // bug D-3135 describes: a write that CREATES the temp file and then
    // fails partway through it (ENOSPC is the finding's own example).
    // Reproducing that deterministically needs a size-constrained
    // filesystem (a tiny tmpfs/loop mount), which needs a privileged mount
    // in this harness — skipped per the finding's own "skip a shape only if
    // root would be needed" allowance. What proves the fix instead is this
    // structural pin: the printf(s) now sit INSIDE the group the `> "$tmp"`
    // redirect opens, and that group is the FIRST link of the && chain —
    // never a printf whose own exit status is discarded before a later,
    // separately-checked `chmod`.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_inst_installed\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _inst_installed').not.toBeNull();
    expect(fn![0]).toMatch(/\}\s*>\s*"\$tmp"\s*&&\s*chmod 644 "\$tmp" && mv -f "\$tmp" "\$dest"/);
  });

  it('_inst_installed: a directory at ~/.ccrc/installed blocks the mv, dies loudly, and leaves no half-record (D-3135)', () => {
    const home = freshBox('ccrc-install-installed-mvfail-');
    gitInit(treeRoot(home));
    // A pre-existing DIRECTORY at the record's own path, made non-writable:
    // the redirect that creates installed.tmp.$$ (a SIBLING path, inside
    // ~/.ccrc itself) still succeeds, and chmod on that temp file succeeds —
    // only the final `mv -f "$tmp" "$dest"` fails, because mv cannot add an
    // entry to a directory it has no write permission on. This isolates the
    // PLACEMENT half of D-3135's fix (nothing else in the spine touches
    // BOX_INSTALLED_FILE, so no earlier step is affected).
    mkdirSync(join(home, '.ccrc', 'installed'), { recursive: true });
    chmodSync(join(home, '.ccrc', 'installed'), 0o555);
    let r: Result;
    try {
      r = runInstall(home);
    } finally {
      chmodSync(join(home, '.ccrc', 'installed'), 0o755);
    }
    expect(r.code).toBe(1);
    const dieLines = (r.stderr.match(/writing .*installed failed/g) ?? []).length;
    expect(dieLines, r.stderr).toBe(1);
    // The directory survives, empty: mv never replaced it, and the cleanup
    // removed the temp file mv left orphaned at its original location.
    expect(statSync(join(home, '.ccrc', 'installed')).isDirectory()).toBe(true);
    expect(readdirSync(join(home, '.ccrc', 'installed'))).toEqual([]);
    expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('installed.tmp.'))).toEqual([]);
  });

  it('_inst_installed: a write that fails right after creating the temp file never places a record — one redirect, not two printfs each on its own (D-3135)', () => {
    // The "redirect denied outright" shape, measured in isolation from the
    // rest of the spine: this harness extracts `_inst_installed` (plus the
    // real `_ccrc_die`/`PROG` it calls) out of ccd/ccrc, exactly as the
    // `_ver_newer` case above extracts that function, and runs it directly
    // against a `~/.ccrc` this process cannot write into — so the failure
    // is scoped to the function under test, not to whichever earlier
    // `cmd_install` step would hit the same wall first in a full spine run
    // (`_inst_accounts_sh` regenerates its file on every install and would
    // fail before `_inst_installed` is ever reached). NOTE (measured): this
    // shape passes against the PRE-FIX code too — when open() itself is
    // denied, no temp file is ever created, so the OLD code's separately-
    // checked `chmod 644 "$tmp"` fails on its own and still dies correctly.
    // It is kept because it is the finding's own suggested shape and a real
    // regression guard on that path; the structural case above is what
    // actually pins the fix (D-3135's bug needs a write that CREATES the
    // temp file and fails partway through it, which needs a size-
    // constrained filesystem to reproduce and is skipped for that reason).
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const progLine = /^PROG=.*$/m.exec(src);
    expect(progLine, 'ccd/ccrc has no PROG=').not.toBeNull();
    // Fix round 1 item 11 / review 155 C17: `_ccrc_die` now calls
    // `_upd_redact` — this harness DOES trigger a die (the assertion below
    // reads its stderr), so it must pick that definition up too.
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact').not.toBeNull();
    const dieLine = /^_ccrc_die\(\) \{.*\}$/m.exec(src);
    expect(dieLine, 'ccd/ccrc has no _ccrc_die').not.toBeNull();
    const fn = /^_inst_installed\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _inst_installed').not.toBeNull();

    const home = mkTmp('ccrc-inst-installed-redirect-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    chmodSync(join(home, '.ccrc'), 0o555);
    const harness = [
      'set -uo pipefail',
      progLine![0],
      redactBlock![0],
      dieLine![0],
      '_box_build_fields() { BOX_BUILD=(deadbeefdeadbeefdeadbeefdeadbeefdeadbeef main 2026-01-01T00:00:00Z false ""); return 0; }',
      `BOX_INSTALLED_FILE="${join(home, '.ccrc', 'installed')}"`,
      fn![0],
      '_inst_installed',
    ].join('\n');
    let r: Result;
    try {
      const p = spawnSync('bash', ['-c', harness], { encoding: 'utf8' });
      r = { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    } finally {
      chmodSync(join(home, '.ccrc'), 0o755);
    }
    expect(r.code).toBe(1);
    const dieLines = (r.stderr.match(/writing .*installed failed/g) ?? []).length;
    expect(dieLines, r.stderr).toBe(1);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    // No orphaned temp file either — the redirect itself never created one.
    expect(readdirSync(join(home, '.ccrc'))).toEqual([]);
  });
});

describe('ccrc install: install-step names the step the spine is entering (design §11; W4 Task 4)', () => {
  it('a completed install leaves NO install-step — _inst_installed removes it once the record is placed', () => {
    const home = freshBox('ccrc-install-step-done-');
    gitInit(treeRoot(home));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(dotCcrc(home, 'installed')), 'no record was placed — the absence below would be vacuous').toBe(true);
    expect(existsSync(dotCcrc(home, 'install-step')), 'a completed spine left its step marker').toBe(false);
  });

  it('a spine that dies leaves install-step naming the step it died IN — not the one before it', () => {
    const home = freshBox('ccrc-install-step-died-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(dotCcrc(home, 'node-id'), 'not-a-uuid\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/node-id exists but is not a uuid/);
    expect(read(dotCcrc(home, 'install-step'))).toBe('_inst_node_id\n');
  });

  it('a marker that cannot be written refuses BEFORE its step runs — nothing of that step happens', () => {
    const home = freshBox('ccrc-install-step-blocked-');
    // A directory at the marker's path: `_plat_mv_notdir` refuses to place a
    // file over it, where a bare `mv -f` would drop the temp INSIDE it and
    // answer 0.
    mkdirSync(join(dotCcrc(home, 'install-step'), 'in-the-way'), { recursive: true });
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: could not record the install step marker ~\/\.ccrc\/install-step before _inst_banner — nothing of _inst_banner ran$/m);
    expect(r.stdout, 'a step ran after its marker failed').not.toMatch(/^install: /m);
    expect(existsSync(dotCcrc(home, 'accounts.json'))).toBe(false);
  });
});

describeLinux('ccrc install and uninstall leave another repository\'s GPT-lane files alone (D-3478)', () => {
  it('a foreign ccgpt, ccgpt-proxy and ccgpt-usage in ~/.local/bin, and an alias to the first, survive install --role fleet and uninstall, byte for byte', () => {
    // The fleet box's shape (m-livebox): three dotless files another repository
    // owns — the launcher both live Codex lanes exec, its shim, its publisher —
    // and a lane alias symlinked to the launcher. `_inst_atomic` has no ownership
    // check, so ONE placement at any of these names silently cuts over every live
    // lane at once; that is why ccrc's launcher is `ccrc-codex`. This case reads
    // what the verbs DID, so it also sees a placement or removal from a function
    // `install-census.test.ts` does not read.
    const home = freshBox('ccrc-install-foreign-ccgpt-bins-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const bin = join(home, '.local', 'bin');
    // Invisible to every scan on purpose — no CLAUDE_CONFIG_DIR, no marker — so
    // this case is about placement and removal, never about a doctor verdict.
    const foreign: Record<string, string> = {
      'ccgpt': '#!/usr/bin/env bash\n# FOREIGN-FIXTURE-2b2: another repository owns this launcher\nexit 0\n',
      'ccgpt-proxy': '#!/usr/bin/env python3\n# FOREIGN-FIXTURE-2b2: another repository owns this shim\n',
      'ccgpt-usage': '#!/usr/bin/env bash\n# FOREIGN-FIXTURE-2b2: another repository owns this publisher\nexit 0\n',
    };
    for (const [name, text] of Object.entries(foreign)) writeFileSync(join(bin, name), text, { mode: 0o755 });
    symlinkSync('ccgpt', join(bin, 'ext-a'));
    const untouched = (stage: string): void => {
      for (const [name, text] of Object.entries(foreign)) {
        const p = join(bin, name);
        expect(existsSync(p), `${stage}: ${name} is gone`).toBe(true);
        expect(lstatSync(p).isFile(), `${stage}: ${name} is no longer a regular file`).toBe(true);
        expect(read(p), `${stage}: ${name} changed`).toBe(text);
        expect(statSync(p).mode & 0o777, `${stage}: ${name} mode`).toBe(0o755);
      }
      expect(lstatSync(join(bin, 'ext-a')).isSymbolicLink(), `${stage}: the alias is gone`).toBe(true);
      expect(readlinkSync(join(bin, 'ext-a')), `${stage}: the alias was repointed`).toBe('ccgpt');
    };
    const inst = runInstall(home, ['install', '--role', 'fleet']);
    expect(inst.code, inst.stderr).toBe(0);
    untouched('after install --role fleet');
    // Plan 2b-2 placed ccrc's own launcher, so it lands BESIDE them. That makes
    // this a statement about the NAME, rather than about an install that placed
    // nothing at all.
    expect(read(join(bin, 'ccrc-codex')), 'ccrc-codex is not the placed tree\'s copy').toBe(read(placed(home, 'ccd', 'ccrc-codex')));
    const un = runInstall(home, ['uninstall']);
    expect(un.code, `stderr: ${un.stderr}\nstdout: ${un.stdout}`).toBe(0);
    untouched('after uninstall');
    expect(existsSync(join(bin, 'ccrc-codex')), 'uninstall left ccrc\'s own launcher behind').toBe(false);
  });
});

describe('ccrc install: the harness contains the transient-unit launcher (Plan 2b-2 Task 10)', () => {
  it('systemd-run resolves inside the fixture HOME and refuses when no fake user manager is planted', () => {
    // The containment rule: every `systemd-run` a test can reach is a
    // fixture. Before this task `command -v systemd-run` answered the REAL
    // one here (m-platform §3.2). The probe resolves the name first and runs
    // it only when it resolves under $HOME, so a broken harness reports
    // UNCONTAINED instead of starting a unit on this box.
    const home = freshBox('ccrc-install-sdrun-contained-');
    const r = spawnSync(BASH, ['-c', SPINE_CONTAINMENT_PROBE], { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.stdout).toContain(`at=${join(home, '.local', 'bin', 'systemd-run')}\n`);
    expect(r.stdout).toMatch(/^run-rc=97$/m);
    expect(r.stdout).toMatch(/^env-rc=0$/m);
    expect(spineRunCalls(home).join('\n')).toContain('--unit=fixture-containment-probe.service');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Plan 2b-2 Task 10 — `_inst_codex_runtime` and `_inst_codex_tiers`.
// Two instruments on purpose. The EXTRACTED function, its lane-library seams
// stubbed (the `_inst_installed` idiom above), is what binds each decision
// to a red. The REAL spine — real `ccgpt-runtime`, real library, real shim,
// the fake user manager — proves they compose.
// ════════════════════════════════════════════════════════════════════════
const realPy = (): string => realPath('python3');
const READY = { CCRC_CODEX_READY_S: '20' };
const REPO_CCRC = join(REPO, 'ccd', 'ccrc');
const runtimeDir = (home: string): string => join(home, '.ccrc', 'runtime', 'codex');
const laneDir = (home: string, id: string): string => join(home, '.ccrc', 'codex', id);
const generations = (home: string): string[] =>
  (existsSync(runtimeDir(home)) ? readdirSync(runtimeDir(home)).filter((n) => n.startsWith('gen-')).sort() : []);
const venvCalls = (home: string): string[] =>
  (existsSync(join(home, 'python3-argv')) ? read(join(home, 'python3-argv')).split('\n') : [])
    .filter((l) => /^-m venv .*\/\.ccrc\/runtime\/codex\//.test(l));
/** State-changing manager calls on a CODEX TIER (reads — is-active, show,
 *  show-environment — excluded). SCOPED to `ccgpt-` units on purpose: the
 *  front records every call, and on Linux `_inst_enable` always runs
 *  `systemctl --user restart "$main"` (`ccrc.service` on these boxes) through
 *  it, so an unscoped filter reads that restart as a tier state change and
 *  reds a correct install (the plan review measured exactly that line in
 *  `manager-calls` on a replica of the spliced stub). The
 *  tier units are `ccgpt-<id>-*` (D-3478), the same pattern
 *  `spineSystemctlArms` forwards on. `systemd-run` stays unscoped: outside
 *  Task 2's `_svc_run_supervised`, the one other `systemd-run` in `ccd/ccrc`
 *  is `_svc_run_detached`, the swap tail's launcher, which no install step
 *  calls. So any start the front records during an install is a codex tier's. */
const stateChanges = (home: string): string[] => managerCalls(home)
  .filter((l) => (/^systemctl --user (stop|start|restart|reset-failed|kill)\b/.test(l) && / ccgpt-/.test(l))
    || l.startsWith('systemd-run '));
const doctorCode = (home: string): number => runInstall(home, ['doctor'], READY).code;

/** What `ccgpt-runtime python` answers — the instrument, never a realpath of `current`. */
function runtimePython(home: string): string {
  const p = spawnSync(join(home, '.local', 'bin', 'ccgpt-runtime'), ['python'],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(`ccgpt-runtime python: ${p.stderr}`);
  return (p.stdout ?? '').trim();
}

/** The TEMPLATE runtime python the `python3` stub copies into a codex
 *  generation — ruling R28's one exception to "every generation is
 *  `plantFakeRuntime`'s": it is what `python3 -m venv` hands the REAL builder,
 *  which then builds, probes, stamps and swaps on its own, so it models the
 *  BUILD and never a built runtime. It answers what `ccgpt-runtime` and the
 *  tier functions ask of a generation's python, from a fixture directory baked
 *  in at plant time — so a builder that runs its probe under a scrubbed env or
 *  a temp HOME still finds it. pip and the probe answer by verdict; litellm's
 *  version comes from a fixture dist-info on PYTHONPATH (so ANY
 *  `importlib.metadata` question — `check`'s re-measure, the stamp writer's —
 *  gets it); the litellm tier is Task 5's ONE stand-in LiteLLM
 *  (`fakeLitellmSource`, ruling R29), written beside it by
 *  `plantRuntimeTemplate`; everything else (the shim, the stamp writer) runs on
 *  the real interpreter. */
function runtimeTemplatePython(fixtureDir: string, real: string): string {
  return [
    '#!/bin/sh',
    'PATH="${PATH:-/usr/bin:/bin}"; export PATH',
    `F='${fixtureDir}'`,
    `REAL='${real}'`,
    'printf \'%s\\n\' "$*" >> "$F/calls"',
    'verdict() {',
    '  v="$(cat "$F/verdict" 2>/dev/null)"',
    '  case "$v" in',
    '    pass) echo "behaviour_probe: PASS litellm=$(cat "$F/version") raw-shape-leaks-system-role=yes"; exit 0 ;;',
    '    fail:*) echo "behaviour_probe: FAIL ${v#fail:}: fixture verdict"; exit 1 ;;',
    '  esac',
    '  exit 0',
    '}',
    // Interpreter flags the builder may pass. Dropped because, under -I, the
    // real interpreter would ignore PYTHONPATH — the fixture dist-info's only
    // way in (m-runtime-probe HR7); PYTHONDONTWRITEBYTECODE covers -B. They
    // are dropped BEFORE pip is recognised (final review F4, F3's note): a
    // builder that ran `-I -m pip` would otherwise fall through to the box's
    // REAL python, and so to a real, networked `pip install`.
    'while :; do case "${1:-}" in -I|-B|-E|-s|-S|-u) shift ;; *) break ;; esac; done',
    'if [ "${1:-}" = -m ] && [ "${2:-}" = pip ]; then',
    '  prev=""',
    '  for a in "$@"; do',
    '    [ "$prev" = --report ] && printf \'{"version": "1", "install": []}\\n\' > "$a"',
    '    prev="$a"',
    '  done',
    '  exit "$(cat "$F/pip-rc" 2>/dev/null || echo 0)"',
    'fi',
    'export PYTHONPATH="$F/site" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1',
    'if [ "${1:-}" = -m ] && [ "${2:-}" = litellm.proxy.proxy_cli ]; then',
    '  exec "$REAL" "$F/fake-litellm.py" "$@"',
    'fi',
    'case "${1:-}" in',
    '  -) prog="$(cat)"',
    '     case "$prog" in *behaviour_probe*) verdict ;; esac',
    '     printf \'%s\\n\' "$prog" | "$REAL" "$@"; exit $? ;;',
    '  -c) case "${2:-}" in *behaviour_probe*) verdict ;; esac ;;',
    '  *) if [ -f "${1:-}" ] && grep -q behaviour_probe "$1" 2>/dev/null; then verdict; fi ;;',
    'esac',
    'exec "$REAL" "$@"',
  ].join('\n') + '\n';
}

function writeRuntimeFixture(home: string, opts: { verdict?: string; version?: string; pipRc?: number }): void {
  const f = join(home, 'fixture-runtime');
  mkdirSync(f, { recursive: true });
  if (opts.verdict !== undefined) writeFileSync(join(f, 'verdict'), `${opts.verdict}\n`);
  if (opts.pipRc !== undefined) writeFileSync(join(f, 'pip-rc'), `${opts.pipRc}\n`);
  if (opts.version !== undefined) {
    writeFileSync(join(f, 'version'), `${opts.version}\n`);
    rmSync(join(f, 'site'), { recursive: true, force: true });
    const di = join(f, 'site', `litellm-${opts.version}.dist-info`);
    mkdirSync(di, { recursive: true });
    writeFileSync(join(di, 'METADATA'), `Metadata-Version: 2.1\nName: litellm\nVersion: ${opts.version}\n`);
  }
}

function plantRuntimeTemplate(home: string, opts: { verdict: 'pass' | `fail:${string}`; version: string }): void {
  const f = join(home, 'fixture-runtime');
  const tpl = join(f, 'gen-template');
  mkdirSync(join(tpl, 'bin'), { recursive: true });
  writeFileSync(join(tpl, 'bin', 'python'), runtimeTemplatePython(f, realPy()), { mode: 0o755 });
  // Task 5's stand-in LiteLLM (ruling R29), never a second fake. Its knobs and
  // its `litellm-<port>.json` evidence live in `<home>/fake-procs`, the one
  // directory Task 5's readers and `killLaneProcesses` use; it refuses a
  // missing `--config`, so a tier started before `plantLaneConfig` fails loudly.
  mkdirSync(join(home, 'fake-procs'), { recursive: true });
  writeFileSync(join(f, 'fake-litellm.py'), fakeLitellmSource(join(home, 'fake-procs')));
  writeRuntimeFixture(home, { verdict: opts.verdict, version: opts.version, pipRc: 0 });
  writeFileSync(join(home, 'fixture-runtime-template'), `${tpl}\n`);
}

/** A fresh box whose roster carries `lanes` as codex lanes.
 *
 *  TREE OVERRIDE (re-derived, not in the brief's own text): `freshBox` alone
 *  leaves the checkout git-less, so `_inst_stamp` reports "skipped" and
 *  `_inst_installed` never writes `~/.ccrc/installed` (`_box_build_fields`
 *  refuses without a readable stamp) — measured directly against this tree at
 *  Step 5 (`--role server builds nothing…` reds on `dotCcrc(home,
 *  'installed')` even with an empty stderr). Every real-spine case in this
 *  block asserts that record exists, so `codexBox` stamps the checkout the
 *  same way the pre-existing stamp suite does (`gitInit`, this file's own
 *  helper), which the brief's own snippet omitted. */
function codexBox(prefix: string, lanes: LanePorts[], opts: { template?: boolean; systemd?: boolean } = {}): string {
  const home = freshBox(prefix);
  gitInit(treeRoot(home));
  codexRoster(home, lanes);
  if (opts.template !== false) plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
  if (opts.systemd === true) plantSystemd(home, { userManager: true });
  return home;
}

/** Registry, credential, rendered config, `ccrc codex start` — through the
 *  REPOSITORY's ccrc, as every `models` verb in this file runs, against this
 *  fixture HOME. The config is Task 5's `plantLaneConfig` (ruling R20): the
 *  renderer's own output for a one-model catalogue, planted before the start. */
function startLane(home: string, id: string): Result {
  // Register before init/start can partially succeed. The real product stop
  // runs while the roster, lane and fake-manager state are still present.
  registerLaneCleanup(home, `install-codex:${id}`, () => {
    runInstall(home, ['codex', 'stop', id], READY, { from: REPO_CCRC });
  });
  const init = runInstall(home, ['models', id, 'init', 'codex'], READY, { from: REPO_CCRC });
  if (init.code !== 0) throw new Error(`ccrc models ${id} init codex:\n${init.stderr}`);
  plantLaneAuth(home, id);
  plantLaneConfig(home, id);
  return runInstall(home, ['codex', 'start', id], READY, { from: REPO_CCRC });
}

interface StepRun {
  code: number; stdout: string; stderr: string; calls: string[]; degraded: string[];
  /** `CX_LOCK_FD` and `CX_LOCK_ID` after the step returned: empty unless a
   *  lane's lock was never released through `_codex_unlock`. */
  lockAfter: string;
}

function runStepHarness(home: string, harness: string, callsFile = 'calls'): StepRun {
  // The containment rule reaches this harness too (Global Constraints: every
  // `systemd-run` and `systemctl` a test can reach is a fixture). The wall's
  // stubs come FIRST on PATH, and a step that called either is a thrown,
  // named red, never the real binary.
  // Task 11 review fix round 3 (C2): the wall is CHECKED, not assumed — on
  // the env the spawn takes, on the line before it. `strayManagerCalls` reads
  // only the wall's own log, so a name the wall lost would reach the real
  // binary unrecorded.
  const wall = isolationManagerStubs(home);
  const env = { PATH: `${wall}:${process.env['PATH'] ?? ''}`, HOME: home };
  assertIsolationWallFirst(env, home);
  const p = spawnSync(BASH, ['-c', harness], { env, encoding: 'utf8' });
  const stray = strayManagerCalls(home);
  if (stray.length > 0) {
    throw new Error(`the step reached the user manager directly, not through the stubbed lane library:\n${stray.join('\n')}\n${p.stderr ?? ''}`);
  }
  const lines = (f: string): string[] => (existsSync(join(home, f)) ? read(join(home, f)).split('\n').filter(Boolean) : []);
  return {
    code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '', calls: lines(callsFile),
    degraded: lines('degraded'), lockAfter: lines('lock-after').join('\n'),
  };
}
/** Task 4's `_codex_lanes`, stubbed: the ids at rc 0, or (`rc: 1`) its
 *  `roster-invalid` refusal — an unreadable roster is never an empty one. */
const lanesFn = (lanes: string[], rc = 0): string => (rc === 0
  ? `_codex_lanes() { ${lanes.length === 0 ? ':' : `printf '%s\\n' ${lanes.join(' ')}`}; }`
  : `_codex_lanes() { echo "ccrc codex: roster-invalid: fixture: the roster could not be read" >&2; return ${rc}; }`);
const DEGRADED_OUT = 'printf \'%s\\n\' ${INST_DEGRADED[@]+"${INST_DEGRADED[@]}"} > "$HOME/degraded"';
const LOCK_AFTER_OUT = 'printf \'%s\\n\' "${CX_LOCK_FD:-}" "${CX_LOCK_ID:-}" > "$HOME/lock-after"';
/** Task 4's one-line definitions, read out of ccd/ccrc rather than re-typed. */
const RUNTIME_CLI_DEF = (): string => ccrcLine(/^_codex_runtime_cli\(\) \{.*\}$/m, '_codex_runtime_cli');
const CODEX_TIERS_DEF = (): string => ccrcLine(/^CODEX_TIERS=.*$/m, 'CODEX_TIERS=');

/** The requirement the stub builder DECLARES, in the placed builder's own
 *  assignment shape. A fixture value, never the real one: the real-spine case
 *  reads the real one out of the placed `ccgpt-runtime`. */
const FIXTURE_REQUIREMENT = 'fixture-requirement>=0';

/** `_inst_codex_runtime` alone, against a stub `ccgpt-runtime` whose `python`
 *  answers `before`, and `after` once a build exits 0. The stub declares
 *  `requirement` (default {@link FIXTURE_REQUIREMENT}; `null` plants no
 *  assignment line), and its `build` says `fixture ccgpt-runtime: build running`
 *  on stderr the moment it starts. `merge` runs the step with stderr joined to
 *  stdout, so the ORDER of the step's lines and the build's start is one
 *  measurement (ruling R33). */
function runRuntimeStep(c: {
  lanes?: string[]; lanesRc?: number; role?: 'both' | 'fleet' | 'server'; builder?: boolean;
  before?: string; after?: string; buildRc?: number; requirement?: string | null; merge?: boolean;
}): StepRun {
  const home = mkTmp('ccrc-codex-runtime-step-');
  const rt = join(home, 'rt');
  mkdirSync(rt, { recursive: true });
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  const genPy = (g: string): string => `${join(home, '.ccrc', 'runtime', 'codex', g, 'bin', 'python')}\n`;
  if (c.before !== undefined) writeFileSync(join(rt, 'now'), genPy(c.before));
  if (c.after !== undefined) writeFileSync(join(rt, 'after'), genPy(c.after));
  writeFileSync(join(rt, 'build-rc'), `${c.buildRc ?? 0}\n`);
  const requirement = c.requirement === undefined ? FIXTURE_REQUIREMENT : c.requirement;
  if (c.builder !== false) {
    writeFileSync(join(home, '.local', 'bin', 'ccgpt-runtime'), [
      '#!/bin/sh',
      ...(requirement === null ? [] : [`LITELLM_REQUIREMENT='${requirement}'`]),
      'd="$HOME/rt"',
      'printf \'%s\\n\' "$*" >> "$d/calls"',
      'case "$1" in',
      '  build)',
      '    echo "fixture ccgpt-runtime: build running" >&2',
      '    rc="$(cat "$d/build-rc")"',
      '    if [ "$rc" != 0 ]; then echo "ccgpt-runtime: build failed at probe: fixture refusal — the previous runtime (if any) stays current" >&2; exit "$rc"; fi',
      '    [ -f "$d/after" ] && cp "$d/after" "$d/now"',
      '    echo "ccgpt-runtime: fixture builder stdout that the step must not relay"',
      '    exit 0 ;;',
      '  python)',
      '    [ -s "$d/now" ] || { echo "ccgpt-runtime: absent" >&2; exit 1; }',
      '    cat "$d/now"; exit 0 ;;',
      'esac',
      'echo "stub ccgpt-runtime: unexpected argv: $*" >&2; exit 90',
    ].join('\n') + '\n', { mode: 0o755 });
  }
  return runStepHarness(home, [
    'set -uo pipefail',
    `INST_ROLE=${c.role ?? 'both'}`,
    'INST_DEGRADED=()',
    lanesFn(c.lanes ?? ['codex-a'], c.lanesRc ?? 0),
    RUNTIME_CLI_DEF(),
    ccrcFunction('_inst_codex_runtime'),
    c.merge === true ? '_inst_codex_runtime 2>&1; rc=$?' : '_inst_codex_runtime; rc=$?',
    DEGRADED_OUT,
    'exit "$rc"',
  ].join('\n'), 'rt/calls');
}

/** `_inst_codex_tiers` alone: the four lane-library seams stubbed by table,
 *  Task 5's `_codex_lock` and `_codex_unlock` by `lockStub`, and Task 4's
 *  one-line definitions and Task 5's `_codex_ready_secs` (ruling R27) REAL,
 *  read out of ccd/ccrc. `stopForeign` (Task 10's own extension, ruling
 *  PF-21) names id+tier keys whose `_codex_stop_tier` stub prints "foreign"
 *  at rc 0 — the one word that tells "stopped" and "foreign" apart, since the
 *  real verb returns rc 0 for both. */
function runTiersStep(c: {
  lanes?: string[]; lanesRc?: number; role?: 'both' | 'fleet' | 'server'; runtime?: boolean; readyS?: string;
  ours?: Record<string, StubRc>; stale?: Record<string, StubRc>;
  stopRc?: Record<string, StubRc>; startRc?: Record<string, StubRc>; lockRefuse?: string[]; lockNoFlock?: string[];
  stopForeign?: readonly string[];
  // Review round 2, N2: the WHY `_codex_tier_ours`'s fake sets right before
  // it answers 2, so the step's own `_codex_foreign_what` call (the real
  // function, unstubbed) resolves a real message from it, the same way the
  // shipped library would.
  oursWhy?: Readonly<Record<string, string>>;
}): StepRun {
  const home = mkTmp('ccrc-codex-tiers-step-');
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'ccgpt-runtime'), [
    '#!/bin/sh',
    '[ "$1" = python ] || { echo "stub ccgpt-runtime: unexpected argv: $*" >&2; exit 90; }',
    c.runtime === false
      ? 'echo "ccgpt-runtime: absent" >&2; exit 1'
      : 'echo "$HOME/.ccrc/runtime/codex/gen-20260101T000000Z-1/bin/python"',
  ].join('\n') + '\n', { mode: 0o755 });
  const stopWords = Object.fromEntries((c.stopForeign ?? []).map((k) => [k, 'foreign']));
  return runStepHarness(home, [
    'set -uo pipefail',
    `INST_ROLE=${c.role ?? 'both'}`,
    'INST_DEGRADED=()',
    // Review round 1, spec-2/mut-3: `0` silently means 90s by
    // `_codex_ready_secs`' own PF-19 floor (`[ "$s" -ge 1 ] || s=90`), and
    // this file's testTimeout is 20s — a case that omits `readyS` and
    // reaches the wait loop would then red by TIMEOUT, not by its own
    // assertion. `1` is the smallest valid bound.
    `CCRC_CODEX_READY_S=${c.readyS ?? '1'}`,
    // Review round 2: `_codex_foreign_what` (real, unstubbed — called by
    // `_inst_codex_tiers` on a 2) reads these unconditionally; the isolation
    // harness never runs `_codex_row`, whose real job sets them. Pure-parse
    // fixture ports (global constraints' own vocabulary), no socket opened.
    'CX_LITELLM=45010', 'CX_PROXY=45011',
    lanesFn(c.lanes ?? ['codex-a'], c.lanesRc ?? 0),
    CODEX_TIERS_DEF(),
    RUNTIME_CLI_DEF(),
    ccrcFunction('_codex_ready_secs'),
    // Real, unstubbed (review round 2, N2/N3): `_inst_codex_tiers` now calls
    // this on a 2, the same helper the identity gate above it already used.
    ccrcFunction('_codex_foreign_what'),
    // The final-review fix wave: `_codex_foreign_what` reads its port through
    // the ONE tier -> port helper (real), and names a unit through the lane
    // library's unit reader, the manager probe and the status hint — stubbed
    // here as no manager and the default unit name, so a `unit-unproven`
    // WHY is named from the word itself, as the real helper does.
    ccrcFunction('_codex_tier_port'),
    '_codex_unit() { printf \'ccgpt-%s-%s.service\\n\' "$1" "$2"; }',
    '_svc_have_user_manager() { return 1; }',
    '_svc_status_hint() { printf \'systemctl --user status %s\' "$1"; }',
    '_codex_bus_defaults() { :; }',
    lockStub(c.lockRefuse ?? [], c.lockNoFlock ?? []),
    recordingStub('_codex_tier_ours', c.ours, 1, {}, c.oursWhy ?? {}),
    recordingStub('_codex_tier_stale', c.stale, 1),
    recordingStub('_codex_stop_tier', c.stopRc, 0, stopWords),
    recordingStub('_codex_start_tier', c.startRc, 0),
    ccrcFunction('_inst_codex_tiers'),
    '_inst_codex_tiers; rc=$?',
    DEGRADED_OUT,
    LOCK_AFTER_OUT,
    'exit "$rc"',
  ].join('\n'));
}

describe('ccrc install: the codex runtime step, measured in isolation (_inst_codex_runtime)', () => {
  const G1 = 'gen-20260101T000000Z-1';
  const G2 = 'gen-20260101T000000Z-2';

  it('a server-role box: silent, and the builder is never run', () => {
    const r = runRuntimeStep({ role: 'server', after: G1 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('no codex lane in the roster: one line, and the builder is never run', () => {
    const r = runRuntimeStep({ lanes: [], after: G1 });
    expect(r.stdout).toBe('install: codex runtime: none — no codex lane in the roster\n');
    expect(r.calls).toEqual([]);
  });

  it('a roster that cannot be read is never "no codex lane": its own line, degraded, and nothing is built', () => {
    // Task 4's `_codex_lanes` answers rc 1 with `roster-invalid` there; the
    // `after` generation is the CONTROL — a step that read rc 1 as "none"
    // would say "none", and one that built anyway would name it.
    const r = runRuntimeStep({ lanesRc: 1, after: G1 });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stdout).toBe('install: codex runtime: NOT BUILT — $HOME/.ccrc/accounts.json could not be read as a roster (the ccrc codex: roster-invalid line above says why), so this step cannot tell whether any codex lane needs a runtime. This install continues. Fix the roster (ccrc wrappers prints the validator\'s sentence), then re-run: ccrc install\n');
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  // Review C2: `_codex_lanes` rc 2 is a missing jq (`cmd_install` probes
  // node and systemctl by name, never jq), and the roster it could not read
  // is VALID — `_inst_accounts_sh` validated it through node. So the step
  // names jq, never the roster.
  it('a missing jq (rc 2) is its own line, never "fix the roster": degraded, and nothing is built (review C2)', () => {
    const r = runRuntimeStep({ lanesRc: 2, after: G1 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('install: codex runtime: NOT BUILT — jq is not on PATH (the ccrc codex: missing-dependency line above says so), so this step cannot read which roster lanes are codex lanes. This install continues. Install jq, then re-run: ccrc install\n');
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  // Ruling R33's line: said before every build, naming what the builder declares.
  const BUILDING = `install: codex runtime: building ${FIXTURE_REQUIREMENT} — pip may take minutes`;

  it('a build that produces a new generation says so, named by what ccgpt-runtime python resolves — never by parsing the builder', () => {
    const r = runRuntimeStep({ after: G2 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${BUILDING}\ninstall: codex runtime: ${G2} built, probed and current for 1 codex lane(s)\n`);
    expect(r.calls).toEqual(['python', 'build', 'python']);
    expect(r.degraded).toEqual([]);
  });

  it('says the build is running BEFORE the build starts, naming the requirement the builder declares, and the result line comes after it (ruling R33)', () => {
    // `merge` joins the step's stderr to its stdout, so the builder's own
    // `build running` line lands in order between the step's two lines. A
    // `building` line printed after the build returned would follow it.
    const r = runRuntimeStep({ after: G2, merge: true });
    expect(r.stdout.split('\n').filter(Boolean)).toEqual([
      BUILDING,
      'fixture ccgpt-runtime: build running',
      `install: codex runtime: ${G2} built, probed and current for 1 codex lane(s)`,
    ]);
  });

  it('a builder whose requirement line cannot be read still builds, and the building line says it could not be read rather than naming nothing', () => {
    const r = runRuntimeStep({ after: G2, requirement: null });
    expect(r.stdout.split('\n')[0]).toMatch(/^install: codex runtime: building \(the requirement \S+\/\.local\/bin\/ccgpt-runtime declares could not be read\) — pip may take minutes$/);
    expect(r.calls).toEqual(['python', 'build', 'python']);
    expect(r.degraded).toEqual([]);
  });

  it('a build that changed nothing says the runtime was re-measured current', () => {
    const r = runRuntimeStep({ lanes: ['codex-a', 'codex-b'], before: G1 });
    expect(r.stdout).toBe(`${BUILDING}\ninstall: codex runtime: ${G1} already current (requirement, probe and litellm version re-measured unchanged) for 2 codex lane(s)\n`);
  });

  it('a failed build DEGRADES: the builder\'s own sentence reaches stderr, the previous runtime is named as still current, and the step returns 0', () => {
    const r = runRuntimeStep({ before: G1, buildRc: 2 });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^ccgpt-runtime: build failed at probe: fixture refusal/m);
    expect(r.stdout).toBe(`${BUILDING}\ninstall: codex runtime: NOT BUILT — ccgpt-runtime build exited 2 (its reason is the ccgpt-runtime line on stderr); the previous runtime ${G1} stays current. This install continues. Re-run: ccgpt-runtime build\n`);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a failed first build says there is no runtime at all', () => {
    const r = runRuntimeStep({ buildRc: 2 });
    expect(r.stdout).toMatch(/; there is no runtime at all, so no codex lane can start until a build passes\. This install continues\./);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a build that exits 0 while nothing resolves is NOT a build — an overloaded success is refused', () => {
    const r = runRuntimeStep({});
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — ccgpt-runtime build exited 0 but no runtime resolves \(ccgpt-runtime python answers nothing\)/m);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a box with no builder on PATH degrades and names the missing file', () => {
    const r = runRuntimeStep({ builder: false });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — \S+\/\.local\/bin\/ccgpt-runtime is not on this box/m);
    // No builder, so nothing is building: the R33 line is never said.
    expect(r.stdout).not.toMatch(/: building /);
    expect(r.degraded).toEqual(['codex-runtime']);
  });
});

describe('ccrc install: the codex tier restart step, measured in isolation (_inst_codex_tiers)', () => {
  const LOCK_A = '_codex_lock codex-a';
  const LOCK_B = '_codex_lock codex-b';
  const UNLOCK_A = '_codex_unlock codex-a';
  const UNLOCK_B = '_codex_unlock codex-b';
  const A_L = '_codex_tier_ours codex-a litellm';
  const A_S = '_codex_tier_ours codex-a shim';
  const B_L = '_codex_tier_ours codex-b litellm';
  const B_S = '_codex_tier_ours codex-b shim';

  it('the isolation harness contains the user manager too: systemctl and systemd-run resolve to its wall, inside this HOME', () => {
    // `runStepHarness` runs with the caller's PATH, where both names resolve
    // to the REAL binaries on a Linux box. The wall's stubs must come first.
    const home = mkTmp('ccrc-codex-step-contained-');
    const r = runStepHarness(home, 'command -v systemctl; command -v systemd-run');
    expect(r.stdout).toBe(`${join(home, 'isolation-bin', 'systemctl')}\n${join(home, 'isolation-bin', 'systemd-run')}\n`);
  });

  it('a server-role box: silent, and the lane library is never asked', () => {
    const r = runTiersStep({ role: 'server', ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 } });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
  });

  it('no codex lane in the roster: one line', () => {
    const r = runTiersStep({ lanes: [] });
    expect(r.stdout).toBe('install: codex tiers: none — no codex lane in the roster\n');
    expect(r.calls).toEqual([]);
  });

  it('a roster that cannot be read is never "no codex lane": its own line, degraded, and no lane is asked', () => {
    const r = runTiersStep({ lanesRc: 1 });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stderr).toMatch(/^install: codex tiers: NOT measured — \$HOME\/\.ccrc\/accounts\.json could not be read as a roster \(the ccrc codex: roster-invalid line above says why\), so no codex lane's tiers were checked or restarted/m);
    expect(r.stdout).not.toMatch(/no codex lane in the roster/);
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a missing jq (rc 2) is its own line, never "fix the roster": degraded, and nothing is measured (review C2)', () => {
    const r = runTiersStep({ lanesRc: 2, ours: { 'codex-a litellm': 0 } });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^install: codex tiers: NOT measured — jq is not on PATH \(the ccrc codex: missing-dependency line above says so\), so no codex lane's tiers were checked or restarted; install jq, then re-run: ccrc install$/m);
    expect(r.stderr).not.toMatch(/^install: codex tiers: .*could not be read as a roster/m);
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a tier that is not running is never started, even when it would count as stale — a lazy lane stays lazy', () => {
    // `stale: 0` is the CONTROL: with the tiers reading not-stale, a step
    // that wrongly treated rc 1 as a candidate would stay green here.
    const r = runTiersStep({ stale: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    // Review round 1, item 3: the lock-wait line (R33's spirit) is printed
    // BEFORE every `_codex_lock`, even when it returns at once.
    expect(r.stdout).toBe('install: codex tiers: codex-a: waiting up to 31s for its lane lock\n'
      + 'install: codex tiers: 1 codex lane(s) — 0 restarted, 0 left as they were, 0 not restarted\n');
    expect(r.degraded).toEqual([]);
  });

  it('a tier whose port or unit answers as another lane is left alone, and said so', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 2 }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'listener-answers-other-lane' } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    // Review A2: named in `_codex_foreign_what`'s words (the real helper),
    // with its remedy — never a "not this lane" sentence of the step's own.
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — port 45011 \(codex-a's shim tier\) is held by a listener that is not this lane's: it answers as another lane, and this step never stops what it cannot prove it started\. Stop whatever holds port 45011, or give codex-a other ports in ~\/\.ccrc\/accounts\.json\. \(read: ccrc codex status codex-a\)$/m);
    expect(r.stdout).toMatch(/^install: codex tiers: 1 codex lane\(s\) — 0 restarted, 1 left as they were, 0 not restarted$/m);
  });

  // Review A2/E2 (ruling PF-13): this lane's own crash-looping tier reads
  // `unit-unproven` between two restarts, so the gate says UNPROVEN, with
  // the retry, never "not this lane".
  it('a proven lane process whose port belongs to another process is left alone because restart cannot rebind, with its lane-stop remedy', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 2 }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'listener-other-process' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("codex-a shim: left alone — port 45011 (codex-a's shim tier) is held by a process that is not this lane's shim: pid ? is this lane's by its command line, and another process holds the port's listening socket");
    expect(r.stdout).toContain("another process owns its port, so restarting this proven lane process could not rebind it; stop this lane's process with: ccrc codex stop codex-a");
    expect(r.stdout).not.toContain('and this step never stops what it cannot prove it started');
  });

  it('a unit whose identity is only unproven is left alone, named as unproven with its retry — never "not this lane" (review A2)', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 2 }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'unit-unproven' } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    expect(r.stdout).toContain('install: codex tiers: codex-a shim: left alone — the unit ccgpt-codex-a-shim.service is active, but its identity as codex-a\'s shim tier is unproven: '
      + 'a unit of that name is live with no process that proves this lane, and port 45011 does not answer, and this step never stops what it cannot prove it started. '
      + 'Re-run in a few seconds: this lane\'s own tier reads this way between two of its restarts, and proves itself once its process is back. '
      + 'If it still reads this way, \'systemctl --user status ccgpt-codex-a-shim.service\' shows what the unit runs. (read: ccrc codex status codex-a)\n');
    expect(r.stdout).not.toMatch(/not this lane/);
    expect(r.stdout).toMatch(/— 0 restarted, 1 left as they were, 0 not restarted$/m);
  });

  it('an identity answer the step cannot read is left alone too — the safe direction, with its own sentence', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 3 }, stale: { 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — whether it is this lane's could not be measured, and this step never stops what it cannot prove it started/m);
    expect(r.stdout).not.toMatch(/codex-a shim: left alone — port /);
  });

  it('a tier of this lane\'s that is still STARTING (4) is never restarted, even when stale — it is named with its remedy', () => {
    // A 4 is ours, not foreign (a live handle proves the lane; the port does
    // not answer yet). `stale: 0` is the control: a step that treated 4 like
    // 0 would ask staleness and stop it mid-import.
    const r = runTiersStep({ ours: { 'codex-a shim': 4 }, stale: { 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — it is this lane's own tier and still starting \(its port does not answer yet\), and this step never restarts a tier mid-start; if it runs code this install replaced, restart it once it answers: ccrc codex stop codex-a, then ccrc codex start codex-a$/m);
    expect(r.stdout).toMatch(/— 0 restarted, 1 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
  });

  it('a running tier this install did not replace is not touched', () => {
    const r = runTiersStep({ ours: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, '_codex_tier_stale codex-a litellm', A_S, '_codex_tier_stale codex-a shim', UNLOCK_A]);
    expect(r.stdout).toMatch(/— 0 restarted, 2 left as they were, 0 not restarted$/m);
  });

  it('a running tier whose staleness cannot be measured (2) is left running, and said so — never restarted', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 2 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — whether it runs code this install replaced could not be measured/m);
    expect(r.stdout).toMatch(/— 0 restarted, 1 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
  });

  it('a running stale tier is stopped, then started, then re-measured until it answers as this lane', () => {
    // Review round 1, item 5 (class fix): a NEW `_codex_tier_ours` call sits
    // between the stop and the start — the re-ask that proves the port is
    // free (1) before this step ever starts over it. The sequence's 2nd
    // value (1) is that re-ask; the 3rd (4) and 4th (0) are the readiness
    // wait's own two calls, preserving "waits through an intermediate state
    // before succeeding".
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1, 4, 0] }, stale: { 'codex-a shim': 0 }, readyS: '5' });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, '_codex_start_tier codex-a shim', A_S, A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: started, waiting up to 5s for it to answer$/m);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — it was running code this install replaced$/m);
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
  });

  it('a restart that re-measures STARTING (4) keeps waiting; only 0 is "restarted"', () => {
    // The class-fix re-ask (2nd value) must read 1 (free) or the start is
    // refused before it ever happens; the wait loop's own three calls (4, 4,
    // then 0) are what this case is actually about.
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1, 4, 4, 0] }, stale: { 'codex-a shim': 0 }, readyS: '10' });
    expect(r.calls.filter((l) => l === A_S)).toHaveLength(5);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — /m);
  });

  it('a stop that fails is reported and never followed by a start', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 }, stopRc: { 'codex-a shim': 1 } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', '_codex_stop_tier codex-a shim', UNLOCK_A]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it could not be stopped/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a stop that finds the tier no longer provably this lane\'s counts as not restarted, and no start follows (ruling PF-21)', () => {
    // `_codex_stop_tier` returns rc 0 for BOTH "stopped" and "foreign" — only
    // its stdout WORD tells them apart (PF-21). `foreign` is never folded
    // into a successful stop, so this step CAPTURES the word rather than only
    // the rc. `stopForeign` is this harness's own knob (Task 10; Task 6 has
    // its own): it makes the stub print "foreign" at rc 0 for this one
    // id+tier key, modelling the narrow race where the tier stopped being
    // provably this lane's between this step's own identity gate and the
    // stop call — extremely rare, but D-3488 governs it too: ccrc never
    // starts over something it can no longer prove it stopped.
    const r = runTiersStep({ ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 }, stopForeign: ['codex-a shim'] });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', '_codex_stop_tier codex-a shim', UNLOCK_A]);
    expect(r.calls).not.toContain('_codex_start_tier codex-a shim');
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — /m);
    expect(r.stdout).toMatch(/— 0 restarted, 0 left as they were, 1 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a stop that answers rc 0 without saying "foreign" is re-measured right before the start, and a foreign holder there is NAMED and leaves the tier DOWN (review round 2, N2/N3)', () => {
    // CLASS FIX: `_codex_stop_tier` answers `foreign` only when it stopped
    // nothing — after a REAL stop it answers `stopped`, and a taker that
    // arrives after its own second measurement is invisible to it. This
    // step's own re-ask, right before the start, is what catches that: the
    // 2nd `ours` value (2) models a foreign holder arriving after a real
    // stop. `stopForeign` is NOT set here — the stop's own word never says
    // foreign, on purpose, so this case binds the re-ask and not PF-21's own
    // guard above. `oursWhy` sets CX_TIER_WHY (`listener-other-process`,
    // real function's own contract) right before the fake returns 2, so
    // `_codex_foreign_what` — real, unstubbed — resolves a real holder
    // description from it (N2): nothing here hand-writes the message text.
    const r = runTiersStep({
      ours: { 'codex-a shim': [0, 2] }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'listener-other-process' },
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, UNLOCK_A]);
    expect(r.calls).not.toContain('_codex_start_tier codex-a shim');
    // The holder description is `_codex_foreign_what`'s own text for
    // `listener-other-process`, never re-typed here — only its distinctive
    // substring is asserted, so this case still binds if that wording moves.
    // Since the fix wave the real library yields `listener-other-process`
    // for the shim too (its proven pid while another process holds the
    // port), and names it by the tier's own name.
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — the stop said "[^"]*", but a re-measurement right before the start found port \d+ \(codex-a's shim tier\) is held by a process that is not this lane's shim.*this tier is DOWN.*ccrc codex start codex-a$/m);
    expect(r.stdout).toMatch(/— 0 restarted, 0 left as they were, 1 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a re-ask that cannot tell whether the port is free (not 1, not 2) also leaves the tier DOWN, named as unmeasured (review round 2, N3)', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 3] }, stale: { 'codex-a shim': 0 } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, UNLOCK_A]);
    expect(r.calls).not.toContain('_codex_start_tier codex-a shim');
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — the stop said "[^"]*", but a re-measurement right before the start could not tell whether the port is free \(answered 3\).*this tier is DOWN.*ccrc codex start codex-a$/m);
    expect(r.stdout).toMatch(/— 0 restarted, 0 left as they were, 1 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a start that fails is reported distinctly — the tier is DOWN', () => {
    // The 2nd `ours` value (1) is the class-fix re-ask, proving the port
    // free right before the start that then fails.
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1] }, stale: { 'codex-a shim': 0 }, startRc: { 'codex-a shim': 1 } });
    expect(r.calls.slice(-2)).toEqual(['_codex_start_tier codex-a shim', UNLOCK_A]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it was stopped and would not start again/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a start that never answers as this lane is a failed restart, not a restart', () => {
    // TREE OVERRIDE (re-derived, not the brief's own text): `_codex_ready_secs`
    // (Task 5, read at `ccd/ccrc:10246-10252`) falls back to 90 for `0` too —
    // `[ "$s" -ge 1 ] || s=90` — not only for an empty or non-digit value. The
    // brief's own `readyS: '0'` therefore does not bound this case at 0s: it
    // waits the full 90s default (measured — this case took ~90s before this
    // fix). `1` is the smallest valid bound, so the case still runs fast. At
    // that bound the wait loop's own shape (it checks the deadline only AFTER
    // `sleep 1`) can make ONE or TWO `_codex_tier_ours` calls before it gives
    // up, depending on real elapsed time between computing the deadline and
    // the first check (measured both ways on this box) — so this case asserts
    // the SHAPE of the tail (start, one-or-more identical ours calls, unlock)
    // rather than an exact count, which a 1s deadline cannot promise.
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1] }, stale: { 'codex-a shim': 0 }, readyS: '1' });
    const startAt = r.calls.indexOf('_codex_start_tier codex-a shim');
    expect(startAt).toBeGreaterThan(-1);
    const tail = r.calls.slice(startAt);
    expect(tail[0]).toBe('_codex_start_tier codex-a shim');
    expect(tail.at(-1)).toBe(UNLOCK_A);
    const waited = tail.slice(1, -1);
    expect(waited.length).toBeGreaterThanOrEqual(1);
    expect(waited.every((c) => c === A_S)).toBe(true);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it was started again and did not answer as this lane within 1s/m);
    expect(r.stdout).not.toMatch(/codex-a shim: restarted/);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('with no runtime resolving, a stale tier is NOT stopped — it is never stopped when it could not be started again', () => {
    const r = runTiersStep({ runtime: false, ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', UNLOCK_A]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — it runs code this install replaced, but no codex runtime resolves/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('two failed restarts degrade the step once, and the summary counts both', () => {
    const r = runTiersStep({
      lanes: ['codex-a', 'codex-b'],
      ours: { 'codex-a shim': 0, 'codex-b shim': 0 },
      stale: { 'codex-a shim': 0, 'codex-b shim': 0 },
      stopRc: { 'codex-a shim': 1, 'codex-b shim': 1 },
    });
    expect(r.degraded).toEqual(['codex-tiers']);
    expect(r.stdout).toMatch(/^install: codex tiers: 2 codex lane\(s\) — 0 restarted, 0 left as they were, 2 not restarted$/m);
  });

  it('each lane is asked and acted on under ITS lock, released through _codex_unlock before the next lane\'s is taken', () => {
    // The lock is held from the first question to the last act (a check made
    // outside it is a check-then-act race), and released per lane so no later
    // spawn inherits it. The release is `_codex_unlock`, its ONLY release
    // (ruling R19): the stub records it, so an inline close shows as a missing
    // `_codex_unlock` line. `LOCK-STILL-HELD` is the stub's record of a lock
    // entered while the previous one was never released; `lockAfter` is the
    // last lane's `CX_LOCK_FD` and `CX_LOCK_ID`.
    // The 2nd `ours` value (1) is the class-fix re-ask; the 3rd (0) is the
    // readiness wait's own call.
    const r = runTiersStep({
      lanes: ['codex-a', 'codex-b'],
      ours: { 'codex-b shim': [0, 1, 0] }, stale: { 'codex-b shim': 0 }, readyS: '5',
    });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A, LOCK_B, B_L, B_S, '_codex_tier_stale codex-b shim',
      '_codex_stop_tier codex-b shim', B_S, '_codex_start_tier codex-b shim', B_S, UNLOCK_B]);
    expect(r.lockAfter).toBe('');
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
  });

  it('a lane whose lock cannot be taken is not asked at all: its own line, counted, degraded — and the next lane still runs', () => {
    const r = runTiersStep({
      lanes: ['codex-a', 'codex-b'], lockRefuse: ['codex-a'],
      ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 },
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, LOCK_B, B_L, B_S, UNLOCK_B]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a: NOT measured — its lane lock could not be taken/m);
    expect(r.stdout).toMatch(/^install: codex tiers: 2 codex lane\(s\) — 0 restarted, 0 left as they were, 2 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
    expect(r.lockAfter).toBe('');
  });

  it('a box with no flock: the lock answers 0 with nothing held, and the lane is still measured and restarted, unserialised', () => {
    // Task 5's contract (ruling R19): rc 0 with CX_LOCK_FD EMPTY means "no
    // flock on this box", never a refusal. A step that read the empty
    // descriptor as a failed lock would leave every lane of such a box
    // untouched and degraded. `_codex_unlock -` is the release of nothing.
    // The 2nd `ours` value (1) is the class-fix re-ask; the 3rd (0) is the
    // readiness wait's own call.
    const r = runTiersStep({ lockNoFlock: ['codex-a'], ours: { 'codex-a shim': [0, 1, 0] }, stale: { 'codex-a shim': 0 }, readyS: '5' });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, '_codex_start_tier codex-a shim', A_S, '_codex_unlock -']);
    expect(r.stderr).not.toMatch(/its lane lock could not be taken/);
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
    expect(r.lockAfter).toBe('');
  });
});

/** `_inst_codex_usage` alone (Plan 3a Task 6). The converge, its six
 *  `_codex_usage_*` reads, `_codex_shape`, `_codex_say` and
 *  `_inst_enable_timer` come REAL out of ccd/ccrc; `_codex_lanes` is stubbed
 *  by `lanesFn`. `systemctl` is a bash FUNCTION: it shadows the isolation
 *  wall's binary, so every call the step makes lands in `$HOME/calls`, and a
 *  call made any other way still reaches the wall. It answers
 *  `enable --now` and `disable --now` as a manager does, by planting and
 *  removing the timer's `timers.target.wants` link, so the converge's own
 *  reads see its own acts. A unit listed in `refuse` is refused. `enabled`,
 *  `foreign` and `flatForeign` plant links before the step runs. `shape:
 *  false` (fix round 1) sources no `ccrc-wrapper-shape` and points
 *  `CCRC_HERE` at an empty directory, so `_codex_shape` cannot load the
 *  contract: the box whose tree lost the file. */
function runUsageStep(c: {
  lanes?: string[]; lanesRc?: number; role?: 'both' | 'fleet' | 'server'; os?: 'linux' | 'darwin';
  enabled?: string[]; foreign?: string[]; flatForeign?: boolean; refuse?: string[]; shape?: boolean;
}): StepRun & { links: string[] } {
  const home = mkTmp('ccrc-codex-usage-step-');
  const units = join(home, '.config', 'systemd', 'user');
  const wants = join(units, 'timers.target.wants');
  mkdirSync(wants, { recursive: true });
  const link = (name: string, template: string): void => symlinkSync(join(units, template), join(wants, name));
  for (const id of c.enabled ?? []) link(`ccrc-codex-usage@${id}.timer`, 'ccrc-codex-usage@.timer');
  for (const id of c.foreign ?? []) link(`ccgpt-usage@${id}.timer`, 'ccgpt-usage@.timer');
  if (c.flatForeign === true) link('ccgpt-usage.timer', 'ccgpt-usage.timer');
  writeFileSync(join(home, 'refuse'), (c.refuse ?? []).map((u) => `${u}\n`).join(''));
  const noShape = join(home, 'no-shape-contract');
  mkdirSync(noShape);
  const r = runStepHarness(home, [
    'set -uo pipefail',
    'PROG=ccrc',
    `INST_ROLE=${c.role ?? 'both'}`,
    `CCD_OS=${c.os ?? 'linux'}`,
    'BOX_UNIT_DIR="$HOME/.config/systemd/user"',
    'INST_DEGRADED=()',
    c.shape === false ? `CCRC_HERE='${noShape}'` : `. '${join(REPO, 'ccd', 'ccrc-wrapper-shape')}'`,
    lanesFn(c.lanes ?? ['codex-a'], c.lanesRc ?? 0),
    'systemctl() {',
    '  printf \'systemctl %s\\n\' "$*" >> "$HOME/calls"',
    '  { [ "${1:-}" = --user ] && [ "${3:-}" = --now ] && [ -n "${4:-}" ]; } || { echo "fixture systemctl: unexpected argv: $*" >&2; return 90; }',
    '  if grep -qxF -- "$4" "$HOME/refuse"; then echo "Failed to $2 unit $4: fixture" >&2; return 1; fi',
    '  case "$2" in',
    '    enable) ln -sfn "$HOME/.config/systemd/user/${4%%@*}@.timer" "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
    '    disable) rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
    '  esac',
    '  echo "fixture systemctl: unexpected argv: $*" >&2; return 90',
    '}',
    ...['_codex_say', '_codex_shape', '_codex_usage_timer', '_codex_usage_foreign', '_codex_usage_wants',
      '_codex_usage_enabled', '_codex_usage_enabled_ids', '_codex_usage_flat_foreign', '_inst_enable_timer',
      '_inst_codex_usage'].map((f) => ccrcFunction(f)),
    '_inst_codex_usage; rc=$?',
    DEGRADED_OUT,
    'exit "$rc"',
  ].join('\n'));
  return { ...r, links: readdirSync(wants).sort() };
}

describe('ccrc install: the codex usage converge, measured in isolation (_inst_codex_usage, Plan 3a Task 6)', () => {
  const T = (id: string): string => `ccrc-codex-usage@${id}.timer`;
  const EN = (id: string): string => `systemctl --user enable --now ${T(id)}`;
  const DIS = (id: string): string => `systemctl --user disable --now ${T(id)}`;
  const ctl = (r: StepRun): string[] => r.calls.filter((l) => l.startsWith('systemctl '));
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('a server-role box: silent, and the manager is never asked', () => {
    const r = runUsageStep({ role: 'server', lanes: ['codex-a'], enabled: ['ext-a'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('ext-a')]);
    expect(r.degraded).toEqual([]);
  });

  it('no codex lane and no ccrc timer enabled: one line, and the manager is never asked', () => {
    const r = runUsageStep({ lanes: [] });
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(ctl(r)).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('one timer per codex lane, in roster order, and none for any other id', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'] });
    expect(ctl(r)).toEqual([EN('codex-a'), EN('codex-b')]);
    expect(r.links).toEqual([T('codex-a'), T('codex-b')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toBe('install: codex-usage: enabled for codex-a codex-b; withheld from no lane; withdrawn from no lane\n');
  });

  it('a ccrc timer whose id is no longer a codex lane is DISABLED first — a flip-back converges on the next install', () => {
    const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a', 'ext-a'] });
    expect(ctl(r)).toEqual([DIS('ext-a'), EN('codex-a')]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toMatch(/; withdrawn from ext-a$/m);
  });

  it('the last codex lane gone: its timer is withdrawn, nothing is enabled, and the line says so', () => {
    const r = runUsageStep({ lanes: [], enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([DIS('codex-a')]);
    expect(r.links).toEqual([]);
    expect(r.stdout).toBe('install: codex-usage: enabled for no lane; withheld from no lane; withdrawn from codex-a\n');
  });

  it('ANOTHER repository\'s timer enabled for a codex lane: ccrc\'s is withheld and withdrawn, the step degrades, and the foreign unit is never named to the manager (R6)', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], enabled: ['codex-a'], foreign: ['codex-a'] });
    expect(ctl(r)).toEqual([DIS('codex-a'), EN('codex-b')]);
    expect(ctl(r).join('\n'), 'the converge asked the manager about another repository\'s unit').not.toContain('ccgpt-usage');
    expect(r.links, 'the foreign link was touched, or ccrc\'s was left beside it')
      .toEqual(['ccgpt-usage@codex-a.timer', T('codex-b')]);
    expect(r.degraded).toEqual(['codex-usage']);
    // Fix round 1: the transcript names the withdrawal it made, in the
    // lane's own line and in the summary.
    expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — another repository's ccgpt-usage@codex-a\.timer is enabled on this box, and two publishers would race this lane's ~\/\.cc-limits row\. ccrc's own ccrc-codex-usage@codex-a\.timer was enabled, and this run disabled it\. ccrc never disables another tool's unit: once this lane's cutover retires it, run: systemctl --user disable --now ccgpt-usage@codex-a\.timer — then re-run: ccrc install$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-b; withheld from codex-a; withdrawn from codex-a$/m);
  });

  it('two lanes withheld, one of them withdrawn: each line says what this run did to that lane, and codex-usage is ONE degraded step (fix round 1)', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], enabled: ['codex-a'], foreign: ['codex-a', 'codex-b'] });
    expect(ctl(r)).toEqual([DIS('codex-a')]);
    expect(r.links).toEqual(['ccgpt-usage@codex-a.timer', 'ccgpt-usage@codex-b.timer']);
    expect(r.degraded, 'codex-usage was counted once per withheld lane, not once per step').toEqual(['codex-usage']);
    const lines = r.stdout.split('\n');
    expect(lines.find((l) => l.startsWith('install: codex-usage: NOT ENABLED for codex-a ')))
      .toContain("ccrc's own ccrc-codex-usage@codex-a.timer was enabled, and this run disabled it.");
    expect(lines.find((l) => l.startsWith('install: codex-usage: NOT ENABLED for codex-b ')), 'a withdrawal was claimed for a lane whose timer was never on')
      .toMatch(/~\/\.cc-limits row\. ccrc never disables another tool's unit: /);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for no lane; withheld from codex-a codex-b; withdrawn from codex-a$/m);
  });

  it('a withdrawal refused on the foreign arm: the lane\'s line says both publishers are armed, a NOT CONVERGED line names what is still on, and codex-usage is ONE step (fix round 1)', () => {
    const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a', 'ext-a'], foreign: ['codex-a'],
      refuse: [T('codex-a'), T('ext-a')] });
    expect(ctl(r)).toEqual([DIS('ext-a'), DIS('codex-a')]);
    expect(r.links).toEqual(['ccgpt-usage@codex-a.timer', T('codex-a'), T('ext-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — .* ccrc's own ccrc-codex-usage@codex-a\.timer is enabled too, and this run could not disable it, so both publishers are armed\. ccrc never disables another tool's unit: /m);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for no lane; withheld from codex-a; withdrawn from no lane$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — ccrc's own usage timer is still enabled for ext-a codex-a, which this run had to withdraw and systemd would not disable/m);
  });

  it('another repository\'s FLAT timer names no lane: said once, unattributed, and it blocks nothing', () => {
    const r = runUsageStep({ lanes: ['codex-a'], flatForeign: true });
    expect(ctl(r)).toEqual([EN('codex-a')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toMatch(/^install: codex-usage: note — another repository's ccgpt-usage\.timer is enabled on this box\. It names no lane, so ccrc cannot tell which lane's ~\/\.cc-limits row it writes; if it is one of codex-a, two publishers race that row\. ccrc leaves it alone; once no lane on this box relies on it, run: systemctl --user disable --now ccgpt-usage\.timer$/m);
    expect(r.links).toContain('ccgpt-usage.timer');
  });

  it('on a box with no codex lane the foreign timers are not the converge\'s business at all — the live fleet box\'s shape after this merge', () => {
    const r = runUsageStep({ lanes: [], foreign: ['ext-b'], flatForeign: true });
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual(['ccgpt-usage.timer', 'ccgpt-usage@ext-b.timer']);
    expect(r.degraded).toEqual([]);
  });

  it('an unreadable roster is never "no codex lane": NOT CONVERGED, degraded, and a ccrc timer already on is NOT withdrawn', () => {
    const r = runUsageStep({ lanesRc: 1, enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — \$HOME\/\.ccrc\/accounts\.json could not be read as a roster/m);
  });

  it('no jq (rc 2): the same refusal to act, in its own sentence', () => {
    const r = runUsageStep({ lanesRc: 2, enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — jq is not on PATH/m);
  });

  it('an enable systemd refuses: the helper\'s line on stderr, and the degraded step is that unit', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], refuse: [T('codex-b')] });
    expect(ctl(r)).toEqual([EN('codex-a'), EN('codex-b')]);
    expect(r.degraded).toEqual([T('codex-b')]);
    expect(r.stderr).toMatch(new RegExp(`^install: codex-usage: could not enable ${esc(T('codex-b'))} — run: systemctl --user enable --now ${esc(T('codex-b'))}$`, 'm'));
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-a; withheld from no lane; withdrawn from no lane$/m);
  });

  it('a withdrawal systemd refuses: its own line, degraded, and the timer is still there to name', () => {
    const r = runUsageStep({ lanes: [], enabled: ['ext-a'], refuse: [T('ext-a')] });
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@ext-a\.timer — account ext-a is no longer a codex lane, so its timer must not poll; run: systemctl --user disable --now ccrc-codex-usage@ext-a\.timer$/m);
    expect(r.links).toEqual([T('ext-a')]);
    // Fix round 1: `none` is the line the live-shape cases read as "this step
    // did nothing"; over a ccrc timer still enabled it would be false.
    expect(r.stdout, 'a refused withdrawal was reported as `none`').toBe(
      'install: codex-usage: NOT CONVERGED — ccrc\'s own usage timer is still enabled for ext-a, which this run had to withdraw and systemd would not disable (the could-not-disable line above names each, with its command). This install continues. Run those commands, then re-run: ccrc install\n');
  });

  it('no shape contract: NOT CONVERGED, degraded, and nothing enabled or withdrawn — an unread id set is not an empty one (fix round 1)', () => {
    const r = runUsageStep({ shape: false, lanes: ['codex-a'], enabled: ['ext-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('ext-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toBe('install: codex-usage: NOT CONVERGED — the wrapper shape contract could not be read (the ccrc codex: line above says so), so ccrc\'s own usage timers cannot be told from anything else, and none was enabled or disabled. This install continues. Re-run: ccrc install\n');
    expect(r.stderr).toMatch(/^ccrc codex: install-incomplete: /m);
  });

  it('a wants link whose instance is not an account id is not ccrc\'s: never disabled, never named to the manager, and the step says none (fix round 1)', () => {
    // The grammar filter is an ownership boundary on the path that issues
    // `disable --now`, and Task 7's uninstall reuses the same reader.
    const r = runUsageStep({ lanes: [], enabled: ['EXT-A'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual(['ccrc-codex-usage@EXT-A.timer']);
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(r.degraded).toEqual([]);
  });

  it('forced Darwin: one not-applicable line naming the lanes, the manager never asked, and NOT a degraded step (R2)', () => {
    const r = runUsageStep({ os: 'darwin', lanes: ['codex-a', 'codex-b'], enabled: ['ext-a'] });
    expect(r.stdout).toBe('install: codex-usage: not applicable on macOS — ccrc places no launchd job for a codex lane\'s usage poller (decision 17: macOS is not centrally managed), so this box publishes no ~/.cc-limits row for: codex-a, codex-b\n');
    expect(ctl(r)).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('forced Darwin with no codex lane: silent', () => {
    const r = runUsageStep({ os: 'darwin', lanes: [] });
    expect(r.stdout).toBe('');
    expect(ctl(r)).toEqual([]);
  });
});

describe('ccrc install: the codex runtime step on a real spine (Plan 2b-2 Task 10)', () => {
  it('the runtime template answers pip itself behind interpreter flags, and never hands pip to the box\'s real python (final review F4)', () => {
    // No spine: the template's own venv python, run directly. `--version` is
    // the argv measured here because, on the pre-fix template, it is the one
    // pip argv that reaches the REAL pip harmlessly (it prints a version).
    const home = mkTmp('ccrc-codex-template-pip-');
    plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
    const py = join(home, 'fixture-runtime', 'gen-template', 'bin', 'python');
    for (const argv of [['-m', 'pip', '--version'], ['-I', '-m', 'pip', '--version'], ['-I', '-B', '-m', 'pip', '--version']]) {
      const r = spawnSync(py, argv, { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home } });
      expect(r.status, `${argv.join(' ')}: ${r.stderr}`).toBe(0);
      expect(r.stdout, `${argv.join(' ')} reached the box's real pip`).not.toMatch(/^pip /m);
    }
    expect(read(join(home, 'fixture-runtime', 'calls'))).toMatch(/^-I -B -m pip --version$/m);
  });

  it('a roster with no codex lane: one line from each step, and nothing is built', () => {
    const home = freshBox('ccrc-codex-steps-none-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('install: codex runtime:')))
      .toEqual(['install: codex runtime: none — no codex lane in the roster']);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('install: codex tiers:')))
      .toEqual(['install: codex tiers: none — no codex lane in the roster']);
    expect(existsSync(join(home, '.ccrc', 'runtime'))).toBe(false);
    expect(venvCalls(home)).toEqual([]);
    expect(spineRunCalls(home)).toEqual([]);
  });

  it('--role server builds nothing and restarts nothing, and says nothing about either', async () => {
    const home = codexBox('ccrc-codex-steps-server-', await freeLanes(['codex-a']));
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stdout).not.toMatch(/^install: codex (runtime|tiers):/m);
    expect(existsSync(join(home, '.ccrc', 'runtime'))).toBe(false);
    expect(venvCalls(home)).toEqual([]);
    expect(r.code).toBe(doctorCode(home));
  });

  it('a codex lane and a passing runtime: built, stamped from the declared requirement and probe; a re-run re-measures it current and builds nothing', async () => {
    const home = codexBox('ccrc-codex-steps-built-', await freeLanes(['codex-a']));
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), `${r.stdout}\n${r.stderr}`).toBe(true);
    expect(r.stdout).toMatch(/^install: codex runtime: gen-\d{8}T\d{6}Z-\d+ built, probed and current for 1 codex lane\(s\)$/m);
    expect(r.stdout).not.toMatch(/^install: done — converged with .*\bcodex-runtime\b/m);
    expect(r.code).toBe(doctorCode(home));
    const py = runtimePython(home);
    const gen = py.replace(/\/bin\/python$/, '');
    expect(generations(home)).toEqual([gen.split('/').at(-1)]);
    // The stamp names what the builder DECLARES and what the probe IS, both
    // read out of the placed builder rather than typed here.
    const builder = read(join(home, '.local', 'bin', 'ccgpt-runtime'));
    const requirement = /^LITELLM_REQUIREMENT='([^']+)'/m.exec(builder)?.[1];
    expect(requirement, 'ccgpt-runtime declares no LITELLM_REQUIREMENT').toBeDefined();
    const probe = spawnSync(join(home, '.local', 'bin', 'ccgpt-runtime'), ['probe-source'],
      { env: { ...process.env, HOME: home } });
    expect(probe.status).toBe(0);
    const stamp = JSON.parse(read(join(gen, '.ccrc-runtime.json'))) as Record<string, unknown>;
    expect(stamp['requirement']).toBe(requirement);
    expect(stamp['probeSha256']).toBe(createHash('sha256').update(probe.stdout).digest('hex'));
    expect(stamp['litellm']).toBe('1.101.0');
    // Ruling R33 against the REAL builder: the building line names the
    // requirement the placed builder declares (the step reads that same line),
    // and comes before the result line.
    const out = r.stdout.split('\n');
    const buildingAt = out.indexOf(`install: codex runtime: building ${requirement!} — pip may take minutes`);
    const builtAt = out.findIndex((l) => /^install: codex runtime: gen-\S+ built, probed and current /.test(l));
    expect(buildingAt, r.stdout).toBeGreaterThan(-1);
    expect(builtAt).toBeGreaterThan(buildingAt);
    const built = venvCalls(home).length;
    expect(built).toBe(1);

    const again = runInstall(home);
    expect(again.stdout).toMatch(/^install: codex runtime: gen-\S+ already current \(requirement, probe and litellm version re-measured unchanged\) for 1 codex lane\(s\)$/m);
    expect(venvCalls(home)).toHaveLength(built);
    expect(runtimePython(home)).toBe(py);
    // AN EXPLICIT BOUND (final review F4, Task 10 residue C3): two install spines plus doctorCode's.
    // Measured alone (one file, `-t`): 7.4 s at load average 12 (2026-09-28); its sibling below timed
    // out once at the 20 s default under load 40-80 (Task 10's gate).
  }, 60_000);

  it('a runtime whose probe FAILS degrades the install, never fails it, and the previous runtime stays current', async () => {
    const home = codexBox('ccrc-codex-steps-probe-fails-', await freeLanes(['codex-a']));
    const first = runInstall(home);
    expect(first.stdout, first.stderr).toMatch(/^install: codex runtime: \S+ built, probed and current/m);
    const before = runtimePython(home);
    const gensBefore = generations(home);
    // A new litellm under the old generation (`check` answers `mutated`),
    // and a verdict that fails a gate the spec names.
    writeRuntimeFixture(home, { verdict: 'fail:tool-survives', version: '1.101.1' });
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), 'a failed runtime build must not stop the spine').toBe(true);
    expect(r.stderr).toMatch(/^ccgpt-runtime: build failed at probe: /m);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — ccgpt-runtime build exited \d+ .*the previous runtime gen-\S+ stays current/m);
    expect(r.stdout).toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bcodex-runtime\b[^)]*\)$/m);
    expect(r.code).toBe(doctorCode(home));
    expect(runtimePython(home)).toBe(before);
    expect(generations(home)).toEqual(gensBefore);
    // AN EXPLICIT BOUND (final review F4, Task 10 residue C3): two install spines plus doctorCode's.
    // Measured alone (one file, `-t`): 7.7 s at load average 12 (2026-09-28), 8.7 s at load 30 (the
    // final review), about 12 s at load 40-80, where it timed out once at the 20 s default (Task 10).
  }, 60_000);

  it('the stock venv python, which answers nothing, fails the probe: degraded, and no generation is left behind', async () => {
    // m-spine H5 at the spine: a runtime python that exits 0 for every argv
    // must never become current. `template: false` leaves the stub's vacuous
    // python in place.
    const home = codexBox('ccrc-codex-steps-vacuous-', await freeLanes(['codex-a']), { template: false });
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stderr).toMatch(/^ccgpt-runtime: build failed at probe: /m);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — .*there is no runtime at all/m);
    expect(r.stdout).toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bcodex-runtime\b[^)]*\)$/m);
    expect(existsSync(join(runtimeDir(home), 'current'))).toBe(false);
    expect(generations(home)).toEqual([]);
  });
});

// PLATFORM-ONLY: the restart path measured here is the user-manager arm, whose
// fake is Task 4's `plantSystemd`; on Darwin `_svc_have_user_manager` is always
// false, the nohup arm is taken, and that arm is Task 5's subject.
describeLinux('ccrc install: the codex tier restart step on a real spine (Plan 2b-2 Task 10)', () => {
  const homes: string[] = [];
  // `killLaneProcesses` first runs the registered product stop while fixture
  // state exists, then ends every current-run child Task 4's fixture tracked.
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });

  /** codex-a RUNNING through the fake user manager: first install (builds the
   *  runtime from the passing template), then `startLane` (registry,
   *  credential, rendered config, `ccrc codex start`). Clears both recordings
   *  so the NEXT install's calls are all they hold. */
  async function runningLane(prefix: string): Promise<{
    home: string; lane: LanePorts; units: { litellm: string; shim: string }; py: string;
  }> {
    const [lane] = await freeLanes(['codex-a']);
    const home = codexBox(prefix, [lane!], { systemd: true });
    homes.push(home);
    const first = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), `the first install did not complete:\n${first.stdout}\n${first.stderr}`).toBe(true);
    expect(existsSync(join(home, '.local', 'bin', '.codex-systemctl')),
      'plantSystemd did not plant into ~/.local/bin, so no spine harness can adopt it (Task 10 Interfaces)').toBe(true);
    const s = startLane(home, 'codex-a');
    expect(s.code, `ccrc codex start codex-a:\n${s.stdout}\n${s.stderr}`).toBe(0);
    const units = laneUnits(home, 'codex-a');
    // The lane really took the user-manager arm: both tiers went through the recorder.
    expect(spineRunCalls(home).filter((l) => l.includes(`--unit=${units.litellm}`) || l.includes(`--unit=${units.shim}`)))
      .toHaveLength(2);
    const ans = await laneAnswer(lane!.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    expect(await portAccepts(lane!.litellmPort)).toBe(true);
    rmSync(join(home, 'manager-calls'), { force: true });
    rmSync(join(home, 'spine-systemd-run-calls'), { force: true });
    return { home, lane: lane!, units, py: runtimePython(home) };
  }

  it('a running shim whose code this install replaced is stopped, then started from the resolved generation; the litellm tier it did not replace is untouched', async () => {
    const { home, lane, units, py } = await runningLane('ccrc-codex-tiers-shim-');
    const litellmBefore = read(join(laneDir(home, 'codex-a'), 'litellm.started'));
    appendFileSync(treeFile(home, 'ccd/ccgpt-proxy.py'), '\n# fixture: the next release of the shim\n');
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stdout).toMatch(/^install: codex runtime: \S+ already current /m);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — /m);
    expect(r.stdout).not.toMatch(/^install: codex tiers: codex-a litellm: restarted/m);
    expect(r.stdout).toMatch(/^install: codex tiers: 1 codex lane\(s\) — 1 restarted, 1 left as they were, 0 not restarted$/m);
    const runs = spineRunCalls(home);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain(`--unit=${units.shim}`);
    expect(runs[0]).toContain(`${py} -I ${join(home, '.local', 'bin', 'ccgpt-proxy.py')}`);
    expect(runs[0]).not.toContain('/current/');
    expect(runs[0]).not.toMatch(/sk-[0-9a-f]{48}|MASTER_KEY/);
    const mc = managerCalls(home);
    const stopAt = mc.findIndex((l) => /^systemctl --user stop\b/.test(l) && l.includes(units.shim));
    const runAt = mc.findIndex((l) => l.startsWith('systemd-run ') && l.includes(`--unit=${units.shim}`));
    expect(stopAt, mc.join('\n')).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(stopAt);
    expect(stateChanges(home).filter((l) => l.includes(units.litellm))).toEqual([]);
    expect(mc.filter((l) => /^systemctl --user restart\b/.test(l) && l.includes('ccgpt-'))).toEqual([]);
    expect(read(join(laneDir(home, 'codex-a'), 'litellm.started'))).toBe(litellmBefore);
    const shimStarted = JSON.parse(read(join(laneDir(home, 'codex-a'), 'shim.started'))) as { code?: string };
    expect(shimStarted.code).toBe(createHash('sha256')
      .update(readFileSync(join(home, '.local', 'bin', 'ccgpt-proxy.py'))).digest('hex'));
    const ans = await laneAnswer(lane.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
  }, 180_000);

  it('a rebuilt runtime restarts both tiers onto the NEW generation, because the build runs before the restart step', async () => {
    const { home, lane, units, py: oldPy } = await runningLane('ccrc-codex-tiers-rebuild-');
    writeRuntimeFixture(home, { version: '1.101.1' });   // the running generation now measures `mutated`
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stdout).toMatch(/^install: codex runtime: \S+ built, probed and current for 1 codex lane\(s\)$/m);
    const py = runtimePython(home);
    expect(py).not.toBe(oldPy);
    for (const tier of ['litellm', 'shim'] as const) {
      expect(r.stdout).toMatch(new RegExp(`^install: codex tiers: codex-a ${tier}: restarted — `, 'm'));
      const run = spineRunCalls(home).find((l) => l.includes(`--unit=${units[tier]}`));
      expect(run, `${tier} was not started again`).toBeDefined();
      expect(run!).toContain(py);
      const started = JSON.parse(read(join(laneDir(home, 'codex-a'), `${tier}.started`))) as { generation?: string };
      expect(started.generation).toBe(py.replace(/\/bin\/python$/, ''));
    }
    const ans = await laneAnswer(lane.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    expect(await portAccepts(lane.litellmPort)).toBe(true);
  }, 180_000);

  it('a rostered lane with no tier running is left lazy: nothing is stopped, started or listening', async () => {
    // This lane was never materialised: no `~/.ccrc/codex/codex-a/` exists
    // when the step takes its lock. So this case is ALSO the spine-level pin of
    // one behaviour of Task 5's `_codex_lock` (Interfaces): a lane with no
    // directory yet can be locked, because the lock creates it. If it cannot,
    // the step's `NOT measured — its lane lock could not be taken` line
    // appears here and the summary counts 2 not restarted.
    const [lane] = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-tiers-lazy-', [lane!], { systemd: true });
    homes.push(home);
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stderr).not.toMatch(/its lane lock could not be taken/);
    expect(r.stdout).toMatch(/^install: codex tiers: 1 codex lane\(s\) — 0 restarted, 0 left as they were, 0 not restarted$/m);
    expect(stateChanges(home)).toEqual([]);
    expect(await portAccepts(lane!.proxyPort)).toBe(false);
    expect(await portAccepts(lane!.litellmPort)).toBe(false);
  }, 120_000);

  it('a foreign listener on the shim port is left running, and the transcript says so', async () => {
    // The OTHER repository's shim shape on this lane's shim port: `text/plain`
    // with the bare id (m-tiers §1), Task 4's `spawnListener` — which resolves
    // only once it has bound.
    const [lane] = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-tiers-foreign-', [lane!], { systemd: true });
    homes.push(home);
    const foreign = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: lane!.proxyPort });
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    // Review A2: the REAL `_codex_foreign_what` sentence, end to end.
    expect(r.stdout).toMatch(new RegExp(`^install: codex tiers: codex-a shim: left alone — port ${lane!.proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed, and this step never stops`, 'm'));
    expect(stateChanges(home)).toEqual([]);
    expect(() => process.kill(foreign.pid, 0)).not.toThrow();
    expect(await portAccepts(lane!.proxyPort)).toBe(true);
  }, 120_000);

  it('a restart the user manager refuses is its own FAILED line, and the closing line names codex-tiers', async () => {
    const { home, lane, units } = await runningLane('ccrc-codex-tiers-refused-');
    appendFileSync(treeFile(home, 'ccd/ccgpt-proxy.py'), '\n# fixture: the next release of the shim\n');
    writeFileSync(join(home, 'fixture-systemd-run-fail'), `${units.shim}\n`);
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), 'a failed tier restart must not stop the spine').toBe(true);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it was stopped and would not start again/m);
    expect(r.stdout).not.toMatch(/^install: codex tiers: codex-a shim: restarted/m);
    expect(r.stdout).toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bcodex-tiers\b[^)]*\)$/m);
    expect(r.code).toBe(doctorCode(home));
    expect(await laneAnswer(lane.proxyPort)).toBeNull();
  }, 180_000);
});

describeLinux('ccrc install: the codex usage converge on a real spine (Plan 3a Task 6)', () => {
  it('one usage timer per codex lane and none for an external lane; a re-run arms the same one again and nothing else', async () => {
    const lanes = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-usage-spine-', lanes);
    // `ext-a`: the live lanes' shape (exec.kind external, telemetry codex), a fixture id.
    codexRoster(home, lanes, [{ id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
      exec: { kind: 'external', provider: 'openai' }, homeAble: false, telemetry: 'codex' }]);
    const usage = (): string[] => systemctlCalls(home).map((c) => c.argv).filter((a) => a.includes('usage@'));
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), `${r.stdout}\n${r.stderr}`).toBe(true);
    expect(usage()).toEqual(['--user enable --now ccrc-codex-usage@codex-a.timer']);
    expect(lstatSync(unitDir(home, 'timers.target.wants', 'ccrc-codex-usage@codex-a.timer')).isSymbolicLink()).toBe(true);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-a; withheld from no lane; withdrawn from no lane$/m);
    expect(r.code).toBe(doctorCode(home));
    runInstall(home);
    expect(usage(), 'a re-run did more than re-arm the same timer').toEqual([
      '--user enable --now ccrc-codex-usage@codex-a.timer', '--user enable --now ccrc-codex-usage@codex-a.timer']);
  }, 60_000);
});

describeLinux('ccrc install: a timer systemd refuses is a COUNTED degraded step (Plan 3a Task 6; 2b-2 carry-forward 10)', () => {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** The names the closing line gives, split on the `,` cmd_install joins with. */
  const degradedNamed = (stdout: string): string[] => {
    const m = /^install: done — converged with \d+ degraded steps? \(([^)]*)\)$/m.exec(stdout);
    return m === null ? [] : m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
  };

  it('every timer enable systemd refuses is NAMED in the closing line — derived from what the run asked, nine across both and fleet', () => {
    // Until Plan 3a nine refusals printed a remedy and appended nothing, so
    // the closing line said "every step above converged" over a timer that
    // never armed. The expected set is what THIS run asked systemd to enable,
    // never a list typed here, so a tenth timer is measured the day it lands.
    const seen = new Set<string>();
    for (const role of ['both', 'fleet'] as const) {
      const home = freshBox(`ccrc-install-timer-degrades-${role}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'agent.env'),
        'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
      writeFileSync(join(home, 'fixture-enable-fail-timers'), '');
      const r = runInstall(home, ['install', '--role', role]);
      expect(r.code, `--role ${role}: a refused timer failed the install\n${r.stderr}`).toBe(0);
      const asked = [...new Set(systemctlCalls(home)
        .map((c) => /^--user enable --now (\S+\.timer)$/.exec(c.argv)?.[1])
        .filter((u): u is string => u !== undefined && u !== 'ccd-cap-scopes.timer'))].sort();
      expect(asked.length, `--role ${role}: the run asked for too few timer enables — this harness has gone stale`)
        .toBeGreaterThanOrEqual(7);
      expect(degradedNamed(r.stdout).filter((n) => n.endsWith('.timer')).sort(),
        `--role ${role}: the closing line does not name every timer systemd refused`).toEqual(asked);
      for (const u of asked) {
        expect(r.stderr, `--role ${role}: ${u}'s refusal carries no remedy line`)
          .toMatch(new RegExp(`^install: [a-z-]+: could not enable ${esc(u)} — run: systemctl --user enable --now ${esc(u)}$`, 'm'));
        seen.add(u);
      }
    }
    expect(seen.size, 'both roles together reach fewer degrading timer enables than the nine measured on main at 1f9fa22d')
      .toBeGreaterThanOrEqual(9);
  }, 60_000);

  it('every timer `_inst_enable` arms after ccd-cap-scopes goes through `_inst_enable_timer`, which counts its refusal', () => {
    const body = ccrcFunction('_inst_enable');
    const via = [...body.matchAll(/^ {2}\[ "\$INST_ROLE" !?= [a-z]+ \] \|\| _inst_enable_timer [a-z-]+ \S+\.timer$/gm)];
    expect(via.length, 'fewer helper-routed timer enables than the nine on main — the reader has gone stale, or a timer left the helper')
      .toBeGreaterThanOrEqual(9);
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /could not enable/.test(l)),
      'a timer in _inst_enable still degrades through its own echo, outside the helper that counts it').toEqual([]);
    expect(code.filter((l) => /systemctl --user enable --now [A-Za-z0-9@._-]+\.timer/.test(l)),
      'a literal timer enable in _inst_enable bypasses _inst_enable_timer').toEqual([]);
    expect(ccrcFunction('_inst_enable_timer'), 'the helper no longer counts the step it degrades')
      .toMatch(/^ {2}INST_DEGRADED\+=\("\$2"\)$/m);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 10 — the cutover REHEARSAL (spec §15 steps 1-3, in fixtures).
// Merging Plan 3a auto-releases and both boxes follow dev (D-3705), and by
// operator ruling Z (2026-10-01) the merge changes nothing on the live box.
// So these cases are the evidence that the rollout is a no-op on the fleet
// box's live SHAPE (`plantLiveShape`): every doctor check keeps its class,
// `models` included, and the external lane's hourly refresh does exactly what
// the base's did (Z1, Z7). They also show that an external lane cannot gain a
// codex registry (Z3), that once a flip makes one lane codex the external arm
// never runs the other repository's stop (Z4), that a flip made in Plan 3b's
// order converges, and that a flip back converges. The runbook's two steps
// that need a real LiteLLM (the refresh of a CODEX lane and the one publisher
// run) are stood in for by the files each leaves: the default suite has no
// real LiteLLM (Global Constraints), and Task 1's two-lane case and
// ccgpt-usage.test.ts own their behaviour.
// ════════════════════════════════════════════════════════════════════════

/** What the base tree did on the live shape, MEASURED by Task 10 Step 3 on a
 *  disposable copy of the plan's base and pasted here, never typed: both
 *  install passes' closing doctor, the two hourly refreshes
 *  (`liveShapeRefreshes`), and the doctor after them. The first case proves
 *  it is a measurement of this table that FAILs nothing.
 *
 *  MEASURED ON `1f9fa22d`, the plan's base and this branch's merge-base with
 *  `origin/main` (`$SCRATCH/t10-base`). It is a golden: nothing re-measures
 *  it, so a merge-up that moves a doctor check's class on the live shape reds
 *  the live-shape case until Step 3 is re-run on a disposable copy of the new
 *  base, never hand-edited (it held on the final fix wave's merge of
 *  `origin/main`). Plan 4's deletion of the external arm retires it, or
 *  re-measures it on that PR's own base: the hourly refresh it pins is that
 *  arm's. */
interface LiveShapeMeasure {
  install: Array<{ code: number; classes: Record<string, string> }>;
  refresh: RefreshObservation[];
  doctor: { code: number; classes: Record<string, string> };
}
const BASE_LIVE_SHAPE: LiveShapeMeasure = {
  "install": [
    {
      "code": 0,
      "classes": {
        "accounts": "PASS",
        "auth": "SKIP",
        "build": "PASS",
        "caddy": "SKIP",
        "caddyfile": "SKIP",
        "cert": "SKIP",
        "config": "PASS",
        "credentials": "SKIP",
        "disk": "PASS",
        "exposure": "SKIP",
        "fleet": "SKIP",
        "flock": "PASS",
        "gh": "PASS",
        "gh_auth": "PASS",
        "git": "PASS",
        "git_email": "PASS",
        "graphify": "PASS",
        "graphify-path": "PASS",
        "jq": "PASS",
        "jq_regex": "PASS",
        "linger": "PASS",
        "memory": "PASS",
        "models": "PASS",
        "name": "SKIP",
        "node": "PASS",
        "path": "PASS",
        "pool-sync": "WARN",
        "pools": "PASS",
        "provenance": "PASS",
        "python3": "PASS",
        "rc": "PASS",
        "routing": "PASS",
        "scopes": "SKIP",
        "services": "PASS",
        "skills": "PASS",
        "tmux": "PASS",
        "tmux_skew": "PASS",
        "update-exposure": "SKIP",
        "update-sync": "WARN",
        "wrappers": "PASS"
      }
    },
    {
      "code": 0,
      "classes": {
        "accounts": "PASS",
        "auth": "SKIP",
        "build": "PASS",
        "caddy": "SKIP",
        "caddyfile": "SKIP",
        "cert": "SKIP",
        "config": "PASS",
        "credentials": "SKIP",
        "disk": "PASS",
        "exposure": "SKIP",
        "fleet": "SKIP",
        "flock": "PASS",
        "gh": "PASS",
        "gh_auth": "PASS",
        "git": "PASS",
        "git_email": "PASS",
        "graphify": "PASS",
        "graphify-path": "PASS",
        "jq": "PASS",
        "jq_regex": "PASS",
        "linger": "PASS",
        "memory": "PASS",
        "models": "PASS",
        "name": "SKIP",
        "node": "PASS",
        "path": "PASS",
        "pool-sync": "WARN",
        "pools": "PASS",
        "provenance": "PASS",
        "python3": "PASS",
        "rc": "PASS",
        "routing": "PASS",
        "scopes": "SKIP",
        "services": "PASS",
        "skills": "PASS",
        "tmux": "PASS",
        "tmux_skew": "PASS",
        "update-exposure": "SKIP",
        "update-sync": "WARN",
        "wrappers": "PASS"
      }
    }
  ],
  "refresh": [
    {
      "status": 0,
      "rows": [
        {
          "id": "codex-a",
          "probe": "codex",
          "ok": true,
          "count": 2,
          "litellm": "rendered"
        }
      ],
      "probeCalls": [
        {
          "argv": "-",
          "env": {
            "CHATGPT_TOKEN_DIR": "~/.handoff/chatgpt-auth",
            "CODEX_CLIENT_VERSION": "0.160.0",
            "LITELLM_LOCAL_MODEL_COST_MAP": "<unset>",
            "CCRC_CODEX_PYTHON": "<unset>",
            "CCRC_PROBE_ACCOUNT": "<unset>",
            "CCRC_PROBE_PROG": "<unset>",
            "ANTHROPIC_AUTH_TOKEN": "<unset>",
            "ANTHROPIC_API_KEY": "<unset>",
            "OPENAI_API_KEY": "<unset>"
          }
        }
      ],
      "foreignChanged": {
        ".handoff/litellm-config.yaml": "file 600 sha256:ea41cda7ccf3b634777dacd386842ea606378ab794320a23883183e1d435f580",
        ".handoff/litellm-config.yaml.prev": "file 600 sha256:b4d856fc73bf7eb1c0bab47f52c8104d174231ff8d37633e947dd5c95a1a3ccc"
      },
      "ccgptCalls": []
    },
    {
      "status": 0,
      "rows": [
        {
          "id": "codex-a",
          "probe": "codex",
          "ok": true,
          "count": 2,
          "litellm": "rendered"
        }
      ],
      "probeCalls": [
        {
          "argv": "-",
          "env": {
            "CHATGPT_TOKEN_DIR": "~/.handoff/chatgpt-auth",
            "CODEX_CLIENT_VERSION": "0.160.0",
            "LITELLM_LOCAL_MODEL_COST_MAP": "<unset>",
            "CCRC_CODEX_PYTHON": "<unset>",
            "CCRC_PROBE_ACCOUNT": "<unset>",
            "CCRC_PROBE_PROG": "<unset>",
            "ANTHROPIC_AUTH_TOKEN": "<unset>",
            "ANTHROPIC_API_KEY": "<unset>",
            "OPENAI_API_KEY": "<unset>"
          }
        }
      ],
      "foreignChanged": {
        ".handoff/litellm-config.yaml": "file 600 sha256:ea41cda7ccf3b634777dacd386842ea606378ab794320a23883183e1d435f580"
      },
      "ccgptCalls": [
        "stop"
      ]
    }
  ],
  "doctor": {
    "code": 0,
    "classes": {
      "accounts": "PASS",
      "auth": "SKIP",
      "build": "PASS",
      "caddy": "SKIP",
      "caddyfile": "SKIP",
      "cert": "SKIP",
      "config": "PASS",
      "credentials": "SKIP",
      "disk": "PASS",
      "exposure": "SKIP",
      "fleet": "SKIP",
      "flock": "PASS",
      "gh": "PASS",
      "gh_auth": "PASS",
      "git": "PASS",
      "git_email": "PASS",
      "graphify": "PASS",
      "graphify-path": "PASS",
      "jq": "PASS",
      "jq_regex": "PASS",
      "linger": "PASS",
      "memory": "PASS",
      "models": "PASS",
      "name": "SKIP",
      "node": "PASS",
      "path": "PASS",
      "pool-sync": "WARN",
      "pools": "PASS",
      "provenance": "PASS",
      "python3": "PASS",
      "rc": "PASS",
      "routing": "PASS",
      "scopes": "SKIP",
      "services": "PASS",
      "skills": "PASS",
      "tmux": "PASS",
      "tmux_skew": "PASS",
      "update-exposure": "SKIP",
      "update-sync": "WARN",
      "wrappers": "PASS"
    }
  }
};
/** The base's map for a box that has installed and not yet refreshed: the
 *  update spine's pass, which the flip case starts from. */
const baseInstalled = (): Record<string, string> => BASE_LIVE_SHAPE.install[1]?.classes ?? {};
/** Ruling Z3's refusal code for `init codex` on a row that is not codex-kind,
 *  as Task 2 lands it in `deploy/models-op.mjs` (Step 0 counts it there). */
const INIT_EXTERNAL_REFUSAL = 'codex-registry-needs-codex-lane';
/** Task 4's class for lane state an id left behind when flipped back to
 *  `external` — kept by design (spec §13), so never a FAIL. */
const FLIP_BACK_LEFTOVER_CLASS = 'WARN';
/** Task 6's INST_DEGRADED word for a usage enable it withheld (Step 0 re-derives it). */
const USAGE_DEGRADED = 'codex-usage';
/** 3b step d's name for a launcher moved aside, `cmd_wrappers`' own backup
 *  shape: no id can contain a ".", so doctor never reads it as an account. */
const ASIDE = '.pre-ccrc-20260930T000000Z';
/** The extra env of every rehearsal run that can reach `_models_litellm`'s
 *  external arm, and of the live-shape runs Step 3 mirrors. `CCGPT_CONFIG` is
 *  the other repository's override of the box-global path, which
 *  `_models_litellm_path` honours, and a GPT-lane session can carry a real one,
 *  so it is dropped (an undefined value never reaches the child).
 *  `assertForeignFront` refuses an env that still has it. */
const REHEARSAL_ENV: NodeJS.ProcessEnv = { ...READY, CCGPT_CONFIG: undefined };
const epochS = (): number => Math.floor(Date.now() / 1000);
const without = <T>(o: Record<string, T>, keys: readonly string[]): Record<string, T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const argvOf = (home: string): string[] => systemctlCalls(home).map((c) => c.argv);
const usageEnables = (home: string): string[] =>
  argvOf(home).filter((a) => /^--user enable --now ccrc-codex-usage@/.test(a));
/** The one JSON object a `ccrc models` verb prints last on stdout, or `{}`. */
const lastJson = (stdout: string): { ok?: boolean; error?: string; detail?: string; [k: string]: unknown } => {
  try { return JSON.parse(stdout.trim().split('\n').pop() ?? '') as { ok?: boolean }; } catch { return {}; }
};
/** A publisher row in `ccd/ccgpt-usage.py`'s shape: both reset keys present, null included. */
const usageRow = (): string =>
  `${JSON.stringify({ five: null, seven: 12, ts: epochS(), fiveResetAt: null, sevenResetAt: null })}\n`;

/** A fresh FLEET box in the live shape. Its tree is stamped (`codexBox`'s
 *  reason: with no stamp `_inst_installed` writes no record), and its agent env
 *  is present so `--role fleet` never prompts. The runtime template is planted
 *  so that a later flip can build; with no codex lane it is never used. Step 3's
 *  MEASURE case builds its box with exactly these calls. */
function liveBox(prefix: string, opts: { systemd?: boolean } = {}): string {
  const home = freshBox(prefix);
  gitInit(treeRoot(home));
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'agent.env'),
    'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
  plantLiveShape(home, (argv) => runInstall(home, argv, REHEARSAL_ENV, { from: REPO_CCRC }));
  plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
  if (opts.systemd === true) plantSystemd(home, { userManager: true });
  return home;
}

describeLinux('Plan 3a Task 10 — the cutover rehearsal', () => {
  const homes: string[] = [];
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });

  interface Flip { lane: LanePorts; rosterBefore: string; aside: string }

  /** Plan 3b's per-lane steps c–h for the lane-1 analog, in the runbook's order. */
  async function flipCodexA(home: string): Promise<Flip> {
    const [lane] = await freeLanes(['codex-a']);
    const bin = join(home, '.local', 'bin');
    // c. the OPERATOR disables the other repository's flat timer: what
    //    `systemctl --user disable` removes. The fixture acts for the operator;
    //    ccrc never does (ruling R6).
    rmSync(unitDir(home, 'timers.target.wants', 'ccgpt-usage.timer'));
    // d. the launcher moves aside, as the link it is
    const aside = join(bin, `codex-a${ASIDE}`);
    renameSync(join(bin, 'codex-a'), aside);
    // e. the roster edit, its backup kept: kind codex, provider openai, a port
    //    pair, and the authDir the lane already uses (adoption by path, §9.2).
    //    From here the lane takes the codex path with no other act (ruling Z8).
    const rosterBefore = read(dotCcrc(home, 'accounts.json'));
    codexRoster(home, [lane!], [externalCodexRow('codex-b')]);
    expect(authDirOf(home, 'codex-a')).toBe(join(home, codexAuthDir('codex-a')));
    // f. wrappers; the refresh, stood in by the catalogue it leaves; litellm
    const w = runInstall(home, ['wrappers'], READY);
    expect(w.code, `ccrc wrappers:\n${w.stdout}\n${w.stderr}`).toBe(0);
    expect(verifyMarker(read(join(bin, 'codex-a'))), 'ccrc wrappers did not write codex-a').toBe('ccrc-unmodified');
    writeRehearsalCatalogue(home, 'codex-a', epochS());
    const lit = runInstall(home, ['models', 'litellm', 'codex-a'], READY, { from: REPO_CCRC });
    expect(lit.code, `ccrc models litellm codex-a:\n${lit.stdout}\n${lit.stderr}`).toBe(0);
    //    the usage enable: the spine's own converge (R-C10's targeted route is
    //    this by design), run the way the next auto-update runs it
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const inst = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(inst.stdout, `the converge did not complete:\n${inst.stderr}`).toMatch(/^install: done — /m);
    // g. start, the product stop registered first
    registerLaneCleanup(home, 'rehearsal:codex-a', () => {
      runInstall(home, ['codex', 'stop', 'codex-a'], READY, { from: REPO_CCRC });
    });
    const start = runInstall(home, ['codex', 'start', 'codex-a'], READY, { from: REPO_CCRC });
    expect(start.code, `ccrc codex start codex-a:\n${start.stdout}\n${start.stderr}`).toBe(0);
    // h. the one publisher run, stood in by the row it leaves
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-a.json'), usageRow());
    return { lane: lane!, rosterBefore, aside };
  }

  it('the base tree: BASE_LIVE_SHAPE is its measured answer — each doctor map names every check but codex and FAILs none, and the two hourly refreshes exercised both arms of the stop decision', () => {
    const table = doctorTable(join(REPO, 'ccd', 'ccrc-doctor-checks'));
    expect(table, 'Task 4 put codex in the table').toContain('codex');
    const want = table.filter((n) => n !== 'codex').sort();
    const maps = [...BASE_LIVE_SHAPE.install, BASE_LIVE_SHAPE.doctor];
    expect(maps.map((m) => m.code), 'BASE_LIVE_SHAPE is not Step 3\'s measurement — re-measure it on the plan\'s base')
      .toEqual([0, 0, 0]);
    for (const m of maps) {
      expect(Object.keys(m.classes).sort(),
        'BASE_LIVE_SHAPE is not Step 3\'s measurement of this table — re-measure it on the plan\'s base').toEqual(want);
      expect(Object.entries(m.classes).filter(([, c]) => c.includes('FAIL')),
        'the base tree FAILs a check on the live shape: the fixture is wrong, not the tree').toEqual([]);
    }
    expect(BASE_LIVE_SHAPE.refresh.map((o) => o.status), 'the base\'s hourly unit failed: the fixture is wrong')
      .toEqual([0, 0]);
    expect(BASE_LIVE_SHAPE.refresh.map((o) => o.ccgptCalls),
      'the second refresh did not owe the stop: the stand-in proxy is not what pgrep sees').toEqual([[], ['stop']]);
    for (const o of BASE_LIVE_SHAPE.refresh) {
      expect(o.probeCalls.map((c) => c.env['CHATGPT_TOKEN_DIR']),
        'the base did not probe the external lane through its default token directory').toEqual(['~/.handoff/chatgpt-auth']);
    }
  });

  it('live shape: two installs, both hourly refreshes, doctor and uninstall do exactly what the base did, and init codex on an external lane refuses (rulings Z1, Z3, Z7)', async () => {
    const home = liveBox('ccrc-rehearsal-live-');
    homes.push(home);
    const models = join(home, '.ccrc', 'models');
    const registryA = read(join(models, 'codex-a.classes.json'));
    const stopsAfterRefresh = BASE_LIVE_SHAPE.refresh.flatMap((o) => o.ccgptCalls).length;
    const contained = (stage: string, want: Record<string, ForeignEntry>, stops: number): void => {
      expect(stateCallsNaming(argvOf(home), /\bccgpt-/),
        `${stage}: a state-changing systemctl verb named a ccgpt- unit`).toEqual([]);
      expect(spineRunCalls(home).filter((l) => l.includes('--unit=ccgpt-')), `${stage}: a ccgpt- unit was started`)
        .toEqual([]);
      expect(foreignCcgptCalls(home), `${stage}: ccrc ran the other repository's launcher`).toHaveLength(stops);
      expect(foreignSnapshot(home), `${stage}: a foreign byte, mode or link changed`).toEqual(want);
      expect(read(join(models, 'codex-a.classes.json')),
        `${stage}: the external lane's existing registry was touched (ruling Z3)`).toBe(registryA);
    };
    const s0 = foreignSnapshot(home);
    // 1-2. install, then again: the second is the update's spine (ccd/ccrc:16183)
    expect(BASE_LIVE_SHAPE.install, 'Step 3 measured two install passes').toHaveLength(2);
    for (const [pass, base] of BASE_LIVE_SHAPE.install.entries()) {
      const stage = `install pass ${pass + 1}`;
      const r = runInstall(home, ['install', '--role', 'fleet'], REHEARSAL_ENV);
      expect(r.code, `${stage}:\n${r.stdout}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/^install: codex runtime: none — no codex lane in the roster$/m);
      expect(existsSync(runtimeDir(home)), `${stage}: a runtime was built`).toBe(false);
      expect(existsSync(join(home, '.ccrc', 'codex')), `${stage}: lane state was written`).toBe(false);
      expect(r.stdout.split('\n').filter((l) => l.startsWith('SKIP codex: ')), `${stage}: _check_codex`).toHaveLength(1);
      expect(doctorClasses(r.stdout), `${stage}: a check's class moved from the base's (ruling Z7)`)
        .toEqual({ ...base.classes, codex: 'SKIP' });
      for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
        expect(existsSync(unitDir(home, u)), `${stage}: --role fleet did not place ${u}`).toBe(true);
      }
      expect(usageEnables(home), `${stage}: an instance was enabled on a box with no codex lane`).toEqual([]);
      contained(stage, s0, 0);
    }
    // 3. the hourly refresh, twice, exactly as ccrc-models.service runs it: the
    //    external lane keeps the base's probe env, render and stop decision (Z1)
    const refresh = await liveShapeRefreshes(home, { ...ccrcEnv(home), ...REHEARSAL_ENV }, realPy());
    expect(refresh, 'the external lane\'s hourly refresh did not do what the base\'s did (ruling Z1)')
      .toEqual(BASE_LIVE_SHAPE.refresh);
    const s1 = foreignSnapshot(home);
    contained('the hourly refresh', s1, stopsAfterRefresh);
    // 4. doctor after the refreshes: every check keeps the base's class, models included (Z7)
    const d = runInstall(home, ['doctor'], REHEARSAL_ENV);
    expect(d.code, d.stdout).toBe(BASE_LIVE_SHAPE.doctor.code);
    expect(doctorClasses(d.stdout), 'doctor: a check\'s class moved from the base\'s (ruling Z7)')
      .toEqual({ ...BASE_LIVE_SHAPE.doctor.classes, codex: 'SKIP' });
    contained('doctor', s1, stopsAfterRefresh);
    // 5. ruling Z3: an external lane cannot gain a codex registry. The lane-2
    //    analog has none, and this is the wrong-lane hazard itself: on the base,
    //    this init succeeds, and the next hourly refresh probes that lane through
    //    the default token directory, which is lane 1's.
    const probes = foreignProbeCalls(home).length;
    const files = readdirSync(models).sort();
    const init = runInstall(home, ['models', 'codex-b', 'init', 'codex'], REHEARSAL_ENV, { from: REPO_CCRC });
    expect(init.code, `init codex on an external lane was not refused:\n${init.stdout}\n${init.stderr}`).not.toBe(0);
    const refusal = lastJson(init.stdout);
    expect(refusal, init.stdout).toMatchObject({ ok: false, error: INIT_EXTERNAL_REFUSAL });
    expect(refusal.detail ?? '', 'the refusal does not give ruling Z3\'s remedy').toMatch(/flip the lane to .?codex.? first/i);
    expect(readdirSync(models).sort(), 'the refused init wrote a file').toEqual(files);
    expect(foreignProbeCalls(home), 'the refused init ran the probe').toHaveLength(probes);
    contained('init codex on an external lane', s1, stopsAfterRefresh);
    // 6. uninstall
    const un = runInstall(home, ['uninstall']);
    expect(un.code, `${un.stdout}\n${un.stderr}`).toBe(0);
    contained('uninstall', s1, stopsAfterRefresh);
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `uninstall left ${u}`).toBe(false);
    }
  }, 300_000);

  it('ruling Z4: once a flip makes codex-a a codex lane, the external arm for a still-external lane with a registry refuses the stop it owes, writes nothing and runs no ccgpt; with nothing to stop it still renders', async () => {
    const home = liveBox('ccrc-rehearsal-z4-', { systemd: true });
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], REHEARSAL_ENV);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const f = await flipCodexA(home);
    // codex-b stays external and carries a registry made before ruling Z3's
    // guard existed (no `init codex` can make one now): the files a pre-3a
    // init and refresh leave. Its render is the box-global config.
    const models = join(home, '.ccrc', 'models');
    writeFileSync(join(models, 'codex-b.classes.json'), `${JSON.stringify(REHEARSAL_REGISTRY, null, 2)}\n`);
    writeRehearsalCatalogue(home, 'codex-b', epochS());
    const cfg = join(home, '.handoff', 'litellm-config.yaml');
    const planted = read(cfg);
    const calls0 = argvOf(home).length;
    assertForeignFront({ ...ccrcEnv(home), ...REHEARSAL_ENV }, home);
    // the box-global config differs from the render, and that repository's
    // proxy runs on it: the stop is owed, and a bare `ccgpt stop` would stop the
    // lane-1 units by name, which are now codex-a's own tiers
    const refused = await withForeignProxyRunning(home,
      () => runInstall(home, ['models', 'litellm', 'codex-b'], REHEARSAL_ENV, { from: REPO_CCRC }));
    expect(refused.code, `the external arm did not refuse:\n${refused.stdout}\n${refused.stderr}`).toBe(1);
    const body = lastJson(refused.stdout);
    expect(body, refused.stdout).toMatchObject({ ok: false, error: 'restart-failed' });
    expect(body.detail ?? '', 'the refusal does not name the codex lane as its reason').toContain('the roster names codex-kind lane(s) codex-a');
    expect(body.detail ?? '', 'the refusal sends the operator to the stop it refused').not.toMatch(/run 'ccgpt stop'/i);
    expect(foreignCcgptCalls(home), 'ccrc ran the other repository\'s stop while a codex lane exists (ruling Z4)')
      .toEqual([]);
    expect(read(cfg), 'the refusal wrote the box-global config').toBe(planted);
    expect(existsSync(`${cfg}.prev`), 'the refusal wrote a .prev').toBe(false);
    expect(stateCallsNaming(argvOf(home).slice(calls0), /\bccgpt-/), 'the refusal changed a ccgpt- unit').toEqual([]);
    const ans = await laneAnswer(f.lane.proxyPort);
    expect(JSON.parse(ans!.body), 'codex-a\'s own shim stopped answering').toEqual({ lane: 'codex-a' });
    // with nothing running on it there is nothing to stop, and the render lands
    // as it does today (ruling Z1: Z4 guards the stop, never the render)
    const rendered = runInstall(home, ['models', 'litellm', 'codex-b'], REHEARSAL_ENV, { from: REPO_CCRC });
    expect(rendered.code, `${rendered.stdout}\n${rendered.stderr}`).toBe(0);
    expect(lastJson(rendered.stdout)).toMatchObject({ ok: true, changed: true, restarted: false });
    expect(read(cfg), 'the render did not land').not.toBe(planted);
    expect(foreignCcgptCalls(home)).toEqual([]);
  }, 300_000);

  it('the flip, in Plan 3b\'s order: only codex-a\'s ccrc instance is enabled, codex-b and its foreign timer are untouched, and doctor answers PASS for the lane', async () => {
    const home = liveBox('ccrc-rehearsal-flip-', { systemd: true });
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const s0 = foreignSnapshot(home);
    const f = await flipCodexA(home);
    expect(usageEnables(home), 'the converge enabled the wrong instance set')
      .toEqual(['--user enable --now ccrc-codex-usage@codex-a.timer']);
    expect(stateCallsNaming(argvOf(home), /ccgpt-usage|ccgpt-codex-b-/), 'ccrc changed a unit that is not codex-a\'s own')
      .toEqual([]);
    const units = laneUnits(home, 'codex-a');
    expect(spineRunCalls(home).map((l) => /--unit=(\S+)/.exec(l)?.[1]).filter((u) => u?.startsWith('ccgpt-')).sort(),
      'a ccgpt- unit other than codex-a\'s two tiers was started').toEqual([units.litellm, units.shim].sort());
    const moved = ['.local/bin/codex-a', '.config/systemd/user/timers.target.wants/ccgpt-usage.timer'];
    expect(foreignSnapshot(home, moved), 'a foreign byte changed that no runbook step moves').toEqual(without(s0, moved));
    expect(lstatSync(f.aside).isSymbolicLink(), 'the launcher moved aside is no longer a link').toBe(true);
    expect(readlinkSync(f.aside)).toBe('ccgpt');
    expect(existsSync(join(home, 'foreign-ccgpt-calls')), 'ccrc ran the other repository\'s launcher').toBe(false);
    const ans = await laneAnswer(f.lane.proxyPort);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    const d = runInstall(home, ['doctor'], READY);
    expect(d.code, d.stdout).toBe(0);
    expect(doctorClasses(d.stdout), 'a check other than codex moved at the flip')
      .toEqual({ ...baseInstalled(), codex: 'PASS' });
    const codexLines = d.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)).join('\n');
    expect(codexLines).toMatch(/codex-a/);
    expect(codexLines, 'doctor measured an external lane as a codex lane').not.toMatch(/codex-b/);
  }, 300_000);

  it('the flip back — ccrc\'s stop first, the roster backup, the marked wrapper out, the old launcher back — converges: the instance is disabled, lane state is kept, and doctor flags only the leftover', async () => {
    const home = liveBox('ccrc-rehearsal-flipback-', { systemd: true });
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const s0 = foreignSnapshot(home);
    const tipLive = doctorClasses(i0.stdout);
    const f = await flipCodexA(home);
    const bin = join(home, '.local', 'bin');
    // 1. ccrc's own stop FIRST: the other repository's stop stops units by
    //    name, and ccrc's tiers carry those names (carry-forward, critic #7)
    const stop = runInstall(home, ['codex', 'stop', 'codex-a'], READY, { from: REPO_CCRC });
    expect(stop.code, `${stop.stdout}\n${stop.stderr}`).toBe(0);
    await eventually(async () => !(await portAccepts(f.lane.proxyPort)), 'codex-a\'s shim port to close');
    await eventually(async () => !(await portAccepts(f.lane.litellmPort)), 'codex-a\'s litellm port to close');
    // 2. the roster backup, byte for byte: from here the lane is on today's
    //    external path again, and no codex row is left for Z4's guard to see
    writeFileSync(dotCcrc(home, 'accounts.json'), f.rosterBefore);
    // 3. ccrc's wrapper out, marker-verified first, and the old launcher back, still a link
    const wrapper = join(bin, 'codex-a');
    expect(verifyMarker(read(wrapper)), 'the file at codex-a is not ccrc\'s unmodified wrapper').toBe('ccrc-unmodified');
    rmSync(wrapper);
    renameSync(f.aside, wrapper);
    // 4. the OPERATOR re-enables the other repository's flat timer
    symlinkSync(unitDir(home, 'ccgpt-usage.timer'), unitDir(home, 'timers.target.wants', 'ccgpt-usage.timer'));
    // 5. the converge the next install or auto-update runs
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const back = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(back.stdout, back.stderr).toMatch(/^install: done — /m);
    expect(argvOf(home).filter((a) => /^--user disable\b/.test(a) && a.includes('ccrc-codex-usage@codex-a.timer')),
      'the converge did not disable an instance whose lane is no longer codex').toHaveLength(1);
    expect(usageEnables(home)).toEqual([]);
    expect(stateCallsNaming(argvOf(home), /\bccgpt-/), 'the flip back changed a ccgpt- unit').toEqual([]);
    for (const kept of ['lane.json', 'litellm.yaml', 'runtime.env']) {
      expect(existsSync(join(laneDir(home, 'codex-a'), kept)), `lane state ${kept} was not kept (spec §13)`).toBe(true);
    }
    expect(foreignSnapshot(home), 'the flip back did not restore every foreign path').toEqual(s0);
    const d = runInstall(home, ['doctor'], READY);
    expect(doctorClasses(d.stdout), 'a check other than codex moved at the flip back')
      .toEqual({ ...tipLive, codex: FLIP_BACK_LEFTOVER_CLASS });
    const codexLines = d.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)).join('\n');
    expect(codexLines).toMatch(/codex-a/);
    expect(codexLines).toMatch(/^WARN codex: lane state is left under \S+\/\.ccrc\/codex\/codex-a, and 'codex-a' is not a Codex lane in /m);
  }, 300_000);

  it('out of order: a flip made while the other repository\'s instance timer for that lane is still enabled withholds ccrc\'s enable, and doctor names the operator\'s own disable (ruling R6)', async () => {
    const home = liveBox('ccrc-rehearsal-second-writer-');
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const s0 = foreignSnapshot(home);
    const [lane] = await freeLanes(['codex-b']);
    const bin = join(home, '.local', 'bin');
    // step c (the operator's disable of ccgpt-usage@codex-b.timer) is SKIPPED
    renameSync(join(bin, 'codex-b'), join(bin, `codex-b${ASIDE}`));
    codexRoster(home, [lane!], [externalCodexRow('codex-a')]);
    // the lane has no registry: 3b's `init codex` after the flip (ruling Z3
    // forces that order) and its refresh, stood in by the files they leave
    writeFileSync(join(home, '.ccrc', 'models', 'codex-b.classes.json'), `${JSON.stringify(REHEARSAL_REGISTRY, null, 2)}\n`);
    writeRehearsalCatalogue(home, 'codex-b', epochS());
    const m = runInstall(home, ['models', 'codex-b', 'set-subagent', 'sonnet'], READY, { from: REPO_CCRC });
    expect(m.code, `${m.stdout}\n${m.stderr}`).toBe(0);
    expect(runInstall(home, ['wrappers'], READY).code).toBe(0);
    expect(runInstall(home, ['models', 'litellm', 'codex-b'], READY, { from: REPO_CCRC }).code).toBe(0);
    // the other repository's publisher is still writing this lane's row
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-b.json'), usageRow());
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const inst = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(inst.stdout, inst.stderr).toMatch(/^install: done — /m);
    expect(usageEnables(home), 'ccrc enabled a second writer over one limits row').toEqual([]);
    expect(stateCallsNaming(argvOf(home), /\bccgpt-usage/), 'ccrc touched the other repository\'s timer').toEqual([]);
    expect(inst.stdout).toMatch(new RegExp(
      `^install: done — converged with \\d+ degraded steps? \\([^)]*\\b${USAGE_DEGRADED}\\b[^)]*\\)$`, 'm'));
    expect(foreignSnapshot(home, ['.local/bin/codex-b'])).toEqual(without(s0, ['.local/bin/codex-b']));
    const d = runInstall(home, ['doctor'], READY);
    const lines = d.stdout.split('\n');
    const w = lines.findIndex((l) => l.startsWith('WARN codex: ') && l.includes('ccgpt-usage@codex-b.timer'));
    expect(w, d.stdout).toBeGreaterThan(-1);
    expect(lines[w + 1]).toMatch(/^ {2}remedy: .*systemctl --user disable --now ccgpt-usage@codex-b\.timer/);
    // the operator's disable; then the converge enables ccrc's instance and the WARN is gone
    rmSync(unitDir(home, 'timers.target.wants', 'ccgpt-usage@codex-b.timer'));
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const again = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(usageEnables(home)).toEqual(['--user enable --now ccrc-codex-usage@codex-b.timer']);
    expect(again.stdout, 'the second-writer finding outlived the operator\'s disable').not.toMatch(/ccgpt-usage@codex-b\.timer/);
  }, 240_000);
});

// Plan 3a final fix wave, MF-3: `assertForeignFront` is the wall every
// rehearsal run that can reach the external arm stands behind (a bare `ccgpt
// stop` on the fleet box stops a live lane's tiers by name), and until now
// only its green path ran. One case per refusal, plus the green control.
// Nothing here runs ccrc or anything a name resolves to: the guard asks
// `/bin/sh -c 'command -v …'` and reads one file. The decoys sit OUTSIDE the
// HOME, on PATH after `<home>/.local/bin`, so a missing name resolves to a
// file that is not this shape's; each is `exit 97` and is never run.
describe('Plan 3a final fix wave — assertForeignFront refuses every front it was written to refuse (MF-3)', () => {
  /** The two names the guard asks about, planted as the live shape plants
   *  them: the recorder `ccgpt`, carrying FOREIGN_MARK, and `litellm` as a
   *  link to a stand-in install inside the HOME. */
  function front(): { home: string; decoy: string; env: NodeJS.ProcessEnv } {
    const home = mkTmp('ccrc-front-');
    const decoy = mkTmp('ccrc-front-decoy-');
    const bin = join(home, '.local', 'bin');
    const lit = join(home, '.local', 'share', 'foreign-litellm', 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(lit, { recursive: true });
    writeFileSync(join(bin, 'ccgpt'), `#!/bin/sh\n${FOREIGN_MARK}\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(lit, 'litellm'), `#!/bin/sh\n${FOREIGN_MARK}\nexit 97\n`, { mode: 0o755 });
    symlinkSync(join(lit, 'litellm'), join(bin, 'litellm'));
    for (const n of ['ccgpt', 'litellm']) writeFileSync(join(decoy, n), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    return { home, decoy, env: { PATH: `${bin}:${decoy}:/usr/bin:/bin`, HOME: home } };
  }

  it('control: the live shape\'s front, with no CCGPT_CONFIG, passes', () => {
    const { home, env } = front();
    expect(() => assertForeignFront(env, home)).not.toThrow();
  });

  it('refuses an env that still carries CCGPT_CONFIG, whatever the names resolve to', () => {
    const { home, env } = front();
    expect(() => assertForeignFront({ ...env, CCGPT_CONFIG: join(home, 'x.yaml') }, home)).toThrow(/CCGPT_CONFIG is set/);
  });

  it('refuses a ccgpt that resolves outside <home>/.local/bin, naming where it resolved', () => {
    const { home, env } = front();
    rmSync(join(home, '.local', 'bin', 'ccgpt'));
    expect(() => assertForeignFront(env, home)).toThrow(/ccgpt resolved to .*decoy/);
  });

  it('refuses a <home>/.local/bin/ccgpt that is not this shape\'s recorder', () => {
    const { home, env } = front();
    writeFileSync(join(home, '.local', 'bin', 'ccgpt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect(() => assertForeignFront(env, home)).toThrow(/not this shape's recorder/);
  });

  it('refuses a litellm that resolves outside <home>/.local/bin, naming where it resolved', () => {
    const { home, env } = front();
    rmSync(join(home, '.local', 'bin', 'litellm'));
    expect(() => assertForeignFront(env, home)).toThrow(/litellm resolved to .*decoy/);
  });
});
