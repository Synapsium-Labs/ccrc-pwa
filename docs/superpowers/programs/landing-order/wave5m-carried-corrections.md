# Landing order, wave 5m: the carried corrections, built

Plan: `docs/superpowers/plans/2026-11-27-landing-order-wave5m-carried-corrections.md`, Tasks 1 to 3. Issue #3466. The base
was `6df8f8bb63` (the plan's own merge), and nothing the plan cites had moved on it. This wave changes no product code: it
commits two test files and this note. Every mutant below was applied in place, the named file run once, the original bytes
written back, and the file's sha256 compared with the committed one.

## The cases

| Case | File | What it pins |
|---|---|---|
| P41 | `server/test/ccd-train-members.test.ts` | A doubled v1 block beside a tool block whose content is `[]`: both blocks are bad, and the line printed is the v1 block's sentence, `carries 2 ccrc-train v1 blocks, not one`. |
| P42 (two bodies) | the same | `Infinity` and `-Infinity` in the never-read `blast` key refuse the tool block (the not-one-array sentence). |
| P43 | the same | A key given twice inside the value of the never-read `blast` key refuses the block. The same body with the keys `a` and `b` proves, so the refusal is the doubled key's and not the nested object's. |
| unmount cases (two) | `pwa/test/landing-line.test.tsx` | The door is now `vi.fn<LandingWithdrawer>(() => d.promise)`, and each case asserts it was called once after the confirm and before the unmount. |
| the focus control | the same | The same steps as the focus case beside it, but the page's focus is put on the body (`elsewhere.blur()`) and the case asserts that before the re-render. The read then puts focus on the pause button, which it can only do if the block took its record from the focus event. |

All five were green as soon as they were written, as characterization cases should be. No product file was changed to make
one so, and none was weakened.

## The mutation rows, as measured

Hashes of the code under test, before and after every row: `ccd/lib/train-proof.sh` 8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141,
`pwa/src/fleet/LandingLine.tsx` 2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c,
`pwa/src/fleet/LandingWithdrawSheet.tsx` 858910ec7141c30383f5927e9c266c7a194258d6496dd7556e3c6ede2a329a03. Each was equal to the
committed bytes after its row, and `git status` showed no product file changed.

| Row | Mutation | Command (inside `ccrc test --`) | Red | Green after restore |
|---|---|---|---|---|
| X-bothbad | `train_members`'s first row prints `(tm if tk == 'bad' else v)` | vitest run of `test/ccd-train-members.test.ts` | P41 alone: expected `!train #50 carries 2 ccrc-train v1 blocks, not one`, received `!train #50 has a train-members block that is not one JSON array of members` (1 failed, 51 passed) | 52 of 52 |
| X-infinity | `members_block` passes `parse_constant=lambda c: refuse(c) if c == 'NaN' else float(c)` | the same file | P42, both bodies: expected the not-one-array sentence, received `50` and the train's merge commit, which is the proving line (2 failed, 50 passed). P7's `NaN` case stayed green. | 52 of 52 |
| X-nestedkey | the pairs hook refuses a doubled key only in an object that has a `pr` key | the same file | P43 alone: its first expectation received the proving line (1 failed, 51 passed). P7's doubled `pr` stayed green. | 52 of 52 |
| X-door | the sheet's confirm returns before it calls its door (`|| true` on its guard) | vitest run of `test/landing-line.test.tsx` | 11 failed, 17 passed. Both unmount cases fail on the new call-count line (`expected "vi.fn()" to be called 1 times, but got 0 times`, line 288). The other nine: the only-entry withdrawal that empties the line, the terminal-entry case, the refusal followed by an empty read, both Done cases, the one-re-read-per-answer case, the Cancel-in-flight case, the Escape-in-flight case and the sheet-opened-again case. | 28 of 28 |
| FR8 | the wrapper's generation check removed (`reread` calls `onReload` always) | the same file | Both unmount cases, on `onReload`: `expected "vi.fn()" to not be called at all, but actually been called 1 times` (line 295). Nothing else (2 failed, 26 passed). | 28 of 28 |
| NOREC | the section's `onFocus` record removed (`onFocus={() => {}}`) | the same file | The new control case, at its last line: `document.activeElement` is the body, not the pause button (line 363). Three other cases go red too: the Cancel-in-flight focus case (line 261), Resume on a line with no entries then an empty read (line 329), and the blur-to-nowhere case (line 337). The focus case beside the control stays green, as review 3983 measured: it expects focus to stay on `elsewhere` either way. 4 failed, 24 passed. | 28 of 28 |

One row came out redder than the plan's section 5 predicts: NOREC. The plan's row names one red case, the new control; it
measured four. The reason is that each of the three others needs the block's record to put focus back: the Cancel-in-flight
case, Resume then an empty read, and the blur-to-nowhere case all expect focus to move from a removed control to the pause
button or the card, and with the record gone the effect returns early and focus stays on the body. Every other row is as
predicted. X-door's list of other red cases is the one the plan asked for: nine besides the two unmount cases.

## The suites run

- `server/test/ccd-train-members.test.ts`: 52 passed (from 48 before: P41, P42 twice, P43).
- `pwa/test/landing-line.test.tsx`: 28 passed, with the vitest type check on; the new control case is the one added.
- `pwa` typecheck (`tsc --noEmit`), once, with `ccrc test --local`: it ran to the end with no output, and the wrapper did not
  die.
- From `server/`, one file per process: `anchors` 9 passed, `citations` 4 passed, `deviation-refs` 35 passed (after one
  `git fetch origin main`).

## Fix round 1 (review run 4030, rulings of the coordinator's call 1670)

Four minor findings, none critical or important. Two cases, two rows, two sentences:

- **F3, a case added** beside the control in `pwa/test/landing-line.test.tsx`: the page's focus on the body, no focus event on
  any control of the block, a re-render that removes row #104, a flush, and focus still on the body. Focus on the body is
  asserted before the re-render, as the control does. It shows the record is needed, as the control shows it is enough.
- **F4, a body added** to P43 in the same case: `{"a": 1, "a": 1}`, a key given twice with equal values, expecting the same
  refusal. The prover refuses it today, so this is a case and not a finding about the product.
- **F1, the closing sentence above corrected**, with the reason the three extra NOREC cases go red.
- **F2, the comment above P41 corrected:** the three prover cases come from wave 5l's reviews alone; wave 5k's review
  carried the two console hardenings.

| Row | Mutation | Command (inside `ccrc test --`) | Red | Green after restore |
|---|---|---|---|---|
| M-samevalue | the pairs hook refuses a doubled key only when its values differ: it accepts an object that has a key twice with an equal pair (`or len({(k, repr(v)) for k, v in kv}) < len(kv)` on the accepting side) | vitest run of `test/ccd-train-members.test.ts` | P43, on its new equal-values line (195): expected the not-one-array sentence, received the proving line. P7 goes red too, because its doubled `pr` has equal values (`{"pr": 42, "pr": 42}`). 2 failed, 50 passed. | 52 of 52 |
| M-noheld | the effect in `LandingLine.tsx` no longer returns early when no control is recorded: `if (sheet !== null \|\| (held !== null && held.isConnected)) return;`, which does not throw | vitest run of `test/landing-line.test.tsx` | The new case alone, at its last line (375): expected the body, received the pause button. 1 failed, 28 passed. | 29 of 29 |

Restored sha256 after both rows: `ccd/lib/train-proof.sh` 8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141
and `pwa/src/fleet/LandingLine.tsx` 2b3c84b1e7a5e2f0748138e56bf32e5b41a5bbd8e75435d212805c78499e990c, each equal to the committed
bytes, and `git status` showed only the two test files and this note.

Suites after the round, each alone in the test slice: `ccd-train-members` 52 passed (P43 gained an assertion, no case),
`landing-line` 29 passed with the type check on and no type errors.

## Departures

None found. This note names no deviation slug.
