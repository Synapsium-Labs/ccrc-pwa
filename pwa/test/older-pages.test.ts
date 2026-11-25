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
  BUSY_PAUSE_MS, BUSY_RETRIES, NO_PAGING, answerPaging, isGapMarker, leadOf, liveFromOf, pagingAsked, pagingOfBacklog, pagingOfDrop,
  prependPage, requestOf, retryDue, type OlderPaging,
} from '../src/session/olderPages';
import { buildChatItems } from '../src/session/chatItems';
import { foldMailRows } from '../src/session/mailRows';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
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
    // `busy` is asked again on its own first (fix round 1, A6: see 'busy is asked again on its own').
    expect(on(answer('busy'))).toMatchObject({ edge: 'loading', next: C0, asked: null, busy: 1 });
    expect(on(answer('changed'))).toMatchObject({ edge: 'changed', next: null });
    expect(on(answer('absent'))).toMatchObject({ edge: 'absent', next: null });
    expect(on(answer('unreadable'))).toMatchObject({ edge: 'unreadable', next: C0 });
    expect(on(answer('unmeasured'))).toMatchObject({ edge: 'unmeasured', next: C0 });
    // A continuation the server no longer accepts: said, with no control, until the next backlog's (fix round 1, A5).
    expect(on(answer('invalid'))).toMatchObject({ edge: 'expired', next: null });
    expect(on(answer('expired'))).toMatchObject({ edge: 'expired', next: null });
    for (const edge of ['busy', 'unreadable', 'unmeasured'] as const) {
      expect(requestOf(on(answer(edge)))).toBe(C0);
    }
    for (const edge of ['start', 'changed', 'absent', 'invalid', 'expired'] as const) {
      expect(requestOf(on(answer(edge)))).toBeNull();
    }
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
    expect(busy.paging).toMatchObject({ voided: 1, asked: null, edge: 'loading', busy: 1 });
  });

  it('A3: the given-up request\'s own answer, arriving after its re-ask was answered, is never applied as the next page', () => {
    // A request crossing a backlog is answered after it (case B), so the first answer after the void is dropped and the
    // outstanding request given up; it is asked again at once (the reader near the top).
    let p = pagingAsked(voided(), C1);
    p = answerPaging(p, answer('more', { continuation: C2, events: [user('late')] })).paging;
    p = pagingAsked(p, C1);
    // The given-up request's answer: the page for C1, applied (it is the right page, whichever request it answers).
    const first = answerPaging(p, answer('more', { continuation: C2, events: [user('one')] }));
    expect(first.page?.events).toEqual([user('one')]);
    p = pagingAsked(first.paging, C2);
    // The re-ask's answer: the page for C1 again, its continuation C2, the request outstanding. Dropped; C2 still asked.
    const twice = answerPaging(p, answer('more', { continuation: C2, events: [user('one')] }));
    expect(twice.page).toBeNull();
    expect(twice.paging).toEqual(p);
    // C2's own answer carries the continuation after it, and is applied.
    expect(answerPaging(p, answer('start', { events: [user('two')] })).page?.events).toEqual([user('two')]);
  });

  it('A3: when the voided request is never answered (the server dropped it), paging goes on: nothing stalls', () => {
    // The common case: the voided request's page was dropped by the server, so the first answer after the void is the
    // new request's own. Dropped once (it cannot be told from a late one), then every later answer applies.
    let p = pagingAsked(voided(), C1);
    p = answerPaging(p, answer('more', { continuation: C2, events: [user('own')] })).paging;
    expect(p.voided).toBe(0);
    p = pagingAsked(p, C1);
    const again = answerPaging(p, answer('more', { continuation: C2, events: [user('own')] }));
    expect(again.page?.events).toEqual([user('own')]);
    expect(requestOf(again.paging)).toBe(C2);
  });
});

