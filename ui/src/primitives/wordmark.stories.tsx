import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
// The fleet head's own rules, read from the app's stylesheet rather than
// re-typed here: the play test compares the primitive with what `main`'s head
// renders today, so a copy of `.wordmark` in this file would be a second
// definition that could agree with the primitive and disagree with the app.
import fleetCss from '../../../pwa/src/fleet/fleet.css?raw';
import { THEMES, applyTheme } from '../styles/themes';
import { SKINS, applySkin, resolveSkin } from '../styles/skins';
import { Wordmark } from './wordmark';

const meta = {
  title: 'Primitives/Wordmark',
  component: Wordmark,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Wordmark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.wordmark` and `.wordmark::before`, exactly as fleet.css declares them. */
const HEAD_RULES = [...fleetCss.matchAll(/\.wordmark(?:::before)?\s*\{[^}]*\}/g)]
  .map((m) => m[0]).join('\n');

/** CHECK the caret against the fleet head beside it: the same phosphor, the
 *  same mono at medium weight, the same size, and the same 0.4em between the
 *  two. Switch the Skin toolbar: nothing moves, because the mark is the
 *  identity core and a skin varies density, structure and chrome only. Switch
 *  the Theme toolbar: the caret is the palette's accent in every one. At
 *  360 wide the mark stays on one line. */
export const Default: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--sp-4)', justifyItems: 'start' }}>
      <style>{HEAD_RULES}</style>
      <Wordmark {...args} />
      {/* The fleet head's mark on `main`, for comparison: `FleetHead.tsx`'s
          `<span className="wordmark">ccrc</span>`, styled by fleet.css. */}
      <span className="wordmark" data-testid="head">ccrc</span>
      <span data-testid="probe" style={{ color: 'var(--accent)' }} aria-hidden="true" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const mark = canvasElement.querySelector<HTMLElement>('[data-wordmark]');
    const head = canvasElement.querySelector<HTMLElement>('[data-testid="head"]');
    const probe = canvasElement.querySelector<HTMLElement>('[data-testid="probe"]');
    if (mark === null || head === null || probe === null) throw new Error('story did not render');
    const caret = mark.firstElementChild as HTMLElement;
    const name = mark.lastElementChild as HTMLElement;
    const root = document.documentElement;
    const startTheme = root.getAttribute('data-theme');
    const startSkin = resolveSkin(root.getAttribute('data-skin') ?? undefined);
    try {
      for (const skin of SKINS) {
        applySkin(skin.id, root);
        // The caret is the accent in every palette, and the name the head's ink.
        for (const theme of THEMES) {
          applyTheme(theme.id, root, false);
          const accent = getComputedStyle(probe).color;
          await expect(getComputedStyle(caret).color, `${skin.id} ${theme.id} caret`).toBe(accent);
          await expect(getComputedStyle(head, '::before').color, `${theme.id} head caret`).toBe(accent);
          await expect(getComputedStyle(name).color).toBe(getComputedStyle(head).color);
        }
        // The name is in mono at medium weight at today's size: the head's.
        const m = getComputedStyle(mark);
        const h = getComputedStyle(head);
        await expect(m.fontFamily, `${skin.id} family`).toBe(h.fontFamily);
        await expect(m.fontWeight, `${skin.id} weight`).toBe(h.fontWeight);
        await expect(m.fontSize, `${skin.id} size`).toBe(h.fontSize);
        await expect(m.lineHeight, `${skin.id} line-height`).toBe(h.lineHeight);
        // The gap is the head's 0.4em margin, in pixels.
        await expect(m.columnGap, `${skin.id} gap`)
          .toBe(getComputedStyle(head, '::before').marginRight);
        // One line: the caret and the name share a top edge.
        await expect(Math.abs(caret.getBoundingClientRect().top - name.getBoundingClientRect().top))
          .toBeLessThan(2);
      }
    } finally {
      if (startTheme === null) applyTheme(THEMES[0]?.id ?? '', root, false);
      else applyTheme(startTheme, root, false);
      applySkin(startSkin, root);
    }
  },
};
