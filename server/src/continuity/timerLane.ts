// L4 delivery, context C3 (Session Conversation): the timers lane (Overlord spec §3.3.12, C62 to C65, I17; Table 11.1c's
// `timers` row; W1a, the timers piece, plan `w1a-timers.md` Task 8). Its rules are decided elsewhere: `timerCleanupVerdict`
// decides what a pending timer's facts mean (cancel with a reason, keep, or wait), and `packTimerMail` which due timers go
// out in which mail. This file gathers the facts, calls them and acts.
//
// ONE PASS, IN THIS ORDER:
//  1. Gather (`gatherTimerFacts`, async): every pending timer, and each distinct setter's incarnation read once
//     (`incarnationOf`, twice-read), before anything is decided. A stamp that changes after the read is caught next pass.
//  2. Clean up (always, `mail-disabled` or not): one `cancelTimer(…, 'cleanup', reason, now)` per `cancel` verdict.
//  3. Fire (held while `mail-disabled` stands): the timers that answered `keep` and are due, packed by `packTimerMail`, each
//     mail in ONE transaction with the move of the timers it carries (`insertSystemMailTx`, then `markTimersFired`, which
//     throws if any of them moved). A throw rolls back that mail and its timers alone; the next mail's transaction runs.
//  4. Purge once: fired and cancelled rows older than `TIMER_KEEP_MS`.
//
// A TIMER NEVER ACTS (I17). The lane's only effects are its rows' moves and its mail, from the role `timer`, never
// `operator`. It starts no session and queues no wake of its own; the mail wakes a sleeping setter as any mail does. A
// fact it cannot measure (a bound run or programme it cannot read, the listing, the stamp, a row the listing named but
// left unbuilt, a timer set at or after the tick's listing began) neither fires nor cancels that pass.
import { TIMER_KEEP_MS, TIMER_MAIL_SENDER, type TimerCancelReason } from '../../../shared/continuity-timers.js';
import type { WatcherCoordPort } from '../coord/ports.js';
import type { RunRow } from '../coord/store.js';
import { tx } from '../coord/tx.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { incarnationOf } from '../coord/delegationLeaseDoor.js';
import type { FleetIO } from '../io.js';
import type { Clock } from '../time/ports.js';
import type { TimerRow, TimersRead } from './continuityStore.js';
import { packTimerMail, timerCleanupVerdict, type CleanupFacts, type DueTimer } from './timers.js';

/** What `incarnationOf` answers. */
export type IncarnationRead = Awaited<ReturnType<typeof incarnationOf>>;
export type SetterIncarnation = CleanupFacts['incarnation'];

/** The one place a reason of `incarnationOf` is compared (slug incarnation-reason-is-a-string): `absent` alone is the
 *  absence that can cancel (`setter-gone`, when the listing did not name the row); every other reason is unmeasured. */
export function setterIncarnationOf(r: IncarnationRead): SetterIncarnation {
  if (r.kind === 'measured') return { kind: 'measured', v: r.incarnation };
  return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unmeasured' };
}

/** The tick's own registry facts, passed in rather than read mid-pass: when its listing began (`listedAt`, D-6436), every id
 *  it named (`listedIds`, built or not; null when it was not read), the ids whose row carries an archive stamp, and whether
 *  the `mail-disabled` marker stood in it. */
export interface TimerListing {
  readonly listedAt: number | null;
  readonly listedIds: ReadonlySet<string> | null;
  readonly archivedIds: ReadonlySet<string>;
  readonly mailDisabled: boolean;
}

/** The gather's answer: the pending timers (a failed read is a fact, never an empty list) and each setter's stamp. */
export interface TimerFacts {
  readonly pending: TimersRead;
  readonly incarnations: ReadonlyMap<string, SetterIncarnation>;
}

/** Step 1: the pending timers, then each distinct setter's incarnation, read concurrently and once. */
export async function gatherTimerFacts(coord: Pick<WatcherCoordPort, 'pendingTimers'>,
                                       incarnation: (id: string) => Promise<IncarnationRead>): Promise<TimerFacts> {
  const pending = coord.pendingTimers();
  if (!pending.ok) return { pending, incarnations: new Map() };
  const setters = [...new Set(pending.rows.map((t) => t.setter))];
  const reads = await Promise.all(setters.map(async (id) => {
    try { return setterIncarnationOf(await incarnation(id)); } catch { return { kind: 'unmeasured' } as const; }
  }));
  return { pending, incarnations: new Map(setters.map((id, i) => [id, reads[i]!])) };
}

