# Wave 167: reliable text paste, the delivery boundary

Task note for desktop-polish wave 167 (Goals modification 90: long and multiline text reaches the transcript intact as
one prompt, once, with no silent loss, splitting or false confirmation). Claims are labelled **measured** or
**inferred** (read from the code or an earlier measurement). Every count is the worker's own measurement: no review
replayed it, and the evidence is not in the tree (§3).

## 1. In short

- **Measured:** from the clipboard to the request, in headless Chrome over the production build, 44 pastes and,
  separately, 60 timed sends each made exactly one request in its window. Inside a message the only change was CRLF
  to LF; at its edges the composer's documented trim removed whitespace.
- **No defect was reproduced, so no code changed.**
- **Unmeasured:** the prompt body and count the server receives, the pane, Claude Code's input box and the
  transcript (§5); also touch input, other browser engines and an operating-system clipboard (§2).

## 2. Environment and boundaries

- **Revision:** `main` at `b33a9ae137e5a6bf23b80cee7dc89fb562087b4a`.
- **Browser:** headless Chrome for Testing 153.0.8010.12 (Playwright's download cache, named by `CCRC_CHROME`),
  driven by playwright-core 1.64.1 under `pwa/vitest.browser.config.ts` through `ccrc test`, on Node v24.22.1 and
  Linux 7.0.0, over the leg's shared production build on loopback.
- **Desk input:** width 1280 and no touch screen, so `(pointer: fine)` holds and Enter sends
  (`pwa/src/session/Composer.tsx`). On a touch screen Enter is a newline; that path was not run. Both skins mount the
  same `Composer`, so the second adds layout, not a send path.

| Boundary | Status |
|---|---|
| Clipboard to the composer's field | **real within headless Chrome**: `navigator.clipboard.writeText`, the context granted `clipboard-read` and `clipboard-write` for the served origin (Playwright's `grantPermissions`; the committed harness grants none), then Chrome's own paste on Ctrl+V. No operating-system clipboard |
| Field to the request body | **real**: the production `Composer` and session store; the `POST /api/sessions/:id/prompt` body read off the page's network layer |
| The request's answer | **simulated** `{"ok":true}`: nothing here speaks to the server's verdict or to confirmation |
| Route, `sendPrompt`, pane, transcript | **unmeasured** (§5) |
| `sameSent` and the screen's prompt row | not used as content oracles |

## 3. Replay recipe

The probe, the case generator and the raw outputs stayed in the worker's session temp directory and went to the
coordinator as mail artifacts, so a replay is a new measurement, not a re-check of §4.

