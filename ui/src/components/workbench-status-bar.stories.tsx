import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkbenchStatusBar } from './workbench-status-bar';

const noop = (): void => undefined;

/** The bar spans the desk shell's full width; the stage gives it one. */
function Desk({ children }: { children: ReactNode }): ReactNode {
  return <div style={{ width: 'min(100vw, 960px)' }}>{children}</div>;
}

const meta = {
  title: 'Components/WorkbenchStatusBar',
  component: WorkbenchStatusBar,
  decorators: [(Story) => <Desk><Story /></Desk>],
  args: {
    connected: true,
    sessions: 19,
    runs: 5,
    needYou: 0,
    exited: 0,
    build: { text: 'v1.4.2', warn: false },
    onOpenLink: noop,
    onOpenFleet: noop,
    onOpenNeeds: noop,
    onOpenPalette: noop,
    onOpenShortcuts: noop,
    onOpenBuild: noop,
  },
} satisfies Meta<typeof WorkbenchStatusBar>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A healthy fleet. CHECK that nothing on the bar draws the eye: every word is
 *  ink-tertiary mono, the link dot is a matte accent point with NO glow, and
 *  the needs item reads "nothing needs you" — never "0 need you". Hovering an
 *  item lifts it onto the hover ground; Tab walks the six items left to right
 *  with the system's ring. */
export const Healthy: Story = {};

/** Something needs you. CHECK "2 need you" in the attention ink and "1 exited"
 *  in the dead ink, each with its own words (colour is never the only cue), and
 *  that the counts sit in tabular figures so a tick never shifts the line. */
export const NeedsYou: Story = { args: { needYou: 2, exited: 1 } };

/** The agent link is down. CHECK the dot turns to the attention colour AND the
 *  word reads "offline" in attention ink — the state is written, not only
 *  painted. Still no glow anywhere. */
export const Offline: Story = { args: { connected: false } };

/** A newer build is waiting. CHECK the build line is amber only because its
 *  own words say why ("v1.4.2 → v1.4.3"), and that the rest of the bar stays
 *  quiet. */
export const BuildBehind: Story = { args: { build: { text: 'v1.4.2 → v1.4.3', warn: true } } };

/** An untagged build. CHECK "unversioned (bd2bf57a)" in amber, whole on a
 *  desk-width bar. */
export const Unversioned: Story = { args: { build: { text: 'unversioned (bd2bf57a)', warn: true } } };

/** The 390 viewport. CHECK the yield order, driven by the bar's own width: the
 *  plain totals truncate with an ellipsis first; `?`, the word "connected" and
 *  the ⌘K hint are gone (the dot stays); "2 need you · 1 exited" stays whole;
 *  and only then does the build line ellipsize, keeping its start
 *  ("v1.4.2 → …"). Nothing overflows the bar. The bar is desk-only in the app —
 *  this story proves the order, not a phone layout. */
export const Narrow: Story = {
  args: { needYou: 2, exited: 1, build: { text: 'v1.4.2 → v1.4.3', warn: true } },
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'phone' } },
};
