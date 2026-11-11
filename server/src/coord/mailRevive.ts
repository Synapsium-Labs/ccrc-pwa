/**
 * THE PARKED-MAIL REVIVE POLICY (D-5914, D-7901; spec 2026-10-20 §3, #125). L1: pure, no I/O, nothing from fastify or
 * `fs`. A delivery the lane rejected because its recipient's lifecycle read dead stays `rejected` for ever: nothing
 * reopens a terminal row, and `unreadMail` kept counting it on an open run long after the recipient came back. The
 * cure is an HEIR: one new delivery of the same mail, naming its parent in `mail_deliveries.revivedFrom`, queued once the
 * recipient reads live again. The parent is never written; its retirement is derived in the read (`HAS_HEIR_SQL` in
 * `store.ts`).
 *
 * This file owns the two halves of the decision that are not relational:
 *  - WHICH PARKS come back (`REVIVABLE_PARK_ERRORS`, `REVIVE_SKIPPED_SENDERS`, `REVIVE_SKIPPED_SUBJECT_HEADS`), the
 *    vocabulary `CoordStore.reviveParkedDeliveries` composes into its select. The relational bounds (an open run, the
 *    run's current wave, no heir yet, the role still held, no live or acked copy of the mail) are SQL there, because
 *    they are joins.
 *  - WHEN A RECIPIENT READS LIVE (`revivable`), the reading `FleetWatcher.mailPass` asks of each registry row.
 */
import { DEAD_LIFECYCLES, lifecycleIsDead, sessionLifecycle, type LifecycleInput } from '../../../shared/api.js';
import { DONE_CLAIM_ANSWER_SUBJECTS } from './closeDecide.js';
import { PARK_NOTICE_WHATS, parkNoticeHead, sessionDeadError } from './delivery.js';
import type { SystemMailSender } from './rundefs.js';
import {
  STALL_CHECK_PREFIX, STALL_FAILED_PREFIX, STALL_ORPHANED_PREFIX, STALL_REPORT_PREFIX, STALL_RESTARTED_PREFIX,
} from './stall.js';

/**
 * The `lastError` of every park that comes back with its recipient:
 *  - the LIFECYCLE PARK, `decideSessionDead`'s `recipient session is <lc>` for each lifecycle `lifecycleIsDead` names,
 *    derived from `DEAD_LIFECYCLES` rather than listed a second time;
 *  - the two LEGACY live-recipient parks a build before #853 wrote at the attempts ceiling, `draft-present` and
 *    `enter-ignored` (the refusal word itself). They are mail nobody read: #853 measured five wave briefs lost to them.
 *
 * NOT here, each on purpose (spec §3.1): a deliberate cancel, the replay-ceiling park (it has its own ack door), a
 * registry-absent park (`recipient not in registry`: an absent id is not a session that came back), and #853's 24 h
 * ceiling reject (`parked 24 h, never delivered: …`), whose recipient was live throughout and whose sender was told and
 * owns the re-send.
 */
/** The LIFECYCLE PARK alone (D-8282): mail parked while its recipient read dead, so a recipient that reads live again is
 *  a later incarnation of that session. These are the parks `CoordStore.reviveParkedDeliveries` closes when it declines
 *  to revive one; the legacy live-recipient parks below never had a dead incarnation and are not closed. */
export const LIFECYCLE_PARK_ERRORS: readonly string[] = DEAD_LIFECYCLES.map(sessionDeadError);

export const REVIVABLE_PARK_ERRORS: readonly string[] = [
  ...LIFECYCLE_PARK_ERRORS,
  'draft-present',
  'enter-ignored',
];

/**
 * Senders a revive never re-sends for: `operator`, the voice the watcher speaks in (`SYSTEM_MAIL_SENDER_MAP`,
 * `coord/rundefs.ts`). Every run-bound mail in that voice is a notice about a moment: a stall report, a `brief not
 * taken` notice, a `checks:` or `merged:` or `dequeued:` landing notice, a dispatch abandon. Each owner regenerates its
 * notice if it still matters; a revived copy would arrive as if new, about a state that has since moved, and a stale
 * `checks:…:red` is that harm exactly. `coordinator` is NOT here: the wave brief speaks in that voice and is work the
 * recipient still owes, which is what the revive is for. A bound on the sender, not on subjects, so a notice written
 * tomorrow in this voice is covered without a row here.
 */
export const REVIVE_SKIPPED_SENDERS: readonly SystemMailSender[] = ['operator'];

/**
 * Subject heads a revive never re-sends, whoever the sender:
 *  - the done-claim answers (`DONE_CLAIM_ANSWER_SUBJECTS`), the only notices in the `coordinator` voice, which is why
 *    they are named here and the wave brief beside them is not (`mail-revive.test.ts` holds that census): the claim
 *    they answer has moved on, and the worker re-sends it;
 *  - the stall lane's notices (its check, its report and its three self-wake notices), which also bind a session
 *    quoting one;
 *  - the server's own park notices (`mail parked:`, `mail rejected:`). `tellParkedSender` writes those with no run, so
 *    the select's join already leaves them out; spec §3.1 names them, and the head says so at the vocabulary.
 */
export const REVIVE_SKIPPED_SUBJECT_HEADS: readonly string[] = [
  ...DONE_CLAIM_ANSWER_SUBJECTS,
  STALL_CHECK_PREFIX, STALL_REPORT_PREFIX, STALL_ORPHANED_PREFIX, STALL_FAILED_PREFIX, STALL_RESTARTED_PREFIX,
  ...PARK_NOTICE_WHATS.map(parkNoticeHead),
];

/** What the mail pass knows of a recipient this tick: whether the fleet listing was read at all, and whether this id
 *  has a registry row in it. */
export interface RecipientReading {
  readonly listed: boolean;
  readonly registryPresent: boolean;
}

/**
 * May mail parked against this recipient come back now? `row` is the recipient's registry row as a lifecycle input
 * (`lifecycleInputFor`, built the way the park arm builds it), or null when there is none.
 *
 * "Reads live" is `listed && registryPresent && !lifecycleIsDead(sessionLifecycle(row))`, and it CALLS the predicate the
 * park arm already uses (`watch.ts`'s session-dead rung): no second lifecycle-dead test is written beside it, so the
 * park and the revive cannot drift apart. Doubt is not death (`unmeasurable` reads live, as it holds rather than parks
 * there), and a hibernated session's stop stamp reads `stopped`, so its mail waits until it is listed awake.
 */
export function revivable(row: LifecycleInput | null, reading: RecipientReading): boolean {
  if (!reading.listed || !reading.registryPresent || row === null) return false;
  return !lifecycleIsDead(sessionLifecycle(row));
}
