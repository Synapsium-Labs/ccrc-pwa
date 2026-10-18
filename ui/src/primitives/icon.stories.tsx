import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon, type IconName } from './icon';
import { ICONS } from '../icons/lucide';

const meta = {
  title: 'Primitives/Icon',
  component: Icon,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

const NAMES = Object.keys(ICONS) as IconName[];

/** One icon at the default 16. CHECK it takes the ink of the text around it:
 *  it is stroked in `currentColor`, so it changes with every palette and owns
 *  no colour of its own in either skin. */
export const Default: Story = { args: { name: 'bell' } };

/** Every vendored icon at all three sizes, in the secondary ink. CHECK the
 *  stroke reads the same weight as the mono label beside it at 16 and 20
 *  (1.75), and does not shout at 24 (1.5). */
export const TheSet: Story = {
  args: { name: 'bell' },
  render: () => (
    <div className="grid gap-3 text-ink-secondary font-mono text-2xs" style={{ gridTemplateColumns: 'auto repeat(3, 32px)' }}>
      {NAMES.map((n) => (
        <div key={n} className="contents">
          <span>{n}</span>
          <Icon name={n} size={16} />
          <Icon name={n} size={20} />
          <Icon name={n} size={24} />
        </div>
      ))}
    </div>
  ),
};

/** Beside its word, the way every call site uses it. CHECK the icon centres on
 *  the label's line and the primary ink reaches it unchanged. */
export const BesideAWord: Story = {
  args: { name: 'mail' },
  render: () => (
    <span className="inline-flex items-center gap-1 text-ink-primary font-mono text-2xs">
      <Icon name="mail" />
      Mail
    </span>
  ),
};
