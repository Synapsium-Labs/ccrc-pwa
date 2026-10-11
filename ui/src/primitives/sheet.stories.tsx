import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './button';
import { Sheet } from './sheet';

const meta = {
  title: 'Primitives/Sheet',
  component: Sheet,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'phone' } },
  // Every story drives the sheet through <Demo/>, which owns the open state —
  // a sheet pinned open by an arg cannot show its own dismissal. These args
  // exist only to satisfy the component's required props.
  args: { open: true, onClose: () => {}, children: null },
} satisfies Meta<typeof Sheet>;
export default meta;

type Story = StoryObj<typeof meta>;

function Demo({
  title,
  eyebrow,
  full,
  children,
}: {
  title?: string;
  eyebrow?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="grid min-h-[600px] place-items-center bg-page p-4">
      <div className="w-[240px]">
        <Button onClick={() => setOpen(true)}>Open the sheet</Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} eyebrow={eyebrow} full={full}>
        {children}
      </Sheet>
    </div>
  );
}

export const WithTitle: Story = {
  render: () => (
    <Demo title="Move to another account">
      <p className="text-base leading-normal text-ink-secondary">
        The session keeps its history and its workspace. Only the wrapper changes.
      </p>
    </Demo>
  ),
};

export const WithEyebrow: Story = {
  render: () => (
    <Demo eyebrow="claude is asking" title="Which migration should I run first?">
      <div className="grid gap-2">
        <Button variant="ghost">The schema one</Button>
        <Button variant="ghost">The backfill</Button>
      </div>
    </Demo>
  ),
};

/** A long question must never push the options out of reach. The title caps at
 *  38vh and scrolls WITH the body rather than above it — on a landscape phone
 *  the old header-outside layout left nothing scrollable to reach Send with. */
export const LongTitle: Story = {
  render: () => (
    <Demo
      eyebrow="claude is asking"
      title="I found three candidate fixes for the stale-tip wedge in server/src/coord/store.ts and each one changes a different seam — which should I take, given the done-fingerprint re-measures the workspace branch?"
    >
      <div className="grid gap-2">
        <Button variant="ghost">Re-measure at close</Button>
        <Button variant="ghost">Reject the handoff</Button>
        <Button variant="ghost">Park the delivery</Button>
      </div>
    </Demo>
  ),
};

/** The terminal drawer: the panel becomes the well itself — dark glass in BOTH
 *  themes, which is why the grabber and eyebrow restate themselves in well ink.
 *  Switch the theme toolbar to Paper and the glass stays dark. */
export const FullWell: Story = {
  render: () => (
    <Demo full eyebrow="terminal · claude-3">
      <pre className="flex-1 overflow-auto px-4 font-mono text-sm leading-mono text-ink-on-well">
        {`$ ccd ws-ls
claude-3   busy    2h14m   feat/limits-ranking
claude-7   idle    18m     main
$ `}
      </pre>
    </Demo>
  ),
};
