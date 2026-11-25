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
import { TIMER_DAY_INVARIANTS, timerDay, timerDayDb } from './timerDay.js';
import { assertScenario, simSeeds, simulate } from './run.js';
import { gatherInvariantInput } from '../../src/coord/invariantFacts.js';
import { liveInvariant } from './livePredicate.js';
import type { SequenceLine } from './sequence.js';

type Row = [kind: string, id: string, state: string];
const seqOf = (rows: readonly Row[]): SequenceLine[] =>
  rows.map(([kind, id, state], i) => ({ seq: i + 1, at: i * 1_000, kind, id, state, actor: 'lane', actorKind: 'server' as const, known: true }));
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

describe('the timer day under the production I17 (D-8214: the live predicate through the simulator adapter; review F15)', () => {
  const I17 = liveInvariant('I17', () => gatherInvariantInput({
    db: timerDayDb()!, readJournal: () => ({ kind: 'absent' }), guardState: () => ({ kind: 'coherent' }),
  }));
  it('holds on every default seed, read over the day\'s own coord.db', async () => {
    for (const seed of simSeeds(DEFAULTS)) expect((await simulate(timerDay(), seed, [I17])).violations, `seed ${seed}`).toEqual([]);
  }, BOUND_MS);
  it('catches a fired row stamped with another mail\'s id, on the seed that plants it', async () => {
    expect((await simulate(timerDay(), 1, [I17])).violations).toEqual([]);
    const db = timerDayDb()!;
    const fired = db.prepare("SELECT id, setter FROM continuity_timers WHERE state = 'fired' ORDER BY id LIMIT 1").get() as { id: number; setter: string } | undefined;
    expect(fired).toBeDefined();
    const other = Number(db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (0, 'lane-b-project-a', 'u', ?, NULL, 'status', 's', 'b')")
      .run(fired!.setter).lastInsertRowid);
    db.prepare('UPDATE continuity_timers SET mailId = ? WHERE id = ?').run(other, fired!.id);
    expect(I17.check([])).toMatchObject({ invariant: 'I17', message: expect.stringContaining(`timer:${fired!.id}`) });
  }, BOUND_MS);
});