export interface TimersPassResult {
  readonly unread: string | null;
  readonly cancelled: readonly { readonly id: number; readonly reason: TimerCancelReason }[];
  readonly fired: readonly { readonly mailId: number; readonly ids: readonly number[] }[];
  readonly failed: number;
  readonly waited: number;
  readonly purged: number;
}

type BoundRun = { readonly row: RunRow } | 'none' | 'unmeasured';

/** Steps 2 to 4, synchronous: every write is the store's compare-and-set, and each mail is its own transaction. */
export function timersPass(d: { coord: WatcherCoordPort; now: number; log: (line: string) => void },
                           listing: TimerListing, facts: TimerFacts): TimersPassResult {
  const { coord, now } = d;
  const cancelled: { id: number; reason: TimerCancelReason }[] = [];
  const fired: { mailId: number; ids: number[] }[] = [];
  let failed = 0;
  let waited = 0;
  const unread = facts.pending.ok ? null : facts.pending.detail;
  if (unread !== null) d.log(`ccrc-server: the timers lane could not read its pending timers: ${unread}`);
  const runs = new Map<number, BoundRun>();
  const runOf = (id: number | null): BoundRun => {
    if (id === null) return 'none';
    let r = runs.get(id);
    if (r === undefined) {
      try { const read = coord.run(id); r = read.ok && read.run !== null ? { row: read.run } : 'unmeasured'; } catch { r = 'unmeasured'; }
      runs.set(id, r);
    }
    return r;
  };
  const programmeOf = (slug: string | null): CleanupFacts['boundProgramme'] => {
    if (slug === null) return 'none';
    try { return { planEnded: !coord.programmeLive(slug) }; } catch { return 'unmeasured'; }
  };
  const due: DueTimer[] = [];
  for (const t of facts.pending.ok ? facts.pending.rows : []) {
    const run = runOf(t.runId);
    const verdict = timerCleanupVerdict({
      boundRun: typeof run === 'string' ? run : { state: run.row.state },
      boundProgramme: programmeOf(t.programme),
      setAt: t.setAt, listedAt: listing.listedAt,
      listing: listing.listedIds === null ? 'unmeasured'
        : { listed: listing.listedIds.has(t.setter), archived: listing.archivedIds.has(t.setter) },
      incarnation: facts.incarnations.get(t.setter) ?? { kind: 'unmeasured' },
      stamp: t.setterIncarnation,
    });
    if (verdict.act === 'cancel') {
      if (coord.cancelTimer(t.id, 'cleanup', verdict.reason, now).changed) cancelled.push({ id: t.id, reason: verdict.reason });
    } else if (verdict.act === 'wait') {
      waited += 1;
    } else if (t.dueAt <= now) {
      due.push(dueOf(t));
    }
  }
  if (!listing.mailDisabled) {
    for (const m of packTimerMail(due, now)) {
      const run = runOf(m.runId);
      try {
        const mailId = tx(coord.db, () => {
          const q = insertSystemMailTx(coord, typeof run === 'string' ? null : run.row,
            { fromId: TIMER_MAIL_SENDER, toId: m.setter, runId: m.runId, kind: 'status', subject: m.subject, body: m.body });
          coord.markTimersFired(m.ids, q.mailId, now);
          return q.mailId;
        });
        fired.push({ mailId, ids: [...m.ids] });
      } catch (err) {
        failed += 1;
        d.log(`ccrc-server: the timers lane could not fire timers ${m.ids.join(', ')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  let purged = 0;
  try { purged = coord.purgeTimers(now - TIMER_KEEP_MS).removed; } catch (err) {
    d.log(`ccrc-server: the timers lane could not purge: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { unread, cancelled, fired, failed, waited, purged };
}

const dueOf = (t: TimerRow): DueTimer => ({ id: t.id, setter: t.setter, dueAt: t.dueAt, note: t.note, setAt: t.setAt,
  setById: t.setById, runId: t.runId, programme: t.programme });

/** One whole pass, as the watcher's `timers` row runs it: the gather on the fleet's `.generation` reads, then the pass at
 *  the clock's wall time (§11.5: the lane takes `Clock` from the composition root). */
export async function runTimersLane(d: { coord: WatcherCoordPort; clock: Pick<Clock, 'wall'>; io: FleetIO; registryDir: string;
                                         log: (line: string) => void }, listing: TimerListing): Promise<TimersPassResult> {
  const facts = await gatherTimerFacts(d.coord, (id) => incarnationOf(d, id));
  return timersPass({ coord: d.coord, now: d.clock.wall(), log: d.log }, listing, facts);
}
