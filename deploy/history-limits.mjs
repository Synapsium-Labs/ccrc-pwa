// deploy/history-limits.mjs: the replay drivers' limits reading, its pure rules (W2-D55). Moved out of
// deploy/history-replay.mjs whole, by run 3538 (the note docs/superpowers/programs/overlord/quiz-account-room.md), behind
// the characterization table server/test/history-limits.test.ts; the driver keeps the one read of the file
// (readLimitsRow, through its readPlain) and the gate that refuses on the answer (refuseOnLimits), and re-exports these.
//
// A row is parsed by readLimits' rules (server/src/limits.ts), term for term: a lapsed resetAt is a FACT and writes 0;
// only then does the age fallback infer a 0 for a value older than its own window. readLimits folds both into one
// `*RolledOver` flag; the driver keeps the provenance beside it (`*Inferred`), because here the two answer differently: a
// resetAt 0 is a measured reset and may admit a batch, an age-inferred 0 measured nothing and stops it as stale. A parity
// case in history-replay.test.ts holds parseLimitsRow to readLimits over rolloverCases' bytes, so the two spellings of
// these rules cannot drift (a .mjs operator script cannot import server/src/*.ts).
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
  // The FACT first: a lapsed resetAt comes straight from the API, so its 0 is a measured reset.
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
  return { five, seven, ts, fiveResetAt, sevenResetAt, fiveRolledOver, sevenRolledOver, fiveInferred, sevenInferred };
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
  if (r.five === null) return stale('five-null');
  if (r.seven === null) return stale('seven-null');
  if (!(r.five >= 0 && r.five <= 100) || !(r.seven >= 0 && r.seven <= 100)) return stale('percent-out-of-range');
  if (r.fiveInferred || r.sevenInferred) return stale('inferred-by-age');
  if (r.ts === null) return stale('ts-null');
  const aheadMs = r.ts * 1000 - nowMs;
  if (aheadMs > LIMITS_FUTURE_SKEW_MS) return stale(`ts-future ${aheadMs}`);
  const ageMs = nowMs - r.ts * 1000;
  if (ageMs > maxAgeMs) return stale(`old ${ageMs}`);
  if (Math.max(r.five, r.seven) >= thresholdPct) {
    return { word: 'limits-threshold', detail: `five ${r.five} seven ${r.seven} at or over ${thresholdPct}` };
  }
  return null;
}
