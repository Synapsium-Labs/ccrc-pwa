# Landing order, wave 3d — a landed PR's trailing removal is not a dequeue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dequeue lane ignore the removal GitHub records when its queue lands a PR. Task 7's re-run on 2026-10-21 found two faults, and this wave fixes both:
- GitHub records a removal with reason `merged` at every successful queue merge, at or one second before the PR reads MERGED. So `queue` never reads `landed`, and a sweep that reads that removal while the PR still reads open answers `dequeued`: a false notice (stop rule 6).
- A server restart writes a merged PR's `merged` feed row a second time.

**Architecture:**
- **ccd.** `pr-state`'s queue query also asks for the removal's `reason`. A removal whose reason is exactly `merged` reads `landed`, whether the PR still reads open or already reads merged. Any other reason, or none, keeps today's answers: open reads `dequeued`, announced on the first sweep that reads it, and merged reads `none`. The reason chooses the word and never reaches the line.
- **Server, words.** `PR_QUEUE_MAP`'s glosses for `dequeued` and `landed` say what the words now mean. No word, field or decision changes: the landing lane already says nothing on `landed`.
- **Server, merged lane.** The `merged` feed row carries a once-only key, and `sweepMerged` reads it back with `hasNotice` before announcing, as the queue and nudge rows already do. A read that throws announces, as the lane did before. A row archived before the key existed is matched by its exact body, so one whose run has closed since repeats once, at the deploy.
- **Docs.** The spec's §5.2 and README's queue paragraph say the same.

**Tech Stack:** bash 5.2, python 3.12 (embedded in `ccd/ccd`), TypeScript, `node:sqlite`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.2: the queue query, the five words, the landing lane and its two notices, the rollout's proof run (step 3);
- §7: no GitHub-sourced string in an argv.

**Other sources:**
- The programme ledger: `docs/superpowers/programs/landing-order.md`, Decisions, "2026-10-21 12:15 — Task 7's re-run: the queue is on, stop rule 6 fired, and the operator kept it on", and Carried constraints, "From Task 7's re-run (2026-10-21)".
- The runbook whose stop rule this wave answers: Task 7 Step 6, stop rule 6, of `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`.
- **The operator's ruling, 2026-10-21: "Read the reason."** A removal with reason `merged` reads `landed`. Any other reason, or none, is still announced on its first read. There is no two-sweep wait, no new wire field and no reason allowlist. This replaces stop rule 6's prescribed remedy (announce only after two consecutive sweeps). The merge queue stays on, and wave 2b waits for this wave.

**Prerequisite:** current `main`, and the coordinator's ledger PR merged before this wave's PR opens. This wave's workspace is a fresh child from `main`. The ledger (`docs/superpowers/programs/landing-order.md`) is the coordinator's, not a task here, and today it still states the repealed remedy in two places. The coordinator's ledger PR owes, before this wave's PR opens:
- row 3d's scope cell, rewritten to the ruling: a removal with reason `merged` reads `landed`; any other reason, or none, is announced on its first read; no two-sweep wait, no new wire field, no reason allowlist; the queue stays on;
- the Next-wave brief's first bullet under wave 3d ("The lane announces a removal only after two consecutive sweeps read it with the PR still open."), rewritten to the same ruling;
- a new Decisions entry that quotes "Read the reason" with its date, 2026-10-21, and says it replaces stop rule 6's two-sweep remedy. The 12:15 entry records only that the queue stays on; Task 6's PR body links this new entry, not that one.

If the ledger PR has not merged when Task 6 is reached, the worker reports that in the wave-done and does not open the PR.

## Global Constraints

- **Public repository.** No private host, path, account, project, person, tracker or live fleet count goes in code, tests, docs, commits or the PR. Fixtures use neutral names (`demo`, `quiet-basin`, `o/r`).
- **`ccd/ccd` is generated.** After editing it, run `bash ccd/ccrc restamp ccd/ccd`. Then `node shared/mark.mjs --check ccd/ccd` must answer `ccd/ccd: ccrc-unmodified`, and exactly one `# ccrc:generated` line must remain.
- **`ccd/ccd`'s line count may change in this block.** The queue block starts below every line the frozen compaction-card corpus cites, so lines added there move no anchor. Task 1 adds 12 lines, and the census (`'ccd/ccd': 147` in `server/test/session-hook.test.ts`) was measured green with them.
- **No numeric line citation on an added line** (`server/test/citations.test.ts`). Cite a symbol (`_pr_queue_py`, `sweepMerged`), never `ccd/ccd:<n>` or `watch.ts:<n>`.
- **No GitHub-sourced string in an argv** (spec §7). The query stays a constant, owner and name stay raw `-f` variables, and the reason is never printed.
- **The wire is additive, and nothing is added.** No new field, no new word, and `FLEET_PROTO` does not change. `queueFor` stays the one reader of `queue` and `queueAt`.
- **Every word `word()` returns stays a literal `return '<word>', …`.** `ccd-pr-queue-words.test.ts` reads those literals out of ccd's text and compares them with `PR_QUEUE_WORDS`.
- **No new feed writer.** The once-only key goes through `pushOne`'s existing `dedupeKey`; no new `recordFeedEvent(` call site (`single-definition.test.ts`).
- **Fixture HOMEs only.** Never run `ccd` against the live `$HOME`. The ccd cases use `makePrHarness`.
- **Server log lines** are `console.warn('ccrc-server: …')`; `req.log` is a no-op.
- **Run suites in the foreground**, with a timeout of at least 600000 ms, package-local, one file per process: `./node_modules/.bin/vitest run test/<file>`.
- **Every command block starts at the repository root and leaves the shell there.** The working directory carries over between Bash calls, so every test run below is a subshell, `(cd server && …)`, and every `git add`, `bash ccd/ccrc` and `node shared/mark.mjs` runs at the root with root-relative paths.
- **Install every package's modules once, before Task 1.** `typecheck-tests` compiles `agent/` and `pwa/` (and `pwa/` resolves `@ccrc/ui` from `../ui`), so without their modules it reports inherited errors that hide a real one:

  ```bash
  (cd server && npm ci) && (cd agent && npm ci) && (cd ui && npm ci) && (cd pwa && npm ci)
  ```

  With all four installed, `typecheck-tests` passes, `12 passed (12)`, measured 2026-10-21 on the prototype with every task applied.
- **Each new guard ships with a red.** Its wave-done names the mutation and the red count.
- **Deviation numbers are issued by the coordinator at run-open.** A departure is named in the wave-done mail; a worker never calls the allocator.
- **Branch discipline.** Commit on the workspace's own branch. Never use a feature branch, `update-branch`, a rebase or a force push.

## Review Focus

1. **A reason that is not exactly `merged`.** `reason` is a nullable, free-form String with no documented values. A null, an absent key, a re-cased `MERGED`, a number, a list holding `merged`, and text this build does not know must all keep today's answers: open reads `dequeued`, merged reads `none`. The failure mode of an unknown reason is today's behaviour, never a new silence. (Task 1, Step 1 (c) and (e); mutations M3 and M6.)
2. **The merge's second.** An OPEN PR with no entry whose last act is a removal with reason `merged` reads `landed`, never `dequeued`: that is the false notice itself. An entry present still wins: such a PR reads `queued`. (Task 1, Step 1 (d2) and (d3); mutations M4, M5 and M5b.)
3. **The reason never leaves ccd's python.** It chooses the word, and no GitHub text reaches the line, the server, a brief or a mail. (Task 1, Step 1 (d2)'s and (e)'s `not.toContain`, which assert the case's own reason, JSON-quoted, is absent from the whole output; mutations M7, which leaks it through `queueAt`, and M8, which leaks it in a field of its own.)
4. **A restart whose body changed.** The run closed between the two sweeps, so the merged row's reason clause is gone and only the key can match. A row archived before the key existed has no key, so only its exact body matches it: while that body is unchanged, nothing repeats; once its run has closed since, which is the usual case for a queue-landed PR, it is announced once more at the first sweep after the deploy, and that repeat is keyed, so the restart after it repeats nothing (the third repeat by design, Pre-flight 7). A second PR from the same workspace is a new key and is announced. (Task 3, Step 1 (b), (c), (c2) and (d); mutations B1, B2 and B5.)
5. **A durable read that throws, or no store at all.** A `hasNotice` that throws announces and logs once, and `sweepLanding` still runs in that sweep: `sweepMerged` runs inside `sweepPr`'s `try` with no `catch`. A server with no coord store logs nothing. (Task 3, Step 1 (e) and Step 3's pr-sweep pin; mutations B3 and B4.)

