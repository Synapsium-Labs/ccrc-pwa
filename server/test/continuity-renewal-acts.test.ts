// Overlord W1a, the renewal act (Task 4): the generations lane, armed live, renews a coordinator through the `SessionHost`
// port and goes back, retries or degrades within each state's deadline; in shadow it records each step and sends nothing.
// A real coord.db, the fake time ports, a fake registry and a fake port; nothing here reaches the fleet.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { genExpectOf, type GenRow } from '../src/continuity/continuityStore.js';
import { GEN_ACTIVE } from '../src/continuity/generationMachine.js';
import {
  generationsPass, type EmptyTries, type GenReadings, type GenerationsDeps, type PlannedAct, type RegistryFacts,
} from '../src/continuity/generationsLane.js';
import { runRenewalActs } from '../src/continuity/renewalActs.js';
import { RENEWAL_HANDOVER_SUBJECT } from '../src/continuity/renewalFeed.js';
import type { DeliverResult, ReceiptRead, RenewalPrompt, RenewResult, SessionHost } from '../src/continuity/sessionHost.js';
import type { DrainRead } from '../src/continuity/renewalDrain.js';
import { snapshotFactsJson } from '../src/continuity/card.js';
import type { UsageRead } from '../src/usage.js';
import type { CardFacts } from '../../shared/continuity-card.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { CARDED_NUDGE_AT_MS, HOLD_OFF_MS, LEAST_AGE_MS, RENEWAL_BUDGET_S, STATE_DEADLINE_S } from '../../shared/continuity.js';
import { fakeTime, FAKE_T0, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const COORD = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const PERIOD = 30_000;

const usage = (ctxTokens: number, ctxWindow: number): UsageRead => ({ kind: 'reading', usage: {
  ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens, ctxWindow, cost: null, cacheExpiresAt: null, stale: false,
} });
const FREE: DrainRead = { held: false };
const HELD: DrainRead = { held: true, reason: 'live-word' };
/** A coordinator past its hard cap (260k of a 1M window), drained or not. */
const hardCap = (drain: DrainRead = FREE): GenReadings => ({
  usage: usage(260_000, 1_000_000), compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
  behind: { kind: 'measured', value: false }, drain,
});

const SNAPSHOT_FACTS: CardFacts = {
  sessionId: COORD, role: 'coordinator', roleWhy: 'it claims a run', at: 0,
  runs: { kind: 'read', value: [{ id: 41, programme: 'prog-a', wave: 1, waveOf: 2, state: 'working', planPath: null, kind: 'work' }] },
  ledger: { kind: 'read', value: [] }, claims: { kind: 'read', value: [] }, intent: { kind: 'read', value: true },
  itemsRaised: { kind: 'read', value: [{ id: 7, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: 1, text: 'i',
    everTicked: false, held: false }] },
  mailOutstanding: { kind: 'read', value: [] }, mailMore: false, notes: { kind: 'read', value: [] }, checkpoint: { kind: 'read', value: null },
  history: { kind: 'read', value: { verb: 'ccrc history describe', node: null } }, timers: { kind: 'read', value: [] },
};

/** The fake port: `renew` answers from a script (default `started`), and a `started` lands the fresh conversation's start
 *  report unless told not to; the receipt reads the store's starts as the adapter does. */
class FakeHost implements SessionHost {
  readonly renews: string[] = [];
  readonly delivered: string[] = [];
  answers: RenewResult[] = [];
  landStart = true;
  constructor(private readonly f: { s: CoordStore; start: (source: string, uuid: string) => number; nextUuid: () => string }) {}
  async renew(id: string, n: number): Promise<RenewResult> {
    this.renews.push(`${id} n=${n}`);
    const a = this.answers.shift() ?? { kind: 'started' };
    if (a.kind === 'started' && this.landStart) this.f.start('startup', this.f.nextUuid());
    return a;
  }
  async deliver(id: string, prompt: RenewalPrompt): Promise<DeliverResult> { this.delivered.push(`${id}: ${prompt}`); return { kind: 'sent' }; }
  async contextUsage(): Promise<never> { throw new Error('not read in W1a'); }
  async receipt(id: string, since: number): Promise<ReceiptRead> {
    const r = this.f.s.startsOf(id, 50);
    if (!r.ok) return { kind: 'unreadable', detail: r.detail };
    const hit = r.rows.find((s) => s.id > since && s.source !== 'compact');
    return hit === undefined ? { kind: 'none' } : { kind: 'started', startId: hit.id, uuid: hit.uuid };
  }
}

interface Fx {
  s: CoordStore; t: FakeTime; logs: string[]; mails: string[]; registry: RegistryFacts[]; host: FakeHost;
  pass(readings?: (g: GenRow) => GenReadings | undefined, canRenew?: boolean): ReturnType<typeof generationsPass>;
  /** One pass, then (live) its acts. */
  cycle(readings?: (g: GenRow) => GenReadings | undefined, canRenew?: boolean): Promise<ReturnType<typeof generationsPass>>;
  act(planned: readonly PlannedAct[]): ReturnType<typeof runRenewalActs>;
  start(source: string, uuid: string): number;
  gen(): GenRow;
}

function fx(live = true): Fx {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-renew-'), '.ccrc', 'coord.db')));
  s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
  s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, kind) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1, 'work')").run(COORD);
  if (live) s.setLaneArm(CONTINUITY_LANE, 'live', 1);
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const logs: string[] = []; const mails: string[] = [];
  const registry: RegistryFacts[] = [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  let n = 0;
  const uuids = [U2, U3, '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
  const start = (source: string, uuid: string): number => {
    n += 1;
    const r = s.insertStart({ sessionId: COORD, reportId: `r-${n}`, uuid, source, model: 'claude-opus-5-5', rowIncarnation: 'inc-1',
      reportedAt: t.ports.clock.wall(), receivedAt: t.ports.clock.wall() });
    if (!r.ok) throw new Error('start not recorded');
    registry[0] = { ...registry[0]!, uuid };
    return r.id;
  };
  const host = new FakeHost({ s, start, nextUuid: () => uuids.shift()! });
  const memo = new Set<number>(); const empties: EmptyTries = new Map();
  const deps: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: (l) => logs.push(l), retried: memo, emptyTries: empties };
  const liveRows = (): GenRow[] => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows; };
  const pass = (readings: (g: GenRow) => GenReadings | undefined = () => undefined, canRenew = true) => {
    const m = new Map<number, GenReadings>();
    for (const g of liveRows()) { const r = readings(g); if (r !== undefined) m.set(g.id, r); }
    return generationsPass(deps, { registry, readings: m, listedAt: t.ports.clock.wall() + 1, canRenew });
  };
  const act = (planned: readonly PlannedAct[]) => runRenewalActs({
    coord: s, host, now: () => t.ports.clock.wall(), log: (l) => logs.push(l),
    mail: (toId, subject, body) => { mails.push(`${toId} ${subject}: ${body}`); return true; },
  }, planned);
  return {
    s, t, logs, mails, registry, host, pass, start, act, gen: () => liveRows()[0]!,
    cycle: async (readings, canRenew) => { const r = pass(readings, canRenew); if (r.live) await act(r.planned); return r; },
  };
}

