// D-8075 (spec 2026-11-04 §11.6, A26): the programme's own words from its runs, pure. Ring: L0/L1, context Coordination.
// `GET /api/programmes` (the server) and the programme card (the PWA) read this one file, so a wave has one bucket and a
// current wave has one definition. It imports only from `./api.js`.
import type { RunKind, RunState } from './api.js';

export type WaveBucket = 'working' | 'waiting' | 'queued' | 'done' | 'failed';
export const WAVE_BUCKETS: readonly WaveBucket[] = ['working', 'waiting', 'queued', 'done', 'failed'];
export const isWaveBucket = (v: unknown): v is WaveBucket => typeof v === 'string' && (WAVE_BUCKETS as readonly string[]).includes(v);

/** Which wave count each work-run state files under. A `Record` over `RunState`, so a state added to the wire type is a
 *  compile error here and never a silently missing count. `awaiting-review` is the board's Waiting (D-6170); `planned` is
 *  queued; `unknown` is we-do-not-know and reads as working, as `RUN_GROUP` does. */
export const WAVE_BUCKET: Readonly<Record<RunState, WaveBucket>> = Object.freeze({
  planned: 'queued',
  dispatched: 'working',
  working: 'working',
  merging: 'working',
  closing: 'working',
  unknown: 'working',
  'awaiting-review': 'waiting',
  done: 'done',
  failed: 'failed',
});

/** A wave's bucket, from the work runs named by `waves`. */
export interface WaveFact {
  readonly wave: number;
  readonly waveOf: number | null;
  readonly bucket: WaveBucket;
}

/** The programme's current wave: the highest wave whose work run has left `planned` (dispatched or later, or closed), else
 *  the lowest queued wave (`queued` true: "wave N queued"). Null with no wave at all. A wave opened ahead is never reached. */
export function programmeCurrentWave(waves: readonly WaveFact[]): { wave: number; waveOf: number | null; queued: boolean } | null {
  let reached: WaveFact | null = null;
  let lowestQueued: WaveFact | null = null;
  for (const w of waves) {
    if (w.bucket === 'queued') {
      if (lowestQueued === null || w.wave < lowestQueued.wave) lowestQueued = w;
    } else if (reached === null || w.wave > reached.wave) reached = w;
  }
  if (reached !== null) return { wave: reached.wave, waveOf: reached.waveOf, queued: false };
  if (lowestQueued !== null) return { wave: lowestQueued.wave, waveOf: lowestQueued.waveOf, queued: true };
  return null;
}

/** Only a work run counts toward a wave. */
export const countsAsWave = (kind: RunKind): boolean => kind === 'work';
