// L1, context C3 (Session Conversation): `drainVerdict`, whether a renewing session is drained (Overlord spec §3.3.11,
// "the preconditions" and the `draining` state; W1a renewal act Task 4). Pure.
//
// THE HOLD TABLE IS THE HIBERNATE LANE'S (`hibernateVerdict`, `coord/hibernate.ts`), and this adds no second idle test: it
// asks that table with the facts that mean "the turn finished, no background or scheduled task, no subagent, no menu or
// dialog" left as measured, and the facts that do not bear on a renewal set aside (slug drain-asks-the-hold-table). Set
// aside: mail outstanding (the renewing gate holds a draining session's deliveries, so its mail is outstanding by design
// and would hold forever), open runs and claims (a coordinator always claims one, and its runs and claims stand across a
// renewal, as they do across the automatic roll), a programme hold, the row's bucket (a coordinator at rest is badged
// `done`), presence (an open screen does not stop a renewal) and the quiet window (a drained turn is drained now, not
// after N hours). Kept: no pane, an unmeasured identity or live file, a live word that is not at rest, a menu, background
// work, running subagents, a turn marker that does not read a finished turn of this process, background or scheduled work
// at its last Stop, a stranded, swap-blocked or substrate-marked row, and an archived one. Every read the table could not
// make holds: an unmeasured drain is never a drain.
import { hibernateVerdict, type HibernateLive, type HibernateRow } from '../coord/hibernate.js';

/** A session's drain, as `softRenewalMay`'s `hibernateHold` input reads it. */
export type DrainRead = { readonly held: false } | { readonly held: true; readonly reason: string };

/** What a draining session holds on: the hold table's first hold among the facts kept (the header), or none. */
export function drainVerdict(row: HibernateRow, live: HibernateLive, now: number): DrainRead {
  const v = hibernateVerdict({
    row: { ...row, bucket: 'idle', held: null },
    // A renewal moves the Overlord's own body, so the sleep hold that keeps it awake is set aside here.
    overlord: false, optedOut: false,
    store: { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false },
    viewer: false,
    sinceStartMs: Number.MAX_SAFE_INTEGER,
    live,
  }, now, 0);
  if (v.act === 'hibernate') return { held: false };
  return { held: true, reason: v.act === 'measure' ? 'unmeasured' : v.reason };
}
