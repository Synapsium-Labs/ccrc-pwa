// The quiz driver's limits reading (parseLimitsRow, then decideLimits), one row of bytes at a time: the words it stops a
// batch with, and the rows it admits. Run 3538 (programme overlord, ticket quiz-account-room; the note
// docs/superpowers/programs/overlord/quiz-account-room.md).
//
// CHARACTERIZATION FIRST. This table was written against the driver as it stood on main, green there, before the reading
// moved out of deploy/history-replay.mjs and before it learned the writer's `fiveWindowMinutes: 0` marker. Every row's
// answer is the driver's own; a row whose answer the marker change moves says so in its `why`.
//
// ISOLATION: pure. Every row is a string handed to parseLimitsRow at a fixed clock; nothing here reads a limits folder.
import { describe, it, expect } from 'vitest';
import * as drv from '../../deploy/history-replay.mjs';

type R = Record<string, any>;
const D = drv as unknown as R;

const NOW_S = 1_800_000_000;
const NOW_MS = NOW_S * 1000;
const BOUNDS = { nowMs: NOW_MS, thresholdPct: 70, maxAgeMs: 3_600_000 };
type Stop = { word: string; detail: string } | null;

/** A row a status line wrote a minute ago, both resets in the future. */
const row = (o: R): string => JSON.stringify({ ts: NOW_S - 60, fiveResetAt: NOW_S + 3600, sevenResetAt: NOW_S + 86_400, ...o });
/** The same row as the writer leaves it once five-less readings have run a whole five-hour window: no five figure, the marker. */
const marked = (o: R): string => row({ five: null, fiveResetAt: null, fiveAbsentSince: NOW_S - 20_000, fiveWindowMinutes: 0, ...o });
const decide = (text: string, bounds: Partial<typeof BOUNDS> = {}): Stop =>
  D.decideLimits({ state: 'row', row: D.parseLimitsRow(text, NOW_S) }, { ...BOUNDS, ...bounds }) as Stop;

interface Case { name: string; text: string; bounds?: Partial<typeof BOUNDS>; stop: Stop; why: string }

