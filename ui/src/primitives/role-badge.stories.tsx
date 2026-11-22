import type { Meta, StoryObj } from '@storybook/react-vite';
import { RoleBadge } from './role-badge';

const meta = {
  title: 'Primitives/RoleBadge',
  component: RoleBadge,
  parameters: { layout: 'padded' },
  args: { icon: 'network', label: 'coordinator', title: 'this session is its project\'s coordinator' },
} satisfies Meta<typeof RoleBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The badge alone. CHECK it is 16px square, strokes in the ink around it, and carries the accessible name
 *  "coordinator" with the role's meaning on hover. */
export const Alone: Story = {};

/** Where it lands: first on a session row's context line, in the programme's hue. CHECK the picture reads as the
 *  same language as the programme box's icon, and that the line keeps its height. */
export const OnARow: Story = {
  render: (args) => (
    <div className="flex items-center gap-2 font-mono text-2xs text-ink-secondary" style={{ color: 'var(--prog-cyan)' }}>
      <RoleBadge {...args} />
      <span className="text-ink-secondary">main</span>
    </div>
  ),
};
