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
import * as libScope from '../../ccd/history/lib.mjs';
import * as libSearch from '../../ccd/history/lib.mjs';
import { DatabaseSync as FtsDb } from 'node:sqlite';
import * as libOut from '../../ccd/history/lib.mjs';
import * as libOps from '../../ccd/history/lib.mjs';
import * as libReplay from '../../ccd/history/lib.mjs';
import * as replayStore from '../../ccd/history/store.mjs';
import { DatabaseSync as ReplaySqlite } from 'node:sqlite';
import * as libGrep from '../../ccd/history/lib.mjs';
import { randomBytes as libGrepRandom } from 'node:crypto';
import { spawnSync as libGrepSpawn } from 'node:child_process';
import * as libDescribe from '../../ccd/history/lib.mjs';
import * as t16lib from '../../ccd/history/lib.mjs';
import * as t16crypto from 'node:crypto';
import * as t16f from '../../ccd/history/lib.mjs';
import * as t17lib from '../../ccd/history/lib.mjs';
import * as t17sqlite from 'node:sqlite';
import * as t17fs from 'node:fs';
import * as t17path from 'node:path';
import * as t19lib from '../../ccd/history/lib.mjs';

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
    // W1-B2 Task 8: node derivation, L4. sweep.mjs imports it, so it imports nothing of the sweep or the CLI back (§6.4).
    'derive.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' || s === './sweep.mjs' || s === './cli.mjs' },
    'recall.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' || s === './sweep.mjs' || s === './cli.mjs' },
    'regex-worker.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' || s === './sweep.mjs' || s === './cli.mjs' || s === './recall.mjs' },
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

  /** What each module may take from ../compact-card.mjs, exactly, one entry per import or export-from form; a module not named
   *  here may take nothing. W1-B2 Task 8: derive.mjs takes the card's heading rules and token miner and injects them into lib (§6.4). */
  const CARD_FORMS: Record<string, readonly string[]> = {
    'sweep.mjs': ['{ isBoundaryLine }'],
    'derive.mjs': ['{ HEADING_RE, fencedRanges, mineTokens }'],
  };

  it('only L4 imports ../compact-card.mjs, and only the forms CARD_FORMS names', () => {
    let seen = 0;
    for (const m of Object.keys(RINGS)) {
      const src = readFileSync(join(HIST, m), 'utf8');
      if (!specsOf(src).includes('../compact-card.mjs')) continue;
      seen += 1;
      expect(RINGS[m]!.ring, m).toBe('L4');
      const imports = compactCardForms(src);
      expect(imports.length, `${m}: the import form was not read`).toBeGreaterThan(0);
      expect(imports, m).toEqual(CARD_FORMS[m] ?? []);
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
    journalGrowth30d: 0, journalSkipped: 0, blobUndecodable: 0, drainRejected: 0, spoolDisplaced: 0, spoolBlocked: 0, spoolUnreadable: 0, spoolNotDirectory: false, spoolNodesRefused: 0, exportSegmentNewer: [], exportSegmentMissing: 0,
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

  it('spool-planted names the nodes at spool/<id>.jsonl that are not regular files on its own, with its own remedy (FR2c, F3; D-4418)', () => {
    const i = healthLib.deriveHealth(base({ spoolNodesRefused: 2 })).warn.find((x) => x.word === 'spool-planted');
    expect(i?.detail).toContain('2 node(s) at spool/<id>.jsonl are not regular files (a FIFO, a link, a directory or any other non-regular node), so the hook spools no line for that id while one stands');
    expect(i?.detail, 'the counted clauses are left out when their counts are 0').not.toContain('skipped drain(s)');
    expect(i?.remedy).toContain('any FIFO, link, directory or other non-regular node that stands at ~/.ccrc/history/spool/<id>.jsonl (that id spools again once it is gone)');
  });

  it('spoolFileIdOf is the spool name grammar: <id>.jsonl with an id idOk passes, no dot-name (FR2c)', () => {
    expect(healthLib.spoolFileIdOf('claude-a-demo.jsonl')).toBe('claude-a-demo');
    expect(healthLib.spoolFileIdOf('a.b.c.jsonl')).toBe('a.b.c');
    for (const n of ['.hidden.jsonl', 'claude-a-demo.jsonl.tmp', 'not an id.jsonl', '..jsonl', `${'a'.repeat(225)}.jsonl`, '.draining']) {
      expect(healthLib.spoolFileIdOf(n), n).toBeNull();
    }
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

describe('phraseValues: the same-tick phrase path searches `fresh` only while a re-derivation generation is open (D-4344, FR2b; review 344 F2)', () => {
  const values = ['loaded-a', 'loaded-b'];
  const fresh = ['loaded-b'];
  const MARK = 4;
  const ROWS: Array<[string, number, string | undefined, string[]]> = [
    ['no state: every loaded value', MARK, undefined, values],
    ['a closed generation (target equals the mark): every loaded value', MARK, `${MARK} 0 9`, values],
    ['an open generation (target above the mark): only the fresh values', MARK, `${MARK + 1} 0 9`, fresh],
  ];
  it.each(ROWS)('%s', (_name, mark, text, want) => {
    const state = healthLib.parseRederiveState(text);
    expect(healthLib.phraseValues(mark, state, values, fresh)).toBe(want);
  });
});

// ===========================================================================
// W1-B2 Task 1: identity, scope and ids (spec §8.2, §6.1, §6.9, §6.10, §8.6,
// §9.7), in-process on lib.mjs alone. C50 is owned here; the CLI halves of
// C3, C4, C5, C29, C39, C46-C48, C53, C54, C66-C68 are Tasks 10-16's.
// ===========================================================================
describe('decideIdentity: the id comes from tmux, with -t, and must be cc-<id> (spec 8.2)', () => {
  const ran = (stdout: string, o: Partial<libScope.TmuxRead> = {}): libScope.TmuxRead => ({ settled: true, status: 0, stdout, ...o });
  it('a cc- session name is stripped to its id, the trailing newline dropped', () => {
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('cc-claude-a-demo\n') })).toEqual({ ok: true, id: 'claude-a-demo' });
    expect(libScope.decideIdentity({ pane: '%12', tmux: ran('cc-a.b.c') })).toEqual({ ok: true, id: 'a.b.c' });
  });
  it('no pane, a pane that is not %<n>, or a tmux run that never settled or failed is no-identity', () => {
    const noId = { ok: false, rc: 2, reason: 'no-identity' };
    expect(libScope.decideIdentity({ pane: null, tmux: null })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '%x', tmux: ran('cc-a') })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '3', tmux: ran('cc-a') })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: null })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('', { settled: false, status: null }) })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('cc-a\n', { status: 1 }) })).toEqual(noId);
  });
  it('a session not named cc-<something> is no-identity, never the most recent session', () => {
    const noId = { ok: false, rc: 2, reason: 'no-identity' };
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('main\n') })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('cc-\n') })).toEqual(noId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('xcc-a\n') })).toEqual(noId);
  });
  it('a stripped id outside the id grammar is bad-id, before any path is formed (C66 pure half)', () => {
    const badId = { ok: false, rc: 2, reason: 'bad-id' };
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('cc-..\n') })).toEqual(badId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran('cc-a/b\n') })).toEqual(badId);
    expect(libScope.decideIdentity({ pane: '%3', tmux: ran(`cc-${'x'.repeat(libScope.SPOOL_ID_MAX + 1)}\n`) })).toEqual(badId);
  });
});

describe('resolveGeneration and decideHarness (spec 8.2, 6.10)', () => {
  const G = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-ba9876543210';
  it("the env generation wins when it has the uuid grammar; else the registry's; else the id's newest family", () => {
    expect(libScope.resolveGeneration({ envGen: G, regGen: { state: 'value', value: G2 } })).toEqual({ value: G, via: 'env' });
    expect(libScope.resolveGeneration({ envGen: null, regGen: { state: 'value', value: `${G2}\n` } })).toEqual({ value: G2, via: 'registry' });
    expect(libScope.resolveGeneration({ envGen: 'not-a-uuid', regGen: { state: 'value', value: G2 } })).toEqual({ value: G2, via: 'registry' });
    for (const regGen of [{ state: 'absent' }, { state: 'unreadable' }, { state: 'value', value: 'garbled' }] as const) {
      expect(libScope.resolveGeneration({ envGen: null, regGen })).toEqual({ value: null, via: 'newest' });
    }
  });
  it('an absent harness is claude-code, the one HARNESS_TABLE row; a listed value reads', () => {
    expect(libScope.decideHarness({ state: 'absent' })).toEqual({ ok: true, harness: 'claude-code' });
    expect(libScope.decideHarness({ state: 'value', value: 'claude-code\n' })).toEqual({ ok: true, harness: 'claude-code' });
  });
  it('a harness with no table row is harness-unsupported, and an unreadable one harness-unreadable (C54, C67 pure halves)', () => {
    expect(libScope.decideHarness({ state: 'value', value: 'codex' })).toEqual({ ok: false, rc: 2, reason: 'harness-unsupported' });
    expect(libScope.decideHarness({ state: 'value', value: '' })).toEqual({ ok: false, rc: 2, reason: 'harness-unsupported' });
    expect(libScope.decideHarness({ state: 'unreadable' })).toEqual({ ok: false, rc: 2, reason: 'harness-unreadable' });
  });
});

describe('decideScope: the scope source is data, and every widening is decided once (spec 8.2, 6.9; C50)', () => {
  const G = '0189abcd-1234-4678-9abc-0123456789ab';
  const v = (value: string): libScope.Presence<string> => ({ state: 'value', value });
  const unreadable: libScope.Presence<string> = { state: 'unreadable' };
  const absent: libScope.Presence<string> = { state: 'absent' };
  const base = (o: Partial<libScope.ScopeInputs> = {}): libScope.ScopeInputs => ({
    source: 'tmux', id: 'claude-a-demo', generation: { value: G, via: 'env' },
    flags: { project: false, workspace: false, session: null },
    reg: { project: v('demo'), workdir: v('/home/u/tree/demo'), sessionProject: null },
    ...o,
  });
  /** One row per verdict the CLI must reproduce: the C50 table. */
  const TABLE: ReadonlyArray<readonly [string, libScope.ScopeInputs, unknown]> = [
    ['family by default', base(), { ok: true, kind: 'family', source: 'tmux', id: 'claude-a-demo', generation: G, project: 'demo', workdir: null }],
    ['family, newest generation', base({ generation: { value: null, via: 'newest' } }),
      { ok: true, kind: 'family', source: 'tmux', id: 'claude-a-demo', generation: null, project: 'demo', workdir: null }],
    ['--project', base({ flags: { project: true, workspace: false, session: null } }),
      { ok: true, kind: 'project', source: 'tmux', id: 'claude-a-demo', generation: G, project: 'demo', workdir: null }],
    ['--workspace', base({ flags: { project: false, workspace: true, session: null } }),
      { ok: true, kind: 'workspace', source: 'tmux', id: 'claude-a-demo', generation: G, project: 'demo', workdir: '/home/u/tree/demo' }],
    ['--session, same project', base({ flags: { project: false, workspace: false, session: 'claude-b-demo' }, reg: { project: v('demo'), workdir: v('/w'), sessionProject: v('demo\n') } }),
      { ok: true, kind: 'family', source: 'tmux', id: 'claude-b-demo', generation: null, project: 'demo', workdir: null }],
    ['--session, another project (C5)', base({ flags: { project: false, workspace: false, session: 'claude-b-other' }, reg: { project: v('demo'), workdir: v('/w'), sessionProject: v('other') } }),
      { ok: false, rc: 2, reason: 'cross-project' }],
    ['--session ..', base({ flags: { project: false, workspace: false, session: '..' } }), { ok: false, rc: 2, reason: 'bad-id' }],
    ['--session with its project unreadable', base({ flags: { project: false, workspace: false, session: 'claude-b-demo' }, reg: { project: v('demo'), workdir: v('/w'), sessionProject: unreadable } }),
      { ok: false, rc: 2, reason: 'project-unreadable' }],
    ['--session with this project unreadable', base({ flags: { project: false, workspace: false, session: 'claude-b-demo' }, reg: { project: unreadable, workdir: v('/w'), sessionProject: v('demo') } }),
      { ok: false, rc: 2, reason: 'project-unreadable' }],
    ['--session whose project file is absent (C5, IV5: never project-unreadable)', base({ flags: { project: false, workspace: false, session: 'claude-b-gone' }, reg: { project: v('demo'), workdir: v('/w'), sessionProject: absent } }),
      { ok: false, rc: 2, reason: 'cross-project' }],
    ['--session with this project absent (C5)', base({ flags: { project: false, workspace: false, session: 'claude-b-demo' }, reg: { project: absent, workdir: v('/w'), sessionProject: v('demo') } }),
      { ok: false, rc: 2, reason: 'cross-project' }],
    ['--project with the project absent: refused like unreadable, a deliberate fold', base({ flags: { project: true, workspace: false, session: null }, reg: { project: absent, workdir: v('/w'), sessionProject: null } }),
      { ok: false, rc: 2, reason: 'project-unreadable' }],
    ['--project and --workspace together', base({ flags: { project: true, workspace: true, session: null } }), { ok: false, rc: 2, reason: 'bad-args' }],
    ['--project and --session together', base({ flags: { project: true, workspace: false, session: 'claude-b-demo' } }), { ok: false, rc: 2, reason: 'bad-args' }],
    ['--project with the project unreadable (C39)', base({ flags: { project: true, workspace: false, session: null }, reg: { project: unreadable, workdir: v('/w'), sessionProject: null } }),
      { ok: false, rc: 2, reason: 'project-unreadable' }],
    ['--workspace with the workdir unreadable (C53)', base({ flags: { project: false, workspace: true, session: null }, reg: { project: v('demo'), workdir: unreadable, sessionProject: null } }),
      { ok: false, rc: 2, reason: 'workspace-unreadable' }],
    ['--workspace with the project unreadable', base({ flags: { project: false, workspace: true, session: null }, reg: { project: unreadable, workdir: v('/w'), sessionProject: null } }),
      { ok: false, rc: 2, reason: 'workspace-unreadable' }],
    ['an id outside the grammar', base({ id: '../x' }), { ok: false, rc: 2, reason: 'bad-id' }],
  ];
  it.each(TABLE)('%s', (_name, input, want) => {
    expect(libScope.decideScope(input)).toEqual(want);
  });
  it('C50: every SCOPE_SOURCES member answers the same table, and a source outside it is refused, never defaulted', () => {
    expect(libScope.SCOPE_SOURCES.length, 'SCOPE_SOURCES is empty').toBeGreaterThan(0);
    for (const source of libScope.SCOPE_SOURCES) {
      for (const [name, input, want] of TABLE) {
        const got = libScope.decideScope({ ...input, source });
        expect(got, `${source}: ${name}`).toEqual(typeof want === 'object' && want !== null && (want as { ok: boolean }).ok ? { ...(want as object), source } : want);
      }
    }
    for (const source of ['env', 'x', '', 'TMUX'].filter((s) => !(libScope.SCOPE_SOURCES as readonly string[]).includes(s))) {
      for (const [name, input] of TABLE) {
        expect(libScope.decideScope({ ...input, source }), `${source}: ${name}`).toEqual({ ok: false, rc: 2, reason: 'no-identity' });
      }
    }
  });
});

describe('display prefixes and in-scope id resolution (spec 6.1, 8.2 RV19)', () => {
  const A = 'L03a9c000000000000001';
  const B = 'L03a9c000000000000002';
  const C = 'L7e0c1d2e3f40516273a8';
  const P = 'N7c1e2a0b1c2d3e4f5a6b';
  it('ids are L or N plus 20 hex', () => {
    for (const id of [A, B, C, P]) expect(libScope.HISTORY_NODE_ID_RE.test(id), id).toBe(true);
    expect(libScope.HISTORY_NODE_ID_RE.test('L03a9c')).toBe(false);
  });
  it('the prefix is the shortest unique one within the set, never under the letter plus 6 hex', () => {
    const p = libScope.displayPrefixes([A, B, C, P]);
    expect(p.get(C)).toBe('L7e0c1d');
    expect(p.get(P)).toBe('N7c1e2a');
    expect(p.get(A)).toBe('L03a9c000000000000001');
    expect(p.get(B)).toBe('L03a9c000000000000002');
    expect(libScope.displayPrefixes([C]).get(C)).toBe('L7e0c1d');
    expect(libScope.NODE_ID_DISPLAY_MIN).toBe(6);
  });
  it('one in-scope match wins even when an out-of-scope id shares the prefix', () => {
    expect(libScope.resolveScopedId({ wanted: 'L7e0c1d', inScope: [C], outOfScope: ['L7e0c1dffffffffffffff'] })).toEqual({ kind: 'ok', id: C });
  });
  it('no in-scope match but an out-of-scope one is out-of-scope, never not-found (C29 pure half)', () => {
    expect(libScope.resolveScopedId({ wanted: 'L7e0c1d', inScope: [A], outOfScope: [C] })).toEqual({ kind: 'out-of-scope' });
    expect(libScope.resolveScopedId({ wanted: 'L7e0c1d', inScope: [A], outOfScope: [] })).toEqual({ kind: 'not-found' });
  });
  it('several in-scope matches are ambiguous, naming them; a malformed id is bad', () => {
    expect(libScope.resolveScopedId({ wanted: 'L03a9c0', inScope: [B, A], outOfScope: [] })).toEqual({ kind: 'ambiguous', candidates: [A, B] });
    expect(libScope.resolveScopedId({ wanted: 'L03a9c', inScope: [A], outOfScope: [] })).toEqual({ kind: 'bad' });
    expect(libScope.resolveScopedId({ wanted: 'X03a9c0', inScope: [A], outOfScope: [] })).toEqual({ kind: 'bad' });
  });
});

describe('extractNodeId: a bare id or one pasted card line (spec 8.4 describe, 8.6; P28)', () => {
  const CARD = 'History: node L03a9c0… (this compaction) · parent N7c1e2a… · ~/.local/bin/ccrc history describe L03a9c0';
  it('a bare id or display prefix passes, the card ellipsis tolerated', () => {
    expect(libScope.extractNodeId('L03a9c000000000000001')).toEqual({ ok: true, id: 'L03a9c000000000000001' });
    expect(libScope.extractNodeId('  N7c1e2a  ')).toEqual({ ok: true, id: 'N7c1e2a' });
    expect(libScope.extractNodeId('L03a9c0…')).toEqual({ ok: true, id: 'L03a9c0' });
  });
  it("a card line's structural id is the one after 'History: node ', though it names three", () => {
    expect(libScope.extractNodeId(CARD)).toEqual({ ok: true, id: 'L03a9c0' });
    expect(libScope.extractNodeId(`${CARD}\nand some trailing text`)).toEqual({ ok: true, id: 'L03a9c0' });
    expect(libScope.extractNodeId('History: node L03a9c0… (this compaction) · ~/.local/bin/ccrc history describe L03a9c0')).toEqual({ ok: true, id: 'L03a9c0' });
  });
  it('free text with several distinct ids is refused, not guessed', () => {
    const r = libScope.extractNodeId('compare L03a9c0 with L7e0c1d please');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining('several node ids') });
  });
  it('one id inside prose is refused with a hint naming the bare id', () => {
    expect(libScope.extractNodeId('look at L03a9c0 again')).toEqual({
      ok: false, error: 'not a node id or a card line: look at L03a9c0 again',
      hint: 'give the bare id (L03a9c0) or paste the whole History: line',
    });
  });
  it('an uppercase, an all-zero, a too-short or a missing id is refused', () => {
    expect(libScope.extractNodeId('L03A9C0')).toMatchObject({ ok: false, error: expect.stringContaining('malformed node id') });
    expect(libScope.extractNodeId('L000000')).toMatchObject({ ok: false, error: expect.stringContaining('all zeros') });
    expect(libScope.extractNodeId('L03a9')).toMatchObject({ ok: false, error: 'not a node id: L03a9' });
    expect(libScope.extractNodeId('')).toMatchObject({ ok: false });
  });
});

describe('recall-off: the path is formed only from a checked id, and the file names one family (spec 9.7)', () => {
  const G = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-ba9876543210';
  it('the path sits under the history root, spelled once', () => {
    expect(libScope.recallOffPath('/home/u', 'claude-a-demo')).toBe('/home/u/.ccrc/history/recall-off/claude-a-demo');
    expect(libScope.RECALL_OFF_DIR).toBe('recall-off');
  });
  it('an id outside the grammar never becomes a path (C66 pure half)', () => {
    for (const id of ['..', '.', '../x', 'a/b', '', 'x'.repeat(libScope.SPOOL_ID_MAX + 1)]) {
      expect(() => libScope.recallOffPath('/home/u', id), JSON.stringify(id)).toThrow(TypeError);
    }
  });
  it('content equal to the resolved generation is off; another generation is stale; absent is none', () => {
    expect(libScope.decideRecallOff({ file: { state: 'value', value: `${G}\n` }, generation: G })).toBe('off');
    expect(libScope.decideRecallOff({ file: { state: 'value', value: '' }, generation: '' })).toBe('off');
    expect(libScope.decideRecallOff({ file: { state: 'value', value: G2 }, generation: G })).toBe('stale');
    expect(libScope.decideRecallOff({ file: { state: 'value', value: '' }, generation: G })).toBe('stale');
    // Why the caller passes the RESOLVED family's generation (R-recalloff): an unresolved `''`
    // against a file holding G answers stale, so recall would run for an id whose arm is off.
    expect(libScope.decideRecallOff({ file: { state: 'value', value: G }, generation: '' })).toBe('stale');
    expect(libScope.decideRecallOff({ file: { state: 'absent' }, generation: G })).toBe('none');
  });
  it('an unreadable file holds the arm (off), never silently recalls', () => {
    expect(libScope.decideRecallOff({ file: { state: 'unreadable' }, generation: G })).toBe('off');
  });
});

// ===========================================================================
// W1-B2 Task 2: search primitives (spec §8.4 grep, §11 V2, P1, P8, P9, P10).
// C6 is owned here. The FTS semantics are proved against a real in-memory
// FTS5 table with the store's own blobs_fts definition, opened by this test
// file (lib.mjs never imports node:sqlite).
// ===========================================================================
/** The store's blobs_fts definition (store.mjs FTS_DDL), on an in-memory DB. */
const ftsCorpus = (docs: ReadonlyArray<readonly [number, string]>): FtsDb => {
  const db = new FtsDb(':memory:');
  db.exec("CREATE VIRTUAL TABLE blobs_fts USING fts5(body, content='', contentless_delete=1, tokenize='porter unicode61')");
  const ins = db.prepare('INSERT INTO blobs_fts(rowid, body) VALUES (?, ?)');
  for (const [id, body] of docs) ins.run(id, body);
  return db;
};
const matchIds = (db: FtsDb, q: string): number[] =>
  db.prepare('SELECT rowid AS id FROM blobs_fts WHERE blobs_fts MATCH ? ORDER BY rowid').all(q).map((r) => Number(r['id']));

describe('sanitizeFtsQuery: every token quoted, AND semantics, a trailing star outside the quotes (spec 8.4; C6)', () => {
  // The upstream suite's seventeen behaviours, re-derived with ccrc's own inputs (spec §12: not copied). One
  // behaviour changes on purpose: a token ending in `*` keeps its star OUTSIDE the quotes (row 6).
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['1 quotes each plain token', 'grep history', '"grep" "history"'],
    ['2 keeps a hyphen inside its token', 'store-unbound refusal', '"store-unbound" "refusal"'],
    ['3 neutralises a boolean operator', 'drain OR ingest', '"drain" "OR" "ingest"'],
    ['4 strips a stray double quote', 'spool "drain"', '"spool" "drain"'],
    ['5 neutralises a column filter', 'body:secret value', '"body:secret" "value"'],
    ['6 moves a trailing star outside the quotes (ccrc change)', 'sweep*', '"sweep"*'],
    ['7 answers the empty phrase for an empty query', '', '""'],
    ['8 answers the empty phrase for whitespace only', ' \t\n ', '""'],
    ['9 quotes a single token', 'recall', '"recall"'],
    ['10 collapses runs of whitespace', 'x    y  z', '"x" "y" "z"'],
    ['11 neutralises NOT', 'NOT spool', '"NOT" "spool"'],
    ['12 neutralises NEAR(', 'NEAR(drain spool)', '"NEAR(drain" "spool)"'],
    ['13 neutralises a leading caret', '^anchor', '"^anchor"'],
    ['14 keeps a quoted phrase whole', '"journal replay" order', '"journal replay" "order"'],
    ['15 keeps several quoted phrases', '"store id" AND "writer token"', '"store id" "AND" "writer token"'],
    ['16 mixes phrases and plain tokens', 'find "redaction pair" in blob', '"find" "redaction pair" "in" "blob"'],
    ['17 answers the empty phrase for an empty quoted phrase', '""', '""'],
  ];
  it.each(CASES)('%s', (_name, raw, want) => {
    expect(libSearch.sanitizeFtsQuery(raw)).toBe(want);
  });
  it('a SHA prefix, bare or quoted, becomes a prefix query; a star mid-token or alone stays literal', () => {
    expect(libSearch.sanitizeFtsQuery('a0860d1f*')).toBe('"a0860d1f"*');
    expect(libSearch.sanitizeFtsQuery('"a0860d1f"*')).toBe('"a0860d1f"*');
    expect(libSearch.sanitizeFtsQuery('"error handl*" retry')).toBe('"error handl"* "retry"');
    expect(libSearch.sanitizeFtsQuery('sweep** x')).toBe('"sweep"* "x"');
    expect(libSearch.sanitizeFtsQuery('a*b')).toBe('"a*b"');
    expect(libSearch.sanitizeFtsQuery('*')).toBe('"*"');
  });
  it('on the store\'s FTS5 definition: the SHA prefix finds the SHA, terms AND, and no input is a syntax error', () => {
    const db = ftsCorpus([[1, 'commit a0860d1f2c3b landed'], [2, 'drain spool ok'], [3, 'drain only'], [4, 'running fast'], [5, 'NEAR the end']]);
    expect(matchIds(db, libSearch.sanitizeFtsQuery('a0860d1f*'))).toEqual([1]);
    expect(matchIds(db, '"a0860d1f*"'), 'upstream kept the star inside the quotes, which finds nothing').toEqual([]);
    expect(matchIds(db, libSearch.sanitizeFtsQuery('drain spool'))).toEqual([2]);
    expect(matchIds(db, libSearch.sanitizeFtsQuery('drain'))).toEqual([2, 3]);
    for (const raw of ['', '""', 'NEAR(a b)', 'x OR', 'body:secret', '"unclosed', '^start', 'a*b', '*', '-v', '(paren']) {
      expect(() => matchIds(db, libSearch.sanitizeFtsQuery(raw)), raw).not.toThrow();
    }
    expect(matchIds(db, '"run"*'), 'porter stems the index: a prefix inside the stem finds it').toEqual([4]);
    expect(matchIds(db, '"runn"*'), 'and a prefix past the stem misses it: the skill teaches hex prefixes').toEqual([]);
  });
});

describe('regexSyntaxIn and its hint: regex syntax in plain grep is refused without querying (spec 8.4; V2)', () => {
  it.each([
    ['a|b', 'alternation'], ['fo.*bar', 'wildcard'], ['x.+', 'wildcard'], ['foo[0-9]', 'character class'],
    ['^start', 'anchor'], ['end$', 'anchor'], ['two ^words', 'anchor'], ['x \\d', 'regex character escape'],
  ])('%s is %s', (pattern, syntax) => {
    expect(libSearch.regexSyntaxIn(pattern)).toBe(syntax);
  });
  it.each(['a0860d1f*', '"a|b"', 'server/src/io.ts', 'arr[]', '$HOME', 'a^b', '"^x"', `D-${12}`, '#123', 'foo.bar', 'x.y.z', 'cost$5'])(
    '%s is not regex syntax', (pattern) => {
      expect(libSearch.regexSyntaxIn(pattern)).toBeNull();
    });
  it('the hint names --regex and the rewrite', () => {
    expect(libSearch.regexSyntaxHint('a|b', 'alternation'))
      .toBe('hint: grep searches words, not a regex (alternation): use --regex for `a|b`, or rewrite it as 1-3 literal terms or one quoted phrase');
  });
});

describe('guardRegex: a discriminated refusal, never a silent no-match (spec 8.4; P10, C8a pure half)', () => {
  it('refuses (.*a){8}$, which upstream admits, as nested; and every catastrophic shape with it', () => {
    for (const p of ['(.*a){8}$', '(a+)+', '(a|aa)+', '(\\d+\\.)+', '(?:x*y){2,}', '((ab)*c){3}', '(?<n>a+)+$', '(a?){25}', '((a|b)c)*']) {
      expect(libSearch.guardRegex(p), p).toEqual({ ok: false, why: 'nested' });
    }
  });
  it('admits fixed-shape repeats, optional groups, unrepeated alternation and escaped parentheses', () => {
    for (const p of ['gho_[A-Za-z0-9]{36}', '(abc){2}', '(foo)?bar', 'error: (timeout|refused)', '(?:abc)+', 'a{2,5}', '\\(x*\\){3}', '[(]a*[)]+', 'x{,3}']) {
      expect(libSearch.guardRegex(p), p).toEqual({ ok: true, source: p });
    }
  });
  it('a pattern past REGEX_MAX_LEN is too-long, one that does not compile invalid', () => {
    expect(libSearch.REGEX_MAX_LEN).toBe(500);
    expect(libSearch.guardRegex('a'.repeat(500))).toEqual({ ok: true, source: 'a'.repeat(500) });
    expect(libSearch.guardRegex('a'.repeat(501))).toEqual({ ok: false, why: 'too-long' });
    for (const p of ['(', '[', '*a', 'a{2,1}', '(?<x', 'a)']) expect(libSearch.guardRegex(p), p).toEqual({ ok: false, why: 'invalid' });
    expect(libSearch.guardRegex(7 as unknown as string)).toEqual({ ok: false, why: 'invalid' });
  });
  it('the worker budget is 5 s', () => {
    expect(libSearch.REGEX_BUDGET_MS).toBe(5000);
  });
});

