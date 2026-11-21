// Doctor's `quiz-weekly` check (Overlord W1a): the EFFECT of the weekly replay quiz's timer, read from the record its runner
// rewrites every tick (`~/.ccrc/quiz/unattended.json`, its `last` block) and never written. Absent PASSes (no tick yet); a
// record that is not JSON or not the runner's kind WARNs unreadable; a refused or failed last tick WARNs naming its week, act,
// word and detail (cut to 200 characters); a last tick older than a run plus two ticks (24 h) WARNs stale; a good one PASSes
// naming the week and its state; it SKIPs on a server-role box and answers PASS on Darwin, where no record exists. Fixture HOMEs only (`healthy()`); the check runs
// alone, sourced, as the pane-scope-stop suite runs its own.
import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

function box(prefix: string, o: { record?: string; env?: string[] } = {}): string {
  const home = healthy(prefix);
  if (o.env) appendFileSync(join(home, '.ccrc', 'ccrc.env'), o.env.map((l) => `${l}\n`).join(''));
  if (o.record !== undefined) {
    mkdirSync(join(home, '.ccrc', 'quiz'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'quiz', 'unattended.json'), o.record);
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

  it('WARN unreadable for a record that is not JSON, not the runner\'s kind, or has no readable tick time', () => {
    for (const [tag, record] of [
      ['text', 'not json at all'],
      ['kind', JSON.stringify({ kind: 'something-else', v: 1, last: last() })],
      ['nolast', JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 1, weeks: {}, last: null })],
      ['atms', state(last({ at_ms: 'soon' as unknown as number }))],
    ] as const) {
      const r = check(box(`ccrc-doctor-qw-bad-${tag}-`, { record }));
      expect(r.code, tag).toBe(2);
      expect(r.out[0], tag).toMatch(/^WARN quiz-weekly: the record at .*unattended\.json is not JSON or not a ccrc-quiz-unattended-state record, so the last unattended run cannot be read$/);
      expect(r.out[1], tag).toBe('  remedy: let the runner rewrite it: systemctl --user start ccd-quiz-weekly.service; then re-run doctor');
    }
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

  it('WARN stale for a last tick older than 24 h, even when it was ok', () => {
    const r = check(box('ccrc-doctor-qw-stale-', { record: state(last({ at_ms: Date.now() - 30 * HOUR })) }));
    expect(r.code).toBe(2);
    expect(r.out[0]).toMatch(/^WARN quiz-weekly: the last unattended quiz tick was 30 h ago, more than a run plus two ticks \(24 h\), so the timer has stopped or a run is stuck$/);
    expect(r.out[1]).toBe('  remedy: systemctl --user status ccd-quiz-weekly.timer ccd-quiz-weekly.service; journalctl --user -u ccd-quiz-weekly.service');
    // 23 h is still inside the bound
    expect(check(box('ccrc-doctor-qw-fresh-', { record: state(last({ at_ms: Date.now() - 23 * HOUR })) })).code).toBe(0);
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
