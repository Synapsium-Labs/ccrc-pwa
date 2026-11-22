// Overlord W2, overlaps and goal conflicts (spec 2026-11-09 §5.5, H23 and §5.6, H38; Table 11.1a, row `programme_pairs`;
// plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-overlaps.md, Task 3, questions 5, 8 and 14). Ring: L3, context
// Coordination (C5). SQL only: every function is synchronous over the store's own database handle, and `CoordStore` keeps a
// one-line delegate for each. No repository and no async wrapper.
//
// ONE WRITER EACH (`single-definition/writers-map.test.ts` pins the table):
// - `programme_pairs`' rows and their sighting columns: `applyPairMoves`, called only by the overlaps arm. It applies
//   `overlaps.ts#pairMoves`' answer and decides nothing: a close of a row that no longer stands, a refresh of one, or an
//   open the standing index refuses throws and rolls the whole pass back.
// - `goalsA` and `goalsB`: `stampPairGoalsInTx`, inside its caller's transaction, called by `applyPairMoves` (an open, and
//   an unruled refresh) and, from PR B, by the ruling's own stamp. One function writes the columns, so two callers cannot
//   disagree on how a stamp is written.
// `mailedAt` and `ruled`/`ruledAt`/`ruledBy` are PR B's (Tasks 5 and 7): this file writes none of them.
//
// THE READS keep every distinction they read. A stored `kind` outside `PAIR_KIND_MAP` is listed apart, never read as a
// known kind; an `evidence` that does not parse to the shape reads `'unreadable'`; a `ruled` word outside
// `GOAL_CONFLICT_CHOICES`, or a ruling with no time or actor, reads `'unreadable'`, which refuses a relay (fail closed). A
// throw is `{ ok: false, detail }`, never an empty list.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RunState } from '../../../shared/api.js';
import {
  isGoalConflictChoice, isPairKind, isPairSource, parsePairKey, type PairEvidence,
} from '../../../shared/programmeFacts.js';
import { goalsFor } from './ledgersStore.js';
import type { ClaimHistoryRow, Fact, PairMoves, StandingPairRow } from './overlaps.js';
import { tx } from './tx.js';

/** A standing row whose stored `kind` this build does not know (a newer build's), or whose key does not parse. */
export interface UnreadablePairRow { readonly id: number; readonly key: string; readonly why: 'kind' | 'key' }
export type StandingPairsRead =
  | { ok: true; rows: readonly StandingPairRow[]; unreadable: readonly UnreadablePairRow[] }
  | { ok: false; detail: string };
export type NewestEpisodesRead = { ok: true; episodes: ReadonlyMap<string, number> } | { ok: false; detail: string };
export type ClaimHistoryRead = { ok: true; rows: readonly ClaimHistoryRow[]; cut: boolean } | { ok: false; detail: string };

const detailOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The one writer of the two stamp columns, inside its caller's transaction. Throws when the row does not stand. */
export function stampPairGoalsInTx(db: DatabaseSync, id: number, goalsA: string | null, goalsB: string | null): void {
  const r = db.prepare('UPDATE programme_pairs SET goalsA = ?, goalsB = ? WHERE id = ? AND closedAt IS NULL').run(goalsA, goalsB, id);
  if (Number(r.changes) !== 1) throw new Error(`programme_pairs: row ${id} does not stand, its goals were not stamped`);
}

/**
 * Applies one pass's moves in ONE transaction: closes, then refreshes, then opens, so rule 7's close and open land together.
 * Answers the ids it opened. Throws (and rolls the pass back) on a move the table no longer agrees with.
 */
