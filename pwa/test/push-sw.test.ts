// `pwa/public/push-sw.js` is plain JS importScripts'd into the generated
// service worker, so it never goes through the bundler and nothing else in the
// suite would notice if it broke. These tests load the real file and drive it
// through a fake `self`, which is the only way to exercise a worker that runs
// detached from the app — possibly days after the push, against a server that
// has moved on.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(__dirname, '..', 'public', 'push-sw.js'), 'utf8');

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
  const fetch = (url: string, init: { body: string }): Promise<unknown> => {
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
  shown = []; opened = []; posted = [];
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true }) });
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
// nowhere to deep-link; the payload's `url` ('/settings') is the target instead.
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
    await push(self, { title: 'ccrc v0.0.9 is out', body: 'b', tag: 'release-v0.0.9', url: '/settings' });
    expect(shown[0]!.opts.data).toEqual({ sessionId: null, url: '/settings', actions: [] });
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
    await click(self, '', { sessionId: null, url: '/settings', actions: [] });
    expect(opened).toEqual(['/settings']);
    expect(posted).toEqual([]);
  });

  it('the push it showed is the tap that lands on /settings — the round trip', async () => {
    const self = load();
    await push(self, { title: 'ccrc v0.0.9 is out', body: 'b', tag: 'release-v0.0.9', url: '/settings' });
    await click(self, '', shown[0]!.opts.data);
    expect(opened).toEqual(['/settings']);
  });

  it('a url wins over the session deep-link when no answer was tapped', async () => {
    const self = load();
    await click(self, '', { sessionId: 'cc-a', url: '/settings' });
    expect(opened).toEqual(['/settings']);
    opened = [];
    await click(self, 'something-else', { sessionId: 'cc-a', url: '/settings' });
    expect(opened).toEqual(['/settings']);
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
    await click(self, 'ask:k:0', { sessionId: 'cc-a', url: '/settings' },
      { actions: [{ action: 'ask:k:0', title: 'Red' }] });
    expect(posted).toEqual([{ url: '/api/sessions/cc-a/ask', body: { askKey: 'k', optionIndexes: [0] } }]);
    expect(opened).toEqual([]);
    expect(shown.at(-1)!.title).toBe('Answered');
  });
});
