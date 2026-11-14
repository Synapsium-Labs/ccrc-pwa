// A timer day (Overlord W1a, the timers piece, Task 8; spec §3.3.12, I17, §11.7): two setters (a run worker and a
// coordinator) set, cancel and wait on timers through a seeded day of renewals (the stamp unchanged), purges of a
// setter's row (the stamp gone, then a new row with a new stamp, which may set its first timer while its row is still being
// made), listings that name a row they could not build (its `.generation` absent or already its own stamp: review 2053 F1),
// a listing that was not read, timers set after a tick's listing began, `mail-disabled` windows, and server crashes
// between passes and inside one, at any of its writes. The server side is the real lane pass (`timersPass`, its listing
// from `timerListingOf`) over a real `coord.db`; the world is the fleet.
//
// The pass is synchronous, so the scenario builds its facts the way `gatherTimerFacts` does (the pending read, then each
// setter's stamp through `setterIncarnationOf`) without an await, and the simulator's async limit does not apply. A crash
// inside a pass is a write that aborts (and every write after it), counted outside the aborting transaction; a pass that
// throws records a `threw` line, and a throw no fault armed is a violation (T5). Each fire line carries what the lane
// read (`read`, `bornAfter`, `listing`), so a fire on anything but a measured match is red (T2), whatever the stamps
// say (review 2053 F4). The predicates read only the sequence's lines.
import { DatabaseSync } from 'node:sqlite';
import { TIMER_LANE_PERIOD_MS, TIMER_MAIL_SENDER } from '../../../shared/continuity-timers.js';
import { MIGRATIONS } from '../../src/coord/schema.js';
import { CoordStore } from '../../src/coord/store.js';
import { setterIncarnationOf, timerListingOf, timersPass, type IncarnationRead } from '../../src/continuity/timerLane.js';
import type { Scenario } from './run.js';
import type { Invariant, SequenceLine, Violation } from './sequence.js';
import { chance } from './world.js';

export const TIMER_DAY_EDGES = ['fired', 'fired-late', 'renewed-fired', 'setter-gone', 'unbuilt-wait', 'born-after-wait',
  'run-closed', 'setter-cancel', 'mail-held', 'crash-gap', 'crash-mid-pass', 'unreadable-wait', 'unbuilt-matching-wait',
  'listing-unread-wait', 'being-made-wait'] as const;
export type TimerDayEdge = (typeof TIMER_DAY_EDGES)[number];

const START = Date.parse('2026-11-14T00:00:00Z');
const DAY_MS = 24 * 3_600_000;
const MIN = 60_000;
const BEAT_MS = TIMER_LANE_PERIOD_MS;
const WORKER = 'lane-a-project-a';
const COORD = 'lane-b-project-a';
const SETTERS: readonly string[] = [WORKER, COORD];

const DISARMED = 1_000_000_000;
const fault = { left: DISARMED, fired: false };
let simDb: DatabaseSync | null = null;
/** ONE database for every seed, migrated once; each setup empties what the day writes (`generationDay.ts`'s reason). */
function dayDb(): DatabaseSync {
  if (simDb === null) {
    simDb = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) simDb.exec(m);
    simDb.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    simDb.function('sim_tick', () => { fault.left -= 1; if (fault.left < 0) fault.fired = true; return fault.left; });
    simDb.exec([['INSERT', 'mail'], ['UPDATE', 'continuity_timers'], ['DELETE', 'continuity_timers']].map(([op, t]) => `CREATE TRIGGER
      sim_fault_${op}_${t} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT, 'sim crash') WHERE sim_tick() < 0; END;`).join('\n'));
  }
  fault.left = DISARMED; fault.fired = false;
  simDb.exec(`DELETE FROM continuity_timers; DELETE FROM mail_deliveries; DELETE FROM mail; DELETE FROM runs; DELETE FROM programs;`);
  return simDb;
}

/** One setter's registry row as the fleet holds it. */
interface Row { stamp: string | null; bornAt: number; unbuilt: boolean; unreadable: boolean }

