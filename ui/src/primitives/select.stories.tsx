// The three shapes a chooser takes in this console, which no single call site
// shows: stacked in a sheet's routing row, sized to its own options in the
// fleet head, and disabled while the thing it chooses for is unreachable.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from './select';

const meta = {
  title: 'Primitives/Select',
  component: Select,
  parameters: {
    docs: {
      description: {
        component:
          'The dropdown this system could not render. Two app files wore `.route-select`, a '
          + 'fleet.css rule, and the second had to undo that rule’s `width: 100%` — with a '
          + 'single-class override that lost the tie to source order and never applied once, '
          + 'rendering the control 286px wide instead of 167px. As a utility string the width '
          + 'is not overridden but REMOVED: `cn` is tailwind-merge, so a caller’s `w-auto` is '
          + 'the only width utility that survives. The chrome is `TextInput`’s, token for '
          + 'token; the appearance is deliberately NOT reset, because the native control is '
          + 'the one every mobile platform knows how to open.',
      },
    },
  },
} satisfies Meta<typeof Select>;
export default meta;

type Story = StoryObj<typeof meta>;

const CLASSES = (
  <>
    <option value="">Coordinator row</option>
    <option value="default">Default</option>
    <option value="haiku">Haiku</option>
    <option value="sonnet">Sonnet</option>
    <option value="opus">Opus</option>
  </>
);

/** Stacked in a sheet: full width, the grid cell decides how wide that is.
 *  This is `NewSessionSheet`'s routing row, three fields deep. */
export const InAField: Story = {
  args: { 'aria-label': 'Wrapper', defaultValue: 'sonnet', children: CLASSES },
};

/** Sized to its own option list — the fleet head's class chooser. `w-auto`
 *  does not out-specify anything; it replaces `w-full` before the class
 *  string is ever rendered. */
export const SizedToItsOptions: Story = {
  args: {
    'aria-label': 'Class',
    className: 'w-auto flex-none max-w-full',
    defaultValue: '',
    children: CLASSES,
  },
};

/** Disabled: the UA greys the control, and the tap floor stays — an inert
 *  control still occupies the row it sits in. */
export const Disabled: Story = {
  args: { 'aria-label': 'Class', disabled: true, defaultValue: 'opus', children: CLASSES },
};
