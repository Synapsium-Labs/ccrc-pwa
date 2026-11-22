# Wave 167: reliable text paste, the delivery boundary

Task note for the desktop-polish programme, wave 167 (Goals modification 90: "long and multiline text reaches the
transcript intact as one prompt, once, with no silent loss, splitting, or false confirmation"; reliability first, the
compact paste display a separate follow-up). Each claim is labelled **measured** or **inferred** (read from the code or
from an earlier measurement). Every count is the worker's own measurement. No review replayed it, and the evidence is
not in the tree (§3).

## 1. In short

- **Browser to request held in the worker's runs.** The runs used headless Chrome at desk width with a fine pointer,
  over the production build: 44 clipboard pastes and, separately, 60 timed sends, each with its own paste.
  - Every send made exactly one request within its observation window.
  - Inside the message the only change was CRLF to LF. At its edges the composer's documented trim removed whitespace
    (§4).
- **No defect was reproduced, so no code changed.**
- **Unmeasured:** the prompt body and count the server receives, the pane, Claude Code's input box and the transcript;
  also touch input, other browser engines and an operating-system clipboard. The pane side was ruled out of this wave
  (§5).

## 2. Environment and boundaries

- **ccrc revision:** `main` at `b33a9ae137e5a6bf23b80cee7dc89fb562087b4a`; the branch had no commits while measuring.
- **Browser:**
  - Chrome for Testing 153.0.8010.12, headless: the binary in Playwright's download cache, named by `CCRC_CHROME`
    (`pwa/browser/harness.ts`).
  - Driven by playwright-core 1.64.1 under `pwa/vitest.browser.config.ts`, through `ccrc test`, on Node v24.22.1 and
    Linux 7.0.0.
  - The app is the leg's shared production build, served from loopback.
- **Viewport and input:**
  - Width 1280 with no touch screen, so `(pointer: fine)` holds and plain Enter sends (`pwa/src/session/Composer.tsx`,
    `onKeyDown`). On a touch screen Enter is a newline; that path was not run.
  - Both skins mount the same `Composer` (`pwa/src/screens/SessionScreen.tsx`), so the second skin adds layout
    coverage, not a second send path.

