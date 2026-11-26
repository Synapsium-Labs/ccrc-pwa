// The words of one project's landing line on its card, and of the operator's two doors (landing order wave 5k). L1:
// types from the shared landing vocabulary, the API client's error class and its outcome rule, and the PWA's one refusal
// reader; never a screen, a store or `lib/api.ts`.
//
// Every sentence the wave ships is here, once (the plan's section 4.2). No sentence says whether a change took effect:
// `OUTCOME_UNKNOWN_TAIL` says it, appended inside `landingFailureOf`'s text from the refusal body's `mayApply`, the
// server's one fact (R5; the plan's section 11, C1), or when no readable word came back from a write. A read's sentence
// never carries the tail, and it is only ever drawn after `STALE_PREFIX` (section 11, C3).
import type {
  LandingEjectionKind, LandingInfrastructureCode, LandingMutationCode, LandingNoticeOutcome, LandingPauseBy,
} from '../../../shared/landingLine';
import { ApiError, writeOutcomeUnknown } from '../lib/apiError';
import { refusalText } from '../lib/refusalWords';

/** Every word a landing route can answer the console: the line's two code unions and four route words. */
export type LandingRouteWord = LandingInfrastructureCode | LandingMutationCode | 'run-unreadable' | 'bad-request' | 'not-configured' | 'unauthenticated';
/** Where a read failure is drawn (D-9109, round 2): `box` only over a line already drawn, `absent` nowhere. */
export type LandingFailureScope = 'box' | 'absent';

/** Text and scope only: whether a refusal may have applied is the body's `mayApply`, the server's one fact (R5). Each
 *  sentence is true on every door that can answer its word. */
