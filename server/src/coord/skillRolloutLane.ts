// D-8126 (autonomy plan Task A9-3, spec §9.3; review focus F14): the rollout mail's lane, the L4 executor. On the
// watcher's tick (`LANE_SCHEDULE`'s `skillRollout` row), over that tick's registry listing, it READS the open runs'
// claimants, each one's `.child` reading and whether it was already told; `decideRollout` (L1, `skillRollout.ts`) decides;
// this file QUEUES each system mail (`wake = 'never'`, and record-only in the push lane, `isSkillRolloutMail`) and
// RECORDS its feed row. It decides nothing.
//
// ONCE PER CLAIMANT PER REVISION, DURABLY: what a restart reads is the mail row itself (`hasMailWithSubject`; the `mail`
// table is never pruned), with the feed row's once-only key (`hasNotice`) as a second reader. The feed row alone is not
// durable over a coordinator's lifetime: the archive keeps the newest `FEED_RETENTION` rows, and a pruned row reads as
// never recorded, which would re-mail a long-running coordinator on every deploy.
//
// AT START, THEN DONE: the first settled pass (every claimant mailed, told, a child or gone) marks the revision done in
// `memory`, and later beats return at once, so a coordinator that opens its first run after the rollout gets no mail (it
// starts on the new cards). A pass that holds (`mail-disabled` standing or unreadable, an unmeasured claimant) or whose
// mail throws is not settled, and the next beat asks again. A coordinator first claiming a run in that window is told too,
// which costs one mail and nothing else.
import type { FleetReadModel } from '../fleetReadModel.js';
import type { SessionRecord } from '../registry.js';
import { MAIL_DISABLED_MARKER } from '../../../shared/switches.js';
import type { WatcherCoordPort } from './ports.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { tx } from './tx.js';
import { decideRollout, rolloutKey, rolloutMailSubject, type RolloutClaimant } from './skillRollout.js';

/** This beat's registry facts, as the lane reads them: `null` when the registry did not list (the pass holds). */
export interface RolloutListing {
  readonly records: readonly Pick<SessionRecord, 'id' | 'child'>[];
  readonly refused: ReadonlySet<string>;
  readonly mailDisabled: FleetReadModel['switches'][typeof MAIL_DISABLED_MARKER];
}

export const rolloutListingOf = (read: FleetReadModel): RolloutListing | null =>
  read.listed ? { records: read.records, refused: read.refused, mailDisabled: read.switches[MAIL_DISABLED_MARKER] } : null;

export interface SkillRolloutDeps {
  readonly coord: WatcherCoordPort;
  /** Writes the record-only feed row under its once-only key. The watcher's `pushOne` is the production arm. */
  readonly record: (e: { sessionId: string; title: string; body: string }, dedupeKey: string) => void;
  readonly revision: string;
  /** The revisions this process has settled, OWNED BY THE CALLER and kept across beats. */
  readonly settled: Set<string>;
  readonly log: (line: string) => void;
}

/** One beat. Answers the sessions it mailed and whether the revision is settled for this process. */
export function skillRolloutPass(deps: SkillRolloutDeps, listing: RolloutListing | null): { sent: string[]; settled: boolean } {
  const { coord, revision } = deps;
  if (deps.settled.has(revision)) return { sent: [], settled: true };
  if (listing === null) return { sent: [], settled: false };
  const byId = new Map(listing.records.map((r) => [r.id, r]));
  const subject = rolloutMailSubject(revision);
  const claimants: RolloutClaimant[] = coord.openCoordinatorIds().map((id) => {
    const row = byId.get(id);
    const child = listing.refused.has(id) ? 'refused' : row === undefined ? 'unlisted' : row.child.kind;
    return { id, child, told: coord.hasMailWithSubject('operator', null, id, subject) || coord.hasNotice('coord', id, rolloutKey(revision, id)) };
  });
  const plan = decideRollout({ revision, mailDisabled: listing.mailDisabled, claimants });
  const sent: string[] = [];
  let failed = false;
  for (const m of plan.mails) {
    try {
      // `wake: 'never'` (review 3077 F2): the mail sweep holds it for a sleeping coordinator and asks no `ccd ensure`, as the
      // other record-style system mails do (`untold.ts`, `reviewRelease.ts`); a coordinator that wakes reads the new cards.
      // `queueSystemMail` takes no wake, so the body runs here in its own transaction; `told` above is the dedupe.
      tx(coord.db, () => insertSystemMailTx(coord, null, { fromId: 'operator', toId: m.toId, runId: null, kind: 'status',
        subject: m.subject, body: m.body, wake: 'never' }));
      deps.record({ sessionId: m.toId, title: 'Coordinator skill changed', body: m.body }, m.key);
      sent.push(m.toId);
    } catch (err) {
      failed = true;
      deps.log(`ccrc-server: skill rollout to ${m.toId} failed (${err instanceof Error ? err.message : String(err)}); the next beat retries`);
    }
  }
  const settled = plan.settled && !failed;
  if (settled) deps.settled.add(revision);
  return { sent, settled };
}
