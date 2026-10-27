// Shared fixture for the `ccrc-doctor-<part>.test.ts` family (D-6767): `healthy()`, the stubs, the runners and the codex-lane
// builders every part uses, moved out of what was one 17,000-line test file so the parts can run on separate workers.
// The test cases themselves moved verbatim; nothing here is a case.
//
// `ccrc doctor` — Task 4 of the stage-2b ccrc-cli-and-doctor plan: the
// PREREQUISITE checks (node floor, the six binaries, gh's authentication,
// git's identity, systemd linger). Roster/wrapper coherence (Task 5) and the
// cross-box fleet check (Task 7) are later tasks and are deliberately absent.
//
// ── HOW THE FIXTURE CONTAINS THIS SUITE ───────────────────────────────────
// Three separate boundaries, because doctor's whole job is to measure a BOX
// and the box this suite runs on is a live fleet host:
//
//  1. HOME is a throwaway `mkTmp` directory (the one isolation boundary the
//     whole ccd suite relies on — CLAUDE.md), and `ccrc` is invoked through a
//     symlink at `<home>/ccrc/ccd/ccrc`. That path is not a convenience: it is
//     the SHAPE OF A DEPLOYED BOX (`deploy/deploy.sh (the rsync step)` rsyncs
//     `agent shared deploy ccd` to `~/ccrc/` on the fleet host), and doctor
//     resolves the shipped `package.json` relative to its own script, so the
//     symlink is what lets a test control which `package.json` doctor finds
//     without touching this checkout's own.
//  2. PATH comes from `ghContainedEnv` and contains NOTHING BUT FIXTURE
//     DIRECTORIES — `<home>/.local/bin` (the poisoned `gh`) then
//     `<home>/stub-bin` (every other stub). No system directory is on it at
//     all, so the real `gh` — which on this machine carries a repo-WRITE token
//     — is unreachable by construction, not merely shadowed. Where a test
//     needs `gh` to ANSWER something (authenticated, wrong scopes, logged
//     out), it overwrites the poison IN THAT SAME DIRECTORY, so the ordering
//     ghContainedEnv establishes is never displaced.
//  3. Every binary a check probes is a stub: jq/python3/flock (presence
//     only), tmux (presence, plus `-V` and the running server's `#{version}`
//     answered from a fixture file — the tmux_skew check runs both), git and
//     loginctl (answers read from a fixture file), gh (canned
//     `auth status` output), and node — whose stub answers `--version` from a
//     literal and forwards everything else to the real interpreter, because
//     `--version` is the only dimension doctor measures and a hand-rolled JSON
//     parser would be the thing under test rather than a stub of it.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, cpSync, copyFileSync, utimesSync, appendFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv, ghPoisonAt, seedAccountsSh } from './ccdWsHelpers.js';
import { plantAuthHelper, plantAuthModule, fixtureSecretLine, compiledSecretJs } from './authFixtures.js';
import { IS_DARWIN } from './platformFixtures.js';
import { DOCS_INDEX_READY, docsIndexStubScript } from './docsIndexFixtures.js';
import { codexRoster, freeLanes, GPT_LANE_BINS, killLaneProcesses, plantFakeRuntime, plantCodexUsage, plantLaneAuth, spawnListener, type LanePorts, type Listener } from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { CLOSED_AUTH_BASE } from './codexAuthFixture.js';
import { createStore } from '../../ccd/history/store.mjs';
import { HEALTH_WORDS, deriveHealth } from '../../ccd/history/lib.mjs';
import { swJs } from './swFixtures.js';
import { wrapRealTool } from './wrapRealTool.js';

export const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO = path.resolve(here, '..', '..');
export const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
export const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');
/** The THIRD file that ships beside `ccrc` — the wrapper-shape contract both
 *  `ccrc-adopt` and `_check_wrappers` source. It is a separate install artifact,
 *  not a detail: `ccrc` reaches its siblings through `${BASH_SOURCE[0]}`, which
 *  bash does not resolve through a symlink, so all three must land in the same
 *  directory. The "library missing" test below is the mechanism that says so. */
export const LIB_SRC = join(REPO, 'ccd', 'ccrc-wrapper-shape');

/** bash's absolute path, resolved ONCE under this process's real PATH. Every
 *  spawn below hands the child a PATH built only from fixture directories, and
 *  libuv resolves the executable against the CHILD's environment — so spawning
 *  bare `bash` would be ENOENT. Same trick ccrc-cli.test.ts (its bash shim) uses. */
export const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

export const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

export interface Result { code: number; stdout: string; stderr: string }

// ── fixture construction ──────────────────────────────────────────────────

/** `<home>/ccrc/ccd/{ccrc,ccrc-doctor-checks}` — symlinks, so a test always
 *  runs the CHECKED-IN script (no copy to go stale) while `dirname $0`
 *  resolves inside the fixture. */
export function installCcrc(home: string): void {
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
  symlinkSync(CHECKS_SRC, join(ccd, 'ccrc-doctor-checks'));
  symlinkSync(LIB_SRC, join(ccd, 'ccrc-wrapper-shape'));
  // The node selection library `_check_node-path` and `_fix_node-path` source from beside the doctor file (task 3).
  symlinkSync(join(REPO, 'ccd', 'ccrc-node'), join(ccd, 'ccrc-node'));
  // The jq module the transcripts check loads (ARCH-65), beside the checks file as in a shipped tree.
  symlinkSync(join(REPO, 'ccd', 'lib'), join(ccd, 'lib'));
  // The four shipped skill trees (release/rollout design §6): `_check_skills`
  // compares every home's installed copy against THESE, the tree the stamp
  // names — not against the `.cc-sessions` placed copy, which was stale too
  // on 2026-09-17.
  for (const n of ['coordinator-skill', 'worker-skill', 'reviewer-skill', 'history-skill']) {
    symlinkSync(join(REPO, 'ccd', n), join(ccd, n));
  }
  // …and the four INSTALLERS that ship beside them (R12). `_check_skills`'
  // FAIL remedy now names `$HOME/ccrc/ccd/install-<role>-skill.sh` — the
  // script out of the same measured tree as the source — so a fixture that
  // planted only the skill trees could not run the remedy it prints. A real
  // box has them: `_inst_tree` rsyncs `ccd/` whole.
  for (const n of ['install-coordinator-skill.sh', 'install-worker-skill.sh', 'install-reviewer-skill.sh', 'install-history-skill.sh']) {
    symlinkSync(join(REPO, 'ccd', n), join(ccd, n));
  }
  // …and the HOOK installer (delegation broker wave 3, Task 14): `_check_delegation-hooks` reads the approved event
  // set out of `$CCRC_HERE/install-session-hooks.sh`'s own `EVENTS_JSON` (no third copy), and `_fix_delegation-hooks`
  // re-runs that same script, so a fixture tree carries it beside the doctor file as a real tree does.
  symlinkSync(join(REPO, 'ccd', 'install-session-hooks.sh'), join(ccd, 'install-session-hooks.sh'));
  // The history CLI (spec 2026-10-05 §9.6): `_check_history` runs `node "$CCRC_HERE/history/cli.mjs" status --json`.
  // A LINK, like the skill trees and unlike the auth helpers: node resolves a module's imports from its REAL path,
  // and this module's imports (`./lib.mjs`, `./store.mjs`) sit beside it in the checkout, as they do in a box's
  // tree (`_inst_tree` rsyncs `ccd/` whole).
  symlinkSync(join(REPO, 'ccd', 'history'), join(ccd, 'history'));
  // ── the `auth` check's two artifacts (Task 9) ──────────────────────────
  // `_check_auth` measures `~/.ccrc/auth.scrypt` by running
  // `deploy/gen-auth-hash.mjs --check`, which imports the compiled reader out
  // of `server/dist/` — the module the SERVER boots on, so the check cannot
  // pass a line the server would refuse. Both are part of the shipped tree
  // (`deploy.sh` rsyncs `deploy/` and builds `server/` on the box), so a
  // fixture box that lacks them is not a box.
  //
  // The helper is COPIED, not symlinked, unlike the three above: node resolves
  // a module's own imports from its REAL path, so a symlinked helper would
  // import THIS CHECKOUT's `server/dist/…` — which may or may not exist on a
  // developer's tree — instead of the fixture's own.
  plantAuthHelper(join(home, 'ccrc'));
  plantAuthModule(join(home, 'ccrc'));
  // ── the `accounts` check's helper (Task 33) ────────────────────────────
  // COPIED, not symlinked, for `plantAuthHelper`'s reason above: node resolves
  // a module's own imports from its REAL path, so a symlinked helper would
  // import THIS CHECKOUT's `shared/`.
  //
  // THE TRANSITIVE SET IS THREE FILES, counted against the module as it stands
  // NOW rather than as its header first described it: `account-op.mjs` imports
  // `../shared/roster-json.mjs` and `../shared/base-url.mjs`, and the first
  // imports the second. `base-url.mjs` imports nothing, so these three close
  // it. A missing one is not a degraded check — `node "$gen" doctor …` exits
  // non-zero with ERR_MODULE_NOT_FOUND, `_check_accounts` takes its
  // roster-unreadable WARN arm on every fixture in this file, and the summary
  // case's `expect(warn).toBe(0)` reds along with the accounts cases.
  copyFileSync(join(REPO, 'deploy', 'account-op.mjs'),
    join(home, 'ccrc', 'deploy', 'account-op.mjs'));
  mkdirSync(join(home, 'ccrc', 'shared'), { recursive: true });
  for (const f of ['roster-json.mjs', 'base-url.mjs']) {
    copyFileSync(join(REPO, 'shared', f), join(home, 'ccrc', 'shared', f));
  }
}

/** `~/.ccrc/auth.scrypt`, as `ccrc passwd` really writes it: 0600, one line,
 *  produced by the real writer under the real parameters. `text` overrides the
 *  content for the tests that are ABOUT an unusable file. */
export function writeAuthSecret(home: string, text = fixtureSecretLine()): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'auth.scrypt'), text, { mode: 0o600 });
}

export const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');

/** Replaces the symlinked check table with a hand-written one. Only the runner
 *  tests use this — it is how a table entry with no implementation, or a check
 *  that answers with an illegal status, can be reached at all without shipping
 *  one. */
export function writeChecks(home: string, text: string): void {
  const p = join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks');
  rmSync(p, { force: true });
  writeFileSync(p, text);
}

/** The shipped `package.json` doctor reads its floor out of. `pkgDir` picks
 *  which box this fixture is: `agent` is what a fleet host has
 *  (deploy.sh (the fleet rsync)), `server` is what a server host has (deploy.sh (the server rsync)). */
export function writePkg(home: string, engines: string | null, pkgDir: 'server' | 'agent' = 'server'): void {
  const d = join(home, 'ccrc', pkgDir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify(
    { name: `@ccrc/${pkgDir}`, ...(engines === null ? {} : { engines: { node: engines } }) }, null, 2));
}

export function writeRawPkg(home: string, text: string, pkgDir: 'server' | 'agent' = 'server'): void {
  const d = join(home, 'ccrc', pkgDir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), text);
}

export const stubBin = (home: string): string => {
  const d = join(home, 'stub-bin');
  mkdirSync(d, { recursive: true });
  return d;
};