## File Structure

| File | Task | Change |
|---|---|---|
| `ccd/ccd` | 1 | the queue block's header comment; `PR_QUEUE_QUERY`'s removal fragment; `_pr_queue_py`'s `facts_in` tuple and `word()` (≈37993–38130 at `8ca794742`) |
| `server/test/ccd-pr-queue.test.ts` | 1 | `node()` takes a reason; the query pin; the hand-merge case over seven reasons; a new describe of eleven reason cases |
| `server/src/prstate.ts` | 2 | `PR_QUEUE_MAP`'s docstring and its `dequeued` and `landed` glosses (≈227–232) |
| `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` | 4 | two "(Amended 2026-10-21, wave 3d …)" notes (§5.2's query and dequeue bullets), one inline clause in rollout step 3, and one surfaces-table cell |
| `server/src/watch.ts` | 3 | `mergedBody` beside `mergedKey`; `mergedNotified`'s docstring; `announceMerged`'s key; `sweepMerged`'s durable read |
| `server/test/pr-queue-lane.test.ts` | 3 | a new describe of six restart cases |
| `server/test/pr-sweep.test.ts` | 3 | the coordless arm pins that no read is attempted; the tag case's comment |
| `README.md` | 5 | the native merge queue paragraph (≈4696–4706) |

## Task order

Three files this wave edits were claimed by other programmes' workers when this plan was written: `ccd/ccd` (Task 1), `server/src/watch.ts` (Task 3) and `README.md` (Task 5). Tasks 2 and 4 touch none of them.
- Do Tasks 2 and 4 first.
- Then do Tasks 1, 3 and 5, each once the claim on its file is yours. Take them in whatever order the claims free. A 409 names the holder, who is the one to ask. Never edit a file another session holds.
- No task reads another task's code. Task 2's glosses describe Task 1's behaviour, and may land a commit before it; no test reads them.
- A worker that runs out of free tasks pushes what it has, reports which tasks wait on which claim, and waits. It does not merge `main` to chase a claim.
- Task 6 needs every other task.
- **A land-sync conflict on `ccd/ccd` line 2** (the stamp) is resolved by taking `main`'s line and restamping: `bash ccd/ccrc restamp ccd/ccd && node shared/mark.mjs --check ccd/ccd`. Any other `ccd/ccd` conflict is a question for the coordinator.

## Pre-flight findings (measured while planning; not deviations)

1. **Every queue merge ends in a removal with reason `merged`.** Read-only GraphQL reads of this repository, 2026-10-21:
   - 16 of 16 queue merges since 07:07 UTC end in a `RemovedFromMergeQueueEvent` with reason `merged`: 9 at the same second as `mergedAt`, 7 one second before it. No add follows any of them.
   - Other reasons seen on earlier removals: `failed_checks`, `manual` (a removal from the UI) and `merge_conflict`.
   - `RemovedFromMergeQueueEvent.reason` is a nullable `String` scalar, not an enum. The schema documents no values. Nothing else on the event, the entry or the PR tells a landing from a dequeue in one read: the entry simply vanishes, and `mergedBy` is the enqueuing login.
2. **ccd never asks for the reason.** The removal fragment selects only `createdAt`, and `facts_in` keeps a 4-tuple. So `word()` answers `dequeued` for any OPEN PR whose last act is a removal, `landed` only for MERGED with the add last, and `none` for every queue-merged PR. The header's argument ("the ADDED event after the removal is the whole difference") is falsified by finding 1.
3. **The server needs no logic change for the word.** `landingAsk` asks for a notice only on `dequeued` or on phase `merged` (`server/src/coord/landing.ts`). An open line reading `landed` is already pinned silent (`pr-queue-lane.test.ts`, "says nothing for queued, landed, none, unmeasured, or a line from an older ccd"; `landing-verdict.test.ts`, "asks nothing for queued, landed, …, on an open PR"). The `merged:#<n>` mail keys on phase, not on the word, so it still comes on the sweep that reads the PR merged.
4. **The query cost with `reason` added:** 0.99–1.66 s over 3 read-only runs, against `PR_GH_QUEUE_TIMEOUT=4`. `pr-timeout-budget.test.ts` is unchanged.
5. **The restart repeat.** `sweepMerged`'s only latch is the in-memory `mergedNotified`. `announceMerged` pushes with a tag and no `dedupeKey`, and `recordFeedEvent` refuses nothing. So the first sweep after a restart writes a second `merged` row. The tray tag only replaced the push; nothing replaced the row. `CoordStore.hasNotice(kind, sessionId, key, legacyBody?)` already exists and serves the queue and nudge rows.
6. **A throw in `sweepMerged` would cost the sweep.** `sweepPr` calls `sweepMerged` then `sweepLanding` inside a `try` with a `finally` and no `catch`, and `hasNotice` is a synchronous `node:sqlite` read that can throw. So the new read is wrapped. Measured on the prototype: without the wrap, Step 1 (e)'s merged row is never written.
7. **Three repeats remain, by design.** `hasNotice` reads at most `FEED_RETENTION` rows (2000), so a pruned row reads as never written. A push the presence gate kept out of the archive wrote no row to find. And a row archived before the key existed has no key, so `hasNotice`'s legacy arm (`dedupe_key IS NULL AND body = ?`) matches it only by its exact body, which `sweepMerged` rebuilds from the run's state at sweep time. The usual merged workspace is a queue-landed PR whose run waited at `merging` when its row was written, so that body names the open run; the coordinator closes the run after the merge, so at the deploy's restart the rebuilt body differs and the PR is announced once more. That repeat writes a keyed row, so it happens once per PR, at the deploy, and never again (Task 3, Step 1 (c2)). Each repeats once. The alternative, a legacy match on the `PR #<n> merged` prefix, needs a new store read; it is not taken.
8. **The wave-2 plan is a snapshot.** Its Task 2 case names, its Task 7 (a) and (a2) expectations and its mutation row W2 (whose `old` text is the `landed` gloss Task 2 rewrites) describe the old table. No test reads that plan's mutation rows. It is not edited. The operator's ruling and this plan supersede its stop rule 6's remedy. The ledger does not yet: today its row 3d and its Next-wave brief repeat that remedy, and the coordinator's ledger PR (Prerequisite) rewrites both and records the ruling.
9. **Left as they are, and listed for a later wave:**
   - the dequeue brief's and feed body's "after a failed group" wording (`landing.ts`), imprecise for `manual` and `merge_conflict` removals; its text is pinned by `landing-verdict.test.ts`;
   - an OPEN PR with no entry whose last act is an add, measured once live, which reads `none`;
   - coordinator clause 15 and `wave-lifecycle.md` §5, which state no word table ("removed it without landing" stays true) and are pinned by `coordinator-skill.test.ts`.

All counts below were measured 2026-10-21 at `8ca794742`, in a scratch worktree, under a load average of about 12.

---

### Task 1: `pr-state` reads the removal's reason, and a landing reads `landed`

**Model routing:** `sonnet`, effort `high`. The word decides whether a coordinator is told a PR left the queue.

**Files:**
- Modify: `ccd/ccd`, inside the block headed `# ── THE MERGE QUEUE, READ ONCE PER REPOSITORY PER SWEEP (landing-order wave 2) ──` (≈37981 at `8ca794742`):
  - the header comment, from `# the LAST queue act on its timeline. The spec names` through `# must tell apart from \`unmeasured\`.` (≈37993–38014);
  - `PR_QUEUE_QUERY`'s `nodes { __typename … }` line (≈38041);
  - `facts_in`'s docstring first line and its `out[num] = …` line (≈38079, ≈38107);
  - `word()`'s unpack line and one new branch (≈38123–38127).
- Test: `server/test/ccd-pr-queue.test.ts`.

**Interfaces:**
- Consumes: nothing new.
- Produces: the same five words on the same `queue` field. `landed` now also names a removal with reason `merged`, with `queueAt` the removal's time. Inside `_pr_queue_py` only: `facts_in()` returns `{number: (state, has_entry, last_act, at, why)}`.

- [ ] **Step 1: Write the failing tests**

(a) Replace the `node` fixture (`grep -n "^const node = " server/test/ccd-pr-queue.test.ts`) and its type line with:

```ts
type Act = 'AddedToMergeQueueEvent' | 'RemovedFromMergeQueueEvent' | null;
/** One PR node of the queue answer. `why`, when given, is the last act's `reason` (wave 3d); given as `null`, the
 *  key is present and null; not given, the key is absent, which is every fixture written before wave 3d. */
const node = (number: number, state: 'OPEN' | 'MERGED', entry: boolean, act: Act,
  at = '2026-09-23T10:00:00Z', ...why: [reason?: unknown]): Record<string, unknown> => ({
  number, state, mergeQueueEntry: entry ? { state: 'QUEUED' } : null,
  timelineItems: { nodes: act === null ? [] : [{ __typename: act, createdAt: at, ...(why.length > 0 ? { reason: why[0] } : {}) }] },
});
```

(b) In `'makes one GraphQL call, under PR_GH_QUEUE_TIMEOUT, with owner and name as raw -f variables'`, directly after `expect(q).toContain('ADDED_TO_MERGE_QUEUE_EVENT');`, add:

```ts
    // The removal's reason is asked for (wave 3d): the stub answers the same document whatever the query says, so
    // only this text tells a query that stopped asking.
    expect(q).toContain('... on RemovedFromMergeQueueEvent { createdAt reason }');
```

(c) Replace the whole case `it('none — a MERGED PR whose last queue act is a removal was merged BY HAND after the dequeue', …)` with:

```ts
  // Wave 3d: a removal whose reason is `merged` is the queue's own landing (below). Any other reason, or none, on a
  // MERGED PR is a removal the PR outlived: it was merged by hand after it.
  it.each([['absent'], ['manual'], ['failed_checks'], ['merge_conflict'], [null], ['some_new_reason'], ['MERGED']])(
    'none — a MERGED PR whose last queue act is a removal for any reason but merged (reason %j)', (why) => {
      const tip = workspaceWithCommit('demo', 'quiet-basin');
      h.ghRows([mergedRow({ headRefOid: tip })]);
      setQueue(answer([], [why === 'absent'
        ? node(42, 'MERGED', false, 'RemovedFromMergeQueueEvent')
        : node(42, 'MERGED', false, 'RemovedFromMergeQueueEvent', '2026-09-23T10:00:00Z', why)]));
      const o = sweep();
      expect(o.queue).toBe('none');
      expect('queueAt' in o).toBe(false);
    });
```

(d1), (d2), (d3), (e) Directly before `describe('the queue read may not cost the rows', () => {`, add the describe below. Its cases, in order: (d1) MERGED landed, (d2) OPEN landed (the merge's second), (d3) an entry present wins, and (e) the eight-reason `dequeued` `it.each`.

```ts
// Landing-order wave 3d. GitHub records a removal with reason `merged` at every successful queue merge, at or one
// second before the PR reads MERGED (16 of 16 queue merges, measured 2026-10-21). That removal is the landing, never
// a dequeue. The reason only chooses the word: it never reaches the line.
describe('the removal\'s reason (landing-order wave 3d)', () => {
  const T = '2026-10-21T07:24:15Z';

  it('landed — MERGED, last act a removal whose reason is merged, stamped with the removal', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    setQueue(answer([], [node(42, 'MERGED', false, 'RemovedFromMergeQueueEvent', T, 'merged')]));
    const o = sweep();
    expect(o.queue).toBe('landed');
    expect(o.queueAt).toBe(T);
  });

  it('landed, never dequeued — still OPEN, no entry, last act a removal whose reason is merged (the merge\'s second)', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, 'RemovedFromMergeQueueEvent', T, 'merged')]));
    const out = h.sh(`${queueGh(ANSWERS)} cmd_pr_state --project demo`);
    const o = lines(out)[0]!;
    expect(o.phase).toBe('open');
    expect(o.queue).toBe('landed');
    expect(o.queueAt).toBe(T);
    // The reason chose the word and went nowhere else. The line's phase is `open`, so no field of it is the
    // string "merged" unless the reason leaked.
    expect(out).not.toContain('"merged"');
  });

  it('queued — an entry present wins, whatever the last act\'s reason', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'RemovedFromMergeQueueEvent', T, 'merged')]));
    expect(sweep().queue).toBe('queued');
  });

  it.each([['manual'], ['failed_checks'], ['merge_conflict'], [null], ['some_new_reason'], ['MERGED'], [7], [['merged']]])(
    'dequeued — OPEN, no entry, last act a removal for any other reason, announced on its first read (reason %j)', (why) => {
      const tip = workspaceWithCommit('demo', 'quiet-basin');
      h.ghRows([openRow({ headRefOid: tip })]);
      setQueue(answer([node(42, 'OPEN', false, 'RemovedFromMergeQueueEvent', T, why)]));
      const out = h.sh(`${queueGh(ANSWERS)} cmd_pr_state --project demo`);
      const o = lines(out)[0]!;
      expect(o.queue).toBe('dequeued');
      expect(o.queueAt).toBe(T);
      // The reason chooses the word and goes nowhere else: no GitHub text reaches the line. Only a string reason
      // has a JSON form no honest line carries (`null` and `7` are ordinary JSON tokens).
      if (typeof why === 'string') expect(out).not.toContain(JSON.stringify(why));
    });
});
```

Each reason is its own case, so no single case runs more than one sweep against the 20 s test timeout. (d1) is MERGED, so its line's phase is `merged` and a `"merged"` absence would be false there; (d2) and (e) carry the leak checks.

- [ ] **Step 2: Run them and record the red**

Run: `(cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue.test.ts)`

Expected on `main`'s `ccd/ccd`, measured 2026-10-21 at `8ca794742` (re-measured with (d2)'s and (e)'s leak checks): `Tests  3 failed | 28 passed (31)` (14 on `main` before the new cases).
- `makes one GraphQL call, …`: `expected 'query=query($owner: String!, $name: S…' to contain '... on RemovedFromMergeQueueEvent { c…'`.
- (d1) `landed — MERGED, last act a removal whose reason is merged, …`: `expected 'none' to be 'landed'`.
- (d2) `landed, never dequeued — still OPEN, …`: `expected 'dequeued' to be 'landed'`.
- The seven `none` cases (c), (d3) `queued` and the eight `dequeued` cases (e) pass. They pin today's answers, which the change must keep.

- [ ] **Step 3: Implement**

In `ccd/ccd` (`grep -n 'THE MERGE QUEUE, READ ONCE PER REPOSITORY PER SWEEP' ccd/ccd`), replace the header lines from `# the LAST queue act on its timeline. The spec names` through `# must tell apart from \`unmeasured\`.` with:

```bash
# the LAST queue act on its timeline, and a removal's `reason`. The spec names
# `mergeQueueEntry` and the last `REMOVED_FROM_MERGE_QUEUE_EVENT`; the last act
# of EITHER kind is read instead, so that a PR re-enqueued after a removal reads
# as queued again. The REASON is what tells a landing from a dequeue (landing-
# order wave 3d): GitHub records a removal with reason `merged` at every
# successful queue merge, at or one second before the PR reads MERGED (16 of 16
# queue merges, measured 2026-10-21), so the add is never the last act of a
# landed PR. `reason` is a free-form String with no documented values; the
# exact text `merged` is the one this reads, and any other value, null or a
# type GitHub did not promise keeps the answers this block gave before it.
#
# WHAT IT ANSWERS, per full line, in the additive `queue` field:
#   queued      the PR is OPEN and has a queue entry now
#   dequeued    the PR is OPEN, has no entry, and its last queue act is a removal
#               whose reason is anything but `merged` (null and unknown included)
#   landed      the queue merged it: the last queue act is a removal whose
#               reason is `merged` (the PR may still read OPEN for that second),
#               or the PR is MERGED and its last queue act is the add
#   none        measured, and none of the above — including "this workspace has
#               no bound PR", a PR that never met the queue, a MERGED PR whose
#               last removal had another reason (merged by hand after it), and a
#               CLOSED PR that never merged: it is in neither window, but its own
#               line already says `phase: closed`, and a closed PR is in no queue
#   unmeasured  the call did not answer, or the bound PR is outside both windows
#               and is not closed
# plus `queueAt`, the ISO timestamp of that last act, only when it has one and
# only when it is shaped like a timestamp. The reason only chooses the word: it
# is never printed, so no GitHub text reaches the line. `--session` never makes
# this call and never carries the key: its absence is the OLDER-build answer,
# which a reader must tell apart from `unmeasured`.
```

In `PR_QUEUE_QUERY`, change the one line

```text
    nodes { __typename ... on AddedToMergeQueueEvent { createdAt } ... on RemovedFromMergeQueueEvent { createdAt } }
```

to

```text
    nodes { __typename ... on AddedToMergeQueueEvent { createdAt } ... on RemovedFromMergeQueueEvent { createdAt reason } }
```

Nothing else in the document changes: the open-window line, `$owner`, the `-f` variables and the three tokens the query test pins stay as they are.

In `_pr_queue_py`'s `facts_in`, change the docstring's first line

```python
    """{number: (state, has_entry, last_act, at)}, or None when the call did not
```

to

```python
    """{number: (state, has_entry, last_act, at, why)}, or None when the call did not
```

and replace

```python
            out[num] = (n.get('state'), n.get('mergeQueueEntry') is not None, last.get('__typename'), at)
```

with

```python
            # `why` is the removal's reason, RAW: it is only ever compared with the literal 'merged'.
            out[num] = (n.get('state'), n.get('mergeQueueEntry') is not None, last.get('__typename'), at, last.get('reason'))
```

There is no `isinstance` guard on `why`. Equality with the literal `'merged'` is the whole validation, and a guard no mutation could turn red would break the mutation-table rule.

In `word()`, replace

```python
    state, entry, act, at = f
    if state == 'OPEN' and entry:
        return 'queued', at
    if state == 'OPEN' and act == 'RemovedFromMergeQueueEvent':
```

with

```python
    state, entry, act, at, why = f
    if state == 'OPEN' and entry:
        return 'queued', at
    if state in ('OPEN', 'MERGED') and act == 'RemovedFromMergeQueueEvent' and why == 'merged':
        return 'landed', at
    if state == 'OPEN' and act == 'RemovedFromMergeQueueEvent':
```

The `dequeued`, MERGED-plus-add `landed` and `none` branches below stay as they are. No function is added, so `ccd/contexts.tsv` is unchanged.

- [ ] **Step 4: Restamp and run the tests**

```bash
bash ccd/ccrc restamp ccd/ccd && node shared/mark.mjs --check ccd/ccd && grep -c '^# ccrc:generated' ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue-words.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/mark-check.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-contexts.test.ts)
(cd server && ./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the compaction card')
```

Expected, measured 2026-10-21 at `8ca794742`:
- `restamp: ccd/ccd: restamped`, then `ccd/ccd: ccrc-unmodified`, then `1`.
- `ccd-pr-queue` 31 passed (31); `ccd-pr-queue-words` 3 passed; `ownership` 14; `mark-check` 7; `citations` 4; `ccd-contexts` 10; `pr-timeout-budget` 2; `docs-parity` 54.
- `session-hook -t 'the compaction card'`: `175 passed | 534 skipped (709)`. The census's `'ccd/ccd': 147` is unchanged with the block 12 lines longer.
- The block from the header line through `_pr_queue_py() {` measured 90 lines on `main` and 99 after (`awk '/^# ── THE MERGE QUEUE, READ ONCE/{s=NR} /^_pr_queue_py\(\) \{/{e=NR} END{print e-s+1}' ccd/ccd`); `word()` gains 2 more and `facts_in` 1.

- [ ] **Step 5: Mutations, then commit**

Record each red, then restore `ccd/ccd` byte for byte (`cmp` against a copy taken before the first mutation). Each count is `ccd-pr-queue.test.ts` alone, measured 2026-10-21 at `8ca794742`:
- **M1:** the query fragment loses `reason` (`{ createdAt reason } }` becomes `{ createdAt } }`). Expected: `1 failed | 30 passed (31)`, the query case. The stub answers the same document whatever the query asks, so only that text assertion sees it.
- **M2:** delete the new `landed` branch (both lines). Expected: `2 failed | 29 passed (31)`: (d1) and (d2) (`none` and `dequeued` received).
- **M3:** `why == 'merged'` becomes `why is not None`. Expected: `12 failed | 19 passed (31)`: five of the seven `none` cases (all but `absent` and `null`) and all eight `dequeued` cases but `null`.
- **M4:** the new branch's `state in ('OPEN', 'MERGED')` becomes `state == 'MERGED'`. Expected: `1 failed | 30 passed (31)`: (d2) `landed, never dequeued — still OPEN, …`, the false notice itself.
- **M5:** the new branch moves below the `dequeued` branch. Expected: `1 failed | 30 passed (31)`: (d2).
- **M5b:** the new branch moves above the `queued` branch. Expected: `1 failed | 30 passed (31)`: (d3) `queued — an entry present wins, …`.
- **M6:** `why == 'merged'` becomes `str(why).lower() == 'merged'`. Expected: `2 failed | 29 passed (31)`: the `none` and the `dequeued` case for reason `"MERGED"`. That pins the exact match: unknown text keeps today's answer.
- **M7:** the unpack becomes `state, entry, act, why, at = f`. Expected: `12 failed | 19 passed (31)`: the reasonless `queued` and `dequeued` cases, (d1), (d2) and all eight (e) cases, each through its `queueAt` or its word. The output stage writes `queueAt` from `at` with no ISO re-check (the ISO filter lives only in `facts_in`), so this is the mutation that puts the raw reason on the line: Review Focus 3's first red. Re-measured 2026-10-21 on the prototype with the leak checks.
- **M8:** the reason leaks in a field of its own while every word stays right: in `_pr_queue_py`'s output loop, directly after `v['queue'] = w`, add `v['queueWhy'] = (FACTS or {}).get(v.get('number'), (None,) * 5)[4]`. Expected: `6 failed | 25 passed (31)`: (d2) and the five string-reason (e) cases (`manual`, `failed_checks`, `merge_conflict`, `some_new_reason`, `MERGED`), each through its `not.toContain`. Measured 2026-10-21 on the prototype. Before the leak checks asserted each case's own reason, only `some_new_reason` saw it.

```bash
git add ccd/ccd server/test/ccd-pr-queue.test.ts
git commit -m "fix(pr-state): a removal whose reason is merged reads landed, never dequeued"
```

### Task 2: `PR_QUEUE_MAP` says what `dequeued` and `landed` now mean (prose only)

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `server/src/prstate.ts`, `PR_QUEUE_MAP` and the docstring above it (`grep -n 'const PR_QUEUE_MAP' server/src/prstate.ts`, ≈229 at `8ca794742`).

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. The keys do not change, so `PR_QUEUE_WORDS`, `PrQueue` and `queueFor` are untouched.

- [ ] **Step 1: Edit the glosses**

Replace

```ts
/** The merge-queue vocabulary `ccd pr-state --project` answers in (spec §5.2),
 *  ENUMERATED ONCE — the word list below is derived from it, never re-typed. */
const PR_QUEUE_MAP = {
  queued: 'the PR is open and in the merge queue now',
  dequeued: 'the PR is open, out of the queue, and its last queue act was a removal',
  landed: 'the PR merged and its last queue act was the add: the queue merged it',
```

with

```ts
/** The merge-queue vocabulary `ccd pr-state --project` answers in (spec §5.2),
 *  ENUMERATED ONCE — the word list below is derived from it, never re-typed.
 *  Since landing-order wave 3d a removal's GitHub `reason` chooses between
 *  `dequeued` and `landed` inside ccd, and never reaches the line: `landed`
 *  can name a line whose phase still reads open, for the second before GitHub
 *  reads the PR merged, so no reader may take `landed` to mean phase merged. */
const PR_QUEUE_MAP = {
  queued: 'the PR is open and in the merge queue now',
  dequeued: 'the PR is open, out of the queue, and its last queue act was a removal for any reason but a merge',
  landed: 'the queue merged it: its last queue act was a removal whose reason is merged, or the PR merged and its last queue act was the add',
```

This is prose, and no test reads it. No mutation row applies.

- [ ] **Step 2: Run the readers, then commit**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue-words.test.ts)
(cd server && ./node_modules/.bin/vitest run test/prstate.test.ts)
(cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts)
(cd server && ./node_modules/.bin/vitest run test/landing-verdict.test.ts)
(cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit)
```

Expected, measured 2026-10-21 at `8ca794742`: `ccd-pr-queue-words` 3 passed; `prstate` 65; `pr-queue-lane` 23 (29 once Task 3 is in); `landing-verdict` 28; `tsc` exits 0.

```bash
git add server/src/prstate.ts
git commit -m "docs(prstate): the queue words' glosses say a merged removal is a landing"
```

### Task 3: The `merged` feed row is once per workspace and PR across a restart

**Model routing:** `sonnet`, effort `high`. It changes what an operator sees after every rollout.

**Files:**
- Modify: `server/src/watch.ts`:
  - after `const mergedKey = …` (`grep -n '^const mergedKey' server/src/watch.ts`, ≈789 at `8ca794742`): add `mergedBody`;
  - `mergedNotified`'s docstring, the paragraph starting `IN-MEMORY BY DESIGN, not a gap` (≈936–942);
  - `announceMerged` (`grep -n 'private announceMerged' server/src/watch.ts`, ≈8330): its `body`, a `dedupeKey`, and the tag comment's last paragraph;
  - `sweepMerged` (`grep -n 'private sweepMerged' server/src/watch.ts`, ≈8404): the read before `this.announceMerged(key, r, pr.number, reason);`.
- Test: `server/test/pr-queue-lane.test.ts` (a new describe at the end of the file) and `server/test/pr-sweep.test.ts` (the case `'names the OPEN RUN when nothing is held — and still announces with no coord store to ask'`, and the comment in `'addresses the push at the merged session and collapses on \`merged-<id>#<pr>\`'`).

**Interfaces:**
- Consumes: `CoordStore.hasNotice(kind: string, sessionId: string, dedupeKey: string, legacyBody?: string): boolean` (`server/src/coord/store.ts`), and `pushOne`'s existing optional `dedupeKey`.
- Produces: `mergedBody(number: number | null, reason: string | null): string`, module-private in `watch.ts`. The `merged` feed row now carries `dedupe_key` = the hash of `mergedKey(id, number)`.

- [ ] **Step 1: Write the failing tests**

At the end of `server/test/pr-queue-lane.test.ts`, add:

```ts
// Landing-order wave 3d: the merged lane's feed row is once per (workspace, PR) across a restart, as the queue and
// nudge rows are. The in-memory `mergedNotified` is this process's latch; the archive is every process's. Measured
// 2026-10-21: a server restart wrote a merged PR's `merged` row a second time while its run waited at `merging`.
describe('the merged feed row is once-only across a restart (landing-order wave 3d)', () => {
  const TAG = `merged-${ID}#42`;
  const mergedFeed = (f: Awaited<ReturnType<typeof harness>>) => f.coord.feedEvents(200).filter((e) => e.kind === 'merged');

  it('a restart writes no second merged row and sends no second push', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    f.restart();
    const reads = vi.spyOn(f.coord, 'hasNotice');
    await f.sweep();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
    // The durable hit latches in memory too: one read per process, not one per sweep.
    expect(reads.mock.calls.filter((c) => c[0] === 'merged')).toHaveLength(1);
    f.stop();
  });

  it('the key matches when the body changed across the restart: the run closed, so the reason clause went', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    expect(mergedFeed(f).map((e) => e.body)).toEqual([expect.stringContaining(`run ${f.runId} is still open`)]);
    expect(f.coord.advance(f.runId!, 'failed', 'test').ok).toBe(true);
    f.restart();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });

  it('a row archived before the key, its body unchanged, is matched by that body: no repeat', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    f.coord.db.prepare("UPDATE feed_events SET dedupe_key = NULL WHERE kind = 'merged'").run();
    f.restart();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });

  it('a row archived before the key whose body has changed since is announced ONCE more, at the deploy, then never', async () => {
    // The third repeat by design: the usual merged workspace was a queue landing whose run waited at `merging`, so its
    // pre-key row names the open run; the coordinator closed that run since, so the body the new code builds differs,
    // and the row has no key to match. The repeat writes a keyed row, so the restart after it matches by key.
    const f = await harness(mergedLine());
    await f.sweep();
    f.coord.db.prepare("UPDATE feed_events SET dedupe_key = NULL WHERE kind = 'merged'").run();
    expect(f.coord.advance(f.runId!, 'failed', 'test').ok).toBe(true);
    f.restart();
    await f.sweep();
    expect(mergedFeed(f).map((e) => e.body)).toEqual([
      expect.stringContaining(`run ${f.runId} is still open`), 'PR #42 merged; nothing archived.']);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(2);
    f.restart();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(2);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(2);
    f.stop();
  });

  it('a SECOND PR from the same workspace is a new key: recorded and pushed', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    f.restart();
    await f.sweep(mergedLine({}, 43));
    expect(mergedFeed(f).map((e) => e.body)).toEqual([expect.stringContaining('PR #42 merged'), expect.stringContaining('PR #43 merged')]);
    f.stop();
  });

  it('a durable read that throws announces, as before the read existed, and costs the landing lane nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await harness(mergedLine());
    vi.spyOn(f.coord, 'hasNotice').mockImplementation(() => { throw new Error('database is locked'); });
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    expect(f.mail(), 'the throw cost sweepLanding its sweep').toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^ccrc-server: merged notice read for demo-quiet-basin failed \(database is locked\)/));
    warn.mockRestore();
    f.stop();
  });
});
```

The cases are (a), (b), (c), (c2), (d) and (e) in order. The harness's default run waits at `merging`, so the first row's body names the open run, and the landing lane's `merged:#42` mail is the one `f.mail()` counts. (c) pins a legacy row whose body has not changed; (c2) pins the case a deploy will actually meet, a legacy row whose run has closed since (Pre-flight 7's third repeat): it announces once more, and its repeat is keyed, so a second restart announces nothing.

