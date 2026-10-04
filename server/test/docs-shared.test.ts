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
