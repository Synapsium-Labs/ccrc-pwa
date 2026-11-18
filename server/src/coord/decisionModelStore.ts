// Overlord W2, the decision-model records and day counts (spec 2026-11-09 §3.7 H6, Table 11.1a; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 4). Ring: L3, context Coordination (C5). SQL only:
// every function is synchronous over the handle it is given, in `ledgersStore.ts`' idiom. No repository and no async wrapper.
//
// ONE WRITER PER FACT (`single-definition/writers-map.test.ts` pins each): `recordDecision` is `decision_records`' only writer;
// `reserveDecisionCalls` and `settleDecisionCalls` are the only writers of `decision_days`' counts, and `recordAnchorRun` of its
// anchor columns; PR B adds `moveDecisionRowInTx` (`decision_rows`, journal record first), `setDecisionHostInTx`
// (`decision_host`), and `admitDecisionLine` with `recordCanary` (`decision_lines`). A reservation a crash left unsettled is released at the next boot through
// `releaseDecisionReservations`, which settles it as maintenance through `settleDecisionCalls`, so a crash can only
// over-count spend, never under-count it.
//
// RECORDS HOLD REFERENCES (question 7). `refs` keeps the state's ref fields as ids; `inline` keeps the non-private quoted and
// fact fields, and a private-state row's write with `inline` set is a programming error, which throws.
import type { DatabaseSync } from 'node:sqlite';
import {
  DECISION_BANDS, DECISION_CEILING_MAX, DECISION_CEILING_MIN, DECISION_HOST_KINDS, DECISION_QUESTIONS, DECISION_RESERVE_PER_REQUEST,
  DECISION_ROW_DEFAULT, DECISION_ROW_IDS,
  isDecisionHeldCause, isDecisionRowMode,
  type DecisionBand, type DecisionHeldCause, type DecisionHostKind, type DecisionRowId, type DecisionRowSide, type DecisionRowState,
  type DecisionVerdict,
} from '../../../shared/decisionModel.js';
import { isDecisionGate } from './decisionLines.js';
import type { AuthorityAppend } from './overlordAuthorityJournal.js';
import type { OverlordAuthorityMove } from './overlordAuthority.js';
import type { DecisionUsage } from './decisionModel.js';
import type {
  DecisionArmingStore, DecisionArmingTx, DecisionAskStore, DecisionHostRead, DecisionHostRow, DecisionLineKey, DecisionLineRow,
  DecisionLineWrite, DecisionRecordKey, DecisionRecordRead, DecisionRecordWrite, DecisionRowMove, DecisionRowMoved, DecisionRowRead,
} from './decisionModelPort.js';
import { tx } from './tx.js';

export type {
  DecisionHostRead, DecisionHostRow, DecisionLineKey, DecisionLineRow, DecisionLineWrite, DecisionRecordKey, DecisionRecordRead,
  DecisionRecordWrite, DecisionRowMove, DecisionRowMoved, DecisionRowRead,
};

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

// ── PR B: the rows, the host, the lines and the anchors (plan Tasks 6 and 9) ─────────────────────────────────────────────

const DEFAULT_STATE: DecisionRowState = { ...DECISION_ROW_DEFAULT, heldCause: null };

/** The one reader of `decision_rows`. Never throws. */
export function decisionRowRead(db: DatabaseSync, row: DecisionRowId): DecisionRowRead {
  let r: { mode: unknown; ceiling: unknown; armedLineId: unknown; armedLineValue: unknown; heldCause: unknown } | undefined;
  try {
    r = db.prepare('SELECT mode, ceiling, armedLineId, armedLineValue, heldCause FROM decision_rows WHERE row = ?').get(row) as typeof r;
  } catch {
    return { kind: 'unreadable' };
  }
  if (r === undefined) return { kind: 'row', state: DEFAULT_STATE };
  const { mode, ceiling, armedLineId, armedLineValue, heldCause } = r;
  // The ceiling the authority grammar takes (review 2418 F5): one outside it could never be moved, so no hold would land.
  if (!isDecisionRowMode(mode) || typeof ceiling !== 'number' || !Number.isSafeInteger(ceiling)
    || ceiling < DECISION_CEILING_MIN || ceiling > DECISION_CEILING_MAX) return { kind: 'unreadable' };
  if ((armedLineId === null) !== (armedLineValue === null)) return { kind: 'unreadable' };
  if (armedLineId !== null && (typeof armedLineId !== 'number' || !Number.isSafeInteger(armedLineId) || armedLineId < 1
    || typeof armedLineValue !== 'number' || !Number.isFinite(armedLineValue) || armedLineValue < 0 || armedLineValue > 1)) {
    return { kind: 'unreadable' };
  }
  if (heldCause !== null && !isDecisionHeldCause(heldCause)) return { kind: 'unreadable' };
  const armedLine = armedLineId === null ? null : { id: Number(armedLineId), line: Number(armedLineValue) };
  return { kind: 'row', state: { mode, ceiling, armedLine, held: heldCause !== null, heldCause: heldCause as DecisionHeldCause | null } };
}

