// Overlord W2, the decision-model records and day counts (spec 2026-11-09 §3.7 H6, Table 11.1a; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 4). Ring: L3, context Coordination (C5). SQL only:
// every function is synchronous over the handle it is given, in `ledgersStore.ts`' idiom. No repository and no async wrapper.
//
// ONE WRITER PER FACT (`single-definition/writers-map.test.ts` pins each): `recordDecision` is `decision_records`' only writer;
// `reserveDecisionCalls` and `settleDecisionCalls` are the only writers of `decision_days`' counts (PR B's `recordAnchorRun`
// adds the anchor columns). A reservation a crash left unsettled is released at the next boot through
// `releaseDecisionReservations`, which settles it as maintenance through `settleDecisionCalls`, so a crash can only
// over-count spend, never under-count it.
//
// RECORDS HOLD REFERENCES (question 7). `refs` keeps the state's ref fields as ids; `inline` keeps the non-private quoted and
// fact fields, and a private-state row's write with `inline` set is a programming error, which throws.
import type { DatabaseSync } from 'node:sqlite';
import {
  DECISION_BANDS, DECISION_QUESTIONS, DECISION_RESERVE_PER_REQUEST,
  type DecisionBand, type DecisionRowId, type DecisionVerdict,
} from '../../../shared/decisionModel.js';
import type { DecisionUsage } from './decisionModel.js';
import type {
  DecisionAskStore, DecisionRecordKey, DecisionRecordRead, DecisionRecordWrite,
} from './decisionModelPort.js';
import { tx } from './tx.js';

export type { DecisionRecordKey, DecisionRecordRead, DecisionRecordWrite };

/** A verdict as `decision_records.verdict` spells it: `yes`, `no`, `unsure`, `none` or `option:<slug>`. */
export const verdictWord = (v: DecisionVerdict): string => (typeof v === 'string' ? v : `option:${v.option}`);
/** The column read back, or null for a word out of this build's vocabulary. */
const verdictOf = (w: string): DecisionVerdict | null => {
  if (w === 'yes' || w === 'no' || w === 'unsure' || w === 'none') return w;
  return w.startsWith('option:') && w.length > 'option:'.length ? { option: w.slice('option:'.length) } : null;
};
const isBand = (v: unknown): v is DecisionBand => typeof v === 'string' && (DECISION_BANDS as readonly string[]).includes(v);

const KEY_WHERE = 'row = ? AND revision = ? AND modelId = ? AND hostKind = ? AND origin = ? AND stateHash = ? AND lineGen = ?';
const keyArgs = (k: DecisionRecordKey): (string | number)[] =>
  [k.row, k.revision, k.modelId, k.hostKind, k.origin, k.stateHash, k.lineGen];

