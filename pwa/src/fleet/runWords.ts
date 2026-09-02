// The run board's status vocabulary. Its OWN small table, deliberately not
// SessionBucket's (spec §6): a run state is a lifecycle position, not an
// attention state, and reusing the bucket words would put attention-amber on a
// row nobody is waiting on — against DIRECTION.md's rule that a hue means the
// same thing everywhere.
//
// Two cues per row, always: the word is the fact and the glyph is the shape, so
// no state has to be read out of colour (StatusDot.tsx's own discipline).
import { KICKOFF_UNACKED_MS, MAIL_REPLAY_WARN_COUNT, SPAWN_STALL_MS, isRunState,
  type RunHealth, type RunItemTally, type RunState, type RunSummary } from '../../../shared/api';
import { formatAge } from './formatReset';

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

/** The tally's WORDS (spec §3.3, D-288 (was D-B4-15)). `total === 0` renders an em dash,
 *  never `0/0`: a wave that declared no ledger must not read as a wave that
 *  has done nothing. This is `summarize()`'s own rule — "drop zero-count
 *  clauses rather than print `0 X`" (`MailStrip.tsx:32-41`) — applied to the
 *  one place it was not, and it lives HERE rather than at the single call
 *  site because a rule stated at its only caller is a rule with no home: the
 *  next surface to render a tally would restate it or forget it.
 *
 *  `done` is deliberately NOT part of the condition: `0/7` is a declared
 *  ledger nothing has settled yet, which is a real and useful fact, and only
 *  a ledger that does not exist gets the dash. */
export const itemTallyLabel = (items: RunItemTally): string =>
  items.total === 0 ? '—' : `${items.done}/${items.total}`;

/** Tolerant read of `RunSummary.closedAt`. `undefined` degrades to `null`
 *  (never-finished, i.e. active) rather than surviving as a value that is
 *  simultaneously `!== null` (so the row lands in `finished`) and `!== null`
 *  again the OTHER direction it is tested (so it is also excluded from
 *  `active`) — a live, working run silently filed in the archive group (fix
 *  round 1, task 5, finding 2). `null` is already the honest "still open"
 *  answer, so this only ever changes an impossible `undefined`. */
export const runClosedAt = (run: { closedAt?: number | null }): number | null =>
  run.closedAt ?? null;

/** The active/finished SPLIT (fix, review findings 3/22): `state`, never
 *  `closedAt` — `CoordStore.runs()` itself (the live `{type:'runs'}` frame's
 *  own source, `watch.ts`'s `emitRuns`) draws the SAME line on `state NOT IN
 *  ('done','failed')`, so this is not a new definition, it is the existing
 *  one restated where the client can use it. `closedAt` is written by
 *  exactly one path (`advanceInner`, `store.ts`) and `CoordStore.reconstruct`
 *  — the disaster-recovery rebuild `server/test/reconstruction-drill.test.ts`
 *  pins as one of the twelve facts the drill CANNOT recover — never sets it,
 *  so a rebuilt program's `done`/`failed` waves carry `state:'done'`/
 *  `'failed'` with `closedAt:null` forever. Splitting on `closedAt` filed
 *  those rows in NEITHER group once the live frame excluded them by state
 *  (they vanished from the board entirely) or in BOTH depending on which
 *  slice happened to be read (a cold `active` fallback rendered a `done` row
 *  captioned "done" inside an ACTIVE program group). `closedAt` stays
 *  display-only — `formatAge`/the Finished sort below read it for "when",
 *  never for "whether". */
export const isRunClosed = (run: { state: RunState }): boolean => {
  const s = runState(run);
  return s === 'done' || s === 'failed';
};

/** The programs that still have an OPEN run, by slug — the PROGRAM-level half
 *  of the run board's resume door (D-1146, review MAJOR 2).
 *
 *  The row cannot answer this about itself, which is the whole finding: a
 *  terminal row is the ordinary end state while its program still has a wave
 *  that can move, and it is the ONLY thing left to hang a door on the moment
 *  the program has none. `closeRun` retires a program at zero open runs, so
 *  between closing wave N and opening wave N+1 — the close-then-open window
 *  ruling R1 already names as dangerous — every row of the program is terminal
 *  and a dead coordinator has nowhere on the board to be released from.
 *
 *  It re-filters with `isRunClosed` ITSELF rather than trusting the caller to
 *  pass an already-open list. The board does pass `active`, but a set whose
 *  openness was decided somewhere else is a SECOND definition of "open", one
 *  edit away from drifting off `state` and onto `closedAt` — `isRunClosed`'s
 *  own docstring above records what that cost the last time, and this is the
 *  same line `CoordStore.runs()` and `programOpenRunCount` draw server-side.
 *
 *  A Set, not a `.some()` per row: the Finished group is a flat list carrying
 *  every program's archive, so this question is asked once for every rendered
 *  row and a linear scan inside it would be quadratic in the board's own size.
 *
 *  An empty answer means "no program on this list has an open run" and NOT
 *  "nothing has been measured yet" — the caller owes that distinction, and
 *  `RunsScreen`'s own call site states why it holds there. */
