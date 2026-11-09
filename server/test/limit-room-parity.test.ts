// "Measured room" in two languages, one fixture table (D-8123, limit-swap-autofix Task 10).
//
// The limit watchdog (Task 9) raises a Waiting on you item when no account has MEASURED room, and the item's "Swap to…"
// lists the accounts that gain room as limits frames arrive (Task 11). The page therefore needs ccd's own answer to "does
// this account have room": `hasMeasuredRoom` (shared/limitRoom.ts, L0 and pure) is the twin of ccd's `_limit_score` (a rank
// that is empty unless every window the plan applies is measured) taken under `SWAP_CEILING`, and of `_avail`'s refusal at
// the ceiling. Every row is a FILE LAYOUT, so both sides read the same bytes and nothing here re-derives the rule: the
// TypeScript side reads it through `readLimits` (the rolled-over flags), the shell side through the real `_limit_score` and
// `_avail` in a fixture HOME. The rows are `fixtures/rollover.ts`'s (rolled-over, half-measured, weekly-only) plus the
// ceiling rows only this rule has.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hasMeasuredRoom, accountsWithMeasuredRoom } from '../../shared/limitRoom.js';
import { readLimits, measured } from '../src/limits.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { rolloverCases } from './fixtures/rollover.js';
import { seedRoster } from './helpers.js';

const CEILING = 98;
const T = 1_900_000_000;
const compact = (o: Record<string, number | null>): string => JSON.stringify(o);

interface RoomCase { file: string; content: string; room: boolean; why: string }

/** The ceiling rows: a score of 97 has room, 98 does not (`_avail` refuses AT the ceiling), on either half. */
const ceilingCases = (now: number): RoomCase[] => {
  const fresh = (five: number, seven: number): string =>
    compact({ five, seven, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 });
  return [
    { file: 'at-97.json', content: fresh(97, 10), room: true, why: 'one point under the ceiling on the five-hour half' },
    { file: 'at-98-five.json', content: fresh(98, 10), room: false, why: 'the five-hour half AT the ceiling' },
    { file: 'at-98-seven.json', content: fresh(10, 98), room: false, why: 'the seven-day half AT the ceiling' },
    { file: 'at-100.json', content: fresh(100, 0), room: false, why: 'a capped five-hour half, an empty week' },
    { file: 'empty.json', content: fresh(0, 0), room: true, why: 'a measured zero is a measurement' },
    { file: 'weekly-only-97.json', room: true, why: 'no 5h window: the weekly figure alone, under the ceiling',
      content: compact({ five: null, seven: 97, ts: now - 60, fiveResetAt: null, sevenResetAt: now + 400000, fiveWindowMinutes: 0 }) },
    { file: 'weekly-only-98.json', room: false, why: 'no 5h window: the weekly figure AT the ceiling',
      content: compact({ five: null, seven: 98, ts: now - 60, fiveResetAt: null, sevenResetAt: now + 400000, fiveWindowMinutes: 0 }) },
  ];
};

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-limit-room-parity-'); });
afterEach(() => { h.cleanup(); });

/** ccd's answer for the file written as `<w>.json`: `_limit_score` measured and under `SWAP_CEILING`, and `_avail` agreeing. */
const ccdRoom = (w: string, now: number): { room: boolean; score: string; avail: boolean } => {
  const out = h.sh(
    `score=$(_limit_score ${w}); if _avail ${w}; then a=1; else a=0; fi; echo "score=$score avail=$a ceiling=$SWAP_CEILING"`,
    { FAKE_NOW: String(now) });
  const m = /score=(\d*) avail=([01]) ceiling=(\d+)/.exec(out);
  if (m === null) throw new Error(`no answer: ${out}`);
  expect(Number(m[3]), 'the ceiling this table is run against is ccd\'s own').toBe(CEILING);
  return { room: m[1] !== '' && Number(m[1]) < CEILING && m[2] === '1', score: m[1]!, avail: m[2] === '1' };
};

