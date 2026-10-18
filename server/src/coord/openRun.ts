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
 *
 * ASYNC SINCE TASK 11b (D-5387). Coordinator-first Task 11b's three gates read
 * the REGISTRY (the claimant's `.uuid` and `.project`, the named session's
 * child marker), and a registry read is awaited — on a two-box fleet it is an
 * agent round trip. So the decider is `async` and a gate may answer a promise:
 * the registry lookups stay lazy and in gate order exactly like the store's,
 * rather than being read up front for every body (a malformed one included).
 * Still L1: the lookups are passed in, and nothing here touches `fs`.
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
  /** D-5298: whether the fleet box's `ccrc-api` attributes `runs open`
   *  (`fleetCarriesRunsAttribution`, computed by the route). False: an open
   *  without `claimedByUuid` is accepted and journaled `unattributed`. */
  readonly fleetCarriesAttribution: boolean;
  /** D-5298: the claim lanes' attribution check (`requireAttribution`'s
   *  verdict, `coord/routes.ts`) for `claimedBy` against `claimedByUuid`. */
  readonly attribute: (claimant: string, uuid: string) => Promise<AttributionRead>;
  /** D-5298: an UNATTRIBUTED claimant (before the switch-over) is a listed
   *  registry row — `<claimant>.uuid` in the registry listing — or
   *  `unknown-sender`, so no later gate path-joins an unlisted id (`../x`)
   *  into a field read. */
  readonly claimantListed: (claimant: string) => Promise<AttributionRead>;
  /** D-5298: the claimant's OWN registry project, MEASURED (`fieldMeasured`,
   *  never `SessionRecord.project`'s `project ?? id` default). */
  readonly claimantProject: (claimant: string) => Promise<ClaimantProjectRead>;
  /** D-5298: what the registry says the named `sessionId` is. */
  readonly sessionMark: (sessionId: string) => Promise<SessionMarkRead>;
}

/** The attribution refusals, each a `RouteRefusal` word the claim lanes
 *  already send (`unknown-sender` and `stale-uuid` 403, `registry-unmeasurable`
 *  502). */
export type AttributionRefusal = 'registry-unmeasurable' | 'unknown-sender' | 'stale-uuid';
export type AttributionRead = { ok: true } | { ok: false; error: AttributionRefusal; detail: string };

/** Three answers, never folded: a measured non-empty project; NONE (the field
 *  is absent or empty — a fact about the row); and UNREADABLE (transient, not a
 *  fact). */
export type ClaimantProjectRead =
  | { kind: 'measured'; project: string } | { kind: 'none' } | { kind: 'unreadable' };

/** What the registry says a `sessionId` is (D-5298), in spec §4's words:
 *   - `absent`: no `.uuid` listed — not a registry row yet. ADMITTED: a
 *     dispatch opens its run before `ws-add --child <run>` makes the row;
 *   - `child`: a row whose `ChildMark` is `{kind: 'child'}`;
 *   - `root`: a row whose `ChildMark` is `{kind: 'none'}` — a session that is
 *     not a dispatched child, which is every session the operator creates;
 *   - `unbuilt`: a `.uuid` listed but no row could be built around it and no
 *     `.child` listed — it cannot be proven absent, so it is refused as
 *     unmeasurable rather than admitted;
 *   - `deferred`: the registry could not be listed, or the marker is listed
 *     but unreadable, or listed with no row built around it. Rule 3's child
 *     gate (`childBind.ts`), which runs next and re-reads, refuses every one
 *     of these `spent-unmeasured`, so this gate does not answer them twice. */
export type SessionMarkRead =
  | { kind: 'absent' } | { kind: 'child' } | { kind: 'root' } | { kind: 'unbuilt' } | { kind: 'deferred' };

/** The detail an `attribution-required` refusal carries: the remedy, verbatim
 *  from spec §6.4. */
export const ATTRIBUTION_REQUIRED_DETAIL = "upgrade the fleet box's ccrc-api (ccrc rollout)";

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
export type OpenRunConflictCode = Extract<RunRefuseCode,
  'project-mismatch' | 'home-mismatch' | 'claimant-is-a-worker' | 'attribution-required' | 'not-a-child'>;