/** How an unreadable row reads outside a door (review 2418 F4, the coordinator's ruling: fail closed). An advice row reads
 *  `off`, so it asks nothing and advises nothing. A gate reads armed and held, so it shuts: its outcome goes to the operator
 *  (`applyDecision` row 2), never the code verdict a disarmed gate would let through. */
export const UNREADABLE_GATE_SIDE: DecisionRowSide = Object.freeze({ ...DECISION_ROW_DEFAULT, mode: 'armed', held: true });

/** The rows of each database whose unreadable episode has been warned about: one line when a row turns unreadable, and again
 *  only after it has read as a row in between (review 2431, a nit: not one line per read). */
const WARNED_UNREADABLE = new WeakMap<DatabaseSync, Set<DecisionRowId>>();

/** The side of a row as the arming reads it outside a door. An unreadable row reads `off` for advice and armed and held (shut)
 *  for a gate, with a warning once per episode, since only a downgrade or a hand edit can make one (`UNREADABLE_GATE_SIDE`). */
export function decisionRowSideOf(db: DatabaseSync, row: DecisionRowId): DecisionRowSide {
  const r = decisionRowRead(db, row);
  let warned = WARNED_UNREADABLE.get(db);
  if (r.kind === 'unreadable') {
    const gate = isDecisionGate(row);
    if (warned === undefined) WARNED_UNREADABLE.set(db, (warned = new Set()));
    if (!warned.has(row)) {
      warned.add(row);
      console.warn(`ccrc-server: decision model: the row ${row} cannot be read; it reads ${gate ? 'armed and held (shut)' : 'off'}, and no door can move it until the row is repaired`);
    }
    return gate ? UNREADABLE_GATE_SIDE : DECISION_ROW_DEFAULT;
  }
  warned?.delete(row);
  const { mode, ceiling, armedLine, held } = r.state;
  return { mode, ceiling, armedLine, held };
}

/** The authority journal's writer, as the move uses it (`overlordAuthorityJournal.ts#OverlordAuthorityJournal.appendInTx`). */
export interface DecisionAuthorityWriter { appendInTx(db: DatabaseSync, entry: OverlordAuthorityMove): AuthorityAppend }

const sameSide = (a: DecisionRowSide, b: DecisionRowSide): boolean => a.mode === b.mode && a.ceiling === b.ceiling && a.held === b.held
  && (a.armedLine === null ? b.armedLine === null : b.armedLine !== null && a.armedLine.id === b.armedLine.id && a.armedLine.line === b.armedLine.line);

/**
 * The ONE writer of `decision_rows`, inside the caller's `tx()`: read the row (an absent one as the default), refuse
 * `row-changed` when it is not `expected`, append one `authority-decision-row` record with `from` set to the row as read, and
 * write the row only on `appended` or `row-only` (`appendInTx`'s decision table: a widening is refused over an incoherent
 * journal, a narrowing always lands). Journal record first, so a listed table's row never stands without its record.
 */
export function moveDecisionRowInTx(db: DatabaseSync, journal: DecisionAuthorityWriter, move: DecisionRowMove): DecisionRowMoved {
  if (!db.isTransaction) throw new Error('moveDecisionRowInTx: only inside the caller\'s tx()');
  const read = decisionRowRead(db, move.row);
  if (read.kind === 'unreadable') return { ok: false, error: 'row-unreadable' };
  const from = read.state;
  if (!sameSide(from, move.expected)) return { ok: false, error: 'row-changed' };
  const to = move.to;
  const cause: DecisionHeldCause | null = !to.held ? null : move.heldCause ?? from.heldCause;
  // Checked before the record: a throw after the append would leave a record with no row (the guard's `trailing`).
  if (to.held && cause === null) throw new Error('moveDecisionRowInTx: a move to held names its cause');
  const fromSide: DecisionRowSide = { mode: from.mode, ceiling: from.ceiling, armedLine: from.armedLine, held: from.held };
  const a = journal.appendInTx(db, { kind: 'authority-decision-row', opKey: move.opKey, row: move.row, gate: isDecisionGate(move.row),
    from: fromSide, to: move.to });
  if (!a.ok) return { ok: false, error: a.error, detail: a.detail };
  // A row that stays held keeps the time it was first held; a row newly held is held from now.
  const was = from.held ? (db.prepare('SELECT heldAt FROM decision_rows WHERE row = ?').get(move.row) as { heldAt: number | null } | undefined) : undefined;
  const heldAt = !to.held ? null : from.held ? (was?.heldAt ?? move.at) : move.at;
  db.prepare(`INSERT INTO decision_rows (row, mode, ceiling, armedLineId, armedLineValue, heldCause, heldAt, updatedAt, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (row) DO UPDATE SET mode = excluded.mode, ceiling = excluded.ceiling, armedLineId = excluded.armedLineId,
    armedLineValue = excluded.armedLineValue, heldCause = excluded.heldCause, heldAt = excluded.heldAt,
    updatedAt = excluded.updatedAt, actor = excluded.actor`)
    .run(move.row, to.mode, to.ceiling, to.armedLine?.id ?? null, to.armedLine?.line ?? null, cause, heldAt, move.at, move.actor);
  return { ok: true, kind: a.kind, state: { ...to, heldCause: cause } };
}

