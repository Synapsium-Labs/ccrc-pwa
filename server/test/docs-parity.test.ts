// Docs parity (spec 2026-10-01): a value the Docs feature spells in more than one place is held equal here, and a
// value it spells in one place is held to that one place where single-definition.test.ts cannot see it.
// Docs W1a Task 5 lands M7.3's TS half: one DOCS_PAGE_PREFIX across the four TS roots. Later W1 tasks append the
// helper's rows below (row 48, row 62, M3.12, helper hygiene); W4 appends M7.3's doctor half. APPEND ONLY.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_PAGE_PREFIX } from '../../shared/docs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const rel = (p: string): string => path.relative(ccrcRoot, p);

/** single-definition.test.ts's four ROOTS, walked the same way: `.ts`/`.tsx` only, and `__`-prefixed entries
 *  skipped, because those are transient mutants a parallel suite writes and deletes (`boot.test.ts`). */
const TS_ROOTS = ['shared', path.join('server', 'src'), path.join('pwa', 'src'), path.join('agent', 'src')]
  .map((r) => path.join(ccrcRoot, r));
function tsSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('__')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...tsSources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** One entry per DECLARATION of DOCS_PAGE_PREFIX, named by its file: exported or not, const, let or var. An
 *  import, a use, a re-export and a comment declare nothing. */
const PREFIX_DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+DOCS_PAGE_PREFIX\s*=/gm;
function prefixDefs(files: readonly (readonly [string, string])[]): string[] {
  const out: string[] = [];
  for (const [name, text] of files) {
    const n = text.match(PREFIX_DEF)?.length ?? 0;
    for (let i = 0; i < n; i++) out.push(name);
  }
  return out;
}

describe('M7.3 (TS half): one DOCS_PAGE_PREFIX across the four TS roots', () => {
  it('CONTROL: the scan counts every declaration shape, two in one file as two, and nothing else', () => {
    expect(prefixDefs([
      ['a.ts', "export const DOCS_PAGE_PREFIX = '/docs';"],
      ['b.ts', "  const DOCS_PAGE_PREFIX='/docs';\nlet DOCS_PAGE_PREFIX = p;"],
      ['c.ts', [
        "import { DOCS_PAGE_PREFIX } from '../../shared/docs.js';",
        "const p = DOCS_PAGE_PREFIX + '/';",
        "// const DOCS_PAGE_PREFIX = '/docs' (prose)",
        'export { DOCS_PAGE_PREFIX };',
        "if (u.startsWith(DOCS_PAGE_PREFIX)) return '/docs';",
      ].join('\n')],
    ])).toEqual(['a.ts', 'b.ts', 'b.ts']);
  });

  it('is declared exactly once, in shared/docs.ts', () => {
    const files = TS_ROOTS.flatMap(tsSources).map((f) => [rel(f), readFileSync(f, 'utf8')] as const);
    // Vacuity: the walk reached all four roots, so an empty result could not pass the pin below.
    for (const want of ['shared/docs.ts', 'server/src/index.ts', 'pwa/src/app.tsx', 'agent/src/server.ts']) {
      expect(files.map(([name]) => name), want).toContain(want);
    }
    expect(prefixDefs(files)).toEqual(['shared/docs.ts']);
  });

  it("its value is '/docs': the declaration is that literal, and the import reads it", () => {
    expect(DOCS_PAGE_PREFIX).toBe('/docs');
    expect(readFileSync(path.join(ccrcRoot, 'shared', 'docs.ts'), 'utf8'))
      .toMatch(/^export const DOCS_PAGE_PREFIX = '\/docs';$/m);
  });
});