- [ ] **Step 2: Run them and record the red**

Run: `(cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts)`

Expected on `main`'s `watch.ts`, measured 2026-10-21 at `8ca794742` (re-measured on the prototype with (c2)): `Tests  5 failed | 24 passed (29)`.
- (a), (b) and (c): `expected [ { seq: 1, …(6) }, { seq: 2, …(6) } ] to have a length of 1 but got 2`.
- (c2): `expected [ { seq: 1, …(6) }, …(2) ] to have a length of 2 but got 3`. Its first restart's repeat is the same on `main`; the second restart's third row is what `main` has no key to stop.
- (e): `expected "warn" to be called with arguments: [ StringMatching{…} ]`. Its row, push and mail counts already pass on `main`, which has no read to throw.
- (d) passes. It pins that the key is per PR, which the change must keep.

- [ ] **Step 3: Implement**

In `server/src/watch.ts`, directly after the `mergedKey` line, add:

```ts
/** The merged announcement's body, built in ONE place (landing-order wave 3d): `announceMerged` writes it, and
 *  `sweepMerged`'s durable read matches a row archived before the once-only key existed by exactly this text. */
const mergedBody = (number: number | null, reason: string | null): string => reason === null
  ? `PR #${number ?? '?'} merged; nothing archived.`
  : `PR #${number ?? '?'} merged — ${reason}; nothing archived.`;
