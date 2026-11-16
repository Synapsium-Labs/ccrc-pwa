/**
 * The decisions of the operator's workspace RENAME (`POST /api/sessions/:id/title`), made once and without I/O (named
 * workspaces S9, design 2026-10-20 §6). L1 policy, C4 Workspace & PR Lifecycle, `workspaceCreate.ts`'s sibling: the
 * route (L4) reads the body and the deployed ccd's caps, asks `planRetitle` what to do, looks the title up, runs ccd,
 * and asks `classifyTitleFailure` what ccd's refusal MEANS. It decides nothing itself.
 *
 * A RENAME CHANGES THE LABEL, NEVER THE SLUG. The slug, the branch, the directory and the session id are the workspace's
 * for life; ccd's `ws-title` writes the two registry fields `title` and `named` and nothing else, so what the operator
 * types here is the display sentence and NOT a slug: the slug grammar (`deriveWorkspaceSlug`, which refuses a title with no
 * ASCII letter or digit, a single character, or a link that is not Linear's) has no say. A title is refused only for what
 * ccd re-proves (non-blank, no control characters, within the byte cap), and the last two are made true by `sanitizeTitle`
 * before ccd sees the text, so the one refusal left is a title with nothing in it. A ticket id or link still resolves to
 * its Linear title (`parseLinearRef`, the create's own ticket reader).
 *
 * EVERY WAY IT CAN BE REFUSED IS DECIDED HERE, BEFORE ANY ARGV EXISTS, the missing verb included (M7): a box whose
 * `ccd caps` does not list `ws-title` is `501 unsupported`, and nothing is sent, so an older ccd is never asked to run a
 * verb it has not heard of.
 */
import { WS_TITLE_VERB } from './ccdargv.js';
import { LINEAR_REF_MAX_CHARS } from './workspaceCreate.js';
import type { BadTitleReason, WsCreateRefusal } from '../../shared/refusal.js';
import { NAME_REFUSAL_TEXT, parseLinearRef, sanitizeTitle, type LinearRef, type NameRefusal } from '../../shared/slug.js';

/** Which verbs the deployed box advertised, read by the route with `capSupported` (no evidence = false). */
export interface RetitleCaps { verb: boolean }

/** A refusal, ready for `refuseRoute`: the word (its one status is `REFUSAL_STATUS`'s) and its extra fields. Fixed words
 *  only; nothing the operator typed is echoed. */
export interface RetitleRefusal {
  error: Extract<WsCreateRefusal, 'bad-name' | 'name-too-long'> | 'bad-request' | 'unsupported';
  extra: { reason?: NameRefusal; detail?: string; needs?: string };
}

export type RetitlePlan =
  | { kind: 'refuse'; refusal: RetitleRefusal }
  /** Remove the title and the named marker: the row goes back to the ai-title sweep. */
  | { kind: 'clear' }
  /** Set the title to what `name` becomes. `name` is the operator's text, untrimmed; `ticket` is the Linear ticket it names, or null. */
  | { kind: 'title'; name: string; ticket: LinearRef | null };

const refuse = (error: RetitleRefusal['error'], extra: RetitleRefusal['extra'] = {}): RetitlePlan =>
  ({ kind: 'refuse', refusal: { error, extra } });

/**
 * What to do with this request's `title` / `clear`. Order, each step before the next can cost anything:
 *   1. the body names exactly ONE change: `{clear: true}` or `{title: <string>}`. Both, neither, a `clear` that is not
 *      the boolean `true` (`false` is not "keep"; there is no such request), or a non-string `title` is `400 bad-request`;
 *   2. a title past `LINEAR_REF_MAX_CHARS` is `400 name-too-long`, the preview read's own bound;
 *   3. a title with nothing in it once sanitised (blank, or only control characters) is `400 bad-name`
 *      (`no-usable-characters`), NEVER a clear: erasing a name is its own request, and a field emptied by a slip of the
 *      thumb must not be answered as one. Nothing else about the text can refuse it (the slug grammar is not applied);
 *   4. a box that does not list the verb is `501 unsupported` naming it, for a set and a clear alike.
 */
export function planRetitle(body: { title?: unknown; clear?: unknown }, caps: RetitleCaps): RetitlePlan {
  const { title, clear } = body;
  if (clear !== undefined && clear !== true) return refuse('bad-request');
  if (clear === true) {
    if (title !== undefined) return refuse('bad-request');
    return caps.verb ? { kind: 'clear' } : refuse('unsupported', { needs: WS_TITLE_VERB });
  }
  if (typeof title !== 'string') return refuse('bad-request');
  if (title.length > LINEAR_REF_MAX_CHARS) return refuse('name-too-long');

  if (sanitizeTitle(title) === '') {
    return refuse('bad-name', { reason: 'no-usable-characters', detail: NAME_REFUSAL_TEXT['no-usable-characters'] });
  }
  if (!caps.verb) return refuse('unsupported', { needs: WS_TITLE_VERB });
  return { kind: 'title', name: title, ticket: parseLinearRef(title) };
}

/** What ccd's refusal of a rename means, in the words the route answers with. */
export type TitleFailure =
  | { kind: 'bad-session-id' }
  | { kind: 'unknown-session' }
  | { kind: 'not-a-workspace' }
  | { kind: 'bad-title'; reason: BadTitleReason }
  /** ccd could not write (or remove) one of the two registry fields; the row may carry only part of the change. */
  | { kind: 'not-saved' }
  | { kind: 'other' };

/** Each sentence of `cmd_ws_title` the server tells apart, matched on the whole line so a `ccd: warn:` line, which the
 *  verb prints BEFORE its refusal and which names the same fields, is never read as one. The id in two of them is ccd's
 *  own echo of what the server sent and is never copied into an answer. */
const TITLE_SENTENCES: readonly (readonly [RegExp, TitleFailure])[] = [
  [/^ccd: bad session id$/m, { kind: 'bad-session-id' }],
  [/^ccd: no such session: .+$/m, { kind: 'unknown-session' }],
  [/^ccd: \S+ is not a workspace — /m, { kind: 'not-a-workspace' }],
  [/^ccd: --title must be non-blank$/m, { kind: 'bad-title', reason: 'blank' }],
  [/^ccd: --title must not contain control characters$/m, { kind: 'bad-title', reason: 'control-characters' }],
  [/^ccd: --title is longer than \d+ bytes$/m, { kind: 'bad-title', reason: 'too-long' }],
  [/^ccd: could not (?:record the title|clear the title) for /m, { kind: 'not-saved' }],
];

/**
 * Read ccd's `die` line. A transport failure (`ran === false`) is NEVER a refusal and is `other` whatever its text says:
 * the runner's own stderr is not ccd's verdict (CLAUDE.md's "no overloaded null at a seam"). A `usage:` line is `other`
 * too: the server composed the argv, so ccd refusing its shape is the server's own fault and is the 502 it already is.
 */
export function classifyTitleFailure(res: { ran?: boolean; stderr: string }): TitleFailure {
  if (res.ran === false) return { kind: 'other' };
  for (const [re, failure] of TITLE_SENTENCES) if (re.test(res.stderr)) return failure;
  return { kind: 'other' };
}