describe('regexPrefilter: only a whole-word literal, so the FTS prefilter never drops a hit (spec 8.4)', () => {
  it.each([
    ['^deploy\\.sh', '"deploy"'], [' gho_[A-Za-z0-9]+', '"gho"'], ['error: timeout ', '"timeout"'],
    ['^alpha betagamma$', '"betagamma"'], ['^run\\s', '"run"'], ['(foo) bar ', '"bar"'],
  ])('%s prefilters on %s', (pattern, want) => {
    expect(libSearch.regexPrefilter(pattern)).toBe(want);
  });
  it.each(['^runn', '\\bfoo\\b', 'foo|bar', '^ab$', '^fooo?$', '(foo) bar', 'plain words', '^caf. ', '^[a-z]+ '])(
    '%s gives no prefilter: a full scan of the scope', (pattern) => {
      expect(libSearch.regexPrefilter(pattern)).toBeNull();
    });
  it('on the store\'s FTS5 definition, the prefilter finds every text the pattern matches', () => {
    const docs: ReadonlyArray<readonly [number, string]> = [
      [1, 'deploy.sh ran clean'], [2, 'redeploy.sh ran'], [3, 'deploy.sh: exit 2'], [4, 'token gho_ABCDEF12 seen'],
      [5, 'error: timeout after 5s'], [6, 'error: timeouts'], [7, 'running fast'], [8, 'unrelated'],
    ];
    const db = ftsCorpus(docs);
    for (const pattern of ['^deploy\\.sh', ' gho_[A-Za-z0-9]+', 'error: timeout ']) {
      const re = new RegExp(pattern);
      const truth = docs.filter(([, body]) => re.test(body)).map(([id]) => id);
      const pre = libSearch.regexPrefilter(pattern);
      expect(pre, pattern).not.toBeNull();
      const found = matchIds(db, pre as string);
      for (const id of truth) expect(found, `${pattern}: the prefilter dropped doc ${id}`).toContain(id);
    }
    expect(new RegExp('^runn').test('running fast')).toBe(true);
    expect(matchIds(db, '"runn"*'), 'why a prefix never prefilters: porter stems it out of reach').toEqual([]);
  });
  it('treats a named backreference as a non-literal atom, so its group name cannot drop a real hit', () => {
    const docs: ReadonlyArray<readonly [number, string]> = [[1, 'bazbaz '], [2, 'unrelated']];
    const pattern = String.raw`(?<foobar>baz)\k<foobar> `;
    const truth = docs.filter(([, body]) => new RegExp(pattern).test(body)).map(([id]) => id);
    const pre = libSearch.regexPrefilter(pattern);

    expect(pre).toBeNull();
    const found = pre === null ? docs.map(([id]) => id) : matchIds(ftsCorpus(docs), pre);
    for (const id of truth) expect(found, `${pattern}: the prefilter dropped doc ${id}`).toContain(id);
  });
});

describe('ftsOrderBy: hybrid over integer ts_ms, NULL last (spec 8.4; P8)', () => {
  const NOW = 1_760_000_000_000;
  const H = 3_600_000;
  it('spells each sort, and refuses an unknown sort or a column that is not a name', () => {
    expect(libSearch.GREP_SORTS).toEqual(['recency', 'relevance', 'hybrid']);
    expect(libSearch.ftsOrderBy('recency', 'e.ts_ms')).toBe('e.ts_ms DESC');
    expect(libSearch.ftsOrderBy('relevance', 'e.ts_ms')).toBe('rank ASC, e.ts_ms DESC');
    expect(libSearch.ftsOrderBy('hybrid', 'e.ts_ms')).toContain('COALESCE(e.ts_ms, 0)');
    expect(libSearch.ftsOrderBy('hybrid', 'e.ts_ms')).not.toContain('julianday');
    expect(() => libSearch.ftsOrderBy('newest', 'e.ts_ms')).toThrow(TypeError);
    for (const bad of ['e.ts_ms; DROP TABLE x', 'ts_ms)', '', '1ts']) expect(() => libSearch.ftsOrderBy('recency', bad), bad).toThrow(TypeError);
  });
  it('on real FTS5: relevance, recency and hybrid order a strong old hit, a weak new one and an undated one differently', () => {
    const db = ftsCorpus([
      [1, 'drain drain drain spool'], [2, 'drain then a long tail of other words about the store and its writer token and journal'],
      [3, 'drain drain drain spool'], ...Array.from({ length: 30 }, (_, k) => [10 + k, `unrelated filler ${k}`] as const),
    ]);
    db.exec('CREATE TABLE e (id INTEGER PRIMARY KEY, ts_ms INTEGER)');
    const ts = db.prepare('INSERT INTO e (id, ts_ms) VALUES (?, ?)');
    ts.run(1, NOW - 2000 * H);
    ts.run(2, NOW - H);
    ts.run(3, null);
    // Only `hybrid` names `:now_ms`, and node:sqlite refuses a named parameter the statement lacks.
    const order = (sort: string): number[] => {
      const sql = `SELECT e.id AS id FROM blobs_fts JOIN e ON e.id = blobs_fts.rowid WHERE blobs_fts MATCH ? ORDER BY ${libSearch.ftsOrderBy(sort, 'e.ts_ms')}`;
      const st = db.prepare(sql);
      const rows = sql.includes(':now_ms') ? st.all({ now_ms: NOW }, '"drain"') : st.all('"drain"');
      return rows.map((r) => Number(r['id']));
    };
    expect(order('relevance')).toEqual([1, 3, 2]);
    expect(order('recency')).toEqual([2, 1, 3]);
    expect(order('hybrid'), 'the old strong hit outranks the new weak one; the undated one sorts last').toEqual([1, 2, 3]);
    expect(db.prepare('SELECT julianday(1760000000000) AS j').get()?.['j'], 'refuted candidate 2: julianday of an integer').toBeNull();
  });
});

describe('queryTerms and snippetWindow: the earliest hit, stems included, from redacted text (spec 8.4; P9)', () => {
  const wellFormed = (s: string): boolean => Buffer.from(s, 'utf8').toString('utf8') === s;
  it('query terms are lowercased words and phrases, edge punctuation and a trailing star stripped, each once', () => {
    expect(libSearch.queryTerms(`"Error handling" --force a0860d1f* D-${12} force`)).toEqual(['error handling', 'force', 'a0860d1f', 'd-12']);
    expect(libSearch.queryTerms('   ')).toEqual([]);
  });
  it('the window holds 24 characters before and 40 after the earliest token hit, with ... at a cut end', () => {
    const text = `${'x'.repeat(100)} Needle ${'y'.repeat(100)}`;
    expect(libSearch.snippetWindow(text, ['needle'])).toBe(`...${'x'.repeat(23)} Needle ${'y'.repeat(39)}...`);
    expect(libSearch.snippetWindow('short Needle here', ['needle'])).toBe('short Needle here');
  });
  it('a stemmed or prefix hit is found by the word without its ending', () => {
    expect(libSearch.snippetWindow(`${'x'.repeat(100)} running fast`, ['runs'])).toBe(`...${'x'.repeat(23)} running fast`);
    expect(libSearch.snippetWindow(`${'z'.repeat(100)} the sweeps ran`, ['sweeping'])).toContain('sweeps');
  });
  it('localizes real FTS hits at a whole candidate, never an earlier containing token', () => {
    const text = `${'a'.repeat(100)} concatenate ${'b'.repeat(100)} cat finishes`;
    const db = ftsCorpus([[1, text]]);

    expect(matchIds(db, '"cat"'), 'real porter FTS: the later standalone cat matches').toContain(1);
    const snippet = libSearch.snippetWindow(text, ['cat']);
    expect(snippet).toContain('cat finishes');
    expect(snippet).not.toContain('concatenate');
  });
  it('localizes a real FTS phrase at its far-offset candidate sequence', () => {
    const text = `${'a'.repeat(100)} errors unrelated ${'b'.repeat(100)} errors handled cleanly`;
    const query = 'error handling';
    const db = ftsCorpus([[1, text]]);

    expect(matchIds(db, `"${query}"`), 'real porter FTS: error handling matches errors handled').toContain(1);
    const snippet = libSearch.snippetWindow(text, libSearch.queryTerms(`"${query}"`));
    expect(snippet).toContain('errors handled');
    expect(snippet).not.toContain('errors unrelated');
  });
  it('locates asymmetric Porter matches and a prefix at the matching candidate, not the unrelated head', () => {
    const studying = `${'a'.repeat(100)} studies are archived`;
    const relate = `${'b'.repeat(100)} relational data follows`;
    const db = ftsCorpus([[1, studying], [2, relate]]);

    expect(matchIds(db, '"studying"'), 'real porter FTS: studying matches studies').toContain(1);
    expect(libSearch.snippetWindow(studying, ['studying'])).toContain('studies');
    expect(matchIds(db, '"relate"'), 'real porter FTS: relate matches relational').toContain(2);
    expect(libSearch.snippetWindow(relate, ['relate'])).toContain('relational');
    expect(libSearch.snippetWindow(`${'c'.repeat(100)} studies are archived`, ['stud*'])).toContain('studies');
  });
  it('no hit gives the first 80 characters', () => {
    expect(libSearch.snippetWindow(`${'a'.repeat(100)}`, ['zzz'])).toBe(`${'a'.repeat(77)}...`);
    expect(libSearch.snippetWindow('  tiny  ', ['zzz'])).toBe('tiny');
  });
  it('a case fold that changes length before the hit does not move the window, and no cut splits a surrogate pair', () => {
    const out = libSearch.snippetWindow(`${'İ'.repeat(30)}Needle tail`, ['needle']);
    expect(out).toContain('Needle');
    for (let pad = 0; pad < 4; pad += 1) {
      const s = libSearch.snippetWindow(`${'😀'.repeat(20)}${'p'.repeat(pad)}needle${'😀'.repeat(30)}`, ['needle']);
      expect(wellFormed(s), `pad ${pad}`).toBe(true);
      expect(s).toContain('needle');
    }
    expect(wellFormed(libSearch.snippetWindow('😀'.repeat(60), ['zzz']))).toBe(true);
  });
});

describe('snippetTerms and unicode61 diacritic comparison: prefix markers survive, comparison folds, source offsets stay (W1-B2 task 12 fix round 1)', () => {
  it('snippetTerms keeps an explicit terminal prefix star the sanitiser would emit, and queryTerms still strips it', () => {
    const raw = 'stud* "error hand"* "x y*" plain D-12* **  ***';
    expect(libSearch.snippetTerms(raw)).toEqual(['stud*', 'error hand*', 'x y*', 'plain', 'D-12*']);
    expect(libSearch.queryTerms(raw)).toEqual(['stud', 'error hand', 'x y', 'plain', 'd-12']);
    expect(libSearch.snippetTerms('   ')).toEqual([]);
    expect(libSearch.snippetTerms('stud stud*')).toEqual(['stud', 'stud*']);
  });
  it('F2 breaker: snippetTerms keeps raw code points (no host case conversion) while queryTerms keeps its legacy lowercase; the prefix star and edge stripping are shared', () => {
    const big = '\u{104b0}';
    const small = '\u{104d8}';
    expect(libSearch.snippetTerms(big), 'raw U+104B0 survives').toEqual([big]);
    expect(libSearch.queryTerms(big), 'legacy display contract: host lowercase').toEqual([small]);
    expect(libSearch.snippetTerms(`${big}* "${big} ${big}"* (${big}) ${big}`)).toEqual([`${big}*`, `${big} ${big}*`, big]);
    expect(libSearch.snippetTerms('Stud STUD* stud')).toEqual(['Stud', 'STUD*', 'stud']);
  });
  it('a star-bearing term localizes a prefix hit far beyond the head, and only the last word of a phrase is the prefix', () => {
    const far = `${'a'.repeat(100)} studies are archived`;
    expect(libSearch.snippetSpan(far, libSearch.snippetTerms('stud*')).at).toBe(far.indexOf('studies'));
    expect(libSearch.snippetSpan(far, libSearch.queryTerms('stud*')).at, 'CONTROL: the stripped term is not a prefix').toBe(-1);
    const phrase = `${'a'.repeat(100)} error handled cleanly`;
    expect(libSearch.snippetSpan(phrase, libSearch.snippetTerms('"error hand"*')).at).toBe(phrase.indexOf('error'));
  });
  it('F1 breaker: a terminal prefix is read on the candidate\'s Porter stem (as FTS5 does), so `runn*` skips an early `running` for the later true `runn`, and `runs*` finds `running`', () => {
    const far = 'z '.repeat(120);
    const early = `running early ${far}runn later`;
    const only = `${far}running only`;
    const db = ftsCorpus([[1, early], [2, only]]);
    expect(matchIds(db, '"runn"*'), 'real porter FTS: `runn*` matches the row holding a literal runn, and not the running-only row').toEqual([1]);
    expect(libSearch.snippetSpan(early, libSearch.snippetTerms('runn*')), 'the later true prefix candidate, never the early `running` (stem run)').toEqual({ at: early.indexOf('runn later'), len: 4 });
    expect(libSearch.snippetSpan(only, libSearch.snippetTerms('runn*')).at, 'a running-only text is no runn* hit').toBe(-1);
  });
  it('F1 breaker inverse: the query prefix is stemmed too, so `runs*` (stem run*) localizes `running`, and only the last phrase token is a prefix', () => {
    const only = `${'z '.repeat(120)}running only`;
    const stemmed = ftsCorpus([[1, only]]);
    expect(matchIds(stemmed, '"runs"*'), 'real porter FTS: `runs*` stems to run* and matches running').toEqual([1]);
    expect(libSearch.snippetSpan(only, libSearch.snippetTerms('runs*')), 'the query prefix is stemmed too').toEqual({ at: only.indexOf('running'), len: 7 });
    // Only the LAST token of a phrase is the prefix; every other token stays an exact Porter-stem equality.
    expect(libSearch.snippetSpan('runn later', libSearch.snippetTerms('"runn lat"*')), 'phrase: runn exact, lat prefix').toEqual({ at: 0, len: 10 });
    expect(libSearch.snippetSpan('running later', libSearch.snippetTerms('"runn lat"*')).at, 'phrase: a non-final token is not a prefix').toBe(-1);
  });
  it('a diacritic compares as FTS5 unicode61 does, precomposed or decomposed, while the span stays in the source offsets', () => {
    for (const word of ['caf\u00e9', 'cafe\u0301', 'CAF\u00c9', 'caf\u00e9s']) {
      const text = `${'a'.repeat(100)} ${word} tail`;
      expect(libSearch.snippetSpan(text, ['cafe']), word).toEqual({ at: text.indexOf(word), len: word.length });
    }
    const accentedQuery = `${'a'.repeat(100)} cafe tail`;
    expect(libSearch.snippetSpan(accentedQuery, ['caf\u00e9']).at, 'the needle folds too').toBe(accentedQuery.indexOf('cafe'));
    const pre = `${'\u00e9'.repeat(30)} cafe`;
    expect(libSearch.snippetSpan(pre, ['cafe']).at, 'folding changes no source offset').toBe(pre.indexOf('cafe'));
    expect(libSearch.snippetSpan(`${'a'.repeat(100)} caf\u00e9 stud\u00efes`, libSearch.snippetTerms('stud*')).at).toBe(`${'a'.repeat(100)} caf\u00e9 `.length);
  });
  it('F2 round 2: default remove_diacritics=1 keeps a precomposed multi-mark code point (U+1ED9) distinct from `o`, while an explicit decomposed `o` + U+0323 + U+0302 and a one-mark U+1ECD fold to `o`', () => {
    const early = `\u1ed9 head ${'a'.repeat(100)} o tail`;
    expect(libSearch.snippetSpan(early, ['o']), 'the later ASCII o, not the early U+1ED9').toEqual({ at: early.indexOf(' o ') + 1, len: 1 });
    const decomposed = `${'a'.repeat(100)} o\u0323\u0302 tail`;
    expect(libSearch.snippetSpan(decomposed, ['o']), 'explicit marks stay individually stripped').toEqual({ at: decomposed.indexOf('o\u0323'), len: 3 });
    const oneMark = `${'a'.repeat(100)} \u1ecd tail`;
    expect(libSearch.snippetSpan(oneMark, ['o']), 'an ordinary one-mark code point still folds').toEqual({ at: oneMark.indexOf('\u1ecd'), len: 1 });
    const self = `${'a'.repeat(100)} \u1ed9 tail`;
    expect(libSearch.snippetSpan(self, ['\u1ed9']), 'the multi-mark query matches itself').toEqual({ at: self.indexOf('\u1ed9'), len: 1 });
    expect(libSearch.snippetSpan(self, ['o']).at, 'and is not an o').toBe(-1);
  });
  it('F2 round 3: unicode61 folds each code point without context, so a final sigma (ΟΣ, ος, ς) compares as `οσ` / `σ` and the span is the source one', () => {
    const lead = 'a'.repeat(100);
    for (const word of ['ΟΣ', 'ος', 'οσ', 'Ος']) {
      const text = `${lead} ${word} tail`;
      expect(libSearch.snippetSpan(text, ['οσ']), `${word} queried as οσ`).toEqual({ at: text.indexOf(word), len: word.length });
      expect(libSearch.snippetSpan(text, [word]), `${word} queried as itself`).toEqual({ at: text.indexOf(word), len: word.length });
    }
    for (const ch of ['Σ', 'ς', 'σ']) {
      const text = `${lead} ${ch} tail`;
      expect(libSearch.snippetSpan(text, ['σ']), `${ch} queried as σ`).toEqual({ at: text.indexOf(ch), len: 1 });
      expect(libSearch.snippetSpan(text, ['ς']), `${ch} queried as ς`).toEqual({ at: text.indexOf(ch), len: 1 });
    }
  });
  it('F2 round 3: only the 25 marks unicode61 drops continue a token and vanish; every other U+0300-U+036F mark is a token boundary (source and needle alike)', () => {
    const lead = 'x'.repeat(100);
    const dropped = `${lead} a\u0301b tail`;
    expect(libSearch.snippetSpan(dropped, ['ab']), 'U+0301 continues and disappears: three code units').toEqual({ at: dropped.indexOf('a\u0301b'), len: 3 });
    expect(libSearch.snippetSpan(dropped, ['a\u0301b']), 'and it disappears from the needle').toEqual({ at: dropped.indexOf('a\u0301b'), len: 3 });
    const boundary = `${lead} a\u0305b tail`;
    expect(libSearch.snippetSpan(boundary, ['ab']).at, 'U+0305 splits the token: no `ab`').toBe(-1);
    expect(libSearch.snippetSpan(boundary, ['a b']), 'it is a boundary: the phrase `a b` is there').toEqual({ at: boundary.indexOf('a\u0305b'), len: 3 });
    expect(libSearch.snippetSpan(boundary, ['b']), 'the second half is its own token').toEqual({ at: boundary.indexOf('b'), len: 1 });
    const spaced = `${lead} a b tail`;
    expect(libSearch.snippetSpan(spaced, ['a\u0305b']), 'a boundary mark in the needle splits it into two tokens').toEqual({ at: spaced.indexOf('a b'), len: 3 });
    expect(libSearch.snippetSpan(`${lead} \u0301 tail`, ['\u0301']).at, 'a needle of removed marks only folds empty and matches nothing').toBe(-1);
    const markOnly = `${lead} pp \u0301 rr tail`;
    expect(libSearch.snippetSpan(markOnly, ['pp rr']), 'a candidate of removed marks only is no token: the phrase reads across it').toEqual({ at: markOnly.indexOf('pp'), len: markOnly.indexOf('rr') + 2 - markOnly.indexOf('pp') });
  });
  /** What runtime SQLite's `unicode61` (the product's `porter unicode61`, default remove_diacritics=1) reads each text as: its terms, in order. */
  const sqliteTermsOf = (texts: string[]): string[][] => {
    const db = new FtsDb(':memory:');
    try {
      db.exec("CREATE VIRTUAL TABLE t USING fts5(b, tokenize='unicode61')");
      db.exec("CREATE VIRTUAL TABLE tv USING fts5vocab(t, 'instance')");
      const ins = db.prepare('INSERT INTO t (rowid, b) VALUES (?, ?)');
      texts.forEach((s, i) => ins.run(i + 1, s));
      const out: string[][] = texts.map(() => []);
      for (const r of db.prepare('SELECT doc, term FROM tv ORDER BY doc, offset').all() as { doc: number; term: string }[]) out[Number(r.doc) - 1]!.push(r.term);
      return out;
    } finally { db.close(); }
  };
  it('F2 round 4: an early dotless \u0131 (U+0131), which unicode61 keeps apart from `i`, never localizes as `i`: the later ASCII `i` is the true hit', () => {
    const far = 'x'.repeat(100);
    expect(sqliteTermsOf(['\u0131', 'i', '\u0130', 'I']), 'runtime SQLite: \u0131 stays itself, \u0130 and I are i').toEqual([['\u0131'], ['i'], ['i'], ['i']]);
    const early = `\u0131 ${far} i tail`;
    expect(libSearch.snippetSpan(early, ['i']), 'the later ASCII i, never offset 0').toEqual({ at: early.indexOf(' i ') + 1, len: 1 });
    const only = `${far} \u0131 tail`;
    expect(libSearch.snippetSpan(only, ['i']).at, 'an isolated \u0131 is not an i').toBe(-1);
    expect(libSearch.snippetSpan(only, ['\u0131']), 'and it matches itself').toEqual({ at: far.length + 1, len: 1 });
    expect(libSearch.snippetSpan(`${far} i tail`, ['\u0131']).at, 'nor is an i an \u0131').toBe(-1);
    expect(libSearch.snippetSpan(`${far} \u0130 tail`, ['i']), '\u0130 does fold to i').toEqual({ at: far.length + 1, len: 1 });
  });
  it('F2 round 4: a supplementary pair the runtime SQLite keeps apart (U+104B0 / U+104D8) localizes at the later true token, with its two-code-unit span; U+10400 / U+10428 is a real supplementary fold', () => {
    const far = 'x'.repeat(100);
    const big = '\u{104b0}';
    const small = '\u{104d8}';
    expect(sqliteTermsOf([big, small, '\u{10400}', '\u{10428}']), 'runtime SQLite first: the pair is two terms, Deseret is one').toEqual([[big], [small], ['\u{10428}'], ['\u{10428}']]);
    const early = `${big} ${far} ${small} tail`;
    expect(libSearch.snippetSpan(early, [small]), 'the later true token, two code units').toEqual({ at: early.indexOf(small), len: 2 });
    expect(libSearch.snippetSpan(early, [big]), 'and the early one is its own').toEqual({ at: 0, len: 2 });
    expect(libSearch.snippetSpan(`${far} ${big} tail`, [small]).at, 'an isolated U+104B0 is not U+104D8').toBe(-1);
    const deseret = `${far} \u{10400} tail`;
    expect(libSearch.snippetSpan(deseret, ['\u{10428}']), 'SQLite folds U+10400 to U+10428').toEqual({ at: far.length + 1, len: 2 });
    expect(libSearch.snippetSpan(`${far} \u{10428} tail`, ['\u{10400}']), 'both ways').toEqual({ at: far.length + 1, len: 2 });
  });
  it('F2 round 4: token membership is unicode61\'s frozen category table, not the host letter/number classes: U+19B0 is a boundary, U+0378 and private use are tokens', () => {
    const lead = 'a'.repeat(100);
    expect(sqliteTermsOf(['p\u19b0q', 'p\u0378q', 'p\ue000q', '\u0378']), 'runtime SQLite first')
      .toEqual([['p', 'q'], ['p\u0378q'], ['p\ue000q'], ['\u0378']]);
    expect(/^[\p{L}\p{N}]$/u.test('\u19b0'), 'CONTROL: this host calls U+19B0 a letter').toBe(true);
    expect(/^[\p{L}\p{N}]$/u.test('\u0378'), 'CONTROL: and U+0378 no letter or number').toBe(false);
    const split = `${lead} p\u19b0q tail`;
    expect(libSearch.snippetSpan(split, ['pq']).at, 'U+19B0 splits the source token').toBe(-1);
    expect(libSearch.snippetSpan(split, ['p q']), 'the phrase `p q` is there').toEqual({ at: split.indexOf('p'), len: 3 });
    expect(libSearch.snippetSpan(split, ['p\u19b0q']), 'and a needle splits the same way').toEqual({ at: split.indexOf('p'), len: 3 });
    expect(libSearch.snippetSpan(split, ['q']), 'the second half is its own token').toEqual({ at: split.indexOf('q'), len: 1 });
    for (const mid of ['\u0378', '\ue000']) {
      const text = `${lead} p${mid}q tail`;
      expect(libSearch.snippetSpan(text, [`p${mid}q`]), `U+${mid.codePointAt(0)!.toString(16)} is a token character: one token, source span`).toEqual({ at: text.indexOf('p'), len: 3 });
      expect(libSearch.snippetSpan(text, ['p q']).at, 'it does not split').toBe(-1);
      expect(libSearch.snippetSpan(text, ['q']).at, 'q is no token of its own').toBe(-1);
      const alone = `${lead} ${mid} tail`;
      expect(libSearch.snippetSpan(alone, [mid]), 'standalone, it localizes with the original span').toEqual({ at: lead.length + 1, len: 1 });
    }
  });
  /** Where runtime SQLite's own `highlight()` puts the first hit of `match` in `text` (the product's `porter unicode61`), in code units. */
  const sqliteSpan = (text: string, match: string): { at: number; len: number } => {
    const db = new FtsDb(':memory:');
    try {
      db.exec("CREATE VIRTUAL TABLE t USING fts5(b, tokenize='porter unicode61')");
      db.prepare('INSERT INTO t (rowid, b) VALUES (1, ?)').run(text);
      const row = db.prepare("SELECT highlight(t, 0, char(2), char(3)) AS h FROM t WHERE t MATCH ?").get(match) as { h: string } | undefined;
      if (row === undefined) return { at: -1, len: 0 };
      const at = row.h.indexOf('\u0002');
      return { at, len: row.h.indexOf('\u0003') - at - 1 };
    } finally { db.close(); }
  };
  it('F2 round 5: a dropped mark only CONTINUES a token a token character opened; a leading or mark-only run of dropped marks is no token, so the span starts where SQLite highlights the hit', () => {
    const one = '\u0301a tail';
    const two = '\u0301\u0300a tail';
    const inner = 'x\u0301a tail';
    const run = '\u0301 pp \u0301\u0300 rr tail';
    // Runtime SQLite first: the hit begins AFTER the leading marks, an internal mark is inside the hit, a mark-only run is skipped.
    expect(sqliteSpan(one, 'a'), 'runtime SQLite: \\u0301a highlights only a').toEqual({ at: 1, len: 1 });
    expect(sqliteSpan(two, 'a'), 'runtime SQLite: \\u0301\\u0300a highlights only a').toEqual({ at: 2, len: 1 });
    expect(sqliteSpan(inner, 'xa'), 'runtime SQLite: x\\u0301a is one hit, its mark inside').toEqual({ at: 0, len: 3 });
    expect(sqliteSpan(run, '"pp rr"'), 'runtime SQLite: the mark-only run is no token between pp and rr').toEqual({ at: 2, len: run.indexOf('rr') + 'rr'.length - 2 });
    expect(libSearch.snippetSpan(one, ['a']), 'a leading U+0301 opens nothing: the hit is a alone').toEqual(sqliteSpan(one, 'a'));
    expect(libSearch.snippetSpan(two, ['a']), 'nor do two leading marks: the hit starts after both').toEqual(sqliteSpan(two, 'a'));
    expect(libSearch.snippetSpan(one, ['\u0301a']), 'a needle\'s leading mark opens nothing either').toEqual({ at: 1, len: 1 });
    expect(libSearch.snippetSpan(inner, ['xa']), 'a mark after an open token continues it, inside the raw span').toEqual(sqliteSpan(inner, 'xa'));
    expect(libSearch.snippetSpan(run, ['pp rr']), 'a leading and a mark-only run are no tokens: phrase adjacency holds').toEqual(sqliteSpan(run, '"pp rr"'));
    const far = `${'y '.repeat(60)}\u0301\u0300\u0323a tail`;
    expect(libSearch.snippetSpan(far, ['a']), 'far from the head, the span still starts at a').toEqual(sqliteSpan(far, 'a'));
    expect(sqliteSpan(far, 'a').at, 'CONTROL: SQLite starts it after the three marks').toBe(far.indexOf('a tail'));
  });
  it('F2 round 5 (round 4\'s exhaustive test, made direct): the private unicode61 helpers and snippetSpan read every non-surrogate code point U+0000..U+10FFFF exactly as runtime SQLite unicode61 does: token (and its exact folded code point), ignored continuation, or boundary, with zero exclusions', async () => {
    const ALL = 0x10ffff + 1;
    // The oracle, read from runtime SQLite one 64Ki block at a time (bounded memory): per code point a folded-term code point (> 0: a standalone
    // token), -1 (a mark dropped inside a token: ignored continuation), -2 (a boundary), 0 (never read, or an unexpected shape).
    const oracle = new Int32Array(ALL);
    const unexpected: string[] = [];
    let read = 0;
    for (let from = 0; from < ALL; from += 0x10000) {
      const to = from + 0xffff;
      const db = new FtsDb(':memory:');
      try {
        db.exec("CREATE VIRTUAL TABLE t USING fts5(b, tokenize='unicode61')");
        db.exec("CREATE VIRTUAL TABLE tv USING fts5vocab(t, 'instance')");
        const ins = db.prepare('INSERT INTO t (rowid, b) VALUES (?, ?)');
        const cps: number[] = [];
        db.exec('BEGIN');
        for (let cp = from; cp <= to; cp += 1) {
          if (cp >= 0xd800 && cp <= 0xdfff) continue;   // a lone surrogate is no character
          cps.push(cp);
          ins.run(cp * 2 + 1, `q${String.fromCodePoint(cp)}q`);   // wrapped: tells a token (one term q<fold>q), a dropped mark (qq) and a boundary (q, q) apart
          ins.run(cp * 2 + 2, String.fromCodePoint(cp));          // direct and standalone: a token is exactly one term, anything else none
        }
        db.exec('COMMIT');
        const terms = new Map<number, string[]>();
        for (const r of db.prepare('SELECT doc, term FROM tv ORDER BY doc, offset').all() as { doc: number; term: string }[]) {
          const a = terms.get(Number(r.doc)) ?? [];
          a.push(r.term);
          terms.set(Number(r.doc), a);
        }
        for (const cp of cps) {
          read += 1;
          const wrapped = terms.get(cp * 2 + 1) ?? [];
          const direct = terms.get(cp * 2 + 2) ?? [];
          if (wrapped.length === 2 && wrapped[0] === 'q' && wrapped[1] === 'q' && direct.length === 0) oracle[cp] = -2;
          else if (wrapped.length === 1 && wrapped[0] === 'qq' && direct.length === 0) oracle[cp] = -1;
          else if (wrapped.length === 1 && wrapped[0]!.startsWith('q') && wrapped[0]!.endsWith('q') && direct.length === 1 && wrapped[0] === `q${direct[0]}q` && [...direct[0]!].length === 1) oracle[cp] = direct[0]!.codePointAt(0)!;
          else unexpected.push(`${cp.toString(16)}:${JSON.stringify(wrapped)}/${JSON.stringify(direct)}`);
        }
      } finally { db.close(); }
    }
    expect(read, 'CONTROL: every non-surrogate code point was read').toBe(ALL - 0x800);
    expect(unexpected.slice(0, 10), 'CONTROL: every code point is a token, a dropped mark or a boundary, and no token folds to several code points').toEqual([]);
    let tokens = 0;
    let dropped = 0;
    let boundaries = 0;
    for (let cp = 0; cp < ALL; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (oracle[cp]! > 0) tokens += 1; else if (oracle[cp] === -1) dropped += 1; else if (oracle[cp] === -2) boundaries += 1;
    }
    expect(tokens + dropped + boundaries, 'CONTROL: the three classes are the whole range').toBe(read);
    // CONTROLS, asserted on the oracle: the relations the round-3 and round-4 findings turn on.
    const o = (cp: number): number => oracle[cp]!;
    expect([o(0x131), o(0x69), o(0x130), o(0x49)], 'CONTROL: \u0131 is its own term; \u0130 and I are i').toEqual([0x131, 0x69, 0x69, 0x69]);
    expect([o(0x378) > 0, /^[\p{L}\p{N}]$/u.test('\u0378')], 'CONTROL: U+0378 is a SQLite-only token').toEqual([true, false]);
    expect([o(0x19b0), /^[\p{L}\p{N}]$/u.test('\u19b0')], 'CONTROL: U+19B0 is a JavaScript-only letter, a boundary to SQLite').toEqual([-2, true]);
    expect([o(0x104b0), o(0x104d8)], 'CONTROL: U+104B0 and U+104D8 stay distinct').toEqual([0x104b0, 0x104d8]);
    expect([o(0x3a3), o(0x3c2), o(0x3c3)], 'CONTROL: \u03a3, \u03c2 and \u03c3 are one \u03c3').toEqual([0x3c3, 0x3c3, 0x3c3]);
    expect([o(0xb5), o(0x3bc)], 'CONTROL: the micro sign is Greek \u03bc').toEqual([0x3bc, 0x3bc]);
    expect([o(0x17f), o(0xe9), o(0x1ed9)], 'CONTROL: \u017f is s, \u00e9 is e, U+1ED9 stays itself').toEqual([0x73, 0x65, 0x1ed9]);
    expect([o(0x301), o(0x305)], 'CONTROL: U+0301 is dropped, U+0305 a boundary').toEqual([-1, -2]);
    expect([o(0), o(0xfffe), o(0xffff), o(0x10ffff) > 0], 'CONTROL: NUL, U+FFFE and U+FFFF are boundaries; the last code point is a token').toEqual([-2, -2, -2, true]);
    const marks = Array.from({ length: 0x70 }, (_, i) => 0x300 + i);
    expect(marks.filter((cp) => o(cp) === -1).length, 'CONTROL: exactly 25 of the 112 marks U+0300-U+036F are dropped').toBe(25);
    expect(marks.filter((cp) => o(cp) === -2).length, 'CONTROL: and exactly 87 are boundaries').toBe(87);
    const DROPPED: [number, number][] = [[0x300, 0x304], [0x306, 0x30c], [0x30f, 0x30f], [0x311, 0x311], [0x31b, 0x31b], [0x323, 0x328], [0x32d, 0x32e], [0x330, 0x331]];
    expect(marks.filter((cp) => (o(cp) === -1) !== DROPPED.some(([a, b]) => cp >= a && cp <= b)), 'CONTROL: SQLite drops exactly the listed marks').toEqual([]);
    expect(tokens, 'CONTROL: the standalone token population of the frozen unicode61 category table').toBe(1_104_042);
    expect(dropped, 'CONTROL: the dropped marks are the only ignored continuations').toBe(25);

    // DIRECT: the three private helpers themselves, compared with the oracle code point by code point. Observed through snippetSpan
    // alone, a fold is applied to source and needle alike, so a wrong fold of a token onto any distant token compares equal to itself
    // (the gap round 4's bounded neighbour and host-confusable probes left open). The helpers stay private: the test runs a temporary
    // copy of the trusted lib.mjs bytes with ONE appended export statement naming them, and never reads, parses or copies their tables.
    const dir = mkTmp('ccrc-history-f2r5-');
    const copy = join(dir, 'lib-instrumented.mjs');
    const EXPORTS = 'export { isUnicode61Token, unicode61Fold, isDroppedMark };';
    writeFileSync(copy, `${readFileSync(LIB, 'utf8')}\n${EXPORTS}\n`);
    const h = await import(/* @vite-ignore */ `${pathToFileURL(copy).href}?f2r5=${process.pid}-${Date.now()}`) as {
      isUnicode61Token: (cp: number) => boolean; unicode61Fold: (cp: number) => number; isDroppedMark: (cp: number) => boolean;
    };
    expect([typeof h.isUnicode61Token, typeof h.unicode61Fold, typeof h.isDroppedMark], 'CONTROL: the instrumented copy exports the three helpers').toEqual(['function', 'function', 'function']);
    expect(Object.keys(libSearch).filter((k) => ['isUnicode61Token', 'unicode61Fold', 'isDroppedMark'].includes(k)), 'CONTROL: production keeps them private').toEqual([]);
    const direct: string[] = [];
    const pub: string[] = [];
    const note = (list: string[], cp: number, what: string): void => { if (list.length < 400) list.push(`${cp.toString(16)} ${what}`); else if (list.length === 400) list.push('...'); };
    let compared = 0;
    for (let cp = 0; cp < ALL; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      compared += 1;
      const cls = o(cp);
      const tok = h.isUnicode61Token(cp);
      const drop = h.isDroppedMark(cp);
      if (cls === -2) {
        if (tok !== false || drop !== false) note(direct, cp, `boundary: token ${tok}, dropped ${drop}`);
      } else if (cls === -1) {
        if (tok !== false || drop !== true) note(direct, cp, `dropped continuation: token ${tok}, dropped ${drop}`);
      } else {
        const fold = h.unicode61Fold(cp);
        if (tok !== true || drop !== false || fold !== cls) note(direct, cp, `token: token ${tok}, dropped ${drop}, fold ${fold.toString(16)} != sqlite ${cls.toString(16)}`);
      }
    }
    expect(compared, 'CONTROL: every non-surrogate code point was compared directly').toBe(read);

    // PUBLIC behaviour, one code point at a time, through snippetSpan: raw spans, membership and the mark rules. Folding equality is
    // proved by the direct comparison above (equal folds are exactly the oracle's equal terms, every pair), not by these symmetric reads.
    for (let cp = 0; cp < ALL; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const cls = o(cp);
      if (cls === -2) {
        const t = `x${ch}y`;
        const split = libSearch.snippetSpan(t, ['x y']);
        if (split.at !== 0 || split.len !== t.length) note(pub, cp, 'boundary: `x y` must read across it');
        if (libSearch.snippetSpan(t, ['xy']).at !== -1) note(pub, cp, 'boundary: `xy` must not');
        const needle = libSearch.snippetSpan(t, [t]);
        if (needle.at !== 0 || needle.len !== t.length) note(pub, cp, 'boundary: a needle splits the same way');
        if (libSearch.snippetSpan(ch, [ch]).at !== -1) note(pub, cp, 'boundary: no token of its own');
      } else if (cls === -1) {
        const t = `x${ch}y`;
        const joined = libSearch.snippetSpan(t, ['xy']);
        if (joined.at !== 0 || joined.len !== t.length) note(pub, cp, 'dropped: continues the token and vanishes');
        if (libSearch.snippetSpan(t, ['x y']).at !== -1) note(pub, cp, 'dropped: is no boundary');
        if (libSearch.snippetSpan(ch, [ch]).at !== -1) note(pub, cp, 'dropped: no standalone token');
        const across = libSearch.snippetSpan(`pp ${ch} rr`, ['pp rr']);
        if (across.at !== 0) note(pub, cp, 'dropped: a mark-only candidate is no token');
        const lead = libSearch.snippetSpan(`${ch}y`, ['y']);
        if (lead.at !== ch.length || lead.len !== 1) note(pub, cp, `dropped: a leading mark opens no token (at ${lead.at}, len ${lead.len})`);
      } else {
        const term = String.fromCodePoint(cls);
        const own = libSearch.snippetSpan(ch, [term]);
        if (own.at !== 0 || own.len !== ch.length) note(pub, cp, `token: standalone as its term ${cls.toString(16)}`);
        const mid = libSearch.snippetSpan(`x${ch}y`, [`x${term}y`]);
        if (mid.at !== 0 || mid.len !== ch.length + 2) note(pub, cp, `token: inside a word as ${cls.toString(16)}`);
      }
    }
    expect({ direct, public: pub }, 'production disagrees with runtime SQLite at (code point, what): direct helper parity, then snippetSpan').toEqual({ direct: [], public: [] });
  }, 600_000);
});

