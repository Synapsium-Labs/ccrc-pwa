// The Linux arm of `_upd_sweep` after wave 11 (centralised update management, R12; D-3972, D-3973, D-3974, D-3982,
// D-3983, D-3984): ONE shared verify window by concurrent per-unit calls, the operator's "re-check once" of a
// crash-like failure (the ruling of 2026-10-05, 13:58), crash-shaped units verified (`activating`/`failed` after the
// restart), and a die that names how many failed without touching another run's report.
//
// WHAT RUNS. This tree's `_upd_sweep` out of the sourced `ccd/ccrc`, on a fixture HOME whose `systemctl` and
// `journalctl` are stubs, against this tree's `deploy/verify-service.sh` (S11) — or, for R1 to R3, against the FROZEN
// wave-10 script (`fixtures/verify-service-pre-wave10.sh`, S0, v0.0.79's bytes): a rollback pairs THIS sweep with an
// OLDER script, so the sweep must hold with a script that knows nothing of `stopped on purpose:`. The OLD sweep with
// the NEW script — the move INTO wave 11 — is `ccrc-sweep-deliberate-stop.test.ts`'s. The builders are
// `sweepFixture.ts`'s.
//
// SAFETY. A fixture HOME only, an env built from scratch, every tool that is not a stub a recording POISON, and
// `runSweep` proves containment on the spawn's FINAL env before every spawn. No verify job outlives its case (T-1):
// every case that kills a sweep mid-verify COLLECTS (`survivors`, the scratch dir's listing), REAPS, and only then
// asserts, so a failed assertion cannot leave a job running under a HOME the file's `afterAll` is about to remove.
import { describe, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { itLinux } from './platformFixtures.js';
import { mkTmp } from './tmpHelpers.js';
import {
  BASH, CCRC_SRC, FROZEN_VERIFY_S0, SWEEP_OK, makeBox, runSweep, sweepSpawn, calls, poisonFiles, report, survivors, reapSurvivors,
  type Box, type UnitPlant,
} from './sweepFixture.js';

const U = (x: string): string => `claude-session@demo-${x}.service`;
const A = U('a');
const B = U('b');
const C = U('c');
const D = U('d');
const STAMP = '1791151850 ccd';

const stable = (unit: string, i = 0): UnitPlant => ({ unit, active: ['active'], mainPid: [String(4000 + i)] });
/** Every read a new pid: the first call AND the re-check fail. */
const churn = (unit: string): UnitPlant => ({ unit, active: ['active'], mainPid: ['111', '222', '333', '444'] });
/** The 2026-10-04 22:06 shape: `activating` at the second read, then up. */
const ACTIVATING = { active: ['active', 'activating', 'active', 'active'], mainPid: ['111', '222', '222'] };
/** The same transient, seen as a new MainPID at the second read, then stable. */
const NEWPID = { active: ['active', 'active', 'active', 'active'], mainPid: ['111', '222', '333', '333'] };

const act = (u: string): string => `--user is-active ${u}`;
const pidCall = (u: string): string => `--user show -p MainPID --value ${u}`;
const count = (box: Box, line: string): number => calls(box).filter((l) => l === line).length;
const nth = (xs: string[], line: string, n: number): number => {
  let seen = 0;
  for (let i = 0; i < xs.length; i++) if (xs[i] === line && ++seen === n) return i;
  return -1;
};
const lines = (s: string, needle: string): number => s.split('\n').filter((l) => l.includes(needle)).length;
const ctx = (r: { code: number; stdout: string; stderr: string }): string =>
  `code ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const RECHECK = 'update: sweep: re-check:';
const LIST_ACTIVE = '--user list-units claude-session@* --state=active --plain --no-legend';
const LIST_CRASH = '--user list-units claude-session@* --state=activating,failed --plain --no-legend';

/** The sweep's die, as `_ccrc_die` prints it on stderr: facts first (kc of n, the re-check, mn left), then the unit. */
const dieLine = (kc: number, n: number, mn: number, first: string): string =>
  `ccrc: sweep: ${kc} of ${n} supervisors did not stay up on a first verify; a re-check failed, ${mn} left `
  + `un-re-checked — install complete, nothing was rolled back (first failed re-check: ${first}); `
  + `read: systemctl --user status ${first}`;

/** The die's own stderr line, whole: a `toContain` of its text would pass over anything appended after it. */
const dieOf = (stderr: string): string | undefined => stderr.split('\n').find((l) => l.startsWith('ccrc: sweep:'));

const stoppedLine = (u: string, id: string): string => `stopped on purpose: ${u} settled 'inactive', and ccd's stop stamp `
  + `~/.cc-sessions/${id}.stopped is present (reads '${STAMP}') — a deliberate stop, not a crash`;
const purgedLine = (u: string, id: string): string => `stopped on purpose: ${u} settled 'inactive', and its registry row is purged `
  + `(no ~/.cc-sessions/${id}.uuid) — a deliberate stop, not a crash`;

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A script a case plants as `~/ccrc/deploy/verify-service.sh`. */
function fixtureScript(name: string, body: string): string {
  const dir = mkTmp('ccrc-sweep-fx-');
  const f = join(dir, name);
  writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return f;
}
const fixtureCalls = (box: Box): string[] => {
  const f = join(box.home, 'fixture-calls');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
};
const killLog = (box: Box): string[] => {
  const f = join(box.home, 'kill-log');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
};

/** Collect, then reap, THEN let the caller assert (T-1): 0.5 s after the spawn returned. */
function collect(box: Box): { found: number[]; left: string[] } {
  pause(500);
  const found = survivors(box);
  const left = readdirSync(join(box.home, 'tmp'));
  reapSurvivors(box);
  return { found, left };
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const noPoison = (box: Box): void => { expect(poisonFiles(box)).toEqual([]); };

/** The ccrc source, and the three slices W0 reads. */
function arms(src: string): { linux: string; launch: string; die: string; kill: string; sweep: string } {
  const body = (name: string): string => {
    const m = new RegExp(`${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`).exec(src);
    expect(m, `${name}() { … } not found in ccd/ccrc`).not.toBeNull();
    return m![1]!;
  };
  const sweep = body('_upd_sweep');
  // The split `single-definition.test.ts`'s `updSweepArms` makes.
  const d0 = sweep.indexOf('"$CCD_OS" = darwin');
  expect(d0, '_upd_sweep lost its Darwin arm').toBeGreaterThan(-1);
  const dEnd = sweep.indexOf('\n  fi', d0);
  expect(dEnd, "_upd_sweep's Darwin arm never closes").toBeGreaterThan(d0);
  return { linux: sweep.slice(dEnd), sweep, launch: body('_upd_sweep_launch'), die: body('_upd_sweep_die'), kill: body('_upd_sweep_kill') };
}

describe('_upd_sweep, Linux arm: one shared verify window, a re-check, crash-shaped units (wave 11, R12)', () => {
  itLinux('W0 the shape: one unit per call, no bare die, the exit-chain kill, the stop', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const { linux, launch, die, kill } = arms(src);
    expect(linux).toContain('local verify="$BOX_TREE_DIR/deploy/verify-service.sh"');
    expect(linux).toContain('CCRC_SWEEP_VERIFY_JOBS:-128');
    expect(linux).toContain('--state=activating,failed');
    // Every call of the script passes ONE unit: an older script reads only $1 (the R12 critic's B2).
    const both = `${linux}\n${launch}`;
    expect(both.match(/bash "\$verify"/g)?.length ?? 0, 'the script is called from exactly four places').toBe(4);
    expect(both.match(/bash "\$verify" "\$\{units\[[ik]\]\}"(?!")/g)?.length ?? 0,
      'each call passes one quoted unit and nothing after it').toBe(4);
    expect(linux).not.toContain('_ccrc_die');
    expect(die).toContain('! _upd_report_is_mine');
    expect(die).toContain('_ccrc_die "$@"');
    expect(launch).toContain('set -m');
    expect(kill, 'a pid of 1 or less must be refused (`kill -- -1` signals every process the user owns)')
      .toContain('[ "$p" -gt 1 ] || continue');
    expect(linux).toMatch(/_exit_add "[^\n]*_upd_sweep_kill/);
    expect(linux).toContain('[ -n "$rfail" ]');
  }, 60_000);

  itLinux('W1 ONE shared window: every unit is in flight at once, so no first call fails the barrier', () => {
    const gates = [A, B, C].map((unit) => ({
      unit, call: 2, until: { firstPids: 3 }, boundTenths: 50, onTimeout: 'failed' as const,
    }));
    const box = makeBox({ units: [stable(A, 0), stable(B, 1), stable(C, 2)], gates });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stdout).toContain(SWEEP_OK);
    expect(r.stderr, 'a serial verify fails each first call at the barrier and passes on its re-check').not.toContain(RECHECK);
    noPoison(box);
  }, 60_000);

  itLinux('W2 the bound: CCRC_SWEEP_VERIFY_JOBS=2 starts the third unit only after the first two', () => {
    const gates = [A, B].map((unit) => ({
      unit, call: 2, until: { unit: C, isActive: 1 }, boundTenths: 30, onTimeout: 'answer' as const,
    }));
    const box = makeBox({ units: [stable(A, 0), stable(B, 1), stable(C, 2)], gates });
    const r = runSweep(box, { env: { CCRC_SWEEP_VERIFY_JOBS: '2' } });
    expect(r.code, ctx(r)).toBe(0);
    const cs = calls(box);
    const cFirst = cs.indexOf(act(C));
    expect(cFirst).toBeGreaterThan(-1);
    expect(cFirst).toBeGreaterThan(nth(cs, pidCall(A), 2));
    expect(cFirst).toBeGreaterThan(nth(cs, pidCall(B), 2));
    noPoison(box);
  }, 60_000);

  itLinux.each(['0', 'abc', '-1', '99999'])('W2b an invalid bound (%s) reads as 128', (bound) => {
    const gates = [A, B, C].map((unit) => ({
      unit, call: 2, until: { firstPids: 3 }, boundTenths: 50, onTimeout: 'failed' as const,
    }));
    const box = makeBox({ units: [stable(A, 0), stable(B, 1), stable(C, 2)], gates });
    const r = runSweep(box, { env: { CCRC_SWEEP_VERIFY_JOBS: bound }, timeout: 45_000 });
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).not.toContain(RECHECK);
    noPoison(box);
  }, 60_000);

  itLinux.each(['1', '128'])('W3 every unit is verified after a failure (jobs %s)', (jobs) => {
    const box = makeBox({ units: [churn(A), stable(B, 1), stable(C, 2)] });
    const r = runSweep(box, { env: { CCRC_SWEEP_VERIFY_JOBS: jobs } });
    expect(r.code, ctx(r)).toBe(1);
    expect(count(box, pidCall(A))).toBe(4);
    expect(count(box, pidCall(B))).toBe(2);
    expect(count(box, pidCall(C))).toBe(2);
    expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 3, 0, A));
    noPoison(box);
  }, 60_000);

  itLinux('W4 the FIRST failed re-check is named, and the stop leaves the rest un-re-checked', () => {
    const box = makeBox({
      units: [{ unit: A, active: ['active', 'inactive'], mainPid: ['5151'] }, stable(B, 1), churn(C)],
      registry: { 'demo-a.uuid': 'u1\n' },
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    const iA = r.stderr.indexOf(`${RECHECK} ${A} failed its re-check too`);
    const iC = r.stderr.indexOf(`${RECHECK} ${C} failed its first verify and is not re-checked`);
    expect(iA).toBeGreaterThan(-1);
    expect(iC).toBeGreaterThan(iA);
    expect(count(box, pidCall(C))).toBe(2);
    expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(2, 3, 1, A));
    noPoison(box);
  }, 60_000);

  itLinux('W5 the die is this run\'s `failed` report, from its own shell (I8)', () => {
    const box = makeBox({ units: [churn(A), stable(B, 1)], report: { pid: 4242 } });
    const r = runSweep(box, { reporting: { pid: 4242 } });
    expect(r.code, ctx(r)).toBe(1);
    const j = JSON.parse(report(box)!) as { phase: string; detail: string };
    expect(j.phase).toBe('failed');
    expect(j.detail.startsWith('sweep: 1 of 2 supervisors did not stay up on a first verify; a re-check failed, '
      + '0 left un-re-checked - install complete, nothing was rolled back (first failed re-check: '
      + 'claude-session@demo-a'), j.detail).toBe(true);
    expect(r.stdout).not.toContain('update: sweep: every live');
    noPoison(box);
  }, 60_000);

  itLinux('W6 a foreign report survives', () => {
    const box = makeBox({ units: [churn(A)], report: { pid: 999999, phase: 'resolving' } });
    const plant = report(box);
    const r = runSweep(box, { reporting: { pid: 4242 } });
    expect(r.code, ctx(r)).toBe(1);
    expect(report(box)).toBe(plant);
    expect(r.stdout).toContain('update: report: skipped — ~/.ccrc/update.json no longer names this run\'s pid (4242); '
      + 'a newer update took the lock this run released before the sweep, and this run\'s failed report would have '
      + 'overwritten its in-flight one');
    noPoison(box);
  }, 60_000);

  itLinux('W7 the 200-character cap keeps the facts and truncates the unit', () => {
    const unit = `claude-session@demo-${'x'.repeat(35)}.service`;
    const box = makeBox({ units: [churn(unit)], report: { pid: 4242 } });
    const r = runSweep(box, { reporting: { pid: 4242 } });
    expect(r.code, ctx(r)).toBe(1);
    const j = JSON.parse(report(box)!) as { phase: string; detail: string };
    expect(j.detail.length).toBeLessThanOrEqual(200);
    for (const want of ['1 of 1', 'did not stay up', '0 left un-re-checked', 'nothing was rolled back',
      '(first failed re-check: claude-session@']) expect(j.detail, want).toContain(want);
    const die = r.stderr.split('\n').find((l) => l.startsWith('ccrc: sweep:'));
    expect(die, ctx(r)).toBeDefined();
    expect(die!).toContain(unit);
    expect(die!.endsWith(`read: systemctl --user status ${unit}`)).toBe(true);
    noPoison(box);
  }, 60_000);

  itLinux('W8 no backup is promised', () => {
    const box = makeBox({ units: [churn(A), stable(B, 1)], report: { pid: 4242 } });
    const r = runSweep(box, { reporting: { pid: 4242 } });
    expect(r.code, ctx(r)).toBe(1);
    expect(r.stderr).not.toContain('backup');
    const j = JSON.parse(report(box)!) as { detail: string };
    expect(j.detail).not.toContain('backup');
    noPoison(box);
  }, 60_000);

  itLinux('W9 stdout is replayed in listing order', () => {
    const box = makeBox({
      units: [
        stable(A, 0),
        { unit: B, active: ['active', 'inactive', 'inactive'], mainPid: ['5151'] },
        { unit: C, active: ['inactive', 'inactive'], mainPid: [] },
        stable(D, 3),
      ],
      registry: { 'demo-b.uuid': 'u2\n', 'demo-b.stopped': `${STAMP}\n`, 'demo-c.generation': '1\n' },
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).not.toContain(RECHECK);
    const got = r.stdout.split('\n').filter((l) => /^(verified|stopped on purpose):/.test(l));
    expect(got.length, ctx(r)).toBe(4);
    expect(got[0]!.startsWith(`verified: ${A} `)).toBe(true);
    expect(got[1]).toBe(stoppedLine(B, 'demo-b'));
    expect(got[2]).toBe(purgedLine(C, 'demo-c'));
    expect(got[3]!.startsWith(`verified: ${D} `)).toBe(true);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(SWEEP_OK);
    noPoison(box);
  }, 60_000);

  itLinux('W10 stderr dumps never interleave, deterministically', () => {
    const box = makeBox({
      units: [churn(A), stable(B, 1), churn(C)],
      journalGate: { unit: A, line: `--user status --no-pager --lines=0 ${C}` },
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    const iC = r.stderr.indexOf(`## DEPLOY FAILED — ${C}`);
    const iA = r.stderr.indexOf(`fixture journal line for ${A}`);
    expect(iC, ctx(r)).toBeGreaterThan(-1);
    expect(iA).toBeGreaterThan(-1);
    expect(iA).toBeLessThan(iC);
    noPoison(box);
  }, 60_000);

  describe('W11 the scratch dir is removed, and nothing outlives the run (T-1)', () => {
    itLinux('(a) removed before the sweep returns', () => {
      const box = makeBox({ units: [stable(A, 0), stable(B, 1), stable(C, 2)] });
      const r = runSweep(box, { tail: 'ls -A "$TMPDIR" > "$HOME/tmp-after"' });
      expect(r.code, ctx(r)).toBe(0);
      expect(readFileSync(join(box.home, 'tmp-after'), 'utf8')).toBe('');
      noPoison(box);
    }, 60_000);

    itLinux('(b) removed by the exit chain on the die', () => {
      const box = makeBox({ units: [churn(A)] });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(readdirSync(join(box.home, 'tmp'))).toEqual([]);
      noPoison(box);
    }, 60_000);

    itLinux('(c) a killed sweep leaves no job and no scratch dir', () => {
      const box = makeBox({
        units: [stable(A, 0), stable(B, 1)],
        gates: [{ unit: A, call: 2, until: { unit: 'claude-session@demo-z.service', isActive: 1 }, boundTenths: 100, onTimeout: 'answer' }],
      });
      const r = runSweep(box, { timeout: 3_000, killSignal: 'SIGTERM' });
      // Collect, reap, assert (T-1): the reap runs before any expect that can throw.
      const { found, left } = collect(box);
      expect(r.code, 'the spawn was killed by its timeout').toBe(-1);
      expect(left.filter((n) => n.startsWith('ccrc-sweep.')), `left in tmp: ${left.join(' ')}`).toEqual([]);
      expect(found, `survivors: ${found.join(' ')}`).toEqual([]);
      noPoison(box);
    }, 60_000);
  });

  itLinux('W12 no scratch dir: today\'s calls, one at a time, re-check included (P5)', () => {
    const box = makeBox({
      tmpdir: 'file',
      units: [stable(A, 0), { unit: B, ...ACTIVATING }],
      gates: [{ unit: A, call: 2, until: { unit: B, isActive: 1 }, boundTenths: 30, onTimeout: 'answer' }],
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).toContain('update: warning: no scratch directory for the verify');
    expect(r.stderr).toContain(`re-check: ${B} passed its re-check`);
    // From the `--state=active` listing onward: the KillMode preflight names every unit first (attack T-6).
    const cs = calls(box);
    const tail = cs.slice(cs.indexOf(LIST_ACTIVE));
    const firstB = tail.findIndex((l) => l === act(B));
    let lastA = -1;
    tail.forEach((l, i) => { if (l === act(A) || l === pidCall(A)) lastA = i; });
    expect(firstB).toBeGreaterThan(-1);
    expect(lastA).toBeGreaterThan(-1);
    expect(firstB, 'demo-b\'s first call comes after demo-a\'s last').toBeGreaterThan(lastA);
    noPoison(box);
  }, 60_000);

  describe('W13 an unrecorded rc is never a verdict (D-3972 d; Reading 18)', () => {
    const body = (exit: number): string => [
      'printf \'%s\\n\' "$1" >> "$HOME/fixture-calls"',
      'out="$(readlink "/proc/$$/fd/1" 2>/dev/null || true)"',
      'case "$out" in',
      '  */ccrc-sweep.*/*.out) mkdir -p "${out%.out}.rc"; exit 0 ;;',
      'esac',
      'echo "verified: $1 (foreground)"',
      `exit ${exit}`,
    ].join('\n');

    itLinux('(a) the foreground first verify passes: no re-check', () => {
      const box = makeBox({ units: [stable(A, 0)], verifySrc: fixtureScript('v13a.sh', body(0)) });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(fixtureCalls(box).length, ctx(r)).toBe(2);
      expect(r.stderr).toContain('recorded no result; verifying it alone, in the foreground');
      expect(r.stderr).not.toContain(RECHECK);
      noPoison(box);
    }, 60_000);

    itLinux('(b) it fails: the same re-check, then the die', () => {
      const box = makeBox({ units: [stable(A, 0)], verifySrc: fixtureScript('v13b.sh', body(1)) });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(fixtureCalls(box).length, ctx(r)).toBe(3);
      expect(r.stderr).toContain('1 of 1');
      noPoison(box);
    }, 60_000);
  });

  itLinux.each([['activating at the second read', ACTIVATING], ['a new MainPID at the second read', NEWPID]] as const)(
    'W14 the recorded 22:06 shape passes on the re-check: %s', (_n, row) => {
      const box = makeBox({ units: [stable(A, 0), { unit: B, active: [...row.active], mainPid: [...row.mainPid] }, stable(C, 2)] });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stdout).toContain(SWEEP_OK);
      expect(r.stderr).toContain(`${RECHECK} ${B} — its first verify did not pass`);
      expect(r.stderr).toContain(`${RECHECK} ${B} passed its re-check — counted as a transient failure, not fatal`);
      expect(count(box, act(B))).toBe(4);
      noPoison(box);
    }, 60_000);

  itLinux('W15 a build that crash-loops every unit makes exactly ONE re-check call, then dies (Reading 17)', () => {
    const box = makeBox({ units: [churn(A), churn(B), churn(C)] });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    expect(lines(r.stderr, 'verifying it once more, alone')).toBe(1);
    expect(lines(r.stderr, 'failed its re-check too')).toBe(1);
    expect(lines(r.stderr, 'failed its first verify and is not re-checked')).toBe(2);
    expect(count(box, pidCall(A))).toBe(4);
    expect(count(box, pidCall(B))).toBe(2);
    expect(count(box, pidCall(C))).toBe(2);
    expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(3, 3, 2, A));
    noPoison(box);
  }, 60_000);

  itLinux('W16 a non-crash-like failure is not re-checked (D-3983)', () => {
    const script = fixtureScript('v16.sh', [
      'printf \'%s\\n\' "$1" >> "$HOME/fixture-calls"',
      'echo "stopped on purpose: $1 (fixture)"',
      'exit 1',
    ].join('\n'));
    const box = makeBox({ units: [stable(A, 0)], verifySrc: script });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    expect(fixtureCalls(box)).toEqual([A]);
    expect(r.stderr).not.toContain(RECHECK);
    noPoison(box);
  }, 60_000);

  itLinux('W17 crash-shaped units are verified, with the re-check (D-3984)', () => {
    const box = makeBox({
      units: [
        { unit: A, active: ['activating'], mainPid: [], listed: 'crash:activating' },
        { unit: B, active: ['failed'], mainPid: [], listed: 'crash:failed' },
        { unit: C, active: ['activating'], mainPid: [], listed: 'crash:activating' },
      ],
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    expect(r.stderr).toContain(`${A} was active before try-restart and reads 'activating' after it`);
    expect(r.stderr).toContain(`${B} was active before try-restart and reads 'failed' after it`);
    expect(r.stderr).toContain(`${C} was active before try-restart and reads 'activating' after it`);
    expect(lines(r.stderr, 'verifying it once more, alone')).toBe(1);
    expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(3, 3, 2, A));
    expect(count(box, LIST_CRASH)).toBe(1);
    noPoison(box);
  }, 60_000);

  itLinux('W17b a unit inactive after the restart keeps item G\'s warning', () => {
    const box = makeBox({
      units: [stable(A, 0), { unit: B, active: ['inactive'], mainPid: [], listed: 'gone' }],
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).toContain(`${B} was active before try-restart and is not active after it`);
    expect(r.stdout).toContain(SWEEP_OK);
    expect(count(box, LIST_CRASH)).toBe(1);
    expect(count(box, act(B))).toBe(0);
    noPoison(box);
  }, 60_000);

  itLinux('W17c the crash listing cannot be read: one pinned line, then today\'s warnings (Reading 19)', () => {
    const box = makeBox({
      units: [stable(A, 0), { unit: B, active: ['activating'], mainPid: [], listed: 'crash:activating' }],
      crashListingRc: 94,
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    const pinned = 'update: warning: the crash listing was not measured (systemctl --user list-units '
      + '"claude-session@*" --state=activating,failed --plain --no-legend failed, rc 94), so a crash-looping '
      + 'supervisor among the units missing from the active listing is only warned about below — none of them is '
      + 'verified or claimed healthy';
    const iPinned = r.stderr.indexOf(pinned);
    expect(iPinned, ctx(r)).toBeGreaterThan(-1);
    const iG = r.stderr.indexOf(`${B} was active before try-restart and is not active after it`);
    expect(iG).toBeGreaterThan(iPinned);
    expect(count(box, act(B))).toBe(0);
    noPoison(box);
  }, 60_000);

  itLinux('W17d nothing missing: no crash listing', () => {
    const box = makeBox({ units: [stable(A, 0), stable(B, 1), stable(C, 2)] });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(calls(box).filter((l) => l.includes('--state=activating,failed'))).toEqual([]);
    noPoison(box);
  }, 60_000);

  // A copy of the launcher that starts only unit `$3`'s job, prints a fork error and exits 254 (W18, W20 (a)).
  const launcherCopy = (wait: boolean): string => [
    '_upd_sweep_launch() {',
    '  local vdir="$1" verify="$2" k',
    '  set -m',
    '  k=$3',
    '  { bash "$verify" "${units[k]}" </dev/null >"$vdir/$k.out" 2>"$vdir/$k.err"; printf \'%s\\n\' "$?" >"$vdir/$k.rc"; } </dev/null >/dev/null 2>&1 &',
    '  printf \'%s\\n\' "$!" >"$vdir/$k.pid"',
    wait ? '  wait' : '  :',
    '  echo "fork: Resource temporarily unavailable" >&2',
    '  exit 254',
    '}',
  ].join('\n');

  itLinux('W18 a failed launch cannot end the run (P1)', () => {
    const box = makeBox({ units: [stable(A, 0), stable(B, 1), stable(C, 2)] });
    const r = runSweep(box, { pre: launcherCopy(true) });
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).toContain('update: warning: the verify launcher exited 254');
    expect(lines(r.stderr, 'recorded no result; verifying it alone, in the foreground')).toBe(2);
    expect(r.stderr).not.toContain(RECHECK);
    expect(r.stdout).toContain(SWEEP_OK);
    noPoison(box);
  }, 60_000);

  itLinux('W18b a never-started unit gets the same re-check (Reading 18)', () => {
    const box = makeBox({ units: [stable(A, 0), { unit: B, ...ACTIVATING }, stable(C, 2)] });
    const r = runSweep(box, { pre: launcherCopy(true) });
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).toContain(`re-check: ${B} passed its re-check`);
    noPoison(box);
  }, 60_000);

  itLinux('W19 stale scratch dirs are removed, a live owner\'s and an ownerless one are not (P4)', () => {
    const box = makeBox({ units: [stable(A, 0)] });
    const tmp = join(box.home, 'tmp');
    const gone = spawnSync('true', [], { encoding: 'utf8' }).pid;
    mkdirSync(join(tmp, 'ccrc-sweep.STALE1'));
    writeFileSync(join(tmp, 'ccrc-sweep.STALE1', 'owner'), `${gone}\n`);
    mkdirSync(join(tmp, 'ccrc-sweep.LIVE1'));
    writeFileSync(join(tmp, 'ccrc-sweep.LIVE1', 'owner'), `${process.pid}\n`);
    mkdirSync(join(tmp, 'ccrc-sweep.NOOWNER'));
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(readdirSync(tmp).sort()).toEqual(['ccrc-sweep.LIVE1', 'ccrc-sweep.NOOWNER']);
    noPoison(box);
  }, 60_000);

  describe('W20 each job\'s group is signalled at most once, and never after its chunk was read (verify L1)', () => {
    const killShadow = 'kill() { case "$1" in -TERM) printf \'%s\\n\' "$*" >> "$HOME/kill-log" ;; esac; builtin kill "$@"; }';

    itLinux('(a) the launcher\'s kill is the only signal the group gets', () => {
      const box = makeBox({
        units: [stable(A, 0), stable(B, 1), stable(C, 2)],
        gates: [{ unit: A, call: 2, until: { unit: 'claude-session@demo-z.service', isActive: 1 }, boundTenths: 100, onTimeout: 'answer' }],
      });
      const pre = [
        killShadow,
        launcherCopy(false),
        '_upd_sweep_replay() { case "$1" in */launch.err) builtin kill -TERM $$ ;; esac; return 0; }',
      ].join('\n');
      const t0 = Date.now();
      const r = runSweep(box, { pre, timeout: 30_000 });
      const elapsed = Date.now() - t0;
      const { found, left } = collect(box);
      // A bash ended by an unhandled SIGTERM has no exit status (code -1 here): the evidence that it ended on its OWN
      // signal and not on the spawn timeout is the clock — the gate alone would hold it 10 s.
      expect(r.code, 'the sweep ends on its own SIGTERM').toBe(-1);
      expect(elapsed, 'well inside the spawn timeout').toBeLessThan(20_000);
      expect(r.stdout).not.toContain(SWEEP_OK);
      expect(left.filter((n) => n.startsWith('ccrc-sweep.')), `left in tmp: ${left.join(' ')}`).toEqual([]);
      expect(found, `survivors: ${found.join(' ')}`).toEqual([]);
      const log = killLog(box);
      expect(log.length, `kill-log: ${log.join(' | ')}`).toBe(1);
      expect(log[0]).toMatch(/^-TERM -- -\d+$/);
      noPoison(box);
    }, 60_000);

    itLinux('(b) no signal after the chunk was read', () => {
      const script = fixtureScript('v20b.sh', [
        'printf \'%s\\n\' "$1" >> "$HOME/fixture-calls"',
        'out="$(readlink "/proc/$$/fd/1" 2>/dev/null || true)"',
        'case "$out" in',
        '  */ccrc-sweep.*/*.out) ln -s "$HOME/no-such-dir/rc" "${out%.out}.rc"; exit 0 ;;',
        'esac',
        'kill -TERM "$PPID"',
        'exit 1',
      ].join('\n'));
      const box = makeBox({ units: [stable(A, 0)], verifySrc: script });
      const t0 = Date.now();
      const r = runSweep(box, { pre: killShadow, timeout: 30_000 });
      const elapsed = Date.now() - t0;
      const { found, left } = collect(box);
      expect(r.code, 'the sweep ends on the SIGTERM the foreground call sent it').toBe(-1);
      expect(elapsed, 'well inside the spawn timeout').toBeLessThan(20_000);
      expect(left.filter((n) => n.startsWith('ccrc-sweep.')), `left in tmp: ${left.join(' ')}`).toEqual([]);
      expect(found, `survivors: ${found.join(' ')}`).toEqual([]);
      expect(fixtureCalls(box).length).toBe(2);
      expect(killLog(box)).toEqual([]);
      noPoison(box);
    }, 60_000);
  });
});

/** Spawn the sweep as the leader of a process group of its own, so a case can signal the GROUP as a terminal does. */
function spawnGroup(box: Box, o: Parameters<typeof sweepSpawn>[1]): {
  pid: number; done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>;
} {
  const { args, env } = sweepSpawn(box, o);
  const c = spawn(BASH, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  c.stdout!.on('data', (d: Buffer) => { stdout += d.toString('latin1'); });
  c.stderr!.on('data', () => { /* drained */ });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>((res) => {
    c.on('close', (code, signal) => res({ code, signal, stdout }));
  });
  return { pid: c.pid!, done };
}
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('W21: a signal to the sweep\'s process group during a concurrent batch (D-3988; D-141: an operator\'s Ctrl-C must abort)', () => {
  const killShadow = 'kill() { case "$1" in -TERM) printf \'%s\\n\' "$*" >> "$HOME/kill-log" ;; esac; builtin kill "$@"; }';
  // `group` is a terminal's Ctrl-C (every process of the sweep's group); `shell` is a `kill -INT <pid>` of the sweep's
  // own shell alone, which the launcher subshell (its foreground child) never sees.
  itLinux.each([
    ['SIGINT', 'group', 130], ['SIGINT', 'shell', 130], ['SIGTERM', 'group', 143], ['SIGTERM', 'shell', 143],
  ] as const)(
    'W21: %s to the sweep\'s %s mid-batch ends the run by that signal, stops both jobs once each, leaves nothing', async (sig, target, status) => {
      const script = fixtureScript('v21.sh', [
        'printf \'%s\\n\' "$1" >> "$HOME/fixture-calls"',
        'sleep 20',
        'echo "verified: $1"',
      ].join('\n'));
      const box = makeBox({ units: [stable(A, 0), stable(B, 1)], verifySrc: script });
      const g = spawnGroup(box, { pre: killShadow });
      let ended: { code: number | null; signal: NodeJS.Signals | null; stdout: string } | null = null;
      let elapsed = -1;
      try {
        for (let i = 0; i < 150 && fixtureCalls(box).length < 2; i++) await sleepMs(100);
        const started = fixtureCalls(box).length;
        await sleepMs(300);
        const t0 = Date.now();
        try { process.kill(target === 'group' ? -g.pid : g.pid, sig); } catch { /* already gone: the assertions say so */ }
        ended = await Promise.race([g.done, sleepMs(15_000).then(() => null)]);
        elapsed = Date.now() - t0;
        expect(started, 'both jobs were running when the signal was sent').toBe(2);
      } finally {
        // Collect, reap, assert (T-1): the sweep itself (a red run) is HOME-tagged too, so the reap ends it.
        try { process.kill(-g.pid, 'SIGKILL'); } catch { /* gone */ }
        var after = collect(box);
      }
      const { found, left } = after;
      expect(ended, 'the sweep ended on its own, within 15 s').not.toBeNull();
      expect(ended!.signal === sig || ended!.code === status,
        `ended by ${sig}: signal ${ended!.signal}, code ${ended!.code}`).toBe(true);
      expect(elapsed, 'within about a second of the signal').toBeLessThan(5_000);
      expect(ended!.stdout).not.toContain(SWEEP_OK);
      expect(left.filter((n) => n.startsWith('ccrc-sweep.')), `left in tmp: ${left.join(' ')}`).toEqual([]);
      expect(found, `survivors: ${found.join(' ')}`).toEqual([]);
      // The jobs' groups are TERMed through `_upd_sweep_kill`, each once; the INT handler's own TERM of the launcher
      // (a plain pid, no group) is the only other line there may be.
      const log = killLog(box);
      const groups = log.filter((l) => l.startsWith('-TERM -- -'));
      expect(groups.length, `kill-log: ${log.join(' | ')}`).toBe(2);
      expect(new Set(groups).size, 'each job group is signalled once').toBe(2);
      for (const l of groups) expect(l).toMatch(/^-TERM -- -\d+$/);
      // An INT is handled by the sweep's own trap, which stops the launcher (one TERM, by pid); a TERM has no handler.
      const byPid = log.filter((x) => !x.startsWith('-TERM -- -'));
      expect(byPid.length, `the INT handler stops the launcher once, a TERM does not: ${byPid.join(' | ')}`)
        .toBe(sig === 'SIGINT' ? 1 : 0);
      for (const l of byPid) expect(l, 'the launcher, by pid').toMatch(/^-TERM \d+$/);
      noPoison(box);
    }, 60_000);
});


describe('_upd_sweep, Linux arm, with the FROZEN wave-10 script S0 (a rollback pairs this sweep with an older script)', () => {
  const s0 = (): string => readFileSync(FROZEN_VERIFY_S0, 'utf8');

  itLinux('R0 the frozen S0 is v0.0.79\'s script', () => {
    const text = s0();
    expect(sha256(text)).toBe('fae9a23fc312a8f11b782e976a7fdca934e47401d39c9feb21f055513dfcdcd3');
    expect(text.split('\n').length - 1).toBe(107);
    expect(text).not.toContain('stopped_on_purpose');
  }, 60_000);

  itLinux('R1 every unit is verified with S0 (the critic\'s B2)', () => {
    const box = makeBox({ units: [stable(A, 0), churn(B)], verifySrc: FROZEN_VERIFY_S0 });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    expect(count(box, pidCall(B))).toBe(4);
    expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
    expect(r.stderr, 'each unit has a job of its own').not.toContain('recorded no result');
    noPoison(box);
  }, 60_000);

  itLinux('R2 a stop still down at its re-check fails with S0 (no classifier before wave 10)', () => {
    const box = makeBox({
      units: [stable(A, 0), { unit: B, active: ['active', 'inactive'], mainPid: ['5151'] }],
      registry: { 'demo-b.uuid': 'u2\n', 'demo-b.stopped': `${STAMP}\n` },
      verifySrc: FROZEN_VERIFY_S0,
    });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(1);
    expect(r.stderr).toContain('ccrc: sweep: 1 of 2 supervisors did not stay up on a first verify');
    noPoison(box);
  }, 60_000);

  itLinux('R3 the re-check works with an older script', () => {
    const box = makeBox({ units: [stable(A, 0), { unit: B, ...ACTIVATING }], verifySrc: FROZEN_VERIFY_S0 });
    const r = runSweep(box);
    expect(r.code, ctx(r)).toBe(0);
    expect(r.stderr).toContain(`re-check: ${B} passed its re-check`);
    noPoison(box);
  }, 60_000);
});
