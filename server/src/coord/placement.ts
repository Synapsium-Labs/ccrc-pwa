/**
 * Which project CARD a session's row renders on — a display decision, never an
 * identity. `session.project` is untouched by this file and remains the primary
 * key, the registry label and the namespace.
 *
 * PURE (L1): no `fs`, no fastify, no clock, no `coord.db`. The one thing it
 * cannot answer itself — "which project coordinates this one" — arrives as
 * `coordOf`, a port declared BY THIS CONSUMER (the house pattern; see
 * `LivenessProbe` for the precedent).
 *
 * TOTAL: it always returns a project name. Every degenerate case — unheld, no
 * stamp, self-claimed, a cycle, a chain past the cap — returns `ownProject`. A
 * row can never be placed nowhere.
 */
export interface PlacementInput {
  readonly sessionId: string;
  readonly ownProject: string;
  /** Whether this workspace is still held by a programme. The hold is the
   *  DURABLE lifetime: releasing it is an explicit act, so a placement does not
   *  bounce at the wave boundary. Never parsed — this is the boolean form. */
  readonly held: boolean;
  /** The coordinator project stamped on THIS session's newest run, or null when
   *  nothing is stamped (an older row, or an open whose coordinator record was
   *  unreadable). This is the FIRST hop, and it is session-keyed. */
  readonly stamped: string | null;
  /** The transitive hops, which are PROJECT-keyed: which project coordinates
   *  the given project, or null when nothing does. Called at most `MAX_HOPS`
   *  times. A port declared BY THIS CONSUMER, the house pattern. */
  readonly coordOf: (project: string) => string | null;
}

/** Hop cap for the transitive walk. A coordinator-of-a-coordinator has never
 *  occurred (measured: 64 runs, 26 workers, 9 coordinators, zero overlap) and
 *  the worker skill forbids it — but that is a CONTRACT, not a mechanism, so
 *  the walk is bounded rather than trusted. */
const MAX_HOPS = 4;

export function boardPlacement(input: PlacementInput): string {
  if (!input.held) return input.ownProject;
  if (input.stamped === null) return input.ownProject;

  const seen = new Set<string>([input.ownProject]);
  let at = input.stamped;
  if (seen.has(at)) return input.ownProject;      // self-claimed
  seen.add(at);

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = input.coordOf(at);
    if (next === null) return at;                 // settled: nothing coordinates `at`
    // For a genuine cycle this only trims the call count — MAX_HOPS bounds the
    // walk either way, so the return value is identical with or without this
    // line. Its non-redundant job is refusing a chain that walks BACK THROUGH
    // `ownProject`: `seen` is seeded with it, so revisiting it here is a
    // transitive self-placement, not a cycle among unrelated projects.
    if (seen.has(next)) return input.ownProject;
    seen.add(next);
    at = next;
  }
  return input.ownProject;                        // past the cap — refuse to guess
}
