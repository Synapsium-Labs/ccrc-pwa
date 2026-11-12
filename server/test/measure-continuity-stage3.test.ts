// `deploy/measure-continuity.py --stage 3` (session-continuity wave 6a): the graceful stop's time by site and
// mode. READ-ONLY, reads swap.log; pinned as stage 7 is: the counts on a hand-built log, and the regex bound to
// a line the REAL `_graceful_stop_note` wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-s3-'); });
afterEach(() => { h.cleanup(); });

type Row = Record<string, number | string | Record<string, number | Record<string, number>>>;
const run = (extra: string[] = [], env: Record<string, string> = {}): Row => {
  const out = execFileSync('python3', ['-I', TOOL, '--home', h.home, '--stage', '3', ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return (JSON.parse(out) as { stage3: { graceful_stop: Row } }).stage3.graceful_stop;
};
const L = (stamp: string, id: string, site: string, mode: string, outcome: string): string =>
  `${stamp} graceful-stop ${id}: site=${site} mode=${mode} ${outcome}`;

describe('stage 3 reads the graceful-stop lines (TZ=UTC, hand-built log)', () => {
  it('stage 3 reads the graceful-stop lines by site and mode (TZ=UTC, hand-built log)', () => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, [
      L('2026-10-05 10:00:00', 's1', 'swap', 'shadow', 'exited=120'),
      L('2026-10-05 10:00:01', 's2', 'swap', 'shadow', 'exited=340'),
      L('2026-10-05 10:00:02', 's3', 'swap', 'shadow', 'exited=900'),
      L('2026-10-05 10:00:03', 's4', 'swap', 'shadow', 'alive=30000'),
      L('2026-10-05 10:00:04', 's5', 'limit-resume', 'live', 'exited=2500'),
      L('2026-10-05 10:00:05', 's6', 'hibernate', 'shadow', 'no-pid'),
      L('2026-10-05 10:00:06', 's7', 'hibernate', 'shadow', 'unmeasured=no-start-time'),
      L('2026-10-05 10:00:07', 's8', 'limit-resume', 'live', 'gone-before-signal'),
      L('2026-10-05 10:00:08', 's9', 'swap', 'shadow', 'exited=12ms'),   // malformed
      L('2026-10-04 09:00:00', 's0', 'swap', 'shadow', 'exited=7'),      // before --since
    ].join('\n') + '\n');
    const r = run(['--swap-log', log, '--since', '2026-10-05'], { TZ: 'UTC' });
    expect(r.stops).toBe(8);
    expect(r.by_site_mode).toEqual({
      'swap/shadow': { exited: 3, alive: 1, no_pid: 0, gone_before_signal: 0, unmeasured: 0 },
      'limit-resume/live': { exited: 1, alive: 0, no_pid: 0, gone_before_signal: 1, unmeasured: 0 },
      'hibernate/shadow': { exited: 0, alive: 0, no_pid: 1, gone_before_signal: 0, unmeasured: 1 } });
    expect(r.exit_ms).toEqual({ 'swap/shadow': { n: 3, p50: 340, p90: 900, p99: 900, max: 900 },
      'limit-resume/live': { n: 1, p50: 2500, p90: 2500, p99: 2500, max: 2500 } });
    expect(r.censored).toEqual({ 'swap/shadow': 1 });
    expect(r.unmeasured_by_why).toEqual({ 'no-start-time': 1 });
    expect(r.malformed_lines).toBe(1);
  });

  it('alive is censored, never an exit time', () => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, [
      L('2026-10-05 10:00:00', 's1', 'swap', 'live', 'alive=30000'),
      L('2026-10-05 10:00:01', 's2', 'swap', 'live', 'alive=30001'),
      L('2026-10-05 10:00:02', 's3', 'hibernate', 'live', 'unmeasured=stat-unreadable'),
    ].join('\n') + '\n');
    const r = run(['--swap-log', log, '--since', '2026-10-05'], { TZ: 'UTC' });
    expect(r.exit_ms).toEqual({});
    expect(r.censored).toEqual({ 'swap/live': 2 });
    expect(r.unmeasured_by_why).toEqual({ 'stat-unreadable': 1 });
  });

  it('no swap.log: the section says absent', () => {
    expect(run(['--swap-log', path.join(h.home, 'nope.log')])).toEqual({ swap_log: 'absent' });
  });
});

describe('the regex is bound to the line the real _graceful_stop_note writes', () => {
  it('a line the real _graceful_stop_note wrote is read', () => {
    h.sh('_graceful_stop_note lane-a-project-a swap shadow exited=42', { TZ: 'UTC' });
    const r = run([], { TZ: 'UTC' });
    expect((r.exit_ms as Record<string, unknown>)['swap/shadow']).toEqual({ n: 1, p50: 42, p90: 42, p99: 42, max: 42 });
    expect(r.malformed_lines).toBe(0);
  });
});
