// The danger-ghost's lift and press on the dead banner are grounds of their
// own, measured against the banner's tint (D-5574; the coordinator's ruling on
// D-5495's note).
//
// WHAT WAS MEASURED. The danger-ghost sits on one ground in the app: the fleet
// host's dead banner, `--status-dead-tint-solid`. It lifted to `--bg-hover`
// and sank to `--bg-pressed` (D-5495), the neutral grounds Task 9 derived over
// the CARD (D-5101). Against the banner tint they barely register: in
// Phosphor Daylight the pressed ground measures 1.00 against the banner at
// rest, and in Phosphor & Ink the hover is 1.03, darker than the banner it
// replaces, with the press (1.08) landing lighter than the hover. The feedback
// was a hue shift from red to grey and little else.
//
// THE GROUNDS. On the dead banner the danger-ghost lifts and sinks to two
// derivations of the banner's tint, mixed toward `--ink-on-danger` (35% and
// 70% in :root, 60% and 95% in a light palette). That ink is the one the
// danger FILL carries, so it sits on the far side of the banner from the
// label in every palette: a red-black in the dark ones, white in the light
// ones. The step therefore moves away from `--status-dead-text` and from the `--status-dead` hairline,
// and both only gain contrast; a step toward `--ink-primary` (Task 9's recipe,
// over the tint) cost the label its 4.5 in Phosphor Daylight (4.37 at 5%) and
// the hairline its 3:1 in Nord, Dracula and One Dark. The dark palettes keep
// the red; the light ones go paler, the only direction their label leaves room
// for (4.81 at rest against a 4.5 floor).
//
// THE LIGHT PALETTES MIX FURTHER (D-5688). At 35% and 70% the light
// palettes' hover sat under each palette's own card hover step (1.065 to
// 1.076 against 1.080 to 1.102), fainter than the lift every other row and
// button gives. A light palette re-declares the pair at 60% and 95%: the
// hover 1.113 or more from the banner, at least that palette's card step, and
// the press 1.063 or more from the hover. 95%, not 100%: a press of the bare
// --ink-on-danger is the page's own white in GitHub Light, a hole in the
// banner rather than a ground on it. The dark palettes keep :root's 35/70.
//
// ON THE VARIANT, NOT THE BANNER (D-5688, D-5689). D-5575 re-scoped the two
// names on the banner because `hover-states.test.ts` was frozen for #627.
// #627 has landed, so the grounds are the danger-ghost's own: `Button` takes
// `ground="dead"`, and only then does the danger-ghost paint
// `bg-hover-on-dead` and `bg-pressed-on-dead`. A `ground` axis rather than
// the variant's only grounds (D-5689): the danger-ghost now also sits on the
// halt banner's amber and on the Updates screen's card rows, where a red mix
// would be a ground measured against nothing it sits on.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bannerVariants, buttonVariants } from '@ccrc/ui';
import { contrast, loadThemes, resolveColor } from '../design/audit.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, '..', rel), 'utf8');
const { DARK, byName } = loadThemes(ROOT);
const all: [string, Record<string, string>][] = [['DARK', DARK], ...Object.entries(byName)];
type RGBA = ReturnType<typeof resolveColor>;
const LIGHT_MODE = new Set(['light', 'github-light', 'solarized-light', 'catppuccin-latte']);

const HOVER = 'var(--bg-hover-on-dead)';
const PRESSED = 'var(--bg-pressed-on-dead)';
const REST = 'var(--status-dead-tint-solid)';

/** The floors a ground must clear against the banner at rest, and the press
 *  against the hover. Task 9's ghost on a card measures 1.08 to 1.16 (hover)
 *  and 1.15 to 1.30 (pressed) in the twelve palettes; these sit just under
 *  that, so a later retune keeps the steps visible without matching it. */
const HOVER_FLOOR = 1.05;
const PRESSED_FLOOR = 1.10;
const STEP_FLOOR = 1.05;