describe('parseTimeBound: --since and --before (spec 8.4)', () => {
  const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
  it('reads <n>d, <n>h and <n>min before now', () => {
    expect(libSearch.parseTimeBound('7d', NOW)).toBe(NOW - 7 * 86_400_000);
    expect(libSearch.parseTimeBound('3h', NOW)).toBe(NOW - 3 * 3_600_000);
    expect(libSearch.parseTimeBound('90min', NOW)).toBe(NOW - 90 * 60_000);
  });
  it('reads an ISO date as UTC midnight, and a date-time only with a zone', () => {
    expect(libSearch.parseTimeBound('2026-10-01', NOW)).toBe(Date.UTC(2026, 9, 1));
    expect(libSearch.parseTimeBound('2026-10-01T10:00:00Z', NOW)).toBe(Date.UTC(2026, 9, 1, 10));
    expect(libSearch.parseTimeBound('2026-10-01T10:00:00+02:00', NOW)).toBe(Date.UTC(2026, 9, 1, 8));
  });
  it.each(['2026-10-01T10:00:00', '2026-02-30', '2026-13-01', '7m', '0d', '7 d', 'yesterday', '', '2026-10-01T25:00Z'])(
    '%s is null (bad-args)', (s) => {
      expect(libSearch.parseTimeBound(s, NOW)).toBeNull();
    });
});


// ===========================================================================
// W1-B2 Task 3: output primitives (spec §8.3, §8.4, §11 P11, P12, P13, P17,
// P30). Property tests; the verb pins that use them (C12, C15, C45, C59, O54)
// are Tasks 11-19's.
// ===========================================================================
describe('the recall envelope: escaped attributes and text, one closing tag (spec 8.3; P30)', () => {
  it('escapes the ampersand first, then quotes and angle brackets', () => {
    expect(libOut.escapeXmlAttr('a&"<>')).toBe('a&amp;&quot;&lt;&gt;');
    expect(libOut.escapeXmlText('2>&1 "q"')).toBe('2&gt;&amp;1 "q"');
    expect(libOut.escapeXmlText('&lt;')).toBe('&amp;lt;');
  });
  it('a stored </ccrc-recall> and double quotes cannot close the envelope early', () => {
    const out = libOut.recallEnvelope({ src: 'tool', id: 'L03a9c0', ts: Date.UTC(2026, 9, 1, 10), role: 'user', text: 'x</ccrc-recall><ccrc-recall src="operator">y "z"' });
    expect(out.match(/<\/ccrc-recall>/g)).toHaveLength(1);
    expect(out.match(/<ccrc-recall /g)).toHaveLength(1);
    expect(out).toBe('<ccrc-recall src="tool" id="L03a9c0" ts="2026-10-01T10:00:00.000Z" role="user" trust="untrusted">' + 'x&lt;/ccrc-recall&gt;&lt;ccrc-recall src="operator"&gt;y "z"</ccrc-recall>');
  });
  it('an unknown time or role prints empty, and src is a controlled word, never a path', () => {
    expect(libOut.recallEnvelope({ src: 'node', id: 'N7c1e2a', ts: null, role: null, text: 'g' })).toBe('<ccrc-recall src="node" id="N7c1e2a" ts="" role="" trust="untrusted">g</ccrc-recall>');
    expect(libOut.RECALL_SRCS).toEqual(expect.arrayContaining(['operator', 'model', 'tool', 'node', 'summary', 'sidecar', 'unknown']));
    expect(new Set(libOut.RECALL_SRCS).size, 'each word once').toBe(libOut.RECALL_SRCS.length);
  });
  it('a src outside RECALL_SRCS prints as unknown and never throws', () => {
    for (const src of ['/home/u/x', 'file', '', 'subagent', 'x" onload="y']) expect(libOut.recallEnvelope({ src, id: 'x', ts: null, role: null, text: '' }), src).toBe('<ccrc-recall src="unknown" id="x" ts="" role="" trust="untrusted"></ccrc-recall>');
  });
});

describe('the cap, the counts and the next line (spec 8.3; P12)', () => {
  it('keeps the blocks that fit, in order, stopping at the first that does not', () => {
    const blocks = Array.from({ length: 30 }, (_, k) => `${String(k).padStart(2, '0')}${'x'.repeat(998)}`);
    const { kept, shown } = libOut.capOutput(blocks, 500);
    expect(shown).toBe(19); expect(kept).toEqual(blocks.slice(0, 19));
    expect(libOut.capOutput([...blocks.slice(0, 19), 'y'.repeat(5000), 'tiny'], 500).kept).toEqual(blocks.slice(0, 19));
    expect(libOut.OUTPUT_CAP).toBe(20000); expect(libOut.capOutput(['a'.repeat(20000)], 0).shown).toBe(0);
  });
  it('shown K of N names the true count, and K above N is refused', () => {
    expect(libOut.shownLine(19, 50)).toBe('shown 19 of 50'); expect(libOut.shownLine(0, 0)).toBe('shown 0 of 0');
    expect(() => libOut.shownLine(51, 50)).toThrow(TypeError); expect(() => libOut.shownLine(-1, 50)).toThrow(TypeError);
  });
  it('a hit is one line, cut with ... past 200 characters', () => {
    expect(libOut.snippetLine('a\nb  ')).toBe('a b'); expect(libOut.snippetLine('z'.repeat(250))).toBe(`${'z'.repeat(197)}...`); expect(libOut.SNIPPET_MAX).toBe(200);
  });
  it('next: runs the CLI by its literal path, quoting what is not plainly safe', () => {
    expect(libOut.HISTORY_CMD).toBe('"$HOME/.local/bin/ccrc" history');
    expect(libOut.nextLine(['grep', 'drain', '--cursor', 'eyJ2IjoxfQ'])).toBe('next: "$HOME/.local/bin/ccrc" history grep drain --cursor eyJ2IjoxfQ');
    expect(libOut.nextLine(['grep', 'a0860d1f*', "it's", '$HOME', ''])).toBe(`next: "$HOME/.local/bin/ccrc" history grep 'a0860d1f*' 'it'\\''s' '$HOME' ''`);
  });
});

describe('the header and the lag (spec 8.3, 6.9)', () => {
  const T = Date.UTC(2026, 9, 6, 12, 0, 0);
  it('names the scope, coverage=this-box, indexed-through and lag', () => {
    expect(libOut.headerLine({ kind: 'family', id: 'claude-a-demo', project: 'demo', families: 1, transcripts: 3, indexedThroughMs: T, lagS: 42 })).toBe('scope=family(claude-a-demo, 3 transcripts) coverage=this-box indexed-through=2026-10-06T12:00:00.000Z lag=42s');
    expect(libOut.headerLine({ kind: 'project', id: 'claude-a-demo', project: 'demo', families: 2, transcripts: 5, indexedThroughMs: null, lagS: null })).toBe('scope=project(demo, 2 families) coverage=this-box indexed-through=unmeasured lag=unmeasured');
    expect(libOut.headerLine({ kind: 'workspace', id: 'claude-a-demo', project: 'demo', families: 1, transcripts: 1, indexedThroughMs: T, lagS: 0 })).toBe('scope=workspace(demo, 1 families) coverage=this-box indexed-through=2026-10-06T12:00:00.000Z lag=0s');
    expect(() => libOut.headerLine({ kind: 'box' as 'family', id: 'a', project: null, families: 0, transcripts: 0, indexedThroughMs: null, lagS: null })).toThrow(TypeError);
  });
  it('lag is now minus the oldest end-of-file tick in scope; any file never at its end, none, or a recovery is unmeasured, never 0', () => {
    expect(libOut.scopeLag({ eofMs: [T - 5_000, T - 61_000], nowMs: T, recovering: false })).toEqual({ indexedThroughMs: T - 61_000, lagS: 61 });
    expect(libOut.scopeLag({ eofMs: [T - 5_000, null], nowMs: T, recovering: false })).toEqual({ indexedThroughMs: null, lagS: null });
    expect(libOut.scopeLag({ eofMs: [], nowMs: T, recovering: false })).toEqual({ indexedThroughMs: null, lagS: null });
    expect(libOut.scopeLag({ eofMs: [T - 5_000], nowMs: T, recovering: true })).toEqual({ indexedThroughMs: null, lagS: null });
    expect(libOut.scopeLag({ eofMs: [T + 9_000], nowMs: T, recovering: false })).toEqual({ indexedThroughMs: T + 9_000, lagS: 0 });
  });
});

describe('the read --json envelope: reason exactly where the exit carries one (spec 8.3; P11)', () => {
  const base = { storeId: '0189abcd-1234-4678-9abc-0123456789ab', scope: { kind: 'family' }, header: { indexedThroughMs: 5, lagS: 1 }, items: [], shown: 0, total: 0, next: null };
  it('carries store_id, coverage and every item stamped untrusted, whatever the item said', () => {
    const env = libOut.readEnvelope({ ...base, exit: 0, items: [{ node_id: 'L03a9c000000000000001', trust: 'trusted' }], shown: 1, total: 1 });
    expect(env).toEqual({ v: 1, exit: 0, store_id: base.storeId, coverage: 'this-box', scope: { kind: 'family' }, indexed_through_ms: 5, lag_s: 1, items: [{ node_id: 'L03a9c000000000000001', trust: 'untrusted' }], shown: 1, total: 1, next: null });
    expect('reason' in env).toBe(false);
  });
  it('exits 2, 4, 5 and 7 need a reason word of their own code', () => {
    expect(libOut.readEnvelope({ ...base, exit: 2, reason: 'out-of-scope' }).reason).toBe('out-of-scope'); expect(libOut.readEnvelope({ ...base, exit: 5, reason: 'store-unbound', header: null }).reason).toBe('store-unbound');
    expect(() => libOut.readEnvelope({ ...base, exit: 2 })).toThrow(TypeError); expect(() => libOut.readEnvelope({ ...base, exit: 2, reason: 'store-unbound' })).toThrow(TypeError); expect(() => libOut.readEnvelope({ ...base, exit: 7, reason: 'toString' })).toThrow(TypeError);
  });
  it('exits 0, 1, 3, 6, 8 and 9 carry none, and a value outside EXIT is refused', () => {
    for (const exit of [0, 1, 3, 6, 8, 9]) expect(() => libOut.readEnvelope({ ...base, exit, reason: 'bad-args' }), String(exit)).toThrow(TypeError);
    expect(() => libOut.readEnvelope({ ...base, exit: 10 })).toThrow(TypeError); expect(() => libOut.readEnvelope({ ...base, exit: 3, shown: 2, total: 1 })).toThrow(TypeError);
  });
});

describe('the cursor: opaque, versioned, ids only (spec 8.4)', () => {
  it('round-trips its resource schema, and refuses another resource, a tampered string or text', () => {
    const c = { v: 1 as const, resource: 'grep' as const, q: 'a'.repeat(64), pos: 12 }; const s = libOut.encodeCursor(c);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/); expect(libOut.decodeCursor(s, 'grep')).toEqual(c); expect(libOut.decodeCursor(s, 'expand')).toBeNull(); expect(libOut.decodeCursor(`${s}!`, 'grep')).toBeNull(); expect(libOut.decodeCursor('', 'grep')).toBeNull();
    expect(libOut.decodeCursor(Buffer.from('{"v":2,"resource":"grep"}').toString('base64url'), 'grep')).toBeNull(); expect(libOut.decodeCursor(Buffer.from('{"v":1,"resource":"grep","q":"some recalled text"}').toString('base64url'), 'grep')).toBeNull();
    expect(() => libOut.encodeCursor({ v: 1, resource: 'grep', q: 'some recalled text', pos: 0 })).toThrow(TypeError); expect(() => libOut.encodeCursor({ v: 1, resource: 'grep', a: { b: { c: 1 } } } as never)).toThrow(TypeError); expect(() => libOut.encodeCursor({ v: 1, resource: 'tree' } as never)).toThrow(TypeError);
  });
  it('refuses unknown top-level and nested keys on encode and decode', () => {
    const top = { v: 1, resource: 'grep', q: 'a'.repeat(20), pos: 0, 'some recalled text': 1 } as const;
    const nested = { v: 1, resource: 'grep', q: 'a'.repeat(20), pos: 0, after: { 'some recalled text': 1 } } as const;
    for (const c of [top, nested]) {
      expect(() => libOut.encodeCursor(c as never), JSON.stringify(c)).toThrow(TypeError);
      expect(libOut.decodeCursor(Buffer.from(JSON.stringify(c)).toString('base64url'), 'grep'), JSON.stringify(c)).toBeNull();
    }
  });
});

describe('decideRelay: the shim result the CLI relays (spec 8.4; O54 relay half, pure)', () => {
  it.each([
    ['the lock held', { status: 75, signal: null, lastLine: null }, { exit: 4, reason: 'writer-busy' }], ['a refusal decided under the lock', { status: 2, signal: null, lastLine: '{"rc":2,"reason":"adopt-refused"}' }, { exit: 2, reason: 'adopt-refused' }], ['a store error', { status: 5, signal: null, lastLine: '{"rc":5,"reason":"store-unreachable"}' }, { exit: 5, reason: 'store-unreachable' }], ['done', { status: 0, signal: null, lastLine: '{"rc":0}' }, { exit: 0 }], ['no store on a server box', { status: 9, signal: null, lastLine: '{"rc":9}' }, { exit: 9 }], ['an internal error the sweep stated', { status: 1, signal: null, lastLine: '{"rc":1}' }, { exit: 1 }],
  ] as const)('%s', (_name, input, want) => expect(libOut.decideRelay(input)).toEqual(want));
  it.each([
    ['killed by a signal', { status: null, signal: 'SIGKILL', lastLine: '{"rc":0}' }], ['no result line', { status: 0, signal: null, lastLine: null }], ['not JSON', { status: 0, signal: null, lastLine: 'history-sweep: held' }], ['a status that disagrees with rc', { status: 0, signal: null, lastLine: '{"rc":2,"reason":"bad-args"}' }], ['a reason on exit 0', { status: 0, signal: null, lastLine: '{"rc":0,"reason":"bad-args"}' }], ['a reason on exit 3', { status: 3, signal: null, lastLine: '{"rc":3,"reason":"bad-args"}' }], ['exit 2 without a reason', { status: 2, signal: null, lastLine: '{"rc":2}' }], ['a reason of another code', { status: 2, signal: null, lastLine: '{"rc":2,"reason":"store-unbound"}' }], ['an extra key', { status: 0, signal: null, lastLine: '{"rc":0,"ok":true}' }], ['an rc outside EXIT', { status: 12, signal: null, lastLine: '{"rc":12}' }],
  ] as const)('%s is exit 1, never a result the sweep did not state', (_name, input) => expect(libOut.decideRelay(input)).toEqual({ exit: 1 }));
});

describe('the explorers: the Read prefix stripped, the kind from the path (spec 8.4; P17)', () => {
  const read = (lines: readonly string[], from = 1, sep = '→'): string => lines.map((l, k) => `${String(from + k).padStart(6)}${sep}${l}`).join('\n');
  const TS = ["import { a } from './a.js';", "import b from './b.js';", '', 'export function run(x: number): number {', '  return x;', '}', 'const y = (v: number) => v;'];
  it('strips a consecutive run of Read prefixes, arrow or tab, and keeps what follows', () => {
    expect(libOut.stripReadPrefix(read(['a', 'b']))).toBe('a\nb'); expect(libOut.stripReadPrefix(read(['a', 'b'], 40, '\t'))).toBe('a\nb'); expect(libOut.stripReadPrefix(`${read(['a', 'b'])}\n\n<system-reminder>x</system-reminder>`)).toBe('a\nb\n\n<system-reminder>x</system-reminder>'); expect(libOut.stripReadPrefix('plain\n     2→x')).toBe('plain\n     2→x'); expect(libOut.stripReadPrefix('     1→a\n     5→b')).toBe('a\n     5→b');
  });
  it('the kind follows the paired tool_use path extension; anything else has none', () => {
    expect(libOut.exploreKindOf('/home/u/tree/src/a.ts')).toBe('code'); expect(libOut.exploreKindOf('Data.JSON')).toBe('json'); expect(libOut.exploreKindOf('x/rows.csv')).toBe('csv'); expect(libOut.exploreKindOf('rows.tsv')).toBe('tsv'); for (const p of ['notes.md', 'transcript.jsonl', '.bashrc', 'Makefile', '', null]) expect(libOut.exploreKindOf(p), String(p)).toBeNull();
  });
  it('the code outline finds the imports a Read output holds (refuted candidate 3)', () => {
    const out = libOut.explore(read(TS), 'code', 'src/a.ts'); expect(out).toContain("Imports/dependencies (2): import { a } from './a.js'; | import b from './b.js';."); expect(out).toContain('Top-level definitions (2): export function run(x: number): number { | const y = (v: number) => v;.'); expect(out.startsWith('Code exploration summary (src/a.ts):\nLines: 7.')).toBe(true);
  });
  it('JSON shape, CSV and TSV columns, and counts past the JSON bound', () => {
    expect(libOut.explore(read(['{"a":1,', '"b":[1,2]}']), 'json')).toBe('Structured summary (JSON):\nTop-level type: object.\nShape: object(keys=2: a, b).'); expect(libOut.explore('{not json', 'json')).toBe('Structured summary (JSON): failed to parse as valid JSON.'); expect(libOut.explore('id,name\n1,a\n2,b', 'csv')).toBe('Structured summary (CSV):\nRows: 2.\nColumns (2): id, name.\nFirst row sample: 1,a.'); expect(libOut.explore('id\tname\n1\ta', 'tsv')).toContain('Columns (2): id, name.'); const big = `[${'1,'.repeat(libOut.EXPLORE_JSON_MAX / 2)}1]`; expect(libOut.explore(big, 'json')).toBe(`Structured summary:\nCharacters: ${big.length.toLocaleString('en-US')}.\nLines: 1.`); expect(() => libOut.explore('x', 'yaml' as 'json')).toThrow(TypeError);
  });
});

describe('costRow and pickExpandBody (spec 8.4 describe, 6.1 variants)', () => {
  it('fits=in up to the output cap, over past it', () => { expect(libOut.costRow(20000)).toEqual({ chars: 20000, fits: 'in' }); expect(libOut.costRow(20001)).toEqual({ chars: 20001, fits: 'over' }); expect(libOut.costRow(10, 5)).toEqual({ chars: 10, fits: 'over' }); });
  it('expand prints the body without ccd\'s ... fill, whichever copy came first (DM2b pure half)', () => { const clean = [{ type: 'text', text: '' }, { type: 'text', text: 'done' }]; const filled = [{ type: 'text', text: '...' }, { type: 'text', text: 'done' }]; expect(libOut.pickExpandBody({ primary: filled, variants: [{ body: clean, cause: 'ccd-sanitize' }] })).toBe(clean); expect(libOut.pickExpandBody({ primary: clean, variants: [{ body: filled, cause: 'ccd-sanitize' }] })).toBe(clean); });
  it('a variant of unknown cause, or one mislabelled ccd-sanitize, leaves the primary', () => { const a = [{ type: 'text', text: '...' }]; const b = [{ type: 'text', text: 'two' }]; expect(libOut.pickExpandBody({ primary: a, variants: [{ body: b, cause: 'unknown' }] })).toBe(a); expect(libOut.pickExpandBody({ primary: a, variants: [{ body: b, cause: 'ccd-sanitize' }] })).toBe(a); expect(libOut.pickExpandBody({ primary: a, variants: [] })).toBe(a); });
});

