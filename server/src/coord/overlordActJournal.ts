// The Overlord act journal's writer, its head row and its torn-tail heal (Overlord spec §7.6 H27; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-journal.md` Task A2, Table 2). Ring L3, context C5: the one owner of the
// act journal file (`~/.ccrc/overlord-acts.jsonl`, through the shared file adapter) and of the singleton `overlord_act_journal_head`.
// It implements act rows A's `ActJournalPort`: one instance per server process, the file's one writer.
//
// DECIDE, APPEND, APPLY, in the authority journal's order (`journalKernel.ts#appendThenApply`), inside the store's transaction:
// the guard and the file against the head row decide; then each record is appended and fsynced, in order; then the head row
// moves to the last of them; then the caller's apply writes the act row and its line. The commit follows. So the file is never
// behind `coord.db`. A failure at or after the first append, a throw from the apply included, answers `journal-append` and tells
// the guard `trailing` at once (F12): the record may stand with no row. WHAT A CRASH BETWEEN THEM LEAVES: a record (or two) past
// the head row, and no act row, since the transaction never committed. Nothing reads it as an act; the next boot's coherence reads
// `trailing` and Confirm the restore adopts the file's verified head (act journal B, F3). A torn partial line the crash left is
// cut aside at the next boot by `healTornTail`, only when the complete records verify and the head row equals the last of them.
//
// THE DECISION IS THE AUTHORITY JOURNAL'S TABLE 7.6a (`authorityCoherence`, generic over the entry), over the act journal's head
// row and whether `overlord_acts` holds a row; and each `act-settle`'s `from` is held against the fold's last record for its act.
// Unlike the authority journal no act is a narrowing, so nothing is written row-only: an act over an incoherent journal is refused.
//
// IDS AND WORDS ONLY in what this writes and answers: a detail names a verdict word or a count, never a record's field.
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../time/ports.js';
import { appendThenApply, type JournalPhase } from '../journalKernel.js';
import type { ChainedJournalRecord, ChainedPosition } from '../chainedJournal.js';
import { chainedJournalFileAt, type ChainedCutError, type ChainedJournalFile } from '../chainedJournalFile.js';
import type { AppendOnlyFsOps } from '../appendOnlyFile.js';
import {
  authorityCoherence, authorityTailHeal, type AuthorityFileSeen, type AuthorityRowsSeen, type CoherenceVerdict,
} from './overlordAuthorityCoherence.js';
import type { AuthorityGuardPort, AuthorityWriterFailure } from './overlordAuthorityJournal.js';
import {
  OVERLORD_ACTS_BASENAME, OVERLORD_ACTS_FORMAT, OVERLORD_ACTS_TORN_DIR, actJournalFold, actJournalHighest, actRecordEntry,
  canonicalActRecord, type ActJournalAppend, type ActJournalHighest, type ActJournalPort, type ActJournalView, type OverlordActRecord,
} from './overlordActRecords.js';

/** The file, bound once (the callers census's one binder of this journal). */
export function overlordActsFileAt(ccrcDir: string, ops?: AppendOnlyFsOps): ChainedJournalFile<OverlordActRecord> {
  return chainedJournalFileAt(OVERLORD_ACTS_FORMAT, ccrcDir, OVERLORD_ACTS_BASENAME, ops);
}

/** The whole file, verified, as boot coherence and the head read take it. */
export type ActFileRead = AuthorityFileSeen<OverlordActRecord>;

/** The tables whose rows say an act was written: a row here with no journal record reads `missing`. */
export const ACT_JOURNAL_ROW_TABLES: readonly string[] = ['overlord_acts'];

/** What the torn-tail heal did. */
export type ActHeal =
  | { readonly kind: 'no-tail' } | { readonly kind: 'healed'; readonly name: string } | { readonly kind: 'not-healable' }
  | { readonly kind: 'unmeasured' } | { readonly kind: 'cut-failed'; readonly error: ChainedCutError; readonly mayApply: boolean };

/** The success answer, in one place: the store's port answers `{ ok: true }` today; a sequence number is one line here. */
const appendedOk = (_last: ChainedJournalRecord<OverlordActRecord>): ActJournalAppend => ({ ok: true });

const HEAD_READ = 'SELECT sequence, journalId, digest FROM overlord_act_journal_head WHERE id = 1';
const HEX64 = /^[0-9a-f]{64}$/;

/** The head row's writer in PR A: `appendInTx`'s step after the last append, in the caller's transaction. It never touches
 *  `requestFloor`, which only Confirm's adopt writes (act journal B). */
function writeActHeadRow(db: DatabaseSync, rec: ChainedJournalRecord<OverlordActRecord>): void {
  db.prepare(`INSERT INTO overlord_act_journal_head (id, sequence, journalId, digest, at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, journalId = excluded.journalId, digest = excluded.digest,
    at = excluded.at`).run(rec.sequence, rec.journalId, rec.digest, Date.parse(rec.acceptedAt));
}

