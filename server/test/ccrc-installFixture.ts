// SHARED FIXTURE for the ccrc-install-*.test.ts family (D-6767): the one-file suite was split by describe
// block so no worker holds one file for ten minutes. Every helper below is the original, moved unchanged
// and exported; the header that follows is the original file header.
//
// `ccrc install` — the verb that converges a single box from the shipped tree.
// Stage 2d Task 6 builds its SPINE and the three SEEDING steps
// (`_inst_roster`, `_inst_accounts_sh`, `_inst_env`); Tasks 7-9 add the tree
// copy, the executables and stamp, the units, hooks and wrappers, and the
// doctor tail. This file grows with them, which is why the fixture below is a
// tree rather than a pair of files.
//
// ── WHY THE FIXTURE IS A COPIED TREE, NOT SYMLINKS ────────────────────────
// `ccrc-doctorFixture.ts` installs `ccrc` into its fixture as SYMLINKS at
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
//   - `skillBox` — 'ccrc install: all four skills reach every rostered
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
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import * as pty from 'node-pty';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync, readdirSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkTmp } from './tmpHelpers.js';
import { FIXTURE_DF_INODES_LINES } from './fixtureDfInodes.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { CONTAINED_TOOLS, assertNoRealTool } from './containedTools.js';
import { describeDarwin, python3ProgramArm } from './platformFixtures.js';
import { PKG_DESCRIPTION, skillMd } from './graphifySkillFixture.js';
import { installFixtureTree, rsyncRecorder } from './installTreeFixture.js';
import { FLEET_TOKEN_FILE_COMMENT } from '../../shared/box-token.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import { plantFakeRuntime, codexRoster, plantSystemd, killLaneProcesses, adoptPlantedSystemd, assertSpineFrontContained, spineSystemctlArms, spineSystemdRun, managerCalls, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls, ccrcFunction, ccrcLine, recordingStub, lockStub, plantLaneAuth, plantLaneConfig, fakeLitellmSource, registerLaneCleanup, GPT_LANE_BINS, REHEARSAL_REGISTRY, writeRehearsalCatalogue, doctorClasses, type StubRc, type LanePorts } from './codexLaneFixture.js';
import { docsProbeProgram } from './docsHelperPy.js';
import { DOCS_INDEX_READY } from './docsIndexFixtures.js';
import { wrapRealTool } from './wrapRealTool.js';

/** The two python3 invocations ccd's Docs front makes when the closing
 *  doctor's `docs` check runs the installed ccd (Docs W1a): the floor probe,
 *  read off the shipped ccd/ccd so it is never re-typed, and the ready line
 *  the doctor suite's own stub prints. The `python3` stub below embeds both
 *  in single quotes, so a quote or a newline in either is refused here,
 *  before a stub that parses differently is ever written. */
export const DOCS_PROBE = docsProbeProgram();

export const DOCS_READY_LINE = JSON.stringify(DOCS_INDEX_READY);

if (/['\n]/.test(DOCS_PROBE + DOCS_READY_LINE)) {
  throw new Error('the docs probe or the ready line holds a quote or a newline; the python3 stub cannot embed it');
}

export const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO = path.resolve(here, '..', '..');

/** Every file of the family, so a text pin that finds a case by its title searches them all (D-6767: a case's title no
 *  longer lives in the one file the pin runs from). */
export const INSTALL_FAMILY_FILES: string[] = ["tree","versioned","units","landing","role","codex"].map((p) => join(here, `ccrc-install-${p}.test.ts`));

/** The GPT lane's five as `_inst_bins`' closing line names them — FLANKED, so
 *  a longer sibling containing one never satisfies it — derived from the one
 *  test-side list rather than typed again (final review F4). */
export const LANE_BINS_IN_LINE = `(?<![\\w-])${GPT_LANE_BINS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(', ')}(?![\\w-])`;

/** `command -v <name>` under THIS process's real PATH. */
export function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}

/** bash's absolute path, resolved ONCE, for the same reason
 *  `ccrc-doctorFixture.ts#BASH` resolves it: libuv looks the executable up in the
 *  CHILD's environment, and one runner below hands the child a PATH with no
 *  system directory on it at all — spawning bare `bash` there is ENOENT, which
 *  surfaces as a spawn failure (`status === null`) rather than as anything the
 *  test is about. */
export const BASH = realPath('bash');

/** The real `rsync`, resolved once. Module scope, and a hard throw when the
 *  box has none, is the honest failure: `_inst_tree` REFUSES BY NAME without
 *  rsync, so a box that cannot run rsync cannot run `ccrc install` at all and
 *  there is no version of this suite that could still be measuring the verb. */
export const RSYNC = realPath('rsync');

/** The real `python3`, resolved once — NEVER the fixture's own stub (`plant`
 *  in this file's `ccrcEnv`, which answers only `-m venv <path>` and exits 90
 *  on anything else). Fix round 1 item 0(a) / batch B rereview N1's negative
 *  pin spawns this directly, bypassing the fixture PATH, so its parent argv
 *  is genuinely `python3 <path>/ccrc update`, not the fixture's poison. */
export const PYTHON3 = realPath('python3');

/** The box-token doctor check's two JSON readers (`_BT_PY_STATE`, `_BT_PY_FLEET` in `ccd/ccrc-doctor-checks`), read
 *  from the shipped file so the stub's `python3 -I -c` arm is an EXACT-text allow-list: those two programs, and only
 *  those, go to the real interpreter, because a refused `python3` makes them read `state-unreadable` and
 *  `sync-unreadable` (a FAIL once the arms are on). A third program, or an edited one, still reaches the refusal. */
export const BT_PY_ARM = ((): string => {
  const src = readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8');
  const progs = ['_BT_PY_STATE', '_BT_PY_FLEET'].map((n) => {
    const m = new RegExp(`^${n}='([^']*)'$`, 'm').exec(src);
    if (!m) throw new Error(`ccd/ccrc-doctor-checks no longer holds ${n}='…' in the shape this stub reads`);
    return `'${m[1]}'`;
  });
  return `if [ "$1" = "-I" ] && [ "$2" = "-c" ]; then case "$3" in ${progs.join('|')}) exec '${PYTHON3}' "$@" ;; esac; fi`;
})();

