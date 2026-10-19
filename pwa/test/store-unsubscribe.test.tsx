// An unmounted picker leaves no listener behind in the store it read (D-5578).
//
// `lib/theme.ts` and `lib/skin.ts` keep their listeners in a module-private
// Set, and `subscribe` hands React an unsubscribe that deletes from it. Nothing
// checked that half: make the unsubscribe a no-op and every picker suite stays
// green, because a listener left behind for an unmounted fiber does nothing
// anyone can see. It is still a leak: each Settings visit would add one more
// call to every theme or layout switch for the page's life.
//
// THE SEAM. The stores are not changed for this test. `useSyncExternalStore`
// is wrapped, transparently, so the listener React passes to each store's
// `subscribe` is a spy that still calls React's own. The pickers render as
// they do in the app; what is asserted is the store's contract: after
// unmount, a switch reaches none of the listeners the picker subscribed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';

const spies = vi.hoisted(() => [] as Array<ReturnType<typeof import('vitest').vi.fn>>);

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const { vi: v } = await import('vitest');
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      subscribe: (onChange: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T => actual.useSyncExternalStore(
      // Memoised on the store's own subscribe, so React does not resubscribe
      // on every render because the wrapper is a new function.
      wrapped(subscribe, (onChange) => {
        const spy = v.fn(onChange);
        spies.push(spy);
        return subscribe(spy);
      }),
      getSnapshot,
      getServerSnapshot,
    ),
  };
});

const wrappers = new WeakMap<object, (onChange: () => void) => () => void>();
function wrapped(
  key: (onChange: () => void) => () => void,
  make: (onChange: () => void) => () => void,
): (onChange: () => void) => () => void {
  let w = wrappers.get(key);
  if (!w) { w = make; wrappers.set(key, w); }
  return w;
}

// Imported after the mock is declared (vi.mock is hoisted above these).
const { initTheme, setTheme } = await import('../src/lib/theme');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { AppearanceSection } = await import('../src/screens/SettingsScreen');
const { SkinFieldset } = await import('../src/screens/SkinFieldset');

const media = (matches: boolean) => ({ matches, addEventListener: () => {} });
const calls = (): number => spies.reduce((n, s) => n + s.mock.calls.length, 0);

beforeEach(() => {
  spies.length = 0;
  localStorage.clear();
  initTheme(media(false));
  initSkin();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('an unmounted picker removes its listener', () => {
  it('the theme store: a switch after the Theme picker unmounts reaches no listener it subscribed', () => {
    const view = render(<AppearanceSection />);
    expect(spies.length, 'the picker subscribed through useSyncExternalStore').toBeGreaterThan(0);
    // Wired: while mounted, a switch reaches the picker's listener.
    setTheme('nord', media(false));
    expect(calls(), 'a mounted picker hears the switch').toBeGreaterThan(0);

    view.unmount();
    const before = calls();
    setTheme('dracula', media(false));
    setTheme('nord', media(false));
    expect(calls(), 'no listener survives the unmount').toBe(before);
  });

  it('the skin store: a switch after the Layout picker unmounts reaches no listener it subscribed', () => {
    const view = render(<SkinFieldset />);
    expect(spies.length, 'the picker subscribed through useSyncExternalStore').toBeGreaterThan(0);
    setSkin(INSTRUMENT);
    expect(calls(), 'a mounted picker hears the switch').toBeGreaterThan(0);

    view.unmount();
    const before = calls();
    setSkin(REFINED);
    setSkin(INSTRUMENT);
    expect(calls(), 'no listener survives the unmount').toBe(before);
  });
});
