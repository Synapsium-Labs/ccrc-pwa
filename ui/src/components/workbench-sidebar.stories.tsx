import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { WorkbenchAccountRow, type WorkbenchAccountItem } from './workbench-account-row';
import {
  WorkbenchSidebar,
  type WorkbenchSection,
  type WorkbenchSessionItem,
  type WorkbenchSidebarMode,
  type WorkbenchSidebarProps,
} from './workbench-sidebar';

const row = (o: Partial<WorkbenchSessionItem> & { id: string }): WorkbenchSessionItem => ({
  name: o.id,
  status: 'working',
  stateWord: 'working',
  branch: `ws/${o.id}`,
  account: { label: 'lane-a', hue: 'cyan' },
  ...o,
});

const COORDINATOR = row({
  id: 'program-a',
  stateWord: 'working · 12:40',
  account: { label: 'lane-b', hue: 'violet' },
  laneSummary: '3 lanes · 2 working · 1 waiting',
  lanes: [
    row({
      id: 'tabs-w1',
      stateWord: 'working · 03:05',
      pr: '#123',
      subagents: 2,
      agents: [
        { id: 'ag-1', name: 'Explore', task: 'map the tab store', age: '1m', running: true },
        { id: 'ag-2', name: 'reviewer', task: 'review the diff', age: 'just now', running: true },
      ],
    }),
    row({ id: 'tabs-w2', status: 'attention', stateWord: 'waiting', account: { label: 'lane-c', hue: 'blue' } }),
    row({ id: 'tabs-w3', status: 'done', stateWord: 'done', account: { label: 'lane-b', hue: 'violet' } }),
  ],
});

const PROJECTS: WorkbenchSection[] = [
  {
    id: 'project-a',
    label: 'project-a',
    pool: 'pool-a',
    waiting: 2,
    total: 6,
    canCreate: true,
    items: [
      row({ id: 'feature-x', stateWord: 'working · 04:12' }),
      COORDINATOR,
      row({ id: 'old-spike', status: 'cleanup', stateWord: 'merged', pr: '#98' }),
      row({ id: 'sleepy', status: 'dead', asleep: true, stateWord: 'hibernated', account: { label: 'lane-c', hue: null } }),
    ],
  },
  {
    id: 'project-b',
    label: 'project-b',
    waiting: 0,
    total: 3,
    canCreate: true,
    items: [
      row({ id: 'feature-y', status: 'idle', stateWord: 'idle · 3h ago' }),
      row({ id: 'feature-z', status: 'attention', stateWord: 'waiting', account: { label: 'lane-b', hue: 'violet' } }),
    ],
  },
];

const group = (
  id: string,
  label: string,
  lamp: WorkbenchSessionItem['status'],
  items: WorkbenchSessionItem[],
  defaultFolded = false,
): WorkbenchSection => ({
  id,
  label,
  lamp,
  waiting: lamp === 'attention' ? items.length : 0,
  total: items.length,
  defaultFolded,
  items,
});

const STATUS: WorkbenchSection[] = [
  group('needs', 'Needs you', 'attention', [row({ id: 'tabs-w2', status: 'attention', stateWord: 'waiting' })]),
  group('working', 'Working', 'working', [row({ id: 'feature-x', stateWord: 'working · 04:12' }), COORDINATOR]),
  group('done', 'Done', 'done', [row({ id: 'tabs-w3', status: 'done', stateWord: 'done' })]),
  group('idle', 'Idle', 'idle', [row({ id: 'feature-y', status: 'idle', stateWord: 'idle · 3h ago' })], true),
  group('cleanup', 'Cleanup', 'cleanup', [row({ id: 'old-spike', status: 'cleanup', stateWord: 'merged' })], true),
  group('archived', 'Archived', 'archived', [row({ id: 'spike-b', status: 'archived', stateWord: 'archived' })], true),
  group('dead', 'Dead', 'dead', [row({ id: 'sleepy', status: 'dead', asleep: true, stateWord: 'hibernated' })], true),
];

const ACCOUNTS: WorkbenchAccountItem[] = [
  { id: 'a', name: 'lane-a', hue: 'cyan', five: { pct: 41, reset: '2h 10m' }, seven: { pct: 22, reset: '3d 4h' } },
  { id: 'b', name: 'lane-b', hue: 'violet', five: { pct: 82, reset: '48m' }, seven: { pct: 77, reset: '1d 2h' } },
  { id: 'c', name: 'lane-c', hue: 'blue', five: { pct: null, reset: '—' }, seven: { pct: 9, reset: '6d 1h' } },
];

