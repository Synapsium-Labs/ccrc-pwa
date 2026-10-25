// DISK RETENTION DR-21 (D-6633; spec 2026-10-23 §2.7.1). The ONE writer of the "a nested repository would be rescued"
// feed row, shared by the reclaim lane and the expiry lane so neither spells the row, and neither writes a second kind.
// It runs only where an audit refused and said, in `nestedRescue.wouldRescue`, that the arm would have rescued (the key
// is empty whenever the arm is live or something else refused), and it writes once per `key` — a child's minting run, an
// archive's instant — so a refusal asked again is not a second row. Recorded, never pushed; a missing log or a throwing
// archive costs the row and never the act (the funnel's rule, `notice.ts`).
import type { NotifyLog } from '../notifylog.js';
import type { CoordStore } from './store.js';
import { notify } from '../notice.js';
import { journalShadowVerdict } from './shadowJournal.js';
import { SHADOW_LANE } from '../../../shared/shadowJournal.js';
import { NESTED_RESCUE_SHADOW_TITLE, nestedRescueShadowBody } from '../../../shared/nestedRescue.js';

export function recordNestedRescueShadow(
  deps: { readonly coord: CoordStore; readonly notifyLog?: NotifyLog | undefined },
  row: { readonly sessionId: string; readonly runId: number | null; readonly key: string; readonly who: string; readonly count: number;
    readonly paths?: readonly string[] },
): void {
  if (row.count <= 0) return;
  // The durable journal first (D-TBD-shadow-journal): one row per path, keyed durably, so it records on a refusal asked
  // again after a restart or after the feed row rolled over. A count with no paths is one row naming the session only.
  for (const path of (row.paths ?? []).length > 0 ? row.paths! : [null]) {
    journalShadowVerdict(deps.coord, { lane: SHADOW_LANE.nestedRescue, subject: row.sessionId, path, epoch: row.key, bytes: null, inodes: null,
      detail: nestedRescueShadowBody(row.who, row.count) });
  }
  const dedupeKey = `nested-rescue-shadow:${row.sessionId}:${row.key}`;
  if (deps.coord.hasNotice('run', row.sessionId, dedupeKey)) return;
  notify(deps, { kind: 'run', sessionId: row.sessionId, runId: row.runId, title: NESTED_RESCUE_SHADOW_TITLE,
    body: nestedRescueShadowBody(row.who, row.count) }, 'record-only',
  { degraded: 'nested rescue shadow, feed archive degraded', dedupeKey });
}
