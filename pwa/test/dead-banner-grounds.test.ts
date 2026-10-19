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
// THE GROUNDS. The banner re-scopes `--bg-hover` and `--bg-pressed` for what
// it holds to two derivations of its own tint, mixed toward `--ink-on-danger`
// (35% and 70%). That ink is the one the danger FILL carries, so it sits on
// the far side of the banner from the label in every palette: a red-black
// in the dark ones, white in the light ones. The step therefore
// moves away from `--status-dead-text` and from the `--status-dead` hairline,
// and both only gain contrast; a step toward `--ink-primary` (Task 9's recipe,
// over the tint) cost the label its 4.5 in Phosphor Daylight (4.37 at 5%) and
// the hairline its 3:1 in Nord, Dracula and One Dark. The dark palettes keep
// the red; the light ones go paler, the only direction their label leaves room
// for (4.81 at rest against a 4.5 floor).
//
// WHY ON THE BANNER, NOT ON THE VARIANT (D-5575). `hover-states.test.ts` pins
// the danger-ghost's class tail to `enabled:hover:bg-hover
// enabled:active:bg-pressed`, and #627 edits that file, so it is frozen here.
// The utilities read `var(--bg-hover)` where they paint (`theme.css` bridges
// them `@theme inline`), so the banner redefining the two names for its
// subtree changes the ground and leaves the variant's classes as they were.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bannerVariants } from '@ccrc/ui';
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

describe('the dead banner re-scopes the lift and press grounds (D-5574, D-5575)', () => {
  it('its dead tone redefines --bg-hover and --bg-pressed for what it holds', () => {
    const cls = bannerVariants({ tone: 'dead' });
    expect(cls).toMatch(/(^|\s)\[--bg-hover:var\(--bg-hover-on-dead\)\](\s|$)/);
    expect(cls).toMatch(/(^|\s)\[--bg-pressed:var\(--bg-pressed-on-dead\)\](\s|$)/);
  });

  it('the attention tone does not, since it holds no lifted control', () => {
    expect(bannerVariants({ tone: 'attention' })).not.toMatch(/--bg-(hover|pressed)/);
  });

  it('tokens.css derives both from the banner tint, toward the danger fill\'s ink', () => {
    const tokens = read('ui/src/styles/tokens.css');
    const squash = (s: string): string => s.replace(/\s+/g, ' ');
    expect(squash(tokens)).toContain(
      '--bg-hover-on-dead: color-mix(in srgb, var(--ink-on-danger) 35%, var(--status-dead-tint-solid));');
    expect(squash(tokens)).toContain(
      '--bg-pressed-on-dead: color-mix(in srgb, var(--ink-on-danger) 70%, var(--status-dead-tint-solid));');
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
