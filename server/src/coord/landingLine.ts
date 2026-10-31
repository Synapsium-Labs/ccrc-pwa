// L1, context C4 (landing order wave 5e). PURE: no clock, no fs, no store, no I/O; its one value import is the L0
// vocabulary in `shared/landingLine.ts` (D-7613). Two deciders, both folds over values:
//
// - `landingOrder` decides the landing line's order and its head from a project's entries and the project's two flags
//   (D-7621). The L4 read route reads the project row (`CoordStore.landingProject`) and hands the values in; this file
//   never sees a project name. `afterIds` name ENTRY IDS (`LandingEntry.id`), never PR numbers (D-7613). An after edge
//   outranks the `fixesMain` jump (D-7622): a fix-main entry that waits on another entry is not taken before it, so the
//   jump only reorders entries nothing holds back. A `fixesMain` entry is held by `main-red` too (D-7623): inert in 5e,
//   since `mainRedHold` has no writer until 5i, and a question for 5i.
// - `landingEjectionAsk` decides the second-ejection notice (D-7624). The entry's `ejections` count only ever rises and
//   `CoordStore.advanceLanding` is its one writer, so exactly one write per entry produces 2: that write is the
//   once-only raise. A third ejection raises nothing, and the advance is never refused.
import {
  LANDING_PAUSE_BY, LANDING_PAUSE_BYS,
  type LandingEntry, type LandingLineFlags, type LandingOrder,
} from '../../../shared/landingLine.js';

/** First-green: `fixesMain` entries first, then the earlier pin, then the lower PR number. */
const byKey = (a: LandingEntry, b: LandingEntry): number =>
  Number(b.fixesMain) - Number(a.fixesMain) || a.pinnedAt - b.pinnedAt || a.pr - b.pr;

export function landingOrder(entries: readonly LandingEntry[], flags: LandingLineFlags): LandingOrder {
  const line = entries.filter((x) => x.state === 'pinned').sort(byKey);
  // An edge holds its entry behind a target that is still outstanding. An `unknown` target is outstanding because this
  // build cannot read whether it landed, so an edge to it fails closed.
  const outstanding = new Set(entries.filter((x) => x.state === 'pinned' || x.state === 'ejected' || x.state === 'unknown').map((x) => x.id));
  const taken = new Set<number>();
  const order: LandingEntry[] = [];
  const rest = new Set(line);
  for (;;) {
    const next = line.find((x) => rest.has(x) && x.afterIds.every((t) => !outstanding.has(t) || taken.has(t)));
    if (next === undefined) break;
    rest.delete(next);
    taken.add(next.id);
    order.push(next);
  }
  const head = order[0] ?? null;
  // What waits on an ejected or unknown target, or on a cycle (a self-edge included), goes last in key order.
  for (const x of line) if (rest.has(x)) order.push(x);
  const by = LANDING_PAUSE_BYS.filter((k) => flags[LANDING_PAUSE_BY[k]]);
  return by.length > 0 ? { paused: true, by, order } : { paused: false, order, head };
}

/** The ejection count at which the operator is told, once (D-7624). */
export const LANDING_EJECTION_ASK_AT = 2;

export type LandingEjectionAsk = { due: false } | { due: true; title: string; body: string; tag: string };

export function landingEjectionAsk(entry: LandingEntry): LandingEjectionAsk {
  if (entry.state !== 'ejected' || entry.ejections !== LANDING_EJECTION_ASK_AT) return { due: false };
  const at = `${entry.project} #${entry.pr}`;
  const who = entry.runId === null ? `${at} (no run)` : `run ${entry.runId}, ${at}`;
  const base = entry.baseSha === null ? 'unrecorded' : entry.baseSha.slice(0, 12);
  return {
    due: true,
    tag: `landing-ejected-${entry.project}-${entry.pr}`,
    title: `Landing: ${at} ejected twice`,
    body: `${who}: ejected from the landing line a second time (${entry.ejectionKind ?? 'unrecorded'} against base ${base}). `
      + 'The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.',
  };
}
