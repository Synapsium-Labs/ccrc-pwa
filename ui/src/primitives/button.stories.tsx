import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Send it' },
  argTypes: { variant: { control: 'inline-radio', options: ['primary', 'ghost'] } },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Cancel' } };

/** Disabled is a VISIBLE stand-down, not just an inert listener. An
 *  accent-filled button that ignores taps reads as broken. */
export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <div className="grid w-[320px] gap-2">
      <Button {...args} variant="primary">
        Send it
      </Button>
      <Button {...args} variant="ghost">
        Cancel
      </Button>
    </div>
  ),
};

/** The pairing as a sheet actually uses it: commit on top, way-out below. */
export const SheetActions: Story = {
  render: () => (
    <div className="grid w-[320px] gap-2">
      <Button>Stop the session</Button>
      <Button variant="ghost">Cancel</Button>
    </div>
  ),
};
