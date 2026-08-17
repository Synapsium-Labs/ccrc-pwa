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
//     the SHAPE OF A DEPLOYED BOX (`deploy/deploy.sh:276` rsyncs
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
//  3. Every binary a check probes is a stub: tmux/jq/python3/flock (presence
//     only), git and loginctl (answers read from a fixture file), gh (canned
//     `auth status` output), and node — whose stub answers `--version` from a
//     literal and forwards everything else to the real interpreter, because
//     `--version` is the only dimension doctor measures and a hand-rolled JSON
//     parser would be the thing under test rather than a stub of it.
//
// The only real binaries any fixture reaches are `bash` (spawned by absolute
// path), the real `node` behind the version stub, and `timeout` (symlinked in
// where a test wants the timeout path exercised).
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv, ghPoisonAt } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');
/** The THIRD file that ships beside `ccrc` — the wrapper-shape contract both
 *  `ccrc-adopt` and `_check_wrappers` source. It is a separate install artifact,
 *  not a detail: `ccrc` reaches its siblings through `${BASH_SOURCE[0]}`, which
 *  bash does not resolve through a symlink, so all three must land in the same
 *  directory. The "library missing" test below is the mechanism that says so. */
const LIB_SRC = join(REPO, 'ccd', 'ccrc-wrapper-shape');

/** bash's absolute path, resolved ONCE under this process's real PATH. Every
 *  spawn below hands the child a PATH built only from fixture directories, and
 *  libuv resolves the executable against the CHILD's environment — so spawning
 *  bare `bash` would be ENOENT. Same trick ccrc-cli.test.ts:226 uses. */
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

interface Result { code: number; stdout: string; stderr: string }

// ── fixture construction ──────────────────────────────────────────────────

/** `<home>/ccrc/ccd/{ccrc,ccrc-doctor-checks}` — symlinks, so a test always
 *  runs the CHECKED-IN script (no copy to go stale) while `dirname $0`
 *  resolves inside the fixture. */
function installCcrc(home: string): void {
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
  symlinkSync(CHECKS_SRC, join(ccd, 'ccrc-doctor-checks'));
  symlinkSync(LIB_SRC, join(ccd, 'ccrc-wrapper-shape'));
}

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');

/** Replaces the symlinked check table with a hand-written one. Only the runner
 *  tests use this — it is how a table entry with no implementation, or a check
 *  that answers with an illegal status, can be reached at all without shipping
 *  one. */
function writeChecks(home: string, text: string): void {
  const p = join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks');
  rmSync(p, { force: true });
  writeFileSync(p, text);
}

/** The shipped `package.json` doctor reads its floor out of. `pkgDir` picks
 *  which box this fixture is: `agent` is what a fleet host has
 *  (deploy.sh:276), `server` is what a server host has (deploy.sh:525). */
function writePkg(home: string, engines: string | null, pkgDir: 'server' | 'agent' = 'server'): void {
  const d = join(home, 'ccrc', pkgDir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify(
    { name: `@ccrc/${pkgDir}`, ...(engines === null ? {} : { engines: { node: engines } }) }, null, 2));
}

function writeRawPkg(home: string, text: string, pkgDir: 'server' | 'agent' = 'server'): void {
  const d = join(home, 'ccrc', pkgDir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), text);
}

const stubBin = (home: string): string => {
  const d = join(home, 'stub-bin');
  mkdirSync(d, { recursive: true });
  return d;
};

function stub(home: string, name: string, body: string): void {
  writeFileSync(join(stubBin(home), name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** Remove a stub — this is what "the subject is removed from the fixture" means
 *  for a presence check, and it is the mutation each per-check test below
 *  applies to prove its check can go red at all. */
function unstub(home: string, name: string): void {
  rmSync(join(home, 'stub-bin', name), { force: true });
}

const linkReal = (home: string, name: string): void => {
  symlinkSync(realPath(name), join(stubBin(home), name));
};

function stubNode(home: string, version: string): void {
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
function stubNodeRosterExit(home: string, code: number): void {
  stub(home, 'node',
    `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi\n`
    + `case "$*" in *CCRC_DOCTOR_ROSTER*) exit ${code} ;; esac\n`
    + `exec '${process.execPath}' "$@"`);
}

/** `git config --global user.email` answers from `<home>/fixture-git-email` and
 *  `--system` from `<home>/fixture-git-email-system`; with the file absent it
 *  exits 1 and prints nothing, exactly as real git does for an unset key.
 *
 *  The two SCOPES are separate files because the check reads them separately,
 *  and any other argv is a loud failure (exit 90): a check that quietly went
 *  back to the repo-scope-inclusive `git -C "$HOME" config user.email` — the
 *  defect the review caught — would no longer be answered at all. `IFS=` on the
 *  read so a whitespace-only value survives intact into the check. */
function stubGit(home: string): void {
  stub(home, 'git',
    'case "$*" in\n'
    + "  *'config --global user.email'*) f=\"$HOME/fixture-git-email\" ;;\n"
    + "  *'config --system user.email'*) f=\"$HOME/fixture-git-email-system\" ;;\n"
    + '  *) echo "fixture git: unexpected argv: $*" >&2; exit 90 ;;\n'
    + 'esac\n'
    + 'if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; exit 0; fi\n'
    + 'exit 1');
}

/** `loginctl show-user <uid> --property=Linger` answers from
 *  `<home>/fixture-linger`. With the file absent it fails the way logind
 *  really does for a user with neither a live session nor linger. */
function stubLoginctl(home: string): void {
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
// fleet host (adopt.test.ts:62-111 is the same measurement, from the other
// side).

interface RosterEntry {
  id: string;
  configDirSuffix?: string;
  exec: { kind: 'upstream' | 'generated' | 'external'; secretsFile?: string };
}

/** The upstream account every real roster has exactly one of — `parseRoster`
 *  refuses one without it, and `healthy()` plants its binary. */
const UPSTREAM: RosterEntry = { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } };

/** Writes `~/.ccrc/accounts.json`. Two fixture conveniences, both deliberate:
 *  an entry with no `configDirSuffix` gets `.<id>` (the wrapper writer below
 *  uses the same default, so a test that says nothing about config dirs is not
 *  secretly a test about a mismatched one), and a list naming no upstream
 *  account gets `claude` prepended — a test about a generated wrapper must not
 *  also be a test about a roster that could never load. */
function writeRoster(home: string, accounts: RosterEntry[]): void {
  const full = accounts.some((a) => a.exec.kind === 'upstream') ? accounts : [UPSTREAM, ...accounts];
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify(
    { version: 1, accounts: full.map((a) => ({ configDirSuffix: `.${a.id}`, ...a })) }, null, 2));
}

/** The roster as TEXT. `writeRoster` above is a convenience that fills in a
 *  `configDirSuffix` and an upstream account, which is exactly what a test
 *  ABOUT a malformed roster must not have done for it: an entry with no id, an
 *  id that is not an id, a duplicate, no accounts array at all. */
function writeRawRoster(home: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), text);
}

/** One roster entry, as JSON text, for `writeRawRoster`. */
const entry = (o: Record<string, unknown>): string => JSON.stringify(o);
const rawRoster = (...entries: string[]): string =>
  `{"version":1,"accounts":[${entries.join(',')}]}`;
/** The upstream entry `healthy()` already has a binary for. */
const UP_JSON = entry({ id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } });

const binDir = (home: string): string => {
  const d = join(home, '.local', 'bin');
  mkdirSync(d, { recursive: true });
  return d;
};

/** A generated wrapper, byte-for-byte the shape on the fleet host: the shebang,
 *  the export, an optional comment-then-guard secrets pair, the exec. */
function writeWrapper(home: string, id: string,
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
function writeBinary(home: string, id: string): void {
  writeFileSync(join(binDir(home), id),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
}

/** An EXTERNAL account, in the shape the reference box has it: `gpt` is a
 *  symlink to `ccgpt`, a bespoke launcher that sets CLAUDE_CONFIG_DIR and is
 *  nothing like the generated template. Both names are planted, because the
 *  alias is half of what makes this case real. */
function writeSymlinkWrapper(home: string, id: string, target: string): void {
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

const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Overwrites the POISONED `gh` in `<home>/.local/bin` with one that answers
 *  `auth status` from canned lines. Same directory on purpose: the poison's
 *  position at the head of PATH is what makes the real `gh` unreachable, and
 *  that ordering must not be displaced by a second stub directory in front of
 *  it. Any argv other than `auth status` is a loud failure, so a check that
 *  started calling `gh` for something else could not pass unnoticed. */
function ghStub(home: string, lines: string[], code: number): void {
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const emit = lines.length ? `  printf '%s\\n' ${lines.map(shq).join(' ')} >&2\n` : '';
  writeFileSync(join(bin, 'gh'),
    '#!/bin/sh\n'
    + 'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then\n'
    + emit
    + `  exit ${code}\n`
    + 'fi\n'
    + 'echo "fixture gh: unexpected argv: $*" >&2\nexit 90\n', { mode: 0o755 });
}

const GH_OK = [
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
interface Health {
  mode?: unknown; connected?: unknown; downSince?: unknown;
  build?: unknown; roster?: unknown;
}

const FIXTURE_ADDR = 'ccrc-fixture.invalid:7788';

/** A `curl` that emulates the ONE invocation ccrc makes:
 *  `curl -sS --max-time N -H accept:… -w '\n%{http_code}' <url>` — body, a
 *  newline, then the status code. Every argv it sees is logged, so a test can
 *  prove the check really asked (and asked for the right URL, with the right
 *  bound) rather than passing vacuously.
 *
 *  Written with shell builtins only: this fixture's PATH holds no system
 *  directory at all, so a stub that reached for `cat` would not run. */
function stubCurl(home: string): void {
  stub(home, 'curl', [
    'printf \'%s\\n\' "$*" >> "$HOME/curl-calls"',
    'if [ -f "$HOME/fixture-curl-exit" ]; then',
    '  read -r c < "$HOME/fixture-curl-exit"',
    '  echo "curl: ($c) fixture: could not connect" >&2',
    '  exit "$c"',
    'fi',
    'code=200',
    '[ -f "$HOME/fixture-health-code" ] && read -r code < "$HOME/fixture-health-code"',
    'body=',
    '[ -f "$HOME/fixture-health-body" ] && read -r body < "$HOME/fixture-health-body"',
    'printf \'%s\\n%s\' "$body" "$code"',
  ].join('\n'));
}

/** Point the fixture's `curl` at a canned answer. `body` as a string is the
 *  raw bytes, so a test can hand the check something that is not JSON at all. */
function stubHealth(home: string, body: Health | string, code = 200): void {
  stubCurl(home);
  rmSync(join(home, 'fixture-curl-exit'), { force: true });
  writeFileSync(join(home, 'fixture-health-body'),
    typeof body === 'string' ? body : JSON.stringify(body));
  writeFileSync(join(home, 'fixture-health-code'), String(code));
}

/** A server that does not answer at all: curl's own exit code, not an HTTP
 *  status. 7 is "failed to connect", the shape a stopped service really has. */
function stubHealthUnreachable(home: string, exitCode = 7): void {
  stubCurl(home);
  writeFileSync(join(home, 'fixture-curl-exit'), String(exitCode));
}

/** Every argv the fixture's `curl` saw. Empty means the check never asked. */
const curlCalls = (home: string): string[] => {
  const p = join(home, 'curl-calls');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** `~/.ccrc/ccrc.env` — the box's own machine-config file
 *  (`deploy/ccrc.env.example`), and the only place on disk that records where
 *  this box's server listens. Written as TEXT, because half of what the address
 *  reader has to get right is which lines it ignores. */
function writeCcrcEnv(home: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), text);
}

/** `systemctl --user is-active <unit>` answers from `<home>/fixture-unit-<unit>`;
 *  with the file absent it answers `inactive` and exits 3, exactly as systemd
 *  does for a unit that is not running. Any other argv is a loud failure — a
 *  status verb that started MUTATING a unit could not pass unnoticed. */
function stubSystemctl(home: string): void {
  stub(home, 'systemctl',
    'if [ "$1" = "--user" ] && [ "$2" = "is-active" ]; then\n'
    + '  f="$HOME/fixture-unit-$3"\n'
    + '  if [ -f "$f" ]; then IFS= read -r v < "$f"; echo "$v"; [ "$v" = active ] && exit 0; exit 3; fi\n'
    + '  echo inactive; exit 3\n'
    + 'fi\n'
    + 'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90');
}

/** `n` ccd sessions in the registry, as ccd itself counts them: one `<id>.uuid`
 *  file each (ccd:8499). */
function writeSessions(home: string, n: number): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(reg, `proj-${i}.uuid`), `uuid-${i}\n`);
}

/** `ghContainedEnv` PLANTS the poisoned `gh` every time it is called, so it is
 *  called exactly once per fixture — here — and the PATH it returns is
 *  remembered. Calling it again from `runDoctor` would re-plant the poison over
 *  whatever `ghStub` had put there, which is precisely the bug this memo fixes:
 *  measured, every gh_auth test saw exit 97 instead of its own canned answer. */
const containedPathFor = new Map<string, string>();
function containedPath(home: string): string {
  let p = containedPathFor.get(home);
  if (p === undefined) {
    p = ghContainedEnv(home, { PATH: stubBin(home) })['PATH'] ?? '';
    containedPathFor.set(home, p);
  }
  return p;
}

function doctorEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    PATH: containedPath(home),
    LC_ALL: 'C',
    // verify-service.sh's `CCRC_VERIFY_*` model: a knob whose only reason to
    // exist is that a test must not wait out a production timeout.
    CCRC_DOCTOR_GH_TIMEOUT: '5',
  };
}

