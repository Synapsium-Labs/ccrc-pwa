// The page scaffold (D-5102): the header and column every secondary screen
// stands on. Switch the toolbar's skin to see Instrument's dense header (40px
// under a mouse, 44 on touch — D-5667), its 14px title and its 960 column.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { PageScaffold } from './page-scaffold';
import { Section } from './section';

const meta = {
  title: 'Primitives/PageScaffold',
  component: PageScaffold,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A sticky header — Back, the `❯` caret in the accent (identity core, both skins), the title '
          + 'at `--fs-page`, the actions — over a body centred at `--page-max` (or `--page-max-wide` '
          + 'with `wide`) at `--gutter`. Every measure is a skin token; nothing here is a literal.',
      },
    },
  },
  args: {
    title: 'Mail',
    back: { label: 'Back to fleet', onClick: () => {} },
    children: null,
  },
} satisfies Meta<typeof PageScaffold>;
export default meta;

type Story = StoryObj<typeof meta>;

const rows = (n: number) => Array.from({ length: n }, (_, i) => (
  <p key={i} className="m-0 font-mono text-sm text-ink-primary">project-a · record {i + 1}</p>
));

/** A reading page with an action at the header's right. Scroll: the header
 *  stays, on the page's own ground. */
export const Default: Story = {
  args: {
    actions: <Button variant="ghost" size="fit">Digest</Button>,
    children: <>{rows(40)}</>,
  },
};

/** The wide column, for a board (Runs): 1120 in Refined, unbounded in Instrument. */
export const Wide: Story = {
  args: { title: 'Runs', wide: true, children: <>{rows(12)}</> },
};

/** Sections in the column: a scope, a title, a purpose line, and the card. */
export const WithSections: Story = {
  args: {
    title: 'Settings',
    children: (
      <>
        <Section scope="This device" title="Appearance" purpose="How ccrc looks on this screen.">
          {rows(3)}
        </Section>
        <Section scope="Whole fleet" title="Stall watch" purpose="What the fleet does when a session stops moving.">
          {rows(2)}
        </Section>
      </>
    ),
  },
};

/** D-5666: a section nav beside the body once the pane is 960 wide; stacked
 *  above it below that. */
export const WithNav: Story = {
  args: {
    title: 'Settings',
    nav: (
      <nav aria-label="Settings sections" className="grid gap-1 font-mono text-sm text-ink-secondary">
        <span>Updates</span><span>Appearance</span><span>Notifications</span><span>Automation</span><span>Security</span>
      </nav>
    ),
    children: (
      <Section scope="This device" title="Appearance" purpose="How ccrc looks on this screen.">{rows(4)}</Section>
    ),
  },
};

/** Nothing to list. */
export const Empty: Story = {
  args: { title: 'Archive', children: <EmptyState>Nothing is archived.</EmptyState> },
};

/** A long title wraps under the caret rather than clipping. */
export const LongTitle: Story = {
  args: {
    title: 'A page whose title is far longer than any screen in ccrc has today',
    actions: <Button variant="ghost" size="fit">Digest</Button>,
    children: <>{rows(3)}</>,
  },
};
