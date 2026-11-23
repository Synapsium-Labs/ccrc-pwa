// The project row's hierarchy settings: every word the Linear owner, the initiatives toggle, the owning-project control and
// the hierarchy state line say (Linear hierarchy design 2026-11-10 §11.1 and §7.5, D-8184). L1: pure, no I/O. The sentences a
// refusal says are `refusalWords.ts`'s (`linkingErrorText`); the box's own text never reaches the screen.
import type { HierarchyProjectRow } from '../../../shared/plan';
import { ApiError, writeOutcomeUnknown } from '../lib/apiError';
import { linkingErrorText, migrateRefusalText, refusalText } from '../lib/refusalWords';
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
  reshape: 'Reshape in Linear',
  reshapeConfirm: 'Ask for the map',
  reshapeAsked: "Asked the team's Linear owner for the map. It waits for you as an item; nothing changes in Linear until you approve it.",
  /** A write whose outcome is unknown (no answer, or a 5xx that can follow a commit): the generic refusal says "Nothing was changed", which may be false. */
  unconfirmed: 'The server could not confirm that it saved this. The settings are read again before you can change them.',
} as const;

/** The sentence under a hierarchy-card write that failed: the unconfirmed one when the write may have landed, else the refusal's fixed sentence. */
/** A hierarchy or linking write whose outcome is unknown. Those routes answer 503 `unavailable` BEFORE any write (no plan store,
 *  no coordination store), so that pair is a refusal, never unknown (D-8186, review run 2491 A7); every other 5xx and a missing
 *  answer may follow a commit. */
export const hierarchyOutcomeUnknown = (err: unknown): boolean =>
  writeOutcomeUnknown(err) && !(err instanceof ApiError && err.status === 503 && refusalText(err, REFUSED_BEFORE_WRITE) !== null);
/** The 503 word those routes answer before any write, read through `refusalText` (ARCH-13b), never compared as a literal. */
const REFUSED_BEFORE_WRITE: Readonly<Record<'unavailable', string>> = {
  unavailable: 'The box could not reach its stores, so nothing was changed.',
};
/** The sentence for a failed hierarchy or linking write: the unconfirmed line when its outcome is unknown, else the word's sentence. */
export const hierarchyWriteText = (err: unknown): string => (hierarchyOutcomeUnknown(err) ? HIERARCHY_TEXT.unconfirmed : linkingErrorText(err));

/** The sentence for a failed migrate: its own refusals first (`unreachable` is a 503 that wrote nothing, so it is never "unconfirmed"),
 *  then the unconfirmed line when the outcome is unknown, else the word's sentence. */
export const migrateWriteText = (err: unknown): string => migrateRefusalText(err) ?? hierarchyWriteText(err);
/** Whether a failed migrate may have started one: anything but the refusals that wrote nothing. */
export const migrateOutcomeUnknown = (err: unknown): boolean => migrateRefusalText(err) === null && hierarchyOutcomeUnknown(err);

/** The Reshape control's rule: a project with a team key that is not migrated or was put back (design §11.1). */
export const reshapeOffered = (row: Pick<HierarchyProjectRow, 'state' | 'teamKey'>): boolean =>
  row.teamKey !== null && (row.state === 'not-migrated' || row.state === 'put-back');
/** The confirm's title and its sentence: nothing changes in Linear until the operator approves the map the team's owner proposes. */
export const reshapeTitle = (team: string): string => `Reshape team ${team} in Linear?`;
export const reshapeConsequence = (team: string): string =>
  `The Linear owner of team ${team} is asked to propose a map of how its issues fit the plan. Nothing changes in Linear until you approve that map.`;

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
  project: string; pick: { id: string | null; live: boolean }; now: { id: string | null; live: boolean }; unmeasured: boolean;
} {
  const now = { id: row.ownerNow.source === 'none' ? null : row.ownerNow.id, live: row.ownerNow.live };
  return { project: row.ownerNow.project ?? row.project, pick: row.ownerNow.ifUnnamed ?? now, now, unmeasured: row.ownerNow.unmeasured === true };
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

/** The note under the owner select when the effective owner is inherited or cannot be measured. The empty option still names
 *  the project's own default, not the current owner. */
export function ownerInheritedNote(row: Pick<HierarchyProjectRow, 'project' | 'teamKey' | 'ownerNow'>): string | null {
  const { project, now, unmeasured } = ownerFrom(row);
  if (unmeasured) return 'The current Linear owner could not be measured.';
  if (project === row.project) return null;
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
    case 'unmeasured': return 'Not measured';
  }
}

/** The inbound line, or null when none wait. */
export const inboundWords = (n: number): string | null =>
  n <= 0 ? null : n === 1 ? '1 inbound issue waits for an owner' : `${n} inbound issues wait for an owner`;

/** The consequence line of the all-projects confirm. */
export const ownerForAllConsequence = (id: string): string =>
  `Every project with Linear settings gets ${id} as its Linear owner. Each project's other settings stay as they are.`;

// ── The compact list (D-8932) ─────────────────────────────────────────────────────────────────────

/** A listed row's owner, in a few words: who owns the project's team now. One word for "running", the select's own
 *  ("Default: none live", "(not live)"), so the line and the control under it never say one fact two ways. */
export function ownerShortWords(row: Pick<HierarchyProjectRow, 'project' | 'ownerNow'>): string {
  const { now, unmeasured } = ownerFrom(row);
  if (unmeasured) return 'owner not measured';
  if (now.id === null) return 'no live owner';
  return now.live ? `owner: ${now.id}` : `owner: ${now.id} (not live)`;
}

/** The inbound count on a listed row's line, or null when none wait. */
export const inboundShortWords = (n: number): string | null =>
  n <= 0 ? null : n === 1 ? '1 inbound issue waiting' : `${n} inbound issues waiting`;

