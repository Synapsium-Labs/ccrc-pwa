# Landing order, wave 5b — the landing skill text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coordinator and worker skills say what the operator ruled on 2026-10-30, and what stage 5 owes in text alone.
- **The new-head route is the coordinator's own act** (the operator's answer to D-7536's question; D-7588). A `red-unreachable` whose red is `main`'s own and already fixed on `main` is no longer a stop. The coordinator sends the fix round for one clean merge of `main`, then a review run scoped to that merge.
- **The evidence is stated** (D-7589): how "`main`'s own" and "already fixed on `main`" are shown. Where either cannot be shown, the red stays a stop for the operator.
- **The report-less fix round from `merging`** (wave 1's ruling of 2026-10-02, carried to stage 5): its mail's three entries, and the review its answering wave-done gets (D-7590).
- **Review 1232's F9 (a) and (c):** the **On every route** paragraph is rewrapped under a line-length guard, and `trainUnproven` and `trainUnread` each get one remedy (D-7591).
- **A requested change agrees with clause 19** (D-7592).
- **D-7546, held for the operator.** Task 2 restates the strict rule as the rule over the latest attempt of each required check name, with the every-attempt read kept as a report line. Task 2 is droppable, and Tasks 1 and 3 do not depend on it.

**Why:**
- These are the stage 5 items that need no server change. They land first and alone, so the server sub-waves carry only their own data, routes and verb (D-4329's reason; the split is in the ledger's Decisions, 2026-10-30).
- Clause 19 (on `main` since #1537) forbids the dialog that **A requested change** still prescribes.

**Architecture:** Markdown and its verbatim pins. No server, ccd or PWA file changes, and no clause is added or removed. Task 4 is the gate, the PR and the wave-done.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.5 item 5, the fix round on the `merging → working` edge;
- §5.7.5, the stops and Figure 1 (D-7588 departs from its "never to another route");
- §5.7.4, the merge proof.

**Other sources:**
- the ledger, `docs/superpowers/programs/landing-order.md`, Carried constraints: "From wave 1's rulings (2026-10-02)" (the report-less fix round) and "From wave 5a's review (1232)" (F9);
- wave 5a's plan, `docs/superpowers/plans/2026-10-30-landing-order-wave5a-carried-hardening.md` (D-7536), and its departures note, `docs/superpowers/plans/2026-10-30-landing-order-wave5a-departures.md` (D-7546).

**Prerequisite:** wave 5a (#1960) and this plan are on `main`.

**Files (the whole wave):**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`, `ccd/coordinator-skill/SKILL.md` (step 6's **Send back** arm only), `ccd/worker-skill/SKILL.md` (the `A fix-round mail arrives` bullet only: its opening gains one word, and sentences are appended).
- Test: `server/test/coordinator-skill.test.ts`, `server/test/worker-skill.test.ts`.
- Run, not modified: `server/test/coordinator-landing-verdict.test.ts`, which stays green with no change.

**Plan review.**
- **Drafting.** The tasks were drafted against `main` by an Opus reader, and a Sonnet reader checked them against `main`: every code claim, every red-first step and every mutation row's red. All four fixes it found are applied.
- **Review.** Two Opus lenses then reviewed the whole plan (the text's truth, and its pins), and a reader checked the fixed plan for internal consistency. One critical finding held and is answered: "three lines" in either skill would have failed the clause-count census, so neither skill puts a number word before "lines". Four important findings are answered:
  - clause 15 names only an ejection whose base the landing line recorded, so until sub-wave 5e records one, the report-less round is read as that ejection, naming the `origin/main` sha the coordinator read (D-7590);
  - the new-head round's first line names its PR, as worker clause 16 needs;
  - the evidence for `main`'s own is reads a coordinator can type, over a bounded range (D-7589);
  - a passing read on `main`'s tip counts only from a run that ran the check's job, never a refresh run (D-7589).
- **Minors.** Each minor finding is answered too, and the review's cuts removed text that decided nothing.

## What this does not claim
- **No server, ccd or PWA change.** Landing entries, `mainRedHold`, `fixesMain`, intents and the second-ejection ask are sub-wave 5e onward, and the next-to-land mail is 5i.
- **`main`'s own is not provable on every red.** On a merge-queue repository, `main`'s commits carry the queue's passing runs, so the route may rarely be taken, and such a red stays a stop for the operator (D-7589).

## Global Constraints
- **The §5b verdict fence is byte-identical.** On `origin/main` (`70822435f`) its 254 body lines hash to `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7`. Measure both sides with `sed -n '/^### 5b — /,/^## 6 — /p' <file> | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum`, and `git diff origin/main -- ccd/coordinator-skill/references/wave-lifecycle.md` touches no line between the fence markers.
- **Skill text only.** No clause is added or removed: `CONTRACT` stays at 19 entries in both skill tests, and the clause-count words in README and CLAUDE.md do not change.
- **Pins move with their text,** in the commit that changes the text.
- **No new skill sentence holds a double quote,** and each new coordinator-skill opening joins a quote census (the wave 5b census or the report-less census); the worker sentences are pinned whole by the worker case.
- **Wrap.** Every paragraph this wave writes in `wave-lifecycle.md` wraps at 80 columns; untouched lines keep their width. `SKILL.md`'s step 6 keeps its five-space continuation indent.
- **Never write `update-branch` or a destructive verb in new text.**
- **Neutral names only.** The repository is public.
- **Tests.** Every test runs from `server/` as `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>`, in the foreground, with a timeout of at least 600000 ms. Fixture HOMEs only, and never `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
- **Mutations.** Run them sequentially in the worktree. Restore each mutated file from a saved copy with its sha256 checked, never with `git checkout`, and keep each row's log under `.superpowers/sdd/`.
- **Deviation numbers are issued, never chosen.** This plan defines D-7588 to D-7592, of the block D-7588 to D-7599 issued on 2026-10-30 for waves 5b and 5c. A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **The stop paragraph is true as a whole,** except the carried D-7495 sentence while Task 2 is dropped. A stop still enqueues and merges nothing. The only exception is the new-head route, taken only when both reads show that the red is `main`'s own and already fixed on `main`'s current tip. Anything else stays a stop for the operator: a name red, pending, not reported or unread on `main`'s tip, a passing read on `main`'s tip from a run that did not run that check's job (or whose kind the reads cannot show), or no `main` commit among the twenty read that shows the name red.
2. **No text promises that a merge of `main` skips its review** (D-7472). The new-head route and the report-less fix round each end in a review run scoped to their change.
3. **The requested-change ask agrees with clause 19.** While any child is active, it is closing-turn text, never an `AskUserQuestion` dialog.
4. **`trainUnproven` and `trainUnread` each have one remedy:** §5 re-reads `trainUnread` before dispatching, §5b re-reads it once and then reports the stop; neither is ever treated as merged.
5. **The report-less fix-round mail's three entries are the same words** in the coordinator's step 6 and in the worker's bullet. Its first line names the PR in both forms and maps onto worker clause 16's ejection trigger, which is unchanged. Until stage 5e records a base, the coordinator reads the report-less round as clause 15's ejection, its base the `origin/main` sha read after one fetch, and a `paths:` round as clause 15's conflict-sync on a measured conflict, on the operator's answer of 2026-10-30 to D-7536's question. That departs from clause 15's literal words (D-7590): rule on it. Task 2 can be removed whole, leaving Tasks 1 and 3 green and true.

---

### Task 1: §5b's landing text (D-7536, review 1232 F9 (a) and (c), the requested-change ask against clause 19)

Scope items 1, 3 and 5. This task also records items 6 and 7 as already closed.
- **Item 1 (D-7536):** a `red-unreachable` whose red is `main`'s own and already fixed on `main` is now a route the coordinator takes itself. The stop paragraph's sentences that this makes false are restated: "every stop goes to the operator, never to another route", and "A stop … changes nothing".
- **Item 3:** the **On every route** paragraph is rewrapped. `trainUnread` and `trainUnproven` each get their own remedy.
- **Item 5:** **A requested change** sent the coordinator to an `AskUserQuestion` dialog. Clause 19 forbids one while any child is active (`CONTRACT[18]`: "While any child is active, this session asks the operator in its closing turn text and ends the turn, never with an AskUserQuestion dialog"). The sentence is made consistent with clause 19, and it adds no new rule (D-7592).

The D-7495 sentence of the stop paragraph stays word for word in this task. Task 2 alone restates it, so Task 2 can be dropped without touching this task.

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`. These parts only:
  - §5 **One PR per child** (the `trainUnread` parenthesis);
  - §5b's `MERGED head=<sha>` bullet;
  - **On every route** (whitespace only);
  - **A requested change** (its fourth sentence);
  - **A stop.**
- Test: `server/test/coordinator-skill.test.ts`.
- Read, not modified: `ccd/coordinator-skill/SKILL.md` (clause 19, as `CONTRACT[18]`).

**Interfaces:**
- Consumes these file-scope helpers of `coordinator-skill.test.ts`: `flat`, `refs`, `skill`, `allSkillText` and `CONTRACT`.
- Produces one new `describe` at the end of the file: `'landing order wave 5b: the new-head route, the train words, the requested-change ask and the wrap'`. Inside it, these locals are declared exactly as the 3e describe declares them:
  ```ts
  const wl = refs('wave-lifecycle.md');
  const at = wl.indexOf('### 5b — The landing route, from the repository\'s own rules');
  const sec = at >= 0 ? wl.slice(at, wl.indexOf('\n## ', at)) : '';
  const fence = /```bash\n([\s\S]*?)```/;
  const block = fence.exec(sec)?.[1] ?? '';
  const prose = flat(sec.replace(fence, ''));
  ```
- No exported symbol and no helper is added.

- [ ] **Step 1: Record the two closed items. No edit.** Items 6 and 7 are already closed on `main`: item 6 by the clause 15 split pin in `pins clause 15 as a whole line of SKILL.md, with no --admin outside it and no licence anywhere (landing-order wave 3e)`, item 7 because no clause count changes.

- [ ] **Step 2: The failing pins (red first).** In `coordinator-skill.test.ts`:
  1. **`says what a stop does, and what is not one (spec §5.7.5)`** becomes:
     ```ts
     expect(prose).toContain('A stop enqueues nothing and merges nothing. It leaves the run where it is (at `merging` or `awaiting-review`) and changes nothing, with one exception, the new-head route below.');
     expect(prose).toContain('which stop fired and what it read');
     expect(prose).toContain('every stop goes to the operator, and only that exception goes on to another route as well');
     expect(prose).toContain('Not a stop: a required check red on the head that is the PR\'s own');
     ```
  2. **The stop pin** (`pins the whole stop paragraph, to the end of §5b: …`). Its `whole` array becomes these strings, in this order:
     ```ts
     '**A stop.** A stop enqueues nothing and merges nothing. It leaves the run where it is (at `merging` or `awaiting-review`) and changes nothing, with one exception, the new-head route below.',
     'Say in your turn\'s text which stop fired and what it read, for the operator: every stop goes to the operator, and only that exception goes on to another route as well.',
     '<unchanged: The verdict stops with one of these reasons: … `approval-missing`.>',
     '<unchanged: A `changes-requested` stop is read before …>',
     '<unchanged: Four stops no read decides are yours to name: …>',
     '<unchanged: Not a stop: a required check red on the head that is the PR\'s own; …>',
     'A `red-unreachable` whose red is `main`\'s own and already fixed on `main` needs a new head, and this session takes that route itself (D-7588): on route Q disarm first, then a fix round to the owning worker on the `merging → working` edge for one clean merge of `main` and nothing else, then a review run scoped to that merge alone.',
     'Show both facts with reads you can type, after one `git fetch origin`: read that one required name on a `main` sha with `gh api --paginate \'repos/{owner}/{repo}/commits/<sha>/check-runs\'` and `gh api --paginate \'repos/{owner}/{repo}/commits/<sha>/status\'`, judged as read 5 judges it: red when a completed run of it concluded other than success, neutral or skipped, or a status of it reads failure or error; passing only when neither is red, none is pending, and a run of it or a success status reports it.',
     'The red is `main`\'s own when that name reads red on a commit that `git rev-list --max-count=20 <handoffCommit>..origin/main` lists, read newest first and stopping at the first red, and it is already fixed on `main` when that name reads passing on `main`\'s current tip (`git rev-parse origin/main`) from a run that ran its job.',
     'A passing read on `main`\'s tip counts only from a run of that name that concluded success in a workflow run that ran its job, a merge-queue run (its `event` reads `merge_group`) or a full run, and never from a refresh run, which runs no test legs: read the kind with `gh api --paginate \'repos/{owner}/{repo}/actions/runs?head_sha=<sha>\'`, because a push to `main` runs no test legs and still reports every required check green (spec §5.1, ruled 2026-09-28).',
     'Where none of those commits shows that name red, or that name does not read passing on `main`\'s current tip from such a run (red, pending, not reported, unread, passing only from a run that did not run its job, or from a run whose kind the reads cannot show), the stop stands and goes to the operator as every other stop does.',
     'The one rerun the RED bullet allows does not clear a red that is `main`\'s own, and no close and reopen does either: the verdict calls a required name red while any completed run of it on the head failed, a later green run of it included (D-7495; judging only the newest run would loosen the gate, which is the operator\'s to decide), a rerun replays its run\'s original merge commit, and a close and reopen of the PR can race GitHub\'s recompute of the merge ref.',
     'Where you take the route, say so in your turn\'s text with the reads that showed it.',
     ```
     The four `<unchanged: …>` entries are today's strings, copied exactly. The assertion stays `expect(prose.slice(from).trim()).toBe(whole)`.
  3. **The MERGED entry.** It changes in both `pins the action text of every verdict line, whole (the action pins)` and `pins the whole verdict-line list, …`. Its tail, from `Where that proof holds`, becomes:
     ```ts
     '… Where that proof holds, the PR landed, as on this line. Where it does not, the stop stands: `trainUnproven`, no row or another head is reported as that stop at once, while `trainUnread` means ccd could not read the train record (no time left in its budget, a timeout, GitHub unreachable), so read the row once more and report the stop if it still reads `trainUnread`.'
     ```
  4. **The One PR per child pin** (`pins the whole One PR per child paragraph, …`). In its fourth string, replace `so a label alone reads \`trainUnproven\`, or \`trainUnread\` while ccd has not read the train record yet — read again later, never treat either as merged — and you never name a label)` with:
     ```ts
     'so a label alone reads `trainUnproven` when ccd read that record and it proves nothing, which is reported as not merged, or `trainUnread` when ccd could not read it, which is unmeasured and is read again later; never treat either as merged, and you never name a label)'
     ```
  5. **The requested-change sentence.** In both `pins the whole requested-change section: …` and the `rc` list of `stops every route on a requested change and asks the operator, with a bounded ignore …`, the string becomes:
     ```ts
     'On `changes-requested`, this session stops and asks the operator one single-select question, address or ignore: while any child is active, in its closing turn text, never with an AskUserQuestion dialog (clause 19), and otherwise with AskUserQuestion.'
     ```
  6. **The new describe** (Interfaces), with five cases:
     ```ts
     it('takes the new-head route itself for a red that is main\'s own and already fixed on main, and shows both facts (D-7588)', () => {
       expect(prose).toContain('needs a new head, and this session takes that route itself (D-7588): on route Q disarm first, then a fix round to the owning worker on the `merging → working` edge for one clean merge of `main` and nothing else, then a review run scoped to that merge alone.');
       expect(prose).toContain('The red is `main`\'s own when that name reads red on a commit that `git rev-list --max-count=20 <handoffCommit>..origin/main` lists, read newest first and stopping at the first red');
       expect(prose).toContain('it is already fixed on `main` when that name reads passing on `main`\'s current tip (`git rev-parse origin/main`) from a run that ran its job.');
       expect(prose).toContain('the stop stands and goes to the operator as every other stop does.');
       expect(prose).toContain('read that one required name on a `main` sha with `gh api --paginate \'repos/{owner}/{repo}/commits/<sha>/check-runs\'` and `gh api --paginate \'repos/{owner}/{repo}/commits/<sha>/status\'`, judged as read 5 judges it');
       expect(prose).toContain('and never from a refresh run, which runs no test legs');
       expect(prose).toContain('or from a run whose kind the reads cannot show), the stop stands');
       expect(prose, 'the evidence is again a read no command runs').not.toContain('as read 5 reads the head');
       expect(prose, 'a stop again goes to no other route').not.toContain('never to another route');
       expect(prose, 'the route is again only named in a report').not.toContain('its report names that route');
       expect(prose, 'a stop again changes nothing, with no exception').not.toContain('enqueues nothing, merges nothing and changes nothing.');
     });

     it('asks the requested-change question as clause 19 says while any child is active (scope item 5)', () => {
       expect(CONTRACT[18]).toContain('never with an AskUserQuestion dialog');
       expect(prose).toContain('while any child is active, in its closing turn text, never with an AskUserQuestion dialog (clause 19), and otherwise with AskUserQuestion.');
       expect(prose, 'the ask is again a dialog whatever the children').not.toContain('asks the operator with AskUserQuestion, one single-select choice');
     });

     it('gives trainUnproven and trainUnread one remedy each (review 1232 F9 (c))', () => {
       const all = flat(wl);
       expect(prose).toContain('`trainUnproven`, no row or another head is reported as that stop at once, while `trainUnread` means ccd could not read the train record');
       expect(prose).toContain('so read the row once more and report the stop if it still reads `trainUnread`.');
       expect(all).toContain('reads `trainUnproven` when ccd read that record and it proves nothing, which is reported as not merged, or `trainUnread` when ccd could not read it, which is unmeasured and is read again later;');
       expect(all, 'trainUnread is again listed with the words that stand at once').not.toContain('(`trainUnproven`, `trainUnread`, no row, or another head)');
       expect(all, 'one remedy again covers both words').not.toContain('— read again later, never treat either as merged —');
     });

     it('wraps the On every route paragraph with no short line inside it (review 1232 F9 (a))', () => {
       const from = wl.indexOf('**On every route**');
       expect(from, 'wave-lifecycle.md lost the On every route paragraph').toBeGreaterThanOrEqual(0);
       const lines = wl.slice(from, wl.indexOf('\n\n', from)).split('\n');
       expect(lines.length).toBeGreaterThan(1);
       for (const l of lines.slice(0, -1)) expect(l.length, `a short line inside the paragraph: ${l}`).toBeGreaterThanOrEqual(60);
       for (const l of lines) expect(l.length, `a line past the file's width: ${l}`).toBeLessThanOrEqual(80);
     });

     it('no 5b sentence holds a double quote', () => {
       const flatAll = flat(allSkillText);
       for (const s of [
         'A stop enqueues nothing and merges nothing', 'It leaves the run where it is', 'Say in your turn\'s text which stop fired',
         'A `red-unreachable` whose red is', 'Show both facts with reads you can type', 'The red is `main`\'s own when that name',
         'A passing read on `main`\'s tip counts only', 'Where none of those commits shows that name red',
         'Where you take the route', 'Where it does not, the stop stands', 'On `changes-requested`, this session stops',
       ]) {
         const from = flatAll.indexOf(s);
         expect(from, s).toBeGreaterThanOrEqual(0);
         const sentence = flatAll.slice(from, flatAll.indexOf('. ', from));
         expect(sentence, `a double quote in the sentence beginning ${s}`).not.toContain('"');
       }
     });
     ```

- [ ] **Step 3: Run it red.**
  - Run: `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts`.
  - **Expected red, each for the text not yet written:**
    - `says what a stop does …`, the stop pin, the action pins, the list pin, the One PR per child pin, the requested-change pin and the `rc` ruling case;
    - the new describe's first four cases. The wrap case fails on the 15-column line `route G or U is`.
    - the 5b quote census, whose presence assertion fails on `A stop enqueues nothing and merges nothing`.
  - **Expected green:** every other case, with the clause 15 pin and all three 5a cases among them.

- [ ] **Step 4: Write the text.** In `wave-lifecycle.md`, wrap every changed paragraph at 80 columns. Flattened, the text is:
  - **§5, One PR per child.** Replace exactly the segment `so a label alone reads `trainUnproven`, or `trainUnread` while ccd has not read the train record yet — read again later, never treat either as merged — and you never name a label)` with:
    "so a label alone reads `trainUnproven` when ccd read that record and it proves nothing, which is reported as not merged, or `trainUnread` when ccd could not read it, which is unmeasured and is read again later; never treat either as merged, and you never name a label)"
  - **§5b, the `MERGED head=<sha>` bullet.** Replace its last sentence, "Where that proof holds, …, the stop stands.", with:
    "Where that proof holds, the PR landed, as on this line. Where it does not, the stop stands: `trainUnproven`, no row or another head is reported as that stop at once, while `trainUnread` means ccd could not read the train record (no time left in its budget, a timeout, GitHub unreachable), so read the row once more and report the stop if it still reads `trainUnread`."
  - **On every route.** These are the same words, rewrapped. The lines are exactly:
    ```
    **On every route** the merge is proven as step 3 proves it: MERGED, or CLOSED
    with `landedInTrain: true` on the PR's row of `ccd pr-state --session
    <sessionId>`, with `headRefOid` equal to `handoffCommit`. A refused merge on
    route G or U is read, reported and stopped on, and never retried with another
    method, with `--admin` or with `--auto`. This session writes no setting to make
    a route work: no ruleset, no branch protection, no merge-method or auto-merge
    setting (clause 15).
    ```
  - **A requested change.** Its fourth sentence becomes:
    "On `changes-requested`, this session stops and asks the operator one single-select question, address or ignore: while any child is active, in its closing turn text, never with an AskUserQuestion dialog (clause 19), and otherwise with AskUserQuestion."
  - **A stop.** The paragraph, to the end of §5b, is Step 2's thirteen stop-pin strings, joined by one space.
  - Do not touch any line between the fence markers.

