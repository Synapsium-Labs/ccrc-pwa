// L1, context C3 (Session Conversation): the `operator-at-programme` mark (Overlord spec §3.3.9 C50, Table 11.1e row "The mark
// `operator-at-programme`", 30 minutes; W1a, the hand-offs piece, plan `w1a-renewal-handoffs.md` Task 3). Pure.
//
// The console's prompt route writes a programme's mark `at` when the operator types into any session of it (slug
// mark-for-any-session-of-the-programme): the programmes a session coordinates or serves, measured from its open runs
// (`markProgrammesOf`). The generations lane ages each mark by observed time in a row of its own (`quiet`, keyed on the `at` it
// read: ruling F5), so a server restart or a freeze never ages it by wall time (ruling R4, slug operator-mark-observed). A
// coordinator's `operatorQuietObservedMs` is its programmes' youngest mark (`operatorQuietOf`): a mark with no `quiet` for its
// `at` reads 0, a mark of `OPERATOR_MARK_MS` or more, and a programme with no mark, read as "no activity" (the break opens),
// and a read that failed is unmeasured.
import { OPERATOR_MARK_MS } from '../../../shared/continuity.js';
import type { Observed } from '../time/observed.js';
import type { SoftReading } from './softRenewal.js';

/** A session's open runs, as `bindingsOf(id).claimant()` and `.worker()` answer them. */
export type ProgrammeRunsRead = { readonly ok: true; readonly siblings: readonly { readonly program: string }[] } | { readonly ok: false };

/** The programmes a prompt into this session marks: those of the open runs it claims and those it works on, each once, in
 *  order. `unmeasured` when either read failed: the route then writes no mark (a partial list would mark one programme and
 *  miss another). */
export function markProgrammesOf(claimant: ProgrammeRunsRead, worker: ProgrammeRunsRead): readonly string[] | 'unmeasured' {
  if (!claimant.ok || !worker.ok) return 'unmeasured';
  return [...new Set([...claimant.siblings, ...worker.siblings].map((r) => r.program))];
}

/** One mark as the lane read it: its `at`, and the `quiet` kept for that `at` (null: none yet, which reads 0). */
export interface MarkReading { readonly programme: string; readonly quiet: Observed | null }

/** How long a mark has been quiet, observed: its `quiet.ms`, 0 while the lane has not advanced it since the prompt. */
export const markQuietMs = (m: MarkReading): number => m.quiet?.ms ?? 0;

/** A coordinator's `operatorQuietObservedMs`: the youngest of its programmes' marks, at most `OPERATOR_MARK_MS` (a mark that
 *  old, or no mark, is no activity), and `OPERATOR_MARK_MS` for a coordinator of no programme. `unmeasured` when its
 *  programmes or the marks could not be read. */
export function operatorQuietOf(programmes: readonly string[] | 'unmeasured', marks: readonly MarkReading[] | 'unmeasured'): SoftReading<number> {
  if (programmes === 'unmeasured') return { kind: 'unmeasured', why: 'operator-mark: the coordinator\'s programmes could not be read' };
  if (marks === 'unmeasured') return { kind: 'unmeasured', why: 'operator-mark: the marks could not be read' };
  let quiet = OPERATOR_MARK_MS;
  for (const p of programmes) {
    const m = marks.find((x) => x.programme === p);
    if (m !== undefined) quiet = Math.min(quiet, markQuietMs(m));
  }
  return { kind: 'measured', value: quiet };
}

/** Whether the lane still ages a mark: once it is `OPERATOR_MARK_MS` old it reads as no activity, so advancing it further
 *  changes no reading. */
export const markAges = (m: MarkReading): boolean => markQuietMs(m) < OPERATOR_MARK_MS;
