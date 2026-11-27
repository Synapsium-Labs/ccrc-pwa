// The place hidden's oracle and mutant set (Overlord W1, plan `w1-renewal-readings.md`, PR G: Task 10, question 7, slug
// place-hidden-is-a-mark). `placeHiddenOf`'s cases are written ONCE here, as suite cases over the readings module:
// `continuity-renewal-readings-place.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs them against
// each textual mutant (D-8217's every-run floors). The expected answers are written out, never read from the code they judge.
// G1 is the plan's Step 5 mutant (an unread mark read as 0 hidden); G2 is the builder's own, for the never-written state.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { OPERATOR_MARK_MS, OVERLORD_PLACE_MARK } from '../../../shared/continuity.js';
import { OVERLORD_OPERATOR_MARK } from '../../../shared/operatorMessages.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const READINGS = path.join(ROOT, 'server/src/continuity/renewalReadings.ts');

type RenewalReadingsModule = typeof import('../../src/continuity/renewalReadings.js');

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const MIN = 60_000;
const measured = (value: number) => ({ kind: 'measured' as const, value });
const q = (ms: number) => ({ ms, mono: 1_000 + ms, proc: 'p1' });
const mark = (programme: string, quietMs: number | null, at = NOW - 60 * MIN) =>
  ({ programme, at, quiet: quietMs === null ? null : q(quietMs) });

// ------------------------------------------------------------------------------------------------------------- placeHiddenOf

export function placeHiddenCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'marks that could not be read: unmeasured, never 0 hidden and never long hidden (G1, G7)': () => {
      const r = m.placeHiddenOf('unmeasured', NOW);
      expect(r.kind).toBe('unmeasured');
      expect(r).toEqual({ kind: 'unmeasured', why: 'place-mark: the marks could not be read' });
    },
    'a mark never written reads `OPERATOR_MARK_MS`, as a programme with no mark does: never visible just now (G2)': () => {
      expect(m.placeHiddenOf([], NOW)).toEqual(measured(OPERATOR_MARK_MS));
    },
    'a fresh mark the lane has not aged yet reads 0: visible just now': () => {
      expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, null, NOW - 1)], NOW)).toEqual(measured(0));
    },
    'a mark\'s observed quiet is the reading, at most `OPERATOR_MARK_MS` (G5)': () => {
      expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, 4 * MIN)], NOW)).toEqual(measured(4 * MIN));
      expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, 6 * MIN)], NOW)).toEqual(measured(6 * MIN));
      expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, OPERATOR_MARK_MS + 30_000)], NOW)).toEqual(measured(OPERATOR_MARK_MS));
    },
    'only the place mark is the place: the operator\'s `@overlord` mark and a programme\'s are not (G4)': () => {
      expect(m.placeHiddenOf([mark(OVERLORD_OPERATOR_MARK, 0), mark('prog-a', 0)], NOW)).toEqual(measured(OPERATOR_MARK_MS));
      expect(m.placeHiddenOf([mark(OVERLORD_OPERATOR_MARK, 0), mark(OVERLORD_PLACE_MARK, 7 * MIN), mark('prog-a', 0)], NOW))
        .toEqual(measured(7 * MIN));
    },
    'a mark dated after the pass is never trusted as visible: unmeasured, whatever its quiet (G3, G6)': () => {
      for (const quiet of [null, 0, 2 * MIN, 9 * MIN]) {
        expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, quiet, NOW + 1)], NOW))
          .toEqual({ kind: 'unmeasured', why: 'place-mark: dated after this pass' });
      }
      expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, null, NOW + 3_600_000)], NOW)).toMatchObject({ kind: 'unmeasured' });
      // A mark dated at the pass itself is the pass's own instant, and is read.
      expect(m.placeHiddenOf([mark(OVERLORD_PLACE_MARK, null, NOW)], NOW)).toEqual(measured(0));
    },
  };
}

const PLACE_HIDDEN_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: READINGS,
  mutants: [
    { id: 'G1 an unread mark read as 0 hidden (the plan\'s)', old: "if (marks === 'unmeasured') return unmeasured('place-mark: the marks could not be read');",
      new: "if (marks === 'unmeasured') return { kind: 'measured', value: 0 };" },
    { id: 'G2 a mark never written read as visible just now', old: 'if (m === undefined) return { kind: \'measured\', value: OPERATOR_MARK_MS };',
      new: 'if (m === undefined) return { kind: \'measured\', value: 0 };' },
    { id: 'G3 a mark from the future trusted', old: "if (m.at > nowMs) return unmeasured('place-mark: dated after this pass');\n", new: '' },
    { id: 'G4 any mark read as the place', old: 'marks.find((x) => x.programme === OVERLORD_PLACE_MARK)', new: 'marks.find(() => true)' },
    { id: 'G5 the quiet uncapped', old: 'Math.min(OPERATOR_MARK_MS, markQuietMs(m))', new: 'markQuietMs(m)' },
    { id: 'G6 a mark at the pass read as from the future', old: 'm.at > nowMs', new: 'm.at >= nowMs' },
    { id: 'G7 an unread mark read as long hidden', old: "if (marks === 'unmeasured') return unmeasured('place-mark: the marks could not be read');",
      new: "if (marks === 'unmeasured') return { kind: 'measured', value: OPERATOR_MARK_MS };" },
  ],
  suite: placeHiddenCases,
};

export const RENEWAL_PLACE_READING_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalReadings.ts#placeHiddenOf': PLACE_HIDDEN_SET as MutantSet<never>,
};