- [ ] **Step 5: Run it green.**
  - Run `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts`, then `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-landing-verdict.test.ts`. Expected: both green, and the verdict file unchanged.
  - Re-measure the fence hash (Global constraints). Expected: `dec52b5a…f3a7`.

- [ ] **Step 6: Mutations** (rows 5B-SKILLS-01 to -09, -18 and -19, in Task 4's table). Run only `test/coordinator-skill.test.ts`.

- [ ] **Step 7: Commit.**
  ```
  docs(skills): the coordinator takes the new-head route for a red that is main's own; the train words and the requested-change ask (landing order wave 5b)
  ```

---

### Task 2: D-7546, the latest attempt decides (DROPPABLE, held until the operator rules)

> **DROP OR SWAP MARKER.** Every step of this task is item 2 (D-7546) and nothing else, and nothing in Tasks 1 or 3 depends on it.
> - **Drop it** if the operator has not ruled when the wave opens. Task 1's stop paragraph then keeps the D-7495 sentence as it is on `main`.
> - **Leave it out of 5b** if the operator rules the other way (read 5 adds `filter=all`). That is a change to the verdict block's bytes, which scope 5b excludes, and Task 1's D-7495 sentence becomes true only once that later plan lands.
> - **Note:** this task implements D-7546, which is already defined, so it takes no new number. The operator has not yet ruled on D-7546, so the task stays droppable.
> - **Take it** only on the coordinator's recommendation as ruled: the latest attempt of each required name decides, and the every-attempt read is a report line.

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`, the stop paragraph only (outside the fence).
- Test: `server/test/coordinator-skill.test.ts`.
- Mutation only, claimed for row 5B-SKILLS-11: the same file's verdict block, read 5's URL. It is measured, restored and never shipped.

**Interfaces:** no new helper. The new case goes into Task 1's wave 5b describe. The 5a case `the strict rule the stop paragraph states is the block's own arm (D-7495)` is renamed and gains two assertions.

- [ ] **Step 1 (D-7546): The failing pins.**
  1. **The stop pin.** Replace its twelfth string, the D-7495 sentence, with these four, in this order, before `Where you take the route, …`:
     ```ts
     'The one rerun the RED bullet allows does not clear a red that is `main`\'s own, and no close and reopen does either: a rerun replays its run\'s original merge commit, and a close and reopen of the PR can race GitHub\'s recompute of the merge ref.',
     'The verdict judges the latest attempt of each required name, which is GitHub\'s own rule and all read 5 lists: `commits/<sha>/check-runs` with no `filter` answers only the newest run of each name, so a name that failed and then passed on a rerun of the same head reads passing (D-7546).',
     'Before every enqueue and every direct merge, read every attempt as well, with `gh api --paginate \'repos/{owner}/{repo}/commits/<handoffCommit>/check-runs?filter=all\'`, and put one line in your landing report, apart from the verdict\'s line: each required name that failed on any attempt, or none.',
     'That line is read only: it is never a stop, and it decides nothing.',
     ```
  2. **The 5a arm case** is renamed `the red arm the stop paragraph states is the block's own arm, over the latest attempt read 5 lists (D-7495, D-7546)`. It keeps its assertion and adds:
     ```ts
     expect(block, 'read 5 no longer reads the head\'s check runs').toContain('"repos/{owner}/{repo}/commits/$HC/check-runs"');
     expect(block, 'read 5 now reads every attempt: the prose\'s latest-attempt rule is false').not.toContain('filter=');
     ```
  3. **A new case in the wave 5b describe:**
     ```ts
     it('restates the strict rule over the latest attempt, and keeps the every-attempt read a report line, never a stop (D-7546)', () => {
       expect(prose).toContain('The verdict judges the latest attempt of each required name, which is GitHub\'s own rule and all read 5 lists');
       expect(prose).toContain('`commits/<sha>/check-runs` with no `filter` answers only the newest run of each name');
       expect(prose).toContain('check-runs?filter=all');
       expect(prose).toContain('That line is read only: it is never a stop, and it decides nothing.');
       expect(prose, 'the any-attempt rule is back').not.toContain('a later green run of it included');
       expect(prose, 'the any-attempt rule is back').not.toContain('judging only the newest run would loosen the gate');
     });
     ```
  4. **The 5b quote census** gains these openings: `'The verdict judges the latest attempt'`, `'Before every enqueue and every direct merge'` and `'That line is read only'`.
  - Run: `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts`.
    - **Expected red:** the stop pin, the new D-7546 case and the quote census (its presence assertion).
    - **Expected green:** the renamed arm case. It pins today's block, and its red is 5B-SKILLS-11.

- [ ] **Step 2 (D-7546): Write the text.** Replace the stop paragraph's D-7495 sentence with the four sentences above, wrapped at 80 columns. Nothing else changes.

- [ ] **Step 3 (D-7546): Run it green.** Run `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts`, then `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-landing-verdict.test.ts`. Expected: green. Re-measure the fence hash, expecting `dec52b5a…f3a7`.

- [ ] **Step 4 (D-7546): Mutations.** Run rows 5B-SKILLS-10 to -12, one file per run.

- [ ] **Step 5 (D-7546): Commit.**
  ```
  docs(skills): the landing verdict's red is the latest attempt of each required name; every attempt is a report line (D-7546) (landing order wave 5b)
  ```

---

### Task 3: the report-less fix round from `merging` (wave 1's ruling 2 of 2026-10-02, scope item 4)

A fix round sent from `merging` with no review report behind it comes from one of two places:
- a dequeue the coordinator answers with a fix round rather than a re-enqueue (§5's native-queue paragraph);
- §5b's new-head route (Task 1).

On `main`, the send-back arm assumes a report: its body opens with "the report's absolute path", and its `artifacts` name it. The worker's bullet says "The report at the path in the mail's `artifacts` … is your brief". This task adds the report-less form to both. It says:
- what the mail names (reason, base, paths or checks);
- the edge it rides (`merging → working`);
- that the answering wave-done gets a review run scoped to its change.

Lineage stays off (D-7472), so no text promises that a merge of `main` skips its review.

**Files:**
- Modify:
  - `ccd/coordinator-skill/SKILL.md`, step 6's **Send back** arm: one continuation paragraph after "review runs are never reused.", before `- **Clean:**`.
  - `ccd/worker-skill/SKILL.md`, the `A fix-round mail arrives` bullet: its opening "a review run read your wave" becomes "usually a review run read your wave", and sentences are appended after "never re-send the old numbers."
- Test:
  - `server/test/coordinator-skill.test.ts`
  - `server/test/worker-skill.test.ts`
- Not modified: `wave-lifecycle.md`'s native-queue paragraph. Its dequeue sentence already sends the round to "SKILL.md step 6's send-back", so the queue action pin does not move.

**Interfaces.** The printed shape of the report-less `fix-round` mail body is three entries, one to a line, and nothing else. The mail has no `artifacts`, and its `kind`, `subject` and edge are the send-back's own. Neither SKILL.md puts a number word directly before "lines": both skill suites' `spells that same count, as one derived word, everywhere prose states it` collect every such word and require "nineteen".
```
ejected: dequeued:#<pr>        |  ejected: new-head:#<pr>
base: <the origin/main sha read after one git fetch origin>
paths: <path>, <path>          |  checks: <required name>, <required name>
```

- [ ] **Step 1: The failing pins.**
  - **`coordinator-skill.test.ts`, a new describe at the end:** `'landing order wave 5b: the report-less fix round from merging'`.
    ```ts
    const sendBack = (): string => {
      const step6 = skill.slice(skill.indexOf('6. **Rule on the report**'), skill.indexOf('\n7. **Final merge:**'));
      const start = step6.indexOf('**Send back:**');
      return flat(step6.slice(start, step6.indexOf('**Clean:**', start + 1)));
    };
    const worker = flat(readFileSync(path.join(root, 'ccd/worker-skill/SKILL.md'), 'utf8'));

    it('sends a fix round with no report from merging: its two sources, its edge, its three entries, its clause 15 reading and its review (wave 1 ruling 2)', () => {
      const s = sendBack();
      expect(s).toContain('**A fix round with no report behind it** comes from `merging`: a dequeue you answer with a fix round rather than a re-enqueue (`references/wave-lifecycle.md` §5), or the new-head route for a red that is `main`\'s own (§5b).');
      expect(s).toContain('On route Q disarm first (§5), then make the same advance to `working`, on the `merging → working` edge, and send the same `fix-round` mail with no `artifacts`.');
      expect(s).toContain('Its body holds three entries, one to a line, and nothing else: `ejected: dequeued:#<pr>` or `ejected: new-head:#<pr>`, then `base: <sha>`, the `origin/main` sha you read after one `git fetch origin`, then `paths: <paths in conflict>` or `checks: <required names that are red>`.');
      expect(s).toContain('The worker\'s answering wave-done gets a NEW review run (step 5), scoped to the change that round made; a merge of `main` is reviewed like any other change.');
      expect(s).toContain('Until the landing line records a base (stage 5e), this round is clause 15\'s ejection, and the base it names is that `origin/main` sha; a `paths:` round is also the conflict-sync clause 15 allows on a measured conflict (the operator\'s answer of 2026-10-30 to D-7536\'s question).');
    });

    it('names the report-less first lines the worker skill reads (wave 1 ruling 2)', () => {
      for (const w of ['`ejected: dequeued:#<pr>`', '`ejected: new-head:#<pr>`']) {
        expect(sendBack(), `the coordinator no longer sends ${w}`).toContain(w);
        expect(worker, `the worker skill no longer reads ${w}`).toContain(w);
      }
    });

    it('no report-less sentence holds a double quote', () => {
      const flatAll = flat(allSkillText);
      for (const s of ['**A fix round with no report behind it**', 'On route Q disarm first (§5), then make', 'Its body holds three entries', 'Until the landing line records a base', 'The worker\'s answering wave-done gets a NEW review run']) {
        const from = flatAll.indexOf(s);
        expect(from, s).toBeGreaterThanOrEqual(0);
        const sentence = flatAll.slice(from, flatAll.indexOf('. ', from));
        expect(sentence, `a double quote in the sentence beginning ${s}`).not.toContain('"');
      }
    });
    ```
  - **`worker-skill.test.ts`, a new case in `describe('the worker skill: its contract')`:**
    ```ts
    it('reads a fix-round mail with no report as clause 16\'s ejection, its three body lines the whole brief (landing order wave 5b)', () => {
      const text = skill.replace(/\s+/g, ' ');
      expect(text).toContain('A `fix-round` mail whose first line reads `ejected: dequeued:#<pr>` or `ejected: new-head:#<pr>` has no report and no `artifacts`: it is clause 16\'s ejection, and its three body lines are your whole brief.');
      expect(text).toContain('Absorb the `base:` sha with `git merge`, then fix only the `paths:` or `checks:` it names; on `ejected: new-head:#<pr>` the merge is the whole round, with nothing else in it.');
      expect(text).toContain('naming this run): usually a review run read your wave and the coordinator ruled.');
      expect(text).toContain('Report a FRESH wave-done as for any fix round.');
    });
    ```
  - **Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/worker-skill.test.ts`.
    - **Expected red:** the three new coordinator cases and the new worker case.
    - **Expected green:** everything else, including `sends the worker back by mail, never by dispatch, after advancing the run`.

