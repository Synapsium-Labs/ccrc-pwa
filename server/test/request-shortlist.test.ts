// The code shortlist (Overlord W2 request record plan, Task B1; §7, Table 7, ruling F5). The cases live in `shortlistCases.ts`,
// shared with `sim/requestSets.ts`, so the mutation floors run them against each textual mutant.
import { describe, expect, it } from 'vitest';
import * as shortlist from '../src/coord/requestShortlist.js';
import { SHORTLIST_MAX } from '../../shared/overlordRequests.js';
import { OVERLORD_HISTORY_TOUCHED_PATHS_MAX } from '../../shared/overlordHistory.js';
import { codeShortlistCases, touchedAnswerCases, touchedReadCases, touchedRequestCases } from './shortlistCases.js';

const run = (cases: Record<string, () => void | Promise<void>>): void => { for (const [name, c] of Object.entries(cases)) it(name, c); };

describe('codeShortlist: Table 7 and the five properties', () => { run(codeShortlistCases(shortlist)); });
describe('touchedRequestOf: the one history read an open makes', () => { run(touchedRequestCases(shortlist)); });
describe('touchedAnswerOf: three answers never folded', () => { run(touchedAnswerCases(shortlist)); });
describe('touchedReadOf: rows to programmes', () => { run(touchedReadCases(shortlist)); });

describe('the bounds are declared once', () => {
  it('the cut is L0 SHORTLIST_MAX (6) and the paths read are the history op bound (8)', () => {
    expect([SHORTLIST_MAX, shortlist.SHORTLIST_TOUCHED_PATHS, OVERLORD_HISTORY_TOUCHED_PATHS_MAX]).toEqual([6, 8, 8]);
  });

  it('isShortlistKebab admits its declared words and nothing else', () => {
    for (const w of [...shortlist.TOUCHED_UNMEASURED_WHYS, ...shortlist.TOUCHED_PARTIAL_WHYS, ...shortlist.SHORTLIST_READ_WHYS,
      ...shortlist.SHORTLIST_BASES, ...shortlist.SHORTLIST_READ_KINDS]) expect(shortlist.isShortlistKebab(w), w).toBe(true);
    for (const w of ['nothing-touched', 'empty', 'bad-verb']) expect(shortlist.isShortlistKebab(w), w).toBe(false);
  });
});
