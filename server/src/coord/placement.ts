/**
 * Which project CARD a session's row renders on — a display decision, never an
 * identity. `session.project` is untouched by this file and remains the primary
 * key, the registry label and the namespace.
 *
 * PURE (L1): no `fs`, no fastify, no clock, no `coord.db`. The one thing it
 * cannot answer itself — "which session coordinates this one" — arrives as
 * `stampOf`, a port declared BY THIS CONSUMER (the house pattern; see
 * `LivenessProbe` for the precedent). `foldCoordPlacements` below builds that
 * port from a flat stamp list, and lives here rather than in `fleet.ts` (L3)
 * for the same reason `boardPlacement` does: it is a pure decision about the
 * same question, and splitting the fold from the walk across a ring boundary
 * is what let the two disagree about what the hop is keyed on (D-2921).
 *
 * TOTAL: it always returns a project name. Every degenerate case — unheld, no
 * stamp, self-claimed, a cycle, a chain past the cap — returns `ownProject`. A
 * row can never be placed nowhere.
 */

/**
 * One run's board-placement stamp, as the store reads it — the columns this
 * policy needs and nothing else. Declared HERE, by the consumer, so the
 * question the column answers is stated where the answer is computed: the
 * store's narrow read (`coordPlacementStamps`) imports this type rather than
 * owning it.
 *
 * `claimedBy` is the coordinator's SESSION id and `coordProject` that
 * session's project, measured at the moment the coordinator was decided. They
 * ride TOGETHER because the walk needs both: the project is the answer, the
 * session id is the next question (D-2921).
 *
 * `id` rides along specifically so the fold can pick the NEWEST stamp per
 * session by comparing ids rather than trusting the read's row order —
 * `coordPlacementStamps`' own docstring.
 */
export interface CoordPlacementStamp {
  readonly id: number;
  /** The WORKER session this run stamps, or null for a run no session is bound
   *  to yet. A null-session stamp answers no lookup and is folded away. */
  readonly sessionId: string | null;
  /** The coordinator's session id. Null when the run carries a stamped project
   *  but no claimant — the walk can still answer that project, but cannot ask
   *  a further hop, and says so by settling rather than guessing. */
  readonly claimedBy: string | null;
  readonly coordProject: string;
}

/** What one session's NEWEST stamp says about its coordinator: which project
 *  that coordinator belongs to, and which session it is. Two facts about ONE
 *  coordinator, so they are never handed over separately — a caller holding
 *  one without the other is holding half an answer. */
export interface CoordStamp {
  readonly coordProject: string;
  readonly claimedBy: string | null;
}

/** "Which session coordinates this one, and where does it live?" — null when
 *  nothing coordinates it. SESSION-keyed, which is the whole of D-2921: the
 *  first hop and every later hop are the same question asked of a different
 *  session, so there is exactly one lookup and no second, differently-keyed
 *  table for them to disagree about. */
export type StampLookup = (sessionId: string) => CoordStamp | null;

export interface PlacementInput {
  /** The session being placed. Load-bearing, not decoration: it seeds the
   *  visited set, so "the coordinator is the session itself" is an EXACT
   *  check on a session id rather than an approximation on a project name. */
  readonly sessionId: string;
  readonly ownProject: string;
  /** Whether this workspace is still held by a programme. The hold is the
   *  DURABLE lifetime: releasing it is an explicit act, so a placement does not
   *  bounce at the wave boundary. Never parsed — this is the boolean form. */
  readonly held: boolean;
  /** The one port. Called at most `MAX_HOPS` times, starting with this
   *  session's own id. */
  readonly stampOf: StampLookup;
}

