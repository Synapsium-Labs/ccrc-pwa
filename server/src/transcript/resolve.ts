import path from 'node:path';
import type { FleetIO } from '../io.js';
import { mungePath } from '../munge.js';

/**
 * Transcript file for a session: `<configDir>/projects/<munge(dir)>/<uuid>.jsonl`.
 * Caller passes the live `cwd` when available, else the registry `workdir`.
 *
 * Pure and symlink-blind, deliberately: it munges the string it is given.
 * `resolveTranscriptFile` below is the seam-aware caller-facing resolver.
 */
export function transcriptPath(configDir: string, dir: string, uuid: string): string {
  return path.join(configDir, 'projects', mungePath(dir), `${uuid}.jsonl`);
}

/** `dir` with its longest existing prefix resolved to a physical path and the
 *  nonexistent tail re-attached — ccd's own `_ws_realpath` semantics, so the
 *  two implementations answer alike. Null when nothing resolves (an io with
 *  no resolver, i.e. remote mode). */
const resolveDir = async (io: FleetIO, dir: string): Promise<string | null> => {
  let head = dir;
  const tail: string[] = [];
  for (;;) {
    const real = await io.realpath(head);
    if (real !== null) return tail.length === 0 ? real : path.join(real, ...tail);
    const parent = path.dirname(head);
    if (parent === head) return null;
    tail.unshift(path.basename(head));
    head = parent;
  }
};

/** WHICH rung of §5.1's ladder produced an answer. It travels in the outcome
 *  rather than being recomputed by callers because §5.3's re-point rule is
 *  "strictly better rung", and a caller that recomputed it would be deciding
 *  the same question twice with two implementations. */
export type TranscriptRung =
  | 'live-resolved' | 'live-raw' | 'registry-resolved' | 'registry-raw'
  | 'uuid-glob' | 'foreign-glob';

/** §5.1's ladder as DATA: the index is the rung's rank, so the order lives in
 *  one place and a test can read it back. */
export const RUNG_ORDER: readonly TranscriptRung[] = [
  'live-resolved', 'live-raw', 'registry-resolved', 'registry-raw', 'uuid-glob', 'foreign-glob',
];

/**
 * What the resolver answers. A bare `string` cannot carry this and rule (b)
 * (architecture doc: no overloaded null at a seam) forbids inventing one:
 *
 *   - `found` names the rung, so `SessionStream` can tell a better answer from
 *     a different one, and the `account` for a rung-6 hit, so the PWA can say
 *     "stranded history, held by `claude`" instead of rendering another
 *     account's frozen copy silently. `account` is null for every other rung.
 *   - `fallback` is the raw munge of the directory given — the address a tailer
 *     keeps working against for a session that later writes there — plus the
 *     one bit rule (b) is really about: whether the search was COMPLETE.
 *     "I looked everywhere and there is nothing" and "a readdir answered null
 *     so rungs 5 and 6 never ran" are different facts, and §5.5 makes the
 *     second one routine in remote mode. A `complete: false` fallback renders
 *     as "can't read the fleet host right now", never as "no messages yet".
 */
export type TranscriptResolution =
  | { readonly kind: 'found'; readonly path: string; readonly rung: TranscriptRung;
      readonly account: string | null }
  | { readonly kind: 'fallback'; readonly path: string; readonly complete: boolean };

/** Ladder position, for §5.3's "strictly better" comparison. A fallback ranks
 *  after every rung: it is not a hit. */
export function rungRank(r: TranscriptResolution): number {
  return r.kind === 'fallback' ? RUNG_ORDER.length : RUNG_ORDER.indexOf(r.rung);
}

export interface ResolveOpts {
  readonly configDir: string;
  /** The live cwd when the session is live, else the registry workdir. */
  readonly dir: string;
  readonly registryWorkdir: string;
  readonly uuid: string;
  /** The OTHER accounts, in roster declaration order — rung 6's input and its
   *  tiebreak. Absent means "do not search other accounts", which is what the
   *  name sweep and the slash-command listing pass (§5.2): a derived name must
   *  never come from another account's frozen copy. The list comes from the
   *  caller, never a literal of account names in this module (architecture
   *  rule (a): config is data). */
  readonly foreign?: readonly { readonly account: string; readonly configDir: string }[];
}

