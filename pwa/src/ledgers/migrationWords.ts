// The words of the six hierarchy items' controls and of the map and report body (Linear hierarchy design §11.3 and §11.4,
// D-8184, D-8737). L1: pure, no I/O. The sentences a refusal says are `refusalWords.ts`'s (`linearItemErrorText`).
import type { LinearActionVerb } from '../../../shared/ledgers';
import { MAP_CLASSES, type MapClass, type MapCounts, type MapEntry, type MigrationView, type MigrationWaitingWhy } from '../../../shared/plan';

/** The controls' labels, once. `hand` is `ITEM_DOOR_WORDS['hand-to-coordinator']`, which `LinearItemControls` reads. */
export const LINEAR_ITEM_TEXT = {
  approve: 'Approve', approveTitle: 'Approve this map?', approveConfirm: 'Approve map',
  approveConsequence: "The migration starts. Every move is recorded, so the team can be put back.",
  return: 'Return', note: 'Note to the Linear owner',
  putBack: 'Put back', putBackTitle: 'Put the team back?', putBackConfirm: 'Put the team back',
  putBackConsequence: 'Every issue that moved goes back where it was. An issue that has changed since is left as it is.',
  done: 'Done', keep: 'Keep the plan', checkAgain: 'Check again', name: 'Name', pick: 'Coordinator to name',
  pickNone: 'Choose a coordinator', nameTitle: 'Name this coordinator the Linear owner?', nameConfirm: 'Make owner',
  noneLive: 'No coordinator is live now, so there is none to name. Start one, then name it.',
  unread: 'The coordinators could not be read, so none can be named now. Reload the item to try again.',
  queued: 'The check is queued. This item closes when Linear answers.', sent: 'Sent.',
  notQueued: 'Nothing was queued: this server has no check it can run for this workspace (no Linear key serves it, or the plan sync is off). The item stays open.',
  /** D-8808: the shared-key item has no act; its remedy is the project row's Workspace, on the page the link opens. */
  openSettings: 'Open the Linear project settings',
  teamWorkspace: (team: string) => `On the row of the project that owns team ${team}, choose its Workspace, then Save. This item closes itself once no waiting issue of the team depends on the workspace choice.`,
} as const;

/** What each control group is called to a screen reader (the group's `aria-label`): a sentence, never the verb. */
export const LINEAR_GROUP_WORDS: Readonly<Record<LinearActionVerb, string>> = {
  'linear-map': 'Act on the map', 'linear-report': 'Act on the report', 'linear-drift': 'Act on the drift',
  'linear-initiatives': 'Act on the initiatives check', 'linear-owner': 'Name the Linear owner',
  'linear-team-workspace': "Choose the team's workspace",
};

/** The map and report body's own sentences: its two region names and its table's three headers. */
export const MIGRATION_BODY_TEXT = {
  map: 'The map', report: 'The report', issue: 'Issue', class: 'Class', target: 'Target',
  structure: 'Programmes and epics', backlog: 'new, paused', declared: 'declared by this map', noEpics: 'No epics listed',
  checkpoints: 'Checkpoints',
  /** The quiet note when the migration could not be read: the item keeps its why, how and controls (D-8186). */
  unread: 'The map could not be read just now, so its body is not shown. Reload the item to try again.',
} as const;

/** The report's lists in the order they read, each only when it holds something (design §11.4): the issues skipped because they
 *  had changed, those the team's Linear owner took through inbound, which left the migration (review 2955 F2, A1), those still
 *  waiting, the replaced levels closed with no ticket placed under them (review 2918 F2), and after a put back the issues moved
 *  since and the milestones left under the canceled project. */
export const REPORT_LISTS = [
  { key: 'skipped', title: 'Skipped as changed' }, { key: 'taken', title: 'Taken by the Linear owner' }, { key: 'waiting', title: 'Still waiting' },
  { key: 'unrelated', title: 'Closed with no ticket placed under them' },
  { key: 'movedSince', title: 'Moved since' }, { key: 'milestonesLeft', title: 'Milestones left' },
] as const;
/** Why a waiting issue waits, as the report says it (review 2892 F3). */
export const WAITING_WHY_WORDS: Readonly<Record<MigrationWaitingWhy, string>> = {
  'live-programme': 'its programme is mid-wave; it moves at the wave boundary',
  'epic-not-in-linear': 'its epic is not in Linear yet',
  'upkeep-not-in-linear': 'the project\'s Upkeep epic is not in Linear yet',
  'placed-ticket-not-applied': 'a ticket under it is still to be placed, or placed and not settled yet; it closes related to the first one placed, or with no relation if none is placed (each skipped, or taken by the Linear owner)',
};
export const reportLists = (r: NonNullable<MigrationView['report']> | null | undefined): { key: (typeof REPORT_LISTS)[number]['key']; title: string; items: string[] }[] =>
  r === null || r === undefined ? [] : REPORT_LISTS.map((l) => ({
    key: l.key, title: l.title,
    items: l.key === 'waiting' ? r.waiting.map((id) => { const why = r.waitingWhy?.[id]; return why === undefined ? id : `${id}: ${WAITING_WHY_WORDS[why]}`; }) : r[l.key] ?? [],
  })).filter((l) => l.items.length > 0);

export const nameConsequence = (project: string, id: string): string => `${id} becomes the Linear owner of ${project}.`;

/** The classes' words. */
export const MAP_CLASS_WORDS: Readonly<Record<MapClass, string>> = {
  programme: 'Programme', epic: 'Epic', checkpoint: 'Checkpoint', leaf: 'Ticket', upkeep: 'Upkeep',
  finished: 'Finished', superseded: 'Superseded', stale: 'Stale', unclear: 'Unclear',
};

/** The counts in the order the spec gives them: created, moved, closed, skipped as changed, left. */
export function countWords(c: MapCounts): { key: keyof MapCounts; n: number; word: string }[] {
  return [
    { key: 'created', n: c.created, word: 'created' }, { key: 'moved', n: c.moved, word: 'moved' },
    { key: 'closed', n: c.closed, word: 'closed' }, { key: 'skipped', n: c.skipped, word: 'skipped as changed' },
    { key: 'left', n: c.left, word: 'left' },
  ];
}

/** The target as one plain string: programme, epic, checkpoint, ticket, what it is succeeded by. Empty when it names nothing. */
export function targetWords(t: MapEntry['target']): string {
  if (t === undefined) return '';
  const path = [t.programme, t.epic, t.checkpoint].filter((p): p is string => p !== undefined).join(' / ');
  const parts = [path, t.ticketKey === undefined ? '' : `ticket ${t.ticketKey}`, t.kind ?? '', t.successor === undefined ? '' : `succeeded by ${t.successor}`];
  return parts.filter((p) => p !== '').join(', ');
}

/** The entries grouped by class, in `MAP_CLASSES` order; a class with no entry has no group. */
export const groupEntries = (entries: readonly MapEntry[]): { class: MapClass; entries: MapEntry[] }[] =>
  MAP_CLASSES.map((c) => ({ class: c, entries: entries.filter((e) => e.class === c) })).filter((g) => g.entries.length > 0);
