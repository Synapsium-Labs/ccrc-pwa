// Overlord W2, overlaps and goal conflicts (spec 2026-11-09 §5.5 H23, §5.6 H38; Table 11.1c, row "the overlaps arm"; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-overlaps.md, Task 4, questions 4, 5, 8, 15 and 20). Ring: L4 delivery,
// context Coordination (C5). The overlaps arm's one pass: it GATHERS (the standing pairs, the refused claims' collisions,
// the radar's conflicts with each side's programmes, the claims history), ASKS `overlaps.ts`'s deciders and APPLIES their
// answer through `applyPairMoves`. It decides nothing, and in PR A it sends nothing: no mail, no push, no feed row.
//
// UNREAD IS NEVER "NO PAIR". A read the pass cannot make records nothing it would need (`unread` names the first), warns
// once that pass with its detail, and keeps every lapse that needed it from firing: a failed collisions read, a radar side
// whose bindings failed, or a radar project that was not read sets `overlapSourcesRead` false, so no overlap lapses that
// pass; a failed history read sets `goalHistoryRead` false, so no goal conflict lapses. A fact the moves need that throws
// (a programme's plan end, an open run, a goals stamp) answers `unmeasured`, which moves nothing for that pair.
import type { SessionLanding } from '../../../shared/api.js';
import {
  CLAIM_HISTORY_ROWS_MAX, GOAL_CONFLICT_WINDOW_DAYS, OVERLAP_LAPSE_HOURS,
} from '../../../shared/programmeFacts.js';
import {
  goalConflictSightings, overlapSightings, pairMoves,
  type CollisionFact, type Fact, type PairSighting, type RadarConflictFact, type SideProgrammes,
} from './overlaps.js';
import type { WatcherCoordPort } from './ports.js';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The store members the pass reaches, declared by this consumer, so a test can hand a small fake. */
export type OverlapsCoord = Pick<WatcherCoordPort, 'collisionsSince' | 'claimHistory' | 'standingPairs'
  | 'newestEpisodes' | 'applyPairMoves' | 'programmeLive' | 'programmeHasOpenRun' | 'goalsStamp' | 'bindingsOf'>;
export interface OverlapsPassDeps {
  readonly coord: OverlapsCoord;
  readonly now: () => number;
  /** The radar's map, keyed by session id (`FleetWatcher#currentLandings`). */
  readonly landings: () => ReadonlyMap<string, SessionLanding>;
  /** A session's project from the tick's registry listing (measured evidence only), or null. */
  readonly projectOf: (id: string) => string | null;
  /** The projects whose last radar read failed, or 'listing' when the radar could not list at all (the review's F11 b). */
  readonly radarUnread: () => ReadonlySet<string> | 'listing';
}
export type OverlapsUnread = 'collisions' | 'history' | 'pairs' | 'sides' | 'radar';
export interface OverlapsPassResult {
  readonly opened: number; readonly refreshed: number; readonly closed: number;
  readonly unattributed: number; readonly unread: OverlapsUnread | null;
  readonly historyCut: boolean; readonly signalCut: boolean;
}

/** A fact read that throws answers `unmeasured`, never a guessed value. */
const measured = <T>(read: () => T): Fact<T> => { try { return read(); } catch { return 'unmeasured'; } };
/** One claim's side: its run's programme, or `unattributed` with no run (question 5's rule for claims). */
const claimSide = (program: string | null): SideProgrammes =>
  (program === null ? { kind: 'unattributed' } : { kind: 'programmes', slugs: [program] });

/** A radar side's programmes (question 15): its open runs as worker and as coordinator. A failed read is `unread`. */
function sessionSide(coord: OverlapsCoord, id: string): SideProgrammes {
  try {
    const b = coord.bindingsOf(id);
    const w = b.worker();
    const c = b.claimant();
    if (!w.ok || !c.ok) return { kind: 'unread' };
    const slugs = [...new Set([...w.siblings, ...c.siblings].map((r) => r.program))].sort();
    return slugs.length === 0 ? { kind: 'unattributed' } : { kind: 'programmes', slugs };
  } catch {
    return { kind: 'unread' };
  }
}

/**
 * The radar facts (question 15): for each session S and each conflict of its landing, the other side is the ONE session of
 * S's project whose landing names that pull request. None or several leave the conflict out, counted `unattributed`; a
 * session with no measured project too. Each pair of pull requests of one project is taken once.
 */
