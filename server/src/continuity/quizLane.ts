// L4 delivery, context C3 (Session Conversation): the weekly replay quiz lane (Overlord spec §3.3.9 C52, Table 11.1c "The
// renewal lane, the weekly replay quiz"; W1a, the replay quiz piece, plan `w1a-replay-quiz.md` Task 4; W0-28 ruled B). Its
// rule is L1 (`quiz.ts#quizLaneVerdict`); this file reads the facts through its port, asks the rule and raises.
//
// THE LANE REMINDS, IT NEVER RUNS (slug quiz-lane-reminds-not-runs). History's quiz driver refuses inside a pane; ccrc's own
// weekly timer runs it (`deploy/history-quiz-unattended.mjs`, run 3212), never this lane, so the lane's one effect is one
// operator item a week, raised only once the unattended run's grace has passed with no confirmed run, through the
// ledger's existing server raise (`raiseItem`, actor `ccrc`). It runs no process, reads no history file, writes no marker
// and records no run: `continuity-quiz-lane.test.ts` pins its imports. While the record path is absent
// (`QUIZ_RECORD_READY`, ask 434) it raises nothing.
import type { RaiseItemInput } from '../coord/ledgersStore.js';
import type { LaneArmBaseline } from '../coord/laneArm.js';
import { QUIZ_ITEM_PROGRAMME, quizItemText, quizLaneVerdict, quizWeek, type QuizLaneHold, type QuizRead } from './quiz.js';

/** What the lane reads and writes, declared here by its consumer (built by `quizStore.ts#quizLanePortOf`). Each read
 *  answers its failure rather than throwing; `raise` throws on a write that failed, and the lane's row catches it. */
export interface QuizLanePort {
  readonly recordReady: boolean;
  /** When each confirmed run was recorded (wall ms). */
  recordedAts(): QuizRead<readonly number[]>;
  /** Whether any recorded run waits for the operator's ruling. */
  pendingWaits(): QuizRead<boolean>;
  baseline(): LaneArmBaseline;
  /** Whether an item with any of these titles was ever raised on the quiz's programme by `ccrc`, in any state. */
  itemRaised(titles: readonly string[]): QuizRead<boolean>;
  raise(input: RaiseItemInput, now: number): number;
}

export type QuizLaneResult = { readonly kind: 'hold'; readonly why: QuizLaneHold } | { readonly kind: 'raised'; readonly id: number; readonly title: string };

/** One pass: read, decide, raise at most one item. A hold because a read failed is logged once, naming each read that failed
 *  (review 2121 F2), as the sibling lanes log theirs; no other hold logs. */
export function runQuizLane(port: QuizLanePort, now: number, log: (line: string) => void): QuizLaneResult {
  const week = quizWeek(now);
  const recordedAts = port.recordedAts();
  const pendingWaits = port.pendingWaits();
  const baseline = port.baseline();
  const itemRaised = port.itemRaised([quizItemText(week.key, false).title, quizItemText(week.key, true).title]);
  const verdict = quizLaneVerdict({ recordReady: port.recordReady, now, week, recordedAts, pendingWaits, baseline, itemRaised });
  if (verdict.kind === 'hold') {
    if (verdict.why === 'unmeasured') {
      const failed = ([['recorded runs', recordedAts], ['pending runs', pendingWaits], ['baseline', baseline], ['raised items', itemRaised]] as const)
        .flatMap(([what, r]) => (r.ok ? [] : [`${what}: ${r.detail}`]));
      log(`ccrc-server: the quiz lane raised nothing: a read failed (${failed.join('; ')})`);
    }
    return verdict;
  }
  const { title, why, how } = verdict.item;
  const id = port.raise({
    program: QUIZ_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do', title, why, how: [...how], options: null,
    // `soon` with no label: nothing pushes, at raise or later (A20); never blocking, since no work stops on one week's run.
    neededBy: 'soon', soonLabel: null, secretSlot: null,
  }, now);
  return { kind: 'raised', id, title };
}
