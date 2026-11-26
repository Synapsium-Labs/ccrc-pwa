// L3, context C5 (landing order wave 5j-a, D-9046; wave 5j-b, D-9045, D-9050). The statements of the operator's two door
// records, run by `CoordStore.applyLandingRecord` alone, inside the transaction it is in: a live write's or a replay's;
// the withdrawal's notices, queued inside the authority writer's transaction (never by replay); and the parse before the
// append, one pure check the writer calls on every record it built. Nothing here opens a transaction or decides; the store
// keeps the guard, the owned transaction and the fence, as `landingControlTx.ts` does for the control pass. The store
// still grows against its merge-base; the growth check passes through its new-file rule.
//
// Two facts, one writer each:
// - `landing_projects.operatorPaused`: the pause statement is its one writer. It never names `mainRedHold`, whose one
//   writer is `applyLandingControlTx`'s statement, and nothing automatic clears a pause.
// - `landing_entries.state = 'withdrawn'`: the withdraw statement is its one writer. `state`, `detail` and
//   `quarantineKind` thereby gain a second writer beside `advanceLanding` (and the land arm), legitimately different:
//   each writes a different fact. `advanceLanding` writes the measured lane facts, the land arm GitHub's terminal answer,
//   and this statement the operator's authoritative withdrawal, which replay must restore after an append whose apply
//   failed, and which `advanceLanding`, a run's lane, never reaches from replay.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  LANDING_TERMINAL_STATES, type LandingJournalPauseRecord, type LandingJournalRecord, type LandingJournalSubjectRecord, type LandingNoticeOutcome,
} from '../../../shared/landingLine.js';
import { parseLandingJournal } from './landingJournalPolicy.js';
import type { LandingMutationDecision, LandingWithdrawNotice } from './landingWrites.js';
import type { WatcherCoordPort } from './ports.js';
import { queueRunlessNoticeTx } from './rundefsTx.js';

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

/** The parse before the append (wave 5j-b, D-9045; section 11 C6): whether the journal's text with the built record's line,
 *  the exact bytes the adapter would leave, parses with the journal's own parser AND ends at that record's seq (seen as the
 *  last record, not merged into or dropped beside another line). Pure: the writer calls it for every kind, old and new, and
 *  refuses `landing-record-unparseable` on `false`, before anything is appended. */
export function landingAppendParses(text: string, record: LandingJournalRecord, line: string): boolean {
  const p = parseLandingJournal(text + line);
  return p.ok && p.lastSeq === record.seq;
}

/** The withdrawal's notices (D-9050), inside the authority writer's transaction: each built notice through
 *  `queueRunlessNoticeTx` (subject `<word>:#<pr>:<64 hex of the identity>`, kind `status`, from `operator`), and one outcome
 *  per recipient of the decision, in its order: the entry's, then each direct dependant's. A `duplicate` cannot happen (the
 *  identity carries the record's unique seq), so it throws, and the store rolls the write back and classifies the phase. */
export function queueLandingDoorNoticesTx(coord: WatcherCoordPort,
  m: Extract<Extract<LandingMutationDecision, { ok: true }>['mutation'], { kind: 'withdraw' }>, notices: LandingWithdrawNotice[]): LandingNoticeOutcome[] {
  const queued = new Map<string, LandingNoticeOutcome>();
  for (const n of notices) {
    const subject = `${n.word}:#${n.pr}:${createHash('sha256').update(n.identity).digest('hex')}`;
    const q = queueRunlessNoticeTx(coord, { toId: n.toId, kind: 'status', subject, body: n.body });
    if (!q.queued) throw new Error(`landing: a withdrawal notice answered ${q.why}`);
    queued.set(`${n.word} ${n.entryId}`, { word: n.word, entryId: n.entryId, kind: 'queued', toId: n.toId, mailId: q.mailId, deliveryId: q.deliveryId });
  }
  const slots = [{ word: 'landing-withdrawn' as const, entryId: m.entry.id, recipient: m.recipient },
    ...m.dependants.map((d) => ({ word: 'landing-held' as const, entryId: d.entry.id, recipient: d.recipient }))];
  return slots.map(({ word, entryId, recipient }): LandingNoticeOutcome => {
    if (recipient.kind === 'none') return { word, entryId, kind: 'none', reason: recipient.reason };
    if (recipient.kind === 'unreadable') return { word, entryId, kind: 'unreadable' };
    const out = queued.get(`${word} ${entryId}`);
    if (out === undefined) throw new Error('landing: a session recipient has no queued notice');
    return out;
  });
}
