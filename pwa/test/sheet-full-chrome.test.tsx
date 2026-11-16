// The full-height sheet (the terminal drawer) keeps main's chrome.
//
// FOUR PROPERTIES DRIFTED when the sheet moved into @ccrc/ui, measured in a
// rendered build at 390 and 1366, dark and light (`.sheet-panel--full`):
//
//   z-index           50 -> 40   the panel carried BOTH `z-sheet` and
//                                `z-drawer`; cn() cannot tell custom z
//                                utilities apart, so both survived, and
//                                Tailwind emits custom utilities in name order
//                                — `.z-sheet` after `.z-drawer`, so it won.
//   top corners       22px -> 0  main's `.sheet-panel--full` inherited
//   box-shadow        lift -> none  `.sheet-panel`'s radius and shadow
//   grabber ground    ink-on-well 30% -> #e2e2e4, margin-top 4px -> 0
//                                vaul injects an UNLAYERED
//                                `[data-vaul-handle]{background:#e2e2e4}`,
//                                which beats a layered utility; main's
//                                `.sheet-panel--full .sheet-grabber` won on
//                                specificity.
//
// jsdom applies no stylesheet, so what is pinned here is the class contract
// that produces those values — and, for the grabber, the vaul rule that makes
// the `!` necessary, read from the style element vaul itself injects.
//
// MEASURED (baseline green): `z-sheet` back on the shared base string -> 1 red;
// `rounded-t-xl` or `shadow-sheet` dropped from the full arm -> 1 red; the
// handle's `!` dropped -> 1 red; `mt-1` dropped -> 1 red.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Sheet } from '@ccrc/ui';

afterEach(cleanup);

const panel = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.sheet-panel');
  if (el === null) throw new Error('no sheet panel rendered');
  return el;
};
const zUtilities = (el: HTMLElement): string[] =>
  [...el.classList].filter((c) => /^z-/.test(c));

describe('the full-height sheet keeps main\'s chrome', () => {
  it('stacks on --z-drawer alone, above every ordinary sheet', () => {
    render(<Sheet open full onClose={() => {}} title="Terminal"><div /></Sheet>);
    expect(zUtilities(panel())).toEqual(['z-drawer']);
  });

  it('an ordinary sheet stacks on --z-sheet alone', () => {
    render(<Sheet open onClose={() => {}} title="Pick one"><div /></Sheet>);
    expect(zUtilities(panel())).toEqual(['z-sheet']);
  });

  it('keeps the r-xl top corners and the lift shadow every sheet has', () => {
    render(<Sheet open full onClose={() => {}} title="Terminal"><div /></Sheet>);
    const cls = panel().classList;
    expect(cls.contains('rounded-t-xl'), 'square top corners on the drawer').toBe(true);
    expect(cls.contains('shadow-sheet'), 'the drawer lost its lift shadow').toBe(true);
    expect(cls.contains('bg-well')).toBe(true);
  });

  it('paints the grabber in the well\'s ink over vaul\'s unlayered default', () => {
    render(<Sheet open full onClose={() => {}} title="Terminal"><div /></Sheet>);
    const handle = document.querySelector<HTMLElement>('[data-vaul-handle]');
    expect(handle).toBeTruthy();
    // vaul really does paint the handle from an unlayered rule — the reason a
    // layered utility needs the important flag to win.
    const vaulCss = [...document.head.querySelectorAll('style')]
      .map((s) => s.textContent ?? '').join('\n');
    const rule = /\[data-vaul-handle\]\{([^}]*)\}/.exec(vaulCss)?.[1] ?? '';
    expect(rule, 'vaul no longer injects a handle rule — re-measure the grabber').toMatch(/background:/);
    expect(/@layer/.test(vaulCss), 'vaul layered its styles — the `!` may be unnecessary').toBe(false);
    const cls = [...(handle?.classList ?? [])];
    expect(cls).toContain('bg-ink-on-well/30!');
    expect(cls, "main's full grabber kept the base 4px top margin").toContain('mt-1');
  });
});
