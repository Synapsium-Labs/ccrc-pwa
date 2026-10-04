// `shared/docs.ts`, the native Docs reader's L0 file (design 2026-10-01, section 1): its ring, its sections and
// its caps (section 2 (f), section 6.1, section 2 (g)'s refreshDue constants). The grammars have their own file,
// `docs-grammar.test.ts`; ccd's parity copies are bound by `docs-parity.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_SECTIONS, DOC_SECTION_SLUGS, isDocsSection, docRepoPath,
  DOCS_MAX_FILE_BYTES, DOCS_MAX_DOC_BYTES, DOCS_MAX_IMAGE_BYTES, DOCS_ENVELOPE_RESERVE, DOCS_MAX_ANSWER_BYTES,
  DOCS_MAX_LISTING_WIRE_BYTES, DOCS_MAX_ENTRIES, DOCS_DRAFT_HASH_BUDGET, DOCS_MAX_DRAFTS, DOCS_MAX_IMAGES_PER_PAGE,
  DOCS_FETCH_MIN_INTERVAL_MS, DOCS_STALE_MS, DOCS_RETRY_FLOOR_MS,
} from '../../shared/docs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(here, '..', '..', 'shared', 'docs.ts');

/** Each shape that would make `shared/docs.ts` stop being L0, as [what, pattern]. The PWA bundles the file, so
 *  any import, any re-export and any host global breaks its build or its ring. */
