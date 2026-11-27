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

Nothing came out redder or greener than the plan's section 5 predicts. X-door's list of other red cases is the one the plan
asked for: nine besides the two unmount cases.

## The suites run

- `server/test/ccd-train-members.test.ts`: 52 passed (from 48 before: P41, P42 twice, P43).
- `pwa/test/landing-line.test.tsx`: 28 passed, with the vitest type check on; the new control case is the one added.
- `pwa` typecheck (`tsc --noEmit`), once, with `ccrc test --local`: it ran to the end with no output, and the wrapper did not
  die.
- From `server/`, one file per process: `anchors` 9 passed, `citations` 4 passed, `deviation-refs` 35 passed (after one
  `git fetch origin main`).

## Departures

None found. This note names no deviation slug.
