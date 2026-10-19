import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextLink } from './text-link';

const meta = {
  title: 'Primitives/TextLink',
  component: TextLink,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TextLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A pull-request number at the end of a release note. CHECK the link is the
 *  line's own ink, told apart by its underline alone, and that Tab shows the
 *  phosphor ring around the word and nothing else. */
export const InALine: Story = {
  args: { href: 'https://example.com/pull/626', children: '#626' },
  render: (args) => (
    <p className="max-w-[40ch] text-sm text-ink-secondary">
      The command palette and shortcuts <TextLink {...args} />
    </p>
  ),
};