const L0_REFUSALS: readonly (readonly [string, RegExp])[] = [
  ['an import line', /^\s*import\b/m],
  ['a dynamic import', /\bimport\s*\(/],
  ['a require', /\brequire\s*\(/],
  ['a re-export', /^\s*export\s.*\sfrom\s/m],
  ['Buffer', /\bBuffer\b/],
  ['process', /\bprocess\./],
  ['a node: specifier', /node:/],
];

describe('shared/docs.ts is L0 and imports nothing', () => {
  it('CONTROL: each refusal pattern sees its planted shape, and none fires on a plain declaration', () => {
    const planted = [
      "import type { X } from './api.js';",
      "const m = await import ('./api.js');",
      "const fs = require('fs');",
      "export { X } from './api.js';",
      'const b = Buffer.from(s);',
      'const e = process.env;',
      "const p = 'node:fs';",
    ];
    L0_REFUSALS.forEach(([what, re], i) => {
      expect(re.test(planted[i] ?? ''), what).toBe(true);
      expect(re.test("export const DOCS_MAX_ENTRIES = 5000;"), `${what} on a plain declaration`).toBe(false);
    });
  });

  it('has no import, no require, no re-export and no host global', () => {
    const src = readFileSync(DOCS, 'utf8');
    for (const [what, re] of L0_REFUSALS) expect(re.test(src), what).toBe(false);
  });

  it('is pure ASCII, so every grammar line reaches the parity scan byte for byte', () => {
    const bytes = readFileSync(DOCS);
    const at = bytes.findIndex((b) => b > 0x7f);
    expect(at, at < 0 ? '' : `first non-ASCII byte at offset ${at}`).toBe(-1);
  });
});

describe('DOC_SECTIONS: the four sections, declared once', () => {
  it('maps each slug to its repo path, in display order', () => {
    expect(DOC_SECTIONS).toEqual({
      specs: 'docs/superpowers/specs',
      plans: 'docs/superpowers/plans',
      'product-design': 'docs/product-design',
      conventions: 'docs/conventions',
    });
    expect(DOC_SECTION_SLUGS).toEqual(['specs', 'plans', 'product-design', 'conventions']);
  });

  it('isDocsSection admits the four slugs and nothing else, an inherited key included', () => {
    for (const s of DOC_SECTION_SLUGS) expect(isDocsSection(s), s).toBe(true);
    for (const s of ['', 'Specs', 'spec', 'docs', 'superpowers', 'product_design', 'specs/', 'toString', '__proto__', 'constructor']) {
      expect(isDocsSection(s), s).toBe(false);
    }
    expect(isDocsSection(['specs'] as unknown as string), 'an array is no section').toBe(false);
  });

  it('docRepoPath joins the section path and the relative path with one slash', () => {
    expect(docRepoPath('specs', 'x.md')).toBe('docs/superpowers/specs/x.md');
    expect(docRepoPath('product-design', 'a/b.png')).toBe('docs/product-design/a/b.png');
    expect(docRepoPath('conventions', 'c.md')).toBe('docs/conventions/c.md');
  });
});

describe('the docs caps (design section 2 (f), section 6.1)', () => {
  it('each cap holds its exact value', () => {
    expect({
      DOCS_MAX_FILE_BYTES, DOCS_MAX_DOC_BYTES, DOCS_MAX_IMAGE_BYTES, DOCS_ENVELOPE_RESERVE, DOCS_MAX_ANSWER_BYTES,
      DOCS_MAX_LISTING_WIRE_BYTES, DOCS_MAX_ENTRIES, DOCS_DRAFT_HASH_BUDGET, DOCS_MAX_DRAFTS, DOCS_MAX_IMAGES_PER_PAGE,
      DOCS_FETCH_MIN_INTERVAL_MS, DOCS_STALE_MS, DOCS_RETRY_FLOOR_MS,
    }).toEqual({
      DOCS_MAX_FILE_BYTES: 4194304,
      DOCS_MAX_DOC_BYTES: 2097152,
      DOCS_MAX_IMAGE_BYTES: 2097152,
      DOCS_ENVELOPE_RESERVE: 65536,
      DOCS_MAX_ANSWER_BYTES: 6291456,
      DOCS_MAX_LISTING_WIRE_BYTES: 1048576,
      DOCS_MAX_ENTRIES: 5000,
      DOCS_DRAFT_HASH_BUDGET: 33554432,
      DOCS_MAX_DRAFTS: 1000,
      DOCS_MAX_IMAGES_PER_PAGE: 30,
      DOCS_FETCH_MIN_INTERVAL_MS: 10000,
      DOCS_STALE_MS: 600000,
      DOCS_RETRY_FLOOR_MS: 60000,
    });
  });

  it('the ceiling chain holds: a base64 file plus the envelope fits the show guard, below the 8 MiB exec buffer', () => {
    const encodedCeiling = 4 * Math.ceil(DOCS_MAX_FILE_BYTES / 3) + DOCS_ENVELOPE_RESERVE;
    expect(encodedCeiling).toBe(5657944);
    expect(encodedCeiling).toBeLessThanOrEqual(DOCS_MAX_ANSWER_BYTES);
    expect(DOCS_MAX_ANSWER_BYTES).toBeLessThan(8 * 1024 * 1024);
  });

  it('the class-cap chain gives 2861740 for both 2 MiB classes', () => {
    expect(4 * Math.ceil(DOCS_MAX_DOC_BYTES / 3) + DOCS_ENVELOPE_RESERVE).toBe(2861740);
    expect(4 * Math.ceil(DOCS_MAX_IMAGE_BYTES / 3) + DOCS_ENVELOPE_RESERVE).toBe(2861740);
    expect(DOCS_MAX_DOC_BYTES).toBeLessThanOrEqual(DOCS_MAX_FILE_BYTES);
    expect(DOCS_MAX_IMAGE_BYTES).toBeLessThanOrEqual(DOCS_MAX_FILE_BYTES);
  });
});

// ===== Task 2: failure vocabulary, retry classes, redactor and ccd wire types =====
// Spec 2026-10-01 section 2 (b), section 2 (i), section 3.5, section 3.7 and section 7.1 (C1, C3); row 53 (L0 half:
// DOCS_FAILURE_RETRY exhaustive) and row 62 (the pattern home). `describe`, `it` and `expect` come from this file's
// vitest import (Task 1's header). An import declaration is hoisted, so this one may sit below Task 1's cases.
import {
  DOCS_CCD_FAILURES, DOCS_FAILURE_RETRY, DOCS_FAILURES, DOCS_REDACT_RULES, redactDocsText,
  type DocsCcdFailure, type DocsEntry, type DocsFailure, type DocsFailureBody, type DocsFailureContext,
  type DocsFetchFailure, type DocsFetchOk, type DocsGithub, type DocsIndexOk, type DocsIndexRow,
  type DocsNotAFileKind, type DocsRetryClass, type DocsShowOk, type DocsTreeOk, type DocsVerb, type DraftsFacts,
} from '../../shared/docs.js';

describe('docs failure vocabulary', () => {
  /** Every word, its origin and its retry class, HAND-TRANSCRIBED from the spec's tables: section 2 (i)'s seven
   *  tables in order, then section 3.7's four HTTP-layer words, with section 7.1's C1 (`caps-unknown` auto) and C3
   *  (`not-granted` manual) applied. Never derived from shared/docs.ts: a table copied from the code agrees with
   *  any mistake in it. */
  const SPEC_WORDS: readonly (readonly [word: string, origin: 'ccd' | 'server', retry: DocsRetryClass])[] = [
    // Argument
    ['bad-project', 'ccd', 'none'],
    ['bad-ref', 'ccd', 'none'],
    ['bad-commit', 'ccd', 'none'],
    ['bad-section', 'ccd', 'none'],
    ['bad-path', 'ccd', 'none'],
    ['bad-fingerprint', 'ccd', 'none'],
    // Repository
    ['unknown-project', 'ccd', 'none'],
    ['not-a-git-repo', 'ccd', 'none'],
    ['linked-worktree', 'ccd', 'none'],
    ['shared-repo', 'ccd', 'none'],
    ['partial-clone', 'ccd', 'none'],
    ['repo-unreadable', 'ccd', 'manual'],
    // Refs
    ['no-default-branch', 'ccd', 'none'],
    ['unresolved-ref', 'ccd', 'none'],
    ['ref-not-commit', 'ccd', 'none'],
    // Objects and paths
    ['unknown-commit', 'ccd', 'auto'],
    ['not-a-commit', 'ccd', 'none'],
    ['object-missing', 'ccd', 'manual'],
    ['absent-path', 'ccd', 'none'],
    ['not-a-file', 'ccd', 'none'],
    ['symlink-in-path', 'ccd', 'none'],
    ['too-large', 'ccd', 'none'],
    ['too-many-entries', 'ccd', 'none'],
    ['unreadable-path', 'ccd', 'manual'],
    // Draft pins (show)
    ['worktree-gone', 'ccd', 'auto'],
    ['ambiguous-worktree', 'ccd', 'none'],
    ['untrusted-worktree', 'ccd', 'none'],
    ['worktree-moved', 'ccd', 'auto'],
    ['draft-changed', 'ccd', 'auto'],
    // Fetch
    ['remote-absent', 'ccd', 'none'],
    ['remote-branch-absent', 'ccd', 'none'],
    ['fetch-auth-failed', 'ccd', 'none'],
    ['fetch-rejected-objects', 'ccd', 'none'],
    ['fetch-transport', 'ccd', 'manual'],
    ['ref-locked', 'ccd', 'auto-while-young'],
    ['fetch-too-soon', 'ccd', 'auto'],
    ['fetch-timeout', 'ccd', 'manual'],
    ['fetch-failed', 'ccd', 'manual'],
    // ccd generic
    ['git-failed', 'ccd', 'manual'],
    ['git-timeout', 'ccd', 'manual'],
    ['helper-unavailable', 'ccd', 'none'],
    ['helper-failed', 'ccd', 'manual'],
    // Server-only
    ['unsupported', 'server', 'none'],
    ['caps-unknown', 'server', 'auto'],
    ['not-granted', 'server', 'manual'],
    ['link-failed', 'server', 'auto'],
    ['link-timeout', 'server', 'auto'],
    ['docs-busy', 'server', 'auto'],
    ['ccd-timeout', 'server', 'manual'],
    ['ccd-killed', 'server', 'manual'],
    ['ccd-fault', 'server', 'manual'],
    ['answer-overflow', 'server', 'none'],
    ['malformed-answer', 'server', 'none'],
    ['unknown-failure', 'server', 'manual'],
    // Section 3.7
    ['foreign-request', 'server', 'none'],
    ['bad-query', 'server', 'none'],
    ['raster-mismatch', 'server', 'none'],
    ['response-type-refused', 'server', 'none'],
  ];

  const sorted = (xs: readonly string[]): string[] => [...xs].sort();

  describe('DOCS_FAILURES and DOCS_FAILURE_RETRY (row 53, L0 half)', () => {
    it('the hand table is whole: 58 distinct words, 42 ccd and 16 server', () => {
      const words = SPEC_WORDS.map(([w]) => w);
      expect(new Set(words).size).toBe(58);
      expect(words).toHaveLength(58);
      expect(SPEC_WORDS.filter(([, o]) => o === 'ccd')).toHaveLength(42);
      expect(SPEC_WORDS.filter(([, o]) => o === 'server')).toHaveLength(16);
    });

    it('DOCS_FAILURE_RETRY and DOCS_FAILURES name the same words, in both directions', () => {
      const failures = Object.keys(DOCS_FAILURES);
      const retry = Object.keys(DOCS_FAILURE_RETRY);
      for (const w of failures) expect(retry, `${w} has no retry class`).toContain(w);
      for (const w of retry) expect(failures, `${w} is a retry class for no word`).toContain(w);
      expect(sorted(retry)).toEqual(sorted(failures));
    });

    it('the code names exactly the spec table\'s words', () => {
      expect(sorted(Object.keys(DOCS_FAILURES))).toEqual(sorted(SPEC_WORDS.map(([w]) => w)));
    });

    it.each(SPEC_WORDS.map(([w, o, r]) => [w, o, r] as const))('%s is said by %s and retries %s', (word, origin, retry) => {
      expect(DOCS_FAILURES[word as DocsFailure]).toBe(origin);
      expect(DOCS_FAILURE_RETRY[word as DocsFailure]).toBe(retry);
    });

    it('ref-locked is the only auto-while-young word', () => {
      const young = (Object.keys(DOCS_FAILURE_RETRY) as DocsFailure[]).filter((w) => DOCS_FAILURE_RETRY[w] === 'auto-while-young');
      expect(young).toEqual(['ref-locked']);
    });

    it('not-granted retries manually (C3, it was none) and caps-unknown automatically (C1)', () => {
      expect(DOCS_FAILURE_RETRY['not-granted']).toBe('manual');
      expect(DOCS_FAILURE_RETRY['caps-unknown']).toBe('auto');
    });

    it('every retry class is one of the four', () => {
      const classes: readonly DocsRetryClass[] = ['auto', 'manual', 'none', 'auto-while-young'];
      for (const c of Object.values(DOCS_FAILURE_RETRY)) expect(classes).toContain(c);
    });
  });

  describe('DOCS_CCD_FAILURES', () => {
    it('is exactly the 42 ccd words of the hand table, each once', () => {
      const ccd = SPEC_WORDS.filter(([, o]) => o === 'ccd').map(([w]) => w);
      expect(DOCS_CCD_FAILURES).toHaveLength(42);
      expect(new Set(DOCS_CCD_FAILURES).size).toBe(42);
      expect(sorted(DOCS_CCD_FAILURES)).toEqual(sorted(ccd));
    });

    it('holds no server word: ccd never prints one', () => {
      for (const [w, o] of SPEC_WORDS) if (o === 'server') expect(DOCS_CCD_FAILURES).not.toContain(w);
    });

    it('follows the table: a word moved to the server side leaves the list (the derivation, single-definition.test.ts)', () => {
      for (const w of Object.keys(DOCS_FAILURES) as DocsFailure[]) {
        expect(DOCS_CCD_FAILURES.includes(w), w).toBe(DOCS_FAILURES[w] === 'ccd');
      }
    });
  });

  describe('DocsFetchFailure', () => {
    // Exhaustive in both directions at compile time: a missing word and an extra word are both type errors.
    const STAMPABLE: Record<DocsFetchFailure, true> = {
      'fetch-timeout': true, 'remote-branch-absent': true, 'fetch-rejected-objects': true, 'fetch-auth-failed': true,
      'ref-locked': true, 'fetch-transport': true, 'fetch-failed': true,
    };

    it('is the seven words docs-fetch classifies, every one a ccd word', () => {
      const words = Object.keys(STAMPABLE);
      expect(words).toHaveLength(7);
      for (const w of words) expect(DOCS_CCD_FAILURES, w).toContain(w);
    });

    it('leaves out remote-absent and fetch-too-soon: both are answered before any attempt', () => {
      expect(Object.keys(STAMPABLE)).not.toContain('remote-absent');
      expect(Object.keys(STAMPABLE)).not.toContain('fetch-too-soon');
    });
  });
});

describe('docs redactor: redactDocsText and DOCS_REDACT_RULES (row 62, the pattern home)', () => {
  // Token bodies are built at run time so this public file never carries a contiguous token-shaped literal.
  const BODY24 = 'A1b2'.repeat(6);

  it('declares four [pattern, suffix] rules, in order, each pure ASCII and valid under the u flag', () => {
    expect(DOCS_REDACT_RULES).toHaveLength(4);
    for (const [pattern, suffix] of DOCS_REDACT_RULES) {
      expect(/^[\x20-\x7e]+$/.test(pattern), pattern).toBe(true);
      expect(/^[\x20-\x7e]+$/.test(suffix), suffix).toBe(true);
      expect(() => new RegExp(pattern, 'gu')).not.toThrow();
    }
    expect(DOCS_REDACT_RULES.map(([, suffix]) => suffix)).toEqual(['***@', '***', '***', 'Authorization: ***']);
  });

  it('never writes \\s: the whitespace class is the explicit ASCII one', () => {
    for (const [pattern] of DOCS_REDACT_RULES) expect(pattern).not.toContain('\\s');
    expect(DOCS_REDACT_RULES[0]![0]).toContain(String.raw`[^/@\t\n\v\f\r ]`);
    expect(DOCS_REDACT_RULES[1]![0]).toContain(String.raw`[^&\t\n\v\f\r ]`);
  });

  it.each([
    ['URL userinfo', 'https://u:tok@h/x', 'https://***@h/x'],
    ['URL userinfo, a placeholder host', 'fatal: https://u:tok@example.invalid/x.git', 'fatal: https://***@example.invalid/x.git'],
    ['an access_token query value', 'GET /x?access_token=abc&x=1', 'GET /x?access_token=***&x=1'],
    ['a token query value after &', 'GET /x?a=1&token=z', 'GET /x?a=1&token=***'],
    ['a gho_ token', `remote: gho_${BODY24} rejected`, 'remote: gho_*** rejected'],
    ['a ghs_ token', `ghs_${BODY24}`, 'ghs_***'],
    ['a ghu_ token', `x ghu_${BODY24}`, 'x ghu_***'],
    ['a ghp_ token', `(ghp_${BODY24})`, '(ghp_***)'],
    ['an Authorization line, whole', 'Authorization: Basic xyz', 'Authorization: ***'],
    ['an Authorization line inside other text', 'before\n> Authorization: Basic xyz\nafter', 'before\nAuthorization: ***\nafter'],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactDocsText(input)).toBe(expected);
  });

  it.each([
    ['plain stderr', 'fatal: could not read from remote repository.'],
    ['a URL without userinfo', 'https://example.invalid/a/b@c'],
    ['a 19-character token body: below the 20 floor', `ghp_${'a'.repeat(19)}`],
    ['another gh prefix', `ghx_${BODY24}`],
    ['a key that only ends in token', 'GET /x?my_token=abc'],
    ['the empty string', ''],
  ])('leaves %s unchanged', (_label, input) => {
    expect(redactDocsText(input)).toBe(input);
  });

  it('is idempotent', () => {
    const corpus = [
      'https://u:tok@h/x', '?access_token=abc&x=1', '&token=z', `gho_${BODY24}`, 'Authorization: Basic xyz',
      'a https://u:p@h/x?token=t&access_token=q\nAuthorization: Bearer y\nz',
    ];
    for (const s of corpus) {
      const once = redactDocsText(s);
      expect(once).not.toBe(s);
      expect(redactDocsText(once)).toBe(once);
    }
  });

  it('applies every rule globally, not once', () => {
    expect(redactDocsText('https://a:b@h1/ https://c:d@h2/')).toBe('https://***@h1/ https://***@h2/');
    expect(redactDocsText(`gho_${BODY24} ghs_${BODY24}`)).toBe('gho_*** ghs_***');
  });

  // Whitespace parity: python's str \s also matches U+001C..U+001F, JS's also matches U+FEFF, and both match
  // U+00A0. None of the three is in the explicit ASCII class, so each is redacted alike on both sides;
  // an ASCII space or tab stops the userinfo match on both sides.
  it.each([
    ['U+001C', String.fromCharCode(0x1c)],
    ['U+00A0', String.fromCharCode(0xa0)],
    ['U+FEFF', String.fromCharCode(0xfeff)],
  ])('redacts userinfo carrying %s', (_label, ch) => {
    expect(redactDocsText(`https://u${ch}tok@h/x`)).toBe('https://***@h/x');
  });

  it.each([
    ['an ASCII space', ' '],
    ['a tab', '\t'],
  ])('stops the userinfo match at %s', (_label, ch) => {
    expect(redactDocsText(`https://u${ch}tok@h/x`)).toBe(`https://u${ch}tok@h/x`);
  });

  it('CONTROL: the same rule written with \\s would leave the U+FEFF row unredacted in JS', () => {
    const withS = new RegExp(DOCS_REDACT_RULES[0]![0].replace(String.raw`\t\n\v\f\r `, String.raw`\s`), 'gu');
    expect(withS.source).toContain(String.raw`[^/@\s]`);
    const input = `https://u${String.fromCharCode(0xfeff)}tok@h/x`;
    expect(input.replace(withS, '://***@')).toBe(input);
    expect(redactDocsText(input)).toBe('https://***@h/x');
  });
});

describe('docs ccd wire types: canned answers compile against the types', () => {
  const C1 = 'a'.repeat(40);
  const C2 = 'b'.repeat(40);
  const BLOB = 'c'.repeat(40);
  const FP = 'd'.repeat(64);
  const GITHUB = { state: 'named', slug: 'example-org/example-repo' } satisfies DocsGithub;

  const ENTRY = {
    section: 'specs', path: 'x.md',
    committed: { kind: 'file', blob: BLOB, size: 12 },
    draft: { state: 'modified', kind: 'file', size: 14, fp: FP, trust: 'hash' },
  } satisfies DocsEntry;

  const DRAFTS = {
    state: 'holder', branch: 'ws/a',
    worktree: { path: '/srv/worktrees/demo/a', head: C2, class: 'workspace' },
    baseEqual: true, base: { ahead: 1, behind: 0, count: 'measured' },
    caveats: [], opaque: [],
  } satisfies DraftsFacts;

  const TREE = {
    v: 1, verb: 'docs-tree', ok: true, elapsedMs: 41, project: 'demo',
    repo: { key: '0'.repeat(32), objectFormat: 'sha1', shallow: false },
    github: GITHUB,
    ref: {
      requested: 'ws/a', served: 'refs/heads/ws/a', name: 'ws/a', side: 'local', commit: C1, via: 'local',
      tried: [{ ref: 'refs/heads/ws/a', result: 'resolved' }],
      relation: 'local-ahead',
      counterpart: { ref: 'refs/remotes/origin/ws/a', commit: C2, ahead: 1, behind: 0, count: 'measured' },
    },
    mainCheckout: { path: '/srv/projects/demo', branch: 'main', head: C2 },
    sections: [
      { slug: 'specs', path: 'docs/superpowers/specs', state: 'present', count: 1 },
      { slug: 'plans', path: 'docs/superpowers/plans', state: 'absent', count: 0 },
      { slug: 'product-design', path: 'docs/product-design', state: 'absent', count: 0 },
      { slug: 'conventions', path: 'docs/conventions', state: 'not-a-directory', count: 0 },
    ],
    entries: [ENTRY],
    unlisted: { count: 1, byReason: { 'unsafe-char': 1 } },
    drafts: DRAFTS,
    freshness: {
      remote: 'origin', trackedRef: 'refs/remotes/origin/ws/a',
      stamp: { okAgeMs: null, attemptAgeMs: 5000, lastOutcome: 'ref-locked', okCommit: null },
      fetchHead: null,
    },
  } satisfies DocsTreeOk;

  const SHOW_COMMITTED = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 9, source: 'committed', section: 'specs', path: 'x.md',
    size: 2, sha256: FP, encoding: 'utf8', text: 'hi', commit: C1, blob: BLOB, mode: '100644', onRef: 'contains',
  } satisfies DocsShowOk;

  const SHOW_DRAFT = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 9, source: 'draft', section: 'plans', path: 'p.md',
    size: 3, sha256: FP, encoding: 'base64', b64: 'AAAA', worktree: '/srv/worktrees/demo/a', branch: 'ws/a', head: C2, fp: FP,
  } satisfies DocsShowOk;

  const FETCH = {
    v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 800, branch: 'main', trackedRef: 'refs/remotes/origin/main',
    defaultVia: 'default:origin-head', before: null, after: C1, moved: 'created', stamp: 'written',
  } satisfies DocsFetchOk;

  const INDEX = {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 120, unlisted: 1,
    duplicates: [],
    projects: [
      {
        project: 'demo', state: 'ready', github: GITHUB, repoKey: '0'.repeat(32),
        default: { name: 'main', via: 'default:origin-head', commit: C1 },
        sections: { specs: 3, plans: 1, 'product-design': null, conventions: null },
        fetch: { okAgeMs: 1000, lastOutcome: 'ok' },
      },
      { project: 'example-project', state: 'not-a-git-repo', github: { state: 'none' }, sectionsOnDisk: ['specs'] },
      { project: 'demo-wt', state: 'linked-worktree', github: { state: 'none' }, owner: 'demo', branch: 'ws/a' },
    ],
  } satisfies DocsIndexOk;

  const CCD_FAIL = {
    v: 1, verb: 'docs-fetch', ok: false, elapsedMs: 0, failure: 'fetch-too-soon', retryAfterMs: 4200,
  } satisfies DocsCcdFailure;

  const NOT_A_FILE = {
    v: 1, verb: 'docs-show', ok: false, elapsedMs: 3, failure: 'not-a-file', kind: 'section-not-a-directory',
  } satisfies DocsCcdFailure;

  const BODY = {
    ok: false, failure: 'unresolved-ref', tried: [{ ref: 'refs/remotes/origin/main', result: 'absent' }], suggest: 'main',
  } satisfies DocsFailureBody;

  it('every canned answer survives the wire as JSON unchanged', () => {
    for (const o of [TREE, SHOW_COMMITTED, SHOW_DRAFT, FETCH, INDEX, CCD_FAIL, NOT_A_FILE, BODY]) {
      expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    }
  });

  it('an index row is DocsIndexRow, and a show fp equals its sha256', () => {
    const row: DocsIndexRow = INDEX.projects[0]!;
    expect(row.state).toBe('ready');
    expect(SHOW_DRAFT.fp).toBe(SHOW_DRAFT.sha256);
  });

  it('the types refuse what the spec does not name', () => {
    const verbs: DocsVerb[] = ['docs-index', 'docs-tree', 'docs-show', 'docs-fetch'];
    const kind: DocsNotAFileKind = 'other-device';
    const ctx: DocsFailureContext = { lockAgeMs: null, lane: 'fetch' };
    // @ts-expect-error -- remote-absent is answered before any attempt, so no stamp records it
    const stamped: DocsFetchFailure = 'remote-absent';
    // @ts-expect-error -- a word outside DOCS_FAILURES is a compile error, never a string
    const unknownWord: DocsFailureBody = { ok: false, failure: 'not-a-word' };
    // @ts-expect-error -- show answers utf8 or base64 only
    const hex: DocsShowOk['encoding'] = 'hex';
    // @ts-expect-error -- a ccd failure line names one of the four verbs
    const verb: DocsCcdFailure['verb'] = 'docs-list';
    // @ts-expect-error -- four retry classes, no fifth
    const later: DocsRetryClass = 'later';
    // @ts-expect-error -- not-a-file's kinds are the nine of section 2 (i)
    const folder: DocsFailureContext = { kind: 'folder' };
    expect([verbs, kind, ctx, stamped, unknownWord, hex, verb, later, folder]).toHaveLength(9);
  });
});
