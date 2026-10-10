// The push lifecycle's six answers, and the three that only differ in WHY.
//
// WHY THIS FILE EXISTS. `lib/push.ts` is 98 lines carrying six distinct
// `EnableStatus` outcomes, and coverage measured it at EIGHT PER CENT — the
// lowest real module in the package (`main.tsx` is the app's own mount). Every
// one of those outcomes is a condition a caller handles differently, which is
// the distinction this repo guards everywhere else ("no overloaded null at a
// seam"); none of them had a test. A module that can answer `unconfigured`,
// `pushservice` and `error` and has never been asked to is three claims nobody
// has checked.
//
// THE ONE THAT MATTERS MOST is `pushservice`: permission was GRANTED and
// `subscribe()` still threw. Brave disables Google's push transport by
// default, so the browser says yes and the transport says no — and a UI that
// folded that into `error` would send the reader to the wrong setting. It is
// asserted here with its detail, because the detail is the remedy.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush, errText, pushEnabled, pushSupported } from '../src/lib/push';

/** A push subscription stub, with the one field `disablePush` sends back. */
const subscription = (over: Partial<{ endpoint: string; unsubscribe: () => Promise<boolean> }> = {}) => ({
  endpoint: 'https://push.example/abc',
  unsubscribe: vi.fn().mockResolvedValue(true),
  toJSON: () => ({ endpoint: 'https://push.example/abc' }),
  ...over,
});

/** The three globals this module reads, planted together so a case says only
 *  what it changes. `permission` and the registration are the two the browser
 *  owns; `fetch` is the server. */
