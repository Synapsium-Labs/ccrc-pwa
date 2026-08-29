// `ccrc doctor`'s `graphify` check (Task 11 of the 2026-08-28
// graphify-fleet-integration plan) — the engine/skills/excludes/census/
// worktrees-disk measurement that closes D-995 (WORKTREES_ROOT df arm) and
// D-997 (skill drift visible).
//
// ── WHY THIS IS A SEPARATE FILE, WITH ITS OWN FIXTURE ─────────────────────
// `server/test/ccrc-doctor.test.ts` already has a `healthy()`/`runDoctor()`/
// `lineFor()` triad, but nothing in that file is `export`ed — every OTHER
// doctor-adjacent suite in this tree (`ccrc-install.test.ts`'s own header,
// "This is ccrc-doctor.test.ts's healthy(), adapted") builds its OWN fixture
// rather than importing one, and this file follows that precedent rather
// than exporting from a 5000-line suite to save a second file's worth of
// setup. What is copied below is copied FAITHFULLY where it is copied at
// all (`stub`, `linkReal`, `containedPath`, `doctorEnv`, `runDoctor`,
// `lineFor`) — the ONE deliberate difference is `healthy()` itself, which
// this file keeps DELIBERATELY MINIMAL: `ccrc doctor` runs every check in
// the table in its own subshell (`cmd_doctor`'s own header — a check that
// dies under `set -u` only takes itself down, never the run), so a check
// this file does not care about is free to FAIL loudly without touching the
// one line every test here reads (`lineFor(out, 'graphify')`). Concretely,
// this fixture skips the exposure quartet, the roster's wrapper-shape
// ceremony, the build stamp, and auth — none of it is graphify's subject —
// and ADDS one thing `ccrc-doctor.test.ts`'s own roster never has: a SECOND
// rostered home (`claude-personal` -> `.claude-personal`), because the
// brief's own `graphifyHealthy()` fixture plants a skill stamp under
// `.claude-personal` and the D-997 test needs that home to be ON THE
// ROSTER for condition (4) to ever look at it.
//
// ── THE TWO SAFETY BOUNDARIES, KEPT ────────────────────────────────────────
// HOME is a throwaway `mkTmp` directory in every test (never the live
// `$HOME`), and PATH comes from `ghContainedEnv` and holds NOTHING BUT
// FIXTURE DIRECTORIES — the real `gh`, which on this machine carries a
// repo-WRITE token, is unreachable by construction. `git`, `jq`, `date`,
// `df`, `realpath` are the only subject binaries the `graphify` check
// actually shells out to; `git`, `jq`, `date` and `realpath` are
// `linkReal`ed (their PARSING is not what this suite is testing) and `df`
// is a scripted stub, same convention `ccrc-doctor.test.ts`'s own `stubDf`
// uses.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  writeFileSync, mkdirSync, symlinkSync, rmSync, utimesSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');
const LIB_SRC = join(REPO, 'ccd', 'ccrc-wrapper-shape');

const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

interface Result { code: number; stdout: string; stderr: string }

/** `<home>/ccrc/ccd/{ccrc,ccrc-doctor-checks,ccrc-wrapper-shape}` — symlinks,
 *  the shape a deployed box has (deploy.sh:276 rsyncs `ccd` whole), so a test
 *  always runs the CHECKED-IN scripts and `dirname $0` resolves inside the
 *  fixture. Same idiom as `ccrc-doctor.test.ts`'s `installCcrc`, minus the
 *  `auth` check's two extra artifacts — this fixture never plants a passphrase
 *  and does not care what `auth` reports. */
function installCcrc(home: string): void {
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
  symlinkSync(CHECKS_SRC, join(ccd, 'ccrc-doctor-checks'));
  symlinkSync(LIB_SRC, join(ccd, 'ccrc-wrapper-shape'));
}

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');

const stubBin = (home: string): string => {
  const d = join(home, 'stub-bin');
  mkdirSync(d, { recursive: true });
  return d;
};

