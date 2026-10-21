import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  WorkbenchTerminal,
  type WorkbenchKey,
  type WorkbenchTerminalProps,
  type WorkbenchTerminalView,
} from './workbench-terminal';

/** The app's key row, in its order: what a phone needs most comes first. */
const KEYS: WorkbenchKey[] = [
  { id: 'esc', legend: 'esc', label: 'Escape' },
  { id: 'ctrl', legend: 'ctrl', label: 'Ctrl — latches for the next key', latch: true },
  { id: 'ctrl-c', legend: '^C', label: 'Control C' },
  { id: 'tab', legend: 'tab', label: 'Tab' },
  { id: 'shift-tab', legend: '⇧tab', label: 'Shift Tab' },
  { id: 'left', legend: '←', label: 'Arrow left' },
  { id: 'up', legend: '↑', label: 'Arrow up' },
  { id: 'down', legend: '↓', label: 'Arrow down' },
  { id: 'right', legend: '→', label: 'Arrow right' },
  { id: 'enter', legend: '⏎', label: 'Enter' },
  { id: 'pgup', legend: 'PgUp', label: 'Page up' },
  { id: 'pgdn', legend: 'PgDn', label: 'Page down' },
  { id: 'ctrl-d', legend: '^D', label: 'Control D' },
  { id: 'ctrl-u', legend: '^U', label: 'Control U' },
  { id: 'ctrl-o', legend: '^O', label: 'Control O' },
  { id: 'ctrl-r', legend: '^R', label: 'Control R' },
  { id: 'ctrl-t', legend: '^T', label: 'Control T' },
  { id: 'ctrl-b', legend: '^B', label: 'Control B' },
];
const SHORTCUTS = ['/compact', '/model', 'y', 'n', '1', '2', '3'];

/** Sample bytes, as a pane would show them. Neutral: a branch, a PR number. */
const OUTPUT = [
  '> Run the tab strip tests, then fix what fails.',
  '⏺ Bash(npm test -- tabs)',
  '  ⎿ ✓ moves a tab after its target',
  '    × closing the last tab activates nothing',
  '⏺ Update(src/shell/tabs.ts)',
  '  ⎿ Updated src/shell/tabs.ts with 2 additions and 1 removal',
  '⏺ Pushed ws/feature-x and opened #123 for review.',
].join('\n');

const Output = (): ReactNode => <pre className="m-0 whitespace-pre-wrap">{OUTPUT}</pre>;

/** Holds what the app would hold — the view, the latch, the draft — so a
 *  reviewer can press the keys and see the latch and the switch answer. */
function Live({ width, height, ...args }: WorkbenchTerminalProps & { width?: number; height?: number }): ReactNode {
  const [view, setView] = useState<WorkbenchTerminalView>(args.view);
  const [latched, setLatched] = useState(args.latched ?? false);
  const [draft, setDraft] = useState(args.draft ?? '');
  return (
    <div style={{ width: width ?? '100%', height: height ?? 480, maxWidth: '100%' }}>
      <WorkbenchTerminal
        {...args}
        view={view}
        onViewChange={setView}
        latched={latched}
        onLatchChange={setLatched}
        onKey={() => setLatched(false)}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => setDraft('')}
      />
    </div>
  );
}

const meta = {
  title: 'Components/WorkbenchTerminal',
  component: WorkbenchTerminal,
  args: {
    paneId: 'feature-x',
    attached: true,
    attachWord: 'attached',
    view: 'terminal',
    onViewChange: () => {},
    layout: 'desktop',
    hint: 'Typing goes to the pane · Esc interrupts',
    children: <Output />,
  },
  render: (args) => <Live {...args} />,
} satisfies Meta<typeof WorkbenchTerminal>;
export default meta;

type Story = StoryObj<typeof meta>;

const phone = {
  layout: 'phone',
  hint: undefined,
  keys: KEYS,
  shortcuts: SHORTCUTS,
  placeholder: 'Type to the pane…',
} satisfies Partial<WorkbenchTerminalProps>;

/** The desk: the pane takes the keyboard. CHECK the bar reads `terminal ·
 *  feature-x` in mono (never "tmux"), `attached` beside a MATTE green dot — no
 *  halo, attached is a state, not a heartbeat — and `Terminal · Chat · Split`
 *  with Terminal pressed (full ink, semibold, its own ground). The pane is the
 *  well edge to edge, no card around it, and one line under it in tertiary
 *  mono says what the keyboard does. Tab reaches the pane and draws the ring. */
export const DesktopAttached: Story = {};

/** The desk, nothing running. CHECK the word reads `not running` and its dot
 *  drops to the dim on-well grey — the word and the dot both change, so the
 *  state is never colour alone. */
export const DesktopNotRunning: Story = {
  args: { attached: false, attachWord: 'not running' },
};

/** A 480px tab. CHECK Split is GONE (the container query is on the tab, not
 *  the viewport) and Terminal · Chat stay; the name is not truncated to make
 *  room — if the switch does not fit it wraps to a second, right-aligned line. */
export const NarrowNoSplit: Story = {
  render: (args) => <Live {...args} width={480} />,
};

/** A phone: the dock above the soft keyboard. CHECK the key row starts `esc ·
 *  ctrl · ^C` (what a phone needs most) and scrolls sideways; each key is a
 *  44px square with the heavier bottom edge, on a 9% on-well fill; the chips
 *  sit in a second row; the line is the `❯` caret in on-well green, a 16px
 *  field and a green Send square. Tapping a key must not blur the field. Arrow
 *  keys move inside each row; Tab enters each row once. */
export const PhoneKeys: Story = {
  args: phone,
  render: (args) => <Live {...args} width={390} height={640} />,
};

/** Ctrl latched. CHECK the ctrl key INVERTS — on-well ink fill, the well's
 *  colour for its legend — and does not glow or turn green: a held key, not a
 *  live thing. Its resting border (unlatched) is visibly stronger than its
 *  neighbours', because it sends no byte of its own. Hover it: the legend
 *  stays the well's colour. */
export const PhoneCtrlLatched: Story = {
  args: { ...phone, latched: true },
  render: (args) => <Live {...args} width={390} height={640} />,
};

/** Not running. CHECK there are NO keys and NO chips; the reason sits above
 *  the line in the dim on-well mix; the field is disabled; "Restart session"
 *  stands in Send's place in on-well ink (never the page's dark ink on the
 *  well). The pane's text dims a step, and the bar says `not running`. */
export const PhoneReadOnlyNotRunning: Story = {
  args: {
    ...phone,
    attached: false,
    attachWord: 'not running',
    readOnly: { reason: 'Not running — the chat is read-only.', action: { label: 'Restart session', onClick: () => {} } },
  },
  render: (args) => <Live {...args} width={390} height={560} />,
};

/** Hibernated. CHECK the same read-only dock, with "Wake session" as the one
 *  way back — the app chooses the words and the action, the component only
 *  places them. */
export const PhoneReadOnlyHibernated: Story = {
  args: {
    ...phone,
    attached: false,
    attachWord: 'hibernated',
    readOnly: { reason: 'Hibernated — wake it to type.', action: { label: 'Wake session', onClick: () => {} } },
  },
  render: (args) => <Live {...args} width={390} height={560} />,
};
