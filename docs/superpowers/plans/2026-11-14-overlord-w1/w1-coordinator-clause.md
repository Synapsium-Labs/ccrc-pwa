# Overlord W1: the Overlord clause of the coordinator skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the coordinator skill's contract gains the Overlord clause of spec §11.4, byte for byte, as its next free
number, 24. The pin suite holds it verbatim and counts 1 to 24 with no gap, the count word reads "twenty-four"
everywhere the tree states it, and the size ratchet passes with the cap raised by less than the clause's bytes and the
restore budget unchanged.

**Why:** it is the last W1 piece of the skills lane, and it lands before W2 opens (the W1 index, ruling F18). Its
clause tells every coordinator how to work under an Overlord: raise operator-bound items with their class, treat the
operator's attested words and the Overlord's own part differently, answer a relay, name the request, never copy
Overlord mail into public text, and state waves left as a range.

**Architecture:** no server, agent or PWA code. One clause line in `ccd/coordinator-skill/SKILL.md`, a shorter
compaction note above its contract to make room, the count word, the cap in `server/test/skill-size-caps.json`, the
pin in `server/test/coordinator-skill.test.ts`, and one count word each in `README.md` and `CLAUDE.md`.

**Tech Stack:** Markdown, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`:
- §11.4, "Clause 22, in W1 … In full": the clause's words. "22" is the spec's working number; the clause takes the
  next free number at merge.
- §11.3's paragraph on the size ratchet: a cap rises by a new clause's bytes and no more; the contract ends inside
  what a compaction keeps, with no raise.
- §7.5 ("The ladder needs `overlord-v1`") and §11.5 ("A capability word is a property of the build"): what "acts only
  while the server advertises `overlord-v1`" means.

**The index:** `docs/superpowers/plans/2026-11-14-overlord-w1.md`, question 2 and the row "The Overlord clause", lane
G, last.

## Open questions and rulings

1. **Where the room comes from** (slug `coord-clause-room-from-compaction-note`; **ruled**, programme call 997, big).
   - **The facts, measured at `main` `7e1f9752fe`** with `skill-size-ratchet.test.ts`'s own formula (bytes up to and
     including the newline before the next `## ` heading): the contract ends at 15,997 bytes of its 16,750-byte budget,
     753 bytes of room. The clause line, `24. ` and its newline included, is 904 bytes. The count word saves 1. The
     contract would end at 16,900, 150 bytes past the budget.
   - **Where the room went.** The contract ended at 13,668 before the autonomy clause (#3100), 15,004 after it, 15,639
     after the plan clause (#3119), 15,842 after the recall clause (#2919), and 15,997 after #3340 added a sentence to
     clause 15. Without that sentence the clause would have fitted with 5 bytes to spare.
   - **The ruling.** Neither a budget raise nor a shorter clause, and not the frontmatter description: the room comes
     from the prose between the title and `## The contract`. The five-line compaction note becomes the coordinator's
     target text, which keeps its two facts (a compaction keeps only the start, so the contract comes first; load the
     skill again if the later heading is missing) and drops the middle sentence that explains the mechanism. Every
     clause, the description and the sentence under the contract's heading stay byte for byte, except the count word.
     If the contract then ends past the budget, or with fewer than 10 bytes to spare, the build stops again.
   - **The result.** The note shrinks from 241 to 81 bytes (160 freed). The contract ends at 16,740: 10 bytes to spare,
     at the floor the ruling set. The budget and the cap rules are unchanged.
   - **On the record for later.** The next clause, the autonomy clause (W3, spec §11.4's working number 25, 347 bytes
     with its line prefix, against 10 to spare), will not fit without the operator's shortening or a budget decision. The text before the contract has no
     more prose to give that does not touch the cut notice or the description.
2. **"Acts only while the server advertises `overlord-v1`"** (slug `coord-clause-condition-held-by-the-build`;
   **ruled**, the same answer). The condition is carried by the build, never by text. §7.5 and §11.5 say the clause
   acts only while the capability file carries the word, and that after a rollback "everything takes today's path by
   itself". The doors the clause names refuse until their wave: `ccrc-api request ack` and the act read answer
   `capability-missing` naming `overlord-route-v1` (W2), and the raise and release doors ignore `operatorClass`, the
   effect and a release reason until W3's first step. Without a designated Overlord no `overlord` mail and no request
   exist. So nothing beyond the clause goes into the skill: no sentence in its notes, no reference edit, no pointer.
   - **The residual.** The clause's last sentence, waves left as a range at the plan and at every wave boundary, needs
     no door, so it binds from the release whatever the word says. It is harmless and stays unconditioned.
3. **The clause number** (slug `coordinator-clauses-by-name`, the index's question 2). `main` carries 23 clauses; the
   clause is built as 24. If another clause lands first, the later lander renumbers on a base the coordinator names.
4. **The skill revision word** (slug `coord-clause-revision-word-unchanged`; **for the coordinator**).
   `server/src/coord/skillRollout.ts`'s `COORDINATOR_SKILL_REVISION` reads `clause-21`, and its comment says a later
   contract change bumps it, which mails every running coordinator once. The plan clause (#3119) and the recall clause
   (#2919) changed the contract and left it. This piece follows them and leaves it: the brief says a merge changes no
   door, capability or setting, and a bump would send a rollout mail to every coordinator at the release.
   Recommendation: leave it; if the coordinator wants coordinators told, a bump to `clause-24` is one line and its
   test, in this PR or a follow-up.

## What exists today

- `ccd/coordinator-skill/SKILL.md`: 23 clauses under `## The contract`, "These twenty-three sentences", 24,879 bytes,
  capped at 25,030.
- `server/test/coordinator-skill.test.ts`: `CONTRACT`, 23 literals; `WORDS` up to `'twenty-three'`; the count test
  derives the word from `CONTRACT.length` and checks `SKILL.md`, `README.md` and `CLAUDE.md`; clause 17's test pins
  `toHaveLength(23)`.
- `server/test/skill-size-ratchet.test.ts`: R1 to R6, `CONTRACT_BUDGET_BYTES` 16,750 (operator item 326).
- `README.md` and `CLAUDE.md`: one "twenty-three" each beside the skill's path.

## Global Constraints

- The clause is spec §11.4's block quote byte for byte, joined into one line. No existing clause changes.
- The cap rises by at most the clause line's 904 bytes; R6's budget is not touched.
- `server/test/coordinator-skill.test.ts` and `README.md` are held by the landing programme's run 1850, `CLAUDE.md` by
  this programme's run 3299. Each gets one unified-diff packet against a full `main` sha, and the file stays untouched
  until its holder says yes.
- No door, capability word, setting or reference file changes. No skill is installed into any home by this piece.
- Tests run through `ccrc test`, one file at a time.

## Review Focus

- The clause line equals the spec's block quote, byte for byte, and the pin's literal equals both.
- The new compaction note keeps the cut notice R6 reads ("load this skill again") and the heading it names.
- The contract ends at 16,740; the cap is the file's size, 25,622, which is 592 above `main`'s, under the clause's 904.
- Every count word moved, and nothing else in the skill did.

## Task 1: the room, the clause and the cap

**Files:** `ccd/coordinator-skill/SKILL.md`, `server/test/skill-size-caps.json`.

- [x] Step 1: Measure the contract's end, the clause line and the count word at the base (question 1).
- [x] Step 2: Replace the compaction note with the ruled text.
- [x] Step 3: Change "twenty-three sentences" to "twenty-four sentences".
- [x] Step 4: Append the clause as line 24, copied from the spec's quote, not retyped.
- [x] Step 5: Set the cap to the file's size, 25,622.
- [x] Step 6: Run `skill-size-ratchet.test.ts`: green, with the contract at 16,740.
- [x] Step 7: Run `coordinator-skill.test.ts` before the pin moves: red on 1..N and on the count word.

## Task 2: the pin, the count words and the note

**Files:** `server/test/coordinator-skill.test.ts`, `README.md`, `CLAUDE.md` (each by its holder's packet),
`docs/superpowers/programs/overlord/w1-coordinator-clause.md`.

- [x] Step 1: Send each holder its packet; touch nothing until its yes.
- [x] Step 2: Apply the packets byte for byte: the literal, `'twenty-four'` in `WORDS`, the comment and test title,
  clause 17's `toHaveLength(24)`, and one count word each in `README.md` and `CLAUDE.md`.
- [x] Step 3: Run `coordinator-skill.test.ts`: green. Remove clause 24 from `SKILL.md`: red. Put it back.
- [x] Step 4: Run the other suites that read skill text (the worker, reviewer and overlord pins, the size ratchet, the
  single-definition files) once each.
- [x] Step 5: Write the task note with the measured bytes and every guard's red-on-removal.

**The PR ends here.**

## Deviations found

The coordinator mints the numbers.

- **D-TBD-coord-clause-room-from-compaction-note**: §11.4 says a clause past the room needs existing clauses shortened
  first. The room came instead from the compaction note above the contract (programme call 997).
- **D-TBD-coord-clause-index-shortening-not-needed**: the index's row says the clause lands "after the shortening
  (question 2)". Operator item 326 raised the budget instead, and this piece takes its last bytes from the note; no
  shortening pull request was made.
- **D-TBD-coord-clause-revision-word-unchanged**: `COORDINATOR_SKILL_REVISION`'s comment says a contract change bumps
  it; this piece leaves it, as #3119 and #2919 did (question 4).

## Where things stand

**Needs before it starts:** the recall clause, the autonomy clause and the plan clause, all on `main`.

**What depends on it:** W2 opens after it lands (ruling F18).

**What a merge arms:** every coordinator's contract gains one clause at the next release. No door, capability word or
setting changes.

**Open questions for the coordinator:** question 4.

**Waiting on the operator:** nothing. The next coordinator clause will need their shortening or a budget decision.
