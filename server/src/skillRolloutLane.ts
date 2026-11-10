// D-8126 (autonomy plan Task A9-3, spec §9.3): the rollout mail's start-up pass. L4: it READS the open claimants and each
// one's binding, QUEUES the system mail and RECORDS the feed row; which mails are due and their words are
// `coord/skillRollout.ts`'s (L1). Once per claimant per skill revision, durably: the mail row itself is what a restart
// reads (`CoordStore.hasMailWithSubject`), because the `mail` table is never pruned. The feed row's once-only key is
// NOT durable over a coordinator's lifetime (the archive keeps only the newest `FEED_RETENTION` rows, and a pruned row
// reads as never recorded), so it is a second reader here and never the only one.
//
// FAIL TOWARD NOT SENDING TWICE: a claimant whose binding cannot be read is skipped (it is not told on a guess, and
// nothing is recorded, so the next start asks again); a mail that throws records nothing and the pass goes on.
import type { WatcherCoordPort } from './coord/ports.js';
import { queueSystemMail } from './coord/rundefsTx.js';
import { rolloutKey, rolloutMailsDue, rolloutMailSubject } from './coord/skillRollout.js';

export interface SkillRolloutDeps {
  readonly coord: WatcherCoordPort;
  /** Writes the recorded-only feed row under its once-only key. The watcher's `pushOne` is the production arm. */
  readonly record: (e: { sessionId: string; title: string; body: string }, dedupeKey: string) => void;
}

/** A session is a child when some coordinator has it working for it (`claimants`: an open run names it as the worker, a run
 *  it claims itself never counts). An unreadable series throws, and the caller reads that as "not told on a guess". */
const isChild = (coord: WatcherCoordPort, sessionId: string): boolean => coord.bindingsOf(sessionId).claimants().length > 0;

/** One pass at server start. Answers the sessions it mailed. Never throws. */
export function runSkillRollout(deps: SkillRolloutDeps, revision: string): { sent: string[] } {
  const { coord, record } = deps;
  const sent: string[] = [];
  let claimants: string[];
  try {
    claimants = coord.openCoordinatorIds().filter((id) => {
      try { return !isChild(coord, id); } catch { return false; }
    });
  } catch (err) {
    console.warn(`ccrc-server: skill rollout: the claimants could not be read (${err instanceof Error ? err.message : String(err)})`);
    return { sent };
  }
  for (const m of rolloutMailsDue(claimants, (id) => coord.hasMailWithSubject('operator', null, id, rolloutMailSubject(revision))
      || coord.hasNotice('coord', id, rolloutKey(revision, id)), revision)) {
    try {
      queueSystemMail(coord, null, { fromId: 'operator', toId: m.toId, runId: null, kind: 'status', subject: m.subject, body: m.body });
      record({ sessionId: m.toId, title: 'Coordinator skill changed', body: m.body }, m.key);
      sent.push(m.toId);
    } catch (err) {
      console.warn(`ccrc-server: skill rollout to ${m.toId} failed (${err instanceof Error ? err.message : String(err)}); the next start retries`);
    }
  }
  return { sent };
}
