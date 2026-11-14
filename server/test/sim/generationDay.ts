// A generation day (Overlord W1a, renewal deciders Task 6; spec §3.3.11, §11.5, §11.7): an Overlord and a coordinator
// for a seeded day of context growth, compactions, operator presence and absence, idle stretches, host failures,
// unplanned starts, server crashes with gaps (between passes and inside one, at any of its writes), and server freezes. The
// server side is driven through the deciders (`renewalDue`, `softRenewalMay`, `generationStep`) and the generations piece's
// real lane and store (`generationsPass` over an in-memory coord.db: the lane mints and ends from the reported starts and
// advances each identity's observed accumulator with `observeTime`; every other step is the store's compare-and-set); the
// deciders' modules are a parameter, so a mutated copy can be handed to the same scenario.
//
// The pass is synchronous: it awaits nothing, so the simulator's "an async lane runs after the timers" limit does not apply
// to it, and a crash is placed inside it by a write that aborts (and every write after it, the countdown kept outside the
// aborting transaction), not by an interleaving. The `continuity` row is drawn per seed, so shadow runs under crashes too.
//
// Durable state (coord.db: the generations, the starts, the cursor; and the renewal act's stand-in records, the soft
// renewals' stamps) survives a crash; the server's timers do not. The world (the sessions, their hosts, the operator) keeps its own timers, which survive. The predicates read
// only the sequence's lines: generation rows and the fake clock, never sweep phases (the simulator's beat and its async
// limit, carried from W1a's simulator piece).
import { DatabaseSync } from 'node:sqlite';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import { CONTINUITY_LANE } from '../../../shared/lane-arm.js';
import { LEAST_AGE_MS, RENEWAL_BUDGET_S, RENEWAL_LANE_PERIOD_MS, SOFT_BUDGET, STATE_DEADLINE_S } from '../../../shared/continuity.js';
import { MIGRATIONS } from '../../src/coord/schema.js';
import { CoordStore } from '../../src/coord/store.js';
import { effectiveGeneration, genExpectOf, genViewOf, type GenRow } from '../../src/continuity/continuityStore.js';
import {
  GENERATIONS_LANE, generationsPass, softTimesOf, type GenerationsCoord, type GenerationsResult,
} from '../../src/continuity/generationsLane.js';
import type { GenEvent } from '../../src/continuity/generationMachine.js';
import type { Reading, RenewalInputs } from '../../src/continuity/renewalDue.js';
import type { SoftInputs } from '../../src/continuity/softRenewal.js';
import type { Scenario } from './run.js';
import type { Invariant, SequenceLine, Violation } from './sequence.js';
import { chance } from './world.js';

/** The deciders, passed in so that a mutant can be handed to the same scenario. `observed` is the lane's own import now;
 *  it stays in the set for the scenarios that hand a mutant of it. */
export interface GenDayModules {
  readonly renewal: Pick<typeof import('../../src/continuity/renewalDue.js'), 'renewalDue'>;
  readonly soft: Pick<typeof import('../../src/continuity/softRenewal.js'), 'softRenewalMay'>;
  readonly machine: Pick<typeof import('../../src/continuity/generationMachine.js'), 'generationStep' | 'GEN_ACTIVE' | 'GEN_MINTED'>;
  readonly observed: Pick<typeof import('../../src/time/observed.js'), 'observeTime' | 'observedStepCapMs'>;
  /** The store as the lane's pass sees it; the store itself unless a mutation row hands a wrapper of it (review 2003 F9). */
  readonly coord?: (store: CoordStore) => GenerationsCoord;
}

export const GEN_DAY_EDGES = ['soft-renewal', 'hard-renewal', 'renewed', 'crash-gap', 'freeze-gap', 'start-while-down', 'degraded',
  'hold-off', 'budget-wait', 'probe-retry', 'renudge', 'unplanned-start', 'overlord-first', 'clearing-timeout-back',
  'clearing-timeout-degraded', 'soft-due-in-degraded', 'probing-timeout', 'crash-mid-pass', 'live-arm', 'shadow-arm'] as const;
export type GenDayEdge = (typeof GEN_DAY_EDGES)[number];

