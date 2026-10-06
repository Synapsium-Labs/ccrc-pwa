// server/test/history-lib.test.ts
// ccrc history's policy ring, `ccd/history/lib.mjs`, imported directly (the
// `compact-card.test.ts` precedent: a deploy-side `.mjs` the PWA never
// bundles, typed by its hand-written `.d.mts`). Pure: nothing here needs a
// fixture HOME except O53's bash half, which runs ccrc's own `_box_env_value`
// — lifted out of the shipped `ccd/ccrc`, never copied — over the same bytes
// in a scratch directory. Runs on darwin too (spec §13: lib tests run there).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
  canonicalJson, sha256Hex, sha256Bytes, digestText, leafId, parentId, eventKey, blobShaOfBody, blobShaOfBytes,
} from '../../ccd/history/lib.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(REPO, 'ccd', 'history', 'lib.mjs');

describe('lib.mjs is L1: its import block is node:crypto and nothing else (spec §6.4, §13)', () => {
  const src = readFileSync(LIB, 'utf8');

  it('imports exactly node:crypto — no fs, no sqlite, no child_process, nothing that imports them', () => {
    const specs = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
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