// ===========================================================================
// W1-B2 Task 6: the operator-verb decisions (spec §6.6, §6.9, §8.3, §8.4),
// pure. The CLI's door (Task 19) and the sweep's --op dispatch both call
// them, so the two doors answer the same words (C64).
// ===========================================================================
describe('the refusal words B2 adds are exit-2 REASONS (spec 8.3; NEW history-reasons-repair-backup, NEW history-ops-refused-while-recovering)', () => {
  it('repair-refused, backup-refused and recovering map to exit 2, and REFUSALS derives them', () => {
    for (const w of ['repair-refused', 'backup-refused', 'recovering']) expect(libOps.REASONS[w], w).toBe(libOps.EXIT.REFUSED);
    expect(libOps.REFUSALS).toEqual(expect.arrayContaining(['repair-refused', 'backup-refused', 'recovering']));
  });
  it("recovering is also doctor's WARN word: one word, two tables, as store-unmeasured already is", () => {
    expect(libOps.HEALTH_WORDS['recovering']).toBe('warn');
    expect(libOps.HEALTH_WORDS['store-unmeasured']).toBe('fail');
    expect(libOps.REASONS['store-unmeasured']).toBe(libOps.EXIT.DB);
  });
});

describe('decideOpGate while a recovery step is registered: every writing form but restore and rebuild is refused, with RB12-RB14\'s exemptions (RB6; NEW history-ops-refused-while-recovering)', () => {
  const FORMS = libOps.WRITING_FORMS as unknown as Readonly<Record<string, Readonly<{ op: string; irreversible: boolean; binding: boolean }>>>;
  /** RB6's list: import --apply (both forms), prune --apply, reparse --apply, doctor --repair, --backup, --adopt, --migrate.
   *  migrate and adopt are refused here because `recovering` alone carries none of RB13's or RB14's facts. */
  const REFUSED = ['import-apply', 'import-session-apply', 'prune-apply', 'reparse-apply', 'repair', 'backup', 'adopt', 'migrate'];
  /** RB6 allows restore and rebuild (they replace the step); RB12 exempts W2's recall-off forms. */
  const ALLOWED = ['restore', 'rebuild', 'recall-off', 'recall-off-clear-all'];
  const recovering = { claudecode: false, historyOff: false, recovering: true };
  const S = '0189abcd-1234-4678-9abc-0000000000e1';
  const ver = (value: number): libOps.Presence<number> => ({ state: 'value', value });
  const sid = (value: string): libOps.Presence<string> => ({ state: 'value', value });
  const absent = { state: 'absent' } as const;
  const unreadable = { state: 'unreadable' } as const;
  const refusedRecovering = { ok: false, rc: 2, reason: 'recovering' };

  it('CONTROL: the two lists cover every WRITING_FORMS key exactly once', () => {
    expect([...REFUSED, ...ALLOWED].sort()).toEqual(Object.keys(FORMS).sort());
  });
  it('each RB6 form answers recovering; restore, rebuild and the recall-off forms (RB12) pass; a dry run passes', () => {
    for (const f of REFUSED) expect(libOps.decideOpGate(f, recovering, true, null), f).toEqual(refusedRecovering);
    for (const f of ALLOWED) expect(libOps.decideOpGate(f, recovering, true, null), f).toEqual({ ok: true });
    expect(libOps.decideOpGate(null, recovering, false, 'cc-demo-quiet-basin')).toEqual({ ok: true });
  });
  it("RB13: migrate is refused only while the stored user_version equals the code's; an older or a newer store passes; an unmeasured version keeps the refusal", () => {
    // codeVersion null builds an env with NO codeVersion key ("not measured"); undefined would select the default 2.
    const at = (storedVersion: libOps.Presence<number> | undefined, codeVersion: number | null = 2) => ({ ...recovering, storedVersion, ...(codeVersion === null ? {} : { codeVersion }) });
    expect(libOps.decideOpGate('migrate', at(ver(2)), true, null), 'stored = code').toEqual(refusedRecovering);
    expect(libOps.decideOpGate('migrate', at(ver(1)), true, null), 'a restored older backup').toEqual({ ok: true });
    expect(libOps.decideOpGate('migrate', at(ver(3)), true, null), 'newer: openStore answers it, not this row').toEqual({ ok: true });
    for (const sv of [unreadable, absent, undefined]) {
      expect(libOps.decideOpGate('migrate', at(sv), true, null), `storedVersion ${JSON.stringify(sv)}`).toEqual(refusedRecovering);
    }
    expect(libOps.decideOpGate('migrate', at(ver(1), null), true, null), 'no code version measured').toEqual(refusedRecovering);
    // The version facts exempt migrate alone.
    for (const f of REFUSED.filter((x) => x !== 'migrate')) expect(libOps.decideOpGate(f, at(ver(1)), true, null), f).toEqual(refusedRecovering);
  });
  it('RB14: adopt is exempt only on an unbound store (store.id absent); a store.id present, unreadable or unmeasured keeps the refusal', () => {
    const with_ = (storeId: libOps.Presence<string> | undefined) => ({ ...recovering, storeId });
    expect(libOps.decideOpGate('adopt', with_(absent), true, null), 'unbound').toEqual({ ok: true });
    for (const p of [sid(S), unreadable, undefined]) {
      expect(libOps.decideOpGate('adopt', with_(p), true, null), `storeId ${JSON.stringify(p)}`).toEqual(refusedRecovering);
    }
    // store.id absent exempts adopt alone.
    for (const f of REFUSED.filter((x) => x !== 'adopt')) expect(libOps.decideOpGate(f, with_(absent), true, null), f).toEqual(refusedRecovering);
    // The exemption sits after B1's bumps: adopt still needs a TTY and refuses a cc- pane.
    expect(libOps.decideOpGate('adopt', with_(absent), false, null)).toEqual({ ok: false, rc: 2, reason: 'needs-tty' });
    expect(libOps.decideOpGate('adopt', with_(absent), true, 'cc-demo-quiet-basin')).toEqual({ ok: false, rc: 2, reason: 'irreversible-in-pane' });
  });
  it("B1's bumps still answer first: CLAUDECODE, the TTY, a cc- pane, history-off", () => {
    expect(libOps.decideOpGate('repair', { ...recovering, claudecode: true }, true, null)).toEqual({ ok: false, rc: 2, reason: 'apply-in-session' });
    expect(libOps.decideOpGate('repair', recovering, false, null)).toEqual({ ok: false, rc: 2, reason: 'needs-tty' });
    expect(libOps.decideOpGate('repair', recovering, true, 'cc-demo-quiet-basin')).toEqual({ ok: false, rc: 2, reason: 'irreversible-in-pane' });
    expect(libOps.decideOpGate('backup', { ...recovering, historyOff: true }, true, null)).toEqual({ ok: false, rc: 2, reason: 'history-off' });
  });
  it('recovering absent (the CLI half) or false refuses nothing new', () => {
    for (const f of REFUSED) {
      expect(libOps.decideOpGate(f, { claudecode: false, historyOff: false }, true, null), f).toEqual({ ok: true });
      expect(libOps.decideOpGate(f, { claudecode: false, historyOff: false, recovering: false }, true, null), f).toEqual({ ok: true });
    }
  });
});

describe("parseOpVerbArgs: each verb's argv, decided once for both doors (spec 8.4)", () => {
  const ok = (op: string, args: string[]): libOps.OpArgs => {
    const r = libOps.parseOpVerbArgs(op, args);
    if (!r.ok) throw new Error(`${op} ${args.join(' ')}: ${r.reason}`);
    return r.args;
  };
  const why = (op: string, args: string[]): string => {
    const r = libOps.parseOpVerbArgs(op, args);
    return r.ok ? 'ok' : r.reason;
  };
  const FILE = '/home/u/.claude/projects/-home-u-worktrees-p-quiet-basin/0189abcd-1234-4678-9abc-000000000001.jsonl';

  it("import keeps B1's grammar: --apply, and --session with --file, both or neither", () => {
    expect(ok('import', [])).toEqual({ op: 'import', apply: false, session: null, file: null });
    expect(ok('import', ['--apply'])).toEqual({ op: 'import', apply: true, session: null, file: null });
    expect(ok('import', ['--session', 'claude-demo', '--file', FILE, '--apply'])).toEqual({ op: 'import', apply: true, session: 'claude-demo', file: FILE });
    expect(why('import', ['--session', 'claude-demo'])).toBe('bad-args');
    expect(why('import', ['--apply', '--apply'])).toBe('bad-args');
    expect(why('import', ['stray'])).toBe('bad-args');
    expect(why('import', ['--session'])).toBe('bad-args');
    expect(why('import', ['--session', '../x', '--file', FILE])).toBe('bad-id');
    expect(why('import', ['--session', 'claude-demo', '--file', '/home/u/notes.txt'])).toBe('bad-args');
    expect(why('import', ['--session', 'claude-demo', '--file', '/home/u/x/not-a-uuid.jsonl'])).toBe('bad-args');
  });

  it('migrate, repair, backup and adopt take no arguments', () => {
    for (const op of ['migrate', 'repair', 'backup', 'adopt']) {
      expect(ok(op, []), op).toEqual({ op });
      expect(why(op, ['--apply']), op).toBe('bad-args');
    }
  });

  it('prune needs --older-than; under 30 days is older-than-floor (DM22 pure half)', () => {
    expect(ok('prune', ['--older-than', '90d'])).toEqual({ op: 'prune', days: 90, apply: false });
    expect(ok('prune', ['--older-than', '3m', '--apply'])).toEqual({ op: 'prune', days: 90, apply: true });
    expect(ok('prune', ['--apply', '--older-than', '30d'])).toEqual({ op: 'prune', days: 30, apply: true });
    expect(why('prune', ['--older-than', '7d'])).toBe('older-than-floor');
    expect(why('prune', ['--older-than', '29 days'])).toBe('older-than-floor');
    expect(why('prune', [])).toBe('bad-args');
    expect(why('prune', ['--apply'])).toBe('bad-args');
    expect(why('prune', ['--older-than', 'soon'])).toBe('bad-args');
    expect(why('prune', ['--older-than'])).toBe('bad-args');
  });

  it('reparse takes a full 20-hex node id or a session, never both, plus --apply', () => {
    const NODE = 'L0123456789abcdef0123';
    expect(ok('reparse', [])).toEqual({ op: 'reparse', node: null, session: null, apply: false });
    expect(ok('reparse', ['--node', NODE, '--apply'])).toEqual({ op: 'reparse', node: NODE, session: null, apply: true });
    expect(ok('reparse', ['--node', 'N0123456789abcdef0123'])).toMatchObject({ node: 'N0123456789abcdef0123' });
    expect(ok('reparse', ['--session', 'claude-demo'])).toEqual({ op: 'reparse', node: null, session: 'claude-demo', apply: false });
    expect(why('reparse', ['--node', 'L0123ab'])).toBe('bad-args');
    expect(why('reparse', ['--node', NODE.toUpperCase()])).toBe('bad-args');
    expect(why('reparse', ['--node', NODE, '--session', 'claude-demo'])).toBe('bad-args');
    expect(why('reparse', ['--session', '..'])).toBe('bad-id');
  });

  it('restore takes exactly one bare backup name; a path, a temp or another name is restore-refused (C57 pure half)', () => {
    expect(ok('restore', ['20261001T000000Z.db'])).toEqual({ op: 'restore', name: '20261001T000000Z.db' });
    expect(ok('restore', ['pre-v2.db'])).toEqual({ op: 'restore', name: 'pre-v2.db' });
    for (const n of ['../20261001T000000Z.db', 'backups/20261001T000000Z.db', '.20261001T000000Z.db.tmp',
      '20261001T000000Z.db.tmp', 'pre-v0.db', 'history.db', '/home/u/x.db']) {
      expect(why('restore', [n]), n).toBe('restore-refused');
    }
    expect(why('restore', [])).toBe('bad-args');
    expect(why('restore', ['pre-v2.db', 'pre-v3.db'])).toBe('bad-args');
    expect(why('restore', ['--apply'])).toBe('bad-args');
  });

  it('rebuild takes an optional --store-id of the uuid grammar', () => {
    const S = '0189abcd-1234-4678-9abc-0000000000e1';
    expect(ok('rebuild', [])).toEqual({ op: 'rebuild', storeId: null });
    expect(ok('rebuild', ['--store-id', S])).toEqual({ op: 'rebuild', storeId: S });
    expect(why('rebuild', ['--store-id', S.toUpperCase()])).toBe('bad-args');
    expect(why('rebuild', ['--store-id'])).toBe('bad-args');
    expect(why('rebuild', [S])).toBe('bad-args');
  });

  it('a verb B2 does not run is bad-args (recall-off ships in W2)', () => {
    expect(why('recall-off', ['claude-demo'])).toBe('bad-args');
    expect(why('frobnicate', [])).toBe('bad-args');
  });
});

describe('parseDuration, backupNameOf and restoreNameOk (spec 6.6, 8.4; P15)', () => {
  it("parseDuration reads upstream's units: d, w, m (30 days), y (365), any case and spacing; nothing else", () => {
    expect(libOps.parseDuration('90d')).toBe(90);
    expect(libOps.parseDuration('1w')).toBe(7);
    expect(libOps.parseDuration('3m')).toBe(90);
    expect(libOps.parseDuration('1y')).toBe(365);
    expect(libOps.parseDuration(' 2 WEEKS ')).toBe(14);
    expect(libOps.parseDuration('45 days')).toBe(45);
    for (const s of ['0d', '-5d', '5', '', 'd', '1.5d', 'ninety days']) expect(libOps.parseDuration(s), s).toBeNull();
    expect(libOps.PRUNE_FLOOR_DAYS).toBe(30);
  });
  it('backupNameOf is the UTC second (`YYYYMMDDTHHMMSSZ.db`, §8.4), and restoreNameOk accepts it', () => {
    expect(libOps.backupNameOf(Date.parse('2026-10-01T00:00:00.000Z'))).toBe('20261001T000000Z.db');
    expect(libOps.backupNameOf(Date.parse('2026-12-31T23:59:59.999Z'))).toBe('20261231T235959Z.db');
    expect(libOps.restoreNameOk(libOps.backupNameOf(Date.now()))).toBe(true);
    expect(libOps.restoreNameOk('pre-v12.db')).toBe(true);
    expect(() => libOps.backupNameOf(-1)).toThrow(TypeError);
  });
});

describe('decideOpDoor: which no-store answer a writing verb gets before any spawn (spec 8.3 "Which no-store answer", 8.4)', () => {
  const S = '0189abcd-1234-4678-9abc-0000000000e1';
  const absent = { state: 'absent' as const };
  const unreadable = { state: 'unreadable' as const };
  const id = { state: 'value' as const, value: S };
  /** decideCliStore's input, as Task 10's cliFactsOf(measureReach(home)) builds it. */
  const reach = (o: Partial<libOps.CliStoreFacts> = {}): libOps.CliStoreFacts => ({
    darwin: false, role: 'fleet', statSettled: true, dbDir: 'dir', shim: 'present',
    storeId: absent, pending: absent, writer: absent, db: 'absent', dbStoreId: absent,
    wal: false, shm: false, journalStoreDirs: [], backupsDb: [], ...o,
  });
  const stored = { storeId: id, db: 'present' as const, dbStoreId: id };
  it('macOS and a recorded server role are exit 9, whatever is on disk', () => {
    expect(libOps.decideOpDoor(reach({ darwin: true, ...stored }))).toEqual({ ok: false, exit: 9 });
    expect(libOps.decideOpDoor(reach({ role: 'server', ...stored }))).toEqual({ ok: false, exit: 9 });
    expect(libOps.decideOpDoor(reach({ role: 'server', shim: 'unmeasured' }))).toEqual({ ok: false, exit: 9 });
  });
  it('no shim, no store.id and no DB: never installed, exit 9, whatever else the history root holds', () => {
    expect(libOps.decideOpDoor(reach({ shim: 'absent' }))).toEqual({ ok: false, exit: 9 });
    expect(libOps.decideOpDoor(reach({ shim: 'absent', journalStoreDirs: [S] })), 'a journal directory is not a store').toEqual({ ok: false, exit: 9 });
  });
  it('a store.id or a DB with no shim is exit 2 writer-absent, never 9: a plain uninstall kept the data', () => {
    for (const o of [stored, { storeId: id }, { db: 'present' as const, dbStoreId: id }, { db: 'zero-byte' as const }]) {
      expect(libOps.decideOpDoor(reach({ shim: 'absent', ...o })), JSON.stringify(o)).toEqual({ ok: false, exit: 2, reason: 'writer-absent' });
    }
  });
  it('an unmeasured shim, store.id or DB, a dangling db/ or an unsettled stat is exit 5 with its own word, never read as absent (IV5)', () => {
    expect(libOps.decideOpDoor(reach({ shim: 'unmeasured' }))).toEqual({ ok: false, exit: 5, reason: 'store-unmeasured' });
    expect(libOps.decideOpDoor(reach({ shim: 'absent', storeId: unreadable }))).toEqual({ ok: false, exit: 5, reason: 'store-unmeasured' });
    expect(libOps.decideOpDoor(reach({ shim: 'absent', db: 'unmeasured' }))).toEqual({ ok: false, exit: 5, reason: 'store-unmeasured' });
    expect(libOps.decideOpDoor(reach({ shim: 'absent', dbDir: 'dangling' }))).toEqual({ ok: false, exit: 5, reason: 'store-root-dangling' });
    expect(libOps.decideOpDoor(reach({ shim: 'absent', statSettled: false }))).toEqual({ ok: false, exit: 5, reason: 'store-unreachable' });
  });
  it('a shim present goes on to the gate and the shim\'s own pass, with a store or not', () => {
    expect(libOps.decideOpDoor(reach())).toEqual({ ok: true });
    expect(libOps.decideOpDoor(reach(stored))).toEqual({ ok: true });
  });
});