// ---- Task 6: the helper's FAILURES and REDACT_RULES (row 48), one redactor in two languages (row 62, helper
// half), and the helper source's hygiene (spec 2026-10-01 section 2 (a) Shape, (b) exit contract and One redactor,
// section 7.2) ----
// The python side is the SHIPPED helper, extracted out of ccd/ccd's heredoc and imported as a module (`unitJson`).
// Aliased imports: this block sits below the file's own imports, so it binds no local name those may already bind.
// It reuses the module scope's `readFileSync` and `path`; ccd/ccd's own path is `CCD`, never spelled here
// (`single-definition.test.ts`, "one path to the ccd script").
import { afterAll as afterAllT6 } from 'vitest';
import { spawnSync as spawnSyncT6 } from 'node:child_process';
import { writeFileSync as writeFileT6 } from 'node:fs';
import {
  DOCS_CCD_FAILURES as ccdFailuresT6, DOCS_REDACT_RULES as redactRulesT6, redactDocsText as redactTextT6,
} from '../../shared/docs.js';
import { CCD as ccdScriptT6, makeCcdHarness as harnessT6 } from './ccdWsHelpers.js';
import { REAL_PYTHON3 as realPythonT6 } from './ccdDocsHelpers.js';
import {
  DOCS_PY_CLOSE as pyCloseT6, DOCS_PY_OPEN as pyOpenT6, docsHelperSource as helperSourceT6, pyLiteral as pyLiteralT6,
  unitJson as unitJsonT6,
} from './docsHelperPy.js';

describe('the helper FAILURES and REDACT_RULES equal shared/docs.ts (row 48)', () => {
  const h = harnessT6('ccd-docs-');
  afterAllT6(() => h.cleanup());
  /** Read when a case runs, never at collection: a missing helper reds these cases, not the file's others. */
  const src = (): string => helperSourceT6();

  it('FAILURES is exactly DOCS_CCD_FAILURES, as a set, in both directions', () => {
    const py = unitJsonT6<string[]>(h.home, 'out(sorted(H.FAILURES))');
    const ts: readonly string[] = ccdFailuresT6;
    expect(new Set(ts).size, 'DOCS_CCD_FAILURES holds no word twice').toBe(ts.length);
    expect(py.filter((w) => !ts.includes(w)), 'in the helper only').toEqual([]);
    expect(ts.filter((w) => !py.includes(w)), 'in shared/docs.ts only').toEqual([]);
    expect(py).toHaveLength(ts.length);
  });

  it('REDACT_RULES equals DOCS_REDACT_RULES, row by row and in order', () => {
    const py = unitJsonT6<string[][]>(h.home, 'out([list(rule) for rule in H.REDACT_RULES])');
    expect(py).toEqual(redactRulesT6.map(([pattern, suffix]) => [pattern, suffix]));
  });

  it('each is ONE single-line NAME= literal, between the docs-parity markers', () => {
    expect(pyLiteralT6(src(), 'FAILURES')).toMatch(/^frozenset\(\{'[a-z-]+'(?:,'[a-z-]+')*\}\)$/);
    expect(pyLiteralT6(src(), 'REDACT_RULES')).toMatch(/^\(\(r'.*'\)\)$/);
    const lines = src().split('\n');
    const begin = lines.indexOf('# docs-parity: begin');
    const end = lines.indexOf('# docs-parity: end');
    for (const name of ['FAILURES', 'REDACT_RULES']) {
      const at = lines.findIndex((l) => l.startsWith(`${name}=`));
      expect(at > begin && at < end, `${name} sits inside the block`).toBe(true);
    }
  });

  it('CONTROL: pyLiteral counts a second binding in any spelling, and refuses one that is not canonical', () => {
    expect(pyLiteralT6('A=1\nAB=2\nif A == 1:\n    B = A\n', 'A')).toBe('1');
    expect(() => pyLiteralT6('A=1\n    A = 2\n', 'A')).toThrow(/bound 2 times/);
    expect(() => pyLiteralT6('A=1\nA: int = 2\n', 'A')).toThrow(/bound 2 times/);
    expect(() => pyLiteralT6('A=1\nA += 2\n', 'A')).toThrow(/bound 2 times/);
    expect(() => pyLiteralT6('A=1\ndef A():\n    pass\n', 'A')).toThrow(/bound 2 times/);
    expect(() => pyLiteralT6('A = 1\n', 'A')).toThrow(/not the single-line/);
    expect(() => pyLiteralT6('B=1\n', 'A')).toThrow(/bound 0 times/);
  });
});

