# Overlord W1a: coordinator clause 23, the recall clause (numbered 21 at its merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the coordinator skill gains the recall clause, pinned verbatim, in the one pull request that also raises the
skill's size cap by the clause's bytes and no more. It merges only after the replay baseline is taken, because it
changes what a coordinator recalls, and a baseline taken after it would measure the clause, not today's recall (ruling 1
of this programme's fix round; W0-28's "before any other part of W1a is armed").

**Why:** recall is barely used (7 of 368 session families in a week, Table 3.3.9b). After a compaction or a renewal a
coordinator acts on what it recalls, and a summary of a summary is where an id or a ruling's words go wrong (§3.3,
C52). The clause sends it to `ccrc history` or the server before it acts, and to its notes before it stops.

**Architecture:** one line in `ccd/coordinator-skill/SKILL.md`'s contract, one literal in the pin suite's contract
array, one cap raise in `server/test/skill-size-caps.json`, and the count word changed where the tree states it. One
pull request.

**Tech Stack:** Markdown, TypeScript (vitest).

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §11.4 (clause 23, in W1a, ahead of clause 22; clause
numbers are taken at merge in landing order, because the pin test requires 1 to N with no gaps; the recall clause lands
first and takes the next free number; a pull request that adds a clause may raise the file's cap by that clause's bytes
and no more; the count word's bytes are offset inside the same file), §3.3.9 (C52), §3.3.3 (the ratchet).

**The clause, verbatim (§11.4):** "After a compaction or a renewal, check what you recall against `ccrc history` or the
server before you act on it. Keep your notes current: what each open thread waits for and what you intend next."

## What exists today

- `ccd/coordinator-skill/SKILL.md` has twenty numbered clauses; its prose says "These twenty sentences are the
  boundary …".
- `server/test/coordinator-skill.test.ts` pins them: a `CONTRACT` array of verbatim sentences, each asserted present;
  the numbered set is exactly 1 to N with no gaps; the count word "twenty" is pinned.
- `server/test/skill-size-ratchet.test.ts` with `server/test/skill-size-caps.json` (`{"files": {"<path>": bytes}}`;
  the coordinator's cap is 23,580 at the branch point). R4: a cap the merge base holds may rise by at most the clause
  allowance, the UTF-8 bytes of each whole numbered line past the merge base's highest clause in `## The contract`,
  number and newline included. R5: the file's growth, likewise. R6: the contract ends within `CONTRACT_BUDGET_BYTES`
  (16,000), with no raise.
- `CLAUDE.md` says the coordinator skill's "twenty clauses are pinned VERBATIM by
  `server/test/coordinator-skill.test.ts`"; `README.md` says the same in its coordinator paragraph.
- The notes door and `ccrc-api note` (the notes piece): the clause's second sentence names the act they serve.

## Global Constraints

- **The skill's editing rules** (the skill's own editing note, D-104): straight apostrophes only; no double-quote
  characters inside a clause. The clause above has neither.
- **Architecture (`CLAUDE.md`).** The skill text and its pin change in the same commit; the cap rises by exactly the
  clause line's bytes; the count word's extra bytes are offset inside `SKILL.md` (shorten one sentence outside the
  contract by at least as many bytes, without changing its meaning). A guard ships with a test that goes red without
  it: the pin is that test.
- **SAFETY (`CLAUDE.md`).** No code changes. The skill reaches homes only through `ccrc update`'s install spine.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`, then
  `test/skill-size-ratchet.test.ts` (after `git fetch origin main`), `test/docs-parity.test.ts` and
  `test/readme-*.test.ts` that pin the README's counts (measure: `grep -rln 'twenty' server/test`).
- **Number at merge.** If another clause lands first, this one takes the next free number and the plan's "21" moves
  with it; the clause's text does not change.
- No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-clause-23/departures.md`.

## Review Focus

1. The clause is byte-identical to §11.4's text, with straight apostrophes.
2. The cap rose by the clause line's bytes exactly; the file grew by no more.
3. The contract still ends within 16,000 bytes (R6).

---

### Task 1: The clause, its pin, its cap

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (clause 21, after clause 20; "twenty" → "twenty-one" in the prose; one
  sentence outside the contract shortened by at least four bytes)
- Modify: `server/test/coordinator-skill.test.ts` (`CONTRACT` gains the sentence; the count word pin reads
  "twenty-one")
- Modify: `server/test/skill-size-caps.json` (the coordinator's cap rises by the new line's UTF-8 bytes, newline
  included)
- Modify: `CLAUDE.md` ("its twenty clauses" → "its twenty-one clauses"), `README.md` (the coordinator paragraph's count)

- [ ] **Step 1: Failing test.** Add the sentence to `CONTRACT` and the count word pin. Run
  `test/coordinator-skill.test.ts`. Expected: red (the skill lacks the clause).
- [ ] **Step 2: Implement** the clause and the count word; measure the line's bytes
  (`grep -n '^21\. ' ccd/coordinator-skill/SKILL.md | cut -d: -f2- | wc -c` plus the newline) and raise the cap by that
  number; shorten one sentence outside the contract to offset the count word's bytes.
- [ ] **Step 3: Run** the pin suite, the ratchet (after `git fetch origin main`), and the README and docs suites.
  Expected: green.
- [ ] **Step 4: Mutation (measured once).** Raise the cap by one byte more: the ratchet's R4 goes red. Revert.
- [ ] **Step 5: Commit.** `feat(coordinator-skill): clause 21, the recall clause (Overlord spec §11.4's clause 23)`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **recall-clause-is-21** — the spec's working name is clause 23; it lands as 21, the next free number (§11.4).
- **recall-clause-after-the-baseline** — the clause merges after the replay quiz's baseline row exists, because a skill
  clause reaches every coordinator at its next install and would contaminate the baseline; the merge arms it, so it
  is ordered rather than switched.

## Where things stand

**Needs before it starts:** the notes piece (the clause's second sentence names an act its door serves), and the
replay baseline taken: a baseline row in `continuity_quiz_runs` (the replay-quiz piece), measured on the server before
the pull request is enqueued and named in its description. The plan may be built and reviewed before that; it does not
merge until then. The ratchet
(#2565) has merged, so this is the first pull request to use the one allowed raise (the carried constraint).

**What depends on it:** W1's clause 22 (the Overlord clause) and W4b's clause 24 take the next numbers after it.

**Open questions for the operator:** none.