describe('busy is asked again on its own (fix round 1, A6)', () => {
  for (const echo of [true, false]) {
    it(`${echo ? 'the echo' : 'no echo'}: ${BUSY_RETRIES} retries, one request at a time, saying loading; then Try again`, () => {
      let p = pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0);
      const busy = (): OlderPageAnswer => answer('busy', echo ? { for: C0 } : {});
      for (let n = 1; n <= BUSY_RETRIES; n += 1) {
        p = answerPaging(p, busy()).paging;
        expect(p).toMatchObject({ edge: 'loading', asked: null, busy: n });
        expect(retryDue(p)).toBe(true);
        expect(requestOf(p)).toBe(C0);
        p = pagingAsked(p, C0);
        expect(retryDue(p)).toBe(false);
        expect(requestOf(p)).toBeNull();
      }
      p = answerPaging(p, busy()).paging;
      expect(p).toMatchObject({ edge: 'busy', asked: null });
      expect(retryDue(p)).toBe(false);
      // Try again starts the retries over.
      p = pagingAsked(p, C0);
      expect(p.busy).toBe(0);
      expect(answerPaging(p, busy()).paging).toMatchObject({ edge: 'loading', busy: 1 });
    });
  }

  it('an answer that is not busy ends the run of retries', () => {
    let p = pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0);
    p = pagingAsked(answerPaging(p, answer('busy', { for: C0 })).paging, C0);
    p = answerPaging(p, answer('more', { for: C0, continuation: C1, events: [user('x')] })).paging;
    expect(p).toMatchObject({ edge: 'more', busy: 0 });
  });

  it('the socket dropping while a retry waits: given up, the control offers it', () => {
    const p = answerPaging(pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0), answer('busy', { for: C0 })).paging;
    expect(pagingOfDrop(p)).toMatchObject({ edge: 'more', busy: 0, next: C0 });
    expect(retryDue(pagingOfDrop(p))).toBe(false);
  });
});

describe('an expired continuation is said, never silent (fix round 1, A5)', () => {
  it('no control, and a backlog with a continuation clears it', () => {
    const p = answerPaging(pagingAsked(pagingOfBacklog(NO_PAGING, C0), C0), answer('expired', { for: C0 })).paging;
    expect(p.edge).toBe('expired');
    expect(requestOf(p)).toBeNull();
    // A resumed stream (a reconnect with no backlog) leaves it standing.
    expect(pagingOfDrop(p).edge).toBe('expired');
    expect(pagingOfBacklog(p, C1)).toMatchObject({ edge: 'more', next: C1 });
  });
});

