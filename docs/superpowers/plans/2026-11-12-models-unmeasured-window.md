# A move to a model with no measured window says so, and the history says why the class moved

- **D-8384 (2026-11-12)** — Public issue #2607, options 3 and 4 only: `ccrc doctor`'s `models` row WARNs when a class's last move took its lane off the measured window rule (the new pin has no measured window, the model it moved from has one), in one shared spelling (`unmeasuredMoveNotice`) that `ccrc models <id> show` also answers as `windowNotices`; and a successful advance's history entry records the candidate's reason as `cause` (`newer`, `retired`, `empty`), an entry without it reading as `unknown`. Options 1 and 2 stay open for the operator.

## Why

When a class auto-advances to a model the lane's windows file (`~/.ccrc/models/<id>.windows.json`) does not measure,
`contextWindowFor` (`shared/modelenv.mjs`) leaves the measured rule for the default rule, so
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` drops (400000 to 200000 in the issue) for every session the lane starts, and nothing
says so. The advance file's history recorded that the class moved, never why, so a retirement to an OLDER model read
exactly like an advance to a newer one.

## What changed

- `shared/model-advance.mjs`:
  - `CANDIDATE_REASONS` (`newer`, `retired`, `empty`), the words `chooseCandidate` already answers as `reason`.
  - A history entry may carry `cause`, one of them, on an advance only (`parseAdvance` refuses any other word, or one
    on a hand move or a revert). An automatic intent (`pending`) may carry it too, and `reconcilePending` copies it
    onto the recovered entry. `causeOf(entry)` reads it, `unknown` for an entry written before the field. An older
    build reads such a file unchanged: it keeps keys it does not know.
  - `unmeasuredMoves({registry, advance, windows, rule})`: per class, when `rule` is not `measured`, the class's pin
    has no measured window and its newest successful history entry moved it to that pin from a model that has one.
  - `unmeasuredMoveNotice(lane, move, tokens)`: the one sentence, naming the class, both models, the old window, the
    window now in force and the remedy `ccrc models <lane> set-window <model> <tokens>`. Every name comes from its
    arguments.
- `deploy/models-op.mjs`: `advance-commit` writes `cause: choice.reason` on the intent and on the entry it records;
  `show` answers `windowNotices` (empty with no registry, or an advance file that is absent or unreadable), and each
  `lanes` row carries the same list.
- `ccd/ccrc-doctor-checks` `_check_models`: asks `lanes` once for the whole roster (the windows and advance file names
  are models-op's alone, so bash never spells them) and prints the population's `windowNotices` as their own WARN,
  with a `set-window` remedy. A `lanes` that refuses adds nothing: the catalogue rows above and the codex check name an
  unreadable lane, each with its own remedy. Like the other doctor rows that read JSON from a helper, it needs `jq`;
  without it the row says nothing about windows (the `jq` check names that box).

## Deviations found

- The task named the rule `default`. `contextWindowFor` answers `none` when the default rule yields no number (no
  key is written, so the client's own 200k default applies), which lowers the window the same way, so the WARN fires
  on any rule that is not `measured`; the sentence names the client's default in that case.
- The WARN reads the class's newest successful move of any kind, not only an automatic advance: a hand `set-class`
  to an unmeasured model lowers the window the same way, and the sentence says `set by hand` (or `a revert`).
- The field is named `cause`, not `reason`: a history entry's `reason` already holds a failed advance's free text.
- Failed advances record no `cause`: the canary-failed path records its failure before the candidate is re-checked.

## Still open (the operator's choice)

Options 1 and 2 of issue #2607 are not implemented: whether an advance to an unmeasured model should be held back,
or should carry the previous model's window across until the new one is measured. Both change what the lane runs
at, so both wait for an operator ruling.
