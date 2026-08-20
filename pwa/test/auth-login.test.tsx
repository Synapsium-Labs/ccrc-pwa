// Stage 3a Task 7 — the PWA learns it can be logged out.
//
// The three seams this file pins, and the failure each one exists to prevent:
//
//   1. `createApi`'s ONE `request` funnel (`lib/api.ts`) — a 401 sets a
//      module-level signal rather than merely throwing. A throw each caller has
//      to catch separately is the anti-pattern: forty call sites, thirty-nine
//      of which would grow their own toast, and the fortieth would silently do
//      nothing at all.
//   2. `app.tsx`'s SIBLING mount — one full-screen login above the shell, the
//      `BlockScreen` idiom, never a per-call toast.
//   3. BOTH websocket paths (`ReconnectingSocket` and `TerminalDrawer`'s bare
//      `WebSocket`) — a rejected upgrade must surface as auth-lost, not as
//      another rung on a reconnect ladder that will never reach the top. A
//      browser cannot read the 401 off a failed handshake, so the socket asks
//      the one route that answers before login (`GET /api/auth/status`).
//
// And the property that outranks all three: DARK BY DEFAULT. With `CCRC_AUTH`
// off the gate is a passthrough, no route can produce an auth refusal, and this
// suite proves no login screen can appear.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUTH_VERDICTS, type AuthVerdict } from '../../shared/api';
import { App } from '../src/app';
import { LoginScreen, VERDICT_TEXT } from '../src/components/LoginScreen';
import { ToastHost, toast } from '../src/components/Toast';
import { ApiError, createApi } from '../src/lib/api';
import {
  authLost, checkAuth, clearAuthLost, isAuthLost, onAuthRegained, raiseAuthLost,
} from '../src/lib/auth';
import { navigate } from '../src/lib/router';
import { ReconnectingSocket, type AuthGate } from '../src/lib/ws';
import { TerminalDrawer, type DrawerTerm } from '../src/session/TerminalDrawer';

// — fixtures —

const json = (status: number, body?: unknown): Response =>
  new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

/** What the GATE sends on a refused HTTP call (`server/src/auth/gate.ts`). */
const refusal = (verdict: AuthVerdict): Response =>
  json(401, { ok: false, error: 'unauthenticated', verdict });

/** A fetch that answers `/api/auth/status` with `body` and everything else 401. */
const statusFetch = (body: unknown, rest: () => Response = () => refusal('no-session')) =>
  vi.fn(async (url: unknown, _init?: RequestInit) =>
    String(url).startsWith('/api/auth/status') ? json(200, body) : rest());

