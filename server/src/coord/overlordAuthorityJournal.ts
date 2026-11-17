// The Overlord authority journal's synchronous writer and reader (Overlord spec §7.6, H27; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Task 3, questions 1, 5, 9 and 12, rulings X1, X2, X3
// and X3b). Ring L3, context C5. It binds A0's shared chained-journal file adapter (`../chainedJournalFile.ts`) with
// `OVERLORD_AUTHORITY_FORMAT`, holds the transaction check (only it knows its database), and declares `AuthorityGuardPort`, the
// L2 port through which it reads the guard's state and reports a failure to it (`writer-reads-the-guard-by-port`). It imports
// no L4 module: the guard implements the port and the composition root passes it in.
//
// THE WRITER (`authority-writer-verifies-then-appends`). Synchronous, called only inside the caller's `tx()`, refused outside
// one. It runs on `journalKernel.ts#appendThenApply`, unchanged, with its phase tracked: decide reads the guard; append lets the
// adapter re-read and verify the whole file, checks its head against the head row, refuses unless they agree, and appends the
// next record (`chainNext`) with its fsync; apply writes the head row. It ANSWERS AND NEVER THROWS (X2): every caller checks the
// answer and writes no row when it is refused, and writes its own row after `appended` (or `row-only`), in the same transaction.
// A failure once the append was entered, or a refusal because the file is past the head row (a caller's row or commit that failed
// after an earlier answer), calls `writerFailed('trailing')` before it answers (`writer-failure-fences-trailing`). An operator
// narrowing is never refused by the journal's state (X3, X3b, `narrowing-row-only-while-incoherent`): it answers `row-only`, the
// caller writes its row, and nothing is appended.
import type { DatabaseSync } from 'node:sqlite';
import type { ChainedJournalRecord, ChainedPosition, ChainedTailHealPlan } from '../chainedJournal.js';
import type { AppendOnlyFsOps } from '../appendOnlyFile.js';
import { chainedJournalFileAt, type ChainedCutError, type ChainedJournalFile } from '../chainedJournalFile.js';
import type { Clock } from '../time/ports.js';
import { appendThenApply, type JournalPhase } from '../journalKernel.js';
import {
  OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_FORMAT, OVERLORD_AUTHORITY_KINDS, OVERLORD_AUTHORITY_TORN_DIR, OverlordAuthorityError,
  authorityAgainstFold, authorityDirection, authorityEntry, authorityFold, canonicalAuthorityMove,
  type OverlordAuthorityEntry, type OverlordAuthorityMove,
} from './overlordAuthority.js';
import {
  AUTHORITY_STATE_CAUSES, AUTHORITY_STATE_WHYS, AUTHORITY_STATE_WORDS, authorityCoherence, authorityTailHeal,
  type AuthorityFileSeen, type AuthorityRowsSeen, type AuthorityState, type CoherenceCause, type CoherenceVerdict,
} from './overlordAuthorityCoherence.js';

/** The journal's one file binding: A0's chained-journal adapter over `<ccrcDir>/overlord-authority.jsonl` with this journal's
 *  format. `ops` is the port's test seam; production passes the directory alone. */
export function overlordAuthorityFileAt(ccrcDir: string, ops?: AppendOnlyFsOps): ChainedJournalFile<OverlordAuthorityEntry> {
  return chainedJournalFileAt(OVERLORD_AUTHORITY_FORMAT, ccrcDir, OVERLORD_AUTHORITY_BASENAME, ops);
}

/** Every Overlord authority table whose rows say "this box has chosen something", read by boot coherence beside the head row
 *  (Table 7.6a's "missing, beside any Overlord row"). Designation A adds `overlord_designation`, and the ladder its tables, each
 *  in its own pull request. Names only: each is a table this build's migrations create. */
export const OVERLORD_AUTHORITY_TABLES: readonly string[] = [
  // Decision model B: a decision-model row's arming (`decisionModelStore.ts#moveDecisionRowInTx`). Never seeded: a row is
  // inserted by its first move, journal record first, so a box that upgrades with no head row still boots coherent.
  'decision_rows',
];

/** A read the writer could not make, named by what it could not read (review F6: a head row it could not read keeps the
 *  `rows` word), and the guard's `unmeasured` word for each. */
export type AuthorityUnreadable = 'journal-unreadable' | 'rows-unreadable';
export const AUTHORITY_UNREADABLE: Readonly<Record<AuthorityUnreadable, 'journal' | 'rows'>> = {
  'journal-unreadable': 'journal', 'rows-unreadable': 'rows',
};
/** What the writer tells the guard: a failure at or after the append (`trailing`), the verdict of a head mismatch it measured
 *  (or `diverged` for a stated `from` the fold contradicts), or a file or head row it could not read. */
