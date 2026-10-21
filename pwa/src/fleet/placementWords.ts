// What a project's placement read IS, and what the "add a workspace" control
// says about it.
//
// Both halves used to live in `ProjectCard.tsx` — the type and its one-line
// accessor at the top (already imported from there by `useProjectRows`, which
// is a hook reaching into a 614-line component file for a six-line union), and
// a 45-line copy ladder in the middle of the component, between the pool
// derivations and the card's JSX.
//
// The ladder is the reason this file is named for WORDS, like its neighbours
// `coordWords`/`readinessWords`/`runWords`/`substrateWords`: its whole job is
// to turn five distinguishable states into the one sentence the operator reads
// on a control they are about to press. Keeping it beside the type it branches
// on means a new `kind` and the sentence that must exist for it are one file
// apart, not three hundred lines apart.
import type { ProjectedHome, ProjectPlacement, ProjectPoolWire, ProjectRow, RosterWire } from '../../../shared/api';
import { accountLabel } from '../lib/accounts';
import { poolLabelList } from '../lib/pools';

/** The five answers `/api/projects` can give about one project's placement.
 *  `legacy` is a server too old to answer at all; `pending`/`failed`/`missing`
 *  are three distinct ways of having no answer YET, and each says something
 *  different to the operator — see `addWorkspaceLabel`. */
export type ProjectPlacementRead =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'missing' }
  | { kind: 'legacy' }
  | { kind: 'measured'; pool: ProjectPoolWire; placement: ProjectPlacement };

/** One `/api/projects` row's placement read — `missing` when there is no row, `legacy` when an older server
 *  sent neither key. ONE spelling for the fleet's cards (`useProjectRows`) and the session header (D-5545),
 *  so a row's off-pool claim and its header's can never read two answers. `Object.hasOwn`: an ABSENT key is an
 *  older server and reads as legacy, never as a measured value. */
export const placementOfRow = (row: ProjectRow | undefined): ProjectPlacementRead => {
  if (row === undefined) return { kind: 'missing' };
  return Object.hasOwn(row, 'pool') && row.pool !== undefined
    && Object.hasOwn(row, 'placement') && row.placement !== undefined
    ? { kind: 'measured', pool: row.pool, placement: row.placement }
    : { kind: 'legacy' };
};

/** A pool value exists only on a MEASURED read. The absence discipline is
 *  spelled once, here: a pending, failed, missing or legacy read makes no pool
 *  claim, and folding any of them to "untagged" would be a read answering a
 *  question it never asked. */
export const poolOfPlacement = (read: ProjectPlacementRead): ProjectPoolWire | null =>
  read.kind === 'measured' ? read.pool : null;

/** The account the add control would place on, or `undefined` when nothing in
 *  this read names one. A legacy row falls back to the GLOBAL projection, and
 *  only while no readable tag narrows the project: a pending, failed or missing
 *  pool read makes no account claim. */
export function placementForecast(
  read: ProjectPlacementRead,
  projected: ProjectedHome | null | undefined,
): ProjectedHome | undefined {
  const pool = poolOfPlacement(read);
  const legacySafe = pool === null || pool.state === 'untagged';
  return read.kind === 'measured' && read.placement.kind === 'projected'
    ? read.placement
    : read.kind === 'legacy' && legacySafe
      ? (projected ?? undefined)
      : undefined;
}

/**
 * The add control's accessible name — the one sentence that says whether a new
 * workspace can be placed on this project, and if not, why not.
 *
 * HEADROOM, NOT LOAD: "91% free" is the question being asked ("can this
 * workspace actually run?"), and the answer stays legible when the score is
 * above the swap ceiling — which ccd's rule permits, since it returns the
 * least-loaded account even when every account is pinned.
 */
export function addWorkspaceLabel(
  project: string,
  read: ProjectPlacementRead,
  projected: ProjectedHome | null | undefined,
  roster: readonly RosterWire[],
): string {
  const forecast = placementForecast(read, projected);
  if (forecast) {
    return `New workspace on ${project} — ${accountLabel(roster, forecast.wrapper)}, ${100 - forecast.score}% free`;
  }
  const clause = unplacedClause(read, projected, roster);
  return clause === null ? `New workspace on ${project}` : `New workspace on ${project} — ${clause}`;
}

/**
 * The line a sheet shows above its confirm, where `addWorkspaceLabel` is the control's name: the SAME read, said
 * as a sentence. A forecast names the account and its headroom; every state that has no forecast says what
 * `addWorkspaceLabel` says of it, as a sentence of its own; `null` is the control saying nothing (a pending read,
 * or a legacy one nobody asked a projection of), and the sheet then says nothing either.
 */
export function landsOnLine(
  read: ProjectPlacementRead,
  projected: ProjectedHome | null | undefined,
  roster: readonly RosterWire[],
): string | null {
  const forecast = placementForecast(read, projected);
  if (forecast) return `Lands on ${accountLabel(roster, forecast.wrapper)} — ${100 - forecast.score}% free.`;
  const clause = unplacedClause(read, projected, roster);
  return clause === null ? null : `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * What a read with NO forecast says, as the clause that follows the control's "New workspace on <project> — ":
 * `null` is the control's bare name. The ladder is the control's, unchanged; `landsOnLine` shares it so the sheet
 * and the control can never tell two stories about one read.
 */
function unplacedClause(
  read: ProjectPlacementRead,
  projected: ProjectedHome | null | undefined,
  roster: readonly RosterWire[],
): string | null {
  // The THIRD meaning of `none` (D-2854): the row was fetched with a class and
  // every eligible lane measured unservable for it. Only a `?class=` fetch can
  // ever carry this. The fleet screen's class chooser (routing slice 5, Task 6)
  // sends one whenever an operator picks a class there — with the chooser left
  // on "Coordinator row" the fetch stays unrouted and a card never takes this
  // branch, reading exactly as before.
  const measuredNone = read.kind === 'measured' && read.placement.kind === 'none';
  const measuredNoneClass = read.kind === 'measured' && read.placement.kind === 'none'
    ? read.placement.class
    : undefined;
  if (measuredNoneClass !== undefined) {
    return `no lane can serve ${measuredNoneClass}`;
  }

  const pool = poolOfPlacement(read);
  const legacySafe = pool === null || pool.state === 'untagged';
  // `=== null`, STRICTLY, and not `?? null`: an absent `projected` (the prop
  // is optional and undefaulted) means the caller never ran a projection, which
  // is not the same claim as a projection that ran and placed nothing. Folding
  // the two made a card with no projection at all announce "all disabled".
  const legacyNone = read.kind === 'legacy' && legacySafe && projected === null;
  if (measuredNone || legacyNone) {
    const poolName = pool !== null && pool.state === 'tagged' ? pool.name : null;
    const placeableNames = poolLabelList(roster, pool);
    return poolName === null
      ? placeableNames === ''
        ? 'all disabled'
        : `${placeableNames} all disabled`
      : placeableNames === ''
        ? `nothing is in pool ${poolName}`
        : `nothing in pool ${poolName} is placeable, ${placeableNames} all disabled`;
  }

  // The two ways a read can have no answer and say so. They are not folded:
  // "reopen ccrc to retry" and "reload ccrc" are different acts, and a project
  // absent from the last check is not a check that failed.
  if (read.kind === 'failed') {
    return 'placement check failed; reopen ccrc to retry';
  }
  if (read.kind === 'missing') {
    return 'project absent from the latest placement check; reload ccrc';
  }
  return null;
}
