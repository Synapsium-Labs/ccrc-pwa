// W7 C7g (D-7185, D-7485; ARCH-57 #792, PWA half): the answer lifecycle's commands on W3 Q3f's operator door,
// `POST /api/questions/session-<id>/answer`, and the one cap reader that chooses it, `lib/serverCaps.ts`.
//
// The bodies below are Q3f's own: `server/test/question-doors.test.ts` builds the new side of every operator pair as
// `{ kind: 'ask', ...body }` (its `opAsk`) and `{ kind: 'dialog', ...(multi ? { multi: true } : {}), ...body }` (its
// `opDialog`), and holds the route's answer to it equal to the old door's. Each row here pins the PWA's request to that
// shape, byte for byte, and reads it back through the server's own readers in `shared/api.ts` (`parseQuestionId`,
// `readDialogAnswer`), so the request is one the route takes.
//
// The skew rows (spec §5.1 rule 1c): against a server without `questions-v1` (an older server, a rollback, a `/health`
// that cannot be read or reached) the same command goes to the old door, with today's bytes.
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { api } from '../src/lib/api';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';
import { parseQuestionId, readDialogAnswer, SERVER_CAPS } from '../../shared/api';
import { createApi } from '../src/lib/api';
import { HEALTH_CORPUS } from './healthCorpus';
import { advertisesQuestions, createServerCaps, QUESTIONS_CAP, SERVER_CAPS_HOLD_MS, SERVER_CAPS_READ } from '../src/lib/serverCaps';
import { answerRequest, performAnswer, questionBodyOf, type AnswerCommand, type AnswerSeam } from '../src/session/answerLifecycle';

const SID = 'session-a';
const ANSWER: AnswerCommand = { kind: 'answer', sessionId: SID, dialogId: 'd1', optionIndex: 2 };
const TEXT: AnswerCommand = { kind: 'text', sessionId: SID, dialogId: 'd1', optionIndex: 3, text: '- only in staging, sampled 10%' };
const MULTI: AnswerCommand = { kind: 'multi', sessionId: SID, dialogId: 'd1', optionIndexes: [3, 1] };
const ASK: AnswerCommand = { kind: 'ask', sessionId: SID, askKey: 'k1', optionIndexes: [2] };

const FAMILY = `/api/questions/session-${SID}/answer`;
const json = { 'content-type': 'application/json' } as const;

describe('the commands on the family\'s door (a server that advertises questions-v1)', () => {
  it('answer: {kind:"dialog", dialogId, optionIndex}, Q3f\'s opDialog("dialog") body', () => {
    expect(answerRequest(ANSWER, true)).toEqual({ method: 'POST', path: FAMILY, headers: json, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' });
  });
  it('text: the row and its text, Q3f\'s opDialog("dialog/text") body', () => {
    expect(answerRequest(TEXT, true)).toEqual({
      method: 'POST', path: FAMILY, headers: json, body: '{"kind":"dialog","dialogId":"d1","optionIndex":3,"text":"- only in staging, sampled 10%"}',
    });
  });
  it('multi: multi:true and the whole set, Q3f\'s opDialog("dialog/multi") body', () => {
    expect(answerRequest(MULTI, true)).toEqual({ method: 'POST', path: FAMILY, headers: json, body: '{"kind":"dialog","multi":true,"dialogId":"d1","optionIndexes":[3,1]}' });
  });
  it('ask: {kind:"ask", askKey, optionIndexes}, Q3f\'s opAsk body', () => {
    expect(answerRequest(ASK, true)).toEqual({ method: 'POST', path: FAMILY, headers: json, body: '{"kind":"ask","askKey":"k1","optionIndexes":[2]}' });
  });
  it('the path\'s id is the session\'s question id, read back by parseQuestionId; the id is encoded', () => {
    const id = (path: string): string => decodeURIComponent(path.split('/')[3]!);
    expect(parseQuestionId(id(answerRequest(ANSWER, true).path))).toEqual({ kind: 'session', sessionId: SID });
    expect(answerRequest({ ...ANSWER, sessionId: 'lane-a:project a/1' }, true).path).toBe('/api/questions/session-lane-a%3Aproject%20a%2F1/answer');
  });
  it('each dialog body reads back through readDialogAnswer as the arm it was sent as', () => {
    expect(readDialogAnswer(JSON.parse(answerRequest(ANSWER, true).body))).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    expect(readDialogAnswer(JSON.parse(answerRequest(TEXT, true).body))).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: '- only in staging, sampled 10%' });
    expect(readDialogAnswer(JSON.parse(answerRequest(MULTI, true).body))).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndexes: [3, 1], multi: true });
  });
  it('questionBodyOf is the body each command sends, and the tab move and Deny have none (they stay session doors)', () => {
    expect(questionBodyOf(ANSWER)).toEqual({ kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    expect(questionBodyOf(ASK)).toEqual({ kind: 'ask', askKey: 'k1', optionIndexes: [2] });
    expect(answerRequest({ kind: 'tab', sessionId: SID, dialogId: 'd1', to: 'next' }, true).path).toBe(`/api/sessions/${SID}/dialog/tab`);
    expect(answerRequest({ kind: 'deny', sessionId: SID }, true)).toEqual({ method: 'POST', path: `/api/sessions/${SID}/interrupt`, headers: json, body: '{"source":"deny"}' });
  });
});

