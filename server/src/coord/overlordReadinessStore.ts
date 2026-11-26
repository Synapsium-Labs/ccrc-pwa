// The readiness word's rows (Overlord spec §6.4, §10.4, H20; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-readiness.md` Task 2). L3 adapter, context C5. THE one writer of `overlord_readiness` (a row per change of word, its
// `overlord_sequence` line and, on an episode's first `dead` row, its `pushedAt`, all in one transaction) and of
// `overlord_readiness_items` (which operator item the lane raised for which cause, and how it ended), called by the readiness
// lane alone. Its readers: `readinessNow` (the current word, `readySince`, `leftReadyAt`, the episode's first row and its push
// mark), `readinessChanges` (the chat's window, with `oldest`), `openReadinessItems` (each record joined to its item's own
// state), and the guarded prune. Nothing here decides a word: `overlordReadiness.ts` (L1) does, and this file records it.
//
// WRITERS (the census names them): `overlord_readiness` is written by `recordReadinessInTx` (insert and in-place update) and
// `pruneReadiness` (delete); `overlord_readiness_items` by `raiseReadinessItem` (insert, with its item in one
// transaction), `settleReadinessItem` (the lane's settle: the item's move and the record's stamp, one transaction) and
// `closeReadinessItem` (the operator's move, the record alone). `operator_items` is never written here but through the ledger's
// checked entries, `raiseItemCheckedInTx` and `settleItemCheckedInTx`.
import type { DatabaseSync } from 'node:sqlite';
import {
  isReadinessWord, isStrandCause, READINESS_ITEM_KINDS, type ReadinessItemKind, type ReadinessItemText,
} from '../../../shared/overlord-readiness.js';
import { OVERLORD_ITEM_PROGRAMME } from '../../../shared/overlord-sequence.js';
import { ITEM_STATES, type ItemState, type NeededBy } from '../../../shared/ledgers.js';
import { stampSequenceInTx, type SequenceLineInput } from './overlordSequenceStore.js';
import { raiseItemCheckedInTx, settleItemCheckedInTx } from './ledgersStore.js';
import { tx } from './tx.js';
import type { ReadinessAnswer, ReadinessItemRecord, ReadinessNowRow } from './overlordReadiness.js';

/** One stored change of word, as `readinessChanges` serves it. */
export interface ReadinessRow {
  readonly id: number; readonly sessionId: string | null; readonly word: ReadinessNowRow['word']; readonly why: string | null;
  readonly until: number | null; readonly strandCause: ReadinessNowRow['strandCause']; readonly restartable: boolean;
  readonly at: number; readonly seq: number | null; readonly pushedAt: number | null;
}
export type ReadinessRecordAnswer =
  | { readonly ok: true; readonly changed: boolean; readonly rowId: number | null; readonly episodeFirst: boolean }
  | { readonly ok: false; readonly why: 'word' | 'stamp' | 'write' };
export type ReadinessWrite = ReadinessAnswer & { readonly sessionId: string | null };

/** The sequence line's id when no session is bound (`absent`). */
export const READINESS_NO_SESSION = 'none';

class ReadinessStampRefused extends Error {}

/** The readiness kind's one stamp helper: the line or a throw that rolls the caller's transaction back. */
function stampReadinessLine(db: DatabaseSync, line: SequenceLineInput): number {
  const s = stampSequenceInTx(db, line);
  if (!s.ok) throw new ReadinessStampRefused(`readiness line refused: ${s.error}: ${s.detail}`);
  return s.seq;
}

const COLS = 'id, sessionId, word, why, untilAt, strandCause, restartable, at, seq, pushedAt';
type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

function rowOf(r: Raw): ReadinessRow | string {
  const id = num(r.id); const at = num(r.at);
  if (id === null || at === null) return 'id or at unreadable';
  if (!isReadinessWord(r.word)) return `word ${String(r.word)} is not a readiness word this build knows`;
  if (r.strandCause !== null && !isStrandCause(r.strandCause)) return 'strandCause unreadable';
  return {
    id, sessionId: typeof r.sessionId === 'string' ? r.sessionId : null, word: r.word, why: typeof r.why === 'string' ? r.why : null,
    until: num(r.untilAt), strandCause: r.strandCause === null ? null : r.strandCause, restartable: r.restartable === 1,
    at, seq: num(r.seq), pushedAt: num(r.pushedAt),
  };
}

