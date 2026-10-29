// W8 Task C8b (D-7054; ARCH-69 (#804), second half): the doctor reads every cadence from the shipped unit file.
//
// STEP 1, THE CHARACTERIZATION PIN. Each check whose bound or sentence restates a shipped timer's period is driven
// through the check itself (ccd/ccrc and the check table sourced into one shell, as `usageRows` in
// ccrc-doctor-codex.test.ts does), on the shipped units, one second inside and one second past each bound, and its
// verdict lines are held byte for byte (the fixture HOME written as `<home>`). The clock is fixed (`fixClock`), so a
// boundary row cannot flake on a tick between the fixture's write and the check's read. These rows run unchanged
// at every commit of the series: a move that changed a word or a verdict on a shipped tree is red here.
//
// Linux rows: the pool-sync, update-sync and server-caps arms read a systemd unit file's mtime, which macOS has none
// of (it ships no systemd timer), and scope-sweep SKIPs on Darwin.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeLinux } from './platformFixtures.js';
import { BASH, CCRC_SRC, CHECKS_SRC, REPO, Result, doctorEnv, healthy, shq, stubBin, unitDirOf, unitFileOf, writeCcrcEnv, writeUnitFile } from './ccrc-doctorFixture.js';
import { fixClock, fixedNow } from './fixedClock.js';
import { plantShippedTimers, writeShippedTimer } from './shippedTimers.js';
import { mkTmp } from './tmpHelpers.js';

