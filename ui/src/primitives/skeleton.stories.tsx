import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from './skeleton';

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  args: { lines: 3 },
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[320px]">{Story()}</div>],
} satisfies Meta<typeof Skeleton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SingleLine: Story = { args: { lines: 1 } };

/** Loading is one of the three cross-cutting states the direction promises and
 *  the journey boards kept asserting without drawing. This is what it is. */
export const CardPlaceholder: Story = {
  render: () => (
    <div className="grid gap-3 rounded-lg bg-surface p-4">
      <Skeleton lines={2} />
      <Skeleton lines={4} />
    </div>
  ),
};