export function stub(home: string, name: string, body: string): void {
  writeFileSync(join(stubBin(home), name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** Remove a stub — this is what "the subject is removed from the fixture" means
 *  for a presence check, and it is the mutation each per-check test below
 *  applies to prove its check can go red at all. */
/** "This box has no service manager." Which binary that means is the
 *  platform's business, not the test's — a fixture that only removed
 *  `systemctl` would leave a macOS box with a perfectly working `launchctl`
 *  and measure the opposite of what it set out to. */
export function unstubManager(home: string): void {
  unstub(home, process.platform === 'darwin' ? 'launchctl' : 'systemctl');
}

export function unstub(home: string, name: string): void {
  rmSync(join(home, 'stub-bin', name), { force: true });
}

export const linkReal = (home: string, name: string): void => {
  // Idempotent since healthy() itself links `stat`/`date`/`timeout`: a test
  // that re-links one it needs (the oversize-wrapper test predates that) must
  // not trip over the fixture already having it. Last caller wins.
  rmSync(join(stubBin(home), name), { force: true });
  wrapRealTool(realPath(name), join(stubBin(home), name));
};

export function stubNode(home: string, version: string): void {
  stub(home, 'node',
    `if [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi\n`
    + `exec '${process.execPath}' "$@"`);
}

/** A `node` that fails with `code` for the ROSTER read only — matched on the
 *  reader's own env-var name, which appears in the script text `-e` carries —
 *  and behaves normally for everything else (the node CHECK reads a
 *  package.json through `CCRC_DOCTOR_PKG`, and must not be collateral).
 *  This is how the "exited N and this check does not know what that means"
 *  arm is reachable at all: the reader itself only ever exits 0/3/4/5/6. */
export function stubNodeRosterExit(home: string, code: number): void {
  stub(home, 'node',
    `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi\n`
    + `case "$*" in *CCRC_DOCTOR_ROSTER*) exit ${code} ;; esac\n`
    + `exec '${process.execPath}' "$@"`);
}

/** A `node` that fails with `code` for the models CATALOGUE READ only —
 *  matched on that reader's own env-var name (`CCRC_DOCTOR_MODELS_DIR`),
 *  which appears literally in the `-e` script text the same way
 *  `stubNodeRosterExit` above matches `CCRC_DOCTOR_ROSTER` — and behaves
 *  normally for the roster read and the `--version` probe, so the population
 *  loop above the batched read is never collateral. R1 case 2. */
export function stubNodeModelsExit(home: string, code: number): void {
  stub(home, 'node',
    `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi\n`
    + `case "$*" in *CCRC_DOCTOR_MODELS_DIR*) exit ${code} ;; esac\n`
    + `exec '${process.execPath}' "$@"`);
}

/** A `node` that answers the models CATALOGUE READ with a status
 *  (`WEIRD`) `_check_models`'s own `case` does not define, for every
 *  population id it is handed on stdin — matched the same way
 *  `stubNodeModelsExit` above is, so the roster read and `--version` probe
 *  are untouched. A real reader only ever emits
 *  NOCATALOGUE/UNREADABLE/INVALID/OK; this is how R3(b)'s missing default
 *  arm is reached at all. R1 case 7. */
export function stubNodeModelsWeirdStatus(home: string): void {
  stub(home, 'node', [
    `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi`,
    `case "$*" in *CCRC_DOCTOR_MODELS_DIR*)`,
    `  US=$'\\x1f'`,
    `  while IFS= read -r id; do`,
    `    printf '%s%sWEIRD%s%s%s\\n' "$id" "$US" "$US" "$US" "$US"`,
    `  done`,
    `  exit 0`,
    `  ;;`,
    `esac`,
    `exec '${process.execPath}' "$@"`,
  ].join('\n'));
}

/** tmux, answering the ONLY two argv shapes doctor sends: `-V` names the
 *  CLIENT (the binary on disk, in tmux's own `tmux 3.4` spelling), and
 *  `display-message -p '#{version}'` asks the RUNNING SERVER for its own —
 *  answered from `<home>/fixture-tmux-server`, which this helper seeds at the
 *  client's version so a box that says nothing about skew has none. With the
 *  file removed it fails the way a serverless box really does: an "error
 *  connecting" line on stderr, exit 1, nothing on stdout. Any other argv is a
 *  loud failure (exit 90) — a doctor that started DRIVING tmux rather than
 *  asking its versions could not pass unnoticed. */
export function stubTmux(home: string): void {
  stub(home, 'tmux', [
    'if [ "$1" = "-V" ]; then echo "tmux 3.4"; exit 0; fi',
    'if [ "$1" = "display-message" ] && [ "$2" = "-p" ] && [ "$3" = "#{version}" ]; then',
    '  if [ -f "$HOME/fixture-tmux-server" ]; then IFS= read -r v < "$HOME/fixture-tmux-server"; echo "$v"; exit 0; fi',
    '  echo "error connecting to /tmp/tmux-0/default (No such file or directory)" >&2; exit 1',
    'fi',
    'echo "fixture tmux: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  writeFileSync(join(home, 'fixture-tmux-server'), '3.4\n');
}

/** `git config --global user.email` answers from `<home>/fixture-git-email` and
 *  `--system` from `<home>/fixture-git-email-system`; with the file absent it
 *  exits 1 and prints nothing, exactly as real git does for an unset key.
 *
 *  The two SCOPES are separate files because the check reads them separately,
 *  and any other argv is a loud failure (exit 90): a check that quietly went
 *  back to the repo-scope-inclusive `git -C "$HOME" config user.email` — the
 *  defect the review caught — would no longer be answered at all. `IFS=` on the
 *  read so a whitespace-only value survives intact into the check.
 *
 *  `user.useConfigOnly` is a THIRD file for the same reason the two scopes are
 *  separate: it is a different question — "is identity deliberately
 *  per-repository?" — and the check must be able to read it independently of
 *  whether an address is set. Its arm was added when the check learned to tell
 *  absent-by-policy from never-configured; before that, asking for it here
 *  would have exited 90. */
export function stubGit(home: string): void {
  stub(home, 'git',
    'case "$*" in\n'
    + "  *'config --global user.email'*) f=\"$HOME/fixture-git-email\" ;;\n"
    + "  *'config --system user.email'*) f=\"$HOME/fixture-git-email-system\" ;;\n"
    + "  *'config --global user.useConfigOnly'*) f=\"$HOME/fixture-git-useconfigonly\" ;;\n"
    + '  *) echo "fixture git: unexpected argv: $*" >&2; exit 90 ;;\n'
    + 'esac\n'
    + 'if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; exit 0; fi\n'
    + 'exit 1');
}

/** `loginctl show-user <uid> --property=Linger` answers from
 *  `<home>/fixture-linger`. With the file absent it fails the way logind
 *  really does for a user with neither a live session nor linger. */
export function stubLoginctl(home: string): void {
  stub(home, 'loginctl',
    'if [ "$1" = "show-user" ]; then\n'
    + '  if [ -f "$HOME/fixture-linger" ]; then IFS= read -r v < "$HOME/fixture-linger"; echo "Linger=$v"; exit 0; fi\n'
    + '  echo "Failed to get user: User ID is not logged in or lingering" >&2; exit 1\n'
    + 'fi\n'
    + 'echo "fixture loginctl: unexpected argv: $*" >&2; exit 90');
}

// ── the roster, and the wrappers it describes ─────────────────────────────
// `_check_wrappers` compares two things this box really has: the roster
// (`~/.ccrc/accounts.json`) and the account wrappers in `~/.local/bin`. Both
// halves are fixtures here, and both are written in the shape MEASURED on the
// fleet host (adopt.test.ts (its box measurement) is the same measurement, from the other
// side).

export interface RosterEntry {
  id: string;
  configDirSuffix?: string;
  exec: {
    kind: 'upstream' | 'generated' | 'external' | 'codex';
    secretsFile?: string;
    // The two provider fields the roster model carries. `writeRoster` spreads
    // the entry, so nothing else in this file changes — but a fixture writing a
    // field the interface does not declare is a `typecheck-tests` failure
    // rather than a runtime one, which is why it lands in this commit.
    provider?: string;
    baseUrl?: string;
    proxyPort?: number;
    litellmPort?: number;
    authDir?: string;
  };
  /** Task: `credentials` reads it, and `healthy()`'s contract is that every
   *  check PASSES — so the fixture's one account has to be an account the check
   *  has something to measure about. `_check_wrappers`' own TSV reader ignores
   *  the field, so no existing case moves. */
  telemetry?: 'anthropic' | 'codex' | 'none';
}

/** The upstream account every real roster has exactly one of — `parseRoster`
 *  refuses one without it, and `healthy()` plants its binary. */
export const UPSTREAM: RosterEntry = { id: 'claude', configDirSuffix: '.claude',
  exec: { kind: 'upstream' }, telemetry: 'anthropic' };

/** Writes `~/.ccrc/accounts.json`. Two fixture conveniences, both deliberate:
 *  an entry with no `configDirSuffix` gets `.<id>` (the wrapper writer below
 *  uses the same default, so a test that says nothing about config dirs is not
 *  secretly a test about a mismatched one), and a list naming no upstream
 *  account gets `claude` prepended — a test about a generated wrapper must not
 *  also be a test about a roster that could never load. */
export function writeRoster(home: string, accounts: RosterEntry[]): void {
  const full = accounts.some((a) => a.exec.kind === 'upstream') ? accounts : [UPSTREAM, ...accounts];
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify(
    { version: 1, accounts: full.map((a) => ({ configDirSuffix: `.${a.id}`, ...a })) }, null, 2));
}

/** The roster as TEXT. `writeRoster` above is a convenience that fills in a
 *  `configDirSuffix` and an upstream account, which is exactly what a test
 *  ABOUT a malformed roster must not have done for it: an entry with no id, an
 *  id that is not an id, a duplicate, no accounts array at all. */
export function writeRawRoster(home: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), text);
}

/** One roster entry, as JSON text, for `writeRawRoster`. */
export const entry = (o: Record<string, unknown>): string => JSON.stringify(o);
export const rawRoster = (...entries: string[]): string =>
  `{"version":1,"accounts":[${entries.join(',')}]}`;
/** The upstream entry `healthy()` already has a binary for. */
export const UP_JSON = entry({ id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } });

export const binDir = (home: string): string => {
  const d = join(home, '.local', 'bin');
  mkdirSync(d, { recursive: true });
  return d;
};

/** A generated wrapper, byte-for-byte the shape on the fleet host: the shebang,
 *  the export, an optional comment-then-guard secrets pair, the exec. */
export function writeWrapper(home: string, id: string,
  o: { cfgDir?: string; secrets?: string; target?: string } = {}): void {
  const lines = ['#!/usr/bin/env bash', `export CLAUDE_CONFIG_DIR="$HOME/${o.cfgDir ?? `.${id}`}"`];
  if (o.secrets !== undefined) {
    // The comment is not decoration: the two real generated wrappers on the
    // fleet host both carry one ahead of their secrets line, and a shape test
    // that could not tolerate it would reject every real wrapper there is.
    lines.push("# Long-lived setup token (see the file's own header for why). Sourced, not",
      '# inlined, so the token never sits in this world-readable wrapper.',
      `[ -r "$HOME/${o.secrets}" ] && . "$HOME/${o.secrets}"`);
  }
  lines.push(`exec "$HOME/.local/bin/${o.target ?? 'claude'}" "$@"`, '');
  writeFileSync(join(binDir(home), id), lines.join('\n'), { mode: 0o755 });
}

/** The upstream account's own shape: a non-script binary. The real one is a
 *  ~300 MB ELF; a few bytes prove "not a script" without the wait. */
export function writeBinary(home: string, id: string): void {
  writeFileSync(join(binDir(home), id),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
}

/** An EXTERNAL account, in the shape the reference box has it: `gpt` is a
 *  symlink to `ccgpt`, a bespoke launcher that sets CLAUDE_CONFIG_DIR and is
 *  nothing like the generated template. Both names are planted, because the
 *  alias is half of what makes this case real. */
export function writeSymlinkWrapper(home: string, id: string, target: string): void {
  writeFileSync(join(binDir(home), target), [
    '#!/usr/bin/env bash',
    '# bespoke: drives its own proxy; nothing like the generated template.',
    `export CLAUDE_CONFIG_DIR="$HOME/.${id}"`,
    'echo "starting proxy..." >&2',
    'ensure_proxy_running',
    'exec "$HOME/.local/bin/some-other-thing" "$@"',
    '',
  ].join('\n'), { mode: 0o755 });
  symlinkSync(target, join(binDir(home), id));
}

export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Slices `lines` down to the block belonging to `host`: the line spelling the
 *  host itself (unindented, exactly as `gh auth status` prints a section
 *  header) through the last following line that starts with a space. Absent
 *  host header (a fixture that is not host-sectioned at all — the "logged
 *  out" message, say) falls back to the WHOLE of `lines`, unchanged: there is
 *  no per-host structure to narrow, and the check must still see the message. */
export function hostSection(lines: string[], host: string): string[] {
  const i = lines.indexOf(host);
  if (i === -1) return lines;
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length && lines[j].startsWith(' '); j++) out.push(lines[j]);
  return out;
}

/** Overwrites the POISONED `gh` in `<home>/.local/bin` with one that answers
 *  `auth status` from canned lines. Same directory on purpose: the poison's
 *  position at the head of PATH is what makes the real `gh` unreachable, and
 *  that ordering must not be displaced by a second stub directory in front of
 *  it.
 *
 *  TWO argv shapes are answered, because Task 1 of stage2d moved the check
 *  from bare `gh auth status` to `gh auth status --hostname github.com`
 *  (D-82's neighbour: a second host's `'repo'` scope must not mask github.com
 *  lacking it) and old single-host fixtures must keep meaning what they said.
 *  Plain `auth status` still answers with the whole of `lines`; the
 *  `--hostname github.com` form answers with ONLY that host's section
 *  (`hostSection`, above) — the same content for every fixture in this file
 *  that names `github.com` first and nothing else, so no existing fixture had
 *  to change. Any other argv is a loud failure (exit 90), and EVERY argv —
 *  matched or not — is appended to `$HOME/gh-poison`, the same log
 *  `ghContainedEnv`'s poison writes to and `ghPoisonAt` reads: once this stub
 *  overwrites the poison there is no other reader left for that file, and
 *  reusing it (rather than inventing a second log) is what lets a test assert
 *  on the argv the check really sent without a new helper. */
export function ghStub(home: string, lines: string[], code: number): void {
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const scoped = hostSection(lines, 'github.com');
  const emit = (ls: string[]): string => ls.length ? `  printf '%s\\n' ${ls.map(shq).join(' ')} >&2\n` : '';
  writeFileSync(join(bin, 'gh'),
    '#!/bin/sh\n'
    + 'printf \'%s\\n\' "$*" >> "$HOME/gh-poison"\n'
    + 'if [ "$#" = 4 ] && [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--hostname" ] && [ "$4" = "github.com" ]; then\n'
    + emit(scoped)
    + `  exit ${code}\n`
    + 'fi\n'
    + 'if [ "$#" = 2 ] && [ "$1" = "auth" ] && [ "$2" = "status" ]; then\n'
    + emit(lines)
    + `  exit ${code}\n`
    + 'fi\n'
    + 'echo "fixture gh: unexpected argv: $*" >&2\nexit 90\n', { mode: 0o755 });
}

export const GH_OK = [
  'github.com',
  '  - Logged in to github.com account fixture-bot (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  '  - Token: gho_************************************',
  "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
];

// ── the OTHER box, over HTTP ──────────────────────────────────────────────
// `_check_fleet` and `ccrc status` both ask ONE question of a server —
// `GET /api/fleet/health` — and a test must never ask it of a real one. The
// containment is the same shape `ghContainedEnv` uses for `gh`: the only `curl`
// on this fixture's PATH is a stub, and it answers from files planted in the
// fixture HOME. Belt and braces, the address the fixture configures is
// `.invalid` (RFC 2606: guaranteed never to resolve), so even a curl that
// escaped the stub would reach nothing.

/** The health body a fixture's `curl` hands back. Deliberately loose — a test
 *  about a server answering something the check does not understand has to be
 *  able to write exactly that. */
export interface Health {
  mode?: unknown; connected?: unknown; downSince?: unknown;
  build?: unknown; roster?: unknown;
}

export const FIXTURE_ADDR = 'ccrc-fixture.invalid:7788';

/** A `curl` that emulates the ONE invocation ccrc makes:
 *  `curl -sS --max-time N -H accept:… -w '\n%{http_code}' <url>` — body, a
 *  newline, then the status code. Every argv it sees is logged, so a test can
 *  prove the check really asked (and asked for the right URL, with the right
 *  bound) rather than passing vacuously.
 *
 *  Written with shell builtins only: this fixture's PATH holds no system
 *  directory at all, so a stub that reached for `cat` would not run. */
export function stubCurl(home: string): void {
  stub(home, 'curl', [
    'printf \'%s\\n\' "$*" >> "$HOME/curl-calls"',
    'if [ -f "$HOME/fixture-curl-exit" ]; then',
    '  read -r c < "$HOME/fixture-curl-exit"',
    '  echo "curl: ($c) fixture: could not connect" >&2',
    '  exit "$c"',
    'fi',
    // TWO routes, dispatched on the URL (the last argv): `/api/fleet/health`
    // is the fleet check's question and everything else — in practice
    // `/health` — is the build check's (Stage 4, Task 9). One canned body
    // could not answer both, and a stub that answered the fleet JSON to
    // `/health` would be testing the build check against an answer no server
    // sends.
    'url=; for a in "$@"; do url="$a"; done',
    'bf=fixture-health-body; cf=fixture-health-code',
    'case "$url" in',
    '  */api/fleet/health*) ;;',
    '  *) bf=fixture-build-health-body; cf=fixture-build-health-code ;;',
    'esac',
    'code=200',
    '[ -f "$HOME/$cf" ] && read -r code < "$HOME/$cf"',
    'body=',
    '[ -f "$HOME/$bf" ] && read -r body < "$HOME/$bf"',
    'printf \'%s\\n%s\' "$body" "$code"',
  ].join('\n'));
}

/** Point the fixture's `curl` at a canned answer. `body` as a string is the
 *  raw bytes, so a test can hand the check something that is not JSON at all. */
export function stubHealth(home: string, body: Health | string, code = 200): void {
  stubCurl(home);
  rmSync(join(home, 'fixture-curl-exit'), { force: true });
  writeFileSync(join(home, 'fixture-health-body'),
    typeof body === 'string' ? body : JSON.stringify(body));
  writeFileSync(join(home, 'fixture-health-code'), String(code));
}

/** A server that does not answer at all: curl's own exit code, not an HTTP
 *  status. 7 is "failed to connect", the shape a stopped service really has. */
export function stubHealthUnreachable(home: string, exitCode = 7): void {
  stubCurl(home);
  writeFileSync(join(home, 'fixture-curl-exit'), String(exitCode));
}

// ── this box's own stamp, and its own server's /health (Stage 4, Task 9) ──
// `_check_build` compares `~/.ccrc/build.json` (read through ccrc's ONE stamp
// parser, which needs a REAL jq) against what the RUNNING server reports on
// GET /health. `healthy()` therefore models both halves agreeing.

export const HEALTHY_SHA = '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c';

/** `~/.ccrc/build.json`, the stampers' exact shape (no `version` — the build
 *  check compares shas and an unversioned stamp is the common case). */
export function writeStamp(home: string, sha = HEALTHY_SHA): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'build.json'),
    JSON.stringify({ sha, ref: 'main', builtAt: '2026-08-21T00:00:00Z', dirty: false }));
}

