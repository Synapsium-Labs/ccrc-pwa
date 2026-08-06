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
