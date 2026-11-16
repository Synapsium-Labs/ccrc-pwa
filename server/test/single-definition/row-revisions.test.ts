// ROW REVISIONS, A CLOSED CENSUS (Overlord W2, plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-revisions.md Task 2;
// spec 2026-11-09-overlord-design.md §6.7, "Revisions decide a race"). An ask's and an item's `revision` moves exactly when
// what an answer acts on moves (ruled F8): each write that changes it raises the revision by one in its own `SET`, and a
// bookkeeping write (a reach stamp, the correction flag, `neededBy`, the retention wipe, the in-flight hold and its
// rollback, ruled F14) never names it. `REVISION_CLASSES` is the plan's Table R1, and it is CLOSED: a new UPDATE or upsert
// of either table is red here until its pull request classifies it, and a row no statement matches is red as stale.
//
// It reads the one scan `writers-map.test.ts#tableWriters` reads (`sqlStatements.ts#sqlWrites`), so the two censuses
// cannot disagree about which functions write these tables.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL, rel } from './helpers.js';
import { sqlWrites, type SqlWrite } from './sqlStatements.js';

type RevisionClass = 'raises' | 'bookkeeping';
const STORE = 'server/src/coord/store.ts#CoordStore.';
const LEDGERS = 'server/src/coord/ledgersStore.ts#';
const REACH = 'server/src/coord/pushOutboxStore.ts#stampReach';
/** Table R1: every UPDATE (and upsert) of `asks` and `operator_items`, by writer and table (`stampReach` has one row per
 *  table, its two arms). */
const REVISION_CLASSES: readonly { table: 'asks' | 'operator_items'; writer: string; cls: RevisionClass }[] = [
  { table: 'asks', writer: `${STORE}takeAskForAnswer`, cls: 'bookkeeping' },
  { table: 'asks', writer: `${STORE}untakeAsk`, cls: 'bookkeeping' },
  { table: 'asks', writer: `${STORE}settleAsk`, cls: 'raises' },
  { table: 'asks', writer: `${STORE}releaseAsk`, cls: 'raises' },
  { table: 'asks', writer: `${STORE}declineAsk`, cls: 'raises' },
  { table: 'asks', writer: `${STORE}staleAsk`, cls: 'raises' },
  { table: 'asks', writer: `${STORE}restampAsk`, cls: 'raises' },
  { table: 'asks', writer: `${STORE}pruneAskQuestions`, cls: 'bookkeeping' },
  { table: 'asks', writer: `${STORE}correctWithMail`, cls: 'bookkeeping' },
  { table: 'asks', writer: REACH, cls: 'bookkeeping' },
  { table: 'operator_items', writer: `${LEDGERS}moveItemInTx`, cls: 'raises' },
  { table: 'operator_items', writer: `${LEDGERS}setBlocking`, cls: 'bookkeeping' },
  { table: 'operator_items', writer: REACH, cls: 'bookkeeping' },
];

/** The one raise, and the re-stamp's conditional raise (question 2: only when `askAt` moves), whitespace folded. */
const RAISE = 'revision = revision + 1';
const RESTAMP_RAISE = 'revision = revision + (askAt IS NOT ?1)';
const RESTAMP = `${STORE}restampAsk`;

const fold = (s: string): string => s.replace(/\s+/g, ' ').trim();
const namesRevision = (s: string): boolean => /\brevision\b/.test(s);
/** A `SET` list split on its top-level commas. */
const assignments = (set: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of set) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(fold(cur)); cur = ''; } else cur += ch;
  }
  return [...out, fold(cur)];
};
/** The `SET` list an update writes: an UPDATE's, or an upsert's `DO UPDATE SET`; `null` for a plain insert. */
const setListOf = (sql: string): string | null => {
  const m = /\bUPDATE\s+(?:\w+\s+)?SET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/.exec(sql);
  return m === null ? null : m[1]!;
};
const isInsertOrReplace = (sql: string): boolean => /^\s*(?:INSERT|REPLACE)\b/i.test(sql);

/** Every problem with these writes against `classes`, as one line each; empty when the census holds. */
const revisionProblems = (writes: readonly SqlWrite[], classes: typeof REVISION_CLASSES): string[] => {
  const problems: string[] = [];
  const covered = new Set<string>();
  for (const w of writes) {
    if (w.table !== 'asks' && w.table !== 'operator_items') continue;
    const sql = fold(w.sql);
    const insert = isInsertOrReplace(sql);
    const head = insert ? sql.split(/\bON CONFLICT\b/)[0]! : '';
    if (insert && namesRevision(head)) problems.push(`${w.writer}: an INSERT or REPLACE names revision (it starts at 0, by the column's default): ${sql}`);
    const set = setListOf(sql);
    if (set === null) continue;
    const row = classes.find((c) => c.table === w.table && c.writer === w.writer);
    if (row === undefined) {
      problems.push(`${w.writer} writes ${w.table} and has no class: add it to REVISION_CLASSES, raises or bookkeeping: ${sql}`);
      continue;
    }
    covered.add(`${row.table} ${row.writer}`);
    const named = assignments(set).filter((a) => /^revision\s*=/.test(a));
    if (row.cls === 'bookkeeping') {
      if (namesRevision(sql)) problems.push(`${w.writer} is bookkeeping on ${w.table} and names revision: ${sql}`);
      continue;
    }
    const want = w.writer === RESTAMP ? RESTAMP_RAISE : RAISE;
    if (named.length !== 1 || named[0] !== want) {
      problems.push(`${w.writer} raises on ${w.table}: its SET must hold exactly one \`${want}\`, it holds [${named.join('; ')}]: ${sql}`);
    }
  }
  for (const c of classes) {
    if (!covered.has(`${c.table} ${c.writer}`)) problems.push(`stale REVISION_CLASSES row: ${c.writer} on ${c.table} matches no UPDATE in the tree`);
  }
  return problems;
};