export function programsWithOpenRun(
  runs: readonly { program: string; state: RunState }[],
): ReadonlySet<string> {
  const open = new Set<string>();
  for (const run of runs) if (!isRunClosed(run)) open.add(run.program);
  return open;
}

/** The dispatch window's three-way answer (Task 3, spawn visibility).
 *
 *  `planned` is OVERLOADED — it means both "opened, nobody has dispatched" and
 *  "a dispatch is in flight" — and until `dispatchStartedAt` shipped, nothing
 *  on the wire could tell the two apart. Inferring the difference here from
 *  circumstantial evidence (a `planned` run beside an unheld new workspace)
 *  would be an adapter narrowing a distinction it was never handed; reading
 *  the one fact that says so is not.
 *
 *  Three answers, because there are three conditions and a renderer must not
 *  be the place they are separated:
 *    • `none` — nothing to say about a spawn. Either no fresh-spawn dispatch
 *      has started (the field's own two conditions: nobody dispatched, or
 *      every dispatch was a wave N>=2 resume), or the run has already MOVED
 *      OFF `planned`, which is what ends the rendering. §Design: the stamp is
 *      a measurement and is never cleared, so a window keyed on the timestamp
 *      alone would leave every run in the fleet's history claiming forever to
 *      be spawning.
 *    • `in-flight` — a dispatch began, less than `SPAWN_STALL_MS` ago.
 *    • `stalled` — a dispatch began at least `SPAWN_STALL_MS` ago and the run
 *      is still `planned`. That is `dispatch.ts`'s own "a run stuck in
 *      `planned` beside an unexplained new workspace is a state no verb
 *      names", and it now has one.
 *
 *  `elapsedMs` rides ON the answer rather than being recomputed by the caller:
 *  a renderer that re-derives `now - startedAt` is a SECOND reader of the same
 *  nullable field, needing a `!` to do it, and that is precisely where a
 *  missing key becomes a `NaN` on screen.
 *
 *  Tolerant on `dispatchStartedAt` for the same measured reason `runItems` and
 *  `runClosedAt` are tolerant: neither the live `{type:'runs'}` frame nor
 *  `api.runs()` shape-validates a row, so a row minted by a build older than
 *  the column arrives with the key MISSING, and `undefined !== null` is true —
 *  a bare null-check would call that a dispatch in flight and render `NaN` as
 *  its clock. `Math.max(0, …)` for the mirror case: the stamp is the server's
 *  clock read against the phone's, and ordinary skew must read as "it just
 *  began", never as a negative duration. */
export type DispatchWindow =
  | { phase: 'none' }
  | { phase: 'in-flight'; elapsedMs: number }
  | { phase: 'stalled'; elapsedMs: number };

export function dispatchWindow(
  run: { state: RunState; dispatchStartedAt?: number | null },
  nowMs: number,
): DispatchWindow {
  if (runState(run) !== 'planned') return { phase: 'none' };
  const startedAt = run.dispatchStartedAt ?? null;
  if (startedAt === null) return { phase: 'none' };
  const elapsedMs = Math.max(0, nowMs - startedAt);
  return elapsedMs >= SPAWN_STALL_MS
    ? { phase: 'stalled', elapsedMs }
    : { phase: 'in-flight', elapsedMs };
}

/** The two phases that RENDER, as a glyph each — the board's standing
 *  two-cue rule (a word AND a glyph, so no state is read out of colour
 *  alone), single-sourced now that two surfaces draw the same window: the run
 *  board's own row (`RunsScreen`) and the fleet card's pending child
 *  (`ProjectCard`, Task 4). `Exclude<…,'none'>` rather than a hand-typed pair
 *  of keys, so a third phase joining `DispatchWindow` is a compile error here
 *  instead of a cell that silently renders nothing. */
export const DISPATCH_GLYPH: Record<Exclude<DispatchWindow['phase'], 'none'>, string> = {
  'in-flight': '⟳',
  stalled: '⚠',
};