function radarFacts(deps: OverlapsPassDeps): { facts: RadarConflictFact[]; unattributed: number } {
  const landings = deps.landings();
  const byPr = new Map<string, string[]>(); // `<project>\n<pr>` -> session ids
  for (const [id, l] of landings) {
    const project = deps.projectOf(id);
    if (project === null) continue;
    const k = `${project}\n${l.pr}`;
    byPr.set(k, [...(byPr.get(k) ?? []), id]);
  }
  const sides = new Map<string, SideProgrammes>();
  const sideOf = (id: string): SideProgrammes => {
    const s = sides.get(id) ?? sessionSide(deps.coord, id);
    sides.set(id, s);
    return s;
  };
  const facts: RadarConflictFact[] = [];
  const taken = new Set<string>();
  let unattributed = 0;
  for (const [id, l] of landings) {
    const project = deps.projectOf(id);
    for (const c of l.conflicts) {
      const others = project === null ? [] : byPr.get(`${project}\n${c.pr}`) ?? [];
      if (others.length !== 1) { unattributed += 1; continue; }
      const [prA, prB] = l.pr < c.pr ? [l.pr, c.pr] : [c.pr, l.pr];
      const key = `${project}\n${prA}\n${prB}`;
      if (taken.has(key)) continue;
      taken.add(key);
      const [idA, idB] = l.pr < c.pr ? [id, others[0]!] : [others[0]!, id];
      facts.push({ project: project!, prA, prB, paths: c.paths, pathsCut: c.pathsCut, sideA: sideOf(idA), sideB: sideOf(idB) });
    }
  }
  return { facts, unattributed };
}

/**
 * One pass, in the plan's order: the standing pairs and newest episodes; the collisions of the last `OVERLAP_LAPSE_HOURS`;
 * the radar facts; the claims history of the last `GOAL_CONFLICT_WINDOW_DAYS` days, newest first; the two sighting
 * deciders; the episode moves; and one apply. A thrown apply rejects the pass, and the lane row's warnKey reports it.
 */
export async function overlapsPass(deps: OverlapsPassDeps): Promise<OverlapsPassResult> {
  const { coord } = deps;
  const now = deps.now();
  const standing = coord.standingPairs();
  const newest = coord.newestEpisodes();
  if (!standing.ok || !newest.ok) {
    console.warn(`ccrc-server: overlaps: pairs read failed: ${!standing.ok ? standing.detail : !newest.ok ? newest.detail : ''}`);
    return { opened: 0, refreshed: 0, closed: 0, unattributed: 0, unread: 'pairs', historyCut: false, signalCut: false };
  }
  const warnings: string[] = [];
  let unread: OverlapsUnread | null = null;
  const unreadAs = (w: OverlapsUnread, detail: string): void => { unread ??= w; warnings.push(`${w} read failed: ${detail}`); };

  const collisions: CollisionFact[] = [];
  const col = coord.collisionsSince(now - OVERLAP_LAPSE_HOURS * HOUR_MS);
  if (!col.ok) unreadAs('collisions', col.detail);
  else {
    for (const r of col.rows) {
      collisions.push({ project: r.project, path: r.path, claimedPath: r.claimedPath, holderClaimId: r.holderClaimId,
        requester: claimSide(r.requesterProgram), holder: claimSide(r.holderProgram), at: r.at });
    }
  }
  const radar = radarFacts(deps);
  const overlaps = overlapSightings(collisions, radar.facts, now);
  if (overlaps.counts.unread > 0) unreadAs('sides', `${overlaps.counts.unread} radar side(s) whose bindings could not be read`);
  const radarUnread = deps.radarUnread();
  if (radarUnread === 'listing' || radarUnread.size > 0) {
    unreadAs('radar', radarUnread === 'listing' ? 'the radar could not list' : `not read: ${[...radarUnread].sort().join(', ')}`);
  }
  const overlapSourcesRead = col.ok && overlaps.counts.unread === 0 && radarUnread !== 'listing' && radarUnread.size === 0;

  let goals: PairSighting[] = [];
  let historyCut = false;
  let signalCut = false;
  let goalUnattributed = 0;
  const history = coord.claimHistory(now - GOAL_CONFLICT_WINDOW_DAYS * DAY_MS, CLAIM_HISTORY_ROWS_MAX);
  if (!history.ok) unreadAs('history', history.detail);
  else {
    historyCut = history.cut;
    if (historyCut) warnings.push(`the claims history is cut at ${CLAIM_HISTORY_ROWS_MAX} rows; the oldest are left out`);
    const g = goalConflictSightings(history.rows, now);
    goals = [...g.sightings];
    goalUnattributed = g.counts.unattributed;
    signalCut = g.cut;
    if (signalCut) warnings.push('the goal-conflict signal stopped at its step bound; some pairs may be missed');
  }

  const moves = pairMoves(standing.rows, [...overlaps.sightings, ...goals], newest.episodes, {
    now,
    live: (slug) => measured(() => coord.programmeLive(slug)),
    hasOpenRun: (slug) => measured(() => coord.programmeHasOpenRun(slug)),
    goalsStamp: (slug) => measured(() => coord.goalsStamp(slug)),
    overlapSourcesRead,
    goalHistoryRead: history.ok,
  });
  for (const w of warnings) console.warn(`ccrc-server: overlaps: ${w}`);
  coord.applyPairMoves(moves, now);
  return {
    opened: moves.open.length, refreshed: moves.refresh.length, closed: moves.close.length,
    unattributed: overlaps.counts.unattributed + radar.unattributed + goalUnattributed,
    unread, historyCut, signalCut,
  };
}
