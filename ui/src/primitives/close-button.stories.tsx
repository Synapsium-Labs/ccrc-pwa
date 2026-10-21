import type { Meta, StoryObj } from '@storybook/react-vite';
import { CloseButton } from './close-button';

/** The close ✕ (D-5933, D-6033): the Sheet's desktop arm draws it at its top right. */
const meta = {
  title: 'Primitives/CloseButton',
  component: CloseButton,
  args: { onClick: () => {} },
} satisfies Meta<typeof CloseButton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
