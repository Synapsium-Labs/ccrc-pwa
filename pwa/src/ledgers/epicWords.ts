// The epic page's and the Upkeep page's words (Linear hierarchy design 2026-11-10 §11.2 and §7.6, D-8184). L1: pure, no I/O.
// Every heading, empty state and state word the two pages say lives here; `EpicBody` holds no sentence. A title, a summary and
// an issue identifier come from Linear or from a reporter and are drawn as plain text by the screens, never through here.
import { releaseDate } from '../lib/format';
import type { CheckpointEvidence, CheckpointState, EpicState, TicketKind, TicketState } from '../../../shared/plan';

export const EPIC_TEXT = {
  kicker: 'Epic',
  upkeepKicker: 'Project',
  upkeepTitle: 'Upkeep',
  checkpoints: 'Checkpoints',
  tickets: 'Tickets',
  noCheckpoints: 'This epic has no checkpoints.',
  noTickets: 'This epic has no tickets.',
  openInLinear: 'Open in Linear',
  noSuchEpic: 'No such epic in this programme',
  noSuchProgramme: 'No such programme',
  reading: 'Reading the plan…',
  readFailed: 'The page could not be read. Reload it to try again.',
  readingUpkeep: 'Reading the Upkeep epic…',
  noUpkeepYet: 'The Upkeep epic has not been used yet. It is created when the first issue is filed into it.',
  notClosedHeading: 'Closes Linear refused',
  notClosedNone: 'Every close ccrc made in Linear went through.',
  backProgramme: 'Back to the programme',
  backSettings: 'Back to Settings',
} as const;

const EPIC_STATE_WORDS: Record<EpicState, string> = { planned: 'Planned', active: 'Active', done: 'Done', dropped: 'Dropped' };
const CHECKPOINT_STATE_WORDS: Record<CheckpointState, string> = { open: 'Open', met: 'Met', dropped: 'Dropped' };
const TICKET_STATE_WORDS: Record<TicketState, string> = { open: 'Open', started: 'Started', done: 'Done', dropped: 'Dropped' };
const TICKET_KIND_WORDS: Record<TicketKind, string> = { work: 'Work', task: 'Task', bug: 'Bug', 'follow-up': 'Follow-up' };

export const epicStateWords = (s: EpicState): string => EPIC_STATE_WORDS[s];
export const checkpointStateWords = (s: CheckpointState): string => CHECKPOINT_STATE_WORDS[s];
export const ticketStateWords = (s: TicketState): string => TICKET_STATE_WORDS[s];
export const ticketKindWords = (k: TicketKind): string => TICKET_KIND_WORDS[k];

/** A date as the page says it, `YYYY-MM-DD` (UTC), or the missing mark for a stamp this build's `Date` cannot place: the fleet's one
 *  formatter, `lib/format.ts`'s `releaseDate`, so a bad stamp never throws during render. */
export const dayWords = (ms: number): string => releaseDate(ms);

/** A met checkpoint's date (the state word beside it says "Met"), or null for one not met (or met with no stamp). */
export const metWords = (state: CheckpointState, metAt: number | null): string | null =>
  state === 'met' && metAt !== null ? dayWords(metAt) : null;

/** The evidence's text: a pull request, an item or a repository path. The screens link it where they can. */
export function evidenceWords(e: CheckpointEvidence): string {
  if ('pr' in e) return `PR #${e.pr}`;
  if ('itemId' in e) return `Item #${e.itemId}`;
  return e.path;
}

/** The words a given-up close records (`inboundPolicy.ts`: `inboundActVerdict` gives up on any word outside `RETRY_WORDS`, and
 *  `malformed` once past its cap): the ones Linear's close can answer (`ops.ts` `LinearAnswerRefusalWord`) and the write policy's
 *  denial (`policy-denied`). A retry word never reaches the record. Any other token keeps its own word in a fixed frame. */
const NOT_CLOSED_WORDS: Readonly<Record<string, string>> = {
  'not-found': 'The issue is gone from Linear',
  'linear-forbidden': 'Linear refused the close: no permission',
  'linear-invalid': 'Linear did not accept the close',
  malformed: 'Linear answered in a form ccrc could not read',
  'policy-denied': 'The write policy denied the close',
};
export const notClosedWords = (word: string): string =>
  Object.hasOwn(NOT_CLOSED_WORDS, word) ? NOT_CLOSED_WORDS[word]! : `Linear refused the close (${word})`;

/** A ticket's run link text. */
export const runWords = (id: number): string => `Run ${id}`;

/** An address from Linear that the page links: `https` only, else null (no link, never a script or a data address). */
export const linearHref = (url: string | null): string | null => (url !== null && /^https:\/\//i.test(url) ? url : null);
