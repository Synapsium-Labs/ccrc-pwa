import { isPositiveDecimalSafeInteger, shapeProgramSlug } from '../../../shared/api.js';
import type { RunKind, RunRefuseCode, RunSummary } from '../../../shared/api.js';

/**
 * `POST /api/runs`' synchronous preconditions, decided (D-5384, audit ticket
 * ARCH-21, CCRCP-120 — the prerequisite of coordinator-first Task 11b). L1:
 * no `fs`, no fastify, no `reply`, no clock; its one value import is L0,
 * `shared/api.ts`. The route (`coord/routes.ts`, L4) gathers the facts, calls
 * `openRunPreconditions` inside `coordMutex`, and answers a refusal through the
 * route refusal helpers (`server/src/refuse.ts`) — it decides none of this.
 *
 * WHAT MOVED HERE, behaviour-identical: the body shape and `kind`, the review
 * arm (design 2026-09-14 §5.1, D-2799), the one programme-slug shaping, the one
 * home shaping (D-2349), F1's `project-mismatch` (design 2026-09-08 §3 F1),
 * F2's home verdict (§3 F2, D-2867) and §12's `claimant-is-a-worker` (spec
 * 2026-09-16, D-3012, D-3054). WHAT DID NOT: rule 3's child gate
 * (`childBind.ts`, an awaited registry read that must run after every DB-only
 * refusal here), the registry `project` stamp, `openRun` itself, and every act
 * after it — the route keeps those, in that order.
 *
 * THE ORDER IS THE CONTRACT. `OPEN_RUN_GATES` runs top to bottom and the first
 * refusal wins, so a body two gates refuse gets the earlier one's answer. The
 * order is pinned by `open-run-preconditions.test.ts`'s gate-order table: a row
 * per adjacent pair one body can trip together, each with a recorded reorder
 * mutant. A new gate (Task 11b's attribution, project-mismatch and
 * not-a-child) is a new entry here plus its rows there.
 *
 * PURE OVER ITS FACTS. The store reads are passed in as synchronous lookups and
 * called LAZILY, by the gate that needs each one, so a refusal still costs only
 * the reads ahead of it — exactly the reads the inline handler made. A
 * malformed body reads nothing; a work open never reads a reviewed run.
 */

/** The reviewed run, as far as the review arm reads it. */
export type ReviewedRunFacts = Pick<RunSummary, 'kind' | 'state' | 'program' | 'claimedBy' | 'project' | 'wave' | 'waveOf'>;

export interface OpenRunFacts {
  /** The request body, untrusted and unshaped. */
  readonly body: Readonly<Record<string, unknown>>;
  /** `HOME_PROJECT_LEGACY_ACCEPTED`, read once by the route and passed in, so
   *  the other branch stays drivable after the flip (D-2867). */
  readonly legacyAccepted: boolean;
  /** `CoordStore.run(id)`: two answers on success (a row, or none) and a third
   *  for an unreadable store — never folded into "no run". */
  readonly reviewed: (id: number) => { ok: true; run: ReviewedRunFacts | null } | { ok: false; detail: string };
  /** `CoordStore.sessionProject`: the project this store's history binds a
   *  session to, or null when it binds it to none (absence permits). */
  readonly sessionProject: (sessionId: string) => string | null;
  /** Whether this box has a programme row for the slug — measured apart from
   *  `programHome`, whose null answers both "no row" and "row, NULL home". */
  readonly programKnown: (slug: string) => boolean;
  readonly programHome: (slug: string) => string | null;
  /** `CoordStore.openClaimantsOf`: every coordinator this session is currently
   *  the worker of, newest first. */
  readonly openClaimantsOf: (sessionId: string) => readonly string[];
}

/** What the open route must DO about the body's `homeProject` and the
 *  programme's stored one. SIX answers, none folded into another: `write` and
 *  `agrees` both mean "nothing extra to do" but for different reasons and at
 *  different moments (a first insert versus a later open), and collapsing them
 *  would make the backfill event impossible to place correctly. */
export type HomeProjectVerdict =
  | { kind: 'write' }
  | { kind: 'agrees' }
  | { kind: 'backfill'; home: string }
  | { kind: 'legacy' }
  | { kind: 'required' }
  | { kind: 'mismatch'; by: string };

