// Overlord W1, journal kernel plan Task 4: the chained-journal kernel stands alone. Its cases run against a SECOND format (a
// fixture with its own refusal class), so a kernel that leaned on the delegation journal would be seen; the same cases, taking
// the kernel as a module, are what the mutant sets in test/sim/chainedJournalSets.ts run against a mutated copy. Task 1's
// delegation cases import the delegation journal, which loads the real kernel, so they never see a mutant; these do.
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as kernel from '../src/chainedJournal.js';
import type { ChainedJournalRecord } from '../src/chainedJournal.js';
import { DelegationJournalError } from '../src/coord/delegation-journal.js';
import type { DelegationJournalEntryV1, DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import { chainedKernelSuite, ProbeJournalError, reaches } from './sim/chainedJournalSets.js';
import { walkSrc } from './rings/walkSrc.js';
import { parsedFile } from './scan/symbols.js';
import { ts } from './scan/parse.js';

const KERNEL = 'server/src/chainedJournal.ts';
const CANONICAL = 'server/src/canonical.ts';
const LOG_FIRST_KERNEL = 'server/src/journalKernel.ts';

/** A file's code with its comments left out: every token, in order (a string or template's text stays; a comment never is one). */
function codeWithoutComments(file: string): string {
  return tokensOf(file, parsedFile(file).text);
}

/** The comment-free view of a source text: its tokens, in order, joined by one space (so `Date.now` reads `Date . now`). */
function tokensOf(file: string, text: string): string {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const parts: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isJSDoc(n)) return;
    const kids = n.getChildren(sf);
    if (kids.length === 0) { parts.push(n.getText(sf)); return; }
    for (const k of kids) walk(k);
  };
  walk(sf);
  return parts.join(' ');
}

describe('the kernel, over a second format', () => {
  for (const [name, run] of Object.entries(chainedKernelSuite(kernel))) it(name, run);

  it('no code of the kernel is thrown as the delegation journal\'s class', () => {
    for (const [code, reach] of Object.entries(reaches(kernel))) {
      let err: unknown;
      try { err = reach(); } catch (e) { err = e; }
      expect(err, code).toBeInstanceOf(ProbeJournalError);
      expect(err, code).not.toBeInstanceOf(DelegationJournalError);
    }
  });
});

describe('structure: the kernel stands alone', () => {
  it('chainedJournal.ts imports exactly ./canonical.js, and canonical.ts exactly node:crypto', () => {
    expect(parsedFile(KERNEL).imports.map((i) => i.specifier)).toEqual(['./canonical.js']);
    expect(parsedFile(CANONICAL).imports.map((i) => i.specifier)).toEqual(['node:crypto']);
  });

  it('neither file\'s code spells delegation, in any case (comments excepted)', () => {
    for (const file of [KERNEL, CANONICAL]) {
      expect(codeWithoutComments(file).length, file).toBeGreaterThan(1000);
      expect(codeWithoutComments(file).toLowerCase(), file).not.toContain('delegation');
    }
  });

  it('CONTROL: the comment-free view drops comments and keeps code', () => {
    // The kernel's header comments say "delegation"; its code does not. A view that kept comments would fail the case above.
    expect(parsedFile(KERNEL).text.toLowerCase()).toContain('delegation');
    expect(codeWithoutComments(KERNEL)).toContain('rfc8785Json');
  });

  it('canon is declared in canonical.ts and nowhere else under server/src', () => {
    const files = walkSrc({ roots: ['server/src'], min: 100 });
    expect(files).toContain(CANONICAL);
    const declaring = files.filter((f) => {
      const p = parsedFile(f);
      return p.symbols.some((s) => s.name === 'canon') || p.bindings.some((b) => b.name === 'canon');
    });
    expect(declaring).toEqual([CANONICAL]);
    expect(parsedFile(CANONICAL).symbols.filter((s) => s.name === 'canon' && (s.kind === 'function' || s.kind === 'variable-function'))).toHaveLength(1);
  });

  it('journalKernel.ts still imports nothing, and neither new file imports it or is imported by it', () => {
    expect(parsedFile(LOG_FIRST_KERNEL).imports).toEqual([]);
    for (const file of [KERNEL, CANONICAL]) {
      expect(parsedFile(file).imports.some((i) => /journalKernel/.test(i.specifier)), file).toBe(false);
    }
  });
});

