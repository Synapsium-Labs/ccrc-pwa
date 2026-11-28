// Settings › Overlord's private-name list: its words and its pure readers (Overlord W2 Settings, plan `w2-settings.md` Tasks 1
// and 3; spec 2026-11-09 §9.4 rule 7; the private-names plan's question 9). Ring L1: no store, no React, no DOM, no clock and no
// `lib/api.ts`. It imports L0 shared vocabulary, `lib/apiError.ts` and `lib/wire.ts` only, so the server's mutation floors can
// load it (the section's refusal table, which a refused upload falls back to, is handed in by the card). `PrivateNamesCard.tsx`
// (L4) draws what these answer.
//
// THE NAMES NEVER PASS THROUGH HERE ON THEIR WAY TO A SCREEN. `nameListRowsOf` turns the operator's text into the upload's rows for
// one request, and returns them to the caller only; nothing here keeps, logs or words a name. A refusal names a line by its number
// and a closed reason (`NAME_LIST_ROW_REFUSALS`), never its text.
//
// THE DOOR IS THE PARSER (the brief's ruling 4). The text is one name per line, with an optional mode word and a colon in front
// (`exact: some-name`); a line without one is `part`, the committed list's default, and a blank line is skipped. That is the
// console's own text format, and it is all this file reads: the caps, the characters and the tokens are the door's
// (`bad-request` with the row's index and its reason), which this file turns back into the line it came from. Text with no name
// in it is refused here as `empty`, so Upload never sends an empty list: emptying the list is the confirmed "Clear the list", which
// sends the door's own clear flag (ruling 4, the plan's F6).
import {
  NAME_LIST_MAX_CHARS, NAME_LIST_MODES, NAME_LIST_ROW_REFUSALS, NAME_LIST_UNREADABLE, type NameListMode, type NameListRow, type NameListRowRefusal,
  type NameListStatus, type NameListUnreadable,
} from '../../../shared/privateNames';
import { ApiError } from '../lib/apiError';
import { isCount, isOneOf, isRecord as isObj } from '../lib/wire';

/** The status read's one reader (`GET /api/overlord/private-names`): one of its three answers, or null for one it cannot read. */
export function nameListStatusOf(body: unknown): NameListStatus | null {
  if (!isObj(body)) return null;
  if (body.state === 'none') return { state: 'none' };
  if (body.state === 'list') return isCount(body.rows) && isCount(body.uploadedAt) ? { state: 'list', rows: body.rows, uploadedAt: body.uploadedAt } : null;
  if (body.state === 'unreadable') {
    return isOneOf(NAME_LIST_UNREADABLE, body.reason) ? { state: 'unreadable', reason: body.reason } : null;
  }
  return null;
}

/** Why a list cannot be read, one phrase per reason (`NAME_LIST_UNREADABLE`, a closed list). */
export const NAME_LIST_UNREADABLE_TEXT: Readonly<Record<NameListUnreadable, string>> = {
  store: 'the private store could not be read',
  'list-missing': 'its key is stored but the list is not',
  'key-missing': 'the list is stored but its key is not',
  'key-unreadable': 'its key could not be read',
  'key-mismatch': 'the list was not made under the key the server holds',
};

/** The word the operator types before the colon for each mode (`NAME_LIST_MODES`, the matcher's list): typed over the shared list,
 *  so a mode it gains without a word is a compile error, and every sentence that names the modes is built from it. */
