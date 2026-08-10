// The run board's status vocabulary. Its OWN small table, deliberately not
// SessionBucket's (spec §6): a run state is a lifecycle position, not an
// attention state, and reusing the bucket words would put attention-amber on a
// row nobody is waiting on — against DIRECTION.md's rule that a hue means the
// same thing everywhere.
//
// Two cues per row, always: the word is the fact and the glyph is the shape, so
// no state has to be read out of colour (StatusDot.tsx's own discipline).
import { isRunState, type RunItemTally, type RunState, type RunSummary } from '../../../shared/api';

export const RUN_WORD: Record<RunState, string> = {
  planned: 'planned',
  dispatched: 'dispatched',
  working: 'working',
  'awaiting-review': 'awaiting review',
  merging: 'merging',
  closing: 'closing',
  done: 'done',
  failed: 'failed',
  /** The designated we-do-not-know member. A state this build has never heard
   *  of renders as an honest "unknown", never as a blank cell and never as
   *  whichever neighbouring word happened to be the default. */
  unknown: 'unknown',
};

export const RUN_GLYPH: Record<RunState, string> = {
  planned: '·', dispatched: '❯', working: '■', 'awaiting-review': '?',
  merging: '⑂', closing: '↩', done: '✓', failed: '✕', unknown: '·',
};

/** The total door into `RUN_WORD`/`RUN_GLYPH`. `run.state` is typed
 *  `RunState`, but nothing between the wire and this renderer actually
 *  proves it — the live `{type:'runs'}` frame is shape-checked only at the
 *  ARRAY level (`asFleetMsg`) and `api.runs()` is a bare `getJson` cast, so a
 *  state a newer build minted and this one has never heard of reaches here
 *  as a raw string wearing the `RunState` type. Indexing `RUN_WORD`/
 *  `RUN_GLYPH` with that string directly reads as `undefined` under
 *  `noUncheckedIndexedAccess` and JSX silently renders NOTHING for
 *  `undefined` — an empty cell, not a build error and not a crash (fix round
 *  1, task 5, finding 2). Route every lookup through this first. */
export const runState = (run: { state: RunState }): RunState =>
  isRunState(run.state) ? run.state : 'unknown';

/** Tolerant read of `RunSummary.items`, same idiom as `unmeasuredFields`
 *  (`shared/api.ts`) for the identical reason: the parameter type says
 *  optional even though `RunSummary.items` itself is not, because a row that
 *  reached this renderer through an unvalidated boundary can omit a required
 *  key at runtime even though the type promises otherwise. Reading
 *  `run.items.done` directly is a hard `TypeError` that takes the whole
 *  board down, not one cell (fix round 1, task 5, finding 2). */
export const runItems = (run: { items?: RunItemTally }): RunItemTally =>
  run.items ?? { done: 0, total: 0 };

/** Tolerant read of `RunSummary.closedAt`. `undefined` degrades to `null`
 *  (never-finished, i.e. active) rather than surviving as a value that is
 *  simultaneously `!== null` (so the row lands in `finished`) and `!== null`
 *  again the OTHER direction it is tested (so it is also excluded from
 *  `active`) — a live, working run silently filed in the archive group (fix
 *  round 1, task 5, finding 2). `null` is already the honest "still open"
 *  answer, so this only ever changes an impossible `undefined`. */
export const runClosedAt = (run: { closedAt?: number | null }): number | null =>
  run.closedAt ?? null;

/** Board order: the ones that can move first, the ones that are over last.
 *  One constant, shared by the grouping and the sort, so the two cannot drift —
 *  the same shape `sortFleet.ts`'s RANK/BUCKET_ORDER pair has. */
export const RUN_ORDER: readonly RunState[] = [
  'awaiting-review', 'failed', 'working', 'dispatched', 'merging', 'closing', 'planned', 'done', 'unknown',
];

const rank = (s: RunState): number => {
  const i = RUN_ORDER.indexOf(s);
  return i === -1 ? RUN_ORDER.length : i;
};

/** Runs grouped by program slug, each ROW ordered by urgency first (most
 *  urgent member of a group leads it) — the same rule `groupFleet` follows,
 *  and for the same reason: a fold must never bury the row that can move.
 *  `wave` is only a TIEBREAK between rows already at the same urgency rank,
 *  never the primary key — so this is deliberately NOT "newest wave first"
 *  within a group (corrected: the previous wording claimed it was, which is
 *  false the moment a group holds rows in different states, e.g. a wave-1
 *  row still `awaiting-review` alongside a dispatched wave-2 row —
 *  `coord/store.ts`'s `programOpenRunCount` gate exists precisely because a
 *  program's waves are not disjoint). `list[0]` is therefore never a safe
 *  stand-in for "the program's current wave" — use `programWave` below for
 *  that (fix round 1, task 5, finding 4). */
export function runsByProgram(runs: readonly RunSummary[]): { program: string; runs: RunSummary[] }[] {
  const by = new Map<string, RunSummary[]>();
  for (const run of [...runs].sort((a, b) => rank(a.state) - rank(b.state) || b.wave - a.wave)) {
    const list = by.get(run.program);
    if (list) list.push(run);
    else by.set(run.program, [run]);
  }
  return [...by].map(([program, list]) => ({ program, runs: list }));
}

/** The program-level fact a group header states: the FURTHEST wave any of
 *  this program's listed runs has reached, never an arbitrary row's own
 *  `wave` — `runsByProgram`'s own order is urgency-first (see above), so
 *  `list[0]` can be an OLDER wave sitting in `awaiting-review` while a newer
 *  wave is already dispatched underneath it. Measured (fix round 1, task 5,
 *  finding 4): a program at wave 2 `working` plus wave 1 `awaiting-review`
 *  rendered "wave 1/4" — an older wave than the program had actually
 *  reached — because the header read `list[0].wave` directly. Ties (more
 *  than one run at the max wave) all carry the same `waveOf` by
 *  construction — one ledger, one `M` — so which one wins a tie is
 *  immaterial. An empty list has no wave to state; callers never pass one
 *  (`runsByProgram` never emits an empty group), but `0`/`null` is the
 *  honest answer rather than a thrown `!`. */
export function programWave(list: readonly RunSummary[]): { wave: number; waveOf: number | null } {
  let best = list[0];
  if (best === undefined) return { wave: 0, waveOf: null };
  for (const run of list) if (run.wave > best.wave) best = run;
  return { wave: best.wave, waveOf: best.waveOf };
}
