# Wave 5k, fix round 1 (review run 3946)

Review run 3946 read the tip `a5ae09d2f4` and reported six findings. The coordinator ruled on them in mail 37794 (call 1492). This note records what changed for each, the new cases, and each new mutation row: its command, its red assertion, its restore with sha256, and the green run after.

## What changed

### F1: the re-read on every answer of the withdraw door belongs to `LandingLine`

The sheet can still be closed while its call is in flight: Cancel, Escape and the backdrop work as before. What moved is who re-reads.

- **`LandingWithdrawSheet`** no longer takes `onReload` and no longer re-reads. Its two arms set only its own state: busy, the done phase, the error and the R3 flag.
- **`LandingLine`** wraps the withdraw call it passes to the sheet. On the answer and on a refusal, the wrapper calls `onReload` once, whether the sheet is still open or not. That is the one call: exactly one re-read per answer.
- **The wrapper is guarded by the line's own generation ref,** the one the pause tap uses, so nothing is re-read once the card has gone. (Row M32's recorded run covered only the pause tap. Review run 3983 measured its second mutant, the generation ref dropped, red in the wrapper's two unmount cases of fix round 2 as well. Row FR8, in `wave5k-fix-round-2.md`, is the one specific to the wrapper's check; corrected by the coordinator after that review.)
- **A sheet closed mid-flight shows nothing more.** It is unmounted, so its arms' state changes are dropped. Nothing new is drawn on the card for it. The re-read removes the row, and the feed records who was told.

**The sheet's generation guard (F3's X3).** Once the re-read moved, I looked at what that guard still protected:

- Its arms only set state on a sheet that has unmounted, which React drops.
- A sheet closed and opened again is a new instance, so an earlier answer cannot reach it.

So the guard protected nothing that any case could see, and I removed it rather than keep a guard no mutation can turn red.

The one fact that still needed a sheet-side decision was the `answered` ref in `LandingLine`. It chose the focus after a close: `Done`'s chain or `Cancel`'s. An answer that landed after its sheet had closed and a new sheet had opened would have marked the new sheet as answered. So `answered` is gone too:

- The sheet now says how it closed: `onClose('done')` in the done phase (from `Done`, Escape or the backdrop), and `onClose('cancel')` otherwise.
- Its phase belongs to that one instance.

Pinned by the case "a sheet opened again before the earlier answer lands shows nothing of it, and its Cancel is a cancel", and by row FR4.

**Where focus goes.** After a close in the confirm phase, focus goes to that row's `Withdraw…`, as before. When the re-read then removes that row, focus would fall to the page. It now moves by section 4.5's chain: the pause button, else the card.

- **The effect generalises the old block-gone effect (M46).** The block remembers the control inside it that last held focus. When a read has removed that control, no sheet is open, and focus is on the page, the effect focuses the pause button, else the card.
- **The block-gone case is the same rule.** There, the pause button is gone with the block, so the card takes focus.
- **When the record is forgotten.** A blur clears it only when focus moves to an element outside the block. The effect clears it too, once the control is no longer in the document and no sheet is open, before its active-element check (corrected by the coordinator after review run 3983). A blur to nowhere keeps it: the window losing focus, or the control being removed. This is the blur test of F3's X4.
- **No focus is taken from the operator's own place.** A read that removes nothing moves no focus. Focus that sits on another element is never moved. Focus that has gone to the page is placed by the chain, a click on blank page included. (Corrected in fix round 2; the check that leaves focus on another element has its own case and row, FR9.)

### F2: section 11's document order

- **The document order** in the block is now: title, status, stale sentence, pause button, then the alert and the rows.
- **The look is unchanged.** The stylesheet places the button on the title row: the block is a two-column grid, the title and the button share row 1, and every other child spans both columns below, in document order. Only layout properties are used, and no colour.
- **The tab order still follows what is seen.** The button is the only focusable control in that head.
- **`wave5k-task-8.md`'s sentence is corrected.** It had said the status follows the title row "as section 11 says"; it now says the button comes after the status and the stale sentence.

### The two departures take numbers

D-9129 and D-9130 were issued on 2026-11-26. They are defined once, in the plan's "Deviations found" section after D-9110, and that section's opening sentence now says so. This is the round's one plan edit, and its commit carries a `Ledger-Edit` line.

- **`contrast.test.ts`** cites D-9129 on its `landing-line.css` line. Its comment that said the app's set has five members now says the set is the literal list.
- **`older-server-render.test.tsx`** cites D-9130 where it explains the declared difference.
- **The notes** of Task 7 and Task 8 name each number beside its slug.

