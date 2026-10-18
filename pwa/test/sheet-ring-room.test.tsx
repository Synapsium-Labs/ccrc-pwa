// The keyboard ring is never cut by the bottom sheet's scroll box (D-5495).
//
// WHAT WENT WRONG. `.sheet-body` scrolls (`overflow-y: auto`), and a box that
// scrolls on one axis clips on both, so it is a clip edge on its left and
// right. A full-width control inside it (the ask sheet's options, a picker's
// rows, a sheet's ghost buttons) sits flush with that edge, and `FOCUS_RING`
// draws 2px of outline 2px outside the control: the ring's two sides were cut
// off, so a keyboard user saw a top and bottom bar and no box. Measured in
// Storybook (`Primitives/Sheet`, WithEyebrow) at 360, 390, 1280 and 1920 wide,
// both skins, both Phosphor palettes: the ring overran the body by 4px on each
// side in all sixteen.
//
// THE FIX. The scrolling body gives itself an inline gutter of the ring's
// reach and takes it back with a negative margin of the same size, so the
// content box (and every row's width) is where it was and the clip edge moves
// out by exactly what the ring needs. jsdom lays nothing out, so this holds the
// arithmetic: the gutter's step is the ring's width plus its offset.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Button, FOCUS_RING, Sheet } from '@ccrc/ui';

afterEach(cleanup);

const tokens = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
const px = (name: string): number => {
  const m = tokens.match(new RegExp(`${name}:\\s*(\\d+)px`));
  expect(m, `${name} is not a px length in tokens.css`).not.toBeNull();
  return Number(m![1]);
};

/** The ring's reach outside its control, in px: outline width plus offset.
 *  Tailwind's bare `outline-<n>` and `outline-offset-<n>` are px. */
const ringReach = (): number => {
  const w = FOCUS_RING.match(/focus-visible:outline-(\d+)(\s|$)/);
  const o = FOCUS_RING.match(/focus-visible:outline-offset-(\d+)(\s|$)/);
  expect(w && o, 'FOCUS_RING no longer spells a px width and offset').toBeTruthy();
  return Number(w![1]) + Number(o![1]);
};

const bodyClasses = (full: boolean): string[] => {
  render(
    <Sheet open onClose={() => {}} title="Pick one" full={full}>
      <Button variant="ghost">An option</Button>
    </Sheet>,
  );
  const body = document.querySelector('.sheet-body');
  expect(body).not.toBeNull();
  return [...body!.classList];
};

describe("the sheet's scroll box leaves the focus ring room (D-5495)", () => {
  it('the scrolling body carries an inline gutter of the ring\'s reach, taken back by a negative margin', () => {
    const cls = bodyClasses(false);
    expect(cls).toContain('overflow-y-auto');
    // `px-1` / `-mx-1` resolve to `--spacing-1`, which theme.css maps to --sp-1.
    expect(cls).toContain('px-1');
    expect(cls).toContain('-mx-1');
    expect(px('--sp-1'), 'the gutter step no longer equals the ring reach').toBe(ringReach());
  });

  it('the full-height well, which does not scroll its body, is left as it was', () => {
    const cls = bodyClasses(true);
    expect(cls).toContain('overflow-hidden');
    expect(cls).not.toContain('px-1');
    expect(cls).not.toContain('-mx-1');
  });
});
