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

  it('bindCoordinatorInTx is called from a closed list', () => {
    const callers = new Set<string>();
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      if (/\bbindCoordinatorInTx\(/.test(src)) callers.add(rel(f));
    }
    // The lifecycle store's own callers (`mintInTx`, `fileInTx`, `decideInTx`'s end release, the boot re-measure,
    // `startOwnedInTx`) and `CoordStore#reclaimProgram`, the one mover between sessions.
    expect([...callers].sort()).toEqual(['server/src/coord/programmeLifecycleStore.ts', 'server/src/coord/store.ts']);
  });
});
