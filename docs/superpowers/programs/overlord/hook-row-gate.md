# The session hook's quiz row, gated on its literal

Wave 240 of the Overlord programme. The red of #3418 prompted the work. This PR's own measurement found that the quiz
row (#3169) raised the forbidden program's cost on a quote-dense command by about a third: 1.27x at 32 KB and 1.48x at
64 KB, against the program with the row deleted.

## What changed

- `ccd/session-hook.sh`, inside `APPROVAL_FORBIDDEN_JQ` only: `QZANC` is asked of the command as written before `norm` is
  computed, in the `deny` and `account` modes. It reads `q`, `u`, `i`, `z` with any run of `QCH` between them, which is
  the prune row's `PANC` form. That is a superset of what `norm` removes, since it reads any `$` and any newline. The
  program gains the anchor and its two call sites, and nothing else. No pattern of the row changed, no mode gained or
  lost it, and the shell-side prefilter is untouched.
- `server/test/session-hook-gate-equivalence.test.ts` checks four things:
  - The gated program against the same program with the gate cut out, in all three modes. The cut must find the gate
    exactly twice. The ungated program is byte-equal to the program before the gate, apart from the unused `QZANC`
    definition.
  - The commands: the quiz deny suite's lists (copied), plus spellings where only the normalised form holds the
    literal, at least one for each member of `QCH` between two of the letters.
  - The claim, sampled.
  - A cost case against the program with the row deleted, at 32 and 64 KB. It reads the faster of three rounds and
    the bound is 1.15x.

## Why it is sound

Every alternative of every `qzmatch` pattern holds `quiz` as a literal outside any character class. Every `test` there
is case-sensitive, so no command without that literal can match. `norm` only deletes characters: a backslash before a
newline, `$` before a quote, the backslash of an escape, and quotes. So its output can hold `quiz` only where the written
command holds those letters with only deleted characters between them, and `QZANC` reads every such command.

## What remains

The saving exists only while the anchor fails. A command that holds the four letters in order, or really names the
quiz, costs what it cost without the gate.

## Rulings

- The judge's `rules-mixed` is accepted with no split, by the coordinator's ruling (review round 1): a guard's change
  lands with the case that goes red without it.
- The literal that was asked inside `qzmatch` was taken out in review round 1. It changed no answer, saved no CPU once
  the anchor was there, and had no case that went red without it.

## Departures, by slug

- `copied-quiz-lists`: the equivalence suite copies the quiz deny suite's lists. A test file's constants are not
  importable without registering its cases, and that suite is unedited.
- `control-from-the-hook`: the control is cut out of the current hook, not read from `main` with `git show`, so the
  comparison survives the merge.
- `cost-helper-restated`: the cost suite's CPU helper is restated in the new suite. The prune suite is another worker's
  claim and exports nothing.
- `program-reader-restated`: the new suite reads the program out of the hook with its own copy of the prune suite's
  pattern for the single-quoted assignment, for the same reason.
- `cost-quotes-only`: the cost case asserts the quote-dense shape only. On the dqsub shape the row's share is within
  start-up noise; the PR body's table carries it.
