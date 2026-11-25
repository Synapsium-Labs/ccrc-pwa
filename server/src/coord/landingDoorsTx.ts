// L3, context C5 (landing order wave 5j-a, D-9046). The statements of the operator's two door records, run by
// `CoordStore.applyLandingRecord` alone, inside the transaction it is in: a live write's or a replay's. It opens no
// transaction, reads nothing and decides nothing; the store keeps the guard, the owned transaction and the fence, as
// `landingControlTx.ts` does for the control pass. The store still grows against its merge-base; the growth check passes
// through its new-file rule.
//
// Two facts, one writer each:
// - `landing_projects.operatorPaused`: the pause statement is its one writer. It never names `mainRedHold`, whose one
//   writer is `applyLandingControlTx`'s statement, and nothing automatic clears a pause.
// - `landing_entries.state = 'withdrawn'`: the withdraw statement is its one writer. `state`, `detail` and
//   `quarantineKind` thereby gain a second writer beside `advanceLanding` (and the land arm), legitimately different:
//   each writes a different fact. `advanceLanding` writes the measured lane facts, the land arm GitHub's terminal answer,
//   and this statement the operator's authoritative withdrawal, which replay must restore after an append whose apply
//   failed, and which `advanceLanding`, a run's lane, never reaches from replay.
import type { DatabaseSync } from 'node:sqlite';
import {
  LANDING_TERMINAL_STATES, type LandingJournalPauseRecord, type LandingJournalSubjectRecord,
} from '../../../shared/landingLine.js';

/** The terminal words, as one SQL list: a `landed` or `closed` row keeps what the sweep wrote ("the sweep wins for landed
 *  state"), and a `withdrawn` one stays as its first withdrawal wrote it. */
const TERMINAL_SQL = LANDING_TERMINAL_STATES.map((s) => `'${s}'`).join(', ');

/** The two door records' statements, run by `CoordStore.applyLandingRecord` alone, inside the transaction it is in (a live
 *  write's or a replay's). Opens no transaction, reads nothing, decides nothing. A withdrawal matches its row by `id`,
 *  `project` and `pr` together, so a record whose id names another (project, pr) leaves that row alone; a row it does not
 *  match (absent, or already terminal) is left as it is, and the record still advances the cursor. */
export function applyLandingDoorRecordTx(db: DatabaseSync,
  r: LandingJournalPauseRecord | Extract<LandingJournalSubjectRecord, { kind: 'withdraw' }>): void {
  if (r.kind === 'pause') {
    db.prepare('INSERT INTO landing_projects (project, operatorPaused) VALUES (?, ?) ON CONFLICT(project) DO UPDATE SET operatorPaused = excluded.operatorPaused')
      .run(r.project, r.paused ? 1 : 0);
    return;
  }
  const detail = JSON.stringify({ v: 1, by: 'operator', at: r.at, word: 'withdrawn', seq: r.seq });
  db.prepare(`UPDATE landing_entries SET state = 'withdrawn', quarantineKind = NULL, detail = ? WHERE id = ? AND project = ? AND pr = ? AND state NOT IN (${TERMINAL_SQL})`)
    .run(detail, r.subject.id, r.subject.project, r.subject.pr);
}
