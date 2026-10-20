// The Sheet honours reduced motion (D-5930).
//
// WHAT WENT WRONG. vaul animates its panel and its overlay with KEYFRAMES
// (`slideFromBottom`, `fadeIn` and their closing pair), at an unlayered
// `animation-duration: .5s`. The Sheet retimed them with TRANSITION utilities
// (`duration-sheet!`, `ease-spring!`), which a keyframe animation never reads,
// so the panel slid for vaul's half second whatever the tokens said, and under
// `prefers-reduced-motion: reduce` (where `tokens.css` sets `--dur-sheet` to
// 1ms) it still slid. The command palette had already been retimed on the
// keyframes (D-5457), with its own private recipe.
//
// THE FIX. One helper, `ui/src/lib/motion.ts`: `VAUL_MOTION` puts vaul's
// keyframes on four variables, and each surface sets those variables from the
// tokens (`SHEET_MOTION_VARS`, `PALETTE_MOTION_VARS`). Every class is written
// literally, because Tailwind emits CSS only for the class tokens it can read
// in the source. jsdom lays out nothing and computes no animation, so this file
// holds the classes; `browser/vaul-motion.browser.test.tsx` holds the timing a
// real Chrome computes from them.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Sheet } from '@ccrc/ui';
import { PALETTE_MOTION } from '../../ui/src/primitives/command-palette';
import { PALETTE_MOTION_VARS, SHEET_MOTION_VARS, VAUL_MOTION } from '../../ui/src/lib/motion';

afterEach(cleanup);

const MOTION_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'lib', 'motion.ts');
const tokens = (s: string): string[] => s.split(/\s+/).filter(Boolean);

const openSheet = (): { panel: HTMLElement; overlay: HTMLElement } => {
  render(<Sheet open onClose={() => {}} title="A sheet"><p>body</p></Sheet>);
  const panel = document.querySelector<HTMLElement>('.sheet-panel');
  const overlay = document.querySelector<HTMLElement>('[data-testid="sheet-overlay"]');
  expect(panel, 'the open sheet renders its panel').not.toBeNull();
  expect(overlay, 'the open sheet renders its overlay').not.toBeNull();
  return { panel: panel!, overlay: overlay! };
};

describe("the Sheet's motion is vaul's keyframes on the tokens (D-5930)", () => {
  it('the panel and the overlay carry VAUL_MOTION and SHEET_MOTION_VARS', () => {
    const { panel, overlay } = openSheet();
    for (const [name, el] of [['panel', panel], ['overlay', overlay]] as const) {
      const cls = tokens(el.className);
      for (const c of [...tokens(VAUL_MOTION), ...tokens(SHEET_MOTION_VARS)]) expect(cls, `${name}: ${c}`).toContain(c);
    }
  });

  // vaul's snap-back after a short drag is an inline TRANSITION, not a keyframe, so the retime must reach both.
  // It does so from VAUL_MOTION's variables, not from a transition utility of the Sheet's own.
  it("the panel retimes vaul's drag transition from VAUL_MOTION's variables, and no duration-sheet! utility remains", () => {
    const { panel } = openSheet();
    const cls = tokens(panel.className);
    const retime = /^data-\[state=(open|closed)\]:\[transition-(duration|timing-function):var\(--vaul-(in|out)-(dur|curve)\)\]!$/;
    expect(cls.map((c) => retime.exec(c)?.slice(1).join(' ')).filter(Boolean), 'the transition retime').toEqual([
      'open duration in dur', 'open timing-function in curve',
      'closed duration out dur', 'closed timing-function out curve',
    ]);
    for (const c of ['data-[state=open]:duration-sheet!', 'data-[state=open]:ease-spring!',
      'data-[state=closed]:duration-slow!', 'data-[state=closed]:ease-swift!']) {
      expect(cls, c).not.toContain(c);
    }
    expect(cls.filter((c) => /(^|:)(duration|ease)-[a-z]+!$/.test(c)), 'a transition retime on the panel').toEqual([]);
  });

  it('motion.ts contains no template literal or ${ (every class is literal, so Tailwind emits it)', () => {
    const src = readFileSync(MOTION_SRC, 'utf8');
    expect(src.includes('`'), 'a backtick in motion.ts').toBe(false);
    expect(src.includes('${'), 'an interpolation in motion.ts').toBe(false);
  });

  it('PALETTE_MOTION starts with VAUL_MOTION and sets its pace with PALETTE_MOTION_VARS', () => {
    expect(PALETTE_MOTION.startsWith(VAUL_MOTION)).toBe(true);
    expect(PALETTE_MOTION).toBe(VAUL_MOTION + ' ' + PALETTE_MOTION_VARS);
  });

  // NO CLASS IS SPELLED WHOLE IN THIS FILE. Tailwind's source detection reads
  // the test tree too, so a whole class here would keep its CSS in the build
  // and hide a class 'motion.ts' stopped spelling (the browser leg's mutant).
  // The rows below parse the helper's classes instead.
  it("VAUL_MOTION times vaul's keyframes and its drag transition in both states from the four variables, important over vaul", () => {
    const shape = /^data-\[state=(open|closed)\]:\[(animation|transition)-(duration|timing-function):var\(--vaul-(in|out)-(dur|curve)\)\]!$/;
    expect(tokens(VAUL_MOTION).map((c) => shape.exec(c)?.slice(1).join(' ') ?? `unparsed: ${c}`)).toEqual([
      'open animation duration in dur', 'open animation timing-function in curve',
      'closed animation duration out dur', 'closed animation timing-function out curve',
      'open transition duration in dur', 'open transition timing-function in curve',
      'closed transition duration out dur', 'closed transition timing-function out curve',
    ]);
  });

  it('SHEET_MOTION_VARS and PALETTE_MOTION_VARS set the four variables from the tokens the spec names', () => {
    const shape = /^\[--vaul-(in|out)-(dur|curve):var\(--((?:dur|curve)-[a-z]+)\)\]$/;
    const read = (s: string): string[] => tokens(s).map((c) => shape.exec(c)?.slice(1).join(' ') ?? `unparsed: ${c}`);
    expect(read(SHEET_MOTION_VARS)).toEqual(['in dur dur-sheet', 'in curve curve-spring', 'out dur dur-slow', 'out curve curve-swift']);
    expect(read(PALETTE_MOTION_VARS)).toEqual(['in dur dur-base', 'in curve curve-swift', 'out dur dur-fast', 'out curve curve-swift']);
  });
});
