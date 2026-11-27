// SYNTHETIC: every pane this module returns is BUILT HERE, not captured from any build. It draws the input box in the
// shape the recorded panes show: the marker row, continuation rows indented, blank rows blank, a rule above and a rule
// below. It is for the send and mail lane suites' hand-written panes (Desktop polish wave 185, task note
// docs/superpowers/programs/desktop-polish/tall-draft-submit.md). A bare marker row with no closing rule is not a box any
// build draws, and since wave 185 the resume presses Enter only where the rows from the marker row down to a plain rule
// are our text. One builder, so the suites draw one shape.

export const BOX_RULE = '─'.repeat(60);

export const boxPane = (rows: readonly string[]): string =>
  ['earlier turn', BOX_RULE, `❯ ${rows[0]}`, ...rows.slice(1).map((r) => (r === '' ? '' : `  ${r}`)), BOX_RULE, '  👤 team·max'].join('\n') + '\n';

export const EMPTY_BOX = boxPane(['']);