describe('the gap marker draws one time divider (fix round 1, A4)', () => {
  const at = (uuid: string, ts: string): ChatEvent => ({ kind: 'user', uuid, ts, text: uuid });
  const gap = (ts: string): ChatEvent => ({ kind: 'system', uuid: 'local-gap-1', ts, text: 'gap' });
  const dividers = (events: ChatEvent[]): number => buildChatItems(events, [], false).filter((i) => i.kind === 'divider').length;

  it('its time is the page\'s newest row, so the row below it draws the one divider the gap in time needs', () => {
    const held = [at('h1', '2026-11-24T12:00:00.000Z')];
    const page = { events: [at('p1', '2026-11-24T10:00:00.000Z')], gap: true };
    const out = prependPage(held, page, gap);
    expect(uuids(out)).toEqual(['p1', 'GAP', 'h1']);
    expect(out[1]!.ts).toBe('2026-11-24T10:00:00.000Z');
    // One divider over p1 (the first row) and one under the marker, over h1: two hours apart. Never a third.
    expect(dividers(out)).toBe(2);
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

  it('the drawn list\'s lead is the reset row and its divider; a page goes after it, so the row after it tells (fix round 2, F1)', () => {
    let s = applySessionMsg(snap({ uuid: 'u' }), { type: 'rotated', uuid: 'u' });
    s = applySessionMsg(s, backlog(rows('b', 3), C0));
    const before = buildChatItems(s.events, [], false);
    expect(leadOf(before)).toBe(2); // the reset row's time divider, then the reset row
    expect(before[leadOf(before)]!.key).toBe('div-b0');
    s = applySessionMsg(asked(s, C0), answer('more', { for: C0, continuation: C1, events: rows('p1-', 2) }));
    const after = buildChatItems(s.events, [], false);
    expect(after.slice(0, 2).map((i) => i.key)).toEqual(before.slice(0, 2).map((i) => i.key)); // the first row never changes
    expect(leadOf(after)).toBe(2);
    expect(after[leadOf(after)]!.key).toBe('div-p1-0'); // the row after the lead does
    // No reset row: no lead, whatever the first row is. A gap marker belongs to the pages, never to the lead.
    expect(leadOf(buildChatItems(rows('b', 2), [], false))).toBe(0);
    const gapped = prependPage(rows('b', 2), { events: [], gap: true }, (ts) => ({ kind: 'system', uuid: 'local-gap-1', ts, text: 'gap' }));
    expect(leadOf(buildChatItems(gapped, [], false))).toBe(0);
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

  it('measured on the list after the mail fold: a run of mail prompts across the boundary is live when any prompt is', () => {
    const nudge = (uuid: string): ChatEvent => user(uuid, `${INJECTED_PROMPTS['mail-nudge'].text} Use the client.`);
    let s = applySessionMsg(snap(), backlog([nudge('b0'), user('b1')], C0));
    s = applySessionMsg(asked(s, C0), answer('start', { for: C0, events: [user('p0'), nudge('p1')] }));
    const items = foldMailRows(buildChatItems(s.events, [], false), 'lane-a-project-a');
    const run = items.findIndex((i) => i.kind === 'mail-prompts');
    expect(run, 'the older prompt and the live one are not one run').toBeGreaterThan(-1);
    expect(liveFromOf(items, s.events, s.older!)).toBe(run);
    // A lone prompt is read by its own event: one older row, then a live prompt.
    const events = [user('o0'), nudge('l1')];
    const lone = foldMailRows(buildChatItems(events, [], false), 'lane-a-project-a');
    expect(liveFromOf(lone, events, { ...NO_PAGING, rows: 1 })).toBe(lone.findIndex((i) => i.kind === 'mail-prompt'));
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

  it('fix round 1, A6: a busy answer is asked again on its own after the pause, one request at a time', () => {
    vi.useFakeTimers();
    try {
      const { sock, store } = opened();
      sock.emit(backlog(rows('b', 2), C0));
      store.getState().loadOlder();
      sock.emit(answer('busy', { for: C0 }));
      expect(store.getState().older).toMatchObject({ edge: 'loading', asked: null, busy: 1 });
      expect(pageRequests(sock.sent)).toHaveLength(1);
      vi.advanceTimersByTime(BUSY_PAUSE_MS - 1);
      expect(pageRequests(sock.sent), 'asked again before the pause').toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(pageRequests(sock.sent)).toEqual([{ type: 'older-page', continuation: C0 }, { type: 'older-page', continuation: C0 }]);
      expect(store.getState().older).toMatchObject({ edge: 'loading', asked: C0 });
      vi.advanceTimersByTime(BUSY_PAUSE_MS * 4);
      expect(pageRequests(sock.sent), 'a retry while one is outstanding').toHaveLength(2);
      store.getState().disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  /** A store whose sockets are made in turn, each one's address kept. */
  const reopening = () => {
    const socks = [fakeSocket(), fakeSocket(), fakeSocket(), fakeSocket()];
    const urls: string[] = [];
    let n = 0;
    const store = createSessionStore('lane-a-project-a', {
      makeSocket: (url) => { urls.push(url); return socks[n++]!.ws; }, api: { prompt: vi.fn() },
    });
    return { socks, urls, store };
  };
  /** Connect, take a backlog with `C0`, and have the server answer the first page with `end`. */
  const pagedTo = (r: ReturnType<typeof reopening>, end: OlderPageEnd): void => {
    r.store.getState().connect();
    r.socks[0]!.open();
    r.socks[0]!.emit(backlog(rows('b', 2), C0));
    r.store.getState().loadOlder();
    r.socks[0]!.emit(answer(end, { for: C0 }));
  };
  const resumes = (url: string): boolean => url.includes('?since=') && url.includes('sinceFile=');
  /** Run the clock until the socket's next attempt is made (fake timers), and no further. */
  const nextAttempt = (r: ReturnType<typeof reopening>): void => {
    const n = r.urls.length;
    for (let t = 0; t < 60_000 && r.urls.length === n; t += 50) vi.advanceTimersByTime(50);
  };

  it('fix round 2, F2: a chat opened again while its older edge reads expired connects as a first open, and Load older is back', () => {
    vi.useFakeTimers();
    try {
      const r = reopening();
      pagedTo(r, 'expired');
      expect(r.store.getState().older.edge).toBe('expired');
      expect(resumes(r.urls[0]!)).toBe(false); // the first open of all: no position yet
      r.store.getState().disconnect(); // the reader leaves the chat
      expect(r.store.getState().older.edge, 'the words stand while away').toBe('expired');
      r.store.getState().connect(); // and opens it again
      expect(r.urls[1], 'opened again with its resume position: a resumed stream brings no backlog').not.toContain('since=');
      r.socks[1]!.open();
      r.socks[1]!.emit(backlog(rows('b', 3), C1));
      expect(r.store.getState().older).toMatchObject({ edge: 'more', next: C1 });
      // From that backlog on, the open screen's reconnect resumes as always.
      r.socks[1]!.close();
      nextAttempt(r);
      expect(r.urls).toHaveLength(3);
      expect(resumes(r.urls[2]!), 'a reconnect after the fresh backlog').toBe(true);
      r.store.getState().disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fix round 2, F2: a drop before the fresh open\'s backlog asks fresh again; it is still the same open', () => {
    vi.useFakeTimers();
    try {
      const r = reopening();
      pagedTo(r, 'invalid');
      r.store.getState().disconnect();
      r.store.getState().connect();
      r.socks[1]!.open();
      r.socks[1]!.close(); // gone before its backlog
      nextAttempt(r);
      expect(r.urls[2], 'the retry of the open').not.toContain('since=');
      r.store.getState().disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fix round 2, F2: a reconnect of the open screen keeps its resume position, expired or not', () => {
    vi.useFakeTimers();
    try {
      const r = reopening();
      pagedTo(r, 'expired');
      r.socks[0]!.close(); // the socket drops under the open screen
      nextAttempt(r);
      expect(r.urls).toHaveLength(2);
      expect(resumes(r.urls[1]!), 'the open screen\'s reconnect').toBe(true);
      expect(r.urls[1]).toContain(`since=${encodeURIComponent(r.store.getState().uuid!)}:${r.store.getState().offset}`);
      expect(r.store.getState().older.edge).toBe('expired');
      r.store.getState().disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fix round 2, F2: opened again in any other state, the chat resumes as before', () => {
    for (const end of ['start', 'changed', 'busy', 'unreadable', 'unmeasured'] as const) {
      const r = reopening();
      pagedTo(r, end);
      expect(r.store.getState().older.edge).not.toBe('expired');
      r.store.getState().disconnect();
      r.store.getState().connect();
      expect(resumes(r.urls[1]!), `opened again after "${end}"`).toBe(true);
      r.store.getState().disconnect();
    }
  });

  it('fix round 2, A3: a retry timer that fires after the reader left and opened the chat again asks nothing they did not', () => {
    vi.useFakeTimers();
    try {
      const r = reopening();
      pagedTo(r, 'busy');
      expect(r.store.getState().older).toMatchObject({ edge: 'loading', busy: 1 });
      r.store.getState().disconnect(); // leaving the screen does not clear the retry's timer
      expect(r.store.getState().older).toMatchObject({ edge: 'more', asked: null, busy: 0 });
      r.store.getState().connect(); // opened again within the pause
      r.socks[1]!.open();
      vi.advanceTimersByTime(BUSY_PAUSE_MS * 2);
      expect(pageRequests(r.socks[1]!.sent), 'the old timer asked on the new socket').toEqual([]);
      expect(r.store.getState().older).toMatchObject({ edge: 'more', asked: null });
      r.store.getState().disconnect();
    } finally {
      vi.useRealTimers();
    }
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
