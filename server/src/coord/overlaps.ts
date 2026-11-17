// Overlord W2, overlaps (spec 2026-11-09 §5.5-5.6; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-overlaps.md,
// Tasks 1 and 2). Ring: L1, context Coordination (C5). PURE: no `fs`, no store, no clock; `now` is the caller's. It imports
// `shared/` (L0) and `./claims.ts#pathsOverlap` (L1) only.
//
// What this file decides, and for whom:
//   - `overlapSightings` and `goalConflictSightings` turn the facts the overlaps arm gathers (refused claims, radar
//     conflicts, the claims history) into SIGHTINGS of a pair of programmes. They store nothing.
//   - `pairMoves` is the ONE decider of a pair's episodes (question 8): which open, refresh or close this pass. The store
//     applies its answer and decides nothing.
//   - `pairBlocks` says whether one standing pair blocks one relay (question 7); `blockingPairs` is its ONLY non-test
//     caller, and the relay's verdict (`relayConflictVerdict`) and the operator's requests read both go through it, so the
//     two cannot disagree. The console imports nothing from `server/src`; it reads the answer off the wire.
//
// HONESTY RULES: a side the arm cannot attribute is counted `unattributed`, one whose bindings could not be read is counted
// `unread`; neither makes a pair and neither closes one. A fact that is `'unmeasured'` moves nothing for its key. A stored
// ruling or evidence the store could not read arrives as `'unreadable'` and fails CLOSED for the relay.
import { pathsOverlap } from './claims.js';
import {
  GOAL_CONFLICT_CHOICES, GOAL_CONFLICT_STEPS_MAX, GOAL_CONFLICT_TRIPLES_MIN, GOAL_CONFLICT_WINDOW_DAYS,
  HOT_PATH_PROGRAMMES, isPairClosedWhy, isPairKind, isPairSource, OVERLAP_LAPSE_HOURS, PAIR_PATHS_MAX, pairKeyOf, parsePairKey,
  type GoalConflictChoice, type PairClosedWhy, type PairEvidence, type PairKind, type PairSource,
} from '../../../shared/programmeFacts.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A side's programmes, as the arm attributed them. */
export type SideProgrammes = { readonly kind: 'programmes'; readonly slugs: readonly string[] }
  | { readonly kind: 'unattributed' } | { readonly kind: 'unread' };

export interface CollisionFact {
  project: string; path: string; claimedPath: string; holderClaimId: number;
  requester: SideProgrammes; holder: SideProgrammes; at: number;
}
export interface RadarConflictFact {
  project: string; prA: number; prB: number; paths: readonly string[]; pathsCut: boolean;
  sideA: SideProgrammes; sideB: SideProgrammes;
}
export interface ClaimHistoryRow {
  claimId: number; project: string; program: string | null; createdAt: number; paths: readonly string[];
}

/** `newestAt`: the newest evidence time (a collision's `at`, a triple's last `createdAt`, `now` for the radar). */
export interface PairSighting {
  key: string; kind: PairKind; a: string; b: string; evidence: PairEvidence; newestAt: number;
}
export interface SightingCounts { unattributed: number; unread: number }

const cmpStr = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
const cmpNum = (x: number, y: number): number => x - y;
const distinctSorted = <T extends string | number>(xs: readonly T[], cmp: (a: T, b: T) => number): T[] =>
  [...new Set(xs)].sort(cmp);

/** Merge evidence of one key, bounded: sources, claim ids and prs sorted and distinct; paths sorted and cut to
 *  `PAIR_PATHS_MAX` (`pathsCut` when more were seen or any part says cut); claim ids keep the NEWEST `PAIR_PATHS_MAX`;
 *  `triples` and `hotPaths` as the parts carry them. */
