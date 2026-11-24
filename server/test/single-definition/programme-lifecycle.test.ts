// Programme lifecycle W1, task 4 (D-8983, D-8985, D-8993): the lifecycle's facts have ONE writer. `UPDATE programs SET` of
// the decision, its record, the binding or the placeholder, and every write of `programme_events` and `programme_picks`, are
// in `server/src/coord/programmeLifecycleStore.ts`; the one named exemption is the migration's own SQL in `schema.ts`. And
// `bindCoordinatorInTx` is called from a closed list. MAY ONLY SHRINK.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL, rel } from './helpers.js';

const WRITER = 'server/src/coord/programmeLifecycleStore.ts';
const EXEMPT = 'server/src/coord/schema.ts';
const COLUMN_WRITE = /UPDATE\s+programs\s+SET\b[^;`'"]*?\b(state|planEnd|planEndWhy|planEndAt|coordinator|coordinatorUuid|coordinatorSince|placeholder|filedInto)\s*=/;
const TABLE_WRITE = /(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(programme_events|programme_picks)\b/;
const ROW_CREATE = /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+programs\b/;

/** The files (repo-relative) whose text holds a lifecycle write, by kind. */
export function lifecycleWriters(files: readonly string[]): { columns: string[]; tables: string[]; rows: string[] } {
  const out = { columns: new Set<string>(), tables: new Set<string>(), rows: new Set<string>() };
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const r = rel(f);
    for (const line of src.split('\n')) {
      if (COLUMN_WRITE.test(line)) out.columns.add(r);
      if (TABLE_WRITE.test(line)) out.tables.add(r);
      if (ROW_CREATE.test(line)) out.rows.add(r);
    }
  }
  return { columns: [...out.columns].sort(), tables: [...out.tables].sort(), rows: [...out.rows].sort() };
}

const SOURCES = ALL.filter((f) => rel(f).startsWith('server/src/') || rel(f).startsWith('shared/') || rel(f).startsWith('agent/src/'));

describe('the programme lifecycle has one writer (D-8983)', () => {
  it('CONTROL: a planted second `UPDATE programs SET state` is named', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'lifecycle-census-'));
    try {
      const f = path.join(d, 'planted.ts');
      writeFileSync(f, "db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run('done', s);\n");
      expect(lifecycleWriters([f]).columns).toHaveLength(1);
      writeFileSync(f, "db.prepare('UPDATE programs SET title = ? WHERE slug = ?');\n");
      expect(lifecycleWriters([f]).columns).toHaveLength(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('the decision, its record, the binding and the placeholder are written only by the lifecycle store (and the migration)', () => {
    const w = lifecycleWriters(SOURCES);
    expect(w.columns).toEqual([WRITER, EXEMPT]);
    expect(w.tables).toEqual([WRITER, EXEMPT]);
    expect(w.rows).toEqual([WRITER, EXEMPT]);
  });

  // W1 review (S4): the closed list is of FUNCTIONS, not files, so a new call anywhere in `store.ts` (or a second path in
  // the lifecycle store itself) is named. A call's function is the nearest declaration above it: a top-level `function`,
  // or a class member at two spaces' indent.
  it('CONTROL: a planted call is attributed to its enclosing function', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'lifecycle-census-'));
    try {
      const f = path.join(d, 'planted.ts');
      writeFileSync(f, 'export function bindCoordinatorInTx() {}\nclass C {\n  sneaky(): void {\n    lifecycle.bindCoordinatorInTx(db, s, null);\n  }\n}\n');
      expect(bindCallers([f]).map((c) => c.split('#')[1])).toEqual(['sneaky']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('bindCoordinatorInTx is called from a closed list of functions', () => {
    // The lifecycle store's own writers (`mintInTx`, `startOwnedInTx`, `fileInTx`, `decideInTx`'s end release, the boot
    // re-measure) and `CoordStore#reclaimProgrammeInTx`, the one mover between sessions (spec §3, plan W1 item 8). The
    // registry lane's uuid stamp and seeded-binding release join it in W4.
    expect(bindCallers(SOURCES)).toEqual([
      'server/src/coord/programmeLifecycleStore.ts#decideInTx',
      'server/src/coord/programmeLifecycleStore.ts#fileInTx',
      'server/src/coord/programmeLifecycleStore.ts#mintInTx',
      'server/src/coord/programmeLifecycleStore.ts#remeasureAtBootInTx',
      'server/src/coord/programmeLifecycleStore.ts#startOwnedInTx',
      'server/src/coord/store.ts#reclaimProgrammeInTx',
    ]);
  });
});

/** Every `file#function` whose body calls `bindCoordinatorInTx(`, sorted; the definition itself and comment lines are not
 *  calls. A function is a top-level `function` declaration; in a file that declares a class, also a member at two spaces'
 *  indent (a statement in a top-level function's body sits at the same indent, so the member pattern is a class file's only). */
function bindCallers(files: readonly string[]): string[] {
  const out = new Set<string>();
  const FN = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
  const MEMBER = /^ {2}(?:(?:private|public|protected|static|async)\s+)*(?!(?:if|for|while|switch|return|catch|await|const|let|throw)\b)(\w+)\s*(?:<[^>]*>)?\(/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const classFile = /^(?:export\s+)?class\s/m.test(src);
    let fn = '(top level)';
    for (const line of src.split('\n')) {
      const d = FN.exec(line) ?? (classFile ? MEMBER.exec(line) : null);
      if (d !== null) fn = d[1]!;
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      if (/\bfunction\s+bindCoordinatorInTx\b/.test(line)) continue;
      if (/\bbindCoordinatorInTx\(/.test(line)) out.add(`${rel(f)}#${fn}`);
    }
  }
  return [...out].sort();
}