/**
 * The home decision, pure and independently testable — no store, no reply, no
 * clock. MOVED HERE from `coord/routes.ts` by D-5384, which ends the ring
 * compromise its old docstring recorded (an L1 decision defined in L4 so the
 * legacy flip stayed a one-constant change): the flip is done (D-2867), the
 * constant `HOME_PROJECT_LEGACY_ACCEPTED` stays in `coord/routes.ts`, and
 * `coord/routes.ts` re-exports this function so its importers are unchanged.
 *
 * `known` and `stored` are TWO INPUTS and not one, because `programHome`
 * answers `null` both for a programme row with a NULL home and for a slug with
 * no row, and this function's caller acts on those differently: the first is a
 * BACKFILL that records an event, the second is a first insert that records
 * nothing. Establishing existence is the caller's job, and passing the answer
 * in is what keeps that overloaded null out of the decision.
 *
 * An ABSENT body home is decided by `legacyAccepted` alone — never by `known`
 * or `stored` — because the column stays NULL either way: nothing is guessed
 * into it, so a later explicit home can backfill it instead of colliding.
 */
export function homeProjectVerdict(input: {
  body: string | undefined; known: boolean; stored: string | null; legacyAccepted: boolean;
}): HomeProjectVerdict {
  if (input.body === undefined) {
    return input.legacyAccepted ? { kind: 'legacy' } : { kind: 'required' };
  }
  if (!input.known) return { kind: 'write' };
  if (input.stored === null) return { kind: 'backfill', home: input.body };
  return input.stored === input.body ? { kind: 'agrees' } : { kind: 'mismatch', by: input.stored };
}

/** What `POST /api/runs` accepts as a `homeProject`, decided ONCE at the door
 *  (PR #75 review round 1, F2 + F4). Two answers, never folded: an accepted
 *  value is TRIMMED — the same fold `fieldMeasured` applies to a registry
 *  field — and a refused one carries the sentence the caller is told. */
export type HomeProjectShape = { ok: true; home: string } | { ok: false; detail: string };

/**
 * A home is a single path segment under `projectsRoot`, and nothing else
 * (D-2349):
 * `ledgerAbsPath` joins it there, and the first non-NULL home a programme
 * stores is permanent (`setProgramHome` is `WHERE homeProject IS NULL`), so
 * a whitespace-wrapped spelling would home the programme at `'demo\n'` for
 * ever — every later open sending the clean spelling refused `home-mismatch`
 * against a value that RENDERS the same — and a `..` segment would name a
 * file outside the projects root. Pure, so `home-project.test.ts` drives
 * every branch; the route reads `detail` onto its 400 verbatim.
 */
export function shapeHomeProject(raw: string): HomeProjectShape {
  const home = raw.trim();
  if (home === '') return { ok: false, detail: 'homeProject is empty' };
  if (home === '.' || home === '..' || home.includes('/')) {
    return { ok: false, detail: `homeProject must be a single path segment, not ${JSON.stringify(home)}` };
  }
  return { ok: true, home };
}

/** The run refusals this decider answers in `refused` (a `RunRefuseCode`
 *  body key, with `by`), as opposed to the `error` words. */
export type OpenRunConflictCode = Extract<RunRefuseCode, 'project-mismatch' | 'home-mismatch' | 'claimant-is-a-worker'>;

/** One refusal, carrying the gate that answered it (for the order table; the
 *  route does not send it) and exactly the body fields the inline sends wrote:
 *  the bare shape refusal has NO `detail` key, every other `error` has one. */
export type OpenRunRefusal =
  | { gate: OpenRunGate; error: 'bad-request'; detail?: string }
  | { gate: OpenRunGate; error: 'run-unreadable'; detail: string }
  | { gate: OpenRunGate; refused: OpenRunConflictCode; by: string };

/** The admitted open, shaped: what `CoordStore.openRun` and the route's later
 *  acts read, never the raw body. A review run's project, wave and waveOf are
 *  the REVIEWED run's (D-2799). */
export interface OpenRunPlan {
  program: string; title: string; project: string; wave: number; waveOf: number | null;
  claimedBy: string; kind: Exclude<RunKind, 'unknown'>; reviews: number | null;
  homeProject?: string; sessionId?: string;
}

export type OpenRunVerdict =
  | { ok: true; home: HomeProjectVerdict; open: OpenRunPlan }
  | { ok: false; refusal: OpenRunRefusal };

