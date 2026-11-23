// Doctor's `quiz-weekly` check (Overlord W1a): the EFFECT of the weekly replay quiz's timer, read from the record its runner
// rewrites every tick (`~/.ccrc/quiz/unattended.json`, its `last` block) and never written. A record that is not JSON or not the
// runner's kind WARNs unreadable; a refused or failed last tick WARNs naming its week, act, word and detail (cut to 200
// characters); a good one PASSes naming the week and its state; it SKIPs on a server-role box and answers PASS on Darwin, where no
// record exists. Run 3508, ruling (e): a starved trigger is said in words. With no run in flight (the runner's lock names no live
// pid), a last tick older than two of the shipped timer's periods (12 h) WARNs that the timer is not firing, and so does no record
// at all once the installed timer unit is older than that; with a run in flight the bound is a run plus two ticks (24 h), past
// which the run is stuck. Fixture HOMEs only (`healthy()`); the check runs alone, sourced, as the pane-scope-stop suite runs its own.
import { describe, expect, it } from 'vitest';
import { appendFileSync, chmodSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnSyncGroup } from './spawnGroup.js';
import { writeShippedTimer } from './shippedTimers.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, runDoctor, shq } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const HOUR = 3_600_000;
const SKIP_LINE = 'SKIP quiz-weekly: this box records CCRC_ROLE=server, so it keeps no history store and runs no weekly replay quiz';
interface Last { at_ms: number; week: string | null; act: string; outcome: string; word: string | null; detail: string | null }
const state = (last: Last, weeks: Record<string, unknown> = { '2026-W47': { state: 'running', word: null } }): string =>
  JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 1, setup: null, weeks, last });
const last = (o: Partial<Last> = {}): Last =>
  ({ at_ms: Date.now() - 2 * HOUR, week: '2026-W47', act: 'arms', outcome: 'ok', word: null, detail: null, ...o });

/** A pid no process holds: a child that has already exited (its pid is not reused this soon). */
const deadPid = (): number => { const r = spawnSync('true'); expect(r.pid).toBeGreaterThan(0); return r.pid!; };