/** One existing `<configDir>/projects/<something>/<uuid>.jsonl`. */
export interface GlobHit {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  /** The account this came from, or null for the session's own config dir. */
  readonly account: string | null;
  /** Roster declaration order — the first tiebreak after mtime. */
  readonly order: number;
}

/**
 * Fold candidates that agree on `(size, mtimeMs)` into one.
 *
 * THE TWO SIDES OF THIS FIX DEDUPE DIFFERENTLY, DELIBERATELY. `FleetIO.stat`
 * answers `{ mtimeMs, size } | null` (`io.ts:16`) — there is no inode on this
 * seam and the remote `stat` op does not carry one — so the server collapses on
 * `(size, mtimeMs)`: hardlinked names share both exactly (M1: one inode wore
 * three names in production), and two genuinely distinct files agreeing on size
 * to the byte AND mtime to the millisecond are, for the purpose of "which of
 * these do I open", the same answer. ccd is not on this seam and uses the real
 * inode (`stat -c %i`, §2.1), because there the dedupe decides whether 70MB is
 * copied three times rather than which of two identical files is displayed.
 *
 * The survivor of a group is its lowest `(order, path)`, so the rendered path
 * is stable across ticks rather than wandering with readdir order.
 */
export function collapseHits(hits: readonly GlobHit[]): GlobHit[] {
  const byIdentity = new Map<string, GlobHit>();
  for (const h of hits) {
    const key = `${h.size}:${h.mtimeMs}`;
    const kept = byIdentity.get(key);
    if (kept === undefined || h.order < kept.order || (h.order === kept.order && h.path < kept.path)) {
      byIdentity.set(key, h);
    }
  }
  return [...byIdentity.values()];
}

/** Newest mtime wins; ties break by roster declaration order, then by path —
 *  so the answer is deterministic and a test can pin it. M2's five copies of
 *  one uuid differ by weeks, and the newest is the one the operator means. */
export function pickNewest(hits: readonly GlobHit[]): GlobHit | null {
  let best: GlobHit | null = null;
  for (const h of collapseHits(hits)) {
    if (best === null) { best = h; continue; }
    if (h.mtimeMs > best.mtimeMs) { best = h; continue; }
    if (h.mtimeMs < best.mtimeMs) continue;
    if (h.order < best.order) { best = h; continue; }
    if (h.order === best.order && h.path < best.path) best = h;
  }
  return best;
}

/** `<configDir>/projects/*​/<uuid>.jsonl`, existence-checked. `complete: false`
 *  means the directory could not be LISTED — never that it held nothing. */
async function globByUuid(
  io: FleetIO, configDir: string, uuid: string, account: string | null, order: number,
): Promise<{ hits: GlobHit[]; complete: boolean }> {
  const root = path.join(configDir, 'projects');
  const names = await io.readdir(root);
  if (names === null) return { hits: [], complete: false };
  const hits: GlobHit[] = [];
  for (const name of names) {
    const p = path.join(root, name, `${uuid}.jsonl`);
    const st = await io.stat(p);
    if (st !== null) hits.push({ path: p, size: st.size, mtimeMs: st.mtimeMs, account, order });
  }
  return { hits, complete: true };
}

