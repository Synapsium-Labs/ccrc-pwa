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
    // Only \n bounds a line: \r, U+2028 and U+2029 are inside it, so the whole run is the match (the rule is anchored to
    // a line start by a lookbehind that names \n alone, and it must give the unanchored rule's results).
    ['an Authorization run bounded by \\r only', 'a\rAuthorization: x\rb', 'Authorization: ***'],
    ['an Authorization run bounded by U+2028 and U+2029', 'a\u2028Authorization: x\u2029b', 'Authorization: ***'],
    ['two Authorization lines', 'Authorization: a\nx\nAuthorization: b', 'Authorization: ***\nx\nAuthorization: ***'],
    ['an Authorization at the end after a newline', 'x\nAuthorization:', 'x\nAuthorization: ***'],
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

  // The fourth rule's work is linear in the input: it runs over unbounded stderr before the helper's cut, on the
  // server's event loop. A rule that rescans a line from every start position is quadratic (a 1 MiB line took
  // minutes). The line holds no 'Authorization', so nothing matches and every start position is tried.
  it('redacts one 1 MiB line with no newline and no Authorization in under 2000 ms', () => {
    const line = 'x'.repeat(1024 * 1024);
    const t0 = performance.now();
    const out = redactDocsText(line);
    const ms = performance.now() - t0;
    expect(out).toBe(line);
    expect(ms).toBeLessThan(2000);
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

// ---- (F)-(G): content classes, the raster table, class caps, response headers and wrappers, resolveDocRef ----
// Spec 5.1, 5.3, 6.1, 3.5, 3.6 and 4.11; the L0 cases of M5.3 and M5.7. APPENDED by Task 3. The two imports
// below bind fresh names only (a namespace and an alias), so no name an earlier block of this file imports is
// bound twice; `describe`, `it` and `expect` come from the file's own first import.
import * as DocsFG from '../../shared/docs.js';
import { readFileSync as readDocsSourceFG } from 'node:fs';

/** Bytes from a string of char codes 0-255 (no `Buffer`, so a row reads as the bytes it names). */
const bytesFG = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('(F) contentClass (spec 5.1; M5.3, L0 cases)', () => {
  it.each([
    ['A.PNG', 'raster'],
    ['x.png.html', 'html'],
    ['.png', 'other'],
    ['a.b/.png', 'other'],
    ['.notes.md', 'other'],
    ['x.', 'other'],
    ['README', 'other'],
    ['x.mar\u212Adown', 'other'],
    ['x.\u00e9', 'other'],
    ['x.svgz', 'other'],
    ['x.xhtml', 'text'],
    ['x.svg', 'svg'],
    ['a/b.c/README', 'other'],
    ['a.md/README', 'other'],
    ['x.abcdefghijk', 'other'],
    ['x.pdf', 'other'],
    ['x.woff2', 'other'],
    ['x.tar.gz', 'other'],
    ['dir/Notes.MarkDown', 'markdown'],
    ['photo.JPEG', 'raster'],
  ] as const)('%s is %s', (p, cls) => {
    expect(DocsFG.contentClass(p)).toBe(cls);
  });

  it('CONTROL: the U+212A row is one toLowerCase() gets wrong, so it pins the ASCII-only lowering', () => {
    expect('x.mar\u212Adown'.toLowerCase()).toBe('x.markdown');
  });

  it('the table is spec 5.1 verbatim', () => {
    expect(DocsFG.DOC_CONTENT_CLASS_BY_EXT).toEqual({
      md: 'markdown', markdown: 'markdown',
      png: 'raster', jpg: 'raster', jpeg: 'raster', gif: 'raster', webp: 'raster',
      svg: 'svg', html: 'html', htm: 'html',
      txt: 'text', json: 'text', yaml: 'text', yml: 'text', toml: 'text', csv: 'text', tsv: 'text', log: 'text',
      ts: 'text', tsx: 'text', js: 'text', mjs: 'text', cjs: 'text', css: 'text', py: 'text', sh: 'text',
      sql: 'text', diff: 'text', patch: 'text', xml: 'text', xsl: 'text', xhtml: 'text',
    });
  });

  it('maps every table key as declared, in either ASCII case, by the final component alone', () => {
    for (const [ext, cls] of Object.entries(DocsFG.DOC_CONTENT_CLASS_BY_EXT)) {
      expect(DocsFG.contentClass(`x.${ext}`), ext).toBe(cls);
      expect(DocsFG.contentClass(`a.b/X.${ext.toUpperCase()}`), ext).toBe(cls);
    }
  });
});

describe('(F) DOCS_CLASS_CAP (spec 6.1)', () => {
  it('holds each class to its cap', () => {
    expect(DocsFG.DOCS_CLASS_CAP).toEqual({
      markdown: 2097152, raster: 2097152, svg: 2097152, html: 2097152, text: 2097152, other: 2097152,
    });
  });

  it('each value is its source constant', () => {
    for (const cls of ['raster', 'svg'] as const) {
      expect(DocsFG.DOCS_CLASS_CAP[cls], cls).toBe(DocsFG.DOCS_MAX_IMAGE_BYTES);
    }
    for (const cls of ['markdown', 'html', 'text', 'other'] as const) {
      expect(DocsFG.DOCS_CLASS_CAP[cls], cls).toBe(DocsFG.DOCS_MAX_DOC_BYTES);
    }
  });

  it('names its source constant per class in the source text, because the two caps are equal today', () => {
    // A swap of DOCS_MAX_IMAGE_BYTES for DOCS_MAX_DOC_BYTES is invisible to the value checks above while both
    // are 2 MiB; it stops being invisible the day either one moves. The declaration says which is which.
    const src = readDocsSourceFG(new URL('../../shared/docs.ts', import.meta.url), 'utf8');
    const decl = /^export const DOCS_CLASS_CAP: Record<DocContentClass, number> = \{\n([\s\S]*?)\n\};$/m.exec(src);
    expect(decl, 'the DOCS_CLASS_CAP declaration was not found').not.toBeNull();
    const named = Object.fromEntries([...(decl?.[1] ?? '').matchAll(/(\w+): (\w+),/g)].map((m) => [m[1], m[2]]));
    expect(named).toEqual({
      markdown: 'DOCS_MAX_DOC_BYTES', raster: 'DOCS_MAX_IMAGE_BYTES', svg: 'DOCS_MAX_IMAGE_BYTES',
      html: 'DOCS_MAX_DOC_BYTES', text: 'DOCS_MAX_DOC_BYTES', other: 'DOCS_MAX_DOC_BYTES',
    });
  });
});

describe('(F) the raster table and sniffRaster (spec 5.1)', () => {
  const SAMPLE: Record<DocsFG.RasterType, Uint8Array> = {
    png: bytesFG('\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR'),
    jpeg: bytesFG('\xff\xd8\xff\xe0\x00\x10JFIF\x00'),
    gif: bytesFG('GIF89a\x01\x00\x01\x00'),
    webp: bytesFG('RIFF\x1a\x00\x00\x00WEBPVP8 '),
  };
  const TYPES = ['png', 'jpeg', 'gif', 'webp'] as const;

  it('names each type its MIME, and every raster extension of the class table its type', () => {
    expect(Object.fromEntries(TYPES.map((t) => [t, DocsFG.DOCS_RASTER_TYPES[t].mime]))).toEqual({
      png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    });
    expect(Object.keys(DocsFG.DOCS_RASTER_TYPES)).toEqual([...TYPES]);
    expect(DocsFG.DOCS_RASTER_EXT).toEqual({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' });
    const rasterExts = Object.entries(DocsFG.DOC_CONTENT_CLASS_BY_EXT).filter(([, c]) => c === 'raster').map(([e]) => e);
    expect(Object.keys(DocsFG.DOCS_RASTER_EXT).sort()).toEqual(rasterExts.sort());
  });

  it('matches only on the diagonal of the 4x4 (declared, actual) matrix', () => {
    for (const declared of TYPES) {
      for (const actual of TYPES) {
        expect(DocsFG.sniffRaster(declared, SAMPLE[actual]), `${declared} declared, ${actual} bytes`)
          .toBe(declared === actual ? 'match' : 'mismatch');
      }
    }
  });

  it.each([
    ['SVG bytes', bytesFG('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['empty input', new Uint8Array(0)],
    ['the first three bytes of the PNG signature', bytesFG('\x89PN')],
    ['the first three bytes of a GIF header', bytesFG('GIF')],
  ] as const)('%s mismatch every type', (_label, b) => {
    for (const t of TYPES) expect(DocsFG.sniffRaster(t, b), t).toBe('mismatch');
  });

  it('accepts both GIF headers and nothing between them', () => {
    expect(DocsFG.sniffRaster('gif', bytesFG('GIF87a\x01\x00'))).toBe('match');
    expect(DocsFG.sniffRaster('gif', bytesFG('GIF89a\x01\x00'))).toBe('match');
    expect(DocsFG.sniffRaster('gif', bytesFG('GIF88a\x01\x00'))).toBe('mismatch');
  });

  it('needs both RIFF at offset 0 and WEBP at offset 8 for webp', () => {
    expect(DocsFG.sniffRaster('webp', bytesFG('RIFF\x00\x00\x00\x00WEBP'))).toBe('match');
    expect(DocsFG.sniffRaster('webp', bytesFG('RIFF\x00\x00\x00\x00WAVE')), 'a RIFF that is not WEBP').toBe('mismatch');
    expect(DocsFG.sniffRaster('webp', bytesFG('XXXX\x00\x00\x00\x00WEBP')), 'WEBP without RIFF').toBe('mismatch');
    expect(DocsFG.sniffRaster('webp', bytesFG('RIFFWEBP\x00\x00\x00\x00')), 'WEBP at offset 4').toBe('mismatch');
    expect(DocsFG.sniffRaster('webp', bytesFG('RIFF\x00\x00\x00\x00WEB')), 'truncated at 11 bytes').toBe('mismatch');
  });
});

describe('(F) the docs response headers (spec 5.3)', () => {
  it('carries the approved CSP, exactly', () => {
    expect(DocsFG.DOCS_RESPONSE_CSP)
      .toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'");
  });

  it('carries the four headers with exact values, the CSP by reference', () => {
    expect(DocsFG.DOCS_RESPONSE_HEADERS).toEqual({
      'x-content-type-options': 'nosniff',
      'content-security-policy': DocsFG.DOCS_RESPONSE_CSP,
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
    });
  });

  it('allows JSON and the four raster types, and nothing a browser would render as a document', () => {
    expect(DocsFG.DOCS_ALLOWED_CONTENT_TYPES)
      .toEqual(['application/json; charset=utf-8', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    for (const t of ['text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'text/plain', 'application/octet-stream', 'application/xml']) {
      expect(DocsFG.DOCS_ALLOWED_CONTENT_TYPES, t).not.toContain(t);
    }
  });
});

describe('(F) the HTTP response wrappers (spec 3.5, 3.6): compiled by typecheck-tests', () => {
  const SHOW: DocsFG.DocsShowOk = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 0, source: 'committed', section: 'specs', path: 'a.md',
    size: 2, sha256: '0'.repeat(64), encoding: 'utf8', text: 'hi', commit: '0'.repeat(40), blob: '0'.repeat(40),
    mode: '100644', onRef: 'contains',
  };
  const BUSY: DocsFG.DocsFailureBody = { ok: false, failure: 'docs-busy', lane: 'read', retryAfterMs: 3000 };

  it('a file answer carries every class but raster', () => {
    const file: DocsFG.DocsFileResponse = { ok: true, contentClass: 'markdown', show: SHOW, from: 'cache' };
    const rasterAsJson: DocsFG.DocsFileResponse = {
      ok: true,
      // @ts-expect-error a raster never rides the JSON envelope; its bytes are the answer (spec 3.6)
      contentClass: 'raster',
      show: SHOW,
      from: 'ccd',
    };
    expect([file.contentClass, rasterAsJson.from]).toEqual(['markdown', 'ccd']);
  });

  it('a refresh answer carries one of three fetch arms, and a tree or a failure body', () => {
    const fetches: DocsFG.DocsRefreshFetch[] = [
      { state: 'ran', answer: { v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 0, branch: 'main',
        trackedRef: 'refs/remotes/origin/main', defaultVia: 'default:origin-head', before: null,
        after: '0'.repeat(40), moved: 'created', stamp: 'written' } },
      { state: 'failed', failure: BUSY },
      { state: 'skipped', why: 'local-ref' },
    ];
    const refresh: DocsFG.DocsRefreshResponse = { ok: true, fetch: { state: 'skipped', why: 'local-ref' }, tree: BUSY };
    // Compile-time only: a tree answer's `tree` is ccd's DocsTreeOk, unchanged.
    const treeOf = (r: DocsFG.DocsTreeResponse): DocsFG.DocsTreeOk => r.tree;
    const projects: DocsFG.DocsProjectsResponse = {
      ok: true, cacheAgeMs: null,
      index: { v: 1, verb: 'docs-index', ok: true, elapsedMs: 0, unlisted: 0, duplicates: [], projects: [] },
    };
    expect(fetches.map((f) => f.state)).toEqual(['ran', 'failed', 'skipped']);
    expect(refresh.tree.ok).toBe(false);
    expect(projects.cacheAgeMs).toBeNull();
    expect(typeof treeOf).toBe('function');
  });
});

describe('(G) resolveDocRef (spec 4.11; M5.7, L0 cases)', () => {
  type From = { section: DocsFG.DocSectionSlug; path: string };
  const SPEC: From = { section: 'specs', path: 'a.md' };
  const PLAN: From = { section: 'plans', path: 'p.md' };
  const NESTED: From = { section: 'specs', path: 'sub/n.md' };
  const refused = (why: string) => ({ kind: 'refused', why });
  const doc = (section: string, path: string, fragment: string | null = null) => ({ kind: 'doc', section, path, fragment });
  const repo = (repoPath: string) => ({ kind: 'repo', repoPath });

  it.each([
    ['a tab inside javascript:', SPEC, 'java\tscript:alert(1)', refused('malformed')],
    ['a newline inside javascript:', SPEC, 'java\nscript:alert(1)', refused('malformed')],
    ['javascript:', SPEC, 'javascript:alert(1)', refused('scheme')],
    ['a leading space', SPEC, ' https://h/x', { kind: 'external', url: 'https://h/x', scheme: 'https', origin: 'https://h' }],
    ['C0 and whitespace at both ends', SPEC, '\u0001\thttps://h/x\n ', { kind: 'external', url: 'https://h/x', scheme: 'https', origin: 'https://h' }],
    ['HTTPS://h/x', SPEC, 'HTTPS://h/x', { kind: 'external', url: 'https://h/x', scheme: 'https', origin: 'https://h' }],
    ['http with port, query and fragment', SPEC, 'http://h:8080/x?y#z', { kind: 'external', url: 'http://h:8080/x?y#z', scheme: 'http', origin: 'http://h:8080' }],
    ['mailto:', SPEC, 'mailto:a@example.invalid', { kind: 'external', url: 'mailto:a@example.invalid', scheme: 'mailto', origin: null }],
    ['an http URL that does not parse', SPEC, 'https://', refused('malformed')],
    ['another scheme', SPEC, 'ftp://h/x', refused('scheme')],
    ['a drive-letter lookalike', SPEC, 'c:/x', refused('scheme')],
    ['data:', SPEC, 'data:image/png;base64,AAAA', { kind: 'self-contained', scheme: 'data' }],
    ['DATA: in upper case', SPEC, 'DATA:,x', { kind: 'self-contained', scheme: 'data' }],
    ['blob:', SPEC, 'blob:https://h/0000', { kind: 'self-contained', scheme: 'blob' }],
    ['//h/x', SPEC, '//h/x', refused('protocol-relative')],
    ['a leading double backslash', SPEC, '\\\\h\\x', refused('malformed')],
    ['a backslash after /', SPEC, '/\\h/x', refused('malformed')],
    ['a backslash inside a relative path', SPEC, 'a\\b.md', refused('malformed')],
    ['/api/x', SPEC, '/api/x', refused('root-relative')],
    ['empty', SPEC, '', refused('empty')],
    ['only whitespace', SPEC, ' \t\n', refused('empty')],
    ['#f', SPEC, '#f', { kind: 'fragment', fragment: 'f' }],
    ['a space inside a fragment', SPEC, '#a b', refused('malformed')],
    ['# alone', SPEC, '#', { kind: 'fragment', fragment: '' }],
    ['x.png?q#f', SPEC, 'x.png?q#f', doc('specs', 'x.png', 'f')],
    ['a ? inside the fragment', SPEC, 'x.md#a?b', doc('specs', 'x.md', 'a?b')],
    ['specs/a.md from plans', PLAN, 'specs/a.md', doc('plans', 'specs/a.md')],
    ['../plans/x.md from specs', SPEC, '../plans/x.md', doc('plans', 'x.md')],
    ['a section-name lookalike', SPEC, '../specs-old/a.md', repo('docs/superpowers/specs-old/a.md')],
    ['product-design from specs', SPEC, '../../product-design/m.html', doc('product-design', 'm.html')],
    ['conventions from specs', SPEC, '../../conventions/c.md', doc('conventions', 'c.md')],
    ['../../README.md from a top-level spec', SPEC, '../../README.md', repo('docs/README.md')],
    ['../../../README.md from a top-level spec', SPEC, '../../../README.md', repo('README.md')],
    ['%2e%2e/%2e%2e/x', SPEC, '%2e%2e/%2e%2e/x', repo('docs/x')],
    ['a/../../../../x, which climbs exactly to the root', SPEC, 'a/../../../../x', repo('x')],
    ['four levels up from three', SPEC, '../../../../x', refused('above-root')],
    ['a/../../../../../x', SPEC, 'a/../../../../../x', refused('above-root')],
    ['an encoded climb past the root', SPEC, '%2e%2e/%2E%2E/.%2e/%2e./x', refused('above-root')],
    ['x.md from a nested spec', NESTED, 'x.md', doc('specs', 'sub/x.md')],
    ['../x.md from a nested spec', NESTED, '../x.md', doc('specs', 'x.md')],
    ['%2541.md, decoded once', SPEC, '%2541.md', doc('specs', '%41.md')],
    ['%252e%252e/x.md, decoded once', SPEC, '%252e%252e/x.md', doc('specs', '%2e%2e/x.md')],
    ['a raw non-ASCII name', SPEC, '\u00e9.md', doc('specs', '\u00e9.md')],
    ['the same name percent-encoded', SPEC, '%C3%A9.md', doc('specs', '\u00e9.md')],
    ['an encoded /', SPEC, 'a%2Fb.md', refused('bad-path')],
    ['an encoded NUL', SPEC, '%00.md', refused('bad-path')],
    ['an encoded U+202E', SPEC, '%E2%80%AE.md', refused('bad-path')],
    ['a bad percent sequence', SPEC, '%zz.md', refused('bad-path')],
    ['the section directory itself', SPEC, './', refused('bad-path')],
    ['a trailing slash', SPEC, 'sub/', refused('bad-path')],
    ['a query alone', SPEC, '?q', refused('bad-path')],
    ['the repository root', SPEC, '../../../', refused('bad-path')],
    ['an encoded NUL outside the sections', SPEC, '../../../%00', refused('bad-path')],
    ['a page in a directory named a#b', { section: 'specs', path: 'a#b/c.md' }, 'y.md', doc('specs', 'a#b/y.md')],
    ['a page in a directory named %2e%2e', { section: 'specs', path: '%2e%2e/c.md' }, 'y.md', doc('specs', '%2e%2e/y.md')],
    ['a page path outside the grammar', { section: 'specs', path: '../c.md' }, 'y.md', refused('bad-path')],
  ] as const)('%s', (_label, from, ref, want) => {
    expect(DocsFG.resolveDocRef(from, ref)).toEqual(want);
  });

  it('a long run of interior whitespace is refused as malformed in linear time (spec 5.6.2: a mockup never freezes the console)', () => {
    const ref = 'x' + ' '.repeat(200000) + 'y';
    const t0 = performance.now();
    const got = DocsFG.resolveDocRef(SPEC, ref);
    const elapsed = performance.now() - t0;
    expect(got).toEqual(refused('malformed'));
    expect(elapsed).toBeLessThan(2000);
  });

  it('CONTROL: URL itself clamps a climb at the root, so the above-root rows pin the walk and not URL', () => {
    expect(new URL('../../../../x', 'https://docs.invalid/docs/superpowers/specs/').pathname).toBe('/x');
  });

  it('CONTROL: a browser deletes a tab inside a scheme, so java<TAB>script: is malformed rather than inert', () => {
    expect(new URL('java\tscript:alert(1)').protocol).toBe('javascript:');
  });
});

// ---- Section H: entryView, admitDraft and githubBlobUrl (docs W1a, Task 4) ----------------------------------
// Spec 2026-10-01 2 (d) "What overlays", 4.6 and 3.11; row 53 (L0 half) and M3.11. APPENDED after the earlier
// tasks' blocks. One namespace import, so no binding here can collide with a name an earlier block imported.
import * as docsH from '../../shared/docs.js';

describe('docs section H: entryView, admitDraft and githubBlobUrl', () => {
  type Entry = docsH.DocsEntry;
  type Drafts = docsH.DraftsFacts;
  type Draft = NonNullable<Entry['draft']>;
  type CommittedKind = NonNullable<Entry['committed']>['kind'];
  type NonHolder = Exclude<Drafts['state'], 'holder'>;

  // Every axis is the KEY SET of a Record over the wire type's own union: a member added to the type without a
  // row here, or a row the type does not have, is a compile error (typecheck-tests), so the matrix below cannot
  // silently skip a state or a kind.
  const STATE_KEYS: Record<Draft['state'], true> = {
    modified: true, added: true, untracked: true, deleted: true, typechange: true, conflicted: true,
  };
  const KIND_KEYS: Record<Draft['kind'], true> = {
    file: true, symlink: true, directory: true, special: true, hardlink: true, 'foreign-owner': true,
    'other-device': true, unreadable: true, absent: true,
  };
  const COMMITTED_KEYS: Record<CommittedKind | 'none', true> = {
    none: true, file: true, exec: true, symlink: true, submodule: true,
  };
  const STATES = Object.keys(STATE_KEYS) as Draft['state'][];
  const KINDS = Object.keys(KIND_KEYS) as Draft['kind'][];
  const COMMITTED = Object.keys(COMMITTED_KEYS) as (CommittedKind | 'none')[];
  const MODES: docsH.EntryMode[] = ['default', 'ref'];

  const SHA_C = 'c'.repeat(40);
  const holder = (baseEqual: boolean): Drafts => ({
    state: 'holder', branch: 'ws/a',
    worktree: { path: '/srv/worktrees/demo-a', head: baseEqual ? SHA_C : 'd'.repeat(40), class: 'workspace' },
    baseEqual, base: baseEqual ? null : { ahead: 1, behind: 0, count: 'measured' }, caveats: [], opaque: [],
  });
  const NON_HOLDER: { [S in NonHolder]: Extract<Drafts, { state: S }> } = {
    none: { state: 'none', branch: 'ws/a', skipped: [] },
    ambiguous: { state: 'ambiguous', branch: 'ws/a', candidates: ['/srv/worktrees/demo-a', '/srv/worktrees/demo-b'] },
    untrusted: { state: 'untrusted', branch: 'ws/a', worktree: '/srv/worktrees/demo-a', why: 'common-dir' },
    unreadable: { state: 'unreadable', branch: 'ws/a', worktree: null, step: 'worktree-list', detail: 'timeout' },
    unsettled: { state: 'unsettled', branch: 'ws/a', worktree: '/srv/worktrees/demo-a' },
    'too-many': { state: 'too-many', branch: 'ws/a', worktree: '/srv/worktrees/demo-a', count: 1001, bytes: 1 },
  };

  /** One point of the matrix, described by its own axes; the oracle reads these, never an EntryView. */
  interface Case {
    draft: null | { state: Draft['state']; kind: Draft['kind']; fp: boolean };
    drafts: 'holder' | NonHolder;
    baseEqual: boolean;   // read only when drafts is 'holder'
    mode: docsH.EntryMode;
    committed: CommittedKind | 'none';
  }
  const entryOf = (c: Case): Entry => ({
    section: 'specs', path: '2026-01-01-demo.md',
    committed: c.committed === 'none' ? null : { kind: c.committed, blob: 'b'.repeat(40), size: 120 },
    draft: c.draft === null ? null
      : { state: c.draft.state, kind: c.draft.kind, size: 120, fp: c.draft.fp ? 'f'.repeat(64) : null, trust: 'status' },
  });
  const factsOf = (c: Case): Drafts => (c.drafts === 'holder' ? holder(c.baseEqual) : NON_HOLDER[c.drafts]);
  const label = (c: Case): string => JSON.stringify(c);

  const DRAFTS: Case['draft'][] = [null];
  for (const state of STATES) for (const kind of KINDS) for (const fp of [true, false]) DRAFTS.push({ state, kind, fp });
  const FACTS: [Case['drafts'], boolean][] = [
    ['holder', true], ['holder', false], ...(Object.keys(NON_HOLDER) as NonHolder[]).map((s): [NonHolder, boolean] => [s, false]),
  ];
  const CASES: Case[] = [];
  for (const draft of DRAFTS) for (const [drafts, baseEqual] of FACTS) for (const mode of MODES) {
    for (const committed of COMMITTED) CASES.push({ draft, drafts, baseEqual, mode, committed });
  }

  // THE ORACLE: spec 4.6's ten case rows, transcribed as data. Each row is a predicate over the case's axes and
  // the view that row requires. Nothing here calls shared/docs.ts. The overlay formula is spec 2 (d)'s, written
  // out again from the spec on purpose: `overlay = mode === 'ref' && admitDraft(e, d)`.
  //
  // Two readings, both recorded in this plan's Spec refinements list:
  //  - "opens committed" in rows 6-10 means the committed side as rows 1-2 open it: a file or exec opens
  //    committed; a symlink, a submodule or nothing committed opens nothing.
  //  - row 10 is every kind that is neither `file` nor `unreadable`. ccd emits `absent` only with `deleted`
  //    (row 6), so an `absent` under another state is off-contract, and it lands here, on not-a-file.
  const overlay = (c: Case): boolean => c.mode === 'ref' && c.drafts === 'holder' && c.baseEqual && c.draft !== null;
  const has = (c: Case, p: (d: NonNullable<Case['draft']>) => boolean): boolean => c.draft !== null && p(c.draft);
  const fileSide = (c: Case): boolean => c.committed === 'file' || c.committed === 'exec';
  const kindOf = (c: Case): docsH.EntryView['committedKind'] => (c.committed === 'none' ? null : c.committed);
  const sideOpens = (c: Case): docsH.EntryView['opens'] => (fileSide(c) ? 'committed' : 'none');
  const notDelTc = (d: NonNullable<Case['draft']>): boolean => d.state !== 'deleted' && d.state !== 'typechange';
  const withheldRow = (c: Case, why: docsH.WithheldReason): docsH.EntryView => ({
    listed: c.committed !== 'none' || has(c, (d) => d.state === 'added' || d.state === 'untracked'),
    opens: sideOpens(c), badge: 'withheld', withheld: why, offersCommitted: false, committedKind: kindOf(c),
  });
  const ROWS: readonly { row: string; when: (c: Case) => boolean; view: (c: Case) => docsH.EntryView }[] = [
    {
      row: '1 no overlay, committed file/exec',
      when: (c) => !overlay(c) && fileSide(c),
      view: (c) => ({ listed: true, opens: 'committed', badge: null, withheld: null, offersCommitted: false, committedKind: kindOf(c) }),
    },
    {
      row: '2 no overlay, committed symlink/submodule',
      when: (c) => !overlay(c) && (c.committed === 'symlink' || c.committed === 'submodule'),
      view: (c) => ({ listed: true, opens: 'none', badge: null, withheld: null, offersCommitted: false, committedKind: kindOf(c) }),
    },
    {
      row: '3 no overlay, no committed entry',
      when: (c) => !overlay(c) && c.committed === 'none',
      view: () => ({ listed: false, opens: 'none', badge: null, withheld: null, offersCommitted: false, committedKind: null }),
    },
    {
      row: '4 overlay, modified/conflicted, file with fp',
      when: (c) => overlay(c) && has(c, (d) => (d.state === 'modified' || d.state === 'conflicted') && d.kind === 'file' && d.fp),
      view: (c) => ({
        listed: true, opens: 'draft', badge: c.draft?.state === 'conflicted' ? 'conflicted' : 'modified', withheld: null,
        offersCommitted: fileSide(c), committedKind: kindOf(c),
      }),
    },
    {
      row: '5 overlay, added/untracked, file with fp',
      when: (c) => overlay(c) && has(c, (d) => (d.state === 'added' || d.state === 'untracked') && d.kind === 'file' && d.fp),
      view: (c) => ({ listed: true, opens: 'draft', badge: 'new', withheld: null, offersCommitted: fileSide(c), committedKind: kindOf(c) }),
    },
    {
      row: '6 overlay, deleted',
      when: (c) => overlay(c) && has(c, (d) => d.state === 'deleted'),
      view: (c) => ({
        listed: c.committed !== 'none', opens: sideOpens(c), badge: 'deleted', withheld: null, offersCommitted: false,
        committedKind: kindOf(c),
      }),
    },
    {
      row: '7 overlay, typechange',
      when: (c) => overlay(c) && has(c, (d) => d.state === 'typechange'),
      view: (c) => ({
        listed: c.committed !== 'none', opens: sideOpens(c), badge: 'typechange', withheld: null, offersCommitted: false,
        committedKind: kindOf(c),
      }),
    },
    {
      row: '8 overlay, file with fp null',
      when: (c) => overlay(c) && has(c, (d) => notDelTc(d) && d.kind === 'file' && !d.fp),
      view: (c) => withheldRow(c, 'too-large'),
    },
    {
      row: '9 overlay, kind unreadable',
      when: (c) => overlay(c) && has(c, (d) => notDelTc(d) && d.kind === 'unreadable'),
      view: (c) => withheldRow(c, 'unreadable'),
    },
    {
      row: '10 overlay, kind symlink/directory/special/hardlink/foreign-owner/other-device',
      when: (c) => overlay(c) && has(c, (d) => notDelTc(d) && d.kind !== 'file' && d.kind !== 'unreadable'),
      view: (c) => withheldRow(c, 'not-a-file'),
    },
  ];
  const VIEW_KEYS = ['listed', 'opens', 'badge', 'withheld', 'offersCommitted', 'committedKind'] as const;

  describe('the entryView matrix against the spec 4.6 oracle (row 53, L0 half)', () => {
    it('generates the whole matrix: 109 drafts x 8 drafts facts x 2 modes x 5 committed sides', () => {
      // 109 = no draft, plus 6 states x 9 kinds x fp set or null; 8 = a holder with baseEqual true or false, plus
      // the 6 other states.
      expect(DRAFTS.length).toBe(1 + 6 * 9 * 2);
      expect(FACTS.length).toBe(8);
      expect(CASES.length).toBe(109 * 8 * 2 * 5);
    });

    it('CONTROL: the oracle matches every case exactly once, and each of its ten rows is reached', () => {
      const overlapsOrGaps: string[] = [];
      const reached = new Map<string, number>(ROWS.map((r) => [r.row, 0]));
      for (const c of CASES) {
        const m = ROWS.filter((r) => r.when(c));
        if (m.length !== 1) overlapsOrGaps.push(`${label(c)} -> ${m.map((r) => r.row).join(' + ') || 'no row'}`);
        for (const r of m) reached.set(r.row, (reached.get(r.row) ?? 0) + 1);
      }
      expect(overlapsOrGaps.slice(0, 10)).toEqual([]);
      expect([...reached].filter(([, n]) => n === 0).map(([row]) => row)).toEqual([]);
    });

    it('entryView equals the oracle on every case, field by field, with no extra field', () => {
      const wrong: string[] = [];
      for (const c of CASES) {
        const row = ROWS.find((r) => r.when(c));
        if (row === undefined) { wrong.push(`${label(c)}: no oracle row`); continue; }
        const want = row.view(c);
        const got = docsH.entryView(entryOf(c), factsOf(c), c.mode);
        const fields = VIEW_KEYS.filter((k) => got[k] !== want[k]);
        const keys = Object.keys(got).sort().join(',');
        if (fields.length > 0 || keys !== [...VIEW_KEYS].sort().join(',')) {
          wrong.push(`${label(c)} [${row.row}]: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        }
      }
      expect(wrong.slice(0, 10)).toEqual([]);
      expect(wrong.length).toBe(0);
    });
  });

  describe('entryView precedence (spec 2 (d), 4.6)', () => {
    const at = (committed: Entry['committed'], draft: Entry['draft']): Entry =>
      ({ section: 'plans', path: '2026-01-01-demo.md', committed, draft });
    const FILE: Entry['committed'] = { kind: 'file', blob: 'b'.repeat(40), size: 10 };
    const d = (state: Draft['state'], kind: Draft['kind'], fp: string | null): Draft =>
      ({ state, kind, size: 10, fp, trust: 'status' });
    const FP = 'f'.repeat(64);

    it('a deleted draft with kind absent and fp null is badge deleted, not withheld', () => {
      expect(docsH.entryView(at(FILE, d('deleted', 'absent', null)), holder(true), 'ref')).toEqual({
        listed: true, opens: 'committed', badge: 'deleted', withheld: null, offersCommitted: false, committedKind: 'file',
      });
    });

    it('a typechange to a symlink is badge typechange, not withheld; the committed bytes open', () => {
      expect(docsH.entryView(at(FILE, d('typechange', 'symlink', null)), holder(true), 'ref')).toEqual({
        listed: true, opens: 'committed', badge: 'typechange', withheld: null, offersCommitted: false, committedKind: 'file',
      });
    });

    it('a regular file with fp null is withheld too-large, and a new one is still listed', () => {
      expect(docsH.entryView(at(FILE, d('modified', 'file', null)), holder(true), 'ref')).toMatchObject({
        listed: true, opens: 'committed', badge: 'withheld', withheld: 'too-large',
      });
      expect(docsH.entryView(at(null, d('untracked', 'file', null)), holder(true), 'ref')).toEqual({
        listed: true, opens: 'none', badge: 'withheld', withheld: 'too-large', offersCommitted: false, committedKind: null,
      });
    });

    it('kind unreadable is withheld unreadable', () => {
      expect(docsH.entryView(at(FILE, d('modified', 'unreadable', null)), holder(true), 'ref')).toMatchObject({
        badge: 'withheld', withheld: 'unreadable', opens: 'committed',
      });
    });

    it.each(['symlink', 'directory', 'special', 'hardlink', 'foreign-owner', 'other-device'] as const)(
      'kind %s is withheld not-a-file', (kind) => {
        expect(docsH.entryView(at(FILE, d('modified', kind, null)), holder(true), 'ref')).toMatchObject({
          badge: 'withheld', withheld: 'not-a-file', opens: 'committed',
        });
      });

    it('the default view never overlays, even over a trusted holder at the served commit', () => {
      expect(docsH.entryView(at(FILE, d('modified', 'file', FP)), holder(true), 'default')).toEqual({
        listed: true, opens: 'committed', badge: null, withheld: null, offersCommitted: false, committedKind: 'file',
      });
      expect(docsH.entryView(at(null, d('untracked', 'file', FP)), holder(true), 'default').listed).toBe(false);
    });

    it('baseEqual false never overlays, even in a ref view', () => {
      expect(docsH.entryView(at(FILE, d('modified', 'file', FP)), holder(false), 'ref')).toEqual({
        listed: true, opens: 'committed', badge: null, withheld: null, offersCommitted: false, committedKind: 'file',
      });
    });

    it('a modified file with an fp opens the draft and offers the committed version; an exec does too', () => {
      expect(docsH.entryView(at(FILE, d('modified', 'file', FP)), holder(true), 'ref')).toEqual({
        listed: true, opens: 'draft', badge: 'modified', withheld: null, offersCommitted: true, committedKind: 'file',
      });
      const exec: Entry['committed'] = { kind: 'exec', blob: 'b'.repeat(40), size: 10 };
      expect(docsH.entryView(at(exec, d('conflicted', 'file', FP)), holder(true), 'ref')).toMatchObject({
        opens: 'draft', badge: 'conflicted', offersCommitted: true, committedKind: 'exec',
      });
    });

    it('offersCommitted holds iff the row opens the draft and the committed side is a file or exec, on every case', () => {
      const wrong = CASES.filter((c) => {
        const v = docsH.entryView(entryOf(c), factsOf(c), c.mode);
        return v.offersCommitted !== (v.opens === 'draft' && (v.committedKind === 'file' || v.committedKind === 'exec'));
      });
      expect(wrong.map(label).slice(0, 10)).toEqual([]);
      // Non-vacuous: the matrix holds rows that offer and rows that open the draft without offering.
      const views = CASES.map((c) => docsH.entryView(entryOf(c), factsOf(c), c.mode));
      expect(views.some((v) => v.offersCommitted)).toBe(true);
      expect(views.some((v) => v.opens === 'draft' && !v.offersCommitted)).toBe(true);
    });

    it('admitDraft: a trusted holder at the served commit and a draft on the entry, nothing else', () => {
      const draft = d('modified', 'file', FP);
      expect(docsH.admitDraft(at(FILE, draft), holder(true))).toBe(true);
      expect(docsH.admitDraft(at(FILE, null), holder(true)), 'no draft').toBe(false);
      expect(docsH.admitDraft(at(FILE, draft), holder(false)), 'baseEqual false').toBe(false);
      for (const s of Object.keys(NON_HOLDER) as NonHolder[]) {
        expect(docsH.admitDraft(at(FILE, draft), NON_HOLDER[s]), s).toBe(false);
      }
    });
  });

  describe('githubBlobUrl (spec 3.11; M3.11)', () => {
    type Ref = docsH.DocsTreeOk['ref'];
    const SIDE_KEYS: Record<Ref['side'], true> = { local: true, origin: true };
    const RELATION_KEYS: Record<Ref['relation'], true> = {
      equal: true, 'local-only': true, 'origin-only': true, 'local-ahead': true, 'local-behind': true,
      diverged: true, unmeasured: true,
    };
    const VIA_KEYS: Record<Ref['via'], true> = {
      'default:origin-head': true, 'default:origin-main': true, 'default:origin-master': true,
      'default:local-main': true, 'default:local-master': true, local: true, origin: true, qualified: true,
    };
    const SIDES = Object.keys(SIDE_KEYS) as Ref['side'][];
    const RELATIONS = Object.keys(RELATION_KEYS) as Ref['relation'][];
    const VIAS = Object.keys(VIA_KEYS) as Ref['via'][];
    const NAMED: docsH.DocsGithub = { state: 'named', slug: 'example-org/example-repo' };
    const NONE: docsH.DocsGithub = { state: 'none' };
    const refOf = (side: Ref['side'], relation: Ref['relation'], via: Ref['via'], name = 'ws/a b'): Ref => ({
      requested: null, served: (side === 'local' ? 'refs/heads/' : 'refs/remotes/origin/') + name, name, side,
      commit: 'c'.repeat(40), via, tried: [], relation, counterpart: null,
    });
    const TARGETS = {
      leaf: { kind: 'leaf', section: 'plans', path: 'sub dir/x y.md', uncommitted: false },
      newLeaf: { kind: 'leaf', section: 'plans', path: 'sub dir/x y.md', uncommitted: true },
      section: { kind: 'section', section: 'plans' },
      dir: { kind: 'dir', section: 'plans', path: 'sub dir' },
    } as const satisfies Record<string, docsH.GithubTarget>;
    type TargetName = keyof typeof TARGETS;
    // Hand-written; never built by the code under test. `newLeaf` never reaches a link (row 3 refuses it first).
    const URL_OF: Record<Exclude<TargetName, 'newLeaf'>, string> = {
      leaf: 'https://github.com/example-org/example-repo/blob/ws/a%20b/docs/superpowers/plans/sub%20dir/x%20y.md',
      section: 'https://github.com/example-org/example-repo/tree/ws/a%20b/docs/superpowers/plans',
      dir: 'https://github.com/example-org/example-repo/tree/ws/a%20b/docs/superpowers/plans/sub%20dir',
    };

    interface LinkCase {
      github: 'named' | 'none'; side: Ref['side']; relation: Ref['relation']; via: Ref['via']; target: TargetName;
    }
    const urlFor = (c: LinkCase): string => (c.target === 'newLeaf' ? 'unreachable' : URL_OF[c.target]);
    // THE ORACLE: spec 3.11's table, in its order, the first match winning, plus one row the table leaves out:
    // a local side reading `origin-only` cannot arrive, and the builder gives it the cautious note.
    type LinkRow = { row: string; when: (c: LinkCase) => boolean; link: (c: LinkCase) => docsH.GithubLink };
    const LINK_ROWS: readonly LinkRow[] = [
      { row: '1 no github origin', when: (c) => c.github === 'none', link: () => ({ ok: false, why: 'no-github-origin' }) },
      {
        row: '2 local-only, or a local default',
        when: (c) => c.relation === 'local-only' || c.via === 'default:local-main' || c.via === 'default:local-master',
        link: () => ({ ok: false, why: 'not-on-origin' }),
      },
      { row: '3 a new draft leaf', when: (c) => c.target === 'newLeaf', link: () => ({ ok: false, why: 'uncommitted' }) },
      {
        row: '4 origin side, or equal',
        when: (c) => c.side === 'origin' || c.relation === 'equal',
        link: (c) => ({ ok: true, url: urlFor(c), note: null }),
      },
      {
        row: '5 local side, ahead, behind, diverged or unmeasured',
        when: (c) => c.side === 'local' && ['local-ahead', 'local-behind', 'diverged', 'unmeasured'].includes(c.relation),
        link: (c) => ({ ok: true, url: urlFor(c), note: 'may-differ' }),
      },
      {
        row: '6 local side reading origin-only (off-contract)',
        when: (c) => c.side === 'local' && c.relation === 'origin-only',
        link: (c) => ({ ok: true, url: urlFor(c), note: 'may-differ' }),
      },
    ];
    const LINK_CASES: LinkCase[] = [];
    for (const github of ['named', 'none'] as const) for (const side of SIDES) for (const relation of RELATIONS) {
      for (const via of VIAS) for (const target of Object.keys(TARGETS) as TargetName[]) {
        LINK_CASES.push({ github, side, relation, via, target });
      }
    }
    const canon = (o: object): string => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
    const linkOf = (c: LinkCase): docsH.GithubLink =>
      docsH.githubBlobUrl(c.github === 'named' ? NAMED : NONE, refOf(c.side, c.relation, c.via), TARGETS[c.target]);

    it('the table covers 2 origins x 2 sides x 7 relations x 8 vias x 4 targets, and every oracle row is reached', () => {
      expect(LINK_CASES.length).toBe(2 * 2 * 7 * 8 * 4);
      const reached = new Set(LINK_CASES.map((c) => LINK_ROWS.find((r) => r.when(c))?.row ?? 'no row'));
      expect([...reached].sort()).toEqual(LINK_ROWS.map((r) => r.row).sort());
    });

    it('githubBlobUrl equals the oracle on every case', () => {
      const wrong: string[] = [];
      for (const c of LINK_CASES) {
        const row = LINK_ROWS.find((r) => r.when(c));
        const want = row === undefined ? null : row.link(c);
        const got = linkOf(c);
        if (want === null || canon(got) !== canon(want)) {
          const at = `${JSON.stringify(c)} [${row?.row ?? 'no row'}]`;
          wrong.push(`${at}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        }
      }
      expect(wrong.slice(0, 10)).toEqual([]);
      expect(wrong.length).toBe(0);
    });

    it('no GitHub origin gives no-github-origin, ahead of every other row', () => {
      expect(docsH.githubBlobUrl(NONE, refOf('local', 'local-only', 'default:local-main'), TARGETS.newLeaf))
        .toEqual({ ok: false, why: 'no-github-origin' });
    });

    it('local-only, default:local-main and default:local-master give not-on-origin, even when the relation reads equal', () => {
      const refused = { ok: false, why: 'not-on-origin' };
      expect(docsH.githubBlobUrl(NAMED, refOf('local', 'local-only', 'local'), TARGETS.leaf)).toEqual(refused);
      expect(docsH.githubBlobUrl(NAMED, refOf('local', 'equal', 'default:local-main'), TARGETS.leaf)).toEqual(refused);
      expect(docsH.githubBlobUrl(NAMED, refOf('local', 'equal', 'default:local-master'), TARGETS.section)).toEqual(refused);
    });

    it('a leaf that opens a new draft gives uncommitted; the same leaf committed gets its link', () => {
      const ref = refOf('origin', 'equal', 'origin');
      expect(docsH.githubBlobUrl(NAMED, ref, TARGETS.newLeaf)).toEqual({ ok: false, why: 'uncommitted' });
      expect(docsH.githubBlobUrl(NAMED, ref, TARGETS.leaf)).toEqual({ ok: true, url: URL_OF.leaf, note: null });
    });

    it('the origin side, or the local side equal to origin, links with no note', () => {
      for (const relation of ['origin-only', 'local-ahead', 'local-behind', 'diverged', 'unmeasured', 'equal'] as const) {
        expect(docsH.githubBlobUrl(NAMED, refOf('origin', relation, 'default:origin-head'), TARGETS.dir), relation)
          .toEqual({ ok: true, url: URL_OF.dir, note: null });
      }
      expect(docsH.githubBlobUrl(NAMED, refOf('local', 'equal', 'local'), TARGETS.leaf))
        .toEqual({ ok: true, url: URL_OF.leaf, note: null });
    });

    it('the local side ahead, behind, diverged or unmeasured links with may-differ', () => {
      for (const relation of ['local-ahead', 'local-behind', 'diverged', 'unmeasured'] as const) {
        expect(docsH.githubBlobUrl(NAMED, refOf('local', relation, 'qualified'), TARGETS.section), relation)
          .toEqual({ ok: true, url: URL_OF.section, note: 'may-differ' });
      }
    });

    it('blob for a leaf, tree for a section or directory; each segment encoded, so a branch keeps its slash', () => {
      const ok = refOf('origin', 'equal', 'default:origin-main', 'main');
      expect(docsH.githubBlobUrl(NAMED, ok, { kind: 'leaf', section: 'specs', path: '2026-01-01-demo.md', uncommitted: false }))
        .toEqual({
          ok: true, note: null,
          url: 'https://github.com/example-org/example-repo/blob/main/docs/superpowers/specs/2026-01-01-demo.md',
        });
      expect(docsH.githubBlobUrl(NAMED, ok, { kind: 'section', section: 'product-design' }))
        .toEqual({ ok: true, url: 'https://github.com/example-org/example-repo/tree/main/docs/product-design', note: null });
      expect(docsH.githubBlobUrl(NAMED, ok, { kind: 'dir', section: 'conventions', path: 'a/b' }))
        .toEqual({ ok: true, url: 'https://github.com/example-org/example-repo/tree/main/docs/conventions/a/b', note: null });
      // `#`, `?`, `%` and a non-ASCII letter are each encoded inside their segment; `/` between segments is kept.
      const odd = docsH.githubBlobUrl(NAMED, refOf('origin', 'equal', 'origin', 'ws/a#1'),
        { kind: 'leaf', section: 'specs', path: 'résumé/100%?.md', uncommitted: false });
      expect(odd).toEqual({
        ok: true, note: null,
        url: 'https://github.com/example-org/example-repo/blob/ws/a%231/docs/superpowers/specs/r%C3%A9sum%C3%A9/100%25%3F.md',
      });
    });

    it('the link names the branch, never the commit', () => {
      const link = docsH.githubBlobUrl(NAMED, refOf('origin', 'equal', 'origin'), TARGETS.leaf);
      expect(link.ok && link.url.includes('c'.repeat(40))).toBe(false);
      expect(link).toMatchObject({ ok: true });
    });
  });
});