/** Is THIS row inside a dispatch window at all — i.e. is there a spawn to
 *  narrate? Clock-free by construction: the `none`/not-`none` half of
 *  `dispatchWindow`'s answer turns on `state === 'planned'` and a non-null
 *  stamp and NOTHING else — only the `in-flight`/`stalled` split reads the
 *  clock — so every clock gives the same answer, and this one asks with the
 *  epoch.
 *
 *  Routed THROUGH `dispatchWindow` rather than re-testing its two conditions,
 *  so there stays exactly one place that decides what a dispatch window is: a
 *  hand-copied `state === 'planned' && stamp != null` here would be the second
 *  copy this repo forbids, and it would drift the day a third condition joined
 *  the first two. `nestFleet` (Task 4) asks it per run, to decide whether a
 *  programme has a pending CHILD; the board asks the plural form below to pick
 *  a tick rate. */
export function isDispatchPending(
  run: { state: RunState; dispatchStartedAt?: number | null },
): boolean {
  return dispatchWindow(run, 0).phase !== 'none';
}

/** Is ANY of these rows inside a dispatch window at all? The board asks this to
 *  pick its TICK RATE — and a hook must choose that BEFORE the tick it produces
 *  exists, so the question is not allowed to need one. It isn't:
 *  `isDispatchPending` above is clock-free, and this is its `some`. */
export function anyDispatchPending(
  runs: readonly { state: RunState; dispatchStartedAt?: number | null }[],
): boolean {
  return runs.some(isDispatchPending);
}

/** The run — if any — that this list says is being worked in that session
 *  (Task 5). One reader, so the fleet card's hold-reason door and anything that
 *  follows it ask the same question the same way.
 *
 *  THE ANSWER COMES FROM THE RUN ROWS, NEVER FROM THE HOLD STRING. The hold
 *  text on a session already spells `program:<slug> wave:N/M run:<id>` and it is
 *  tempting to read the id back out of it — `rundefs.ts`'s `holdReason` calls
 *  that out as DISPLAY-ONLY and `run-routes.test.ts` scans both `server/src` and
 *  `pwa/src` for a parser and fails the build on one — including one written in
 *  a COMMENT, which is why this note describes the regex instead of spelling it
 *  (measured on this branch: a helper that read the id out of the reason with a
 *  digit capture, dropped into `pwa/src`, reds that pin, and so did the first
 *  draft of this very docstring). The `runs` frame is the
 *  same `coord.db` the server itself answers from, so this is the cheaper source
 *  as well as the sanctioned one — and it is strictly more honest, because a
 *  hold left behind by a closed run parses to a run id the board cannot show,
 *  while this answers `null` for it.
 *
 *  Callers pass the ACTIVE runs they already hold, so `null` means "the board
 *  has no row for this session" — exactly the question a door needs answered,
 *  and not the same as "this session has never had a run". */
export function runForSession(
  runs: readonly RunSummary[], sessionId: string,
): RunSummary | null {
  return runs.find((r) => r.sessionId === sessionId) ?? null;
}

/** What the board says about a wave that RESUMED its session rather than
 *  spawning one (Task 5). Two shapes, never one, because they are two
 *  different facts about the same run:
 *    • `cleared: true`  — the resume happened and the `/clear` landed;
 *    • `cleared: false` — the resume happened and NOTHING proves the context
 *      was cleared, so this wave may be carrying the previous wave's context.
 *
 *  D-1 is the whole reason there is anything to say: no ccd verb can spawn
 *  fresh into an existing workspace, so wave N>=2 resumes the pane and the
 *  dispatch route injects `/clear` through the send path afterwards.
 *  `clearedAt` is the PROOF the second step ran — and a run where the first
 *  step succeeded and the second did not is precisely the row an operator
 *  needs to look at, so collapsing the pair into one word ("resumed") would
 *  render the interesting case and the ordinary one identically.
 *
 *  `run.wave >= 2` is deliberately NOT the condition. `resumed` is the fact the
 *  server WROTE at dispatch; the wave number is what caused it. Reading the
 *  cause instead of the record is a renderer re-deriving a decision it was
 *  handed — and it would be wrong for any future path that resumes a wave 1.
 *
 *  Tolerant on both fields, the same idiom `runItems`/`runClosedAt`/
 *  `dispatchWindow` already carry and for the same measured reason: nothing
 *  between the wire and this renderer validates a row's members, so a row from
 *  an older build arrives with the key MISSING and `undefined` must degrade to
 *  silence, never to half a sentence. */