describe('one redactor: the helper and shared/docs.ts agree over one corpus (row 62, helper half)', () => {
  const h = harnessT6('ccd-docs-');
  afterAllT6(() => h.cleanup());
  // Token bodies are built at run time, so this public file never carries a contiguous token-shaped literal.
  const BODY24 = 'A1b2'.repeat(6);
  const CORPUS: readonly string[] = [
    '',
    'fatal: could not read from remote repository.',
    'https://u:tok@example.invalid/x',
    'fatal: unable to access https://u:tok@example.invalid/x.git/: 403',
    'https://a:b@h1/ https://c:d@h2/',
    'https://example.invalid/a/b@c',
    'GET /x?access_token=abc&x=1',
    'GET /x?a=1&token=z',
    'GET /x?my_token=abc',
    `remote: gho_${BODY24} rejected`,
    `ghs_${BODY24} ghu_${BODY24} (ghp_${BODY24})`,
    `ghp_${'a'.repeat(19)}`,
    `ghx_${BODY24}`,
    'Authorization: Basic xyz',
    'before\n> Authorization: Bearer y\nafter',
    'line1\r\nAuthorization: x\r\nline3',
    'a\rAuthorization: x\rb',
    'a\u{2028}Authorization: x\u{2029}b',
    'Authorization: a\nx\nAuthorization: b',
    'x\nAuthorization:',
    'a https://u:p@h/x?token=t&access_token=q\nAuthorization: Bearer y\nz',
    'https://u\u{001c}tok@h/x',
    'https://u\u{00a0}tok@h/x',
    'https://u\u{feff}tok@h/x',
    'https://u\u{d800}tok@h/x',
    'https://u tok@h/x',
    'https://u\ttok@h/x',
    'caf\u{00e9} https://\u{00e9}:\u{6587}@example.invalid/',
  ];

  it('H.redact and redactDocsText give every corpus string the same result', () => {
    const file = path.join(h.home, 'redact-corpus.json');
    writeFileT6(file, JSON.stringify(CORPUS));
    const py = unitJsonT6<string[]>(h.home, [
      'import json',
      `C = json.load(open(${JSON.stringify(file)}, encoding='utf-8'))`,
      'out([H.redact(s) for s in C])',
    ].join('\n'));
    const ts = CORPUS.map(redactTextT6);
    expect(py).toHaveLength(CORPUS.length);
    expect(CORPUS.filter((_s, i) => py[i] !== ts[i])).toEqual([]);
    // Vacuity: the corpus exercises both outcomes, so agreement is not agreement to do nothing.
    expect(CORPUS.filter((s, i) => ts[i] !== s).length).toBeGreaterThanOrEqual(12);
    expect(CORPUS.filter((s, i) => ts[i] === s).length).toBeGreaterThanOrEqual(6);
  });

  // The fourth rule runs over unbounded text before the helper's cut: its work is linear in the line, in both
  // languages. One 1 MiB line with no newline and no Authorization matches nothing, so every start is tried.
  it('H.redact redacts one 1 MiB line with no newline and no Authorization in under 2000 ms', () => {
    const r = unitJsonT6<{ ms: number; same: boolean }>(h.home, [
      'import time',
      "line = 'x' * (1024 * 1024)",
      't0 = time.monotonic()',
      'got = H.redact(line)',
      "out({'ms': (time.monotonic() - t0) * 1000, 'same': got == line})",
    ].join('\n'), { timeoutMs: 600_000 });
    expect(r.same).toBe(true);
    expect(r.ms).toBeLessThan(2000);
  }, 600_000);

  it('the helper\'s redactor is idempotent over the same corpus', () => {
    const file = path.join(h.home, 'redact-idem.json');
    writeFileT6(file, JSON.stringify(CORPUS));
    const py = unitJsonT6<boolean[]>(h.home, [
      'import json',
      `C = json.load(open(${JSON.stringify(file)}, encoding='utf-8'))`,
      'out([H.redact(H.redact(s)) == H.redact(s) for s in C])',
    ].join('\n'));
    expect(py).toEqual(CORPUS.map(() => true));
  });
});

