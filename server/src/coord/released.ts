/**
 * Whether a workspace was RELEASED — its programme is done with it — and from which run (workspace lifecycle
 * spec §5.1). The answer is `FleetSession.releasedFrom`, which puts the row in its card's `Released (N)` fold.
 *
 * PURE (L1): no `fs`, no fastify, no clock, no `coord.db`. The run facts arrive as `ReleasedLookup`, a port
 * declared BY THIS CONSUMER (`placement.ts`'s pattern): the store's narrow read (`lastRunBySession`) imports
 * `LastRun` from here rather than owning it, and `foldLastRuns` below builds the port from that read.
 *
 * DOUBT LEAVES THE ROW WHERE IT IS. Every condition this file cannot decide — an unknown run state, a terminal
 * run with no readable close time — answers `null`, and `null` renders the row exactly as it rendered before
 * this field existed. A false `null` costs a row the fold; a false non-null would fold away a workspace a
 * programme still owns.
 */
import { TERMINAL_RUN_STATES, type ReleasedFrom, type RunState } from '../../../shared/api.js';

/** One session's NEWEST run as `sessionId`, as the store reads it. `state` is the raw column: a token outside
 *  this build's vocabulary is not terminal here, so it never releases anything. `closedAt` is epoch MS, `null`
 *  when the column is NULL or not a positive safe integer — both mean "no close time this build can show". */
export interface LastRun {
  readonly sessionId: string;
  readonly runId: number;
  readonly state: string;
  readonly program: string;
  readonly programTitle: string | null;
  readonly claimedBy: string | null;
  readonly closedAt: number | null;
}

/** What the run table says about ONE session: its newest run (absent when no run ever named it as
 *  `sessionId`), and whether a non-terminal run names it as a worker or as a claimant. */
export interface SessionRuns {
  readonly lastRun: LastRun | null;
  readonly openAsWorker: boolean;
  readonly openAsClaimant: boolean;
}

export type ReleasedLookup = (sessionId: string) => SessionRuns;

export interface ReleasedInput extends SessionRuns {
  /** `SessionRecord.workspace` — a main checkout (`null`) is never released. */
  readonly workspace: string | null;
  /** A hold of any reason keeps the workspace its programme's. */
  readonly held: boolean;
  /** An archived workspace belongs to the `Archived (N)` fold, never to this one. */
  readonly archived: boolean;
  /** The registry's CCR-15 child reading is `child` or `unreadable` (`ReleasedFrom.child`). */
  readonly child: boolean;
}

const isTerminal = (state: string): boolean => (TERMINAL_RUN_STATES as readonly RunState[]).includes(state as RunState);

/** The decision. Non-null only when ALL six hold (spec §5.1): a workspace, no hold, not archived, the newest run
 *  as `sessionId` terminal, no non-terminal run naming the session as `sessionId`, none naming it as `claimedBy`. */
export function releasedFrom(input: ReleasedInput): ReleasedFrom | null {
  const { lastRun } = input;
  if (input.workspace === null || input.held || input.archived) return null;
  if (lastRun === null || !isTerminal(lastRun.state) || lastRun.closedAt === null) return null;
  if (input.openAsWorker || input.openAsClaimant) return null;
  return {
    runId: lastRun.runId, program: lastRun.program, programTitle: lastRun.programTitle,
    claimedBy: lastRun.claimedBy, closedAt: lastRun.closedAt, child: input.child,
  };
}

/** Build the port from the store's three answers. A session the read never mentions answers "no runs": no newest
 *  run, open as nothing. */
export function foldLastRuns(
  last: readonly LastRun[], openWorkers: readonly string[], openClaimants: readonly string[],
): ReleasedLookup {
  const byId = new Map<string, LastRun>();
  for (const r of last) {
    const prev = byId.get(r.sessionId);
    // Newest by id, whatever order the rows arrived in — `foldCoordPlacements`' rule.
    if (prev === undefined || r.runId > prev.runId) byId.set(r.sessionId, r);
  }
  const workers = new Set(openWorkers);
  const claimants = new Set(openClaimants);
  return (sessionId) => ({
    lastRun: byId.get(sessionId) ?? null,
    openAsWorker: workers.has(sessionId),
    openAsClaimant: claimants.has(sessionId),
  });
}