describe('hasMeasuredRoom agrees with ccd\'s _limit_score and _avail over one table of files', () => {
  it('every row of the rollover table and the ceiling table, both languages', async () => {
    // ccd reads its own clock (`date +%s`, or $FAKE_NOW through the harness seam), so the files are written relative to a
    // fixed `now` that both sides are given.
    const now = Math.floor(Date.now() / 1000);
    const rows: RoomCase[] = [
      ...rolloverCases(now).map((c) => ({ file: c.file, content: c.content, room: c.score !== null && c.score < CEILING, why: c.why })),
      ...ceilingCases(now),
    ];
    const dir = path.join(h.home, '.cc-limits');
    fs.mkdirSync(dir, { recursive: true });
    for (const r of rows) fs.writeFileSync(path.join(dir, r.file), r.content);
    seedRoster(h.home);
    const limits = await readLimits(localIO, loadConfig({ CCRC_HOME: h.home }), now);
    for (const r of rows) {
      const w = r.file.slice(0, -'.json'.length);
      const ts = hasMeasuredRoom(limits[w], CEILING);
      const sh = ccdRoom(w, now);
      expect(ts, `${r.file} (${r.why}): shared/limitRoom.ts`).toBe(r.room);
      expect(sh.room, `${r.file} (${r.why}): ccd _limit_score under SWAP_CEILING and _avail`).toBe(r.room);
      // It is also the server's rank `measured()` taken under the ceiling, term for term.
      const rank = measured(limits[w]);
      expect(ts, `${r.file}: measured() under the ceiling`).toBe(rank !== null && rank < CEILING);
    }
  });
});

describe('hasMeasuredRoom is pure over the row it is given', () => {
  const row = (o: Partial<Parameters<typeof hasMeasuredRoom>[0] & object> = {}) => ({
    five: 10, seven: 20, fiveRolledOver: false, sevenRolledOver: false, ...o });

  it('an absent row (an account with no limits file) has no measured room', () => {
    expect(hasMeasuredRoom(undefined, CEILING)).toBe(false);
    expect(hasMeasuredRoom(null, CEILING)).toBe(false);
  });
  it('a half-measured row has none, however low the known half', () => {
    expect(hasMeasuredRoom(row({ five: null }), CEILING)).toBe(false);
    expect(hasMeasuredRoom(row({ seven: null }), CEILING)).toBe(false);
  });
  it('one rolled-over window is an inferred zero, not room', () => {
    expect(hasMeasuredRoom(row({ fiveRolledOver: true, five: 0 }), CEILING)).toBe(false);
    expect(hasMeasuredRoom(row({ sevenRolledOver: true, seven: 0 }), CEILING)).toBe(false);
  });
  it('fiveWindowMinutes 0 reads the weekly figure alone, and only when it has not rolled over', () => {
    expect(hasMeasuredRoom(row({ five: null, fiveWindowMinutes: 0 }), CEILING)).toBe(true);
    expect(hasMeasuredRoom(row({ five: null, fiveWindowMinutes: 0, sevenRolledOver: true, seven: 0 }), CEILING)).toBe(false);
    expect(hasMeasuredRoom(row({ five: null, fiveWindowMinutes: 0, seven: null }), CEILING)).toBe(false);
  });
  it('a non-zero window width is an ordinary two-window row', () => {
    expect(hasMeasuredRoom(row({ five: null, fiveWindowMinutes: 300 }), CEILING)).toBe(false);
    expect(hasMeasuredRoom(row({ fiveWindowMinutes: 300 }), CEILING)).toBe(true);
  });
  it('the ceiling is the caller\'s: the same row has room under 50 and none under 20', () => {
    expect(hasMeasuredRoom(row({ five: 30, seven: 40 }), 50)).toBe(true);
    expect(hasMeasuredRoom(row({ five: 30, seven: 40 }), 40)).toBe(false);
  });
});

describe('accountsWithMeasuredRoom lists the accounts a "Swap to…" may offer', () => {
  const ok = { five: 10, seven: 20, fiveRolledOver: false, sevenRolledOver: false };
  it('keeps roster order, drops rows without room, and drops a disabled or dead-credential account', () => {
    const limits = {
      'lane-a': { ...ok, five: 99 },
      'lane-b': { ...ok },
      'lane-c': { ...ok, five: null },
      'lane-d': { ...ok, disabled: true },
      'lane-e': { ...ok, authDead: true },
      'lane-f': { ...ok, seven: 5 },
    };
    expect(accountsWithMeasuredRoom(limits, CEILING)).toEqual(['lane-b', 'lane-f']);
  });
  it('an empty or undefined set lists nobody', () => {
    expect(accountsWithMeasuredRoom({}, CEILING)).toEqual([]);
    expect(accountsWithMeasuredRoom(undefined, CEILING)).toEqual([]);
  });
});
