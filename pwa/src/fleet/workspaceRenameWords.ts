// Every way `POST /api/sessions/:id/title` can say no, read once and said in its own sentence (named workspaces S9,
// design 2026-10-20 §6), and the Rename sheet's own words. L1: pure, no I/O. `workspaceAddWords.ts`'s twin for the
// rename door: the sheet keeps the operator's text on EVERY refusal and shows the sentence beside the field, so what
// matters here is that no two refusals read alike and that none shows the server's own text except ccd's stderr (the
// 502, which is all the operator has to go on).
//
// TWO FUNCTIONS, ON PURPOSE, as there. `classifyRenameError` turns what was thrown into a typed refusal (the wire
// reader: status AND word, never a status alone: 400 and 502 each mean several things here); `renameRefusalText`
// turns that into the sentence.
//
// THE PWA DOES NOT KNOW WHAT `ccd caps` LISTS, so it cannot hide Rename on a box whose ccd predates the verb. The
// server's `501 unsupported` (`needs: 'ws-title'`) is read here and said plainly instead.
import { ApiError } from '../lib/apiError';
import { BAD_TITLE_REASONS, type BadTitleReason } from '../../../shared/refusal';
import { NAME_REFUSAL_TEXT, isNameRefusal, type NameRefusal } from '../../../shared/slug';
import { BAD_REQUEST_TEXT } from './workspaceAddWords';
import { BLANK_TITLE_TEXT } from './workspaceNameWords';

/** The rename sheet's own words, spelled once. */
export const RENAME_TEXT = {
  eyebrow: 'rename workspace',
  title: 'Rename workspace',
  placeholder: 'A title, a ticket id or a link',
  save: 'Save title',
  saveBusy: 'Saving…',
  clear: 'Clear title',
  clearBusy: 'Clearing…',
  cancel: 'Cancel',
  /** The field is as the workspace has it: nothing to save. */
  unchanged: 'This is the current title. Change it to save a new one.',
  /** Emptied: the confirm is now "Clear title". */
  clearHint: 'Clearing the title hands this workspace back to the automatic namer.',
  /** Empty, and the workspace has no title to clear. */
  automatic: 'This workspace is named automatically. Type a title to name it yourself.',
} as const;

/** The line under the preview: the slug is not what a rename changes. */
export const slugStays = (slug: string): string => `slug stays ${slug}`;

export type RenameRefusal =
  | { kind: 'bad-request' }
  | { kind: 'bad-session-id' }
  | { kind: 'name-too-long' }
  /** `reason` is null for a word this build does not know: the sentence is then the generic one. */
  | { kind: 'bad-name'; reason: NameRefusal | null }
  /** ccd refused text the server had already sanitised, so the two sanitisers disagree; the reason is ccd's rule. */
  | { kind: 'bad-title'; reason: BadTitleReason | null }
  | { kind: 'not-a-workspace' }
  | { kind: 'unknown-session' }
  /** The fleet box's ccd does not list the verb `ws-title`. */
  | { kind: 'unsupported' }
  /** The box could not write (or remove) one of the two registry fields: the change may be half-made. */
  | { kind: 'not-saved' }
  /** The fleet box ran ccd and ccd failed: its stderr, trimmed, or null when there was none to show. */
  | { kind: 'ccd-failed'; stderr: string | null }
  /** The request never produced an answer (offline, a dropped connection): the rename may or may not have landed. */
  | { kind: 'unreached' }
  /** An answer this build has no word for. The status is kept for the sentence. */
  | { kind: 'other'; status: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const badTitleReason = (v: unknown): BadTitleReason | null =>
  BAD_TITLE_REASONS.find((r) => r === v) ?? null;

export function classifyRenameError(err: unknown): RenameRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unreached' };
  const body = isRecord(err.body) ? err.body : {};
  const word = typeof body.error === 'string' ? body.error : null;
  if (err.status === 400) {
    switch (word) {
      case 'bad-request': return { kind: 'bad-request' };
      case 'bad-session-id': return { kind: 'bad-session-id' };
      case 'name-too-long': return { kind: 'name-too-long' };
      case 'bad-name': return { kind: 'bad-name', reason: isNameRefusal(body.reason) ? body.reason : null };
      case 'bad-title': return { kind: 'bad-title', reason: badTitleReason(body.reason) };
    }
  }
  if (err.status === 404 && word === 'unknown-session') return { kind: 'unknown-session' };
  if (err.status === 409 && word === 'not-a-workspace') return { kind: 'not-a-workspace' };
  if (err.status === 501 && word === 'unsupported') return { kind: 'unsupported' };
  if (err.status === 502) {
    if (word === 'title-not-saved') return { kind: 'not-saved' };
    const stderr = typeof body.stderr === 'string' ? body.stderr.trim() : '';
    return { kind: 'ccd-failed', stderr: stderr === '' ? null : stderr };
  }
  return { kind: 'other', status: err.status };
}

const BAD_TITLE_TEXT: Record<BadTitleReason, string> = {
  'blank': "The fleet box's ccd says that title is blank. Type one, or clear the title instead.",
  'control-characters': "The fleet box's ccd says that title has a control character in it. Retype it without pasting.",
  'too-long': "The fleet box's ccd says that title is too long. Shorten it, or paste just the ticket id.",
};

/** One sentence per refusal, none a prefix of another (`workspace-rename-words.test.ts` holds the set apart). */
export function renameRefusalText(r: RenameRefusal): string {
  switch (r.kind) {
    case 'bad-request': return BAD_REQUEST_TEXT;
    case 'bad-session-id': return "This session's id isn't valid, so it can't be renamed. Reload the page.";
    case 'name-too-long': return 'That title is too long. Shorten it, or paste just the ticket id.';
    // A rename is not bound by the slug grammar, so the one `bad-name` this server answers is a title with nothing in it;
    // any other reason is an older box, and its words stand.
    case 'bad-name': return r.reason === null ? "That title can't be used. Change it and try again."
      : r.reason === 'no-usable-characters' ? BLANK_TITLE_TEXT : NAME_REFUSAL_TEXT[r.reason];
    case 'bad-title': return r.reason === null
      ? "The fleet box's ccd refused that title. Change it and try again."
      : BAD_TITLE_TEXT[r.reason];
    case 'not-a-workspace': return 'A main checkout is named for its project, so it has no workspace title to change.';
    case 'unknown-session': return 'The fleet box has no record of this session any more. Check the board.';
    case 'unsupported': return "The fleet box's ccd is too old to rename a workspace. Update the fleet box.";
    case 'not-saved': return "The fleet box couldn't finish writing the title, so it may be half changed. Try again.";
    case 'ccd-failed': return r.stderr === null
      ? "The fleet box couldn't rename the workspace, and gave no reason."
      : `The fleet box couldn't rename the workspace: ${r.stderr}`;
    case 'unreached': return "Couldn't reach the server, so the title may not have changed. Check the board before trying again.";
    case 'other': return `The title wasn't changed (the server answered ${r.status}).`;
  }
}