/** `body` run after ccd/ccrc and the check table are sourced, under `home`'s doctor environment. */
function runChecks(home: string, body: string): Result {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n${body}`],
    { env: doctorEnv(home), encoding: 'utf8', timeout: 30_000 });
  return { code: r.status ?? -1, stdout: (r.stdout ?? '').split(home).join('<home>'), stderr: r.stderr ?? '' };
}

/** A healthy fixture box whose clock reads `now`. */
function box(prefix: string, now: number): string {
  const home = healthy(prefix);
  fixClock(home, stubBin(home), now);
  return home;
}

/** `unit` placed in this platform's unit directory, its file `ageS` old by the fixed clock. */
function unitAged(home: string, unit: string, now: number, ageS: number): void {
  writeUnitFile(home, unit);
  utimesSync(join(unitDirOf(home), unitFileOf(unit)), now - ageS, now - ageS);
}

describeLinux('C8b characterization: pool-sync\'s grace (2 × ccd-pool-sync.timer) and its three sentences', () => {
  const NOT_YET = (age: number): string[] => [
    `WARN pool-sync: pool-sync-not-yet-synced: ccd-pool-sync.timer was installed ${age}s ago and <home>/.cc-sessions/pool-epoch has not been written yet — the timer fires every 60s (OnUnitActiveSec) and converges on its own; expected right after an install, not a fault`,
    '  remedy: wait for the timer to fire (up to ~60s) and re-run ccrc doctor — still absent past that window is the real fault: read the oneshot\'s own log (journalctl --user -u ccd-pool-sync.service -n 50)',
    '',
  ];
  const NEVER = [
    'FAIL pool-sync: pool-sync-never-synced: ccd-pool-sync.timer is installed (this is a fleet box) but <home>/.cc-sessions/pool-epoch has never been written — placement into every tagged project on this box refuses',
    '  remedy: read the oneshot\'s own log (journalctl --user -u ccd-pool-sync.service -n 50) — a missing or rotated $HOME/.cc-secrets/ccrc-mail.token and a non-200 from the control plane are the two measured causes; `systemctl --user start ccd-pool-sync.service` forces an immediate retry once fixed',
    '',
  ];

  it('one second inside the 120 s grace: the not-yet-synced WARN, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-pool-sync-119-', now);
    unitAged(home, 'ccd-pool-sync.timer', now, 119);
    const r = runChecks(home, '_check_pool-sync');
    expect(r.stdout.split('\n'), r.stderr).toEqual(NOT_YET(119));
    expect(r.code).toBe(2);
  });

  it('at the grace (120 s): the never-synced FAIL, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-pool-sync-120-', now);
    unitAged(home, 'ccd-pool-sync.timer', now, 120);
    const r = runChecks(home, '_check_pool-sync');
    expect(r.stdout.split('\n'), r.stderr).toEqual(NEVER);
    expect(r.code).toBe(1);
  });

  it('the malformed projection\'s remedy names the timer\'s period, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-pool-sync-malformed-', now);
    unitAged(home, 'ccd-pool-sync.timer', now, 3600);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'pool-epoch'), 'not a lease\n');
    const r = runChecks(home, '_check_pool-sync');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'WARN pool-sync: pool-sync-malformed: <home>/.cc-sessions/pool-epoch does not parse as this box\'s own reader would — no single, well-formed `lease <n>` line',
      '  remedy: the next timer fire (every 60s) rewrites it atomically; inspect the current content by hand: cat <home>/.cc-sessions/pool-epoch',
      '',
    ]);
    expect(r.code).toBe(2);
  });
});

describeLinux('C8b characterization: update-sync\'s grace (2 × ccd-update-sync.timer) and its two sentences', () => {
  it('one second inside the 120 s grace: the not-yet-synced WARN, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-update-sync-119-', now);
    unitAged(home, 'ccd-update-sync.timer', now, 119);
    const r = runChecks(home, '_check_update-sync');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'WARN update-sync: update-sync-not-yet-synced: ccd-update-sync.timer was installed 119s ago and ~/.ccrc/update-intent has not been written yet — the timer fires every 60s (OnUnitActiveSec) and converges on its own; expected right after an install, not a fault',
      '  remedy: wait for the timer to fire (up to ~60s) and re-run ccrc doctor — still absent past that window is the real fault: read the oneshot\'s own log (journalctl --user -u ccd-update-sync.service -n 50)',
      '',
    ]);
    expect(r.code).toBe(2);
  });

  it('at the grace (120 s): the FAIL, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-update-sync-120-', now);
    unitAged(home, 'ccd-update-sync.timer', now, 120);
    const r = runChecks(home, '_check_update-sync');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'FAIL update-sync: update-sync-unreadable: ~/.ccrc/update-intent is unreadable (never synced) — every \'ccrc update\' without --to on this box refuses',
      '  remedy: ~/.ccrc/update-intent is unreadable (never synced) — systemctl --user start ccd-update-sync.service',
      '',
    ]);
    expect(r.code).toBe(1);
  });
});

describeLinux('C8b characterization: scope-sweep\'s staleness (CCRC_SCOPE_SWEEP_STALE_S, 300 s) and its "every minute" sentence', () => {
  const record = (home: string, tick: number): void => {
    writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v1 tick=${tick} up=1000 mode=shadow\n`);
  };

  it('a record 300 s old is fresh: the PASS, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-scope-sweep-300-', now);
    record(home, now - 300);
    const r = runChecks(home, 'CCD_OS=linux; _check_scope-sweep');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'PASS scope-sweep: no dead pane scope the sweep could measure, and no process older than a day in a live one (the sweep\'s record, 300s old, mode shadow)',
      '',
    ]);
    expect(r.code).toBe(0);
  });

  it('a record 301 s old: the stale WARN, byte for byte', () => {
    const now = fixedNow();
    const home = box('c8b-scope-sweep-301-', now);
    record(home, now - 301);
    const r = runChecks(home, 'CCD_OS=linux; _check_scope-sweep');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'WARN scope-sweep: the verdict record is 301s old — the sweep runs every minute, so it has stopped, and its dead-scope report is stale',
      '  remedy: systemctl --user status ccd-scope-sweep.timer ccd-scope-sweep.service; journalctl --user -u ccd-scope-sweep.service',
      '',
    ]);
    expect(r.code).toBe(2);
  });

  it('the CCRC_SCOPE_SWEEP_STALE_S override still moves the bound', () => {
    const now = fixedNow();
    const home = box('c8b-scope-sweep-override-', now);
    record(home, now - 301);
    const r = runChecks(home, 'CCD_OS=linux; CCRC_SCOPE_SWEEP_STALE_S=400; _check_scope-sweep');
    expect(r.stdout, r.stderr).toMatch(/^PASS scope-sweep: .*301s old/);
  });
});

