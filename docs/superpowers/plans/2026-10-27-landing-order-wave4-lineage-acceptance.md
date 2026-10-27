# Landing order, wave 4 — a clean merge of main keeps its wave-done and its review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec stage 4. In a project the operator opts in, a claimed tip that a measured base-only merge chain (wave 3b's conflict radar) carries to the live tip is accepted. This covers the done-fingerprint and the review fingerprint. From that point on, the server binds the verified live head wherever it records or compares a landing head.
- When the radar has not yet measured the live tip, the answer is the new `lineage-unmeasured`. It is recorded and mailed under its own subject, and whoever sent the claim re-sends it unchanged after the radar's next tick.
- Every project that is not opted in answers exactly as today.

**Why:** at least 6 of 11 mailed refusals traced to a clean sync of `main` (spec §10's stage 4 row). Today a clean absorption discards a finished review, and a strict-protection repository needs a re-send round per land-sync. Stage 4 removes all three for opted-in projects and changes nothing elsewhere (spec §5.4, §7).

**Architecture:**
- **Pure decisions (L1), in the new `server/src/coord/lineage.ts`:**
  - `parseLineage`, which checks the shape and the chain's own consistency;
  - `parseEnabled`;
  - `decideLineage`, spec §5.4's table as wave 3b's plan states it, plus the qualifying predicate below.
- **One reader (L3, declared in its header), the new `server/src/coord/lineageRead.ts`.** It makes four `readFileMeasured` reads: `enabled`, both pause markers, and `<id>.lineage`. Absent and unreadable stay apart.
- **The two fingerprints take one new step where they answer `stale-tip` / `stale-review` today.**
  1. Decide.
  2. On accept, re-read the live tip, and refuse if it moved.
  3. Continue to the existing PR checks, with `measured.branchTip` set to the live tip and `measured.via = 'base-only-merge'`.
- **The verified head is bound downstream (D-TBD-verified-head).** After an accept:
  - `advanceAct`'s merging episode (`mergingAtDetail`) and the work close's recorded `handoffCommit` take the live tip;
  - `AdvanceOk` gains an optional, additive `verifiedHead` (absent means the claim);
  - the server's landing briefs (`landing.ts`'s `renderDequeueBrief` and `renderMergedBrief`) write the recorded episode head as a value, so a coordinator that ended its turn still has it;
  - every `<handoffCommit>` spelling in `wave-lifecycle.md` §5 names the recorded head: the native-queue enqueue, the spent-producer arm and the MERGED proof.

  Clause 15's own words do not change, because wave 3e's PR edits clause 15.
- **The new refusal word.** `lineage-unmeasured` joins `MAIL_REJECT_CODES` and `DONE_AUTHORITY_CODES`. A derived `DONE_REFUSAL_CODES` (the authority codes without it) is what every refusal count reads, so a radar-timing wait never counts as a refusal (D-TBD-not-a-refusal).
- **Skills.**
  - Worker clause 9 gains its exception. The reviewer's clause 3 gains its matching exception.
  - The coordinator skill names the word, states who re-sends, says how a brief names the opt-in, and never rules on a `TIP MOVED` report.
  - Every pin moves in the same commit as its text.
