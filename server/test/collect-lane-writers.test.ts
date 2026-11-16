// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.9: "Exactly one database writer and one journal append
// adapter exist; only POST and automatic latch call the writer"). The SQL half of that sentence, read as TEXT: every
// statement in server/src that writes `collect_lane_settings` is either the migration's one seed INSERT in schema.ts or
// the one UPDATE inside `CoordStore.setCollectLane`. single-definition.test.ts's wave-10 block holds the TypeScript
// half: the writer's callers, the one append adapter and the one resolver. Comments are dropped (`codeOnly`) and
// strings kept, because the SQL lives in strings. A statement is attributed to the writer by brace-matching the
// method's body over the text with comments and strings blanked (positions kept), so a brace in a quote or a comment
// cannot move the body's end; the body is then sliced from the raw text, so its SQL strings survive.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every .ts/.tsx under `dir`. `__`-prefixed entries are skipped: `boot.test.ts` writes a transient verbatim copy of
 *  index.ts as `server/src/__boot_control_mutant__.ts`, which would read as a second builder of the journal adapter
 *  (single-definition.test.ts's `sources` states the same guard). */
const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('__')) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

/** Blank out comments and string/template bodies, preserving byte positions and newlines:
 *  `stall-settings-route.test.ts`'s helper (itself `coord-caps-route.test.ts`'s), copied unchanged. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const j = text.indexOf('\n', i);
      const e = j < 0 ? text.length : j;
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const e = j < 0 ? text.length : j + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      blank(i + 1, Math.min(j, text.length));
      i = Math.min(j + 1, text.length);
    } else i++;
  }
  return out.join('');
}

/** A statement that writes the table, DDL that alters or drops it included. Case-insensitive, because SQLite reads
 *  `update` as `UPDATE`. `CREATE TABLE` and `SELECT … FROM` are not writes. */
const WRITES_TABLE =
  /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+collect_lane_settings\b/gi;
/** Each write in the code of `text` (comments dropped), normalised to one upper-case spacing. */
const writes = (text: string): string[] =>
  [...codeOnly(text).matchAll(WRITES_TABLE)].map((m) => m[0].replace(/\s+/g, ' ').toUpperCase());

/** The `{…}` body of the first code match of `head`, brace-matched over the blanked text and sliced from the RAW
 *  text. '' when `head` matches no code. */
const bodyOf = (raw: string, head: RegExp): string => {
  const blank = blankCommentsAndStrings(raw);
  const at = blank.search(head);
  if (at < 0) return '';
  const open = blank.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < blank.length; i++) {
    if (blank[i] === '{') depth += 1;
    else if (blank[i] === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(open, i + 1);
    }
  }
  return raw.slice(open);
};