/**
 * The transcript a reader should actually open, as a typed outcome (§5.1/§5.2).
 *
 * Existence-first, first hit wins:
 *   1. resolved munge of the directory given (the live cwd when live);
 *   2. raw munge of the directory given;
 *   3. resolved munge of the REGISTRY workdir;
 *   4. raw munge of the registry workdir;
 *   5. `<configDir>/projects/*​/<uuid>.jsonl`, newest wins, duplicates collapsed;
 *   6. the same glob across the OTHER accounts, pooled, newest winning globally
 *      — only when 1-5 all miss, and always carrying the account so the UI can
 *      banner it;
 *   7. otherwise the raw munge of the directory given, as a fallback.
 *
 * THE ORDER IS LIVENESS-DEPENDENT ON PURPOSE. A live session's rungs 1-2 are
 * its live cwd and its 3-4 the registry workdir; a dead session's caller passes
 * the registry workdir as `dir`, so 1-2 and 3-4 coincide and four candidates
 * collapse to two (the dedupe below is what makes that literally true, not just
 * morally). A session with transcripts at both addresses therefore renders one
 * file while alive and the other once dead — the correct preference, not a
 * wobble: while the process is up, the cwd it publishes in
 * `<configDir>/sessions/<pid>.json` is direct evidence about where it is
 * working; the registry workdir is only where it was started. When that
 * evidence expires the ladder falls back to the durable fact.
 *
 * COST (§5.4): rungs 5 and 6 run only when 1-4 have all missed, so a healthy
 * session pays one realpath walk and one or two stats — what today already
 * costs. Only a session with nothing at any exact path pays for a search, and
 * `TranscriptResolver` below is what stops it paying every two seconds.
 *
 * Remote mode has no resolver (`io.realpath` answers null unconditionally), so
 * rungs 1 and 3 collapse into 2 and 4 — today's documented behavior, unchanged.
 * Rungs 5 and 6 need `readdir`+`stat`, which the remote io implements and which
 * `checkPath`'s `.claude*` glob already permits, so the uuid search works
 * remotely with NO widening of the agent read whitelist.
 */
export async function resolveTranscript(io: FleetIO, o: ResolveOpts): Promise<TranscriptResolution> {
  const exact: { rung: TranscriptRung; path: string }[] = [];
  const add = (rung: TranscriptRung, p: string): void => {
    // Dedupe keeps the FIRST rung to claim a path, which is what makes a dead
    // session's four candidates two stats instead of four.
    if (!exact.some((c) => c.path === p)) exact.push({ rung, path: p });
  };
  const pair = (resolvedRung: TranscriptRung, rawRung: TranscriptRung, dir: string, resolved: string | null): void => {
    const raw = transcriptPath(o.configDir, dir, o.uuid);
    if (resolved !== null) {
      const real = transcriptPath(o.configDir, resolved, o.uuid);
      // A workdir with no symlink in it munges identically both ways: it is
      // rung 2/4, today's behavior wherever today's behavior was right.
      if (real !== raw) add(resolvedRung, real);
    }
    add(rawRung, raw);
  };

  const liveResolved = await resolveDir(io, o.dir);
  // One realpath walk, not two, when the caller passed the same directory twice
  // — which is every DEAD session.
  const regResolved = o.registryWorkdir === o.dir ? liveResolved : await resolveDir(io, o.registryWorkdir);
  pair('live-resolved', 'live-raw', o.dir, liveResolved);
  pair('registry-resolved', 'registry-raw', o.registryWorkdir, regResolved);

  for (const c of exact) {
    if ((await io.stat(c.path)) !== null) {
      return { kind: 'found', path: c.path, rung: c.rung, account: null };
    }
  }

  const own = await globByUuid(io, o.configDir, o.uuid, null, 0);
  let complete = own.complete;
  const bestOwn = pickNewest(own.hits);
  if (bestOwn !== null) return { kind: 'found', path: bestOwn.path, rung: 'uuid-glob', account: null };

  // Pooled across accounts, newest winning globally — M2's five copies of one
  // uuid differ by weeks. Reached only when everything above missed.
  const pooled: GlobHit[] = [];
  for (const [order, acct] of (o.foreign ?? []).entries()) {
    const g = await globByUuid(io, acct.configDir, o.uuid, acct.account, order);
    if (!g.complete) complete = false;
    pooled.push(...g.hits);
  }
  const bestForeign = pickNewest(pooled);
  if (bestForeign !== null) {
    return { kind: 'found', path: bestForeign.path, rung: 'foreign-glob', account: bestForeign.account };
  }

  return { kind: 'fallback', path: transcriptPath(o.configDir, o.dir, o.uuid), complete };
}

/** How long a "keep looking" answer — a fallback, or a foreign-account hit —
 *  is trusted before the full ladder runs again (§5.4). */
export const RESOLVER_BACKOFF_MS = 30_000;

/** Memo entries are keyed per `(configDir, uuid, dirGiven)`; a uuid rotates on
 *  every `/clear` and a workspace slug is recycled by `ws-reap`, so keys
 *  accumulate for the life of a process that runs for weeks. Insertion-ordered
 *  eviction past this cap keeps that a bounded cost. */