const START = Date.parse('2026-11-13T00:00:00Z');
const DAY_MS = 24 * 3_600_000;
const BEAT_MS = RENEWAL_LANE_PERIOD_MS;   // the server's lane and the world both beat at the renewal lane's period
const SEC = 1_000;
const MIN = 60_000;
const COORD = 'lane-a-coordinator';
const WHO: ReadonlyArray<readonly [string, FleetRole]> = [['overlord', 'overlord'], [COORD, 'coordinator']];
const TRANSIENT = new Set(['draining', 'checkpointed', 'clearing', 'carded', 'probing']);

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
  simDb.exec(`DELETE FROM continuity_generations; DELETE FROM continuity_cursor;
    DELETE FROM continuity_starts; DELETE FROM runs; DELETE FROM programs;`);
  return simDb;
}
interface Facts {
  ctx: number; turns: number; compactions: number; idleSince: number | null; wave: boolean; readers: number;
}

export function generationDay(mods: GenDayModules): Scenario<GenDayEdge> {
  return {
    name: 'generation-day', startWallMs: START, durationMs: DAY_MS, edges: GEN_DAY_EDGES,
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
      const lane = mods.coord === undefined ? store : mods.coord(store);
      db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 0, 'active')");
      db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 9, 'project-a', 'working', ?, 0)").run(COORD);
      const live = chance(entropy, 0.5);
      store.setLaneArm(CONTINUITY_LANE, live ? 'live' : 'shadow', 0);
      cover(live ? 'live-arm' : 'shadow-arm');
      line('arm', CONTINUITY_LANE, live ? 'live' : 'shadow', 'sim');
      const uuids = new Map<string, string>();
      let reports = 0;
      /** The live generations as last read, dropped by every write (`wrote`), so a beat reads the table once per change. */
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
      const obsOf = (who: string): number => row(who).observed.ms;
      // The Overlord's starts: W1a's lane cannot tell its role (no designation before W1), so the scenario mints them
      // through the same store function in the lane's order, standing in for W1's designation (slug sim-overlord-mints).
      const overlordStarts: number[] = [];
      let proc = 'p0';
      let boots = 0;
      // The lane's per-process memo of the starts it held (review 2006 R3): a boot forgets it, as a restarted server does.
      let retried = new Set<number>();

      // Both generations working when the day begins: n=1 minted from a startup, then active (a generation that was
      // working when the machine began), and the cursor past both starts.
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
      const frozenQueue: Array<[string, number | null, GenEvent]> = [];
      const frozen = (): boolean => wall() < frozenUntil;

      // ---- WORLD: the sessions, their hosts and the operator. Their timers survive a crash.
      const facts = new Map<string, Facts>();
      for (const [who] of WHO) facts.set(who, { ctx: 20_000, turns: 0, compactions: 0, idleSince: null, wave: false, readers: 0 });
      // The renewal act's own records, which W1a's store does not hold yet: when a soft trigger became due, and when each
      // soft renewal began (slug sim-soft-stamps-stand-in). They survive a crash.
      const dueSinceObs = new Map<string, number | null>();
      const softStamps = new Map<string, number[]>();
      let operatorHere = true;
      let lastOperatorObs = 0;
      let operatorPending = false;
      let operatorFlipAt = START + 40 * MIN;

      const idOf = (who: string, n: number): string => `${who}#${n}`;

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
      const reportStart = (who: string, e: Extract<GenEvent, { kind: 'started' }>): void => {
        report(who, e.resumed ? 'resume' : 'clear', !e.resumed);
      };

      /** Applies one event to `who`'s live generation through the store and acts on the machine's answer. A start never
       *  comes here: it is reported, and the lane mints. */
      const apply = (who: string, e: GenEvent): void => {
        const r = row(who);
        const prev = genViewOf(r, live);
        if (e.kind === 'card-read' && prev.state === 'carded') line('card', idOf(who, r.n), e.hashMatches ? 'match' : 'mismatch', 'lane');
        if (e.kind === 'probes' && prev.state === 'probing') line('probes', idOf(who, r.n), e.passed ? 'passed' : 'failed', 'lane');
        const step = mods.machine.generationStep(prev, e);
        if (step.actions.includes('mint-next') || step.actions.includes('end-this')) throw new Error('generation-day: a start reached apply');
        if (!wrote(store.stepGeneration(r.id, genExpectOf(r), step.next, live, wall())).changed && step.next !== prev) {
          throw new Error(`generation-day: a step of ${idOf(who, r.n)} was refused`);
        }
        if (step.next.state !== prev.state) line('gen', idOf(who, r.n), step.next.state, 'lane');
        const n = r.n;
        for (const a of step.actions) {
          if (a === 'renew') hostRenews(who, n);
          else if (a === 'ask-handover') sessionWritesNote(who, n);
          else if (a === 'renudge-card') { cover('renudge'); sessionReadsCard(who, n); }
          else if (a === 'start-probes') sessionProbes(who, n);
          else if (a === 'raise-item') { cover('degraded'); line('item', idOf(who, n), 'raised', 'lane'); }
          else if (a === 'set-hold-off') {
            cover('hold-off');
            const h = row(who);
            wrote(store.setHoldOff(h.id, genExpectOf(h)));
            line('hold-off', idOf(who, n), `until=${softTimesOf(row(who)).holdOffUntilObservedMs}`, 'lane');
          }
        }
        if (prev.state === 'probing' && e.kind === 'probes' && !e.passed && step.next.state === 'probing') cover('probe-retry');
        if (prev.state === 'probing' && step.next.state === 'active') cover('renewed');
      };

      /** A host or session event reaches the server: a start is reported (and kept by the hook while the server is down,
       *  the start-while-down rule); anything else is lost while it is down. Events for an older generation are dropped. */
      const deliver = (who: string, n: number | null, e: GenEvent): void => {
        if (world.isDown()) { if (e.kind === 'started') startQueue.push([who, e]); return; }
        if (frozen()) { frozenQueue.push([who, n, e]); return; }
        if (e.kind === 'started') { reportStart(who, e); return; }
        if (n !== null && row(who).n !== n) return;
        apply(who, e);
      };
      // The host's renewal: it ends the old conversation and starts a fresh one, fails before or after the end, or hangs
      // before or after it, so clearing's deadline is reached on both sides of the first half (review 1912, F9).
      const hostRenews = (who: string, n: number): void => {
        world.envAfter(between(2, 20) * SEC, () => {
          const fails = chance(entropy, 0.08); const hangs = chance(entropy, 0.04);
          if (hangs) return;
          if (fails) { deliver(who, n, { kind: 'host-failed', afterEnd: false }); return; }
          deliver(who, n, { kind: 'host-ended' });
          const failsAfter = chance(entropy, 0.05); const hangsAfter = chance(entropy, 0.04);
          if (hangsAfter) return;
          if (failsAfter) { deliver(who, n, { kind: 'host-failed', afterEnd: true }); return; }
          world.envAfter(between(1, 5) * SEC, () => {
            const f = facts.get(who)!;
            f.ctx = between(12_000, 30_000); f.turns = 0; f.compactions = 0; f.wave = false;
            deliver(who, null, { kind: 'started', resumed: false });
          });
        });
      };
      const sessionWritesNote = (who: string, n: number): void => {
        const late = between(5, 90) * SEC;
        const writes = chance(entropy, 0.7);
        world.envAfter(late, () => { if (writes) deliver(who, n, { kind: 'handover' }); });
      };
      const sessionReadsCard = (who: string, n: number): void => {
        const late = between(2, 60) * SEC;
        const matches = chance(entropy, 0.9);
        world.envAfter(late, () => deliver(who, n, { kind: 'card-read', hashMatches: matches }));
      };
      // A probe round now and then never answers, so probing's own deadline is reached (review 1920, R6).
      const sessionProbes = (who: string, n: number): void => {
        const late = between(10, 60) * SEC;
        const passed = chance(entropy, 0.85);
        const hangs = chance(entropy, 0.05);
        if (hangs) return;
        world.envAfter(late, () => deliver(who, n, { kind: 'probes', passed }));
      };

      // ---- The world's beat: context growth, compactions, idle stretches, the operator, wave boundaries, unplanned
      // starts and server crashes. A fixed order of draws on every beat.
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
          if (f.idleSince === null && goesIdle) f.idleSince = now;
          else if (f.idleSince !== null && wakes) f.idleSince = null;
          if (f.idleSince === null && (role === 'coordinator' || operatorHere)) f.ctx += growth;
          if (role === 'overlord' && operatorHere && operatorWrites) f.turns++;
          if (f.ctx > 160_000 && compacts) { f.ctx = 60_000; f.compactions++; }
          if (role === 'coordinator' && waveEnds) f.wave = true;
          f.readers = readers;
          if (crashes) { cover('unplanned-start'); deliver(who, null, { kind: 'started', resumed: true }); }
        }
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

      // ---- The server's beat: the generations lane's pass (it mints and ends from the reported starts and advances each
      // identity's accumulator), then deadlines, the drain and the deciders, each step through the store.
      const renewalInputs = (who: string, role: FleetRole, stale: boolean, pressed: boolean, loadMove: boolean): RenewalInputs => {
        const f = facts.get(who)!;
        const now = server.clock.wall();
        const no = M(false);
        return { role, contextTokens: stale ? U : M(f.ctx), windowTokens: M(1_000_000), fittedCeilingTokens: M(250_000),
          turns: M(f.turns), compactions: M(f.compactions), idleMs: M(f.idleSince === null ? 0 : now - f.idleSince),
          backstopDue: no, installBehind: no, probeFailedUnfixed: no, modelDrift: no,
          startResumed: M({ resumed: false, otherClass: false }), entryRetired: no, termRaised: no, accountOutsideSet: no,
          classUnservable: no, accountLoadMove: M(loadMove), compactionRefused: no, classChanged: no, evaluationDue: no,
          notLocal: no, waveBoundary: M(f.wave), renewNow: pressed };
      };

      /** The lines the store's rows say about one identity after a pass: a gap and the accumulator, then each generation
       *  the pass ended and minted. G5 counts the mints against the `report` lines, which the host writes. */
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
        for (let k = before.n + 1; k <= after.n; k += 1) {
          line('gen', idOf(who, k - 1), 'ended', 'lane');
          line('gen', idOf(who, k), 'carded', 'mint');
        }
        // The scenario's own monotonic clock, so G4 holds the accumulator to the clock it was read on.
        if (advanced) line('obs', who, `ms=${was.ms};mono=${server.clock.mono()}`, 'lane');
        if (after.n > before.n) sessionReadsCard(who, after.n);
      };

      const serverBeat = (): void => {
        if (frozen()) { server.scheduler.after(BEAT_MS, serverBeat); return; }
        if (thawPending) {
          thawPending = false;
          line('server', 'thaw', 'thawed', 'sim');
          for (const [who, n, e] of frozenQueue.splice(0)) deliver(who, n, e);
        }
        // A crash inside the pass, at its k-th write to the generations or the cursor, more often while a start waits; a
        // busy pass writes about a dozen times (two accumulators, a mint's end, insert and cursor, two due records, the
        // Overlord's mint), so the draw reaches its last writes (review 2003 F8).
        const waiting = (store.generationsCursor(GENERATIONS_LANE) as { lastStartId: number }).lastStartId < reports || overlordStarts.length > 0;
        const crashes = chance(entropy, waiting ? 0.3 : 0.001);
        const at = between(0, 14);
        const downFor = between(1, 10) * MIN;
        if (crashes) arm(at);
        const before = new Map(WHO.map(([who]) => [who, row(who)]));
        // The stand-in registry is listed after this beat's deliveries (it names every conversation reported so far), so its
        // listing postdates every start received yet.
        // The day drives the live walk too (its arm drawn per seed), so it opens the continuity row's gate.
        const passed = wrote(generationsPass({ coord: lane, clock: server.clock, proc, log: () => {}, observe: mods.observed.observeTime, retried, gate: () => null },
          { registry: WHO.map(([who]) => ({ id: who, uuid: uuids.get(who)!, lane: 'lane-a', child: { kind: 'none' as const } })),
            listedAt: wall() + 1, readings: new Map() }));
        // W1's designation, stood in for: the Overlord's starts mint through the same store function, in order.
        while (overlordStarts.length > 0) {
          const id = overlordStarts[0]!;
          const s = (store.startsSince(id - 1, 1) as { rows: { reportedAt: number; source: string }[] }).rows[0]!;
          const held = row('overlord');
          const w = wrote(store.mintGeneration({ identity: 'overlord', sessionId: 'overlord', role: 'overlord', term: 1, rowIncarnation: 'inc',
            startId: id, startReportedAt: s.reportedAt, resumed: s.source === 'resume', model: null, lane: 'lane-a', host: null,
            outcome: genViewOf(held, live).state === 'clearing' ? 'renewed' : 'woken', mono: server.clock.mono(), proc, now: wall() },
          genExpectOf(held), live));
          if (!w.ok && w.kind === 'write-failed') break;
          overlordStarts.shift();
        }
        for (const [who] of WHO) passLines(who, before.get(who)!, passed.gaps);
        // G5 and G8 read the live generations after a pass that ran to its end; a pass an abort cut short is judged by the
        // next. The edge is covered only when an abort landed (review 2003 F8), not when one was drawn.
        if (!fault.fired) line('pass', 'server', WHO.map(([who]) => `${who}=${row(who).startId}`).join(';'), 'lane');
        if (crashes) {
          if (fault.fired) cover('crash-mid-pass');
          line('server', 'crash', 'down', 'sim');
          world.crash(downFor);
          return;
        }
        if (operatorPending) { operatorPending = false; lastOperatorObs = obsOf('overlord'); }
        for (const [who, role] of WHO) {
          const stale = chance(entropy, 0.05);
          const pressed = chance(entropy, 0.0003);
          const loadMove = chance(entropy, 0.0003);
          const held = chance(entropy, 0.2);
          let r = row(who);
          let v = genViewOf(r, live);
          let deadline = effectiveGeneration(r, live).deadlineAt;
          if (v.state === 'carded' && !v.renudged && deadline !== null && wall() >= deadline - RENEWAL_LANE_PERIOD_MS) {
            apply(who, { kind: 'nudge-due' });
            r = row(who); v = genViewOf(r, live); deadline = effectiveGeneration(r, live).deadlineAt;
          }
          if (TRANSIENT.has(v.state) && deadline !== null && wall() >= deadline) {
            line('deadline', `${idOf(who, r.n)}:${v.state}:${deadline}`, 'fired', 'lane');
            if (v.state === 'clearing') cover(v.hostEnded ? 'clearing-timeout-degraded' : 'clearing-timeout-back');
            if (v.state === 'probing') cover('probing-timeout');
            apply(who, { kind: 'deadline' });
            r = row(who); v = genViewOf(r, live);
          }
          if (v.state === 'draining' && facts.get(who)!.readers === 0) { apply(who, { kind: 'drained' }); r = row(who); v = genViewOf(r, live); }
          if (v.state !== 'active' && v.state !== 'degraded') continue;
          const due = mods.renewal.renewalDue(renewalInputs(who, role, stale, pressed, loadMove));
          if (!due.due) { dueSinceObs.set(who, null); continue; }
          if (due.cls === 'hard') { cover('hard-renewal'); dueSinceObs.set(who, null); apply(who, { kind: 'due', cls: 'hard' }); continue; }
          // A soft due reaches the machine in degraded too, which ignores it ("degraded blocks soft triggers only").
          const obs = r.observed.ms;
          const since = dueSinceObs.get(who) ?? obs;
          dueSinceObs.set(who, since);
          const stamps = softStamps.get(who) ?? [];
          const inWindow = stamps.filter((t) => obs - t < SOFT_BUDGET.windowMs).length;
          const times = softTimesOf(r);
          const si: SoftInputs = { role, hibernateHold: held ? { held: true, reason: 'background' } : { held: false },
            // I7: a coordinator's reader wait is the hold table's in W1a, and it has no Overlord place; the Overlord's
            // place report is W1's, so unmeasured here.
            readersRunning: role === 'coordinator' ? NA : M(facts.get(who)!.readers),
            operatorQuietObservedMs: M(obs - lastOperatorObs),
            placeHiddenObservedMs: role === 'overlord' ? U : NA, mode: 'when-away', dueSinceObservedMs: obs - since,
            generationAgeObservedMs: times.generationAgeObservedMs, holdOffUntilObservedMs: times.holdOffUntilObservedMs,
            softRenewalsInWindow: inWindow, overlordOutsideActive: genViewOf(row('overlord'), live).state !== 'active' };
          const may = mods.soft.softRenewalMay(si);
          if (!may.start) {
            if (may.waitFor === 'budget') cover('budget-wait');
            if (may.waitFor === 'overlord-first') cover('overlord-first');
            continue;
          }
          const was = v.state; const stamp = `obs=${obs};age=${times.generationAgeObservedMs};n=${r.n};from=${was}`;
          apply(who, { kind: 'due', cls: 'soft' });
          if (was === 'degraded') cover('soft-due-in-degraded');
          if (genViewOf(row(who), live).state === was) continue;
          cover('soft-renewal');
          line('soft-renewal', who, stamp, 'lane');
          softStamps.set(who, [...stamps, obs]);
          dueSinceObs.set(who, null);
        }
        server.scheduler.after(BEAT_MS, serverBeat);
      };

      world.onBoot(() => {
        proc = `p${boots++}`;
        retried = new Set<number>();
        arm(DISARMED);
        // A crash right after a thaw loses what waited in the socket, except a start (the start-while-down rule).
        for (const [who, , e] of frozenQueue.splice(0)) if (e.kind === 'started') startQueue.push([who, e]);
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
  { name: 'G2', says: 'at most three soft renewals in any six hours of observed time, per identity',
    check(lines) {
      const by = new Map<string, Array<[number, SequenceLine]>>();
      for (const l of lines) if (l.kind === 'soft-renewal') {
        const xs = by.get(l.id) ?? []; xs.push([num(l.state, 'obs'), l]); by.set(l.id, xs);
        const within = xs.filter(([t]) => xs.at(-1)![0] - t < SOFT_BUDGET.windowMs);
        if (within.length > SOFT_BUDGET.count) return violation('G2', l, `${l.id}: ${within.length} soft renewals in six observed hours`);
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
];
