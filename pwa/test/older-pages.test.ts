// Older chat pages in the session store (desktop polish wave 175, `session/olderPages.ts`): the continuation kept from
// the backlog, one request at a time, a page's rows put before the rows held, in order, each end word to its own state,
// a gap where it is, and what voids a request: a new backlog on the same socket, a rotation, a socket that drops. A late
// answer is never applied, on the echo path (`for`) and on the no-echo path (the wave 171 server), in both of the cases
// the wire allows: A, the voided request is never answered; B, it is answered after the new backlog. Older rows are
// display only: no question, approval, status, helper report or pending send moves with them. An older server (no
// continuation) gives no control and today's view exactly.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api';
import type { OlderPageAnswer, OlderPageEnd } from '../../shared/olderPage';
import {
  NO_PAGING, answerPaging, isGapMarker, liveFromOf, pagingAsked, pagingOfBacklog, pagingOfDrop, requestOf, type OlderPaging,
} from '../src/session/olderPages';
import { buildChatItems } from '../src/session/chatItems';
import { applySessionMsg, createSessionStore, type SessionSnapshot } from '../src/stores/session';

const TS = '2026-11-24T10:00:00.000Z';
const user = (uuid: string, text = uuid): ChatEvent => ({ kind: 'user', uuid, ts: TS, text });
const rows = (prefix: string, n: number): ChatEvent[] => Array.from({ length: n }, (_, i) => user(`${prefix}${i}`));
const uuids = (events: readonly ChatEvent[]): string[] =>
  events.map((e) => (isGapMarker(e) ? 'GAP' : e.kind === 'tool_result' ? `r:${e.toolId}` : e.uuid));

const C0 = 'c1.0000000000000000.00.' + '0'.repeat(64);
const C1 = 'c1.0000000000000000.11.' + '1'.repeat(64);
const C2 = 'c1.0000000000000000.22.' + '2'.repeat(64);

const backlog = (events: ChatEvent[], older?: string, file = '/t/a.jsonl'): SessionStreamMsg => ({
  type: 'backlog', uuid: 'u', events, offset: 100, file, missing: false, fileMeasured: true, foreignAccount: null,
  searchComplete: true, ...(older !== undefined ? { older } : {}),
});
const answer = (end: OlderPageEnd, o: Partial<OlderPageAnswer> = {}): OlderPageAnswer =>
  ({ type: 'older-page', events: [], gap: false, end, ...o });

const snap = (o: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
  missingFile: null, strandedAccount: null, searchComplete: true, fileMeasured: true, file: null, ...o,
});
const asked = (s: SessionSnapshot, c: string): SessionSnapshot => ({ ...s, older: pagingAsked(s.older ?? NO_PAGING, c) });

describe('the decider', () => {
  it('a backlog with no continuation (an older server, or a stream that cannot page): no control, nothing to ask', () => {
    const p = pagingOfBacklog(NO_PAGING, undefined);
    expect(p.edge).toBe('none');
    expect(requestOf(p)).toBeNull();
  });

  it('a backlog\'s continuation is what the first request sends; one request at a time', () => {
    const p = pagingOfBacklog(NO_PAGING, C0);
    expect(p.edge).toBe('more');
    expect(requestOf(p)).toBe(C0);
    const q = pagingAsked(p, C0);
    expect(q.edge).toBe('loading');
    expect(requestOf(q)).toBeNull();
  });

  it('each end word reaches its own state, and only the ones a retry can help offer one', () => {
    const p = pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0);
    const on = (a: OlderPageAnswer): OlderPaging => answerPaging(p, { ...a, for: C0 }).paging;
    expect(on(answer('more', { continuation: C1 }))).toMatchObject({ edge: 'more', next: C1 });
    expect(on(answer('start'))).toMatchObject({ edge: 'start', next: null });
    expect(on(answer('busy'))).toMatchObject({ edge: 'busy', next: C0 });
    expect(on(answer('changed'))).toMatchObject({ edge: 'changed', next: null });
    expect(on(answer('absent'))).toMatchObject({ edge: 'absent', next: null });
    expect(on(answer('unreadable'))).toMatchObject({ edge: 'unreadable', next: C0 });
    expect(on(answer('unmeasured'))).toMatchObject({ edge: 'unmeasured', next: C0 });
    // A continuation the server no longer accepts: dropped quietly, no control until the next backlog's.
    expect(on(answer('invalid'))).toMatchObject({ edge: 'none', next: null });
    expect(on(answer('expired'))).toMatchObject({ edge: 'none', next: null });
    for (const edge of ['busy', 'unreadable', 'unmeasured'] as const) {
      expect(requestOf(on(answer(edge)))).toBe(C0);
    }
    for (const edge of ['start', 'changed', 'absent', 'invalid'] as const) expect(requestOf(on(answer(edge)))).toBeNull();
  });

  it('a `more` with no next continuation is never applied: the same request is offered again', () => {
    const p = pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0);
    const r = answerPaging(p, answer('more', { for: C0, events: [user('x')] }));
    expect(r.page).toBeNull();
    expect(r.paging).toMatchObject({ edge: 'unmeasured', next: C0 });
  });

  it('the socket dropping: the request outstanding is given up, the continuation kept for the next socket', () => {
    const p = pagingOfDrop(pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0));
    expect(p).toMatchObject({ asked: null, edge: 'more', next: C0, voided: 0 });
  });
});

