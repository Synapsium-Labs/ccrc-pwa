// Refined's grouped tool rows (D-5475, W2 plan Task S13b).
//
// THE SEAM IS DATA, THEN A ROW. Folding a run of tool entries changes the list
// Virtuoso receives — its count, its indices and its seeded heights — which a
// per-item row cannot do. So the set carries a declarative
// `transcriptGrouping`, `ChatList` (shared) applies the one `groupToolRun`
// before Virtuoso when it says `'tool-runs'`, and every resulting item renders
// through the set's `TranscriptRow`. Refined's draws a group as one
// plain-language row; Instrument's (until S14) draws each item as today.
//
// Virtuoso is replaced by a list that renders every row and CAPTURES its props
// (as `chat-scroller.test.tsx` does), so the item count, the jump's index and
// the seeded sizes are read off what the list was really handed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import type { SkinSet } from '../src/skins/types';
import { buildChatItems } from '../src/session/chatItems';
import { groupToolRun, type ToolGroupItem } from '../src/session/toolSummary';
import {
  HEIGHT_BUCKETS, rememberRows, rememberedRows, type HeightBucket, type MeasuredRow,
} from '../src/session/itemHeight';

const seen = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  scrolls: [] as unknown[],
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      seen.props = props;
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: (location: unknown) => { seen.scrolls.push(location); },
      }));
      const count = props.totalCount as number;
      const key = props.computeItemKey as (i: number) => string | number;
      const content = props.itemContent as (i: number) => React.ReactNode;
      return React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: count }, (_, i) => React.createElement('div', { key: key(i) }, content(i))));
    }),
  };
});

const { ChatList, ChatListInner, shapeOf } = await import('../src/session/ChatList');

afterEach(() => {
  cleanup();
  localStorage.clear();
  seen.props = null;
  seen.scrolls.length = 0;
});

const TS = '2026-10-20T10:00:00.000Z';
let n = 0;
type Use = Extract<ChatEvent, { kind: 'tool_use' }>;
const use = (name: string, input: unknown): Use => {
  n += 1;
  return { kind: 'tool_use', uuid: `u${n}`, ts: TS, toolId: `t${n}`, name, input: JSON.stringify(input) };
};
const result = (u: Use, isError = false): ChatEvent =>
  ({ kind: 'tool_result', ts: TS, toolId: u.toolId, text: 'ok', isError });
/** A finished tool call: its use and its result. */
const call = (name: string, input: unknown, isError = false): ChatEvent[] => {
  const u = use(name, input);
  return [u, result(u, isError)];
};
const assistant = (text: string): ChatEvent => ({ kind: 'assistant', uuid: `a${(n += 1)}`, ts: TS, text });

const mount = (set: SkinSet, events: ChatEvent[], busy = false) =>
  render(
    <SkinSetProvider set={set}>
      <ChatList id="s" events={events} pending={[]} busy={busy} onRetry={() => {}} onDiscard={() => {}} />
    </SkinSetProvider>,
  );

/** A group's disclosure: the one row button that is not a tool card's own. */
const groupRows = (root: ParentNode = document): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('.ref-tool-group > button')];

const THREE = (): ChatEvent[] => [
  ...call('Read', { file_path: '/repo/pwa/src/a.ts' }),
  ...call('Read', { file_path: '/repo/pwa/src/b.ts' }),
  ...call('Bash', { command: 'npm test' }),
  assistant('Done.'),
];

describe("Refined's transcript folds each run of tool entries into one row", () => {
  it('in Refined, three consecutive tool entries render as one grouped row with the sentence; expanding it shows the three cards', () => {
    const { container } = mount(REFINED_SET, THREE());
    const rows = groupRows(container);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.textContent).toContain('Read 2 files · Ran npm');
    // The count is drawn (aria-hidden) and spoken (sr-only) separately; each is held on its own.
    expect(row.querySelector('.ref-tool-group-count > [aria-hidden="true"]')?.textContent).toBe('3');
    expect(row.querySelector('.ref-tool-group-count > .sr-only')?.textContent).toBe(', 3 tool calls');
    // Collapsed by default: none of the three cards is drawn yet.
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.toolcard')).toHaveLength(0);

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const group = row.closest('.ref-tool-group') as HTMLElement;
    expect(group.querySelectorAll('.toolcard')).toHaveLength(3);

    fireEvent.click(row);
    expect(container.querySelectorAll('.toolcard')).toHaveLength(0);
  });

  it('an ask between two tool entries splits them, and stands alone', () => {
    const ask = use('AskUserQuestion', {
      questions: [{ question: 'Which colour reads best?', header: 'Colour', options: [{ label: 'Ink' }, { label: 'Paper' }] }],
    });
    const { container } = mount(REFINED_SET, [
      ...call('Read', { file_path: '/repo/a.ts' }),
      ask, result(ask),
      ...call('Read', { file_path: '/repo/b.ts' }),
      assistant('Noted.'),
    ]);
    expect(groupRows(container)).toHaveLength(2);
    const question = screen.getAllByText(/Which colour reads best\?/)[0]!;
    expect(question.closest('.ref-tool-group'), 'the ask was folded into a group').toBeNull();
  });

  it('a live entry is never inside a collapsed group', () => {
    const live = use('Bash', { command: 'npm run build' });
    const { container } = mount(REFINED_SET, [
      ...call('Read', { file_path: '/repo/a.ts' }),
      ...call('Read', { file_path: '/repo/b.ts' }),
      live,
    ], true);
    const running = container.querySelector('.tool-dot--run');
    expect(running, 'the live call is not on screen').not.toBeNull();
    expect(running!.closest('.ref-tool-group'), 'the live call was folded away').toBeNull();
    expect(groupRows(container)).toHaveLength(1);
  });

  it('a failed entry stands alone too', () => {
    const { container } = mount(REFINED_SET, [
      ...call('Read', { file_path: '/repo/a.ts' }),
      ...call('Bash', { command: 'npm test' }, true),
      ...call('Read', { file_path: '/repo/b.ts' }),
    ]);
    const failed = container.querySelector('.tool-dot--err');
    expect(failed).not.toBeNull();
    expect(failed!.closest('.ref-tool-group')).toBeNull();
  });
});