export const LANDING_ROUTE_WORDS: Readonly<Record<LandingRouteWord, { text: string; scope: LandingFailureScope }>> = {
  'landing-journal-unavailable': { scope: 'box', text: 'The landing line\'s journal could not be opened, so nothing was read or changed. Try again in a minute; if it stays, the server needs a restart.' },
  'landing-journal-unreadable': { scope: 'box', text: 'The landing line\'s journal could not be read, so nothing was read or changed. If it stays, the server needs a restart.' },
  'landing-journal-invalid': { scope: 'box', text: 'The landing line\'s journal holds a record this server cannot read, so nothing was read or changed. The line stays stopped until the journal is repaired.' },
  'landing-journal-missing': { scope: 'box', text: 'The landing line\'s journal is missing on the server, so nothing was read or changed. The line stays stopped until the journal is back.' },
  'landing-journal-cursor': { scope: 'box', text: 'The landing database and its journal disagree about how far the journal was applied, so nothing was read or changed. A restart replays the journal.' },
  'landing-journal-changed': { scope: 'box', text: 'The landing line\'s journal changed while the server read it, so nothing was changed. Try again.' },
  'landing-journal-durability': { scope: 'box', text: 'The server could not confirm its journal reached its disk, so the line stays stopped until the server replays the journal.' },
  'landing-journal-append': { scope: 'box', text: 'The server could not finish writing the journal.' },
  'landing-db-unavailable': { scope: 'box', text: 'The coordination database is not available, so the landing line was not read or changed. Try again in a minute.' },
  'landing-db-apply': { scope: 'box', text: 'The server wrote the journal but could not apply it. The server\'s next replay of its journal settles it.' },
  'landing-db-commit': { scope: 'box', text: 'The server could not commit the change. The server\'s next replay of its journal settles it.' },
  'landing-fenced': { scope: 'box', text: 'The landing line is stopped after an earlier failure. It reads and changes nothing until the server replays its journal or restarts.' },
  'landing-projection-unreadable': { scope: 'box', text: 'A record of the landing line does not read, so nothing was read or changed. A replay or a restart does not fix it; the record needs repair.' },
  'landing-entry-exists': { scope: 'box', text: 'That pull request already has an entry in the line, so nothing was changed.' },
  'landing-entry-missing': { scope: 'box', text: 'That pull request has no entry in this project\'s line any more, so nothing was changed. The line is read again.' },
  'landing-after-missing': { scope: 'box', text: 'An order named an entry that is not in the line, so nothing was changed.' },
  'landing-after-cross-project': { scope: 'box', text: 'An order named an entry of another project, so nothing was changed.' },
  'landing-cycle': { scope: 'box', text: 'That order would make entries wait on each other in a circle, so nothing was changed.' },
  'landing-dependencies-unreadable': { scope: 'box', text: 'An entry\'s order could not be read, so nothing was changed.' },
  'landing-recovery-unresolved': { scope: 'box', text: 'This entry\'s records are still being recovered, so it cannot be withdrawn yet. Nothing was changed.' },
  'landing-identity-conflict': { scope: 'box', text: 'Two records of this line claim the same entry, so nothing can be withdrawn until that is repaired. Nothing was changed.' },
  'landing-id-overflow': { scope: 'box', text: 'The line has run out of entry numbers, so nothing was changed.' },
  'landing-sequence-overflow': { scope: 'box', text: 'The landing journal has run out of sequence numbers, so nothing was changed.' },
  'landing-entry-terminal': { scope: 'box', text: 'That entry has already left the line: it landed, was closed or was withdrawn. Nothing was changed; the line is read again.' },
  'landing-entry-moved': { scope: 'box', text: 'The server\'s record of that entry does not match what this screen read, so nothing was withdrawn. The line is read again; look at it and confirm again if you still mean to.' },
  'landing-project-unknown': { scope: 'box', text: 'The landing line has never seen this project, so there is nothing to pause. Nothing was changed.' },
  'landing-record-unparseable': { scope: 'box', text: 'The server built a journal record its own reader refuses, so it wrote nothing. Nothing was changed; this is a server defect worth reporting.' },
  'run-unreadable': { scope: 'box', text: 'The run behind this entry could not be read, so the server could not tell who to notify and withdrew nothing. Trying again does not help until the run or the entry\'s record is repaired.' },
  'bad-request': { scope: 'box', text: 'The server refused the request as malformed, so nothing was changed. This page and the server may be out of step; reload the page.' },
  'not-configured': { scope: 'absent', text: 'This box runs no coordination, so it has no landing line.' },
  'unauthenticated': { scope: 'box', text: 'Your sign-in has lapsed, so nothing was changed. Sign in again and retry.' },
};
/** Derived from `LANDING_ROUTE_WORDS`, so `refusalText` can read it; never hand-kept. */
export const LANDING_ROUTE_TEXT = Object.fromEntries(
  Object.entries(LANDING_ROUTE_WORDS).map(([word, w]) => [word, w.text])) as Readonly<Record<LandingRouteWord, string>>;

export const UNKNOWN_WORD_TEXT = (word: string): string =>
  `The server refused this with a word this page does not know (\`${word}\`). Nothing here assumes it worked.`;
export const UNKNOWN_WORD_READ_TEXT = (word: string): string => `The server answered with a word this page does not know (\`${word}\`).`;
export const UNWORDED_TEXT = (status: number): string =>
  `The server answered ${status} without a word this page can read. Nothing here assumes it worked.`;
export const UNWORDED_READ_TEXT = (status: number): string => `The server answered ${status} without a word this page can read.`;
export const UNREACHABLE_READ_TEXT = 'The server could not be reached or did not answer in time.';
export const UNREACHABLE_WRITE_TEXT = 'The server could not be reached or did not answer.';
export const OUTCOME_UNKNOWN_TAIL = ' Whether this change took effect is not known; the line is read again to show what stands.';
export const UNREADABLE_ANSWER_TEXT = 'The server answered with a line this page cannot read. Reload the page; if it stays, this page and the server are out of step.';
export const STALE_PREFIX = 'Not read again: ';

export type LandingDoor = 'read' | 'pause' | 'withdraw';
export interface LandingFailure { text: string; scope: LandingFailureScope; outcomeUnknown: boolean }

