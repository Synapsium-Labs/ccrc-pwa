# A long paste sent from the PWA is submitted by the server — Plan note

> **For agentic workers:** a short plan note, not a task plan. The design is named by slug, `D-TBD-paste-chip-submit`; the coordinator allocates its number and replaces the slug everywhere it appears (this file, `server/src/inject/send.ts`, `server/test/send-paste-chip.test.ts`). Until then `dtbd.test.ts` is red by design.

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

## The change (D-TBD-paste-chip-submit)

`sendPrompt`'s ordinary echo arm, when the needle never matched, asks `ownPasteChip` whether the box holds our whole message behind one chip. If it does, the server presses the Enter itself through `pressEnterAndConfirm`, so the chip row has to leave the box (`submitted()`), a second Enter follows a swallowed first, and two swallowed Enters answer `enter-ignored` with `submittable` and the chip as `draft`. If it does not, the arm refuses exactly as before, `submittable` included where it was set.

`ownPasteChip`'s guards, all required:

1. **Provenance.** `sendPrompt` records which proof let its type loop run: the clobber guard read an empty box (`proven-empty`), or this call's own clear emptied it (`cleared-by-us`: `replaceDraft`, `clearMailResidue`, `ownStrandedClear`). It starts `unproven`, and `unproven` submits nothing.
2. **One chip, nothing else.** The marker row is exactly `[Pasted text #N]` or `[Pasted text #N +M lines]` (anchored at both ends, `LONE_PASTE_CHIP`), and the box has no row below it.
3. **Line count.** A stated `+M lines` must equal the newlines typed; no stated count means one line typed.
4. **Collapse floor.** The typed line (or, with a stated count, the message) is over 800 characters, so a chip could have come from it.

What it does not prove is that Claude Code kept every character behind the chip. The tap it replaces pressed the same Enter on the same row and proved no more.

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

Measured end to end with the real `sendPrompt`: 1000 characters → `ok`, keys `lit(1000) Enter`, transcript 1000 of 1000; 2000 characters → `verify-failed`, `submittable`, no Enter; 1100 characters → `verify-failed` with the tail, no flag, no Enter; a human line in the box plus `replaceDraft` → `C-u lit(950) Enter`, `ok`, 950 of 950; into a running turn → `ok`, the queue hint, 1000 of 1000 after the turn.

## Pending a number (named by slug; the coordinator allocates)

- `paste-chip-submit`: the design above.
