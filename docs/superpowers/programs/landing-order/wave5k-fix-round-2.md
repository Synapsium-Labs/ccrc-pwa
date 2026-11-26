# Wave 5k, fix round 2 (review run 3969)

Review run 3969 read the tip `b2b75d56b9` and found no behaviour defect. It reported three findings, which the coordinator ruled on in mail 38145 (call 1554). This round changes tests and notes only: **no file under `pwa/src` changed**, and neither did the plan.

X3 stands as built in fix round 1: the sheet's generation guard and the line's `answered` flag stay removed.

## What changed

### F1: the withdraw wrapper's generation check has its case

`LandingLine`'s `sheetWithdraw` re-reads only while the line is mounted (`if (gen.current === mine)`). This is the pause tap's rule from section 4.5. Row M32's recorded run covered only the pause tap; review run 3983 measured its second mutant, the generation ref dropped, red in this round's two unmount cases as well, and row FR8 is the one specific to this check.

- **New case** in `landing-line.test.tsx`, run once for the answer and once for the refusal: "the line unmounted before the door's answer lands: no re-read". Each opens the sheet, confirms with a deferred door, unmounts the line, then resolves or rejects, and expects no `onReload` call.
- **Row FR8:** the check removed.
- **The note's sentence** in `wave5k-fix-round-1.md` that named M32 for the wrapper was changed in this round to say M32 covers the pause tap only, and to point at FR8. The coordinator corrected it again after review run 3983: M32's second mutant also turns this round's two unmount cases red.

### F2: the active-element check has its case, and the sentence says what holds

The behaviour stands. Focus that has gone to the page, a click on blank page included, is placed by the chain when a later read removes the row that last held it.

- **New case:** "focus on another element while the block still holds its record: a read that removes the held row moves no focus".
  - The page's focus is put on another element from script first. Then a focus event marks #104's `Withdraw…` as the block's control, and no blur to an element outside the block follows, so the record stands while focus sits elsewhere.
  - A read then removes #104's row, and focus stays on the other element.
  - This is the one shape in which only the active-element check, not the blur clearing the record, keeps focus where it is.
- **Row FR9:** the active-element check removed.
- **The sentence in `wave5k-fix-round-1.md` now reads:** "Focus that sits on another element is never moved. Focus that has gone to the page is placed by the chain, a click on blank page included."

### F3: the notes

- **The counts**, measured by running each file alone at this round's tip: `landing-line` 27, `landing-withdraw-sheet` 20, `landing-line-hold` 1 and `project-card` 116, 164 in all.
  - Fix round 1 added 6 and 2 cases, and this round 3 and none: 18 + 6 + 3 = 27 and 18 + 2 = 20. The reviewer's 24 and 20 were the counts at round 1's tip.
  - `wave5k-task-7.md` now gives both Task 7's counts (153) and these. `wave5k-fix-round-1.md`'s F5 sentence says its 153 held before that round's cases.
- **Rows M8 and M8b** now state their second edit, so each can be re-run from its note: in the pause tap's answer arm, `setError('');` is inserted between `setBusy(false);` and `onReload?.();`.
  - M8's record is in `wave5k-task-8.md`, M8b's in `wave5k-fix-round-1.md`.
  - Row M30 in `wave5k-task-8.md` had the same gap (its second edit is the `unknown` arm's twin of the `ejected` arm's change). It is filled in too.

The coordinator's note that the plan's section 4.5 and Task 7 Step 1 still describe the sheet with `onReload` and a plain `onClose` is left for the coordinator's ledger pull request. The plan is unchanged in this round.

## The new mutation rows

Each row was run by the same scratchpad runner as fix round 1 and Task 8:

1. It saved a copy of `pwa/src/fleet/LandingLine.tsx` and took its sha256.
2. It applied the one replacement; the old text occurs exactly once.
3. From `pwa/`, it ran `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`.
4. It restored the copy and checked its sha256.

| Row | Guards | Mutation | Predicted red |
|---|---|---|---|
| FR8 | the wrapper re-reads only while the line is mounted (F1) | `const reread = (): void => { if (gen.current === mine) onReload?.(); };` → `const reread = (): void => { void mine; onReload?.(); };` | both unmount cases |
| FR9 | focus on another element is never moved (F2) | `if (active !== null && active !== document.body) return;` → `void active;` | the focus-on-another-element case |

Both were red in their predicted cases, and both restores matched. The records follow, as the runner wrote them.

### FR8

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, `const reread = (): void => { if (gen.current === mine) onReload?.(); };` → `const reread = (): void => { void mine; onReload?.(); };`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× the line unmounted before the door's answer lands: no re-read (the generation ref; fix round 2, F1) 29ms`
    - `× the line unmounted before the door's refusal lands: no re-read (the generation ref; fix round 2, F1) 87ms`
    - `Tests  2 failed | 45 passed (47)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > the line unmounted before the door's answer lands: no re-read (the generation ref; `
    - `FAIL  test/landing-line.test.tsx > the re-read on each answer of the withdraw door is the line's (fix round 1, F1) > the line unmounted before the door's refusal lands: no re-read (the generation ref;`
    - `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times`
    - `Received:`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)

### FR9

- Mutation: in `pwa/src/fleet/LandingLine.tsx`, the removed-control effect's `if (active !== null && active !== document.body) return;` → `void active;`
- `test/landing-line.test.tsx test/landing-withdraw-sheet.test.tsx`: exit 1 (RED)
    - `× focus on another element while the block still holds its record: a read that removes the held row moves no focus (fix round 2, F2) 78ms`
    - `Tests  1 failed | 46 passed (47)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-line.test.tsx > the block removes itself (R6) > focus on another element while the block still holds its record: a read that removes the held row moves no focus (fix round 2, F2)`
    - `AssertionError: expected <button type="button" …(2)></button> to be <button type="button"></button> // Object.is equality`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c` (matches the copy taken before)


## The green runs after the restores

Every run went through `ccrc test`, from `pwa/`, one file per process.

- **Source unchanged:** `LandingLine.tsx`'s sha256 after both restores is `2b3c84b1…990c`, the value at this round's start and in round 1's records. `git status` showed only this round's test file and notes changed.
- **The four files, each alone:** `landing-line` 27 passed, `landing-withdraw-sheet` 20, `landing-line-hold` 1 and `project-card` 116. Each reported "Type Errors no errors".
- **The pwa typecheck (`tsc --noEmit`), once, alone:** exit 0 with no diagnostic, after about 18 minutes queued for a test slot.
- **Not run again: the browser suite.** No file it reads changed in this round, as the coordinator noted.
