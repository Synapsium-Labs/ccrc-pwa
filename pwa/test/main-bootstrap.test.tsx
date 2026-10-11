// THE BOOTSTRAP'S ONE REAL DECISION — the update check — and the reason it is
// worth a test even though `main.tsx` is mostly plumbing.
//
// PWA updates are automatic (`registerType: 'autoUpdate'`), so a new worker
// skip-waits and reloads the page by itself. The gap that leaves is the whole
// of this block: a browser only re-fetches `sw.js` on NAVIGATION or once a
// day, and this app never navigates — one document, client-side routing, left
// open for days on a phone. Without the check below a deploy sits unseen
// behind a running tab indefinitely, which presents as "the feature you just
// shipped isn't there".
//
// `main.tsx` measured 0% of statements, the only file in the package that did.
// Mounting the app is mocked away; what runs for real is `onRegisteredSW`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  onRegisteredSW: null as null | ((url: string, reg?: ServiceWorkerRegistration) => void),
  rendered: 0,
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: { onRegisteredSW?: (url: string, reg?: ServiceWorkerRegistration) => void }) => {
    captured.onRegisteredSW = opts.onRegisteredSW ?? null;
  },
}));

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: () => { captured.rendered += 1; }, unmount: () => {} }),
}));

const UPDATE_CHECK_MS = 15 * 60 * 1000;

/** A registration whose `update()` is a spy. */
const registration = (): { update: ReturnType<typeof vi.fn> } => ({ update: vi.fn() });

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  captured.onRegisteredSW = null;
  captured.rendered = 0;
  vi.resetModules();
  await import('../src/main');
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('main.tsx boots the app and asks for its own updates', () => {
  it('renders once, and hands `registerSW` a registration callback', () => {
    expect(captured.rendered, 'the app is mounted exactly once').toBe(1);
    expect(captured.onRegisteredSW, 'without this callback nothing ever checks').not.toBeNull();
  });

  it('schedules NOTHING when there is no registration', () => {
    // The `if (!registration) return` arm — dev, or a registration that never
    // resolved. A timer closing over `undefined` would throw on the first tick,
    // fifteen minutes after boot, where nobody is looking.
    const before = vi.getTimerCount();
    captured.onRegisteredSW?.('/sw.js', undefined);
    expect(vi.getTimerCount()).toBe(before);
  });

  it('asks the registration to look again every fifteen minutes', async () => {
    const reg = registration();
    captured.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    expect(reg.update, 'the check is scheduled, not fired at boot').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(reg.update, 'an interval, not a timeout — a tab lives for days').toHaveBeenCalledTimes(2);
  });

  it('looks again the moment the app comes back to the foreground', () => {
    // The moment a phone user actually returns to it, which is the one moment
    // a stale tab is about to be read.
    const reg = registration();
    captured.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it('does NOT look when the app goes away', () => {
    // Backgrounding is not a reason to fetch: the answer could not be acted on
    // and the request would be spent on a tab nobody is reading.
    const reg = registration();
    captured.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reg.update).not.toHaveBeenCalled();
  });

  it('wires the store\'s own door — an incompatible `hello` checks immediately', async () => {
    // `setUpdater`, the indirection `swupdate.ts` exists for: the fleet store
    // reacts to a WS frame without importing `virtual:pwa-register`, and this
    // is the only place the two are joined. Before registration lands,
    // `requestUpdate` is a no-op — which is what makes a store test possible
    // at all.
    const { requestUpdate } = await import('../src/lib/swupdate');
    const reg = registration();
    captured.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    requestUpdate();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