describe("decideBind: the binding verbs' preconditions, unreadable never read as absent (spec 6.9, 8.4; C57, C58, C67 pure halves)", () => {
  const S = '0189abcd-1234-4678-9abc-0000000000e1';
  const T = '0189abcd-1234-4678-9abc-0000000000e2';
  const v = (value: string) => ({ state: 'value' as const, value });
  const absent = { state: 'absent' as const };
  const unreadable = { state: 'unreadable' as const };
  const facts = (o: Partial<libOps.BindFacts> = {}): libOps.BindFacts => ({
    role: 'fleet', dbDir: 'dir', storeId: absent, pending: absent, writer: absent, db: 'absent', dbStoreId: absent,
    wal: false, shm: false, journalStoreDirs: [], backupsDb: [],
    codeVersion: 1, storedVersion: absent, storeIdArg: null, journalDirs: [], backup: null, ...o,
  });
  const backup = (o: Partial<libOps.BindBackup> = {}): libOps.BindBackup =>
    ({ regular: true, storeId: v(S), userVersion: 1, integrityOk: true, ...o });
  const refused = (kind: 'adopt' | 'restore' | 'rebuild', o: Partial<libOps.BindFacts>) =>
    libOps.decideBind(kind, facts(o));
  /** history.db's own user_version, as Task 26's bindFactsOf measures it (storedVersionAt). */
  const ver = (value: number): libOps.Presence<number> => ({ state: 'value', value });
  /** A DB adopt can bind: present, with a readable store_id, at this build's version. */
  const adoptable = { db: 'present' as const, dbStoreId: v(S), storedVersion: ver(1) };

  it('C67: an unreadable store.id, pending marker or store.writer, or an unmeasured db/ or DB, is exit 5 store-unmeasured for every binding verb', () => {
    for (const kind of ['adopt', 'restore', 'rebuild'] as const) {
      for (const o of [{ storeId: unreadable }, { pending: unreadable }, { writer: unreadable }, { dbDir: 'unmeasured' as const }, { db: 'unmeasured' as const }]) {
        expect(refused(kind, o), `${kind} ${JSON.stringify(o)}`).toMatchObject({ ok: false, rc: 5, reason: 'store-unmeasured' });
      }
    }
    expect(refused('adopt', { db: 'present', dbStoreId: unreadable })).toMatchObject({ ok: false, rc: 5, reason: 'store-unmeasured' });
  });

  it('a dangling db/ is exit 5 store-root-dangling', () => {
    expect(refused('restore', { dbDir: 'dangling' })).toMatchObject({ ok: false, rc: 5, reason: 'store-root-dangling' });
  });

  it('adopt binds a present DB with a readable store_id and no store.id, at or below this build\'s version', () => {
    expect(libOps.decideBind('adopt', facts(adoptable))).toEqual({ ok: true, storeId: S });
    expect(libOps.decideBind('adopt', facts({ ...adoptable, pending: v(T) }))).toEqual({ ok: true, storeId: S });
    expect(libOps.decideBind('adopt', facts({ ...adoptable, codeVersion: 2 })), 'an older store: its migration is the writer\'s').toEqual({ ok: true, storeId: S });
  });

  it("adopt refuses a store newer than this build, and an unreadable user_version is exit 5 (G9; RB17: lib decides, the arm relays)", () => {
    const newer = refused('adopt', { ...adoptable, storedVersion: ver(2) });
    expect(newer).toMatchObject({ ok: false, rc: 2, reason: 'adopt-refused' });
    if (!newer.ok) expect(newer.detail).toBe('history.db is schema 2; this build knows 1: adopt it with the build that wrote it');
    for (const sv of [unreadable, absent]) {
      expect(refused('adopt', { ...adoptable, storedVersion: sv }), JSON.stringify(sv)).toMatchObject({ ok: false, rc: 5, reason: 'store-unmeasured' });
    }
    // The version is adopt's own fact: restore and rebuild never read it (their DB must be absent).
    expect(libOps.decideBind('restore', facts({ storedVersion: unreadable, backup: backup() }))).toEqual({ ok: true, storeId: S });
    expect(libOps.decideBind('rebuild', facts({ storedVersion: unreadable, storeId: v(S) }))).toEqual({ ok: true, storeId: S });
  });

  it('adopt refuses: store.id present (equal or different), no readable store_id, no DB, or its own pending marker', () => {
    for (const o of [
      { db: 'present' as const, dbStoreId: v(S), storeId: v(S) },
      { db: 'present' as const, dbStoreId: v(S), storeId: v(T) },
      { db: 'present' as const, dbStoreId: absent },
      { db: 'absent' as const },
      { db: 'zero-byte' as const },
      { db: 'present' as const, dbStoreId: v(S), pending: v(S) },
    ]) {
      expect(refused('adopt', o), JSON.stringify(o)).toMatchObject({ ok: false, rc: 2, reason: 'adopt-refused' });
    }
  });

  it('restore binds the backup onto a box with no DB, or whose store.id names the backup\'s store', () => {
    expect(libOps.decideBind('restore', facts({ backup: backup() }))).toEqual({ ok: true, storeId: S });
    expect(libOps.decideBind('restore', facts({ storeId: v(S), backup: backup() }))).toEqual({ ok: true, storeId: S });
    expect(libOps.decideBind('restore', facts({ journalStoreDirs: [S], backupsDb: ['20261001T000000Z.db'], backup: backup() })),
      'store-recoverable evidence is what a restore exists for').toEqual({ ok: true, storeId: S });
  });

  it('restore passes the pre-copy check with version and integrity not yet measured', () => {
    expect(libOps.decideBind('restore', facts({ backup: backup({ userVersion: null, integrityOk: null }) }))).toEqual({ ok: true, storeId: S });
  });

  it('restore refuses: a DB present, a leftover WAL, a non-regular or unnamed backup, an unreadable or foreign store_id, a newer schema, a failed integrity_check', () => {
    for (const o of [
      { db: 'present' as const, dbStoreId: v(S), backup: backup() },
      { db: 'zero-byte' as const, backup: backup() },
      { wal: true, backup: backup() },
      { shm: true, backup: backup() },
      { backup: null },
      { backup: backup({ regular: false }) },
      { backup: backup({ storeId: unreadable }) },
      { backup: backup({ storeId: absent }) },
      { backup: backup({ storeId: v('not-a-uuid') }) },
      { storeId: v(T), backup: backup() },
      { backup: backup({ userVersion: 2 }) },
      { backup: backup({ integrityOk: false }) },
    ]) {
      expect(refused('restore', o), JSON.stringify(o)).toMatchObject({ ok: false, rc: 2, reason: 'restore-refused' });
    }
  });

  it("rebuild's store_id: store.id's; else the one journal directory whose heads agree; else --store-id among several", () => {
    expect(libOps.decideBind('rebuild', facts({ storeId: v(S) }))).toEqual({ ok: true, storeId: S });
    expect(libOps.decideBind('rebuild', facts({ journalStoreDirs: [S], journalDirs: [{ storeId: S, headsAgree: true }] }))).toEqual({ ok: true, storeId: S });
    const two = { journalStoreDirs: [S, T], journalDirs: [{ storeId: S, headsAgree: true }, { storeId: T, headsAgree: true }] };
    expect(libOps.decideBind('rebuild', facts({ ...two, storeIdArg: T }))).toEqual({ ok: true, storeId: T });
    expect(libOps.decideBind('rebuild', facts({ ...two, storeId: v(T), storeIdArg: T }))).toEqual({ ok: true, storeId: T });
  });

  it('rebuild refuses: a DB, a leftover WAL, nothing naming a store, store.id against --store-id, several directories unnamed, a --store-id naming no directory, heads naming another store', () => {
    const two = { journalStoreDirs: [S, T], journalDirs: [{ storeId: S, headsAgree: true }, { storeId: T, headsAgree: true }] };
    for (const o of [
      { db: 'present' as const, dbStoreId: v(S), storeId: v(S) },
      { wal: true, storeId: v(S) },
      {},
      { ...two, storeId: v(S), storeIdArg: T },
      { ...two },
      { ...two, storeIdArg: '0189abcd-1234-4678-9abc-0000000000e3' },
      { journalStoreDirs: [S], journalDirs: [{ storeId: S, headsAgree: false }] },
      { journalStoreDirs: [S], journalDirs: [{ storeId: S, headsAgree: false }], storeIdArg: S },
    ]) {
      expect(refused('rebuild', o), JSON.stringify(o)).toMatchObject({ ok: false, rc: 2, reason: 'rebuild-refused' });
    }
  });

  it("rebuild's refusal names the candidate directories", () => {
    const r = libOps.decideBind('rebuild', facts({ journalStoreDirs: [S, T], journalDirs: [{ storeId: S, headsAgree: true }, { storeId: T, headsAgree: true }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detail).toContain(S);
      expect(r.detail).toContain(T);
    }
  });

  it('rebuild with an unlistable journal/ is exit 5 store-unmeasured', () => {
    expect(refused('rebuild', { journalStoreDirs: ['(unlistable)'] })).toMatchObject({ ok: false, rc: 5, reason: 'store-unmeasured' });
  });

  it('a kind outside BIND_KINDS is a programming error', () => {
    expect(() => libOps.decideBind('import' as 'adopt', facts())).toThrow(TypeError);
  });
});

describe('decideReparse: the preflight limits (spec 8.4, 11 L8; DM21, C62 pure halves)', () => {
  it('up to REPARSE_MAX_TARGETS runs; one more is reparse-too-many; any pruned span is span-pruned', () => {
    expect(libOps.decideReparse({ targets: libOps.REPARSE_MAX_TARGETS, prunedSpans: 0 })).toEqual({ ok: true });
    expect(libOps.decideReparse({ targets: 0, prunedSpans: 0 })).toEqual({ ok: true });
    expect(libOps.decideReparse({ targets: libOps.REPARSE_MAX_TARGETS + 1, prunedSpans: 0 })).toEqual({ ok: false, reason: 'reparse-too-many' });
    expect(libOps.decideReparse({ targets: 1, prunedSpans: 1 })).toEqual({ ok: false, reason: 'span-pruned' });
  });
});

// ===========================================================================
// W1-B2 Task 7: the recovery and repair decisions (spec §9.14, §9.6, §8.4
// doctor --repair; O56's planReplay half). Pure, on lib.mjs alone, except two
// cases that measure SQLite's own shadow tables and foreign_key_check rows on
// an in-memory database.
// ===========================================================================
const RP_STORE = '0189abcd-1234-4678-9abc-0000000000c1';
const RP_OTHER = '0189abcd-1234-4678-9abc-0000000000c2';
const RP_ID = 'claude-demo';
const RP_G = '0189abcd-1234-4678-9abc-0000000000c3';
const RP_S1 = '0189abcd-1234-4678-9abc-0000000000d1';   // a startup line's sid
const RP_C1 = '0189abcd-1234-4678-9abc-0000000000d2';   // a clear line's sid
const RP_S3 = '0189abcd-1234-4678-9abc-0000000000d3';   // a later-tick confirmation's sid
const RP_D1 = `${RP_ID}.1759312800000.4242.jsonl`;     // drained
const RP_D2 = `${RP_ID}.1759312900000.4242.jsonl`;     // held: no drained record
const RP_D3 = `${RP_ID}.1759313000000.4242.jsonl`;     // drained
const rpLine = (k: libReplay.JournalKind, t: number, f: Record<string, unknown>): string => libReplay.journalRecord(k, t, f);
const rpRec = (line: string): libReplay.JournalRecord => {
  const r = libReplay.parseJournalRecord(line);
  if (r.kind !== 'record') throw new Error(`fixture line reads back as ${r.kind}`);
  return r.rec;
};
const rpHead = (t: number, writer = '0a1b2c3d', store = RP_STORE): string => rpLine('head', t, { store_id: store, month: '2026-10', writer });
const rpStartup = { v: 1, ev: 'SessionStart', id: RP_ID, sid: RP_S1, src: 'startup', reg: RP_S1, gen: RP_G };
const rpClear = { v: 1, ev: 'SessionStart', id: RP_ID, sid: RP_C1, src: 'clear', gen: RP_G };
const rpRecall = { v: 1, ev: 'recall', id: RP_ID, cmd: 'grep', rc: 0, ms: 40 };
const rpFile = (name: string, lines: string[]) => ({ name, month: name.slice(0, 7), writer: name.slice(8, 16), lines });

/** One writer's month: a drained file holding a startup line S then a clear line C, both decided at drain; a
 *  held file (journaled, never drained); a tick before the step's start; a later-tick confirmation; a drained
 *  file holding a recall line; a redact record; a tick after the step's start; a bind. */
function rpJournal() {
  const kS = libReplay.eventKey(RP_D1, 1);
  const kC = libReplay.eventKey(RP_D1, 2);
  const kR = libReplay.eventKey(RP_D3, 1);
  const l = {
    head: rpHead(1000),
    fileD1: rpLine('file', 2000, { name: RP_D1 }),
    spS: rpLine('spool', 2000, { ord: 1, rec: rpStartup }),
    spC: rpLine('spool', 2000, { ord: 2, rec: rpClear }),
    vFamily: rpLine('verdict', 2100, { event_key: kS, kind: 'family', ccrc_id: RP_ID, generation: RP_G, project: 'demo', first_seen_ms: 2100 }),
    vConfS: rpLine('verdict', 2100, { event_key: kS, kind: 'epoch-confirmed', ccrc_id: RP_ID, generation: RP_G, cc_session_uuid: RP_S1, cause: 'startup', declared_by: 'hook', by: 'reg' }),
    vChainC: rpLine('verdict', 2100, { event_key: kC, kind: 'epoch-chained', ccrc_id: RP_ID, generation: RP_G, cc_session_uuid: RP_C1, cause: 'clear' }),
    vDrained1: rpLine('verdict', 2100, { event_key: 'none', kind: 'drained', file: RP_D1 }),
    fileD2: rpLine('file', 2500, { name: RP_D2 }),
    spHeld: rpLine('spool', 2500, { ord: 1, rec: { v: 1, ev: 'Stop', id: RP_ID } }),
    tickOld: rpLine('tick', 2900, { lag_ms: 800 }),
    vLater: rpLine('verdict', 3000, { event_key: 'none', kind: 'epoch-confirmed', ccrc_id: RP_ID, generation: RP_G, cc_session_uuid: RP_S3, cause: 'resume', declared_by: 'hook', by: 'later-tick' }),
    fileD3: rpLine('file', 3500, { name: RP_D3 }),
    spD3: rpLine('spool', 3500, { ord: 1, rec: rpRecall }),
    vDrained3: rpLine('verdict', 3600, { event_key: 'none', kind: 'drained', file: RP_D3 }),
    redact: rpLine('redact', 3700, { len: 40, sha256: 'a'.repeat(64) }),
    tickNew: rpLine('tick', 3800, { lag_ms: 1200 }),
    vBind: rpLine('verdict', 3900, { event_key: 'none', kind: 'bind', bind: 'restore', writer: '0a1b2c3d' }),
  };
  return { l, kS, kC, kR };
}

describe('RecoverCursor: the recovery step cursor grammar (spec 9.14; B4 adds export phases)', () => {
  it('RECOVER_PHASES is index, apply, reindex, frozen', () => {
    expect([...libReplay.RECOVER_PHASES]).toEqual(['index', 'apply', 'reindex']);
    expect(Object.isFrozen(libReplay.RECOVER_PHASES)).toBe(true);
  });
  it("round-trips each phase's form, with and without +pairs", () => {
    for (const s of ['index', 'index:2026-10.0a1b2c3d.jsonl:4096', 'apply:2026-09.0a1b2c3d.jsonl:0+pairs', 'apply+pairs', 'reindex', 'reindex:812', 'reindex:812+pairs']) {
      const c = libReplay.parseRecoverCursor(s);
      expect(c, s).not.toBeNull();
      expect(libReplay.formatRecoverCursor(c!), s).toBe(s);
    }
    expect(libReplay.parseRecoverCursor('apply:2026-10.0a1b2c3d.jsonl:96+pairs'))
      .toEqual({ phase: 'apply', file: '2026-10.0a1b2c3d.jsonl', offset: 96, blobId: null, pairsAdded: true });
  });
  it("a NULL cursor is the step's start", () => {
    expect(libReplay.parseRecoverCursor(null)).toEqual({ phase: 'index', file: null, offset: 0, blobId: null, pairsAdded: false });
  });
  it('anything else is null, never a guess', () => {
    for (const s of ['journal:120', 'index:2026-13.0a1b2c3d.jsonl:1', 'index:notes.jsonl:1', 'apply:2026-10.0a1b2c3d.jsonl:01', 'reindex:-1', 'export-blobs', '', 'index:2026-10.0a1b2c3d.jsonl:99999999999999999']) {
      expect(libReplay.parseRecoverCursor(s), s).toBeNull();
    }
    expect(() => libReplay.formatRecoverCursor({ phase: 'export-blobs', file: null, offset: 0, blobId: null, pairsAdded: false })).toThrow(TypeError);
  });
});

describe('orderJournalFiles: month, then head time, then name; overlapping files of one month merge (O56; spec 9.14)', () => {
  const f = (name: string, headT: number | null, lastT: number | null): libReplay.JournalFileFacts =>
    ({ name, month: name.slice(0, 7), writer: name.slice(8, 16), headT, lastT });
  it('O56 CONTROL: months in order, then head times; never the lexical order of the writer token', () => {
    expect(libReplay.orderJournalFiles([
      f('2026-10.00000000.jsonl', 5000, 6000), f('2026-10.ffffffff.jsonl', 1000, 1500), f('2026-09.77777777.jsonl', 10, 900),
    ])).toEqual([['2026-09.77777777.jsonl'], ['2026-10.ffffffff.jsonl'], ['2026-10.00000000.jsonl']]);
  });
  it('two writers whose time ranges overlap in one month are one group, the earlier head first', () => {
    expect(libReplay.orderJournalFiles([f('2026-10.0000000b.jsonl', 2000, 4000), f('2026-10.0000000a.jsonl', 1000, 3000)]))
      .toEqual([['2026-10.0000000a.jsonl', '2026-10.0000000b.jsonl']]);
  });
  it('a file with no head sorts last in its month, alone; another month never merges', () => {
    expect(libReplay.orderJournalFiles([f('2026-10.0000000c.jsonl', null, null), f('2026-10.0000000a.jsonl', 1000, 9000), f('2026-11.0000000a.jsonl', 100, 200)]))
      .toEqual([['2026-10.0000000a.jsonl'], ['2026-10.0000000c.jsonl'], ['2026-11.0000000a.jsonl']]);
  });
});

describe('planReplay: the journal apply order (O56 planReplay half; O48 order; spec 9.14)', () => {
  it('O56: S then C in one drained file replay in that order, each with its drain-time verdicts; a held file is skipped; a later-tick confirmation applies at its own position; redaction first', () => {
    const { l, kS, kC, kR } = rpJournal();
    const actions = libReplay.planReplay({ storeId: RP_STORE, files: [rpFile('2026-10.0a1b2c3d.jsonl', Object.values(l))], ticksAfter: 3000, ticksBefore: 3900 });
    expect(actions).toEqual([
      { do: 'redact', len: 40, sha256: 'a'.repeat(64), t: 3700 },
      { do: 'file', name: RP_D1, t: 2000 },
      { do: 'receipt', key: kS, ord: 1, rec: rpStartup, recvMs: 2000, verdicts: [rpRec(l.vFamily), rpRec(l.vConfS)] },
      { do: 'receipt', key: kC, ord: 2, rec: rpClear, recvMs: 2000, verdicts: [rpRec(l.vChainC)] },
      { do: 'file', name: RP_D2, t: 2500 },
      { do: 'skip-undrained', file: RP_D2 },
      { do: 'verdict', rec: rpRec(l.vLater) },
      { do: 'file', name: RP_D3, t: 3500 },
      { do: 'receipt', key: kR, ord: 1, rec: rpRecall, recvMs: 3500, verdicts: [] },
      { do: 'tick', t: 3800, lagMs: 1200 },
    ]);
  });

  it('O56: two writers of one month apply the earlier head first, and a tie in time goes to that file', () => {
    const DA = `${RP_ID}.1759313100000.4242.jsonl`;
    const DB = `${RP_ID}.1759313200000.4242.jsonl`;
    const a = rpFile('2026-10.ffffffff.jsonl', [
      rpHead(1000, 'ffffffff'), rpLine('file', 5000, { name: DA }), rpLine('spool', 5000, { ord: 1, rec: rpRecall }),
      rpLine('verdict', 5000, { event_key: 'none', kind: 'drained', file: DA }),
    ]);
    const b = rpFile('2026-10.00000000.jsonl', [
      rpHead(5000, '00000000'), rpLine('file', 5000, { name: DB }), rpLine('spool', 5000, { ord: 1, rec: rpRecall }),
      rpLine('verdict', 5000, { event_key: 'none', kind: 'drained', file: DB }),
    ]);
    const order = libReplay.planReplay({ storeId: RP_STORE, files: [b, a], ticksAfter: 0 })
      .flatMap((x) => (x.do === 'file' ? [`file ${x.name}`] : x.do === 'receipt' ? [`receipt ${x.key}`] : []));
    expect(order).toEqual([`file ${DA}`, `receipt ${libReplay.eventKey(DA, 1)}`, `file ${DB}`, `receipt ${libReplay.eventKey(DB, 1)}`]);
  });

  it('two writers whose times overlap merge by record time, each file in its own order', () => {
    const X1 = `${RP_ID}.1759313300000.4242.jsonl`;
    const X2 = `${RP_ID}.1759313400000.4242.jsonl`;
    const Y = `${RP_ID}.1759313500000.4242.jsonl`;
    const block = (name: string, t: number): string[] => [
      rpLine('file', t, { name }), rpLine('spool', t, { ord: 1, rec: rpRecall }), rpLine('verdict', t + 50, { event_key: 'none', kind: 'drained', file: name }),
    ];
    const x = rpFile('2026-10.0000000a.jsonl', [rpHead(1000, '0000000a'), ...block(X1, 1100), ...block(X2, 3100)]);
    const y = rpFile('2026-10.0000000b.jsonl', [rpHead(2000, '0000000b'), ...block(Y, 2100)]);
    const files = libReplay.planReplay({ storeId: RP_STORE, files: [x, y], ticksAfter: 0 })
      .filter((v): v is Extract<libReplay.ReplayAction, { do: 'file' }> => v.do === 'file').map((v) => v.name);
    expect(files).toEqual([X1, Y, X2]);
  });

  it('a file whose head names another store is skipped whole, counted once', () => {
    const foreign = rpFile('2026-10.0b0b0b0b.jsonl', [
      rpHead(1000, '0b0b0b0b', RP_OTHER), rpLine('redact', 1100, { len: 40, sha256: 'b'.repeat(64) }), rpLine('tick', 1200, { lag_ms: 5 }),
    ]);
    expect(libReplay.planReplay({ storeId: RP_STORE, files: [foreign], ticksAfter: 0 })).toEqual([{ do: 'skip', counter: 'journal_head_mismatch' }]);
  });

  it('a torn line, an unknown k and a v of 2 are skipped and counted; replay never throws', () => {
    const f = rpFile('2026-10.0a1b2c3d.jsonl', [rpHead(1000), '{"v":1,"k":"tick"', '{"v":1,"k":"nope","t":5}', '{"v":2,"k":"tick","t":5,"lag_ms":null}', '']);
    expect(libReplay.planReplay({ storeId: RP_STORE, files: [f], ticksAfter: 0 })).toEqual([
      { do: 'skip', counter: 'journal_line_malformed' },
      { do: 'skip', counter: 'journal_record_unknown' },
      { do: 'skip', counter: 'journal_line_malformed' },
    ]);
  });

  it("a tick at or after ticksBefore (the step's bind ms) is a recovery pass's own record: never applied (NEW history-replay-skips-post-bind-ticks)", () => {
    const { l } = rpJournal();
    const ticks = (ticksBefore: number | null) => libReplay.planReplay({ storeId: RP_STORE, files: [rpFile('2026-10.0a1b2c3d.jsonl', Object.values(l))], ticksAfter: 3000, ticksBefore })
      .filter((x) => x.do === 'tick');
    expect(ticks(3801)).toEqual([{ do: 'tick', t: 3800, lagMs: 1200 }]);
    expect(ticks(3800)).toEqual([]);
    expect(ticks(null), 'null sets no upper bound').toEqual([{ do: 'tick', t: 3800, lagMs: 1200 }]);
  });

  it('a block journaled twice gives two receipts with one key, and a re-appended verdict is indexed once', () => {
    const { l, kS } = rpJournal();
    const f = rpFile('2026-10.0a1b2c3d.jsonl', [l.head, l.fileD1, l.spS, l.fileD1, l.spS, l.vConfS, l.vConfS, l.vDrained1]);
    const receipts = libReplay.planReplay({ storeId: RP_STORE, files: [f], ticksAfter: 0 }).filter((x) => x.do === 'receipt');
    expect(receipts).toHaveLength(2);
    for (const r of receipts) expect(r).toMatchObject({ key: kS, verdicts: [rpRec(l.vConfS)] });
  });
});

describe('replayStep: one journal line, one decision, never a throw (spec 9.14 "Unknown records")', () => {
  const state = (o: Partial<libReplay.ReplayState> = {}): libReplay.ReplayState =>
    ({ storeId: RP_STORE, file: null, recvMs: 0, drained: new Set([RP_D1]), verdictsByKey: new Map(), ticksAfter: 0, ticksBefore: null, ...o });
  const read = (line: string): libReplay.JournalRead => libReplay.parseJournalRecord(line);

  it('a torn line or a newer v counts journal_line_malformed; an unknown k journal_record_unknown', () => {
    expect(libReplay.replayStep(state(), read('{"v":1,"k":"tick"')).actions).toEqual([{ do: 'skip', counter: 'journal_line_malformed' }]);
    expect(libReplay.replayStep(state(), read('{"v":2,"k":"tick","t":5,"lag_ms":null}')).actions).toEqual([{ do: 'skip', counter: 'journal_line_malformed' }]);
    expect(libReplay.replayStep(state(), read('{"v":1,"k":"nope","t":5}')).actions).toEqual([{ do: 'skip', counter: 'journal_record_unknown' }]);
  });
  it('a head naming another store counts journal_head_mismatch; any head clears the draining file', () => {
    expect(libReplay.replayStep(state({ file: RP_D1 }), read(rpHead(1, '0a1b2c3d', RP_OTHER))))
      .toEqual({ state: state({ file: null }), actions: [{ do: 'skip', counter: 'journal_head_mismatch' }] });
    expect(libReplay.replayStep(state({ file: RP_D1 }), read(rpHead(1)))).toEqual({ state: state({ file: null }), actions: [] });
  });
  it('a file record sets the draining name and its receive time', () => {
    const r = libReplay.replayStep(state(), read(rpLine('file', 2000, { name: RP_D1 })));
    expect(r.state).toMatchObject({ file: RP_D1, recvMs: 2000 });
    expect(r.actions).toEqual([{ do: 'file', name: RP_D1, t: 2000 }]);
  });
  it('a spool record of a drained file is a receipt with its drain-time verdicts in journal order; of an undrained file, skip-undrained; with no file before it, malformed', () => {
    const { l, kS } = rpJournal();
    const vs = [rpRec(l.vFamily), rpRec(l.vConfS)];
    const s = state({ file: RP_D1, recvMs: 2000, verdictsByKey: new Map([[kS, vs]]) });
    expect(libReplay.replayStep(s, read(l.spS)).actions).toEqual([{ do: 'receipt', key: kS, ord: 1, rec: rpStartup, recvMs: 2000, verdicts: vs }]);
    expect(libReplay.replayStep(state({ file: RP_D2 }), read(l.spHeld)).actions).toEqual([{ do: 'skip-undrained', file: RP_D2 }]);
    expect(libReplay.replayStep(state(), read(l.spS)).actions).toEqual([{ do: 'skip', counter: 'journal_line_malformed' }]);
  });
  it('bind and drained verdicts apply nothing; a verdict keyed to a line waits for it; a verdict keyed none applies here', () => {
    const { l } = rpJournal();
    expect(libReplay.replayStep(state(), read(l.vBind)).actions).toEqual([]);
    expect(libReplay.replayStep(state(), read(l.vDrained1)).actions).toEqual([]);
    expect(libReplay.replayStep(state(), read(l.vConfS)).actions).toEqual([]);
    expect(libReplay.replayStep(state(), read(l.vLater)).actions).toEqual([{ do: 'verdict', rec: rpRec(l.vLater) }]);
    expect(libReplay.replayStep(state(), read(l.redact)).actions).toEqual([]);
  });
  it('a tick at or before ticksAfter is already in the store; a later one is applied', () => {
    const { l } = rpJournal();
    expect(libReplay.replayStep(state({ ticksAfter: 2900 }), read(l.tickOld)).actions).toEqual([]);
    expect(libReplay.replayStep(state({ ticksAfter: 2899 }), read(l.tickOld)).actions).toEqual([{ do: 'tick', t: 2900, lagMs: 800 }]);
  });
  it("a tick at or after ticksBefore is the recovery pass's own; one before it is applied", () => {
    const { l } = rpJournal();
    expect(libReplay.replayStep(state({ ticksBefore: 2900 }), read(l.tickOld)).actions).toEqual([]);
    expect(libReplay.replayStep(state({ ticksBefore: 2901 }), read(l.tickOld)).actions).toEqual([{ do: 'tick', t: 2900, lagMs: 800 }]);
    expect(libReplay.replayStep(state({ ticksBefore: undefined }), read(l.tickOld)).actions, 'an absent bound bounds nothing')
      .toEqual([{ do: 'tick', t: 2900, lagMs: 800 }]);
  });
});

describe('indexRecord: the first pass indexes redact pairs, drain-time verdicts and drained files (spec 9.14)', () => {
  it('answers only for those three', () => {
    const { l, kS } = rpJournal();
    const read = (line: string): libReplay.JournalRead => libReplay.parseJournalRecord(line);
    expect(libReplay.indexRecord(read(l.redact))).toEqual({ redact: { len: 40, sha256: 'a'.repeat(64), t: 3700 } });
    expect(libReplay.indexRecord(read(l.vDrained1))).toEqual({ drainedFile: RP_D1 });
    expect(libReplay.indexRecord(read(l.vFamily))).toEqual({ verdictKey: kS });
    for (const x of [l.vLater, l.vBind, l.spS, l.fileD1, l.head, l.tickNew, '{"v":1']) expect(libReplay.indexRecord(read(x)), x).toEqual({});
  });
});

describe('nextUnmovedTicks: what recovery-stalled counts (spec 9.6, 9.14)', () => {
  it('a moved cursor resets; a hold (the floor, history-off) keeps the count; otherwise one more', () => {
    expect(libReplay.nextUnmovedTicks({ prev: 14, moved: true, held: false })).toBe(0);
    expect(libReplay.nextUnmovedTicks({ prev: 14, moved: false, held: true })).toBe(14);
    expect(libReplay.nextUnmovedTicks({ prev: 14, moved: false, held: false })).toBe(15);
  });
});

describe('diffForeignKeys: a repair refuses NEW violations only (spec 8.4 doctor --repair; P21; C61 pure half)', () => {
  const row = (table: string, rowid: number | null, parent = 'p', fkid = 0): libReplay.FkRow => ({ table, rowid, parent, fkid });
  it('rows in the baseline are pre-existing; rows outside it are new', () => {
    expect(libReplay.diffForeignKeys([row('c', 1)], [row('c', 1), row('c', 2)])).toEqual({ newViolations: [row('c', 2)], preExisting: 1 });
    expect(libReplay.diffForeignKeys([row('c', 1)], [row('c', 1)])).toEqual({ newViolations: [], preExisting: 1 });
    expect(libReplay.diffForeignKeys([], [])).toEqual({ newViolations: [], preExisting: 0 });
  });
  it('the key is (table, rowid, parent, fkid): any part differing is a different violation', () => {
    expect(libReplay.diffForeignKeys([row('c', 1)], [row('c', 1, 'q')]).newViolations).toHaveLength(1);
    expect(libReplay.diffForeignKeys([row('c', 1)], [row('c', 1, 'p', 1)]).newViolations).toHaveLength(1);
    expect(libReplay.diffForeignKeys([row('c', null)], [row('c', null)]).newViolations).toHaveLength(0);
  });
  it("SQLite's foreign_key_check rows have FkRow's shape, and the diff reads them", () => {
    const db = new ReplaySqlite(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p INTEGER REFERENCES p(id))');
      db.exec('INSERT INTO c (id, p) VALUES (1, 7)');
      const before = db.prepare('PRAGMA foreign_key_check').all() as unknown as libReplay.FkRow[];
      expect(before).toEqual([row('c', 1)]);
      db.exec('INSERT INTO c (id, p) VALUES (2, 8)');
      const after = db.prepare('PRAGMA foreign_key_check').all() as unknown as libReplay.FkRow[];
      expect(libReplay.diffForeignKeys(before, after)).toEqual({ newViolations: [row('c', 2)], preExisting: 1 });
    } finally {
      db.close();
    }
  });
});

describe('FTS self-heal checks: ftsTablesHealthy over per-table shadows (spec 8.4 doctor --repair; P24)', () => {
  const measure = (db: InstanceType<typeof ReplaySqlite>) => {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as { name: string }[]).map((r) => r.name));
    const cols = (t: string): string[] => (db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as unknown as { name: string }[]).map((r) => r.name);
    return { tables, columns: { blobs_fts: tables.has('blobs_fts') ? cols('blobs_fts') : [], nodes_fts: tables.has('nodes_fts') ? cols('nodes_fts') : [] } };
  };
  it("the per-table shadow list is exactly what SQLite makes for B1's FTS_DDL: the contentless blobs_fts has no _content", () => {
    const db = new ReplaySqlite(':memory:');
    try {
      for (const sql of replayStore.FTS_DDL) db.exec(sql);
      const m = measure(db);
      for (const t of ['blobs_fts', 'nodes_fts'] as const) {
        expect([...m.tables].filter((n) => n.startsWith(`${t}_`)).sort(), t).toEqual([...libReplay.FTS_SHADOWS[t]].sort());
      }
      expect(libReplay.FTS_SHADOWS.blobs_fts).not.toContain('blobs_fts_content');
      expect(libReplay.ftsTablesHealthy(m)).toEqual({ blobs: true, nodes: true });
    } finally {
      db.close();
    }
  });
  it('a missing table, a missing shadow or a missing column reads broken, table by table', () => {
    const db = new ReplaySqlite(':memory:');
    try {
      for (const sql of replayStore.FTS_DDL) db.exec(sql);
      const m = measure(db);
      const without = (name: string) => ({ ...m, tables: new Set([...m.tables].filter((n) => n !== name)) });
      expect(libReplay.ftsTablesHealthy(without('blobs_fts'))).toEqual({ blobs: false, nodes: true });
      expect(libReplay.ftsTablesHealthy(without('blobs_fts_idx'))).toEqual({ blobs: false, nodes: true });
      expect(libReplay.ftsTablesHealthy(without('nodes_fts_content'))).toEqual({ blobs: true, nodes: false });
      expect(libReplay.ftsTablesHealthy({ ...m, columns: { ...m.columns, nodes_fts: ['gist', 'topics'] } })).toEqual({ blobs: true, nodes: false });
      expect(libReplay.ftsTablesHealthy({ tables: new Set(), columns: {} })).toEqual({ blobs: false, nodes: false });
    } finally {
      db.close();
    }
  });
});

