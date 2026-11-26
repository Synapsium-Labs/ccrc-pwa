# The session hook's quiz row, gated on its literal

Wave 240 of the Overlord programme. The cost is #3418's: the quiz row (#3169) raised the forbidden program's cost on a
quote-dense command by about a third at 32 and 64 KB.

## What changed

- `ccd/session-hook.sh`, inside `APPROVAL_FORBIDDEN_JQ` only: `QZANC` (`q`, `u`, `i`, `z` with only what `norm`
  removes between them, the prune row's `PANC` form) is asked of the command as written before `norm` is computed, in
  the `deny` and `account` modes; `qzmatch` asks `quiz` itself of each form it is given. No pattern of the row changed,
  no mode gained or lost it, and the shell-side prefilter is untouched.
- `server/test/session-hook-gate-equivalence.test.ts`: the gated program against the same program with both gates cut
  out (byte-equal to the program before the gate but for the unused `QZANC` definition), in all three modes, over the
  quiz deny suite's lists (copied) and spellings where only the normalised form holds the literal; the claim, sampled;
  and a cost case against the program with the row deleted at 32 and 64 KB, bound 1.15x.

## Why it is sound

Every alternative of every `qzmatch` pattern holds `quiz` as a literal outside any character class, and every `test`
there is case-sensitive, so no command without that literal can match. `norm` only deletes characters (backslash
before a newline, `$` before a quote, the backslash of an escape, quotes), so its output can hold `quiz` only where the
written command holds those letters with only deleted characters between them, which `QZANC` reads.

## Departures, by slug

- `copied-quiz-lists`: the equivalence suite copies the quiz deny suite's lists; a test file's constants are not
  importable without registering its cases, and that suite is unedited.
- `control-from-the-hook`: the control is cut out of the current hook, not read from `main` by `git show`, so the
  comparison survives the merge.
- `cost-helper-restated`: the cost suite's CPU helper is restated in the new suite; the prune suite is another
  worker's claim and exports nothing.
