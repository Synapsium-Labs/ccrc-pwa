// D-8122: the update sweep restarts the supervisors in batches. `_upd_sweep` (ccd/ccrc, the Linux arm) lists the units
// once, keeps the KillMode preflight over the whole listing, then try-restarts the running units CCRC_SWEEP_BATCH at a
// time (default 5), verifying each batch before the next; between batches it waits while
// `$CCRC_PROC_ROOT/pressure/memory` reads `full avg10` at or above the CCRC_WAKE_PRESSURE_GATE level, for at most
// CCRC_SWEEP_PRESSURE_WAIT_S over the sweep, then goes on with a warning. A fixture fleet of 30 stub units.
//
// SAFETY: `sweepFixture.ts`'s box: a fixture HOME, an env built from scratch, every tool not a stub a poison, and the
// containment proof before each spawn. The wait's `sleep` is shadowed (`_upd_sweep_sleep`), so no case waits for real.
// Neutral names only (public repository).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SWEEP_OK, calls, makeBox, poisonFiles, runSweep, type UnitPlant } from './sweepFixture.js';
import { PSI_CRITICAL_FULL_PCT, PSI_WARN_FULL_PCT } from '../../shared/pressure.js';

const unit = (i: number): string => `claude-session@lane-a-basin-${String(i).padStart(2, '0')}.service`;
const UNITS = Array.from({ length: 30 }, (_, i) => unit(i));
const healthy = (u: string): UnitPlant => ({ unit: u, active: ['active'], mainPid: ['4242'] });
const psi = (full: number): string =>
  `some avg10=${full.toFixed(2)} avg60=1.00 avg300=1.00 total=1\nfull avg10=${full.toFixed(2)} avg60=1.00 avg300=1.00 total=1\n`;
/** The sleep seam, counted: each call appends a line to `$HOME/slept`, and (when `then` is given) rewrites the pressure
 *  file, so a wait can end. */
const sleepSeam = (then?: string): string =>
  `_upd_sweep_sleep() { echo "$1" >> "$HOME/slept"; ${then === undefined ? ':' : `printf '%s' '${then}' > "$CCRC_PROC_ROOT/pressure/memory"`}; }`;
const slept = (home: string): string[] =>
  (existsSync(join(home, 'slept')) ? readFileSync(join(home, 'slept'), 'utf8').split('\n').filter((l) => l !== '') : []);
const restarts = (c: string[]): string[][] =>
  c.filter((l) => l.startsWith('--user try-restart ')).map((l) => l.slice('--user try-restart '.length).split(' '));

