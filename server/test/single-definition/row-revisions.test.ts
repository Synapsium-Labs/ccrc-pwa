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
import { sqlWrites, tableRefSource, type SqlWrite } from './sqlStatements.js';

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
/** `s` cut at its top-level `,` (or, with `stop`, ended at the first top-level match of it), outside quotes and brackets. */
const topLevel = (s: string, stop?: RegExp): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    const close = ch === "'" ? "'" : ch === '"' ? '"' : null;
    if (close !== null) { const e = s.indexOf(close, i + 1); const end = e < 0 ? s.length : e + 1; cur += s.slice(i, end); i = end - 1; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && stop !== undefined && /\s/.test(ch) && stop.test(s.slice(i))) break;
    if (ch === ',' && depth === 0 && stop === undefined) { out.push(fold(cur)); cur = ''; } else cur += ch;
  }
  return [...out, fold(cur)];
};
const assignments = (set: string): string[] => topLevel(set);
const SET_END = /^\s(?:WHERE|RETURNING|FROM|ORDER\s+BY|LIMIT)\b/i;
/** What a statement writes: a plain insert (no SET list), a SET list (an UPDATE's, or an upsert's `DO UPDATE SET`), a
 *  REPLACE (which deletes and re-inserts the row at revision 0, whatever it names), or `unreadable`: an UPDATE whose table
 *  is not followed by `SET` itself (an alias, `INDEXED BY`, a `${…}`), or a SET list holding a `${…}` that could hide or
 *  supply a raise. An unreadable statement is red, never skipped (review 2348 F1). */
type Shape = { kind: 'insert' } | { kind: 'replace' } | { kind: 'set'; set: string } | { kind: 'unreadable'; why: string };
const shapeOf = (sql: string, table: string): Shape => {
  if (/^REPLACE\b/i.test(sql) || /^INSERT\s+OR\s+REPLACE\b/i.test(sql)) return { kind: 'replace' };
  let rest: string;
  if (/^INSERT\b/i.test(sql)) {
    const up = /\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\s+SET\s/i.exec(sql);
    if (up === null) return /\bDO\s+UPDATE\b/i.test(sql) ? { kind: 'unreadable', why: 'an upsert whose DO UPDATE has no plain SET' } : { kind: 'insert' };
    rest = sql.slice(up.index + up[0].length);
  } else if (/^UPDATE\b/i.test(sql)) {
    const head = new RegExp(`^UPDATE(?:\\s+OR\\s+\\w+)?\\s+${tableRefSource(table)}\\s+SET\\s`, 'i').exec(sql);
    if (head === null) return { kind: 'unreadable', why: 'its table is not followed by SET (an alias, INDEXED BY or a substitution)' };
    rest = sql.slice(head[0].length);
  } else return { kind: 'insert' };
  const set = topLevel(` ${rest}`, SET_END)[0]!;
  return set.includes('${…}') ? { kind: 'unreadable', why: 'its SET list holds a substitution' } : { kind: 'set', set };
};

/** Every problem with these writes against `classes`, as one line each; empty when the census holds. Each write is ONE
 *  statement (`sqlWrites` splits a multi-statement string), judged on its own SET list (review 2348 F3). */
