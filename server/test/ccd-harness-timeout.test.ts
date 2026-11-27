// One guard, one file: the ccd harness must not let a wedged child kill the
// run.
//
// `makeCcdHarness(...).sh` is `execFileSync`, which blocks the WORKER THREAD.
// Vitest's `testTimeout` runs on the event loop that call is holding, so it can
// never fire — a `bash` that does not return does not fail a test, it stops the
// file, and (under a reporter that prints at the end) the run reports nothing
// at all. Measured on Windows twice, at 222 of 225 files, with four
// `bash -c "source ccd; …"` processes alive and the log frozen.
//
// This is the mutation table entry for that guard: delete the `timeout` option
// in `ccdWsHelpers.ts` and this file hangs for two minutes and then fails,
// instead of passing in two seconds.
import { describe, it, expect } from 'vitest';
import { makeCcdHarness } from './ccdWsHelpers.js';

describe('the ccd harness fails a wedged snippet instead of wedging the run', () => {
  it('kills a `bash` that never returns, and throws where the test can see it', () => {
    const h = makeCcdHarness('ccrc-harness-timeout-');
    const started = Date.now();

    // 2s rather than the 120s default: the guard is what is under test, not the
    // number. `sleep 30` is the stand-in for the real thing — a ccd verb whose
    // child is blocked on a lock, a pane, or a read that will never arrive.
    expect(() => h.sh('sleep 30', { CCRC_TEST_SH_TIMEOUT_MS: '2000' }))
      .toThrow();

    // The point is not merely that it threw — an assertion could throw for any
    // reason — but that it threw PROMPTLY. Without the option the call runs the
    // full 30s.
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
