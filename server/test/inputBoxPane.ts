// The input box the way Claude Code draws it, for hand-written panes in the send and mail lane suites (Desktop polish
// wave 185, task note docs/superpowers/programs/desktop-polish/tall-draft-submit.md): the marker row, continuation rows
// indented, blank rows blank, a rule above and a rule below. A bare marker row with no closing rule is not a box any
// build draws, and since wave 185 the resume presses Enter only on a box it reads whole and closed. One builder, so
// the suites draw one shape.

export const BOX_RULE = '─'.repeat(60);

export const boxPane = (rows: readonly string[]): string =>
  ['earlier turn', BOX_RULE, `❯ ${rows[0]}`, ...rows.slice(1).map((r) => (r === '' ? '' : `  ${r}`)), BOX_RULE, '  👤 team·max'].join('\n') + '\n';

export const EMPTY_BOX = boxPane(['']);
