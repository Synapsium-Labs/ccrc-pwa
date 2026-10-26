// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALL, ROOTS, ccrcRoot, holdersOf, prose, rel } from './helpers.js';


// Docs reader W1a (design 2026-10-01: section 2 (a), section 2 (f), section 6.1, mutation row 48's TypeScript
// half): every docs cap and every value grammar is declared ONCE, in L0 `shared/docs.ts`. The python parity copies
// in `ccd/ccd` sit outside ROOTS, so `docs-parity.test.ts` binds those; this pins the one TypeScript copy. APPENDED
// after the file's last line: `session-hook.test.ts`'s citation audit cites this file by line, so nothing above
// may move.
describe('docs L0 single definitions (docs reader W1a, row 48)', () => {
  const DOCS_TS = path.join(ccrcRoot, 'shared', 'docs.ts');
  /** A declaration of `name`, exported or not; an import or a re-export declares nothing. */
  const DEF = (name: string): RegExp =>
    new RegExp(String.raw`^\s*(?:export\s+)?(?:const|let|var)\s+` + name + String.raw`\b`, 'm');
  const text = new Map<string, string>();
  const src = (f: string): string => {
    const hit = text.get(f);
    if (hit !== undefined) return hit;
    const t = readFileSync(f, 'utf8');
    text.set(f, t);
    return t;
  };
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(src(f))).map(rel);

  it('CONTROL: DEF sees a declaration and an un-exported copy, and not an import, a re-export or a longer name', () => {
    expect(DEF('DOCS_MAX_ENTRIES').test('export const DOCS_MAX_ENTRIES = 5000;')).toBe(true);
    expect(DEF('DOCS_MAX_ENTRIES').test('  const DOCS_MAX_ENTRIES = 5000;'), 'an un-exported copy is still a copy').toBe(true);
    expect(DEF('DOCS_MAX_ENTRIES').test("import { DOCS_MAX_ENTRIES } from '../../shared/docs.js';")).toBe(false);
    expect(DEF('DOCS_MAX_ENTRIES').test('export { DOCS_MAX_ENTRIES };'), 'a re-export declares nothing').toBe(false);
    expect(DEF('DOCS_MAX_ENTRIES').test('export const DOCS_MAX_ENTRIES_SEEN = 1;'), 'another name').toBe(false);
  });

  // Each cap holds its OWN literal. DOCS_MAX_DOC_BYTES and DOCS_MAX_IMAGE_BYTES are both 2 MiB by two separate
  // rulings, so "one definition" must mean an own-value literal, never an alias of the neighbour that happens to
  // hold the same integer (HOLD_ROUTE_REASON_MAX_BYTES's argument, above). The grammar bounds are held to the same
  // rule.
  describe('docs caps are declared once, in shared/docs.ts, each its own literal', () => {
    const CAPS = [
      'DOCS_MAX_FILE_BYTES', 'DOCS_MAX_DOC_BYTES', 'DOCS_MAX_IMAGE_BYTES', 'DOCS_ENVELOPE_RESERVE',
      'DOCS_MAX_ANSWER_BYTES', 'DOCS_MAX_LISTING_WIRE_BYTES', 'DOCS_MAX_ENTRIES', 'DOCS_DRAFT_HASH_BUDGET',
      'DOCS_MAX_DRAFTS', 'DOCS_MAX_IMAGES_PER_PAGE', 'DOCS_FETCH_MIN_INTERVAL_MS', 'DOCS_STALE_MS',
      'DOCS_RETRY_FLOOR_MS',
      'DOCS_REF_MAX_CHARS', 'DOCS_PATH_MAX_BYTES', 'DOCS_PATH_MAX_COMPONENT_BYTES', 'DOCS_PATH_MAX_DEPTH',
    ];
    const OWN = (name: string): RegExp => new RegExp('^export const ' + name + String.raw`\s*=\s*\d+\s*;`, 'm');

    it('CONTROL: OWN accepts an integer literal and refuses an alias and an expression', () => {
      expect(OWN('DOCS_MAX_IMAGE_BYTES').test('export const DOCS_MAX_IMAGE_BYTES = 2097152;')).toBe(true);
      expect(OWN('DOCS_MAX_IMAGE_BYTES').test('export const DOCS_MAX_IMAGE_BYTES = DOCS_MAX_DOC_BYTES;'), 'an alias').toBe(false);
      expect(OWN('DOCS_MAX_IMAGE_BYTES').test('export const DOCS_MAX_IMAGE_BYTES = 2 * 1024 * 1024;'), 'an expression').toBe(false);
    });

    it.each(CAPS)('%s is declared in shared/docs.ts and nowhere else across the four roots', (name) => {
      expect(holders(DEF(name))).toEqual(['shared/docs.ts']);
    });

    it.each(CAPS)('%s holds its own integer literal', (name) => {
      expect(OWN(name).test(src(DOCS_TS)), `${name} must read \`export const ${name} = <digits>;\``).toBe(true);
    });
  });

  // Each grammar is a pattern body. DEF pins its declaration. LITERAL pins the body text itself, by a
  // backslash-free fingerprint, so a copy written as a regex literal, a raw template or an escaped string is seen
  // alike. The commit and fingerprint bodies are plain hex runs that unrelated code already spells (measured at
  // planning: `[0-9a-f]{40}` in four server/src files, `[0-9a-f]{64}` in one), so those two are pinned by DEF alone.
  // The section body is derived by `join`, so its spelled-out form belongs in no file at all. KNOWN WIDTH: a body
  // rebuilt from fragments evades LITERAL; `docs-parity.test.ts` still compares the helper's copy with the value.
  describe('docs grammar bodies are declared once, in L0', () => {
    const BODIES = [
      'DOC_SECTIONS', 'DOCS_PROJECT_RE_BODY', 'DOCS_BARE_REF_RE_BODY', 'DOCS_QUALIFIED_PREFIX_RE_BODY',
      'DOCS_QUALIFIED_REF_RE_BODY', 'DOCS_SHA_RE_BODY', 'DOCS_FINGERPRINT_RE_BODY', 'DOCS_MAX_BYTES_RE_BODY',
      'DOCS_SECTION_RE_BODY', 'DOCS_REL_PATH_RE_BODY', 'DOCS_PATH_EXCLUDED_CATEGORIES', 'DOCS_PATH_EXCLUDED_RANGES',
    ];
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /** [what, fingerprint, the files that may hold it, a planted copy it must see, a near miss it must not]. */
    const LITERALS: readonly (readonly [string, RegExp, readonly string[], string, string])[] = [
      ['project', new RegExp(esc('[A-Za-z0-9_][A-Za-z0-9._-]{0,99}')), ['shared/docs.ts'],
        'const P = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;', 'const P = /^[A-Za-z0-9._-]+$/;'],
      ['bare ref', new RegExp(esc('(?!HEAD$)(?!refs/)')), ['shared/docs.ts'],
        "const R = '^(?!HEAD$)(?!refs/)(?!.*\\\\.\\\\.)';", "if (s === 'HEAD') return false;"],
      ['qualified prefix', new RegExp(esc('(?:refs/heads/|refs/remotes/origin/)')), ['shared/docs.ts'],
        "new RegExp('^(?:refs/heads/|refs/remotes/origin/)')", "s.startsWith('refs/heads/')"],
      ['max-bytes', new RegExp(esc('[1-9][0-9]{0,7}')), ['shared/docs.ts'],
        'const N = /^[1-9][0-9]{0,7}$/;', 'const N = /^[0-9]+$/;'],
      ['rel path', new RegExp(esc('(?!/)(?!.*/$)(?!.*//)')), ['shared/docs.ts'],
        'const X = String.raw`(?!/)(?!.*/$)(?!.*//)`;', "const X = '(?!/)';"],
      ['section map', /(['"`])docs\/product-design\1/, ['shared/docs.ts'],
        "  'product-design': 'docs/product-design',", '// docs/product-design is a section'],
      ['section', new RegExp(esc('specs|plans|product-design|conventions')), [],
        "const S = 'specs|plans|product-design|conventions';", "const S = 'specs|plans';"],
      ['path categories', /(['"])Cf\1,\s*(['"])Zl\2,\s*(['"])Zp\3,\s*(['"])Co\4,\s*(['"])Cn\5/, ['shared/docs.ts'],
        'const C = ["Cf","Zl","Zp","Co","Cn"];', "const C = ['Cf', 'Zl'];"],
      ['selector ranges', /0xe0100\s*,\s*0xe01ef/i, ['shared/docs.ts'],
        'const V = [[0xFE00, 0xFE0F], [0xE0100, 0xE01EF]];', 'const V = 0xe0100;'],
    ];

    it('CONTROL: each fingerprint sees its planted copy and not its near miss', () => {
      for (const [what, re, , copy, miss] of LITERALS) {
        expect(re.test(copy), `${what}: the planted copy`).toBe(true);
        expect(re.test(miss), `${what}: the near miss`).toBe(false);
      }
    });

    it.each(BODIES)('%s is declared in shared/docs.ts and nowhere else across the four roots', (name) => {
      expect(holders(DEF(name))).toEqual(['shared/docs.ts']);
    });

    it.each(LITERALS.map(([what, re, files]) => [what, re, files] as const))(
      'the %s body is spelled out only where it is declared', (_what, re, files) => {
        expect(holders(re)).toEqual([...files]);
      });
  });
});


// Docs W1, Task 2 (spec 2026-10-01 section 2 (b), section 2 (i), section 3.5): the failure vocabulary, its retry
// classes, the redactor and the ccd wire types each have ONE home, `shared/docs.ts`. The server's L1 status table,
// its L3 adapter and the PWA's sentence table all key on these names, so a second declaration is a second
// vocabulary that nothing forces to agree. The python copies (`FAILURES`, `REDACT_RULES`) live in `ccd/ccd`,
// outside ROOTS; `docs-parity.test.ts` binds those. APPENDED after the file's last line:
// `session-hook.test.ts`'s citation audit cites this file by line, so nothing above may move.
describe('docs failure vocabulary, redactor and ccd wire types are declared once, in shared/docs.ts (docs W1)', () => {
  const DOCS = path.join(ccrcRoot, 'shared', 'docs.ts');
  const TYPES = [
    'DocsFailure', 'DocsRetryClass', 'DocsFetchFailure', 'DocsNotAFileKind', 'DocsFailureContext', 'DocsFailureBody',
    'DocsVerb', 'DocsGithub', 'DocsTreeOk', 'DocsEntry', 'DraftsFacts', 'DocsShowOk', 'DocsFetchOk', 'DocsIndexOk',
    'DocsIndexRow', 'DocsCcdFailure',
  ] as const;
  const VALUES = ['DOCS_FAILURES', 'DOCS_FAILURE_RETRY', 'DOCS_CCD_FAILURES', 'DOCS_REDACT_RULES'] as const;
  const FUNCTIONS = ['redactDocsText'] as const;
  // The declaration shapes of the update-control-plane describe above (its `DEF_OF` is block-local there): a
  // type needs its `=` and an interface its keyword, so an inline `type X,` import specifier is no holder.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
  const holdersOf = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);

  it('CONTROL: each shape sees a declaration and an un-exported copy, and not an import, a re-export or a longer name', () => {
    expect(TYPE_DEF('DocsFailure').test("export type DocsFailure = keyof typeof DOCS_FAILURES;")).toBe(true);
    expect(TYPE_DEF('DocsFailure').test("type DocsFailure = 'bad-ref';"), 'an un-exported copy is still a copy').toBe(true);
    expect(TYPE_DEF('DocsTreeOk').test('export interface DocsTreeOk {'), 'an interface').toBe(true);
    expect(TYPE_DEF('DocsFailure').test("import {\n  type DocsFailure,\n} from '../../../shared/docs.js';"), 'an import specifier').toBe(false);
    expect(TYPE_DEF('DocsFailure').test('export type DocsFailureBody = { ok: false };'), 'a longer name').toBe(false);
    expect(VALUE_DEF('DOCS_FAILURES').test('export const DOCS_FAILURES = {'), 'a declaration').toBe(true);
    expect(VALUE_DEF('DOCS_FAILURES').test("export { DOCS_FAILURES } from './docs.js';"), 'a re-export').toBe(false);
    expect(VALUE_DEF('DOCS_FAILURES').test('const DOCS_FAILURES_SEEN = 1;'), 'a longer name').toBe(false);
    expect(FUNCTION_DEF('redactDocsText').test('export function redactDocsText(s: string): string {')).toBe(true);
    expect(FUNCTION_DEF('redactDocsText').test('const x = redactDocsText(s);'), 'a call').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares type ${name} exactly once, in shared/docs.ts`, () => {
      expect(holdersOf(TYPE_DEF(name))).toEqual(['shared/docs.ts']);
    });
  }

  it('declares every value and the redactor function exactly once, in shared/docs.ts', () => {
    for (const name of VALUES) expect(holdersOf(VALUE_DEF(name)), name).toEqual(['shared/docs.ts']);
    for (const name of FUNCTIONS) expect(holdersOf(FUNCTION_DEF(name)), name).toEqual(['shared/docs.ts']);
  });

  it('spells the redactor patterns in one file, shared/redact.mjs: no second copy of a rule', () => {
    // Fragments every copy of rules 2 and 3 must contain however it is escaped or quoted. D-5867 (Task C1l; ARCH-66
    // (#801)): the rows' one home moved from shared/docs.ts to shared/redact.mjs, which `ALL` (`.ts` and `.tsx`) does
    // not walk, so it is read by path.
    const home = readFileSync(path.join(ccrcRoot, 'shared', 'redact.mjs'), 'utf8');
    for (const fragment of ['(?:access_token|token)=', 'gh[opsu]_']) {
      expect(home.includes(fragment), `${fragment} in shared/redact.mjs`).toBe(true);
      expect(ALL.filter((f) => readFileSync(f, 'utf8').includes(fragment)).map(rel), fragment).toEqual([]);
    }
  });

  it('DOCS_CCD_FAILURES is derived from DOCS_FAILURES, never hand-listed', () => {
    const src = readFileSync(DOCS, 'utf8');
    expect(src).toMatch(
      /^export const DOCS_CCD_FAILURES: readonly DocsFailure\[\] =\n {2}\(Object\.keys\(DOCS_FAILURES\) as DocsFailure\[\]\)\.filter\(\(w\) => DOCS_FAILURES\[w\] === 'ccd'\);$/m,
    );
  });

  it('DOCS_FAILURE_RETRY is typed by the vocabulary, so a new word does not compile until it is placed', () => {
    const src = readFileSync(DOCS, 'utf8');
    expect(src).toMatch(/^export const DOCS_FAILURE_RETRY: Record<DocsFailure, DocsRetryClass> = \{$/m);
    expect(src).toMatch(/^export type DocsFailure = keyof typeof DOCS_FAILURES;$/m);
  });
});


// Native Docs reader, W1 Task 3 (spec 5.1, 5.3, 6.1, 3.5, 4.11): the content-class table, the raster table,
// the class caps, the docs response headers, the HTTP wrappers and the link resolver each have ONE declaring
// file, shared/docs.ts. The server's file route and its onSend hook (W2) and the PWA's renderer and link policy
// (W5, W6) import them; a second copy would be a second answer to "what class is this file", "what may this
// route send" or "where does this link go". APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line, so nothing above may move.
describe('docs content classes, headers, wrappers and resolver are declared once, in shared/docs.ts (docs W1 Task 3)', () => {
  const TYPES = [
    'DocContentClass', 'RasterType', 'RasterMime', 'DocRefResolution',
    'DocsProjectsResponse', 'DocsTreeResponse', 'DocsFileResponse', 'DocsRefreshFetch', 'DocsRefreshResponse',
  ] as const;
  const VALUES = [
    'DOC_CONTENT_CLASS_BY_EXT', 'DOCS_CLASS_CAP', 'DOCS_RASTER_TYPES', 'DOCS_RASTER_EXT',
    'DOCS_RESPONSE_CSP', 'DOCS_RESPONSE_HEADERS', 'DOCS_ALLOWED_CONTENT_TYPES',
  ] as const;
  const FUNCTIONS = ['contentClass', 'sniffRaster', 'resolveDocRef'] as const;
  // The declaration shapes of the update-control-plane block above: a type needs its `=` (or `interface`), so
  // an inline `type X,` import specifier is not a holder; a value is a `const`/`let`/`var`; a function is a
  // `function` declaration. `export` is optional throughout: an un-exported local copy is still a copy.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
  const holdersOf = (def: RegExp): string[] => ALL.filter((f) => def.test(readFileSync(f, 'utf8'))).map(rel);

  it('CONTROL: each pattern sees a planted declaration, exported or not, and not an import or a use', () => {
    expect(TYPE_DEF('DocContentClass').test("export type DocContentClass = 'markdown';")).toBe(true);
    expect(TYPE_DEF('DocContentClass').test("type DocContentClass = 'a';"), 'an un-exported copy').toBe(true);
    expect(TYPE_DEF('DocsFileResponse').test('export interface DocsFileResponse { ok: true }')).toBe(true);
    expect(TYPE_DEF('DocContentClass').test("import {\n  type DocContentClass,\n} from '../../../shared/docs.js';"),
      'an import specifier').toBe(false);
    expect(TYPE_DEF('DocContentClass').test("  contentClass: Exclude<DocContentClass, 'raster'>;"), 'a use').toBe(false);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test('export const DOCS_CLASS_CAP: Record<DocContentClass, number> = {')).toBe(true);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test('const DOCS_CLASS_CAP = {};'), 'an un-exported copy').toBe(true);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test("import { DOCS_CLASS_CAP } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(VALUE_DEF('DOCS_CLASS_CAP').test('  const cap = DOCS_CLASS_CAP[cls];'), 'a use').toBe(false);
    expect(FUNCTION_DEF('contentClass').test('export function contentClass(path: string): DocContentClass {')).toBe(true);
    expect(FUNCTION_DEF('contentClass').test('function contentClass(p: string) {'), 'an un-exported copy').toBe(true);
    expect(FUNCTION_DEF('contentClass').test('  const cls = contentClass(pin.path);'), 'a call').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares the type ${name} once, in shared/docs.ts`, () => {
      expect(holdersOf(TYPE_DEF(name))).toEqual(['shared/docs.ts']);
    });
  }

  it('declares every table and header value once, in shared/docs.ts', () => {
    for (const name of VALUES) expect(holdersOf(VALUE_DEF(name)), name).toEqual(['shared/docs.ts']);
  });

  it('declares contentClass, sniffRaster and resolveDocRef once, in shared/docs.ts', () => {
    for (const name of FUNCTIONS) expect(holdersOf(FUNCTION_DEF(name)), name).toEqual(['shared/docs.ts']);
  });

  it("spells the docs CSP text once: the server's hook and the browser leg import DOCS_RESPONSE_CSP", () => {
    const CSP_TEXT = "img-src data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";
    expect(ALL.filter((f) => readFileSync(f, 'utf8').includes(CSP_TEXT)).map(rel)).toEqual(['shared/docs.ts']);
  });

  it('spells the PNG signature once: the L1 raster verdict wraps sniffRaster rather than copying the table', () => {
    const PNG_MAGIC = /0x89\s*,\s*0x50\s*,\s*0x4e\s*,\s*0x47/i;
    expect(PNG_MAGIC.test('[0x89, 0x50, 0x4E, 0x47, 0x0d]'), 'CONTROL: a copy in another case').toBe(true);
    expect(PNG_MAGIC.test('[0x89, 0x51, 0x4e, 0x47]'), 'CONTROL: another signature').toBe(false);
    expect(ALL.filter((f) => PNG_MAGIC.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
  });
});


// Docs W1a, Task 4 (spec 2026-10-01 4.6 and 3.11): the entry view and the GitHub link builder
// are declared once, in shared/docs.ts. The PWA's rows and leaf headers both call entryView
// ("one badge function", spec 2 (d)), so a second derivation of a badge, or a second URL
// builder, anywhere in the four roots is the drift this pins. The pattern-2 bundle shape of
// the update control plane block above, with a planted CONTROL. APPENDED after the file's
// last line: `session-hook.test.ts`'s citation audit cites this file by line.
describe('docs section H is declared once, in shared/docs.ts (docs W1a)', () => {
  const TYPES = ['EntryMode', 'EntryBadge', 'WithheldReason', 'EntryView', 'GithubTarget', 'GithubLink'] as const;
  const FUNCTIONS = ['admitDraft', 'entryView', 'githubBlobUrl'] as const;
  // A type is declared by `type <Name> =` or `interface <Name>`, `export`/`declare` optional:
  // an un-exported local copy is still a copy, and an inline import specifier is not one.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  // A function is declared by `function <name>` or bound by `const|let|var <name>`: an arrow
  // copy is the likeliest second copy, and a call or an import binds nothing.
  const FN_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`, 'm');

  it('CONTROL: the patterns see a declaration, a local copy and an arrow copy, and not an import, a call or another name', () => {
    expect(TYPE_DEF('EntryView').test('export interface EntryView {')).toBe(true);
    expect(TYPE_DEF('EntryBadge').test("type EntryBadge = 'new' | 'deleted';"), 'an un-exported local type').toBe(true);
    expect(TYPE_DEF('EntryView').test("import {\n  type EntryView,\n} from '../../../shared/docs.js';"), 'an import specifier').toBe(false);
    expect(TYPE_DEF('EntryView').test('export interface EntryViewRow {'), 'another name').toBe(false);
    expect(FN_DEF('entryView').test('export function entryView(e: DocsEntry, d: DraftsFacts, mode: EntryMode): EntryView {')).toBe(true);
    expect(FN_DEF('entryView').test('const entryView = (e: DocsEntry) => e;'), 'an arrow copy').toBe(true);
    expect(FN_DEF('entryView').test("import { entryView } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(FN_DEF('entryView').test("  const v = entryView(e, drafts, 'ref');"), 'a call').toBe(false);
    expect(FN_DEF('githubBlobUrl').test('export function githubBlobUrls('), 'another name').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => TYPE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
  for (const name of FUNCTIONS) {
    it(`defines ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => FN_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
});


// D-5930: vaul's keyframes are retimed in one place, `ui/src/lib/motion.ts`. The Sheet once retimed them with
// transition utilities a keyframe never reads, and the command palette carried a private recipe of its own; a
// third surface spelling `animation-duration:` would be a third pace nothing keeps on the tokens. Every file type
// under `ui/src`, comments included: a literal-absence pin, and CSS is where the next copy is likeliest.
describe("vaul's motion is retimed once, in ui/src/lib/motion.ts (D-5930)", () => {
  const UI_SRC = path.join(ccrcRoot, 'ui', 'src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    if (e.startsWith('__')) return [];
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css|mjs)$/.test(p) ? [p] : [];
  });

  it('no animation-duration: or animation-timing-function: literal exists in ui/src outside ui/src/lib/motion.ts', () => {
    const files = walk(UI_SRC);
    expect(files.map(rel), 'the scan reaches the primitives').toContain('ui/src/primitives/command-palette.tsx');
    const holders = files.filter((f) => /animation-(?:duration|timing-function):/.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['ui/src/lib/motion.ts']);
  });
});


// Docs W1a, Task 5 (spec 2026-10-01 3.1, 3.2, 3.8): the page grammar, the pin and the one docs API URL builder
// are declared once, in shared/docs.ts. The server's L1 query parser (W2) and the PWA's router and loaders (W5)
// import them; a second parser or builder is a second grammar nothing forces to agree. The marker header word
// is quoted once for the same reason: the server's provenance hook and the PWA's funnel must read the one
// constant, so a rename cannot leave one side sending a header the other no longer checks. DOCS_PAGE_PREFIX's
// own pin is M7.3, in docs-parity.test.ts. APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line.
describe('docs page URLs and the API URL builder are declared once, in shared/docs.ts (docs W1a)', () => {
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
  const TYPES = ['DocsPageLocation', 'DocsPageParseFailure', 'DocsPageParse', 'DocPin'] as const;
  const VALUES = [
    'DOCS_PAGE_PREFIX', 'DOCS_API_PREFIX', 'DOCS_REQUEST_HEADER', 'DOCS_REQUEST_HEADER_VALUE', 'DOCS_PAGE_KEYS',
    'DOCS_PIN_KEYS', 'docsApi',
  ] as const;
  const FUNCTIONS = ['parseDocsPage', 'docsPageUrl'] as const;

  it('CONTROL: each pattern sees a declaration, local or exported, and not an import, a re-export or a use', () => {
    expect(TYPE_DEF('DocPin').test('type DocPin = { kind: string };'), 'un-exported local type').toBe(true);
    expect(TYPE_DEF('DocPin').test("import {\n  type DocPin,\n} from '../../../shared/docs.js';"), 'import specifier').toBe(false);
    expect(VALUE_DEF('docsApi').test('const docsApi = {};'), 'un-exported local const').toBe(true);
    expect(VALUE_DEF('docsApi').test("export { docsApi } from '../../shared/docs.js';"), 're-export').toBe(false);
    expect(VALUE_DEF('docsApi').test('const url = docsApi.tree(p, null);'), 'a use').toBe(false);
    expect(FUNCTION_DEF('parseDocsPage').test('function parseDocsPage(p: string) {}'), 'local function').toBe(true);
    expect(FUNCTION_DEF('parseDocsPage').test('const r = parseDocsPage(path, search);'), 'a call').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares the type ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => TYPE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }

  it('declares every constant and builder exactly once, in shared/docs.ts', () => {
    for (const name of VALUES) {
      expect(ALL.filter((f) => VALUE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/docs.ts']);
    }
    for (const name of FUNCTIONS) {
      expect(ALL.filter((f) => FUNCTION_DEF(name).test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/docs.ts']);
    }
  });

  const HEADER_LITERAL = /(['"])x-ccrc-docs\1/;

  it('CONTROL: the header literal scan sees a quoted copy, and not prose or a longer word', () => {
    expect(HEADER_LITERAL.test("headers['x-ccrc-docs']")).toBe(true);
    expect(HEADER_LITERAL.test('headers: { "x-ccrc-docs": "1" }')).toBe(true);
    expect(HEADER_LITERAL.test('the `x-ccrc-docs` marker'), 'a backticked prose mention').toBe(false);
    expect(HEADER_LITERAL.test("'x-ccrc-docs-v2'"), 'another word').toBe(false);
  });

  it('quotes the marker header word in shared/docs.ts and nowhere else across the four roots', () => {
    expect(ALL.filter((f) => HEADER_LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
  });
});


// Docs W1 final review (minors-triage MT-1): Task 1's sections and grammar predicates, its ref spec and its two
// types, declared once in shared/docs.ts (the plan's pattern 2 for each type or function name). W2's L1 query parser
// and W5's link code call these; a second `isDocsRelPath` (a regex alone, without the category, byte and depth
// checks) would pass every grammar pin while the TS-to-python parity measured a copy no server ran. APPENDED after
// the file's last line: `session-hook.test.ts`'s citation audit cites this file by line.
describe('docs sections, grammar predicates and ref spec are declared once, in shared/docs.ts (docs W1, Task 1)', () => {
  const TYPES = ['DocSectionSlug', 'DocsRefSpec'] as const;
  const FUNCTIONS = [
    'isDocsSection', 'docRepoPath', 'isDocsProject', 'isDocsBareRef', 'isDocsQualifiedRef', 'isDocsCommit',
    'isDocsRelPath', 'isDocsFingerprint', 'isDocsMaxBytes', 'parseDocsRef', 'docsRefText',
  ] as const;
  // Section H's shapes: a type by `type <Name> =` or `interface <Name>`, a function by `function <name>` or a
  // `const|let|var <name>` binding (an arrow copy), `export`/`declare` optional.
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  const FN_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`, 'm');

  it('CONTROL: the patterns see a declaration, a local copy and an arrow copy, and not an import, a call or another name', () => {
    expect(TYPE_DEF('DocsRefSpec').test("export type DocsRefSpec = { kind: 'bare'; name: string };")).toBe(true);
    expect(TYPE_DEF('DocSectionSlug').test("type DocSectionSlug = 'specs';"), 'an un-exported local type').toBe(true);
    expect(TYPE_DEF('DocsRefSpec').test("import {\n  type DocsRefSpec,\n} from '../../../shared/docs.js';"), 'an import specifier').toBe(false);
    expect(FN_DEF('isDocsRelPath').test('export function isDocsRelPath(s: string): boolean {')).toBe(true);
    expect(FN_DEF('isDocsRelPath').test('const isDocsRelPath = (s: string): boolean => /^x$/.test(s);'), 'an arrow copy').toBe(true);
    expect(FN_DEF('isDocsRelPath').test("import { isDocsRelPath } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(FN_DEF('isDocsRelPath').test('  if (!isDocsRelPath(p)) return null;'), 'a call').toBe(false);
    expect(FN_DEF('isDocsSection').test('export function isDocsSectionSlug('), 'another name').toBe(false);
  });

  for (const name of TYPES) {
    it(`declares the type ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => TYPE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
  for (const name of FUNCTIONS) {
    it(`defines ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => FN_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
});
