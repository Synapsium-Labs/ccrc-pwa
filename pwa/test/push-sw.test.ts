// `pwa/public/push-sw.js` is plain JS importScripts'd into the generated
// service worker, so it never goes through the bundler and nothing else in the
// suite would notice if it broke. These tests load the real file and drive it
// through a fake `self`, which is the only way to exercise a worker that runs
// detached from the app — possibly days after the push, against a server that
// has moved on.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { answerRegionOf, applyAnswerRegion, renderAnswerRegion } from './answerRegion';
import { answerRequest, askCommandOf } from '../src/session/answerLifecycle';
import { advertisesQuestions } from '../src/lib/serverCaps';
import { HEALTH_CORPUS } from './healthCorpus';

const SW_PATH = path.join(__dirname, '..', 'public', 'push-sw.js');
const SRC = readFileSync(SW_PATH, 'utf8');

interface Shown { title: string; opts: Record<string, unknown> }
interface Posted { url: string; body: unknown }

interface FakeSelf {
  listeners: Record<string, (e: unknown) => void>;
  addEventListener: (t: string, fn: (e: unknown) => void) => void;
  registration: { showNotification: (title: string, opts: Record<string, unknown>) => Promise<void> };
  clients: {
    matchAll: () => Promise<unknown[]>;
    openWindow: (u: string) => Promise<void>;
  };
}

let shown: Shown[] = [];
let opened: string[] = [];
let posted: Posted[] = [];
let fetchImpl: (url: string, init: { body: string }) => Promise<unknown>;
// W7 C7g (D-7185, D-7485): the worker reads `GET /health` before it answers, to choose the door (`questions-v1`). The
// read is answered here, apart from the answer's POST, so `posted` and `fetchImpl` keep meaning the answer alone. The
// default is a server without the word, today's: every row below that does not set it answers through the old door.
let gets: string[] = [];
let healthImpl: () => Promise<unknown>;

/** Load the real worker source against a fresh fake `self` + `fetch`. Both are
 *  function parameters, so the module's bare `self`/`fetch` references bind to
 *  them and nothing leaks into the jsdom globals.
 *
 *  `new Function` here takes ONE input: `SRC`, read from this repo's own
 *  `public/push-sw.js` at a path built from `__dirname`. Nothing is
 *  interpolated into it and no test value reaches the function body — running
 *  our own committed source is the point. The alternative (re-implementing the
 *  worker's logic in the test) would prove nothing about the file that ships. */
function load(): FakeSelf {
  const self: FakeSelf = {
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
    registration: {
      showNotification: async (title, opts) => { shown.push({ title, opts }); },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (u) => { opened.push(u); },
    },
  };
  const fetch = (url: string, init: { body: string; method?: string }): Promise<unknown> => {
    if (init.method === undefined) { gets.push(url); return healthImpl(); }
    posted.push({ url, body: JSON.parse(init.body) });
    return fetchImpl(url, init) as Promise<unknown>;
  };
  new Function('self', 'fetch', SRC)(self, fetch);
  return self;
}

/** Fire a notificationclick and await everything it passed to waitUntil — the
 *  worker is killed the moment waitUntil's promise settles, so a path left out
 *  of it is a path that does not finish in production either. */
async function click(
  self: FakeSelf,
  action: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const waits: Promise<unknown>[] = [];
  self.listeners['notificationclick']!({
    action,
    notification: { close() { /* noop */ }, data, tag: 'ask-cc-a', ...extra },
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });
  await Promise.all(waits);
}

async function push(self: FakeSelf, payload: unknown): Promise<void> {
  const waits: Promise<unknown>[] = [];
  self.listeners['push']!({
    data: { json: () => payload, text: () => JSON.stringify(payload) },
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });
  await Promise.all(waits);
}

beforeEach(() => {
  shown = []; opened = []; posted = []; gets = [];
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true }) });
  healthImpl = async () => ({ ok: true, json: async () => ({ ok: true, build: null, caps: [] }) });
});

