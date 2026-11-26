// The simulator's one sequence (Overlord spec §10.4, §11.7): what happened, in order, as ids, kinds, states and actors
// only, never a body, so a trace names no text. An invariant is a predicate over the whole sequence.
//
// `SequenceLine` and `Violation` live in production (`server/src/coord/invariants.ts`, D-8214): this file re-exports them, so a
// scenario's imports are unchanged. `Invariant` and `SimSequence` stay here: no production code uses them.
import type { Clock } from '../../src/time/ports.js';
import type { SequenceLine, Violation } from '../../src/coord/invariants.js';

export type { SequenceLine, Violation };
/** A scenario's line: the moved line's fields less those the simulator fills (a scenario line is the server's own, and known). */
export type LineInput = Omit<SequenceLine, 'seq' | 'at' | 'actorKind' | 'known'>;

export class SimSequence {
  private readonly all: SequenceLine[] = [];
  constructor(private readonly clock: Clock) {}
  /** Numbers the line from 1 and stamps it with the clock's wall time; a lane's line, so `server` and known. */
  append(line: LineInput): SequenceLine {
    const full: SequenceLine = { ...line, actorKind: 'server', known: true, seq: this.all.length + 1, at: this.clock.wall() };
    this.all.push(full);
    return full;
  }
  lines(): readonly SequenceLine[] { return this.all; }
}

/** A predicate over the whole sequence; the first violation, or null. */
export interface Invariant {
  readonly name: string; readonly says: string; check(lines: readonly SequenceLine[]): Violation | null;
}