// ── W1-B2 Task 7A: the substring belt (spec §8.3 layer 4 and layer 1's glue windows, §6.2 "The belt"; rev 3.5; O59) ──
// Coordinator rulings 4019 and 4043, reviews 344 F9 and 351. Every fixture value is minted at runtime. The leak shapes
// are the ones B1 measured (review 351; fr2's "For the coordinator" items 1-2): a stray `ESC[` whose final byte takes a
// value's second character behind a mid-span `ESC[0m` (31 of 32 characters one term; 27 when a closing sequence splits
// off the last four), and a value glued to a neighbour by `_`, `-` or a letter. A "belt leak" is a stretch of
// beltWidth(value) consecutive characters of the value, ASCII case folded (unicode61 folds case).
describe('the substring belt (W1-B2 Task 7A; spec §8.3 layer 4, §6.2; O59 lib half)', () => {
  const ESC = String.fromCharCode(27);
  const BS = String.fromCharCode(92);
  const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const alnum = (n: number): string => Array.from(historyCrypto.randomBytes(n), (b) => AL[b % 62]!).join('');
  /** 32 characters: `Q`, then `P` (a CSI final byte a stray `ESC[` takes), then 29 more, then a digit (review 351's shape).
   *  Offsets 9, 19 and 29 are `e`, `A` and `o`, each with a precomposed acute form (the precomposed shape, finding R16). */
  const mint = (): string => `QP${alnum(7)}e${alnum(9)}A${alnum(9)}o${alnum(1)}7`;
  const ACUTE = String.fromCharCode(0x301);
  /** The longest stretch `out` shares with `v`, case folded and with every nonspacing mark dropped. That is unicode61's
   *  fold for every character these fixtures print (U+0301 and precomposed acute letters); beltFold's own case pins the
   *  exact fold over every code point. */
  const shared = (out: string, v: string): number => {
    const o = out.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
    const w = v.toLowerCase();
    let best = 0;
    for (let i = 0; i < w.length; i += 1) for (let j = i + best + 1; j <= w.length && o.includes(w.slice(i, j)); j += 1) best = j - i;
    return best;
  };
  const strip = (s: string): string => s.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g'), '');
  const decoded = (s: string): string => s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  const shapes = (v: string): Array<[string, string]> => [
    ['a stray ESC[ behind a mid-span ESC[0m takes the second character (31 of 32)', `w ${v[0]}${ESC}[0m${ESC}[${v.slice(1)} y`],
    ['the same, a closing ESC[0m before the last four (27 of 32)', `w ${v[0]}${ESC}[0m${ESC}[${v.slice(1, 28)}${ESC}[0m${v.slice(28)} y`],
    ['glued to letters with no separator', `note ab${v}cd end`],
    ['printed in upper case', `note ${v.toUpperCase()} end`],
    ['glued by _', `note ab_${v}_tail end`],
    ['glued by - on both sides', `note ab-${v}-tail end`],
    ['three stray ESC[ each take a character', `note ${v.slice(0, 8)}${ESC}[${v.slice(8, 18)}${ESC}[${v.slice(18)} end`],
    ['a combining mark after every tenth character', `note ${[...v].map((c, i) => (i % 10 === 9 ? `${c}${ACUTE}` : c)).join('')} end`],
    // é, Á and ó as one code point each: unicode61 folds each to its letter, so the term holds the value whole.
    ['every tenth character precomposed with an acute, glued by letters', `note ab${[...v].map((c, i) => (i % 10 === 9 ? `${c}${ACUTE}`.normalize('NFC') : c)).join('')}cd end`],
  ];
  const beltIdx = (values: string[]): libRedact.PairIndex =>
    libRedact.makePairIndex(libRedact.secretPairs(values).pairs, libRedact.makeBelt(libRedact.beltUnits(values)));
  const pairIdx = (values: string[]): libRedact.PairIndex => libRedact.makePairIndex(libRedact.secretPairs(values).pairs);
  // Each 14-character filler supplies exactly one seeded gram, and lexical order agrees with its padded base-36 suffix.
  const fillBelt = (n: number): string[] => Array.from({ length: n }, (_, i) => `aB1cD${i.toString(36).padStart(9, '0')}`);
  const repeatedCandidate = () => {
    const cycle = 'zZ1aB2cD3eF4';
    return `${cycle}${cycle}${cycle}${cycle[0]}`;
  };

  it('CONTROL: with pairs alone, the measured shapes still leak 31, 27, 32 and 32 characters', () => {
    const v = mint();
    const idx = pairIdx([v]);
    expect(shapes(v).slice(0, 4).map(([, t]) => shared(libRedact.entryIndexText(t, idx), v))).toEqual([31, 27, 32, 32]);
  });

  it.each(shapes('x'.repeat(32)).map(([n]) => n))('%s: no index text, field or final string keeps a belt-width stretch', (name) => {
    const v = mint();
    const text = new Map(shapes(v)).get(name)!;
    const idx = beltIdx([v]);
    const w = libRedact.beltWidth(v);
    const field = libRedact.redactField(text, idx);
    for (const out of [libRedact.entryIndexText(text, idx), field, strip(field), libRedact.redactFinal(text, idx)]) {
      expect(shared(out, v), JSON.stringify(out)).toBeLessThan(w);
    }
    expect(field).toContain(libRedact.REDACTED_MARK);
  });

  it('the measured shapes give exactly these texts', () => {
    const v = mint();
    const idx = beltIdx([v]);
    const M = libRedact.REDACTED_MARK;
    const [two, close, letters, , under, dash] = shapes(v).map(([, t]) => libRedact.entryIndexText(t, idx));
    expect(two, 'the run from the sequence\'s parameters on is one mark').toBe(`w ${v[0]}${ESC}[${M} y`);
    expect(close).toBe(`w ${v[0]}${ESC}[${M} y`);
    expect(letters, 'a letter-glued value: its whole run').toBe(`note ${M} end`);
    expect(under, 'a _-glued value: layer 1\'s glue window, its neighbours kept').toBe(`note ab_${M}_tail end`);
    expect(dash).toBe(`note ab-${M}-tail end`);
  });

  it('a field: a value split by JSON escapes into pieces under its width is masked through the decoded reading', () => {
    const v = mint();
    const split = [...v].map((c, i) => (i % 8 === 7 ? `${BS}u00${c.charCodeAt(0).toString(16)}` : c)).join('');
    const text = `cfg "${split}" end`;
    expect(shared(text, v), 'CONTROL: no literal piece reaches the width').toBeLessThan(libRedact.beltWidth(v));
    expect(shared(decoded(libRedact.redactField(text, pairIdx([v]))), v), 'CONTROL: decoded, the three layers show it whole').toBe(32);
    expect(libRedact.redactField(text, beltIdx([v]))).toBe(`cfg "${libRedact.REDACTED_MARK}" end`);
  });

  it('a field: a letter-glued value split by colour codes into pieces under its width is masked through the stripped reading', () => {
    const v = mint();
    const text = `ok ab${v.slice(0, 10)}${ESC}[1m${v.slice(10, 20)}${ESC}[0m${v.slice(20)} end`;
    expect(shared(strip(libRedact.redactField(text, pairIdx([v]))), v), 'CONTROL: a terminal shows the value whole').toBe(32);
    expect(libRedact.redactField(text, beltIdx([v]))).toBe(`ok ${libRedact.REDACTED_MARK} end`);
  });

  it('the glue windows need no value: a pair alone (a rotated value, a sessions.json hash) masks its value glued by _ or -', () => {
    const tok = alnum(43);
    const idx = libRedact.makePairIndex([{ len: 43, sha256: historyCrypto.createHash('sha256').update(tok).digest('hex') }]);
    expect(libRedact.redactField(`cookie sess_${tok}-x end`, idx)).toBe(`cookie sess_${libRedact.REDACTED_MARK}-x end`);
    expect(libRedact.redactField(`cookie ${tok}_v2 end`, idx)).toBe(`cookie ${libRedact.REDACTED_MARK}_v2 end`);
    expect(libRedact.redactField(`cookie x${tok} end`, idx), 'glued by a letter: layer 4\'s, never the windows\'').toBe(`cookie x${tok} end`);
  });

  it('the glue windows are bounded: a 1 MiB run of _a with a pair loaded is marked whole, and a rule of dashes is no window', () => {
    const idx = pairIdx([alnum(40)]);
    const t0 = Date.now();
    // A boolean, never the string: a red must not print a 1 MiB diff (ruling R-runner; it overflowed the runner's buffer).
    const whole = libRedact.redactField('_a'.repeat(1 << 19), idx);
    expect(whole === libRedact.REDACTED_MARK, `a 1 MiB run is marked whole (got ${whole.length} characters)`).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(libRedact.redactField(`${'-'.repeat(80)}\n`, idx)).toBe(`${'-'.repeat(80)}\n`);
  });

  it('the glue windows are bounded in hashed bytes: 1 MiB of runs twice a 16 KiB unit\'s length is replaced whole, in time', () => {
    // Spec §8.3 (review R69): a run hashes at most GLUE_HASH_BYTES_FLOOR + 4 × n window characters, each window charged
    // its length before it is hashed. Under the hash count alone each 32 KiB run hashes 64 + 8,192 windows of 16 KiB:
    // 4.2 s of sha256 for this text on Node 24.14.1 (measured), against 5 ms with the byte budget.
    const idx = pairIdx([alnum(16 * 1024)]);
    const text = Array.from({ length: 32 }, () => 'a_'.repeat(16 * 1024)).join(' ');
    const t0 = Date.now();
    const out = libRedact.redactField(text, idx);
    const ms = Date.now() - t0;
    // A boolean, never the string: a red must not print a 1 MiB diff (ruling R-runner).
    expect(out.split(' ').every((w) => w === libRedact.REDACTED_MARK), `every run is replaced whole (got ${out.length} characters)`).toBe(true);
    expect(ms, 'the spec\'s bound').toBeLessThan(10_000);
    // The tighter bound the byte budget keeps (B1's layers 1-3 take 23 ms over this text, measured), and the one the
    // no-bytes mutant reds: a count bound alone spends seconds hashing.
    expect(ms, 'the hashed-byte budget').toBeLessThan(2_000);
  });

  it('beltWidth: 72 bits of the unit\'s folded alphabet, at most its length, rounded down to the ladder', () => {
    expect(libRedact.BELT_K_LADDER).toEqual([12, 14, 16, 18, 21]);
    expect(libRedact.beltWidth(historyCrypto.randomBytes(32).toString('hex'))).toBe(18);
    expect(libRedact.beltWidth(mint())).toBe(14);
    // Ends in `0_-`: its folded alphabet is always 38 (a draw without a digit, `_` or `-` answers 16, finding R12).
    expect(libRedact.beltWidth(`${historyCrypto.randomBytes(27).toString('base64url')}0_-`)).toBe(14);
    expect(libRedact.beltWidth('7771234567890123456789')).toBe(21);
    expect(libRedact.beltWidth(alnum(12))).toBe(12);
  });

  it('publishes the exact frozen belt contract Task 7B and Task 14 consume', () => {
    expect(libRedact.BELT_VERSION).toBe(1);
    expect(libRedact.BELT_BITS).toBe(72);
    expect(libRedact.BELT_K_LADDER).toEqual([12, 14, 16, 18, 21]);
    expect(libRedact.BELT_GRAMS_MAX).toBe(65536);
    expect(libRedact.BELT_META).toBe('fts_belt');
    expect(libRedact.BELT_NODES_STEP).toBe('nodes-belt');
    expect(libRedact.REDACT_SOURCES_META).toBe('redact_sources');
    expect(libRedact.BELT_COUNTERS).toEqual({ overflow: 'redact_belt_overflow', generations: 'redact_belt_generations' });
    expect(Object.isFrozen(libRedact.BELT_K_LADDER)).toBe(true);
    expect(Object.isFrozen(libRedact.BELT_COUNTERS)).toBe(true);
  });

  it('makeBelt gives Task 14 sorted, deduplicated admitted texts and excludes a unit that overflowed', () => {
    const admitted = fillBelt(libRedact.BELT_GRAMS_MAX);
    const overflowed = `zZ1aB2cD${'0'.repeat(6)}`;
    const belt = libRedact.makeBelt([overflowed, admitted[2]!, ...admitted, admitted[2]!]);
    expect(belt.grams).toBe(libRedact.BELT_GRAMS_MAX);
    expect(belt.overflow).toBe(1);
    expect(belt.texts).toEqual(admitted);
  });

  it('counts stored seed grams at the cap, admitting a repeated unit whose 24 windows add only 12 grams', () => {
    const candidate = repeatedCandidate();
    const single = libRedact.makeBelt([candidate]);
    expect(candidate.length - libRedact.beltWidth(candidate) + 1, 'the possible windows').toBe(24);
    expect(single.grams, 'the stored seed grams').toBe(12);
    const filler = fillBelt(libRedact.BELT_GRAMS_MAX - 15);
    const belt = libRedact.makeBelt([...filler, candidate]);
    expect(belt.grams).toBe(libRedact.BELT_GRAMS_MAX - 3);
    expect(belt.overflow).toBe(0);
    expect(belt.texts).toContain(candidate);
    const idx = libRedact.makePairIndex(libRedact.secretPairs([candidate]).pairs, belt);
    expect(libRedact.redactField(`note ab${candidate}cd end`, idx)).toBe(`note ${libRedact.REDACTED_MARK} end`);
  });

  it('fails closed for a belt RangeError and lets a non-RangeError belt defect escape', () => {
    const belt = libRedact.makeBelt([repeatedCandidate()]);
    const idx = libRedact.makePairIndex([], belt);
    const field = 'unrelated-public-field';
    vi.stubGlobal('Int32Array', class { constructor() { throw new RangeError('belt allocation'); } });
    try {
      expect(libRedact.redactField(field, idx)).toBe(libRedact.REDACTED_MARK);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('Int32Array', class { constructor() { throw new Error('belt defect'); } });
    try {
      expect(() => libRedact.redactField(field, idx)).toThrow('belt defect');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the seed rule: a wordy unit and a padding run seed nothing, so ordinary words stay; layer 1 still takes the whole value', () => {
    const word = 'zq_project_name_production_main';
    const pad = `AAAAAAAAAAAAAAAAAAAA${alnum(4)}`;
    const idx = beltIdx([word, pad]);
    expect(libRedact.redactField('see other_project_name_production_main here', idx)).toBe('see other_project_name_production_main here');
    expect(libRedact.redactField(`pad ${'A'.repeat(24)} here`, idx)).toBe(`pad ${'A'.repeat(24)} here`);
    expect(libRedact.redactField(`see ${word} here`, idx)).toBe(`see ${libRedact.REDACTED_MARK} here`);
  });

  it('the seed rule\'s price: a one-case [a-z0-9] unit is masked wherever a print holds a digit, and a digit-free K-window alone is the named residual', () => {
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const pick = (s: string): string => s[historyCrypto.randomBytes(1)[0]! % s.length]!;
    // A digit at every sixth offset: every 14-wide gram holds two, so every gram seeds.
    const one = Array.from({ length: 32 }, (_, i) => (i % 6 === 5 ? pick('0123456789') : pick(lower))).join('');
    const idx = beltIdx([one]);
    expect(libRedact.beltWidth(one), 'CONTROL: 36 folded characters, 72 bits in 14').toBe(14);
    expect(libRedact.redactField(`note ab${one}cd end`, idx), 'glued by letters').toBe(`note ${libRedact.REDACTED_MARK} end`);
    expect(libRedact.redactField(`note ${one.slice(3, 17).toUpperCase()} end`, idx), 'a partial print, upper-cased').toBe(`note ${libRedact.REDACTED_MARK} end`);
    // Fourteen letters, then a digit: the first window holds no digit and one case, so it seeds nothing (spec §8.3
    // "What it cannot see"). A change to the seed rule reds here and must restate the price.
    const res = `${Array.from({ length: 14 }, () => pick(lower)).join('')}7${Array.from({ length: 17 }, () => pick(lower)).join('')}`;
    expect(libRedact.redactField(`note ab${res.slice(0, 14)}cd end`, beltIdx([res])), 'the residual').toBe(`note ab${res.slice(0, 14)}cd end`);
  });

  it('no false positive: 1 MiB of prose, code, hashes and base64, and this repository\'s README, are unchanged by 50 random values', () => {
    const vals = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? historyCrypto.randomBytes(32).toString('hex') : historyCrypto.randomBytes(30).toString('base64url')));
    const W = ['the', 'commit', 'function', 'const x = f(y);', 'deadbeef', 'x_y-z', 'README.md', '=>', 'claude-opus', '\n'];
    let text = '';
    for (let i = 0; text.length < 1 << 20; i += 1) {
      text += `${W[i % W.length]} `;
      if (i % 7 === 0) text += `${historyCrypto.randomBytes(20).toString('hex')} `;
      if (i % 11 === 0) text += `${historyCrypto.randomBytes(24).toString('base64')} `;
    }
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
    for (const t of [text, readme]) {
      expect(libRedact.redactField(t, beltIdx(vals)) === libRedact.redactField(t, pairIdx(vals))).toBe(true);
      expect(libRedact.entryIndexText(t, beltIdx(vals)) === libRedact.entryIndexText(t, pairIdx(vals))).toBe(true);
    }
  });

  it('a mark is a fixed point, a short text is returned as is, and a belt past BELT_GRAMS_MAX counts its overflow', () => {
    const v = mint();
    const idx = beltIdx([v]);
    const once = libRedact.redactField(shapes(v)[0]![1], idx);
    expect(libRedact.redactField(once, idx)).toBe(once);
    expect(libRedact.beltMask('short', idx.belt, true)).toBe('short');
    const many = libRedact.makeBelt(Array.from({ length: 3000 }, () => alnum(40)));
    expect(many.grams).toBeLessThanOrEqual(libRedact.BELT_GRAMS_MAX);
    expect(many.overflow).toBeGreaterThan(0);
  });

  it('the probe: under beltAll every layer-4 and glue-window hit is owed; without it none is', () => {
    const v = mint();
    const ranked = libRedact.secretPairs([v]).pairs.map((p) => ({ ...p, rid: 1 }));
    const belt = libRedact.makeBelt(libRedact.beltUnits([v]));
    const hits = (beltAll: boolean, text: string): number => {
      const idx = libRedact.makeProbeIndex(ranked, 1, { belt, beltAll });
      libRedact.entryIndexText(text, idx);
      return idx.probe.hits;
    };
    expect(hits(true, `x ab${v}cd y`)).toBeGreaterThan(0);
    expect(hits(true, `x ab_${v} y`), 'a glue-window hit').toBeGreaterThan(0);
    expect(hits(false, `x ab${v}cd y`)).toBe(0);
    expect(hits(false, `x ab_${v} y`), 'rid 1 at mark 1 is not owed').toBe(0);
  });

  it('the generation state: a belt generation carries " b", stays open at its own mark, and rederivePlan opens one when the belt is due', () => {
    expect(libRedact.parseRederiveState('7 0 9 b')).toEqual({ target: 7, cursor: 0, end: 9, belt: true });
    expect(libRedact.parseRederiveState('7 0 9')).toEqual({ target: 7, cursor: 0, end: 9 });
    expect(libRedact.formatRederiveState({ target: 7, cursor: 3, end: 9, belt: true })).toBe('7 3 9 b');
    expect(libRedact.rederivePlan(7, 7, 9, null, true)).toEqual({ target: 7, cursor: 0, end: 9, belt: true });
    expect(libRedact.rederivePlan(7, 7, 9, null)).toBeNull();
    expect(libRedact.phraseValues(7, { target: 7, cursor: 3, end: 9, belt: true }, ['a', 'b'], ['b']), 'open at its own mark').toEqual(['b']);
  });

  it('decideBelt: due on another version or no state, and when a live unit at or below the mark is uncovered; a unit no longer live leaves', () => {
    const V = libRedact.BELT_VERSION;
    expect(libRedact.decideBelt(null, [3], 5)).toEqual({ due: true, restart: true, next: { v: 0, rids: [], gen: null } });
    expect(libRedact.decideBelt({ v: V - 1, rids: [3], gen: null }, [3], 5).due).toBe(true);
    expect(libRedact.decideBelt({ v: V, rids: [3, 4], gen: [3, 4], gv: V }, [3, 9], 5)).toEqual({ due: false, restart: false, next: { v: V, rids: [3], gen: [3], gv: V } });
    expect(libRedact.decideBelt({ v: V, rids: [3], gen: null }, [3, 4], 5).due, 'unit 4 is back and uncovered').toBe(true);
    expect(libRedact.decideBelt({ v: V, rids: [3], gen: null }, [3, 9], 5).due, 'unit 9 lies above the mark: the pair generation owes it').toBe(false);
    expect(libRedact.beltAfterGeneration({ v: 0, rids: [], gen: [9, 3], gv: V })).toEqual({ v: V, rids: [3, 9], gen: null });
    expect(libRedact.beltAfterGeneration({ v: 0, rids: [], gen: null })).toEqual({ v: 0, rids: [], gen: null });
    for (const bad of [undefined, '', '{', '{"v":1,"rids":[0],"gen":null}', '{"v":1,"rids":[1]}', '{"v":"1","rids":[],"gen":null}',
      '{"v":1,"rids":[],"gen":[1]}', '{"v":1,"rids":[],"gen":null,"gv":1}', '{"v":1,"rids":[],"gen":null,"w":7}']) {
      expect(libRedact.parseBeltState(bad), String(bad)).toBeNull();
    }
    const s = { v: V, rids: [1, 2], gen: [2], gv: V, w: '[9,1]' };
    expect(libRedact.parseBeltState(libRedact.formatBeltState(s))).toEqual(s);
    expect(libRedact.formatBeltState({ v: 0, rids: [], gen: null }), 'the due record Tasks 21 and 23 write, byte for byte').toBe('{"v":0,"rids":[],"gen":null}');
    expect(libRedact.beltWitnessMoved({ v: V, rids: [], gen: null, w: 'a' }, 'b'), 'another build moved the witness').toBe(true);
    expect(libRedact.beltWitnessMoved({ v: V, rids: [], gen: null, w: 'a' }, 'a')).toBe(false);
    expect(libRedact.beltWitnessMoved({ v: V, rids: [], gen: null }, 'a'), 'no witness recorded claims nothing').toBe(false);
    expect(libRedact.beltWitnessMoved(null, 'a')).toBe(false);
    expect(libRedact.REDACT_SOURCES_MAX).toBe(256);
    expect(libRedact.normalizeRedactSources(['/h/.config/gw.env', '/h/.config/gw.env'])).toEqual(['/h/.config/gw.env']);
    expect(libRedact.parseRedactSources('["/h/.config/gw.env"]')).toEqual(['/h/.config/gw.env']);
    for (const bad of [undefined, 'x', '["rel/path"]', '{"a":1}', JSON.stringify(Array.from({ length: 257 }, (_, i) => `/h/${i}`))]) {
      expect(libRedact.parseRedactSources(bad)).toEqual([]);
    }
  });

  it('R-version: a generation opened under another BELT_VERSION restarts from cursor 0, and the version is stamped only after a full walk', () => {
    const V = libRedact.BELT_VERSION;
    // The reviewers' scenario with this code as the newer version: a state recorded under V - 1, its belt
    // generation open and mid-walk (cursor 100 of 900).
    const old = { v: V - 1, rids: [3], gen: [3, 4], gv: V - 1 };
    const midWalk = { target: 5, cursor: 100, end: 900, belt: true as const };
    const d = libRedact.decideBelt(old, [3, 4], 5);
    expect(d, 'due, and the open generation\'s record is dropped').toEqual({ due: true, restart: true, next: { v: V - 1, rids: [], gen: null } });
    const plan = libRedact.rederivePlan(5, 5, 900, midWalk, d.due, d.restart);
    expect(plan, 'restarted at cursor 0').toEqual({ target: 5, cursor: 0, end: 900, belt: true });
    // Task 7B records the units live at the restart, under this version. Mid-walk the state is still V - 1 and due,
    // and its own generation is not restarted again.
    const mid = libRedact.decideBelt({ ...d.next, gen: [3, 4], gv: V }, [3, 4], 5);
    expect([mid.due, mid.restart]).toEqual([true, false]);
    expect(libRedact.rederivePlan(5, 5, 900, { ...plan!, cursor: 450 }, mid.due, mid.restart)).toEqual({ ...plan, cursor: 450 });
    const done = libRedact.beltAfterGeneration(mid.next);
    expect(done, 'only the completed walk stamps V').toEqual({ v: V, rids: [3, 4], gen: null });
    expect(libRedact.decideBelt(done, [3, 4], 5).due).toBe(false);
    expect(libRedact.beltAfterGeneration({ v: V - 1, rids: [], gen: [9, 3], gv: V - 1 }), 'a completion stamps the version its walk ran under')
      .toEqual({ v: V - 1, rids: [3, 9], gen: null });
    expect(libRedact.decideBelt({ v: V, rids: [3], gen: null }, [3], 5).restart, 'nothing due: no restart').toBe(false);
    expect(libRedact.rederivePlan(7, 9, 900, { target: 9, cursor: 40, end: 800 }, true, false), 'a due belt continues a generation that carries this version\'s record')
      .toEqual({ target: 9, cursor: 40, end: 800 });
  });

  it('beltFold is unicode61\'s own fold: node:sqlite\'s tokenizer agrees on every code point U+0080..U+2FFFF', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      // B1's tables use 'porter unicode61'; porter only stems ASCII words, so unicode61 alone is the fold.
      db.exec("CREATE VIRTUAL TABLE t USING fts5(b, tokenize='unicode61')");
      db.exec("CREATE VIRTUAL TABLE tv USING fts5vocab(t, 'instance')");
      const ins = db.prepare('INSERT INTO t (rowid, b) VALUES (?, ?)');
      const cps: number[] = [];
      db.exec('BEGIN');
      for (let cp = 0x80; cp <= 0x2ffff; cp += 1) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;   // a lone surrogate is no character
        cps.push(cp);
        ins.run(cp, `q${String.fromCodePoint(cp)}q`);
      }
      db.exec('COMMIT');
      const terms = new Map<number, string[]>();
      for (const r of db.prepare('SELECT doc, term FROM tv').all() as { doc: number; term: string }[]) {
        const a = terms.get(Number(r.doc)) ?? [];
        a.push(r.term);
        terms.set(Number(r.doc), a);
      }
      const AL = 'abcdefghijklmnopqrstuvwxyz0123456789';
      /** unicode61's reading of `q<cp>q`: dropped (-1: one term `qq`), an ASCII letter or digit (its belt code, 1-36),
       *  or anything else (0: a boundary, or a character no ASCII term can hold). */
      const sqlite = (cp: number): number => {
        const a = terms.get(cp) ?? [];
        if (a.length === 1 && a[0] === 'qq') return -1;
        const m = a.length === 1 ? a[0]!.slice(1, -1) : '';
        return m.length === 1 && AL.includes(m) ? AL.indexOf(m) + 1 : 0;
      };
      expect(cps.length, 'CONTROL: every code point was read').toBe(0x2ffff - 0x80 + 1 - 0x800);
      expect([0xe9, 0x301, 0x305, 0x17f, 0x1d5, 0x2010].map(sqlite), 'CONTROL: é is e, U+0301 dropped, U+0305 a boundary, ſ is s, Ǖ (two marks) kept, a hyphen a boundary')
        .toEqual([5, -1, 0, 19, 0, 0]);
      const diverge = cps.filter((cp) => libRedact.beltFold(cp) !== sqlite(cp)).map((cp) => cp.toString(16));
      expect(diverge.length, `diverging code points (first 20): ${diverge.slice(0, 20).join(' ')}`).toBe(0);
    } finally { db.close(); }
  });

  it('the widening is linear: a run that repeats a 14-wide gram glued by an uncovered letter, 8x longer, costs under 16x', () => {
    const v = mint();
    const idx = beltIdx([v]);
    // The glue letter never equals the gram's next character, case folded: were it v[14] (x or X, 8 draws in 256),
    // the window crossing each glue would match a gram of v, the run would be one cover, and mutant (t) stayed green
    // (finding V10 measured it: 117 ms and 238 ms).
    const g = v[14]!.toLowerCase() === 'x' ? 'z' : 'x';
    const shape = (bytes: number): string => `${v.slice(0, 14)}${g}`.repeat(Math.ceil(bytes / 15));
    const best = (t: string): number => {
      let m = Infinity;
      for (let k = 0; k < 5; k += 1) {
        const t0 = performance.now();
        const out = libRedact.beltMask(t, idx.belt, true);
        m = Math.min(m, performance.now() - t0);
        expect(out === libRedact.REDACTED_MARK, 'the whole run is one mark').toBe(true);
      }
      return m;
    };
    best(shape(4096));   // warm-up
    const small = best(shape(64 * 1024));
    const large = best(shape(512 * 1024));
    // Measured on the prototype (Node 24.14.1): 2.6-2.9 ms and 18 ms, a ratio near 7. The per-cover rescan this
    // replaces cost 0.6 s and 37 s here (review: 1.1 s and 56 s), a ratio near 64.
    expect(large / Math.max(small, 0.5), `64 KiB ${small.toFixed(1)} ms, 512 KiB ${large.toFixed(1)} ms`).toBeLessThan(16);
    expect(large, '512 KiB within the bound').toBeLessThan(2_000);
  });

  it('a --json string stays valid: no widening takes a JSON escape\'s letter or hex digit, and a span that starts inside an escape takes it whole', () => {
    const v = mint();
    const idx = beltIdx([v]);
    const w = libRedact.beltWidth(v);
    for (const pre of ['a\n', 'a\u0001', 'grep x\t', 'q"']) {
      const s = libRedact.redactFinal(JSON.stringify({ t: `${pre}${v}y`, u: `x${v}\n` }), idx);
      let o: { t: string; u: string } | null = null;
      try { o = JSON.parse(s); } catch { o = null; }
      expect(o, `${JSON.stringify(pre)}: ${s}`).not.toBeNull();
      expect(Math.max(shared(o!.t, v), shared(o!.u, v)), s).toBeLessThan(w);
      expect(s).toContain(libRedact.REDACTED_MARK);
    }
    expect(libRedact.redactFinal(JSON.stringify({ t: `a\n${v}` }), idx), 'the escape stays, the value goes').toBe(`{"t":"a\\n${libRedact.REDACTED_MARK}"}`);
    // A unit that begins with `n`, printed after a backslash-n: the literal reading's cover starts on the escape's
    // letter, and the span takes the whole escape.
    const nv = `n${v}`;
    const s2 = libRedact.redactFinal(JSON.stringify({ t: `a\n${v}zz` }), beltIdx([nv]));
    expect(s2, 'the span took the escape whole').toBe(`{"t":"a${libRedact.REDACTED_MARK}"}`);
  });
});

// ── W1-B2 Task 7A: the index's escape readings for display and nodes_fts (spec §8.3 "Where it runs", §6.2, rev 3.5;
// B1's D-4343 and D-4419; B1's run 302 notes) ──
describe('lib: nodeIndexTexts and redactForDisplay read every escape level the index reads (W1-B2 Task 7A)', () => {
  /** A 40-character value built at runtime (no key-shaped literal in a public repo): one run, registered as a pair.
   *  The index below holds its pair and no belt, as a rotated value or a sessions.json hash is held. */
  const V = Array.from({ length: 40 }, (_, i) => 'abcdefghjkmnpqrstuvwxyz23456789'[(i * 7 + 3) % 31]).join('');
  const idx = libRedact.makePairIndex(libRedact.secretPairs([V]).pairs);
  /** What a tool printing JSON leaves in a row: a literal backslash and `n` glued onto the value (B1's review 316 F2). */
  const glued = JSON.stringify({ text: `\n${V}` });
  /** A backslash-u-005c chain: two decodes separate the value. */
  const nested = `x \\u005cn${V} y`;

  it('up to its bound redactForDisplay is redactForIndex: a value glued to a literal escape is masked where redactField leaves it', () => {
    expect(libRedact.redactField(glued, idx), 'CONTROL: one reading leaves the glued value').toContain(V);
    expect(libRedact.redactField(nested, idx), 'CONTROL: and the chained one').toContain(V);
    for (const t of [glued, nested, `plain ${V} text`]) {
      const shown = libRedact.redactForDisplay(t, idx);
      expect(shown, t).not.toContain(V);
      expect(shown, t).toContain(libRedact.REDACTED_MARK);
      expect(shown, 'the text the index would hold').toBe(libRedact.redactForIndex(t, idx));
    }
  });

  it('text whose escapes hide nothing is shown exactly as it came: a Windows path, LaTeX, a JSON line break', () => {
    for (const t of ['C:\\new_folder\\table.txt', '\\begin{document} and \\n twice', '{"a":"b\\nc"}', 'no escapes at all']) {
      expect(libRedact.redactForDisplay(t, idx), t).toBe(t);
    }
  });

  it('past DISPLAY_READINGS_MAX each escape-glued span is masked only when its own readings remove something', () => {
    expect(libRedact.DISPLAY_READINGS_MAX).toBe(libRedact.ENTRY_FTS_BYTES + libRedact.ENTRY_REDACT_MARGIN);
    const big = `${'w '.repeat(libRedact.DISPLAY_READINGS_MAX / 2)}${glued} and \\nfoo and ${nested} end`;
    expect(big.length, 'CONTROL: past the bound').toBeGreaterThan(libRedact.DISPLAY_READINGS_MAX);
    // Booleans, never the 1 MiB strings: a red must not print a 1 MiB diff (ruling R-runner).
    expect(libRedact.redactField(big, idx).includes(V), 'CONTROL: one reading leaves the glued values').toBe(true);
    const shown = libRedact.redactForDisplay(big, idx);
    expect(shown.includes(V), 'no glued value is shown').toBe(false);
    expect(shown.includes(' and \\nfoo and '), 'an escape that hides nothing prints as it came').toBe(true);
    expect(shown.endsWith(' end')).toBe(true);
  });

  it('nodeIndexTexts takes the gist, each topic and each ref value through entryIndexText, topics and refs one per line', () => {
    const t = libRedact.nodeIndexTexts({ gist: `zqgist ${glued}`, topics: [`zqtopic ${nested}`, 'plain topic'], refs: ['src/a.ts', glued] }, idx);
    for (const col of [t.gist, t.topics, t.refs]) expect(col).not.toContain(V);
    expect(t.gist).toBe(libRedact.entryIndexText(`zqgist ${glued}`, idx));
    expect(t.topics.split('\n').at(-1)).toBe('plain topic');
    expect(t.refs.split('\n')[0]).toBe('src/a.ts');
    expect(libRedact.nodeIndexTexts({ gist: null, topics: null, refs: [] }, idx)).toEqual({ gist: '', topics: '', refs: '' });
  });

  it('nodeIndexTexts depends on the pairs only through the index\'s answers: a probe index returns the same texts and counts the owed hit', () => {
    const pairs = libRedact.secretPairs([V]).pairs.map((p, i) => ({ ...p, rid: i + 1 }));
    const probe = libRedact.makeProbeIndex(pairs, 0);
    const fields = { gist: `zqgist ${glued}`, topics: [], refs: [] };
    expect(libRedact.nodeIndexTexts(fields, probe)).toEqual(libRedact.nodeIndexTexts(fields, idx));
    expect(probe.probe.hits, 'the owed pair was asked and answered yes').toBeGreaterThan(0);
  });
});

