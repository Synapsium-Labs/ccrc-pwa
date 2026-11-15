// Overlord W1, journal kernel plan Task 4: the kinds census. Every chained journal uses ONE envelope and ONE pair of preimages,
// with no domain tag; a record's kind lives in `entry.kind`. So a record of one journal verifies in another exactly when the other's
// grammar accepts its entry. This census holds that from happening: the registered formats' `kinds` are pairwise disjoint, each
// grammar refuses every other format's kinds (as its own refusal class), and every format declared under server/src is registered.
import { describe, expect, it } from 'vitest';
import type { ChainedJournalFormat, ChainedRefusal } from '../src/chainedJournal.js';
import { DELEGATION_JOURNAL_FORMAT } from '../src/coord/delegation-journal.js';
import { PROBE_JOURNAL_FORMAT } from './sim/chainedJournalSets.js';
import { walkSrc } from './rings/walkSrc.js';
import { parsedFile } from './scan/symbols.js';
import { parseSource, type ParsedFile } from './scan/parse.js';

interface Registered {
  format: ChainedJournalFormat<unknown, ChainedRefusal>;
  /** `file#binding` of a production format; null for a fixture, which is not under server/src. */
  binding: string | null;
}

/** Each chained-journal format, by name. A later journal's piece adds its own row here, with its binding. */
const FORMATS: Record<string, Registered> = {
  delegation: { format: DELEGATION_JOURNAL_FORMAT, binding: 'server/src/coord/delegation-journal.ts#DELEGATION_JOURNAL_FORMAT' },
  probe: { format: PROBE_JOURNAL_FORMAT, binding: null },
};

const DECLARES_FORMAT = /:\s*ChainedJournalFormat\b/;

/** Every `file#name` of a binding in the given files whose declared type names `ChainedJournalFormat`. A binding has no type field,
 *  so this reads the declaration's own text, from the binding's start to where its initialiser begins. Pure over parsed files. */
function declaredFormats(files: ReadonlyArray<{ file: string; parsed: ParsedFile }>): string[] {
  const out: string[] = [];
  for (const { file, parsed } of files) {
    for (const b of parsed.bindings) {
      if (DECLARES_FORMAT.test(parsed.text.slice(b.start, b.initStart))) out.push(`${file}#${b.name}`);
    }
  }
  return out.sort();
}

/** The discovered bindings no registry row names. */
const unregistered = (declared: readonly string[], registry: Record<string, Registered>): string[] => {
  const known = new Set(Object.values(registry).map((r) => r.binding));
  return declared.filter((d) => !known.has(d));
};

const refusalClassOf = (f: ChainedJournalFormat<unknown, ChainedRefusal>): Function =>
  f.fail('bad-field', 'probe').constructor;

describe('the kinds census', () => {
  const names = Object.keys(FORMATS);

  it('registers the delegation format and the fixture format', () => {
    expect(names.sort()).toEqual(['delegation', 'probe']);
    for (const n of names) expect(FORMATS[n]!.format.kinds.length, n).toBeGreaterThan(0);
  });

  it('the kinds tables are pairwise disjoint', () => {
    for (const a of names) for (const b of names) {
      if (a >= b) continue;
      const shared = FORMATS[a]!.format.kinds.filter((k) => FORMATS[b]!.format.kinds.includes(k));
      expect(shared, `${a} and ${b}`).toEqual([]);
    }
  });

  it('every format refuses every other format\'s kinds, as its own refusal class', () => {
    let pairs = 0;
    for (const a of names) for (const b of names) {
      if (a === b) continue;
      const A = FORMATS[a]!.format;
      const own = refusalClassOf(A);
      for (const k of FORMATS[b]!.format.kinds) {
        let err: unknown;
        try { A.entry({ kind: k }); } catch (e) { err = e; }
        expect(err, `${a} accepted ${b}'s kind ${k}`).toBeInstanceOf(own);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(names.length * (names.length - 1));
  });

  it('the refusal classes of two formats are not the same class', () => {
    const classes = names.map((n) => refusalClassOf(FORMATS[n]!.format));
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe('discovery: every format declared under server/src is registered, and every registered production format is declared', () => {
  const real = walkSrc({ roots: ['server/src'], min: 100 }).map((file) => ({ file, parsed: parsedFile(file) }));
  const declared = declaredFormats(real);

  it('every binding declared as a ChainedJournalFormat is registered', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(unregistered(declared, FORMATS)).toEqual([]);
  });

  it('every registered production format is such a binding', () => {
    const production = Object.values(FORMATS).map((r) => r.binding).filter((b): b is string => b !== null);
    expect(production.filter((b) => !declared.includes(b))).toEqual([]);
  });

  it('FIXTURE: a planted binding is seen, and reported when it is not registered', () => {
    const planted = parseSource([
      "import type { ChainedJournalFormat } from '../chainedJournal.js';",
      '// const NOT_CODE: ChainedJournalFormat<A, B> = x;',
      'export const NEXT_JOURNAL_FORMAT: ChainedJournalFormat<Entry, Refusal> = { kinds: [] } as never;',
      'export const OTHER: Readonly<{ a: 1 }> = { a: 1 };',
    ].join('\n'), 'server/src/next/next-journal.ts');
    const seen = declaredFormats([{ file: 'server/src/next/next-journal.ts', parsed: planted }]);
    expect(seen).toEqual(['server/src/next/next-journal.ts#NEXT_JOURNAL_FORMAT']);
    expect(unregistered(seen, FORMATS)).toEqual(seen);
    const withRow = { ...FORMATS, next: { format: PROBE_JOURNAL_FORMAT, binding: seen[0]! } };
    expect(unregistered(seen, withRow)).toEqual([]);
  });
});