describeLinux('C8b characterization: server-caps\' fleet writer (ccd-update-sync, "every minute")', () => {
  const caps = (home: string): string => join(home, '.ccrc', 'server-caps');
  const fleet = (prefix: string, now: number, unitAgeS = 240): string => {
    const home = box(prefix, now);
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\n');
    unitAged(home, 'ccd-update-sync.timer', now, unitAgeS);
    return home;
  };
  const REMEDY = '  remedy: run systemctl --user start ccd-update-sync.service and read its log (journalctl --user -u ccd-update-sync.service -n 50); the server CCRC_SERVER_URL names in ~/.ccrc/agent.env must answer /health';

  it('a current file: the PASS names the writer, byte for byte', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-pass-', now);
    writeFileSync(caps(home), `at ${now - 5}\ncaps word-a\nend\n`);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'PASS server-caps: ~/.ccrc/server-caps is current (written 5s ago by ccd-update-sync (it asks the server\'s /health every minute)) and lists: word-a',
      '',
    ]);
    expect(r.code).toBe(0);
  });

  it('a current file with no words: the PASS names the writer, byte for byte', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-pass-empty-', now);
    writeFileSync(caps(home), `at ${now - 5}\ncaps\nend\n`);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'PASS server-caps: ~/.ccrc/server-caps is current (written 5s ago by ccd-update-sync (it asks the server\'s /health every minute)) and lists no words, so the server advertises nothing and the hook\'s gated arms stay off',
      '',
    ]);
  });

  it('a stale file: the WARN names the writer, byte for byte', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-stale-', now);
    writeFileSync(caps(home), `at ${now - 181}\ncaps word-a\nend\n`);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'WARN server-caps: ~/.ccrc/server-caps is stale (written 181s ago, past its 180s lease), so the session hook\'s gated arms are off on this box (it writes what it always wrote, which is safe) until ccd-update-sync (it asks the server\'s /health every minute) rewrites it',
      REMEDY,
      '',
    ]);
    expect(r.code).toBe(2);
  });

  it('absent, the writer\'s unit placed inside one lease: the first-write-pending PASS, byte for byte', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-pending-', now, 30);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'PASS server-caps: first-write-pending: ccd-update-sync.timer was installed 30s ago and ~/.ccrc/server-caps has not been written yet, so the session hook\'s gated arms are off (the safe state) until ccd-update-sync (it asks the server\'s /health every minute) writes it, within 180s',
      '',
    ]);
  });

  it('absent past one lease: the WARN names the writer, byte for byte', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-absent-', now);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'WARN server-caps: ~/.ccrc/server-caps is absent, so the session hook\'s gated arms are off on this box (it writes what it always wrote, which is safe) until ccd-update-sync (it asks the server\'s /health every minute) rewrites it',
      REMEDY,
      '',
    ]);
  });
});

describe('C8b characterization: the both arm and the no-role skip keep their own "every minute" (the server\'s beat, not a unit file)', () => {
  it('the no-role SKIP, byte for byte', () => {
    const home = box('c8b-caps-norole-', fixedNow());
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'SKIP server-caps: this box records no CCRC_ROLE and has no ~/.ccrc/server-caps, so the session hook\'s gated arms are off here; a ccrc server on this box would derive the role both and write the file every minute, and on a fleet node ccd-update-sync writes it once CCRC_ROLE=fleet is recorded',
      '',
    ]);
    expect(r.code).toBe(3);
  });
});