export function timerDay(): Scenario<TimerDayEdge> {
  return {
    name: 'timer-day', startWallMs: START, durationMs: DAY_MS, edges: TIMER_DAY_EDGES,
    setup({ world, seq, cover, entropy }) {
      const line = (kind: string, id: string, state: string, actor: string): void => { seq.append({ kind, id, state, actor }); };
      const server = world.server;
      const wall = (): number => server.clock.wall();
      const between = (lo: number, hi: number): number => lo + entropy.below(hi - lo + 1);
      const db = dayDb();
      const store = new CoordStore(db);
      db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 0, 'active')");
      const runId = Number(db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, sessionId, openedAt) "
        + "VALUES ('prog-a', 1, 3, 'project-a', 'working', ?, ?, 0)").run(COORD, WORKER).lastInsertRowid);
      let gens = 0;
      const rows = new Map<string, Row>(SETTERS.map((id) => [id, { stamp: stampOf(++gens), bornAt: 0, unbuilt: false, unreadable: false }]));
      let mailDisabled = false;
      let runClosed = false;
      let wasHeld = false;
      const renewed = new Set<number>();
      const stampOfTimer = new Map<number, string>();

      // ---- WORLD: the setters, their rows, the operator's switch. Their timers survive a crash. One beat a minute, its
      // draws in a fixed order whether or not each is used.
      const beat = (): void => {
        for (const id of SETTERS) {
          const r = rows.get(id)!;
          const set = chance(entropy, 0.08); const due = between(5 * MIN, 3 * 60 * MIN);
          const cancel = chance(entropy, 0.02); const renew = chance(entropy, 0.02); const purge = chance(entropy, 0.004);
          const unbuilt = chance(entropy, 0.05); const unreadable = chance(entropy, 0.03);
          const reborn = chance(entropy, 0.05); const making = chance(entropy, 0.5);
          r.unbuilt = unbuilt; r.unreadable = unreadable;
          const born = r.stamp === null;
          if (born) {
            if (!reborn) continue;
            // A new row, which may set its first timer at once while the fleet is still making it (no `.generation` read yet).
            r.stamp = stampOf(++gens); r.bornAt = wall(); r.unbuilt = making; line('row', id, `born;stamp=${r.stamp}`, 'fleet');
          }
          const stamp = r.stamp!;
          if (set || born) {
            const runBound = id === WORKER && !runClosed;
            const t = store.insertTimer({ setter: id, setterIncarnation: stamp, setById: id, setByUuid: 'u', role: 'worker', note: 'n',
              runId: runBound ? runId : null, programme: id === COORD ? 'prog-a' : null, setAt: wall(), dueAt: wall() + due });
            if (t.ok) { stampOfTimer.set(t.id, stamp); line('set', `t${t.id}`, `setter=${id};stamp=${stamp}`, 'door'); }
          }
          if (cancel) {
            const p = store.pendingTimersOf(id);
            const victim = p.ok ? p.rows[0] : undefined;
            if (victim !== undefined && store.cancelTimer(victim.id, 'setter-cancel', 'setter', wall()).changed) {
              cover('setter-cancel'); line('cancel', `t${victim.id}`, 'setter', 'door');
            }
          }
          if (renew) {
            const p = store.pendingTimersOf(id);
            for (const t of p.ok ? p.rows : []) renewed.add(t.id);
            line('row', id, `renewed;stamp=${r.stamp}`, 'fleet');
          }
          if (purge) { r.stamp = null; line('row', id, 'purged', 'fleet'); }
        }
        const flip = chance(entropy, 0.01);
        if (flip) { mailDisabled = !mailDisabled; line('switch', 'mail-disabled', mailDisabled ? 'set' : 'clear', 'operator'); }
        const close = chance(entropy, 0.002);
        if (close && !runClosed) { runClosed = true; db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(runId); line('run', `r${runId}`, 'done', 'coordinator'); }
        const crash = chance(entropy, 0.003); const down = between(MIN, 40 * MIN);
        if (crash && !world.isDown()) { cover('crash-gap'); line('server', 'crash', 'down', 'sim'); world.crash(down); }
        world.envAfter(BEAT_MS, beat);
      };
      world.envAfter(BEAT_MS / 2, beat);

      // ---- SERVER: the lane, once a minute from each boot. A crash cancels its timer; a boot re-arms it.
      const pass = (): void => {
        const lag = between(0, 45_000); const armFault = chance(entropy, 0.02); const writes = between(0, 6);
        const unread = chance(entropy, 0.02); const unbuiltReads = chance(entropy, 0.5);
        const listedAt = wall() - lag;
        const named = SETTERS.filter((id) => { const r = rows.get(id)!; return r.stamp !== null && r.bornAt < listedAt; });
        // The tick's built records: a named row the fleet is still making is listed but not built (F1).
        const records = named.filter((id) => !rows.get(id)!.unbuilt).map((id) => ({ id, archivedAt: null }));
        const listing = timerListingOf(records, unread ? null : new Set(named), listedAt, mailDisabled ? ['mail-disabled'] : []);
        const reads = new Map<string, IncarnationRead>();
        for (const id of SETTERS) {
          const r = rows.get(id)!;
          // An unbuilt row's `.generation` is absent, or already written with its own stamp (F1's matching case).
          reads.set(id, r.stamp === null || (r.unbuilt && !unbuiltReads) ? { kind: 'unmeasured', reason: 'absent' }
            : r.unreadable ? { kind: 'unmeasured', reason: 'unreadable' } : { kind: 'measured', incarnation: r.stamp });
        }
        const readOf = (id: string): string => { const x = reads.get(id)!; return x.kind === 'measured' ? x.incarnation : x.reason; };
        const listingOf = (id: string): string => listing.listedIds === null || listing.unmeasuredIds.has(id) ? 'unmeasured'
          : listing.listedIds.has(id) ? 'listed' : 'unlisted';
        if (armFault) { fault.left = writes; fault.fired = false; }
        const pending = store.pendingTimers();
        const incarnations = new Map(SETTERS.map((id) => [id, setterIncarnationOf(reads.get(id)!)]));
        const before = new Map((pending.ok ? pending.rows : []).map((t) => [t.id, t]));
        let threw = false;
        // The store's mail insert stamps `at` from the ambient clock (`insertMail`), which the lane does not own and the
        // simulator stubs to a thrower: the pass is lent the server's wall clock, and only for its own length.
        const ambient = Date.now;
        Date.now = wall;
        try {
          const r = timersPass({ coord: store, now: wall(), log: () => {} }, listing, { pending, incarnations });
          for (const t of before.values()) {
            const reason = r.cancelled.find((c) => c.id === t.id)?.reason;
            if (reason !== undefined) {
              const row = rows.get(t.setter)!;
              line('cancel', `t${t.id}`, `${reason};listed=${listingOf(t.setter)};now=${row.stamp ?? 'absent'};stamp=${t.setterIncarnation}`, 'lane');
              if (reason === 'setter-gone') cover('setter-gone');
              if (reason === 'run-closed') cover('run-closed');
            }
          }
          if (r.waited > 0) {
            for (const t of before.values()) {
              const row = rows.get(t.setter)!;
              if (t.setAt >= listedAt) cover(row.unbuilt && reads.get(t.setter)!.kind !== 'measured' ? 'being-made-wait' : 'born-after-wait');
              else if (listing.listedIds === null) cover('listing-unread-wait');
              else if (row.unbuilt && listing.unmeasuredIds.has(t.setter)) cover(readOf(t.setter) === t.setterIncarnation ? 'unbuilt-matching-wait' : 'unbuilt-wait');
              else if (row.unreadable && row.stamp !== null) cover('unreadable-wait');
            }
          }
          if (mailDisabled && [...before.values()].some((t) => t.dueAt <= wall())) { cover('mail-held'); wasHeld = true; }
          for (const f of r.fired) {
            for (const id of f.ids) {
              const t = before.get(id)!;
              const mails = db.prepare('SELECT toId FROM mail WHERE fromId = ? AND body LIKE ?').all(TIMER_MAIL_SENDER, `%Timer ${id}: %`) as { toId: string }[];
              line('fire', `t${id}`, `mails=${mails.length};to=${mails.map((m) => m.toId).join(',')};setter=${t.setter};`
                + `stamp=${stampOfTimer.get(id)};now=${rows.get(t.setter)!.stamp ?? 'absent'};read=${readOf(t.setter)};`
                + `bornAfter=${t.setAt >= listedAt};listing=${listingOf(t.setter)}`, 'lane');
              cover('fired');
              if (renewed.has(id)) cover('renewed-fired');
              if (wasHeld && wall() - t.dueAt > BEAT_MS) cover('fired-late');
            }
          }
        } catch (err) {
          threw = true;
          line('server', 'threw', `armed=${armFault && fault.fired};${err instanceof Error ? err.message : String(err)}`, 'lane');
        } finally { Date.now = ambient; }
        if (armFault && (fault.fired || threw)) {
          cover('crash-mid-pass'); line('server', 'crash', 'mid-pass', 'sim');
          fault.left = DISARMED;
          if (!world.isDown()) world.crash(between(MIN, 10 * MIN));
          return;
        }
        fault.left = DISARMED;
        server.scheduler.after(BEAT_MS, pass);
      };
      world.onBoot(() => { line('server', 'boot', 'up', 'sim'); server.scheduler.after(BEAT_MS, pass); });
    },
  };
}