/** The app's half, played by the story: it owns mode, query and selection, and filters before it hands over. */
function Live(args: WorkbenchSidebarProps): ReactNode {
  const [mode, setMode] = useState<WorkbenchSidebarMode>(args.mode);
  const [query, setQuery] = useState(args.query);
  const [selected, setSelected] = useState(args.selectedId);
  const q = query.trim().toLowerCase();
  const hit = (it: WorkbenchSessionItem): boolean =>
    it.name.toLowerCase().includes(q) || (it.branch ?? '').toLowerCase().includes(q);
  const sections = q === ''
    ? args.sections
    : args.sections
      .map((s) => ({ ...s, items: s.items.filter(hit) }))
      .filter((s) => s.items.length > 0 || s.label.toLowerCase().includes(q));
  return (
    <div style={{ height: 640, width: 360 }}>
      <WorkbenchSidebar
        {...args}
        mode={mode}
        onModeChange={(m) => { setMode(m); args.onModeChange(m); }}
        query={query}
        onQueryChange={(v) => { setQuery(v); args.onQueryChange(v); }}
        sections={sections}
        selectedId={selected}
        onOpen={(id) => { setSelected(id); args.onOpen(id); }}
      />
    </div>
  );
}

const noop = (): void => undefined;

const meta = {
  title: 'Components/WorkbenchSidebar',
  component: WorkbenchSidebar,
  args: {
    mode: 'projects',
    onModeChange: noop,
    query: '',
    onQueryChange: noop,
    sections: PROJECTS,
    selectedId: 'feature-x',
    onOpen: noop,
    onOpenAgent: noop,
    onNewSession: noop,
  },
  render: (args) => <Live {...args} />,
} satisfies Meta<typeof WorkbenchSidebar>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Projects mode. CHECK: `project-a` carries the `pool-a` chip and "2 waiting"; `feature-x` is SELECTED (accent tint,
 *  an inset accent rail, a semibold name); the coordinator `program-a` is open with `▾ coordinator · 3`, its three
 *  lanes indented 16px on an edge-strong rule, and `tabs-w1` holds `#123`, a bot count and two 32px agent rows; only
 *  the working and waiting lamps glow; `old-spike` (cleanup) steps its name and word DOWN to tertiary ink and never
 *  fades; `sleepy` shows the dotted-ring hibernated lamp and its account chip in the neutral unknown hue. Tab into
 *  the tree: exactly one stop, ↓/↑ move, ←/→ fold, Enter opens, and Shift+Enter on `project-a` asks for a new
 *  session — the `+`'s key route, which the head announces as its keyboard shortcut. */
export const Projects: Story = {};

/** A coordinator seeded folded. CHECK: the tag reads `▸ coordinator · 3`, no lanes render, and line two is the
 *  summary "3 lanes · 2 working · 1 waiting" — the lanes' states stay readable while folded. → unfolds it. */
export const CoordinatorFolded: Story = {
  args: {
    sections: [{ ...PROJECTS[0]!, items: PROJECTS[0]!.items.map((it) => (it.id === 'program-a' ? { ...it, defaultFolded: true } : it)) }],
    selectedId: 'program-a',
  },
};

/** Status mode. CHECK: seven group heads in sans with their lamps, in order Needs you, Working, Done, Idle, Cleanup,
 *  Archived, Dead; the last four start folded (▸) and keep their counts; "Needs you" carries "1 waiting" and its
 *  lamp pulses; no head offers `+`. */
export const Status: Story = { args: { mode: 'status', sections: STATUS } };

/** Nothing matches. CHECK: the column says `No workspace matches “auth”.`, echoing the query, and there is no empty
 *  tree under it. */
export const NoMatch: Story = { args: { query: 'auth', sections: [] } };

/** The foot. CHECK: the account block sits at the bottom of the column under its hairline, and the tree scrolls
 *  between the tools and the foot without pushing it off. */
export const WithAccountFoot: Story = {
  args: { foot: <WorkbenchAccountRow accounts={ACCOUNTS} onOpen={noop} /> },
};

/** Long names. CHECK: the head's long project id ellipsizes but never vanishes — the pool chip yields first, and goes
 *  entirely when the label's floor leaves it no room — while "128 waiting", the total and `+` stay whole and inside the
 *  column; the session name ellipsizes on line one; on line two the branch keeps its start, the account chip
 *  ellipsizes at its cap and stays at the right; the long agent name ellipsizes so its task and age still show. */
export const LongNames: Story = {
  args: {
    sections: [
      {
        id: 'project-with-a-very-long-identifier-a',
        label: 'project-with-a-very-long-identifier-a',
        pool: 'pool-with-a-long-name',
        waiting: 128,
        total: 1024,
        canCreate: true,
        items: [
          row({
            id: 'feature-with-an-unreasonably-long-session-name',
            status: 'attention',
            stateWord: 'waiting',
            branch: 'ws/feature-with-an-unreasonably-long-branch-name-x',
            account: { label: 'lane-with-a-long-account', hue: 'violet' },
            agents: [
              { id: 'ag-1', name: 'general-purpose-agent-with-a-long-name', task: 'map every call site of the tab store', age: '12m', running: true },
            ],
          }),
        ],
      },
    ],
    selectedId: null,
  },
};
