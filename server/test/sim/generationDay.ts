// A generation day (Overlord W1a, renewal deciders Task 6, then the renewal act Task 5; spec §3.3.11, §11.5, §11.7): an
// Overlord and a coordinator for a seeded day of context growth, compactions, operator presence and absence, idle
// stretches, host failures, unplanned starts, server crashes with gaps, and server freezes.
//
// THE SERVER SIDE IS THE REAL LANE AND THE REAL ACTS. Each beat calls `generationsPass` over an in-memory coord.db with
// `canRenew` and the world's readings (usage, compactions, turn marker, drain, the soft preconditions' reads), and, when the
// pass answers `live`, hands what it planned to `runRenewalActs` over a fake `SessionHost`, a mail function and the store.
// The scenario steps no generation row itself: the lane is the one writer. The deciders' modules are a parameter, so a
// mutated copy can be handed to the same pass (`GenerationsDeps.decide`), and so is the acts' runner.
//
// THE WORLD SIDE IS FAKE. The fake host answers `renew` from a seeded table of outcomes (started, refused, kill-failed,
// wake-failed, wake-unrestored, unproven, unreachable with and without a late start, a hang that answers late, the agent
// link dropping) and lands a fresh start report on the world's timers; `deliver` makes the session read its card later
// (a snapshot and a full read through the store); the open probe round is answered through the store, or never; the
// handover note is written when the handover mail is delivered; the receipt reads the store's starts and, while a late
// start of the session is pending, waits behind it (the host's own per-session queue). Doors the session writes through
// (card read, probe answer, handover) are lost while the server is down and wait while it is frozen.
//
// THE LINES come from what the store says: the lane's store handed to the pass is a wrapper that emits one line per
// committed step, mint, hold-off and item (the scenario's only part in them is the world's truth for the card and the
// probe round, which G1 holds the machine to), and the fake host emits one line per `renew` call that started a session.
//
// ASYNC. The acts await the port, so the run steps the world (`Scenario.step`) and turns the microtasks over between
// steps: a pass blocks while an earlier pass's acts run (the lane's one-run rule), every act sleeps on a world timer, and
// an act's continuation runs at the grain of the step. A crash is placed inside a pass by a write that aborts (and every
// write after it), between a pass and its acts, and at the port call; the acts of a run the crash ended never write again
// (their store is guarded by the boot they began in), while the host's side of a call in flight goes on. The `continuity`
// row is drawn per seed, so shadow runs under crashes too: in shadow nothing is planned or acted on, and renewals never
// complete, which is correct.
//
// Durable state is coord.db (generations, starts, claims, notes, cards, rounds, items) and the mail queue; the server's
// timers do not survive a crash. The world (the sessions, their hosts, the operator) keeps its own timers, which survive.
// The predicates read only the sequence's lines: generation rows and the fake clock, never sweep phases.
import { DatabaseSync } from 'node:sqlite';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { CardFacts } from '../../../shared/continuity-card.js';
import { CONTINUITY_LANE } from '../../../shared/lane-arm.js';
import { LEAST_AGE_MS, RENEWAL_BUDGET_S, RENEWAL_LANE_PERIOD_MS, SOFT_BUDGET, STATE_DEADLINE_S } from '../../../shared/continuity.js';
import { MIGRATIONS } from '../../src/coord/schema.js';
import { CoordStore } from '../../src/coord/store.js';
import type { TurnMarkRead } from '../../src/coord/stall.js';
import type { UsageRead } from '../../src/usage.js';
import { effectiveGeneration, genExpectOf, genViewOf, type GenRow } from '../../src/continuity/continuityStore.js';
import {
  GENERATIONS_LANE, generationsPass, softTimesOf, type EmptyTries, type GenerationsCoord, type GenerationsResult, type GenReadings,
  type PlannedAct,
} from '../../src/continuity/generationsLane.js';
import type { GenEvent, GenView } from '../../src/continuity/generationMachine.js';
import type { Reading } from '../../src/continuity/renewalDue.js';
import { runRenewalActs, type RenewalActsDeps } from '../../src/continuity/renewalActs.js';
import { RENEWAL_HANDOVER_SUBJECT, RENEWING_STATES, renewalHoldsMail } from '../../src/continuity/renewalFeed.js';
import { snapshotFactsJson } from '../../src/continuity/card.js';
import type { DeliverResult, ReceiptRead, RenewResult, SessionHost } from '../../src/continuity/sessionHost.js';
import type { Scenario } from './run.js';
import type { Invariant, SequenceLine, Violation } from './sequence.js';
import { chance } from './world.js';

/** The deciders, passed in so that a mutant can be handed to the same scenario. `observed` is the lane's own import now;
 *  it stays in the set for the scenarios that hand a mutant of it. `renewal`, `soft`, `machine` and `feed` reach the pass
 *  through `GenerationsDeps.decide`, and `acts` is the runner of the planned acts. */
export interface GenDayModules {
  readonly renewal: Pick<typeof import('../../src/continuity/renewalDue.js'), 'renewalDue'>;
  readonly soft: Pick<typeof import('../../src/continuity/softRenewal.js'), 'softRenewalMay'>;
  readonly machine: Pick<typeof import('../../src/continuity/generationMachine.js'), 'generationStep' | 'GEN_ACTIVE' | 'GEN_MINTED'>;
  readonly observed: Pick<typeof import('../../src/time/observed.js'), 'observeTime' | 'observedStepCapMs'>;
  /** The store as the lane's pass sees it; the store itself unless a mutation row hands a wrapper of it (review 2003 F9). */
  readonly coord?: (store: CoordStore) => GenerationsCoord;
  /** The feed's decider; the real one unless a mutation row hands a mutant of it. */
  readonly feed?: Pick<typeof import('../../src/continuity/renewalFeed.js'), 'renewalFeed'>;
  /** The permit's decider; the real one unless a mutation row hands a mutant of it. */
  readonly permit?: Pick<typeof import('../../src/continuity/renewalFeed.js'), 'renewalPermit'>;
  /** The runner of the planned acts; `runRenewalActs` unless a mutation row hands a mutated copy of it. */
  readonly acts?: typeof runRenewalActs;
}

export const GEN_DAY_EDGES = ['soft-renewal', 'hard-renewal', 'renewed', 'crash-gap', 'freeze-gap', 'start-while-down', 'degraded',
  'hold-off', 'budget-wait', 'probe-retry', 'renudge', 'unplanned-start', 'overlord-first', 'clearing-timeout-back',
  'clearing-timeout-degraded', 'soft-due-in-degraded', 'probing-timeout', 'crash-mid-pass', 'live-arm', 'shadow-arm',
  // the renewal act's faults
  'renew-refused', 'renew-after-half-failed', 'renew-late-start', 'renew-hang', 'link-drop', 'retry-skipped-by-receipt',
  'crash-before-acts', 'crash-at-port-call', 'mail-held'] as const;
export type GenDayEdge = (typeof GEN_DAY_EDGES)[number];

const START = Date.parse('2026-11-13T00:00:00Z');
const DAY_MS = 24 * 3_600_000;
const BEAT_MS = RENEWAL_LANE_PERIOD_MS;   // the server's lane and the world both beat at the renewal lane's period
const SEC = 1_000;
const MIN = 60_000;
const COORD = 'lane-a-coordinator';
const WHO: ReadonlyArray<readonly [string, FleetRole]> = [['overlord', 'overlord'], [COORD, 'coordinator']];
const TRANSIENT = new Set(['draining', 'checkpointed', 'clearing', 'carded', 'probing']);
/** No acts start in the day's last ten minutes, so no call is left hanging at its end. */
const ACTS_END = START + DAY_MS - 10 * MIN;

const M = <T>(value: T): Reading<T> => ({ kind: 'measured', value });
const U: Reading<never> = { kind: 'unmeasured', why: 'stale' };
const NA = { kind: 'not-applicable' } as const;

/** `fault.left` while no crash is placed inside a pass. */
const DISARMED = 1_000_000_000;
/** The crash countdown, kept in JS (review 2003 F8): a counter in a table would be rolled back with the transaction its
 *  abort ends, so the next write would commit. Every write to the generations or the cursor ticks it (`sim_tick`, a
 *  trigger's function); once below zero every write aborts, and `fired` says an abort landed. */
