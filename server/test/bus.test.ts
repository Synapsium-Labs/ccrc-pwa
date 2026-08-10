// `Bus`'s max-listener cap. EventEmitter's default (10) is a leak heuristic
// sized for a handful of subscribers, not for this bus's actual, by-design
// fan-out — every open per-session stream (sessionws.ts's SessionStream) and
// every open /ws/fleet connection (server.ts) adds one `notice` listener, so
// past 10 concurrent viewers the live server logged "Possible EventEmitter
// memory leak detected" even though every listener IS removed on close. RED
// before the fix: `new Bus().getMaxListeners()` was 10 (Node's own default —
// confirmed against a bare `EventEmitter` subclass with no constructor,
// exactly what `Bus` was before this test).
import { describe, it, expect } from 'vitest';
import { Bus } from '../src/bus.js';

describe('Bus max listeners', () => {
  it('raises the default cap so concurrent viewers past 10 do not warn', () => {
    expect(new Bus().getMaxListeners()).toBeGreaterThan(10);
  });

  it('really does tolerate more than 10 notice listeners at once, cleanly', () => {
    const bus = new Bus();
    const fns = Array.from({ length: 30 }, () => (): void => {});
    for (const fn of fns) bus.on('notice', fn);
    expect(bus.listenerCount('notice')).toBe(30);
    for (const fn of fns) bus.off('notice', fn);
    expect(bus.listenerCount('notice')).toBe(0);
  });
});
