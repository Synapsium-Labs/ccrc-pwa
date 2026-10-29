// The answer's lifecycle (D-7183; ARCH-29 #542): the reducer's transitions, the guard (one send at a time, nothing
// dismissable in flight), the D-5089, D-5090 and D-5091 replays, and the request each command's door takes, held equal
// to what that kind's writer sends today (`lib/api.ts` for the sheets' kinds, `public/push-sw.js` for the notification).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Dialog } from '../../shared/api';
import { createApi } from '../src/lib/api';
import {
  INITIAL_ANSWER_STATE, NO_PICK, NO_WORDS, answerRequest, answerStep, answeringOption, askCommandOf, busy,
  createAnswerLifecycle, performAnswer, type AnswerCommand, type AnswerEvent, type AnswerSeam, type AnswerState,
} from '../src/session/answerLifecycle';

const SID = 'session-a';
const dialog = (id: string, patch: Partial<Dialog> = {}): Dialog => ({
  id, title: 'Which one?', options: [{ index: 1, label: 'Red' }, { index: 2, label: 'Blue' }], selectedIndex: 1,
  parsed: true, raw: '❯ 1. Red', ...patch,
});

/** Run `events` from `from`, returning the last step and every command issued. */
function run(events: readonly AnswerEvent[], from: AnswerState = INITIAL_ANSWER_STATE) {
  let state = from;
  const commands: AnswerCommand[] = [];
  const refused: AnswerEvent['type'][] = [];
  for (const e of events) {
    const step = answerStep(state, e);
    state = step.state;
    if (step.command !== null) commands.push(step.command);
    if (step.refused) refused.push(e.type);
  }
  return { state, commands, refused };
}

const ANSWER: AnswerEvent = { type: 'answer', sessionId: SID, dialogId: 'd1', option: 2 };
const TEXT: AnswerEvent = { type: 'text', sessionId: SID, dialogId: 'd1', row: 3, question: 'q1' };
const MULTI: AnswerEvent = { type: 'multi', sessionId: SID, dialogId: 'd1', wanted: [1, 3] };
const TAB: AnswerEvent = { type: 'tab', sessionId: SID, dialogId: 'd1', to: 'next' };
const DENY: AnswerEvent = { type: 'deny', sessionId: SID };
const SENDS: readonly AnswerEvent[] = [ANSWER, TEXT, MULTI, TAB, DENY];
const DISMISS: AnswerEvent = { type: 'dismiss', hooked: false, askKey: null, screen: null, dialogId: 'd1' };

describe('answerStep: each send moves idle to its in-flight state and issues its command', () => {
  it('answer: sending(answer, option), the answer command', () => {
    const r = run([ANSWER]);
    expect(r.state.phase).toEqual({ kind: 'sending', send: 'answer', option: 2 });
    expect(r.commands).toEqual([{ kind: 'answer', sessionId: SID, dialogId: 'd1', optionIndex: 2 }]);
  });
  it('text: the own-words call in flight, the text command with the trimmed draft', () => {
    const r = run([{ type: 'words', text: '  my words ' }, TEXT]);
    expect(r.state.own).toEqual({ text: '  my words ', call: { row: 3, question: 'q1', state: 'flight' } });
    expect(r.commands).toEqual([{ kind: 'text', sessionId: SID, dialogId: 'd1', optionIndex: 3, text: 'my words' }]);
  });
  it('multi: the commit in flight, the multi command with the whole set', () => {
    const r = run([MULTI]);
    expect(r.state.pick.call).toEqual({ dialogId: 'd1', wanted: [1, 3], state: 'flight' });
    expect(r.commands).toEqual([{ kind: 'multi', sessionId: SID, dialogId: 'd1', optionIndexes: [1, 3] }]);
  });
  it('tab: sending(tab), the tab command, `from` only when given', () => {
    expect(run([TAB]).state.phase).toEqual({ kind: 'sending', send: 'tab' });
    expect(run([TAB]).commands).toEqual([{ kind: 'tab', sessionId: SID, dialogId: 'd1', to: 'next' }]);
    expect(run([{ ...TAB, to: 2, from: 1 } as AnswerEvent]).commands)
      .toEqual([{ kind: 'tab', sessionId: SID, dialogId: 'd1', to: 2, from: 1 }]);
  });
  it('deny: sending(deny), the deny command', () => {
    expect(run([DENY]).state.phase).toEqual({ kind: 'sending', send: 'deny' });
    expect(run([DENY]).commands).toEqual([{ kind: 'deny', sessionId: SID }]);
  });
});

