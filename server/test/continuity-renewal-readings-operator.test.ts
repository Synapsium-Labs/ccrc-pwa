// Overlord W1, the renewal readings, PR F (plan `w1-renewal-readings.md`, Task 9): the operator's words. `turns` is the private
// store's count of the messages recorded since the generation's start (`OperatorModelStore.messagesSince`), read by the wiring for
// an Overlord generation and passed through; with no private store in the wiring's deps it keeps the lane's `W1`. The soft
// `operatorQuietObservedMs` of an Overlord generation is the `@overlord` mark's observed quiet, read by the lane through the
// hand-offs piece's one mark reader (`operatorQuietOf`) from the same marks read it gives a coordinator, after the pass aged them
// (slug overlord-quiet-read-in-the-lane). A real private store, a real coord.db, fixture HOMEs and the fake time ports.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import { generationsPass, renewalInputsOf, type GenReadings, type GenerationsDeps, type RegistryFacts } from '../src/continuity/generationsLane.js';
import { renewalDue } from '../src/continuity/renewalDue.js';
import { renewalReadingsOf, type ReadingsCoord } from '../src/continuity/renewalReadingsWiring.js';
import { softRenewalMay, type SoftInputs } from '../src/continuity/softRenewal.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { BREAK_NO_MESSAGE_MS, LEAST_AGE_MS, OPERATOR_MARK_MS, RENEWAL_LANE_PERIOD_MS, TURNS_SOFT } from '../../shared/continuity.js';
import { OVERLORD_OPERATOR_MARK } from '../../shared/operatorMessages.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const OVERLORD = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const MIN = 60_000;
const START = Date.UTC(2026, 5, 10, 12, 0, 0);

// ── The private store, real ──────────────────────────────────────────────────────────────────────────────────────

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const issuer = (): PrivacyIssuer => {
  let last = 0;
  return { kind: 'ready', issue: (storeHighest) => { last = Math.max(storeHighest ?? 0, last) + 1; return { ok: true, id: last }; } };
};
const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen) db.close(); });
function privateStore(): { db: DatabaseSync; store: OperatorModelStore; say(at: number, n?: number): void } {
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-rr-f-opmodel-')));
  opened.push(db);
  const store = new OperatorModelStore(db, issuer());
  const say = (at: number, n = 1): void => {
    for (let i = 0; i < n; i++) {
      const r = store.recordMessage({ at, sessionId: OVERLORD, term: 1, actor: ACTOR, text: 'hello', mark: false, composedKey: null });
      if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
    }
  };
  return { db, store, say };
}

// ── The wiring's `turns` ─────────────────────────────────────────────────────────────────────────────────────────

const gen = (over: Partial<GenRow> = {}): GenRow =>
  ({ id: 1, sessionId: OVERLORD, role: 'overlord', model: 'claude-opus-5-5', startReportedAt: START, ...over }) as GenRow;
const base: GenReadings = { usage: { kind: 'absent' }, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
  behind: { kind: 'measured', value: false } };
const coord: ReadingsCoord = {
  closedSpotProbes: () => ({ ok: true, spots: [] }),
  backstopRead: () => ({ ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true, setAt: 0 } }),
  designationRead: () => ({ kind: 'not-designated', row: null }),
  raiseLatch: () => { throw new Error('no latch in these tests'); },
};
const deps = (operatorModel: Pick<OperatorModelStore, 'messagesSince'> | undefined, logs: string[] = []) => ({
  time: { clock: { wall: () => START + 86_400_000 }, entropy: { hex: (n: number) => 'a'.repeat(2 * n) } }, log: (l: string) => logs.push(l),
  ...(operatorModel === undefined ? {} : { operatorModel }),
});
const turnsOf = async (operatorModel: Pick<OperatorModelStore, 'messagesSince'> | undefined, g: GenRow = gen(), logs: string[] = []) =>
  (await renewalReadingsOf(deps(operatorModel, logs), coord, []).w1(g, base)).w1?.turns;
/** The lane's inputs with the wiring's answer spread over its defaults, as a pass builds them. */
const dueOf = async (operatorModel: Pick<OperatorModelStore, 'messagesSince'>) => {
  const more = await renewalReadingsOf(deps(operatorModel), coord, []).w1(gen(), base);
  const unknown = { kind: 'unmeasured', why: 'not read here' } as const;
  return renewalDue(renewalInputsOf(gen(), { ...base, w1: more.w1 }, unknown, START + 86_400_000, unknown));
};

