// deploy/history-limits.mjs: the replay drivers' limits reading, its pure rules (W2-D55). Moved out of
// deploy/history-replay.mjs whole, by run 3538 (the note docs/superpowers/programs/overlord/quiz-account-room.md), behind
// the characterization table server/test/quiz-limits-reading.test.ts; the driver keeps the one read of the file
// (readLimitsRow, through its readPlain) and the gate that refuses on the answer (refuseOnLimits), and re-exports these.
//
// A row is parsed by readLimits' rules (server/src/limits.ts), term for term: a lapsed resetAt is a FACT and writes 0;
// only then does the age fallback infer a 0 for a value older than its own window. readLimits folds both into one
// `*RolledOver` flag; the driver keeps the provenance beside it (`*Inferred`), so its stop names which one it was. A parity
// case in history-replay.test.ts holds parseLimitsRow to readLimits over rolloverCases' bytes, so the two spellings of
// these rules cannot drift (a .mjs operator script cannot import server/src/*.ts).
//
// ONE ROOM RULE (run 3538: the coordinator's ruling 1 of 2026-11-23, and its answer on the reset rows). Which windows a row is judged on, and whether it
// measures them, is the fleet's rule (shared/limitRoom.ts, the twin of ccd's `_limit_score`): a row the status-line writer
// marks `fiveWindowMinutes: 0` (ccd/statusline-command.sh, at its fiveAbsentSince comment) is a plan with no five-hour
// window, judged on its weekly figure alone; any other row is judged on both. A window that has rolled over, by a lapsed
// resetAt or by age, measured nothing about the window now running, so the row is unknown, and unknown is never room.
// The quiz is deliberately stricter than that rule, and only stricter: the one-hour age bound, the 70 percent threshold
// (the rule's ceiling is the caller's), a figure outside 0 to 100, an undated row and a stamp from the future each stop it
// too. server/test/quiz-limits-reading.test.ts holds both readings to one table.
//
// Pure: it imports nothing, reads no clock and no file.

const LIMITS_FIVE_WINDOW_S = 18000;     // readLimits' FIVE_WINDOW: a five sample older than its own 5h window has rolled over
const LIMITS_SEVEN_WINDOW_S = 604800;   // readLimits' SEVEN_WINDOW, the same for seven
const LIMITS_FUTURE_SKEW_MS = 60_000;   // a ts at most a minute ahead of the clock is skew; further ahead measured nothing
const limitsNum = (v) => (typeof v === 'number' ? v : null);   // readLimits' numOrNull

/** One limits row's text, by readLimits' rules, keeping the provenance it folds. Throws on non-JSON or a non-object. */
export function parseLimitsRow(text, nowS) {
  const raw = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('a limits row is one JSON object');
  const ts = limitsNum(raw.ts);
  const fiveResetAt = limitsNum(raw.fiveResetAt);
  const sevenResetAt = limitsNum(raw.sevenResetAt);
  let five = limitsNum(raw.five);
  let seven = limitsNum(raw.seven);
  // The FACT first: a lapsed resetAt comes straight from the API, so its 0 is a measured end of that window (decideLimits
  // still stops on it: the window now running is unread).
  let fiveRolledOver = five !== null && fiveResetAt !== null && nowS >= fiveResetAt;
  let sevenRolledOver = seven !== null && sevenResetAt !== null && nowS >= sevenResetAt;
  if (fiveRolledOver) five = 0;
  if (sevenRolledOver) seven = 0;
  // Then the INFERENCE, which may not re-derive what the fact already said (readLimits' `!fiveRolledOver` guards).
  // readLimits sets only *RolledOver here; the driver also says the 0 was inferred, because that 0 measured nothing.
  let fiveInferred = false;
  let sevenInferred = false;
  if (ts !== null) {
    if (!fiveRolledOver && five !== null && nowS - ts > LIMITS_FIVE_WINDOW_S) { five = 0; fiveRolledOver = true; fiveInferred = true; }
    if (!sevenRolledOver && seven !== null && nowS - ts > LIMITS_SEVEN_WINDOW_S) { seven = 0; sevenRolledOver = true; sevenInferred = true; }
  }
  const fiveWindowMinutes = limitsNum(raw.fiveWindowMinutes);   // readLimits keeps it only when stated; null here is "not stated"
  return { five, seven, ts, fiveResetAt, sevenResetAt, fiveRolledOver, sevenRolledOver, fiveInferred, sevenInferred, fiveWindowMinutes };
}

/** The windows a parsed row is judged on, shared/limitRoom.ts's rule: `weekly` for a row marked with no five-hour window
 *  (`fiveWindowMinutes === 0`, the number zero only), `both` for any other. Pure.  @returns {'weekly' | 'both'} */
export function limitsWindowsOf(row) {
  return row.fiveWindowMinutes === 0 ? 'weekly' : 'both';
}

/** The limits stop (W2-D55): null admits the batch; otherwise the word and detail it stops with. */
export function decideLimits(read, { nowMs, thresholdPct, maxAgeMs }) {
  const stale = (detail) => ({ word: 'limits-stale', detail });
  switch (read.state) {
    case 'absent': return stale('absent');
    case 'not-regular': return stale('not-regular');
    case 'unreadable': return stale(`unreadable ${read.code}`);
    case 'malformed': return stale('malformed');
    case 'row': break;
    default: throw new TypeError(`not a limits read: ${JSON.stringify(read.state)}`);
  }
  const r = read.row;
  const both = limitsWindowsOf(r) === 'both';   // a row marked with no five-hour window never reads its five figure
  if (both && r.five === null) return stale('five-null');
  if (r.seven === null) return stale('seven-null');
  if ((both && !(r.five >= 0 && r.five <= 100)) || !(r.seven >= 0 && r.seven <= 100)) return stale('percent-out-of-range');
  if ((both && r.fiveInferred) || r.sevenInferred) return stale('inferred-by-age');
  if ((both && r.fiveRolledOver) || r.sevenRolledOver) return stale('rolled-over');   // a lapsed resetAt: the window now running is unread
  if (r.ts === null) return stale('ts-null');
  const aheadMs = r.ts * 1000 - nowMs;
  if (aheadMs > LIMITS_FUTURE_SKEW_MS) return stale(`ts-future ${aheadMs}`);
  const ageMs = nowMs - r.ts * 1000;
  if (ageMs > maxAgeMs) return stale(`old ${ageMs}`);
  if (!both) {
    return r.seven >= thresholdPct ? { word: 'limits-threshold', detail: `seven ${r.seven} at or over ${thresholdPct}, no five-hour window` } : null;
  }
  if (Math.max(r.five, r.seven) >= thresholdPct) {
    return { word: 'limits-threshold', detail: `five ${r.five} seven ${r.seven} at or over ${thresholdPct}` };
  }
  return null;
}
