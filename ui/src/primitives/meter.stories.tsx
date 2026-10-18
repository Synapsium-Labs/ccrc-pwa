import type { Meta, StoryObj } from '@storybook/react-vite';
import { Meter } from './meter';

/** The ONE usage meter (D-5098). Its shape is the skin's: Refined draws a
 *  continuous 5px bar, Instrument ten 8px LED segments with 2px gaps (switch
 *  the toolbar's skin). Its colours are the palette's `--limit-*`. */
const meta = {
  title: 'Primitives/Meter',
  component: Meter,
  args: { pct: 64, band: 'warn' },
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="grid w-[280px]">{Story()}</div>],
} satisfies Meta<typeof Meter>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The three bands, then `off` (a lane whose readings stopped: same 91%, no
 *  longer claiming live pressure), then the two zeros that are not the same
 *  fact: a measured 0% (a zero-width fill) and never measured (no fill). */
export const States: Story = {
  render: () => (
    <div className="grid gap-4">
      {(
        [
          ['ok — 22%', 22, 'ok', false],
          ['warn — 58%', 58, 'warn', false],
          ['crit — 91%', 91, 'crit', false],
          ['off — 91%, readings stopped', 91, 'crit', true],
          ['measured 0%', 0, 'ok', false],
          ['never measured', null, 'none', false],
        ] as const
      ).map(([label, pct, band, off]) => (
        <div key={label} className="grid gap-1.5">
          <span className="font-mono text-2xs text-ink-tertiary">{label}</span>
          <Meter pct={pct} band={band} off={off} />
        </div>
      ))}
    </div>
  ),
};

/** Three widths a meter actually renders at: a picker gauge (~90px), a phone
 *  strip (~120px) and a wide top strip (~230px). Under Instrument each must
 *  still read as segments. */
export const Widths: Story = {
  render: () => (
    <div className="grid gap-4">
      {[90, 120, 230].map((w) => (
        <div key={w} className="grid gap-1.5" style={{ width: w }}>
          <span className="font-mono text-2xs text-ink-tertiary">{w}px</span>
          <Meter pct={70} band="warn" />
        </div>
      ))}
    </div>
  ),
};
