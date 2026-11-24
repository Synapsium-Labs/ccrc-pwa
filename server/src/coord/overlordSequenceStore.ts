// The one sequence's tables, its one writer, its pruner and its reads (Overlord spec §10.4 "One sequence" and "The sequence has
// one home", Table 11.1a's row `overlord_sequence`, Table 11.5b's 90 days; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Tasks 1 and 3). Ring L3, context C5. TWO tables (one
// migration): `overlord_sequence`, one line per stamped change, and `overlord_sequence_pruned`, one row holding the highest seq
// any prune deleted (absent: nothing was ever pruned).
//
// ONE WRITER PER FACT: `stampSequenceInTx` is the only inserter of a line, called INSIDE the transaction that writes the stamped
// row, so a line and its row commit or roll back together. Inbox acknowledgement is the one exception (plan question 17):
// the private store commits before its sequence line is written in a coordination transaction. `pruneSequenceThrough` is the
// only deleter and floor writer. The stamped writers are named in `server/test/sequence-stamp-census.test.ts`.
//
// LEGITIMATELY DIFFERENT from `feed_events` (§10.4 "Why not `feed_events`"): that table is pruned to 2,000 rows, carries titles
// and bodies, and older builds read its `kind`. This one carries ids, kinds, states and actors only, is kept 90 days, and is
// read by a cursor that answers a gap explicitly.
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './tx.js';
import { ACTOR_KIND_MAP, type ActorKind } from '../../../shared/overlord-identity.js';
import type { SequenceKind, SequenceWireLine } from '../../../shared/overlord-sequence.js';
import { LINE_REFUSALS, SEQUENCE_KEPT_KIND, sequenceLineKnown, sequenceLineVerdict, type LineRefusal, type SequenceFacts } from './overlordSequence.js';

/** The stamp's answer. It never throws: every caller checks it and writes no row on a refusal (by throwing inside its own
 *  transaction, so the row rolls back with the line). */
export type StampAnswer =
  | { readonly ok: true; readonly seq: number }
  | { readonly ok: false; readonly error: StampFailure | LineRefusal; readonly detail: string };

/** The writer's own two failures, beside the verdict's refusals: outside a transaction, and an insert that failed. */
export const STAMP_FAILURES = ['not-in-transaction', 'write-failed'] as const;
export type StampFailure = (typeof STAMP_FAILURES)[number];

/** Whether `tok` is one of the stamp's answer words. Each is a stamped writer's internal answer, logged or thrown, never a mail
 *  or run refusal; `mail-routes.test.ts`'s kebab scan admits them through this guard. */
export const isSequenceStampKebab = (tok: string): boolean =>
  (STAMP_FAILURES as readonly string[]).includes(tok) || (LINE_REFUSALS as readonly string[]).includes(tok);

/** One line to stamp. `at` is the time the stamped writer already takes, so a line never reads a clock of its own. */
export interface SequenceLineInput {
  readonly kind: SequenceKind; readonly id: string; readonly state: string; readonly actor: string;
  readonly actorKind: ActorKind; readonly at: number;
}

/** A read of the sequence: measured, or why it could not be read. */
export type SequenceRead<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** THE one writer of `overlord_sequence` lines. Inside the caller's `tx()`, never outside (`not-in-transaction`), and it never
 *  throws: a line the verdict refuses answers its word, and a failed insert answers `write-failed`. */
export function stampSequenceInTx(db: DatabaseSync, line: SequenceLineInput): StampAnswer {
  let inTx: boolean;
  try { inTx = db.isTransaction; } catch { inTx = false; }
  if (!inTx) return { ok: false, error: 'not-in-transaction', detail: 'a sequence line is stamped only inside the transaction that writes its row' };
  const v = sequenceLineVerdict(line);
  if (!v.ok) return { ok: false, error: v.refusal, detail: `${line.kind} ${line.id} -> ${line.state}` };
  try {
    const r = db.prepare('INSERT INTO overlord_sequence (kind, id, state, actor, actorKind, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(line.kind, line.id, line.state, line.actor, line.actorKind, line.at);
    return { ok: true, seq: Number(r.lastInsertRowid) };
  } catch (e) {
    return { ok: false, error: 'write-failed', detail: errText(e) };
  }
}

/** The Inbox's text-free line, stamped only after its private settlement commits. A refusal rolls back this transaction only. */
export function stampInboxAcknowledgement(db: DatabaseSync, id: number, at: number): StampAnswer {
  const refused: { answer?: Extract<StampAnswer, { ok: false }> } = {};
  try {
    return tx(db, () => {
      const s = stampSequenceInTx(db, { kind: 'message', id: String(id), state: 'settled', actor: 'acknowledge', actorKind: 'server', at });
      if (!s.ok) { refused.answer = s; throw new Error(s.detail); }
      return s;
    });
  } catch (e) {
    return refused.answer ?? { ok: false, error: 'write-failed', detail: errText(e) };
  }
}

/** The columns the cursor read serves, by name, never `*`: a later column (W3's drill mark) is never served by accident. */
const SERVED_COLUMNS = 'seq, kind, id, state, actor, actorKind, at';

const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v));

