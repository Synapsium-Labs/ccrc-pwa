// server/test/history-lib.test.ts
// ccrc history's policy ring, `ccd/history/lib.mjs`, imported directly (the
// `compact-card.test.ts` precedent: a deploy-side `.mjs` the PWA never
// bundles, typed by its hand-written `.d.mts`). Pure: nothing here needs a
// fixture HOME except O53's bash half, which runs ccrc's own `_box_env_value`
// — lifted out of the shipped `ccd/ccrc`, never copied — over the same bytes
// in a scratch directory. Runs on darwin too (spec §13: lib tests run there).
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  EXIT, REASONS, REFUSALS, WRITING_FORMS, STORE_DB_REL, HISTORY_ROOT_REL, STORE_DB_FILE, STORE_FILES, SWITCHES,
  SPOOL_ID_MAX, CARRIER_KILL_S, NODE_KINDS, PARSE_STATUS, ENTRY_PARSE_STATES, PROVENANCE, SEARCHABLE_PROVENANCE,
  SPOOL_EVENTS, SPOOL_SOURCES, EPOCH_CAUSES, DECLARED_BY, ERROR_CODES, COVERAGE, SCOPE_SOURCES, VARIANT_CAUSES,
  BACKENDS, JOURNAL_KINDS, JOURNAL_VERDICTS, BIND_KINDS, MIGRATION_VERDICTS, PASS_WORDS, HEALTH_WORDS,
  UUID_RE, WRITER_RE, idOk, readBoxEnvValue, historyPaths,
} from '../../ccd/history/lib.mjs';
import {
  canonicalJson, JSON_DEPTH_MAX, JSON_NODES_MAX, jsonWithinStructureBound, sha256Hex, sha256Bytes, digestText, leafId, parentId, eventKey, blobShaOfBody, blobShaOfBytes,
} from '../../ccd/history/lib.mjs';
import {
  SPOOL_KEYS, SPOOL_LINE_MAX, DRAINING_NAME_MAX, JOURNAL_V, CONFIRM_BY, GENERATION_VIA, splitSpoolText, parseSpoolLine, drainingNameOk,
  SPOOL_FILE_MAX, SPOOL_FILE_LINES_MAX, spoolLineCount, spoolLinesOverCap,
  parseJournalRecord, journalRecord,
} from '../../ccd/history/lib.mjs';
import * as libPlan from '../../ccd/history/lib.mjs';
import * as libEpoch from '../../ccd/history/lib.mjs';
import * as libRows from '../../ccd/history/lib.mjs';
import * as rowFx from './historyFixtures.js';
import * as libRedact from '../../ccd/history/lib.mjs';
import * as historyCrypto from 'node:crypto';
import * as libExport from '../../ccd/history/lib.mjs';
import * as healthLib from '../../ccd/history/lib.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(REPO, 'ccd', 'history', 'lib.mjs');

