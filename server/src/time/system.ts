// L3 adapters: the clock kernel's system time and chance (Overlord spec §11.5). Context K. The composition root
// (`index.ts`) is the one caller, and it builds these once, handed on as `Deps.time`; a test drives
// `server/test/fakeTime.ts` instead, held to the same contract (`time-ports-contract.test.ts`). Each timer handle is
// a local of one `after` call, so this is a deadline inside one adapter call, never a scheduler (the ring rule).
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Cancel, Clock, Entropy, Scheduler, TimePorts } from './ports.js';
import { checkDelayMs, checkEntropyBound, checkEntropyBytes } from './rules.js';

/** wall: Date.now(); mono: performance.now(), on the GLOBAL `performance`, read at each call. Never import it from
 *  node:perf_hooks: vitest's fake timers replace the global object, so an imported binding would stay real. */
export const systemClock: Clock = {
  wall: () => Date.now(),
  mono: () => globalThis.performance.now(),
};

/** hex: randomBytes(checkEntropyBytes(n)).toString('hex'); uuid: randomUUID(); below: randomInt(checkEntropyBound(n)).
 *  All from node:crypto. */
export const systemEntropy: Entropy = {
  hex: (n) => randomBytes(checkEntropyBytes(n)).toString('hex'),
  uuid: () => randomUUID(),
  below: (n) => randomInt(checkEntropyBound(n)),
};

function failureLine(err: unknown): string {
  return `ccrc-server: a scheduled call failed: ${err instanceof Error ? err.message : String(err)}`;
}

/** after: checkDelayMs, then a local setTimeout whose callback catches a throw and a rejection into `warn`, unref'd, and
 *  a Cancel that calls clearTimeout. */
export function systemScheduler(warn: (message: string) => void): Scheduler {
  return {
    after(ms: number, fn: () => unknown): Cancel {
      const delay = checkDelayMs(ms);
      const handle = setTimeout(() => {
        try {
          const out = fn();
          if (out instanceof Promise) out.catch((err: unknown) => { warn(failureLine(err)); });
        } catch (err) {
          warn(failureLine(err));
        }
      }, delay);
      handle.unref();
      return () => { clearTimeout(handle); };
    },
  };
}

/** The three. `warn` defaults to console.warn: the server runs with Fastify's logger off. */
export function systemTimePorts(warn: (message: string) => void = (m) => console.warn(m)): TimePorts {
  return { clock: systemClock, scheduler: systemScheduler(warn), entropy: systemEntropy };
}