export interface ResumeNote { word: string; cleared: boolean; title: string }

export function resumeNote(
  run: { wave: number; resumed?: boolean; clearedAt?: number | null },
  nowSec: number,
): ResumeNote | null {
  if (run.resumed !== true) return null;
  const clearedAt = run.clearedAt ?? null;
  return clearedAt === null
    ? {
        word: 'resumed, not cleared',
        cleared: false,
        title: `wave ${run.wave} resumed its session (D-1) and nothing recorded the /clear landing — `
          + 'this wave may be carrying the previous one’s context',
      }
    : {
        word: 'resumed',
        cleared: true,
        title: `wave ${run.wave} resumed its session (D-1); the /clear landed `
          + `${formatAge(nowSec - Math.floor(clearedAt / 1000))}`,
      };
}

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

/* ── F7: the compact warn row ──────────────────────────────────────────────── */

/** One thing worth saying about a run, as the board says everything: a WORD and
 *  a GLYPH, so the state is never read out of colour alone, plus the long form
 *  for `title=`. */
export interface RunWarning {
  readonly glyph: string;
  readonly word: string;
  readonly title: string;
}

/**
 * The warn row's whole decision. Lives here rather than in JSX for the reason
 * `resumeNote` and `dispatchWindow` do: a condition spelled inside a component
 * is a condition with no home and no test of its own.
 *
 * TOLERANT BY CONSTRUCTION. `health` is declared optional here even though
 * `RunSummary.health` is not, the `runItems`/`unmeasuredFields` idiom and for the
 * identical reason: a row reaches this renderer through an unvalidated boundary
 * (`asFleetMsg` shape-checks the ARRAY only, `api.runs()` is a bare cast), so an
 * older SERVER omits the key at runtime whatever the type promises. `undefined`
 * yields NO warnings — never "no wedge here", which is a claim this build would
 * be making on that server's behalf.
 *
 * Each threshold comparison is written so an ABSENT value fails it rather than
 * passing it (`MailStrip.tsx`'s negated-comparison rule): `coordKickoffPendingSince`
 * is null-checked before any arithmetic, because `null` coerces to 0 and would
 * read as an infinitely old kickoff on every healthy row.
 */
export function runWarnings(
  run: { state: RunState; health?: RunHealth },
  nowMs: number,
): readonly RunWarning[] {
  const h = run.health;
  if (h === undefined) return [];
  const out: RunWarning[] = [];
  if (h.mailParked > 0) {
    out.push({ glyph: '⛒', word: `${h.mailParked} parked`,
      title: `${h.mailParked} mail deliver${h.mailParked === 1 ? 'y' : 'ies'} to this run gave up ` +
        'and parked unread — a run-closed or reclaimed cancel is not counted here, so these are ' +
        'messages nobody received' });
  }
  if (h.mailReplayMax >= MAIL_REPLAY_WARN_COUNT) {
    out.push({ glyph: '↻', word: `replayed ${h.mailReplayMax}×`,
      title: `a delivery to this run has been replayed ${h.mailReplayMax} times without an ack. ` +
        'The lane parks it at 20 and the message is then lost to whoever it was steering — ' +
        'mail 120 reached 722 attempts and mail 129 reached 911, both arriving after the work ' +
        'they were meant to shape' });
  }
  // `=== false`, never `!h.briefQueued`: null is a THIRD condition (no dispatch
  // has committed, or the row predates migration 7) and must stay silent.
  if (h.briefQueued === false) {
    out.push({ glyph: '⌦', word: 'no brief',
      title: "this run's dispatch queued NO wave-brief" +
        (h.clearError === null ? '' : ` — the injected /clear was refused: ${h.clearError}`) +
        '. The worker was resumed into a context nothing was written to' });
  }
  if (h.doneRejects > 0) {
    out.push({ glyph: '⊘', word: `${h.doneRejects} rejected`,
      title: `${h.doneRejects} done-claim${h.doneRejects === 1 ? '' : 's'} refused by the server's ` +
        're-measurement' + (h.lastRejectCode === null ? '' : `, most recently ${h.lastRejectCode}`) });
  }
  const since = h.coordKickoffPendingSince;
  if (since !== null && nowMs - since >= KICKOFF_UNACKED_MS) {
    out.push({ glyph: '☡', word: 'never briefed',
      title: "the program-kickoff addressed to this run's coordinator has never been acked. " +
        'An open run whose chair nobody sat in cannot dispatch, close or answer mail' });
  }
  return out;
}

