// Doctor's `carry-copies` check (#317; D-7857): the bytes swap carries copied in the last 7 days, read from swap.log's
// two copy forms (`sidecar … (copy: <cause> <bytes> bytes)` and a merge's `, copy: <cause> <F> files <B> bytes`), and the
// reclaimable bytes on the latest line of `ccd-carry-dedupe-sweep`'s record, each against CCRC_CARRY_COPY_WARN_BYTES.
// Fixture HOMEs only (`healthy()`); the check runs alone, sourced, under TZ=UTC so the swap.log stamps this file writes
// are the ones its 7-day window reads. Every threshold edge has its pair: AT the bound is a PASS, one byte past is a WARN,
// so a `>=` mutant and an off-by-one in either figure each red a row.
import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, runDoctor, shq } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const U1 = 'c3a10e57-5555-4bcc-b60b-0cfc0dc3d199';
const U2 = 'd4b20f68-6666-4ccd-a71c-1dfd1ed4e2aa';
const DAY = 86_400_000;
/** One clock read per test: every fixture line and every expected stamp is `msAgo` before this same instant, so a second
 *  boundary crossed between writing the fixture and building the expectation cannot split them. */
let now = Date.now();
beforeEach(() => { now = Date.now(); });
/** swap.log's stamp for `msAgo` before the test's fixed `now`, in UTC (the check runs under TZ=UTC). */
const stamp = (msAgo: number): string => new Date(now - msAgo).toISOString().replace('T', ' ').slice(0, 19);
const first = (msAgo: number, bytes: number | '?', cause = 'exdev-no-root'): string =>
  `${stamp(msAgo)} sidecar ${U1} -> /w/.claude-lane-a/projects/-w-project-a/${U1} (copy: ${cause} ${bytes} bytes)`;
const merged = (msAgo: number, copies: Array<[string, number, number]>): string =>
  `${stamp(msAgo)} sidecar ${U2} -> /w/.claude-lane-b/projects/-w-project-a/${U2} (merged +3 ~0 !0${copies.map(([c, f, b]) => `, copy: ${c} ${f} files ${b} bytes`).join('')})`;
const recLine = (o: { mode?: 'shadow' | 'live'; rc?: number; bytes?: number; refused?: number; by?: string } = {}): string =>
  `${stamp(3_600_000)} mode=${o.mode ?? 'shadow'} rc=${o.rc ?? 0} uuids=4 copies=9 ${(o.mode ?? 'shadow') === 'live' ? 'reclaimed' : 'reclaimable'}=${o.bytes ?? 0} refused=${o.refused ?? 0} by=${o.by ?? '-'}`;

interface Box { home: string; reg: string }
function box(prefix: string, o: { log?: string[]; record?: string[]; env?: string[] } = {}): Box {
  const home = healthy(prefix);
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  if (o.log) writeFileSync(join(reg, 'swap.log'), o.log.map((l) => `${l}\n`).join(''));
  if (o.record) writeFileSync(join(reg, 'carry-dedupe-record'), o.record.map((l) => `${l}\n`).join(''));
  if (o.env) appendFileSync(join(home, '.ccrc', 'ccrc.env'), o.env.map((l) => `${l}\n`).join(''));
  return { home, reg };
}
/** The check alone, sourced, its verdict line and its remedy (the line after a non-PASS verdict). */
function check(b: Box, os = 'linux', env: NodeJS.ProcessEnv = {}): { line: string; remedy: string; code: number } {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\nCCD_OS=${os}; _check_carry-copies`],
    { env: { ...doctorEnv(b.home), TZ: 'UTC', ...env }, encoding: 'utf8', timeout: 30_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) carry-copies: /.test(l));
  expect(i, `a carry-copies line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, remedy: lines[i + 1] ?? '', code: r.status ?? -1 };
}
const BOUND = 'CCRC_CARRY_COPY_WARN_BYTES=1000';

