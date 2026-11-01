// The command redactor (D-5299, spec 2026-10-17 §6.7): token-shaped strings are masked before a child's input is
// stored, mailed or shown. Pure. One row per shape in `fixtures/approvals/redact-corpus.json`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_REDACT_RULES, redactDocsText } from '../../shared/docs.js';
import { redact, redactCount } from '../../shared/redact.js';
import { credentialMaskSource } from '../../shared/api.js';
import {
  APPROVAL_DIGEST_PREVIEW_CHARS, APPROVAL_INPUT_MAX_BYTES, REDACTED, capUtf8, redactCommand, redactedPreview, redactedStored,
} from '../src/coord/redact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS: { why: string; input: string; output: string }[] =
  JSON.parse(readFileSync(path.join(here, 'fixtures/approvals/redact-corpus.json'), 'utf8'));

describe('redactCommand: the corpus', () => {
  for (const [i, r] of CORPUS.entries()) {
    it(`#${i}: ${r.why}`, () => { expect(redactCommand(r.input)).toBe(r.output); });
  }

  it('is idempotent on every row', () => {
    for (const r of CORPUS) expect(redactCommand(redactCommand(r.input))).toBe(r.output);
  });

  it('the mask is one fixed word', () => { expect(REDACTED).toBe('[REDACTED]'); });
});

describe('bounded cost (round 9)', () => {
  it('a 64 KB adversarial line is redacted in under 250 ms', () => {
    const N = 65536;
    for (const v of [' --' + 'a-'.repeat(N / 2), ' x' + 'a-'.repeat(N / 2), ' -' + 'a'.repeat(N), ' --password ' + '"a"'.repeat(N / 3),
      ' -x ' + 'a:'.repeat(N / 2), ' --cert ' + 'a:'.repeat(N / 2), ' hf_' + 'a'.repeat(N), 'http' + '+a'.repeat(N / 2)]) {
      const t = performance.now();
      redactCommand(v);
      expect(performance.now() - t).toBeLessThan(250);
    }
  });
});

describe('the length caps', () => {
  it('the stored form is redacted, then capped at 16 KB on a UTF-8 boundary', () => {
    expect(APPROVAL_INPUT_MAX_BYTES).toBe(16 * 1024);
    const big = `GH_TOKEN=x ${'é'.repeat(20_000)}`;
    const stored = redactedStored(big);
    expect(stored.startsWith('GH_TOKEN=[REDACTED] ')).toBe(true);
    expect(Buffer.byteLength(stored, 'utf8')).toBeLessThanOrEqual(APPROVAL_INPUT_MAX_BYTES);
    expect(stored).not.toContain('�');
    expect(redactedStored('ls')).toBe('ls');
  });

  it('the digest line shows the first 160 redacted characters', () => {
    expect(APPROVAL_DIGEST_PREVIEW_CHARS).toBe(160);
    const p = redactedPreview(`Bearer abcdef ${'x'.repeat(400)}`);
    expect(p.startsWith('Bearer [REDACTED] ')).toBe(true);
    expect([...p].length).toBeLessThanOrEqual(APPROVAL_DIGEST_PREVIEW_CHARS);
  });

  it('capUtf8 never splits a character and keeps short text whole', () => {
    expect(capUtf8('abc', 10)).toBe('abc');
    expect(capUtf8('aé', 2)).toBe('a');
    expect(capUtf8('😀😀', 5)).toBe('😀');
  });
});

// D-5867 (Task C1l, ARCH-66 (#801)), characterization: written green on the two old tables, before either moved into
// `shared/redact.mjs`. The two callers' outputs are pinned byte for byte, so a rule moved into the wrong profile shows
// as a changed row. The expected values of the first block come from the corpus rows, not from the function.
describe('the caller-facing functions over the corpus (D-5867)', () => {
  for (const [i, r] of CORPUS.entries()) {
    it(`#${i}: redactedStored is the redacted row, uncapped`, () => { expect(redactedStored(r.input)).toBe(r.output); });
    it(`#${i}: redactedPreview is the redacted row's first 160 characters`, () => {
      expect(redactedPreview(r.input)).toBe([...r.output].slice(0, APPROVAL_DIGEST_PREVIEW_CHARS).join(''));
    });
  }
});

const PROFILES: {
  docs: [why: string, input: string, output: string][];
  cross: [input: string, egress: string, docs: string][];
} = JSON.parse(readFileSync(path.join(here, 'fixtures/redact/profiles.json'), 'utf8'));

