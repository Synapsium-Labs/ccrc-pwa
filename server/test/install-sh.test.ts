// `install.sh` (repo root) — the stage-2 BOOTSTRAP, not the converger. It
// exists only to get a bare checkout to the point where `ccrc install` (the
// verb `ccrc-install.test.ts` measures) can run: refuse a too-old or absent
// `node`, build the three artifacts `ccrc install` itself refuses without
// (`server/dist`, `server/dist-pwa`, `server/node_modules` is implied by the
// build), then hand off. This file measures ONLY the bootstrap's own logic —
// the floor read/compare and the two early exits — not the handoff itself,
// which is `ccrc-install.test.ts`'s "install.sh hands off to it" describe
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
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, existsSync, chmodSync, readFileSync, copyFileSync, symlinkSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

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
  opts: { bareFromRoot?: boolean } = {}): Result {
  const env = { HOME: home, PATH: pathDir };
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
  // own comment names one layer down (`ccd/ccrc:1613-1618`): "an install
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