```

In `mergedNotified`'s docstring, replace the paragraph

```ts
   * IN-MEMORY BY DESIGN, not a gap: a server restart forgets the latch and
   * may repeat the push, but `announceMerged` tags it `merged-<id>#<number>` —
   * the same key — so the repeat REPLACES that PR's own prior notification
   * rather than stacking a duplicate, while a DIFFERENT PR's announcement,
   * which is a different statement, still stands beside it. The cost of losing
   * this latch on restart is one redundant, silently-replaced notification;
   * persisting it would buy nothing back for that price.
```

with

```ts
   * THIS PROCESS'S LATCH, and a restart forgets it. What stops a restart
   * repeating the announcement is the archive (landing-order wave 3d): the
   * feed row carries this same key, and `sweepMerged` reads it back through
   * `hasNotice` before announcing. The tray tag alone was not enough: it made a
   * repeated push REPLACE that PR's own notification, but every push is also a
   * feed row, and nothing replaced the row. Measured 2026-10-21: a restart
   * wrote a merged PR's `merged` row a second time. Three repeats remain, by
   * design: a row pruned past `FEED_RETENTION` reads as never written; a push
   * the presence gate kept out of the archive wrote no row to find; and a row
   * archived before the key existed is matched only by its exact body, so one
   * whose reason clause changed since (its run closed after it was written)
   * repeats once, at the first sweep after the deploy, and that repeat is keyed.
