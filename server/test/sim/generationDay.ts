// A generation day (Overlord W1a, renewal deciders Task 6; spec §3.3.11, §11.5, §11.7): an Overlord and a coordinator
// for a seeded day of context growth, compactions, operator presence and absence, idle stretches, host failures,
// unplanned starts, and server crashes with gaps. The server side is driven ONLY through the four deciders
// (`renewalDue`, `softRenewalMay`, `generationStep`, `observeTime`) and an in-memory generation row per identity; the
// deciders' modules are a parameter, so a mutated copy can be handed to the same scenario.
//
// Durable state (the rows, the observed-time stamp, the soft renewals' stamps) survives a crash; the server's timers do
// not. The world (the sessions, their hosts, the operator) keeps its own timers, which survive. The predicates read
// only the sequence's lines: generation rows and the fake clock, never sweep phases (the simulator's beat and its async
// limit, carried from W1a's simulator piece).
import type { FleetRole } from '../../../shared/fleetRoles.js';
import { HOLD_OFF_MS, LEAST_AGE_MS, SOFT_BUDGET, STATE_DEADLINE_S } from '../../../shared/continuity.js';
import type { GenEvent, GenView } from '../../src/continuity/generationMachine.js';
import type { Reading, RenewalInputs } from '../../src/continuity/renewalDue.js';
import type { SoftInputs } from '../../src/continuity/softRenewal.js';
import type { Observed } from '../../src/time/observed.js';
import type { Scenario } from './run.js';
import type { Invariant, SequenceLine, Violation } from './sequence.js';
import { chance } from './world.js';

/** The four deciders, passed in so that a mutant can be handed to the same scenario. */
export interface GenDayModules {
  readonly renewal: Pick<typeof import('../../src/continuity/renewalDue.js'), 'renewalDue'>;
  readonly soft: Pick<typeof import('../../src/continuity/softRenewal.js'), 'softRenewalMay'>;
  readonly machine: Pick<typeof import('../../src/continuity/generationMachine.js'), 'generationStep' | 'GEN_ACTIVE' | 'GEN_MINTED'>;
  readonly observed: Pick<typeof import('../../src/time/observed.js'), 'observeTime'>;
}

export const GEN_DAY_EDGES = ['soft-renewal', 'hard-renewal', 'renewed', 'crash-gap', 'start-while-down', 'degraded',
  'hold-off', 'budget-wait', 'probe-retry', 'renudge', 'unplanned-start', 'overlord-first'] as const;
export type GenDayEdge = (typeof GEN_DAY_EDGES)[number];

const START = Date.parse('2026-11-13T00:00:00Z');
const DAY_MS = 24 * 3_600_000;
const BEAT_MS = 30_000;
const SEC = 1_000;
const MIN = 60_000;
const COORD = 'lane-a-coordinator';
const WHO: ReadonlyArray<readonly [string, FleetRole]> = [['overlord', 'overlord'], [COORD, 'coordinator']];
const TRANSIENT = new Set(['draining', 'checkpointed', 'clearing', 'carded', 'probing']);

const M = <T>(value: T): Reading<T> => ({ kind: 'measured', value });
const U: Reading<never> = { kind: 'unmeasured', why: 'stale' };
const NA = { kind: 'not-applicable' } as const;

interface Row {
  n: number; view: GenView; mintedObs: number; deadlineAt: number;
  holdOffUntil: number | null; dueSinceObs: number | null; softStamps: number[];
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

      // ---- DURABLE: the server's rows and its observed-time column, which survive a crash.
      const rows = new Map<string, Row>();
      for (const [who] of WHO) rows.set(who, { n: 1, view: mods.machine.GEN_ACTIVE, mintedObs: 0, deadlineAt: 0, holdOffUntil: null, dueSinceObs: null, softStamps: [] });
      let obs: Observed | null = null;
      let boots = 0;
      let proc = 'p0';
      const startQueue: Array<[string, GenEvent]> = [];

      // ---- WORLD: the sessions, their hosts and the operator. Their timers survive a crash.
      const facts = new Map<string, Facts>();
      for (const [who] of WHO) facts.set(who, { ctx: 20_000, turns: 0, compactions: 0, idleSince: null, wave: false, readers: 0 });
      let operatorHere = true;
      let lastOperatorAt = START;
      let operatorFlipAt = START + 40 * MIN;

      const idOf = (who: string, n: number): string => `${who}#${n}`;
      const age = (r: Row): number => (obs?.ms ?? 0) - r.mintedObs;