/** Point the fixture's `curl` at a canned /health answer — the sibling of
 *  `stubHealth`, for the OTHER route the stub dispatches on. */
export function stubBuildHealth(home: string, body: string, code = 200): void {
  stubCurl(home);
  writeFileSync(join(home, 'fixture-build-health-body'), body);
  writeFileSync(join(home, 'fixture-build-health-code'), String(code));
}

export const healthBodyFor = (sha: string): string =>
  JSON.stringify({ ok: true, build: { sha, ref: 'main', builtAt: '2026-08-21T00:00:00Z', dirty: false } });

/** Every argv the fixture's `curl` saw. Empty means the check never asked. */
export const curlCalls = (home: string): string[] => {
  const p = join(home, 'curl-calls');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** `~/.ccrc/ccrc.env` — the box's own machine-config file
 *  (`deploy/ccrc.env.example`), and the only place on disk that records where
 *  this box's server listens. Written as TEXT, because half of what the address
 *  reader has to get right is which lines it ignores. */
export function writeCcrcEnv(home: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), text);
}

/** `~/.ccrc/remote-control` — the per-box switch `ccd`'s `_rc_enabled` reads to
 *  decide whether a session spawns with `--remote-control` (D-99). Written as
 *  TEXT, and with no newline added for you, because the trailing newline IS the
 *  contract: `read` returns non-zero at EOF-before-delimiter, so `'on'` and
 *  `'on\n'` are two different files and a helper that quietly normalised them
 *  would make the case doctor's third state exists for untestable. */
export function writeRcFlag(home: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'remote-control'), text);
}

/** `systemctl --user is-active <unit>` answers from `<home>/fixture-unit-<unit>`;
 *  with the file absent it answers `inactive` and exits 3, exactly as systemd
 *  does for a unit that is not running. SYSTEM-scope `is-active <unit>` (no
 *  `--user`) answers from `<home>/fixture-system-unit-<unit>` — a SEPARATE
 *  namespace on purpose: the caddy check asks in system scope (caddy binds
 *  :80/:471 as root and is nobody's user unit), and a stub that answered both
 *  scopes from one file could not catch a check asking in the wrong one (a
 *  `--user is-active caddy` reads the OTHER namespace, finds nothing, and the
 *  PASS case reds). Any other argv is a loud failure — a status verb that
 *  started MUTATING a unit could not pass unnoticed. */
export function stubSystemctl(home: string): void {
  stub(home, 'systemctl',
    'if [ "$1" = "--user" ] && [ "$2" = "is-active" ]; then\n'
    // One word per unit, in order, exit 0 only if every unit is active (systemd's own `is-active u1 u2 ...`): `delegation-hooks`
    // asks about all its pending units in one call. With one unit this is the single-unit stub it always was.
    + '  shift 2; rc=0\n'
    + '  for u in "$@"; do\n'
    + '    f="$HOME/fixture-unit-$u"\n'
    + '    if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; [ "$v" = active ] || rc=3; else echo inactive; rc=3; fi\n'
    + '  done\n'
    + '  exit $rc\n'
    + 'fi\n'
    + 'if [ "$1" = "--user" ] && [ "$2" = "list-units" ]; then\n'
    + '  f="$HOME/fixture-scopes"\n'
    + '  if [ -f "$f" ]; then while IFS= read -r l; do echo "$l"; done < "$f"; fi\n'
    + '  exit 0\n'
    + 'fi\n'
    + 'if [ "$1" = "--user" ] && [ "$2" = "show" ] && [ "$3" = "-p" ] && [ "$4" = "ActiveState" ]; then\n'
    // D-5316 (ruling 12): `update-sweep` asks `show -p ActiveState -p NRestarts <unit>` and reads the two lines BY NAME. The
    // answer is the file's own text (a planted `ActiveState=` and `NRestarts=` line, in the order the test chose), and an
    // ABSENT file prints nothing, the manager not answering. The bus is part of the question: with `fixture-bus-required`
    // present the stub answers only when BOTH XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS are set, as a real user manager does from a bare context.
    + '  if [ -f "$HOME/fixture-bus-required" ] && { [ -z "${XDG_RUNTIME_DIR:-}" ] || [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; }; then exit 1; fi\n'
    + '  f="$HOME/fixture-show-$7"\n'
    + '  if [ -f "$f" ]; then while IFS= read -r l; do echo "$l"; done < "$f"; fi\n'
    + '  exit 0\n'
    + 'fi\n'
    // `show-environment` (node-path): answers from `fixture-mgr-env`; an ABSENT file is a box with no user manager (exit 1).
    + 'if [ "$1" = "--user" ] && [ "$2" = "show-environment" ]; then\n'
    + '  f="$HOME/fixture-mgr-env"; [ -f "$f" ] || exit 1\n'
    + '  while IFS= read -r l; do echo "$l"; done < "$f"; exit 0\n'
    + 'fi\n'
    + 'if [ "$1" = "--user" ] && [ "$2" = "daemon-reload" ]; then exit 0; fi\n'
    + 'if [ "$1" = "--user" ] && [ "$2" = "show" ]; then\n'
    // D-5241: `-p OOMPolicy` answers from its own file, so the oom-policy check can never read a ControlGroup.
    + '  f="$HOME/fixture-cgroup-of-$3"; [ "$5" = OOMPolicy ] && f="$HOME/fixture-oompolicy-of-$3"\n'
    + '  if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; fi\n'
    + '  exit 0\n'
    + 'fi\n'
    + 'if [ "$1" = "is-active" ] && [ -n "$2" ]; then\n'
    + '  f="$HOME/fixture-system-unit-$2"\n'
    + '  if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; [ "$v" = active ] && exit 0; exit 3; fi\n'
    + '  echo inactive; exit 3\n'
    + 'fi\n'
    + 'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90');
  stubLaunchctl(home);
}

/** launchd's half of the same fixture, and it answers the same QUESTION from
 *  the same file: `_svc_is_active` reads a job through `launchctl print`, so
 *  `fixture-unit-<unit>` steers both platforms. The label is translated back
 *  to the unit name the fixture files are keyed on, so a test that plants
 *  `fixture-unit-ccrc.service` works unchanged on either. */
export function stubLaunchctl(home: string): void {
  stub(home, 'launchctl',
    'case "$1" in\n'
    + '  print)\n'
    + '    lbl="${2##*/}"\n'
    + '    unit="${lbl#app.ccrc.}"\n'
    + '    case "$unit" in session.*) unit="claude-session@${unit#session.}.service" ;;'
    + ' *) unit="$unit.service" ;; esac\n'
    + '    f="$HOME/fixture-unit-$unit"\n'
    + '    if [ -f "$f" ]; then IFS= read -r v < "$f";'
    // An EMPTY fixture value means "the manager could not be asked", and on
    // launchd that is any failure OTHER than 113 — which is its positive
    // "no such service". The fixture keeps the two apart so the check can.
    + ' [ -n "$v" ] || exit 1;'
    + ' [ "$v" = active ] || exit 113; echo "	state = running"; exit 0; fi\n'
    + '    exit 113 ;;\n'
    + '  bootstrap|bootout|enable|disable|kickstart) exit 0 ;;\n'
    + '  *) echo "fixture launchctl: unexpected argv: $*" >&2; exit 90 ;;\n'
    + 'esac');
}

/** A systemd --user unit FILE, in the directory `deploy.sh (the unit install)` really copies
 *  them to. `_check_services` asks `systemctl` only about units whose file is
 *  HERE, so this is what makes a fixture a server box, a fleet host, or a dev
 *  checkout with no units at all. The CONTENT is irrelevant — nothing reads it;
 *  a real one is the `[Unit]`/`[Service]` text in `deploy/`. */
export function unitDirOf(home: string): string {
  // The directory THIS platform's manager reads job files from — the same
  // choice `CCRC_UNIT_DIR` makes in ccd/ccrc-doctor-checks. A fixture that
  // always wrote to ~/.config/systemd/user would be planting units no macOS
  // box ever looks at, and every `services` verdict would then measure the
  // fixture's mistake rather than the check.
  return process.platform === 'darwin'
    ? join(home, 'Library', 'LaunchAgents')
    : join(home, '.config', 'systemd', 'user');
}

/** A unit's file name in this platform's spelling — `ccrc.service` on Linux,
 *  `app.ccrc.ccrc.plist` on macOS. Mirrors `_dr_unit_file`. */
export function unitFileOf(unit: string): string {
  if (process.platform !== 'darwin') return unit;
  const base = unit.replace(/\.(service|timer)$/, '');
  return `app.ccrc.${base}.plist`;
}

export function writeUnitFile(home: string, unit: string): void {
  const d = unitDirOf(home);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, unitFileOf(unit)), `# fixture unit file for ${unit}\n`);
}

/** The inverse — "this box does NOT have that unit", in the same spelling. */
export function removeUnitFile(home: string, unit: string): void {
  rmSync(join(unitDirOf(home), unitFileOf(unit)), { force: true });
}

/** `df -Pk <dir>` answering a POSIX table whose Available column (field 4, in
 *  KiB) comes from `<home>/fixture-df-avail`. `<home>/fixture-df-exit` makes it
 *  exit that code printing nothing — the shape a df that cannot stat a stale
 *  mount really has, and the only way to reach the "answered nothing I can
 *  read" arm. Any other argv is a loud failure (exit 90), so a check that
 *  started shelling out to `df -h` (whose numbers are NOT KiB) could not pass
 *  unnoticed. Shell builtins only: this fixture's PATH holds no system
 *  directory, so a stub reaching for `cat` or `awk` would not run. */