/** `<home>/checkout` — the shipped tree this box installs FROM. */
export const treeRoot = (home: string): string => join(home, 'checkout');

/** The `ccrc` a test runs: the one INSIDE the fixture tree, so `CCRC_HERE`
 *  resolves to the fixture's `ccd/` and every sibling it reaches is a fixture
 *  file. */
export const ccrcIn = (root: string): string => join(root, 'ccd', 'ccrc');

export const treeFile = (home: string, rel: string): string => join(treeRoot(home), rel);

/** `<home>/ccrc` — where `_inst_tree` PLACES the tree, and the layout the PATH
 *  shim, `_dr_pkg_candidates` and both deploy lanes already assume. */
export const placed = (home: string, ...rel: string[]): string => join(home, 'ccrc', ...rel);

/** The version directory `~/ccrc` points at (W6 Task 2), read from the link
 *  itself — since W6 `_inst_tree` places into `~/ccrc-versions/<name>/` and
 *  flips the link, so `placed()` reads through the link and this names the
 *  directory the verb really wrote (npm's cwd, rsync's destination). */
export const versionDir = (home: string, ...rel: string[]): string =>
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
 *  This is `ccrc-doctorFixture.ts`'s `healthy()`, adapted: the same stub shapes,
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
export function healthyDoctorBox(home: string, opts: { upstream?: boolean } = {}): void {
  const d = join(home, 'doctor-stubs');
  mkdirSync(d, { recursive: true });
  const stub = (name: string, body: string): void =>
    writeFileSync(join(d, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  // `gh auth status --hostname github.com`, answered with the shape a box
  // authenticated for the 'repo' scope really prints (ccrc-doctorFixture.ts's
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
    ...FIXTURE_DF_INODES_LINES,
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
  // without the real ~300 MB (ccrc-doctorFixture.ts's `writeBinary`).
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
export const FIXTURE_BINS = [...new Set(['gh', 'curl', 'journalctl', 'systemctl', 'loginctl', 'npm', 'rsync',
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
export function freshBox(prefix: string): string {
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
export function freshBoxNoUpstream(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  healthyDoctorBox(home, { upstream: false });
  return home;
}

export interface Result { code: number; stdout: string; stderr: string }

/** `ccrc-cli.test.ts#ccrcEnv`'s runner environment, and its reasoning applies
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
export const VACUOUS_RUNTIME_PYTHON = [
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

/** THE FIXTURE'S NODE DIRECTORY (see the call in `ccrcEnv`): `<home>/.fixture-node` holds node and npx (wrappers of
 *  the real ones, never links) and npm as a link to the `<home>/.local/bin/npm` stub, and goes right after
 *  `.local/bin` on `env.PATH` — so the directory `_node_select` puts first carries the stub, never the real npm.
 *  Every install harness with an npm stub calls this; one written without it runs the real npm. */
export function plantFixtureNodeDir(home: string, env: NodeJS.ProcessEnv): void {
  const fixtureBin = join(home, '.local', 'bin');
  const nodeDir = join(home, '.fixture-node');
  mkdirSync(nodeDir, { recursive: true });
  const onPath = (n: string): string | undefined => (env['PATH'] ?? '').split(':')
    .map((d) => join(d, n)).find((f) => existsSync(f));
  for (const n of ['node', 'npx']) {
    const real = onPath(n);
    if (real === undefined) continue;   // a box with no node: the verb's own probe says so
    wrapRealTool(real, join(nodeDir, n));
  }
  rmSync(join(nodeDir, 'npm'), { force: true });
  symlinkSync(join(fixtureBin, 'npm'), join(nodeDir, 'npm'));
  env['PATH'] = [fixtureBin, nodeDir, ...(env['PATH'] ?? '').split(':').filter((p) => p !== fixtureBin)].join(':');
}

export function ccrcEnv(home: string, omit: string[] = []): NodeJS.ProcessEnv {
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
  // ccrc asks — and, per `ccrc-doctorFixture.ts`'s stub discipline, exit 90 on
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
    // `fixture-draining` is an old job still in its graceful shutdown after
    // `bootout` returned: launchd refuses the bootstrap with 5 while it holds the
    // label, and the file's number is how many more `print`s still find it.
    '    if [ -f "$HOME/fixture-draining" ]; then',
    '      echo "Bootstrap failed: 5: Input/output error" >&2; exit 5',
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
    '    if [ -f "$HOME/fixture-draining" ]; then',
    '      IFS= read -r n < "$HOME/fixture-draining"',
    '      if [ "$n" -gt 0 ]; then echo "$((n - 1))" > "$HOME/fixture-draining"; echo "	state = stopping"; exit 0; fi',
    '      rm -f "$HOME/fixture-draining"; exit 113',
    '    fi',
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
    // Records whether the manager-PATH fragment was ALREADY on disk at each reload — "written before the reload" is
    // read here, at the moment of the call, never off the final tree.
    '  daemon-reload)',
    '    if [ -e "$HOME/.config/environment.d/50-ccrc-node.conf" ]; then echo present >> "$HOME/fixture-reload-saw-fragment"; else echo absent >> "$HOME/fixture-reload-saw-fragment"; fi',
    '    exit 0 ;;',
    // `_node_publish`'s probe for a user manager (ccd/ccrc-node): this box has one.
    '  show-environment) exit 0 ;;',
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
    // own (deploy.sh's `systemctl --user restart`), and the one that makes a re-run replace the
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
  // THE FIXTURE'S NODE DIRECTORY. `_node_select` (ccd/ccrc-node) puts the DIRECTORY of the node it chose first on
  // PATH, so the build runs on the node the units will; the real node's own directory holds the real `npm`, which
  // would then shadow the stub above. One fixture directory therefore holds all three names the library requires
  // — node and npx real, npm the stub — and sits right after `.local/bin`, so the chosen directory carries the
  // stub. (`pathWithout` builds its own PATH and its own npm link, for the same reason.)
  plantFixtureNodeDir(home, env);
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
  // python above. Either way the venv has a `lib/python3.12/site-packages`, as
  // a real one does, so the builder's `patch` stage (spec §22.2, D-4859) passes
  // and the probe is what answers. Nothing else changes: graphify's venv takes
  // the arm below.
  writeFileSync(join(home, 'fixture-vacuous-python'), VACUOUS_RUNTIME_PYTHON, { mode: 0o755 });
  plant('python3', [
    '#!/bin/sh',
    // The box-token doctor readers, ahead of the argv log (their program text is not an argv a case asserts on).
    BT_PY_ARM,
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
    '        mkdir -p "$3/bin" "$3/lib/python3.12/site-packages" && cp "$HOME/fixture-vacuous-python" "$3/bin/python" && chmod 755 "$3/bin/python" || exit 1',
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
    // ccd's Docs front, reached by the closing doctor's `docs` check through the
    // INSTALLED ccd (Docs W1a): the 3.8 floor probe passes, and the helper
    // prints the canned ready answer. Canned rather than forwarded to the real
    // python3, so the install stays hermetic and reads no projects root.
    `[ "$1" = -c ] && [ "$2" = '${DOCS_PROBE}' ] && exit 0`,
    `[ "$1" = /dev/fd/3 ] && [ "$2" = docs-index ] && { printf '%s\\n' '${DOCS_READY_LINE}'; exit 0; }`,
    // codex-bridge Stage 1, Task 8: `ccrc codex start` reads the lane's status
    // through the auth library (`_codex_auth`, `python3 -IS <lib> status …`).
    // That library, and ONLY at its installed path, goes to the REAL
    // interpreter; it is offline here because ghContainedEnv names
    // CLOSED_AUTH_BASE.
    `[ "$1" = -IS ] && [ "$2" = "$HOME/.local/bin/ccgpt-auth.py" ] && exec '${PYTHON3}' "$@"`,
    'echo "fixture python3: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT', 'CCRC_DOCTOR_DOCS_TIMEOUT', 'CCRC_VERSIONS_KEEP', 'CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP', 'CCRC_UPDATE_HEALTH_S', 'CCRC_UPDATE_DEADLINE_MS', 'CCRC_RELEASE_BASE_URL', 'CCRC_MODELS_ADVANCE_BUDGET_S', 'CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S']) delete env[k];
  // `verify-service.sh`'s own knobs, at the values its header says a test uses:
  // the production defaults sleep 3 + 5 seconds per call, and `_inst_enable`
  // makes one call per install. Zeroed here rather than per test, for the
  // reason `ccrc-doctorFixture.ts` zeroes `CCRC_DOCTOR_GH_TIMEOUT` in its own
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
export function replantDoctorStubs(home: string): void {
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
export function runInstall(home: string, args: string[] = ['install'],
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
export const SHA256_TOOL = process.platform === 'darwin' ? 'shasum' : 'sha256sum';

/** `ccrc version` through the launcher an install placed at
 *  `~/.local/bin/ccrc` — which runs the SHIPPED ccrc, so it is a runner like
 *  `runInstall` and gets the same containment (Task 11 review fix round 3,
 *  C1). Its two callers used to spawn it with `{ ...process.env, HOME }`, so
 *  both manager names resolved to the box's real binaries, and only
 *  `cmd_version` reading nothing but files kept that harmless. `ccrcEnv`
 *  fronts them, and the check refuses the env if it did not. */
export function runLauncherVersion(home: string): Result {
  // Wave 9 R10d: `ccrc-uninstall.test.ts`'s N2c pin wants `const r = ` on the line after the spine check (a literal
  // shape), so the real-tool check rides the spawn's own `env` argument: it still runs on the final env, before the spawn.
  const env = ccrcEnv(home);
  assertSpineFrontContained(env, home);
  const r = spawnSync(BASH, [join(home, '.local', 'bin', 'ccrc'), 'version'],
    { env: checkedEnv(env, home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `env`, after `assertNoRealTool` has passed on it (it throws otherwise) — for a spawn that checks inline. */
export function checkedEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  assertNoRealTool(env, home);
  return env;
}

/** The farm tools the runner plants a stub for in `.local/bin` (`ccrcEnv`): see `pathWithout`. */
const FARM_STUBBED = ['npm', 'rsync', 'python3'];

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
export function pathWithout(home: string, missing: string): string {
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
    'node', 'npx', 'git', 'npm', 'rsync', 'bash', 'sleep', 'jq', 'mktemp', 'basename',
    'diff', 'tmux', 'python3', 'flock', 'timeout', 'stat', 'grep', 'awk', 'realpath',
    'ln', 'readlink', SHA256_TOOL,
    // `head` (wave 17 R8f, D-5317): `_inst_stamp` reads the release tag as
    // `git tag --points-at HEAD | grep -E … | head -n1`, so a farm without it
    // stamps no `version` at all, without failing the install (only a `command
    // not found` line on stderr), in every case built on this list.
    'head',
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
    const stubbed = FARM_STUBBED.includes(b);
    if (stubbed) rmSync(join(d, b), { force: true });   // a dangling link reads as absent to existsSync
    if (b === missing || existsSync(join(d, b))) continue;
    // `_node_select` puts the directory of the node it chose — THIS farm — first on PATH, so a real tool linked here
    // would shadow the stub the runner plants in `.local/bin`. The stubbed names link to the stub instead (dangling
    // until the runner plants it; an `omit` removes it, which reads as absent, as it should).
    if (stubbed) symlinkSync(join(home, '.local', 'bin', b), join(d, b));   // a link to a FIXTURE file
    else wrapRealTool(realPath(b), join(d, b));
  }
  return `${join(home, '.local', 'bin')}:${d}`;
}

/** A stand-in nvm under `<home>/.nvm` (the library's no-env default): `nvm.sh` answers `nvm version default` with
 *  `def` (or `N/A`, rc 3) and RECORDS any `nvm install` to `<home>/nvm-install-calls` (then fails it, so nothing is
 *  ever installed). Each version has a node that prints its own version and otherwise runs the real node, an npm that
 *  runs the fixture's `.local/bin/npm`, and the real npx. Returns a function from a version to its bin directory. */
export function plantNvm(home: string, versions: string[], def?: string): (v: string) => string {
  const nvm = join(home, '.nvm');
  mkdirSync(nvm, { recursive: true });
  writeFileSync(join(nvm, 'nvm.sh'), [
    'nvm() {',
    '  case "$1" in',
    `    version) ${def ? `echo ${def}; return 0` : 'echo N/A; return 3'} ;;`,
    '    install) printf \'%s\\n\' "$*" >> "$HOME/nvm-install-calls"; return 1 ;;',
    '  esac',
    '}',
  ].join('\n') + '\n');
  const binOf = (v: string): string => join(nvm, 'versions', 'node', v, 'bin');
  for (const v of versions) {
    const d = binOf(v);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'node'), `#!/bin/sh\n[ "$1" = --version ] && { echo ${v}; exit 0; }\nexec ${realPath('node')} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(d, 'npm'), '#!/bin/sh\nexec "$HOME/.local/bin/npm" "$@"\n', { mode: 0o755 });
    wrapRealTool(realPath('npx'), join(d, 'npx'));
  }
  return binOf;
}

export const read = (p: string): string => readFileSync(p, 'utf8');

export const dotCcrc = (home: string, name: string): string => join(home, '.ccrc', name);

export const mtime = (p: string): number => statSync(p).mtimeMs;

/** Writes `~/.ccrc/<name>` before a run — how a test says "this box already
 *  had one of these". */
export function preexisting(home: string, name: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(dotCcrc(home, name), text);
}

/** Every directory an install step writes a temp sibling into. It is the list
 *  of destinations, not a guess: `_inst_atomic` stages beside its TARGET, so a
 *  step that installs into a directory absent from this list leaks strays no
 *  assertion here can see. `''` is `$HOME` itself, which `~/.tmux.conf` makes a
 *  destination directory. Task 8 adds `.config/systemd/user`. */
export const STRAY_DIRS = ['', '.ccrc', '.local/bin', '.cc-sessions', '.claude', 'ccrc',
  // Task 8: `_inst_units` stages six temp siblings across three directories,
  // and the third one's name carries systemd's `\x2d` escape — spelled here as
  // it is on disk, because a sweep that looked in the unescaped directory would
  // report "no strays" about a directory that does not exist.
  '.config/systemd/user',
  '.config/systemd/user/claude-session@.service.d',
  '.config/systemd/user/app-claude\\x2dsession.slice.d',
  // D-5241: the two scope drop-in directories `_inst_units` stages into.
  '.config/systemd/user/tmux-spawn-.scope.d',
  '.config/systemd/user/ccrc-tmux-server.scope.d',
  // `_inst_node` (via `_node_publish`) stages its links and the manager's PATH fragment through temp siblings.
  '.local/libexec/ccrc/node-bin', '.config/environment.d',
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
export const strays = (home: string): string[] => {
  const out: string[] = [];
  for (const rel of STRAY_DIRS) {
    const d = join(home, rel);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/\.tmp\./.test(f)) out.push(join(rel, f));
  }
  return out;
};

export const DEFAULT_SEED = read(join(REPO, 'deploy', 'accounts.default.json'));

/** The five-account test roster as file bytes — the "operator already has a
 *  roster" fixture. Serialised from `DEFAULT_TEST_ROSTER` (the root copy)
 *  rather than read from a shipped file: the shipped migration roster this
 *  used to read left the tree with the stage-5 de-brand (spec §5, D-202). */
export const FIVE_ACCOUNT_ROSTER = `${JSON.stringify(DEFAULT_TEST_ROSTER, null, 2)}\n`;

/** Turns a fixture tree into a REAL one-commit git repository, which is what
 *  `_inst_stamp` measures. A fake `.git` directory would not do: the step runs
 *  `git rev-parse HEAD` and `git diff --quiet`, so the fixture has to be
 *  something git itself answers for. Identity comes from the environment
 *  rather than `git config`, so a box whose user has no global identity (CI)
 *  still commits. */
export function gitInit(root: string): string {
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

// ── Task 8: the units, the enablement, and the box's last word ────────────

/** `~/.config/systemd/user/…` — the directory `systemd --user` searches and
 *  both deploy lanes copy into. Spelled here in TypeScript exactly once; the
 *  test at the end of the units describe is what keeps it, `ccrc`'s
 *  `BOX_UNIT_DIR` and the check table's `CCRC_UNIT_DIR` from drifting apart. */
export const unitDir = (home: string, ...rel: string[]): string =>
  join(home, '.config', 'systemd', 'user', ...rel);

/** systemd's escape of the `-` in the unit name `app-claude-session.slice`.
 *  The REPOSITORY directory is plainly named; the DESTINATION must be this or
 *  systemd never reads the drop-in (deploy.sh's `\x2d` escape note above `AGENT_BUILD_CMD`). In TypeScript the
 *  backslash is doubled; on disk the name carries the four literal characters
 *  `\x2d`, which is what the assertions below are about. */
export const SLICE_DIR = 'app-claude\\x2dsession.slice.d';

/** Every file `_inst_units` is supposed to leave in that directory, by the name
 *  it must have there, beside the tree path it must be a copy of. */
export const UNIT_FILES: Array<[string, string]> = [
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
  // history spec 2026-10-05 §9.5: the history sweep's pair, ROLE-GATED `!= server`
  // for its own reason — a server box hosts no sessions, so it keeps no store.
  ['ccd-history-sweep.service', 'deploy/systemd/ccd-history-sweep.service'],
  ['ccd-history-sweep.timer', 'deploy/systemd/ccd-history-sweep.timer'],
  // The pane-scope sweep: ROLE-GATED on the reaper's terms — a server box runs no pane scopes.
  ['ccd-scope-sweep.service', 'deploy/systemd/ccd-scope-sweep.service'],
  ['ccd-scope-sweep.timer', 'deploy/systemd/ccd-scope-sweep.timer'],
  // W4a Task 9 (design §11): the server-role watchdog's pair — ROLE-GATED the
  // OTHER way round from the pairs above: `_inst_units` places it on `server`
  // and `both` (this list's role) and never on `fleet`, whose node the
  // server's own deadline covers. The fleet describe asserts its absence.
  ['ccrc-update-watchdog.service', 'deploy/systemd/ccrc-update-watchdog.service'],
  ['ccrc-update-watchdog.timer', 'deploy/systemd/ccrc-update-watchdog.timer'],
  ['claude-session@.service.d/limits.conf', 'deploy/systemd/claude-session@.service.d/limits.conf'],
  [`${SLICE_DIR}/limits.conf`, 'deploy/systemd/app-claude-session.slice.d/limits.conf'],
  // D-5241: the victim policy's two OOMPolicy=continue scope drop-ins, every role, Linux only, beside the two above.
  ['tmux-spawn-.scope.d/50-oom-continue.conf', 'deploy/systemd/tmux-spawn-.scope.d/50-oom-continue.conf'],
  ['ccrc-tmux-server.scope.d/50-oom-continue.conf', 'deploy/systemd/ccrc-tmux-server.scope.d/50-oom-continue.conf'],
];

/** The runner's `systemctl` records one line per call: the argv, a tab, then
 *  every file that was under `~/.config/systemd/user` at that moment. The
 *  second field is what turns "the enables run after every unit file landed"
 *  into a measurement — see the stub's own comment. */
export const systemctlCalls = (home: string): Array<{ argv: string; onDisk: string[] }> => {
  const p = join(home, 'systemctl-calls');
  if (!existsSync(p)) return [];
  return read(p).split('\n').filter(Boolean).map((l) => {
    const [argv, have] = l.split('\t');
    return { argv: argv ?? '', onDisk: (have ?? '').split(',').filter(Boolean) };
  });
};

export const loginctlCalls = (home: string): string[] => {
  const p = join(home, 'loginctl-calls');
  return existsSync(p) ? read(p).split('\n').filter(Boolean) : [];
};

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
export const FLEET_URL = 'ws://203.0.113.7:7788';

export const FLEET_TOKEN = 'fixture-agent-token-8b1f2c4d';

/** `ccrc install --role fleet` on a REAL terminal — `ccrc-passwd.test.ts`'s
 *  pty idiom, for the same reason: `_inst_agent_env` is `[ -t 0 ]` plus a
 *  `read -rs`, so without a terminal the only reachable branch is the refusal.
 *  Entries are typed when their prompts appear (the URL prompt echoes; the
 *  token prompt must not). A pty merges the two streams into `stdout`. */
export function runInstallTty(home: string, args: string[], entries: string[]): Promise<Result> {
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

// ════════════════════════════════════════════════════════════════════════
// Plan 2b-2 Task 10 — `_inst_codex_runtime` and `_inst_codex_tiers`.
// Two instruments on purpose. The EXTRACTED function, its lane-library seams
// stubbed (the `_inst_installed` idiom above), is what binds each decision
// to a red. The REAL spine — real `ccgpt-runtime`, real library, real shim,
// the fake user manager — proves they compose.
// ════════════════════════════════════════════════════════════════════════
export const realPy = (): string => realPath('python3');

export const READY = { CCRC_CODEX_READY_S: '20' };

export const REPO_CCRC = join(REPO, 'ccd', 'ccrc');

export const runtimeDir = (home: string): string => join(home, '.ccrc', 'runtime', 'codex');

export const laneDir = (home: string, id: string): string => join(home, '.ccrc', 'codex', id);

export const generations = (home: string): string[] =>
  (existsSync(runtimeDir(home)) ? readdirSync(runtimeDir(home)).filter((n) => n.startsWith('gen-')).sort() : []);

export const venvCalls = (home: string): string[] =>
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
export const stateChanges = (home: string): string[] => managerCalls(home)
  .filter((l) => (/^systemctl --user (stop|start|restart|reset-failed|kill)\b/.test(l) && / ccgpt-/.test(l))
    || l.startsWith('systemd-run '));

export const doctorCode = (home: string): number => runInstall(home, ['doctor'], READY).code;

/** What `ccgpt-runtime python` answers — the instrument, never a realpath of `current`. */
export function runtimePython(home: string): string {
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
export function runtimeTemplatePython(fixtureDir: string, real: string): string {
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

export function writeRuntimeFixture(home: string, opts: { verdict?: string; version?: string; pipRc?: number }): void {
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

export function plantRuntimeTemplate(home: string, opts: { verdict: 'pass' | `fail:${string}`; version: string }): void {
  const f = join(home, 'fixture-runtime');
  const tpl = join(f, 'gen-template');
  mkdirSync(join(tpl, 'bin'), { recursive: true });
  // A real venv's site-packages: the builder's `patch` stage writes ccrc's
  // LiteLLM patch there before the probe (spec §22.2, D-4859).
  mkdirSync(join(tpl, 'lib', 'python3.12', 'site-packages'), { recursive: true });
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
export function codexBox(prefix: string, lanes: LanePorts[], opts: { template?: boolean; systemd?: boolean } = {}): string {
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
export function startLane(home: string, id: string): Result {
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

export interface StepRun {
  code: number; stdout: string; stderr: string; calls: string[]; degraded: string[];
  /** `CX_LOCK_FD` and `CX_LOCK_ID` after the step returned: empty unless a
   *  lane's lock was never released through `_codex_unlock`. */
  lockAfter: string;
}

export function runStepHarness(home: string, harness: string, callsFile = 'calls'): StepRun {
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
export const lanesFn = (lanes: string[], rc = 0): string => (rc === 0
  ? `_codex_lanes() { ${lanes.length === 0 ? ':' : `printf '%s\\n' ${lanes.join(' ')}`}; }`
  : `_codex_lanes() { echo "ccrc codex: roster-invalid: fixture: the roster could not be read" >&2; return ${rc}; }`);

export const DEGRADED_OUT = 'printf \'%s\\n\' ${INST_DEGRADED[@]+"${INST_DEGRADED[@]}"} > "$HOME/degraded"';

export const LOCK_AFTER_OUT = 'printf \'%s\\n\' "${CX_LOCK_FD:-}" "${CX_LOCK_ID:-}" > "$HOME/lock-after"';

/** Task 4's one-line definitions, read out of ccd/ccrc rather than re-typed. */
export const RUNTIME_CLI_DEF = (): string => ccrcLine(/^_codex_runtime_cli\(\) \{.*\}$/m, '_codex_runtime_cli');

export const CODEX_TIERS_DEF = (): string => ccrcLine(/^CODEX_TIERS=.*$/m, 'CODEX_TIERS=');

export const LANE_DIR_DEF = (): string => ccrcLine(/^_codex_lane_dir\(\) +\{.*\}$/m, '_codex_lane_dir');
/** `_codex_lane_mode`, stubbed by table (codex bridge Stage 2, Task 11): each id's word, `litellm` when unnamed, and
 *  `null` the refusal a lane.json naming no readable mode gets, in the real function's code and shape. */
export const modeStub = (modes: Readonly<Record<string, 'litellm' | 'direct' | null>>): string => [
  '_codex_lane_mode() {',
  '  case "${1:-}" in',
  ...Object.entries(modes).map(([id, m]) => (m === null
    ? `    ${id}) echo "ccrc codex: lane-mode-unreadable: fixture: ${id}'s lane.json names no bridge" >&2; return 1 ;;`
    : `    ${id}) printf '%s\\n' ${m} ;;`)),
  "    *) printf 'litellm\\n' ;;",
  '  esac',
  '}',
].join('\n');

/** The requirement the stub builder DECLARES, in the placed builder's own
 *  assignment shape. A fixture value, never the real one: the real-spine case
 *  reads the real one out of the placed `ccgpt-runtime`. */
export const FIXTURE_REQUIREMENT = 'fixture-requirement>=0';

/** `_inst_codex_runtime` alone, against a stub `ccgpt-runtime` whose `python`
 *  answers `before`, and `after` once a build exits 0. The stub declares
 *  `requirement` (default {@link FIXTURE_REQUIREMENT}; `null` plants no
 *  assignment line), and its `build` says `fixture ccgpt-runtime: build running`
 *  on stderr the moment it starts. `merge` runs the step with stderr joined to
 *  stdout, so the ORDER of the step's lines and the build's start is one
 *  measurement (ruling R33). */
export function runRuntimeStep(c: {
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
export function runTiersStep(c: {
  lanes?: string[]; lanesRc?: number; role?: 'both' | 'fleet' | 'server'; runtime?: boolean; readyS?: string;
  ours?: Record<string, StubRc>; stale?: Record<string, StubRc>;
  stopRc?: Record<string, StubRc>; startRc?: Record<string, StubRc>; lockRefuse?: string[]; lockNoFlock?: string[];
  stopForeign?: readonly string[];
  // Review round 2, N2: the WHY `_codex_tier_ours`'s fake sets right before
  // it answers 2, so the step's own `_codex_foreign_what` call (the real
  // function, unstubbed) resolves a real message from it, the same way the
  // shipped library would.
  oursWhy?: Readonly<Record<string, string>>;
  // Whole-wave fix round, D-6691: run the REAL `_inst_codex_runtime` first, in
  // the same shell, against a builder whose `build` fails while the previous
  // generation stays current — the spine's own order, so the tiers step reads
  // the `codex-runtime` that run put in INST_DEGRADED.
  runtimeBuildFails?: boolean;
  // Closing fix round, D-6691: `"<id> <tier>"` -> the generation directory's
  // name that the planted `<tier>.started` record names; the skip reads it.
  startedGen?: Readonly<Record<string, string>>;
  // Codex bridge Stage 2, Task 11: the lane's mode, per id, which the step reads
  // through `_codex_lane_mode` first (`litellm` when unnamed); `null` is a
  // lane.json that names no readable mode (rc 1, its refusal line).
  modes?: Readonly<Record<string, 'litellm' | 'direct' | null>>;
}): StepRun {
  const home = mkTmp('ccrc-codex-tiers-step-');
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  // A lane.json is THERE for a mode the stub refuses: one that is absent is a lane ccrc never started, asked mode-blind.
  for (const [id, m] of Object.entries(c.modes ?? {})) {
    if (m !== null) continue;
    mkdirSync(join(home, '.ccrc', 'codex', id), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'codex', id, 'lane.json'), '{"fixture": "no bridge"}\n');
  }
  for (const [key, gen] of Object.entries(c.startedGen ?? {})) {
    const [id, tier] = key.split(' ');
    mkdirSync(join(home, '.ccrc', 'codex', id), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'codex', id, `${tier}.started`),
      JSON.stringify({ generation: join(home, '.ccrc', 'runtime', 'codex', gen), code: 'f'.repeat(64) }) + '\n');
  }
  writeFileSync(join(home, '.local', 'bin', 'ccgpt-runtime'), [
    '#!/bin/sh',
    ...(c.runtimeBuildFails === true
      ? ['[ "$1" = build ] && { echo "ccgpt-runtime: build failed at probe: fixture refusal" >&2; exit 1; }'] : []),
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
    LANE_DIR_DEF(),
    modeStub(c.modes ?? {}),
    ccrcFunction('_codex_mode_tiers'),
    ccrcFunction('_codex_tier_is_other_mode'),
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
    ...(c.runtimeBuildFails === true ? [ccrcFunction('_inst_codex_runtime'), '_inst_codex_runtime'] : []),
    ccrcFunction('_inst_codex_tiers'),
    '_inst_codex_tiers; rc=$?',
    DEGRADED_OUT,
    LOCK_AFTER_OUT,
    'exit "$rc"',
  ].join('\n'));
}

/** `_inst_codex_usage` alone (Plan 3a Task 6). The converge, its six
 *  `_codex_usage_*` reads, `_codex_shape`, `_codex_say` and
 *  `_inst_enable_timer` come REAL out of ccd/ccrc; `_codex_lanes` is stubbed
 *  by `lanesFn`. `systemctl` is a bash FUNCTION: it shadows the isolation
 *  wall's binary, so every call the step makes lands in `$HOME/calls`, and a
 *  call made any other way still reaches the wall. It answers
 *  `enable --now` and `disable --now` as a manager does, by planting and
 *  removing the timer's `timers.target.wants` link, so the converge's own
 *  reads see its own acts. A unit listed in `refuse` is refused. A unit listed
 *  in `keepLink` (Plan 3b Task A2) is a disable the manager ANSWERS 0 while its
 *  link stays — the shape `ccrc-account.test.ts`'s C15 pins for account
 *  removal. `enabled`,
 *  `foreign` and `flatForeign` plant links before the step runs. `shape:
 *  false` (fix round 1) sources no `ccrc-wrapper-shape` and points
 *  `CCRC_HERE` at an empty directory, so `_codex_shape` cannot load the
 *  contract: the box whose tree lost the file. */
export function runUsageStep(c: {
  lanes?: string[]; lanesRc?: number; role?: 'both' | 'fleet' | 'server'; os?: 'linux' | 'darwin';
  enabled?: string[]; foreign?: string[]; flatForeign?: boolean; refuse?: string[]; keepLink?: string[]; shape?: boolean;
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
  writeFileSync(join(home, 'keeplink'), (c.keepLink ?? []).map((u) => `${u}\n`).join(''));
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
    '    disable) grep -qxF -- "$4" "$HOME/keeplink" || rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
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

// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 10 — what the cutover rehearsal still holds (spec §15 step 3,
// in fixtures). Plan 4 retired the rest with the external lane: the external
// live shape it measured (`BASE_LIVE_SHAPE`, `plantLiveShape`), that lane's
// hourly refresh and stop, `init codex` on an external lane (Z3, held by the
// models-op and ccrc-models cases), the flip back, and `assertForeignFront`
// with its own cases. That shape no longer exists, so re-measuring it would
// measure a fiction, and Part C removes the external rollback path.
// What stays, on a fleet box that starts with no other repository's files (the
// flip cases plant that repository's instance timer for codex-b themselves): a
// fresh fleet box keeps box-token measured, a provisioned one keeps it PASS
// through two installs and doctor, a flip made in Plan 3b's order enables only
// that lane's ccrc instance, and a flip made while the other repository's
// instance timer for that lane is still enabled withholds ccrc's. The runbook's two steps that need a real LiteLLM (the refresh of a
// codex lane and the one publisher run) are stood in for by the files each
// leaves: the default suite has no real LiteLLM (Global Constraints), and
// Task 1's two-lane case and ccgpt-usage.test.ts own their behaviour.
// ════════════════════════════════════════════════════════════════════════

/** Task 6's INST_DEGRADED word for a usage enable it withheld (Step 0 re-derives it). */
export const USAGE_DEGRADED = 'codex-usage';

export const epochS = (): number => Math.floor(Date.now() / 1000);

export const argvOf = (home: string): string[] => systemctlCalls(home).map((c) => c.argv);

export const usageEnables = (home: string): string[] =>
  argvOf(home).filter((a) => /^--user enable --now ccrc-codex-usage@/.test(a));

/** A publisher row in `ccd/ccgpt-usage.py`'s shape: both reset keys present, null included. */
export const usageRow = (): string =>
  `${JSON.stringify({ five: null, seven: 12, ts: epochS(), fiveResetAt: null, sevenResetAt: null })}\n`;

/** A fresh FLEET box with no codex lane and no other repository's files. Its
 *  tree is stamped (`codexBox`'s reason: with no stamp `_inst_installed` writes
 *  no record), and its agent env is present so `--role fleet` never prompts.
 *  The runtime template is planted so that a later flip can build; with no
 *  codex lane it is never used.
 *
 *  By default it holds no fleet token file, generation file or sync report:
 *  the fresh-fleet case tests their absence. `{ fleetFiles: true }` gives it
 *  what part B leaves on every provisioned fleet box (box-token row 2a): the
 *  fleet token file (0600: the comment line, then a runtime-random 64-hex
 *  value, so no fixture value is a literal here), the generation file (16 hex)
 *  and the proved sync report, plus the roster's one upstream account's
 *  setup-token file (runtime-random too), which `~/.cc-secrets` existing makes
 *  `credentials` owe. */
export function fleetBox(prefix: string, opts: { systemd?: boolean; fleetFiles?: boolean } = {}): string {
  const home = freshBox(prefix);
  gitInit(treeRoot(home));
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'agent.env'),
    'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
  if (opts.fleetFiles === true) {
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'),
      `CLAUDE_CODE_OAUTH_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'),
      `${FLEET_TOKEN_FILE_COMMENT}\n${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    // A box holding lane secrets states its provider snapshot posture (accounts plan A11b), or `snapshot-posture` WARNs.
    writeFileSync(join(home, '.ccrc', 'snapshot-posture'), 'none\n');
    const generation = randomBytes(8).toString('hex');
    writeFileSync(join(home, '.ccrc', NODE_FILES.tokenGeneration), `${generation}\n`, { mode: 0o600 });
    writeFileSync(join(home, '.ccrc', 'token-sync.json'),
      JSON.stringify({ v: 1, at: epochS() - 3600, result: 'synced', generation, transport: 'https', proof: 'proved' }), { mode: 0o600 });
  }
  plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
  if (opts.systemd === true) plantSystemd(home, { userManager: true });
  return home;
}

/** The fleet arm's line for a provisioned box: token file, generation and a proved sync (`_bt_fleet_arm`). */
export const PROVISIONED_BOX_TOKEN =
  /^PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport https$/m;

/** Every doctor check's class (`doctorClasses`) on a fleet box with no
 *  external lane: `fleetBox(prefix)`'s `install --role fleet` and its doctor.
 *  It holds what `BASE_LIVE_SHAPE` held for every fleet install until Plan 4
 *  retired that golden with the external lane: the whole `--role fleet` map,
 *  so a check that moves class on a fresh install reds here, not only one that
 *  FAILs. MEASURED, never typed: on this branch in Plan 4's final fix wave,
 *  by a MEASURE-only case, since removed, that ran
 *  `install --role fleet` then `doctor` on `fleetBox(prefix)`, and two
 *  installs then `doctor` on `fleetBox(prefix, { fleetFiles: true })`, and
 *  wrote `doctorClasses` of each transcript as JSON. All five exited 0, and
 *  the five maps are equal but for `credentials`: SKIP here (no
 *  `~/.cc-secrets`), PASS on the provisioned box (the directory exists, so a
 *  credential is owed and its file is there). Exactly two WARNs, each the
 *  fresh-install word of a timer the install placed seconds before:
 *  `pool-sync` (`pool-sync-not-yet-synced`) and `update-sync`
 *  (`update-sync-not-yet-synced`). `server-caps` is PASS by its
 *  `first-write-pending` grace (D-4168). Against `BASE_LIVE_SHAPE`'s install
 *  map, three classes differ, each by the seat: `models` SKIP (no lane here
 *  has a model registry), `credentials` SKIP (above), and `codex` SKIP, which
 *  that golden left out. A merge-up that moves a class here reds both
 *  box-token cases until this is re-measured the same way; it is never
 *  hand-edited. The merge of `main` that added `delegation-hooks` and
 *  `oom-policy` was re-measured from both box-token cases' own failing diff:
 *  each is PASS at every stage. So was the next, which added `update-sweep`
 *  and the four `approval-*` checks: each is SKIP at every stage. Accounts plan A11b added the three backups checks:
 *  `filevault` and `secrets-backup-excluded` SKIP at every stage (darwin's), and `snapshot-posture` SKIPs on the fresh
 *  box (no lane secret) and PASSes on the provisioned one, whose `fleetFiles` state `none`.
 *  Wave 24 added `box-settings` (D-6599): PASS at every stage, re-measured from both box-token cases' own failing diff
 *  (a fresh box's ccrc.env sets none of ccrc's settings). node-runtime-under-nvm added `node-path`: PASS at every
 *  stage, re-measured from both box-token cases' own failing diff (the install published the node and the fixture
 *  manager re-read the fragment at its reload). */
export const FLEET_BOX_CLASSES: Readonly<Record<string, string>> = {
  "accounts": "PASS",
  "approval-digest-mismatch": "SKIP",
  "approval-key": "SKIP",
  "approval-key-colocated": "SKIP",
  "approval-verifier-runnable": "SKIP",
  "auth": "SKIP",
  "box-settings": "PASS",
  "box-token": "PASS",
  "build": "PASS",
  "caddy": "SKIP",
  "caddyfile": "SKIP",
  "cert": "SKIP",
  "codex": "SKIP",
  "config": "PASS",
  "credentials": "SKIP",
  "delegation-hooks": "PASS",
  "disk": "PASS",
  "docs": "PASS",
  "docs-sw": "SKIP",
  "exposure": "SKIP",
  "filevault": "SKIP",
  "fleet": "SKIP",
  "flock": "PASS",
  "gh": "PASS",
  "gh_auth": "PASS",
  "git": "PASS",
  "git_email": "PASS",
  "graphify": "PASS",
  "graphify-path": "PASS",
  "history": "PASS",
  "jq": "PASS",
  "jq_regex": "PASS",
  "linger": "PASS",
  "memory": "PASS",
  "model-default": "PASS",
  "models": "SKIP",
  "name": "SKIP",
  "node": "PASS",
  "node-path": "PASS",
  "oom-policy": "PASS",
  "path": "PASS",
  "pool-sync": "WARN",
  "pools": "PASS",
  "provenance": "PASS",
  "python3": "PASS",
  "rc": "PASS",
  "routing": "PASS",
  "scope-sweep": "SKIP",
  "scopes": "SKIP",
  "secrets-backup-excluded": "SKIP",
  "server-caps": "PASS",
  "services": "PASS",
  "skills": "PASS",
  "snapshot-posture": "SKIP",
  "timeout": "PASS",
  "tmux": "PASS",
  "tmux_skew": "PASS",
  "transcripts": "PASS",
  "update-exposure": "SKIP",
  "update-sweep": "SKIP",
  "update-sync": "WARN",
  "wrappers": "PASS"
};

/** A fleet box's class map, said three ways: the two WARNs by name and
 *  `server-caps` PASS (so a failure names the check that moved), then the
 *  whole map against `want`. */
export function expectFleetBoxClasses(stdout: string, want: Readonly<Record<string, string>>, stage: string): void {
  const got = doctorClasses(stdout);
  expect(Object.keys(got).filter((k) => got[k] === 'WARN').sort(), `${stage}: the WARN set on a fleet box with no external lane`)
    .toEqual(['pool-sync', 'update-sync']);
  expect(got['server-caps'], `${stage}: server-caps on a fresh fleet install (its first-write-pending grace)`).toBe('PASS');
  expect(got, `${stage}: a check's class moved from FLEET_BOX_CLASSES — re-measure it, never hand-edit it`).toEqual(want);
}

/** What a flipped lane's `init codex` (ruling Z3 forces it after the flip) and
 *  its first refresh leave, stood in by their files: the class registry, the
 *  catalogue, and the lane files a models mutation re-materialises. Fixture
 *  model ids only. */
export function plantFlippedLaneModels(home: string, id: string): void {
  mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), `${JSON.stringify(REHEARSAL_REGISTRY, null, 2)}\n`);
  writeRehearsalCatalogue(home, id, epochS());
  const m = runInstall(home, ['models', id, 'set-subagent', 'sonnet'], READY, { from: REPO_CCRC });
  expect(m.code, `ccrc models ${id} set-subagent sonnet:\n${m.stdout}\n${m.stderr}`).toBe(0);
}
