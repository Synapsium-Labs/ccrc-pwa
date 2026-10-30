import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { ChildReclaimSiblingsRead } from '../childReclaimSweep.js';
import { readSessionRecord, type SessionRecord } from '../registry.js';
import { isRegistryId } from '../../../shared/api.js';
import type { CoordStore } from './store.js';
import { claimantStateOfRead, splitSiblings, type ClaimantState, type SiblingFact } from './staleSibling.js';

export interface SiblingReadDeps { readonly coord: CoordStore; readonly io: FleetIO; readonly cfg: CcrcConfig }

/** A child's open sibling runs as the store holds them: the readable ones as facts, the unreadable ones by id. */
type SiblingFacts =
  | { readonly ok: true; readonly facts: readonly SiblingFact[]; readonly unread: readonly { id: number; openedAt: number }[] }
  | { readonly ok: false; readonly detail: string };

function siblingFacts(coord: CoordStore, sessionId: string): SiblingFacts {
  const sib = coord.bindingsOf(sessionId).worker();
  if (!sib.ok) return { ok: false, detail: sib.detail };
  const facts: SiblingFact[] = [];
  const unread: { id: number; openedAt: number }[] = [];
  for (const s of sib.siblings) {
    const run = coord.run(s.id);
    if (!run.ok || run.run === null) { unread.push({ id: s.id, openedAt: Number.NaN }); continue; }
    const r = run.run;
    facts.push({ id: r.id, state: r.state, openedAt: r.openedAt, dispatchStartedAt: r.dispatchStartedAt,
      dispatchedAt: r.dispatchedAt, claimedBy: r.claimedBy });
  }
  return { ok: true, facts, unread };
}

function splitRead(
  read: Extract<SiblingFacts, { ok: true }>, claimantOf: (who: string) => ClaimantState, nowMs: number,
): ChildReclaimSiblingsRead {
  const split = splitSiblings(read.facts, claimantOf, nowMs);
  const blocking = [...split.live, ...read.unread].sort((a, b) => a.id - b.id);
  return { ok: true, open: blocking.length, blocking, stale: split.stale };
}

/**
 * THE ONE READ of a child's open sibling runs (D-6923): the open runs naming the session,
 * split by `splitSiblings` into the ones that keep the child (`open`, `blocking`) and the stale ones it ignores. The
 * sweep lane (`childSiblingsFromListing`), the executor's step 2 and the hold-release job all read through the same
 * facts and split, so their answers cannot differ.
 * L3/L4: it reads the store and the registry and decides nothing; the rule is `coord/staleSibling.ts`.
 *
 * FAILS TOWARD KEEPING. A sibling whose run cannot be read, and a claimant the registry cannot place, keep the child.
 * An unreadable sibling LIST is `ok: false`, like `openRunsForSession`. A throw from the store propagates, as the
 * bare store read always did, so each caller's own try still answers it.
 */
export async function readChildSiblings(
  deps: SiblingReadDeps, sessionId: string, nowMs: number,
): Promise<ChildReclaimSiblingsRead> {
  const read = siblingFacts(deps.coord, sessionId);
  if (!read.ok) return read;
  const states = new Map<string, ClaimantState>();
  for (const f of read.facts) {
    if (f.claimedBy === null || states.has(f.claimedBy)) continue;
    const who = f.claimedBy;
    states.set(who, await readSessionRecord(deps.io, deps.cfg, who).then(claimantStateOfRead, (): ClaimantState => 'unmeasured'));
  }
  return splitRead(read, (who) => states.get(who) ?? 'unmeasured', nowMs);
}

/**
 * The sweep lane's form of the same read, SYNCHRONOUS (spec §5.5: the lane's per-child loop holds no await): each
 * claimant is placed from the pass's own registry listing rather than a fresh registry read, as `readSessionRecord`
 * would place it. A listed record is live or archived by its `archivedAt`; an id the listing names (`<id>.uuid`) but
 * no record carries is a refused row, and doubt; a bad id is doubt; an id the listing does not name is absent.
 * Only a caller whose listing SUCCEEDED may pass it: a pass with records was handed a listed registry.
 */
export function childSiblingsFromListing(
  coord: CoordStore, sessionId: string, nowMs: number,
  records: readonly SessionRecord[], names: readonly string[],
): ChildReclaimSiblingsRead {
  const read = siblingFacts(coord, sessionId);
  if (!read.ok) return read;
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const listed = new Set(names);
  return splitRead(read, (who) => {
    if (!isRegistryId(who)) return 'unmeasured';
    const rec = byId.get(who);
    if (rec !== undefined) return claimantStateOfRead({ kind: 'found', record: rec });
    return listed.has(`${who}.uuid`) ? 'unmeasured' : claimantStateOfRead({ kind: 'absent' });
  }, nowMs);
}
