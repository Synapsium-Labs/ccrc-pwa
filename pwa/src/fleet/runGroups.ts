// U6's model (D-5587): the run board's runs grouped by what they need, in the
// order the board reads them — Needs you, then Running by programme, then
// Finished. Pure: the board (P5) and Instrument's runs split (P9) both render
// this one answer, so the two skins cannot group the runs two ways.
//
// THE STATE MAP (Step 0, measured on the base this module landed on):
//
//   state            isRunClosed  RUN_ORDER rank  group
//   awaiting-review  no           0 (first)       needs    — the one state that
//                                                            waits on the operator
//   failed           yes          1               finished — closed, so never in
//                                                            the board's `active`
//   working          no           2               running
//   dispatched       no           3               running
//   merging          no           4               running
//   closing          no           5               running
//   planned          no           6               running
//   done             yes          7               finished
//   unknown          no           8 (last)        running  — we-do-not-know is
//                                                            not a call to act
//
// `RUN_WORD` names `awaiting-review` "awaiting review", the only open state
// whose word asks someone for something; the fleet's attention buckets read
// session state, never `RunState`, so nothing else files a run as the
// operator's. `failed` stays in Finished, where the board shows it today, with
// its own word and glyph: drawing it from Finished would file every failed run
// ever recorded under Needs you.
//
// The record carries a third value, `finished`, beside the plan's two
// (D-5650): a `Record<RunState, …>` is total, so `done` and `failed` need an
// honest answer, and `finished` is the one `isRunClosed` already gives them.
// `run-groups.test.ts` holds the record and `isRunClosed` to the same line.
import type { RunState, RunSummary } from '../../../shared/api';
import { programWave, runState, runsByProgram } from './runWords';

export type RunGroup = 'needs' | 'running' | 'finished';

/** Which group each state files under. A `Record` over `RunState`, so a state
 *  added to the wire type is a compile error here, never a silently missing
 *  row (D-5587). */
export const RUN_GROUP: Readonly<Record<RunState, RunGroup>> = Object.freeze({
  'awaiting-review': 'needs',
  planned: 'running',
  dispatched: 'running',
  working: 'running',
  merging: 'running',
  closing: 'running',
  unknown: 'running',
  done: 'finished',
  failed: 'finished',
});

/** A Needs-you row: the run, and its programme's title so the row can say
 *  whose it is outside its programme's group. */
export interface NeedsRow {
  readonly run: RunSummary;
  readonly title: string;
}

/** One programme's open runs that do not wait on the operator. */
export interface ProgramGroup {
  readonly program: string;
  readonly title: string;
  readonly wave: number;
  readonly waveOf: number | null;
  readonly runs: readonly RunSummary[];
}

export interface RunGroups {
  readonly needs: readonly NeedsRow[];
  readonly running: readonly ProgramGroup[];
  readonly finished: readonly RunSummary[];
}

/** A programme's title: the first non-empty `programTitle` any of its runs
 *  carries, else the slug. */
function titlesOf(runs: readonly RunSummary[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const run of runs) {
    if (!titles.has(run.program) && typeof run.programTitle === 'string' && run.programTitle.trim() !== '') {
      titles.set(run.program, run.programTitle);
    }
  }
  return titles;
}

/** The board's groups. `active` and `finished` are the board's own two lists
 *  (`RunsScreen.tsx`): `finished` keeps its order and its source (the cold
 *  read), so its honesty about a failed read stays the caller's. A run is
 *  listed once, by id, in the first group that claims it. */
export function groupRuns(active: readonly RunSummary[], finished: readonly RunSummary[]): RunGroups {
  const titles = titlesOf([...active, ...finished]);
  const titleOf = (program: string): string => titles.get(program) ?? program;
  const seen = new Set<number>();
  const once = (run: RunSummary): boolean => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  };

  const needs: NeedsRow[] = [];
  const running: ProgramGroup[] = [];
  const closedInActive: RunSummary[] = [];
  for (const { program, runs } of runsByProgram(active)) {
    // The programme's wave is over all its open runs, Needs-you ones included:
    // it is the programme's fact, read by `programWave` and never re-derived.
    const { wave, waveOf } = programWave(runs);
    const rest: RunSummary[] = [];
    for (const run of runs) {
      const group = RUN_GROUP[runState(run)];
      if (group === 'finished') closedInActive.push(run);
      else if (!once(run)) continue;
      else if (group === 'needs') needs.push({ run, title: titleOf(program) });
      else rest.push(run);
    }
    if (rest.length > 0) running.push({ program, title: titleOf(program), wave, waveOf, runs: rest });
  }

  // `active` is `!isRunClosed` on the board, so `closedInActive` is empty
  // there; a caller that leaks a closed run still gets it under Finished.
  const done = [...finished, ...closedInActive].filter(once);
  return { needs, running, finished: done };
}