/** The one reader of `decision_host`. Never throws. */
export function decisionHostRead(db: DatabaseSync): DecisionHostRead {
  try {
    const r = db.prepare('SELECT kind, endpoint, origin, modelId, keySetAt, updatedAt, actor FROM decision_host WHERE id = 1').get() as
      Record<string, unknown> | undefined;
    if (r === undefined) return { kind: 'none' };
    if (typeof r['kind'] !== 'string' || !(DECISION_HOST_KINDS as readonly string[]).includes(r['kind'])) return { kind: 'unreadable' };
    return { kind: 'host', host: { kind: r['kind'] as DecisionHostKind, endpoint: String(r['endpoint']), origin: String(r['origin']),
      modelId: String(r['modelId']), keySetAt: r['keySetAt'] === null ? null : Number(r['keySetAt']), updatedAt: Number(r['updatedAt']),
      actor: String(r['actor']) } };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** The ONE writer of `decision_host`, inside the key door's `tx()`. */
export function setDecisionHostInTx(db: DatabaseSync, host: { kind: DecisionHostKind; endpoint: string; origin: string; modelId: string;
  keySetAt: number | null }, actor: string, at: number): void {
  if (!db.isTransaction) throw new Error('setDecisionHostInTx: only inside the caller\'s tx()');
  db.prepare(`INSERT INTO decision_host (id, kind, endpoint, origin, modelId, keySetAt, updatedAt, actor) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, endpoint = excluded.endpoint, origin = excluded.origin,
    modelId = excluded.modelId, keySetAt = excluded.keySetAt, updatedAt = excluded.updatedAt, actor = excluded.actor`)
    .run(host.kind, host.endpoint, host.origin, host.modelId, host.keySetAt, at, actor);
}

/** The ONE writer of a `decision_lines` row: answers the line generation (its id). */
export function admitDecisionLine(db: DatabaseSync, w: DecisionLineWrite): number {
  const r = db.prepare(`INSERT INTO decision_lines (row, revision, hostKind, origin, modelId, line, labelled, errors, bound,
    canaryExpected, baseline, admittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(w.row, w.revision, w.hostKind, w.origin, w.modelId, w.line, w.labelled, w.errors, w.bound, w.canaryExpected,
      JSON.stringify(w.baseline), w.admittedAt);
  return Number(r.lastInsertRowid);
}

/** The ONE writer of a line's canary columns: how many of its full set have been asked, and how many crossed. */
export function recordCanary(db: DatabaseSync, lineId: number, asked: number, crossed: number): void {
  db.prepare('UPDATE decision_lines SET canaryAsked = ?, canaryCrossed = ? WHERE id = ?').run(asked, crossed, lineId);
}

const LINE_COLS = `id, row, revision, hostKind, origin, modelId, line, labelled, errors, bound, canaryExpected, canaryAsked,
  canaryCrossed, baseline, admittedAt`;
const lineOf = (r: Record<string, unknown> | undefined): DecisionLineRow | null => {
  if (r === undefined) return null;
  let baseline: DecisionBand[] = [];
  try {
    const b = JSON.parse(String(r['baseline'])) as unknown;
    if (Array.isArray(b) && b.every((x) => (DECISION_BANDS as readonly unknown[]).includes(x))) baseline = b as DecisionBand[];
  } catch { /* a baseline this build cannot read is no baseline: drift then reads every anchor moved */ }
  return { id: Number(r['id']), row: r['row'] as DecisionRowId, revision: String(r['revision']), hostKind: r['hostKind'] as DecisionHostKind,
    origin: String(r['origin']), modelId: String(r['modelId']), line: Number(r['line']), labelled: Number(r['labelled']),
    errors: Number(r['errors']), bound: Number(r['bound']), canaryExpected: Number(r['canaryExpected']),
    canaryAsked: Number(r['canaryAsked']), canaryCrossed: Number(r['canaryCrossed']), baseline, admittedAt: Number(r['admittedAt']) };
};

/** One line by its generation. */
export function decisionLineById(db: DatabaseSync, id: number): DecisionLineRow | null {
  return lineOf(db.prepare(`SELECT ${LINE_COLS} FROM decision_lines WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
}
/** A row's current line: its newest under this key. */
export function currentDecisionLine(db: DatabaseSync, row: DecisionRowId, key: DecisionLineKey): DecisionLineRow | null {
  return lineOf(db.prepare(`SELECT ${LINE_COLS} FROM decision_lines WHERE row = ? AND hostKind = ? AND origin = ? AND modelId = ?
    AND revision = ? ORDER BY id DESC LIMIT 1`).get(row, key.hostKind, key.origin, key.modelId, key.revision) as Record<string, unknown> | undefined);
}

/** The ONE writer of `decision_days`' anchor columns: the bands the lane read today and whether they drifted. */
export function recordAnchorRun(db: DatabaseSync, row: DecisionRowId, day: string, bands: readonly DecisionBand[], drift: boolean): void {
  db.prepare(`INSERT INTO decision_days (row, day, anchorBands, anchorDrift) VALUES (?, ?, ?, ?)
    ON CONFLICT (row, day) DO UPDATE SET anchorBands = excluded.anchorBands, anchorDrift = excluded.anchorDrift`)
    .run(row, day, JSON.stringify(bands), drift ? 1 : 0);
}

/** M19's read (spec §12): per row since a UTC day, its newest line's costly-error bound, the share of its records answered
 *  `unsure`, its newest line's canary, the time it was unavailable, its calls, and its hold. The report is the measures work's. */
export function decisionMeasures(db: DatabaseSync, sinceDay: string): readonly {
  row: DecisionRowId; bound: number | null; unsureShare: number; canaryCrossed: number; canaryAsked: number; canaryExpected: number;
  unavailableMs: number; calls: { serve: number; maintain: number }; held: string | null;
}[] {
  const since = Date.parse(`${sinceDay}T00:00:00Z`);
  return DECISION_ROW_IDS.map((row) => {
    const line = lineOf(db.prepare(`SELECT ${LINE_COLS} FROM decision_lines WHERE row = ? ORDER BY id DESC LIMIT 1`).get(row) as
      Record<string, unknown> | undefined);
    const rec = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(verdict = 'unsure'), 0) AS u FROM decision_records WHERE row = ? AND at >= ?`)
      .get(row, since) as { n: number; u: number };
    const days = db.prepare(`SELECT COALESCE(SUM(serve), 0) AS serve, COALESCE(SUM(maintain), 0) AS maintain,
      COALESCE(SUM(unavailableMs), 0) AS ms FROM decision_days WHERE row = ? AND day >= ?`).get(row, sinceDay) as
      { serve: number; maintain: number; ms: number };
    const r = decisionRowRead(db, row);
    const held = r.kind === 'unreadable' ? 'unreadable' : r.state.heldCause;
    return { row, bound: line?.bound ?? null, unsureShare: Number(rec.n) === 0 ? 0 : Number(rec.u) / Number(rec.n),
      canaryCrossed: line?.canaryCrossed ?? 0, canaryAsked: line?.canaryAsked ?? 0, canaryExpected: line?.canaryExpected ?? 0,
      unavailableMs: Number(days.ms), calls: { serve: Number(days.serve), maintain: Number(days.maintain) }, held };
  });
}

/** The arming store the doors and the lane use (`decisionModelPort.ts#DecisionArmingStore`), over coord.db and the authority
 *  journal's writer: the one place their transactions open, so no L4 file holds the handle. */
export function decisionArmingStore(db: DatabaseSync, journal: DecisionAuthorityWriter): DecisionArmingStore {
  const reads = {
    rowRead: (row: DecisionRowId) => decisionRowRead(db, row),
    rowSide: (row: DecisionRowId) => decisionRowSideOf(db, row),
    hostRead: () => decisionHostRead(db),
    lineById: (id: number) => decisionLineById(db, id),
    currentLine: (row: DecisionRowId, key: DecisionLineKey) => currentDecisionLine(db, row, key),
    usage: (row: DecisionRowId, day: string, ceiling: number) => decisionUsage(db, row, day, ceiling),
  };
  const inTx: DecisionArmingTx = {
    ...reads,
    move: (m: DecisionRowMove) => moveDecisionRowInTx(db, journal, m),
    setHost: (host, actor, at) => setDecisionHostInTx(db, host, actor, at),
  };
  return {
    ...reads,
    inTx: (fn) => tx(db, () => fn(inTx)),
    move: (m) => tx(db, () => moveDecisionRowInTx(db, journal, m)),
    admitLine: (w) => admitDecisionLine(db, w),
    recordCanary: (lineId, asked, crossed) => recordCanary(db, lineId, asked, crossed),
    recordAnchorRun: (row, day, bands, drift) => recordAnchorRun(db, row, day, bands, drift),
  };
}