describe('carry-copies: where there is nothing to size (D-7857)', () => {
  it('SKIP in a full doctor run on a box with no session registry (the healthy fixture)', () => {
    const home = healthy('ccrc-doctor-carry-noreg-');
    expect(anyVerdictFor(runDoctor(home).stdout, 'carry-copies')).toBe('SKIP carry-copies: no session registry at ~/.cc-sessions, so there is no swap carry to size');
  });

  it('SKIP on a server-role box', () => {
    const b = box('ccrc-doctor-carry-server-', { env: ['CCRC_ROLE=server'] });
    expect(check(b)).toMatchObject({ line: 'SKIP carry-copies: this box records CCRC_ROLE=server, so it runs no session and no swap carry', code: 3 });
  });

  it('PASS with a registry but no swap.log and no record yet; macOS says no sweep runs there', () => {
    const b = box('ccrc-doctor-carry-empty-');
    expect(check(b)).toMatchObject({
      line: 'PASS carry-copies: no swap.log yet, so no swap carry has copied anything; the dedupe sweep has not recorded a pass yet (ccd-carry-dedupe.timer runs it daily) (warn bound 10737418240 bytes)',
      code: 0,
    });
    expect(check(b, 'darwin').line).toMatch(/; no dedupe sweep runs on this box \(its timer is systemd-only\) \(warn bound 10737418240 bytes\)$/);
  });
});

describe('carry-copies: the copied bytes, from swap.log (D-7857)', () => {
  it('PASS sums both copy forms inside the window, counts the unsized, and leaves out lines older than 7 days and other lines', () => {
    const b = box('ccrc-doctor-carry-sum-', {
      log: [
        first(DAY, 300),
        first(2 * DAY, 200, 'root-failed'),
        first(3 * DAY, '?'),
        `${stamp(3 * DAY)} sidecar ${U1} -> /w/x (copy)`,
        merged(DAY, [['exdev-no-root', 2, 40], ['link-failed', 1, 10]]),
        first(7 * DAY + 60_000, 999_999),                     // outside the window
        merged(8 * DAY, [['exdev-no-root', 9, 999_999]]),     // outside the window
        `${stamp(DAY)} sidecar ${U1} -> /w/y (link: via-mount)`,
        `${stamp(DAY)} swap s-1: lane-a -> lane-b (uuid ${U1})`,
        `${stamp(DAY)} carry-dedupe ${U1} kept=lane-a unlinked=1 bytes=5 refused=- linked=0, copy: exdev-no-root 1 files 5 bytes`,
      ],
      record: [recLine({ bytes: 70 })],
    });
    expect(check(b).line).toBe(
      'PASS carry-copies: 550 bytes (0.00 GiB) copied by swap carries in the last 7 days (first carries 2, 500 bytes; merged files 3, 50 bytes; unsized first carries 2); '
      + `the dedupe sweep's latest pass (${stamp(3_600_000)}, mode shadow): 70 bytes (0.00 GiB) reclaimable across 4 uuid(s) held on two or more accounts, 0 refused (warn bound 10737418240 bytes)`);
  });

  it('the bound, at the edge: copied bytes AT the bound PASS, one byte over WARN', () => {
    const at = box('ccrc-doctor-carry-copy-at-', { env: [BOUND], log: [first(DAY, 600), merged(DAY, [['exdev-no-root', 1, 400]])] });
    expect(check(at).line).toMatch(/^PASS carry-copies: 1000 bytes /);
    const over = box('ccrc-doctor-carry-copy-over-', { env: [BOUND], log: [first(DAY, 601), merged(DAY, [['exdev-no-root', 1, 400]])] });
    const w = check(over);
    expect(w.line).toMatch(/^WARN carry-copies: 1001 bytes .* — over the warn bound of 1000 bytes \(0\.00 GiB, CCRC_CARRY_COPY_WARN_BYTES\)$/);
    expect(w.code).toBe(2);
  });

  it('a merge\'s copy bytes alone can cross the bound (the merge form is counted, not only the first carry\'s)', () => {
    const b = box('ccrc-doctor-carry-merge-only-', { env: [BOUND], log: [merged(DAY, [['exdev-no-root', 3, 700], ['link-failed', 1, 301]])] });
    expect(check(b).line).toMatch(/^WARN carry-copies: 1001 bytes .*merged files 4, 1001 bytes/);
  });

  it('the window, at the edge: a line just inside 7 days counts, one just outside does not', () => {
    const b = box('ccrc-doctor-carry-window-', { env: [BOUND], log: [first(7 * DAY - 120_000, 1001)] });
    expect(check(b).line).toMatch(/^WARN carry-copies: 1001 bytes /);
    const old = box('ccrc-doctor-carry-window-old-', { env: [BOUND], log: [first(7 * DAY + 120_000, 1001)] });
    expect(check(old).line).toMatch(/^PASS carry-copies: 0 bytes /);
  });
});