### F3: three guards that survived a mutation

| Guard (the review's id) | Now |
|---|---|
| X1, the sheet's second tap while busy | New case: "a second tap while the first call is in flight sends nothing". Row FR3 |
| X3, the sheet's generation guard on the success arm | Removed (above). What it stood for is pinned by the reopened-sheet case and by row FR4 (the close says done or cancel from its own phase) |
| X4, the blur test that forgets the focused control only when focus leaves the block | New case: "a blur to nowhere (the window lost focus) keeps the control, so the empty read still puts focus on the card". Row FR5 |

### F4: the browser pause case can go red under M8

- **The read lags the answer.** The pause POST's answer says paused, while the re-read after it still reads running.
- **The case waits for that re-read's response,** then asserts the button still reads `Pause line` and no `Resume line` is drawn.
- **Then it serves a paused line and triggers a page-return read.** Only then does `Resume line` appear.
- **Resume does the same.** Its answer and the next read are set when the POST arrives, not before the click.
- **Row M8's browser half was measured red** (row M8b below).

### F5: the case count

`wave5k-task-7.md` then said the four files have 18, 18, 1 and 116 cases, 153 in all, which held before this round's new cases. Those cases moved them; fix round 2 records the counts at its tip.

### F6: no fixed wait in browser case 2

The moved answer now also carries a new dependant, #111. Instead of a fixed 500 ms wait, the case waits until the sheet shows "these open entries wait on it directly: #107, #111.", which is the sheet adopting the re-read. Only then does it send the second confirm.

## The rows of the plan that moved

- **Row M12** ("the sheet's rejection path skips `onReload`") and **row M40's withdraw half** ("a door's answer does not call `reload`") now mutate `LandingLine`'s withdrawer, where the one re-read lives: rows FR2 and FR1.
- **Row M46** ("the block-gone focus effect is removed") now mutates the generalised effect: row M46r.

The plan's text of those rows was unchanged in this round, and this note recorded the new target; the coordinator edited the two rows after the merge (the plan's section 12, B5).

## The new mutation rows

Each row was run by the scratchpad runner used for Task 8's rows:

1. It saved a copy of the file and took its sha256.
2. It applied the one replacement; the old text occurs exactly once.
3. It ran the named files through `ccrc test`. From `pwa/`, that is `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`. Row M8b instead ran `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 --config vitest.browser.config.ts browser/landing-line.browser.test.ts -t "at 390px: the line as read"`, with the box's existing Chrome from `CCRC_CHROME`.
4. It restored the copy and checked its sha256 against the one taken before.

Every row below was red in its predicted case, and every restore matched.

| Row | Guards | Mutation | Predicted red |
|---|---|---|---|
| FR1 | the line re-reads on the door's answer (F1; M40's withdraw half) | the withdrawer's answer arm drops `reread()` | the sheet-open case; the Cancel-mid-flight case |
| FR2 | the line re-reads on a refusal (F1; M12) | the withdrawer's refusal arm drops `reread()` | the sheet-open case; the Escape-mid-flight case |
| FR3 | the sheet's second tap while busy (X1) | `busy \|\|` removed from the confirm's guard | the sheet's second-tap case |
| FR4 | a close says done or cancel from the sheet's own phase (what X3 stood for) | the sheet always closes as `done` | the sheet's close case; `Cancel with the row still drawn`; the reopened-sheet case |
| FR5 | a blur to nowhere keeps the focused control (X4) | the blur forgets the control whatever `relatedTarget` is | the blur-to-nowhere case |
| FR6 | section 11's document order (F2) | the pause button moved before the status in the document | the document-order case |
| FR7 | focus from a removed row goes to the pause button first (F1) | the chain skips the pause button | the Cancel-mid-flight case |
| M46r | the generalised focus effect (M46) | the effect always returns early | the Cancel-mid-flight case; Resume on an empty line; the blur-to-nowhere case |
| M8b | M8's browser half (F4) | M8's own mutant: the label flips on the pause door's answer | the browser pause round trip, at 390 px in both skins and themes |

The records follow, as the runner wrote them, except row M8b's, whose second edit was written in by hand in fix round 2.