describe('lib: grep\'s arguments and index gate (W1-B2 task 12)', () => {
  const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

  it('INDEXED_PROVENANCE is the searchable three plus recall-echo, frozen, each a PROVENANCE word; FTS_STEP is the backfill\'s step', () => {
    expect([...libGrep.INDEXED_PROVENANCE]).toEqual([...libGrep.SEARCHABLE_PROVENANCE, 'recall-echo']);
    expect(Object.isFrozen(libGrep.INDEXED_PROVENANCE)).toBe(true);
    for (const p of libGrep.INDEXED_PROVENANCE) expect(libGrep.PROVENANCE).toContain(p);
    expect(libGrep.INDEXED_PROVENANCE).not.toContain('summary');
    expect(libGrep.INDEXED_PROVENANCE).not.toContain('harness');
    expect(libGrep.FTS_STEP).toBe('fts');
  });

  it('decideGrepIndex: a thrown probe is 5 probe-failed, absent is 7 fts5-absent, no table or a backfill still running is 7 fts-pending', () => {
    const d = libGrep.decideGrepIndex;
    expect(d({ probe: 'threw', table: true, completed: true })).toEqual({ ok: false, exit: 5, reason: 'probe-failed' });
    expect(d({ probe: 'absent', table: true, completed: true })).toEqual({ ok: false, exit: 7, reason: 'fts5-absent' });
    expect(d({ probe: 'present', table: false, completed: false })).toEqual({ ok: false, exit: 7, reason: 'fts-pending' });
    expect(d({ probe: 'present', table: true, completed: false })).toEqual({ ok: false, exit: 7, reason: 'fts-pending' });
    expect(d({ probe: 'present', table: true, completed: true })).toEqual({ ok: true });
    // Every refusal's word maps to its exit in REASONS (C16's rule, held here for the gate's three words).
    for (const v of [d({ probe: 'threw', table: false, completed: false }), d({ probe: 'absent', table: false, completed: false }),
      d({ probe: 'present', table: true, completed: false })]) {
      expect(v.ok).toBe(false);
      if (!v.ok) expect(libGrep.REASONS[v.reason]).toBe(v.exit);
    }
  });

  it('parseGrepArgs: the defaults, every value checked, the scope flags passed over, and -- ending the options', () => {
    const ok = (argv: string[]) => {
      const r = libGrep.parseGrepArgs(argv, NOW);
      expect(r.ok, argv.join(' ')).toBe(true);
      return r.ok ? r.args : null;
    };
    expect(ok(['zqword'])).toEqual({
      words: ['zqword'], regex: null, role: null, tool: null, sinceMs: null, beforeMs: null, node: null,
      sort: 'recency', limit: libGrep.GREP_LIMIT_DEFAULT, cursor: null, includeRecall: false, json: false,
    });
    expect(ok(['a', 'b', '--json', '--include-recall', '--sort', 'hybrid', '--limit', String(libGrep.GREP_LIMIT_MAX),
      '--role', 'user', '--tool', 'Bash', '--node', 'L0123456789abcdef0123', '--cursor', 'abc', '--project'])).toEqual({
      words: ['a', 'b'], regex: null, role: 'user', tool: 'Bash', sinceMs: null, beforeMs: null, node: 'L0123456789abcdef0123',
      sort: 'hybrid', limit: libGrep.GREP_LIMIT_MAX, cursor: 'abc', includeRecall: true, json: true,
    });
    expect(ok(['--session', 'claude-b-demo', '--workspace', 'zq'])?.words).toEqual(['zq']);
    expect(ok(['--', '--force', 'x'])?.words).toEqual(['--force', 'x']);
    expect(ok(['--since', '2d', 'zq'])?.sinceMs).toBe(libGrep.parseTimeBound('2d', NOW));
    expect(ok(['--before', '2026-10-01T00:00:00Z', 'zq'])?.beforeMs).toBe(libGrep.parseTimeBound('2026-10-01T00:00:00Z', NOW));
    expect(ok(['--regex', 'zq[0-9]+x'])).toMatchObject({ words: [], regex: 'zq[0-9]+x', sort: 'recency' });
    for (const bad of [
      [], ['--json'], ['--limit', '0', 'zq'], ['--limit', String(libGrep.GREP_LIMIT_MAX + 1), 'zq'], ['--limit', 'x', 'zq'],
      ['--sort', 'best', 'zq'], ['--since', 'yesterday', 'zq'], ['--before', 'soon', 'zq'], ['--role', 'User!', 'zq'],
      ['--tool', 'a b', 'zq'], ['--json', '--json', 'zq'], ['--frob', 'zq'], ['zq', '--role'],
      ['--regex', 'x', 'word'], ['--regex', 'x', '--sort', 'relevance'],
    ]) {
      expect(libGrep.parseGrepArgs(bad, NOW), JSON.stringify(bad)).toEqual({ ok: false, reason: 'bad-args' });
    }
  });

  it("SEARCH_REACH says how far grep reaches, from the two window constants (B1's history-entry-index-text-windowed and history-sidecar-redact-before-cut)", () => {
    expect(libGrep.ENTRY_FTS_BYTES).toBe(1024 * 1024);
    expect(libGrep.SIDECAR_FTS_BYTES).toBe(512 * 1024);
    expect(libGrep.SEARCH_REACH).toBe("grep reaches at most the first 1 MiB of each message's redacted text and the first 512 KiB of each tool output Claude Code saved to its own file; text past that is stored but not searched");
    expect([libGrep.reachSize(3 * 1024 * 1024), libGrep.reachSize(1536 * 1024), libGrep.reachSize(1000)])
      .toEqual(['3 MiB', '1536 KiB', '1000 bytes']);
  });
});

