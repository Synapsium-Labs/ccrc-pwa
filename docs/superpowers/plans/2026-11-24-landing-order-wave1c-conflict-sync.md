# Landing order, wave 1c — the conflict-sync trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, as the dispatch specifies. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: the operator ruled the outcome on 2026-11-24 (item 641): "Yes, and change the rule so a coordinator can allow this itself from now on".** The wording below is the coordinator's. No implementation exists yet.

**Goal:** Worker clause 16 gains a fourth trigger, the coordinator's conflict-sync mail, so that a worker whose pull request has used its one absorption and conflicts with `main` again can be told to merge one named commit without the operator.

**Why:**
- Wave 5i's pull request sat for eight days because of this gap. It had used the one absorption triggers 1 and 2 give a pull request. `main` moved, the branch conflicted in three files, and its checks could not run. The worker held on clause 16 as written, and it was right to.
- Coordinator clause 15 already lets a coordinator send "any other conflict-sync request only on a conflict it has measured". No worker trigger answered such a request, so the request licensed nothing.

**Architecture:** Skill text, the session hook's advisory sentence, one README paragraph and their pins. No server, agent or PWA source changes. No clause is added or removed in either skill, and the coordinator skill's contract text does not change.

**Tech Stack:** Markdown, bash (`ccd/session-hook.sh`), vitest pins under `server/test/`.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.1 (trigger 4, its bound, coordinator clause 15's paragraph and the hook paragraph) and §11 item 23. The spec text is already amended on the coordinator's ledger PR; this plan implements it.

**Prerequisite:** this plan and the spec amendment are on `main`.

**Files (the whole wave):**
- Modify: `ccd/worker-skill/SKILL.md` (clause 16 only)
- Modify: `server/test/worker-skill.test.ts` (clause 16's verbatim pin, and one new case)
- Modify: `ccd/session-hook.sh` (the landing-order advisory: its comment and its `lreason` lines)
- Modify: `server/test/session-hook-sync-advisory.test.ts`
- Modify: `ccd/coordinator-skill/references/wave-lifecycle-run-care.md` (one new section)
- Modify: `README.md` (the paragraph that opens `**Landing order (landing-order wave 1).**`)
- Create: `server/test/conflict-sync-text.test.ts`

## What this does not claim

- **It changes no installed skill by merging.** A skill reaches a home through the updater. Until every home runs the release that carries this wave, a worker's installed clause is the old one, and a further merge there still needs the operator's word (spec §11 item 23).
- **It does not loosen the first two triggers.** They still license one absorption per pull request.
- **It gives a coordinator no way to merge.** The worker still absorbs, with `git merge` only, and the pull request's checks and its review gate the result.

## Global Constraints

- **The subject word is `conflict-sync:`** in every file, spelled the same: lower case, one hyphen, a trailing colon.
- **The mail's form (D-9013).** Subject `conflict-sync: #<pr>`. The body holds two entries, one to a line, and nothing else: `base: <40-hex sha>`, then `paths: <the conflicted paths, space-separated>`.
- **The bound (D-9012).** One absorption of exactly the named commit per mail. It applies to a worker at `working` before its wave-done. The worker's own probe of the named commit must exit 1 with a tree id on its first line; exit 0 or any other answer licenses nothing, and the worker replies with what it measured.
- **No clause is added or removed.** `CONTRACT` keeps twenty entries in `worker-skill.test.ts`, and the coordinator skill's `CONTRACT` is untouched. The clause-count words in README and CLAUDE.md do not change.
- **Pins move with their text,** in the commit that changes the text.
- **No new skill sentence holds a double quote.**
- **Never write a destructive verb in new text.** `update-branch` is named only where clause 16 already forbids it; the count test in `worker-skill.test.ts` (`names update-branch ONLY inside clause 16`) stays green with the same count.
- **Neutral names only.** The repository is public.
- **Files other sessions hold.** Read `GET /api/claims?project=ccrc-pwa` before each task. `README.md` is held by landing-order run 1850: send its coordinator (this programme's coordinator) the README hunk as a packet before the edit. `ccd/session-hook.sh` had a live claim by another programme's worker when this plan was written: send that holder the hunk as a packet first. Each packet is a unified diff against a named `main` commit, inline, with its size and sha256; the file stays untouched until the answer.
- **The generated region of `ccd/session-hook.sh` is not edited.** The advisory lies outside it. If `hook-helpers-generated` reads red, the edit strayed.
- **Tests.** Every test runs from `server/` as `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>`, in the foreground, with a timeout of at least 600000 ms. Fixture HOMEs only; never `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
- **Deviation numbers are issued, never chosen.** This plan defines D-9011 to D-9013, the first three of the six numbers (9011 to 9016) issued on 2026-11-24. A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Push once, when the build is complete, with code, tests and notes together.

## Review Focus

1. **A conflict-sync mail that names a commit the branch does not conflict with licenses nothing.** The clause says the worker's own probe must exit 1 with a tree id; the new worker case pins that sentence, and mutation 1C-02 removes it.
2. **A newer `main` is not the named commit.** The clause says exactly the named commit; the hook advisory and the README say the same. Pinned by Task 4's cross-file case.
3. **After a wave-done the fourth trigger does not apply.** The clause says before your wave-done only, so trigger 3's edge stays the only route from `merging`. Pinned in Task 1.
4. **The first two triggers' one-per-pull-request bound survives word for word.** Task 1's pin keeps the sentence; mutation 1C-03 deletes the fourth trigger's bound and must not turn the old bound's assertions green by accident.
5. **The advisory still never denies.** `session-hook-sync-advisory.test.ts`'s existing cases (silent for a non-Bash tool, state still written, no dependence on the graph gate) stay green unchanged.

---

### Task 1: worker clause 16 and its pin

**Files:**
- Modify: `ccd/worker-skill/SKILL.md` (clause 16, its first two sentences)
- Test: `server/test/worker-skill.test.ts`

**Interfaces:**
- Produces: the subject word `conflict-sync:` and the two sentences below, which Tasks 2 to 4 quote.

- [ ] **Step 1: Write the failing pin.** In `CONTRACT`, replace clause 16's first two sentences with the text below, and leave every later sentence of the entry as it is.

```text
Absorb `origin/main` into this branch only on one of four triggers, each read after one `git fetch origin`: your own probe `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` exits 1 with a tree id on its first line (the branch conflicts; exit 0 is clean, and any other answer is unmeasured and licenses nothing); a required check on your PR is red while main passes the same tests, measured by re-running its failing test files on a clean checkout of `origin/HEAD` in scratch; a `fix-round` mail from the coordinator names this PR ejected from the landing line with a base sha, or next to land in a strict-protection repository; or a mail from the coordinator whose subject begins `conflict-sync:` names this PR and a base sha for a conflict it measured, and your own probe of that commit, `git merge-tree --write-tree --name-only --no-messages HEAD <base>`, exits 1 with a tree id on its first line. The first two license at most one absorption per PR — a second occurrence before the first absorption lands is not a second license — the third arrives on the `merging → working` edge, after which you absorb, re-gate and send a fresh `wave-done`, and the fourth licenses one absorption of exactly the named commit per mail, before your wave-done only: when your probe of it answers clean or unmeasured, absorb nothing and reply with what you measured.
```

- [ ] **Step 2: Add one case** to `worker-skill.test.ts`, beside `clause 16 names the probe …`:

```ts
it('clause 16 has a fourth trigger, the coordinator conflict-sync mail, bounded to one named commit per mail (D-9011, D-9012)', () => {
  const c16 = CONTRACT[15];
  expect(c16).toContain('only on one of four triggers');
  expect(c16).toContain('a mail from the coordinator whose subject begins `conflict-sync:` names this PR and a base sha for a conflict it measured');
  expect(c16).toContain('`git merge-tree --write-tree --name-only --no-messages HEAD <base>`, exits 1 with a tree id on its first line');
  expect(c16).toContain('the fourth licenses one absorption of exactly the named commit per mail, before your wave-done only');
  expect(c16).toContain('when your probe of it answers clean or unmeasured, absorb nothing and reply with what you measured');
  expect(c16).toContain('The first two license at most one absorption per PR — a second occurrence before the first absorption lands is not a second license');
  expect(c16).not.toContain('one of three triggers');
});
```

- [ ] **Step 3: Run it to see it fail.** Run `test/worker-skill.test.ts`. Expected: `carries all twenty clauses verbatim` and the new case are red; nothing else is.

- [ ] **Step 4: Change `ccd/worker-skill/SKILL.md` clause 16** to the same two sentences. Where `clause 16 names the probe with both halves of its conflict answer …` counts occurrences of the probe or of `exits 1`, move its expected count to what the new text holds and say why in the assertion message.

- [ ] **Step 5: Run it to see it pass.** Run `test/worker-skill.test.ts`. Expected: green, with `names update-branch ONLY inside clause 16` unchanged.

- [ ] **Step 6: Commit.** `feat(landing-order): worker clause 16's fourth trigger, the conflict-sync mail (wave 1c)`

### Task 2: the session hook's advisory

**Files:**
- Modify: `ccd/session-hook.sh` (the block under `THE LANDING-ORDER ADVISORY`)
- Test: `server/test/session-hook-sync-advisory.test.ts`

**Interfaces:**
- Consumes: Task 1's subject word and bound.

- [ ] **Step 1: Write the failing assertions.** In the case that reads the advisory's text, and in the graph-gate case, replace `'three triggers'` with `'four triggers'`, and add to the first:

```ts
expect(text).toContain('(4) the coordinator');
expect(text).toContain('`conflict-sync:`');
expect(text).toContain('exactly that commit');
```

- [ ] **Step 2: Run it to see it fail.** Run `test/session-hook-sync-advisory.test.ts`. Expected: those two cases red.

- [ ] **Step 3: Change the advisory.** `one of three triggers:` becomes `one of four triggers:`. After the `(3)` line add one `lreason+=` line whose text is: ` (4) the coordinator's mail whose subject begins \`conflict-sync:\` names this PR and a base sha for a conflict it measured, and your own probe of that commit agrees: absorb exactly that commit, once per mail, before your wave-done only.` The block's header comment says `the four triggers`. The file's own top-of-file line that says `three triggers and the probe command` in the test's header comment moves too.

- [ ] **Step 4: Run it to see it pass.** Run `test/session-hook-sync-advisory.test.ts`, then `test/session-hook-mail-hold.test.ts` and `test/hook-helpers-generated.test.ts`. Expected: green.

- [ ] **Step 5: Commit.** `feat(landing-order): the sync advisory names the fourth trigger (wave 1c)`

### Task 3: the coordinator's reference and the README

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle-run-care.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1's subject word, bound and probe; the mail's form from Global Constraints.

- [ ] **Step 1: Add a section to `wave-lifecycle-run-care.md`,** titled `## A conflict mid-round: the conflict-sync mail`, wrapped at 80 columns, that says exactly these things and nothing that contradicts clause 15:
  - **When.** A worker at `working`, before its wave-done, whose branch conflicts with `main` and whose pull request has used the one absorption its own two triggers give it. Never after a wave-done: from `merging` the route is the ejection of step 6.
  - **Measure first.** After one `git fetch origin`: `git merge-tree --write-tree --name-only --no-messages <the branch tip> origin/main` exits 1 with a tree id on its first line, then the conflicted paths. Exit 0, or any other answer, sends nothing.
  - **The mail.** `"$API" mail send --json -` to the worker with the run's `runId`, `kind` `status`, subject `conflict-sync: #<pr>`, and a body of two entries, one to a line: `base: <sha>`, the `origin/main` sha just read, copied from the output of `git rev-parse origin/main` in that same call and never typed (corrected 2026-11-25: the probe itself prints a tree id and the paths, never the commit; review run 3727 found it), then `paths: <the conflicted paths>`.
  - **One mail per measured conflict,** recorded with `ccrc-api calls record` as a routine call that names the base.
  - **What it does not do.** It waives no check and no review. The worker's wave-done still gets its review run, and the landing still binds the reviewed head.

- [ ] **Step 2: Change the README paragraph.** `Worker clause 16 names three, each read after one` becomes `Worker clause 16 names four, each read after one`. The sentence that ends `or next to land in a strict-protection repository.` gains the fourth: `…; or a \`conflict-sync:\` mail from the coordinator names the PR and a base commit for a conflict the coordinator measured, and the worker's own probe of that commit agrees.` After `The first two license at most one absorption per PR.` add: `The fourth licenses one absorption of exactly the named commit per mail, before the worker's wave-done only.` Send the coordinator this hunk as a packet first (Global Constraints).

- [ ] **Step 3: Run the readers.** Run `test/coordinator-skill.test.ts`, `test/docs-parity.test.ts`, `test/citations.test.ts`, `test/anchors.test.ts` and `test/topology-clean.test.ts`, and every suite `git grep -l "wave-lifecycle-run-care" server/test` names. Expected: green with no pin moved in `coordinator-skill.test.ts`. If a pin in a file another session holds must move, stop and send that holder a packet.

- [ ] **Step 4: Commit.** `docs(landing-order): the conflict-sync mail in the coordinator's run care and the README (wave 1c)`

### Task 4: one spelling in four files, and the gate

**Files:**
- Create: `server/test/conflict-sync-text.test.ts`

**Interfaces:**
- Consumes: the four texts of Tasks 1 to 3.

- [ ] **Step 1: Write the test.** It reads `ccd/worker-skill/SKILL.md`, `ccd/session-hook.sh`, `ccd/coordinator-skill/references/wave-lifecycle-run-care.md` and `README.md` as text from the repository root (the way `worker-skill.test.ts` resolves the skill file) and holds three cases:

```ts
it('spells the subject word the same in the worker clause, the hook advisory, the coordinator reference and the README', () => {
  for (const [name, text] of files) expect(text, name).toContain('`conflict-sync:`');
  for (const [name, text] of files) expect(text, name).not.toMatch(/conflict[ _]sync:|Conflict-sync:|conflictsync/);
});
it('bounds the fourth trigger to the named commit in every file that states it', () => {
  expect(worker).toContain('one absorption of exactly the named commit per mail');
  expect(hook).toContain('absorb exactly that commit, once per mail');
  expect(readme).toContain('one absorption of exactly the named commit per mail');
  expect(runCare).toMatch(/One mail per measured conflict/);
});
it('gives the mail the same two body entries where its form is stated', () => {
  expect(runCare).toContain('`base: <sha>`');
  expect(runCare).toContain('`paths: <the conflicted paths>`');
});
```

- [ ] **Step 2: Run it.** Expected: green. Then the mutation table, each row measured red and restored from a saved copy with its sha256 checked:

| id | Mutation | Predicted red |
|---|---|---|
| 1C-01 | clause 16 goes back to `one of three triggers` and drops the fourth trigger's clause | `carries all twenty clauses verbatim`, the new worker case, and `conflict-sync-text`'s first case |
| 1C-02 | the worker clause drops `, and your own probe of that commit, … exits 1 with a tree id on its first line` | `carries all twenty clauses verbatim` and the new worker case's third assertion |
| 1C-03 | the worker clause drops `, and the fourth licenses one absorption of exactly the named commit per mail, before your wave-done only: …` | the new worker case, and `conflict-sync-text`'s second case |
| 1C-04 | the hook advisory drops its `(4)` line | `session-hook-sync-advisory`'s first case, and `conflict-sync-text`'s first and second cases |
| 1C-05 | the README says `Conflict-sync:` | `conflict-sync-text`'s first case |

- [ ] **Step 3: The suites that read the changed files.** One file per process. Expected: green.
  - **Touched:** `worker-skill`, `session-hook-sync-advisory`, `conflict-sync-text`.
  - **Readers of the worker skill and the hook:** `install-worker-skill`, `session-hook-mail-hold`, `session-hook-merge-deny`, `session-hook-role-skill-deny`, `hook-helpers-generated`, `update-branch-absent`, `skillstate`, `install-census`, and every `session-hook*` suite `git grep -l "landing advisory" server/test` names.
  - **Guards:** `citations`, `anchors`, `docs-parity`, `topology-clean`, `typecheck-tests`, `deviation-refs` (after `git fetch origin main`), and `single-definition/` whole.
  - `session-hook` and `typecheck-tests` are known load flakes: re-run one alone before calling it a break.

- [ ] **Step 4: Commit, push once, wave-done.** `test(landing-order): one spelling of the conflict-sync mail in four files (wave 1c)`

## Deviations found

The coordinator issued six numbers, 9011 to 9016, on 2026-11-24 and defines the first three here. They follow the operator's ruling on item 641; they are approved design, not as-built evidence. A worker reports execution departures by slug; the coordinator numbers and records them.

- **D-9011 (2026-11-24)** — `conflict-sync-trigger`: worker clause 16 gains a fourth trigger, a coordinator mail whose subject begins `conflict-sync:` and names the pull request and one base sha. The spec's §5.1 said three triggers; the operator ruled the change on 2026-11-24 (§11 item 23). Not yet implemented.
- **D-9012 (2026-11-24)** — `conflict-sync-bound`: the fourth trigger licenses one absorption of exactly the named commit per mail, before the worker's wave-done only, and only when the worker's own probe of that commit exits 1 with a tree id. A clean or unmeasured probe licenses nothing. The first two triggers keep their one absorption per pull request. Not yet implemented.
- **D-9013 (2026-11-24)** — `conflict-sync-mail-form`: the mail's subject is `conflict-sync: #<pr>` and its body is two entries, `base:` and `paths:`. Coordinator clause 15 is not reworded: its sentence on a conflict-sync request on a measured conflict already covers the send, so the coordinator skill's contract pin does not move, and the procedure lives in the run-care reference. Not yet implemented.

**As built.** The wave merged on 2026-11-25 as #3357 (merge commit `6ac066f5`), after three review rounds, and D-9011 to D-9013 are implemented. The coordinator issued eight more numbers, 9057 to 9064, on 2026-11-25 for the departures the worker reported by slug in its notes (`docs/superpowers/programs/landing-order/wave1c-*.md`). Each was read by a review run and accepted.

- **D-9057 (2026-11-25)** — `c16-case-reads-skill-line`: Task 1's new case checks each assertion against the pinned clause and against the skill file's own `16. ` line. The plan's snippet read the pin alone, which turned green as soon as the pin changed and before the skill did, so a mutation of the skill's text would never have turned it red.
- **D-9058 (2026-11-25)** — `conflict-sync-text-flatten`: `conflict-sync-text.test.ts` flattens each file's whitespace to single spaces before it matches. The README and the reference wrap their prose, and the README's bound crosses a line break, so a raw match could never hold.
- **D-9059 (2026-11-25)** — `conflict-sync-text-hook-escape`: the hook writes the subject word inside a double-quoted shell string with escaped backticks, so the suite's first case unescapes them before it looks for the word. The printed advisory carries the word bare, which `session-hook-sync-advisory.test.ts` holds.
- **D-9060 (2026-11-25)** — `conflict-sync-text-no-diff`: the suite's checks are boolean, with a short message that names the file and the phrase, never a containment matcher on the whole file. Measured: a containment miss made the runner diff the flattened README and the run went past ten minutes before it printed.
- **D-9061 (2026-11-25)** — `worker-skill-size-trim`: clause 16's new text grew the worker skill past what the skill-size ratchet allows without a new pinned clause, and the worker skill may carry no `references/` directory. The clause 2 note under "Notes on the contract" was removed and the clause 5 note cut to one sentence that keeps its reason. No clause changed and no test pinned either note; the file stands at its size on `main` before the wave, and the caps file is untouched.
- **D-9062 (2026-11-25)** — `run-care-base-from-rev-parse`: the run-care reference's measure step runs `git rev-parse origin/main` in the same call as the probe, and the mail's `base:` is copied from that line. The plan's snippet said "from the command's output", but the probe prints a tree id and the conflicted paths, never a commit. Task 3's text was corrected on 2026-11-25 (#3363). Residual, recorded at acceptance: the block's exit status is the rev-parse line's, not the probe's, so the sender reads the output's shape.
- **D-9063 (2026-11-25)** — `clause5-note-trim-8`: the last fix round's words, "this round's", grew clause 16 by 8 bytes, so the clause 5 note says `prose in your pane` where it said `prose typed into your pane`. A note, never a clause; no test pins the phrase.
- **D-9064 (2026-11-25)** — `run-care-index-and-heading`: two edits outside this plan's file list. The index row of `ccd/coordinator-skill/references/wave-lifecycle.md` and the first heading of the run-care reference each name the new section, "a conflict mid-round", so the reference can be found from its index.

Also as built, without a number: the bound reads "before this round's wave-done only" in the clause and the hook, where this plan's text said "before your wave-done only" (the coordinator's ruling in the last fix round: a worker in a fix round has sent a wave-done before, and the mail must still license its absorption there). The spec's section 5.1 says the same since 2026-11-25. Seven minor points of the third review stay open as known limits, listed in the ledger (Decisions, 2026-11-25 08:42).