export type AuthorityWriterFailure = CoherenceCause | AuthorityUnreadable;

/** L2, declared here by its consumer; the guard implements it (review F10). */
export interface AuthorityGuardPort {
  state(): AuthorityState;
  /** The writer's failure at or after the append (`trailing`), or the verdict of a head mismatch it measured. */
  writerFailed(cause: AuthorityWriterFailure): void;
}

/** `appendInTx`'s answer. None is an HTTP refusal: a door maps them (X2's door mapping). */
export type AuthorityAppend =
  | { ok: true; kind: 'appended'; record: ChainedJournalRecord<OverlordAuthorityEntry> }
  /** An operator narrowing while the journal is not coherent: write the row, append nothing, leave the head row. */
  | { ok: true; kind: 'row-only'; state: Exclude<AuthorityState, { kind: 'coherent' }> }
  | { ok: false; error: AuthorityAppendError; detail: string };
/** `bad-entry` is a caller's error, as `not-in-transaction` is: the entry the grammar refuses, never a journal state. */
export type AuthorityAppendError = 'not-in-transaction' | 'bad-entry' | 'authority-rolled-back' | 'authority-unmeasured' | 'journal-append';

/** The whole file, verified, for boot coherence and Confirm. */
export type AuthorityFileRead = AuthorityFileSeen<OverlordAuthorityEntry>;

/** What the torn-tail heal did. */
export type AuthorityHeal =
  | { kind: 'no-tail' }
  | { kind: 'healed'; name: string }
  | { kind: 'not-healable' }
  | { kind: 'unmeasured' }
  | { kind: 'cut-failed'; error: ChainedCutError; mayApply: boolean };

const AUTHORITY_APPEND_ERRORS: Readonly<Record<AuthorityAppendError, true>> = {
  'not-in-transaction': true, 'bad-entry': true, 'authority-rolled-back': true, 'authority-unmeasured': true, 'journal-append': true,
};
const AUTHORITY_APPEND_KINDS: Readonly<Record<Extract<AuthorityAppend, { ok: true }>['kind'], true>> = { appended: true, 'row-only': true };
const AUTHORITY_HEAL_KINDS: Readonly<Record<AuthorityHeal['kind'], true>> = {
  'no-tail': true, healed: true, 'not-healable': true, unmeasured: true, 'cut-failed': true,
};

/** Every kebab word the Overlord authority journal's files spell, for `mail-routes.test.ts`'s scan of `server/src/coord`: the entry
 *  kinds, the writer's answers and errors, the heal's outcomes, the guard's states, causes and whys, and the quarantine
 *  directory's name. Derived from tables, so a word added to a union is admitted and a typo is not. None is a mail rejection or a
 *  run refusal. */
export function isOverlordAuthorityKebab(w: string): boolean {
  const own = (o: object): boolean => Object.hasOwn(o, w);
  return own(OVERLORD_AUTHORITY_KINDS) || own(AUTHORITY_APPEND_ERRORS) || own(AUTHORITY_APPEND_KINDS) || own(AUTHORITY_HEAL_KINDS)
    || own(AUTHORITY_STATE_WORDS) || own(AUTHORITY_STATE_CAUSES) || own(AUTHORITY_STATE_WHYS) || own(AUTHORITY_UNREADABLE)
    || w === OVERLORD_AUTHORITY_TORN_DIR;
}

/** Why `appendThenApply`'s append step stopped: the caller's answer, carried out of the kernel by a throw it rethrows unchanged. */
class Halt {
  constructor(readonly answer: AuthorityAppend, readonly afterAppend: boolean) {}
}

const HEAD_READ = 'SELECT sequence, journalId, digest FROM overlord_authority_head WHERE id = 1';
const HEX64 = /^[0-9a-f]{64}$/;

export class OverlordAuthorityJournal {
  constructor(
    private readonly file: ChainedJournalFile<OverlordAuthorityEntry>,
    private readonly time: { clock: Clock },
    private readonly guard: AuthorityGuardPort,
  ) {}

  /** The whole file, verified: a fresh read, holding no snapshot. */
  readVerified(): AuthorityFileRead {
    const r = this.file.read();
    return r.kind === 'unmeasured' ? { kind: 'unmeasured', why: 'unreadable' } : r;
  }

