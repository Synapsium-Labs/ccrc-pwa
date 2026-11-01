// `install.sh` (repo root) — the stage-2 BOOTSTRAP, not the converger. It
// exists only to get a bare checkout to the point where `ccrc install` (the
// verb `ccrc-install-*.test.ts` measures) can run: refuse a too-old or absent
// `node`, build the three artifacts `ccrc install` itself refuses without
// (`server/dist`, `server/dist-pwa`, `server/node_modules` is implied by the
// build), then hand off. This file measures ONLY the bootstrap's own logic —
// the floor read/compare and the two early exits — not the handoff itself,
// which is `ccrc-install-*.test.ts`'s "install.sh hands off to it" describe
// (it needs the full fixture TREE these three tests do not).
//
// ── WHY THE FLOOR IS NEVER HARDCODED HERE ─────────────────────────────────
// `node-floor.test.ts` pins `server/package.json`'s `engines.node` as the one
// declaration; a literal `'22.13.0'` in this file would be a second copy that
// silently stops matching the day the floor is raised. Every assertion below
// reads it fresh, at test time, off the real `server/package.json` — the same
// file install.sh itself reads.
//
// ── HOW THE "NODE REPORTS A LOW VERSION" FIXTURE WORKS ────────────────────
// install.sh never calls `node --version`; it embeds the current version as
// `process.versions.node` inside a `node -e` script and compares it to the
// floor in the SAME script. Faking "below floor" therefore cannot be a
// `--version` stub (there is nothing to intercept) — it has to make the REAL
// interpreter report a fake `process.versions.node`, which is a writable
// (non-configurable-false) own property: `Object.defineProperty` on it inside
// a `--require`d shim, loaded before the pinned `-e` script runs, changes what
// that script reads without changing one byte of install.sh. The other `-e`
// call (reading `engines.node` off the fixture's own `package.json`) is left
// alone — it must answer with the REAL floor, or the test would not be
// measuring "current < floor" at all.
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, existsSync, chmodSync, readFileSync, copyFileSync, symlinkSync,
  appendFileSync, readdirSync, rmSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { itLinux } from './platformFixtures.js';
import { ccdFunctionDefinition } from '../../shared/hook-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const INSTALL_SH = join(REPO, 'install.sh');

const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

/** bash's absolute path, resolved once, for the same reason every other file
 *  in this suite resolves it: the child gets a PATH with no system directory
 *  on it, so a bare `bash` lookup would be ENOENT. */
const BASH = realPath('bash');
const REAL_NODE = realPath('node');

/** The floor `install.sh` itself will read, straight off the real
 *  `server/package.json` — never retyped. */
const REAL_FLOOR_RANGE = (
  JSON.parse(readFileSync(join(REPO, 'server', 'package.json'), 'utf8')) as { engines: { node: string } }
).engines.node;
/** The form install.sh's own comparison script prints: `>=` stripped. */
const REAL_FLOOR = REAL_FLOOR_RANGE.replace(/^>=/, '').trim();

interface Result { code: number; stdout: string; stderr: string }

/** `<home>/checkout/install.sh` — a copy, not a symlink, so a fixture that
 *  wants to see it refuse never has to touch the checked-in script. Sibling
 *  `server/package.json` is the ONE file install.sh reads before deciding
 *  anything; nothing else in the tree is needed for these three tests,
 *  because all three refuse before install.sh would look at `pwa/` or
 *  `ccd/`. */
function fixtureRoot(home: string, engines: string): string {
  const root = join(home, 'checkout');
  mkdirSync(join(root, 'server'), { recursive: true });
  copyFileSync(INSTALL_SH, join(root, 'install.sh'));
  chmodSync(join(root, 'install.sh'), 0o755);
  writeFileSync(join(root, 'server', 'package.json'),
    JSON.stringify({ name: 'ccrc-server', engines: { node: engines } }));
  return root;
}

/** A PATH with nothing but what a test explicitly plants — no system
 *  directory reachable, so "node is absent" means what it says rather than
 *  falling through to whatever this box happens to have. */
function fixtureBin(home: string): string {
  const d = join(home, 'bin');
  mkdirSync(d, { recursive: true });
  return d;
}

/** Records every invocation; a test asserts on its ABSENCE to prove "no npm
 *  ran before the refusal" (the file never gets created at all), which is a
 *  stronger claim than "npm's argv log is empty". */