describe('the update sweep restarts in batches (D-8122)', () => {
  it('30 running units: six try-restarts of five, in listing order, never the glob; each batch verified before the next', () => {
    const box = makeBox({ units: UNITS.map(healthy), batch: null });
    const r = runSweep(box, { timeout: 120_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(SWEEP_OK);
    const c = calls(box);
    expect(c).not.toContain('--user try-restart claude-session@*');
    const got = restarts(c);
    expect(got).toEqual([0, 5, 10, 15, 20, 25].map((s) => UNITS.slice(s, s + 5)));
    // The preflight covered the full listing before the first restart.
    const first = c.findIndex((l) => l.startsWith('--user try-restart '));
    for (const u of UNITS) expect(c.indexOf(`--user show -p KillMode ${u}`), u).toBeLessThan(first);
    // Verify-per-batch: every unit of batch k is asked `is-active` before batch k+1 is restarted, and none of batch
    // k+1 is asked before its own restart.
    const at = c.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('--user try-restart ')).map(([, i]) => i);
    for (let k = 0; k < 6; k++) {
      const lo = at[k]!;
      const hi = k + 1 < 6 ? at[k + 1]! : c.length;
      for (const u of got[k]!) {
        const asked = c.map((l, i) => [l, i] as const).filter(([l]) => l === `--user is-active ${u}`).map(([, i]) => i);
        expect(asked.length, u).toBeGreaterThan(0);
        expect(asked.every((i) => i > lo && i < hi), `${u} is verified inside its own batch`).toBe(true);
      }
    }
    expect(r.stderr).toContain('update: sweep: batch 1 of 6: restarting 5 supervisor(s)');
    expect(r.stderr).toContain('update: sweep: batch 6 of 6: restarting 5 supervisor(s)');
    expect(poisonFiles(box)).toEqual([]);
  });

  it('CCRC_SWEEP_BATCH sizes the batches; the last takes the remainder', () => {
    const box = makeBox({ units: UNITS.slice(0, 12).map(healthy), batch: 4 });
    const r = runSweep(box, { timeout: 120_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(restarts(calls(box)).map((b) => b.length)).toEqual([4, 4, 4]);
    const odd = makeBox({ units: UNITS.slice(0, 7).map(healthy), batch: null });
    expect(runSweep(odd, { timeout: 120_000 }).code).toBe(0);
    expect(restarts(calls(odd)).map((b) => b.length)).toEqual([5, 2]);
  });

  it('a value the setting does not take keeps the default of 5 and says so', () => {
    const box = makeBox({ units: UNITS.slice(0, 10).map(healthy), batch: null });
    const r = runSweep(box, { timeout: 120_000, env: { CCRC_SWEEP_BATCH: '0' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('update: warning: CCRC_SWEEP_BATCH must be a whole number from 1 to 999 (from environment) — the sweep restarts 5 supervisors at a time');
    expect(restarts(calls(box)).map((b) => b.length)).toEqual([5, 5]);
  });

  it('pressure at the warn level waits between batches, polling, and goes on once it eases', () => {
    const box = makeBox({ units: UNITS.map(healthy), batch: null, psi: psi(PSI_WARN_FULL_PCT) });
    const r = runSweep(box, { timeout: 120_000, pre: sleepSeam(psi(0)) });
    expect(r.code, r.stderr).toBe(0);
    expect(slept(box.home), 'one poll, after which the file reads calm').toEqual(['5']);
    expect(r.stderr).toContain(`update: sweep: memory pressure (full avg10) is at or above ${PSI_WARN_FULL_PCT}% — waiting before the next batch, at most 300s over the sweep (D-8122)`);
    expect(restarts(calls(box))).toHaveLength(6);
  });

  it('one batch never waits: the wait is only BETWEEN batches', () => {
    const box = makeBox({ units: UNITS.slice(0, 5).map(healthy), batch: null, psi: psi(90) });
    expect(runSweep(box, { timeout: 120_000, pre: sleepSeam() }).code).toBe(0);
    expect(slept(box.home)).toEqual([]);
  });

  it('the wait is bounded over the whole sweep: past CCRC_SWEEP_PRESSURE_WAIT_S it warns once and never waits again', () => {
    const box = makeBox({ units: UNITS.map(healthy), batch: null, psi: psi(90) });
    const r = runSweep(box, { timeout: 120_000, pre: sleepSeam(), env: { CCRC_SWEEP_PRESSURE_WAIT_S: '20' } });
    expect(r.code, r.stderr).toBe(0);
    expect(slept(box.home)).toEqual(['5', '5', '5', '5']);
    const warned = r.stderr.split('\n').filter((l) => l.includes('the next batches are restarted without waiting'));
    expect(warned).toEqual([`update: warning: sweep: memory pressure (full avg10) is still at or above ${PSI_WARN_FULL_PCT}% after 20s of waiting (CCRC_SWEEP_PRESSURE_WAIT_S) — the next batches are restarted without waiting, so the update does not hang (D-8122)`]);
    expect(restarts(calls(box)), 'every batch is still restarted').toHaveLength(6);
    expect(r.stdout).toContain(SWEEP_OK);
  });

  it('critical waits only at its own level; off never waits; no pressure file never waits', () => {
    const crit = makeBox({ units: UNITS.slice(0, 10).map(healthy), batch: null, psi: psi(PSI_CRITICAL_FULL_PCT - 1) });
    expect(runSweep(crit, { timeout: 120_000, pre: sleepSeam(), env: { CCRC_WAKE_PRESSURE_GATE: 'critical' } }).code).toBe(0);
    expect(slept(crit.home)).toEqual([]);
    const off = makeBox({ units: UNITS.slice(0, 10).map(healthy), batch: null, psi: psi(99) });
    expect(runSweep(off, { timeout: 120_000, pre: sleepSeam(), env: { CCRC_WAKE_PRESSURE_GATE: 'off' } }).code).toBe(0);
    expect(slept(off.home)).toEqual([]);
    const none = makeBox({ units: UNITS.slice(0, 10).map(healthy), batch: null });
    expect(runSweep(none, { timeout: 120_000, pre: sleepSeam() }).code).toBe(0);
    expect(slept(none.home)).toEqual([]);
    expect(restarts(calls(none))).toHaveLength(2);
  });

  it('a batch that fails its verify stops the sweep: the later batches are never restarted, and the update fails', () => {
    const units = UNITS.map(healthy);
    units[7] = { unit: UNITS[7]!, active: ['failed'], mainPid: ['4242'] };
    const box = makeBox({ units, batch: null });
    const r = runSweep(box, { timeout: 120_000 });
    expect(r.code).not.toBe(0);
    expect(restarts(calls(box)), 'batches 1 and 2 only').toEqual([UNITS.slice(0, 5), UNITS.slice(5, 10)]);
    expect(r.stderr).toContain('update: warning: sweep: a batch did not verify, so the next 20 supervisor(s) were not restarted and keep running the PREVIOUS ccd (D-8122)');
    expect(r.stdout).not.toContain(SWEEP_OK);
    expect(r.stderr, 'a unit never restarted is not called unverified').not.toContain(`${UNITS[12]} was active before try-restart`);
  });

  it('five or fewer running units are one batch, with no batch line', () => {
    const box = makeBox({ units: UNITS.slice(0, 5).map(healthy), batch: null });
    const r = runSweep(box, { timeout: 120_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(restarts(calls(box))).toEqual([UNITS.slice(0, 5)]);
    expect(r.stderr).not.toContain('update: sweep: batch ');
  });
});