```

In `announceMerged`, replace

```ts
      body: reason === null
        ? `PR #${number ?? '?'} merged; nothing archived.`
        : `PR #${number ?? '?'} merged — ${reason}; nothing archived.`,
```

with

```ts
      body: mergedBody(number, reason),
      // The once-only key, archived beside the row for `hasNotice` (landing-order wave 3d). It decides nothing here.
      dedupeKey: key,
```

and, in the same call's tag comment, replace

```ts
      // It still collapses where it should: a restart forgets the latch and
      // may repeat ONE PR's push, and that repeat carries this same tag, so
      // it replaces rather than stacks.
```

with

```ts
      // It still collapses where it should: a repeat the archive cannot stop
      // (a row pruned past `FEED_RETENTION`, a push the presence gate kept out
      // of it, or a pre-key row whose body changed since) carries this same
      // tag, so it replaces rather than stacks.
```

In `sweepMerged`, directly before `this.announceMerged(key, r, pr.number, reason);` (after the `reason` ternary ends `: null;`), add:

```ts
      // ONCE ACROSS A RESTART TOO (landing-order wave 3d): the latch above is this process's; the archive is every
      // process's. The key is read first; the body matches a row archived before the key existed. A read that
      // throws announces, as this lane did before the read existed, and never costs `sweepLanding` its sweep: this
      // loop runs inside `sweepPr`'s `try` with no `catch`.
      try {
        if (this.deps.coord?.hasNotice('merged', r.id, key, mergedBody(pr.number, reason)) === true) {
          this.mergedNotified.add(key);
          continue;
        }
      } catch (err) {
        console.warn(`ccrc-server: merged notice read for ${r.id} failed (${err instanceof Error ? err.message : String(err)}); announcing`);
      }