/** The id of the newest row that breaks `sessionId`'s dead episode: any word but `dead` or `unmeasured`, or a `dead` word of
 *  another session (a rebind starts a new episode); 0 when none does. */
function episodeBreakId(db: DatabaseSync, sessionId: string | null): number {
  const r = db.prepare("SELECT max(id) AS id FROM overlord_readiness WHERE word NOT IN ('dead', 'unmeasured') "
    + "OR (word = 'dead' AND sessionId IS NOT ?)").get(sessionId) as { id: number | null };
  return r.id ?? 0;
}
/** The first `dead` row of `sessionId`'s open episode, or undefined. */
function episodeFirstRow(db: DatabaseSync, sessionId: string | null): Raw | undefined {
  return db.prepare(`SELECT ${COLS} FROM overlord_readiness WHERE word = 'dead' AND sessionId IS ? AND id > ? ORDER BY id LIMIT 1`)
    .get(sessionId, episodeBreakId(db, sessionId)) as Raw | undefined;
}

/** The one writer of a change of word, inside the caller's transaction: the row, its sequence line and, on an episode's first
 *  `dead` row, `pushedAt`. The same word for the same session with changed detail (`why`, `untilAt`, `strandCause`,
 *  `restartable`) updates the newest row in place, with no new row and no stamp (F16). An identical answer writes nothing. An
 *  out-of-vocabulary word is refused before any write. A refused stamp or a failed insert throws, so the caller's transaction
 *  rolls back whole. */
