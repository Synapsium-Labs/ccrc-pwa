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