**Cases**, each synthetic with a tail label `ZQX-END-<id>`. A long ASCII run is 100-character blocks, each
`<id@NNNNN>` (the block's start offset, five digits) padded with `abcdefghij` repeats. The Unicode run is
50-code-point groups, each `<c4b#NNNN>` (the group index) padded by cycling `Ж`, `漢`, `🙂`, `é`, `ש` from the group
index modulo 5. As JavaScript string literals, with sizes in code points:
- c0 (33): `'paste probe control c0 ZQX-END-c0'`
- c1 (6011): the first 6000 of the `c1` run, then `' ZQX-END-c1'`
- c1b (3039, 3 lines): the first 3000 of the `c1b` run, then `'\nline two of c1b\nline three ZQX-END-c1b'`
- c2a (31 typed, 5012 pasted): typed `'Prefix typed before the paste: '`, then pasted the first 5000 of the `c2a` run
  and `' ZQX-END-c2a'`
- c2b (5044, 3 lines): `'short prefix line c2b\n'`, the first 5000 of the `c2b` run, then `'\ntail line ZQX-END-c2b'`
- c3 (199, 11 lines): `'    def first_line_indented():\n        return 1\n\n\tTabbed line\twith inner\ttabs\nline with trailing
  spaces   \n\n\n  - bullet after two blank lines\n      deeper indent  inner  double  spaces\n   \nZQX-END-c3'`
  (one literal; the break is this note's)
- c3b (62, 9 lines): `'\n\n  leading blank lines then indent c3b\n\nmiddle\n\nZQX-END-c3b\n\n'`
- c3c (668, 46 lines): `c3c line NN of 45` for NN 01 to 45, with lines 05, 10, … 45 left empty, joined by `\n`,
  then `'\nZQX-END-c3c'`
- c4: `'Ünïcödé c4 — Кириллица 漢字かな 한국어 עברית العربية \u{1F642} \u{1F469}\u200D\u{1F4BB} \u{1F3F3}\uFE0F\u200D\u{1F308} e\u0301 NBSP\u00A0here ZQX-END-c4'`
  (80, 144 bytes; the invisible characters are spelled as escapes)
- c4b (4012, 9132 bytes): the first 4000 code points of the Unicode run, then `' ZQX-END-c4b'`
- c5 (60, 4 lines): `'crlf line one c5\r\ncrlf line two\r\n\r\ncrlf line four ZQX-END-c5'`

**Procedure.** `openApp` (`pwa/browser/app.ts`) at width 1280, theme `'phosphor'`, skins `'refined'` and
`'instrument'`, with one idle fixture session (`lane-a-project-a`); a page route on `**/api/sessions/*/prompt` records
each body and answers `{"ok":true}`. Per case: clear the field, type any prefix, `writeText`, Ctrl+V, read the field
at once and 150 ms later, press Enter, and count every request until 200 ms after the first (waiting up to 5 s for
it). The timing modes are Enter at once, two Enters back to back, and a double click on Send, each send with its own
paste, counted until 400 ms after the first request (waiting up to 3 s).

## 4. Results (measured by the worker)

- **44 pastes** (two runs, all 11 cases, both skins). The field held exactly what was put in (c2a: the prefix, then
  the clipboard) in 40; the other 4 are c5, whose CRLFs read as LF (first divergence at index 16). The 150 ms read
  never differed. Each Enter made exactly one `POST` in its window, with the body `{"text": …}` alone and `text`
  equal to the field trimmed (44 of 44), and to the untrimmed field in 36; the 8 that differ are c3 and c3b, at their
  edges only. The field was empty after every send.
- **60 timed sends** (the second run, Refined skin; c0, c1, c3 and c4b, five per mode): each made exactly one request
  in its window, carrying the trimmed text, and left the field empty.
- **By class**, browser boundary only: drop 0, partial or split 0, duplicate 0. Refusal and false confirmation are
  not measurable with a simulated answer.
- **What the timing modes could not reach (inferred):** each event is a separate Playwright round trip, so React had
  committed the cleared field before the second. `send()` has no in-flight latch and the store
  (`pwa/src/stores/session.ts`) does not deduplicate, so two calls inside one task would both send. No committed test
  pastes, or presses Send twice quickly, and then counts requests.

**Normalization.**
- **Interior:** CRLF became LF in the field (c5), the textarea's line-break normalization (inferred). Nothing else
  between a message's first and last non-space characters changed: blank lines and runs of them, tabs, trailing
  spaces on inner lines, double spaces and a whitespace-only line all survived.
- **Edges:** the composer sends `value.trim()`. c3 lost its first line's four-space indent; c3b lost its leading
  blank lines, its first content line's indent and its trailing newlines. The trim also removes edge no-break spaces,
  U+FEFF and U+3000 (inferred). It is documented: the 2026-08-14 fleet robustness design relies on "the app's own
  Composer (which trims)". `composePrompt` (`shared/api.ts`) strips leading blank lines only and says the first
  content line keeps its indentation, which on the PWA path the trim has already removed.

## 5. The pane boundary (unmeasured)

A read-only call that would have printed the tmux, launcher, build and Node versions was refused by the session hook;
it printed nothing and was not retried. The coordinator then ruled the browser half only: no other route to the
build, no installed-build or private terminal harness, and no reproduction claimed or delivery patched from a
simulated result.

- **The supported capture lane is built, not wired.** The build capture runner
  (`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`) refuses every capture `no-runner` at
  `b33a9ae137` (`agent/src/testbox/main.ts#captureDeskFor` passes `runner: null`), and its recipe is not the fleet's:
  200x50 with no tmux config and a fixed drive, against 220x50 and `ccd/tmux.conf`.
- **The drawer fixture rig** (`server/test/drawer-rig/`) is a lead only, not authorized here: it types with
  `send-keys` and never calls `sendPrompt`, needs docker and network, and never runs in CI.
- **The oracle a delivery capture must use:** drive §3's cases through the server's own key sequence (the real
  `sendPrompt`) at the fleet's size and tmux config, then compare the full prompt body the stand-in model received,
  the number of prompts, and the transcript's user entries (less the `<pasted_content>` wrapper) with the case text.
  Never use `sendPrompt`'s own proofs (`server/src/inject/send.ts`): they are trimmed and whitespace-blind, and five
  cases are over the 800-character chip floor.

## 6. Leads for the pane boundary (inferred)

From the code and `docs/superpowers/plans/2026-10-15-paste-chip-send.md`, macOS unless said:
- **A long line losing its head.** On the first line `sendPrompt` refuses: nothing echoes, and the box shows fewer
  chips than long lines typed (pinned in `server/test/send-paste-chip.test.ts`). On a later line the plan reports in
  prose, with no recorded pane, that the first line's needle still matched and `sendPrompt` answered `ok` with about
  1 KB missing, because the chip guards run only when nothing echoed. Linux and the fleet's path are unmeasured.
- **A long first line, then `M-Enter`.** In the plan, `M-Enter` straight after the long line submitted it alone in 3
  of 16 python-driven tries with no pause, 0 of 14 with a 30 or 100 ms pause and 0 of 6 through the real
  `sendPrompt`. `sendPrompt` sends `M-Enter` with no deliberate pause, so its exposure is inferred from that missing
  pause, not observed. Such a split refuses `verify-failed` with line one already sent, and both conflict-sheet
  choices resend the whole message, so line one at least arrives twice.
- **Other shapes:** a tab inside a short typed line may read as the Tab key (c3), and a multibyte character may
  straddle a read boundary (c4b).

## 7. Open questions

1. Should a pasted message keep its first line's indentation, stripping edge blank lines rather than all edge
   whitespace? It must still refuse a whitespace-only message (`canSend` and `drafted` read `value.trim()`). This is a
   product call; nothing changed here.
2. Who wires a delivery mode on the capture lane (§5), and when?
3. Should the browser half be pinned as a browser-leg row (§3's cases, one request each, a touch variant)? It was not
   added, because the brief asks for a regression only after a reproduction.
