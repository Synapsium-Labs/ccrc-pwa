// The run board's status vocabulary. Its OWN small table, deliberately not
// SessionBucket's (spec §6): a run state is a lifecycle position, not an
// attention state, and reusing the bucket words would put attention-amber on a
// row nobody is waiting on — against DIRECTION.md's rule that a hue means the
// same thing everywhere.
//
// Two cues per row, always: the word is the fact and the glyph is the shape, so
// no state has to be read out of colour (StatusDot.tsx's own discipline).
import { WARN_GLYPH } from '@ccrc/ui';
import { KICKOFF_UNACKED_MS, MAIL_REPLAY_WARN_COUNT, SPAWN_STALL_MS, isChildReclaimWord, isRunState,
  type ChildMark, type ChildReclaimStatus, type ChildReclaimWord, type RunHealth, type RunItemTally, type RunKind, type RunState, type RunSummary } from '../../../shared/api';
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
 *  own source, `watch.ts`'s `emitRuns`) draws the SAME line by excluding
 *  `TERMINAL_RUN_STATES` (`shared/api.ts`'s `done`/`failed` pair), so this is
 *  not a new definition, it is the existing one restated where the client
 *  can use it. `closedAt` is written by
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
  stalled: WARN_GLYPH,
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
 *  and not the same as "this session has never had a run".
 *
 *  During the required open-successor-before-close-producer boundary, two rows
 *  can name the same session. The API orders rows oldest-first, so the last
 *  matching id is the current wave; first-match would render the outgoing one. */
export function runForSession(
  runs: readonly RunSummary[], sessionId: string,
): RunSummary | null {
  let current: RunSummary | null = null;
  for (const run of runs) {
    if (run.sessionId === sessionId && (current === null || run.id > current.id)) current = run;
  }
  return current;
}

/**
 * Which card a run's rows belong on: the card the session it is ABOUT renders
 * on. Wave 2 of board placement moves a coordinated workspace to its
 * coordinator's card, and `nestFleet` can only draw the edge when the run
 * reaches THAT card — a run left on `run.project`'s card is spec §1's pure
 * regression (no edge, no marker, no `/runs` door).
 *
 * A BOUND run asks its WORKER: `boardHome` of `run.sessionId`, which is where
 * that row now renders.
 *
 * A PENDING SPAWN HAS NO WORKER, AND ASKS ITS COORDINATOR (D-3029).
 * It used to take `run.project`, which is right only while the wave works in
 * the coordinator's own repo: on a cross-repo wave the phantom landed on the
 * WAVE's card as a depth-0 orphan spawn, then jumped to the coordinator's card
 * the moment the worker bound — a row moving between cards as a side effect of
 * a dispatch completing. The phantom now follows its coordinator, which is
 * exactly where the bound worker is about to render, so nothing moves.
 *
 * `run.project` is the LAST answer, never the first: taken only when there is
 * nothing routable — no session and no claimant (a reconstructed, ownerless
 * row), or a session/claimant the fleet list does not carry this pass (reaped,
 * unmeasured, an older snapshot). Without it an orphaned run would render on
 * no card at all.
 *
 * `cardOf` is built ONCE per render by the caller from `boardHome` over the
 * whole session list — never inside a card, which sees only its own rows.
 */
export function runCard(
  run: { sessionId: string | null; claimedBy: string | null; project: string },
  cardOf: ReadonlyMap<string, string>,
): string {
  if (run.sessionId === null) {
    return run.claimedBy === null ? run.project : cardOf.get(run.claimedBy) ?? run.project;
  }
  return cardOf.get(run.sessionId) ?? run.project;
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

/* ── cross-repo: which repo, and whose programme (spec §3 F4) ─────────────── */

/**
 * The programme's HOME project, tolerantly — the ONE reader of
 * `RunSummary.homeProject` in `pwa/src`.
 *
 * The field is declared REQUIRED on the wire type and is still optional at
 * RUNTIME, the same measured skew `runItems`/`runClosedAt`/`graphReadCount`
 * already carry: `api.runs()` is a bare cast and the `{type:'runs'}` frame is
 * shape-checked at the array level only, so a row from a server that predates
 * this field arrives with the key missing. `undefined !== null` is true, so a
 * raw comparison at a call site paints a crossing marker naming `undefined` —
 * which is why every reader goes through here.
 *
 * THREE conditions collapse to `null` and that is deliberate, not an overloaded
 * null: absent, non-string and empty all mean "this board cannot name a home",
 * and the caller's answer to each is the same silence. What must NOT collapse
 * into it is a home that is genuinely the run's own project — that is a
 * measured sameness, and `crossingNote` decides it separately, below.
 */
export const runHomeProject = (run: { homeProject?: string | null }): string | null =>
  typeof run.homeProject === 'string' && run.homeProject !== '' ? run.homeProject : null;

/** `wave 2/5`, or `wave 2` when the programme declared no total. One spelling,
 *  three callers (the group header, the card's orphan marker, the card's abroad
 *  line) — a fragment this small is exactly the kind that drifts into four
 *  slightly different ones. */
export const waveLabel = (run: { wave: number; waveOf: number | null }): string =>
  run.waveOf === null ? `wave ${run.wave}` : `wave ${run.wave}/${run.waveOf}`;

/** The one glyph both crossing surfaces draw. A GLYPH, beside a WORD, never
 *  instead of one: the board's standing rule is that nothing is read out of
 *  colour or shape alone. */
export const CROSSING_GLYPH = '⇄';

export interface CrossingNote {
  readonly glyph: string;
  readonly word: string;
  /** The programme's home project — measured, never inferred. */
  readonly home: string;
  readonly title: string;
}

/**
 * What the board says about a wave running outside its programme's home repo,
 * or `null` when there is nothing to say. TWO ways to get `null` and they are
 * different facts kept apart on purpose:
 *   • the home is UNKNOWN (legacy generation, or an older server) — absence
 *     permits, and a marker here would be this build asserting a crossing it
 *     never measured;
 *   • the home IS this run's project — measured, and a marker would be a lie.
 * Neither renders, which is why they may share a return value: the CALLER does
 * the same thing with both, and the distinction that matters (is there a home
 * at all) is `runHomeProject`'s, one line up.
 */
export function crossingNote(
  run: { project: string; homeProject?: string | null },
): CrossingNote | null {
  const home = runHomeProject(run);
  if (home === null || home === run.project) return null;
  return {
    glyph: CROSSING_GLYPH,
    word: 'crossing',
    home,
    title: `this wave runs in ${run.project}; its programme is homed in ${home}`,
  };
}

/* ── design 2026-09-14 §8: the kind chip ──────────────────────────────────── */

export const REVIEW_GLYPH = '⌕';

export interface RunKindChip { readonly glyph: string; readonly word: string; readonly title: string }

/**
 * THE ONE READER of `RunSummary.kind` and `RunSummary.reviews` on this side
 * of the wire (CLAUDE.md "Wire discipline": a newer peer tolerates an older
 * peer omitting a field, through a SINGLE reader per field). Both are declared
 * optional here though the wire type requires them, `runWarnings`'s idiom: an
 * older SERVER omits them, and absence means a work run — the only kind that
 * server knew. `null` = render nothing, which is what every work row does.
 */
export const runKindChip = (run: { kind?: RunKind; reviews?: number | null }): RunKindChip | null => {
  if (run.kind === undefined || run.kind === 'work') return null;
  if (run.kind === 'review') {
    return {
      glyph: REVIEW_GLYPH,
      word: run.reviews === null || run.reviews === undefined ? 'review' : `reviews #${run.reviews}`,
      title: run.reviews === null || run.reviews === undefined
        ? 'a review run: reads one work run at one measured tip and reports; the coordinator rules'
        : `a review run: reads run #${run.reviews} at one measured tip and reports; the coordinator rules`,
    };
  }
  return { glyph: '·', word: 'unknown kind', title: 'a run of a kind this build cannot name' };
};

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
  run: { state: RunState; dispatchedAt?: number | null; health?: RunHealth },
  nowMs: number,
): readonly RunWarning[] {
  const h = run.health;
  if (h === undefined) return [];
  // A CLOSED run draws nothing, and this is the filter itself rather than a claim
  // about a caller. The first draft asserted "the board renders warnings on its
  // active slice only" and the board does no such thing: `RunsScreen` has ONE
  // `rowFor`, applied to `list` AND to `finished`. So a wave whose first done-claim
  // was refused `stale-tip` and then closed cleanly carried an amber "1 rejected"
  // in the archive forever, and an ABANDONED run — `failed`, never dispatched,
  // which is exactly what the Abandon control produces on a wedged row — drew
  // "never briefed … an open run whose chair nobody sat in", a flatly false
  // sentence about a closed run.
  //
  // Health facts stay MEASURED for a closed run on the server side, deliberately:
  // they are that run's history, and an adapter may not narrow a distinction it
  // received. Whether history deserves ATTENTION is this renderer's decision, and
  // the answer is no — a warning nobody can act on is how a warning surface
  // becomes ignorable, which is the thing this whole wave exists to prevent.
  if (isRunClosed(run)) return [];
  const out: RunWarning[] = [];
  if (h.mailParked > 0) {
    // The spec's ask is "outstanding VS parked", so the title carries both — which
    // is also what gives `mailOutstanding` a reader. Without it the field was
    // measured, shipped on every run in every frame, and rendered by nothing.
    out.push({ glyph: '⛒', word: `${h.mailParked} parked`,
      title: `${h.mailParked} mail deliver${h.mailParked === 1 ? 'y' : 'ies'} to this run gave up ` +
        `and parked unread (${h.mailOutstanding} still outstanding) — a run-closed or reclaimed ` +
        'cancel is not counted here, so these are messages nobody received' });
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
    out.push({ glyph: '⌦',
      // The CODE rides the word, not only the title: this is a mobile-first board
      // with no hover, and a `title` on a span flattened inside `.run-open` is not
      // announced either — so a title-only fact is a fact the operator cannot
      // reach, which is the state F7 exists to end.
      word: h.clearError === null ? 'no brief' : `no brief (${h.clearError})`,
      title: "this run's dispatch queued NO wave-brief" +
        (h.clearError === null ? '' : ` — the injected /clear was refused: ${h.clearError}`) +
        '. The worker was resumed into a context nothing was written to' });
  }
  if (h.doneRejects > 0) {
    out.push({ glyph: '⊘',
      word: h.lastRejectCode === null
        ? `${h.doneRejects} rejected`
        : `${h.doneRejects} rejected (${h.lastRejectCode})`,
      title: `${h.doneRejects} done-claim${h.doneRejects === 1 ? '' : 's'} refused by the server's ` +
        're-measurement' + (h.lastRejectCode === null ? '' : `, most recently ${h.lastRejectCode}`) });
  }
  // THREE conditions, all of them, and the middle one is the spec's own
  // (design §9: "open run, `dispatchedAt` null, kickoff delivery unacked past a
  // threshold"). Without `dispatchedAt === null` this fires on a run that HAS
  // dispatched — a coordinator that got the wave moving without ever acking its
  // kickoff, which is odd but is not the wedge, and drawing it as one is how a
  // warning surface becomes ignorable.
  //
  // The closed-run filter is EARLIER IN THIS SAME FUNCTION, at the `isRunClosed`
  // guard, and it is not the caller's. The sentence that stood here said the
  // opposite — "`closedAt`/state is the caller's filter: the board renders
  // warnings on its `active` slice only" — the exact premise D-1309 was raised to
  // delete,
  // re-asserted verbatim in the paragraph next door (D-1321). Both halves were
  // false when written: `RunsScreen` has ONE `rowFor`, applied to `list` AND to
  // `finished`, and this function's parameter type declared `state` without ever
  // reading it. A claim about a caller is the one kind of comment a reader cannot
  // check locally, which is why it survived a whole wave.
  //
  // The replacement then said the filter was "forty-four lines above" and it was
  // forty-six by the time anyone counted (D-1331). A line distance is a cardinal
  // nothing derives, so it is named by its guard now rather than measured in a
  // comment nobody re-runs.
  const since = h.coordKickoffPendingSince;
  const undispatched = (run.dispatchedAt ?? null) === null;
  if (since !== null && undispatched && nowMs - since >= KICKOFF_UNACKED_MS) {
    out.push({ glyph: '☡', word: 'never briefed',
      title: "the program-kickoff addressed to this run's coordinator has never been acked, and this " +
        'run has never dispatched. An open run whose chair nobody sat in cannot dispatch, close or ' +
        'answer mail — it is the shape run 11 has been wedged in since 2026-08-28' });
  }
  return out;
}

/* ── child-workspace reclamation (child-reclamation wave 5, spec §5.9) ────── */

/**
 * One glyph per word, TOTAL over `ChildReclaimWord`: a word the server gains is
 * a TS2741 here before it is a blank cell anywhere. The glyph is the SHAPE and
 * the word is the FACT, the board's standing two-cue rule. `⊘` is the
 * journal's own refusal glyph (`OUTCOME_GLYPH.refused`), so one mark means one
 * thing across both surfaces.
 */
export const CHILD_RECLAIM_CHIP_GLYPH: Record<ChildReclaimWord, string> = {
  reclaimed: '∅', pending: '…', deferred: '⧖', paused: '‖', refused: '⊘',
};

export interface ChildReclaimChip {
  /** The server's word, or `unknown` for one this build was never compiled to know. */
  readonly word: ChildReclaimWord | 'unknown';
  readonly glyph: string;
  /** The visible text. */
  readonly label: string;
  /** The server's sentence, verbatim, or null. Never composed here. */
  readonly sentence: string | null;
  /** The sentence again when the word is a refusal, the one word the operator
   *  may need to read in full, so it gets its own wrapped line. Null otherwise;
   *  the other words carry their sentence in the title. */
  readonly line: string | null;
  /** Epoch ms of the moment the word describes, or null. */
  readonly at: number | null;
}

/**
 * THE ONE READER of `RunSummary.childReclaim` in `pwa/src` (CLAUDE.md "Wire
 * discipline": a newer peer tolerates an older peer omitting a field, through a
 * SINGLE reader per field). The field is optional here although the wire type
 * requires it: `api.runs()` is a bare cast, and a server that predates wave 5
 * omits the key. Every member is checked, not trusted. `null` means render
 * nothing, which is what every non-child row and every open row does.
 *
 * It MAPS NOTHING. The word is the server's, the sentence is the server's, and
 * the only vocabulary here is `CHILD_RECLAIM_CHIP_GLYPH`, keyed on the word.
 */
export const childReclaimChip = (run: { childReclaim?: ChildReclaimStatus | null }): ChildReclaimChip | null => {
  const s: unknown = run.childReclaim;
  if (s === undefined || s === null || typeof s !== 'object') return null;
  const o = s as { word?: unknown; sentence?: unknown; at?: unknown };
  const sentence = typeof o.sentence === 'string' && o.sentence !== '' ? o.sentence : null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null;
  if (!isChildReclaimWord(o.word)) {
    return { word: 'unknown', glyph: '·', label: 'workspace: unknown state', sentence, line: null, at };
  }
  return {
    word: o.word,
    glyph: CHILD_RECLAIM_CHIP_GLYPH[o.word],
    label: `workspace ${o.word}`,
    sentence,
    line: o.word === 'refused' ? sentence : null,
    at,
  };
};

/** The chip's `title`: the server's sentence, or the label when it sent none,
 *  and the age of the chip's moment when it has one. */
export const childReclaimTitle = (chip: ChildReclaimChip, nowSec: number): string => {
  const head = chip.sentence ?? chip.label;
  return chip.at === null ? head : `${head} · ${formatAge(nowSec - Math.floor(chip.at / 1000))}`;
};

/** Is the session this row names GONE? Only a reclaimed child's is, and then
 *  the row must stop offering to open it (spec §5.9). Every other word leaves
 *  a workspace behind. */
export const childReclaimGone = (chip: ChildReclaimChip | null): boolean =>
  chip !== null && chip.word === 'reclaimed';

const CHILD_RECLAIM_UNSETTLED: ReadonlySet<string> = new Set<ChildReclaimWord>(['pending', 'deferred', 'paused']);

/**
 * Should the board re-read its archive? Yes exactly when a FINISHED row whose
 * chip is still unsettled names a session that was in the previous fleet frame
 * and is not in this one. A child's reclaim purges its registry row, so this is
 * the socket carrying the moment the chip goes stale. The board refuses a poll
 * (RunsScreen's header) and needs none.
 *
 * `reclaimed` and `refused` are settled: the first has nothing left to vanish,
 * and the second is the attention item's to keep live. A session never listed
 * cannot vanish.
 */
export function childReclaimRefreshDue(
  finished: readonly RunSummary[], before: ReadonlySet<string>, after: ReadonlySet<string>,
): boolean {
  for (const run of finished) {
    const sid = run.sessionId;
    if (sid === null || !before.has(sid) || after.has(sid)) continue;
    const chip = childReclaimChip(run);
    if (chip !== null && CHILD_RECLAIM_UNSETTLED.has(chip.word)) return true;
  }
  return false;
}

/**
 * Should the board re-read its archive because the server's newest reclaim end
 * moved (child-reclamation wave 6, spec §5.9)? The vanish trigger above
 * races the server's journal mirror: ccd purges the child's row before it
 * journals the end, so that read can come back with no chip. This is the
 * second trigger, on the fact the race was waiting for.
 *
 * Due exactly when `after` is a value, it differs from `before` (a CHANGE,
 * never only an increase, because a restarted server reads null first), and
 * some FINISHED row is unsettled:
 *   • its chip is pending, deferred or paused; or
 *   • it has no chip and `hadChild` holds its run, which is the race's own row.
 * An open row is never counted: its chip is blank by design.
 */
export function childReclaimDoneRefreshDue(
  runs: readonly RunSummary[], hadChild: ReadonlySet<number>, before: number | null, after: number | null,
): boolean {
  if (after === null || after === before) return false;
  for (const run of runs) {
    if (!isRunClosed(run)) continue;
    const chip = childReclaimChip(run);
    if (chip === null ? hadChild.has(run.id) : CHILD_RECLAIM_UNSETTLED.has(chip.word)) return true;
  }
  return false;
}

/** What a fleet row's `child` field says — four answers, never folded. `child`: a
 *  marker naming run `runId`. `none`: no marker — or no key at all, which only a
 *  server predating child marks sends, and such a server reclaims nothing.
 *  `unreadable`: the server could not read the marker. `unrecognised`: a shape this
 *  build cannot read (a newer or faulty server). */
export type ChildMarkRead =
  | { readonly kind: 'child'; readonly runId: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unrecognised' };

/** THE ONE READER of `FleetSession.child` in `pwa/src`. Optional here although the
 *  wire type requires it: the live `fleet` frame is cast, never revived. Three
 *  callers: `childOfRunLabel` (the fleet line), `abandonChildOf` (the abandon
 *  sheet) and `childRunsSeen` (the board's memory of which runs had a child).
 *  The label says nothing for `none` OR `unrecognised`; the sheet must hedge on
 *  `unrecognised` and not on `none`; the board's memory keeps `child` alone. So
 *  this answers four ways, and the label's `null` is never reused as a mark. */
export const childMarkOf = (session: { child?: ChildMark }): ChildMarkRead => {
  const c: unknown = session.child;
  if (c === undefined) return { kind: 'none' };
  if (c === null || typeof c !== 'object') return { kind: 'unrecognised' };
  const o = c as { kind?: unknown; runId?: unknown };
  if (o.kind === 'child' && typeof o.runId === 'number' && Number.isSafeInteger(o.runId)) {
    return { kind: 'child', runId: o.runId };
  }
  if (o.kind === 'none') return { kind: 'none' };
  if (o.kind === 'unreadable') return { kind: 'unreadable' };
  return { kind: 'unrecognised' };
};

/**
 * The run ids this board knows had a child (child-reclamation wave 6). A fleet
 * frame's child mark names its minting run, and a finished row carries a chip
 * only for a child. By the time the reclaim's end reaches the coord frame, the
 * child has left the fleet frame and its row may carry no chip, so the board
 * accumulates the answer across frames and reads. Never forgets: the set lives
 * as long as the board, and holds a few integers. Returns a new set.
 */
export function childRunsSeen(
  seen: ReadonlySet<number>, sessions: readonly { child?: ChildMark }[], runs: readonly RunSummary[],
): ReadonlySet<number> {
  const out = new Set(seen);
  for (const s of sessions) {
    const m = childMarkOf(s);
    if (m.kind === 'child') out.add(m.runId);
  }
  for (const run of runs) if (childReclaimChip(run) !== null) out.add(run.id);
  return out;
}

export interface ChildOfRunLabel {
  readonly text: string;
  readonly data: 'child' | 'unreadable';
  readonly title: string;
}

/**
 * The fleet line's label, projected from `childMarkOf` (the one reader of
 * `FleetSession.child`). THREE answers and no boolean (spec §5.1). A child names
 * its minting run. An unreadable marker says so, because the server treats it as
 * neither "a child" nor "not a child": it refuses a second run and defers a
 * reclaim. No marker, or a shape this build cannot read, says nothing.
 */
export const childOfRunLabel = (session: { child?: ChildMark }): ChildOfRunLabel | null => {
  const m = childMarkOf(session);
  if (m.kind === 'child') {
    return {
      text: `child of run #${m.runId}`,
      data: 'child',
      title: `minted by run #${m.runId} for one PR; the server reclaims it when nothing keeps it`,
    };
  }
  if (m.kind === 'unreadable') {
    return {
      text: 'child marker unreadable',
      data: 'unreadable',
      title: 'this workspace’s child marker could not be read: it takes no second run, and is not reclaimed until it can be read',
    };
  }
  return null;
};