function plant(opts: {
  supported?: boolean;
  permission?: NotificationPermission;
  existing?: ReturnType<typeof subscription> | null;
  subscribe?: () => Promise<unknown>;
  fetchImpl?: typeof fetch;
} = {}): { subscribe: ReturnType<typeof vi.fn>; fetches: string[] } {
  const subscribeSpy = vi.fn(opts.subscribe ?? (async () => subscription()));
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(opts.existing ?? null),
    subscribe: subscribeSpy,
  };
  const reg = { pushManager };
  const fetches: string[] = [];
  // `pushSupported` asks `'serviceWorker' in navigator`, so ABSENCE is the
  // unsupported case — a key holding `undefined` still answers `in`. The two
  // stubs below therefore build two different OBJECTS rather than one object
  // with a blanked field; measured, because the first version of this helper
  // set the field to `undefined` and three cases read as supported anyway.
  if (opts.supported === false) {
    const { serviceWorker: _drop, ...rest } = navigator as unknown as Record<string, unknown>;
    vi.stubGlobal('navigator', rest);
    // jsdom ships no `PushManager`, so absence here is the default rather than
    // something to plant. Nothing to stub: the global simply is not there.
  } else {
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg },
    });
    vi.stubGlobal('PushManager', class {});
  }
  vi.stubGlobal('Notification', Object.assign(class {}, {
    permission: opts.permission ?? 'granted',
    requestPermission: vi.fn().mockResolvedValue(opts.permission ?? 'granted'),
  }));
  vi.stubGlobal('fetch', opts.fetchImpl ?? vi.fn(async (url: RequestInfo | URL) => {
    fetches.push(String(url));
    if (String(url).endsWith('/api/push/key')) {
      return new Response(JSON.stringify({ key: 'BBBB-___' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return { subscribe: subscribeSpy, fetches };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('enablePush — every status, and the detail that is the remedy', () => {
  it('answers `unsupported` without asking the reader for permission', async () => {
    // The prompt is the expensive part: a browser that cannot push must never
    // spend the one permission ask a reader will grant.
    plant({ supported: false });
    expect(await enablePush()).toEqual({ status: 'unsupported' });
    expect((Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> })
      .requestPermission).not.toHaveBeenCalled();
  });

  it('answers `denied` when the reader says no', async () => {
    plant({ permission: 'denied' });
    expect(await enablePush()).toEqual({ status: 'denied' });
  });

  it('answers `unconfigured` for a 501 key endpoint — the box has no VAPID pair', async () => {
    // 501 is the server saying "this feature is not wired here", which is not
    // an error the reader can act on by retrying.
    plant({ fetchImpl: vi.fn(async () => new Response('', { status: 501 })) as unknown as typeof fetch });
    expect(await enablePush()).toEqual({ status: 'unconfigured' });
  });

  it('answers `error` with the status when the key endpoint fails otherwise', async () => {
    plant({ fetchImpl: vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch });
    expect(await enablePush()).toEqual({ status: 'error', detail: 'key endpoint 503' });
  });

  it('answers `pushservice`, NOT `error`, when permission is granted and subscribe throws', async () => {
    // THE BRAVE CASE. Permission granted, transport blocked — two different
    // settings, and only this status points at the right one.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    plant({ subscribe: async () => { throw new DOMException('Registration failed', 'AbortError'); } });
    const r = await enablePush();
    expect(r.status).toBe('pushservice');
    expect(r.detail, 'the detail names the cause, because the detail is the remedy')
      .toContain('AbortError');
  });

  it('subscribes with the server key decoded to bytes, and reports `enabled`', async () => {
    // The one piece of arithmetic in this file: base64url → Uint8Array, with
    // the padding restored and the two substituted characters put back. `-`
    // and `_` in the planted key are what make that assertion mean something.
    const { subscribe, fetches } = plant();
    expect(await enablePush()).toEqual({ status: 'enabled' });
    const arg = subscribe.mock.calls[0]?.[0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(arg.userVisibleOnly, 'a silent push would be a permission the reader did not grant').toBe(true);
    expect(Array.from(arg.applicationServerKey))
      .toEqual(Array.from(new Uint8Array(atob('BBBB+///').split('').map((c) => c.charCodeAt(0)))));
    expect(fetches).toEqual(['/api/push/key', '/api/push/subscribe']);
  });

  it('reuses an existing subscription rather than minting a second', async () => {
    const { subscribe } = plant({ existing: subscription() });
    expect(await enablePush()).toEqual({ status: 'enabled' });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('answers `error` with the status when the server refuses the subscription', async () => {
    plant({
      fetchImpl: vi.fn(async (url: RequestInfo | URL) => (String(url).endsWith('/api/push/key')
        ? new Response(JSON.stringify({ key: 'BBBB' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('', { status: 409 }))) as unknown as typeof fetch,
    });
    expect(await enablePush()).toEqual({ status: 'error', detail: 'subscribe endpoint 409' });
  });
});

describe('pushEnabled — subscribed AND permitted, never one of the two', () => {
  it('is false on a browser that cannot push', async () => {
    plant({ supported: false });
    expect(await pushEnabled()).toBe(false);
  });

  it('is false while permission is merely `default` — a subscription is not consent', async () => {
    plant({ permission: 'default', existing: subscription() });
    expect(await pushEnabled()).toBe(false);
  });

  it('is false with permission but no subscription — consent is not a subscription either', async () => {
    plant({ existing: null });
    expect(await pushEnabled()).toBe(false);
  });

  it('is true only when both hold', async () => {
    plant({ existing: subscription() });
    expect(await pushEnabled()).toBe(true);
  });
});

describe('disablePush — tells the server first, then the browser', () => {
  it('does nothing at all when there is no subscription', async () => {
    const { fetches } = plant({ existing: null });
    await disablePush();
    expect(fetches, 'a box with nothing subscribed must not be told to unsubscribe').toEqual([]);
  });

  it('posts the endpoint, then unsubscribes locally', async () => {
    const sub = subscription();
    const { fetches } = plant({ existing: sub });
    await disablePush();
    expect(fetches).toEqual(['/api/push/unsubscribe']);
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('still unsubscribes locally when the server call fails — the reader asked for off', async () => {
    // Both halves are `.catch(() => {})` in the source, and this is the one
    // that matters: a server that cannot be reached must not leave the browser
    // subscribed to pushes the reader has just turned off.
    const sub = subscription();
    plant({ existing: sub, fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch });
    await disablePush();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});

describe('errText', () => {
  it('names a DOMException by name AND message, which is what the UI shows', () => {
    expect(errText(new DOMException('Registration failed', 'AbortError')))
      .toBe('AbortError: Registration failed');
  });

  it('falls back to String() for a thrown non-Error', () => {
    expect(errText('plain')).toBe('plain');
    expect(errText(undefined)).toBe('undefined');
  });
});

describe('pushSupported', () => {
  it('is false when any one of the three APIs is missing', async () => {
    plant({ supported: false });
    expect(pushSupported()).toBe(false);
  });

  it('is true when all three are there', () => {
    plant();
    expect(pushSupported()).toBe(true);
  });
});
