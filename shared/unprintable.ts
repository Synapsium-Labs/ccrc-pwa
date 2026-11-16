/**
 * The unprintable set and its two strips, defined once (#1444, the Linear central key, spec section 6.5). L0: it
 * imports nothing, because the PWA bundles `shared/*.ts`.
 *
 * THE SET. C0, DEL and C1 controls (the 8-bit CSI among them), the line and paragraph separators, the combining
 * grapheme joiner, U+2060 to U+206F, and every Unicode format character (\p{Cf}) a terminal or a viewer would act on
 * or hide: zero-width and directional marks (the Arabic letter mark among them), bidi embeddings, overrides and
 * isolates, the soft hyphen, the interlinear annotation marks, the tag block and the BOM. It was the account audit's
 * private set (`accounts/audit.ts#actorOf`, D-5621); it lives here so that the audit and the Linear modules read one
 * set rather than two copies that drift.
 *
 * THE TWO STRIPS.
 *  - {@link stripLine}, the full set, for every one-line string: a device label, a name, a title, an identifier, a URL
 *    key, a team key. A removed character becomes a space, runs of white space collapse to one, and the ends are
 *    trimmed. A newline in a title becomes a space.
 *  - {@link stripMultiline}, for markdown text only (a description, a comment body). It first turns `\r\n`, then any
 *    lone `\r`, into `\n`, then removes the set less `\n` and `\t`, each to nothing, and collapses nothing, so
 *    indentation, blank lines, lists and fenced code blocks keep their bytes.
 *
 * THE LINEAR NAME. {@link cleanName} is how a name Linear answers (an organisation, a user, a team, a workspace) is
 * made safe to store, show and put in a refusal detail; it lives beside the strips so that the L1 operation table can
 * import it without an edge into the L3 client.
 */

/** The set's class body, written once; both patterns below are built from it. */
const SET = String.raw`\u0000-\u001f\u007f-\u009f\u034f\u2028\u2029\u2060-\u206f\p{Cf}`;

/** A run of the set's characters. Global and unicode: use it with `replace`, never with `test` (a global pattern
 *  keeps its `lastIndex` between calls). */
export const UNPRINTABLE: RegExp = new RegExp(`[${SET}]+`, 'gu');

/** One character of the set that is neither `\n` nor `\t`: what {@link stripMultiline} removes. */
const UNPRINTABLE_IN_TEXT = new RegExp(`(?![\\n\\t])[${SET}]`, 'gu');

/** `s` on one line: every run of the set becomes a space, white space collapses, and the ends are trimmed. */
export function stripLine(s: string): string {
  return s.replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim();
}

/** `s` with its lines kept: `\r\n` and a lone `\r` become `\n`, and every other character of the set but `\n` and
 *  `\t` is removed. Nothing is collapsed or trimmed. */
export function stripMultiline(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(UNPRINTABLE_IN_TEXT, '');
}

/** The longest an organisation or user name is kept (code points). A bound on what Linear's text can put in a file
 *  and on the screen. */
export const LINEAR_NAME_MAX_CHARS = 80;

/** A name from Linear, made safe to store and show: {@link stripLine} (the whole set, so no control, format or bidi
 *  character reaches a file, a screen or a refusal detail), then bounded to {@link LINEAR_NAME_MAX_CHARS} code
 *  points and trimmed. Null when nothing is left (a name that is all unprintable characters is no name). */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = [...stripLine(raw)].slice(0, LINEAR_NAME_MAX_CHARS).join('').trim();
  return s === '' ? null : s;
}
