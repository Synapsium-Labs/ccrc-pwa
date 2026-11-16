// Delegation broker wave 4, PR2 Task 2.3 (W4-U0): today's fleet tree, characterised before delegation rows. Each of
// `nestFleet.test.ts`, `fleetTree.test.ts` and `rollup.test.ts` records every call its cases already make (the inputs,
// and the output's `JSON.stringify`), and its last case pins one fingerprint per call: the first 16 hex digits of the
// SHA-256 of that string, captured on `main`'s code as an inline snapshot. A later task only adds the third argument
// and replays the recorded inputs with it set to `null` (W4-U11, U19, U23); it never changes a captured fingerprint.
import { createHash } from 'node:crypto';

export interface Recorded<A extends unknown[]> { readonly args: A; readonly json: string }

/** Wrap `fn` so each call records its arguments and its output's JSON into `into`, in call order. */
export function recording<A extends unknown[], R>(fn: (...args: A) => R, into: Recorded<A>[]): (...args: A) => R {
  return (...args: A): R => {
    const out = fn(...args);
    into.push({ args, json: JSON.stringify(out) });
    return out;
  };
}

/** The pinned fingerprint of one output's JSON. */
export const fingerprint = (json: string): string => createHash('sha256').update(json).digest('hex').slice(0, 16);
