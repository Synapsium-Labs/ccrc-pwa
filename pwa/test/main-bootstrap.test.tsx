// THE BOOTSTRAP'S ONE REAL DECISION — the update check — and the reason it is
// worth a test even though `main.tsx` is mostly plumbing.
//
// PWA updates are automatic (`registerType: 'autoUpdate'`), so a new worker
// skip-waits and takes the page over by itself. Since console speed Task C3 the
// page no longer reloads on that activation: `registerSW` is handed
// `onNeedReload` (`noteActivated`), which only marks a reload as pending, and
// the reload gate started at boot runs it at the next move between screens
// once the page has been visible for 15 s. The other gap is the update check: a browser only re-fetches `sw.js` on NAVIGATION or once a
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
  onNeedReload: null as null | (() => void),
  rendered: 0,
  tree: null as unknown,
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: {
    onRegisteredSW?: (url: string, reg?: ServiceWorkerRegistration) => void;
    onNeedReload?: () => void;
  }) => {
    captured.onRegisteredSW = opts.onRegisteredSW ?? null;
    captured.onNeedReload = opts.onNeedReload ?? null;
  },
}));

// The gate main.tsx starts runs for real, on fake acts with their own clock: jsdom's `location` cannot be spied on.
const gate = vi.hoisted(() => ({ now: 0, reload: 0, go: [] as [string, boolean][] }));
vi.mock('../src/lib/swupdate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/swupdate')>();
  return {
    ...real,
    startReloadGate: () => real.startReloadGate({
      reload: () => { gate.reload += 1; },
      go: (href: string, replace: boolean) => { gate.go.push([href, replace]); },
      now: () => gate.now,
    }),
  };
});

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: (el: unknown) => { captured.rendered += 1; captured.tree = el; }, unmount: () => {} }),
}));

const UPDATE_CHECK_MS = 15 * 60 * 1000;

/** A registration whose `update()` is a spy. */
const registration = (): { update: ReturnType<typeof vi.fn> } => ({ update: vi.fn() });

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  captured.onRegisteredSW = null;
  captured.onNeedReload = null;
  captured.rendered = 0;
  gate.now = 1_000_000;
  gate.reload = 0;
  gate.go = [];
  // The real swupdate behind the mock outlives resetModules: start each case from a fresh gate, so one case's latch
  // or block screen never answers for the next.
  (await import('../src/lib/swupdate')).resetReloadGateForTests();
  vi.resetModules();
  await import('../src/main');
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** Every element type in a React element tree, by name, without rendering it. */
function typeNames(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { for (const n of node) typeNames(n, out); return out; }
  if (node === null || typeof node !== 'object' || !('type' in node)) return out;
  const el = node as { type: unknown; props: { children?: unknown } };
  const t = el.type as { name?: string; displayName?: string } | string | symbol;
  out.push(typeof t === 'string' ? t : typeof t === 'symbol' ? String(t) : (t.displayName ?? t.name ?? '?'));
  typeNames(el.props.children, out);
  return out;
}

describe('main.tsx mounts the app alone under the root boundary (D-5467)', () => {
  it('the command layer is not beside the app any more: app.tsx mounts it above the skin frame', () => {
    const names = typeNames(captured.tree);
    expect(names).toContain('App');
    expect(names).toContain('RenderBoundary');
    expect(names).not.toContain('CommandLayer');
  });
});

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

describe('main.tsx hands the release reload to the gate (console speed, Task C3)', () => {
  it('registerSW is handed onNeedReload, so the plugin never reloads the page by itself', async () => {
    // vite-plugin-pwa 2.0.0's auto arm calls `window.location.reload()` on the new worker's `activated` event
    // unless it is given `onNeedReload`; given it, it calls that instead.
    const { noteActivated } = await import('../src/lib/swupdate');
    expect(captured.onNeedReload, 'without it the plugin reloads on every activation').toBe(noteActivated);
    captured.onNeedReload?.();
    expect(gate.reload, 'an activation alone reloads nothing').toBe(0);
    expect(gate.go).toEqual([]);
  });

  it('the gate is started at boot', async () => {
    const { navigate } = await import('../src/lib/router');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    captured.onNeedReload?.();
    gate.now += 15_000;
    navigate('/runs');
    expect(gate.go).toEqual([['/runs', false]]);
    expect(location.pathname, 'nothing pushed: the new path loads as a full page').toBe('/');
  });
  it('a move holds while a send is unresolved, and reloads on the first move after (fix round 1, F4)', async () => {
    const { navigate } = await import('../src/lib/router');
    const { getSessionStore } = await import('../src/stores/session');
    const store = getSessionStore('boot-hold');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    captured.onNeedReload?.();
    gate.now += 60_000;
    store.setState({ pending: [{ key: 'p1', text: 'hello', state: 'failed', error: 'not sent' }] });
    navigate('/runs');
    expect(gate.go, 'a failed send showing Retry holds the reload').toEqual([]);
    store.setState({ pending: [] });
    navigate('/accounts');
    expect(gate.go).toEqual([['/accounts', false]]);
    history.replaceState(null, '', '/');
  });

  it('the block probe reads the fleet store: a block that lifted is no longer urgent (fix round 1, F5)', async () => {
    const { requestUpdate } = await import('../src/lib/swupdate');
    const { useFleetStore } = await import('../src/stores/fleet');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    useFleetStore.setState({ blocked: false });
    requestUpdate();
    useFleetStore.setState({ blocked: true });
    useFleetStore.setState({ blocked: false });
    captured.onNeedReload?.();
    expect(gate.reload, 'the block lifted: the release waits for a move').toBe(0);
  });
});
