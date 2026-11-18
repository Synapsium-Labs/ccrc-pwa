// The project row's hierarchy settings: every word the Linear owner, the initiatives toggle, the owning-project control and
// the hierarchy state line say (Linear hierarchy design 2026-11-10 §11.1 and §7.5, D-8184). L1: pure, no I/O. The sentences a
// refusal says are `refusalWords.ts`'s (`linkingErrorText`); the box's own text never reaches the screen.
import type { HierarchyProjectRow } from '../../../shared/plan';
import { ApiError, writeOutcomeUnknown } from '../lib/apiError';
import { linkingErrorText } from '../lib/refusalWords';
import { isPlaceableInstant, releaseDate } from '../lib/format';

/** The labels. Short words only. */
export const HIERARCHY_TEXT = {
  owner: 'Linear owner',
  initiatives: 'File into initiatives',
  owning: 'Owning project',
  mapWaiting: 'Map waiting for you',
  upkeep: 'Open the Upkeep epic',
  allAct: 'Make one coordinator the Linear owner of every project',
  allPick: 'Coordinator for every project',
  allNone: 'Choose a coordinator',
  allConfirm: 'Make owner',
  allTitle: 'Make this coordinator the owner of every project?',
  allDone: 'Saved. Every project with Linear settings now names that coordinator.',
  unreadable: 'The hierarchy settings could not be read. Reload this page to try again.',
  rereadFailed: 'The hierarchy settings could not be read again. What is shown may be out of date, and a row you changed stays locked until they are read again.',
  readAgain: 'Read again',
  /** A write whose outcome is unknown (no answer, or a 5xx that can follow a commit): the generic refusal says "Nothing was changed", which may be false. */
  unconfirmed: 'The server could not confirm that it saved this. The settings are read again before you can change them.',
} as const;

/** The sentence under a hierarchy-card write that failed: the unconfirmed one when the write may have landed, else the refusal's fixed sentence. */
export const hierarchyWriteText = (err: unknown): string => (writeOutcomeUnknown(err) ? HIERARCHY_TEXT.unconfirmed : linkingErrorText(err));

/** The ONE reader of "the hierarchy route is absent": an older server answers the read with a 404, which is not a failed read. The
 *  linking card and the add-project sheet both draw no hierarchy controls and say nothing for it. */
export const hierarchyAbsent = (err: unknown): boolean => err instanceof ApiError && err.status === 404;

/** The row of a project the hierarchy answer does not list, at the values the server's own rule gives it: the answer lists only
 *  projects with a stored linking row or a programme home (`planStore.ts` `hierarchyProjectsOf`), so an absent project has no
 *  linking row (team key null, initiatives on, no owner named, owns no team: the column defaults of `setHierarchySettings`'s
 *  insert) and is no programme's home, so `latestProgrammeCoordinator` finds none (`planPolicy.ts` `linearOwnerOfProject`:
 *  source none, not live), and it has no migration state, item or inbound issue. The write accepts such a project. */
export const defaultHierarchyRow = (project: string): HierarchyProjectRow => ({
  project, teamKey: null, initiatives: 'on', linearOwner: null, ownsTeam: false,
  ownerNow: { id: null, source: 'none', live: false }, state: 'not-migrated', stateAt: null, itemId: null, inboundWaiting: 0,
});

/** The ONE reader of `ownerNow`'s optional fields. `project` is the project the effective owner was decided for (absence, an
 *  older server, reads as the project's own owner). `pick` is what choosing the empty option gives: `ifUnnamed`, the default rule
 *  with no named owner (D-8738), else, when an older server omits it, the owner now (today's words). */
export function ownerFrom(row: Pick<HierarchyProjectRow, 'project' | 'ownerNow'>): {
  project: string; pick: { id: string | null; live: boolean }; now: { id: string | null; live: boolean };
} {
  const now = { id: row.ownerNow.source === 'none' ? null : row.ownerNow.id, live: row.ownerNow.live };
  return { project: row.ownerNow.project ?? row.project, pick: row.ownerNow.ifUnnamed ?? now, now };
}

