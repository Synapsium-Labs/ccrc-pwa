// The invariant monitor's gatherer (Overlord spec §10.4 "One invariant monitor"; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 5). Ring L3, context C5: it reads every input the
// predicates take (`invariants.ts`, L1) and decides nothing.
//
// ONE SYNCHRONOUS SPAN. `gatherInvariantInput` reads the window's lines, then each running row's facts, inside one `tx()` with no
// `await` between two reads, so no writer of this process runs between them; the journal file is read inside the same span as
// the rows it is compared with. The transaction writes nothing: `BEGIN IMMEDIATE` holds the write lock for the gather alone.
//
// NO FOLD OF `unmeasured`. Each read failure becomes that row's `unmeasured` arm with its reason; a table whose migration is not
// applied becomes `absent`, naming it. A failure to open the span at all makes every arm `unmeasured`.
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './tx.js';
import type { FactsRead, I17Facts, I2Facts, I5Facts, I7Facts, InvariantInput, SequenceLine } from './invariants.js';
import { authorityFold } from './overlordAuthority.js';
import type { AuthorityState } from './overlordAuthorityCoherence.js';
import type { AuthorityFileRead } from './overlordAuthorityJournal.js';
import { designationRead } from './overlordDesignationStore.js';
import { journalSideOf } from './overlordRestore.js';
import { restoreRowsSide } from './overlordRestoreRows.js';
import { sequenceAfter, type SequenceRead } from './overlordSequenceStore.js';