/** The state an act stands in, as the journal's last record for it says: `pending` after an intent, a settle's `to` after it. */
const stateOf = (held: NonNullable<ReturnType<ActJournalView['acts']['get']>>): string =>
  held.last.kind === 'act-intent' ? 'pending' : held.last.to;

/** Whether an `act-settle`'s stated `from` is what the journal says: `null` for an act it holds no record of; otherwise the last
 *  record's state. Two records of one append are judged in order, the first counted for the second. */
function fromHolds(view: ActJournalView, records: readonly OverlordActRecord[]): boolean {
  const seen = new Map<number, string>();
  for (const r of records) {
    if (r.kind === 'act-open-request') continue;
    const prior = seen.get(r.actId) ?? (view.acts.has(r.actId) ? stateOf(view.acts.get(r.actId)!) : null);
    if (r.kind === 'act-settle' && r.from !== prior) return false;
    if (r.kind === 'act-intent' && prior !== null) return false;
    seen.set(r.actId, r.kind === 'act-intent' ? 'pending' : r.to);
  }
  return true;
}

/** Why the append step stopped, carried out of the kernel by a throw it rethrows unchanged. */
class Halt { constructor(readonly answer: ActJournalAppend) {} }

export class OverlordActJournal implements ActJournalPort {
  constructor(
    private readonly file: ChainedJournalFile<OverlordActRecord>,
    private readonly time: { clock: Clock },
    private readonly guard: AuthorityGuardPort,
  ) {}

  /** The whole file, verified: a fresh read, holding no snapshot. */
  readVerified(): ActFileRead {
    const r = this.file.read();
    return r.kind === 'unmeasured' ? { kind: 'unmeasured', why: 'unreadable' } : r;
  }

  /** The journal's highest act and request ids, three answers (`actJournalHighest`): the store passes `act` on every write. */
  readHighest(): ActJournalHighest {
    return actJournalHighest(this.file.read());
  }

