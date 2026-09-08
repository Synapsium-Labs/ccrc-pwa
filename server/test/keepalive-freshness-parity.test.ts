/**
 * "How fresh is fresh" is one number spelled in two files, and they cannot be
 * held equal structurally: `ccd/ccd` sources nothing from this repository, and
 * `ccd/ccd-telemetry-keepalive` is a sibling executable that sources nothing
 * from ccd. This is `pool-name-parity.test.ts`'s mechanism applied to the one
 * value the keepalive design puts in two places.
 *
 * WHY THEY MUST AGREE. `SWAP_FRESH`'s own comment calls it "telemetry younger
 * than this qualifies for pre-emptive swaps" — the tree's definition of a
 * usable reading. The keepalive asks the same question from the other side:
 * an account whose telemetry is still fresh by that definition does not need a
 * turn spent on it. Two spellings that drifted would mean the fleet spending
 * on accounts the swap lane already trusts, or trusting readings the keepalive
 * had given up on.
 *
 * The keepalive's is a DEFAULT, not a constant: `CCRC_KEEPALIVE_FRESH=7200` in
 * a systemd drop-in is the supported way to widen the interval on a box. What
 * is pinned is the shipped default, which is what an unconfigured box runs.
 *
 * EXACTLY ONE occurrence each, not "at least one": a second assignment in the
 * same file is the drift this exists to refuse, and a scan taking the first
 * match would not see it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const CCD = readFileSync(path.join(ROOT, 'ccd', 'ccd'), 'utf8');
const KEEPALIVE = readFileSync(path.join(ROOT, 'ccd', 'ccd-telemetry-keepalive'), 'utf8');

/** The single match, with the COUNT asserted first. */
function exactlyOne(src: string, re: RegExp, what: string): string {
  const all = [...src.matchAll(new RegExp(re.source, 'gm'))];
  expect(all.length, `${what}: expected exactly one occurrence, found ${all.length}`).toBe(1);
  return all[0]![1]!;
}

describe('the keepalive spends on the tree’s own definition of stale', () => {
  it('ccd still declares SWAP_FRESH as a bare integer', () => {
    expect(exactlyOne(CCD, /^SWAP_FRESH=([0-9]+)/, 'ccd/ccd SWAP_FRESH')).toMatch(/^[0-9]+$/);
  });

  it('the keepalive still declares CCRC_KEEPALIVE_FRESH as a bare default', () => {
    expect(exactlyOne(KEEPALIVE, /^: "\$\{CCRC_KEEPALIVE_FRESH:=([0-9]+)\}"/,
      'the keepalive CCRC_KEEPALIVE_FRESH default')).toMatch(/^[0-9]+$/);
  });

  it('and the two are the same number', () => {
    const swap = exactlyOne(CCD, /^SWAP_FRESH=([0-9]+)/, 'ccd/ccd SWAP_FRESH');
    const keep = exactlyOne(KEEPALIVE, /^: "\$\{CCRC_KEEPALIVE_FRESH:=([0-9]+)\}"/,
      'the keepalive CCRC_KEEPALIVE_FRESH default');
    expect(Number(keep),
      'the keepalive would now spend a turn on telemetry the swap lane still calls fresh, '
      + 'or refuse to spend on telemetry the swap lane has already given up on')
      .toBe(Number(swap));
  });
});