/** A failed call's sentence and scope, by the plan's four rules, first match wins (section 4.2). Never throws, never
 *  answers an empty sentence. A write's sentence ends with `OUTCOME_UNKNOWN_TAIL` exactly when `outcomeUnknown`. */
export function landingFailureOf(err: unknown, door: LandingDoor): LandingFailure {
  const write = door !== 'read';
  const done = (text: string, scope: LandingFailureScope, outcomeUnknown: boolean): LandingFailure =>
    ({ text: outcomeUnknown ? text + OUTCOME_UNKNOWN_TAIL : text, scope, outcomeUnknown });
  if (!(err instanceof ApiError)) return done(write ? UNREACHABLE_WRITE_TEXT : UNREACHABLE_READ_TEXT, 'box', write);
  const body = typeof err.body === 'object' && err.body !== null ? (err.body as { error?: unknown; mayApply?: unknown }) : null;
  const word = body !== null && typeof body.error === 'string' ? body.error : null;
  if (body === null || word === null) {
    return done(write ? UNWORDED_TEXT(err.status) : UNWORDED_READ_TEXT(err.status), 'box', write && writeOutcomeUnknown(err));
  }
  const mayApply = body.mayApply === true;
  const known = refusalText(err, LANDING_ROUTE_TEXT);
  if (known !== null && Object.hasOwn(LANDING_ROUTE_WORDS, word)) {
    return done(known, LANDING_ROUTE_WORDS[word as LandingRouteWord].scope, write && mayApply);
  }
  return done(write ? UNKNOWN_WORD_TEXT(word) : UNKNOWN_WORD_READ_TEXT(word), 'box', write && (mayApply || err.status >= 500));
}

type NoticeWord = LandingNoticeOutcome['word'];
/** `#<pr>`, or `entry <id>` when the line as read does not name the entry's PR. */
const refOf = (pr: number | null, entryId: number): string => (pr === null ? `entry ${entryId}` : `#${pr}`);
const QUEUED_TEXT: Readonly<Record<NoticeWord, (toId: string, ref: string) => string>> = {
  'landing-withdrawn': (toId) => `Told ${toId}, its coordinator.`,
  'landing-held': (toId, ref) => `Told ${toId}, coordinator of ${ref}, which now waits on it.`,
};
const NONE_TEXT: Readonly<Record<Extract<LandingNoticeOutcome, { kind: 'none' }>['reason'], (ref: string) => string>> = {
  unclaimed: (ref) => `No one to tell about ${ref}: its run has no coordinator.`,
  unrecorded: (ref) => `No one to tell about ${ref}: no coordinator was recorded when it entered the line.`,
};
const NOTICE_TEXT: { readonly [K in LandingNoticeOutcome['kind']]: (o: Extract<LandingNoticeOutcome, { kind: K }>, ref: string) => string } = {
  queued: (o, ref) => QUEUED_TEXT[o.word](o.toId, ref),
  none: (o, ref) => NONE_TEXT[o.reason](ref),
  unreadable: (_o, ref) => `Could not tell the coordinator of ${ref}: its run could not be read.`,
};
/** One sentence per notice outcome: `#<pr>` is the withdrawn entry's for `landing-withdrawn` and the dependant's (from
 *  `prOf`, the line as read) for `landing-held`, `entry <id>` when `prOf` answers `null`. */
export function landingNoticeText(o: LandingNoticeOutcome, withdrawnPr: number, prOf: (entryId: number) => number | null): string {
  const ref: Record<NoticeWord, () => string> = {
    'landing-withdrawn': () => `#${withdrawnPr}`,
    'landing-held': () => refOf(prOf(o.entryId), o.entryId),
  };
  return (NOTICE_TEXT[o.kind] as (x: LandingNoticeOutcome, r: string) => string)(o, ref[o.word]());
}