describe('Instrument (until S14)', () => {
  it('in Instrument (until S14), each tool entry renders as today', () => {
    const events = THREE();
    const { container } = mount(INSTRUMENT_SET, events);
    expect(groupRows(container)).toHaveLength(0);
    expect(container.querySelectorAll('.toolcard')).toHaveLength(3);
    expect(seen.props?.totalCount).toBe(buildChatItems(events, [], false).length);
  });
});

describe('the grouped list is the one Virtuoso is handed', () => {
  // A run of five tool entries before the newest prose: ungrouped that is
  // divider, five cards, the prose (7); grouped it is divider, one row, the
  // prose (3). Every index the list speaks is the grouped list's.
  const FIVE = (): ChatEvent[] => [
    ...call('Read', { file_path: '/repo/a.ts' }),
    ...call('Read', { file_path: '/repo/b.ts' }),
    ...call('Edit', { file_path: '/repo/c.ts', old_string: 'x', new_string: 'y' }),
    ...call('Bash', { command: 'npm test' }),
    ...call('Grep', { pattern: 'useSkin' }),
    assistant('All green.'),
  ];

  let id = 0;
  const onLevel = (px: number): MeasuredRow[] => [1, 1, 1].map((lines) => ({ lines, px, id: (id += 1) }));

  it("jump to latest lands on the grouped list's last item, and the seeded heights are the grouped list's", () => {
    rememberRows(
      new Map<HeightBucket, MeasuredRow[]>([
        ['divider', onLevel(35)], ['group', onLevel(44)], ['tool', onLevel(46)], ['assistant', [
          { lines: 1, px: 40, id: (id += 1) }, { lines: 2, px: 60, id: (id += 1) }, { lines: 3, px: 80, id: (id += 1) },
        ]],
      ]),
      rememberedRows(localStorage),
      localStorage,
    );
    const events = FIVE();
    const grouped = groupToolRun(buildChatItems(events, [], false));
    expect(grouped).toHaveLength(3);
    mount(REFINED_SET, events);
    expect(seen.props?.totalCount).toBe(3);

    const snap = seen.props?.restoreStateFrom as { ranges: { startIndex: number; endIndex: number; size: number }[] };
    const sizes = snap.ranges.flatMap((r) => Array.from({ length: r.endIndex - r.startIndex + 1 }, () => r.size));
    // The divider, the ONE grouped row at the group's own level, the prose.
    expect(sizes).toEqual([35, 44, 40]);

    fireEvent.wheel(screen.getByTestId('virtuoso'));
    act(() => { (seen.props?.atBottomStateChange as (b: boolean) => void)(false); });
    fireEvent.click(screen.getByRole('button', { name: /jump to latest/i }));
    expect(seen.scrolls).toEqual([{ index: 2, behavior: 'smooth' }]);
  });

  it('ChatListInner, the jsdom renderer, takes the same path', () => {
    const { container } = render(
      <SkinSetProvider set={REFINED_SET}>
        <ChatListInner id="s" events={THREE()} pending={[]} />
      </SkinSetProvider>,
    );
    expect(groupRows(container)).toHaveLength(1);
    expect(container.querySelectorAll('.chat-item')).toHaveLength(3); // divider, group, prose
  });
});

describe("the grouped row's height", () => {
  it("the grouped row's shape is in itemHeight's table", () => {
    const events = THREE();
    const group = groupToolRun(buildChatItems(events, [], false)).find(
      (i): i is ToolGroupItem => i.kind === 'tool-group',
    )!;
    // The bucket the list prices the row in is one the record keeps and learns.
    expect(HEIGHT_BUCKETS).toContain('group');
    expect(shapeOf(group)).toEqual({ bucket: 'group', lines: 1 });
    // And it is the row Refined draws: one line, whatever the run holds.
    const { container } = mount(REFINED_SET, events);
    const row = container.querySelector('.ref-tool-group');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByRole('button')).toHaveLength(1);
  });
});