### FR1

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `withdraw(p, pr, pinnedAt).then((a) => { reread(); return a; }` → `withdraw(p, pr, pinnedAt).then((a) => a`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× with the sheet open: one re-read on the answer, and one on a refusal 62ms`
    - `× closed by Cancel while the door is in flight, then its answer: one re-read, nothing more drawn, and focus from the removed row to the pause button 44ms`
    - `× a sheet opened again before the earlier answer lands shows nothing of it, and its Cancel is a cancel 97ms`
    - `Tests  3 failed | 41 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > with the sheet open: one re-read on the answer, and one on a refusal`
    - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > closed by Cancel while the door is in flight, then its answer: one re-read, nothing`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### FR2

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `(err: unknown) => { reread(); throw err; }` → `(err: unknown) => { throw err; }`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× with the sheet open: one re-read on the answer, and one on a refusal 90ms`
    - `× closed by Escape while the door is in flight, then a refusal: one re-read, no alert, no sheet 37ms`
    - `Tests  2 failed | 42 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > with the sheet open: one re-read on the answer, and one on a refusal`
    - `AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > closed by Escape while the door is in flight, then a refusal: one re-read, no alert`
    - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### FR3

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `if (busy || preview === null) return;` → `if (preview === null) return;`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× a second tap while the first call is in flight sends nothing (fix round 1, F3) 57ms`
    - `Tests  1 failed | 43 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the confirm phase > a second tap while the first call is in flight sends nothing (fix round 1, F3)`
    - `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times`
- Restored from the saved copy; sha256 after restore `858910ec7141c30383f5927e9c266c7a194258d6496dd7556e3c6ede2a329a03` (matches the copy taken before)

### FR4

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `onClose(phase.kind === 'done' ? 'done' : 'cancel')` → `onClose('done')`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× Cancel closes as cancel, and Done closes as done (fix round 1) 46ms`
    - `× Cancel with the row still drawn: its Withdraw 80ms`
    - `× closed by Cancel while the door is in flight, then its answer: one re-read, nothing more drawn, and focus from the removed row to the pause button 144ms`
    - `× a sheet opened again before the earlier answer lands shows nothing of it, and its Cancel is a cancel 258ms`
    - `Tests  4 failed | 40 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > focus on close (m7, R6) > Cancel with the row still drawn: its Withdraw`
    - `AssertionError: expected <button type="button" …(2)></button> to be <button type="button" …(2)></button> // Object.is equality`
- Restored from the saved copy; sha256 after restore `858910ec7141c30383f5927e9c266c7a194258d6496dd7556e3c6ede2a329a03` (matches the copy taken before)

### FR5

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `if (next instanceof Node && !(sectionRef.current?.contains(next) ?? false)) lastFocused.current = null;` → `void next; lastFocused.current = null;`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× a blur to nowhere (the window lost focus) keeps the control, so the empty read still puts focus on the card (fix round 1, F3) 18ms`
    - `Tests  1 failed | 43 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the block removes itself (R6) > a blur to nowhere (the window lost focus) keeps the control, so the empty read still puts focus on the card (fix round 1, F3)`
    - `AssertionError: expected <body style><div>…(1)</div></body> to be <section tabindex="-1" …(2)>…(1)</section> // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### FR6

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, the pause `<Button …>` element moved from after the stale sentence to before the status paragraph (the status and stale lines, then the button, became the button, then the status and stale lines)
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× in the document: the title, the status, the stale sentence, the pause button, then the alert and the rows (section 11; fix round 1, F2) 33ms`
    - `Tests  1 failed | 43 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > accessibility > in the document: the title, the status, the stale sentence, the pause button, then the alert and the rows (section 11; fix round 1, F2)`
    - `AssertionError: expected [ 'title', 'pause', 'status', …(3) ] to deeply equal [ 'title', 'status', 'stale', …(3) ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### FR7

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, the removed-control effect's `firstInDocument([pauseRef.current, focusFallback.current])` → `firstInDocument([focusFallback.current])`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× closed by Cancel while the door is in flight, then its answer: one re-read, nothing more drawn, and focus from the removed row to the pause button 70ms`
    - `Tests  1 failed | 43 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > closed by Cancel while the door is in flight, then its answer: one re-read, nothing`
    - `AssertionError: expected <section tabindex="-1" …(2)>…(2)</section> to be <button type="button" …(2)></button> // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### M46r

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `if (sheet !== null || held === null || held.isConnected) return;` → `if (sheet !== null || held === null || held.isConnected || held !== null) return;`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× closed by Cancel while the door is in flight, then its answer: one re-read, nothing more drawn, and focus from the removed row to the pause button 96ms`
    - `× Resume on a line with no entries, then an empty read: focus on the card 27ms`
    - `× a blur to nowhere (the window lost focus) keeps the control, so the empty read still puts focus on the card (fix round 1, F3) 21ms`
    - `Tests  3 failed | 41 passed (44)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > closed by Cancel while the door is in flight, then its answer: one re-read, nothing`
    - `AssertionError: expected <body style><div>…(1)</div></body> to be <button type="button" …(2)></button> // Object.is equality`
    - `- Expected`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### M8b

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `    const label = busy ? card.pauseBusyLabel : card.pauseLabel;` → `    const label = busy ? card.pauseBusyLabel : (error === '' ? (card.pauseNext ? 'Resume line' : 'Pause line') : card.pauseLabel);` and, in the same file, in the pause tap's answer arm, `setError('');` inserted between `setBusy(false);` and `onReload?.();` (the label reads the read's word again only while `error` is not `''`: on a refusal, or before any tap)
- `--config vitest.browser.config.ts browser/landing-line.browser.test.ts -t at 390px: the line as read`: exit 1 (RED)
    - `× at 390px: the line as read, its fit, the pause round trip, Cancel's and Done's focus 10966ms`
    - `× at 390px: the line as read, its fit, the pause round trip, Cancel's and Done's focus 11342ms`
    - `× at 390px: the line as read, its fit, the pause round trip, Cancel's and Done's focus 10810ms`
    - `× at 390px: the line as read, its fit, the pause round trip, Cancel's and Done's focus 10653ms`
    - `Tests  4 failed | 76 skipped (80)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  browser/landing-line.browser.test.ts > the landing line, refined light > at 390px: the line as read, its fit, the pause round trip, Cancel's and Done's focus`
    - `FAIL  browser/landing-line.browser.test.ts > the landing line, refined dark > at 390px: the line as read, its fit, the pause round trip, Cancel's and Done's focus`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)