describe('push-sw: showing the notification', () => {
  it('passes the payload actions through to the notification', async () => {
    const self = load();
    await push(self, {
      title: '❓ Question', body: 'Which colour?', sessionId: 'cc-a', tag: 'ask-cc-a',
      actions: [{ action: 'ask:k1:0', title: 'Red' }, { action: 'ask:k1:1', title: 'Blue' }],
    });
    expect(shown[0]!.opts.actions).toEqual([
      { action: 'ask:k1:0', title: 'Red' },
      { action: 'ask:k1:1', title: 'Blue' },
    ]);
    // Mirrored into data as well: `notification.actions` is not readable on
    // every platform, and the click handler needs the tapped label.
    expect((shown[0]!.opts.data as { actions: unknown[] }).actions).toHaveLength(2);
  });

  it('shows no actions when the payload carries none', async () => {
    const self = load();
    await push(self, { title: '✓ Finished', body: 'back to idle', sessionId: 'cc-a' });
    expect(shown[0]!.opts.actions).toEqual([]);
  });

  it('caps actions at two even if a payload carries more', async () => {
    const self = load();
    await push(self, {
      title: 't', body: 'b', sessionId: 'cc-a',
      actions: [{ action: 'a:0', title: 'A' }, { action: 'a:1', title: 'B' }, { action: 'a:2', title: 'C' }],
    });
    expect(shown[0]!.opts.actions).toHaveLength(2);
  });

  it('survives a payload that is not JSON at all', async () => {
    const self = load();
    const waits: Promise<unknown>[] = [];
    self.listeners['push']!({
      data: { json: () => { throw new Error('not json'); }, text: () => 'raw text' },
      waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    });
    await Promise.all(waits);
    expect(shown[0]!.title).toBe('ccrc');
    expect(shown[0]!.opts.body).toBe('raw text');
  });
});

