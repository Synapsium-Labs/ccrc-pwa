// L3 (coord, context C5 Coordination; D-6095, fleet-capacity W1-4, re-grounded by the waiting-workers plan Task 4): the
// admission wake's ONE write. The observation row, the mail and the `admissionWokenAt` stamp go in ONE transaction, the
// stall watch's pattern (`rundefsTx.ts#queueStallNotice`): the row is the once-only key, so a restart between passes never
// re-sends, and a refused write leaves nothing behind. The claimant's `capacity` blocks are woken in it too. Not `queueSystemMail`: its dedupe asks only for an OUTSTANDING mail,
// so a wake the coordinator already acked would be sent again. It lives beside `rundefsTx.ts` rather than in it because that
// file is held under a freeze while this lands (capacity-task4-notes.md, slug wake-tx-own-file); its one caller is the
// `admissionWake` lane (`watch.ts#sweepAdmissionWake`).
import { tx } from './tx.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { admissionWakeDetail, admissionWakeMail, type AdmissionWaiter } from './admissionWake.js';
import type { StallObservation } from './store.js';
import type { WatcherCoordPort } from './ports.js';

/** What `queueAdmissionWake` did. `duplicate`: this refusal's wake was already recorded (and its mail sent); `run-gone`:
 *  the run moved, was refused again or lost its claimant since the lane read it, so nothing is written. */
export type AdmissionWakeQueued =
  | { queued: true; mailId: number; deliveryId: number; eventId: number }
  | { queued: false; why: Extract<StallObservation, { recorded: false }>['why'] };

export function queueAdmissionWake(coord: WatcherCoordPort, w: AdmissionWaiter, at: number): AdmissionWakeQueued {
  return tx(coord.db, (): AdmissionWakeQueued => {
    const seen = coord.insertObservation(w.runId, admissionWakeDetail(w), at, { kind: 'admission', refusedAt: w.lastRefusedAt });
    if (!seen.recorded) {
      // A duplicate is a wake already sent for this very refusal: the stamp is made true (idempotent) so the run leaves the
      // eligible list, and no second mail goes out.
      if (seen.why === 'duplicate') {
        coord.markAdmissionWoken(w.runId, at);
        wakeCapacityBlocks(coord, w.claimedBy, at);
      }
      return { queued: false, why: seen.why };
    }
    const words = admissionWakeMail(w);
    const q = insertSystemMailTx(coord, { program: w.program }, {
      fromId: 'operator', toId: w.claimedBy, runId: w.runId, kind: 'status', subject: words.subject, body: words.body,
    });
    coord.markAdmissionWoken(w.runId, at);
    wakeCapacityBlocks(coord, w.claimedBy, at);
    return { queued: true, mailId: q.mailId, deliveryId: q.deliveryId, eventId: seen.eventId };
  });
}

/** The claimant's live blocks parked on `capacity` are woken with the wake (amendment A8-3 of D-8126): the block-wake lane
 *  leaves `capacity` to this lane (`coordCalls.ts#blockWakeDue`), and, as there, a block is never woken without its mail:
 *  `markBlockWoken`, the one writer of `wokenAt`, runs in this same transaction. */
function wakeCapacityBlocks(coord: WatcherCoordPort, claimedBy: string, at: number): void {
  for (const b of coord.liveBlocksOf(claimedBy, at)) {
    if (b.wakeOn === 'capacity') coord.markBlockWoken(b.id, at);
  }
}