describe('a late answer is never applied (the echo path)', () => {
  const voided = (): OlderPaging => pagingOfBacklog(pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0), C1);

  it('case A (the voided request is never answered): the new request\'s answer is applied', () => {
    const p = pagingAsked(voided(), C1);
    const r = answerPaging(p, answer('more', { for: C1, continuation: C2, events: [user('n')] }));
    expect(r.page?.events).toEqual([user('n')]);
    expect(r.paging.next).toBe(C2);
  });

  it('case B (the voided request is answered after the new backlog): that answer is dropped, the new one applied', () => {
    let p = pagingAsked(voided(), C1);
    const late = answerPaging(p, answer('more', { for: C0, continuation: C2, events: [user('stale')] }));
    expect(late.page).toBeNull();
    expect(late.paging).toEqual(p);
    p = late.paging;
    const own = answerPaging(p, answer('changed', { for: C1 }));
    expect(own.paging.edge).toBe('changed');
  });

  it('an answer for no request outstanding, or a second answer for the same continuation: dropped', () => {
    const p = pagingOfBacklog(NO_PAGING, C0);
    expect(answerPaging(p, answer('more', { for: C0, continuation: C1, events: [user('x')] })).page).toBeNull();
    const done = answerPaging(pagingAsked(p, C0), answer('more', { for: C0, continuation: C1, events: [user('x')] })).paging;
    const again = pagingAsked(done, C1);
    expect(answerPaging(again, answer('more', { for: C0, continuation: C1, events: [user('x')] })).page).toBeNull();
  });
});

describe('a late answer is never applied (no echo: the wave 171 server)', () => {
  const voided = (): OlderPaging => pagingOfBacklog(pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0), C1);

  it('case B: the first answer after the void is dropped, and the request outstanding is offered again', () => {
    const p = pagingAsked(voided(), C1);
    const late = answerPaging(p, answer('more', { continuation: C2, events: [user('stale')] }));
    expect(late.page).toBeNull();
    expect(late.paging).toMatchObject({ voided: 0, asked: null, edge: 'more', next: C1 });
    // The new request's own answer, arriving now with no request outstanding: dropped too.
    expect(answerPaging(late.paging, answer('more', { continuation: C2, events: [user('n')] })).page).toBeNull();
    // Asked again, its answer is applied.
    const again = answerPaging(pagingAsked(late.paging, C1), answer('more', { continuation: C2, events: [user('n')] }));
    expect(again.page?.events).toEqual([user('n')]);
  });

  it('case A: the new request\'s own answer is dropped once (it cannot be told from a late one), then asked again', () => {
    const p = pagingAsked(voided(), C1);
    const first = answerPaging(p, answer('more', { continuation: C2, events: [user('n')] }));
    expect(first.page).toBeNull();
    expect(requestOf(first.paging)).toBe(C1);
  });

  it('a busy answer applies nothing and drops nothing', () => {
    const p = pagingAsked(voided(), C1);
    const busy = answerPaging(p, answer('busy'));
    expect(busy.paging).toMatchObject({ voided: 1, asked: null, edge: 'busy' });
  });
});