describe('lib.mjs is L1: its import block is node:crypto and nothing else (spec §6.4, §13)', () => {
  const src = readFileSync(LIB, 'utf8');

  it('imports exactly node:crypto — no fs, no sqlite, no child_process, nothing that imports them', () => {
    const specs = specsOf(src);
    // Non-vacuity: a reader that matched nothing would pass every ring.
    expect(specs.length, 'the import scan matched nothing').toBeGreaterThan(0);
    expect(specs).toEqual(['node:crypto']);
  });

  it('reaches no module by any other door, and reads no environment', () => {
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/(?<![.\w])import\s*\(/);
    expect(src).not.toMatch(/createRequire/);
    expect(src).not.toMatch(/process\.binding\s*\(/);
    // A decision takes its inputs as arguments; an env read is a seam (§10.1).
    expect(src).not.toMatch(/process\.env/);
  });
});

// The code lines of a source: every line that starts a `//` or `/*` comment, or continues a `*` comment, is
// dropped, and so is a trailing ` //` comment. Comment LINES are dropped, never a block-comment span by regex:
// lib.mjs holds `'.cc-secrets/*'` as a string literal, and a span regex would eat the code between it and the
// next block end. A `https://` inside a string survives (it is not preceded by whitespace).
// KNOWN WIDTH (FU6, B3M25), the scanner's stopping line, evasions it does NOT see: (1) a code line that starts with `*`
// (`* require('x')`) is dropped as if it were a comment continuation; (2) everything after a whitespace-preceded ` //` is
// stripped even inside a string literal (`' //'; require('y')`); (3) the cases that glob files read only `.mjs`, so a `.js` or
// `.cjs` module or preload is outside the census. A ring defect hidden in one of these three forms would pass. They are named
// so a reader does not take the census for a proof of the ring.
const codeOf = (src: string): string => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
// Every module specifier a source imports: `from '…'` (named, default, namespace, multi-line, export-from) and a side-effect `import '…';`.
const specsOf = (src: string): string[] => {
  const c = codeOf(src);
  return [...new Set([...[...c.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!), ...[...c.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!)])];
};
const DOORS = [/\brequire\s*\(/, /(?<![.\w])import\s*\(/, /\bcreateRequire\b/, /process\.binding\s*\(/];
const otherDoors = (src: string): string[] => DOORS.filter((r) => r.test(codeOf(src))).map(String);

describe('every ccd/history module and history test fixture keeps its ring (spec §6.4, §13; plan Global Constraints "Rings"; review 316 F26)', () => {
  const HIST = join(REPO, 'ccd', 'history');
  const FIX = join(REPO, 'server', 'test', 'fixtures', 'history');
  /** L3 never imports an outer ring and only L4 may reach `../compact-card.mjs`; store.mjs is the sole node:sqlite importer. */
  const RINGS: Record<string, { ring: 'L1' | 'L3' | 'L4'; forbids: (s: string) => boolean }> = {
    'lib.mjs': { ring: 'L1', forbids: (s) => s !== 'node:crypto' },
    'store.mjs': { ring: 'L3', forbids: (s) => s === './sweep.mjs' || s === './cli.mjs' || s.startsWith('../') },
    'sweep.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' },
    'cli.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' },
  };
  /**
   * - A preload is a seam from outside (D-4247). It imports only node builtins, never the module graph it patches, with ONE allowance
   *   (FU6, B3M21/B3M22): a lazy `import()` that LAZY_IMPORTS names for that file, exactly. preload-faults.mjs reads store.mjs's
   *   StoreError that way, past its patches, so that a fault it injects is the error class the reader really classifies. A test
   *   preload reading a shipped error class crosses no shipped ring, and the list is per file and exact, never a switch.
   * - run-pass imports the three history modules and node builtins, never `node:sqlite`, so it reaches SQLite only through store.mjs.
   */
  const FIXTURE_RING = (name: string): ((s: string) => boolean) | null =>
    /^preload-[a-z0-9-]+\.mjs$/.test(name) ? (s) => !s.startsWith('node:')
    : name === 'run-pass.mjs' ? (s) => !(/^(\.\.\/){4}ccd\/history\/(sweep|store|lib)\.mjs$/.test(s) || (s.startsWith('node:') && s !== 'node:sqlite'))
    : null;
  const LAZY_IMPORTS: Record<string, string[]> = { 'preload-faults.mjs': ['../../../../ccd/history/store.mjs'] };

  it("CONTROL: the scanner reads named, default, namespace, multi-line, export-from and side-effect imports, skips comment lines, and is not blinded by a /* inside a string", () => {
    expect(specsOf("import a from 'x1';\nimport * as b from 'x2';\nimport {\n c,\n} from 'x3';\nexport { d } from 'x4';\nimport 'x5';\n// import 'x6'\n/* import 'x7' */").sort()).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
    expect(otherDoors("const m = await import('x');")).not.toEqual([]);
    expect(otherDoors('/** Evidence-only import (§8.4): x */')).toEqual([]);
    expect(otherDoors("const g = '.x/*';\nconst m = require('y');\nconst h = '*/';")).not.toEqual([]);
  });

  it('every ccd/history/*.mjs has a ring', () => {
    expect(readdirSync(HIST).filter((n) => n.endsWith('.mjs')).sort()).toEqual(Object.keys(RINGS).sort());
  });

  it('each module imports nothing its ring forbids, and reaches no module by another door', () => {
    for (const m of Object.keys(RINGS)) {
      const src = readFileSync(join(HIST, m), 'utf8');
      const specs = specsOf(src);
      expect(specs.length, `${m}: the scan matched nothing`).toBeGreaterThan(0);
      expect(specs.filter(RINGS[m]!.forbids), m).toEqual([]);
      expect(otherDoors(src), m).toEqual([]);
    }
  });

  it('store.mjs is the sole node:sqlite importer', () => {
    expect(Object.keys(RINGS).filter((m) => specsOf(readFileSync(join(HIST, m), 'utf8')).includes('node:sqlite'))).toEqual(['store.mjs']);
  });

  /** What each `import … from '../compact-card.mjs'` and each `export … from '../compact-card.mjs'` takes (FU6, B3M25: a re-export reaches the module as an import does). */
  const compactCardForms = (src: string): string[] =>
    [...codeOf(src).matchAll(/\b(?:import|export)\s+([^'";]*?)\s+from\s+['"]\.\.\/compact-card\.mjs['"]/g)].map((x) => x[1]!.replace(/\s+/g, ' ').trim());

  it('CONTROL (B3M25): the compact-card form reader sees an import, an export-from and a star re-export, and not a comment', () => {
    expect(compactCardForms("import { isBoundaryLine } from '../compact-card.mjs';")).toEqual(['{ isBoundaryLine }']);
    expect(compactCardForms("export { CARD_PREFIX } from '../compact-card.mjs';")).toEqual(['{ CARD_PREFIX }']);
    expect(compactCardForms("export * from '../compact-card.mjs';")).toEqual(['*']);
    expect(compactCardForms("// export { X } from '../compact-card.mjs';")).toEqual([]);
  });

  it('only L4 imports ../compact-card.mjs, and at most isBoundaryLine', () => {
    let seen = 0;
    for (const m of Object.keys(RINGS)) {
      const src = readFileSync(join(HIST, m), 'utf8');
      if (!specsOf(src).includes('../compact-card.mjs')) continue;
      seen += 1;
      expect(RINGS[m]!.ring, m).toBe('L4');
      const imports = compactCardForms(src);
      expect(imports.length, `${m}: the import form was not read`).toBeGreaterThan(0);
      for (const i of imports) expect(i, m).toBe('{ isBoundaryLine }');
    }
    expect(seen, 'no module imports compact-card: the scan is vacuous').toBeGreaterThan(0);
  });

  it('every fixture under server/test/fixtures/history keeps its ring', () => {
    const names = readdirSync(FIX).filter((n) => n.endsWith('.mjs'));
    expect(names.length, 'no fixture found').toBeGreaterThan(0);
    for (const n of names) {
      const forbids = FIXTURE_RING(n);
      expect(forbids, `${n} has no ring`).not.toBeNull();
      const src = readFileSync(join(FIX, n), 'utf8');
      expect(specsOf(src).filter(forbids!), n).toEqual([]);
      // The one dynamic-import door a fixture may hold is named per file and exact (a list, not a switch): FU4's M30 fault
      // takes StoreError from store.mjs lazily, past its patches. Any other `import(` in a fixture reds.
      const dynamic = [...codeOf(src).matchAll(/(?<![.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((x) => x[1]!);
      expect(dynamic, `${n}: dynamic imports`).toEqual(LAZY_IMPORTS[n] ?? []);
      expect([...codeOf(src).matchAll(/(?<![.\w])import\s*\(/g)].length, `${n}: an import( with a non-literal specifier`).toBe(dynamic.length);
      expect(otherDoors(src).filter((d) => d !== String(DOORS[1])), n).toEqual([]);
    }
  });
});

describe('the exit codes and reason words (spec §8.3; D-4171)', () => {
  it('EXIT holds ten distinct codes, 0..9', () => {
    expect(Object.values(EXIT).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('every reason maps to an EXIT value, and only exits 2, 4, 5 and 7 carry words', () => {
    const codes = new Set(Object.values(EXIT) as number[]);
    for (const [w, c] of Object.entries(REASONS)) expect(codes.has(c), `${w} -> ${c}`).toBe(true);
    expect([...new Set(Object.values(REASONS))].sort()).toEqual([2, 4, 5, 7]);
    expect(REASONS['writer-busy']).toBe(EXIT.WRITER_BUSY);
    expect(REASONS['store-unbound']).toBe(EXIT.DB);
    expect(REASONS['fts5-absent']).toBe(EXIT.FTS_UNAVAILABLE);
  });

  it('--op import\'s two refusals are exit-2 words (Task 26F, D-4313)', () => {
    expect(REASONS['roster-unreadable']).toBe(EXIT.REFUSED);
    expect(REASONS['uuid-claimed']).toBe(EXIT.REFUSED);
    expect(REFUSALS).toEqual(expect.arrayContaining(['roster-unreadable', 'uuid-claimed']));
  });

  it('REFUSALS is DERIVED: exactly the exit-2 words of REASONS, in order', () => {
    expect([...REFUSALS]).toEqual(Object.keys(REASONS).filter((w) => REASONS[w] === EXIT.REFUSED));
    expect(REFUSALS).toContain('bad-id');
    expect(REFUSALS).toContain('apply-in-session');
    expect(REFUSALS).not.toContain('writer-busy');
  });
});

describe('the writing forms (spec §8.4)', () => {
  it('marks the irreversible forms the spec lists, and only those', () => {
    const irr = Object.keys(WRITING_FORMS).filter((f) => WRITING_FORMS[f]!.irreversible).sort();
    expect(irr).toEqual(['adopt', 'import-session-apply', 'prune-apply', 'rebuild', 'repair', 'restore']);
  });

  it('marks the three binding verbs, which are irreversible too', () => {
    const bind = Object.keys(WRITING_FORMS).filter((f) => WRITING_FORMS[f]!.binding).sort();
    expect(bind).toEqual(['adopt', 'rebuild', 'restore']);
    for (const f of bind) expect(WRITING_FORMS[f]!.irreversible, f).toBe(true);
  });
});

describe('the vocabularies are frozen, and each holds what the spec names', () => {
  it('every exported vocabulary refuses mutation, nested rows included', () => {
    for (const v of [EXIT, REASONS, REFUSALS, WRITING_FORMS, STORE_FILES, SWITCHES, NODE_KINDS, PARSE_STATUS,
      ENTRY_PARSE_STATES, PROVENANCE, SEARCHABLE_PROVENANCE, SPOOL_EVENTS, SPOOL_SOURCES, EPOCH_CAUSES,
      DECLARED_BY, ERROR_CODES, COVERAGE, SCOPE_SOURCES, VARIANT_CAUSES, BACKENDS, JOURNAL_KINDS,
      JOURNAL_VERDICTS, BIND_KINDS, MIGRATION_VERDICTS, PASS_WORDS, HEALTH_WORDS]) {
      expect(Object.isFrozen(v)).toBe(true);
    }
    for (const f of Object.values(WRITING_FORMS)) expect(Object.isFrozen(f)).toBe(true);
  });

  it('SEARCHABLE_PROVENANCE is a subset of PROVENANCE; SPOOL_SOURCES of EPOCH_CAUSES', () => {
    for (const p of SEARCHABLE_PROVENANCE) expect(PROVENANCE).toContain(p);
    for (const s of SPOOL_SOURCES) expect(EPOCH_CAUSES).toContain(s);
    expect(SPOOL_SOURCES, 'fork is outside the ruled set (Q16)').not.toContain('fork');
  });

  it('HEALTH_WORDS classes are pass, warn or fail, and the spec\'s state words are WARNs', () => {
    for (const [w, c] of Object.entries(HEALTH_WORDS)) expect(['pass', 'warn', 'fail'], w).toContain(c);
    for (const w of ['off', 'recovering', 'op-running', 'catching-up', 'lag-unmeasured']) expect(HEALTH_WORDS[w], w).toBe('warn');
    for (const w of ['store-unbound', 'export-overdue', 'journal-unwritable', 'recovery-stalled']) expect(HEALTH_WORDS[w], w).toBe('fail');
    expect(HEALTH_WORDS['export-due']).toBe('warn');
  });

  it('CARRIER_KILL_S is the unit\'s 10 minutes, and the grammars match what the hook writes', () => {
    expect(CARRIER_KILL_S).toBe(600);
    expect(UUID_RE.test('0189abcd-1234-5678-9abc-0123456789ab')).toBe(true);
    expect(UUID_RE.test('0189ABCF-1234-5678-9ABC-0123456789AB')).toBe(false);
    expect(WRITER_RE.test('0a1b2c3d')).toBe(true);
    expect(WRITER_RE.test('0a1b2c3')).toBe(false);
  });
});

describe('idOk: no id becomes a path unchecked (spec §8.2; D-4170)', () => {
  it.each([
    ['demo-quiet-basin', true], ['a.b.c', true], ['A_b-9', true],
    ['.', false], ['..', false], ['', false], ['a/b', false], ['../x', false], ['a b', false], ['ä', false],
  ])('%j -> %s', (id, ok) => {
    expect(idOk(id)).toBe(ok);
  });

  it('admits SPOOL_ID_MAX chars and refuses one more', () => {
    expect(idOk('a'.repeat(SPOOL_ID_MAX))).toBe(true);
    expect(idOk('a'.repeat(SPOOL_ID_MAX + 1))).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    for (const v of [null, undefined, 7, ['a'], { id: 'a' }]) expect(idOk(v)).toBe(false);
  });
});

describe('historyPaths: every path derives from the one spelling of each root (spec §5.2)', () => {
  it('puts the DB under STORE_DB_REL and the root at HISTORY_ROOT_REL, beside it', () => {
    const p = historyPaths('/home/u');
    expect(p.dbDir).toBe(`/home/u/${STORE_DB_REL}`);
    expect(p.dbFile).toBe(`/home/u/${STORE_DB_REL}/${STORE_DB_FILE}`);
    expect(p.root).toBe(`/home/u/${HISTORY_ROOT_REL}`);
    expect(`${p.root}/db`).toBe(p.dbDir);
    expect(p.journalDir.startsWith(`${p.root}/`), 'the journal lives on the home filesystem, never under db/').toBe(true);
    expect(p.journalDir.startsWith(p.dbDir)).toBe(false);
    expect(p.off).toBe(`/home/u/${SWITCHES.off}`);
    expect(p.cap).toBe(`/home/u/${SWITCHES.maxGb}`);
    expect(p.journalFile).toBe(`${p.dbFile}-journal`);
  });

  it('a trailing slash on HOME changes nothing; a relative HOME is refused', () => {
    expect(historyPaths('/home/u/')).toEqual(historyPaths('/home/u'));
    expect(() => historyPaths('home/u')).toThrow(/absolute/);
    expect(() => historyPaths('')).toThrow(/absolute/);
  });
});

// O53 (IV11): ONE role reader. `readBoxEnvValue` and the shipped bash
// `_box_env_value` (default two-argument mode, which every doctor caller uses)
// read the same bytes, row by row, and must agree — or the sweep, the CLI and
// doctor could disagree about a server box. The `want` column is what the
// bash measured (2026-10-05) and documents the rules; the pin is that BOTH
// readers give it.
describe('O53: readBoxEnvValue agrees with ccrc\'s _box_env_value, row by row', () => {
  /** `_box_env_value` lifted out of the shipped ccd/ccrc, brace-counted from
   *  its `name() {` line (the deploy-env-guard.test.ts idiom): no second copy
   *  of the bash to drift, and a function that is gone throws here. */
  const BOX_ENV_VALUE = ((): string => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8').split('\n');
    const start = src.findIndex((l) => l.startsWith('_box_env_value() {'));
    if (start === -1) throw new Error('ccd/ccrc no longer defines _box_env_value() — O53 has nothing to compare');
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
      for (const ch of src[i]!) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
      if (depth === 0) return src.slice(start, i + 1).join('\n');
    }
    throw new Error('_box_env_value() never closes');
  })();

  const viaBash = (file: string, key: string): { found: boolean; value: string } => {
    const r = spawnSync('bash', ['-c', `${BOX_ENV_VALUE}\n_box_env_value "$1" "$2"; printf '\\n%s\\n' "$?"`, '_', file, key],
      { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
    const m = /^([\s\S]*)\n([0-9]+)\n$/.exec(r.stdout);
    expect(m, `bash answered nothing parseable: ${JSON.stringify(r.stdout)} ${r.stderr}`).not.toBeNull();
    expect(['0', '1'], 'the default mode answers rc 0 (seen) or 1 (never named)').toContain(m![2]);
    return { found: m![2] === '0', value: m![1]! };
  };

  const ROWS: Array<[string, string, { found: boolean; value: string }]> = [
    ['plain', 'CCRC_ROLE=server\n', { found: true, value: 'server' }],
    ['double-quoted', 'CCRC_ROLE="server"\n', { found: true, value: 'server' }],
    ['single-quoted', "CCRC_ROLE='server'\n", { found: true, value: 'server' }],
    ['an export prefix is not a match', 'export CCRC_ROLE=server\n', { found: false, value: '' }],
    ['CRLF', 'CCRC_ROLE=server\r\n', { found: true, value: 'server' }],
    ['only ONE trailing CR goes', 'CCRC_ROLE=server\r\r\n', { found: true, value: 'server\r' }],
    ['leading space and tab', ' \tCCRC_ROLE=server\n', { found: true, value: 'server' }],
    ['a leading CR', '\rCCRC_ROLE=server\n', { found: true, value: 'server' }],
    ['a trailing space stays', 'CCRC_ROLE=server \n', { found: true, value: 'server ' }],
    ['duplicate keys: the last wins', 'CCRC_ROLE=fleet\nCCRC_ROLE=server\n', { found: true, value: 'server' }],
    ['an empty value is still found', 'CCRC_ROLE=\n', { found: true, value: '' }],
    ['absent', 'CCRC_HOST=127.0.0.1\n', { found: false, value: '' }],
    ['a comment line', '# CCRC_ROLE=server\n', { found: false, value: '' }],
    ['mismatched quotes stay', 'CCRC_ROLE="server\'\n', { found: true, value: '"server\'' }],
    ['a lone quote stays', 'CCRC_ROLE="\n', { found: true, value: '"' }],
    ['a quote then a space stays', 'CCRC_ROLE="server" \n', { found: true, value: '"server" ' }],
    ['a space before = is not a match', 'CCRC_ROLE =server\n', { found: false, value: '' }],
    ['a longer key is not a match', 'CCRC_ROLE_X=server\n', { found: false, value: '' }],
    ['no final newline', 'CCRC_HOST=x\nCCRC_ROLE=both', { found: true, value: 'both' }],
    ['an empty file', '', { found: false, value: '' }],
    ['one layer of quotes only', 'CCRC_ROLE="a"b"\n', { found: true, value: 'a"b' }],
  ];

  it.each(ROWS)('%s', (_what, text, want) => {
    const dir = mkTmp('ccrc-history-o53-');
    const file = join(dir, 'ccrc.env');
    writeFileSync(file, text);
    expect(readBoxEnvValue(text, 'CCRC_ROLE'), 'readBoxEnvValue').toEqual(want);
    expect(viaBash(file, 'CCRC_ROLE'), '_box_env_value').toEqual(want);
  });
});

describe('canonical JSON and the digests (spec §6.1, §6.5, §9.14)', () => {
  it('sorts object keys by UTF-16 code unit at every depth, keeps array order, and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }], e: undefined })).toBe('{"a":[3,{"c":2,"d":1}],"b":1}');
    expect(canonicalJson({ i: 1, I: 2, 'ı': 3, 'İ': 4, a: 5 })).toBe('{"I":2,"a":5,"i":1,"İ":4,"ı":3}');
    expect(canonicalJson('x\n"y"')).toBe(JSON.stringify('x\n"y"'));
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson([undefined])).toBe('[null]');
  });

  it('walks a body nested 100,000 levels deep without a stack overflow (D-4304)', () => {
    const depth = 100_000;
    const text = `${'{"a":['.repeat(depth)}1${']}'.repeat(depth)}`;
    const body = JSON.parse(text);
    expect(canonicalJson(body)).toBe(text);
    expect(blobShaOfBody(body).length).toBe(32);
  });

  it('one body is one address however its keys arrived', () => {
    expect(blobShaOfBody({ a: 1, b: [1, 2] }).equals(blobShaOfBody({ b: [1, 2], a: 1 }))).toBe(true);
    expect(blobShaOfBody({ a: 1 }).equals(blobShaOfBody({ a: 2 }))).toBe(false);
    expect(blobShaOfBytes(Buffer.from('abc')).toString('hex')).toBe(sha256Hex('abc'));
    expect(sha256Bytes('abc').toString('hex')).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('digestText is the domain prefix then a NUL before each part (§11 V3)', () => {
    expect(digestText('p', ['a', 'b'])).toBe(createHash('sha256').update('p\u0000a\u0000b').digest('hex'));
    // The separator is what keeps two splits of one string apart.
    expect(digestText('p', ['ab', 'c'])).not.toBe(digestText('p', ['a', 'bc']));
    expect(digestText('p', [])).toBe(createHash('sha256').update('p').digest('hex'));
  });

  it('leaf and parent ids are a letter and 20 hex; the boundary-qualified leaf differs from the plain one', () => {
    const u1 = '0189abcd-1234-5678-9abc-0123456789ab';
    const u2 = '0189abcd-1234-5678-9abc-0123456789ac';
    const plain = leafId('demo-quiet-basin', u1, u2);
    expect(plain).toMatch(/^L[0-9a-f]{20}$/);
    expect(plain).toBe(`L${digestText('ccrc-leaf/v1', ['demo-quiet-basin', u1, u2]).slice(0, 20)}`);
    const forked = leafId('demo-quiet-basin', u1, u2, '0189abcd-1234-5678-9abc-0123456789ad');
    expect(forked).toMatch(/^L[0-9a-f]{20}$/);
    expect(forked).not.toBe(plain);
    expect(parentId([plain, forked])).toMatch(/^N[0-9a-f]{20}$/);
    expect(parentId([plain, forked])).not.toBe(parentId([forked, plain]));
  });

  it('eventKey depends on the draining name and the ordinal only — never on a clock', () => {
    const k = eventKey('demo-quiet-basin.1700000000000.4242.jsonl', 1);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(eventKey('demo-quiet-basin.1700000000000.4242.jsonl', 1)).toBe(k);
    expect(eventKey('demo-quiet-basin.1700000000000.4242.jsonl', 2)).not.toBe(k);
    expect(eventKey('demo-quiet-basin.1700000000001.4242.jsonl', 1)).not.toBe(k);
    expect(eventKey.length, 'eventKey takes exactly the name and the ordinal').toBe(2);
  });
});

describe('jsonWithinStructureBound: the structure gate a transcript line passes before any parse (D-4345)', () => {
  const B = (t: string): Buffer => Buffer.from(t);
  it('the bounds are 100,000 levels and 500,000 units', () => {
    expect(JSON_DEPTH_MAX).toBe(100_000);
    expect(JSON_NODES_MAX).toBe(500_000);
    expect(ERROR_CODES).toContain('line-too-complex');
  });
  it('depth: exactly JSON_DEPTH_MAX passes, one more is refused', () => {
    expect(jsonWithinStructureBound(B('['.repeat(JSON_DEPTH_MAX) + ']'.repeat(JSON_DEPTH_MAX)))).toBe(true);
    expect(jsonWithinStructureBound(B('['.repeat(JSON_DEPTH_MAX + 1) + ']'.repeat(JSON_DEPTH_MAX + 1)))).toBe(false);
    expect(jsonWithinStructureBound(B('{"a":'.repeat(JSON_DEPTH_MAX + 1) + '0' + '}'.repeat(JSON_DEPTH_MAX + 1)))).toBe(false);
  });
  it('units: exactly JSON_NODES_MAX passes, one more is refused; commas and opens both count', () => {
    expect(jsonWithinStructureBound(B('[' + '0,'.repeat(JSON_NODES_MAX - 1) + '0]'))).toBe(true);   // 1 open + MAX-1 commas
    expect(jsonWithinStructureBound(B('[' + '0,'.repeat(JSON_NODES_MAX) + '0]'))).toBe(false);
    expect(jsonWithinStructureBound(B('[' + '{},'.repeat(JSON_NODES_MAX / 2) + '{}]'))).toBe(false);
  });
  it('brackets and commas inside strings never count, an escaped quote included', () => {
    expect(jsonWithinStructureBound(B(JSON.stringify({ a: '['.repeat(JSON_DEPTH_MAX + 1) + ','.repeat(JSON_NODES_MAX + 1) })))).toBe(true);
    expect(jsonWithinStructureBound(B(JSON.stringify({ a: '"' + '['.repeat(JSON_DEPTH_MAX + 1) })))).toBe(true);
    expect(jsonWithinStructureBound(B(JSON.stringify(['\\', '['.repeat(JSON_DEPTH_MAX + 1)])))).toBe(true);
    expect(jsonWithinStructureBound(B(JSON.stringify(['é€😀'.repeat(1000)])))).toBe(true);
  });
  it('bytes that are not JSON are not this gate\'s: unbalanced closers and garbage pass, JSON.parse refuses them', () => {
    for (const t of [']]]]', '}}{,', 'not json']) expect(jsonWithinStructureBound(B(t)), t).toBe(true);
  });
});

// DM8: the canonical hash and every id are identical under LC_ALL=tr_TR.UTF-8
// and LC_ALL=C. Run in CHILD processes, because a locale is a process
// property; each child imports lib.mjs by file URL and prints what it
// computed. The CONTROL is the tr child's own Intl locale: Node's ICU needs
// no OS locale (spec §6.7, measured), but a small-icu build resolves tr-TR to
// something else, and then this case skips and says so instead of passing
// vacuously.
describe('DM8: ids and the canonical hash do not move with the locale', () => {
  const PROBE = [
    `import { canonicalJson, leafId, eventKey } from ${JSON.stringify(pathToFileURL(LIB).href)};`,
    "const body = { i: 1, I: 2, 'ı': 3, 'İ': 4, a: 5, nested: { 'İ': [1, { z: 1, Z: 2 }] } };",
    'process.stdout.write(JSON.stringify({',
    '  locale: Intl.DateTimeFormat().resolvedOptions().locale,',
    '  canon: canonicalJson(body),',
    "  leaf: leafId('İstanbul-ıi', '0189abcd-1234-5678-9abc-0123456789ab', '0189abcd-1234-5678-9abc-0123456789ac'),",
    "  key: eventKey('İ.1700000000000.1.jsonl', 3),",
    '}));',
  ].join('\n');

  const run = (lc: string): { locale: string; canon: string; leaf: string; key: string } => {
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', LC_ALL: lc, LANG: lc };
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', PROBE], { encoding: 'utf8', env });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as { locale: string; canon: string; leaf: string; key: string };
  };

  it('tr_TR.UTF-8 and C compute the same canonical JSON, leaf id and event key', (ctx) => {
    const tr = run('tr_TR.UTF-8');
    if (tr.locale !== 'tr-TR') {
      ctx.skip(`this node resolves tr_TR to ${tr.locale} (small-icu?) — DM8 cannot see a locale here`);
      return;
    }
    const c = run('C');
    expect(c.locale, 'the C child must not ALSO be Turkish, or the comparison is vacuous').not.toBe('tr-TR');
    expect(tr.canon).toBe(c.canon);
    expect(tr.canon).toBe('{"I":2,"a":5,"i":1,"nested":{"İ":[1,{"Z":2,"z":1}]},"İ":4,"ı":3}');
    expect(tr.leaf).toBe(c.leaf);
    expect(tr.key).toBe(c.key);
  });
});

// ── the spool grammar (spec §5.1, §9.2 step 1; S5, S14, S17, C66's spool half) ─
const U1 = '0189abcd-1234-5678-9abc-0123456789ab';
const U2 = '0189abcd-1234-5678-9abc-0123456789ac';
const G1 = '0189abcd-1234-5678-9abc-0123456789ad';
const line = (o: object): string => JSON.stringify(o);

describe('SPOOL_KEYS: one key set per spool event', () => {
  it('names exactly SPOOL_EVENTS, with disjoint required and optional keys', () => {
    expect(Object.keys(SPOOL_KEYS).sort()).toEqual([...SPOOL_EVENTS].sort());
    for (const [ev, set] of Object.entries(SPOOL_KEYS)) {
      for (const k of set.required) expect(set.optional, `${ev}: ${k} is both`).not.toContain(k);
      for (const k of ['v', 'ev', 'id']) expect(set.required, `${ev} must require ${k}`).toContain(k);
      expect(Object.isFrozen(set) && Object.isFrozen(set.required) && Object.isFrozen(set.optional)).toBe(true);
    }
    // D-4177: no key carries summary text or its hash.
    for (const set of Object.values(SPOOL_KEYS)) {
      for (const k of [...set.required, ...set.optional]) expect(k).not.toMatch(/summary|text|transcript|path/i);
    }
  });
});

describe('splitSpoolText: empty lines take no ordinal (S17)', () => {
  it('a fenced file and an unfenced one give the same ordinals and the same event keys', () => {
    const a = line({ v: 1, ev: 'Stop', id: 'demo-quiet-basin' });
    const b = line({ v: 1, ev: 'SessionStart', id: 'demo-quiet-basin', sid: U2, src: 'clear' });
    const fenced = splitSpoolText(`\n${a}\n\n${b}\n`);
    const bare = splitSpoolText(`${a}\n${b}\n`);
    expect(fenced).toEqual([{ ordinal: 1, raw: a }, { ordinal: 2, raw: b }]);
    expect(fenced).toEqual(bare);
    const name = 'demo-quiet-basin.1700000000000.4242.jsonl';
    expect(fenced.map((l) => eventKey(name, l.ordinal))).toEqual(bare.map((l) => eventKey(name, l.ordinal)));
  });

  it('a partial line left by a short write is one rejected line, and the fenced line after it still parses', () => {
    const clear = line({ v: 1, ev: 'SessionStart', id: 'demo-quiet-basin', sid: U2, src: 'clear' });
    const got = splitSpoolText(`\n{"v":1,"ev":"Sto\n${clear}\n`);
    expect(got.map((l) => l.ordinal)).toEqual([1, 2]);
    expect(parseSpoolLine(got[0]!.raw)).toEqual({ ok: false, why: 'json' });
    expect(parseSpoolLine(got[1]!.raw).ok).toBe(true);
  });

  it('a last fragment with no newline is still returned, as a line', () => {
    expect(splitSpoolText('{"v":1}\n{"v"')).toEqual([{ ordinal: 1, raw: '{"v":1}' }, { ordinal: 2, raw: '{"v"' }]);
    expect(splitSpoolText('')).toEqual([]);
    expect(splitSpoolText('\n\n')).toEqual([]);
  });

  it('spoolLineCount counts on the bytes exactly the ordinals splitSpoolText assigns (D-4337)', () => {
    for (const t of ['', '\n\n', 'a', 'a\n', '\na\n\nb\n', '{"v":1}\n{"v"', 'é\n\n€x', '\r\n\r\n', '😀\n']) {
      expect(spoolLineCount(Buffer.from(t)), JSON.stringify(t)).toBe(splitSpoolText(t).length);
    }
    const b = Buffer.from([0xe2, 0x0a, 0x41, 0x0a, 0xff, 0x0a, 0x0a]);   // invalid UTF-8
    expect(spoolLineCount(b)).toBe(splitSpoolText(b.toString('utf8')).length);
    expect(spoolLineCount(b)).toBe(3);
  });

  it('SPOOL_FILE_LINES_MAX is SPOOL_FILE_MAX / SPOOL_LINE_MAX, and spoolLinesOverCap is strictly over it; empty lines count none', () => {
    expect(SPOOL_FILE_LINES_MAX).toBe(65536);
    expect(SPOOL_FILE_LINES_MAX).toBe(SPOOL_FILE_MAX / SPOOL_LINE_MAX);
    expect(spoolLinesOverCap(Buffer.from('a\n'.repeat(SPOOL_FILE_LINES_MAX)))).toBe(false);
    expect(spoolLinesOverCap(Buffer.from('a\n'.repeat(SPOOL_FILE_LINES_MAX + 1)))).toBe(true);
    expect(spoolLinesOverCap(Buffer.from('\n'.repeat(4 * SPOOL_FILE_LINES_MAX) + 'a'))).toBe(false);
  });

  it('splitSpoolText never builds a segment array: it does not call String.prototype.split (review 316 F6)', () => {
    const spy = vi.spyOn(String.prototype, 'split');
    let got: unknown; let calls = -1;
    try { got = splitSpoolText('\n'.repeat(1000) + 'a\n\nb'); calls = spy.mock.calls.length; }
    finally { spy.mockRestore(); }
    expect(got).toEqual([{ ordinal: 1, raw: 'a' }, { ordinal: 2, raw: 'b' }]);
    expect(calls).toBe(0);
  });
});

describe('parseSpoolLine: the S5 key set and value grammar', () => {
  it.each([
    ['a bare Stop', { v: 1, ev: 'Stop', id: 'demo-quiet-basin' }],
    ['a full Stop', { v: 1, ev: 'Stop', id: 'demo-quiet-basin', sid: U1, gen: G1, ts: 1700000000123 }],
    ['PostCompact with trig', { v: 1, ev: 'PostCompact', id: 'a.b.c', sid: U1, trig: 'manual' }],
    ['SessionStart(startup) with reg', { v: 1, ev: 'SessionStart', id: 'x', sid: U1, src: 'startup', reg: U1, gen: G1 }],
    ['SessionStart(resume) without reg', { v: 1, ev: 'SessionStart', id: 'x', sid: U1, src: 'resume' }],
    ['SessionStart(clear)', { v: 1, ev: 'SessionStart', id: 'x', sid: U2, src: 'clear', ts: 1 }],
    ['recall', { v: 1, ev: 'recall', id: 'x', cmd: 'grep', rc: 3, ms: 41, gen: G1, arm: 'control' }],
    ['steer with no leaf yet', { v: 1, ev: 'steer', id: 'x', sid: U1, leaf: '' }],
    ['steer with a leaf', { v: 1, ev: 'steer', id: 'x', sid: U1, leaf: `L${'a'.repeat(20)}` }],
  ])('accepts %s', (_what, o) => {
    expect(parseSpoolLine(line(o))).toEqual({ ok: true, rec: o });
  });

  it.each([
    ['not JSON', 'nope', 'json'],
    ['an array', '[1]', 'not-object'],
    ['null', 'null', 'not-object'],
    ['no ev', line({ v: 1, id: 'x' }), 'keys'],
    ['an unknown ev', line({ v: 1, ev: 'Fork', id: 'x' }), 'value'],
    ['SessionStart without src (S14)', line({ v: 1, ev: 'SessionStart', id: 'x', sid: U1 }), 'keys'],
    ['SessionStart(fork) (S14, Q16)', line({ v: 1, ev: 'SessionStart', id: 'x', sid: U1, src: 'fork' }), 'value'],
    ['SessionStart(compact) (S14)', line({ v: 1, ev: 'SessionStart', id: 'x', sid: U1, src: 'compact' }), 'value'],
    ['reg on a clear line', line({ v: 1, ev: 'SessionStart', id: 'x', sid: U1, src: 'clear', reg: U1 }), 'keys'],
    ['an undeclared key', line({ v: 1, ev: 'Stop', id: 'x', summary: 'hi' }), 'keys'],
    ['id ".." (C66)', line({ v: 1, ev: 'Stop', id: '..' }), 'bad-id'],
    ['id "a/b" (C66)', line({ v: 1, ev: 'Stop', id: 'a/b' }), 'bad-id'],
    ['a 225-char id (C66)', line({ v: 1, ev: 'Stop', id: 'a'.repeat(SPOOL_ID_MAX + 1) }), 'bad-id'],
    ['v 2', line({ v: 2, ev: 'Stop', id: 'x' }), 'value'],
    ['a sid that is not a uuid', line({ v: 1, ev: 'Stop', id: 'x', sid: 'uuid-1' }), 'value'],
    ['an uppercase uuid', line({ v: 1, ev: 'Stop', id: 'x', gen: G1.toUpperCase() }), 'value'],
    ['trig "x"', line({ v: 1, ev: 'PostCompact', id: 'x', trig: 'x' }), 'value'],
    ['ts 0', line({ v: 1, ev: 'Stop', id: 'x', ts: 0 }), 'value'],
    ['ts 1.5', line({ v: 1, ev: 'Stop', id: 'x', ts: 1.5 }), 'value'],
    ['rc 256', line({ v: 1, ev: 'recall', id: 'x', cmd: 'grep', rc: 256, ms: 1 }), 'value'],
    ['a leaf of the wrong shape', line({ v: 1, ev: 'steer', id: 'x', sid: U1, leaf: `N${'a'.repeat(20)}` }), 'value'],
  ])('refuses %s', (_what, raw, why) => {
    expect(parseSpoolLine(raw)).toEqual({ ok: false, why });
  });

  it('S5: a 50 KB summary inside a line is too-long, judged before it is parsed', () => {
    expect(parseSpoolLine(line({ v: 1, ev: 'PostCompact', id: 'x', summary: 's'.repeat(50 * 1024) }))).toEqual({ ok: false, why: 'too-long' });
  });

  it('the bound is UTF-8 bytes, not characters, and SPOOL_LINE_MAX itself is admitted', () => {
    const head = '{"v":1,"ev":"Stop","id":"x"';
    const at = `${head}${' '.repeat(SPOOL_LINE_MAX - head.length - 1)}}`;
    expect(Buffer.byteLength(at)).toBe(SPOOL_LINE_MAX);
    expect(parseSpoolLine(at).ok).toBe(true);
    expect(parseSpoolLine(`${head}${' '.repeat(SPOOL_LINE_MAX - head.length)}}`)).toEqual({ ok: false, why: 'too-long' });
    // 602 characters, 1,202 bytes: a character count would have parsed it.
    expect(parseSpoolLine(`"${'ı'.repeat(600)}"`)).toEqual({ ok: false, why: 'too-long' });
  });

  it('S5: the largest SessionStart line the hook can write — a 224-char id, every field — fits', () => {
    const o = { v: 1, ev: 'SessionStart', id: 'a'.repeat(SPOOL_ID_MAX), sid: U1, src: 'startup', reg: U1, gen: G1, ts: 9_999_999_999_999 };
    expect(Buffer.byteLength(line(o))).toBeLessThan(SPOOL_LINE_MAX);
    expect(parseSpoolLine(line(o)).ok).toBe(true);
  });
});

describe('drainingNameOk: the draining file names the journal records', () => {
  it.each([
    ['demo-quiet-basin.1700000000000.4242.jsonl', true],
    ['a.b.c.1700000000000.4242.jsonl', true],
    [`${'a'.repeat(SPOOL_ID_MAX)}.1700000000000.4242.jsonl`, true],
    ['...1700000000000.4242.jsonl', false],
    ['x.1700000000000.jsonl', false],
    ['x.1700000000000.4242.json', false],
    ['a/b.1.2.jsonl', false],
  ])('%s -> %s', (name, ok) => {
    expect(drainingNameOk(name)).toBe(ok);
  });

  it('refuses a name over 255 bytes even when its id passes', () => {
    const name = `${'a'.repeat(SPOOL_ID_MAX)}.1700000000000000.4294967295.jsonl`;
    expect(Buffer.byteLength(name)).toBeGreaterThan(255);
    expect(drainingNameOk(name)).toBe(false);
  });

  // D-4303 (draining-name-253): a name's sidecar temp is the name plus two
  // bytes, so 253 is the longest admitted name whose `.obs.tmp` fits NAME_MAX.
  it('admits 253 bytes and refuses 254 and 255: the sidecar temp must fit 255 D-4303', () => {
    const at = (idLen: number) => `${'a'.repeat(idLen)}.1700000000000.4294967295.jsonl`;
    expect(DRAINING_NAME_MAX).toBe(253);
    expect(Buffer.byteLength(at(222))).toBe(253);
    expect(Buffer.byteLength(at(223))).toBe(254);
    expect(Buffer.byteLength(at(224))).toBe(255);
    expect(drainingNameOk(at(222))).toBe(true);
    expect(drainingNameOk(at(223))).toBe(false);
    expect(drainingNameOk(at(224))).toBe(false);
    // the temp of the longest admitted name fits; the temp of the first refused one does not
    const temp = (n: string) => Buffer.byteLength(`${n.slice(0, -'.jsonl'.length)}.obs.tmp`);
    expect(temp(at(222))).toBeLessThanOrEqual(255);
    expect(temp(at(223))).toBeGreaterThan(255);
  });

  it('the longest name the sweep itself renames to (224-char id, 13-digit tick, 7-digit pid) is admitted D-4303', () => {
    const name = `${'a'.repeat(SPOOL_ID_MAX)}.1791244261576.1234567.jsonl`;
    expect(Buffer.byteLength(name)).toBe(252);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(DRAINING_NAME_MAX);
    expect(drainingNameOk(name)).toBe(true);
  });
});

// O56's parseJournalRecord half (IV4): the four answers are four, in-process,
// on lib.mjs alone.
describe('parseJournalRecord: record, malformed, unknown, newer (O56)', () => {
  const NAME = 'demo-quiet-basin.1700000000000.4242.jsonl';
  const KEY = 'a'.repeat(64);

  it('the four answers', () => {
    const rec = { v: 1, k: 'tick', t: 1700000000000, lag_ms: 120 };
    expect(parseJournalRecord(JSON.stringify(rec))).toEqual({ kind: 'record', rec });
    expect(parseJournalRecord('{"v":1,"k":"tick","t":17')).toEqual({ kind: 'malformed' });
    expect(parseJournalRecord(JSON.stringify({ v: 1, k: 'gossip', t: 1 }))).toEqual({ kind: 'unknown' });
    expect(parseJournalRecord(JSON.stringify({ v: 2, k: 'tick', t: 1, lag_ms: 1 }))).toEqual({ kind: 'newer' });
  });

  it('a verdict kind outside JOURNAL_VERDICTS is unknown; a non-string kind is malformed', () => {
    expect(parseJournalRecord(JSON.stringify({ v: 1, k: 'verdict', t: 1, event_key: 'none', kind: 'promoted' }))).toEqual({ kind: 'unknown' });
    expect(parseJournalRecord(JSON.stringify({ v: 1, k: 'verdict', t: 1, event_key: 'none', kind: 7 }))).toEqual({ kind: 'malformed' });
  });

  it.each([
    ['head', { store_id: U1, month: '2026-10', writer: '0a1b2c3d' }],
    ['file', { name: NAME }],
    ['spool', { ord: 1, rec: { v: 1, ev: 'SessionStart', id: 'demo-quiet-basin', sid: U1, src: 'startup', reg: U1 } }],
    ['redact', { len: 43, sha256: KEY }],
    ['tick', { lag_ms: null }],
  ])('reads a well-formed %s record back as a record', (k, fields) => {
    const l = journalRecord(k as 'head', 1700000000000, fields);
    expect(l).toBe(JSON.stringify({ v: 1, k, t: 1700000000000, ...fields }));
    expect(parseJournalRecord(l).kind).toBe('record');
  });

  it.each([
    ['family', { event_key: 'none', kind: 'family', ccrc_id: 'demo-quiet-basin', generation: G1, project: 'orchard-api', first_seen_ms: 1 }],
    ['epoch-confirmed', { event_key: KEY, kind: 'epoch-confirmed', ccrc_id: 'x', generation: '', cc_session_uuid: U1, cause: 'startup', declared_by: 'hook', by: 'reg' }],
    ['epoch-unconfirmed', { event_key: KEY, kind: 'epoch-unconfirmed', ccrc_id: 'x', generation: G1, cc_session_uuid: U1, superseded: true }],
    ['epoch-chained', { event_key: KEY, kind: 'epoch-chained', ccrc_id: 'x', generation: G1, cc_session_uuid: U2, cause: 'clear' }],
    ['generation-joined', { event_key: KEY, kind: 'generation-joined', ccrc_id: 'x', generation: '', via: 'unreadable' }],
    ['rekeyed', { event_key: 'none', kind: 'rekeyed', ccrc_id: 'x', generation: G1 }],
    ['mapping', { event_key: 'none', kind: 'mapping', ccrc_id: 'x', generation: G1, cc_session_uuid: U1, declared_by: 'operator', path: '/home/u/.claude-a/projects/p/u.jsonl' }],
    ['mapping without a path', { event_key: 'none', kind: 'mapping', ccrc_id: 'x', generation: G1, cc_session_uuid: U1, declared_by: 'registry' }],
    ['bind', { event_key: 'none', kind: 'bind', bind: 'adopt', writer: '0a1b2c3d' }],
    ['drained', { event_key: 'none', kind: 'drained', file: NAME }],
  ])('reads a well-formed %s verdict back as a record', (_what, fields) => {
    expect(parseJournalRecord(journalRecord('verdict', 5, fields)).kind).toBe('record');
  });

  // D-4342 (history-epoch-causes-widened-for-rollback): a box rolled back from B2 reads a fork verdict.
  it("reads an epoch-confirmed verdict with cause 'fork' back as a record (D-4342)", () => {
    const fields = { event_key: KEY, kind: 'epoch-confirmed', ccrc_id: 'x', generation: '', cc_session_uuid: U1, cause: 'fork', declared_by: 'registry', by: 'reg' };
    const rec = JSON.parse(journalRecord('verdict', 5, fields)) as Record<string, unknown>;
    expect(rec['cause']).toBe('fork');
    expect(parseJournalRecord(JSON.stringify(rec))).toEqual({ kind: 'record', rec });
  });

  it.each([
    ['an extra field', JSON.stringify({ v: 1, k: 'tick', t: 1, lag_ms: 1, text: 'x' })],
    ['a missing field', JSON.stringify({ v: 1, k: 'head', t: 1, store_id: U1, month: '2026-10' })],
    ['month 13', JSON.stringify({ v: 1, k: 'head', t: 1, store_id: U1, month: '2026-13', writer: '0a1b2c3d' })],
    ['a negative time', JSON.stringify({ v: 1, k: 'tick', t: -1, lag_ms: 1 })],
    ['v 0', JSON.stringify({ v: 0, k: 'tick', t: 1, lag_ms: 1 })],
    ['a spool rec that fails the grammar', JSON.stringify({ v: 1, k: 'spool', t: 1, ord: 1, rec: { v: 1, ev: 'SessionStart', id: 'x', sid: U1, src: 'fork' } })],
    ['a spool rec with a bad id', JSON.stringify({ v: 1, k: 'spool', t: 1, ord: 1, rec: { v: 1, ev: 'Stop', id: '..' } })],
    ['a chained epoch whose cause is not clear', JSON.stringify({ v: 1, k: 'verdict', t: 1, event_key: KEY, kind: 'epoch-chained', ccrc_id: 'x', generation: '', cc_session_uuid: U1, cause: 'resume' })],
    ['a rekey to the empty generation', JSON.stringify({ v: 1, k: 'verdict', t: 1, event_key: 'none', kind: 'rekeyed', ccrc_id: 'x', generation: '' })],
    ['an event key that is not 64 hex', JSON.stringify({ v: 1, k: 'verdict', t: 1, event_key: 'abc', kind: 'drained', file: NAME })],
    ['a file record naming a path', JSON.stringify({ v: 1, k: 'file', t: 1, name: '../x.1.2.jsonl' })],
  ])('refuses %s as malformed', (_what, l) => {
    expect(parseJournalRecord(l)).toEqual({ kind: 'malformed' });
  });

  it('CONFIRM_BY and GENERATION_VIA are frozen; JOURNAL_V is 1', () => {
    expect(JOURNAL_V).toBe(1);
    expect(Object.isFrozen(CONFIRM_BY) && Object.isFrozen(GENERATION_VIA)).toBe(true);
    expect([...GENERATION_VIA]).toEqual(['line', 'registry', 'absent', 'unreadable']);
  });
});

describe('journalRecord: the writer can never append a line its own reader skips', () => {
  it('refuses a kind outside JOURNAL_KINDS', () => {
    expect(() => journalRecord('gossip' as 'tick', 1, {})).toThrow(/JOURNAL_KINDS/);
  });

  it('refuses fields that would read back as anything but a record', () => {
    expect(() => journalRecord('tick', 1, { lag_ms: 'soon' })).toThrow(/reads back as malformed/);
    expect(() => journalRecord('verdict', 1, { event_key: 'none', kind: 'promoted' })).toThrow(/reads back as unknown/);
    expect(() => journalRecord('tick', 1, { lag_ms: 1, v: 2 })).toThrow(/reads back as newer/);
  });

  it('puts v, k and t first, then the fields in the order given', () => {
    expect(journalRecord('redact', 7, { len: 43, sha256: 'b'.repeat(64) }))
      .toBe(`{"v":1,"k":"redact","t":7,"len":43,"sha256":"${'b'.repeat(64)}"}`);
  });
});

// ===========================================================================
// Task 6: the planners and gates, pinned in-process on lib.mjs alone. They
// are L1 decisions (O56), so these cases need no fixture HOME, no spawn and
// no clock, and they run on every platform, darwin included (O24).
// ===========================================================================
const PLAN_SID = '0189abcd-1234-4678-9abc-0123456789ab';
const PLAN_OTHER = '0189abcd-1234-4678-9abc-ba9876543210';
const planAbsent: libPlan.Presence<string> = { state: 'absent' };
const planUnreadable: libPlan.Presence<string> = { state: 'unreadable' };
const planValue = (value: string): libPlan.Presence<string> => ({ state: 'value', value });
/** Task 3's vocabularies, read as plain records whatever literal types its
 *  declarations carry. */
const planReasons = libPlan.REASONS as unknown as Readonly<Record<string, number>>;
const planHealth = libPlan.HEALTH_WORDS as unknown as Readonly<Record<string, string>>;
const planPassWords = libPlan.PASS_WORDS as unknown as readonly string[];

describe('decideStoreOpen: the store-open decision (spec 6.2, 6.9, 5.3)', () => {
  const facts = (o: Partial<libPlan.StoreFacts> = {}): libPlan.StoreFacts => ({
    role: 'fleet', dbDir: 'dir', storeId: planAbsent, pending: planAbsent, writer: planAbsent,
    db: 'absent', dbStoreId: planAbsent, wal: false, shm: false, journalStoreDirs: [], backupsDb: [], ...o,
  });
  const bound: Partial<libPlan.StoreFacts> = {
    storeId: planValue(PLAN_SID), writer: planValue('0a1b2c3d'), db: 'present', dbStoreId: planValue(PLAN_SID),
  };
  const refuse = (word: string): libPlan.StoreOpenVerdict => ({ act: 'refuse', word });
  const ROWS: Array<{ name: string; f: libPlan.StoreFacts; want: libPlan.StoreOpenVerdict }> = [
    { name: 'a fresh box with nothing on disk creates', f: facts(), want: { act: 'create' } },
    { name: 'a bound store whose meta.store_id equals store.id opens', f: facts(bound), want: { act: 'open' } },
    { name: 'a server role refuses even over a bound store', f: facts({ ...bound, role: 'server' }), want: refuse('store-create-refused-role') },
    { name: 'a server role refuses on a fresh box', f: facts({ role: 'server' }), want: refuse('store-create-refused-role') },
    { name: 'a dangling db link refuses store-root-dangling', f: facts({ dbDir: 'dangling', storeId: planValue(PLAN_SID) }), want: refuse('store-root-dangling') },
    { name: 'an unmeasured db dir refuses store-unmeasured', f: facts({ dbDir: 'unmeasured' }), want: refuse('store-unmeasured') },
    { name: 'an unmeasured db file refuses store-unmeasured', f: facts({ db: 'unmeasured' }), want: refuse('store-unmeasured') },
    { name: 'an unreadable store.id refuses store-unmeasured and never creates', f: facts({ storeId: planUnreadable }), want: refuse('store-unmeasured') },
    { name: 'an unreadable pending marker refuses store-unmeasured', f: facts({ pending: planUnreadable }), want: refuse('store-unmeasured') },
    { name: 'an unreadable store.writer refuses store-unmeasured', f: facts({ ...bound, writer: planUnreadable }), want: refuse('store-unmeasured') },
    { name: 'a present DB whose meta cannot be read refuses store-unmeasured', f: facts({ ...bound, dbStoreId: planUnreadable }), want: refuse('store-unmeasured') },
    { name: 'a 0-byte history.db refuses store-zero-byte', f: facts({ ...bound, db: 'zero-byte' }), want: refuse('store-zero-byte') },
    { name: 'a present DB with no meta.store_id refuses store-schema-missing', f: facts({ ...bound, dbStoreId: planAbsent }), want: refuse('store-schema-missing') },
    { name: 'store.id present and the DB absent refuses store-missing', f: facts({ storeId: planValue(PLAN_SID) }), want: refuse('store-missing') },
    { name: 'store.id naming another store refuses store-mismatch', f: facts({ ...bound, storeId: planValue(PLAN_OTHER) }), want: refuse('store-mismatch') },
    { name: 'a DB with no store.id and no pending marker refuses store-unbound', f: facts({ db: 'present', dbStoreId: planValue(PLAN_SID) }), want: refuse('store-unbound') },
    { name: 'a DB with no store.id and a pending marker for another store refuses store-unbound', f: facts({ db: 'present', dbStoreId: planValue(PLAN_SID), pending: planValue(PLAN_OTHER) }), want: refuse('store-unbound') },
    { name: 'a DB with no store.id and its own pending marker finishes the creation', f: facts({ db: 'present', dbStoreId: planValue(PLAN_SID), pending: planValue(PLAN_SID) }), want: { act: 'finish-pending' } },
    { name: 'a leftover WAL with no DB refuses store-wal-orphaned', f: facts({ wal: true }), want: refuse('store-wal-orphaned') },
    { name: 'a leftover SHM with no DB refuses store-wal-orphaned', f: facts({ shm: true }), want: refuse('store-wal-orphaned') },
    { name: 'a journal store directory refuses store-recoverable', f: facts({ journalStoreDirs: [PLAN_OTHER] }), want: refuse('store-recoverable') },
    { name: 'a regular backups db refuses store-recoverable', f: facts({ backupsDb: ['20261001T000000Z.db'] }), want: refuse('store-recoverable') },
    { name: 'a pending marker with no DB is dropped and the store created anew', f: facts({ pending: planValue(PLAN_SID) }), want: { act: 'drop-pending-create' } },
    { name: 'a pending marker with no DB but recoverable evidence still refuses', f: facts({ pending: planValue(PLAN_SID), journalStoreDirs: [PLAN_SID] }), want: refuse('store-recoverable') },
  ];
  it.each(ROWS)('$name', ({ f, want }) => {
    expect(libPlan.decideStoreOpen(f)).toEqual(want);
  });
  it('every word it refuses with is a PASS_WORDS member and a HEALTH_WORDS fail', () => {
    const words = ROWS.map((r) => libPlan.decideStoreOpen(r.f)).flatMap((v) => (v.act === 'refuse' ? [v.word] : []));
    expect(words.length, 'the table refused nothing').toBeGreaterThan(5);
    for (const w of words) {
      expect(planPassWords, w).toContain(w);
      if (w !== 'store-create-refused-role') expect(planHealth[w], w).toBe('fail');
    }
  });
});

describe('decideCliStore: which no-store answer (spec 8.3 table, C36 pure rows)', () => {
  const facts = (o: Partial<libPlan.CliStoreFacts> = {}): libPlan.CliStoreFacts => ({
    darwin: false, role: 'fleet', statSettled: true, dbDir: 'dir', shim: 'present', storeId: planAbsent, pending: planAbsent,
    writer: planAbsent, db: 'absent', dbStoreId: planAbsent, wal: false, shm: false, journalStoreDirs: [], backupsDb: [], ...o,
  });
  const bound: Partial<libPlan.CliStoreFacts> = { storeId: planValue(PLAN_SID), db: 'present', dbStoreId: planValue(PLAN_SID) };
  const ROWS: Array<{ name: string; f: libPlan.CliStoreFacts; exit: number; reason?: string; read?: boolean }> = [
    { name: 'Darwin answers 9 whatever is on disk', f: facts({ ...bound, darwin: true }), exit: 9 },
    { name: 'a server role with a stale shim, store.id and DB answers 9', f: facts({ ...bound, role: 'server' }), exit: 9 },
    { name: 'no shim, no store.id and no DB answers 9', f: facts({ shim: 'absent' }), exit: 9 },
    { name: 'a shim with no store.id and no DB answers 6', f: facts(), exit: 6 },
    { name: 'the same with a journal store directory answers 5 store-recoverable', f: facts({ journalStoreDirs: [PLAN_OTHER] }), exit: 5, reason: 'store-recoverable' },
    { name: 'the same with a backups db answers 5 store-recoverable', f: facts({ backupsDb: ['20261001T000000Z.db'] }), exit: 5, reason: 'store-recoverable' },
    { name: 'the same with a leftover WAL answers 5 store-wal-orphaned', f: facts({ wal: true }), exit: 5, reason: 'store-wal-orphaned' },
    { name: 'store.id without a DB answers 5 store-missing', f: facts({ storeId: planValue(PLAN_SID) }), exit: 5, reason: 'store-missing' },
    { name: 'a DB without store.id answers 5 store-unbound', f: facts({ db: 'present', dbStoreId: planValue(PLAN_SID) }), exit: 5, reason: 'store-unbound' },
    { name: 'a DB without store.id but its own pending marker answers 6', f: facts({ db: 'present', dbStoreId: planValue(PLAN_SID), pending: planValue(PLAN_SID) }), exit: 6 },
    { name: 'a store.id naming another store answers 5 store-mismatch', f: facts({ ...bound, storeId: planValue(PLAN_OTHER) }), exit: 5, reason: 'store-mismatch' },
    { name: 'a 0-byte store answers 5 store-zero-byte', f: facts({ ...bound, db: 'zero-byte' }), exit: 5, reason: 'store-zero-byte' },
    { name: 'a DB with no meta.store_id answers 5 store-schema-missing', f: facts({ ...bound, dbStoreId: planAbsent }), exit: 5, reason: 'store-schema-missing' },
    { name: 'a bound store reads', f: facts(bound), exit: 0, read: true },
    { name: 'a stat that did not settle answers 5 store-unreachable first', f: facts({ ...bound, statSettled: false, storeId: planUnreadable }), exit: 5, reason: 'store-unreachable' },
    { name: 'a dangling db link answers 5 store-root-dangling', f: facts({ dbDir: 'dangling', storeId: planValue(PLAN_SID) }), exit: 5, reason: 'store-root-dangling' },
    { name: 'an unreadable store.id answers 5 store-unmeasured, never 6', f: facts({ storeId: planUnreadable }), exit: 5, reason: 'store-unmeasured' },
    { name: 'an unreadable store.writer answers 5 store-unmeasured', f: facts({ ...bound, writer: planUnreadable }), exit: 5, reason: 'store-unmeasured' },
    { name: 'an unmeasured shim answers 5 store-unmeasured, never 9', f: facts({ shim: 'unmeasured' }), exit: 5, reason: 'store-unmeasured' },
  ];
  it.each(ROWS)('$name', ({ f, exit, reason, read }) => {
    const got = libPlan.decideCliStore(f);
    expect(got.exit).toBe(exit);
    expect(got.reason).toBe(reason);
    expect(got.read).toBe(read ?? false);
  });
  it('every reason it answers is a REASONS word whose code is the exit it answered', () => {
    const answered = ROWS.map((r) => libPlan.decideCliStore(r.f)).filter((v) => v.reason !== undefined);
    expect(answered.length, 'the table gave no reason').toBeGreaterThan(5);
    for (const v of answered) expect(planReasons[v.reason as string], v.reason).toBe(v.exit);
  });
});

describe('decideStatusRead: the measured store read answers one verdict, in lib (Task 28F item 1, spec 8.3)', () => {
  const read = (o: Partial<libPlan.StatusReadFacts> = {}): libPlan.StatusReadVerdict => libPlan.decideStatusRead({
    userVersion: libPlan.SCHEMA_VERSION, journalMode: 'wal', recordedMigration: undefined, ...o,
  });
  it('a WAL store at the code version answers exit 0 and migration none, with no reason', () => {
    expect(read()).toEqual({ exit: libPlan.EXIT.OK, migration: 'none' });
  });
  it('a journal mode other than wal answers 5 store-not-wal, the REASONS word and code', () => {
    for (const mode of ['delete', 'truncate', 'memory', '']) {
      const v = read({ journalMode: mode });
      expect([v.exit, v.reason], mode).toEqual([libPlan.REASONS['store-not-wal'], 'store-not-wal']);
    }
    expect(libPlan.REASONS['store-not-wal']).toBe(libPlan.EXIT.DB);
  });
  it('a stored version newer than the code answers refuse-newer, whatever the sweep recorded', () => {
    expect(read({ userVersion: libPlan.SCHEMA_VERSION + 1, recordedMigration: 'none' }).migration).toBe('refuse-newer');
  });
  it('a recorded verdict that is a MIGRATION_VERDICTS member is carried; anything else is none', () => {
    for (const w of libPlan.MIGRATION_VERDICTS) expect(read({ recordedMigration: w }).migration).toBe(w);
    for (const junk of [undefined, '', 'bogus', 'refuse-NEWER']) expect(read({ recordedMigration: junk }).migration, String(junk)).toBe('none');
  });
  it('the two decisions are independent: a newer store that is not in WAL answers both', () => {
    expect(read({ userVersion: libPlan.SCHEMA_VERSION + 1, journalMode: 'delete' }))
      .toEqual({ exit: libPlan.EXIT.DB, reason: 'store-not-wal', migration: 'refuse-newer' });
  });
  // RF5b F11 (D-4171): what status answers when its read of an admitted store throws. Three answers, never folded.
  it.each([
    [{ storeWord: 'store-missing', sqliteError: false }, { exit: 5, reason: 'store-missing' }],
    [{ storeWord: 'bad-args', sqliteError: false }, null],   // an exit-2 word is never an exit-5 answer
    [{ storeWord: null, sqliteError: true }, { exit: 5, reason: 'store-read-failed' }],
    [{ storeWord: null, sqliteError: false }, null],
  ])('decideStatusReadFailure(%j) answers %j', (facts, want) => {
    expect(libPlan.decideStatusReadFailure(facts)).toEqual(want);
  });
  it('store-read-failed is an exit-5 REASONS word and no HEALTH_WORDS member (deriveHealth reads it as status-unreadable)', () => {
    expect(libPlan.REASONS['store-read-failed']).toBe(libPlan.EXIT.DB);
    expect((libPlan.HEALTH_WORDS as Readonly<Record<string, string>>)['store-read-failed']).toBeUndefined();
  });
});

describe('planCopy and planMigration: the migration verdict is L1 (DM41, DM43 pure table)', () => {
  const GiB = 1073741824;
  const threshold = 20 * GiB;
  const size = 3 * GiB;
  const mig = (o: Partial<libPlan.MigrationInputs> = {}): libPlan.MigrationInputs => ({
    stored: 1, code: 2, freeBytes: threshold + size + 1, thresholdBytes: threshold, sizeBytes: size,
    boundS: null, copyBps: null, attempts: 0, heavy: false, ...o,
  });
  it('equal versions answer none', () => {
    expect(libPlan.planMigration(mig({ stored: 2 }))).toBe('none');
  });
  it('a stored version newer than the code answers refuse-newer', () => {
    expect(libPlan.planMigration(mig({ stored: 3 }))).toBe('refuse-newer');
  });
  it('free = threshold + size + 1 with a copy that fits answers snapshot-then-migrate', () => {
    expect(libPlan.planMigration(mig({ boundS: libPlan.CARRIER_KILL_S, copyBps: 1_000_000_000 }))).toBe('snapshot-then-migrate');
  });
  it('free = threshold + size - 1 answers refuse-low-disk', () => {
    expect(libPlan.planMigration(mig({ freeBytes: threshold + size - 1, boundS: libPlan.CARRIER_KILL_S, copyBps: 1_000_000_000 }))).toBe('refuse-low-disk');
  });
  it('free exactly threshold + size answers refuse-low-disk: free space must exceed it', () => {
    expect(libPlan.planMigration(mig({ freeBytes: threshold + size }))).toBe('refuse-low-disk');
  });
  it('planCopy answers the same boundary for every caller', () => {
    expect(libPlan.planCopy({ freeBytes: threshold + size + 1, thresholdBytes: threshold, sizeBytes: size })).toEqual({ admit: true, needBytes: threshold + size });
    expect(libPlan.planCopy({ freeBytes: threshold + size - 1, thresholdBytes: threshold, sizeBytes: size })).toEqual({ admit: false, needBytes: threshold + size });
    expect(libPlan.planCopy({ freeBytes: threshold + size, thresholdBytes: threshold, sizeBytes: size }).admit).toBe(false);
  });
  it('planCopy never admits on an input that was not measured', () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(libPlan.planCopy({ freeBytes: bad, thresholdBytes: 0, sizeBytes: 0 })).toEqual({ admit: false, needBytes: null });
      expect(libPlan.planCopy({ freeBytes: 10 * GiB, thresholdBytes: bad, sizeBytes: 0 })).toEqual({ admit: false, needBytes: null });
      expect(libPlan.planCopy({ freeBytes: 10 * GiB, thresholdBytes: 0, sizeBytes: bad })).toEqual({ admit: false, needBytes: null });
    }
  });
  it('DM43: an estimate over half the carrier bound escalates to snapshot-needs-op; at half it copies', () => {
    const bound = libPlan.CARRIER_KILL_S;
    const rate = 10_000_000;
    const atHalf = (bound / 2) * rate;
    expect(libPlan.planMigration(mig({ sizeBytes: atHalf, freeBytes: threshold + atHalf + 1, boundS: bound, copyBps: rate }))).toBe('snapshot-then-migrate');
    expect(libPlan.planMigration(mig({ sizeBytes: atHalf + rate, freeBytes: threshold + atHalf + rate + 1, boundS: bound, copyBps: rate }))).toBe('snapshot-needs-op');
  });
  it('DM43: no copy_bps uses the chosen 10 MB/s, and a heavy version counts the store twice', () => {
    const bound = libPlan.CARRIER_KILL_S;
    expect(libPlan.DEFAULT_COPY_BPS).toBe(10_000_000);
    const atHalf = (bound / 2) * libPlan.DEFAULT_COPY_BPS;
    const room = { sizeBytes: atHalf, freeBytes: threshold + atHalf + 1, boundS: bound };
    expect(libPlan.planMigration(mig({ ...room, copyBps: null }))).toBe('snapshot-then-migrate');
    expect(libPlan.planMigration(mig({ ...room, copyBps: 0 }))).toBe('snapshot-then-migrate');
    expect(libPlan.planMigration(mig({ ...room, copyBps: null, heavy: true }))).toBe('snapshot-needs-op');
  });
  it('DM43: two interrupted attempts escalate whatever the size; an --op pass (no bound) skips both tests', () => {
    expect(libPlan.planMigration(mig({ boundS: libPlan.CARRIER_KILL_S, copyBps: 1_000_000_000, attempts: 2 }))).toBe('snapshot-needs-op');
    expect(libPlan.planMigration(mig({ boundS: libPlan.CARRIER_KILL_S, copyBps: 1_000_000_000, attempts: 1 }))).toBe('snapshot-then-migrate');
    const big = 100 * GiB;
    expect(libPlan.planMigration(mig({ boundS: null, copyBps: 1, attempts: 5, sizeBytes: big, freeBytes: threshold + big + 1 }))).toBe('snapshot-then-migrate');
  });
  it('every answer is a MIGRATION_VERDICTS member, and the table reaches all five', () => {
    const seen = new Set<string>();
    for (const stored of [1, 2, 3]) for (const delta of [-1, 1]) for (const boundS of [null, libPlan.CARRIER_KILL_S]) for (const attempts of [0, 2]) {
      seen.add(libPlan.planMigration(mig({ stored, freeBytes: threshold + size + delta, boundS, attempts, copyBps: 1_000_000_000 })));
    }
    const vocab = libPlan.MIGRATION_VERDICTS as unknown as readonly string[];
    for (const w of seen) expect(vocab, w).toContain(w);
    expect([...seen].sort()).toEqual([...vocab].sort());
  });
});

describe('floorThreshold, capOf and withinBudget (spec 9.3, 9.2 step 7)', () => {
  const GiB = 1073741824;
  it('the threshold is min(15 GiB, 10% of the filesystem) plus one run budget', () => {
    expect(libPlan.floorThreshold(100 * GiB)).toBe(10 * GiB + libPlan.RUN_BUDGET_BYTES);
    expect(libPlan.floorThreshold(1024 * GiB)).toBe(15 * GiB + libPlan.RUN_BUDGET_BYTES);
    expect(libPlan.floorThreshold(100 * GiB, 0)).toBe(10 * GiB);
  });
  it('an absent cap file is 50, a malformed one is 50 and says so', () => {
    expect(libPlan.capOf(null)).toEqual({ gb: 50, malformed: false });
    expect(libPlan.capOf(' 7\n')).toEqual({ gb: 7, malformed: false });
    for (const bad of ['', '0', '-3', '1.5', 'x', '12GB', '99999999999999999999']) {
      expect(libPlan.capOf(bad), JSON.stringify(bad)).toEqual({ gb: 50, malformed: true });
    }
    expect(libPlan.capBytes(50)).toBe(50 * GiB);
  });
  it('one budget per run: under 90 s and under 512 MiB', () => {
    expect(libPlan.withinBudget({ elapsedMs: 89_999, bytes: 512 * 1024 * 1024 - 1 })).toBe(true);
    expect(libPlan.withinBudget({ elapsedMs: 90_000, bytes: 0 })).toBe(false);
    expect(libPlan.withinBudget({ elapsedMs: 0, bytes: 512 * 1024 * 1024 })).toBe(false);
  });
});

describe('planRun: a hold stops the drain, a pause stops only ingest (O56, spec 9.2)', () => {
  const GiB = 1073741824;
  const fsSize = 1024 * GiB;
  const plenty: libPlan.FreeProbe = { state: 'ok', bytes: 500 * GiB, fsSize };
  const run = (o: Partial<libPlan.RunInputs> = {}): libPlan.RunPlan => libPlan.planRun({
    historyOff: false, store: { act: 'open' }, free: plenty, sizeBytes: 1 * GiB, capGb: 50, migration: 'none', recovering: false, ...o,
  });
  const REFUSALS_OF_OPEN = ['store-create-refused-role', 'store-root-dangling', 'store-unmeasured', 'store-zero-byte', 'store-schema-missing',
    'store-missing', 'store-mismatch', 'store-unbound', 'store-wal-orphaned', 'store-recoverable'];
  const HOLDS: Array<{ name: string; o: Partial<libPlan.RunInputs>; arm: libPlan.RunPlan['arm']; holdWord: string | null }> = [
    ...REFUSALS_OF_OPEN.map((word) => ({ name: `a store refused ${word}`, o: { store: { act: 'refuse' as const, word } }, arm: 'hold' as const, holdWord: word })),
    { name: 'a statfs that did not settle', o: { free: { state: 'unsettled' } }, arm: 'hold', holdWord: 'store-unreachable' },
    { name: 'a newer schema', o: { migration: 'refuse-newer' }, arm: 'hold', holdWord: 'schema-newer' },
    { name: 'a migration refused for room', o: { migration: 'refuse-low-disk' }, arm: 'hold', holdWord: 'migration-refused' },
    { name: 'a migration that needs an --op pass', o: { migration: 'snapshot-needs-op' }, arm: 'hold', holdWord: 'migration-needs-op' },
    { name: 'a pass that migrates', o: { migration: 'snapshot-then-migrate' }, arm: 'migrate', holdWord: null },
    { name: 'a registered recovery step', o: { recovering: true }, arm: 'recover', holdWord: null },
    { name: 'history-off', o: { historyOff: true }, arm: 'off', holdWord: null },
  ];
  it.each(HOLDS)('$name holds the drain and ingest', ({ o, arm, holdWord }) => {
    expect(run(o)).toEqual({ arm, holdWord, drain: false, ingest: false, pause: null });
  });
  it('history-off wins over every other input', () => {
    expect(run({ historyOff: true, store: { act: 'refuse', word: 'store-unbound' }, free: { state: 'unsettled' } }).arm).toBe('off');
  });
  it('a statfs that did not settle answers ahead of a store refusal (the probe runs before the DB is opened)', () => {
    expect(run({ store: { act: 'refuse', word: 'store-unbound' }, free: { state: 'unsettled' } })).toEqual({ arm: 'hold', holdWord: 'store-unreachable', drain: false, ingest: false, pause: null });
  });
  it('a healthy open, create, finish or drop runs with drain and ingest', () => {
    for (const store of [{ act: 'open' }, { act: 'create' }, { act: 'finish-pending' }, { act: 'drop-pending-create' }] as libPlan.StoreOpenVerdict[]) {
      expect(run({ store })).toEqual({ arm: 'run', holdWord: null, drain: true, ingest: true, pause: null });
    }
  });
  it('a store at the cap pauses ingest and keeps the drain', () => {
    expect(run({ sizeBytes: 50 * GiB })).toEqual({ arm: 'run', holdWord: null, drain: true, ingest: false, pause: 'at-cap' });
    expect(run({ sizeBytes: 50 * GiB - 1 }).pause).toBe(null);
  });
  it('free space below the floor, or a statfs that threw, pauses ingest as low-disk and keeps the drain', () => {
    const floor = libPlan.floorThreshold(fsSize);
    expect(run({ free: { state: 'ok', bytes: floor - 1, fsSize } })).toEqual({ arm: 'run', holdWord: null, drain: true, ingest: false, pause: 'low-disk' });
    expect(run({ free: { state: 'ok', bytes: floor, fsSize } }).pause).toBe(null);
    expect(run({ free: { state: 'threw' } })).toEqual({ arm: 'run', holdWord: null, drain: true, ingest: false, pause: 'low-disk' });
  });
  it('a recovery step below the floor pauses as low-disk and still holds the drain (spec 9.3)', () => {
    const floor = libPlan.floorThreshold(fsSize);
    expect(run({ recovering: true, free: { state: 'ok', bytes: floor - 1, fsSize } })).toEqual({ arm: 'recover', holdWord: null, drain: false, ingest: false, pause: 'low-disk' });
    expect(run({ recovering: true, free: { state: 'ok', bytes: floor, fsSize } }).pause).toBe(null);
  });
  it('a migration word outside MIGRATION_VERDICTS throws rather than runs', () => {
    expect(() => run({ migration: 'later' as libPlan.MigrationVerdict })).toThrow(TypeError);
  });
});

describe('planFileRead: a cursor resumes only on its own file (spec 9.2 step 3, DM45 pure)', () => {
  const U = '0189abcd-1234-4678-9abc-0123456789ab';
  const V = '0189abcd-1234-4678-9abc-ba9876543210';
  const BIRTH = 1_700_000_000_123_456_789n;
  const row: libPlan.CursorRow = { transcriptUuid: U, birthNs: BIRTH, headSha: 'aa', offset: 100, tailSha: 'bb' };
  const read = (o: Partial<libPlan.FileReadInputs> = {}): string => libPlan.planFileRead({
    row, stat: { size: 200, birthNs: BIRTH }, pathUuid: U, headSha: 'aa', tailShaAtOffset: 'bb', ...o,
  });
  it('the same identity, a size at or past the offset and the same tail sha resume', () => {
    expect(read()).toBe('resume');
    expect(read({ stat: { size: 100, birthNs: BIRTH } })).toBe('resume');
  });
  it('a file that cannot be stat-ed is skipped; a file with no row is scanned from the start', () => {
    expect(read({ stat: null })).toBe('skip');
    expect(read({ row: null })).toBe('rescan');
  });
  it('another uuid at the path retires the row', () => {
    expect(read({ pathUuid: V })).toBe('retire');
  });
  it('a different birth time retires the row, compared exactly past 2^53', () => {
    expect(read({ stat: { size: 200, birthNs: BIRTH - 1n } })).toBe('retire');
  });
  it('an equal birth time proves identity even when the first line differs', () => {
    expect(read({ headSha: 'cc' })).toBe('resume');
  });
  it('with no birth time on either side the first line stands in', () => {
    expect(read({ stat: { size: 200, birthNs: null }, headSha: 'cc' })).toBe('retire');
    expect(read({ stat: { size: 200, birthNs: null }, headSha: 'aa' })).toBe('resume');
    expect(read({ row: { ...row, birthNs: null }, headSha: 'cc' })).toBe('retire');
  });
  it('a row bound before the file had a first line never retires on the head', () => {
    expect(read({ row: { ...row, birthNs: null, headSha: null }, headSha: 'cc' })).toBe('resume');
  });
  it('a file shorter than the cursor, or a different tail sha, rescans', () => {
    expect(read({ stat: { size: 99, birthNs: BIRTH } })).toBe('rescan');
    expect(read({ tailShaAtOffset: 'zz' })).toBe('rescan');
  });
});

describe('formOf and decideOpGate: the speed bumps, decided once (spec 8.4, C64 pure)', () => {
  const FORMS = libPlan.WRITING_FORMS as unknown as Readonly<Record<string, Readonly<{ op: string; irreversible: boolean; binding: boolean }>>>;
  const NAMES = Object.keys(FORMS);
  const env = (o: Partial<{ claudecode: boolean; historyOff: boolean }> = {}) => ({ claudecode: false, historyOff: false, ...o });
  it('formOf maps an --op verb and its argv to a WRITING_FORMS key, null for a dry run', () => {
    expect(libPlan.formOf('import', [])).toBe(null);
    expect(libPlan.formOf('import', ['--session', 'demo-quiet-basin'])).toBe(null);
    expect(libPlan.formOf('import', ['--apply'])).toBe('import-apply');
    expect(libPlan.formOf('import', ['--session', 'demo-quiet-basin', '--file', '/home/u/.claude-a/projects/p/x.jsonl', '--apply'])).toBe('import-session-apply');
    expect(libPlan.formOf('prune', ['--older-than', '90d'])).toBe(null);
    expect(libPlan.formOf('prune', ['--older-than', '90d', '--apply'])).toBe('prune-apply');
    expect(libPlan.formOf('reparse', [])).toBe(null);
    expect(libPlan.formOf('reparse', ['--apply'])).toBe('reparse-apply');
    expect(libPlan.formOf('recall-off', ['demo-quiet-basin'])).toBe('recall-off');
    expect(libPlan.formOf('recall-off', ['--clear-all'])).toBe('recall-off-clear-all');
    for (const op of ['repair', 'backup', 'migrate', 'adopt', 'restore', 'rebuild']) expect(libPlan.formOf(op, [])).toBe(op);
    expect(libPlan.formOf('frobnicate', ['--apply'])).toBe(libPlan.UNKNOWN_OP_FORM);
  });
  it('every non-null form formOf answers for a known verb is a WRITING_FORMS key', () => {
    const argvs = [[], ['--apply'], ['--session', 'x', '--file', 'y', '--apply'], ['--clear-all']];
    for (const op of ['import', 'prune', 'reparse', 'recall-off', 'repair', 'backup', 'migrate', 'adopt', 'restore', 'rebuild']) {
      for (const a of argvs) {
        const f = libPlan.formOf(op, a);
        if (f !== null) expect(NAMES, `${op} ${a.join(' ')}`).toContain(f);
      }
    }
    expect(NAMES).not.toContain(libPlan.UNKNOWN_OP_FORM);
  });
  it('a dry run passes every bump', () => {
    expect(libPlan.decideOpGate(null, env({ claudecode: true, historyOff: true }), false, 'cc-demo-quiet-basin')).toEqual({ ok: true });
  });
  it('an unknown verb is refused bad-args', () => {
    expect(libPlan.decideOpGate(libPlan.UNKNOWN_OP_FORM, env(), true, null)).toEqual({ ok: false, rc: 2, reason: 'bad-args' });
  });
  it('CLAUDECODE refuses every writing form apply-in-session, before every other bump', () => {
    for (const f of NAMES) {
      expect(libPlan.decideOpGate(f, env({ claudecode: true, historyOff: true }), false, 'cc-demo-quiet-basin'), f).toEqual({ ok: false, rc: 2, reason: 'apply-in-session' });
    }
  });
  it('without a TTY only the irreversible forms refuse needs-tty', () => {
    for (const f of NAMES) {
      const want = FORMS[f]!.irreversible ? { ok: false, rc: 2, reason: 'needs-tty' } : { ok: true };
      expect(libPlan.decideOpGate(f, env(), false, null), f).toEqual(want);
    }
    expect(FORMS['import-session-apply']!.irreversible).toBe(true);
    expect(FORMS['import-apply']!.irreversible).toBe(false);
    expect(FORMS['migrate']!.irreversible).toBe(false);
  });
  it('from a cc- pane only the irreversible forms refuse irreversible-in-pane; another pane passes', () => {
    for (const f of NAMES) {
      const want = FORMS[f]!.irreversible ? { ok: false, rc: 2, reason: 'irreversible-in-pane' } : { ok: true };
      expect(libPlan.decideOpGate(f, env(), true, 'cc-demo-quiet-basin'), f).toEqual(want);
      expect(libPlan.decideOpGate(f, env(), true, 'ops'), f).toEqual({ ok: true });
    }
  });
  it('under history-off every writing form refuses except the three binding verbs', () => {
    for (const f of NAMES) {
      const want = FORMS[f]!.binding ? { ok: true } : { ok: false, rc: 2, reason: 'history-off' };
      expect(libPlan.decideOpGate(f, env({ historyOff: true }), true, null), f).toEqual(want);
    }
    expect(NAMES.filter((f) => FORMS[f]!.binding).sort()).toEqual(['adopt', 'rebuild', 'restore']);
  });
  it('every reason the gate answers is a REFUSALS word', () => {
    const refusals = libPlan.REFUSALS as unknown as readonly string[];
    for (const r of ['bad-args', 'apply-in-session', 'needs-tty', 'irreversible-in-pane', 'history-off']) expect(refusals, r).toContain(r);
  });
});

// ===========================================================================
// Task 7: the epoch and family decisions, the ONE implementation the drain
// and replay share (O56's decideEpochLine half), in-process on lib.mjs alone.
// ===========================================================================
describe('decideEpochLine: the drain and replay take one verdict per line (O56, spec 6.1)', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';
  const PANE = '33333333-3333-4333-8333-333333333333';
  const absent: libEpoch.Presence<string> = { state: 'absent' };
  const obs = (o: Partial<libEpoch.Observation> = {}): libEpoch.Observation => ({
    v: 1, observedMs: 1_000, uuid: absent, generation: absent, project: absent, workdir: absent,
    late: null, journalT: null, journaled: null, heldMatches: {}, ...o,
  });
  const uuidIs = (value: string): libEpoch.Presence<string> => ({ state: 'value', value });
  it('a ccd start whose reg equals its sid confirms by reg, even with .uuid moved on before the rename (CT6)', () => {
    expect(libEpoch.decideEpochLine({ src: 'startup', sid: U1, reg: U1 }, obs({ uuid: uuidIs(U2) }))).toEqual({ kind: 'confirm', by: 'reg' });
    expect(libEpoch.decideEpochLine({ src: 'resume', sid: U1, reg: U1 }, obs())).toEqual({ kind: 'confirm', by: 'reg' });
  });
  it('a nested claude -p (reg is the pane uuid, .uuid is the pane uuid) stays a candidate', () => {
    expect(libEpoch.decideEpochLine({ src: 'startup', sid: U1, reg: PANE }, obs({ uuid: uuidIs(PANE) }))).toEqual({ kind: 'candidate' });
  });
  it('a line without reg confirms by the observed .uuid, else by a held match, else waits', () => {
    expect(libEpoch.decideEpochLine({ src: 'startup', sid: U1 }, obs({ uuid: uuidIs(U1) }))).toEqual({ kind: 'confirm', by: 'observed' });
    expect(libEpoch.decideEpochLine({ src: 'resume', sid: U1 }, obs({ uuid: uuidIs(U2), heldMatches: { [U1]: 5_000 } }))).toEqual({ kind: 'confirm', by: 'held-match' });
    expect(libEpoch.decideEpochLine({ src: 'startup', sid: U1 }, obs({ uuid: uuidIs(U2) }))).toEqual({ kind: 'candidate' });
    expect(libEpoch.decideEpochLine({ src: 'startup', sid: U1 }, obs({ uuid: { state: 'unreadable' } }))).toEqual({ kind: 'candidate' });
  });
  it('a clear line always chains, confirmed by the observation or a held match, else unconfirmed', () => {
    expect(libEpoch.decideEpochLine({ src: 'clear', sid: U2 }, obs({ uuid: uuidIs(U2) }))).toEqual({ kind: 'chain', confirmedBy: 'observed' });
    expect(libEpoch.decideEpochLine({ src: 'clear', sid: U2 }, obs({ heldMatches: { [U2]: 5_000 } }))).toEqual({ kind: 'chain', confirmedBy: 'held-match' });
    expect(libEpoch.decideEpochLine({ src: 'clear', sid: U2 }, obs({ uuid: uuidIs(U1) }))).toEqual({ kind: 'chain', confirmedBy: null });
  });
  it('a source outside the spool set throws rather than chains', () => {
    expect(() => libEpoch.decideEpochLine({ src: 'fork' as 'startup', sid: U1 }, obs())).toThrow(TypeError);
  });
});

describe('observationOk accepts exactly the observation observe() writes (review 316 F9; D-4347 (history-planted-entries-never-wedge))', () => {
  const SID = '11111111-1111-4111-8111-111111111111';
  const STORE = '22222222-2222-4222-8222-222222222222';
  const V = { v: 1, observedMs: 1000, uuid: { state: 'absent' }, generation: { state: 'absent' },
    project: { state: 'value', value: 'demo' }, workdir: { state: 'unreadable' }, late: null, journalT: null, journaled: null, heldMatches: {} };
  const reread = { observedMs: 3000, uuid: { state: 'absent' }, generation: { state: 'value', value: 'g' }, project: { state: 'absent' }, workdir: { state: 'unreadable' } };
  const without = (k: string): Record<string, unknown> => { const o: Record<string, unknown> = { ...V }; delete o[k]; return o; };
  it('is true for a full observation, a journaled one, a re-read late one and one with a held match', () => {
    expect(libEpoch.observationOk(V)).toBe(true);
    expect(libEpoch.observationOk({ ...V, journalT: 2000, journaled: { t: 2000, storeId: STORE, writer: 'abcdef01', bytes: 10 } })).toBe(true);
    expect(libEpoch.observationOk({ ...V, late: reread })).toBe(true);
    expect(libEpoch.observationOk({ ...V, heldMatches: { [SID]: 4000 } })).toBe(true);
    expect(libEpoch.observationOk({ ...V, a_later_builds_key: 1 }), 'unknown extra keys stay readable').toBe(true);
  });
  it.each<[string, unknown]>([
    ['only v and observedMs', { v: 1, observedMs: 1 }],
    ['no uuid', without('uuid')],
    ['uuid value without value', { ...V, uuid: { state: 'value' } }],
    ['uuid value not a string', { ...V, uuid: { state: 'value', value: 5 } }],
    ['uuid in an unknown state', { ...V, uuid: { state: 'other' } }],
    ['no late', without('late')],
    ['late empty', { ...V, late: {} }],
    ['journalT fractional', { ...V, journalT: 1.5 }],
    ['journalT a string', { ...V, journalT: '1' }],
    ['journaled with a bad storeId', { ...V, journaled: { t: 1, storeId: 'x', writer: 'abcdef01', bytes: 1 } }],
    ['journaled without bytes', { ...V, journaled: { t: 1, storeId: STORE, writer: 'abcdef01' } }],
    ['heldMatches null', { ...V, heldMatches: null }],
    ['heldMatches with a string', { ...V, heldMatches: { a: 'x' } }],
    ['observedMs negative', { ...V, observedMs: -1 }],
    ['observedMs fractional', { ...V, observedMs: 1.5 }],
    ['v 2', { ...V, v: 2 }],
    ['an array', []],
    ['null', null],
  ])('is false for %s', (_why, o) => { expect(libEpoch.observationOk(o)).toBe(false); });
});

describe('decideCandidate: later-tick confirmation inside the 7-day window (spec 6.1)', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';
  const WINDOW = libEpoch.EPOCH_CONFIRM_WINDOW_MS;
  const at = (o: Partial<Parameters<typeof libEpoch.decideCandidate>[0]> = {}) => libEpoch.decideCandidate({
    sid: U1, journaledMs: 1_000, nowMs: 1_000 + 60_000, currentUuid: { state: 'value', value: U1 }, supersededByLaterClearOfSameId: false, ...o,
  });
  it('the window is 7 days', () => { expect(WINDOW).toBe(7 * 24 * 3600 * 1000); });
  it('.uuid naming the sid inside the window confirms later-tick, up to the window edge', () => {
    expect(at()).toEqual({ kind: 'confirm', by: 'later-tick' });
    expect(at({ nowMs: 1_000 + WINDOW })).toEqual({ kind: 'confirm', by: 'later-tick' });
  });
  it('another or an unreadable .uuid inside the window waits', () => {
    expect(at({ currentUuid: { state: 'value', value: U2 } })).toEqual({ kind: 'wait' });
    expect(at({ currentUuid: { state: 'unreadable' } })).toEqual({ kind: 'wait' });
  });
  it('past the window the candidate drops, superseded only when a later clear of the same id took .uuid', () => {
    expect(at({ nowMs: 1_000 + WINDOW + 1 })).toEqual({ kind: 'drop', superseded: false });
    expect(at({ nowMs: 1_000 + WINDOW + 1, currentUuid: { state: 'value', value: U2 }, supersededByLaterClearOfSameId: true })).toEqual({ kind: 'drop', superseded: true });
  });
});

describe('joinGeneration, locationMatches and decideRekey (spec 6.1, DM19b, DM46, DM18b pure halves)', () => {
  const G = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-ba9876543210';
  it("a line's own gen wins over the registry", () => {
    expect(libEpoch.joinGeneration({ lineGen: G, observedGen: { state: 'value', value: G2 } })).toEqual({ generation: G, via: 'line' });
  });
  it("a gen-less line joins the registry's generation", () => {
    expect(libEpoch.joinGeneration({ lineGen: null, observedGen: { state: 'value', value: G } })).toEqual({ generation: G, via: 'registry' });
  });
  it("an absent generation joins '' as absent", () => {
    expect(libEpoch.joinGeneration({ lineGen: null, observedGen: { state: 'absent' } })).toEqual({ generation: '', via: 'absent' });
  });
  it("an unreadable or malformed generation joins '' as unreadable, never absent (IV5)", () => {
    expect(libEpoch.joinGeneration({ lineGen: null, observedGen: { state: 'unreadable' } })).toEqual({ generation: '', via: 'unreadable' });
    expect(libEpoch.joinGeneration({ lineGen: null, observedGen: { state: 'value', value: 'not-a-uuid' } })).toEqual({ generation: '', via: 'unreadable' });
  });
  it('realpaths decide the location rule when both resolved', () => {
    const workdir: libEpoch.Presence<string> = { state: 'value', value: '/home/u/worktrees/p/quiet-basin' };
    expect(libEpoch.locationMatches({ cwd: '/home/u/wt/quiet-basin', cwdReal: '/data/wt/quiet-basin', workdir, workdirReal: '/data/wt/quiet-basin' })).toBe(true);
    expect(libEpoch.locationMatches({ cwd: '/home/u/worktrees/p/quiet-basin', cwdReal: '/data/a', workdir, workdirReal: '/data/b' })).toBe(false);
  });
  it('verbatim strings decide when either path no longer resolves; an absent or unreadable workdir never matches', () => {
    const workdir: libEpoch.Presence<string> = { state: 'value', value: '/home/u/worktrees/p/quiet-basin' };
    expect(libEpoch.locationMatches({ cwd: '/home/u/worktrees/p/quiet-basin', cwdReal: null, workdir, workdirReal: '/data/wt' })).toBe(true);
    expect(libEpoch.locationMatches({ cwd: '/home/u/other', cwdReal: null, workdir, workdirReal: null })).toBe(false);
    expect(libEpoch.locationMatches({ cwd: '/home/u/worktrees/p/quiet-basin', cwdReal: null, workdir: { state: 'absent' }, workdirReal: null })).toBe(false);
    expect(libEpoch.locationMatches({ cwd: '/home/u/worktrees/p/quiet-basin', cwdReal: null, workdir: { state: 'unreadable' }, workdirReal: null })).toBe(false);
    expect(libEpoch.locationMatches({ cwd: null, cwdReal: null, workdir, workdirReal: null })).toBe(false);
    expect(libEpoch.locationMatches({ cwd: '', cwdReal: null, workdir: { state: 'value', value: '' }, workdirReal: null })).toBe(false);
  });
  it('an unreadable workdir never confirms, whatever realpaths the caller passes', () => {
    expect(libEpoch.locationMatches({ cwd: '/home/u/wt/a', cwdReal: '/data/wt/a', workdir: { state: 'unreadable' }, workdirReal: '/data/wt/a' })).toBe(false);
  });
  it("a '' family merges into (id, G) only on a uuid it holds, and only for a uuid-shaped G", () => {
    const held = new Set(['11111111-1111-4111-8111-111111111111']);
    expect(libEpoch.decideRekey({ observedGeneration: G, uuid: '11111111-1111-4111-8111-111111111111', emptyFamilyUuids: held })).toBe('merge');
    expect(libEpoch.decideRekey({ observedGeneration: G, uuid: '22222222-2222-4222-8222-222222222222', emptyFamilyUuids: held })).toBe('none');
    expect(libEpoch.decideRekey({ observedGeneration: '', uuid: '11111111-1111-4111-8111-111111111111', emptyFamilyUuids: held })).toBe('none');
  });
});

// ===========================================================================
// Task 8: row extraction over the synthetic rows of historyFixtures.ts. The
// pins whose store halves need a sweep (DM12, DM13, DM30, DM32, DM2b, DM38)
// are owned by later tasks; these are their pure halves, plus DM38b whole.
// ===========================================================================
describe('isStoredRow, blobBodyOf and entryOf: what is stored and how (spec 2, 6.2)', () => {
  const T0 = '2026-10-01T10:00:00.000Z';
  it('a uuid-less bridge-session row is not stored and counts by its type (DM13 pure half)', () => {
    const r = rowFx.bridgeSessionRow({ ts: T0, accountUuid: 'aaaaaaaa-0000-4000-8000-000000000001', organizationUuid: 'bbbbbbbb-0000-4000-8000-000000000002' });
    expect(libRows.isStoredRow(r)).toBe(false);
    expect(libRows.uuidlessTypeOf(r)).toBe('bridge-session');
    expect(libRows.isStoredRow(rowFx.userRow({ uuid: 'u-1', ts: T0, text: 'hi' }))).toBe(true);
    expect(libRows.isStoredRow({ uuid: '' })).toBe(false);
    expect(libRows.isStoredRow(null)).toBe(false);
  });
  it('an unstored row with a garbled type counts as unknown, never an arbitrary counter name', () => {
    expect(libRows.uuidlessTypeOf({ type: 'a b; drop' })).toBe('unknown');
    expect(libRows.uuidlessTypeOf({ type: 7 })).toBe('unknown');
    expect(libRows.uuidlessTypeOf('x')).toBe('unknown');
  });
  it('a thinking block is removed from the blob body, and its sentinel is nowhere in it (DM12 pure half)', () => {
    const r = rowFx.assistantRow({ uuid: 'a-1', ts: T0, text: 'visible answer', thinking: 'SENTINEL-THINKING-7f3a' });
    const body = libRows.blobBodyOf(r);
    expect(JSON.stringify(body)).not.toContain('SENTINEL-THINKING-7f3a');
    expect(body).toEqual([{ type: 'text', text: 'visible answer' }]);
    const redacted = { ...r, message: { ...(r['message'] as object), content: [{ type: 'redacted_thinking', data: 'SENTINEL-R' }, { type: 'text', text: 'x' }] } };
    expect(JSON.stringify(libRows.blobBodyOf(redacted))).not.toContain('SENTINEL-R');
  });
  it('a summary keeps its string content; system, attachment and unknown rows keep their own field', () => {
    expect(libRows.blobBodyOf(rowFx.summaryRow({ uuid: 's-1', ts: T0, text: 'This session is being continued' }))).toBe('This session is being continued');
    expect(libRows.blobBodyOf(rowFx.systemRow({ uuid: 'y-1', ts: T0, subtype: 'informational', content: 'note' }))).toBe('note');
    expect(libRows.blobBodyOf(rowFx.attachmentRow({ uuid: 't-1', ts: T0, attachment: { type: 'hook_additional_context', content: ['c'] } })))
      .toEqual({ type: 'hook_additional_context', content: ['c'] });
    expect(libRows.blobBodyOf({ uuid: 'q-1', type: 'queue-operation' })).toBe(null);
  });
  it('an assistant row keeps message.model verbatim; a user row stores NULL (DM38 pure half)', () => {
    const a = libRows.entryOf(rowFx.assistantRow({ uuid: 'a-1', ts: T0, text: 'x', model: 'gpt-fixture-5', requestId: 'req_1', msgId: 'msg_1' }), { apiBlockIndex: 2 });
    expect(a).toEqual({
      uuid: 'a-1', type: 'assistant', subtype: null, role: 'assistant', model: 'gpt-fixture-5', parentUuid: null,
      tsMs: Date.UTC(2026, 9, 1, 10, 0, 0), requestId: 'req_1', apiBlockIndex: 2, msgId: 'msg_1',
      sourceToolUseId: null, toolName: null, isCompactSummary: 0,
    });
    expect(libRows.entryOf(rowFx.userRow({ uuid: 'u-1', ts: T0, text: 'x' })).model).toBe(null);
    expect(libRows.entryOf({ ...rowFx.userRow({ uuid: 'u-4', ts: T0, text: 'x' }), message: { role: 'user', model: 'claude-fixture-4', content: 'x' } }).model).toBe(null);
    expect(libRows.entryOf(rowFx.assistantRow({ uuid: 'a-2', ts: T0, text: 'x', model: '<synthetic>' })).model).toBe('<synthetic>');
  });
  it('FR2-e (D-4341): a row timestamp is stored only as a safe integer within the JS Date range, 0 <= ms <= 8.64e15; anything else is NULL, and ordinary values are unchanged', () => {
    const tsOf = (timestamp: unknown): number | null => libRows.entryOf({ uuid: 't-1', type: 'user', timestamp }).tsMs;
    for (const bad of [2 ** 60, -(2 ** 60), 1e17, -1e17, 9.1e15, 8.64e15 + 1, -1, -0.5 - 1, Infinity, -Infinity, NaN, '+275761-09-13T00:00:00.001Z', '0000-01-01T00:00:00Z', '1969-12-31T23:59:59Z']) {
      expect(tsOf(bad), String(bad)).toBe(null);
    }
    expect(tsOf(8.64e15), 'the Date range\'s own end').toBe(8.64e15);
    expect(tsOf(0)).toBe(0);
    expect(Object.is(tsOf(-0.5), 0), 'a truncated -0.5 is 0, never -0').toBe(true);
    expect(tsOf(1_791_000_000_123.9), 'a numeric ms truncates, as before').toBe(1_791_000_000_123);
    expect(tsOf('2026-10-01T10:00:00.000Z')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0));
    expect(tsOf('+275760-09-13T00:00:00.000Z'), 'the last instant Date.parse reads').toBe(8.64e15);
  });
  it('entryOf reads the tool name, the producing tool, the summary flag and a missing timestamp as NULL', () => {
    expect(libRows.entryOf(rowFx.toolUseRow({ uuid: 'a-3', ts: T0, toolUseId: 'toolu_01', name: 'Bash', input: { command: 'ls' } })).toolName).toBe('Bash');
    expect(libRows.entryOf(rowFx.toolResultRow({ uuid: 'u-3', ts: T0, toolUseId: 'toolu_01', content: 'out', sourceToolUseID: 'toolu_01' })).sourceToolUseId).toBe('toolu_01');
    expect(libRows.entryOf(rowFx.summaryRow({ uuid: 's-1', ts: T0, text: 's' })).isCompactSummary).toBe(1);
    expect(libRows.entryOf({ uuid: 'n-1', type: 'user', timestamp: 'not a time' }).tsMs).toBe(null);
    expect(libRows.entryOf({ uuid: 'n-2', type: 'user' }).tsMs).toBe(null);
  });
});

describe('boundaryOf: compact_boundary metadata, every absent field NULL and named (spec 6.1, 6.2)', () => {
  const T0 = '2026-10-01T10:00:00.000Z';
  const base = { uuid: 'b-1', ts: T0, trigger: 'manual' as const, headUuid: 'h-1', anchorUuid: 's-1', tailUuid: 't-1', allUuids: ['k-1', 'k-2'] };
  it('reads trigger, the preserved segment, allUuids and the token counts', () => {
    expect(libRows.boundaryOf(rowFx.boundaryRow({ ...base, preTokens: 150_000, postTokens: 9_000, durationMs: 30_000 }))).toEqual({
      trigger: 'manual', headUuid: 'h-1', anchorUuid: 's-1', tailUuid: 't-1', allUuids: ['k-1', 'k-2'],
      preTokens: 150_000, postTokens: 9_000, durationMs: 30_000, missing: [],
    });
  });
  it('a boundary without a preserved segment or kept list reads NULL there and names each field', () => {
    const b = libRows.boundaryOf(rowFx.boundaryRow({ ...base, omit: ['preservedSegment', 'preservedMessages', 'durationMs'] }));
    expect(b).not.toBe(null);
    expect(b!.headUuid).toBe(null);
    expect(b!.allUuids).toBe(null);
    expect([...b!.missing].sort()).toEqual(['allUuids', 'anchorUuid', 'durationMs', 'headUuid', 'tailUuid']);
  });
  it('a kept list with any element that is not a non-empty string is NULL and named in missing, exactly as an absent one (Review Focus 1)', () => {
    for (const allUuids of [[1, 2], ['u1', 2], ['u1', '']]) {
      const b = libRows.boundaryOf(rowFx.boundaryRow({ ...base, allUuids: allUuids as unknown as string[] }));
      expect(b!.allUuids).toBe(null);
      expect(b!.missing).toEqual(['allUuids']);
    }
    // An all-string list and an empty list ("kept nothing", which B2's span rule reads) are unchanged.
    const ok = libRows.boundaryOf(rowFx.boundaryRow({ ...base, allUuids: ['u1', 'u2'] }));
    expect(ok!.allUuids).toEqual(['u1', 'u2']);
    expect(ok!.missing).toEqual([]);
    const empty = libRows.boundaryOf(rowFx.boundaryRow({ ...base, allUuids: [] }));
    expect(empty!.allUuids).toEqual([]);
    expect(empty!.missing).toEqual([]);
  });
  it('a row with no compactMetadata at all is still a boundary with every field missing, and never throws', () => {
    const b = libRows.boundaryOf({ uuid: 'b-2', type: 'system', subtype: 'compact_boundary' });
    expect(b!.missing.length).toBe(8);
  });
  it('a row that is not a boundary by structure is null', () => {
    expect(libRows.boundaryOf(rowFx.systemRow({ uuid: 'y-1', ts: T0, subtype: 'informational', content: 'compact_boundary' }))).toBe(null);
    expect(libRows.boundaryOf(null)).toBe(null);
  });
});

describe('provenanceOf: by structure, never by text (spec 6.2, DM32 pure half)', () => {
  const T0 = '2026-10-01T10:00:00.000Z';
  const none = { pairedToolUse: null };
  it('typed user text is operator, assistant output is model, the summary is summary', () => {
    expect(libRows.provenanceOf(rowFx.userRow({ uuid: 'u-1', ts: T0, text: 'please refactor' }), none)).toBe('operator');
    expect(libRows.provenanceOf(rowFx.assistantRow({ uuid: 'a-1', ts: T0, text: 'done' }), none)).toBe('model');
    expect(libRows.provenanceOf(rowFx.toolUseRow({ uuid: 'a-2', ts: T0, toolUseId: 'toolu_01', name: 'Read', input: { file_path: '/x' } }), none)).toBe('model');
    expect(libRows.provenanceOf(rowFx.summaryRow({ uuid: 's-1', ts: T0, text: 'summary' }), none)).toBe('summary');
  });
  it('attachments, system rows, the G16 echo, isMeta rows and unknown types are harness', () => {
    expect(libRows.provenanceOf(rowFx.attachmentRow({ uuid: 't-1', ts: T0, attachment: { type: 'x' } }), none)).toBe('harness');
    expect(libRows.provenanceOf(rowFx.systemRow({ uuid: 'y-1', ts: T0, subtype: 'informational', content: 'n' }), none)).toBe('harness');
    expect(libRows.provenanceOf(rowFx.localCommandEchoRow({ uuid: 'e-1', ts: T0, stdout: '<ccrc-leaf>x</ccrc-leaf>' }), none)).toBe('harness');
    expect(libRows.provenanceOf({ ...rowFx.userRow({ uuid: 'm-1', ts: T0, text: 'Base directory for this skill' }), isMeta: true }, none)).toBe('harness');
    expect(libRows.provenanceOf({ uuid: 'z-1', type: 'atis-latch' }, none)).toBe('harness');
  });
  it('a tool result is tool; paired with a Bash ccrc history command it is recall-echo', () => {
    const r = rowFx.toolResultRow({ uuid: 'u-2', ts: T0, toolUseId: 'toolu_02', content: 'hits' });
    expect(libRows.provenanceOf(r, none)).toBe('tool');
    expect(libRows.provenanceOf(r, { pairedToolUse: { name: 'Bash', command: '"$HOME/.local/bin/ccrc" history grep needle' } })).toBe('recall-echo');
    expect(libRows.provenanceOf(r, { pairedToolUse: { name: 'Bash', command: 'ccrc history status' } })).toBe('recall-echo');
    expect(libRows.provenanceOf(r, { pairedToolUse: { name: 'Bash', command: 'ccrc doctor' } })).toBe('tool');
    expect(libRows.provenanceOf(r, { pairedToolUse: { name: 'Read', command: 'ccrc history grep x' } })).toBe('tool');
  });
  it('a cat of a file that merely contains <ccrc-recall stays tool, so default search keeps it (DM32)', () => {
    const r = rowFx.toolResultRow({ uuid: 'u-3', ts: T0, toolUseId: 'toolu_03', content: '<ccrc-recall src=x trust="untrusted">old</ccrc-recall>' });
    expect(libRows.provenanceOf(r, { pairedToolUse: { name: 'Bash', command: 'cat notes/recall.txt' } })).toBe('tool');
  });
  it('isHistoryCommand reads the first two words only', () => {
    expect(libRows.isHistoryCommand('  /home/u/.local/bin/ccrc   history describe L0123')).toBe(true);
    expect(libRows.isHistoryCommand("'/opt/x/ccrc' history tree")).toBe(true);
    expect(libRows.isHistoryCommand('env -u CLAUDECODE ccrc history prune')).toBe(false);
    expect(libRows.isHistoryCommand('ccrcx history grep')).toBe(false);
    expect(libRows.isHistoryCommand('ccrc')).toBe(false);
  });
  it('isHistoryCommand never splits the whole command (review 316 F7)', () => {
    const spy = vi.spyOn(String.prototype, 'split');
    let yes: boolean | undefined; let no: boolean | undefined; let calls = -1;
    try {
      yes = libRows.isHistoryCommand('ccrc history ' + 'x '.repeat(10000));
      no = libRows.isHistoryCommand('a '.repeat(10000));
      calls = spy.mock.calls.length;
    } finally { spy.mockRestore(); }
    expect(yes).toBe(true);
    expect(no).toBe(false);
    expect(calls).toBe(0);
    for (const t of ['', '   ', 'ccrc']) expect(libRows.isHistoryCommand(t), JSON.stringify(t)).toBe(false);
    expect(libRows.isHistoryCommand('\tccrc\thistory')).toBe(true);
    expect(libRows.isHistoryCommand('\n/x/ccrc history')).toBe(true);
  });
});

describe('ftsTextOf: the FTS body is plain text, never JSON (spec 6.2, DM30 pure half)', () => {
  const T0 = '2026-10-01T10:00:00.000Z';
  it('a word after a newline in a text block is its own line; the keys type and text never appear', () => {
    const body = libRows.blobBodyOf(rowFx.assistantRow({ uuid: 'a-1', ts: T0, text: 'first line\nsecondword here' }));
    const text = libRows.ftsTextOf(body, 'entry');
    expect(text).toBe('first line\nsecondword here');
    expect(text).not.toMatch(/\btype\b|\btext\b/);
  });
  it('tool_use input string leaves, tool_result text and system content are joined with newlines', () => {
    const use = libRows.blobBodyOf(rowFx.toolUseRow({ uuid: 'a-2', ts: T0, toolUseId: 'toolu_01', name: 'Bash', input: { command: 'grep -r alpha', opts: { cwd: '/w', n: 3 } } }));
    expect(libRows.ftsTextOf(use, 'entry')).toBe('grep -r alpha\n/w');
    const res = libRows.blobBodyOf(rowFx.toolResultRow({ uuid: 'u-2', ts: T0, toolUseId: 'toolu_01', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }));
    expect(libRows.ftsTextOf(res, 'entry')).toBe('one\ntwo');
    const plain = libRows.blobBodyOf(rowFx.toolResultRow({ uuid: 'u-4', ts: T0, toolUseId: 'toolu_02', content: 'plain result text' }));
    expect(libRows.ftsTextOf(plain, 'entry')).toBe('plain result text');
    expect(libRows.ftsTextOf('system note', 'entry')).toBe('system note');
  });
  it('a deeply nested tool input is walked without recursion', () => {
    let deep: unknown = 'leaf-at-the-bottom';
    for (let i = 0; i < 20_000; i += 1) deep = { d: deep };
    expect(libRows.ftsTextOf([{ type: 'tool_use', id: 'toolu_x', name: 'X', input: deep }], 'entry')).toBe('leaf-at-the-bottom');
  });
  it('a sidecar indexes its first SIDECAR_FTS_BYTES bytes only, and a cut multi-byte character is dropped', () => {
    const N = libRows.SIDECAR_FTS_BYTES;
    const bytes = Buffer.concat([Buffer.alloc(N - 1, 0x61), Buffer.from('é'), Buffer.from(' SENTINEL-AFTER-WINDOW')]);
    const text = libRows.ftsTextOf(bytes, 'sidecar');
    expect(text.length).toBe(N - 1);
    expect(text).not.toContain('SENTINEL-AFTER-WINDOW');
    expect(libRows.ftsTextOf(Buffer.from('short é'), 'sidecar')).toBe('short é');
  });
});

describe('variantCauseOf, backendOf and the producer rule (spec 6.1, 6.2, DM2b pure half, DM38b)', () => {
  it("two copies differing only in an empty text block filled with '...' are ccd-sanitize", () => {
    const gateway = [{ type: 'text', text: '' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }];
    const anthropic = [{ type: 'text', text: '...' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }];
    expect(libRows.variantCauseOf(gateway, anthropic)).toBe('ccd-sanitize');
    expect(libRows.variantCauseOf(anthropic, gateway)).toBe('ccd-sanitize');
    expect(libRows.variantCauseOf([{ type: 'text', text: '  \n' }], [{ type: 'text', text: '...' }])).toBe('ccd-sanitize');
    expect(libRows.variantCauseOf([{ type: 'text' }], [{ type: 'text', text: '...' }])).toBe('ccd-sanitize');
  });
  it('any other difference is unknown', () => {
    expect(libRows.variantCauseOf([{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }])).toBe('unknown');
    expect(libRows.variantCauseOf([{ type: 'text', text: '' }], [{ type: 'text', text: '..' }])).toBe('unknown');
    expect(libRows.variantCauseOf([{ type: 'text', text: '' }, { type: 'text', text: 'x' }], [{ type: 'text', text: '...' }, { type: 'text', text: 'y' }])).toBe('unknown');
    expect(libRows.variantCauseOf([{ type: 'text', text: '', citations: [] }], [{ type: 'text', text: '...' }])).toBe('unknown');
    expect(libRows.variantCauseOf('a', 'b')).toBe('unknown');
    expect(libRows.variantCauseOf([1], [1, 2])).toBe('unknown');
  });
  it('backendOf: claude names are anthropic, NULL, empty and angle-bracketed are unknown, anything else other', () => {
    expect(libRows.backendOf('claude-fixture-4')).toBe('anthropic');
    for (const m of [null, undefined, '', '<synthetic>']) expect(libRows.backendOf(m)).toBe('unknown');
    expect(libRows.backendOf('gpt-fixture-5')).toBe('other');
    expect([...new Set(['claude-x', null, 'gpt-x'].map((m) => libRows.backendOf(m)))].sort()).toEqual([...(libRows.BACKENDS as unknown as readonly string[])].sort());
  });
  it('DM38b: an Anthropic to gateway straddle is produced by other, read after the summary', () => {
    const copy = [
      { type: 'assistant', model: 'claude-fixture-4' },
      { type: 'assistant', model: 'claude-fixture-4' },
      { type: 'system', model: null },
      { type: 'user', model: null },
      { type: 'assistant', model: 'gpt-fixture-5' },
    ];
    expect(libRows.producerOfCopy(copy, 3)).toBe('other');
  });
  it('DM38b: a <synthetic> row right after the summary is skipped, and a later claude row decides', () => {
    const copy = [{ type: 'user', model: null }, { type: 'assistant', model: '<synthetic>' }, { type: 'assistant', model: 'claude-fixture-4' }];
    expect(libRows.producerOfCopy(copy, 0)).toBe('anthropic');
    expect(libRows.producerOf(['<synthetic>', null, 'claude-fixture-4'])).toBe('anthropic');
  });
  it('DM38b: no real assistant row after the summary is unknown', () => {
    expect(libRows.producerOfCopy([{ type: 'assistant', model: 'claude-fixture-4' }, { type: 'user', model: null }], 1)).toBe('unknown');
    expect(libRows.producerOf([])).toBe('unknown');
  });
});

// ===========================================================================
// Task 9: redaction's pure layers. Every secret below is minted at runtime
// from node:crypto, and every shape fixture is assembled from parts, so the
// public repo never holds a key-shaped literal (and a push-protection scanner
// never sees one). The output pins (C32, C49, C59, C60) are B2's.
// ===========================================================================
describe('redaction: values, context and shapes (spec 8.3)', () => {
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const rndHex = (bytes: number): string => historyCrypto.randomBytes(bytes).toString('hex');
  const rndAlnum = (n: number): string => [...historyCrypto.randomBytes(n)].map((b) => ALNUM[b % ALNUM.length]).join('');
  const idxOf = (values: string[]): libRedact.PairIndex => libRedact.makePairIndex(libRedact.secretPairs(values).pairs);
  const M = libRedact.REDACTED_MARK;

  it('a 64-hex value is redacted after a newline and inside a JSON-shaped field', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`line one\n${tok}`, idx)).toBe(`line one\n${M}`);
    expect(libRedact.redactField(JSON.stringify({ note: `x ${tok} y` }), idx)).not.toContain(tok);
  });
  it('a value outside [A-Za-z0-9_-] loses every one of its 12+-char segments wherever it is printed', () => {
    const segs = [rndAlnum(16), rndAlnum(14), rndAlnum(12)];
    const value = `${segs[0]}/${segs[1]}+${segs[2]}=ab`;
    const { pairs, unsegmentable } = libRedact.secretPairs([value]);
    expect(pairs.map((p) => p.len).sort((a, b) => a - b)).toEqual([12, 14, 16]);
    expect(unsegmentable).toBe(0);
    const out = libRedact.redactField(`export X=${value} and again: ${segs[1]}`, libRedact.makePairIndex(pairs));
    for (const s of segs) expect(out).not.toContain(s);
  });
  it('a value with no 12-char segment counts unsegmentable; a value under 20 chars is not loaded', () => {
    expect(libRedact.secretPairs(['aaaa/bbbb/cccc/dddd/eeee'])).toEqual({ pairs: [], unsegmentable: 1 });
    expect(libRedact.secretPairs(['short-secret-123'])).toEqual({ pairs: [], unsegmentable: 0 });
  });
  it('D-4311: secretUnits answers the texts secretPairs registers a pair for, one rule', () => {
    const segs = [rndAlnum(16), rndAlnum(14), rndAlnum(12)];
    const tok = rndHex(32);
    expect(libRedact.secretUnits(tok)).toEqual([tok]);
    expect(libRedact.secretUnits(`${segs[0]}/${segs[1]}+${segs[2]}=ab`)).toEqual(segs);
    expect(libRedact.secretUnits('aaaa/bbbb/cccc/dddd/eeee')).toEqual([]);
    expect(libRedact.secretUnits('short-secret-123')).toEqual([]);
    const mixed = `${segs[0]}/${segs[1]}+${segs[2]}=ab`;
    expect(libRedact.secretPairs([mixed]).pairs.map((p) => p.len)).toEqual(libRedact.secretUnits(mixed).map((u) => u.length));
  });
  it('the pair loader keeps only len and sha256, never the value', () => {
    const tok = rndHex(32);
    const { pairs } = libRedact.secretPairs([tok, tok]);
    expect(pairs).toHaveLength(1);
    expect(Object.keys(pairs[0]!).sort()).toEqual(['len', 'sha256']);
    expect(JSON.stringify(pairs)).not.toContain(tok);
    expect(pairs[0]!.len).toBe(64);
  });
  it('an env file yields values only, so a 23-char key name stays printed', () => {
    const tok = rndHex(24);
    const tok2 = rndAlnum(30);
    const env = `# OLD_TOKEN=${rndAlnum(40)}\nexport CLAUDE_CODE_OAUTH_TOKEN="${tok}"\r\nPLAIN=${tok2} # trailing note\nEMPTY=\n  INDENTED='${tok}'\n`;
    expect(libRedact.extractSecretValues(env, 'env')).toEqual([tok, tok2, tok]);
    const idx = idxOf(libRedact.extractSecretValues(env, 'env'));
    expect(libRedact.redactField(`CLAUDE_CODE_OAUTH_TOKEN=${tok}`, idx)).toBe(`CLAUDE_CODE_OAUTH_TOKEN=${M}`);
    expect(libRedact.redactField('CLAUDE_CODE_OAUTH_TOKEN is the variable', idx)).toBe('CLAUDE_CODE_OAUTH_TOKEN is the variable');
  });
  it('an identifier-keys-only env file yields only the values of identifier-named keys', () => {
    const tok = rndHex(32);
    const env = `CCRC_ROLE=fleet\nCCRC_AGENT_TOKEN=${tok}\nCCRC_SERVER_URL=ws://box.invalid:7789\n`;
    expect(libRedact.extractSecretValues(env, 'env-identifier')).toEqual([tok]);
    expect(libRedact.extractSecretValues(env, 'env')).toEqual(['fleet', tok, 'ws://box.invalid:7789']);
  });
  it("an identifier-keys-only env file also yields a *_PRIVATE key's value: the web-push key a both box keeps in ccrc.env", () => {
    const tok = rndHex(32);
    const vapid = historyCrypto.randomBytes(32).toString('base64url');
    const env = `CCRC_ROLE=both\nCCRC_AGENT_TOKEN=${tok}\nCCRC_VAPID_PUBLIC=${rndAlnum(87)}\nCCRC_VAPID_PRIVATE=${vapid}\nCCRC_VAPID_SUBJECT=mailto:ops@box.invalid\n`;
    expect(libRedact.extractSecretValues(env, 'env-identifier')).toEqual([tok, vapid]);
    const idx = idxOf(libRedact.extractSecretValues(env, 'env-identifier'));
    expect(libRedact.redactField(`CCRC_VAPID_PRIVATE=${vapid}`, idx)).toBe(`CCRC_VAPID_PRIVATE=${M}`);
  });
  it('a token file yields its trimmed content; a json file its string leaves; garbage yields nothing', () => {
    const tok = rndHex(32);
    expect(libRedact.extractSecretValues(`  ${tok}\n`, 'token')).toEqual([tok]);
    expect(libRedact.extractSecretValues('\n', 'token')).toEqual([]);
    expect(libRedact.extractSecretValues('{"a":"x","b":["y",{"c":"z"}],"n":3}', 'json').sort()).toEqual(['x', 'y', 'z']);
    expect(libRedact.extractSecretValues('{not json', 'json')).toEqual([]);
    expect(libRedact.kindOfPath('/home/u/.ccrc/mail.token')).toBe('token');
    expect(libRedact.kindOfPath('/home/u/.ccrc/sessions.json')).toBe('json');
    expect(libRedact.kindOfPath('/home/u/.cc-secrets/claude-a-oauth.env')).toBe('env');
    expect(libRedact.kindOfPath('/home/u/.config/lane/key')).toBe('env');
  });
  it('a json secret file with a 200,000-element array or object does not throw and yields every string leaf (D-4204)', () => {
    const n = 200000;
    const arr = JSON.stringify(Array.from({ length: n }, (_, i) => `v${i}`));
    const fromArr = libRedact.extractSecretValues(arr, 'json');
    expect(fromArr.length).toBe(n);
    expect(fromArr).toContain('v0');
    expect(fromArr).toContain(`v${n - 1}`);
    const obj: Record<string, string> = {};
    for (let i = 0; i < n; i += 1) obj[`k${i}`] = `w${i}`;
    const fromObj = libRedact.extractSecretValues(JSON.stringify(obj), 'json');
    expect(fromObj.length).toBe(n);
    expect(fromObj).toContain('w0');
    expect(fromObj).toContain(`w${n - 1}`);
  });
  it("sessions.json's idHash loads as a (43, idHash) pair, never hashed again, and redacts the session token", () => {
    const token = historyCrypto.randomBytes(32).toString('base64url');
    expect(token).toHaveLength(43);
    const idHash = historyCrypto.createHash('sha256').update(token).digest('hex');
    const json = JSON.stringify([{ idHash, createdAt: 1, lastSeenAt: 1, generation: 1, label: 'phone' }, { idHash: 'not-a-hash' }]);
    const pairs = libRedact.sessionHashPairs(json);
    expect(pairs).toEqual([{ len: 43, sha256: idHash }]);
    expect(libRedact.redactField(`cookie: ccrc_session=${token}`, libRedact.makePairIndex(pairs))).not.toContain(token);
    expect(libRedact.sessionHashPairs('{}')).toEqual([]);
    expect(libRedact.sessionHashPairs('nope')).toEqual([]);
  });
  it('a token behind an ANSI colour sequence is redacted and the sequence is kept', () => {
    const tok = rndHex(32);
    expect(libRedact.redactField(`\x1b[32m${tok}\x1b[0m`, idxOf([tok]))).toBe(`\x1b[32m${M}\x1b[0m`);
  });
  it('the context layer redacts NAME=, NAME: and "name": " values, bearer and box-token headers, and token parameters', () => {
    const none = libRedact.makePairIndex([]);
    expect(libRedact.redactField('DB_PASSWORD=fixture-pass-1', none)).toBe(`DB_PASSWORD=${M}`);
    expect(libRedact.redactField('api_key: fixture-key-value', none)).toBe(`api_key: ${M}`);
    expect(libRedact.redactField('{"password": "fixture-pass-2"}', none)).toBe(`{"password": "${M}"}`);
    expect(libRedact.redactField('Authorization: Bearer fixtureBearerValue', none)).toBe(`Authorization: Bearer ${M}`);
    expect(libRedact.redactField('x-ccrc-mail-token: fixturemailvalue', none)).toBe(`x-ccrc-mail-token: ${M}`);
    expect(libRedact.redactField('-H x-ccrc-mail-token:fixturemailvalue', none)).toBe(`-H x-ccrc-mail-token:${M}`);
    expect(libRedact.redactField('https://box.invalid/x?token=abc123&y=1', none)).toBe(`https://box.invalid/x?token=${M}&y=1`);
    expect(libRedact.redactField('https://box.invalid/x?token=abc,def123&y=1', none)).toBe(`https://box.invalid/x?token=${M}&y=1`);
    expect(libRedact.redactField('CCRC_ROLE=fleet and keyboard: on', none)).toBe('CCRC_ROLE=fleet and keyboard: on');
  });
  it('a 2 MiB run with no name in it is redacted in linear time (the context name is bounded)', () => {
    const blob = historyCrypto.randomBytes(1536 * 1024).toString('base64url');
    const t0 = Date.now();
    libRedact.redactField(blob, libRedact.makePairIndex([]));
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
  // V8's backtrack stack overflows on a greedy pattern over a run of several
  // MiB: the sk- shape arm throws RangeError on a 6 MiB run, the JSON-form
  // context rule on an 8 MiB value (Node 22.13.0 and 24.14.1). LINE_MAX is past both.
  // `head` keeps a failure's message short: a 16 MiB string in it would
  // overflow the mutation runner's 1 MiB spawnSync buffer, which kills the
  // vitest child (ENOBUFS, reported as an interrupt).
  const head = (s: string): string => (s.length > 64 ? `${s.slice(0, 64)}... (${s.length} chars)` : s);
  it('a LINE_MAX shape run the engine cannot finish fails closed: that run becomes the mark, and no RangeError escapes', () => {
    const none = libRedact.makePairIndex([]);
    const run = ['s', 'k-', 'A'.repeat(libRedact.LINE_MAX - 3)].join('');
    expect(head(libRedact.redactField(run, none))).toBe(M);
    expect(head(libRedact.redactField(`kept\x1b[0m${run}`, none))).toBe(`kept\x1b[0m${M}`);
  });
  it('a LINE_MAX JSON string value fails closed too: the catch spans the context layer, not the shape loop alone', () => {
    const none = libRedact.makePairIndex([]);
    const out = libRedact.redactField(['{"password": "', 'A'.repeat(libRedact.LINE_MAX - 16), '"}'].join(''), none);
    expect(out.length, head(out)).toBeLessThan(64);
    expect(out).toContain(M);
  });
  it('the shape layer redacts sk/rk/pk keys on both arms, JWTs, PEM blocks, AWS and GitHub token shapes', () => {
    const none = libRedact.makePairIndex([]);
    const shapes = [
      ['s', 'k-proj-', rndAlnum(40)].join(''),
      ['r', 'k_', rndAlnum(24)].join(''),
      ['ey', 'J', rndAlnum(20), '.', rndAlnum(30), '.', rndAlnum(25)].join(''),
      ['AK', 'IA', rndAlnum(16).toUpperCase()].join(''),
      ['gh', 'p_', rndAlnum(36)].join(''),
      ['github', '_pat_', rndAlnum(30)].join(''),
      ['xo', 'xb-', rndAlnum(20)].join(''),
    ];
    for (const s of shapes) expect(libRedact.redactField(`before ${s} after`, none), s.slice(0, 6)).toBe(`before ${M} after`);
    const pem = ['-----BEGIN ', 'RSA PRIVATE KEY-----\n', rndAlnum(64), '\n', rndAlnum(64), '\n-----END RSA PRIVATE KEY-----'].join('');
    expect(libRedact.redactField(`key:\n${pem}\ndone`, none)).toBe(`key:\n${M}\ndone`);
  });
  // Task 9S (D-4306): the JWT arm as a regex backtracked quadratically on a
  // long run of dotless `eyJ` starts, so one large tool_result pinned a sweep
  // pass past the carrier's kill. Every expectation below was computed with
  // that regex first and is pinned literally; `~` stands for the three
  // characters that open a JWT, so no JWT-shaped literal sits in the repo.
  const EY = 'ey' + 'J';
  it('the JWT arm finds exactly the matches the old regex found (pinned literals, computed with it)', () => {
    const none = libRedact.makePairIndex([]);
    const table: Array<[string, string]> = [
    ['~aaaaaaaa.CCCCCCC.DDDDDDD', '[redacted]'],
    ['x ~aaaaaaaa.CCCCCCC.DDDDDDD y', 'x [redacted] y'],
    ['-~aaaaaaaa.CCCCCCC.DDDDDDD', '-[redacted]'],
    ['.~aaaaaaaa.CCCCCCC.DDDDDDD', '.[redacted]'],
    ['a~aaaaaaaa.CCCCCCC.DDDDDDD', 'a~aaaaaaaa.CCCCCCC.DDDDDDD'],
    ['_~aaaaaaaa.CCCCCCC.DDDDDDD', '_~aaaaaaaa.CCCCCCC.DDDDDDD'],
    ['Bearer ~aaaaaaaa.CCCCCCC.DDDDDDD', 'Bearer [redacted]'],
    ['~aaaaaaaa.CCCCCCC.DDDDDDD ~aaaaaaaa.CCCCCCC.DDDDDDD', '[redacted] [redacted]'],
    ['~aaaaaaaa.CCCCCCC.DDDDDDD.~aaaaaaaa.CCCCCCC.DDDDDDD', '[redacted].[redacted]'],
    ['~aaaaaaaa.CCCCCCC.DDDDDDD-~aaaaaaaa.CCCCCCC.DDDDDDD', '[redacted].CCCCCCC.DDDDDDD'],
    ['~abcd.bbbbb.ccccc', '~abcd.bbbbb.ccccc'],
    ['~abcde.bbbb.ccccc', '~abcde.bbbb.ccccc'],
    ['~abcde.bbbbb.cccc', '~abcde.bbbbb.cccc'],
    ['~abcde.bbbbb.ccccc.', '[redacted].'],
    ['~abcde.bbbbb.ccccc.ddddd', '[redacted].ddddd'],
    ['~abcde.bbbbb.ccccc.ddd', '[redacted].ddd'],
    ['~abcde.bbbbb', '~abcde.bbbbb'],
    ['~abcde..ccccc', '~abcde..ccccc'],
    ['~abcde.bbbbb.', '~abcde.bbbbb.'],
    ['~-~abcde.bbbbb.ccccc', '[redacted]'],
    ['~-~.bbbbb.ccccc', '~-~.bbbbb.ccccc'],
    ['~ab-~abcde.bbbbb.ccccc', '[redacted]'],
    ['~aa.~bbbbb.ccccc.ddddd', '~aa.[redacted]'],
    ['~aa.~bbbbb.ccccc.ddddd.eeeee', '~aa.[redacted].eeeee'],
    ['~aaaaa.bbbbb.ccccc.~aaaaa.bbbbb.ccccc', '[redacted].[redacted]'],
    ['~aaaaa.bbbbb.ccccc.~aaaaa.bbbbb.ccccc.~aaaaa.bbbbb.ccccc', '[redacted].[redacted].[redacted]'],
    ['x~aaaaa.bbbbb.ccccc', 'x~aaaaa.bbbbb.ccccc'],
    ['~aaaaa.b~bb.ccccc', '[redacted]'],
    ['~aaaaa.bbbbb.c~cc', '[redacted]'],
    ['~aaaaa.bbbbb.ccccc.-~aaaaa.bbbbb.ccccc', '[redacted].-[redacted]'],
    ['~aaaaaa.bbbbbb.ccccc=more', '[redacted]=more'],
    ['EYJaaaaaa.bbbbbb.cccccc', 'EYJaaaaaa.bbbbbb.cccccc'],
    ['eyjaaaaaa.bbbbbb.cccccc', 'eyjaaaaaa.bbbbbb.cccccc'],
    ['~aaaaa.bbbbb.ccccc\n~aaaaa.bbbbb.ccccc', '[redacted]\n[redacted]'],
    ['..~aaaaa.bbbbb.ccccc..', '..[redacted]..'],
    ['~.....~aaaaa.bbbbb.ccccc', '~.....[redacted]'],
    ['~aaaa.~aaaaa.bbbbb.ccccc', '~aaaa.[redacted]'],
    ['~aaaaa.bbbb.~aaaaa.bbbbb.ccccc', '~aaaaa.bbbb.[redacted]'],
    ['~aaaaa.bbbbb.cccc.~aaaaa.bbbbb.ccccc', '~aaaaa.bbbbb.cccc.[redacted]'],
    ['a.~aaaaa.bbbbb.ccccc', 'a.[redacted]'],
    ['a-~aaaaa.bbbbb.ccccc.~a', 'a-[redacted].~a'],
    ['~aaaaa.bbbbb.ccccc.~aaaaa.bbbbb', '[redacted].~aaaaa.bbbbb'],
    ['~_aaaa.b_b_b_b.c-c-c-c', '[redacted]'],
    ['~aaaaa.bbbbb.ccccc-~aaaaa.bbbbb.ccccc', '[redacted].bbbbb.ccccc'],
    ['~aaaaa.bbbbb.ccccc[x]~aaaaa.bbbbb.ccccc', '[redacted][x][redacted]'],
    ['~-----.-----.-----', '[redacted]'],
    ['~a.~aaaaa.bbbbb.ccccc', '~a.[redacted]'],
    ];
    for (const [input, expected] of table) {
      expect(libRedact.redactField(input.replaceAll('~', EY), none), input).toBe(expected.replaceAll('~', EY));
    }
  });
  it('the JWT scan agrees with the old regex on 20,000 seeded strings built from the shape\'s own pieces', () => {
    const none = libRedact.makePairIndex([]);
    const old = new RegExp(String.raw`\b${EY}[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`, 'g');
    const pieces = [EY, '.', '-', '_', 'a', 'bbbbb', 'cc', 'ccccc', 'dddddd', 'Z', '9', ' ', 'x', `${EY}aaaaa`, 'e', 'y', 'J'];
    let seed = 12345;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 20_000; i += 1) {
      let s = '';
      for (let k = 1 + Math.floor(rnd() * 14); k > 0; k -= 1) s += pieces[Math.floor(rnd() * pieces.length)];
      expect(libRedact.redactField(s, none), s).toBe(s.replace(old, M));
    }
  });
  // A bound picked from measurement: the fixed code takes about 0.1 s on each
  // 256 KiB case below (x20 = 2 s; 5 s kept for a loaded box), the old regex
  // 57 s and 26 s, far above it.
  const LINEAR_MS = 5_000;
  it('a 256 KiB run of dotless eyJ starts is redacted in linear time and left as it was', () => {
    const none = libRedact.makePairIndex([]);
    for (const unit of [`${EY}-`, `${EY}aaaaa-`]) {
      const run = unit.repeat(Math.ceil((256 * 1024) / unit.length));
      const t0 = Date.now();
      const out = libRedact.redactField(run, none);
      expect(Date.now() - t0, unit).toBeLessThan(LINEAR_MS);
      expect(out === run, unit).toBe(true);
    }
  });
  it('a real JWT after a 256 KiB run of dotless starts is still found, in linear time', () => {
    const none = libRedact.makePairIndex([]);
    const prefix = `${EY}-`.repeat(65536);
    const t0 = Date.now();
    const out = libRedact.redactField(`${prefix} ${EY}aaaaa.bbbbb.ccccc`, none);
    expect(Date.now() - t0).toBeLessThan(LINEAR_MS);
    expect(out === `${prefix} ${M}`).toBe(true);
  });
  // Task 9S (D-4307): a token coloured in PART is split across fragments, and
  // no layer sees it whole; a field with a CSI sequence gets a joined second pass.
  it('a shape split by a CSI sequence is redacted', () => {
    const none = libRedact.makePairIndex([]);
    const split = ['s', 'k-ant', '\x1b[m', '-api03-', 'x'.repeat(40)].join('');
    expect(libRedact.redactField(`\x1b[01;31m${split}`, none)).toBe(M);
  });
  it('a known value split by a CSI sequence is redacted', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`id=\x1b[31m${tok.slice(0, 10)}\x1b[0m${tok.slice(10)} end`, idx)).toBe(`id=${M} end`);
  });
  it('a wholly coloured known value is redacted and its sequences are kept; a field with no secret is returned as it came', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`a \x1b[32m${tok}\x1b[0m b`, idx)).toBe(`a \x1b[32m${M}\x1b[0m b`);
    const plain = '\x1b[1mhello\x1b[0m world \x1b[38;5;196mred\x1b[m';
    expect(libRedact.redactField(plain, idx)).toBe(plain);
  });
  it('a field holding a whole coloured secret and a partly coloured one comes back redacted twice over and uncoloured', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    const out = libRedact.redactField(`\x1b[32m${tok}\x1b[0m and ${tok.slice(0, 7)}\x1b[1m${tok.slice(7)}`, idx);
    expect(out).toBe(`${M} and ${M}`);
  });
  it('a redaction mark after a bare ESC survives the joined belt whole (redaction can create a CSI shape)', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    const split = ['s', 'k-ant', '\x1b[m', '-api03-', 'x'.repeat(40)].join('');
    // the first redaction leaves `ESC` + the mark, which reads as `ESC[r...` to a CSI match over the redacted text
    const out = libRedact.redactField(`\x1b${tok} \x1b[31m${split}`, idx);
    expect(out).toBe(`\x1b${M} ${M}`);
    expect(out.split(M)).toHaveLength(3);
  });
  it('a bare ESC before a known value, and a lone ESC before text, leave the value redacted and the rest as it came', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1b${tok}\x1b`, idx)).toBe(`\x1b${M}\x1b`);
    expect(libRedact.redactField('no secret \x1b here', idx)).toBe('no secret \x1b here');
  });
  it('F1: a CSI whose parameters hold \':\', \'<\', \'=\' or \'>\' is a CSI: the value after it is redacted and the colours kept', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1b[38:5:196m${tok}\x1b[0m`, idx)).toBe(`\x1b[38:5:196m${M}\x1b[0m`);
    expect(libRedact.redactField(`\x1b[<5m${tok}`, idx)).toBe(`\x1b[<5m${M}`);
    expect(libRedact.redactField(`\x1b[=1m${tok}`, idx)).toBe(`\x1b[=1m${M}`);
    expect(libRedact.redactField(`\x1b[>4;2m${tok}`, idx)).toBe(`\x1b[>4;2m${M}`);
  });
  it('F1: an 8-bit CSI (U+009B) is a CSI', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\u009b31m${tok}\u009b0m`, idx)).toBe(`\u009b31m${M}\u009b0m`);
  });
  it('F1: a two-byte escape does not glue its final byte onto the value after it', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1b(B${tok}`, idx)).toBe(`\x1b(B${M}`);
    expect(libRedact.redactField(`\x1b7${tok}\x1b8`, idx)).toBe(`\x1b7${M}\x1b8`);
    expect(libRedact.redactField(`\x1b_${tok}\x1b\\`, idx)).toBe(`\x1b_${M}\x1b\\`);
  });
  it('F1: a value whose first character a sequence would take as its final byte is redacted (the raw reading)', () => {
    const v = 'a' + rndHex(16);
    const idx = idxOf([v]);
    expect(libRedact.redactField(`\x1b[${v} end`, idx)).toBe(`\x1b[${M} end`);
    expect(libRedact.redactField(`\x1b${v}`, idx)).toBe(`\x1b${M}`);
  });
  it('F1: a redaction mark is never the [ or the final byte of a sequence, so the joined belt keeps it whole', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    const split = ['s', 'k-ant', '\x1b[m', '-api03-', 'x'.repeat(40)].join('');
    expect(libRedact.redactField(`\x1b[1;${tok} \x1b[31m${split}`, idx)).toBe(`1;${M} ${M}`);
    expect(libRedact.redactField(`\x1b(${tok} \x1b[31m${split}`, idx)).toBe(`\x1b(${M} ${M}`);
    expect(libRedact.redactField(`\u009b${tok} \x1b[31m${split}`, idx)).toBe(`\u009b${M} ${M}`);
  });
  it('F1: escape recognition stays linear', () => {
    const none = libRedact.makePairIndex([]);
    for (const s of [
      '\x1b[' + '0'.repeat(1 << 18),
      '\x1b['.repeat(1 << 17),
      '\u009b' + ':'.repeat(1 << 18),
      '\x1b('.repeat(1 << 17),
      '\x1b[' + ' '.repeat(1 << 18),
      ('\x1b' + ' '.repeat(64)).repeat(1 << 12),
    ]) {
      const t0 = Date.now();
      const out = libRedact.redactField(s, none);
      expect(Date.now() - t0, s.slice(0, 8)).toBeLessThan(LINEAR_MS);
      expect(out === s).toBe(true);
    }
  });
  it('FU1: a bare ESC before a value coloured in part is redacted, whatever the value\'s first character (the lead reading)', () => {
    for (const first of ['S', 'P', 'O', 'N', 'a', '1']) {
      const v = first + rndHex(16);
      const idx = idxOf([v]);
      expect(libRedact.redactField(`\x1b${v.slice(0, 8)}\x1b[31m${v.slice(8)}\x1b[0m`, idx), first).toBe(M);
    }
    const s = 'S' + rndHex(16);
    expect(libRedact.redactField(`x \x1b${s.slice(0, 8)}\x1b[31m${s.slice(8)} y`, idxOf([s]))).toBe(`x ${M} y`);
    const a = 'a' + rndHex(16);
    expect(libRedact.redactField(`\x1b[${a.slice(0, 8)}\x1b[31m${a.slice(8)}`, idxOf([a]))).toBe(M);
  });
  it('FU1: a DCS header is a sequence: the value in its data string is redacted and the header kept', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1bP1$r${tok}\x1b\\`, idx)).toBe(`\x1bP1$r${M}\x1b\\`);
    expect(libRedact.redactField(`\x901$r${tok}\x9c`, idx)).toBe(`\x901$r${M}\x9c`);
  });
  it('FU1: a single shift takes one character, and the value after that character is redacted', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1bOA${tok}`, idx)).toBe(`\x1bOA${M}`);
    expect(libRedact.redactField(`\x1bNA${tok}`, idx)).toBe(`\x1bNA${M}`);
    expect(libRedact.redactField(`\x8fA${tok}`, idx)).toBe(`\x8fA${M}`);
    expect(libRedact.redactField(`\x8eA${tok}`, idx)).toBe(`\x8eA${M}`);
  });
  it('FU1: a value whose first characters a DCS header or a single shift takes is redacted (the lead reading)', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1bO${tok}`, idx)).toBe(M);
    expect(libRedact.redactField(`\x1bN${tok}`, idx)).toBe(M);
    expect(libRedact.redactField(`\x1bP${tok} end`, idx)).toBe(`${M} end`);
    const a = 'a' + rndHex(16);
    expect(libRedact.redactField(`\x1bO${a}`, idxOf([a]))).toBe(M);
    expect(libRedact.redactField(`\x1bP${a}`, idxOf([a]))).toBe(M);
    const d = '12a' + rndHex(16);
    expect(libRedact.redactField(`\x1bP${d} end`, idxOf([d]))).toBe(`${M} end`);
    expect(libRedact.redactField(`x\x1bP${d} end`, idxOf([d]))).toBe(`x${M} end`);
  });
  it('FU1: a C0 control inside a CSI does not end it, but a line break after a cut-off CSI does', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1b[3\x081m${tok}`, idx)).toBe(`\x1b[3\x081m${M}`);
    expect(libRedact.redactField(`\x1b[3\x7f1m${tok}`, idx)).toBe(`\x1b[3\x7f1m${M}`);
    const a = 'a' + rndHex(16);
    expect(libRedact.redactField(`abc\x1b[01\n${a.slice(0, 8)}\x1b[31m${a.slice(8)}`, idxOf([a]))).toBe(`abc01\n${M}`);
  });
  it('FU1: a C0 control between ESC and the byte that opens a CSI, a DCS header or a single shift, or between a single shift and its character, does not end the sequence', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1b\x07[31m${tok}`, idx)).toBe(`\x1b\x07[31m${M}`);
    expect(libRedact.redactField(`\x1b\x7fP1$r${tok}\x1b\\`, idx)).toBe(`\x1b\x7fP1$r${M}\x1b\\`);
    expect(libRedact.redactField(`\x1b\x08OA${tok}`, idx)).toBe(`\x1b\x08OA${M}`);
    expect(libRedact.redactField(`\x1bO\x07A${tok}`, idx)).toBe(`\x1bO\x07A${M}`);
    expect(libRedact.redactField(`\x8f\x07A${tok}`, idx)).toBe(`\x8f\x07A${M}`);
    expect(libRedact.redactField(`${tok.slice(0, 10)}\x1b\x07[31m${tok.slice(10)}`, idx)).toBe(M);
    const d = '12a' + rndHex(16);
    expect(libRedact.redactField(`\x1b\x07P${d.slice(0, 8)}\x1b[1m${d.slice(8)}`, idxOf([d]))).toBe(M);
  });
  it('FU1: a mark the raw pass wrote after an 8-bit DCS or single shift, or after a C0 inside a sequence, stays whole', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    const split = ['s', 'k-ant', '\x1b[m', '-api03-', 'x'.repeat(40)].join('');
    expect(libRedact.redactField(`\x8f${tok} \x1b[31m${split}`, idx)).toBe(`\x8f${M} ${M}`);
    expect(libRedact.redactField(`\x90${tok} \x1b[31m${split}`, idx)).toBe(`\x90${M} ${M}`);
    expect(libRedact.redactField(`\x1b[1;\x08${tok} \x1b[31m${split}`, idx)).toBe(`1;\x08${M} ${M}`);
    expect(libRedact.redactField(`\x1b\x07${tok} \x1b[31m${split}`, idx)).toBe(`\x1b\x07${M} ${M}`);
    expect(libRedact.redactField(`\x1bO\x07${tok} \x1b[31m${split}`, idx)).toBe(`\x07${M} ${M}`);
  });
  it('FU1: more than LEAD_PREFIXES_MAX distinct lead prefixes before one span mark it unread (fail closed)', () => {
    const none = libRedact.makePairIndex([]);
    const stack = (n: number): string => Array.from({ length: n }, (_, i) => `\x1b[${i + 1}m`).join('');
    // n sequences `ESC[<i>m` give the prefixes 1m..<n>m and m: n + 1 distinct.
    expect(libRedact.redactField(`a ${stack(libRedact.LEAD_PREFIXES_MAX)}word b`, none)).toBe(`a ${M} b`);
    expect(libRedact.redactField(`a ${stack(libRedact.LEAD_PREFIXES_MAX - 1)}word b`, none)).toBe(`a ${stack(libRedact.LEAD_PREFIXES_MAX - 1)}word b`);
  });
  it('FU1: DCS headers, single shifts, C0 fill and the lead reading stay linear', () => {
    const none = libRedact.makePairIndex([]);
    const stack = Array.from({ length: libRedact.LEAD_PREFIXES_MAX - 1 }, (_, i) => `\x1b[${i + 1}m`).join('');
    for (const s of [
      '\x1bA'.repeat(1 << 17),
      '\x1bO'.repeat(1 << 17),
      '\x8f'.repeat(1 << 18),
      '\x1bP' + '0'.repeat(1 << 18),
      '\x1b[' + '\x01'.repeat(1 << 18),
      '\x1b[ ' + '\x01'.repeat(1 << 18),
      '\x1b' + '\x01'.repeat(1 << 18),
      ('\x1b' + '\x01'.repeat(64)).repeat(1 << 12),
      ('\x1bO' + '\x01'.repeat(64)).repeat(1 << 12),
      ('\x1b[' + '\x01'.repeat(64)).repeat(1 << 12),
      Array.from({ length: 1 << 16 }, (_, i) => `\x1b[38;5;${i % 256}ma`).join(''),
      stack + 'x'.repeat(1 << 20),
    ]) {
      const t0 = Date.now();
      const out = libRedact.redactField(s, none);
      expect(Date.now() - t0, JSON.stringify(s.slice(0, 8))).toBeLessThan(LINEAR_MS);
      expect(out === s).toBe(true);
    }
  });
  it('FU1S: a value right after a `.` whose first character a sequence took, split by a later sequence, is redacted (the span reading)', () => {
    const s = 'S' + rndHex(16);
    expect(libRedact.redactField(`foo.\x1b${s.slice(0, 8)}\x1b[31m${s.slice(8)}\x1b[0m bar`, idxOf([s]))).toBe(`foo.${M} bar`);
    const a = 'a' + rndHex(16);
    expect(libRedact.redactField(`foo.\x1b[${a.slice(0, 8)}\x1b[31m${a.slice(8)} bar`, idxOf([a]))).toBe(`foo.${M} bar`);
    const o = 'O' + rndHex(16);
    expect(libRedact.redactField(`x.\x1bO${o.slice(1, 8)}\x1b[1m${o.slice(8)}`, idxOf([o]))).toBe(`x.${M}`);
  });
  it('FU1S: past LEAD_READINGS_MAX readings, a plain sequence right after a `.` that took a value\'s first character is read to the end of the value\'s run (the offset reading)', () => {
    const a = 'a' + rndHex(16);
    expect(libRedact.redactField(`foo.\x1b[${a.slice(0, 8)}\x1b[1m\x1b[31m${a.slice(8)}\x1b[0m\x1b[K bar`, idxOf([a]))).toBe(`foo.${M} bar`);
  });
  it('FU1S: a value two sequences each took a character of, coloured between them, is redacted (the span reading)', () => {
    const v = 'S' + rndHex(16);
    const idx = idxOf([v]);
    expect(libRedact.redactField(`\x1b${v.slice(0, 6)}\x1b[31m${v.slice(6, 10)}\x1b${v.slice(10)}\x1b[0m`, idx)).toBe(M);
    expect(libRedact.redactField(`x \x1b${v.slice(0, 6)}\x1b[31m${v.slice(6, 10)}\x1bO${v.slice(10)} y`, idx)).toBe(`x ${M} y`);
    expect(libRedact.redactField(`x \x1b${v.slice(0, 6)}\x1b[31m${v.slice(6, 10)}\x1bP${v.slice(10)} y`, idx)).toBe(`x ${M} y`);
    expect(libRedact.redactField(`x \x1b${v.slice(0, 6)}\x1b[31m${v.slice(6, 10)}\x8f${v.slice(10)} y`, idx)).toBe(`x ${M} y`);
    expect(libRedact.redactField(`pre.\x1b${v.slice(0, 6)}\x1b[31m${v.slice(6, 10)}\x1b${v.slice(10)}\x1b[0m`, idx)).toBe(`pre.${M}`);
    const a = 'a' + rndHex(16);
    expect(libRedact.redactField(`\x1b[${a.slice(0, 6)}\x1b${a.slice(6)}`, idxOf([a]))).toBe(M);
    const r = 'S' + rndHex(16);
    expect(libRedact.redactField(`abc\x1b${r.slice(0, 6)}\x1b[31m${r.slice(6)} y`, idxOf([r]))).toBe(`abc${M} y`);
  });
  it('FU1S: past LEAD_READINGS_MAX readings the plain sequences are also read all as cuts, so a value a colour code sets apart from the text before it is redacted when another sequence took a character of it or splits it', () => {
    const v = 'S' + rndHex(16);
    const idx = idxOf([v]);
    expect(libRedact.redactField(`foo\x1b[1m${v.slice(0, 8)}\x1b${v.slice(8)}\x1b[0m`, idx)).toBe(`foo${M}`);
    expect(libRedact.redactField(`x foo\x1b[1m${v.slice(0, 8)}\x1bO${v.slice(8)} y`, idx)).toBe(`x foo${M} y`);
    expect(libRedact.redactField(`x foo\x1b[1m${v.slice(0, 8)}\x8f${v.slice(8)} y`, idx)).toBe(`x foo${M} y`);
    // `ESC 7` saves the cursor and shows nothing: read stripped, with the colour code before the value read as a cut.
    expect(libRedact.redactField(`foo\x1b[1m${v.slice(0, 8)}\x1b7${v.slice(8)}\x1b[0m`, idx)).toBe(`foo${M}`);
  });
  it('FU1S: past LEAD_READINGS_MAX readings of a span\'s other sequences the span is marked unread (fail closed); its plain sequences never count', () => {
    const none = libRedact.makePairIndex([]);
    expect(libRedact.LEAD_READINGS_MAX).toBe(16);
    // `ESC S` first in its span reads 2 ways, `ESC 7` and `ESC 8` inside it 4 ways each: 32 readings.
    expect(libRedact.redactField('x \x1bSab\x1b7cd\x1b8ef y', none)).toBe(`x ${M} y`);
    // `ESC P a` first in its span reads 3 ways (stripped, `Pa`, `a`), `ESC 7` inside it 4: 12, all tested, nothing found.
    expect(libRedact.redactField('x \x1bPab\x1b7cd y', none)).toBe('x \x1bPab\x1b7cd y');
    // A word every letter of which tput coloured (sgr0 is `ESC(B ESC[m`), then `ESC 7`: past the cap the plain
    // sequences are read stripped, which leaves `ESC 7`'s 3 readings.
    const rainbow = [...'refresh_token'].map((ch, i) => `\x1b[3${(i % 7) + 1}m${ch}\x1b(B\x1b[m`).join('');
    expect(libRedact.redactField(`a ${rainbow}\x1b7 b`, none)).toBe(`a ${rainbow}\x1b7 b`);
    // A sequence that takes no span character is plain too: four string terminators (`ESC` and a backslash) read
    // 16 ways together and `ESC 7` 4 ways; past the cap the terminators are read all stripped or all cut, which
    // leaves `ESC 7`'s 4 readings, all tested.
    expect(libRedact.redactField('x a\x1b\\b\x1b\\c\x1b\\d\x1b\\e\x1b7f y', none)).toBe('x a\x1b\\b\x1b\\c\x1b\\d\x1b\\e\x1b7f y');
  });
  it('FU1S: colour and cursor output of common tools comes back as it came', () => {
    const none = libRedact.makePairIndex([]);
    for (const s of [
      // grep --color=always -n: a match inside a word
      '\x1b[32m\x1b[K5\x1b[m\x1b[K\x1b[36m\x1b[K:\x1b[m\x1b[Kapi.example.com/v1/\x1b[01;31m\x1b[Ktok\x1b[m\x1b[Kens?scope=read.write status=200 \x1b[01;31m\x1b[Ktok\x1b[m\x1b[Kens_used=1234',
      // ls --color
      '\x1b[0m\x1b[01;34mnode_modules\x1b[0m  \x1b[01;32mrun.sh\x1b[0m*  \x1b[00;38;5;244m\x1b[m\x1b[00;38;5;241mREADME.md\x1b[0m',
      // git diff --word-diff=color
      'const \x1b[31mtokenValue\x1b[m\x1b[32mtokenValues\x1b[m = \x1b[31mloadToken(config.path);\x1b[m\x1b[32mloadTokens(config.paths);\x1b[m',
      // tput on xterm: setaf, bold, then sgr0 (`ESC(B ESC[m`)
      '\x1b[31m\x1b[1mERROR\x1b(B\x1b[m: config.yaml missing',
      // tput sc/cup/rc around a progress line, and apt's progress line
      '\x1b7\x1b[24;1H\x1b[42m\x1b[30mProgress: [ 45%]\x1b(B\x1b[m [##########..........]\x1b8',
      '\x1b7\x1b[24;0f\x1b[42m\x1b[30mProgress: [ 45%]\x1b[49m\x1b[39m [####################......................] \x1b8',
      // pytest's progress line, vitest's summary lines
      'tests/test_auth.py \x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[31mF\x1b[0m\x1b[32m.\x1b[0m\x1b[33ms\x1b[0m\x1b[32m    [100%]\x1b[0m',
      ' \x1b[32m+\x1b[39m demo.test.ts \x1b[2m(\x1b[22m\x1b[2m2 tests\x1b[22m\x1b[2m | \x1b[22m\x1b[31m1 failed\x1b[39m\x1b[2m)\x1b[22m\x1b[33m 18\x1b[2mms\x1b[22m\x1b[39m',
      '\x1b[2m   Duration \x1b[22m 1.45s\x1b[2m (transform 1.05s, setup 0ms, import 893ms, tests 13.53s)\x1b[22m',
      // a spinner frame: cursor hidden, a line erased, then the frame's glyph (nine prefixes, no span after them)
      '\x1b[?25l\x1b[1A\x1b[2K\x1b[G\x1b[36m|\x1b[39m Installing dependencies...',
    ]) expect(libRedact.redactField(s, none), JSON.stringify(s)).toBe(s);
  });
  it('FU1S: the span reading stays linear', () => {
    const none = libRedact.makePairIndex([]);
    for (const s of [
      '\x1bS' + 'x'.repeat(1 << 19) + '\x1b7' + 'x'.repeat(1 << 19),
      '\x1bP12a' + 'x'.repeat(1 << 19) + '\x1b7' + 'x'.repeat(1 << 19),
      '\x1b[a' + 'x'.repeat(1 << 19) + '\x1b[31m' + 'x'.repeat(1 << 19),
      '\x1bSab\x1b[1mcd \x1b[0m'.repeat(1 << 15),
      '\x1bP12a' + 'a.'.repeat(1 << 16) + '\x1b7' + 'a.'.repeat(1 << 16),
      Array.from({ length: 1 << 15 }, (_, i) => `\x1b[3${(i % 7) + 1}m${'abcdefg'[i % 7]}\x1b(B\x1b[m`).join(''),
      '\x1bP12a' + 'x\x1b[1m'.repeat(1 << 15) + '\x1b7' + 'x\x1b[1m'.repeat(1 << 15),
    ]) {
      const t0 = Date.now();
      const out = libRedact.redactField(s, none);
      expect(Date.now() - t0, JSON.stringify(s.slice(0, 8))).toBeLessThan(LINEAR_MS);
      expect(out === s).toBe(true);
    }
  });
  it('FU1S: the lead reading\'s candidates skip the context layer, which can match nothing in them, so a span of short dotted words costs a few redactions of it', () => {
    const none = libRedact.makePairIndex([]);
    const body = 'a.'.repeat(1 << 15);
    const s = `\x1bP12a${body}\x1b7${body}`;
    const plain = `P12a${body}7${body}`;
    let tOne = Infinity;
    let tLead = Infinity;
    for (let round = 0; round < 3; round += 1) {
      let t0 = performance.now();
      libRedact.redactField(plain, none);
      tOne = Math.min(tOne, performance.now() - t0);
      t0 = performance.now();
      const out = libRedact.redactField(s, none);
      tLead = Math.min(tLead, performance.now() - t0);
      expect(out === s).toBe(true);
    }
    // The span's 15 readings and the offset reading's 6 candidates: measured 3.7-4.6x one redaction of the field
    // without the context layer, 24-28x with it (8.7-9.6x at 2a8c791bf). Interleaved, each kept at its minimum.
    expect(tLead).toBeLessThan(12 * tOne);
  }, 60_000);
  it('the mark holds no JSON- or XML-special character, and the final belt applies the same layers', () => {
    expect(M).not.toMatch(/["\\<>&]/);
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    const text = `a ${tok} b DB_PASSWORD=xyz-fixture`;
    expect(libRedact.redactFinal(text, idx)).toBe(libRedact.redactField(text, idx));
  });
  it('the identifier pattern matches the upstream names and no others', () => {
    for (const n of ['CCRC_AGENT_TOKEN', 'LITELLM_MASTER_KEY', 'api_key', 'password', 'X_SECRET', 'GH_AUTH']) expect(libRedact.IDENTIFIER_RE.test(n), n).toBe(true);
    for (const n of ['CCRC_ROLE', 'Authorization', 'keyboard', 'monkey', 'CCRC_SERVER_URL']) expect(libRedact.IDENTIFIER_RE.test(n), n).toBe(false);
  });
  it('the frozen source list is exactly ccrc-owned files, and never an authDir', () => {
    const named = libRedact.SECRET_SOURCES.map((s) => s.glob ?? s.path);
    expect(named).toEqual(['.cc-secrets/*', '.ccrc/*.token', '.ccrc/exposure.env', '.ccrc/codex/*/runtime.env', '.ccrc/ccrc.env', '.ccrc/agent.env', '.ccrc/sessions.json']);
    expect(JSON.stringify(libRedact.SECRET_SOURCES)).not.toMatch(/auth[_-]?dir|oauth/i);
    expect(Object.isFrozen(libRedact.SECRET_SOURCES)).toBe(true);
  });
});

// ===========================================================================
// Task 10: the harness table (DM39) and the export's due rule, pure halves.
// O38 itself, driven through the sweep's census, is Task 26's; O14's binding
// of HARNESS_TABLE, HARNESSES and EPOCH_CAUSES is Task 34's.
// ===========================================================================
describe('HARNESS_TABLE: one row, one reader, HARNESSES derived from it (DM39)', () => {
  it("has exactly one row, claude-code, and that row's keys are exactly retention, a reader", () => {
    expect(Object.keys(libExport.HARNESS_TABLE)).toEqual(['claude-code']);
    expect(Object.keys(libExport.HARNESS_TABLE['claude-code'])).toEqual(['retention']);
    expect(typeof libExport.HARNESS_TABLE['claude-code'].retention).toBe('function');
    expect(libExport.HARNESS_TABLE['claude-code'].retention).toBe(libExport.claudeCodeRetention);
  });
  it('HARNESSES equals the keys of HARNESS_TABLE, and both are frozen', () => {
    expect([...libExport.HARNESSES]).toEqual(Object.keys(libExport.HARNESS_TABLE));
    expect(Object.isFrozen(libExport.HARNESS_TABLE)).toBe(true);
    expect(Object.isFrozen(libExport.HARNESS_TABLE['claude-code'])).toBe(true);
    expect(Object.isFrozen(libExport.HARNESSES)).toBe(true);
  });
  it('EPOCH_CAUSES has no harness-change member: it joins with its adapter (ruled Q11 c)', () => {
    expect(libExport.EPOCH_CAUSES as unknown as readonly string[]).not.toContain('harness-change');
  });
});

describe('claudeCodeRetention: the smallest cleanupPeriodDays it can read (spec 9.15)', () => {
  const absent: libExport.Readable = { state: 'absent' };
  const text = (o: unknown): libExport.Readable => ({ state: 'text', text: JSON.stringify(o) });
  const ret = (home: libExport.Readable, managed: libExport.Readable[] = [], lastDays: number | null = null) =>
    libExport.claudeCodeRetention({ home, managed, lastDays });
  it('a home setting 180 reads 180, measured', () => {
    expect(ret(text({ cleanupPeriodDays: 180 }))).toEqual({ days: 180, state: 'measured' });
  });
  it('no file setting the key reads the 30-day default', () => {
    expect(ret(absent)).toEqual({ days: 30, state: 'default' });
    expect(ret(text({ theme: 'dark' }))).toEqual({ days: 30, state: 'default' });
  });
  it('a managed file under a home of 180 wins with 90, a drop-in with 60, and the minimum always wins', () => {
    expect(ret(text({ cleanupPeriodDays: 180 }), [text({ cleanupPeriodDays: 90 })])).toEqual({ days: 90, state: 'measured' });
    expect(ret(text({ cleanupPeriodDays: 180 }), [text({ cleanupPeriodDays: 90 }), text({ cleanupPeriodDays: 60 })])).toEqual({ days: 60, state: 'measured' });
    expect(ret(absent, [text({ cleanupPeriodDays: 90 })])).toEqual({ days: 90, state: 'measured' });
    expect(ret(text({ cleanupPeriodDays: 20 }), [text({ cleanupPeriodDays: 90 })])).toEqual({ days: 20, state: 'measured' });
  });
  it('0, "x", a fraction or unparseable JSON on a home measured at 180 is unmeasured and keeps 180', () => {
    for (const bad of [text({ cleanupPeriodDays: 0 }), text({ cleanupPeriodDays: 'x' }), text({ cleanupPeriodDays: 1.5 }), text([180]), { state: 'text', text: '{not json' } as libExport.Readable]) {
      expect(ret(bad, [], 180)).toEqual({ days: 180, state: 'unmeasured' });
    }
  });
  it('an unreadable home or managed file is unmeasured, and a never-measured home falls back to 30', () => {
    expect(ret({ state: 'unreadable' }, [], 180)).toEqual({ days: 180, state: 'unmeasured' });
    expect(ret(text({ cleanupPeriodDays: 180 }), [{ state: 'unreadable' }], 180)).toEqual({ days: 180, state: 'unmeasured' });
    expect(ret({ state: 'unreadable' }, [], null)).toEqual({ days: 30, state: 'unmeasured' });
  });
});

describe('planExport and retentionLowered: what is due, what is overdue (spec 9.15, O38 and O41 pure halves)', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 11, 1);
  const homes = { '/home/u/.claude-a': 180, '/home/u/.claude-b': 180 };
  const file = (home: string, ageDays: number, present = true): libExport.ExportFile => ({ home, mtimeMs: NOW - ageDays * DAY, present });
  const ref = (tsAgeDays: number | null, files: libExport.ExportFile[]): libExport.ExportCandidate => ({ tsMs: tsAgeDays === null ? null : NOW - tsAgeDays * DAY, files });
  it('a home of 180 gives a horizon of 150 days; the margin floors at 0', () => {
    expect(libExport.exportHorizonDays(180)).toBe(150);
    expect(libExport.exportHorizonDays(30)).toBe(0);
    expect(libExport.exportHorizonDays(10)).toBe(0);
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [] }).horizonDays).toBe(150);
  });
  it('a blob whose every referrer is past the horizon is due; one younger referrer keeps it from being due', () => {
    const old = { key: 'b-old', referrers: [ref(151, [file('/home/u/.claude-a', 10)])] };
    const mixed = { key: 'b-mixed', referrers: [ref(151, [file('/home/u/.claude-a', 10)]), ref(20, [file('/home/u/.claude-a', 10)])] };
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [old, mixed] }).due).toEqual(['b-old']);
  });
  it('a referrer with a NULL ts ages by its newest holding file, never as never-old', () => {
    const nullTs = { key: 'b-null', referrers: [ref(null, [file('/home/u/.claude-a', 200), file('/home/u/.claude-b', 160)])] };
    const nullYoung = { key: 'b-null-young', referrers: [ref(null, [file('/home/u/.claude-a', 200), file('/home/u/.claude-b', 5)])] };
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [nullTs, nullYoung] }).due).toEqual(['b-null']);
  });
  it('one home on the 30-day default makes every old-enough blob due at once (the ruled rule), and is named', () => {
    const lowered = { ...homes, '/home/u/.claude-c': 30 };
    const young = { key: 'b-young', referrers: [ref(1, [file('/home/u/.claude-a', 1)])] };
    const r = libExport.planExport({ nowMs: NOW, homeRetentionDays: lowered, blobs: [young] });
    expect(r.horizonDays).toBe(0);
    expect(r.due).toEqual(['b-young']);
    expect(libExport.retentionLowered(lowered)).toEqual({ home: '/home/u/.claude-c', days: 30, othersMin: 180 });
  });
  it('retentionLowered is null for one home or when all homes agree', () => {
    expect(libExport.retentionLowered({ '/home/u/.claude-a': 30 })).toBe(null);
    expect(libExport.retentionLowered(homes)).toBe(null);
    expect(libExport.retentionLowered({})).toBe(null);
  });
  it('a due blob whose holding files are gone, or past their file-clock deletion date, is overdue; fresh files are not', () => {
    const gone = { key: 'b-gone', referrers: [ref(170, [file('/home/u/.claude-a', 10, false)])] };
    const pastClock = { key: 'b-past', referrers: [ref(170, [file('/home/u/.claude-a', 181)])] };
    const fresh = { key: 'b-fresh', referrers: [ref(170, [file('/home/u/.claude-a', 10)])] };
    const r = libExport.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [gone, pastClock, fresh] });
    expect(r.due).toEqual(['b-gone', 'b-past', 'b-fresh']);
    expect(r.overdue).toEqual(['b-gone', 'b-past']);
  });
  it('exportDates (Task 26F item 7): the row clock\'s first due date and the file clock\'s first deletion date, one definition with planExport', () => {
    const lowered = { ...homes, '/home/u/.claude-c': 30 };
    const files = [file('/home/u/.claude-a', 10), file('/home/u/.claude-c', 5), file('/home/u/.claude-b', 400, false)];
    // the 400-day file is gone: it has no deletion date. The 5-day file in the 30-day home goes at +25 days, the 10-day one in a 180-day home at +170.
    const d = libExport.exportDates({ homeRetentionDays: lowered, oldestRowMs: NOW - 160 * DAY, files });
    expect(d.firstDeletionMs).toBe(NOW + 25 * DAY);
    expect(d.firstDueMs, 'the shortest retention (30) less the margin gives a horizon of 0').toBe(NOW - 160 * DAY);
    const long = libExport.exportDates({ homeRetentionDays: homes, oldestRowMs: NOW - 160 * DAY, files: [files[0]!] });
    expect(long).toEqual({ firstDueMs: NOW - 160 * DAY + 150 * DAY, firstDeletionMs: NOW + 170 * DAY });
    // the same rule planExport reads: a file whose date has passed is overdue there, and its date is before now here
    const gone = libExport.exportDates({ homeRetentionDays: homes, oldestRowMs: null, files: [file('/home/u/.claude-a', 181)] });
    expect(gone.firstDeletionMs).toBe(NOW - 1 * DAY);
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [{ key: 'b', referrers: [ref(170, [file('/home/u/.claude-a', 181)])] }] }).overdue).toEqual(['b']);
  });
  it('exportDates: no present file or no unexported row is null, never zero; a fractional mtime rounds; a home never measured is 30 days', () => {
    expect(libExport.exportDates({ homeRetentionDays: homes, oldestRowMs: null, files: [] })).toEqual({ firstDueMs: null, firstDeletionMs: null });
    expect(libExport.exportDates({ homeRetentionDays: homes, oldestRowMs: 5, files: [file('/home/u/.claude-a', 3, false)] }).firstDeletionMs).toBeNull();
    const frac = libExport.exportDates({ homeRetentionDays: homes, oldestRowMs: null, files: [{ home: '/home/u/.claude-a', mtimeMs: 1000.6, present: true }] });
    expect(frac.firstDeletionMs).toBe(1001 + 180 * DAY);
    const unknown = libExport.exportDates({ homeRetentionDays: homes, oldestRowMs: null, files: [{ home: '/home/u/.claude-z', mtimeMs: 0, present: true }] });
    expect(unknown.firstDeletionMs, 'planExport\'s own fallback').toBe(30 * DAY);
  });
  it('a file clock reads its own home: a file in a 30-day home is past its date sooner', () => {
    const lowered = { ...homes, '/home/u/.claude-c': 30 };
    const inShort = { key: 'b-short', referrers: [ref(40, [file('/home/u/.claude-c', 31)])] };
    const inLong = { key: 'b-long', referrers: [ref(40, [file('/home/u/.claude-a', 31)])] };
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: lowered, blobs: [inShort, inLong] }).overdue).toEqual(['b-short']);
  });
  it('a referrer with no time and no holding file counts as old, and a blob with no referrer is neither due nor overdue', () => {
    const r = libExport.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [{ key: 'b-orphan', referrers: [] }, { key: 'b-clockless', referrers: [ref(null, [])] }] });
    expect(r.due).toEqual(['b-clockless']);
    expect(r.overdue).toEqual(['b-clockless']);
  });
  it('a reducer is the only seam Q15 needs: the same inputs under another reducer change the answer, not the signature', () => {
    const blob = { key: 'b-1', referrers: [ref(100, [file('/home/u/.claude-a', 100)])] };
    const lowered = { ...homes, '/home/u/.claude-c': 30 };
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: lowered, blobs: [blob] }).due).toEqual(['b-1']);
    const ownCopies: libExport.ExportReducer = (c, h) => Math.min(...c.files.map((f) => h[f.home] ?? 30));
    expect(libExport.planExport({ nowMs: NOW, homeRetentionDays: lowered, blobs: [blob], reducer: ownCopies }).due).toEqual([]);
    expect(libExport.EXPORT_REDUCERS.shortestHome(blob.referrers[0]!, lowered)).toBe(30);
  });
});

describe('passOutcome: the word and exit of a pass that does not tick', () => {
  it('exit 0 for a pause and every migration hold, exit 5 for a store the operator must repair; a held migration prints its own word', async () => {
    const { passOutcome, PASS_WORDS, EXIT } = await import('../../ccd/history/lib.mjs');
    const quiet = ['off', 'held', 'store-create-refused-role', 'store-unreachable', 'journal-unwritable', 'migration-refused', 'migration-needs-op'];
    for (const w of quiet) expect(passOutcome(w), w).toEqual({ word: w, exit: EXIT.OK });
    // `migrated` (Task 24) is a pass that DID its work; it joins the quiet arm there.
    const loud = PASS_WORDS.filter((w) => !quiet.includes(w) && w !== 'migrated');
    expect(loud, 'the vocabulary lost its store refusals').toEqual(expect.arrayContaining(['store-unbound', 'schema-newer', 'store-not-wal']));
    for (const w of loud) expect(passOutcome(w), w).toEqual({ word: w, exit: EXIT.DB });
    for (const w of [...quiet, ...loud]) expect(PASS_WORDS).toContain(passOutcome(w).word);
    expect(() => passOutcome('ok')).toThrow(/not a pass word/);
  });
});

describe('lib: ingest row helpers (plan task 19)', () => {
  it('toolUsesOf reads id, name and a string command; toolResultIdsOf reads tool_use_id', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const content = [
      { type: 'text', text: 'x' },
      { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ccrc history grep x' } },
      { type: 'tool_use', id: 'toolu_02', name: 'Read', input: { file_path: '/home/u/tree/a.md' } },
      { type: 'tool_use', name: 'NoId', input: {} },
    ];
    expect(lib.toolUsesOf(content)).toEqual([
      { id: 'toolu_01', name: 'Bash', command: 'ccrc history grep x' },
      { id: 'toolu_02', name: 'Read' },
    ]);
    expect(lib.toolUsesOf('a string body')).toEqual([]);
    expect(lib.toolResultIdsOf([{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' }, { type: 'text', text: 'y' }]))
      .toEqual(['toolu_01']);
    expect(lib.toolResultIdsOf(null)).toEqual([]);
  });
  it('rawRowKey is "x" + 32 hex of digestText(ccrc-raw/v1, [transcript, sha]), never a line ordinal', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const { createHash } = await import('node:crypto');
    const t = '6f1c2e3a-0b4d-4c5e-8f60-718293a4b5c6';
    const sha = 'ab'.repeat(32);
    const want = `x${createHash('sha256').update(['ccrc-raw/v1', t, sha].join('\0')).digest('hex').slice(0, 32)}`;
    expect(lib.rawRowKey(t, sha)).toBe(want);
    expect(lib.rawRowKey(t, sha)).toMatch(/^x[0-9a-f]{32}$/);
    expect(lib.rawRowKey(t, 'cd'.repeat(32))).not.toBe(want);
  });
  it('launchFactsOf keeps cwd and gitBranch only when they are strings', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.launchFactsOf({ cwd: '/home/u/tree', gitBranch: 'main' })).toEqual({ cwd: '/home/u/tree', gitBranch: 'main' });
    expect(lib.launchFactsOf({ cwd: 7, gitBranch: null })).toEqual({ cwd: null, gitBranch: null });
    expect(lib.launchFactsOf(null)).toEqual({ cwd: null, gitBranch: null });
  });
  it('withinBudget honours injected limits and defaults to the run budget', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.withinBudget({ elapsedMs: 0, bytes: 0 })).toBe(true);
    expect(lib.withinBudget({ elapsedMs: lib.RUN_BUDGET_MS, bytes: 0 })).toBe(false);
    expect(lib.withinBudget({ elapsedMs: 0, bytes: lib.RUN_BUDGET_BYTES })).toBe(false);
    expect(lib.withinBudget({ elapsedMs: 10, bytes: 10, maxMs: 11, maxBytes: 11 })).toBe(true);
    expect(lib.withinBudget({ elapsedMs: 10, bytes: 11, maxMs: 11, maxBytes: 11 })).toBe(false);
  });
  it('raw-only rows are harness provenance in the raw-only parse state, and the row types are the four with a body rule', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.RAW_ROW).toEqual({ type: '', provenance: 'harness', parseState: 'raw-only' });
    expect(lib.PARSE_STATE).toEqual({ ok: 'ok', rawOnly: 'raw-only' });
    expect(lib.PROVENANCE).toContain(lib.RAW_ROW.provenance);
    expect(lib.SEARCHABLE_PROVENANCE).not.toContain(lib.RAW_ROW.provenance);
    expect(lib.ROW_TYPES).toEqual(['user', 'assistant', 'system', 'attachment']);
    expect(Object.isFrozen(lib.ROW_TYPES) && Object.isFrozen(lib.RAW_ROW) && Object.isFrozen(lib.PARSE_STATE)).toBe(true);
  });
});

describe('lib: lagOfTick (plan task 20)', () => {
  it('is the wait of the oldest newly captured row, 0 with nothing new, null when unmeasurable, never negative', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.lagOfTick({ tickStartMs: 10_000, newEntries: 3, minNewTsMs: 4_000 })).toBe(6_000);
    expect(lib.lagOfTick({ tickStartMs: 10_000, newEntries: 0, minNewTsMs: null })).toBe(0);
    expect(lib.lagOfTick({ tickStartMs: 10_000, newEntries: 2, minNewTsMs: null })).toBeNull();
    expect(lib.lagOfTick({ tickStartMs: 10_000, newEntries: 1, minNewTsMs: 12_000 })).toBe(0);
  });
  it('CHUNK_BYTES is 2 MiB, within the spec bound of 16 MiB, and LINE_MAX stays 16 MiB', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.CHUNK_BYTES).toBe(2 * 1024 * 1024);
    expect(lib.LINE_MAX).toBe(16 * 1024 * 1024);
  });
});

describe('lib: linkSidecar (plan task 21)', () => {
  const C = [
    { entryId: 3, text: 'Output too large. Full output saved to: /home/u/x/tool-results/b7k2q9z1x.txt', toolUseIds: ['toolu_01AAA'] },
    { entryId: 5, text: 'short', toolUseIds: ['toolu_01BBB'] },
  ];
  it('links by the tool_result text that names the file first, then by a toolu_ name, else null', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.linkSidecar('b7k2q9z1x.txt', C)).toBe(3);
    expect(lib.linkSidecar('toolu_01BBB.json', C)).toBe(5);
    expect(lib.linkSidecar('toolu_01BBB', C)).toBe(5);
    expect(lib.linkSidecar('zz-orphan.txt', C)).toBeNull();
    expect(lib.linkSidecar('toolu_01AAA.txt', [{ entryId: 9, text: 'names toolu_01AAA.txt', toolUseIds: [] }, ...C])).toBe(9);
  });
  it('SIDECAR_WHOLE_MAX is the 64 MiB cap the reference box measured', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.SIDECAR_WHOLE_MAX).toBe(67_108_864);
  });
  it('SIDECAR_MAX_BYTES is twice the largest sidecar measured (D-4310)', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.SIDECAR_MAX_BYTES).toBe(2 * lib.SIDECAR_WHOLE_MAX);
  });
});

describe('lib: secretKindOf (plan task 22)', () => {
  it('reads sessions.json as hash pairs, the env files the frozen list marks by identifier keys only, and everything else by its own kind', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const sessions = lib.SECRET_SOURCES.find((s) => 'sessionHashes' in s && s.sessionHashes === true)!;
    const agent = lib.SECRET_SOURCES.find((s) => 'path' in s && s.path === '.ccrc/agent.env')!;
    expect(lib.secretKindOf(sessions, '/home/u/.ccrc/sessions.json')).toBe('sessions');
    expect(lib.secretKindOf(agent, '/home/u/.ccrc/agent.env')).toBe('env-identifier');
    expect(lib.secretKindOf(null, '/home/u/.ccrc/mail.token')).toBe('token');
    expect(lib.secretKindOf(null, '/home/u/.config/lane/key.env')).toBe('env');
    expect(lib.secretKindOf(null, '/home/u/.ccrc/extra.json')).toBe('json');
  });
});

describe('lib: ftsPhrase (plan task 23)', () => {
  it('quotes a value as one FTS5 phrase and doubles an embedded quote', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.ftsPhrase('zqv-0123_4567')).toBe('"zqv-0123_4567"');
    expect(lib.ftsPhrase('a"b')).toBe('"a""b"');
  });
});

// ===========================================================================
// D-4312 (history-sidecar-redact-before-cut): a sidecar's index text is redacted over a window larger than its cut,
// and only then cut (spec 8.3: redaction runs "before any slice, cap ... and before every index"). The secrets below
// are minted at runtime, and the shape fixture is assembled from parts.
// ===========================================================================
describe('sidecarIndexText: redact the window, then cut (D-4312, spec 8.3)', () => {
  const N = libRows.SIDECAR_FTS_BYTES;
  const W = N + libRows.SIDECAR_REDACT_MARGIN;
  const rndHex = (bytes: number): string => historyCrypto.randomBytes(bytes).toString('hex');
  const idxOf = (values: string[]): libRows.PairIndex => libRows.makePairIndex(libRows.secretPairs(values).pairs);
  /** `head` ends with `secret` straddling byte N: `before` of its characters lie below the cut. */
  const straddling = (secret: string, before: number, tail = ' after the cut\n'): Buffer => {
    const lead = Buffer.alloc(N - before, 0x20);
    return Buffer.concat([lead, Buffer.from(secret), Buffer.from(tail)]);
  };

  it('the margin is 64 KiB', () => {
    expect(libRows.SIDECAR_REDACT_MARGIN).toBe(65536);
  });
  it('a known value straddling the cut leaves no 12+ char prefix of itself in the text', () => {
    const tok = rndHex(24);
    const out = libRows.sidecarIndexText(straddling(tok, 20), idxOf([tok]));
    expect(out.includes(tok.slice(0, 12))).toBe(false);
    expect(out.includes(libRows.REDACTED_MARK)).toBe(true);
  });
  it('a shape-matched secret straddling the cut leaves no 12+ char prefix of itself in the text', () => {
    const body = rndHex(20);
    const secret = `${['s', 'k'].join('')}-${body}`;
    const out = libRows.sidecarIndexText(straddling(secret, 16), libRows.makePairIndex([]));
    expect(out.includes(body.slice(0, 12))).toBe(false);
    expect(out.includes(libRows.REDACTED_MARK)).toBe(true);
  });
  it('a private-key block that starts before the cut and ends past it is redacted to the window\'s end', () => {
    const pem = `-----BEGIN ${['PRIVATE', 'KEY'].join(' ')}-----\n${'QUJD'.repeat(2000)}\n-----END ${['PRIVATE', 'KEY'].join(' ')}-----`;
    const out = libRows.sidecarIndexText(straddling(pem, 40), libRows.makePairIndex([]));
    expect(out.includes('QUJDQUJD')).toBe(false);
  });
  it('a sidecar under the cut indexes exactly as before: whole, with only its secrets redacted', () => {
    const tok = rndHex(24);
    expect(libRows.sidecarIndexText(Buffer.from('short é words'), libRows.makePairIndex([]))).toBe('short é words');
    expect(libRows.sidecarIndexText(Buffer.from(`a ${tok} b`), idxOf([tok]))).toBe(`a ${libRows.REDACTED_MARK} b`);
  });
  it('the text is cut at SIDECAR_FTS_BYTES; a cut multi-byte character is dropped and a cut run loses its partial tail', () => {
    const mid = libRows.sidecarIndexText(Buffer.concat([Buffer.alloc(N - 1, 0x20), Buffer.from('é'), Buffer.from(' tail')]), libRows.makePairIndex([]));
    expect(Buffer.byteLength(mid)).toBe(N - 1);
    const inRun = libRows.sidecarIndexText(Buffer.concat([Buffer.alloc(N - 8, 0x20), Buffer.from('word splitrun-continues here')]), libRows.makePairIndex([]));
    expect(inRun.endsWith(' word ')).toBe(true);   // 'spl' is the partial run at the cut and is dropped
    const atBoundary = libRows.sidecarIndexText(Buffer.concat([Buffer.alloc(N - 4, 0x20), Buffer.from('word  more')]), libRows.makePairIndex([]));
    expect(atBoundary.endsWith('word')).toBe(true);   // the cut fell between runs: nothing to drop
  });
  it('a buffer past the window gives no more than the cut, and a secret starting inside it is still redacted', () => {
    const tok = rndHex(24);
    const bytes = Buffer.concat([Buffer.alloc(W - 5, 0x20), Buffer.from(` ${tok}`)]);   // starts below the window's end, ends past it
    const out = libRows.sidecarIndexText(Buffer.concat([bytes, Buffer.alloc(1000, 0x61)]), idxOf([tok]));
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(N);
  });
  it('ftsTextOf(…, "sidecar") applies the same cut rule (one rule, no second copy)', () => {
    const body = Buffer.concat([Buffer.alloc(N - 4, 0x20), Buffer.from('word splitrun-continues here')]);
    expect(libRows.ftsTextOf(body, 'sidecar') === libRows.sidecarIndexText(body, null)).toBe(true);   // a boolean: a failed toBe would diff 512 KiB
  });
});

// ===========================================================================
// FR1-a (D-4336, history-sidecar-index-text-unescaped): a JSON-format sidecar (`tool-results/*.json`) is indexed from
// its text with the JSON string escapes undone, so an escape letter (`n` of a backslash-n) cannot glue onto the
// secret behind it and defeat the pair layer and the `\b`-anchored shapes (spec 6.2, 8.3; RV3, SE1).
// ===========================================================================
describe('sidecarIndexText: JSON string escapes are undone before redaction (D-4336, FR1-a)', () => {
  const rndHex = (bytes: number): string => historyCrypto.randomBytes(bytes).toString('hex');
  const idxOf = (values: string[]): libRows.PairIndex => libRows.makePairIndex(libRows.secretPairs(values).pairs);
  const BS = String.fromCharCode(92);
  const ghp = (): string => `${['gh', 'p'].join('')}_${rndHex(18)}`;
  const skAnt = (): string => `${['sk', 'ant', 'api03'].join('-')}-${rndHex(20)}`;

  it('a JSON array sidecar: a shape and a known value after a newline escape are redacted, none of them verbatim', () => {
    const g = ghp(); const k = skAnt(); const v = `fixtureNotARealTokenValue${rndHex(8)}`;
    const json = JSON.stringify([{ type: 'text', text: `output:\n${g}\n${k}\n${v}\nend` }]);
    expect(json.includes(`${BS}n${g}`), 'CONTROL: the raw bytes glue the escape letter onto the secret').toBe(true);
    const out = libRows.sidecarIndexText(Buffer.from(json), idxOf([v]));
    expect(out.includes(g.slice(4))).toBe(false);
    expect(out.includes(k.slice(-20))).toBe(false);
    expect(out.includes(v.slice(0, 16))).toBe(false);
    expect(out.match(/\[redacted\]/g)?.length).toBe(3);
    expect(out.includes('output:') && out.includes('end')).toBe(true);
  });
  it('a shape after a tab escape, and a value after a carriage-return or quote or backslash escape, are redacted', () => {
    const k = skAnt(); const v = `fixtureNotARealTokenValue${rndHex(8)}`;
    for (const sep of ['\t', '\r', '"', '\\', '/', '\b', '\f']) {
      const out = libRows.sidecarIndexText(Buffer.from(JSON.stringify({ text: `a${sep}${k}${sep}${v}` })), idxOf([v]));
      expect(out.includes(k.slice(-20)), JSON.stringify(sep)).toBe(false);
      expect(out.includes(v.slice(0, 16)), JSON.stringify(sep)).toBe(false);
    }
  });
  it('an escaped ANSI sequence (a unicode escape of ESC) is read as the CSI it encodes, so the CSI belt strips around the secret', () => {
    const v = `fixtureNotARealTokenValue${rndHex(8)}`;
    const half = Math.floor(v.length / 2);
    const json = JSON.stringify({ text: `${v.slice(0, half)}\u001b[31m${v.slice(half)}` });
    expect(json.includes(`${BS}u001b`)).toBe(true);
    const out = libRows.sidecarIndexText(Buffer.from(json), idxOf([v]));
    expect(out.includes(v.slice(0, 12))).toBe(false);
    expect(out.includes(v.slice(half, half + 12))).toBe(false);
  });
  it('the escapes decode to their characters; a surrogate pair rejoins; a malformed escape is left as written', () => {
    const idx = libRows.makePairIndex([]);
    const dec = (s: string): string => libRows.sidecarIndexText(Buffer.from(s), idx);
    expect(dec(`a${BS}nb${BS}tc${BS}rd${BS}"e${BS}${BS}f${BS}/g`)).toBe('a\nb\tc\rd"e\\f/g');
    expect(dec(`${BS}u0041${BS}u00e9 ${BS}ud83d${BS}ude00`)).toBe('Aé \u{1F600}');
    expect(dec(`x${BS}u12 y${BS}q z${BS}`)).toBe(`x${BS}u12 y${BS}q z${BS}`);
    expect(dec(`${BS}${BS}n`)).toBe(`${BS}n`);                       // level 1 decodes the escaped backslash; level 2 (backslash-n to a newline) redacts nothing, so level 1 is indexed (D-4343)
  });
  it('a plain-text sidecar with no escapes indexes exactly as before', () => {
    const t = ghp();
    expect(libRows.sidecarIndexText(Buffer.from(`line one\nline two ${t}\n`), idxOf([]))).toBe(`line one\nline two ${libRows.REDACTED_MARK}\n`);
  });
});

// FR4 (D-4336, amended): decoding BEFORE any redaction is itself a parser differential, so the window is redacted RAW,
// then decoded, then redacted again (the union of both readings). Two shapes the decode-first order leaked: a decode
// that JOINS two registered segments of a secret into one run no pair matches, and a decoded escaped quote that
// changes where the JSON-form context rule thinks a value ends.
describe('sidecarIndexText: the window is redacted raw, then decoded, then redacted again (D-4336, FR4)', () => {
  const rndHex = (bytes: number): string => historyCrypto.randomBytes(bytes).toString('hex');
  const idxOf = (values: string[]): libRows.PairIndex => libRows.makePairIndex(libRows.secretPairs(values).pairs);
  const BS = String.fromCharCode(92);

  it('a secret holding a literal backslash-u sequence between two segments: decoding would join them, neither survives', () => {
    const a = rndHex(8); const b = rndHex(8);
    const v = `${a}${BS}u0041${b}`;
    const out = libRows.sidecarIndexText(Buffer.from(`found ${v} end`), idxOf([v]));
    expect(out.includes(a.slice(0, 12)), 'first segment').toBe(false);
    expect(out.includes(b.slice(0, 12)), 'second segment').toBe(false);
    expect(out.includes('found') && out.includes('end')).toBe(true);
    const json = Buffer.from(`{"k":"${v.replaceAll(BS, BS + BS)}"}`);
    const out2 = libRows.sidecarIndexText(json, idxOf([v]));
    expect(out2.includes(a.slice(0, 12)) || out2.includes(b.slice(0, 12)), 'a JSON-escaped spelling of the same value').toBe(false);
  });
  it('a JSON password whose value holds an escaped quote is redacted whole: no abc, no def', () => {
    const win = `{"password": "abc${BS}"def", "n": 1}`;
    const out = libRows.sidecarIndexText(Buffer.from(win), libRows.makePairIndex([]));
    expect(out.includes('abc'), out).toBe(false);
    expect(out.includes('def'), out).toBe(false);
  });
  it('FR1 cases still redact: a secret after an escaped newline and after an escaped tab', () => {
    const v = `fixtureNotARealTokenValue${rndHex(8)}`;
    for (const e of ['n', 't']) {
      const out = libRows.sidecarIndexText(Buffer.from(`{"t":"x${BS}${e}${v}"}`), idxOf([v]));
      expect(out.includes(v.slice(0, 16)), e).toBe(false);
    }
  });
  it('a plain window with no backslash is byte-identical to the single-pass result', () => {
    const v = `fixtureNotARealTokenValue${rndHex(8)}`;
    const idx = idxOf([v]);
    const text = `plain line one\nvalue ${v} then "password": "hunter2hunter2" tail\n`;
    const single = libRows.redactField(text, idx);
    expect(libRows.sidecarIndexText(Buffer.from(text), idx)).toBe(single);
  });
});

describe('redactForIndex: every JSON-escape reading before every index, kept only when it redacts (D-4343, review 316 F2)', () => {
  const rndHex = (bytes: number): string => historyCrypto.randomBytes(bytes).toString('hex');
  const idxOf = (values: string[]): libRows.PairIndex => libRows.makePairIndex(libRows.secretPairs(values).pairs);
  const BS = String.fromCharCode(92);
  const M = libRows.REDACTED_MARK;
  const LINEAR_MS = 5_000;
  const v = `fixtureNotARealTokenValue${rndHex(8)}`;
  const idx = idxOf([v]);

  it('the reviewer case: an escaped backslash before n and a value', () => {
    expect(libRows.sidecarIndexText(Buffer.from(JSON.stringify({ text: BS + 'n' + v })), idx).includes(v.slice(0, 16))).toBe(false);
  });
  it('a JSON string holding JSON: the inner newline escape is read too', () => {
    expect(libRows.sidecarIndexText(Buffer.from(JSON.stringify({ t: JSON.stringify({ t: '\n' + v }) })), idx).includes(v.slice(0, 16))).toBe(false);
  });
  it('a backslash-u-005c chain is read one level per decode', () => {
    expect(libRows.sidecarIndexText(Buffer.from(`{"t":"${BS}u005cn${v}"}`), idx).includes(v.slice(0, 16))).toBe(false);
  });
  it('a 64-backslash run converges below the bound, and the reading that redacted is the one indexed', () => {
    expect(libRows.redactForIndex(`${BS.repeat(64)}n${v} tail`, idx)).toBe(`\n${M} tail`);
  });
  it('at the bound, every span touching a backslash is the mark', () => {
    expect(libRows.redactForIndex(`head ${BS.repeat(1024)}n${v} tail`, idx)).toBe(`head ${M} tail`);
  });
  // 2^8 backslashes converge on the 9th decode and 2^9 on the 10th, so a raise of INDEX_UNESCAPE_PASSES to 9 reds the first
  // and to 10 reds both; at 8 each stops at the bound and its span is the mark (FU3F, FU1's value window).
  it.each([[256], [512]])('a %i-backslash run still reaches the bound: the value is marked (FU3F)', (n) => {
    expect(libRows.redactForIndex(`head ${BS.repeat(n)}n${v} tail`, idx)).toBe(`head ${M} tail`);
  });
  it('at the bound, a JWT glued to an escape is marked whole, its payload and signature too', () => {
    const jwt = `eyJ${rndHex(10)}.eyJ${rndHex(20)}.${rndHex(16)}`;
    expect(libRows.redactForIndex(`x ${BS.repeat(1024)}n${jwt} y`, libRows.makePairIndex([]))).toBe(`x ${M} y`);
  });
  it('an entry\'s plain text holding a literal backslash-n before a value is read and redacted', () => {
    expect(libRows.redactForIndex(`{"a":"x${BS}n${v}"}`, idx).includes(v.slice(0, 16))).toBe(false);
  });
  it('a text whose deeper readings redact nothing is indexed exactly as it came', () => {
    const asIs = `${BS}begin{equation} C:${BS}new_folder${BS}tests printf("done${BS}n") ${BS}u0041`;
    expect(libRows.redactForIndex(asIs, idx)).toBe(asIs);
    expect(libRows.sidecarIndexText(Buffer.from(JSON.stringify({ t: `${BS}begin` })), idx)).toBe(`{"t":"${BS}begin"}`);
  });
  it('pathological escapes stay bounded', () => {
    for (const s of [BS.repeat(1 << 20) + 'n' + v, (BS + 'u005c').repeat(1 << 17) + 'n' + v]) {
      const t0 = Date.now();
      libRows.redactForIndex(s, idx);
      expect(Date.now() - t0).toBeLessThan(LINEAR_MS);
    }
  });
  it('a deep backslash-u-005c chain in front of a large body costs no more redactions than the bound allows (review 316 M2)', () => {
    // A chain of 64 levels never reaches a fixpoint within INDEX_UNESCAPE_PASSES, and the body does not shrink, so
    // every decode re-redacts the whole body: the bound, not the input, is what is counted. The count is of full
    // redactions, not of time (fix round 1, F1: a wall-clock ratio measured 20.4x, 28.1x and 36.0x under bursty
    // load). The value layer asks the index once per run, and the body is RUNS runs of length 4 and nothing else is
    // that length, so the asks of that length divided by RUNS are the redactions performed. The body holds no escape
    // introducer, so redactField is one redaction per call.
    const RUNS = 1 << 12;
    const body = 'word '.repeat(RUNS);
    const s = `${BS}${'u005c'.repeat(64)}n ${body}`;
    const countingIdx = (): { idx: libRows.PairIndex; asks: () => number } => {
      let asks = 0;
      const byLen = new Map<number, { has(sha256: string): boolean }>();
      byLen.get = (len: number) => {
        if (len === 4) asks += 1;
        return undefined;
      };
      return { idx: { byLen }, asks: () => asks };
    };
    const one = countingIdx();
    libRows.redactField(s, one.idx);
    expect(one.asks(), 'CONTROL: one redaction asks once per body run').toBe(RUNS);
    const many = countingIdx();
    // an empty pair set redacts no value, so the chain never reaches a mark and the decodes run to the bound
    expect(libRows.redactForIndex(s, many.idx) === `${M} ${body}`).toBe(true);
    // The bound is written out here on purpose: derived from the constant, a raise of it would raise the assertion too.
    // FU3F (FU1 M2 minor): a ceiling written out as 8 (a raise reds it, and so does the 256- and 512-backslash value case
    // below), so a LOWER bound still passes; `toBeGreaterThan(RUNS)` shows the passes ran.
    expect(many.asks()).toBeLessThanOrEqual((8 + 1) * RUNS);
    expect(many.asks()).toBeGreaterThan(RUNS);
  }, 60_000);
});

// FR1 round 1 F1 (D-4336, D-4312): the window is measured in RAW bytes but the cut runs on the unescaped text, which an
// escape-dense JSON sidecar shrinks by a byte per escape. The cut must keep SIDECAR_REDACT_MARGIN bytes of redacted text
// behind it whenever the raw window was filled, or a secret straddling the raw window end (redaction saw only a prefix of
// it) lands in the index.
describe('sidecarIndexText: an escape-dense window keeps its redaction margin (D-4336, D-4312, FR1 round 1)', () => {
  const BS = String.fromCharCode(92);
  const W = libRows.SIDECAR_FTS_BYTES + libRows.SIDECAR_REDACT_MARGIN;
  const HEADER = 'eyJhbGciOiJIUzI1NiJ9';
  const PAYLOAD = 'eyJzdWIiOiJ1c2VyMTIzNDU2In0';
  const jwtWhole = (sig: string): string => `${HEADER}.${PAYLOAD}.${sig}`;
  it.each([0, 1, 3])('a JWT whose raw window end falls %i characters into its signature leaves no header or payload in the index', (into) => {
    // an odd `into` makes rawBefore odd: pad one raw byte so the escape count stays whole
    const jwtHead = `${HEADER}.${PAYLOAD}.`;
    const pad = (W - jwtHead.length - into) % 2 === 0 ? '' : ' ';
    const rawBefore = W - jwtHead.length - into - pad.length;
    const bytes = Buffer.from(`${pad}${`${BS}n`.repeat(rawBefore / 2)}${jwtWhole('abcDEF123_-xyzQRSTUV')}${BS}n tail`);
    expect(bytes.subarray(0, W).toString('latin1').endsWith(`${jwtHead}${'abcDEF123_-xyzQRSTUV'.slice(0, into)}`), 'CONTROL: the raw window ends inside the signature').toBe(true);
    const out = libRows.sidecarIndexText(bytes, libRows.makePairIndex([]));
    expect(out.includes(HEADER)).toBe(false);
    expect(out.includes(PAYLOAD)).toBe(false);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(libRows.SIDECAR_FTS_BYTES);
  });
  it('the same JWT behind plain spaces (no shrink) leaves nothing either, and a full window of plain text still indexes its whole cut', () => {
    const jwtHead = `${HEADER}.${PAYLOAD}.`;
    const bytes = Buffer.from(`${' '.repeat(W - jwtHead.length - 1)}${jwtWhole('abcDEF123_-xyzQRSTUV')} tail`);
    const out = libRows.sidecarIndexText(bytes, libRows.makePairIndex([]));
    expect(out.includes(HEADER)).toBe(false);
    expect(Buffer.byteLength(out)).toBe(libRows.SIDECAR_FTS_BYTES);
  });
  it('an unescaped text that kept the full margin still indexes SIDECAR_FTS_BYTES; one that kept less is cut that much earlier', () => {
    const small = Buffer.from(`${BS}n`.repeat(W / 2));   // W raw bytes, W/2 text bytes: nothing but newlines
    const out = libRows.sidecarIndexText(small, libRows.makePairIndex([]));
    expect(Buffer.byteLength(out)).toBe(W / 2 - libRows.SIDECAR_REDACT_MARGIN);
    expect(libRows.sidecarIndexText(Buffer.from(`${BS}n`.repeat(libRows.SIDECAR_REDACT_MARGIN / 4)), libRows.makePairIndex([])).length).toBe(libRows.SIDECAR_REDACT_MARGIN / 4);   // under the window: whole
  });
});

// ===========================================================================
// FR1-b (D-4312): the trailing-run drop is a backward scan. The unanchored `[A-Za-z0-9_-]+$` it replaced is quadratic in
// the length of an EARLIER run (measured at the final review: 1.8 s at 40,000 characters, 6.9 s at 80,000, about
// 290 s at the largest run a 512 KiB cut allows), run inside ingestSidecar's write transaction.
// ===========================================================================
describe('sidecarIndexText: the trailing-run drop is linear (D-4312, FR1-b)', () => {
  const N = libRows.SIDECAR_FTS_BYTES;
  const W = N + libRows.SIDECAR_REDACT_MARGIN;
  const idx = (): libRows.PairIndex => libRows.makePairIndex([]);
  // The window is filled with two-byte escapes that read as one character, so the text is shorter than the window and,
  // the raw window being full, is cut at L - SIDECAR_REDACT_MARGIN, inside its tail ( FR1 round 1 F1: the cut
  // keeps the margin). The tail's last `pad` bytes are spaces. The expected results were computed with the regex.
  const M = libRows.SIDECAR_REDACT_MARGIN;
  const escapePad = (tail: string, pad: number): { bytes: Buffer; lead: number } => {
    const n = (W - tail.length - pad) / 2;
    expect(Number.isInteger(n)).toBe(true);
    return { bytes: Buffer.from(`${String.raw`\n`.repeat(n)}${tail}${' '.repeat(pad)}`), lead: n };
  };

  it('a long early run, a separator and a long run across the cut finishes in well under a second (the regex took seconds; this takes about 10 ms)', () => {
    const k = 80_000;                                    // the regex measured 6.9 s here
    const bytes = Buffer.from(`${'A'.repeat(k)} ${'B'.repeat(W + 100_000 - k)}`);
    const t0 = performance.now();
    const out = libRows.sidecarIndexText(bytes, idx());
    const ms = performance.now() - t0;
    expect(out).toBe(`${'A'.repeat(k)} `);               // the cut fell inside the B run: that partial run is dropped
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(1000);
  });
  it('the same shape under the window-full arm (escapes shrink the text under the cut) is just as fast', () => {
    const k = 80_000; const m = 100_000;
    const bytes = Buffer.from(`${String.raw`\n`.repeat(m)}${'A'.repeat(k)} ${'B'.repeat(W - 2 * m - k - 1)}`);
    expect(bytes.length).toBe(W);
    const t0 = performance.now();
    const out = libRows.sidecarIndexText(bytes, idx());
    const ms = performance.now() - t0;
    expect(out).toBe(`${'\n'.repeat(m)}${'A'.repeat(k)} `);
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(1000);
  });
  it('ordinary inputs give the regex\'s result (literal cases computed with the regex)', () => {
    const inRun = libRows.sidecarIndexText(Buffer.concat([Buffer.alloc(N - 8, 0x20), Buffer.from('word splitrun-continues here')]), idx());
    expect(inRun.length).toBe(524285);
    expect(inRun.endsWith('   word ')).toBe(true);
    const atBoundary = libRows.sidecarIndexText(Buffer.concat([Buffer.alloc(N - 4, 0x20), Buffer.from('word  more')]), idx());
    expect(atBoundary.length).toBe(524288);
    expect(atBoundary.endsWith('    word')).toBe(true);
    const cutAllRun = libRows.sidecarIndexText(Buffer.concat([Buffer.from('x '), Buffer.alloc(N, 0x41), Buffer.from('BBBB')]), idx());
    expect(cutAllRun).toBe('x ');
    expect(libRows.sidecarIndexText(Buffer.alloc(W, 0x41), idx())).toBe('');   // a window that is one run, all of it dropped
    // window-full arm: the cut sits M bytes before the text's end, `cut` bytes into the tail
    const a = escapePad('ab cd-ef', M - 2);               // cut after 'ab cd-': the partial run 'cd-' is dropped
    expect(libRows.sidecarIndexText(a.bytes, idx())).toBe(`${'\n'.repeat(a.lead)}ab `);
    const b = escapePad('ab cd e', M - 1);                // cut after 'ab cd ': between runs, nothing to drop
    expect(libRows.sidecarIndexText(b.bytes, idx())).toBe(`${'\n'.repeat(b.lead)}ab cd `);
    const c = escapePad('AAAAAA', M - 2);                 // cut after 'AAAA': the whole run, all of it dropped
    expect(libRows.sidecarIndexText(c.bytes, idx())).toBe('\n'.repeat(c.lead));
    const d = escapePad('_-_ x', M - 1);                  // cut after '_-_ ': ends in a space, nothing to drop
    expect(libRows.sidecarIndexText(d.bytes, idx())).toBe(`${'\n'.repeat(d.lead)}_-_ `);
  });
});

// ===========================================================================
// FU7 (D-4419, final review FP2 and FP7): every index text is the first ENTRY_FTS_BYTES of its text after redactForIndex
// has read a window ENTRY_REDACT_MARGIN larger, cut by the sidecar's one rule. redactForIndex reads up to nine times what
// it is given, so over an entry's whole plain text (about 16 MB at LINE_MAX) one call outlived the carrier's 600 s kill
// and a U+008F-dense line aborted every pass in a 1 GiB scope.
// ===========================================================================
describe('entryIndexText: redact a window ENTRY_REDACT_MARGIN past ENTRY_FTS_BYTES, then cut (D-4419, FU7)', () => {
  const N = libRows.ENTRY_FTS_BYTES;
  const W = N + libRows.ENTRY_REDACT_MARGIN;
  const none = (): libRows.PairIndex => libRows.makePairIndex([]);
  const HEADER = 'eyJhbGciOiJIUzI1NiJ9';
  const PAYLOAD = 'eyJzdWIiOiJ1c2VyMTIzNDU2In0';
  const SIG = 'abcDEF123_-xyzQRSTUV';

  it('the window: ENTRY_FTS_BYTES is 1 MiB and its margin is the sidecar\'s', () => {
    expect(libRows.ENTRY_FTS_BYTES).toBe(1024 * 1024);
    expect(libRows.ENTRY_REDACT_MARGIN).toBe(libRows.SIDECAR_REDACT_MARGIN);
  });
  it('a text shorter than the window is redactForIndex\'s text, unchanged by the cut', () => {
    const BS = String.fromCharCode(92);
    const v = `fixtureNotARealTokenValue${historyCrypto.randomBytes(8).toString('hex')}`;
    const idx = libRows.makePairIndex(libRows.secretPairs([v]).pairs);
    for (const t of ['plain words', `a ${v} b`, `head ${BS.repeat(64)}n${v} tail`, `x \x1b[1m${v}\x1b[0m y`, 'a b '.repeat(200_000)]) {
      expect(libRows.entryIndexText(t, idx) === libRows.redactForIndex(t, idx), JSON.stringify(t.slice(0, 24))).toBe(true);
    }
  });
  it('a longer text keeps its first ENTRY_FTS_BYTES, its trailing partial run dropped', () => {
    const out = libRows.entryIndexText('word '.repeat(3 << 18), none());   // 3.75 MiB; byte N falls one byte into a word
    expect(out === 'word '.repeat(209_715)).toBe(true);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(N);
  });
  it('the redaction reads the window and never the whole text (the cost bound: a count of value-layer asks, not time)', () => {
    // The text holds no escape introducer and no backslash, so redactForIndex is one redaction, which asks the index once
    // per run; every run is `ab`, so the asks of length 2 are the runs it read. Unwindowed it reads all 5,600,000.
    let asks = 0;
    const byLen = new Map<number, { has(sha256: string): boolean }>();
    byLen.get = (len: number) => {
      if (len === 2) asks += 1;
      return undefined;
    };
    const text = 'ab '.repeat(5_600_000);   // 16.8 MB, 5,600,000 runs
    const out = libRows.entryIndexText(text, { byLen });
    expect(asks).toBeGreaterThan(W / 3 - 2);
    expect(asks).toBeLessThanOrEqual(Math.ceil(W / 3));
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(N);
  });
  it.each([0, 1, 3])('a JWT the cut falls %i characters into the signature of leaves no header or payload: redaction precedes the cut', (into) => {
    const jwtHead = `${HEADER}.${PAYLOAD}.`;
    const text = `${' '.repeat(N - jwtHead.length - into)}${jwtHead}${SIG} tail ${'x '.repeat(W)}`;
    expect(Buffer.from(text).subarray(0, N).toString('latin1').endsWith(`${jwtHead}${SIG.slice(0, into)}`), 'CONTROL: byte N lies inside the signature').toBe(true);
    const out = libRows.entryIndexText(text, none());
    expect(out.includes(HEADER)).toBe(false);
    expect(out.includes(PAYLOAD)).toBe(false);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(N);
  });
  it('one cut rule: sidecarIndexText and entryIndexText both end in cutIndexText, the only caller of dropTrailingRun', () => {
    const src = readFileSync(fileURLToPath(new URL('../../ccd/history/lib.mjs', import.meta.url)), 'utf8');
    const body = (fn: string): string => {
      const at = src.indexOf(`export function ${fn}(`);
      expect(at, fn).toBeGreaterThan(-1);
      return src.slice(at, src.indexOf('\n}\n', at));
    };
    expect(body('sidecarIndexText')).toMatch(/return cutIndexText\(text, w\.windowCut, SIDECAR_FTS_BYTES, SIDECAR_REDACT_MARGIN\);/);
    expect(body('entryIndexText')).toMatch(/return cutIndexText\(redactForIndex\(w\.text, idx\), w\.windowCut, ENTRY_FTS_BYTES, ENTRY_REDACT_MARGIN\);/);
    expect((src.match(/\bdropTrailingRun\(/g) ?? []).length).toBe(2);   // its definition and cutIndexText's one call
    expect((src.match(/\bfunction cutIndexText\(/g) ?? []).length).toBe(1);
  });
});

// ===========================================================================
// FU7 (D-4307 amended, final review FP4): the joined reading's text is built from the per-fragment results, so a key a
// colour code split after its shape's first characters was `[redacted]<rest>` to it, and the rest reached blobs_fts even
// with the key's pair registered. A mark that ends a fragment right before a sequence is carried across it to the end of
// its span.
// ===========================================================================
describe('redactField: a mark that ends a fragment before a sequence is carried to the end of its span (D-4307, FU7 FP4)', () => {
  const M = libRedact.REDACTED_MARK;
  const none = (): libRedact.PairIndex => libRedact.makePairIndex([]);
  const pairOf = (v: string): libRedact.PairIndex => libRedact.makePairIndex(libRedact.secretPairs([v]).pairs);
  // Fixed fixture characters, never a real key: the shape arms read only the prefix and the run class.
  const SK = `${['sk', 'ant', 'api03'].join('-')}-${'Qx7Lm2Np9Rs4Tv6Wy8Za1Cb3De5Fg0Hj'.repeat(2).slice(0, 60)}`;
  const GHP = `${'ghp'}_${'Kd8Jf2Lg5Mh9Nj3Pk6Ql1Rm4Sn7Tp0Uq2Vr5'.slice(0, 36)}`;
  /** Every `w`-character piece of `key` the stripped output holds (sequences and their escaped forms removed). */
  const pieces = (out: string, key: string, w: number): string[] => {
    const plain = out.replace(/(?:\x1b|\\+u001b)(?:\[[0-?]*[ -/]*[@-~]|\([0-~])/g, '');
    const hit: string[] = [];
    for (let i = 0; i + w <= key.length; i += 1) if (plain.includes(key.slice(i, i + w))) hit.push(key.slice(i, i + w));
    return hit;
  };
  it('grep\'s highlight of characters 40-50 of an sk- key: the rest of the key is marked, pair registered or not', () => {
    const t = `x ${SK.slice(0, 40)}\x1b[01;31m\x1b[K${SK.slice(40, 50)}\x1b[m\x1b[K${SK.slice(50)} y`;
    for (const idx of [none(), pairOf(SK)]) {
      expect(pieces(libRedact.redactField(t, idx), SK, 8)).toEqual([]);
      expect(pieces(libRedact.redactForIndex(t, idx), SK, 8)).toEqual([]);
    }
    expect(libRedact.redactField(t, none())).toBe(`x ${M}${M} y`);
  });
  it('a ghp_ token a bold code splits after 18 characters: its last 18 are marked, pair registered or not', () => {
    const t = `x ${GHP.slice(0, 22)}\x1b[1m${GHP.slice(22)} y`;
    for (const idx of [none(), pairOf(GHP)]) expect(libRedact.redactField(t, idx)).toBe(`x ${M}${M} y`);
  });
  it('CONTROL: a token coloured in whole, a space after its closing code, keeps its colours (nothing to carry)', () => {
    expect(libRedact.redactField(`x \x1b[1m${GHP}\x1b[m y`, none())).toBe(`x \x1b[1m${M}\x1b[m y`);
  });
  it('fail closed: span characters right after a token coloured in whole are marked with it', () => {
    expect(libRedact.redactField(`x \x1b[1m${GHP}\x1b[0m.txt y`, none())).toBe(`x ${M}${M} y`);
  });
  // Two rows, one seed and trial count each (FU10, B5M6): two classes leaked at 7d23b8d6f (the carry fix's parent), a ghp_ value
  // with its pair registered (4,053 of 10,000 trials) and an sk-ant-api03 key with no pair at all, which reaches the shape arm only
  // (5,680 of 10,000). Both figures are this generator's, its seed reset per row as here (FR2a, review 344 F8); at this case's
  // 2,000 trials they are 807 and 1,152.
  it('a fixed-seed sweep of ghp_ pair values, and of sk-ant-api03 keys with no pair, split by one to three realistic sequences, at JSON escape levels 0-2, leaks no 8-character piece', () => {
    const SEQS = ['\x1b[1m', '\x1b[0m', '\x1b[m', '\x1b[01;31m', '\x1b[K', '\x1b[01;31m\x1b[K', '\x1b[m\x1b[K', '\x1b[32m', '\x1b[1;32m',
      '\x1b[39m', '\x1b[22m', '\x1b(B', '\x1b[0;1;31m', '\x1b[38;5;196m', '\x1b[4m', '\x1b[7m'];
    const AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const SKP = `${['sk', 'ant', 'api03'].join('-')}-`;
    const rows: Array<{ name: string; make: (rnd: (n: number) => number) => string; skip: number; index: (tok: string) => libRedact.PairIndex }> = [
      { name: 'ghp_, pair registered', make: (rnd) => `ghp_${Array.from({ length: 36 }, () => AL[rnd(AL.length)]).join('')}`, skip: 0, index: pairOf },
      { name: 'sk-ant-api03, no pair', make: (rnd) => `${SKP}${Array.from({ length: 60 }, () => AL[rnd(AL.length)]).join('')}`, skip: SKP.length, index: () => none() },
    ];
    const leaked: Record<string, string[]> = {};
    for (const row of rows) {
      let x = 20261008;
      const rnd = (n: number): number => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
      const leaks: string[] = [];
      for (let trial = 0; trial < 2000; trial += 1) {
        const tok = row.make(rnd);
        const cuts = [...new Set(Array.from({ length: 1 + rnd(3) }, () => 1 + rnd(tok.length - 1)))].sort((a, b) => a - b);
        let s = '';
        let last = 0;
        for (const c of cuts) { s += tok.slice(last, c) + SEQS[rnd(SEQS.length)]; last = c; }
        let text = `word ${s}${tok.slice(last)} more`;
        for (let l = rnd(3); l > 0; l -= 1) text = JSON.stringify(text).slice(1, -1);
        if (pieces(libRedact.redactForIndex(text, row.index(tok)), tok.slice(row.skip), 8).length > 0) leaks.push(JSON.stringify(text));
      }
      leaked[row.name] = leaks.slice(0, 3);
    }
    expect(leaked).toEqual({ 'ghp_, pair registered': [], 'sk-ant-api03, no pair': [] });   // both rows reported, so a mutation names the row it reds
  }, 60_000);
});

// ===========================================================================
// Task 25 review round 1 (F1): the op marker's one grammar, `<verb> <pid> <start_ms>` (§9.6 op-running). Task 28's
// status reads it through this parser, and a pass's stale-marker sweep decides on its null.
// ===========================================================================
describe('lib: parseOpMarker (plan task 25)', () => {
  it('accepts <verb> <pid> <start_ms>, with or without the trailing newline the writer adds', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.parseOpMarker('import 4242 1700000000000\n')).toEqual({ verb: 'import', pid: 4242, startMs: 1700000000000 });
    expect(lib.parseOpMarker('migrate 1 0')).toEqual({ verb: 'migrate', pid: 1, startMs: 0 });
  });

  it('rejects every other shape as null: a stale marker names no live pid', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    for (const bad of ['', '\n', 'import', 'import 4242', 'import 0 1700000000000', 'import -4 1700000000000',
      'import 4242 -1', 'import 4242 1.5', 'Import 4242 1700000000000', 'import  4242 1700000000000',
      'import 4242 1700000000000 extra', 'import 4242 1700000000000\nimport 4243 1', 'import 12345678901 1',
      `${'a'.repeat(33)} 4242 1`, 'import abc 1']) {
      expect(lib.parseOpMarker(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

// ── task 28: deriveHealth — every §9.6 rule as a word (history spec §9.6) ─────
// Pure: every input is a parameter, the clock included. Each case names the
// word it expects and its class; the coverage case binds the table to
// HEALTH_WORDS both ways, so a word with no producing input, or an input
// producing an undeclared word, is red here before doctor ever prints it.
describe('deriveHealth: every §9.6 rule as a word with its class, detail and remedy (task 28)', () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60_000;
  const STORE = '5f0c2d3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f';
  /** A healthy bound store that ticked a minute ago: the baseline every case
   *  breaks exactly one leg of. */
  const base = (o: Partial<healthLib.HealthInputs> = {}): healthLib.HealthInputs => ({
    nowMs: NOW, storeId: STORE, exit: 0, reason: null,
    shimMtimeMs: NOW - 60 * MIN, lastTickMs: NOW - MIN, lagS: 5, sizeBytes: 1_000_000,
    capGb: 50, capMalformed: false, capFile: '/home/u/.ccrc/cap-fixture', capturePause: '',
    migration: 'none', userVersion: 1, codeVersion: 1, historyOff: false, recovering: null, op: null,
    bytesBehindLast3: [0, 0, 0], fts: 'ready', modesWrong: [], rootIsSymlink: false,
    redactUnreadable: [], breakerOpen: false, rosterUnreadable: false, exportDue: 0, exportOverdue: 0,
    exportWriterLive: false, exportPausedLowDisk: false, retentionLowered: null, retentionUnmeasured: [],
    journalGrowth30d: 0, journalSkipped: 0, blobUndecodable: 0, drainRejected: 0, spoolDisplaced: 0, spoolBlocked: 0, spoolUnreadable: 0, spoolNotDirectory: false, exportSegmentNewer: [], exportSegmentMissing: 0,
    journalUnwritable: false, dbPath: '/home/u/.ccrc/history/db', freeBytes: 100_000_000_000,
    thresholdBytes: 20_000_000_000, copyBps: null, backupsDb: [], journalStoreDirs: [], extrasUnmeasured: [],
    ...o,
  });
  const words = (r: healthLib.HealthResult, cls: 'warn' | 'fail'): string[] => r[cls].map((i) => i.word);
  const RECOVER = { step: 'recover/1', cursor: '2026-10.0a1b2c3d.jsonl:4096' };   // task 27's envelope spelling
  const WORD_CASES: Array<[string, 'pass' | 'warn' | 'fail', Partial<healthLib.HealthInputs>]> = [
    ['ok', 'pass', {}],
    ['first-tick-pending', 'pass', { exit: 6, lastTickMs: null, shimMtimeMs: NOW - MIN }],
    ['off', 'warn', { historyOff: true }],
    ['recovering', 'warn', { recovering: { ...RECOVER, cursorUnmovedTicks: 2 } }],
    ['recovery-stalled', 'fail', { recovering: { ...RECOVER, cursorUnmovedTicks: 15 } }],
    ['op-running', 'warn', { op: { verb: 'backup', pid: 4242, alive: true } }],
    ['catching-up', 'warn', { bytesBehindLast3: [300, 200, 100] }],
    ['lag-unmeasured', 'warn', { lagS: null }],
    ['tick-stale', 'fail', { lastTickMs: NOW - 11 * MIN }],
    ['lag-high', 'fail', { lagS: 31 * 60 }],
    ['at-cap', 'fail', { capturePause: 'at-cap' }],
    ['capture-paused-low-disk', 'fail', { capturePause: 'low-disk' }],
    ['mode-wrong', 'fail', { modesWrong: [{ path: '/data/history-db', want: '0700', got: '0755' }] }],
    ['schema-newer', 'fail', { userVersion: 2, migration: 'refuse-newer' }],
    ['store-not-wal', 'fail', { exit: 5, reason: 'store-not-wal' }],
    ['store-unmeasured', 'fail', { exit: 5, reason: 'store-unmeasured' }],
    ['store-root-dangling', 'fail', { exit: 5, reason: 'store-root-dangling' }],
    ['store-missing', 'fail', { exit: 5, reason: 'store-missing' }],
    ['store-mismatch', 'fail', { exit: 5, reason: 'store-mismatch' }],
    ['store-unbound', 'fail', { exit: 5, reason: 'store-unbound' }],
    ['store-unreachable', 'fail', { exit: 5, reason: 'store-unreachable' }],
    ['store-recoverable', 'fail', { exit: 5, reason: 'store-recoverable', storeId: null }],
    ['store-wal-orphaned', 'fail', { exit: 5, reason: 'store-wal-orphaned', storeId: null }],
    ['store-zero-byte', 'fail', { exit: 5, reason: 'store-zero-byte' }],
    ['store-schema-missing', 'fail', { exit: 5, reason: 'store-schema-missing' }],   // Task 6's word
    ['migration-refused', 'fail', { migration: 'refuse-low-disk' }],
    ['migration-needs-op', 'fail', { migration: 'snapshot-needs-op' }],
    ['journal-unwritable', 'fail', { journalUnwritable: true }],
    ['export-segment-newer', 'fail', { exportSegmentNewer: ['7.0a1b2c3d.db'] }],
    ['export-overdue', 'fail', { exportOverdue: 3 }],
    ['status-unreadable', 'fail', { exit: 1 }],
    ['fts-unavailable', 'warn', { fts: 'fts5-absent' }],
    ['cap-malformed', 'warn', { capMalformed: true }],
    ['redact-source-unreadable', 'warn', { redactUnreadable: ['/home/u/.cc-secrets/fixture.env'] }],
    ['cap-near', 'warn', { sizeBytes: 41 * 2 ** 30 }],
    ['breaker-open', 'warn', { breakerOpen: true }],
    ['roster-unreadable', 'warn', { rosterUnreadable: true }],
    ['root-is-symlink', 'warn', { rootIsSymlink: true }],
    ['export-due', 'warn', { exportDue: 12 }],
    ['export-paused-low-disk', 'warn', { exportPausedLowDisk: true }],
    ['retention-unmeasured', 'warn', { retentionUnmeasured: ['/home/u/.claude-a'] }],
    ['retention-lowered', 'warn', { retentionLowered: { home: '/home/u/.claude-b', days: 30, othersMin: 180 } }],
    ['export-segment-missing', 'warn', { exportSegmentMissing: 2 }],
    ['journal-record-skipped', 'warn', { journalSkipped: 4 }],
    ['journal-growth', 'warn', { journalGrowth30d: 41_943_041 }],
    ['blob-undecodable', 'warn', { blobUndecodable: 2 }],
    ['drain-rejected', 'warn', { drainRejected: 3 }],
    ['spool-planted', 'warn', { spoolDisplaced: 2, spoolBlocked: 1 }],
  ];

  it('the healthy baseline is PASS ok, with nothing to warn or fail', () => {
    expect(healthLib.deriveHealth(base())).toEqual({ pass: 'ok', warn: [], fail: [] });
    // Exit 9 judges nothing: doctor's relay SKIPs on it (Task 32).
    expect(healthLib.deriveHealth(base({ exit: 9 }))).toEqual({ pass: null, warn: [], fail: [] });
  });

  it.each<[{ spoolDisplaced?: number; spoolBlocked?: number }]>([[{ spoolDisplaced: 2 }], [{ spoolBlocked: 1 }]])('spool-planted fires on either counter alone (D-4347 (history-planted-entries-never-wedge)) %j, and names both counts', (o) => {
    const i = healthLib.deriveHealth(base(o)).warn.find((x) => x.word === 'spool-planted');
    expect(i?.detail).toContain(`${o.spoolDisplaced ?? 0} spool file(s) set aside under .draining/planted/ and ${o.spoolBlocked ?? 0} skipped drain(s)`);
    expect(i?.remedy).toContain('~/.ccrc/history/spool/.draining/');
  });

  it('spool-planted fires on spool_unreadable alone, and names it apart from the planted counts (FU8, FP5)', () => {
    const i = healthLib.deriveHealth(base({ spoolUnreadable: 3 })).warn.find((x) => x.word === 'spool-planted');
    expect(i?.detail).toContain('3 skipped drain(s) of a draining file or its sidecar the sweep could not read, whose id\'s later files wait behind it');
    expect(i?.detail, 'the planted clause is left out when its counts are 0').not.toContain('set aside');
    expect(i?.remedy).toContain('readable by this user (chmod 600, or chown them)');
    const both = healthLib.deriveHealth(base({ spoolDisplaced: 2, spoolUnreadable: 1 })).warn.find((x) => x.word === 'spool-planted');
    expect(both?.detail).toContain('2 spool file(s) set aside under .draining/planted/ and 0 skipped drain(s)');
    expect(both?.detail).toContain('; 1 skipped drain(s) of a draining file or its sidecar the sweep could not read');
  });

  it('spool-planted names a spool/ that is not a real directory on its own, with its own remedy (FU8, FP3)', () => {
    const i = healthLib.deriveHealth(base({ spoolNotDirectory: true })).warn.find((x) => x.word === 'spool-planted');
    expect(i?.detail).toContain('spool/ is not a real directory (a link or a file stands there), so no hook spools a line and no pass drains one while it stands');
    expect(i?.detail, 'the counted clauses are left out when their counts are 0').not.toContain('skipped drain(s)');
    expect(i?.remedy).toContain('remove a link or file that stands at ~/.ccrc/history/spool itself (the next pass makes the directory again)');
    expect(healthLib.deriveHealth(base()).warn.find((x) => x.word === 'spool-planted'), 'CONTROL: a real spool/ and no counts').toBeUndefined();
  });

  it('blob-undecodable names how many stored blobs did not decode, and its remedy says the damage is storage corruption (D-4346)', () => {
    const i = healthLib.deriveHealth(base({ blobUndecodable: 2 })).warn.find((x) => x.word === 'blob-undecodable');
    expect(i?.detail).toContain('2 stored blob(s)');
    expect(i?.remedy).toContain('storage corruption');
  });

  it('HEALTH_WORDS gains ok as a pass word, beside first-tick-pending', () => {
    expect(healthLib.HEALTH_WORDS['ok']).toBe('pass');
    expect(healthLib.HEALTH_WORDS['first-tick-pending']).toBe('pass');
  });

  it.each(WORD_CASES)('%s is produced, in its class (%s)', (word, cls, o) => {
    const r = healthLib.deriveHealth(base(o));
    if (cls === 'pass') expect(r.pass).toBe(word);
    else expect(words(r, cls), JSON.stringify(r)).toContain(word);
  });

  it('every HEALTH_WORDS member has a producing case, in the class HEALTH_WORDS gives it — and no case names an undeclared word', () => {
    expect(WORD_CASES.map((c) => c[0]).sort()).toEqual(Object.keys(healthLib.HEALTH_WORDS).sort());
    for (const [word, cls] of WORD_CASES) expect(healthLib.HEALTH_WORDS[word], word).toBe(cls);
  });

  it('every item names the store it measured and carries a non-empty remedy; every word it emits is declared in its class', () => {
    for (const [, , o] of WORD_CASES) {
      const r = healthLib.deriveHealth(base(o));
      const id = (o.storeId === undefined ? STORE : o.storeId) ?? '(none)';
      for (const cls of ['warn', 'fail'] as const) {
        for (const i of r[cls]) {
          expect(i.detail.startsWith(`store ${id}: `), i.detail).toBe(true);
          expect(i.remedy.trim().length, `${i.word} has no remedy`).toBeGreaterThan(0);
          expect(healthLib.HEALTH_WORDS[i.word], i.word).toBe(cls);
        }
      }
    }
  });

  it('HEALTH_REMEDIES names exactly the warn and fail words, each with text', () => {
    const want = Object.entries(healthLib.HEALTH_WORDS).filter(([, c]) => c !== 'pass').map(([w]) => w).sort();
    expect(Object.keys(healthLib.HEALTH_REMEDIES).sort()).toEqual(want);
    for (const w of want) expect(healthLib.HEALTH_REMEDIES[w]!.length, w).toBeGreaterThan(0);
  });

  // FR3-d (final review C11): B1's `ccrc history` answers `status` only, so a remedy doctor relays must name an action a B1 build has.
  it('no remedy sends the operator to a ccrc history verb this build refuses, unless it says the verb arrives with W1-B2 (FR3-d)', () => {
    const texts: Array<[string, string]> = Object.entries(healthLib.HEALTH_REMEDIES).map(([w, t]) => [`static ${w}`, t]);
    const dynamic: Array<Partial<healthLib.HealthInputs>> = [
      ...WORD_CASES.map(([, , o]) => o),
      ...(['store-missing', 'store-unbound', 'store-recoverable', 'store-zero-byte', 'store-schema-missing'] as const).flatMap((reason) =>
        [{ exit: 5, reason }, { exit: 5, reason, backupsDb: ['20261001T000000Z.db'], journalStoreDirs: ['0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'] }]),
      { sizeBytes: 41 * 2 ** 30 }, { capturePause: 'at-cap', sizeBytes: 50 * 2 ** 30 },
    ];
    for (const o of dynamic) {
      const r = healthLib.deriveHealth(base(o));
      for (const i of [...r.warn, ...r.fail]) texts.push([`derived ${i.word}`, i.remedy]);
    }
    let named = 0;
    for (const [what, text] of texts) {
      const verbs = text.match(/ccrc history (?:doctor --[a-z]+|prune)/g) ?? [];
      named += verbs.length;
      if (verbs.length > 0) expect(text, `${what} names ${verbs.join(', ')} without saying it arrives with W1-B2`).toMatch(/arrives? with W1-B2/);
      expect(text, `${what} names the export writer's update as the action`).not.toMatch(/update (?:this box )?to a build with the export writer/);
    }
    expect(named, 'the scan found no verb to check: the pin would pass on anything').toBeGreaterThan(5);
  });
  // FR3 fix round 1 (F1/F2): a plain cp into history.db is peeked by the 2-minute sweep half-copied (decideStoreOpen reads a non-empty DB with a
  // store.id as `open`), lands 0644, skips --restore's journal replay and then makes --restore/--rebuild refuse. B1 tells the operator to wait.
  it('no store-loss remedy offers copying a backup over history.db: it says capture stays held, the journal keeps the data, and do not copy (FR3 round 1)', () => {
    const texts: Array<[string, string]> = ['store-missing', 'store-zero-byte', 'store-schema-missing'].map((w) => [`static ${w}`, healthLib.HEALTH_REMEDIES[w]!]);
    for (const reason of ['store-missing', 'store-zero-byte', 'store-schema-missing'] as const) {
      for (const o of [{ exit: 5, reason }, { exit: 5, reason, backupsDb: ['20261001T000000Z.db'] }]) {
        for (const i of healthLib.deriveHealth(base(o)).fail) texts.push([`derived ${reason}${o.backupsDb ? ' with a backup' : ''}`, i.remedy]);
      }
    }
    expect(texts.length).toBeGreaterThan(5);
    for (const [what, t] of texts) {
      expect(t, `${what} offers the by-hand copy`).not.toMatch(/can be copied to history\.db/);
      expect(t, `${what} must say capture stays held`).toContain('capture stays held');
      expect(t, `${what} must say the journal keeps the drained data`).toContain('journal keeps everything drained');
      expect(t, `${what} must say not to copy a backup over history.db`).toContain('do not copy a backup over history.db by hand');
    }
  });
  it('export-overdue tells the operator what a B1 build can do: keep the store and raise cleanupPeriodDays (FR3-d)', () => {
    const r = healthLib.HEALTH_REMEDIES['export-overdue']!;
    expect(r).toContain('cleanupPeriodDays');
    expect(r).toContain('W1-B4');
  });

  it('the off remedy names the switch through SWITCHES, the one spelling (O13)', () => {
    const r = healthLib.deriveHealth(base({ historyOff: true }));
    expect(r.warn.find((i) => i.word === 'off')!.remedy).toContain(healthLib.SWITCHES.off);
  });

  // ── the grace D-4168 ──
  it('within the grace, with no tick yet (exit 6), the answer is PASS first-tick-pending and nothing else', () => {
    expect(healthLib.deriveHealth(base({ exit: 6, lastTickMs: null, lagS: null, shimMtimeMs: NOW - MIN, capMalformed: true })))
      .toEqual({ pass: 'first-tick-pending', warn: [], fail: [] });
  });
  it('within the grace, a bound store with no ticks row yet is first-tick-pending too', () => {
    expect(healthLib.deriveHealth(base({ lastTickMs: null, lagS: null, shimMtimeMs: NOW - 3 * MIN })).pass).toBe('first-tick-pending');
  });
  it('past the grace with no tick yet is FAIL tick-stale', () => {
    const r = healthLib.deriveHealth(base({ exit: 6, lastTickMs: null, lagS: null, shimMtimeMs: NOW - 5 * MIN }));
    expect(r.pass).toBeNull();
    expect(words(r, 'fail')).toEqual(['tick-stale']);
  });
  it('the grace never hides a binding refusal: exit 5 store-recoverable inside it is FAIL store-recoverable', () => {
    const r = healthLib.deriveHealth(base({ exit: 5, reason: 'store-recoverable', storeId: null, lastTickMs: null, shimMtimeMs: NOW - MIN, journalStoreDirs: ['0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'] }));
    expect(words(r, 'fail')).toEqual(['store-recoverable']);
    expect(r.fail[0]!.remedy).toContain('journal/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e');
  });
  it('a box that has ticked is judged by its ticks even with a freshly re-placed shim (an update copies it without -p)', () => {
    expect(words(healthLib.deriveHealth(base({ shimMtimeMs: NOW - MIN, lastTickMs: NOW - 20 * MIN })), 'fail')).toContain('tick-stale');
  });

  // ── the state words, both clauses each (§9.6 step 4) D-4251 ──
  it('history-off with no tick for an hour is WARN off, never the stale-tick FAIL', () => {
    const r = healthLib.deriveHealth(base({ historyOff: true, lastTickMs: NOW - 60 * MIN }));
    expect(words(r, 'warn')).toContain('off');
    expect(words(r, 'fail')).not.toContain('tick-stale');
  });
  it('a live op marker with no tick for 40 min is WARN op-running; a dead pid\'s marker is the stale-tick FAIL', () => {
    const live = healthLib.deriveHealth(base({ op: { verb: 'backup', pid: 4242, alive: true }, lastTickMs: NOW - 40 * MIN }));
    expect(words(live, 'warn')).toContain('op-running');
    expect(words(live, 'fail')).not.toContain('tick-stale');
    const dead = healthLib.deriveHealth(base({ op: { verb: 'backup', pid: 4242, alive: false }, lastTickMs: NOW - 40 * MIN }));
    expect(words(dead, 'warn')).not.toContain('op-running');
    expect(words(dead, 'fail')).toContain('tick-stale');
  });
  it('bytes behind falling across three ticks is WARN catching-up, naming what remains; flat with a 2 h lag is the lag FAIL', () => {
    const falling = healthLib.deriveHealth(base({ bytesBehindLast3: [300, 200, 100], lagS: 7200 }));
    expect(words(falling, 'warn')).toContain('catching-up');
    expect(falling.warn.find((i) => i.word === 'catching-up')!.detail).toContain('100 bytes');
    expect(words(falling, 'fail')).not.toContain('lag-high');
    const flat = healthLib.deriveHealth(base({ bytesBehindLast3: [100, 100, 100], lagS: 7200 }));
    expect(words(flat, 'warn')).not.toContain('catching-up');
    expect(words(flat, 'fail')).toContain('lag-high');
  });
  // D-4314 (history-doctor-states-need-a-fresh-tick): catching-up and recovering are held states only while the
  // sweep is RUNNING; their evidence (the last three ticks rows, recover_unmoved_ticks) stops changing when it dies.
  it('a falling backlog or a moving recovery step holds the freshness FAILs only under a fresh tick; a 3 h old tick is the tick-stale FAIL (D-4314)', () => {
    const fallingFresh = healthLib.deriveHealth(base({ bytesBehindLast3: [300, 200, 100], lagS: 7200, lastTickMs: NOW - 2 * MIN }));
    expect(words(fallingFresh, 'warn')).toContain('catching-up');
    expect(words(fallingFresh, 'fail')).toEqual([]);
    const fallingDead = healthLib.deriveHealth(base({ bytesBehindLast3: [300, 200, 100], lagS: 7200, lastTickMs: NOW - 180 * MIN }));
    expect(words(fallingDead, 'fail')).toContain('tick-stale');
    expect(words(fallingDead, 'warn')).not.toContain('catching-up');
    const recoveringFresh = healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 2 }, lastTickMs: NOW - 2 * MIN }));
    expect(words(recoveringFresh, 'warn')).toContain('recovering');
    expect(words(recoveringFresh, 'fail')).toEqual([]);
    const recoveringDead = healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 2 }, lastTickMs: NOW - 180 * MIN }));
    expect(words(recoveringDead, 'fail')).toContain('tick-stale');
  });
  it('the fresh-tick bound is TICK_STALE_MS inclusive: a catching-up sweep exactly at it is held, one millisecond past it is stale (D-4314)', () => {
    const at = healthLib.deriveHealth(base({ bytesBehindLast3: [300, 200, 100], lastTickMs: NOW - healthLib.TICK_STALE_MS }));
    expect(words(at, 'fail')).toEqual([]);
    const past = healthLib.deriveHealth(base({ bytesBehindLast3: [300, 200, 100], lastTickMs: NOW - healthLib.TICK_STALE_MS - 1 }));
    expect(words(past, 'fail')).toEqual(['tick-stale']);
  });
  it('an unmeasured lag shares that inclusive bound: lag-unmeasured is held and warned exactly at TICK_STALE_MS, tick-stale one millisecond past it (D-4314)', () => {
    const at = healthLib.deriveHealth(base({ lagS: null, lastTickMs: NOW - healthLib.TICK_STALE_MS }));
    expect(words(at, 'warn')).toContain('lag-unmeasured');
    expect(words(at, 'fail')).toEqual([]);
    const past = healthLib.deriveHealth(base({ lagS: null, lastTickMs: NOW - healthLib.TICK_STALE_MS - 1 }));
    expect(words(past, 'warn')).not.toContain('lag-unmeasured');
    expect(words(past, 'fail')).toEqual(['tick-stale']);
  });
  it('a held state with no tick at all is the tick-stale FAIL too: nothing ran to hold the verdict (D-4314)', () => {
    const none = healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 2 }, lastTickMs: null, shimMtimeMs: NOW - 60 * MIN }));
    expect(words(none, 'fail')).toContain('tick-stale');
  });
  it('off and a live op marker stay held with a 3 h old tick: neither is tick evidence (D-4314)', () => {
    expect(words(healthLib.deriveHealth(base({ historyOff: true, lastTickMs: NOW - 180 * MIN })), 'fail')).toEqual([]);
    expect(words(healthLib.deriveHealth(base({ op: { verb: 'backup', pid: 4242, alive: true }, lastTickMs: NOW - 180 * MIN })), 'fail')).toEqual([]);
  });
  // Task 28F item 3: an input status could not read is not a healthy input (the no-overloaded-null rule).
  it('an extras read that failed is FAIL status-unreadable naming what could not be read, beside whatever else was measured', () => {
    const r = healthLib.deriveHealth(base({ extrasUnmeasured: ['breaker', 'spool/.draining'], capMalformed: true }));
    expect(words(r, 'fail')).toEqual(['status-unreadable']);
    const item = r.fail[0]!;
    expect(item.detail).toContain('breaker');
    expect(item.detail).toContain('spool/.draining');
    expect(item.remedy).toBe(healthLib.HEALTH_REMEDIES['status-unreadable']);
    expect(words(r, 'warn')).toEqual(['cap-malformed']);
    expect(r.pass).toBeNull();
  });
  it('RF5b F11: an exit-5 store-read-failed is FAIL status-unreadable naming the reason, and no other fail', () => {
    const r = healthLib.deriveHealth(base({ exit: 5, reason: 'store-read-failed' }));
    expect(r.fail).toHaveLength(1);
    expect(r.fail[0]!.word).toBe('status-unreadable');
    expect(r.fail[0]!.detail).toContain('exit 5 (store-read-failed)');
  });
  it('nothing unmeasured adds no status-unreadable', () => {
    expect(words(healthLib.deriveHealth(base({ extrasUnmeasured: [] })), 'fail')).toEqual([]);
  });
  it('lag unmeasured with a tick younger than 10 min is WARN lag-unmeasured; with a stale tick it is the stale-tick FAIL', () => {
    expect(words(healthLib.deriveHealth(base({ lagS: null, lastTickMs: NOW - 2 * MIN })), 'warn')).toContain('lag-unmeasured');
    const stale = healthLib.deriveHealth(base({ lagS: null, lastTickMs: NOW - 12 * MIN }));
    expect(words(stale, 'warn')).not.toContain('lag-unmeasured');
    expect(words(stale, 'fail')).toContain('tick-stale');
  });
  it('a recovery step is WARN recovering; unmoved for 15 ticks it is FAIL recovery-stalled; held by the floor or the off-switch it stays a WARN', () => {
    const moving = healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 14 }, lastTickMs: NOW - 2 * MIN }));
    expect(words(moving, 'warn')).toContain('recovering');
    expect(words(moving, 'fail')).toEqual([]);
    expect(words(healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 15 } })), 'fail')).toContain('recovery-stalled');
    const floor = healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 40 }, capturePause: 'low-disk' }));
    expect(words(floor, 'warn')).toContain('recovering');
    expect(words(floor, 'fail')).not.toContain('recovery-stalled');
    const off = healthLib.deriveHealth(base({ recovering: { ...RECOVER, cursorUnmovedTicks: 40 }, historyOff: true }));
    expect(words(off, 'fail')).not.toContain('recovery-stalled');
  });

  // ── dynamic remedies the doctor rules name ──
  it('store-unbound names meta.store_id and the --adopt remedy', () => {
    const r = healthLib.deriveHealth(base({ exit: 5, reason: 'store-unbound' }));
    expect(r.fail[0]!.detail).toContain(STORE);
    expect(r.fail[0]!.remedy).toContain('ccrc history doctor --adopt');
  });
  it('store-missing names --restore with the backup db/backups holds, and --rebuild', () => {
    const r = healthLib.deriveHealth(base({ exit: 5, reason: 'store-missing', backupsDb: ['20261001T000000Z.db'] }));
    expect(r.fail[0]!.remedy).toContain('ccrc history doctor --restore 20261001T000000Z.db');
    expect(r.fail[0]!.remedy).toContain('--rebuild');
  });
  it('mode-wrong names each path and its chmod', () => {
    const r = healthLib.deriveHealth(base({ modesWrong: [{ path: '/data/history-db', want: '0700', got: '0755' }] }));
    expect(r.fail[0]!.detail).toContain('/data/history-db is 0755, wants 0700');
    expect(r.fail[0]!.remedy).toBe('chmod 0700 /data/history-db');
  });
  it('migration-needs-op names its estimate and ccrc history doctor --migrate; migration-refused names the filesystem and the room', () => {
    const op = healthLib.deriveHealth(base({ migration: 'snapshot-needs-op', sizeBytes: 50_000_000_000, copyBps: 10_000_000 }));
    expect(op.fail[0]!.detail).toContain('5000 s');
    expect(op.fail[0]!.remedy).toContain('ccd-history-sweep --op migrate');
    expect(op.fail[0]!.remedy).toContain('ccrc history doctor --migrate');
    const room = healthLib.deriveHealth(base({ migration: 'refuse-low-disk', sizeBytes: 1_000, thresholdBytes: 9_000, freeBytes: 500 }));
    expect(room.fail[0]!.detail).toContain('/home/u/.ccrc/history/db');
    expect(room.fail[0]!.remedy).toContain('10000 bytes');
  });
  it('cap-malformed and cap-near name the cap file from the input, never a spelled switch', () => {
    expect(healthLib.deriveHealth(base({ capMalformed: true })).warn[0]!.detail).toContain('/home/u/.ccrc/cap-fixture');
    expect(healthLib.deriveHealth(base({ sizeBytes: 41 * 2 ** 30 })).warn[0]!.remedy).toContain('/home/u/.ccrc/cap-fixture');
  });
  it('at the cap, cap-near is not repeated beside the at-cap FAIL', () => {
    const r = healthLib.deriveHealth(base({ capturePause: 'at-cap', sizeBytes: 50 * 2 ** 30 }));
    expect(words(r, 'fail')).toContain('at-cap');
    expect(words(r, 'warn')).not.toContain('cap-near');
  });
  it('fts-pending is derivation in progress, not unavailable: no WARN', () => {
    expect(healthLib.deriveHealth(base({ fts: 'fts-pending' })).pass).toBe('ok');
  });
  it('a B1 build WARNs export-due from the first due blob; a live export writer (B4) is B4\'s rule', () => {
    expect(words(healthLib.deriveHealth(base({ exportDue: 1 })), 'warn')).toEqual(['export-due']);
    expect(healthLib.deriveHealth(base({ exportDue: 1, exportWriterLive: true })).pass).toBe('ok');
  });

  // ── modes ──
  it('modeWantOf: every directory 0700; files under db, card, steer, journal and export 0600; spool and binding files unjudged', () => {
    expect(healthLib.modeWantOf('.', 'dir')).toBe('0700');
    expect(healthLib.modeWantOf('spool', 'dir')).toBe('0700');
    expect(healthLib.modeWantOf('db', 'dir')).toBe('0700');
    expect(healthLib.modeWantOf('db/history.db-wal', 'file')).toBe('0600');
    expect(healthLib.modeWantOf('db/backups/pre-v2.db', 'file')).toBe('0600');
    expect(healthLib.modeWantOf('journal/5f0c2d3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f/2026-10.0a1b2c3d.jsonl', 'file')).toBe('0600');
    expect(healthLib.modeWantOf('card/x/y.txt', 'file')).toBe('0600');
    expect(healthLib.modeWantOf('spool/x.jsonl', 'file')).toBeNull();
    expect(healthLib.modeWantOf('spool/.draining/x.1.2.jsonl', 'file')).toBeNull();
    expect(healthLib.modeWantOf('store.id', 'file')).toBeNull();
  });
  it('modesWrongOf names the shown path, the wanted mode and the measured one, and passes what matches', () => {
    expect(healthLib.modesWrongOf([
      { rel: 'db', kind: 'dir', mode: 0o40755, shown: '/data/history-db' },
      { rel: 'db/history.db', kind: 'file', mode: 0o100600, shown: '/home/u/.ccrc/history/db/history.db' },
      { rel: 'journal/x/2026-10.0a1b2c3d.jsonl', kind: 'file', mode: 0o100644, shown: '/home/u/.ccrc/history/journal/x/2026-10.0a1b2c3d.jsonl' },
      { rel: 'spool/demo.jsonl', kind: 'file', mode: 0o100644, shown: '/home/u/.ccrc/history/spool/demo.jsonl' },
    ])).toEqual([
      { path: '/data/history-db', want: '0700', got: '0755' },
      { path: '/home/u/.ccrc/history/journal/x/2026-10.0a1b2c3d.jsonl', want: '0600', got: '0644' },
    ]);
  });
  it('capBytes (Task 6) is GB × 2^30, the one conversion cap-near and at-cap share', () => {
    expect(healthLib.capBytes(50)).toBe(50 * 2 ** 30);
  });

  // ── journal-unwritable by its consequence: cli.mjs measures, this decides ──
  it('journalHeldTooLong: a sidecar unjournaled for longer than TICK_STALE_MS is a hold; none, or a younger one, is not', () => {
    expect(healthLib.journalHeldTooLong(null, NOW)).toBe(false);
    expect(healthLib.journalHeldTooLong(NOW - healthLib.TICK_STALE_MS, NOW)).toBe(false);
    expect(healthLib.journalHeldTooLong(NOW - healthLib.TICK_STALE_MS - 1, NOW)).toBe(true);
  });
});

describe('decideDrainFailure (D-4346, history-permanent-failures-classified)', () => {
  const TABLE: Array<['defer' | 'reject' | 'fail', unknown[]]> = [
    ['defer', [5, 261, 517, 773, 6, 262, 518]],
    ['reject', [18, 19, 20, 275, 1299, 1555, 2067, 2579, 3091]],
    ['fail', [1811, 787, 531, 1043, 2323, 2835, 13, 11, 266, 1034, 26, 8, 1, 14, 7, 17, undefined, null, '5', 5.5]],
  ];
  it.each(TABLE.flatMap(([arm, codes]) => codes.map((c) => [arm, c] as const)))('%s: %s', (arm, code) => {
    expect(healthLib.decideDrainFailure(code)).toBe(arm);
    expect(healthLib.DRAIN_FAILURE_ARMS).toContain(healthLib.decideDrainFailure(code));
  });
  it('SQLITE_CODES is frozen, and DRAIN_FAILURE_ARMS is the three answers', () => {
    expect(Object.isFrozen(healthLib.SQLITE_CODES)).toBe(true);
    expect([...healthLib.DRAIN_FAILURE_ARMS]).toEqual(['defer', 'reject', 'fail']);
  });
});

describe('blobOverDecodeCap (D-4346, history-permanent-failures-classified)', () => {
  it('BLOB_DECODE_MAX is LINE_MAX; a size at it is decodable, one past it is not, and a non-number refuses', () => {
    expect(healthLib.BLOB_DECODE_MAX).toBe(healthLib.LINE_MAX);
    expect(healthLib.blobOverDecodeCap(healthLib.LINE_MAX)).toBe(false);
    expect(healthLib.blobOverDecodeCap(healthLib.LINE_MAX + 1)).toBe(true);
    expect(healthLib.blobOverDecodeCap(0)).toBe(false);
    for (const v of [undefined, null, '5']) expect(healthLib.blobOverDecodeCap(v), String(v)).toBe(true);
  });
});
