// EmptyState (D-5102): what a page says when it has nothing to list.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { EmptyState } from './empty-state';

const meta = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  parameters: {
    docs: {
      description: {
        component:
          'One sentence at the ui role in the secondary ink, with an optional icon above it and an '
          + 'optional action under it. A screen names which emptiness it is through `data-state`.',
      },
    },
  },
  args: { children: 'Nothing yet.' },
} satisfies Meta<typeof EmptyState>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** An icon, and the way out. */
export const WithIconAndAction: Story = {
  args: {
    icon: 'mail',
    children: 'No mail. Records land here whether or not you were watching.',
    action: <Button variant="ghost" size="fit">Open the digest</Button>,
  },
};

/** The error emptiness: the screen says the read failed, not that nothing exists. */
export const ReadFailed: Story = {
  args: { children: 'Could not reach the server — mail may exist that is not shown.' },
  render: (args) => <EmptyState {...args} data-state="error" />,
};
