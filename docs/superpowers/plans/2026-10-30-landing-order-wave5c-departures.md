# Landing order wave 5c: five departures from its plan, recorded

- **D-7600 (2026-10-31)** — `sh-trims-newline` (Task 1): `h.sh` trims stdout, so the line pins in
  `server/test/ccd-pr-state.test.ts` compare bytes and key order but not the single trailing newline. The plan's
  verbatim `lineOf` could not pass (review 1304, F8).
- **D-7601 (2026-10-31)** — `form18-prediction` (Task 1): the plan's mutation row 5C-FORM-18 predicts its red in the
  `pr-state` and `ws-reap` suites. Review 1304 measured it wider than the wave-done stated, and the `ws-reap` half
  wrong.
- **D-7602 (2026-10-31)** — `die-containment-census` (Task 1): `server/test/ccd-die-containment.test.ts`, a file the
  plan does not name, gained one entry and its reason.
- **D-7603 (2026-10-31)** — `rules-read-equivalence-edge` (Task 3, review 1304, F6): D-7598's "behaviour-preserving"
  is exact except at one edge of the landing-rules reader.
- **D-7604 (2026-10-31)** — `base-grammar-three-copies` (Task 1, review 1304, minor 8): the base-name grammar is
  spelled three times, and the three copies are legitimately different.

**D-7600.** `h.sh` ends in `.trim()`, so a test that reads the form's stdout through it never sees the newline that
ends the line, or a blank line before it. The suite pins the line's bytes and key order. It does not pin "one line"
at byte level, and the words pin's `printedLine` filters empty lines and the reader ignores blank ones. The plan's
verbatim `lineOf` ended the expected line with a newline and could not have passed. The shipped helper builds the line
without it, to match the trimmed text. Carried to sub-wave 5h, the form's first reader: a byte-level pin of one line.

**D-7601.** Row 5C-FORM-18 breaks the `train_flags` move out of `annotate`. Review 1304 measured it:
- it is red in `ccd-pr-state` (10 cases) and in `ccd-pr-landing` (1 case);
- it is green in both `ccd-ws-reap` and `ccd-ws-audit`;
- so Review Focus 3's characterization of the `train_flags` move holds through `ccd-pr-state` and `ccd-pr-landing`
  only, because audit and reap do not tell a refused claim from an unread one (F9).

**D-7602.** `ccd-die-containment`'s census lists every function of `ccd/ccd` that dies, and `_pr_state_by_pr` is a new
one (it dies on a bad project or a bad number, before any `gh` call). The census was red at the wave's first fast run,
and the file gained one entry and its reason. Review 1304 confirmed the case is red at the base's `ccd` and green at
the tip, and that the edit is that one entry.

**D-7603.** D-7598 moved `doc(fd)` onto the new `docs(fd)` and said the move changes nothing for the `rows` and
`names-protection` modes. Review 1304 measured an edge:
- the paged reader skips only space, tab, CR and LF, where the old read stripped all whitespace;
- so a rules body with a leading form feed or a trailing non-breaking space, which read rc 0 before, now reads rc 1.

This fails closed, and `gh` does not send such bodies. No code changes for it.

**D-7604.** The base-name grammar of D-7595 (b) is spelled three times: the python `base_ok` in `_pr_py`, and bash's
`_ws_train_keyable` and `_pr_landing_rules`. They are legitimately different copies, because they run in different
processes and languages. The python writer of the line runs in its own interpreter, and calling the bash helper for each
row would add a process and a second GitHub-sourced string to an argv. The three spellings are identical today. A later
change to one must change all three.

The plan is not edited, because merged plans are append-only. This file is the record, and the programme ledger folds
it in.
