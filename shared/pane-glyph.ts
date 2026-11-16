// Claude Code's prompt glyph, the one spelling (W7 C7i, D-7187; ARCH-64 #799; OA-C16 (a); plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, Task C7i Step 4). L0: imports nothing. Both readers of pane
// text that look for the glyph import it: the drawer's view (`pwa/src/session/drawerView.ts`, whose `showsPrompt` and
// `anchorRow` read it to render the PTY the drawer shows) and the server's dialog parser
// (`server/src/pane/dialog.ts#startsWithPromptGlyph`). `server/test/pane-glyph.test.ts` pins its bytes.

/** Claude Code's prompt and menu cursor, U+276F (UTF-8 e2 9d af): the input box's marker and the cursor on a menu
 *  option. */
export const PROMPT_GLYPH = '❯';
