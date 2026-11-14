// A timer day: the timers lane under renewals, purges, unbuilt listings, late sets, mail-disabled windows and crashes
// (Overlord W1a, the timers piece, Task 8; spec §3.3.12, I17, §11.7). The control rows prove each invariant goes red on
// a hand-made sequence; the seeded rows run the real lane pass over a real coord.db. The named case is the spec's own:
// a worker sets a two-hour timer, is renewed, and the mail reaches the next generation.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../../src/coord/db.js';
import { CoordStore } from '../../src/coord/store.js';
import { gatherTimerFacts, timersPass } from '../../src/continuity/timerLane.js';
import { TIMER_MAIL_SENDER } from '../../../shared/continuity-timers.js';
import { mkTmp } from '../tmpHelpers.js';
import { TIMER_DAY_INVARIANTS, timerDay } from './timerDay.js';
import { assertScenario, simSeeds } from './run.js';
import type { SequenceLine } from './sequence.js';

type Row = [kind: string, id: string, state: string];
const seqOf = (rows: readonly Row[]): SequenceLine[] =>
  rows.map(([kind, id, state], i) => ({ seq: i + 1, at: i * 1_000, kind, id, state, actor: 'lane' }));
const byName = (n: string) => TIMER_DAY_INVARIANTS.find((i) => i.name === n)!;
const FILE = 'test/sim/timer-day.test.ts';
/** 32 seeds in CI; CCRC_SIM=full runs 1,000. */
const DEFAULTS = Array.from({ length: process.env.CCRC_SIM === 'full' ? 1_000 : 32 }, (_, i) => i + 1);
const BOUND_MS = process.env.CCRC_SIM === 'full' ? 3_600_000 : 600_000;
const ok = 'mails=1;to=a;setter=a;stamp=s1;now=s1;read=s1;bornAfter=false;listing=listed';

describe('the timer day\'s invariants go red on a hand-made sequence', () => {
  it('CONTROL: T1 is red on a fired timer with no mail, two mails, or a mail to another identity', () => {
    expect(byName('T1').check(seqOf([['fire', 't1', ok]]))).toBeNull();
    expect(byName('T1').check(seqOf([['fire', 't1', 'mails=0;to=;setter=a;stamp=s1;now=s1']]))?.invariant).toBe('T1');
    expect(byName('T1').check(seqOf([['fire', 't1', 'mails=2;to=a,a;setter=a;stamp=s1;now=s1']]))?.invariant).toBe('T1');
    expect(byName('T1').check(seqOf([['fire', 't1', 'mails=1;to=b;setter=a;stamp=s1;now=s1']]))?.invariant).toBe('T1');
  });
  it('CONTROL: T2 is red on a fire whose stamp differed, whose setter was gone, or that the lane read as anything but a measured match', () => {
    expect(byName('T2').check(seqOf([['fire', 't1', ok.replace('now=s1', 'now=s2')]]))?.invariant).toBe('T2');
    expect(byName('T2').check(seqOf([['fire', 't1', ok.replace('now=s1', 'now=absent')]]))?.invariant).toBe('T2');
    for (const [from, to] of [['read=s1', 'read=unreadable'], ['read=s1', 'read=absent'], ['bornAfter=false', 'bornAfter=true'],
      ['listing=listed', 'listing=unmeasured'], ['listing=listed', 'listing=unlisted']]) {
      expect(byName('T2').check(seqOf([['fire', 't1', ok.replace(from!, to!)]]))?.invariant, to).toBe('T2');
    }
    expect(byName('T2').check(seqOf([['fire', 't1', ok]]))).toBeNull();
  });
  it('CONTROL: T3 is red on a timer fired twice', () => {
    expect(byName('T3').check(seqOf([['fire', 't1', ok], ['fire', 't1', ok]]))?.invariant).toBe('T3');
    expect(byName('T3').check(seqOf([['fire', 't1', ok], ['fire', 't2', ok]]))).toBeNull();
  });
  it('CONTROL: T4 is red on a live setter\'s timer cancelled setter-gone, listed or not', () => {
    expect(byName('T4').check(seqOf([['cancel', 't1', 'setter-gone;listed=listed;now=s1;stamp=s1']]))?.invariant).toBe('T4');
    expect(byName('T4').check(seqOf([['cancel', 't1', 'setter-gone;listed=unlisted;now=s1;stamp=s1']]))?.invariant).toBe('T4');
    expect(byName('T4').check(seqOf([['cancel', 't1', 'setter-gone;listed=unlisted;now=absent;stamp=s1']]))).toBeNull();
    expect(byName('T4').check(seqOf([['cancel', 't1', 'setter-gone;listed=listed;now=s2;stamp=s1']]))).toBeNull();
  });
  it('CONTROL: T5 is red on a pass that threw with no fault armed', () => {
    expect(byName('T5').check(seqOf([['server', 'threw', 'armed=false;boom']]))?.invariant).toBe('T5');
    expect(byName('T5').check(seqOf([['server', 'threw', 'armed=true;sim crash']]))).toBeNull();
  });
});

describe('the timer day on the real lane (I17)', () => {
  it('holds T1 to T5 on every default seed and reaches every edge', async () => {
    await assertScenario(timerDay(), TIMER_DAY_INVARIANTS, { seeds: simSeeds(DEFAULTS), testFile: FILE });
  }, BOUND_MS);
});

describe('the named case: a worker sets a two-hour timer, is renewed, and the mail reaches the next generation', () => {
  it('the renewal keeps the stamp, so the timer fires once, to the identity the next generation answers as', async () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-timer-day-'), '.ccrc', 'coord.db')));
    const T0 = Date.parse('2026-11-14T08:00:00Z');
    const ID = 'lane-a-project-a';
    const STAMP = '00000001-0000-4000-8000-000000000000';
    const set = s.insertTimer({ setter: ID, setterIncarnation: STAMP, setById: ID, setByUuid: 'conversation-1', role: 'worker',
      note: 'check the PR\'s checks', runId: null, programme: null, setAt: T0, dueAt: T0 + 2 * 3_600_000 });
    if (!set.ok) throw new Error('timer not set');
    // The renewal: a new conversation in the same registry row, whose `.generation` is unchanged.
    const listing = (at: number) => ({ listedAt: at - 1_000, listedIds: new Set([ID]), archivedIds: new Set<string>(), unmeasuredIds: new Set<string>(), mailDisabled: false });
    const reads = async () => ({ kind: 'measured' as const, incarnation: STAMP });
    const at = async (now: number) => timersPass({ coord: s, now, log: () => {} }, listing(now), await gatherTimerFacts(s, reads));
    expect((await at(T0 + 3_600_000)).fired).toEqual([]);
    const fired = await at(T0 + 2 * 3_600_000 + 30_000);
    expect(fired.fired.map((f) => f.ids)).toEqual([[set.id]]);
    expect((await at(T0 + 2 * 3_600_000 + 90_000)).fired).toEqual([]);
    const mail = s.db.prepare('SELECT toId, fromId, body FROM mail WHERE fromId = ?').all(TIMER_MAIL_SENDER) as
      { toId: string; fromId: string; body: string }[];
    expect(mail).toHaveLength(1);
    expect(mail[0]!.toId).toBe(ID);
    expect(mail[0]!.body).toContain('check the PR\'s checks');
  });
});
