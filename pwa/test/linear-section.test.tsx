// Settings → Linear (named workspaces S4b, design 2026-10-20 §5.1). The section is driven against a fake BOX (a
// fetch stub keyed by method and path), not against stubbed `api` methods, so the wire readers and the step-up
// hook run for real. Tests use `fireEvent`, not `userEvent` (the plan's rule for this feature).
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LinearConnectionView } from '../../shared/linear';
import { LinearSection, LINEAR_TEXT, linearControls, linearStateText } from '../src/screens/LinearSection';
import { useLinearConnection } from '../src/fleet/useLinearConnection';
import { renderSettings } from './settingsHost';
import { readLinearConnection } from '../src/lib/api';

const KEY = 'lin_api_fixture_key_one_0001';
const LEAK = 'BOX-TEXT-THAT-MUST-NOT-REACH-THE-SCREEN';
const NOW = 1_800_000_000_000;

const reply = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (connection: LinearConnectionView): Response => reply(200, { ok: true, connection });

const CONNECTED: LinearConnectionView = { state: 'connected', outcome: 'ok', org: 'team-a', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 3 * 60_000 };
const NOT_CONNECTED: LinearConnectionView = { state: 'not-connected' };
const REJECTED: LinearConnectionView = { state: 'key-rejected', outcome: 'rejected', org: 'team-a', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 60_000 };
const UNREACHABLE: LinearConnectionView = { state: 'unreachable', outcome: 'unreachable', org: 'team-a', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 60_000 };

interface Sent { method: string; path: string; body: unknown }
interface Box {
  sent: Sent[];
  /** What each linear route answers next; mutate to script a scenario. */
  get: () => Response | Promise<Response>; put: () => Response | Promise<Response>;
  check: () => Response | Promise<Response>; del: () => Response | Promise<Response>;
  /** The passphrase arm's start answer: no enrolled passkey, so the step is the passphrase field. */
  paths: () => string[];
}

let box: Box;
const install = (init: Partial<Pick<Box, 'get' | 'put' | 'check' | 'del'>> = {}): Box => {
  const b: Box = {
    sent: [],
    get: () => ok(NOT_CONNECTED), put: () => ok(CONNECTED), check: () => ok(CONNECTED), del: () => ok(NOT_CONNECTED),
    ...init,
    paths: () => b.sent.map((s) => `${s.method} ${s.path}`),
  };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    try { body = init?.body === undefined ? null : JSON.parse(String(init.body)); } catch { body = String(init?.body); }
    b.sent.push({ method, path, body });
    if (path === '/api/linear/connection' && method === 'GET') return b.get();
    if (path === '/api/linear/connection' && method === 'PUT') return b.put();
    if (path === '/api/linear/connection' && method === 'DELETE') return b.del();
    if (path === '/api/linear/connection/check' && method === 'POST') return b.check();
    if (path === '/api/auth/step-up/start') {
      return reply(200, { challengeB64url: 'AQID', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] });
    }
    if (path === '/api/auth/step-up/passphrase') return reply(200, { ok: true, stepUpFreshUntil: Date.now() + 300_000 });
    return reply(404, { ok: false, error: 'not-found' });
  }));
  box = b;
  return b;
};

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** The section over the frame's read, as `SettingsDataProvider` hands it down. */
function Harness(): ReactNode {
  return <LinearSection poll={useLinearConnection()} />;
}

const mount = async (): Promise<void> => {
  render(<Harness />);
  await waitFor(() => expect(document.querySelector('[data-linear="state"], [data-linear="unread"]')).not.toBeNull());
};
const field = (): HTMLInputElement => screen.getByLabelText(LINEAR_TEXT.keyLabel);
const type = (v: string): void => { fireEvent.change(field(), { target: { value: v } }); };
const button = (name: string): HTMLElement => screen.getByRole('button', { name });
const stateText = (): string => document.querySelector('[data-linear="state"]')?.textContent ?? '';