function mergeEvidence(parts: readonly PairEvidence[]): PairEvidence {
  const paths = distinctSorted(parts.flatMap((p) => p.paths), cmpStr);
  const ids = distinctSorted(parts.flatMap((p) => p.claimIds), cmpNum);
  const hot = distinctSorted(parts.flatMap((p) => p.hotPaths), cmpStr);
  return {
    sources: distinctSorted<PairSource>(parts.flatMap((p) => p.sources), cmpStr),
    paths: paths.slice(0, PAIR_PATHS_MAX),
    pathsCut: parts.some((p) => p.pathsCut) || paths.length > PAIR_PATHS_MAX,
    claimIds: ids.slice(Math.max(0, ids.length - PAIR_PATHS_MAX)),
    prs: distinctSorted(parts.flatMap((p) => p.prs), cmpNum),
    triples: parts.reduce((m, p) => Math.max(m, p.triples), 0),
    hotPaths: hot.slice(0, PAIR_PATHS_MAX),
  };
}

/** One key's sightings folded to one: evidence merged, `newestAt` the largest. The output is in key order. */
function foldSightings(list: readonly PairSighting[]): PairSighting[] {
  const byKey = new Map<string, PairSighting[]>();
  for (const s of list) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  return [...byKey.entries()].sort((x, y) => cmpStr(x[0], y[0])).map(([key, group]) => {
    const first = group[0]!;
    return {
      key, kind: first.kind, a: first.a, b: first.b,
      evidence: mergeEvidence(group.map((g) => g.evidence)),
      newestAt: group.reduce((m, g) => Math.max(m, g.newestAt), group[0]!.newestAt),
    };
  });
}

const evidenceOf = (o: Partial<PairEvidence>): PairEvidence => ({
  sources: [], paths: [], pathsCut: false, claimIds: [], prs: [], triples: 0, hotPaths: [], ...o,
});

/** Overlap sightings (question 4, 15). For each fact, in order: a side `unread` counts `unread`, else a side
 *  `unattributed` counts `unattributed` (one count a fact), and the fact sights nothing; two sides whose programme sets
 *  share a slug are one programme's own overlap and sight nothing; otherwise each pair (x from one side, y from the other)
 *  is sighted under `pairKeyOf('overlap', x, y)`. Sightings of one key merge their evidence. */
export function overlapSightings(
  collisions: readonly CollisionFact[], radar: readonly RadarConflictFact[], now: number,
): { sightings: readonly PairSighting[]; counts: SightingCounts } {
  const counts = { unattributed: 0, unread: 0 };
  const out: PairSighting[] = [];
  const one = (s1: SideProgrammes, s2: SideProgrammes, evidence: PairEvidence, at: number): void => {
    if (s1.kind === 'unread' || s2.kind === 'unread') { counts.unread++; return; }
    if (s1.kind === 'unattributed' || s2.kind === 'unattributed') { counts.unattributed++; return; }
    if (s1.slugs.length === 0 || s2.slugs.length === 0) { counts.unattributed++; return; }
    if (s1.slugs.some((x) => s2.slugs.includes(x))) return;
    for (const x of s1.slugs) {
      for (const y of s2.slugs) {
        const key = pairKeyOf('overlap', x, y);
        const p = parsePairKey(key);
        if (p === null) continue;
        out.push({ key, kind: 'overlap', a: p.a, b: p.b, evidence, newestAt: at });
      }
    }
  };
  for (const c of collisions) {
    one(c.requester, c.holder, evidenceOf({
      sources: ['claim-collision'], paths: distinctSorted([c.path, c.claimedPath], cmpStr), claimIds: [c.holderClaimId],
    }), c.at);
  }
  for (const r of radar) {
    one(r.sideA, r.sideB, evidenceOf({
      sources: ['radar'], paths: distinctSorted(r.paths, cmpStr), pathsCut: r.pathsCut,
      prs: distinctSorted([r.prA, r.prB], cmpNum),
    }), now);
  }
  return { sightings: foldSightings(out), counts };
}

interface GRow { idx: number; claimId: number; program: string; createdAt: number; paths: readonly string[]; all: readonly string[] }
interface Triple { r1: GRow; r2: GRow; r3: GRow }

/** The strict ancestors of a normalized path: `a/b/c` gives `a`, `a/b`. */
function ancestorsOf(p: string): string[] {
  const parts = p.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    if (prefix !== '') out.push(prefix);
  }
  return out;
}

