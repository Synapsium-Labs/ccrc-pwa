// The bounded pool (desktop polish C1, D-6388): B4's promise limiter (D-6369), pinned before it moves out of
// transcript/resolve.ts into bounded.ts. The four limiter cases were green on the old code (characterization),
// so the move commit changed only this file's import; the mapBounded cases came with mapBounded.
import { describe, expect, it } from 'vitest';
import { limiter, mapBounded } from '../src/bounded.js';

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
    // a late arrival finds the bound still full: the handoff never let the count dip below it
    const lateGate = gate();
    const late = call(lateGate);
    await settle();
    expect(inFlight).toBe(2);
    expect(counts).toEqual([1, 2, 2]);
    g[1].resolve();
    waiterGate.resolve();
    lateGate.resolve();
    await Promise.all([a, b, w, late]);
    expect(inFlight).toBe(0);
  });

  it('a late call issued synchronously right after a call resolves finds the bound still full', async () => {
    const limit = limiter(2);
    let inFlight = 0;
    const call = (gt: ReturnType<typeof gate>) => limit(async () => {
      inFlight += 1;
      await gt.promise;
      inFlight -= 1;
    });
    const ga = gate();
    const gb = gate();
    const gw = gate();
    const a = call(ga);
    const b = call(gb);
    const w = call(gw);
    await settle();
    expect(inFlight).toBe(2);
    ga.resolve();
    await a;   // a has fully returned: its slot is released, and handed to w
    // SYNCHRONOUSLY, before any further await: a late call arrives right after a's resolution
    let lateStarted = false;
    const lateGate = gate();
    const late = limit(async () => { lateStarted = true; await lateGate.promise; });
    expect(lateStarted).toBe(false);
    expect(inFlight).toBe(2);   // w took a's slot: b and w, never one
    await settle();
    expect(inFlight).toBe(2);
    expect(lateStarted).toBe(false);
    gb.resolve();
    gw.resolve();
    lateGate.resolve();
    await Promise.all([b, w, late]);
    expect(lateStarted).toBe(true);
    expect(inFlight).toBe(0);
  });
});

describe('mapBounded', () => {
  it('mapBounded answers in input order when calls finish in reverse', async () => {
    const gates = Array.from({ length: 4 }, gate);
    const run = mapBounded([10, 20, 30, 40], 4, async (n, i) => { await gates[i].promise; return n + 1; });
    await settle();
    for (const g of [...gates].reverse()) { g.resolve(); await settle(); }
    expect(await run).toEqual([11, 21, 31, 41]);
  });

  it('mapBounded never exceeds limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 7 }, gate);
    const run = mapBounded(gates, 3, async (g) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await g.promise;
      inFlight -= 1;
    });
    await settle();
    expect(inFlight).toBe(3);
    for (const g of gates) { g.resolve(); await settle(); }
    await run;
    expect(peak).toBe(3);
  });

  it('mapBounded refuses a limit that is not an integer of at least 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mapBounded([1], bad, async (n) => n), String(bad)).toThrow(RangeError);
    }
  });

  it('mapBounded passes the index and answers an empty list', async () => {
    expect(await mapBounded(['a', 'b'], 1, async (x, i) => `${x}${i}`)).toEqual(['a0', 'b1']);
    expect(await mapBounded([], 3, async () => 1)).toEqual([]);
  });

  it('mapBounded rejects as Promise.all does, and every started call still frees its slot', async () => {
    const started: number[] = [];
    const run = mapBounded([0, 1, 2, 3], 1, async (n) => {
      started.push(n);
      if (n === 1) throw new Error('boom');
      return n;
    });
    await expect(run).rejects.toThrow('boom');
    await settle();
    // the failing call freed its slot, so the pool drained rather than wedging
    expect(started).toEqual([0, 1, 2, 3]);
  });
});
