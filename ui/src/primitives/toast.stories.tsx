import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Button } from './button';
import { ToastHost, toast } from './toast';

const meta = {
  title: 'Primitives/Toast',
  component: ToastHost,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'phone' } },
} satisfies Meta<typeof ToastHost>;
export default meta;

type Story = StoryObj<typeof meta>;

function Stage({ fire, label }: { fire: () => void; label: string }) {
  useEffect(() => {
    fire();
  }, [fire]);
  return (
    <div className="grid min-h-[600px] place-items-center bg-page p-4">
      <div className="w-[240px]">
        <Button onClick={fire}>{label}</Button>
      </div>
      <ToastHost />
    </div>
  );
}

/** Announces politely — role=status, so a screen reader finishes its sentence
 *  first. */
export const Info: Story = {
  render: () => <Stage label="Fire it again" fire={() => toast('Moved to claude.')} />,
};

/** Interrupts — role=alert — and wears the dead-red edge plus a mono bang. Two
 *  cues, never colour alone. */
export const Error: Story = {
  render: () => (
    <Stage
      label="Fire it again"
      fire={() => toast('Could not reach the fleet host.', 'error')}
    />
  ),
};

/** An action toast STICKS until answered. An offer that vanishes mid-reach is
 *  worse than no offer. */
export const WithAction: Story = {
  render: () => (
    <Stage
      label="Fire it again"
      fire={() =>
        toast('Upload failed.', 'error', { label: 'Retry', onClick: () => toast('Retrying…') })
      }
    />
  ),
};
