// Overlord W1, authority journal A0 (review 2191 F3): who may reach the shared journal-file adapters. The byte-level port
// (`server/src/appendOnlyFile.ts#appendOnlyFileAt`) is bound by the landing journal and the chained-journal file adapter
// only; the port's one cut is reached only through the adapter's `cutAside`; and no chained-journal binding names the
// landing journal's file, so `landing.log` never reaches a cut. A later journal that binds the adapter adds its file to
// `CHAINED_BINDERS` in the pull request that creates it. Read through `parsedFile` (the ARCH-06 ratchet), and the census is
// a pure function, so a planted file proves each rule fires.
import { describe, expect, it } from 'vitest';
import { walkSrc } from './rings/walkSrc.js';
import { parsedFile } from './scan/symbols.js';
import { parseSource, type ParsedFile } from './scan/parse.js';

/** The files that bind the byte-level port: the landing journal's binding and the chained-journal file adapter. */
const PORT_BINDERS = ['server/src/chainedJournalFile.ts', 'server/src/coord/landingJournal.ts'];
/** The files that bind the chained-journal file adapter: authority journal A's writer, and the private store's open, which
 *  binds the privacy journal (private store A). */
const CHAINED_BINDERS: string[] = [
  'server/src/coord/overlordAuthorityJournal.ts',
  'server/src/operatorModel/store.ts',
];
/** Every `.cutAside(` call: the adapter's own call of the port's cut, and each journal's torn-tail heal through the adapter
 *  (the Overlord authority journal's `healTornTail`, and the privacy journal's heal at the store's open, private store A). */
const CUT_CALLS = [
  'server/src/chainedJournalFile.ts: file.cutAside',
  'server/src/coord/overlordAuthorityJournal.ts: this.file.cutAside',
  'server/src/operatorModel/store.ts: file.cutAside',
];
/** The landing journal's file, by its constant and by its name. */
const LANDING_FILE = /\bLANDING_JOURNAL_BASENAME\b|landing\.log/;

interface Census { portBinders: string[]; chainedBinders: string[]; cutCalls: string[]; landingInChained: string[] }

/** Pure over parsed files: who calls the port, the adapter and a cut, and every chained-journal call naming landing's file. */
function census(files: ReadonlyArray<{ file: string; parsed: ParsedFile }>): Census {
  const out: Census = { portBinders: [], chainedBinders: [], cutCalls: [], landingInChained: [] };
  for (const { file, parsed } of files) {
    for (const c of parsed.calls) {
      if (c.name === 'appendOnlyFileAt') out.portBinders.push(file);
      if (c.name === 'chainedJournalFileAt') {
        out.chainedBinders.push(file);
        if (c.args.some((a) => LANDING_FILE.test(a.text))) out.landingInChained.push(`${file} line ${c.line}`);
      }
      if (c.name === 'cutAside' && c.callee.includes('.')) out.cutCalls.push(`${file}: ${c.callee}`);
    }
  }
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
  return {
    portBinders: uniq(out.portBinders), chainedBinders: uniq(out.chainedBinders), cutCalls: uniq(out.cutCalls),
    landingInChained: uniq(out.landingInChained),
  };
}

describe('the journal-file adapters\' callers (review 2191 F3)', () => {
  const real = census(walkSrc({ roots: ['server/src'], min: 100 }).map((file) => ({ file, parsed: parsedFile(file) })));

  it('only the landing binding and the chained-journal adapter bind the byte-level port', () => {
    expect(real.portBinders).toEqual(PORT_BINDERS);
  });

  it('the chained-journal adapter\'s binders are exactly the listed journals', () => {
    expect(real.chainedBinders).toEqual(CHAINED_BINDERS);
  });

  it('the port\'s one cut is called only by the adapter', () => {
    expect(real.cutCalls).toEqual(CUT_CALLS);
  });

  it('no chained-journal binding names the landing journal\'s file', () => {
    expect(real.landingInChained).toEqual([]);
  });

  it('FIXTURE: a planted second port binder, a cut call outside the adapter and a chained binding of landing.log are each reported', () => {
    const planted = parseSource([
      "import { appendOnlyFileAt } from '../appendOnlyFile.js';",
      "import { chainedJournalFileAt } from '../chainedJournalFile.js';",
      "import { LANDING_JOURNAL_BASENAME } from './landingJournal.js';",
      "const raw = appendOnlyFileAt(dir, 'other.log');",
      'export const cut = (s: unknown) => raw.cutAside(s, { offset: 0, asideDir: \'x\', asideName: \'y\' });',
      'export const j = chainedJournalFileAt(FMT, dir, LANDING_JOURNAL_BASENAME);',
      "export const k = chainedJournalFileAt(FMT, dir, 'landing.log');",
    ].join('\n'), 'server/src/coord/stray.ts');
    const seen = census([{ file: 'server/src/coord/stray.ts', parsed: planted }]);
    expect(seen).toEqual({
      portBinders: ['server/src/coord/stray.ts'],
      chainedBinders: ['server/src/coord/stray.ts'],
      cutCalls: ['server/src/coord/stray.ts: raw.cutAside'],
      landingInChained: ['server/src/coord/stray.ts line 6', 'server/src/coord/stray.ts line 7'],
    });
  });
});
