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
import type { RunCloseReading } from '../../../shared/run-close.js';

/** One open run's answers from the pass. `waitsOn` is absent when the table gives none (`unknown`, `done`, `failed`). */
export interface RunVerdict {
  readonly stuck: RunStuck | null;
  readonly waitsOn?: RunWaitsOn;
  readonly blockedBy: number | null;
  readonly coordinatorGone: boolean;
  /** The run-close lane row this verdict also fits (E3, E3s or E5; `closeRowOf`), absent for every other verdict. The lane reads it
   *  and no screen does (D-8078). */
  readonly closeRow?: 'claimant-gone' | 'claimant-stopped' | 'name-reused';
  /** A run whose name a later run holds (E5, or E3 and E3s with the same cause): the journal accounts for the old workspace's unpushed work (`RunStuckFacts.nameReusedClear`). */
  readonly nameReusedClear?: boolean;
}

export interface RunVerdicts {
  /** Swap the whole answer: each open run's verdict, and `coordinatorGone` for each programme with no open run. */
  replace(answers: ReadonlyMap<number, RunVerdict>, programmes: ReadonlyMap<string, boolean>): void;
  /** Swap the run-close lane's clocks, whole. Has no caller until the run-close lane lands. */
  setCloses(closes: ReadonlyMap<number, NonNullable<RunStuck['closes']>>): void;
  /** What the run-close lane read on its last pass, for the Advanced rows' would-close lists (Task 26); null before its first. */
  setReading(reading: RunCloseReading | null): void;
  /** The crash row's would-close list, written by the dead-coordinator lane (its own pass, its own clock); null clears it. `reading` joins it
   *  under `claimant-crashed`, and the run-close lane's `setReading` never touches it. */
  setCrashReading(group: NonNullable<RunCloseReading['groups']['claimant-crashed']> | null, at: number): void;
  reading(): RunCloseReading | null;
  of(id: number): RunVerdict | null;
  ofProgramme(slug: string): boolean | null;
  all(): ReadonlyMap<number, RunVerdict>;
}

export function createRunVerdicts(): RunVerdicts {
  let answers: ReadonlyMap<number, RunVerdict> = new Map();
  let programmes: ReadonlyMap<string, boolean> = new Map();
  let closes: ReadonlyMap<number, NonNullable<RunStuck['closes']>> = new Map();
  let reading: RunCloseReading | null = null;
  let crash: { at: number; group: NonNullable<RunCloseReading['groups']['claimant-crashed']> } | null = null;
  const joined = (id: number, v: RunVerdict): RunVerdict =>
    v.stuck === null ? v : { ...v, stuck: { ...v.stuck, closes: closes.get(id) ?? null } };
  return {
    replace(a, p) { answers = new Map(a); programmes = new Map(p); },
    setCloses(c) { closes = new Map(c); },
    setReading(r) { reading = r; },
    setCrashReading(group, at) { crash = group === null ? null : { at, group }; },
    reading() {
      if (crash === null) return reading;
      return { at: reading?.at ?? crash.at, groups: { ...reading?.groups, 'claimant-crashed': crash.group } };
    },
    of(id) { const v = answers.get(id); return v === undefined ? null : joined(id, v); },
    ofProgramme(slug) { return programmes.get(slug) ?? null; },
    all() { return new Map([...answers].map(([id, v]) => [id, joined(id, v)] as const)); },
  };
}
