import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const meta = {
  title: 'Primitives/Popover',
  component: PopoverContent,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'laptop' } },
} satisfies Meta<typeof PopoverContent>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A menu beside its trigger: Escape or a press outside closes it, and focus
 *  goes back to the trigger. */
export const Menu: Story = {
  render: () => (
    <div className="grid min-h-[480px] place-items-center bg-page p-4">
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="fit" aria-label="agent actions">⋯</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="agent actions">
          <div className="grid gap-1">
            <Button variant="ghost">Skip agent</Button>
            <Button variant="danger">Stop agent</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

/** Against the right edge: the panel shifts back inside the viewport, keeping
 *  16px of room, instead of running off it. */
export const AtTheEdge: Story = {
  render: () => (
    <div className="flex min-h-[480px] items-start justify-end bg-page p-1">
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="fit" aria-label="agent actions">⋯</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="agent actions" align="start">
          <div className="grid gap-1">
            <Button variant="ghost">Skip agent</Button>
            <Button variant="danger">Stop agent</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
};
