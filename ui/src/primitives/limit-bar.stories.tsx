import type { Meta, StoryObj } from '@storybook/react-vite';
import { LimitBar, TRACK, fillVariants } from './limit-bar';

const meta = {
  title: 'Primitives/LimitBar',
  component: LimitBar,
  args: { five: 32, seven: 61 },
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[280px]">{Story()}</div>],
} satisfies Meta<typeof LimitBar>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The three bands, which mirror the operator's routing policy rather than
 *  decorating: ok < 50, warn 50-75 ("prefer handoff"), critical > 75 ("hand off
 *  everything spec-able"). An amber gauge is an instruction. */
export const Bands: Story = {
  render: () => (
    <div className="grid gap-6">
      {(
        [
          ['ok — under 50', 22, 41],
          ['warn — 50 to 75', 58, 74],
          ['critical — over 75', 91, 83],
        ] as const
      ).map(([label, five, seven]) => (
        <div key={label} className="grid gap-2">
          <p className="font-mono text-2xs uppercase tracking-caps text-ink-tertiary">{label}</p>
          <LimitBar five={five} seven={seven} />
        </div>
      ))}
    </div>
  ),
};

/** An UNMEASURED lane, which is not the same fact as an empty one. It reads
 *  em-dash, never 0% — collapsing the two would be an overloaded null on the
 *  one readout an operator routes work from. */
export const Unmeasured: Story = { args: { five: null, seven: 12 } };

/** Both lanes pinned, the state a swap decision gets made against. */
export const Exhausted: Story = { args: { five: 100, seven: 100 } };

/** The fourth band. `off` is not a reading — it says the readings STOPPED.
 *
 *  A condemned lane keeps its last numbers because they are still true of the
 *  last moment anything ran there; what stops being true is the colour, since
 *  nothing is left to refresh it. Compare the two rows: same 91%, and only one
 *  of them is still claiming live pressure.
 *
 *  Its contrast against the track is 1.02–1.10 and that is a known defect,
 *  preserved deliberately and pinned by `pwa/test/limit-off-band.test.ts` —
 *  this story is where you can see what that number means. */
export const OffBand: Story = {
  render: () => (
    <div className="grid w-[260px] gap-4">
      <div className="grid gap-1.5">
        <span className="font-mono text-2xs text-ink-tertiary">live — crit</span>
        <span className={TRACK}>
          <span className={fillVariants({ band: 'crit' })} style={{ width: '91%' }} />
        </span>
      </div>
      <div className="grid gap-1.5">
        <span className="font-mono text-2xs text-ink-tertiary">
          off — sign-in expired on the fleet host
        </span>
        <span className={TRACK}>
          <span className={fillVariants({ band: 'off' })} style={{ width: '91%' }} />
        </span>
      </div>
    </div>
  ),
};