export function stubDf(home: string, availKiB = 42_991_616): void {
  stub(home, 'df', [
    'printf \'%s\\n\' "$*" >> "$HOME/df-calls"',
    'if [ -f "$HOME/fixture-df-exit" ]; then read -r c < "$HOME/fixture-df-exit"; exit "$c"; fi',
    'if [ "$1" = "-Pi" ] && [ -n "$2" ]; then',
    '  echo "Filesystem      Inodes IUsed   IFree IUse% Mounted on"',
    '  echo "/dev/fixture0  1000000 10000  990000    1% /"',
    '  exit 0',
    'fi',
    'if [ "$1" = "-Pk" ] && [ -n "$2" ]; then',
    '  avail=0',
    '  [ -f "$HOME/fixture-df-avail" ] && read -r avail < "$HOME/fixture-df-avail"',
    '  echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    '  echo "/dev/fixture0    104857600  20971520 $avail      21% /"',
    '  exit 0',
    'fi',
    'echo "fixture df: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  writeFileSync(join(home, 'fixture-df-avail'), `${availKiB}\n`);
  rmSync(join(home, 'fixture-df-exit'), { force: true });
}

/** A `df` that answers per PATH, so a work root can sit on a second filesystem. One row per line of
 *  `<home>/fixture-df-map`: `<path prefix>|<mount>|<size KiB>|<used KiB>|<avail KiB>|<inodes>|<iused>|<ifree>`; the
 *  first row whose prefix is the asked path, or a parent of it, answers. A path no row matches exits 1 printing
 *  nothing (a mount df cannot stat). A mount spelled `garbled` answers a line with no numbers. Shell builtins only. */
export interface DfRow { prefix: string; mount: string; sizeKiB: number; usedKiB: number; availKiB: number; inodes?: number; iused?: number }
export function stubDfMap(home: string, rows: DfRow[]): void {
  stub(home, 'df', [
    'printf \'%s\\n\' "$*" >> "$HOME/df-calls"',
    'mode="$1"; path="$2"',
    'while IFS="|" read -r pre mnt size used avail ino iu ifr; do',
    '  hit=0',
    '  case "$path" in "$pre"|"$pre"/*) hit=1 ;; esac',
    '  [ "$pre" = "*" ] && hit=1',
    '  if [ "$hit" = 1 ]; then',
    '    if [ "$mnt" = garbled ]; then echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "dev - - - - /garbled"; exit 0; fi',
    '    if [ "$mode" = "-Pk" ]; then',
    '      echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    '      echo "/dev/fx $size $used $avail 1% $mnt"; exit 0',
    '    fi',
    '    echo "Filesystem Inodes IUsed IFree IUse% Mounted on"',
    '    echo "/dev/fx $ino $iu $ifr 1% $mnt"; exit 0',
    '  fi',
    'done < "$HOME/fixture-df-map"',
    'exit 1',
  ].join('\n'));
  writeFileSync(join(home, 'fixture-df-map'), rows.map((r) => {
    const inodes = r.inodes ?? 1_000_000, iused = r.iused ?? 10_000;
    return [r.prefix, r.mount, r.sizeKiB, r.usedKiB, r.availKiB, inodes, iused, inodes - iused].join('|');
  }).join('\n') + '\n');
}

// ── stage 3b: the exposure quartet's fixtures ─────────────────────────────
// Four checks (`exposure`, `caddy`, `cert`, `name`), one shared subject: the
// file `ccrc expose` writes. The token below is a CANARY — it must never
// appear in a run's output, and the test that says so runs the WHOLE doctor.

export const CANARY_TOKEN = 'fixture-canary-duckdns-token-3b';
export const EXPOSED_HOST = 'fixture.duckdns.org';

export interface ExposureOpts {
  origin?: string; rpid?: string;
  /** false = the byo shape: origin + rp id, no ddns trio at all. */
  duckdns?: boolean;
  domain?: string; token?: string;
  mode?: number;
  /** key names to leave out entirely — how a hand-edited half-file is made. */
  omit?: string[];
  /** the ip arm's shape (stage 5, S10): origin `https://<addr>`, NO rp id,
   *  no ddns trio, plus CCRC_EXPOSE_MODE=ip + CCRC_EXPOSE_ADDR. */
  ip?: string;
}

/** `~/.ccrc/exposure.env`, in the shape `_exp_env_write` really writes it:
 *  a comment line, then KEY=value pairs, 0600 unless a test is ABOUT the mode. */
export function writeExposureEnv(home: string, o: ExposureOpts = {}): void {
  const lines = ["# ccrc exposure config — fixture, the shape _exp_env_write writes."];
  const put = (k: string, v: string): void => {
    if (!(o.omit ?? []).includes(k)) lines.push(`${k}=${v}`);
  };
  if (o.ip) {
    put('CCRC_ORIGIN', o.origin ?? `https://${o.ip}`);
    put('CCRC_AUTH', 'on');
    put('CCRC_EXPOSE_MODE', 'ip');
    put('CCRC_EXPOSE_ADDR', o.ip);
  } else {
    put('CCRC_ORIGIN', o.origin ?? `https://${EXPOSED_HOST}`);
    put('CCRC_RP_ID', o.rpid ?? EXPOSED_HOST);
    // EVERY arm, as `_exp_env_write` writes it (`printf '%s\n' "CCRC_AUTH=on"`
    // precedes its ip branch, D-162). This branch omitted it until W4's
    // `update-exposure` check became the first reader of the key in this
    // file — the parity case in that describe runs the real writer and reds
    // on the drift. `omit: ['CCRC_AUTH']` is how a test makes an unarmed one.
    put('CCRC_AUTH', 'on');
    if (o.duckdns ?? true) {
      put('CCRC_DDNS_PROVIDER', 'duckdns');
      put('CCRC_DDNS_DOMAIN', o.domain ?? EXPOSED_HOST);
      put('CCRC_DDNS_TOKEN', o.token ?? CANARY_TOKEN);
    }
  }
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const p = join(home, '.ccrc', 'exposure.env');
  writeFileSync(p, lines.join('\n') + '\n');
  chmodSync(p, o.mode ?? 0o600);
}

/** An openssl-shaped `notAfter=` value `days` from now, in the one format
 *  `openssl x509 -enddate` prints ("Aug 30 12:00:00 2026 GMT") — which GNU
 *  `date -d` (linked real into the fixture) parses back. Second precision, so
 *  the check's integer day count lands on `days` or `days - 1`. */
export function endDateFixture(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${mon} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`;
}

/** openssl, answering the ONLY two argv shapes the cert check sends — both
 *  hops of its pipeline. `s_client` answers a handshake marker (or, with
 *  `<home>/fixture-tls-refused` planted, fails the way a closed :471 really
 *  does); `x509 -noout -enddate` answers `notAfter=` from
 *  `<home>/fixture-cert-enddate`. Every argv is logged to
 *  `<home>/openssl-calls`, so a test can prove the SNI host and the loopback
 *  address were really sent. Any other argv is a loud failure (exit 90). */
export function stubOpenssl(home: string): void {
  stub(home, 'openssl', [
    'printf \'%s\\n\' "$*" >> "$HOME/openssl-calls"',
    'if [ "$1" = "s_client" ]; then',
    '  addr=""; prev=""',
    '  for a in "$@"; do [ "$prev" = "-connect" ] && addr="${a%%:*}"; prev="$a"; done',
    '  if [ -f "$HOME/fixture-tls-refused" ]; then',
    '    echo "connect:errno=111" >&2; exit 1',
    '  fi',
    // Per-address refusal — the caddy-binds-one-interface topology (the live
    // 2026-08-21 ceremony: tailscaled owns the tailnet IP's :471, caddy binds
    // the public IP only, loopback refuses).
    '  if [ -f "$HOME/fixture-tls-refused-addrs" ]; then',
    '    while IFS= read -r bad; do',
    '      if [ "$bad" = "$addr" ]; then echo "connect:errno=111" >&2; exit 1; fi',
    '    done < "$HOME/fixture-tls-refused-addrs"',
    '  fi',
    '  echo "FIXTURE-TLS-SESSION"; exit 0',
    'fi',
    'if [ "$1" = "x509" ] && [ "$2" = "-noout" ] && [ "$3" = "-enddate" ]; then',
    '  read -r _piped || :',
    '  if [ -f "$HOME/fixture-cert-enddate" ]; then IFS= read -r d < "$HOME/fixture-cert-enddate"; echo "notAfter=$d"; exit 0; fi',
    '  exit 1',
    'fi',
    'echo "fixture openssl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
}

/** `getent hosts <domain>` answers the resolver table from
 *  `<home>/fixture-getent` (address first, name after — getent's own column
 *  order); with the file absent it exits 2 printing nothing, exactly as getent
 *  does for a name that does not resolve. Argv is logged. */
export function stubGetent(home: string): void {
  stub(home, 'getent', [
    'printf \'%s\\n\' "$*" >> "$HOME/getent-calls"',
    'if [ "$1" = "hosts" ] && [ -n "$2" ]; then',
    '  if [ -f "$HOME/fixture-getent" ]; then',
    '    while IFS= read -r l; do printf \'%s\\n\' "$l"; done < "$HOME/fixture-getent"',
    '    exit 0',
    '  fi',
    '  exit 2',
    'fi',
    'echo "fixture getent: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
}

/** `hostname -I` answers this box's interface addresses from
 *  `<home>/fixture-host-ips` — one line, space-separated, exactly the real
 *  flag's shape. The name check compares the resolved record against these
 *  "where discoverable" (spec D6). */
export function stubHostname(home: string): void {
  stub(home, 'hostname', [
    'if [ "$1" = "-I" ]; then',
    '  if [ -f "$HOME/fixture-host-ips" ]; then IFS= read -r v < "$HOME/fixture-host-ips"; echo "$v"; exit 0; fi',
    '  exit 1',
    'fi',
    'echo "fixture hostname: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
}

/** `n` ccd sessions in the registry, as ccd itself counts them: one `<id>.uuid`
 *  file each (the ccd scan). */
export function writeSessions(home: string, n: number): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(reg, `proj-${i}.uuid`), `uuid-${i}\n`);
}

/** `ghContainedEnv` PLANTS the poisoned `gh` every time it is called, so it is
 *  called exactly once per fixture — here — and the PATH it returns is
 *  remembered. Calling it again from `runDoctor` would re-plant the poison over
 *  whatever `ghStub` had put there, which is precisely the bug this memo fixes:
 *  measured, every gh_auth test saw exit 97 instead of its own canned answer. */
export const containedPathFor = new Map<string, string>();
export function containedPath(home: string): string {
  let p = containedPathFor.get(home);
  if (p === undefined) {
    p = ghContainedEnv(home, { PATH: stubBin(home) })['PATH'] ?? '';
    containedPathFor.set(home, p);
  }
  return p;
}

export function doctorEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    PATH: containedPath(home),
    LC_ALL: 'C',
    // verify-service.sh's `CCRC_VERIFY_*` model: a knob whose only reason to
    // exist is that a test must not wait out a production timeout.
    CCRC_DOCTOR_GH_TIMEOUT: '5',
    // D-166's knob, and the only reason it exists: `_check_caddyfile`
    // measures /etc/caddy/Caddyfile, which no test may create and no test
    // should ever need root to create. Pointed at a path inside the fixture
    // HOME, it measures the same three facts (a symlink, an absence, a
    // staleness) against files a test owns.
    CCRC_CADDY_SYSTEM_FILE: sysCaddyfile(home),
    // `_check_scopes` reads a cgroup tree and a proc tree. Neither can be
    // created by a test on the real box (/sys/fs/cgroup is the kernel's, /proc
    // is not writable), so both roots are seams — the same shape as
    // CCRC_CADDY_SYSTEM_FILE above, and for the same reason.
    CCRC_CGROUP_ROOT: join(home, 'fixture-cgroup'),
    CCRC_PROC_ROOT: join(home, 'fixture-proc'),
    CCRC_SCOPE_SETTLE_SEC: '1',
    // `_check_scope-sweep` reads the sweep's verdict record from the runtime dir;
    // a test must never read a real box's, so the record is a fixture file.
    CCRC_SCOPE_SWEEP_STATE: join(home, 'fixture-scope-sweep.state'),
    // codex-bridge Stage 1 (Global Constraints): every spawn that can run the auth library names a loopback endpoint
    // nothing answers. The doctor's `codex` check only asks `status` and `paths`, which make no request.
    CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE,
  };
}

/** A pane scope, its cgroup, and the proc entries for the pids inside it.
 *  `stuck` names the pids parked on the reclaim wchan — everything else gets
 *  an ordinary one, so a fixture never accidentally reads as throttled. */
export function plantScope(home: string, o: {
  unit?: string; procs: number[]; stuck?: number[]; current?: number; high?: number;
}): void {
  const unit = o.unit ?? 'tmux-spawn-fixture.scope';
  const cg = `/user.slice/app.slice/app-claude.slice/${unit}`;
  const cgdir = join(home, 'fixture-cgroup', cg);
  mkdirSync(cgdir, { recursive: true });
  writeFileSync(join(cgdir, 'cgroup.procs'), `${o.procs.join('\n')}\n`);
  writeFileSync(join(cgdir, 'memory.current'), `${o.current ?? 3 * 1024 ** 3}\n`);
  writeFileSync(join(cgdir, 'memory.high'), `${o.high ?? 8 * 1024 ** 3}\n`);
  for (const pid of o.procs) {
    const pd = join(home, 'fixture-proc', String(pid));
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, 'wchan'),
      (o.stuck ?? []).includes(pid) ? 'mem_cgroup_handle_over_high' : 'do_epoll_wait');
  }
  appendFileSync(join(home, 'fixture-scopes'), `${unit} loaded active running\n`);
  writeFileSync(join(home, `fixture-cgroup-of-${unit}`), `${cg}\n`);
}

/** D-5241: the victim policy's two OOMPolicy=continue drop-ins, at the paths `_inst_units` places them (systemd only,
 *  so the Linux unit directory whatever the host). `fixture-oompolicy-of-<unit>` is what the stub's `show -p OOMPolicy`
 *  answers for a scope. */
export const OOM_DROPIN = {
  pane: join('tmux-spawn-.scope.d', '50-oom-continue.conf'),
  server: join('ccrc-tmux-server.scope.d', '50-oom-continue.conf'),
} as const;
export function plantOomDropins(home: string, which: ReadonlyArray<keyof typeof OOM_DROPIN> = ['pane', 'server']): void {
  for (const k of which) {
    const p = join(home, '.config', 'systemd', 'user', OOM_DROPIN[k]);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, '[Scope]\nOOMPolicy=continue\n');
  }
}
export function plantOomPolicy(home: string, unit: string, value: string): void {
  writeFileSync(join(home, `fixture-oompolicy-of-${unit}`), `${value}\n`);
}

/** The fixture's stand-in for /etc/caddy/Caddyfile — outside `~/.ccrc`, since
 *  the real one is outside the home entirely and `ccrcDirEntries`-style
 *  assertions elsewhere would otherwise see it. */
export const sysCaddyfile = (home: string): string => join(home, 'etc-caddy-Caddyfile');

/** The ceremony, performed: the generated Caddyfile copied to the system path,
 *  the copy no older than its source (what `install` leaves behind). */
export function performCaddyCeremony(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const src = join(home, '.ccrc', 'Caddyfile');
  if (!existsSync(src)) {
    writeFileSync(src, `${EXPOSED_HOST} {\n    reverse_proxy 127.0.0.1:7788\n}\n`);
  }
  copyFileSync(src, sysCaddyfile(home));
  // `install` preserves nothing about mtime, but it does run AFTER the source
  // was written, so the copy is never older. Stamp both to the same instant so
  // the `-nt` comparison is decided by the test, not by filesystem timestamp
  // granularity.
  const t = new Date();
  utimesSync(src, t, t);
  utimesSync(sysCaddyfile(home), t, t);
}

/** THE DEADLINE BINARY, resolved and PROBED once — the per-file house pattern
 *  here (`ccd-plat-timeout.test.ts` and `ccd-lifecycle-sites.test.ts` each
 *  resolve their own), not a second copy of a single-sourced mechanism.
 *  Needed because `runDoctor` below has NO bound, and F2's case plants a FIFO:
 *  pre-fix the catalogue read blocks INSIDE `readFileSync`, so an unbounded
 *  run would hang the whole suite instead of failing it. `spawnSync`'s own
 *  `timeout` cannot do this job — it signals only the DIRECT child (`bash`),
 *  never the `node` grandchild blocked on the FIFO, which then survives the
 *  run. GNU `timeout` puts the child in its own process group and signals the
 *  GROUP, so the blocked grandchild dies with it.
 *
 *  PRESENCE IS NOT ENOUGH (D-2840): a busybox-shaped `timeout` that refuses
 *  `-k` resolves via `command -v` and then answers every case with rc 125
 *  before the guard under test ever runs. So each candidate is PROBED with a
 *  known-124 command, and one that does not answer 124 is treated as absent. */
export const DOCTOR_DEADLINE_BIN: string | null = (() => {
  for (const candidate of ['timeout', 'gtimeout']) {
    const found = spawnSync('sh', ['-c', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status !== 0) continue;
    const bin = (found.stdout ?? '').trim();
    if (!bin) continue;
    const probe = spawnSync(bin, ['-k', '1', '0.1', 'sleep', '5'], { encoding: 'utf8' });
    if (probe.status === 124) return bin;
  }
  return null;
})();

/** `ccrc doctor`, bounded by the process GROUP. A hang becomes a readable
 *  failure — never a hung suite. */
export function runDoctorBounded(home: string, ms = 10000, extraEnv: NodeJS.ProcessEnv = {}): Result {
  if (DOCTOR_DEADLINE_BIN === null) {
    throw new Error('runDoctorBounded: no usable `timeout`/`gtimeout` — cannot bound this call safely');
  }
  const r = spawnSync(DOCTOR_DEADLINE_BIN,
    ['-k', '1', String(ms / 1000), BASH, ccrcIn(home), 'doctor'],
    { env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8' });
  if (r.status === 124) {
    throw new Error(
      `runDoctorBounded did not return within ${ms}ms — either a catalogue guard regressed `
      + 'or this box is loaded; re-run in isolation before concluding');
  }
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function runDoctor(home: string, args: string[] = ['doctor'], extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args],
    { env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The four shipped skill trees and the name each installs under in a home —
 *  `_check_skills`' subject. One list for `healthy()` and `healthyCodexBox()`. */
export const SHIPPED_SKILLS = [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer'], ['history-skill', 'ccrc-history']] as const;

/** The hook installer a fixture tree carries beside the doctor file, and the approved event set as an INDEPENDENT
 *  reader of it sees it: `EVENTS_JSON` (the events that get a matcher-less managed entry) plus `PreToolUse`, the one
 *  event the installer registers on its own line with matcher `*`. The doctor check reads the same `EVENTS_JSON`
 *  line at run time; this reader exists so no test (and no fixture) types the list a second time. */
export const DH_INSTALLER = join(REPO, 'ccd', 'install-session-hooks.sh');
export function installerEvents(src = readFileSync(DH_INSTALLER, 'utf8')): string[] {
  const m = /^EVENTS_JSON='(\[[^\n']*\])'$/m.exec(src);
  if (m === null) throw new Error('ccd/install-session-hooks.sh no longer holds EVENTS_JSON=\'[...]\' in the shape this reader takes');
  const events = JSON.parse(m[1]!) as string[];
  if (events.length === 0) throw new Error('EVENTS_JSON is empty');
  return [...events, 'PreToolUse'];
}

/** `<home>/<suffix>/settings.json` as the shipped installer leaves it: one managed entry per approved event,
 *  `PreToolUse` carrying matcher `*`. `omit` drops events, `foreign` adds registrations the installer never writes,
 *  and `extra` merges unrelated keys (a secret-looking one, in the cases that assert nothing is echoed). */
/** The entry's command and timeout, read from the installer's own `HOOK_CMD` and `HOOK_TIMEOUT_S` (as `installerEvents()`
 *  reads `EVENTS_JSON`), so a fixture registration can never drift from what the installer writes. */
export function installerHook(src = readFileSync(DH_INSTALLER, 'utf8')): { command: string; timeout: number } {
  const c = /^HOOK_CMD='([^\n']*)'$/m.exec(src);
  const tm = /^HOOK_TIMEOUT_S=(\d+)$/m.exec(src);
  if (c === null || tm === null) throw new Error('ccd/install-session-hooks.sh no longer holds HOOK_CMD=\'...\' and HOOK_TIMEOUT_S=<n> in the shape this reader takes');
  return { command: c[1]!, timeout: Number(tm[1]) };
}
export type RegistrationOpts = { omit?: string[]; foreign?: string[]; ownWorktree?: string[]; extra?: Record<string, unknown>; events?: string[] };
export function registrationHooks(o: RegistrationOpts = {}): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> = {};
  const hook = installerHook();
  for (const ev of o.events ?? installerEvents()) {
    if (o.omit?.includes(ev)) continue;
    const h = { type: 'command', command: hook.command, ...(ev === 'SessionEnd' ? {} : { timeout: hook.timeout }) };
    hooks[ev] = [ev === 'PreToolUse' ? { matcher: '*', hooks: [h] } : { hooks: [h] }];
  }
  for (const ev of o.ownWorktree ?? []) hooks[ev] = [{ hooks: [{ type: 'command', command: hook.command }] }];
  for (const ev of o.foreign ?? []) hooks[ev] = [{ hooks: [{ type: 'command', command: 'bash "$HOME/bin/their-worktree-hook.sh"' }] }];
  return hooks;
}
export function plantHookRegistration(home: string, suffix: string, o: RegistrationOpts = {}): void {
  const hooks = registrationHooks(o);
  mkdirSync(join(home, suffix), { recursive: true });
  // Keys the home already carries (a lane's `env` block, `materialise`'s output) survive: the installer merges, and so does this.
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(readFileSync(join(home, suffix, 'settings.json'), 'utf8')) as Record<string, unknown>; } catch { /* a fresh home */ }
  writeFileSync(join(home, suffix, 'settings.json'), JSON.stringify({ ...cur, hooks, ...(o.extra ?? {}) }, null, 2));
}

/** `$REG/delegation/spool/<id>`, the owner directory ccd makes at spawn (mode 0700). */
export function plantSpoolDir(home: string, id: string): string {
  const d = join(home, '.cc-sessions', 'delegation', 'spool', id);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** `python3 -I -c <program>` for the two programs `_check_box-token` runs (`_BT_PY_STATE`, `_BT_PY_FLEET` in
 *  `ccd/ccrc-doctor-checks`), handed to the real interpreter; the text is read from the shipped file so a third or an
 *  edited program still reaches the stub's bare `exit 0`. Empty when this box has no python3 (the check then says so).
 *  Its second arm (codex-bridge Stage 1, Task 9) hands `python3 -IS $HOME/.local/bin/ccgpt-auth.py …` to the real
 *  interpreter too: `_codex_auth`'s exact argv, so the doctor's `codex` check reads the placed library's own `status`
 *  (or a case's stand-in at that path) instead of the stub's empty answer, which `_codex_auth_status` refuses. */
export const BT_PY_ARM = ((): string => {
  const real = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
  if (real === '') return '';
  const src = readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8');
  const progs = ['_BT_PY_STATE', '_BT_PY_FLEET'].map((n) => {
    const m = new RegExp(`^${n}='([^']*)'$`, 'm').exec(src);
    if (!m) throw new Error(`ccd/ccrc-doctor-checks no longer holds ${n}='…' in the shape this stub reads`);
    return `'${m[1]}'`;
  });
  return `if [ "$1" = "-I" ] && [ "$2" = "-c" ]; then case "$3" in ${progs.join('|')}) exec '${real}' "$@" ;; esac; fi\n`
    + `if [ "$1" = "-IS" ] && [ "$2" = "$HOME/.local/bin/ccgpt-auth.py" ]; then exec '${real}' "$@"; fi\n`;
})();

