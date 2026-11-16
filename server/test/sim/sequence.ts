// The simulator's one sequence (Overlord spec §10.4, §11.7): what happened, in order, as ids, kinds, states and actors
// only, never a body, so a trace names no text. An invariant is a predicate over the whole sequence.
import type { Clock } from '../../src/time/ports.js';

export interface SequenceLine {
  readonly seq: number; readonly at: number; readonly kind: string; readonly id: string; readonly state: string;
  readonly actor: string;
}
export type LineInput = Omit<SequenceLine, 'seq' | 'at'>;

export class SimSequence {
  private readonly all: SequenceLine[] = [];
  constructor(private readonly clock: Clock) {}
  /** Numbers the line from 1 and stamps it with the clock's wall time. */
  append(line: LineInput): SequenceLine {
    const full: SequenceLine = { ...line, seq: this.all.length + 1, at: this.clock.wall() };
    this.all.push(full);
    return full;
  }
  lines(): readonly SequenceLine[] { return this.all; }
}

export interface Violation { readonly invariant: string; readonly seq: number; readonly message: string }

/** A predicate over the whole sequence; the first violation, or null. */
export interface Invariant {
  readonly name: string; readonly says: string; check(lines: readonly SequenceLine[]): Violation | null;
}
