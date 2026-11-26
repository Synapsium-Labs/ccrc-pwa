# Wave 5k, Task 8: the browser suite, the mutation rows, the gate

## The browser file

`pwa/browser/landing-line.browser.test.ts` runs four cases at 360, 390, 1280, 1470 and 1920 px, in both skins (Instrument
in its project mode) and in light and dark: 80 cases, all green on their first run. Each case registers its own
`**/api/landing**` route, and the shared fixture in `app.ts` is unchanged (F4). The route answers:

- `project-a` with section 5's five entries;
- `project-b` with an empty line;
- `project-c` with one entry or with a pause and no entries.

It records each POST body.

1. **The line as read.**
   - The empty line's card has no block. `project-a` shows `Next to land: #101.`, every row's words, and a `Withdraw…`
     on every row, `#109` included.
   - Every control of the block is at least 44 px tall and its ring is inside the window. Neither the block nor the
     card runs sideways, and the page does not scroll sideways.
   - `Pause line` records one pause POST with `{project: 'project-a', paused: true}`. `Resume line` appears only after
     the next read answers paused.
   - `Cancel` on `#107`'s sheet gives the focus back to `#107`'s `Withdraw…`.
   - `Withdraw…` on `#104` moves the focus into the sheet. The confirm records `pinnedAt: 1104`, the read's value, and
     the notices are listed. Every read after the POST is without `#104`; after `Done` the row is gone and the focus is
     on the pause button.
2. **`landing-entry-moved` once.** The route answers the refusal and re-pins `#104` at 7777. The sentence shows, the
   sheet stays open, and the next confirm sends 7777.
3. **The only entry (F1).** Withdrawing `project-c`'s one entry, the next read is empty. The sheet keeps `Withdrawn:` and
   the notices; `Done` closes it, the block is gone, and the focus is on the card.
   - The same line answering `landing-entry-terminal`: the refusal's sentence and the gone line stay, with the confirm
     off.
