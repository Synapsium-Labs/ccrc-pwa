// W7 C7g (D-7185, D-7485; ARCH-57 #792, PWA half), and C7p (D-7194, D-7540): the answer
// lifecycle's commands on W3 Q3f's operator door, `POST /api/questions/session-<id>/answer`, the one door the PWA answers
// an operator question through.
//
// The bodies below are Q3f's own: `server/test/question-doors.test.ts` builds the family side of every operator row as
// `{ kind: 'ask', ...body }` (its `opAsk`) and `{ kind: 'dialog', ...(multi ? { multi: true } : {}), ...body }` (its
// `opDialog`). Each row here pins the PWA's request to that shape, byte for byte, and reads it back through the server's
// own readers in `shared/api.ts` (`parseQuestionId`, `readDialogAnswer`), so the request is one the route takes.
//
// The skew rows (spec §5.1 rule 1c). Until C7p, a server without `questions-v1` was answered through the old doors,
// chosen by `lib/serverCaps.ts`'s `GET /health` read. C7p retires the old doors on the server and the fallback here:
// every answer takes the family's door whatever `/health` says, and the PWA reads no `/health` to choose it. The cost,
// named in the PR: a new PWA against a server without `questions-v1` (older than Q3f, #1745) cannot answer.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { api } from '../src/lib/api';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';
import { parseQuestionId, readDialogAnswer } from '../../shared/api';
import { createApi } from '../src/lib/api';
import { answerRequest, performAnswer, questionBodyOf, type AnswerCommand, type AnswerSeam } from '../src/session/answerLifecycle';

const SID = 'session-a';
const ANSWER: AnswerCommand = { kind: 'answer', sessionId: SID, dialogId: 'd1', optionIndex: 2 };
const TEXT: AnswerCommand = { kind: 'text', sessionId: SID, dialogId: 'd1', optionIndex: 3, text: '- only in staging, sampled 10%' };
const MULTI: AnswerCommand = { kind: 'multi', sessionId: SID, dialogId: 'd1', optionIndexes: [3, 1] };
const ASK: AnswerCommand = { kind: 'ask', sessionId: SID, askKey: 'k1', optionIndexes: [2] };

const FAMILY = `/api/questions/session-${SID}/answer`;
const json = { 'content-type': 'application/json' } as const;

describe('the commands on the family\'s door, the only one', () => {
  it('answer: {kind:"dialog", dialogId, optionIndex}, Q3f\'s opDialog("dialog") body', () => {
    expect(answerRequest(ANSWER)).toEqual({ method: 'POST', path: FAMILY, headers: json, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' });
  });
  it('text: the row and its text, Q3f\'s opDialog("dialog/text") body', () => {
    expect(answerRequest(TEXT)).toEqual({
      method: 'POST', path: FAMILY, headers: json, body: '{"kind":"dialog","dialogId":"d1","optionIndex":3,"text":"- only in staging, sampled 10%"}',
    });
  });
  it('multi: multi:true and the whole set, Q3f\'s opDialog("dialog/multi") body', () => {
    expect(answerRequest(MULTI)).toEqual({ method: 'POST', path: FAMILY, headers: json, body: '{"kind":"dialog","multi":true,"dialogId":"d1","optionIndexes":[3,1]}' });
  });
  it('ask: {kind:"ask", askKey, optionIndexes}, Q3f\'s opAsk body', () => {
    expect(answerRequest(ASK)).toEqual({ method: 'POST', path: FAMILY, headers: json, body: '{"kind":"ask","askKey":"k1","optionIndexes":[2]}' });
  });
  it('the path\'s id is the session\'s question id, read back by parseQuestionId; the id is encoded', () => {
    const id = (path: string): string => decodeURIComponent(path.split('/')[3]!);
    expect(parseQuestionId(id(answerRequest(ANSWER).path))).toEqual({ kind: 'session', sessionId: SID });
    expect(answerRequest({ ...ANSWER, sessionId: 'lane-a:project a/1' }).path).toBe('/api/questions/session-lane-a%3Aproject%20a%2F1/answer');
  });
  it('each dialog body reads back through readDialogAnswer as the arm it was sent as', () => {
    expect(readDialogAnswer(JSON.parse(answerRequest(ANSWER).body))).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    expect(readDialogAnswer(JSON.parse(answerRequest(TEXT).body))).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: '- only in staging, sampled 10%' });
    expect(readDialogAnswer(JSON.parse(answerRequest(MULTI).body))).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndexes: [3, 1], multi: true });
  });
  it('questionBodyOf is the body each command sends, and the tab move and Deny have none (they stay session doors)', () => {
    expect(questionBodyOf(ANSWER)).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    expect(questionBodyOf(ASK)).toEqual({ kind: 'ask', askKey: 'k1', optionIndexes: [2] });
    expect(answerRequest({ kind: 'tab', sessionId: SID, dialogId: 'd1', to: 'next' }).path).toBe(`/api/sessions/${SID}/dialog/tab`);
    expect(answerRequest({ kind: 'deny', sessionId: SID })).toEqual({ method: 'POST', path: `/api/sessions/${SID}/interrupt`, headers: json, body: '{"source":"deny"}' });
  });
});

describe('the skew rows (C7p): no command goes to an old door', () => {
  // Before C7p, `answerRequest(c, false)` sent these four to `/dialog`, `/dialog/text`, `/dialog/multi` and `/ask`.
  it('answer, text, multi and ask each go to the family\'s door, never under /api/sessions/<id>', () => {
    for (const c of [ANSWER, TEXT, MULTI, ASK]) {
      const r = answerRequest(c);
      expect(r.path, c.kind).toBe(FAMILY);
      expect(r.path.startsWith('/api/sessions/'), c.kind).toBe(false);
    }
  });
});