/** Goal-conflict sightings (question 5, the coordinator's ruling on F3). A TRIPLE of (A, B) is rows r1, r2, r3 of one
 *  project with r1.createdAt < r2.createdAt < r3.createdAt, programmes A, B, A, r3 within `GOAL_CONFLICT_WINDOW_DAYS` of
 *  r1, and every two of them sharing a pair of overlapping non-hot paths (`pathsOverlap`). A path that
 *  `HOT_PATH_PROGRAMMES` or more programmes named in the window is hot and set aside. A SIGHTING is two triples of the same
 *  (A, B), the second starting at or after the first one's close. Greedy on the earliest close is exact for that, so T1
 *  is the earliest-closing triple and T2 the LATEST-closing triple that starts at or after T1's close (so `newestAt`
 *  follows the newest evidence). Rows outside the window, and rows with no programme (counted `unattributed`), are left
 *  out. Cost: an index finds a row's overlapping rows without comparing every pair, and every comparison spends one step;
 *  at `stepsMax` (default `GOAL_CONFLICT_STEPS_MAX`) the decider stops, keeps what it found and answers `cut: true`, which
 *  can only miss pairs. `stepsMax` exists so a test can reach the cut cheaply; the arm passes none. */
export function goalConflictSightings(
  history: readonly ClaimHistoryRow[], now: number, stepsMax: number = GOAL_CONFLICT_STEPS_MAX,
): { sightings: readonly PairSighting[]; counts: SightingCounts; cut: boolean } {
  const counts = { unattributed: 0, unread: 0 };
  const windowMs = GOAL_CONFLICT_WINDOW_DAYS * DAY_MS;
  // r3 within the window of r1 needs no test of its own: every row read lies in [now - window, now], so any two are within it.
  let steps = 0;
  let cut = false;
  /** One unit of work; false, and `cut`, once the budget is spent. */
  const spend = (): boolean => {
    if (steps >= stepsMax) { cut = true; return false; }
    steps++;
    return true;
  };

  const inWindow = history.filter((r) => r.createdAt >= now - windowMs && r.createdAt <= now);
  const byProject = new Map<string, ClaimHistoryRow[]>();
  for (const r of inWindow) {
    if (r.program === null) { counts.unattributed++; continue; }
    byProject.set(r.project, [...(byProject.get(r.project) ?? []), r]);
  }

  const found: PairSighting[] = [];
  for (const project of [...byProject.keys()].sort(cmpStr)) {
    if (cut) break;
    const rowsIn = byProject.get(project)!;
    // Step 2: hot paths, counted over every attributed row of the project, stripped from each row.
    const programmesOf = new Map<string, Set<string>>();
    for (const r of rowsIn) for (const p of r.paths) {
      const set = programmesOf.get(p) ?? new Set<string>();
      set.add(r.program!);
      programmesOf.set(p, set);
    }
    const hot = new Set<string>();
    for (const [p, set] of programmesOf) if (set.size >= HOT_PATH_PROGRAMMES) hot.add(p);
    const rows: GRow[] = rowsIn
      .map((r) => ({ r, paths: distinctSorted(r.paths.filter((p) => !hot.has(p)), cmpStr) }))
      .filter((x) => x.paths.length > 0)
      .sort((x, y) => x.r.createdAt - y.r.createdAt || x.r.claimId - y.r.claimId)
      .map((x, idx) => ({ idx, claimId: x.r.claimId, program: x.r.program!, createdAt: x.r.createdAt, paths: x.paths, all: x.r.paths }));

    // Step 3: index each path, and each directory above it, to the rows holding it.
    interface Entry { row: number; path: string }
    const exact = new Map<string, Entry[]>();
    const under = new Map<string, Entry[]>();
    const push = (m: Map<string, Entry[]>, k: string, e: Entry): void => { const l = m.get(k); if (l) l.push(e); else m.set(k, [e]); };
    for (const r of rows) for (const p of r.paths) {
      push(exact, p, { row: r.idx, path: p });
      for (const anc of ancestorsOf(p)) push(under, anc, { row: r.idx, path: p });
    }
    const nbSet: Set<number>[] = rows.map(() => new Set<number>());
    build: for (const r of rows) {
      for (const p of r.paths) {
        const candidates: Entry[] = [...(exact.get(p) ?? []), ...(under.get(p) ?? [])];
        for (const anc of ancestorsOf(p)) candidates.push(...(exact.get(anc) ?? []));
        for (const e of candidates) {
          if (e.row >= r.idx) continue;               // each pair once; both directions are filled below
          if (!spend()) break build;
          if (pathsOverlap(p, e.path)) { nbSet[r.idx]!.add(e.row); nbSet[e.row]!.add(r.idx); }
        }
      }
    }
    const nb = nbSet.map((s) => [...s].sort(cmpNum));

    // Steps 4-5: per row b, the rows of each other programme A around it.
    interface Around { L: GRow[]; R: GRow[] }
    const aroundOf = (b: GRow): Map<string, Around> => {
      const m = new Map<string, Around>();
      for (const j of nb[b.idx]!) {
        const a = rows[j]!;
        if (a.program === b.program) continue;
        const e = m.get(a.program) ?? { L: [], R: [] };
        if (a.createdAt < b.createdAt) e.L.push(a);
        else if (a.createdAt > b.createdAt) e.R.push(a);
        m.set(a.program, e);
      }
      return m;
    };
    const ordered = (t: Triple): number[] => [t.r3.createdAt, t.r3.idx, t.r2.idx, t.r1.idx];
    const cmpTuple = (x: number[], y: number[]): number => { for (let i = 0; i < x.length; i++) { const d = x[i]! - y[i]!; if (d !== 0) return d; } return 0; };

    /** T2's order: the later close wins, then the lower row indices, so the choice is the same whatever the input order. */
    const laterClose = (t: Triple, best: Triple): boolean =>
      t.r3.createdAt !== best.r3.createdAt ? t.r3.createdAt > best.r3.createdAt : cmpTuple(ordered(t), ordered(best)) < 0;
    const first = new Map<string, Triple>();                      // `${A}\0${B}` -> T1
    scan1: for (const b of rows) {
      for (const [A, { L, R }] of aroundOf(b)) {
        const key = `${A}\0${b.program}`;
        for (const a3 of R) {
          const best = first.get(key);
          if (best !== undefined && a3.createdAt > best.r3.createdAt) break;
          let hit: GRow | null = null;
          for (const a1 of L) {
            if (!spend()) break scan1;
            if (nbSet[a3.idx]!.has(a1.idx)) { hit = a1; break; }
          }
          if (hit === null) continue;
          const t: Triple = { r1: hit, r2: b, r3: a3 };
          if (best === undefined || cmpTuple(ordered(t), ordered(best)) < 0) first.set(key, t);
          break;
        }
      }
    }
    const second = new Map<string, Triple>();
    if (!cut) {
      scan2: for (const b of rows) {
        for (const [A, { L, R }] of aroundOf(b)) {
          const key = `${A}\0${b.program}`;
          const t1 = first.get(key);
          if (t1 === undefined) continue;
          const start = L.filter((a1) => a1.createdAt >= t1.r3.createdAt);
          if (start.length === 0) continue;
          for (let k = R.length - 1; k >= 0; k--) {
            const a3 = R[k]!;
            const best = second.get(key);
            if (best !== undefined && a3.createdAt < best.r3.createdAt) break;
            let hit: GRow | null = null;
            for (const a1 of start) {
              if (!spend()) break scan2;
              if (nbSet[a3.idx]!.has(a1.idx)) { hit = a1; break; }
            }
            if (hit === null) continue;
            const t: Triple = { r1: hit, r2: b, r3: a3 };
            if (best === undefined || laterClose(t, best)) second.set(key, t);
          }
        }
      }
    }

    for (const [key, t1] of first) {
      const t2 = second.get(key);
      if (t2 === undefined) continue;
      const [A, B] = key.split('\0') as [string, string];
      const pairKey = pairKeyOf('goal-conflict', A, B);
      const p = parsePairKey(pairKey);
      if (p === null) continue;
      const trio = [t1, t2].flatMap((t) => [t.r1, t.r2, t.r3]);
      const overlapping = new Set<string>();
      for (const t of [t1, t2]) {
        const three = [t.r1, t.r2, t.r3];
        for (let i = 0; i < three.length; i++) for (let j = 0; j < three.length; j++) {
          if (i === j) continue;
          for (const x of three[i]!.paths) for (const y of three[j]!.paths) if (pathsOverlap(x, y)) overlapping.add(x);
        }
      }
      const sortedPaths = [...overlapping].sort(cmpStr);
      const hotNamed = distinctSorted(trio.flatMap((r) => r.all.filter((q) => hot.has(q))), cmpStr);
      found.push({
        key: pairKey, kind: 'goal-conflict', a: p.a, b: p.b, newestAt: t2.r3.createdAt,
        evidence: evidenceOf({
          sources: ['claim-history'], paths: sortedPaths.slice(0, PAIR_PATHS_MAX), pathsCut: sortedPaths.length > PAIR_PATHS_MAX,
          claimIds: distinctSorted(trio.map((r) => r.claimId), cmpNum).slice(-PAIR_PATHS_MAX),
          triples: GOAL_CONFLICT_TRIPLES_MIN, hotPaths: hotNamed.slice(0, PAIR_PATHS_MAX),
        }),
      });
    }
  }
  return { sightings: foldSightings(found), counts, cut };
}