// The clock, randomness and crypto-handle list the delegation files' scans use (`delegation-recovery.test.ts`'s "no randomness and
// no clock anywhere in the module" row, and `delegation-model.test.ts`'s "calls no source of randomness or time"): the codec, the
// chain and the canonical writer were under those scans before they moved here, so the scans move with them. Over the comment-free
// token view, so a pattern allows the space the view puts between tokens.
const CLOCK_OR_RANDOM: ReadonlyArray<readonly [string, RegExp]> = [
  ['randomUUID', /\brandomUUID\b/],
  ['randomBytes', /\brandomBytes\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
  ['getRandomValues', /\bgetRandomValues\b/],
  ['webcrypto', /\bwebcrypto\b/],
  ['globalThis.crypto', /\bglobalThis\s*\.\s*crypto\b/],
  ['a crypto handle', /\bcrypto\s*\./],
];
/** The journal's own list adds any `new Date(` and `node:crypto`; the model's adds the argument-less `new Date()` only, because the
 *  canonical instant check formats the instant it was given (`new Date(ms)`), and hashing is `canonical.ts`'s one import. */
const KERNEL_ONLY: ReadonlyArray<readonly [string, RegExp]> = [['new Date(', /\bnew\s+Date\s*\(/], ['node:crypto', /node:crypto/]];
const CANONICAL_ONLY: ReadonlyArray<readonly [string, RegExp]> = [['new Date()', /\bnew\s+Date\s*\(\s*\)/]];

/** The names of the patterns a comment-free token view matches. Pure. */
const clockOrRandomHits = (tokens: string, extra: ReadonlyArray<readonly [string, RegExp]>): string[] =>
  [...CLOCK_OR_RANDOM, ...extra].filter(([, re]) => re.test(tokens)).map(([name]) => name);

describe('purity: no clock, no randomness and no crypto handle in the kernel files', () => {
  it('chainedJournal.ts names no clock, no randomness, no Web Crypto, no node:crypto and no new Date(', () => {
    expect(clockOrRandomHits(codeWithoutComments(KERNEL), KERNEL_ONLY)).toEqual([]);
  });

  it('canonical.ts names no clock and no randomness, and takes only createHash from node:crypto', () => {
    expect(clockOrRandomHits(codeWithoutComments(CANONICAL), CANONICAL_ONLY)).toEqual([]);
    expect(parsedFile(CANONICAL).imports.map((i) => [i.specifier, [...i.names].sort()])).toEqual([['node:crypto', ['createHash']]]);
  });

  it('CONTROL: each pattern is seen in the token view, and a comment or a date given an instant is not', () => {
    const planted = tokensOf('planted.ts', [
      "import { createHash, randomBytes } from 'node:crypto';",
      '// Date.now() in a comment is not code',
      'const a = Date.now() + Math.random() + performance.now();',
      'const b = randomUUID(); const c = globalThis.crypto.getRandomValues(new Uint8Array(1)); const d = webcrypto;',
      'const e = new Date(); const f = new Date(5);',
    ].join('\n'));
    expect(clockOrRandomHits(planted, [...KERNEL_ONLY, ...CANONICAL_ONLY]).sort()).toEqual([
      'Date.now', 'Math.random', 'a crypto handle', 'getRandomValues', 'globalThis.crypto', 'new Date(', 'new Date()', 'node:crypto',
      'performance.now', 'randomBytes', 'randomUUID', 'webcrypto',
    ].sort());
    expect(clockOrRandomHits(tokensOf('quiet.ts', '// Date.now() and randomBytes, in a comment\nconst t = new Date(5);'), CANONICAL_ONLY)).toEqual([]);
    expect(clockOrRandomHits(tokensOf('quiet.ts', "import { rfc8785Json } from './canonical.js';"), KERNEL_ONLY)).toEqual([]);
  });
});

describe('one record type', () => {
  it('DelegationJournalRecordV1 is ChainedJournalRecord<DelegationJournalEntryV1>', () => {
    expectTypeOf<DelegationJournalRecordV1>().toEqualTypeOf<ChainedJournalRecord<DelegationJournalEntryV1>>();
  });
});
