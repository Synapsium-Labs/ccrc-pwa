// The states a one-line field actually has, which is the thing three copies of
// these declarations never showed anywhere: placeholder, filled, focused, and
// the invalid case a sheet drives through aria-invalid.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextInput } from './text-input';

const meta = {
  title: 'Primitives/TextInput',
  component: TextInput,
  parameters: {
    docs: {
      description: {
        component:
          'One line of text entry — shadcn’s Input on ccrc tokens. Three app rules declared '
          + 'this same object (`.login-input`, `.sess-hold-input`, `.proj-search`) and the '
          + 'stylesheets said so in their own comments; one of the three was missing the '
          + '`::placeholder` ink until a fix wave caught it by reading. `--fs-input` is '
          + 'load-bearing and there is deliberately no size variant: iOS Safari zooms the '
          + 'viewport on focus for any text entry under 16px.',
      },
    },
  },
} satisfies Meta<typeof TextInput>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The placeholder ink — `--ink-tertiary`, the declaration one copy lacked.
 *  On the hold field this is the only place the reason convention is shown to
 *  whoever is typing it. */
export const WithPlaceholder: Story = {
  args: { placeholder: 'program:name wave:2/4', 'aria-label': 'Hold reason' },
};

/** Filled: `--ink-primary` on `--bg-raised`, the pair
 *  `pwa/test/utility-pairs.test.ts` now derives straight from this component. */
export const Filled: Story = {
  args: { defaultValue: 'build4-conversation-and-controls', 'aria-label': 'Program slug' },
};

/** The focus cue is the phosphor on the border, not a ring — a 44px field on a
 *  phone has no room for an offset ring. Tab into it to see it. */
export const Focusable: Story = {
  args: { placeholder: 'Search projects', type: 'search', 'aria-label': 'Search projects' },
};

/** `aria-invalid` with the describedby a sheet supplies. The field itself does
 *  not repaint — the refusal is a sentence under it, which is how the program
 *  sheet reports an oversized kickoff. */
export const Invalid: Story = {
  args: {
    defaultValue: 'a-slug-long-enough-to-be-refused',
    'aria-label': 'Program slug',
    'aria-invalid': true,
    'aria-describedby': 'program-kickoff-error',
  },
};

/** The `.proj-search` extension: a bottom margin and an animated border, both
 *  passed through `className` because they are the call site's layout and
 *  motion rather than part of what an input is. `motion-reduce:transition-none`
 *  rides along — the rule it replaced was in a `prefers-reduced-motion` block. */
export const WithCallSiteExtras: Story = {
  args: {
    placeholder: 'Search projects',
    type: 'search',
    'aria-label': 'Search projects',
    className: 'mb-2 transition-[border-color] duration-fast ease-swift motion-reduce:transition-none',
  },
};
