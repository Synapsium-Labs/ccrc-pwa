# Wave 167: reliable text paste, the delivery boundary

Task note for the desktop-polish programme, wave 167 (Goals modification 90: "long and multiline text reaches the
transcript intact as one prompt, once, with no silent loss, splitting, or false confirmation", reliability first, the
compact paste display a separate follow-up). It records the measured findings of the deviation this wave was issued, for
the coordinator to fold into the ledger. The number itself is in the wave-done mail, because a tracked file may name a
deviation only once its ledger entry has landed. Each claim is labelled **measured** (a real Chrome or a command showed
it) or **inferred** (read from the code or from an earlier measurement, not shown here). Every count below is the
worker's own measurement. The review did not replay it, and it cannot be re-derived from the repository (§3).

## 1. In short

- **The browser-to-request half held in the measured runs (measured).** The runs used headless Chrome for Testing at
  desk width with a fine pointer, over the production build. There were 44 clipboard pastes of 11 synthetic cases (two
  runs, both skins, which mount one shared composer) and 60 timed sends. Each made exactly one request.
  - Between the message's first and last non-space characters, no character was lost, split, reordered or repeated.
  - The changes are the composer's documented trim of the message's edges and the textarea's own CRLF-to-LF
    conversion (§4).
  - Touch input, phone widths, other browser engines and an operating-system clipboard were not run.
- **No defect was reproduced, so no code changed.** The brief asks for a red regression only after a reproduction.
- **The send-to-transcript boundary is unmeasured.** That covers the server typing into the pane, Claude Code's input
  box, and the prompt the transcript records. The coordinator ruled that this wave runs no local Claude Code build and
  no private terminal harness, after a hook refused a read-only look at the build (§5). The supported capture lane
  that could measure it is built but not yet wired (§6). The pane side's one recorded silent-loss shape is a long
  later line losing its head on macOS, which `sendPrompt` answers `ok`. It is unmeasured on Linux and remains the
  first lead (§6).

## 2. Environment and boundaries

- **ccrc revision:** `main` at `b33a9ae137e5a6bf23b80cee7dc89fb562087b4a` (2026-11-22T11:40:51Z); this branch had no
  commits of its own while measuring.