```

The read runs once per merged workspace per process: either branch sets the in-memory latch, so the cost argument above the latch check still holds. `?.` stays: `testDeps` supplies no store.

In `server/test/pr-sweep.test.ts`, case `'names the OPEN RUN when nothing is held — and still announces with no coord store to ask'`, replace its coordless arm

```ts
    const coordless = vi.fn(async (_payload: PushPayload) => {});
    const w2 = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify: coordless } as never }, new Bus(), 10_000);
    await w2.tick();
    await vi.waitFor(() => expect(coordless).toHaveBeenCalledTimes(1));
    expect(coordless.mock.calls[0]![0].body).toBe('PR #42 merged; nothing archived.');
    w2.stop();
```

with

```ts
    const coordless = vi.fn(async (_payload: PushPayload) => {});
    // Landing-order wave 3d: the durable "already told" read is `?.` too. Without it the read would throw here and
    // the lane's catch would still announce, so only the absence of its warning tells the two apart.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w2 = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify: coordless } as never }, new Bus(), 10_000);
    try {
      await w2.tick();
      await vi.waitFor(() => expect(coordless).toHaveBeenCalledTimes(1));
      expect(coordless.mock.calls[0]![0].body).toBe('PR #42 merged; nothing archived.');
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('merged notice read'))).toEqual([]);
    } finally {
      warn.mockRestore();
      w2.stop();
    }
```

and, in `'addresses the push at the merged session and collapses on \`merged-<id>#<pr>\`'`, replace the comment lines

```ts
    // only affordance, deep-linking to /s/<id>. The tag is the other half:
    // `mergedNotified` is in-memory, so a restart may repeat this push, and
    // the tag is what makes that repeat REPLACE the first rather than stack a
    // second identical notification — and why the tag carries the PR NUMBER
    // as well as the id: a workspace can land a second PR now, and an id-only
    // key would let #43's announcement quietly overwrite #42's in the tray.
```

with

```ts
    // only affordance, deep-linking to /s/<id>. The tag is the other half:
    // since landing-order wave 3d a restart repeats this push only where the
    // archive cannot stop it (a row pruned past `FEED_RETENTION`, a push the
    // presence gate kept out of it, or a row archived before the key whose
    // body changed since), and the tag is what makes that repeat
    // REPLACE the first rather than stack a second identical notification —
    // and why the tag carries the PR NUMBER as well as the id: a workspace can
    // land a second PR now, and an id-only key would let #43's announcement
    // quietly overwrite #42's in the tray.
