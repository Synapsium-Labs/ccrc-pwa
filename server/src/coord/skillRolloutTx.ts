// L3 (coord, context C5 Coordination; D-8126, autonomy plan Task A9-3, review 3077 F2): the rollout mail's ONE write. The
// dedupe and the mail go in ONE transaction, `queueRunlessNotice`'s shape (`rundefsTx.ts#queueRunlessNotice`): a subject
// already sent to this claimant, in any delivery state, answers `duplicate` and writes nothing, so the mail goes once per
// claimant per revision across restarts (the `mail` table is never pruned). Not `queueRunlessNotice` itself: the rollout mail
// is queued with `wake = 'never'`, so the mail sweep holds it for a sleeping coordinator and asks no `ccd ensure`, and that
// helper takes no wake. It lives beside `rundefsTx.ts` rather than in it because that file is held under a freeze while this
// lands (`admissionWakeTx.ts`'s reason too; d8126-a9-notes.md, slug rollout-tx-own-file); its one caller is the
// `skillRollout` lane's pass (`skillRolloutLane.ts#skillRolloutPass`).
import { tx } from './tx.js';
import { insertSystemMailTx } from './rundefsTx.js';
import type { WatcherCoordPort } from './ports.js';

/** What `queueRolloutMail` did. `duplicate`: this claimant already has a mail under this subject, so nothing is written. */
export type RolloutMailQueued = { queued: true; mailId: number; deliveryId: number } | { queued: false; why: 'duplicate' };

export function queueRolloutMail(coord: WatcherCoordPort, m: { toId: string; subject: string; body: string }): RolloutMailQueued {
  return tx(coord.db, (): RolloutMailQueued => {
    if (coord.hasMailWithSubject('operator', null, m.toId, m.subject)) return { queued: false, why: 'duplicate' };
    const q = insertSystemMailTx(coord, null, { fromId: 'operator', toId: m.toId, runId: null, kind: 'status',
      subject: m.subject, body: m.body, wake: 'never' });
    return { queued: true, mailId: q.mailId, deliveryId: q.deliveryId };
  });
}