describe('the reducer: pages before the rows held, in order, each row once', () => {
  it('repeated pages prepend oldest first, after a rotation\'s leading divider', () => {
    let s = applySessionMsg(snap({ uuid: 'u' }), { type: 'rotated', uuid: 'u' });
    s = applySessionMsg(s, backlog(rows('b', 3), C0));
    s = applySessionMsg(asked(s, C0), answer('more', { for: C0, continuation: C1, events: rows('p1-', 2) }));
    s = applySessionMsg(asked(s, C1), answer('start', { for: C1, events: rows('p0-', 2) }));
    expect(s.events[0]!.kind === 'system' && s.events[0]!.text).toBe('Session context reset');
    expect(uuids(s.events.slice(1))).toEqual(['p0-0', 'p0-1', 'p1-0', 'p1-1', 'b0', 'b1', 'b2']);
    expect(s.older).toMatchObject({ edge: 'start', pages: 2, rows: 4 });
  });

  it('a page carrying a row already held shows it once', () => {
    let s = applySessionMsg(snap(), backlog(rows('b', 2), C0));
    s = applySessionMsg(asked(s, C0), answer('more', { for: C0, continuation: C1, events: [user('p'), user('b0')] }));
    expect(uuids(s.events)).toEqual(['p', 'b0', 'b1']);
  });

  it('a gap is shown where it is: between the page and the rows held; two with nothing between are one', () => {
    let s = applySessionMsg(snap(), backlog(rows('b', 2), C0));
    s = applySessionMsg(asked(s, C0), answer('more', { for: C0, continuation: C1, gap: true }));
    s = applySessionMsg(asked(s, C1), answer('more', { for: C1, continuation: C2, gap: true }));
    expect(uuids(s.events)).toEqual(['GAP', 'b0', 'b1']);
    s = applySessionMsg(asked(s, C2), answer('start', { for: C2, events: rows('p', 2) }));
    expect(uuids(s.events)).toEqual(['p0', 'p1', 'GAP', 'b0', 'b1']);
    // The marker takes the time of the row it sits above, so it draws no time divider of its own.
    expect(s.events[2]!.ts).toBe(TS);
  });

  it('a new backlog replaces the rows and starts paging again from its own continuation', () => {
    let s = applySessionMsg(snap(), backlog(rows('b', 2), C0));
    s = applySessionMsg(asked(s, C0), answer('more', { for: C0, continuation: C1, events: rows('p', 2) }));
    s = applySessionMsg(s, backlog(rows('n', 2), C2));
    expect(uuids(s.events)).toEqual(['n0', 'n1']);
    expect(s.older).toMatchObject({ next: C2, edge: 'more', rows: 0, pages: 0 });
  });

  it('a rotation with a request outstanding voids it; the backlog after it starts again', () => {
    let s = applySessionMsg(asked(applySessionMsg(snap({ uuid: 'u' }), backlog(rows('b', 2), C0)), C0), { type: 'rotated', uuid: 'u' });
    expect(s.older).toMatchObject({ edge: 'none', next: null, asked: null });
    s = applySessionMsg(s, backlog(rows('n', 1), C1));
    const late = applySessionMsg(s, answer('more', { for: C0, continuation: C2, events: rows('stale', 1) }));
    expect(late.events).toBe(s.events);
    expect(late.older).toEqual(s.older);
  });
});