/** Keep one answer per key ("never asked twice"): a second write under the same key writes nothing and names the first. */
export function recordDecision(db: DatabaseSync, r: DecisionRecordWrite): { recorded: true; id: number } | { recorded: false; id: number } {
  if (DECISION_QUESTIONS[r.row].privateState && r.inline !== null) {
    throw new Error(`recordDecision: ${r.row} is private state, and its record keeps no inline fields`);
  }
  const ins = db.prepare(`INSERT INTO decision_records (row, revision, modelId, hostKind, origin, stateHash, lineGen, verdict, p,
    band, ms, refs, inline, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
    .run(...keyArgs(r), verdictWord(r.verdict), r.p, r.band, r.ms, JSON.stringify(r.refs),
      r.inline === null ? null : JSON.stringify(r.inline), r.at);
  if (Number(ins.changes) === 1) return { recorded: true, id: Number(ins.lastInsertRowid) };
  const row = db.prepare(`SELECT id FROM decision_records WHERE ${KEY_WHERE}`).get(...keyArgs(r)) as { id: number } | undefined;
  if (row === undefined) throw new Error('recordDecision: the insert wrote nothing and no record holds its key');
  return { recorded: false, id: row.id };
}

/** The record under a key: none, the record, or one whose words this build cannot read. */
export function decisionRecordOf(db: DatabaseSync, key: DecisionRecordKey): DecisionRecordRead {
  const row = db.prepare(`SELECT id, verdict, p, band, ms FROM decision_records WHERE ${KEY_WHERE}`).get(...keyArgs(key)) as
    { id: number; verdict: string; p: number; band: string; ms: number } | undefined;
  if (row === undefined) return { kind: 'none' };
  const verdict = verdictOf(row.verdict);
  if (verdict === null || !isBand(row.band)) return { kind: 'unreadable' };
  return { kind: 'record', id: row.id, verdict, p: row.p, band: row.band, ms: row.ms };
}

/** Add `calls` to each row's reservation for the day. Called inside the caller's transaction. */
export function reserveDecisionCalls(db: DatabaseSync, rows: readonly DecisionRowId[], day: string, calls: number): void {
  const st = db.prepare(`INSERT INTO decision_days (row, day, reserved) VALUES (?, ?, ?)
    ON CONFLICT (row, day) DO UPDATE SET reserved = reserved + excluded.reserved`);
  for (const row of rows) st.run(row, day, calls);
}

/** After the call: release the reservation and count the attempts made, success or failure, with the time unavailable. */
export function settleDecisionCalls(db: DatabaseSync, rows: readonly DecisionRowId[], day: string, kind: 'serve' | 'maintain',
  reserved: number, attempts: number, unavailableMs: number): void {
  const serve = kind === 'serve' ? attempts : 0;
  const maintain = kind === 'maintain' ? attempts : 0;
  const st = db.prepare(`INSERT INTO decision_days (row, day, serve, maintain, unavailableMs) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (row, day) DO UPDATE SET reserved = MAX(0, reserved - ?), serve = serve + excluded.serve,
    maintain = maintain + excluded.maintain, unavailableMs = unavailableMs + excluded.unavailableMs`);
  for (const row of rows) st.run(row, day, serve, maintain, unavailableMs, reserved);
}

/** Today's counts for one row, or `measured: false` when they cannot be read: never a bare null. `fleetTotal` is every row's
 *  serve, maintenance and reservations for the day. */
export function decisionUsage(db: DatabaseSync, row: DecisionRowId, day: string, ceiling: number): DecisionUsage {
  try {
    const r = db.prepare('SELECT serve, maintain, reserved FROM decision_days WHERE row = ? AND day = ?').get(row, day) as
      { serve: number; maintain: number; reserved: number } | undefined;
    const t = db.prepare('SELECT COALESCE(SUM(serve + maintain + reserved), 0) AS total FROM decision_days WHERE day = ?')
      .get(day) as { total: number };
    return { measured: true, serve: r?.serve ?? 0, maintain: r?.maintain ?? 0, reserved: r?.reserved ?? 0, ceiling,
      fleetTotal: Number(t.total) };
  } catch {
    return { measured: false };
  }
}

/** The boot step: every reservation a crash left unsettled is released and counted as maintenance (so spend is over-counted,
 *  never under-counted). Answers the calls it released. */
export function releaseDecisionReservations(db: DatabaseSync): number {
  return tx(db, () => {
    const stale = db.prepare('SELECT row, day, reserved FROM decision_days WHERE reserved > 0').all() as
      { row: DecisionRowId; day: string; reserved: number }[];
    for (const s of stale) settleDecisionCalls(db, [s.row], s.day, 'maintain', s.reserved, s.reserved, 0);
    return stale.reduce((n, s) => n + s.reserved, 0);
  });
}

/** The store as the one caller uses it (`decisionModelPort.ts#DecisionAskStore`). No method throws. */
export function decisionAskStore(db: DatabaseSync): DecisionAskStore {
  return {
    inTransaction: () => db.isTransaction,
    recordOf: (key) => {
      try { return decisionRecordOf(db, key); } catch { return { kind: 'unreadable' }; }
    },
    reserve: (day, rows, decide) => {
      try {
        return tx(db, () => {
          const out: DecisionRowId[] = [];
          for (const r of rows) {
            if (!decide(r.row, decisionUsage(db, r.row, day, r.ceiling))) continue;
            reserveDecisionCalls(db, [r.row], day, DECISION_RESERVE_PER_REQUEST);
            out.push(r.row);
          }
          return out;
        });
      } catch {
        return 'unmeasured';
      }
    },
    settle: (day, kind, rows, reserved, attempts, unavailableMs) => {
      try {
        tx(db, () => settleDecisionCalls(db, rows, day, kind, reserved, attempts, unavailableMs));
        return true;
      } catch {
        return false;
      }
    },
    record: (r) => {
      try { return tx(db, () => recordDecision(db, r)); } catch { return { failed: true }; }
    },
  };
}