      /** Applies one event to `who`'s current generation and acts on the machine's answer. */
      const apply = (who: string, e: GenEvent): void => {
        const r = rows.get(who)!;
        const prev = r.view;
        // What the server received, logged at receipt (review I4): a card read with its hash verdict, a probe round.
        if (e.kind === 'card-read') line('card', idOf(who, r.n), e.hashMatches ? 'match' : 'mismatch', 'lane');
        if (e.kind === 'probes') line('probes', idOf(who, r.n), e.passed ? 'passed' : 'failed', 'lane');
        const step = mods.machine.generationStep(prev, e);
        if (e.kind === 'started' && prev.state !== 'ended') line('start', who, 'applied', 'host');
        r.view = step.next;
        const changed = step.next.state !== prev.state;
        if (changed) line('gen', idOf(who, r.n), step.next.state, 'lane');
        if (changed || step.actions.includes('renudge-card')) {
          const s = STATE_DEADLINE_S[step.next.state as keyof typeof STATE_DEADLINE_S];
          r.deadlineAt = s === undefined ? 0 : server.clock.wall() + s * SEC;
        }
        const n = r.n;
        for (const a of step.actions) {
          if (a === 'renew') hostRenews(who, n);
          else if (a === 'ask-handover') sessionWritesNote(who, n);
          else if (a === 'renudge-card') { cover('renudge'); sessionReadsCard(who, n); }
          else if (a === 'start-probes') sessionProbes(who, n);
          else if (a === 'raise-item') { cover('degraded'); line('item', idOf(who, n), 'raised', 'lane'); }
          else if (a === 'set-hold-off') { cover('hold-off'); r.holdOffUntil = age(r) + HOLD_OFF_MS; }
        }
        if (prev.state === 'probing' && e.kind === 'probes' && !e.passed && step.next.state === 'probing') cover('probe-retry');
        if (prev.state === 'probing' && step.next.state === 'active') cover('renewed');
        if (step.actions.includes('mint-next')) {
          const next: Row = { n: r.n + 1, view: mods.machine.GEN_MINTED, mintedObs: obs?.ms ?? 0,
            deadlineAt: server.clock.wall() + STATE_DEADLINE_S.carded * SEC, holdOffUntil: null, dueSinceObs: null, softStamps: r.softStamps };
          rows.set(who, next);
          line('gen', idOf(who, next.n), 'carded', 'mint');
          sessionReadsCard(who, next.n);
        }
      };

      /** A host or session event reaches the server: a start report is queued while the server is down and sent at
       *  boot (the start-while-down rule); anything else is lost while it is down. Events for an older generation are
       *  dropped, except a start, which ends whatever generation is current. */
      const deliver = (who: string, n: number | null, e: GenEvent): void => {
        if (world.isDown()) { if (e.kind === 'started') startQueue.push([who, e]); return; }
        if (n !== null && rows.get(who)!.n !== n) return;
        apply(who, e);
      };

