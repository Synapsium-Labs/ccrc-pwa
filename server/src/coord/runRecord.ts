// D-8071 (spec 2026-11-04 §11.5): `GET /api/runs/:id/record`'s trail, one pure function. L1 decision: a run's stored
// `run_events` rows in, the wire's trail out. No clock, no I/O, no db. Stall observations (`parseStallDetail` reads them)
// fold into ONE row per unbroken span with its count and end; the newest `RUN_RECORD_EVENTS_MAX` rows are kept and
// `olderEvents` counts the rest. `detail` goes through the existing redaction profile (`redactCommand`).
import type { RunRecordEvent } from '../../../shared/api.js';
import { redactCommand } from './redact.js';
import { parseStallDetail } from './stall.js';

/** The most trail rows one answer carries. */
export const RUN_RECORD_EVENTS_MAX = 200;

/** One stored `run_events` row, oldest first by id. */
export interface RunEventRow {
  readonly at: number;
  readonly fromState: string;
  readonly toState: string;
  readonly causedBy: string;
  readonly detail: string | null;
}

/** `by`: the three words the table stores for a close and every other writer, else a session id, which reads 'session'. */
const byOf = (causedBy: string): RunRecordEvent['by'] =>
  causedBy === 'coordinator' || causedBy === 'operator' || causedBy === 'sweep' ? causedBy : 'session';

export interface RunRecordTrail {
  /** Newest first. */
  readonly events: RunRecordEvent[];
  /** Rows folded, then counted, beyond `RUN_RECORD_EVENTS_MAX`. */
  readonly olderEvents: number;
}

/** PURE. `rows` are in id order (oldest first); the answer is newest first. */
export function runRecordTrail(rows: readonly RunEventRow[]): RunRecordTrail {
  const folded: RunRecordEvent[] = [];
  for (const row of rows) {
    const event: RunRecordEvent = {
      at: row.at, from: row.fromState, to: row.toState, by: byOf(row.causedBy),
      detail: row.detail === null ? null : redactCommand(row.detail),
    };
    const prev = folded[folded.length - 1];
    if (parseStallDetail(row.detail) !== null && prev !== undefined && prev.folded !== undefined) {
      // Same unbroken span: the open fold takes one more observation and its end moves.
      prev.folded = { count: prev.folded.count + 1, untilAt: row.at };
      continue;
    }
    if (parseStallDetail(row.detail) !== null) event.folded = { count: 1, untilAt: row.at };
    folded.push(event);
  }
  const newest = folded.reverse();
  return { events: newest.slice(0, RUN_RECORD_EVENTS_MAX), olderEvents: Math.max(0, newest.length - RUN_RECORD_EVENTS_MAX) };
}
