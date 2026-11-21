// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4.3, §8 Table 11): the store's half of the
// helper-report request. `requestHelperReport(id)` sends `{ type: 'helper-report', id }` on the session socket;
// `applySessionMsg` applies the answer `{ type: 'helper-report', id, report, cut }` into `reports`, deciding nothing. The
// reports go with the rows: a workflows frame keeps only those of ids it still carries, and every reset site that clears
// the helper rows clears them (a backlog onto another transcript, the initial state, `disconnect()`). An older server
// never answers (it reads the request as null and ignores it, `server.ts#asSessionClientMsg`): the report stays unknown,
// which is not the same as an answer that there is none.
//
// RED FIRST: committed before the code, against origin/main, where the store has no reports and sends no request.
import { beforeEach, describe, expect, it } from 'vitest';
import { applySessionMsg, createSessionStore, type SessionSnapshot } from '../src/stores/session';
import type { SessionStreamMsg } from '../../shared/api';
import type { AgentHelperView } from '../../shared/workflows';

type Reports = Readonly<Record<string, { report: string | null; cut: boolean; end: number | null }>>;
type WithReports = SessionSnapshot & { reports?: Reports };

const snap = (o: Partial<WithReports> = {}): WithReports => ({
  events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
  missingFile: null, strandedAccount: null, searchComplete: true, fileMeasured: true, file: null, ...o,
});
const helper = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: 'look around', agentType: 'Explore', model: 'model-a', effort: 'high', state: 'done',
  startedAt: 1_000, endedAt: 5_000, lastActivityAt: 4_000, tokens: null, summary: 'ok', hasReport: true, ...o,
});
const answer = (id: string, report: string | null, cut = false): SessionStreamMsg =>
  ({ type: 'helper-report', id, report, cut } as unknown as SessionStreamMsg);
const reportsOf = (s: SessionSnapshot): Reports | undefined => (s as WithReports).reports;

function fakeSocket(): { ws: WebSocket; sent: unknown[]; open: () => void } {
  const sent: unknown[] = [];
  const ws = {
    onopen: null as null | (() => void), onmessage: null, onclose: null, onerror: null, readyState: 1,
    send(raw: string): void { sent.push(JSON.parse(raw)); },
    close(): void { /* noop */ },
  };
  return { ws: ws as unknown as WebSocket, sent, open: () => ws.onopen?.() };
}

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('applySessionMsg: the helper-report answer', () => {
  it('an answer is applied as stated, by id', () => {
    const s = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', 'the report', true));
    expect(reportsOf(s)).toEqual({ a1: { report: 'the report', cut: true, end: 5_000 } });
  });

  it('an answer that there is no report (an unknown or evicted id) is kept as that answer: report null', () => {
    const s = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', null));
    expect(reportsOf(s)).toEqual({ a1: { report: null, cut: false, end: 5_000 } });
  });

  it('a second answer for the same id replaces the first; another id\'s stays', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1'), helper('a2')] }), answer('a1', 'one'));
    s = applySessionMsg(s, answer('a2', 'two'));
    s = applySessionMsg(s, answer('a1', 'one again'));
    expect(reportsOf(s)).toEqual({ a1: { report: 'one again', cut: false, end: 5_000 }, a2: { report: 'two', cut: false, end: 5_000 } });
  });

  it('a workflows frame keeps only the reports of ids it still carries (the rows that left take theirs)', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1'), helper('a2')] }), answer('a1', 'one'));
    s = applySessionMsg(s, answer('a2', 'two'));
    s = applySessionMsg(s, { type: 'workflows', workflows: [], agents: [helper('a2')] });
    expect(reportsOf(s)).toEqual({ a2: { report: 'two', cut: false, end: 5_000 } });
  });

  it('an older server\'s frame (no `agents`) carries no row, so it keeps no report', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', 'one'));
    s = applySessionMsg(s, { type: 'workflows', workflows: [] });
    expect(reportsOf(s)).toEqual({});
  });

  it('a backlog onto another transcript clears them with the rows; one onto the same transcript keeps them', () => {
    const base = applySessionMsg(snap({ agents: [helper('a1')], file: '/t/a.jsonl' }), answer('a1', 'one'));
    const same = applySessionMsg(base, { type: 'backlog', uuid: 'u', events: [], offset: 0, file: '/t/a.jsonl', missing: false });
    expect(reportsOf(same)).toEqual({ a1: { report: 'one', cut: false, end: 5_000 } });
    const other = applySessionMsg(base, { type: 'backlog', uuid: 'u', events: [], offset: 0, file: '/t/b.jsonl', missing: false });
    expect(reportsOf(other)).toEqual({});
  });

  it('a helper continued and ended again never shows its earlier report: done with an answer, running, done at a new end (review 3072 F2)', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', 'the first report'));
    expect(reportsOf(s)).toEqual({ a1: { report: 'the first report', cut: false, end: 5_000 } });
    s = applySessionMsg(s, { type: 'workflows', workflows: [], agents: [helper('a1', { state: 'running', endedAt: null, hasReport: false })] });
    s = applySessionMsg(s, { type: 'workflows', workflows: [], agents: [helper('a1', { endedAt: 9_000 })] });
    expect(reportsOf(s), 'the new end has no answer yet').toEqual({});
  });

  it('an answer is kept only while its row is drawn with a report at the same end', () => {
    const base = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', 'one'));
    const noReport = applySessionMsg(base, { type: 'workflows', workflows: [], agents: [helper('a1', { hasReport: false })] });
    expect(reportsOf(noReport)).toEqual({});
    const moved = applySessionMsg(base, { type: 'workflows', workflows: [], agents: [helper('a1', { endedAt: 6_000 })] });
    expect(reportsOf(moved)).toEqual({});
    const same = applySessionMsg(base, { type: 'workflows', workflows: [], agents: [helper('a1')] });
    expect(reportsOf(same)).toEqual({ a1: { report: 'one', cut: false, end: 5_000 } });
  });

  it('an answer for a row not drawn with a report is for no row, and is not kept', () => {
    expect(reportsOf(applySessionMsg(snap({ agents: [helper('a1', { hasReport: false })], reports: {} }), answer('a1', 'x')))).toEqual({});
    expect(reportsOf(applySessionMsg(snap({ agents: [], reports: {} }), answer('a9', 'x')))).toEqual({});
  });
});