/** One refusal, carrying the gate that answered it (for the order table; the
 *  route does not send it) and exactly the body fields the inline sends wrote:
 *  the bare shape refusal has NO `detail` key, every other `error` has one. */
export type OpenRunRefusal =
  | { gate: OpenRunGate; error: 'bad-request'; detail?: string }
  | { gate: OpenRunGate; error: 'run-unreadable' | AttributionRefusal; detail: string }
  | { gate: OpenRunGate; refused: OpenRunConflictCode; by?: string; detail?: string };

/** The admitted open, shaped: what `CoordStore.openRun` and the route's later
 *  acts read, never the raw body. A review run's project, wave and waveOf are
 *  the REVIEWED run's (D-2799). */
export interface OpenRunPlan {
  program: string; title: string; project: string; wave: number; waveOf: number | null;
  claimedBy: string; kind: Exclude<RunKind, 'unknown'>; reviews: number | null;
  homeProject?: string; sessionId?: string;
  /** D-5298: accepted with no `claimedByUuid` before the switch-over. */
  unattributed: boolean;
  /** The claimant's measured registry project — the `claimantProject` gate's
   *  read, handed to `openRun`'s `coordProject` stamp so it is read once. */
  coordProject: string;
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
  unattributed?: boolean;
  coordProject?: string;
  /** The programme's home after `homeVerdict`: the body's shaped home, else
   *  (a legacy open) the stored one, else null. */
  effectiveHome?: string | null;
  mark?: SessionMarkRead;
}

type GateResult = { error: 'bad-request'; detail?: string } | { error: 'run-unreadable' | AttributionRefusal; detail: string }
  | { refused: OpenRunConflictCode; by?: string; detail?: string } | undefined;
