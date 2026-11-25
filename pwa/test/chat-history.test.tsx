// The chat screen's older messages (desktop polish wave 175), in jsdom: the top of the list for every state the store can
// be in, each end's own words, the control reached and used by keyboard with focus kept sensible, no control at all for an
// older server, a gap drawn where it is, and older rows held display only by the tool-activity fold: an older page's
// unanswered question never takes the live question's place, and an older call never reads as running.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { OLDER_GAP_WORDS, OLDER_WORDS, type OlderEdgeState } from '@ccrc/ui';
import type { ChatEvent } from '../../shared/api';
import { ChatListInner } from '../src/session/ChatList';
import { buildChatItems } from '../src/session/chatItems';
import { NO_PAGING, liveFromOf, type OlderPaging } from '../src/session/olderPages';
import { foldToolActivity, type ToolActivityItem } from '../src/session/toolActivity';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';

afterEach(cleanup);

const TS = '2026-11-24T10:00:00.000Z';
const user = (uuid: string, text = uuid): ChatEvent => ({ kind: 'user', uuid, ts: TS, text });
const assistant = (uuid: string, text = uuid): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text });
const paging = (edge: OlderPaging['edge'], rows = 0): OlderPaging => ({ ...NO_PAGING, edge, next: edge === 'none' ? null : 'c', rows });

const SETS = [['Refined', REFINED_SET], ['Instrument', INSTRUMENT_SET]] as const;
const list = (o: { older?: OlderPaging; onLoadOlder?: () => void; events?: ChatEvent[]; set?: typeof REFINED_SET }) => (
  <SkinSetProvider set={o.set ?? REFINED_SET}>
    <ChatListInner id="s" events={o.events ?? [user('q1'), assistant('a1')]} pending={[]} older={o.older} onLoadOlder={o.onLoadOlder} />
  </SkinSetProvider>
);