function runDoctor(home: string, args: string[] = ['doctor'], extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args],
    { env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A box where every check passes. Each per-check test starts here and breaks
 *  exactly ONE thing, so a red line is attributable to that one removal. */
function healthy(prefix: string): string {
  const home = mkTmp(prefix);
  installCcrc(home);
  containedPath(home);   // plant the poisoned gh FIRST; ghStub overwrites it below
  writePkg(home, '>=1.0.0');
  stubNode(home, 'v22.20.0');
  for (const b of ['tmux', 'jq', 'python3', 'flock']) stub(home, b, 'exit 0');
  stubGit(home);
  writeFileSync(join(home, 'fixture-git-email'), 'ops@example.invalid\n');
  stubLoginctl(home);
  writeFileSync(join(home, 'fixture-linger'), 'yes\n');
  ghStub(home, GH_OK, 0);
  linkReal(home, 'timeout');
  // A healthy box HAS a roster, and what the roster says is on disk. The
  // smallest true one: the upstream account and its binary. Every wrappers test
  // below starts here and adds (or replaces) exactly what it is about.
  writeBinary(home, 'claude');
  writeRoster(home, [UPSTREAM]);
  // …and it knows where its server is, and that server says the two boxes
  // agree. A healthy box is one where every check PASSES, so the fleet check
  // has to have something to measure here — a fixture whose fleet check SKIPPED
  // would make "runs every check in the table" and every summary count below
  // assert a weaker thing.
  writeCcrcEnv(home, `# a real one carries tokens too; the reader must ignore them\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n`);
  stubHealth(home, { mode: 'remote', connected: true, downSince: null, build: 'agreed', roster: 'agreed' });
  return home;
}

/** A box where nothing has been installed: no stubs at all, and a node floor
 *  no interpreter can meet. `gh` is still the POISON (ghContainedEnv plants it
 *  in every fixture), so `gh` is "present" and `gh_auth` runs it — which is the
 *  point: this fixture proves doctor really executes the contained gh. */
function broken(prefix: string): string {
  const home = mkTmp(prefix);
  installCcrc(home);
  containedPath(home);   // the poison is the only `gh` this fixture has
  writePkg(home, '>=99.0.0');
  return home;
}

/** The check table, read out of the shipped file rather than re-typed here —
 *  the same "enumerate once, derive" rule the rest of the project follows. */
function tableNames(): string[] {
  const r = spawnSync(BASH, ['-c',
    `set -uo pipefail; . ${shq(CHECKS_SRC)}; printf '%s\\n' "\${CCRC_DOCTOR_CHECKS[@]}"`],
    { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not read the check table: ${r.stderr}`);
  const names = (r.stdout ?? '').split('\n').filter(Boolean);
  // A scan over an empty list passes everything (the discipline
  // single-definition.test.ts:50-55 states outright). `"${arr[@]}"` on an
  // UNSET array is not an error under `set -u` in bash 4.4+, so a missing or
  // renamed table would otherwise return [] and quietly disarm every caller —
  // measured: it did, in this suite's own red run.
  if (names.length === 0) throw new Error(`${CHECKS_SRC} declares no CCRC_DOCTOR_CHECKS`);
  return names;
}

const lineFor = (out: string, name: string): string | undefined =>
  out.split('\n').find((l) => new RegExp(`^(PASS|WARN|FAIL) ${name}: `).test(l));

// ── the table itself ──────────────────────────────────────────────────────

describe('ccrc doctor: the check list is data', () => {
  it('every name in the table has a _check_<name> function, and vice versa', () => {
    // The table and its implementations are two halves of one thing; this is
    // the mechanism that stops them drifting. Adding a check is one entry plus
    // one function plus one test — and forgetting either half is red here.
    const names = tableNames();
    expect(names.length).toBeGreaterThan(0);
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CHECKS_SRC)}\n`
      + 'for n in "${CCRC_DOCTOR_CHECKS[@]}"; do declare -F "_check_$n" >/dev/null || echo "MISSING _check_$n"; done\n'
      + 'declare -F | sed -n "s/^declare -f _check_//p" | while read -r f; do\n'
      + '  case " ${CCRC_DOCTOR_CHECKS[*]} " in *" $f "*) ;; *) echo "ORPHAN _check_$f" ;; esac\n'
      + 'done'],
      { encoding: 'utf8', env: { ...process.env, PATH: process.env['PATH'] ?? '' } });
    expect(r.stdout.trim()).toBe('');
  });

  it('runs every check in the table and reports one verdict line each', () => {
    const home = healthy('ccrc-doctor-table-');
    const r = runDoctor(home);
    for (const n of tableNames()) {
      expect(lineFor(r.stdout, n), `no verdict line for check "${n}"\n${r.stdout}`).toBeTruthy();
    }
  });
});

// ── the node floor ────────────────────────────────────────────────────────