describe('carry-copies: the reclaimable bytes, from the sweep\'s record (D-7857)', () => {
  it('the bound, at the edge: reclaimable AT the bound PASS, one byte over WARN, with the read-then-arm remedy', () => {
    const at = box('ccrc-doctor-carry-rec-at-', { env: [BOUND], log: [], record: [recLine({ bytes: 1000 })] });
    expect(check(at).line).toMatch(/^PASS carry-copies: .*: 1000 bytes \(0\.00 GiB\) reclaimable across 4 uuid\(s\)/);
    const over = box('ccrc-doctor-carry-rec-over-', { env: [BOUND], log: [], record: [recLine({ bytes: 1001, refused: 2, by: 'tie:1,diverged:1' })] });
    const w = check(over);
    expect(w.line).toMatch(/^WARN carry-copies: 0 bytes .*: 1001 bytes \(0\.00 GiB\) reclaimable across 4 uuid\(s\) held on two or more accounts, 2 refused \(tie:1,diverged:1\) — over the warn bound of 1000 bytes/);
    expect(w.remedy).toBe('  remedy: read the record first (~/.cc-sessions/carry-dedupe-record, one line a day, mode=shadow until armed); when its shadow lines read right, arm the sweep: touch ~/.cc-sessions/carry-dedupe-live, and its next daily pass runs ccd carry-dedupe --identical-only --apply');
  });

  it('only the LATEST record line is read', () => {
    const b = box('ccrc-doctor-carry-latest-', { env: [BOUND], log: [], record: [recLine({ bytes: 999_999 }), recLine({ bytes: 5 })] });
    expect(check(b).line).toMatch(/^PASS carry-copies: .*: 5 bytes \(0\.00 GiB\) reclaimable/);
  });

  it('a live pass\'s reclaimed bytes are freed, not reclaimable: never a WARN on their own', () => {
    const b = box('ccrc-doctor-carry-live-', { env: [BOUND], log: [], record: [recLine({ mode: 'live', bytes: 999_999 })] });
    expect(check(b).line).toMatch(/^PASS carry-copies: .*\(.*, mode live\): 999999 bytes \(0\.00 GiB\) reclaimed across 4 uuid\(s\)/);
  });

  it('armed and still over on copies: the remedy points at swap.log\'s copy causes, never at arming again', () => {
    const b = box('ccrc-doctor-carry-live-over-', { env: [BOUND], log: [first(DAY, 1001)], record: [recLine({ mode: 'live', bytes: 10 })] });
    const w = check(b);
    expect(w.line).toMatch(/^WARN carry-copies: 1001 bytes /);
    expect(w.remedy).toMatch(/^ {2}remedy: the sweep is armed, so these copies are new since its last pass: each \(copy: <cause> …\) line in ~\/\.cc-sessions\/swap\.log names why/);
    expect(w.remedy).not.toContain('touch ');
  });

  it('WARN when the latest pass did not measure, or exited non-zero, or its line is not one the sweep writes', () => {
    const none = box('ccrc-doctor-carry-nototal-', { log: [], record: [`${stamp(60_000)} mode=shadow rc=1 unmeasured=no-total`] });
    expect(check(none).line).toMatch(/^WARN carry-copies: .*did not measure: the verb printed no total \(rc 1\)$/);
    const rc = box('ccrc-doctor-carry-rc-', { log: [], record: [recLine({ rc: 1, refused: 1, by: 'error:1' })] });
    expect(check(rc).line).toMatch(/^WARN carry-copies: .*1 refused \(error:1\), and it exited 1$/);
    const junk = box('ccrc-doctor-carry-junk-', { log: [], record: [recLine(), 'not a record line'] });
    expect(check(junk).line).toMatch(/^WARN carry-copies: .*the latest line of ~\/\.cc-sessions\/carry-dedupe-record is not a line the sweep writes/);
  });
});

