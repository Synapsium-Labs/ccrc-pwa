// The page clock (D-7191; ARCH-75, #810; W7 C7m): one `visibilitychange` and one `online` listener however many
// subscribers; each stop removes only its own handler; the listener goes with the last stop (Review focus 10: a
// listener that never unsubscribes).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onOnline, onPageHidden, onPageVisible } from '../src/lib/pageClock';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};
const turn = (v: DocumentVisibilityState): void => {
  setVisibility(v);
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
});

/** Live listeners of `type` on `target`, counted from its add and remove calls since the spy was set. */
const listenerCount = (target: EventTarget, type: string): (() => number) => {
  const add = vi.spyOn(target, 'addEventListener');
  const remove = vi.spyOn(target, 'removeEventListener');
  return () => add.mock.calls.filter(([t]) => t === type).length - remove.mock.calls.filter(([t]) => t === type).length;
};

describe('the page clock', () => {
  it('one visibilitychange listener however many subscribers, visible and hidden alike', () => {
    const live = listenerCount(document, 'visibilitychange');
    const stops = [onPageVisible(() => {}), onPageVisible(() => {}), onPageHidden(() => {}), onPageHidden(() => {})];
    expect(live()).toBe(1);
    for (const stop of stops) stop();
    expect(live()).toBe(0);
  });

  it('one online listener however many subscribers', () => {
    const live = listenerCount(window, 'online');
    const stops = [onOnline(() => {}), onOnline(() => {}), onOnline(() => {})];
    expect(live()).toBe(1);
    for (const stop of stops) stop();
    expect(live()).toBe(0);
  });

  it('visible handlers run on visible, hidden handlers on hidden, online handlers on online', () => {
    const visible = vi.fn();
    const hidden = vi.fn();
    const online = vi.fn();
    const stops = [onPageVisible(visible), onPageHidden(hidden), onOnline(online)];
    turn('visible');
    expect([visible.mock.calls.length, hidden.mock.calls.length, online.mock.calls.length]).toEqual([1, 0, 0]);
    turn('hidden');
    expect([visible.mock.calls.length, hidden.mock.calls.length, online.mock.calls.length]).toEqual([1, 1, 0]);
    window.dispatchEvent(new Event('online'));
    expect([visible.mock.calls.length, hidden.mock.calls.length, online.mock.calls.length]).toEqual([1, 1, 1]);
    for (const stop of stops) stop();
  });

  it('each stop removes only its own handler', () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onPageVisible(a);
    const stopB = onPageVisible(b);
    stopA();
    stopA();   // a second stop is a no-op, never another subscriber's
    turn('visible');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    stopB();
    turn('visible');
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('the listener goes with the last stop, and the next subscriber adds it again', () => {
    const live = listenerCount(document, 'visibilitychange');
    const stopVisible = onPageVisible(() => {});
    const stopHidden = onPageHidden(() => {});
    stopVisible();
    expect(live()).toBe(1);   // the hidden subscriber still holds it
    stopHidden();
    expect(live()).toBe(0);
    const again = vi.fn();
    const stopAgain = onPageVisible(again);
    expect(live()).toBe(1);
    turn('visible');
    expect(again).toHaveBeenCalledTimes(1);
    stopAgain();
    expect(live()).toBe(0);
  });

  it('keeps the DOM\'s rules: order of subscription, one hold per handler, no run for a handler stopped mid-dispatch', () => {
    const order: string[] = [];
    const twice = (): void => { order.push('twice'); };
    let stopLast: () => void = () => {};
    const stops = [
      onPageVisible(() => { order.push('first'); stopLast(); }),
      onPageVisible(twice),
      onPageVisible(twice),
    ];
    stopLast = onPageVisible(() => { order.push('last'); });
    turn('visible');
    expect(order).toEqual(['first', 'twice']);
    for (const stop of stops) stop();
  });

  it('leak rows: 100 subscribers mounted and stopped leave zero listeners', () => {
    const vis = listenerCount(document, 'visibilitychange');
    const on = listenerCount(window, 'online');
    const stops: (() => void)[] = [];
    for (let i = 0; i < 100; i += 1) {
      stops.push(onPageVisible(() => {}), onPageHidden(() => {}), onOnline(() => {}));
    }
    expect([vis(), on()]).toEqual([1, 1]);
    for (const stop of stops) stop();
    expect([vis(), on()]).toEqual([0, 0]);
  });
});
