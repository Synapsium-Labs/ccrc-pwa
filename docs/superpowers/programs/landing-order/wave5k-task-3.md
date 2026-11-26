# Wave 5k, Task 3: the words

`pwa/src/fleet/landingWords.ts` (L1, C5), with `pwa/test/landing-words.test.ts`, and the file's C5 row in the architecture
spec.

- Every sentence of the plan's section 4.2 is in this file once, with the corrections of section 11 (C1, C2, C3, C4, C8).
- The test's words table is copied from the plan's own text, row by row, by a script that read the plan's table, so each
  of the 31 sentences is pinned byte for byte against the plan rather than against the file.
- `landingFailureOf` follows the four rules. The sentence ends with `OUTCOME_UNKNOWN_TAIL` exactly when `outcomeUnknown`
  is true, and the tail is inside `text` (C1). A read never carries it (C3).
- `landingNoticeText` reads the outcome's kind, its reason and its word through three `Record`s, so a new member is a
  compile error.

## Names the plan left to the builder

The plan gives `PAUSE_LABEL` and `WITHDRAW_LABEL` as text. The file spells them as constants:

- `PAUSE_LABEL` is `{ pause, resume, pausing, resuming }`, and `PAUSE_NAME(label, project)` is the accessible name,
  `<label> for <project>`.
- `WITHDRAW_VISIBLE` is `Withdraw…`, and `WITHDRAW_LABEL(pr, project)` is the accessible name.
- `SHEET_CONFIRM_BUSY` is `Withdrawing…`, and `SHEET_CANCEL` is `Cancel`.

The words are the plan's, unchanged.

`STATUS_PAUSED([])`, a pause with no `by` word, which the server does not send, reads `Paused. Nothing lands.`: the formula
with the empty part left out. No other sentence differs from the plan's tables.

## Runs

`landing-words` (43), `refusal-literal-ratchet`, the pwa typecheck, and from `server/` `rings/pwa-rings` (10),
`rings/totality` (11), `rings/pwa-one-owner` (42): green.