describe('turns: the messages recorded since the generation\'s start (PR F, Task 9)', () => {
  it(`more than ${TURNS_SOFT} messages since the start make \`turns\` due, soft: 41 is due, 40 is not`, async () => {
    expect(TURNS_SOFT).toBe(40);
    const at41 = privateStore();
    at41.say(START + MIN, 41);
    expect(await turnsOf(at41.store)).toEqual({ kind: 'measured', value: 41 });
    expect(await dueOf(at41.store)).toMatchObject({ due: true, cls: 'soft', why: 'turns' });
    const at40 = privateStore();
    at40.say(START + MIN, 40);
    expect(await turnsOf(at40.store)).toEqual({ kind: 'measured', value: 40 });
    const d = await dueOf(at40.store);
    expect(d.due && d.why === 'turns').toBe(false);
    expect(d.blind).not.toContain('turns');
  });

  it('messages before the start are not counted; one at the start\'s own instant is', async () => {
    const p = privateStore();
    p.say(START - 1, 30);
    p.say(START, 1);
    p.say(START + MIN, 2);
    expect(await turnsOf(p.store)).toEqual({ kind: 'measured', value: 3 });
    expect(await turnsOf(p.store, gen({ startReportedAt: START + MIN }))).toEqual({ kind: 'measured', value: 2 });
  });

  it('none since the start is a measured 0, never unmeasured', async () => {
    const p = privateStore();
    p.say(START - MIN, 50);
    expect(await turnsOf(p.store)).toEqual({ kind: 'measured', value: 0 });
  });

  it('an unreadable store reads unmeasured with the store\'s own reason, and `turns` is blind, never due', async () => {
    const p = privateStore();
    p.say(START + MIN, 50);
    p.db.close();
    expect(await turnsOf(p.store)).toEqual({ kind: 'unmeasured', why: 'the private store is not open' });
    const d = await dueOf(p.store);
    expect(d.blind).toContain('turns');
    expect(d.due && d.why === 'turns').toBe(false);
  });

  it('a read that throws makes only `turns` unmeasured `turns read failed`, logged once a pass; the other readings stand', async () => {
    const logs: string[] = [];
    const throwing = { messagesSince: () => { throw new Error('disk'); } };
    const pass = renewalReadingsOf(deps(throwing, logs), coord, []);
    const one = await pass.w1(gen({ id: 1 }), base);
    const two = await pass.w1(gen({ id: 2 }), base);
    for (const r of [one, two]) {
      expect(r.w1?.turns).toEqual({ kind: 'unmeasured', why: 'turns read failed' });
      expect(r.w1?.backstopDue).toEqual({ kind: 'measured', value: true });
    }
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('disk');
  });

  it('with no private store in the deps, `turns` is not answered and keeps the lane\'s `W1`', async () => {
    const r = await renewalReadingsOf(deps(undefined), coord, []).w1(gen(), base);
    expect(r.w1 !== undefined && 'turns' in r.w1).toBe(false);
    const unknown = { kind: 'unmeasured', why: 'not read here' } as const;
    expect(renewalInputsOf(gen(), { ...base, w1: r.w1 }, unknown, START, unknown).turns).toEqual({ kind: 'unmeasured', why: 'W1' });
  });

  it('a coordinator generation gets no `turns`, and the store is not asked', async () => {
    const asked: number[] = [];
    const r = await renewalReadingsOf(deps({ messagesSince: (s) => { asked.push(s); return { kind: 'measured', value: 99 }; } }), coord, [])
      .w1(gen({ role: 'coordinator' }), base);
    expect(r.w1).toEqual({});
    expect(asked).toEqual([]);
  });

  it('the store is asked for the generation\'s own start', async () => {
    const asked: number[] = [];
    await renewalReadingsOf(deps({ messagesSince: (s) => { asked.push(s); return { kind: 'measured', value: 0 }; } }), coord, [])
      .w1(gen({ startReportedAt: START + 7 }), base);
    expect(asked).toEqual([START + 7]);
  });
});

// ── The lane's soft quiet for the Overlord ───────────────────────────────────────────────────────────────────────

interface LaneFx { s: CoordStore; t: ReturnType<typeof fakeTime>; soft: SoftInputs[]; pass(soft?: GenReadings['soft']): ReturnType<typeof generationsPass> }

/** The Overlord's generation at rest in shadow past its least age, with a soft due every pass and a free hold table; the
 *  permit's inputs are recorded, and then decided by the real `softRenewalMay` unless `hold`. */
