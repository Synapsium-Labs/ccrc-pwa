// `ccd pr-admin-merge` (D-8124): the one gated door for an admin merge. FIXTURE HOME ONLY (`makePrHarness`); the verb
// runs as a sourced function with `gh`, `tmux` and `timeout` shell functions (`ccdAdminMergeFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CCD, ccdSource } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { AM_GH_STUB, HEAD_A, amCaller, amFixture, amRun, boxEnv, swapLog } from './ccdAdminMergeFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-am-'); });
afterEach(() => { h.cleanup(); });

const GOOD = `--repo owner-a/repo-a --pr 42 --head ${HEAD_A}`;
const reg = (name: string): string => path.join(h.home, '.cc-sessions', name);

describe('the gate before GitHub', () => {
  it('takes exactly --repo, --pr, --head in that order, and nothing else', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    for (const argv of [`--repo owner-a/repo-a --pr 42`, `--pr 42 --repo owner-a/repo-a --head ${HEAD_A}`,
      `--repo owner-a/repo-a --pr 42 --head ${HEAD_A} --admin`, `--repo owner-a --pr 42 --head ${HEAD_A}`,
      `--repo owner-a/repo-a --pr 042 --head ${HEAD_A}`, `--repo owner-a/repo-a --pr 42 --head ${HEAD_A.slice(1)}`,
      `--repo -x/repo-a --pr 42 --head ${HEAD_A}`, `--repo .x/repo-a --pr 42 --head ${HEAD_A}`,
      `--repo owner-a/-y --pr 42 --head ${HEAD_A}`, `--repo owner-a/repo-a --pr 42 --head ${'A'.repeat(40)}`]) {
      const r = amRun(h, argv);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd pr-admin-merge --repo <owner\/repo> --pr <n> --head <sha>/);
      expect(r.stdout, argv).toBe('');
    }
    expect(h.ghCalls()).toEqual([]);
    expect(swapLog(h), 'argv failures are not journaled').toEqual([]);
  });

  it('refuses setting-off with no gh call', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
    const r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-off: CCRC_ADMIN_MERGE is off']);
    expect(h.ghCalls()).toEqual([]);
  });

  it('an environment CCRC_ADMIN_MERGE=auto does not override the box file\'s off: the switch is the operator\'s', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
    const r = h.run(`${AM_GH_STUB} export TMUX_PANE=%1; export CCRC_ADMIN_MERGE=auto; cmd_pr_admin_merge ${GOOD}`);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-off: CCRC_ADMIN_MERGE is off']);
    expect(h.ghCalls()).toEqual([]);
  });

  it('a refused value or a missing reader reads as off: setting-unread, no gh call', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=on\n');
    const r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-unread: CCRC_ADMIN_MERGE must be auto or off (read as off)']);
    expect(h.ghCalls()).toEqual([]);

    // The reader moved away: a copy of ccd's directory without lib/ccrc-settings.sh, and no installed one under HOME.
    boxEnv(h, 'CCRC_ADMIN_MERGE=auto\n');
    const copy = path.join(h.home, 'ccd-copy');
    fs.cpSync(path.dirname(CCD), copy, { recursive: true });
    fs.rmSync(path.join(copy, 'lib', 'ccrc-settings.sh'));
    const r2 = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
      env: h.env({ A_SRC: path.join(copy, 'ccd'),
        A_SNIP: `${AM_GH_STUB} export TMUX_PANE=%1; cmd_pr_admin_merge ${GOOD}` }),
      cwd: h.home, encoding: 'utf8',
    });
    const out = r2.stdout.trim();
    expect(r2.status).toBe(2);
    expect(out).toBe('REFUSED setting-unread: the settings reader (ccrc-settings.sh) is missing or broken (read as off)');
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a caller it cannot name: no pane, no tmux answer, no registry row', () => {
    amFixture(h);
    // no pane at all
    amCaller(h, 'demo-quiet-basin');
    let r = amRun(h, GOOD, { pane: null });
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: no tmux pane']);
    // tmux answers nothing
    fs.rmSync(path.join(h.home, 'am', 'tmux-session'));
    r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: tmux names no ccrc session for this pane']);
    // tmux names a session that is not ccd-managed (no registry row)
    fs.writeFileSync(path.join(h.home, 'am', 'tmux-session'), 'cc-ghost-session\n');
    r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: no registry row for ghost-session']);
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a caller whose hold names a programme wave', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: 'program:landing-order wave:2/5 run:17' });
    const r = amRun(h, GOOD);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/^REFUSED not-coordinator: /);
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a caller carrying the child marker, readable or not', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { child: true });
    expect(amRun(h, GOOD).stdout).toMatch(/^REFUSED not-coordinator: demo-quiet-basin carries the child marker/);
    fs.chmodSync(reg('demo-quiet-basin.child'), 0o000);
    expect(amRun(h, GOOD).stdout).toMatch(/^REFUSED not-coordinator: demo-quiet-basin carries the child marker/);
    fs.chmodSync(reg('demo-quiet-basin.child'), 0o644);
    expect(h.ghCalls()).toEqual([]);
  });

  it('a hold that names no wave is not a worker hold (the hook reads it the same way)', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: 'waiting on the review' });
    const r = amRun(h, GOOD);
    expect(r.stdout, 'the gate passes; the reads that follow refuse for their own reason').not.toMatch(/not-coordinator|caller-unknown|setting-/);
    expect(h.ghCalls()[0]).toBe('api repos/owner-a/repo-a');
  });

  it('a padded or CRLF hold naming a wave is a worker hold: the door trims as the hook does', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    for (const raw of [' program:x wave:2\n', 'program:x wave:2 \n', 'program:x wave:2\r\n', '\nprogram:x wave:2\n',
      '\n\n  program:x wave:2/5 run:3 \t\r\n\n', 'program:x wave:2', `program:x wave:2${' '.repeat(200)}`]) {
      fs.writeFileSync(reg('demo-quiet-basin.hold'), raw);
      const r = amRun(h, GOOD);
      expect(r.code, JSON.stringify(raw)).toBe(2);
      expect(r.stdout, JSON.stringify(raw)).toMatch(/^REFUSED not-coordinator: demo-quiet-basin's hold reads program:x wave:2/);
    }
    expect(h.ghCalls()).toEqual([]);
  });

  it('padding does not turn a non-wave hold into a worker hold, and a hold that is not a regular file is refused', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    for (const raw of ['\n waiting on the review \r\n', 'program:x wave:2 and more\n', 'program:x\nwave:2\n', '\n \n']) {
      fs.writeFileSync(reg('demo-quiet-basin.hold'), raw);
      expect(amRun(h, GOOD).stdout, JSON.stringify(raw)).not.toMatch(/not-coordinator/);
    }
    fs.rmSync(reg('demo-quiet-basin.hold'));
    fs.mkdirSync(reg('demo-quiet-basin.hold'));
    expect(amRun(h, GOOD).stdout).toMatch(/^REFUSED not-coordinator: demo-quiet-basin's hold cannot be read/);
  });

  it('a hold longer than the hook\'s bound is not judged, as the hook does not judge it', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: `program:${'x'.repeat(130)} wave:2` });
    expect(amRun(h, GOOD).stdout).not.toMatch(/not-coordinator/);
  });

  it('journals a refusal past argv in swap.log with the caller and the reason', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
    amRun(h, GOOD);
    expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused demo-quiet-basin: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=setting-off$/);
  });

  it('journals an unnamed caller as ?', () => {
    amFixture(h);
    amRun(h, GOOD, { pane: null });
    expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused \?: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=caller-unknown$/);
  });

  it('is dispatched and named in the usage line, and the gate\'s gh calls never carry --admin', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    amRun(h, GOOD);
    for (const c of h.ghCalls()) expect(c).not.toMatch(/--admin/);
    const src = ccdSource();
    expect(src).toMatch(/^ {2}pr-admin-merge\) shift; cmd_pr_admin_merge "\$@" ;;$/m);
    expect(src).toMatch(/\|pr-open\|pr-admin-merge\|pr-state\|/);
  });
});