describe('push-sw: answering from the notification', () => {
  it('POSTs the tapped option and confirms with its label', async () => {
    const self = load();
    await click(self, 'ask:abc123:1', { sessionId: 'cc-a' },
      { actions: [{ action: 'ask:abc123:1', title: 'Blue' }] });
    expect(posted).toEqual([
      { url: '/api/sessions/cc-a/ask', body: { askKey: 'abc123', optionIndexes: [1] } },
    ]);
    expect(shown.at(-1)!.title).toBe('Answered');
    expect(shown.at(-1)!.opts.body).toBe('Blue');
  });

  it('reads the label from the mirrored data when the platform exposes none', async () => {
    const self = load();
    await click(self, 'ask:abc123:0', {
      sessionId: 'cc-a', actions: [{ action: 'ask:abc123:0', title: 'Red' }],
    });
    expect(shown.at(-1)!.opts.body).toBe('Red');
  });

  it("shows the refusal's own sentence on a 409, and keeps the way back", async () => {
    fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: 'ask-mismatch' }) });
    const self = load();
    await click(self, 'ask:abc123:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.title).toBe("Couldn't answer");
    expect(shown.at(-1)!.opts.body).toBe('The question changed — open the session and read it.');
    expect((shown.at(-1)!.opts.data as { sessionId: string }).sessionId).toBe('cc-a');
  });

  it('has a sentence for every refusal the route can return', async () => {
    // The route's union, copied from server/src/inject/ask.ts. A token with no
    // sentence would show the operator a bare error code with no app open.
    const TOKENS = [
      'not-alive', 'not-waiting', 'stale-ask', 'ask-mismatch', 'multi-question',
      'range', 'multiselect', 'duplicate-index', 'no-menu', 'menu-mismatch',
    ];
    for (const token of TOKENS) {
      shown = [];
      fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: token }) });
      const self = load();
      await click(self, 'ask:k:0', { sessionId: 'cc-a' });
      const body = shown.at(-1)!.opts.body as string;
      expect(body, `no sentence for "${token}"`)
        .not.toBe('No reason given (HTTP 409) — tap to open the session.');
      expect(body.length).toBeGreaterThan(0);
    }
  });

  // The fallback names no cause. "The session moved on" was a guess dressed as
  // a fact — this branch also catches a 502 from a proxy in front, a 500, an
  // unreadable body, none of which say anything about the session — so it
  // reports the one thing the response really did state.
  it('falls back to a sentence that names no cause, only the status, for a token it does not know', async () => {
    fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: 'something-new' }) });
    const self = load();
    await click(self, 'ask:k:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.opts.body).toBe('No reason given (HTTP 409) — tap to open the session.');
  });

  it('still says something when the refusal body cannot be read', async () => {
    fetchImpl = async () => ({ ok: false, status: 502, json: async () => { throw new Error('empty'); } });
    const self = load();
    await click(self, 'ask:k:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.title).toBe("Couldn't answer");
    // A gateway that never reached ccrc-server at all: the old copy told the
    // operator the session had moved on, which it had not.
    expect(shown.at(-1)!.opts.body).toBe('No reason given (HTTP 502) — tap to open the session.');
  });

  // PR F whole-branch review, Important 1. A rejected fetch proves only that
  // the RESPONSE never arrived: the POST may have reached the server, passed
  // every gate and pressed the digit, with the connection dying before the
  // reply came back. "Still unanswered / The tap did nothing" states the one
  // thing nothing in scope establishes, and sends the operator looking for a
  // menu that may be long gone.
  it('never silently drops on a network failure — and claims nothing about the outcome', async () => {
    fetchImpl = async () => { throw new Error('offline'); };
    const self = load();
    await click(self, 'ask:abc123:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.title).toBe("Couldn't confirm");
    expect(shown.at(-1)!.opts.body).toBe('No connection — tap to open the session.');
    expect((shown.at(-1)!.opts.data as { sessionId: string }).sessionId).toBe('cc-a');
    // Says nothing about whether the question is still waiting, in either the
    // title or the body — only the response could tell "never sent" from
    // "sent and applied".
    const said = `${shown.at(-1)!.title} ${shown.at(-1)!.opts.body as string}`.toLowerCase();
    expect(said).not.toContain('unanswered');
    expect(said).not.toContain('still waiting');
  });

  it('keeps the reply in the same slot as the notification it replaces', async () => {
    const self = load();
    await click(self, 'ask:abc123:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.opts.tag).toBe('ask-cc-a');
  });
});

describe('push-sw: the plain tap is unchanged', () => {
  it('deep-links and posts nothing when no action was tapped', async () => {
    const self = load();
    await click(self, '', { sessionId: 'cc-a' });
    expect(opened).toEqual(['/s/cc-a']);
    expect(posted).toEqual([]);
  });

  it('opens the root when the notification carries no session', async () => {
    const self = load();
    await click(self, '', {});
    expect(opened).toEqual(['/']);
  });

  it('deep-links rather than posting when an ask action arrives with no session', async () => {
    const self = load();
    await click(self, 'ask:k:0', {});
    expect(posted).toEqual([]);
    expect(opened).toEqual(['/']);
  });

  it('deep-links for an action id that is not an ask', async () => {
    const self = load();
    await click(self, 'something-else', { sessionId: 'cc-a' });
    expect(posted).toEqual([]);
    expect(opened).toEqual(['/s/cc-a']);
  });

  it('encodes a session id that needs it', async () => {
    const self = load();
    await click(self, '', { sessionId: 'cc a/b' });
    expect(opened).toEqual(['/s/cc%20a%2Fb']);
  });
});

// Design 2026-09-20 §13: a release push carries no session, so its tap has
// nowhere to deep-link; the payload's `url` ('/settings/updates') is the target instead.
// The url is a SAME-USER-WRITABLE string once it is in a payload, and a tap
// that navigated wherever it pointed would make every push an open redirect —
// so only a path this origin serves is honoured, decided by the URL parser
// itself (a hand-rolled prefix check misses the tab the parser strips), and
// anything else falls back to exactly the target the tap had before.
describe('push-sw: a payload url (design 2026-09-20 §13)', () => {
  const HOSTILE: unknown[] = [
    'https://evil.example/x',  // absolute, another origin
    '//evil.example/x',        // protocol-relative
    '/\\evil.example',         // the parser reads a backslash as a slash: '//evil.example'
    '/\t/evil.example',        // the parser strips the tab: '//evil.example' again
    'javascript:alert(1)',     // not a path at all
    'settings',                // relative to the worker's own path, not a root path
    '',
    42,
    // Fix round 1: a single sentinel base is itself a fixed host a payload can
    // name as its OWN authority, and a resolve against that one base then
    // reports origin === base — wrongly same-origin. Each form below names a
    // sentinel host (the retired single base, then each of the current two)
    // as its authority: protocol-relative, backslash, tab, and with userinfo
    // ahead of the host (origin ignores userinfo, so this passes a same-host
    // check too). None of these carry a real app path.
    '//sw.invalid/x',
    '/\\sw.invalid/x',
    '/\t/sw.invalid',
    '//user@sw.invalid/x',
    '//sw-a.invalid/x',
    '/\\sw-a.invalid/x',
    '/\t/sw-a.invalid',
    '//user@sw-a.invalid/x',
    '//sw-b.invalid/x',
    '/\\sw-b.invalid/x',
    '/\t/sw-b.invalid',
    '//user@sw-b.invalid/x',
  ];

  it('stashes the url into the notification data, beside the session', async () => {
    const self = load();
    await push(self, { title: 'ccrc v0.0.9 is out', body: 'b', tag: 'release-v0.0.9', url: '/settings/updates' });
    expect(shown[0]!.opts.data).toEqual({ sessionId: null, url: '/settings/updates', actions: [] });
  });

  it('stashes null when the payload carries no url — an older server, a session push', async () => {
    const self = load();
    await push(self, { title: '✓ Finished', body: 'back to idle', sessionId: 'cc-a' });
    expect(shown[0]!.opts.data).toEqual({ sessionId: 'cc-a', url: null, actions: [] });
  });

  it('stashes null for a url that is not a path this origin serves', async () => {
    for (const url of HOSTILE) {
      shown = [];
      const self = load();
      await push(self, { title: 't', body: 'b', url });
      expect((shown[0]!.opts.data as { url: unknown }).url, `stashed ${JSON.stringify(url)}`).toBeNull();
    }
  });

  it('a plain tap opens the url and posts nothing', async () => {
    const self = load();
    await click(self, '', { sessionId: null, url: '/settings/updates', actions: [] });
    expect(opened).toEqual(['/settings/updates']);
    expect(posted).toEqual([]);
  });

  it('the push it showed is the tap that lands on /settings/updates — the round trip', async () => {
    const self = load();
    await push(self, { title: 'ccrc v0.0.9 is out', body: 'b', tag: 'release-v0.0.9', url: '/settings/updates' });
    await click(self, '', shown[0]!.opts.data);
    expect(opened).toEqual(['/settings/updates']);
  });

  it('a url wins over the session deep-link when no answer was tapped', async () => {
    const self = load();
    await click(self, '', { sessionId: 'cc-a', url: '/settings/updates' });
    expect(opened).toEqual(['/settings/updates']);
    opened = [];
    await click(self, 'something-else', { sessionId: 'cc-a', url: '/settings/updates' });
    expect(opened).toEqual(['/settings/updates']);
    expect(posted).toEqual([]);
  });

  it('an absent or null url keeps today\'s targets — /s/<sid>, else /', async () => {
    const self = load();
    await click(self, '', {});
    await click(self, '', { url: null });
    await click(self, '', { sessionId: 'cc-a', url: null });
    await click(self, '', { sessionId: 'cc-a' });
    expect(opened).toEqual(['/', '/', '/s/cc-a', '/s/cc-a']);
  });

  it('a url that is not a path this origin serves is ignored — the tap falls back', async () => {
    for (const url of HOSTILE) {
      opened = [];
      const self = load();
      await click(self, '', { url });
      await click(self, '', { sessionId: 'cc-a', url });
      expect(opened, `tapped ${JSON.stringify(url)}`).toEqual(['/', '/s/cc-a']);
    }
  });

  it('keeps the path as written — never normalised into a protocol-relative one', async () => {
    // '/.//evil.example' resolves, against any origin, to a same-origin page whose
    // PATHNAME is '//evil.example'. Handing that normalised pathname to
    // navigate()/openWindow() would make it protocol-relative — another host.
    const self = load();
    await push(self, { title: 't', body: 'b', url: '/.//evil.example' });
    expect((shown[0]!.opts.data as { url: unknown }).url).toBe('/.//evil.example');
    await click(self, '', { url: '/.//evil.example' });
    expect(opened).toEqual(['/.//evil.example']);
  });

  it('never diverts an answer: an ask action with a session still POSTs it', async () => {
    const self = load();
    await click(self, 'ask:k:0', { sessionId: 'cc-a', url: '/settings/updates' },
      { actions: [{ action: 'ask:k:0', title: 'Red' }] });
    expect(posted).toEqual([{ url: '/api/sessions/cc-a/ask', body: { askKey: 'k', optionIndexes: [0] } }]);
    expect(opened).toEqual([]);
    expect(shown.at(-1)!.title).toBe('Answered');
  });
});

// W7 C7e Step 7 (D-7183; OA-C17 (a), D-7265, recorded in docs/superpowers/plans/2026-10-28-w7-operator-acts-ruled.md):
// the request and the sentence table are a generated region, rendered by `answerRegion.ts` from
// `answerLifecycle.ts#ASK_REQUEST` and `refusalWords.ts#NOTIFICATION_REFUSAL_TEXT`. The handler's control flow (close,
// waitUntil, the rejected-fetch wording, the openApp fallback) stays hand-written.
describe('push-sw: the answer-lifecycle region', () => {
  it('equals a fresh render, byte for byte (CCRC_WRITE_ANSWER_REGION=1 writes it instead, never under CI)', () => {
    if (process.env.CCRC_WRITE_ANSWER_REGION === '1') {
      expect(process.env.CI, 'CCRC_WRITE_ANSWER_REGION is set under CI: CI always compares').toBeFalsy();
      writeFileSync(SW_PATH, applyAnswerRegion(SRC));
      return;
    }
    expect(answerRegionOf(SRC)).toBe(renderAnswerRegion());
  });

  // Today's bytes, pinned as a literal beside the sentence table: green against the hand-written fetch and after.
  it('the request shape: ask:k1:2 on session-a is POST /api/sessions/session-a/ask, JSON, {"askKey":"k1","optionIndexes":[2]}', async () => {
    const sent: { url: string; init: unknown }[] = [];
    fetchImpl = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; };
    const self = load();
    await click(self, 'ask:k1:2', { sessionId: 'session-a' });
    expect(sent).toEqual([{
      url: '/api/sessions/session-a/ask',
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"askKey":"k1","optionIndexes":[2]}' },
    }]);
  });

  it('a malformed action, or no session, still opens the app and sends nothing', async () => {
    for (const [action, data] of [['ask:k1:x', { sessionId: 'session-a' }], ['ask:k1:2', {}]] as const) {
      posted = []; opened = [];
      const self = load();
      await click(self, action, data);
      expect(posted, action).toEqual([]);
      expect(opened, action).toHaveLength(1);
    }
  });

  // The rendered function and answerRequest over one action corpus. `new Function` runs only the renderer's own
  // output, built from this repo's declared shape; the corpus values are arguments, never part of the body.
  it('the rendered askRequestOf equals answerRequest(askCommandOf(…)) over the action corpus', () => {
    const askRequestOf = new Function(`${renderAnswerRegion()}\nreturn askRequestOf;`)() as
      (action: string, sessionId: string | null) => unknown;
    const ACTIONS = ['ask:k1:2', 'ask:k1:0', 'ask:a-b_c.9:10', 'ask:k1:x', 'ask::1', 'ask:k1:2:3', 'ask:k1:', 'open', ''];
    const SESSIONS = ['session-a', 'cc a/b?c', null];
    for (const action of ACTIONS) {
      for (const sid of SESSIONS) {
        const c = askCommandOf(action, sid);
        expect(askRequestOf(action, sid), `${action} on ${String(sid)}`).toEqual(c === null ? null : { ...answerRequest(c, false) });
      }
    }
  });
});