describe('the section, state by state (§5.1)', () => {
  it('shows a loading block until the box answers', () => {
    install({ get: () => new Response(new ReadableStream()) });
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Linear' })).toBeTruthy();
    expect(document.querySelector('[data-linear="state"]')).toBeNull();
  });

  it('not connected: the sentence, the key field and Connect; nothing to check or disconnect', async () => {
    install();
    await mount();
    expect(stateText()).toBe(LINEAR_TEXT.notConnected);
    expect(field()).toBeTruthy();
    expect(button('Connect')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('connected: the organisation, the user, the key tail and its age; Check again and Disconnect, no field', async () => {
    install({ get: () => ok(CONNECTED) });
    await mount();
    expect(stateText()).toBe('Connected to team-a as user-a · key ending …4f2c · checked 3m ago');
    expect(document.querySelectorAll('[data-linear="state"] strong').length).toBe(2);
    expect(button('Check again')).toBeTruthy();
    expect(button('Disconnect')).toBeTruthy();
    expect(screen.queryByLabelText(LINEAR_TEXT.keyLabel)).toBeNull();
  });

  it('key rejected: its sentence, a field with Replace key, and Disconnect; no Check again', async () => {
    install({ get: () => ok(REJECTED) });
    await mount();
    expect(stateText()).toBe(LINEAR_TEXT.rejected);
    expect(field()).toBeTruthy();
    expect(button('Replace key')).toBeTruthy();
    expect(button('Disconnect')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('unreachable: its sentence, Check again and Disconnect, no field', async () => {
    install({ get: () => ok(UNREACHABLE) });
    await mount();
    expect(stateText()).toBe(LINEAR_TEXT.unreachable);
    expect(button('Check again')).toBeTruthy();
    expect(button('Disconnect')).toBeTruthy();
    expect(screen.queryByLabelText(LINEAR_TEXT.keyLabel)).toBeNull();
  });

  it('every other state is its own sentence, never another state\'s', async () => {
    const cases: [LinearConnectionView, string][] = [
      [{ state: 'details-unknown', why: 'absent' }, LINEAR_TEXT.detailsUnknown],
      [{ state: 'unreadable' }, LINEAR_TEXT.unreadableKey],
      [{ state: 'unusable' }, LINEAR_TEXT.unusableKey],
      [{ state: 'placeholder' }, LINEAR_TEXT.placeholderKey],
    ];
    const seen = new Set<string>([LINEAR_TEXT.notConnected, LINEAR_TEXT.rejected, LINEAR_TEXT.unreachable]);
    for (const [view, sentence] of cases) {
      install({ get: () => ok(view) });
      await mount();
      expect(stateText(), view.state).toBe(sentence);
      expect(seen.has(sentence), view.state).toBe(false);
      seen.add(sentence);
      cleanup();
    }
    expect(linearControls({ state: 'details-unknown', why: 'stale' })).toEqual({ field: null, check: true, disconnect: true });
    for (const state of ['unreadable', 'unusable', 'placeholder'] as const) {
      expect(linearControls({ state })).toEqual({ field: 'replace', check: false, disconnect: true });
    }
  });

  it('a read that fails, or answers a state this build does not know, says so and offers nothing', async () => {
    for (const get of [() => reply(500, { ok: false, error: 'internal' }), () => reply(200, { ok: true, connection: { state: 'from-the-future' } }), () => reply(200, 'nope')]) {
      install({ get });
      await mount();
      expect(document.querySelector('[data-linear="unread"]')?.textContent).toBe(LINEAR_TEXT.unread);
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
    }
  });

  it('names a connected key by what it is when the box could not name the organisation or user', () => {
    const text = linearStateText({ ...CONNECTED, org: null, user: null }, NOW);
    expect(JSON.stringify(text)).toContain('Linear');
    expect(JSON.stringify(text)).toContain('this key');
  });

  it('is on the Security page, a level-3 card beside the box token, read once by the frame', async () => {
    install();
    renderSettings('security');
    expect(await screen.findByRole('heading', { level: 3, name: 'Linear' })).toBeTruthy();
    await waitFor(() => expect(stateText()).toBe(LINEAR_TEXT.notConnected));
    expect(box.paths().filter((p) => p === 'GET /api/linear/connection')).toHaveLength(1);
  });

  it('is on no other page', async () => {
    install();
    for (const id of ['updates', 'appearance', 'notifications', 'automation'] as const) {
      renderSettings(id);
      expect(screen.queryByRole('heading', { name: 'Linear' }), id).toBeNull();
      cleanup();
    }
  });
});

describe('Connect', () => {
  it('the key field is a password field that does not autocomplete, and Connect waits for a key', async () => {
    install();
    await mount();
    expect(field().type).toBe('password');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect((button('Connect') as HTMLButtonElement).disabled).toBe(true);
    type('   ');
    expect((button('Connect') as HTMLButtonElement).disabled).toBe(true);
    type(KEY);
    expect((button('Connect') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the trimmed key once, shows the state the box answers, and clears the field', async () => {
    install();
    await mount();
    type(`  ${KEY}\n`);
    fireEvent.click(button('Connect'));
    await waitFor(() => expect(stateText()).toContain('Connected to team-a'));
    expect(box.sent.filter((s) => s.method === 'PUT')).toEqual([{ method: 'PUT', path: '/api/linear/connection', body: { key: KEY } }]);
    expect(screen.getByRole('status').textContent).toBe(LINEAR_TEXT.connected);
    // The field is gone while connected; disconnecting brings it back, and it is EMPTY: the key did not linger.
    fireEvent.click(button('Disconnect'));
    await waitFor(() => expect(stateText()).toBe(LINEAR_TEXT.notConnected));
    expect(field().value).toBe('');
  });

  it('says a key that fails the shape rule is not one, without a request', async () => {
    install();
    await mount();
    type('not a key');
    fireEvent.click(button('Connect'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("doesn't look like a Linear API key"));
    expect(box.paths().filter((p) => p.startsWith('PUT'))).toEqual([]);
  });

  it('Replace key sends the key the same way from a rejected state', async () => {
    install({ get: () => ok(REJECTED) });
    await mount();
    type(KEY);
    fireEvent.click(button('Replace key'));
    await waitFor(() => expect(stateText()).toContain('Connected to team-a'));
    expect(box.sent.filter((s) => s.method === 'PUT')).toHaveLength(1);
  });

  it('each refusal is a fixed sentence chosen by its word, and the box\'s own text never reaches the screen', async () => {
    const cases: [number, string, string][] = [
      [400, 'key-rejected', 'Linear rejected that key'],
      [400, 'bad-key', "doesn't look like a Linear API key"],
      [503, 'unreachable', "Couldn't reach Linear"],
      [503, 'timeout', 'took too long'],
      [503, 'malformed', 'not what was expected'],
      [503, 'write-failed', "couldn't save"],
      [501, 'auth-off', 'Sign-in is off'],
      [403, 'insecure-origin', 'not served over HTTPS'],
    ];
    for (const [status, word, sentence] of cases) {
      install({ put: () => reply(status, { ok: false, error: word, message: LEAK, stderr: LEAK }) });
      await mount();
      type(KEY);
      fireEvent.click(button('Connect'));
      await waitFor(() => expect(screen.getByRole('status').textContent, word).toContain(sentence));
      expect(document.body.textContent).not.toContain(LEAK);
      // A refusal changes nothing: still not connected, and the field keeps what was typed.
      expect(stateText()).toBe(LINEAR_TEXT.notConnected);
      expect(field().value).toBe(KEY);
      cleanup();
    }
  });

  it('a 2xx whose body cannot be read is re-read, because the write may have landed', async () => {
    let reads = 0;
    install({ get: () => (reads++ === 0 ? ok(NOT_CONNECTED) : ok(CONNECTED)), put: () => reply(200, 'garbled') });
    await mount();
    type(KEY);
    fireEvent.click(button('Connect'));
    await waitFor(() => expect(stateText()).toContain('Connected to team-a'));
    expect(box.paths().filter((p) => p === 'GET /api/linear/connection')).toHaveLength(2);
  });

  it('clears a typed key when the page goes to the background', async () => {
    install();
    await mount();
    type(KEY);
    expect(field().value).toBe(KEY);
    const real = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(field().value).toBe('');
    } finally {
      delete (document as unknown as Record<string, unknown>)['visibilityState'];
      if (real) Object.defineProperty(Document.prototype, 'visibilityState', real);
    }
  });
});

describe('reads and writes racing', () => {
  it('a read issued before a write\'s answer cannot put the old state back', async () => {
    let releaseRead: (r: Response) => void = () => undefined;
    let first = true;
    install({
      get: () => {
        if (first) { first = false; return ok(NOT_CONNECTED); }
        return new Promise<Response>((res) => { releaseRead = res; });
      },
    });
    await mount();
    // The page comes back to the front: a read starts and is held.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(box.paths().filter((p) => p === 'GET /api/linear/connection')).toHaveLength(2));
    // A Connect lands while it is in flight.
    type(KEY);
    fireEvent.click(button('Connect'));
    await waitFor(() => expect(stateText()).toContain('Connected to team-a'));
    // The held read now answers with what it saw BEFORE the write.
    await act(async () => { releaseRead(ok(NOT_CONNECTED)); await Promise.resolve(); });
    expect(stateText()).toContain('Connected to team-a');
  });

  it('a page returning to the front re-reads, so a rejection marked meanwhile shows', async () => {
    let state: LinearConnectionView = CONNECTED;
    install({ get: () => ok(state) });
    await mount();
    expect(stateText()).toContain('Connected to team-a');
    state = REJECTED;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(stateText()).toBe(LINEAR_TEXT.rejected));
  });
});

describe('Check again and Disconnect', () => {
  it('Check again calls the check route and shows what it answers', async () => {
    install({ get: () => ok(UNREACHABLE), check: () => ok(CONNECTED) });
    await mount();
    fireEvent.click(button('Check again'));
    await waitFor(() => expect(stateText()).toContain('Connected to team-a'));
    expect(box.paths()).toContain('POST /api/linear/connection/check');
  });

  it('Check again that finds the key rejected shows the rejected state', async () => {
    install({ get: () => ok(CONNECTED), check: () => ok(REJECTED) });
    await mount();
    fireEvent.click(button('Check again'));
    await waitFor(() => expect(stateText()).toBe(LINEAR_TEXT.rejected));
  });

  it('a check with nothing stored shows the state the 409 carries', async () => {
    install({ get: () => ok(CONNECTED), check: () => reply(409, { ok: false, error: 'not-connected', connection: NOT_CONNECTED }) });
    await mount();
    fireEvent.click(button('Check again'));
    await waitFor(() => expect(stateText()).toBe(LINEAR_TEXT.notConnected));
  });

  it('Disconnect calls DELETE and shows not connected', async () => {
    install({ get: () => ok(CONNECTED) });
    await mount();
    fireEvent.click(button('Disconnect'));
    await waitFor(() => expect(stateText()).toBe(LINEAR_TEXT.notConnected));
    expect(box.paths()).toContain('DELETE /api/linear/connection');
    expect(screen.getByRole('status').textContent).toBe(LINEAR_TEXT.disconnected);
  });

  it('a failed Disconnect says why and keeps the state', async () => {
    install({ get: () => ok(CONNECTED), del: () => reply(503, { ok: false, error: 'write-failed', message: LEAK }) });
    await mount();
    fireEvent.click(button('Disconnect'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("couldn't save"));
    expect(stateText()).toContain('Connected to team-a');
    expect(document.body.textContent).not.toContain(LEAK);
  });
});

describe('the step-up (D-5512)', () => {
  it('asks for none until an act is refused: no challenge is fetched on a visit to Settings', async () => {
    install();
    await mount();
    expect(box.paths().some((p) => p.includes('step-up'))).toBe(false);
    expect(screen.queryByText(/needs a fresh check/)).toBeNull();
  });

  it('a PUT refused step-up-required shows "Confirm it\'s you", keeps the typed key, and does not retry by itself', async () => {
    let refused = true;
    install({ put: () => (refused ? reply(403, { ok: false, error: 'step-up-required' }) : ok(CONNECTED)) });
    await mount();
    type(KEY);
    fireEvent.click(button('Connect'));
    expect(await screen.findByText(/Changing the Linear key needs a fresh check/)).toBeTruthy();
    expect(field().value).toBe(KEY);
    expect(box.sent.filter((s) => s.method === 'PUT')).toHaveLength(1);

    // The box has no passkey enrolled, so the step is the passphrase; confirming does NOT re-send the PUT.
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a test passphrase' } });
    refused = false;
    fireEvent.click(button('Confirm with passphrase'));
    await waitFor(() => expect(screen.queryByText(/needs a fresh check/)).toBeNull());
    expect(box.sent.filter((s) => s.method === 'PUT')).toHaveLength(1);
    // The operator presses Connect again, and it goes through.
    fireEvent.click(button('Connect'));
    await waitFor(() => expect(stateText()).toContain('Connected to team-a'));
    expect(box.sent.filter((s) => s.method === 'PUT')).toHaveLength(2);
  });

  it('a DELETE refused step-up-required shows the step too, and the state is unchanged', async () => {
    install({ get: () => ok(CONNECTED), del: () => reply(403, { ok: false, error: 'step-up-required' }) });
    await mount();
    fireEvent.click(button('Disconnect'));
    expect(await screen.findByText(/Changing the Linear key needs a fresh check/)).toBeTruthy();
    expect(stateText()).toContain('Connected to team-a');
  });

  it('Check again asks for no step-up and shows none when it is refused for another reason', async () => {
    install({ get: () => ok(CONNECTED), check: () => reply(503, { ok: false, error: 'write-failed' }) });
    await mount();
    fireEvent.click(button('Check again'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("couldn't save"));
    expect(screen.queryByText(/needs a fresh check/)).toBeNull();
  });
});

describe('readLinearConnection', () => {
  it('reads every state the server sends', () => {
    for (const v of [NOT_CONNECTED, CONNECTED, REJECTED, UNREACHABLE, { state: 'unreadable' }, { state: 'unusable' }, { state: 'placeholder' },
      { state: 'details-unknown', why: 'stale' }] as LinearConnectionView[]) {
      expect(readLinearConnection(v), v.state).toEqual(v);
    }
  });

  it('refuses what it cannot vouch for, and keeps nothing it was not asked to', () => {
    for (const bad of [null, 'x', [], {}, { state: 'nope' }, { state: 'details-unknown', why: 'because' },
      { ...CONNECTED, outcome: 'rejected' }, { ...CONNECTED, keyTail: 4 }, { ...CONNECTED, checkedAt: 'now' }, { ...CONNECTED, org: 5 },
      { ...REJECTED, outcome: 'ok' }]) {
      expect(readLinearConnection(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(readLinearConnection({ ...CONNECTED, key: KEY, extra: 1 })).toEqual(CONNECTED);
  });
});
