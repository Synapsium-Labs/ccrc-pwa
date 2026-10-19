// The condemned lane's gauge fill, measured: visibly off, and quiet.
//
// WHAT THIS PINS. `Meter`'s fourth band, `off`, paints `--ink-tertiary` on
// `--limit-track` (D-5494). Across all twelve palettes that pair measures 3.99
// at worst (CATPPUCCIN-MOCHA) to 5.04 (GITHUB-LIGHT): the frozen extent of an
// off lane's bar can be seen, so the row beside it reading "91%" has a bar
// under it, and the bar is grey, not a band's colour.
//
// WHAT IT REPLACED. The band used to paint `--edge-subtle`, the colour the old
// `fleet.css` rule `.acct-list .acct-row[data-disabled='true'] .limit-fill`
// set, kept when the band moved onto the component. On the track that pair
// measured 1.02 to 1.10: a fill at 1.05 against its own track is not a quiet
// fill, it is an absent one. This file pinned that number in both directions
// until the fix was wanted; the coordinator called it in the foundations
// reviews' follow-ups, and D-5494 records the call.
//
// WHERE IT SHOWS. Every off lane draws through the one `Meter` (D-5098): the
// condemned and expired rows of the swap and new-session pickers, the Accounts
// screen's disabled and sign-in-expired lanes, and the accounts strip's
// sign-in-expired lanes (the strip hides a disabled one).
//
// WHY THE TERTIARY TIER. It is the cheapest ink that clears 3:1 on the track
// everywhere since the ink tiers were separated (D-5097, D-5155), and it is the
// tier the Accounts screen already gives an off lane's label, so the row reads
// as one statement. It stays below the secondary tier on the same track, so an
// off bar is never louder than the text that explains it.
//
// NOT `--ink-disabled`, which is the token the name suggests and the one this
// file first proposed: it measures 2.11 in LIGHT and fails. That is why the
// choice is held by an ASSERTION and not a sentence.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadThemes, ratio } from '../design/audit.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const { DARK, byName } = loadThemes(ROOT);
const all: [string, Record<string, string>][] = [['DARK', DARK], ...Object.entries(byName)];

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
// The fill's vocabulary moved into meter.tsx with the one meter (D-5098,
// D-5446); limit-bar.tsx re-exports it.
const meter = readFileSync(path.join(UI_SRC, 'primitives', 'meter.tsx'), 'utf8');

/** A non-text graphic's floor (WCAG 1.4.11). */
const GRAPHIC_FLOOR = 3;

const onTrack = (token: string, theme: Record<string, string>): number =>
  ratio(`var(${token})`, ['var(--limit-track)'], theme);

describe('the `off` band is visibly off, and quiet (D-5494)', () => {
  it('paints the tertiary ink, not the edge it used to', () => {
    expect(meter).toContain("off: 'limit-fill--off bg-ink-tertiary'");
    expect(meter).not.toMatch(/off: '[^']*bg-edge-subtle/);
  });

  it('clears 3:1 against its own track in every palette', () => {
    const short = all.map(([name, theme]) => [name, onTrack('--ink-tertiary', theme)] as const)
      .filter(([, r]) => r < GRAPHIC_FLOOR)
      .map(([n, r]) => `${n} = ${r.toFixed(2)}`);
    expect(short, 'an off bar under 3:1 is an absent bar').toEqual([]);
  });

  it('stays quieter than the secondary ink on the same track, so it never outshouts its note', () => {
    const loud = all.filter(([, t]) => onTrack('--ink-tertiary', t) >= onTrack('--ink-secondary', t))
      .map(([n]) => n);
    expect(loud).toEqual([]);
  });

  it('keeps the two traps measured: the old edge was invisible, and the disabled ink is short', () => {
    // The colour it replaced, so the reason for the change stays a number.
    const edgeBest = Math.max(...all.map(([, t]) => onTrack('--edge-subtle', t)));
    expect(edgeBest, '--edge-subtle now reads on the track; restate the header').toBeLessThan(1.2);
    // The token the NAME suggests still does not clear the floor.
    const naive = Math.min(...all.map(([, t]) => onTrack('--ink-disabled', t)));
    expect(naive, 'if --ink-disabled now clears 3:1, say so and simplify the header')
      .toBeLessThan(GRAPHIC_FLOOR);
  });
});
