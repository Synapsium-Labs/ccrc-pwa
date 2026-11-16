// The hold-down (the Overlord W1 ccd arms, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ccd-arms.md` Task 4;
// spec 2026-11-09 §3.4 H16, Table 11.5b; questions 3 and 4): a long-lived role keeps its fallback class for
// `ROUTE_HOLD_DOWN_S` after its degraded stamp was written, though its intended class is servable again. ccd's alone, asked
// at the settle's servable arm (`_route_holddown_settle`) and, from PR C, the fresh pick's first step
// (`_route_holddown_holds`, which writes nothing), and never inside `_route_restore`, so the stale-intent clear is never
// held. The settle's own cases (what `_spawn_start` composes) are in `ccd-route-degrade.test.ts`.
//
// ccd's clock is a fixture seam here: `_now_s_to` answers `$NOW`, and the stamp's mtime is set with `touch -d @<epoch>`.
// FIXTURE HOME ONLY (`makeCcdHarness`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { LEAST_AGE_MS } from '../../shared/continuity.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-holddown-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const NOW = 1_800_000_000;
const REG = (): string => path.join(h.home, '.cc-sessions');
const stampAt = (): string => path.join(REG(), `${ID}.degraded`);
const CLOCK = `_now_s_to() { printf -v "$1" '%s' ${NOW}; };`;
/** A row with a profile (or none) and a `degraded=opus` stamp whose mtime is `NOW - ageS`. */
const row = (profile: string | null, ageS: number): void => {
  h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus${profile ? `; _reg_set ${ID} profile ${profile}` : ''}`);
  h.sh(`touch -d @${NOW - ageS} "$REG/${ID}.degraded"`);
};
const holds = (pre = CLOCK): number => Number(h.sh(`${pre} _route_holddown_holds ${ID}; echo "rc=$?"`).match(/rc=(\d+)$/)![1]);
const settle = (pre = CLOCK): number => Number(h.sh(`${pre} _route_holddown_settle ${ID} opus; echo "rc=$?"`).match(/rc=(\d+)$/)![1]);
const mtime = (): number => Math.floor(fs.statSync(stampAt()).mtimeMs / 1000);
const log = (): string => { try { return fs.readFileSync(path.join(REG(), 'swap.log'), 'utf8'); } catch { return ''; } };
const restamps = (): string[] => log().split('\n').filter((l) => l.includes(`holddown-restamp ${ID}:`));
const LIB = path.resolve(__dirname, '../../ccd/lib/long-lived.sh');

describe('_route_holddown_holds: the decider, which writes nothing', () => {
  it.each([['coordinator'], ['overlord']])('profile %s: a stamp one second old holds (rc 0)', (p) => {
    row(p, 1);
    expect(holds()).toBe(0);
  });

  it.each([['plain'], [null]])('profile %s: a stamp one second old may land (rc 1), as today', (p) => {
    row(p, 1);
    expect(holds()).toBe(1);
  });

  it('an undecidable profile (a word that names no row) holds: undecidable reads long-lived', () => {
    row('nosuchrole', 1);
    expect(holds()).toBe(0);
  });

  it('the boundary: 3,599 s holds, 3,600 s and 3,601 s restore', () => {
    row('coordinator', 3599); expect(holds()).toBe(0);
    h.sh(`touch -d @${NOW - 3600} "$REG/${ID}.degraded"`); expect(holds()).toBe(1);
    h.sh(`touch -d @${NOW - 3601} "$REG/${ID}.degraded"`); expect(holds()).toBe(1);
  });

  it('a stamp an hour in the future answers 3 and leaves the stamp\'s mtime as it was', () => {
    row('coordinator', -3600);
    expect(holds()).toBe(3);
    expect(mtime()).toBe(NOW + 3600);
    expect(restamps()).toEqual([]);
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });

  it('a stamp time that cannot be read holds', () => {
    row('coordinator', 7200);
    expect(holds(`${CLOCK} _plat_mtime() { echo 'not a time'; };`)).toBe(0);
    expect(holds(`${CLOCK} _plat_mtime() { return 1; };`)).toBe(0);
  });

  it('writes nothing, on any answer: the registry is the same before and after', () => {
    for (const [p, age] of [['coordinator', 1], ['coordinator', -3600], ['plain', 1], ['coordinator', 7200]] as const) {
      fs.rmSync(REG(), { recursive: true, force: true }); fs.mkdirSync(REG(), { recursive: true });
      row(p, age);
      const before = fs.readdirSync(REG()).sort().map((f) => [f, fs.statSync(path.join(REG(), f)).mtimeMs]);
      holds();
      expect(fs.readdirSync(REG()).sort().map((f) => [f, fs.statSync(path.join(REG(), f)).mtimeMs]), `${p} ${age}`).toEqual(before);
    }
  });

  it('the same bytes give the same verdict under LC_ALL=C and en_US.UTF-8', () => {
    for (const [p, age, want] of [['coordinator', 1, 0], ['plain', 1, 1], ['coordinator', 3601, 1]] as const) {
      fs.rmSync(REG(), { recursive: true, force: true }); fs.mkdirSync(REG(), { recursive: true });
      row(p, age);
      for (const lc of ['C', 'en_US.UTF-8']) {
        expect(Number(h.sh(`${CLOCK} _route_holddown_holds ${ID}; echo "rc=$?"`, { LC_ALL: lc }).match(/rc=(\d+)$/)![1]), `${p} ${age} ${lc}`).toBe(want);
      }
    }
  });
});

describe('_route_holddown_settle: the settle\'s act on the decider\'s answer', () => {
  it('a hold answers 0 and writes nothing; a landing answers 1 and writes nothing', () => {
    row('coordinator', 1);
    expect(settle()).toBe(0);
    expect(mtime()).toBe(NOW - 1);
    h.sh(`touch -d @${NOW - 3601} "$REG/${ID}.degraded"`);
    expect(settle()).toBe(1);
    expect(h.reg(ID, 'degraded'), 'the settle does not clear it: _route_restore does').toBe('opus');
    expect(restamps()).toEqual([]);
  });

  it('a stamp later than ccd\'s clock is written again as now, its value unchanged, with one line; a second settle holds without a second', () => {
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus; _reg_set ${ID} profile coordinator`);
    const future = Math.floor(Date.now() / 1000) + 3600;
    h.sh(`touch -d @${future} "$REG/${ID}.degraded"`);
    expect(settle('')).toBe(0);   // ccd's own clock
    expect(h.reg(ID, 'degraded')).toBe('opus');
    expect(mtime()).toBeLessThan(future);
    expect(mtime()).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(restamps()).toHaveLength(1);
    expect(restamps()[0]).toContain('opus written again as now');
    expect(eventsOf(h.home, 'route'), 'the time moves, never the class: no route row').toHaveLength(0);
    expect(settle('')).toBe(0);
    expect(restamps()).toHaveLength(1);
  });

  it('not long-lived: a stamp later than the clock is not written again (today)', () => {
    row('plain', -3600);
    expect(settle()).toBe(1);
    expect(mtime()).toBe(NOW + 3600);
    expect(restamps()).toEqual([]);
  });
});

describe('the stale-intent clear is never held (question 4)', () => {
  it('a long-lived row with a one-second stamp and a new intended class is restored at once', () => {
    h.sh(`_reg_set ${ID} class haiku; _reg_set ${ID} degraded opus; _reg_set ${ID} profile overlord`);
    h.sh(`_route_stale_degrade_clear ${ID} haiku`);   // ccd's own clock: the stamp is a second old, inside the hold-down
    expect(h.reg(ID, 'degraded')).toBeNull();
    expect(String(eventsOf(h.home, 'route')[0]!['detail'])).toBe('degraded: opus -> ∅');
  });
});

describe('ROUTE_HOLD_DOWN_S (Table 11.5b)', () => {
  it('is one hour, harvested from the library, and longer than a generation\'s least age', () => {
    const m = /^ROUTE_HOLD_DOWN_S=(\d+)$/m.exec(fs.readFileSync(LIB, 'utf8'));
    expect(m).not.toBeNull();
    const s = Number(m![1]);
    expect(s).toBe(3600);
    expect(s * 1000).toBeGreaterThan(LEAST_AGE_MS);
    expect(h.sh('printf %s "$ROUTE_HOLD_DOWN_S"')).toBe(String(s));
  });
});