/** What the gatherer reads beside `coord.db`, declared here by its consumer. */
export interface InvariantFactsDeps {
  readonly db: DatabaseSync;
  /** The authority journal's verified read (`OverlordAuthorityJournal.readVerified`). */
  readonly readJournal: () => AuthorityFileRead;
  /** The authority guard's state (`OverlordAuthorityGuard.state`). */
  readonly guardState: () => AuthorityState;
  /** The kept designation line, the window's baseline (the sequence store's `designationBaseline`): the line, none, or unmeasured.
   *  Absent (a build without that read): I5's facts read unmeasured, never a pass and never a violation. */
  readonly designationBaseline?: ((db: DatabaseSync) => SequenceRead<SequenceLine | null>) | undefined;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const measured = <F>(value: F): FactsRead<F> => ({ kind: 'measured', value });
const unmeasured = (why: string): { kind: 'unmeasured'; why: string } => ({ kind: 'unmeasured', why });

/** The tables a row reads: `absent` (naming the first missing) when a migration that creates one is not applied. */
function missingTable(db: DatabaseSync, names: readonly string[]): string | null {
  const stmt = db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?");
  return names.find((n) => stmt.get(n) === undefined) ?? null;
}
function guarded<F>(db: DatabaseSync, tables: readonly string[], read: () => FactsRead<F>): FactsRead<F> {
  try {
    const missing = missingTable(db, tables);
    if (missing !== null) return { kind: 'absent', what: missing };
    return read();
  } catch (e) {
    return unmeasured(errText(e));
  }
}

/** The window: every retained line above the prune floor, in seq order (the kept designation line is I5's baseline, below it). */
function windowLines(db: DatabaseSync): FactsRead<readonly SequenceLine[]> {
  return guarded(db, ['overlord_sequence', 'overlord_sequence_pruned'], () => {
    const head = sequenceAfter(db, 0, 0);
    if (head.kind === 'unmeasured') return head;
    const r = sequenceAfter(db, head.value.facts.prunedThrough ?? 0, Number.MAX_SAFE_INTEGER);
    return r.kind === 'unmeasured' ? r : measured(r.value.lines);
  });
}

function i2Facts(db: DatabaseSync): FactsRead<I2Facts> {
  return guarded(db, ['asks', 'operator_items', 'push_outbox'], () => {
    const reached = [
      ...(db.prepare('SELECT id FROM asks WHERE reachedOperatorAt IS NOT NULL ORDER BY id').all() as { id: number }[])
        .map((r) => ({ kind: 'ask' as const, id: Number(r.id) })),
      ...(db.prepare('SELECT id FROM operator_items WHERE reachedOperatorAt IS NOT NULL ORDER BY id').all() as { id: number }[])
        .map((r) => ({ kind: 'item' as const, id: Number(r.id) })),
    ];
    const bound = (db.prepare('SELECT sourceKind, sourceId FROM push_outbox WHERE sourceKind IS NOT NULL ORDER BY id').all() as
      { sourceKind: string; sourceId: number }[]).map((r) => ({ sourceKind: String(r.sourceKind), sourceId: Number(r.sourceId) }));
    return measured({ reached, bound });
  });
}

function i5Facts(db: DatabaseSync, baselineOf: InvariantFactsDeps['designationBaseline']): FactsRead<I5Facts> {
  return guarded(db, ['overlord_designation'], () => {
    if (baselineOf === undefined) return unmeasured('the kept designation line has no reader in this build');
    const baseline = baselineOf(db);
    if (baseline.kind === 'unmeasured') return unmeasured(`the kept designation line could not be read: ${baseline.why}`);
    const d = designationRead(db);
    const current: I5Facts['current'] = d.kind === 'designated' ? { kind: 'bound', sessionId: d.sessionId }
      : d.kind === 'not-designated' ? { kind: 'none' } : { kind: 'unmeasured', why: d.why };
    return measured({ baseline: baseline.value, current });
  });
}

function i7Facts(db: DatabaseSync, deps: InvariantFactsDeps): FactsRead<I7Facts> {
  return guarded(db, ['overlord_designation', 'overlord_ladder', 'overlord_latches'], () => {
    const guard = deps.guardState();
    const rows = restoreRowsSide(db);
    if ('kind' in rows) return unmeasured(`the authority rows could not be read: ${rows.why}`);
    const file = deps.readJournal();
    if (file.kind === 'unmeasured') return unmeasured('the authority journal could not be read');
    if (file.kind === 'malformed') return unmeasured(`the authority journal is malformed: ${file.code}`);
    const journal = journalSideOf(authorityFold(file.kind === 'absent' ? [] : file.records));
    return measured({ guard, rows, journal });
  });
}

function i17Facts(db: DatabaseSync): FactsRead<I17Facts> {
  return guarded(db, ['continuity_timers', 'mail'], () => {
    const timers = (db.prepare("SELECT id, setter, state, mailId FROM continuity_timers WHERE state <> 'pending' ORDER BY id").all() as
      { id: number; setter: string; state: string; mailId: number | null }[])
      .map((t) => ({ id: Number(t.id), setter: String(t.setter), state: String(t.state), mailId: t.mailId === null ? null : Number(t.mailId) }));
    const ids = [...new Set(timers.flatMap((t) => (t.mailId === null ? [] : [t.mailId])))];
    const mails = new Map<number, { fromId: string; toId: string }>();
    const rows = db.prepare('SELECT id, fromId, toId FROM mail WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as
      { id: number; fromId: string; toId: string }[];
    for (const m of rows) mails.set(Number(m.id), { fromId: String(m.fromId), toId: String(m.toId) });
    return measured({ timers, mails });
  });
}

/** The sequence's head (the highest seq ever issued), a cheap read the runner takes before deciding to gather. */
export function sequenceHead(db: DatabaseSync): SequenceRead<number> {
  const r = sequenceAfter(db, 0, 0);
  return r.kind === 'unmeasured' ? r : { kind: 'measured', value: r.value.facts.head };
}

/** Every input of one pass, read in one synchronous span inside one `tx()` that writes nothing. Never throws. */
export function gatherInvariantInput(deps: InvariantFactsDeps): InvariantInput {
  const { db } = deps;
  try {
    return tx(db, (): InvariantInput => ({
      lines: windowLines(db),
      facts: { I2: i2Facts(db), I5: i5Facts(db, deps.designationBaseline), I7: i7Facts(db, deps), I17: i17Facts(db) },
    }));
  } catch (e) {
    const why = `the gather could not run: ${errText(e)}`;
    return { lines: unmeasured(why), facts: { I2: unmeasured(why), I5: unmeasured(why), I7: unmeasured(why), I17: unmeasured(why) } };
  }
}