describe('the store: the request, and the reset sites', () => {
  it('requestHelperReport sends one helper-report request on the open socket', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-a', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    f.sent.length = 0;
    (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport('a1');
    expect(f.sent).toEqual([{ type: 'helper-report', id: 'a1' }]);
    store.getState().disconnect();
  });

  it('the store asks once per id and end on a stream; a new end asks again (review 3072 F2, F4)', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-e', { makeSocket: () => f.ws });
    const ask = (id: string): void => (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport(id);
    store.getState().connect();
    f.open();
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    f.sent.length = 0;
    ask('a1');
    ask('a1');
    expect(f.sent, 'one ask for a1 at its end').toEqual([{ type: 'helper-report', id: 'a1' }]);
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1', { endedAt: 9_000 })] });
    ask('a1');
    expect(f.sent, 'a new end asks again').toHaveLength(2);
    store.getState().disconnect();
  });

  it('an ask that did not go (the socket not open) is forgotten, so the row asks again (review 3072 F4)', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-f', { makeSocket: () => f.ws });
    const ask = (id: string): void => (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport(id);
    store.getState().connect();
    f.open();
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    f.sent.length = 0;
    (f.ws as unknown as { readyState: number }).readyState = 3; // CLOSED: the send does not go
    ask('a1');
    expect(f.sent).toEqual([]);
    (f.ws as unknown as { readyState: number }).readyState = 1;
    ask('a1');
    expect(f.sent).toEqual([{ type: 'helper-report', id: 'a1' }]);
    store.getState().disconnect();
  });

  it('a stream\'s first workflows frame forgets its asks: an ask made before the server had read is made again (review 3072 F4)', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-g', { makeSocket: () => f.ws });
    const ask = (id: string): void => (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport(id);
    // The rows kept across a reconnect (same transcript), and a new stream that has not framed yet.
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    store.getState().connect();
    f.open();
    f.sent.length = 0;
    ask('a1'); // the server answers nothing before its first reading
    ask('a1');
    expect(f.sent).toHaveLength(1);
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] }); // this stream's first frame
    ask('a1');
    expect(f.sent, 'asked again after the first frame').toHaveLength(2);
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] }); // a later frame forgets nothing
    ask('a1');
    expect(f.sent).toHaveLength(2);
    store.getState().disconnect();
  });

  it('after a drop, the new stream\'s first frame forgets the asks of the old one (review 3072 F4)', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-h', { makeSocket: () => f.ws });
    const ask = (id: string): void => (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport(id);
    store.getState().connect();
    f.open();
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    f.sent.length = 0;
    ask('a1');
    expect(f.sent).toHaveLength(1);
    (f.ws as unknown as { onclose: (() => void) | null }).onclose?.(); // the stream drops
    window.dispatchEvent(new Event('online')); // reconnect at once
    f.open();
    f.sent.length = 0;
    ask('a1');
    expect(f.sent, 'the old stream\'s ask stands until the new one frames').toEqual([]);
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    ask('a1');
    expect(f.sent).toEqual([{ type: 'helper-report', id: 'a1' }]);
    store.getState().disconnect();
  });

  it('a request with no socket sends nothing and does not throw', () => {
    const store = createSessionStore('cc-h2-b', { makeSocket: () => fakeSocket().ws });
    expect(() => (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport('a1')).not.toThrow();
  });

  it('an older server never answers: after a request the report stays unknown (absent), never "none"', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-c', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    (store.getState() as unknown as { requestHelperReport(id: string): void }).requestHelperReport('a1');
    expect((store.getState() as unknown as { reports: Reports }).reports).toEqual({});
    store.getState().disconnect();
  });

  it('the initial state has no reports, and disconnect() clears them with the helper rows', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-h2-d', { makeSocket: () => f.ws });
    expect((store.getState() as unknown as { reports: Reports }).reports).toEqual({});
    store.getState().connect();
    f.open();
    store.getState().apply({ type: 'workflows', workflows: [], agents: [helper('a1')] });
    store.getState().apply(answer('a1', 'one'));
    expect((store.getState() as unknown as { reports: Reports }).reports).toEqual({ a1: { report: 'one', cut: false, end: 5_000 } });
    store.getState().disconnect();
    expect((store.getState() as unknown as { reports: Reports }).reports).toEqual({});
  });
});