let scanned: SqlWrite[] | undefined;
const writesOf = (): SqlWrite[] => (scanned ??= sqlWrites(ALL.filter((f) => !rel(f).startsWith('pwa/')), ['asks', 'operator_items']))
  .map((w) => ({ ...w }));

describe('row revisions: every write of asks and operator_items is classified, raises or bookkeeping (Overlord W2)', () => {
  it('the census holds: each raise once in its own SET, no bookkeeping write names it, no insert names it, no stale row', () => {
    expect(revisionProblems(writesOf(), REVISION_CLASSES)).toEqual([]);
  });

  it('CONTROL: the scan joins a statement built from `+`-joined literals and names its writer', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'row-revisions-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, [
        'export class S {',
        "  w(): void { this.db.prepare(\"UPDATE asks SET state = 'stale', \" +",
        "    \"revision = revision + 1 WHERE id = ?\"); }",
        "  r(): void { this.db.prepare('SELECT revision FROM asks'); }",
        '}',
      ].join('\n'));
      expect(sqlWrites([f], ['asks']).map((w) => [w.writer.replace(/^.*#/, ''), w.sql])).toEqual([
        ['S.w', "UPDATE asks SET state = 'stale', revision = revision + 1 WHERE id = ?"],
      ]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  // Each control plants one defect in memory, in a copy of the tree's own writes, and must be red.
  const real = (): SqlWrite[] => writesOf();
  const swap = (writes: SqlWrite[], writer: string, table: string, to: (sql: string) => string): SqlWrite[] =>
    writes.map((w) => (w.writer === writer && w.table === table ? { ...w, sql: to(w.sql) } : w));
  const CONTROLS: readonly [string, () => SqlWrite[], RegExp][] = [
    ['an unclassified UPDATE', () => [...real(), { table: 'asks', writer: 'server/src/x.ts#planted', sql: "UPDATE asks SET state = 'held' WHERE id = ?" }],
      /planted writes asks and has no class/],
    ['an unclassified upsert', () => [...real(), { table: 'operator_items', writer: 'server/src/x.ts#planted',
      sql: 'INSERT INTO operator_items (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET note = excluded.note' }], /planted writes operator_items and has no class/],
    ['a raise missing from a raises writer', () => swap(real(), `${STORE}settleAsk`, 'asks', (s) => s.replace(/,\s*revision = revision \+ 1/, '')),
      /settleAsk raises on asks/],
    ['a raise in a bookkeeping writer', () => swap(real(), `${STORE}untakeAsk`, 'asks', (s) => s.replace(' WHERE', ', revision = revision + 1 WHERE')),
      /untakeAsk is bookkeeping on asks and names revision/],
    ['a revision set to a value', () => swap(real(), `${LEDGERS}moveItemInTx`, 'operator_items', (s) => s.replace('revision = revision + 1', 'revision = ?')),
      /moveItemInTx raises on operator_items/],
    ['a second raise', () => swap(real(), `${STORE}releaseAsk`, 'asks', (s) => s.replace(' WHERE', `, ${RAISE}, ${RAISE} WHERE`)),
      /releaseAsk raises on asks/],
    ['the conditional raise outside restampAsk', () => swap(real(), `${STORE}declineAsk`, 'asks', (s) => s.replace('revision = revision + 1', RESTAMP_RAISE)),
      /declineAsk raises on asks/],
    ['the plain raise on restampAsk', () => swap(real(), RESTAMP, 'asks', (s) => s.replace(RESTAMP_RAISE, RAISE)), /restampAsk raises on asks/],
    ['an INSERT naming the column', () => [...real(), { table: 'asks', writer: `${STORE}insertAsk`, sql: 'INSERT INTO asks (id, revision) VALUES (?, 0)' }],
      /insertAsk: an INSERT or REPLACE names revision/],
    ['a stale row', () => real().filter((w) => !(w.writer === `${LEDGERS}setBlocking` && w.table === 'operator_items')),
      /stale REVISION_CLASSES row: .*setBlocking on operator_items/],
  ];
  it.each(CONTROLS)('CONTROL: %s is red', (_name, plant, why) => {
    const problems = revisionProblems(plant(), REVISION_CLASSES);
    expect(problems.some((p) => why.test(p)), problems.join('\n')).toBe(true);
  });
});