/** Inbound issues that wait while no live coordinator owns the project's team, and the owner is this project's own to
 *  set: the count, else null. Not said of an owner that could not be measured (unknown is not "none"), nor of an owner
 *  that comes from another project (the project owning the shared key: its row holds the setting, and says so). */
export function inboundUnowned(row: Pick<HierarchyProjectRow, 'project' | 'teamKey' | 'ownerNow' | 'inboundWaiting'>): number | null {
  if (row.teamKey === null || row.inboundWaiting <= 0) return null;
  const { now, unmeasured } = ownerFrom(row);
  if (unmeasured || ownerIsInherited(row) || (now.id !== null && now.live)) return null;
  return row.inboundWaiting;
}

/** That reason, in words, with the control that settles it (the Linear owner select). */
export const inboundUnownedWords = (n: number): string =>
  `${inboundWords(n) ?? ''}, and this project has no live Linear owner. Choose a live coordinator as its Linear owner.`;

/** One option of a coordinator select. */
export interface CoordinatorOption { id: string; words: string }

/** How many live coordinators a coordinator select lists before it is asked for more. A fleet can have a live coordinator
 *  per project; past this many the select would be the wall of ids it replaces, so it then lists none until asked. */
export const COORDINATOR_SHORT_LIST = 8;

/** What a coordinator select offers (the row's Linear owner, and the one coordinator for every project).
 *  Until the operator asks for more (`showAll`): the live coordinators when they fit the short list, else none of them.
 *  Once asked: every live one, then the ones that are not live as a group of their own.
 *  `selected` is the chosen id as an option of its own when it is not among those offered (a not-live one while they are
 *  hidden, one past the short list, or one the list does not hold, worded by `unlisted`), so the select always shows what
 *  is stored. `more` is the words of the control that shows or hides the rest, or null when nothing is behind it. */
export function coordinatorChoices(
  list: readonly { id: string; live: boolean }[], selected: string | null, showAll: boolean, unlisted: (id: string) => string,
): { selected: CoordinatorOption | null; live: CoordinatorOption[]; notLive: CoordinatorOption[]; more: string | null } {
  const option = (c: { id: string; live: boolean }): CoordinatorOption => ({ id: c.id, words: coordinatorWords(c) });
  const lives = list.filter((c) => c.live).map(option);
  const rest = list.filter((c) => !c.live).map(option);
  const short = lives.length <= COORDINATOR_SHORT_LIST;
  const live = showAll || short ? lives : [];
  const notLive = showAll ? rest : [];
  const offered = selected !== null && [...live, ...notLive].some((c) => c.id === selected);
  const listed = selected === null ? undefined : [...lives, ...rest].find((c) => c.id === selected);
  const behind = short ? rest.length : list.length;
  return {
    selected: selected === null || offered ? null : listed ?? { id: selected, words: unlisted(selected) },
    live, notLive,
    more: behind === 0 ? null
      : short ? (showAll ? NOT_LIVE_WORDS.hide : NOT_LIVE_WORDS.show(behind))
        : (showAll ? NOT_LIVE_WORDS.fewer : NOT_LIVE_WORDS.showAll(behind)),
  };
}

/** A coordinator select's words for what it does not list at first. */
export const NOT_LIVE_WORDS = {
  group: 'Not live',
  show: (n: number): string => (n === 1 ? 'Show 1 coordinator that is not live' : `Show ${n} coordinators that are not live`),
  hide: 'Hide coordinators that are not live',
  showAll: (n: number): string => `Show all ${n} coordinators`,
  fewer: 'Show fewer coordinators',
} as const;

/** A team key several projects hold while none of them is its owning project: the key and the other projects, or null.
 *  Only holders that can be the same team count, as the server's owner rule reads them (`planPolicy.ts`
 *  `teamOwnerProject`, D-8808): a project whose key is stored in another Linear workspace holds another team, so it
 *  neither shares the key nor settles it. `workspaceOf` is each project's stored workspace; a project it does not name,
 *  or names with none, can be any workspace's. */
export function owningUnchosen(
  project: string, rows: readonly Pick<HierarchyProjectRow, 'project' | 'teamKey' | 'ownsTeam'>[],
  workspaceOf: ReadonlyMap<string, string | null> = new Map(),
): { key: string; others: string[] } | null {
  const mine = rows.find((r) => r.project === project)?.teamKey;
  if (mine === null || mine === undefined) return null;
  const key = mine.toUpperCase();
  const at = workspaceOf.get(project) ?? null;
  const sameTeam = (r: { project: string }): boolean => {
    const theirs = workspaceOf.get(r.project) ?? null;
    return r.project === project || at === null || theirs === null || at === theirs;
  };
  const holders = rows.filter((r) => r.teamKey !== null && r.teamKey.toUpperCase() === key && sameTeam(r));
  if (holders.length < 2 || holders.some((r) => r.ownsTeam)) return null;
  return { key: mine, others: holders.filter((r) => r.project !== project).map((r) => r.project) };
}

/** That reason, in words: who else holds the key, what the box does meanwhile (the first project that set the key owns
 *  it, `planPolicy.ts` `rankHolders`), and the control that settles it. */
export const owningUnchosenWords = (s: { key: string; others: readonly string[] }): string =>
  `Team key ${s.key} is also used by ${s.others.join(', ')}, and no project is chosen as its owning project. `
  + `Until one is, the project that set the key first owns it. Tick ${HIERARCHY_TEXT.owning} on the one that should.`;

/** The reason a row with a map waiting says. */
export const mapWaitingWords = (team: string | null): string =>
  `A map of how ${team === null ? 'this team' : `team ${team}`} fits the plan waits for your approval.`;
