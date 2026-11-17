// `_role_long_lived` (the Overlord W1 ccd arms, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ccd-arms.md` Task 4,
// question 5, slug long-lived-is-projected): ccd learns that a session's role is long-lived from the launch row its route's
// `profile` names, `FLEET_ROLES.longLived` projected into `ccd/lib/launch-profiles.json`, and holds no role-name list of its
// own. rc 0 long-lived, rc 1 not (no `profile` entry, or the row's `longLived` is false), rc 2 undecidable, which every
// caller reads as long-lived: the hold-down then costs at most an hour on the fallback class, and a skipped `/model` one
// keystroke, and neither moves the session.
//
// FIXTURE HOME ONLY (`makeCcdHarness`): `$REG` is `$HOME/.cc-sessions`, and nothing here starts or stops a session.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { FLEET_ROLE_NAMES, FLEET_ROLES } from '../../shared/fleetRoles.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-long-lived-'); });
afterEach(() => {
  try { fs.chmodSync(path.join(h.home, 'lp.json'), 0o644); } catch { /* absent */ }
  h.cleanup();
});

const ID = 'lane-a-project-a';
const REG = (): string => path.join(h.home, '.cc-sessions');
const profileAt = (): string => path.join(REG(), `${ID}.profile`);
const rc = (pre = '', env: NodeJS.ProcessEnv = {}): number =>
  Number(h.sh(`${pre} _role_long_lived ${ID}; echo "rc=$?"`, env).match(/rc=(\d+)$/)![1]);
/** A launch profiles file of the fixture's own, which the snippet points ccd at. */
const lp = (body: string): string => { fs.writeFileSync(path.join(h.home, 'lp.json'), body); return 'LAUNCH_PROFILES_JSON="$HOME/lp.json";'; };

describe('_role_long_lived reads FLEET_ROLES.longLived through the launch row (slug long-lived-is-projected)', () => {
  it('the long-lived rows answer 0: overlord and coordinator', () => {
    for (const r of ['overlord', 'coordinator']) {
      fs.writeFileSync(profileAt(), r);
      expect(rc(), r).toBe(0);
    }
  });

  it('every other row answers 1: plain, worker, reviewer, auditor and replay', () => {
    for (const r of ['plain', 'worker', 'reviewer', 'auditor', 'replay']) {
      fs.writeFileSync(profileAt(), r);
      expect(rc(), r).toBe(1);
    }
  });

  it('every role of FLEET_ROLES answers by its own column, through the committed file (no role list in ccd)', () => {
    for (const r of FLEET_ROLE_NAMES) {
      fs.writeFileSync(profileAt(), r);
      expect(rc(), r).toBe(FLEET_ROLES[r].longLived ? 0 : 1);
    }
  });

  it('no profile entry answers 1: today\'s behaviour, and no jq is run', () => {
    expect(rc('jq() { echo jq >> "$HOME/jq-ran"; command jq "$@"; };')).toBe(1);
    expect(fs.existsSync(path.join(h.home, 'jq-ran'))).toBe(false);
  });

  it('a profile written by _reg_set reads as the row (the field\'s own writer)', () => {
    h.sh(`_reg_set ${ID} profile coordinator`);
    expect(rc()).toBe(0);
  });

  it.each([
    ['a FIFO', () => { execFileSync('mkfifo', [profileAt()]); }],
    ['a word with a capital', () => { fs.writeFileSync(profileAt(), 'Coordinator'); }],
    ['a word that names no row', () => { fs.writeFileSync(profileAt(), 'nosuchrole'); }],
    ['an empty entry', () => { fs.writeFileSync(profileAt(), ''); }],
    ['seventeen letters', () => { fs.writeFileSync(profileAt(), 'abcdefghijklmnopq'); }],
    ['a word and a NUL', () => { fs.writeFileSync(profileAt(), Buffer.from('plain\0', 'latin1')); }],
    ['a dangling link', () => { fs.symlinkSync(path.join(h.home, 'nowhere'), profileAt()); }],
    ['a link to a row word', () => { fs.writeFileSync(path.join(h.home, 'word'), 'plain'); fs.symlinkSync(path.join(h.home, 'word'), profileAt()); }],
    ['a directory', () => { fs.mkdirSync(profileAt()); }],
  ])('%s at the profile answers 2, undecidable', (_what, set) => {
    set();
    expect(rc()).toBe(2);
  });

  it('a mode-000 profile answers 2 (skipped as root, who reads it)', () => {
    if (process.getuid?.() === 0) return;
    fs.writeFileSync(profileAt(), 'plain'); fs.chmodSync(profileAt(), 0o000);
    try { expect(rc()).toBe(2); } finally { fs.chmodSync(profileAt(), 0o644); }
  });

  it('a FIFO swapped in after the -f test cannot block the read: the bound answers 2 within seconds', () => {
    fs.writeFileSync(profileAt(), 'plain');
    const swap = `eval "$(declare -f _plat_timeout | sed '1s/^_plat_timeout/_pt_real/')";`
      + ` _plat_timeout() { rm -f -- "$REG/${ID}.profile"; mkfifo "$REG/${ID}.profile"; _pt_real "$@"; };`;
    const t0 = Date.now();
    expect(rc(swap)).toBe(2);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });

  it.each([
    ['a file without the key', JSON.stringify({ coordinator: { env: {} } })],
    ['a key that is the string "yes"', JSON.stringify({ coordinator: { longLived: 'yes' } })],
    ['a key that is null', JSON.stringify({ coordinator: { longLived: null } })],
    ['a file that is not JSON', '{ not json'],
    ['a file with no such row', JSON.stringify({ plain: { longLived: false } })],
  ])('a launch profiles file with %s answers 2, never 1', (_what, body) => {
    fs.writeFileSync(profileAt(), 'coordinator');
    expect(rc(lp(body))).toBe(2);
  });

  it('a launch profiles file that cannot be read answers 2 (skipped as root)', () => {
    if (process.getuid?.() === 0) return;
    fs.writeFileSync(profileAt(), 'coordinator');
    const pre = lp(JSON.stringify({ coordinator: { longLived: true } }));
    fs.chmodSync(path.join(h.home, 'lp.json'), 0o000);
    expect(rc(pre)).toBe(2);
  });

  it('an absent launch profiles file answers 2', () => {
    fs.writeFileSync(profileAt(), 'coordinator');
    expect(rc('LAUNCH_PROFILES_JSON="$HOME/nowhere.json";')).toBe(2);
  });

  it('the same bytes give the same verdict under LC_ALL=C and en_US.UTF-8', () => {
    for (const [body, want] of [['coordinator', 0], ['plain', 1], ['Plain', 2], ['pläin', 2]] as const) {
      fs.writeFileSync(profileAt(), body, 'utf8');
      expect(rc('', { LC_ALL: 'C' }), body).toBe(want);
      expect(rc('', { LC_ALL: 'en_US.UTF-8' }), body).toBe(want);
    }
  });

  it('writes nothing: the registry\'s entries are the same before and after', () => {
    fs.writeFileSync(profileAt(), 'coordinator');
    const before = fs.readdirSync(REG()).sort();
    rc();
    expect(fs.readdirSync(REG()).sort()).toEqual(before);
  });
});