- **Out of scope:** the radar's console half (spec §5.3's `FleetWatcher` reader, the `landing` wire fields, the PWA chip) is wave 4b (wave 3b's D-4329). No ccd, hook or PWA change.

**Tech Stack:** TypeScript (Node ≥ 22.16), vitest, and wave 3b's `ccd/ccd-land-probe` with its fixture.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.4, all of it;
- §5.5's "pinned to `measured.branchTip`" (stage 5 reads the head this wave binds);
- §7's done-fingerprint and R5 invariants ("the landing binds the verified head");
- §9;
- §10's stage 4 row;
- §12's clause-9 row and its `$REG`-hand-edit row.

**Other sources:**
- Wave 3b's plan, `docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md`, Design section: the formats, the `enabled` trust rule and the stage-4 read table.
- The ledger: row 4, and the carried item "Clause 16's triggers 1–2 are not bounded to before wave-done … stage 4's clause-9 exception closes it".

**Plan review.** Three Opus lenses (spec fidelity, executability, safety) reviewed the first draft, with a Sonnet refuter per serious finding. They found 3 critical and 17 important findings, plus minors, none refuted. The critical one was that an accepted advance would bind the stale claim as the landing head. Every finding is answered below. A second Opus pass confirmed them, and found 3 important and 5 minor problems in the rewrite, which are folded in too.

**Prerequisite:**
- Wave 3b merged and deployed.
- Wave 3e (#1127) merged, because Task 2 edits `wave-lifecycle.md`'s landing paragraph, which wave 3e also edits.

The workspace is a fresh child from `main`. Arming (`lineage=on`) is the operator's, after deploy.

## What this does not claim

`$REG` is writable by every fleet session: one UNIX user, and identity is attribution, not authentication (CLAUDE.md; spec §12: "identity is attribution, and this spec does not claim otherwise"). A session can hand-write an `enabled` marker and a lineage file. Acceptance through them is attribution-grade, like `handoffCommit` itself, which `fingerprint.ts` already calls "CORRESPONDENCE ONLY".

A session that can forge those files can already move its own ref, so stage 4 adds no capability a session lacked. What stage 4 does guarantee:
- a stale or missing marker never accepts;
- a lineage that is inconsistent in itself never accepts;
- a tip that moves between the reads never accepts;
- the PR checks still run on the live head.

`readFileMeasured` follows symlinks, and `FleetIO` has no `lstat`, so wave 3b's "regular file" rule is the probe's own and is not re-proved here (D-TBD-symlink-gap). The PR body says all of this.

## Global Constraints

- **Public repository:** neutral fixtures (`proj-a`, `ws/alpha`, `lane-a-proj-a-alpha`, `o/r`).
- **Fail closed.** Every unreadable, malformed, foreign, stale, inconsistent, non-qualifying or unknown fact answers today's `stale-tip` / `stale-review` or `lineage-unmeasured`, and never accepts.
- **A project with no `enabled` marker answers byte for byte as today.** The existing `coord-fingerprint.test.ts` and `run-routes.test.ts` rows stay green and unedited.
- **No overloaded null at a seam:** `readFileMeasured`, never `readFile`.
- **Rings.**
  - Both new files fall under `coord/**` (C5 Coordination) in the ring-context table of `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, so no new row is needed.
  - `lineage.ts` imports nothing but types; `lineageRead.ts` declares L3 in its header, in `server/test/rings/ring.ts`'s header grammar.
  - No import is added to `shared/api.ts` (`peers-claims-l0.test.ts`).
- **Single definitions.**
  - `LAND_PROBE_ENABLED_FRESH_S = 900` and `LINEAGE_MAX_BYTES = 16384` are defined once, in `lineage.ts`.
  - `lineage-unmeasured` is a member of both arrays. `DONE_REFUSAL_CODES` is derived by `.filter` from `DONE_AUTHORITY_CODES` and defined once in `shared/api.ts` (`core-vocab.test.ts` forbids a hand-typed copy).
  - Each new quoted kebab literal under `server/src/coord` gets its `NOT_CODES` line in `mail-routes.test.ts`, or belongs to a vocabulary.
- **Wire discipline.** `AdvanceOk.verifiedHead?` is additive and optional, and its one reader is the coordinator skill text. `FLEET_PROTO` is untouched.
- **Skill pins move with their text, in the same commit.**
  - Worker clause 9 and `CONTRACT[8]`, with a new whole-line assertion `\n9. ${CONTRACT[8]}\n`.
  - Reviewer clause 3 and its pin, and the reviewer's new re-send sentence.
  - The coordinator census, and the new coordinator sentences.
  - No new clause text holds a `"`, and the clause counts are unchanged.
- **Suites run in the foreground**, one file per process, with a timeout of at least 600000 ms.
- **Repo-wide guards:**
  - `coord-fingerprint`, `run-routes`, `mail-routes`, `run-signals` and `coord-health`;
  - `coordinator-skill`, `worker-skill`, `reviewer-skill` and `stall-verdict`;
  - `single-definition/*`, `single-definition-pin`, `rings/*` and `growth-check`;
  - `citations`, `deviation-refs`, `typecheck-tests` and `topology-clean`.
- **Fixture HOMEs only.** The end-to-end case spawns the probe from a `server/test/ccd*.ts` file under `makeCcdHarness` and `ghContainedEnv(..., {systemd: true, tmux: true, net: true})`.
- **Every commit is green on the guards it touches**, and every guard has a measured red.
- **Deviation numbers come from this wave's block, minted at run-open.** Until then departures are written `D-TBD-<slug>`.

## Review Focus

1. **Nothing but a fresh marker, no pause and a qualifying row reaches the lineage.** The cases:
   - marker absent → today;
   - marker unreadable, malformed, `v` not 1, or a `project` mismatch → today, detail `landing-marker-unreadable`;
   - `at` older than 900 s, or more than 60 s in the future → today, detail `landing-marker-stale`;
   - either pause marker present or unreadable → today;
   - the row does not qualify (no registry record, a branch outside `ws/`, a project mismatch) → today, detail `lineage-not-expected`.
2. **The landing binds the head that was verified.** After an accepted advance to `merging`:
   - the episode's head is the live tip;
   - `landingLineAct` reads `edge` for a PR whose head is the live tip;
   - the advance answer carries `verifiedHead`.

   After an accepted close, the recorded `handoffCommit` is the live tip.
3. **A tip that moved between the reads is refused.** An internally inconsistent chain is unreadable: a chain not linked from `tip` through each `p1`, more than 8 entries, an unknown `stop`, a measured doc with no `base`, or a `branch` other than the resolved one.
4. **`lineage-unmeasured` ends:**
   - its sender re-sends unchanged at most twice, then reports;
   - two identical retries queue one mail;
   - an outstanding `wave-done-rejected` does not swallow it;
   - it never moves `closeRefusals`, `firstSubmission` or the run-health chip.
5. **Skills and server agree.**
   - The worker may push exactly one clean base merge after `wave-done`, in a project its brief names as opted in, and nothing else.
   - The reviewer keeps reading at its tip across that one merge.
   - The coordinator never rules on a `TIP MOVED` report, even when its close was accepted.

---

## Design

### `lineage.ts` (L1)

- **`LineageRead`** is `{ok: true, doc}` or `{ok: false, reason: 'absent' | 'unreadable'}`.
  - The doc is `{tip, base?, state, chain: {merge, p1, p2}[], stop?, branch?}`.
  - It is unreadable when any of these holds:
    - bad JSON, `v` not 1, or more than `LINEAGE_MAX_BYTES`;
    - a `project` or `id` other than expected;
    - any sha that is not 40 lower-case hex;
    - `state` not in `measured | unmeasured`;
    - `state === 'measured'` without a `base` and a `stop`;
    - a `stop` outside wave 3b's words: `not-a-merge`, `second-parent-not-on-base`, `conflict`, `tree-differs`, `unmeasured`, `limit`;
    - `chain.length > 8`;
    - `chain[0].merge !== tip` (when the chain is non-empty);
    - `chain[i].p1 !== chain[i+1].merge` for any `i`;
    - a present `branch` that differs from the expected branch.
  - So wave 3b's fetch-failed doc `{state: 'unmeasured', why, tip, chain: []}` parses.
- **`MarkerRead`** is `'trusted' | 'absent' | 'unreadable' | 'stale'`.
  - `unreadable` covers bad JSON, `v` not 1, and a `project` mismatch.
  - `stale` covers an `at` that does not parse, is older than 900 s, or is more than 60 s in the future.
- **`PauseRead`** is `'running' | 'paused' | 'unknown'`.
- **`decideLineage({claim, live, marker, globalPause, projectPause, qualifies, lineage})`** answers in this order:

  | Input | Answer |
  |---|---|
  | marker `absent` | `today` |
  | marker `unreadable` | `today`, `landing-marker-unreadable` |
  | marker `stale` | `today`, `landing-marker-stale` |
  | either pause `paused` or `unknown` | `today` |
  | `qualifies === false` | `today`, `lineage-not-expected` |
  | lineage `absent` | `unmeasured`, `not-yet-measured` |
  | lineage `unreadable` | `unmeasured`, `lineage-unreadable` |
  | `doc.tip !== live` | `unmeasured`, `older-than-the-live-tip` |
  | `claim` is some `chain[i].p1` | `accept` |
  | `doc.state === 'unmeasured'` | `unmeasured`, `partly-measured` |
  | otherwise | `today` |

  `today` is the caller's existing refusal, its detail extended by ` (<detail>)` when one is given.
- **`qualifies`** restates wave 3b's qualifying row, decided by the caller. All of these must hold:
  - `resolveDoneBranch` found a registry record (empty `provenance`), not the run-row fallback;
  - the resolved branch starts with `ws/`;
  - the record's project equals `run.project`.

### `lineageRead.ts` (L3)

- `readLandingFacts(io, registryDir, project, id, branch, signal?)` makes its four reads concurrently.
- It runs only after `readBranchTip`'s project guard has passed and the id has passed `isRegistryId`.
- For a pause file: `ok` means paused, `absent` means running, and `unreadable` means unknown.
- It never reads `probe` or `main-health`.

### The fingerprint step

- **`verifyDone`, at today's `tip !== claim.branchTip` branch:**
  1. Build `qualifies` from the resolved branch.
  2. Read the facts, then decide.
  3. On `today`, return today's `stale-tip` with its detail. On `unmeasured`, return `lineage-unmeasured` with its detail.
  4. On `accept`, call `readBranchTip` again. A different sha is `stale-tip` with detail `the tip moved between reads`. A `null` is today's `tip-unmeasurable`, never folded into the moved answer.
  5. Then run the PR checks as today, and add `measured.via = 'base-only-merge'` to the ok arm.
- **`verifyReviewDone`** does the same, with `claim.reviewedTip`, today's `stale-review`, and the work run's session, project and branch, which it already resolves.
  - A review of any chain member is accepted, because each step is a clean base merge, which is stage 4's premise (D-TBD-review-any-chain-member).
- **The verified head, after an accept** (`measured.via === 'base-only-merge'`):
  - `advanceAct` builds `mergingAtDetail(verdict.measured.branchTip, …)` and returns `{ok: true, run, verifiedHead: measured.branchTip}`.
  - `closeDecide`'s `decideVerified` carries `measured.branchTip` in its plan, and `closeWorkRun` passes it to `coord.closeRun` as the recorded `handoffCommit` whenever verify ran. An abandon still records `null`.
  - Task 2 Step 1 measures every other site under `server/src/coord` that reads `handoffCommit` as a head (`git grep -n handoffCommit server/src/coord`): the child-spent gate, the `.prhistory` fold and `landing.ts`'s briefs. Each binds the verified head or is shown not to bind one, and the wave-done lists them.
- **The briefs carry the head as a value.** `renderDequeueBrief` and `renderMergedBrief` take the episode head (`coord.currentEpisode(id).head`, which is the live tip after an accept, and the claim otherwise) and print it. Their pins in `merging-episode.test.ts` move in the same commit.
- **The wire field's reader is the coordinator skill text.** The coordinator binds `verifiedHead` when the advance answer carries one, and the head the brief prints otherwise. No TypeScript reader is added.
- **`resolveDoneBranch` also returns the record's project, or `null` on the run-row fallback,** so both verifiers can build `qualifies`. A record with no `.project` reads as its id, and so does not qualify.

### Who re-sends, and the subjects

| Path | Rejected (today) | Unmeasured (new) | Mailed to, and re-sent by |
|---|---|---|---|
| work close (`stopped()`) | `wave-done-rejected` | `wave-done-unmeasured` | the worker, which re-sends its unchanged `wave-done` |
| advance (`advanceAct`) | `wave-advance-rejected` | `wave-advance-unmeasured` | the worker, which re-sends its unchanged `wave-done` |
| review close | `review-done-rejected` | `review-done-unmeasured` | the reviewer, which re-sends its unchanged `review-done` |

- The body is `lineage-unmeasured: <detail> — re-send the same claim, unchanged, after the radar's next tick (at most 5 minutes); after two such answers, report it to your coordinator`.
- **These server mails are the only trigger.** For `lineage-unmeasured`, the coordinator does not send its own `rejected: <code>` mail, which `wave-lifecycle.md` says for every other code. The worker skill names the server's two subjects, and the reviewer skill names its one.
- The re-sent mail passes the ball back to the coordinator, as a `wave-done` already does (`stall.ts`'s `ballToCoordinator`). A `stall-verdict` case pins that, after an unmeasured mail and before the re-send, the ball is with the worker.

### Worker clause 9 (pinned verbatim)

> 9. A done-claim's fingerprint is measured ONCE and sent ONCE: `handoffCommit` must equal the branch tip you measured, and `prPhase` must be one of the eight enum words (`unchecked`, `none`, `no-commits`, `open`, `draft`, `merged`, `closed`, `unknown`). After `wave-done` you stop pushing — a new commit under your own claim makes it stale — and a rejected claim is never re-asserted without new commits and a fresh measurement. The one exception is a project your brief names as opted in to the radar's lineage: there, only when clause 16 licenses the absorption, you may push exactly one merge commit after `wave-done`, made by `git merge` of the brief's radar base with no conflict and no edit, amend or restamp, with nothing after it; your claim stands, and a `lineage-unmeasured` rejection is re-sent unchanged, at most twice, after the radar's next tick.

### Reviewer clause 3's exception (pinned with clause 3)

Appended to clause 3's sentence about a moving ref: "In a project your brief names as opted in to the radar's lineage, a move whose only new commit is a clean merge of the radar base on top of the tip you read is not a move: keep reading at that tip." The reviewer skill's "When something is wrong" bullet `TIP MOVED`, and its prose that says a push after `wave-done` is refused `stale-review`, gain the same qualification. Like every clause, the exception text holds no `"`. The check is spelled out in prose:
- `git rev-list --parents -n 1 <new>` shows two parents, the first of which is the tip read;
- `git merge-base --is-ancestor <second> origin/<base>`;
- `git merge-tree --write-tree` of the two parents equals `<new>^{tree}`.

### Coordinator text (Task 2, with the code)

- **`wave-lifecycle.md`'s `reject.code` table** gains `lineage-unmeasured`: the radar has not measured the live tip; the server has mailed the claim's sender, which re-sends it after the next tick; the coordinator sends no `rejected:` mail for it, and acts only when the sender reports it twice. The review close's refusal list gains it beside `stale-review`.
- **`SKILL.md` step 6:**
  - `lineage-unmeasured` on a review close is never a failed review run;
  - in a project the brief names as opted in, `stale-review` means a push the lineage could not prove clean; everywhere else it means what it means today;
  - a report whose first line is `TIP MOVED` is never ruled on, even when its close was accepted.
- **The landing paragraph and every `<handoffCommit>` spelling in §5:** the head bound is the recorded head: the advance answer's `verifiedHead` when present, and otherwise the head the server's dequeue or merged brief prints. That covers the native-queue enqueue, the spent-producer arm's spelling and the MERGED proof.
- **The brief:** a brief for a project whose `$REG/landing/<project>/enabled` exists names the opt-in and the radar's base.

---

### Task 1: The decisions and the reader

**Files:**
- Create: `server/src/coord/lineage.ts`, `server/src/coord/lineageRead.ts`, `server/test/coord-lineage.test.ts`

**Interfaces:**
- Produces:
  - `parseLineage(content: string, expect: {project: string; id: string; branch: string}): LineageRead`;
  - `parseEnabled(content: string, project: string, nowMs: number): MarkerRead`;
  - `decideLineage(i: LineageInput): LineageDecision`;
  - `readLandingFacts(io: Pick<FleetIO, 'readFileMeasured'>, registryDir: string, project: string, id: string, branch: string, signal?: AbortSignal): Promise<LandingFacts>`;
  - `LAND_PROBE_ENABLED_FRESH_S` and `LINEAGE_MAX_BYTES`.

- [ ] **Step 1: The failing tests.** `coord-lineage.test.ts`:
  - **`decideLineage`:**
    - one `it` per table row, in order;
    - precedence: marker `unreadable` with an accepting lineage still answers `today`, and so does `qualifies === false` with an accepting lineage.
  - **`parseLineage`, unreadable for each of:**
    - bad JSON, `v: 2`, 16385 bytes, a foreign `project` or `id`;
    - an upper-case sha, a 39-character sha, `state: 'done'`;
    - a measured doc with no `base`, an unknown `stop`, nine entries;
    - `chain[0].merge` not the tip, a broken `p1`-to-`merge` link, a `branch` mismatch.
  - **`parseLineage`, readable:** wave 3b's fetch-failed shape, and a valid three-entry chain.
  - **`parseEnabled`:**
    - valid and fresh;
    - 901 s old and 61 s in the future, each `stale`;
    - foreign project and bad JSON, each `unreadable`.
  - **`readLandingFacts`,** over `ioDoubles.ts`'s `absentReadIO` and `degradedReadIO`: absent and unreadable kept apart for each of the four files.
- [ ] **Step 2: Run; see them fail.**
- [ ] **Step 3: Implement both files, with the ring headers.**
- [ ] **Step 4: Run with `rings/*` and `single-definition/*`; see them pass.**
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | D1 | the marker rows after the lineage rows | the marker precedence case |
  | D2 | `unknown` pause reads `running` | the unknown-pause row |
  | D3 | accept without `tip === live` | the older-than row |
  | D4 | `partly-measured` reads `today` | that row |
  | D5 | drop the chain-link check | the broken-link case |
  | D6 | freshness 9000 | the 901 s row |
  | D7 | `qualifies` ignored | the not-expected precedence case |

- [ ] **Step 6: Commit:** `feat(coord): the lineage decision and its reader (landing order wave 4, Task 1)`.

### Task 2: The fingerprints, the verified head, the code, the subjects and the coordinator text

**Files:**
- Modify:
  - `server/src/coord/fingerprint.ts`, `close.ts`, `closeDecide.ts`, `routes.ts`, `store.ts` (the refusal counts read `DONE_REFUSAL_CODES`), plus every head-binding site the Step 1 measure names;
  - `shared/api.ts`: both arrays, `DONE_REFUSAL_CODES`, `AdvanceOk.verifiedHead?`, and the "the eight" docstring count;
  - `server/src/coord/landing.ts` (`renderDequeueBrief`, `renderMergedBrief`) and `server/test/merging-episode.test.ts`;
  - `ccd/coordinator-skill/references/wave-lifecycle.md` and `ccd/coordinator-skill/SKILL.md` (the coordinator text above);
  - the tests: `coord-fingerprint`, `run-routes`, `run-signals`, `mail-routes` (`NOT_CODES`), `stall-verdict` and `coordinator-skill` (the new sentences' pins).
- Create: `server/test/ccd-land-lineage-accept.test.ts`.

**Interfaces:**
- Consumes: Task 1; wave 3b's `ccdLandProbeFixture.ts`.
- Produces:
  - the code `lineage-unmeasured`;
  - `measured.via?: 'base-only-merge'`;
  - `AdvanceOk.verifiedHead?: string`, and the head printed in the two briefs;
  - `DONE_REFUSAL_CODES`;
  - the three subjects.

- [ ] **Step 1: Measure, then the failing tests.**

  First list every `handoffCommit` read under `server/src/coord` that binds a head. Each one becomes a case below or a written exemption.

  **`coord-fingerprint.test.ts`, describe `the opted-in lineage path`.** Files are seeded under `home/.cc-sessions/landing/demo/`, and the registry record is the helper's full record. Each case runs for `verifyDone` and `verifyReviewDone`:
  - every Review Focus 1 row;
  - accept, with `measured.branchTip === LIVE` and `measured.via === 'base-only-merge'`;
  - the tip moved between reads: a stateful `readFileMeasured` answers `LIVE` then `OTHER`, giving `stale-tip`;
  - the run-row fallback, a non-`ws/` branch and a project mismatch, each giving `stale-tip` with `lineage-not-expected`;
  - each wave 3b table row;
  - the existing mismatch table, unedited and green.

  **`run-routes.test.ts`:**
  - an accepted advance to `merging` writes `merging-at:<LIVE>:…`, and answers `verifiedHead: LIVE`;
  - `landingLineAct` reads `edge` for a PR head of `LIVE`;
  - an accepted close records `handoffCommit === LIVE`;
  - after an accepted advance, the dequeue brief and the merged brief each print `LIVE` as the head (`merging-episode.test.ts`);
  - a `null` on the post-accept re-read answers today's `tip-unmeasurable`;
  - an advance's `lineage-unmeasured` is a 409 with `reject.code`, plus one `wave-advance-unmeasured` mail to the worker;
  - a close's carries `error: 'lineage-unmeasured'` and `wave-done-unmeasured`;
  - a review close's carries `review-done-unmeasured`, mailed to the reviewer;
  - two identical retries queue one mail;
  - an outstanding `wave-done-rejected` does not suppress the unmeasured one;
  - a path with no `enabled` marker answers exactly today's bodies.

  **`run-signals.test.ts`:** a run with two `lineage-unmeasured` rows and then an accepted close has `closeRefusals: 0`, `firstSubmission: true`, and a run-health `doneRejects` of 0. Its `waveDoneMails` counts the re-sent `wave-done`s, as declared in D-TBD-not-a-refusal.

  **`stall-verdict.test.ts`:** after `wave-advance-unmeasured` and before the re-send, the ball is with the worker; the re-sent `wave-done` passes it to the coordinator.

  **`coordinator-skill.test.ts`:** the code census goes green once the code is in the skill text, and the four coordinator sentences are pinned verbatim.

  **`ccd-land-lineage-accept.test.ts`,** on `makeLandFixture`:
  - project `proj-a`;
  - a full registry record `lane-a-proj-a-alpha` on `ws/alpha`, written with every field `readRegistryMeasured` reads (the worker reads `registry.ts` for the set);
  - `conf('proj-a', 'lineage=on\n')`, and a `stubGh` answer with one open head;
  - `verifyDone` deps built as `fingerprintDeps` builds them, over the fixture HOME, with a `runnerFor('open')`-style pr-state stub and `RUN = {sessionId: 'lane-a-proj-a-alpha', project: 'proj-a', branch: 'ws/alpha'}`.

  The sequence:
  1. Commit, then `run()` the probe.
  2. `mergeBase('ws/alpha')`, then `run()` again.
  3. `verifyDone` with the claim `T` accepts.

  Then the variants:
  - `handMerge`, `rebaseOnto` and `mergeOther`, each followed by `run()`, each give `stale-tip`;
  - a `mergeBase` with no `run()` after it gives `lineage-unmeasured`;
  - with the conf deleted and one `run()`, the answer is `stale-tip`, as today.
- [ ] **Step 2: Run; see them fail.**
- [ ] **Step 3: Implement.**
  - Add the code to both arrays and derive `DONE_REFUSAL_CODES`.
  - Add the step to both fingerprints.
  - Bind the verified head at every measured site.
  - Branch the three mail sites on the code (`stopped()` takes the subject from the rejection's code).
  - Write the coordinator text.
- [ ] **Step 4: Run the files and the repo-wide guards; see them pass.**
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | F1 | skip the re-read after accept | the tip-moved case |
  | F2 | the review path skips the step | its accept case |
  | F3 | `measured.branchTip` set to the claim | the accept assertion |
  | F4 | one subject for both codes | the dedupe-separation case |
  | F5 | the refusal counts read `DONE_AUTHORITY_CODES` | the run-signals case |
  | F6 | read `enabled` with the collapsing `readFile` | the unreadable-marker row |
  | F7 | `mergingAtDetail(claim.handoffCommit, …)` on the accept arm | the merging-at case, and the `edge` case |
  | F8 | `closeWorkRun` records the plan's claim instead of `measured.branchTip` | the close-records-live case |
  | F10 | the briefs print the claim instead of the episode head | the brief-head case |
  | F9 | `qualifies` read as always true | the fallback, prefix and project cases |

- [ ] **Step 6: Commit:** `feat(coord): an opted-in project's clean main merge keeps its claim and its review, and the landing binds the verified head (landing order wave 4, Task 2)`.

### Task 3: The worker and reviewer skills, and CLAUDE.md

**Files:**
- Modify:
  - `ccd/worker-skill/SKILL.md`: clause 9; the "Then stop pushing (clause 9)" paragraph; a `rejected: lineage-unmeasured` bullet beside `rejected: stale-tip`;
  - `server/test/worker-skill.test.ts`: `CONTRACT[8]`, and the whole-line assertion;
  - `ccd/reviewer-skill/SKILL.md`: clause 3; its "TIP MOVED" bullet; the sentences saying a push after `wave-done` is refused `stale-review`; and a new "When something is wrong" bullet for `review-done-unmeasured`. The bullet says: re-send the same `review-done` mail, unchanged, after the radar's next tick, at most twice, then report. Sending the same mail again is not rewriting the report that clause 7 freezes. All of it is pinned in `server/test/reviewer-skill.test.ts`;
  - `CLAUDE.md`'s done-fingerprint bullet.

- [ ] **Step 1: The failing pins.**
  - `CONTRACT[8]` holds the Design section's clause 9 text verbatim, and `\n9. ${CONTRACT[8]}\n` is in the skill.
  - The reviewer pin holds clause 3 with its exception.
- [ ] **Step 2: Run; see them fail.**
- [ ] **Step 3: Edit the texts.**
  - **"Then stop pushing":** in an opted-in project, the one clean merge clause 9 allows is not a stale-making commit, and anything else still is.
  - **The worker bullet**, keyed on the server's subjects `wave-done-unmeasured` and `wave-advance-unmeasured`: re-send the same `wave-done` after the radar's next tick, at most twice, then report. It is pinned in `worker-skill.test.ts`.
  - **CLAUDE.md's bullet** gains: "For a project whose landing conf opts in (`$REG/landing/<project>/enabled`), the fingerprint also accepts a claimed tip that the conflict radar's lineage carries to the live tip through clean base merges, and the landing then binds that live tip; anything it cannot read answers as before, or `lineage-unmeasured`."
- [ ] **Step 4: Run every skill suite and `citations`; see them pass.**
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | S1 | drop clause 9's exception sentence from the skill only | the whole-line assertion |
  | S2 | drop "with nothing after it" from both copies | a named assertion that the clause holds `exactly one merge commit` and `with nothing after it` |
  | S3 | drop the reviewer exception | the reviewer pin |
  | S4 | drop the reviewer's re-send bullet | its pin |

- [ ] **Step 6: Commit:** `docs(skills): worker clause 9 and reviewer clause 3's stage-4 exceptions (landing order wave 4, Task 3)`.

### Task 4: The gate, the PR and the wave-done; then the deploy and the live proof

- [ ] **Step 1: The gate.** Every touched file runs whole, in a fixed order, with the repo-wide guards. Then the full server suite once, and `agent` and `pwa` in full. A known load flake is re-run in isolation and named.
- [ ] **Step 2: The PR and the wave-done.**
  - Title: `feat(coord): a clean merge of main keeps its wave-done and its review, for opted-in projects (landing order wave 4)`.
  - The body holds the "What this does not claim" paragraph, and states that nothing changes without a fresh `enabled` marker.
  - Scan the body for private names before posting.
- [ ] **Step 3: The deploy and the live proof (the coordinator's, after the merge).**
  - ccrc's updater carries the skills before the server: AGENT-FIRST, because the skills must reach every home before the server answers the new word.
  - **Operator act:** set `lineage=on` in the radar's conf for `ccrc-pwa`.
  - **The live proof is this programme's next work run whose worker absorbs the base cleanly after `wave-done`.** The coordinator's advance with the original claim answers `ok` with `verifiedHead`. It lands with `--match-head-commit <verifiedHead>`, and the run closes once the PR reads MERGED at that head. The ledger records the run, both shas and, if they occur, the `lineage-unmeasured` and its later accept.

---

## Deviations found

Numbers are ISSUED, never chosen; a worker never calls the allocator. Until this wave's block is minted at run-open, departures are written `D-TBD-<slug>`.

- **D-TBD-verified-head** (Architecture): spec §5.4's accept row names only the fingerprint answer. Spec §7's R5 says "the landing binds the verified head", so after an accept the live tip replaces the claim everywhere the server binds a head, and the coordinator learns it from `AdvanceOk.verifiedHead`. Clause 15's own words are unchanged, because wave 3e's PR edits it; the landing paragraph defines the substitution instead.
- **D-TBD-pause-reads-today** (Design): "probe paused for this project → as today" also covers the global pause (wave 3b's D-4326) and an unreadable pause marker.
- **D-TBD-marker-freshness** (Design): the spec's table has no stale row. The marker is trusted for 900 s, so a radar that stopped ticking cannot keep acceptance alive.
- **D-TBD-lineage-not-expected** (Design): a row the probe never measures answers today's refusal rather than `lineage-unmeasured`, so no claim waits for a file that cannot come. The probe's qualifying predicate is restated on the server.
- **D-TBD-partly-measured-accepts** (Design): a claim found in the `chain` of an `unmeasured` lineage is accepted, because each listed step was proven.
- **D-TBD-not-a-refusal** (Architecture): `lineage-unmeasured` is a verdict code, but not a counted refusal. `DONE_REFUSAL_CODES`, derived, keeps it out of `closeRefusals`, `firstSubmission`, run health and the PWA chip, so §10's stage 4 metric ("refusals caused by a clean main sync: 0") is not inflated by radar timing. A re-sent `wave-done` still counts in `waveDoneMails`, because it is a real mail. The run-signals case pins that.
- **D-TBD-review-any-chain-member** (Design): a review of any commit in the chain is accepted. Each step after it is a proven clean base merge, which is stage 4's premise.
- **D-TBD-symlink-gap** (What this does not claim): `readFileMeasured` follows symlinks, and `FleetIO` has no `lstat`, so wave 3b's regular-file rule is not re-proved on the server. That is attribution-grade, like the rest.
- **D-TBD-console-half-is-4b** (Architecture): spec §5.3's server reader, wire fields and PWA chip are wave 4b's.