/** A box where every check passes. Each per-check test starts here and breaks
 *  exactly ONE thing, so a red line is attributable to that one removal. */
/** A box `_node_publish` ran on: three links into the fixture's stub bin (`node` is the version stub; `npm`/`npx` are
 *  presence stubs), the environment.d fragment, and a user manager whose PATH carries the link directory, so `node-path`
 *  PASSes. Linux only: on darwin the check SKIPs and nothing is published. */
export function plantNodePublication(home: string): void {
  const dir = join(home, '.local', 'libexec', 'ccrc', 'node-bin');
  mkdirSync(dir, { recursive: true });
  for (const b of ['npm', 'npx']) stub(home, b, 'exit 0');
  for (const b of ['node', 'npm', 'npx']) symlinkSync(join(stubBin(home), b), join(dir, b));
  mkdirSync(join(home, '.config', 'environment.d'), { recursive: true });
  writeFileSync(join(home, '.config', 'environment.d', '50-ccrc-node.conf'), `PATH=${dir}:\${PATH}\n`);
  writeFileSync(join(home, 'fixture-mgr-env'), `PATH=${dir}:/usr/bin\n`);
}

export function healthy(prefix: string): string {
  const home = mkTmp(prefix);
  installCcrc(home);
  // A box with exposure configured owes a Caddyfile AND the copy of it that
  // caddy reads (D-166) — so the healthy fixture performs the ceremony, and
  // the per-check tests below break exactly one part of it.
  performCaddyCeremony(home);
  containedPath(home);   // plant the poisoned gh FIRST; ghStub overwrites it below
  writePkg(home, '>=1.0.0');
  stubNode(home, 'v22.20.0');
  // The approval wait's two checks (coordinator-first routing, plan Task 14): the server's key is pinned, so
  // `approval-key` PASSes. `healthy()` never creates `~/.cc-sessions` (the no-registry box the pools and transcripts
  // describes rely on), so `approval-verifier-runnable` SKIPs, counted in `HEALTHY_SKIPS`. `ccrc-approval-key.test.ts`
  // plants the registry and breaks each piece.
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'approval-signing.pub'), '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----\n');
  stub(home, 'flock', 'exit 0');
  // `python3` is a presence stub, except for the box-token check's two JSON readers, which go to the real interpreter
  // by EXACT program text (read from the shipped checks file): a stub that prints nothing makes them read `state-unreadable`
  // and `sync-unreadable`, which are FAIL and WARN now that the arms are on.
  stub(home, 'python3', `${BT_PY_ARM}exit 0`);
  // jq is REAL here, not a presence stub (Stage 4, Task 9): `_check_build`
  // reads the box's stamp through ccrc's one parser (`_box_build_fields`),
  // which parses with jq — a stub that exits 0 printing nothing would make
  // every stamp "unreadable". The presence check (`_dr_need_bin jq`) is
  // equally satisfied by the real thing, and `statusBox` below already made
  // this exact swap for the same reader.
  linkReal(home, 'jq');
  linkReal(home, 'awk');
  // A pane scope with nothing parked: `_check_scopes` PASSes, and returns
  // WITHOUT settling, so the healthy fixture costs no extra second.
  plantScope(home, { procs: [4101, 4102] });
  // D-5241: both scope drop-ins on disk and the pane scope reading `continue`: `oom-policy` PASSes.
  plantOomDropins(home);
  plantOomPolicy(home, 'tmux-spawn-fixture.scope', 'continue');
  // The pane-scope sweep's verdict record, fresh and empty: `scope-sweep` PASSes.
  writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v1 tick=${Math.floor(Date.now() / 1000)} up=8640000 mode=shadow\n`);
  // tmux answers its versions, client and server agreeing — a healthy box is
  // one where every check PASSES (see the fleet note below), and tmux_skew
  // measures a version pair, not a presence.
  stubTmux(home);
  stubGit(home);
  writeFileSync(join(home, 'fixture-git-email'), 'ops@example.invalid\n');
  stubLoginctl(home);
  writeFileSync(join(home, 'fixture-linger'), 'yes\n');
  ghStub(home, GH_OK, 0);
  // The platform's own deadline tool: bare `timeout` is GNU and a macOS box
  // carries `gtimeout` (Homebrew coreutils) instead — `_plat_timeout` looks
  // for both, in that order. Linking the name the host actually has is what
  // lets the deadline-dependent checks run on either.
  linkReal(home, process.platform === 'darwin' ? 'gtimeout' : 'timeout');
  // A healthy box HAS a roster, and what the roster says is on disk. The
  // smallest true one: the upstream account and its binary. Every wrappers test
  // below starts here and adds (or replaces) exactly what it is about.
  writeBinary(home, 'claude');
  writeRoster(home, [UPSTREAM]);
  // …and the upstream home carries the shipped skills, byte for byte —
  // `skills` is a check, and healthy()'s contract is that every check
  // PASSES. Copies, not symlinks: diff -r follows symlinks either way, but a
  // copy is what the installer actually leaves.
  for (const [tree, name] of SHIPPED_SKILLS) {
    cpSync(join(REPO, 'ccd', tree), join(home, '.claude', 'skills', name), { recursive: true });
  }
  // `_check_skills` compares them with `diff -r`, which this file's contained
  // PATH does not otherwise carry (D-3023 — not one of the brief's own two
  // plantings, but without it `skills` WARNs "diff is not on PATH" on every
  // fixture in this suite, including `healthy()` itself, which must PASS).
  linkReal(home, 'diff');
  // …and its settings.json registers the shipped session hook for every approved event: `delegation-hooks` is a check, and
  // healthy()'s contract is that every check PASSES (no live session owes a spool directory here).
  plantHookRegistration(home, '.claude');
  // …and its credential is where the convention says it is. A healthy box is one
  // where every check PASSES, and `credentials` measures exactly this: the
  // roster declares one telemetry:'anthropic' account, so there is one file it
  // must have. Contents are never read by the check (or by this fixture) —
  // existence and non-emptiness are the whole question.
  mkdirSync(join(home, '.cc-secrets'), { recursive: true }); writeFileSync(join(home, '.ccrc', 'snapshot-posture'), 'none\n'); plantHealthyBackupTools(home);   // A11b: the stated answer, and macOS's two tools
  writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'),
    'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-real-token\n', { mode: 0o600 });
  // …and it knows where its server is, and that server says the two boxes
  // agree. A healthy box is one where every check PASSES, so the fleet check
  // has to have something to measure here — a fixture whose fleet check SKIPPED
  // would make "runs every check in the table" and every summary count below
  // assert a weaker thing.
  writeCcrcEnv(home, [
    '# a real one carries tokens too; the reader must ignore them',
    // …and it says which mode this box runs in, coherently — `config` measures
    // exactly that. `local` needs no agent URL or token, which is what makes
    // this file a PASS rather than the boot-refusal FAIL a half-configured
    // `remote` gets (server/src/index.ts#main).
    'CCRC_FLEET=local',
    'CCRC_HOST=ccrc-fixture.invalid',
    'CCRC_PORT=7788',
    '',
  ].join('\n'));
  stubHealth(home, { mode: 'remote', connected: true, downSince: null, build: 'agreed', roster: 'agreed' });
  // …and it is STAMPED, and the server RUNNING here reports the same sha on
  // /health (Stage 4, Task 9) — `build` is a check, and `healthy()`'s contract
  // is that every check PASSES (several tests assert summary counts on it).
  writeStamp(home);
  stubBuildHealth(home, healthBodyFor(HEALTHY_SHA));
  // …and it COMPLETED an install that `ccrc update` verified: the one-line
  // completed-install record (design 2026-09-20 §5 — a line 2 reading
  // `unsigned` marks a tree nobody verified). `provenance` is a check, and
  // healthy()'s contract is that every check PASSES.
  writeFileSync(join(home, '.ccrc', 'installed'), `${HEALTHY_SHA}\n`);
  // …and its PWA has a passphrase set. A box with none is a real and common
  // state — it is what `ccrc install` leaves behind, deliberately — but it is a
  // WARN (`auth`), and `healthy()`'s contract is that every check PASSES, which
  // several tests below assert on directly ("0 warned").
  writeAuthSecret(home);
  // …and it is a SERVER BOX that has been installed: the two unit files
  // `ccrc install` leaves in `~/.config/systemd/user`, both running, and a
  // filesystem with room on it. `path` needs no fixture at all — `<home>/.local/bin`
  // is already the head of every contained PATH (`ghContainedEnv`), which is
  // what the `path` check measures.
  stubSystemctl(home);
  if (process.platform !== 'darwin') plantNodePublication(home);   // darwin: `node-path` SKIPs (HEALTHY_SKIPS)
  // `ccd-cap-scopes.timer` EXISTS ONLY ON LINUX, and a healthy fixture has to
  // say so: its job is to cap tmux pane CGROUP scopes, macOS has neither, and
  // `_inst_units`' Darwin arm deliberately installs no such job. Planting it
  // here would make the fixture describe a box `ccrc install` cannot produce
  // — and every `services` verdict would then be measured against a timer
  // that has no business existing.
  const HEALTHY_UNITS = process.platform === 'darwin'
    ? ['ccrc.service']
    : ['ccrc.service', 'ccd-cap-scopes.timer'];
  for (const u of HEALTHY_UNITS) {
    writeUnitFile(home, u);
    writeFileSync(join(home, `fixture-unit-${u}`), 'active\n');
  }
  stubDf(home);
  // …and it is EXPOSED (stage 3b): `ccrc expose duckdns` has been run — the
  // exposure file is 0600 with the whole duckdns set, the caddy system unit is
  // active, the served cert is 90 days out, and the DDNS record resolves to an
  // address this box's own interfaces carry. `healthy()`'s contract is that
  // every check PASSES, and the quartet is four more checks. `stat` and `date`
  // are the real binaries (a mode readout and GNU date's parser are the things
  // under test, not things to imitate); everything else is a stub.
  writeExposureEnv(home);
  linkReal(home, 'stat');
  linkReal(home, 'date');
  writeFileSync(join(home, 'fixture-system-unit-caddy'), 'active\n');
  stubOpenssl(home);
  writeFileSync(join(home, 'fixture-cert-enddate'), `${endDateFixture(90)}\n`);
  stubGetent(home);
  writeFileSync(join(home, 'fixture-getent'), `203.0.113.7     ${EXPOSED_HOST}\n`);
  stubHostname(home);
  writeFileSync(join(home, 'fixture-host-ips'), '203.0.113.7 10.0.0.5\n');
  // …and it has run `ccrc install`'s graphify step (Task 11 of the
  // graphify-fleet-integration plan): a venv engine answering `--version`
  // with what the pin stamp says, and a fresh `ok` census. This fixture
  // never writes `~/.ccrc/accounts.sh` (no test here needs a roster), so
  // the `graphify` check's skills/excludes/worktrees-disk conditions have
  // nothing on this box to measure and stay silent on their own — only the
  // engine and the census always have a subject, and `healthy()`'s contract
  // is that every check PASSES.
  mkdirSync(join(home, '.ccrc', 'graphify-venv', 'bin'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'graphify-venv', 'bin', 'graphify'),
    '#!/bin/sh\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
  // R3: `graphify-path` is a check, and healthy()'s contract is that every
  // check PASSES. `<home>/.local/bin` is already the head of the contained
  // PATH (`ghContainedEnv` -> `harnessBin`, which also creates the directory),
  // so the link is what `command -v graphify` finds.
  //
  // `linkReal(home, 'realpath')` IS LOAD-BEARING, not tidiness — but for the
  // SKIP it prevents, not for a failing verdict (D-1354 corrects the R3
  // sentence that stood here, which described the check as D-1350 found it
  // rather than as D-1350 left it). This file's contained PATH is
  // `<home>/.local/bin:<home>/stub-bin` and NO system directory — it links in
  // only jq, timeout, stat and date. `_check_graphify-path` resolves both
  // sides with `realpath`, and since D-1350 it answers an unreachable
  // `realpath` with a SKIP: it does not guess from the unresolved paths, so a
  // converged-but-realpath-less box is never handed the mismatch verdict. That
  // makes a missing `realpath` a COUNTING defect here, not a failing one —
  // `HEALTHY_SKIPS` is how many skips a healthy box is allowed, and one more
  // moves every summary pin that reads it.
  //
  // Measured 2026-09-02, by deleting this one line and re-running this file:
  // baseline `Tests  314 passed | 3 skipped (317)`; without it `Tests  7
  // failed | 307 passed | 3 skipped (317)`, with doctor printing `SKIP
  // graphify-path: this box has no usable realpath …`. All seven reds are
  // skip/verdict COUNTS: the three `(N skipped)` summary pins (tmux_skew,
  // config fleet-role, fleet local), both `expect(skipped).toBe(HEALTHY_SKIPS)`
  // assertions, the `"… 1 warned, 1 failed"` pin (which red on `(0 skipped)`
  // while its verdict half still read `1 warned, 1 failed`), and
  // `expect(verdicts).toBe(total - HEALTHY_SKIPS)` (27 vs 28). The run's rc
  // stays 0 and the `fail` assertion never red — no line said the check
  // failed. (`ccrc-doctor-graphify.test.ts` links a real `realpath` in its own
  // `healthy()` for the same reason, and pins the SKIP itself as its D-1350
  // case; `ccrc-doctor-graphify.test.ts` also pins THIS paragraph against the
  // shipped arm, so the two cannot drift apart again.)
  linkReal(home, 'realpath');
  symlinkSync(join(home, '.ccrc', 'graphify-venv', 'bin', 'graphify'),
    join(home, '.local', 'bin', 'graphify'));
  writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
    started: new Date().toISOString(), finished: new Date().toISOString(),
    pin: '0.9.9', status: 'ok', trees: [] }] }));
  // …and its ccd answers Docs (spec 2026-10-01 §7.2): `docs` is a check, and
  // healthy()'s contract is that every check PASSES. `$HOME/.local/bin/ccd`,
  // the file the agent execs and the check runs, prints the canned ready
  // `docs-index` answer — builtins only, because this PATH holds no system
  // directory — and `ccd-docs-index.test.ts` holds the real verb to the same
  // object, so this stub cannot drift from ccd.
  writeFileSync(join(home, '.local', 'bin', 'ccd'),
    docsIndexStubScript(JSON.stringify(DOCS_INDEX_READY)), { mode: 0o755 });
  // …and its PWA bundle carries the service worker every browser installs (spec 2026-10-01 §7.2): `docs-sw` is a
  // check, and healthy()'s contract is that every check PASSES. `swJs()` is the default-denylist worker in the
  // one-line shape a build emits, the same text `TREE_STUBS` and `ccrc-updateFixture.ts`'s tree plant.
  mkdirSync(join(home, 'ccrc', 'server', 'dist-pwa'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js'), swJs());
  return home;
}

/** python3, or null. `plantFakeRuntime`'s interpreter hands `ccgpt-runtime
 *  check`'s stamp read and probe hash to a real python3, so without one every
 *  Codex fixture's runtime reads `mutated` and a healthy lane cannot PASS. */
export const PY = pythonOrSkip();
export const describeCodex = describe.skipIf(PY === null);
export const itCodex = it.skipIf(PY === null);

/** Every home `healthyCodexBox` built, so what a case spawns into it is ended
 *  after the case, pass or fail — `killLaneProcesses` ends current-run
 *  children through their own handles, never by name or pattern. */
export const codexHomes: string[] = [];

/** The binaries `_check_codex` and the lane library it calls need on this
 *  file's PATH-contained harness, which carries no system directory (2b-2's
 *  hazard 9): `bash` (every `#!/usr/bin/env bash` — the placed `ccgpt-runtime`
 *  and the fake runtime interpreter), `readlink` and `cat` (`ccgpt-runtime
 *  check`), `cmp` (the executables row), `ps`, `awk`, `od` and `tr` (the tier
 *  identity, Task 5), and this platform's sha256 tool (`_plat_sha256`, which
 *  `_codex_started_json` hashes a tier's code with). */
export const CODEX_TOOLS = ['bash', 'readlink', 'cat', 'cmp', 'ps', 'awk', 'od', 'tr',
  process.platform === 'darwin' ? 'shasum' : 'sha256sum'];

/** `deploy/models-op.mjs`' import closure and the LiteLLM template it renders
 *  against — what `_check_codex` runs through `_models_node`
 *  (`$CCRC_HERE/../deploy/models-op.mjs`). COPIED, not symlinked, for
 *  `plantAuthHelper`'s reason: node resolves a module's imports from its REAL
 *  path. A file missing here is not a degraded fixture: every Codex PASS case
 *  reds on the check's "printed no answer" FAIL. */
export const MODELS_OP_CLOSURE = ['deploy/models-op.mjs', 'deploy/litellm-config.template.yaml',
  'shared/roster-json.mjs', 'shared/base-url.mjs', 'shared/models.mjs', 'shared/modelenv.mjs', 'shared/litellm.mjs',
  'shared/model-advance.mjs'];

export function installModelsOp(home: string): void {
  for (const rel of MODELS_OP_CLOSURE) {
    mkdirSync(path.dirname(join(home, 'ccrc', rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(home, 'ccrc', rel));
  }
}

/** The five GPT-lane executables, `GPT_LANE_BINS` — the constant
 *  ccrc-install-*.test.ts pins to `_inst_bins`' gate: SYMLINKED into the
 *  fixture's shipped tree (`<home>/ccrc/ccd`, `$BOX_TREE_DIR/ccd`, what the
 *  check compares against) and COPIED into `<home>/.local/bin`, as
 *  `_inst_atomic` places them — so a case can edit the placed copy and never
 *  the repository's. */
export function placeLaneBins(home: string): void {
  for (const n of GPT_LANE_BINS) {
    symlinkSync(join(REPO, 'ccd', n), join(home, 'ccrc', 'ccd', n));
    copyFileSync(join(REPO, 'ccd', n), join(binDir(home), n));
    chmodSync(join(binDir(home), n), 0o755);
  }
}

/** A Codex lane's class registry and catalogue, in the public fixture model
 *  vocabulary (`probe-model` is the haiku class, the lane's usage probe
 *  model). Written as the operator's file and the probe's file are; every
 *  RENDERED file comes from the real writer (`renderLane`), never by hand. */
export function writeLaneModels(home: string, id: string, o: {
  probe?: string; classes?: Record<string, string | null>; discovery?: unknown; models?: readonly string[];
} = {}): void {
  const dir = join(home, '.ccrc', 'models');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.classes.json`), `${JSON.stringify({
    probe: o.probe ?? 'codex',
    classes: o.classes ?? { haiku: 'probe-model', sonnet: 'gpt-x', opus: null, fable: null },
    subagent: 'sonnet',
    discovery: o.discovery ?? 'catalogue',
  }, null, 2)}\n`);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    probe: 'codex', fetchedAt: Math.floor(Date.now() / 1000), stale: false,
    models: (o.models ?? ['gpt-x', 'gpt-x-mini', 'probe-model']).map((m) => ({ id: m })),
  }));
}

/** lane.json, the TSV, the effort file, the settings env block and the
 *  lane's LiteLLM config, by the REAL writers — the fixture tree's own
 *  `models-op.mjs` `materialise`, then `litellm --commit true` — so a case
 *  that re-renders after editing a registry is measuring what the product
 *  writes. */
export function renderLane(home: string, id: string): void {
  const roster = join(home, '.ccrc', 'accounts.json');
  const op = (...args: string[]): void => {
    const r = spawnSync(process.execPath, [join(home, 'ccrc', 'deploy', 'models-op.mjs'), ...args],
      { env: { PATH: process.env['PATH'] ?? '', HOME: home }, encoding: 'utf8' });
    if (r.status !== 0 || !(r.stdout ?? '').startsWith('{"ok":true')) {
      throw new Error(`renderLane: models-op ${args[0]} ${id} exited ${r.status}: ${r.stdout}${r.stderr}`);
    }
  };
  op('materialise', '--file', roster, '--id', id);
  op('litellm', '--file', roster, '--id', id,
    '--template', join(home, 'ccrc', 'deploy', 'litellm-config.template.yaml'),
    '--out', join(home, '.ccrc', 'codex', id, 'litellm.yaml'), '--commit', 'true');
}

/** `_codex_started_json <tier>` as the lane library computes it NOW in this
 *  fixture HOME — the one spelling of the record a start writes (ccd/ccrc) —
 *  under the same contained PATH doctor runs with (Plan 3a Task 5). */
export function startedJson(home: string, tier: 'litellm' | 'shim'): string {
  const r = spawnSync(BASH, ['-c', `. ${shq(ccrcIn(home))}; _codex_started_json ${tier}`],
    { env: doctorEnv(home), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`_codex_started_json ${tier}: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

/** A lane's two ports, read back from the roster `healthyCodexBox` wrote. */
export function lanePorts(home: string, id: string): { proxyPort: number; litellmPort: number } {
  const r = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as
    { accounts: Array<{ id: string; exec?: { proxyPort?: number; litellmPort?: number } }> };
  const x = r.accounts.find((a) => a.id === id)?.exec;
  if (x?.proxyPort === undefined || x.litellmPort === undefined) throw new Error(`lanePorts: no ports for ${id}`);
  return { proxyPort: x.proxyPort, litellmPort: x.litellmPort };
}

/** Rewrites one roster row in place, as an operator's hand edit does — the
 *  JSON is written back RAW, so a shape `parseRoster` would refuse reaches
 *  the check exactly as it would on a box. */
export function editRosterRow(home: string, id: string, edit: (row: Record<string, any>) => void): void {
  const p = join(home, '.ccrc', 'accounts.json');
  const r = JSON.parse(readFileSync(p, 'utf8')) as { accounts: Array<Record<string, any>> };
  const row = r.accounts.find((a) => a['id'] === id);
  if (row === undefined) throw new Error(`editRosterRow: no row ${id}`);
  edit(row);
  writeRawRoster(home, `${JSON.stringify(r, null, 2)}\n`);
}

/** A healthy box whose roster also carries Codex lanes (`ids`), each one a
 *  lane ccrc runs end to end: its launcher, a signed-in authDir, its model
 *  registry and a fresh catalogue, and the files rendered from them; the
 *  five GPT-lane executables placed from the shipped tree; a current
 *  runtime. Every check still PASSes — healthy()'s contract — so a Codex
 *  case breaks exactly one thing. The ports are FREE ones (`freeLanes`),
 *  never the fixed pure-parse pair: from Task 5 on the check connects to
 *  them. No `accounts.sh` (`codexRoster`'s `accountsSh: false`), for
 *  healthy()'s own reason. */
export async function healthyCodexBox(prefix: string, ids: readonly string[] = ['codex-a']): Promise<string> {
  const home = healthy(prefix);
  codexHomes.push(home);
  const lanes: LanePorts[] = await freeLanes(ids);
  codexRoster(home, lanes, [], { accountsSh: false });
  for (const b of CODEX_TOOLS) linkReal(home, b);
  installModelsOp(home);
  placeLaneBins(home);
  plantFakeRuntime(home);
  for (const { id } of lanes) {
    writeWrapper(home, id, { cfgDir: `.claude-${id}`, target: 'ccrc-codex' });
    plantLaneAuth(home, id);
    writeLaneModels(home, id);
    renderLane(home, id);
    plantCodexUsage(home, id);
    // materialise wrote `<cfgDir>/settings.json`, so the home now EXISTS, and
    // `skills` measures every existing rostered home: it carries the shipped
    // skills, as `ccrc install` leaves it.
    for (const [tree, name] of SHIPPED_SKILLS) {
      cpSync(join(REPO, 'ccd', tree), join(home, `.claude-${id}`, 'skills', name), { recursive: true });
    }
    // …and `delegation-hooks` measures every existing rostered home too: the installer registers the session hook in
    // each one, a Codex lane's included, and merges it into the settings.json `materialise` wrote.
    plantHookRegistration(home, `.claude-${id}`);
  }
  return home;
}

/** A box where nothing has been installed: no stubs at all, and a node floor
 *  no interpreter can meet. `gh` is still the POISON (ghContainedEnv plants it
 *  in every fixture), so `gh` is "present" and `gh_auth` runs it — which is the
 *  point: this fixture proves doctor really executes the contained gh. */
export function broken(prefix: string): string {
  const home = mkTmp(prefix);
  installCcrc(home);
  containedPath(home);   // the poison is the only `gh` this fixture has
  writePkg(home, '>=99.0.0');
  return home;
}

/** The check table, read out of the shipped file rather than re-typed here —
 *  the same "enumerate once, derive" rule the rest of the project follows. */
export function tableNames(): string[] {
  const r = spawnSync(BASH, ['-c',
    `set -uo pipefail; . ${shq(CHECKS_SRC)}; printf '%s\\n' "\${CCRC_DOCTOR_CHECKS[@]}"`],
    { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not read the check table: ${r.stderr}`);
  const names = (r.stdout ?? '').split('\n').filter(Boolean);
  // A scan over an empty list passes everything (the discipline
  // single-definition.test.ts (its array rule) states outright). `"${arr[@]}"` on an
  // UNSET array is not an error under `set -u` in bash 4.4+, so a missing or
  // renamed table would otherwise return [] and quietly disarm every caller —
  // measured: it did, in this suite's own red run.
  if (names.length === 0) throw new Error(`${CHECKS_SRC} declares no CCRC_DOCTOR_CHECKS`);
  return names;
}

export const lineFor = (out: string, name: string): string | undefined =>
  out.split('\n').find((l) => new RegExp(`^(PASS|WARN|FAIL) ${name}: `).test(l));

/** Any verdict line, SKIP included. Deliberately NOT `lineFor`: at least one
 *  assertion below uses that one's blindness to SKIP as the assertion itself
 *  ("a SKIP is not a PASS/WARN/FAIL"), so widening it would quietly disarm a
 *  test. Only the table census wants all four words. */
export const anyVerdictFor = (out: string, name: string): string | undefined =>
  out.split('\n').find((l) => new RegExp(`^(PASS|WARN|FAIL|SKIP) ${name}: `).test(l));

/** How many checks a HEALTHY fixture skips. THREE on Linux, FOUR on macOS —
 *  `models` SKIPs on every platform (`healthy()` plants only the upstream
 *  Anthropic account, which never has a model registry by design, so the
 *  population is empty everywhere), macOS adds a second, `scopes`: cgroup
 *  throttling is a Linux mechanism, so a Darwin box has no such fault to
 *  find. Both answer SKIP rather than PASS deliberately — a PASS there would
 *  be a verdict nobody measured, which is the forgery class this repo bans
 *  by name. The same shape as the standing `linger` WARN the summary test
 *  below already accounts for.
 *
 *  RAISED BY ONE (item 4, wave-1 fix round A): `pool-sync` SKIPs on every
 *  platform too — `healthy()` never installs `ccd-pool-sync.timer` (only
 *  `describe('ccrc doctor: services knows about the pool-sync timer')`'s own
 *  fixtures do, via `writeUnitFile`), so a box this suite calls "healthy" has
 *  no control plane by configuration, exactly item 5's own fix says a
 *  single-box default should read. Measured the same way the `graphify-path`
 *  paragraph above measured ITS addition: deleting this `+ 1` reds every
 *  `(N skipped)` summary pin, both `expect(skipped).toBe(HEALTHY_SKIPS)`
 *  assertions and `expect(verdicts).toBe(total - HEALTHY_SKIPS)` — the run's
 *  rc stays 0 and no line says a check failed, because SKIP prints no
 *  verdict at all; only the counts move.
 *
 *  RAISED BY ONE AGAIN (fix round 1 item 6 / review 155 C3): `update-sync`
 *  SKIPs the same way, for the same reason — `healthy()` never installs
 *  `ccd-update-sync.timer` either (only `--role fleet` places it), so this
 *  "healthy" box has no puller by configuration too. Measured the identical
 *  way: deleting this `+ 1` reds every summary/count pin above again.
 *
 *  RAISED BY ONE AGAIN (Plan 3a Task 4): `codex` SKIPs on every platform —
 *  `healthy()` rosters only the upstream Anthropic account, so its Codex
 *  population is empty everywhere, and a scan over no lane must never PASS
 *  (`_check_codex`'s empty-set SKIP). `healthyCodexBox()` is the fixture
 *  where it answers. Measured the same way: deleting this `+ 1` reds the
 *  summary and count pins that read this constant (Plan 3a Task 4's
 *  mutation row).
 *
 *  RAISED BY ONE ON macOS ONLY (session-continuity wave 4): `scope-sweep` SKIPs
 *  there, as `scopes` does — pane scopes are a Linux mechanism. On Linux
 *  `healthy()` plants a fresh verdict record, so it PASSes and this count is
 *  unchanged there.
 *
 *  RAISED BY ONE AGAIN (ccrc history W1-B1, spec 2026-10-05 §9.6): `history`
 *  SKIPs on every platform — `healthy()` places no
 *  `~/.local/bin/ccd-history-sweep`, which is the check's gate (the shim, not
 *  the timer file), so this "healthy" box never installed the sweep.
 *  `historyBox()` and `relayBox()` at the end of this file are the fixtures
 *  where it answers. Measured the same way: deleting this `+ 1` reds the two
 *  pins that read the skip count directly, `counts BOTH lines in the summary`
 *  (`expected 5 to be 4`) and `prints a summary count LAST, and it adds up to
 *  the table` (`expected 41 to be 42`).
 *
 *  RAISED BY ONE AGAIN (box-token lifecycle Task B5): `box-token` SKIPs
 *  `no-role` on every platform — `healthy()`'s ccrc.env records no CCRC_ROLE,
 *  and the box holds neither the server's `mail.token`/`box-token.json` nor a
 *  fleet agent's `agent.env`, so neither arm has a subject. Measured the same
 *  way: with the check in the table and this `+ 1` absent, "every line is
 *  exactly PASS|WARN|FAIL|SKIP" and "prints a summary count LAST" red, and so
 *  does every `(N skipped)` pin that reads this constant.
 *
 *  RAISED BY ONE ON macOS ONLY (D-5241): `oom-policy` SKIPs there (launchd has
 *  no OOMPolicy). On Linux `healthy()` plants both scope drop-ins and a pane
 *  reading `continue`, so it PASSes and the count is unchanged there. Measured:
 *  without this, the macOS run reds `counts BOTH lines in the summary` and
 *  `every line is exactly PASS|WARN|FAIL|SKIP` (`expected 10 to be 9`).
 *
 *  RAISED BY ONE ON DARWIN ONLY (node-runtime-under-nvm, task 3): `node-path` SKIPs there; on Linux `healthy()` plants the publication.
 *
 *  RAISED BY ONE AGAIN, on every platform (wave 17, D-5316): `update-sweep`
 *  SKIPs - `healthy()` writes no `~/.ccrc/update.json`, so there is no last
 *  update to read a sweep from. The `update-sweep` describe at the end of this
 *  file plants one where it answers.
 *
 *  RAISED BY ONE AGAIN, on every platform (coordinator-first routing, plan Task 14):
 *  `approval-verifier-runnable` SKIPs - `healthy()` creates no `~/.cc-sessions`, so
 *  the box hosts no session whose hook could wait.
 *
 *  RAISED BY ONE AGAIN, on every platform (coordinator-first routing, plan Task 16):
 *  `approval-key-colocated` SKIPs - `healthy()` writes no server signing key
 *  (`~/.ccrc/approval-signing.key`), which only a server that started with
 *  coordination creates. Its sibling `approval-digest-mismatch` PASSes there (no
 *  refusals journal), so it moves no count. */
export const HEALTHY_SKIPS = (process.platform === 'darwin' ? 3 : 0) + 12;   // darwin's third: node-path (launchd bakes PATH; nothing published)

// ── the session gate: the flag, and the passphrase it needs ───────────────
// Stage 3a, Task 9. TWO FACTS, ONE VERDICT — `CCRC_AUTH` (out of `ccrc.env`,
// because that is the file `ccrc.service`'s `EnvironmentFile=` hands the
// server) and `~/.ccrc/auth.scrypt`. Neither is worth anything without the
// other: the flag on with no passphrase is a box that answers 401 to
// everything and cannot be logged into at all, and a passphrase with the flag
// off is a console anyone on the tailnet can drive.
//
// THE FILE IS MEASURED BY THE SERVER'S OWN PARSER, through
// `deploy/gen-auth-hash.mjs --check`, which imports the compiled
// `server/src/auth/secret.ts`. Not for elegance: `readAuthSecret` enforces five
// parameter bounds beyond the format (D-124/113) and `buildServer` calls it
// UNCAUGHT at boot, so a line a bash approximation would wave through is a
// server that does not start. Doctor is the one place an operator can see that
// coming before a restart does.
/** Wave 9 R10e (D-3823): what a NOT-MEASURED verdict about one file says, on either platform — the file by path,
 *  "was not measured", never D-3596's "cannot be read" (that sentence is for an exposure file there and
 *  unreadable) — and the platform's own clause: Linux says the reader does not decide the shape, macOS (round-2
 *  ruling R-A) names the file and the LINE NUMBER that is not plain. */
export const expectUndecided = (detail: string, file: string): void => {
  expect(detail).toContain(file);
  expect(detail).toContain('was not measured');
  expect(detail).not.toContain('cannot be read');
  if (IS_DARWIN) expect(detail).toContain(`${file} line `);
  else expect(detail).toContain('in a shape this reader does not decide');
};
export interface UnitEnvAnswer { rc: number; val: string; src: string; why: string; fix: string; envPath: string; expPath: string }

// ── stage 3b (spec D6): the exposure quartet ──────────────────────────────
// Four checks, one shared gate: `~/.ccrc/exposure.env`. A box that never ran
// `ccrc expose` is a VALID END STATE (a BYO proxy, or a pre-3b box), so all
// four SKIP there rather than nagging a box that chose to stay dark.
//
// MUTATIONS MEASURED (Task 4, Step 3 — applied to the shipped checks, run,
// reverted; counts recorded in the plan):
//   - the cert threshold comparison flipped (`-lt 14` -> `-ge 14`) -> RED,
//     both the WARN case and the PASS-naming-days case.
//   - the name check's resolves-elsewhere WARN hardened to a FAIL -> RED,
//     "WARNs — not FAILs — when the name resolves elsewhere…" (propagation
//     lag is normal, and a FAIL would page an operator over DNS being DNS).
//   - the canary token appended to the exposure PASS detail -> RED, "never
//     prints the token…" (the `_check_config` SET/NOT-SET rule, held by
//     mechanism rather than promise).

export const skipLineFor = (out: string, name: string): string | undefined =>
  out.split('\n').find((l) => l.startsWith(`SKIP ${name}: `));

/** The line AFTER a non-PASS verdict — the remedy, by the `_dr_line` contract
 *  that a remedy always immediately follows its verdict. Module-scoped since
 *  the 3b checks below assert on remedies too; it used to be private to the
 *  `auth` describe. */
export const remedyFor = (out: string, name: string): string => {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^(WARN|FAIL) ${name}: `).test(l));
  return i === -1 ? '' : (lines[i + 1] ?? '');
};

// ── W4 (design 2026-09-20 §11, §12): provenance, and the update routes' gate ──
// Every case runs the FULL `ccrc doctor`, never the function alone, and every
// case asserts the absence of cmd_doctor's own bug lines as well as its
// verdict: a check whose return code disagrees with the line it printed (a
// SKIP with a remedy, a WARN returning 1) is reported by the runner as an
// EXTRA `FAIL <name>: the check …` line, which a test that only regexed for the
// intended verdict would never see (the memory describe's "no synthetic bug
// line" pins, above, are the precedent).
export const noRunnerBugLine = (out: string, name: string): void => {
  expect(out).not.toMatch(new RegExp(`^FAIL ${name}: the check (exited|printed no verdict line)`, 'm'));
};

/** Plants a fleet session id in the registry the routing check's live-session
 *  census (Task 5) reads: `<id>.uuid` always (the census walks `$REG/*.uuid`
 *  for ids), `<id>.class` only when `recorded` (the routing record). `live`
 *  answers `claude-session@<id>.service` `active` through the generic
 *  `fixture-unit-<unit>` file `stubSystemctl` (planted by `healthy()`)
 *  already reads — omitted, the unit stays `inactive`/exit 3, a measured
 *  not-live rather than a live session. */
export function plantSession(home: string, id: string, opts: { live: boolean; recorded: boolean }): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, `${id}.uuid`), `${id}\n`);
  if (opts.recorded) writeFileSync(join(reg, `${id}.class`), 'sonnet\n');
  if (opts.live) writeFileSync(join(home, `fixture-unit-claude-session@${id}.service`), 'active\n');
}
/** Task 4's ONE declaration of the GPT-lane executables `_check_codex` compares,
 *  as it stands in ccd/ccrc-doctor-checks: a one-line assignment or an array. */
export function checksDecl(name: string): string {
  const m = new RegExp(`^${name}=(?:\\([^)]*\\)|[^\\n]*)$`, 'm').exec(readFileSync(CHECKS_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc-doctor-checks declares no ${name}`);
  return m[0];
}

export type LaneBin = (typeof GPT_LANE_BINS)[number];
export interface FixCodexCase {
  lanes?: string[]; lanesRc?: number;
  /** CCRC_ROLE in `$HOME/.ccrc/ccrc.env`; unset writes no file */
  role?: string;
  /** ids whose `_codex_row` refuses, with its roster-invalid sentence */
  badRows?: string[];
  lockRefuse?: string[];
  /** `_codex_lane_json_state` per id; default `current` */
  laneState?: Record<string, 'current' | 'stale' | 'absent'>;
  /** the check-only materialise per id: its `changed`, `refused`, or models-op's
   *  `roster-invalid` refusal of a roster two lanes share a port in; default false */
  registryChanged?: Record<string, boolean | 'refused' | 'roster-invalid'>;
  /** the committing materialise per id; default `wrote`. `lock-busy` and `lock-unwritable` are the lane-files
   *  lock's own refusal, which `_models_node_locked` prints in models-op's refusal shape without running node. */
  commit?: Record<string, 'wrote' | 'no-registry' | 'refused' | 'roster-invalid' | 'lock-busy' | 'lock-unwritable'>;
  /** `_models_litellm_lane_held` per id; default `same` (changed:false) */
  litellm?: Record<string, 'same' | 'rendered' | 'restarted' | 'foreign' | 'roster-invalid'>;
  /** `ccgpt-runtime check` before a build, `build`, and `check` after one; default 0 */
  runtime?: { check?: number; build?: number; afterBuild?: number };
  /** each placed executable against the fixture's shipped tree; default `same` */
  bins?: Partial<Record<LaneBin, 'same' | 'drift' | 'missing' | 'mode'>>;
  /** executables the fixture's shipped tree LACKS */
  treeLacks?: LaneBin[];
  tiersDegraded?: boolean;
  /** one ccrc seam left undefined, for the loaded-guard case */
  unload?: string;
  /** make `$HOME/.local/bin` read-only before the run */
  binReadOnly?: boolean;
  /** stamp every placed executable with {@link AGED} before the run */
  ageBins?: boolean;
  /** run under a PATH with NO `cmp`: the isolation wall, then a fixture
   *  directory of only the tools the harness itself needs */
  noCmp?: boolean;
  /** plant each lane's lane.json, litellm.yaml and settings.json as
   *  {@link laneFileText}, so a case can prove nothing rewrote them */
  laneFiles?: boolean;
}

/** A past instant a converged executable must still carry after a run. */
export const AGED = new Date('2026-01-02T03:04:05Z');

/** The rendered files `laneFiles` plants for one lane, by path under HOME. */
export const laneFileText = (id: string): Record<string, string> => ({
  [join('.ccrc', 'codex', id, 'lane.json')]: `{"fixture":"${id}'s lane.json, as planted"}\n`,
  [join('.ccrc', 'codex', id, 'litellm.yaml')]: `# ${id}'s litellm.yaml, as planted\n`,
  [join(`.claude-${id}`, 'settings.json')]: `{"env":{"fixture":"${id}'s env block, as planted"}}\n`,
});

/** models-op's refusal of a roster in which two codex lanes share a port
 *  (`shared/roster-json.mjs`' own sentence; a pure-parse port, no socket). */
export const SHARED_PORT_REFUSAL = '{"ok":false,"error":"roster-invalid","detail":"fixture: accounts \\"codex-a\\" and \\"codex-b\\" both use port 45011."}';

export const FIX_TRIPWIRES = ['_codex_login', '_codex_stop_tier', '_codex_start_tier', '_codex_stop_lane',
  '_codex_cmd_start', '_codex_cmd_stop', '_codex_lane_json_ensure', '_codex_runtime_env_ensure', 'cmd_wrappers'];

// ── history: the session-history store (spec 2026-10-05 §9.6) ──────────────
// `_check_history` gates on the box's role and on the shim, then RELAYS `ccrc history status --json`'s `health`
// block. It decides nothing about the store (`deriveHealth`, `ccd/history/lib.mjs`, does). Three kinds of case:
// the GATES and the STORE STATES go through the real CLI, against a store `store.mjs`'s own `createStore` made
// and then planted with the rows and files each state consists of (most of their producers are the sweep's, and
// some ship after B1 — B2's recovery step, B4's segment checks; the rows are planted here exactly as each
// producer writes them, so the CLI's reading of them is under test too). The RELAY goes through a `node` that
// answers status from a fixture file, once per word `HEALTH_WORDS` declares, and once per `deriveHealth` rule
// whose input no fixture can make (D-4259). Pins O15, O41 (doctor half), O55, and O28's,
// O37's and DM43's doctor clauses.

export const HISTORY_SHIM_SRC = join(REPO, 'ccd', 'ccd-history-sweep');

/** The shim where `_inst_atomic` puts it — a copy, 0755 — its mtime `ageS` seconds ago. `_inst_atomic` copies
 *  without `-p`, so a real shim's mtime is its install time, which is what the grace counts from. */
export function plantHistoryShim(home: string, ageS: number): void {
  const p = join(home, '.local', 'bin', 'ccd-history-sweep');
  mkdirSync(path.dirname(p), { recursive: true });
  copyFileSync(HISTORY_SHIM_SRC, p);
  chmodSync(p, 0o755);
  const t = new Date(Date.now() - ageS * 1000);
  utimesSync(p, t, t);
}

/** A box an hour past its install (the shim's grace long over) holding a store that `createStore` made, through
 *  the store's own first-creation sequence. */
export function historyBox(prefix: string): { home: string; storeId: string } {
  const home = healthy(prefix);
  plantHistoryShim(home, 3600);
  // the sweep's shim sources accounts.sh; an absent one is WARN roster-unreadable, which is a rule of its own
  // (`healthy()` writes none — no other check here needs a roster)
  seedAccountsSh(home);
  return { home, storeId: createStore(home).storeId };
}

/** `healthy()`'s macOS half of the A11b checks: a `tmutil` that answers `[Excluded]` and an `fdesetup` that answers
 *  On, so a healthy Mac PASSes `secrets-backup-excluded` and `filevault` (healthy()'s contract: every check PASSes;
 *  the contained PATH holds no system directory). Declared here, at the end, so `healthy()` calls it without moving
 *  a line another file cites. Planted on every platform: a Linux box SKIPs both checks before either tool runs. */
export function plantHealthyBackupTools(home: string): void {
  writeFileSync(join(stubBin(home), 'tmutil'),
    `#!${BASH}\n[ "$1" = isexcluded ] || exit 64\nprintf '[Excluded]    %s\\n' "$2"\n`, { mode: 0o755 });
  writeFileSync(join(stubBin(home), 'fdesetup'), `#!${BASH}\n[ "$1" = status ] || exit 64\necho 'FileVault is On.'\n`, { mode: 0o755 });
}
/** Registers the three root hooks the single doctor file carried, in their original order; every part calls it once at its top level. */
export function installDoctorHooks(): void {
  // Called after the part's own `removeTmpFixturesEachTest()`: vitest runs after-hooks in reverse order of registration, so the codex
  // lanes' process kill below still sees its home.
  // ── fixture lifetime (R100, review 518's S1) ──────────────────────────────

  // ONE SHARED FIXTURE BREAKS UNDER THAT, and is built here instead. `authFixtures`' compiled reader (`compiledSecretJs`) is built
  // once per file into an `mkTmp` directory by whichever case first plants an auth module, and every later case copies from the
  // path it cached. Built inside a case, the directory is that case's and is gone when the case ends: the next copy fails with
  // ENOENT (measured: eleven of the twelve R98 rows). A `beforeAll` runs before the first case's mark, so the directory is left for
  // the end-of-file sweep. A failed build is not cached, so it is left to the case that needs it, which fails with the compiler's
  // own message, not every case in the file.
  beforeAll(() => {
    try { compiledSecretJs(); } catch { /* the first case that plants an auth module builds it again and reports why it could not */ }
  }, 120_000);
  afterEach(async () => { for (const h of codexHomes.splice(0)) await killLaneProcesses(h); });
}

// ── codex bridge Stage 2, Task 13: a `direct` lane in this fixture ───────────────────────────────────────────────────
/** `_codex_python`'s version question, read out of ccd/ccrc rather than re-typed, so `plantDirectLane`'s python3 arm
 *  hands exactly that program to the real interpreter. */
const PY_VERSION_PROG = ((): string => {
  const m = /"\$py" -I -c '([^']*)'/.exec(readFileSync(CCRC_SRC, 'utf8'));
  if (m === null) throw new Error('ccd/ccrc no longer asks python3 its version in the shape this fixture reads');
  return m[1];
})();