describe('performAnswer: the sheets\' answers go to the one writer, answerQuestion, with the family\'s body', () => {
  it('answer, text and multi call answerQuestion; the tab move and Deny keep their session doors', async () => {
    const calls: unknown[][] = [];
    const rec = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); return { ok: true } as never; };
    const seam = { answerQuestion: rec('answerQuestion'), answerDialogTab: rec('answerDialogTab'), interrupt: rec('interrupt') } as unknown as AnswerSeam;
    await performAnswer(ANSWER as Extract<AnswerCommand, { kind: 'answer' }>, seam);
    await performAnswer(TEXT as Extract<AnswerCommand, { kind: 'text' }>, seam);
    await performAnswer(MULTI as Extract<AnswerCommand, { kind: 'multi' }>, seam);
    await performAnswer({ kind: 'tab', sessionId: SID, dialogId: 'd1', to: 'next' }, seam);
    await performAnswer({ kind: 'deny', sessionId: SID }, seam);
    expect(calls).toEqual([
      ['answerQuestion', SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 }],
      ['answerQuestion', SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: '- only in staging, sampled 10%' }],
      ['answerQuestion', SID, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [3, 1] }],
      ['answerDialogTab', SID, { dialogId: 'd1', to: 'next' }],
      ['interrupt', SID, 'deny'],
    ]);
  });
});

// ─── lib/api.ts#answerQuestion: the one writer, on the family's door alone ─────────────────────────────────────────

const health = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Sent { method: string; url: string; body: string | undefined }
/** `createApi` over a fake fetch whose `/health` answers `caps` (or fails), recording every other request and every
 *  `/health` read apart. */
const apiOver = (caps: readonly string[] | 'unreachable') => {
  const sent: Sent[] = [];
  let reads = 0;
  const api = createApi((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/health') {
      reads += 1;
      if (caps === 'unreachable') throw new TypeError('offline');
      return health({ ok: true, caps });
    }
    sent.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined });
    return health({ ok: true, next: null });
  }) as typeof fetch);
  return { api, sent, reads: () => reads };
};

describe('api.answerQuestion: the family\'s door, whatever /health says, and no /health read', () => {
  it('POST /api/questions/session-<id>/answer with the family\'s body, the reply read as an answer', async () => {
    const { api, sent } = apiOver(['questions-v1']);
    expect(await api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 })).toEqual({ ok: true, next: null });
    await api.answerQuestion(SID, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [3, 1] });
    expect(sent).toEqual([
      { method: 'POST', url: FAMILY, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' },
      { method: 'POST', url: FAMILY, body: '{"kind":"dialog","multi":true,"dialogId":"d1","optionIndexes":[3,1]}' },
    ]);
  });
  // Before C7p: a server without the word, or a /health that could not be reached, got the old door with its bytes.
  it('a server with the word, without it, or a /health that cannot be reached: the family\'s door, and /health is never read', async () => {
    for (const caps of [['questions-v1'], [], 'unreachable'] as const) {
      const { api, sent, reads } = apiOver(caps);
      await api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
      await api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: 'w' });
      await api.answerQuestion(SID, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [3, 1] });
      await api.answerQuestion(SID, { kind: 'ask', askKey: 'k1', optionIndexes: [2] });
      expect(sent, String(caps)).toEqual([
        { method: 'POST', url: FAMILY, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' },
        { method: 'POST', url: FAMILY, body: '{"kind":"dialog","dialogId":"d1","optionIndex":3,"text":"w"}' },
        { method: 'POST', url: FAMILY, body: '{"kind":"dialog","multi":true,"dialogId":"d1","optionIndexes":[3,1]}' },
        { method: 'POST', url: FAMILY, body: '{"kind":"ask","askKey":"k1","optionIndexes":[2]}' },
      ]);
      expect(reads(), String(caps)).toBe(0);
    }
  });
  it('a tap\'s POST is issued at once: nothing is read before it', async () => {
    const { api, sent, reads } = apiOver([]);
    void api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    await microtasks();
    expect(sent).toEqual([{ method: 'POST', url: FAMILY, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' }]);
    expect(reads()).toBe(0);
  });
  it('the old writers the family replaces are gone, and so is the door reader; the tab move and Deny stay', () => {
    const api = createApi();
    for (const gone of ['answerDialog', 'answerDialogText', 'answerDialogMulti', 'answerAsk', 'questionsDoor']) expect(gone in api, gone).toBe(false);
    for (const kept of ['answerQuestion', 'answerDialogTab', 'interrupt']) expect(kept in api, kept).toBe(true);
    expect('releaseQuestion' in api).toBe(false);
  });
});

/** Let every queued microtask run, and nothing else: no timer, no I/O. A request issued "at once" is issued here. */
const microtasks = async (): Promise<void> => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); };

// ─── the sheet reads nothing to choose a door ──────────────────────────────────────────────────────────────────────

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DialogSheet reads no /health, on mount or when the page comes back into view (C7p)', () => {
  // Before C7p the sheet read which door an answer takes (`api.questionsDoor()`, a `GET /health`) when it mounted and
  // on each `visibilitychange` to visible. With one door there is nothing to choose.
  it('mounting, re-rendering and a visibilitychange to visible fetch nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => health({ ok: true, caps: ['questions-v1'] }));
    const fakeSocket = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;
    const store = createSessionStore('lane-a:project-a', { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const view = render(createElement(DialogSheet, { id: 'lane-a:project-a', store }));
    view.rerender(createElement(DialogSheet, { id: 'lane-a:project-a', store }));
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchSpy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/health'))).toEqual([]);
    expect('questionsDoor' in api).toBe(false);
    view.unmount();
  });
});