  /** The head row, and whether `overlord_acts` holds a row; `unmeasured` when either cannot be read, or the head row holds a
   *  value no writer of it would write. */
  readHeadRow(db: DatabaseSync): AuthorityRowsSeen {
    try {
      const row = db.prepare(HEAD_READ).get() as { sequence: unknown; journalId: unknown; digest: unknown } | undefined;
      let head: ChainedPosition | null = null;
      if (row !== undefined) {
        const { sequence, journalId, digest } = row;
        if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1
          || typeof journalId !== 'string' || !HEX64.test(journalId) || typeof digest !== 'string' || !HEX64.test(digest)) {
          return { kind: 'unmeasured' };
        }
        head = { sequence, journalId, digest };
      }
      const anyAuthorityRow = ACT_JOURNAL_ROW_TABLES.some((t) => db.prepare(`SELECT 1 FROM "${t}" LIMIT 1`).get() !== undefined);
      return { kind: 'measured', head, anyAuthorityRow };
    } catch {
      return { kind: 'unmeasured' };
    }
  }

  /** Table 7.6a over the act journal and its head row as they stand now (act journal B's boot arm reads it). */
  measure(db: DatabaseSync): CoherenceVerdict {
    return authorityCoherence(this.readVerified(), this.readHeadRow(db));
  }

  /** The torn-tail heal, at boot: when the file ends in a tail the kernel's rule takes (the complete records verify and the head
   *  row equals the last of them), keep its bytes in `~/.ccrc/overlord-acts-torn/` and cut, through the adapter's one cut. Any
   *  other tail is left for coherence to read `malformed`. */
  healTornTail(db: DatabaseSync): ActHeal {
    const file = this.readVerified();
    if (file.kind === 'unmeasured') return { kind: 'unmeasured' };
    if (file.kind !== 'records' || file.tail === null) return { kind: 'no-tail' };
    const rows = this.readHeadRow(db);
    if (rows.kind === 'unmeasured') return { kind: 'unmeasured' };
    const plan = authorityTailHeal(file, rows);
    if (plan === null) return { kind: 'not-healable' };
    const cut = this.file.cutAside({ kind: 'tail', plan }, OVERLORD_ACTS_TORN_DIR);
    return cut.ok ? { kind: 'healed', name: plan.name } : { kind: 'cut-failed', error: cut.error, mayApply: cut.mayApply };
  }

  /**
   * Table 2, first match, inside the caller's `tx()`, never outside, and it never throws:
   *
   * | # | the guard | the file against the head row | answer |
   * |---|---|---|---|
   * | 1 | not in a transaction | any | not-in-transaction |
   * | 2 | unmeasured | any | authority-unmeasured |
   * | 3 | rolled-back | any | authority-rolled-back |
   * | 4 | coherent | unreadable | authority-unmeasured, and writerFailed('journal-unreadable' or 'rows-unreadable', 'acts') |
   * | 5 | coherent | they disagree, or a stated `from` the fold contradicts | authority-rolled-back, and writerFailed(verdict, 'acts') |
   * | 6 | coherent | they agree | append each record, then the head row, then `apply`: ok; on a failure at or after the first append, a throw from `apply` included, journal-append and writerFailed('trailing', 'acts') at once |
   *
   * Records the grammar refuses, or none, answer `journal-append` before anything is read or written, and the guard is not told:
   * the port has no word for a caller's error, and nothing was appended (slug `bad-records-answer-journal-append`).
   */
  appendInTx(db: DatabaseSync, records: readonly OverlordActRecord[], apply: () => void): ActJournalAppend {
    let inTx: boolean;
    try { inTx = db.isTransaction; } catch { inTx = false; }
    if (!inTx) return { ok: false, error: 'not-in-transaction', detail: 'an act record is appended only inside the caller\'s tx()' };
    let canon: OverlordActRecord[];
    try {
      if (!Array.isArray(records) || records.length === 0) throw new Error('none');
      canon = records.map((r) => actRecordEntry(canonicalActRecord(r)));
    } catch {
      return { ok: false, error: 'journal-append', detail: 'records the act journal\'s grammar refuses; nothing was appended' };
    }
    const failed = (cause: AuthorityWriterFailure, error: 'authority-unmeasured' | 'authority-rolled-back' | 'journal-append', detail: string): ActJournalAppend => {
      this.guard.writerFailed(cause, 'acts');
      return { ok: false, error, detail };
    };

    const phase: { at: JournalPhase } = { at: 'decide' };
    let entered = false;
    let last: ChainedJournalRecord<OverlordActRecord> | null = null;
    try {
      return appendThenApply<readonly OverlordActRecord[], ActJournalAppend, ActJournalAppend>({
        decide: () => {
          const s = this.guard.state();
          if (s.kind === 'coherent') return { go: canon };
          return s.kind === 'unmeasured'
            ? { stop: { ok: false, error: 'authority-unmeasured', detail: `the guard reads unmeasured: ${s.why}` } }
            : { stop: { ok: false, error: 'authority-rolled-back', detail: `the guard reads rolled-back: ${s.cause}` } };
        },
        append: (rs) => {
          for (const [i, entry] of rs.entries()) {
            const before = last;
            const r = this.file.appendNext<CoherenceVerdict>((seen) => {
              if (before === null) {
                const verdict = authorityCoherence(seen, this.readHeadRow(db));
                if (verdict.kind !== 'coherent') return { stop: verdict };
                if (!fromHolds(actJournalFold(seen.kind === 'records' ? seen.records : []), rs)) return { stop: { kind: 'rolled-back', cause: 'diverged' } };
              } else {
                // A later record of the same append: the file must end in exactly the record this call appended.
                const tip = seen.kind === 'records' && seen.tail === null ? seen.records[seen.records.length - 1] : undefined;
                if (tip === undefined || tip.sequence !== before.sequence || tip.digest !== before.digest) return { stop: { kind: 'rolled-back', cause: 'ahead' } };
              }
              entered = true;
              return { go: { entry, acceptedAt: new Date(this.time.clock.wall()).toISOString() } };
            });
            if (r.ok) { last = r.record; continue; }
            if ('stopped' in r) {
              const v = r.stopped;
              if (i > 0) throw new Halt(failed('trailing', 'journal-append', `record ${i + 1} of ${rs.length} found the file moved; the first may stand`));
              if (v.kind === 'unmeasured') {
                throw new Halt(failed(v.why === 'rows' ? 'rows-unreadable' : 'journal-unreadable', 'authority-unmeasured', `the ${v.why === 'rows' ? 'head row' : 'journal'} could not be read`));
              }
              if (v.kind === 'rolled-back') {
                throw new Halt(failed(v.cause, 'authority-rolled-back', v.cause === 'diverged'
                  ? 'the journal against the head row, or a stated from against the fold, reads diverged' : `the journal against the head row reads ${v.cause}`));
              }
              throw new Halt({ ok: false, error: 'journal-append', detail: 'the check stopped on a coherent verdict' });
            }
            if (!r.mayApply && i === 0) throw new Halt(failed('journal-unreadable', 'authority-unmeasured', `the journal could not be read (${r.error})`));
            throw new Halt(failed('trailing', 'journal-append', `the append failed (${r.error}); a record may stand`));
          }
        },
        apply: () => {
          const rec = last;
          if (rec === null) throw new Error('apply reached with no appended record');
          writeActHeadRow(db, rec);
          apply();
          return appendedOk(rec);
        },
      }, phase);
    } catch (err) {
      if (err instanceof Halt) return err.answer;
      // A throw the kernel rethrew unchanged: before the first append nothing was written, so the read failed; at or after it, a
      // record may stand with no head row or no act row, so the guard reads it as trailing at once (F12).
      if (phase.at === 'apply' || entered) return failed('trailing', 'journal-append', 'a step at or after the append failed; a record may stand');
      return failed('journal-unreadable', 'authority-unmeasured', 'the journal could not be read before the append');
    }
  }
}