const fault = { left: DISARMED, fired: false };
const arm = (left: number): void => { fault.left = left; fault.fired = false; };
/** ONE database for every seed, migrated once: seeds run one after another (`simulate` refuses a second in flight), and
 *  each setup empties the tables the day writes. A database per seed churned native memory the collector does not see,
 *  past the test slice's cap over 5,000 seeds. */
let simDb: DatabaseSync | null = null;
/** The tables the day writes, children first (the foreign keys are on). */
const DAY_TABLES = ['continuity_probes', 'continuity_reads', 'continuity_handovers', 'continuity_checkpoints', 'continuity_renew_calls', 'continuity_soft_renewals',
  'continuity_notes', 'continuity_timers', 'continuity_card_reads', 'continuity_snapshots', 'continuity_generations', 'continuity_cursor',
  'continuity_starts', 'operator_item_events', 'operator_items', 'run_events', 'runs', 'programs'] as const;
function dayDb(): DatabaseSync {
  if (simDb === null) {
    simDb = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) simDb.exec(m);
    simDb.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    simDb.function('sim_tick', () => { fault.left -= 1; if (fault.left < 0) fault.fired = true; return fault.left; });
    simDb.exec(['INSERT', 'UPDATE'].flatMap((op) => ['continuity_generations', 'continuity_cursor'].map((t) => `CREATE TRIGGER
      sim_fault_${op}_${t} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT, 'sim crash') WHERE sim_tick() < 0; END;`)).join('\n'));
  }
  arm(DISARMED);
  simDb.exec(DAY_TABLES.map((t) => `DELETE FROM ${t};`).join('\n'));
  return simDb;
}
interface Facts {
  ctx: number; compactions: number; compLines: { at: number }[]; idleSince: number | null; readers: number;
}

/** The card the world's sessions read: facts the probes can be drawn from, for the role. */
function cardFactsOf(who: string, role: FleetRole): CardFacts {
  return {
    sessionId: who, role, roleWhy: 'sim', at: 0,
    runs: { kind: 'read', value: [{ id: 41, programme: 'prog-a', wave: 1, waveOf: 99, state: 'working', planPath: null, kind: 'work' }] },
    ledger: { kind: 'read', value: [] }, claims: { kind: 'read', value: [] }, intent: { kind: 'read', value: true },
    itemsRaised: { kind: 'read', value: [{ id: 7, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: 1, text: 'i',
      everTicked: false, held: false }] },
    mailOutstanding: { kind: 'read', value: [] }, mailMore: false, notes: { kind: 'read', value: [] }, checkpoint: { kind: 'read', value: null },
    history: { kind: 'read', value: { verb: 'ccrc history describe', node: null } }, timers: { kind: 'read', value: [] },
  };
}

