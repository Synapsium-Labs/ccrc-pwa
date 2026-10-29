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
import { describe, expect, it, vi } from 'vitest';
import { parseQuestionId, readDialogAnswer, SERVER_CAPS } from '../../shared/api';
import { createApi } from '../src/lib/api';
import { HEALTH_CORPUS } from './healthCorpus';
import { advertisesQuestions, createServerCaps, QUESTIONS_CAP, SERVER_CAPS_READ } from '../src/lib/serverCaps';
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
  it('a request that fails, a non-200 or an unreadable body: false, and the next answer reads again', async () => {
    for (const answer of [
      async () => { throw new TypeError('offline'); },
      async () => health({ error: 'bad-gateway' }, 502),
      async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ]) {
      const c = caps(answer);
      expect(await c.caps.questionsDoor()).toBe(false);
      expect(await c.caps.questionsDoor()).toBe(false);
      expect(c.fetchImpl).toHaveBeenCalledTimes(2);
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
    for (const kept of ['answerQuestion', 'answerDialogTab', 'interrupt']) expect(kept in api, kept).toBe(true);
    expect('releaseQuestion' in api).toBe(false);
  });
});