/** The rows with no marker: the two-window reading. */
const TWO_WINDOW: Case[] = [
  { name: 'fresh, under the threshold', text: row({ five: 42, seven: 61 }), stop: null, why: 'both windows measured, the larger 61 < 70' },
  { name: 'five null', text: row({ five: null, seven: 10 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'a plan with a five-hour window and no reading of it' },
  { name: 'seven null', text: row({ five: 10, seven: null }), stop: { word: 'limits-stale', detail: 'seven-null' }, why: 'no weekly reading' },
  { name: 'both null', text: row({ five: null, seven: null }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'five is asked first' },
  { name: 'five over 100', text: row({ five: 101, seven: 10 }), stop: { word: 'limits-stale', detail: 'percent-out-of-range' }, why: 'not a percent' },
  { name: 'seven negative', text: row({ five: 10, seven: -1 }), stop: { word: 'limits-stale', detail: 'percent-out-of-range' }, why: 'not a percent' },
  { name: 'no ts', text: JSON.stringify({ five: 10, seven: 10 }), stop: { word: 'limits-stale', detail: 'ts-null' }, why: 'an undated row' },
  { name: 'ts a minute ahead', text: row({ five: 10, seven: 10, ts: NOW_S + 60 }), stop: null, why: 'clock skew' },
  { name: 'ts past the skew', text: row({ five: 10, seven: 10, ts: NOW_S + 61 }), stop: { word: 'limits-stale', detail: 'ts-future 61000' }, why: 'measured nothing' },
  { name: 'an hour old', text: row({ five: 10, seven: 10, ts: NOW_S - 3600 }), stop: null, why: 'exactly the age bound' },
  { name: 'past the age bound', text: row({ five: 10, seven: 10, ts: NOW_S - 3601 }), stop: { word: 'limits-stale', detail: 'old 3601000' }, why: 'one second over' },
  { name: 'five inferred by age', text: JSON.stringify({ five: 99, seven: 20, ts: NOW_S - 20_000 }), bounds: { maxAgeMs: 30_000_000 },
    stop: { word: 'limits-stale', detail: 'inferred-by-age' }, why: 'an age-inferred zero measured nothing' },
  { name: 'seven inferred by age', text: JSON.stringify({ five: 87, seven: 20, ts: NOW_S - 700_000, fiveResetAt: NOW_S - 60 }), bounds: { maxAgeMs: 800_000_000 },
    stop: { word: 'limits-stale', detail: 'inferred-by-age' }, why: 'seven older than its own week' },
  { name: 'five reset by its resetAt', text: row({ five: 87, seven: 40, ts: NOW_S - 600, fiveResetAt: NOW_S - 60, sevenResetAt: NOW_S + 200_000 }),
    stop: null, why: 'a lapsed resetAt is a measured reset (the driver\'s reading; see the parity table)' },
  { name: 'five at the threshold', text: row({ five: 70, seven: 12 }), stop: { word: 'limits-threshold', detail: 'five 70 seven 12 at or over 70' }, why: 'inclusive' },
  { name: 'seven at the threshold', text: row({ five: 12, seven: 70 }), stop: { word: 'limits-threshold', detail: 'five 12 seven 70 at or over 70' }, why: 'inclusive' },
  { name: 'one under', text: row({ five: 69, seven: 12 }), stop: null, why: 'inclusive' },
  { name: 'a window width that is not zero', text: row({ five: null, seven: 10, fiveWindowMinutes: 300 }), stop: { word: 'limits-stale', detail: 'five-null' },
    why: 'only 0 is the marker: a plan with a five-hour window of any width keeps both' },
  { name: 'a marker that is not a number', text: row({ five: null, seven: 10, fiveWindowMinutes: '0' }), stop: { word: 'limits-stale', detail: 'five-null' },
    why: 'the string "0" is not the marker' },
  { name: 'fiveAbsentSince alone, before the marker', text: row({ five: null, seven: 10, fiveAbsentSince: NOW_S - 600 }), stop: { word: 'limits-stale', detail: 'five-null' },
    why: 'the run of five-less readings is under a whole window: no marker yet, so still stale' },
];

describe('the driver\'s limits reading, rows with no marker (characterization)', () => {
  it.each(TWO_WINDOW)('$name', (c) => {
    expect(decide(c.text, c.bounds), c.why).toEqual(c.stop);
  });
});

/** The rows the writer marks `fiveWindowMinutes: 0`. */
const MARKED: Case[] = [
  { name: 'marked, weekly under the threshold', text: marked({ seven: 10 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY the marker is ignored' },
  { name: 'marked, weekly at the threshold', text: marked({ seven: 75 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY the marker is ignored' },
  { name: 'marked, no weekly figure', text: marked({ seven: null }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked, past the age bound', text: marked({ seven: 10, ts: NOW_S - 3601 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked, no ts', text: JSON.stringify({ five: null, seven: 10, fiveWindowMinutes: 0 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked, ts past the skew', text: marked({ seven: 10, ts: NOW_S + 61 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked, weekly over 100', text: marked({ seven: 101 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked, weekly inferred by age', text: JSON.stringify({ five: null, seven: 20, ts: NOW_S - 700_000, fiveWindowMinutes: 0 }), bounds: { maxAgeMs: 800_000_000 },
    stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked, weekly reset by its resetAt', text: marked({ seven: 40, sevenResetAt: NOW_S - 60 }), stop: { word: 'limits-stale', detail: 'five-null' }, why: 'TODAY five is asked first' },
  { name: 'marked with a five figure', text: row({ five: 90, seven: 10, fiveWindowMinutes: 0 }), stop: { word: 'limits-threshold', detail: 'five 90 seven 10 at or over 70' },
    why: 'TODAY the marker is ignored and five counts' },
];

describe('the driver\'s limits reading, rows marked with no five-hour window (characterization)', () => {
  it.each(MARKED)('$name', (c) => {
    expect(decide(c.text, c.bounds), c.why).toEqual(c.stop);
  });
});
