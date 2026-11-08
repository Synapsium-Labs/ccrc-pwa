// D-8071 (spec 2026-11-04 §7, "Cadence and where the answer lives", A45, A55, A57): THE ONE IN-MEMORY READER of the stuck
// verdict. L1: no I/O, no clock. The registry pass (`runStuckPass.ts`) is its one writer, through `replace`; the runs frame,
// its cold start, `GET /api/runs`, `GET /api/runs/:id` and the abandon arm only read it.
//
// A verdict can lag by one pass. Before the first pass, and after a restart, the reader is empty: a run reads as no entry,
// `stuck` is absent and an abandon records no reason. An empty reader never moves an age, because `stuckSince` reads stored
// times (A63).
//
// `closes` is a map of its own (A57): the run-close lane writes it whole, on each of its passes, and `replace` never touches
// it, so the two clocks never fight. `of` joins the two as it reads, and a run missing from the map reads `closes: null`.
import type { RunStuck, RunWaitsOn } from '../../../shared/api.js';

/** One open run's answers from the pass. `waitsOn` is absent when the table gives none (`unknown`, `done`, `failed`). */
export interface RunVerdict {
  readonly stuck: RunStuck | null;
  readonly waitsOn?: RunWaitsOn;
  readonly blockedBy: number | null;
  readonly coordinatorGone: boolean;
}

export interface RunVerdicts {
  /** Swap the whole answer: each open run's verdict, and `coordinatorGone` for each programme with no open run. */
  replace(answers: ReadonlyMap<number, RunVerdict>, programmes: ReadonlyMap<string, boolean>): void;
  /** Swap the run-close lane's clocks, whole. Has no caller until the run-close lane lands. */
  setCloses(closes: ReadonlyMap<number, NonNullable<RunStuck['closes']>>): void;
  of(id: number): RunVerdict | null;
  ofProgramme(slug: string): boolean | null;
  all(): ReadonlyMap<number, RunVerdict>;
}

export function createRunVerdicts(): RunVerdicts {
  let answers: ReadonlyMap<number, RunVerdict> = new Map();
  let programmes: ReadonlyMap<string, boolean> = new Map();
  let closes: ReadonlyMap<number, NonNullable<RunStuck['closes']>> = new Map();
  const joined = (id: number, v: RunVerdict): RunVerdict =>
    v.stuck === null ? v : { ...v, stuck: { ...v.stuck, closes: closes.get(id) ?? null } };
  return {
    replace(a, p) { answers = new Map(a); programmes = new Map(p); },
    setCloses(c) { closes = new Map(c); },
    of(id) { const v = answers.get(id); return v === undefined ? null : joined(id, v); },
    ofProgramme(slug) { return programmes.get(slug) ?? null; },
    all() { return new Map([...answers].map(([id, v]) => [id, joined(id, v)] as const)); },
  };
}
