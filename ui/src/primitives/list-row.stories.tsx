import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip } from './chip';
import { ListRow } from './list-row';

const meta = {
  title: 'Primitives/ListRow',
  component: ListRow,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ListRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The session menu, which is where one of the two copies lived. CHECK the
 *  hairline runs under EVERY row including the last — both original rules
 *  drew it unconditionally, and a list that drops its final rule reads as a
 *  rendering bug rather than as a deliberate end. */
export const AMenu: Story = {
  args: {
    className: 'font-ui text-base leading-tight text-ink-primary',
    children: (
      <>
        <span className="min-w-0 flex-1">Change model</span>
        <span className="flex-none font-mono text-xs leading-none text-ink-tertiary">/model</span>
      </>
    ),
  },
  render: (args) => (
    <div className="grid">
      <ListRow {...args} />
      <ListRow className={args.className}>
        <span className="min-w-0 flex-1">Change effort</span>
        <span className="flex-none font-mono text-xs leading-none text-ink-tertiary">/effort</span>
      </ListRow>
      <ListRow className={args.className}>
        <span className="min-w-0 flex-1 text-status-dead-text">Archive</span>
      </ListRow>
    </div>
  ),
};

/** The account picker, which is where the other copy lived — the same twelve
 *  declarations with a different voice on top. CHECK that the row is 52px and
 *  not 44: the extra eight pixels are what separate neighbours under a thumb
 *  that is scrolling, which is why both rules spelled the literal rather than
 *  reaching for `--tap-min`. */
export const AnAccountPicker: Story = {
  args: {
    className: '',
    children: (
      <>
        <Chip dot style={{ color: 'var(--acct-cyan)', background: 'var(--acct-cyan-tint)' }}>
          acct-a
        </Chip>
        <span className="min-w-0 flex-1 font-mono text-2xs text-ink-tertiary">pool · alpha</span>
        <span className="flex-none text-ink-tertiary" aria-hidden="true">›</span>
      </>
    ),
  },
};

/** Disabled. CHECK that the press is gone and the row still reads as a row —
 *  neither original rule dimmed its own ink, because what a disabled menu item
 *  says is carried by the `disabled` attribute and by the title that explains
 *  the gate, not by a wash. */
export const Disabled: Story = {
  args: {
    disabled: true,
    className: 'font-ui text-base leading-tight text-ink-primary',
    children: <span className="min-w-0 flex-1">Move to another account</span>,
  },
};
