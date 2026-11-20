// The team link's source has ONE reader (Linear hierarchy wave 8, D-8809, the coordinator's condition on option B). The
// Overlord's link is stored as `teamSource` 'auto' beside the call's id (`project_linking.teamCallId`), because migration 64's
// CHECK on `teamSource` cannot widen without a table rebuild. So exactly one function derives a row's source from the two
// columns, `linkSourceOf` (`server/src/coord/linkingStore.ts#@link-source-of`), and every reader goes through it:
//   (1) no `shared/` or `server/src` file but `linkingStore.ts` names `teamCallId` (the migration that declares the column,
//       `coord/schema.ts`, is the one other holder: a column is declared where the table is);
//   (2) no code in the linking files or `linkingStore.ts`, outside `linkSourceOf`'s own body, compares a stored `teamSource`
//       to 'auto' (in TypeScript or in a SQL predicate). A comparison of a DERIVED source (`source === 'auto'`) is not one.
// It scans text with comments removed, as the other single-definition guards do (`./helpers.ts`).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ccrcRoot, rel, sources } from './helpers.js';

const STORE = 'server/src/coord/linkingStore.ts';
const SCHEMA = 'server/src/coord/schema.ts';
const LINKING_DIR = path.join(ccrcRoot, 'server/src/linking');

/** Source with block comments, line comments and SQL `--` comments removed. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

/** `linkSourceOf`'s body, cut out of the store's text so the rest can be scanned; the scan refuses a store without it. */
function withoutReader(text: string): string {
  const start = text.indexOf('export function linkSourceOf(');
  expect(start, 'linkSourceOf is gone from the store').toBeGreaterThan(-1);
  const end = text.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(0, start) + text.slice(end + 3);
}

/** A direct read of a stored `teamSource` against 'auto': `teamSource === 'auto'`, `'auto' !== x.teamSource`, a SQL
 *  `teamSource = 'auto'` or `teamSource IS 'auto'`. */
const DIRECT = /teamSource\s*(?:===|!==|==|!=|=|IS NOT|IS)\s*['"]auto['"]|['"]auto['"]\s*(?:===|!==|==|!=)\s*[\w.?]*teamSource\b/;

export function namesCallId(files: ReadonlyArray<{ rel: string; text: string }>): string[] {
  return files.filter((f) => f.rel !== STORE && f.rel !== SCHEMA && /\bteamCallId\b/.test(code(f.text))).map((f) => f.rel).sort();
}
export function directReads(files: ReadonlyArray<{ rel: string; text: string }>): string[] {
  return files.filter((f) => DIRECT.test(code(f.rel === STORE ? withoutReader(f.text) : f.text))).map((f) => f.rel).sort();
}

const read = (abs: string): { rel: string; text: string } => ({ rel: rel(abs), text: readFileSync(abs, 'utf8') });
const SHARED_AND_SERVER = [...sources(path.join(ccrcRoot, 'shared')), ...sources(path.join(ccrcRoot, 'server/src'))].map(read);
const LINKING = [
  ...readdirSync(LINKING_DIR).filter((f) => f.endsWith('.ts')).map((f) => read(path.join(LINKING_DIR, f))),
  read(path.join(ccrcRoot, STORE)),
];

describe('the team link source has one reader (D-8809)', () => {
  it('CONTROL: the scans read something, and the store holds the reader and names the column', () => {
    expect(SHARED_AND_SERVER.length).toBeGreaterThan(100);
    expect(LINKING.map((f) => f.rel)).toContain(STORE);
    expect(LINKING.length).toBeGreaterThan(3);
    const store = LINKING.find((f) => f.rel === STORE)!.text;
    expect(code(store)).toMatch(/\bteamCallId\b/);
    expect(code(store)).toMatch(/export function linkSourceOf\(/);
  });
  it('no shared/ or server/src file but the store (and the migration) names teamCallId', () => {
    expect(namesCallId(SHARED_AND_SERVER)).toEqual([]);
  });
  it('no linking file, and no store code outside linkSourceOf, compares a stored teamSource to auto', () => {
    expect(directReads(LINKING)).toEqual([]);
  });
  it('CONTROL: a planted reader is caught, in each shape', () => {
    expect(namesCallId([{ rel: 'server/src/linking/teamLink.ts', text: 'const x = row.teamCallId;' }])).toEqual(['server/src/linking/teamLink.ts']);
    expect(namesCallId([{ rel: 'server/src/linking/teamLink.ts', text: '// teamCallId in prose only' }])).toEqual([]);
    for (const planted of ["if (row.teamSource === 'auto') x();", "if ('auto' !== row.teamSource) x();",
      "db.prepare(\"SELECT 1 FROM project_linking WHERE teamSource = 'auto'\")", "WHERE teamSource IS 'auto'"]) {
      expect(directReads([{ rel: 'server/src/linking/routes.ts', text: planted }]), planted).toEqual(['server/src/linking/routes.ts']);
    }
    const store = LINKING.find((f) => f.rel === STORE)!.text;
    expect(directReads([{ rel: STORE, text: `${store}\nconst y = (r: { teamSource: string }) => r.teamSource === 'auto';\n` }])).toEqual([STORE]);
    expect(directReads([{ rel: 'server/src/linking/routes.ts', text: "if (source === 'auto') x();" }])).toEqual([]);
  });
});
