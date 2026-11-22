# Task: reliable text paste, the delivery boundary

Task note for the desktop-polish programme, wave 167 (Goals modification 90: "long and multiline text reaches the
transcript intact as one prompt, once, with no silent loss, splitting, or false confirmation", reliability first, the
compact paste display a separate follow-up). It records the measured findings of the deviation this wave was issued, for
the coordinator to fold into the ledger; the number itself is in the wave-done mail, because a tracked file may name a
deviation only once its ledger entry has landed. Each claim is labelled **measured** (a real Chrome or a command showed
it) or **inferred** (read from the code or from an earlier measurement, not shown here).

## 1. In short

- **The browser half is intact (measured).** In a real Chrome over the production build, 44 real clipboard pastes of 11
  synthetic cases (two runs, both skins) and 60 timed sends made exactly one request each. Every request carried the
  pasted text with no character lost, split, reordered or repeated. The one change is the composer's documented trim,
  plus the textarea's own CRLF-to-LF conversion (§4).
- **No defect was reproduced, so no code changed.** The brief asks for a red regression only after a reproduction. The
  browser boundary showed no divergence beyond the documented normalization.
- **The send-to-transcript boundary is unmeasured.** That covers the server typing into the pane, Claude Code's input
  box, and the prompt the transcript records. The coordinator ruled that this wave runs no local Claude Code build and
  no private terminal harness, after a hook refused a read-only look at the build (§5). The capability that would
  measure it is described in §6.

## 2. Environment and boundaries

- **ccrc revision:** `main` at `b33a9ae137e5a6bf23b80cee7dc89fb562087b4a` (2026-11-22T11:40:51Z); this branch had no
  commits of its own while measuring.