// Step 0's census of the rows that source the check table WITHOUT ccrc (`grep -l CHECKS_SRC`, each `.` line read): of
// the checks this series touches, two are reached that way — `_check_update-sync` (ccrc-doctor-core.test.ts) and
// `_dr_codex_usage_box` (ccrc-doctor-codex.test.ts), each stopping in its own loaded guard before any bound. Their
// whole output is held here, byte for byte, so a bound computed before those guards (or at source time) is red.
describe('C8b characterization: the table sourced without ccrc', () => {
  const alone = (home: string, body: string): Result => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CHECKS_SRC)}\n${body}`],
      { env: { HOME: home, PATH: home, LC_ALL: 'C' }, encoding: 'utf8', timeout: 30_000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('_check_update-sync FAILs in its loaded guard, byte for byte', () => {
    const r = alone(join(REPO, 'no-such-home-for-c8b'), '_check_update-sync; echo "rc=$?"');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'FAIL update-sync: ccrc\'s own update-intent reader is not loaded, so this box\'s projection freshness was never measured',
      '  remedy: this is a bug in ccrc, not a fact about your box — _check_update-sync calls _upd_intent_state, declared once in ccrc itself, and this check table was sourced by something that is not ccrc',
      'rc=1',
      '',
    ]);
    expect(r.stderr).toBe('');
  });

  it('_dr_codex_usage_box FAILs in its loaded guard, byte for byte', () => {
    const r = alone(join(REPO, 'no-such-home-for-c8b'), '_dr_codex_usage_box; echo "rc=$?"');
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'FAIL codex: ccrc\'s own usage-timer reader is not loaded, so no codex lane\'s usage timer was measured',
      '  remedy: this is a bug in ccrc, not a fact about your box — _check_codex calls _codex_usage_enabled, declared once in ccrc itself, and this check table was sourced by something that is not ccrc',
      'rc=1',
      '',
    ]);
    expect(r.stderr).toBe('');
  });
});

// STEP 2: the doctor's cadence helpers (D-7054), red before they exist. `_dr_timer_period_s <unit>` answers the
// SHIPPED tree's `$BOX_TREE_DIR/deploy/systemd/<unit>` through ccrc's one reader, `_timer_period_s` (C8a, D-7053),
// never the installed copy (Review focus 2); `_dr_cycles_s <unit> <k>` is k of those periods. rc 0 prints the number;
// rc 1 (the file cannot be read: OA-C8c (a), D-7062) and rc 3 (ccrc's reader or BOX_TREE_DIR not loaded: a bug in
// ccrc) print nothing, so no caller can reach `$(( ))` or `-gt` with an empty operand.
describe('C8b: the doctor\'s cadence helpers', () => {
  const tree = (): string => {
    const home = mkTmp('c8b-helpers-');
    plantShippedTimers(join(home, 'ccrc'));
    return home;
  };
  const sh = (home: string, body: string, withCcrc = true): Result => {
    const src = `set -uo pipefail\n${withCcrc ? `. ${shq(CCRC_SRC)}\n` : ''}. ${shq(CHECKS_SRC)}\n${body}`;
    const r = spawnSync(BASH, ['-c', src], { env: { HOME: home, PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8', timeout: 30_000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it.each([
    ['ccd-graph-sweep.timer', 3, '2700'],
    ['ccrc-models.timer', 3, '10800'],
    ['ccd-pool-sync.timer', 2, '120'],
    ['ccrc-codex-usage@.timer', 3, '2700'],
    ['ccd-scope-sweep.timer', 1, '60'],
  ])('_dr_cycles_s %s %i answers %s from the shipped tree', (unit, k, want) => {
    const r = sh(tree(), `_dr_cycles_s ${unit} ${k}; echo "rc=$?"`);
    expect(r.stdout, r.stderr).toBe(`${want}\nrc=0\n`);
  });

  it('_dr_timer_period_s answers the shipped file, not the installed copy', () => {
    const home = tree();
    writeShippedTimer(join(home, 'ccrc'), 'ccd-pool-sync.timer', '[Timer]\nOnUnitActiveSec=90s\n');
    mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true });
    writeFileSync(join(home, '.config', 'systemd', 'user', 'ccd-pool-sync.timer'), '[Timer]\nOnUnitActiveSec=60s\n');
    const r = sh(home, '_dr_timer_period_s ccd-pool-sync.timer; echo "rc=$?"');
    expect(r.stdout, r.stderr).toBe('90\nrc=0\n');
  });

  it('a run reads each unit file once: later calls in the same shell answer from the cache', () => {
    const home = tree();
    const r = sh(home, [
      'eval "c8b_real_$(declare -f _timer_period_s)"',
      '_timer_period_s() { echo "$1" >> "$HOME/reads"; c8b_real__timer_period_s "$@"; }',
      '_dr_timer_period_s ccd-pool-sync.timer; _dr_cycles_s ccd-pool-sync.timer 2; _dr_cycles_s ccd-pool-sync.timer 3',
      '_dr_cycles_s ccd-graph-sweep.timer 3; _dr_timer_period_s ccd-graph-sweep.timer',
      'echo "reads=$(wc -l < "$HOME/reads")"',
    ].join('\n'));
    expect(r.stdout.replace(/reads= +/, 'reads='), r.stderr).toBe('60\n120\n180\n2700\n900\nreads=2\n');
  });

  it('a unit file that cannot be read: rc 1 and nothing on stdout, from either helper', () => {
    const home = tree();
    writeShippedTimer(join(home, 'ccrc'), 'ccd-graph-sweep.timer', null);
    writeShippedTimer(join(home, 'ccrc'), 'ccrc-models.timer', '[Timer]\nOnBootSec=5min\n');
    const r = sh(home, [
      '_dr_timer_period_s ccd-graph-sweep.timer; echo "rc=$?"',
      '_dr_cycles_s ccd-graph-sweep.timer 3; echo "rc=$?"',
      '_dr_cycles_s ccrc-models.timer 3; echo "rc=$?"',
    ].join('\n'));
    expect(r.stdout).toBe('rc=1\nrc=1\nrc=1\n');
  });

  it('BOX_TREE_DIR unset, or ccrc\'s reader undeclared (the table sourced alone): rc 3 and nothing on stdout', () => {
    const home = tree();
    expect(sh(home, 'unset BOX_TREE_DIR; _dr_cycles_s ccd-pool-sync.timer 2; echo "rc=$?"').stdout).toBe('rc=3\n');
    expect(sh(home, 'BOX_TREE_DIR=; _dr_timer_period_s ccd-pool-sync.timer; echo "rc=$?"').stdout).toBe('rc=3\n');
    expect(sh(home, 'unset -f _timer_period_s; _dr_cycles_s ccd-pool-sync.timer 2; echo "rc=$?"').stdout).toBe('rc=3\n');
    const alone = sh(home, '_dr_cycles_s ccd-pool-sync.timer 2; echo "rc=$?"', false);
    expect(alone.stdout, alone.stderr).toBe('rc=3\n');
  });

  it('rc 3: the calling check\'s FAIL names the bug, in the file\'s existing shape', () => {
    const r = sh(tree(), '_dr_cadence_unloaded graphify ccd-graph-sweep.timer "the census\'s staleness"; echo "rc=$?"', false);
    expect(r.stdout.split('\n'), r.stderr).toEqual([
      'FAIL graphify: ccrc\'s own timer reader is not loaded, so the census\'s staleness was never measured',
      '  remedy: this is a bug in ccrc, not a fact about your box — _check_graphify reads ccd-graph-sweep.timer\'s cadence through _timer_period_s and BOX_TREE_DIR, both declared once in ccrc itself, and this check table was sourced by something that is not ccrc',
      'rc=1',
      '',
    ]);
  });

  it('rc 1: the check\'s WARN names the unit and says the bound is unmeasured (OA-C8c (a), D-7062)', () => {
    const r = sh(tree(), '_dr_cadence_unread graphify ccd-graph-sweep.timer "the census\'s staleness"; echo "rc=$?"');
    expect(r.stdout, r.stderr).toMatch(
      /^WARN graphify: ccd-graph-sweep\.timer's cadence could not be read from the shipped unit file \(\S+\/ccrc\/deploy\/systemd\/ccd-graph-sweep\.timer\), so the census's staleness is unmeasured\n {2}remedy: \S/);
    expect(r.stdout).toMatch(/\nrc=2\n$/);
  });

  it.each([[60, 'every minute'], [120, 'every 2 minutes'], [900, 'every 15 minutes'], [90, 'every 90s'], [45, 'every 45s']])(
    '_dr_every_words %i prints "%s"', (s, want) => {
      expect(sh(tree(), `_dr_every_words ${s}; echo`).stdout).toBe(`${want}\n`);
    });
});

// STEP 4: the failure arms (OA-C8c (a), D-7062), one check per commit, each red before its commit and before its
// check's move. A shipped unit file that cannot be read makes the check WARN naming the unit and compute no verdict
// from that bound (never a literal fallback, never an empty operand: stderr stays empty); BOX_TREE_DIR or ccrc's
// reader not loaded is a FAIL naming the bug.
const UNREAD_FIX = '  remedy: the shipped tree at <home>/ccrc is incomplete or damaged — both deploy lanes place the whole tree there, so the next ccrc update (or deploy) restores it; then re-run ccrc doctor';
const unread = (unit: string, what: string): string[] => [
  `${unit}'s cadence could not be read from the shipped unit file (<home>/ccrc/deploy/systemd/${unit}), so ${what} is unmeasured`,
  UNREAD_FIX,
];
const unloaded = (check: string, unit: string, what: string): string[] => [
  `FAIL ${check}: ccrc's own timer reader is not loaded, so ${what} was never measured`,
  `  remedy: this is a bug in ccrc, not a fact about your box — _check_${check} reads ${unit}'s cadence through _timer_period_s and BOX_TREE_DIR, both declared once in ccrc itself, and this check table was sourced by something that is not ccrc`,
];
const warnUnread = (check: string, unit: string, what: string): string[] => {
  const [w, f] = unread(unit, what);
  return [`WARN ${check}: ${w}`, f!];
};
const noTimer = (home: string, unit: string): void => writeShippedTimer(join(home, 'ccrc'), unit, null);