/** The decider's working state: the facts, plus what earlier gates shaped. */
interface Ctx {
  readonly f: OpenRunFacts;
  readonly b: Readonly<Record<string, unknown>>;
  slug?: string;
  target?: ReviewedRunFacts;
  home?: string;
  verdict?: HomeProjectVerdict;
}

type GateResult = { error: 'bad-request'; detail?: string } | { error: 'run-unreadable'; detail: string }
  | { refused: OpenRunConflictCode; by: string } | undefined;
type Gate = (c: Ctx) => GateResult;

const isReview = (c: Ctx): boolean => c.b.kind === 'review';
const bad = (detail: string): GateResult => ({ error: 'bad-request', detail });

/**
 * THE GATES, IN ORDER (D-5384). One entry per refusal condition, each on its
 * own line so a reorder is a one-line swap; the review gates answer nothing on
 * a work run. Comments name the inline handler's reasons for each position.
 */
const GATES = [
  // Design 2026-09-14 §5.1 / D-2799. `kind` absent is 'work'. BEFORE the shape
  // guard: that guard's own project/wave relaxation reads `kind !== 'review'`
  // and would otherwise fold an invalid `kind` into the bare `bad-request`.
  ['kind', (c) => (c.b.kind === undefined || c.b.kind === 'work' || c.b.kind === 'review') ? undefined : bad('kind must be work or review')],
  // The body shape. Present-and-not-a-string `homeProject` is malformed; its
  // VALUE is shaped once, at `home-shape` (D-2349; PR #75 review round 1, F2 + F4).
  ['shape', (c) => {
    const { program, title, claimedBy, sessionId, homeProject } = c.b, b = c.b, kind = b.kind;
    return (typeof program !== 'string' ||
      typeof title !== 'string' || title.trim() === '' ||
      (kind !== 'review' && (typeof b.project !== 'string' || b.project.trim() === '')) ||
      (b.project !== undefined && typeof b.project !== 'string') ||
      typeof claimedBy !== 'string' || claimedBy.trim() === '' ||
      (kind !== 'review' && !isPositiveDecimalSafeInteger(b.wave)) ||
      (b.wave !== undefined && !isPositiveDecimalSafeInteger(b.wave)) ||
      !(b.waveOf === undefined || b.waveOf === null || isPositiveDecimalSafeInteger(b.waveOf)) ||
      !(sessionId === undefined || (typeof sessionId === 'string' && sessionId.trim() !== '')) ||
      !(homeProject === undefined || typeof homeProject === 'string'))
      ? { error: 'bad-request' } : undefined;
  }],
  ['reviewsOnWork', (c) => (!isReview(c) && c.b.reviews !== undefined) ? bad('reviews is only accepted with kind review') : undefined],
  ['reviewsId', (c) => (isReview(c) && !isPositiveDecimalSafeInteger(c.b.reviews)) ? bad('reviews must name the work run under review (a positive run id)') : undefined],
  // ABOVE the review arm (Task 5 review I2): the reviewed run's `program` is
  // already shaped, so a raw comparison let a padded slug pass a work open and
  // fail the identical review open.
  ['program', (c) => {
    const s = shapeProgramSlug(c.b.program as string);
    if (!s.ok) return bad(s.detail);
    c.slug = s.slug;
    return undefined;
  }],
  ['reviewSession', (c) => (isReview(c) && c.b.sessionId !== undefined) ? bad('sessionId is refused on a review run — it always spawns fresh on its own workspace') : undefined],
  ['reviewRead', (c) => {
    if (!isReview(c)) return undefined;
    const r = c.f.reviewed(c.b.reviews as number);
    if (!r.ok) return { error: 'run-unreadable', detail: r.detail };
    if (r.run === null) return bad('reviews names no run');
    c.target = r.run;
    return undefined;
  }],
  ['reviewKind', (c) => (isReview(c) && c.target!.kind !== 'work') ? bad(`reviews must name a work run, not one of kind ${c.target!.kind}`) : undefined],
  ['reviewState', (c) => (isReview(c) && c.target!.state !== 'awaiting-review') ? bad(`reviews must name a run at awaiting-review, not ${c.target!.state}`) : undefined],
  ['reviewProgram', (c) => (isReview(c) && c.target!.program !== c.slug) ? bad(`program must be the reviewed run's (${c.target!.program})`) : undefined],
  ['reviewClaimant', (c) => (isReview(c) && c.target!.claimedBy !== c.b.claimedBy) ? bad('claimedBy must be the reviewed run\'s coordinator') : undefined],
  ['reviewProject', (c) => (isReview(c) && c.b.project !== undefined && c.b.project !== c.target!.project) ? bad(`project must be the reviewed run's (${c.target!.project})`) : undefined],
  ['reviewWave', (c) => (isReview(c) && c.b.wave !== undefined && c.b.wave !== c.target!.wave) ? bad(`wave must be the reviewed run's (${c.target!.wave})`) : undefined],
  ['reviewWaveOf', (c) => (isReview(c) && c.b.waveOf !== undefined && c.b.waveOf !== null && c.b.waveOf !== c.target!.waveOf) ? bad(`waveOf must be the reviewed run's (${c.target!.waveOf})`) : undefined],
  // THE ONE HOME SHAPING: every consumer after it reads `home`, never the raw field.
  ['homeShape', (c) => {
    if (typeof c.b.homeProject !== 'string') return undefined;
    const s = shapeHomeProject(c.b.homeProject);
    if (!s.ok) return bad(s.detail);
    c.home = s.home;
    return undefined;
  }],
  // F1: a session's workspace is a worktree in ONE repository. Before the row
  // exists, so a refusal leaves no `planned` orphan; a null answer permits.
  ['projectMismatch', (c) => {
    if (typeof c.b.sessionId !== 'string') return undefined;
    const bound = c.f.sessionProject(c.b.sessionId);
    const project = c.target !== undefined ? c.target.project : c.b.project as string;
    return bound !== null && bound !== project ? { refused: 'project-mismatch', by: bound } : undefined;
  }],
  // F2: the programme's home. `required` keeps its OWN sentence (D-2349): "your
  // JSON is malformed" and "this build requires a home" have different remedies.
  ['homeVerdict', (c) => {
    const known = c.f.programKnown(c.slug!);
    const v = homeProjectVerdict({
      body: c.home, known, stored: known ? c.f.programHome(c.slug!) : null, legacyAccepted: c.f.legacyAccepted,
    });
    c.verdict = v;
    if (v.kind === 'mismatch') return { refused: 'home-mismatch', by: v.by };
    if (v.kind === 'required') return bad('homeProject is required');
    return undefined;
  }],
  // §12: a dispatched worker may not coordinate. EVERY open claimant is read
  // (D-3054); a self-claimed run and an ownerless one are admitted (D-3012);
  // `by` names the newest offender.
  ['claimantWorker', (c) => {
    const workerOf = c.f.openClaimantsOf(c.b.claimedBy as string).find((x) => x !== c.b.claimedBy);
    return workerOf !== undefined ? { refused: 'claimant-is-a-worker', by: workerOf } : undefined;
  }],
] as const satisfies readonly (readonly [string, Gate])[];

