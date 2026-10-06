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
// Known limit: a regex literal is read as code, so one that holds a quote or a
// `//` can mislead the rest of its own line.
const CODE_OR_COMMENT =
  /('(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

export const codeOnly = (s: string): string =>
  s.replace(CODE_OR_COMMENT, (m: string, str: string | undefined) => str ?? m.replace(/[^\n]/g, ''));