```

The pr-sweep assertions are unchanged except the new warn filter, which passes on `main` (40 passed) and reds only under mutation B4.

- [ ] **Step 4: Run the tests**

```bash
(cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts)
(cd server && ./node_modules/.bin/vitest run test/pr-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/landing-verdict.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
(cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit)
```

Expected, measured 2026-10-21 on the prototype (at `8ca794742` with every task applied, all four packages' modules installed as Global Constraints say): `pr-queue-lane` 29 passed (29); `pr-sweep` 40; `landing-verdict` 28; `single-definition` 824; `citations` 4; `typecheck-tests` 12 passed (12); `tsc` exits 0. A `typecheck-tests` red that names `../agent/src/` or `../pwa/src/` with a missing module (`ws`, `@ccrc/ui`) is the install step skipped, not this task. `pr-sweep` and `typecheck-tests` are known load flakes (`CLAUDE.md`): re-run one alone before calling it a break.

- [ ] **Step 5: Mutations, then commit**

Record each red, then restore `watch.ts` byte for byte (`cmp`). Counts measured 2026-10-21 at `8ca794742`:
- **B1:** delete the whole `try { … } catch (err) { … }` block. Expected: `pr-queue-lane` `5 failed | 24 passed (29)`: (a), (b), (c), (c2) and (e).
- **B2:** delete `dedupeKey: key,`. Expected: `1 failed | 28 passed (29)`: (b). (a) still passes on the body match, which is why (b) exists. (c2) passes too: its repeat's body is the one the next sweep rebuilds, so a body match stops the second restart without the key.
- **B3:** keep the `if`, drop the `try`/`catch` around it. Expected: `1 failed | 28 passed (29)`: (e), `expected [] to have a length of 1 but got +0` (the throw left the sweep before any row was written).
- **B4:** `this.deps.coord?.hasNotice('merged'` becomes `this.deps.coord!.hasNotice('merged'`. Expected: `pr-sweep` `1 failed | 39 passed (40)`: `'names the OPEN RUN when nothing is held — and still announces with no coord store to ask'`, `expected [ Array(1) ] to deeply equal []`.
- **B5:** the read drops its body (`hasNotice('merged', r.id, key)`). Expected: `pr-queue-lane` `1 failed | 28 passed (29)`: (c).
- **B6:** the durable hit's `this.mergedNotified.add(key);` is deleted. Expected: `1 failed | 28 passed (29)`: (a), `expected [ [ 'merged', …(3) ], …(1) ] to have a length of 1 but got 2`.

B1, B2, B3, B5 and B6 were re-measured 2026-10-21 on the prototype with (c2) in; B4 reads `pr-sweep` only and is unchanged.

```bash
git add server/src/watch.ts server/test/pr-queue-lane.test.ts server/test/pr-sweep.test.ts
git commit -m "fix(merged-lane): the merged feed row is once per workspace and PR across a restart"
```

### Task 4: The spec's §5.2 says what wave 3d changed (text only)

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, four edits: two "(Amended 2026-10-21, wave 3d: …)" notes appended to §5.2's query bullet and dequeue bullet (Steps 1 and 2), in the spec's existing "(Amended …)" style; one inline clause inside rollout step 3's existing parenthesis; and one cell of the surfaces table (Step 3). Only the cell rewrites earlier text: it names `hasFeedEvent`, a read that no longer exists (the dequeue row's read is `hasNotice` now, as `sweepLanding`'s docstring says), and the same replacement corrects it.

- [ ] **Step 1: The query bullet**

In the bullet starting `` - `ccd pr-state` gains one GraphQL query per repository per sweep``, replace its last line

```markdown
  the operator 2026-09-29 (§11), and every comment that stated the old bound says 25 s.
```

with

```markdown
  the operator 2026-09-29 (§11), and every comment that stated the old bound says 25 s. (Amended 2026-10-21,
  wave 3d: GitHub records a removal with reason `merged` at every successful queue merge, at or one second before
  the PR reads MERGED, so the add is never a landed PR's last act. The query also reads the removal's `reason`. A
  removal with reason `merged` reads `landed`, whether the PR still reads open or already reads merged; any other
  reason, or none, keeps the answers above. The reason chooses the word and never reaches the line.)
```

- [ ] **Step 2: The dequeue bullet**

In the bullet starting `- A dequeue (GitHub does not re-enqueue after a failed group)`, replace its last line

```markdown
  the coordinator's read-back of the queue entry catches it. (Amended 2026-09-29.)
```

with

```markdown
  the coordinator's read-back of the queue entry catches it. (Amended 2026-09-29.) (Amended 2026-10-21, wave 3d: a
  dequeue is a removal for any reason but `merged`, and `failed_checks`, `manual` and `merge_conflict` were all
  observed. It is announced on the first sweep that reads it. A removal with reason `merged` is the landing: it
  announces nothing, and the `merged:#<n>` mail still comes from the PR's merged phase.)
```

- [ ] **Step 3: Rollout step 3 and the surfaces table**

In rollout step 3, replace

```markdown
   a queue-merged PR reads `none`, not `landed`); measure that gh's enqueue binds `--match-head-commit` (a
```

with

```markdown
   a queue-merged PR reads `none`, not `landed` — measured yes on 2026-10-21, and wave 3d makes that removal read
   `landed`); measure that gh's enqueue binds `--match-head-commit` (a
```

In the surfaces table's row for `server/src/prstate.ts`, `server/src/watch.ts`, …, replace

```markdown
and the merged notice, with two durable "already told" reads (`hasMailWithSubject`, `hasFeedEvent`); the `operator` sender's gloss;
```

with

```markdown
and the merged notice, with two durable "already told" reads (`hasMailWithSubject`, `hasNotice`); the merged lane's `merged` feed record kept once per workspace and PR across a restart while its row is archived (`hasNotice`, wave 3d); the `operator` sender's gloss;
```

- [ ] **Step 4: Check and commit**

```bash
f=docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md
grep -c 'Amended 2026-10-21' "$f"     # expected 2: Steps 1 and 2
grep -c 'wave 3d' "$f"                # expected 4: one line in each of Steps 1 and 2, two in Step 3
grep -c 'hasFeedEvent' "$f"           # expected 0
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts)
(cd server && ./node_modules/.bin/vitest run test/collect-lane-prose.test.ts)
git add "$f"
git commit -m "docs(spec): §5.2 says a merged removal is a landing, and the merged row is once-only"
```

Expected, measured 2026-10-21 at `8ca794742` with Tasks 4 and 5 applied (re-measured on the prototype with this cell): `topology-clean` 60 passed; `docs-policy` 624; `collect-lane-prose` 15. Scan the changed text for private names before pushing.

### Task 5: README's queue paragraph says the same (text only)

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `README.md`, the paragraph that names the five queue words (`grep -n "each line with an additive \`queue\` word" README.md`, ≈4698 at `8ca794742`). The paragraph carries no numeric citation and no test pins its text.

- [ ] **Step 1: Edit the paragraph**

Replace

```markdown
when the read failed or the PR is outside its windows, which costs no row — and `queueAt`. The
landing lane,
```

with

```markdown
when the read failed or the PR is outside its windows, which costs no row — and `queueAt`. GitHub
records a removal with reason `merged` at every successful queue merge, at or a second before the PR
reads merged; that removal reads `landed`, never `dequeued`, and, while the PR is open, a removal for
any other reason, or none, reads `dequeued` on the first sweep that sees it (landing-order wave 3d). The
landing lane,
```

and replace

```markdown
record. Each notice goes out once; a restart repeats neither. `ci.yml` answers `merge_group` and runs
```

with

```markdown
record. Each notice goes out once; a restart repeats neither, and since wave 3d it does not repeat
the merged lane's `✓ merged` feed record either while that record is still in the archive (one written
before wave 3d whose run has closed since is repeated once, at the deploy). `ci.yml` answers
`merge_group` and runs
```

- [ ] **Step 2: Check and commit**

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the compaction card')
(cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts)
(cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts)
(cd server && ./node_modules/.bin/vitest run test/collect-switch-prose.test.ts)
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts)
(cd server && ./node_modules/.bin/vitest run test/stall-settings-prose.test.ts)
(cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/license.test.ts)
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
git add README.md
git commit -m "docs(readme): a merged removal reads landed, and a restart repeats no merged row"
```