| Boundary | Status |
|---|---|
| Chrome's clipboard to the composer's field | **real within headless Chrome**: `navigator.clipboard.writeText` in the page, the context granted `clipboard-read` and `clipboard-write` for the served origin (Playwright's `grantPermissions`; the committed harness grants none), then Chrome's own paste on Ctrl+V. No operating-system clipboard, no source application |
| The field to the request body | **real**: the production `Composer` and session store; the `POST /api/sessions/:id/prompt` body read off the page's network layer |
| The request's answer | **simulated**: `{"ok":true}`, so nothing here speaks to the server's verdict or to confirmation |
| The server route, `sendPrompt`, the pane and the transcript | not run; **unmeasured** (§5) |
| The UI's confirmation matcher (`sameSent`), the screen's prompt row | not used as content oracles |

## 3. Replay recipe

The probe (a browser test file), the case generator and the raw outputs were kept only in the worker's session temp
directory. The coordinator received them as mail artifacts, and the directory goes when the workspace is reclaimed. A
replay is therefore a new measurement, not a re-check of §4's numbers.

**Cases.** Each is synthetic and carries a tail label `ZQX-END-<id>` (in c3b two newlines follow it).
- Long ASCII runs are built per case from offset 0. They are 100-character blocks, each `<id@NNNNN>` (the block's start
  offset in the run, five digits) padded with `abcdefghij` repeats.
- The long Unicode run is 50-code-point groups, each `<c4b#NNNN>` (the group index) padded by cycling `Ж`, `漢`, `🙂`,
  `é`, `ש` starting at the group index modulo 5.

As JavaScript string literals:
- c0: `'paste probe control c0 ZQX-END-c0'`
- c1: the first 6000 characters of the `c1` run, then `' ZQX-END-c1'`
- c1b: the first 3000 of the `c1b` run, then `'\nline two of c1b\nline three ZQX-END-c1b'`
- c2a: typed prefix `'Prefix typed before the paste: '`; pasted, the first 5000 of the `c2a` run and `' ZQX-END-c2a'`
- c2b: `'short prefix line c2b\n'`, the first 5000 of the `c2b` run, then `'\ntail line ZQX-END-c2b'`
- c3: `'    def first_line_indented():\n        return 1\n\n\tTabbed line\twith inner\ttabs\nline with trailing
  spaces   \n\n\n  - bullet after two blank lines\n      deeper indent  inner  double  spaces\n   \nZQX-END-c3'`
  (one literal; the break is this note's)
- c3b: `'\n\n  leading blank lines then indent c3b\n\nmiddle\n\nZQX-END-c3b\n\n'`
- c3c: lines `c3c line NN of 45` for NN 01 to 45, with lines 05, 10, … 45 left empty, joined by `\n`, then
  `'\nZQX-END-c3c'`
- c4: `'Ünïcödé c4 — Кириллица 漢字かな 한국어 עברית العربية \u{1F642} \u{1F469}\u200D\u{1F4BB} \u{1F3F3}\uFE0F\u200D\u{1F308} e\u0301 NBSP\u00A0here ZQX-END-c4'`
  (the invisible characters are spelled as escapes)
- c4b: the first 4000 code points of the Unicode run, then `' ZQX-END-c4b'`
- c5: `'crlf line one c5\r\ncrlf line two\r\n\r\ncrlf line four ZQX-END-c5'`

| Case | Shape | Code points | UTF-8 bytes | Lines |
|---|---|---|---|---|
| c0 | the small control | 33 | 33 | 1 |
| c1 | one long line | 6011 | 6011 | 1 |
| c1b | a long first line, two short lines | 3039 | 3039 | 3 |
| c2a | a typed prefix, then a long line pasted on the same line | 5012 pasted, 31 typed | 5012 pasted, 31 typed | 1 |
| c2b | a short line, a long line, a tail line | 5044 | 5044 | 3 |
| c3 | indented first line, blank lines, tabs, trailing and double spaces, a whitespace-only line | 199 | 199 | 11 |
| c3b | leading and trailing blank lines around indented text | 62 | 62 | 9 |
| c3c | 45 short lines and the tail line, taller than the pane's 20-row box | 668 | 668 | 46 |
| c4 | Unicode scripts, emoji, ZWJ sequences, a combining mark, a no-break space | 80 | 144 | 1 |
| c4b | one long multibyte line | 4012 | 9132 | 1 |
| c5 | CRLF on the clipboard (counts include the CRs) | 60 | 60 | 4 |

**Mechanism.**
1. A browser test opens the shared build with `openApp` (`pwa/browser/app.ts`): width 1280, theme `'phosphor'`, skins
   `'refined'` and `'instrument'`. The fixture is one idle session `lane-a-project-a` (`pwa/test/fleetFixture.ts`),
   whose session socket sends a one-event backlog, then `{"type":"status","status":"idle"}`.
2. Grant the clipboard as in §2. A page route on `**/api/sessions/*/prompt` records each body and answers 200
   `{"ok":true}`. Open `/s/lane-a-project-a`.
3. Per case, in `.composer textarea`: click, `fill('')`, type the prefix (c2a), `writeText(text)`, press `Control+V`.
   Read `inputValue()` at once and 150 ms later. Press `Enter`, poll for the first request for up to 5 s, then wait
   200 ms more and count every request in that window.
4. Timing modes: Enter right after the paste; two Enter presses back to back; a double click on
   `button[aria-label="Send"]`. Each send has its own paste; the window is 3 s for the first request plus 400 ms.

## 4. Results (measured by the worker)

**44 pastes:** two runs, each pasting all 11 cases in both skins.
- The field held exactly what was put in (for c2a, the prefix then the clipboard's text) in 40 of 44.
- The other 4 are c5, whose CRLFs read as LF (first divergence at index 16).
- The read 150 ms later never differed from the first.
- Each Enter made exactly one `POST` in its window (44 of 44). The body was `{"text": …}` alone, and `text` equalled
  the field trimmed with `String.prototype.trim` (44 of 44), and the untrimmed field in 36 of 44.
- The 8 that differ are c3 and c3b, which differ only at their edges. The field was empty after every send.

**60 timed sends:** the second run, Refined skin only; cases c0, c1, c3 and c4b, five times each in each of the three
modes. Every send made exactly one request in its window, carrying the trimmed text, and left the field empty.

What the timing modes could not apply (**inferred**, by reading):
- Each event is a separate Playwright round trip, so React had committed `setValue('')` before the second, and the
  recomputed `canSend` stopped it.
- `send()` in the composer has no in-flight latch, and the store's send and dispatch (`pwa/src/stores/session.ts`) do
  not deduplicate. Two calls inside one task would both send.
- Committed tests count the requests of a single click on Send. None pastes, or presses Send twice quickly, and then
  counts.

**By class**, browser boundary only: drop 0, partial or split 0, duplicate 0. Refusal and false confirmation are not
measurable with a simulated answer.

**Normalization:**
- **Interior:** CRLF becomes LF in the field (c5). **Inferred:** this is the textarea's line-break normalization in
  the HTML standard; downstream it is the safe direction, since a CR typed into the pane would read as Enter. Nothing
  else changed between a message's first and last non-space characters: blank lines, runs of them, tabs, trailing
  spaces on inner lines, double spaces and a whitespace-only line all survived.
- **Edges:** the composer's `send()` sends `value.trim()`.
  - c3 lost its first line's four-space indentation (index 0).
  - c3b lost its two leading blank lines, its first content line's two-space indentation and its trailing newlines.
  - `String.prototype.trim` also removes edge no-break spaces, U+FEFF and U+3000 (inferred).
  - The trim is documented: the 2026-08-14 fleet robustness design relies on it ("the app's own Composer (which
    trims)").
  - `composePrompt` (`shared/api.ts`) strips leading blank lines only, and its comment says the first content line
    keeps its indentation. On the PWA path the trim has already removed that indentation.

## 5. The pane boundary

**Why unmeasured.** A read-only shell call that would have printed the tmux, launcher, build and Node versions was
refused by the session hook as "a write to a Claude Code build or its launcher". It printed nothing, was reported and
was not retried. The coordinator then ruled: no other route to the build's location or version, no local
installed-build or private terminal harness, the browser half only, and no reproduction claimed or delivery patched
from a simulated result.

**The supported capture lane is built, not wired.** The build capture runner
(`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`; `agent/src/testbox/capture.ts`,
`captureRunner.ts`, `captureStub.ts`) runs a Claude Code build with a scratch home, its own tmux server and a loopback
stand-in model. But:
- At `b33a9ae137`, `agent/src/testbox/main.ts#captureDeskFor` passes `runner: null`, so every capture is refused
  `no-runner` until the spec's PR 3.
- Its recipe starts the build at 200x50 with no tmux config (`-f /dev/null`), not the fleet's 220x50 and
  `ccd/tmux.conf`.
- Its drive is fixed (`CAPTURE_STEPS`; `LaunchedBuild.type` sends one literal, then Enter).
- Its answer is a hook-contract verdict (`BuildCaptureResult`).

Assess it first once it is wired.

**What a delivery capture must do and compare.**
- **Drive:** type §3's cases with the server's own key sequence, preferably the real `sendPrompt` bound to the
  capture's tmux server (one literal per line, `M-Enter` between). Use 220x50, `ccd/tmux.conf` and the fleet's build.
  Run tens of tries per case, with and without load.
- **Record per case:** the `sendPrompt` result (`ok`, or the refusal word with its `draft` and `submittable`); the box
  read before and after the submit; every user message the stand-in received, in order; and the user entries of the
  scratch transcript.
- **Compare:** the received messages and the transcript, with the `<pasted_content>` wrapper removed, against the case
  text. Count the messages to see a split or a duplicate. Never use `sendPrompt`'s own proofs as the oracle
  (`server/src/inject/send.ts`): its needle and box rows are trimmed, the whole-box comparison drops whitespace, and
  `ownPasteChip` does not prove what is behind a chip. Five cases (c1, c1b, c2a, c2b, c4b) are over the 800-character
  collapse floor.

**The drawer fixture rig is a lead only, not authorized here.** `server/test/drawer-rig/` records real Claude Code
screens: Claude Code from npm in a throwaway container, with a private tmux server at 220 columns and `ccd/tmux.conf`.
It types with `send-keys -l` and Enter and never calls `sendPrompt`, so it does not exercise the composer's send path.
It needs docker and network, and it never runs in CI.

## 6. Leads for the pane boundary (inferred)

These come from the code and from `docs/superpowers/plans/2026-10-15-paste-chip-send.md`, macOS unless said.

- **A long line losing its head.** On macOS, a line of 1023 to 1821 characters usually lost its head.
  - **The first line:** `sendPrompt` refuses. With no needle echoed, the whole-box reading finds fewer chips than
    long lines typed; the test "the macOS lost head is still refused: its chip is missing" in
    `server/test/send-paste-chip.test.ts` pins this.
  - **A later line:** the plan reports, in prose and with no recorded pane in the tree, that the first line's needle
    still matches. `sendPrompt` then answers `ok` with about 1 KB missing, because the chip and whole-box guards run
    only when nothing echoed. It was left unchanged.
  - The plan's Linux look saw one chip for every single line from 801 to 9000 characters, and no lost head. A later
    line on Linux, through the fleet's path and under load, is unmeasured.
- **A long first line, then `M-Enter`.**
  - On macOS the `M-Enter` submitted the long line alone in 3 of 16 no-pause tries, 0 of 14 with a 30 or 100 ms
    pause, and 0 of 6 through `sendPrompt`. Linux is unmeasured. `sendPrompt` sends `M-Enter` with no deliberate
    pause.
  - Such a split ends `verify-failed` with line one already submitted: the box's chip count no longer matches the long
    lines typed. The test "the long first line already went out on its own: the rest is in the box" pins this.
  - Retry resumes only a box that renders the whole message, so it answers `draft-present`. On the conflict sheet,
    Replace draft clears the box and retypes the whole message. Append anyway sends the box's remainder followed by
    the whole message, duplicating lines 2 onwards too. Both go through the same unpaused type loop.
- **Other shapes:** a tab inside a short typed line (c3) may be read as the Tab key, and a multibyte character may
  straddle a read boundary (c4b).

## 7. Open questions

1. Should a pasted message keep its first line's indentation? That would mean the composer strips blank edge lines
   rather than all edge whitespace. It must keep refusing a whitespace-only message (`canSend` and `drafted` read
   `value.trim()`). This is a product call; nothing changed here.
2. Who wires a delivery mode on the capture lane (§5), and when?
3. Should the browser half be pinned as a browser-leg row (the §3 cases, exactly one request each, a touch-pointer
   variant)? It was not added, because the brief asks for a regression only after a reproduction.