Row M8b's runner kept no assertion line for its four cases. Each failed after about 11 s, which matches the case's 10 s wait for `Pause line` once the re-read has landed: under the mutant the button reads `Resume line` there.

## The green runs after the restores

Every run went through `ccrc test`, from `pwa/`.

- **Source restored:** the sha256 values of `LandingLine.tsx` (`2b3c84b1…990c`) and `LandingWithdrawSheet.tsx` (`858910ec…9a03`) after the last restore are the ones the runner took before each mutation.
- **This wave's pwa files and the edited existing tests:** one run of 16 files, 824 passed, "Type Errors no errors". The files:
  - `landing-words`, `landing-line-view`, `use-landing-lines`, `landing-line`, `landing-withdraw-sheet`, `landing-line-hold` and `project-card`;
  - `older-server-render` and `contrast` (both cite their numbers now);
  - `fleet-css`, `css-vars`, `utility-pairs`, `hover-states`, `focus-ring`, `design-system-boundary` and `refusal-literal-ratchet`.
- **The two component files and the counting tests, after the mutations:** `landing-line`, `landing-withdraw-sheet`, `fleet-list-memo`, `accounts-one-poll`, `fleet-screen` and `programme-box-card` gave 246 passed and 2 skipped. `line-props` alone gave 4 passed. The two skips are `fleet-list-memo`'s, as before this round.
- **The pwa typecheck (`tsc --noEmit`):** the first run was killed by the test slice's memory cap (exit 137, one OOM kill). Run again alone, it exited 0.
- **This wave's browser file** (`browser/landing-line.browser.test.ts`, with the box's Chrome): 80 of 80. That includes the pause case of F4 and case 2 of F6, at all five widths, both skins and both themes, so the F2 layout keeps every control at the tap floor and inside the window, with nothing running sideways.
- **The whole browser suite, once** (`ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts`, the box's Chrome, about 56 minutes under the box's load):
  - Its own result line: "Tests 7 failed | 4477 passed | 1 expected fail | 64 skipped (4549)", over 125 files, 9 of them red. The slice recorded 4 OOM kills.
  - None of the nine red files is this wave's. They are `accounts-cards`, `ask-inline`, `chat-width`, `epic-page`, `lanes-row`, `linear-workspaces`, `model-sheet-labels`, `refusal-copy` and `settings-integrations`.
  - Every failure but one was a 20 or 30 s wait for a first selector or function. The one assertion was `linear-workspaces` counting 0 where 13 were expected, at 360 px in Instrument, phosphor: the page had not drawn.
  - The nine files, re-run together and alone in that run: 717 passed, 12 skipped, exit 0.

## What could not be measured here

- **The tests-inclusive typecheck,** as in Task 8: the box's test slice kills compilers at its memory cap, and the pull request's run is the arbiter.
- **The server suite:** this round changed no server file.
