// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The shape `registry.ts` used to be written in, minus the casts that made it
// compile: `PR_PHASES.includes(rawFromDisk)`.
//
// Until verify round 2 this failed with TS2345 — `PR_PHASES` was exported and
// typed `readonly PrPhase[]`, so `.includes` demanded a `PrPhase` and an
// untrusted string was refused. That pinned the TYPE as cast-hostile, but it
// did not stop anyone writing the two casts the review actually found; the
// verifier reverted `registry.ts` to exactly that expression and measured every
// gate green. `PR_PHASES` is now module-private, so the constant is not
// reachable from a call site at all and the whole shape is unwritable one step
// earlier — TS2724, "has no exported member named 'PR_PHASES'".
//
// The stronger error is the point: TS2345 said "cast it and I will let you
// through". TS2724 says there is nothing here to cast.
import { PR_PHASES } from '../../../../shared/api.js';

declare const rawFromDisk: string;
export const known: boolean = PR_PHASES.includes(rawFromDisk as never);