/** Makes lane `id` of a `healthyCodexBox` a `direct` lane, as `ccrc codex switch` leaves one: the roster row's bridge
 *  (and, when given, its upstream) by the operator's hand edit, lane.json and the lane's other files re-rendered by the
 *  real writer, the bridge package COPIED into the fixture's shipped tree (`_codex_bridge_dir`, so a case may remove
 *  it), and the python3 presence stub given one more arm: `_codex_python`'s version question goes to the real
 *  interpreter, so a bridge's start record can be computed (`bridgeStartedJson`). */
export function plantDirectLane(home: string, id: string, o: { upstream?: 'backend' | 'siwc' } = {}): void {
  editRosterRow(home, id, (row) => {
    row['exec'].bridge = 'direct';
    if (o.upstream !== undefined) row['exec'].upstream = o.upstream;
  });
  renderLane(home, id);
  // `_codex_bridge_digest` sorts the package's `<name> <sha256>` lines (`LC_ALL=C sort`), so a bridge's record needs
  // `sort` on the contained PATH, as every box has it.
  linkReal(home, 'sort');
  const pkg = join(home, 'ccrc', 'ccd', 'codexbridge');
  if (!existsSync(pkg)) {
    cpSync(join(REPO, 'ccd', 'codexbridge'), pkg, { recursive: true, filter: (s) => !s.includes('__pycache__') });
  }
  const real = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
  const arm = real === '' ? ''
    : `if [ "$1" = "-I" ] && [ "$2" = "-c" ] && [ "$3" = '${PY_VERSION_PROG}' ]; then exec '${real}' "$@"; fi\n`;
  stub(home, 'python3', `${BT_PY_ARM}${arm}exit 0`);
}