export const MEMO_MAX = 256;

/**
 * The ladder, memoized (§5.4). One instance per `SessionStream` and one for the
 * watcher's name sweep.
 *
 * `SessionStream` resolves on every 2-second poll for the life of every open
 * socket, and the name sweep resolves per eligible row on its own tick; a
 * seven-rung ladder run naively at that cadence would be a real regression, and
 * it would fall hardest on exactly the sessions this work is for — the ones
 * where rungs 1-4 miss. So a subsequent call re-validates the last winner with
 * a SINGLE stat and returns it. Steady state is one stat per session per tick,
 * which is cheaper than today's found case.
 *
 * The full ladder re-runs when: the winner has vanished (a `found` whose file
 * is gone), a fallback's own path has APPEARED (the common heal — the session
 * finally wrote where the tailer is already pointed), the key changed, or a
 * back-off expired. The back-off applies only to the two answers that mean
 * "keep looking": a `fallback`, and a `foreign-glob` hit.
 *
 * HONEST LIMIT, stated rather than discovered: a memoized rung-5 answer whose
 * file still exists is NOT re-laddered when a better rung starts hitting, and
 * the key does not include `registryWorkdir`. Both follow §5.4 exactly. The
 * uuid is in the key, so the case this work is really for — a swap landing —
 * re-ladders the moment the uuid rotates, and a fallback re-ladders on its
 * back-off.
 *
 * The memo is STATE, so it lives here and not in the ladder: `resolveTranscript`
 * stays pure — narrow deps in, typed union out, testable with no clock — which
 * is the ring boundary this repo already draws between deciding and acting.
 */
export class TranscriptResolver {
  private readonly memo = new Map<string, { answer: TranscriptResolution; at: number }>();
  private readonly backoffMs: number;
  private readonly now: () => number;

  constructor(
    private readonly io: FleetIO,
    opts?: { readonly backoffMs?: number; readonly now?: () => number },
  ) {
    this.backoffMs = opts?.backoffMs ?? RESOLVER_BACKOFF_MS;
    this.now = opts?.now ?? Date.now;
  }

  async resolve(o: ResolveOpts): Promise<TranscriptResolution> {
    const key = `${o.configDir} ${o.uuid} ${o.dir}`;
    const held = this.memo.get(key);
    if (held !== undefined && !this.staleByBackoff(held)) {
      const st = await this.io.stat(held.answer.path);
      // A `found` stays true while its file exists; a `fallback` stays true
      // while its path still does NOT.
      const stillTrue = held.answer.kind === 'found' ? st !== null : st === null;
      if (stillTrue) return held.answer;
    }
    const answer = await resolveTranscript(this.io, o);
    this.remember(key, answer);
    return answer;
  }

  private staleByBackoff(e: { answer: TranscriptResolution; at: number }): boolean {
    const keepsLooking = e.answer.kind === 'fallback' || e.answer.rung === 'foreign-glob';
    return keepsLooking && this.now() - e.at >= this.backoffMs;
  }

  private remember(key: string, answer: TranscriptResolution): void {
    this.memo.delete(key);                       // re-insert so Map order is recency
    this.memo.set(key, { answer, at: this.now() });
    while (this.memo.size > MEMO_MAX) {
      const oldest = this.memo.keys().next();
      if (oldest.done === true) break;
      this.memo.delete(oldest.value);
    }
  }
}

/**
 * TRANSITIONAL (removed in Task 11). The pre-ladder signature, answering the
 * ladder's path with `dir` doubling as the registry workdir and no foreign
 * accounts — so `sessionws.ts`, `watch.ts` and `commands.ts` keep compiling and
 * behaving as they do today while the ladder lands on its own. Task 11 moves
 * all three onto `resolveTranscript`, each deciding for itself what it will
 * accept, and deletes this.
 */
export async function resolveTranscriptFile(
  io: FleetIO, configDir: string, dir: string, uuid: string,
): Promise<string> {
  const r = await resolveTranscript(io, { configDir, dir, registryWorkdir: dir, uuid });
  return r.path;
}
