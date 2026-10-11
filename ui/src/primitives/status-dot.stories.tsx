import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SessionBucket } from '../../../shared/api';
import { StatusDot } from './status-dot';

const meta = {
  title: 'Primitives/StatusDot',
  component: StatusDot,
  argTypes: {
    status: {
      control: 'select',
      options: ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'],
    },
  },
  args: { status: 'working' },
} satisfies Meta<typeof StatusDot>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Working: Story = {};

const ALL: readonly SessionBucket[] = [
  'attention',
  'working',
  'done',
  'idle',
  'cleanup',
  'archived',
  'dead',
];

/** Every bucket at once. Two things to check here, and neither is the colour:
 *  only `attention` and `working` emit light (GLOW MEANS LIFE), and every
 *  bucket is separable with the hue removed — that is the two-glyph rule, and
 *  it is what keeps `done` from fusing with `idle`. */
export const AllBuckets: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <table className="font-mono text-sm text-ink-secondary">
      <tbody>
        {ALL.map((s) => (
          <tr key={s}>
            <td className="py-2 pr-4">
              <StatusDot status={s} />
            </td>
            <td className="py-2 pr-6 text-ink-primary">{s}</td>
            <td className="py-2 text-ink-tertiary">
              {s === 'attention' || s === 'working' ? 'glows — alive' : 'matte'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

/** The dots also sit on --bg-well lamp floors, a different ground with its own
 *  3:1 floor. Both grounds ship, so both are drawn. */
export const OnLampWell: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex gap-3 rounded-md bg-well p-4">
      {ALL.map((s) => (
        <span key={s} className="grid size-lamp place-items-center rounded-full bg-well">
          <StatusDot status={s} />
        </span>
      ))}
    </div>
  ),
};