// ---------------------------------------------------------------------------------------------------------------------
// Task 2: the episode moves, the relay's verdict and pairBlocks.

/** A standing row as the store reads it: every word re-read through its guard. */
export interface StandingPairRow {
  id: number; key: string; kind: PairKind; a: string; b: string; episode: number;
  firstSeenAt: number; lastSeenAt: number; evidence: PairEvidence | 'unreadable';
  goalsA: string | null; goalsB: string | null;   // goal-conflict: the stamps of the goals last seen, or ruled on
  ruled: { choice: GoalConflictChoice; at: number; by: string } | 'unreadable' | null;
}
export type Fact<T> = T | 'unmeasured';
export interface MoveFacts {
  now: number;
  live: (slug: string) => Fact<boolean>;         // CoordStore#programmeLive
  hasOpenRun: (slug: string) => Fact<boolean>;      // CoordStore#programmeHasOpenRun
  goalsStamp: (slug: string) => Fact<string>;    // programmePairsStore.ts#goalsStamp: a digest of what is ruled on
  /** False when a source of overlap sightings (collisions, a radar project, radar sides) failed: no overlap lapses then. */
  overlapSourcesRead: boolean;
  /** False when the claims history read failed: no goal conflict lapses then. */
  goalHistoryRead: boolean;
}
export interface PairMoves {
  open: readonly { sighting: PairSighting; episode: number; goalsA: string | null; goalsB: string | null }[];
  refresh: readonly { id: number; lastSeenAt: number; evidence: PairEvidence; goalsA?: string; goalsB?: string }[];
  close: readonly { id: number; why: PairClosedWhy }[];
}