type Gate = (c: Ctx) => GateResult | Promise<GateResult>;

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
      // D-5298: a sent `claimedByUuid` is a non-empty string; absent is the
      // unattributed open the `attribution` gate decides.
      !(b.claimedByUuid === undefined || (typeof b.claimedByUuid === 'string' && b.claimedByUuid.trim() !== '')) ||
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
  // D-5298 (coordinator-first Task 11b, spec §6.4): the claimant PROVES it is
  // the claimant. AFTER every body-only gate (each is cheaper, and reveals
  // nothing about the store) and BEFORE the first store read (`reviewRead`),
  // so a caller that is not the claimant it names learns nothing about the
  // store: not whether a reviewed run exists, not the project a session is
  // bound to, not a programme's home, not whose worker the claimant is.
  // Freshness, not identity (`requireAttribution`'s own note). Before the
  // switch-over an absent uuid is ACCEPTED and journaled; a SENT one is always
  // checked, so a stale claimant is refused in either state.
  ['attribution', async (c) => {
    const uuid = c.b.claimedByUuid;
    if (uuid === undefined) {
      if (c.f.fleetCarriesAttribution) return { refused: 'attribution-required', detail: ATTRIBUTION_REQUIRED_DETAIL };
      const listed = await c.f.claimantListed(c.b.claimedBy as string);
      if (!listed.ok) return { error: listed.error, detail: listed.detail };
      c.unattributed = true;
      return undefined;
    }
    const r = await c.f.attribute(c.b.claimedBy as string, uuid as string);
    return r.ok ? undefined : { error: r.error, detail: r.detail };
  }],
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
    c.effectiveHome = c.home !== undefined ? c.home : known ? c.f.programHome(c.slug!) : null;
    return undefined;
  }],
  // §12: a dispatched worker may not coordinate. EVERY open claimant is read
  // (D-3054); a self-claimed run and an ownerless one are admitted (D-3012);
  // `by` names the newest offender.
  ['claimantWorker', (c) => {
    const workerOf = c.f.openClaimantsOf(c.b.claimedBy as string).find((x) => x !== c.b.claimedBy);
    return workerOf !== undefined ? { refused: 'claimant-is-a-worker', by: workerOf } : undefined;
  }],
  // D-5298 (spec §4, §6.4), D-5388: a session in another project cannot
  // become a child's parent. The claimant's OWN registry project must equal
  // the run's — not F1's weaker "the session's history agrees with the run" —
  // OR the programme's home (`effectiveHome`), because a programme's waves may
  // run in ANY project (the cross-repo ruling of 2026-08-11): a crossing's
  // coordinator sits in the home. A crossing binds only a fresh spawn
  // (`crossingSession` below). On every open, a `sessionId` or not: a
  // fresh-spawn dispatch later makes a child of the run's project whose parent
  // is this claimant. FAILS CLOSED: a row that records no project is refused
  // (`by` absent, the sentence says why), an unreadable field is the transient
  // 502. After the DB-only gates — a registry read is the dearer one — and
  // before `notAChild`.
  ['claimantProject', async (c) => {
    const project = c.target !== undefined ? c.target.project : c.b.project as string;
    const r = await c.f.claimantProject(c.b.claimedBy as string);
    if (r.kind === 'unreadable') {
      return { error: 'registry-unmeasurable',
        detail: "the claimant's registry project could not be read — transient, not a fact about the claimant" };
    }
    if (r.kind === 'none') {
      return { refused: 'project-mismatch', detail: "the claimant's registry row records no project, so it cannot be the run's" };
    }
    c.coordProject = r.project;
    return r.project !== project && r.project !== c.effectiveHome ? { refused: 'project-mismatch', by: r.project } : undefined;
  }],
  // D-5298 (spec §4): a session the operator created cannot become a child. A
  // `sessionId` naming an existing registry row whose `ChildMark` is not
  // `{kind: 'child'}` is refused; a row-less id is admitted (a dispatch opens
  // its run before `ws-add --child <run>` makes the row, and the marker it then
  // writes names this run). LAST, beside rule 3's child gate, which reads the
  // same row and runs next.
  ['notAChild', async (c) => {
    if (typeof c.b.sessionId !== 'string') return undefined;
    const m = await c.f.sessionMark(c.b.sessionId);
    c.mark = m;
    if (m.kind === 'root') {
      return { refused: 'not-a-child',
        detail: `${c.b.sessionId} is a registry row with no child marker — a session the operator created is never bound as a child` };
    }
    if (m.kind === 'unbuilt') {
      return { error: 'registry-unmeasurable',
        detail: `registry row for ${c.b.sessionId} is listed but unreadable — transient, not a fact about the session` };
    }
    return undefined;
  }],
  // D-5388: a crossing (the claimant is of the home, not of the run) binds
  // only a FRESH spawn. An existing child row of the run's project would
  // otherwise be rebound to a parent outside its project — a child of any
  // other programme whose home a confused session claims. A row-less id (the
  // dispatch before `ws-add`) is admitted, like `notAChild`'s; `deferred` is
  // left to rule 3's child gate. Reads `notAChild`'s mark, never a second one.
  ['crossingSession', (c) => {
    if (typeof c.b.sessionId !== 'string' || c.mark?.kind !== 'child') return undefined;
    const project = c.target !== undefined ? c.target.project : c.b.project as string;
    return c.coordProject !== project
      ? { refused: 'project-mismatch', by: c.coordProject,
          detail: `${c.b.sessionId} is an existing session of ${project} and the claimant is of ${c.coordProject} — a crossing wave opens without sessionId and spawns fresh` }
      : undefined;
  }],
] as const satisfies readonly (readonly [string, Gate])[];

export type OpenRunGate = (typeof GATES)[number][0];
/** The gates in the order they run. Read by the order table's coverage check. */
export const OPEN_RUN_GATES: readonly (readonly [OpenRunGate, Gate])[] = GATES;

/**
 * Decide an open (D-5384): the first gate that refuses answers, else the
 * shaped plan and the home verdict the route acts on after `openRun`.
 */
export async function openRunPreconditions(f: OpenRunFacts): Promise<OpenRunVerdict> {
  const c: Ctx = { f, b: f.body };
  for (const [gate, run] of OPEN_RUN_GATES) {
    const r = await run(c);
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
      unattributed: c.unattributed === true, coordProject: c.coordProject!,
    },
  };
}
