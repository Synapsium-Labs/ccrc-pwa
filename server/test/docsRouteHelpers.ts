// Test helpers for the native Docs reader's L4 (design 2026-10-01, section 6.3, section 6.4; W3). Task 4 adds the
// blocking exec double the lane, fetch-lane and single-flight cases drive; Task 6 adds the scripted `CcdRunner`
// over W2's real adapter and `docsApp()`; Task 10 adds `echoPty()` and `passThroughLane()`.

/**
 * A blocking exec double (section 6.10's "blocking doubles", M6.2): every call of `exec` is one started exec, held
 * open until the test settles it by its start index. `started()` counts the calls, so "zero extra execs" is a
 * count that did not move.
 */
export function blocker<T>(): {
  exec: () => Promise<T>;
  started(): number;
  release(i: number, v: T): void;
  fail(i: number, e: Error): void;
} {
  const held: { resolve: (v: T) => void; reject: (e: Error) => void }[] = [];
  return {
    exec: () => new Promise<T>((resolve, reject) => {
      held.push({ resolve, reject });
    }),
    started: () => held.length,
    release: (i, v) => held[i].resolve(v),
    fail: (i, e) => held[i].reject(e),
  };
}