export function applyPairMoves(db: DatabaseSync, moves: PairMoves, now: number): number[] {
  return tx(db, () => {
    const close = db.prepare('UPDATE programme_pairs SET closedAt = ?, closedWhy = ? WHERE id = ? AND closedAt IS NULL');
    for (const c of moves.close) {
      if (Number(close.run(now, c.why, c.id).changes) !== 1) throw new Error(`programme_pairs: row ${c.id} does not stand, not closed`);
    }
    const refresh = db.prepare('UPDATE programme_pairs SET lastSeenAt = ?, evidence = ? WHERE id = ? AND closedAt IS NULL');
    for (const r of moves.refresh) {
      if (Number(refresh.run(r.lastSeenAt, JSON.stringify(r.evidence), r.id).changes) !== 1) {
        throw new Error(`programme_pairs: row ${r.id} does not stand, not refreshed`);
      }
      if (r.goalsA !== undefined && r.goalsB !== undefined) stampPairGoalsInTx(db, r.id, r.goalsA, r.goalsB);
    }
    const open = db.prepare('INSERT INTO programme_pairs (pairKey, kind, progA, progB, episode, firstSeenAt, lastSeenAt, evidence) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const opened: number[] = [];
    for (const o of moves.open) {
      const s = o.sighting;
      const id = Number(open.run(s.key, s.kind, s.a, s.b, o.episode, now, s.newestAt, JSON.stringify(s.evidence)).lastInsertRowid);
      stampPairGoalsInTx(db, id, o.goalsA, o.goalsB);
      opened.push(id);
    }
    return opened;
  });
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isInts = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isSafeInteger(x));

/** A stored evidence, re-read through its shape: anything else is `'unreadable'`, never a partial evidence. */
export function readEvidence(text: string): PairEvidence | 'unreadable' {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return 'unreadable'; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'unreadable';
  const e = v as Record<string, unknown>;
  if (!Array.isArray(e['sources']) || !e['sources'].every(isPairSource)) return 'unreadable';
  if (!isStrings(e['paths']) || typeof e['pathsCut'] !== 'boolean' || !isInts(e['claimIds']) || !isInts(e['prs'])) return 'unreadable';
  if (!Number.isSafeInteger(e['triples']) || !isStrings(e['hotPaths'])) return 'unreadable';
  return {
    sources: e['sources'], paths: e['paths'], pathsCut: e['pathsCut'], claimIds: e['claimIds'], prs: e['prs'],
    triples: e['triples'] as number, hotPaths: e['hotPaths'],
  };
}

interface PairDbRow {
  id: number; pairKey: string; kind: string; progA: string; progB: string; episode: number; firstSeenAt: number;
  lastSeenAt: number; evidence: string; goalsA: string | null; goalsB: string | null; ruled: string | null;
  ruledAt: number | null; ruledBy: string | null;
}

function rulingOf(r: PairDbRow): StandingPairRow['ruled'] {
  if (r.ruled === null && r.ruledAt === null && r.ruledBy === null) return null;
  if (r.ruled === null || !isGoalConflictChoice(r.ruled) || r.ruledAt === null || r.ruledBy === null) return 'unreadable';
  return { choice: r.ruled, at: r.ruledAt, by: r.ruledBy };
}

/** Every standing episode in `pairKey` order, each word re-read through its guard. */
export function standingPairs(db: DatabaseSync): StandingPairsRead {
  try {
    const raw = db.prepare('SELECT id, pairKey, kind, progA, progB, episode, firstSeenAt, lastSeenAt, evidence, goalsA, goalsB, ' +
      'ruled, ruledAt, ruledBy FROM programme_pairs WHERE closedAt IS NULL ORDER BY pairKey').all() as unknown as PairDbRow[];
    const rows: StandingPairRow[] = [];
    const unreadable: UnreadablePairRow[] = [];
    for (const r of raw) {
      if (!isPairKind(r.kind)) { unreadable.push({ id: r.id, key: r.pairKey, why: 'kind' }); continue; }
      const k = parsePairKey(r.pairKey);
      if (k === null || k.kind !== r.kind || k.a !== r.progA || k.b !== r.progB) { unreadable.push({ id: r.id, key: r.pairKey, why: 'key' }); continue; }
      rows.push({
        id: r.id, key: r.pairKey, kind: r.kind, a: r.progA, b: r.progB, episode: r.episode, firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt, evidence: readEvidence(r.evidence), goalsA: r.goalsA, goalsB: r.goalsB, ruled: rulingOf(r),
      });
    }
    return { ok: true, rows, unreadable };
  } catch (e) {
    return { ok: false, detail: detailOf(e) };
  }
}

/** The highest episode the table holds for each key, closed ones included. */
export function newestEpisodes(db: DatabaseSync): NewestEpisodesRead {
  try {
    const rows = db.prepare('SELECT pairKey, MAX(episode) AS episode FROM programme_pairs GROUP BY pairKey')
      .all() as unknown as { pairKey: string; episode: number }[];
    return { ok: true, episodes: new Map(rows.map((r) => [r.pairKey, r.episode])) };
  } catch (e) {
    return { ok: false, detail: detailOf(e) };
  }
}

/**
 * The claims created at or after `since` that are not re-chained, each with its paths and its run's programme (null with no
 * run), NEWEST FIRST, at most `cap`. `cut` when more were there: a cut drops the oldest rows, so a conflict completed today
 * is never the one left out (the plan review's F4).
 */
export function claimHistory(db: DatabaseSync, since: number, cap: number): ClaimHistoryRead {
  try {
    const claims = db.prepare('SELECT c.id AS claimId, c.project AS project, r.program AS program, c.createdAt AS createdAt ' +
      'FROM claims c LEFT JOIN runs r ON r.id = c.runId WHERE c.createdAt >= ? AND c.chainedFrom IS NULL ' +
      'ORDER BY c.createdAt DESC, c.id DESC LIMIT ?').all(since, cap + 1) as unknown as
      { claimId: number; project: string; program: string | null; createdAt: number }[];
    const cut = claims.length > cap;
    const kept = cut ? claims.slice(0, cap) : claims;
    const paths = new Map<number, string[]>(kept.map((c) => [c.claimId, []]));
    const all = db.prepare('SELECT cp.claimId AS claimId, cp.path AS path FROM claim_paths cp JOIN claims c ON c.id = cp.claimId ' +
      'WHERE c.createdAt >= ? AND c.chainedFrom IS NULL ORDER BY cp.rowid').all(since) as unknown as { claimId: number; path: string }[];
    for (const p of all) paths.get(p.claimId)?.push(p.path);
    return { ok: true, cut, rows: kept.map((c) => ({ ...c, paths: paths.get(c.claimId)! })) };
  } catch (e) {
    return { ok: false, detail: detailOf(e) };
  }
}

/**
 * A digest of every goals fact the operator rules on (the plan review's F11 d): the pin's `inShortAt`, the stored
 * `doneWhen`, and each modification's id, ruling and merged flag, by id; read as `CoordStore#goalsFor` reads them. SHA-256
 * cut to 16 hex characters. Throws when the read throws: the arm turns that into `unmeasured`.
 */
export function goalsStamp(db: DatabaseSync, slug: string): string {
  const g = goalsFor(db, slug);
  const mods = [...g.modifications].sort((x, y) => x.id - y.id).map((m) => [m.id, m.ruling, m.merged]);
  return createHash('sha256').update(JSON.stringify([g.inShortAt, g.doneWhen, mods])).digest('hex').slice(0, 16);
}

const LANDED: RunState = 'done';

/**
 * "A's next landing" (question 14): whether a `work` run of the programme reached `done` with `closedAt` after `at`. A read
 * that throws answers `'unmeasured'`, never false. Relay A calls it with `standingPairs` (the plan review's F9).
 */
export function programmeLandedSince(db: DatabaseSync, slug: string, at: number): Fact<boolean> {
  try {
    return db.prepare("SELECT 1 FROM runs WHERE program = ? AND kind = 'work' AND state = ? AND closedAt > ? LIMIT 1")
      .get(slug, LANDED, at) !== undefined;
  } catch {
    return 'unmeasured';
  }
}
