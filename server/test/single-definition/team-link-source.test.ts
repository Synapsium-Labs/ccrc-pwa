// The team link's source has ONE reader (Linear hierarchy wave 8, D-8809, the coordinator's condition on option B). The
// Overlord's link is stored as `teamSource` 'auto' beside the call's id (`project_linking.teamCallId`), because migration 64's
// CHECK on `teamSource` cannot widen without a table rebuild. So exactly one function derives a row's source from the two
// columns, `linkSourceOf` (`server/src/coord/linkingStore.ts#@link-source-of`), and every reader goes through it:
//   (1) no `shared/` or `server/src` file but `linkingStore.ts` names `teamCallId` (the migration that declares the column,
//       `coord/schema.ts`, is the one other holder: a column is declared where the table is);
//   (2) no `shared/` or `server/src` code, outside `linkSourceOf`'s own body and the migration that declares the column's CHECK
//       (`coord/schema.ts`), compares a stored `teamSource` to 'auto': in TypeScript (`===`, `!==`, a `switch` case) or in SQL
//       (`=`, `<>`, `!=`, `IS`, `IS NOT`, `IN (...)`, `CASE teamSource WHEN`). A comparison of a DERIVED source
//       (`source === 'auto'`) is not one.
// It scans text with comments removed, as the other single-definition guards do (`./helpers.ts`). WHAT IT CANNOT SEE: an
// alias (a column read under another name, `SELECT teamSource AS s ... s = 'auto'`, or a TS local copied out of the row), a
// word assembled at run time, and a comparison split across a template literal's interpolation. A reasonable author writing
// the ordinary comparison is stopped; a determined one is not.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL, ccrcRoot, rel, sources, stallCode } from './helpers.js';

const STORE = 'server/src/coord/linkingStore.ts';
const SCHEMA = 'server/src/coord/schema.ts';

/** Source with block comments, `//` line comments and SQL `--` comments removed (a `--` preceded by whitespace or a line
 *  start, so `a--b` in code is kept; a SQL comment inside a string literal is removed too, which only ever narrows the scan
 *  by text that is a comment). */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1').replace(/(^|\s)--\s.*$/, '$1')).join('\n');

/** `linkSourceOf`'s body, cut out of the store's text so the rest can be scanned; the scan refuses a store without it. */
function withoutReader(text: string): string {
  const start = text.indexOf('export function linkSourceOf(');
  expect(start, 'linkSourceOf is gone from the store').toBeGreaterThan(-1);
  const end = text.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(0, start) + text.slice(end + 3);
}

const AUTO = `['"]auto['"]`;
/** A direct read of a stored `teamSource` against 'auto', in each shape (M1): an infix comparison either way round (TS `===`,
 *  `!==`, `==`, `!=`; SQL `=`, `<>`, `!=`, `IS`, `IS NOT`), a SQL `IN (...)` / `NOT IN (...)` list naming it, a SQL
 *  `CASE teamSource WHEN 'auto'`, and a TS `switch (...teamSource...) { ... case 'auto'`. */
const DIRECT = new RegExp([
  `teamSource\\s*(?:===|!==|==|!=|<>|=|IS\\s+NOT|IS)\\s*${AUTO}`,
  `${AUTO}\\s*(?:===|!==|==|!=|<>|=)\\s*[\\w.?]*teamSource\\b`,
  `teamSource\\s+(?:NOT\\s+)?IN\\s*\\([^)]*${AUTO}`,
  `CASE\\s+[\\w.]*teamSource\\s+WHEN\\s+${AUTO}`,
  `switch\\s*\\([^)]*teamSource[^)]*\\)\\s*\\{[^}]*case\\s+${AUTO}`,
].join('|'), 'i');

export function namesCallId(files: ReadonlyArray<{ rel: string; text: string }>): string[] {
  return files.filter((f) => f.rel !== STORE && f.rel !== SCHEMA && /\bteamCallId\b/.test(code(f.text))).map((f) => f.rel).sort();
}
export function directReads(files: ReadonlyArray<{ rel: string; text: string }>): string[] {
  return files.filter((f) => f.rel !== SCHEMA && DIRECT.test(code(f.rel === STORE ? withoutReader(f.text) : f.text))).map((f) => f.rel).sort();
}

