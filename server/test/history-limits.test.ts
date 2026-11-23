// The quiz driver's limits reading (parseLimitsRow, then decideLimits), one row of bytes at a time: the words it stops a
// batch with, and the rows it admits. Run 3538 (programme overlord, ticket quiz-account-room; the note
// docs/superpowers/programs/overlord/quiz-account-room.md).
//
// CHARACTERIZATION FIRST. This table was written against the driver as it stood on main, green there, before the reading
// moved out of deploy/history-replay.mjs and before it learned the writer's `fiveWindowMinutes: 0` marker. Every row's
// answer is the driver's own. The change commit edited exactly the rows it moves, each saying why: RULING 1 (a marked row
// is judged on its weekly figure alone) or RESET (the coordinator's answer of 2026-11-23: a rolled-over window is unknown).
//
// THE PARITY TABLE (ruling 1) runs the same bytes through the driver's reading and through the fleet's one rule
// (shared/limitRoom.ts, over server/src/limits.ts's readLimits), and holds both to the windows each row is judged on and to
// measured-or-unknown. The rows where the quiz is deliberately stricter are a table of their own, each with its reason.
//
// ISOLATION: every row is a string handed to parseLimitsRow at a fixed clock. The parity table writes its rows into a
// mkTmp fixture HOME for readLimits; nothing here reads the live limits folder.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as drv from '../../deploy/history-limits.mjs';
import { hasMeasuredRoom } from '../../shared/limitRoom.js';
import { readLimits } from '../src/limits.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { seedRoster } from './helpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

type R = Record<string, any>;
const D = drv as unknown as R;

removeTmpFixturesEachTest();

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
    stop: { word: 'limits-stale', detail: 'rolled-over' }, why: 'RESET: was admitted as a measured reset; the window now running is unread' },
  { name: 'seven reset by its resetAt', text: row({ five: 20, seven: 87, ts: NOW_S - 600, sevenResetAt: NOW_S - 60 }),
    stop: { word: 'limits-stale', detail: 'rolled-over' }, why: 'RESET: was admitted; the week now running is unread' },
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
  { name: 'marked, weekly under the threshold', text: marked({ seven: 10 }), stop: null, why: 'RULING 1: was five-null; the weekly figure alone, 10 < 70' },
  { name: 'marked, weekly at the threshold', text: marked({ seven: 70 }),
    stop: { word: 'limits-threshold', detail: 'seven 70 at or over 70, no five-hour window' }, why: 'RULING 1: was five-null; inclusive' },
  { name: 'marked, weekly one under', text: marked({ seven: 69 }), stop: null, why: 'RULING 1: was five-null' },
  { name: 'marked, no weekly figure', text: marked({ seven: null }), stop: { word: 'limits-stale', detail: 'seven-null' }, why: 'RULING 1: was five-null; the one window unread' },
  { name: 'marked, past the age bound', text: marked({ seven: 10, ts: NOW_S - 3601 }), stop: { word: 'limits-stale', detail: 'old 3601000' },
    why: 'RULING 1: was five-null; the age bound stays' },
  { name: 'marked, an hour old', text: marked({ seven: 10, ts: NOW_S - 3600 }), stop: null, why: 'RULING 1: was five-null; exactly the bound' },
  { name: 'marked, no ts', text: JSON.stringify({ five: null, seven: 10, fiveWindowMinutes: 0 }), stop: { word: 'limits-stale', detail: 'ts-null' },
    why: 'RULING 1: was five-null; an undated row stays stale' },
  { name: 'marked, ts past the skew', text: marked({ seven: 10, ts: NOW_S + 61 }), stop: { word: 'limits-stale', detail: 'ts-future 61000' },
    why: 'RULING 1: was five-null; the skew bound stays' },
  { name: 'marked, weekly over 100', text: marked({ seven: 101 }), stop: { word: 'limits-stale', detail: 'percent-out-of-range' },
    why: 'RULING 1: was five-null; not a percent' },
  { name: 'marked, weekly inferred by age', text: JSON.stringify({ five: null, seven: 20, ts: NOW_S - 700_000, fiveWindowMinutes: 0 }), bounds: { maxAgeMs: 800_000_000 },
    stop: { word: 'limits-stale', detail: 'inferred-by-age' }, why: 'RULING 1: was five-null; inferred-by-age stays' },
  { name: 'marked, weekly reset by its resetAt', text: marked({ seven: 40, sevenResetAt: NOW_S - 60 }), stop: { word: 'limits-stale', detail: 'rolled-over' },
    why: 'RULING 1 and RESET: was five-null' },
  { name: 'marked with a five figure', text: row({ five: 90, seven: 10, fiveWindowMinutes: 0 }), stop: null,
    why: 'RULING 1: was limits-threshold on five; the shared rule never reads five on a marked row (no writer makes this shape)' },
  { name: 'marked, a damaged five figure', text: row({ five: 400, seven: 10, fiveWindowMinutes: 0 }), stop: null,
    why: 'RULING 1: five is not read, so it is not range-checked either' },
  { name: 'marked, five inferred by age', text: JSON.stringify({ five: 99, seven: 20, ts: NOW_S - 20_000, fiveWindowMinutes: 0 }), bounds: { maxAgeMs: 30_000_000 },
    stop: null, why: 'RULING 1: was inferred-by-age on five; seven is inside its week' },
];