4. **Resume on a line with no entries** (section 11's browser case). The block goes, the focus is on the card, and the
   POST sent `paused: false`.

## Section 5's sketches, and what shows each

| Sketch or sentence | Shown by |
|---|---|
| A running line (five entries, the order, the head, the waits, the ejection, the set-aside row, a Withdraw on each) | `landing-line-view` "a running line" (every row's text); `landing-line` "a line renders the named region"; browser case 1 |
| Paused by you; paused because main is red (with `Pause line`); both | `landing-line-view` "paused …" `it.each`; `landing-line` pause case; browser case 1 |
| Main is red with a fixing head | `landing-line-view` "red with a fixing head" |
| Held; paused and held | `landing-line-view` "held …" and "paused by you and held says both" |
| Paused with no entries; main red alone draws nothing | `landing-line-view` "paused by you with no entries", "main red alone is null"; browser case 4 |
| After a tap on Pause line (busy label, then the read decides) | `landing-line` "Pause sends true once …"; browser case 1 |
| Not read again over a drawn line; nothing on a card without one | `landing-line-view` `landingCardStateOf` cases; `landing-line` "a stale line" |
| The withdraw sheet's words | `landing-withdraw-sheet` "a run-bound entry with one dependant" (every paragraph, exact) |
| A run-less entry; nothing waiting on it | `landing-withdraw-sheet` "a run-less entry with nothing waiting on it" |
| Withdrawn, the notices, coming back, Done | `landing-withdraw-sheet` "the answer"; `landing-line` F1 cases; browser cases 1 and 3 |
| Entry does not match what the screen read | `landing-withdraw-sheet` moved cases; browser case 2 |
| It already left the line | `landing-withdraw-sheet` terminal case; `landing-line` F1 terminal case; browser case 3 |
| Records being recovered | `landing-line` "a refusal followed by an empty read keeps its sentence" |
| The server could not be reached | `landing-withdraw-sheet` "an unreachable server" (the exact sentence with its tail) |
| A word this page does not know | `landing-withdraw-sheet` "an unknown word at 409" |
| Focus after Done, Cancel, and a block that removes itself | `landing-line` "focus on close" and "the block removes itself"; browser cases 1, 3 and 4 |

No sentence on screen differs from the plan's tables.

Two layout details differ from the sketches:

- The pause button sits on the title row, which the sketch also shows. In the document the status follows that row,
  as section 11 says.
- The sketch draws `Withdraw…` at a row's right on its own line. At phone width the role text wraps under the PR, with
  `Withdraw…` on the PR's line.

## Mutation rows

M1 to M51, less the retired M15 and M37, each measured red by the named test. M32 and M40 name two changes each, measured
as M32a/M32b and M40a/M40b, and M42 names two, measured as M42a (decided from the word) and M42b (the tail left off).
That is 52 mutants. Each one:

- copied the file to the session's scratch directory and hashed it;
- applied one replacement (the old text occurs exactly once; a row with a second edit says so);
- ran the named tests through `ccrc test`, its pwa files together in one run, a `server:` file from `server/`, and the
  typecheck for M6;
- copied the file back and checked its sha256 against the hash taken before.

All 52 went red in the predicted case, and `git status` showed no source change after the run.

The rows whose predicted red also names a browser case (M4, M7, M8, M12, M38, M44, M45) were measured red by their jsdom
cases. The browser file was not run under each mutant: each browser run is 80 cases.

Each row below lists, from its run's output, its mutation, the failing cases (the first eight lines of the failure) and
the restore hash.

### M1

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  if (!o.paused && o.head !== null && o.head.id === e.id) return` → `  if ((!o.paused && o.head !== null && o.head.id === e.id) || (('head' in o ? o.head : null) === null && o.order[0]?.id === e.id)) return`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× a running line with no head says none can land 14ms`
    - `× held: no head, a non-empty order, the held status and no head row 4ms`
    - `Tests  2 failed | 33 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: a running line (section 5's first sketch) > a running line with no head says none can land`
    - `AssertionError: expected true to be false // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M2

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  if (o.paused) return { kind: 'paused', by: [...o.by], held: o.held !== undefined };` → `  if (view.operatorPaused) return { kind: 'paused', by: ['operator'], held: o.held !== undefined };`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× paused ["main-red"]: its sentence, no head row, and the label 9ms`
    - `× paused ["operator","main-red"]: its sentence, no head row, and the label 3ms`
    - `Tests  2 failed | 33 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: paused, held, red > paused ["main-red"]: its sentence, no head row, and the label`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: paused, held, red > paused ["operator","main-red"]: its sentence, no head row, and the label`
    - `AssertionError: expected 'Paused by you. Nothing lands.' to be 'Paused by you and because main is red…' // Object.is equality`
    - `Expected: "Paused by you and because main is red. Nothing lands."`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M3

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `WAITS_TEXT(wait.on.map((t) => t.pr))` → `WAITS_TEXT([])`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× rows are the order first, then the other open entries in the read's order, each with its exact text 29ms`
    - `× a waits row with two targets names both, in the read's order 9ms`
    - `Tests  2 failed | 33 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: a running line (section 5's first sketch) > rows are the order first, then the other open entries in the read's order, each with its exact text`
    - `AssertionError: expected [ …(5) ] to deeply equal [ …(5) ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M4

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `withdraw(project, preview.entry.pr, preview.entry.pinnedAt)` → `withdraw(project, preview.entry.pr, Date.now())`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× a run-bound entry with one dependant: every sentence, and the confirm sends the read's pin time 193ms`
    - `× a set-aside row opens with its preview, and its confirm sends that row's pin time (R1) 182ms`
    - `× a new view while open changes neither what the sheet shows nor what it sends 66ms`
    - `× landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time 61ms`
    - `× landing-entry-moved then a re-read equal to the snapshot's view (the same object) keeps the snapshot and its pin time 46ms`
    - `× a view that was already new when the refusal lands is adopted at once 41ms`
    - `× a refusal after which the next read still holds the entry unchanged keeps the snapshot, the sentence and an enabled confirm (section 11, C2) 59ms`
    - `Tests  7 failed | 11 passed (18)`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M5

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `        setError(landingFailureOf(err, 'withdraw').text);` → `        setPhase({ kind: 'done', answer: { entry: preview.entry, previous: preview.entry, changed: true, seq: 0, notices: [] }, preview });`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time 41ms`
    - `× landing-entry-moved then a re-read equal to the snapshot's view (the same object) keeps the snapshot and its pin time 41ms`
    - `× a view that was already new when the refusal lands is adopted at once 42ms`
    - `× a refusal after which the next read still holds the entry unchanged keeps the snapshot, the sentence and an enabled confirm (section 11, C2) 44ms`
    - `× landing-entry-terminal then a read without the entry: the gone line, the confirm off 45ms`
    - `× an unknown word at 409 names it, with no tail 67ms`
    - `× an unreachable server says the outcome is not known 44ms`
    - `× a refusal whose body says it may have applied carries the tail 31ms`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M6

- Mutation: in `pwa/src/fleet/landingWords.ts`, `  'landing-entry-moved': { scope: 'box', text: 'The server\'s record of that entry does not match what this screen read, so nothing was withdrawn. The line is r` → ``
- `test/landing-words.test.ts`: exit 1 (RED)
    - `× every word has one sentence that is non-empty, ends with a full stop, names no code and is its own 12ms`
    - `× landing-entry-moved is box: the plan's sentence, byte for byte 3ms`
    - `× the body decides, not the word: landing-entry-moved with mayApply carries the tail, without it none 2ms`
    - `Tests  3 failed | 40 passed (43)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-words.test.ts > the route words table (wave 5k) > every word has one sentence that is non-empty, ends with a full stop, names no code and is its own`
    - `AssertionError: expected [ 'bad-request', …(29) ] to deeply equal [ 'bad-request', …(30) ]`
    - `- Expected`
- `tsc`: exit 2 (RED)
    - `src/fleet/landingWords.ts(22,14): error TS2741: Property '"landing-entry-moved"' is missing in type '{ 'landing-journal-unavailable': { scope: "box"; text: string; }; 'landing-journal-unreadable': { s`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M7

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  if (open.length === 0 && !view.operatorPaused) return null;` → `  if (open.length < 0 && !view.operatorPaused) return null;`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× no entries and both flags off is null 8ms`
    - `× no entries and main red alone is null (Q2) 2ms`
    - `× a read whose only entries are terminal (an older server) is null 2ms`
    - `× a good answer is a line with no stale sentence; nothing to say is none 4ms`
    - `Tests  4 failed | 31 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: nothing to say > no entries and both flags off is null`
    - `AssertionError: expected { project: 'project-a', …(6) } to be null`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M8

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `    const label = busy ? card.pauseBusyLabel : card.pauseLabel;` → `    const label = busy ? card.pauseBusyLabel : (error === '' ? (card.pauseNext ? 'Resume line' : 'Pause line') : card.pauseLabel);` (and 1 more edit(s))
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it 109ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the pause control > Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M9

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `pause(project, card.pauseNext)` → `pause(project, true)`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it 114ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the pause control > Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it`
    - `AssertionError: expected [ 'project-a', true ] to deeply equal [ 'project-a', false ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M10

- Mutation: in `pwa/src/fleet/landingWords.ts`, `  return done(write ? UNKNOWN_WORD_TEXT(word) : UNKNOWN_WORD_READ_TEXT(word), 'box',` → `  return done('', 'box',`
- `test/landing-words.test.ts`: exit 1 (RED)
    - `× an unknown word names it; on a write the tail follows mayApply or a status of 500 or more, never on a read 15ms`
    - `Tests  1 failed | 42 passed (43)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-words.test.ts > landingFailureOf (wave 5k; section 11, C1 and C3) > an unknown word names it; on a write the tail follows mayApply or a status of 500 or more, never on a read`
    - `AssertionError: expected { text: '', scope: 'box', …(1) } to deeply equal { …(3) }`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M11

- Mutation: in `pwa/src/fleet/landingWords.ts`, `return done(write ? UNREACHABLE_WRITE_TEXT : UNREACHABLE_READ_TEXT, 'box', write);` → `return done(write ? UNREACHABLE_WRITE_TEXT : UNREACHABLE_READ_TEXT, 'box', false);`
- `test/landing-words.test.ts test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× anything else is the unreachable sentence, with the tail on pause and withdraw and not on read 21ms`
    - `× the unreachable write sentence is section 5's, byte for byte 5ms`
    - `× an unreachable server says the outcome is not known 71ms`
    - `Tests  3 failed | 58 passed (61)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the refusals > an unreachable server says the outcome is not known`
    - `AssertionError: expected 'The server could not be reached or di…' to be 'The server could not be reached or di…' // Object.is equality`
    - `Expected: "The server could not be reached or did not answer. Whether this change took effect is not known; the line is read again to show what stands."`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M12

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `        setAdopt(true);
        onReload();` → `        setAdopt(true);`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time 51ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the refusals > landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time`
    - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M13

- Mutation: in `pwa/src/fleet/landingWords.ts`, `  none: (o, ref) => NONE_TEXT[o.reason](ref),` → `  none: (_o, ref) => `Told ${ref}, its coordinator.`,`
- `test/landing-words.test.ts`: exit 1 (RED)
    - `× each kind and reason 11ms`
    - `Tests  1 failed | 42 passed (43)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-words.test.ts > landingNoticeText (wave 5k) > each kind and reason`
    - `AssertionError: expected 'Told #107, its coordinator.' to be 'No one to tell about #107: its run ha…' // Object.is equality`
    - `Expected: "No one to tell about #107: its run has no coordinator."`
    - `Received: "Told #107, its coordinator."`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M14

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `{landingRunless(phase.answer.entry) ? SHEET_NO_RUN : SHEET_COMES_BACK}` → `{SHEET_COMES_BACK}`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× an answer whose entry has no run says it cannot come back 129ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the answer > an answer whose entry has no run says it cannot come back`
    - `AssertionError: expected 'Withdraw #110?Withdrawn: #110 is out …' to contain 'It has no run, so it cannot come back…'`
    - `Expected: "It has no run, so it cannot come back into the line."`
    - `Received: "Withdraw #110?Withdrawn: #110 is out of the line. Nothing that waited on it was freed.It comes back if its run is pinned at merging again.Done"`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M16

- Mutation: in `pwa/src/fleet/landingWords.ts`, `  'landing-projection-unreadable': { scope: 'box',` → `  'landing-projection-unreadable': { scope: 'absent',`
- `test/landing-words.test.ts test/landing-line-view.test.ts`: exit 1 (RED)
    - `× landing-projection-unreadable: none with no previous line, and over a line keeps it with its sentence as stale (R2) 7ms`
    - `× every word has one sentence that is non-empty, ends with a full stop, names no code and is its own 19ms`
    - `× landing-projection-unreadable is box: the plan's sentence, byte for byte 6ms`
    - `× not-configured is absent; landing-projection-unreadable is box on every door 3ms`
    - `Tests  4 failed | 74 passed (78)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardStateOf (D-9109, round 2) > landing-projection-unreadable: none with no previous line, and over a line keeps it with its sentence as stale (R2)`
    - `AssertionError: expected false to be 'A record of the landing line does not…' // Object.is equality`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M17

- Mutation: in `pwa/src/fleet/landingWords.ts`, `  'not-configured': { scope: 'absent',` → `  'not-configured': { scope: 'box',`
- `test/landing-words.test.ts test/landing-line-view.test.ts`: exit 1 (RED)
    - `× every word has one sentence that is non-empty, ends with a full stop, names no code and is its own 26ms`
    - `× not-configured is absent: the plan's sentence, byte for byte 10ms`
    - `× not-configured is absent; landing-projection-unreadable is box on every door 7ms`
    - `× not-configured over a previous line is none 36ms`
    - `Tests  4 failed | 74 passed (78)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardStateOf (D-9109, round 2) > not-configured over a previous line is none`
    - `AssertionError: expected { kind: 'line', view: { …(6) }, …(2) } to deeply equal { kind: 'none' }`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M18

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  return { kind: 'line', view: prev.view, card: prev.card, stale: failure };` → `  return NONE;`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× the row count, the status letter and the stale mark 21ms`
    - `× a box failure over a previous line keeps its view and card with the failure as stale 3ms`
    - `× landing-projection-unreadable: none with no previous line, and over a line keeps it with its sentence as stale (R2) 2ms`
    - `× an unreadable raw over a previous line keeps it with the unreadable-answer sentence 3ms`
    - `Tests  4 failed | 31 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingLineHoldPart (R8) > the row count, the status letter and the stale mark`
    - `AssertionError: expected '' to be '5rs' // Object.is equality`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M19

- Mutation: in `pwa/src/fleet/useLandingLines.ts`, `  useEffect(() => { if (key !== readKey.current) reload(); }, [key, reload]);` → `  useEffect(() => { reload(); });`
- `test/use-landing-lines.test.tsx`: exit 1 (RED)
    - `× on mount reads each distinct project once, and the project-set effect adds no second read 26ms`
    - `× a re-render with the same set reads nothing; after 60 s every project is read once more, and not before 43ms`
    - `× a cold load: mounted with no projects, then the list arrives, reads both at once, before any tick (R4) 6ms`
    - `× a project that joins is read at once, with every other project; one that leaves leaves the map 6ms`
    - `× the request's raw is a Map with one PollOutcome per project read 8ms`
    - `× a return to the page reads every project once 5ms`
    - `× reload() reads every project once and keeps its identity across renders 4ms`
    - `× unmounting aborts the reads in flight 4ms`
- Restored from the saved copy; sha256 after restore `bc22509a763d7dad8d8de87f63eeff38877163af7f36999ad0b2f64e129ee527` (matches the copy taken before)

### M20

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `pinnedAt: e.pinnedAt, runId` → `runId`
- `test/landing-line-view.test.ts test/use-landing-lines.test.tsx`: exit 1 (RED)
    - `× a different pinnedAt on one entry is not equal, nor a different afterIds 17ms`
    - `× an answer equal under sameLandingState keeps the same object; a changed answer replaces only that project's 14ms`
    - `Tests  2 failed | 44 passed (46)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > sameLandingState > a different pinnedAt on one entry is not equal, nor a different afterIds`
    - `AssertionError: expected true to be false // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M21

- Mutation: in `pwa/src/fleet/useLandingLines.ts`, `  const reload = useCallback(` → `  useEffect(() => { const t = setInterval(() => { void api.landingLine('project-a'); }, 60_000); return () => clearInterval(t); }, []);
  const reload = useCall`
- `server:test/rings/pwa-one-owner.test.ts`: exit 1 (RED)
    - `× the hand-written request polls may only go: at most HotFilesStrip's and useFleetHealth's 37ms`
    - `× requestPolls(): no hand-written request poll is left in pwa/src 23ms`
    - `Tests  2 failed | 40 passed (42)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/rings/pwa-one-owner.test.ts > the PWA reads /api/accounts in one place (D-7180, ARCH-28 #540) > the hand-written request polls may only go: at most HotFilesStrip's and useFleetHealth's`
    - `AssertionError: expected [ { …(5) } ] to deeply equal []`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `bc22509a763d7dad8d8de87f63eeff38877163af7f36999ad0b2f64e129ee527` (matches the copy taken before)

### M22

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `import { sameJson } from '../lib/sameJson';
` → `import { sameJson } from '../lib/sameJson';
import { api } from '../lib/api';
export const NOT_PURE = api;
`
- `server:test/rings/pwa-rings.test.ts`: exit 1 (RED)
    - `× the L1 modules' forbidden runtime edges are exactly the exemptions 3115ms`
    - `Tests  1 failed | 9 passed (10)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/rings/pwa-rings.test.ts > a PWA L1 module loads no .tsx, no store and not lib/api.ts (ARCH-04 stage 3, D-6118) > the L1 modules' forbidden runtime edges are exactly the exemptions`
    - `AssertionError: an L1 module loads a .tsx file, a store or lib/api.ts: move the value inward (a pure .ts module or shared/), take it as an argument, or make the import type-only: expected [ Array(1) ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M23

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `open.filter((e) => e.id !== entryId && e.afterIds.includes(entryId))` → `open.filter((e) => e.id !== entryId && (e.afterIds.includes(entryId) || open.some((d) => d.afterIds.includes(entryId) && e.afterIds.includes(d.id))))`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× direct dependants only, each with its PR; runless; the view it was read from 10ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > withdrawPreviewOf > direct dependants only, each with its PR; runless; the view it was read from`
    - `AssertionError: expected [ { entryId: 1004, pr: 104 }, …(1) ] to deeply equal [ { entryId: 1004, pr: 104 } ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M24

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `return { kind: 'red-fixes-main', headPr: o.head.pr };` → `return { kind: 'paused', by: ['main-red'], held: false };`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× red with a fixing head: its own status and sentence, and the head row 35ms`
    - `× the row count, the status letter and the stale mark 9ms`
    - `Tests  2 failed | 33 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: paused, held, red > red with a fixing head: its own status and sentence, and the head row`
    - `AssertionError: expected { kind: 'paused', …(2) } to deeply equal { kind: 'red-fixes-main', headPr: 101 }`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M25

- Mutation: in `pwa/src/fleet/useLandingLines.ts`, `export const LANDING_LINE_POLL_MS = 60_000;` → `export const LANDING_LINE_POLL_MS = null;`
- `test/use-landing-lines.test.tsx`: exit 1 (RED)
    - `× a re-render with the same set reads nothing; after 60 s every project is read once more, and not before 9ms`
    - `Tests  1 failed | 10 passed (11)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/use-landing-lines.test.tsx > useLandingLines (wave 5k, D-9108) > a re-render with the same set reads nothing; after 60 s every project is read once more, and not before`
- Restored from the saved copy; sha256 after restore `bc22509a763d7dad8d8de87f63eeff38877163af7f36999ad0b2f64e129ee527` (matches the copy taken before)

### M26

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `  const preview = snapshot.preview;` → `  const preview = view === null ? null : withdrawPreviewOf(view, entryId);`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× a new view while open changes neither what the sheet shows nor what it sends 162ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the snapshot (R3) > a new view while open changes neither what the sheet shows nor what it sends`
    - `AssertionError: expected 'Withdraw #104?#104 leaves project-a\'…' to contain 'wait on it directly: #107.'`
    - `Expected: "wait on it directly: #107."`
    - `Received: "Withdraw #104?#104 leaves project-a's landing line and will not land from it.Nothing that waits on it is freed. An entry declared after it keeps waiting until a session declares its order a`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M27

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `[...view.order.order.map((e) => byId.get(e.id)), ...open]` → `[...open, ...view.order.order.map((e) => byId.get(e.id))]`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× rows are the order first, then the other open entries in the read's order, each with its exact text 15ms`
    - `× an inconsistent read that lists the ejected and unknown entries in order.order still gives them their own roles 3ms`
    - `Tests  2 failed | 33 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: a running line (section 5's first sketch) > rows are the order first, then the other open entries in the read's order, each with its exact text`
    - `AssertionError: expected [ …(5) ] to deeply equal [ …(5) ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M28

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `view.entries.filter((e) => !LANDING_ENTRY_TERMINAL[e.state])` → `view.entries.filter(() => LANDING_ENTRY_TERMINAL !== null)`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× a read whose only entries are terminal (an older server) is null 14ms`
    - `× a run-less entry is runless; an id not open is null 3ms`
    - `Tests  2 failed | 33 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: nothing to say > a read whose only entries are terminal (an older server) is null`
    - `AssertionError: expected { project: 'project-a', …(6) } to be null`
    - `- Expected:`
    - `+ Received:`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M29

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `!isLandingEntryState(state)` → `typeof state !== 'string'`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× a missing ok, a state outside the vocabulary, a non-array entries and a non-boolean operatorPaused each answer null 9ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > readLandingLine, the wire guard > a missing ok, a state outside the vocabulary, a non-array entries and a non-boolean operatorPaused each answer null`
    - `AssertionError: expected { project: 'project-a', …(5) } to be null`
    - `- Expected:`
    - `+ Received:`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M30

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  if (e.state === 'ejected') return` → `  if (e.state === 'ejected' && !o.order.some((x) => x.id === e.id)) return` (and 1 more edit(s))
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× an inconsistent read that lists the ejected and unknown entries in order.order still gives them their own roles 8ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: a running line (section 5's first sketch) > an inconsistent read that lists the ejected and unknown entries in order.order still gives them their `
    - `AssertionError: expected [ [ 101, 'head' ], …(4) ] to deeply equal [ [ 101, 'head' ], …(4) ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M31

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  if (o.held !== undefined) return { kind: 'held' };
  if (view.mainRedHold && o.head !== null && o.head.fixesMain) return { kind: 'red-fixes-main', headPr: o.h` → `  if (view.mainRedHold && o.head !== null && o.head.fixesMain) return { kind: 'red-fixes-main', headPr: o.head.pr };
  if (o.held !== undefined) return { kind: `
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× held with main red and a literal fixing head is still held 10ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: paused, held, red > held with main red and a literal fixing head is still held`
    - `AssertionError: expected { kind: 'red-fixes-main', headPr: 101 } to deeply equal { kind: 'held' }`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M32a

- Mutation: in `pwa/src/fleet/useLandingLines.ts`, `read(p, signal)` → `read(p, new AbortController().signal)`
- `test/use-landing-lines.test.tsx`: exit 1 (RED)
    - `× unmounting aborts the reads in flight 12ms`
    - `Tests  1 failed | 10 passed (11)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/use-landing-lines.test.tsx > useLandingLines (wave 5k, D-9108) > unmounting aborts the reads in flight`
    - `AssertionError: expected false to be true // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `bc22509a763d7dad8d8de87f63eeff38877163af7f36999ad0b2f64e129ee527` (matches the copy taken before)

### M32b

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `  useEffect(() => () => { gen.current += 1; }, []);
  const pauseRef` → `  const pauseRef`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× unmounting before the answer lands calls nothing 30ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the pause control > unmounting before the answer lands calls nothing`
    - `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times`
    - `Received:`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M33

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `        setError(landingFailureOf(err, 'pause').text);
` → ``
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× a refusal shows its sentence in an alert, never a changed label, and re-reads 61ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the pause control > a refusal shows its sentence in an alert, never a changed label, and re-reads`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M34

- Mutation: in `pwa/src/fleet/landingWords.ts`, `(pr === null ? `entry ${entryId}` : `#${pr}`)` → ``#${pr}``
- `test/landing-words.test.ts`: exit 1 (RED)
    - `× a dependant the line as read does not name is entry <id> 10ms`
    - `Tests  1 failed | 42 passed (43)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-words.test.ts > landingNoticeText (wave 5k) > a dependant the line as read does not name is entry <id>`
    - `AssertionError: expected 'Could not tell the coordinator of #nu…' to be 'Could not tell the coordinator of ent…' // Object.is equality`
    - `Expected: "Could not tell the coordinator of entry 555: its run could not be read."`
    - `Received: "Could not tell the coordinator of #null: its run could not be read."`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M35

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `    failure = { text: UNREADABLE_ANSWER_TEXT, scope: 'box', outcomeUnknown: false };` → `    failure = landingFailureOf(new Error('unreadable'), 'read');`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× an unreadable raw over a previous line keeps it with the unreadable-answer sentence 23ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardStateOf (D-9109, round 2) > an unreadable raw over a previous line keeps it with the unreadable-answer sentence`
    - `AssertionError: expected { …(3) } to deeply equal { …(3) }`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M36

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `disabled={preview === null}` → `disabled={false}`
- `test/landing-withdraw-sheet.test.tsx test/landing-line.test.tsx`: exit 1 (RED)
    - `× landing-entry-terminal then a read without the entry: the gone line, the confirm off 44ms`
    - `× landing-entry-terminal on the only entry, then an empty read: the sentence and the gone line stay until closed, confirm off 149ms`
    - `Tests  2 failed | 34 passed (36)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the sheet outlives the line (F1) > landing-entry-terminal on the only entry, then an empty read: the sentence and the gone line stay until closed, confirm off`
    - `AssertionError: expected false to be true // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M38

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `  if (block === null && sheet === null) return null;` → `  if (block === null) return null;`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× a withdrawal of the only entry: the sheet keeps its answer after the re-read empties the line; Done leaves nothing, focus on the card 126ms`
    - `× landing-entry-terminal on the only entry, then an empty read: the sentence and the gone line stay until closed, confirm off 87ms`
    - `× a refusal followed by an empty read keeps its sentence 54ms`
    - `× Cancel with the block gone: the card 39ms`
    - `Tests  4 failed | 14 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the sheet outlives the line (F1) > a withdrawal of the only entry: the sheet keeps its answer after the re-read empties the line; Done leaves nothing, focus on the c`
    - `FAIL  test/landing-line.test.tsx > the sheet outlives the line (F1) > landing-entry-terminal on the only entry, then an empty read: the sentence and the gone line stay until closed, confirm off`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M39

- Mutation: in `pwa/src/fleet/FleetCards.tsx`, `: c.rows.length}${line(p)}`` → `: c.rows.length}``
- `test/landing-line-hold.test.tsx`: exit 1 (RED)
    - `× a card with section 5's line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps today's part 85ms`
    - `Tests  1 failed (1)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-hold.test.tsx > the landing part of the view-hold key (F8, R8) > a card with section 5's line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps `
    - `AssertionError: expected 'project-a:1' to be 'project-a:1~5r' // Object.is equality`
    - `Expected: "project-a:1~5r"`
    - `Received: "project-a:1"`
- Restored from the saved copy; sha256 after restore `12aad552cd5b0665589530f6eadb481cda909a6ad55f59471751fb1a6fd30b00` (matches the copy taken before)

### M40a

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `        setBusy(false);
        onReload?.();
      },
      (err` → `        setBusy(false);
      },
      (err`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it 39ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the pause control > Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it`
    - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M40b

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `        setPhase({ kind: 'done', answer, preview });
        onReload();` → `        setPhase({ kind: 'done', answer, preview });`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× Withdrawn, one line per notice, the line about coming back, Done, and one re-read 71ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the answer > Withdrawn, one line per notice, the line about coming back, Done, and one re-read`
    - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M41

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  if (open.length === 0 && !view.operatorPaused) return null;` → `  if (open.length === 0 && !view.operatorPaused && !view.mainRedHold) return null;`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× no entries and main red alone is null (Q2) 15ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: nothing to say > no entries and main red alone is null (Q2)`
    - `AssertionError: expected { project: 'project-a', …(6) } to be null`
    - `- Expected:`
    - `+ Received:`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M42a

- Mutation: in `pwa/src/fleet/landingWords.ts`, `    return done(known, LANDING_ROUTE_WORDS[word as LandingRouteWord].scope, write && mayApply);` → `    return done(known, LANDING_ROUTE_WORDS[word as LandingRouteWord].scope, write && ['landing-journal-append', 'landing-db-apply', 'landing-db-commit'].include`
- `test/landing-words.test.ts`: exit 1 (RED)
    - `× a known word answers its sentence and scope, with the tail exactly when the body says mayApply on a write 8ms`
    - `× the body decides, not the word: landing-entry-moved with mayApply carries the tail, without it none 2ms`
    - `Tests  2 failed | 41 passed (43)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-words.test.ts > landingFailureOf (wave 5k; section 11, C1 and C3) > a known word answers its sentence and scope, with the tail exactly when the body says mayApply on a write`
    - `AssertionError: expected { …(3) } to deeply equal { …(3) }`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M42b

- Mutation: in `pwa/src/fleet/landingWords.ts`, `    return done(known, LANDING_ROUTE_WORDS[word as LandingRouteWord].scope, write && mayApply);` → `    return { text: known, scope: LANDING_ROUTE_WORDS[word as LandingRouteWord].scope, outcomeUnknown: write && mayApply };`
- `test/landing-words.test.ts`: exit 1 (RED)
    - `× a known word answers its sentence and scope, with the tail exactly when the body says mayApply on a write 14ms`
    - `× the body decides, not the word: landing-entry-moved with mayApply carries the tail, without it none 2ms`
    - `Tests  2 failed | 41 passed (43)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-words.test.ts > landingFailureOf (wave 5k; section 11, C1 and C3) > a known word answers its sentence and scope, with the tail exactly when the body says mayApply on a write`
    - `AssertionError: expected { …(3) } to deeply equal { …(3) }`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `7fc06765e5bef276d549d5f76ed8ce1d3adfd85f4c9ee8126375761a599cbd09` (matches the copy taken before)

### M43

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `  paused: (s) => STATUS_PAUSED(s.by) + (s.held ? ` ${STATUS_HELD}` : ''),` → `  paused: (s) => STATUS_PAUSED(s.by),`
- `test/landing-line-view.test.ts`: exit 1 (RED)
    - `× paused by you and held says both, the pause first 13ms`
    - `Tests  1 failed | 34 passed (35)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-view.test.ts > landingCardOf: paused, held, red > paused by you and held says both, the pause first`
    - `AssertionError: expected 'Paused by you. Nothing lands.' to be 'Paused by you. Nothing lands. Held: s…' // Object.is equality`
    - `Expected: "Paused by you. Nothing lands. Held: some of this line's records are being recovered. Nothing lands until they are."`
    - `Received: "Paused by you. Nothing lands."`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M44

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `                  onClick={() => openSheet(r.entryId, r.pr)}` → `                  hidden={r.role === 'unknown'}
                  onClick={() => openSheet(r.entryId, r.pr)}`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× a line renders the named region, the status, each row, the chips, and a Withdraw on every row, the set-aside one too 151ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the block > a line renders the named region, the status, each row, the chips, and a Withdraw on every row, the set-aside one too`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M45

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `        setAdopt(true);
` → ``
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time 57ms`
    - `× a view that was already new when the refusal lands is adopted at once 46ms`
    - `× landing-entry-terminal then a read without the entry: the gone line, the confirm off 39ms`
    - `Tests  3 failed | 15 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the refusals > landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time`
    - `AssertionError: expected 'Withdraw #104?#104 leaves project-a\'…' to contain 'wait on it directly: #107, #111.'`
    - `Expected: "wait on it directly: #107, #111."`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M46

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `      focusFallback.current?.focus({ preventScroll: true });
    }
    if (!drawn)` → `    }
    if (!drawn)`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× Resume on a line with no entries, then an empty read: focus on the card 44ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the block removes itself (R6) > Resume on a line with no entries, then an empty read: focus on the card`
    - `AssertionError: expected <body style><div>…(1)</div></body> to be <section tabindex="-1" …(2)>…(1)</section> // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M47

- Mutation: in `pwa/src/fleet/landingLineView.ts`, `${(HOLD_LETTER[s.kind] as (x: LandingStatus) => string)(s)}` → ``
- `test/landing-line-view.test.ts test/landing-line-hold.test.tsx`: exit 1 (RED)
    - `× the row count, the status letter and the stale mark 9ms`
    - `× a card with section 5's line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps today's part 115ms`
    - `Tests  2 failed | 34 passed (36)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-hold.test.tsx > the landing part of the view-hold key (F8, R8) > a card with section 5's line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps `
    - `AssertionError: expected 'project-a:1~5' to be 'project-a:1~5r' // Object.is equality`
    - `Expected: "project-a:1~5r"`
    - `Received: "project-a:1~5"`
- Restored from the saved copy; sha256 after restore `01b3f6bd452b7c01a40811c49234eddb670571b659ab4c6b975e43c958e070d2` (matches the copy taken before)

### M48

- Mutation: in `pwa/src/fleet/useLandingLines.ts`, `  useEffect(() => { if (key !== readKey.current) reload(); }, [key, reload]);
` → ``
- `test/use-landing-lines.test.tsx`: exit 1 (RED)
    - `× a cold load: mounted with no projects, then the list arrives, reads both at once, before any tick (R4) 11ms`
    - `× a project that joins is read at once, with every other project; one that leaves leaves the map 6ms`
    - `Tests  2 failed | 9 passed (11)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/use-landing-lines.test.tsx > useLandingLines (wave 5k, D-9108) > a cold load: mounted with no projects, then the list arrives, reads both at once, before any tick (R4)`
    - `AssertionError: expected [] to deeply equal [ 'project-a', 'project-b' ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `bc22509a763d7dad8d8de87f63eeff38877163af7f36999ad0b2f64e129ee527` (matches the copy taken before)

### M49

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `      ? [pauseRef.current, focusFallback.current]` → `      ? [rowButtons.current.get(closed.entryId), pauseRef.current, focusFallback.current]`
- `test/landing-line.test.tsx`: exit 1 (RED)
    - `× Done before the re-read lands: the pause button, and still the pause button once the re-read removes the row 69ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > focus on close (m7, R6) > Done before the re-read lands: the pause button, and still the pause button once the re-read removes the row`
    - `AssertionError: expected <button type="button" …(2)></button> to be <button type="button" …(2)></button> // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `6adf3dc4c8f3c61ef30463fcf23e2a6fdcd8faf09dec971fc44dde00f9afc357` (matches the copy taken before)

### M50

- Mutation: in `pwa/src/fleet/LandingWithdrawSheet.tsx`, `  }, [adopt, view, snapshot.view, entryId]);` → `  }, [view]);`
- `test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× a view that was already new when the refusal lands is adopted at once 40ms`
    - `Tests  1 failed | 17 passed (18)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-withdraw-sheet.test.tsx > the refusals > a view that was already new when the refusal lands is adopted at once`
    - `AssertionError: expected [ 1104, 1104 ] to deeply equal [ 1104, 5555 ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `3d8ef16588a4ba0defaa304945fceac13cbe444a6efd5f75602470e371c9c2d9` (matches the copy taken before)

### M51

- Mutation: in `pwa/src/fleet/FleetCards.tsx`, `return part === '' ? '' : `~${part}`;` → `return `~${part}`;`
- `test/landing-line-hold.test.tsx test/programme-box-card.test.tsx`: exit 1 (RED)
    - `× a card with section 5's line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps today's part 53ms`
    - `× a folded card that gains a stalled box with no frame changes its view-hold key, from `project-c:-0` to `project-c:-1` (D-6090; F1, F5) 16ms`
    - `× a folded card's view-hold key holds across a frame that changes no kept box, whatever the clock read (F5) 14ms`
    - `× a folded card that gains a stalled box with no frame changes its view-hold key, from `project-c:-0` to `project-c:-1` (D-6090; F1, F5) 9ms`
    - `× a folded card's view-hold key holds across a frame that changes no kept box, whatever the clock read (F5) 14ms`
    - `Tests  5 failed | 63 passed (68)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line-hold.test.tsx > the landing part of the view-hold key (F8, R8) > a card with section 5's line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps `
- Restored from the saved copy; sha256 after restore `12aad552cd5b0665589530f6eadb481cda909a6ad55f59471751fb1a6fd30b00` (matches the copy taken before)

## The whole suites, after Task 7

All runs went through `ccrc test`. The browser suite used the box's existing Chrome (`CCRC_CHROME`), and nothing was installed into the shared browser cache.

**The pwa suite, whole.** Its result lines:

```
 Test Files  2 failed | 634 passed (637)
      Tests  2 failed | 19601 passed | 2 skipped (19611)
```

The two reds:

- **`older-server-render` W4-U27 is a real red, and it was mine.** The test compares the fleet's markup with its base byte for byte. Task 7 gives the project card's section `tabIndex={-1}`, as the plan says, and the base predates that attribute.
  - I claimed the file (claim 7320) and declared the attribute as one more head-only difference, like the test's others.
  - It is counted once per card before it is stripped: three cards' views hold five cards each, and Instrument's holds none.
  - Its own commit is `test(landing): the older-server baseline declares the card's focusable section (wave 5k)`.
  - This is a departure, `older-server-card-tabindex`: the plan's list of existing tests to touch does not name this file, and the change is a declared difference, not a count.
- **`command-registry`, "the palette's words have one home", is a load timeout:** `Test timed out in 5000ms`. The same run also reported two `Worker forks emitted error` lines.

Both files re-run alone are green: 2 files, 29 cases.

**The browser suite, whole.** Its own result lines:

```
 Test Files  2 failed | 123 passed (125)
      Tests  5 failed | 4491 passed | 1 expected fail | 52 skipped (4549)
```

The five reds are all 20 s selector waits, and none of them is in this wave's files:

- `session-header`, "no chip text is ellipsized", refined and phosphor at 360 and at 390;
- `waiting-controls`, the list in Instrument at 360 light, 390 tokyo-night and 1280 tokyo-night.

Each one waited for its first selector (`.chat-head .metachip`, `.wl-acts`) to show. The same cases at the other widths passed in the same run. Both files re-run alone are green: 2 files, 210 cases.

This wave's browser file, `landing-line.browser.test.ts`, was green in the whole run: 80 of 80.

**The pwa build** passed (`built in 19.20s`).

## The server gate

Each line below is one `ccrc test` run.

| Run | Result |
|---|---|
| server typecheck | clean |
| `landing-subtractive` | 25 passed |
| `landing-writes` | 110 passed |
| `landing-writes-act` | 6 passed |
| `landing-doors-route` | 15 passed |
| `rings/` | 134 passed |
| `census-w7/pwa` | 55 passed |
| `single-definition/` | 1612 of 1613; see below |
| `growth-check` | 63 passed, 3 skipped |
| `citations` | 4 passed |
| `anchors` | 9 passed |
| `topology-clean` | 62 passed |
| `ci-reach` | 36 passed |
| `deviation-refs` | 35 passed, after one fetch of `origin/main` |

- **`single-definition/`'s one red** is `advance-switches`, "the pin scan parses only the test files that spell a W1a basename (D-6111)", at 23 s in the batched run. That file re-run alone: 53 of 53.
- **The tests-inclusive typecheck suite failed on this box, for the box's reasons. It did not get to judge the branch.**
  - In the batched run it reported `no tests`.
  - Re-run alone with `ccrc test --local`, six cases failed:
    - the server and pwa typechecks answered `-1`, because they were killed, which emptied the file lists the discovery cases read;
    - the agent package's typecheck could not find `node:fs`, because this worktree has no `agent/node_modules`.
  - The wrapper's words: "the test slice's memory cap killed a process during this run (MemoryMax=6G, CCRC_TEST_SLICE_MEMORY_MAX; 9 OOM kill(s) in ccrctests.slice)".
  - The pull request's own run is the arbiter.
