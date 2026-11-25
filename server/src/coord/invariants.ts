// The invariant monitor's deciders (Overlord spec §10.4 "One invariant monitor", §11.7, Table 11.7a, H33; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Tasks 4 to 6). Ring L1, context C5: pure, no clock,
// no database, no file.
import type { SequenceWireLine } from '../../../shared/overlord-sequence.js';

/** One line of the one sequence, as the monitor reads it: the wire line (D-8214, moved from the simulator, which re-exports it). */
export type SequenceLine = SequenceWireLine;

/** A simulator invariant's first violation (moved from `server/test/sim/sequence.ts`, D-8214). */
export interface Violation { readonly invariant: string; readonly seq: number; readonly message: string }