describe('lib: a window of a longer text, redacted for display (W1-B2 task 12; coordinator rulings R-display-window and R-window2)', () => {
  /** A pair-only value: makePairIndex without belt units, so only the pair, shape and escape-reading layers can mask it. */
  const V = libGrepRandom(32).toString('hex');
  const idx = libGrep.makePairIndex(libGrep.secretPairs([V]).pairs);
  /** No value at all: only the shape and context layers can redact. */
  const none = libGrep.makePairIndex(libGrep.secretPairs([]).pairs);
  const M = libGrep.REDACTED_MARK;
  const NOTE = libGrep.DISPLAY_INEXACT_NOTE;
  // Built from code points, so nothing here is an escape in transit.
  const ESC = String.fromCharCode(27);
  const BS = String.fromCharCode(92);
  const Q = String.fromCharCode(34);
  const NL = String.fromCharCode(10);
  const alnum = (n: number): string => Array.from(libGrepRandom(n), (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]!).join('');
  /** Each text holding 8 consecutive characters of `secret`, by index. */
  const pieces = (texts: readonly string[], secret: string): string[] => {
    const out: string[] = [];
    texts.forEach((t, i) => {
      for (let k = 0; k + 8 <= secret.length; k += 1) if (t.includes(secret.slice(k, k + 8))) { out.push(`#${i}: ${secret.slice(k, k + 8)}`); break; }
    });
    return out;
  };
  /** Whether a window was shown inexact: its first line is DISPLAY_INEXACT_NOTE. */
  const inexact = (s: string): boolean => s.startsWith(`${NOTE}${NL}`);
  /** The escaped-JSON command of findings V15 and V37: the key in quotes a decode removes, the value four words. */
  const CURL = `curl -d '{${BS}${Q}password${BS}${Q}: ${BS}${Q}correct horse battery staple${BS}${Q}}'`;

  it('redactDisplayWindow: text with nothing to redact comes back as its slice, and pages of it join to the text exactly', () => {
    const words = Array.from({ length: 30_000 }, (_, i) => `w${i % 97}`).join(' ');
    for (const [f, t] of [[0, 10], [5, 5], [1234, 1300], [40_000, 58_000], [words.length - 7, words.length + 9]] as const) {
      expect(libGrep.redactDisplayWindow(words, f, t, idx), `[${f}, ${t})`).toBe(words.slice(f, t));
    }
    let joined = '';
    for (let f = 0; f < words.length; f += 18_000) joined += libGrep.redactDisplayWindow(words, f, f + 18_000, idx);
    expect(joined === words, 'pages cut inside words join exactly').toBe(true);
  });

  it('a value or a PEM block straddling either window edge leaves no piece on either side; the value\'s mark is shown whole, and the cut is exact', () => {
    const text = `${'p '.repeat(40_000)}${V} ${'q '.repeat(40_000)}`;
    const at = text.indexOf(V);
    for (let cut = at - 2; cut <= at + V.length + 2; cut += 1) {
      const before = libGrep.redactDisplayWindow(text, cut - 500, cut, idx);
      const after = libGrep.redactDisplayWindow(text, cut, cut + 500, idx);
      expect(pieces([before, after, before + after], V), `cut at ${cut - at}`).toEqual([]);
      expect(before + after, `cut at ${cut - at}: the mark is shown on one side`).toContain(M);
      expect(inexact(before) || inexact(after), `cut at ${cut - at}: both sides are cut exactly`).toBe(false);
    }
    // A PEM block is a shape, matched only with its BEGIN line: a window inside its body sees that line only in the margin.
    const LINES = [`MII${alnum(40)}`, alnum(43), alnum(43)];
    const PEM = ['-----BEGIN ', 'RSA PRIVATE KEY-----\n', LINES.join('\n'), '\n-----END RSA PRIVATE KEY-----'].join('');
    const pem = `${'p '.repeat(40_000)}${PEM}\n${'q '.repeat(40_000)}`;
    const p0 = pem.indexOf(PEM);
    const shown: string[] = [];
    for (let cut = p0; cut <= p0 + PEM.length; cut += 7) {
      shown.push(libGrep.redactDisplayWindow(pem, cut - 500, cut, idx), libGrep.redactDisplayWindow(pem, cut, cut + 500, idx));
    }
    for (const l of LINES) expect(pieces(shown, l), l.slice(0, 6)).toEqual([]);
  });

  it('a pair-only value behind a literal \\n is masked through the escape readings: inside the window, across either edge, and in a JSON key', () => {
    const glued = JSON.stringify({ text: `\n${V}` });
    const keyed = JSON.stringify({ headers: { [`\n${V}`]: 'x' } });
    const text = `${'r '.repeat(40_000)}x ${glued} y ${keyed} ${'s '.repeat(40_000)}`;
    const g = text.indexOf(V);
    expect(pieces([libGrep.redactField(text.slice(g - 10, g + 80), idx)], V), 'CONTROL: one reading cannot separate it').toHaveLength(1);
    for (let cut = g - 4; cut <= g + V.length + 2; cut += 1) {
      const sides = [libGrep.redactDisplayWindow(text, cut - 300, cut, idx), libGrep.redactDisplayWindow(text, cut, cut + 300, idx)];
      expect(pieces(sides, V), `cut at ${cut - g}`).toEqual([]);
    }
    const k = text.indexOf('headers');
    const key = libGrep.redactDisplayWindow(text, k - 50, k + 120, idx);
    expect(key, 'CONTROL: the window holds the key').toContain('headers');
    expect(pieces([key], V)).toEqual([]);
  });

  it('a [A-Za-z0-9_-] run longer than the margin that reaches the window is dropped, never shown in part; no slice splits a surrogate pair', () => {
    const text = `head ${'A'.repeat(3 * libGrep.ENTRY_REDACT_MARGIN)} tail`;
    expect(libGrep.redactDisplayWindow(text, 100_000, 100_050, idx)).toBe('');
    expect(libGrep.redactDisplayWindow(text, 0, 20, idx)).toBe('head ');
    const P = String.fromCharCode(0xd83d, 0xde00);
    const astral = `${'a '.repeat(10)}${P.repeat(50)}${' b'.repeat(10)}`;
    /** Whether `s` holds half a surrogate pair, by code units (no regex escapes in transit). */
    const lone = (s: string): boolean => {
      for (let k = 0; k < s.length; k += 1) {
        const c = s.charCodeAt(k);
        if (c >= 0xd800 && c <= 0xdbff) {
          const n = s.charCodeAt(k + 1);
          if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
          k += 1;
        } else if (c >= 0xdc00 && c <= 0xdfff) return true;
      }
      return false;
    };
    for (let f = 0; f < astral.length; f += 1) {
      for (const w of [1, 2, 3, 7]) expect(lone(libGrep.redactDisplayWindow(astral, f, f + w, idx)), `[${f}, ${f + w})`).toBe(false);
    }
  });

  it('displaySnippet finds the hit in the raw text and redacts only the window around it: a value straddling the snippet\'s cut leaves no piece', () => {
    const far = `${'v '.repeat(100_000)}zqhit after ${V} end ${'w '.repeat(10)}`;
    expect(libGrep.snippetSpan(far, ['zqhit']).at).toBe(far.indexOf('zqhit'));
    expect(libGrep.displaySnippet(far, ['zqhit'], idx), 'what the whole text redacted would show').toBe(libGrep.snippetWindow(libGrep.redactField(far, idx), ['zqhit']));
    expect(libGrep.displaySnippet(far, ['zqhit'], idx)).toContain(`zqhit after ${M} end`);
    const outs: string[] = [];
    const raws: string[] = [];
    for (let pad = 20; pad <= 50; pad += 1) {
      const t = `zqhit ${'u'.repeat(pad)} ${V} tail ${'z '.repeat(200)}`;
      outs.push(libGrep.displaySnippet(t, ['zqhit'], idx));
      raws.push(libGrep.snippetWindow(t, ['zqhit']));
    }
    expect(pieces(raws, V).length, 'CONTROL: a cut of the raw text leaves pieces of the value').toBeGreaterThan(0);
    expect(pieces(outs, V)).toEqual([]);
  });

  it('displaySnippet costs the window, not the body: a 16 MiB escape-dense body\'s snippet stays under 5,000 ms and 512 MiB of RSS (a child process)', () => {
    // The body is built in the child from code points, so nothing here is an escape in transit. ESC and literal
    // backslash escapes on every run make each JSON-escape reading of the whole text a full rewrite. Each unit ends in
    // a space, so the margins' far ends find a token break (final-check W2's rule) and both margins are read whole:
    // without it the body is one token span, the margin's end moves back to the window, and nothing is measured.
    const SCRIPT = [
      'const L = await import(process.argv[1]);',
      "const { randomBytes } = await import('node:crypto');",
      "const idx = L.makePairIndex(L.secretPairs([randomBytes(32).toString('hex')]).pairs);",
      'const E = String.fromCharCode(27);',
      'const B = String.fromCharCode(92);',
      "const unit = E + '[31mzq' + B + 'nab' + E + '[0m' + B + 't ';",
      "const body = 'zqdense12 start ' + unit.repeat(Math.floor((16 * 1024 * 1024 - 64) / unit.length));",
      'const t0 = performance.now();',
      "const out = L.displaySnippet(body, ['zqdense12'], idx);",
      'process.stdout.write(JSON.stringify({ ms: Math.round(performance.now() - t0), rss: process.resourceUsage().maxRSS, chars: body.length, head: out.slice(0, 15) }));',
    ].join('\n');
    const lib = new URL('../../ccd/history/lib.mjs', import.meta.url).href;
    const r = libGrepSpawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', SCRIPT, lib], { encoding: 'utf8', timeout: 240_000 });
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(r.stdout) as { ms: number; rss: number; chars: number; head: string };
    expect(m.chars, 'CONTROL: the body is 16 MiB').toBeGreaterThan(16 * 1024 * 1024 - 64);
    expect(m.head, 'CONTROL: the snippet shows the hit').toBe('zqdense12 start');
    expect(m.ms < 5_000, `displaySnippet took ${m.ms} ms`).toBe(true);
    expect(m.rss < 524_288, `peak RSS ${m.rss} KiB`).toBe(true);
  }, 300_000);

  it('a whole text\'s window is redactForDisplay\'s, and so is that text\'s window inside a longer one: every layer and reading at once, the bound\'s marked spans included', () => {
    let nested = `\n${V}`;
    for (let k = 0; k < 9; k += 1) nested = JSON.stringify(nested);
    const texts = [
      `plain ${V} text`, JSON.stringify({ a: `\n${V}`, b: 'x' }), nested,
      `x ${V.slice(0, 12)}${ESC}[31m${V.slice(12)}${ESC}[0m y`, `${ESC}[1mbold${ESC}[0m nothing`, CURL,
    ];
    texts.forEach((t, i) => expect(libGrep.redactDisplayWindow(t, 0, t.length, idx), `text #${i}`).toBe(libGrep.redactForDisplay(t, idx)));
    // A whole text's window is redactForDisplay's by its first line (final-check W4); inside a longer text the same
    // window is cut from displayReading's reading, so this half pins that reading equal to redactForDisplay's.
    texts.forEach((t, i) => expect(libGrep.redactDisplayWindow(`p ${t} q`, 2, 2 + t.length, idx), `text #${i} inside a longer text`).toBe(libGrep.redactForDisplay(t, idx)));
    expect(pieces([libGrep.redactForDisplay(nested, idx)], V), 'CONTROL: nine levels reach the bound, which marks V').toEqual([]);
  });

  it('a value only a decoded reading\'s context form sees, its key in the margin: no window starting at, inside or ending inside it prints it (findings V15, V37)', () => {
    const text = `${'p '.repeat(40_000)}${CURL} ${'q '.repeat(40_000)}`;
    const v = text.indexOf('correct');
    expect(libGrep.redactForDisplay(text, none), 'CONTROL: the whole text masks the value').not.toMatch(/correct|horse|battery|staple/);
    const outs: string[] = [];
    for (let k = -2; k <= 28; k += 1) {
      outs.push(libGrep.redactDisplayWindow(text, v + k, v + k + 300, none), libGrep.redactDisplayWindow(text, v + k - 300, v + k, none));
    }
    expect(['correct', 'horse', 'battery', 'staple'].filter((w) => outs.some((o) => o.includes(w)))).toEqual([]);
    expect(outs.filter(inexact), 'every window is cut exactly').toEqual([]);
    const api = `zq${alnum(24)}`;
    for (const shape of [
      `{${BS}${Q}api_key${BS}${Q}:${BS}${Q}${api}${BS}${Q}}`,
      `payload: {${BS}${Q}api_key${BS}${Q}: ${BS}${Q}${api}${BS}${Q}, ${BS}${Q}n${BS}${Q}: 1}`,
    ]) {
      const t2 = `${'p '.repeat(40_000)}${shape} ${'q '.repeat(40_000)}`;
      const k0 = t2.indexOf('api_key');
      const at = t2.indexOf(api);
      expect(pieces([libGrep.redactForDisplay(t2, none)], api), 'CONTROL: the whole text masks the token').toEqual([]);
      const o2: string[] = [];
      for (let c = k0; c <= at + api.length + 3; c += 1) o2.push(libGrep.redactDisplayWindow(t2, c, c + 300, none), libGrep.redactDisplayWindow(t2, c - 300, c, none));
      expect(pieces(o2, api), shape.slice(0, 12)).toEqual([]);
      expect(o2.filter(inexact), `${shape.slice(0, 12)}: every window is cut exactly`).toEqual([]);
    }
  });

  it('an escape-split value where a margin starts, another inside the window: the window is cut where it is, never from the margin (finding V18)', () => {
    const m = libGrep.ENTRY_REDACT_MARGIN;
    const V2 = `QP${alnum(45)}7`;
    const W2 = `QP${alnum(45)}7`;
    const i2 = libGrep.makePairIndex(libGrep.secretPairs([V2, W2]).pairs);
    const fill = (n: number): string => 'f '.repeat(Math.ceil(n / 2)).slice(0, n);
    // Left: the margin starts on the ESC that splits V2, and W2 is split by another inside a 78-character window.
    const head = `${'h '.repeat(1000)}x ${V2.slice(0, 10)}`;
    const lo = head.length + m;
    const mid = `${ESC}[31m${V2.slice(10)} `;
    const win = ` w ${W2.slice(0, 20)}${ESC}[32m${W2.slice(20)} e `.padEnd(78, '.');
    const left = head + mid + fill(m - mid.length) + win + ` ${'t '.repeat(40_000)}`;
    expect(left.charCodeAt(lo - m), 'CONTROL: the margin starts on the ESC').toBe(27);
    expect(pieces([libGrep.redactForDisplay(left, i2)], V2), 'CONTROL: the whole text masks V2').toEqual([]);
    const outL = libGrep.redactDisplayWindow(left, lo, lo + 78, i2);
    expect(pieces([outL], V2)).toEqual([]);
    expect(pieces([outL], W2)).toEqual([]);
    expect(outL.length, 'the window, never the margin').toBeLessThanOrEqual(78 + 2 * M.length);
    expect(inexact(outL), 'cut exactly').toBe(false);
    // Right: an 18,000-character window holding W2's split, the margin ending on the ESC that splits V2.
    const lo2 = 2000;
    const hi2 = lo2 + 18_000;
    const winR = `a ${W2.slice(0, 20)}${ESC}[32m${W2.slice(20)} b `.padEnd(18_000, '.');
    const right = `${'g '.repeat(lo2 / 2)}${winR} ${fill(m - 12)} ${V2.slice(0, 10)}${ESC}[31m${V2.slice(10)} ${'u '.repeat(40_000)}`;
    expect(right.charCodeAt(hi2 + m), 'CONTROL: the margin ends on the ESC').toBe(27);
    const outR = libGrep.redactDisplayWindow(right, lo2, hi2, i2);
    expect(pieces([outR], V2)).toEqual([]);
    expect(pieces([outR], W2)).toEqual([]);
    expect(outR.length, 'the window, never the margin').toBeLessThanOrEqual(18_000 + 2 * M.length);
    expect(inexact(outR), 'cut exactly').toBe(false);
  });

  it('a page edge inside a word near an escape-glued value: the word prints whole across the two pages, the value on neither (finding V17)', () => {
    const text = `${JSON.stringify({ a: `\n${V}` })} ${'filler '.repeat(500)}importantword ${'tail '.repeat(500)}`;
    const mid = text.indexOf('importantword') + 6;
    const p1 = libGrep.redactDisplayWindow(text, 0, mid, idx);
    const p2 = libGrep.redactDisplayWindow(text, mid, text.length, idx);
    expect(p1 + p2).toContain('importantword');
    expect(pieces([p1, p2, p1 + p2], V)).toEqual([]);
  });

  it('a page edge between a backslash and its escape letter is cut exactly, within DISPLAY_EDGE_SLACK, and shows no piece of the value', () => {
    const body = JSON.stringify({ k: `\n${V}`, lines: Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n') });
    const text = `${body} ${'z '.repeat(1000)}`;
    const all: string[] = [];
    for (let at = text.indexOf('line 1'), n = 0; n < 60; at = text.indexOf(`${BS}n`, at + 1), n += 1) {
      const cut = at + 1;
      all.push(libGrep.redactDisplayWindow(text, cut - 400, cut, idx), libGrep.redactDisplayWindow(text, cut, cut + 400, idx));
    }
    expect(pieces(all, V)).toEqual([]);
    expect(all.filter(inexact).length, 'inexact windows').toBe(0);
  });

  it('a cut that cannot be shown exact fails closed: the window alone, every run of 8 or more masked, under one note line; never margin text', () => {
    const run = 'AKIAABCDEFGHIJKLMNOP';
    const text = `${'p '.repeat(40_000)}${run}QRSTUVWXYZ0123 rest of it longwordhere ${'q '.repeat(40_000)}`;
    const lo = text.indexOf('QRSTU');
    const out = libGrep.redactDisplayWindow(text, lo, lo + 60, idx);
    expect(out.startsWith(`${NOTE}${NL}`), 'inexact, under its note line').toBe(true);
    expect(out, 'no margin text').not.toContain('AKIA');
    expect(out, 'the long word masked').not.toContain('longwordhere');
    expect(out).toContain(` rest of it ${M} q q`);
    expect(out.split(NL), 'one note line, then the window').toHaveLength(2);
    // grep's snippet over the same cut shows the note on its one line.
    const hit = `${'p '.repeat(40_000)}${run}QRSTUVWXYZ0123 ${'x'.repeat(184)} zqfb5 ${'q '.repeat(500)}`;
    expect(hit.indexOf('zqfb5') - libGrep.SNIPPET_MAX, 'CONTROL: the snippet window starts inside the run').toBe(hit.indexOf('QRSTU'));
    const snip = libGrep.displaySnippet(hit, ['zqfb5'], idx);
    expect(snip.startsWith(`${NOTE} `), 'the note leads the snippet').toBe(true);
    expect(snip).not.toContain('AKIA');
    expect(snip).not.toContain(NL);
    expect(snip).toContain('zqfb5');
  });

  it('a literal mark after a colour sequence where a margin starts does not move the cut into the margin', () => {
    const W = `QP${alnum(29)}8`;
    const i2 = libGrep.makePairIndex(libGrep.secretPairs([W]).pairs);
    const tok = `tk${alnum(30)}`;
    const m = libGrep.ENTRY_REDACT_MARGIN;
    const head = `${'h '.repeat(1000)}Authorization: Bearer `;
    const left = `${tok} ${ESC}[0m${M} ${'f '.repeat(m)}`.slice(0, m);
    const lo = head.length + left.length;
    const win = ` w ${W.slice(0, 12)}${ESC}[32m${W.slice(12)} e `.padEnd(80, '.');
    const text = head + left + win + ` ${'t '.repeat(40_000)}`;
    expect(text.indexOf(tok), 'CONTROL: the margin starts on the token').toBe(lo - m);
    expect(pieces([libGrep.redactForDisplay(text, i2)], tok), 'CONTROL: the whole text masks the token').toEqual([]);
    const out = libGrep.redactDisplayWindow(text, lo, lo + 80, i2);
    expect(pieces([out], tok)).toEqual([]);
    expect(pieces([out], W)).toEqual([]);
    expect(out.length, 'the window, never the margin').toBeLessThanOrEqual(80 + 2 * M.length);
    expect(inexact(out), 'cut exactly').toBe(false);
    // The same margin, now ending on the head of a value whose rest starts the window: of the margin's two readings, the
    // one with its sequences removed reaches the value, so it decides, and the value shows as its whole mark.
    const Z = `QP${alnum(29)}9`;
    const i3 = libGrep.makePairIndex(libGrep.secretPairs([W, Z]).pairs);
    const left3 = `${left.slice(0, m - 11)} ${Z.slice(0, 10)}`;
    const win3 = `${Z.slice(10)} w ${W.slice(0, 12)}${ESC}[32m${W.slice(12)} e `.padEnd(80, '.');
    const text3 = head + left3 + win3 + ` ${'t '.repeat(40_000)}`;
    expect(text3.indexOf(tok), 'CONTROL: the margin starts on the token').toBe(lo - m);
    const out3 = libGrep.redactDisplayWindow(text3, lo, lo + 80, i3);
    for (const s of [tok, W, Z]) expect(pieces([out3], s), s.slice(0, 4)).toEqual([]);
    expect(out3.length, 'the window, never the margin').toBeLessThanOrEqual(80 + 2 * M.length);
    expect(inexact(out3), 'cut exactly').toBe(false);
    expect(out3.startsWith(`${M} w `), 'the straddling value shows as its whole mark').toBe(true);
  });

  it('an inexact window reads an escape-split value as the readings do: a coloured or JSON-escaped value at its end leaves no 8-character stretch, and a coloured or escaped word inside it is masked whole (final check W1)', () => {
    const W = `QW${alnum(30)}`;
    /** V pair-only, W loaded in the belt: `ab_<W>_tail`, Task 7A's glue shape, makes a window starting in W inexact. */
    const i2 = libGrep.makePairIndex(libGrep.secretPairs([V, W]).pairs, libGrep.makeBelt(libGrep.beltUnits([W])));
    /** A colour sequence before every character, as lolcat prints. */
    const lolcat = (s: string): string[] => s.split('').map((c, k) => `${ESC}[38;5;${16 + k}m${c}`);
    /** Every character as a JSON unicode escape (a backslash, `u00`, two hex digits), built from code points. */
    const uesc = (s: string): string[] => s.split('').map((c) => `${BS}u00${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
    const plain = (s: string): string => s.replace(new RegExp(`${ESC}${BS}[[0-9;]*m`, 'g'), '');
    const decoded = (s: string): string => s.replace(new RegExp(`${BS}${BS}u00([0-9a-f]{2})`, 'g'), (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    const word = `zq${alnum(14)}`;
    for (const [form, parts] of [['coloured', lolcat], ['escaped', uesc]] as const) {
      const build = (glued: string): { text: string; lo: number; hi: number } => {
        const head = `${'p '.repeat(40_000)}note ab_${glued}_tail and ${parts(word).join('')} rest of it `;
        const vp = parts(V);
        const text = `${head}${vp.join('')}${form === 'coloured' ? `${ESC}[0m` : ''} tail ${'q '.repeat(40_000)}`;
        return { text, lo: head.indexOf(`${glued}_tail`) + glued.length - 5, hi: head.length + vp.slice(0, 30).join('').length };
      };
      const hit = build(W);
      const whole = libGrep.redactForDisplay(hit.text, i2);
      expect(pieces([plain(whole), decoded(whole)], V), `${form}: CONTROL: the whole text masks V`).toEqual([]);
      const out = libGrep.redactDisplayWindow(hit.text, hit.lo, hit.hi, i2);
      expect(inexact(out), `${form}: CONTROL: the glued belt unit at the start makes the window inexact`).toBe(true);
      expect(pieces([out, plain(out), decoded(out)], V), `${form}: V at the window's end`).toEqual([]);
      expect(pieces([out, plain(out), decoded(out)], word), `${form}: the word inside the window`).toEqual([]);
      const ctl = build('x'.repeat(W.length));
      const outC = libGrep.redactDisplayWindow(ctl.text, ctl.lo, ctl.hi, i2);
      expect(inexact(outC), `${form}: CONTROL: without the glued unit the same window is exact`).toBe(false);
      expect(pieces([outC, plain(outC), decoded(outC)], V), `${form}: the exact window`).toEqual([]);
    }
  });

  it('an inexact window whose edge cuts a value leaves none of its characters, however few (final check W3)', () => {
    const run = 'AKIAABCDEFGHIJKLMNOP';
    const colour = (s: string): string => s.split('').map((c, k) => `${ESC}[38;5;${16 + k}m${c}`).join('');
    for (const [form, enc] of [['plain', (s: string): string => s], ['coloured', colour]] as const) {
      const head = `${'p '.repeat(40_000)}${run}QRSTUVWXYZ0123 rest of it `;
      const text = `${head}${enc(V)} tail ${'q '.repeat(40_000)}`;
      const lo = head.indexOf('QRSTU');
      for (let k = 1; k <= 7; k += 1) {
        const hi = head.length + enc(V.slice(0, k)).length;
        expect(libGrep.redactDisplayWindow(text, lo, hi, idx), `${form}, ${k} of V's characters inside`).toBe(`${NOTE}${NL} rest of it `);
      }
    }
  });

  it('a match that is one token span and begins beyond the margin is dropped where it reaches the window; one that holds a space is the named residual (final check W2)', () => {
    const b64 = (n: number): string => Array.from(libGrepRandom(n), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[b % 64]!).join('');
    const seg = (n: number): string => Array.from({ length: n }, () => alnum(9)).join('.');
    const closed: [string, string, string][] = [
      ['NAME= base64', 'SECRET_TOKEN=', b64(120_000)],
      ['Bearer, dotted', 'Authorization: Bearer ', seg(11_000)],
      ['JWT, first segment past the margin', 'jwt ', `eyJ${alnum(120_000)}.eyJzdWIiOiJ6cSJ9.${alnum(43)}`],
      ['?token=', 'GET https://h.example/cb?token=', b64(120_000)],
    ];
    for (const [form, key, value] of closed) {
      const text = `log start${NL}${key}${value}${NL}after ${'q '.repeat(1000)}`;
      const at = text.indexOf(value);
      const whole = libGrep.redactForDisplay(text, none);
      for (const lo of [at + 100_000, at + value.length - 20]) {
        const shown = value.slice(lo - at - 8, lo - at + 300);
        expect(pieces([whole], shown), `${form}: CONTROL: the whole text masks it`).toEqual([]);
        expect(pieces([libGrep.redactDisplayWindow(text, lo, lo + 300, none)], shown), `${form}: window at ${lo - at}`).toEqual([]);
      }
    }
    // The residual (spec §8.3): a match that holds a space, its key more than the margin before the window, is read
    // only from a break inside it, so the window shows what the whole text masks. Pinned so that a change is seen.
    const words = Array.from({ length: 20_000 }, (_, i) => `word${i}`).join(' ');
    const pw = `{${Q}password${Q}: ${Q}${words}${Q}}`;
    expect(libGrep.redactForDisplay(pw, none), 'residual: CONTROL: the whole text masks it').not.toContain('word11119');
    const lo = pw.indexOf('word11119');
    expect(libGrep.redactDisplayWindow(pw, lo, lo + 40, none), 'residual: the window shows it').toContain('word11119');
  });

  it('a window longer than DISPLAY_WINDOW_MAX is shown inexact unless it is the whole text, which is redactForDisplay\'s (final check W4)', () => {
    const big = Array.from({ length: 85_000 }, (_, i) => `w${i % 997}xyzabcd`).join(' ');
    const out = libGrep.redactDisplayWindow(big, 1, big.length, idx);
    expect(big.length - 1, 'CONTROL: the window is longer than DISPLAY_WINDOW_MAX').toBeGreaterThan(libGrep.DISPLAY_WINDOW_MAX);
    expect(big.length, 'CONTROL: the text is within DISPLAY_READINGS_MAX').toBeLessThanOrEqual(libGrep.DISPLAY_READINGS_MAX);
    expect(inexact(out), 'a window past the bound that is not the whole text').toBe(true);
    expect(libGrep.redactDisplayWindow(big, 0, big.length, idx) === libGrep.redactForDisplay(big, idx), 'the whole text').toBe(true);
  });
});

describe('lib: describe\'s arguments (W1-B2 task 15)', () => {
  it('parseDescribeArgs: one target (an id, a prefix, a pasted line\'s words or --node), --full, --cursor only with --full, scope flags passed over', () => {
    const ok = (argv: string[]) => {
      const r = libDescribe.parseDescribeArgs(argv);
      expect(r.ok, argv.join(' ')).toBe(true);
      return r.ok ? r.args : null;
    };
    expect(ok(['L0123456789abcdef0123'])).toEqual({ target: 'L0123456789abcdef0123', full: false, cursor: null, json: false });
    expect(ok(['History:', 'node', 'L0123ab…', '(this', 'compaction)'])?.target).toBe('History: node L0123ab… (this compaction)');
    expect(ok(['--node', 'L0123ab', '--json'])).toEqual({ target: 'L0123ab', full: false, cursor: null, json: true });
    expect(ok(['--full', '--cursor', 'abc', 'L0123ab', '--workspace', '--session', 'claude-b-demo']))
      .toEqual({ target: 'L0123ab', full: true, cursor: 'abc', json: false });
    for (const bad of [
      [], ['--json'], ['--node', 'L0123ab', 'L0123ab'], ['--full', '--full', 'L0123ab'], ['--frob', 'L0123ab'],
      ['L0123ab', '--cursor'], ['--cursor', 'abc', 'L0123ab'],
    ]) {
      expect(libDescribe.parseDescribeArgs(bad), JSON.stringify(bad)).toEqual({ ok: false, reason: 'bad-args' });
    }
  });
});

describe('lib: expand decisions (W1-B2 Task 16; spec §8.4 expand, §8.3 redaction before every cut)', () => {
  const M = t16lib.REDACTED_MARK;
  const SECRET = t16crypto.randomBytes(32).toString('hex');
  const idx = t16lib.makePairIndex(t16lib.secretPairs([SECRET]).pairs);
  const U = '11111111-1111-4111-8111-111111111111';
  /** One surrogate pair, built from its code units so no escape is decoded in transit. */
  const PAIR = String.fromCharCode(0xd83d, 0xde00);

  it('charCost charges each code unit its longest escaped form, XML or JSON; textCost sums a range', () => {
    expect([...`a&<>"\\\n\t\x01${String.fromCharCode(0xe9)}`].map((c) => t16lib.charCost(c.charCodeAt(0)))).toEqual([1, 5, 4, 4, 2, 2, 2, 2, 6, 1]);
    expect(t16lib.charCost(0xd83d)).toBe(6);
    expect(t16lib.textCost('a&b')).toBe(7);
    expect(t16lib.textCost('xxa&b', 2)).toBe(7);
    expect(t16lib.textCost('xxa&b', 2, 3)).toBe(1);
  });

  it('pageEnd stops before the budget is passed, always moves, and never splits a surrogate pair', () => {
    expect(t16lib.pageEnd('abcdef', 0, 3)).toBe(3);
    expect(t16lib.pageEnd('a&bc', 0, 5)).toBe(1);
    expect(t16lib.pageEnd('&&&', 0, 1), 'a page always takes one character').toBe(1);
    expect(t16lib.pageEnd(`ab${PAIR}cd`, 0, 8), 'the high half fits, the low half does not: back off the pair').toBe(2);
    expect(t16lib.pageEnd(PAIR, 0, 1), 'a pair that alone passes the budget is taken whole').toBe(2);
    expect(t16lib.pageEnd('abc', 3, 10)).toBe(3);
  });

  it('cutText takes at most maxChars and at most the budget, whole surrogate pairs only', () => {
    expect(t16lib.cutText('abcdef', 4, 100)).toBe('abcd');
    expect(t16lib.cutText('&&&&&', 10, 12)).toBe('&&');
    expect(t16lib.cutText(`ab${PAIR}`, 3, 100)).toBe('ab');
    expect(t16lib.cutText('', 4, 100)).toBe('');
    expect(t16lib.PAGE_TEXT_BUDGET).toBe(t16lib.OUTPUT_CAP - 2000);
    expect(2 * t16lib.CUT_TEXT_BUDGET, 'a cut item always fits an empty page').toBeLessThan(t16lib.PAGE_TEXT_BUDGET);
    expect(t16lib.EXPAND_MIN_PARTIAL).toBeLessThan(t16lib.PAGE_TEXT_BUDGET);
  });

  it('expandTargetOf: a node id or prefix, an entry uuid or raw-row key, else bad', () => {
    expect(t16lib.expandTargetOf('L0123ab')).toBe('node');
    expect(t16lib.expandTargetOf(`N${'a'.repeat(20)}`)).toBe('node');
    expect(t16lib.expandTargetOf(U)).toBe('entry');
    expect(t16lib.expandTargetOf(`x${'0'.repeat(32)}`)).toBe('entry');
    for (const s of ['L0123a', 'L0123AB', `L${'a'.repeat(21)}`, '../x', '', 'zz']) expect(t16lib.expandTargetOf(s), s).toBe('bad');
  });

  it('expandArgsOf takes Task 10\'s parsed whitelist answer: one target or --around, never both; a bare cursor resumes what it names', () => {
    const parsed = (argv: string[]): { positional: readonly string[]; opts: Record<string, unknown> } => {
      const r = t16lib.parseReadArgs('expand', argv) as { ok: boolean; positional?: readonly string[]; opts?: Record<string, unknown> };
      expect(r.ok, `CONTROL: Task 10's whitelist admits ${argv.join(' ')}`).toBe(true);
      return { positional: r.positional!, opts: r.opts! };
    };
    const D = t16lib.AROUND_DEFAULT;
    expect(t16lib.expandArgsOf(parsed(['L0123ab']))).toEqual({ ok: true, args: { target: 'L0123ab', around: null, before: D, after: D, cursor: null } });
    expect(t16lib.expandArgsOf(parsed(['--around', U, '--before', '2', '--after', '50', '--json'])))
      .toEqual({ ok: true, args: { target: null, around: U, before: 2, after: 50, cursor: null } });
    expect(t16lib.expandArgsOf(parsed(['--cursor', 'abc']))).toEqual({ ok: true, args: { target: null, around: null, before: D, after: D, cursor: 'abc' } });
    for (const b of [['L0123ab', 'L0123ac'], ['L0123ab', '--around', U]]) expect(t16lib.expandArgsOf(parsed(b)), b.join(' ')).toEqual({ ok: false, reason: 'bad-args' });
    expect(t16lib.expandResumeOf({ v: 1, resource: 'expand', t: 'L0123ab', i: 0, o: 0 })).toEqual({ target: 'L0123ab', around: null, before: D, after: D });
    expect(t16lib.expandResumeOf({ v: 1, resource: 'expand', t: `around:${U}:2:7`, i: 0, o: 0 })).toEqual({ target: null, around: U, before: 2, after: 7 });
    for (const c of [{ t: 'zz' }, { t: 7 }, {}, null]) expect(t16lib.expandResumeOf(c), JSON.stringify(c)).toBeNull();
  });

  it('entryScopeVerdict, expandCuts and decideExpandCursor', () => {
    expect(t16lib.entryScopeVerdict({ found: false, inScope: false })).toBe('not-found');
    expect(t16lib.entryScopeVerdict({ found: false, inScope: true })).toBe('not-found');
    expect(t16lib.entryScopeVerdict({ found: true, inScope: false }), 'out of scope is never not-found').toBe('out-of-scope');
    expect(t16lib.entryScopeVerdict({ found: true, inScope: true })).toBe('ok');
    expect(t16lib.expandCuts({ whole: true, kind: 'sidecar', provenance: null })).toBe(false);
    expect(t16lib.expandCuts({ whole: false, kind: 'sidecar', provenance: null })).toBe(true);
    for (const [prov, cut] of [['tool', true], ['recall-echo', true], ['model', false], ['operator', false], ['harness', false]] as const) {
      expect(t16lib.expandCuts({ whole: false, kind: 'entry', provenance: prov }), prov).toBe(cut);
    }
    expect(t16lib.decideExpandCursor({ cursor: null, key: 'K', total: 3 })).toEqual({ ok: true, i: 0, o: 0 });
    expect(t16lib.decideExpandCursor({ cursor: { v: 1, resource: 'expand', t: 'K', i: 2, o: 10 }, key: 'K', total: 3 })).toEqual({ ok: true, i: 2, o: 10 });
    for (const c of [{ t: 'J', i: 0, o: 0 }, { t: 'K', i: 3, o: 0 }, { t: 'K', i: 0, o: -1 }, { t: 'K', i: 1.5, o: 0 }, { t: 'K', i: '1', o: 0 }]) {
      expect(t16lib.decideExpandCursor({ cursor: c, key: 'K', total: 3 }), JSON.stringify(c)).toEqual({ ok: false });
    }
  });

  it('delegateHint answers above three times the cap only; expandBlobFits bounds one call\'s decompression at SIDECAR_WHOLE_MAX', () => {
    expect(t16lib.delegateHint(t16lib.DELEGATE_FACTOR * t16lib.OUTPUT_CAP)).toBeNull();
    expect(t16lib.delegateHint(t16lib.DELEGATE_FACTOR * t16lib.OUTPUT_CAP + 1), 'cli.mjs prefixes `hint: ` itself').toMatch(/^delegate: /);
    expect(t16lib.expandBlobFits(0)).toBe(true);
    expect(t16lib.expandBlobFits(t16lib.SIDECAR_WHOLE_MAX)).toBe(true);
    expect(t16lib.expandBlobFits(t16lib.SIDECAR_WHOLE_MAX + 1)).toBe(false);
  });

  it('toolUseInputPath tells "this tool_use names no file" from "no paired tool_use here"', () => {
    const content = [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/u/a.ts' } },
      { type: 'tool_use', id: 't2', name: 'NotebookEdit', input: { notebook_path: '/home/u/n.ipynb' } },
      { type: 'tool_use', id: 't3', name: 'Grep', input: { path: '/home/u/src' } }, { type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 't5', name: 'Odd', input: null }];
    expect(t16lib.toolUseInputPath(content, 't1')).toEqual({ found: true, path: '/home/u/a.ts' });
    expect(t16lib.toolUseInputPath(content, 't2')).toEqual({ found: true, path: '/home/u/n.ipynb' });
    expect(t16lib.toolUseInputPath(content, 't3')).toEqual({ found: true, path: '/home/u/src' });
    expect(t16lib.toolUseInputPath(content, 't4'), 'found, naming no file: the pairing walk stops here').toEqual({ found: true, path: null });
    expect(t16lib.toolUseInputPath(content, 't5')).toEqual({ found: true, path: null });
    expect(t16lib.toolUseInputPath(content, 'nope')).toEqual({ found: false });
    expect(t16lib.toolUseInputPath('a string body', 't1')).toEqual({ found: false });
  });

  it('renderEntryText renders a row\'s raw text; its window through redactDisplayWindow masks a value in a leaf, behind an escape JSON glued on, and in a KEY (R38)', () => {
    // SECRET is pair-only here (makePairIndex without belt units), so only the escape readings separate it from an
    // escape letter JSON rendering glued on: the shape of review 316 F2, reached through a key on expand's path.
    const show = (t: string): string => t16lib.redactDisplayWindow(`p ${t} q`, 2, 2 + t.length, idx);
    const body = [
      { type: 'text', text: `a\n${SECRET}` },
      { type: 'tool_use', id: 't', name: 'Bash', input: { command: `echo\n${SECRET}`, n: 1 } },
    ];
    const raw = t16lib.renderEntryText(body);
    expect(raw, 'the raw rendering: nothing is redacted here').toBe(`a\n${SECRET}\n[tool_use Bash] {"command":"echo\\n${SECRET}","n":1}`);
    expect(show(raw), 'a deeper reading removed the glued value, so the window shows that reading, decoded')
      .toBe(`a\n${M}\n[tool_use Bash] {"command":"echo\n${M}","n":1}`);
    expect(show(t16lib.renderEntryText([{ type: 'tool_result', tool_use_id: 't', content: `out ${SECRET}` }]))).toBe(`out ${M}`);
    expect(t16lib.renderEntryText([{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'a' }, { type: 'image' }] }]))
      .toBe('a\n[image]');
    expect(show(t16lib.renderEntryText(`\x1b[32m${SECRET}\x1b[0m`)), 'a token behind an SGR code').toBe(`\x1b[32m${M}\x1b[0m`);
    expect(show(t16lib.renderEntryText({ kind: 'attachment', value: SECRET }))).toBe(`{"kind":"attachment","value":"${M}"}`);
    expect(t16lib.renderEntryText(null)).toBe('');
    const keyed = t16lib.renderEntryText([{ type: 'tool_use', id: 'k', name: 'WebFetch', input: { headers: { [`\n${SECRET}`]: 'x', [`\t${SECRET}`]: 'y' } } }]);
    expect(keyed, 'CONTROL: JSON glued the escape letter onto the key').toContain(`\\n${SECRET}`);
    expect(t16lib.redactField(keyed, idx), 'CONTROL: one reading cannot separate it').toContain(SECRET);
    expect(show(keyed)).toBe(`[tool_use WebFetch] {"headers":{"\n${M}":"x","\t${M}":"y"}}`);
  });

  it('exploreOutline explores the redacted window up to EXPLORE_READ_MAX and counts only past it', () => {
    const code = ["import fs from 'node:fs';", `export const f = (k = '${SECRET}') => k;`, 'export function main() {}'].join('\n');
    const o = t16lib.exploreOutline(code, 'code', 'a.ts', idx);
    expect(o, 'CONTROL: the code explorer ran').toContain('Imports/dependencies (1)');
    expect(o, 'CONTROL: the signature line holding the value is in the outline').toContain('export const f = (k =');
    expect(o).not.toContain(SECRET.slice(0, 8));
    const big = 'x\n'.repeat(t16lib.EXPLORE_READ_MAX);
    expect(t16lib.exploreOutline(big, 'code', 'a.ts', idx)).toBe(['Structured summary:', `Characters: ${big.length.toLocaleString('en-US')}.`,
      `Lines: ${(t16lib.EXPLORE_READ_MAX + 1).toLocaleString('en-US')}.`].join('\n'));
    expect(t16lib.EXPLORE_READ_MAX, 'the outline bound is under the JSON one, so a JSON past it is counts only either way').toBeLessThanOrEqual(t16lib.EXPLORE_JSON_MAX);
  });
});

describe('lib: expand fix round 1 (W1-B2 Task 16)', () => {
  it("exploreOutline's counts-only branch equals exploreCounts(stripReadPrefix(t)) on every shape", () => {
    const N = 30_000;
    const lines = (f: (i: number) => string): string => Array.from({ length: N }, (_, i) => f(i)).join('');
    const plain = Array.from({ length: N }, (_, i) => `plain line ${i} of the text`).join('\n');
    const shapes: Record<string, string> = {
      'consecutive Read-prefixed lines': lines((i) => `${String(i + 1).padStart(6)}→line ${i}\n`),
      'numbering broken at line 1,000': lines((i) => `${String(i < 1000 ? i + 1 : i + 3).padStart(6)}→line ${i}\n`),
      'tab-form prefixes joined by CRLF': Array.from({ length: N }, (_, i) => `${i + 1}\tcol ${i}`).join('\r\n'),
      'plain text, no trailing newline': plain,
      'plain text ending in a newline': `${plain}\n`,
      'a first line 7→ then 8→ then plain': `   7→x\n   8→y\n${plain}`,
    };
    for (const [name, t] of Object.entries(shapes)) {
      expect(t.length > t16f.EXPLORE_READ_MAX, `CONTROL: ${name} is past EXPLORE_READ_MAX`).toBe(true);
      const s = t16f.stripReadPrefix(t);
      const expected = ['Structured summary:', `Characters: ${s.length.toLocaleString('en-US')}.`, `Lines: ${s.split(/\r?\n/).length.toLocaleString('en-US')}.`].join('\n');
      expect(t16f.exploreOutline(t, 'code', undefined, t16f.makePairIndex([])), name).toBe(expected);
    }
  });

  it('a counts-only outline of a 64 MiB newline-dense item stays far under the 1 GiB bound (a child process)', () => {
    const SCRIPT = [
      'const L = await import(process.argv[1]);',
      "const t = '\\n'.repeat(64 * 1024 * 1024);",
      "const out = L.exploreOutline(t, 'code', undefined, L.makePairIndex([]));",
      'process.stdout.write(JSON.stringify({ out, rss: process.resourceUsage().maxRSS }));',
    ].join('\n');
    const lib = new URL('../../ccd/history/lib.mjs', import.meta.url).href;
    const r = libGrepSpawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', SCRIPT, lib], { encoding: 'utf8', timeout: 240_000 });
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(r.stdout) as { out: string; rss: number };
    expect(m.out, 'CONTROL: the counts are of the whole item').toContain('Lines: 67,108,865.');
    expect(m.rss < 512 * 1024, `peak RSS ${m.rss} KiB`).toBe(true);
  }, 300_000);

  it('a resumed --around window keeps AROUND_MAX: 50 and 50 resume, 51 or 99 on either side are null', () => {
    const U = '11111111-1111-4111-8111-111111111111';
    const at = (b: number, a: number) => t16f.expandResumeOf({ t: `around:${U}:${b}:${a}` } as never);
    expect(at(50, 50)).toEqual({ target: null, around: U, before: 50, after: 50 });
    expect(at(51, 0)).toBeNull();
    expect(at(0, 99)).toBeNull();
  });
});

describe('lib: version-aware reads (W1-B2 Task 17; spec §6.11 "The CLI keeps answering", DM44)', () => {
  type Schema = Readonly<Record<number, { heavy: boolean; tables: Readonly<Record<string, readonly string[]>> }>>;
  const V1 = t17lib.SCHEMA_ADDED[1]!;

  it('VERB_TABLES covers exactly the read verbs and names only tables SCHEMA_ADDED declares, so a v1 store misses none', () => {
    expect(Object.keys(t17lib.VERB_TABLES).sort()).toEqual([...t17lib.READ_VERBS].sort());
    for (const [verb, tables] of Object.entries(t17lib.VERB_TABLES)) {
      expect(t17lib.missingTablesAt(t17lib.SCHEMA_VERSION, verb), verb).toEqual([]);
      for (const t of tables) expect(Object.keys(V1.tables), `${verb}.${t}`).toContain(t);
    }
  });

  it('missingTablesAt reads the STORE version: a table a later version adds is missing below it, and a newer store misses nothing', () => {
    const seam: Schema = { ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: { seam_table: ['x'] } } };
    const vt = { ...t17lib.VERB_TABLES, tree: [...t17lib.VERB_TABLES.tree, 'seam_table'] };
    expect(t17lib.missingTablesAt(1, 'tree', seam, vt)).toEqual(['seam_table']);
    expect(t17lib.missingTablesAt(2, 'tree', seam, vt)).toEqual([]);
    expect(t17lib.missingTablesAt(3, 'tree', seam, vt)).toEqual([]);
    expect(t17lib.missingTablesAt(1, 'grep', seam, vt), 'only the verb that needs it').toEqual([]);
    expect(() => t17lib.missingTablesAt(1, 'touched')).toThrow(TypeError);
  });

  it('schemaAdditive: the real SCHEMA_ADDED is additive and equals what MIGRATIONS build; a rename, a drop, a re-listed column, an unknown key or a gap is refused', async () => {
    const store = await import('../../ccd/history/store.mjs');
    const measure = (migrations: readonly string[]): Record<number, Record<string, string[]>> => {
      const db = new t17sqlite.DatabaseSync(':memory:');
      try {
        const out: Record<number, Record<string, string[]>> = {};
        migrations.forEach((m, i) => { db.exec(m); out[i + 1] = store.schemaOf(db); });
        return out;
      } finally { db.close(); }
    };
    expect(t17lib.schemaAdditive(t17lib.SCHEMA_ADDED, measure(store.MIGRATIONS))).toEqual({ ok: true });
    const lostOf = (r: { ok: boolean; lost?: string[] }): string[] => (r.ok ? [] : r.lost!);
    const renamed: Schema = { ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: { nodes: ['gist2'] } } };
    expect(lostOf(t17lib.schemaAdditive(renamed, measure([...store.MIGRATIONS, 'ALTER TABLE nodes RENAME COLUMN gist TO gist2']))))
      .toContain('nodes.gist lost at v2');
    const dropped: Schema = { ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: {} } };
    expect(lostOf(t17lib.schemaAdditive(dropped, measure([...store.MIGRATIONS, 'ALTER TABLE nodes DROP COLUMN topics']))))
      .toContain('nodes.topics lost at v2');
    expect(lostOf(t17lib.schemaAdditive({ ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: { nodes: ['gist'] } } })))
      .toContain('nodes.gist re-listed at v2');
    const unknownKey = { ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: {}, drops: { nodes: ['gist'] } } } as unknown as Schema;
    expect(lostOf(t17lib.schemaAdditive(unknownKey))).toContain('v2 has keys drops,heavy,tables');
    expect(lostOf(t17lib.schemaAdditive({ ...t17lib.SCHEMA_ADDED, 3: { heavy: false, tables: { seam: ['x'] } } }))).toContain('versions are not 1..N');
    const undeclared = measure([...store.MIGRATIONS, 'CREATE TABLE seam_extra (x INTEGER)']);
    expect(lostOf(t17lib.schemaAdditive({ ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: {} } }, undeclared))).toContain('seam_extra.x undeclared at v2');
  });
});

describe('C43: no ccd/history module prepares SELECT * (W1-B2 Task 17; the server/src/coord/db.ts rule)', () => {
  /** Star selects in code, with comments removed: a block comment, and a line comment not preceded by `:` (a
   *  URL) or a quote. */
  const starSelects = (src: string): string[] => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    return [...code.matchAll(/\bSELECT\s+(?:DISTINCT\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\.)?\*/gi)].map((m) => m[0]);
  };

  it('CONTROL: the scan sees a star select on one line and across a line break, and none inside a comment', () => {
    expect(starSelects('db.prepare("SELECT * FROM x")')).toHaveLength(1);
    expect(starSelects('db.prepare(`SELECT\n  e.* FROM entries e`)')).toHaveLength(1);
    expect(starSelects('db.prepare("select distinct * from x")')).toHaveLength(1);
    expect(starSelects('// queries never SELECT * here\n/** nor SELECT * here */\nconst u = "https://x/y";')).toEqual([]);
  });

  it('every ccd/history/*.mjs names its columns', () => {
    const dir = t17path.join(REPO, 'ccd', 'history');
    const files = t17fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
    expect(files).toEqual(expect.arrayContaining(['cli.mjs', 'derive.mjs', 'lib.mjs', 'recall.mjs', 'regex-worker.mjs', 'store.mjs', 'sweep.mjs']));
    for (const f of files) expect(starSelects(t17fs.readFileSync(t17path.join(dir, f), 'utf8')), f).toEqual([]);
  });
});

describe('lib: Task 17 fix round 1 (W1-B2 Task 17)', () => {
  type Schema = Readonly<Record<number, { heavy: boolean; tables: Readonly<Record<string, readonly string[]>> }>>;
  const lostOf = (r: { ok: boolean; lost?: string[] }): string[] => (r.ok ? [] : r.lost!);

  it('schemaAdditive flags a declared version nothing measured', () => {
    const m1 = { 1: t17lib.SCHEMA_ADDED[1]!.tables as Record<string, string[]> };
    expect(t17lib.schemaAdditive(t17lib.SCHEMA_ADDED, m1), 'CONTROL: one declared version, one measured').toEqual({ ok: true });
    const r = t17lib.schemaAdditive({ ...t17lib.SCHEMA_ADDED, 2: { heavy: false, tables: { nodes: ['zq_new_col'] } } } as Schema, m1);
    expect(r.ok).toBe(false);
    expect(lostOf(r)).toContain('v2 declared but not measured');
  });

  it('schemaAdditive refuses a column set that is not a list', () => {
    const r = t17lib.schemaAdditive({ 1: { heavy: false, tables: { t: 'ab' } } } as unknown as Schema);
    expect(r.ok).toBe(false);
    expect(lostOf(r)).toContain('t at v1 lists no array of columns');
  });
});

describe('lib: paneReadWanted, the one rule both operator doors read a pane by (W1-B2 Task 19; spec §8.2, §8.4 speed bumps)', () => {
  it('an irreversible form from a pane id of the %N grammar, and nothing else', () => {
    expect(t19lib.paneReadWanted('prune-apply', '%3')).toBe(true);
    expect(t19lib.paneReadWanted('adopt', '%12')).toBe(true);
    expect(t19lib.paneReadWanted('import-session-apply', '%0')).toBe(true);
    const no: Array<[string | null, string | null]> = [
      ['backup', '%3'], ['import-apply', '%3'], ['migrate', '%3'], [null, '%3'], ['unknown-op', '%3'], ['__proto__', '%3'],
      ['prune-apply', ''], ['prune-apply', null], ['prune-apply', '3'], ['prune-apply', '%3;x'], ['prune-apply', '%'],
    ];
    for (const [form, pane] of no) expect(t19lib.paneReadWanted(form, pane), `${String(form)} ${String(pane)}`).toBe(false);
  });
});
