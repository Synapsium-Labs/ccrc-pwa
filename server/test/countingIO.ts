import { localIO, type FleetIO } from '../src/io.js';

/** A `localIO` that counts every FleetIO call and its serial rounds: a round starts when a call is made while no
 *  other call is in flight, so a sequential chain of N awaits is N rounds and N concurrent calls are one. `calls`
 *  keys each call by method name. A method runs with the base as `this`, so a convenience read that derives from its
 *  measured sibling counts once, as the one request it is. */
export interface CountingIO { io: FleetIO; total: () => number; rounds: () => number; calls: () => Record<string, number>; reset: () => void }

export function countingIO(base: FleetIO = localIO): CountingIO {
  let inFlight = 0;
  let rounds = 0;
  let calls: Record<string, number> = {};
  const io = new Proxy(base, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        if (inFlight === 0) rounds += 1;
        inFlight += 1;
        const out = (v as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) return out.finally(() => { inFlight -= 1; });
        inFlight -= 1;
        return out;
      };
    },
  });
  return {
    io,
    total: () => Object.values(calls).reduce((a, b) => a + b, 0),
    rounds: () => rounds,
    calls: () => ({ ...calls }),
    reset: () => { rounds = 0; calls = {}; },
  };
}