function laneFx(hold = true): LaneFx {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-rr-f-lane-'), '.ccrc', 'coord.db')));
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const st = s.insertStart({ sessionId: OVERLORD, reportId: 'r-1', uuid: U1, source: 'startup', model: 'claude-opus-5-5', rowIncarnation: 'inc',
    reportedAt: t.ports.clock.wall(), receivedAt: t.ports.clock.wall() });
  if (!st.ok) throw new Error('start');
  const w = s.mintGeneration({ identity: OVERLORD, sessionId: OVERLORD, role: 'overlord', term: 1, rowIncarnation: 'inc', startId: st.id,
    startReportedAt: t.ports.clock.wall(), resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'woken',
    mono: 1_000, proc: 'p1', now: t.ports.clock.wall() }, null, false);
  if (!w.ok) throw new Error('mint');
  s.db.prepare('UPDATE continuity_generations SET shadowState = NULL, walk = NULL, shadowDeadlineAt = NULL, mintedObservedMs = ? WHERE id = ?')
    .run(-LEAST_AGE_MS, w.id);
  s.advanceCursor({ lane: 'generations', from: 0, to: st.id });
  const registry: RegistryFacts[] = [{ id: OVERLORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  const soft: SoftInputs[] = [];
  const pass = (more?: GenReadings['soft']) => {
    const r: GenReadings = { ...base, drain: { held: false }, ...(more === undefined ? {} : { soft: more }) };
    const d: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null, decide: {
        renewalDue: () => ({ due: true, cls: 'soft', why: 'turns', blind: [] }),
        softRenewalMay: (i) => { soft.push(i); return hold ? { start: false, waitFor: 'no-break' } : softRenewalMay(i); },
      } };
    return generationsPass(d, { registry, readings: new Map([[w.id, r]]), listedAt: t.ports.clock.wall() + 1, canRenew: true });
  };
  return { s, t, soft, pass };
}
const lastQuiet = (f: LaneFx): unknown => f.soft.at(-1)?.operatorQuietObservedMs;
const passFor = (f: LaneFx, ms: number): void => {
  f.pass();
  for (let at = RENEWAL_LANE_PERIOD_MS; at <= ms; at += RENEWAL_LANE_PERIOD_MS) { f.t.advance(RENEWAL_LANE_PERIOD_MS); f.pass(); }
};

describe('the Overlord\'s operator quiet: the `@overlord` mark, through the one mark reader (PR F, Task 9)', () => {
  it('a fresh mark reads 0; after 20 minutes of observed passes it reads at least 20 minutes, and the break opens', () => {
    const f = laneFx();
    expect(f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall()).ok).toBe(true);
    f.pass();
    expect(lastQuiet(f)).toEqual({ kind: 'measured', value: 0 });
    passFor(f, BREAK_NO_MESSAGE_MS);
    const q = lastQuiet(f) as { kind: string; value: number };
    expect(q.kind).toBe('measured');
    expect(q.value).toBeGreaterThanOrEqual(BREAK_NO_MESSAGE_MS);
    // The break is the quiet's alone: readers measured none (PR E's reading), the place still unmeasured (PR G's).
    const i = f.soft.at(-1)!;
    expect(softRenewalMay({ ...i, readersRunning: { kind: 'measured', value: 0 } })).toEqual({ start: true });
  });

  it('quiet under 20 minutes is no break: with the place unmeasured the permit waits `unmeasured`, never starts', () => {
    const f = laneFx();
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    passFor(f, BREAK_NO_MESSAGE_MS - 2 * RENEWAL_LANE_PERIOD_MS);
    const i = f.soft.at(-1)!;
    const q = i.operatorQuietObservedMs as { kind: string; value: number };
    expect(q.kind).toBe('measured');
    expect(q.value).toBeLessThan(BREAK_NO_MESSAGE_MS);
    expect(softRenewalMay({ ...i, readersRunning: { kind: 'measured', value: 0 } })).toEqual({ start: false, waitFor: 'unmeasured' });
  });

  it('a prompt that moves the mark resets the quiet to 0 at the next pass', () => {
    const f = laneFx();
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    passFor(f, 10 * MIN);
    expect((lastQuiet(f) as { value: number }).value).toBeGreaterThan(0);
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    f.pass();
    expect(lastQuiet(f)).toEqual({ kind: 'measured', value: 0 });
  });

  it('no `@overlord` mark is the hand-offs piece\'s measured "no activity", and a programme\'s mark is not the Overlord\'s', () => {
    const f = laneFx();
    expect(f.s.putOperatorMark('prog-a', f.t.ports.clock.wall()).ok).toBe(true);
    f.pass();
    expect(lastQuiet(f)).toEqual({ kind: 'measured', value: OPERATOR_MARK_MS });
  });

  it('marks that cannot be read make the quiet unmeasured, never the comfortable value', () => {
    const f = laneFx();
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    f.s.db.prepare('UPDATE operator_marks SET at = ? WHERE programme = ?').run('not a time', OVERLORD_OPERATOR_MARK);
    f.pass();
    expect(lastQuiet(f)).toMatchObject({ kind: 'unmeasured' });
    const i = f.soft.at(-1)!;
    expect(softRenewalMay({ ...i, readersRunning: { kind: 'measured', value: 0 } })).toEqual({ start: false, waitFor: 'unmeasured' });
  });

  it('a soft reading the gather answers still spreads over the lane\'s own (the port keeps its precedence)', () => {
    const f = laneFx();
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    f.pass({ readersRunning: { kind: 'measured', value: 0 } });
    expect(f.soft.at(-1)).toMatchObject({ readersRunning: { kind: 'measured', value: 0 }, operatorQuietObservedMs: { kind: 'measured', value: 0 } });
  });
});