describeLinux('C8b step 4: pool-sync, its unit file unreadable or its reader unloaded', () => {
  const GRACE = 'the not-yet-synced grace for <home>/.cc-sessions/pool-epoch (two of the timer\'s periods)';
  it.each([119, 120, 3600])('an unreadable ccd-pool-sync.timer makes pool-sync WARN unmeasured (installed %i s ago), never compare against a literal or an empty operand', (age) => {
    const now = fixedNow();
    const home = box(`c8b-pool-sync-unread-${age}-`, now);
    unitAged(home, 'ccd-pool-sync.timer', now, age);
    noTimer(home, 'ccd-pool-sync.timer');
    const r = runChecks(home, '_check_pool-sync');
    expect(r.stdout.split('\n')).toEqual([...warnUnread('pool-sync', 'ccd-pool-sync.timer', GRACE), '']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(2);
  });

  it('the malformed remedy drops its cadence clause, and the check WARNs naming the unit', () => {
    const now = fixedNow();
    const home = box('c8b-pool-sync-malformed-unread-', now);
    unitAged(home, 'ccd-pool-sync.timer', now, 3600);
    noTimer(home, 'ccd-pool-sync.timer');
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'pool-epoch'), 'not a lease\n');
    const r = runChecks(home, '_check_pool-sync');
    expect(r.stdout.split('\n')).toEqual([
      'WARN pool-sync: pool-sync-malformed: <home>/.cc-sessions/pool-epoch does not parse as this box\'s own reader would — no single, well-formed `lease <n>` line',
      '  remedy: the next timer fire rewrites it atomically; inspect the current content by hand: cat <home>/.cc-sessions/pool-epoch',
      ...warnUnread('pool-sync', 'ccd-pool-sync.timer', 'the period of the timer fire that remedy names'),
      '',
    ]);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(2);
  });

  it('BOX_TREE_DIR not loaded: the grace FAILs naming the bug, and so does the malformed remedy\'s period', () => {
    const now = fixedNow();
    const home = box('c8b-pool-sync-unloaded-', now);
    unitAged(home, 'ccd-pool-sync.timer', now, 120);
    const r = runChecks(home, 'BOX_TREE_DIR=; _check_pool-sync');
    expect(r.stdout.split('\n')).toEqual([...unloaded('pool-sync', 'ccd-pool-sync.timer', 'the not-yet-synced grace'), '']);
    expect(r.code).toBe(1);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'pool-epoch'), 'not a lease\n');
    const m = runChecks(home, 'BOX_TREE_DIR=; _check_pool-sync');
    expect(m.stdout.split('\n')).toEqual([
      'WARN pool-sync: pool-sync-malformed: <home>/.cc-sessions/pool-epoch does not parse as this box\'s own reader would — no single, well-formed `lease <n>` line',
      '  remedy: the next timer fire rewrites it atomically; inspect the current content by hand: cat <home>/.cc-sessions/pool-epoch',
      ...unloaded('pool-sync', 'ccd-pool-sync.timer', 'the period of the timer fire that remedy names'),
      '',
    ]);
    expect(m.code).toBe(1);
  });
});

