import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { Button } from './button';
import { COMMAND_KEY, CommandPalette, type CommandPaletteOption } from './command-palette';
import { Sheet } from './sheet';

const meta = {
  title: 'Primitives/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  // Every story drives the palette through <Demo/>, which owns the open state
  // and the query. These args exist only to satisfy the required props.
  args: {
    open: true, onClose: () => {}, query: '', onQueryChange: () => {}, options: [], onRun: () => {},
  },
} satisfies Meta<typeof CommandPalette>;
export default meta;

type Story = StoryObj<typeof meta>;

const OPTIONS: CommandPaletteOption[] = [
  { id: 'fleet', title: 'Go to Fleet', group: 'Go to', keys: ['g', 'f'] },
  { id: 'inbox', title: 'Go to Inbox', group: 'Go to', keys: ['g', 'i'] },
  { id: 'runs', title: 'Go to Runs', group: 'Go to', keys: ['g', 'r'] },
  { id: 'archive', title: 'Go to Archive', group: 'Go to' },
  { id: 'open', title: 'Open session…', group: 'Sessions' },
  { id: 'next', title: 'Next session', group: 'Sessions', keys: [']'] },
  { id: 'layout', title: 'Switch layout →', group: 'Appearance' },
  { id: 'theme', title: 'Switch theme…', group: 'Appearance' },
  { id: 'help', title: 'Show shortcuts', group: 'Help', keys: ['?'] },
  { id: 'palette', title: 'Open the command palette', group: 'Help', keys: [COMMAND_KEY, 'K'] },
];

/** A session found by the top search (D-6714): its `label` is its exact accessible name, read by a screen reader in
 *  place of the title and group run together. */
const LABELLED: CommandPaletteOption[] = [
  ...OPTIONS,
  { id: 'lead', title: 'lead', group: 'coordinator · project-a', label: 'lead, coordinator, project-a' },
  { id: 'first', title: 'first', group: 'project-a', label: 'first, project-a' },
];

/** The story's own filter, a plain substring over the title (and a label, when there is one): ranking is the app's
 *  registry. */
function Demo({ initial = '', under, list = OPTIONS }: {
  initial?: string; under?: 'sheet' | 'drawer'; list?: readonly CommandPaletteOption[];
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(initial);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((o) => o.title.toLowerCase().includes(q) || (o.label ?? '').toLowerCase().includes(q));
  }, [query, list]);
  return (
    <div className="grid min-h-[640px] place-items-center bg-page p-4">
      <div className="w-[240px]">
        <Button onClick={() => setOpen(true)}>Open the palette</Button>
      </div>
      {under === undefined ? null : (
        // `full` is the terminal drawer's chrome (`Sheet`'s full variant, on
        // --z-drawer): the palette's toast layer sits above both.
        <Sheet open onClose={() => {}} title="A sheet left open" full={under === 'drawer'}>
          <p className={under === 'drawer' ? 'p-4 font-mono text-sm leading-normal text-ink-on-well' : 'text-base leading-normal text-ink-secondary'}>
            The palette opens over this {under === 'drawer' ? 'drawer' : 'sheet'}, and Escape closes the palette alone.
          </p>
        </Sheet>
      )}
      <CommandPalette
        open={open}
        onClose={() => { setOpen(false); setQuery(''); }}
        query={query}
        onQueryChange={setQuery}
        options={options}
        onRun={() => { setOpen(false); setQuery(''); }}
      />
    </div>
  );
}

export const Default: Story = { render: () => <Demo /> };

export const Filtered: Story = { render: () => <Demo initial="go to" /> };

export const NothingMatches: Story = { render: () => <Demo initial="zzz" /> };

/** Options with an accessible name of their own (`label`): the sessions the top search lists after the commands. */
export const LabelledOptions: Story = { render: () => <Demo initial="project-a" list={LABELLED} /> };

export const OverASheet: Story = { render: () => <Demo under="sheet" /> };

export const OverTheTerminalDrawer: Story = { render: () => <Demo under="drawer" /> };