const revisionProblems = (writes: readonly SqlWrite[], classes: typeof REVISION_CLASSES): string[] => {
  const problems: string[] = [];
  const covered = new Set<string>();
  for (const w of writes) {
    if (w.table !== 'asks' && w.table !== 'operator_items') continue;
    const sql = fold(w.sql);
    const shape = shapeOf(sql, w.table);
    if (shape.kind === 'replace') {
      problems.push(`${w.writer}: a REPLACE of ${w.table} deletes and re-inserts the row at revision 0, whatever it names: ${sql}`);
      continue;
    }
    if (/^INSERT\b/i.test(sql) && namesRevision(sql.split(/\bON\s+CONFLICT\b/i)[0]!)) {
      problems.push(`${w.writer}: an INSERT names revision (it starts at 0, by the column's default): ${sql}`);
    }
    if (shape.kind === 'insert') continue;
    const row = classes.find((c) => c.table === w.table && c.writer === w.writer);
    if (row !== undefined) covered.add(`${row.table} ${row.writer}`);
    if (shape.kind === 'unreadable') {
      problems.push(`${w.writer} writes ${w.table} in a statement the census cannot read (${shape.why}): ${sql}`);
      continue;
    }
    const set = shape.set;
    if (row === undefined) {
      problems.push(`${w.writer} writes ${w.table} and has no class: add it to REVISION_CLASSES, raises or bookkeeping: ${sql}`);
      continue;
    }
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
      /insertAsk: an INSERT names revision/],
    ['a stale row', () => real().filter((w) => !(w.writer === `${LEDGERS}setBlocking` && w.table === 'operator_items')),
      /stale REVISION_CLASSES row: .*setBlocking on operator_items/],
  ];
  it.each(CONTROLS)('CONTROL: %s is red', (_name, plant, why) => {
    const problems = revisionProblems(plant(), REVISION_CLASSES);
    expect(problems.some((p) => why.test(p)), problems.join('\n')).toBe(true);
  });

  // Each of these writes one method's statement into a source file and runs it through the scan and the census, as a
  // classed raise on both tables: the forms the scan must see and the census must not let through (review 2348 F1–F4).
  // `red` is what the problems must show; `[]` means the statement reads and holds.
  const W = 'S.w';
  const raisesBoth: typeof REVISION_CLASSES = (['asks', 'operator_items'] as const).map((table) => ({ table, writer: W, cls: 'raises' as const }));
  const SCANNED: readonly [string, string, RegExp | null][] = [
    ['F1: an alias between the table and SET', "UPDATE asks AS a SET state = 'stale', revision = revision + 1 WHERE a.id = ?", /cannot read \(its table is not followed by SET/],
    ['F1: INDEXED BY between the table and SET', "UPDATE asks INDEXED BY asks_by_child SET state = 'stale', revision = revision + 1 WHERE id = ?", /cannot read \(its table is not followed by SET/],
    ['F1: a substitution between the table and SET', "UPDATE asks ${by} SET state = 'stale', revision = revision + 1 WHERE id = ?", /cannot read \(its table is not followed by SET/],
    ['F1: a substitution in the SET list', "UPDATE asks SET state = 'stale', ${bump} WHERE id = ?", /cannot read \(its SET list holds a substitution/],
    ['F3: the second UPDATE of one exec, missing its raise', "UPDATE asks SET state = 'stale', revision = revision + 1 WHERE id = 1; UPDATE operator_items SET state = 'closed' WHERE id = 2", /S\.w raises on operator_items/],
    ['F3: a second UPDATE of the same table in one exec, missing its raise', "UPDATE asks SET state = 'stale', revision = revision + 1 WHERE id = 1; UPDATE asks SET state = 'held' WHERE id = 2", /S\.w raises on asks: .* holds \[\]/],
    ['F4: a REPLACE INTO naming nothing', "REPLACE INTO asks (id, state) VALUES (?, 'held')", /a REPLACE of asks deletes and re-inserts/],
    ['F4: an INSERT OR REPLACE naming nothing', "INSERT OR REPLACE INTO operator_items (id, state) VALUES (?, 'open')", /a REPLACE of operator_items deletes and re-inserts/],
    ['F2: a lower-case statement reads, raise and all', "update asks set state = 'stale', revision = revision + 1 where id = ?", null],
    ['F2: UPDATE OR IGNORE reads, and its missing raise is red', "UPDATE OR IGNORE asks SET state = 'stale' WHERE id = ?", /S\.w raises on asks/],
    ['F2: a schema-qualified name is seen', "UPDATE main.asks SET state = 'stale' WHERE id = ?", /S\.w raises on asks/],
    ['F2: a quoted name is seen', "UPDATE \"operator_items\" SET state = 'closed' WHERE id = ?", /S\.w raises on operator_items/],
  ];
  it.each(SCANNED)('CONTROL (through the scan): %s', (_name, statement, red) => {
    const d = mkdtempSync(path.join(tmpdir(), 'row-revisions-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, ['export class S {', `  w(by: string, bump: string): void { this.db.exec(\`${statement}\`); }`, '}'].join('\n'));
      const writes = sqlWrites([f], ['asks', 'operator_items']).map((w) => ({ ...w, writer: w.writer.replace(/^.*#/, '') }));
      expect(writes.length, 'the scan sees the statement').toBeGreaterThan(0);
      // Only the written tables' rows can be covered here; the other table's row is stale by construction, not by defect.
      const tables = new Set(writes.map((w) => w.table));
      const problems = revisionProblems(writes, raisesBoth.filter((c) => tables.has(c.table)));
      if (red === null) expect(problems).toEqual([]);
      else expect(problems.some((p) => red.test(p)), problems.join('\n')).toBe(true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