- **Browser:** Chrome for Testing 153.0.8010.12, headless, driven by playwright-core 1.64.1 under the browser leg's own
  config (`pwa/vitest.browser.config.ts`), run through `ccrc test`; Node v24.22.1; Linux 7.0.0. The app is the
  production build (`vite build`, built once per run by the leg's global setup), served from loopback.
- **Viewport and input:** 1280 wide, no touch screen, so `(pointer: fine)` holds and plain Enter sends
  (`pwa/src/session/Composer.tsx`, `onKeyDown`). On a touch screen Enter is a newline, and a send takes the button or
  Cmd/Ctrl+Enter; that path was not run. Both skins (Refined and Instrument) mount the same `Composer`
  (`pwa/src/screens/SessionScreen.tsx`), so the second skin adds layout coverage, not a second send path.
- **Terminal and Claude Code:** not exercised, and their versions are not recorded (§5).

| Boundary | Status in this wave |
|---|---|
| Chrome's clipboard to the composer's field | **real within headless Chrome**: `navigator.clipboard.writeText` in the page, with the browser context granted `clipboard-read` and `clipboard-write` for the served origin (Playwright's `grantPermissions`; the committed harness grants none), then Chrome's own paste on Ctrl+V into the focused `.composer textarea`. No operating-system clipboard and no source application |
| The field to the request body | **real**: the production `Composer` and session store; the `POST /api/sessions/:id/prompt` body was read off the page's network layer |
| The request's answer | **simulated**: the page's route answered `{"ok":true}`, so nothing here speaks to the server's verdict or to confirmation |
| The route to `sendPrompt` | not run. **Inferred**, by reading the prompt route in `server/src/server.ts`: on the typing path `body.text` reaches `sendPrompt` unchanged. The route refuses empty text and a renewing session, and for the Overlord's designated session it records the prompt and types nothing |
| `sendPrompt` to tmux, Claude Code's input box and the transcript | **unmeasured** (§5, §6) |
| The UI's confirmation matcher (`sameSent`) and the screen's prompt row | not used as content oracles |

## 3. Cases, evidence and replay

**Where the evidence is.** The probe (a browser test file run with the leg's config), the case generator, the case
texts and the raw outputs were kept only in the worker's session temp directory. They went to the coordinator as mail
artifacts and are removed when the workspace is reclaimed. None of them is in the tree, so the counts, the indexes
and the 36/8 and 40/4 splits below cannot be re-checked from the repository. The recipe below rebuilds the inputs and
the mechanism; a replay is a new measurement, not a re-check of these numbers.

**The cases.** Every case is synthetic and carries a distinctive tail label (`ZQX-END-<id>`); in c3b two blank lines
follow it. Long ASCII lines are 100-character blocks, each `<id@NNNNN>` (the block's start offset, five digits) padded
with `abcdefghij` repeats. The long Unicode line is 50-code-point groups, each `<c4b#NNNN>` (the group's index) padded
by cycling `Ж`, `漢`, `🙂`, `é`, `ש` from the group's index. Exact texts, as JavaScript string literals:

- c0: `'paste probe control c0 ZQX-END-c0'`
- c1: the first 6000 characters of the ASCII blocks for `c1`, then `' ZQX-END-c1'`
- c1b: the first 3000 for `c1b`, then `'\nline two of c1b\nline three ZQX-END-c1b'`
- c2a: typed prefix `'Prefix typed before the paste: '`, then pasted the first 5000 for `c2a` and `' ZQX-END-c2a'`
- c2b: `'short prefix line c2b\n'`, the first 5000 for `c2b`, then `'\ntail line ZQX-END-c2b'`
- c3: `'    def first_line_indented():\n        return 1\n\n\tTabbed line\twith inner\ttabs\nline with trailing
  spaces   \n\n\n  - bullet after two blank lines\n      deeper indent  inner  double  spaces\n   \nZQX-END-c3'`
  (one literal; the break is this note's)
- c3b: `'\n\n  leading blank lines then indent c3b\n\nmiddle\n\nZQX-END-c3b\n\n'`
- c3c: 45 lines `c3c line NN of 45` (two-digit NN), every fifth replaced by an empty line, joined by `\n`, then
  `'\nZQX-END-c3c'`
- c4: `'Ünïcödé c4 — Кириллица 漢字かな 한국어 עברית العربية \u{1F642} \u{1F469}\u200D\u{1F4BB} \u{1F3F3}\uFE0F\u200D\u{1F308} e\u0301 NBSP\u00A0here ZQX-END-c4'` (the emoji, the joiners, the variation
  selector, the combining acute and the no-break space are spelled as escapes, so this note holds no invisible character)
- c4b: the first 4000 code points of the Unicode groups, then `' ZQX-END-c4b'`
- c5: `'crlf line one c5\r\ncrlf line two\r\n\r\ncrlf line four ZQX-END-c5'`

| Case | Shape | Code points | UTF-8 bytes | Lines |
|---|---|---|---|---|
| c0 | the small control | 33 | 33 | 1 |
| c1 | one long line | 6011 | 6011 | 1 |
| c1b | a long first line (3000), then two short lines | 3039 | 3039 | 3 |
| c2a | a short prefix typed in the field, then a long line pasted after it on the same line | 5012 pasted, 31 typed | 5012 pasted, 31 typed | 1 |
| c2b | a short first line, a long line (5000), a tail line | 5044 | 5044 | 3 |
| c3 | an indented first line, single and double blank lines, tabs inside lines, trailing spaces, inner double spaces, a whitespace-only line | 199 | 199 | 11 |
| c3b | leading and trailing blank lines around indented text | 62 | 62 | 9 |
| c3c | 45 short lines (a blank line every fifth), then the tail line; taller than the pane's 20-row box | 668 | 668 | 46 |
| c4 | Unicode: Latin with diacritics, Cyrillic, CJK, Hangul, Hebrew, Arabic, emoji, ZWJ sequences, a combining mark, a no-break space | 80 | 144 | 1 |
| c4b | one long Unicode line, 2-, 3- and 4-byte characters throughout | 4012 | 9132 | 1 |
| c5 | CRLF line endings on the clipboard (the counts are of the clipboard text, CRs included) | 60 | 60 | 4 |

**The mechanism.**
1. A browser test under `pwa/vitest.browser.config.ts` serves the shared build and opens it with `openApp`
   (`pwa/browser/app.ts`) at width 1280, theme Phosphor, once per skin.
2. The fixture is one idle session `lane-a-project-a` (`fleetSession` from `pwa/test/fleetFixture.ts`). Its session
   socket sends a backlog with one user event, then `{"type":"status","status":"idle"}`.
3. The context grants `clipboard-read` and `clipboard-write` for the served origin. A page route on
   `**/api/sessions/*/prompt` records each request body and answers 200 `{"ok":true}`.
4. Open `/s/lane-a-project-a`. For each case, in the field `.composer textarea`: click it, `fill('')`, type the prefix
   (c2a only), then `await navigator.clipboard.writeText(text)` in the page.
5. Press `Control+V`, read `inputValue()` at once and again 150 ms later, then press `Enter`. Wait up to 5 s for the
   request and 200 ms more.
6. Compare the field with prefix plus text, and the request's `text` with the field and with the field trimmed. Report
   the first differing index.
7. Timing modes, c0, c1, c3 and c4b, five times each: Enter right after the paste; two Enter presses back to back; a
   double click on `button[aria-label="Send"]`. Count the requests, with a 3 s wait and 400 ms more.

## 4. Results (measured)

**The field, immediately after the paste and again 150 ms later.** It held exactly what was put in (for c2a, the typed
prefix followed by the clipboard's text) in 40 of 44 pastes. The other 4 are c5 in both skins and both runs, which held
it with every CRLF turned into LF (first divergence at index 16, `c5\r\n` read as `c5\n`). **Inferred:** that is the
textarea's own line-break normalization in the HTML standard, which the page cannot see past. The read 150 ms later
never differed from the first.

**The request.** Each Enter made exactly one `POST /api/sessions/lane-a-project-a/prompt` (44 of 44). Its body was
`{"text": …}` with no other field, and `text` equalled the field's value with `String.prototype.trim` applied in 44 of
44. It equalled the untrimmed value in 36 of 44; the other 8 are c3 and c3b, which differ only at their edges (below).
After each send the field was empty.

**Timing (60 sends).** Every send in these runs made exactly one request (60 requests for 60 sends), each carrying the
trimmed text intact, and the field was empty afterwards: no duplicate, no drop, no early send. The double click
exercises the same `send()` through the button.

What the modes could and could not apply (**inferred**, by reading): each key press and the double click is a separate
Playwright round trip to the page. So React had committed `setValue('')` before the second event, and the recomputed
`canSend` stopped it. `send()` (`pwa/src/session/Composer.tsx`) has no in-flight latch, and the store's `send` and its
dispatch (`pwa/src/stores/session.ts`) do not deduplicate. Two calls inside one task, before React commits, would both
send. These modes could not produce that, so they show that the usual double press is absorbed; they do not show that
a duplicate is impossible. No committed test counts the requests a send makes.

**By class**, for the browser boundary in these runs: browser drop 0, partial or split 0, duplicate 0. Refusal and
false confirmation are not measurable here (the server's answer was simulated).

**The documented normalization, tested explicitly:**

1. **The textarea turns CR LF into LF** (c5, measured). **Inferred:** downstream this is the safe direction, because a CR
   typed into the pane would read as Enter.
2. **The composer trims the whole message** (`pwa/src/session/Composer.tsx`, `send()`'s `value.trim()`). Measured: c3
   lost its first line's four-space indentation (first divergence at index 0). c3b lost its two leading blank lines,
   its first content line's two-space indentation and its two trailing newlines. Everything between the first and the
   last non-space character survived exactly: blank lines, a run of two blank lines, tabs inside lines, trailing
   spaces on inner lines, inner double spaces and the whitespace-only line. Documented: the 2026-08-14 fleet robustness
   design relies on it ("unreachable from the app's own Composer (which trims)").
3. **`composePrompt` strips leading blank lines only** (`shared/api.ts`; inferred, by reading). Its comment says the
   first content line keeps its own indentation. On the PWA path the composer's trim has already removed that
   indentation. So a pasted snippet that opens on an indented line (a method from inside a class, say) arrives
   dedented on its first line only, which is the edge change most likely to alter meaning. The others are the leading
   and trailing blank lines and CRLF to LF. `String.prototype.trim` also removes edge no-break spaces, U+FEFF and
   U+3000 (inferred, from the language's definition). This is documented behaviour and was not changed here; see open
   question 1.

## 5. Why the pane boundary is unmeasured

The plan was to reuse the build capture runner's pieces locally with the paste cases. The installed Claude Code build
would run read-only with a scratch home and config directory, in its own tmux server, with the loopback stand-in model
(`agent/src/testbox/captureStub.ts`) and no account credential. The real `sendPrompt` would drive that pane, and the
prompt the stand-in received and the scratch transcript recorded would be read back. The runner's own recipe
(`agent/src/testbox/captureRunner.ts`, `tmuxLauncher`) starts the build at 200x50 with no tmux config (`-f
/dev/null`). That is not the fleet's 220x50 and `ccd/tmux.conf`, so a local run would have had to change both.

While recording versions, a read-only shell call was refused by the session hook as "a write to a Claude Code build or
its launcher". It would have printed the tmux version, the launcher's link target, the installed build directory and
the Node version; refused, it printed nothing. It was reported to the coordinator and not retried. The coordinator
then ruled:
- do not obtain the build's location or version by another route;
- run no local installed-build or private terminal harness;
- measure the browser half, and leave the send-to-transcript boundary unmeasured;
- describe the missing capture capability;
- claim no reproduction and patch no delivery from a simulated result.

## 6. The missing capability

The send-to-transcript boundary needs a **supported, isolated paste-delivery capture**: the build capture runner's
isolation (spec `docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`; `agent/src/testbox/capture.ts`,
`agent/src/testbox/captureRunner.ts`) with a different drive and a richer answer.

- **Where to assess first: the test box's build capture lane, once its runner is wired.** Its stand-in, recorder and
  runner are built and tested. At `b33a9ae137`, though, the box's capture desk has no runner:
  `agent/src/testbox/main.ts#captureDeskFor` passes `runner: null`, so every capture is refused `no-runner`. The spec
  wires the runner in its PR 3. It is not an available lane today.
- **The drive it lacks:** its steps are fixed (`CAPTURE_STEPS`), and `LaunchedBuild.type` sends one literal and then
  Enter. A delivery capture needs arbitrary case texts typed by the server's own key sequence, preferably by the real
  `sendPrompt` bound to that tmux server: one literal per line with `M-Enter` between, and its echo and submit proofs.
  It also needs the fleet's window size (220x50) and `ccd/tmux.conf`, and the build the fleet runs.
- **The answer it lacks:** it returns a hook-contract verdict (`BuildCaptureResult`). A delivery capture needs, per
  case:
  - the `sendPrompt` result (`ok`, or the refusal word and its `draft` and `submittable`);
  - the box reads before and after the submit;
  - every user message the stand-in received, in order (the prompt as delivered, which counts split and duplicate
    prompts);
  - the user entries of the scratch transcript.
- **The oracle:** the comparison must be against the stand-in's received text and the transcript, with the
  `<pasted_content>` wrapping removed, never against `sendPrompt`'s own proofs. Those proofs ignore whitespace and what
  is behind a chip: the needle and the box rows are trimmed, the whole-box comparison drops whitespace, and
  `ownPasteChip` does not prove that Claude Code kept every character behind the chip (all in
  `server/src/inject/send.ts`, inferred, by reading). Five of the eleven cases (c1, c1b, c2a, c2b, c4b) are over the
  800-character collapse floor.
- **The cases:** §3's, each run enough times to see an intermittent shape (tens per case), with and without load on
  the box.

**Leads for when it exists.** These are inferred, from the code and from the 2026-10-15 measurements in
`docs/superpowers/plans/2026-10-15-paste-chip-send.md`. Those were on macOS unless said, and none was measured in this
wave.

- **A long LATER line losing its head: the one recorded silent-loss shape on the pane side.** On macOS a line of 1023
  to 1821 characters usually lost its head (`server/test/fixtures/panes/cc300-paste-lost-head-1100.txt`).
  - When the damaged line is the first, `sendPrompt` refuses: the needle (the first 24 characters of the first
    non-blank line) is missing, and a hidden head is admitted only at the row cap.
  - When it is a later line, the first line's needle still matches and the message counts as echoed, so the chip and
    whole-box guards (`ownPasteChip`, `ownRenderedBox`) never run. The plan records that `sendPrompt` then answers `ok`
    with about 1 KB missing, and leaves it unchanged.
  - The same plan records an earlier Linux look (reads of 4095 bytes) that saw one chip for every single line from 801
    to 9000 characters, with no lost head. Whether a later line on Linux can lose its head, through the fleet's path
    and under load, is unmeasured.
- **A long first line, then `M-Enter`.**
  - The macOS measurement saw the `M-Enter` straight after a long line submit that line alone in 3 of 16 no-pause
    tries, with the rest in a fresh box. It saw this in 0 of 14 tries with a 30 or 100 ms pause and 0 of 6 through
    `sendPrompt`; Linux is unmeasured.
  - `sendPrompt` sends that `M-Enter` with no deliberate pause. Such a split ends as `verify-failed` with line one
    already submitted: `ownRenderedBox` refuses any chip count that differs from the long lines typed. That refusal is
    pinned in `server/test/send-paste-chip.test.ts` ("the long first line already went out on its own: the rest is in
    the box").
  - Retry then resumes only a box that renders the whole message, so it answers `draft-present`. On the conflict
    sheet, Replace draft and Append anyway each send the whole message again after line one already landed, and
    Replace retypes through the same unpaused loop. That would be a split prompt followed by an operator-driven
    duplicate of line one.
- **A tab inside a short typed line** (c3) may be read by the input box as the Tab key rather than as text, and a
  multibyte character may straddle a read boundary (c4b).
- **A hermetic step before any capture exists.** Replaying a recorded later-line lost-head pane through
  `send-paste-chip.test.ts`'s fake tmux would pin `sendPrompt`'s `ok` verdict on that screen. It proves the verdict on
  a recorded screen only, not delivery.
- **The drawer fixture rig, a lead only.** `server/test/drawer-rig/` records real Claude Code screens: a throwaway
  container with Claude Code installed from npm, a private tmux server at 220 columns with `ccd/tmux.conf`, and the
  delegation rig's scripted mock of the Messages API, which can write full request bodies (`MOCK_REQDIR`, which the
  rig does not set). It never calls `sendPrompt` (it types with `send-keys -l` and Enter), so it does not exercise the
  composer's send path. It needs docker and network and never runs in CI. It is not authorized for this task.

## 7. Open questions

1. Should a pasted message keep its first line's indentation (not changed here)? Keeping it means the composer would
   strip only blank edge lines rather than all edge whitespace; `composePrompt` strips leading blank lines only. A
   change must keep refusing a whitespace-only message, because `canSend` and `drafted` read `value.trim()`. The
   robustness design's reliance on the trim is about a blank first row, which stripping leading blank lines also
   prevents. This is a product call.
2. Who wires the delivery capture in §6, and when: a delivery mode on the build capture lane after its runner is wired,
   or another supported path the operator names?
3. Should the browser half be pinned in the browser leg? A row that pastes the §3 cases and requires exactly one request
   carrying the trimmed text would guard the measured contract and keep the case texts in the tree. A touch-pointer
   variant would cover the phone path. It was not added: the brief asks for a regression only after a reproduced
   defect.

## 8. Deviation

The ledger entry this wave proposes for its issued deviation (the number is in the wave-done mail):

- **(the issued number)** — `paste-delivery-boundary`: wave 167, issued on 2026-11-22.
  - Reported: text pasted into the session composer intermittently fails to arrive intact; the failing boundary was
    unmeasured.
  - Measured (`main` at `b33a9ae137`, headless Chrome for Testing 153.0.8010.12, desk width, fine pointer): in the
    measured runs the browser-to-request boundary held. In 104 clipboard pastes and sends, every send made exactly one
    request carrying the text, with no drop, split or duplicate.
  - The changes are the textarea's CRLF-to-LF conversion and the composer's documented trim of the message's edges,
    which also removes a first line's indentation.
  - No defect was reproduced and no code changed.
  - Unmeasured: the send-to-transcript boundary (tmux, Claude Code's input box, the transcript), by the coordinator's
    ruling after a hook refused a read-only look at the installed build. The touch path and other engines are
    unmeasured too.
  - The first pane-side lead is the recorded macOS silent loss: a long later line losing its head while `sendPrompt`
    answers `ok`.
  - The capability that would measure the boundary is a supported isolated paste-delivery capture: the build capture
    lane once its runner is wired, driven by the server's own key sequence, with an answer carrying the delivered
    prompts and the transcript (§6).
