// Single-definition scanners, one area of the guard (see ./helpers.ts for the doctrine and the shared walkers).
// The generation machine's starting values (Overlord W1a, renewal deciders Task 1; spec §11.5, Table 11.5b: "Each is
// one named constant, or one row of an L0 table, so the single-definition scan pins it").
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOTS, ccrcRoot, rel, sources } from './helpers.js';

const HOME = 'shared/continuity.ts';
const NAMES = ['STATE_DEADLINE_S', 'RENEWAL_BUDGET_S', 'HOLD_OFF_MS', 'LEAST_AGE_MS', 'SOFT_BUDGET', 'BREAK_NO_MESSAGE_MS',
  'BREAK_PLACE_HIDDEN_MS', 'HARD_CAP_TOKENS', 'SOFT_CEILING_FRACTION', 'TURNS_SOFT', 'IDLE_SOFT_MS', 'ACCOUNT_LOAD_HARD',
  'EARLY_WHILE_AWAY_FRACTION', 'CHECKPOINT_THREAD', 'NOTES_CAP', 'IDLE_FLOOR_FRACTION', 'WAVE_BOUNDARY_FLOOR_FRACTION',
  'RESUMED_LONG_FRACTION', 'ON_SCHEDULE_WAIT_MS', 'RENEWAL_LANE_PERIOD_MS', 'OBSERVED_STEP_PERIODS', 'CARDED_NUDGE_AT_MS'];
/** The figures no continuity decider may spell again: it imports the constant instead. */
const FIGURES = [250_000, 300_000, 600_000, 1_200_000, 1_800_000, 2_700_000, 21_600_000];

const declares = (text: string, name: string): boolean => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(text);
/** A figure written as code, with or without digit separators (`1_800_000`, `1800000`). */
const spells = (text: string, n: number): boolean => {
  const digits = String(n).split('');
  return new RegExp(`(?<![\\w.])${digits.join('_?')}(?![\\w.])`).test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''));
};
/** The deciders that read these values, by name: a later decider joins this list. Not the whole of
 *  `server/src/continuity/`, whose other files (a store, a route, a card) keep figures of their own, such as the
 *  compaction pairing window, which is ten minutes too (review 1894, F2). */
const DECIDERS = ['server/src/continuity/renewalDue.ts', 'server/src/continuity/softRenewal.ts', 'server/src/time/observed.ts'];

describe('the generation machine\'s starting values are defined once, in shared/continuity.ts', () => {
  const all = ROOTS.filter((r) => existsSync(r)).flatMap(sources);

  it('CONTROL: the scanners see a declaration and a figure, in either spelling, and not inside a comment', () => {
    expect(declares('export const HOLD_OFF_MS = 600_000;', 'HOLD_OFF_MS')).toBe(true);
    expect(declares('const x = HOLD_OFF_MS;', 'HOLD_OFF_MS')).toBe(false);
    expect(spells('if (ms >= 1800000) f();', 1_800_000)).toBe(true);
    expect(spells('if (ms >= 1_800_000) f();', 1_800_000)).toBe(true);
    expect(spells('// 1_800_000 is the least age', 1_800_000)).toBe(false);
    expect(spells('const a = 11_800_000;', 1_800_000)).toBe(false);
  });

  it.each(NAMES)('%s is declared in exactly one file', (name) => {
    expect(all.filter((f) => declares(readFileSync(f, 'utf8'), name)).map(rel)).toEqual([HOME]);
  });

  it('the decider list is not empty, and every file on it exists', () => {
    expect(DECIDERS.length).toBeGreaterThanOrEqual(3);
    expect(DECIDERS.filter((f) => !existsSync(path.join(ccrcRoot, f)))).toEqual([]);
  });

  it('no continuity decider spells one of the figures', () => {
    const hits = DECIDERS.flatMap((f) => FIGURES.filter((n) => spells(readFileSync(path.join(ccrcRoot, f), 'utf8'), n))
      .map((n) => `${f}: ${n}`));
    expect(hits).toEqual([]);
  });
});