afterEach(() => {
  cleanup();
  // The module-level fleet socket `<App/>` connects is torn down by the GLOBAL
  // hook in `test/setup.ts` (review F5), which carries the reasoning: left
  // running, it answers a later test's stubbed `fetch` and this file stops
  // testing what it says it tests — measured, that is exactly how the
  // TerminalDrawer probe case once passed with the probe deleted.
  clearAuthLost();
  navigate('/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. the funnel ───────────────────────────────────────────────────────────

describe('the 401 branch in `request`', () => {
  it('raises auth-lost ONCE however many calls fail — one screen, not N', async () => {
    const api = createApi(async () => refusal('expired'));
    const fails = [api.fleet(), api.accounts(), api.runs(), api.feed()];
    for (const p of fails) await p.catch(() => {});

    expect(isAuthLost()).toBe(true);
    // FIRST WINS: the first refusal is the one that explains why. A later,
    // vaguer answer (the socket probe's `no-session`) must not overwrite the
    // "you were signed out" the server actually said.
    expect(authLost().verdict).toBe('expired');
  });

  it('still REJECTS — a caller that awaits it needs its spinner back', async () => {
    const api = createApi(async () => refusal('no-session'));
    const err = await api.fleet().then(
      () => { throw new Error('expected the call to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).body).toMatchObject({ verdict: 'no-session' });
  });

  it('needs POSITIVE evidence — a 401 that is not an auth refusal raises nothing', async () => {
    // Absence permits (`CLAUDE.md`'s wire discipline). A bare 401 from a proxy,
    // a stale service worker, or a route this build does not know about is not
    // proof the box has a gate — and with `CCRC_AUTH` off there is none.
    const api = createApi(async () => json(401, { ok: false, error: 'nope' }));
    await api.fleet().catch(() => {});
    expect(isAuthLost()).toBe(false);

    const plain = createApi(async () => new Response('no', { status: 401 }));
    await plain.fleet().catch(() => {});
    expect(isAuthLost()).toBe(false);
  });

  it('leaves every other status exactly as it was', async () => {
    const api = createApi(async () => json(409, { ok: false, error: 'draft-present' }));
    await api.prompt('x', 'hi').catch(() => {});
    expect(isAuthLost()).toBe(false);
  });
});

// ── 2. the mount ────────────────────────────────────────────────────────────

describe('the login screen mounts the way BlockScreen does', () => {
  it('is a SIBLING before .app-shell, not a descendant of it', () => {
    render(<App />);
    act(() => raiseAuthLost('expired'));

    const shell = document.querySelector('.app-shell');
    const login = document.querySelector('.login-screen');
    expect(login).toBeInTheDocument();
    // A banner lives in a pane; this has to cover panes, sheets and toasts.
    expect(shell?.contains(login)).toBe(false);
    const rel = login!.compareDocumentPosition(shell!);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders nothing at all while the session is live', () => {
    render(<App />);
    expect(document.querySelector('.login-screen')).not.toBeInTheDocument();
  });

  it('four failed calls raise exactly ONE login screen', async () => {
    // No toast assertion here (review F4): four raw `api.*` calls never reach
    // `toast()`, so the clause that used to sit at the end of this test passed
    // with the guard deleted — coverage-shaped, and not coverage. The guard is
    // pinned by the dedicated case below, which fires a real toast.
    vi.stubGlobal('fetch', vi.fn(async () => refusal('no-session')));
    render(<App />);
    const api = createApi();
    await act(async () => {
      await Promise.allSettled([api.fleet(), api.accounts(), api.runs(), api.feed()]);
    });

    expect(document.querySelectorAll('.login-screen')).toHaveLength(1);
  });

  it('drops any toast fired while the login screen is up', () => {
    render(<ToastHost />);
    act(() => raiseAuthLost('no-session'));
    act(() => toast('unauthenticated', 'error'));
    expect(document.querySelector('.toast')).not.toBeInTheDocument();

    act(() => clearAuthLost());
    act(() => toast('back', 'info'));
    expect(screen.getByText('back')).toBeInTheDocument();
  });
});

// ── 3. the sentences ────────────────────────────────────────────────────────

describe('the AuthVerdict → sentence map', () => {
  it('has a sentence for every verdict in the shared union', () => {
    for (const v of AUTH_VERDICTS) {
      expect(VERDICT_TEXT[v], v).toMatch(/\S/);
    }
    expect(new Set(Object.values(VERDICT_TEXT)).size).toBe(AUTH_VERDICTS.length);
  });

  for (const v of ['wrong', 'unconfigured', 'locked-out', 'expired', 'no-session'] as const) {
    it(`renders its own sentence for \`${v}\``, () => {
      raiseAuthLost(v);
      render(<LoginScreen />);
      expect(screen.getByText(VERDICT_TEXT[v])).toBeInTheDocument();
    });
  }

  it('tells an unconfigured box to run `ccrc passwd`, never "try again"', () => {
    // The plan's own words: nothing the operator types will EVER match, so a
    // retry sentence is a lie that costs them the afternoon.
    expect(VERDICT_TEXT.unconfigured).toContain('ccrc passwd');
    expect(VERDICT_TEXT.unconfigured).not.toMatch(/try again/i);
  });

  it('answers `locked-out` with a clock and `wrong` with a keyboard', () => {
    expect(VERDICT_TEXT['locked-out']).toMatch(/wait/i);
    expect(VERDICT_TEXT['locked-out']).not.toBe(VERDICT_TEXT.wrong);
  });

  it('says an `expired` session WAS one — never a cold "sign in"', () => {
    expect(VERDICT_TEXT.expired).toMatch(/signed out/i);
    expect(VERDICT_TEXT.expired).not.toBe(VERDICT_TEXT['no-session']);
  });
});

// ── 4. getting back in ──────────────────────────────────────────────────────

describe('logging back in', () => {
  it('POSTs {passphrase} to /api/auth/login and, on 204, clears the signal', async () => {
    const fetchImpl = statusFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' },
      () => json(204));
    vi.stubGlobal('fetch', fetchImpl);
    raiseAuthLost('expired');
    render(<LoginScreen />);

    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'open sesame' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    });

    const login = fetchImpl.mock.calls.find(([u]) => String(u) === '/api/auth/login');
    expect(login).toBeTruthy();
    const init = login![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ passphrase: 'open sesame' });
    // Never in the URL, never in a header — the body and nowhere else.
    expect(String(login![0])).not.toContain('open sesame');
    expect(JSON.stringify(init.headers ?? {})).not.toContain('open sesame');
    await waitFor(() => expect(isAuthLost()).toBe(false));
  });

  it('a wrong passphrase keeps the screen up and says so', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' },
      () => refusal('wrong')));
    raiseAuthLost('no-session');
    render(<LoginScreen />);

    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'nope' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    });

    expect(await screen.findByText(VERDICT_TEXT.wrong)).toBeInTheDocument();
    expect(isAuthLost()).toBe(true);
  });

  it('reads the rate limiter’s 429 too — which is not a 401 and never reaches the funnel', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' },
      () => json(429, { ok: false, error: 'unauthenticated', verdict: 'locked-out', retryAfter: 41_000 })));
    raiseAuthLost('no-session');
    render(<LoginScreen />);

    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'again' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    });
    expect(await screen.findByText(VERDICT_TEXT['locked-out'])).toBeInTheDocument();
  });

  it('retires a STALE signal off the status read it was already making', async () => {
    // Review F3. Once the ladders park nothing re-probes, so a signal raised in
    // error — or one another tab has already answered by signing in — would hold
    // an unnecessary full-screen login over a working console until someone
    // typed a passphrase or reloaded. The screen's own mount read knows better.
    vi.stubGlobal('fetch', statusFetch({ authed: true, passkeysEnrolled: 0, mode: 'passphrase' }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    await waitFor(() => expect(isAuthLost()).toBe(false));
  });

  it('warns a browser that arrives mid-window before it offers a field that cannot succeed', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 0, mode: 'locked-out' }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    expect(await screen.findByText(VERDICT_TEXT['locked-out'])).toBeInTheDocument();
  });

  it('clearing the signal wakes everything that parked — not a second step anyone must remember', () => {
    const woke = vi.fn();
    const stop = onAuthRegained(woke);
    raiseAuthLost('expired');
    clearAuthLost();
    expect(woke).toHaveBeenCalledTimes(1);

    stop();
    raiseAuthLost('expired');
    clearAuthLost();
    expect(woke).toHaveBeenCalledTimes(1); // unsubscribed, and stayed that way
  });

  it('never shows the passphrase', () => {
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    const field = screen.getByLabelText(/passphrase/i);
    expect(field).toHaveAttribute('type', 'password');
  });
});

