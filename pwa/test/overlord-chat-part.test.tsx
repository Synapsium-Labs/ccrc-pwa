// The chat's mount in the Overlord place (Overlord W1, the chat, Task 4): it reuses the place's session store, so a frame the store
// applies is the frame the refresh reads. A beat changes no transcript and no status, so it reads nothing; a user turn reads; a
// turn's end (idle after busy) reads; and the transcript rows are the store's own, merged with the record.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api';
import type { ChatThread } from '../../shared/overlordChat';
import { ChatPart } from '../src/overlord/ChatPart';
import type { OverlordChatPort } from '../src/overlord/useOverlordChat';
import { getSessionStore } from '../src/stores/session';

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const SID = 'lane-a-overlord-part';
const thread: ChatThread = {
  v: 1, designation: 'designated', sessionId: SID, term: 1,
  entries: [{ kind: 'divider', gen: { term: 1, n: 1 }, at: T0, current: true, newTerm: false, earlier: 'not-pageable' }],
  messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 1 } },
  readiness: { kind: 'read', value: { oldest: null } }, replies: { kind: 'read', value: { more: false } }, older: null,
};
const port = (): OverlordChatPort & { calls: () => number } => {
  let n = 0;
  return {
    calls: () => n,
    thread: async () => { n += 1; return { kind: 'thread', thread }; },
    earlier: async () => 'no-answer',
    send: async () => ({ kind: 'no-answer' }),
  };
};
const ev = (uuid: string, kind: 'user' | 'assistant', text: string, s: number): ChatEvent =>
  ({ kind, uuid, ts: new Date(T0 + s * 1000).toISOString(), text });
const apply = (msg: SessionStreamMsg): void => { act(() => { getSessionStore(SID).getState().apply(msg); }); };
const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the chat part over the place\'s session store', () => {
  it('draws the store\'s transcript rows, and reads again on a user turn and a turn\'s end, never on a beat', async () => {
    const p = port();
    render(<ChatPart sessionId={SID} port={p} />);
    await tick(0);
    expect(p.calls()).toBe(1);
    apply({ type: 'backlog', uuid: 'conv-1', events: [ev('a1', 'assistant', 'an answer from the store', 1)], offset: 1, file: 'f', missing: false });
    await tick(20_000);
    expect(screen.getByText('an answer from the store')).toBeInTheDocument();
    expect(p.calls(), 'an assistant row reads nothing').toBe(1);
    apply({ type: 'beat', at: 1 });
    await tick(20_000);
    expect(p.calls(), 'a beat reads nothing').toBe(1);
    apply({ type: 'events', uuid: 'conv-1', events: [ev('u1', 'user', 'typed at the terminal', 2)], offset: 2 });
    await tick(0);
    expect(p.calls()).toBe(2);
    expect(screen.getByText('typed at the terminal').closest('figure'), 'a pane turn, never an operator bubble').not.toBeNull();
    await tick(20_000);
    apply({ type: 'status', status: 'busy', statusUpdatedAt: null });
    apply({ type: 'status', status: 'idle', statusUpdatedAt: null });
    await tick(0);
    expect(p.calls(), 'idle after busy reads').toBe(3);
  });

  it('with no bound session the thread still reads, with no live rows', async () => {
    const p = port();
    render(<ChatPart sessionId={null} port={p} />);
    await tick(0);
    expect(p.calls()).toBe(1);
  });
});