describe('the helper source: one write, python 3.8, ASCII, and its section markers (spec section 2 (a), (b), 7.2)', () => {
  const h = harnessT6('ccd-docs-');
  afterAllT6(() => h.cleanup());
  /** Read when a case runs, never at collection: a missing helper reds these cases, not the file's others. */
  const src = (): string => helperSourceT6();
  /** The skeleton every later W1 task inserts its code after (one section each), in file order. */
  const MARKERS = [
    '# ===== docs: header =====', '# docs-parity: begin', '# docs-parity: end', '# ===== docs: core =====',
    '# ===== docs: grammar =====', '# ===== docs: runner =====', '# ===== docs: discovery =====',
    '# ===== docs: refs =====', '# ===== docs: listing =====', '# ===== docs: stamps =====',
    '# ===== docs: index =====', '# ===== docs: holders =====', '# ===== docs: drafts =====',
    '# ===== docs: tree =====', '# ===== docs: show =====', '# ===== docs: fetch =====', '# ===== docs: entry =====',
  ];
  const parse38 = (code: string) => spawnSyncT6(realPythonT6,
    ['-c', 'import ast, sys; ast.parse(sys.stdin.read(), feature_version=(3, 8))'], { input: code, encoding: 'utf8' });

  it('writes stdout in exactly one place, and never through print', () => {
    expect(src().match(/\bsys\.stdout\b/g) ?? []).toHaveLength(1);
    expect(src()).toMatch(/^ {4}sys\.stdout\.buffer\.write\(out\)$/m);
    // Word-bounded: `valid_fingerprint(` (Task 7) ends in the same five letters and is not a call to print.
    expect(src().match(/\bprint\(/g) ?? []).toEqual([]);
  });

  it('reads its argv by fixed index: no option-parsing library', () => {
    expect(src()).not.toMatch(/\bargparse\b|\bgetopt\b|\ballow_abbrev\b/);
  });

  it('parses as python 3.8 (and CONTROL: the same check refuses a 3.10 match statement)', () => {
    const r = parse38(src());
    expect(r.status, r.stderr).toBe(0);
    expect(parse38('match x:\n    case 1:\n        pass\n').status).not.toBe(0);
    expect(src()).not.toMatch(/\.remove(?:prefix|suffix)\(|\bfunctools\.cache\b|\bzoneinfo\b/);
  });

  it('is pure ASCII', () => {
    expect(src().split('\n').flatMap((l, i) => (/[^\x00-\x7f]/.test(l) ? [`${i + 1}: ${l}`] : []))).toEqual([]);
  });

  it('holds every section marker exactly once, in the skeleton\'s order', () => {
    const lines = src().split('\n');
    const at = MARKERS.map((m) => lines.flatMap((l, i) => (l === m ? [i] : [])));
    expect(at.map((hits) => hits.length)).toEqual(MARKERS.map(() => 1));
    const order = at.map((hits) => hits[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('the opener and the terminator are each one whole line of ccd/ccd; the extractor refuses anything else', () => {
    const ccd = readFileSync(ccdScriptT6, 'utf8').split('\n');
    expect(ccd.filter((l) => l === pyOpenT6)).toHaveLength(1);
    expect(ccd.filter((l) => l === pyCloseT6)).toHaveLength(1);
    // CONTROL: planted texts.
    expect(helperSourceT6(['x', pyOpenT6, 'import json', pyCloseT6, 'y'].join('\n'))).toBe('import json\n');
    expect(() => helperSourceT6(['x', pyOpenT6, 'a', pyCloseT6, pyOpenT6, 'b'].join('\n'))).toThrow(/opener/);
    expect(() => helperSourceT6(['x', pyOpenT6, 'a'].join('\n'))).toThrow(/terminator/);
    expect(() => helperSourceT6(['x', pyOpenT6, '', pyCloseT6].join('\n'))).toThrow(/no program/);
    expect(() => helperSourceT6(['x', pyCloseT6, 'a', pyOpenT6].join('\n'))).toThrow(/no program/);
  });

  it('importing the helper runs nothing, and VERBS names exactly the four verbs', () => {
    expect(unitJsonT6<string[]>(h.home, 'out(sorted(H.VERBS))'))
      .toEqual(['docs-fetch', 'docs-index', 'docs-show', 'docs-tree']);
  });
});

// ---- Task 7: row 48, the rest of the parity block (spec 2026-10-01 section 2 (j) row 48) ----
// The helper's `# docs-parity: begin` / `# docs-parity: end` block holds one single-line `NAME=` literal per value
// `shared/docs.ts` declares and ccd enforces. Each is compared BY VALUE (the module imported, the attribute as
// JSON), its assignment is counted (exactly one, via `pyLiteral`), and the block's names are held equal to the
// table in both directions, so a literal added on one side only is red. Every import is aliased: this block sits
// below the file's own imports and binds no name they, or a later task's block, may bind.
import * as parityL0 from '../../shared/docs.js';
import { makeCcdHarness as harnessForParity } from './ccdWsHelpers.js';
import {
  docsHelperSource as helperSourceForParity, pyLiteral as literalForParity, unitJson as unitForParity,
} from './docsHelperPy.js';

describe('the helper parity block equals shared/docs.ts, by value and in both directions (row 48)', () => {
  const PARITY: readonly (readonly [string, unknown])[] = [
    ['PROJECT_RE', parityL0.DOCS_PROJECT_RE_BODY],
    ['BARE_REF_RE', parityL0.DOCS_BARE_REF_RE_BODY],
    ['REF_MAX_CHARS', parityL0.DOCS_REF_MAX_CHARS],
    ['QUALIFIED_PREFIX_RE', parityL0.DOCS_QUALIFIED_PREFIX_RE_BODY],
    ['QUALIFIED_RE', parityL0.DOCS_QUALIFIED_REF_RE_BODY],
    ['SHA_RE', parityL0.DOCS_SHA_RE_BODY],
    ['SECTION_RE', parityL0.DOCS_SECTION_RE_BODY],
    ['REL_PATH_RE', parityL0.DOCS_REL_PATH_RE_BODY],
    ['FINGERPRINT_RE', parityL0.DOCS_FINGERPRINT_RE_BODY],
    ['MAX_BYTES_RE', parityL0.DOCS_MAX_BYTES_RE_BODY],
    ['PATH_EXCLUDED_CATEGORIES', parityL0.DOCS_PATH_EXCLUDED_CATEGORIES],
    ['PATH_EXCLUDED_RANGES', parityL0.DOCS_PATH_EXCLUDED_RANGES],
    ['PATH_MAX_BYTES', parityL0.DOCS_PATH_MAX_BYTES],
    ['PATH_MAX_COMPONENT_BYTES', parityL0.DOCS_PATH_MAX_COMPONENT_BYTES],
    ['PATH_MAX_DEPTH', parityL0.DOCS_PATH_MAX_DEPTH],
    ['DOCS_MAX_FILE_BYTES', parityL0.DOCS_MAX_FILE_BYTES],
    ['DOCS_MAX_ANSWER_BYTES', parityL0.DOCS_MAX_ANSWER_BYTES],
    ['DOCS_MAX_LISTING_WIRE_BYTES', parityL0.DOCS_MAX_LISTING_WIRE_BYTES],
    ['DOCS_MAX_ENTRIES', parityL0.DOCS_MAX_ENTRIES],
    ['DOCS_DRAFT_HASH_BUDGET', parityL0.DOCS_DRAFT_HASH_BUDGET],
    ['DOCS_MAX_DRAFTS', parityL0.DOCS_MAX_DRAFTS],
    ['DOCS_FETCH_MIN_INTERVAL_MS', parityL0.DOCS_FETCH_MIN_INTERVAL_MS],
  ];
  /** The block's other names, each compared in its own shape: SECTIONS as ordered pairs (below), FAILURES as a set
   *  and REDACT_RULES rule by rule (Task 6's row-48 cases above). */
  const OTHERS = ['SECTIONS', 'FAILURES', 'REDACT_RULES'];
  /** The caps among them: each must be its own integer literal in the helper, never an expression or an alias. */
  const CAPS = ['REF_MAX_CHARS', 'PATH_MAX_BYTES', 'PATH_MAX_COMPONENT_BYTES', 'PATH_MAX_DEPTH', 'DOCS_MAX_FILE_BYTES',
    'DOCS_MAX_ANSWER_BYTES', 'DOCS_MAX_LISTING_WIRE_BYTES', 'DOCS_MAX_ENTRIES', 'DOCS_DRAFT_HASH_BUDGET',
    'DOCS_MAX_DRAFTS', 'DOCS_FETCH_MIN_INTERVAL_MS'];
  /** Read per case, never at collection: a missing marker reds these cases, not the whole file. */
  const src = (): string => helperSourceForParity();
  const home = harnessForParity('ccd-docs-parity-').home;
  type Measured = { values: Record<string, unknown>; sections: [string, string][] };
  /** One unit run for the whole table, taken by the first case that needs it. */
  let measured: Measured | undefined;
  const py = (): Measured => {
    if (measured === undefined) {
      measured = unitForParity<Measured>(home, `
import json
NAMES = json.loads(${JSON.stringify(JSON.stringify(PARITY.map(([n]) => n)))})
out({'values': {n: getattr(H, n) for n in NAMES}, 'sections': [list(p) for p in H.SECTIONS.items()]})
`);
    }
    return measured;
  };

  it.each(PARITY.map(([n, v]) => [n, v] as const))('%s in the helper equals its shared/docs.ts value', (name, ts) => {
    expect(Object.keys(py().values)).toContain(name);
    expect(py().values[name]).toEqual(ts);
  });

  it('SECTIONS equals DOC_SECTIONS as ORDERED pairs (the order is the listing order)', () => {
    expect(py().sections).toEqual(Object.entries(parityL0.DOC_SECTIONS));
  });

  it('QUALIFIED_RE and SECTION_RE are DERIVED in the helper, never pasted copies', () => {
    expect(literalForParity(src(), 'QUALIFIED_RE')).toBe('QUALIFIED_PREFIX_RE+BARE_REF_RE');
    expect(literalForParity(src(), 'SECTION_RE')).toBe("'|'.join(SECTIONS)");
  });

  it('every cap is its own integer literal', () => {
    for (const n of CAPS) expect(literalForParity(src(), n), n).toMatch(/^[1-9][0-9]*$/);
  });

  it('the block between the docs-parity markers holds exactly the table, in both directions', () => {
    const lines = src().split('\n');
    const begin = lines.indexOf('# docs-parity: begin');
    const end = lines.indexOf('# docs-parity: end');
    expect(begin, 'the begin marker').toBeGreaterThanOrEqual(0);
    expect(end, 'the end marker, after the begin marker').toBeGreaterThan(begin);
    const names = lines.slice(begin + 1, end)
      .filter((l) => l.trim() !== '' && !l.startsWith('#'))
      .map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(l)?.[1] ?? `<not a single-line NAME= literal: ${l}>`);
    expect([...names].sort()).toEqual([...PARITY.map(([n]) => n), ...OTHERS].sort());
  });

  it('every table name has exactly one assignment in the helper source', () => {
    for (const n of [...PARITY.map(([name]) => name), ...OTHERS]) {
      expect(literalForParity(src(), n).length, n).toBeGreaterThan(0);
    }
  });
});

// ---- Task 8: M3.12, the GitHub slug is one rule in two languages ----
// `_gh_repo_slug` (ccd/ccd) stays the one definition for ccd's write paths; the docs helper's `slug_from_url` is
// a copy (spec 2026-10-01 section 3.11), bound here by verdict over one corpus. Each URL is set on ONE fixture
// repository and read by both sides: bash through `git config --get` inside `_gh_repo_slug`, python through the
// hardened runner (`origin_url`), and python again on the literal string.
//
// This block imports under names of its own: an appended block cannot assume the file head's import list, and
// binding one name twice is a SyntaxError.
import * as slugVitest from 'vitest';
import * as slugPath from 'node:path';
import * as slugWs from './ccdWsHelpers.js';
import * as slugPy from './docsHelperPy.js';

/** A python string literal (the corpus is ASCII). */
const slugQ = (v: string): string => JSON.stringify(v);

slugVitest.describe('M3.12: slug_from_url gives _gh_repo_slug\'s verdict on every origin URL', () => {
  let h: slugWs.CcdHarness;
  let main = '';
  slugVitest.beforeAll(() => {
    h = slugWs.makeCcdHarness('ccd-docs-');
    main = h.makeRepo('demo');
  });
  slugVitest.afterAll(() => h.cleanup());

  /** [what the row is, the URL, the slug both sides must answer (null: none)]. */
  const CORPUS: ReadonlyArray<readonly [string, string, string | null]> = [
    ['https', 'https://github.com/o/r', 'o/r'],
    ['https with .git', 'https://github.com/o/r.git', 'o/r'],
    ['scp form', 'git@github.com:o/r.git', 'o/r'],
    ['ssh form', 'ssh://git@github.com/o/r.git', 'o/r'],
    ['a host that is not GitHub', 'https://example.invalid/o/r', null],
    ['three segments', 'https://github.com/o/r/x', null],
    ['a space in the name', 'https://github.com/o/r r', null],
    ['the empty string', '', null],
    ['an owner and no name', 'https://github.com/o', null],
    ['http, not https', 'http://github.com/o/r', null],
    ['userinfo before the host', 'https://u:tok' + '@github.com/o/r', null],
    ['the three prefixes strip IN TURN, not one of three', 'git@github.com:https://github.com/o/r', 'o/r'],
    ['only ONE trailing .git strips', 'https://github.com/o/r.git.git', 'o/r.git'],
    ['a bare owner/name', 'example-org/example-repo', 'example-org/example-repo'],
  ];

  slugVitest.it('every row: bash, the runner read and the literal string agree, and match the table', () => {
    const local = ['the fixture\'s own local origin', slugPath.join(h.home, 'origins', 'demo.git'), null] as const;
    const rows = [...CORPUS, local];
    const named = rows.filter(([, , want]) => want !== null).length;
    // Not vacuous in either direction: an always-null or an always-named pair could not pass.
    slugVitest.expect(named).toBeGreaterThanOrEqual(5);
    slugVitest.expect(rows.length - named).toBeGreaterThanOrEqual(5);
    for (const [label, url, want] of rows) {
      h.git(main, 'config', 'remote.origin.url', url);
      let bash: string | null;
      try { bash = h.sh('_gh_repo_slug "$DOCS_SLUG_MAIN"', { DOCS_SLUG_MAIN: main }); } catch { bash = null; }
      const py = slugPy.unitJson<{ read: string | null; viaRunner: string | null; direct: string | null; github: unknown }>(
        h.home, [
          `ctx = H.Ctx('docs-tree', ${slugQ(slugPath.join(h.home, 'projects'))}, ${slugQ(slugPath.join(h.home, 'worktrees'))},`,
          `            ${slugQ(slugPath.join(h.home, '.cc-sessions'))}, H.SYS.monotonic())`,
          `dl = H.Deadline(H.HELPER_DEADLINE_S['docs-tree'])`,
          `url = H.origin_url(H.discover(ctx, 'demo', dl), dl)`,
          `out({'read': url, 'viaRunner': None if url is None else H.slug_from_url(url),`,
          `     'direct': H.slug_from_url(${slugQ(url)}), 'github': H.github_of(url)})`,
          '',
        ].join('\n'));
      slugVitest.expect(bash, label).toBe(want);
      slugVitest.expect(py.read, label).toBe(url);
      slugVitest.expect(py.direct, label).toBe(bash);
      slugVitest.expect(py.viaRunner, label).toBe(bash);
      slugVitest.expect(py.github, label).toEqual(bash === null ? { state: 'none' } : { state: 'named', slug: bash });
    }
  }, 120_000);
});
