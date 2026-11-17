// shared/injected-prompts.mjs — the one list of every fixed string the server or ccd types into a session's pane
// (Overlord spec §3.8, H7: "One L0 list, `INJECTED_PROMPTS`, holds every fixed string the server or ccd types into a
// pane"; the W1 vocabulary plan, `docs/superpowers/plans/2026-11-14-overlord-w1/w1-vocabulary.md`).
//
// K, L0, and import-free, not even `node:*`: the PWA reaches it through `shared/api.ts`'s re-export, and history's
// `ccd/history/lib.mjs`, plain Node on the fleet box, can import it as a `.mjs` (the plan's question 1). Types: the
// hand-written `injected-prompts.d.mts` beside it.
//
// The server's typers reference these rows instead of spelling the strings (`coord/envelope.ts#renderMailNudge`,
// `inject/send.ts#clearSender`). ccd is bash and spells its own; `single-definition/injected-prompts.test.ts` holds
// every string ccd types against the rows whose typer is `ccd`, in both directions. The list tells WHICH string a text
// is, never who typed it: an operator who types `/clear` themselves matches the `clear` row.

/** `idle-compact-nudge` (D-5373): the one prompt the server types into a
 *  session after an idle compaction when its task list is fresh and has open
 *  items (operator ruling 2026-10-17, "Nudge if work is open"). Typed through
 *  `sendPrompt` as a plain user row; the transcript parser reads a user row
 *  whose whole trimmed text is this sentence as the `idle-compact-nudge`
 *  system pill. The second sentence is the guard for the shape the ruling
 *  names as the risk: a session that had ended its turn on a question to the
 *  operator answers in one line and stops. */
export const IDLE_COMPACT_NUDGE_PROMPT =
  "Continue with your open tasks. If you were waiting for the operator's answer, say so in one line and stop.";

/** The sentence Claude Code's default resume prompt is, and every variant —
 *  including ccd's RESUME_PROMPT — begins with. The parser matches the prefix. */
export const RESUME_PROMPT_PREFIX = 'Continue from where you left off.';

/**
 * Every fixed string ccrc types into a pane, keyed by a kebab name. `match` says how a text is that row: `exact`, the
 * whole text (a trailing newline trimmed), or `head`, the text begins with the row's text at a word boundary. `typer`
 * is who types it: `server` (a referenced constant in TypeScript) or `ccd` (spelled in bash, held by the census).
 */
export const INJECTED_PROMPTS = Object.freeze({
  // `renderMailNudge`'s fixed head; the recipient id lands after `sendPrompt`'s 24-character echo needle.
  'mail-nudge': Object.freeze({ text: 'ccrc-mail: you have new mail.', match: 'head', typer: 'server' }),
  'idle-compact-nudge': Object.freeze({ text: IDLE_COMPACT_NUDGE_PROMPT, match: 'exact', typer: 'server' }),
  // A dispatch's `/clear` into a resumed worker (`clearSender`), and the stranded one `ownStrandedClear` reads back.
  clear: Object.freeze({ text: '/clear', match: 'exact', typer: 'server' }),
  // ccd's RESUME_PROMPT, typed by `_redrive_after_spawn`, begins with it.
  resume: Object.freeze({ text: RESUME_PROMPT_PREFIX, match: 'head', typer: 'ccd' }),
  // `_auto_compact_check`, with the launch profile's compaction text after a space when it has one.
  compact: Object.freeze({ text: '/compact', match: 'head', typer: 'ccd' }),
  // `_route_type_effort`'s picker, and its one-step `/effort ultracode`.
  effort: Object.freeze({ text: '/effort', match: 'exact', typer: 'ccd' }),
  'effort-ultracode': Object.freeze({ text: '/effort ultracode', match: 'exact', typer: 'ccd' }),
  // `_route_type_model`'s picker.
  model: Object.freeze({ text: '/model', match: 'exact', typer: 'ccd' }),
  // The renewal act's first turn of a fresh conversation, and `carded`'s re-nudge (Overlord W1a, the renewal act:
  // `renewalWiring.ts`'s `sendPrompt` through `SessionHost.deliver`).
  'renewal-first-prompt': Object.freeze({
    text: 'Read your card with `ccrc-api card`, then answer your probes with `ccrc-api probe`.', match: 'exact', typer: 'server',
  }),
  // A new Overlord body's first turn, sent by the designate door after the create (Overlord W1, designation A, X4:
  // `overlordRoutes.ts` through `SessionHost.deliver`). It sends the body to its card, as the renewal's does.
  'overlord-first-prompt': Object.freeze({
    text: 'You are the Overlord. Read your card with `ccrc-api card` first, then answer your probes with `ccrc-api probe`.',
    match: 'exact', typer: 'server',
  }),
});

/** The rows' keys, in the list's order. */
export const INJECTED_PROMPT_KEYS = Object.freeze(Object.keys(INJECTED_PROMPTS));

const ROWS = INJECTED_PROMPT_KEYS.map((key) => ({ key, ...INJECTED_PROMPTS[key] }));
const EXACT = ROWS.filter((r) => r.match === 'exact');
const HEAD = ROWS.filter((r) => r.match === 'head');

/**
 * Which row a transcript line is, or `null`. Total: a non-string, an empty string and any text no row matches all
 * answer `null`; it never throws and never coerces a non-string.
 *
 * Its INPUT (the plan's question 11): a user row's text, or, for a slash command Claude Code recorded as a command
 * envelope, the command's name and its arguments joined by one space (`/effort ultracode`). It parses no envelope of
 * its own; the transcript parsers own that.
 *
 * `exact` rows are tried first, against the text with one trailing newline trimmed. A `head` row matches only at a
 * word boundary: its text followed by the end of the input, a space or a newline, so `/compactfoo` is no row's.
 * A text matches at most one row (the census holds that no head row's text is a word-boundary prefix of another's).
 *
 * It trims EXACTLY ONE trailing `\n` and nothing else, unlike `server/src/transcript/parse.ts#eventsOfRecord`, which
 * matches its pills on `.trim()`: a trailing space, a `\r\n` or a second newline leaves an `exact` row unmatched
 * (`'/clear '` is `null`), while a `head` row still matches when a space or a newline follows its text
 * (`'/compact '` is `compact`). A slash command with an empty argument list joins as its name alone (`/clear`, never
 * `/clear `), so a caller that joins name and arguments adds the space only when there are arguments.
 */
export function injectedPromptOf(text) {
  if (typeof text !== 'string' || text === '') return null;
  const whole = text.endsWith('\n') ? text.slice(0, -1) : text;
  for (const r of EXACT) if (whole === r.text) return r.key;
  for (const r of HEAD) {
    if (!text.startsWith(r.text)) continue;
    const next = text.charAt(r.text.length);
    if (next === '' || next === ' ' || next === '\n') return r.key;
  }
  return null;
}