export function recordReadinessInTx(db: DatabaseSync, a: ReadinessWrite, at: number): ReadinessRecordAnswer {
  if (!isReadinessWord(a.word)) return { ok: false, why: 'word' };
  const newest = db.prepare(`SELECT ${COLS} FROM overlord_readiness ORDER BY id DESC LIMIT 1`).get() as Raw | undefined;
  const restartable = a.restartable ? 1 : 0;
  if (newest !== undefined && newest.word === a.word && (newest.sessionId ?? null) === a.sessionId) {
    const same = (newest.why ?? null) === a.why && (newest.untilAt ?? null) === a.until && (newest.strandCause ?? null) === a.strandCause
      && newest.restartable === restartable;
    const id = Number(newest.id);
    if (same) return { ok: true, changed: false, rowId: id, episodeFirst: false };
    db.prepare('UPDATE overlord_readiness SET why = ?, untilAt = ?, strandCause = ?, restartable = ? WHERE id = ?')
      .run(a.why, a.until, a.strandCause, restartable, id);
    return { ok: true, changed: true, rowId: id, episodeFirst: false };
  }
  const episodeFirst = a.word === 'dead' && episodeFirstRow(db, a.sessionId) === undefined;
  const seq = stampReadinessLine(db, { kind: 'readiness', id: a.sessionId ?? READINESS_NO_SESSION, state: a.word, actor: 'server', actorKind: 'server', at });
  const r = db.prepare('INSERT INTO overlord_readiness (sessionId, word, why, untilAt, strandCause, restartable, at, seq, pushedAt) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(a.sessionId, a.word, a.why, a.until, a.strandCause, restartable, at, seq, episodeFirst ? at : null);
  return { ok: true, changed: true, rowId: Number(r.lastInsertRowid), episodeFirst };
}

/** `recordReadinessInTx` in a transaction of its own: a refused stamp answers `stamp` and a failed write `write`, each with
 *  nothing written. */
export function recordReadiness(db: DatabaseSync, a: ReadinessWrite, at: number): ReadinessRecordAnswer {
  try {
    return tx(db, () => recordReadinessInTx(db, a, at));
  } catch (e) {
    return { ok: false, why: e instanceof ReadinessStampRefused ? 'stamp' : 'write' };
  }
}

/** The one reader of the current word: the newest row, `readySince` (the newest `ready` row's `at`) with that row's session
 *  (`readySessionId`, so the decider keeps the ready clock to the current binding, F10), `leftReadyAt` (the `at` of
 *  the first row after the newest `ready` row), and, while the word is `dead`, its episode's first row id and `pushedAt`; `none`
 *  before the first pass. */
export function readinessNow(db: DatabaseSync): { ok: true; now: ReadinessNowRow | 'none' } | { ok: false; detail: string } {
  try {
    const raw = db.prepare(`SELECT ${COLS} FROM overlord_readiness ORDER BY id DESC LIMIT 1`).get() as Raw | undefined;
    if (raw === undefined) return { ok: true, now: 'none' };
    const row = rowOf(raw);
    if (typeof row === 'string') return { ok: false, detail: `overlord_readiness row ${String(raw.id)}: ${row}` };
    const ready = db.prepare("SELECT id, at, sessionId FROM overlord_readiness WHERE word = 'ready' ORDER BY id DESC LIMIT 1").get() as { id: number; at: number; sessionId: string | null } | undefined;
    const left = ready === undefined ? undefined
      : db.prepare('SELECT at FROM overlord_readiness WHERE id > ? ORDER BY id LIMIT 1').get(ready.id) as { at: number } | undefined;
    const first = row.word === 'dead' ? episodeFirstRow(db, row.sessionId) : undefined;
    return {
      ok: true,
      now: {
        id: row.id, sessionId: row.sessionId, word: row.word, why: row.why, until: row.until, strandCause: row.strandCause,
        restartable: row.restartable, at: row.at, readySince: ready?.at ?? null, readySessionId: ready?.sessionId ?? null,
        leftReadyAt: left?.at ?? null,
        episodeFirstId: first === undefined ? null : Number(first.id), pushedAt: first === undefined ? null : num(first.pushedAt),
      },
    };
  } catch (e) {
    return { ok: false, detail: `overlord_readiness read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The changes in [sinceMs, untilMs), oldest first, with `oldest`, the `at` of the oldest row the table keeps (F19). */
export function readinessChanges(db: DatabaseSync, sinceMs: number, untilMs: number):
  { ok: true; rows: ReadinessRow[]; oldest: number | null } | { ok: false; detail: string } {
  try {
    const raws = db.prepare(`SELECT ${COLS} FROM overlord_readiness WHERE at >= ? AND at < ? ORDER BY id`).all(sinceMs, untilMs) as Raw[];
    const rows: ReadinessRow[] = [];
    for (const raw of raws) {
      const r = rowOf(raw);
      if (typeof r === 'string') return { ok: false, detail: `overlord_readiness row ${String(raw.id)}: ${r}` };
      rows.push(r);
    }
    const oldest = db.prepare('SELECT min(at) AS at FROM overlord_readiness').get() as { at: number | null };
    return { ok: true, rows, oldest: oldest.at };
  } catch (e) {
    return { ok: false, detail: `overlord_readiness read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The item states this build knows: the ledger's own list (`shared/ledgers.ts#ITEM_STATES`), never a copy (F5). */
const ITEM_STATES_KNOWN: ReadonlySet<string> = new Set(ITEM_STATES);

/** The open records (not yet settled or closed), each joined to its item's own state; `missing` when the item row is gone. */
export function openReadinessItems(db: DatabaseSync): { ok: true; rows: ReadinessItemRecord[] } | { ok: false; detail: string } {
  try {
    const raws = db.prepare('SELECT r.id AS id, r.item AS item, r.key AS key, r.itemId AS itemId, r.raisedAt AS raisedAt, i.state AS state '
      + 'FROM overlord_readiness_items r LEFT JOIN operator_items i ON i.id = r.itemId WHERE r.settledAt IS NULL ORDER BY r.id').all() as Raw[];
    const rows: ReadinessItemRecord[] = [];
    for (const r of raws) {
      if (!(READINESS_ITEM_KINDS as readonly unknown[]).includes(r.item)) return { ok: false, detail: `overlord_readiness_items row ${String(r.id)}: item unreadable` };
      const state = r.state === null ? 'missing' : ITEM_STATES_KNOWN.has(String(r.state)) ? (r.state as ItemState) : null;
      if (state === null) return { ok: false, detail: `overlord_readiness_items row ${String(r.id)}: item state unreadable` };
      rows.push({ id: Number(r.id), item: r.item as ReadinessItemKind, key: String(r.key), itemId: Number(r.itemId), raisedAt: Number(r.raisedAt), itemState: state });
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, detail: `overlord_readiness_items read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** How soon each kind of item is needed. The stranded item is `soon` with no label, as the plan's question 9 and C56 say, so it
 *  pushes nothing: in W1 nothing waits on the Overlord, and the one push of this piece is the dead push, once per episode. The
 *  count item (one account short of a spare) and a held account stand beside a running Overlord, so they wait: `later` (slug
 *  readiness-item-levels). No item here is `blocking`, so none takes a push-outbox reach. */
const NEEDED_BY_OF_ITEM: Readonly<Record<ReadinessItemKind, NeededBy>> = { stranded: 'soon', count: 'later', hold: 'later' };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The item for (item, key) and its record, in ONE transaction: `raiseItemCheckedInTx` (programme `OVERLORD_ITEM_PROGRAMME`,
 *  raised by `ccrc`, kind `do`), then the record. A second open record for the same (item, key) is refused by the partial unique index, and a refused raise
 *  or record rolls both back: nothing is written. Never throws. */
export function raiseReadinessItem(
  db: DatabaseSync, r: { readonly item: ReadinessItemKind; readonly key: string; readonly text: ReadinessItemText }, at: number,
): { ok: true; recordId: number; itemId: number } | { ok: false; error: string } {
  const neededBy = NEEDED_BY_OF_ITEM[r.item];
  try {
    return tx(db, () => {
      const how = [...r.text.how];
      const itemId = raiseItemCheckedInTx(db, {
        program: OVERLORD_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do', title: r.text.title, why: r.text.why, how,
        options: null, neededBy, soonLabel: null, secretSlot: null,
      }, at, 'ccrc');
      const res = db.prepare('INSERT INTO overlord_readiness_items (item, key, itemId, raisedAt) VALUES (?, ?, ?, ?)')
        .run(r.item, r.key, itemId, at);
      return { ok: true as const, recordId: Number(res.lastInsertRowid), itemId };
    });
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** The lane's settle, in ONE transaction: the open record's item moves `settle` by `ccrc` (`settleItemCheckedInTx`), and only
 *  on that move does the record take `settledAt` and `closedBy: 'lane'`. No open record answers `settled: false`. A refused move
 *  (the operator dismissed the item, or it is done) writes nothing and answers `settled: false`; the next pass's reconcile
 *  closes the record as the operator's. Never throws. */
export function settleReadinessItem(db: DatabaseSync, recordId: number, note: string, at: number):
  { ok: true; settled: boolean } | { ok: false; error: string } {
  try {
    return tx(db, () => {
      const rec = db.prepare('SELECT itemId FROM overlord_readiness_items WHERE id = ? AND settledAt IS NULL').get(recordId) as { itemId: number } | undefined;
      if (rec === undefined) return { ok: true as const, settled: false };
      if (!settleItemCheckedInTx(db, Number(rec.itemId), note, at).ok) return { ok: true as const, settled: false };
      db.prepare("UPDATE overlord_readiness_items SET settledAt = ?, closedBy = 'lane' WHERE id = ? AND settledAt IS NULL").run(at, recordId);
      return { ok: true as const, settled: true };
    });
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** Close a record whose item the operator moved away (F8): stamped `closedBy: 'operator'`, no item move. Once only. */
export function closeReadinessItem(db: DatabaseSync, recordId: number, at: number): { changed: boolean } {
  const r = db.prepare("UPDATE overlord_readiness_items SET settledAt = ?, closedBy = 'operator' WHERE id = ? AND settledAt IS NULL").run(at, recordId);
  return { changed: Number(r.changes) === 1 };
}

/** The first row of the open dead episode, by the episode's own break rule, whatever word the newest row holds (F9): the newest
 *  row that is not `unmeasured` is `dead`, so the episode is open across a boot's `unmeasured` row; undefined otherwise. */
function openEpisodeFirstId(db: DatabaseSync): number | undefined {
  const last = db.prepare("SELECT word, sessionId FROM overlord_readiness WHERE word <> 'unmeasured' ORDER BY id DESC LIMIT 1").get() as Raw | undefined;
  if (last === undefined || last.word !== 'dead') return undefined;
  const first = episodeFirstRow(db, typeof last.sessionId === 'string' ? last.sessionId : null);
  return first === undefined ? undefined : Number(first.id);
}

/** Remove rows before `beforeMs`, never the newest row, the newest `ready` row, or an open episode's first row (F17, F9). */
export function pruneReadiness(db: DatabaseSync, beforeMs: number): { removed: number } {
  return tx(db, () => {
    const now = readinessNow(db);
    if (!now.ok || now.now === 'none') return { removed: 0 };
    const keep = [now.now.id, openEpisodeFirstId(db) ?? now.now.id];
    const ready = db.prepare("SELECT max(id) AS id FROM overlord_readiness WHERE word = 'ready'").get() as { id: number | null };
    if (ready.id !== null) keep.push(ready.id);
    const r = db.prepare(`DELETE FROM overlord_readiness WHERE at < ? AND id NOT IN (${keep.map(() => '?').join(', ')})`).run(beforeMs, ...keep);
    return { removed: Number(r.changes) };
  });
}
