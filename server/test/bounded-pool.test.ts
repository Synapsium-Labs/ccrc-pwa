// The bounded pool (desktop polish C1, D-6388): B4's promise limiter (D-6369), pinned before it moves out of
// transcript/resolve.ts into bounded.ts. Four cases, green on the old code (characterization), so the move
// commit changes only this file's import.
import { describe, expect, it } from 'vitest';
import { limiter } from '../src/transcript/resolve.js';

/** A call the test settles by hand, so it controls exactly when each slot frees. */
const gate = () => {
  let resolve!: (v: void) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

/** Lets every queued microtask run. */
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe('the bounded pool (the limiter)', () => {
  it('at most max in flight', async () => {
    const limit = limiter(2);
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, gate);
    const runs = gates.map((g) => limit(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await g.promise;
      inFlight -= 1;
    }));
    await settle();
    expect(inFlight).toBe(2);
    for (const g of gates) { g.resolve(); await settle(); }
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it('waiters start in arrival order', async () => {
    const limit = limiter(1);
    const started: number[] = [];
    const gates = Array.from({ length: 4 }, gate);
    const runs = gates.map((g, i) => limit(async () => { started.push(i); await g.promise; }));
    await settle();
    expect(started).toEqual([0]);
    for (const g of gates) { g.resolve(); await settle(); }
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('a rejecting call frees its slot', async () => {
    const limit = limiter(1);
    const first = gate();
    const failing = limit(async () => { await first.promise; });
    let secondStarted = false;
    const second = limit(async () => { secondStarted = true; return 'ok'; });
    const caught = failing.catch((e: Error) => e.message);
    await settle();
    expect(secondStarted).toBe(false);
    first.reject(new Error('boom'));
    expect(await caught).toBe('boom');
    expect(await second).toBe('ok');
    // the slot is not leaked: a later call still runs at once
    expect(await limit(async () => 'later')).toBe('later');
  });

  it('a freed slot passes straight to the longest waiter', async () => {
    const limit = limiter(2);
    const g = [gate(), gate()];
    let inFlight = 0;
    const counts: number[] = [];
    const call = (gt: ReturnType<typeof gate> | null) => limit(async () => {
      inFlight += 1;
      counts.push(inFlight);
      if (gt !== null) await gt.promise;
      inFlight -= 1;
    });
    const a = call(g[0]);
    const b = call(g[1]);
    const waiterGate = gate();
    const w = call(waiterGate);
    await settle();
    expect(inFlight).toBe(2);
    g[0].resolve();
    await settle();
    // the waiter took the freed slot at once: still two in flight, never one
    expect(inFlight).toBe(2);
    expect(counts).toEqual([1, 2, 2]);
    g[1].resolve();
    waiterGate.resolve();
    await Promise.all([a, b, w]);
    expect(inFlight).toBe(0);
  });
});