Expected, measured 2026-10-21 at `8ca794742` with every task applied (re-measured on the prototype with this README text): `session-hook -t 'the compaction card'` `175 passed | 534 skipped (709)` (README's own lines move; what the census audits is the lines README cites); `box-token-census` 37; `crossrepo-prose` 17; `collect-switch-prose` 9; `child-reclaim-prose` 4; `stall-settings-prose` 15; `coordinator-skill` 169; `license` 25; `topology-clean` 60. Scan the changed text for private names before pushing.

### Task 6: The wave's gate, the PR and the wave-done

**Model routing:** `sonnet`, effort `medium`.

- [ ] **Step 1: The whole wave's owning gates, one file at a time, in the foreground**

- Server:
  - `ccd-pr-queue`, `ccd-pr-queue-words`, `ccd-pr-state`, `ccd-prhistory`, `ccd-contexts`, `pr-timeout-budget`;
  - `pr-queue-lane`, `pr-sweep`, `landing-verdict`, `prstate`;
  - `ownership`, `mark-check`, `citations`, `docs-parity`, `single-definition`, `typecheck-tests`;
  - `topology-clean`, `docs-policy`, `collect-lane-prose`, `box-token-census`, `crossrepo-prose`, `collect-switch-prose`, `child-reclaim-prose`, `stall-settings-prose`, `coordinator-skill`, `license`;
  - `deviation-refs`, after `git fetch origin main`;
  - `session-hook -t 'the compaction card'`.
- Builds: `(cd server && npm run build)`.

The known load flakes are in `CLAUDE.md`. Re-run one alone before calling it a break, and name every re-run. `ccd-pr-state` and `ccd-prhistory` do not read the queue block (their `gh` stub answers the GraphQL call with row JSON, which reads `unmeasured`); they run because the edit is in `ccd/ccd`.

- [ ] **Step 2: Push, open the PR, and report**

Before opening it, list the open PRs that touch `ccd/ccd`. This PR touches it too, so it lands alone, and a stamp conflict on line 2 is resolved as Task order says.

Push the workspace branch and open the PR (`ccd pr-open` or `gh pr create`, as the worker skill says). The body:
- names the two fixes and the pre-flight findings they answer;
- quotes the operator's ruling, "Read the reason", and says it replaces stop rule 6's two-sweep remedy;
- links the ledger's Decisions entry that records that ruling (the one the Prerequisite requires, merged on `main` before this PR opens), by the ledger's GitHub blob URL, `https://github.com/Synapsium-Labs/ccrc-pwa/blob/main/docs/superpowers/programs/landing-order.md`, naming the entry's heading. Never the 2026-10-21 12:15 entry: it records only that the queue stays on;
- names the one repeat the deploy will cause: a `merged` row written before wave 3d whose run has closed since is announced once more at the first sweep after the server box updates (Pre-flight 7);
- says the deploy order: either is safe, the fleet box first by default.

Check the PR's `select tests` summary lists `ccd-pr-queue`, `ccd-pr-queue-words`, `pr-queue-lane` and `pr-sweep`. If one is missing, say so in the wave-done, and the coordinator asks for a `workflow_dispatch` full run.

Send the wave-done with the measured fingerprint, the suite line, every mutation's red (M1–M8 with M5b, B1–B6), which tasks waited on which claim, and every re-run.

**Deploy:** ccrc's updater, from the console, fleet node first. Nobody moves a box by hand. Either order is safe:
- an older server beside the new `ccd` already knows `landed` and says nothing on it;
- an older `ccd` beside the new server keeps today's behaviour, false-notice window included, until the fleet box updates;
- Task 3 takes effect when the server box updates, and needs nothing from the fleet box. Its first sweep there repeats, once, the `merged` row of each PR whose pre-wave-3d row no longer matches by body (Pre-flight 7).

After both boxes run the build, the coordinator takes the live proof, read only:
- the next queue merge of a bound PR reads `merged … landed` (Task 7 (a)'s reading), never `merged … none`;
- no `⤺ dequeued` feed row and no `dequeued:` mail names a PR that then reads merged;
- the deploy's own restart may write one more `merged` row per merged PR whose pre-wave-3d row named a run that has closed since (Pre-flight 7's third repeat); that is by design, and each such PR gets at most one;
- after the restart that follows the deploy's own, no second `merged` row for a PR already announced.

A `merged … none` reading after this deploy means GitHub stopped writing `merged` as the reason. That is the tripwire: today's one-second window is back, and nothing is newly silent.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator, per wave, at that wave's run-open. **A worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail: what departed, where, and why. The coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file.

### Defined at the wave's close (run 751; review 759)

- **D-6213** — `ccd-edit-under-the-holders-consent` (Task 1): `ccd/ccd` was held by another programme's worker when Task 1 was reached. Task 1 was made on this wave's branch under that holder's consent (no line added or removed at or before line 19162) and the coordinator's ruling (the queue block and the restamp only). Measured by review 759: the hunks are the stamp on line 2 and the queue block's header comment, `PR_QUEUE_QUERY`'s removal fragment, `facts_in` and `word()`, nothing else; `mark --check` answers `ccrc-unmodified` with one marker line, and the compaction-card census stays at `'ccd/ccd': 147`.
- **D-6215** — `readme-edit-under-the-holders-consent` (Task 5): `README.md` was held by another programme's worker when Task 5 was reached. Task 5 was made under that holder's consent, for the plan's two replacements only: 8 insertions and 2 deletions, the plan's text verbatim. The README-citing suites (`docs-parity`, `citations`, `readme-holds`, `readme-roster-mirror`, `stall-settings-readme`) passed with unchanged counts, so nothing was re-anchored.
- **D-6216** — `merged-removal-can-trail-the-merge` (Pre-flight 1; review 759 F1): the plan's "at or one second before the PR reads MERGED" is false for one measured merge. Of 22 queue merges on 2026-10-21, 14 recorded the `merged` removal in the merge's second, 7 one second before and 1 one second after (#960). Behaviour is unaffected: in that second the PR reads MERGED with the add as its last act, and the kept MERGED-plus-add arm answers `landed`, so that arm is not dead code. The sentence stands in ccd's queue-block header, the `ccd-pr-queue` comment, the spec's §5.2 amendment, README's queue paragraph and `prstate.ts`'s `landed` gloss; a later wave rewords each to "within a second of the merge, either side" (the ledger's Carried constraints).

Review 759's other findings (a fourth repeat, the pre-wave-3d row's real trigger, a stale `sweepPr` docstring, §5.2's superseded rationale, two reasons missing from the MERGED cases, and an open `landed` that never merges) are all in text this plan prescribes or leaves out, and are carried in the ledger rather than numbered here. The rest of the block, 6214 and 6217 to 6222, was issued and is unused. 6214 is skipped on purpose: another plan on `main` already carries a definition of that number, written before this block was issued, and `deviation-refs` refuses a second subject.