describe('the named case: a worker sets a two-hour timer, is renewed, and the mail reaches the next generation', () => {
  it('the renewal keeps the stamp, so the timer fires once, to the identity the next generation answers as', async () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-timer-day-'), '.ccrc', 'coord.db')));
    const T0 = Date.parse('2026-11-14T08:00:00Z');
    const ID = 'lane-a-project-a';
    const STAMP = '00000001-0000-4000-8000-000000000000';
    const set = s.insertTimer({ setRestoreGeneration: null, setter: ID, setterIncarnation: STAMP, setById: ID, setByUuid: 'conversation-1', role: 'worker',
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

// Overlord W1, the Overlord's timers (plan w1-overlord-timers.md Task 4): the role `overlord` as a setter across a rebind, a
// retire, and a restore with Confirm, on the real lane. Sequence B's I17 predicate is not on main, so the day's own check
// holds here, on every pass: each fired timer has exactly one mail naming it, from the timer sender, to its setter (the row
// keeps `overlord`), and no timer fires twice; a role timer fires only under a coherent guard and its own term.
describe("the Overlord's day: the role across a rebind, a retire and a restore with Confirm (I17)", () => {
  it('every fired timer has one mail, to the role, and fires once; nothing fires while the guard is not coherent', async () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-timer-day-ov-'), '.ccrc', 'coord.db')));
    const T0 = Date.parse('2026-11-14T08:00:00Z');
    const H = 3_600_000;
    const view = (bound: string | null, designatedTerm: number) => ({ bound: bound === null ? null : { sessionId: bound, generation: 'g' }, pending: null,
      term: designatedTerm + 1, designatedTerm, model: 'opus' as const, accountPools: { pools: [], untagged: true }, pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [] });
    type D = ReturnType<CoordStore['designationRead']>;
    let designation: D = { kind: 'designated', sessionId: 'lane-o-project-a', term: 4, row: view('lane-o-project-a', 3) };
    let authority: 'coherent' | 'not-coherent' = 'coherent';
    let restore = 0;
    s.designationRead = () => designation;
    const plant = (dueIn: number, term = '3', restoreAt: number | null = restore): number => {
      const r = s.insertTimer({ setRestoreGeneration: restoreAt, setter: 'overlord', setterIncarnation: term, setById: 'lane-o-project-a', setByUuid: 'u',
        role: 'overlord', note: `due in ${dueIn / H} h`, runId: null, programme: null, setAt: T0, dueAt: T0 + dueIn });
      if (!r.ok) throw new Error('timer not set');
      return r.id;
    };
    const listing = (at: number) => ({ listedAt: at - 1_000, listedIds: new Set<string>(), archivedIds: new Set<string>(), unmeasuredIds: new Set<string>(), mailDisabled: false });
    const firedIds = new Set<number>();
    const check = (): void => {
      const rows = s.db.prepare("SELECT id, setter, state, mailId FROM continuity_timers WHERE state = 'fired'").all() as { id: number; setter: string; mailId: number }[];
      for (const t of rows) {
        const mails = s.db.prepare('SELECT fromId, toId FROM mail WHERE id = ?').all(t.mailId) as { fromId: string; toId: string }[];
        expect(mails, `timer ${t.id}`).toStrictEqual([{ fromId: TIMER_MAIL_SENDER, toId: t.setter }].map((x) => expect.objectContaining(x)));
      }
    };
    const at = async (now: number) => {
      const r = timersPass({ coord: s, now, log: () => {}, authority: () => authority, restoreGeneration: () => ({ kind: 'measured', n: restore }) },
        listing(now), await gatherTimerFacts(s, async () => ({ kind: 'measured' as const, incarnation: 'g' })));
      for (const f of r.fired) for (const id of f.ids) { expect(firedIds.has(id), `timer ${id} fired twice`).toBe(false); firedIds.add(id); }
      check();
      return r;
    };
    const first = plant(H);
    const afterRebind = plant(3 * H);
    const restored = plant(5 * H);
    expect((await at(T0 + H + 1)).fired.map((f) => f.ids)).toStrictEqual([[first]]);
    // A rebind keeps the term: the next fire is delivered to the new body.
    designation = { kind: 'designated', sessionId: 'lane-n-project-a', term: 5, row: view('lane-n-project-a', 3) };
    expect((await at(T0 + 3 * H + 1)).fired.map((f) => f.ids)).toStrictEqual([[afterRebind]]);
    expect((s.db.prepare('SELECT d.toId FROM mail_deliveries d JOIN continuity_timers t ON t.mailId = d.mailId WHERE t.id = ?').get(afterRebind) as { toId: string }).toId)
      .toBe('lane-n-project-a');
    // A restore brings the first timer back pending and due; the guard is not coherent until Confirm: nothing fires or cancels.
    s.db.prepare("UPDATE continuity_timers SET state = 'pending', firedAt = NULL, mailId = NULL WHERE id = ?").run(first);
    firedIds.delete(first);
    authority = 'not-coherent';
    for (const now of [T0 + 5 * H + 1, T0 + 6 * H]) {
      const r = await at(now);
      expect([r.fired, r.cancelled]).toStrictEqual([[], []]);
    }
    // Confirm: coherent, restore generation 1; the timers set before it fire with the restore line.
    authority = 'coherent'; restore = 1;
    const confirmed = await at(T0 + 6 * H + 1);
    expect(confirmed.fired.flatMap((f) => f.ids).sort()).toStrictEqual([first, restored].sort());
    const body = (s.db.prepare("SELECT body FROM mail WHERE toId = 'overlord' ORDER BY id DESC LIMIT 1").get() as { body: string }).body;
    expect(body).toContain('Set before restore 1 of the coordination database');
    // A retire: the role's remaining timer is cancelled retired and never mailed.
    const last = plant(9 * H, '3', 1);
    designation = { kind: 'not-designated', row: null };
    const retired = await at(T0 + 9 * H + 1);
    expect([retired.fired, retired.cancelled]).toStrictEqual([[], [{ id: last, reason: 'retired' }]]);
  });
});
