# A long paste sent from the PWA is submitted by the server — Plan note

> **For agentic workers:** a short plan note, not a task plan. Two designs are named by slug, `D-TBD-paste-chip-submit` (commit 1, the brief) and `D-TBD-tall-box-echo` (commit 2, the row cap the investigations measured as the likeliest shape of the report); the coordinator allocates their numbers and replaces the slugs everywhere they appear (this file, `server/src/inject/send.ts`, `server/test/send-paste-chip.test.ts`). Until then `dtbd.test.ts` is red by design. The two commits are independent enough that commit 2 can be dropped on its own.

**Branch:** `fix/paste-chip-send`, cut from `fix/ask-server-half` (PR #417) at `43d1a3f4`, because it builds on that branch's D-5046 type loop (`--` before each literal, every line's send checked, `type-failed`).

**Deploy class:** server lane only. No agent change, no wire change, no PWA change.

## The report

The operator pasted a long text into the PWA composer and pressed Enter. The send failed, and the only way to finish it was to open the terminal drawer and press Enter there.

## What was measured (2026-10-15, Claude Code 2.1.300)

On a throwaway local tmux server (`tmux -L pastechip`, killed afterwards), 220x50 as the fleet runs, the fleet's `tmux.conf`, `claude --safe-mode --model haiku`. Text was typed with `sendPrompt`'s own key sequence (`send-keys -l --` per line, `M-Enter` between lines) and every screen read with `capture-pane -p -e`, as `Tmux.captureAnsi` reads. The submitted text was read back from the session's own transcript. The real `sendPrompt` of this branch was then driven against the same server through a `Tmux` whose runner targets that socket. **macOS only; the fleet (Linux) was not measured.** The fixtures are `server/test/fixtures/panes/cc300-paste-*.txt`, scrubbed of the work-dir path.

- **One read of more than 800 characters becomes a chip.** 800 characters are typed as text and 801 collapse into `[Pasted text #N]` (investigation, confirmed here). Characters, not bytes: 801 Cyrillic characters typed in one call were drawn as text on macOS, whose reads are about 1 KB.
- **A one-line message of 801 to 1022 characters is ONE chip on macOS** (`cc300-paste-chip-1000.txt`). The investigation measured one chip for every single line from 801 to 9000 characters on Linux (reads of 4095 bytes). Enter on the chip submitted the whole text, wrapped in `<pasted_content>` tags (transcript, 1000 of 1000 characters).
- **The other chip shapes:** a line split across two macOS reads draws two chips on the row (`[Pasted text #3][Pasted text #4]`, `cc300-paste-chips-2000.txt`); several long lines draw a chip per row (`cc300-paste-chip-rows-3x1000.txt`); text with newlines in ONE call draws `[Pasted text #2 +9 lines]`, where 9 is the newline count (`cc300-paste-chip-lines.txt`); a 1023 to 1821-character line on macOS usually loses its head and the box shows only its tail, with no chip (`cc300-paste-lost-head-1100.txt`).
- **Today's answer to the one-chip case** is `verify-failed` with `submittable`, no Enter: the needle (the first 24 characters of line one) never matches a chip. `PASTE_CHIP` matches every chip shape seen, so the matcher was not the defect.
- **The row cap** (all three investigations, confirmed here at 50 rows): the box shows at most (rows - 10) / 2 rows, 20 in the fleet's 220x50 window, keeps the LAST rows in view, and draws `❯` on the first of them. A 40-line message put line 21 on the marker row (`cc300-paste-tall-40-lines.txt`); seven 500-character paragraphs put a blank separator line there (`cc300-paste-tall-paras-blank-marker.txt`). Today both are `verify-failed` with NO `submittable`, so the PWA offers only Retry and Discard, and one Enter at the terminal sends the whole text intact: the report exactly.
- **A long first line followed by more lines** draws a chip on the marker row and our rows under it (`cc300-paste-chip-first-rows-below.txt`). In 3 of 16 python-driven tries with no pause, the M-Enter straight after the long line SUBMITTED it alone and the rest landed in a fresh box (`cc300-paste-split-first-line-sent.txt`, `cc300-paste-tall-split-first-sent.txt`); 0 of 14 with a 30 or 100 ms pause; 0 of 6 through the real `sendPrompt`.

## The change (D-TBD-paste-chip-submit)

`sendPrompt`'s ordinary echo arm, when the needle never matched, asks `ownPasteChip` whether the box holds our whole message behind one chip. If it does, the server presses the Enter itself through `pressEnterAndConfirm`, so the chip row has to leave the box (`submitted()`), a second Enter follows a swallowed first, and two swallowed Enters answer `enter-ignored` with `submittable` and the chip as `draft`. If it does not, the arm refuses exactly as before, `submittable` included where it was set.

`ownPasteChip`'s guards, all required:

1. **Provenance.** `sendPrompt` records which proof let its type loop run: the clobber guard read an empty box (`proven-empty`), or this call's own clear emptied it (`cleared-by-us`: `replaceDraft`, `clearMailResidue`, `ownStrandedClear`). It starts `unproven`, and `unproven` submits nothing.
2. **One chip, nothing else.** The marker row is exactly `[Pasted text #N]` or `[Pasted text #N +M lines]` (anchored at both ends, `LONE_PASTE_CHIP`), and the box has no row below it.
3. **Line count.** A stated `+M lines` must equal the newlines typed; no stated count means one line typed.
4. **Collapse floor.** The typed line (or, with a stated count, the message) is over 800 characters, so a chip could have come from it.

What it does not prove is that Claude Code kept every character behind the chip. The tap it replaces pressed the same Enter on the same row and proved no more.

## The second change (D-TBD-tall-box-echo)

When `ownPasteChip` refuses, the same arm asks `ownRenderedBox` whether the box, read whole, is the rendering of what was typed. It splits the box's rows (marker row through the closing rule, blank rows included) into runs at bare chip rows, and what was typed into runs at lines over 800 characters, each run's text whitespace-free (wrapping only moves spaces). Guards, all required: the same provenance; the box closes and every chip in it is bare (`[Pasted text #N]`, nothing else on the row); EVERY CHIP IN VIEW (as many as long lines typed: a long line hidden above the window could have lost its head unseen, and the auto-submit split shows fewer chips than typed); every run after the first chip equal to ours, and the first a suffix of ours; a hidden head only in a box exactly `(rows - 10) / 2` rows tall; something in view. It answers the last 24 non-space characters in view, and the submit proof is that the box, read whole, no longer ends with them, so neither the marker row (a later or blank line) nor a human's next draft can fool it. `pressEnterAndConfirm` now withholds `submittable` when the marker row is blank, which only this arm can produce. The proof every other send uses is unchanged, now passed as `stillStartsWith(needle)`.

What it does not prove is the text above the window: lines of 800 characters or fewer, which are typed as text and never collapse. The ordinary echo proves the first 24 characters of a message and nothing below them.

## Tests and mutations

`server/test/send-paste-chip.test.ts`, driven by the recorded panes through a fake whose captures follow the keys actually sent. Red first: the six submit cases came back `verify-failed` with no Enter, and the decision's cases failed on the missing export. Mutation table, RUN against `send-paste-chip` and `send`:

| Mutation | Red |
|---|---|
| the decision ignores `unproven` | PROVENANCE unit case |
| the guard never sets `proven-empty` | the five submit cases on an empty box |
| `replaceDraft`'s clear never sets `cleared-by-us` | the replaceDraft case |
| the residue clear never sets `cleared-by-us` | the clearMailResidue case |
| the chip regex not anchored at the end | two chips on the row, and the SINGLE CHIP unit case |
| rows below the chip ignored | SINGLE CHIP unit case |
| the line-count comparison deleted | three refusal cases |
| the line count checked only when the chip states one | "a chip stating NO lines over a multi-line message" |
| the collapse floor deleted | the 800-character case, the unit case, and `send.test.ts`'s short-text rescue case |
| the collapse floor off by one (`<`) | the 800-character case and the unit case |
| one blind Enter claimed `ok` | "an Enter the box swallows twice" |

Commit 2's red: the eight submit cases came back `verify-failed`, and the decision's cases failed on the missing export. One commit-1 case moved sides: three long lines drawn as a chip per row is submitted by the second arm (every chip in view; the investigation measured that shape submitting exact). Mutation table, RUN against `send-paste-chip`, `send` and `submit-route`:

| Mutation | Red |
|---|---|
| provenance ignored | PROVENANCE unit case |
| an unclosed box read anyway | THE BOX MUST CLOSE (on a whole, uncapped box) |
| a chip shape it does not vouch for read as text | "a chip-shaped line of our own" |
| the chip count compared no more | "a chip stating NO lines over a multi-line message" |
| text after a chip not compared | TEXT AFTER A CHIP |
| the first run's suffix not compared | "a window whose rows are not our text", and its unit case |
| a hidden head without a full box | "one row short of the measured cap", and its unit case |
| the cap formula `(rows - 8) / 2` | the eight row-capped cases |
| a box of blank rows accepted | NOTHING VISIBLE |
| the floor at classification `>=` | the 800-character cases |
| the submit proof "any non-empty box" | "a human typing into the emptied box", and the blank-marker case |
| the submit proof "always left" | both swallowed-Enter cases |
| a blank marker row keeps the flag | "a BLANK marker row is no claim at all" |

Measured end to end with the real `sendPrompt`: 1000 characters → `ok`, keys `lit(1000) Enter`, transcript 1000 of 1000; 2000 characters → `verify-failed`, `submittable`, no Enter; 1100 characters → `verify-failed` with the tail, no flag, no Enter; a human line in the box plus `replaceDraft` → `C-u lit(950) Enter`, `ok`, 950 of 950; into a running turn → `ok`, the queue hint, 1000 of 1000 after the turn. Commit 2: 40 lines of 80 → `ok`, 3239 of 3239; seven paragraphs → `ok`, 3512 of 3512; 30 lines of 60 → `ok`, byte-exact; seven paragraphs with a 1000-character one in view → `ok`, every non-space character (Claude Code adds newlines around its `<pasted_content>` block); a 1000-character first line and two short ones, six times → `ok` each, the same; nine paragraphs with the long one scrolled above the window → `verify-failed`, draft `''`, nothing sent.

## Out of scope, for the coordinator

- **The PWA.** No change is needed for these fixes: a send they cover now answers `ok`. What stays: (1) PR #417's `type-failed` has no `SEND_ERROR_TEXT` sentence, so the bubble shows the bare slug (`pwa/src/lib/api.ts` `SEND_ERROR_TEXT`/`sendErrorText`; `pwa/test/api.test.ts`'s hand-written code list omits it). (2) Retry never passes `resumeIfOwn` (`api.ts` prompt call), so a retry onto our own residue is `draft-present`, and the conflict sheet's Replace retypes into the same failure. (3) A send finished at the terminal leaves its bubble red: `clearConfirmed` (`pwa/src/stores/session.ts`) matches only `sending` pendings. (4) `ChatList.tsx`'s comments still call the `verify-failed` limb of the Send it gate dormant. The design-system PR moves `PendingBubble`/`SendItButton` to `pwa/src/session/PendingBubble.tsx`, so (4) belongs there. The Send it button is not width-gated (`chat.css` has no width query on `.pending-*`).
- **The auto-submit split** (measured above): a pause of about 100 ms between a line over 800 characters and the `M-Enter` after it would likely prevent it (0 of 14 at 30 and 100 ms). It is not in this branch: it changes the type loop D-5046 just rewrote, on timing the fleet was not measured at. Today the split shape is refused, never claimed sent.
- **The attachment lane** has the same row cap and its own failed-echo clear, which fires its blind floor into a tall box of our own text. Unchanged here.
- **macOS's lost head on a line after the first**: the needle on line one still matches, so `sendPrompt` answers `ok` with about 1 KB missing (investigation). Linux was measured to 9000 characters without it. Unchanged here.

## Pending a number (named by slug; the coordinator allocates)

- `paste-chip-submit`: the first design above.
- `tall-box-echo`: the second design above.
