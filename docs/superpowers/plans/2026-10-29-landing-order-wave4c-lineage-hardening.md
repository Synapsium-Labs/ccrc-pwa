# Landing order, wave 4c — the lineage hardening carried from wave 4's reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close what wave 4's two reviews (runs 1212 and 1216) found and the coordinator carried to this wave. Each item fails closed today or needs a hand-written file; this wave makes the code say exactly what it does.
- **The lineage parser reads only the radar's own shapes.** Today a doc the radar never writes can still accept if it is consistent in itself.
- **The radar files' freshness rule moves to one shared predicate,** so that wave 4b's reader of `probe` and the PWA take the same rule.
- **The dequeue brief prints a recorded head only for a run at `merging`.** Two pins hold behaviour that is right today.
- **The coordinator's opt-in brief can name its base before a PR exists.**

**Why:**
- These items are the ledger's Carried constraints, "From wave 4's reviews (1212 and 1216), carried to wave 4c".
- The carried coordinator-side re-proof of a lineage-bound head is not in this wave (D-7472). It goes to the operator as a decision.
  - Two plan-review passes measured that a git walk in the coordinator's checkout can be redirected by writes that any fleet session can make: replace refs, a graft file, attributes and merge drivers, hooks, a commit-graph file, and the remote's URL. These are the same class of write as the forgery the walk is meant to stop.
  - Making the walk robust needs a design of its own: a scratch repository, a base sha read from GitHub, and a stated stopping line. Where that stopping line sits is a threat-model choice, so it is the operator's to rule.

**Architecture:**
- **L1, `server/src/coord/lineage.ts`.** `parseLineage` gains the radar's remaining shape rules. Its private `freshAt` delegates to the shared predicate.
- **L0, `shared/api.ts`.** `freshWithin(at, freshS, nowMs)` and `FRESH_FUTURE_SKEW_S = 60` are defined beside the landing types. They are pure and import nothing (D-7475).
- **L1, `server/src/coord/landing.ts`.** The dequeue arm of `landingVerdict` reads the run's state before its head, as the merged arm already does. The loop in `watch.ts`'s `sweepLanding` already serves `runState`, so `watch.ts` is unchanged.
- **Skills.** The opt-in paragraph of `ccd/coordinator-skill/references/wave-lifecycle.md` gains the base for a brief written before a PR exists. Its pin moves in the same commit.
- **Out of scope:**
  - the coordinator-side re-proof (D-7472);
  - the radar's console half (wave 4b);
  - the review-cap ask's handling of a `TIP MOVED` report. The ask is the operator's, and the review cap is another programme's (D-6795, D-6910, D-6911), so it is carried to them;
  - #1797's merge-train text, which has its own owner;
  - any change to ccd, the hook, the PWA or the radar.

**Tech Stack:** TypeScript (Node ≥ 22.16), vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §4, the roles;
- §5.4, the lineage table: "fetched base named";
- §7's R5;
- §12's row on hand-edits of `$REG`.

**Other sources:**
- **Wave 4's plan:** `docs/superpowers/plans/2026-10-27-landing-order-wave4-lineage-acceptance.md`. It defines D-7106, D-7108, D-7269 and D-7441.
- **Wave 3b's plan:** `docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md`. Its Design section gives the lineage grammar.
- **The radar:** `ccd/ccd-land-probe`, in `walk_lineage`, `lineage_pass` and `lineage_unmeasured`.
- **The ledger's Carried constraints** for wave 4c.

