// The census scans' one reading of "code only": a sentence ABOUT a field is not
// a read of it, so comments go and code stays — string literals included,
// since a quoted token IS code.
//
// ONE pass, ONE alternation, scanned left to right, so whichever construct
// OPENS first wins: a `/*` inside a `//` comment is part of that comment (it
// cannot blank the code up to the next `*/`), and a `//` inside a string is
// part of that string (it cannot truncate the line). A quoted string stops at
// a line end, so a stray apostrophe (JSX text) can mislead at most its own
// line; a template literal may span lines. A dropped comment leaves its
// newlines, so a line number in the result is the same line in the source.
//
// Known limits: a regex literal is read as code, not as a regex.
// - One that holds a quote or a backtick opens a false string or template
//   literal that runs to the next matching quote or backtick. Measured
//   against TypeScript's own comment ranges, such regions keep comment text on
//   16 lines of server/src/coord/ledger.ts (from ~:216), 44 of
//   pwa/src/session/MessageBubble.tsx and 40 of pwa/src/session/PrKeycap.tsx.
//   Every such region errs toward keeping comments as code: a possible false
//   red, never a missed read.
// - One that holds `//` drops the rest of its own line as a comment, so code
//   after it on that line is not scanned — measured, none in server/src and
//   three lines in pwa/src (lib/passkey.ts, lib/sw-denylist.ts,
//   session/MessageBubble.tsx), none of them naming a scanned field.
const CODE_OR_COMMENT =
  /('(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

export const codeOnly = (s: string): string =>
  s.replace(CODE_OR_COMMENT, (m: string, str: string | undefined) => str ?? m.replace(/[^\n]/g, ''));
