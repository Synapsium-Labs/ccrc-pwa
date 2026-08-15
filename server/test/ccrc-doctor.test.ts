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
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv, ghPoisonAt } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');

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

/** `git config user.email` answers from `<home>/fixture-git-email`; with the
 *  file absent it exits 1 and prints nothing, exactly as real git does for an
 *  unset key. Every other argv is a silent success — doctor asks git nothing
 *  else, and the `case` below is what would notice if that changed. */
function stubGit(home: string): void {
  stub(home, 'git',
    'case "$*" in\n'
    + "  *'config user.email'*)\n"
    + '    if [ -f "$HOME/fixture-git-email" ]; then IFS= read -r v < "$HOME/fixture-git-email"; echo "$v"; exit 0; fi\n'
    + '    exit 1 ;;\n'
    + 'esac\n'
    + 'exit 0');
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

function runDoctor(home: string, args: string[] = ['doctor']): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args], { env: doctorEnv(home), encoding: 'utf8' });
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

  it('names the address when it is set', () => {
    const home = healthy('ccrc-doctor-gitemail-ok-');
    expect(lineFor(runDoctor(home).stdout, 'git_email')).toContain('ops@example.invalid');
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

  it('every verdict line is exactly PASS|WARN|FAIL <name>: <detail>', () => {
    const home = healthy('ccrc-doctor-shape-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    let verdicts = 0;
    for (const l of runDoctor(home).stdout.split('\n')) {
      if (!l || l.startsWith('  remedy: ') || l.startsWith('summary: ')) continue;
      expect(l).toMatch(/^(PASS|WARN|FAIL) [a-z0-9_]+: \S/);
      verdicts++;
    }
    // Without this the loop above is a scan over an empty list, which passes
    // everything — the exact vacuity this suite's red run exhibited.
    expect(verdicts).toBe(tableNames().length);
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
    const m = /^summary: (\d+) checks — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(pass + warn + fail).toBe(total);
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

  it('a check that answers with an illegal status is a bug, not a fourth verdict', () => {
    const home = healthy('ccrc-doctor-bad-status-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=(weird)\n_check_weird() { return 3; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL weird: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 3, which is not one of 0 \(pass\), 1 \(fail\) or 2 \(warn\)/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
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
