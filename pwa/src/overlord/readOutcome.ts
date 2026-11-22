// One read's next state, from what its call came back with (Overlord W1 home, Task 2; plan question 3, ruled F11): L1, pure.
// The store (`stores/overlord.ts`) hands every answer here and keeps what this answers, so the failure contract is decided
// once: an answer is `answered`, an older server's 404 is `absent`, and a failure is `stale` after an answer (the last value
// kept beside the failure) or `unmeasured` before one. Nothing unmeasured is folded into a value.
import type { ReadState } from './readState';

/** What one call came back with: a value, the read's own 404 (`absent`), or a failure with its words. */
export type ReadOutcome<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly error: string };

export function nextReadState<T>(prev: ReadState<T>, outcome: ReadOutcome<T>, at: number): ReadState<T> {
  if (outcome.kind === 'value') return { state: 'answered', value: outcome.value, at };
  if (outcome.kind === 'absent') return { state: 'absent' };
  if (prev.state === 'answered' || prev.state === 'stale') return { state: 'stale', value: prev.value, at: prev.at, error: outcome.error };
  return { state: 'unmeasured', error: outcome.error };
}
