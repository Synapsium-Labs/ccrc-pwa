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

type Reports = Readonly<Record<string, { report: string | null; cut: boolean }>>;
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
    expect(reportsOf(s)).toEqual({ a1: { report: 'the report', cut: true } });
  });

  it('an answer that there is no report (an unknown or evicted id) is kept as that answer: report null', () => {
    const s = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', null));
    expect(reportsOf(s)).toEqual({ a1: { report: null, cut: false } });
  });

  it('a second answer for the same id replaces the first; another id\'s stays', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1'), helper('a2')] }), answer('a1', 'one'));
    s = applySessionMsg(s, answer('a2', 'two'));
    s = applySessionMsg(s, answer('a1', 'one again'));
    expect(reportsOf(s)).toEqual({ a1: { report: 'one again', cut: false }, a2: { report: 'two', cut: false } });
  });

  it('a workflows frame keeps only the reports of ids it still carries (the rows that left take theirs)', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1'), helper('a2')] }), answer('a1', 'one'));
    s = applySessionMsg(s, answer('a2', 'two'));
    s = applySessionMsg(s, { type: 'workflows', workflows: [], agents: [helper('a2')] });
    expect(reportsOf(s)).toEqual({ a2: { report: 'two', cut: false } });
  });

  it('an older server\'s frame (no `agents`) carries no row, so it keeps no report', () => {
    let s = applySessionMsg(snap({ agents: [helper('a1')] }), answer('a1', 'one'));
    s = applySessionMsg(s, { type: 'workflows', workflows: [] });
    expect(reportsOf(s)).toEqual({});
  });

  it('a backlog onto another transcript clears them with the rows; one onto the same transcript keeps them', () => {
    const base = applySessionMsg(snap({ agents: [helper('a1')], file: '/t/a.jsonl' }), answer('a1', 'one'));
    const same = applySessionMsg(base, { type: 'backlog', uuid: 'u', events: [], offset: 0, file: '/t/a.jsonl', missing: false });
    expect(reportsOf(same)).toEqual({ a1: { report: 'one', cut: false } });
    const other = applySessionMsg(base, { type: 'backlog', uuid: 'u', events: [], offset: 0, file: '/t/b.jsonl', missing: false });
    expect(reportsOf(other)).toEqual({});
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
    expect((store.getState() as unknown as { reports: Reports }).reports).toEqual({ a1: { report: 'one', cut: false } });
    store.getState().disconnect();
    expect((store.getState() as unknown as { reports: Reports }).reports).toEqual({});
  });
});