function box(prefix: string, o: { record?: string; env?: string[]; lockPid?: number; unitAgeMs?: number } = {}): string {
  const home = healthy(prefix);
  if (o.env) appendFileSync(join(home, '.ccrc', 'ccrc.env'), o.env.map((l) => `${l}\n`).join(''));
  if (o.record !== undefined || o.lockPid !== undefined) mkdirSync(join(home, '.ccrc', 'quiz'), { recursive: true });
  if (o.record !== undefined) writeFileSync(join(home, '.ccrc', 'quiz', 'unattended.json'), o.record);
  if (o.lockPid !== undefined) writeFileSync(join(home, '.ccrc', 'quiz', 'unattended.lock'), `${o.lockPid}\n`);
  if (o.unitAgeMs !== undefined) {   // the installed timer unit, placed that long ago
    const dir = join(home, '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'ccd-quiz-weekly.timer');
    writeFileSync(f, '[Timer]\nOnCalendar=*-*-* 00/6:17:00 UTC\n');
    const t = (Date.now() - o.unitAgeMs) / 1000;
    utimesSync(f, t, t);
  }
  return home;
}
function check(home: string, os = 'linux'): { out: string[]; code: number } {
  const r = spawnSyncGroup(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\nCCD_OS=${os}; _check_quiz-weekly`],
    { env: doctorEnv(home), encoding: 'utf8', timeout: 30_000 });
  const out = (r.stdout ?? '').split('\n');
  expect(out.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) quiz-weekly: /.test(l)), `a quiz-weekly line: ${r.stdout}${r.stderr}`).toBe(0);
  return { out, code: r.status ?? -1 };
}

describe('quiz-weekly: the weekly runner\'s record, read and never written (Overlord W1a)', () => {
  it('PASS when no record exists yet, and the check writes nothing', () => {
    const home = box('ccrc-doctor-qw-absent-');
    const r = check(home);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe(`PASS quiz-weekly: no unattended run recorded yet (${home}/.ccrc/quiz/unattended.json is absent), so the weekly replay quiz has not ticked here`);
    expect(r.out[1]).toBe('');
  });

  const MALFORMED_REMEDY = /^ {2}remedy: read why: journalctl --user -u ccd-quiz-weekly\.service; move the file aside, then systemctl --user start ccd-quiz-weekly\.service\. With no state file the runner starts a NEW setup even where a setup directory exists: it spends again and breaks week-to-week comparability$/;
  it('WARN malformed, by the runner\'s own verdict, for a record that is not JSON, not its kind or version, or has no readable tick time', () => {
    for (const [tag, record, why] of [
      ['text', 'not json at all', 'malformed not JSON'],
      ['torn', '{ "kind": "ccrc-quiz-unat', 'malformed not JSON'],
      ['kind', JSON.stringify({ kind: 'something-else', v: 1, setup: null, weeks: {}, last: last() }), 'malformed not a ccrc-quiz-unattended-state v1 file'],
      ['v2', JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 2, setup: null, weeks: {}, last: last() }), 'malformed not a ccrc-quiz-unattended-state v1 file'],
      ['nolast', JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 1, setup: null, weeks: {}, last: null }), 'malformed no-tick-time'],
      ['atms', state(last({ at_ms: 'soon' as unknown as number })), 'malformed no-tick-time'],
    ] as const) {
      const r = check(box(`ccrc-doctor-qw-bad-${tag}-`, { record }));
      expect(r.code, tag).toBe(2);
      expect(r.out[0], tag).toMatch(new RegExp(`^WARN quiz-weekly: the record at .*unattended\\.json is ${why} \\(the runner's own shape check\\), so the last unattended run cannot be read$`));
      expect(r.out[1], tag).toMatch(MALFORMED_REMEDY);
    }
  });

  it.skipIf(process.getuid?.() === 0)('WARN unreadable EACCES names the permission problem, not the move-aside remedy', () => {
    const home = box('ccrc-doctor-qw-eacces-', { record: state(last()) });
    const f = join(home, '.ccrc', 'quiz', 'unattended.json');
    chmodSync(f, 0o000);
    const r = check(home);
    chmodSync(f, 0o600);
    expect(r.code).toBe(2);
    expect(r.out[0]).toMatch(/^WARN quiz-weekly: the record at .*unattended\.json is unreadable EACCES \(the runner's own shape check\), so the last unattended run cannot be read$/);
    expect(r.out[1]).toBe('  remedy: the runner has no permission to read it: fix its owner or mode (chmod u+rw), then re-run doctor');
  });

  it('WARN for a refused or failed last tick, naming week, act, word and detail cut to 200 characters', () => {
    for (const outcome of ['refused', 'failed']) {
      const detail = `line one\ttab\nline two ${'x'.repeat(300)}`;
      const r = check(box(`ccrc-doctor-qw-${outcome}-`, { record: state(last({ outcome, act: 'arms', word: 'release-moved', detail })) }));
      expect(r.code, outcome).toBe(2);
      const want = detail.replace(/[\t\n]/g, ' ').slice(0, 200);
      expect(r.out[0], outcome).toBe(`WARN quiz-weekly: the last unattended quiz tick ${outcome}: week 2026-W47, act arms, word release-moved, detail: ${want}`);
      expect(r.out[0]!.length, outcome).toBeLessThan(400);
      expect(r.out[1], outcome).toMatch(/^ {2}remedy: read why: journalctl --user -u ccd-quiz-weekly\.service; /);
    }
  });

  const STARVED_REMEDY = '  remedy: systemctl --user list-timers ccd-quiz-weekly.timer (its NEXT and LAST); systemctl --user status ccd-quiz-weekly.timer; journalctl --user -u ccd-quiz-weekly.service';
  it('WARN starved for a last tick older than two periods (12 h) with no run in flight, even when it was ok (run 3508, ruling e)', () => {
    const r = check(box('ccrc-doctor-qw-starved-', { record: state(last({ at_ms: Date.now() - 13 * HOUR })) }));
    expect(r.code).toBe(2);
    expect(r.out[0]).toBe('WARN quiz-weekly: no unattended quiz tick for 13 h and no run is in flight, more than two of the timer\'s periods (12 h), so the timer is not firing: starved, stopped, or the box was down');
    expect(r.out[1]).toBe(STARVED_REMEDY);
    // 11 h is still inside the bound
    expect(check(box('ccrc-doctor-qw-fresh-', { record: state(last({ at_ms: Date.now() - 11 * HOUR })) })).code).toBe(0);
    // a lock whose pid is gone is no run in flight
    const dead = check(box('ccrc-doctor-qw-deadlock-', { record: state(last({ at_ms: Date.now() - 13 * HOUR })), lockPid: deadPid() }));
    expect(dead.code).toBe(2);
    expect(dead.out[0]).toMatch(/^WARN quiz-weekly: no unattended quiz tick for 13 h and no run is in flight/);
  });

  it('with a run in flight (the lock names a live pid), a long act is no starvation: WARN stuck only past a run plus two ticks (24 h)', () => {
    const r13 = check(box('ccrc-doctor-qw-flight13-', { record: state(last({ at_ms: Date.now() - 13 * HOUR })), lockPid: process.pid }));
    expect(r13.code).toBe(0);
    expect(r13.out[0]).toBe('PASS quiz-weekly: the last unattended quiz tick (arms, ok) was 13 h ago: week 2026-W47 is running; a run is in flight');
    expect(check(box('ccrc-doctor-qw-flight23-', { record: state(last({ at_ms: Date.now() - 23 * HOUR })), lockPid: process.pid })).code).toBe(0);
    const r30 = check(box('ccrc-doctor-qw-stuck-', { record: state(last({ at_ms: Date.now() - 30 * HOUR })), lockPid: process.pid }));
    expect(r30.code).toBe(2);
    expect(r30.out[0]).toBe('WARN quiz-weekly: a run is in flight and the last unattended quiz tick was 30 h ago, more than a run plus two ticks (24 h), so the run is stuck');
    expect(r30.out[1]).toBe('  remedy: systemctl --user status ccd-quiz-weekly.timer ccd-quiz-weekly.service; journalctl --user -u ccd-quiz-weekly.service');
  });

  it('no record, and the installed timer unit older than two periods with no run in flight: WARN the timer is not firing (run 3508, ruling e)', () => {
    const r = check(box('ccrc-doctor-qw-never-', { unitAgeMs: 13 * HOUR }));
    expect(r.code).toBe(2);
    expect(r.out[0]).toBe('WARN quiz-weekly: the quiz timer\'s unit was placed 13 h ago and no unattended tick is recorded, more than two of its periods (12 h), so the timer is not firing');
    expect(r.out[1]).toBe(STARVED_REMEDY);
    // a unit placed inside the bound, a first run in flight, or Darwin (no systemd unit) still PASS
    expect(check(box('ccrc-doctor-qw-newunit-', { unitAgeMs: 11 * HOUR })).out[0]).toMatch(/^PASS quiz-weekly: no unattended run recorded yet /);
    expect(check(box('ccrc-doctor-qw-firstrun-', { unitAgeMs: 13 * HOUR, lockPid: process.pid })).out[0]).toMatch(/^PASS quiz-weekly: no unattended run recorded yet /);
    expect(check(box('ccrc-doctor-qw-never-darwin-', { unitAgeMs: 13 * HOUR }), 'darwin').out[0]).toMatch(/^PASS quiz-weekly: no unattended run recorded yet /);
    // the bound is read from the shipped timer here too
    const home = box('ccrc-doctor-qw-never-notimer-', { unitAgeMs: 13 * HOUR });
    writeShippedTimer(join(home, 'ccrc'), 'ccd-quiz-weekly.timer', null);
    expect(check(home).out[0]).toMatch(/^WARN quiz-weekly: ccd-quiz-weekly\.timer's cadence could not be read from the shipped unit file \(.*\), so the starved-timer bound is unmeasured$/);
  });

  it('the stale bound is read from the shipped timer: a removed one is named, never a literal (D-7054)', () => {
    const home = box('ccrc-doctor-qw-notimer-', { record: state(last()) });
    writeShippedTimer(join(home, 'ccrc'), 'ccd-quiz-weekly.timer', null);
    const r = check(home);
    expect(r.code).toBe(2);
    expect(r.out[0]).toMatch(/^WARN quiz-weekly: ccd-quiz-weekly\.timer's cadence could not be read from the shipped unit file \(.*ccd-quiz-weekly\.timer\), so the stale bound is unmeasured$/);
    // a refused tick is reported without the bound: it needs no cadence
    expect(check(box('ccrc-doctor-qw-notimer2-', { record: state(last({ outcome: 'failed', word: 'w', detail: 'd' })) })).out[0]).toMatch(/^WARN quiz-weekly: the last unattended quiz tick failed/);
  });

  it('PASS for a good last tick, naming its act, outcome, age, week and the week\'s state', () => {
    const r = check(box('ccrc-doctor-qw-ok-', { record: state(last({ outcome: 'waiting', act: 'resume' }), { '2026-W47': { state: 'confirmed', word: null } }) }));
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe('PASS quiz-weekly: the last unattended quiz tick (resume, waiting) was 2 h ago: week 2026-W47 is confirmed');
    // a tick that belongs to no week names no state
    expect(check(box('ccrc-doctor-qw-noweek-', { record: state(last({ week: null, act: 'setup' })) })).out[0])
      .toBe('PASS quiz-weekly: the last unattended quiz tick (setup, ok) was 2 h ago: week - is -');
  });

  it('SKIP on a server-role box, a record notwithstanding', () => {
    const record = state(last({ outcome: 'failed', word: 'x', detail: 'y' }));
    expect(check(box('ccrc-doctor-qw-server-', { record, env: ['CCRC_ROLE=server'] }))).toEqual({
      out: [SKIP_LINE, ''], code: 3,
    });
  });

  it('on Darwin the timer is never installed, so with no record it answers OK, not SKIP', () => {
    const r = check(box('ccrc-doctor-qw-darwin-'), 'darwin');
    expect(r.code).toBe(0);
    expect(r.out[0]).toMatch(/^PASS quiz-weekly: no unattended run recorded yet /);
  });

  it('a full doctor run on the healthy fixture PASSes it with no record', () => {
    expect(anyVerdictFor(runDoctor(healthy('ccrc-doctor-qw-full-')).stdout, 'quiz-weekly')).toMatch(/^PASS quiz-weekly: no unattended run recorded yet/);
  });
});
