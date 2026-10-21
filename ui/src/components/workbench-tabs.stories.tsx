import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { WorkbenchTabs, type WorkbenchTabItem, type WorkbenchTabsProps } from './workbench-tabs';

const FLEET: WorkbenchTabItem = { id: 'fleet', title: 'Fleet', lead: { icon: 'folder-code' }, pinned: true };

const DESK: WorkbenchTabItem[] = [
  FLEET,
  { id: 'feature-x', title: 'feature-x', lead: { status: 'working' } },
  { id: 'feature-y', title: 'feature-y', lead: { status: 'attention' } },
  { id: 'feature-y-preview', title: 'feature-y', lead: { icon: 'folder-code' }, tag: 'preview' },
  { id: 'pr-feature-x', title: 'PR · ws/feature-x', lead: { icon: 'file-text' } },
];

const MANY: WorkbenchTabItem[] = [
  FLEET,
  ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map((s, i): WorkbenchTabItem => ({
    id: `lane-${s}`,
    title: `lane-${s} · project-a`,
    lead: { status: i === 2 ? 'attention' : i % 3 === 0 ? 'working' : 'idle' },
  })),
];

/** A live harness: the story owns the tab store a real app would, so clicks,
 *  arrows, Delete, close and drag all do something a reviewer can see. */
function Live(props: WorkbenchTabsProps): ReactNode {
  const [tabs, setTabs] = useState(props.tabs);
  const [activeId, setActiveId] = useState(props.activeId);
  return (
    <WorkbenchTabs
      {...props}
      tabs={tabs}
      activeId={activeId}
      onActivate={setActiveId}
      onClose={(id, next) => {
        setTabs((ts) => ts.filter((t) => t.id !== id));
        if (next !== null) setActiveId(next);
      }}
      onReorder={(from, to, after) => {
        setTabs((ts) => {
          const moved = ts.find((t) => t.id === from);
          if (!moved) return ts;
          const rest = ts.filter((t) => t.id !== from);
          const at = rest.findIndex((t) => t.id === to) + (after ? 1 : 0);
          return [...rest.slice(0, at), moved, ...rest.slice(at)];
        });
      }}
    />
  );
}

const meta = {
  title: 'Components/WorkbenchTabs',
  component: WorkbenchTabs,
  render: (args) => <Live {...args} />,
  args: {
    tabs: DESK,
    activeId: 'feature-x',
    onActivate: () => undefined,
    onClose: () => undefined,
    onReorder: () => undefined,
    onShowAll: () => undefined,
  },
} satisfies Meta<typeof WorkbenchTabs>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The desk. CHECK that Fleet is a caret only, first, with no close; that
 *  `feature-x` is active — the surface's ground, semibold, ONE accent rail on
 *  its bottom edge, its close visible; that `feature-y`'s lamp pulses amber with
 *  the `●` glyph and carries no other badge (the only other thing that may glow
 *  is the busy lamp); that the preview tab leads with a folder icon and a mono
 *  `preview` tag; and that NO "all tabs" control shows, because everything fits. */
export const Default: Story = {};

/** Twelve tabs in a 600px frame. CHECK the "All tabs, 12 open" control at the
 *  right (a mono count and a down chevron); that a 40px fade marks each edge
 *  only while something is cut there — the right while more tabs wait past
 *  it, the left (just after Fleet) once the strip has scrolled; that Fleet
 *  stays put while the strip scrolls under it; and that arrowing to the last
 *  tab scrolls it fully into view, its close clear of "all tabs", with no
 *  fade left on the right. */
export const Overflow: Story = {
  args: { tabs: MANY, activeId: 'lane-b' },
  decorators: [(S) => <div style={{ width: 600 }}><S /></div>],
};

/** Three tabs in the same 600px frame. CHECK there is no fade and no "all tabs"
 *  control: it appears only while the strip actually overflows. */
export const FitsNoAllControl: Story = {
  args: { tabs: DESK.slice(0, 3) },
  decorators: [(S) => <div style={{ width: 600 }}><S /></div>],
};

/** The last tab active. CHECK that closing it (Delete, or its close control)
 *  activates its LEFT neighbour, since it has no right one. */
export const ActiveLast: Story = { args: { activeId: 'pr-feature-x' } };

/** The phone header's form. CHECK one button only: the active tab's lamp and
 *  title, then the open count in a mono box; at least a tap square tall. */
export const Switcher: Story = {
  args: { variant: 'switcher' },
  decorators: [(S) => <div style={{ width: 360 }}><S /></div>],
};