/** The episode moves (question 8, Table 2), first match per key. `newestEpisode` is the highest episode the table holds
 *  for each key, closed ones included. A goal-conflict key's two programmes are read for every key, with or without a
 *  standing row (the review's F1). A refresh sets `lastSeenAt` to the larger of the row's and the sighting's `newestAt`,
 *  never to `now` (F11 a). A `ruled` of `'unreadable'` counts as ruled, and as a ruling no newer sighting can undo. A ruled
 *  row whose stored stamps are null reads as unmeasured at rule 7: it is left alone. */
export function pairMoves(
  standing: readonly StandingPairRow[], sightings: readonly PairSighting[],
  newestEpisode: ReadonlyMap<string, number>, facts: MoveFacts,
): PairMoves {
  const open: PairMoves['open'][number][] = [];
  const refresh: PairMoves['refresh'][number][] = [];
  const close: PairMoves['close'][number][] = [];

  const rowOf = new Map<string, StandingPairRow>();
  for (const r of standing) {
    const have = rowOf.get(r.key);
    if (have === undefined || r.episode > have.episode) rowOf.set(r.key, r);
  }
  const sightOf = new Map<string, PairSighting>(sightings.map((s) => [s.key, s] as const));
  const keys = distinctSorted([...rowOf.keys(), ...sightOf.keys()], cmpStr);

  for (const key of keys) {
    const row = rowOf.get(key);
    const sight = sightOf.get(key);
    const parsed = parsePairKey(key);
    if (parsed === null) continue;
    const nextEpisode = Math.max(newestEpisode.get(key) ?? 0, row?.episode ?? 0) + 1;
    const merged = (): PairEvidence | null => {
      if (sight === undefined) return null;
      return row !== undefined && row.evidence !== 'unreadable'
        ? mergeEvidence([row.evidence, sight.evidence]) : mergeEvidence([sight.evidence]);
    };
    const seenAt = (): number => Math.max(row?.lastSeenAt ?? 0, sight?.newestAt ?? 0);

    if (parsed.kind === 'overlap') {
      if (sight !== undefined && row === undefined) {
        open.push({ sighting: sight, episode: nextEpisode, goalsA: null, goalsB: null });                    // rule 5
      } else if (sight !== undefined && row !== undefined) {
        refresh.push({ id: row.id, lastSeenAt: seenAt(), evidence: merged()! });                              // rule 10
      } else if (row !== undefined && facts.overlapSourcesRead
        && facts.now - row.lastSeenAt >= OVERLAP_LAPSE_HOURS * HOUR_MS) {
        close.push({ id: row.id, why: 'lapsed' });                                                            // rule 11
      }
      continue;
    }

    // goal-conflict
    const liveA = facts.live(parsed.a);
    const liveB = facts.live(parsed.b);
    if (liveA === 'unmeasured' || liveB === 'unmeasured') continue;                                           // rule 1
    if (!liveA || !liveB) {
      if (row !== undefined) close.push({ id: row.id, why: 'programme-ended' });                              // rule 2
      continue;                                                                                               // rule 3
    }
    if (row === undefined) {
      if (sight === undefined) continue;
      const sa = facts.goalsStamp(parsed.a);
      const sb = facts.goalsStamp(parsed.b);
      if (sa === 'unmeasured' || sb === 'unmeasured') continue;                                               // rule 4
      open.push({ sighting: sight, episode: nextEpisode, goalsA: sa, goalsB: sb });                           // rule 5
      continue;
    }
    if (sight === undefined) {
      if (row.ruled === null && facts.goalHistoryRead
        && facts.now - row.lastSeenAt >= GOAL_CONFLICT_WINDOW_DAYS * DAY_MS
        && facts.hasOpenRun(parsed.a) === false && facts.hasOpenRun(parsed.b) === false) {
        close.push({ id: row.id, why: 'lapsed' });                                                            // rule 12
      }
      continue;                                                                                               // rule 13
    }
    if (row.ruled === null) {
      const sa = facts.goalsStamp(parsed.a);
      const sb = facts.goalsStamp(parsed.b);
      if (sa === 'unmeasured' || sb === 'unmeasured') {
        refresh.push({ id: row.id, lastSeenAt: seenAt(), evidence: merged()! });                              // rule 8
      } else {
        refresh.push({ id: row.id, lastSeenAt: seenAt(), evidence: merged()!, goalsA: sa, goalsB: sb });      // rule 9
      }
      continue;
    }
    const newerThanRuling = row.ruled !== 'unreadable' && sight.newestAt > row.ruled.at;
    if (newerThanRuling) {
      const sa = facts.goalsStamp(parsed.a);
      const sb = facts.goalsStamp(parsed.b);
      if (sa === 'unmeasured' || sb === 'unmeasured' || row.goalsA === null || row.goalsB === null) continue; // rule 6
      if (sa !== row.goalsA || sb !== row.goalsB) {
        close.push({ id: row.id, why: 'goals-changed' });                                                     // rule 7
        open.push({ sighting: sight, episode: nextEpisode, goalsA: sa, goalsB: sb });
        continue;
      }
    }
    refresh.push({ id: row.id, lastSeenAt: seenAt(), evidence: merged()! });                                  // rule 10
  }
  return { open, refresh, close };
}