/** The mixes toward --ink-on-danger, per mode (D-5574, D-5688). */
const MIX = (p: number): string =>
  `color-mix(in srgb, var(--ink-on-danger) ${p}%, var(--status-dead-tint-solid))`;
const squash = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

describe('the danger-ghost carries the dead-banner grounds on the variant (D-5688, D-5689)', () => {
  const dead = buttonVariants({ variant: 'danger-ghost', size: 'fit', ground: 'dead' });

  it('with ground="dead" it lifts to --bg-hover-on-dead and sinks to --bg-pressed-on-dead, gated on enabled:', () => {
    expect(dead).toMatch(/(^|\s)enabled:hover:bg-hover-on-dead(\s|$)/);
    expect(dead).toMatch(/(^|\s)enabled:active:bg-pressed-on-dead(\s|$)/);
  });

  it('and carries no card ground beside them, so nothing is left for the merge to pick between', () => {
    expect(dead).not.toMatch(/(^|\s)(enabled:)?(hover:bg-hover|active:bg-pressed)(\s|$)/);
  });

  it('on its default ground it keeps the card grounds (the Updates rows, the halt banner)', () => {
    const card = buttonVariants({ variant: 'danger-ghost', size: 'fit' });
    expect(card).toMatch(/(^|\s)enabled:hover:bg-hover(\s|$)/);
    expect(card).toMatch(/(^|\s)enabled:active:bg-pressed(\s|$)/);
    expect(card).not.toMatch(/on-dead/);
  });

  it('the ground axis changes no other variant', () => {
    for (const variant of ['primary', 'danger', 'ghost', 'quiet'] as const) {
      expect(buttonVariants({ variant, ground: 'dead' }), variant).toBe(buttonVariants({ variant }));
    }
  });

  it('theme.css bridges both grounds as colours, so the utilities exist', () => {
    const theme = squash(read('ui/src/styles/theme.css'));
    expect(theme).toContain('--color-hover-on-dead: var(--bg-hover-on-dead);');
    expect(theme).toContain('--color-pressed-on-dead: var(--bg-pressed-on-dead);');
  });

  it('the dead banner no longer re-scopes --bg-hover or --bg-pressed, and neither tone does', () => {
    expect(bannerVariants({ tone: 'dead' })).not.toMatch(/--bg-(hover|pressed)/);
    expect(bannerVariants({ tone: 'attention' })).not.toMatch(/--bg-(hover|pressed)/);
  });
});

describe('the mixes, per mode (D-5574, D-5688)', () => {
  it(':root derives the pair at 35% and 70%', () => {
    const tokens = squash(read('ui/src/styles/tokens.css'));
    expect(tokens).toContain(`--bg-hover-on-dead: ${MIX(35)};`);
    expect(tokens).toContain(`--bg-pressed-on-dead: ${MIX(70)};`);
  });

  it.each(all)('%s declares the pair for its mode', (name, theme) => {
    const light = LIGHT_MODE.has(name);
    expect(squash(theme['--bg-hover-on-dead'])).toBe(MIX(light ? 60 : 35));
    expect(squash(theme['--bg-pressed-on-dead'])).toBe(MIX(light ? 95 : 70));
  });

  it('the light-mode list is every light palette tokens.css declares', () => {
    const tokens = read('ui/src/styles/tokens.css');
    const declared = Object.keys(byName).filter((n) => {
      const open = new RegExp(`\\[data-theme='${n}'\\]\\s*\\{`).exec(tokens);
      if (!open) throw new Error(`no block for ${n}`);
      return /color-scheme:\s*light/.test(tokens.slice(open.index, tokens.indexOf('}', open.index)));
    });
    expect(declared.sort()).toEqual([...LIGHT_MODE].sort());
  });
});

