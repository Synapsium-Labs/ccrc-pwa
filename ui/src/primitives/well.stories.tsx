import type { Meta, StoryObj } from '@storybook/react-vite';
import { Well } from './well';

const meta = {
  title: 'Primitives/Well',
  component: Well,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Well>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The surface, as `ToolCard` shows a tool's input. CHECK that it is dark in
 *  EVERY palette — `--bg-well` is one of the few tokens that does not flip in
 *  a light theme, because a terminal that goes white stops reading as one. */
export const Default: Story = {
  args: { children: 'git rev-list --left-right --count origin/main...HEAD\n0\t27' },
};

/** CHECK that long unbroken output WRAPS rather than widening the card. A
 *  session id or a base64 blob has no spaces to break at, which is why the
 *  rule is `overflow-wrap: anywhere` and not `break-word`. */
export const UnbrokenOutput: Story = {
  args: {
    children:
      'ccrc-pwa-clear-cove-7f3a9c2e4b1d8a60f5c3e9b7a2d4f6180c5e3a9b7d1f4c6e8a0b2d4f6180c5e3a9b',
  },
};

/** CHECK that it stops growing and scrolls instead — `--well-max`. The card
 *  around a well must stay readable when a command prints a thousand lines. */
export const Tall: Story = {
  args: {
    children: Array.from({ length: 60 }, (_, i) => `line ${String(i + 1).padStart(3, '0')}`).join('\n'),
  },
};

/** CHECK that the shortest possible body still looks like a surface and not
 *  like a typo — this is what a tool that printed nothing renders. */
export const Empty: Story = { args: { children: '(no output)' } };
