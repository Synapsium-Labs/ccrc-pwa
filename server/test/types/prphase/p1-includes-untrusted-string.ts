// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The shape `registry.ts:80` used to be written in, minus the casts that made
// it compile: `PR_PHASES.includes(rawFromDisk)`. `PR_PHASES` is typed
// `readonly PrPhase[]` deliberately, so `.includes` demands a `PrPhase` and
// this is TS2345. That refusal is the whole reason the codebase's rule reads
// "cast the CONSTANT, never the input" — and the reason `isPrPhase` exists,
// since the only ways to satisfy the compiler otherwise are the two casts the
// review found, or widening the constant and losing the check entirely.
import { PR_PHASES } from '../../../../shared/api.js';

declare const rawFromDisk: string;
export const known: boolean = PR_PHASES.includes(rawFromDisk);