- [ ] **Step 2: Write the text.**
  - **`SKILL.md` step 6.** After "review runs are never reused.", and before `   - **Clean:**`, add this continuation paragraph (five-space indent), exactly:
    ```
         **A fix round with no report behind it** comes from `merging`: a dequeue
         you answer with a fix round rather than a re-enqueue
         (`references/wave-lifecycle.md` §5), or the new-head route for a red that
         is `main`'s own (§5b). On route Q disarm first (§5), then make the same
         advance to `working`, on the `merging → working` edge, and send the same
         `fix-round` mail with no `artifacts`. Its body holds three entries, one
         to a line, and nothing else: `ejected: dequeued:#<pr>` or `ejected:
         new-head:#<pr>`, then `base: <sha>`, the `origin/main` sha you read after
         one `git fetch origin`, then `paths: <paths in conflict>` or `checks:
         <required names that are red>`. Until the landing line records a base
         (stage 5e), this round is clause 15's ejection, and the base it names is
         that `origin/main` sha; a `paths:` round is also the conflict-sync clause
         15 allows on a measured conflict (the operator's answer of 2026-10-30 to
         D-7536's question). The worker's answering wave-done gets a NEW review
         run (step 5), scoped to the change that round made; a merge of `main` is
         reviewed like any other change.
    ```
  - **The worker skill.** In the `A fix-round mail arrives` bullet, change "a review run read your wave and the coordinator ruled." to "usually a review run read your wave and the coordinator ruled.", rewrapping only that sentence's lines. Then append to the bullet, after "never re-send the old numbers." (two-space indent), exactly:
    ```
      A `fix-round` mail whose first line reads `ejected: dequeued:#<pr>` or
      `ejected: new-head:#<pr>` has no report and no `artifacts`: it is clause
      16's ejection, and its three body lines are your whole brief. Absorb the
      `base:` sha with `git merge`, then fix only the `paths:` or `checks:` it
      names; on `ejected: new-head:#<pr>` the merge is the whole round, with
      nothing else in it. Report a FRESH wave-done as for any fix round.
    ```

- [ ] **Step 3: Run it green.**
  - Run `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts`, then `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/worker-skill.test.ts`. Expected: green, with `spells that same count, as one derived word, everywhere prose states it` green in both skill files (neither new text puts a number word directly before "lines").
  - Then run `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/update-branch-absent.test.ts`. Neither new text names the word.

- [ ] **Step 4: Mutations.** Run rows 5B-SKILLS-13 to -17, -20 and -21.

- [ ] **Step 5: Commit.**
  ```
  docs(skills): the report-less fix round from merging, in the coordinator's step 6 and the worker's fix-round bullet (landing order wave 5b)
  ```

---

### Task 4: the gate

- [ ] **Step 1: The fence.**
  - `git diff origin/main -- ccd/coordinator-skill/references/wave-lifecycle.md` shows no hunk between §5b's ` ```bash ` and its closing fence.
  - The hash reads `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7` (254 lines).

- [ ] **Step 2: The suites that read the changed files.** Run each from `server/`, one file per process, as `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>`. Expected: green.
  - **The touched files:** `coordinator-skill`, `worker-skill`, and `coordinator-landing-verdict` (unchanged).
  - **Readers of `wave-lifecycle.md`:** `asks-routes`, `auth-passkey`, `ccrc-api-closed`, `ccrc-install-graphify`, `ccrc-install-landing`, `child-reclaim-refusals`, `expiry-lane-prose`, `install-coordinator-skill`, `landing-verdict`, `pr-queue-lane`, `reviewer-skill`, `run-routes`, `session-hook-merge-deny`.
  - **Readers of the skills:**
    - `dead-coordinator-prose`, `ws-collect-prose`, `ws-expire-prose`, `ws-shed-deps-prose`;
    - `install-worker-skill`, `account-markers-pin`, `session-hook-role-skill-deny`;
    - `update-branch-absent`, `workflow-control-census`, `routing-references`, `skillstate`, `install-census`;
    - `delegation-wave3.integration` (it scans every file under the coordinator, worker and reviewer skill directories for lease verbs; the new text names none; a large file, so run it alone).
  - **Guards:** `citations`, `anchors`, `docs-parity`, `topology-clean`, `deviation-refs` (after `git fetch origin main`), and `single-definition/` whole.
  - `session-hook` is a known load flake. If it is red, re-run it alone.

- [ ] **Step 3: Counts unchanged.** `carries all nineteen clauses verbatim` is green in both skill tests, and `numbers exactly as many clauses as the CONTRACT pins …` and `spells that same count, as one derived word, everywhere prose states it` are green in each. `CLAUDE.md` and `README.md` are not in the diff.

- [ ] **Step 4: The mutation table.** Every row is measured red (rows 5B-SKILLS-10 to -12 only when Task 2 is taken), and its log is kept.

| id | Mutation | Predicted red |
|---|---|---|
| 5B-SKILLS-01 | the stop paragraph's second sentence goes back to `… for the operator: every stop goes to the operator, never to another route.` | **The stop pin** (`toBe`, one sentence differs), and **the new-head case (D-7588)**'s `not.toContain('never to another route')`. Also `says what a stop does …`, which now pins the new sentence. |
| 5B-SKILLS-02 | the 7th stop-pin string's `and this session takes that route itself (D-7588):` becomes `and its report names that route:` | **The new-head case (D-7588)**: its first `toContain` fails, and its `not.toContain('its report names that route')` fails too. The stop pin is red as well. |
| 5B-SKILLS-03 | drop the 11th stop-pin string, `Where none of those commits shows that name red, … as every other stop does.` | **The new-head case (D-7588)** (`toContain('the stop stands and goes to the operator as every other stop does.')`), the stop pin, and the 5b quote census's presence assertion for `Where none of those commits shows that name red`. |
| 5B-SKILLS-04 | in the 9th stop-pin string (the one beginning `The red is \`main\`'s own when that name`), change `when that name reads passing on \`main\`'s current tip (\`git rev-parse origin/main\`)` to `when that name reads passing on the head (\`git rev-parse origin/main\`)` | **The new-head case (D-7588)**: its third `toContain` fails, because the already-fixed evidence no longer reads `main`'s tip. The stop pin is red as well. |
| 5B-SKILLS-05 | the requested-change sentence goes back to `On \`changes-requested\`, this session stops and asks the operator with AskUserQuestion, one single-select choice: address or ignore.` | **The clause 19 case** (its `toContain` and its `not.toContain`), the requested-change pin, and the `rc` ruling list |
| 5B-SKILLS-06 | in the MERGED bullet, replace the whole last sentence (the new text) with main's exact one: `Where that proof holds, the PR landed, as on this line; where it does not (\`trainUnproven\`, \`trainUnread\`, no row, or another head), the stop stands.` | **The F9 (c) case** (`not.toContain('(\`trainUnproven\`, \`trainUnread\`, no row, or another head)')`), the action pins, the list pin, and the 5b quote census's presence assertion for `Where it does not, the stop stands` |
| 5B-SKILLS-07 | the One PR per child parenthesis goes back to `— read again later, never treat either as merged —` | **The F9 (c) case**: its third `toContain` and its last `not.toContain`. The One PR per child whole pin is red as well. |
| 5B-SKILLS-08 | re-insert a line break after `route G or U is` in **On every route** | **The wrap case only**: the line reads 15 columns, below 60. Every `flat` pin stays green. |
| 5B-SKILLS-09 | in the 8th stop-pin string only (the one beginning `Show both facts with reads you can type`), put a double quote around the first `main` (`"main"` for `` `main` ``) before the first `. ` of that string, so the census's slice sees it | **The 5b quote census**, which names the sentence beginning `Show both facts with reads you can type`. The stop pin and **the new-head case (D-7588)**'s fifth `toContain` are red as well, but the census names the quote. |
| 5B-SKILLS-10 | (Task 2) drop `That line is read only: it is never a stop, and it decides nothing.` | **The D-7546 case** (its fourth `toContain`), the stop pin, and the 5b quote census's presence assertion for `That line is read only` |
| 5B-SKILLS-11 | (Task 2, block mutant) read 5's URL becomes `"repos/{owner}/{repo}/commits/$HC/check-runs?filter=all"` | **Predicted red:** the renamed arm case (its first new assertion no longer finds `check-runs"`, its second finds `filter=`) AND `coordinator-landing-verdict.test.ts`, whose `gh` stub matches only `*/check-runs`, so the read-5 cases go red. Run both files, record both, and restore the block from the saved copy with its sha256 checked. |
| 5B-SKILLS-12 | (Task 2) restore the D-7495 sentence (`… a later green run of it included (D-7495; judging only the newest run would loosen the gate, …) …`) in place of the first of the four | **The D-7546 case**'s two `not.toContain`, and the stop pin |
| 5B-SKILLS-13 | drop the report-less paragraph from step 6's Send back arm | **The report-less case** (five `toContain`), the cross-skill case (`ejected: dequeued:#<pr>` is missing from the coordinator), and the report-less quote census's presence assertion for `**A fix round with no report behind it**` |
| 5B-SKILLS-14 | drop the worker bullet's three appended sentences | **The worker case**. In the coordinator file, the cross-skill case fails on its worker half. |
| 5B-SKILLS-15 | in the coordinator paragraph, `ejected: new-head:#<pr>` (it spans a line break there) becomes `ejected: new-head` | **The cross-skill case**: the coordinator no longer sends `` `ejected: new-head:#<pr>` ``. The report-less case's third `toContain` is red as well. |
| 5B-SKILLS-16 | `send the same \`fix-round\` mail with no \`artifacts\`` becomes `send the same \`fix-round\` mail with its \`artifacts\`` | **The report-less case**, second `toContain` |
| 5B-SKILLS-17 | `gets a NEW review run (step 5), scoped to the change that round made; a merge of \`main\` is reviewed like any other change.` becomes `needs no review run when it only merges \`main\`.` | **The report-less case**, fourth `toContain`. The quote census's presence assertion for `The worker's answering wave-done gets a NEW review run` is red as well. |
| 5B-SKILLS-18 | in the 10th stop-pin string, drop `, and never from a refresh run, which runs no test legs` | **The new-head case (D-7588)**: its sixth `toContain` fails. The stop pin is red as well. |
| 5B-SKILLS-19 | in the 9th stop-pin string, `git rev-list --max-count=20 <handoffCommit>..origin/main` becomes `git rev-list <handoffCommit>..origin/main` | **The new-head case (D-7588)**: its second `toContain` fails. The stop pin is red as well. |
| 5B-SKILLS-20 | drop the coordinator paragraph's clause 15 sentence, `Until the landing line records a base (stage 5e), … to D-7536's question).` | **The report-less case**, fifth `toContain`, and the report-less quote census's presence assertion for `Until the landing line records a base`. |
| 5B-SKILLS-21 | in the worker bullet's opening, `usually a review run read your wave` goes back to `a review run read your wave` | **The worker case**, its third `toContain`. |

- [ ] **Step 5: The PR.**
  - Before every push, scan the diff and the PR body for private names, as the repository's rule asks.
  - In the PR body, name:
    - Task 2's status: taken, dropped, or held for the operator;
    - the fence hash;
    - the mutation rows.

## Deviations found

This plan's numbers are D-7588 to D-7592, of the block D-7588 to D-7599 issued on 2026-10-30 for waves 5b and 5c. Each entry is dated 2026-10-30.

- **D-7588** — `new-head-route-taken-by-the-coordinator` (Task 1): Spec §5.7.5 and the caption of Figure 1 say that every arrow into STOP goes to the operator and never to another route. The operator's answer of 2026-10-30 to D-7536's question makes one red-unreachable, a red that is `main`'s own and already fixed, a route the coordinator takes itself, and the route text of Task 1 is the new-head route the coordinator takes. Spec files are outside wave 5b's files, so the skill now departs from the spec sentence. The ledger PR adds an inline amendment note to the spec.
- **D-7589** — `main-own-evidence-reads-main-commits` (Task 1): Scope item 1 asks for "main's own" and "already fixed on main" to be shown from reads the coordinator already makes. Today read 5 is made for the head alone. The plan applies read 5's own judgment (check-runs and statuses, judged name by name) to commits of `main`, and finds those commits with `git rev-list --max-count=20 <handoffCommit>..origin/main` and `git rev-parse origin/main` after one fetch. These are the same reads aimed at other shas, not reads the coordinator already makes. On a merge-queue repository, each commit of `main` carries the queue's own runs, which passed, so a red that is `main`'s own may never read red on a `main` commit. In that case the text keeps the red as the stop red-unreachable for the operator, so the route fails closed but may rarely be taken there.
  - Typed reads: read 5 is the `checks()` function inside the verdict's subshell, and it depends on `$HC` and `$req`, which earlier reads compute; run with a `main` sha, the block stops at read 1 before read 5 runs. So the text gives the reads a coordinator can type (two `gh api --paginate` calls on the commit's check-runs and combined status) and read 5's judgment in words, and bounds the range at the twenty newest commits, read newest first and stopping at the first red, for the shared REST limit's sake. With no red among them the stop stands.
  - Already fixed, fail closed: the spec (§5.1, worker clause 16's second trigger) records "Ruled 2026-09-28: this replaces 'main's latest push run of the same required job is green', because since CI test selection (#183) a push to main runs no test legs and reports every required check green". So a passing read on `main`'s tip counts only from a run that ran that check's job (a merge-queue run or a full run, never a refresh run, which runs no test legs), read with `gh api --paginate 'repos/{owner}/{repo}/actions/runs?head_sha=<sha>'`; a passing read from any other run, or one whose kind the reads cannot show, leaves the stop standing.
- **D-7590** — `report-less-fix-round` (Task 3): the report-less fix round, its body and its review.
  - Review: spec §5.5 item 5 says a clean base-only absorption needs no new review, and that stage 4 re-pins the entry. Lineage stays off (D-7472). So the skill says every report-less round's answering wave-done gets a new review run scoped to its change, and that a merge of `main` is reviewed like any other change. No text promises the skip the spec describes.
  - Body: scope item 4 asks only that the mail name the base, the paths or checks, and the reason. The plan fixes the body as three entries, one to a line, whose first line is `ejected: dequeued:#<pr>` or `ejected: new-head:#<pr>`, and that word is a choice. Worker clause 16's third trigger is pinned verbatim as a fix-round mail that "names this PR ejected from the landing line with a base sha", so the word ejected, with the PR named in both forms, lets the worker read the mail without a clause change. The cost is that the new-head round is called an ejection, a word the spec otherwise uses for the landing line's entries (stage 5e). Neither SKILL.md puts a number word directly before "lines", because both skill suites require every such word to be "nineteen".
  - Clause 15: it allows a conflict-sync only on a measured conflict and otherwise only "a land-sync to the PR it named next to land in a strict-protection repository, or an ejection naming the base sha the landing line recorded". No landing line records a base until stage 5e. The coordinator rules that until then the report-less round (the dequeue round and the new-head round) is read as clause 15's ejection, its base the `origin/main` sha the coordinator read after one fetch, and a `paths:` round as the conflict-sync clause 15 allows on a measured conflict; the authority is the operator's answer of 2026-10-30 to D-7536's question. This departs from the clause's literal words. Clause 15 is not changed in 5b; the SKILL.md paragraph states the reading, pinned in the report-less case, and Review Focus 5 puts it to the reviewer.
- **D-7591** — `f9-wrap-and-train-remedies` (Task 1): review 1232 F9 (a) and (c).
  - F9 (c): the review's text is not in the repository. The plan reads its one line (trainUnread names two remedies under one word) from the two skill sentences and from ccd's annotate and `_pr_train_proofs` comments (D-7378). Under that reading, `trainUnproven` is a read record that proves nothing: it reads as closed and is reported. `trainUnread` is an unread record: it is re-read. The bound in §5b, read the row once more and then report, is the plan's own, and ccd does not state it.
  - F9 (a): the item asks only for a rewrap. Every existing pin compares flat (whitespace-normalised) text, so a rewrap has no red. The plan adds a line-length guard over that one paragraph (every line but the last at least 60 columns, none past 80) so that the item has a mutation row (5B-SKILLS-08).
- **D-7592** — `requested-change-agrees-with-clause-19` (Task 1): scope item 5. The **A requested change** sentence in §5b sent the coordinator to an AskUserQuestion dialog on `changes-requested`, which clause 19 forbids while any child is active. The sentence is made consistent with clause 19 (the ask goes in the closing turn text while any child is active, and otherwise stays an AskUserQuestion), and no new rule is added.
