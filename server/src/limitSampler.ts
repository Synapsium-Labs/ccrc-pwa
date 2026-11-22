// The limit sampler (Overlord W1 serviceability PR B, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`
// Task 6; spec C57 "A history of limits"; the W1 index's question 8). L4, context C1: the watcher's `limitSamples` lane
// runs one pass every `LIMIT_SAMPLE_MS`, over the reading the tick already took (`FleetWatcher.currentLimits()`). It adds
// no read of its own and reads no clock: the watcher hands it the reading, the roster and the time.
//
// Only `telemetry: 'anthropic'` accounts are sampled (F14, slug `samples-are-anthropic-readings`): the statusline is the
// only writer of such a file that writes a reading, so the codex lanes' publisher and ccd's synthetic exclusion row never
// become samples. A reading with no `ts` writes nothing. A rolled-over window is stored with its flag, so the runway
// leaves it out.
import { LIMIT_SAMPLES_KEEP_S } from '../../shared/loadLines.js';
import type { Roster } from '../../shared/roster.js';
import type { AccountLimits } from './limits.js';
import type { LimitSample } from './poolRunway.js';

/** The store's two writers the pass calls (`CoordStore`'s delegates). */
export interface LimitSampleStore {
  insertLimitSamples(rows: readonly LimitSample[], sampledAt: number): number;
  pruneLimitSamples(beforeS: number): number;
}

/** The rows one pass writes: one per Anthropic roster account whose reading carries a time. */
export function limitSampleRows(limits: Readonly<Record<string, AccountLimits>>, roster: Roster): LimitSample[] {
  const rows: LimitSample[] = [];
  for (const a of roster.accounts) {
    if (a.telemetry !== 'anthropic') continue;
    const l = limits[a.id];
    if (l === undefined || l.ts === null) continue;
    rows.push({
      account: a.id, ts: l.ts, five: l.five, seven: l.seven, fiveResetAt: l.fiveResetAt, sevenResetAt: l.sevenResetAt,
      fiveRolled: l.fiveRolledOver, sevenRolled: l.sevenRolledOver, fiveWindowMinutes: l.fiveWindowMinutes ?? null,
    });
  }
  return rows;
}

/** One beat: insert the tick's readings, then prune past `LIMIT_SAMPLES_KEEP_S`. A store that throws throws to the lane,
 *  whose row warns; nothing retries inside a beat. */
export function limitSamplePass(store: LimitSampleStore, limits: Readonly<Record<string, AccountLimits>>, roster: Roster,
  nowS: number): { readonly inserted: number; readonly pruned: number } {
  const inserted = store.insertLimitSamples(limitSampleRows(limits, roster), nowS);
  const pruned = store.pruneLimitSamples(nowS - LIMIT_SAMPLES_KEEP_S);
  return { inserted, pruned };
}