**Prerequisite:**
- Wave 4 is merged (#1884 `f6b67a5b`).
- Wave 4b dispatches after this wave merges, because it imports `freshWithin`.

**Plan review.**
- Three Opus lenses (spec fidelity, executability, fail-closed) reviewed the first draft, and a Sonnet refuter checked each serious finding. A second Opus pass then reviewed the rewrite.
- Everything that held is answered here:
  - **The re-proof is out (D-7472).** Every pass found a new way to redirect it.
  - **The review-cap ask is out.**
  - **The strict time format is dropped.** It added no reach, and it would have broken three suites' fixtures.
  - **The dequeue cases and the `coord-fingerprint` cases are named.** So is the extra `why` each moved case needs, so that each mutation can go red.
  - **The head-null pin compares with main's text as a literal.**

## What this does not claim

- **The server still accepts on files that any fleet session can write.** That is spec §4's attribution grade, and the parser checks only that a file has a shape the radar writes.
- **A hand-written lineage file of a radar shape can still make an advance answer `verifiedHead`,** and land that head, as wave 4's plan states. Wave 4c narrows the shapes such a file can take; it does not close the path.
- **Closing the path needs a proof outside `$REG`.** That proof is the operator's decision (D-7472).

## Global Constraints

- **Public repository:** use neutral fixtures (`proj-a`, `ws/alpha`, `lane-a-proj-a-alpha`, `o/r`).
- **Fail closed.** An unreadable doc answers `lineage-unmeasured`, detail `lineage-unreadable`, as today.
- **Every shape the radar writes still parses.** `ccd-land-lineage-accept.test.ts`, which runs the shipped probe in fixture HOMEs, stays green, and gains the shapes Task 1 names.
- **What the fingerprint answers for a project with no `enabled` marker is unchanged.**
- **Rings.**
  - `lineage.ts` stays pure: no I/O and no clock. It now imports one value, `freshWithin`, from L0, beside its types.
  - `landing.ts` stays L1.
  - No new file goes under `server/src`.
  - No import is added to `shared/api.ts` (`peers-claims-l0.test.ts`).
- **Single definitions.** `freshWithin` and `FRESH_FUTURE_SKEW_S` are defined once, in `shared/api.ts`. `lineage.ts`'s `freshAt` calls `freshWithin`, so `freshAt` is not a second copy.
- **Skill pins move with their text, in the same commit.**
  - No new skill sentence holds a `"`.
  - The §5b slice pin, and `coordinator-landing-verdict.test.ts`, stay green.
  - The clause counts are unchanged.
- **Running suites.**
  - Run each suite in the foreground, one file per process, with a timeout of at least 600000 ms.
  - Typechecks, and any run that names many files, go through `~/.local/bin/ccrc test -- <command>`.
- **Every new guard has a measured red** (CLAUDE.md, "Mutation-table discipline").
- **Deviation numbers are issued, never chosen.**
  - This plan's block is D-7469 to D-7476. It defines six of them; D-7471 and D-7476 are unused.
  - A departure found while executing it goes in the wave-done mail.

## Review Focus

1. **No radar shape is refused.** Each of these still parses and decides as wave 4 decided it:
   - a failed fetch, with a sha `tip` or a `null` one;
   - a measured walk, for each measured stop;
   - a measured `limit` walk of 8 entries;
   - a `limit` walk of 0 entries, under `CCD_LAND_PROBE_LINEAGE_STEPS=0`;
   - a cut walk (`stop: 'unmeasured'`, with a `why`) of 0, 1 or 7 entries;
   - each of these docs with the millisecond time that today's fixtures write.
2. **Each new rule refuses exactly its own shape.** Every refused case fails one rule and only one, so that dropping that rule turns that case red.
3. **The freshness rule is one.** Each verdict is what it was before the move, at the same boundaries for both the marker and the lineage:
   - 1200 s and 1201 s;
   - 2399 s and 2401 s;
   - 59 s and 61 s ahead;
   - an unparseable time, a non-string time and a missing time.
4. **The dequeue brief never prints a head from an episode the run has left.**
   - A run sent back to `working` and then dequeued gets the brief with no recorded-head line.
   - A run at `merging` gets its episode head.
   - An unreadable run row defers.
5. **The coordinator names a base it can read before a PR exists,** as a ref name.

---

## Design

### `parseLineage`: the radar's shapes (Task 1)

After today's checks, a doc is unreadable unless all of the following hold. Each is a rule the radar's writers already keep (D-7469).

| Rule | The radar's writer that keeps it |
|---|---|
| `branch` is present (and equals the row's branch, as today) | `lineage_unmeasured` and `lineage_pass` both write it |
| A measured doc has no `why` (absent or `null`); an unmeasured one has a non-empty string `why` | `walk_lineage.done` sets `why` only on its unmeasured exits; `lineage_unmeasured` always sets it |
| An unmeasured doc with a `base` has `stop: 'unmeasured'`; one with no `base` has no `stop` and an empty chain | a cut walk runs under a fetched base; a failed fetch writes `base: null, chain: [], stop: null` |
| A chain of `LINEAGE_MAX_CHAIN` (8) entries is `measured`, with `stop: 'limit'` | `walk_lineage` stops with `limit` exactly when the chain reaches its step count, whose maximum is 8 |
| No entry has `p1 === p2`, and no two entries share a `merge` | a first-parent walk of two-parent merges |

- **A short `limit` doc stays readable.** A `limit` doc with fewer than 8 entries is valid, because a box may run the walk with a lower step count (see the `STEPS=0` case in `ccd-land-probe.test.ts`).
- **`at` keeps today's `Date.parse` rule,** now through `freshWithin`.
- **The header is restated to these rules.**

**Every new refused case fails exactly one rule.** So an `unmeasured` case carries a non-empty `why`, and carries `stop: 'unmeasured'` when it has a base. Otherwise, a case written for one rule is also refused by another, and its mutation cannot go red.

**These existing rows change in the commit that adds the rules:**
- **`coord-lineage.test.ts`:**
  - **The 16384-byte size case** pads `why` on a doc with `state: 'unmeasured'` and `stop: 'unmeasured'`. A measured doc may no longer carry a `why`.
  - **The failed-fetch control** "with the keys absent, and no branch key" keeps `branch`. The no-`branch` doc becomes a refused case.
  - **The "radar control"** becomes the refused case `lin({ state: 'unmeasured', why: 'budget', chain: [], stop: null })`. It fails only the base-bearing-unmeasured rule.
- **`coord-fingerprint.test.ts`:** two overrides gain `why: 'budget'`, each doc being `{ state: 'unmeasured', stop: 'unmeasured' }`:
  - "a partly-measured doc without the claim waits; …";
  - "a partly-measured doc accepts a claim its chain does hold (D-7106)".

### The freshness predicate (Task 1)

```ts
// shared/api.ts, beside the landing types
/** A radar file's clock, read as fresh: written at most `freshS` ago and at most FRESH_FUTURE_SKEW_S ahead (D-7475). */
export const FRESH_FUTURE_SKEW_S = 60;
export function freshWithin(at: unknown, freshS: number, nowMs: number): boolean { /* today's freshAt body */ }
```

`lineage.ts`'s `freshAt` becomes `freshWithin`. Its call sites are unchanged, and `FUTURE_SKEW_S` is removed from `lineage.ts`. Wave 4b calls `freshWithin` for `probe` on the server and in the PWA.

### The base before a PR exists (Task 3)

The opt-in paragraph's base sentence gains this: before a PR exists (a first worker brief), `<base>` is the repository's default branch, read as a ref name with `gh repo view <owner/repo> --json defaultBranchRef -q .defaultBranchRef.name` (D-7473).

### The dequeue brief's head (Task 2)

For a named coordinator, `landingVerdict`'s dequeue arm reads `runState` after `told` and before `head` (D-7470):
- an unreadable row defers;
- a run at `merging` reads its episode head, as today;
- a run in any other state delivers with `head` `null`, so the brief prints no recorded-head line.

The merged arm is unchanged. `LandingFacts.runState`'s doc comment, "read for a merge only", becomes "read for a merge, and for a named dequeue".

### The two pins (Task 2)

- **`landing-verdict.test.ts`: the head-null merged brief.**
  - It is `toBe` a literal: the text `renderMergedBrief(ID, 42)` produced at `fc74774b2`. The ledger asks for equality with main's text, and this is that text, copied into the test.
  - It also equals the head brief with its recorded-head line removed.
- **`landing-checks-verdict.test.ts`: a train-landed line with a different head.** A CLOSED line with `landedInTrain: true`, whose head differs from a lineage-accepted episode head, answers `left merged`, as today (D-7474).
  - The checks lane only records the merge.
  - The coordinator's MERGED proof is what refuses a different head: it requires `headRefOid` to equal the recorded head.
  - The case's comment says so.

---

### Task 1: The parser reads only the radar's shapes; one freshness rule

**Files:**
- Modify: `server/src/coord/lineage.ts`, `shared/api.ts`
- Test: `server/test/coord-lineage.test.ts`, `server/test/coord-fingerprint.test.ts`, `server/test/ccd-land-lineage-accept.test.ts`

**Interfaces:**
- Consumes: wave 4's `parseLineage(content, expect, nowMs): LineageRead`.
- Produces:
  - `parseLineage`, with the same signature;
  - from `shared/api.ts`: `freshWithin(at: unknown, freshS: number, nowMs: number): boolean` and `FRESH_FUTURE_SKEW_S`.

- [ ] **Step 1: The failing tests.**
  - **The refused cases.** In `coord-lineage.test.ts`, under a new describe, "the radar's shapes only (wave 4c, D-7469)". Each case is unreadable, and answers `unmeasured` / `lineage-unreadable` through `decideLineage` with the claim in its chain:
    - a measured doc with no `branch` key;
    - a measured doc carrying a `why`;
    - a cut walk (`unmeasured`, sha `base`, `stop: 'unmeasured'`) with no `why`;
    - the moved "radar control" (see Design);
    - an `unmeasured` doc with a `why`, `stop: 'unmeasured'` and 8 entries;
    - an entry with `p1 === p2`;
    - two linked entries with the same `merge` (A → B → A).
  - **The readable controls:**
    - a `limit` doc with 0 entries;
    - a `limit` doc with 8 entries;
    - a cut walk, with a `why`, of 0, 1 and 7 entries;
    - the failed-fetch doc, with its `why`.
  - **The freshness boundaries.** A `freshWithin` table covering Review Focus 3's boundaries.
  - **The changed rows.** Edit the existing rows in both files as the Design says.
- [ ] **Step 2: Run the new cases and see them fail.** From `server/`, run `./node_modules/.bin/vitest run test/coord-lineage.test.ts`.
- [ ] **Step 3: Implement.** Add the rules, and add `freshWithin` and its constant to `shared/api.ts`. Make `freshAt` delegate to it, and restate the header.
- [ ] **Step 4: End to end.**
  - In `ccd-land-lineage-accept.test.ts`, add the probe-produced shapes from Review Focus 1 that the file does not yet produce: the `STEPS=0` `limit`, the 8-entry `limit`, and a budget-cut walk. Each must read as readable through `parseLineage`.
  - Run that file, then `coord-fingerprint`, `run-routes`, `coord-lineage`, `rings/*`, `single-definition/*` and `peers-claims-l0`. See them pass.
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | H1 | drop the `branch` requirement | the no-branch case |
  | H2 | drop the `why` rule | the measured-with-why case and the cut-without-why case |
  | H3 | drop the base-bearing-unmeasured rule | the moved "radar control" |
  | H4 | drop the 8-entries-is-`limit` rule | the 8-entry case |
  | H5 | drop the `p1 === p2` and duplicate-`merge` checks | both cases |
  | H6 | `freshWithin`'s skew 60 → 600 | the 61 s ahead boundary |

- [ ] **Step 6: Commit:** `fix(coord): the lineage parser reads only the radar's shapes; one freshness rule (landing order wave 4c, Task 1)`.

### Task 2: The dequeue head and two pins

**Files:**
- Modify: `server/src/coord/landing.ts`
- Test: `server/test/landing-verdict.test.ts`, `server/test/landing-checks-verdict.test.ts`, `server/test/run-routes.test.ts`

- [ ] **Step 1: The failing tests.**
  - **The dequeue arm.** In `landing-verdict.test.ts`, for a named coordinator, the dequeue arm reads `runState` after `told` and before `head`:
    - `working` delivers with no recorded-head line and no `head` step;
    - `merging` reads the head, as today;
    - an unreadable row defers.
  - **The existing cases.** Each of these gains `runState: { ok: true, state: 'merging' }` in its facts, in this task's commit, as the intended behaviour change:
    - `landing-verdict.test.ts`:
      - "a dequeue that names a coordinator reads the episode head once, after "not told" and before the mail";
      - "open run + coordinator, not yet told: a status mail from the operator AND the feed record";
      - "a removal without a time falls back to the subject per PR, and says so in the record";
      - "the dequeue brief prints the episode head as a value; the merged brief does too".
    - `run-routes.test.ts`: "the dequeue brief and the merged brief each print the recorded head, which is LIVE and not the claim".
  - **The two pins**, as the Design gives them.
- [ ] **Step 2: Run the tests and see the new ones fail.**
- [ ] **Step 3: Implement** the change to `landingVerdict` and its doc comment.
- [ ] **Step 4: Run the tests.** Run the three test files, plus `pr-queue-lane`, `landing-checks-lane`, `merging-episode`, `close-decide` and `coord-health`. See them pass.
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | Q1 | the dequeue arm skips `runState` | the `working` case |
  | Q2 | the head-null merged path adds a word | the literal pin |
  | Q3 | the train arm compares heads first | the train-landed pin |

- [ ] **Step 6: Commit:** `fix(coord): the dequeue brief binds only a merging run's head (landing order wave 4c, Task 2)`.

### Task 3: The base before a PR

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`
- Test: `server/test/coordinator-skill.test.ts`

- [ ] **Step 1: The failing test.**
  - Pin the new base sentence verbatim, after "says nothing of them." and the existing base sentence, in the same contiguous-string pin.
  - Add it to the no-double-quote census.
- [ ] **Step 2: Run the test and see it fail.**
- [ ] **Step 3: Write the sentence.**
- [ ] **Step 4: Run the tests.** Run `coordinator-skill`, `coordinator-landing-verdict`, `docs-parity` and `citations`, and see them pass.
- [ ] **Step 5: Mutation.** Drop the sentence. Expected red: its pin.
- [ ] **Step 6: Commit:** `docs(skills): the base before a PR exists (landing order wave 4c, Task 3)`.

### Task 4: The gate, the PR and the wave-done

- [ ] **Step 1: The gate.**
  - Run every touched file whole, in a fixed order.
  - Run the repo-wide guards:
    - `single-definition/*`, `single-definition-pin` and `rings/*`;
    - `growth-check`, with `GROWTH_CHECK=1` and `origin/main` fetched;
    - `citations`, `anchors` and `docs-parity`;
    - `deviation-refs`, after `git fetch origin main`;
    - `typecheck-tests`, on its own;
    - `topology-clean` and `mail-routes`.
  - Run both `tsc --noEmit` configs through `ccrc test`.
  - No full server suite: the merge queue runs it.
- [ ] **Step 2: The PR and the wave-done.**
  - Title: `fix(coord): the lineage hardening carried from wave 4's reviews (landing order wave 4c)`.
  - The body says what each item closes, and repeats "What this does not claim".
  - Scan the body for private names before posting.

---

## Deviations found

Numbers are ISSUED, never chosen; a worker never calls the allocator (worker clause 11). The programme coordinator minted this plan's block, 7469–7476, before the plan landed. This plan defines six of them; D-7471 and D-7476 are unused. A departure found while executing it is named in the wave-done mail, and the coordinator numbers it.

- **D-7469** — `radar-shapes-only` (Design): spec §5.4 names the accept row's facts, not the file's grammar. The parser now refuses every doc that the radar's writers cannot produce:
  - a doc with no `branch`;
  - a `why` that disagrees with `state`;
  - a base-bearing unmeasured doc without its `stop`;
  - an 8-entry chain that is not `limit`;
  - a repeated `merge`, or a `p1 === p2`.

  A `limit` doc shorter than 8 stays readable, because the step count is a knob. The `branch` rule follows the radar's code, which writes `branch` on every shape, including wave 3b's failed-fetch shape.
- **D-7470** — `dequeue-head-only-when-merging` (Design): the dequeue brief printed the current episode's head whatever the run's state. So a run sent back and later dequeued could be told an earlier episode's head. The head is now read only for a run at `merging`, as the merged arm already requires.
- **D-7472** — `reproof-to-the-operator` (Scope): the ledger carried a coordinator-side re-proof of a lineage-bound head to this wave. It is not in it.
  - **Why not.** Two plan-review passes measured the same weakness. A git walk run in the coordinator's checkout answers for whatever that checkout's state redirects it to, and every fleet session can write that state:
    - replace refs and a graft file;
    - attributes and a merge driver;
    - hooks;
    - a commit-graph file;
    - `remote.origin.url` and `url.<x>.insteadOf`.

    Each is the same class of write as the forgery the walk exists to stop. A robust walk needs a scratch repository over alternates with every config source disabled, a base sha read from GitHub, the PR head's sha checked the same way, and a stated stopping line. For example, a session that rewrites the coordinator's PATH or its `gh` is outside any reader.
  - **Who decides.** Choosing that line is a threat-model decision, which is the operator's. Until the operator rules, wave 4's attribution grade stands, as ruled after review 1212.
- **D-7473** — `base-before-a-pr` (Design): wave 4's base sentence reads `baseRefName` from a PR. A first worker brief is written before one exists, so the repository's default branch, read as a ref name, stands in.
- **D-7474** — `train-landed-head-kept` (Design): a CLOSED, train-landed line answers `left merged` before any head comparison (#1797). That is kept, and pinned against a lineage-accepted episode head. The checks lane only records the merge, and the coordinator's MERGED proof compares the head.
- **D-7475** — `fresh-within-shared` (Architecture): the radar files' freshness rule (`at` at most `freshS` old, and at most 60 s ahead) moves into one pure predicate in `shared/api.ts`. The lineage reader, wave 4b's `probe` reader and the PWA's `landingOf` all take it, not a copy each.

Departures found while executing the plan, and in its review and at its landing (run 1219, the execution block 7486–7495, defined after #1911 merged):

- **D-7486** — `run-routes-fixture-in-task-1` (Task 1): the review-close lineage doc in `run-routes.test.ts` wrote an entry with `p1 === p2`, because its tip and base fixtures are one sha. The new rule refuses that doc, so Task 1 gave it a distinct `p2`, though the plan lists that file under Task 2 only.
- **D-7487** — `lineage-doc-branch-required` (Task 1): `LineageDoc.branch` is a required string, because the parser now guarantees it. Nothing outside `lineage.ts` reads it.
- **D-7488** — `nine-entries-control-limit` (Task 1): the nine-entries case's 8-entry control used `stop: 'not-a-merge'`, which the 8-entries-is-`limit` rule now refuses, so it uses `'limit'`.
- **D-7489** — `chain-needs-a-base-pinned-alone` (Task 1): wave 4 fix round 1's rule that a chain needs a base had lost its only pins, because the new `why` and no-base-no-stop rules refused every case that held it. A new case, the failed-fetch shape beside a chain, fails that rule alone. The legacy cases gained a `why`, and the rule's `stop` half, unreachable now, was removed.
- **D-7490** — `limit-rule-reads-stop-alone` (Task 1): the 8-entry rule reads `stop !== 'limit'` alone, because only a measured doc can say `limit` once the `state` and `stop` rules hold. Its effect is the Design's rule.
- **D-7491** — `extra-cases` (Task 1): cases beyond the plan's list: a `why` of `''` and a non-string `why`; a no-base unmeasured doc with a `stop`; a measured 8-entry walk at `not-a-merge`; `limit` controls of 3 entries and of `why: null`; and, from the shipped probe in `ccd-land-lineage-accept`, a one-entry cut walk and a failed fetch.
- **D-7492** — `gone-row-delivers-headless` (Task 2): a dequeued run whose row is gone reads as any state other than `merging`, so its brief carries no recorded head.
- **D-7493** — `task-2-comments` (Task 2): `LandingFacts.head`'s comment says a dequeue reads it only at `merging`, and the train pin's comment names both answers a head-first compare could give.
- **D-7494** — `duplicate-parent-object` (review 1220, F1): the Design's premise that a first-parent walk of two-parent merges never has `p1 === p2` holds for every commit git's own tools write. It does not hold for a hand-made commit object with two identical parent lines, which the radar's walk accepts. The parser refuses such a doc, so it answers `lineage-unmeasured` and fails closed. The rule stays, and the radar is unchanged.
- **D-7495** — `new-head-for-a-main-red` (landing): two pull-request runs on the accepted tip failed `test (server)` on `main`'s own red, the retire-verdicts test that #1913 fixed (D-7496). A rerun replays a run's original merge commit, and the landing verdict judges every check suite on the head, so the accepted tip could not pass it. The coordinator closed and reopened the PR for a fresh run, twice, because the first reopen raced GitHub's recompute of the merge ref. It then sent the run back once (fix round 1) for one clean merge of `main` and nothing else, reviewed alone, which gave the PR a new head with one green suite. How the verdict reads several suites is carried to wave 5.
