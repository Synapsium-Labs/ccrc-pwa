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
  size,
  titleScroll,
  children,
}: {
  title?: string;
  eyebrow?: string;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
  titleScroll?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="grid min-h-[600px] place-items-center bg-page p-4">
      <div className="w-[240px]">
        <Button onClick={() => setOpen(true)}>Open the sheet</Button>
      </div>
      {full
        ? <Sheet open={open} onClose={() => setOpen(false)} title={title} eyebrow={eyebrow} full>{children}</Sheet>
        : <Sheet open={open} onClose={() => setOpen(false)} title={title} eyebrow={eyebrow} size={size} titleScroll={titleScroll}>{children}</Sheet>}
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

/** `titleScroll={false}` (D-6325): the same long title with no cap and no scroller of its own. It grows inside the one
 *  scrolling body, so the sheet has a single vertical scroller; the ask sheets pass it. */
export const LongTitleNoTitleScroll: Story = {
  render: () => (
    <Demo
      eyebrow="claude is asking"
      titleScroll={false}
      title="I found three candidate fixes for the stale-tip wedge in server/src/coord/store.ts and each one changes a different seam — which should I take, given the done-fingerprint re-measures the workspace branch? The first re-measures at close, the second rejects the handoff outright, and the third parks the delivery until the coordinator rules."
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

/** THE DESKTOP ARM (D-5933): from 900 every sheet but the terminal drawer is a centred dialog on `--elev-pop`, with
 *  a ✕ and no grabber or drag. One story per size, at the laptop width: `sm` 440 (a confirm), `md` 560 (the
 *  default), `lg` 720 (What's new). */
const desk = { viewport: { defaultViewport: 'laptop' } };

export const DeskSmall: Story = {
  parameters: desk,
  render: () => (
    <Demo title="Forget this session?" size="sm">
      <p className="text-base leading-normal text-ink-secondary">Its history stays on disk. The card leaves the fleet.</p>
    </Demo>
  ),
};

export const DeskMedium: Story = {
  parameters: desk,
  render: () => (
    <Demo eyebrow="claude is asking" title="Which migration should I run first?">
      <div className="grid gap-2">
        <Button variant="ghost">The schema one</Button>
        <Button variant="ghost">The backfill</Button>
      </div>
    </Demo>
  ),
};

export const DeskLarge: Story = {
  parameters: desk,
  render: () => (
    <Demo eyebrow="3 releases" title="What's new since v0.0.7" size="lg">
      <p className="text-base leading-normal text-ink-secondary">
        Release notes read at a prose measure: the widest dialog is for reading, not for choosing.
      </p>
    </Demo>
  ),
};