function stub(home: string, name: string, body: string): void {
  writeFileSync(join(stubBin(home), name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** Idempotent, same as `ccrc-doctor.test.ts`'s own — a re-link inside a
 *  specific test must not trip over the fixture already having one. */
const linkReal = (home: string, name: string): void => {
  rmSync(join(stubBin(home), name), { force: true });
  symlinkSync(realPath(name), join(stubBin(home), name));
};

/** `df -Pk <path>` answering a POSIX table whose Available column (field 4,
 *  KiB) is keyed off the LAST path component: `…/worktrees` reads
 *  `<home>/fixture-df-avail-worktrees`, `…/projects` reads
 *  `<home>/fixture-df-avail-projects`, anything else falls back to a large
 *  default (41 GiB) so a check that happens to probe `df` on some other path
 *  (the `disk` check, on `$HOME`) gets a plausible answer rather than an
 *  "unexpected argv" refusal that would print noise this suite does not read.
 *  Same fixture-file convention `ccrc-doctor.test.ts`'s own `stubDf` uses,
 *  extended per the brief: "a second fixture file fixture-df-avail-worktrees
 *  answers df on ~/worktrees". */
function stubDf(home: string): void {
  stub(home, 'df', [
    'if [ "$1" = "-Pk" ] && [ -n "$2" ]; then',
    // The stale/dead-mount shape `_check_disk`'s own header names: df exits
    // non-zero printing NOTHING. `fixture-df-fail-<root>` triggers it for a
    // specific root, so a test can make ONLY the worktrees (or projects)
    // probe fail while $HOME's own `disk` check elsewhere stays unaffected.
    '  case "$2" in',
    '    */worktrees) [ -f "$HOME/fixture-df-fail-worktrees" ] && exit 1 ;;',
    '    */projects) [ -f "$HOME/fixture-df-fail-projects" ] && exit 1 ;;',
    '  esac',
    '  f=""',
    '  case "$2" in',
    '    */worktrees) [ -f "$HOME/fixture-df-avail-worktrees" ] && f="$HOME/fixture-df-avail-worktrees" ;;',
    '    */projects) [ -f "$HOME/fixture-df-avail-projects" ] && f="$HOME/fixture-df-avail-projects" ;;',
    '  esac',
    '  avail=42991616',
    '  [ -n "$f" ] && read -r avail < "$f"',
    '  echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    '  echo "/dev/fixture0    104857600  20971520 $avail      21% /"',
    '  exit 0',
    'fi',
    'echo "fixture df: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
}

/** `ghContainedEnv` plants the poisoned `gh` once; remembered per home so a
 *  second call (from a second `runDoctor`) does not re-plant over a test's
 *  own overwrite — `ccrc-doctor.test.ts`'s own `containedPath` states the
 *  measured bug this avoids. */
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
    CCRC_DOCTOR_GH_TIMEOUT: '5',
  };
}

function runDoctor(home: string): Result {
  const r = spawnSync(BASH, [ccrcIn(home), 'doctor'],
    { env: doctorEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const lineFor = (out: string, name: string): string | undefined =>
  out.split('\n').find((l) => new RegExp(`^(PASS|WARN|FAIL|SKIP) ${name}: `).test(l));

/** The roster this fixture's `healthy()` seeds: the upstream account plus
 *  ONE generated account whose `configDirSuffix` is `.claude-personal` — a
 *  real, documented production suffix (`shared/roster.ts`'s own
 *  `configDirSuffix` comment lists it alongside `.claude`, `.claude-corp`
 *  and `.claude-gpt`), and the one the brief's `graphifyHealthy()` fixture
 *  plants a skill stamp under. Without a roster entry naming it, condition
 *  (4) never looks at `.claude-personal` at all and the D-997 test would be
 *  asserting on a home nothing measures. */
const GRAPHIFY_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' as const }, homeAble: true, telemetry: 'anthropic' as const,
    },
    {
      id: 'claude-personal', label: 'claude-personal', configDirSuffix: '.claude-personal',
      exec: { kind: 'generated' as const }, homeAble: true, telemetry: 'anthropic' as const,
    },
  ],
};

/** `<home>/.ccrc/accounts.sh`, generated the same way a real `ccrc install`
 *  would (`parseRoster` -> `generateAccountsSh`), never hand-typed — the
 *  reason `server/test/ccdWsHelpers.ts`'s own `seedAccountsSh` gives applies
 *  here too: a hand-written accounts.sh would be a fourth copy of the roster
 *  shape, and it would be the copy every test in this file believed. */
function seedGraphifyAccountsSh(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(parseRoster(GRAPHIFY_ROSTER)));
}

/** A box where the `graphify` check specifically passes: `ccrc`/checks/
 *  wrapper-shape symlinked in, PATH contained, `git`/`jq`/`date`/`realpath`
 *  real (the check's own subject-adjacent tools), `df` stubbed, and a two-account
 *  roster naming `.claude` and `.claude-personal`. Every OTHER check in the
 *  table is free to FAIL here — `cmd_doctor` runs each in its own subshell,
 *  and this suite reads only the `graphify` verdict line. */
function healthy(prefix: string): string {
  const home = mkTmp(prefix);
  installCcrc(home);
  containedPath(home);
  linkReal(home, 'git');
  linkReal(home, 'jq');
  linkReal(home, 'realpath');
  linkReal(home, 'date');
  // `_plat_mtime` (the census-staleness probe) shells `stat` — real-linked for
  // `date`'s reason: its parsing is not this suite's subject.
  linkReal(home, 'stat');
  stubDf(home);
  seedGraphifyAccountsSh(home);
  return home;
}

/** The brief's own fixture, verbatim (task-11-brief.md, "Step 1: Failing
 *  tests"): plants a working venv engine answering `graphify 0.9.9`, the pin
 *  stamp, both `.claude` and `.claude-personal` skill stamps, and a fresh
 *  `ok` census with an empty tree list. */
function graphifyHealthy(home: string): void {
  const venvBin = join(home, '.ccrc', 'graphify-venv', 'bin');
  mkdirSync(venvBin, { recursive: true });
  writeFileSync(join(venvBin, 'graphify'),
    '#!/bin/sh\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
  for (const d of ['.claude', '.claude-personal']) {
    const s = join(home, d, 'skills', 'graphify');
    mkdirSync(s, { recursive: true });
    writeFileSync(join(s, '.graphify_version'), '0.9.9');
  }
  writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
    started: new Date().toISOString(), finished: new Date().toISOString(),
    pin: '0.9.9', status: 'ok', trees: [] }] }));
}