describe('ccrc doctor: node', () => {
  it('reads the node floor from package.json rather than carrying its own copy', () => {
    // The floor moves in ONE place. Mutate the shipped package.json's engines
    // pin in the fixture and the check must move with it.
    const home = healthy('ccrc-doctor-node-floor-');
    writePkg(home, '>=99.0.0');
    expect(runDoctor(home).stdout).toMatch(/FAIL node: .*99\.0\.0/);
  });

  it('refuses a range form it does not understand instead of guessing a floor', () => {
    const home = healthy('ccrc-doctor-node-range-');
    writePkg(home, '^22 || >=24');
    expect(runDoctor(home).stdout).toMatch(/FAIL node: unrecognised engines range/);
  });

  it('goes red when node itself is removed from the fixture', () => {
    const home = healthy('ccrc-doctor-node-missing-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL node: not on PATH/m);
    expect(r.code).toBe(1);
  });

  it('reads the AGENT package.json on a fleet box, where that is the only one shipped', () => {
    // deploy.sh:276 rsyncs `agent shared deploy ccd` to the fleet host: there
    // is no server/ directory there at all. node-floor.test.ts:45-50 asserts
    // all three declarations are byte-identical, which is why either answer is
    // the same answer — but only if doctor actually looks for both.
    const home = healthy('ccrc-doctor-node-agent-pkg-');
    rmSync(join(home, 'ccrc', 'server'), { recursive: true, force: true });
    writePkg(home, '>=99.0.0', 'agent');
    expect(runDoctor(home).stdout).toMatch(/FAIL node: .*99\.0\.0/);
  });

  it('says so plainly when no shipped package.json can be found at all', () => {
    const home = healthy('ccrc-doctor-node-no-pkg-');
    rmSync(join(home, 'ccrc', 'server'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL node: no shipped package\.json/m);
    expect(r.stdout).toMatch(/agent\/package\.json/);
  });

  it('a package.json that does not parse is its own answer, not "unrecognised range"', () => {
    const home = healthy('ccrc-doctor-node-bad-json-');
    writeRawPkg(home, 'not json at all');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL node: .*does not parse/m);
    expect(r.stdout).not.toMatch(/unrecognised engines range/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a package.json it cannot READ is its own answer, not "does not parse"', () => {
      // Two conditions an operator acts on completely differently — a mode fix
      // vs. a redeploy — must not share one signal. Before this split, `chmod
      // 000` produced "does not parse as JSON" and a remedy telling the
      // operator to redeploy a file that was never corrupt. Skipped as root,
      // where 000 is not a permission at all.
      const home = healthy('ccrc-doctor-node-unreadable-');
      chmodSync(join(home, 'ccrc', 'server', 'package.json'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^FAIL node: .*cannot be read \(EACCES\)/m);
      expect(r.stdout).not.toMatch(/does not parse/);
      expect(r.stdout).toMatch(/^ {2}remedy: .*ls -l/m);
    });

  it('accepts a floor with surrounding whitespace, exactly as node-floor.test.ts does', () => {
    // node-floor.test.ts:38-39 matches against `range.trim()`, so " >=1.0.0 "
    // leaves all three declarations identical and that suite green. A doctor
    // stricter than the rule it copies would fail a box whose manifests are
    // fine — the check must be as strict as node-floor, not stricter.
    const home = healthy('ccrc-doctor-node-ws-floor-');
    writePkg(home, ' >=1.0.0 ');
    const line = lineFor(runDoctor(home).stdout, 'node');
    expect(line).toMatch(/^PASS node: v22\.20\.0 satisfies >=1\.0\.0 /);
  });

  it('a package.json with no engines.node is its own answer too', () => {
    const home = healthy('ccrc-doctor-node-no-engines-');
    writePkg(home, null);
    expect(runDoctor(home).stdout).toMatch(/^FAIL node: .*declares no engines\.node/m);
  });

  it('passes when the interpreter clears the declared floor, and names both', () => {
    const home = healthy('ccrc-doctor-node-ok-');
    const line = lineFor(runDoctor(home).stdout, 'node');
    expect(line).toMatch(/^PASS node: v22\.20\.0 /);
    expect(line).toMatch(/>=1\.0\.0/);
  });
});

// ── the binaries ──────────────────────────────────────────────────────────

describe('ccrc doctor: the binaries a fleet box needs', () => {
  // One test per check, each removing that check's SUBJECT from the fixture.
  it.each(['tmux', 'git', 'jq', 'python3', 'flock'])(
    '%s goes red when it is removed from the fixture PATH', (bin) => {
      const home = healthy(`ccrc-doctor-bin-${bin}-`);
      unstub(home, bin);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(new RegExp(`^FAIL ${bin}: not on PATH`, 'm'));
      expect(r.code).toBe(1);
    });

  it('gh goes red when it is removed from the fixture PATH', () => {
    // `gh` lives in ghContainedEnv's own directory, not stub-bin, so its
    // removal is that file's removal. Nothing else on this PATH is a system
    // directory, so the real gh is still unreachable with it gone.
    const home = healthy('ccrc-doctor-bin-gh-');
    rmSync(join(home, '.local', 'bin', 'gh'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh: not on PATH/m);
    expect(r.code).toBe(1);
  });

  it('names the binary it found when it is there', () => {
    const home = healthy('ccrc-doctor-bin-ok-');
    expect(lineFor(runDoctor(home).stdout, 'tmux')).toContain(join(home, 'stub-bin', 'tmux'));
  });
});

// ── gh's authentication ───────────────────────────────────────────────────

describe('ccrc doctor: gh_auth', () => {
  it('goes red when gh is logged out', () => {
    const home = healthy('ccrc-doctor-ghauth-out-');
    ghStub(home, ['You are not logged into any GitHub hosts. To log in, run: gh auth login'], 1);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh_auth: /m);
    expect(r.code).toBe(1);
  });

  it('goes red when the token is missing the repo scope', () => {
    const home = healthy('ccrc-doctor-ghauth-scope-');
    ghStub(home, [...GH_OK.slice(0, -1), "  - Token scopes: 'gist', 'read:org'"], 0);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh_auth: .*repo/m);
    expect(r.code).toBe(1);
  });

  it("does not mistake 'repo:status' for the repo scope", () => {
    const home = healthy('ccrc-doctor-ghauth-substring-');
    ghStub(home, [...GH_OK.slice(0, -1), "  - Token scopes: 'repo:status', 'read:org'"], 0);
    expect(runDoctor(home).stdout).toMatch(/^FAIL gh_auth: /m);
  });

  it('WARNS, not passes, when gh reports no scopes line at all — unknown is not fine', () => {
    // An unreadable scope list is a third state: authenticated, but this check
    // cannot say whether the token can write. Collapsing it into PASS would
    // claim a fact nobody measured; collapsing it into FAIL would block a box
    // that may be perfectly fine. A WARN with a remedy is the honest answer.
    const home = healthy('ccrc-doctor-ghauth-noscopes-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN gh_auth: /m);
    expect(r.code).toBe(0);
  });

  it('passes on an authenticated token that carries repo', () => {
    const home = healthy('ccrc-doctor-ghauth-ok-');
    expect(lineFor(runDoctor(home).stdout, 'gh_auth')).toMatch(/^PASS gh_auth: /);
  });

  it('answers on a box with no coreutils timeout, rather than skipping the check', () => {
    const home = healthy('ccrc-doctor-ghauth-notimeout-');
    unstub(home, 'timeout');
    expect(lineFor(runDoctor(home).stdout, 'gh_auth')).toMatch(/^PASS gh_auth: /);
  });

  it('really executes the contained gh — the poison logs the argv it saw', () => {
    // Proof the check is not vacuous AND proof of containment in one
    // assertion: the only `gh` this suite can reach is the fixture's own.
    const home = broken('ccrc-doctor-ghauth-poison-');
    const r = runDoctor(home);
    expect(ghPoisonAt(home)).toContain('auth status');
    expect(r.stdout).toMatch(/^FAIL gh_auth: /m);
  });
});

// ── git's identity ────────────────────────────────────────────────────────

describe('ccrc doctor: git_email', () => {
  it('goes red when this box has no git user.email', () => {
    const home = healthy('ccrc-doctor-gitemail-missing-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL git_email: not set/m);
    expect(r.code).toBe(1);
  });

  it('names the address, and the scope it came from, when it is set', () => {
    const home = healthy('ccrc-doctor-gitemail-ok-');
    const line = lineFor(runDoctor(home).stdout, 'git_email');
    expect(line).toContain('ops@example.invalid');
    expect(line).toContain('--global');
  });

  it('falls back to the system config when there is no global one', () => {
    const home = healthy('ccrc-doctor-gitemail-system-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    writeFileSync(join(home, 'fixture-git-email-system'), 'box@example.invalid\n');
    const line = lineFor(runDoctor(home).stdout, 'git_email');
    expect(line).toMatch(/^PASS git_email: box@example\.invalid /);
    expect(line).toContain('--system');
  });

  it('a whitespace-only address is NOT set — and must not print an illegal line', () => {
    // "   " is non-empty after `$( )`, so it used to PASS, emitting
    // `PASS git_email:    ` — a line the shape test in this file declares
    // illegal, for a box whose commits carry an empty author address. Both
    // halves are asserted here: the verdict AND the line shape.
    const home = healthy('ccrc-doctor-gitemail-blank-');
    writeFileSync(join(home, 'fixture-git-email'), '   \n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL git_email: not set/m);
    expect(lineFor(r.stdout, 'git_email')).toMatch(/^(PASS|WARN|FAIL) [a-z0-9_]+: \S/);
    expect(r.code).toBe(1);
  });

  it('a dotfiles repo in $HOME is not this box\'s identity — the review\'s repro, pinned', () => {
    // THE REGRESSION THIS EXISTS FOR: the check first shipped as
    // `git -C "$HOME" config user.email`, which reads system + global PLUS
    // $HOME's own repo-local config. Under the widespread `git init ~`
    // dotfiles pattern that is a PASS on a value applying to exactly one
    // repository — a false PASS on the very box the check exists to catch.
    //
    // Uses the REAL git, deliberately: a stub cannot reproduce the config
    // precedence that IS the bug. Everything it reads is inside the fixture,
    // and GIT_CONFIG_NOSYSTEM keeps a box's /etc/gitconfig out of the answer so
    // the test means the same thing on every machine (this one has no
    // /etc/gitconfig at all; another might).
    const home = healthy('ccrc-doctor-gitemail-dotfiles-');
    unstub(home, 'git');
    linkReal(home, 'git');
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = only-a-name\n');
    const genv = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
    execFileSync('git', ['-C', home, 'init', '-q', '.'], { env: genv });
    execFileSync('git', ['-C', home, 'config', 'user.email', 'dotfiles-local@example.invalid'], { env: genv });
    // Sanity: the fixture really is the shape the bug needs — repo-local set,
    // global unset. Without this the test could go green on a fixture that
    // never reproduced anything.
    expect(execFileSync('git', ['-C', home, 'config', 'user.email'], { env: genv, encoding: 'utf8' }).trim())
      .toBe('dotfiles-local@example.invalid');

    const r = runDoctor(home, ['doctor'], { GIT_CONFIG_NOSYSTEM: '1' });
    expect(r.stdout).toMatch(/^FAIL git_email: not set/m);
    expect(r.stdout).not.toMatch(/dotfiles-local/);
    expect(r.code).toBe(1);
  });
});

// ── systemd linger ────────────────────────────────────────────────────────

describe('ccrc doctor: linger', () => {
  it('goes red when linger is off for this user', () => {
    const home = healthy('ccrc-doctor-linger-off-');
    writeFileSync(join(home, 'fixture-linger'), 'no\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL linger: not enabled/m);
    expect(r.code).toBe(1);
  });

  it('goes red when logind does not know this user at all', () => {
    // The measured shape of a box that never had linger: `loginctl show-user`
    // exits nonzero for a user with neither a live session nor linger, so the
    // absent answer arrives as an error, not as `Linger=no`.
    const home = healthy('ccrc-doctor-linger-unknown-');
    rmSync(join(home, 'fixture-linger'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL linger: /m);
    expect(r.code).toBe(1);
  });

  it('goes red when the box has no loginctl at all', () => {
    const home = healthy('ccrc-doctor-linger-nologinctl-');
    unstub(home, 'loginctl');
    expect(runDoctor(home).stdout).toMatch(/^FAIL linger: loginctl is not on PATH/m);
  });

  it('passes when linger is enabled', () => {
    const home = healthy('ccrc-doctor-linger-ok-');
    expect(lineFor(runDoctor(home).stdout, 'linger')).toMatch(/^PASS linger: enabled/);
  });
});

// ── the roster against the wrappers on disk ───────────────────────────────
// Task 5. Deliberately stronger than the spec's "wrappers present and
// executable", because presence was never the failure mode: D-69 is a wrapper
// that is present, executable, and sourcing a secrets file its roster entry
// does not mention — which is invisible to every check that only stats a file.

describe('ccrc doctor: wrappers', () => {
  it('fails when a generated account declares no secretsFile but its wrapper sources one', () => {
    // D-69, reproduced as a fixture: the exact live shape on the fleet host,
    // where `claude-corp` is `{"kind":"generated"}` and its wrapper really does
    // source .cc-secrets/claude-corp-oauth.env.
    const home = healthy('ccrc-doctor-wrappers-d69-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/sources \.cc-secrets\/acct-a\.env.*roster declares none/);
  });

  it('fails the other direction too — the roster declares a secretsFile the wrapper does not source', () => {
    const home = healthy('ccrc-doctor-wrappers-reverse-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });                    // no secrets line
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    // The SENTENCE, not just the path: "acct-a sources  but the roster declares
    // …" is what a single catch-all comparison produces, and a verdict with a
    // hole in it is a verdict an operator has to guess at. Measured — deleting
    // this direction's own branch left every looser assertion green.
    expect(r.stdout).toMatch(/acct-a sources no secrets file but the roster declares \.cc-secrets\/acct-a\.env/);
    expect(r.code).toBe(1);
  });

  it('fails the THIRD way too — both name a secrets file and they are different files', () => {
    // The arm the whole-branch review found unpinned, and the one a real box
    // reaches by the most ordinary route there is: somebody renamed the
    // credentials file and updated one side. Measured before the fix — with
    // this arm deleted the suite was 169/169 GREEN and doctor answered
    // `PASS wrappers: 2 accounts … match`, which is a wrapper loading
    // credentials nobody wrote down reported as a healthy box.
    //
    // The two paths are a NEAR MISS on purpose (the live shape is
    // `claude-corp-oauth.env`): unrelated names would also pass a comparison
    // that had been loosened to a prefix or substring test.
    const home = healthy('ccrc-doctor-wrappers-secrets-differ-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a-oauth.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /acct-a sources \.cc-secrets\/acct-a\.env but the roster declares \.cc-secrets\/acct-a-oauth\.env/);
    // BOTH paths, and the roster's one named rather than called "none": an
    // operator has to know which of the two files to go and look at, and this
    // arm collapsing into the first one's wording would say something false
    // about a roster that does declare a file.
    expect(r.stdout).not.toMatch(/acct-a sources .* but the roster declares none/);
    expect(r.code).toBe(1);
  });

  it('fails when a roster account has no wrapper at all', () => {
    const home = healthy('ccrc-doctor-wrappers-ghost-');
    writeRoster(home, [{ id: 'ghost', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    // `$HOME` as written, not as resolved: it is how the wrapper spells its own
    // paths, so the operator can grep for the same string.
    expect(r.stdout).toMatch(/FAIL wrappers: ghost .*no executable at \$HOME\/\.local\/bin\/ghost/);
  });

  it('describes the account it is talking about, not whichever one came last in the roster', () => {
    // The finding names an id AND describes a file; both have to be the same
    // account. A `local dir="$1" id="$2" p="…/$id"` builds `p` from the
    // CALLER's `id` — bash expands the whole `local` before any name becomes
    // local — so the missing account got measured against the LAST roster
    // entry's wrapper and was reported with the wrong sentence. Invisible
    // whenever the missing account happens to be last, which is why this
    // fixture puts a real, present wrapper after it.
    const home = healthy('ccrc-doctor-wrappers-wrong-account-');
    writeSymlinkWrapper(home, 'zz-last', 'zz-bespoke');
    writeRoster(home, [
      { id: 'ghost', exec: { kind: 'generated' } },
      { id: 'zz-last', exec: { kind: 'external' } },
    ]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(r.stdout).not.toMatch(/ghost is declared generated but/);
  });

  it('fails when the wrapper points at a config dir the roster does not declare', () => {
    const home = healthy('ccrc-doctor-wrappers-cfgdir-');
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/\.somewhere-else.*\.acct-a/);
    expect(r.code).toBe(1);
  });

  it('fails when a generated wrapper execs something other than the roster\'s upstream account', () => {
    const home = healthy('ccrc-doctor-wrappers-target-');
    writeWrapper(home, 'acct-a', { target: 'some-other-binary' });
    writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/some-other-binary/);
    expect(r.code).toBe(1);
  });

  it('leaves an external account alone — ccrc records it and never touches it', () => {
    // `gpt` on the reference box is a symlink to a bespoke script. It has no
    // generated shape and must not be reported as broken for lacking one — nor
    // may its symlink TARGET be reported as an account of its own.
    const home = healthy('ccrc-doctor-wrappers-external-');
    writeSymlinkWrapper(home, 'ext-a', 'bespoke-tool');
    writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-a/);
    expect(r.stdout).not.toMatch(/bespoke-tool/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
  });

  it('passes when the upstream account is a non-script binary, which is its normal shape', () => {
    const home = healthy('ccrc-doctor-wrappers-upstream-');
    writeBinary(home, 'up');                       // the real claude is a 300MB ELF
    writeRoster(home, [{ id: 'up', exec: { kind: 'upstream' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/FAIL wrappers/);
    expect(r.code).toBe(0);
  });

  it('names what it measured when everything agrees, never the bare word "ok"', () => {
    const home = healthy('ccrc-doctor-wrappers-ok-');
    writeWrapper(home, 'acct-a', { secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{
      id: 'acct-a', exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const line = lineFor(runDoctor(home).stdout, 'wrappers');
    expect(line).toMatch(/^PASS wrappers: /);
    expect(line).toMatch(/2 accounts/);
    expect(line).toContain('accounts.json');
  });

  it('WARNS about a wrapper on disk the roster describes nowhere — reported, never resolved', () => {
    // adopt's bias rule (ccrc-adopt:32-39), carried over: the ambiguous case is
    // REPORTED. It is not a FAIL — keeping a launcher the fleet does not drive
    // is a legitimate thing to do — but a silent pass would hide the account
    // that was added to disk and never written down.
    const home = healthy('ccrc-doctor-wrappers-undeclared-');
    writeWrapper(home, 'stray', { cfgDir: '.stray' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: .*stray/m);
    expect(r.code).toBe(0);
  });

  it('does not count a symlink alias of a declared wrapper as a second account', () => {
    // The measured shape: `gpt -> ccgpt`, both in ~/.local/bin, one file. The
    // alias is not an undeclared account, and saying it is would make the WARN
    // above fire on every box that has one.
    const home = healthy('ccrc-doctor-wrappers-alias-');
    writeSymlinkWrapper(home, 'ext-a', 'ccgpt-like');
    writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
    expect(runDoctor(home).stdout).not.toMatch(/ccgpt-like/);
  });

  it('fails when this box has no roster at all, rather than reporting agreement nobody measured', () => {
    const home = healthy('ccrc-doctor-wrappers-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    const r = runDoctor(home);
    // "absent" and "there is something there but it is not a file" are two
    // conditions an operator acts on differently, so the message is asserted,
    // not just the FAIL: measured, deleting the absent branch left the file's
    // NEXT guard answering for it with the wrong sentence, and every looser
    // assertion stayed green.
    expect(r.stdout).toMatch(/^FAIL wrappers: no account roster at \$HOME\/\.ccrc\/accounts\.json/m);
    expect(r.code).toBe(1);
  });

  it('refuses a roster with zero accounts rather than reporting agreement nobody measured', () => {
    // A scan over an empty list passes everything — this suite's own recurring
    // failure mode, and the reason `runs every check in the table` exists.
    const home = healthy('ccrc-doctor-wrappers-empty-');
    writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [] }));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*zero accounts/m);
    expect(r.code).toBe(1);
  });

  it('a secrets guard that TESTS one path and SOURCES another is not the generated shape', () => {
    // The bug class `_wrap_parse_shape` reconstructs-and-compares to avoid
    // (ccrc-wrapper-shape, "EACH SIGNIFICANT LINE IS CHECKED BY STRIPPING"): a
    // regex capturing two occurrences of the same path in one line silently
    // accepts a MISMATCHED pair, and a wrapper that guards on a file it does
    // not load is a wrapper that starts unauthenticated with no error at all.
    const home = healthy('ccrc-doctor-wrappers-mismatched-pair-');
    writeFileSync(join(binDir(home), 'acct-a'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.acct-a"',
      '[ -r "$HOME/.cc-secrets/acct-a.env" ] && . "$HOME/.cc-secrets/OTHER.env"',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a .*not the generated shape/);
    expect(r.code).toBe(1);
  });

  it('a roster that does not parse is its own answer, not "no roster"', () => {
    const home = healthy('ccrc-doctor-wrappers-badjson-');
    writeFileSync(join(home, '.ccrc', 'accounts.json'), 'not json at all');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*does not parse/m);
    expect(r.stdout).not.toMatch(/no account roster/);
  });

  it('fails loudly, and names the file, when the wrapper-shape library did not ship', () => {
    // THE THIRD FILE. `ccrc` reaches its siblings through `${BASH_SOURCE[0]}`,
    // which bash does not resolve through a symlink, so `ccrc`,
    // `ccrc-doctor-checks` and `ccrc-wrapper-shape` must be installed into one
    // directory together. This is that requirement as a mechanism rather than a
    // sentence in a report.
    const home = healthy('ccrc-doctor-wrappers-nolib-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*ccrc-wrapper-shape/m);
    expect(r.code).toBe(1);
  });

  // ── two classes of finding, two verdict lines ───────────────────────────
  // The reference box's own reading: one real defect (D-69) plus two launchers
  // somebody keeps on purpose. Joined into one FAIL sentence that read as three
  // defects, told the operator to reconcile the roster with launchers that are
  // not accounts, threw away the remedy that belonged to them, and let the
  // summary print `0 warned` with warn-class findings on the screen.
  /** The two-class fixture: a hard finding (D-69) and a soft one (an
   *  undeclared launcher) in the same run. */
  function twoClasses(prefix: string): string {
    const home = healthy(prefix);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeWrapper(home, 'stray', { cfgDir: '.stray' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    return home;
  }

  it('keeps a soft finding OFF the FAIL line — a launcher nobody declared is not a defect', () => {
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-fail-');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('acct-a sources .cc-secrets/acct-a.env');
    // THE PIN: the soft finding must not be laundered into the FAIL sentence.
    expect(lines[i]).not.toContain('stray');
    // …nor may the FAIL's remedy be the soft one's. "Make the roster and the
    // wrapper agree" is the wrong instruction for a deliberate launcher.
    expect(lines[i + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
  });

  it('still reports the soft findings when a hard one is present — its own line, its own remedy', () => {
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-warn-');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN wrappers: '));
    // THE OTHER PIN: dropping the soft findings whenever a hard one exists is
    // silent, and silence is the failure mode this check exists to end.
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('stray');
    expect(lines[i]).not.toContain('acct-a');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: either describe it/);
    expect(r.code).toBe(1);          // the worse class still decides the exit
  });

  it('counts BOTH lines in the summary — a run with a warning does not say "0 warned"', () => {
    // The count is over verdict LINES, so a check that answered in two classes
    // is counted in both and the totals may exceed the number of checks. That
    // is the honest shape: it is what happened.
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-summary-');
    const r = runDoctor(home);
    const last = r.stdout.split('\n').filter(Boolean).pop() ?? '';
    const m = /^summary: (\d+) checks \((\d+) skipped\), (\d+) verdicts — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, skipped, verdicts, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(skipped).toBe(0);
    expect(warn).toBeGreaterThanOrEqual(1);
    expect(fail).toBeGreaterThanOrEqual(1);
    // BOTH nouns, because they are different numbers here: twelve checks
    // answered with thirteen verdicts. The line says which is which so that the
    // sum not matching the leading number reads as the fact it is rather than
    // as an arithmetic bug somebody should go and "fix".
    expect(pass + warn + fail).toBe(verdicts);
    expect(verdicts).toBeGreaterThan(total);
  });

  // ── an external account: existence, and nothing else ────────────────────
  it('passes a COMPILED external launcher — an external account\'s content is never read', () => {
    // The measured defect: `wr_seen` demanded a script carrying a literal
    // `export CLAUDE_CONFIG_DIR=` line, so a legitimate external account was
    // reported as `ext-bin is declared external but … is not a script`.
    const home = healthy('ccrc-doctor-wrappers-extcompiled-');
    writeBinary(home, 'ext-bin');
    writeRoster(home, [{ id: 'ext-bin', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-bin/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
    expect(r.code).toBe(0);
  });

  it('passes an external launcher that spells CLAUDE_CONFIG_DIR its own way', () => {
    // `CLAUDE_CONFIG_DIR=… exec claude "$@"` is a perfectly good launcher and
    // matches no `^\s*export\s+CLAUDE_CONFIG_DIR=` line. ccrc does not write
    // external wrappers, so it has no standing to demand a spelling of one.
    const home = healthy('ccrc-doctor-wrappers-extinline-');
    writeFileSync(join(binDir(home), 'ext-sh'), [
      '#!/usr/bin/env bash',
      'CLAUDE_CONFIG_DIR="$HOME/.ext-sh" exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{ id: 'ext-sh', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-sh/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
  });

  it('fails an external account with no executable at all — presence IS checked', () => {
    // The other half of the rule. "Never read" is not "never look".
    const home = healthy('ccrc-doctor-wrappers-ext-missing-');
    writeRoster(home, [{ id: 'ext-gone', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: ext-gone has no executable at \$HOME\/\.local\/bin\/ext-gone/);
    expect(r.code).toBe(1);
  });

  // ── the upstream account: the same presence triad ───────────────────────
  it('fails when the upstream account has no executable at all', () => {
    const home = healthy('ccrc-doctor-wrappers-up-missing-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: claude has no executable at \$HOME\/\.local\/bin\/claude/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is a symlink to a path that does not exist', () => {
    const home = healthy('ccrc-doctor-wrappers-up-dangling-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    symlinkSync(join(home, '.local', 'share', 'claude', 'versions', 'gone'), join(binDir(home), 'claude'));
    const r = runDoctor(home);
    // The measured shape of a real upstream account is exactly this symlink,
    // pointing at a versions/ directory an update can remove.
    expect(r.stdout).toMatch(/FAIL wrappers: claude's \$HOME\/\.local\/bin\/claude is a symlink to a path that does not exist/);
    expect(r.stdout).not.toMatch(/claude has no executable/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is present but not executable', () => {
    const home = healthy('ccrc-doctor-wrappers-up-noexec-');
    chmodSync(join(binDir(home), 'claude'), 0o644);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: claude's \$HOME\/\.local\/bin\/claude is not executable/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is ITSELF a script that sets CLAUDE_CONFIG_DIR', () => {
    // The upstream account is invoked with CLAUDE_CONFIG_DIR unset by
    // definition (ccrc-adopt's header). A wrapper there means every other
    // account's exec lands in whatever config dir this one exports.
    const home = healthy('ccrc-doctor-wrappers-up-is-wrapper-');
    writeWrapper(home, 'claude', { cfgDir: '.claude' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: claude is the roster's upstream account, but \$HOME\/\.local\/bin\/claude is a script that sets CLAUDE_CONFIG_DIR/);
    expect(r.code).toBe(1);
  });

  // ── the four-way a-only split, pinned where it is easiest to collapse ────
  it('a generated account whose wrapper is a DANGLING SYMLINK says so, not "no executable"', () => {
    const home = healthy('ccrc-doctor-wrappers-gen-dangling-');
    symlinkSync(join(home, '.local', 'bin', 'nothing-here'), join(binDir(home), 'acct-a'));
    writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is a symlink to a path that does not exist/);
    expect(r.stdout).not.toMatch(/acct-a has no executable/);
    expect(r.stdout).not.toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is not executable/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper is NOT EXECUTABLE says so, not "no executable"', () => {
    // A `chmod` and a reinstall are different actions, so these are different
    // sentences. The check's own comment calls this four-way split an
    // anti-overloaded-seam design; these two tests are what makes that true.
    const home = healthy('ccrc-doctor-wrappers-gen-noexec-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    chmodSync(join(binDir(home), 'acct-a'), 0o644);
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is not executable/);
    expect(r.stdout).not.toMatch(/acct-a has no executable/);
    expect(r.stdout).not.toMatch(/is a symlink to a path that does not exist/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper is NOT A SCRIPT says so', () => {
    // Present, executable, and an ELF: the roster claims ccrc generated this
    // wrapper, and what is there was never generated by anything. Unpinned
    // until the round-2 review measured it — blanking this whole inner branch
    // left the suite green while a real defect went unreported.
    const home = healthy('ccrc-doctor-wrappers-gen-notscript-');
    writeBinary(home, 'acct-a');
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a is declared generated but \$HOME\/\.local\/bin\/acct-a is not a script/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper sets NO CLAUDE_CONFIG_DIR says so', () => {
    // A script, executable, and it launches something — but it exports no
    // config dir, so it runs in whatever directory the caller had. That is a
    // different repair from "this is not a script at all".
    const home = healthy('ccrc-doctor-wrappers-gen-nocfgdir-');
    writeFileSync(join(binDir(home), 'acct-a'), [
      '#!/usr/bin/env bash',
      '# no export line at all',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a is declared generated but \$HOME\/\.local\/bin\/acct-a sets no CLAUDE_CONFIG_DIR/);
    expect(r.stdout).not.toMatch(/is not a script/);
    expect(r.code).toBe(1);
  });

  it('keeps the two shape sentences DISTINCT when both defects are on one box', () => {
    // The merge this pins against is the one-liner a tidy-minded reader
    // reaches for: `… is not a wrapper` covering both. One run, both defects,
    // and the operator has to be able to tell which file needs which repair —
    // reinstall the wrapper, versus add the line it is missing.
    const home = healthy('ccrc-doctor-wrappers-shape-distinct-');
    writeBinary(home, 'acct-elf');
    writeFileSync(join(binDir(home), 'acct-sh'), [
      '#!/usr/bin/env bash',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [
      { id: 'acct-elf', configDirSuffix: '.acct-elf', exec: { kind: 'generated' } },
      { id: 'acct-sh', configDirSuffix: '.acct-sh', exec: { kind: 'generated' } },
    ]);
    const line = lineFor(runDoctor(home).stdout, 'wrappers') ?? '';
    expect(line).toContain('acct-elf is declared generated but $HOME/.local/bin/acct-elf is not a script');
    expect(line).toContain('acct-sh is declared generated but $HOME/.local/bin/acct-sh sets no CLAUDE_CONFIG_DIR');
    // Two findings, two sentences, and neither account is described by the
    // other's words.
    expect(line).not.toMatch(/acct-elf[^;]*sets no CLAUDE_CONFIG_DIR/);
    expect(line).not.toMatch(/acct-sh[^;]*is not a script/);
  });

  it('fails when what is at $HOME/.local/bin/<id> is a DIRECTORY, for either kind', () => {
    // A directory is `-e` and `-x` both — that is what the execute bit means
    // on one — so a presence check written as "exists and is executable" reads
    // `mkdir` as a healthy account. Both kinds that share `_dr_wr_present` are
    // in this one fixture, because the narrowing was in the shared helper.
    const home = healthy('ccrc-doctor-wrappers-dir-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    mkdirSync(join(binDir(home), 'claude'), { recursive: true });
    mkdirSync(join(binDir(home), 'ext-dir'), { recursive: true });
    writeRoster(home, [{ id: 'ext-dir', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/ext-dir's \$HOME\/\.local\/bin\/ext-dir is not a regular file/);
    expect(r.stdout).toMatch(/claude's \$HOME\/\.local\/bin\/claude is not a regular file/);
    expect(lineFor(r.stdout, 'wrappers')).not.toMatch(/^PASS/);
    expect(r.code).toBe(1);
  });

  // ── the roster as a document: every way it can be wrong ─────────────────
  it('fails when the same id is declared twice in the roster', () => {
    // Two entries, one wrapper: whichever one an operator edits, the other is
    // still there. A silent "last one wins" is how a fixed account stays broken.
    const home = healthy('ccrc-doctor-wrappers-dup-id-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    const e = entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } });
    writeRawRoster(home, rawRoster(UP_JSON, e, e));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*acct-a is declared twice in the roster/);
    expect(r.code).toBe(1);
  });

  it('fails when a roster entry has no id at all', () => {
    const home = healthy('ccrc-doctor-wrappers-no-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ configDirSuffix: '.x', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*the roster holds an account with no id/);
    expect(r.code).toBe(1);
  });

  it('refuses an id that is not an id, instead of inventing a plausible one', () => {
    // The reader used to squash `\t` to a space, so `"acct\tb"` was reported as
    // `acct b has no executable at …` — a sentence about an account that does
    // not exist, naming a file nobody could create. WRAPPER_ID_RE is the same
    // rule the disk side is held to; the id is echoed back as it was spelled.
    const home = healthy('ccrc-doctor-wrappers-illegal-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'acct\tb', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*is not a legal account id/);
    expect(r.stdout).toContain('acct\\tb');
    expect(r.stdout).not.toMatch(/acct b/);
    expect(r.code).toBe(1);
  });

  it('escapes EVERY control byte, not the three that would break its own TSV', () => {
    // The verdict line is read by a human on a terminal that ACTS on control
    // bytes: `claude<BS>corp` renders as an account that exists. Escaping only
    // \t \r \n left the invented-id failure reachable through any other C0
    // byte, so the whole range is escaped and none of it reaches the output.
    const home = healthy('ccrc-doctor-wrappers-c0-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'claude\bcorp', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toContain('claude\\x08corp');
    expect(r.stdout).toMatch(/is not a legal account id/);
    expect(r.stdout).not.toContain('\b');
    expect(r.stderr).not.toContain('\b');
  });

  it('escapes the backslash too, so an escaped id cannot be forged by a real one', () => {
    // Injectivity, which is the whole value of an escaped rendering: without
    // the backslash escape, an id spelled with a literal backslash-t and an id
    // carrying a real tab print IDENTICALLY, and the operator cannot tell
    // which of the two is in the file they are about to edit.
    const home = healthy('ccrc-doctor-wrappers-escape-injective-');
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'acct\tb', exec: { kind: 'generated' } }),        // a real TAB
      entry({ id: 'acct\\tb', exec: { kind: 'generated' } })));     // a literal backslash-t
    const line = lineFor(runDoctor(home).stdout, 'wrappers') ?? '';
    expect(line).toContain('acct\\tb');       // the tab, escaped
    expect(line).toContain('acct\\\\tb');     // the backslash, escaped — a different string
  });

  it('fails when a generated entry declares no configDirSuffix for its wrapper to match', () => {
    const home = healthy('ccrc-doctor-wrappers-no-suffix-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's roster entry declares no configDirSuffix, so its wrapper's \.acct-a answers to nothing/);
    expect(r.code).toBe(1);
  });

  it('fails on an exec.kind it does not understand rather than skipping the entry', () => {
    // The `*)` arm. An entry this check cannot classify is an entry it did not
    // check, and a doctor that silently skips one reports a box it never
    // measured.
    const home = healthy('ccrc-doctor-wrappers-bad-kind-');
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'weird' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's roster entry declares no exec\.kind this check understands \("weird"\)/);
    expect(r.code).toBe(1);
  });

  it('WARNS when the roster declares no upstream account for an exec target to be checked against', () => {
    const home = healthy('ccrc-doctor-wrappers-no-upstream-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: the roster declares no upstream account/m);
    expect(r.code).toBe(0);
  });

  it('WARNS when the roster declares more than one upstream account, and names the one it used', () => {
    const home = healthy('ccrc-doctor-wrappers-two-upstream-');
    writeBinary(home, 'claude-b');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'claude-b', configDirSuffix: '.claude-b', exec: { kind: 'upstream' } }),
      entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: the roster declares 2 upstream accounts; every exec target was checked against the first, claude$/m);
    expect(r.code).toBe(0);
  });

  it('fails when the roster parses but declares no accounts array', () => {
    const home = healthy('ccrc-doctor-wrappers-no-array-');
    writeRawRoster(home, '{"version":1}');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*parses but declares no accounts array/m);
    expect(r.stdout).not.toMatch(/does not parse/);
    expect(r.code).toBe(1);
  });

  it('fails when the roster path is not a regular file, rather than reading a directory', () => {
    const home = healthy('ccrc-doctor-wrappers-notafile-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    mkdirSync(join(home, '.ccrc', 'accounts.json'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/no account roster at/);
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a roster it cannot READ is its own answer, not "does not parse"', () => {
      // A mode/ownership fix and a restore-from-backup are different actions.
      // Skipped as root, where 000 is not a permission at all.
      const home = healthy('ccrc-doctor-wrappers-unreadable-');
      chmodSync(join(home, '.ccrc', 'accounts.json'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^FAIL wrappers: .*cannot be read \(EACCES\)/m);
      expect(r.stdout).not.toMatch(/does not parse/);
      expect(r.stdout).toMatch(/^ {2}remedy: .*ls -l/m);
      expect(r.code).toBe(1);
    });

  it('says node is missing, in its own words, rather than blaming the roster', () => {
    // A check must not fail for a reason that belongs to another check: with no
    // interpreter there is nothing wrong with the roster, and the remedy points
    // at the node check rather than at accounts.json.
    const home = healthy('ccrc-doctor-wrappers-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: node is not on PATH/m);
    expect(r.stdout).not.toMatch(/does not parse/);
    expect(r.code).toBe(1);
  });

  it('an unknown exit from the roster reader is called a bug in ccrc, not a fact about the box', () => {
    // The reader answers 0/3/4/5/6 and this arm is what happens when it one day
    // answers something else. Reached by making the interpreter itself fail for
    // the roster read only.
    const home = healthy('ccrc-doctor-wrappers-weird-exit-');
    stubNodeRosterExit(home, 7);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: reading \$HOME\/\.ccrc\/accounts\.json exited 7 — this check does not know what that means/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.code).toBe(1);
  });

  it('fails when there is no $HOME/.local/bin at all', () => {
    const home = healthy('ccrc-doctor-wrappers-nobindir-');
    rmSync(join(home, '.local', 'bin'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: no \$HOME\/\.local\/bin at all/m);
    expect(r.code).toBe(1);
  });

  it('never tells a deployed box to run a script from a checkout it does not have', () => {
    const text = readFileSync(CHECKS_SRC, 'utf8');
    // `ccrc adopt` execs ccrc-adopt where it ships; a remedy naming a repo-
    // relative path is an instruction only a developer can follow, and doctor's
    // whole job is the box that is not a developer's.
    expect(text).not.toMatch(/bash ccd\/ccrc-adopt/);
  });

  it('tells an operator with a missing wrapper which verb writes one', () => {
    // The a-only side of the roster/disk difference used to end in a paragraph
    // about what an account is. It is now a command.
    expect(readFileSync(CHECKS_SRC, 'utf8')).toMatch(/ccrc wrappers/);
  });

  // ── the security boundary ───────────────────────────────────────────────
  it('does not read, print, or hash the contents of any secrets file', () => {
    // The check compares PATHS. Reading the token would put it in a log — and
    // doctor's output is exactly the thing an operator pastes into a ticket.
    // Scanned across all three shipped files, not just the check's own: the
    // wrapper-shape library is where the secrets PATH is parsed out.
    for (const f of [CHECKS_SRC, LIB_SRC, CCRC_SRC]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/cat\s+[^\n]*cc-secrets|\$\(<[^\n]*cc-secrets/);
      // The generic forms, not just the literal directory name: `$secrets` is
      // what the parsed path is called, and every way of opening it is banned.
      expect(src, f).not.toMatch(/(?:cat|source|md5sum|sha\d+sum|head|tail|mapfile|readarray)\s+[^\n|]*\$\{?(?:w?secrets|SECRETS)\b/);
      expect(src, f).not.toMatch(/<\s*"?\$\{?(?:w?secrets|SECRETS)\b/);
    }
  });

  it('never emits the contents of a secrets file it names — measured with a canary', () => {
    // The source scan above catches the copy someone would write; this catches
    // it however it was written. The file exists, it is readable, it is named
    // in the verdict, and its content must not appear anywhere in the output.
    const home = healthy('ccrc-doctor-wrappers-canary-');
    const canary = 'sk-ccrc-canary-do-not-print-e4f19b';
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    writeFileSync(join(home, '.cc-secrets', 'acct-a.env'), `CLAUDE_CODE_OAUTH_TOKEN=${canary}\n`);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toContain('.cc-secrets/acct-a.env');   // the PATH is named
    expect(r.stdout).not.toContain(canary);                 // the CONTENT is not
    expect(r.stderr).not.toContain(canary);
  });

  it('answers the same whether the secrets file exists or not — it is a path, not a fact about a file', () => {
    // Two boxes, one roster, one wrapper: with the secrets file present and
    // absent. A check that stat'ed the path would answer differently, and would
    // then be reporting on the token's existence rather than on the roster.
    const withFile = healthy('ccrc-doctor-wrappers-sec-present-');
    const without = healthy('ccrc-doctor-wrappers-sec-absent-');
    for (const home of [withFile, without]) {
      writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
      writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    }
    mkdirSync(join(withFile, '.cc-secrets'), { recursive: true });
    writeFileSync(join(withFile, '.cc-secrets', 'acct-a.env'), 'TOKEN=x\n');
    const line = lineFor(runDoctor(withFile).stdout, 'wrappers');
    // Not two undefineds: this fixture is the D-69 shape, so there IS a verdict
    // and it is a FAIL. Without this the comparison below passes on a box where
    // the check never ran at all.
    expect(line).toMatch(/^FAIL wrappers: acct-a /);
    expect(line).toBe(lineFor(runDoctor(without).stdout, 'wrappers'));
  });
});

// ── the two boxes' matched set ────────────────────────────────────────────
// Task 7. The check asks the SERVER — the only party that can compare the two
// boxes — and reports its answer. It decides nothing about the comparison
// itself: `rosterAgreement`/`buildAgreement` (server/src/fleetstate.ts) own
// that, and both are deliberately THREE-valued, so the whole job here is to
// keep the three apart. `'unknown'` is not disagreement (an older agent, an
// unstamped box), and "there is no server to ask" is not agreement.

describe('ccrc doctor: fleet', () => {
  it('passes when the server says both boxes agree, and names what it measured', () => {
    const home = healthy('ccrc-doctor-fleet-agreed-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet');
    expect(line).toMatch(/^PASS fleet: the two boxes agree/);
    // Never the bare word "ok": the address it asked, and both answers.
    expect(line).toContain(FIXTURE_ADDR);
    expect(r.code).toBe(0);
  });

  it('really asks the server — the stub logs the one URL it was given', () => {
    // Proof the check is not vacuous AND proof of containment in one
    // assertion, the same shape the gh poison gives gh_auth: the only `curl`
    // this suite can reach is the fixture's own, and it saw exactly one URL.
    const home = healthy('ccrc-doctor-fleet-asked-');
    runDoctor(home);
    const calls = curlCalls(home);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain(`http://${FIXTURE_ADDR}/api/fleet/health`);
  });

  it('fails on a skewed build, and the remedy names the ORDER', () => {
    const home = healthy('ccrc-doctor-fleet-skewed-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL fleet: the two boxes are running different builds/);
    // AGENT FIRST is the whole content of the remedy: a change touching ccd/
    // ships to the fleet host before the server, because the server reads what
    // the hook writes.
    expect(r.stdout).toMatch(/remedy: .*deploy the lagging box.*agent first/i);
  });

  it('fails on a divergent roster, in its own words and with its own remedy', () => {
    // Not the build's sentence and not the build's remedy: reconciling two
    // rosters is a different action from deploying a lagging box, and
    // `rosterAgreement`'s own docstring states the order (redeploy both first,
    // reconcile the JSON second).
    const home = healthy('ccrc-doctor-fleet-divergent-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'agreed', roster: 'divergent' });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL fleet: the two boxes would run different ~\/\.ccrc\/accounts\.sh/);
    expect(r.stdout).not.toMatch(/running different builds/);
  });

  it('keeps the two disagreements on SEPARATE lines when both are true at once', () => {
    // The merge a tidy-minded reader reaches for — one "the boxes disagree"
    // line — hands one of the two findings the other's remedy. They are two
    // repairs, so they are two lines.
    const home = healthy('ccrc-doctor-fleet-both-bad-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'divergent' });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const b = lines.findIndex((l) => l.startsWith('FAIL fleet: the two boxes are running different builds'));
    const s = lines.findIndex((l) => l.startsWith('FAIL fleet: the two boxes would run different ~/.ccrc/accounts.sh'));
    expect(b, r.stdout).toBeGreaterThan(-1);
    expect(s, r.stdout).toBeGreaterThan(-1);
    expect(b).not.toBe(s);
    expect(lines[b + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[s + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[b + 1]).not.toBe(lines[s + 1]);
    expect(r.code).toBe(1);
  });

  it('only warns on unknown — an older agent is not a broken fleet', () => {
    const home = healthy('ccrc-doctor-fleet-unknown-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'agreed' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN fleet: /m);
    expect(r.stdout).not.toMatch(/FAIL fleet: /);
    expect(r.code).toBe(0);
  });

  it('warns once, naming both, when NEITHER answer is known', () => {
    const home = healthy('ccrc-doctor-fleet-both-unknown-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'unknown' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('build');
    expect(line).toContain('roster');
    expect(r.code).toBe(0);
  });

  it('reads an ABSENT build/roster as unknown, exactly as the wire contract says', () => {
    // shared/api.ts: both fields are optional and "absent reads as 'unknown'".
    // One reader per field — an older server that omits them must not arrive as
    // a fourth state here. The SENTENCE is asserted, not just the class: "no
    // stamp has reached the server" and "the server said something I do not
    // recognise" are the same WARN and two entirely different diagnoses, and
    // this is the live shape today (the deployed server predates the field).
    const home = healthy('ccrc-doctor-fleet-absent-fields-');
    stubHealth(home, { mode: 'remote', connected: true });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('build: unknown');
    expect(line).toContain('roster: unknown');
    expect(line).not.toMatch(/does not recognise/);
    expect(r.code).toBe(0);
  });

  it('says so, rather than reporting a fleet, when ccrc\'s own readers are not loaded', () => {
    // The check calls `_box_server_addr`/`_box_health`, which live in `ccrc`
    // itself — this file is only ever sourced BY ccrc. Sourced by anything
    // else, the check must say that in a verdict line rather than assume, the
    // same way `_check_wrappers` reports a missing ccrc-wrapper-shape.
    // CONTAINED LIKE `roleFor` BELOW, and not because it needs to be today:
    // the guard under test returns before the check reads anything, so this
    // passed the real HOME and the real PATH straight into a `_check_fleet`
    // that never used them. The moment the check grows one step AHEAD of that
    // guard, this test reads the live `~/.ccrc/ccrc.env` and curls the
    // production server from a unit test. A HOME that cannot exist removes the
    // only file that could name a server, and a PATH of the same non-existent
    // directory removes `curl` — this file resolves no binary at source time
    // (its own header's "no PATH lookups" rule), so nothing legitimate needs
    // either.
    const nowhere = join(REPO, 'no-such-home-for-check-fleet');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_fleet`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL fleet: ccrc's own fleet readers are not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  it('warns rather than fails when the server is unreachable — that is a different problem', () => {
    const home = healthy('ccrc-doctor-fleet-unreachable-');
    stubHealthUnreachable(home);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/did not answer/);
    expect(line).toContain('7');                 // curl's own exit code, named
    expect(line).not.toMatch(/skewed|divergent/);
    expect(r.code).toBe(0);
  });

  it('warns on an HTTP error, and says which one', () => {
    // A 500 is not a disagreement and not an unreachable box: the server is
    // there and answering, and something inside it is broken.
    const home = healthy('ccrc-doctor-fleet-500-');
    stubHealth(home, '', 500);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('500');
    expect(line).not.toMatch(/did not answer/);  // that is the unreachable sentence
    expect(r.code).toBe(0);
  });

  it('warns when the answer is not the health JSON at all', () => {
    // The measured shape of a reverse proxy or a captive portal answering 200
    // with an HTML page.
    const home = healthy('ccrc-doctor-fleet-notjson-');
    stubHealth(home, '<html>hello</html>');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/not the health JSON/);
    expect(r.code).toBe(0);
  });

  it('never echoes the body back — an unrecognised answer is CLASSIFIED, not quoted', () => {
    // doctor's output is what an operator pastes into a ticket, and the body
    // comes off a network. A canary in the answer must not reach the terminal.
    const home = healthy('ccrc-doctor-fleet-canary-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'ccrc-canary-6f21b', roster: 'agreed' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: /);
    expect(r.stdout).not.toContain('ccrc-canary-6f21b');
    expect(r.stderr).not.toContain('ccrc-canary-6f21b');
  });

  it('does not read a value that merely STRINGIFIES to a token as that token', () => {
    // `["agreed"]` renders as exactly "agreed". The classifier compares VALUES
    // against the vocabulary rather than their renderings, so this is an answer
    // the check does not recognise — and emphatically not an agreement.
    // Measured: without that strictness the whole body is passed through as a
    // string and this box reports PASS on an answer nobody wrote.
    const home = healthy('ccrc-doctor-fleet-stringy-');
    stubHealth(home, { mode: 'remote', connected: true, build: ['agreed'], roster: 'agreed' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/does not recognise/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
  });

  it('warns, rather than passing, when the server says the fleet host is not connected', () => {
    // `agreed` computed over a dead link describes the last contact, not now.
    // Passing on it would report a fact nobody currently measures.
    const home = healthy('ccrc-doctor-fleet-down-');
    stubHealth(home, { mode: 'remote', connected: false, downSince: 1_755_000_000_000, build: 'agreed', roster: 'agreed' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/is not currently connected/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
    expect(r.code).toBe(0);
  });

  // AN ANSWER THIS CHECK DID NOT UNDERSTAND MUST NOT BECOME A CLAIM THAT THE
  // OPPOSITE IS TRUE. `connected` is required on the wire (shared/api.ts:1484),
  // so each of these is a malformed answer — and each used to PASS with the
  // words "in remote mode, connected", which is the strongest claim this check
  // can make, made about the one field the answer did not state. The
  // classifier has always emitted `?` here; the verdict was narrowing it.
  it.each([
    ['absent', { mode: 'remote', build: 'agreed', roster: 'agreed' }],
    ['a non-boolean word', { mode: 'remote', connected: 'yes', build: 'agreed', roster: 'agreed' }],
    ['null', { mode: 'remote', connected: null, build: 'agreed', roster: 'agreed' }],
    ['the STRING "false"', { mode: 'remote', connected: 'false', build: 'agreed', roster: 'agreed' }],
  ] as const)('warns when `connected` is %s — it must never pass as "connected"', (_what, body) => {
    const home = healthy(`ccrc-doctor-fleet-conn-${_what.replace(/\W+/g, '-')}-`);
    stubHealth(home, body as Health);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/did not say whether it is in contact/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
    // …and specifically not the OTHER link sentence: "the fleet host is down"
    // and "this answer did not say" are two different things to go and look at.
    expect(line).not.toMatch(/is not currently connected/);
    expect(r.code).toBe(0);
  });

  it('warns when the server does not say which mode it is in', () => {
    const home = healthy('ccrc-doctor-fleet-nomode-');
    stubHealth(home, { connected: true, build: 'agreed', roster: 'agreed' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: .*mode/);
    expect(r.code).toBe(0);
  });

  it('SKIPS in local mode — one box cannot disagree with itself', () => {
    // Not a PASS. Nothing was compared, and a run that reported agreement it
    // never measured is the overloaded-null defect this codebase bans. The
    // check prints its SKIP line and no verdict; the summary counts it as
    // skipped, so the number of verdicts really is the number of measurements.
    const home = healthy('ccrc-doctor-fleet-local-');
    stubHealth(home, { mode: 'local', connected: true, build: 'unknown', roster: 'unknown' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*local mode/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) fleet: /m);
    expect(r.stdout).toMatch(/^summary: \d+ checks \(1 skipped\)/m);
    expect(r.code).toBe(0);
  });

  it('SKIPS when this box has no server address at all, and says how to give it one', () => {
    // The measured state of the FLEET host: it has ~/.ccrc/agent.env and no
    // ccrc.env, so it does not know where the server is. That is not a fault
    // and not an agreement — it is a check that could not run.
    const home = healthy('ccrc-doctor-fleet-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: this box has no server address/m);
    expect(r.stdout).toMatch(/CCRC_ADDR/);
    expect(curlCalls(home)).toEqual([]);          // nothing was asked
    expect(r.code).toBe(0);
  });

  it('SKIPS a half-configured address rather than inventing the missing half', () => {
    // The port's default lives in server/src/config.ts. Copying it here would
    // be one value declared twice in two languages — and guessing it wrong
    // would produce a confident answer about a box nobody asked.
    const home = healthy('ccrc-doctor-fleet-halfaddr-');
    writeCcrcEnv(home, 'CCRC_HOST=ccrc-fixture.invalid\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*CCRC_PORT/m);
    expect(curlCalls(home)).toEqual([]);
    expect(r.code).toBe(0);
  });

  it('SKIPS an address that is not an address, and never echoes it back', () => {
    const home = healthy('ccrc-doctor-fleet-badaddr-');
    writeCcrcEnv(home, 'CCRC_HOST=not a host\nCCRC_PORT=99999999\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: /m);
    expect(r.stdout).not.toContain('99999999');
    expect(curlCalls(home)).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a ccrc.env it cannot READ is its own answer, not "none configured"', () => {
      // A mode fix and "this box was never given a server address" are two
      // different things to do about it — and without the guard the read fails,
      // bash's own error lands on stderr, and every key comes back empty, which
      // is indistinguishable from a file that declares nothing.
      const home = healthy('ccrc-doctor-fleet-envunreadable-');
      chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^SKIP fleet: .*cannot be read/m);
      expect(r.stdout).not.toMatch(/no server address/);
      expect(r.stderr).toBe('');
    });

  it('a ccrc.env that is not a regular file is its own answer too', () => {
    const home = healthy('ccrc-doctor-fleet-envdir-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    mkdirSync(join(home, '.ccrc', 'ccrc.env'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/no server address/);
  });

  it('takes CCRC_ADDR ahead of the config file — notify.sh\'s own seam', () => {
    const home = healthy('ccrc-doctor-fleet-envaddr-');
    const r = runDoctor(home, ['doctor'], { CCRC_ADDR: 'other.invalid:9999' });
    expect(curlCalls(home).join('\n')).toContain('http://other.invalid:9999/api/fleet/health');
    expect(curlCalls(home).join('\n')).not.toContain(FIXTURE_ADDR);
    expect(lineFor(r.stdout, 'fleet')).toContain('other.invalid:9999');
  });

  it('reads ONLY the two keys it needs out of ccrc.env — the file also holds tokens', () => {
    // `~/.ccrc/ccrc.env` carries CCRC_VAPID_PRIVATE, CCRC_AGENT_TOKEN and a
    // Hetzner token. The reader takes two keys by name and must never print,
    // export or log another line of it.
    const home = healthy('ccrc-doctor-fleet-envsecrets-');
    writeCcrcEnv(home, [
      '# comment',
      'CCRC_AGENT_TOKEN=ccrc-canary-token-9a13c',
      'CCRC_HOST=ccrc-fixture.invalid',
      'CCRC_VAPID_PRIVATE=ccrc-canary-vapid-4b7e2',
      'CCRC_PORT=7788',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^PASS fleet: /);
    expect(r.stdout).not.toContain('ccrc-canary-token-9a13c');
    expect(r.stdout).not.toContain('ccrc-canary-vapid-4b7e2');
    expect(r.stderr).not.toContain('ccrc-canary-token-9a13c');
    expect(r.stderr).not.toContain('ccrc-canary-vapid-4b7e2');
    // …and nothing from that file may leak into the child's environment either.
    expect(curlCalls(home).join('\n')).not.toContain('ccrc-canary');
  });

  it('reads an INDENTED key, which is what its own config file\'s parser accepts', () => {
    // systemd's `EnvironmentFile=` skips leading whitespace, and ccrc.env's
    // only real consumer is systemd. A reader stricter than the parser it
    // claims to copy answers "no address" for a file that configures the box
    // perfectly well — a safe failure, but the wrong answer.
    const home = healthy('ccrc-doctor-fleet-indented-');
    writeCcrcEnv(home, '  CCRC_HOST=ccrc-fixture.invalid\n\tCCRC_PORT=7788\n');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^PASS fleet: /);
    expect(curlCalls(home).join('\n')).toContain(`http://${FIXTURE_ADDR}/api/fleet/health`);
  });

  it('and does NOT read a key systemd would REFUSE — the parity runs in one direction only', () => {
    // The other side of the test above, and the reason the reader trims a
    // named three-character set rather than `[[:space:]]`. POSIX's space class
    // also contains vertical tab and form feed; systemd's whitespace is space,
    // tab, CR (and the newline that ends the line). So `\vCCRC_HOST=…` is a
    // line systemd does NOT turn into an environment variable — and a reader
    // that skips the \v anyway would answer with an address the box is not
    // actually configured with, then probe it and report on a fleet nobody
    // asked about.
    //
    // That direction is the one that matters: the reader is a deliberate
    // SUBSET of systemd's parser, and its own comment justifies the subset by
    // the failure being one-directional (a form it misses yields no address,
    // which SKIPS with a detail). A form it reads that systemd does not
    // breaks exactly that argument.
    const home = healthy('ccrc-doctor-fleet-vtab-');
    writeCcrcEnv(home, '\vCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    const r = runDoctor(home);
    // `lineFor` finds a VERDICT line; this check answers with a SKIP, which is
    // deliberately not one (see the runner's fourth-outcome contract).
    expect(r.stdout).toMatch(/^SKIP fleet: .*declares CCRC_PORT but no CCRC_HOST/m);
    expect(r.stdout, 'an address systemd never set was reported as one').not.toContain('ccrc-fixture.invalid');
    expect(curlCalls(home), 'an address systemd never set was probed anyway').toEqual([]);
  });

  it('bounds the request, and the bound is overridable the way verify-service.sh\'s are', () => {
    // A route that hangs must not hang doctor. The knob exists so a test need
    // not wait out a production timeout — `deploy/verify-service.sh`'s
    // `CCRC_VERIFY_*` model, and `CCRC_DOCTOR_GH_TIMEOUT`'s own precedent.
    const home = healthy('ccrc-doctor-fleet-timeout-');
    runDoctor(home, ['doctor'], { CCRC_HEALTH_TIMEOUT: '3' });
    expect(curlCalls(home).join('\n')).toMatch(/--max-time 3\b/);
  });

  it('warns when curl is not on PATH — the check could not run, and says so', () => {
    const home = healthy('ccrc-doctor-fleet-nocurl-');
    unstub(home, 'curl');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: curl is not on PATH/);
    expect(r.code).toBe(0);
  });

  it('says node is missing in its own words rather than blaming the server', () => {
    // A check must not fail for a reason that belongs to another check.
    const home = healthy('ccrc-doctor-fleet-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: node is not on PATH/);
  });

  it('the three-state vocabulary is the one shared/api.ts declares', () => {
    // The bash check cannot import the TypeScript union, so it carries the
    // tokens as literals — and this is the mechanism that stops the copy
    // drifting, the same text-scan discipline single-definition.test.ts uses.
    const api = readFileSync(join(REPO, 'shared', 'api.ts'), 'utf8');
    const build = /export type BuildAgreement = ([^;]+);/.exec(api)?.[1] ?? '';
    const roster = /roster\?: ([^;]+);/.exec(api)?.[1] ?? '';
    const tokens = (s: string): string[] => (s.match(/'([a-z]+)'/g) ?? []).map((t) => t.slice(1, -1));
    const wanted = [...new Set([...tokens(build), ...tokens(roster)])];
    expect(wanted.sort()).toEqual(['agreed', 'divergent', 'skewed', 'unknown']);
    const checks = readFileSync(CCRC_SRC, 'utf8');
    for (const t of wanted) expect(checks, `ccrc does not know the token "${t}"`).toContain(`"${t}"`);
  });
});

// ── ccrc status ───────────────────────────────────────────────────────────
// Read-only, one fact per line, exit 0. It answers the question doctor cannot:
// not "is this box fit to work" but "what IS this box, and does it agree with
// the other one". Everything it prints is measured here and nothing is judged —
// a skewed fleet is doctor's FAIL, and status's plain line of fact.

describe('ccrc status', () => {
  /** `healthy()` plus what status (and only status) reads: a real `jq` for the
   *  build stamp, a systemctl to ask about the two units, and a registry. */
  function statusBox(prefix: string): string {
    const home = healthy(prefix);
    unstub(home, 'jq');                 // healthy()'s jq is a presence stub
    linkReal(home, 'jq');               // …and the stamp reader needs a real one
    stubSystemctl(home);
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    writeSessions(home, 3);
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    return home;
  }

  it('prints this box\'s build stamp and the fleet answer, one fact per line', () => {
    const home = statusBox('ccrc-status-ok-');
    const r = runDoctor(home, ['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/build: +abc123 \(main\)/);
    expect(r.stdout).toMatch(/fleet: +agreed/);
    expect(r.stderr).toBe('');
  });

  it('prints the two services\' state and a session count', () => {
    const home = statusBox('ccrc-status-services-');
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/services: +.*ccrc\.service inactive/);
    expect(out).toMatch(/ccrc-agent\.service active/);
    expect(out).toMatch(/sessions: +3\b/);
  });

  // ── the role, and the word "inferred" that has to travel with it ────────
  // Nothing on a box records its own role (D-73). The two unit states are the
  // only evidence there is, so status reports the inference and SAYS it is one
  // — a flat `role: fleet host` would be this tool asserting a fact no box ever
  // declared, on evidence that is one `systemctl stop` away from changing.
  it.each([
    ['fleet host', { ccrc: 'inactive', agent: 'active' }],
    ['server', { ccrc: 'active', agent: 'inactive' }],
    ['server AND fleet host', { ccrc: 'active', agent: 'active' }],
    ['neither', { ccrc: 'inactive', agent: 'inactive' }],
  ] as const)('infers "%s" from the units, and says that it inferred it', (role, units) => {
    const home = statusBox(`ccrc-status-role-${role.replace(/\W+/g, '-')}-`);
    for (const [u, state] of [['ccrc.service', units.ccrc], ['ccrc-agent.service', units.agent]] as const) {
      writeFileSync(join(home, `fixture-unit-${u}`), `${state}\n`);
    }
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line).toContain(role);
    expect(line).toMatch(/inferred|not declared/);
  });

  it('says the role is unknown, not "neither", when the units could not be asked at all', () => {
    // "I could not tell" and "no unit is running" are two different answers,
    // and inferring the second from no evidence is the thing this line exists
    // not to do.
    const home = statusBox('ccrc-status-role-nosystemctl-');
    unstub(home, 'systemctl');
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line).toMatch(/unknown/);
    expect(line).not.toMatch(/neither/);
    expect(out).toMatch(/services: +.*ccrc\.service unknown/);
  });

  it('says unknown, not "neither", when only ONE unit could be asked — end to end', () => {
    // The defect the sourced table below isolates, reached the way an operator
    // reaches it: an EMPTY answer from `systemctl is-active` for one unit
    // (which the fixture systemctl produces from an empty fixture file, and a
    // real one produces on a bus it cannot reach) and a plain `inactive` for
    // the other. Partial evidence used to fall straight through to "no ccrc
    // unit is active here".
    const home = statusBox('ccrc-status-role-halfasked-');
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), '\n');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'inactive\n');
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line, 'a role inferred from a unit nobody could ask').not.toMatch(/neither/);
    expect(line).toMatch(/unknown/);
    expect(out).toMatch(/services: +.*ccrc\.service unknown/);
  });

  // ── _box_role, every combination of what the two units can say ───────────
  // Called DIRECTLY, by sourcing `ccrc` and setting `BOX_UNITS` — the file
  // carries a source guard for exactly this, and it is the only way to reach
  // all nine states without nine fixtures. The e2e cases above prove the
  // function is wired to a real measurement; this proves what it does with it.
  //
  // THE RULE: no answer may state something no unit was asked about. "unknown"
  // is a state a unit really reaches (no systemctl, no bus, an empty answer),
  // and it is NOT "inactive" — the same distinction this whole file keeps
  // between a check that failed and a check that could not run.
  describe('_box_role never asserts a state it did not measure', () => {
    const roleFor = (ccrc: string, agent: string): string => {
      const r = spawnSync(BASH, ['-c',
        `source "${CCRC_SRC}"; BOX_UNITS=(${ccrc} ${agent}); _box_role; echo`],
        { encoding: 'utf8', env: { ...process.env, HOME: join(REPO, 'no-such-home-for-box-role') } });
      expect(r.status, `_box_role exited ${r.status}\n${r.stderr}`).toBe(0);
      expect(r.stderr).toBe('');
      return r.stdout.trim();
    };

    it.each([
      ['active', 'active', 'server AND fleet host'],
      ['active', 'inactive', 'server'],
      ['inactive', 'active', 'fleet host'],
      ['inactive', 'inactive', 'neither'],
    ] as const)('(%s, %s) — both units answered, so the inference is stated: %s', (c, a, want) => {
      const line = roleFor(c, a);
      expect(line).toContain(want);
      expect(line, 'the word that makes it an inference rather than a fact').toMatch(/inferred|not declared/);
    });

    it('(active, inactive) is "server" and not the single-box answer', () => {
      expect(roleFor('active', 'inactive')).not.toContain('fleet host');
    });

    it.each([
      ['unknown', 'inactive', 'ccrc.service'],
      ['inactive', 'unknown', 'ccrc-agent.service'],
      ['unknown', 'unknown', 'ccrc.service'],
    ] as const)('(%s, %s) is UNKNOWN — one unmeasured unit is enough to withhold "neither"', (c, a, names) => {
      // The verified defect: the `elif` that answers "unknown" required BOTH
      // units to be unknown, so a box where one unit could not be asked and
      // the other was merely inactive fell into the `else` and was told "no
      // ccrc unit is active here" — a negative claim about a unit nobody
      // asked. Same class as the `connected` bug fixed one commit earlier:
      // asserting a state that was never measured.
      const line = roleFor(c, a);
      expect(line, 'partial evidence still produced a confident "neither"').not.toContain('neither');
      expect(line).toContain('unknown');
      expect(line, 'the unmeasured unit is not named, so nobody can tell which one to check')
        .toContain(names);
    });

    it.each([
      ['active', 'unknown', 'ccrc-agent.service'],
      ['unknown', 'active', 'ccrc.service'],
    ] as const)('(%s, %s) names the active unit AND says the other was never asked', (c, a, unasked) => {
      // The same rule pointing the other way. One unit is measurably active,
      // so the box IS at least that role — but "server" alone silently answers
      // the question "is it also a fleet host?", which nobody measured. The
      // single-box case (both active) is a real and different answer.
      const line = roleFor(c, a);
      expect(line).toContain(c === 'active' ? 'server' : 'fleet host');
      expect(line, 'the unasked unit is not named').toContain(unasked);
      expect(line).toMatch(/could not be asked|not measured/);
      expect(line, 'a half-measured box must not be reported as the single-box install')
        .not.toContain('a single-box install');
    });
  });

  it('counts the sessions the registry really holds, not a constant', () => {
    const home = statusBox('ccrc-status-sessions-');
    writeSessions(home, 7);
    expect(runDoctor(home, ['status']).stdout).toMatch(/sessions: +7\b/);
  });

  it('reads the stamp through version\'s own reader — one reader, two renderings', () => {
    // The pin against a second parser growing here: a dirty stamp is a fact
    // `version` already knows how to see, and status must see the same one.
    const home = statusBox('ccrc-status-dirty-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'deadbee', ref: 'feat/x', builtAt: '2026-08-15T01:00:00Z', dirty: true }));
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/build: +deadbee \(feat\/x\)/);
    expect(out).toMatch(/dirty/i);
    expect(runDoctor(home, ['version']).stdout).toMatch(/dirty/);
  });

  it('says "unstamped" rather than inventing a build when there is no stamp', () => {
    const home = statusBox('ccrc-status-unstamped-');
    rmSync(join(home, '.ccrc', 'build.json'), { force: true });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/build: +unstamped/);
    expect(r.code).toBe(0);
  });

  it('reports a fleet it could not measure as NOT MEASURED, never as agreement', () => {
    const home = statusBox('ccrc-status-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +not measured/);
    expect(r.stdout).not.toMatch(/fleet: +agreed/);
    expect(r.code).toBe(0);
  });

  it('reports a skewed fleet as the fact it is, and still exits 0 — status judges nothing', () => {
    const home = statusBox('ccrc-status-skewed-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +disagreed/);
    expect(r.stdout).toMatch(/build skewed/);
    expect(r.code).toBe(0);
    // …and doctor, on the same box, does not shrug at it.
    expect(runDoctor(home, ['doctor']).code).toBe(1);
  });

  it('will not say "agreed" over a link the server says is DOWN', () => {
    // Both halves agree, and the server is not in contact with the fleet host:
    // the answers describe the last contact. `agreed` is the strongest claim
    // this verb makes and it is not available here.
    const home = statusBox('ccrc-status-down-');
    stubHealth(home, { mode: 'remote', connected: false, build: 'agreed', roster: 'agreed' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/fleet: +stale/);
    expect(out).not.toMatch(/fleet: +agreed/);
    expect(out).toMatch(/NOT currently in contact/);
  });

  it('will not say "agreed" beside a `connected` it could not read either', () => {
    // The status half of the same defect: the line used to read
    // `fleet: agreed` directly under `mode: remote (fleet host connected: ?)`,
    // so the verb contradicted itself two lines apart.
    const home = statusBox('ccrc-status-conn-unknown-');
    stubHealth(home, { mode: 'remote', connected: 'yes', build: 'agreed', roster: 'agreed' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/connected: \?/);
    expect(out).toMatch(/fleet: +stale/);
    expect(out).not.toMatch(/fleet: +agreed/);
    expect(out).toMatch(/did not say whether it is in contact/);
  });

  it('says so when the server is in local mode, rather than reporting agreement', () => {
    const home = statusBox('ccrc-status-local-');
    stubHealth(home, { mode: 'local', connected: true, build: 'unknown', roster: 'unknown' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/fleet: +not measured/);
    expect(out).toMatch(/local mode/);
  });

  it('never asks anything but the health route, and asks it once', () => {
    const home = statusBox('ccrc-status-readonly-');
    runDoctor(home, ['status']);
    const calls = curlCalls(home);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/api/fleet/health');
    // Read-only in the strongest sense available here: no method flag at all,
    // which is a GET, and no request body.
    expect(calls[0]).not.toMatch(/-X|--request|--data|-d\b/);
  });

  it('refuses an argument, exit 2, like every other verb', () => {
    const home = statusBox('ccrc-status-args-');
    const r = runDoctor(home, ['status', '--all']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --all/m);
  });

  it('names units that really exist in deploy/, not two plausible strings', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const units = [...src.matchAll(/\b(ccrc(?:-agent)?\.service)\b/g)].map((m) => m[1]);
    expect(new Set(units)).toEqual(new Set(['ccrc.service', 'ccrc-agent.service']));
    for (const u of new Set(units)) expect(existsSync(join(REPO, 'deploy', u!)), u).toBe(true);
  });
});

// ── the wrapper-shape library's own contract ──────────────────────────────

describe('ccrc doctor: ccrc-wrapper-shape', () => {
  it('_wrap_set_diff does not shadow its caller\'s locals inside the callback', () => {
    // The callback runs INSIDE _wrap_set_diff's scope — that is the whole
    // mechanism, and it is why every local in there is `_wrap_*`-prefixed. A
    // bare `local x y found` (which is what it shipped with) handed the
    // callback the loop's own `x` in place of the caller's, silently, for
    // exactly as long as nobody happened to name a variable `x`.
    const script = [
      'set -uo pipefail',
      `. ${shq(LIB_SRC)}`,
      'note() { printf "%s saw x=%s y=%s found=%s\\n" "$2" "$x" "$y" "$found"; }',
      'outer() {',
      '  local x=OUTER-X y=OUTER-Y found=OUTER-FOUND',
      '  local -a mine=(only-in-a) theirs=()',
      '  _wrap_set_diff note mine theirs',
      '}',
      'outer',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('only-in-a saw x=OUTER-X y=OUTER-Y found=OUTER-FOUND');
  });
});

// ── the output contract ───────────────────────────────────────────────────

describe('ccrc doctor: the output contract', () => {
  it('names a remedy for EVERY failing check — a check with no remedy is a complaint', () => {
    // Asserted per FAIL line, not once over the whole output: a single stray
    // "remedy:" anywhere would satisfy the weaker form while nine checks
    // shipped without one.
    const lines = runDoctor(broken('ccrc-doctor-remedy-')).stdout.split('\n');
    const fails = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('FAIL'));
    expect(fails.length, 'the broken fixture must actually fail something').toBeGreaterThan(0);
    for (const [line, i] of fails)
      expect(lines[i + 1], `no remedy after: ${line}`).toMatch(/^ {2}remedy: \S/);
  });

  it('names a remedy after a WARN too', () => {
    const home = healthy('ccrc-doctor-remedy-warn-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN '));
    expect(i, 'this fixture must produce a WARN').toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('every line is exactly PASS|WARN|FAIL|SKIP <name>: <detail>', () => {
    // SKIP is in the alternation and NOT in the verdict count: a check that did
    // not run has not answered, and counting it as an answer is the whole
    // defect the skip exists to avoid. Both fixtures are walked, because the
    // healthy box has no skip and the address-less one has exactly one.
    const home = healthy('ccrc-doctor-shape-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const skipBox = healthy('ccrc-doctor-shape-skip-');
    rmSync(join(skipBox, '.ccrc', 'ccrc.env'), { force: true });
    for (const [h, wantSkips] of [[home, 0], [skipBox, 1]] as const) {
      let verdicts = 0; let skips = 0;
      for (const l of runDoctor(h).stdout.split('\n')) {
        if (!l || l.startsWith('  remedy: ') || l.startsWith('summary: ')) continue;
        expect(l).toMatch(/^(PASS|WARN|FAIL|SKIP) [a-z0-9_]+: \S/);
        if (l.startsWith('SKIP ')) skips++; else verdicts++;
      }
      // Without this the loop above is a scan over an empty list, which passes
      // everything — the exact vacuity this suite's red run exhibited.
      expect(skips).toBe(wantSkips);
      expect(verdicts).toBe(tableNames().length - wantSkips);
    }
  });

  it('exits 1 when any check fails and 0 when every check passes or warns', () => {
    expect(runDoctor(broken('ccrc-doctor-exit-bad-')).code).toBe(1);
    expect(runDoctor(healthy('ccrc-doctor-exit-ok-')).code).toBe(0);
  });

  it('prints a summary count LAST, and it adds up to the table', () => {
    const home = healthy('ccrc-doctor-summary-');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n').filter(Boolean);
    const last = lines[lines.length - 1] ?? '';
    const m = /^summary: (\d+) checks \((\d+) skipped\), (\d+) verdicts — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, skipped, verdicts, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(pass + warn + fail).toBe(verdicts);
    // On a HEALTHY box every check answers exactly once, so the two nouns
    // agree — which is what makes the two-class run's disagreement meaningful.
    expect(verdicts).toBe(total);
    expect(skipped).toBe(0);
    expect(fail).toBe(0);
    expect(warn).toBe(0);
  });

  it('a healthy box says nothing on stderr — the verdicts are the RESULT, on stdout', () => {
    const home = healthy('ccrc-doctor-stderr-');
    const r = runDoctor(home);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('refuses an argument, exit 2, like every other verb', () => {
    const home = healthy('ccrc-doctor-args-');
    const r = runDoctor(home, ['doctor', '--all']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --all/m);
  });

  it('a table entry with no _check_ function FAILS loudly and blames ccrc, not the box', () => {
    // The table and its implementations are two files' worth of one thing; if
    // they drift, the entry must not be silently skipped — a skipped check is
    // a check that reports nothing and lets the summary claim a clean box.
    const home = healthy('ccrc-doctor-orphan-entry-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=(ghost)\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL ghost: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/no _check_ghost function exists/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('one check that DIES mid-run does not take the rest of the table with it', () => {
    // `set -u` (which ccrc runs under, and must) makes an unbound variable
    // FATAL to the shell it happens in — not a `return 1`. Called directly,
    // one such check ended the whole run: no summary, and every later check
    // silently unmeasured, which is exactly what doctor exists not to do. Each
    // check therefore runs in a subshell.
    const home = healthy('ccrc-doctor-fatal-check-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha boom omega)',
      '_check_alpha() { printf "PASS alpha: measured\\n"; }',
      '_check_boom()  { printf "%s\\n" "$CCRC_NOT_SET_ANYWHERE"; }',
      '_check_omega() { printf "PASS omega: measured\\n"; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    expect(r.stdout).toMatch(/^PASS alpha: measured$/m);
    // The explosion is reported as a bug in ccrc, with a remedy, in the dead
    // check's own name — not as a missing line.
    const i = lines.findIndex((l) => l.startsWith('FAIL boom: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/printed no verdict line of its own/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    // The run CONTINUED past it, and still added up.
    expect(r.stdout).toMatch(/^PASS omega: measured$/m);
    expect(r.stdout).toMatch(/^summary: 3 checks \(0 skipped\), 3 verdicts — 2 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
    // bash's own diagnosis is not swallowed — stderr is deliberately not captured.
    expect(r.stderr).toMatch(/unbound variable/);
  });

  it('a check that answers with an illegal status is a bug, not a fifth outcome', () => {
    const home = healthy('ccrc-doctor-bad-status-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(weird)\n'
      + '_check_weird() { printf "PASS weird: printed a verdict, then lied\\n"; return 4; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL weird: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 4, which is not one of 0 \(pass\), 1 \(fail\), 2 \(warn\) or 3 \(skipped\)/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  // ── the FOURTH outcome: a check that did not run ────────────────────────
  // A check with nothing to measure (`fleet` on a box with no server to ask)
  // must not report a PASS it never earned, and must not report a WARN either —
  // there is nothing wrong. It prints ONE `SKIP <name>: <detail>` line, no
  // verdict line, and exits 3; the runner counts it against CHECKS and not
  // against verdicts, so the summary's two nouns stay honest.
  it('counts a SKIP as a check that did not answer, never as one that passed', () => {
    const home = healthy('ccrc-doctor-skip-count-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha nothing)',
      '_check_alpha()   { printf "PASS alpha: measured\\n"; }',
      '_check_nothing() { printf "SKIP nothing: there was nothing here to measure\\n"; return 3; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP nothing: there was nothing here to measure$/m);
    expect(r.stdout).toMatch(/^summary: 2 checks \(1 skipped\), 1 verdicts — 1 passed, 0 warned, 0 failed$/m);
    expect(r.code).toBe(0);
  });

  it('a check that exits 3 while printing a VERDICT is a bug, not a skip', () => {
    // The two halves of the skip are cross-checked against each other, exactly
    // as the return code and the verdict lines already are: "I did not run" and
    // "here is my answer" cannot both be true.
    const home = healthy('ccrc-doctor-skip-and-verdict-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(liar)\n'
      + '_check_liar() { printf "PASS liar: measured\\n"; return 3; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL liar: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/a skipped check prints exactly one SKIP line/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('a SKIP line with a return code that is not 3 is a bug too', () => {
    // The other direction. Without this, a check could print SKIP and exit 0,
    // and the summary would count a measurement nobody made.
    const home = healthy('ccrc-doctor-skip-rc0-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(sneak)\n'
      + '_check_sneak() { printf "SKIP sneak: nothing to do\\n"; return 0; }\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL sneak: .*a skipped check prints exactly one SKIP line/m);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a check that exits 3 and prints NOTHING is a bug — a skip owes a reason', () => {
    // An invisible skip is a check that vanished from the run. The detail is
    // the whole difference between "this box has no server to ask" and a
    // silence the operator has to reverse-engineer from a count.
    const home = healthy('ccrc-doctor-skip-silent-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(mute)\n'
      + '_check_mute() { return 3; }\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL mute: /m);
    expect(r.code).toBe(1);
  });

  it('counts a check that answers in TWO classes in both, and reports both lines', () => {
    // The runner half of the wrappers split: a check with findings of two
    // classes prints a line each and returns the WORSE. The tally is over
    // verdict lines, so the summary shows both — and, deliberately, more
    // verdicts than checks.
    const home = healthy('ccrc-doctor-two-class-count-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(dual)',
      '_check_dual() {',
      '  printf "FAIL dual: a real defect\\n  remedy: fix it\\n"',
      '  printf "WARN dual: something deliberate\\n  remedy: or leave it\\n"',
      '  return 1',
      '}',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL dual: a real defect$/m);
    expect(r.stdout).toMatch(/^WARN dual: something deliberate$/m);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 2 verdicts — 0 passed, 1 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a verdict line for ANOTHER check does not count as this one answering', () => {
    // The tally matches `PASS <name>: `, with the name bound — not a bare
    // `PASS `. A check that prints somebody else's verdict has not answered
    // for itself, and counting it as though it had is how a check that was
    // never wired up rides in on its neighbour's line. All three classes,
    // because the matcher has three arms and loosening any one of them was
    // green before this test.
    const home = healthy('ccrc-doctor-wrong-name-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha beta gamma)',
      '_check_alpha() { printf "PASS other: not my name\\n"; return 0; }',
      '_check_beta()  { printf "WARN other: not my name\\n  remedy: x\\n"; return 2; }',
      '_check_gamma() { printf "FAIL other: not my name\\n  remedy: x\\n"; return 1; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    for (const n of ['alpha', 'beta', 'gamma'])
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL ${n}: the check printed no verdict line of its own`, 'm'));
    expect(r.stdout).toMatch(/^summary: 3 checks \(0 skipped\), 3 verdicts — 0 passed, 0 warned, 3 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a return code that disagrees with the verdict lines is a bug, not an answer', () => {
    // Counting the LINES moved the tally off the return code; this is what
    // keeps the code from becoming decoration. A check that returns 1 while
    // printing only a WARN would otherwise have made doctor exit 0 — silently
    // downgrading a failure to a warning.
    const home = healthy('ccrc-doctor-rc-mismatch-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(liar)\n'
      + '_check_liar() { printf "WARN liar: measured\\n  remedy: do something\\n"; return 1; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL liar: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 1, but the worst verdict line it printed is a WARN, which is 2/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('refuses an EMPTY check table rather than reporting a box nobody measured', () => {
    const home = healthy('ccrc-doctor-empty-table-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=()\n');
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table is empty/m);
  });

  it('refuses a check table file that declares no table at all', () => {
    const home = healthy('ccrc-doctor-no-table-');
    writeChecks(home, '# nothing here\n');
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table declares no CCRC_DOCTOR_CHECKS/m);
  });

  it('refuses to run at all when its check table is missing, rather than passing vacuously', () => {
    // A doctor that finds no checks and exits 0 is the worst possible failure
    // mode: it reports a healthy box by measuring nothing.
    const home = healthy('ccrc-doctor-nochecks-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'), { force: true });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table is missing/m);
  });
});
