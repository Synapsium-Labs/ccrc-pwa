// The count on the installed icon (the Overlord face plan, Task 10): `badgeAct` decides, `useAppBadge` writes.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { badgeAct } from '../src/face/badgeAct';
import { AppBadge } from '../src/face/AppBadge';
import { resetAppBadgeForTests } from '../src/face/useAppBadge';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { itemView, waitingView } from './ledgersFixture';

const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;

const nav = navigator as unknown as Record<string, unknown>;
let setApp: ReturnType<typeof vi.fn>;
let clearApp: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAppBadgeForTests();
  setApp = vi.fn(async () => {});
  clearApp = vi.fn(async () => {});
  nav.setAppBadge = setApp;
  nav.clearAppBadge = clearApp;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete nav.setAppBadge;
  delete nav.clearAppBadge;
});

function mount() {
  const store = createFleetStore({ makeSocket });
  const wrapper = ({ children }: { children?: ReactNode }) => <FleetChromeProvider store={store}>{children}</FleetChromeProvider>;
  render(<AppBadge />, { wrapper });
  return store;
}
const frame = (store: ReturnType<typeof mount>, items: number, asking: number) =>
  act(() => store.setState({
    waiting: waitingView({ items: Array.from({ length: items }, (_, i) => itemView({ id: i + 1 })) }),
    sessions: Array.from({ length: asking }, (_, i) => fleetSession({ id: `lane-a-${i}`, bucket: 'attention' })),
    fleetFrameSeen: true, runs: [], runsFrameSeen: true,
  }));

describe('badgeAct', () => {
  it('a count not heard yet leaves the badge as it was', () => {
    expect(badgeAct(null, null)).toEqual({ kind: 'leave' });
    expect(badgeAct(null, 4)).toEqual({ kind: 'leave' });
  });
  it('the first heard 0 clears the badge', () => {
    expect(badgeAct(0, null)).toEqual({ kind: 'clear' });
  });
  it('0 after a count clears it', () => {
    expect(badgeAct(0, 3)).toEqual({ kind: 'clear' });
  });
  it('3 sets 3', () => {
    expect(badgeAct(3, null)).toEqual({ kind: 'set', n: 3 });
    expect(badgeAct(3, 2)).toEqual({ kind: 'set', n: 3 });
  });
  it('a count equal to the last one written leaves the badge as it is', () => {
    expect(badgeAct(0, 0)).toEqual({ kind: 'leave' });
    expect(badgeAct(3, 3)).toEqual({ kind: 'leave' });
  });
});

describe('useAppBadge', () => {
  it('counts what the Waiting on you door counts', () => {
    const store = mount();
    expect(setApp).not.toHaveBeenCalled();
    expect(clearApp).not.toHaveBeenCalled();
    frame(store, 2, 1);
    expect(setApp).toHaveBeenCalledTimes(1);
    expect(setApp).toHaveBeenCalledWith(3);
  });

  it('a frame that changes nothing writes nothing, and 0 clears', () => {
    const store = mount();
    frame(store, 2, 1);
    frame(store, 2, 1);
    expect(setApp).toHaveBeenCalledTimes(1);
    frame(store, 0, 0);
    expect(clearApp).toHaveBeenCalledTimes(1);
  });

  it('a browser without the API is never called and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete nav.setAppBadge;
    delete nav.clearAppBadge;
    const store = mount();
    expect(() => frame(store, 1, 0)).not.toThrow();
    expect(setApp).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['setAppBadge', 'clearAppBadge'])('a browser with only %s calls neither and warns nothing', (only) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete nav[only === 'setAppBadge' ? 'clearAppBadge' : 'setAppBadge'];
    const store = mount();
    frame(store, 1, 0);
    frame(store, 0, 0);
    expect(setApp).not.toHaveBeenCalled();
    expect(clearApp).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a synchronous throw warns once and stops', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setApp.mockImplementation(() => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); });
    const store = mount();
    frame(store, 1, 0);
    frame(store, 2, 0);
    frame(store, 0, 0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(setApp).toHaveBeenCalledTimes(1);
    expect(clearApp).not.toHaveBeenCalled();
  });

  it('a refusal warns once and stops', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setApp.mockImplementation(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); });
    const store = mount();
    frame(store, 1, 0);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('ccrc: app badge refused: NotAllowedError');
    frame(store, 2, 0);
    frame(store, 0, 0);
    await act(async () => { await Promise.resolve(); });
    expect(setApp).toHaveBeenCalledTimes(1);
    expect(clearApp).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