// The line's words.
export const LINE_TITLE = 'Landing line';
export const STATUS_RUNNING = (pr: number): string => `Next to land: #${pr}.`;
export const STATUS_NONE_READY = 'No entry can land yet.';
export const PAUSE_BY_TEXT: Readonly<Record<LandingPauseBy, string>> = { operator: 'by you', 'main-red': 'because main is red' };
/** `Paused` + the `by` words joined with ` and `, in the read's order, + `. Nothing lands.` */
export const STATUS_PAUSED = (by: readonly LandingPauseBy[]): string =>
  ['Paused', by.map((b) => PAUSE_BY_TEXT[b]).join(' and ')].filter((s) => s !== '').join(' ') + '. Nothing lands.';
export const STATUS_HELD = 'Held: some of this line\'s records are being recovered. Nothing lands until they are.';
export const STATUS_RED_FIXES_MAIN = (pr: number): string => `Main is red. Only #${pr}, which fixes main, may land.`;
export const ROLE_TEXT = {
  head: 'next to land',
  'in-line': 'in line',
  unknown: 'set aside: its record does not read as a current pin, so it is not in the order',
} as const;
export const WAITS_TEXT = (prs: readonly number[]): string => 'waits on ' + prs.map((pr) => `#${pr} (withdrawn)`).join(', ');
export const EJECTION_TEXT: Readonly<Record<LandingEjectionKind, string>> = {
  dequeued: 'dequeued by the merge queue', 'new-head': 'its head moved', conflict: 'it conflicts with main',
};
export const EJECTED_TEXT = (kind: LandingEjectionKind | null): string =>
  'sent back for a fix round' + (kind === null ? '' : ` (${EJECTION_TEXT[kind]})`);
export const TAG_FIXES_MAIN = 'fixes main';
export const TAG_NO_RUN = 'no run';
export const PAUSE_LABEL = { pause: 'Pause line', resume: 'Resume line', pausing: 'Pausing…', resuming: 'Resuming…' } as const;
/** The pause control's accessible name. */
export const PAUSE_NAME = (label: string, project: string): string => `${label} for ${project}`;
export const WITHDRAW_VISIBLE = 'Withdraw…';
/** The withdraw button's accessible name. */
export const WITHDRAW_LABEL = (pr: number, project: string): string => `Withdraw #${pr} from ${project}'s landing line`;

// The sheet's words: section 9 block 3's truth for an operator who has not read it.
export const SHEET_TITLE = (pr: number): string => `Withdraw #${pr}?`;
export const SHEET_LEAVES = (pr: number, project: string): string => `#${pr} leaves ${project}'s landing line and will not land from it.`;
export const SHEET_FREES_NOTHING = 'Nothing that waits on it is freed. An entry declared after it keeps waiting until a session declares its order again without it, or until it comes back and then lands or is closed.';
export const SHEET_DEPENDANTS = (prs: readonly number[]): string => (prs.length === 0
  ? 'As this page read the line, no open entry waits on it directly.'
  : `As this page read the line, these open entries wait on it directly: ${prs.map((pr) => `#${pr}`).join(', ')}.`);
export const SHEET_AS_READ = 'After you confirm, the server names everyone it told.';
export const SHEET_TOLD = 'Its coordinator, and the coordinator of each entry that waits on it, are told by mail where one is recorded and reads.';
export const SHEET_COMES_BACK = 'It comes back if its run is pinned at merging again.';
export const SHEET_NO_RUN = 'It has no run, so it cannot come back into the line.';
export const SHEET_GITHUB = 'It does not stop a merge GitHub has already queued.';
export const SHEET_CONFIRM = (pr: number): string => `Withdraw #${pr}`;
export const SHEET_CONFIRM_BUSY = 'Withdrawing…';
export const SHEET_CANCEL = 'Cancel';
export const SHEET_DONE = (pr: number): string => `Withdrawn: #${pr} is out of the line. Nothing that waited on it was freed.`;
export const SHEET_GONE = (pr: number): string => `#${pr} is no longer in the line as last read, so there is nothing to withdraw.`;
export const SHEET_DONE_BUTTON = 'Done';