describe('the driver\'s limits reading, rows marked with no five-hour window (characterization)', () => {
  it.each(MARKED)('$name', (c) => {
    expect(decide(c.text, c.bounds), c.why).toEqual(c.stop);
  });
});

// ── ruling 1: one room rule. The same bytes through the driver's reading and through shared/limitRoom.ts ─────────────
interface Parity { name: string; text: string; windows: 'weekly' | 'both'; measured: boolean }
/** Rows both readings answer alike: the windows a row is judged on, and whether it measures them. Fresh rows only, so the
 *  quiz's stricter-only stops (STRICTER below) stay out of the way. */
const PARITY: Parity[] = [
  { name: 'both measured', text: row({ five: 42, seven: 61 }), windows: 'both', measured: true },
  { name: 'both measured, over the quiz threshold', text: row({ five: 85, seven: 10 }), windows: 'both', measured: true },
  { name: 'five unread', text: row({ five: null, seven: 10 }), windows: 'both', measured: false },
  { name: 'seven unread', text: row({ five: 10, seven: null }), windows: 'both', measured: false },
  { name: 'a window width that is not zero, both read', text: row({ five: 10, seven: 10, fiveWindowMinutes: 300 }), windows: 'both', measured: true },
  { name: 'a window width that is not zero, five unread', text: row({ five: null, seven: 10, fiveWindowMinutes: 300 }), windows: 'both', measured: false },
  { name: 'a marker that is not a number', text: row({ five: null, seven: 10, fiveWindowMinutes: '0' }), windows: 'both', measured: false },
  { name: 'five reset by its resetAt', text: row({ five: 87, seven: 40, fiveResetAt: NOW_S - 60 }), windows: 'both', measured: false },
  { name: 'seven reset by its resetAt', text: row({ five: 20, seven: 87, sevenResetAt: NOW_S - 60 }), windows: 'both', measured: false },
  { name: 'five inferred by age', text: JSON.stringify({ five: 99, seven: 20, ts: NOW_S - 20_000 }), windows: 'both', measured: false },
  { name: 'marked, weekly read', text: marked({ seven: 10 }), windows: 'weekly', measured: true },
  { name: 'marked, weekly over the quiz threshold', text: marked({ seven: 85 }), windows: 'weekly', measured: true },
  { name: 'marked, weekly unread', text: marked({ seven: null }), windows: 'weekly', measured: false },
  { name: 'marked, weekly reset by its resetAt', text: marked({ seven: 40, sevenResetAt: NOW_S - 60 }), windows: 'weekly', measured: false },
  { name: 'marked with a five figure', text: row({ five: 90, seven: 10, fiveWindowMinutes: 0 }), windows: 'weekly', measured: true },
  { name: 'marked, five reset by its resetAt', text: row({ five: 50, seven: 10, fiveResetAt: NOW_S - 60, fiveWindowMinutes: 0 }), windows: 'weekly', measured: true },
];
/** Rows the quiz stops on where the fleet's rule reads a measurement: the quiz is stricter here, on purpose, and only here. */
const STRICTER: Array<{ name: string; text: string; stop: Stop; why: string }> = [
  { name: 'past the age bound', text: row({ five: 10, seven: 10, ts: NOW_S - 3601 }), stop: { word: 'limits-stale', detail: 'old 3601000' },
    why: 'the one-hour age bound: the rule reads a row of any age until its window ends' },
  { name: 'marked, past the age bound', text: marked({ seven: 10, ts: NOW_S - 3601 }), stop: { word: 'limits-stale', detail: 'old 3601000' },
    why: 'the age bound holds for a window-less row too' },
  { name: 'undated', text: JSON.stringify({ five: 10, seven: 10 }), stop: { word: 'limits-stale', detail: 'ts-null' }, why: 'the rule never reads ts' },
  { name: 'stamped from the future', text: row({ five: 10, seven: 10, ts: NOW_S + 61 }), stop: { word: 'limits-stale', detail: 'ts-future 61000' },
    why: 'the skew bound: the rule never reads ts' },
  { name: 'not a percent', text: row({ five: -5, seven: 10 }), stop: { word: 'limits-stale', detail: 'percent-out-of-range' },
    why: 'the rule takes any number as a figure' },
  { name: 'over 70 and under the ceiling', text: row({ five: 75, seven: 10 }), stop: { word: 'limits-threshold', detail: 'five 75 seven 10 at or over 70' },
    why: 'the quiz stops at 70; the fleet\'s ceiling is 98' },
];
const CEILING = 98;   // ccd's SWAP_CEILING, which limit-room-parity.test.ts reads from ccd itself
const NO_CEILING = Number.POSITIVE_INFINITY;   // under it, hasMeasuredRoom answers "measured" alone

