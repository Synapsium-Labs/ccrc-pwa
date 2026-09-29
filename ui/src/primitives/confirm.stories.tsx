import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './button';
import { QuickConfirm } from './confirm';

const meta = {
  title: 'Primitives/QuickConfirm',
  component: QuickConfirm,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'phone' } },
  // As in the Sheet stories: <Demo/> owns `open`, so these are only here to
  // satisfy the required props.
  args: {
    open: true,
    onClose: () => {},
    title: '',
    consequence: '',
    confirmLabel: '',
    onConfirm: () => {},
  },
} satisfies Meta<typeof QuickConfirm>;
export default meta;

type Story = StoryObj<typeof meta>;

function Demo(props: Omit<React.ComponentProps<typeof QuickConfirm>, 'open' | 'onClose'>) {
  const [open, setOpen] = useState(true);
  return (
    <div className="grid min-h-[600px] place-items-center bg-page p-4">
      <div className="w-[240px]">
        <Button onClick={() => setOpen(true)}>Ask again</Button>
      </div>
      <QuickConfirm {...props} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** The consequence sentence carries the weight, in plain language. A confirm
 *  that only restates the verb ("Stop this session?") tells the operator
 *  nothing they did not already know when they tapped. */
export const Stop: Story = {
  render: () => (
    <Demo
      title="Stop claude-3?"
      consequence="The turn in flight is lost. The workspace and its branch stay exactly where they are, and you can start the session again from the same place."
      confirmLabel="Stop the session"
      onConfirm={() => {}}
    />
  ),
};

export const MoveAccount: Story = {
  render: () => (
    <Demo
      title="Move to claude?"
      consequence="The session keeps its history and its workspace; only the wrapper changes. Its 5h window on the current account stays spent."
      confirmLabel="Move it"
      onConfirm={() => {}}
    />
  ),
};