describe('the docs redactor over its own corpus (D-5867)', () => {
  it('has one row per DOCS_REDACT_RULES rule at least, and the rules are the four of docs W1 and the Linear key (#1444)', () => {
    expect(DOCS_REDACT_RULES.length).toBe(5);
    expect(PROFILES.docs.length).toBeGreaterThanOrEqual(DOCS_REDACT_RULES.length);
  });
  for (const [why, input, output] of PROFILES.docs) {
    it(`${why}`, () => {
      expect(redactDocsText(input)).toBe(output);
      expect(redactDocsText(output)).toBe(output);
    });
  }
});

describe('a shape both profiles touch is redacted by each profile in its own way (D-5867)', () => {
  for (const [input, egress, docs] of PROFILES.cross) {
    it(JSON.stringify(input), () => {
      expect(redactCommand(input)).toBe(egress);
      expect(redactDocsText(input)).toBe(docs);
    });
  }
});

// The Linear central key (#1444), row 19: `linear-egress` is the profile for prose a session sends to Linear (a title,
// a description, a comment body, a search term). It masks the credential shapes and leaves alone what fleet tickets
// cite: a commit SHA, a commit URL, a UUID, a dated spec path, a branch of that shape, and prose that names a secret
// variable without a value, which the egress profile's `token-segments` and flag rules would rewrite. Token-shaped
// values are built at run time, so this public file carries no contiguous token literal.
describe('the linear-egress profile: masks credential shapes, leaves prose alone (#1444, row 19)', () => {
  const SHAPES = { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') };
  const SHA = '3f2a9c4b1d0e8f7a6b5c4d3e2f1a0b9c8d7e6f5a';
  const KEY = ['lin', 'api', 'fixtureK3y0001'].join('_');
  const SK = ['sk', 'fixtureAbcd1234efgh'].join('-');
  const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJsYW5lLWEifQ', 'c2lnbmF0dXJlLWZpeHR1cmU'].join('.');
  const PASS: readonly string[] = [
    `fixed in ${SHA}`,
    `see https://github.com/org-a/repo-a/commit/${SHA} for the change`,
    'the run 0f8b2c4e-9a1d-4e3b-8c7f-2a6d5e4b3c1a stalled',
    'the design is docs/superpowers/specs/2026-10-31-linear-central-key-design.md, section 13',
    'branch feat/2026-10-31-linear-central-key-design is open',
    'rotate GH_TOKEN and LINEAR_API_KEY; the aws_secret_access_key setting stays in the profile',
    'run it with -p 8080 --token-file x and --password-stdin',
    'a long word: project-a-quiet-basin-with-a-long-name-and-more-words',
  ];
  const MASK: readonly (readonly [input: string, output: string, masked: number])[] = [
    [`the key ${KEY} leaked`, 'the key [REDACTED] leaked', 1],
    [`token ${JWT} in the log`, 'token [REDACTED] in the log', 1],
    [`use ${SK} here`, 'use [REDACTED] here', 1],
    ['clone https://user-a:pw@example.invalid/x', 'clone https://[REDACTED]@example.invalid/x', 1],
    ['Authorization: Basic Zm9vOmJhcg==', 'Authorization: [REDACTED]', 1],
    ['TOKEN=abc123 make build', 'TOKEN=[REDACTED] make build', 1],
    [`GH_TOKEN=abc and ${KEY} and Bearer xyz`, 'GH_TOKEN=[REDACTED] and [REDACTED] and Bearer [REDACTED]', 3],
  ];

  for (const s of PASS) {
    it(`passes ${JSON.stringify(s)} byte for byte, masked 0`, () => {
      expect(redactCount('linear-egress', s, SHAPES)).toEqual({ text: s, masked: 0 });
    });
  }
  for (const [input, output, masked] of MASK) {
    it(`masks ${JSON.stringify(output)}, counting ${masked}`, () => {
      expect(redactCount('linear-egress', input, SHAPES)).toEqual({ text: output, masked });
      expect(redact('linear-egress', input, SHAPES)).toBe(output);
    });
  }
  it('a masked text redacts to itself and counts nothing: a span matched but not changed is not a mask', () => {
    for (const [, output] of MASK) expect(redactCount('linear-egress', output, SHAPES), output).toEqual({ text: output, masked: 0 });
  });
  it('the egress profile is the one that rewrites the prose rows (why linear-egress exists)', () => {
    expect(PASS.filter((s) => redact('egress', s, SHAPES) !== s).length).toBeGreaterThanOrEqual(4);
  });
});