describe.each(all)('%s: the lift and press read as grounds, not as a hue shift', (_name, theme) => {
  const c = (e: string): RGBA => resolveColor(e, theme);
  // Resolved inside each case, so a missing token is a red case, not a
  // collection error.
  const grounds = (): { rest: RGBA; hover: RGBA; pressed: RGBA } =>
    ({ rest: c(REST), hover: c(HOVER), pressed: c(PRESSED) });

  it('both are opaque', () => {
    const { hover, pressed } = grounds();
    expect(hover[3]).toBe(1);
    expect(pressed[3]).toBe(1);
  });

  it(`the hover is ${HOVER_FLOOR} or more from the banner, the press ${PRESSED_FLOOR} or more, and the press ${STEP_FLOOR} or more from the hover`, () => {
    const { rest, hover, pressed } = grounds();
    expect(contrast(hover, rest)).toBeGreaterThanOrEqual(HOVER_FLOOR);
    expect(contrast(pressed, rest)).toBeGreaterThanOrEqual(PRESSED_FLOOR);
    expect(contrast(pressed, hover)).toBeGreaterThanOrEqual(STEP_FLOOR);
  });

  it('in a light palette the hover is at least that palette\'s card hover step (D-5688)', () => {
    if (!LIGHT_MODE.has(_name)) return;
    const { rest, hover } = grounds();
    const card = contrast(c('var(--bg-hover)'), c('var(--bg-surface)'));
    expect(contrast(hover, rest)).toBeGreaterThanOrEqual(card);
  });

  it('both step away from the label, so the label and the hairline only gain', () => {
    const { rest, hover, pressed } = grounds();
    const label = c('var(--status-dead-text)');
    const hairline = c('var(--status-dead)');
    for (const g of [hover, pressed]) {
      expect(contrast(label, g)).toBeGreaterThanOrEqual(contrast(label, rest));
      expect(contrast(label, g)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hairline, g)).toBeGreaterThanOrEqual(3);
    }
  });

  it('a dark palette keeps the red in the press; a light one goes paler', () => {
    const { rest, pressed } = grounds();
    const lum = (x: RGBA): number => x[0] + x[1] + x[2];
    if (LIGHT_MODE.has(_name)) expect(lum(pressed)).toBeGreaterThan(lum(rest));
    else {
      expect(lum(pressed)).toBeLessThan(lum(rest));
      expect(pressed[0]).toBeGreaterThan(pressed[2]);
    }
  });
});

describe('the neutral grounds were the defect (the trap this file closes)', () => {
  it('Task 9\'s --bg-pressed measures under the floor against the banner in Phosphor Daylight', () => {
    const light = byName['light']!;
    const r = contrast(resolveColor('var(--bg-pressed)', light), resolveColor(REST, light));
    expect(r).toBeLessThan(PRESSED_FLOOR);
    expect(r).toBeLessThan(1.01);
  });

  it("Task 9's --bg-hover measures under the floor against the banner in Phosphor & Ink", () => {
    const r = contrast(resolveColor('var(--bg-hover)', DARK), resolveColor(REST, DARK));
    expect(r).toBeLessThan(HOVER_FLOOR);
  });
});

describe('the colour gate measures them per palette', () => {
  const gate = read('pwa/design/contrast-check.mjs');
  it('names both grounds', () => {
    expect(gate).toMatch(/hoverOnDead: of\('--bg-hover-on-dead'\)/);
    expect(gate).toMatch(/pressedOnDead: of\('--bg-pressed-on-dead'\)/);
  });
  it('gates the label at 4.5 and the hairline at 3 on both, and the steps at their floors', () => {
    expect(gate).toMatch(/T\.deadText, T\.hoverOnDead, 4\.5\]/);
    expect(gate).toMatch(/T\.deadText, T\.pressedOnDead, 4\.5\]/);
    expect(gate).toMatch(/T\.dead, T\.hoverOnDead, 3\]/);
    expect(gate).toMatch(/T\.dead, T\.pressedOnDead, 3\]/);
    expect(gate).toMatch(/T\.hoverOnDead, T\.deadTintSolid, 1\.05\]/);
    expect(gate).toMatch(/T\.pressedOnDead, T\.deadTintSolid, 1\.1\]/);
    expect(gate).toMatch(/T\.pressedOnDead, T\.hoverOnDead, 1\.05\]/);
  });
});
