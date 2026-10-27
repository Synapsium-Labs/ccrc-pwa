// `ccrc#_timer_period_s` and `ccrc#_timer_period_words` (W8 Task C8a, D-7053; ARCH-69 (#804), first half).
//
// The reader is the one place a shipped `.timer`'s period becomes a number of seconds: the ddns launchd job's
// `StartInterval` and its Darwin transcript come from it, and C8b's doctor checks will too. A CADENCE LINE is exactly an
// `OnUnitActiveSec=` or an `OnCalendar=` line; every other key is ignored, never refused, because 13 of the 14 shipped
// timers carry `OnBootSec=` or `OnActiveSec=` and `AccuracySec=` beside their period. The reader accepts exactly the
// spellings the shipped files use and refuses everything else (rc 1, one line on stderr, nothing on stdout); it never
// guesses a unit. Review focus 1 of the W8 plan is this file's subject: a cadence that changed on the way through a
// parser.
//
// The functions are reached by SOURCING `ccd/ccrc` (its `BASH_SOURCE` guard at the foot exists for this) under a
// throwaway HOME; nothing here runs a verb.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const UNITS = join(REPO, 'deploy', 'systemd');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

interface Answer { code: number; stdout: string; stderr: string }

/** `ccd/ccrc` sourced, then one call: `fn` with `args`. */
function call(fn: string, ...args: string[]): Answer {
  const home = mkTmp('ccrc-timer-period-');
  const r = spawnSync(BASH, ['-c', `. "$1"; shift; ${fn} "$@"`, 'bash', CCRC, ...args],
    { env: { ...process.env, HOME: home }, encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A `.timer` holding `lines` under the usual three sections, written to a fresh directory. */
function timer(...lines: string[]): string {
  const dir = mkTmp('ccrc-timer-file-');
  const f = join(dir, 'fixture.timer');
  writeFileSync(f, ['[Unit]', 'Description=a fixture timer', '[Timer]', ...lines, '[Install]', 'WantedBy=timers.target', ''].join('\n'));
  return f;
}

const period = (f: string): Answer => call('_timer_period_s', f);

/** rc 0, the whole seconds on stdout (one line), stderr silent. */
function expectPeriod(a: Answer, seconds: number): void {
  expect(a.stderr, 'a period read prints no why').toBe('');
  expect(a.code, a.stderr).toBe(0);
  expect(a.stdout.trim()).toBe(String(seconds));
  expect(a.stdout).toMatch(/^\d+\n?$/);
}

/** rc 1, exactly one line of why on stderr, nothing on stdout. */
function expectRefused(a: Answer): void {
  expect(a.code, a.stdout).toBe(1);
  expect(a.stdout, 'a refusal prints no period').toBe('');
  expect(a.stderr.trimEnd().split('\n'), a.stderr).toHaveLength(1);
  expect(a.stderr).toMatch(/\S/);
}

describe('_timer_period_s: the spellings the shipped timers use', () => {
  const rows: Array<[string, number]> = [
    ['OnUnitActiveSec=60s', 60],
    ['OnUnitActiveSec=2min', 120],
    ['OnUnitActiveSec=15min', 900],
    ['OnUnitActiveSec=30min', 1800],
    ['OnUnitActiveSec=60min', 3600],
    ['OnUnitActiveSec=1h', 3600],
    ['OnUnitActiveSec=4h', 14400],
    ['OnCalendar=*:0/5', 300],
  ];
  for (const [line, seconds] of rows) {
    it(`\`${line}\` is ${seconds}`, () => expectPeriod(period(timer(line)), seconds));
  }

  // Every file the directory holds, at run time: a new shipped timer is covered the day it lands. The answer each
  // file means is computed here from its one cadence line, by a table this file owns, never by the reader under test.
  const meaning = (value: string): number => {
    const u = /^OnUnitActiveSec=(\d+)(s|min|h)$/.exec(value);
    if (u) return Number(u[1]) * { s: 1, min: 60, h: 3600 }[u[2] as 's' | 'min' | 'h'];
    const c = /^OnCalendar=\*:0\/(\d+)$/.exec(value);
    if (c) return Number(c[1]) * 60;
    throw new Error(`no meaning for ${value}`);
  };
  for (const name of readdirSync(UNITS).filter((n) => n.endsWith('.timer')).sort()) {
    it(`the shipped ${name} answers the period its cadence line means`, () => {
      const lines = readFileSync(join(UNITS, name), 'utf8').split('\n').filter((l) => /^(OnUnitActiveSec|OnCalendar)=/.test(l));
      expect(lines, `${name} holds one cadence line`).toHaveLength(1);
      expectPeriod(period(join(UNITS, name)), meaning(lines[0]!));
    });
  }
});

describe('_timer_period_s: every other key is ignored, never refused', () => {
  it('`OnBootSec=45s` plus `OnUnitActiveSec=60s` is 60', () =>
    expectPeriod(period(timer('OnBootSec=45s', 'OnUnitActiveSec=60s', 'AccuracySec=10s')), 60));
  it('`OnActiveSec=2min` plus `OnUnitActiveSec=2min` is 120', () =>
    expectPeriod(period(timer('OnActiveSec=2min', 'OnUnitActiveSec=2min', 'AccuracySec=30s')), 120));
  it('`AccuracySec=1min` beside `OnUnitActiveSec=15min` is 900', () =>
    expectPeriod(period(timer('OnUnitActiveSec=15min', 'AccuracySec=1min')), 900));
  it('`OnCalendar=*:0/5` plus `Persistent=true` is 300', () =>
    expectPeriod(period(timer('OnCalendar=*:0/5', 'Persistent=true')), 300));
  it('the binary-lifecycle install timer\'s shape, `OnUnitActiveSec=30min` plus `RandomizedDelaySec=5min` plus `Persistent=true`, is 1800', () =>
    expectPeriod(period(timer('OnUnitActiveSec=30min', 'RandomizedDelaySec=5min', 'Persistent=true')), 1800));
  it('a commented `#OnUnitActiveSec=5min` beside `OnUnitActiveSec=15min` is 900', () =>
    expectPeriod(period(timer('#OnUnitActiveSec=5min', 'OnUnitActiveSec=15min')), 900));
  it('`Unit=`, comments, blank lines and the section headers are ignored too', () =>
    expectPeriod(period(timer('# a comment', '', 'Unit=fixture.service', 'OnUnitActiveSec=4h')), 14400));
  it('a cadence key spelled mid-sentence in a comment is not a cadence line', () =>
    expectPeriod(period(timer('# this key once read OnUnitActiveSec=30min', 'OnUnitActiveSec=4h')), 14400));
});

describe('_timer_period_s: everything else is refused, rc 1, one line why, nothing on stdout', () => {
  it('an absent file is refused', () => expectRefused(period(join(mkTmp('ccrc-timer-none-'), 'absent.timer'))));
  it('a directory is refused', () => {
    const d = join(mkTmp('ccrc-timer-dir-'), 'dir.timer');
    mkdirSync(d);
    expectRefused(period(d));
  });
  it('a file with only `OnBootSec=` and `AccuracySec=` (no cadence line) is refused', () =>
    expectRefused(period(timer('OnBootSec=45s', 'AccuracySec=10s'))));
  it('two `OnUnitActiveSec=` lines are refused', () =>
    expectRefused(period(timer('OnUnitActiveSec=60s', 'OnUnitActiveSec=60s'))));
  it('two `OnCalendar=` lines are refused', () =>
    expectRefused(period(timer('OnCalendar=*:0/5', 'OnCalendar=*:0/5'))));
  it('one of each is refused', () =>
    expectRefused(period(timer('OnUnitActiveSec=15min', 'OnCalendar=*:0/5'))));
  for (const spelling of ['OnUnitActiveSec=60', 'OnUnitActiveSec=1.5h', 'OnCalendar=daily']) {
    it(`\`${spelling}\` is refused (a spelling no shipped file uses)`, () => expectRefused(period(timer(spelling))));
  }
  it('`15m` is refused', () => expectRefused(period(timer('OnUnitActiveSec=15m'))));
  it('a refusal never prints the file\'s contents', () => {
    const a = period(timer('OnUnitActiveSec=fixture-secret-7d1'));
    expectRefused(a);
    expect(a.stderr).not.toContain('fixture-secret-7d1');
  });
});

describe('_timer_period_words: the period in the transcript\'s words', () => {
  const rows: Array<[number, string, string]> = [
    [300, '5 minutes', '5-minute'],
    [60, '1 minute', '1-minute'],
    [90, '90 seconds', '90-second'],
    [3600, '60 minutes', '60-minute'],
  ];
  for (const [s, noun, adj] of rows) {
    it(`${s} s is "${noun}" as a noun and "${adj}" as an adjective`, () => {
      const n = call('_timer_period_words', String(s), 'noun');
      expect(n.code, n.stderr).toBe(0);
      expect(n.stdout).toBe(noun);
      const a = call('_timer_period_words', String(s), 'adj');
      expect(a.code, a.stderr).toBe(0);
      expect(a.stdout).toBe(adj);
    });
  }
});