  /** The head row and whether any Overlord authority table holds a row; `unmeasured` when either cannot be read, or the head
   *  row holds a value no writer of it would write. */
  readRows(db: DatabaseSync): AuthorityRowsSeen {
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
      const anyAuthorityRow = OVERLORD_AUTHORITY_TABLES.some((t) => db.prepare(`SELECT 1 FROM "${t}" LIMIT 1`).get() !== undefined);
      return { kind: 'measured', head, anyAuthorityRow };
    } catch {
      return { kind: 'unmeasured' };
    }
  }

  /** Table 7.6a over the file and the rows as they stand now: the guard's `measure`. */
  measure(db: DatabaseSync): CoherenceVerdict {
    return authorityCoherence(this.readVerified(), this.readRows(db));
  }

  /** The torn-tail heal (Task 4): when the file ends in a tail the heal rule takes, keep its bytes under the plan's name in
   *  `~/.ccrc/overlord-authority-torn/` and cut, through the adapter's one cut. Any other tail is left for coherence to read
   *  `malformed`. */
  healTornTail(db: DatabaseSync): AuthorityHeal {
    const file = this.readVerified();
    if (file.kind === 'unmeasured') return { kind: 'unmeasured' };
    if (file.kind !== 'records' || file.tail === null) return { kind: 'no-tail' };
    const rows = this.readRows(db);
    if (rows.kind === 'unmeasured') return { kind: 'unmeasured' };
    const plan: ChainedTailHealPlan | null = authorityTailHeal(file, rows);
    if (plan === null) return { kind: 'not-healable' };
    const cut = this.file.cutAside({ kind: 'tail', plan }, OVERLORD_AUTHORITY_TORN_DIR);
    return cut.ok ? { kind: 'healed', name: plan.name } : { kind: 'cut-failed', error: cut.error, mayApply: cut.mayApply };
  }

  /**
   * One authority move, inside the caller's `tx()`, never outside, and it never throws. First match, after the transaction check:
   *
   * | # | the guard | the file against the head row | the entry | answer |
   * |---|---|---|---|---|
   * | 1 | unmeasured | any | narrows | row-only |
   * | 2 | unmeasured | any | widens | authority-unmeasured |
   * | 3 | rolled-back | any | narrows | row-only |
   * | 4 | rolled-back | any | widens | authority-rolled-back |
   * | 5 | coherent | unreadable | narrows | row-only, and writerFailed('journal-unreadable' or 'rows-unreadable') |
   * | 5w | coherent | unreadable | widens | authority-unmeasured; the guard is not told |
   * | 6 | coherent | they disagree | narrows | row-only, and writerFailed(verdict) |
   * | 7 | coherent | they disagree | widens | authority-rolled-back, and writerFailed(verdict) |
   * | 8 | coherent | they agree | any | append, then the head row: appended; on a failure at or after the append, writerFailed('trailing'), then row-only for a narrowing and journal-append for a widening |
   *
   * Row 8 holds a stated `from` against the journal's fold first (review F2, `stated-from-against-the-fold`): when the fold
   * holds a value for the field and `from` differs, the move's direction is read from the fold's value, the guard is told
   * `diverged`, and the move answers as rows 6 and 7 do (row-only for a narrowing against the fold, authority-rolled-back for a
   * widening). While the guard is not coherent (rows 1 to 4) no fold is trusted and the stated `from` decides the direction.
   *
   * THE CALLER'S DUTIES. Pass as `from` the row's own value, read in the same `tx()`: over an incoherent journal nothing else
   * checks it, so a `from` stated wider than the row reads a widening as a narrowing and lands it row-only (a documented
   * residual; the ladder and designation PRs pin the duty with a test). Append before writing any row of a table in
   * `OVERLORD_AUTHORITY_TABLES` in the same transaction: a listed table's row with no record before it reads `missing` (review
   * F9). An account set's pool lists are sorted and de-duplicated here, so their order is the row's, never the journal's.
   */
  appendInTx(db: DatabaseSync, entry: OverlordAuthorityMove): AuthorityAppend {
    let inTx: boolean;
    try { inTx = db.isTransaction; } catch { inTx = false; }
    if (!inTx) return { ok: false, error: 'not-in-transaction', detail: 'an authority record is appended only inside the caller\'s tx()' };
    let move: OverlordAuthorityMove;
    try {
      const e = authorityEntry(canonicalAuthorityMove(entry));
      if (e.kind === 'authority-restore-confirmed') throw new OverlordAuthorityError('bad-field', 'the Confirm record is appendConfirmInTx\'s');
      move = e;
    } catch (err) {
      return { ok: false, error: 'bad-entry', detail: err instanceof Error ? err.message : String(err) };
    }
    let narrows = authorityDirection(move) === 'narrows';
    let fromDiverged = false;
    // A narrowing always lands (X3b): its answer carries the guard's state, or, should the guard not have moved, the state the
    // writer just reported, so a narrowing is never answered with a refusal.
    const failed = (cause: AuthorityWriterFailure, widenError: AuthorityAppendError, detail: string): AuthorityAppend => {
      this.guard.writerFailed(cause);
      if (!narrows) return { ok: false, error: widenError, detail };
      const s = this.guard.state();
      const reported: Exclude<AuthorityState, { kind: 'coherent' }> = Object.hasOwn(AUTHORITY_UNREADABLE, cause)
        ? { kind: 'unmeasured', why: AUTHORITY_UNREADABLE[cause as AuthorityUnreadable] }
        : { kind: 'rolled-back', cause: cause as CoherenceCause };
      return { ok: true, kind: 'row-only', state: s.kind === 'coherent' ? reported : s };
    };

    const phase: { at: JournalPhase } = { at: 'decide' };
    let appendEntered = false;
    let appended: ChainedJournalRecord<OverlordAuthorityEntry> | null = null;
    try {
      return appendThenApply<OverlordAuthorityMove, AuthorityAppend, AuthorityAppend>({
        decide: () => {
          const s = this.guard.state();
          if (s.kind === 'coherent') return { go: move };
          if (narrows) return { stop: { ok: true, kind: 'row-only', state: s } };
          return s.kind === 'unmeasured'
            ? { stop: { ok: false, error: 'authority-unmeasured', detail: `the guard reads unmeasured: ${s.why}` } }
            : { stop: { ok: false, error: 'authority-rolled-back', detail: `the guard reads rolled-back: ${s.cause}` } };
        },
        append: (m) => {
          const r = this.file.appendNext<CoherenceVerdict>((seen) => {
            const verdict = authorityCoherence(seen, this.readRows(db));
            if (verdict.kind !== 'coherent') return { stop: verdict };
            const held = seen.kind === 'records' ? authorityAgainstFold(m, authorityFold(seen.records)) : null;
            if (held !== null && !held.matches) {
              narrows = held.direction === 'narrows';
              fromDiverged = true;
              return { stop: { kind: 'rolled-back', cause: 'diverged' } };
            }
            const acceptedAt = new Date(this.time.clock.wall()).toISOString();
            appendEntered = true;
            return { go: { entry: m, acceptedAt } };
          });
          if (r.ok) { appended = r.record; return; }
          if ('stopped' in r) {
            const v = r.stopped;
            if (v.kind === 'unmeasured') {
              throw new Halt(narrows ? failed(v.why === 'rows' ? 'rows-unreadable' : 'journal-unreadable', 'authority-unmeasured', '') : {
                ok: false, error: 'authority-unmeasured', detail: `the ${v.why === 'rows' ? 'head row' : 'journal'} could not be read`,
              }, false);
            }
            if (v.kind === 'rolled-back') {
              throw new Halt(failed(v.cause, 'authority-rolled-back', fromDiverged
                ? 'the stated from differs from the journal\'s fold' : `the journal against the head row reads ${v.cause}`), false);
            }
            throw new Halt({ ok: false, error: 'journal-append', detail: 'the check stopped on a coherent verdict' }, false);
          }
          if (!r.mayApply) {
            // The file could not be read (or, past a coherent check, was not appendable): nothing was written.
            throw new Halt(narrows ? failed('journal-unreadable', 'authority-unmeasured', '') : {
              ok: false, error: 'authority-unmeasured', detail: `the journal could not be read (${r.error})`,
            }, false);
          }
          throw new Halt(failed('trailing', 'journal-append', `the append failed (${r.error}); the record may stand`), true);
        },
        apply: () => {
          const rec = appended;
          if (rec === null) throw new Error('apply reached with no appended record');
          // The head row's one writer: the apply step, in the caller's transaction, after the record is durable.
          db.prepare(`INSERT INTO overlord_authority_head (id, sequence, journalId, digest, at) VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, journalId = excluded.journalId, digest = excluded.digest,
            at = excluded.at`).run(rec.sequence, rec.journalId, rec.digest, Date.parse(rec.acceptedAt));
          return { ok: true, kind: 'appended', record: rec };
        },
      }, phase);
    } catch (err) {
      if (err instanceof Halt) return err.answer;
      // Anything else is a throw the kernel rethrew unchanged: before the append nothing was written; at or after it the record
      // may stand with no head row, so the guard reads it as trailing at once.
      const detail = err instanceof Error ? err.message : String(err);
      if (phase.at === 'apply' || appendEntered) return failed('trailing', 'journal-append', `failed after the append: ${detail}`);
      // Before the append nothing was written: a narrowing lands row-only and tells the guard; a widening is refused and the
      // guard is not told (row 5w, review F6).
      if (!narrows) return { ok: false, error: 'authority-unmeasured', detail: `failed before the append: ${detail}` };
      return failed('journal-unreadable', 'authority-unmeasured', `failed before the append: ${detail}`);
    }
  }
}