export function generationDay(mods: GenDayModules): Scenario<GenDayEdge> {
  return {
    name: 'generation-day', startWallMs: START, durationMs: DAY_MS, edges: GEN_DAY_EDGES,
    // Idle, the world steps by the lane's period, so a beat that starts acts has its continuations run as the step ends, at the
    // beat's own time; while a pass's acts run, by one second.
    step: { idleMs: BEAT_MS, busyMs: SEC },
    setup({ world, seq, cover, entropy }) {
      const line = (kind: string, id: string, state: string, actor: string): void => { seq.append({ kind, id, state, actor }); };
      const server = world.server;
      const between = (lo: number, hi: number): number => lo + entropy.below(hi - lo + 1);
      const wall = (): number => server.clock.wall();

      // ---- DURABLE: a real coord.db (`dayDb`), its generations written only through the store and the lane, which
      // survive a crash. The coordinator claims an open work run, so `roleOf` reads it as one. The `continuity` row is
      // drawn per seed (review 2003 F10): live, a walk moves `state`; shadow, it moves `shadowState` and `state` stays
      // `active`, and every machine read goes through the one accessor.
      const db = dayDb();
      const store = new CoordStore(db);
      const base = mods.coord === undefined ? store : mods.coord(store);
      db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 0, 'active')");
      let waveNo = 1;
      db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 99, 'project-a', 'working', ?, 0)").run(COORD);
      const live = chance(entropy, 0.5);
      store.setLaneArm(CONTINUITY_LANE, live ? 'live' : 'shadow', 0);
      cover(live ? 'live-arm' : 'shadow-arm');
      line('arm', CONTINUITY_LANE, live ? 'live' : 'shadow', 'sim');
      const uuids = new Map<string, string>();
      let reports = 0;
      /** The live generations as last read, dropped by every write, so a beat reads the table once per change. */
      let liveNow: GenRow[] | null = null;
      const wrote = <T>(v: T): T => { liveNow = null; return v; };
      /** The row the identity lives in: its live generation, read from the store. */
      const row = (who: string): GenRow => {
        if (liveNow === null) {
          const r = store.liveGenerations();
          if (!r.ok) throw new Error(`generation-day: ${r.detail}`);
          liveNow = r.rows;
        }
        const g = liveNow.find((x) => x.identity === who);
        if (g === undefined) throw new Error(`generation-day: ${who} has no live generation`);
        return g;
      };
      const rowById = (id: number): GenRow | undefined => { const r = store.liveGenerations(); return r.ok ? r.rows.find((g) => g.id === id) : undefined; };
      const obsOf = (who: string): number => row(who).observed.ms;
      const idOf = (who: string, n: number): string => `${who}#${n}`;
      const roleOfWho = (who: string): FleetRole => WHO.find(([w]) => w === who)![1];
      // The Overlord's starts: W1a's lane cannot tell its role (no designation before W1), so the scenario mints them
      // through the same store function in the lane's order, standing in for W1's designation (slug sim-overlord-mints).
      const overlordStarts: number[] = [];
      let proc = 'p0';
      let boots = 0;
      // The lane's per-process memo of the starts it held (review 2006 R3): a boot forgets it, as a restarted server does.
      let retried = new Set<number>(); let emptyTries: EmptyTries = new Map();

      // ---- THE WORLD'S TRUTH, for the lines the machine is held to: which card the session read and which round it passed.
      const cardReadHash = new Map<string, string>();   // a conversation's uuid -> the hash of its newest read
      const servedHash = new Map<string, string>();     // a session -> the hash of the snapshot served last
      const lastGrade = new Map<string, boolean>();      // a session -> whether the round it answered last was passed
      let snaps = 0;
      const startUuid = (startId: number): string | undefined =>
        (db.prepare('SELECT uuid FROM continuity_starts WHERE id = ?').get(startId) as { uuid: string } | undefined)?.uuid;

      // ---- THE LINES, from what the store says. The lane's store is wrapped: each committed step, mint, hold-off and item
      // emits its line, in the order the pass wrote them.
      const traceMint = (who: string, n: number): void => {
        line('gen', idOf(who, n - 1), 'ended', 'lane');
        line('gen', idOf(who, n), 'carded', 'mint');
      };
      const traceStep = (before: GenRow, next: GenView, card: unknown): void => {
        const prev = genViewOf(before, live);
        const who = before.identity; const id = idOf(who, before.n);
        if (next.renudged && !prev.renudged) cover('renudge');
        if (prev.state === 'probing' && next.state === 'probing' && next.probeRounds > prev.probeRounds) cover('probe-retry');
        if (next.state === prev.state) return;
        const from = prev.state;
        if (from === 'carded' && next.state === 'probing' && card !== null) {
          const uuid = startUuid(before.startId);
          line('card', id, uuid !== undefined && cardReadHash.get(uuid) === servedHash.get(who) ? 'match' : 'mismatch', 'lane');
        }
        if (from === 'probing' && next.state === 'active') {
          line('probes', id, lastGrade.get(who) === true ? 'passed' : 'failed', 'lane');
          lastGrade.delete(who);
          cover('renewed');
        }
        const eff = effectiveGeneration(before, live);
        if (TRANSIENT.has(from) && eff.deadlineAt !== null && wall() >= eff.deadlineAt && (next.state === 'degraded' || (next.state === 'active' && from !== 'probing'))) {
          line('deadline', `${id}:${from}:${eff.deadlineAt}`, 'fired', 'lane');
          if (from === 'clearing') cover(prev.hostEnded ? 'clearing-timeout-degraded' : 'clearing-timeout-back');
          if (from === 'probing') cover('probing-timeout');
        }
        if (next.state === 'degraded') cover('degraded');
        if ((from === 'active' || from === 'degraded') && next.state === 'draining') {
          line('renewal', id, `began;proven=${prev.proven ? 1 : 0};from=${from}`, 'lane');
          if (before.dueClass === 'soft') {
            const times = softTimesOf(before);
            cover('soft-renewal');
            line('soft-renewal', who, `obs=${before.observed.ms};age=${times.generationAgeObservedMs};n=${before.n};from=${from};live=${live ? 1 : 0}`, 'lane');
          } else cover('hard-renewal');
        }
        line('gen', id, next.state, 'lane');
      };
      // `run(id)` hydrates a run with its health (mail and review reads), which the lane never reads: each pass asks the
      // coordinator's two newest runs for their kind, state and programme only. Only the day writes `runs` (a wave's end,
      // below, clears this), so a read is kept until then, and a seed costs about what it did before the acts.
      const runMemo = new Map<number, ReturnType<CoordStore['run']>>();
      const traced = Object.assign(Object.create(base) as object, {
        run: (id: number) => {
          let r = runMemo.get(id);
          if (r === undefined) { r = base.run(id); runMemo.set(id, r); }
          return r;
        },
        stepGeneration: (...a: Parameters<CoordStore['stepGeneration']>) => {
          const before = rowById(a[0]);
          const w = base.stepGeneration(...a);
          liveNow = null;
          if (w.changed && before !== undefined) traceStep(before, a[2], a[5] ?? null);
          return w;
        },
        mintGeneration: (...a: Parameters<CoordStore['mintGeneration']>) => {
          const w = base.mintGeneration(...a);
          liveNow = null;
          if (w.ok) traceMint(a[0].identity, w.n);
          return w;
        },
        setHoldOff: (...a: Parameters<CoordStore['setHoldOff']>) => {
          const w = store.setHoldOff(...a);
          liveNow = null;
          const g = w.changed ? rowById(a[0]) : undefined;
          if (g !== undefined) { cover('hold-off'); line('hold-off', idOf(g.identity, g.n), `until=${softTimesOf(g).holdOffUntilObservedMs}`, 'lane'); }
          return w;
        },
        raiseItem: (...a: Parameters<CoordStore['raiseItem']>) => {
          const id = store.raiseItem(...a);
          const n = /generation (\d+)/.exec(a[0].title)?.[1];
          line('item', idOf(a[0].raisedBy, Number(n)), 'raised', 'lane');
          return id;
        },
      }) as unknown as CoordStore;
      const lane: GenerationsCoord = traced;

      /** The hook reports a start: one `continuity_starts` row, its conversation the registry's now. */
      function report(who: string, source: 'startup' | 'clear' | 'resume', fresh: boolean): number {
        reports += 1;
        if (fresh) uuids.set(who, `${who}-u${reports}`);
        const r = store.insertStart({ sessionId: who, reportId: `r-${reports}`, uuid: uuids.get(who)!, source, model: null,
          rowIncarnation: 'inc', reportedAt: wall(), receivedAt: wall() });
        if (!r.ok) throw new Error('generation-day: a start was not recorded');
        if (who !== COORD) overlordStarts.push(r.id);
        line('report', who, `start=${r.id};source=${source};uuid=${uuids.get(who)!}`, 'host');
        return r.id;
      }

      // Both generations working when the day begins: n=1 minted from a startup, then active (a generation that was
      // working when the machine began), and the cursor past both starts. Written through the store, no lines.
      for (const [who] of WHO) {
        uuids.set(who, `${who}-u0`);
        const id = report(who, 'startup', false);
        const m = wrote(store.mintGeneration({ identity: who, sessionId: who, role: who === COORD ? 'coordinator' : 'overlord', term: 1,
          rowIncarnation: 'inc', startId: id, startReportedAt: wall(), resumed: false, model: null, lane: 'lane-a', host: null,
          outcome: 'woken', mono: server.clock.mono(), proc, now: wall() }, null, live));
        if (!m.ok) throw new Error('generation-day: the first mint failed');
        const g = row(who);
        wrote(store.stepGeneration(g.id, genExpectOf(g), mods.machine.GEN_ACTIVE, live, wall()));
      }
      overlordStarts.length = 0;
      store.advanceCursor({ lane: GENERATIONS_LANE, from: 0, to: reports });
      const startQueue: Array<[string, GenEvent]> = [];
      let frozenUntil = 0;
      let thawPending = false;
      /** What waits in a frozen server's socket: a start (kept across a crash) or a door write (lost with one). */
      const frozenQueue: Array<{ who: string; start: GenEvent | null; run: () => void }> = [];
      const frozen = (): boolean => wall() < frozenUntil;

      // ---- WORLD: the sessions, their hosts and the operator. Their timers survive a crash.
      const facts = new Map<string, Facts>();
      for (const [who] of WHO) facts.set(who, { ctx: 20_000, compactions: 0, compLines: [], idleSince: null, readers: 0 });
      let operatorHere = true;
      let lastOperatorObs = 0;
      let operatorPending = false;
      let operatorFlipAt = START + 40 * MIN;
      /** The mail the world queued for a session, delivered by the server's beat once the renewal gate lets it through. */
      const mailbox: Array<{ who: string; k: number }> = [];
      let mails = 0;

      // A renewal's fresh start is a `startup` (ccd spawns it with `--session-id`, a new conversation); any other start
      // that is not a resume is a `/clear` (review 2149 F2: only a fresh conversation's `startup` is the renewal's).
      const reportStart = (who: string, e: Extract<GenEvent, { kind: 'started' }>): void => {
        report(who, e.resumed ? 'resume' : (e as { renewal?: true }).renewal === true ? 'startup' : 'clear', !e.resumed);
      };
      /** A host's start reaches the server: reported (and kept by the hook while the server is down, the start-while-down
       *  rule), or waiting in a frozen server's socket. */
      const deliverStart = (who: string, e: Extract<GenEvent, { kind: 'started' }>): void => {
        if (world.isDown()) { startQueue.push([who, e]); return; }
        if (frozen()) { frozenQueue.push({ who, start: e, run: () => reportStart(who, e) }); return; }
        reportStart(who, e);
      };
      /** A door the session writes through: lost while the server is down, held while it is frozen. */
      const doorWrite = (fn: () => void): void => {
        if (world.isDown()) return;
        if (frozen()) { world.envAfter(Math.max(SEC, frozenUntil - wall() + SEC), () => doorWrite(fn)); return; }
        fn();
      };
      /** The session reads its card, a match or not (a card served after its read makes the read a stale one). */
      const readCard = (who: string, matches: boolean): void => {
        snaps += 1;
        const facts0 = snapshotFactsJson(cardFactsOf(who, roleOfWho(who)));
        const put = (suffix: string, at: number): string => {
          const id = `snap-${snaps}${suffix}`; const hash = `${'c'.repeat(59)}${String(1000 + snaps)}${suffix}`.slice(-64);
          if (!store.insertSnapshot({ id, sessionId: who, at, facts: facts0, hash }).ok) throw new Error('generation-day: a snapshot was not stored');
          servedHash.set(who, hash);
          return id;
        };
        const id = put('a', wall());
        const hash = servedHash.get(who)!;
        if (!store.insertCardRead({ sessionId: who, uuid: uuids.get(who)!, snapshotId: id, hash, pages: 1, at: wall() }).ok) {
          throw new Error('generation-day: a card read was not stored');
        }
        cardReadHash.set(uuids.get(who)!, hash);
        if (!matches) put('b', wall());
      };
      const sessionReadsCard = (who: string): void => {
        const late = between(2, 60) * SEC;
        const matches = chance(entropy, 0.9);
        world.envAfter(late, () => doorWrite(() => readCard(who, matches)));
      };

      // ---- THE FAKE HOST (the port the acts call).
      const pendingStart = new Map<string, number>();     // a session -> when a late start of it lands
      const sleep = (ms: number): Promise<void> => new Promise<void>((res) => { world.envAfter(Math.max(SEC, ms), () => { res(); }); });
      /** A call's latency, through a freeze: the host's answer is waited for by a frozen server. */
      const hostDelay = async (ms: number): Promise<void> => {
        await sleep(ms);
        while (frozen()) await sleep(frozenUntil - wall() + SEC);
      };
      /** The fresh conversation the host starts: lands on the world's timer and is reported as a start, the renewal's `n`
       *  on the line G9 counts. */
      const startsFresh = (who: string, n: number, afterMs: number): void => {
        line('renew-start', idOf(who, n), `after=${afterMs}`, 'host');
        pendingStart.set(who, wall() + afterMs);
        world.envAfter(afterMs, () => {
          pendingStart.delete(who);
          const f = facts.get(who)!;
          f.ctx = between(12_000, 30_000); f.compactions = 0; f.compLines = [];
          if (who === COORD && !world.isDown()) {
            // A new conversation starts a new wave line: the older runs are no longer a boundary.
            db.prepare('DELETE FROM runs WHERE claimedBy = ? AND id < (SELECT MAX(id) FROM runs WHERE claimedBy = ?)').run(COORD, COORD);
          }
          deliverStart(who, { kind: 'started', resumed: false, renewal: true } as Extract<GenEvent, { kind: 'started' }>);
        });
      };
      let slowBudget = 0;      // a pass's acts hang at most once
      let crashDownFor = 0;
      const crashNow = (): void => {
        if (world.isDown() || frozen()) return;
        line('server', 'crash', 'down', 'sim');
        world.crash(crashDownFor);
      };
      const host: SessionHost = {
        async renew(who, n): Promise<RenewResult> {
          // Every draw first, in a fixed order, whichever branch is taken.
          const u = entropy.below(1000);
          const latency = between(1, 4) * SEC; const hang = between(30, 40) * SEC; const landAfter = between(2, 8) * SEC;
          const lateAfter = between(31, 45) * SEC;
          const crashHere = chance(entropy, 0.05); const reaches = chance(entropy, 0.5); const downFor = between(1, 10) * MIN;
          if (crashHere) {
            cover('crash-at-port-call');
            crashDownFor = downFor; crashNow();
            if (reaches) { line('renew-call', idOf(who, n), 'reached', 'host'); startsFresh(who, n, landAfter); }
            throw new Error('sim: the server died at the port call');
          }
          line('renew-call', idOf(who, n), 'reached', 'host');
          if (u < 40) { cover('link-drop'); await hostDelay(latency); return { kind: 'unreachable', detail: 'the agent link dropped' }; }
          if (u < 100) { cover('renew-refused'); await hostDelay(latency); return { kind: 'refused', reason: 'a dialog is open' }; }
          if (u < 120) { cover('renew-refused'); await hostDelay(latency); return { kind: 'kill-failed' }; }
          if (u < 160) { cover('renew-after-half-failed'); await hostDelay(latency); return { kind: 'wake-failed' }; }
          if (u < 180) { cover('renew-after-half-failed'); await hostDelay(latency); return { kind: 'wake-unrestored' }; }
          if (u < 230) { await hostDelay(latency); return { kind: 'unproven' }; }
          if (u < 300) {
            // It answers unreachable, and the session starts anyway, late.
            cover('renew-late-start');
            startsFresh(who, n, latency + lateAfter);
            await hostDelay(latency);
            return { kind: 'unreachable', detail: 'no answer in time' };
          }
          if (u < 340 && slowBudget > 0) {
            // A hang that answers late, started.
            slowBudget -= 1; cover('renew-hang'); cover('renew-late-start');
            startsFresh(who, n, hang + landAfter);
            await hostDelay(hang);
            return { kind: 'started' };
          }
          if (u < 380 && slowBudget > 0) { slowBudget -= 1; cover('renew-hang'); await hostDelay(hang); return { kind: 'unreachable', detail: 'timed out' }; }
          startsFresh(who, n, latency + landAfter);
          await hostDelay(latency);
          return { kind: 'started' };
        },
        async deliver(who): Promise<DeliverResult> {
          const drop = chance(entropy, 0.04); const refuse = chance(entropy, 0.03);
          const latency = between(1, 3) * SEC; const late = between(2, 60) * SEC; const matches = chance(entropy, 0.9);
          await hostDelay(latency);
          if (drop) { cover('link-drop'); return { kind: 'unreachable', detail: 'the agent link dropped' }; }
          if (refuse) return { kind: 'refused', reason: 'a dialog is open' };
          world.envAfter(late, () => doorWrite(() => readCard(who, matches)));
          return { kind: 'sent' };
        },
        async contextUsage(): Promise<never> { throw new Error('generation-day: contextUsage is not read in W1a'); },
        async receipt(who, since): Promise<ReceiptRead> {
          const drop = chance(entropy, 0.03); const latency = between(1, 3) * SEC;
          const landsAt = pendingStart.get(who);
          // A read waits behind a roll in flight, as the host's per-session queue makes it.
          await hostDelay(landsAt !== undefined && landsAt > wall() ? Math.max(latency, landsAt - wall() + SEC) : latency);
          if (drop) { cover('link-drop'); return { kind: 'unreadable', detail: 'the agent link dropped' }; }
          const r = store.startsOf(who, 50);
          if (!r.ok) return { kind: 'unreadable', detail: r.detail };
          // As the ccd adapter reads it: a fresh conversation's own start only (review 2149 F2).
          const ended = r.rows.find((s) => s.id === since)?.uuid ?? null;
          const hit = r.rows.find((s) => s.id > since && s.source === 'startup' && s.uuid !== ended);
          return hit === undefined ? { kind: 'none' } : { kind: 'started', startId: hit.id, uuid: hit.uuid };
        },
      };

      // ---- THE ACTS: the planned acts of a live pass, run on the boot's own store, the host above and the handover mail.
      const handoverAsked = new Set<string>();
      const staleBoot = (epoch: number): boolean => world.isDown() || epoch !== boots;
      const actsCoordFor = (epoch: number): RenewalActsDeps['coord'] => {
        const guard = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
          if (staleBoot(epoch)) throw new Error('sim: the server is down');
          return fn(...a);
        };
        return Object.assign(Object.create(traced) as object, {
          claimRenewCall: guard((...a: Parameters<CoordStore['claimRenewCall']>) => traced.claimRenewCall(...a)),
          answerRenewCall: guard((...a: Parameters<CoordStore['answerRenewCall']>) => traced.answerRenewCall(...a)),
          putCheckpoint: guard((...a: Parameters<CoordStore['putCheckpoint']>) => traced.putCheckpoint(...a)),
          stepGeneration: guard((...a: Parameters<CoordStore['stepGeneration']>) => traced.stepGeneration(...a)),
          setHoldOff: guard((...a: Parameters<CoordStore['setHoldOff']>) => traced.setHoldOff(...a)),
          raiseItem: guard((...a: Parameters<CoordStore['raiseItem']>) => traced.raiseItem(...a)),
        }) as unknown as RenewalActsDeps['coord'];
      };
      let acting = false;
      let actRun = 0;
      const runActs = (planned: readonly PlannedAct[]): Promise<void> => {
        const epoch = boots;
        slowBudget = 1;
        const deps: RenewalActsDeps = {
          coord: actsCoordFor(epoch), host, now: wall,
          mail: (toId, subject) => {
            if (subject !== RENEWAL_HANDOVER_SUBJECT) return true;
            if (handoverAsked.has(toId)) return false;
            handoverAsked.add(toId);
            const g = row(toId); const writes = chance(entropy, 0.7); const late = between(5, 90) * SEC;
            world.envAfter(late, () => {
              handoverAsked.delete(toId);
              if (writes) doorWrite(() => { store.putHandover({ generationId: g.id, note: { threads: [], cautions: [], tone: 'calm' }, dropped: 0, at: wall() }); });
            });
            return true;
          },
          log: (l) => { if (/not made: start \d+ is recorded/.test(l)) cover('retry-skipped-by-receipt'); },
        };
        actRun += 1;
        const mine = actRun;
        acting = true;
        const done = (): void => { if (actRun === mine) acting = false; };
        return (mods.acts ?? runRenewalActs)(deps, planned).then(done, (e: unknown) => { done(); throw e; });
      };

      // ---- The world's beat: context growth, compactions, idle stretches, the operator, wave boundaries, mail, answers to
      // an open probe round, unplanned starts and server crashes. A fixed order of draws on every beat.
      const roundPlans = new Map<string, { at: number; grade: 'pass' | 'fail' | 'never' }>();
      const answerRounds = (): void => {
        for (const [who] of WHO) {
          const after = between(10, 60) * SEC; const passes = chance(entropy, 0.85); const never = chance(entropy, 0.05);
          if (world.isDown() || frozen()) continue;
          const open = store.openProbeRound(who);
          if (!open.ok || open.rows.length === 0) continue;
          const roundId = open.rows[0]!.roundId;
          let plan = roundPlans.get(roundId);
          if (plan === undefined) { plan = { at: wall() + after, grade: never ? 'never' : passes ? 'pass' : 'fail' }; roundPlans.set(roundId, plan); }
          if (plan.grade === 'never' || wall() < plan.at) continue;
          const w = store.answerRound(roundId, who, open.rows.map((r) => ({ qid: r.qid, answer: 'x', grade: plan.grade as 'pass' | 'fail' })), 'unmeasured', wall());
          if (w.ok) lastGrade.set(who, plan.grade === 'pass');
        }
      };
      const worldBeat = (): void => {
        const now = server.clock.wall();
        if (now >= operatorFlipAt) { operatorHere = !operatorHere; operatorFlipAt = now + between(10, operatorHere ? 90 : 120) * MIN; }
        const operatorWrites = chance(entropy, 0.3);
        if (operatorHere && operatorWrites) operatorPending = true;
        for (const [who, role] of WHO) {
          const f = facts.get(who)!;
          const growth = between(500, 4_000);
          const goesIdle = chance(entropy, 0.02);
          const wakes = chance(entropy, 0.1);
          const compacts = chance(entropy, 0.05);
          const waveEnds = chance(entropy, 0.003);
          const readers = chance(entropy, 0.3) ? 1 : 0;
          const crashes = chance(entropy, 0.0005);
          const mailArrives = chance(entropy, 0.04);
          if (f.idleSince === null && goesIdle) f.idleSince = now;
          else if (f.idleSince !== null && wakes) f.idleSince = null;
          if (f.idleSince === null && (role === 'coordinator' || operatorHere)) f.ctx += growth;
          if (f.ctx > 160_000 && compacts) { f.ctx = 60_000; f.compactions++; f.compLines.push({ at: now }); }
          if (role === 'coordinator' && waveEnds && !world.isDown()) {
            // The wave ends and the next opens: the coordinator's newest run is open and the one before it closed.
            waveNo += 1;
            runMemo.clear();
            db.prepare("UPDATE runs SET state = 'done' WHERE claimedBy = ? AND state = 'working'").run(COORD);
            db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', ?, 99, 'project-a', 'working', ?, 0)").run(waveNo, COORD);
          }
          f.readers = readers;
          if (mailArrives) { mails += 1; mailbox.push({ who, k: mails }); line('mail', who, `queued;mail=${mails}`, 'host'); }
          if (crashes) { cover('unplanned-start'); deliverStart(who, { kind: 'started', resumed: true }); }
        }
        answerRounds();
        const serverCrash = chance(entropy, 0.0007);
        const downFor = between(1, 20) * MIN;
        const serverFreeze = chance(entropy, 0.0007);
        const frozenFor = between(2, 20) * MIN;
        if (serverFreeze && !world.isDown() && !frozen()) {
          cover('freeze-gap');
          line('server', 'freeze', `frozen;for=${frozenFor}`, 'sim');
          frozenUntil = server.clock.wall() + frozenFor; thawPending = true;
        }
        if (serverCrash && !world.isDown() && !frozen()) {
          cover('crash-gap');
          line('server', 'crash', 'down', 'sim');
          world.crash(downFor);
        }
        world.envAfter(BEAT_MS, worldBeat);
      };
      world.envAfter(BEAT_MS / 2, worldBeat);

      // ---- The server's beat: the generations lane's pass (it mints, ends, walks and plans), the Overlord's stand-in mints,
      // the mail the gate lets through, then the acts the pass planned.
      const wasUsage = (f: Facts, stale: boolean): UsageRead => ({ kind: 'reading', uuid: null, usage: {
        ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens: f.ctx, ctxWindow: 1_000_000, cost: null,
        cacheExpiresAt: null, stale } });
      const readingsNow = (): Map<number, GenReadings> => {
        const out = new Map<number, GenReadings>();
        const now = wall();
        for (const [who, role] of WHO) {
          const f = facts.get(who)!;
          const stale = chance(entropy, 0.05);
          const held = chance(entropy, 0.15);
          const busy = f.readers > 0 || held;
          const turn: TurnMarkRead = f.idleSince === null
            ? { ok: true, sessionId: who, state: 'working', event: 'sim', at: now, turnAt: now, stopAt: null, bg: 0, bgKinds: [], bgIds: [], err: null,
              restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: 0, graceUntil: null }
            : { ok: true, sessionId: who, state: 'done', event: 'sim', at: f.idleSince, turnAt: f.idleSince, stopAt: f.idleSince, bg: 0, bgKinds: [], bgIds: [],
              err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: 0, graceUntil: null };
          out.set(row(who).id, {
            usage: wasUsage(f, stale),
            compactions: f.compLines.length === 0 ? { kind: 'absent' }
              : { kind: 'lines', lines: f.compLines.map((c) => ({ at: c.at, trigger: 'auto' as const, phase: 'pre' as const, transcript: null, scope: 'main' as const })), skipped: 0, eventsAbsent: false },
            turn, behind: M(false),
            drain: busy ? { held: true, reason: 'readers' } : { held: false },
            // I7: a coordinator's reader wait is the hold table's in W1a, and it has no Overlord place; the Overlord's place
            // report is W1's, so unmeasured here.
            soft: { operatorQuietObservedMs: M(obsOf('overlord') - lastOperatorObs), readersRunning: role === 'coordinator' ? NA : M(f.readers),
              placeHiddenObservedMs: role === 'overlord' ? U : NA },
          });
        }
        return out;
      };

      /** The lines the store's rows say about one identity after a pass: a gap and the accumulator. G5 counts the mints
       *  (written as the lane mints) against the `report` lines, which the host writes. */
      const passLines = (who: string, before: GenRow, gaps: GenerationsResult['gaps']): void => {
        const after = row(who);
        const old = before.n === after.n ? after : (store.db.prepare('SELECT observed FROM continuity_generations WHERE identity = ? AND n = ?')
          .get(who, before.n) as { observed: string } | undefined);
        const was = old === after ? after.observed : JSON.parse((old as { observed: string }).observed) as GenRow['observed'];
        // Did the accumulator's write commit this pass? Decided by the scenario, never by the stamp the decider under test
        // wrote (review 2003 F6): a pass no abort cut short advanced every identity; one an abort cut short advanced those
        // whose stored observed time moved.
        const moved = was.ms !== before.observed.ms || was.mono !== before.observed.mono || was.proc !== before.observed.proc;
        const advanced = !fault.fired || moved;
        // The gap the pass recorded, as the decider answered it (never re-derived from the rows).
        // It carries the scenario's mono, so G4 can tell a step the clock took from one a skewed stamp made (review 2006 R7).
        if (advanced) for (const gp of gaps) if (gp.identity === who) line('obs-gap', who, `kind=${gp.kind};deltaMs=${gp.deltaMs};mono=${server.clock.mono()}`, 'lane');
        // The scenario's own monotonic clock, so G4 holds the accumulator to the clock it was read on.
        if (advanced) line('obs', who, `ms=${was.ms};mono=${server.clock.mono()}`, 'lane');
      };

      /** The mail the world queued, delivered when the gate (`renewalHoldsMail`, over the generation's `state` column) lets it.
       *  WHAT G11 DOES NOT COVER (review 2149 F16): this toy mailbox stands in for the server's delivery sweep. It asks the same
       *  gate decider over the same column, but it is not `sweepMail`: the sweep's own wiring of the gate (the word checked
       *  before the cooldown, no attempt spent on a held delivery) and A3's replay of a delivered, unacked row after `probing`
       *  are not driven here, and since this mailbox delivers each mail once by construction, "at most once" cannot catch a
       *  replay. `mail-sweep.test.ts` covers the real wiring. */
      const deliverMail = (): void => {
        for (const m of [...mailbox]) {
          const state = row(m.who).state;
          if (renewalHoldsMail(state, { fromId: 'peer', subject: 'ping' })) { cover('mail-held'); continue; }
          mailbox.splice(mailbox.indexOf(m), 1);
          line('mail', m.who, `delivered;mail=${m.k};gen=${state}`, 'server');
        }
      };

      const serverBeat = (): Promise<void> | undefined => {
        server.scheduler.after(BEAT_MS, serverBeat);
        if (frozen()) return undefined;
        if (thawPending) {
          thawPending = false;
          line('server', 'thaw', 'thawed', 'sim');
          for (const h of frozenQueue.splice(0)) h.run();
        }
        // The lane runs one pass at a time: while an earlier pass's acts are still running, this beat does nothing.
        if (acting) return undefined;
        // A crash inside the pass, at its k-th write to the generations or the cursor, more often while a start waits; a
        // busy pass writes about a dozen times (two accumulators, a mint's end, insert and cursor, two due records, the
        // Overlord's mint), so the draw reaches its last writes (review 2003 F8).
        const waiting = (store.generationsCursor(GENERATIONS_LANE) as { lastStartId: number }).lastStartId < reports || overlordStarts.length > 0;
        const crashes = chance(entropy, waiting ? 0.3 : 0.001);
        const at = between(0, 14);
        const downFor = between(1, 10) * MIN;
        const crashBeforeActs = chance(entropy, 0.03);
        if (crashes) arm(at);
        crashDownFor = downFor;
        const before = new Map(WHO.map(([who]) => [who, row(who)]));
        const readings = readingsNow();
        // The stand-in registry is listed after this beat's deliveries (it names every conversation reported so far), so its
        // listing postdates every start received yet.
        // The day drives the live walk too (its arm drawn per seed), so it opens the continuity row's gate.
        const decide = { renewalDue: mods.renewal.renewalDue, softRenewalMay: mods.soft.softRenewalMay, generationStep: mods.machine.generationStep,
          ...(mods.feed === undefined ? {} : { renewalFeed: mods.feed.renewalFeed }),
          ...(mods.permit === undefined ? {} : { renewalPermit: mods.permit.renewalPermit }) };
        const passed = wrote(generationsPass({ coord: lane, clock: server.clock, entropy, proc, log: () => {}, observe: mods.observed.observeTime, retried, emptyTries, gate: () => null, decide },
          { registry: WHO.map(([who]) => ({ id: who, uuid: uuids.get(who)!, lane: 'lane-a', child: { kind: 'none' as const } })),
            listedAt: wall() + 1, readings, canRenew: true }));
        // W1's designation, stood in for: the Overlord's starts mint through the same store function, in order.
        while (overlordStarts.length > 0) {
          const id = overlordStarts[0]!;
          const s = (store.startsSince(id - 1, 1) as { rows: { reportedAt: number; source: string }[] }).rows[0]!;
          const held = row('overlord');
          const renewed = genViewOf(held, live).state === 'clearing';
          const w = wrote(store.mintGeneration({ identity: 'overlord', sessionId: 'overlord', role: 'overlord', term: 1, rowIncarnation: 'inc',
            startId: id, startReportedAt: s.reportedAt, resumed: s.source === 'resume', model: null, lane: 'lane-a', host: null,
            outcome: renewed ? 'renewed' : 'woken', mono: server.clock.mono(), proc, now: wall() },
          genExpectOf(held), live));
          if (!w.ok && w.kind === 'write-failed') break;
          overlordStarts.shift();
          if (w.ok) {
            traceMint('overlord', w.n);
            // A renewed Overlord's first turn is the door process's first call (W1): it sends the session to its card.
            if (renewed) sessionReadsCard('overlord');
          }
        }
        for (const [who] of WHO) passLines(who, before.get(who)!, passed.gaps);
        // G5 and G8 read the live generations after a pass that ran to its end; a pass an abort cut short is judged by the
        // next. The edge is covered only when an abort landed (review 2003 F8), not when one was drawn.
        if (!fault.fired) line('pass', 'server', WHO.map(([who]) => `${who}=${row(who).startId}`).join(';'), 'lane');
        if ((passed.waits['overlord-first'] ?? 0) > 0) cover('overlord-first');
        if ((passed.waits.budget ?? 0) > 0) cover('budget-wait');
        for (const [who] of WHO) { const r = row(who); if (r.state === 'degraded' && r.dueClass === 'soft') cover('soft-due-in-degraded'); }
        if (crashes) {
          if (fault.fired) cover('crash-mid-pass');
          line('server', 'crash', 'down', 'sim');
          world.crash(downFor);
          return undefined;
        }
        if (operatorPending) { operatorPending = false; lastOperatorObs = obsOf('overlord'); }
        deliverMail();
        if (!passed.live || passed.planned.length === 0 || wall() >= ACTS_END) return undefined;
        if (crashBeforeActs) {
          // The pass ran to its end and the server died before it took the acts: the claims were never made, and the next
          // pass after the boot plans them again from the rows.
          cover('crash-before-acts');
          line('server', 'crash', 'down', 'sim');
          world.crash(downFor);
          return undefined;
        }
        if (passed.planned.some((p) => p.act.kind === 'renudge-card')) cover('renudge');
        return runActs(passed.planned);
      };

      world.onBoot(() => {
        proc = `p${boots++}`;
        retried = new Set<number>(); emptyTries = new Map();
        arm(DISARMED);
        acting = false;
        handoverAsked.clear();
        // A crash right after a thaw loses what waited in the socket, except a start (the start-while-down rule).
        for (const h of frozenQueue.splice(0)) if (h.start !== null) startQueue.push([h.who, h.start]);
        thawPending = false;
        if (boots > 1) {
          line('server', 'boot', 'up', 'sim');
          for (const [who, e] of startQueue.splice(0)) { cover('start-while-down'); reportStart(who, e as Extract<GenEvent, { kind: 'started' }>); }
        }
        server.scheduler.after(BEAT_MS, serverBeat);
      });
    },
  };
}

