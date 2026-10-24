// The command redactor (D-5299, spec 2026-10-17 §6.7): token-shaped strings are masked before a child's input is
// stored, mailed or shown. Pure. One row per shape in `fixtures/approvals/redact-corpus.json`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_REDACT_RULES, redactDocsText } from '../../shared/docs.js';
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
  it('has one row per DOCS_REDACT_RULES rule at least, and the rules are the four of docs W1', () => {
    expect(DOCS_REDACT_RULES.length).toBe(4);
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