/** Every row through readLimits, from a fixture HOME, by name. */
async function sharedRows(rows: Array<{ name: string; text: string }>): Promise<Record<string, R>> {
  const home = mkTmp('ccrc-quiz-limits-parity-');
  const dir = join(home, '.cc-limits');
  mkdirSync(dir, { recursive: true });
  rows.forEach((r, i) => writeFileSync(join(dir, `p-${i}.json`), r.text));
  seedRoster(home);
  const all = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), NOW_S) as Record<string, R>;
  return Object.fromEntries(rows.map((r, i) => [r.name, all[`p-${i}`]!]));
}
/** The windows the fleet's rule judges a row on: weekly when the five figure changes nothing once seven is measured. */
const sharedWindows = (l: R): 'weekly' | 'both' => {
  const probe = { ...l, seven: 50, sevenRolledOver: false, fiveRolledOver: false };
  return hasMeasuredRoom({ ...probe, five: null } as never, NO_CEILING) === hasMeasuredRoom({ ...probe, five: 50 } as never, NO_CEILING) ? 'weekly' : 'both';
};
const driverMeasured = (text: string): boolean => decide(text)?.word !== 'limits-stale';

describe('ruling 1: the driver\'s reading and the fleet\'s one rule agree, row for row', () => {
  it('CONTROL: the probe tells the two window sets apart, and a measured row is measured on both sides', async () => {
    const l = await sharedRows([{ name: 'm', text: marked({ seven: 10 }) }, { name: 'b', text: row({ five: 10, seven: 10 }) }]);
    expect(sharedWindows(l.m!)).toBe('weekly');
    expect(sharedWindows(l.b!)).toBe('both');
    expect(l.m!.fiveWindowMinutes, 'readLimits keeps the marker').toBe(0);
  });

  it('every parity row: the same windows and the same measured-or-unknown on both sides', async () => {
    const l = await sharedRows(PARITY);
    for (const c of PARITY) {
      const parsed = D.parseLimitsRow(c.text, NOW_S);
      expect(D.limitsWindowsOf(parsed), `${c.name}: the driver's windows`).toBe(c.windows);
      expect(sharedWindows(l[c.name]!), `${c.name}: the rule's windows`).toBe(c.windows);
      expect(driverMeasured(c.text), `${c.name}: the driver's reading measured`).toBe(c.measured);
      expect(hasMeasuredRoom(l[c.name] as never, NO_CEILING), `${c.name}: the rule's reading measured`).toBe(c.measured);
    }
  });

  it('every stricter row: the quiz stops with its own word where the rule reads room', async () => {
    const l = await sharedRows(STRICTER);
    for (const c of STRICTER) {
      expect(decide(c.text), `${c.name}: ${c.why}`).toEqual(c.stop);
      expect(hasMeasuredRoom(l[c.name] as never, CEILING), `${c.name}: the rule has room`).toBe(true);
    }
  });

  it('unknown is never room: over every row in this file, whatever the quiz admits the rule calls room at the quiz\'s own threshold', async () => {
    const all = [...TWO_WINDOW, ...MARKED, ...PARITY.map((p) => ({ ...p, bounds: undefined })), ...STRICTER.map((p) => ({ ...p, bounds: undefined }))]
      .map((c, i) => ({ ...c, name: `${i} ${c.name}` }));
    const l = await sharedRows(all);
    const admitted = all.filter((c) => decide(c.text, c.bounds) === null);
    expect(admitted.length, 'CONTROL: the table admits some rows').toBeGreaterThan(8);
    for (const c of admitted) expect(hasMeasuredRoom(l[c.name] as never, BOUNDS.thresholdPct), c.name).toBe(true);
  });
});

describe('the module stays pure', () => {
  it('deploy/history-limits.mjs imports nothing, so the driver\'s import census (history-replay.test.ts) sees every reader', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../../deploy/history-limits.mjs', import.meta.url), 'utf8');
    const code = text.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
    expect(code.filter((l) => /^\s*import\b|\bimport\s*\(|\brequire\s*\(|\bprocess\.|\bDate\.now\b/.test(l))).toEqual([]);
  });
});