      // The host's renewal: it ends the old conversation and starts a fresh one, or fails before or after the end.
      const hostRenews = (who: string, n: number): void => {
        world.envAfter(between(2, 20) * SEC, () => {
          if (chance(entropy, 0.08)) { deliver(who, n, { kind: 'host-failed', afterEnd: false }); return; }
          deliver(who, n, { kind: 'host-ended' });
          if (chance(entropy, 0.05)) { deliver(who, n, { kind: 'host-failed', afterEnd: true }); return; }
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
      const sessionProbes = (who: string, n: number): void => {
        const late = between(10, 60) * SEC;
        const passed = chance(entropy, 0.85);
        world.envAfter(late, () => deliver(who, n, { kind: 'probes', passed }));
      };

      // ---- The world's beat: context growth, compactions, idle stretches, the operator, wave boundaries, unplanned
      // starts and server crashes. A fixed order of draws on every beat.
      const worldBeat = (): void => {
        const now = server.clock.wall();
        if (now >= operatorFlipAt) { operatorHere = !operatorHere; operatorFlipAt = now + between(10, operatorHere ? 90 : 120) * MIN; }
        const operatorWrites = chance(entropy, 0.3);
        if (operatorHere && operatorWrites) lastOperatorAt = now;
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
        if (serverCrash && !world.isDown()) {
          cover('crash-gap');
          line('server', 'crash', 'down', 'sim');
          world.crash(downFor);
        }
        world.envAfter(BEAT_MS, worldBeat);
      };
      world.envAfter(BEAT_MS / 2, worldBeat);

      // ---- The server's beat: observed time, deadlines, the drain, and the deciders.
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

      const serverBeat = (): void => {
        obs = mods.observed.observeTime(obs, server.clock.mono(), proc);
        line('obs', 'server', `ms=${obs.ms}`, 'lane');
        for (const [who, role] of WHO) {
          const stale = chance(entropy, 0.05);
          const pressed = chance(entropy, 0.0003);
          const loadMove = chance(entropy, 0.0003);
          const held = chance(entropy, 0.2);
          const r = rows.get(who)!;
          if (TRANSIENT.has(r.view.state) && server.clock.wall() >= r.deadlineAt) {
            line('deadline', `${idOf(who, r.n)}:${r.view.state}:${r.deadlineAt}`, 'fired', 'lane');
            apply(who, { kind: 'deadline' });
          }
          if (r.view.state === 'draining' && facts.get(who)!.readers === 0) apply(who, { kind: 'drained' });
          if (r.view.state !== 'active' && r.view.state !== 'degraded') continue;
          const due = mods.renewal.renewalDue(renewalInputs(who, role, stale, pressed, loadMove));
          if (!due.due) { r.dueSinceObs = null; continue; }
          if (due.cls === 'hard') { cover('hard-renewal'); r.dueSinceObs = null; apply(who, { kind: 'due', cls: 'hard' }); continue; }
          if (r.view.state !== 'active') continue;
          r.dueSinceObs ??= obs.ms;
          const inWindow = r.softStamps.filter((t) => obs!.ms - t < SOFT_BUDGET.windowMs).length;
          const overlord = rows.get('overlord')!;
          const si: SoftInputs = { role, hibernateHold: held ? { held: true, reason: 'background' } : { held: false },
            // I7: a coordinator's reader wait is the hold table's in W1a, and it has no Overlord place; the Overlord's
            // place report is W1's, so unmeasured here.
            readersRunning: role === 'coordinator' ? NA : M(facts.get(who)!.readers),
            operatorQuietObservedMs: M(server.clock.wall() - lastOperatorAt),
            placeHiddenObservedMs: role === 'overlord' ? U : NA, mode: 'when-away', dueSinceObservedMs: obs.ms - r.dueSinceObs,
            generationAgeObservedMs: age(r), holdOffUntilObservedMs: r.holdOffUntil, softRenewalsInWindow: inWindow,
            overlordOutsideActive: overlord.view.state !== 'active' };
          const may = mods.soft.softRenewalMay(si);
          if (!may.start) {
            if (may.waitFor === 'budget') cover('budget-wait');
            if (may.waitFor === 'overlord-first') cover('overlord-first');
            continue;
          }
          cover('soft-renewal');
          line('soft-renewal', who, `obs=${obs.ms};age=${age(r)}`, 'lane');
          r.softStamps = [...r.softStamps, obs.ms];
          r.dueSinceObs = null;
          apply(who, { kind: 'due', cls: 'soft' });
        }
        server.scheduler.after(BEAT_MS, serverBeat);
      };

      world.onBoot(() => {
        proc = `p${boots++}`;
        if (boots > 1) {
          line('server', 'boot', 'up', 'sim');
          for (const [who, e] of startQueue.splice(0)) { cover('start-while-down'); apply(who, e); }
        }
        server.scheduler.after(BEAT_MS, serverBeat);
      });
    },
  };
}

// ---- The invariants: predicates over the lines alone.
const violation = (invariant: string, l: SequenceLine, message: string): Violation => ({ invariant, seq: l.seq, message });
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
  { name: 'G4', says: 'a server gap neither advances observed time nor fires a deadline twice',
    check(lines) {
      let last: number | null = null; let lastBeforeCrash: number | null = null; let afterBoot = false;
      const fired = new Set<string>();
      for (const l of lines) {
        if (l.kind === 'server' && l.state === 'down') lastBeforeCrash = last;
        if (l.kind === 'server' && l.state === 'up') afterBoot = true;
        if (l.kind === 'obs') {
          const ms = num(l.state, 'ms');
          if (last !== null && ms < last) return violation('G4', l, `observed time fell from ${last} to ${ms}`);
          if (afterBoot && lastBeforeCrash !== null && ms !== lastBeforeCrash) {
            return violation('G4', l, `observed time moved across a gap: ${lastBeforeCrash} before the crash, ${ms} after the boot`);
          }
          afterBoot = false; last = ms;
        }
        if (l.kind === 'deadline') {
          if (fired.has(l.id)) return violation('G4', l, `deadline ${l.id} fired twice`);
          fired.add(l.id);
        }
      }
      return null;
    } },
  { name: 'G5', says: 'every start mints exactly one generation',
    check(lines) {
      const starts = new Map<string, number>(); const mints = new Map<string, number>();
      for (const l of lines) {
        if (l.kind === 'start') starts.set(l.id, (starts.get(l.id) ?? 0) + 1);
        if (l.kind === 'gen' && l.actor === 'mint') {
          const who = l.id.slice(0, l.id.lastIndexOf('#'));
          mints.set(who, (mints.get(who) ?? 0) + 1);
          if ((mints.get(who) ?? 0) !== (starts.get(who) ?? 0)) return violation('G5', l, `${who}: a mint with no start`);
          if (Number(l.id.slice(l.id.lastIndexOf('#') + 1)) !== mints.get(who)! + 1) return violation('G5', l, `${l.id}: not the next number`);
        }
        if (l.kind === 'sim' && l.state === 'end') {
          for (const [who, n] of starts) if ((mints.get(who) ?? 0) !== n) return violation('G5', l, `${who}: ${n} starts, ${mints.get(who) ?? 0} mints`);
        }
      }
      return null;
    } },
];