/** Hop cap for the walk — the number of `stampOf` calls, INCLUDING the first.
 *  It is 5 rather than the 4 it was before D-2921 precisely so the reach is
 *  unchanged: the first hop used to arrive as a free `stamped` field with a
 *  cap of 4 over the transitive lookups, for a reach of five stamps. Now that
 *  both are the same lookup the cap counts all of them.
 *
 *  A coordinator-of-a-coordinator has never occurred (measured: 64 runs, 26
 *  workers, 9 coordinators, zero overlap) and the worker skill forbids it —
 *  but that is a CONTRACT, not a mechanism, so the walk is bounded rather
 *  than trusted. */
const MAX_HOPS = 5;

export function boardPlacement(input: PlacementInput): string {
  if (!input.held) return input.ownProject;

  // Ranges over SESSION ids, seeded with the session being placed. Both checks
  // it powers are therefore exact: a stamp naming this very session is the
  // "self-claimed" degenerate, and a stamp naming an ancestor is a cycle.
  const seen = new Set<string>([input.sessionId]);
  let at = input.sessionId;
  // The best answer found so far: the project of the LAST coordinator the walk
  // reached. Null until the first stamp lands, which is what makes "no stamp
  // at all" fall back to `ownProject` while "stamped, then the chain ends"
  // settles on the root coordinator's project.
  let placement: string | null = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const stamp = input.stampOf(at);
    // Settled: nothing coordinates `at`, so the last coordinator reached IS the
    // root. On the first pass there is no last coordinator and the row goes
    // home, which is the "no run, no stamp" degenerate.
    if (stamp === null) return placement ?? input.ownProject;
    placement = stamp.coordProject;
    const next = stamp.claimedBy;
    // A stamped project with no claimant: the answer is known, the next
    // question is not askable. Settle on what was measured rather than walk on
    // a guess.
    if (next === null) return placement;
    // Self-claimed on the first pass (`next` is the seed), or a cycle on a
    // later one. Both fall home per spec section 4's "every degenerate case
    // lands the row on its own card".
    if (seen.has(next)) return input.ownProject;
    seen.add(next);
    at = next;
  }
  return input.ownProject;                        // past the cap — refuse to guess
}

/**
 * PURE fold from a flat stamp list to `boardPlacement`'s one port: the stamp
 * on a session's OWN newest run.
 *
 * NEWEST-WINS, ORDER-INDEPENDENT (fix round 1, findings 3+4). The original cut
 * folded by ARRIVAL order, overwriting on every hit, so newest won only
 * because `coordPlacementStamps`' `ORDER BY id` happened to hold. That
 * ordering is not documented as a CONTRACT and nothing reds if it changes, so
 * this fold does not rely on it: `newestId` tracks the highest `id` folded
 * into each key so far, and an entry is only replaced when a STRICTLY higher
 * id arrives — a plain `Map` cannot tell "this key already has a stamp" from
 * "this key has the RIGHT stamp", which is what that side table adds. Correct
 * regardless of the order `stamps` arrives in, which is exactly what
 * `fleet.test.ts`'s reverse-order test proves by running this function twice
 * over one list, forwards and reversed, and asserting an identical result —
 * something no test through the real read can exercise, since a real read
 * always arrives in one direction.
 *
 * D-2921 collapsed what used to be TWO maps into this one. The second was
 * keyed on `runs.project`, which is the WORKER's project, and answering "which
 * project coordinates project P" with it made `byProject[P] === P` for every
 * project hosting an ordinary same-repo programme. There is no second table
 * now, so there is nothing for the first to disagree with.
 */
export function foldCoordPlacements(stamps: readonly CoordPlacementStamp[]): StampLookup {
  const bySession = new Map<string, CoordStamp>();
  const newestId = new Map<string, number>();
  for (const stamp of stamps) {
    if (stamp.sessionId === null) continue;
    const seen = newestId.get(stamp.sessionId);
    if (seen !== undefined && stamp.id <= seen) continue;
    newestId.set(stamp.sessionId, stamp.id);
    bySession.set(stamp.sessionId, { coordProject: stamp.coordProject, claimedBy: stamp.claimedBy });
  }
  return (sessionId: string): CoordStamp | null => bySession.get(sessionId) ?? null;
}