// ── 5. the two websocket paths ──────────────────────────────────────────────

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  close(): void { this.closed = true; }
  open(): void { this.onopen?.(new Event('open')); }
  drop(): void { this.onclose?.(new Event('close') as CloseEvent); }
}

const gateSpy = () => {
  let lost = false;
  const regained = new Set<() => void>();
  const gate: AuthGate = {
    lost: () => lost,
    check: vi.fn(),
    onRegained: (fn) => { regained.add(fn); return () => { regained.delete(fn); }; },
  };
  return {
    gate,
    check: gate.check as ReturnType<typeof vi.fn>,
    lose: () => { lost = true; },
    regain: () => { lost = false; for (const fn of [...regained]) fn(); },
  };
};

describe('ReconnectingSocket against a closed gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeSocket.instances = [];
  });
  afterEach(() => { vi.useRealTimers(); });

  const harness = (gate: AuthGate) => {
    const socket = new ReconnectingSocket({
      url: () => '/ws/fleet',
      onMessage: vi.fn(),
      onState: vi.fn(),
      makeSocket: (u) => new FakeSocket(u) as unknown as WebSocket,
      auth: gate,
    });
    return socket;
  };
  const last = (): FakeSocket => {
    const s = FakeSocket.instances.at(-1);
    if (!s) throw new Error('no socket');
    return s;
  };

  it('asks the gate WHY when an attempt never opened — a refused upgrade looks like nothing else', () => {
    const g = gateSpy();
    const socket = harness(g.gate);
    socket.start();
    last().drop(); // refused handshake: no `onopen` ever fired
    expect(g.check).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  it('does NOT ask on an ordinary drop after a good open — the gate runs at upgrade, not mid-stream', () => {
    const g = gateSpy();
    const socket = harness(g.gate);
    socket.start();
    last().open();
    last().drop();
    expect(g.check).not.toHaveBeenCalled();
    socket.stop();
  });

  it('stands still while auth is lost instead of climbing the ladder forever', () => {
    const g = gateSpy();
    const socket = harness(g.gate);
    socket.start();
    g.lose();
    last().drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    socket.stop();
  });

  it('and comes straight back the moment the operator is in again', () => {
    const g = gateSpy();
    const socket = harness(g.gate);
    socket.start();
    g.lose();
    last().drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);

    g.regain();
    expect(FakeSocket.instances).toHaveLength(2);
    socket.stop();
  });

  it('stop() unsubscribes — a regain must not resurrect a socket the app tore down', () => {
    const g = gateSpy();
    const socket = harness(g.gate);
    socket.start();
    g.lose();
    socket.stop();
    g.regain();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('TerminalDrawer against a closed gate', () => {
  const fakeTerm = (): { makeTerm: (host: HTMLElement) => DrawerTerm } => ({
    makeTerm: () => ({
      write: () => {}, onData: () => {}, fit: () => ({ cols: 48, rows: 20 }),
      focus: () => {}, dispose: () => {},
    }),
  });
  const drawerSockets: FakeSocket[] = [];
  const makeSocket = (url: string): WebSocket => {
    const s = new FakeSocket(url);
    drawerSockets.push(s);
    return s as unknown as WebSocket;
  };

  beforeEach(() => { drawerSockets.length = 0; FakeSocket.instances = []; });

  it('a refused attach asks the gate why — the bare socket learns 401 no other way', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' }));
    render(
      <TerminalDrawer id="claude:demo" open onClose={() => {}} makeSocket={makeSocket}
        makeTerm={fakeTerm().makeTerm} />,
    );
    act(() => { drawerSockets.at(-1)!.drop(); });
    await waitFor(() => expect(isAuthLost()).toBe(true));
  });

  it('re-attaches when auth comes back, without a Reconnect tap', async () => {
    render(
      <TerminalDrawer id="claude:demo" open onClose={() => {}} makeSocket={makeSocket}
        makeTerm={fakeTerm().makeTerm} />,
    );
    expect(drawerSockets).toHaveLength(1);
    act(() => raiseAuthLost('expired'));
    await act(async () => { clearAuthLost(); });
    expect(drawerSockets).toHaveLength(2);
  });

  it('but leaves a LIVE terminal alone — the gate runs at upgrade, not mid-stream', async () => {
    // Review F2. An open pty survives an auth-lost episode raised somewhere else
    // entirely (a REST 401, the fleet socket's probe). Re-attaching it on the
    // regain would close a streaming terminal for nothing and make the server
    // restore the canonical tmux size under the reader's cursor.
    render(
      <TerminalDrawer id="claude:demo" open onClose={() => {}} makeSocket={makeSocket}
        makeTerm={fakeTerm().makeTerm} />,
    );
    act(() => { drawerSockets.at(-1)!.open(); });
    expect(drawerSockets).toHaveLength(1);

    act(() => raiseAuthLost('expired')); // raised by something that is not this socket
    await act(async () => { clearAuthLost(); });
    expect(drawerSockets).toHaveLength(1);
  });
});

// ── 6. dark by default ──────────────────────────────────────────────────────

describe('with `CCRC_AUTH` off the PWA behaves exactly as it does today', () => {
  it('the socket probe never raises when the box reports mode:"off"', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: true, passkeysEnrolled: 0, mode: 'off' }));
    checkAuth();
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    await act(async () => {});
    expect(isAuthLost()).toBe(false);
  });

  it('nor when the body carries NO `mode` at all — the arm `authed:true` was covering for', async () => {
    // Review F1. Every other dark fixture in this file also says `authed: true`,
    // so `checkAuth`'s `s.authed === true` arm caught them and the
    // `s.mode === undefined` guard beside it could be deleted with all four
    // staying green. THIS is the body that separates them, and it is reachable
    // three ways: an older server, a proxy answering 200 JSON of its own, and —
    // pointedly — the day someone flips `ANON_VISIBLE.mode` to `false`
    // (`server/src/server.ts`), a `Record<keyof AuthStatus, boolean>` that exists
    // precisely so each field can be narrowed one at a time.
    //
    // Without the guard this raises `'no-session'` and puts a full-screen,
    // UNENTERABLE login in front of an operator whose box has no gate. That is
    // the lockout this whole task is written against, so it gets its own case.
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 0 }));
    checkAuth();
    await act(async () => {});
    expect(isAuthLost()).toBe(false);
  });

  it('nor when the status route is missing altogether (an older server)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'not-found' })));
    checkAuth();
    await act(async () => {});
    expect(isAuthLost()).toBe(false);
  });

  it('and the shell renders with no login screen anywhere near it', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: true, passkeysEnrolled: 0, mode: 'off' },
      () => json(401, { ok: false, error: 'nope' })));
    render(<App />);
    const api = createApi();
    await act(async () => { await api.fleet().catch(() => {}); });
    checkAuth();
    await act(async () => {});

    expect(document.querySelector('.login-screen')).not.toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toBeInTheDocument();
  });

  it('an armed box that reports us still signed in clears a stale signal', async () => {
    vi.stubGlobal('fetch', statusFetch({ authed: true, passkeysEnrolled: 0, mode: 'passphrase' }));
    raiseAuthLost('no-session');
    checkAuth();
    await waitFor(() => expect(isAuthLost()).toBe(false));
  });
});
