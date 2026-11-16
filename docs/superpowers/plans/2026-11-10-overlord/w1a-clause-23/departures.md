# W1a clause 23 (the recall clause): departures and measurements

Task notes for `docs/superpowers/plans/2026-11-10-overlord/w1a-clause-23.md`, Task 1. The coordinator folds them into
the programme ledger.

## Measured

- **The clause number.** `main` carried twenty numbered clauses in `ccd/coordinator-skill/SKILL.md` at the branch
  point, so the recall clause is clause 21, as the plan expected (slug `recall-clause-is-21`).
- **The clause line.** 201 UTF-8 bytes, number and newline included. The coordinator's cap in
  `server/test/skill-size-caps.json` rose from 23,580 to 23,781, exactly that.
- **The count word.** "twenty" to "twenty-one" adds 4 bytes inside `SKILL.md`. They are offset in the same file by
  "stood in this file once, and some references still" becoming "stood in this file once; some references still"
  (4 bytes, outside the contract, same meaning). The file is 23,781 bytes, at its cap.
- **The contract's end.** 13,865 bytes from the file's start, inside the 16,750-byte budget (R6).

## Departures

- **budget-raised-by-item-326** — the plan's Global Constraints say R6's budget is 16,000 bytes, with no raise. Operator
  item 326 raised it to 16,750 before this build (the brief's ruling). The clause fits either budget.
- **count-word-regex-widened** — the pin's count word harvest matched `[a-z]+` before a noun, so "twenty-one
  sentences" would have been read as "one". The harvest in `server/test/coordinator-skill.test.ts` now accepts one
  hyphenated number word, and `WORDS` gains "twenty-one". The plan named only the count word pin.
- **door-cited-outside-the-clause** — the brief asks that the note door be cited by name; the plan pins the clause
  byte-identical to the spec's §11.4 text, which names the act (keep your notes current), not the door. The clause stays
  as the plan writes it, and the door (`POST /api/sessions/:id/notes`, `ccrc-api note add`) is cited here and in the
  pull request's description. The pin's literal carries no comment of its own: the test file is another run's claim,
  and its holder granted the literal alone.
- **merge-gate-at-landing** — the replay baseline row in `continuity_quiz_runs` cannot be read from the fleet box. The
  pull request says the baseline must be measured before it is enqueued; that gate is the coordinator's, at landing.
- **pin-test-scoped-by-its-holder** — `server/test/coordinator-skill.test.ts` and `README.md` are claimed by another
  run, whose holder granted only: the one literal, `'twenty-one'` in `WORDS`, the two count regexes widened, and the
  README's one count word. The stale "twenty" in the test's comment and title (lines 116 and 166) and the
  `toHaveLength(20)` in clause 17's test (line 655, which the new literal reds) were asked for; this branch changes them
  only once that holder grants them.