describe('the switch’s SQL has one writer (path-identity spec 2026-10-12 §5.9)', () => {
  const files = (): string[] => sourcesUnder(srcRoot);
  const read = (r: string): string => readFileSync(path.join(srcRoot, r), 'utf8');
  const WRITER_HEAD = /^[ \t]*setCollectLane\s*\(/m;

  it('CONTROL rows prove each scanner sees its definition', () => {
    expect(writes("this.db.prepare('UPDATE collect_lane_settings SET choice = ? WHERE id = 1').run(c);"))
      .toEqual(['UPDATE COLLECT_LANE_SETTINGS']);
    expect(writes("db.exec('INSERT OR REPLACE INTO collect_lane_settings (id) VALUES (1)');"))
      .toEqual(['INSERT OR REPLACE INTO COLLECT_LANE_SETTINGS']);
    expect(writes("db.exec('delete from collect_lane_settings');")).toEqual(['DELETE FROM COLLECT_LANE_SETTINGS']);
    expect(writes('ALTER TABLE collect_lane_settings ADD COLUMN x INTEGER;')).toEqual(['ALTER TABLE COLLECT_LANE_SETTINGS']);
    expect(writes("this.db.prepare('SELECT choice FROM collect_lane_settings WHERE id = 1').get();")).toEqual([]);
    expect(writes('CREATE TABLE collect_lane_settings (id INTEGER PRIMARY KEY CHECK (id = 1));')).toEqual([]);
    expect(writes('// UPDATE collect_lane_settings, in prose\n/* INSERT INTO collect_lane_settings */\n'),
      'a comment is not a write').toEqual([]);
    const planted = [
      'class S {',
      '  setCollectLane(req: R, at: number, journal: J): W {',
      "    const s = '}';",
      '    // } a brace in a comment',
      "    return tx(this.db, () => { this.db.prepare('UPDATE collect_lane_settings SET choice = ? WHERE id = 1').run(s); });",
      '  }',
      "  other(): void { this.db.prepare('UPDATE collect_lane_settings SET choice = ? WHERE id = 1').run('off'); }",
      '}',
    ].join('\n');
    expect(writes(planted), 'the planted file holds two writes').toEqual(['UPDATE COLLECT_LANE_SETTINGS', 'UPDATE COLLECT_LANE_SETTINGS']);
    expect(writes(bodyOf(planted, WRITER_HEAD)), 'the body ends at its own brace, past a quoted one and a commented one')
      .toEqual(['UPDATE COLLECT_LANE_SETTINGS']);
    expect(bodyOf(planted, /^[ \t]*absentMethod\s*\(/m), 'an absent head reads as no body').toBe('');
    expect(files().length, 'the walk reached server/src').toBeGreaterThan(30);
    const body = bodyOf(read(path.join('coord', 'store.ts')), WRITER_HEAD);
    expect(body, 'setCollectLane is not a method of coord/store.ts — this scan is over nothing').not.toBe('');
    expect(body, 'the body found is not the writer: it never appends').toMatch(/\.appendGeneration\s*\(/);
    expect(codeOnly(read(path.join('coord', 'schema.ts'))), 'the table is not created in schema.ts')
      .toMatch(/\bCREATE TABLE collect_lane_settings\b/);
  });

  it('INSERT or UPDATE of collect_lane_settings stands only in schema.ts’s seed and inside setCollectLane', () => {
    const sites = files().flatMap((f) => {
      const w = writes(readFileSync(f, 'utf8'));
      return w.length === 0 ? [] : [`${path.relative(srcRoot, f)}: ${w.join(' | ')}`];
    }).sort();
    expect(sites, 'a second writer of the switch’s row').toEqual([
      `${path.join('coord', 'schema.ts')}: INSERT INTO COLLECT_LANE_SETTINGS`,
      `${path.join('coord', 'store.ts')}: UPDATE COLLECT_LANE_SETTINGS`,
    ]);
    expect(writes(bodyOf(read(path.join('coord', 'store.ts')), WRITER_HEAD)),
      'the store’s one write of the row is not inside setCollectLane').toEqual(['UPDATE COLLECT_LANE_SETTINGS']);
    expect(codeOnly(read(path.join('coord', 'schema.ts'))), 'the INSERT is not the singleton seed')
      .toMatch(/INSERT INTO collect_lane_settings\s*\([^)]*\)\s*VALUES\s*\(\s*1\s*,/);
  });

  it('the journal adapter is built once, in index.ts', () => {
    const CALL = /(?<!function\s+)\bcollectLaneJournalAt\s*\(/g;
    const planted = 'export function collectLaneJournalAt(logPath: string) {}\nconst j = collectLaneJournalAt(p);\n// collectLaneJournalAt(p)\n';
    expect([...blankCommentsAndStrings(planted).matchAll(CALL)].length, 'CONTROL: a call, not the declaration or a comment')
      .toBe(1);
    const sites = files().flatMap((f) => {
      const n = [...blankCommentsAndStrings(readFileSync(f, 'utf8')).matchAll(CALL)].length;
      return n === 0 ? [] : [`${path.relative(srcRoot, f)}:${n}`];
    }).sort();
    expect(sites, 'a second journal adapter instance').toEqual(['index.ts:1']);
    expect(blankCommentsAndStrings(read(path.join('coord', 'collectLaneJournal.ts'))))
      .toMatch(/^export function collectLaneJournalAt\(/m);
  });

  it('the journal path is composed once, in index.ts, and only the adapter and db.ts hold its basename', () => {
    // One append adapter is one writer only while no other file can reach the file by name. A second composition of
    // the path, or a file joining the basename to a directory, could truncate or rebuild the journal without ever
    // calling appendGeneration (path-identity spec 2026-10-12 §5.2: the journal is never reconstructed from the row).
    // db.ts holds the basename for its restore wording only (Task 13).
    const PATH_CALL = /(?<!function\s+)\bdefaultCollectLaneJournalPath\s*\(/g;
    const planted = 'export function defaultCollectLaneJournalPath(d: string) {}\nconst p = defaultCollectLaneJournalPath(d);\n// defaultCollectLaneJournalPath(d)\n';
    expect([...blankCommentsAndStrings(planted).matchAll(PATH_CALL)].length, 'CONTROL: a call, not the declaration or a comment')
      .toBe(1);
    const sites = files().flatMap((f) => {
      const n = [...blankCommentsAndStrings(readFileSync(f, 'utf8')).matchAll(PATH_CALL)].length;
      return n === 0 ? [] : [`${path.relative(srcRoot, f)}:${n}`];
    }).sort();
    expect(sites, 'a second composition of the journal path').toEqual(['index.ts:1']);
    const ALLOWED = [path.join('coord', 'collectLaneJournal.ts'), path.join('coord', 'db.ts')];
    const holders = files()
      .filter((f) => /\bCOLLECT_LANE_JOURNAL_BASENAME\b/.test(blankCommentsAndStrings(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(srcRoot, f));
    expect(holders, 'the definer no longer holds the basename: this scan is over nothing')
      .toContain(path.join('coord', 'collectLaneJournal.ts'));
    expect(holders.filter((h) => !ALLOWED.includes(h)), 'a file that could join the basename to a directory').toEqual([]);
  });
});
