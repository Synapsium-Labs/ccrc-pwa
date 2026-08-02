// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The next move after g1/g2 fail to build: stop fighting the object literal and
// widen the key union instead. `ExecCommand` is closed, so `'gh'` is not one —
// and widening `EXEC_COMMANDS` itself to make this line compile trips the
// SEPARATE disjointness proof in `whitelist.ts` (`GRANTABLE_COMMANDS` becomes
// `readonly never[]`, TS2322 — measured). This fixture pins the first half of
// that pair; the `ok/` project's `Equals<ExecCommand, 'tmux' | 'ccd'>`
// assertion pins the second.
import type { ExecCommand } from '../../../src/whitelist.js';

export const cmd: ExecCommand = 'gh';