- **Browser:** Chrome for Testing 153.0.8010.12, headless, driven by playwright-core 1.64.1 under the browser leg's own
  config (`pwa/vitest.browser.config.ts`), run through `ccrc test`; Node v24.22.1; Linux 7.0.0. The app is the
  production build (`vite build`, built once per run by the leg's global setup), served from loopback.
- **Terminal and Claude Code:** not exercised, and their versions are not recorded (§5).

| Boundary | Status in this wave |
|---|---|
| System clipboard to the composer's field | **real**: `navigator.clipboard.writeText`, then Chrome's own paste on Ctrl+V into the focused `.composer textarea` |
| The field to the request body | **real**: the production `Composer` and session store; the `POST /api/sessions/:id/prompt` body was read off the page's network layer |
| The request's answer | **simulated**: the page's route answered `{"ok":true}`, so nothing here speaks to the server's verdict or to confirmation |
| The route to `sendPrompt` | not run. **Inferred**, by reading `server.ts`'s prompt route: `body.text` reaches `sendPrompt` unchanged |
| `sendPrompt` to tmux, Claude Code's input box and the transcript | **unmeasured** (§5, §6) |
| The UI's confirmation matcher (`sameSent`) and the screen's prompt row | not used as content oracles |

## 3. Cases

Every case is synthetic and ends in a distinctive tail label (`ZQX-END-<id>`). Long lines carry a position label every
100 characters (`<c1@01200>`), and the long Unicode line one every 50 code points (`<c4b#0040>`), so a lost or moved
chunk would show where it went.

| Case | Shape | Code points | UTF-8 bytes | Lines |
|---|---|---|---|---|
| c0 | the small control | 33 | 33 | 1 |
| c1 | one long line | 6011 | 6011 | 1 |
| c1b | a long first line (3000), then two short lines | 3039 | 3039 | 3 |
| c2a | a short prefix TYPED in the field, then a long line PASTED after it on the same line | 5012 (+31 typed) | 5012 | 1 |
| c2b | a short first line, a long line (5000), a tail line | 5044 | 5044 | 3 |
| c3 | an indented first line, single and double blank lines, tabs inside lines, trailing spaces, inner double spaces, a whitespace-only line | 199 | 199 | 11 |
| c3b | leading and trailing blank lines around indented text | 62 | 62 | 9 |
| c3c | 45 short lines, a blank line every fifth (taller than the pane's 20-row box) | 668 | 668 | 46 |
| c4 | Unicode: Latin with diacritics, Cyrillic, CJK, Hangul, Hebrew, Arabic, emoji, ZWJ sequences, a combining mark, a no-break space | 80 | 144 | 1 |
| c4b | one long Unicode line, 2-, 3- and 4-byte characters throughout | 4012 | 9132 | 1 |
| c5 | CRLF line endings on the clipboard | 60 | 60 | 4 |

## 4. Results (measured)

**The field, immediately after the paste and again 150 ms later.** It held the clipboard's text exactly in 40 of 44
pastes. The other 4 are c5 in both skins and both runs, which held it with every CRLF turned into LF (first divergence
at index 16, `c5\r\n` read as `c5\n`): that is the textarea's own line-break normalization in the HTML standard, which
the page cannot see past. The read 150 ms later never differed from the first.

**The request.** Each Enter made exactly one `POST /api/sessions/lane-a-project-a/prompt` (44 of 44). Its body was
`{"text": …}` with no other field, and `text` equalled the field's value with `String.prototype.trim` applied in 44 of
44. It equalled the untrimmed value in 36 of 44; the other 8 are c3 and c3b, which differ only at their edges (below).
After each send the field was empty.

**Timing (60 sends).** c0, c1, c3 and c4b, five times each, in three modes: Enter with no wait after the paste, two
Enters back to back, and a double click on Send. Every send made exactly one request (60 requests for 60 sends), each
carrying the trimmed text intact, and the field was empty afterwards. No duplicate, no drop, no early send.

**By class**, for the browser boundary: browser drop 0, partial or split 0, duplicate 0. Refusal and false
confirmation are not measurable here (the server's answer was simulated).

**The documented normalization, tested explicitly:**

1. **The textarea turns CR LF into LF** (c5, measured). Downstream this is the safe direction: a CR typed into the pane
   would read as Enter.
2. **The composer trims the whole message** (`Composer.tsx`, `send()`'s `value.trim()`). Measured: c3 lost its first
   line's four-space indentation (first divergence at index 0); c3b lost its two leading blank lines, its first
   content line's two-space indentation and its two trailing newlines. Everything between the first and the last
   non-space character survived exactly: blank lines, a run of two blank lines, tabs inside lines, trailing spaces on
   inner lines, inner double spaces and the whitespace-only line. Documented: the 2026-08-14 fleet robustness design
   relies on it ("unreachable from the app's own Composer (which trims)").
3. **`composePrompt` strips leading blank lines only** (`shared/api.ts`; inferred, by reading). Its comment says the
   first content line keeps its own indentation. On the PWA path the composer's trim has already removed that
   indentation, so a pasted snippet that opens on an indented line (a method from inside a class, say) arrives
   dedented on its first line only. This is the one silent content change on the measured path. It is documented and
   was not changed here; see open question 1.

## 5. Why the pane boundary is unmeasured

The plan was the build capture runner's recipe, run locally with the paste cases. The installed Claude Code build would
run read-only with a scratch home and config directory, in its own tmux server at the fleet's 220x50, with the loopback
stand-in model (`agent/src/testbox/captureStub.ts`) and no account credential. The real `sendPrompt` would drive that
pane, and the prompt the stand-in received and the scratch transcript recorded would be read back.

While recording versions, a read-only shell call was refused by the session hook as "a write to a Claude Code build or
its launcher". That call printed the tmux version, the launcher's link target, the installed build directory and the
Node version. It was reported to the coordinator and not retried. The coordinator then ruled: do not obtain the build's
location or version by another route; run no local installed-build or private terminal harness; measure the browser
half; leave the send-to-transcript boundary unmeasured; describe the missing capture capability; claim no reproduction
and patch no delivery from a simulated result.

## 6. The missing capability

The send-to-transcript boundary needs a **supported, isolated paste-delivery capture**: the build capture runner's
isolation (spec 2026-11-22, `agent/src/testbox/capture.ts`, `captureRunner.ts`) with a different drive and a richer
answer.

- **Where:** the test box's capture lane, which already runs a Claude Code build with no fleet secret, a scratch home,
  its own tmux server and the stand-in model. Or any other place the operator names as supported.
- **The drive it lacks:** its steps are fixed (`CAPTURE_STEPS`), and `LaunchedBuild.type` sends one literal and then
  Enter. A delivery capture needs arbitrary case texts typed by the server's own key sequence, preferably by the real
  `sendPrompt` bound to that tmux server: one literal per line with `M-Enter` between, and its echo and submit proofs.
  It also needs the fleet's window size (220x50) and `tmux.conf`, and the build the fleet runs.
- **The answer it lacks:** it returns a hook-contract verdict (`BuildCaptureResult`). A delivery capture needs, per
  case, the `sendPrompt` result (`ok`, or the refusal word and its `draft` and `submittable`); the box reads before and
  after the submit; every user message the stand-in received, in order (the prompt as delivered, which counts split
  and duplicate prompts); and the user entries of the scratch transcript.
- **The cases:** §3's, each run enough times to see an intermittent shape (tens per case), with and without load on
  the box.

**Leads for when it exists** (inferred; none of these were measured on Linux or through the fleet's path):

- **A long first line, then `M-Enter`.** The 2026-10-15 macOS measurement (plan `2026-10-15-paste-chip-send.md`) saw
  the `M-Enter` straight after a long line submit that line alone in 3 of 16 no-pause tries, with the rest in a fresh
  box. It saw this in 0 of 14 tries with a 30 or 100 ms pause and 0 of 6 through `sendPrompt`. `sendPrompt` sends that
  `M-Enter` with no deliberate pause. Reading the guards, such a split ends as `verify-failed` with line one already
  submitted (`ownRenderedBox` refuses a box showing fewer chips than long lines typed). Retry then resumes only a box
  that renders the whole message, so it answers `draft-present`, and the conflict sheet's Replace draft would send the
  whole message after line one already landed. That would be a split prompt followed by an operator-driven duplicate
  of line one.
- **A long line losing its head** (macOS, 1023 to 1821 characters, `cc300-paste-lost-head-1100.txt`). `sendPrompt`
  refuses it (no echo, and a hidden head is admitted only at the row cap).
- **A tab inside a short typed line** (c3) may be read by the input box as the Tab key rather than as text, and a
  multibyte character may straddle a read boundary (c4b).

## 7. Open questions

1. Should a pasted message keep its first line's indentation (open question, not changed here)? Keeping it means
   trimming only blank edge lines in the composer, as `composePrompt` already does. The robustness design's reliance
   on the trim is about a blank first row, which stripping blank lines also prevents. This is a product call.
2. Who builds the delivery capture in §6, and where: a test-box capture mode, or another supported path the operator
   names?
3. Should the browser half be pinned in the browser leg? A row that pastes the §3 cases and requires exactly one request
   carrying the trimmed text would guard the measured contract. It was not added: the brief asks for a regression only
   after a reproduced defect.

## 8. Deviation

The ledger entry this wave proposes for its issued deviation (the number is in the wave-done mail):

- reported: text pasted into the session composer intermittently fails to arrive intact; the failing boundary was
  unmeasured. Measured (wave 167, `main` at `b33a9ae137`, Chrome for Testing 153.0.8010.12): the browser boundary is
  intact. In 104 real pastes and sends, every send made exactly one request carrying the text, with no drop, split or
  duplicate. The only changes are the textarea's CRLF-to-LF conversion and the composer's documented whole-message
  trim, which also removes a first line's indentation. No defect was reproduced and no code changed. The
  send-to-transcript boundary (tmux, Claude Code's input box, the transcript) is unmeasured, by the coordinator's
  ruling after a hook refused a read-only look at the installed build. The capability that would measure it is a
  supported isolated paste-delivery capture: the build capture runner's isolation, the server's own key sequence, and
  an answer carrying the delivered prompts and the transcript (§6).
