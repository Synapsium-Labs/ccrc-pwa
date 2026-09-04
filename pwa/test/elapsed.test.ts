// `elapsedWords` was an EXTRACTION, and the commit that made it claimed
// FleetHostBanner's output was byte-identical afterwards. That claim was
// unmeasured — review finding, and a fair one: a refactor whose whole defence
// is "nothing changed" and which has no test asserting nothing changed is a
// promise, not a mechanism.
//
// So the OLD implementation is transcribed here verbatim, from the diff, and
// the two are compared across every boundary the ladder has. If a future edit
// to `elapsedWords` moves a rounding rule, this file names it — including for
// the caller that no longer contains the arithmetic and would otherwise have
// no way to notice.
import { describe, it, expect } from 'vitest';
import { elapsedWords } from '../src/lib/elapsed';

/** FleetHostBanner's `elapsedSince`, EXACTLY as it read before the extraction
 *  (pwa/src/fleet/FleetHostBanner.tsx, pre-6d6d42f8). Not imported — copied,
 *  deliberately: the point is to compare against the thing that no longer
 *  exists. */
function elapsedSinceOld(downSince: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - downSince) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h ago` : `${d}d ago`;
  if (h > 0) return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'moments ago';
}

const S = 1_000, M = 60 * S, H = 60 * M, D = 24 * H;

// Every branch boundary in the ladder, from both sides, plus the cases a
// duration formatter gets wrong: zero, one below and one above each carry, and
// a NEGATIVE span, which clock skew between the server and the viewer makes an
// ordinary input rather than an exotic one.
const CASES: [string, number][] = [
  ['zero', 0],
  ['sub-second', 999],
  ['one second', S],
  ['just under a minute', M - 1],
  ['exactly a minute', M],
  ['a minute and change', M + 30 * S],
  ['59 minutes', 59 * M],
  ['just under an hour', H - 1],
  ['exactly an hour', H],
  ['an hour with no minutes', H + 59 * S],
  ['an hour and ten', H + 10 * M],
  ['just under a day', D - 1],
  ['exactly a day', D],
  ['a day with no hours', D + 59 * M],
  ['a day and four hours', D + 4 * H],
  ['three days', 3 * D],
  ['negative — a stamp in the future', -5 * M],
  ['negative — far in the future', -3 * D],
];

describe('elapsedWords', () => {
  it.each(CASES)('agrees with the pre-extraction FleetHostBanner formatter: %s', (_name, ms) => {
    // The banner's own call shape, so the subtraction is exercised the way the
    // caller does it rather than only as a bare span.
    const now = 1_754_000_000_000;
    expect(`${elapsedWords(ms)} ago`).toBe(elapsedSinceOld(now - ms, now));
  });

  it('prints a bare span, never a sentence — the preposition belongs to the caller', () => {
    // The reason the split is where it is: "… ago" and "held …" are different
    // claims about one number, and a helper that baked in either would be
    // wrong for the other caller.
    expect(elapsedWords(3 * H + 12 * M)).toBe('3h 12m');
    expect(elapsedWords(0)).toBe('moments');
    for (const [, ms] of CASES) expect(elapsedWords(ms)).not.toMatch(/ago|held|for /);
  });

  it('clamps a negative span rather than rendering a minus', () => {
    // Skew makes a future stamp ordinary. "moments" is the truthful reading of
    // "so recent my clock disagrees about the order"; "-5m" is not a duration.
    expect(elapsedWords(-5 * M)).toBe('moments');
    expect(elapsedWords(-3 * D)).toBe('moments');
  });

  it('is coarse at every scale, on purpose', () => {
    // Read at a glance to answer "is this normal". Seconds never appear, and
    // the third unit never does either: `1d 4h`, not `1d 4h 22m`.
    expect(elapsedWords(D + 4 * H + 22 * M + 9 * S)).toBe('1d 4h');
    expect(elapsedWords(H + 22 * M + 9 * S)).toBe('1h 22m');
    expect(elapsedWords(22 * M + 9 * S)).toBe('22m');
  });
});