describe('carry-copies: its bound, CCRC_CARRY_COPY_WARN_BYTES (D-7857)', () => {
  it('read from ccrc.env in file mode: the environment does not move it', () => {
    const b = box('ccrc-doctor-carry-knob-file-', { env: ['CCRC_CARRY_COPY_WARN_BYTES=2000'], log: [first(DAY, 1500)] });
    expect(check(b, 'linux', { CCRC_CARRY_COPY_WARN_BYTES: '1' }).line).toMatch(/^PASS carry-copies: 1500 bytes .*\(warn bound 2000 bytes\)$/);
  });

  /** `_carry_warn_bytes_says`, read from bash in the box's own HOME: the words are never a pasted copy. */
  const says = (b: Box): string => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n_carry_warn_bytes_says`], { env: doctorEnv(b.home), encoding: 'utf8', timeout: 30_000 });
    return (r.stdout ?? '').replace(/\n$/, '');
  };
  /** D-7919: the WARN names the words and never the value. */
  const shapeWarn = (b: Box): string =>
    `WARN carry-copies: CCRC_CARRY_COPY_WARN_BYTES must be ${says(b)} — the value in ~/.ccrc/ccrc.env is not, so neither figure is judged`;

  it('a value that is not a whole number of bytes is reported, and neither figure is judged', () => {
    const b = box('ccrc-doctor-carry-knob-bad-', { env: ['CCRC_CARRY_COPY_WARN_BYTES=10G'], log: [first(DAY, 5)] });
    expect(says(b), 'the words come from bash').not.toBe('');
    const r = check(b);
    expect(r.line).toBe(shapeWarn(b));
    expect(r.line).not.toContain('10G');
    const zero = box('ccrc-doctor-carry-knob-zero-', { env: ['CCRC_CARRY_COPY_WARN_BYTES=0'], log: [] });
    expect(check(zero).line).toMatch(/^WARN carry-copies: CCRC_CARRY_COPY_WARN_BYTES must be a whole number/);
  });

  // The exact WARN line and remedy of the shape check (D-7919 moved the value out of the line; the remedy is unchanged).
  it.each([['0'], ['0123'], ['9'.repeat(19)]])('W2-pin: %s is refused with exactly the words and its remedy, the value absent', (v) => {
    const b = box('ccrc-doctor-carry-knob-pin-', { env: [`CCRC_CARRY_COPY_WARN_BYTES=${v}`], log: [] });
    const r = check(b);
    expect(r.line).toBe(shapeWarn(b));
    expect(r.line.includes(v), 'the value is not in the line').toBe(false);
    expect(r.remedy).toContain('set CCRC_CARRY_COPY_WARN_BYTES=<bytes> in ~/.ccrc/ccrc.env (default 10737418240, 10 GiB), or remove the line');
  });
  it('W2-pin: 18 nines is the widest accepted value and is judged', () => {
    const b = box('ccrc-doctor-carry-knob-18-', { env: [`CCRC_CARRY_COPY_WARN_BYTES=${'9'.repeat(18)}`], log: [first(DAY, 5)] });
    expect(check(b).line).toMatch(/^PASS carry-copies: .*\(warn bound 999999999999999999 bytes\)$/);
  });
});
