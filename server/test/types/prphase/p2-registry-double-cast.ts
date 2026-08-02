// BYPASS FIXTURE — MUST NOT COMPILE.
//
// VERIFY ROUND 2, P3 — the reported defect verbatim, as `registry.ts:85` used
// to read it:
//
//     PR_PHASES.includes(prPhaseRaw as PrPhase) ? (prPhaseRaw as PrPhase) : null
//
// The verifier put exactly this line back and measured `tsc -p server` clean,
// the server suite 1005/1005 and typecheck-tests 7/7 — the fix for integration
// finding 3 had no pin against its own reversal. p1 next door only pinned that
// `PR_PHASES` was cast-HOSTILE, which this expression satisfies by casting.
//
// It is now unwritable outside `shared/api.ts` because the constant is not
// exported. Note what is NOT claimed: the casts themselves are still legal
// TypeScript (measured — a branded `UntrustedField` does not refuse
// `raw as PrPhase`, because the comparable relation allows an intersection to
// be asserted to a constituent's subtype). What is closed is reaching the list.
import { PR_PHASES, type PrPhase } from '../../../../shared/api.js';

declare const prPhaseRaw: string | null;
export const phase: PrPhase | null =
  PR_PHASES.includes(prPhaseRaw as PrPhase) ? (prPhaseRaw as PrPhase) : null;
