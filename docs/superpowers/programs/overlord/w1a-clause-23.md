# W1a clause 23 (the recall clause): departures and measurements

Task notes for `docs/superpowers/plans/2026-11-10-overlord/w1a-clause-23.md`, Task 1. The coordinator folds them into
the programme ledger.

## Measured

- **The clause number.** `main` carried twenty numbered clauses at the branch point, so the recall clause was built
  as clause 21. While the pull request waited for the replay baseline, two clauses landed first: 21 (deciding by
  default) and 22 (the plan clause). The branch absorbed `main` at `e9cc3120f6`, and the recall clause takes the next
  free number, 23, which is also the spec's own number for it (slug `recall-clause-is-21`; the plan's Global
  Constraints say the number moves at merge and the text does not). The text is unchanged.
- **The clause line.** 201 UTF-8 bytes, number and newline included ("23. " is as long as "21. "). The coordinator's
  cap in `server/test/skill-size-caps.json` rose from 24,829 on `main` to 25,030, exactly that. No other entry
  changed.
- **The count word.** "twenty-two" to "twenty-three" adds 2 bytes inside `SKILL.md`. They are offset in the same file:
  "with every call and every refusal" becomes "with each call and each refusal" in the `wave-lifecycle.md` bullet
  (2 bytes, outside the contract, same meaning). The first build's 4-byte offset, "once, and some references" to
  "once; some references", is dropped with the absorb, and that sentence reads as on `main`. The file is 25,030
  bytes, at its cap, and it grew by exactly the clause line.
- **The contract's end.** 15,842 bytes from the file's start, inside the 16,750-byte budget (R6).
- **The resolution.** The five conflicting files (`SKILL.md`, the caps file, the pin, `CLAUDE.md`, `README.md`)
  were resolved to a packet measured against `e9cc3120f6`. Before the branch was touched, the holders of the claimed
  files consented to their hunks. A cap one byte higher (25,031) reds R4.

## Departures

- **budget-raised-by-item-326** — the plan's Global Constraints say R6's budget is 16,000 bytes, with no raise. Operator
  item 326 raised it to 16,750 before this build (the brief's ruling). The clause fits either budget.
- **count-word-regex-widened** — the pin's count word harvest matched `[a-z]+` before a noun, so "twenty-one
  sentences" would have been read as "one". The first build widened both harvests in
  `server/test/coordinator-skill.test.ts` to accept one hyphenated number word. Another run's clause landed the same
  widening on `main` first, so the absorb keeps `main`'s regexes unchanged, and `WORDS` gains "twenty-three". The plan
  named only the count word pin.
- **door-cited-outside-the-clause** — the brief asks that the note door be cited by name; the plan pins the clause
  byte-identical to the spec's §11.4 text, which names the act (keep your notes current), not the door. The clause stays
  as the plan writes it, and the door (`POST /api/sessions/:id/notes`, `ccrc-api note add`) is cited here and in the
  pull request's description. The pin's literal carries no comment of its own: the test file is another run's claim,
  and its holder granted the literal alone.
- **merge-gate-at-landing** — the replay baseline row in `continuity_quiz_runs` cannot be read from the fleet box. The
  pull request says the baseline must be measured before it is enqueued; that gate is the coordinator's, at landing.
- **pin-test-scoped-by-its-holder** — `server/test/coordinator-skill.test.ts` and `README.md` are claimed by another
  run, `CLAUDE.md` by a third. Each holder consented to exactly its hunks against `e9cc3120f6`:
  - the pin: the one literal, with no comment of its own; `'twenty-three'` in `WORDS`; "twenty-two" to "twenty-three"
    in the comment above `CONTRACT` and in the verbatim test's title; and `toHaveLength(22)` to 23 in clause 17's
    test, which the new literal reds;
  - `README.md` and `CLAUDE.md`: one count word each.

  Other comments that quote an older count ("carries all twenty") describe the mechanism and stay as they are.
