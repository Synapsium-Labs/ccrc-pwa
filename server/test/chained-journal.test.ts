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
  const parsed = parsedFile(file);
  const sf = ts.createSourceFile(file, parsed.text, ts.ScriptTarget.Latest, true);
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

describe('one record type', () => {
  it('DelegationJournalRecordV1 is ChainedJournalRecord<DelegationJournalEntryV1>', () => {
    expectTypeOf<DelegationJournalRecordV1>().toEqualTypeOf<ChainedJournalRecord<DelegationJournalEntryV1>>();
  });
});
