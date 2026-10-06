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