describeLinux('C8b step 4: update-sync, its unit file unreadable or its reader unloaded', () => {
  it.each([119, 120])('an unreadable ccd-update-sync.timer makes update-sync WARN unmeasured (installed %i s ago), never compare against a literal or an empty operand', (age) => {
    const now = fixedNow();
    const home = box(`c8b-update-sync-unread-${age}-`, now);
    unitAged(home, 'ccd-update-sync.timer', now, age);
    noTimer(home, 'ccd-update-sync.timer');
    const r = runChecks(home, '_check_update-sync');
    expect(r.stdout.split('\n')).toEqual([
      ...warnUnread('update-sync', 'ccd-update-sync.timer', 'the not-yet-synced grace for ~/.ccrc/update-intent (two of the timer\'s periods)'), '']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(2);
  });

  it('BOX_TREE_DIR not loaded: the grace FAILs naming the bug', () => {
    const now = fixedNow();
    const home = box('c8b-update-sync-unloaded-', now);
    unitAged(home, 'ccd-update-sync.timer', now, 120);
    const r = runChecks(home, 'BOX_TREE_DIR=; _check_update-sync');
    expect(r.stdout.split('\n')).toEqual([...unloaded('update-sync', 'ccd-update-sync.timer', 'the not-yet-synced grace'), '']);
    expect(r.code).toBe(1);
  });
});

describeLinux('C8b step 4: scope-sweep\'s "every minute" sentence, its unit file unreadable or its reader unloaded', () => {
  const record = (home: string, tick: number): void => {
    writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v1 tick=${tick} up=1000 mode=shadow\n`);
  };
  const STALE = [
    'WARN scope-sweep: the verdict record is 301s old — the sweep has stopped, and its dead-scope report is stale',
    '  remedy: systemctl --user status ccd-scope-sweep.timer ccd-scope-sweep.service; journalctl --user -u ccd-scope-sweep.service',
  ];

  it('stale, an unreadable ccd-scope-sweep.timer: the WARN drops its cadence clause, and the check WARNs naming the unit', () => {
    const now = fixedNow();
    const home = box('c8b-scope-sweep-unread-', now);
    record(home, now - 301);
    noTimer(home, 'ccd-scope-sweep.timer');
    const r = runChecks(home, 'CCD_OS=linux; _check_scope-sweep');
    expect(r.stdout.split('\n')).toEqual([...STALE, ...warnUnread('scope-sweep', 'ccd-scope-sweep.timer', 'the period that sentence names'), '']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(2);
  });

  it('fresh, an unreadable ccd-scope-sweep.timer: the PASS needs no period and is unchanged', () => {
    const now = fixedNow();
    const home = box('c8b-scope-sweep-unread-fresh-', now);
    record(home, now - 300);
    noTimer(home, 'ccd-scope-sweep.timer');
    const r = runChecks(home, 'CCD_OS=linux; _check_scope-sweep');
    expect(r.stdout, r.stderr).toMatch(/^PASS scope-sweep: .*300s old, mode shadow\)\n$/);
  });

  it('stale, BOX_TREE_DIR not loaded: the WARN drops its cadence clause, and a FAIL names the bug', () => {
    const now = fixedNow();
    const home = box('c8b-scope-sweep-unloaded-', now);
    record(home, now - 301);
    const r = runChecks(home, 'CCD_OS=linux; BOX_TREE_DIR=; _check_scope-sweep');
    expect(r.stdout.split('\n')).toEqual([...STALE, ...unloaded('scope-sweep', 'ccd-scope-sweep.timer', 'the period that sentence names'), '']);
    expect(r.code).toBe(1);
  });
});

describeLinux('C8b step 4: land-probe\'s stale bound and not-yet window, ccd-land-probe.timer unreadable or its reader unloaded', () => {
  /** One opted-in project with no probe yet: the arm that needs the not-yet window. */
  const optedIn = (home: string): void => {
    mkdirSync(join(home, '.ccrc', 'landing'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'landing', 'proj-a.conf'), 'lineage=off\n');
  };
  const NEVER = 'WARN land-probe: land-probe-never: proj-a is opted in but the radar has never written its probe, so no PR conflict is measured and coordinators send sync and order mail without one';
  const NEVER_FIX = '  remedy: systemctl --user status ccd-land-probe.timer ccd-land-probe.service; journalctl --user -u ccd-land-probe.service; a pause marker (<home>/.cc-sessions/land-probe-paused or <home>/.cc-sessions/landing/<project>/paused) stops the writes by design; an invalid conf or a missing checkout under <home>/projects also stops them, and the journal names it';
  const BOUNDS = "the stale bound (four of the timer's periods; the stale arm did not run) and the not-yet window (two of the timer's periods; the not-yet arm did not run)";

  it('an unreadable ccd-land-probe.timer: no literal bound, a WARN naming the unit', () => {
    const now = fixedNow();
    const home = box('c8b-land-probe-unread-', now);
    optedIn(home);
    noTimer(home, 'ccd-land-probe.timer');
    const r = runChecks(home, 'CCD_OS=linux; _check_land-probe');
    expect(r.stdout.split('\n')).toEqual([NEVER, NEVER_FIX, ...warnUnread('land-probe', 'ccd-land-probe.timer', BOUNDS), '']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(2);
  });

  it('BOX_TREE_DIR not loaded: the FAIL names the bug', () => {
    const now = fixedNow();
    const home = box('c8b-land-probe-unloaded-', now);
    optedIn(home);
    const r = runChecks(home, 'CCD_OS=linux; BOX_TREE_DIR=; _check_land-probe');
    expect(r.stdout.split('\n')).toEqual([NEVER, NEVER_FIX, ...unloaded('land-probe', 'ccd-land-probe.timer', BOUNDS), '']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(1);
  });
});

describeLinux('C8b step 4: server-caps\' fleet writer sentence, ccd-update-sync.timer unreadable or its reader unloaded', () => {
  const caps = (home: string): string => join(home, '.ccrc', 'server-caps');
  const fleet = (prefix: string, now: number, unitAgeS = 240): string => {
    const home = box(prefix, now);
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\n');
    unitAged(home, 'ccd-update-sync.timer', now, unitAgeS);
    noTimer(home, 'ccd-update-sync.timer');
    return home;
  };
  const CAD = warnUnread('server-caps', 'ccd-update-sync.timer', 'the period of the writer named below');

  it('a current file: the PASS names the writer without its period, after a WARN naming the unit', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-unread-pass-', now);
    writeFileSync(caps(home), `at ${now - 5}\ncaps word-a\nend\n`);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n')).toEqual([...CAD,
      'PASS server-caps: ~/.ccrc/server-caps is current (written 5s ago by ccd-update-sync) and lists: word-a', '']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(2);
  });

  it('a stale file: the WARN names the writer without its period, after a WARN naming the unit', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-unread-stale-', now);
    writeFileSync(caps(home), `at ${now - 181}\ncaps word-a\nend\n`);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n')).toEqual([...CAD,
      'WARN server-caps: ~/.ccrc/server-caps is stale (written 181s ago, past its 180s lease), so the session hook\'s gated arms are off on this box (it writes what it always wrote, which is safe) until ccd-update-sync rewrites it',
      '  remedy: run systemctl --user start ccd-update-sync.service and read its log (journalctl --user -u ccd-update-sync.service -n 50); the server CCRC_SERVER_URL names in ~/.ccrc/agent.env must answer /health',
      '']);
    expect(r.code).toBe(2);
  });

  it('absent inside one lease: the first-write-pending PASS, after a WARN naming the unit', () => {
    const now = fixedNow();
    const home = fleet('c8b-caps-unread-pending-', now, 30);
    const r = runChecks(home, '_check_server-caps');
    expect(r.stdout.split('\n')).toEqual([...CAD,
      'PASS server-caps: first-write-pending: ccd-update-sync.timer was installed 30s ago and ~/.ccrc/server-caps has not been written yet, so the session hook\'s gated arms are off (the safe state) until ccd-update-sync writes it, within 180s',
      '']);
    expect(r.code).toBe(2);
  });

  it('BOX_TREE_DIR not loaded: a FAIL names the bug, and the check returns it', () => {
    const now = fixedNow();
    const home = box('c8b-caps-unloaded-', now);
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\n');
    unitAged(home, 'ccd-update-sync.timer', now, 240);
    writeFileSync(caps(home), `at ${now - 5}\ncaps word-a\nend\n`);
    const r = runChecks(home, 'BOX_TREE_DIR=; _check_server-caps');
    expect(r.stdout.split('\n')).toEqual([...unloaded('server-caps', 'ccd-update-sync.timer', 'the period of the writer named below'),
      'PASS server-caps: ~/.ccrc/server-caps is current (written 5s ago by ccd-update-sync) and lists: word-a', '']);
    expect(r.code).toBe(1);
  });
});