const stampOf = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

const field = (state: string, key: string): string | undefined =>
  state.split(';').find((p) => p.startsWith(`${key}=`))?.slice(key.length + 1);
const violation = (invariant: string, l: SequenceLine, message: string): Violation => ({ invariant, seq: l.seq, message });

export const TIMER_DAY_INVARIANTS: readonly Invariant[] = [
  { name: 'T1', says: 'every fired timer has exactly one mail naming it, to its setter', check(lines) {
    for (const l of lines) {
      if (l.kind !== 'fire') continue;
      if (field(l.state, 'mails') !== '1' || field(l.state, 'to') !== field(l.state, 'setter')) return violation('T1', l, `${l.id}: ${l.state}`);
    }
    return null;
  } },
  { name: 'T2', says: 'a timer fires only on a measured read of its own stamp, a row the listing named and built, set before the listing began', check(lines) {
    for (const l of lines) {
      if (l.kind !== 'fire') continue;
      const stamp = field(l.state, 'stamp');
      if (stamp !== field(l.state, 'now') || stamp !== field(l.state, 'read') || field(l.state, 'bornAfter') !== 'false'
        || field(l.state, 'listing') !== 'listed') return violation('T2', l, `${l.id}: ${l.state}`);
    }
    return null;
  } },
  { name: 'T3', says: 'no timer is fired twice', check(lines) {
    const seen = new Set<string>();
    for (const l of lines) {
      if (l.kind !== 'fire') continue;
      if (seen.has(l.id)) return violation('T3', l, `${l.id} fired again`);
      seen.add(l.id);
    }
    return null;
  } },
  { name: 'T4', says: 'no live setter\'s timer (its row still carries the timer\'s stamp) was cancelled setter-gone, listed or not', check(lines) {
    for (const l of lines) {
      if (l.kind !== 'cancel' || !l.state.startsWith('setter-gone')) continue;
      if (field(l.state, 'now') === field(l.state, 'stamp')) return violation('T4', l, `${l.id}: ${l.state}`);
    }
    return null;
  } },
  { name: 'T5', says: 'a pass throws only when a fault was armed and fired inside it', check(lines) {
    for (const l of lines) {
      if (l.kind === 'server' && l.id === 'threw' && field(l.state, 'armed') !== 'true') return violation('T5', l, `a pass threw unarmed: ${l.state}`);
    }
    return null;
  } },
];