/** `_codex_started_json bridge` as the lane library computes it NOW in this fixture HOME (`startedJson`'s twin). */
export function bridgeStartedJson(home: string): string {
  const r = spawnSync(BASH, ['-c', `. ${shq(ccrcIn(home))}; _codex_started_json bridge`],
    { env: doctorEnv(home), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`_codex_started_json bridge: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

/** A bridge start record's fields that `plantRunningBridge` / `writeBridgeRecord` can change, one at a time:
 *  `_codex_started_json bridge`'s interpreter, code hash (the placed shim, then the auth library) and package digest.
 *  `code` and `bridge` make the record stale; `interpreter` is recorded but not compared (D-6875). */
export type BridgeRecordField = 'interpreter' | 'code' | 'bridge';

/** Writes lane `id`'s `bridge.started`: `current` as a start would write it now, a field name the same record with that
 *  one field changed (so `_codex_tier_stale` reads it stale for `code` or `bridge`, and current for `interpreter`,
 *  which is recorded but not compared, D-6875). */
export function writeBridgeRecord(home: string, id: string, rec: 'current' | BridgeRecordField): void {
  const file = join(home, '.ccrc', 'codex', id, 'bridge.started');
  const now = bridgeStartedJson(home);
  if (rec === 'current') { writeFileSync(file, `${now}\n`); return; }
  const other = rec === 'interpreter' ? join(home, 'elsewhere', 'python3') : '0'.repeat(64);
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(now) as Record<string, string>, [rec]: other })}\n`);
}

/** This lane's own bridge, running, as `_codex_tier_ours <id> bridge` proves one: the bridge-shaped answer
 *  (`spawnListener`'s `direct`) on the shim's port, from a pid whose command line carries `<shim file>
 *  --ccrc-bridge=direct --ccrc-lane=<id>` and which holds that port itself, named by `bridge.pid` (the nohup arm's
 *  handle), with its start record `current` (`writeBridgeRecord`). */
export async function plantRunningBridge(home: string, id: string): Promise<Listener> {
  const { proxyPort } = lanePorts(home, id);
  const shim = join(home, '.local', 'bin', 'ccgpt-proxy.py');
  const l = await spawnListener(home, { answer: 'direct', lane: id, port: proxyPort, argv: [shim, '--ccrc-bridge=direct', `--ccrc-lane=${id}`] });
  writeFileSync(join(home, '.ccrc', 'codex', id, 'bridge.pid'), `${l.pid}\n`);
  writeBridgeRecord(home, id, 'current');
  return l;
}