export interface RelayFacts { target: string; expectedPaths: readonly string[] }

/** Question 7: the pair is a goal conflict, the relay's target is one of its programmes, the evidence is `unreadable`
 *  (fail closed) or shows at least `GOAL_CONFLICT_TRIPLES_MIN` triples (question 5: the refusal reads only pairs that
 *  pass the stricter signal, whatever build wrote the row), and either `expectedPaths` is empty (the relay cannot show it
 *  does not deepen), or the evidence is unreadable or cut, or an expected path overlaps an evidence path. Reached only
 *  through `blockingPairs`. */
export function pairBlocks(pair: StandingPairRow, relay: RelayFacts): boolean {
  if (pair.kind !== 'goal-conflict') return false;
  if (relay.target !== pair.a && relay.target !== pair.b) return false;
  const ev = pair.evidence;
  if (ev !== 'unreadable' && ev.triples < GOAL_CONFLICT_TRIPLES_MIN) return false;
  if (relay.expectedPaths.length === 0) return true;
  if (ev === 'unreadable' || ev.pathsCut) return true;
  return relay.expectedPaths.some((x) => ev.paths.some((y) => pathsOverlap(x, y)));
}

/** The one reader of `pairBlocks`: the relay's verdict and the requests read's `blockedBy` both go through it. The rows
 *  come back in key order (then episode). */
