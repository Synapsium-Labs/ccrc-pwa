// What a radio group looks like when the choice is a set of SENTENCES, which
// is the only form this console uses: three groups in Settings and the theme
// picker, none of them a row of one-word pills.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { RadioFieldset } from './radio';

const meta = {
  title: 'Primitives/RadioFieldset',
  component: RadioFieldset,
  parameters: {
    docs: {
      description: {
        component:
          'Pick one of these, all of them visible. It lived in `SettingsScreen` as a local '
          + 'component plus five `fleet.css` rules until the design system got a form layer; '
          + 'every one of those rules was layout, so the move took no ground with it. The input '
          + 'is 18px because that is what a radio is — the tap target is the LABEL around it, '
          + 'which carries `min-h-tap`. `fieldset`/`legend` rather than `role="radiogroup"`: '
          + 'the native pair names the group and `disabled` on the fieldset disables every '
          + 'input in it, which is a DIFFERENT gate from an option’s own `disabled` — one call '
          + 'site has to grey a single unsafe choice while leaving the safe one takeable.',
      },
    },
  },
} satisfies Meta<typeof RadioFieldset>;
export default meta;

type Story = StoryObj<typeof meta>;

const OPTIONS = [
  { value: 'off' as const, label: 'Off — nothing is pushed to this phone.' },
  { value: 'mentions' as const, label: 'Mentions — only mail addressed to me.' },
  { value: 'all' as const, label: 'Everything — every delivery, every ask.' },
];

/** The ordinary case: a set with a choice made. */
export const Chosen: Story = {
  args: { legend: 'Notifications', name: 'story-notify', options: OPTIONS, value: 'mentions', onPick: () => undefined },
  render: () => {
    const [value, setValue] = useState<'off' | 'mentions' | 'all'>('mentions');
    return (
      <RadioFieldset
        legend="Notifications"
        name="story-notify"
        options={OPTIONS}
        value={value}
        onPick={setValue}
      />
    );
  },
};

/** NOTHING CHOSEN, which is not the same as "off": two of the three real sets
 *  read their value off a wire row that may not have arrived, and a `null`
 *  says so rather than lighting the first option. */
export const NothingChosenYet: Story = {
  args: { legend: 'Channel', name: 'story-channel', options: [], value: null, onPick: () => undefined },
  render: () => (
    <RadioFieldset
      legend="Channel"
      name="story-channel"
      options={[
        { value: 'stable' as const, label: 'Stable — promoted releases only.' },
        { value: 'dev' as const, label: 'Dev — every merge to main.' },
      ]}
      value={null}
      onPick={() => undefined}
    />
  ),
};

/** ONE OPTION DISABLED, the gate that is not the fieldset's. The real case is
 *  auto-install (D-3315): when the node caps are incomplete, the unsafe choice
 *  greys out and the safe one must stay takeable — disabling the whole set
 *  would remove the only answer the operator can give. */
export const OneChoiceOutOfReach: Story = {
  args: { legend: 'Auto-install', name: 'story-auto', options: [], value: 'manual', onPick: () => undefined },
  render: () => {
    const [value, setValue] = useState<'manual' | 'auto'>('manual');
    return (
      <RadioFieldset
        legend="Auto-install"
        name="story-auto"
        options={[
          { value: 'manual' as const, label: 'Manual — I move the fleet myself.' },
          {
            value: 'auto' as const,
            label: 'Automatic — needs every node’s caps, and two are unread.',
            disabled: true,
          },
        ]}
        value={value}
        onPick={setValue}
      />
    );
  },
};

/** THE WHOLE SET OUT OF REACH — the other gate. The cursor stops promising a
 *  choice that cannot be made, which is `group-disabled:` on each row. */
export const WholeSetDisabled: Story = {
  args: { legend: 'Notifications', name: 'story-disabled', options: OPTIONS, value: 'off', onPick: () => undefined, disabled: true },
  render: () => (
    <RadioFieldset
      legend="Notifications"
      name="story-disabled"
      options={OPTIONS}
      value="off"
      onPick={() => undefined}
      disabled
    />
  ),
};