// ---- The invariants: predicates over the lines alone.
const violation = (invariant: string, l: SequenceLine, message: string): Violation => ({ invariant, seq: l.seq, message });
/** Table 11.5b: one observed step is at most two periods of the 30 s renewal lane, written here from the table rather
 *  than read from the code under test. */
const STEP_CAP_MS = 60_000;
/** §3.3.11's renewal budget runs through these states, checkpointed to active. */
const BUDGET_STATES = ['checkpointed', 'clearing', 'carded', 'probing'] as const;
const H1 = 3_600_000;
const num = (state: string, key: string): number => Number(new RegExp(`${key}=(-?\\d+)`).exec(state)?.[1] ?? Number.NaN);

export const GEN_DAY_INVARIANTS: readonly Invariant[] = [
  { name: 'G1', says: 'no generation is active without a read card hash and a passed round',
    check(lines) {
      const minted = new Set<string>(); const card = new Set<string>(); const passed = new Set<string>();
      for (const l of lines) {
        if (l.kind === 'gen' && l.actor === 'mint') minted.add(l.id);
        if (l.kind === 'card' && l.state === 'match') card.add(l.id);
        if (l.kind === 'probes' && l.state === 'passed' && card.has(l.id)) passed.add(l.id);
        if (l.kind === 'gen' && l.state === 'active' && minted.has(l.id) && !(card.has(l.id) && passed.has(l.id))) {
          return violation('G1', l, `${l.id} active without a read card and a passed round`);
        }
      }
      return null;
    } },
  { name: 'G2', says: 'at most three soft renewals in any six hours of observed time, per identity, live (each soft due a live walk feeds is a row of continuity_soft_renewals, so a repeated one is counted again; a shadow walk records none, review 2149 F14, so the budget does not bound it)',
    check(lines) {
      const by = new Map<string, Array<[number, SequenceLine]>>();
      for (const l of lines) {
        if (l.kind === 'soft-renewal' && num(l.state, 'live') === 1) {
          const xs = by.get(l.id) ?? []; xs.push([num(l.state, 'obs'), l]); by.set(l.id, xs);
          const within = xs.filter(([t]) => xs.at(-1)![0] - t < SOFT_BUDGET.windowMs);
          if (within.length > SOFT_BUDGET.count) return violation('G2', l, `${l.id}: ${within.length} soft renewals in six observed hours`);
        }
      }
      return null;
    } },
  { name: 'G3', says: 'no soft renewal ends a generation younger than 30 observed minutes',
    check(lines) {
      for (const l of lines) if (l.kind === 'soft-renewal' && !(num(l.state, 'age') >= LEAST_AGE_MS)) {
        return violation('G3', l, `${l.id}: a soft renewal at observed age ${num(l.state, 'age')}`);
      }
      return null;
    } },
  { name: 'G4', says: 'per identity: a restart never advances observed time; a freeze advances it by the step cap and answers a step gap; a step gap follows a freeze, a crash or a boot, or a step of the clock itself past the cap; within one process with no gap, observed time advances exactly as the monotonic clock does (an obs line carries its mono stamp; one without reads its wall stamp, which no day skews); no deadline fires twice',
    check(lines) {
      interface Track { last: number | null; lastClock: number; lastBeforeCrash: number | null; afterBoot: boolean; stepGap: boolean; gapSince: boolean; frozeSince: boolean; lastObsSeq: number }
      const by = new Map<string, Track>();
      const of = (id: string): Track => {
        let t = by.get(id);
        if (t === undefined) { t = { last: null, lastClock: 0, lastBeforeCrash: null, afterBoot: false, stepGap: false, gapSince: false, frozeSince: false, lastObsSeq: -1 }; by.set(id, t); }
        return t;
      };
      const fired = new Set<string>();
      // The newest freeze, crash or boot line: a step gap after it has a cause, for an identity first seen after it too.
      let causeSeq = -1;
      for (const l of lines) {
        if (l.kind === 'server' && (l.state === 'down' || l.state === 'up' || l.state.startsWith('frozen'))) causeSeq = l.seq;
        if (l.kind === 'server' && l.state === 'down') for (const t of by.values()) { t.lastBeforeCrash = t.last; t.gapSince = true; t.frozeSince = false; }
        if (l.kind === 'server' && l.state === 'up') for (const t of by.values()) { t.afterBoot = true; t.gapSince = true; }
        if (l.kind === 'server' && l.state.startsWith('frozen')) for (const t of by.values()) { t.frozeSince = true; t.gapSince = true; }
        if (l.kind === 'obs-gap') {
          const t = of(l.id);
          t.gapSince = true;
          if (l.state.startsWith('kind=step;')) {
            t.stepGap = true;
            // A step gap with no freeze, crash or boot before it is honest only when the clock itself stepped that far
            // since the last observation (review 2006 R7): a skewed stored stamp answers step gaps the clock never took.
            const mono = num(l.state, 'mono');
            if (causeSeq <= t.lastObsSeq && (t.last === null || Number.isNaN(mono) || num(l.state, 'deltaMs') !== mono - t.lastClock)) {
              return violation('G4', l, `${l.id}: a step gap of ${num(l.state, 'deltaMs')} ms with no freeze, crash or boot before it, in ${mono - t.lastClock} of clock (review 2006 R7)`);
            }
          }
          if (l.state.startsWith('kind=process;')) t.frozeSince = false;   // a freeze right after a boot: the restart's gap answers it
        }
        if (l.kind === 'obs') {
          const t = of(l.id);
          const ms = num(l.state, 'ms');
          const mono = num(l.state, 'mono');
          const clock = Number.isNaN(mono) ? l.at : mono;
          const { last } = t;
          if (last !== null && ms < last) return violation('G4', l, `${l.id}: observed time fell from ${last} to ${ms}`);
          if (t.afterBoot && t.lastBeforeCrash !== null && ms !== t.lastBeforeCrash) {
            return violation('G4', l, `${l.id}: observed time moved across a gap: ${t.lastBeforeCrash} before the crash, ${ms} after the boot`);
          }
          if (last !== null && ms - last > STEP_CAP_MS) return violation('G4', l, `${l.id}: one step advanced ${ms - last}, past the cap`);
          if (t.stepGap && last !== null && ms - last !== STEP_CAP_MS) {
            return violation('G4', l, `${l.id}: a freeze advanced observed time by ${ms - last}, not by the cap (review 1894, F1)`);
          }
          // A freeze before the first observation has no stamp to step from (review 1920, R1).
          if (t.frozeSince && last !== null && !t.stepGap) return violation('G4', l, `${l.id}: a freeze answered no step gap (review 1912, F7)`);
          // Both ways: within one process with no gap, observed time advances by exactly the clock's step (review 1920,
          // R5), the monotonic clock's when the line carries it (review 1925, N5).
          if (!t.gapSince && last !== null && ms - last !== clock - t.lastClock) {
            return violation('G4', l, `${l.id}: observed time moved ${ms - last} ms in ${clock - t.lastClock} of clock (review 1912, F2; review 1920, R5)`);
          }
          t.afterBoot = false; t.stepGap = false; t.gapSince = false; t.frozeSince = false; t.lastObsSeq = l.seq; t.last = ms; t.lastClock = clock;
        }
        if (l.kind === 'deadline') {
          if (fired.has(l.id)) return violation('G4', l, `deadline ${l.id} fired twice`);
          fired.add(l.id);
        }
      }
      return null;
    } },
  { name: 'G6', says: 'each transient state ends within its deadline plus one lane period, and a renewal that lands (a later generation active) spends at most RENEWAL_BUDGET_S from checkpointed or clearing, plus one lane period per state, unless the server was down or frozen meanwhile',
    check(lines) {
      // The lane sees a deadline at its next pass, so each state may run one period past it (review 1912, F10).
      const slack = RENEWAL_LANE_PERIOD_MS;
      const budget = RENEWAL_BUDGET_S * 1_000 + BUDGET_STATES.length * slack;
      const cur = new Map<string, { state: string; at: number; n: number; waived: boolean }>();
      const began = new Map<string, { at: number; n: number; waived: boolean }>();
      for (const l of lines) {
        if (l.kind === 'server' && (l.state === 'down' || l.state.startsWith('frozen'))) {
          for (const c of cur.values()) c.waived = true;
          for (const b of began.values()) b.waived = true;
        }
        if (l.kind !== 'gen') continue;
        const who = l.id.slice(0, l.id.lastIndexOf('#')); const n = Number(l.id.slice(l.id.lastIndexOf('#') + 1));
        const c = cur.get(who);
        const deadlineS = c === undefined ? undefined : STATE_DEADLINE_S[c.state as keyof typeof STATE_DEADLINE_S];
        if (c !== undefined && c.n === n && deadlineS !== undefined && !c.waived && l.at - c.at > deadlineS * 1_000 + slack) {
          return violation('G6', l, `${l.id}: ${c.state} lasted ${l.at - c.at} ms, past its ${deadlineS} s and one lane period`);
        }
        cur.set(who, { state: l.state, at: l.at, n, waived: false });
        if ((l.state === 'checkpointed' || l.state === 'clearing') && !began.has(who)) began.set(who, { at: l.at, n, waived: false });
        if (l.state === 'degraded') began.delete(who);   // the renewal ended without landing, on either generation
        if (l.state === 'active' && began.has(who)) {
          const b = began.get(who)!; began.delete(who);
          if (n > b.n && !b.waived && l.at - b.at > budget) return violation('G6', l, `${l.id}: a renewal took ${l.at - b.at} ms`);
        }
      }
      return null;
    } },
  { name: 'G7', says: 'a soft renewal starts only from active, and never while the generation\'s hold-off stands',
    check(lines) {
      const holdOff = new Map<string, number>();
      for (const l of lines) {
        if (l.kind === 'hold-off') holdOff.set(l.id, num(l.state, 'until'));
        if (l.kind !== 'soft-renewal') continue;
        const from = /from=(\w+)/.exec(l.state)?.[1];
        if (from !== 'active') return violation('G7', l, `${l.id}: a soft renewal from ${from} ("degraded blocks soft triggers")`);
        const until = holdOff.get(`${l.id}#${num(l.state, 'n')}`);
        if (until !== undefined && num(l.state, 'age') < until) return violation('G7', l, `${l.id}: a soft renewal at age ${num(l.state, 'age')}, inside the hold-off to ${until}`);
      }
      return null;
    } },
  { name: 'G5', says: 'every reported start mints at most one generation, the next number, and each start that has to mint does: at the first pass that runs to its end after it, a startup, or a start whose conversation is the identity\'s newest reported one (slug uuid-checked-against-the-current-row: a start whose conversation a later start replaced before it was judged may mint nothing); the day\'s first start is n=1\'s',
    check(lines) {
      interface Rep { uuid: string | undefined; source: string | undefined }
      const reports = new Map<string, Rep[]>(); const settled = new Map<string, number>();
      const must = new Map<string, number>(); const mints = new Map<string, number>();
      for (const l of lines) {
        if (l.kind === 'report') {
          const xs = reports.get(l.id) ?? [];
          xs.push({ uuid: /uuid=([^;]+)/.exec(l.state)?.[1], source: /source=([^;]+)/.exec(l.state)?.[1] });
          reports.set(l.id, xs);
        }
        if (l.kind === 'gen' && l.actor === 'mint') {
          const who = l.id.slice(0, l.id.lastIndexOf('#'));
          mints.set(who, (mints.get(who) ?? 0) + 1);
          if (mints.get(who)! > (reports.get(who)?.length ?? 0) - 1) return violation('G5', l, `${who}: a mint with no start`);
          if (Number(l.id.slice(l.id.lastIndexOf('#') + 1)) !== mints.get(who)! + 1) return violation('G5', l, `${l.id}: not the next number`);
        }
        if (l.kind === 'pass') {
          for (const [who, xs] of reports) {
            const newest = xs.at(-1)!.uuid;
            for (let k = Math.max(1, settled.get(who) ?? 1); k < xs.length; k += 1) {
              if (xs[k]!.source === 'startup' || xs[k]!.uuid === newest) must.set(who, (must.get(who) ?? 0) + 1);
            }
            settled.set(who, xs.length);
            if ((mints.get(who) ?? 0) < (must.get(who) ?? 0)) {
              return violation('G5', l, `${who}: ${must.get(who)} reported starts had to mint, ${mints.get(who) ?? 0} minted`);
            }
          }
        }
      }
      return null;
    } },
  { name: 'G8', says: 'after every pass that runs to its end, a crash inside the one before included, each identity has exactly one live generation, minted by its newest reported start',
    check(lines) {
      const newest = new Map<string, number>();
      for (const l of lines) {
        if (l.kind === 'report') newest.set(l.id, num(l.state, 'start'));
        if (l.kind !== 'pass') continue;
        for (const part of l.state.split(';')) {
          const [who, id] = part.split('=');
          const want = newest.get(who!);
          if (want !== undefined && Number(id) !== want) {
            return violation('G8', l, `${who}: the live generation was minted by start ${id}, not by the newest reported start ${want}`);
          }
        }
      }
      return null;
    } },
  // ---- The renewal act's invariants (Task 5). G7 and G8 above keep their meaning, so these are the next free names.
  { name: 'G9', says: 'at most one fresh conversation per renewal: the fake port\'s renew calls that started a session, counted from one renewal\'s beginning to the next, are at most one per generation',
    check(lines) {
      const started = new Map<string, number>();
      for (const l of lines) {
        if (l.kind === 'renewal' && l.state.startsWith('began')) started.set(l.id, 0);
        if (l.kind !== 'renew-start') continue;
        const k = (started.get(l.id) ?? 0) + 1;
        started.set(l.id, k);
        if (k > 1) return violation('G9', l, `${l.id}: ${k} renew calls started a fresh conversation in one renewal`);
      }
      return null;
    } },
  { name: 'G10', says: 'every renewal ends: within RENEWAL_BUDGET_S (plus one lane period per state) from checkpointed or clearing, or in degraded, or back in active with a hold-off (the act that sets it follows the step, so it is owed until the generation\'s next renewal or the day\'s end, unless the server died in between), and back to active only for a generation that was proven (a live arm\'s rule; an unproven one ends in degraded); a crash or a freeze waives the time bound',
    check(lines) {
      const limit = RENEWAL_BUDGET_S * 1_000 + BUDGET_STATES.length * RENEWAL_LANE_PERIOD_MS;
      interface Open { id: string; n: number; clock: number | null; proven: boolean; waived: boolean }
      const open = new Map<string, Open>();
      /** Generations that went back to active and whose hold-off has not been written: the line, and whether the server died since. */
      const owes = new Map<string, { line: SequenceLine; died: boolean }>();
      let live = false;
      const late = (r: Open, l: SequenceLine): boolean => r.clock !== null && !r.waived && l.at - r.clock > limit;
      for (const l of lines) {
        if (l.kind === 'arm') live = l.state === 'live';
        if (l.kind === 'server' && (l.state === 'down' || l.state.startsWith('frozen'))) {
          for (const r of open.values()) r.waived = true;
          if (l.state === 'down') for (const o of owes.values()) o.died = true;
        }
        if (l.kind === 'hold-off') owes.delete(l.id);
        if (l.kind === 'renewal' && l.state.startsWith('began')) {
          const owed = owes.get(l.id);
          if (owed !== undefined && !owed.died) return violation('G10', owed.line, `${l.id}: back to active with no hold-off, and renewed again`);
          owes.delete(l.id);
          const who = l.id.slice(0, l.id.lastIndexOf('#'));
          open.set(who, { id: l.id, n: Number(l.id.slice(l.id.lastIndexOf('#') + 1)), clock: null, proven: /proven=1/.test(l.state), waived: false });
          continue;
        }
        for (const [who, r] of open) if (late(r, l)) return violation('G10', l, `${r.id}: the renewal of ${who} has not ended ${l.at - r.clock!} ms after its checkpointed or clearing`);
        if (l.kind !== 'gen') continue;
        const who = l.id.slice(0, l.id.lastIndexOf('#')); const n = Number(l.id.slice(l.id.lastIndexOf('#') + 1));
        const r = open.get(who);
        if (r === undefined) continue;
        if (r.clock === null && (l.state === 'checkpointed' || l.state === 'clearing')) r.clock = l.at;
        if (l.state === 'degraded') open.delete(who);
        if (l.state === 'active') {
          if (n === r.n && live && !r.proven) return violation('G10', l, `${l.id}: an unproven generation went back to active (it ends in degraded)`);
          // In the day's last minutes no acts start (`ACTS_END`), so no hold-off is owed for a step taken then.
          if (n === r.n && live && l.at < ACTS_END) owes.set(l.id, { line: l, died: false });
          if (n >= r.n) open.delete(who);
        }
      }
      const end = lines.at(-1);
      if (end !== undefined) {
        for (const [who, r] of open) if (late(r, end)) return violation('G10', end, `${r.id}: the renewal of ${who} never ended`);
        for (const o of owes.values()) if (!o.died && end.at - o.line.at > RENEWAL_LANE_PERIOD_MS * 4) return violation('G10', o.line, `${o.line.id}: back to active and never given a hold-off`);
      }
      return null;
    } },
  { name: 'G11', says: 'a delivery to a renewing session is held and none is lost: no mail is delivered while its recipient\'s generation is in draining to probing, each is delivered at most once, and each queued an hour before the day\'s end was delivered (over the day\'s own mailbox, which asks the gate decider; the server\'s sweep and its replay are not driven here)',
    check(lines) {
      const queued = new Map<string, number>(); const delivered = new Map<string, number>();
      for (const l of lines) {
        if (l.kind !== 'mail') continue;
        const k = `${l.id}:${/mail=(\d+)/.exec(l.state)?.[1]}`;
        if (l.state.startsWith('queued')) { queued.set(k, l.at); continue; }
        if (!l.state.startsWith('delivered')) continue;
        const gen = /gen=(\w+)/.exec(l.state)?.[1] ?? '';
        if (RENEWING_STATES.has(gen as never)) return violation('G11', l, `${k}: delivered while its recipient's generation was ${gen}`);
        delivered.set(k, (delivered.get(k) ?? 0) + 1);
        if (delivered.get(k)! > 1) return violation('G11', l, `${k}: delivered twice`);
        if (!queued.has(k)) return violation('G11', l, `${k}: delivered, never queued`);
      }
      const end = lines.at(-1);
      if (end !== undefined) for (const [k, at] of queued) if (!delivered.has(k) && end.at - at > H1) return violation('G11', end, `${k}: queued ${end.at - at} ms before the end and never delivered`);
      return null;
    } },
  { name: 'G12', says: 'a live renewal that reaches clearing makes its renew call before it leaves clearing (the fake host sees one), unless the server died meanwhile: a due generation that once went back to active is renewed again',
    check(lines) {
      interface Open { id: string; called: boolean; died: boolean }
      const open = new Map<string, Open>();
      let live = false;
      for (const l of lines) {
        if (l.kind === 'arm') live = l.state === 'live';
        if (l.kind === 'server' && l.state === 'down') for (const o of open.values()) o.died = true;
        if (l.kind === 'renew-call') for (const o of open.values()) if (o.id === l.id) o.called = true;
        if (l.kind !== 'gen' || !live) continue;
        const who = l.id.slice(0, l.id.lastIndexOf('#'));
        const o = open.get(who);
        // A renewal that reaches clearing in the day's last minutes, when no acts start (`ACTS_END`), is not judged.
        if (l.state === 'clearing') { if (o === undefined && l.at < ACTS_END) open.set(who, { id: l.id, called: false, died: false }); continue; }
        if (o !== undefined) {
          open.delete(who);
          if (!o.called && !o.died) return violation('G12', l, `${o.id}: left clearing (${l.state}) without a renew call ever reaching the host`);
        }
      }
      return null;
    } },
];