/** A live coordinator at rest and proven: its first start minted, then stepped to `active` as a proven generation. */
async function atRest(live = true): Promise<Fx> {
  const f = fx(live);
  f.start('startup', U1);
  f.pass();
  const g = f.gen();
  if (!f.s.stepGeneration(g.id, genExpectOf(g), GEN_ACTIVE, live, f.t.ports.clock.wall()).changed) throw new Error('not stepped');
  f.t.advance(PERIOD);
  return f;
}
const state = (f: Fx): { state: string; shadowState: string | null } => { const g = f.gen(); return { state: g.state, shadowState: g.shadowState }; };

let snaps = 0;
/** Serve the card and record a full read of it by the session's current conversation. */
function readCard(f: Fx, at = f.t.ports.clock.wall()): void {
  snaps += 1;
  const id = `snap-r${snaps}`; const hash = `${'c'.repeat(60)}${String(1000 + snaps)}`;
  if (!f.s.insertSnapshot({ id, sessionId: COORD, at, facts: snapshotFactsJson(SNAPSHOT_FACTS), hash }).ok) throw new Error('snapshot');
  if (!f.s.insertCardRead({ sessionId: COORD, uuid: f.registry[0]!.uuid!, snapshotId: id, hash, pages: 1, at }).ok) throw new Error('read');
}
/** Answer the open round with every question graded `grade`. */
function answer(f: Fx, grade: 'pass' | 'fail'): void {
  const open = f.s.openProbeRound(COORD);
  if (!open.ok || open.rows.length === 0) throw new Error('no open round');
  const w = f.s.answerRound(open.rows[0]!.roundId, COORD, open.rows.map((r) => ({ qid: r.qid, answer: 'x', grade })), 'unmeasured', f.t.ports.clock.wall());
  if (!w.ok) throw new Error(w.kind);
}