export type OpenRunGate = (typeof GATES)[number][0];
/** The gates in the order they run. Read by the order table's coverage check. */
export const OPEN_RUN_GATES: readonly (readonly [OpenRunGate, Gate])[] = GATES;

/**
 * Decide an open (D-5384): the first gate that refuses answers, else the
 * shaped plan and the home verdict the route acts on after `openRun`.
 */
export function openRunPreconditions(f: OpenRunFacts): OpenRunVerdict {
  const c: Ctx = { f, b: f.body };
  for (const [gate, run] of OPEN_RUN_GATES) {
    const r = run(c);
    if (r !== undefined) return { ok: false, refusal: { gate, ...r } as OpenRunRefusal };
  }
  const b = c.b, t = c.target, review = isReview(c);
  return {
    ok: true, home: c.verdict!,
    open: {
      program: c.slug!, title: b.title as string,
      project: t !== undefined ? t.project : b.project as string,
      wave: t !== undefined ? t.wave : b.wave as number,
      waveOf: ((t !== undefined ? t.waveOf : b.waveOf) ?? null) as number | null,
      claimedBy: b.claimedBy as string,
      kind: review ? 'review' : 'work', reviews: review ? b.reviews as number : null,
      ...(c.home !== undefined ? { homeProject: c.home } : {}),
      ...(typeof b.sessionId === 'string' ? { sessionId: b.sessionId } : {}),
    },
  };
}