function plantNpmRecorder(home: string): void {
  writeFileSync(join(fixtureBin(home), 'npm'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/npm-argv"\nexit 0\n', { mode: 0o755 });
}

/** A `node` whose `-e` scripts run for real EXCEPT the version-comparison one
 *  (install.sh's second `node -e`, matched on the `process.versions.node`
 *  substring it alone contains): that one is run under a `--require`d shim
 *  that overrides `process.versions.node` to `fakeVersion` first. The
 *  floor-reading `-e` (matched on `engines.node`, which only it contains) is
 *  passed straight to the real interpreter, so the floor it reports is the
 *  REAL one from the fixture's `package.json` — the thing under test is the
 *  COMPARISON, not the read. */
function plantLowNode(home: string, fakeVersion: string): void {
  const bin = fixtureBin(home);
  const shim = join(home, 'fake-node-version.cjs');
  writeFileSync(shim,
    `Object.defineProperty(process.versions, 'node', `
    + `{ value: ${JSON.stringify(fakeVersion)}, writable: true, configurable: true });\n`);
  writeFileSync(join(bin, 'node'), [
    '#!/bin/sh',
    `REAL=${JSON.stringify(REAL_NODE)}`,
    `SHIM=${JSON.stringify(shim)}`,
    'case "$2" in',
    '  *engines.node*) exec "$REAL" "$@" ;;',
    '  *process.versions.node*) exec "$REAL" --require "$SHIM" "$@" ;;',
    'esac',
    'exec "$REAL" "$@"',
  ].join('\n'), { mode: 0o755 });
}

/** `opts.bareFromRoot` invokes as `bash install.sh …` with `cwd: root` and a
 *  BARE script name — no leading path at all — rather than the absolute path
 *  every other call here uses. That is the one invocation shape install.sh's
 *  own slash guard (the line right after `set -euo pipefail`, testing `$HERE`
 *  against a glob of "any slash at all") exists for: with no slash in
 *  `$HERE`, stripping everything from the last slash onward leaves it
 *  UNCHANGED, and `cd "install.sh"` (a file, not a directory) dies
 *  immediately — before the argument loop, before node, before anything. It
 *  is also the README's own first command: `cd ccrc && bash install.sh`. */
function runInstallSh(root: string, args: string[], home: string, pathDir: string,
  opts: { bareFromRoot?: boolean; env?: NodeJS.ProcessEnv } = {}): Result {
  const env = { ...opts.env, HOME: home, PATH: pathDir };
  const r = opts.bareFromRoot
    ? spawnSync(BASH, ['install.sh', ...args], { cwd: root, env, encoding: 'utf8' })
    : spawnSync(BASH, [join(root, 'install.sh'), ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('install.sh: the node floor, before anything is built', () => {
  it('refuses when node reports a version below the floor, naming both, and runs no npm', () => {
    const home = mkTmp('install-sh-lowfloor-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantNpmRecorder(home);
    plantLowNode(home, '1.0.0');
    const r = runInstallSh(root, [], home, fixtureBin(home));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      new RegExp(`^install\\.sh: node 1\\.0\\.0 is below the required ${REAL_FLOOR.replace(/\./g, '\\.')}$`, 'm'));
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });

  it('refuses when node is not installed, with the install remedy', () => {
    const home = mkTmp('install-sh-nonode-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantNpmRecorder(home);
    // No `node` planted at all — `fixtureBin` holds only the npm recorder,
    // and PATH reaches nothing else.
    const r = runInstallSh(root, [], home, fixtureBin(home));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^install\.sh: node is not installed — install Node \(nodesource or nvm\), then re-run$/m);
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });

  it('-h/--help prints usage and exits 0 before touching node or npm', () => {
    const home = mkTmp('install-sh-help-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    // No node, no npm at all on this PATH — proof that neither the floor
    // check nor a build step ran: an empty bin directory is the strongest
    // "nothing else runs" a PATH can express.
    const emptyBin = fixtureBin(home);
    for (const flag of ['-h', '--help']) {
      const r = runInstallSh(root, [flag], home, emptyBin);
      expect(r.code, `${flag}: exit code`).toBe(0);
      expect(r.stdout, `${flag}: stdout`).toBe(
        "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)\n");
      expect(r.stderr, `${flag}: stderr`).toBe('');
    }
  });

  // D-98 (fix round 1, Important 1). The brief's own pinned snippet only
  // recognised `-h`/`--help`; anything else fell straight through to the
  // build and a full `ccrc install` ran — the exact defect `cmd_install`'s
  // own comment names one layer down (`ccd/ccrc:1724-1729`): "an install
  // that half-ran because argument 2 was a typo is worse than one that did
  // not start". `install.sh` is now the OUTERMOST entry point.
  it('refuses an argument it does not recognise, before anything runs', () => {
    const home = mkTmp('install-sh-badarg-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantNpmRecorder(home);
    // Empty bin but for the npm recorder — no node either, so a run that got
    // past the argument check would die at the node probe instead, which
    // would still be wrong (exit 1, not 2) and is itself part of what this
    // test rules out.
    const r = runInstallSh(root, ['--dry-run'], home, fixtureBin(home));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^install\.sh: unknown argument: --dry-run$/m);
    expect(r.stderr).toContain(
      "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)");
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });

  // Fix round 1, Important 2. Every other test in this file invokes by
  // absolute path, which never exercises the `*/*` guard at all — deleting
  // it left every existing test green while the README's own first command
  // (`cd ccrc && bash install.sh`) died at `cd: install.sh: Not a directory`
  // before the argument loop or the node probe ever ran.
  it('resolves ROOT when invoked as a bare relative path from inside its own directory', () => {
    const home = mkTmp('install-sh-barecwd-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    const r = runInstallSh(root, ['--help'], home, fixtureBin(home), { bareFromRoot: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)\n");
  });

  // Fix round 1, Minor 1. Nothing above proves the floor came from THIS
  // fixture's `server/package.json` rather than a copy — a hardcoded
  // `'22.13.0'` would clear every real interpreter and pass silently. A
  // floor no real node can ever satisfy, read from the fixture's own file,
  // is the only way to pin "read", not "retyped".
  it('refuses against an absurd floor from the FIXTURE package.json, with a REAL node', () => {
    const home = mkTmp('install-sh-fakefloor-');
    const root = fixtureRoot(home, '>=99.0.0');
    plantNpmRecorder(home);
    const bin = fixtureBin(home);
    symlinkSync(REAL_NODE, join(bin, 'node'));
    const r = runInstallSh(root, [], home, bin);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^install\.sh: node [0-9.]+ is below the required 99\.0\.0$/m);
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });
});

// ── Release mode (stage 4, spec §3) ──────────────────────────────────────
// `install.sh --release [vX.Y.Z]` downloads SHA256SUMS + the tarball it
// names from GitHub Releases (latest, or the named tag's download path),
// verifies `sha256sum -c`, extracts to a `mktemp -d` staging dir, and execs
// the STAGED `ccd/ccrc install` — no build on the box, prebuilt dists ship
// in the tarball. `CCRC_RELEASE_BASE_URL` is the deliberate test seam: it
// replaces only the `https://github.com/<owner>/<repo>/releases` prefix, so
// a stub `curl` mapping `local://<path>` to a file copy serves a fixture
// release directory laid out exactly like GitHub's URL space
// (`latest/download/<asset>`, `download/<tag>/<asset>`). The checkout-mode
// tests above stay byte-identical — release mode is a branch taken before
// the node probe, not a rewrite of it.
describe('install.sh: it builds every artifact the staged verb refuses without (D-1159)', () => {
  it('every package `ccrc install` preflights is a package install.sh builds', () => {
    // THE CROSS-FILE INVARIANT, DERIVED FROM BOTH FILES rather than restated in
    // this one. `ccrc install` refuses to place a tree that is missing a built
    // artifact; `install.sh` exists to produce exactly those. The two lists were
    // kept in step by nothing at all, and they fell out of step: the agent
    // preflight did not exist, install.sh did not build `agent/`, and
    // `ccrc install --role fleet` on a source checkout therefore placed the tree
    // and restarted a LIVE fleet's agent onto a directory with no entry point —
    // MODULE_NOT_FOUND, and the server lost its only path to the box.
    //
    // Scanning both sides means a preflight added tomorrow without a build (or a
    // build removed from under a preflight) reddens here rather than on a fleet.
    const preflighted = [...new Set(
      [...readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8')
        .matchAll(/\[ -f "\$src\/([a-z][a-z-]*)\/dist[^"]*" \]/g)].map((m) => m[1]!),
    )];
    expect(preflighted, 'the preflight scan went vacuous — this guard would pass on nothing')
      .toEqual(expect.arrayContaining(['server', 'agent']));

    const built = [...new Set(
      [...readFileSync(join(REPO, 'install.sh'), 'utf8')
        .matchAll(/\(\s*cd "\$ROOT\/([a-z][a-z-]*)"[^)]*npm run build/g)].map((m) => m[1]!),
    )];
    expect(built, 'the build scan went vacuous — this guard would pass on nothing')
      .toEqual(expect.arrayContaining(['server', 'pwa', 'agent']));

    for (const pkg of preflighted) {
      expect(built,
        `ccrc install refuses a tree without ${pkg}/dist, so install.sh must build ${pkg}/`)
        .toContain(pkg);
    }
    // KNOWN LIMIT, stated rather than hidden: `server/dist-pwa` is preflighted
    // under `server/` but BUILT in `pwa/`, so the path alone cannot name its
    // builder. `pwa` is asserted directly above for that reason; the loop covers
    // every package whose preflight path and build directory do agree.
  });
});

describe('install.sh --release: fetch, verify, hand off to the staged ccrc', () => {
  const REAL_TAR = realPath('tar');
  const REAL_GZIP = realPath('gzip');
  // PLATFORM-CHOSEN AT DESCRIBE SCOPE, and the choice is what lets this file
  // COLLECT on a Darwin box at all: `realPath('sha256sum')` here used to
  // throw on a host with no coreutils — erroring the whole file at
  // collection time, including the two BSD-userland tests that exist to pin
  // the macOS digest fix (found by this branch's own adversarial review).
  const IS_DARWIN_HOST = process.platform === 'darwin';
  const REAL_DIGEST = IS_DARWIN_HOST ? realPath('shasum') : realPath('sha256sum');
  const REAL_MKTEMP = realPath('mktemp');
  const REAL_MKDIR = realPath('mkdir');
  const REAL_CP = realPath('cp');

  /** Fixture bin for release runs: the real extract/verify chain, a stub
   *  curl that serves `local://` URLs from disk (and records every URL it
   *  was asked for), and NO node/npm at all — release mode must never need
   *  a compiler or the floor probe; if it reaches for one, ENOENT reds the
   *  test. */
  function plantReleaseTools(home: string): string {
    const bin = fixtureBin(home);
    symlinkSync(BASH, join(bin, 'bash'));
    symlinkSync(REAL_TAR, join(bin, 'tar'));
    symlinkSync(REAL_GZIP, join(bin, 'gzip'));
    // The fixture models the HOST's own userland truthfully: a GNU host gets
    // `sha256sum` (and no `uname`, so install.sh's chooser takes the GNU
    // arm); a Darwin host gets `uname` + the real `shasum`, so install.sh's
    // Darwin arm runs natively — never a sha256sum symlink whose target the
    // box does not have.
    if (IS_DARWIN_HOST) {
      writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Darwin\n', { mode: 0o755 });
      writeFileSync(join(bin, 'shasum'), `#!/bin/sh\nexec ${REAL_DIGEST} "$@"\n`, { mode: 0o755 });
    } else {
      symlinkSync(REAL_DIGEST, join(bin, 'sha256sum'));
    }
    symlinkSync(REAL_MKTEMP, join(bin, 'mktemp'));
    symlinkSync(REAL_MKDIR, join(bin, 'mkdir'));
    symlinkSync(REAL_CP, join(bin, 'cp'));
    writeFileSync(join(bin, 'curl'), [
      '#!/bin/sh',
      '# stub curl: local://<path> is a file on disk; missing = curl\'s own 404.',
      '# `curl-argv` records the URL alone, `curl-full` the whole argv, one line per call.',
      'printf \'%s\\n\' "$*" >> "$HOME/curl-full"',
      'dest=""; url=""',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -o) dest="$2"; shift 2 ;;',
      '    --connect-timeout|--speed-limit|--speed-time|--max-time|--max-filesize) shift 2 ;;',
      '    -*) shift ;;',
      '    *) url="$1"; shift ;;',
      '  esac',
      'done',
      'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
      '# a userinfo before the path is dropped, as a real transfer would not use it as a file name',
      'src="${url#local://}"',
      'case "$src" in /*) ;; *) src="/${src#*@}" ;; esac',
      'if [ ! -f "$src" ]; then',
      '  echo "curl: (22) The requested URL returned error: 404" >&2',
      '  exit 22',
      'fi',
      'cp "$src" "$dest"',
    ].join('\n'), { mode: 0o755 });
    return bin;
  }

  /** A fixture release under `<home>/releases`, laid out like GitHub's URL
   *  space. The payload's `ccd/ccrc` is a RECORDING stub (argv0 + argv to
   *  `$HOME/ccrc-argv`) — the handoff assertion — and `MARKER` rides along
   *  so "extracted" and "not extracted" are both observable facts. SHA256SUMS
   *  is computed from the REAL tarball bytes; `tamper` appends to the
   *  tarball AFTERWARD, so the sums file is honest and the bytes are not. */
  function fixtureRelease(home: string, opts: {
    tag?: string; tamper?: boolean; releases?: string; omitTarball?: boolean;
  } = {}): void {
    const payload = join(home, 'payload');
    mkdirSync(join(payload, 'ccd'), { recursive: true });
    writeFileSync(join(payload, 'ccd', 'ccrc'),
      '#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$HOME/ccrc-argv"\n'
      + 'printf \'%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" > "$HOME/ccrc-env"\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(payload, 'MARKER'), 'release payload\n');
    const releases = opts.releases ?? join(home, 'releases');
    const relDir = opts.tag
      ? join(releases, 'download', opts.tag)
      : join(releases, 'latest', 'download');
    mkdirSync(relDir, { recursive: true });
    const name = `ccrc-${opts.tag ?? 'v9.9.9'}.tar.gz`;
    const tarRes = spawnSync('tar', ['-czf', join(relDir, name), '-C', payload, '.'], { encoding: 'utf8' });
    if (tarRes.status !== 0) throw new Error(`fixture tar failed: ${tarRes.stderr}`);
    // Host-PATH call, so the digest tool is platform-chosen — a bare
    // `sha256sum` here fails on a Darwin host before install.sh ever runs.
    // Both spellings write the identical "<digest>  <name>" line.
    const sumRes = spawnSync('bash', ['-c',
      'sha=sha256sum; [ "$(uname -s)" = Darwin ] && sha="shasum -a 256";'
      + ` $sha '${name}' > SHA256SUMS`],
    { cwd: relDir, encoding: 'utf8' });
    if (sumRes.status !== 0) throw new Error(`fixture digest failed: ${sumRes.stderr}`);
    if (opts.tamper) appendFileSync(join(relDir, name), 'one appended byte-run after the sums were written');
    if (opts.omitTarball) rmSync(join(relDir, name));
  }

  /** TMPDIR is pointed INSIDE the fixture home so the `mktemp -d` staging
   *  dir — whose path the test cannot predict — is still inside a tree the
   *  test can search, making "nothing extracted" a positive assertion. */
  function runRelease(root: string, args: string[], home: string, extraEnv: NodeJS.ProcessEnv = {}): Result {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = {
      CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
      ...extraEnv,
      HOME: home,
      PATH: fixtureBin(home),
      TMPDIR: join(home, 'tmp'),
    };
    // A bound: a release run that cannot end (an unbounded fetch of a host that never stops) reds, never hangs.
    const r = spawnSync(BASH, [join(root, 'install.sh'), ...args], { env, encoding: 'utf8', timeout: 30_000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  const filesUnder = (dir: string): string[] => (existsSync(dir)
    ? (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    : []);

  it('latest: fetches, verifies, and execs the STAGED ccrc install, passing extra args through', () => {
    const home = mkTmp('install-sh-release-latest-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const r = runRelease(root, ['--release', '--role', 'fleet'], home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    // Trust-on-first-use, said out loud (design 2026-09-20 §5): there is no
    // installed verifier yet, and the one in the tarball must not verify
    // itself. Every update from here is verified by the tree this run placed.
    expect(r.stdout).toMatch(/^install\.sh: first install trusts the release's transport checksum only; every update from here verifies provenance$/m);
    // The handoff: argv0 is the staged ccrc, inside OUR TMPDIR (the staging
    // tree), and the verb + passthrough args arrive verbatim.
    const argv = readFileSync(join(home, 'ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv.slice(1)).toEqual(['install', '--role', 'fleet']);
    expect(argv[0]).toMatch(/\/ccd\/ccrc$/);
    expect(argv[0].startsWith(join(home, 'tmp')), `staged ccrc ran from ${argv[0]}, not the staging tree`).toBe(true);
    // The tree it ran from is OUR payload, fully extracted.
    expect(existsSync(join(path.dirname(argv[0]), '..', 'MARKER'))).toBe(true);
    // Both fetches went to the latest/download URL space.
    const urls = readFileSync(join(home, 'curl-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(urls).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v9.9.9.tar.gz`,
    ]);
  });

  it('--release vX.Y.Z: fetches the named tag\'s download URLs', () => {
    const home = mkTmp('install-sh-release-tag-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home, { tag: 'v1.2.3' });
    const r = runRelease(root, ['--release', 'v1.2.3'], home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const argv = readFileSync(join(home, 'ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv.slice(1)).toEqual(['install']);
    const urls = readFileSync(join(home, 'curl-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(urls).toEqual([
      `local://${home}/releases/download/v1.2.3/SHA256SUMS`,
      `local://${home}/releases/download/v1.2.3/ccrc-v1.2.3.tar.gz`,
    ]);
  });

  it('checksum mismatch: refuses loudly, extracts NOTHING, runs NO install', () => {
    const home = mkTmp('install-sh-release-tamper-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home, { tamper: true });
    const r = runRelease(root, ['--release'], home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(existsSync(join(home, 'ccrc-argv')), 'the staged ccrc ran despite a bad checksum').toBe(false);
    // Nothing extracted: the staging dir under TMPDIR holds downloads at
    // most — never the payload's files.
    const staged = filesUnder(join(home, 'tmp'));
    expect(staged.some((f) => f.endsWith('MARKER')), `payload extracted: ${staged.join(', ')}`).toBe(false);
    expect(staged.some((f) => f.endsWith('ccd/ccrc'))).toBe(false);
  });

  // Branch review, 2026-08-21 (minor): every refusal used to leave the mktemp
  // staging dir — downloads included, possibly TAMPERED bytes — behind in
  // TMPDIR. The EXIT trap now removes it on refusal and is disarmed only for
  // the exec handoff. `rm` is linked real here because the trap tolerates a
  // PATH without it (`|| :` — a failed cleanup must never override the
  // refusal's own exit code), so only a harness WITH rm can observe the
  // cleanup itself. Mutation: deleting the trap leaves the tarball behind —
  // this test red.
  it('a refused release leaves NOTHING in TMPDIR — the staging dir is removed by the trap', () => {
    const home = mkTmp('install-sh-release-cleanup-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    const bin = plantReleaseTools(home);
    symlinkSync(realPath('rm'), join(bin, 'rm'));
    fixtureRelease(home, { tamper: true });
    const r = runRelease(root, ['--release'], home);
    expect(r.code).toBe(1);
    expect(filesUnder(join(home, 'tmp'))).toEqual([]);
  });

  /** The fixture PATH as a BSD userland sees it: `sha256sum` GONE (macOS
   *  ships none), `uname` answering Darwin, and a `shasum` that accepts only
   *  the `-a 256` spelling and delegates the digest math to the real GNU
   *  binary by absolute path — so the verification is REAL and a tampered
   *  fixture still fails it. */
  function bsdUserland(home: string): void {
    const bin = fixtureBin(home);
    // Present only when plantReleaseTools ran on a GNU host; a Darwin host
    // never planted one (force tolerates both).
    rmSync(join(bin, 'sha256sum'), { force: true });
    writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Darwin\n', { mode: 0o755 });
    // Validates the exact `-a 256` spelling install.sh must use, then
    // delegates the digest math to the host's real tool — GNU sha256sum
    // (argv minus the two shasum flags) or Darwin's real shasum (argv
    // intact) — so verification stays REAL on either host.
    writeFileSync(join(bin, 'shasum'), [
      '#!/bin/sh',
      '[ "$1" = "-a" ] && [ "$2" = "256" ] || { echo "fixture shasum: unexpected argv: $*" >&2; exit 90; }',
      ...(IS_DARWIN_HOST ? [`exec ${REAL_DIGEST} "$@"`] : ['shift 2', `exec ${REAL_DIGEST} "$@"`]),
    ].join('\n') + '\n', { mode: 0o755 });
  }

  it('a BSD userland (shasum, no sha256sum) verifies an intact release and installs it — not a fabricated tamper alarm', () => {
    // THE BUG THIS PINS: the check was `sha256sum -c` with stderr swallowed,
    // so on a box with no sha256sum the subshell exited 127 into the `||`
    // arm — the first thing a macOS operator ever saw from ccrc was
    // "checksum verification FAILED" about an intact download. Live, not
    // latent: v0.0.1 is published, so `--release` resolves. Mutation:
    // reverting install.sh's digest chooser to bare `sha256sum` reds this.
    const home = mkTmp('install-sh-release-bsd-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    bsdUserland(home);
    fixtureRelease(home);
    const r = runRelease(root, ['--release'], home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stderr).not.toMatch(/checksum verification FAILED/);
    const argv = readFileSync(join(home, 'ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv.slice(1)).toEqual(['install']);
  });

  it('a BSD userland still FAILS a tampered release — shasum -a 256 -c reads the GNU-written SHA256SUMS unchanged', () => {
    // The other half of interoperability: the Darwin arm must keep the
    // integrity check REAL, not merely quiet. Same tamper fixture as the
    // GNU-side test above.
    const home = mkTmp('install-sh-release-bsd-tamper-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    bsdUserland(home);
    fixtureRelease(home, { tamper: true });
    const r = runRelease(root, ['--release'], home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(existsSync(join(home, 'ccrc-argv')), 'the staged ccrc ran despite a bad checksum').toBe(false);
  });

  it('absent release: answers with curl\'s own failure, extracts nothing, runs nothing', () => {
    const home = mkTmp('install-sh-release-absent-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    // No fixtureRelease at all — the URL space is empty.
    const r = runRelease(root, ['--release'], home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/curl: \(22\)/);
    expect(r.stderr).toMatch(/^install\.sh: download failed: /m);
    expect(existsSync(join(home, 'ccrc-argv'))).toBe(false);
    const staged = filesUnder(join(home, 'tmp'));
    expect(staged.some((f) => f.endsWith('MARKER'))).toBe(false);
  });

  // W1 minor M6. `_inst_installed` decides the marker's line 2 from
  // CCRC_UPDATE_VERIFIED and nothing else, so an export left in an operator's
  // shell (or a CI job's) around a first install would record a
  // trust-on-first-use tree as VERIFIED. install.sh unsets it before BOTH
  // hand-offs; what the staged verb SEES is the measurement, because that
  // one variable is the whole of what the marker reads.
  it('an ambient CCRC_UPDATE_VERIFIED=1 never reaches the staged verb — a first install is recorded unsigned (M6; §18 "--allow-unsigned is recorded")', () => {
    const home = mkTmp('install-sh-release-verified-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const r = runRelease(root, ['--release'], home, { CCRC_UPDATE_VERIFIED: '1' });
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(readFileSync(join(home, 'ccrc-env'), 'utf8')).toBe('unset\n');
  });

  // ── R48 (W33-a): the release-host defences `ccrc update` already has ──────
  const readLog = (home: string, name: string): string[] => (existsSync(join(home, name))
    ? readFileSync(join(home, name), 'utf8').split('\n').filter((l) => l !== '')
    : []);
  const HEX64 = '0'.repeat(64);
  const sumsLine = (name: string): string => `${HEX64}  ${name}\n`;
  /** A release URL space holding ONLY a SHA256SUMS (the refusal rows never get as far as a tarball). */
  const plantSumsOnly = (home: string, body: string): void => {
    const dir = join(home, 'releases', 'latest', 'download');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SHA256SUMS'), body, 'utf8');
  };
  /** Every line install.sh printed, on both streams. */
  const allLines = (r: Result): string[] => [...r.stdout.split('\n'), ...r.stderr.split('\n')];
  /** The REAL curl behind a recording wrapper, for the rows the stub cannot measure (globbing, the size bound, the
   *  speed floor). The wrapper logs the whole argv to `curl-full`, then execs the real binary by absolute path. */
  function plantRealCurl(home: string): void {
    writeFileSync(join(fixtureBin(home), 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/curl-full"\nexec ${realPath('curl')} "$@"\n`, { mode: 0o755 });
  }

  it('both release curls carry -g, the connect bound and the speed floor; only SHA256SUMS carries the total and size bounds', () => {
    const home = mkTmp('install-sh-release-flags-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const r = runRelease(root, ['--release'], home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const calls = readLog(home, 'curl-full');
    expect(calls).toHaveLength(2);
    const [sums, tarball] = calls as [string, string];
    for (const c of [sums, tarball]) {
      expect(c, c).toMatch(/(^| )-g( |$)/);
      expect(c, c).toMatch(/ --connect-timeout 10 /);
      expect(c, c).toMatch(/ --speed-limit 1024 /);
      expect(c, c).toMatch(/ --speed-time 30 /);
    }
    expect(sums).toMatch(/ --max-time 20 /);
    expect(sums).toMatch(/ --max-filesize 4096 /);
    expect(sums).toMatch(/SHA256SUMS$/);
    // The tarball is a stall-bounded fetch, never a total-bounded one: a slow but LIVE download must finish.
    expect(tarball).not.toMatch(/--max-time/);
    expect(tarball).not.toMatch(/--max-filesize/);
    expect(tarball).toMatch(/\.tar\.gz$/);
  });

  it('the five knobs are read from their environment names and reach the curls', () => {
    const home = mkTmp('install-sh-release-knobs-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const r = runRelease(root, ['--release'], home, {
      CCRC_RELEASE_CONNECT_TIMEOUT: '7', CCRC_RELEASE_SPEED_LIMIT: '2000', CCRC_RELEASE_SPEED_TIME: '9',
      CCRC_RELEASE_SUMS_MAX_TIME: '11', CCRC_RELEASE_SUMS_MAX_FILESIZE: '512',
    });
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const [sums, tarball] = readLog(home, 'curl-full') as [string, string];
    expect(sums).toMatch(/ --connect-timeout 7 .* --speed-limit 2000 --speed-time 9 /);
    expect(sums).toMatch(/ --max-time 11 --max-filesize 512 /);
    expect(tarball).toMatch(/ --connect-timeout 7 --speed-limit 2000 --speed-time 9 /);
  });

  // ── the tarball name, before the second curl ──────────────────────────────
  // A name the release host supplies reaches `curl -o` before any checksum is checked. Each refusal names the RULE
  // broken, never the raw name (it may carry a terminal escape), and the second curl never runs.
  const longName = (n: number): string => `ccrc-${'a'.repeat(n - 'ccrc-.tar.gz'.length)}.tar.gz`;
  const refusedNames: ReadonlyArray<{ label: string; name: string; rule: RegExp; raw: string }> = [
    { label: 'a path traversal', name: 'ccrc-../x.tar.gz', rule: /path separator/, raw: 'x.tar.gz' },
    { label: 'a path separator', name: 'ccrc-a/b.tar.gz', rule: /path separator/, raw: 'a/b' },
    { label: 'a ".." with no separator', name: 'ccrc-v1..2.tar.gz', rule: /"\.\."/, raw: 'v1..2' },
    { label: 'an ESC byte', name: 'ccrc-\u001b[31mx.tar.gz', rule: /not printable ASCII/, raw: '\u001b' },
    { label: 'a non-ASCII byte', name: 'ccrc-é.tar.gz', rule: /not printable ASCII/, raw: 'é' },
    { label: 'a 129-byte name', name: longName(129), rule: /129 bytes, over the 128-byte limit/, raw: 'aaaaaaaaaa' },
    { label: 'a name that is no ccrc tarball', name: 'evil.tar.gz', rule: /is no ccrc tarball/, raw: 'evil' },
  ];
  for (const row of refusedNames) {
    it(`SHA256SUMS naming ${row.label} is refused before the second fetch, the rule named and the raw name never printed`, () => {
      const home = mkTmp('install-sh-release-name-');
      const root = fixtureRoot(home, REAL_FLOOR_RANGE);
      plantReleaseTools(home);
      plantSumsOnly(home, sumsLine(row.name));
      const r = runRelease(root, ['--release'], home);
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(row.rule);
      expect(r.stderr).toMatch(/refusing/);
      // Only SHA256SUMS was fetched: the name never reached `curl -o`.
      expect(readLog(home, 'curl-argv').map((u) => u.replace(/^.*\//, ''))).toEqual(['SHA256SUMS']);
      expect(r.stdout + r.stderr, 'the raw name was printed').not.toContain(row.raw);
      // No tarball path was written anywhere under the fixture home but the planted release itself.
      const written = filesUnder(home).filter((f) => /tar\.gz$/.test(f) && !f.startsWith('releases'));
      expect(written, `a tarball path was written: ${written.join(', ')}`).toEqual([]);
    });
  }

  it('the printable-ASCII rule is counted in bytes under LC_ALL=C even when the caller\'s locale is UTF-8', () => {
    // In a UTF-8 locale an accented letter IS printable; the rule must not follow the caller's locale.
    const home = mkTmp('install-sh-release-name-utf8-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    plantSumsOnly(home, sumsLine('ccrc-\u00e9.tar.gz'));
    const r = runRelease(root, ['--release'], home, { LC_ALL: 'C.UTF-8' });
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/not printable ASCII/);
    expect(readLog(home, 'curl-argv')).toHaveLength(1);
  });

  it('a 128-byte tarball name is within the rule and installs', () => {
    const home = mkTmp('install-sh-release-name128-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const dir = join(home, 'releases', 'latest', 'download');
    const name = longName(128);
    expect(name).toHaveLength(128);
    copyFileSync(join(dir, 'ccrc-v9.9.9.tar.gz'), join(dir, name));
    const sum = spawnSync('bash', ['-c',
      'sha=sha256sum; [ "$(uname -s)" = Darwin ] && sha="shasum -a 256";'
      + ` $sha '${name}' > SHA256SUMS`], { cwd: dir, encoding: 'utf8' });
    expect(sum.status, sum.stderr).toBe(0);
    const r = runRelease(root, ['--release'], home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(readLog(home, 'curl-argv')).toHaveLength(2);
  });

  it('the sha256sum binary-mode marker ("*name") is stripped before the rules run', () => {
    // `sha256sum -b` writes `<digest> *<name>`. The marker is the line format's, not part of the name, so the
    // rules (and the length count) run on the stripped name — the strip stays where it always was.
    const home = mkTmp('install-sh-release-star-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const f = join(home, 'releases', 'latest', 'download', 'SHA256SUMS');
    writeFileSync(f, readFileSync(f, 'utf8').replace('  ccrc-', ' *ccrc-'));
    const r = runRelease(root, ['--release'], home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  // ── the base URL's userinfo is never printed ──────────────────────────────
  // Redaction here is the updater's: it masks a URL's userinfo (and the home directory). A query or a fragment is
  // NOT masked, by the operator's ruling, so no row asks it.
  const userinfoBase = (home: string): { CCRC_RELEASE_BASE_URL: string } =>
    ({ CCRC_RELEASE_BASE_URL: `local://user:pass@${home}/releases` });

  it('a base URL carrying user:pass@ prints it nowhere on a good run (both "fetching" lines)', () => {
    const home = mkTmp('install-sh-release-userinfo-ok-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home);
    const r = runRelease(root, ['--release'], home, userinfoBase(home));
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(allLines(r).filter((l) => /fetching/.test(l))).toHaveLength(2);
    expect(allLines(r).filter((l) => /pass/.test(l)), 'a line carries the password').toEqual([]);
  });

  it('... and in the SHA256SUMS "download failed" line', () => {
    const home = mkTmp('install-sh-release-userinfo-sums-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    const r = runRelease(root, ['--release'], home, userinfoBase(home));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/download failed: .*SHA256SUMS/);
    expect(allLines(r).filter((l) => /pass/.test(l)), 'a line carries the password').toEqual([]);
  });

  it('... and in the tarball "download failed" line', () => {
    const home = mkTmp('install-sh-release-userinfo-tar-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    fixtureRelease(home, { omitTarball: true });
    const r = runRelease(root, ['--release'], home, userinfoBase(home));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/download failed: .*\.tar\.gz/);
    expect(allLines(r).filter((l) => /pass/.test(l)), 'a line carries the password').toEqual([]);
  });

  // ── a base path containing "[1]" is fetched literally (-g) ────────────────
  // Without `-g` curl expands `[1]` to `1` before it parses the URL and looks in the wrong directory.
  it('a base path containing [1] is fetched literally — the REAL curl, globbing off on both fetches', () => {
    const home = mkTmp('install-sh-release-glob-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    plantRealCurl(home);
    const releases = join(home, 'rel[1]');
    fixtureRelease(home, { releases });
    const r = runRelease(root, ['--release'], home, { CCRC_RELEASE_BASE_URL: `file://${releases}` });
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(readLog(home, 'curl-full')).toHaveLength(2);
    expect(existsSync(join(home, 'ccrc-argv')), 'the staged ccrc did not run').toBe(true);
  });

  // ── the bounds, measured against a REAL host ──────────────────────────────
  // THE HOST IS A SEPARATE PROCESS: `spawnSync` blocks this process's event loop, so an in-process server would
  // accept the connection in the kernel and never write a byte (the pattern of ccrc-update-fetch.test.ts).
  const HOST_JS = [
    "const http = require('node:http'); const fs = require('node:fs');",
    "const [mode, n, log] = [process.argv[1], Number(process.argv[2]), process.argv[3]];",
    "const line = '0'.repeat(64) + '  ccrc-v9.9.9.tar.gz';",
    "const trickle = (res) => { res.writeHead(200); res.write('x');",
    "  const iv = setInterval(() => { try { res.write('x'); } catch (e) {} }, 100);",
    "  res.on('close', () => clearInterval(iv)); };",
    "const s = http.createServer((req, res) => {",
    "  fs.appendFileSync(log, req.url + '\\n');",
    "  if (req.url.endsWith('/SHA256SUMS')) {",
    "    if (mode === 'slow-sums') return trickle(res);",
    "    const body = mode === 'sums-size' ? line + ' '.repeat(n - line.length - 1) + '\\n' : line + '\\n';",
    "    res.writeHead(200, { 'Content-Length': Buffer.byteLength(body) }); return res.end(body);",
    "  }",
    "  if (mode === 'slow-tar') return trickle(res);",
    "  res.writeHead(404); res.end();",
    "});",
    "s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port) + '\\n'));",
    "process.on('SIGTERM', () => process.exit(0));",
  ].join('\n');
  const startHost = async (mode: string, n: number, log: string): Promise<{ port: number; stop: () => Promise<void> }> => {
    const child = spawn(process.execPath, ['-e', HOST_JS, mode, String(n), log], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
    const port = await new Promise<number>((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const m = /^(\d+)\n/.exec(out);
        if (m) { clearInterval(iv); resolve(Number(m[1])); }
        else if (Date.now() - t0 > 10_000) {
          clearInterval(iv); child.kill('SIGKILL'); reject(new Error('the fixture host never listened'));
        }
      }, 20);
    });
    return {
      port,
      stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; },
    };
  };
  /** Run install.sh against a loopback host with the REAL curl; returns what it did and how long it took. */
  const runAgainstHost = async (mode: string, n: number, env: NodeJS.ProcessEnv, userinfo = ''): Promise<{
    r: Result; ms: number; requests: string[]; home: string;
  }> => {
    const home = mkTmp('install-sh-release-host-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    plantReleaseTools(home);
    plantRealCurl(home);
    const log = join(home, 'host-requests');
    const host = await startHost(mode, n, log);
    try {
      const t0 = Date.now();
      const r = runRelease(root, ['--release'], home, {
        CCRC_RELEASE_BASE_URL: `http://${userinfo}127.0.0.1:${host.port}/rel`, CCRC_RELEASE_CONNECT_TIMEOUT: '2', ...env,
      });
      return { r, ms: Date.now() - t0, requests: readLog(home, 'host-requests'), home };
    } finally {
      await host.stop();
    }
  };

  itLinux('a 4097-byte SHA256SUMS is refused at the size bound; one of exactly 4096 bytes is not', async () => {
    const big = await runAgainstHost('sums-size', 4097, {});
    expect(big.r.code, big.r.stderr).toBe(1);
    expect(big.r.stderr).toMatch(/download failed: .*\/SHA256SUMS/);
    expect(big.requests, 'the size bound did not stop the run before the tarball fetch').toEqual(['/rel/latest/download/SHA256SUMS']);
    // The control: the same host at the bound goes on to ask for the tarball (which this host does not have), so the
    // refusal above is the size bound and nothing else.
    const ok = await runAgainstHost('sums-size', 4096, {});
    expect(ok.r.code, ok.r.stderr).toBe(1);
    expect(ok.requests).toEqual(['/rel/latest/download/SHA256SUMS', '/rel/latest/download/ccrc-v9.9.9.tar.gz']);
    expect(ok.r.stderr).toMatch(/download failed: .*\.tar\.gz/);
  }, 60_000);

  itLinux('a SHA256SUMS sent slower than the speed floor is refused within the stall window, not left to the total bound', async () => {
    // ~10 B/s against a 1000 B/s floor with a 1 s window; the total bound is 30 s, so only the floor can end it early.
    const { r, ms } = await runAgainstHost('slow-sums', 0, {
      CCRC_RELEASE_SPEED_LIMIT: '1000', CCRC_RELEASE_SPEED_TIME: '1', CCRC_RELEASE_SUMS_MAX_TIME: '30',
    });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/download failed: .*\/SHA256SUMS/);
    expect(ms, `took ${ms}ms`).toBeLessThan(10_000);
  }, 60_000);

  itLinux('a SHA256SUMS that trickles ABOVE the speed floor forever is ended by its total bound, and the URL it names is redacted', async () => {
    // ~10 B/s against a 1 B/s floor: no stall can end it, and ~20 bytes never reach the size bound. Only
    // `--max-time` (2 s here) is left to end the transfer.
    const { r, ms } = await runAgainstHost('slow-sums', 0, {
      CCRC_RELEASE_SPEED_LIMIT: '1', CCRC_RELEASE_SPEED_TIME: '30', CCRC_RELEASE_SUMS_MAX_TIME: '2',
    }, 'user:pass@');
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/download failed: .*\/SHA256SUMS/);
    expect(r.stderr).toMatch(/curl: \(28\)/);
    expect(ms, `took ${ms}ms`).toBeGreaterThanOrEqual(1800);
    expect(ms, `took ${ms}ms`).toBeLessThan(8_000);
    expect(allLines(r).filter((l) => /pass/.test(l)), 'a line carries the password').toEqual([]);
  }, 60_000);

  itLinux('a tarball sent slower than the speed floor is refused within the stall window', async () => {
    const { r, ms, requests } = await runAgainstHost('slow-tar', 0, {
      CCRC_RELEASE_SPEED_LIMIT: '1000', CCRC_RELEASE_SPEED_TIME: '1',
    });
    expect(r.code, r.stderr).toBe(1);
    expect(requests).toEqual(['/rel/latest/download/SHA256SUMS', '/rel/latest/download/ccrc-v9.9.9.tar.gz']);
    expect(r.stderr).toMatch(/download failed: .*\.tar\.gz/);
    expect(ms, `took ${ms}ms`).toBeLessThan(10_000);
  }, 60_000);
});

describe('install.sh: the checkout hand-off strips an ambient CCRC_UPDATE_VERIFIED too (M6)', () => {
  // The same rule as the release arm's case, on the other `exec`: a checkout
  // install verified nothing, so it must be recorded unsigned whatever the
  // caller's shell exported. The fixture is the thinnest checkout that
  // reaches the hand-off — the four directories install.sh `cd`s into, the
  // npm recorder, the REAL node for the floor read, and a `ccd/ccrc` that
  // records what it was handed.
  it('an ambient CCRC_UPDATE_VERIFIED=1 is gone by the time ccd/ccrc install runs', () => {
    const home = mkTmp('install-sh-checkout-verified-');
    const root = fixtureRoot(home, REAL_FLOOR_RANGE);
    for (const d of ['ui', 'pwa', 'agent', 'ccd']) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, 'ccd', 'ccrc'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" > "$HOME/ccrc-argv"',
      'printf \'%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" > "$HOME/ccrc-env"',
      'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    const bin = fixtureBin(home);
    symlinkSync(BASH, join(bin, 'bash'));
    symlinkSync(REAL_NODE, join(bin, 'node'));
    plantNpmRecorder(home);
    const r = runInstallSh(root, [], home, bin, { env: { CCRC_UPDATE_VERIFIED: '1' } });
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(readFileSync(join(home, 'ccrc-argv'), 'utf8')).toBe('install\n');
    expect(readFileSync(join(home, 'ccrc-env'), 'utf8')).toBe('unset\n');
  });
});

// ── The two held-equal copies (R48, W33-a) ──────────────────────────────────
// install.sh is the bootstrap and sources nothing, so the updater's release-host defaults and its URL redactor live
// in it as COPIES. These pins are what make a copy a derived one: the day either side moves alone, a row here reds.
describe('install.sh --release: the copies it holds equal to ccd/ccrc', () => {
  const read = (f: string): string => readFileSync(join(REPO, f), 'utf8');
  const KNOBS = [
    'CCRC_RELEASE_CONNECT_TIMEOUT', 'CCRC_RELEASE_SPEED_LIMIT', 'CCRC_RELEASE_SPEED_TIME',
    'CCRC_RELEASE_SUMS_MAX_TIME', 'CCRC_RELEASE_SUMS_MAX_FILESIZE',
  ] as const;
  /** Every `: "${CCRC_RELEASE_…:=value}"` line of a file, name → value. */
  const defaultsOf = (src: string): Map<string, string> => new Map(
    [...src.matchAll(/^: "\$\{(CCRC_RELEASE_[A-Z_]+):=([^}]*)\}"\s*$/gm)].map((m) => [m[1]!, m[2]!] as [string, string]));

  it('install.sh carries the five release-host defaults, each equal to ccd/ccrc\'s line', () => {
    const mine = defaultsOf(read('install.sh'));
    const theirs = defaultsOf(read('ccd/ccrc'));
    for (const k of KNOBS) {
      expect(theirs.has(k), `ccd/ccrc lost its ${k} default — this pin went vacuous`).toBe(true);
      expect(mine.has(k), `install.sh has no ${k} default line`).toBe(true);
      expect(mine.get(k), `${k} differs from ccd/ccrc's`).toBe(theirs.get(k));
    }
    // install.sh holds exactly the five: a sixth would be a knob the updater does not have.
    expect([...mine.keys()].sort()).toEqual([...KNOBS].sort());
  });

  /** Run a function's definition over NUL-separated inputs under a fixture HOME; stdout is the NUL-separated
   *  outputs, compared as bytes. The inputs travel in a file (an argv string cannot carry an invalid byte). */
  function runRedactor(def: string, name: string, inputs: readonly Buffer[], fixtureHome: string,
    extraEnv: NodeJS.ProcessEnv = {}): Buffer {
    const work = mkTmp('install-sh-redact-eq-');
    writeFileSync(join(work, 'defs.sh'), `${def}\n`);
    writeFileSync(join(work, 'inputs'), Buffer.concat(inputs.flatMap((b) => [b, Buffer.from([0])])));
    const driver = `. "$1"\nwhile IFS= read -r -d '' line; do ${name} "$line"; printf '\\0'; done < "$2"\n`;
    const r = spawnSync(BASH, ['--noprofile', '--norc', '-c', driver, 'driver', join(work, 'defs.sh'), join(work, 'inputs')], {
      env: { ...extraEnv, HOME: fixtureHome, PATH: process.env['PATH'] ?? '' }, encoding: 'buffer',
    });
    expect(r.status, `${name} failed: ${r.stderr.toString()}`).toBe(0);
    return r.stdout;
  }

  const EIGHT = [
    'http://example.invalid/releases',                                   // plain
    'https://user:pass@example.invalid/releases',                        // userinfo
    'https://example.invalid/releases?token=x',                          // query
    'https://example.invalid/releases#frag',                             // fragment
    'https://user:pass@example.invalid/releases?token=x#frag',           // all three
    'http://u:p@[::1]:8080/releases/latest/download/SHA256SUMS',          // IPv6 literal
    'user:pass@example.invalid/releases',                                // no scheme
    '',                                                                  // empty
  ];

  /** The inputs both redactor pins run: the eight shapes, then every log-line corpus row, grouped by HOME. */
  function redactCorpus(): Array<{ home: string; inputs: Buffer[] }> {
    const fixtureHome = '/home/u';
    const sets: Array<{ home: string; inputs: Buffer[] }> = [{ home: fixtureHome, inputs: EIGHT.map((s) => Buffer.from(s)) }];
    // The log-line corpus: every row with a plain, hex or run-built input, grouped by the home its row was written for.
    interface CorpusRow {
      home: string; input?: string; inputHex?: string; inputRuns?: Array<{ text: string; times: number }>;
    }
    const rows = (JSON.parse(read('server/test/fixtures/redact/log-line.json')) as { rows: CorpusRow[] }).rows;
    const byHome = new Map<string, Buffer[]>();
    for (const row of rows) {
      const b = row.input !== undefined ? Buffer.from(row.input)
        : row.inputHex !== undefined ? Buffer.from(row.inputHex, 'hex')
          : row.inputRuns !== undefined ? Buffer.from(row.inputRuns.map((u) => u.text.repeat(u.times)).join(''))
            : null;
      if (b === null || b.includes(0)) continue;
      byHome.set(row.home, [...(byHome.get(row.home) ?? []), b]);
    }
    for (const [home, inputs] of byHome) sets.push({ home, inputs });
    expect(sets.reduce((n, s) => n + s.inputs.length, 0), 'the corpus read went vacuous').toBeGreaterThan(150);
    return sets;
  }

  it('install.sh\'s redactor gives byte-equal output to _upd_redact on the eight shapes and on the whole shared corpus', () => {
    const upd = ccdFunctionDefinition(read('ccd/ccrc'), '_upd_redact');
    const mine = ccdFunctionDefinition(read('install.sh'), '_inst_redact');
    expect(upd, 'ccd/ccrc has no _upd_redact').not.toBeNull();
    expect(mine, 'install.sh has no _inst_redact').not.toBeNull();
    const fixtureHome = '/home/u';
    const sets = redactCorpus();
    for (const s of sets) {
      const want = runRedactor(upd!, '_upd_redact', s.inputs, s.home);
      const got = runRedactor(mine!, '_inst_redact', s.inputs, s.home);
      expect(got.toString('hex'), `the copy diverged for HOME=${s.home}`).toBe(want.toString('hex'));
    }
    // And the pin is not vacuous: the userinfo shape is really masked by both.
    const masked = runRedactor(mine!, '_inst_redact', [Buffer.from(EIGHT[1]!)], fixtureHome).toString().replace(/\0$/, '');
    expect(masked).toBe('https://example.invalid/releases');
  });

  // Held equal by OUTPUT, not by text. install.sh's `--release` runs before its own bash version refusal, so the copy
  // can run on macOS /bin/bash 3.2 (and any bash up to 4.2), where a QUOTED replacement string inside
  // "${s/pat/rep}" keeps its quotes: `https://user:pass@h/r` printed as `https"://"h/r`. ccd/ccrc needs 4.4 and
  // never sees that, so the copy spells its replacements without a pattern substitution. `BASH_COMPAT` makes this
  // box's bash behave like the older ones for exactly that quoting rule.
  for (const compat of ['42', '40']) {
    it(`the copy under BASH_COMPAT=${compat} is byte-equal to _upd_redact under the default bash, on the whole corpus`, () => {
      const upd = ccdFunctionDefinition(read('ccd/ccrc'), '_upd_redact');
      const mine = ccdFunctionDefinition(read('install.sh'), '_inst_redact');
      expect(upd).not.toBeNull();
      expect(mine).not.toBeNull();
      const sets = redactCorpus();
      for (const set of sets) {
        const want = runRedactor(upd!, '_upd_redact', set.inputs, set.home);
        const got = runRedactor(mine!, '_inst_redact', set.inputs, set.home, { BASH_COMPAT: compat });
        expect(got.toString('hex'), `the copy diverged under BASH_COMPAT=${compat} for HOME=${set.home}`).toBe(want.toString('hex'));
      }
      const masked = runRedactor(mine!, '_inst_redact', [Buffer.from(EIGHT[1]!)], '/home/u', { BASH_COMPAT: compat })
        .toString().replace(/\0$/, '');
      expect(masked).toBe('https://example.invalid/releases');
    });
  }
});