export function blockingPairs(standing: readonly StandingPairRow[], relay: RelayFacts): readonly StandingPairRow[] {
  return standing.filter((p) => pairBlocks(p, relay)).sort((x, y) => cmpStr(x.key, y.key) || x.episode - y.episode);
}

/** Why the relay's verdict refuses (Table 3): one table, so the type and the guard below derive from it. */
export const RELAY_CONFLICT_WHY_MAP = {
  unruled: true, 'ruling-unreadable': true, 'waits-for-landing': true, 'landing-unmeasured': true,
} as const satisfies Record<string, true>;
export type RelayConflictWhy = keyof typeof RELAY_CONFLICT_WHY_MAP;
export type RelayConflictVerdict = { ok: true }
  | { ok: false; word: 'goal-conflict-open'; key: string; episode: number; why: RelayConflictWhy };

/** Every kebab word this context spells: a pair's kind, source and close, the relay's refusal word and its reasons. For
 *  `mail-routes.test.ts`'s scan, which admits it through this guard; none is a mail rejection or a run refusal. */
export const isOverlapsKebab = (tok: string): boolean => isPairKind(tok) || isPairSource(tok) || isPairClosedWhy(tok)
  || tok === 'goal-conflict-open' || Object.hasOwn(RELAY_CONFLICT_WHY_MAP, tok);

/** The relay's verdict (Table 3, question 1), over `blockingPairs`, first refusal wins. A pair the relay does not deepen is
 *  never consulted. Only the `waits` column of the choice table is read; a choice word outside the table fails closed as
 *  `ruling-unreadable`. `landedSince(other, ruledAt)` is the other programme's next landing after the ruling. */
export function relayConflictVerdict(
  standing: readonly StandingPairRow[], relay: RelayFacts, landedSince: (program: string, at: number) => Fact<boolean>,
): RelayConflictVerdict {
  for (const pair of blockingPairs(standing, relay)) {
    const refuse = (why: RelayConflictWhy): RelayConflictVerdict =>
      ({ ok: false, word: 'goal-conflict-open', key: pair.key, episode: pair.episode, why });
    const ruled = pair.ruled;
    if (ruled === null) return refuse('unruled');
    if (ruled === 'unreadable' || !Object.hasOwn(GOAL_CONFLICT_CHOICES, ruled.choice)) return refuse('ruling-unreadable');
    const waits = GOAL_CONFLICT_CHOICES[ruled.choice].waits;     // `none` equals neither side, so it passes below
    const targetSide = relay.target === pair.a ? 'a' : 'b';
    if (waits !== targetSide) continue;
    const other = targetSide === 'a' ? pair.b : pair.a;
    const landed = landedSince(other, ruled.at);
    if (landed === true) continue;
    return refuse(landed === false ? 'waits-for-landing' : 'landing-unmeasured');
  }
  return { ok: true };
}
