// D-6034 (ARCH-10, #543, step 1): the runner fakes for the `ran` arm, so step 2's churn is mechanical. A fake `Runner`
// returns one of these instead of a bare `{ code, stdout, stderr }` literal:
//   - `ranOk(stdout)`: the command ran and exited 0;
//   - `ranExit(code, stdout, stderr)`: the command ran and exited `code` (a refusal, a die, a document at exit 1);
//   - `notRan(reason)`: the command never ran, or may not have, in the shape the runners produce it: the forged
//     `code: 1`, an empty stdout, the runner's words on stderr and as `detail`, and neither kill half (the transport
//     catch arm sends neither, `remote/runner.ts`).
// `ranOk` and `ranExit` carry `ran: true`, which step 2 makes required; today `ccd()` adds no key for it, so a result
// built from either reaches every reader exactly as the bare literal did.
import type { ExecResult, NotRanReason } from '../../src/exec.js';

/** The command ran and exited 0. */
export const ranOk = (stdout = '', stderr = ''): ExecResult => ({ ran: true, code: 0, stdout, stderr });

/** The command ran and exited `code`. */
export const ranExit = (code: number, stdout = '', stderr = ''): ExecResult => ({ ran: true, code, stdout, stderr });

/** The command never ran, or may not have: `reason`, and the runner's words (`detail`, also its stderr). */
export const notRan = (reason: NotRanReason, detail: string = reason === 'timeout' ? 'timeout' : 'disconnected'): ExecResult =>
  ({ code: 1, stdout: '', stderr: detail, ran: false, reason, detail });
