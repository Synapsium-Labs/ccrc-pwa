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
import {
  SPOOL_KEYS, SPOOL_LINE_MAX, DRAINING_NAME_MAX, JOURNAL_V, CONFIRM_BY, GENERATION_VIA, splitSpoolText, parseSpoolLine, drainingNameOk,
  parseJournalRecord, journalRecord,
} from '../../ccd/history/lib.mjs';
import * as libPlan from '../../ccd/history/lib.mjs';
import * as libEpoch from '../../ccd/history/lib.mjs';
import * as libRows from '../../ccd/history/lib.mjs';
import * as rowFx from './historyFixtures.js';
import * as libRedact from '../../ccd/history/lib.mjs';
import * as historyCrypto from 'node:crypto';
import * as libExport from '../../ccd/history/lib.mjs';

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
    journaled: null, heldMatches: {}, ...o,
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
  it('a kept list with any non-string element is NULL and named in missing, exactly as an absent one (Review Focus 1)', () => {
    for (const allUuids of [[1, 2], ['u1', 2]]) {
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
  it('a field with no CSI sequence takes the per-fragment path alone (a bare ESC is not a CSI)', () => {
    const tok = rndHex(32);
    const idx = idxOf([tok]);
    expect(libRedact.redactField(`\x1b${tok}\x1b`, idx)).toBe(`\x1b${M}\x1b`);
    expect(libRedact.redactField('no secret \x1b here', idx)).toBe('no secret \x1b here');
  });
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