describe('the top of the chat', () => {
  it('an older server (no continuation, `none`) and no loader: no control, no words, today\'s view', () => {
    const { container } = render(list({}));
    expect(container.querySelector('.older-edge')).toBeNull();
    cleanup();
    const again = render(list({ older: paging('none'), onLoadOlder: () => {} }));
    expect(again.container.querySelector('.older-edge')).toBeNull();
  });

  it.each(SETS)('%s: every state draws its own words, and only more and the retries offer a control', (_, set) => {
    const seen = new Map<string, string>();
    for (const state of Object.keys(OLDER_WORDS) as OlderEdgeState[]) {
      const { container } = render(list({ older: paging(state), onLoadOlder: () => {}, set }));
      const edge = container.querySelector<HTMLElement>('.older-edge')!;
      expect(edge.dataset.older).toBe(state);
      const button = edge.querySelector('button');
      const { say, control } = OLDER_WORDS[state];
      expect(button?.textContent ?? null).toBe(control);
      if (say !== null) expect(edge.textContent).toContain(say);
      seen.set(state, `${say ?? ''}|${control ?? ''}`);
      cleanup();
    }
    // Distinct on screen: no two states read alike.
    expect(new Set(seen.values()).size).toBe(seen.size);
    // The start of what is here never claims the session began there.
    expect(OLDER_WORDS.start.say).toMatch(/available here/);
    expect(OLDER_WORDS.start.say).not.toMatch(/began|beginning|start of the session/i);
    // Asking again cannot help after `changed` or `absent`: no control. It can after a busy, unreadable or unmeasured.
    for (const s of ['changed', 'absent', 'start', 'expired'] as const) expect(OLDER_WORDS[s].control).toBeNull();
    // Fix round 1, A5: an expired place says older messages are there, and that reopening the chat loads them.
    expect(OLDER_WORDS.expired.say).toMatch(/Older messages are there/);
    expect(OLDER_WORDS.expired.say).toMatch(/Reopen this chat/);
    for (const s of ['busy', 'unreadable', 'unmeasured'] as const) expect(OLDER_WORDS[s].control).toBe('Try again');
  });

  it('works by keyboard: Tab reaches the control, Enter loads once, it stays focused while loading, and the end takes focus', () => {
    const load = vi.fn();
    const { rerender } = render(list({ older: paging('more'), onLoadOlder: load }));
    const button = screen.getByRole('button', { name: 'Load older messages' });
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => { button.click(); }); // a keyboard Enter on a button is a click
    expect(load).toHaveBeenCalledTimes(1);
    rerender(list({ older: paging('loading'), onLoadOlder: load }));
    const loading = screen.getByRole('button', { name: 'Loading older messages…' });
    expect(loading).toBe(button);
    expect(document.activeElement, 'the pressed control lost focus while loading').toBe(button);
    expect(loading.getAttribute('aria-disabled')).toBe('true');
    act(() => { loading.click(); });
    expect(load, 'a press while loading asked again').toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Loading older messages…');
    rerender(list({ older: paging('start'), onLoadOlder: load }));
    expect(document.activeElement?.textContent, 'focus fell to the page when the control went away').toBe(OLDER_WORDS.start.say);
  });

  it('a retry is the same control: Try again asks again', () => {
    const load = vi.fn();
    render(list({ older: paging('unreadable'), onLoadOlder: load }));
    act(() => { screen.getByRole('button', { name: 'Try again' }).click(); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a gap is drawn where the store put it, in its own words, never as a message of the session\'s', () => {
    const gap: ChatEvent = { kind: 'system', uuid: 'local-gap-1', ts: TS, text: OLDER_GAP_WORDS };
    const { container } = render(list({ events: [user('old'), gap, user('held')], older: paging('more', 2), onLoadOlder: () => {} }));
    const rows = [...container.querySelectorAll('.chat-item')].map((r) => r.textContent ?? '');
    const at = rows.findIndex((t) => t.includes(OLDER_GAP_WORDS));
    expect(at).toBeGreaterThan(rows.findIndex((t) => t.includes('old')));
    expect(at).toBeLessThan(rows.findIndex((t) => t.includes('held')));
    expect(container.querySelector('[data-older-gap]')).not.toBeNull();
  });

  it('fix round 1, A4: a gap with no row of its page above it draws no second copy of the time divider below it', () => {
    // A page that was only the record it skipped: the marker is the list's first row, timed as the row below it.
    const at = '2026-11-24T12:00:00.000Z';
    const gap: ChatEvent = { kind: 'system', uuid: 'local-gap-1', ts: at, text: OLDER_GAP_WORDS };
    const held: ChatEvent = { kind: 'user', uuid: 'held', ts: at, text: 'held' };
    const { container } = render(list({ events: [gap, held, assistant('a1')], older: paging('more', 1), onLoadOlder: () => {} }));
    const dividers = [...container.querySelectorAll('.ts-divider')].map((d) => d.textContent);
    expect(dividers).toHaveLength(new Set(dividers).size);
    expect(container.querySelector('[data-older-gap]')).not.toBeNull();
  });
});

describe('older rows are display only in the fold', () => {
  const askUse = (uuid: string, toolId: string): ChatEvent => ({
    kind: 'tool_use', uuid, ts: TS, toolId, name: 'AskUserQuestion',
    input: JSON.stringify({ questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes' }, { label: 'No' }] }] }),
  });
  const read = (uuid: string, toolId: string): ChatEvent => ({ kind: 'tool_use', uuid, ts: TS, toolId, name: 'Read', input: '{"file_path":"/a"}' });
  const wait = { kind: 'question', questions: ['Ship it?'] } as const;

  it('an older unanswered question asking the same words never takes the live question\'s place', () => {
    // The backlog has no prompt: the older page's rows would be in the "current turn" were they not older.
    const older = [assistant('o1'), askUse('o2', 'old-ask'), assistant('o3')];
    const held = [assistant('h1'), askUse('h2', 'live-ask')];
    const events = [...older, ...held];
    const p: OlderPaging = { ...NO_PAGING, rows: older.length };
    const items = buildChatItems(events, [], true);
    const folded = foldToolActivity(items, { runs: 'none', wait, busy: true, liveFrom: liveFromOf(items, events, p) });
    const rows = folded.filter((i): i is ToolActivityItem => i.kind === 'tool-activity');
    const live = rows.find((r) => r.entries.some((e) => e.key === 'live-ask'))!;
    const old = rows.find((r) => r.entries.some((e) => e.key === 'old-ask'))!;
    expect(live.attention.map((a) => [a.kind, a.entry.key])).toEqual([['question', 'live-ask']]);
    expect(live.waiting).toBe(false);
    expect(old.attention).toEqual([]);
    expect(old.past).toBe(true);
    expect(old.live).toBe(false);
    // Without the boundary, the same rows make two open asks and single out neither: the guard the boundary is.
    const unbounded = foldToolActivity(items, { runs: 'none', wait, busy: true });
    const both = unbounded.filter((i): i is ToolActivityItem => i.kind === 'tool-activity');
    expect(both.some((r) => r.attention.some((a) => a.kind === 'question'))).toBe(false);
  });

  it('a stretch joined across the boundary runs only by its live calls', () => {
    const events = [read('o1', 'old-read'), read('h1', 'live-read')];
    const items = buildChatItems(events, [], true);
    const p: OlderPaging = { ...NO_PAGING, rows: 1 };
    const fold = (liveFrom: number) => foldToolActivity(items, { runs: 'none', wait: { kind: 'none' }, busy: true, liveFrom })
      .find((i): i is ToolActivityItem => i.kind === 'tool-activity')!;
    const joined = fold(liveFromOf(items, events, p));
    expect(joined.entries.map((e) => e.key)).toEqual(['old-read', 'live-read']);
    expect(joined.past).toBe(false);
    expect(joined.live, 'the live call has no result yet: the stretch runs').toBe(true);
    // With the live call answered and only the older one resultless, the stretch does not run.
    const answered = [...events, { kind: 'tool_result', ts: TS, toolId: 'live-read', text: 'ok', isError: false } as ChatEvent];
    const items2 = buildChatItems(answered, [], true);
    const row = foldToolActivity(items2, { runs: 'none', wait: { kind: 'none' }, busy: true, liveFrom: liveFromOf(items2, answered, p) })
      .find((i): i is ToolActivityItem => i.kind === 'tool-activity')!;
    expect(row.live, 'an older call without a result read as running').toBe(false);
  });
});