describe('ccrc doctor: graphify', () => {
  it('passes on the healthy fixture', () => {
    const home = healthy('ccrc-doctor-gfx-'); graphifyHealthy(home);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  it('SKIPs (rc 3 semantics) on a server-role box', () => {
    const home = healthy('ccrc-doctor-gfx-srv-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');   // mirror how healthy() writes it
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^SKIP graphify:/);
  });

  it('FAILs naming the home when a rostered skill stamp is missing (D-997)', () => {
    const home = healthy('ccrc-doctor-gfx-drift-'); graphifyHealthy(home);
    rmSync(join(home, '.claude-personal', 'skills', 'graphify'), { recursive: true });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('.claude-personal');
  });

  it('WARNs on version drift between engine and pin', () => {
    const home = healthy('ccrc-doctor-gfx-ver-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.50\n');
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });

  it('FAILs when the engine venv is missing entirely', () => {
    const home = healthy('ccrc-doctor-gfx-novenv-'); graphifyHealthy(home);
    rmSync(join(home, '.ccrc', 'graphify-venv'), { recursive: true });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
  });

  it('reds on a probed-zero last pass (the cap-scopes 13-day failure, made visible)', () => {
    const home = healthy('ccrc-doctor-gfx-zero-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'probed-zero', trees: [] }] }));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });

  // R-5 (controller ruling, carried from Task 6): the pass-status vocabulary
  // is SIX values (ok | probed-zero | no-trees-configured | pass-locked |
  // paused | failed), and `failed` — the no-pin path's own status — means the
  // sweep could not run AT ALL, a condition distinct from probed-zero but
  // just as broken. Doctor must red on both.
  it('reds on a failed last pass (R-5: the pass could not run at all, e.g. no pin)', () => {
    const home = healthy('ccrc-doctor-gfx-failed-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'failed', trees: [] }] }));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });

  // Finding 2 (whole-branch review): the documented rollout is deploy
  // agent-first -> timer enabled -> sweep fires PINLESS -> census
  // {status:"failed", pin:""} -> THEN `ccrc install` converges everything,
  // pin file included. A closing doctor reading that stale pinless-failed
  // pass right after install must not FAIL a box that just converged.
  it('WARNs (not FAILs) on a failed+pinless last pass once the engine pin now exists (finding 2)', () => {
    const home = healthy('ccrc-doctor-gfx-failed-preprov-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '', status: 'failed', trees: [] }] }));
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
  });

  it('still FAILs a failed+pinless last pass when the pin file itself is still absent', () => {
    const home = healthy('ccrc-doctor-gfx-failed-nopin-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '', status: 'failed', trees: [] }] }));
    rmSync(join(home, '.ccrc', 'graphify.pin'));
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
  });

  it('still FAILs a failed pass that recorded a NON-empty pin, even though the pin file exists now', () => {
    const home = healthy('ccrc-doctor-gfx-failed-realpin-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'failed', trees: [] }] }));
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
  });

  // D-1061 (deviation from the brief's plain-English "absent file -> WARN"):
  // an absent census must NOT warn, or every fresh install warns, always —
  // `OnBootSec=5min` means no box has a census for several minutes at
  // minimum, and D-139 (ccrc-install.test.ts, "ends with doctor, and a box
  // that passes every check exits 0") is an operator ruling that a fresh
  // install ends green. See the check's own comment at condition (6).
  it('does not WARN when the census has never been written — a fresh box, D-1061/D-139', () => {
    const home = healthy('ccrc-doctor-gfx-census-abs-'); graphifyHealthy(home);
    rmSync(join(home, '.ccrc', 'graph-sweep.json'));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  it('WARNs when the last pass finished long enough ago that the timer looks stopped', () => {
    const home = healthy('ccrc-doctor-gfx-census-stale-'); graphifyHealthy(home);
    // 60 minutes ago — over 3x the sweep timer's 15-minute interval (45 min).
    // The check reads the census FILE's mtime (the sweep rewrites it atomically
    // at the end of every pass), not the JSON's ISO stamp — GNU `date -d` has
    // no Darwin arm, and the macos-platform guard forbids the bare call. So
    // the fixture ages the FILE, exactly what a stopped timer leaves behind.
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const census = join(home, '.ccrc', 'graph-sweep.json');
    writeFileSync(census, JSON.stringify({ passes: [{
      started: old, finished: old, pin: '0.9.9', status: 'ok', trees: [] }] }));
    const oldSecs = Date.now() / 1000 - 3600;
    utimesSync(census, oldSecs, oldSecs);
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
  });

  it('WARNs when PATH resolves graphify outside the pinned venv', () => {
    const home = healthy('ccrc-doctor-gfx-shadow-'); graphifyHealthy(home);
    // stub-bin sits on the contained PATH, second after <home>/.local/bin —
    // command -v must find this one, and it is not the venv path.
    stub(home, 'graphify', 'echo "shadow graphify"; exit 0');
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
  });

  it('WARNs when a tracked tree has not been given the graphify-out/ exclude', () => {
    const home = healthy('ccrc-doctor-gfx-excl-'); graphifyHealthy(home);
    const repo = join(home, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });
    execFileSync(realPath('git'), ['init', '-q'], { cwd: repo });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('1');
  });

  it('D-995: WARNs when the worktrees device is tight even though $HOME is roomy', () => {
    const home = healthy('ccrc-doctor-gfx-disk-'); graphifyHealthy(home);
    // extend stubDf: a second fixture file fixture-df-avail-worktrees answers df on ~/worktrees
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-avail-worktrees'), String(3 * 1024 * 1024)); // 3 GiB
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('worktrees');
  });

  it('D-995: FAILs when the worktrees device is under the 2 GiB floor', () => {
    const home = healthy('ccrc-doctor-gfx-disk-fail-'); graphifyHealthy(home);
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-avail-worktrees'), String(1 * 1024 * 1024)); // 1 GiB
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('worktrees');
  });

  // Review finding (Important, condition 7 / D-995 fix round): a SELECTED
  // root that df cannot read (a stale or dead mount — df exits non-zero
  // printing nothing, exactly like the "avail" case's empty match) used to
  // fall through the `''|*[!0-9]*` arm and produce NO finding at all —
  // recreating the D-995 blind spot inside the arm meant to close it, and
  // collapsing "root absent, nothing to measure" (silent) into "root
  // present, measurement FAILED" (a real defect) — the overloaded-null shape
  // this codebase bans by name. `_check_disk` WARNs on the identical shape
  // for $HOME; this is that same measurement over $HOME/worktrees.
  it('D-995: WARNs (not silent) when df cannot read the worktrees root — a stale/dead mount', () => {
    const home = healthy('ccrc-doctor-gfx-disk-unread-'); graphifyHealthy(home);
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-fail-worktrees'), '1');
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('worktrees');
  });
});
