// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
// The W8 kernel tail's cadence chain (ARCH-69 (#804)): a launchd job, a transcript sentence or a doctor bound that runs
// "as often as the timer" reads the period from the shipped `.timer`, never from a second spelling of it. Its census
// queries live in `../census-w8/cadence.ts`; C8b's doctor block follows the launchd one.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp } from '../tmpHelpers.js';
import { ccrcContainedEnv } from '../ccrcContainment.js';
import { ddnsTranscriptCadences, doctorRestatedCadences, doctorSourceTimeCalls, launchdCadenceLiterals, timerSpellings } from '../census-w8/cadence.js';
import { ccrcRoot } from './helpers.js';

/** The ddns transcript sentences kept on purpose, by arm and text. The Linux arm copies the shipped `.timer` verbatim
 *  and reads no cadence, so deriving its sentence would give it a read and a refusal it does not have (D-7053). */
const KEPT_TRANSCRIPT_CADENCES: ReadonlyArray<readonly ['darwin' | 'linux', string]> = [
  ['linux', 'echo "expose: $CCRC_DDNS_UNIT.timer enabled — the DuckDNS record refreshes every 5 minutes"'],
];

describe('ARCH-69, the launchd half (D-7053): the ddns job\'s cadence comes from its timer', () => {
  it('no launchd cadence literal: every StartInterval is a local read from the shipped timer by _timer_period_s', () => {
    expect(launchdCadenceLiterals().map((s) => `${s.file} ${s.text.trim()}`)).toEqual([]);
  });

  it('only the Linux arm\'s sentence is kept: the ddns transcript spells no other cadence, and the list may only shrink', () => {
    const rows = ddnsTranscriptCadences().map((s) => [s.arm, s.text.trim()] as const);
    const kept = KEPT_TRANSCRIPT_CADENCES.map(([arm, text]) => `${arm} ${text}`);
    for (const [arm, text] of rows) expect(kept, 'a ddns sentence spells a cadence it should read from the timer').toContain(`${arm} ${text}`);
    expect(rows.length).toBeLessThanOrEqual(KEPT_TRANSCRIPT_CADENCES.length);
  });

  it('every shipped spelling is one the reader reads (read over deploy/systemd at run time)', () => {
    const spellings = timerSpellings();
    expect(spellings.length, 'no shipped timer was found: the scan reads nothing').toBeGreaterThan(0);
    const dir = mkTmp('kernel-tail-cadence-');
    // A fixed driver run as `bash <file> <ccrc> <timer>`: no `-c` string, so no path of this run is spliced into shell text.
    const driver = join(dir, 'driver.sh');
    writeFileSync(driver, '. "$1"; _timer_period_s "$2"\n', { mode: 0o644 });
    for (const [i, line] of spellings.entries()) {
      const f = join(dir, `spelling-${i}.timer`);
      writeFileSync(f, `[Timer]\n${line}\n`);
      const r = spawnSync('bash', [driver, join(ccrcRoot, 'ccd', 'ccrc'), f],
        { env: ccrcContainedEnv(dir, process.env, { managers: true, curl: 'poison' }), encoding: 'utf8', input: '' });
      expect(r.status, `${line}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/^[1-9]\d*\n$/);
    }
  });
});

/** The doctor lines measured and not derived, by check and text, held exactly (D-7054): the codex first-poll note
 *  restates ccrc-codex-usage@.timer's OnActiveSec=5min, a first-run delay `_timer_period_s` does not read; the
 *  scope-sweep default is the call-bound CCRC_SCOPE_SWEEP_STALE_S (ccrc-settings-census.test.ts), never derived from
 *  its timer. A later task that derives one removes its row here. */
const KEPT_DOCTOR_CADENCES: ReadonlyArray<readonly [string, string]> = [
  ['codex', 'note+=("no usage row yet (enabled $((now - en))s ago; the first poll runs five minutes after enable)")'],
  ['scope-sweep', 'stale=${CCRC_SCOPE_SWEEP_STALE_S:-300}; [[ "$stale" =~ ^[1-9][0-9]{0,8}$ ]] || stale=300   # a non-number would abort the arithmetic below'],
];

describe('ARCH-69, the doctor half (D-7054): every doctor bound and sentence reads its cadence from the shipped unit file', () => {
  it('no restated cadence in the doctor: doctorRestatedCadences() holds the kept set alone', () => {
    const rows = doctorRestatedCadences();
    expect(rows.filter((s) => s.kept === null).map((s) => `${s.check} ${s.text.trim()}`),
      'a doctor line restates a timer\'s period: read it with _dr_timer_period_s / _dr_cycles_s').toEqual([]);
  });

  it('the kept set is held exactly: each kept line is present, by check and text, and nothing else is kept', () => {
    const kept = doctorRestatedCadences().filter((s) => s.kept !== null).map((s) => [s.check, s.text.trim()] as const);
    expect(kept).toEqual(KEPT_DOCTOR_CADENCES);
  });

  it('nothing runs at source time: no top-level line of the table calls a _dr_/_box_/_timer_ function', () => {
    expect(doctorSourceTimeCalls().map((s) => s.text.trim())).toEqual([]);
  });
});
