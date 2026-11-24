# Follow-up: the doctor asks `ccd caps` through one reader (doctor-caps-one-reader)

Programme `model-class-advance`, epic `doctor`, ticket `doctor-caps-one-reader`. Run 3354. Built on `main` with wave 3
(#3118), wave 8 (#3122) and the release-lookup pins (#3216) in it. This is wave 7 review's finding F6.

## What changed

- **One reader.** `ccd/ccrc-doctor-checks` now asks `ccd caps` in one function, `_dr_ccd_caps`. It runs once under one
  bound, `CCRC_DOCTOR_DOCS_TIMEOUT`, which two of the three old reads already used. No new setting. It answers one of
  two states, and callers can tell them apart:
  - **measured:** return code 0, with the word list in `DR_CCD_CAPS`. The list may lack the word asked about, or be
    empty.
  - **unmeasured:** return code 1. This covers no ccd, a non-zero exit, or the bound passing.

  `_dr_ccd_lists <word>` asks the measured list for one whole word. The remedy for an unmeasured read is one string,
  `DR_CCD_CAPS_FIX`, and it is byte-identical to cap-floor's remedy from before.
- **One read per check, not one per doctor run.** `cmd_doctor` runs each check in its own subshell
  (`out="$( "_check_$name" )"` in `ccd/ccrc`), so a value one check reads cannot reach the next one. Each of the three
  checks reads once.
- **An unmeasured read is never a PASS, and never worded as if it were measured.**
  - **docs:** a read that did not answer WARNs "ccd caps did not answer, so whether this ccd lists docs-log-v1
    docs-sections-v2 was not measured", with the remedy above. "does not list" is kept for a measured list without the
    word.
  - **cap-floor:** unchanged. Its FAIL text and remedy are byte-identical.
  - **model-advance-blocked:** a read that did not answer keeps every `alias-source-absent` row as it reads once ccd
    marks alias launches. The row is no longer demoted to the note, and the detail ends "; ccd caps did not answer, so
    whether this box's ccd marks alias launches was not measured". The detail is added only when such a row exists. A
    measured list without `alias-launch-v1`, from an older ccd, keeps today's note. The bound moved from
    `CCRC_DOCTOR_GH_TIMEOUT` (15 s) to the reader's bound (20 s).
- **The guard** is in `server/test/ccrc-doctor-caps-reader.test.ts`, the doctor test that owns these checks. It is not
  in the single-definition area file that reads the ccd side, because another run's claim held that file. The guard
  checks that the checks file calls `ccd caps` on exactly one non-comment line, and that this line is inside
  `_dr_ccd_caps`. A second row in the same test shows which strings the guard counts as a call:
  - a call: each call shape the checks used before;
  - not a call: prose strings, remedies and comments that name `ccd caps`.

## Which tests cover each caller

| Caller | Measured, with and without its words | Unmeasured |
|---|---|---|
| docs | `ccrc-doctor-caps-reader.test.ts` (both words, no `docs-log-v1`, neither); the docs block of `ccrc-doctor-exposure.test.ts` | caps-reader: exit 1, past the bound; exposure: exit 1, wording changed from "does not list" |
| cap-floor | caps-reader (exact PASS and FAIL lines); `ccrc-doctor-cap-floor.test.ts` | caps-reader: exit 1, past the bound, no ccd, each with the exact text and remedy; cap-floor test: the same three |
| model-advance-blocked | `ccrc-doctor-model-advance.test.ts`, the Anthropic lane block (exact WARN with `alias-launch-v1`, exact note without) | the same block: exit 1, past the bound, no ccd (each the kept WARN with its detail); a file cause gets no detail; the earlier "no ccd reads PASS" assertion now expects the WARN |

The commits are, in order: characterization, green on main; the move onto the reader, with no expected output
changed; then the behaviour change and the guard, together in one commit.

## Measured

- **Mutation rows**, in a `git archive` copy of the tree (never this worktree), each run alone and then restored. The
  copy was confirmed byte-identical afterwards.
  - The reader folds an unmeasured read into an empty answer: the model-advance tests go red, 4 cases.
  - The docs check's unmeasured wording is reverted to "does not list": the caps-reader tests go red, 2 cases.
  - A second inline `ccd caps` is added to model-advance-blocked: the guard goes red, 1 case.
  - cap-floor's unmeasured branch is removed: the caps-reader tests go red (3 cases), and so do the cap-floor tests
    (3 cases).
- Without the mutations: caps-reader 12/12, cap-floor 17/17, model-advance 107/107, and the exposure test's docs block
  34/34. The checks file has the same shellcheck warning count as `main` (34).

## Departures

None from the brief.

## Notes for the ledger

- F6 (wave 7 review) is closed by this ticket. The doctor now has one `ccd caps` reader, and the two checks that read a
  failed answer as an empty one no longer do.