export const NAME_LIST_MODE_WORDS: Readonly<Record<NameListMode, string>> = { part: 'part', exact: 'exact', run: 'run', words: 'words' };
/** A line with no mode word in front of it: the committed list's default. */
const DEFAULT_MODE: NameListMode = 'part';
const orList = (xs: readonly string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const ALL_MODES = orList(NAME_LIST_MODES.map((m) => NAME_LIST_MODE_WORDS[m]));
const OTHER_MODES = orList(NAME_LIST_MODES.filter((m) => m !== DEFAULT_MODE).map((m) => `${NAME_LIST_MODE_WORDS[m]}:`));

/** Why the door refused one row, one sentence per reason (`NAME_LIST_ROW_REFUSALS`, the door's closed list). */
export const NAME_LIST_ROW_TEXT: Readonly<Record<NameListRowRefusal, string>> = {
  shape: 'the server could not read this line as a name.',
  keys: 'the server could not read this line as a name.',
  length: `a name is 1 to ${NAME_LIST_MAX_CHARS} characters.`,
  mode: `the mode in front of the name is not one of ${ALL_MODES}.`,
  'non-ascii': "it holds a letter or digit outside a to z and 0 to 9, which the check cannot match. Enter the name's ASCII spelling.",
  'no-token': 'it holds no letter or digit the check can match (a to z, 0 to 9).',
};

export const NAME_LIST_WORDS = {
  none: 'No list uploaded. The relay does not check outgoing text for private names.',
  list: (rows: number, at: string) => `${rows} ${rows === 1 ? 'name' : 'names'}, uploaded ${at}. Every outgoing relay is checked against them.`,
  /** A list read back with no names (after Clear the list): the door stored its check alone, so the relay still checks that the
   *  list reads, and matches no name (review 4139 A3). */
  listEmpty: (at: string) => `The list is empty, cleared ${at}. No name is matched; the relay still refuses outgoing text if the list cannot be read.`,
  unreadable: (reason: NameListUnreadable) =>
    `The list cannot be read (${NAME_LIST_UNREADABLE_TEXT[reason]}). The relay refuses outgoing text until you upload the list again.`,
  unread: (error: string) => `The list's status could not be read (${error}).`,
  replaces: 'Uploading replaces the whole list. The server keeps only a keyed hash of each name, so the list cannot be shown back to you.',
  format: `One name per line. Put ${OTHER_MODES} in front of a name to change how it is matched; a line without one matches any ${NAME_LIST_MODE_WORDS[DEFAULT_MODE]}.`,
  textLabel: 'Names',
  upload: 'Upload the list',
  uploading: 'Uploading…',
  uploaded: (rows: number) => `Uploaded: ${rows} ${rows === 1 ? 'name' : 'names'}.`,
  empty: 'Type at least one name. To empty the list, use Clear the list.',
  badMode: (line: number) => `Line ${line}: the word before the colon is not ${ALL_MODES}.`,
  rowRefused: (line: number, reason: NameListRowRefusal) => `Line ${line}: ${NAME_LIST_ROW_TEXT[reason]}`,
  clear: 'Clear the list',
  clearTitle: (rows: number) => `Clear all ${rows} ${rows === 1 ? 'name' : 'names'}?`,
  clearWhy: 'The relay will stop checking outgoing text.',
  cleared: 'The list was cleared.',
  /** A `step-up-required` on the retry the confirm started (the coordinator's condition 4, review 4139 F1): final, and the text is
   *  gone. Each act says its own (A4). */
  stepUpFinal: "Confirm it's you did not hold for this upload, so nothing was uploaded. Type the names again, then upload.",
  clearFinal: "Confirm it's you did not hold for clearing the list, so the list was not cleared. Clear it again.",
  /** The retry found the box emptied (the page was hidden while the step showed): it sends nothing, never less than the first send
   *  carried (review 4139 F2). */
  namesGone: 'The names were cleared when the page was hidden, so nothing was uploaded. Type them again, then upload.',
} as const;

/** The operator's text as the upload's rows, with the line each came from; or why not: no name in it (`empty`), or a line whose
 *  word before the colon is no mode (`mode`, with its line number). */
export type NameListText =
  | { readonly ok: true; readonly rows: readonly NameListRow[]; readonly lines: readonly number[] }
  | { readonly ok: false; readonly why: 'empty' }
  | { readonly ok: false; readonly why: 'mode'; readonly line: number };

const MODE_PREFIX = /^([a-z]+):(.*)$/;
const isMode = (w: string): w is NameListMode => isOneOf(NAME_LIST_MODES, w);

export function nameListRowsOf(text: string): NameListText {
  const rows: NameListRow[] = [];
  const lines: number[] = [];
  const all = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!.trim();
    if (line === '') continue;
    const m = MODE_PREFIX.exec(line);
    if (m === null) { rows.push({ text: line, mode: DEFAULT_MODE }); lines.push(i + 1); continue; }
    const word = m[1]!;
    if (!isMode(word)) return { ok: false, why: 'mode', line: i + 1 };
    rows.push({ text: m[2]!.trim(), mode: word });
    lines.push(i + 1);
  }
  return rows.length === 0 ? { ok: false, why: 'empty' } : { ok: true, rows, lines };
}

/** The upload door's refusal in words. A `bad-request` that names a row and its reason says the line that row came from
 *  (`lines`, from `nameListRowsOf`); every other word is `otherwise`'s, Settings' table for the act (the card passes
 *  `overlordSettingsRefusalText` for `name-list`). The answer's row and reason are read; nothing of the text is. */
export function nameListRefusalText(err: unknown, lines: readonly number[], otherwise: (err: unknown) => string): string {
  const body = err instanceof ApiError && isObj(err.body) ? err.body : null;
  // Only the upload's row refusal carries a row index and a reason from the door's closed list, so those two name it; the word is
  // not compared as a literal (the refusal-branch ratchet).
  if (body !== null && isCount(body.row) && isOneOf(NAME_LIST_ROW_REFUSALS, body.reason)) {
    const line = lines[body.row];
    if (line !== undefined) return NAME_LIST_WORDS.rowRefused(line, body.reason);
  }
  return otherwise(err);
}

/** The upload door's words after which the box keeps the names (review 4139 A2, slug `names-kept-only-to-be-edited`): its
 *  `bad-request`, which a refused row (with its row and its reason) and the row count's cap both answer, and `oversize`, the
 *  body's cap. Each is met by editing the list. */
const KEEP_WORDS: ReadonlySet<string> = new Set(['bad-request', 'oversize']);

/** Whether a refused upload leaves the names in the box: only where the operator must edit them, a refused row or a refused cap,
 *  read by their words (`bad-request`, `oversize`). The one server fault that answers `bad-request` with no row (a row it could not
 *  hash, which the console's own body cannot cause) keeps them too. Every other refusal empties it, as the secret field's own rule
 *  has it, and a 401 does too: the person at the screen is no longer proven. A first step-up keeps them too, which is the card's
 *  (it is no refusal). */
export function nameListKeepsText(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status === 401 || !isObj(err.body)) return false;
  return typeof err.body.error === 'string' && KEEP_WORDS.has(err.body.error);
}

/** The upload's answer in words: how many names the server took. */
export function uploadAnswerWords(body: unknown): readonly string[] {
  return isObj(body) && body.ok === true && isCount(body.rows) ? [NAME_LIST_WORDS.uploaded(body.rows)] : [];
}
