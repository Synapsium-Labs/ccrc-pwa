// The adapter of the sequence plan's question 10 (D-8214: "the simulator's predicate runs unchanged in the W1 monitor"): a row of
// the production invariant table, run through the production decider (`invariants.ts#invariantVerdict`) over a scenario's own
// facts, as a simulator `Invariant`. In a simulation every input is the scenario's own database, so anything but `holds` is a
// violation: a finding, and equally an unmeasured or not-applicable answer, which would mean the scenario did not exercise it.
import { INVARIANT_MAP, invariantVerdict, type InvariantInput, type InvariantName } from '../../src/coord/invariants.js';
import type { Invariant } from './sequence.js';

export function liveInvariant(name: InvariantName, readInput: () => InvariantInput): Invariant {
  return {
    name, says: INVARIANT_MAP[name].says,
    check(lines) {
      const v = invariantVerdict(name, readInput());
      if (v.kind === 'holds') return null;
      const last = lines.at(-1)?.seq ?? 0;
      if (v.kind === 'violated') {
        return { invariant: name, seq: v.findings[0]!.seq ?? last, message: v.findings.map((f) => `${f.subject}: ${f.message}`).join('; ') };
      }
      return { invariant: name, seq: last, message: `${v.kind} in a simulation, where every input is the scenario's own` };
    },
  };
}
