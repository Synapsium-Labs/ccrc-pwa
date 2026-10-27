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