// Review 2336 F3 (the Overlord W1 ccd arms, PR C2): `_keep_awake_ours` and `_role_long_lived` each read one registry field
// bounded in size and time, as `_fresh_pick_field_to` does, so both move onto that one reader. These rows pin both
// functions' answers over every entry shape BEFORE the move, green on the tree before it; the move changes no row.
describe('the bounded field reads of _keep_awake_ours and _role_long_lived, pinned before they share one reader (review 2336 F3)', () => {
  const at = (field: string): string => path.join(REG(), `${ID}.${field}`);
  type Make = (f: string) => void;
  const SHAPES: ReadonlyArray<readonly [string, Make]> = [
    ['absent', () => { /* nothing */ }],
    ['a dangling link', (f) => { fs.symlinkSync(`${f}.nowhere`, f); }],
    ['a directory', (f) => { fs.mkdirSync(f); }],
    ['a FIFO', (f) => { h.sh(`mkfifo '${f}'`); }],
  ];
  const ours = (pre = ''): string => h.sh(`${pre} _keep_awake_ours ${ID} no-roll; echo "$?:$KEEP_AWAKE_READ"`);

  it('_keep_awake_ours: one answer per entry shape', () => {
    const rows: Array<readonly [string, Make, string]> = [
      ...SHAPES.map(([n, m]) => [n, m, n === 'absent' ? '1:absent' : '1:unreadable'] as const),
      ['the stamp', (f) => { fs.writeFileSync(f, 'keep-awake v1'); }, '0:ours'],
      ['a link to the stamp', (f) => { fs.writeFileSync(`${f}.real`, 'keep-awake v1'); fs.symlinkSync(`${f}.real`, f); }, '1:unreadable'],
      ['the stamp and a newline', (f) => { fs.writeFileSync(f, 'keep-awake v1\n'); }, '1:foreign'],
      ['the stamp and a NUL', (f) => { fs.writeFileSync(f, 'keep-awake v1\0'); }, '1:foreign'],
      ['empty', (f) => { fs.writeFileSync(f, ''); }, '1:foreign'],
      ['70 bytes opening with the stamp', (f) => { fs.writeFileSync(f, `keep-awake v1${'x'.repeat(57)}`); }, '1:foreign'],
    ];
    for (const [name, make, want] of rows) {
      fs.rmSync(at('no-roll'), { recursive: true, force: true }); fs.rmSync(`${at('no-roll')}.real`, { force: true });
      make(at('no-roll'));
      expect(ours(), name).toBe(want);
    }
  });

  it('_role_long_lived: one answer per entry shape', () => {
    const rows: Array<readonly [string, Make, number]> = [
      ...SHAPES.map(([n, m]) => [n, m, n === 'absent' ? 1 : 2] as const),
      ['a link to a long-lived row', (f) => { fs.writeFileSync(`${f}.real`, 'overlord'); fs.symlinkSync(`${f}.real`, f); }, 2],
      ['a NUL after a row', (f) => { fs.writeFileSync(f, 'overlord\0'); }, 2],
      ['17 bytes', (f) => { fs.writeFileSync(f, 'q'.repeat(17)); }, 2],
      ['16 bytes, no such row', (f) => { fs.writeFileSync(f, 'q'.repeat(16)); }, 2],
    ];
    for (const [name, make, want] of rows) {
      fs.rmSync(profileAt(), { recursive: true, force: true }); fs.rmSync(`${profileAt()}.real`, { force: true });
      make(profileAt());
      expect(rc(), name).toBe(want);
    }
  });

  it('a registry that cannot be searched: both read the entry as absent (skipped as root)', () => {
    if (process.getuid?.() === 0) return;
    fs.writeFileSync(at('no-roll'), 'keep-awake v1'); fs.writeFileSync(profileAt(), 'overlord');
    fs.chmodSync(REG(), 0o600);
    try {
      expect(ours()).toBe('1:absent');
      expect(rc()).toBe(1);
    } finally { fs.chmodSync(REG(), 0o755); }
  });
});