describe('the renewal act, live (Task 4)', () => {
  it('a hard trigger on an idle coordinator: draining, clearing, one renew, carded with the first prompt, probing, active', async () => {
    const f = await atRest();
    await f.cycle(() => hardCap());
    expect(state(f)).toEqual({ state: 'draining', shadowState: null });
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    expect(f.host.renews).toEqual([`${COORD} n=1`]);
    expect(f.gen()).toMatchObject({ state: 'clearing', hostEnded: true, attempts: 1 });
    f.t.advance(PERIOD);
    // The fresh conversation's start mints n=2 at carded, ending n=1 renewed, and its first prompt is delivered.
    await f.cycle();
    expect(f.gen()).toMatchObject({ n: 2, state: 'carded' });
    expect(f.s.db.prepare("SELECT outcome FROM continuity_generations WHERE n = 1").get()).toEqual({ outcome: 'renewed' });
    expect(f.host.delivered).toEqual([`${COORD}: renewal-first-prompt`]);
    readCard(f);
    f.t.advance(5_000);
    await f.cycle();
    expect(f.gen()).toMatchObject({ state: 'probing' });
    answer(f, 'pass');
    f.t.advance(5_000);
    await f.cycle();
    expect(f.gen()).toMatchObject({ n: 2, state: 'active', proven: true });
    expect(f.host.renews).toHaveLength(1);
    expect(f.mails).toEqual([]);   // a hard renewal asks no handover
  });

  it('a hard trigger waits while the Overlord renews (recorded overlord-first), and starts once it is active', async () => {
    const f = await atRest();
    // An Overlord generation in `draining`, as W1 will mint one.
    const st = f.s.insertStart({ sessionId: 'overlord', reportId: 'o-1', uuid: U3, source: 'startup', model: null, rowIncarnation: null,
      reportedAt: 1, receivedAt: 1 });
    if (!st.ok) throw new Error('start');
    f.s.db.prepare("INSERT INTO continuity_generations (identity, sessionId, role, term, n, state, walk, enteredAt, resumed, startId, "
      + "startReportedAt, observed, mintedObservedMs, proven) VALUES ('overlord', 'overlord', 'overlord', 1, 1, 'draining', 'live', ?, 0, ?, 1, ?, 0, 1)")
      .run(f.t.ports.clock.wall(), st.id, JSON.stringify({ ms: 0, mono: 0, proc: 'p1' }));
    const coordOnly = (g: GenRow): GenReadings | undefined => (g.identity === COORD ? hardCap() : undefined);
    const r = await f.cycle(coordOnly);
    expect(r.waits).toMatchObject({ 'overlord-first': 1 });
    expect(f.s.liveGenerations().ok && f.s.db.prepare('SELECT state FROM continuity_generations WHERE identity = ?').get(COORD)).toEqual({ state: 'active' });
    f.s.db.prepare("UPDATE continuity_generations SET state = 'active', walk = NULL, deadlineAt = NULL WHERE identity = 'overlord'").run();
    f.t.advance(PERIOD);
    await f.cycle(coordOnly);
    expect(f.s.db.prepare('SELECT state FROM continuity_generations WHERE identity = ?').get(COORD)).toEqual({ state: 'draining' });
  });

  it('the lane\'s real gather: a soft trigger waits unmeasured on the operator mark, and no soft renewal starts', async () => {
    const f = await atRest();
    const g = f.gen();
    // Past the least age, on the observed clock.
    f.s.db.prepare('UPDATE continuity_generations SET mintedObservedMs = ? WHERE id = ?').run(-LEAST_AGE_MS, g.id);
    // A soft due, stored as THREE would store one; the gather's operator mark reads unmeasured until the hand-offs piece.
    const soft: GenReadings = { usage: usage(10_000, 1_000_000), compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
      behind: { kind: 'measured', value: true }, drain: FREE };
    const r = await f.cycle(() => soft);
    expect(f.gen().dueClass).toBe('soft');
    expect(r.waits).toMatchObject({ unmeasured: 1 });
    expect(state(f)).toEqual({ state: 'active', shadowState: null });
    expect(g.id).toBe(f.gen().id);
  });

  it('renew refused (exit 3): a proven generation goes back to active with a hold-off, and no retry is made', async () => {
    const f = await atRest();
    f.host.answers = [{ kind: 'refused', reason: 'turn' }];
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    expect(f.gen()).toMatchObject({ state: 'active' });
    expect(f.gen().holdOffUntilObservedMs).toBe(f.gen().observed.ms + HOLD_OFF_MS);
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap(HELD));
    expect(f.host.renews).toHaveLength(1);
  });

  it('a generation that went back to active renews again: its second renewal makes its own call (slug renew-calls-keyed-by-episode)', async () => {
    const f = await atRest();
    f.host.answers = [{ kind: 'refused', reason: 'turn' }];
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    expect(f.gen()).toMatchObject({ n: 1, state: 'active' });
    expect(f.host.renews).toHaveLength(1);
    // The hard trigger still stands: a second renewal of the same generation drains, clears and calls again, try 1 of its
    // own episode, and its start mints n=2.
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    expect(f.host.renews).toEqual([`${COORD} n=1`, `${COORD} n=1`]);
    f.t.advance(PERIOD);
    await f.cycle();
    expect(f.gen()).toMatchObject({ n: 2, state: 'carded' });
  });

  it('renew unreachable, then the start is reported: the receipt ends the retry, so no second renew', async () => {
    const f = await atRest();
    f.host.answers = [{ kind: 'unreachable', detail: 'link down' }];
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    expect(f.gen()).toMatchObject({ state: 'clearing', attempts: 2, hostEnded: true });
    // The next pass owes try 2; the session did start after all, and its report lands after that pass read the starts
    // but before its acts run: the receipt's second half ends the retry (Review Focus 1).
    f.t.advance(PERIOD);
    const owed = f.pass();
    expect(owed.planned.map((p) => p.act)).toEqual([{ kind: 'renew', try: 2 }]);
    f.start('startup', U2);
    await f.act(owed.planned);
    expect(f.host.renews).toHaveLength(1);
    f.t.advance(PERIOD);
    await f.cycle();
    expect(f.host.renews).toHaveLength(1);
    expect(f.gen()).toMatchObject({ n: 2, state: 'carded' });
  });

  it('wake-failed until the clearing deadline: retried within it, then degraded with one item', async () => {
    const f = await atRest();
    f.host.answers = Array.from({ length: 10 }, () => ({ kind: 'wake-failed' }) as RenewResult);
    await f.cycle(() => hardCap());
    // Until the first step into `degraded` (a hard trigger that still stands would start a new walk from there).
    for (let i = 0; i < 8 && f.gen().state !== 'degraded'; i += 1) { f.t.advance(PERIOD); await f.cycle(() => hardCap()); }
    expect(f.gen()).toMatchObject({ state: 'degraded', proven: false });
    expect(f.host.renews.length).toBeGreaterThan(1);
    expect(f.host.renews.length).toBeLessThanOrEqual(Math.ceil(STATE_DEADLINE_S.clearing * 1000 / PERIOD) + 1);
    const items = f.s.itemsFor('prog-a', f.t.ports.clock.wall()).open;
    expect(items.map((i) => i.title)).toEqual([expect.stringMatching(/^Renewal of lane-a-project-a \(generation 1\) degraded: /)]);
  });

  it('no hibernate-fresh: nothing is sent and the wait is recorded capability-missing', async () => {
    const f = await atRest();
    const r = await f.cycle(() => hardCap(), false);
    expect(r.waits).toMatchObject({ 'capability-missing': 1 });
    expect(state(f)).toEqual({ state: 'active', shadowState: null });
    expect(f.host.renews).toEqual([]);
  });

  it('a card read made before the carded deadline and first seen after it moves to probing, not degraded (m6)', async () => {
    const f = await atRest();
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle();
    const g = f.gen();
    expect(g.state).toBe('carded');
    readCard(f, g.deadlineAt! - 1);
    f.t.advance(g.deadlineAt! + 1_000 - f.t.ports.clock.wall());
    await f.cycle();
    expect(f.gen().state).toBe('probing');
  });

  it('the deadline is set once (ruling I2): carded re-nudges once at its nudge point, probing\'s second round keeps its deadline, active within the budget', async () => {
    const f = await atRest();
    await f.cycle(() => hardCap());
    f.t.advance(PERIOD);
    await f.cycle(() => hardCap());
    const checkpointedAt = f.t.ports.clock.wall();
    f.t.advance(PERIOD);
    await f.cycle();
    const carded = f.gen();
    expect(carded.state).toBe('carded');
    f.t.advance(carded.enteredAt + CARDED_NUDGE_AT_MS - f.t.ports.clock.wall());
    await f.cycle();
    expect(f.gen()).toMatchObject({ state: 'carded', renudged: true, deadlineAt: carded.deadlineAt });
    expect(f.host.delivered).toHaveLength(2);
    f.t.advance(1_000);
    await f.cycle();
    expect(f.host.delivered).toHaveLength(2);
    readCard(f);
    f.t.advance(1_000);
    await f.cycle();
    const probing = f.gen();
    expect(probing.state).toBe('probing');
    answer(f, 'fail');
    f.t.advance(1_000);
    await f.cycle();
    expect(f.gen()).toMatchObject({ state: 'probing', probeRounds: 1, deadlineAt: probing.deadlineAt });
    readCard(f);
    f.t.advance(1_000);
    await f.cycle();
    answer(f, 'pass');
    f.t.advance(1_000);
    await f.cycle();
    expect(f.gen()).toMatchObject({ state: 'active', proven: true });
    expect(f.t.ports.clock.wall() - checkpointedAt).toBeLessThanOrEqual(RENEWAL_BUDGET_S * 1000);
  });

  it('a soft renewal checkpoints: the handover is asked by mail, and the checkpoint is sealed before the renew', async () => {
    const f = await atRest();
    const g = f.gen();
    // A soft due the permit lets start: the lane's gather reads the operator mark unmeasured, so this case drives the
    // walk from `checkpointed` the way a permitted soft due reaches it.
    f.s.stepGeneration(g.id, genExpectOf(g), { ...GEN_ACTIVE, state: 'draining', cls: 'soft' }, true, f.t.ports.clock.wall());
    await f.cycle(() => hardCap());
    expect(f.gen().state).toBe('checkpointed');
    expect(f.mails).toEqual([expect.stringContaining(`${COORD} ${RENEWAL_HANDOVER_SUBJECT}: `)]);
    expect(f.mails[0]).toContain('ccrc-api note handover');
    f.t.advance(STATE_DEADLINE_S.checkpointed * 1000);
    await f.cycle();
    expect(f.gen().state).toBe('clearing');
    f.t.advance(PERIOD);
    await f.cycle();
    expect(f.host.renews).toHaveLength(1);
    const cp = f.s.db.prepare('SELECT generationId FROM continuity_checkpoints').all();
    expect(cp).toEqual([{ generationId: g.id }]);
  });
});

describe('the renewal act, shadow (Task 4; Review Focus 3)', () => {
  it('the same hard trigger in shadow: no port call, no mail, no item; state stays active, shadowState walks, the records name each act', async () => {
    const f = await atRest(false);
    const r1 = await f.cycle(() => hardCap());
    expect(r1).toMatchObject({ live: false, planned: [] });
    expect(state(f)).toEqual({ state: 'active', shadowState: 'draining' });
    f.t.advance(PERIOD);
    const r2 = await f.cycle(() => hardCap());
    expect(state(f)).toEqual({ state: 'active', shadowState: 'clearing' });
    expect([...r1.recorded, ...r2.recorded].join('\n')).toMatch(/active -> draining on due, would hold-deliveries[\s\S]*draining -> clearing on drained, would renew/);
    for (let i = 0; i < 4; i += 1) { f.t.advance(PERIOD); await f.cycle(() => hardCap()); }
    expect(f.host.renews).toEqual([]);
    expect(f.host.delivered).toEqual([]);
    expect(f.mails).toEqual([]);
    expect(f.s.itemsFor('prog-a', f.t.ports.clock.wall()).open).toEqual([]);
    expect(f.gen().state).toBe('active');
  });
});
