import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { ChildReclaimSiblingsRead } from '../childReclaimSweep.js';
import { readSessionRecord } from '../registry.js';
import type { CoordStore } from './store.js';
import { claimantStateOfRead, splitSiblings, type ClaimantState, type SiblingFact } from './staleSibling.js';

/** One pass's memory of each claimant's state, so a claimant of several runs is read from the registry once. */
export type ClaimantCache = Map<string, Promise<ClaimantState>>;

export interface SiblingReadDeps { readonly coord: CoordStore; readonly io: FleetIO; readonly cfg: CcrcConfig }

/**
 * THE ONE READ of a child's open sibling runs (D-6923): the open runs naming the session,
 * split by `splitSiblings` into the ones that keep the child (`open`, `blocking`) and the stale ones it ignores. The
 * sweep lane, the executor's step 2 and the hold-release job all read through it, so their answers cannot differ.
 * L3/L4: it reads the store and the registry and decides nothing; the rule is `coord/staleSibling.ts`.
 *
 * FAILS TOWARD KEEPING. A sibling whose run cannot be read, and a claimant the registry cannot place, keep the child.
 * An unreadable sibling LIST is `ok: false`, like `openRunsForSession`. A throw from the store propagates, as the
 * bare store read always did, so each caller's own try still answers it.
 */
export async function readChildSiblings(
  deps: SiblingReadDeps, sessionId: string, nowMs: number, cache: ClaimantCache = new Map(),
): Promise<ChildReclaimSiblingsRead> {
  const sib = deps.coord.openRunsForSession(sessionId);
  if (!sib.ok) return { ok: false, detail: sib.detail };
  const facts: SiblingFact[] = [];
  const unread: { id: number; openedAt: number }[] = [];
  for (const s of sib.siblings) {
    const run = deps.coord.run(s.id);
    if (!run.ok || run.run === null) { unread.push({ id: s.id, openedAt: Number.NaN }); continue; }
    const r = run.run;
    facts.push({ id: r.id, state: r.state, openedAt: r.openedAt, dispatchStartedAt: r.dispatchStartedAt,
      dispatchedAt: r.dispatchedAt, claimedBy: r.claimedBy });
  }
  const states = new Map<string, ClaimantState>();
  for (const f of facts) {
    if (f.claimedBy === null || states.has(f.claimedBy)) continue;
    const who = f.claimedBy;
    let p = cache.get(who);
    if (p === undefined) {
      p = readSessionRecord(deps.io, deps.cfg, who).then(claimantStateOfRead, (): ClaimantState => 'unmeasured');
      cache.set(who, p);
    }
    states.set(who, await p);
  }
  const split = splitSiblings(facts, (who) => states.get(who) ?? 'unmeasured', nowMs);
  const blocking = [...split.live, ...unread].sort((a, b) => a.id - b.id);
  return { ok: true, open: blocking.length, blocking, stale: split.stale };
}