const read = (abs: string): { rel: string; text: string } => ({ rel: rel(abs), text: readFileSync(abs, 'utf8') });
const SHARED_AND_SERVER = [...sources(path.join(ccrcRoot, 'shared')), ...sources(path.join(ccrcRoot, 'server/src'))].map(read);

describe('each team door refusal vocabulary is declared once (D-8808, D-8809)', () => {
  it.each(['TEAM_SUGGEST_REFUSALS', 'TEAM_CONFIRM_REFUSALS'])('%s is declared only in shared/linking.ts', (name) => {
    const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, 'g');
    const holders = ALL.flatMap((file) => [...stallCode(file).matchAll(declaration)].map(() => rel(file)));
    expect(holders).toEqual(['shared/linking.ts']);
  });
});

describe('the team link source has one reader (D-8809)', () => {
  it('CONTROL: the scans read something, and the store holds the reader and names the column', () => {
    expect(SHARED_AND_SERVER.length).toBeGreaterThan(100);
    const rels = SHARED_AND_SERVER.map((f) => f.rel);
    for (const f of [STORE, SCHEMA, 'server/src/coord/planStore.ts', 'server/src/linking/teamLink.ts']) expect(rels).toContain(f);
    const store = SHARED_AND_SERVER.find((f) => f.rel === STORE)!.text;
    expect(code(store)).toMatch(/\bteamCallId\b/);
    expect(code(store)).toMatch(/export function linkSourceOf\(/);
  });
  it('no shared/ or server/src file but the store (and the migration) names teamCallId', () => {
    expect(namesCallId(SHARED_AND_SERVER)).toEqual([]);
  });
  it('no shared/ or server/src code but linkSourceOf (and the migration) compares a stored teamSource to auto', () => {
    expect(directReads(SHARED_AND_SERVER)).toEqual([]);
  });
  it('CONTROL: a planted reader is caught, in each shape', () => {
    expect(namesCallId([{ rel: 'server/src/linking/teamLink.ts', text: 'const x = row.teamCallId;' }])).toEqual(['server/src/linking/teamLink.ts']);
    expect(namesCallId([{ rel: 'server/src/linking/teamLink.ts', text: '// teamCallId in prose only' }])).toEqual([]);
    for (const planted of ["if (row.teamSource === 'auto') x();", "if ('auto' !== row.teamSource) x();",
      "db.prepare(\"SELECT 1 FROM project_linking WHERE teamSource = 'auto'\")", "WHERE teamSource IS 'auto'",
      "WHERE project_linking.teamSource IS NOT 'auto'",
      // M1: the SQL `<>`, an IN list, a CASE on the column, and a TS switch on it.
      "WHERE teamSource <> 'auto'", "WHERE teamSource IN ('manual', 'auto')", "WHERE teamSource NOT IN ('auto')",
      "SELECT CASE teamSource WHEN 'auto' THEN 1 ELSE 0 END FROM project_linking",
      "switch (row.teamSource) {\n  case 'manual': return 1;\n  case 'auto': return 2;\n}"]) {
      expect(directReads([{ rel: 'server/src/coord/planStore.ts', text: planted }]), planted).toEqual(['server/src/coord/planStore.ts']);
    }
    // The migration that declares the column's CHECK is the one other place the word sits beside the column.
    expect(directReads([{ rel: SCHEMA, text: "ALTER TABLE project_linking ADD COLUMN teamSource TEXT CHECK (teamSource IN ('manual','auto'));" }])).toEqual([]);
    // A comparison in a comment is no read.
    expect(directReads([{ rel: 'server/src/coord/planStore.ts', text: "-- WHERE teamSource = 'auto'\n// row.teamSource === 'auto'" }])).toEqual([]);
    const store = SHARED_AND_SERVER.find((f) => f.rel === STORE)!.text;
    expect(directReads([{ rel: STORE, text: `${store}\nconst y = (r: { teamSource: string }) => r.teamSource === 'auto';\n` }])).toEqual([STORE]);
    expect(directReads([{ rel: 'server/src/linking/routes.ts', text: "if (source === 'auto') x();" }])).toEqual([]);
  });
});