describe('answerStep: settles', () => {
  it('an option answer that lands is sent and stays busy until the screen changes', () => {
    const r = run([ANSWER, { type: 'answer-landed' }]);
    expect(r.state.phase).toEqual({ kind: 'sent', option: 2 });
    expect(busy(r.state)).toBe(true);
    expect(answeringOption(r.state)).toBe(2);
    const next = run([{ type: 'screen', onScreen: dialog('d2') }], r.state);
    expect(next.state.phase).toEqual({ kind: 'idle' });
    expect(busy(next.state)).toBe(false);
  });
  it('a refusal is failed with the door token, which locks nothing', () => {
    const r = run([ANSWER, { type: 'answer-refused', refusal: 'stale-dialog' }]);
    expect(r.state.phase).toEqual({ kind: 'failed', send: 'answer', refusal: 'stale-dialog' });
    expect(busy(r.state)).toBe(false);
  });
  it('a tab move and Deny settle to idle, or to failed with the token', () => {
    expect(run([TAB, { type: 'tab-settled' }]).state.phase).toEqual({ kind: 'idle' });
    expect(run([TAB, { type: 'tab-settled', refusal: 'no-move' }]).state.phase).toEqual({ kind: 'failed', send: 'tab', refusal: 'no-move' });
    expect(run([DENY, { type: 'deny-settled' }]).state.phase).toEqual({ kind: 'idle' });
    expect(run([DENY, { type: 'deny-settled', refusal: 'not-busy' }]).state.phase).toEqual({ kind: 'failed', send: 'deny', refusal: 'not-busy' });
  });
  it('a tab move and Deny keep their lock across a screen change; an option answer does not', () => {
    expect(busy(run([TAB, { type: 'screen', onScreen: dialog('d2') }]).state)).toBe(true);
    expect(busy(run([DENY, { type: 'screen', onScreen: null }]).state)).toBe(true);
    expect(busy(run([ANSWER, { type: 'screen', onScreen: dialog('d2') }]).state)).toBe(false);
  });
  it('the failed state carries a token, never a sentence: every string in the state is a code', () => {
    const tokens = ['stale-dialog', 'walk-failed', 'failed', 'not-busy'];
    for (const refusal of tokens) {
      const r = run([ANSWER, { type: 'answer-refused', refusal }]);
      expect(r.state.phase).toEqual({ kind: 'failed', send: 'answer', refusal });
      const strings = JSON.stringify(r.state.phase).match(/"[^"]*"/g)!.map((s) => s.slice(1, -1));
      for (const s of strings) expect(s).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe('answerStep: the guard (one send at a time, nothing dismissable in flight)', () => {
  it('every second send is refused while any send is in flight, and issues nothing', () => {
    for (const first of SENDS) {
      for (const second of SENDS) {
        const r = run([first, second]);
        expect(r.commands).toHaveLength(1);
        expect(r.refused).toEqual([second.type]);
      }
    }
  });
  it('the dismissal is refused while any send is in flight, and the state is unchanged', () => {
    for (const first of SENDS) {
      const before = run([first]).state;
      const step = answerStep(before, DISMISS);
      expect(step.refused).toBe(true);
      expect(step.state).toBe(before);
    }
  });
  it('the way to the terminal (`leave`) is never refused: it is the way out', () => {
    const r = run([ANSWER, { type: 'leave', hooked: false, askKey: null, screen: null, dialogId: 'd1' }]);
    expect(r.refused).toEqual([]);
    expect(r.state.dismissal.key).toBe('d1');
  });
  it('a box toggle is refused while a send is in flight', () => {
    expect(run([ANSWER, { type: 'toggle', dialogId: 'd1', index: 1, seed: [] }]).refused).toEqual(['toggle']);
  });
  it('the holder applies the guard synchronously: two taps in one tick send once', () => {
    const life = createAnswerLifecycle();
    let renders = 0;
    life.subscribe(() => { renders += 1; });
    const a = life.dispatch(ANSWER);
    const b = life.dispatch({ ...ANSWER, option: 1 } as AnswerEvent);
    expect(a.command).not.toBeNull();
    expect(b.refused).toBe(true);
    expect(b.command).toBeNull();
    expect(renders).toBe(1);
  });
});

describe('the D-numbered replays', () => {
  it('D-5089: hiding the envelope records the pane dialog live then, so the hand-off stays shut; refused in flight; raise clears it', () => {
    const hide: AnswerEvent = { type: 'dismiss', hooked: true, askKey: '{"questions":[]}', screen: 'q:0', dialogId: 'd1' };
    const hidden = run([hide]).state.dismissal;
    expect(hidden).toEqual({ key: '{"questions":[]}', screen: 'q:0', dialogId: 'd1' });
    // While an answer is in flight the operator cannot wave it away.
    const inFlight = run([ANSWER, hide]);
    expect(inFlight.refused).toEqual(['dismiss']);
    expect(inFlight.state.dismissal).toEqual({ key: null, screen: null, dialogId: null });
    // The transcript's Answer (`raise`) clears both slots and nothing else.
    expect(run([hide, { type: 'raise' }]).state.dismissal).toEqual({ key: null, screen: 'q:0', dialogId: null });
  });

  it('D-5090: own words keep their text and call through the typing\'s new frame; one call at a time; a landed call ends with its screen', () => {
    const typed = dialog('d1-typed', { options: [{ index: 1, label: 'Red' }, { index: 2, label: 'Blue' }, { index: 3, label: 'my words' }] });
    const r = run([
      { type: 'words', text: 'my words' },
      TEXT,
      // The stream's frame of the typed row arrives mid-call: a new id, the same question.
      { type: 'screen', onScreen: typed },
      // A second send in the same window is refused.
      ANSWER,
      DISMISS,
    ]);
    expect(r.refused).toEqual(['answer', 'dismiss']);
    expect(r.state.own).toEqual({ text: 'my words', call: { row: 3, question: 'q1', state: 'flight' } });
    // Landed while the pane still shows the question: busy until it moves on.
    const landed = run([{ type: 'text-landed', text: 'my words', call: { row: 3, question: 'q1', state: 'flight' }, waiting: true }], r.state);
    expect(landed.state.own.call?.state).toBe('landed');
    expect(busy(landed.state)).toBe(true);
    // A new question ends it.
    expect(run([{ type: 'screen', onScreen: dialog('d2', { title: 'Another?' }) }], landed.state).state.own).toEqual(NO_WORDS);
    // A refusal keeps the text and unlocks.
    const refused = run([{ type: 'text-refused', text: 'my words', call: { row: 3, question: 'q1', state: 'flight' }, refusal: 'stale-dialog' }], r.state);
    expect(refused.state.own).toEqual({ text: 'my words', call: { row: 3, question: 'q1', state: 'refused' } });
    expect(busy(refused.state)).toBe(false);
  });

  it('D-5091: a commit in flight keeps its set and call across a new screen; one at a time; landed ends with its screen', () => {
    const seeded = run([
      { type: 'toggle', dialogId: 'd1', index: 1, seed: [] },
      { type: 'toggle', dialogId: 'd1', index: 3, seed: [] },
    ]).state;
    expect(seeded.pick).toEqual({ id: 'd1', picked: [1, 3], call: null });
    const r = run([MULTI, { type: 'screen', onScreen: dialog('d2') }, ANSWER, DISMISS, { type: 'toggle', dialogId: 'd1', index: 2, seed: [] }], seeded);
    expect(r.refused).toEqual(['answer', 'dismiss', 'toggle']);
    expect(r.state.pick).toEqual({ id: 'd1', picked: [1, 3], call: { dialogId: 'd1', wanted: [1, 3], state: 'flight' } });
    const landed = run([{ type: 'multi-landed', dialogId: 'd1', wanted: [1, 3], waiting: true }], r.state);
    expect(landed.state.pick.call).toEqual({ dialogId: 'd1', wanted: [1, 3], state: 'landed' });
    expect(busy(landed.state)).toBe(true);
    expect(run([{ type: 'screen', onScreen: dialog('d3') }], landed.state).state.pick).toEqual(NO_PICK);
    const refused = run([{ type: 'multi-refused', dialogId: 'd1', wanted: [1, 3], refusal: 'stale-dialog' }], r.state);
    expect(refused.state.pick).toEqual({ id: 'd1', picked: [1, 3], call: null });
    expect(busy(refused.state)).toBe(false);
  });
});

// ─── the request each kind's door takes ────────────────────────────────────────────────────────────────────────────

interface Captured { method: string; path: string; headers: Record<string, string>; body: string }

/** What a `lib/api.ts` writer sends, through a fetch that answers 200 `{ok:true}`. W7 C7g (D-7185, D-7485): the
 *  writer first reads `GET /health` to choose the door; that read is answered apart (a server without `questions-v1`,
 *  so these rows are the old doors' bytes) and is not one of the requests the writer sends. */
async function sent(write: (seam: AnswerSeam) => Promise<unknown>): Promise<Captured[]> {
  const out: Captured[] = [];
  const api = createApi((async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/health') return new Response('{"ok":true,"caps":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    out.push({
      method: init?.method ?? 'GET', path: String(input),
      headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body),
    });
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  await write(api);
  return out;
}
const asCaptured = (c: AnswerCommand): Captured => {
  const r = answerRequest(c, false);
  return { method: r.method, path: r.path, headers: { ...r.headers }, body: r.body };
};

/** What `public/push-sw.js`'s notification handler sends for `action` on `sessionId`. `new Function` runs this repo's own
 *  committed worker source (no test value reaches its body), as `push-sw.test.ts` does. */
async function swSent(action: string, sessionId: string | null): Promise<{ posts: Captured[]; opened: string[] }> {
  const src = readFileSync(path.join(__dirname, '..', 'public', 'push-sw.js'), 'utf8');
  const listeners: Record<string, (e: unknown) => void> = {};
  const posts: Captured[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    registration: { showNotification: async () => {} },
    clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); } },
  };
  const fetch = async (url: string, init: { method?: string; headers: Record<string, string>; body: string }) => {
    // The worker's `GET /health` (C7g): a server without `questions-v1`, so the answer below is the old door's.
    if (init.method === undefined) return { ok: true, json: async () => ({ ok: true, caps: [] }) };
    posts.push({ method: init.method, path: url, headers: { ...init.headers }, body: init.body });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  new Function('self', 'fetch', src)(self, fetch);
  const waits: Promise<unknown>[] = [];
  listeners['notificationclick']!({
    action,
    notification: { close() {}, data: { sessionId, actions: [] }, tag: 't' },
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });
  await Promise.all(waits);
  return { posts, opened };
}

// W7 C7g (D-7185, D-7485): the rows below are a server WITHOUT `questions-v1`, where each answer still takes its old
// door with today's bytes (the skew row); `answer-questions-door.test.ts` holds the family's door on a server with it.
describe('answerRequest: one row per command kind, equal to what that kind\'s writer sends today', () => {
  const id = 'lane-a:project a/1';
  it('answer = api.answerQuestion\'s option row, on a server without questions-v1', async () => {
    const c: AnswerCommand = { kind: 'answer', sessionId: id, dialogId: 'd1', optionIndex: 2 };
    expect(await sent((a) => a.answerQuestion(id, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 }))).toEqual([asCaptured(c)]);
  });
  it('text = api.answerQuestion\'s own words, on a server without questions-v1', async () => {
    const c: AnswerCommand = { kind: 'text', sessionId: id, dialogId: 'd1', optionIndex: 3, text: 'my words' };
    expect(await sent((a) => a.answerQuestion(id, { kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: 'my words' }))).toEqual([asCaptured(c)]);
  });
  it('multi = api.answerQuestion\'s multiSelect set, on a server without questions-v1', async () => {
    const c: AnswerCommand = { kind: 'multi', sessionId: id, dialogId: 'd1', optionIndexes: [3, 1] };
    expect(await sent((a) => a.answerQuestion(id, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [3, 1] }))).toEqual([asCaptured(c)]);
  });
  it('tab = api.answerDialogTab, with and without `from`', async () => {
    const c: AnswerCommand = { kind: 'tab', sessionId: id, dialogId: 'd1', to: 2, from: 1 };
    expect(await sent((a) => a.answerDialogTab(id, { dialogId: 'd1', to: 2, from: 1 }))).toEqual([asCaptured(c)]);
    const n: AnswerCommand = { kind: 'tab', sessionId: id, dialogId: 'd1', to: 'next' };
    expect(await sent((a) => a.answerDialogTab(id, { dialogId: 'd1', to: 'next' }))).toEqual([asCaptured(n)]);
  });
  it('deny = api.interrupt(id, \'deny\'), Deny\'s literal Escape', async () => {
    const c: AnswerCommand = { kind: 'deny', sessionId: id };
    expect(await sent((a) => a.interrupt(id, 'deny'))).toEqual([asCaptured(c)]);
  });
  it('ask = push-sw.js\'s fetch for the notification action ask:<key>:<index>', async () => {
    const c = askCommandOf('ask:k1:2', 'session-a')!;
    expect(c).toEqual({ kind: 'ask', sessionId: 'session-a', askKey: 'k1', optionIndexes: [2] });
    expect((await swSent('ask:k1:2', 'session-a')).posts).toEqual([asCaptured(c)]);
    expect(asCaptured(c)).toEqual({
      method: 'POST', path: '/api/sessions/session-a/ask', headers: { 'content-type': 'application/json' },
      body: '{"askKey":"k1","optionIndexes":[2]}',
    });
  });
  it('ask: a malformed action, or no session, is no command, and the worker sends nothing', async () => {
    for (const [action, sid] of [['ask:k1:x', 'session-a'], ['ask:k1:2', null], ['open', 'session-a']] as const) {
      expect(askCommandOf(action, sid)).toBeNull();
      expect((await swSent(action, sid)).posts).toEqual([]);
    }
  });
});

// W7 C7g (D-7185, D-7485): the seam's answer writers are one, `answerQuestion`, with the family's body.
describe('performAnswer: each sheet command goes to its writer on the seam, with the command\'s arguments', () => {
  it('routes every kind', async () => {
    const calls: unknown[][] = [];
    const rec = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); return { ok: true } as never; };
    const seam = { answerQuestion: rec('answerQuestion'), answerDialogTab: rec('answerDialogTab'), interrupt: rec('interrupt') } as unknown as AnswerSeam;
    await performAnswer({ kind: 'answer', sessionId: SID, dialogId: 'd1', optionIndex: 2 }, seam);
    await performAnswer({ kind: 'text', sessionId: SID, dialogId: 'd1', optionIndex: 3, text: 'w' }, seam);
    await performAnswer({ kind: 'multi', sessionId: SID, dialogId: 'd1', optionIndexes: [1] }, seam);
    await performAnswer({ kind: 'tab', sessionId: SID, dialogId: 'd1', to: 'next' }, seam);
    await performAnswer({ kind: 'deny', sessionId: SID }, seam);
    expect(calls).toEqual([
      ['answerQuestion', SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 2 }],
      ['answerQuestion', SID, { kind: 'dialog', dialogId: 'd1', optionIndex: 3, text: 'w' }],
      ['answerQuestion', SID, { kind: 'dialog', multi: true, dialogId: 'd1', optionIndexes: [1] }],
      ['answerDialogTab', SID, { dialogId: 'd1', to: 'next' }],
      ['interrupt', SID, 'deny'],
    ]);
  });
});