// W7 C7g (D-7185, D-7485; ARCH-57 #792, PWA half): the notification answers through W3 Q3f's operator door on a server
// that advertises `questions-v1`, and through the old door on any other (the rows above, whose default `/health` has no
// such word). The door is chosen per tap from `GET /health`, by a reader rendered from `lib/serverCaps.ts`.
describe('push-sw: the door, chosen from GET /health\'s questions-v1', () => {
  const advertising = async () => ({ ok: true, json: async () => ({ ok: true, build: null, caps: ['ask-pairing-v1', 'questions-v1'] }) });

  it('a questions-v1 server: ask:k1:2 on session-a is POST /api/questions/session-session-a/answer, {"kind":"ask",…}', async () => {
    healthImpl = advertising;
    const sent: { url: string; init: unknown }[] = [];
    fetchImpl = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; };
    const self = load();
    await click(self, 'ask:k1:2', { sessionId: 'session-a' });
    expect(gets).toEqual(['/health']);
    expect(sent).toEqual([{
      url: '/api/questions/session-session-a/answer',
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"ask","askKey":"k1","optionIndexes":[2]}' },
    }]);
  });

  it('a questions-v1 server: the answer confirms with its label, and a refusal is worded from the table', async () => {
    healthImpl = advertising;
    let self = load();
    await click(self, 'ask:abc123:1', { sessionId: 'cc-a' }, { actions: [{ action: 'ask:abc123:1', title: 'Blue' }] });
    expect(posted).toEqual([{ url: '/api/questions/session-cc-a/answer', body: { kind: 'ask', askKey: 'abc123', optionIndexes: [1] } }]);
    expect(shown.at(-1)!.title).toBe('Answered');
    expect(shown.at(-1)!.opts.body).toBe('Blue');
    fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: 'ask-mismatch' }) });
    self = load();
    await click(self, 'ask:abc123:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.opts.body).toBe('The question changed — open the session and read it.');
  });

  it('the family\'s own word, kind-mismatch, has a sentence of its own', async () => {
    healthImpl = advertising;
    fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'kind-mismatch' }) });
    const self = load();
    await click(self, 'ask:k:0', { sessionId: 'cc-a' });
    expect(shown.at(-1)!.title).toBe("Couldn't answer");
    expect(shown.at(-1)!.opts.body).not.toBe('No reason given (HTTP 400) — tap to open the session.');
  });

  it('a /health that fails, answers non-200 or cannot be read: the old door, and the answer still goes', async () => {
    for (const h of [
      async () => { throw new Error('offline'); },
      async () => ({ ok: false, status: 502, json: async () => ({}) }),
      async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
    ]) {
      posted = []; gets = [];
      healthImpl = h;
      const self = load();
      await click(self, 'ask:k1:2', { sessionId: 'session-a' });
      expect(gets).toEqual(['/health']);
      expect(posted).toEqual([{ url: '/api/sessions/session-a/ask', body: { askKey: 'k1', optionIndexes: [2] } }]);
    }
  });

  it('a malformed action reads no /health and sends nothing', async () => {
    healthImpl = advertising;
    const self = load();
    await click(self, 'ask:k1:x', { sessionId: 'session-a' });
    expect(gets).toEqual([]);
    expect(posted).toEqual([]);
  });

  // The rendered reader and `serverCaps.ts#advertisesQuestions` over one corpus. `new Function` runs only the renderer's
  // own output; the corpus values reach it as a fake fetch's answers, never as part of its body.
  it('the rendered questionsDoor equals advertisesQuestions over the /health corpus', async () => {
    const make = new Function('fetch', `${renderAnswerRegion()}\nreturn questionsDoor;`) as
      (f: (url: string, init: unknown) => Promise<unknown>) => () => Promise<boolean>;
    for (const [name, body, want] of HEALTH_CORPUS) {
      const seen: unknown[] = [];
      const questionsDoor = make(async (url, init) => { seen.push([url, init]); return { ok: true, json: async () => body }; });
      expect(await questionsDoor(), name).toBe(want);
      expect(advertisesQuestions(body), name).toBe(want);
      expect(seen, name).toEqual([['/health', { cache: 'no-store' }]]);
    }
  });
});
