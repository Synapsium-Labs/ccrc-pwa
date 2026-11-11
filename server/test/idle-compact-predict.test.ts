import { describe, it, expect } from 'vitest';
import {
  IDLE_COMPACT_ESTIMATE_MS, predictIdleCompactAt, type FleetSession, type SessionBucket, type SessionUsage,
} from '../../shared/api.js';

// D-8267 (the operator's ruling of 2026-11-11): idle compaction stays on (D-8173), and when it will run is predicted
// from the prompt cache's expiry the statusline records, falling back to the fixed estimate (about 55 minutes after the
// turn ended, the D-5371 measurement) when the sidecar carries no expiry.

const ENDED = 1_800_000_000_000;   // ms: when the row entered its bucket (the turn's end for `done`)
const EXPIRES_S = 1_800_003_300;   // the sidecar's unit, epoch seconds

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  ts: 1_800_000_000, model: 'claude-opus-5', class: 'opus', effort: 'high', ctxPct: 40, cost: 1,
  cacheExpiresAt: EXPIRES_S, stale: false, ...over,
});

type Row = Pick<FleetSession, 'bucket' | 'bucketSince' | 'usage'>;
const row = (over: Partial<Row> = {}): Row => ({ bucket: 'done', bucketSince: ENDED, usage: usage(), ...over });

describe('predictIdleCompactAt (D-8267)', () => {
  it('the estimate is today\'s fixed figure: 55 minutes after the turn ended', () => {
    expect(IDLE_COMPACT_ESTIMATE_MS).toBe(55 * 60_000);
  });

  it('a finished turn with a recorded cache expiry: the expiry, in ms', () => {
    expect(predictIdleCompactAt(row())).toEqual({ at: EXPIRES_S * 1000, basis: 'cache-expiry' });
  });

  it('an idle row with a recorded cache expiry: the expiry', () => {
    expect(predictIdleCompactAt(row({ bucket: 'idle' }))).toEqual({ at: EXPIRES_S * 1000, basis: 'cache-expiry' });
  });

  it('a stale reading still carries an absolute expiry, so it is still used', () => {
    expect(predictIdleCompactAt(row({ usage: usage({ stale: true }) }))).toEqual({ at: EXPIRES_S * 1000, basis: 'cache-expiry' });
  });

  it.each([
    ['the expiry is null (a cold cache)', usage({ cacheExpiresAt: null })],
    ['the reading has no expiry key (an older server or hook)', (() => { const u: Record<string, unknown> = { ...usage() }; delete u['cacheExpiresAt']; return u as unknown as SessionUsage; })()],
    ['there is no reading at all', null],
  ] as const)('missing expiry: %s, so the estimate from the bucket\'s start', (_label, u) => {
    expect(predictIdleCompactAt(row({ usage: u }))).toEqual({ at: ENDED + IDLE_COMPACT_ESTIMATE_MS, basis: 'estimate' });
  });

  it('a row whose usage field is missing at runtime (a cast frame from an older server) falls back too', () => {
    const r = { bucket: 'done', bucketSince: ENDED } as unknown as Row;
    expect(predictIdleCompactAt(r)).toEqual({ at: ENDED + IDLE_COMPACT_ESTIMATE_MS, basis: 'estimate' });
  });

  it('no expiry and no bucket start: nothing to predict from', () => {
    expect(predictIdleCompactAt(row({ usage: null, bucketSince: null }))).toBeNull();
  });

  it.each(['working', 'attention', 'cleanup', 'archived', 'dead'] as const satisfies readonly SessionBucket[])(
    'a %s row has no idle compaction coming, expiry or not', (bucket) => {
      expect(predictIdleCompactAt(row({ bucket }))).toBeNull();
      expect(predictIdleCompactAt(row({ bucket, usage: null }))).toBeNull();
    });
});