describe('older rows are display only', () => {
  it('a page moves no question, approval, dialog, status, task list, mail, helper report or pending-send echo', () => {
    const before = applySessionMsg(snap({
      ask: { questions: [] } as unknown as SessionSnapshot['ask'], dialog: { id: 'd1' } as unknown as SessionSnapshot['dialog'],
      status: 'idle' as SessionSnapshot['status'], statusUpdatedAt: 5, reports: {}, agents: [],
    }), backlog(rows('b', 1), C0));
    const after = applySessionMsg(asked(before, C0), answer('more', {
      for: C0, continuation: C1, events: [user('old-q', 'Promote?'), { kind: 'tool_use', uuid: 'o', ts: TS, toolId: 't', name: 'AskUserQuestion', input: '{}' }],
    }));
    for (const k of ['ask', 'dialog', 'status', 'statusUpdatedAt', 'tasks', 'mail', 'reports', 'agents', 'askEpoch', 'pairing'] as const) {
      expect(after[k]).toEqual(before[k]);
    }
  });

  it('the fold\'s live boundary: every item drawn from an older row comes before `liveFrom`', () => {
    let s = applySessionMsg(snap(), backlog([user('b0'), { kind: 'tool_use', uuid: 'b1', ts: TS, toolId: 't1', name: 'Read', input: '{}' }], C0));
    s = applySessionMsg(asked(s, C0), answer('start', {
      for: C0, events: [user('p0'), { kind: 'tool_use', uuid: 'p1', ts: TS, toolId: 't0', name: 'AskUserQuestion', input: '{}' }],
    }));
    const items = buildChatItems(s.events, [], false);
    const from = liveFromOf(items, s.events, s.older!);
    expect(items.slice(0, from).map((i) => i.key)).toEqual(expect.arrayContaining(['p0', 't0']));
    expect(items.slice(from).map((i) => i.key)).toEqual(expect.arrayContaining(['b0', 't1']));
    expect(liveFromOf(items, s.events, NO_PAGING)).toBe(0);
  });
});

function fakeSocket(): { ws: WebSocket; sent: unknown[]; open: () => void; emit: (m: unknown) => void; close: () => void } {
  const sent: unknown[] = [];
  const ws = {
    onopen: null as null | (() => void), onmessage: null as null | ((e: { data: string }) => void),
    onclose: null as null | (() => void), onerror: null, readyState: 1,
    send(raw: string): void { sent.push(JSON.parse(raw)); },
    close(): void { /* noop */ },
  };
  return {
    ws: ws as unknown as WebSocket, sent, open: () => ws.onopen?.(),
    emit: (m) => ws.onmessage?.({ data: JSON.stringify(m) }),
    close: () => { ws.readyState = 3; ws.onclose?.(); },
  };
}

describe('the store: requests on the socket', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  const opened = () => {
    const sock = fakeSocket();
    const store = createSessionStore('lane-a-project-a', { makeSocket: () => sock.ws, api: { prompt: vi.fn() } });
    store.getState().connect();
    sock.open();
    return { sock, store };
  };
  const pageRequests = (sent: unknown[]): unknown[] => sent.filter((m) => (m as { type?: string }).type === 'older-page');

  it('loadOlder sends the backlog\'s continuation and nothing else, once while it is outstanding', () => {
    const { sock, store } = opened();
    sock.emit(backlog(rows('b', 2), C0));
    store.getState().loadOlder();
    store.getState().loadOlder();
    expect(pageRequests(sock.sent)).toEqual([{ type: 'older-page', continuation: C0 }]);
    expect(store.getState().older.edge).toBe('loading');
    sock.emit(answer('more', { for: C0, continuation: C1, events: rows('p', 1) }));
    store.getState().loadOlder();
    expect(pageRequests(sock.sent)).toEqual([{ type: 'older-page', continuation: C0 }, { type: 'older-page', continuation: C1 }]);
    store.getState().disconnect();
  });

  it('an older server: no continuation, no request, no state beyond `none`', () => {
    const { sock, store } = opened();
    sock.emit(backlog(rows('b', 2)));
    store.getState().loadOlder();
    expect(pageRequests(sock.sent)).toEqual([]);
    expect(store.getState().older).toEqual(NO_PAGING);
    store.getState().disconnect();
  });

  it('a reconnect with a request outstanding: the request is void, the continuation kept, asked again on the next socket', () => {
    const socks = [fakeSocket(), fakeSocket()];
    let n = 0;
    const store = createSessionStore('lane-a-project-a', { makeSocket: () => socks[n++]!.ws, api: { prompt: vi.fn() } });
    store.getState().connect();
    socks[0]!.open();
    socks[0]!.emit(backlog(rows('b', 2), C0));
    store.getState().loadOlder();
    socks[0]!.close();
    expect(store.getState().older).toMatchObject({ asked: null, edge: 'more', next: C0 });
    // A late answer on the old socket never reaches the store (the socket's identity guard).
    socks[0]!.emit(answer('more', { for: C0, continuation: C1, events: rows('stale', 1) }));
    expect(uuids(store.getState().events)).toEqual(['b0', 'b1']);
    store.getState().disconnect();
  });
});