/** One stored line as served: a line this build cannot name keeps its stored text and reads `known: false`. */
function servedLine(r: Record<string, unknown>): SequenceWireLine {
  const kind = text(r['kind']); const state = text(r['state']); const actorKind = text(r['actorKind']);
  return {
    seq: num(r['seq']), at: num(r['at']), kind, id: text(r['id']), state, actor: text(r['actor']),
    actorKind: Object.hasOwn(ACTOR_KIND_MAP, actorKind) ? (actorKind as ActorKind) : 'unknown',
    known: sequenceLineKnown(kind, state, actorKind),
  };
}

/** The highest seq ever issued (AUTOINCREMENT's own record, so a prune that empties the table never restarts the numbers),
 *  and the recorded floor. */
function factsOf(db: DatabaseSync): SequenceFacts {
  const h = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'overlord_sequence'").get() as { seq: unknown } | undefined;
  const p = db.prepare('SELECT through FROM overlord_sequence_pruned WHERE one = 1').get() as { through: unknown } | undefined;
  return { head: h === undefined ? 0 : num(h.seq), prunedThrough: p === undefined ? null : num(p.through) };
}

/** The lines above `after`, at most `limit`, with the facts, in one synchronous read (`DatabaseSync` yields nothing between
 *  its statements, and this process is the database's one writer). A line it cannot name comes back `known: false` with its
 *  stored text; `unmeasured` only on a database it cannot read, and never a partial page. */
export function sequenceAfter(db: DatabaseSync, after: number, limit: number):
  SequenceRead<{ facts: SequenceFacts; lines: readonly SequenceWireLine[] }> {
  try {
    const facts = factsOf(db);
    const rows = db.prepare(`SELECT ${SERVED_COLUMNS} FROM overlord_sequence WHERE seq > ? ORDER BY seq LIMIT ?`)
      .all(after, Math.max(0, Math.trunc(limit))) as Record<string, unknown>[];
    return { kind: 'measured', value: { facts, lines: rows.map(servedLine) } };
  } catch (e) {
    return { kind: 'unmeasured', why: `the sequence could not be read: ${errText(e)}` };
  }
}

/** The oldest `limit` lines in seq order, each marked `keep` when it is the newest line of `SEQUENCE_KEPT_KIND`. */
export function sequenceOldest(db: DatabaseSync, limit: number): SequenceRead<readonly { seq: number; at: number; keep: boolean }[]> {
  try {
    const kept = db.prepare('SELECT max(seq) AS seq FROM overlord_sequence WHERE kind = ?').get(SEQUENCE_KEPT_KIND) as { seq: unknown } | undefined;
    const keptSeq = kept === undefined || kept.seq === null ? null : num(kept.seq);
    const rows = db.prepare('SELECT seq, at FROM overlord_sequence ORDER BY seq LIMIT ?').all(Math.max(0, Math.trunc(limit))) as Record<string, unknown>[];
    return { kind: 'measured', value: rows.map((r) => ({ seq: num(r['seq']), at: num(r['at']), keep: num(r['seq']) === keptSeq })) };
  } catch (e) {
    return { kind: 'unmeasured', why: `the sequence could not be read: ${errText(e)}` };
  }
}

/** THE prune, and the one writer of the floor: in one transaction, deletes every line with seq <= `through` except `keep`, and
 *  raises the floor to `through` (never lowers it). It never throws. */
export function pruneSequenceThrough(db: DatabaseSync, through: number, keep: readonly number[]): { pruned: number } | { error: string } {
  if (!Number.isSafeInteger(through) || through < 1) return { error: `a prune floor is a positive integer, not ${String(through)}` };
  try {
    return tx(db, () => {
      const d = db.prepare('DELETE FROM overlord_sequence WHERE seq <= ? AND seq NOT IN (SELECT value FROM json_each(?))')
        .run(through, JSON.stringify(keep));
      db.prepare('INSERT INTO overlord_sequence_pruned (one, through) VALUES (1, ?) '
        + 'ON CONFLICT(one) DO UPDATE SET through = excluded.through WHERE excluded.through > overlord_sequence_pruned.through').run(through);
      return { pruned: Number(d.changes) };
    });
  } catch (e) {
    return { error: `the sequence could not be pruned: ${errText(e)}` };
  }
}
