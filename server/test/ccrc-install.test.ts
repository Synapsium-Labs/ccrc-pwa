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
import * as pty from 'node-pty';
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync,
  chmodSync, readdirSync, rmSync, symlinkSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { describeLinux, describeDarwin, itLinux, itDarwin } from './platformFixtures.js';

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
  // D-1160: the sweep's shipped default noise list. `_inst_graph_noise`
  // refuses a tree without it, which is the point — a placed tree missing it
  // would leave the box refusing builds over ccrc's own artifacts.
  'ccd/graph-noise.default.list',
  'ccd/ccrc-doctor-checks',
  'ccd/ccrc-wrapper-shape',
  'ccd/ccrc-adopt',
  // The generators, reached as `$CCRC_HERE/../deploy/<name>.mjs` — the same
  // "one directory up from this script" resolution `cmd_wrappers` uses, true
  // in a checkout and at `~/ccrc/deploy` on a deployed box.
  'deploy/gen-accounts.mjs',
  'deploy/gen-wrappers.mjs',
  // The roster SEED `_inst_roster` places on a box that has none. The
  // realistic "the operator already has a roster" fixture is no repo file any
  // more — the shipped five-account migration roster left the tree with the
  // stage-5 de-brand (spec §5, D-202) — so FIVE_ACCOUNT_ROSTER below serialises
  // `DEFAULT_TEST_ROSTER` instead: a roster with `claude-b` in it, so
  // "generated FROM the installed roster" stays provable rather than merely
  // plausible.
  'deploy/accounts.default.json',
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
  // graphify Task 10: the sweep executable `_inst_bins` ships alongside the
  // other two, unconditionally (mirrors the `ccd-cap-scopes` line — only the
  // UNIT and its ENABLE are role-gated, per `_inst_units`/`_inst_enable`).
  'ccd/ccd-graph-sweep',
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
  // ── Stage 4 Task 5: the agent's unit, which `--role fleet` installs and
  // every other role still refuses (its REQUIRED EnvironmentFile is the
  // reasoned exclusion — the role gate replaced the blanket refusal).
  'deploy/ccrc-agent.service',
  // ── Stage 3a Task 9: the passphrase hasher. This install writes NO
  // passphrase (the seed-once doctrine applied to a credential, and the
  // `curl … | bash` stdin hazard `cmd_passwd`'s tty refusal exists for), but
  // the run ENDS with doctor, whose `auth` check reaches this file through
  // `$CCRC_HERE/../deploy/` to measure what is (not) there. Without it in the
  // tree, that check would report a bug in ccrc on every fixture box.
  'deploy/gen-auth-hash.mjs',
  // ── The two SKILL TREES and their two installers (worker-skill Task 4).
  // `_inst_skills` places each tree into `~/.cc-sessions/` and then RUNS the
  // installer it just placed beside it, so all four are read out of the tree
  // this fixture builds. They are DIRECTORY entries for the same reason
  // `deploy/systemd` is: the coordinator skill is a SKILL.md plus a
  // `references/` directory whose contents its own installer refuses to run
  // without, and a hand-listed fixture would go stale the moment a fourth
  // reference lands.
  'ccd/coordinator-skill',
  'ccd/worker-skill',
  'ccd/install-coordinator-skill.sh',
  'ccd/install-worker-skill.sh',
  // graphify Task 3: `_inst_graphify_skill` stages this beside the other two
  // installers, through the same `_inst_atomic`. It ships alone — no
  // `ccd/graphify-skill` tree — because its SRC is assembled from the
  // installed package at run time, never vendored (spec §B).
  'ccd/install-graphify-skill.sh',
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
  // D-1159: the agent entry point `ccrc-agent.service` runs. Present for the
  // same reason the two above are — a fleet box cannot run an agent it never
  // built — and deleted by the one test that wants that refusal.
  'agent/dist/agent/src/index.js': '// fixture: stands in for the built agent\n',
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
const FIXTURE_BINS = ['gh', 'curl', 'journalctl', 'systemctl', 'loginctl', 'npm', 'rsync',
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
  'launchctl', 'plutil', 'flock'];

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
function ccrcEnv(home: string, omit: string[] = []): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
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
  plant('python3', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/python3-argv"',
    'if [ "$1" = "-m" ] && [ "$2" = "venv" ] && [ -n "$3" ]; then',
    '  bin="$3/bin"; mkdir -p "$bin" || exit 1',
    '  printf \'#!/bin/sh\\necho "$@" >> "$HOME/venv-python-calls"\\nexit 0\\n\' > "$bin/python"',
    '  chmod 755 "$bin/python"',
    '  printf \'#!/bin/sh\\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\\nexit 0\\n\' > "$bin/graphify"',
    '  chmod 755 "$bin/graphify"',
    '  exit 0',
    'fi',
    'echo "fixture python3: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];
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
  writeFileSync(join(gfxPkg, 'skill.md'), '# fixture graphify skill\n');
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
  //
  // `diff` joins the list in worker-skill Task 4: BOTH skill installers refuse
  // by name without it ("refusing rather than rewriting blind"), and
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
  for (const b of ['mkdir', 'cp', 'mv', 'rm', 'cat', 'chmod', 'cmp', 'date',
    'node', 'git', 'npm', 'rsync', 'bash', 'sleep', 'jq', 'mktemp', 'basename',
    'diff', 'tmux', 'python3', 'flock', 'timeout', 'stat', 'grep', 'awk', 'realpath',
    // macOS: the service manager, its plist linter, and `uname`. The last one
    // is not decoration — `ccd`'s platform detection prefers bash's own
    // `$OSTYPE` precisely so a PATH without `uname` cannot silently answer
    // "linux", and this list is where that PATH gets built.
    ...(process.platform === 'darwin' ? ['launchctl', 'plutil', 'uname'] : [])]) {
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
      placed(home, 'server'),
      placed(home, 'agent'),
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
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([placed(home, 'server')]);
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
      'CCRC_HOST=203.0.113.7',
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

// The same probe, on the platform where the missing dependency is real. macOS
// ships neither tmux nor flock, and its /bin/bash is 3.2.57 — so on this
// platform the refusal an operator actually meets is one of THOSE, and it
// carries the same three promises the systemd one does: by name, before the
// first write, with a remedy that works.
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
  // Dropping it costs nothing HERE and only here: every one of these probes
  // runs BEFORE the first of the fourteen steps, so no step is reached that
  // would want `claude`, `gh` or any other planted stub.
  const pathMissing = (home: string, tool: string): string => {
    const full = pathWithout(home, tool);
    return full.split(':').slice(1).join(':');
  };

  it('refuses by name BEFORE the first write when tmux is absent', () => {
    const home = freshBox('ccrc-install-notmux-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'tmux') },
      { omit: ['tmux'] });
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
      { omit: ['flock'] });
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
      { omit: ['launchctl'] });
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

  itLinux('ccd-cap-scopes lands beside it — the OOM guardrail is an executable too', () => {
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-cap-scopes');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-cap-scopes')));
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
      // The two skill installers (worker-skill Task 4) are the same kind of
      // artifact as the hooks installer beside them — a script the box EXECUTES
      // — and land through the same `_inst_atomic`. 0755 is not decoration
      // here: `_inst_skills` runs each one immediately afterwards, and a copy
      // that arrived at the source's mode under this describe's hostile umask
      // would be a step that installs a skill installer nobody can run.
      [join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
        placed(home, 'ccd', 'install-coordinator-skill.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-worker-skill.sh'),
        placed(home, 'ccd', 'install-worker-skill.sh'), 0o755],
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
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      // The two skill installers `_inst_skills` stages beside them, through
      // the same `_inst_atomic` (worker-skill Task 4).
      join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
      join(home, '.cc-sessions', 'install-worker-skill.sh'),
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
      // graphify Task 2. After `_inst_dirs` and before `_inst_hooks`, per the
      // task brief: the engine venv has no dependency on the account config
      // dirs or the hooks installer either way, so the position is the
      // brief's own placement rather than a dependency this file measures.
      '_inst_graphify_engine',
      '_inst_hooks',
      // Worker-skill Task 4. Beside `_inst_hooks` and after it, in deploy.sh's
      // own order (`install-session-hooks.sh`, then the two skill installers):
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
      // D-1243. The READ side, and it sits right after the skill because it is
      // assembled from the same pinned package the skill is — before the noise
      // list, which serves the write path this one deliberately does not.
      '_inst_graph_always_on',
      '_inst_graph_noise',
      // graphify Task 4 (D-996/D'). Right after `_inst_graphify_skill`, per
      // the task brief: the sweep's `check-ignore` precondition needs a
      // writer that converges every project/worktree's common-dir exclude.
      // No later step reads what this one writes, so the position is the
      // brief's own placement rather than a measured dependency.
      '_inst_graph_excludes',
      // graphify Task 10 (O3/O6b). Right after `_inst_graph_excludes`, per
      // the task brief: no later step reads what it does, so the position is
      // the brief's own placement rather than a measured dependency.
      '_inst_graph_hooks_off',
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
  // graphify Task 10 (O3/O6b): ROLE-GATED — `_inst_units` skips both on a
  // `--role server` box, unlike every other row above. The default fixture
  // install below is role `both`, so they land on the box this describe's
  // shared install measures; the server-role describe further down asserts
  // their absence explicitly.
  ['ccd-graph-sweep.service', 'deploy/systemd/ccd-graph-sweep.service'],
  ['ccd-graph-sweep.timer', 'deploy/systemd/ccd-graph-sweep.timer'],
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

  it('installs six unit files and two drop-ins, byte for byte, at 644', () => {
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
      // graphify Task 10 (O3/O6b): a THIRD enable, beside cap-scopes', for the
      // role-gated sweep timer — the default install here is role `both`, so
      // it fires. Degrades rather than dies on failure (`_inst_linger`'s own
      // idiom), which is why it is not folded into the `_ccrc_die`-guarded
      // loop above it.
      '--user enable --now ccd-graph-sweep.timer',
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
      /^summary: 1 account\(s\) in .*\/\.ccrc\/accounts\.json — 0 generated, 1 upstream, 0 external \(upstream and external are never written\); 0 written, /m);
    expect(r.stdout).toMatch(/^install: wrappers: converged /m);
    // Nothing but the four executables `_inst_bins` installs (graphify Task 10
    // adds `ccd-graph-sweep`) — no wrapper, no temp file, no staged leftover —
    // beside what the fixture itself planted.
    expect(readdirSync(join(home, '.local', 'bin'))
      .filter((b) => !FIXTURE_BINS.includes(b)).sort())
      .toEqual(process.platform === 'darwin'
        ? ['ccd', 'ccrc']   // no cap-scopes (cgroup-bound) and no graph-sweep (systemd-timer-bound)
        : ['ccd', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccrc']);
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

describe('ccrc install: both skills reach every rostered account', () => {
  // ── THE ASYMMETRY THIS STEP CLOSES ──────────────────────────────────────
  // `deploy/deploy.sh agent <host>` has shipped the coordinator skill to the
  // fleet host since Build 7 and now ships the worker skill beside it — but a
  // box that installs ITSELF got neither, because no step of this verb had ever
  // heard of a skill. That is not a cosmetic gap: both installers exist because
  // skills resolve per `CLAUDE_CONFIG_DIR` and a session's ACCOUNT drifts on
  // swap while its id does not, so a coordinator (or a worker) placed with no
  // pinned account must find its skill in EVERY rostered home. On a
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

  it('lands BOTH skills in every account config dir the roster names', () => {
    const { home } = skillBox;
    for (const d of ROSTER_DIRS) {
      for (const [name, src] of [
        ['ccrc-coordinator', 'coordinator-skill'], ['ccrc-worker', 'worker-skill'],
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
    // verb places the same two directories at the same two paths from the tree
    // it just put at `~/ccrc`. A box therefore looks the same afterwards
    // whichever lane converged it — which is what makes the installers' own
    // `CCRC_SKILL_SRC` default correct on a self-installed box.
    const { home } = skillBox;
    for (const name of ['coordinator-skill', 'worker-skill']) {
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
      join(home, '.cc-sessions', 'coordinator-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'worker-skill', 'SKILL.md'),
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
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
      join(home, '.cc-sessions', 'install-worker-skill.sh'),
      // graphify Task 3: staged beside them, through the same `_inst_atomic`.
      join(home, '.cc-sessions', 'install-graphify-skill.sh'),
      // …and the two staged skill TREES, which are not `_inst_atomic`
      // destinations at all: `_inst_tree_copy` converges a directory, and the
      // file inside it is what a re-run must not rewrite (worker-skill Task 4).
      join(home, '.cc-sessions', 'coordinator-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'worker-skill', 'SKILL.md'),
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
    //    (ccrc:2163) — SECOND resolution — while `sha`, `ref` and `dirty` are
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

  itLinux('installs ccrc-agent.service — byte for byte — and NOT ccrc.service', async () => {
    const { home } = await fleet();
    const agent = unitDir(home, 'ccrc-agent.service');
    expect(existsSync(agent)).toBe(true);
    expect(readFileSync(agent)).toEqual(readFileSync(placed(home, 'deploy', 'ccrc-agent.service')));
    expect(statSync(agent).mode & 0o777).toBe(0o644);
    expect(existsSync(unitDir(home, 'ccrc.service'))).toBe(false);
    // …while the four role-independent units and drop-ins still land.
    for (const [dest] of UNIT_FILES) {
      if (dest === 'ccrc.service') continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
  });

  itLinux('enables and restarts the AGENT unit, and never asks systemd about ccrc.service', async () => {
    const { home, r } = await fleet();
    const argv = systemctlCalls(home).map((c) => c.argv);
    expect(argv).toContain('--user enable --now ccrc-agent.service');
    expect(argv).toContain('--user enable --now ccd-cap-scopes.timer');
    // graphify Task 10 (O3/O6b): fleet is not server, so the sweep timer
    // enables here too.
    expect(argv).toContain('--user enable --now ccd-graph-sweep.timer');
    expect(argv).toContain('--user restart ccrc-agent.service');
    // The blanket half of the old refusal, inverted: on a fleet box it is
    // ccrc.service that must never be touched — there is no server here.
    expect(argv.join('\n')).not.toMatch(/\bccrc\.service\b/);
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
      '--user enable --now ccd-graph-sweep.timer',
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
    // before this task still lands unchanged.
    for (const [dest] of UNIT_FILES) {
      if (dest === 'ccd-graph-sweep.service' || dest === 'ccd-graph-sweep.timer') continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-graph-sweep');
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