describe('the skew rows: a server without questions-v1 answers through the old door, with today\'s bytes', () => {
  it('answer, text, multi and ask go to /dialog, /dialog/text, /dialog/multi and /ask', () => {
    expect(answerRequest(ANSWER, false)).toEqual({ method: 'POST', path: `/api/sessions/${SID}/dialog`, headers: json, body: '{"dialogId":"d1","optionIndex":2}' });
    expect(answerRequest(TEXT, false)).toEqual({
      method: 'POST', path: `/api/sessions/${SID}/dialog/text`, headers: json, body: '{"dialogId":"d1","optionIndex":3,"text":"- only in staging, sampled 10%"}',
    });
    expect(answerRequest(MULTI, false)).toEqual({ method: 'POST', path: `/api/sessions/${SID}/dialog/multi`, headers: json, body: '{"dialogId":"d1","optionIndexes":[3,1]}' });
    expect(answerRequest(ASK, false)).toEqual({ method: 'POST', path: `/api/sessions/${SID}/ask`, headers: json, body: '{"askKey":"k1","optionIndexes":[2]}' });
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

// ─── lib/serverCaps.ts, the one cap reader ─────────────────────────────────────────────────────────────────────────

const health = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });


describe('advertisesQuestions: a /health answer advertises questions-v1 by the word, never by counting', () => {
  it('reads the word, and only the word', () => {
    expect(QUESTIONS_CAP).toBe('questions-v1');
    expect(SERVER_CAPS).toContain(QUESTIONS_CAP);
    for (const [name, body, want] of HEALTH_CORPUS) expect(advertisesQuestions(body), name).toBe(want);
  });
  it('the read\'s declared shape: GET /health, never cached by the browser', () => {
    expect(SERVER_CAPS_READ).toEqual({ path: '/health', cache: 'no-store', word: 'questions-v1' });
  });
});

describe('createServerCaps: one GET /health, held for its lease; a failed read is the old door and is not held', () => {
  const caps = (answer: () => Promise<Response>) => {
    let t = 0;
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => answer());
    return { caps: createServerCaps(fetchImpl as unknown as typeof fetch, () => t), fetchImpl, at: (ms: number) => { t = ms; } };
  };
  it('a server with the word: true, read once, then again after the lease', async () => {
    const c = caps(async () => health({ ok: true, caps: ['questions-v1'] }));
    expect(await c.caps.questionsDoor()).toBe(true);
    expect(await c.caps.questionsDoor()).toBe(true);
    expect(c.fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.fetchImpl.mock.calls[0]).toEqual(['/health', { cache: 'no-store' }]);
    c.at(60_000);
    expect(await c.caps.questionsDoor()).toBe(true);
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('a server without it: false, held for the lease', async () => {
    const c = caps(async () => health({ ok: true, caps: [] }));
    expect(await c.caps.questionsDoor()).toBe(false);
    expect(await c.caps.questionsDoor()).toBe(false);
    expect(c.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('two answers at once share one read', async () => {
    const c = caps(async () => health({ ok: true, caps: ['questions-v1'] }));
    expect(await Promise.all([c.caps.questionsDoor(), c.caps.questionsDoor()])).toEqual([true, true]);
    expect(c.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('a request that fails: false, and the next answer reads again', async () => {
    const c = caps(async () => { throw new TypeError('offline'); });
    expect(await c.caps.questionsDoor()).toBe(false);
    expect(await c.caps.questionsDoor()).toBe(false);
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('a non-200 or a body that is not JSON (the SPA\'s page): false, held for the lease like any answer', async () => {
    for (const answer of [
      async () => health({ error: 'bad-gateway' }, 502),
      async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ]) {
      const c = caps(answer);
      expect(await c.caps.questionsDoor()).toBe(false);
      expect(await c.caps.questionsDoor()).toBe(false);
      expect(c.fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

// ─── lib/api.ts#answerQuestion: the one writer, its door chosen by the cap ─────────────────────────────────────────

interface Sent { method: string; url: string; body: string | undefined }
const apiOver = (caps: readonly string[] | 'unreachable') => {
  const sent: Sent[] = [];
  const api = createApi((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/health') {
      if (caps === 'unreachable') throw new TypeError('offline');
      return health({ ok: true, caps });
    }
    sent.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined });
    return health({ ok: true, next: null });
  }) as typeof fetch);
  return { api, sent };
};

describe('api.answerQuestion: the family\'s door on a questions-v1 server, the old door otherwise', () => {
  it('a questions-v1 server: POST /api/questions/session-<id>/answer with the family\'s body, the reply read as an answer', async () => {
    const { api, sent } = apiOver(['questions-v1']);
    expect(await api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 })).toEqual({ ok: true, next: null });
    await api.answerQuestion(SID, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [3, 1] });
    expect(sent).toEqual([
      { method: 'POST', url: FAMILY, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' },
      { method: 'POST', url: FAMILY, body: '{"kind":"dialog","multi":true,"dialogId":"d1","optionIndexes":[3,1]}' },
    ]);
  });
  it('a server without the word, or a /health that cannot be reached: the old door, today\'s bytes', async () => {
    for (const caps of [[], 'unreachable'] as const) {
      const { api, sent } = apiOver(caps);
      await api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
      await api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: 'w' });
      await api.answerQuestion(SID, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [3, 1] });
      await api.answerQuestion(SID, { kind: 'ask', askKey: 'k1', optionIndexes: [2] });
      expect(sent, String(caps)).toEqual([
        { method: 'POST', url: `/api/sessions/${SID}/dialog`, body: '{"dialogId":"d1","optionIndex":2}' },
        { method: 'POST', url: `/api/sessions/${SID}/dialog/text`, body: '{"dialogId":"d1","optionIndex":3,"text":"w"}' },
        { method: 'POST', url: `/api/sessions/${SID}/dialog/multi`, body: '{"dialogId":"d1","optionIndexes":[3,1]}' },
        { method: 'POST', url: `/api/sessions/${SID}/ask`, body: '{"askKey":"k1","optionIndexes":[2]}' },
      ]);
    }
  });
  it('the old writers the family replaces are gone; the tab move and Deny stay', () => {
    const api = createApi();
    for (const gone of ['answerDialog', 'answerDialogText', 'answerDialogMulti', 'answerAsk']) expect(gone in api, gone).toBe(false);
    for (const kept of ['answerQuestion', 'questionsDoor', 'answerDialogTab', 'interrupt']) expect(kept in api, kept).toBe(true);
    expect('releaseQuestion' in api).toBe(false);
  });
});

// ─── the sheet reads the door before the first tap ─────────────────────────────────────────────────────────────────

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DialogSheet reads which door an answer takes when it mounts, never on a tap alone', () => {
  // A tap's request then goes out at once, not one `GET /health` read behind it (the browser leg's ask-inline rows
  // measure a request in flight right after the tap). The read is `api`'s, where it is held, whatever seam answers.
  it('one api.questionsDoor() read on mount, and none for a re-render', () => {
    const door = vi.spyOn(api, 'questionsDoor').mockResolvedValue(true);
    const fakeSocket = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;
    const store = createSessionStore('lane-a:project-a', { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const view = render(createElement(DialogSheet, { id: 'lane-a:project-a', store }));
    expect(door).toHaveBeenCalledTimes(1);
    view.rerender(createElement(DialogSheet, { id: 'lane-a:project-a', store }));
    expect(door).toHaveBeenCalledTimes(1);
  });
});

// ─── a tap never waits on the read (stale-while-revalidate) ────────────────────────────────────────────────────────
//
// Once any read has settled, `questionsDoor()` answers at once with the last door the server gave (the old door, which
// every server before C7p answers, when it never gave one), and a read older than `SERVER_CAPS_HOLD_MS`, or one that
// failed, is re-read in the background. Only a tap before the first read has settled waits, and it shares that read.

/** Let every queued microtask run, and nothing else: no timer, no I/O. A request issued "at once" is issued here. */
const microtasks = async (): Promise<void> => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); };
const never = <T>(): Promise<T> => new Promise<T>(() => {});

describe('createServerCaps: the last door at once, re-read in the background', () => {
  const scripted = () => {
    let t = 0;
    const answers: Array<() => Promise<Response>> = [];
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => (answers.shift() ?? (() => never<Response>()))());
    return { caps: createServerCaps(fetchImpl as unknown as typeof fetch, () => t), fetchImpl, answers, at: (ms: number) => { t = ms; } };
  };
  const settledNow = async (p: Promise<boolean>): Promise<boolean | 'waiting'> => {
    let got: boolean | 'waiting' = 'waiting';
    void p.then((v) => { got = v; });
    await microtasks();
    return got;
  };
  it('past the lease: the held door at once, one re-read under way, and its answer served after it lands', async () => {
    const c = scripted();
    let land!: (r: Response) => void;
    c.answers.push(async () => health({ ok: true, caps: ['questions-v1'] }), () => new Promise<Response>((r) => { land = r; }));
    expect(await c.caps.questionsDoor()).toBe(true);
    c.at(SERVER_CAPS_HOLD_MS + 1);
    expect(await settledNow(c.caps.questionsDoor())).toBe(true);
    expect(await settledNow(c.caps.questionsDoor())).toBe(true);
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
    land(health({ ok: true, caps: [] }));
    await microtasks();
    expect(await settledNow(c.caps.questionsDoor())).toBe(false);
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('a re-read that fails keeps the last door the server gave, and the next answer re-reads again', async () => {
    const c = scripted();
    c.answers.push(async () => health({ ok: true, caps: ['questions-v1'] }), async () => { throw new TypeError('offline'); });
    expect(await c.caps.questionsDoor()).toBe(true);
    c.at(SERVER_CAPS_HOLD_MS + 1);
    expect(await settledNow(c.caps.questionsDoor())).toBe(true);
    await microtasks();
    expect(await settledNow(c.caps.questionsDoor())).toBe(true);
    expect(c.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('after a first read that failed: the old door at once, re-read in the background', async () => {
    const c = scripted();
    c.answers.push(async () => { throw new TypeError('offline'); });
    expect(await c.caps.questionsDoor()).toBe(false);
    expect(await settledNow(c.caps.questionsDoor())).toBe(false);
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('before any read has settled, an answer waits for that one read and shares it', async () => {
    const c = scripted();
    let land!: (r: Response) => void;
    c.answers.push(() => new Promise<Response>((r) => { land = r; }));
    const first = c.caps.questionsDoor();
    expect(await settledNow(c.caps.questionsDoor())).toBe('waiting');
    land(health({ ok: true, caps: ['questions-v1'] }));
    expect(await first).toBe(true);
    expect(c.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('api.answerQuestion: a tap\'s POST goes out at once, never one /health read behind it', () => {
  // The sheet read the door when it mounted (`DialogSheet`); then `/health` hangs, as a slow or stalled server's does.
  // The clock is `Date`'s, faked alone (no timer is), as `api`'s reader reads it.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });
  const apiOver2 = (mount: 'v1' | 'fails') => {
    let reads = 0;
    const sent: Sent[] = [];
    const api = createApi((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/health') {
        reads += 1;
        if (reads > 1) return never<Response>();
        if (mount === 'fails') throw new TypeError('offline');
        return health({ ok: true, caps: ['questions-v1'] });
      }
      sent.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined });
      return health({ ok: true, next: null });
    }) as typeof fetch);
    return { api, sent, reads: () => reads, at: (ms: number) => { vi.setSystemTime(Date.now() + ms); } };
  };
  it('a sheet open past the lease: the tap\'s POST is issued at once, on the family\'s door, while /health is re-read', async () => {
    const o = apiOver2('v1');
    await o.api.questionsDoor();
    o.at(SERVER_CAPS_HOLD_MS + 1);
    void o.api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    await microtasks();
    expect(o.sent).toEqual([{ method: 'POST', url: FAMILY, body: '{"kind":"dialog","dialogId":"d1","optionIndex":2}' }]);
    expect(o.reads()).toBe(2);
  });
  it('a sheet whose mount read failed: the tap\'s POST is issued at once, on the old door, while /health is re-read', async () => {
    const o = apiOver2('fails');
    await o.api.questionsDoor();
    void o.api.answerQuestion(SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 });
    await microtasks();
    expect(o.sent).toEqual([{ method: 'POST', url: `/api/sessions/${SID}/dialog`, body: '{"dialogId":"d1","optionIndex":2}' }]);
    expect(o.reads()).toBe(2);
  });
});

describe('DialogSheet re-reads the door when the page comes back into view', () => {
  it('a visibilitychange to visible reads again; one to hidden does not', () => {
    const door = vi.spyOn(api, 'questionsDoor').mockResolvedValue(true);
    const fakeSocket = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;
    const store = createSessionStore('lane-a:project-a', { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const view = render(createElement(DialogSheet, { id: 'lane-a:project-a', store }));
    expect(door).toHaveBeenCalledTimes(1);
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(door).toHaveBeenCalledTimes(1);
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(door).toHaveBeenCalledTimes(2);
    view.unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(door).toHaveBeenCalledTimes(2);
  });
});