/** Whether the effective owner comes from another project (the one that owns this project's team key). */
export const ownerIsInherited = (row: Pick<HierarchyProjectRow, 'project' | 'ownerNow'>): boolean => ownerFrom(row).project !== row.project;

/** The empty owner option: the coordinator choosing it gives (the default rule's, `ownerFrom().pick`) and whether it is live; the
 *  option names who the operator gets, not who owns the project now. Always the short form: where an inherited owner comes from
 *  is `ownerInheritedNote`'s, which wraps. */
export function defaultOwnerWords(row: Pick<HierarchyProjectRow, 'project' | 'teamKey' | 'ownerNow'>): string {
  const { pick } = ownerFrom(row);
  return pick.id === null ? 'Default: none live' : `Default: ${pick.id} (${pick.live ? 'live' : 'not live'})`;
}

/** The note under the owner select of a project whose owner comes from another project, or null. It names the owner NOW and whether
 *  it is live (the empty option names the project's own default, `defaultOwnerWords`, which is not the owner meanwhile). */
export function ownerInheritedNote(row: Pick<HierarchyProjectRow, 'project' | 'teamKey' | 'ownerNow'>): string | null {
  if (!ownerIsInherited(row)) return null;
  const { project, now } = ownerFrom(row);
  const tail = `from ${project}, which owns team key ${row.teamKey ?? ''}. This project's own owner setting is not used meanwhile.`;
  return now.id === null ? `No owner is live now. That comes ${tail}` : `The owner now is ${now.id} (${now.live ? 'live' : 'not live'}), ${tail}`;
}

/** The option for a project's own named owner that is not in the coordinator list. Its liveness is known only when it is the
 *  effective owner of an own-owner row; it is absent from the list, so otherwise it reads not live. */
export function namedOwnerWords(row: Pick<HierarchyProjectRow, 'project' | 'ownerNow'>, named: string): string {
  return coordinatorWords({ id: named, live: !ownerIsInherited(row) && row.ownerNow.id === named && row.ownerNow.live });
}

/** One coordinator's option label. */
export const coordinatorWords = (c: { id: string; live: boolean }): string => (c.live ? c.id : `${c.id} (not live)`);

/** Whether another project holds the same team key (compared case-insensitively, as the server's `teamOwnerProject` does). */
export function sharesTeamKey(project: string, rows: readonly { project: string; teamKey: string | null }[]): boolean {
  const mine = rows.find((r) => r.project === project)?.teamKey;
  if (mine === null || mine === undefined) return false;
  const key = mine.toUpperCase();
  return rows.some((r) => r.project !== project && r.teamKey !== null && r.teamKey.toUpperCase() === key);
}

// The fleet's one UTC-day formatter, which never throws on a stamp the clock cannot place; none is said for a missing stamp.
const day = (at: number | null): string => (at === null || !isPlaceableInstant(at) ? '' : ` on ${releaseDate(at)}`);

/** The hierarchy state's words. `map-waiting` is drawn as a link by the card (its words are `HIERARCHY_TEXT.mapWaiting`). */
export function stateWords(row: Pick<HierarchyProjectRow, 'state' | 'stateAt'>): string {
  switch (row.state) {
    case 'not-migrated': return 'Not migrated';
    case 'map-waiting': return HIERARCHY_TEXT.mapWaiting;
    case 'migrating': return 'Migrating';
    case 'migrated': return `Migrated${day(row.stateAt)}`;
    case 'put-back': return `Put back${day(row.stateAt)}`;
  }
}

/** The inbound line, or null when none wait. */
export const inboundWords = (n: number): string | null =>
  n <= 0 ? null : n === 1 ? '1 inbound issue waits for an owner' : `${n} inbound issues wait for an owner`;

/** The consequence line of the all-projects confirm. */
export const ownerForAllConsequence = (id: string): string =>
  `Every project with Linear settings gets ${id} as its Linear owner. Each project's other settings stay as they are.`;
