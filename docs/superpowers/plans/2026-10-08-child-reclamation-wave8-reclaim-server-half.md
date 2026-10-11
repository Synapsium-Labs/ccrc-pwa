# Child-reclamation wave 8: reclaim's server half — the licence bound to its generation, R61's closure, the readers of wave 7's fields, the stuck class and the persistent tier Implementation Plan

> **For agentic workers:** this plan is dispatched as a wave to a `ccrc-worker` session; follow the `ccrc-worker` skill for the protocol (ack, claims, asks, wave-done). To execute the tasks, REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** child-reclamation (CCR-15), **wave 8 of 9**, run 348. **Deploy class: server.** This wave is server and shared L0 only. It has no ccd, agent or PWA edit, and it reads every ccd field wave 7 added under absence-permits. **It is dispatched only after wave 7 (run 347) has merged** (ruling H1).

**Goal:** Make the reclaim lane license `ws-reclaim` only against the workspace it judged, and say what it sees. After this wave:
- **The licence is bound to the workspace it judged.** A licensed request that waited in the queue can never be spent on a re-minted workspace of the same id. The sweep binds the licence to the row's generation. The executor re-reads that generation before presence, and the audit's generation must match it (X1, R73).
- **The hold-retired memory is generation-keyed** (X3, R74).
- **A removal unplaces a birth only when it is genuine.** It must be a `purge` that is not the row's own unfinished one (R61's closure, R75).
- **The server reads wave 7's fields:**
  - `crumb`;
  - the audit's `resume` on an exit-1 audit;
  - the kept-leaf keys, so the operator hears of a kept leaf even after its row is purged (R76).
- **`containment-refuted` is a `stuck` child.** It is listed at once with ccd's own reason, and shows the chip word `deferred` (R77).
- **Persistent failures are retried on a long tier that never stops,** survives a restart and is never starved (R78).

**Architecture:** five areas, all over `server/src/coord/childReclaim.ts` (L3), `server/src/childReclaimSweep.ts` (L1), `server/src/coord/store.ts`, `server/src/watch.ts` (L4 wiring) and `shared/api.ts` (L0).
1. **L0 (Task 1).** `REG_GENERATION_SHAPE`, the generation types, the attention arms for `stuck` and `leaf-kept`, and `leafKeptWord`, the one classifier shared with workspace-lifecycle.
2. **The generation chain (Tasks 2 to 4).**
   - The sweep's byte-exact read is gathered before the loop.
   - The entry's third key, and `identity-unmeasured` for an unreadable generation.
   - The executor's re-read before presence, the audit key's four arms, and close's `none`.
   - X3's Map.
3. **Births (Task 5).** `lifecycleBirthEventsFor`, and a purge that unplaces a birth only when it is not the row's own.
4. **The readers (Tasks 6 and 7).**
   - The failed arm reads the word first, then `crumb`.
   - The exit-1 audit arm.
   - Kept leaves read from the mirror, and an attention item for a purged row's kept leaf.
5. **The stuck class and the tier (Tasks 8 and 9).**

Then the docs (Task 10) and the whole-branch pass (Task 11).

**Tech Stack:**
- TypeScript (server and shared), vitest 4, Fastify 5;
- `node:sqlite` (CoordStore: new READS only, no migration);
- Node ≥ 22.13.0.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`: §5.5, §5.7, §5.9, §7 and §8. Task 10 writes this wave's text into each.

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`. **§15 (wave 8's pre-flight, R73 to R80) BINDS this plan** and amends §1 to §14. The coordinator's rulings on the task drafts are folded in below, and a ruling wins over any task text it names.

**Programme ledger:** `docs/superpowers/programs/child-reclamation.md`.

**HARD BOUNDARY.** This wave edits only these files:
- `server/src/**`, `server/test/**`;
- `shared/api.ts`;
- `README.md`, for the citation tax a `shared/api.ts` insertion owes, and Task 10's text;
- the spec, and the contract's "§15 as built" note (Task 10).

**It never edits:**
- anything under `ccd/`, `agent/`, `pwa/` or `deploy/`;
- `server/src/coord/schema.ts` (no migration);
- `server/src/deadCoordinator.ts` (workspace-lifecycle's).

It adds no route, no capability token and no composer of a new verb. A step that seems to need anything else STOPS: name it by slug in the wave-done, and build nothing.

---

## Global Constraints

Each line binds every task.

- **Fakes and fixture HOMEs only.** No test reaches a live fleet. Never run `ccd` against the live `$HOME`, never run a destructive verb, and never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`.
- **Rings:**
  - L0 `shared/*.ts` imports nothing;
  - L1 `childReclaimSweep.ts` is pure;
  - L3 adapters never narrow a distinction they received;
  - L4 `watch.ts` wires and never decides;
  - no overloaded null at a seam.
- **Wire:** additive only, absence permits, ONE reader per field, no `FLEET_PROTO` bump.
- **Single definition:** each runtime list derives from its type, and every spelling is pinned once.
- **Clocks (R39):** every decision clock is monotonic. This wave adds no wall-clock decision use.
- **Mutation-table discipline:** every guard ships with a case that goes red when the guard is deleted or mutated, measured before and after.
- **Run vitest in the foreground, from `server/`:** `./node_modules/.bin/vitest run test/<file>`, with a timeout of at least 600000 ms. New cases go in NEW files (R56). Re-run a known load flake in isolation before calling it a break.
- **README's `shared/api.ts:` anchors** are re-pointed BY CONTENT in the commit of each insertion. README edits follow claim 1110's agreement (R80), or wait for that claim to end.
- **No `D-` token in a commit message, and no number range anywhere.** Name a departure by slug; the coordinator assigns its number from run 348's two issued blocks.
- **Branch discipline:** one commit per task, on this workspace's own branch. Absorb `main` only with `git merge`.
- **R23:** code comments and test titles cite the SPEC, never the contract.
- **Locate code by CONTENT.** Line numbers are hints at `226bb881c`, and wave 7's merge has moved them.
- **R56 overlaps (R80):** workspace-lifecycle wave 5 shares `watch.ts`, `close.ts` and `leafKeptWord`. The second lander merges main and re-runs.

## Rulings that amend the task text (binding; the coordinator, 2026-10-08)

The coordinator ruled on the task drafts, and those rulings are ALREADY APPLIED in the task text below. This section is the record of them. Wherever any task text still disagrees with a ruling here, the ruling wins, and the worker names the disagreement by slug in the wave-done.

- **H1 — when this wave dispatches.** This wave is dispatched only AFTER wave 7 (run 347) has merged. Task 0 requires wave 7's tree: the `collect` act, `containment-refuted`, and wave 7's `containment-refuted-word.test.ts` and `ccd-child-reclaim-row-generation.test.ts`.
- **H2 — two types stay in coord.** `ChildReclaimDeferWhy` and `ChildReclaimResume` live in `server/src/coord/childReclaim.ts`, not in L0.
- **H3 — the `stuck` reading belongs to Task 6.** In one commit, Task 6 owns:
  - `'stuck'` in `ChildReclaimResume`;
  - `CHILD_RECLAIM_STUCK_TOKENS` and `isChildReclaimStuckToken`;
  - the parse arm;
  - the kebab admission;
  - the flip of ONLY `parseChildReclaimResult`'s assertion in wave 7's `containment-refuted-word.test.ts`. Its two stale titles may be retitled in that commit.

  Task 8 consumes these, and keeps the F9 re-aim.
- **H4 — the close literal.** Close's request literal carries `licenceGeneration: { kind: 'none' }`. Task 2 sets it, and Task 3 pins its meaning.
- **H5 — the generation read's contract.**
  - `childReclaimGenerationRead` lets a port's rejection propagate.
  - `childReclaimSameGeneration` takes `(entry, bornAt, markerRunId, generation)`.
  - `childReclaimFirstSighting` takes the generation key as its fourth parameter.
- **H6 — the tier state has four fields:** `{tier, tierToken, tierJ, tierRun}`, with `tier` and `tierJ` derived from `tierRun` by `childReclaimTierFrom`.
- **H7 — one shared lane fixture.** A later task reuses an earlier task's lane fixture and never creates a second. Task 3's `server/test/childReclaimGenerationFixture.ts` is THE shared rig. Task 2's file-local rig in `child-reclaim-generation-lane.test.ts` predates it, is not shared, and stays as written. Every task after Task 3 uses Task 3's rig.
- **H8 — the shared word classifier (amended after quiet-river's 4036 and 4045).** ONE word classifier serves two carrier readers.
  - **What is shared.** ONLY the word half: ccd's three words read as themselves, and ANY other value, `null` included, reads `'unmeasured'`. It never answers null (amended after 4045, before dispatch; contract R81). `null` and absence are each carrier's to read, BEFORE it calls the word half.
  - **What each wave keeps.** Each wave keeps its own carrier reader. Workspace-lifecycle's done-document reader answers word | null | `'unreported'`: absence is `'unreported'` and `null` is nothing kept, both asked first. This wave's mirror reader answers `kept:<word>` | `none-or-unreported` | `truncated`, and reads a null value as `none-or-unreported` itself. Neither is ever folded into the other, and neither carrier's answers change with the move.
  - **The expected order.** Workspace-lifecycle wave 5 expects to land first and to own the word half as `keptLeafWord`, exported from `server/src/archivedExpiry.ts`. quiet-river consented in 4036 to this wave MOVING it to a neutral home: a move, never a second copy.
  - **If wave 5 is on the branch.** Task 1 MOVES `keptLeafWord` into `shared/api.ts` as `leafKeptWord`, with `LeafKeptWord` and `LEAF_KEPT_WORDS`, and deletes wave 5's `KEPT_LEAF_WORDS`, `KeptLeafWord` and `keptLeafWord`. In the same commit it re-points every `server/src/archivedExpiry.ts` call site, every type-level spelling (the `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s key type) and `server/test/archived-expiry-policy.test.ts`'s import of the word half (Step 4 (d)).
  - **The STOP rule.** If wave 5's word half answers differently from the shared word half above, Task 1 STOPS and reports `leaf-kept-word-owned-elsewhere`.
  - **If this wave lands first.** It declares `leafKeptWord` in L0, and wave 5's worker imports it. Wave 5's merge of `main` then reds Task 1's census on its private names until wave 5 makes Step 4 (d)'s edits in its own merge commit; quiet-river has the list (the reply to 4045).
- **The accepted departures, each numbered at the fix round:**
  - **Tasks 1 and 2:** `pass-clock-after-gather`, `an-overtaken-gather-decides-nothing`, `leaf-collapse-members-carry-a-run`, `marked-means-marker-reads-as-child`.
  - **Tasks 3 and 4:** `hold-retired-step-in-l1`, `refused-generation-not-carried`, `wave7-generation-pins-owed`.
  - **Task 6:** `failed-tail-extracted-as-export`, `purge-incomplete-resume-read-by-crumb`.
  - **Task 7:** `leaf-kept-yields-to-a-live-item`, `leaf-end-clock-guard`, `leaf-kept-ends-read`, `leaf-kept-feed-row`, `leaf-kept-null-run-stays-single`, `leaf-kept-undated-row-unlisted`, `leaf-kept-feed-memory-unpruned`.
  - **Task 8:** `stuck-outranks-the-verdict-on-the-chip`, `stuck-lists-an-unplaced-line`, `stuck-classifier-injected-into-L1`, `terminal-refusal-reads-the-row-without-detail`.
  - **Task 9:** `tier-uncountable-failure-neutral`, `tier-j-from-run`, `tier-seed-carries-short-run`, `tier-seed-birth-guard`.
- **Text rulings:**
  - **Task 5** rewords `child-birth-unplaced`'s sentence so it is true of a removal journaled after the creation, as well as of a missing dated creation.
  - **Task 6** makes `purge-incomplete`'s feed tail conditional on whether the row's own files still stand.
  - **Task 8**: a stuck child the sweep KEEPS shows no retry clause. Stuck outranks leaf-kept.
- **Rulings after reconciliation:**
  - **`held`.** A stuck child the sweep HOLDS also shows no retry clause. Its sentence says ccrc does not retry it while the hold stands, and that the long backoff resumes once the hold lifts. This extends Task 8's kept rule to holds (R41).
  - **The `purge-incomplete` tail.** Contract R76's "nothing retries it" is amended by Task 10's "§15 as built" note, because Task 6's tail is conditional.
  - **`leafKeptWord` against workspace-lifecycle's file.** H8 above governs, and quiet-river's consent to the move is recorded (4036). Every line of `server/src/archivedExpiry.ts` that spells the three words is re-pointed to L0 in Task 1's commit. That covers `KEPT_LEAF_WORDS`, `KeptLeafWord` and `keptLeafWord` (deleted, because they move), the `ExpireLeafKept` alias, `LEAF_KEPT_WHY`'s key type, `expireLeafKept`'s call and `archived-expiry-policy.test.ts`'s import; wave 5's plan at `f8ec01cc4` (Task 9) shows all of them. Task 1's Step 1 greps for wave 5's names as well as `leafKeptWord`, its census `holders` must end at `['shared/api.ts']`, and its by-name case must find none of wave 5's names outside `shared/api.ts`.
  - **The shared lane rig (H7).** Its spellings are fixed, exactly:
    - `exec`;
    - `journal = (id: string, act: string, outcome: string, over: Readonly<Record<string, unknown>> = {}): void`;
    - `advance = (ms: number): void`;
    - `advanceTo = (m: number): void`;
    - `mono: () => mono`;
    - `now: () => clock`;
    - `entryOf = (id: string) => watcher.currentChildReclaimDefers().get(id)`;
    - and `let uidN = 0;` directly above `export const laneFixture`.

    The first task that needs a piece adds it with exactly that spelling. A later task adds to the returned object only the names that are not already keys of it. A difference in `Readonly` modifiers alone is never a reason to stop.
  - **A void sentence.** Task 7's sentence saying that Task 8 edits inside `childReclaimAttentionWithLeaves` is void: Task 8's kept and held swap lives inside `childReclaimAttentionWithKept`.
- **Counts are measured, never copied.** Every count, red text and wall time a draft marks as measured on a scratch copy is re-measured by the worker. The measured value replaces the draft's, and a different count is not a departure.

## Review Focus (the five failure modes most likely to bite)

1. **A licence is spent on a re-minted workspace.** Pinned by:
   - Task 3's re-mint cases at each point of the request's life;
   - the older-ccd licensed case (`unsupported`);
   - the re-read placed before presence;
   - Task 2's gather-before-loop text pin.
2. **A child goes silent.** An unreadable generation re-sighted for ever, a tier child starved by memory clears, or a kept leaf hidden after its row is purged. Pinned by:
   - Task 2's `identity-unmeasured` case;
   - Task 9's restart and clear cases;
   - Task 7's purged-row item and its `truncated` arm.
3. **R61's closure strands a row its own purge left standing.** Pinned by Task 5's own-purge uuid case and its mutation row.
4. **The feed or chip says something false.** Examples: `refused` on a child later reclaimed, "retried from the start" over a breadcrumb, "resumes" for a purged row, or a retry promised for a kept child. Pinned by:
   - Task 6's exhaustive feed switch;
   - Task 8's chip and precedence cases.
5. **A pacing regression.** A faster pace than today's, two passes interleaving, or a box-level failure entering the tier. Pinned by:
   - Task 9's never-faster and exclusion cases;
   - Task 2's overtaken-gather guard.

## File Structure

Every file this wave touches, taken from each task's own **Files** block, which stays the authority for what the task does there. The table names only files a task edits; files a task merely runs are not listed.

| File | Task(s) |
|---|---|
| `shared/api.ts` | 1 |
| `server/src/archivedExpiry.ts` | 1, only under H8 (workspace-lifecycle's file, with recorded consent) |
| `server/test/archived-expiry-policy.test.ts` | 1, only under H8 (its import of the word half) |
| `server/src/childReclaimSweep.ts` | 2, 4, 5, 7, 8, 9 |
| `server/src/coord/childReclaim.ts` | 2, 3, 4, 5, 6, 7, 8, 9 |
| `server/src/coord/close.ts` | 2, 5 |
| `server/src/watch.ts` | 2, 4, 5, 7, 8, 9 |
| `server/src/coord/store.ts` | 5, 7 |
| `server/test/child-reclaim-generation-shape.test.ts` (new) | 1 |
| `server/test/child-reclaim-attention-arms.test.ts` (new) | 1 |
| `server/test/child-reclaim-generation-key.test.ts` (new) | 2 |
| `server/test/child-reclaim-generation-lane.test.ts` (new) | 2 |
| `server/test/child-reclaim-status.test.ts` | 2, 8 |
| `server/test/child-reclaim.test.ts` | 3, 4 |
| `server/test/ccd-child-reclaim-row-generation.test.ts` | 3 (wave 7's file: two cases flipped, `wave7-generation-pins-owed`) |
| `server/test/childReclaimGenerationFixture.ts` (new) | 3, then 5, 7, 9 (H7) |
| `server/test/child-reclaim-licence-executor.test.ts` (new) | 3 |
| `server/test/child-reclaim-licence-lane.test.ts` (new) | 3 |
| `server/test/child-reclaim-hold-retired-generation.test.ts` (new) | 4 |
| `server/test/child-reclaim-sweep-policy.test.ts` | 5, 8, 9 |
| `server/test/child-reclaim-generation.test.ts` | 5 |
| `server/test/child-reclaim-close.test.ts` | 5 |
| `server/test/child-reclaim-sweep.test.ts` | 5 |
| `server/test/child-reclaim-birth-removal.test.ts` (new) | 5 |
| `server/test/containment-refuted-word.test.ts` | 6 (wave 7's file: one assertion flipped, H3) |
| `server/test/child-reclaim-failed-arm.test.ts` (new) | 6 |
| `server/test/child-reclaim-leaf-kept.test.ts` (new) | 7 |
| `server/test/child-reclaim-leaf-kept-store.test.ts` (new) | 7 |
| `server/test/child-reclaim-leaf-kept-lane.test.ts` (new) | 7 |
| `server/test/child-reclaim-pre-crumb.test.ts` | 8 |
| `server/test/child-reclaim-stuck.test.ts` (new) | 8 |
| `server/test/child-reclaim-persistent-tier.test.ts` (new) | 9 |
| `server/test/child-reclaim-tier-lane.test.ts` (new) | 9 |
| `README.md` | 10 |
| `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | 10 |
| `docs/superpowers/programs/child-reclamation-contract.md` | 10 (the "§15 as built" note only) |

## Execution order and dependencies

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Each task is one commit on the workspace branch.

| Task | Needs | Model routing | Why this place |
|---|---|---|---|
| 0 Entry conditions | — | `sonnet`, medium | Proves wave 7 is in the tree, and every anchor's starting state |
| 1 L0 declarations | 0 | `sonnet`, high | Every later task types against it |
| 2 X1, sweep side | 1 | `opus`, xhigh | The licence's generation and the gather |
| 3 X1, executor side | 2 | `opus`, xhigh | The re-read before presence, and the audit key |
| 4 X3 | 2 | `opus`, high | The Map keyed by generation |
| 5 R75 | 1 | `opus`, high | Births, and the own-purge discriminator |
| 6 Readers: crumb and the audit arm | 1 | `opus`, high | Declares `stuck`, and flips wave 7's pin |
| 7 Kept leaves | 1, 6 | `opus`, high | The mirror reader and the purged-row item |
| 8 The stuck class | 6, 7 | `opus`, high | Attention, precedence and the chip |
| 9 The persistent tier | 6, 8 | `opus`, high | Entry, exit, pace, seeding |
| 10 Docs | 1–9 | `sonnet`, high | The spec text the code comments cite |
| 11 Whole-branch verification and the PR | 0–10 | `sonnet`, high | The wave-done's `suite:` line |

---

### Task 0: Entry conditions

**Model routing:** `sonnet`, effort `medium`.

**Files:** none. Nothing is written by this task.

Measure from the workspace root, before Task 1. If any check does not print what it states, **STOP**: report it to the coordinator, and build nothing.

- [ ] **Step 1: Wave 7 is in the tree (ruling H1)**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD; echo "a0 rc=$?"          # (a0) rc=0; if 1, run `git merge origin/main` once (never a rebase), then re-measure
grep -c '^## 15\. Rulings, 2026-10-08' docs/superpowers/programs/child-reclamation-contract.md   # (a1) 1
grep -c "'containment-refuted'" shared/api.ts                           # (a2) 1 or more: wave 7's word is declared
grep -c "| 'collect'" shared/api.ts                                     # (a3) 1: wave 7's act
ls server/test/containment-refuted-word.test.ts server/test/ccd-child-reclaim-row-generation.test.ts   # (a4) both exist
grep -c '"generation"' ccd/ccd                                          # (a5) 1 or more: the audit prints the generation
```

- [ ] **Step 2: The anchors this wave starts from**

```bash
grep -n '^export type ChildReclaimDeferWhy\|^export type ChildReclaimResume\|^export function parseChildReclaimAudit\|^export function parseChildReclaimResult\|^async function childReclaimOutcome\|^export function childReclaimBornAt' server/src/coord/childReclaim.ts   # six lines
grep -n 'childReclaimHoldRetiredSeen\|^  async sweepChildReclaim(' server/src/watch.ts | head   # the Set, and the sweep
grep -n 'lifecycleCreatesFor' server/src/coord/store.ts server/src/coord/childReclaim.ts server/src/watch.ts   # two callers outside the store
grep -c 'REG_GENERATION_SHAPE\|leafKeptWord\|lifecycleBirthEventsFor\|CHILD_RECLAIM_TIER' shared/api.ts server/src/coord/childReclaim.ts server/src/childReclaimSweep.ts server/src/coord/store.ts   # 0 in each, unless workspace-lifecycle landed leafKeptWord first (H8: adopt it)
```

- [ ] **Step 3: Overlaps (R80)**

```bash
~/.local/bin/ccrc-api claims list --project ccrc-pwa                                  # no live claim on a path this wave edits, or the coordinator's recorded agreement in the brief
git log --oneline origin/main -20 | grep -i 'workspace lifecycle wave 5' || echo "WL wave 5 not landed"   # if it landed, you are the second lander: R56 applies to watch.ts, close.ts and leafKeptWord
```

---

### Task 1: L0 — the generation grammar and its two types, the three new attention arms, and the one kept-leaf classifier

**Model routing:** `sonnet`, effort `high`. Declarations plus two scan pins. The one SAFETY-bearing fact, that the server's grammar is ccd's, is a test written out below.

**Why:** Every `shared/api.ts` declaration this wave needs lands in ONE commit, so the file is touched once (contract R80's line-disjointness agreement; wave 7, whose claim 1113 held this file, has merged before this wave dispatches, H1). The declarations are:
- `REG_GENERATION_SHAPE`, `ChildReclaimGeneration` and `ChildReclaimGenerationKey` (R73(a), R73(b));
- the `stuck` arm (R77), the `leaf-kept` arm and its collapsed line (R76);
- `leafKeptWord`, the ONE kept-leaf classifier shared with workspace lifecycle (R76).

Three facts fix the shape of the edit:
- **Where it goes.** The block is APPENDED at the file's foot, below every anchor README (README.md:4797 cited `:7873-7875`, `:7919`, `:7927` and `:7940` at `226bb881c`; wave 7 re-pointed them by content, so read them from README itself) and the frozen corpus hold. The two edits above (`ChildReclaimAttention`'s doc line pair and its last arm's line) are rewritten in place, line for line. So README owes no re-pointing, and Step 6 PROVES it rather than assuming it. README and `single-definition.test.ts` (claim 1110) are not edited.
- **The pin goes in a new file.** The shape's by-NAME pin goes in a NEW file (R80: "The shape's pin may go in a NEW test file"), beside the test that holds ccd's `_reg_generation_valid` regex text equal to `REG_GENERATION_SHAPE.source` (R73(a)).
- **Measured at planning.** This task was applied to a scratch copy of the export of `226bb881c` (server `node_modules` from an identical lockfile). Every red, count and green below was measured there. Re-measure; a different count is not a departure. `226bb881c` predates wave 7, whose tree this task builds on (H1). Wave 7's `shared/api.ts` insertions (`LifecycleAct`'s `'collect'`, `LIFECYCLE_ACT_MAP`, `LcRefusalToken`, `LC_REFUSAL_WORD`; :7138-:7986 at `226bb881c`) all sit below `ChildReclaimAttention` (:3847) and above the foot, so the two in-place anchors keep their lines and only the foot's line number and README's anchors move.

**NOT in this task (the brief listed these under `shared/api.ts`, but they are not L0 at `226bb881c`):**
- `ChildReclaimDeferWhy` is declared at `server/src/coord/childReclaim.ts:202`, with its table at `:208`. Task 3 adds `'generation-changed'` there, with its sentence and its kind-map pin.
- `ChildReclaimResume` is declared at `:263`. Task 6 adds `'stuck'` there.
- Find both with `grep -n "^export type ChildReclaimDeferWhy\|^export type ChildReclaimResume" server/src/coord/childReclaim.ts`.
- `ChildReclaimJournalRow`'s `detail` is L1 (`server/src/childReclaimSweep.ts`), and belongs to Task 8.

**Files:**
- Modify: `shared/api.ts`:
  - two in-place edits inside `ChildReclaimAttention`, both line-neutral: its doc line pair `There are FOUR arms, told apart by` / `` `kind`: `` (:3796-3797), and its last arm's line (:3855);
  - one block appended after the file's last line (`} as const;` closing `STALL_SECTION_TEXT`, :9549).
- Test (new): `server/test/child-reclaim-generation-shape.test.ts`
- Test (new): `server/test/child-reclaim-attention-arms.test.ts`
- Modify ONLY if workspace-lifecycle wave 5 (run 345) is on this branch with its own word half (Step 1's first H8 grep prints a line naming `KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord` or `EXPIRE_LEAF_WORDS`):
  - `server/src/archivedExpiry.ts`, to delete `KEPT_LEAF_WORDS`, `KeptLeafWord` and `keptLeafWord` (they move here), re-point `expireLeafKept` at `leafKeptWord`, and derive the `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s key type from `LeafKeptWord`;
  - `server/test/archived-expiry-policy.test.ts`, to import the word half from `shared/api.ts` under its L0 name.

  Step 4 (d) quotes each line, from wave 5's plan at `f8ec01cc4` (Task 9). Ruling H8 as amended after 4045, and W8-SEC-1; moved here from Task 7's Step 7, because this task's census case reds on wave 5's private names at this task's own commit.
- Nothing else. No README edit, no `single-definition.test.ts` edit, and no `session-hook.test.ts` census edit: Step 6 proves none is owed. No PWA edit.

**Interfaces:**
- Consumes (at `226bb881c`):
  - `ChildReclaimAttention` (`shared/api.ts:3847`, `grep -n "^export type ChildReclaimAttention =" shared/api.ts`);
  - `ChildReclaimKeptMember { readonly sessionId: string; readonly runId: number }` (:3791);
  - `isChildReclaimKeptWord(v: unknown): v is ChildReclaimKeptWord` (:3787);
  - ccd's `_reg_generation_valid` (`ccd/ccd:3731`, `grep -n '^_reg_generation_valid() {' ccd/ccd`), whose one regex is `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (:3732);
  - `NODE_ID_RE` (`server/src/coord/store.ts:1032`, `grep -n '^export const NODE_ID_RE' server/src/coord/store.ts`), the same text for another concept;
  - test side: `CCD` (`server/test/ccdWsHelpers.ts:24`) and `codeOnly` (`server/test/sourceScan.ts:28`).
- Produces (exact):
  ```ts
  export const REG_GENERATION_SHAPE: RegExp;   // /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, flags ''
  export type ChildReclaimGeneration =
    | { readonly kind: 'value'; readonly v: string } | { readonly kind: 'absent' } | { readonly kind: 'unreadable' };
  export type ChildReclaimGenerationKey = Extract<ChildReclaimGeneration, { readonly kind: 'value' | 'absent' }>;
  export interface ChildReclaimStuckAttention { readonly kind: 'stuck'; readonly sessionId: string; readonly runId: number | null;
    readonly token: string; readonly sentence: string; readonly at: number | null }
  export interface ChildReclaimLeafKeptAttention { readonly kind: 'leaf-kept'; readonly sessionId: string; readonly runId: number | null;
    readonly sentence: string; readonly at: number | null }
  export interface ChildReclaimLeafKeptMany { readonly kind: 'kept-many'; readonly word: 'leaf-kept';
    readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string }
  // ChildReclaimAttention = its four arms | ChildReclaimStuckAttention | ChildReclaimLeafKeptAttention | ChildReclaimLeafKeptMany
  export type LeafKeptWord = 'refused' | 'unmeasured' | 'in-use';
  export const LEAF_KEPT_WORDS: readonly LeafKeptWord[];          // derived from a total table
  export function leafKeptWord(v: unknown): LeafKeptWord;         // a word -> itself; anything else, null included -> 'unmeasured'
  ```
- **The collapsed line's member type is `ChildReclaimKeptMember` (`runId: number`), not `runId: number | null`** (departure `leaf-collapse-members-carry-a-run`).
  - **Measured at planning:** a second `kept-many` arm whose member type differs breaks `pwa/test/child-reclaim-banner.test.tsx:373` and `:429` under the PWA's `tsc` (TS2322, through `Extract<ChildReclaimAttention, { kind: 'kept-many' }>`), and this wave makes no PWA edit.
  - **The reader agrees:** the PWA's reader drops a member whose `runId` is not a number anyway (`pwa/src/fleet/childReclaimWords.ts`, `isKeptMember`).
  - **What Task 7 must do:** keep a kept leaf whose run is unknown as a single `leaf-kept` item, which the PWA renders with a null run. It never collapses one.
- For Task 7 (and workspace lifecycle): no file in `shared`, `server/src`, `pwa/src` or `agent/src` other than `shared/api.ts` may spell all three words on one code line. Index any table by `LeafKeptWord`, or iterate `LEAF_KEPT_WORDS`. If workspace-lifecycle wave 5 is already on this branch with its own word half (`KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord`), THIS task moves it here: it deletes those three, re-points `expireLeafKept` and `archived-expiry-policy.test.ts`, and derives that file's `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s key type from `LeafKeptWord` (Step 4 (d), H8, W8-SEC-1); Task 7 then only verifies.

- [ ] **Step 1: Re-measure the anchors (read-only)**

```bash
grep -n "costs disk rather than correctness. There are FOUR arms, told apart by" shared/api.ts      # one line (3796 at 226bb881c)
grep -n "^      readonly members: readonly ChildReclaimKeptMember\[\]; readonly sentence: string };$" shared/api.ts   # one line (3855)
tail -n 1 shared/api.ts                                                   # } as const;
grep -rn "REG_GENERATION_SHAPE\|ChildReclaimGeneration\b\|ChildReclaimGenerationKey\|leafKeptWord\|LEAF_KEPT_WORDS\|ChildReclaimStuckAttention" shared server/src pwa/src agent/src   # nothing
grep -n '^_reg_generation_valid() {' ccd/ccd                              # one line
grep -c 'shared/api\.ts:[0-9]' README.md                                  # 1
grep -n "  | 'collect'" shared/api.ts                                     # one line: wave 7's act (H1)
grep -c "'containment-refuted'" shared/api.ts                             # 2 or more: wave 7's word and its sentence (H1)
ls server/test/containment-refuted-word.test.ts server/test/ccd-child-reclaim-row-generation.test.ts   # both: wave 7's tests (H1)
grep -n "KEPT_LEAF_WORDS\|KeptLeafWord\|keptLeafWord\|EXPIRE_LEAF_WORDS\|export function expireLeafKept" server/src/archivedExpiry.ts   # (H8) lines naming wave 5's word half only if workspace-lifecycle wave 5 landed first
grep -nE "ExpireLeafKept =|LEAF_KEPT_WHY" server/src/archivedExpiry.ts   # (H8, W8-SEC-1) WL5's two type-level spellings of the three words: lines only if wave 5 landed first
```

STOP rules:
- **`leafKeptWord` already exists.** Workspace lifecycle wave 5 (run 345) may land first, and R76 says whichever wave lands first owns the classifier. If any `grep` line names `leafKeptWord`, DO NOT declare a second copy. Import the existing one, and point Task 1's by-name pin at its home.
  - If its answers differ from this task's table (the three words → themselves; anything else, `null` included → `'unmeasured'`), STOP and report by slug `leaf-kept-word-owned-elsewhere`.
- **Any other count differs.** Report it by slug, and build nothing on a changed anchor.
- **Wave 7's tree (H1).** Wave 7 (run 347) has merged, and Task 0 brought its tree onto this branch. If any of the three wave 7 checks above prints nothing (or `ls` fails), STOP and report `wave7-tree-missing`: Task 0 brought wave 7's tree (H1); no merge mid-wave. Its `shared/api.ts` edits are in `LcRefusalToken`/`LC_REFUSAL_WORD`/`LifecycleAct`, so this task's lines are disjoint from them, and its README re-pointing is already on this branch. Read README's numbers from README itself in Step 6, never from this plan.
- **Workspace-lifecycle wave 5's word half (H8).** If the first `archivedExpiry.ts` grep prints a line naming `KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord` or `EXPIRE_LEAF_WORDS`, wave 5 landed first with its own word half, and this task's census case would red on it at this commit. Step 4 (d) moves it here, in this task's commit. The second H8 grep (W8-SEC-1) prints the `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s declaration. Step 4 (d) derives each from `LeafKeptWord` in the same commit, whether it names `KeptLeafWord` or spells the three words. If the first grep prints only `expireLeafKept`'s line, that function already calls `leafKeptWord`, and `grep -nF "'refused' | 'unmeasured' | 'in-use'" server/src/archivedExpiry.ts` prints nothing, nothing is owed.

- [ ] **Step 2: Write the failing tests**

Create `server/test/child-reclaim-generation-shape.test.ts`:

```ts
// Child-reclamation wave 8 (spec §5.5): the grammar of a registry row's generation, `$REG/<id>.generation`, is
// declared ONCE in L0 as `REG_GENERATION_SHAPE` and held equal to ccd's own `_reg_generation_valid`. Bash cannot
// import TS, so two copies exist by construction; this file is the mechanism that keeps them one
// (`auto-continue-armed.test.ts`'s shape). It reads ccd's TEXT only: no ccd runs here, and no HOME is touched.
//
// The declaration is pinned BY NAME, never by its text: `NODE_ID_RE` (server/src/coord/store.ts) carries the
// identical text for another concept, an update node's id. A text pin would red on it, or invite merging the two.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REG_GENERATION_SHAPE } from '../../shared/api.js';
import { NODE_ID_RE } from '../src/coord/store.js';
import { CCD } from './ccdWsHelpers.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The four roots `single-definition.test.ts` scans, walked as it walks them: `__`-prefixed entries are a parallel
 *  suite's transient mutants, skipped for that file's reason. */
const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
const sources = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  if (e.startsWith('__')) return [];
  const p = path.join(dir, e);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.tsx?$/.test(p) ? [p] : [];
});
const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p);

/** The ONE `=~` regex inside ccd's `_reg_generation_valid`, as written there. */
const ccdGrammar = (): string => {
  const src = readFileSync(CCD, 'utf8');
  const at = src.indexOf('\n_reg_generation_valid() {');
  if (at < 0) throw new Error('_reg_generation_valid not found in ccd/ccd');
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error('_reg_generation_valid has no closing brace');
  const found = [...src.slice(at, end).matchAll(/=~ (\S+) \]\]/g)];
  if (found.length !== 1) throw new Error(`expected one =~ in _reg_generation_valid, found ${found.length}`);
  return found[0]![1]!;
};

const BOM = String.fromCharCode(0xfeff);
const UUID = '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('REG_GENERATION_SHAPE is ccd’s generation grammar (spec §5.5)', () => {
  it('its source is _reg_generation_valid’s regex text, verbatim, and it carries no flag', () => {
    expect(REG_GENERATION_SHAPE.source).toBe(ccdGrammar());
    expect(REG_GENERATION_SHAPE.flags, 'an m flag lets $ match before a newline; a g flag makes .test stateful')
      .toBe('');
  });

  it.each<readonly [string, string, boolean]>([
    ['accepts the 36 lowercase characters', UUID, true],
    ['refuses a trailing LF (ccd’s $ refuses it)', `${UUID}\n`, false],
    ['refuses a leading byte-order mark (a trim would strip it)', `${BOM}${UUID}`, false],
    ['refuses a leading space', ` ${UUID}`, false],
    ['refuses a trailing space', `${UUID} `, false],
    ['refuses a trailing NUL', `${UUID}\0`, false],
    ['refuses upper case', UUID.toUpperCase(), false],
    ['refuses 35 characters', UUID.slice(0, 35), false],
    ['refuses 37 characters', `${UUID}0`, false],
    ['refuses a value with no dashes', UUID.replace(/-/g, ''), false],
    ['refuses the empty string', '', false],
  ])('%s', (_label, v, ok) => {
    expect(REG_GENERATION_SHAPE.test(v)).toBe(ok);
  });

  it('a match is exactly 36 characters', () => {
    expect(UUID).toHaveLength(36);
    expect(REG_GENERATION_SHAPE.test(UUID)).toBe(true);
  });
});

describe('REG_GENERATION_SHAPE is declared once, by NAME (spec §5.5)', () => {
  it('the scan found the four source trees', () => {
    for (const r of ROOTS) expect(sources(r).length, rel(r)).toBeGreaterThan(0);
    expect(ALL.map(rel)).toContain('shared/api.ts');
  });

  it('is declared in shared/api.ts and nowhere else', () => {
    const DECL = /^\s*(?:export\s+)?(?:const|let|var)\s+REG_GENERATION_SHAPE\b/m;
    expect(DECL.test('const REG_GENERATION_SHAPE = /x/;'), 'CONTROL: a local copy is a declaration too').toBe(true);
    expect(ALL.filter((f) => DECL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('NODE_ID_RE stays its own concept: its own declaration, never this name', () => {
    const store = readFileSync(path.join(ccrcRoot, 'server', 'src', 'coord', 'store.ts'), 'utf8');
    expect(store).toMatch(/^export const NODE_ID_RE = \/\^/m);
    expect(store, 'store.ts must not merge NODE_ID_RE into the generation grammar').not.toContain('REG_GENERATION_SHAPE');
    expect(NODE_ID_RE).not.toBe(REG_GENERATION_SHAPE);
  });
});
```

The byte-order mark is built with `String.fromCharCode(0xfeff)` on purpose: an agent's file write decodes a backslash-u escape into the raw character. That was measured while drafting this file, and the row then tested nothing visible. Write `\n` and `\0` exactly as shown. Afterwards, check with `grep -n 'trailing LF (ccd' server/test/child-reclaim-generation-shape.test.ts | cat -A`, which must show a backslash followed by `n`.

Create `server/test/child-reclaim-attention-arms.test.ts`:

```ts
// Child-reclamation wave 8 (spec §5.6, §5.9): the L0 words the reclaim server half adds. `leafKeptWord` is the ONE
// classifier of a kept-leaf value, shared with workspace lifecycle, and three arms join `ChildReclaimAttention`:
// `stuck`, `leaf-kept`, and the kept leaves' collapsed line. These are declarations only: each arm is pinned where
// the lane raises it. The union cases are compile-time facts, so `typecheck-tests.test.ts` is half of this file.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAF_KEPT_WORDS, isChildReclaimKeptWord, leafKeptWord,
  type ChildReclaimAttention, type ChildReclaimGeneration, type ChildReclaimGenerationKey,
} from '../../shared/api.js';
import { codeOnly } from './sourceScan.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
const sources = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  if (e.startsWith('__')) return [];
  const p = path.join(dir, e);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.tsx?$/.test(p) ? [p] : [];
});
const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p);

describe('leafKeptWord, the one kept-leaf classifier (spec §5.6)', () => {
  it('ccd’s three words, derived from one table', () => {
    expect([...LEAF_KEPT_WORDS].sort()).toEqual(['in-use', 'refused', 'unmeasured']);
  });

  it.each<readonly [unknown, string]>([
    ['refused', 'refused'], ['unmeasured', 'unmeasured'], ['in-use', 'in-use'],
    [null, 'unmeasured'], // null is each carrier's to read, never the word half's (H8, after 4045)
    ['kept', 'unmeasured'], ['', 'unmeasured'], ['REFUSED', 'unmeasured'], ['toString', 'unmeasured'],
    [3, 'unmeasured'], [true, 'unmeasured'], [{}, 'unmeasured'], [undefined, 'unmeasured'],
  ])('%j -> %j', (v, word) => {
    expect(leafKeptWord(v)).toBe(word);
  });

  it('is declared once, in shared/api.ts, and no other file spells the three words as a set', () => {
    const DECL = /^\s*(?:export\s+)?(?:function|const|let|var)\s+leafKeptWord\b/m;
    expect(ALL.filter((f) => DECL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    // A second copy of the word list is a second classifier waiting to drift: one CODE line naming all three.
    const SET = (l: string): boolean => ["'refused'", "'unmeasured'", "'in-use'"].every((w) => l.includes(w));
    expect(SET("const W = ['refused', 'unmeasured', 'in-use'];"), 'CONTROL').toBe(true);
    const holders = ALL.filter((f) => codeOnly(readFileSync(f, 'utf8')).split('\n').some(SET)).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
    // H8: workspace lifecycle's word half, by NAME (its list, its word type, its reader), so a copy wrapped over
    // two lines is caught, and so is one the move left behind.
    expect(ALL.filter((f) => /\b(?:EXPIRE_LEAF_WORDS|KEPT_LEAF_WORDS|KeptLeafWord|keptLeafWord)\b/
      .test(codeOnly(readFileSync(f, 'utf8')))).map(rel),
      'a reader of the kept words with its own list').toEqual([]);
  });
});

describe('the three new ChildReclaimAttention arms (spec §5.9)', () => {
  it('each is a member of the union, and the collapsed line’s word is no kept word', () => {
    const items: ChildReclaimAttention[] = [
      { kind: 'stuck', sessionId: 'demo-a', runId: null, token: 'containment-refuted', sentence: 's', at: null },
      { kind: 'leaf-kept', sessionId: 'demo-b', runId: 7, sentence: 's', at: 1 },
      { kind: 'kept-many', word: 'leaf-kept', members: [{ sessionId: 'demo-c', runId: 8 }], sentence: 's' },
    ];
    expect(items.map((a) => a.kind)).toEqual(['stuck', 'leaf-kept', 'kept-many']);
    // The PWA keys a collapsed line by its word: a kept word spelled the same would share a key.
    expect(isChildReclaimKeptWord('leaf-kept')).toBe(false);
  });

  it('a generation key is a read minus `unreadable`', () => {
    const key: ChildReclaimGenerationKey = { kind: 'value', v: '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b' };
    const read: ChildReclaimGeneration = key;
    expect(read.kind).toBe('value');
    // @ts-expect-error an unreadable read is never a key
    const notAKey: ChildReclaimGenerationKey = { kind: 'unreadable' };
    expect(notAKey.kind).toBe('unreadable');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation-shape.test.ts test/child-reclaim-attention-arms.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json 2>&1 | grep 'child-reclaim-\(generation-shape\|attention-arms\)'
```

Expected: FAIL, `Tests  28 failed | 4 passed (32)`. vitest resolves a missing named export to `undefined`, so the failures read:
- `TypeError: Cannot read properties of undefined (reading 'source')`, from the shape's first case;
- `TypeError: Cannot read properties of undefined (reading 'test')`, from every grammar row;
- `TypeError: LEAF_KEPT_WORDS is not iterable`;
- `TypeError: leafKeptWord is not a function`;
- `AssertionError: expected [] to deeply equal [ 'shared/api.ts' ]`, from both by-name pins.

The 4 that pass are:
- `the scan found the four source trees` and `NODE_ID_RE stays its own concept`, which are guards against a later change;
- the two arms cases, which are compile-time facts.

The test `tsc` reports those two arms cases, with ten errors in all:
- TS2305 on `LEAF_KEPT_WORDS`, `leafKeptWord` and `REG_GENERATION_SHAPE`;
- TS2724 on `ChildReclaimGeneration` and `ChildReclaimGenerationKey`;
- TS2322 `Type '"stuck"' is not assignable to type '"failing" | "kept" | "kept-many" | "terminal"'`, and the same for `"leaf-kept"`;
- TS2322 on `runId: null`;
- TS2322 `Type '"leaf-kept"' is not assignable to type 'ChildReclaimKeptWord'`;
- TS2578 `Unused '@ts-expect-error' directive`.

Agent-package `ws` errors, which appear when agent modules are not installed, are not this task's.

- [ ] **Step 4: Write the declarations**

(a) In `shared/api.ts`, inside `ChildReclaimAttention`'s docstring, replace the two lines (in place, two for two):

```ts
 *  costs disk rather than correctness. There are FOUR arms, told apart by
 *  `kind`:
```

with:

```ts
 *  costs disk rather than correctness. The four arms below are told apart by
 *  `kind`, as are the three this file's foot declares (stuck, and kept leaves):
```

(b) Replace the union's last line (in place, one for one):

```ts
      readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string };
```

with:

```ts
      readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string } | ChildReclaimStuckAttention | ChildReclaimLeafKeptAttention | ChildReclaimLeafKeptMany;
```

The line is long on purpose. A wrapped form would add a line above every README and corpus anchor in this file.

(c) Append after the file's last line (`} as const;`), preceded by one empty line:

```ts
/* ── child-workspace reclamation: the reclaim server half (wave 8, spec §5.5, §5.9) ──────────────────────────────
 * APPENDED at the foot, never inserted above: README and the frozen spec and plan corpus cite this file by line, so
 * every declaration below sits under every anchor they hold. The two edits above (`ChildReclaimAttention`'s doc line
 * pair and its last arm's line) are rewritten in place, line for line. */

/** The grammar of a registry row's GENERATION, `$REG/<id>.generation` (spec §5.5): exactly 36 lowercase ASCII UUID
 *  characters and nothing else, so no newline, no byte-order mark and no padding. It is ccd's `_reg_generation_valid`
 *  grammar, and `server/test/child-reclaim-generation-shape.test.ts` holds this `.source` equal to that function's
 *  own regex text. NO FLAGS: an `m` flag would let `$` match before a trailing newline, and a `g` flag would make
 *  `.test` stateful. `NODE_ID_RE` (`server/src/coord/store.ts`) spells the same text for another concept, an update
 *  node's id, and is deliberately not this constant: two concepts never share a name because their text agrees. */
export const REG_GENERATION_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A registry row's generation as ONE read of `$REG/<id>.generation` answered (spec §5.5). Three answers, never
 *  folded:
 *  - `value`: the file holds exactly a `REG_GENERATION_SHAPE` value, and `v` is that content, byte for byte;
 *  - `absent`: a PROVEN ENOENT, and nothing else;
 *  - `unreadable`: everything else, a read that failed or content that is not the grammar.
 *  NOT the lifecycle mirror's generation (`childReclaimGeneration`, `server/src/coord/childReclaim.ts`, which slices
 *  journal rows at a `create`). This is the value ccd mints with the row and binds a reclaim token to. */
export type ChildReclaimGeneration =
  | { readonly kind: 'value'; readonly v: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/** The generation as a KEY (spec §5.5): what the sweep's entry, its hold-retired memory and every sweep request
 *  carry. `unreadable` is never a key: a read that could not say makes the row's identity unmeasured instead. */
export type ChildReclaimGenerationKey = Extract<ChildReclaimGeneration, { readonly kind: 'value' | 'absent' }>;

/** One arm of `ChildReclaimAttention` (spec §5.9): a child whose reclaim ccd PROVED cannot finish as things stand,
 *  `containment-refuted`, because a tree or a registry row the removal would reach is not the child's own. Listed at
 *  once, and retried only on the long, capped persistent tier. `token` is ccd's word, beside the sentence for a
 *  maintainer's grep. `sentence` is the server's and names what to fix. `at` is the journal line's own (ccd's
 *  clock), or null when the line carried none. `runId` is the minting run the marker names, or null when the marker
 *  no longer reads as a child. */
export interface ChildReclaimStuckAttention {
  readonly kind: 'stuck'; readonly sessionId: string; readonly runId: number | null;
  readonly token: string; readonly sentence: string; readonly at: number | null;
}

/** One arm of `ChildReclaimAttention` (spec §5.9): a leaf the reclaim tail KEPT once the act had completed, the
 *  clips directory or the temp root, which ccd's removal helper refused, could not measure, or found in use. The
 *  workspace itself is gone, so this item outlives the registry row. `at` is the journal line's own (ccd's clock),
 *  or null when the line carried none. */
export interface ChildReclaimLeafKeptAttention {
  readonly kind: 'leaf-kept'; readonly sessionId: string; readonly runId: number | null;
  readonly sentence: string; readonly at: number | null;
}

/** One arm of `ChildReclaimAttention` (spec §5.9): many kept-leaf items collapsed into one line, with the sentence
 *  stating the count. It has `kept-many`'s shape and member type, so the PWA's one reader renders it unchanged, under
 *  a `word` that no `ChildReclaimKeptWord` uses, because that reader keys a collapsed line by its word. A member's
 *  `runId` is a number, as the PWA requires of a member (`pwa/src/fleet/childReclaimWords.ts`, `isKeptMember`): a
 *  kept leaf whose run is not known stays a single `leaf-kept` item, which the PWA renders with a null run. */
export interface ChildReclaimLeafKeptMany {
  readonly kind: 'kept-many'; readonly word: 'leaf-kept';
  readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string;
}

/** ccd's words for a leaf the shared reclaim and expire tail KEPT (`clipsKept`, `tmpRootKept`; spec §5.6): `refused`
 *  (its removal helper refused it), `unmeasured` (whether it went could not be measured) and `in-use` (a process
 *  still used it after the bounded wait). Spelled ONCE, as a total table's keys, and the runtime list is derived. */
export type LeafKeptWord = 'refused' | 'unmeasured' | 'in-use';
const LEAF_KEPT_WORD_TABLE: Readonly<Record<LeafKeptWord, true>> = { refused: true, unmeasured: true, 'in-use': true };
export const LEAF_KEPT_WORDS: readonly LeafKeptWord[] = Object.keys(LEAF_KEPT_WORD_TABLE) as LeafKeptWord[];

/** THE WORD HALF: the ONE classifier of a kept-leaf word (spec §5.6), shared by child reclamation and workspace
 *  lifecycle. One of ccd's three words is itself; ANY other value (a string ccd does not print, `null`, a number,
 *  `undefined`) is `unmeasured`, because ccd prints only its three words, so anything else means a leaf stood.
 *  NULL AND ABSENCE ARE NOT ITS QUESTION. Each carrier asks them BEFORE it calls this, because the two wires give
 *  them two meanings: on a stdout document a missing key is an older ccd (`unreported`) and `null` is nothing
 *  kept, while the mirror's meas has already folded a missing key into `null`, which reads "nothing kept, or not
 *  reported". */
export function leafKeptWord(v: unknown): LeafKeptWord {
  return typeof v === 'string' && (LEAF_KEPT_WORDS as readonly string[]).includes(v) ? v as LeafKeptWord : 'unmeasured';
}
```

The block is L0: it imports nothing, and `ChildReclaimKeptMember` is declared above it in the same file. TypeScript resolves type names declared later in a file, so (b)'s forward references compile.

(d) ONLY if Step 1's first H8 grep printed a line naming `KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord` or `EXPIRE_LEAF_WORDS`, or its second printed an `ExpireLeafKept =` or `LEAF_KEPT_WHY` line that names `KeptLeafWord` or spells the three words (ruling H8 as amended after 4045, W8-SEC-1; this was Task 7's Step 7). Workspace-lifecycle wave 5 landed first, and this commit MOVES its word half to L0 (quiet-river's consent, 4036 and 4045): a move, never a copy. Wave 5's plan at `f8ec01cc4` (Task 9) writes the lines quoted below. Make each bullet whose line is there, exactly as quoted.

In `server/src/archivedExpiry.ts`:
- delete `const KEPT_LEAF_WORDS = ['refused', 'unmeasured', 'in-use'] as const;`;
- delete `export type KeptLeafWord = typeof KEPT_LEAF_WORDS[number];` and the one-line docstring above it (`/** ccd's three words for a leaf it kept. */`);
- delete `export function keptLeafWord(v: unknown): KeptLeafWord {`, its one-line body, its closing brace and the docstring above it (`/** THE WORD HALF: …`);
- replace `export type ExpireLeafKept = KeptLeafWord | null | 'unreported';` with `export type ExpireLeafKept = LeafKeptWord | null | 'unreported';`;
- replace `const LEAF_KEPT_WHY: Readonly<Record<KeptLeafWord, string>> = {` with `const LEAF_KEPT_WHY: Readonly<Record<LeafKeptWord, string>> = {`;
- in `expireLeafKept`, replace `  return v === null ? null : keptLeafWord(v);` with `  return v === null ? null : leafKeptWord(v);`;
- in the docstrings of `ExpireLeafKept` and `expireLeafKept`, write `leafKeptWord` (`shared/api.ts`) wherever they name `keptLeafWord`;
- add `leafKeptWord, type LeafKeptWord` to the file's `../../shared/api.js` import.

In `server/test/archived-expiry-policy.test.ts`:
- remove `keptLeafWord, ` from the `../src/archivedExpiry.js` import;
- import `leafKeptWord` from `../../shared/api.js`, in the file's existing import from it if it has one;
- rename every other `keptLeafWord` in the file to `leafKeptWord`. Its word-half case then pins the shared classifier, with `null` among its `'unmeasured'` values, unchanged.

If wave 5 merged the earlier draft's shape instead (`30b841c01`: a private `EXPIRE_LEAF_WORDS` list, and the alias and `LEAF_KEPT_WHY`'s key type spelled as the three quoted words), delete that list, derive the alias and the key type from `LeafKeptWord` the same way, and make `expireLeafKept` ask absence (`'unreported'`) and then `null` (`null`) before it returns `leafKeptWord(v)`.

Whatever shape landed, the end state is the same:
- no file under `shared`, `server/src`, `pwa/src` or `agent/src` other than `shared/api.ts` names `KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord` or `EXPIRE_LEAF_WORDS` in code, or spells the three words on one code line (Task 1's census case);
- `expireLeafKept` asks absence and then `null` before it calls `leafKeptWord`;
- wave 5's three test files pass with the counts it left (Step 5).

Every answer is unchanged. `expireLeafKept`'s carrier still asks absence, then `null`, and the word half it calls answers exactly as wave 5's did: the three words → themselves, any other value → `'unmeasured'`. The two type edits change no answer either: `LeafKeptWord` is the same three words, so `ExpireLeafKept` is the same union and `LEAF_KEPT_WHY` keeps its three keys (its `LEAF_KEPT_WHY[w]` index, narrowed past `null` and `'unreported'`, still type-checks, which Step 5's `tsc` shows).

STOP rules:
- If wave 5's word half answers differently from Task 1's table, STOP and report `leaf-kept-word-owned-elsewhere`.
- If its lines differ from the ones quoted here but its answers agree, re-point by the end state above, and name the difference by slug `wl5-word-half-shape-differs` in the wave-done.

Tell quiet-river in the wave-done which lines moved. Task 7's Step 0 (e) then prints `expireLeafKept`'s lines, the docstring lines that now name `leafKeptWord`, and the line of the `../../shared/api.js` import that now names `leafKeptWord`, but no line naming `KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord` or `EXPIRE_LEAF_WORDS`, and Task 7 only verifies.

- [ ] **Step 5: Run the tests, both type-checks, and the neighbours**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation-shape.test.ts test/child-reclaim-attention-arms.test.ts \
  test/child-reclaim-sweep.test.ts test/child-reclaim-sweep-policy.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd pwa && npm ci && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected:
- The first command: `Test Files  4 passed (4)`; the two new files hold `32 passed`. Measured: `397 passed (397)` in all.
- Both server `tsc` runs and the PWA `tsc` print nothing and exit 0.
  - The PWA check is the reason the collapsed line's members are `ChildReclaimKeptMember`. With `runId: number | null` members, `pwa/test/child-reclaim-banner.test.tsx` reds TS2322 at its `keptMany` builder.
- `single-definition` is exactly as green as at the base. Run it on the base first if anything is red: in the planning scratch export one LiteLLM case was red at the base itself, so it is not this task's.
- `typecheck-tests` is a known load flake: re-run it in isolation before calling it red.
- Only when Step 4 (d) ran: `( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts test/expire-archived.test.ts test/archived-expiry-lane.test.ts )` is green, with the counts workspace-lifecycle wave 5 left (H8). Then `grep -nF "'refused' | 'unmeasured' | 'in-use'" server/src/archivedExpiry.ts` prints nothing (W8-SEC-1), and so does `grep -n "KEPT_LEAF_WORDS\|KeptLeafWord\|keptLeafWord\|EXPIRE_LEAF_WORDS" server/src/archivedExpiry.ts server/test/archived-expiry-policy.test.ts`.
- Whatever landed first, the census case's `holders` is `['shared/api.ts']`: a red here naming `server/src/archivedExpiry.ts` is a type-level spelling Step 4 (d) missed, never a reason to widen the census.

- [ ] **Step 6: Prove README and the citation census owe nothing (the README tax, paid as a measurement)**

Every insertion is below README's last `shared/api.ts` anchor, and the two edits above it are line for line. So the bytes README cites must be unchanged. Measure them from README's own numbers:

```bash
BASE=$(git merge-base HEAD origin/main)
U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://; s/-/,/')
M=$(sed -n '/shared\/api\.ts:[0-9]/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
SEL="${U}p"; for n in $M; do SEL="$SEL;${n}p"; done; echo "$SEL"
diff <(git show "$BASE:shared/api.ts" | sed -n "$SEL") <(sed -n "$SEL" shared/api.ts) && echo SAME-BYTES
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
git diff --stat -- README.md server/test/single-definition.test.ts server/test/session-hook.test.ts   # prints nothing
```

Expected:
- `SEL` is README's anchors as wave 7 re-pointed them, already on this branch (H1); they were `7873,7875p;7919p;7927p;7940p` at `226bb881c`, before wave 7. `SAME-BYTES` follows.
- The citation cases print `5 passed | 330 skipped (335)`; re-measure the skipped count.
- The last line prints nothing.

If any of these differs, an edit above an anchor moved a line. STOP: the in-place edits must stay line for line, and README is under claim 1110 until it ends.

- [ ] **Step 7: Mutation check**

Make each mutation alone, run its command, record the red, and revert before the next. Every row was measured at planning.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T1.1 | `REG_GENERATION_SHAPE`'s literal gains an `m` flag (`…{12}$/m;`) | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation-shape.test.ts` | `2 failed \| 14 passed (16)`: `an m flag lets $ match before a newline; a g flag makes .test stateful: expected 'm' to be ''`, and `refuses a trailing LF (ccd’s $ refuses it)`: `expected true to be false` |
| T1.2 | In `REG_GENERATION_SHAPE`, `{12}$` → `{11,12}$` | same | `2 failed \| 14 passed (16)`: `expected '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-…' to be '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-…'`, and `refuses 35 characters`: `expected true to be false` |
| T1.3 | In `server/src/coord/childReclaim.ts`, directly above `/** Nothing the feed already says (spec §5.9): close's value, and any first attempt's. */`, add `const REG_GENERATION_SHAPE = /x/; void REG_GENERATION_SHAPE;` | same | `1 failed \| 15 passed (16)`: `is declared in shared/api.ts and nowhere else`: `expected [ 'shared/api.ts', …(1) ] to deeply equal [ 'shared/api.ts' ]` |
| T1.4 | In `server/src/coord/store.ts`, replace `export const NODE_ID_RE = /^[0-9a-f]{8}-…{12}$/;` with `export { REG_GENERATION_SHAPE as NODE_ID_RE } from '../../../shared/api.js';` | same | `1 failed \| 15 passed (16)`: `expected 'import type { DatabaseSync } from \'n…' to match /^export const NODE_ID_RE = \/\^/m` |
| T1.5 | In `leafKeptWord`, add `  if (v === null) return 'refused';` as its first line (a word half that reads `null` itself) | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-attention-arms.test.ts` | `1 failed \| 15 passed (16)`: `null -> "unmeasured"`: `expected 'refused' to be 'unmeasured'`. Not measured at planning (H8, after 4045): measure it |
| T1.6 | In `leafKeptWord`, `? v as LeafKeptWord : 'unmeasured';` → `? v as LeafKeptWord : 'refused';` | same | `9 failed \| 7 passed (16)`. The rows `null`, `"kept"`, `""`, `"REFUSED"`, `"toString"`, `3`, `true`, `{}` and `undefined` each red `expected 'refused' to be 'unmeasured'`. Not measured at planning in this form (H8, after 4045): measure it |
| T1.7 | In `server/src/archivedExpiry.ts`, directly above its first `export ` line (`export const EXPIRE_LANE_LIVE_MARKER`), add `export const EXPIRE_LEAF_WORDS: readonly string[] = ['refused', 'unmeasured', 'in-use'];`, the second word list workspace lifecycle's wave-5 plan drafts | same | `1 failed \| 15 passed (16)`: `is declared once, in shared/api.ts, …`: `expected [ 'shared/api.ts', …(1) ] to deeply equal [ 'shared/api.ts' ]` |
| T1.8 | `ChildReclaimGenerationKey = Extract<…>` → `ChildReclaimGenerationKey = ChildReclaimGeneration` | `cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json` | `test/child-reclaim-attention-arms.test.ts(…): error TS2578: Unused '@ts-expect-error' directive.` (and `typecheck-tests.test.ts` reds with it) |
| T1.9 | Delete ` \| ChildReclaimStuckAttention` from the union's last line | same | `error TS2322: Type '"stuck"' is not assignable to type '"failing" \| "kept" \| "kept-many" \| "leaf-kept" \| "terminal"'` |
| T1.10 | Delete `'in-use': true` from `LEAF_KEPT_WORD_TABLE` | `cd server && ./node_modules/.bin/tsc --noEmit -p .` | `error TS2741: Property '"in-use"' is missing in type '{ refused: true; unmeasured: true; }' but required in type 'Readonly<Record<LeafKeptWord, true>>'` |
| T1.11 | In `server/src/archivedExpiry.ts`, directly above `export const EXPIRE_LANE_LIVE_MARKER`, add the list wrapped over two lines: `export const EXPIRE_LEAF_WORDS: readonly string[] = ['refused', 'unmeasured',`, then on the next line `  'in-use'];` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-attention-arms.test.ts` | `1 failed \| 15 passed (16)`: `is declared once, in shared/api.ts, …`: `a reader of the kept words with its own list: expected [ 'server/src/archivedExpiry.ts' ] to deeply equal []`. The one-line set check misses a wrapped copy; the name check catches it. Not measured at planning (added for H8): measure it |
| T1.12 | In `server/src/archivedExpiry.ts`, directly above `export const EXPIRE_LANE_LIVE_MARKER`, add `export type ExpireLeafKeptCopy = ` followed, on the SAME line, by the three quoted words and `null` joined as a union: the type-level spelling WL5's earlier draft (`30b841c01`) wrote for its `ExpireLeafKept` alias (W8-SEC-1; Step 4 (d)'s `30b841c01` paragraph describes it; WL5 at `f8ec01cc4` spells it `KeptLeafWord | null | 'unreported'`) | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-attention-arms.test.ts` | `1 failed \| 15 passed (16)`: `is declared once, in shared/api.ts, …`: `expected [ 'shared/api.ts', …(1) ] to deeply equal [ 'shared/api.ts' ]`. A type-level copy is a code line naming all three words, so the set check catches it with no name to match. Not measured at planning (W8-SEC-1): measure it |
| T1.13 | In `server/src/archivedExpiry.ts`, directly above `export const EXPIRE_LANE_LIVE_MARKER`, add `export function keptLeafWord(v: unknown): unknown { return v; }`: a word reader the move left behind, spelling no word | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-attention-arms.test.ts` | `1 failed \| 15 passed (16)`: `is declared once, in shared/api.ts, …`: `a reader of the kept words with its own list: expected [ 'server/src/archivedExpiry.ts' ] to deeply equal []`. Not measured at planning (H8, after 4045): measure it |

Revert each mutation, then re-run Step 5's first command green.

- [ ] **Step 8: Commit**

```bash
git add shared/api.ts server/test/child-reclaim-generation-shape.test.ts server/test/child-reclaim-attention-arms.test.ts
git add server/src/archivedExpiry.ts server/test/archived-expiry-policy.test.ts   # only when Step 4 (d) ran (H8)
git commit -m "$(cat <<'MSG'
feat(reclaim): L0 for reclaim's server half: the generation grammar, three attention arms, one leaf classifier

REG_GENERATION_SHAPE is ccd's _reg_generation_valid grammar, held equal to
ccd's own regex text by a test and pinned once by name, never by text
(NODE_ID_RE shares the text for another concept). ChildReclaimGeneration has
three answers (value, absent, unreadable), and a key is a read minus
unreadable (spec §5.5). ChildReclaimAttention gains stuck, leaf-kept and
the kept leaves' collapsed line, in kept-many's shape so the PWA renders it
unchanged. leafKeptWord is the one classifier of a kept-leaf value, shared
with workspace lifecycle (spec §5.6); if workspace lifecycle landed its
word half first, it moves here and its readers are re-pointed (H8). Appended
at the file's foot, with the
two edits above it line for line, so README's anchors and the citation
census are unchanged (measured).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: X1's sweep side: the byte-exact generation read, gathered before the loop, as the entry's third key and every request's `licenceGeneration`

**Model routing:** **`opus`, effort `high`**. This is SAFETY. It decides which workspace generation a licence was judged under, the first link of R73's chain of four equal generations: the licence's, the one re-read before presence (Task 3), the audit's (Task 3), and the token's (ccd, wave 7).

**Why:** Contract R73(a)–(c) and the stated residual in R73(a).
- **(a) The read.** For every marked row, the sweep reads `$REG/<id>.generation` with `readFileMeasured`, byte-exact, into three answers. Every read is GATHERED concurrently BEFORE the per-child loop, so the loop stays synchronous and no await sits between a row's entry read and its write.
  - The planning reader measured the pass as synchronous at `226bb881c` from its start to `await Promise.all(acts)` (`watch.ts:3284-3729`). An await per row inside the loop would let a slow agent stretch a pass past the 60 s throttle. Two passes would then interleave, and two sightings milliseconds apart would count as twice-observed.
- **(b) The third key.** The generation becomes the entry's third key, beside `bornAt` and `markerRunId`. An unreadable generation is not a key: the verdict is the existing doubt word `identity-unmeasured`, visible on the chip. It never seeds an entry, and the entry and the hold-retired memory for the id are dropped.
- **(c) The request.** Every sweep request carries `licenceGeneration`, the entry's key. Close's request carries `none`.

The executor's re-read and the audit's key are Task 3's. The hold-retired Map is Task 4's.

**Measured at planning.** Every edit below was applied to a scratch copy of the export of `226bb881c`, on top of Task 1. Both `tsc` projects are clean there.
- The four new test files (Tasks 1 and 2) ran `67 passed`, and the twelve affected files `12 passed (12)`, `881 passed (881)`, in about 60 s. H5's two added cases (one in each new Task 2 file) make those `69` and `883`: derived, not measured; re-measure.
- The session-hook citation cases are `5 passed`.
- Every mutation row in Step 9 was measured there.

**Files:**
- Modify: `server/src/childReclaimSweep.ts` (L1), at four places:
  - the L0 import;
  - `ChildReclaimSweepEntry`: its `generation` field and two doc sentences;
  - `childReclaimFirstSighting` and `childReclaimSameGeneration`, plus the new `childReclaimSameGenerationKey` and `isChildReclaimGenerationKey`;
  - `ChildReclaimSweepInput.generation`, and `childReclaimSweepVerdict`'s identity line.
- Modify: `server/src/coord/childReclaim.ts`:
  - `import path from 'node:path'`, with `close.ts` (same directory) as the precedent;
  - the L0 import;
  - `ChildReclaimRequest.licenceGeneration` and `CHILD_RECLAIM_LICENCE_NONE`;
  - `childReclaimGenerationRead`, directly above `async function childReclaimOutcome`.
- Modify: `server/src/coord/close.ts`, both edits line-neutral: the import line `CHILD_RECLAIM_FEED_QUIET_NONE, childReclaimDecision, childReclaimHasCoordinated, childReclaimRowListing,`, and close's request literal.
  - Close MUST carry the field once the type requires it. Task 3 owns what `none` means at the executor: it skips the re-read and is never compared.
- Modify: `server/src/watch.ts`:
  - two import lines, line-neutral, plus one appended name;
  - the field `childReclaimPassSeq`, and two field docstrings;
  - `sweepChildReclaim`'s head (the throttle, the gather, the clock);
  - the verdict input, the key narrowing and the entry keys;
  - the request's `licenceGeneration`;
  - the private `childReclaimGatherGenerations`, directly above `childReclaimLaneNow`'s docstring.
- Modify (mechanical, the lines Step 7 names and nothing else):
  - `server/test/child-reclaim-sweep.test.ts` (ten request literals, and the `passDispatched` helper);
  - `server/test/child-reclaim-sweep-policy.test.ts`;
  - `server/test/child-reclaim-status.test.ts`;
  - `server/test/child-reclaim-runs-route.test.ts`;
  - `server/test/child-reclaim-close.test.ts`;
  - `server/test/child-reclaim-paused-at-server.test.ts`;
  - `server/test/child-reclaim-pre-crumb.test.ts`;
  - `server/test/child-reclaim.test.ts`.
- Test (new): `server/test/child-reclaim-generation-key.test.ts` (L1 and the read) and `server/test/child-reclaim-generation-lane.test.ts` (the lane, and the pacing-safety cases).
- No edit to `shared/api.ts`, README, `single-definition.test.ts`, the PWA, the agent or ccd.

**Interfaces:**
- Consumes:
  - From Task 1: `REG_GENERATION_SHAPE`, `ChildReclaimGeneration` and `ChildReclaimGenerationKey`.
  - `FleetIO.readFileMeasured(path: string, timeoutMs?: number, signal?: AbortSignal): Promise<MeasuredRead>` (`server/src/io.ts:113`). `localIO` answers `absent` only on ENOENT (`failureFor`, `io.ts:169-172`). The remote adapter answers `unreadable` on any failure, including its timer, and never rejects (`server/src/remote/io.ts:45-58`).
  - `this.deps.io` and `this.deps.cfg.registryDir` (`watch.ts:2155` reads the same pair).
  - `CHILD_RECLAIM_SWEEP_MS` (60 000, `watch.ts:174`).
  - `childReclaimLaneNow()` (`watch.ts:3734`).
  - `codeOnly` (`server/test/sourceScan.ts:28`).
- Produces:
  ```ts
  // server/src/coord/childReclaim.ts
  export async function childReclaimGenerationRead(
    io: Pick<FleetIO, 'readFileMeasured'>, registryDir: string, id: string,
  ): Promise<ChildReclaimGeneration>;                       // byte-exact; a rejecting port propagates (H5)
  export interface ChildReclaimRequest { /* …unchanged… */
    readonly licenceGeneration: ChildReclaimGenerationKey | { readonly kind: 'none' } }
  export const CHILD_RECLAIM_LICENCE_NONE: ChildReclaimRequest['licenceGeneration'];   // { kind: 'none' }, close's
  // server/src/childReclaimSweep.ts (L1)
  export const childReclaimSameGenerationKey: (a: ChildReclaimGenerationKey, b: ChildReclaimGenerationKey) => boolean;
  export const isChildReclaimGenerationKey: (g: ChildReclaimGeneration) => g is ChildReclaimGenerationKey;
  ChildReclaimSweepEntry.generation: ChildReclaimGenerationKey
  childReclaimFirstSighting(monoMs: number, bornAt: number | null, markerRunId: number, generation: ChildReclaimGenerationKey)
  childReclaimSameGeneration(entry: ChildReclaimSweepEntry, bornAt: number | null, markerRunId: number, generation: ChildReclaimGenerationKey)
  ChildReclaimSweepInput.generation: ChildReclaimGeneration   // unreadable -> 'identity-unmeasured'
  // server/src/watch.ts (private)
  childReclaimGatherGenerations(records: readonly SessionRecord[]): Promise<ReadonlyMap<string, ChildReclaimGeneration>>
  childReclaimPassSeq: number
  ```
- For the later tasks:
  - **Task 3** calls `childReclaimGenerationRead(deps.io, deps.cfg.registryDir, sessionId)` for its re-read before presence (step 2c), inside its own try: a rejection defers `marker-unreadable` (H5). It treats `CHILD_RECLAIM_LICENCE_NONE` as "skip".
  - **Task 4** hands the UNNARROWED `regGeneration` (already typed `ChildReclaimGeneration`) to its L1 `childReclaimHoldRetiredStep`, which compares through `childReclaimSameGeneration` and `childReclaimSameGenerationKey` and returns `forget` for `unreadable`. Its release job's step 7 re-reads through `childReclaimGenerationRead` inside its own try: a rejection answers `failed` (H5).
  - **Task 9** extends `ChildReclaimSweepEntry` after `generation`.

**Departures this task names (by slug; the coordinator numbers them):**
- `pass-clock-after-gather`. R39 says the lane reads `ChildReclaimLaneNow` once per pass. The throttle now takes its monotonic reading BEFORE the gather, and stamps the throttle with it, so a tick during the gather is throttled. The pass's one decision reading follows the gather.
  - Without it, a decision clock would predate the evidence by up to the gather's latency, 15 s on the remote adapter. The presence freshness check (`childReclaimPresenceWithin`) could then read a gap up to that much shorter than true: fail-open.
- `an-overtaken-gather-decides-nothing`. This mechanism is not in R73's text. A pass counter (`childReclaimPassSeq`) is bumped before the gather. A pass whose gather settles after a newer pass has started returns before deciding anything.
  - The gather's bound is the io's request timeout. That timeout is configurable (`requestTimeoutMs`), and a local read has no timer. Without the counter, a gather slower than the throttle lets two loops run back to back, which is one interval counted as two sightings. That is the pacing hazard R73(a) rules against.
- `marked-means-marker-reads-as-child`. The gather reads rows whose marker reads as a child (`r.child.kind === 'child'`). A row whose marker is unreadable answers `marker-unreadable` before identity is judged, so its generation decides nothing and is not read.

**Stated residuals (R73(a), in the reader's docstring):**
- Both adapters follow a symlink. A link to a valid file reads as that value, and a dangling link reads `absent`, where ccd's `_reg_generation_read` refuses both. ccd writes neither shape. On a wave-7 ccd, either one ends in an audit `unmeasured`, never an act.
- A persistently unreadable generation is visible on the chip (`identity-unmeasured`, doubt class) but not on the banner. Doubt words never reach it. This was not ruled.
- The gather runs on every non-throttled pass, a paused or capability-less one included: one small read per marked row per minute, beside `readRegistry`'s many field reads per row on every 2 s tick.

- [ ] **Step 1: Re-measure the anchors (read-only)**

```bash
grep -n "^export interface ChildReclaimSweepEntry\|^export const childReclaimFirstSighting\|^export const childReclaimSameGeneration\|^export interface ChildReclaimSweepInput\|^export function childReclaimSweepVerdict" server/src/childReclaimSweep.ts   # 123, 188, 219, 354, 537
grep -n "^export interface ChildReclaimRequest\|^export const CHILD_RECLAIM_FEED_QUIET_NONE\|^export async function childReclaimPauseRead\|^async function childReclaimOutcome" server/src/coord/childReclaim.ts   # 347, 355, 820, 828
grep -n "feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE } : null," server/src/coord/close.ts            # 832
grep -n "^  async sweepChildReclaim(\|      const v = childReclaimSweepVerdict({\|if (entry === undefined || !childReclaimSameGeneration(entry, childBornAt, v.runId))\|feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id),\|^  private childReclaimLaneNow()" server/src/watch.ts   # 3284, 3521, 3601, 3675, 3734
grep -rln "trigger: 'sweep'\|trigger: 'close'" server/test | sort                                  # the five files Step 7 (a) names
grep -rn "childReclaimFirstSighting(\|childReclaimSameGeneration(" server/test | cut -d: -f1 | sort | uniq -c   # policy 13, runs-route 2, status 1
grep -n "REG_GENERATION_SHAPE\|^export type ChildReclaimGenerationKey" shared/api.ts                 # Task 1's, at the foot
```

If workspace lifecycle wave 5 has landed, it edits other regions of `watch.ts` (the expiry lane's forgetting, the dead-coordinator lane, and an import near :121) and `close.ts`'s `CloseOutcome`. Re-measure. A red here that is not one of these anchors moving STOPs, and is reported by slug.

- [ ] **Step 2: Write the failing tests**

Create `server/test/child-reclaim-generation-key.test.ts`:

```ts
// Child-reclamation wave 8 (spec §5.5): the registry generation, `$REG/<id>.generation`, as the sweep's THIRD key.
// Two layers are pinned here; the lane that wires them is `child-reclaim-generation-lane.test.ts`.
// - L1 (`childReclaimSweep.ts`): the one key predicate, the entry's third key, and the verdict's doubt word
//   `identity-unmeasured` for an unreadable read.
// - The ONE read (`childReclaimGenerationRead`): byte-exact, three answers, a port's rejection left to its caller
//   (H5), and its stated residual
//   (a symlink is followed) pinned as measured behaviour.
// Fixture directories only: every path is under a `mkTmp` directory, never a live registry.
import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { childReclaimGenerationRead } from '../src/coord/childReclaim.js';
import {
  childReclaimFirstSighting, childReclaimSameGeneration, childReclaimSameGenerationKey, childReclaimSweepVerdict,
  isChildReclaimGenerationKey, type ChildReclaimSweepInput,
} from '../src/childReclaimSweep.js';
import type { ChildReclaimGenerationKey } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const G1 = '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
const G2 = '7c9d0e1f-2a3b-4c5d-8e6f-1a2b3c4d5e6f';
const BOM = String.fromCharCode(0xfeff);
const value = (v: string): ChildReclaimGenerationKey => ({ kind: 'value', v });
const ABSENT: ChildReclaimGenerationKey = { kind: 'absent' };

describe('childReclaimSameGenerationKey, the one generation predicate (spec §5.5)', () => {
  it.each<readonly [string, ChildReclaimGenerationKey, ChildReclaimGenerationKey, boolean]>([
    ['an equal value matches', value(G1), value(G1), true],
    ['a different value does not', value(G1), value(G2), false],
    ['a value one byte apart does not', value(G1), value(`${G1.slice(0, 35)}c`), false],
    ['absent matches absent', ABSENT, ABSENT, true],
    ['a value does not match absent', value(G1), ABSENT, false],
    ['absent does not match a value', ABSENT, value(G1), false],
  ])('%s', (_label, a, b, same) => {
    expect(childReclaimSameGenerationKey(a, b)).toBe(same);
  });

  it('a read is a key unless it is unreadable', () => {
    expect(isChildReclaimGenerationKey(value(G1))).toBe(true);
    expect(isChildReclaimGenerationKey(ABSENT)).toBe(true);
    expect(isChildReclaimGenerationKey({ kind: 'unreadable' })).toBe(false);
  });
});

describe('the entry describes one workspace generation by THREE keys (spec §5.5, §5.6)', () => {
  const BORN = 1_789_000_000_000;
  const RUN = 7;

  it('a first sighting carries the generation it was sighted under', () => {
    expect(childReclaimFirstSighting(5_000, BORN, RUN, value(G1)).generation).toEqual(value(G1));
    expect(childReclaimFirstSighting(5_000, BORN, RUN, ABSENT).generation).toEqual(ABSENT);
  });

  it('the same birth and the same marker run under ANOTHER generation is a new workspace', () => {
    const e = childReclaimFirstSighting(5_000, BORN, RUN, value(G1));
    expect(childReclaimSameGeneration(e, BORN, RUN, value(G1))).toBe(true);
    expect(childReclaimSameGeneration(e, BORN, RUN, value(G2)), 'a same-run re-mint: only the generation moved')
      .toBe(false);
    expect(childReclaimSameGeneration(e, BORN, RUN, ABSENT)).toBe(false);
    expect(childReclaimSameGeneration(childReclaimFirstSighting(5_000, BORN, RUN, ABSENT), BORN, RUN, ABSENT)).toBe(true);
  });

  it('the other two keys still decide, and a null birth never matches whatever the generation', () => {
    expect(childReclaimSameGeneration(childReclaimFirstSighting(5_000, null, RUN, value(G1)), null, RUN, value(G1)))
      .toBe(false);
    const e = childReclaimFirstSighting(5_000, BORN, RUN, value(G1));
    expect(childReclaimSameGeneration(e, BORN + 1, RUN, value(G1))).toBe(false);
    expect(childReclaimSameGeneration(e, BORN, RUN + 1, value(G1))).toBe(false);
  });
});

describe('an unreadable generation makes the row’s identity unmeasured (spec §5.5)', () => {
  const NOW = 1_790_000_000_000;
  const base = (over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
    sessionId: 'demo-a', child: { kind: 'child', runId: 7 }, identityMeasured: true, generation: value(G1),
    workspace: 'demo-a', held: { kind: 'none' }, terminal: false,
    mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 3_600_000,
      openedAt: NOW - 3_600_000 } },
    reviewedRun: { kind: 'not-a-review' }, siblings: { ok: true, open: 0 }, coordinatorClaim: undefined,
    childBornAt: NOW - 3_600_000, skewMs: 120_000, nowMs: NOW, ...over,
  });

  it('a value and absent judge as before', () => {
    expect(childReclaimSweepVerdict(base())).toEqual({ eligible: true, runId: 7 });
    expect(childReclaimSweepVerdict(base({ generation: ABSENT }))).toEqual({ eligible: true, runId: 7 });
  });

  it('unreadable is the doubt word identity-unmeasured: never eligible, so it seeds no entry', () => {
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' } })))
      .toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('it answers ahead of every hold: a retired programme hold over it is no hold-retired sighting', () => {
    const retired = { kind: 'program', reason: 'r', program: 'p', accountedRunId: 7, open: { ok: true, count: 0 } } as const;
    expect(childReclaimSweepVerdict(base({ held: retired })), 'CONTROL: readable, it is hold-retired')
      .toMatchObject({ eligible: false, why: 'hold-retired' });
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' }, held: retired })))
      .toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('the marker still answers first', () => {
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' }, child: { kind: 'unreadable' } })))
      .toEqual({ eligible: false, why: 'marker-unreadable' });
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' }, child: { kind: 'none' } })))
      .toEqual({ eligible: false, why: 'not-a-child' });
  });
});

describe('childReclaimGenerationRead, the ONE read, byte-exact (spec §5.5)', () => {
  const reg = (): string => {
    const d = path.join(mkTmp('ccrc-cr-gen-read-'), '.cc-sessions');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const at = (d: string): string => path.join(d, 'demo-a.generation');

  it('a file holding exactly the grammar is that value, byte for byte', async () => {
    const d = reg();
    writeFileSync(at(d), G1);
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'value', v: G1 });
  });

  it('no file is absent', async () => {
    expect(await childReclaimGenerationRead(localIO, reg(), 'demo-a')).toEqual({ kind: 'absent' });
  });

  it.each<readonly [string, string]>([
    ['a trailing LF, which a trim would strip', `${G1}\n`],
    ['a leading byte-order mark, which a trim would strip', `${BOM}${G1}`],
    ['a trailing NUL', `${G1}\0`],
    ['a leading space', ` ${G1}`],
    ['upper case', G1.toUpperCase()],
    ['an empty file', ''],
  ])('%s is unreadable: nothing is stripped', async (_label, content) => {
    const d = reg();
    writeFileSync(at(d), content);
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'unreadable' });
  });

  it('a directory at the name is unreadable, never absent', async () => {
    const d = reg();
    mkdirSync(at(d));
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'unreadable' });
  });

  it('a failed read is unreadable, never absent', async () => {
    const failing: Pick<FleetIO, 'readFileMeasured'> = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    expect(await childReclaimGenerationRead(failing, '/reg', 'demo-a')).toEqual({ kind: 'unreadable' });
  });

  // H5: the read does NOT catch a rejecting port, as `childReclaimPauseRead` does not. Each caller's try answers it:
  // the sweep's gather folds it to `unreadable` for that row, the executor's re-read defers `marker-unreadable`, and
  // the release job answers `failed`.
  it('a rejecting port is not caught: the rejection propagates to the caller', async () => {
    const rejecting: Pick<FleetIO, 'readFileMeasured'> = { readFileMeasured: async () => { throw new Error('agent gone'); } };
    await expect(childReclaimGenerationRead(rejecting, '/reg', 'demo-a')).rejects.toThrow('agent gone');
  });

  it('reads `$REG/<id>.generation` and nothing else', async () => {
    const asked: string[] = [];
    const io: Pick<FleetIO, 'readFileMeasured'> = {
      readFileMeasured: async (p) => { asked.push(p); return { ok: true, content: G1 }; },
    };
    expect(await childReclaimGenerationRead(io, '/home/u/.cc-sessions', 'demo-a.b')).toEqual({ kind: 'value', v: G1 });
    expect(asked).toEqual(['/home/u/.cc-sessions/demo-a.b.generation']);
  });

  // THE STATED RESIDUAL (spec §5.5): both adapters follow a link, where ccd's own read refuses one. Pinned as
  // measured, so a change in either direction is a decision rather than a drift.
  it('a link to a valid file reads as that value, and a dangling link reads absent', async () => {
    const d = reg();
    writeFileSync(path.join(d, 'target'), G1);
    symlinkSync(path.join(d, 'target'), at(d));
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'value', v: G1 });
    const e = reg();
    symlinkSync(path.join(e, 'nowhere'), at(e));
    expect(await childReclaimGenerationRead(localIO, e, 'demo-a')).toEqual({ kind: 'absent' });
  });
});
```

Create `server/test/child-reclaim-generation-lane.test.ts`:

```ts
// Child-reclamation wave 8 (spec §5.5, §5.7): the sweep lane reads every marked row's registry generation and keys
// its memory and every request on it. What is only provable HERE:
// - the reads are GATHERED, concurrently, before the per-child loop, so the loop stays synchronous and no await
//   sits between a row's entry read and its write;
// - a tick during the gather is throttled, and a pass overtaken during its gather decides nothing, so two loops
//   never count one interval's sighting twice;
// - the generation is the entry's third key, an unreadable one is the doubt word `identity-unmeasured` and seeds
//   nothing, and every request carries the entry's key as `licenceGeneration`.
// The executor is stubbed at `Deps.childReclaimExec`, the lane's one seam (`child-reclaim-sweep.test.ts`'s idiom).
// FIXTURE HOMEs only: every registry path is under a `mkTmp` HOME, and the runner is a recording stub.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';
import type { ChildReclaimOutcome, ChildReclaimRequest } from '../src/coord/childReclaim.js';
import { holdReason } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { codeOnly } from './sourceScan.js';

afterEach(() => { vi.restoreAllMocks(); });

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const T0 = 1_790_000_000_000;
/** The journal file's own generation, the MIRROR's key: not a registry generation. */
const JOURNAL_GEN = '1790000000000000000';
const G1 = '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
const G2 = '7c9d0e1f-2a3b-4c5d-8e6f-1a2b3c4d5e6f';

const fixture = () => {
  let clock = T0;
  let mono = 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-cr-gen-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'ws-release') {
      const id = args[args.indexOf('--session') + 1] ?? '';
      try { rmSync(path.join(reg, `${id}.hold`)); return { code: 0, stdout: `released ${id}\n`, stderr: '' }; }
      catch { return { code: 0, stdout: `not held ${id}\n`, stderr: '' }; }
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const requests: ChildReclaimRequest[] = [];
  // The generation reads, counted, holdable and rejectable: while `holding`, a read waits for `release()`, so a case
  // decides exactly when a pass's gather settles; a row named by `reject(id)` has its read REJECT (H5). Every other
  // read is the real one.
  const genReads: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let holding = false;
  const held: (() => void)[] = [];
  const rejecting = new Set<string>();
  const io: FleetIO = {
    ...localIO,
    async readFileMeasured(p, timeoutMs, signal): Promise<MeasuredRead> {
      if (!p.endsWith('.generation')) return localIO.readFileMeasured(p, timeoutMs, signal);
      genReads.push(path.basename(p));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (rejecting.has(path.basename(p, '.generation'))) throw new Error('agent gone');
        if (holding) await new Promise<void>((resolve) => { held.push(resolve); });
        return await localIO.readFileMeasured(p, timeoutMs, signal);
      } finally {
        inFlight -= 1;
      }
    },
  };
  const deps = {
    ...testDeps(home, run), cfg, coord, io,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, RECLAIM_PAUSE_CAP, 'ws-release', ACTOR_FLAGS_CAP] },
    presence: { isVisible: () => false },
    childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
      requests.push(req);
      return { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 };
    },
    monotonicMs: () => mono,
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  let uid = 0;
  let progN = 0;
  /** A run opened and abandoned: the minting run of a finished child. */
  const finishedRun = (): { id: number; program: string } => {
    const program = `w8-gen-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    const c = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program,
      viaClosing: false });
    if (!c.ok) throw new Error(`abandon refused: ${JSON.stringify(c)}`);
    return { id: r.id, program };
  };
  /** The row's generation file: exactly `content`, or none at all. */
  const setGeneration = (id: string, content: string | null): void => {
    const p = path.join(reg, `${id}.generation`);
    if (content === null) rmSync(p, { force: true }); else writeFileSync(p, content);
  };
  /** A registry row, its `.child` marker (none when `runId` is null), its generation and its journalled `create`. */
  const plant = (id: string, runId: number | null, generation: string | null, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, workspace: id.slice('demo-'.length),
      branch: `ws/${id}`, base: 'origin/main', started: '1', ...(runId === null ? {} : { child: String(runId) }), ...extra,
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    setGeneration(id, generation);
    uid += 1;
    const line = JSON.stringify({ uid: `w8.1.${uid}`, at: clock, act: 'create', outcome: 'done', verb: 'ws-add', id });
    coord.ingestJournal({ gen: JOURNAL_GEN, rows: [parseJournalLine(line)], cursor: uid * 200, size: uid * 200, at: clock });
  };
  const pass = async (): Promise<void> => {
    await watcher.sweepChildReclaim(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  return {
    reg, calls, requests, genReads, finishedRun, plant, setGeneration, pass, next,
    maxInFlight: () => maxInFlight,
    hold: (): void => { holding = true; },
    unhold: (): void => { holding = false; },
    release: (): void => { for (const r of held.splice(0)) r(); },
    heldCount: (): number => held.length,
    reject: (id: string): void => { rejecting.add(id); },
    entryOf: (id: string) => watcher.currentChildReclaimDefers().get(id),
    verdictOf: (id: string) => watcher.currentChildReclaimVerdicts()?.get(id),
    releases: (): string[][] => calls.filter((c) => c[0] === 'ws-release'),
  };
};

describe('every sweep request carries the generation it was judged under (spec §5.5)', () => {
  it('a value, or absent, as the entry was sighted', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.plant('demo-b', f.finishedRun().id, null);
    await f.pass();
    f.next(); await f.pass();
    f.next(); await f.pass();
    expect(f.requests.map((q) => [q.sessionId, q.licenceGeneration])).toEqual([
      ['demo-a', { kind: 'value', v: G1 }],
      ['demo-b', { kind: 'absent' }],
    ]);
  });
});

describe('the generation is the entry’s third key (spec §5.5, §5.6)', () => {
  it('a generation that moves under the same birth and the same marker run is a NEW workspace: sighted afresh', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    await f.pass();
    expect(f.entryOf('demo-a')?.generation).toEqual({ kind: 'value', v: G1 });
    f.setGeneration('demo-a', G2);                               // a same-run re-mint, its create not yet placed
    f.next(); await f.pass();
    expect(f.requests, 'the old sighting does not count for the new generation').toEqual([]);
    expect(f.entryOf('demo-a')?.generation).toEqual({ kind: 'value', v: G2 });
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.licenceGeneration)).toEqual([{ kind: 'value', v: G2 }]);
  });

  it('a value that goes absent is a new workspace too', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    await f.pass();
    f.setGeneration('demo-a', null);
    f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.licenceGeneration)).toEqual([{ kind: 'absent' }]);
  });
});

describe('an unreadable generation is identity-unmeasured, and seeds nothing (spec §5.5)', () => {
  it('the verdict is the doubt word, the entry is dropped, and two fresh passes follow once it reads again', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    await f.pass();
    expect(f.entryOf('demo-a')).toBeDefined();
    f.setGeneration('demo-a', `${G1}\n`);                        // 37 bytes: ccd's own read refuses it too
    f.next(); await f.pass();
    expect(f.verdictOf('demo-a')).toEqual({ eligible: false, why: 'identity-unmeasured' });
    expect(f.entryOf('demo-a'), 'the entry is dropped').toBeUndefined();
    f.next(); await f.pass();
    expect(f.entryOf('demo-a'), 'and never seeded while it reads unreadable').toBeUndefined();
    expect(f.requests).toEqual([]);
    f.setGeneration('demo-a', G1);
    f.next(); await f.pass();
    expect(f.requests, 'a first sighting again').toEqual([]);
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.licenceGeneration)).toEqual([{ kind: 'value', v: G1 }]);
  });

  it('it drops the hold-retired memory: a retired hold is released only after two fresh sightings', async () => {
    const f = fixture();
    const r = f.finishedRun();
    f.plant('demo-a', r.id, G1, { hold: holdReason(r.program, 2, null, null) });
    await f.pass();                                              // the 1st hold-retired sighting
    expect(f.verdictOf('demo-a')).toMatchObject({ eligible: false, why: 'hold-retired' });
    f.setGeneration('demo-a', `${G1}\n`);
    f.next(); await f.pass();                                    // identity-unmeasured: the memory is dropped
    expect(f.releases()).toEqual([]);
    f.setGeneration('demo-a', G1);
    f.next(); await f.pass();                                    // hold-retired again: a FRESH 1st sighting
    expect(f.releases(), 'queued on one sighting after an unreadable pass').toEqual([]);
    f.next(); await f.pass();                                    // its 2nd: only now
    expect(f.releases()).toHaveLength(1);
  });
});

describe('a rejecting generation read is that row’s doubt, never the pass’s failure (spec §5.5, H5)', () => {
  it('the row reads identity-unmeasured and seeds nothing; the other rows proceed, and the pass resolves', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.plant('demo-b', f.finishedRun().id, G1);
    f.reject('demo-a');
    await expect(f.pass()).resolves.toBeUndefined();
    expect(f.verdictOf('demo-a')).toEqual({ eligible: false, why: 'identity-unmeasured' });
    expect(f.entryOf('demo-a'), 'a rejection seeds no entry').toBeUndefined();
    expect(f.entryOf('demo-b')?.generation).toEqual({ kind: 'value', v: G1 });
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-b']);
  });
});

describe('the reads are gathered before the loop, so the loop stays synchronous (spec §5.5, §5.7)', () => {
  it('one read per MARKED row per pass, all issued before any settles; an unmarked row and a throttled pass read nothing', async () => {
    const f = fixture();
    for (const id of ['demo-a', 'demo-b', 'demo-c']) f.plant(id, f.finishedRun().id, G1);
    f.plant('demo-d', null, G1);                                 // a row with no child marker
    await f.pass();
    expect([...f.genReads].sort()).toEqual(['demo-a.generation', 'demo-b.generation', 'demo-c.generation']);
    expect(f.maxInFlight(), 'gathered concurrently, never one after another').toBe(3);
    await f.pass();                                              // inside the interval: throttled
    expect(f.genReads).toHaveLength(3);
  });

  it('the pass awaits twice: the gather, after the throttle and before every loop, and the acts at its end', () => {
    const src = codeOnly(readFileSync(path.join(srcDir, 'watch.ts'), 'utf8'));
    const start = src.indexOf('  async sweepChildReclaim(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const throttle = body.indexOf('this.lastChildReclaimSweep = gate;');
    const gather = body.indexOf('await this.childReclaimGatherGenerations(records)');
    const loop = body.indexOf('for (const r of records) {');
    const acts = body.indexOf('await Promise.all(acts);');
    expect([throttle, gather, loop, acts].every((i) => i > -1), 'an anchor is gone').toBe(true);
    expect([...body.matchAll(/\bawait\b/g)].map((m) => m.index)).toEqual([gather, acts]);
    expect(throttle).toBeLessThan(gather);
    expect(gather).toBeLessThan(loop);
  });

  it('a tick that lands while a pass gathers is throttled: it reads nothing', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.hold();
    const first = f.pass();
    await vi.waitFor(() => expect(f.heldCount()).toBe(1));
    f.unhold();
    await f.pass();                                              // the same instant
    expect(f.genReads, 'the second pass gathered nothing').toEqual(['demo-a.generation']);
    f.release(); await first;
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('a pass overtaken while it gathers decides nothing: one interval is never two sightings', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.hold();
    const slow = f.pass();                                       // pass A: its gather held
    await vi.waitFor(() => expect(f.heldCount()).toBe(1));
    f.unhold();
    f.next(); await f.pass();                                    // pass B, an interval later: the first sighting
    const sighted = f.entryOf('demo-a');
    expect(sighted).toBeDefined();
    f.release(); await slow;                                     // A's gather settles after B's loop
    expect(f.requests, 'A decided nothing: its loop would have been a second sighting').toEqual([]);
    expect(f.entryOf('demo-a'), 'B’s entry stands untouched').toBe(sighted);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });
});
```

The `\n` and `\0` in both files are a backslash followed by the letter. Check them with `cat -A` as in Task 1. The BOM is `String.fromCharCode(0xfeff)` for Task 1's reason.

The last describe holds the PACING-SAFETY cases. In order:
- the textual pin that the pass has exactly two awaits, the gather after the throttle stamp and before the first per-child loop, and the acts at its end. So no await sits between an entry's read (`childReclaimSweepState.get`) and its write (`set` or `delete`).
- the behavioural case that a tick during the gather is throttled;
- the case that an overtaken pass decides nothing.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation-key.test.ts test/child-reclaim-generation-lane.test.ts
```

Expected: FAIL, `Tests  34 failed | 3 passed (37)`, every lane case among the failures. Measured at planning as `32 failed | 3 passed (35)`; H5's two added cases red as well (derived; re-measure).
- `TypeError: childReclaimGenerationRead is not a function`, eight times (the failing-port and rejecting-port cases are two since H5);
- `TypeError: childReclaimSameGenerationKey is not a function` and `TypeError: isChildReclaimGenerationKey is not a function`;
- `a same-run re-mint: only the generation moved: expected true to be false`;
- `expected { eligible: true, runId: 7 } to deeply equal { eligible: false, …(1) }`;
- lane: `expected [ [ 'demo-a', undefined ], …(1) ] to deeply equal [ [ 'demo-a', …(1) ], …(1) ]`;
- lane: `expected undefined to deeply equal { kind: 'value', …(1) }`;
- lane: `expected [] to deeply equal [ 'demo-a.generation', …(2) ]`;
- lane: `an anchor is gone: expected false to be true`;
- lane: the two holding cases' `vi.waitFor` give up with `expected +0 to be 1`;
- lane, the rejecting-read case: `expected { eligible: true, runId: <n> } to deeply equal { eligible: false, …(1) }`.

The 3 that pass are guards against a later change, whose answers this task must not move:
- `the other two keys still decide, …`;
- `a value and absent judge as before`;
- `the marker still answers first`.

- [ ] **Step 4: L1, `server/src/childReclaimSweep.ts`**

(a) The L0 import. Replace

```ts
  type ChildMark, type ChildReclaimAttention, type ChildReclaimKeptWord, type LcRefusalToken, type LifecycleAct,
```

with

```ts
  type ChildMark, type ChildReclaimAttention, type ChildReclaimGeneration, type ChildReclaimGenerationKey,
  type ChildReclaimKeptWord, type LcRefusalToken, type LifecycleAct,
```

(b) In `ChildReclaimSweepEntry`'s docstring, replace

```ts
 *  equality only, and `markerRunId` is no clock at all.
```

with

```ts
 *  equality only, and `markerRunId` and `generation` are no clock at all.
```

and replace

```ts
 *  be worse than absent"). The entry describes ONE workspace generation, by
 *  two keys, its birth (`bornAt`) and the run its marker names
 *  (`markerRunId`): a slug minted again is a new child, sighted afresh
 *  (`childReclaimSameGeneration` states the windows the two keys leave).
```

with

```ts
 *  be worse than absent"). The entry describes ONE workspace generation, by
 *  three keys, its birth (`bornAt`), the run its marker names (`markerRunId`)
 *  and its registry row's generation (`generation`): a slug minted again is a
 *  new child, sighted afresh (`childReclaimSameGeneration` states what is left).
```

(c) Directly after the field `  readonly markerRunId: number;`, insert

```ts
  /** The registry row's generation (`$REG/<id>.generation`, spec §5.5) when this entry was sighted: the THIRD key
   *  (`childReclaimSameGeneration`). A value or `absent`, never `unreadable`: a read that could not say seeds no
   *  entry, because the verdict answers `identity-unmeasured` for it. Every sweep request carries it as
   *  `licenceGeneration`, the generation that request was judged under. */
  readonly generation: ChildReclaimGenerationKey;
```

(d) `childReclaimFirstSighting`: replace its docstring, its parameter line and its body's `bornAt, markerRunId,` line:

```ts
/** A child seen eligible for the first time, in the workspace generation born
 *  at `bornAt`, marked by run `markerRunId` and carrying the registry generation
 *  `generation`: no clock, no failure, never asked. `monoMs` is the lane's
 *  monotonic clock. */
export const childReclaimFirstSighting = (
  monoMs: number, bornAt: number | null, markerRunId: number, generation: ChildReclaimGenerationKey,
): ChildReclaimSweepEntry => ({
  firstEligibleAt: monoMs, firstDeferredAt: null, firstPresenceDeferredAt: null, lastPresenceDeferredAt: null,
  lastPresenceWallAt: null, presenceHeldSince: null,
  consecutiveFailures: 0, lastFailedAt: null, refusedAt: null, lastAskedAt: null, bornAt, markerRunId, generation,
  lastDeferWhy: null,
});
```

(e) Replace the whole of `childReclaimSameGeneration`. That runs from its docstring's first line, `/** Does this entry describe the workspace generation born at `bornAt` whose `.child` marker names run` (:196), to its body's last line, `): boolean => entry.bornAt !== null && entry.bornAt === bornAt && entry.markerRunId === markerRunId;` (:221). Its "Carried to wave 7" paragraph is retired with it. The replacement is:

```ts
/** Are two generation keys the same generation (spec §5.5)? A value matches an EQUAL value, byte for byte, and
 *  `absent` matches `absent`. Nothing else matches. THE ONE predicate every generation-keyed memory of this lane asks,
 *  the sweep's entry first (`childReclaimSameGeneration`). */
export const childReclaimSameGenerationKey = (a: ChildReclaimGenerationKey, b: ChildReclaimGenerationKey): boolean =>
  a.kind === 'value' ? b.kind === 'value' && a.v === b.v : b.kind === 'absent';

/** Is this read a KEY (spec §5.5)? Every read but `unreadable`. A narrowing, never a decision: the verdict has
 *  already answered `identity-unmeasured` for an unreadable read before the lane touches an entry. */
export const isChildReclaimGenerationKey = (g: ChildReclaimGeneration): g is ChildReclaimGenerationKey =>
  g.kind !== 'unreadable';

/** Does this entry describe the workspace generation born at `bornAt`, whose `.child` marker names run `markerRunId`
 *  and whose registry row carries `generation` (spec §5.5; §5.6: slugs recycle)? ALL THREE keys must match, the
 *  generation through `childReclaimSameGenerationKey`. A null birth never matches.
 *
 *  WHY THREE. A recycled slug's new row and marker are listed before its new birth can be placed, so the birth
 *  alone would let an old workspace's licence-ripe presence episode license a request to the new one; a marker
 *  naming a different run ends the old generation there. Neither key sees one run minting the same slug twice with
 *  no pass between to forget the old entry: the birth may still read the old workspace's, and the marker names the
 *  same run. The registry generation does. ccd mints it with the row, before any other field, never rewrites it in
 *  place, removes it last when the row ends, and refuses a new row while any field of an old one stands, so a slug
 *  minted again carries a new value.
 *
 *  WHAT IT LEAVES. `absent` matches `absent`: two generation-less rows under one slug, which only a ws-add older than
 *  the generation's minting could write, are not told apart; a ccd that binds the generation audits such a row
 *  `unmeasured` and spends nothing on it. A request already queued when the slug is minted again is out of the
 *  entry's reach: it carries the entry's key as `licenceGeneration`, which the executor re-proves against the row
 *  (spec §5.5). */
export const childReclaimSameGeneration = (
  entry: ChildReclaimSweepEntry, bornAt: number | null, markerRunId: number, generation: ChildReclaimGenerationKey,
): boolean => entry.bornAt !== null && entry.bornAt === bornAt && entry.markerRunId === markerRunId
  && childReclaimSameGenerationKey(entry.generation, generation);
```

(f) In `ChildReclaimSweepInput`, directly after `  readonly identityMeasured: boolean;`, insert

```ts
  /** The registry row's generation as this pass read it (`childReclaimGenerationRead`, spec §5.5). `unreadable`
   *  makes the row's identity unmeasured, exactly as an unread identity field does. */
  readonly generation: ChildReclaimGeneration;
```

(g) In `childReclaimSweepVerdict`, replace

```ts
  if (!i.identityMeasured) return { eligible: false, why: 'identity-unmeasured' };
```

with

```ts
  if (!i.identityMeasured || i.generation.kind === 'unreadable') return { eligible: false, why: 'identity-unmeasured' };
```

The marker's two words still answer first, and identity still answers before every hold word. So an unreadable generation never reaches `hold-retired`, and the hold-retired memory is dropped with the entry by the lane's existing ineligible arm (`watch.ts`'s `this.childReclaimHoldRetiredSeen.delete(r.id);` after the `hold-retired` branch). The decision is L1's: the lane hands the raw read in and never conjoins it itself.

- [ ] **Step 5: The read, the request's field, and close's literal**

(a) `server/src/coord/childReclaim.ts`:
- Add `import path from 'node:path';` as the file's first line.
- Replace the L0 import's first line

```ts
  CHILD_RUN_ID, LC_REASON_MAX_BYTES, TERMINAL_RUN_STATES, holdReason, type ChildMark, type LifecycleAct, type LifecycleOutcome,
```

with

```ts
  CHILD_RUN_ID, LC_REASON_MAX_BYTES, REG_GENERATION_SHAPE, TERMINAL_RUN_STATES, holdReason, type ChildMark,
  type ChildReclaimGeneration, type ChildReclaimGenerationKey, type LifecycleAct, type LifecycleOutcome,
```

(b) `ChildReclaimRequest`. Replace the docstring's last line and the interface:

```ts
 *  the box and this is not. */
export interface ChildReclaimRequest {
  readonly sessionId: string; readonly runId: number;
  readonly trigger: 'close' | 'sweep'; readonly deferExpired: boolean;
  readonly deferredSinceMs: number | null;
  readonly feedQuiet: ChildReclaimFeedQuiet;
}
```

with

```ts
 *  the box and this is not.
 *
 *  `licenceGeneration`: the registry generation (`$REG/<id>.generation`,
 *  spec §5.5) this request was judged under. The sweep sends its entry's key,
 *  a value or `absent`, on EVERY request, licensed or not. Close sends `none`
 *  (`CHILD_RECLAIM_LICENCE_NONE`): close queues only when the minting run names
 *  this session and no other open run does, so no re-mint of the slug by that
 *  run can follow it. */
export interface ChildReclaimRequest {
  readonly sessionId: string; readonly runId: number;
  readonly trigger: 'close' | 'sweep'; readonly deferExpired: boolean;
  readonly deferredSinceMs: number | null;
  readonly feedQuiet: ChildReclaimFeedQuiet;
  readonly licenceGeneration: ChildReclaimGenerationKey | { readonly kind: 'none' };
}

/** Close's generation (spec §5.5): it judged no generation, and none is compared. */
export const CHILD_RECLAIM_LICENCE_NONE: ChildReclaimRequest['licenceGeneration'] = { kind: 'none' };
```

(c) Directly above `async function childReclaimOutcome(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {`, insert:

```ts
/** THE ONE READ of a registry row's generation, `$REG/<id>.generation` (spec §5.5): the sweep's third key, the
 *  executor's re-read before presence, and the hold-release job's re-read all answer through it. BYTE-EXACT: the
 *  content is taken as `readFileMeasured` returns it, with no trim, no newline strip and no NUL strip, and it is a
 *  `value` only when it is exactly `REG_GENERATION_SHAPE`. `fieldMeasured` is never used here: its trim would accept
 *  a trailing newline and a leading byte-order mark that ccd's own read refuses. `absent` is a PROVEN ENOENT only;
 *  every other failure the port REPORTS is `unreadable`. A port that REJECTS is not caught here (as
 *  `childReclaimPauseRead`): each caller's try answers it (H5). The sweep's gather folds it to `unreadable` for its
 *  row, the executor's re-read defers `marker-unreadable`, and the release job answers `failed`.
 *
 *  THE STATED RESIDUAL: the read follows a symlink on both adapters, so a link to a valid file reads as that value
 *  and a dangling link reads `absent`, where ccd's read refuses both. ccd writes neither shape. A ccd that binds the
 *  generation then audits such a row `unmeasured`, and nothing is spent on it. */
export async function childReclaimGenerationRead(
  io: Pick<FleetIO, 'readFileMeasured'>, registryDir: string, id: string,
): Promise<ChildReclaimGeneration> {
  const read = await io.readFileMeasured(path.join(registryDir, `${id}.generation`));
  if (!read.ok) return read.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  return REG_GENERATION_SHAPE.test(read.content) ? { kind: 'value', v: read.content } : { kind: 'unreadable' };
}
```

No adapter narrows here:
- `absent` passes through as `absent`;
- every other reason is `unreadable`; a rejection propagates (H5), and each caller's try answers it;
- a present value outside the grammar is `unreadable`, which is ccd's own rc 1 for the same bytes.

(d) `server/src/coord/close.ts`, both line-neutral. Replace the import line

```ts
  CHILD_RECLAIM_FEED_QUIET_NONE, childReclaimDecision, childReclaimHasCoordinated, childReclaimRowListing,
```

with

```ts
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_LICENCE_NONE, childReclaimDecision, childReclaimHasCoordinated, childReclaimRowListing,
```

and the request literal's last line

```ts
          feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE } : null,
```

with

```ts
          feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: CHILD_RECLAIM_LICENCE_NONE } : null,
```

- [ ] **Step 6: L4, `server/src/watch.ts`: the gather, the key, the request**

(a) Imports, line-neutral except the one appended name:
- `ChildMark, ChildReclaimAttention, ChildReclaimKeptWord,` → `ChildMark, ChildReclaimAttention, ChildReclaimGeneration, ChildReclaimKeptWord,`, on the `import type { … } from '../../shared/api.js'` line;
- `childReclaimBornAt, childReclaimGeneration, childReclaimLatest,` → `childReclaimBornAt, childReclaimGeneration, childReclaimGenerationRead, childReclaimLatest,`, in the `./coord/childReclaim.js` import;
- `  childReclaimNextEntry, childReclaimSameGeneration,` → `  childReclaimNextEntry, childReclaimSameGeneration, isChildReclaimGenerationKey,`, in the `./childReclaimSweep.js` import.

(b) Directly after `  private lastChildReclaimSweep: number | null = null;`, insert

```ts
  /** The child-reclaim lane's pass counter (spec §5.5, §5.7), bumped as each pass starts its generation gather,
   *  the one await before its loop. A pass whose number is no longer the latest when its gather settles was
   *  OVERTAKEN by a newer pass, and decides nothing: two loops back to back would count one interval's sighting
   *  twice. */
  private childReclaimPassSeq = 0;
```

(c) Two field docstrings, each rewritten in place. In `childReclaimSweepState`'s, replace

```ts
   *  describes one workspace generation; a new birth or a marker naming a new
   *  run replaces it with a first sighting. */
```

with

```ts
   *  describes one workspace generation; a new birth, a marker naming a new
   *  run or a new registry generation replaces it with a first sighting. */
```

In `childReclaimReleaseAnswered`'s, which claims a fact this task falsifies, replace

```ts
   *  `ticking` guard) and this lane awaits nothing before its loop, so only
   *  one pass's listing can predate a release answer; that pass's held row
```

with

```ts
   *  `ticking` guard), this lane's one await before its loop is the generation
   *  gather, and a pass overtaken during it decides nothing (`childReclaimPassSeq`),
   *  so only one pass's listing can predate a release answer; that pass's held row
```

(d) `sweepChildReclaim`'s head. Replace

```ts
    // The lane's two clocks, read ONCE for the pass (spec §5.7). `mono` is
    // the throttle, the in-flight stall clock and the entry's own instants
```

with

```ts
    // THE THROTTLE, stamped BEFORE the gather below (spec §5.7), on the
    // monotonic clock: a tick that lands while this pass gathers is throttled,
    // so no second pass starts within the interval.
    const gate = this.childReclaimLaneNow().monoMs;
    if (this.lastChildReclaimSweep !== null && gate - this.lastChildReclaimSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastChildReclaimSweep = gate;
    // THE PASS'S ONE AWAIT BEFORE ITS LOOP (spec §5.5): every marked row's
    // registry generation, read concurrently. Gathered whole, here, so the
    // per-child loop below stays synchronous: no await sits between a row's
    // entry read and its write. A pass that a newer one OVERTOOK while it
    // gathered (a read slower than the throttle) decides nothing.
    const pass = ++this.childReclaimPassSeq;
    const regGenerations = await this.childReclaimGatherGenerations(records);
    if (pass !== this.childReclaimPassSeq) return;
    // The lane's two clocks, read ONCE for the pass's decisions (spec §5.7),
    // AFTER the gather, so no decision clock is older than the evidence it
    // judges. `mono` is the in-flight stall clock and the entry's own instants
```

and delete the two old throttle lines below the clock reads:

```ts
    if (this.lastChildReclaimSweep !== null && mono - this.lastChildReclaimSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastChildReclaimSweep = mono;
```

(e) The verdict input. Replace

```ts
      const v = childReclaimSweepVerdict({
        sessionId: r.id, child: r.child, identityMeasured: r.unmeasured.length === 0, workspace: r.workspace,
        held, terminal: terminal.has(r.id), mintingRun, reviewedRun, siblings,
```

with

```ts
      // The row's registry generation as this pass gathered it (spec §5.5). A
      // row the gather holds no answer for reads `unreadable`, the unmeasured
      // default, never an optimistic `absent`.
      const regGeneration: ChildReclaimGeneration = regGenerations.get(r.id) ?? { kind: 'unreadable' };
      const v = childReclaimSweepVerdict({
        sessionId: r.id, child: r.child, identityMeasured: r.unmeasured.length === 0, generation: regGeneration,
        workspace: r.workspace, held, terminal: terminal.has(r.id), mintingRun, reviewedRun, siblings,
```

(f) The entry's keys. Replace

```ts
      if (this.childReclaimReleaseAnswered.delete(r.id)) continue;
      const entry = this.childReclaimSweepState.get(r.id);
      // A birth this entry does not describe, or a marker naming a run it was
      // not sighted under, is a recycled slug's NEW workspace (spec §5.6): it
      // starts from a first sighting, never from the old workspace's sighting
      // or presence. The run is the key that changes first: ws-add writes the
      // new marker before the mirror can place the new birth.
      // `v.runId` is the marker's own (`childReclaimSweepVerdict`).
      if (entry === undefined || !childReclaimSameGeneration(entry, childBornAt, v.runId)) {
        this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(mono, childBornAt, v.runId));
        continue;
      }
```

with

```ts
      if (this.childReclaimReleaseAnswered.delete(r.id)) continue;
      // An eligible verdict's generation is a key: the verdict answered
      // `identity-unmeasured` for an unreadable one (L1). This narrows the type
      // and decides nothing (spec §5.5: an unreadable generation seeds no entry).
      if (!isChildReclaimGenerationKey(regGeneration)) { this.childReclaimSweepState.delete(r.id); continue; }
      const entry = this.childReclaimSweepState.get(r.id);
      // A birth this entry does not describe, a marker naming a run it was not
      // sighted under, or a registry generation it does not carry, is a
      // recycled slug's NEW workspace (spec §5.5, §5.6): it starts from a first
      // sighting, never from the old workspace's sighting or presence. The run
      // and the generation change first: ws-add mints the generation and writes
      // the new marker before the mirror can place the new birth.
      // `v.runId` is the marker's own (`childReclaimSweepVerdict`).
      if (entry === undefined || !childReclaimSameGeneration(entry, childBornAt, v.runId, regGeneration)) {
        this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(mono, childBornAt, v.runId, regGeneration));
        continue;
      }
```

(g) The request. Directly after `        feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id),`, insert

```ts
        // THE GENERATION THIS REQUEST WAS JUDGED UNDER (spec §5.5): the
        // entry's own key, which this pass's read matched. Every sweep request
        // carries it, licensed or not, and the executor re-proves it.
        licenceGeneration: entry.generation,
```

(h) The gather. Directly above `  /** The child-reclaim lane's two clocks, read together` (`childReclaimLaneNow`'s docstring), insert

```ts
  /** Every MARKED row's registry generation (spec §5.5), read concurrently
   *  through `childReclaimGenerationRead`: the pass's one await before its
   *  loop. A row whose marker does not read as a child is not read, because
   *  its verdict answers before identity is asked. Each read is bounded by the
   *  io's own request timeout. The reader lets a rejecting port propagate
   *  (H5), so a rejecting read folds to `unreadable` for its row HERE: one
   *  row's rejection is that row's `identity-unmeasured`, never the pass's. */
  private async childReclaimGatherGenerations(
    records: readonly SessionRecord[],
  ): Promise<ReadonlyMap<string, ChildReclaimGeneration>> {
    const marked = records.filter((r) => r.child.kind === 'child');
    const reads = await Promise.all(
      marked.map((r) => childReclaimGenerationRead(this.deps.io, this.deps.cfg.registryDir, r.id)
        .catch((): ChildReclaimGeneration => ({ kind: 'unreadable' }))));
    return new Map(marked.map((r, i): [string, ChildReclaimGeneration] => [r.id, reads[i]!]));
  }

```

The lane DECIDES nothing new:
- the identity decision is L1's (Step 4 (g));
- the gather's `.catch` folds a rejection to `unreadable`, the unmeasured default, exactly as the loop's `?? { kind: 'unreadable' }` does for a row the gather holds no answer for (H5);
- the third key's comparison is L1's;
- the narrowing in (f) is type-forced, and Step 9's T2.13 shows `tsc` refuses its deletion;
- `childReclaimWriteBack`'s identity guard (`get(id) !== entry`) is unchanged. It drops an answer to an entry a re-sighting replaced.

- [ ] **Step 7: The existing suites' mechanical edits (the named lines, nothing else)**

`ChildReclaimRequest.licenceGeneration`, `ChildReclaimSweepInput.generation` and the four-argument key functions are REQUIRED. So `test/tsconfig.tests.json` names every literal and call that must carry them, and the exact `toEqual`s on requests red until they do. Run from `server/`:

```bash
# (a) every ChildReclaimRequest literal gains its licenceGeneration: close's `none`, a sweep's `absent` (no fixture
#     below writes `$REG/<id>.generation`, so `absent` is what the lane reads for those rows, and what Task 3's
#     executor re-read will find).
perl -0pi -e "s/(trigger: 'close'[^}]*?feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE)/\$1, licenceGeneration: { kind: 'none' }/gs; s/(trigger: 'sweep'[^}]*?feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE)/\$1, licenceGeneration: { kind: 'absent' }/gs" \
  test/child-reclaim-close.test.ts test/child-reclaim-paused-at-server.test.ts test/child-reclaim-pre-crumb.test.ts \
  test/child-reclaim-sweep.test.ts test/child-reclaim.test.ts
perl -pi -e "s/^(                deferExpired, deferredSinceMs, feedQuiet)( \}\) \};)\$/\$1, licenceGeneration: deferredSinceMs === null ? { kind: 'none' } : { kind: 'absent' }\$2/" test/child-reclaim.test.ts
# (b) every first sighting and generation compare gains the third key
perl -pi -e "s/childReclaimFirstSighting\(([^()]*)\)/childReclaimFirstSighting(\$1, { kind: 'absent' })/g; s/childReclaimSameGeneration(\(((?:[^()]++|(?1))*)\))/childReclaimSameGeneration(\$2, { kind: 'absent' })/g" \
  test/child-reclaim-sweep-policy.test.ts test/child-reclaim-status.test.ts test/child-reclaim-runs-route.test.ts
# (c) the policy suite's base input reads a generation, and its exact first sighting carries it
perl -pi -e "s/^  identityMeasured: true,\$/  identityMeasured: true,\n  generation: { kind: 'absent' },/" test/child-reclaim-sweep-policy.test.ts
perl -pi -e "s/bornAt: BORN, markerRunId: RUN,\$/bornAt: BORN, markerRunId: RUN, generation: { kind: 'absent' },/" test/child-reclaim-sweep-policy.test.ts
git diff --numstat -- test/child-reclaim-close.test.ts test/child-reclaim-paused-at-server.test.ts test/child-reclaim-pre-crumb.test.ts \
  test/child-reclaim-sweep.test.ts test/child-reclaim.test.ts test/child-reclaim-sweep-policy.test.ts \
  test/child-reclaim-status.test.ts test/child-reclaim-runs-route.test.ts
```

Expected `numstat` at `226bb881c`, as `+ -` pairs:

| File | + | - |
|---|---|---|
| `child-reclaim-close` | 3 | 3 |
| `child-reclaim-paused-at-server` | 14 | 14 |
| `child-reclaim-pre-crumb` | 1 | 1 |
| `child-reclaim-sweep` | 10 | 10 |
| `child-reclaim` | 2 | 2 |
| `child-reclaim-sweep-policy` | 15 | 14 |
| `child-reclaim-status` | 1 | 1 |
| `child-reclaim-runs-route` | 2 | 2 |

These are measured. A later programme's extra literal shows up as a `tsc` TS2741 or TS2554 at its own line: add the same argument there, by the rule above.

Then rewrite `child-reclaim-sweep.test.ts`'s `passDispatched` helper. Its docstring states the property this task changes ("`sweepChildReclaim` has no `await` between its own entry and the per-child loop's `queue.run` call"). Measured: unfixed, `a release that FAILS after being in flight across TWO passes … never double-queues while in flight` reds `retried on the pass right after a failure: expected [ [ 'ws-release', …(6) ], …(1) ] to have a length of 1 but got 2`. Replace the whole helper:

```ts
  /** Like `pass`, but returns as soon as the decision is MADE, not once it
   *  has SETTLED: `sweepChildReclaim` has no `await` between its own entry
   *  and the per-child loop's `queue.run` call, so by the time the call
   *  below returns (a plain synchronous call, its own promise merely
   *  captured, never adopted by an enclosing `return`), any enqueue for this
   *  pass has already happened — real, awaited fs I/O only for the registry
   *  read ahead of it. The caller gets the still-pending completion back, to
   *  await once whatever it queued behind can proceed — never blocked on it
   *  immediately, which would hang forever if the very guard under test had
   *  failed to guard. */
  const passDispatched = async (): Promise<{ settle: Promise<void> }> => {
    const records = await readRegistry(deps.io, cfg);
    const settle = watcher.sweepChildReclaim(records, readdirSync(reg));
    return { settle };
  };
```

with

```ts
  /** Like `pass`, but returns as soon as the decision is MADE, not once it
   *  has SETTLED. `sweepChildReclaim`'s one `await` before its per-child loop
   *  is the generation gather (spec §5.5), and from the loop to its
   *  `queue.run` calls it awaits nothing. So this waits until the pass has
   *  replaced its verdict map (`currentChildReclaimVerdicts()`, replaced whole
   *  by every judging pass in the same synchronous run as every enqueue): by
   *  then any enqueue for this pass has already happened. The caller gets the
   *  still-pending completion back, to await once whatever it queued behind
   *  can proceed — never blocked on it immediately, which would hang forever
   *  if the very guard under test had failed to guard. */
  const passDispatched = async (): Promise<{ settle: Promise<void> }> => {
    const records = await readRegistry(deps.io, cfg);
    const before = watcher.currentChildReclaimVerdicts();
    const settle = watcher.sweepChildReclaim(records, readdirSync(reg));
    await vi.waitFor(() => expect(watcher.currentChildReclaimVerdicts(), 'the pass has not judged yet').not.toBe(before));
    return { settle };
  };
```

After this, `child-reclaim-sweep.test.ts`'s `numstat` reads `21 19`. No other existing line changes.

- [ ] **Step 8: Run to green: the new files, the touched suites, the readers' scans, both `tsc`, the citation cases**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation-key.test.ts test/child-reclaim-generation-lane.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation-key.test.ts test/child-reclaim-generation-lane.test.ts \
  test/child-reclaim-sweep.test.ts test/child-reclaim-sweep-policy.test.ts test/child-reclaim-status.test.ts \
  test/child-reclaim-runs-route.test.ts test/child-reclaim-close.test.ts test/child-reclaim-paused-at-server.test.ts \
  test/child-reclaim-pre-crumb.test.ts test/child-reclaim.test.ts test/child-reclaim-verdict-readers.test.ts \
  test/child-reclaim-chip-source.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
git diff --stat -- shared/api.ts README.md server/test/single-definition.test.ts   # prints nothing
```

Expected:
- The new files: `Test Files  2 passed (2)`, `Tests  37 passed (37)` (35 measured at planning, plus H5's two cases). Measured at about 3 s.
- The twelve files: `Test Files  12 passed (12)`, `883 passed (883)` (881 measured, plus H5's two cases; about 60 s).
- Both `tsc` runs print nothing. The citation cases print `5 passed`. `typecheck-tests` is green; it is a known load flake, so re-run it in isolation before calling it red.
- The last line prints nothing.

Then run every other suite that drives the lane: `grep -rln "sweepChildReclaim\|childReclaimExec" server/test`, each file through vitest. All green.

- [ ] **Step 9: Mutation check**

Make each mutation alone, record its red, and revert it before the next. Every row was measured at planning, on the export with Tasks 1 and 2 applied. `K` is `test/child-reclaim-generation-key.test.ts`, and `L` is `test/child-reclaim-generation-lane.test.ts`. H5 added one case to each (K 27, L 10): the counts below that include them are derived from the measured ones, and T2.6 and T2.15 are H5's rows; re-measure them.

| # | Mutation (exact edit) | Command (`cd server && ./node_modules/.bin/vitest run …`) | Expected red |
|---|---|---|---|
| T2.1 | `childReclaimSweepVerdict`: `if (!i.identityMeasured \|\| i.generation.kind === 'unreadable') return` → `if (!i.identityMeasured) return` | `K L` | `5 failed \| 32 passed (37)`. L, the rejecting-read case: `expected { eligible: true, runId: <n> } to deeply equal { eligible: false, …(1) }`. K, `unreadable is the doubt word …`: `expected { eligible: true, runId: 7 } to deeply equal { eligible: false, …(1) }`. K, `it answers ahead of every hold …`: `expected { eligible: false, …(3) } to deeply equal { eligible: false, …(1) }`. L, `the verdict is the doubt word …`: `expected { eligible: true, runId: 1 } to deeply equal { eligible: false, …(1) }`. L, `it drops the hold-retired memory …`: `expected [ [ 'ws-release', '--session', …(5) ] ] to deeply equal []` |
| T2.2 | `childReclaimSameGeneration`: delete its last line, `  && childReclaimSameGenerationKey(entry.generation, generation);`, ending the line above with `;` | `K L` | `3 failed \| 34 passed (37)`. K: `a same-run re-mint: only the generation moved: expected true to be false`. L, both third-key cases: `expected [ { sessionId: 'demo-a', …(6) } ] to deeply equal []` |
| T2.3 | `childReclaimSameGenerationKey`: `b.kind === 'value' && a.v === b.v` → `b.kind === 'value'` | `K L` | `4 failed \| 33 passed (37)`. K, `a different value does not` and `a value one byte apart does not`: `expected true to be false`. K, the same-run re-mint case. L, `a generation that moves …`: `the old sighting does not count for the new generation: expected [ { sessionId: 'demo-a', …(6) } ] to deeply equal []` |
| T2.4 | `childReclaimGenerationRead`: `.test(read.content)` and `v: read.content` → `.test(read.content.trim())` and `v: read.content.trim()`, which is `fieldMeasured`'s trim | `K L` | `5 failed \| 32 passed (37)`. K, the LF, byte-order-mark and leading-space rows: `expected { kind: 'value', …(1) } to deeply equal { kind: 'unreadable' }`. L: both unreadable cases |
| T2.5 | `childReclaimGenerationRead`: `if (!read.ok) return read.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };` → `if (!read.ok) return { kind: 'absent' };` | `K` | `2 failed \| 25 passed (27)`. `a directory at the name is unreadable, never absent`: `expected { kind: 'absent' } to deeply equal { kind: 'unreadable' }`, and `a failed read is unreadable, never absent` |
| T2.6 | `childReclaimGatherGenerations`: delete the `.catch((): ChildReclaimGeneration => ({ kind: 'unreadable' }))` on the read in the `map` | `L` | `1 failed \| 9 passed (10)`: `the row reads identity-unmeasured and seeds nothing; …` rejects with `Error: agent gone`: one row's rejection fails the whole pass |
| T2.7 | `childReclaimGatherGenerations`: replace the `Promise.all` with `const reads: ChildReclaimGeneration[] = []; for (const r of marked) reads.push(await childReclaimGenerationRead(this.deps.io, this.deps.cfg.registryDir, r.id).catch((): ChildReclaimGeneration => ({ kind: 'unreadable' })));` | `L` | `1 failed \| 9 passed (10)`: `gathered concurrently, never one after another: expected 1 to be 3` |
| T2.8 | In the loop, `regGenerations.get(r.id) ?? { kind: 'unreadable' }` → `regGenerations.get(r.id) ?? await Promise.resolve({ kind: 'unreadable' as const })`, an await between an entry's read and its write | `L` | `1 failed \| 9 passed (10)`: `the pass awaits twice …`: `expected [ <gather>, <n>, <acts> ] to deeply equal [ <gather>, <acts> ]` |
| T2.9 | Move `    this.lastChildReclaimSweep = gate;` to directly below `    if (pass !== this.childReclaimPassSeq) return;`, stamping the throttle after the gather | `L` | `2 failed \| 8 passed (10)`. `the pass awaits twice …`: `expected <n> to be less than <m>`. `a tick that lands while a pass gathers …`: `the second pass gathered nothing: expected [ 'demo-a.generation', …(1) ] to deeply equal [ 'demo-a.generation' ]` |
| T2.10 | Delete `    if (pass !== this.childReclaimPassSeq) return;` | `L` | `1 failed \| 9 passed (10)`: `A decided nothing: its loop would have been a second sighting: expected [ { sessionId: 'demo-a', …(6) } ] to deeply equal []` |
| T2.11 | The request: `licenceGeneration: entry.generation,` → `licenceGeneration: { kind: 'absent' },` | `L` | `3 failed \| 7 passed (10)`: `a value, or absent, …`: `expected [ …(2) ] to deeply equal [ [ 'demo-a', …(1) ], …(1) ]`; `a generation that moves …`: `expected [ { kind: 'absent' } ] to deeply equal [ { kind: 'value', …(1) } ]`; and the unreadable case's last assertion |
| T2.12 | The gather's filter: `r.child.kind === 'child'` → `r.child.kind !== 'unreadable'` | `L` | `1 failed \| 9 passed (10)`: `expected [ 'demo-a.generation', …(3) ] to deeply equal [ 'demo-a.generation', …(2) ]` |
| T2.13 | Delete the narrowing line `      if (!isChildReclaimGenerationKey(regGeneration)) { this.childReclaimSweepState.delete(r.id); continue; }` | `./node_modules/.bin/tsc --noEmit -p .` | `src/watch.ts(…): error TS2345: Argument of type 'ChildReclaimGeneration' is not assignable to parameter of type 'ChildReclaimGenerationKey'.` |
| T2.14 | Step 7's helper in place, then the in-flight guard: `          if (!this.childReclaimInFlight.has(r.id)) {` → `          if (true) {` (the hold-retired branch) | `test/child-reclaim-sweep.test.ts -t 'never double-queues while in flight'` | `never re-enqueues demo-a while the first release is still in flight: expected [ 'demo-a', 'demo-a' ] to have a length of 1 but got 2`. The rewritten helper still sees the decision it guards |
| T2.15 | `childReclaimGenerationRead`: re-wrap the read, `let read; try { read = await io.readFileMeasured(path.join(registryDir, `${id}.generation`)); } catch { return { kind: 'unreadable' }; }` | `K` | `1 failed \| 26 passed (27)`: `a rejecting port is not caught: …`: `promise resolved "{ kind: 'unreadable' }" instead of rejecting`. A caller's try could then never see a rejection, which Tasks 3 and 4 rely on (H5) |

Revert each mutation, then re-run Step 8's first two commands green.

- [ ] **Step 10: Commit**

```bash
git add server/src/childReclaimSweep.ts server/src/coord/childReclaim.ts server/src/coord/close.ts server/src/watch.ts \
  server/test/child-reclaim-generation-key.test.ts server/test/child-reclaim-generation-lane.test.ts \
  server/test/child-reclaim-sweep.test.ts server/test/child-reclaim-sweep-policy.test.ts \
  server/test/child-reclaim-status.test.ts server/test/child-reclaim-runs-route.test.ts \
  server/test/child-reclaim-close.test.ts server/test/child-reclaim-paused-at-server.test.ts \
  server/test/child-reclaim-pre-crumb.test.ts server/test/child-reclaim.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the sweep keys every child and every request on the registry generation

The sweep reads $REG/<id>.generation for every marked row, byte-exact and
three-way (value, a proven absent, unreadable), through one reader whose
port rejection the caller answers (spec §5.5): the gather folds one to
unreadable for its row. The reads are gathered concurrently before the
per-child loop, so the loop stays synchronous: no await sits between an
entry's read and its write. The throttle is stamped before the gather, a
pass overtaken during its gather decides nothing, and the pass's clock is
read after it. The generation is the entry's third key beside the birth and
the marker's run. An unreadable one is the doubt word identity-unmeasured,
which seeds no entry and drops the hold-retired memory. Every sweep request
carries the entry's key as licenceGeneration; close's carries none.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```
---

### Task 3: X1's executor half — the re-read before presence, the audit's `generation`, and close's `none`

**Model routing:** **`opus`, effort `high`**. SAFETY: this task decides whether a queued `ws-reclaim` licence is spent, and on which workspace. It is the server's link in the chain of four equal generations (contract R73), and the subject of this wave's SAFETY lens.

**Why:** Review 303's X1 (contract R63) is a licensed request, already queued (`deferExpired`), that reaches the SAME run's re-minted workspace. Today the executor re-proves a request against the marker's run id alone, and presence is skipped under `deferExpired`. Task 2 gave every sweep request `licenceGeneration`, the generation the sweep judged it under. This task makes the executor hold the request to it:
- **(d) the re-read, step 2c.** After step 2b and BEFORE step 3 (presence), for EVERY sweep request, licensed or not. A value or `absent` that differs from the licence defers the NEW word `generation-changed`. An unreadable re-read defers `marker-unreadable`, with its own detail, never `generation-changed`.
- **(e) the audit's key, step 5a.** `parseChildReclaimAudit` reads the audit's `generation` by `hasOwnProperty`, in four arms. A valid value equal to the licence proceeds. A valid value that differs defers `generation-changed`. `null` or a malformed value makes the whole document `unreadable`, so its token is never spent. An ABSENT key (an older ccd) never spends a LICENSED request: it defers `unsupported`, and the detail says the host's `ws-audit` prints no generation. An unlicensed request relies on step 2c.
- **(c) close's `none`** skips step 2c and is never compared at step 5a. Close queues only when the minting row names this session and no other open run does, so no same-run re-mint can follow a close. The `null` and malformed arms of (e) still apply to close.
- On a refused document the key gates nothing. No exit-1 audit token is ever spent (unchanged).

R73's stated residual is pinned as a residual: on an older ccd, an UNLICENSED request keeps the gap between step 2c's read and the act.

**Entry (measured in Step 0):** Task 1 and Task 2 are committed on this branch, and so is wave 7's tree: wave 8 dispatches only after wave 7 (run 347) has merged, and Task 0 brought it in (ruling H1). This task's executor cases drive a MODEL of wave 7's binding (`modelCcd`). Wave 7's real binding is pinned on a real ccd by its own `ccd-child-reclaim-row-generation.test.ts`, whose two server-side `absence-permits` cases this task flips in its own commit (Step 4(f); the accepted departure `wave7-generation-pins-owed`).

**Files:**
- Modify: `server/src/coord/childReclaim.ts`. Line numbers are hints at `226bb881c`; locate each by its grep.
  - The `../childReclaimSweep.js` import (`:11`; `grep -n "^} from '../childReclaimSweep.js';" server/src/coord/childReclaim.ts`) gains `childReclaimSameGenerationKey`. The `../../../shared/api.js` import (`:19`) gains `REG_GENERATION_SHAPE`, `type ChildReclaimGeneration` and `type ChildReclaimGenerationKey`, each only where Task 2 did not already add it.
  - `ChildReclaimDeferWhy` (`:202`; `grep -n "^export type ChildReclaimDeferWhy =" server/src/coord/childReclaim.ts`) and `CHILD_RECLAIM_DEFER_WHY` (`:207`; `grep -n "^const CHILD_RECLAIM_DEFER_WHY" …`) gain `'generation-changed'`. Two constants and one helper go directly below `isChildReclaimDeferWhy`.
  - `ChildReclaimAuditRead` (`:595`; `grep -n "^export type ChildReclaimAuditRead =" …`) and `parseChildReclaimAudit`'s reclaimable branch (`:619` and `:630`; `grep -n "if (v.verdict === 'reclaimable') {\|return { kind: 'token', token: v.token, childOf: v.childOf };" …`).
  - `reclaimChild`'s docstring (`:789`; `grep -n "Re-reads everything it" …`).
  - `childReclaimOutcome`. Step 2c goes between step 2b's last block (`if (pause !== 'clear') {`, `:915`) and `// 3 — a human looking at it` (`:920`). Step 5a goes directly below the `if (audit.childOf !== runId) {` block (`:935`) and above `// 6 — the act.` (`:938`).
- Modify: `server/test/child-reclaim.test.ts`, three cases and one import only, each named in Step 4.
- Modify: `server/test/ccd-child-reclaim-row-generation.test.ts`, wave 7's file, which Task 0 brought in (H1); the edit is unconditional. Its server describe is located by `grep -n "absence-permits" server/test/ccd-child-reclaim-row-generation.test.ts`. See Step 4.
- Create: `server/test/childReclaimGenerationFixture.ts`. Task 4 imports it too.
- Create: `server/test/child-reclaim-licence-executor.test.ts` (R56: new cases go in a new file).
- Create: `server/test/child-reclaim-licence-lane.test.ts`.
- No edit to `shared/api.ts`, `README.md`, `single-definition.test.ts`, `server/src/watch.ts` or `server/src/coord/close.ts`. Close's `none` is Task 2's (see Step 0). So this task owes no README re-pointing and waits on no claim.

**Interfaces:**
- Consumes:
  ```ts
  // Task 1 — shared/api.ts (L0)
  export const REG_GENERATION_SHAPE: RegExp;   // 36 characters, no `m` flag
  export type ChildReclaimGeneration = { kind: 'value'; v: string } | { kind: 'absent' } | { kind: 'unreadable' };
  export type ChildReclaimGenerationKey = { kind: 'value'; v: string } | { kind: 'absent' };
  // Task 2 — server/src/coord/childReclaim.ts
  ChildReclaimRequest.licenceGeneration: ChildReclaimGenerationKey | { kind: 'none' };   // REQUIRED. The sweep: its entry's key; close: none
  export const CHILD_RECLAIM_LICENCE_NONE: ChildReclaimRequest['licenceGeneration'];   // { kind: 'none' }: close's literal (H4)
  childReclaimGenerationRead(io, registryDir: string, id: string): Promise<ChildReclaimGeneration>;
  //   readFileMeasured, byte-exact; `absent` only on a proven ENOENT. It never rejects on either shipped adapter,
  //   and, like `childReclaimPauseRead`, it does not catch a rejecting port: the caller's try does (ruling H5).
  //   Its three callers: the sweep's gather folds a rejection to `unreadable` for that row; step 2c (here) defers
  //   `marker-unreadable`; Task 4's release step 7 answers `failed`.
  // Task 2 — server/src/childReclaimSweep.ts (L1)
  childReclaimSameGenerationKey(a: ChildReclaimGenerationKey, b: ChildReclaimGenerationKey): boolean;
  //   Task 2's sweep side: the third key replaces an entry whose generation differs, and an unreadable read answers identity-unmeasured.
  ```
- Produces:
  ```ts
  // server/src/coord/childReclaim.ts
  export type ChildReclaimDeferWhy = … | 'generation-changed' | …;   // the server's own word, never ccd's
  export const CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE: string;
  export type ChildReclaimAuditGeneration =
    | { readonly kind: 'value'; readonly v: string }
    | { readonly kind: 'unprinted' };   // an older ccd's document with no `generation` key; never the row's own `absent`
  export type ChildReclaimAuditRead =
    | { readonly kind: 'token'; readonly token: string; readonly childOf: number; readonly generation: ChildReclaimAuditGeneration }
    | { readonly kind: 'refused'; readonly token: ChildReclaimToken; readonly detail: string }
    | { readonly kind: 'unreadable'; readonly detail: string };
  // childReclaimOutcome: step 2c (the re-read before presence) and step 5a (the audit's generation against the licence)

  // server/test/childReclaimGenerationFixture.ts
  export const G1: string; export const G2: string;
  export interface CcdAnswer { readonly code: number; readonly stdout: string; readonly stderr?: string }
  export interface CcdHooks { beforeAudit?: () => void; beforeAct?: () => void; afterReclaim?: () => void }
  export function modelCcd(o: { reg: string; id: string; wave7: boolean; hooks: CcdHooks }): (args: readonly string[]) => CcdAnswer | undefined;
  export interface LaneOpts { ccd?: (reg: string) => (args: readonly string[]) => CcdAnswer | undefined;
    visible?: (id: string) => boolean; afterRead?: (p: string) => void }
  export const laneFixture: (opts?: LaneOpts) => { reg; coord; watcher; calls; requests; outcomes; queue; plant; openRun;
    abandon; finishedChild; remint; listing; sweepOn; pass; next; releases };
  export type Lane = ReturnType<typeof laneFixture>;
  ```

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

```bash
grep -n "licenceGeneration" server/src/coord/childReclaim.ts server/src/coord/close.ts server/src/watch.ts
grep -n "childReclaimGenerationRead" server/src/coord/childReclaim.ts server/src/watch.ts
grep -n "childReclaimSameGenerationKey" server/src/childReclaimSweep.ts
grep -n "export const REG_GENERATION_SHAPE\|export type ChildReclaimGeneration\b\|export type ChildReclaimGenerationKey" shared/api.ts
grep -n "licenceGeneration" server/test/child-reclaim.test.ts
grep -n "CHILD_RECLAIM_LICENCE_NONE" server/src/coord/childReclaim.ts server/src/coord/close.ts
ls server/test/ccd-child-reclaim-row-generation.test.ts
grep -n "absence-permits" server/test/ccd-child-reclaim-row-generation.test.ts
```

Expected:
- `ChildReclaimRequest` declares `licenceGeneration` as a REQUIRED field.
- The sweep's request literal in `watch.ts` sets it from the entry.
- Close's request literal (`grep -n "feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE" server/src/coord/close.ts`) sets `licenceGeneration: CHILD_RECLAIM_LICENCE_NONE` (Task 2's constant, `{ kind: 'none' }`; ruling H4).
- The `ls` finds wave 7's file, and the last grep finds its `absence-permits` describe (H1).
- `childReclaimGenerationRead` is exported and called by the sweep's gathered read.

If the field is optional, or close's request literal carries no `licenceGeneration` at all, STOP and report `licence-field-shape`: the shared interface fixes the field as required, and close's `none` is Task 2's (H4). `CHILD_RECLAIM_LICENCE_NONE` and a literal `{ kind: 'none' }` are the same `none`; either passes. Note how Task 2 shaped `child-reclaim.test.ts`'s `rig().req(...)` (the `child-reclaim.test.ts` grep): Step 4 overrides the field explicitly wherever it matters, so either shape works. If the `ls` finds no wave 7 file, or its `absence-permits` describe is missing, STOP and report: Task 0 brought wave 7's tree (H1); no merge mid-wave.

- [ ] **Step 1: Write the shared fixture**

Create `server/test/childReclaimGenerationFixture.ts`:

```ts
// Child reclamation wave 8 (spec §5.5, §5.6, §5.7): what the generation cases share —
// `child-reclaim-licence-executor.test.ts`, `child-reclaim-licence-lane.test.ts` and
// `child-reclaim-hold-retired-generation.test.ts`. Two generations of one workspace name; a MODEL of the
// fleet box's two reclaim verbs, wave 7's and an older ccd's; and a compact lane rig.
//
// The lane rig is `child-reclaim-sweep.test.ts`'s `fixture`, cut to what these cases need (that one is
// not exported): a real `FleetWatcher`, a real `CoordStore`, a registry under a fixture HOME, the REAL
// executor and the REAL release job on the watcher's own `KeyedQueue`, and a scripted ccd behind the
// agent's real exec whitelist (`testDeps`). The executor is reached through `Deps.childReclaimExec`,
// the watcher's one seam, composed exactly as `execChildReclaim` composes it, so that each request and
// its answer can be recorded. `child-reclaim-sweep.test.ts`'s "the production path" pins that
// composition. FIXTURE HOME ONLY: every path derives from `mkTmp`.
//
// THE ONE WATCHER RIG (ruling H7). A later task that needs more of it adds an option to `LaneOpts`, or a
// member to what `laneFixture` returns, additively and in its own commit. It never builds a second
// `FleetWatcher` rig.
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { reclaimChild, type ChildReclaimOutcome, type ChildReclaimRequest } from '../src/coord/childReclaim.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { REG_GENERATION_SHAPE } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** Two generations of one workspace name: 36 characters each, `REG_GENERATION_SHAPE`'s grammar. */
export const G1 = '0a1b2c3d-0000-4000-8000-00000000000a';
export const G2 = '0a1b2c3d-0000-4000-8000-00000000000b';

export interface CcdAnswer { readonly code: number; readonly stdout: string; readonly stderr?: string }
/** Moments inside the two verbs where a case re-mints the slug. They are read when the verb runs, so a
 *  case sets them on the object it handed the model. */
export interface CcdHooks { beforeAudit?: () => void; beforeAct?: () => void; afterReclaim?: () => void }

/**
 * `ccd ws-audit --reclaim` and `ccd ws-reclaim` for ONE child, as the server sees them (spec §5.5).
 * - `wave7: true` is wave 7's ccd. The audit reads the row's generation as it stands, mints its token
 *   over it, and prints it as `generation`. An absent or malformed generation is the audit's
 *   `unmeasured`, at exit 1, with `generation: null` and no token. The verb recomputes the token under
 *   its lock, and refuses `state-changed` when the token no longer binds the row under the name.
 * - `wave7: false` is an older ccd. It prints no `generation` key, and its token binds no generation,
 *   so the token is spent on whatever row stands under the name.
 * This is a MODEL of the binding, never the binding: wave 7's `ccd-child-reclaim-row-generation.test.ts`
 * pins the real one on a real ccd. Any other argv answers `undefined`, and the caller answers it.
 */
export function modelCcd(o: { readonly reg: string; readonly id: string; readonly wave7: boolean; readonly hooks: CcdHooks }):
  (args: readonly string[]) => CcdAnswer | undefined {
  const file = (field: string): string => path.join(o.reg, `${o.id}.${field}`);
  const current = (): string | null => { try { return readFileSync(file('generation'), 'utf8'); } catch { return null; } };
  const tokenOf = (g: string | null): string =>
    createHash('sha256').update(o.wave7 ? `id=${o.id} generation=${g ?? ''}` : `id=${o.id}`).digest('hex');
  const listed = (): boolean => readdirSync(o.reg).includes(`${o.id}.uuid`);
  return (args) => {
    if (args[0] === 'ws-audit') {
      o.hooks.beforeAudit?.();
      if (!listed()) {
        return { code: 0, stdout: JSON.stringify({ id: o.id, mode: 'reclaim', childOf: null, verdict: 'no-such-session', detail: '' }) };
      }
      const head = { id: o.id, mode: 'reclaim', childOf: Number(readFileSync(file('child'), 'utf8')) };
      if (!o.wave7) return { code: 0, stdout: JSON.stringify({ ...head, verdict: 'reclaimable', detail: '', token: tokenOf(null) }) };
      const g = current();
      if (g === null || !REG_GENERATION_SHAPE.test(g)) {
        return { code: 1, stdout: JSON.stringify({ ...head, generation: null, verdict: 'unmeasured',
          detail: `${o.id}.generation could not be read as this row's generation` }) };
      }
      return { code: 0, stdout: JSON.stringify({ ...head, generation: g, verdict: 'reclaimable', detail: '', token: tokenOf(g) }) };
    }
    if (args[0] === 'ws-reclaim') {
      o.hooks.beforeAct?.();
      const spent = args[args.indexOf('--expect') + 1];
      if (!listed() || spent !== tokenOf(o.wave7 ? current() : null)) {
        return { code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'the token no longer binds this row' }) };
      }
      for (const n of readdirSync(o.reg)) if (n.startsWith(`${o.id}.`)) rmSync(path.join(o.reg, n), { recursive: true, force: true });
      o.hooks.afterReclaim?.();
      return { code: 0, stdout: JSON.stringify({ reclaimed: o.id, childOf: Number(args[args.indexOf('--child-of') + 1]),
        wip: null, attic: 2, residueBytes: null, secretsDropped: 0 }) };
    }
    return undefined;
  };
}

export interface LaneOpts {
  /** `ws-audit`/`ws-reclaim`, given the registry directory (`modelCcd`, or a script). `ws-release` is
   *  answered as `cmd_ws_release` answers it. Any other argv exits 1. */
  readonly ccd?: (reg: string) => (args: readonly string[]) => CcdAnswer | undefined;
  /** Someone is viewing this session: the executor's presence port. */
  readonly visible?: (id: string) => boolean;
  /** Runs after EVERY `readFileMeasured` the server makes, with its path, so a case can re-mint at an exact read. */
  readonly afterRead?: (p: string) => void;
}

export const laneFixture = (opts: LaneOpts = {}) => {
  let clock = 1_790_000_000_000;
  let mono = 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-child-reclaim-generation-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const ccd = opts.ccd?.(reg);
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'ws-release') {
      const id = args[args.indexOf('--session') + 1] ?? '';
      try { rmSync(path.join(reg, `${id}.hold`)); return { code: 0, stdout: `released ${id}\n`, stderr: '' }; }
      catch { return { code: 0, stdout: `not held ${id}\n`, stderr: '' }; }
    }
    const a = ccd?.(args);
    return a === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` }
      : { code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
  };
  const base = testDeps(home, run);
  const io: FleetIO = {
    ...base.io,
    readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      const r = await base.io.readFileMeasured(p, timeoutMs, signal);
      opts.afterRead?.(p);
      return r;
    },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const fleetState: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
    ccdVerbs: ['ws-audit', 'ws-reclaim', 'ws-release', RECLAIM_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP] };
  const presence = { isVisible: (id: string) => opts.visible?.(id) === true };
  const requests: ChildReclaimRequest[] = [];
  const outcomes: ChildReclaimOutcome[] = [];
  const deps = {
    ...base, cfg, io, coord, fleetState, presence, monotonicMs: () => mono,
    childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
      requests.push(req);
      const o = await base.queue.run(req.sessionId, () => reclaimChild(
        { coord, io, cfg, runCcd: base.runCcd, fleetState, presence }, req));
      outcomes.push(o);
      return o;
    },
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  let uidN = 0;
  /** A registry row as ws-add writes it, with its `create` journalled. `extra` lands as `<id>.<field>`
   *  files: `child`, `hold`, `generation`. */
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = { uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1', ...extra };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    uidN += 1;
    const line = JSON.stringify({ uid: `w8.1.${uidN}`, at: clock, act: 'create', outcome: 'done', verb: 'ws-add', id });
    coord.ingestJournal({ gen: '1790000000000000000', rows: [parseJournalLine(line)], cursor: uidN * 200,
      size: uidN * 200, at: clock });
  };
  let progN = 0;
  const openRun = (): { id: number; program: string } => {
    const program = `w8-prog-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    return { id: r.id, program };
  };
  const abandon = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null,
      program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`abandon refused: ${JSON.stringify(res)}`);
  };
  /** A child of an abandoned run, carrying `generation` (`null`: no file). */
  const finishedChild = (id: string, generation: string | null): { id: number; program: string } => {
    const r = openRun(); abandon(r);
    plant(id, { child: String(r.id), ...(generation === null ? {} : { generation }) });
    return r;
  };
  /** The SAME row with its generation re-minted: a same-run re-mint, in the window where only the
   *  generation tells it apart (spec §5.6). */
  const remint = (id: string, g: string): void => { writeFileSync(path.join(reg, `${id}.generation`), g); };
  const listing = async () => ({ records: await readRegistry(io, cfg), names: readdirSync(reg) });
  const sweepOn = async (l: Awaited<ReturnType<typeof listing>>): Promise<void> => {
    await watcher.sweepChildReclaim(l.records, l.names);
  };
  const pass = async (): Promise<void> => { await sweepOn(await listing()); };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  const releases = (): string[][] => calls.filter((c) => c[0] === 'ws-release');
  return { reg, coord, watcher, calls, requests, outcomes, queue: base.queue, plant, openRun, abandon,
    finishedChild, remint, listing, sweepOn, pass, next, releases };
};
export type Lane = ReturnType<typeof laneFixture>;
```

- [ ] **Step 2: Write the failing tests**

Create `server/test/child-reclaim-licence-executor.test.ts`:

```ts
// Child reclamation wave 8, X1 in the executor (spec §5.5, §5.7). A sweep request carries
// `licenceGeneration`: the workspace generation the sweep judged it under, from its own byte-exact
// read. The executor re-reads the generation after the switch and before presence, for EVERY sweep
// request, licensed or not (step 2c). It then compares the audit's own `generation` with the licence
// before it spends the token (step 5a). Close's requests carry `none` and skip both. With the sweep's
// read and ccd's token under its lock, that makes four equal generations from the licence to the act,
// so a licence never crosses a generation, wherever in the request's life the slug is minted again.
// This file takes the later points: between the re-read and the audit, between the audit and the act,
// and between two requests queued for one id. `child-reclaim-licence-lane.test.ts` takes the earlier ones.
//
// The ccd is `modelCcd` (wave 7's binding, or an older ccd without one), or a script for a document no
// correct ccd prints. It runs behind the agent's REAL exec whitelist (`testDeps`). FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE, CHILD_RECLAIM_TOKEN_KIND,
  isChildReclaimDeferWhy, isChildReclaimKebab, parseChildReclaimAudit, reclaimChild,
  type ChildReclaimDeps, type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_PRESENCE_DEFERS, type ChildReclaimFeedQuiet } from '../src/childReclaimSweep.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { LC_REFUSAL_TOKENS, type ChildReclaimGenerationKey } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { G1, G2, modelCcd, type CcdAnswer, type CcdHooks } from './childReclaimGenerationFixture.js';

const ID = 'demo-quiet-basin';
const TOK = 'c'.repeat(64);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
const value = (v: string): ChildReclaimGenerationKey => ({ kind: 'value', v });
const ABSENT: ChildReclaimGenerationKey = { kind: 'absent' };
const NONE = { kind: 'none' } as const;
const detailOf = (o: ChildReclaimOutcome): string => (o.kind === 'deferred' ? o.detail : '');

interface RigOpts {
  /** The row's `.generation`: a string is written byte for byte, `null` writes no file, and `'dir'`
   *  plants a directory there, which reads as unreadable. Default `G1`. */
  readonly generation?: string | null | 'dir';
  readonly visible?: boolean;
  readonly paused?: boolean;
  /** `false` is an older ccd. The default is wave 7's (`modelCcd`). */
  readonly wave7?: boolean;
  /** A script in place of the model. */
  readonly script?: (args: readonly string[], runId: number) => CcdAnswer | undefined;
  /** A fault on the fixture HOME's io. */
  readonly io?: (base: FleetIO) => FleetIO;
}

/** `child-reclaim.test.ts`'s `rig`, cut down: one child of a CLOSED minting run, a real CoordStore, a
 *  feed log, and the ccd above. `mint` writes the row as ws-add does. A second call is the SAME run
 *  minting the slug again, with a new uuid and the generation given. */
const rig = async (over: RigOpts = {}) => {
  const home = mkTmp('ccrc-child-reclaim-licence-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const genPath = path.join(reg, `${ID}.generation`);
  let mints = 0;
  const mint = (generation: string | null | 'dir'): void => {
    mints += 1;
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`,
      uuid: `u-${ID}-${mints}`, started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main',
      child: String(runId) };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    rmSync(genPath, { recursive: true, force: true });
    if (generation === 'dir') mkdirSync(genPath);
    else if (generation !== null) writeFileSync(genPath, generation);
  };
  mint(over.generation === undefined ? G1 : over.generation);
  if (over.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const hooks: CcdHooks = {};
  const model = modelCcd({ reg, id: ID, wave7: over.wave7 !== false, hooks });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const a = over.script !== undefined ? over.script(args, runId) : model(args);
    return a === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` }
      : { code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
  };
  const base = testDeps(home, run);
  let generationReads = 0;
  const counted: FleetIO = {
    ...base.io,
    readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      if (path.basename(p) === `${ID}.generation`) generationReads += 1;
      return base.io.readFileMeasured(p, timeoutMs, signal);
    },
  };
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: over.io?.(counted) ?? counted, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: CAPS, presence: { isVisible: (id: string) => over.visible === true && id === ID }, notifyLog };
  /** A sweep request judged under `licence`, or close's request when it is `none`; licensed or not. */
  const req = (licence: ChildReclaimGenerationKey | typeof NONE,
    o: { readonly licensed?: boolean; readonly feedQuiet?: ChildReclaimFeedQuiet } = {}): ChildReclaimRequest => ({
    sessionId: ID, runId, trigger: licence.kind === 'none' ? 'close' : 'sweep', deferExpired: o.licensed === true,
    deferredSinceMs: null, feedQuiet: o.feedQuiet ?? CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: licence,
  });
  const events = () => coord.feedEvents(50).filter((e) => e.sessionId === ID);
  return {
    runId, deps, hooks, req, mint, calls,
    remint: (g: string): void => { writeFileSync(genPath, g); },
    verbs: (): string[] => calls.map((c) => c[0]!),
    generationReads: (): number => generationReads,
    listed: (): string[] => readdirSync(reg).filter((n) => n.startsWith(`${ID}.`)),
    feed: (): string[] => events().map((e) => e.title),
    bodies: (): string[] => events().map((e) => e.body),
  };
};

describe('step 2c — the re-read before presence, for every sweep request', () => {
  it.each([['unlicensed', false], ['licensed', true]] as const)(
    '%s: the generation it was judged under still stands, so it proceeds to the act ccd binds to it',
    async (_what, licensed) => {
      const s = await rig();
      expect(await reclaimChild(s.deps, s.req(value(G1), { licensed }))).toMatchObject({ kind: 'reclaimed' });
      expect(s.verbs()).toEqual(['ws-audit', 'ws-reclaim']);
    });

  it.each<[string, string | null, ChildReclaimGenerationKey]>([
    ['another value', G2, value(G1)],
    ['a value where the request was judged under none', G1, ABSENT],
    ['none where the request was judged under a value', null, value(G1)],
  ])('%s defers generation-changed before any argv, unlicensed and licensed alike', async (_what, file, licence) => {
    for (const licensed of [false, true]) {
      const s = await rig({ generation: file });
      const out = await reclaimChild(s.deps, s.req(licence, { licensed }));
      expect(out, `licensed: ${String(licensed)}`).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
      expect(s.calls, 'nothing reached the box').toEqual([]);
      expect(s.listed(), 'the workspace under the name stands').toContain(`${ID}.uuid`);
    }
  });

  it('names both generations, then says why in its own sentence', async () => {
    const s = await rig({ generation: G2 });
    const d = detailOf(await reclaimChild(s.deps, s.req(value(G1))));
    expect(d).toContain(`now carries generation ${G2}`);
    expect(d).toContain(`judged under generation ${G1}`);
    expect(d.endsWith(CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE)).toBe(true);
  });

  it('absent against absent proceeds to the audit, where wave 7’s ccd mints nothing over a row with no generation', async () => {
    const s = await rig({ generation: null });
    expect(await reclaimChild(s.deps, s.req(ABSENT))).toMatchObject({ kind: 'failed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it.each<[string, string]>([
    ['a directory where the file should be', 'dir'],
    ['37 bytes: the value and a newline', `${G1}\n`],
    ['a byte-order mark before the value', `﻿${G1}`],
  ])('%s is unreadable: marker-unreadable with its own detail, never generation-changed, and nothing reaches the box',
    async (_what, file) => {
      const s = await rig({ generation: file });
      const out = await reclaimChild(s.deps, s.req(value(G1), { licensed: true }));
      expect(out).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
      expect(detailOf(out)).toContain(`${ID}.generation could not be read`);
      expect(s.calls).toEqual([]);
    });

  it('a read that rejects is marker-unreadable too, never an uncaught rejection', async () => {
    const s = await rig({ io: (b) => ({ ...b,
      readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
        if (path.basename(p) === `${ID}.generation`) throw new Error('EIO');
        return b.readFileMeasured(p, timeoutMs, signal);
      } }) });
    const out = await reclaimChild(s.deps, s.req(value(G1)));
    expect(out).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(detailOf(out)).toContain('EIO');
    expect(s.calls).toEqual([]);
  });
});

describe('where step 2c sits: after the switch, before presence', () => {
  it('a raised switch answers first, and the generation is not read at all', async () => {
    const s = await rig({ generation: G2, paused: true });
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(s.generationReads()).toBe(0);
  });

  it('a re-minted workspace someone is viewing answers generation-changed, never presence: no presence answer measured on a new workspace is credited to the old one’s episode', async () => {
    const s = await rig({ generation: G2, visible: true });
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    const c = await rig({ generation: G1, visible: true });
    expect(await reclaimChild(c.deps, c.req(value(G1))), 'the CONTROL: the generation it was judged under is presence')
      .toMatchObject({ kind: 'deferred', why: 'presence' });
  });
});

describe('step 5a — the audit’s generation, against the licence', () => {
  it('a re-mint BETWEEN the re-read and the audit: wave 7’s ccd mints over G2 and says so, and that token is never spent', async () => {
    for (const licensed of [false, true]) {
      const s = await rig();
      s.hooks.beforeAudit = () => s.remint(G2);
      const out = await reclaimChild(s.deps, s.req(value(G1), { licensed }));
      expect(out, `licensed: ${String(licensed)}`).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
      expect(detailOf(out)).toContain(`ws-audit minted its token over generation ${G2}`);
      expect(s.verbs(), 'the audit ran, and the act never did').toEqual(['ws-audit']);
    }
  });

  it('a re-mint BETWEEN the audit and the act: ccd’s lock refuses the G1 token state-changed, and the new workspace stands', async () => {
    // The fourth equal generation is ccd's own (spec §5.5): the server cannot see this window, and does
    // not need to. Wave 7's real-ccd case pins the refusal; this pins that the server reads it as a retry.
    const s = await rig();
    s.hooks.beforeAct = () => s.remint(G2);
    expect(await reclaimChild(s.deps, s.req(value(G1), { licensed: true })))
      .toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(s.verbs()).toEqual(['ws-audit', 'ws-reclaim']);
    expect(s.listed()).toContain(`${ID}.uuid`);
  });

  it('a licence judged under no generation never spends a token minted over one', async () => {
    const s = await rig({ generation: null, script: (args, runId) => (args[0] === 'ws-audit'
      ? { code: 0, stdout: JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, generation: G1,
          verdict: 'reclaimable', detail: '', token: TOK }) }
      : undefined) });
    expect(await reclaimChild(s.deps, s.req(ABSENT))).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });
});

describe('an older ccd: its audit prints no generation', () => {
  it('a LICENSED request is never spent: it defers unsupported, and the detail says the audit prints no generation', async () => {
    const s = await rig({ wave7: false });
    const out = await reclaimChild(s.deps, s.req(value(G1), { licensed: true }));
    expect(out).toMatchObject({ kind: 'deferred', why: 'unsupported' });
    expect(detailOf(out)).toContain('ws-audit prints no generation');
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an UNLICENSED request relies on step 2c, and proceeds', async () => {
    const s = await rig({ wave7: false });
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'reclaimed' });
  });

  it('THE STATED RESIDUAL: an unlicensed request keeps the gap between step 2c and the act', async () => {
    // Spec §5.5: what is left of the same-run re-mint window while the fleet host runs a ccd older than
    // wave 7's. A licensed request is never spent there (the case above).
    const s = await rig({ wave7: false });
    s.hooks.beforeAudit = () => s.remint(G2);
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'reclaimed' });
  });
});

describe('two requests queued for one id', () => {
  it('the second, judged under G1, never reaches the slug the same run minted again after the first reclaimed it', async () => {
    for (const wave7 of [false, true]) {
      const s = await rig({ wave7 });
      s.hooks.afterReclaim = () => { s.hooks.afterReclaim = undefined; s.mint(G2); };
      const q = new KeyedQueue();
      const first = q.run(ID, () => reclaimChild(s.deps, s.req(value(G1))));
      const second = q.run(ID, () => reclaimChild(s.deps, s.req(value(G1))));
      expect(await first, `wave7: ${String(wave7)}`).toMatchObject({ kind: 'reclaimed' });
      expect(await second, `wave7: ${String(wave7)}`).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
      expect(s.verbs(), 'the second asked the box nothing').toEqual(['ws-audit', 'ws-reclaim']);
      expect(s.listed(), 'the new workspace stands').toContain(`${ID}.uuid`);
    }
  });
});

describe('close: `none` skips the re-read and the comparison', () => {
  const closeCcd = (printed: Record<string, unknown>) =>
    (args: readonly string[], runId: number): CcdAnswer | undefined => {
      if (args[0] === 'ws-audit') {
        return { code: 0, stdout: JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, ...printed,
          verdict: 'reclaimable', detail: '', token: TOK }) };
      }
      if (args[0] === 'ws-reclaim') {
        return { code: 0, stdout: JSON.stringify({ reclaimed: ID, childOf: runId, wip: null, attic: 2,
          residueBytes: null, secretsDropped: 0 }) };
      }
      return undefined;
    };

  it('reads no generation, and spends the token whatever value the audit prints, or none', async () => {
    for (const printed of [{ generation: G2 }, {}]) {
      const s = await rig({ generation: 'dir', script: closeCcd(printed) });
      expect(await reclaimChild(s.deps, s.req(NONE)), JSON.stringify(printed)).toMatchObject({ kind: 'reclaimed' });
      expect(s.generationReads(), 'close never reads the generation').toBe(0);
    }
  });

  it('a null generation on a token-bearing document is unreadable for close too, so it is never spent', async () => {
    const s = await rig({ script: closeCcd({ generation: null }) });
    expect(await reclaimChild(s.deps, s.req(NONE))).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });
});

describe('parseChildReclaimAudit reads `generation` in four arms, by hasOwnProperty', () => {
  const doc = (extra: Record<string, unknown>, verdict = 'reclaimable'): string => JSON.stringify({
    id: ID, mode: 'reclaim', childOf: 7, verdict, detail: '', ...(verdict === 'reclaimable' ? { token: TOK } : {}), ...extra });

  it('a value: the token, and the generation ccd bound into it', () => {
    expect(parseChildReclaimAudit(ID, doc({ generation: G1 })))
      .toEqual({ kind: 'token', token: TOK, childOf: 7, generation: { kind: 'value', v: G1 } });
  });

  it('no key at all is an older ccd, named as such: never folded into null, nor into the row having none', () => {
    expect(parseChildReclaimAudit(ID, doc({})))
      .toEqual({ kind: 'token', token: TOK, childOf: 7, generation: { kind: 'unprinted' } });
  });

  it('null on a token-bearing document is unreadable, so the token is never spent', () => {
    expect(parseChildReclaimAudit(ID, doc({ generation: null })))
      .toEqual({ kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with a null generation' });
  });

  it.each<[string, unknown]>([
    ['the value and a newline', `${G1}\n`],
    ['a space before the value', ` ${G1}`],
    ['a byte-order mark before the value', `﻿${G1}`],
    ['upper case', G1.toUpperCase()],
    ['35 characters', G1.slice(1)],
    ['37 characters', `${G1}0`],
    ['an empty string', ''],
    ['a number', 42],
    ['an object', { v: G1 }],
  ])('a malformed value (%s) is unreadable, never trimmed into one', (_what, g) => {
    const r = parseChildReclaimAudit(ID, doc({ generation: g }));
    expect(r).toMatchObject({ kind: 'unreadable' });
    expect(r.kind === 'unreadable' ? r.detail : '').toContain('36-character');
  });

  it('on a refused document the key gates nothing, whatever it holds', () => {
    for (const extra of [{}, { generation: null }, { generation: G1 }, { generation: 'junk' }]) {
      expect(parseChildReclaimAudit(ID, doc(extra, 'not-a-child')), JSON.stringify(extra))
        .toEqual({ kind: 'refused', token: 'not-a-child', detail: '' });
    }
  });
});

describe('generation-changed: the server’s own defer word', () => {
  it('is a defer reason and a declared word, and never a ccd word, a journal token or a presence defer', () => {
    // Not a presence defer, so `childReclaimNextEntry` ends the presence episode on it, and no licence
    // outlives it: the class `child-reclaim-sweep-policy.test.ts` pins for every non-presence defer.
    expect(isChildReclaimDeferWhy('generation-changed')).toBe(true);
    expect(isChildReclaimKebab('generation-changed')).toBe(true);
    expect(Object.keys(CHILD_RECLAIM_TOKEN_KIND)).not.toContain('generation-changed');
    expect(LC_REFUSAL_TOKENS as readonly string[]).not.toContain('generation-changed');
    expect(CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).not.toContain('generation-changed');
  });

  it('writes one feed row naming the word and its sentence wherever it is found, and none for a repeat in the same episode', async () => {
    const reread = await rig({ generation: G2 });
    await reclaimChild(reread.deps, reread.req(value(G1)));
    const audited = await rig();
    audited.hooks.beforeAudit = () => audited.remint(G2);
    await reclaimChild(audited.deps, audited.req(value(G1)));
    for (const s of [reread, audited]) {
      expect(s.feed()).toEqual(['child reclaim deferred']);
      expect(s.bodies()[0]).toContain('reclaim deferred (generation-changed) — ');
      expect(s.bodies()[0]).toContain(CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE);
    }
    const quiet = await rig({ generation: G2 });
    await reclaimChild(quiet.deps, quiet.req(value(G1), { feedQuiet: { deferWhy: 'generation-changed', failureToken: null } }));
    expect(quiet.feed(), 'the episode’s row is already written').toEqual([]);
  });
});
```

Create `server/test/child-reclaim-licence-lane.test.ts`:

```ts
// Child reclamation wave 8, X1 at the lane (spec §5.5, §5.7). A licence the sweep judged over ONE
// workspace generation never reaches a re-mint of the same name, wherever the re-mint falls: before the
// sweep reads the generation, between that read and the queue, or while the request waits on the
// session's queue. The licence here is the presence-only kind: fifteen presence answers, measured by the
// executor before any argv, and not one audit. Its generation is the sweep's own read, so it is bound all
// the same. The executor's half of the later points (the audit, the act, two queued requests) is in
// `child-reclaim-licence-executor.test.ts`. FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { G1, G2, laneFixture, modelCcd, type Lane } from './childReclaimGenerationFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

const G = (v: string) => ({ kind: 'value', v }) as const;
const model = (reg: string) => modelCcd({ reg, id: 'demo-a', wave7: true, hooks: {} });

/** demo-a, watched until its presence episode over G1 spans the ceiling: fifteen unlicensed asks, each
 *  answered `presence` by the executor before any argv, and the next ask is licensed
 *  (`child-reclaim-sweep.test.ts`'s L17 shape, on the real executor). Leaves the clock one pass on. */
const ripen = async (f: Lane): Promise<void> => {
  f.finishedChild('demo-a', G1);
  await f.pass();
  while (f.requests.length < 15) { f.next(); await f.pass(); }
  expect(f.requests.map((q) => q.deferExpired), 'fifteen unlicensed asks').toEqual(Array.from({ length: 15 }, () => false));
  expect(f.outcomes.map((o) => (o.kind === 'deferred' ? o.why : o.kind)), 'each answered presence')
    .toEqual(Array.from({ length: 15 }, () => 'presence'));
  expect(f.requests.map((q) => q.licenceGeneration), 'each judged over G1').toEqual(Array.from({ length: 15 }, () => G(G1)));
  expect(f.calls, 'a presence-only episode: not one audit ran').toEqual([]);
  f.next();
};

describe('X1 at the lane: a licence judged over one generation never reaches a re-mint (spec §5.5, §5.7)', () => {
  it('the CONTROL: with no re-mint, the licence reaches ccd and reclaims G1', async () => {
    const f = laneFixture({ visible: () => true, ccd: model });
    await ripen(f);
    await f.pass();
    expect(f.requests[15]).toMatchObject({ deferExpired: true, licenceGeneration: G(G1) });
    expect(f.outcomes[15]).toMatchObject({ kind: 'reclaimed' });
    expect(f.calls.map((c) => c[0])).toEqual(['ws-audit', 'ws-reclaim']);
  });

  it('a re-mint BEFORE the sweep reads: the pass reads G2, the G1 episode is dropped, and the next ask is unlicensed over G2', async () => {
    const f = laneFixture({ visible: () => true, ccd: model });
    await ripen(f);
    f.remint('demo-a', G2);
    await f.pass();
    expect(f.requests, 'another generation is a first sighting: nothing is asked').toHaveLength(15);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(16);
    expect(f.requests[15]).toMatchObject({ deferExpired: false, licenceGeneration: G(G2) });
    expect(f.calls, 'presence still holds the new workspace: no argv').toEqual([]);
  });

  it('a re-mint BETWEEN the sweep’s read and the queue: the licensed request carries G1, and the executor’s re-read defers generation-changed before any argv', async () => {
    let armed = false;
    let f!: Lane;
    f = laneFixture({ visible: () => true, ccd: model,
      afterRead: (p) => { if (armed && path.basename(p) === 'demo-a.generation') { armed = false; f.remint('demo-a', G2); } } });
    await ripen(f);
    const l = await f.listing();
    armed = true;
    await f.sweepOn(l);
    expect(armed, 'the re-mint fell right after the sweep’s own read').toBe(false);
    expect(f.requests[15]).toMatchObject({ deferExpired: true, licenceGeneration: G(G1) });
    expect(f.outcomes[15]).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(f.calls, 'the licence never reached ccd').toEqual([]);
    f.next(); await f.pass();                                 // the sweep reads G2: a first sighting
    f.next(); await f.pass();
    expect(f.requests[16], 'G2 is asked unlicensed, from a fresh episode').toMatchObject({ deferExpired: false, licenceGeneration: G(G2) });
  });

  it('a re-mint WHILE the licensed request waits on the session’s queue: generation-changed, before any argv', async () => {
    const f = laneFixture({ visible: () => true, ccd: model });
    await ripen(f);
    let free!: () => void;
    const occupied = f.queue.run('demo-a', () => new Promise<void>((resolve) => { free = resolve; }));
    const passing = f.pass();
    await vi.waitFor(() => expect(f.requests).toHaveLength(16));   // queued behind the occupier
    f.remint('demo-a', G2);
    free(); await occupied; await passing;
    expect(f.requests[15]).toMatchObject({ deferExpired: true, licenceGeneration: G(G1) });
    expect(f.outcomes[15]).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(f.calls, 'the licence never reached ccd').toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-licence-executor.test.ts test/child-reclaim-licence-lane.test.ts
```

Expected, before Step 4. The model stands in for wave 7's ccd, so each red below is X1's harm as it is at Task 2's tip:
- The parse cases for a value, a missing key and the malformed values: `expected { kind: 'token', token: 'cccc…', childOf: 7 } to deeply equal { …, generation: { kind: 'value', v: '0a1b2c3d-…' } }` (for a malformed value, `… to match object { kind: 'unreadable' }`). The null case: `expected { kind: 'token', … } to deeply equal { kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with a null generation' }`. The refused-document case PASSES: it characterises the existing reader.
- Step 2c, "another value…" and "a value where the request was judged under none…": `licensed: false: expected { kind: 'reclaimed', … } to match object { kind: 'deferred', why: 'generation-changed' }`. The audit mints over the file's generation, and that token is spent on the re-mint. "none where the request was judged under a value…": `expected { kind: 'failed', … } to match object { …, why: 'generation-changed' }`.
- "names both generations…": `expected '' to contain 'now carries generation 0a1b…b'`.
- The three unreadable cases: `expected { kind: 'failed', … } to match object { kind: 'deferred', why: 'marker-unreadable' }`. The rejecting read: `expected { kind: 'reclaimed', … } to match object { …marker-unreadable }`.
- "a re-minted workspace someone is viewing…": `expected { …, why: 'presence' } to match object { kind: 'deferred', why: 'generation-changed' }`.
- Step 5a, "between the re-read and the audit": `licensed: false: expected { kind: 'reclaimed', … } to match object { …generation-changed }`. "a licence judged under no generation…": `expected { kind: 'failed', … } to match object { …generation-changed }`.
- The older ccd's licensed case: `expected { kind: 'reclaimed', … } to match object { kind: 'deferred', why: 'unsupported' }`.
- "two requests queued…": `wave7: false: expected { kind: 'reclaimed', … } to match object { kind: 'deferred', why: 'generation-changed' }`.
- Close's null case: `expected { kind: 'reclaimed', … } to match object { kind: 'failed', resume: 'not-resumable' }`.
- The defer-word pin: `expected false to be true`. The feed case: `expected [ 'child reclaimed' ] to deeply equal [ 'child reclaim deferred' ]`.
- Lane, "between the sweep's read and the queue" and "while it waits on the queue": `expected { kind: 'reclaimed', … } to match object { kind: 'deferred', why: 'generation-changed' }`.
- These PASS, and stay green as controls that the mutation rows prove live: both "still stands" cases; "absent against absent"; "a raised switch answers first"; "between the audit and the act" (ccd's link); the older ccd's unlicensed case and its residual; close's "reads no generation"; and, in the lane file, "the CONTROL" and "BEFORE the sweep reads" (Task 2's third key).

If "the CONTROL" or `ripen` reds, the lane fixture is wrong, not the executor. Fix the fixture before Step 4.

The flipped wave 7 pins go red first too. Make Step 4(f)'s two edits of `ccd-child-reclaim-row-generation.test.ts` now, before Step 4(a)-(e), and run:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts -t 'absence-permits'
```

Expected: both cases red. The first: `an older ccd: no key: expected { kind: 'token', token: 'aaaa…', childOf: … } to deeply equal { …, generation: { kind: 'unprinted' } }`. The second: `expected { kind: 'token', token: '…', childOf: … } to deeply equal { …, generation: { kind: 'value', v: '…' } }`. Every red text is measured; where it differs, the measured one replaces this.

- [ ] **Step 4: Implement**

(a) **The defer word, its sentence, and the words a detail uses.** In `ChildReclaimDeferWhy`, add `| 'generation-changed'` after `'paused-at-server'`, and add `'generation-changed': true,` after `'paused-at-server': true,` in `CHILD_RECLAIM_DEFER_WHY`. Extend the type's docstring with: "`generation-changed` is the server's own word too: the workspace under this name is not the generation the request was judged under (spec §5.5, §5.6), found by the executor's re-read or in the audit's own `generation`." Directly below `isChildReclaimDeferWhy`, add:

```ts
/** `generation-changed`'s sentence (spec §5.5, §5.6): what the feed row says after the word, wherever the
 *  executor finds it. Defined once; each detail that carries it first says what was measured. Worded by what
 *  was MEASURED, never by a cause: the executor sees only that the generation file now reads differently from
 *  the licence. ccd can change that file with no removal (`_reg_generation_init` minting into an absence on a
 *  standing row; `_reg_purge` unlinking `.generation` last with the row still listed), so "removed and made
 *  again" would be a false cause on those rows. */
export const CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE =
  'The workspace under this name no longer carries the generation the sweep judged it under, so this request '
  + 'is not used, and the sweep judges the workspace afresh.';

/** A generation key, in a detail's words. */
const childReclaimGenerationWords = (g: ChildReclaimGenerationKey): string =>
  (g.kind === 'value' ? `generation ${g.v}` : 'no generation');

/** Step 5a's `unsupported` detail (spec §5.5): a licensed request is never spent on a token that binds
 *  no generation. */
const CHILD_RECLAIM_AUDIT_UNBOUND = 'this fleet host’s ws-audit prints no generation, so the licence cannot be '
  + 'bound to one; a licensed reclaim waits until the fleet host’s ccd is updated';
```

(b) **The audit read's generation.** Replace `ChildReclaimAuditRead`'s token arm, and add the new type above it:

```ts
/** What a token-bearing `ws-audit --reclaim` document says of the row's generation (spec §5.5): the value
 *  ccd bound into the token it minted, or `unprinted`, an older ccd's document with no `generation` key at
 *  all. Never folded into the generation file's own `absent` (`ChildReclaimGenerationKey`), which is a
 *  different fact from a different read: wave 7's ccd mints no token over a row with no generation. */
export type ChildReclaimAuditGeneration =
  | { readonly kind: 'value'; readonly v: string }
  | { readonly kind: 'unprinted' };
```

```ts
  | { readonly kind: 'token'; readonly token: string; readonly childOf: number;
      readonly generation: ChildReclaimAuditGeneration }
```

In `parseChildReclaimAudit`, replace the reclaimable branch's last line, `return { kind: 'token', token: v.token, childOf: v.childOf };`, with:

```ts
    // THE GENERATION (spec §5.5), in four arms decided by `hasOwnProperty`, never by `?? null`. An older
    // ccd prints no key at all (`unprinted`). That is not the null wave 7's ccd prints, and it prints null
    // only on a document that mints no token. On a token-bearing document, a null, or a value that is not
    // exactly one generation (`REG_GENERATION_SHAPE`, 36 characters, nothing trimmed), makes the WHOLE
    // document unreadable, so its token is never spent. The executor compares a value with the
    // request's licence (`childReclaimOutcome`'s step 5a). A refused document's key gates nothing.
    if (!Object.prototype.hasOwnProperty.call(v, 'generation')) {
      return { kind: 'token', token: v.token, childOf: v.childOf, generation: { kind: 'unprinted' } };
    }
    if (v.generation === null) {
      return { kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with a null generation' };
    }
    if (typeof v.generation !== 'string' || !REG_GENERATION_SHAPE.test(v.generation)) {
      return { kind: 'unreadable',
        detail: 'ws-audit --reclaim said reclaimable with a generation that is not one 36-character lowercase UUID' };
    }
    return { kind: 'token', token: v.token, childOf: v.childOf, generation: { kind: 'value', v: v.generation } };
```

(c) **Step 2c.** Insert it between step 2b's closing `}` and `// 3 — a human looking at it, unless the defer's ceiling was reached.`:

```ts
  // 2c — THE GENERATION, RE-READ (spec §5.5, §5.6). A sweep request was judged over ONE workspace
  // generation (`licenceGeneration`, the sweep's own byte-exact read of `<id>.generation`), and it may
  // have waited on the session's queue since. The same run can remove the slug and mint it again
  // meanwhile, and every check above passes for the new workspace. So EVERY sweep request, licensed
  // or not, re-reads it here: after the switch, and BEFORE presence, so that no presence answer
  // measured on a new workspace is credited to the old one's episode. A different value, or `absent`
  // against a value, is `generation-changed`. A read that failed is `marker-unreadable`, never
  // "changed": it says the box could not be read, not that the workspace moved. Close's requests carry
  // `none`, and skip this step and step 5a's comparison. Close queues only when the minting run names
  // this session and no other open run does, so that run is the one being closed or is already
  // terminal, and no re-mint by it can follow.
  const licence = req.licenceGeneration;
  if (licence.kind !== 'none') {
    let current: ChildReclaimGeneration;
    try {
      current = await childReclaimGenerationRead(deps.io, deps.cfg.registryDir, sessionId);
    } catch (err) {
      return deferred('marker-unreadable', `${sessionId}.generation could not be read `
        + `(${err instanceof Error ? err.message : String(err)}), so which workspace stands under this name cannot be said`);
    }
    if (current.kind === 'unreadable') {
      return deferred('marker-unreadable',
        `${sessionId}.generation could not be read, so which workspace stands under this name cannot be said`);
    }
    if (!childReclaimSameGenerationKey(licence, current)) {
      return deferred('generation-changed', `the workspace now carries ${childReclaimGenerationWords(current)}, `
        + `and this request was judged under ${childReclaimGenerationWords(licence)}. ${CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE}`);
    }
  }
```

(d) **Step 5a.** Insert it directly below the `if (audit.childOf !== runId) { … }` block, above `// 6 — the act.`:

```ts
  // 5a — THE AUDIT'S GENERATION (spec §5.5): the generation ccd bound into the token it just minted,
  // against the one this request was judged under. A different value, `absent` against a value
  // included, is `generation-changed`: the slug was minted again between step 2c and the audit, and the
  // token is over the new workspace. An older ccd prints no generation (`unprinted`). A LICENSED request
  // is never spent on such a token: it skips presence on the strength of a judgement over one
  // generation, and nothing on the box would hold it to that generation. So it defers `unsupported`
  // until the fleet host's ccd is updated. An unlicensed request relies on step 2c. Its stated
  // residual, on an older ccd only, is the gap from step 2c's read to the act (spec §5.5). Close's
  // `none` is never compared.
  if (licence.kind !== 'none') {
    if (audit.generation.kind === 'unprinted') {
      if (req.deferExpired) return deferred('unsupported', CHILD_RECLAIM_AUDIT_UNBOUND);
    } else if (!childReclaimSameGenerationKey(licence, audit.generation)) {
      return deferred('generation-changed', `ws-audit minted its token over ${childReclaimGenerationWords(audit.generation)}, `
        + `and this request was judged under ${childReclaimGenerationWords(licence)}. ${CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE}`);
    }
  }
```

(e) **`reclaimChild`'s docstring.** In its first sentence, the list "the marker against `req.runId`, the open siblings, the reclaim switch (`childReclaimPauseRead`, wave 4), presence, the capability — then `ws-audit --reclaim` → token → `ws-reclaim`" becomes "the marker against `req.runId`, the open siblings, the reclaim switch (`childReclaimPauseRead`, wave 4), a sweep request's workspace generation (spec §5.5), presence, the capability — then `ws-audit --reclaim` → token, its generation held to the request's → `ws-reclaim`". Re-wrap the comment lines at the file's width.

(f) **The existing cases this changes.** In `server/test/child-reclaim.test.ts`:
- In the file's import block, add `// A generation wave 7's ccd binds into its token (spec §5.5); a licensed request is judged under it. The shared fixture's G1 (H7).` and `import { G1 as GEN_W8 } from './childReclaimGenerationFixture.js';`. No second copy of the bytes.
- `parseChildReclaimAudit`'s first case (`:189`; `grep -n "reads a token and the run the marker names" server/test/child-reclaim.test.ts`). Its expectation becomes `.toEqual({ kind: 'token', token: TOK, childOf: 7, generation: { kind: 'unprinted' } });`. This document carries no key, which is an older ccd's.
- "a CEILING-EXPIRED reclaim states the wait it ended" (`:821`). This licensed SWEEP request now needs the audit to print the generation it was judged under. Replace its first two statements with:
  ```ts
    const s = await rig({ visible: true, now: T0 + 16 * 60_000, script: (runId) => ({
      audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK, generation: GEN_W8 }) },
      verb: { code: 0, stdout: reclaimedDoc(runId) } }) });
    writeFileSync(path.join(s.reg, `${ID}.generation`), GEN_W8);
    expect((await reclaimChild(s.deps, { ...s.req(true, T0), licenceGeneration: { kind: 'value', v: GEN_W8 } })).kind)
      .toBe('reclaimed');
  ```
- "reclaimChild writes no row for a failure the list shows, but still writes a ceiling-expired one" (`:1383`). Replace its two `expired` statements (`:1390` and `:1391`) with:
  ```ts
    const expired = await rig({ script: (runId) => ({ ...pinFailed(runId),
      audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK, generation: GEN_W8 }) } }) });
    writeFileSync(path.join(expired.reg, `${ID}.generation`), GEN_W8);
    await reclaimChild(expired.deps, { ...expired.req(true, 1, listed), licenceGeneration: { kind: 'value', v: GEN_W8 } });
  ```
- The spreads override whatever `licenceGeneration` Task 2's `rig().req` sets. If Step 5's family run reds another LICENSED sweep case on `unsupported` (for example "defers while someone is looking" at `:795`, if Task 2's rig gives a close-trigger request a value or `absent`), give that case the same three things: the file, the printed generation and the licence. Name it in the task's report.

In wave 7's `server/test/ccd-child-reclaim-row-generation.test.ts`, UNCONDITIONALLY (H1; the accepted departure `wave7-generation-pins-owed`, flipped in this task's own commit): R73(e) makes `generation: null` on a token-bearing document unreadable, and the token arm now names its generation. So, inside the describe that `grep -n "absence-permits"` finds, keep the describe's title (wave 7's own mutation row 12 runs `-t 'absence-permits'`). Retitle its first `it` from 'parseChildReclaimAudit answers the same with the key, with null, and without it (an older ccd)', which is no longer true, to 'parseChildReclaimAudit reads the key absence-permits: no key is unprinted, a value is carried, and null with a token is never spent', and replace that `it`'s body with:

```ts
    const doc = (extra: Record<string, unknown>): string =>
      JSON.stringify({ ...base, ...extra, verdict: 'reclaimable', detail: '', token: TOK });
    const G = '0123abcd-0123-4567-89ab-0123456789ab';
    expect(parseChildReclaimAudit(CHILD_ID, doc({})), 'an older ccd: no key')
      .toEqual({ kind: 'token', token: TOK, childOf: CHILD_RUN, generation: { kind: 'unprinted' } });
    expect(parseChildReclaimAudit(CHILD_ID, doc({ generation: G })))
      .toEqual({ kind: 'token', token: TOK, childOf: CHILD_RUN, generation: { kind: 'value', v: G } });
    expect(parseChildReclaimAudit(CHILD_ID, doc({ generation: null })), 'null with a token is never spent (wave 8)')
      .toMatchObject({ kind: 'unreadable' });
    expect(parseChildReclaimAudit(CHILD_ID, JSON.stringify({ ...base, generation: null, verdict: 'not-a-child', detail: 'd' })))
      .toEqual({ kind: 'refused', token: 'not-a-child', detail: 'd' });
```

In its second `it` ("this build’s own document parses to its token"), the expectation becomes `.toEqual({ kind: 'token', token: (JSON.parse(out) as { token: string }).token, childOf: CHILD_RUN, generation: { kind: 'value', v: gen() } });`. If the file is missing, or its describe no longer reads as wave 7's plan wrote it, STOP and report: Task 0 brought wave 7's tree (H1), and no merge happens mid-wave.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-licence-executor.test.ts test/child-reclaim-licence-lane.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/child-reclaim-paused-at-server.test.ts \
  test/child-reclaim-pre-crumb.test.ts test/child-reclaim-close.test.ts test/run-routes.test.ts test/mail-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts test/child-reclaim-sweep-policy.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts   # wave 7's file (H1): a real ccd in a fixture HOME
```

Expected: every file PASSES. `mail-routes.test.ts`'s kebab scanner admits `'generation-changed'` through `isChildReclaimKebab` (via `isChildReclaimDeferWhy`), with no allowlist entry. Run each line in the foreground with a timeout of at least 600000 ms. Re-run a known load flake in isolation before calling it a break.

- [ ] **Step 6: Mutation check**

Make each edit, run, see the red, and revert before the next. E is `cd server && ./node_modules/.bin/vitest run test/child-reclaim-licence-executor.test.ts`, and L is the same with `test/child-reclaim-licence-lane.test.ts`. Every red text is measured by the worker; where the measured text differs, it replaces the draft's.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | Delete step 2c: the whole `if (licence.kind !== 'none') { … }` block above `// 3 — a human looking at it`. Keep `const licence = req.licenceGeneration;` | E, then L | E "another value…": `nothing reached the box: expected [ [ 'ws-audit', … ] ] to deeply equal []`. "…someone is viewing…": `expected { …why: 'presence' } to match object { …why: 'generation-changed' }`. "two requests queued…": `wave7: false: expected { kind: 'reclaimed', … } to match object { …generation-changed }`. L, both later points: `the licence never reached ccd: expected [ [ 'ws-audit', … ] ] to deeply equal []` |
| 2 | Step 2c's guard becomes `if (licence.kind !== 'none' && req.deferExpired) {` (licensed requests only) | E | "another value…": `licensed: false: … nothing reached the box: expected [ [ 'ws-audit', … ] ] to deeply equal []`. "…someone is viewing…": `…why: 'presence'…`. "two requests queued…": `wave7: false: expected { kind: 'reclaimed' … }` |
| 3 | Step 2c's comparison becomes `if (licence.kind === 'value' && current.kind === 'value' && licence.v !== current.v) {` (absence never differs) | E | "a value where the request was judged under none…": `nothing reached the box: expected [ [ 'ws-audit', … ] ] to deeply equal []`. "none where the request was judged under a value…": `expected { kind: 'failed', … } to match object { …generation-changed }` |
| 4 | In step 2c's `current.kind === 'unreadable'` branch, `deferred('marker-unreadable', …)` becomes `deferred('generation-changed', …)` | E | the three unreadable cases: `expected { …why: 'generation-changed' } to match object { kind: 'deferred', why: 'marker-unreadable' }` |
| 5 | Move the whole step 2c block below step 3 (the presence check) | E | "…someone is viewing…": `expected { …why: 'presence' } to match object { …why: 'generation-changed' }` |
| 6 | Move the whole step 2c block above step 2b | E | "a raised switch answers first…": `expected { …why: 'generation-changed' } to match object { kind: 'deferred', why: 'paused-at-server' }` |
| 7 | Delete step 2c's `try`/`catch`, keeping `current = await childReclaimGenerationRead(…)` | `E -t 'rejects'` | `promise rejected "Error: EIO" instead of resolving`. Task 2's reader lets a port's rejection propagate (ruling H5), so this row is red. If it stays green, the reader is catching the rejection itself, which H5 forbids: STOP and report `generation-read-folds-rejection` |
| 8 | Step 2c's guard `if (licence.kind !== 'none') {` becomes `{`, so close no longer skips | `E -t 'close'` | "reads no generation…": `expected { …why: 'marker-unreadable' } to match object { kind: 'reclaimed' }` (the `'dir'` generation), or `close never reads the generation: expected 1 to be 0` |
| 9 | Delete the parser's `hasOwnProperty` arm, so a missing key reaches the shape check | E | "no key at all…": `expected { kind: 'unreadable', … } to deeply equal { kind: 'token', …, generation: { kind: 'unprinted' } }`. The older ccd's unlicensed case: `expected { kind: 'failed', … } to match object { kind: 'reclaimed' }` |
| 10 | The parser's `if (v.generation === null) { return … }` becomes `if (v.generation === null) return { kind: 'token', token: v.token, childOf: v.childOf, generation: { kind: 'unprinted' } };` | E, then `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts -t 'absence-permits'` | "null on a token-bearing document…": `expected { kind: 'token', … } to deeply equal { kind: 'unreadable', … }`. Close's null case: `expected { kind: 'reclaimed', … } to match object { kind: 'failed', … }`. Wave 7's flipped case: `null with a token is never spent (wave 8): expected { kind: 'token', … } to match object { kind: 'unreadable' }` |
| 11 | The parser's `!REG_GENERATION_SHAPE.test(v.generation)` becomes `v.generation.trim().length !== 36` | E | "a malformed value (the value and a newline)", "(a space before the value)" and "(a byte-order mark before the value)": `expected { kind: 'token', … } to match object { kind: 'unreadable' }` |
| 12 | In step 5a, delete `if (req.deferExpired) return deferred('unsupported', CHILD_RECLAIM_AUDIT_UNBOUND);` | E | the older ccd's licensed case: `expected { kind: 'reclaimed', … } to match object { kind: 'deferred', why: 'unsupported' }` |
| 13 | In step 5a, `if (req.deferExpired) return …` becomes `return …` (every request on an older ccd defers) | E | the older ccd's unlicensed case: `expected { …why: 'unsupported' } to match object { kind: 'reclaimed' }` |
| 14 | In step 5a, delete the `else if (!childReclaimSameGenerationKey(licence, audit.generation)) { … }` arm | E | "between the re-read and the audit": `licensed: false: expected { kind: 'reclaimed', … } to match object { …generation-changed }`. "a licence judged under no generation…": `expected { kind: 'failed', … } to match object { …generation-changed }` |
| 15 | Step 5a's guard `if (licence.kind !== 'none') {` becomes `{` | `E -t 'close'` | "reads no generation… { generation: G2 }": `expected { …why: 'generation-changed' } to match object { kind: 'reclaimed' }` |
| 16 | Move the parser's three generation arms above `if (v.verdict === 'reclaimable') {`, so that they gate every document | E | "on a refused document the key gates nothing…": `{"generation":null}: expected { kind: 'unreadable', … } to deeply equal { kind: 'refused', … }` |
| 17 | Delete `'generation-changed': true,` from `CHILD_RECLAIM_DEFER_WHY`, keeping the union member | E, then `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` | the word pin: `expected false to be true`. The scanner reds on `generation-changed` |
| 18 | Append `'generation-changed'` to `CHILD_RECLAIM_PRESENCE_DEFERS` (`childReclaimSweep.ts`) | E | the word pin: `expected [ 'presence', 'attached', 'tree-busy', 'generation-changed' ] not to include 'generation-changed'` |

- [ ] **Step 7: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/childReclaim.ts server/test/childReclaimGenerationFixture.ts \
  server/test/child-reclaim-licence-executor.test.ts server/test/child-reclaim-licence-lane.test.ts \
  server/test/child-reclaim.test.ts server/test/ccd-child-reclaim-row-generation.test.ts
git commit -m "$(cat <<'MSG'
feat(server): the executor holds a reclaim to the generation it was judged under

Every sweep request now re-reads $REG/<id>.generation after the switch and
before presence. It defers generation-changed when the workspace under the
name is not the generation the request was judged over, and
marker-unreadable when the read fails. parseChildReclaimAudit reads the
audit's generation in four arms by hasOwnProperty. A value is compared with
the licence before the token is spent. A null or malformed value makes the
document unreadable. A document with no key, an older ccd's, never spends a
licensed request: it defers unsupported. Close's requests carry none and
skip both checks. Wave 7's two absence-permits pins in
ccd-child-reclaim-row-generation.test.ts flip with it: null with a token
is unreadable, and the token arm names its generation. Spec §5.5, §5.7.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: X3 — the hold-retired memory is keyed by generation, and the release job re-reads it

**Model routing:** **`opus`, effort `high`**. It changes when the server composes `ws-release`, an unattended write, and it rewrites a lane memory whose every delete and clear site must carry over. X3's harm is pacing only, so the destructive subject stays Task 3's.

**Why:** Review 303's X3 (contract R63) is the id-keyed Set: a slug recycled inside one pass gap queues `ws-release` one pass early. Contract R74 rules the fix:
- The Set becomes a Map from id to `{bornAt, markerRunId, generation}`. `generation` is the sweep's byte-exact read, a value or `absent`, never `unreadable`: R73(b) makes an unreadable read `identity-unmeasured`, which deletes the id.
- ONE L1 decision applies. An EQUAL stored key is the second sighting: the key is deleted and the release is queued. No stored key, or an UNEQUAL one, is a first sighting, and the new key REPLACES the stored one. An implementation that kept the old key would never match the new generation's key, the release would never fire, and the child would be kept for ever under an `ordinary` verdict nobody is shown.
- Every delete and clear site of today's Set carries over.
- The release request carries the generation. `releaseRetiredChildHold` re-reads it after its step 6, nearest the argv. A different value, or `absent` against a value, answers `changed`; an unreadable read answers `failed`. A same-run re-mint carries the same hold text, rendered from the same run, so step 1's byte check passes it, and only this read tells the two workspaces apart. Releasing a re-mint's hold cannot license its reclaim: its own minting run is live (`minting-run-open`).

`bornAt` is never null at the `hold-retired` site, because the verdict answers `child-birth-unplaced` first (`childReclaimSweep.ts:579` at `226bb881c`; `grep -n "if (i.childBornAt === null) return { eligible: false, why: 'child-birth-unplaced' };" server/src/childReclaimSweep.ts`). So the comparison's "a null birth never matches" costs nothing here.

**Files:**
- Modify: `server/src/childReclaimSweep.ts`. Directly below `childReclaimSameGeneration` (`:219` at `226bb881c`; `grep -n "^export const childReclaimSameGeneration = (" server/src/childReclaimSweep.ts`), add `ChildReclaimGenerationIdentity`, `ChildReclaimHoldRetiredStep` and `childReclaimHoldRetiredStep`, and widen `childReclaimSameGeneration`'s first parameter to `ChildReclaimGenerationIdentity`, which is type-only. Add `type ChildReclaimGeneration` to the `../../shared/api.js` import (`:13`) if Task 2 did not.
- Modify: `server/src/coord/childReclaim.ts`:
  - `ChildReclaimReleaseRequest` (`:1066`; `grep -n "^export interface ChildReclaimReleaseRequest {" server/src/coord/childReclaim.ts`) gains `generation`;
  - `releaseRetiredChildHold`'s header list (`:1124`; `grep -n "^ \*   6. the reclaim switch" …`) gains item 7, and its residual paragraph (`:1135`; `grep -n "THE RESIDUAL, ACCEPTED: a hold written" …`) gains one sentence;
  - step 6's comment (`:1235`; `grep -n "// 6 — the reclaim switch: still down" …`) is reworded;
  - step 7 goes between `if (pause !== 'clear') return 'failed';` (`:1246`) and `// Only now: the one write this job may ever compose.` (`:1248`).
- Modify: `server/src/watch.ts`. It is shared with workspace-lifecycle wave 5 (contract R80): the order is agreed with quiet-river before dispatch, and whichever lands second merges `main`.
  - the `./childReclaimSweep.js` import (`:104`; `grep -n "^} from './childReclaimSweep.js';" server/src/watch.ts`);
  - the field and its docstring (`:842`; `grep -n "private childReclaimHoldRetiredSeen = new Set<string>();" server/src/watch.ts`; the docstring starts at `:831`);
  - the `hold-retired` branch (`:3541`, `:3542`, `:3547`, `:3578`; `grep -n "if (this.childReclaimHoldRetiredSeen.has(r.id)) {\|accountedRunId: release.accountedRunId,\|this.childReclaimHoldRetiredSeen.add(r.id);" server/src/watch.ts`);
  - the vanished-row prune (`:3721`; `grep -n "for (const id of \[...this.childReclaimHoldRetiredSeen\]) {" server/src/watch.ts`);
  - `sweepChildReclaim`'s docstring sentence "on the SECOND consecutive pass this pass answers it", which wraps after `SECOND` in watch.ts (`grep -n "consecutive pass this pass answers it" server/src/watch.ts`; measured at `226bb881c`: one line, `:3270`).
- Modify: `server/test/child-reclaim.test.ts`. Its 21 `ChildReclaimReleaseRequest` literals gain `generation: { kind: 'absent' }`. Its release rig writes no `.generation`, so `absent` against `absent` keeps every case's answer.
- Create: `server/test/child-reclaim-hold-retired-generation.test.ts`.
- No edit to `shared/api.ts`, `README.md` or `single-definition.test.ts`.

**Interfaces:**
- Consumes:
  ```ts
  // Task 1: ChildReclaimGeneration, ChildReclaimGenerationKey (shared/api.ts)
  // Task 2 (server/src/childReclaimSweep.ts)
  ChildReclaimSweepEntry.generation: ChildReclaimGenerationKey;
  childReclaimSameGeneration(entry: ChildReclaimSweepEntry, bornAt: number | null, markerRunId: number,
    generation: ChildReclaimGenerationKey): boolean;   // bornAt (non-null) && markerRunId && childReclaimSameGenerationKey
  childReclaimSameGenerationKey(a: ChildReclaimGenerationKey, b: ChildReclaimGenerationKey): boolean;
  // Task 2 (server/src/coord/childReclaim.ts, server/src/watch.ts)
  childReclaimGenerationRead(io, registryDir: string, id: string): Promise<ChildReclaimGeneration>;
  //   and, inside sweepChildReclaim's per-child loop, the row's gathered read, never undefined:
  //   const regGeneration: ChildReclaimGeneration = regGenerations.get(r.id) ?? { kind: 'unreadable' };
  // Task 3 (server/test/childReclaimGenerationFixture.ts): laneFixture, Lane, G1, G2
  ```
- Produces:
  ```ts
  // server/src/childReclaimSweep.ts (L1)
  export type ChildReclaimGenerationIdentity = Pick<ChildReclaimSweepEntry, 'bornAt' | 'markerRunId' | 'generation'>;
  export type ChildReclaimHoldRetiredStep =
    | { readonly kind: 'second'; readonly generation: ChildReclaimGenerationKey }
    | { readonly kind: 'first'; readonly key: ChildReclaimGenerationIdentity }
    | { readonly kind: 'forget' };
  export function childReclaimHoldRetiredStep(stored: ChildReclaimGenerationIdentity | undefined, bornAt: number | null,
    markerRunId: number, generation: ChildReclaimGeneration): ChildReclaimHoldRetiredStep;
  export const childReclaimSameGeneration: (entry: ChildReclaimGenerationIdentity, …) => boolean;   // widened, type-only
  // server/src/coord/childReclaim.ts
  ChildReclaimReleaseRequest.generation: ChildReclaimGenerationKey;
  // releaseRetiredChildHold step 7: the generation, re-read after step 6, nearest the argv (changed / failed)
  // server/src/watch.ts
  private childReclaimHoldRetiredSeen: Map<string, ChildReclaimGenerationIdentity>;
  ```

- [ ] **Step 0: Measure the census and the loop's generation (nothing is written)**

```bash
grep -c "this.childReclaimHoldRetiredSeen.delete(" server/src/watch.ts   # 4: the second sighting, the ineligible arm, the eligible arm, the prune
grep -c "this.childReclaimHoldRetiredSeen.clear()" server/src/watch.ts   # 2: the pass-level fail-shut and the switches' return
grep -n "const regGeneration: ChildReclaimGeneration = regGenerations.get(r.id) ?? { kind: 'unreadable' };" server/src/watch.ts   # Task 2's local: ONE line
grep -n "^export const childReclaimSameGeneration = (" -A3 server/src/childReclaimSweep.ts
```

- The census is measured at Task 3's tip. If Task 2 added a delete or clear site (for example, for R73(b)'s drop on an unreadable read), the measured counts are the census in Step 1's pin, and its comment lists every site.
- The third grep finds Task 2's local, `regGeneration`. It is typed `ChildReclaimGeneration` and is never undefined: a row the gather holds no answer for reads `unreadable`. Step 3(c) hands it to `childReclaimHoldRetiredStep` as is, UNNARROWED: the step compares through `childReclaimSameGeneration` and `childReclaimSameGenerationKey`, and answers `forget` for `unreadable`. If the grep finds no line, STOP and report: the name is Task 2's.
- `childReclaimSameGeneration`'s parameters are `(entry, bornAt, markerRunId, generation: ChildReclaimGenerationKey)` (ruling H5), as the fourth grep shows. If they differ, STOP and report: Task 2 owes H5's order.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-hold-retired-generation.test.ts`:

```ts
// Child reclamation wave 8, X3 (spec §5.6, §5.7). The lane's hold-retired memory is keyed by the workspace
// generation each sighting was made under, and the release job re-reads that generation nearest its argv.
// There are three layers: L1's `childReclaimHoldRetiredStep` decides what one sighting does to the memory;
// the release job's step 7 re-reads; and the lane applies the step and carries the generation on the
// release request. X3's harm is pacing only. The job re-proves six facts before step 7, and a re-mint's own
// hold is protected by its own live minting run. FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { releaseRetiredChildHold, type ChildReclaimDeps, type ChildReclaimReleaseRequest } from '../src/coord/childReclaim.js';
import { childReclaimHoldRetiredStep, type ChildReclaimGenerationIdentity } from '../src/childReclaimSweep.js';
import type { FleetIO } from '../src/io.js';
import type { Runner } from '../src/exec.js';
import { holdReason, type ChildReclaimGenerationKey } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { G1, G2, laneFixture, type Lane } from './childReclaimGenerationFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

const value = (v: string): ChildReclaimGenerationKey => ({ kind: 'value', v });
const ABSENT: ChildReclaimGenerationKey = { kind: 'absent' };

describe('childReclaimHoldRetiredStep — what one hold-retired sighting does to the memory (L1)', () => {
  const K1: ChildReclaimGenerationIdentity = { bornAt: 100, markerRunId: 7, generation: value(G1) };

  it('no stored key: a first sighting, keyed by all three', () => {
    expect(childReclaimHoldRetiredStep(undefined, 100, 7, value(G1))).toEqual({ kind: 'first', key: K1 });
  });

  it('an EQUAL stored key: the second sighting, carrying the generation the release re-reads', () => {
    expect(childReclaimHoldRetiredStep(K1, 100, 7, value(G1))).toEqual({ kind: 'second', generation: value(G1) });
    expect(childReclaimHoldRetiredStep({ ...K1, generation: ABSENT }, 100, 7, ABSENT))
      .toEqual({ kind: 'second', generation: ABSENT });
  });

  it.each<[string, number | null, number, ChildReclaimGenerationKey]>([
    ['another generation value', 100, 7, value(G2)],
    ['no generation where the stored key had one', 100, 7, ABSENT],
    ['another birth', 101, 7, value(G1)],
    ['a marker naming another run', 100, 8, value(G1)],
  ])('an UNEQUAL stored key (%s): a first sighting, whose key REPLACES the stored one', (_what, bornAt, run, gen) => {
    expect(childReclaimHoldRetiredStep(K1, bornAt, run, gen))
      .toEqual({ kind: 'first', key: { bornAt, markerRunId: run, generation: gen } });
  });

  it('a null birth never matches, a stored null included', () => {
    const unplaced = { ...K1, bornAt: null };
    expect(childReclaimHoldRetiredStep(unplaced, null, 7, value(G1))).toEqual({ kind: 'first', key: unplaced });
  });

  it('an unreadable generation is no key: the memory forgets the id, whatever it held', () => {
    expect(childReclaimHoldRetiredStep(K1, 100, 7, { kind: 'unreadable' })).toEqual({ kind: 'forget' });
    expect(childReclaimHoldRetiredStep(undefined, 100, 7, { kind: 'unreadable' })).toEqual({ kind: 'forget' });
  });
});

const RID = 'demo-quiet-basin';

/** `child-reclaim.test.ts`'s `rrig`, with the row's generation and one log of the job's io and ccd calls,
 *  in order. A terminal run of `demo`, its programme closed, and the row carrying that run's close-claim
 *  hold text. `ws-release` answers `released`. */
const rrig = async (o: { readonly generation?: string | null | 'dir'; readonly paused?: boolean;
  readonly io?: (b: FleetIO) => FleetIO } = {}) => {
  const home = mkTmp('ccrc-child-release-generation-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const log: string[] = [];
  const run: Runner = async (_cmd, args) => {
    log.push(`ccd:${args[0]}`);
    return args[0] === 'ws-release' ? { code: 0, stdout: `released ${RID}\n`, stderr: '' }
      : { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const logged: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => { log.push('readdir'); return base.io.readdir(p, timeoutMs, signal); },
    readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      log.push(`read:${path.basename(p)}`);
      return base.io.readFileMeasured(p, timeoutMs, signal);
    },
  };
  const deps: ChildReclaimDeps = { coord, io: o.io?.(logged) ?? logged, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-release', 'actor-flags-v1'] } };
  const r = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
  expect(coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'demo',
    viaClosing: false }).ok).toBe(true);
  const reason = holdReason('demo', 2, null, null);
  const fields: Record<string, string> = { uuid: `u-${RID}`, wrapper: 'claude', project: 'demo', workdir: `/w/${RID}`,
    workspace: 'quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', started: '1', child: String(r.id), hold: reason };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${RID}.${k}`), v);
  const genPath = path.join(reg, `${RID}.generation`);
  const g = o.generation === undefined ? G1 : o.generation;
  if (g === 'dir') mkdirSync(genPath);
  else if (g !== null) writeFileSync(genPath, g);
  if (o.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const req = (generation: ChildReclaimGenerationKey): ChildReclaimReleaseRequest =>
    ({ sessionId: RID, runId: r.id, reason, program: 'demo', accountedRunId: r.id, generation });
  return { deps, log, req, releases: (): string[] => log.filter((l) => l === 'ccd:ws-release') };
};

describe('releaseRetiredChildHold — step 7, the generation, re-read nearest the argv', () => {
  it('the generation both sightings were made under still stands: released', async () => {
    const f = await rrig();
    expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('released');
    const a = await rrig({ generation: null });
    expect(await releaseRetiredChildHold(a.deps, a.req(ABSENT)), 'absent against absent').toBe('released');
  });

  it.each<[string, string | null, ChildReclaimGenerationKey]>([
    ['a different value', G2, value(G1)],
    ['absent against a value', null, value(G1)],
    ['a value against absent', G1, ABSENT],
  ])('%s answers changed, and composes no ws-release', async (_what, file, carried) => {
    const f = await rrig({ generation: file });
    expect(await releaseRetiredChildHold(f.deps, f.req(carried))).toBe('changed');
    expect(f.releases()).toEqual([]);
  });

  it.each<[string, string]>([['a directory', 'dir'], ['37 bytes', `${G1}\n`]])(
    'an unreadable generation (%s) answers failed, never changed, and composes no ws-release', async (_what, file) => {
      const f = await rrig({ generation: file });
      expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('failed');
      expect(f.releases()).toEqual([]);
    });

  it('a read that rejects answers failed', async () => {
    const f = await rrig({ io: (b) => ({ ...b,
      readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
        if (path.basename(p) === `${RID}.generation`) throw new Error('EIO');
        return b.readFileMeasured(p, timeoutMs, signal);
      } }) });
    await expect(releaseRetiredChildHold(f.deps, f.req(value(G1)))).resolves.toBe('failed');
    expect(f.releases()).toEqual([]);
  });

  it('it is the LAST read: after the switch, and directly before ws-release', async () => {
    const f = await rrig();
    expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('released');
    expect(f.log.slice(-2)).toEqual([`read:${RID}.generation`, 'ccd:ws-release']);
    expect(f.log.lastIndexOf('readdir')).toBeLessThan(f.log.indexOf(`read:${RID}.generation`));
  });

  it('a raised switch answers first: the generation is not read at all', async () => {
    const f = await rrig({ generation: G2, paused: true });
    expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('changed');
    expect(f.log).not.toContain(`read:${RID}.generation`);
  });
});

describe('the hold-retired memory at the lane: keyed by generation (spec §5.6, §5.7)', () => {
  /** demo-a under its own run's close-claim hold, that run's programme closed: `hold-retired` every pass. */
  const heldChild = (f: Lane, generation: string | null): void => {
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: holdReason(r.program, 2, null, null),
      ...(generation === null ? {} : { generation }) });
  };

  it('a sighting over another generation is a FIRST sighting; its key replaces the stored one, and the next sighting of it releases', async () => {
    const f = laneFixture();
    heldChild(f, G1);
    await f.pass();                                          // N: the first sighting, over G1
    f.remint('demo-a', G2);
    f.next(); await f.pass();                                // N+1: over G2
    expect(f.releases(), 'a sighting of another generation is never the second').toEqual([]);
    f.next(); await f.pass();                                // N+2: over G2 again
    expect(f.releases(), 'G2 replaced G1 as the stored key, and the release carries G2').toHaveLength(1);
  });

  it('a re-mint while the release job waits on the session’s queue: its re-read answers changed, and no ws-release is composed', async () => {
    const f = laneFixture();
    heldChild(f, G1);
    await f.pass();                                          // the first sighting
    f.next();
    let free!: () => void;
    const occupied = f.queue.run('demo-a', () => new Promise<void>((resolve) => { free = resolve; }));
    const realRun = f.queue.run.bind(f.queue);
    let queued!: () => void;
    const releaseQueued = new Promise<void>((resolve) => { queued = resolve; });
    vi.spyOn(f.queue, 'run').mockImplementation(((key: string, fn: () => Promise<unknown>) => {
      const p = realRun(key, fn);
      if (key === 'demo-a') queued();
      return p;
    }) as typeof f.queue.run);
    const second = f.pass();                                 // the second sighting queues the job behind the occupier
    await releaseQueued;
    f.remint('demo-a', G2);
    free(); await occupied; await second;
    expect(f.releases(), 'the job’s own re-read found another generation').toEqual([]);
    expect(readdirSync(f.reg), 'the hold stands').toContain('demo-a.hold');
  });

  it('a child unlisted for one pass needs two fresh sightings when it returns: the prune carries over', async () => {
    const f = laneFixture();
    heldChild(f, G1);
    await f.pass();                                          // the first sighting
    f.next();
    const all = await f.listing();
    await f.sweepOn({ records: all.records.filter((r) => r.id !== 'demo-a'),
      names: all.names.filter((n) => !n.startsWith('demo-a.')) });
    f.next(); await f.pass();                                // listed again: a FIRST sighting
    expect(f.releases()).toEqual([]);
    f.next(); await f.pass();                                // its second
    expect(f.releases()).toHaveLength(1);
  });

  it('every delete and clear of the memory carries over: the census', () => {
    // The second sighting's (shared with `forget`), the ineligible arm's, the eligible arm's and the
    // vanished-row prune's deletes, and the two pass-level clears (the mirror or coordination fail-shut,
    // and the switches' return).
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src.match(/this\.childReclaimHoldRetiredSeen\.delete\(/g) ?? []).toHaveLength(4);
    expect(src.match(/this\.childReclaimHoldRetiredSeen\.clear\(\)/g) ?? []).toHaveLength(2);
    expect(src).toMatch(/for \(const id of \[\.\.\.this\.childReclaimHoldRetiredSeen\.keys\(\)\]\) \{/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-hold-retired-generation.test.ts
```

Expected, before Step 3:
- Every L1 case: `TypeError: childReclaimHoldRetiredStep is not a function`.
- The release job: "still stands" PASSES (there is no step 7 yet). The three `changed` cases: `expected 'released' to be 'changed'`. The unreadable cases and the rejecting read: `expected 'released' to be 'failed'`. "the LAST read": `expected [ 'readdir', 'ccd:ws-release' ] to deeply equal [ 'read:demo-quiet-basin.generation', 'ccd:ws-release' ]`. "a raised switch answers first" PASSES.
- The lane: "another generation…": `a sighting of another generation is never the second: expected [ [ 'ws-release', … ] ] to deeply equal []`. "…waits on the session's queue": `the job’s own re-read found another generation: expected [ [ 'ws-release', … ] ] to deeply equal []`. "unlisted for one pass" PASSES: today's Set prune is the control. The census: `expected '…' to match /for \(const id of \[\.\.\.this\.childReclaimHoldRetiredSeen\.keys\(\)\]\) \{/`.

- [ ] **Step 3: Implement**

(a) **L1** (`server/src/childReclaimSweep.ts`). Widen `childReclaimSameGeneration`'s first parameter from `entry: ChildReclaimSweepEntry` to `entry: ChildReclaimGenerationIdentity`. Its body is unchanged. Add to its docstring's first sentence that it reads "an entry, or the lane's hold-retired memory". Then add, directly below it:

```ts
/** The three keys of one workspace generation (spec §5.6: slugs recycle): its birth, the run its marker
 *  names, and its generation file's value. An entry carries them, and so does the lane's hold-retired
 *  memory, so `childReclaimSameGeneration` reads both through this one shape. */
export type ChildReclaimGenerationIdentity = Pick<ChildReclaimSweepEntry, 'bornAt' | 'markerRunId' | 'generation'>;

/** What ONE `hold-retired` sighting does to the lane's hold-retired memory. Spec §5.7: two consecutive
 *  sightings queue the release job. Spec §5.6: slugs recycle, so both sightings must be of ONE generation.
 *  - `second`: the stored key is this generation's (`childReclaimSameGeneration`, whose generation
 *    conjunct is `childReclaimSameGenerationKey`). The lane deletes the key and queues the release,
 *    carrying `generation`, which the job re-reads nearest its argv.
 *  - `first`: no key is stored, or an UNEQUAL one is. `key` REPLACES it, so the next sighting of THIS
 *    generation is the second. Keeping the old key instead would match no later sighting, and the hold
 *    would stand for ever under an `ordinary` verdict that no surface shows.
 *  - `forget`: the generation could not be read. That is no key, so the lane deletes whatever it stored.
 *    The sweep's verdict answers `identity-unmeasured` for such a row before `hold-retired` is reached,
 *    so this arm is defence in depth.
 *  Pure. The lane applies it and decides nothing. */
export type ChildReclaimHoldRetiredStep =
  | { readonly kind: 'second'; readonly generation: ChildReclaimGenerationKey }
  | { readonly kind: 'first'; readonly key: ChildReclaimGenerationIdentity }
  | { readonly kind: 'forget' };

export function childReclaimHoldRetiredStep(
  stored: ChildReclaimGenerationIdentity | undefined, bornAt: number | null, markerRunId: number,
  generation: ChildReclaimGeneration,
): ChildReclaimHoldRetiredStep {
  if (generation.kind === 'unreadable') return { kind: 'forget' };
  if (stored !== undefined && childReclaimSameGeneration(stored, bornAt, markerRunId, generation)) {
    return { kind: 'second', generation };
  }
  return { kind: 'first', key: { bornAt, markerRunId, generation } };
}
```

(b) **The release job** (`server/src/coord/childReclaim.ts`). In `ChildReclaimReleaseRequest`, below `readonly accountedRunId: number;`, add:

```ts
  /** The workspace generation both `hold-retired` sightings were made under (spec §5.6, §5.7): the sweep's
   *  own byte-exact read, a value or `absent`, never unreadable. Step 7 re-reads it. */
  readonly generation: ChildReclaimGenerationKey;
```

In the header's numbered list, after item 6, add:

```
 *   7. the generation (`childReclaimGenerationRead`, the read the executor's
 *      own step 2c makes) — still the one both sightings were made under (spec
 *      §5.6). Read LAST, nearest the argv: a same-run re-mint carries the same
 *      hold text, rendered from the same run, so steps 1 and 2 pass it, and
 *      only this read tells the two workspaces apart. A different value, or
 *      `absent` against a value, answers `changed`; an unreadable read answers
 *      `failed`.
```

At the end of the "THE RESIDUAL, ACCEPTED" paragraph, add: "The gap from step 7's read to ccd's unlink is the same residual for a re-mint, because `ws-release` carries no token and no generation. Releasing a re-minted workspace's hold that way cannot reclaim it: its own minting run is live, so the sweep answers `minting-run-open`."

Step 6's comment "Read last, nearest the argv, like the executor's own step 2b." becomes "Read just before the generation (step 7), like the executor's own step 2b." Then, between `if (pause !== 'clear') return 'failed';` and `// Only now: the one write this job may ever compose.`, add:

```ts
  // 7 — the generation: still the one both sightings were made under (spec §5.6, §5.7). Read LAST,
  // nearest the argv: a same-run re-mint carries the same hold text, rendered from the same run, so
  // steps 1 and 2 pass it, and only this read tells the two workspaces apart.
  let current: ChildReclaimGeneration;
  try {
    current = await childReclaimGenerationRead(deps.io, deps.cfg.registryDir, sessionId);
  } catch (err) {
    console.warn(`ccrc-server: releaseRetiredChildHold: reading ${sessionId}'s generation failed `
      + `(${err instanceof Error ? err.message : String(err)})`);
    return 'failed';
  }
  if (current.kind === 'unreadable') return 'failed';
  if (!childReclaimSameGenerationKey(req.generation, current)) return 'changed';
```

(c) **The lane** (`server/src/watch.ts`). Add `childReclaimHoldRetiredStep` and `type ChildReclaimGenerationIdentity` to the `./childReclaimSweep.js` import. Replace the field and its docstring:

```ts
  /** Per marked child: the workspace generation in which THIS lane has seen a
   *  `hold-retired` verdict for it once, with no other verdict in between. The
   *  key is the child's birth, the run its marker names and its generation
   *  file's value (`ChildReclaimGenerationIdentity`; spec §5.6: slugs recycle).
   *  A `hold-retired` verdict that a SECOND consecutive pass finds for the SAME
   *  generation queues the release job, carrying that generation, which the
   *  job re-reads nearest its argv. A sighting of ANOTHER generation is a
   *  first sighting, and its key REPLACES the stored one.
   *  `childReclaimHoldRetiredStep` (L1) decides which; this lane applies it.
   *  Any other verdict, eligible or any other ineligibility, deletes the
   *  entry, so the two sightings must be back to back. IN MEMORY ONLY, the
   *  `childReclaimSweepState` idiom: a restart only delays a release by one
   *  more sighting, never causes one, because the job's own re-reads and ccd's
   *  rung 4 prove everything again before anything is written. A child already
   *  in `childReclaimInFlight` (its release job dispatched, or its ordinary
   *  reclaim in flight) is never touched here: the lane has no re-entrancy
   *  guard beyond that one set, and an overlapping pass must not turn "two
   *  further passes" into one. */
  private childReclaimHoldRetiredSeen = new Map<string, ChildReclaimGenerationIdentity>();
```

In the `hold-retired` branch, replace these two lines:

```ts
            if (this.childReclaimHoldRetiredSeen.has(r.id)) {
              this.childReclaimHoldRetiredSeen.delete(r.id);
```

with:

```ts
            // TWO SIGHTINGS OF ONE GENERATION (spec §5.6, §5.7). L1 decides what this sighting does to the
            // memory (`childReclaimHoldRetiredStep`). A `first` stores its key, REPLACING whatever an
            // earlier generation left. A `second` or a `forget` deletes it. Only a `second` queues the
            // job, and the job carries the generation.
            const step = childReclaimHoldRetiredStep(
              this.childReclaimHoldRetiredSeen.get(r.id), childBornAt, v.runId, regGeneration);
            if (step.kind === 'first') this.childReclaimHoldRetiredSeen.set(r.id, step.key);
            else this.childReclaimHoldRetiredSeen.delete(r.id);
            if (step.kind === 'second') {
```

- In the release literal, `accountedRunId: release.accountedRunId,` becomes `accountedRunId: release.accountedRunId, generation: step.generation,`.
- Replace the branch's tail, `} else {` / `this.childReclaimHoldRetiredSeen.add(r.id);` / `}`, with a single `}`. Every line between keeps its indentation: the `second` block sits at the depth of the old `if (…has(r.id))` block.
- `regGeneration` is Task 2's local (Step 0), passed as is.
- In the vanished-row prune, `for (const id of [...this.childReclaimHoldRetiredSeen]) {` becomes `for (const id of [...this.childReclaimHoldRetiredSeen.keys()]) {`. A Map spreads to entries, which `tsc` reports against `seen.has(id)`.
- The two `.clear()` sites and the ineligible and eligible arms' `.delete(r.id)` are unchanged: a Map has both methods.
- In `sweepChildReclaim`'s docstring, on the line holding `consecutive pass this pass answers it,` (the sentence wraps after `SECOND`, so never match it as one line), insert ` for the SAME workspace generation (spec §5.6)` directly after `answers it`, before the comma, and keep the rest of the line as it is. Re-wrap only that line and the next if it passes the file's width.

(d) **The existing release cases** (`server/test/child-reclaim.test.ts`):

```bash
cd server && perl -0pi -e 's/(const req: ChildReclaimReleaseRequest = \{[^;]*?accountedRunId: [^;]*?) \};/$1, generation: { kind: \x27absent\x27 } };/gs' test/child-reclaim.test.ts
grep -c "generation: { kind: 'absent' } };" test/child-reclaim.test.ts   # 21, measured at 226bb881c
grep -c "const req: ChildReclaimReleaseRequest = {" test/child-reclaim.test.ts   # the same count
```

The two counts must be equal, and both are measured, never copied. The perl edit also covers the two-line literal (`runId: 1, reason: 'program:demo wave:2',` …). The release rig writes no `.generation`, so `absent` against `absent` keeps every case's answer.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-hold-retired-generation.test.ts test/child-reclaim-sweep-policy.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/child-reclaim-licence-executor.test.ts test/child-reclaim-licence-lane.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts test/child-reclaim-status.test.ts test/unattended-actor.test.ts
```

Expected: all PASS. `child-reclaim-sweep.test.ts`'s hold-retired cases stay green unchanged. Their rows carry no `.generation`, so both sightings key `absent`, the release carries `absent`, and step 7 re-reads `absent`. Its four "the sighting memory resets…" cases are the behavioural pins of the four carried-over reset sites (the ineligible arm, the eligible arm, the fail-shut clear and the switches' clear). Run each line in the foreground with a timeout of at least 600000 ms.

- [ ] **Step 5: Mutation check**

Make each edit, run, see the red, and revert. H is `cd server && ./node_modules/.bin/vitest run test/child-reclaim-hold-retired-generation.test.ts`.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `childReclaimHoldRetiredStep`, `stored !== undefined && childReclaimSameGeneration(stored, bornAt, markerRunId, generation)` becomes `stored !== undefined` (back to the id-keyed Set) | H | L1 "an UNEQUAL stored key (another generation value)": `expected { kind: 'second', … } to deeply equal { kind: 'first', … }`. Lane "another generation…": `a sighting of another generation is never the second: expected [ [ 'ws-release', … ] ] to deeply equal []` |
| 2 | In watch.ts, `if (step.kind === 'first') this.childReclaimHoldRetiredSeen.set(r.id, step.key);` becomes `if (step.kind === 'first') { if (!this.childReclaimHoldRetiredSeen.has(r.id)) this.childReclaimHoldRetiredSeen.set(r.id, step.key); }` (the old key is kept) | H | lane "another generation…": `G2 replaced G1 as the stored key, and the release carries G2: expected [] to have a length of 1 but got +0` |
| 3 | Delete `if (generation.kind === 'unreadable') return { kind: 'forget' };` | H | L1 "an unreadable generation is no key…": `expected { kind: 'first', key: { …, generation: { kind: 'unreadable' } } } to deeply equal { kind: 'forget' }` |
| 4 | Delete the vanished-row prune loop over `this.childReclaimHoldRetiredSeen.keys()` | H | lane "unlisted for one pass…": `expected [ [ 'ws-release', … ] ] to deeply equal []`. The census: `expected [ …(3) ] to have a length of 4 but got 3` |
| 5 | Delete step 7 in `releaseRetiredChildHold` | H | "a different value…": `expected 'released' to be 'changed'`. Lane "…waits on the session's queue": `the job’s own re-read found another generation: expected [ [ 'ws-release', … ] ] to deeply equal []` |
| 6 | In step 7, `!childReclaimSameGenerationKey(req.generation, current)` becomes `req.generation.kind === 'value' && current.kind === 'value' && req.generation.v !== current.v` | H | "absent against a value…" and "a value against absent…": `expected 'released' to be 'changed'` |
| 7 | In step 7, `if (current.kind === 'unreadable') return 'failed';` becomes `… return 'changed';` | H | the two unreadable cases: `expected 'changed' to be 'failed'` |
| 8 | Move step 7 above step 6 | H | "the LAST read…": `expected [ 'readdir', 'ccd:ws-release' ] to deeply equal [ 'read:demo-quiet-basin.generation', 'ccd:ws-release' ]`. "a raised switch answers first…": `expected [ …, 'read:demo-quiet-basin.generation' ] not to include 'read:demo-quiet-basin.generation'` |
| 9 | In watch.ts's release literal, `generation: step.generation,` becomes `generation: { kind: 'absent' },` | H | lane "another generation…": the job reads G2 against `absent` and answers `changed`, so `…: expected [] to have a length of 1 but got +0` |
| 10 | Delete the ineligible arm's `this.childReclaimHoldRetiredSeen.delete(r.id);` (the one directly above `this.childReclaimLogAbsence(r, v.why, reviewedId);`) | H, then `cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts -t 'an intervening OTHER-ineligible verdict'` | the census: `expected [ …(3) ] to have a length of 4 but got 3`. The sweep case: `queued on one sighting after an intervening held pass: expected [ [ 'ws-release', … ] ] to deeply equal []` |
| 11 | Delete step 7's `try`/`catch`, keeping the `await` | `H -t 'rejects'` | `promise rejected "Error: EIO" instead of resolving`. Red because Task 2's reader lets a port's rejection propagate (ruling H5); green means the reader catches it, which H5 forbids: STOP and report, as Task 3's row 7 says |

- [ ] **Step 6: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
git add server/src/childReclaimSweep.ts server/src/coord/childReclaim.ts server/src/watch.ts \
  server/test/child-reclaim-hold-retired-generation.test.ts server/test/child-reclaim.test.ts
git commit -m "$(cat <<'MSG'
feat(server): key the hold-retired memory by workspace generation

The lane's hold-retired memory is now a Map from id to the generation a
sighting was made under: its birth, its marker's run and its generation.
childReclaimHoldRetiredStep (L1) decides each sighting. An equal stored key
is the second sighting, which queues the release. An unequal one is a first
sighting whose key replaces the stored one. An unreadable generation is no
key. Every delete and clear site carries over. The release request carries
the generation, and releaseRetiredChildHold re-reads it last, nearest the
argv: a different value answers changed, and an unreadable read answers
failed. Spec §5.6, §5.7.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The birth is unplaced by a later `purge`, never by the row's own: `lifecycleBirthEventsFor`, `childReclaimBornAt`'s row uuid, and the four consumers

**Model routing:** **`opus`, effort `high`**. SAFETY: the birth is one operand of the birth fence and of the coordination fence. Both decide whether `ws-reclaim` is ever asked for, so an answer that is placed when it should be doubt can license a reclaim. Wave 8's SAFETY panel reads this diff together with Tasks 2-4.

**Why:** Contract §15 R75 closes R61 and amends R40's "The birth" bullet.
- **What goes wrong today.** At `226bb881c`, `childReclaimBornAt` reads `create` rows only (`server/src/coord/childReclaim.ts:185-189`; anchor: `grep -n "^export function childReclaimBornAt" server/src/coord/childReclaim.ts`). Suppose a slug is recycled and its new `create` has not been placed yet: it is not ingested, or its `at` is ahead of the server's clock. Then the OLDER generation's `create` stands in as the birth. That is R61's `kept-word-ends-on-late-birth` window.
- **The fix.** The birth now also reads the `purge done` rows. ccd journals one at `_reg_purge` (`ccd/ccd:4022`, `grep -n '_lc_done purge "$1"' ccd/ccd`), BEFORE its unlink loop, and the row carries `meas.uuid` (`ccd/ccd:4026`).
- **When a purge FOLLOWS the opening create,** the birth is unplaced (doubt, `child-birth-unplaced`, R60). A purge follows it when all three hold:
  - its mirror id is higher;
  - ccd's own clock does not prove it came first, that is NOT (`purge.at !== null && purge.at < create.at`);
  - it is not the row's OWN purge. A purge counts unless its `meas.uuid` equals the listed row's current `.uuid`, and a purge with no `meas.uuid` counts.
- **Why the row's own purge is excluded.** ccd may die between the emit and the unlinks, or `_reg_purge` may answer rc 3 with `.uuid` and `.child` still standing. Either way the SAME generation's row is still listed, and its own `purge done` follows its own `create` for the rest of that row's life. Without the uuid test that child would read doubt on every pass and never resume (wave 8's attack, "the R61 closure strands a row that today heals itself").
- **A purge with a null `at` counts.** ccd always stamps `at`, so only a hand-written or foreign line reaches that arm.
- **`collect` is excluded by construction:** it never purges, and the read never asks for it.
- **`lifecycleCreatesFor` is left unchanged** for its other caller, the attention list's generation rows (`server/src/watch.ts:3822`, `grep -n "const creates = coord.lifecycleCreatesFor(sessionId);" server/src/watch.ts`).
- **The four consumers (R40)** each hand the placement the uuid of the row THEY read:
  - the sweep (`watch.ts:3511`);
  - the executor's step 2a (`childReclaim.ts:888`);
  - close (`close.ts:774`);
  - the hold-release job's step 5 (`childReclaim.ts:1228`).
- **The stated residual.** An unplaced birth plus an EARLIER claim reads "coordinated", because `childReclaimCoordinated` keeps a child whose birth is null (`server/src/childReclaimSweep.ts:344-352`). The sweep never shows that: its `child-birth-unplaced` check (`childReclaimSweep.ts:579`) comes before `coordinating` (`:617`). The other three consumers decline in the safe direction:
  - step 2a defers `siblings-open` ("has coordinated run(s)");
  - close declines `has-coordinated`;
  - the release job answers `changed`.

  Each consumer is pinned below, and none of them keeps a child once the new create is placed.
- **`child-birth-unplaced`'s sentence is reworded (the coordinator's ruling on Task 5).** Today it says only "The lifecycle journal holds no dated creation of this workspace" (`server/src/childReclaimSweep.ts:495-497` at `226bb881c`). That becomes false once a purge unplaces a birth whose create IS dated. The sentence now names both causes: no dated creation, or a removal journaled after the creation that ccrc has not yet seen replaced. It never says "holds no dated creation" alone (Step 3g).
- **A second stated residual, carried by Task 10's docs (the coordinator's ruling).** R75 adopted the uuid discriminator, not a bounded window. So a recycled slug whose new `create` line was LOST (`_lc_emit` never gates; a full disk, for example) reads `child-birth-unplaced` (doubt) until a later `create` is mirrored. Today it reads `minting-run-postdates-child`, a kept word with a banner item. This task does not bound it.

**Files:**
- Modify: `server/src/coord/store.ts`.
  - Add the module-level `LifecycleBirthAct`, `LIFECYCLE_BIRTH_ACT`, `LIFECYCLE_BIRTH_ACTS`, `isLifecycleBirthAct` and `LifecycleBirthEvent` directly above `export class CoordStore` (`grep -n "^export class CoordStore" server/src/coord/store.ts`; `:1541` at `226bb881c`).
  - Add `static readonly LIFECYCLE_BIRTH_EVENTS_SQL` and `lifecycleBirthEventsFor` directly after `lifecycleCreatesFor` (`grep -n "^  lifecycleCreatesFor(sessionId: string)" server/src/coord/store.ts`; `:5784`).
  - Rewrite `lifecycleCreatesFor`'s docstring only. Its body stays byte-identical.
  - Add `type LifecycleOutcome` to the `../../../shared/api.js` import if `grep -n "type LifecycleOutcome" server/src/coord/store.ts` prints nothing.
- Modify: `server/src/coord/childReclaim.ts`.
  - `childReclaimRowUuid` (new), `childReclaimBornAt` and `childReclaimHasCoordinated` (`grep -n "^export function childReclaimBornAt\|^export function childReclaimHasCoordinated" server/src/coord/childReclaim.ts`).
  - Step 2a's call (`grep -n "if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)()))" server/src/coord/childReclaim.ts`: two hits, `:888` step 2a and `:1228` step 5).
  - `childReclaimGeneration`'s docstring clause about the birth fence (`grep -n "the birth fence calls it over" server/src/coord/childReclaim.ts`; `:141`).
  - Add `type SessionRecord` to the `../registry.js` import (`grep -n "^import { readSessionRecord } from '../registry.js';" server/src/coord/childReclaim.ts`).
- Modify: `server/src/coord/close.ts`, one statement (`grep -n "hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now());" server/src/coord/close.ts`; `:774`). The import list gains `childReclaimRowUuid` (`:25`).
- Modify: `server/src/watch.ts`.
  - The sweep's birth line (`grep -n "childBornAt = childReclaimBornAt(coord, r.id, now);" server/src/watch.ts`; `:3511`) and the comment above it, from "The child's own birth is the OPENING" to "all read.".
  - The last sentence of `childReclaimAttentionGenerationRows`' docstring (`grep -n "The birth$\|fence (above, in the per-child loop) does NOT use this" server/src/watch.ts`).
  - Add `childReclaimRowUuid` to the `./coord/childReclaim.js` import (`:89`).
- Modify: `server/src/childReclaimSweep.ts` (L1), the coordinator's reword (Step 3g):
  - `CHILD_RECLAIM_SKIP['child-birth-unplaced']`'s sentence (`grep -n "'child-birth-unplaced': { class: 'doubt', sentence:" server/src/childReclaimSweep.ts`; `:495-497` at `226bb881c`);
  - the class note's `doubt` bullet (`grep -n "the mirror holds no dated creation of the workspace" server/src/childReclaimSweep.ts`; `:453`).
- Modify: `server/test/child-reclaim-sweep-policy.test.ts`. The sentence pin (`grep -n "child-birth-unplaced is doubt: its sentence says" server/test/child-reclaim-sweep-policy.test.ts`; `:1302-1308`) and the comment above it are rewritten DELIBERATELY.
- Modify: `server/test/childReclaimGenerationFixture.ts`, Task 3's ONE lane rig (H7), additively (Step 1a): `LaneOpts.exec`, and `journal` and `advance` on its return. Its uid counter moves to module scope.
- Modify: `server/test/child-reclaim-generation.test.ts`.
  - The K8 placement pin (`grep -n "const placement = 'childReclaimGeneration(coord.lifecycleCreatesFor';" server/test/child-reclaim-generation.test.ts`; `:160-167`), rewritten DELIBERATELY.
  - The comment at `:97` (`grep -n "childReclaimBornAt\` reads" server/test/child-reclaim-generation.test.ts`).
- Modify: `server/test/child-reclaim-close.test.ts`. K5d's stub is re-aimed (`grep -n "b.coord.lifecycleCreatesFor = () =>" server/test/child-reclaim-close.test.ts`; `:302`). Left as it is, K5d would pass vacuously.
- Modify: `server/test/child-reclaim-sweep.test.ts`. The two direct calls gain the row uuid (`grep -n "childReclaimBornAt(f.coord, 'demo-a', f.now())\|childReclaimHasCoordinated(f.coord, 'demo-a', f.now())" server/test/child-reclaim-sweep.test.ts`; `:1984`, `:2028`). `typecheck-tests.test.ts` compiles this file.
- Test: `server/test/child-reclaim-birth-removal.test.ts` (new, R56).

**Interfaces:**
- Produces:
  ```ts
  // server/src/coord/store.ts
  export type LifecycleBirthAct = Extract<LifecycleAct, 'create' | 'purge'>;
  export interface LifecycleBirthEvent {
    readonly id: number; readonly act: LifecycleBirthAct; readonly at: number | null; readonly uuid: string | null;
  }
  static readonly LIFECYCLE_BIRTH_EVENTS_SQL: string;
  lifecycleBirthEventsFor(sessionId: string): readonly LifecycleBirthEvent[];   // done create + done purge, mirror id order
  // server/src/coord/childReclaim.ts
  export function childReclaimRowUuid(rec: Pick<SessionRecord, 'uuid' | 'unmeasured'>): string | null;
  export function childReclaimBornAt(
    coord: Pick<CoordStore, 'lifecycleBirthEventsFor'>, sessionId: string, nowMs: number, rowUuid: string | null,
  ): number | null;
  export function childReclaimHasCoordinated(
    coord: Pick<CoordStore, 'childReclaimCoordinatorClaims' | 'lifecycleBirthEventsFor'>, sessionId: string,
    nowMs: number, rowUuid: string | null,
  ): boolean;
  ```
- Consumes:
  - from earlier tasks and waves:
    - Task 2's `ChildReclaimRequest.licenceGeneration: ChildReclaimGenerationKey | { kind: 'none' }` (required);
    - Task 4's `ChildReclaimReleaseRequest.generation: ChildReclaimGenerationKey`, below `accountedRunId`;
    - Task 3's `server/test/childReclaimGenerationFixture.ts`: `laneFixture` and `Lane`, the ONE lane rig (H7). This task extends it additively;
    - wave 7's `'collect'` member of `LifecycleAct` (Task 0 requires wave 7's tree, H1).
  - existing at `226bb881c`:
    - `readSessionRecord`/`SessionRecord` (`server/src/registry.ts:1223`, `:44`);
    - `childReclaimGeneration` (`childReclaim.ts:145`);
    - `childReclaimCoordinated` (`childReclaimSweep.ts:344`);
    - `CHILD_BIRTH_SKEW_MS`;
    - `reviveMeas`, `jsonOrNull` and `placeholders` (`store.ts:41`, `:1378`, `:1093`).

- [ ] **Step 1: Write the failing test**

**1a. Extend the shared lane fixture (H7), additively.** The sweep case below runs on Task 3's `laneFixture`, never on a second `FleetWatcher` rig. In `server/test/childReclaimGenerationFixture.ts`:

- In `LaneOpts`, directly after `afterRead`, add:

  ```ts
    /** Replaces the REAL executor (wave 8 Task 5, additive). The rig still records each request and its
     *  answer in `requests` and `outcomes`. Absent: the real executor on the watcher's queue, as before. */
    readonly exec?: (req: ChildReclaimRequest) => ChildReclaimOutcome | Promise<ChildReclaimOutcome>;
  ```

- In `deps`, replace the `childReclaimExec` arrow with:

  ```ts
      childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
        requests.push(req);
        const o = opts.exec !== undefined ? await opts.exec(req) : await base.queue.run(req.sessionId, () => reclaimChild(
          { coord, io, cfg, runCcd: base.runCcd, fleetState, presence }, req));
        outcomes.push(o);
        return o;
      },
  ```

- Move `let uidN = 0;` out of `laneFixture` to module scope, directly above `export const laneFixture`, as:

  ```ts
  /** ONE journal uid and cursor counter for every rig in a test file. A second rig over the same coord.db
   *  must never reuse a uid, because the mirror inserts OR IGNORE. */
  let uidN = 0;
  ```

- Directly after `remint`, add:

  ```ts
    /** One ccd journal line for `id`, mirrored at the rig's wall clock. `over` is spread last, so
     *  `{ meas: { uuid } }` carries `_reg_purge`'s uuid and `{ at }` sets the line's own clock. */
    const journal = (id: string, act: string, outcome: string, over: Readonly<Record<string, unknown>> = {}): void => {
      uidN += 1;
      const line = JSON.stringify({ uid: `w8.1.${uidN}`, at: clock, act, outcome, id, ...over });
      coord.ingestJournal({ gen: '1790000000000000000', rows: [parseJournalLine(line)], cursor: uidN * 200,
        size: uidN * 200, at: clock });
    };
    /** Moves the wall clock and the monotonic clock together, by `ms`. */
    const advance = (ms: number): void => { clock += ms; mono += ms; };
  ```

- Add `journal, advance` to the returned object, after `releases`. Nothing else in the file changes, so Task 3's and Task 4's cases keep their exact meaning.

**1b.** Create `server/test/child-reclaim-birth-removal.test.ts`:

```ts
// Child reclamation, wave 8: the birth (spec §5.1) is the opening `create` of the workspace's current
// generation, and a `purge` that follows it makes it unplaced (spec §5.6: slugs recycle). The row's OWN
// purge never does: ccd journals `purge done` BEFORE it unlinks the row, so a purge that died mid-way,
// or answered rc 3, leaves the same generation's row listed with its own purge after its own create.
// ONE store read (`lifecycleBirthEventsFor`), ONE placement (`childReclaimBornAt`). There are FOUR
// consumers that hand it the uuid of the row each one read: the sweep, the executor's step 2a, close,
// and the hold-release job's step 5. An unplaced birth with an earlier claim reads "coordinated" at
// the last three; each of them declines (the sweep shows its doubt word first). This file pins that
// residual so it cannot widen.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionRecord } from '../src/registry.js';
import { CoordStore, type LifecycleBirthEvent } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, childReclaimBornAt, childReclaimGeneration, childReclaimRowUuid, reclaimChild,
  releaseRetiredChildHold, type ChildReclaimDeps, type ChildReclaimOutcome, type ChildReclaimReleaseRequest,
  type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_SKIP } from '../src/childReclaimSweep.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP } from '../src/ccdargv.js';
import { LIFECYCLE_ACTS, holdReason, type MirroredLifecycleEvent } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { laneFixture, type Lane } from './childReclaimGenerationFixture.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const NOW = T0 + 60_000;
const GEN = '1790000000000000000';
const ID = 'demo-a';
const ROW_UUID = 'u-demo-a';
const OLD_UUID = 'u-demo-a-old';
const S = CHILD_BIRTH_SKEW_MS;

let uidN = 0;
/** One ccd journal line for `id`, mirrored. `meas` is the line's own `meas` object: `_reg_purge` writes `uuid`. */
const mirror = (coord: CoordStore, id: string, act: string, outcome: string, at: number | null,
  meas?: Record<string, unknown>): void => {
  uidN += 1;
  const line = JSON.stringify({ uid: `r8b.1.${uidN}`, ...(at === null ? {} : { at }), act, outcome, id,
    ...(meas === undefined ? {} : { meas }) });
  coord.ingestJournal({ gen: GEN, rows: [parseJournalLine(line)], cursor: uidN * 200, size: uidN * 200, at: at ?? T0 });
};
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-birth-rm-'), '.ccrc', 'coord.db')));

describe('CoordStore.lifecycleBirthEventsFor — the birth read', () => {
  it('returns the done create and purge rows of one session, in mirror id order, each with its meas.uuid', () => {
    const s = store();
    mirror(s, ID, 'create', 'intent', T0);
    mirror(s, ID, 'create', 'done', T0 + 1, { uuid: ROW_UUID });
    mirror(s, ID, 'reclaim', 'done', T0 + 2);
    mirror(s, ID, 'destroy', 'done', T0 + 3);
    mirror(s, ID, 'purge', 'refused', T0 + 4, { uuid: ROW_UUID });
    mirror(s, ID, 'purge', 'done', T0 + 5, { uuid: ROW_UUID });
    mirror(s, 'demo-b', 'purge', 'done', T0 + 6, { uuid: 'u-demo-b' });
    mirror(s, ID, 'purge', 'done', null);
    const got = s.lifecycleBirthEventsFor(ID);
    expect(got.map(({ act, at, uuid }) => ({ act, at, uuid }))).toEqual([
      { act: 'create', at: T0 + 1, uuid: ROW_UUID },
      { act: 'purge', at: T0 + 5, uuid: ROW_UUID },
      { act: 'purge', at: null, uuid: null },
    ]);
    expect(got[0]!.id).toBeLessThan(got[1]!.id);
    expect(got[1]!.id).toBeLessThan(got[2]!.id);
  });

  it('collect is excluded by construction: a later collect done is not read and does not unplace the birth', () => {
    expect(LIFECYCLE_ACTS as readonly string[], 'wave 7\'s collect act is on this branch (Task 0 brought wave 7\'s tree, H1)')
      .toContain('collect');
    const s = store();
    mirror(s, ID, 'create', 'done', T0, { uuid: ROW_UUID });
    mirror(s, ID, 'collect', 'done', T0 + 1);
    expect(s.lifecycleBirthEventsFor(ID).map((e) => e.act)).toEqual(['create']);
    expect(childReclaimBornAt(s, ID, NOW, ROW_UUID)).toBe(T0);
  });

  it('seeks through lifecycle_by_session: the hint is in the text it runs, and the plan never scans', () => {
    expect(CoordStore.LIFECYCLE_BIRTH_EVENTS_SQL).toContain('INDEXED BY lifecycle_by_session');
    const s = store();
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${CoordStore.LIFECYCLE_BIRTH_EVENTS_SQL}`)
      .all(ID, 'create', 'purge', 'done') as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toContain('lifecycle_by_session');
    expect(plan).not.toContain('SCAN lifecycle_events');
  });

  it('lifecycleCreatesFor is unchanged for the attention list: every create row of every outcome, and no purge', () => {
    const s = store();
    mirror(s, ID, 'create', 'intent', T0);
    mirror(s, ID, 'create', 'done', T0 + 1);
    mirror(s, ID, 'purge', 'done', T0 + 2, { uuid: ROW_UUID });
    expect(s.lifecycleCreatesFor(ID).map((e) => `${e.act}:${e.outcome}`)).toEqual(['create:intent', 'create:done']);
  });
});

describe('childReclaimRowUuid — the listed row\'s uuid, as the own-purge test reads it', () => {
  it('the measured uuid; null when the uuid itself was unmeasured; another field\'s doubt does not touch it', () => {
    const rec = (uuid: string, unmeasured: SessionRecord['unmeasured']) => ({ uuid, unmeasured });
    expect(childReclaimRowUuid(rec(ROW_UUID, []))).toBe(ROW_UUID);
    expect(childReclaimRowUuid(rec('', ['uuid']))).toBeNull();
    expect(childReclaimRowUuid(rec(ROW_UUID, ['wrapper', 'workdir']))).toBe(ROW_UUID);
  });
});

/** A store answering the birth read with `rows`, in the order given, so a case can hand them over out of id order. */
const fake = (rows: readonly LifecycleBirthEvent[]) => ({ lifecycleBirthEventsFor: () => rows });
const c = (id: number, at: number | null): LifecycleBirthEvent => ({ id, act: 'create', at, uuid: null });
const p = (id: number, at: number | null, uuid: string | null): LifecycleBirthEvent => ({ id, act: 'purge', at, uuid });

const TABLE: readonly (readonly [string, readonly LifecycleBirthEvent[], string | null, number | null])[] = [
  ['no rows: nothing to place', [], ROW_UUID, null],
  ['one placed create is the birth', [c(1, T0)], ROW_UUID, T0],
  ['a clockless create places nothing', [c(1, null)], ROW_UUID, null],
  ['a create ahead of the server clock places nothing', [c(1, NOW + 1)], ROW_UUID, null],
  ['a purge of ANOTHER uuid after the create unplaces it', [c(1, T0), p(2, T0 + 5, OLD_UUID)], ROW_UUID, null],
  ['the row\'s OWN purge never unplaces it', [c(1, T0), p(2, T0 + 5, ROW_UUID)], ROW_UUID, T0],
  ['a purge with no meas.uuid counts', [c(1, T0), p(2, T0 + 5, null)], ROW_UUID, null],
  ['an unmeasured row uuid makes every purge count, its own included', [c(1, T0), p(2, T0 + 5, ROW_UUID)], null, null],
  ['an unmeasured row uuid and a purge with no uuid are never "the same"', [c(1, T0), p(2, T0 + 5, null)], null, null],
  ['an earlier generation\'s purge, below the opening create by id, does not follow it',
    [c(1, T0), p(2, T0 + 5, OLD_UUID), c(3, T0 + 5)], ROW_UUID, T0 + 5],
  ['a purge ccd\'s own clock places before the create does not follow it, whatever its id',
    [c(1, T0 + 10), p(2, T0 + 5, OLD_UUID)], ROW_UUID, T0 + 10],
  ['a purge at the create\'s own instant follows it', [c(1, T0), p(2, T0, OLD_UUID)], ROW_UUID, null],
  ['a purge with a null at follows it', [c(1, T0), p(2, null, OLD_UUID)], ROW_UUID, null],
  ['the recycled-slug window: the new create is ahead of the server clock, so the old purge follows the old create',
    [c(1, T0), p(2, T0 + 5, OLD_UUID), c(3, NOW + 1)], ROW_UUID, null],
  ['the mirror id picks the opening create, never the array order',
    [c(3, T0 + 10), p(2, T0 + 5, OLD_UUID), c(1, T0)], ROW_UUID, T0 + 10],
];

describe('childReclaimBornAt — the opening create, unless a purge that is not the row\'s own follows it', () => {
  it.each(TABLE)('%s', (_name, rows, rowUuid, want) => {
    expect(childReclaimBornAt(fake(rows), ID, NOW, rowUuid)).toBe(want);
  });

  it('a clock that reads NaN places no birth', () => {
    expect(childReclaimBornAt(fake([c(1, T0)]), ID, Number.NaN, ROW_UUID)).toBeNull();
  });

  it('with no purge, the opening create is childReclaimGeneration\'s over the same creates — one placement', () => {
    const asMirrored = (e: LifecycleBirthEvent): MirroredLifecycleEvent => ({
      uid: `eq.${e.id}`, at: e.at, act: 'create', badact: null, outcome: 'done', badoutcome: null, id: ID, tx: null,
      verb: 'ws-add', refusal: null, detail: null, truncated: false, obs: null, dec: null, meas: null, raw: '', gen: '1',
      ingestedAt: T0,
    });
    const lists: readonly LifecycleBirthEvent[][] = [
      [], [c(1, T0)], [c(1, null)], [c(1, T0), c(2, T0 + 10)], [c(1, T0), c(2, null)], [c(1, T0), c(2, NOW + 1)],
      [c(1, T0 + 10), c(2, T0)], [c(1, null), c(2, T0), c(3, NOW + 5), c(4, T0 + 3)],
    ];
    for (const rows of lists) {
      expect(childReclaimBornAt(fake(rows), ID, NOW, ROW_UUID), JSON.stringify(rows))
        .toBe(childReclaimGeneration(rows.map(asMirrored), NOW)[0]?.at ?? null);
    }
  });
});

// ── the four consumers ───────────────────────────────────────────────────────

/** What the consumer timeline drives: the store, a wall clock to move, and a journal line mirrored at that
 *  clock. The sweep's rig is the shared `laneFixture` (H7). The other three consumers call their unit
 *  directly, over `clockRig`. */
type Rig = Pick<Lane, 'coord' | 'advance' | 'journal'>;
const clockRig = (coord: CoordStore): Rig => {
  let t = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => t);
  return {
    coord,
    advance: (ms) => { t += ms; },
    journal: (id, act, outcome, over = {}) =>
      mirror(coord, id, act, outcome, t, over['meas'] as Record<string, unknown> | undefined),
  };
};

/** The registry row `ws-add` writes, `uuid` = ROW_UUID, plus `extra`. */
const writeRow = (reg: string, extra: Record<string, string>): void => {
  const fields: Record<string, string> = { uuid: ROW_UUID, wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`,
    workspace: 'a', branch: `ws/${ID}`, base: 'origin/main', started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};
/** A run of `program`, opened and abandoned now; its id. */
const finished = (coord: CoordStore, program: string, claimedBy = 'demo-coord'): number => {
  const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy });
  if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
  const closed = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null,
    program, viaClosing: false });
  if (!closed.ok) throw new Error(`abandon refused: ${JSON.stringify(closed)}`);
  return r.id;
};
/** THE CONSUMER TIMELINE. Both rigs start their wall clock at T0.
 *  - At T0, a run `ID` coordinated closes: an EARLIER claim.
 *  - Ten skews later, ws-add's `create done` is mirrored.
 *  - A second after that, a `purge done` carrying `purgeUuid` is mirrored.
 *  With the row's own uuid, that purge is the row's unfinished purge. The birth stands ten skews after the
 *  claim, so the claim belongs to an earlier generation. With another uuid, the birth is unplaced and the
 *  old claim reads "coordinated". */
const timeline = (rig: Rig, purgeUuid: string): void => {
  finished(rig.coord, 'birth-rm-claim', ID);
  rig.advance(10 * S);
  rig.journal(ID, 'create', 'done', { meas: { uuid: ROW_UUID } });
  rig.advance(1_000);
  rig.journal(ID, 'purge', 'done', { meas: { uuid: purgeUuid } });
};

describe('the sweep hands the birth its row\'s uuid', () => {
  /** The ONE lane rig (H7), with the executor stubbed through this task's additive `exec`. Its `plant` is not
   *  used: it journals a `create`, which would place the birth again after the purge. */
  const sweep = async (purgeUuid: string) => {
    const f = laneFixture({
      exec: (req) => ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }),
    });
    timeline(f, purgeUuid);
    const minted = finished(f.coord, 'birth-rm-sweep');
    writeRow(f.reg, { child: String(minted) });
    await f.pass();
    const verdict = f.watcher.currentChildReclaimVerdicts()?.get(ID);
    f.next();
    await f.pass();
    return { verdict, requests: f.requests, minted };
  };

  it('the sweep: the row\'s own purge leaves the birth placed, and the second pass asks', async () => {
    const r = await sweep(ROW_UUID);
    expect(r.verdict).toMatchObject({ eligible: true, runId: r.minted });
    expect(r.requests.map((q) => q.sessionId)).toEqual([ID]);
  });

  it('the sweep: another uuid\'s purge is doubt, child-birth-unplaced — never coordinating — and nothing is asked', async () => {
    const r = await sweep(OLD_UUID);
    expect(r.verdict).toMatchObject({ eligible: false, why: 'child-birth-unplaced' });
    expect(r.requests).toEqual([]);
  });
});

describe('child-birth-unplaced says both of its causes (the coordinator\'s ruling on R75)', () => {
  it('names a missing dated creation AND a removal after it, never the first alone, and still ends on the next pass', () => {
    const s = CHILD_RECLAIM_SKIP['child-birth-unplaced'].sentence;
    expect(s).toContain('holds no dated creation of this workspace, or a removal journaled after its creation');
    expect(s).toContain('has not yet seen replaced by a newer creation');
    expect(s).not.toContain('holds no dated creation of this workspace, so');
    expect(s.endsWith('on its next pass.')).toBe(true);
  });
});

describe('the executor\'s step 2a hands the birth the row it read', () => {
  /** The pause is raised, so step 2b answers whatever step 2a lets through. That happens before presence,
   *  the generation re-read and any argv. */
  const exec = async (purgeUuid: string): Promise<ChildReclaimOutcome> => {
    const home = mkTmp('ccrc-birth-rm-exec-');
    const base = testDeps(home, async () => ({ code: 1, stdout: '', stderr: '' }));
    const reg = base.cfg.registryDir;
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    timeline(clockRig(coord), purgeUuid);
    const minted = finished(coord, 'birth-rm-exec');
    writeRow(reg, { child: String(minted) });
    writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
        ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] } };
    return reclaimChild(deps, { sessionId: ID, runId: minted, trigger: 'sweep', deferExpired: false,
      deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'absent' } });
  };

  it('the executor: the row\'s own purge passes step 2a — the raised switch answers', async () => {
    expect(await exec(ROW_UUID)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
  });

  it('the executor: another uuid\'s purge plus an earlier claim defers siblings-open, has coordinated (the residual)', async () => {
    expect(await exec(OLD_UUID)).toMatchObject({ kind: 'deferred', why: 'siblings-open',
      detail: `${ID} has coordinated run(s)` });
  });
});

describe('the hold-release job\'s step 5 hands the birth the row its step 1 read', () => {
  const release = async (purgeUuid: string) => {
    const home = mkTmp('ccrc-birth-rm-release-');
    const calls: string[][] = [];
    const base = testDeps(home, async (_cmd, args) => {
      calls.push(args);
      return args[0] === 'ws-release' ? { code: 0, stdout: `released ${ID}\n`, stderr: '' } : { code: 1, stdout: '', stderr: '' };
    });
    const reg = base.cfg.registryDir;
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    timeline(clockRig(coord), purgeUuid);
    const minted = finished(coord, 'birth-rm-held');
    const reason = holdReason('birth-rm-held', 2, null, null);
    writeRow(reg, { child: String(minted), hold: reason });
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-release', ACTOR_FLAGS_CAP] } };
    const req: ChildReclaimReleaseRequest = { sessionId: ID, runId: minted, reason, program: 'birth-rm-held',
      accountedRunId: minted, generation: { kind: 'absent' } };
    return { out: await releaseRetiredChildHold(deps, req), calls };
  };

  it('the release job: the row\'s own purge passes step 5, and ws-release runs', async () => {
    const r = await release(ROW_UUID);
    expect(r.out).toBe('released');
    expect(r.calls.map((a) => a[0])).toEqual(['ws-release']);
  });

  it('the release job: another uuid\'s purge plus an earlier claim answers changed and composes nothing (the residual)', async () => {
    const r = await release(OLD_UUID);
    expect(r.out).toBe('changed');
    expect(r.calls).toEqual([]);
  });
});

describe('close hands the birth the row its mark read read', () => {
  const close = async (purgeUuid: string) => {
    const home = mkTmp('ccrc-birth-rm-close-');
    const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
    const reg = base.cfg.registryDir;
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const handed: ChildReclaimRequest[] = [];
    const deps: CloseRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      childReclaim: (req: ChildReclaimRequest) => { handed.push(req); } };
    timeline(clockRig(coord), purgeUuid);
    const r = coord.openRun({ program: 'birth-rm-close', title: 't', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'demo-coordinator' });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, ID, ID, `ws/${ID}`, false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    writeRow(reg, { child: String(r.id) });
    return { out: await closeRun(deps, r.id, { intent: 'abandon' }, 'operator'), handed };
  };

  it('close: the row\'s own purge leaves the birth placed, and the close queues the reclaim', async () => {
    const r = await close(ROW_UUID);
    expect(r.out).toMatchObject({ ok: true, childReclaim: 'queued' });
    expect(r.handed.map((q) => q.sessionId)).toEqual([ID]);
  });

  it('close: another uuid\'s purge plus an earlier claim declines has-coordinated — fail-safe, the sweep re-judges (the residual)', async () => {
    const r = await close(OLD_UUID);
    expect(r.out).toMatchObject({ ok: true, childReclaim: 'not-queued', childReclaimWhy: 'has-coordinated' });
    expect(r.handed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-birth-removal.test.ts`

Expected: FAIL, 26 of 31. The five that pass are listed at the end.
- **The store's birth read, its collect case and the row-uuid case:** `TypeError: s.lifecycleBirthEventsFor is not a function` (and `childReclaimRowUuid is not a function`).
- **The hint case:** an AssertionError naming `undefined` (`CoordStore.LIFECYCLE_BIRTH_EVENTS_SQL` does not exist).
- **The 15 table rows, the NaN case and the equivalence case:** `TypeError: coord.lifecycleCreatesFor is not a function`, because today's `childReclaimBornAt` reads the old method off the fake.
- **The four "another uuid" consumer cases.** Today's birth ignores purges, so each answers as if the birth were placed:
  - sweep: `expected { eligible: true, … } to match object { eligible: false, why: 'child-birth-unplaced' }`;
  - executor: `why: 'paused-at-server'` received where `'siblings-open'` was expected;
  - release job: `expected 'released' to be 'changed'`;
  - close: `childReclaim: 'queued'` received where `'not-queued'` was expected.
- **The sentence case** (`child-birth-unplaced says both of its causes`): `expected 'The lifecycle journal holds no dated creation of this workspace, so nothing…' to contain 'holds no dated creation of this workspace, or a removal journaled after its creation'`. `child-reclaim-sweep-policy.test.ts` is still green here: its pin still names today's sentence until Step 3g.
- **The five that PASS:**
  - `lifecycleCreatesFor is unchanged`, a guard;
  - the four "own purge" consumer cases. Today's reader ignores every purge, so they already pass. From Step 3 on they are the uuid discriminator's guards: mutations 6 and 16-19 red them.

If the collect case fails on its first assertion (`wave 7's collect act is on this branch`), STOP and report: Task 0 brought wave 7's tree (H1); no merge mid-wave. If an executor or release case fails on a missing `licenceGeneration` or `generation` property, Task 2 or Task 4 has not landed. STOP. If the sweep cases fail on `opts.exec`, `f.journal` or `f.advance`, Step 1a was not made, or Task 3's fixture has not landed. STOP.

- [ ] **Step 3: Implement**

**3a. The store read.** In `server/src/coord/store.ts`, directly above `export class CoordStore`:

```ts
/** The acts the birth read returns (spec §5.1's birth; spec §5.6, slugs recycle). `create` opens a generation,
 *  and `purge` is the one removal. Every removal of a row ends in ccd's `_reg_purge`, which journals `purge done`
 *  BEFORE it unlinks the row's files, and that line carries the row's `meas.uuid`. `collect` never purges: it
 *  removes the leftover temp root of a row that is already gone. So it is not here, by construction. The
 *  runtime list derives from the map. */
export type LifecycleBirthAct = Extract<LifecycleAct, 'create' | 'purge'>;
const LIFECYCLE_BIRTH_ACT: Readonly<Record<LifecycleBirthAct, true>> = { create: true, purge: true };
const LIFECYCLE_BIRTH_ACTS = Object.keys(LIFECYCLE_BIRTH_ACT) as LifecycleBirthAct[];
const isLifecycleBirthAct = (v: string): v is LifecycleBirthAct =>
  Object.prototype.hasOwnProperty.call(LIFECYCLE_BIRTH_ACT, v);

/** One row of the birth read: a `done` `create` or `done` `purge` of one session. `id` is the mirror's own row id
 *  (ingest order, never ccd's clock). `at` is ccd's clock. `uuid` is the line's `meas.uuid`, or null when the
 *  line carried none. */
export interface LifecycleBirthEvent {
  readonly id: number;
  readonly act: LifecycleBirthAct;
  readonly at: number | null;
  readonly uuid: string | null;
}
```

Directly after `lifecycleCreatesFor`'s closing brace:

```ts
  /** THE ONE SPELLING of `lifecycleBirthEventsFor`'s statement. It is public so that its test reads the text this
   *  method runs: the hint is present, and the plan seeks. `INDEXED BY lifecycle_by_session` is
   *  `childReclaimEventsSql`'s idiom: the table is never pruned, so this read costs one session's own history. */
  static readonly LIFECYCLE_BIRTH_EVENTS_SQL =
    'SELECT id, act, at, measJson FROM lifecycle_events INDEXED BY lifecycle_by_session ' +
    `WHERE sessionId = ? AND act IN (${placeholders(LIFECYCLE_BIRTH_ACTS.length)}) AND outcome = ? ` +
    'ORDER BY id ASC';

  /** The birth's rows for one session (spec §5.1, §5.6): every `done` `create` and every `done` `purge`, oldest
   *  first by the mirror's own `id`.
   *  - UNCAPPED, like `lifecycleCreatesFor` and for its reason: the opening create must stay findable for the
   *    life of the workspace.
   *  - A refused or intent row of either act is not returned. A refused ws-add minted nothing, and an intent
   *    without its done never completed.
   *  - It decides nothing. Which create opens the generation, and which purge follows it, is
   *    `childReclaimBornAt`'s decision.
   *  - It throws when the statement returns an act it never asked for. Every caller already reads a throw as
   *    unreadable. */
  lifecycleBirthEventsFor(sessionId: string): readonly LifecycleBirthEvent[] {
    const done: LifecycleOutcome = 'done';
    const rows = this.db.prepare(CoordStore.LIFECYCLE_BIRTH_EVENTS_SQL).all(sessionId, ...LIFECYCLE_BIRTH_ACTS, done) as
      { id: number; act: string; at: number | null; measJson: string | null }[];
    return rows.map((r) => {
      if (!isLifecycleBirthAct(r.act)) {
        throw new Error(`lifecycleBirthEventsFor: the statement returned act ${JSON.stringify(r.act)}, which it never asks for`);
      }
      return { id: r.id, act: r.act, at: r.at, uuid: reviveMeas(jsonOrNull(r.measJson))?.uuid ?? null };
    });
  }
```

Replace `lifecycleCreatesFor`'s docstring (the `/** One session's \`create\` rows ALONE …` block). Leave its body byte-identical:

```ts
  /** One session's `create` rows ALONE, oldest-first, UNCAPPED by `LIFECYCLE_PAGE_MAX` (child-reclamation wave 4,
   *  spec §5.9).
   *  - Why uncapped: a failing child's ordinary window (`lifecycleFor`, 500 rows) scrolls past its own opening
   *    `create` in days of retried refusals, and the attention list's generation needs that row for the LIFE
   *    of the workspace.
   *  - Its one caller is the sweep's attention rows (`childReclaimAttentionGenerationRows`), which merge it into
   *    the window. The birth reads `lifecycleBirthEventsFor` instead, which adds the `purge` rows (spec §5.1,
   *    §5.6).
   *  - Cost: bounded to one ACT. `lifecycle_by_session` is `(sessionId, id)`, so this still walks every row of
   *    the session (it filters `act` after the index narrows to the session), not a narrower index on `act`.
   *    The bound is on the SESSION, never the whole table.
   *  - It never answers the oldest `create`, which would skip every recycled slug (spec §5.6).
   *    `childReclaimGeneration` cuts "every create this session ever had" down to the CURRENT generation.
   *  - Same column set and same reviver as `lifecycleFor`: `reviveLifecycleRow` is the one definition both share. */
```

**3b. The placement.** In `server/src/coord/childReclaim.ts`, change the registry import to `import { readSessionRecord, type SessionRecord } from '../registry.js';`. Then replace `childReclaimBornAt` and `childReclaimHasCoordinated` (both functions and their docstrings) with:

```ts
/** The listed row's current `.uuid`, as the birth's own-purge test reads it (spec §5.1, §5.6). It is the measured
 *  value, or null when this read could not measure the uuid. A caller with no row at all passes null too.
 *  Both nulls are handled ONE way: every `purge` counts, which is the doubt direction. Only the uuid's own doubt
 *  matters here. Another identity field's does not. */
export function childReclaimRowUuid(rec: Pick<SessionRecord, 'uuid' | 'unmeasured'>): string | null {
  return rec.unmeasured.includes('uuid') ? null : rec.uuid;
}

/** The birth (spec §5.1): the opening `create` of the session's CURRENT generation, on ccd's clock, or null when
 *  it cannot be placed. It is the one placement shared by the birth fence, the coordination fence and the sweep
 *  entry's `bornAt`.
 *
 *  THE OPENING CREATE is the placed `done` create (`at !== null`, `at <= nowMs`) with the highest mirror id. That
 *  is the create `childReclaimGeneration` opens the generation at, over the same creates.
 *
 *  A REMOVAL UNPLACES IT (spec §5.6: slugs recycle). A recycled slug's new `create` can be missing from the mirror
 *  while its row and marker are already listed: it is not ingested yet, or its `at` is ahead of this server's
 *  clock. The older generation's create would then stand in for the birth. So the answer is null (doubt) when a
 *  `purge` FOLLOWS the opening create, which means all three of these hold:
 *  - its mirror id is higher. The id orders, never `at`.
 *  - ccd's own clock does not place it first: NOT (`purge.at !== null && purge.at < create.at`). A purge with a
 *    null `at` counts, because doubt is the safe direction. ccd always stamps `at`, so only a hand-written or
 *    foreign line reaches that arm.
 *  - it is not the row's OWN purge. ccd journals `purge done` BEFORE it unlinks the row, so a purge that died
 *    mid-way, or one that stopped at rc 3, leaves this same generation's row listed with its own purge after its
 *    own create. A purge whose `uuid` equals `rowUuid` leaves the birth placed: the sweep asks again, and ccd
 *    resumes from its breadcrumb. A purge with no `uuid` counts, and so does every purge when `rowUuid` is null.
 *
 *  DOWNSTREAM, A STATED RESIDUAL. An unplaced birth makes any earlier numeric coordinator claim read
 *  "coordinated" (`childReclaimCoordinated` keeps a child whose birth is null).
 *  - The sweep never shows it, because its `child-birth-unplaced` check comes first.
 *  - The executor's step 2a defers `siblings-open`, close declines `has-coordinated`, and the release job answers
 *    `changed`.
 *  Each of the three is the safe direction, and each ends once the new create is placed. */
export function childReclaimBornAt(
  coord: Pick<CoordStore, 'lifecycleBirthEventsFor'>, sessionId: string, nowMs: number, rowUuid: string | null,
): number | null {
  const events = coord.lifecycleBirthEventsFor(sessionId);
  let openId = Number.NEGATIVE_INFINITY;
  let openAt: number | null = null;
  for (const e of events) {
    if (e.act === 'create' && e.at !== null && e.at <= nowMs && e.id > openId) { openId = e.id; openAt = e.at; }
  }
  if (openAt === null) return null;
  const createAt = openAt;
  for (const e of events) {
    if (e.act !== 'purge' || e.id <= openId) continue;
    if (e.at !== null && e.at < createAt) continue;        // ccd's own clock places it before the create
    if (rowUuid !== null && e.uuid === rowUuid) continue;   // the row's own unfinished purge
    return null;
  }
  return createAt;
}
/** THE reader for one session (spec §1 rule 4). Throws when a store read throws; each caller keeps its own
 *  unreadable answer. `rowUuid` is the uuid of the row the caller read (`childReclaimRowUuid`), passed through to
 *  the birth. */
export function childReclaimHasCoordinated(
  coord: Pick<CoordStore, 'childReclaimCoordinatorClaims' | 'lifecycleBirthEventsFor'>, sessionId: string,
  nowMs: number, rowUuid: string | null,
): boolean {
  return childReclaimCoordinated(coord.childReclaimCoordinatorClaims().get(sessionId),
    () => childReclaimBornAt(coord, sessionId, nowMs, rowUuid), CHILD_BIRTH_SKEW_MS);
}
```

In `childReclaimGeneration`'s docstring, replace the clause `the birth fence calls it over \`lifecycleCreatesFor\` alone, so its single-row answer is the opening \`create\` itself;` with `the birth (\`childReclaimBornAt\`) opens at the same create over the birth read's rows, and \`child-reclaim-birth-removal.test.ts\` holds the two equal;`.

**3c. The executor's step 2a and the release job's step 5.** `read` is narrowed to `found` at both sites: step 1 returned on every other arm. Replace each of the two occurrences of

```ts
    if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)())) {
```
```ts
    if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)())) return 'changed';
```

with, respectively:

```ts
    if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)(), childReclaimRowUuid(read.record))) {
```
```ts
    if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)(), childReclaimRowUuid(read.record))) return 'changed';
```

**3d. Close.** In `server/src/coord/close.ts`, add `childReclaimRowUuid` to the `./childReclaim.js` import. Then replace `hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now());` with:

```ts
    // The birth is told the row this mark read read (spec §5.6): its own unfinished purge never unplaces it.
    // An unplaced birth with an earlier claim declines `has-coordinated` here. That is fail-safe: the sweep
    // judges the child again on its next pass.
    hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now(), read.found ? childReclaimRowUuid(read.record) : null);
```

**3e. The sweep.** In `server/src/watch.ts`, add `childReclaimRowUuid` to the `./coord/childReclaim.js` import. Replace `childBornAt = childReclaimBornAt(coord, r.id, now);` with `childBornAt = childReclaimBornAt(coord, r.id, now, childReclaimRowUuid(r));`. In the comment above it, replace the span from `The child's own birth is the OPENING` to `all read.` with:

```ts
          // minted this workspace with. The child's own birth is the OPENING
          // `create` of its current generation, unless a `purge` that is not
          // this row's own follows it (spec §5.1, §5.6). It is read uncapped
          // by `lifecycleBirthEventsFor`, so a failing child's `create` is
          // findable for the life of the workspace. It is placed through
          // `childReclaimBornAt`, the ONE placement that this fence, the
          // coordination fence and the entry's own `bornAt` all read, and it
          // is told this row's uuid.
```

Keep the line before it that ends `…never actually` unchanged, so that the sentence still joins. In `childReclaimAttentionGenerationRows`' docstring, replace the final sentence `The birth fence (above, in the per-child loop) does NOT use this — it reads \`lifecycleCreatesFor\` alone, where a single-row generation IS the opening create, and merging in window rows would only cost a query.` with `The birth (above, in the per-child loop) does NOT use this: it reads \`lifecycleBirthEventsFor\` through \`childReclaimBornAt\`.`

**3f. The tests the change touches.**
- **The placement pin, rewritten deliberately.** In `server/test/child-reclaim-generation.test.ts`, replace from `const placement = 'childReclaimGeneration(coord.lifecycleCreatesFor';` through `expect(count(watchTs, 'childReclaimBornAt(coord, r.id, now)'), 'the sweep places the birth through the helper').toBe(1);` with:

```ts
    // The birth's ONE placement (spec §5.1, §5.6) works as follows. `childReclaimBornAt` alone reads the birth
    // rows. The create-only read keeps its one other caller, the attention list. Each of the four consumers
    // hands the placement the uuid of the row it read.
    const placement = 'coord.lifecycleBirthEventsFor(';
    expect(src.map(([f, t]) => [f, count(t, placement)] as const).filter(([, n]) => n > 0), 'one birth placement')
      .toEqual([['server/src/coord/childReclaim.ts', 1]]);
    const childReclaimTs = src.find(([f]) => f === 'server/src/coord/childReclaim.ts')![1];
    const bornAtBody = /export function childReclaimBornAt\([^]*?\n}\n/.exec(childReclaimTs)?.[0] ?? '';
    expect(bornAtBody, 'the placement lives inside childReclaimBornAt').toContain(placement);
    expect(holders('coord.lifecycleCreatesFor('), 'the create-only read serves the attention list alone')
      .toEqual(['server/src/watch.ts']);
    const watchTs = src.find(([f]) => f === 'server/src/watch.ts')![1];
    expect(count(watchTs, 'childReclaimBornAt(coord, r.id, now, childReclaimRowUuid(r))'),
      'the sweep places the birth through the helper, with its row\'s uuid').toBe(1);
    expect(count(childReclaimTs,
      'childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)(), childReclaimRowUuid(read.record))'),
      'step 2a and the release job\'s step 5 each pass the row they read').toBe(2);
    const closeTs = src.find(([f]) => f === 'server/src/coord/close.ts')![1];
    expect(count(closeTs, 'childReclaimHasCoordinated(deps.coord, sessionId, Date.now(), '
      + 'read.found ? childReclaimRowUuid(read.record) : null)'), 'close passes the row its mark read read').toBe(1);
```

  In the same file, change the comment in "the birth fence's own use" case from `` // `childReclaimBornAt` reads `childReclaimGeneration(coord.lifecycleCreatesFor(id), now)[0]?.at` `` to `` // `childReclaimBornAt` opens at this same create over the birth read's rows (child-reclaim-birth-removal.test.ts holds the two equal) ``. Then rename that case `'over a CREATE-ONLY list, [0] IS the opening create'`.
- **K5d, re-aimed.** In `server/test/child-reclaim-close.test.ts`, K5d becomes `'K5d: a session that never coordinated never reads the mirror for this question — a throwing birth read still queues'`, and its stub becomes `b.coord.lifecycleBirthEventsFor = () => { throw new Error('the mirror is unreadable'); };`.
- **The two direct calls.** In `server/test/child-reclaim-sweep.test.ts`:
  - `childReclaimBornAt(f.coord, 'demo-a', f.now())` becomes `childReclaimBornAt(f.coord, 'demo-a', f.now(), 'u-demo-a-2')`. That is L18's planted uuid.
  - `childReclaimHasCoordinated(f.coord, 'demo-a', f.now())` becomes `childReclaimHasCoordinated(f.coord, 'demo-a', f.now(), 'u-demo-a')`, the fixture's `plant` default.

**3g. `child-birth-unplaced` says both of its causes (the coordinator's ruling on Task 5).** A purge that follows the opening create now unplaces a birth whose create IS dated, so "holds no dated creation" alone is false for it. In `server/src/childReclaimSweep.ts`, replace the `'child-birth-unplaced'` row of `CHILD_RECLAIM_SKIP` with:

```ts
  'child-birth-unplaced': { class: 'doubt', sentence:
    'The lifecycle journal holds no dated creation of this workspace, or a removal journaled after its creation '
    + 'that ccrc has not yet seen replaced by a newer creation, so nothing proves the run its child marker names made it. '
    + 'The sweep leaves it alone and looks again on its next pass.' },
```

It stays doubt, it still ends `on its next pass.`, and it has no straight apostrophe; the policy file pins all three. In the class note's `doubt` bullet, replace

```ts
 *    (`child-birth-unplaced`: the mirror holds no dated creation of the workspace), so the sweep
```

with

```ts
 *    (`child-birth-unplaced`: the mirror holds no dated creation of the workspace, or a removal
 *    journaled after its creation that no newer creation has replaced yet), so the sweep
```

In `server/test/child-reclaim-sweep-policy.test.ts`, replace the case `child-birth-unplaced is doubt: its sentence says what could not be placed and that the sweep looks again` and the four comment lines above it (from `// An unplaced birth is doubt, not kept:`) with:

```ts
  // An unplaced birth is doubt, not kept: the lane places the birth afresh on every judging pass, so the
  // word ends once the mirror holds a dated `create` for the workspace that no purge but the row's own
  // follows, with no person acting. Its sentence names both causes (no dated creation, or a removal after
  // it not yet replaced) and says the sweep looks again; it never says ccrc leaves the child for a person.
  it('child-birth-unplaced is doubt: its sentence says what could not be placed and that the sweep looks again', () => {
    expect(CHILD_RECLAIM_SKIP['child-birth-unplaced'].class).toBe('doubt');
    expect(isChildReclaimKeptWord('child-birth-unplaced')).toBe(false);
    expect(sentenceOf('child-birth-unplaced')).toBe(
      'The lifecycle journal holds no dated creation of this workspace, or a removal journaled after its creation '
      + 'that ccrc has not yet seen replaced by a newer creation, so nothing proves the run its child marker names made it. '
      + 'The sweep leaves it alone and looks again on its next pass.');
  });
```

Every other reader takes the sentence through `CHILD_RECLAIM_SKIP` (`child-reclaim-sweep.test.ts`'s chip case, `child-reclaim-status.test.ts`), so none changes. The spec's copy of the old sentence (`docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, `grep -n "holds no dated creation of its workspace"`) is Task 10's, together with the lost-create residual.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-birth-removal.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-generation.test.ts test/child-reclaim-close.test.ts \
  test/child-reclaim-sweep.test.ts test/child-reclaim.test.ts test/child-reclaim-paused-at-server.test.ts \
  test/child-reclaim-sweep-policy.test.ts test/child-reclaim-events-store.test.ts test/child-reclaim-status.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-licence-executor.test.ts test/child-reclaim-licence-lane.test.ts \
  test/child-reclaim-hold-retired-generation.test.ts   # the shared fixture's other consumers (H7): its counter moved
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: all green. The new file shows 31 of 31. Run each in the foreground, with a timeout of 600000 ms. `typecheck-tests` is on the known-flake list: on a red, re-run it in isolation before reading it as a break.

- [ ] **Step 5: Mutation table**

Make each mutation alone, run the named case, see the expected red, and revert it. F is `cd server && ./node_modules/.bin/vitest run test/child-reclaim-birth-removal.test.ts`.

| # | Mutation | Run | Expected red |
|---|---|---|---|
| 1 | In `childReclaimBornAt`, delete the second `for` loop, so purges are never read | F | `a purge of ANOTHER uuid…`, `a purge with no meas.uuid counts`, `…at the create's own instant…`, `…a null at…`, `the recycled-slug window…`: `expected 1790000000000 to be null`. The four "another uuid" consumer cases red as they did in Step 2. |
| 2 | `e.id <= openId` becomes `false`, so the id test is dropped | F `-t "earlier generation"` | `expected null to be 1790000000005` |
| 3 | Delete the line `if (e.at !== null && e.at < createAt) continue;` | F `-t "clock places before"` | `expected null to be 1790000000010` |
| 4 | `e.at < createAt` becomes `e.at <= createAt` | F `-t "own instant"` | `expected 1790000000000 to be null` |
| 5 | `e.at !== null && e.at < createAt` becomes `(e.at === null \|\| e.at < createAt)`, so a null `at` is skipped | F `-t "null at follows"` | `expected 1790000000000 to be null` |
| 6 | Delete the line `if (rowUuid !== null && e.uuid === rowUuid) continue;` | F | `the row's OWN purge never unplaces it`: `expected null to be 1790000000000`. Each consumer's "own purge" case also reds: the sweep `expected { eligible: false, why: 'child-birth-unplaced' } to match object { eligible: true, … }`, the executor `why: 'siblings-open'`, the release job `expected 'changed' to be 'released'`, and close `childReclaim: 'not-queued'`. |
| 7 | `rowUuid !== null && e.uuid === rowUuid` becomes `e.uuid === rowUuid` | F `-t "never \"the same\""` | `expected 1790000000000 to be null` |
| 8 | `e.uuid === rowUuid` becomes `(e.uuid === null \|\| e.uuid === rowUuid)` | F `-t "no meas.uuid counts"` | `expected 1790000000000 to be null` |
| 9 | `e.id > openId` becomes `openAt === null`, so the FIRST placed create wins | F `-t "earlier generation\|one placement"` | `expected null to be 1790000000005`; then the equivalence diff for `[c(1,T0),c(2,T0+10)]` |
| 10 | Delete `&& e.id > openId`, so the LAST create in array order wins | F `-t "array order"` | `expected null to be 1790000000010` |
| 11 | Delete `e.at <= nowMs &&` | F `-t "ahead of the server clock\|recycled-slug window"` | `expected 1790060000001 to be null`; then `expected 1790000000000 to be null` |
| 12 | In `LIFECYCLE_BIRTH_EVENTS_SQL`, delete ` AND outcome = ?`, and delete `done` from `.all(…)` | F `-t "done create and purge rows"` | a `toEqual` diff: `{ act: 'create', at: 1790000000000, … }` and the refused purge are received in addition |
| 13 | Replace `act IN (${placeholders(LIFECYCLE_BIRTH_ACTS.length)})` with `act IS NOT NULL`, and delete `...LIFECYCLE_BIRTH_ACTS` from `.all(…)` | F `-t "done create and purge rows\|collect is excluded"` | `Error: lifecycleBirthEventsFor: the statement returned act "reclaim", which it never asks for`; then `… act "collect" …` |
| 14 | `ORDER BY id ASC` becomes `ORDER BY id DESC` | F `-t "done create and purge rows"` | a `toEqual` diff with the three rows reversed |
| 15 | `uuid: reviveMeas(jsonOrNull(r.measJson))?.uuid ?? null` becomes `uuid: null` | F `-t "done create and purge rows\|own purge"` | `expected null to be 'u-demo-a'` (the uuid field); then the four consumer "own purge" cases, as in row 6 |
| 16 | Delete `INDEXED BY lifecycle_by_session ` from the statement | F `-t "seeks through"` | `expected 'SELECT id, act, at, measJson FROM lif…' to contain 'INDEXED BY lifecycle_by_session'` |
| 17 | In watch.ts, `childReclaimRowUuid(r)` becomes `null` | F `-t "the sweep: the row's own purge"`; then `test/child-reclaim-generation.test.ts -t K8` | `expected { eligible: false, why: 'child-birth-unplaced' } to match object { eligible: true, … }`; then K8 `the sweep places the birth through the helper, with its row's uuid: expected 0 to be 1` |
| 18 | In the executor's step 2a only, `childReclaimRowUuid(read.record)` becomes `null` | F `-t "the executor: the row's own purge"`; then K8 | `why: 'siblings-open'` received where `'paused-at-server'` was expected; then K8 `expected 1 to be 2` |
| 19 | In the release job's step 5 only, `childReclaimRowUuid(read.record)` becomes `null` | F `-t "the release job: the row's own purge"`; then K8 | `expected 'changed' to be 'released'`; then K8 `expected 1 to be 2` |
| 20 | In close, `read.found ? childReclaimRowUuid(read.record) : null` becomes `null` | F `-t "close: the row's own purge"`; then K8 | `childReclaim: 'not-queued'` received where `'queued'` was expected; then K8 `close passes the row its mark read read: expected 0 to be 1` |
| 21 | `childReclaimRowUuid` returns `rec.uuid` unconditionally | F `-t childReclaimRowUuid` | `expected '' to be null` |
| 22 | In `childReclaimHasCoordinated`, the birth is read eagerly: `const born = childReclaimBornAt(coord, sessionId, nowMs, rowUuid);` before the return, and `() => born` passed | `test/child-reclaim-close.test.ts -t K5d` | `expected { …, childReclaim: 'not-queued', childReclaimWhy: 'siblings-unreadable' } to match object { ok: true, childReclaim: 'queued' }`. This proves K5d's re-aimed stub is live, and was not vacuous. |
| 23 | In `childReclaimBornAt`, `coord.lifecycleBirthEventsFor(sessionId)` is replaced by a filter of a second read, `coord.lifecycleCreatesFor(sessionId)`, mapped to the same shape | `test/child-reclaim-generation.test.ts -t K8` | `the create-only read serves the attention list alone`: a `toEqual` diff naming `server/src/coord/childReclaim.ts` |
| 24 | In `childReclaimSweep.ts`, restore today's `child-birth-unplaced` sentence (`…holds no dated creation of this workspace, so nothing proves… looks for that creation again on its next pass.`) | F `-t "both of its causes"`; then `test/child-reclaim-sweep-policy.test.ts -t "child-birth-unplaced is doubt"` | `expected 'The lifecycle journal holds no dated creation of this workspace, so…' to contain 'holds no dated creation of this workspace, or a removal journaled after its creation'`; then the policy pin's `toBe` diff |

No mutation reds the `lifecycleCreatesFor is unchanged` case, because it guards a body this task does not edit. Its red is any edit to that body.

Revert every mutation and re-run Step 4 green.

- [ ] **Step 6: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: no output. The test files are compiled by `typecheck-tests.test.ts` (Step 4).

- [ ] **Step 7: Commit**

This task inserts nothing into `shared/api.ts`, so no README anchor moves and claim 1110 is not touched.

```bash
git add server/src/coord/store.ts server/src/coord/childReclaim.ts server/src/coord/close.ts server/src/watch.ts \
  server/src/childReclaimSweep.ts server/test/childReclaimGenerationFixture.ts \
  server/test/child-reclaim-birth-removal.test.ts server/test/child-reclaim-generation.test.ts \
  server/test/child-reclaim-close.test.ts server/test/child-reclaim-sweep.test.ts \
  server/test/child-reclaim-sweep-policy.test.ts
git commit -m "$(cat <<'MSG'
fix(reclaim): a later purge unplaces the birth, unless it is the row's own

childReclaimBornAt reads a new store read, lifecycleBirthEventsFor: the
done create and done purge rows of one session, in mirror id order, each
purge with its meas.uuid. The birth becomes unplaced (doubt) when a purge
follows the opening create. It follows when its mirror id is higher, ccd's
own clock does not place it first, and its uuid is not the listed row's
current uuid. The row's own unfinished purge leaves the birth placed, so
the sweep asks again and ccd resumes from its breadcrumb. collect never
purges and is not read. lifecycleCreatesFor keeps the attention list as
its one caller, unchanged.

The four consumers pass the uuid of the row each one read: the sweep, the
executor's step 2a, close and the hold-release job's step 5. An unplaced
birth with an earlier claim reads coordinated at the last three. Each of
them declines in the safe direction, and each is pinned. The sweep shows
child-birth-unplaced first.

child-birth-unplaced's sentence now names both of its causes: no dated
creation, or a removal journaled after the creation that ccrc has not
yet seen replaced. A recycled slug whose new create line was lost reads
that doubt until a later create is mirrored; Task 10's docs state it.

The sweep's case runs on the one shared lane fixture, which gains an
exec stub, journal and advance, additively.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: R76's failed readers — the crumb reader, `stuck` and `purge-incomplete` in the verb parse, the exit-1 audit arm, and one exhaustive feed tail

**Model routing:** **`opus`, effort `high`**. This task is SAFETY-bearing. The audit arm decides what an exit-1 `ws-audit --reclaim` document can answer, and the rule that no exit-1 token is ever spent must stay mechanical (R73(e), R76). Everything else in this task changes a feed sentence or a failure's word, never an act.

**Why:** Contract §15 R76 rules four readers of wave 7's ccd fields. R77 adds its parse half and R79 its inheritances. All four readers are in `server/src/coord/childReclaim.ts`:
- **The verb's failed arm reads the WORD first, then `crumb`.**
  - **Today.** `parseChildReclaimResult` (childReclaim.ts:732 at `226bb881c`; `grep -n 'export function parseChildReclaimResult' server/src/coord/childReclaim.ts`) decides `resume` from the word alone (:775, `grep -n "isChildReclaimPreCrumbFailed(v.failed) ? 'not-resumable' : 'resumable'"`).
  - **What wave 7 prints** (plan Task 2 Part A):
    - `"crumb":false` on ws-reclaim's fresh arm, before its breadcrumb;
    - `true` on a resumed arm, and everywhere in the shared tail, for both verbs;
    - NO key over an unreadable breadcrumb, from every older ccd, and on ws-expire's pre-breadcrumb documents.

    `true` means "printed past the act's breadcrumb: the act had started". It never means "a breadcrumb stands now" (R79, T2 OPEN4). Wave 7 Task 1 prints `containment-refuted` from the tail, so that word always comes with `"crumb":true`.
  - **The order R76 rules:**
    - `containment-refuted` is `stuck`, whatever `crumb` says;
    - `purge-incomplete` gets its own feed tail;
    - otherwise `crumb === false` → `not-resumable` and `crumb === true` → `resumable`;
    - an absent or non-boolean `crumb` falls back to `CHILD_RECLAIM_PRE_CRUMB_FAILED` (:310).
  - **What this closes.** On any ccd that prints `crumb`, both word-only residuals of "§12 as built" close: a pre-breadcrumb `pin-failed` or `tombstone-unwritable` reading `resumable`, and a resumed arm's `probe-unmeasured` reading `not-resumable`.
- **`ChildReclaimResume` gains exactly one value, `'stuck'`** (R76, R77).
  - **Its one consumer today** is `childReclaimFeedBody`'s two-level ternary (:1333-1346, `grep -n "o.resume === 'resumable' ? 'It is retried; the box resumes where it stopped.'"`). Its default is "It is retried from the start.", so a new value would fall through silently.
  - **It becomes ONE exhaustive decision** with a `never` guard, word first. For `purge-incomplete` it says the reclaim completed and the row was purged, that what still stands is named (in ccd's detail, rendered just before it), and that the sweep asks again if the row's own files still stand. That tail is CONDITIONAL (the coordinator's ruling on T6 OPEN5): it never says that nothing retries it, and never that the box resumes.
  - **That sentence was wrong before wave 8 too.** `purge-incomplete` (ccd/ccd:30076-30080 at `226bb881c`) prints `crumb:true` after `_reg_purge` purged the row, and today it reads "the box resumes where it stopped" (attack.json, R76 verdict 3).
- **The audit's exit-1 arm.**
  - **Today.** `childReclaimAudit` (:1036-1042) answers `unreadable` on ANY `!res.ok`, before reading a byte of stdout (`` grep -n "if (!res.ok) return { kind: 'unreadable', detail: `ws-audit --reclaim failed:" ``). The executor then answers `failed`, `not-resumable`, `token: null` (:931-933).
  - **What ccd prints.** The audit (ccd/ccd:13162-13172 at `226bb881c`, `grep -n '"resume":%s,' ccd/ccd`) prints `"resume":<phase>` whenever it read a `reclaim:` breadcrumb, for every verdict. On `unmeasured` it prints the document, journals `failed probe-unmeasured verb ws-audit`, and exits 1.
  - **What R76 rules:**
    - apply the identity rules: a JSON object, `id === sessionId`, `mode === 'reclaim'`;
    - accept ONLY `verdict === 'unmeasured'`;
    - answer `failed` with the token `probe-unmeasured`, the word ccd journaled for that same audit, so that `childReclaimFeedSkips` and R78's tier see it (R79);
    - read it as resumable exactly when a non-empty string `resume` is present;
    - every other exit-1 shape stays `unreadable`, with a null token.
  - **Never a token-bearing kind.** The arm cannot return one, so R73(e)'s "no exit-1 audit token is ever spent" stays mechanical. Two things hold it: the reader's RETURN TYPE (attack.json newQuestion 4), and a test case.
- **Review 346's F4.** Five comments still state the old rule (preflight.json item (5): childReclaim.ts:238-262, :273-311, :759-774, :1029-1035, :1335-1346). They are rewritten to the new behaviour in the commit that changes it.

**What lands here and what does not:**
- **The `stuck` reading is this task's alone (ruling H3).** In ONE commit this task adds `'stuck'` to `ChildReclaimResume`, declares `CHILD_RECLAIM_STUCK_TOKENS`, `ChildReclaimStuckToken` and `isChildReclaimStuckToken`, writes the parse arm and the kebab admission of `containment-refuted` and `purge-incomplete`, and flips wave 7's one parser pin. Tasks 8 and 9 import and consume these, and never declare, parse, admit or flip them again.
- **R77's pin flip lands HERE, not in Task 8.** R77 requires it "in the same commit" as the parse change, and this task's parse change reds it. Only the `parseChildReclaimResult` assertion in `containment-refuted-word.test.ts` flips. The two titles over it that still say "resumable" and "today's parsers" (its `it` and its describe) are retitled in the same commit (H3). Its `parseExpireResult` assertion is workspace-lifecycle's and is left as found.
- **Review 341's F9 re-aim stays Task 8's.** That is the direct `isChildReclaimKebab('containment-refuted')` pin. This task only ADMITS the word. It has to: the kebab scanner (`mail-routes.test.ts`, "every quoted kebab token in server/src/coord …") reds on any new quoted kebab literal in `server/src/coord` that no guard admits.
- **Until Tasks 8 and 9 land in this same PR,** a `stuck` child is listed and retried exactly as a failing one is today. This task changes only its word and its feed sentence. The stuck tail's "long backoff" becomes true once Task 9 lands in this same PR (T6 OPEN6, accepted).
- **Accepted departures** (the coordinator's rulings; each is numbered at the fix round): `failed-tail-extracted-as-export` and `purge-incomplete-resume-read-by-crumb`.

**Files:**
- Modify: `server/src/coord/childReclaim.ts`. Ten edits, each located by its quoted text. Line numbers are hints at `226bb881c`; Tasks 2, 3 and 5 move them.
  1. Replace from `` /** Replaces a `resumable: boolean` + `preLockDie: boolean` pair (review 170 `` (:234) through the closing `}` of `function isChildReclaimPreCrumbFailed` (:313-315), whole.
  2. `isChildReclaimKebab` (:576-580): one guard line, and one sentence in its docstring.
  3. Directly after the last arm of `export type ChildReclaimAuditRead =` (:598, `| { readonly kind: 'unreadable'; readonly detail: string };`): two new types.
  4. Directly above `` /** The exact stderr shape ccd's own `die` calls print for the SIX single-line `` (:638): the new parser.
  5. The `resume` docstring line in `ChildReclaimVerbRead` (:722, `three-way since fr-I m1 — see`).
  6. The failed arm of `parseChildReclaimResult`: from the comment `` // A word in `CHILD_RECLAIM_PRE_CRUMB_FAILED` `` (:759) through `const resume: ChildReclaimResume = isChildReclaimPreCrumbFailed(v.failed) ? 'not-resumable' : 'resumable';` (:775).
  7. The executor's step 5: directly after the `if (audit.kind === 'unreadable') { … }` block under `const audit = await childReclaimAudit(deps, req);` (:930-933).
  8. The docstring and body of `childReclaimAudit` (:1029-1042). If Task 3 changed this function (its return type or a generation read), keep Task 3's change and add only the `!res.ok` line and the widened return type.
  9. Directly above `function childReclaimFeedBody(` (:1309): `childReclaimFailedTail`.
  10. The `case 'failed': { … }` block of `childReclaimFeedBody` (:1318-1348), from `` // `resume` says what to promise the reader `` to the block's closing `}`.
- Modify: `server/test/containment-refuted-word.test.ts` (wave 7's, on this branch since Task 0, H1). ONE assertion flips (H3), and the two titles over it are retitled: its describe `'today’s parsers read it as a resumable failure — retried'` and its `it`: `'parseChildReclaimResult: failed, resumable, with its token'` (`grep -n "parseChildReclaimResult: failed, resumable, with its token" server/test/containment-refuted-word.test.ts`).
- Test (new, R56): `server/test/child-reclaim-failed-arm.test.ts`.
- NOT edited:
  - `shared/api.ts`, `server/src/childReclaimSweep.ts`, `server/src/watch.ts`, `README.md` and `single-definition.test.ts`;
  - `child-reclaim-pre-crumb.test.ts`. Its cases are the absent-crumb fallback and stay green. Its line 61 is Task 8's F9;
  - `child-reclaim.test.ts`. Its exit-1 case at :932-944 (`grep -n "an audit that EXITS 1 is failed whatever it printed"`) asserts `toMatchObject({ kind: 'failed', resume: 'not-resumable' })` and that the verb was never called. Both stay true: its `unmeasured` document names no `resume`, and its token document is unreadable.

**Interfaces:**
- Consumes:
  - From wave 7, whose tree Task 0 brought onto this branch (H1; Step 0 checks it):
    - the `'containment-refuted'` member of `LcRefusalToken` (`shared/api.ts`);
    - `server/test/containment-refuted-word.test.ts`;
    - ccd's `"crumb":true|false` key on `{failed:…}` documents (wave 7 plan Task 2 Part A).
  - From Task 2: `ChildReclaimRequest.licenceGeneration: ChildReclaimGenerationKey | { readonly kind: 'none' }`, a REQUIRED field, and close's `CHILD_RECLAIM_LICENCE_NONE` (`{ kind: 'none' }`, ruling H4). This task's rig spells `licenceGeneration: { kind: 'none' }` on a `close` request.
  - From Task 3: what `none` means (it skips step 2c's re-read and is never compared at step 5a), and the audit document's `generation` (`ChildReclaimAuditGeneration`; a token document with no `generation` key reads `unprinted`, which gates nothing under `none`). Edit 7 sits above Task 3's step 5a. Task 3 must have landed (Step 0).
  - At `226bb881c`: `parseChildReclaimAudit(sessionId, stdout): ChildReclaimAuditRead` (:608), `isRecord` (:584), `childReclaimFeedSkips` (:1354), `CHILD_RECLAIM_FEED_QUIET_NONE` (:355), `childReclaimTokenKind` (:102), and `isLcRefusalToken` (`shared/api.ts`).
- Produces (all in `server/src/coord/childReclaim.ts`):
  ```ts
  export type ChildReclaimResume = 'resumable' | 'not-resumable' | 'pre-lock-die' | 'stuck';
  export const CHILD_RECLAIM_PROBE_UNMEASURED: 'probe-unmeasured';           // satisfies LcRefusalToken
  export const CHILD_RECLAIM_STUCK_TOKENS: readonly ['containment-refuted']; // satisfies readonly LcRefusalToken[]
  export type ChildReclaimStuckToken = typeof CHILD_RECLAIM_STUCK_TOKENS[number];
  export function isChildReclaimStuckToken(v: unknown): v is ChildReclaimStuckToken;
  export const CHILD_RECLAIM_PURGE_INCOMPLETE: 'purge-incomplete';           // satisfies LcRefusalToken
  export type ChildReclaimAuditUnmeasured = {
    readonly kind: 'unmeasured'; readonly resume: 'resumable' | 'not-resumable'; readonly detail: string };
  export type ChildReclaimAuditFailedRead =
    ChildReclaimAuditUnmeasured | Extract<ChildReclaimAuditRead, { kind: 'unreadable' }>;
  export function parseChildReclaimAuditFailed(sessionId: string, stdout: string, stderr: string): ChildReclaimAuditFailedRead;
  export function childReclaimFailedTail(o: { readonly resume: ChildReclaimResume; readonly token: string | null }): string;
  ```
  - Behaviour:
    - the failed arm of `parseChildReclaimResult` answers `resume: 'stuck'` for a `CHILD_RECLAIM_STUCK_TOKENS` word, whatever `crumb` says;
    - the executor answers an exit-1 `unmeasured` audit with `{ kind: 'failed', resume, detail, token: 'probe-unmeasured' }`.
  - For Task 8:
    - import `isChildReclaimStuckToken` and the rest from here; never declare, parse, admit or flip them again (H3). The stuck class is `isChildReclaimStuckToken` on a journal row's `refusal`, and on a `failed` outcome's `token`: Task 9's `childReclaimSweepOutcomeOf` derives `stuck` from the token, and the parser's `resume === 'stuck'` agrees with it (Task 9 pins that). Never re-spell the word;
    - the F9 re-aim pins `isChildReclaimKebab('containment-refuted')`, which this task makes true;
    - this task writes the stuck tail as a literal in `childReclaimFailedTail`'s `case 'stuck':`. Task 8's commit re-points that case to its L1 `CHILD_RECLAIM_STUCK_RETRY` (identical bytes, no prefix), so this task's exact-text pins stay green unchanged.
  - For Task 9: an exit-1 `unmeasured` audit's outcome now carries a non-null token, so it can count toward R78's same-token entry. Task 9 uses this task's names (`isChildReclaimStuckToken`, `CHILD_RECLAIM_PROBE_UNMEASURED`) and declares no fallback guard of its own (H3).

- [ ] **Step 0: Entry check — wave 7's word, Task 2's request field and Task 3's audit arms are on this branch**

```bash
grep -n "  | 'containment-refuted'" shared/api.ts
ls server/test/containment-refuted-word.test.ts
grep -n 'licenceGeneration' server/src/coord/childReclaim.ts | head -3
grep -n 'export type ChildReclaimAuditGeneration' server/src/coord/childReclaim.ts
```
Expected: one `LcRefusalToken` member line, the file listed, at least one hit, and one line.
- **If either of the first two is empty,** STOP and report: Task 0 brought wave 7's tree (H1); no merge mid-wave. `CHILD_RECLAIM_STUCK_TOKENS` does not compile without that member.
- **If the third is empty,** Task 2 has not landed; STOP and report.
- **If the fourth is empty,** Task 3 has not landed; STOP and report. Task 3 is still a prerequisite because of its audit arms: Edit 7 sits above its step 5a, and this task's token audits print no `generation` key, which Task 3 reads as `unprinted`.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-failed-arm.test.ts`:

```ts
// Child reclamation wave 8 — what a FAILED attempt promises about the next one
// (spec §5.6, §5.9, §7 item 6). Three readers change together:
//   - `parseChildReclaimResult`'s failed arm reads the WORD first, then wave 7's
//     additive `crumb`: `containment-refuted` is `stuck` whatever `crumb` says;
//     otherwise `crumb:false` is not-resumable and `crumb:true` is resumable
//     (the act had started); a key that is absent or not a boolean falls back
//     to the pre-crumb word set;
//   - `childReclaimAudit` reads an exit-1 document for ONE thing, the audit's
//     own `unmeasured` answer and whether it names a breadcrumb phase, and can
//     never answer a token;
//   - the feed's failed tail is one exhaustive decision, word first:
//     `purge-incomplete` has its own sentence, and so does `stuck`.
// The runner is `testDeps`', so every argv the executor composes crosses the
// agent's real exec whitelist first. Fixture HOME only (`mkTmp`).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_PROBE_UNMEASURED, CHILD_RECLAIM_PURGE_INCOMPLETE,
  CHILD_RECLAIM_STUCK_TOKENS, childReclaimFailedTail, childReclaimTokenKind, isChildReclaimResume,
  isChildReclaimStuckToken, parseChildReclaimAuditFailed, parseChildReclaimResult, reclaimChild,
  type ChildReclaimAuditFailedRead, type ChildReclaimDeps, type ChildReclaimRequest, type ChildReclaimResume,
} from '../src/coord/childReclaim.js';
import { isLcRefusalToken } from '../../shared/api.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-basin';
const TOK = 'a'.repeat(64);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
const ERR = 'ccd: ws-audit --reclaim measured nothing: could not read the stash list — retry';
const RESUMES = 'It is retried; the box resumes where it stopped.';
const AFRESH = 'It is retried from the start.';
/** Every `ChildReclaimResume` value, held total by the test project's typecheck. */
const ALL_RESUME = { resumable: true, 'not-resumable': true, 'pre-lock-die': true, stuck: true } satisfies
  Record<ChildReclaimResume, true>;

const read = (doc: Record<string, unknown>) => parseChildReclaimResult(ID, JSON.stringify(doc), '');

describe('parseChildReclaimResult: the word first, then crumb', () => {
  it('crumb false is not-resumable whatever the word — a pre-breadcrumb pin-failed included', () => {
    for (const w of ['pin-failed', 'tombstone-unwritable', 'worktree-remove-failed', 'a-word-a-newer-ccd-prints']) {
      expect(read({ failed: w, detail: 'd', crumb: false }), w)
        .toEqual({ kind: 'failed', resume: 'not-resumable', detail: `${w}: d`, token: w });
    }
  });

  it('crumb true is resumable whatever the word — a resumed arm’s probe-unmeasured included', () => {
    for (const w of ['probe-unmeasured', 'state-changed', 'pin-failed']) {
      expect(read({ failed: w, detail: 'd', crumb: true }), w)
        .toEqual({ kind: 'failed', resume: 'resumable', detail: `${w}: d`, token: w });
    }
  });

  it('an absent crumb falls back to the pre-crumb words', () => {
    expect(read({ failed: 'probe-unmeasured', detail: 'd' })).toMatchObject({ resume: 'not-resumable' });
    expect(read({ failed: 'state-changed', detail: 'd' })).toMatchObject({ resume: 'not-resumable' });
    expect(read({ failed: 'pin-failed', detail: 'd' })).toMatchObject({ resume: 'resumable' });
  });

  it('a crumb that is not a boolean is absence, never either value', () => {
    for (const crumb of ['true', 'false', 1, 0, null, {}, []]) {
      const c = JSON.stringify(crumb);
      expect(read({ failed: 'probe-unmeasured', detail: 'd', crumb }), c).toMatchObject({ resume: 'not-resumable' });
      expect(read({ failed: 'pin-failed', detail: 'd', crumb }), c).toMatchObject({ resume: 'resumable' });
    }
  });

  it('containment-refuted is stuck whatever crumb says, with its token', () => {
    for (const extra of [{ crumb: true }, { crumb: false }, {}]) {
      expect(read({ failed: 'containment-refuted', detail: 'd', ...extra }), JSON.stringify(extra))
        .toEqual({ kind: 'failed', resume: 'stuck', detail: 'containment-refuted: d', token: 'containment-refuted' });
    }
  });

  it('purge-incomplete is read like any word: the feed, not the parse, gives it its own sentence', () => {
    expect(read({ failed: 'purge-incomplete', detail: 'd', crumb: true }))
      .toEqual({ kind: 'failed', resume: 'resumable', detail: 'purge-incomplete: d', token: 'purge-incomplete' });
  });

  it('crumb is read on a failed document only: a refusal and a reclaimed document ignore it', () => {
    expect(read({ refused: 'not-a-child', detail: 'd', crumb: true }))
      .toEqual({ kind: 'refused', token: 'not-a-child', detail: 'd' });
    expect(read({ reclaimed: ID, wip: null, secretsDropped: 0, crumb: false })).toMatchObject({ kind: 'reclaimed' });
  });

  it('the stuck set is one journal word, never a refusal kind, and stuck is a resume value', () => {
    expect([...CHILD_RECLAIM_STUCK_TOKENS]).toEqual(['containment-refuted']);
    for (const w of CHILD_RECLAIM_STUCK_TOKENS) {
      expect(isLcRefusalToken(w), w).toBe(true);
      expect(childReclaimTokenKind(w), w).toBeNull();
    }
    expect(isChildReclaimStuckToken('containment-refuted')).toBe(true);
    expect(isChildReclaimStuckToken('worktree-remove-failed')).toBe(false);
    expect(Object.keys(ALL_RESUME).every(isChildReclaimResume)).toBe(true);
    expect(isLcRefusalToken(CHILD_RECLAIM_PURGE_INCOMPLETE)).toBe(true);
    expect(isLcRefusalToken(CHILD_RECLAIM_PROBE_UNMEASURED)).toBe(true);
  });
});

describe('parseChildReclaimAuditFailed: an exit-1 audit is read for its unmeasured answer, never a token', () => {
  const doc = (o: Record<string, unknown> = {}): string => JSON.stringify(
    { id: ID, mode: 'reclaim', childOf: 7, verdict: 'unmeasured', detail: 'could not read the stash list', ...o });
  const detail = `ws-audit --reclaim failed: ${ERR}`;

  it('unmeasured naming a breadcrumb phase is resumable', () => {
    expect(parseChildReclaimAuditFailed(ID, doc({ resume: 'worktree' }), ERR))
      .toEqual({ kind: 'unmeasured', resume: 'resumable', detail });
  });

  it('unmeasured naming no phase is not-resumable: absent, empty, or not a string', () => {
    for (const extra of [{}, { resume: '' }, { resume: null }, { resume: 3 }, { resume: ['worktree'] }]) {
      expect(parseChildReclaimAuditFailed(ID, doc(extra), ERR), JSON.stringify(extra))
        .toEqual({ kind: 'unmeasured', resume: 'not-resumable', detail });
    }
  });

  it('every other exit-1 shape is unreadable — a token-bearing document first of all', () => {
    const shapes: readonly (readonly [string, string])[] = [
      ['reclaimable, with a token', doc({ verdict: 'reclaimable', token: TOK, resume: 'worktree' })],
      ['a refusal verdict', doc({ verdict: 'not-a-child', resume: 'worktree' })],
      ['a verdict this build does not know', doc({ verdict: 'something-new', resume: 'worktree' })],
      ['another session', doc({ id: 'demo-other-basin', resume: 'worktree' })],
      ['another mode', doc({ mode: 'plain', resume: 'worktree' })],
      ['no mode', JSON.stringify({ id: ID, verdict: 'unmeasured', resume: 'worktree' })],
      ['a JSON array', '[]'],
      ['JSON null', 'null'],
      ['nothing printed', ''],
      ['a document cut short', doc({ resume: 'worktree' }).slice(0, 40)],
    ];
    for (const [name, stdout] of shapes) {
      expect(parseChildReclaimAuditFailed(ID, stdout, ERR), name).toEqual({ kind: 'unreadable', detail });
    }
  });

  it('its answer type has no token arm and no refused arm', () => {
    const noToken: [Extract<ChildReclaimAuditFailedRead, { kind: 'token' }>] extends [never] ? true : false = true;
    const noRefused: [Extract<ChildReclaimAuditFailedRead, { kind: 'refused' }>] extends [never] ? true : false = true;
    expect([noToken, noRefused]).toEqual([true, true]);
  });
});

describe('childReclaimFailedTail: one decision, the word first, every resume value spoken', () => {
  it('purge-incomplete says the reclaim completed, what stands is named, and the sweep asks again only if the row’s own files stand, whatever its resume', () => {
    for (const resume of Object.keys(ALL_RESUME) as ChildReclaimResume[]) {
      const t = childReclaimFailedTail({ resume, token: CHILD_RECLAIM_PURGE_INCOMPLETE });
      expect(t, resume).toBe(
        'The reclaim itself completed and its registry row was purged; what still stands is named above. If the row’s own files still stand, the sweep asks again.');
    }
  });

  it('stuck says ccrc retries on its long backoff while automatic reclamation runs, and the box resumes once fixed', () => {
    expect(childReclaimFailedTail({ resume: 'stuck', token: 'containment-refuted' })).toBe(
      'While automatic reclamation runs, ccrc retries it on its long backoff; the box resumes from its breadcrumb once the tree or row is fixed.');
  });

  it('the three older values keep their sentences', () => {
    expect(childReclaimFailedTail({ resume: 'resumable', token: 'pin-failed' })).toBe(RESUMES);
    expect(childReclaimFailedTail({ resume: 'not-resumable', token: null })).toBe(AFRESH);
    expect(childReclaimFailedTail({ resume: 'pre-lock-die', token: null })).toBe(
      'ccd refused the call before anything started; nothing was touched, and it refuses the same way every time until that changes.');
  });

  it('every resume value has a sentence of its own', () => {
    const tails = (Object.keys(ALL_RESUME) as ChildReclaimResume[]).map((resume) => childReclaimFailedTail({ resume, token: null }));
    expect(new Set(tails).size).toBe(Object.keys(ALL_RESUME).length);
  });
});

/** A closed minting run and a registry row, a scripted ccd that records each
 *  verb it was asked, and the feed — `child-reclaim-pre-crumb.test.ts`'s rig,
 *  with the audit scripted too. */
const rig = async (script: (runId: number) => { audit: { code: number; stdout: string; stderr?: string };
  verb?: { code: number; stdout: string } }, feedQuiet = CHILD_RECLAIM_FEED_QUIET_NONE) => {
  const home = mkTmp('ccrc-child-reclaim-failed-arm-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
    started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const s = script(runId);
  const calls: string[] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'ws-audit') return { code: s.audit.code, stdout: s.audit.stdout, stderr: s.audit.stderr ?? '' };
    if (args[0] === 'ws-reclaim' && s.verb) return { code: s.verb.code, stdout: s.verb.stdout, stderr: '' };
    return { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: CAPS,
    presence: { isVisible: () => false }, notifyLog };
  const req: ChildReclaimRequest = { sessionId: ID, runId, trigger: 'close' as const, deferExpired: false,
    deferredSinceMs: null, feedQuiet, licenceGeneration: { kind: 'none' } };
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  return { deps, req, bodies, calls };
};

const auditDoc = (runId: number, verdict: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, verdict, detail: 'd', ...extra });
const tokenAudit = (runId: number) => ({ code: 0, stdout: auditDoc(runId, 'reclaimable', { detail: '', token: TOK }) });

describe('reclaimChild: the exit-1 audit arm', () => {
  it('an unmeasured audit over a standing breadcrumb is failed and resumable, with ccd’s journal word', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'unmeasured', { resume: 'worktree' }), stderr: ERR } }));
    expect(await reclaimChild(s.deps, s.req)).toEqual({ kind: 'failed', sessionId: ID, runId: s.req.runId,
      resume: 'resumable', detail: `ws-audit --reclaim failed: ${ERR}`, token: 'probe-unmeasured' });
    expect(s.calls).toEqual(['ws-audit']);
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain(RESUMES);
  });

  it('one naming no phase is failed and not-resumable, with the same word', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'unmeasured'), stderr: ERR } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable', token: 'probe-unmeasured' });
    expect(s.bodies()[0]).toContain(AFRESH);
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('a token printed at exit 1 is never spent: unreadable, a null token, and the verb never called', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'reclaimable', { token: TOK, resume: 'worktree' }) },
      verb: { code: 0, stdout: JSON.stringify({ reclaimed: ID }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable', token: null });
    expect(s.calls, 'the verb was never called on an exit-1 token').toEqual(['ws-audit']);
  });

  it('a failing item that already lists probe-unmeasured quiets the repeat feed row', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'unmeasured'), stderr: ERR } }),
      { deferWhy: null, failureToken: 'probe-unmeasured' });
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', token: 'probe-unmeasured' });
    expect(s.bodies()).toEqual([]);
  });
});

describe('reclaimChild: the feed tail follows the word first', () => {
  it('containment-refuted is stuck, and the feed says the box resumes once the tree or row is fixed', async () => {
    const s = await rig((runId) => ({ audit: tokenAudit(runId),
      verb: { code: 1, stdout: JSON.stringify({ failed: 'containment-refuted', detail: 'demo-twin names it', crumb: true }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'stuck', token: 'containment-refuted' });
    expect(s.bodies()[0]).toContain('containment-refuted: demo-twin names it. While automatic reclamation runs, ccrc retries it');
    expect(s.bodies()[0]).not.toContain(RESUMES);
  });

  it('purge-incomplete says the reclaim completed and the sweep asks again only if the row’s own files stand, never that the box resumes', async () => {
    const s = await rig((runId) => ({ audit: tokenAudit(runId),
      verb: { code: 1, stdout: JSON.stringify({ failed: 'purge-incomplete', crumb: true,
        detail: 'the reclaim completed — … — and the registry row WAS purged, but /r/x.lock could not be removed and still stands' }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', token: 'purge-incomplete' });
    expect(s.bodies()[0]).toContain('still stands. The reclaim itself completed and its registry row was purged');
    expect(s.bodies()[0]).toContain('If the row’s own files still stand, the sweep asks again.');
    expect(s.bodies()[0]).not.toContain('nothing retries it');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
    expect(s.bodies()[0]).not.toContain(AFRESH);
  });

  it('a pre-breadcrumb pin-failed (crumb false) says it is retried from the start', async () => {
    const s = await rig((runId) => ({ audit: tokenAudit(runId),
      verb: { code: 1, stdout: JSON.stringify({ failed: 'pin-failed', detail: 'the disk is full', crumb: false }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
    expect(s.bodies()[0]).toContain(AFRESH);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-failed-arm.test.ts
```
Expected: `Tests  17 failed | 6 passed (23)`. This was measured at `226bb881c` in a scratch copy, with wave 7's `LcRefusalToken` member added. Re-measure on the branch.
- Red (17):
  - `TypeError: parseChildReclaimAuditFailed is not a function`, in three cases;
  - `TypeError: childReclaimFailedTail is not a function`, in four cases;
  - `TypeError: CHILD_RECLAIM_STUCK_TOKENS is not iterable`, in "the stuck set is one journal word …";
  - `pin-failed: expected { kind: 'failed', …(3) } to deeply equal { kind: 'failed', …(3) }`, in "crumb false is not-resumable …";
  - `probe-unmeasured: expected … to deeply equal …`, in "crumb true is resumable …";
  - `{"crumb":true}: expected … to deeply equal …`, in "containment-refuted is stuck …";
  - the three exit-1 executor cases, each `expected { kind: 'failed', …(5) } to … { kind: 'failed', … }`;
  - the two feed cases for `containment-refuted` and for crumb-false `pin-failed`, with the same message;
  - the `purge-incomplete` feed case: `expected 'demo-quiet-basin, child of run #1: re…' to contain 'still stands. The reclaim itself comp…'`.
- Green already (6), because they pin what must survive:
  - "an absent crumb falls back …";
  - "a crumb that is not a boolean …";
  - "purge-incomplete is read like any word …";
  - "crumb is read on a failed document only …";
  - "its answer type has no token arm …". This is a type-level pin; at runtime it only compares two `true`s;
  - "a token printed at exit 1 is never spent …".

- [ ] **Step 3: Implement**

All edits are in `server/src/coord/childReclaim.ts`.

**Edit 1** (review 346 F4: the `ChildReclaimResume` doc and the pre-crumb set's doc). Replace from `` /** Replaces a `resumable: boolean` + `preLockDie: boolean` pair (review 170 `` through the closing `}` of `function isChildReclaimPreCrumbFailed(v: unknown): boolean {` with:

```ts
/** What a failed attempt promises about the NEXT one (spec §5.6, §5.9). It
 *  replaces a `resumable: boolean` + `preLockDie: boolean` pair (review 170
 *  fr-I m1): the pair admitted `{resumable:true, preLockDie:true}`, a state no
 *  producer ever built, and the seam rule says two conditions a caller handles
 *  differently must not share a representation that also permits a THIRD,
 *  impossible one. One discriminant makes it unrepresentable:
 *   - `resumable`: the act had started, so the box's next attempt resumes from
 *     its breadcrumb. Four producers:
 *       - a `{failed:…}` document saying `"crumb":true`. It says the act's
 *         breadcrumb was WRITTEN, never that it stands now (spec §5.6);
 *       - a `{failed:…}` document with NO `crumb` key (an older ccd, or a
 *         breadcrumb that stood but could not be read) whose word is outside
 *         `CHILD_RECLAIM_PRE_CRUMB_FAILED`;
 *       - a call cut short with nothing printed;
 *       - an exit-1 `ws-audit --reclaim` whose `unmeasured` document names a
 *         breadcrumb phase in `resume`: a breadcrumb stood when the audit read
 *         it, and ccd's next attempt resumes from it
 *         (`parseChildReclaimAuditFailed`).
 *   - `not-resumable`: nothing the next attempt could resume from was shown,
 *     but a plain retry MIGHT still succeed (a race, a version gap this build
 *     cannot name yet). Its producers:
 *       - a `{failed:…}` document saying `"crumb":false`, printed before the
 *         breadcrumb;
 *       - a `CHILD_RECLAIM_PRE_CRUMB_FAILED` word with no `crumb` key;
 *       - an exit-1 audit whose `unmeasured` document names no phase, and
 *         every audit answer this build cannot read;
 *       - a verb answer that is a refusal in substance: an unrecognised
 *         refusal word, or a `reclaimed` document naming another session.
 *   - `pre-lock-die`: a recognised PRE-LOCK die of `cmd_ws_reclaim` (a usage
 *     error, a malformed token/run id/session id, a missing `python3`, a
 *     missing `flock` binary, or an unopenable lock file — ccd's RECLAIM
 *     region, before `_ws_reclaim_locked` runs). It never advanced anything,
 *     but UNLIKE `not-resumable` it recurs IDENTICALLY until whatever caused
 *     it changes — not a race, so the feed says something different again.
 *   - `stuck`: ccd PROVED that another tree or row is in the way
 *     (`CHILD_RECLAIM_STUCK_TOKENS`), decided by the word whatever `crumb`
 *     says. A retry finds the same until that tree or row is moved or removed,
 *     and the box resumes from its breadcrumb once it is.
 *  `purge-incomplete` has no value of its own: its `resume` is read like any
 *  other word's, and what the feed says of it is decided by its WORD
 *  (`childReclaimFailedTail`).
 *  Stated residuals (spec §7, item 6), each a wrong feed sentence and never a
 *  wrong act: with no `crumb` key, a pre-breadcrumb `pin-failed` or
 *  `tombstone-unwritable` reads `resumable` and a resumed arm's
 *  `probe-unmeasured` reads `not-resumable`; and an audit over a breadcrumb it
 *  could not read prints no `resume`, so it reads `not-resumable`. */
export type ChildReclaimResume = 'resumable' | 'not-resumable' | 'pre-lock-die' | 'stuck';

const CHILD_RECLAIM_RESUME: Readonly<Record<ChildReclaimResume, true>> = {
  resumable: true, 'not-resumable': true, 'pre-lock-die': true, stuck: true,
};

export function isChildReclaimResume(v: unknown): v is ChildReclaimResume {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_RESUME, v);
}

/** ccd's journal word for a probe the reclaim ladder needs that could not run
 *  or be read (spec §5.7, §5.9): the verb's fresh-arm `{failed:…}` word, and
 *  the word `ws-audit --reclaim` journals for its own `unmeasured` answer
 *  (verb `ws-audit`). Spelled once, so the pre-crumb set below and the audit's
 *  exit-1 arm cannot drift apart. */
export const CHILD_RECLAIM_PROBE_UNMEASURED = 'probe-unmeasured' as const satisfies LcRefusalToken;

/** The FALLBACK for a `{failed:…}` document that carries no `crumb` key — an
 *  older ccd, or a breadcrumb that stood but could not be read (spec §5.6).
 *  These are the words `cmd_ws_reclaim` prints BEFORE the tombstone and the
 *  breadcrumb on its FRESH arm, so with nothing else to go on they read
 *  `not-resumable`, and every other word reads `resumable`. A document that
 *  says `crumb` is decided by it instead, and these words decide nothing there.
 *   - `probe-unmeasured`: on the fresh arm, the presence rungs' own in-lock
 *     tmux probe (spec §5.7, rungs 5 and 6) failing before any act. On the
 *     RESUMED arm the locked recomputation prints it too, over a standing
 *     breadcrumb, and a ccd that prints `crumb` says `true` there.
 *   - `state-changed`: the consent binding (spec §5.5) — the in-lock recompute
 *     and the pin read different branch states, so the act stopped before the
 *     tombstone. Printed on the fresh arm only, because only the fresh arm runs
 *     the pin phase. Also a `refused` word (`CHILD_RECLAIM_TOKEN_KIND`), which
 *     is why this set is typed against both vocabularies.
 *  `pin-failed` and `tombstone-unwritable` are deliberately NOT here: each is
 *  printed once in the fresh path's pin phase, before the breadcrumb, and also
 *  by the tail after it, so the word alone cannot tell the two apart. ccd's
 *  `crumb` does, and only a document without it falls back here.
 *  Named so `isChildReclaimKebab` admits `probe-unmeasured` without a second
 *  hand-kept literal. */
const CHILD_RECLAIM_PRE_CRUMB_FAILED = [CHILD_RECLAIM_PROBE_UNMEASURED, 'state-changed'] as const satisfies
  readonly (LcRefusalToken | ChildReclaimToken)[];

function isChildReclaimPreCrumbFailed(v: unknown): boolean {
  return typeof v === 'string' && (CHILD_RECLAIM_PRE_CRUMB_FAILED as readonly string[]).includes(v);
}

/** The `stuck` words (spec §5.6, §5.9): ccd PROVED at the tail's removal-time
 *  re-ask that another tree or registry row lies at, inside or through what it
 *  would delete. The session was stopped and nothing further was deleted; a
 *  retry finds the same until that tree or row is moved or removed. Spelled
 *  ONCE, here. The sweep carries the class to L1 as a tier field, and never
 *  re-spells the word. Never a `CHILD_RECLAIM_TOKEN_KIND` key:
 *  `childReclaimTokenKind('containment-refuted')` stays null, because it is a
 *  `{failed:…}` word and never a refusal. */
export const CHILD_RECLAIM_STUCK_TOKENS = ['containment-refuted'] as const satisfies readonly LcRefusalToken[];
export type ChildReclaimStuckToken = typeof CHILD_RECLAIM_STUCK_TOKENS[number];

export function isChildReclaimStuckToken(v: unknown): v is ChildReclaimStuckToken {
  return typeof v === 'string' && (CHILD_RECLAIM_STUCK_TOKENS as readonly string[]).includes(v);
}

/** ccd's word for a reclaim that COMPLETED and purged its registry row, while
 *  something beside the row would not unlink (spec §5.6). Its `detail` names
 *  what still stands. Spelled once: the feed's failed tail reads it first. */
export const CHILD_RECLAIM_PURGE_INCOMPLETE = 'purge-incomplete' as const satisfies LcRefusalToken;

/** A `{failed:…}` document's `resume`, the WORD first and then `crumb` (spec
 *  §5.6). `crumb` is read strictly: only the two booleans count, and any other
 *  value (absent, a string, a number, null) is absence, never either value.
 *  This reader is `ws-reclaim`'s alone; a `ws-collect` document carries no
 *  `crumb`, and this is never applied to one. */
function childReclaimFailedResume(word: string, crumb: unknown): ChildReclaimResume {
  if (isChildReclaimStuckToken(word)) return 'stuck';
  if (crumb === true) return 'resumable';
  if (crumb === false) return 'not-resumable';
  return isChildReclaimPreCrumbFailed(word) ? 'not-resumable' : 'resumable';
}
```

**Edit 2.** In `isChildReclaimKebab`, replace

```ts
  return isChildReclaimToken(v) || isChildReclaimDeferWhy(v) || isChildReclaimResume(v)
    || isChildReclaimPreCrumbFailed(v)
```
with
```ts
  return isChildReclaimToken(v) || isChildReclaimDeferWhy(v) || isChildReclaimResume(v)
    || isChildReclaimPreCrumbFailed(v) || isChildReclaimStuckToken(v) || v === CHILD_RECLAIM_PURGE_INCOMPLETE
```
In its docstring, replace ``  *  inline set. Deliberately NOT named `isChildReclaimWord`: wave 5 owns that `` with:
```ts
 *  inline set. The stuck words and `purge-incomplete` are admitted through
 *  their one spelling each (spec §5.6). Deliberately NOT named `isChildReclaimWord`: wave 5 owns that
```
Rewrap the paragraph's last lines to the file's width if needed; the text is what matters.

**Edit 3.** Directly after the last arm of `ChildReclaimAuditRead` (`  | { readonly kind: 'unreadable'; readonly detail: string };`), insert:

```ts

/** The audit's own `unmeasured` answer, read off an exit-1 document (spec
 *  §5.7, §5.9). `resume` is `resumable` exactly when the document names a
 *  breadcrumb phase (a non-empty string `resume`): a breadcrumb stood when the
 *  audit read it. Nothing else is read from it. No hand-kept phase list. */
export type ChildReclaimAuditUnmeasured = {
  readonly kind: 'unmeasured'; readonly resume: 'resumable' | 'not-resumable'; readonly detail: string };

/** What an exit-1 audit document can answer: its `unmeasured` answer or
 *  `unreadable`. It has NO `token` arm and no `refused` arm, so no exit-1
 *  document is ever spent, a token-bearing one included, and that holds by type,
 *  not by convention. */
export type ChildReclaimAuditFailedRead = ChildReclaimAuditUnmeasured | Extract<ChildReclaimAuditRead, { kind: 'unreadable' }>;
```

**Edit 4.** Directly above `` /** The exact stderr shape ccd's own `die` calls print for the SIX single-line ``, insert:

```ts
/** `ws-audit --reclaim`'s document at a NON-ZERO exit (spec §5.7, §5.9). ccd
 *  prints its `unmeasured` answer, then journals `failed probe-unmeasured`
 *  (verb `ws-audit`) and exits 1; it prints `"resume":<phase>` whenever it read
 *  a `reclaim:` breadcrumb. This applies `parseChildReclaimAudit`'s identity
 *  rules (a JSON object, `id === sessionId`, `mode === 'reclaim'`) and accepts
 *  ONLY `verdict === 'unmeasured'`. Every other shape is `unreadable`, a
 *  token-bearing document first of all. `detail` is the same at every arm:
 *  ccd's stderr, which names what was not measured. */
export function parseChildReclaimAuditFailed(sessionId: string, stdout: string, stderr: string): ChildReclaimAuditFailedRead {
  const detail = `ws-audit --reclaim failed: ${stderr.trim()}`;
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'unreadable', detail }; }
  if (!isRecord(v) || v.id !== sessionId || v.mode !== 'reclaim' || v.verdict !== 'unmeasured') {
    return { kind: 'unreadable', detail };
  }
  return { kind: 'unmeasured', resume: typeof v.resume === 'string' && v.resume !== '' ? 'resumable' : 'not-resumable', detail };
}

```

**Edit 5.** In `ChildReclaimVerbRead`, replace
```ts
  /** `resume` (review 170 F20; three-way since fr-I m1 — see
   *  `ChildReclaimResume`'s own docstring). `matchChildReclaimPreLockDie`,
```
with
```ts
  /** `resume` (review 170 F20; three-way since fr-I m1, four-way since
   *  `stuck` — see `ChildReclaimResume`'s own docstring). `matchChildReclaimPreLockDie`,
```

**Edit 6** (review 346 F4: the parse comment). In the `if (typeof v.failed === 'string') {` arm of `parseChildReclaimResult`, replace everything from ``       // A word in `CHILD_RECLAIM_PRE_CRUMB_FAILED` (`probe-unmeasured`, the `` through `      const resume: ChildReclaimResume = isChildReclaimPreCrumbFailed(v.failed) ? 'not-resumable' : 'resumable';` with:

```ts
      // The word first, then ccd's `crumb` (spec §5.6; `childReclaimFailedResume`).
      const resume = childReclaimFailedResume(v.failed, v.crumb);
```
The `return { kind: 'failed', resume, … token: v.failed };` line below it is unchanged.

**Edit 7.** In `childReclaimOutcome`, directly after

```ts
  const audit = await childReclaimAudit(deps, req);
  if (audit.kind === 'unreadable') {
    return { kind: 'failed', sessionId, runId, resume: 'not-resumable', detail: audit.detail, token: null };
  }
```
insert:
```ts
  // The audit's own `unmeasured` answer at exit 1 carries the word ccd journaled
  // for it, so the feed's quiet and the sweep's failure count see the same word
  // the mirror holds (spec §5.9).
  if (audit.kind === 'unmeasured') {
    return { kind: 'failed', sessionId, runId, resume: audit.resume, detail: audit.detail,
      token: CHILD_RECLAIM_PROBE_UNMEASURED };
  }
```
It sits directly after the `unreadable` block: before `audit.childOf` is read and before Task 3's step 5a (the audit's generation against the licence), because an `unmeasured` answer carries neither.

**Edit 8** (review 346 F4: the docstring of `childReclaimAudit`). Replace from `/** The audit — its own function so the verb-gate scanner reads its own gate:` through the function's closing `}` with:

```ts
/** The audit — its own function so the verb-gate scanner reads its own gate:
 *  `ws-audit` is an old verb, asked the old question. The FLAG's question
 *  (`reclaim-v1`) was already answered in step 4. The EXIT STATUS decides which
 *  reader runs. At exit 0 it is `parseChildReclaimAudit`, the only reader that
 *  can answer a token. At any other exit it is `parseChildReclaimAuditFailed`,
 *  whose answer type has no token arm: the audit's own `unmeasured` answer,
 *  resumable when it names a breadcrumb phase, or `unreadable`. So no exit-1
 *  document, a token-bearing one included, is ever spent (spec §5.7, §5.9). */
async function childReclaimAudit(
  deps: ChildReclaimDeps, req: ChildReclaimRequest,
): Promise<ChildReclaimAuditRead | ChildReclaimAuditUnmeasured> {
  const argv = CCD_ARGV.wsReclaimAudit(req.sessionId, req.deferExpired);
  if (!verbSupported(deps.fleetState, argv)) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
  const res = await deps.runCcd(argv);
  if (!res.ok) return parseChildReclaimAuditFailed(req.sessionId, res.stdout, res.stderr);
  return parseChildReclaimAudit(req.sessionId, res.stdout);
}
```
`verb-gate.test.ts` still finds `verbSupported(` in this function's own scope. The only change to the signature is a line break. Measured green.

**Edit 9.** Directly above `function childReclaimFeedBody(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,`, insert:

```ts
/** What a failed attempt's feed row promises next (spec §5.9): ONE decision,
 *  the WORD first and then `resume`, every value spoken by its own arm.
 *  `purge-incomplete` is decided by its word whatever `resume` it carries: the
 *  reclaim completed and its registry row was purged, and ccd's detail (rendered
 *  just before this sentence) names what still stands. The sentence is
 *  CONDITIONAL (the coordinator's ruling on T6 OPEN5): the sweep asks again only
 *  if the row's own files still stand. It never says that nothing retries it,
 *  nor that the box resumes.
 *  The `never` guard makes a `ChildReclaimResume` value added without a
 *  sentence a compile error, never the old ternary's silent "retried from the
 *  start". */
export function childReclaimFailedTail(o: { readonly resume: ChildReclaimResume; readonly token: string | null }): string {
  if (o.token === CHILD_RECLAIM_PURGE_INCOMPLETE) {
    return 'The reclaim itself completed and its registry row was purged; what still stands is named above. If the row’s own files still stand, the sweep asks again.';
  }
  switch (o.resume) {
    // `pre-lock-die` (review 170 F20, wording per fr-I m2, corrected per fr-I
    // rereview-r1 m2): the recogniser covers THREE families — an argv/version
    // die (usage, a malformed token/run id/session id), a missing binary
    // (python3, flock), and a lock/registry state die (lock-unopenable: EISDIR,
    // EACCES, a missing `$REG`) — and no single named list of causes is true of
    // all three. The sentence stays CAUSE-NEUTRAL and leaves the cause to ccd's
    // own message, rendered immediately before it.
    case 'pre-lock-die':
      return 'ccd refused the call before anything started; nothing was touched, and it refuses the same way every time until that changes.';
    // The act had started, or the audit read a standing breadcrumb.
    case 'resumable': return 'It is retried; the box resumes where it stopped.';
    // Nothing to resume from was shown; a plain retry might still work.
    case 'not-resumable': return 'It is retried from the start.';
    // ccd proved another tree or row is in the way, and its detail says which.
    // Conditional, like the failing sentence: the switch can stop the retries.
    case 'stuck':
      return 'While automatic reclamation runs, ccrc retries it on its long backoff; the box resumes from its breadcrumb once the tree or row is fixed.';
    default: {
      const _exhaustive: never = o.resume;
      return _exhaustive;
    }
  }
}

```

**Edit 10** (review 346 F4: the feed-body comment). In `childReclaimFeedBody`, replace the whole `failed` arm, from ``     // `resume` says what to promise the reader (fix round 1 review minor #4, `` through the closing `    }` of `case 'failed': { … }`, with:

```ts
    // `childReclaimSentence` (not a bare `.`) avoids doubling the punctuation
    // when `o.detail` already ends a sentence.
    case 'failed':
      return `${who}: reclaim failed — ${childReclaimSentence(o.detail)} ${childReclaimFailedTail(o)}${wait}`;
```
The `pre-lock-die` comment moves into `childReclaimFailedTail` (Edit 9), unchanged in substance.

- [ ] **Step 4: Run it to pass, then the suites that read these readers**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-failed-arm.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/child-reclaim-pre-crumb.test.ts test/mail-routes.test.ts test/verb-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts test/ccd-child-reclaim-prelock-journal.test.ts test/ccd-child-reclaim-gone-branch.test.ts
cd server && ./node_modules/.bin/vitest run test/containment-refuted-word.test.ts
```
Expected:
- **The first command:** `Tests  23 passed (23)`.
- **The second and third:** pass unchanged. The third batch was measured at 48 cases, about 70 s, on `226bb881c`'s ccd; re-measure on wave 7's.
- **The fourth:** reds exactly ONE case and nothing else, `today’s parsers read it as a resumable failure — retried > parseChildReclaimResult: failed, resumable, with its token`, with `AssertionError: expected { kind: 'failed', …(3) } to deeply equal { kind: 'failed', …(3) }`. This is R77's deliberate flip (Step 5).

- [ ] **Step 5: Flip wave 7's ONE parser pin and retitle it (R77, T1 OPEN3, H3)**

In `server/test/containment-refuted-word.test.ts`, replace

```ts
describe('today’s parsers read it as a resumable failure — retried', () => {
  it('parseChildReclaimResult: failed, resumable, with its token', () => {
    expect(parseChildReclaimResult('demo-quiet-basin', DOC, '')).toEqual({
      kind: 'failed', resume: 'resumable', detail: `${W}: d`, token: W });
  });
```
with
```ts
// Wave 8 retitles this describe and flips ONE assertion in it on purpose (spec
// §5.6, the stuck class; ruling H3): the reclaim parser reads the word as
// `stuck`. `parseExpireResult`'s, below, is workspace-lifecycle's and is left
// as found.
describe('the parsers read it as a failure: the reclaim parser as stuck, the expiry parser as resumable', () => {
  it('parseChildReclaimResult: failed, stuck, with its token', () => {
    expect(parseChildReclaimResult('demo-quiet-basin', DOC, '')).toEqual({
      kind: 'failed', resume: 'stuck', detail: `${W}: d`, token: W });
  });
```
Leave the `parseExpireResult` case and the sweep case as found; only the describe's title, the one `it`'s title and its one assertion change (H3). If workspace-lifecycle wave 5 has already changed the `parseExpireResult` case on this branch, leave its version too.

```bash
cd server && ./node_modules/.bin/vitest run test/containment-refuted-word.test.ts
```
Expected: every case passes (6/6 at wave 7's count).

- [ ] **Step 6: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```
Expected: both print nothing. The second uses the project that `typecheck-tests.test.ts` spawns. It holds `ALL_RESUME` total over `ChildReclaimResume`, and it holds the no-token-arm pin.

- [ ] **Step 7: Mutation check**

Make each mutation alone on the Step 6 tree, run its command (FOREGROUND, under 600 s), see the stated red, then revert. F is `cd server && ./node_modules/.bin/vitest run test/child-reclaim-failed-arm.test.ts`. Every row was measured in a scratch copy of `226bb881c` with this task applied.

| # | Mutation (exact edit in `server/src/coord/childReclaim.ts`) | Command | Expected red |
|---|---|---|---|
| 1 | In `childReclaimFailedResume`, delete `  if (isChildReclaimStuckToken(word)) return 'stuck';` | F | 2 failed: "containment-refuted is stuck whatever crumb says …" (`{"crumb":true}: expected { kind: 'failed', …(3) } to deeply equal …`) and "containment-refuted is stuck, and the feed says …" (`expected { kind: 'failed', …(5) } to match object { kind: 'failed', …(2) }`) |
| 2 | Move that line BELOW the two `crumb` lines (crumb before word) | F | the same 2 cases, the same messages |
| 3 | Replace `if (crumb === true)` with `if (crumb)` | F | 1 failed: "a crumb that is not a boolean is absence …" (`"true": expected { kind: 'failed', …(3) } to match object { resume: 'not-resumable' }`) |
| 4 | Replace `if (crumb === false)` with `if (!crumb)` | F | 2 failed: "an absent crumb falls back …" (`to match object { resume: 'resumable' }`) and "a crumb that is not a boolean …" (`0: … to match object { resume: 'resumable' }`) |
| 5 | Delete `  if (crumb === false) return 'not-resumable';` | F | 2 failed: "crumb false is not-resumable …" (`pin-failed: expected … to deeply equal …`) and "a pre-breadcrumb pin-failed (crumb false) …" |
| 6 | Delete `  if (crumb === true) return 'resumable';` | F | 1 failed: "crumb true is resumable …" (`probe-unmeasured: expected … to deeply equal …`) |
| 7 | In `parseChildReclaimAuditFailed`, delete ` \|\| v.verdict !== 'unmeasured'` | F | 2 failed: "every other exit-1 shape is unreadable …" (`reclaimable, with a token: expected { kind: 'unmeasured', …(2) } to deeply equal { kind: 'unreadable', …(1) }`) and "a token printed at exit 1 is never spent …" |
| 8 | Delete ` \|\| v.id !== sessionId` | F | 1 failed: `another session: expected { kind: 'unmeasured', …(2) } to deeply equal { kind: 'unreadable', …(1) }` |
| 9 | Delete ` \|\| v.mode !== 'reclaim'` | F | 1 failed: `another mode: expected { kind: 'unmeasured', …(2) } to deeply equal { kind: 'unreadable', …(1) }` |
| 10 | Replace `typeof v.resume === 'string' && v.resume !== '' ?` with `typeof v.resume === 'string' ?` | F | 1 failed: `{"resume":""}: expected { kind: 'unmeasured', …(2) } to deeply equal …` |
| 11 | Replace the same with `v.resume ?` | F | 1 failed: `{"resume":3}: expected { kind: 'unmeasured', …(2) } to deeply equal …` |
| 12 | In `childReclaimAudit`, replace `return parseChildReclaimAuditFailed(req.sessionId, res.stdout, res.stderr);` with `` return { kind: 'unreadable', detail: `ws-audit --reclaim failed: ${res.stderr.trim()}` }; `` | F | 3 failed: the first, second and fourth `reclaimChild: the exit-1 audit arm` cases |
| 13 | In Edit 7, replace `token: CHILD_RECLAIM_PROBE_UNMEASURED` with `token: null` | F | 3 failed: the same three cases. The fourth reds because the feed row is written: `expected { kind: 'failed', …(5) } to match object { kind: 'failed', …(1) }` |
| 14 | Replace the right side of `ChildReclaimAuditFailedRead` with `ChildReclaimAuditUnmeasured \| ChildReclaimAuditRead` | `cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json` | `test/child-reclaim-failed-arm.test.ts(…): error TS2322: Type 'true' is not assignable to type 'false'.`, twice (the no-token and no-refused lines) |
| 15 | In `childReclaimFailedTail`, delete the `if (o.token === CHILD_RECLAIM_PURGE_INCOMPLETE) { … }` block | F | 2 failed: "purge-incomplete says the reclaim completed …" (`resumable: expected 'It is retried; the box resumes where …' to be 'The reclaim itself completed and its …'`) and the `purge-incomplete` feed case. The message text is re-predicted for T6 OPEN5's sentence; re-measure |
| 16 | Delete `case 'stuck':` and its `return` | `cd server && ./node_modules/.bin/tsc --noEmit -p .` | `src/coord/childReclaim.ts(…): error TS2322: Type '"stuck"' is not assignable to type 'never'.` |
| 17 | In `CHILD_RECLAIM_RESUME`, delete `stuck: true,` | `cd server && ./node_modules/.bin/tsc --noEmit -p .` | `error TS2741: Property 'stuck' is missing in type '{ resumable: true; 'not-resumable': true; 'pre-lock-die': true; }' but required in type 'Readonly<Record<ChildReclaimResume, true>>'.` |
| 18 | In `isChildReclaimKebab`, delete ` \|\| isChildReclaimStuckToken(v)` | `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` | `AssertionError: containment-refuted is not a declared MailRejectCode, RunRefuseCode, … or dead-coordinator word: expected false to be true` |
| 19 | In `isChildReclaimKebab`, delete ` \|\| v === CHILD_RECLAIM_PURGE_INCOMPLETE` | same as row 18 | `AssertionError: purge-incomplete is not a declared MailRejectCode, … : expected false to be true` |
| 20 | In `childReclaimFailedTail`'s `purge-incomplete` return, delete ` If the row’s own files still stand, the sweep asks again.` (T6 OPEN5's conditional clause) | F | 2 failed: "purge-incomplete says the reclaim completed …" (`resumable: expected 'The reclaim itself completed and its …' to be 'The reclaim itself completed and its …'`) and the `purge-incomplete` feed case (`expected 'demo-quiet-basin, child of run #1: re…' to contain 'If the row’s own files still stand, th…'`). Predicted, not yet measured; re-measure |

Rows 1 and 2 also red the flipped case in `containment-refuted-word.test.ts`. That is expected.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/childReclaim.ts server/test/child-reclaim-failed-arm.test.ts \
  server/test/containment-refuted-word.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): read crumb, stuck and the exit-1 audit's resume

parseChildReclaimResult's failed arm reads the word first, then ccd's
additive crumb: containment-refuted is stuck whatever crumb says,
crumb false is not-resumable, crumb true is resumable (the act had
started), and an absent or non-boolean crumb falls back to the
pre-crumb words. ChildReclaimResume gains 'stuck'.

childReclaimAudit reads an exit-1 document through its own parser,
whose type has no token arm: the audit's unmeasured answer is failed
with ccd's journal word probe-unmeasured, resumable when it names a
breadcrumb phase. Every other exit-1 shape stays unreadable, so no
exit-1 token is ever spent.

The feed's failed tail is one exhaustive switch with a never guard,
word first: purge-incomplete says the reclaim completed and its row
was purged, and that the sweep asks again only if the row's own files
still stand; stuck says the box resumes once the tree or row is fixed.
Wave 7's one parseChildReclaimResult pin flips to stuck under a
retitled describe, and review 346's F4 comments are rewritten to the
new rule. This commit owns the stuck reading (H3); Tasks 8 and 9
consume it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Kept leaves: one word classifier, the mirror reader, and an attention item that outlives the row

**Model routing:** `sonnet`, effort `high`. This is a report that gates nothing: no verdict, due set, lease or request reads it. The design work is the reader's three answers, the end rules, and where the read sits relative to the pass's fail-shut try.

**Why:** ccd's shared reclaim tail keeps a clips directory (`~/.cc-clips/<id>`) or a temp root (`~/.cc-tmp/<id>`) that it cannot prove gone. It journals the word as `meas.clipsKept` / `meas.tmpRootKept` on the reclaim's `done` row and on the three purge-failure rows (`ccd/ccd:30074-30104` at `226bb881c`; `grep -n 'meas.clipsKept "\$clipskept" meas.tmpRootKept "\$tmpkept"' ccd/ccd`). No server reader exists today. After a `done`, ccd has purged the registry row, so every attention arm that reads the listing skips the child: `childReclaimAttention` has `if (!i.live.has(row.sessionId)) continue` (`server/src/childReclaimSweep.ts:1048`). The kept leaf is never listed for the operator. Three things in the mirror shape the reader:
- The journal encoder omits empty values (`ccd/ccd:4876-4880`), and `journalparse.ts`'s `s(o, 'clipsKept')` yields `null` for an absent key (`server/src/coord/journalparse.ts:211`). So on the mirror, `null` means "nothing kept, or an older ccd did not say", and the two cannot be told apart.
- A line past the 2048-byte cap drops its whole `meas` and sets `truncated` (`ccd/ccd:4904-4910`; `MirroredLifecycleEvent.truncated`, `shared/api.ts:7799`). The `detail` of the done row grows only when something is kept (`ccd/ccd:30098-30100`), so a cut line is most likely exactly when a leaf was kept.
- The purge-failure rows carry no `meas.childOf`, and a cut line carries no `meas` at all. Those items have no run.

So the mirror reader answers three things, never folded: `kept:<word>`, `none-or-unreported` and `truncated`. The ONE thing shared with workspace-lifecycle is the word classifier, `leafKeptWord`. Workspace-lifecycle's stdout reader, `expireLeafKept`, keeps its own absence word (`unreported`), because on stdout an explicit `null` and an absent key mean different things. The item is derived on every pass from the mirror alone, so a restart rebuilds it. It is read in its OWN try, AFTER the fail-shut try, and before the two early returns.

**Files:**
- Modify: `server/src/childReclaimSweep.ts`. Add the kept-leaf block directly after `childReclaimFeedQuiet`'s closing brace (`grep -n "^export function childReclaimFeedQuiet(" server/src/childReclaimSweep.ts`, `:1163` at `226bb881c`). Add `leafKeptWord`, `CHILD_RUN_ID`, `LC_LINE_MAX`, `type LifecycleMeas`, `type LeafKeptWord`, `type ChildReclaimLeafKeptAttention` and `type ChildReclaimLeafKeptMany` to its `../../shared/api.js` import (`:14-18`). `LC_LINE_MAX` (`shared/api.ts:8056` at `226bb881c`) bounds `childReclaimDetailText` (W8-SEC-2). The last three are Task 1's L0 names: this file imports them and never declares a second copy.
- Modify: `server/src/coord/store.ts`. Add `lifecycleReclaimRowsSinceSql`, `lifecycleReclaimRowsSince`, `lifecycleLeafEndsSql` and `lifecycleLeafEndsFor` directly after `childReclaimEvents` (`grep -n "  childReclaimEvents(sessionIds" server/src/coord/store.ts`, `:5905`). Widen the type-only import at `:22` (`grep -n "^import type { ChildReclaimCoordinatorClaim }" server/src/coord/store.ts`) to a value import, which `deadCoordinator.js`'s import at `:42` already precedents. Add `type LifecycleOutcome` to the `shared/api.js` import if it is absent.
- Modify: `server/src/coord/childReclaim.ts`. Add `CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE`, `childReclaimLeafKeptFeedBody` and `recordChildReclaimLeafKeptFeed` directly after `recordChildReclaimKeptFeed` (`grep -n "^export function recordChildReclaimKeptFeed" server/src/coord/childReclaim.ts`, `:1399`). Add `childReclaimDetailText` and `type ChildReclaimLeafKept` to its `../childReclaimSweep.js` import (`:11-16`).
- Modify: `server/src/watch.ts`. Add two fields beside `childReclaimKeptReported` (`grep -n "private childReclaimKeptReported" server/src/watch.ts`, `:884`). Add the ONE-b block after the `mirrorArms` statement (`grep -n "latest, live, kindOf: childReclaimTokenKind, sentenceFor: refusalSentence, nowMs: now," server/src/watch.ts`, `:3374`). Edit one line in `childReclaimPublishAttention` (`:3838`). Extend the imports at `:89-91` and `:93-100`.
- No `server/src/archivedExpiry.ts` edit (H8). If workspace-lifecycle wave 5 is on this branch, Task 1's commit re-pointed `expireLeafKept` at the shared classifier and derived that file's `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s key type from `LeafKeptWord` (W8-SEC-1). Step 0 (e), Step 0 (e2) and Step 7 only verify that.
- Test (new): `server/test/child-reclaim-leaf-kept.test.ts` covers the mirror reader, the item, its ends, the collapse, and the tie of its purge-failure set to Task 6's `CHILD_RECLAIM_PURGE_INCOMPLETE`. The classifier's pins are Task 1's (H8).
- Test (new): `server/test/child-reclaim-leaf-kept-store.test.ts` covers the two store reads.
- Test (new): `server/test/child-reclaim-leaf-kept-lane.test.ts` covers the lane: the placement relative to the fail-shut try, the early returns, restart and the feed. It runs on Task 3's shared `laneFixture` (H7) and builds no FleetWatcher rig of its own.
- Modify (test rig): `server/test/childReclaimGenerationFixture.ts`, Task 3's shared lane rig (H7). Step 1 adds the options and helpers this task's lane cases need, additively: `exec`, `ccdVerbs`, `notifyLog`, `coord` and `home` options, plus `journal`, `now` and `home` on the returned rig, each added only if it is not already a key of it, with the uid counter moved to module scope, directly above `export const laneFixture` (EX3).
- No `shared/api.ts` edit, so this task has no README re-point. Task 1 makes every `shared/api.ts` insertion. No `pwa/` edit: Step 9 proves the PWA renders the new kind unchanged.

**Interfaces:**
- Consumes (Task 1, L0 `shared/api.ts`; Step 0 checks each one; this task redeclares none of them):
  - `export type LeafKeptWord = 'refused' | 'unmeasured' | 'in-use';` and `leafKeptWord(v: unknown): LeafKeptWord`, the word half. ccd's three words read as themselves, and ANY other value reads `'unmeasured'`. That includes `null`, a string ccd does not print, `''`, a number, an object and `undefined`. `null` and absence are each carrier's to read, BEFORE it calls the word half (H8, after 4045): WL5's stdout reader asks `hasOwnProperty` and then `null`; this task's mirror reader asks `null`, which on the mirror means nothing kept or not reported. Task 1's `child-reclaim-attention-arms.test.ts` pins the classifier's behaviour and its one declaration (H8). This task only calls it, and types every kept-leaf word with `LeafKeptWord`.
  - `export interface ChildReclaimLeafKeptAttention { readonly kind: 'leaf-kept'; readonly sessionId: string; readonly runId: number | null; readonly sentence: string; readonly at: number | null; }`, an arm of `ChildReclaimAttention`. This task's L1 block and its test import it from `shared/api.ts`.
  - `export interface ChildReclaimLeafKeptMany { readonly kind: 'kept-many'; readonly word: 'leaf-kept'; readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string; }`, a SEPARATE arm of the union. The existing `kept-many` arm keeps `word: ChildReclaimKeptWord`, unwidened. Members carry `runId: number` (Task 1's departure `leaf-collapse-members-carry-a-run`).
- Consumes (wave 7, merged into this branch by Task 0): the `LifecycleAct` member `'collect'` and its `done` row (`_lc_done collect "$id" …`, wave 7 plan Task 7). ALSO consumes the existing `CHILD_RUN_ID` (`shared/api.ts:53`), the `LcRefusalToken` members `purge-refused`, `purge-incomplete` and `purge-mechanism-absent` (`:7873-7875`), `CHILD_RECLAIM_KEPT_MANY_OVER` and `childReclaimBySession` (`server/src/childReclaimSweep.ts:1071-1074`), `CoordStore`'s `LC_COLS`, `reviveLifecycleRow` and `placeholders` (`store.ts:1093`), and `recordChildReclaimKeptFeed`'s idiom.
- Consumes (Task 6, `server/src/coord/childReclaim.ts`), in the test only: `CHILD_RECLAIM_PURGE_INCOMPLETE`. L1 imports L0 alone, so `CHILD_RECLAIM_LEAF_FAILED_TOKENS` spells its three tokens itself, typed against L0's `LcRefusalToken`, and one test case ties the set to Task 6's constant.
- Consumes (Task 3, `server/test/childReclaimGenerationFixture.ts`): `laneFixture`, `Lane` and `G1`, the ONE watcher rig (H7). Step 1 extends it additively.
- Produces, L1 `server/src/childReclaimSweep.ts`:
  ```ts
  // Kept-leaf words are typed with Task 1's L0 `LeafKeptWord`; no second derivation of it here (H8).
  export const CHILD_RECLAIM_LEAF_FAILED_TOKENS =
    ['purge-incomplete', 'purge-mechanism-absent', 'purge-refused'] as const satisfies readonly LcRefusalToken[];
  export const CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS = 7 * 24 * 3_600_000;
  export const childReclaimLeafKeptSince: (nowMs: number) => number;
  export interface ChildReclaimLeafSourceRow {
    readonly id: number; readonly sessionId: string; readonly at: number; readonly outcome: LifecycleOutcome;
    readonly refusal: string | null; readonly truncated: boolean; readonly meas: LifecycleMeas | null;
    readonly detail: string | null;
  }
  export interface ChildReclaimLeafEndRow {
    readonly id: number; readonly act: Extract<LifecycleAct, 'create' | 'collect'>; readonly at: number | null;
  }
  export type ChildReclaimMirrorLeaf =
    | { readonly kind: 'kept'; readonly word: LeafKeptWord }
    | { readonly kind: 'none-or-unreported' }
    | { readonly kind: 'truncated' };
  export function childReclaimMirrorLeaf(
    row: Pick<ChildReclaimLeafSourceRow, 'truncated' | 'meas'>, key: 'clipsKept' | 'tmpRootKept'): ChildReclaimMirrorLeaf;
  export const childReclaimLeafSource: (r: Pick<ChildReclaimLeafSourceRow, 'outcome' | 'refusal'>) => boolean;
  // W8-SEC-2: one line, control and bidi characters replaced, at most LC_LINE_MAX code points plus an ellipsis.
  export function childReclaimDetailText(d: string): string;
  export function childReclaimLeafKeptSentence(
    sessionId: string, clips: ChildReclaimMirrorLeaf, tmp: ChildReclaimMirrorLeaf | 'collected',
    detail: string | null): string;
  // `ChildReclaimLeafKeptAttention` is Task 1's L0 interface, imported from shared/api.ts and never redeclared.
  export interface ChildReclaimLeafKept {
    readonly item: ChildReclaimLeafKeptAttention; readonly source: number; readonly detail: string | null;
  }
  export function childReclaimLeafKept(i: {
    readonly rows: readonly ChildReclaimLeafSourceRow[];
    readonly ends: ReadonlyMap<string, readonly ChildReclaimLeafEndRow[]>;
    readonly nowMs: number;
  }): ChildReclaimLeafKept[];
  export const CHILD_RECLAIM_LEAF_KEPT_MANY_WORD: ChildReclaimLeafKeptMany['word']; // = 'leaf-kept', Task 1's separate arm
  export function childReclaimLeafKeptManySentence(n: number): string;
  export function childReclaimLeafKeptList(items: readonly ChildReclaimLeafKeptAttention[]): ChildReclaimAttention[];
  export function childReclaimAttentionWithLeaves(
    list: readonly ChildReclaimAttention[], leaves: readonly ChildReclaimLeafKeptAttention[]): ChildReclaimAttention[];
  ```
- Produces, `server/src/coord/store.ts`. The row types are declared by their consumer, L1:
  ```ts
  static lifecycleReclaimRowsSinceSql(): string;
  lifecycleReclaimRowsSince(atMs: number): ChildReclaimLeafSourceRow[];
  static lifecycleLeafEndsSql(sessions: number): string;
  lifecycleLeafEndsFor(sessionIds: readonly string[]): Map<string, ChildReclaimLeafEndRow[]>;
  ```
- Produces, `server/src/coord/childReclaim.ts`:
  ```ts
  export const CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE = 'child reclaim leaf kept';
  export function childReclaimLeafKeptFeedBody(k: ChildReclaimLeafKept): string;
  export function recordChildReclaimLeafKeptFeed(
    deps: Pick<ChildReclaimDeps, 'coord' | 'notifyLog'>, k: ChildReclaimLeafKept): void;
  ```
- Produces, `server/src/watch.ts`: `private childReclaimLeaves: readonly ChildReclaimLeafKept[]` and `private readonly childReclaimLeafFed: Set<number>`. Neither has an accessor.
- For Task 8: `childReclaimPublishAttention` now wraps `childReclaimAttentionWithKept(…)` in `childReclaimAttentionWithLeaves(…, leaves)`. Task 8 does not edit this line: its `stuck` item reaches the wrap through `mirrorArms`. The leaf merge yields to any item that carries a `sessionId`, so a `stuck` item outranks a leaf item by construction, as the coordinator ruled (stuck outranks leaf-kept). This task's yield case pins that with a `stuck` item, using Task 1's L0 arm.
- For Task 8: `childReclaimDetailText` is declared HERE, in L1, because this task runs before Task 8 (W8-SEC-2). Task 8's stuck sentence imports it and declares no second copy.

**Departures (named by slug; the coordinator assigns numbers):**
- `leaf-kept-yields-to-a-live-item`. A leaf item is dropped when the list already holds any item for that id, including as a `kept-many` member. "One item per id" then holds across every arm, and the banner's React key (`a.sessionId`, `pwa/src/fleet/ChildReclaimBanner.tsx:148`) stays unique. A leaf item can only meet another item when the row still stands (purge-refused or purge-mechanism-absent) or a recycled slug's create is not placed yet. Its feed row is still written.
- `leaf-end-clock-guard`. An end (a create or a collect) counts only when it FOLLOWS the row: its mirror id is higher, and NOT `end.at !== null && end.at < row.at`. This is R75's clock guard on the purge, applied to the ends. Doubt keeps the item listed.
- `leaf-kept-ends-read`. The SOURCE is the one bounded read the ruling names. The ends need the ids' later `create`/`collect` `done` rows, which can lie outside a time window, so they come from a second read: one statement `INDEXED BY lifecycle_by_session` over the source's ids only.
- `leaf-kept-feed-row`. "The feed keeps the record" is made true by one `child reclaim leaf kept` feed row per source row per process. The row is recorded and never pushed, and it carries ccd's own `detail`. That `detail` is also what "the feed names it" means for a cut line: the encoder drops `meas` before `detail`, except in its last-resort line, which keeps neither (`ccd/ccd:4930-4939`, W8-SEC-3). So a cut line's sentence points at the feed row only when the row carries a `detail`. Otherwise it says ccd's line kept no detail either, and names where to look on the fleet box. The `detail` reaches the feed through `childReclaimDetailText` (W8-SEC-2): one line, control and bidi characters replaced, bounded by `LC_LINE_MAX`, because any session can append a journal line. A restart writes it once more (R44's precedent).
- `leaf-kept-null-run-stays-single`. Only items with a numeric `runId` collapse, because the PWA drops a member whose `runId` is not a number (`pwa/src/fleet/childReclaimWords.ts:85-89`). An item with no run (a purge failure, or a cut line) always lists singly, however many there are.
- `leaf-kept-undated-row-unlisted`. A reclaim row ccd journaled with no `at` is outside the `at >= ?` window, so it is never listed. It cannot be placed against the 7-day horizon either.
- `leaf-kept-feed-memory-unpruned`. `childReclaimLeafFed` holds one number per kept-leaf row this process has seen. Nothing prunes it, because an ended item never returns, and a prune would be a branch with no observable effect to pin.

- [ ] **Step 0: Entry conditions.** Run from the worktree root:

```bash
grep -n "  | 'collect'" shared/api.ts                                    # (a) wave 7's act: ONE line
grep -nE "export (function|const) leafKeptWord|export type LeafKeptWord\b" shared/api.ts   # (b) Task 1's classifier and its word type: TWO lines
grep -n "readonly kind: 'leaf-kept'" shared/api.ts                       # (c) Task 1's arm: ONE line
grep -n "^  readonly kind: 'kept-many'; readonly word: 'leaf-kept';$" shared/api.ts   # (d) ONE line: Task 1's ChildReclaimLeafKeptMany
grep -n "KEPT_LEAF_WORDS\|KeptLeafWord\|keptLeafWord\|EXPIRE_LEAF_WORDS\|export function expireLeafKept\|leafKeptWord" server/src/archivedExpiry.ts 2>/dev/null   # (e) WL5 on this branch? never its private names (H8)
grep -nF "'refused' | 'unmeasured' | 'in-use'" server/src/archivedExpiry.ts 2>/dev/null   # (e2) never a line: WL5's alias and LEAF_KEPT_WHY derive from LeafKeptWord (W8-SEC-1)
grep -n "export const laneFixture\|readonly exec?:\|readonly ccdVerbs?:\|readonly notifyLog?:\|readonly coord?:\|readonly home?:\|const journal = \|now: () => clock\|^let uidN" server/test/childReclaimGenerationFixture.ts   # (f) the shared lane rig (H7)
grep -n "export const CHILD_RECLAIM_PURGE_INCOMPLETE" server/src/coord/childReclaim.ts   # (g) Task 6's word: ONE line
```

(a) prints nothing → STOP and report: Task 0 brought wave 7's tree (H1); no merge mid-wave. Never declare `'collect'` here. If (b), (c) or (d) prints nothing, STOP and report to the coordinator: Task 1 owns every `shared/api.ts` insertion. (e) prints nothing unless workspace-lifecycle wave 5 (run 345) is on this branch. If it prints a line naming `KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord` or `EXPIRE_LEAF_WORDS`, STOP and report: the move is Task 1's (H8), and this task never makes it. (e2) prints a line → STOP and report the same way: Task 1's Step 4 (d) derives the `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s key type from `LeafKeptWord` (W8-SEC-1). If it prints `expireLeafKept` and a `leafKeptWord` line, Step 7 runs WL5's tests. (f) must print `export const laneFixture`; if the file is missing, STOP: Task 3 owes it. Its other lines say which of Step 1's rig additions an earlier task (Task 5) already made. (g) prints nothing → STOP: Task 6 has not landed.

**Who owns the classifier (H8, amended after 4045).** It is defined once, in `shared/api.ts`. WL5's plan at `f8ec01cc4` (plan file `docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md`, Task 9) declares the word half in `server/src/archivedExpiry.ts`: `KEPT_LEAF_WORDS` (a non-exported `as const` list), `KeptLeafWord` and `keptLeafWord`, with `ExpireLeafKept = KeptLeafWord | null | 'unreported'` and `LEAF_KEPT_WHY: Readonly<Record<KeptLeafWord, string>>`; `server/test/archived-expiry-policy.test.ts` imports `keptLeafWord`. Its word half answers exactly as `leafKeptWord` does (a word → itself, anything else, `null` included → `'unmeasured'`), and its carrier, `expireLeafKept`, asks absence and `null` first. Task 1 does all of wave 8's share:
- it declares the classifier in `shared/api.ts`, or, if WL5 landed first, MOVES WL5's word half there (quiet-river's consent, 4036 and 4045);
- it pins the classifier's behaviour and its one declaration, in `child-reclaim-attention-arms.test.ts`;
- if WL5 is on the branch at Task 0, in Task 1's own commit it deletes `KEPT_LEAF_WORDS`, `KeptLeafWord` and `keptLeafWord`, re-points `expireLeafKept` and `archived-expiry-policy.test.ts`, and derives the alias (`LeafKeptWord | null | 'unreported'`) and the record key (`Record<LeafKeptWord, string>`) from `LeafKeptWord`, because Task 1's census case reds WL5's private names, and any code line outside `shared/api.ts` that spells all three words, at that commit.

If wave 8 lands first, WL5's merge of `main` reds Task 1's census until WL5 makes those edits in its own merge commit. The reply to quiet-river's 4045 names them. This task only consumes the classifier and verifies (Step 0 (e), Step 7).

- [ ] **Step 1: Extend the shared lane rig, then write the failing tests.**

First, extend the shared lane rig (H7). `server/test/childReclaimGenerationFixture.ts` is Task 3's, and it is the ONE watcher rig: this task builds no second one. Step 0 (f) printed what it already has, because Task 5 may have added `exec`, `journal` and `now` first. Add each piece below that is missing, spelled exactly as here. A piece already there with this signature stays as it is. If an earlier task spelled one differently, use that spelling in this task's calls and never add a second. Every addition is an optional option or a new returned helper, so Task 3's, Task 4's and Task 5's cases run unchanged.

1. Import the feed log's type beside the other imports: `import type { NotifyLog } from '../src/notifylog.js';`.
2. Move the uid counter to MODULE scope, unless Step 0 (f) printed `let uidN` at column 0 (Task 5 moved it; leave it as it is, with Task 5's docstring). Delete `  let uidN = 0;` inside `laneFixture`, and declare it directly above `export const laneFixture` (EX3: Tasks 5, 7 and 9 give it this one placement):

```ts
/** ONE uid counter for every rig in a test file. The mirror's `uid` is UNIQUE and inserted OR IGNORE, so a
 *  restart rig over the same coord.db must never reuse one, and the journal cursor only rises. */
let uidN = 0;
```

3. Add to `LaneOpts`, after `afterRead`:

```ts
  /** Replaces the REAL executor. `requests` and `outcomes` still record each request and its answer. */
  readonly exec?: (req: ChildReclaimRequest) => ChildReclaimOutcome | Promise<ChildReclaimOutcome>;
  /** What the fleet advertises. Default: every verb and capability the sweep needs. */
  readonly ccdVerbs?: readonly string[];
  /** The feed's log, on deps. Default: none, as `testDeps` leaves it. */
  readonly notifyLog?: NotifyLog;
  /** A restart: an earlier rig's coord.db and fixture HOME. */
  readonly coord?: CoordStore;
  readonly home?: string;
```

4. In `laneFixture`:
- `const home = mkTmp('ccrc-child-reclaim-generation-lane-');` becomes `const home = opts.home ?? mkTmp('ccrc-child-reclaim-generation-lane-');`.
- `const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));` becomes `const coord = opts.coord ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));`.
- In the `fleetState` literal, `ccdVerbs: ['ws-audit', 'ws-reclaim', 'ws-release', RECLAIM_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP] };` becomes `ccdVerbs: [...(opts.ccdVerbs ?? ['ws-audit', 'ws-reclaim', 'ws-release', RECLAIM_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP])] };`.
- In `deps`, add `...(opts.notifyLog === undefined ? {} : { notifyLog: opts.notifyLog }),` after `monotonicMs: () => mono,`. In `childReclaimExec`, the statement `const o = await base.queue.run(req.sessionId, () => reclaimChild(` and its next line become:

```ts
      const o = opts.exec !== undefined ? await opts.exec(req) : await base.queue.run(req.sessionId, () => reclaimChild(
        { coord, io, cfg, runCcd: base.runCcd, fleetState, presence }, req));
```

- Directly above `plant`, add `journal`, unless Step 0 (f) printed `const journal = ` (Task 5 added it after `remint`, with this signature; leave it). The signature is H7's, exactly: `journal = (id: string, act: string, outcome: string, over: Readonly<Record<string, unknown>> = {}): void` (EX3).

```ts
  /** One lifecycle line into the mirror, at the rig's wall clock unless `over` says otherwise. */
  const journal = (id: string, act: string, outcome: string, over: Readonly<Record<string, unknown>> = {}): void => {
    uidN += 1;
    const line = JSON.stringify({ uid: `w8.1.${uidN}`, at: clock, act, outcome, id, ...over });
    coord.ingestJournal({ gen: '1790000000000000000', rows: [parseJournalLine(line)], cursor: uidN * 200,
      size: uidN * 200, at: clock });
  };
```

  In `plant`, if it still holds them, the four lines from `uidN += 1;` through `size: uidN * 200, at: clock });` become `journal(id, 'create', 'done', { verb: 'ws-add' });`.
- Add to the returned object each of these names that is not already a key of it: `home`, `journal`, `now: () => clock` (EX3). Task 5 put `journal` there already. A name written twice is TS1117 (`An object literal cannot have multiple properties with the same name`), which `typecheck-tests` reds.

Run `( cd server && ./node_modules/.bin/vitest run test/child-reclaim-licence-lane.test.ts test/child-reclaim-hold-retired-generation.test.ts )`. Expected: green, with the counts Tasks 3 and 4 left. The rig change alone changes no case.

Then create `server/test/child-reclaim-leaf-kept.test.ts`:

```ts
// Child-reclamation wave 8: the kept leaves (spec §5.6, §5.9). ccd's shared reclaim tail keeps a
// clips directory or a temp root it cannot prove gone and journals the word on the reclaim's `done`
// row, or on a purge failure's. After a `done` the registry row is gone, so no arm that reads the
// listing can name the child: this item comes from the lifecycle mirror alone. The word classifier,
// `leafKeptWord`, is Task 1's and is pinned in Task 1's test (H8); this file only reads through it.
import { describe, it, expect } from 'vitest';
import {
  CHILD_RECLAIM_KEPT_WORDS, LC_LINE_MAX, type ChildReclaimAttention, type ChildReclaimLeafKeptAttention,
  type LifecycleOutcome,
} from '../../shared/api.js';
import { reviveMeas } from '../src/coord/journalparse.js';
import { CHILD_RECLAIM_PURGE_INCOMPLETE, childReclaimLeafKeptFeedBody } from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_LEAF_FAILED_TOKENS, CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS,
  CHILD_RECLAIM_LEAF_KEPT_MANY_WORD, childReclaimAttentionWithLeaves, childReclaimDetailText, childReclaimLeafKept,
  childReclaimLeafKeptManySentence, childReclaimLeafKeptSince, childReclaimMirrorLeaf,
  type ChildReclaimLeafEndRow, type ChildReclaimLeafSourceRow,
} from '../src/childReclaimSweep.js';
const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
const ID = 'demo-gone';

let mid = 1000;
const src = (o: {
  sessionId?: string; outcome?: LifecycleOutcome; refusal?: string | null; at?: number; truncated?: boolean;
  meas?: Record<string, unknown> | null; detail?: string | null;
} = {}): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId: o.sessionId ?? ID, at: o.at ?? NOW - DAY, outcome: o.outcome ?? 'done',
  refusal: o.refusal ?? null, truncated: o.truncated ?? false,
  meas: o.meas === null ? null : reviveMeas(o.meas ?? {}), detail: o.detail ?? null,
});
const ends = (rows: readonly ChildReclaimLeafEndRow[]): Map<string, readonly ChildReclaimLeafEndRow[]> =>
  new Map([[ID, rows]]);
const derive = (rows: readonly ChildReclaimLeafSourceRow[],
  e: ReadonlyMap<string, readonly ChildReclaimLeafEndRow[]> = new Map()) =>
  childReclaimLeafKept({ rows, ends: e, nowMs: NOW });

const HORIZON = 'This line ends when the id is used for a new workspace, or 7 days after ccd recorded the reclaim; '
  + 'the feed keeps the record.';
const KEPT_TAIL = 'What was kept stays on disk and ccrc deletes nothing more of it; a person removes it once nothing '
  + 'still uses it.';
const TMP_IN_USE = 'The reclaim of this child completed, but ccd kept its temp root ~/.cc-tmp/demo-gone (in-use: a '
  + `process still used it after the bounded wait). ${KEPT_TAIL} The temp root leaves this line once it is collected. `
  + HORIZON;
const CLIPS_REFUSED = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + `(refused: its removal helper refused it). ${KEPT_TAIL} ${HORIZON}`;
const BOTH = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + '(unmeasured: whether it could be removed could not be measured) and its temp root ~/.cc-tmp/demo-gone '
  + `(refused: its removal helper refused it). ${KEPT_TAIL} The temp root leaves this line once it is collected. `
  + HORIZON;
const CUT = 'The reclaim of this child completed, but the journal line ccd wrote for it was cut to fit, so whether '
  + 'its clips directory or its temp root was kept is not known; the feed row for it carries what ccd said.';
const TRUNCATED = `${CUT} ${HORIZON}`;
const TRUNCATED_COLLECTED = `${CUT} Its temp root has since been collected. ${HORIZON}`;
/** W8-SEC-3: a cut line whose `detail` is gone too, ccd's last-resort line, never points at the feed. */
const CUT_BARE = 'The reclaim of this child completed, but the journal line ccd wrote for it was cut to fit, so whether '
  + "its clips directory or its temp root was kept is not known; ccd's line kept no detail either, so the feed "
  + 'cannot name it; look for ~/.cc-clips/demo-gone and ~/.cc-tmp/demo-gone on the fleet box.';

describe('childReclaimMirrorLeaf — the mirror reader: kept:<word>, none-or-unreported, truncated', () => {
  it('reads a word on the key as kept', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'kept', word: 'in-use' });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'none-or-unreported' });
  });

  it('reads a value ccd does not print as kept, unmeasured', () => {
    expect(childReclaimMirrorLeaf(src({ meas: { clipsKept: 'held-open' } }), 'clipsKept'))
      .toEqual({ kind: 'kept', word: 'unmeasured' });
  });

  it('reads an absent key as none-or-unreported: the encoder omits an empty value, and an older ccd wrote none', () => {
    const r = src({ meas: { childOf: '41' } });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'none-or-unreported' });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'none-or-unreported' });
  });

  it('reads a line cut to fit that lost its meas as truncated, on both keys', () => {
    const r = src({ truncated: true, meas: null });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'truncated' });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'truncated' });
  });

  it('reads a line with no meas that was not cut as none-or-unreported', () => {
    expect(childReclaimMirrorLeaf(src({ meas: null }), 'tmpRootKept')).toEqual({ kind: 'none-or-unreported' });
  });

  it('reads a cut line that kept its meas from its meas: the encoder drops meas last', () => {
    const r = src({ truncated: true, meas: { clipsKept: 'refused' } });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'kept', word: 'refused' });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'none-or-unreported' });
  });
});

describe('childReclaimLeafKept — one item per id, from its latest reclaim row that carries the keys', () => {
  it('lists a done row that kept the temp root, with the minting run, ccd\'s at, the sentence and ccd\'s line', () => {
    const r = src({ meas: { childOf: '41', tmpRootKept: 'in-use' }, detail: 'temp root kept (in-use): pid 7' });
    expect(derive([r])).toEqual([{
      item: { kind: 'leaf-kept', sessionId: ID, runId: 41, sentence: TMP_IN_USE, at: NOW - DAY },
      source: r.id, detail: 'temp root kept (in-use): pid 7',
    }]);
  });

  it('lists both leaves in one item', () => {
    const got = derive([src({ meas: { childOf: '41', clipsKept: 'unmeasured', tmpRootKept: 'refused' } })]);
    expect(got.map((k) => k.item.sentence)).toEqual([BOTH]);
  });

  it('raises nothing for a done row that kept nothing, or whose ccd did not say', () => {
    expect(derive([src({ meas: { childOf: '41' } }), src({ sessionId: 'demo-b', meas: null })])).toEqual([]);
  });

  it('lists the three purge failures, whose act completed, and no other failure or refusal', () => {
    expect([...CHILD_RECLAIM_LEAF_FAILED_TOKENS]).toEqual(['purge-incomplete', 'purge-mechanism-absent', 'purge-refused']);
    const kept = { tmpRootKept: 'unmeasured' };
    const rows = [
      ...CHILD_RECLAIM_LEAF_FAILED_TOKENS.map((t, k) => src({ sessionId: `demo-p${k}`, outcome: 'failed', refusal: t, meas: kept })),
      src({ sessionId: 'demo-x', outcome: 'failed', refusal: 'worktree-remove-failed', meas: kept }),
      src({ sessionId: 'demo-y', outcome: 'failed', refusal: null, meas: kept }),
      src({ sessionId: 'demo-z', outcome: 'refused', refusal: 'purge-refused', meas: kept }),
    ];
    expect(derive(rows).map((k) => k.item.sessionId)).toEqual(['demo-p0', 'demo-p1', 'demo-p2']);
  });

  it('the purge-failure set holds Task 6\'s purge-incomplete word: L1 spells it, typed against L0, and this ties the two', () => {
    expect(CHILD_RECLAIM_LEAF_FAILED_TOKENS as readonly string[]).toContain(CHILD_RECLAIM_PURGE_INCOMPLETE);
  });

  it('lists a line cut to fit, with no run and its own sentence', () => {
    const r = src({ truncated: true, meas: null, detail: 'clips kept (refused)' });
    expect(derive([r])).toEqual([{
      item: { kind: 'leaf-kept', sessionId: ID, runId: null, sentence: TRUNCATED, at: NOW - DAY }, source: r.id,
      detail: 'clips kept (refused)',
    }]);
  });

  it('a line cut to fit that kept no detail either never points at the feed: it names where to look (W8-SEC-3)', () => {
    for (const detail of [null, '']) {
      const got = derive([src({ truncated: true, meas: null, detail })]);
      expect(got.map((k) => k.item.sentence), JSON.stringify(detail)).toEqual([`${CUT_BARE} ${HORIZON}`]);
      expect(got[0]!.item.sentence).not.toContain('carries what ccd said');
    }
  });

  it('reads the LATEST row of the id by the mirror\'s id: a later done that kept nothing ends an earlier kept one', () => {
    const kept = src({ outcome: 'failed', refusal: 'purge-refused', meas: { tmpRootKept: 'in-use' } });
    const clean = src({ meas: { childOf: '41' } });
    expect(derive([kept, clean])).toEqual([]);
    expect(derive([clean, kept]), 'array order decided "latest"').toEqual([]);
  });

  it('takes the run from childOf only when it is a run id', () => {
    const run = (childOf?: string): number | null =>
      derive([src({ meas: { tmpRootKept: 'in-use', ...(childOf === undefined ? {} : { childOf }) } })])[0]!.item.runId;
    expect(run('41')).toBe(41);
    for (const v of ['0', 'x', '12345678901', undefined]) expect(run(v), String(v)).toBeNull();
  });
});

describe('how the item ends', () => {
  it('a later PLACED create of the id ends both halves', () => {
    const r = src({ meas: { clipsKept: 'refused', tmpRootKept: 'in-use' } });
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: NOW - 1 }]))).toEqual([]);
  });

  it('a create that is not placed ends nothing: no at, or an at ahead of the server clock', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: null }]))).toHaveLength(1);
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: NOW + 1 }]))).toHaveLength(1);
  });

  it('a create that does not follow the row ends nothing: ccd\'s own clock puts it first, or the mirror holds it earlier', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: r.at - 1 }])), 'clock').toHaveLength(1);
    expect(derive([r], ends([{ id: r.id - 1, act: 'create', at: r.at + 1 }])), 'mirror id').toHaveLength(1);
  });

  it('a later collect ends the temp-root half only, never the clips half', () => {
    const tmpOnly = src({ meas: { childOf: '41', tmpRootKept: 'in-use' } });
    expect(derive([tmpOnly], ends([{ id: tmpOnly.id + 1, act: 'collect', at: NOW - 1 }]))).toEqual([]);
    const both = src({ meas: { childOf: '41', clipsKept: 'refused', tmpRootKept: 'in-use' } });
    expect(derive([both], ends([{ id: both.id + 1, act: 'collect', at: NOW - 1 }])).map((k) => k.item.sentence))
      .toEqual([CLIPS_REFUSED]);
    const cut = src({ truncated: true, meas: null, detail: 'clips kept (refused)' });
    expect(derive([cut], ends([{ id: cut.id + 1, act: 'collect', at: null }])).map((k) => k.item.sentence))
      .toEqual([TRUNCATED_COLLECTED]);
  });

  it('a collect that does not follow the row ends nothing', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    for (const e of [{ id: r.id + 1, act: 'collect' as const, at: r.at - 1 }, { id: r.id - 1, act: 'collect' as const, at: r.at + 1 }]) {
      expect(derive([r], ends([e])).map((k) => k.item.sentence), JSON.stringify(e)).toEqual([TMP_IN_USE]);
    }
  });

  it('ends 7 days after ccd\'s line: listed at the horizon, gone a millisecond past it', () => {
    expect(CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS).toBe(7 * DAY);
    expect(childReclaimLeafKeptSince(NOW)).toBe(NOW - 7 * DAY);
    expect(derive([src({ at: NOW - 7 * DAY, meas: { tmpRootKept: 'in-use' } })])).toHaveLength(1);
    expect(derive([src({ at: NOW - 7 * DAY - 1, meas: { tmpRootKept: 'in-use' } })])).toEqual([]);
  });
});

describe('on the list: one item per child, and the collapse', () => {
  const item = (sessionId: string, runId: number | null = 41): ChildReclaimLeafKeptAttention =>
    ({ kind: 'leaf-kept', sessionId, runId, sentence: `s ${sessionId}`, at: NOW });

  it('a leaf item yields to any item the list already holds for the id, a stuck item and a kept-many member included', () => {
    const list: ChildReclaimAttention[] = [
      { kind: 'terminal', sessionId: 'demo-t', runId: 1, token: 'tree-unreadable', sentence: 't', at: NOW },
      { kind: 'failing', sessionId: 'demo-f', runId: 2, token: 'pin-failed', sentence: 'f', at: NOW },
      { kind: 'stuck', sessionId: 'demo-s', runId: 5, token: 'containment-refuted', sentence: 's', at: NOW },
      { kind: 'kept', sessionId: 'demo-k', runId: 3, word: 'coordinating', sentence: 'k' },
      { kind: 'kept-many', word: 'minting-run-absent', members: [{ sessionId: 'demo-m', runId: 4 }], sentence: 'm' },
    ];
    const leaves = ['demo-t', 'demo-f', 'demo-s', 'demo-k', 'demo-m', 'demo-new'].map((id) => item(id));
    expect(childReclaimAttentionWithLeaves(list, leaves)).toEqual([...list, item('demo-new')]);
  });

  it(`collapses more than ${CHILD_RECLAIM_KEPT_MANY_OVER} items with a run into one line of its own word; an item with no run stays single`, () => {
    const six = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f'].map((id) => item(id));
    const orphan = item('demo-0', null);
    expect(childReclaimAttentionWithLeaves([], [...six, orphan].reverse())).toEqual([
      orphan,
      { kind: 'kept-many', word: 'leaf-kept', members: six.map((a) => ({ sessionId: a.sessionId, runId: 41 })),
        sentence: childReclaimLeafKeptManySentence(6) },
    ]);
    expect(childReclaimLeafKeptManySentence(6)).toBe('6 reclaimed child workspaces have a clips directory or a temp '
      + 'root that ccd kept on disk. Each stays until a person removes it, and the feed row of each names what was '
      + 'kept and why. Each one leaves this line when its id is used for a new workspace, or 7 days after ccd '
      + 'recorded its reclaim.');
  });

  it('five with a run and any number without stay single, ordered by session id', () => {
    const five = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e'].map((id) => item(id));
    const loose = [item('demo-x', null), item('demo-y', null)];
    expect(childReclaimAttentionWithLeaves([], [...loose, ...five])).toEqual([...five, ...loose]);
  });

  it('its collapse word is no kept word, so its line never shares a key with another kept-many line', () => {
    expect(CHILD_RECLAIM_LEAF_KEPT_MANY_WORD).toBe('leaf-kept');
    expect(CHILD_RECLAIM_KEPT_WORDS as readonly string[]).not.toContain(CHILD_RECLAIM_LEAF_KEPT_MANY_WORD);
  });
});

describe('childReclaimDetailText — ccd’s detail as one bounded plain line (W8-SEC-2)', () => {
  // Built from code points, never written as escapes: an agent's file write decodes a backslash-u escape.
  const NL = String.fromCharCode(10);
  const RLO = String.fromCharCode(0x202e);
  const LONG = `${'x'.repeat(10)}${NL}${RLO}${'y'.repeat(9988)}`;
  const leaf = (detail: string | null) => ({
    item: { kind: 'leaf-kept' as const, sessionId: ID, runId: null, sentence: 's.', at: NOW }, source: 1, detail });

  it('a 10,000-character detail holding a newline and a bidi override reads as one line of at most LC_LINE_MAX + 1 characters', () => {
    expect(LONG).toHaveLength(10_000);
    const t = childReclaimDetailText(LONG);
    expect(t.includes(NL), 'a newline').toBe(false);
    expect(t.includes(RLO), 'a bidi override').toBe(false);
    expect(t.startsWith(`${'x'.repeat(10)} y`), 'one run of unsafe characters is one space').toBe(true);
    expect(t).toHaveLength(LC_LINE_MAX + 1);
    expect(t.endsWith('…')).toBe(true);
    expect(childReclaimDetailText('temp root kept (in-use): pid 7')).toBe('temp root kept (in-use): pid 7');
    expect(childReclaimDetailText(`${NL}${RLO}`)).toBe('');
    expect(childReclaimLeafKeptFeedBody(leaf(LONG))).toBe(`${ID}: s. ccd recorded: ${t}`);
    expect(childReclaimLeafKeptFeedBody(leaf(NL))).toBe(`${ID}: s. ccd recorded no detail.`);
  });
});
```

Create `server/test/child-reclaim-leaf-kept-store.test.ts`:

```ts
// Child-reclamation wave 8: the kept-leaf item's two store reads (spec §5.9). The table is NEVER PRUNED
// (schema.ts), so the source read is bounded by a time window through `lifecycle_by_at`, and the ends
// read is bounded by the source's own ids through `lifecycle_by_session` — each ONE statement.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { StatementSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { CHILD_RECLAIM_LEAF_FAILED_TOKENS } from '../src/childReclaimSweep.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cr-leaf-store-'), '.ccrc', 'coord.db')));
const GEN = '1790000000000000000';
const T = 1_790_000_000_000;
const SINCE = T - 7 * 86_400_000;

let seq = 0;
const line = (id: string, act: string, outcome: string, at: number | null,
  over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({ uid: `w8leafst.1.${++seq}`, ...(at === null ? {} : { at }), act, outcome, id, ...over }));
const ingest = (s: CoordStore, rows: JournalRow[]): void => {
  s.ingestJournal({ gen: GEN, rows, cursor: 100 * rows.length, size: 100 * rows.length, at: 9 });
};
const kept = { meas: { childOf: '41', tmpRootKept: 'in-use' } };
const seed = (s: CoordStore): void => ingest(s, [
  line('demo-a', 'reclaim', 'done', T, { verb: 'ws-reclaim', ...kept, detail: 'kept' }),
  line('demo-b', 'reclaim', 'failed', T, { refusal: 'purge-incomplete', meas: { clipsKept: 'refused' } }),
  line('demo-c', 'reclaim', 'done', SINCE, { truncated: true }),                     // at the bound, cut to fit
  line('demo-d', 'reclaim', 'done', SINCE - 1, kept),                               // before the bound
  line('demo-e', 'reclaim', 'done', null, kept),                                     // undated
  line('demo-f', 'expire', 'done', T, kept),                                         // the shared tail's other act
  line('demo-g', 'reclaim', 'failed', T, { refusal: 'worktree-remove-failed', ...kept }),
  line('demo-h', 'reclaim', 'refused', T, { refusal: 'purge-refused', ...kept }),
  line('demo-i', 'reclaim', 'intent', T, kept),
  line('demo-j', 'reclaim', 'done', T),                                              // no meas, not cut
]);

describe('CoordStore.lifecycleReclaimRowsSince — the kept-leaf source, one bounded read', () => {
  it('returns the done and the three purge-failure reclaim rows at or after the bound that carry meas or were cut', () => {
    const s = store();
    seed(s);
    expect(s.lifecycleReclaimRowsSince(SINCE).map((r) => r.sessionId)).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });

  it('carries the mirror\'s id, ccd\'s at, the outcome, the token, the cut flag, the meas and ccd\'s line, unnarrowed', () => {
    const s = store();
    seed(s);
    const got = s.lifecycleReclaimRowsSince(SINCE);
    expect(got[0]).toMatchObject({ sessionId: 'demo-a', at: T, outcome: 'done', refusal: null, truncated: false, detail: 'kept' });
    expect(got[0]!.meas).toMatchObject({ childOf: '41', tmpRootKept: 'in-use', clipsKept: null });
    expect(got[1]).toMatchObject({ sessionId: 'demo-b', outcome: 'failed', refusal: 'purge-incomplete' });
    expect(got[2]).toMatchObject({ sessionId: 'demo-c', at: SINCE, truncated: true, meas: null });
    const ids = got.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(3);
  });

  it('seeks lifecycle_by_at, forced by a hint, never a scan of the table', () => {
    const s = store();
    seed(s);
    expect(CoordStore.lifecycleReclaimRowsSinceSql()).toContain('INDEXED BY lifecycle_by_at');
    const plan = s.db.prepare(`EXPLAIN QUERY PLAN ${CoordStore.lifecycleReclaimRowsSinceSql()}`)
      .all(SINCE, 'reclaim', 'done', 'failed', ...CHILD_RECLAIM_LEAF_FAILED_TOKENS) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' | ')).toContain('USING INDEX lifecycle_by_at');
  });
});

describe('CoordStore.lifecycleLeafEndsFor — what may end a kept-leaf item', () => {
  it('answers every asked id, with only its create and collect done rows, oldest first, carrying the mirror id', () => {
    const s = store();
    ingest(s, [
      line('demo-a', 'create', 'done', T),
      line('demo-a', 'create', 'refused', T + 1, { refusal: 'slug-taken' }),
      line('demo-a', 'create', 'intent', T + 2),
      line('demo-a', 'collect', 'done', null),
      line('demo-a', 'collect', 'refused', T + 3, { refusal: 'quarantine-kept' }),
      line('demo-a', 'reclaim', 'done', T + 4),
      line('demo-b', 'create', 'done', T + 5),
    ]);
    const got = s.lifecycleLeafEndsFor(['demo-a', 'demo-c']);
    expect([...got.keys()].sort()).toEqual(['demo-a', 'demo-c']);
    expect(got.get('demo-a')!.map((e) => [e.act, e.at])).toEqual([['create', T], ['collect', null]]);
    expect(got.get('demo-a')![0]!.id).toBeLessThan(got.get('demo-a')![1]!.id);
    expect(got.get('demo-c')).toEqual([]);
  });

  it('spends ONE statement for each read whatever the id count, and nothing for an empty ends request', () => {
    const s = store();
    seed(s);
    const prepare = vi.spyOn(s.db, 'prepare');
    const all = vi.spyOn(StatementSync.prototype, 'all');
    try {
      expect(s.lifecycleLeafEndsFor([])).toEqual(new Map());
      expect(prepare).not.toHaveBeenCalled();
      s.lifecycleLeafEndsFor(['demo-a', 'demo-b', 'demo-c', 'demo-a']);
      s.lifecycleReclaimRowsSince(SINCE);
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(all).toHaveBeenCalledTimes(2);
    } finally {
      all.mockRestore();
      prepare.mockRestore();
    }
  });
});
```

Create `server/test/child-reclaim-leaf-kept-lane.test.ts`:

```ts
// Child-reclamation wave 8: the kept-leaf item at the lane (spec §5.6, §5.9). Only the lane can show
// these: the item reaches the coord frame for a child that the registry no longer lists, on every pass
// (paused and capability-less passes included). It survives its own read's failure without failing the
// pass shut. A failed fail-shut read publishes nothing. A restart rebuilds the item, and the feed
// records it once per row per process. The rig is Task 3's shared `laneFixture` (H7), with this file's
// feed log, its executor stub and its kept-leaf moments; this file builds no FleetWatcher of its own.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoordStore } from '../src/coord/store.js';
import { ACTOR_FLAGS_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE, type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { G1, laneFixture } from './childReclaimGenerationFixture.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const GONE = 'demo-gone';
const CCD_LINE = `temp root /h/.cc-tmp/${GONE} kept (in-use): pid 7 holds it`;

/** Every request answers reclaimed: these cases read only WHICH child was asked. */
const reclaimed = async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> =>
  ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });

/** The shared rig with a feed log. `cap: false` is a fleet that does not advertise the reclaim capability.
 *  `coord`, `home` and `notifyLog` from an earlier rig make a restart over the same coord.db; the rig's
 *  module-wide uid counter keeps its journal lines new. */
const fixture = async (o: { cap?: boolean; coord?: CoordStore; home?: string; notifyLog?: NotifyLog } = {}) => {
  const home = o.home ?? mkTmp('ccrc-cr-leaf-lane-');
  let notifyLog = o.notifyLog;
  if (notifyLog === undefined) {
    notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
  }
  const f = laneFixture({ home, coord: o.coord, notifyLog, exec: reclaimed,
    ccdVerbs: o.cap === false ? ['ws-audit', 'ws-reclaim', 'ws-release', RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP] : undefined });
  /** A reclaim ccd COMPLETED, keeping the temp root: ccd purged the row, so the registry lists nothing for it. */
  const reclaimedKeepingTmp = (): void => f.journal(GONE, 'reclaim', 'done',
    { verb: 'ws-reclaim', meas: { childOf: '41', tmpRootKept: 'in-use' }, detail: CCD_LINE });
  /** The frame at the clock the last pass stamped, so `tick()`'s own sweep dispatch is throttled. */
  const attention = async () => { await f.watcher.tick(); return f.watcher.currentCoord()?.childReclaimAttention; };
  const fed = () => f.coord.feedEvents(50).filter((e) => e.title === CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE);
  return { ...f, home, notifyLog, reclaimedKeepingTmp, attention, fed };
};

describe('the kept-leaf item at the lane', () => {
  it('lists a reclaimed child that no listing names, from the mirror, and feeds it ONCE', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    const at = f.now();
    await f.pass();
    const items = await f.attention();
    expect(items).toEqual([{ kind: 'leaf-kept', sessionId: GONE, runId: 41, at,
      sentence: expect.stringContaining(`its temp root ~/.cc-tmp/${GONE} (in-use: `) }]);
    f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.fed()).toHaveLength(1);
    expect(f.fed()[0]).toMatchObject({ kind: 'run', sessionId: GONE, runId: 41 });
    const sentence = (items![0] as { sentence: string }).sentence;
    expect(f.fed()[0]!.body).toBe(`${GONE}, child of run #41: ${sentence} ccd recorded: ${CCD_LINE}`);
  });

  it('is listed on a paused pass and on a capability-less pass: it is derived before both early returns', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    await f.pass();
    expect(await f.attention()).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE })]);
    const g = await fixture({ cap: false });
    g.reclaimedKeepingTmp();
    await g.pass();
    expect(await g.attention()).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE })]);
  });

  it('a failed kept-leaf read keeps the last items and fails nothing shut: the live child is still asked', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    f.finishedChild('demo-a', G1);
    await f.pass();                                                   // the item listed; demo-a sighted once
    const before = await f.attention();
    expect(before).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE })]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(f.coord, 'lifecycleReclaimRowsSince').mockImplementation(() => { throw new Error('mirror busy'); });
    f.next(); await f.pass();
    expect(f.requests.map((r) => r.sessionId), 'a failed display read failed the pass shut').toEqual(['demo-a']);
    expect(await f.attention()).toEqual(before);
    expect(warn.mock.calls.map((c) => String(c[0])))
      .toContainEqual(expect.stringContaining('could not read the kept leaves (mirror busy)'));
  });

  it('a failed fail-shut read publishes nothing and never asks for the kept leaves', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    await f.pass();
    const before = await f.attention();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(f.coord, 'childReclaimSessionIds').mockImplementation(() => { throw new Error('mirror unreadable'); });
    const leaf = vi.spyOn(f.coord, 'lifecycleReclaimRowsSince');
    f.next(); await f.pass();
    expect(leaf).not.toHaveBeenCalled();
    expect(await f.attention()).toEqual(before);
  });

  it('a restart lists it on its first pass, and writes exactly one more row', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    await f.pass();
    expect(f.fed()).toHaveLength(1);
    const g = await fixture({ coord: f.coord, home: f.home, notifyLog: f.notifyLog });
    await g.pass();
    expect(await g.attention()).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE, runId: 41 })]);
    expect(g.fed()).toHaveLength(2);
    g.next(); await g.pass();
    expect(g.fed(), 'one process fed one row twice').toHaveLength(2);
  });

  it('a later placed create of the id ends it, and the feed keeps the record', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    await f.pass();
    f.next();
    f.journal(GONE, 'create', 'done', { verb: 'ws-add' });
    await f.pass();
    expect(await f.attention()).toEqual([]);
    expect(f.fed()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-leaf-kept.test.ts \
  test/child-reclaim-leaf-kept-store.test.ts test/child-reclaim-leaf-kept-lane.test.ts
```

Expected: FAIL.
- `child-reclaim-leaf-kept`: every case (26, re-measure (R-j): the drafted 24 plus W8-SEC-3's cut-without-detail case and W8-SEC-2's detail-text case) fails on an export this task adds. The file has no classifier case: Task 1 pins it (H8). For example, `TypeError: (0 , __vi_import_…__.childReclaimMirrorLeaf) is not a function`, and `TypeError: undefined is not iterable` for `CHILD_RECLAIM_LEAF_FAILED_TOKENS`.
- `child-reclaim-leaf-kept-store`: every case fails with `TypeError: s.lifecycleReclaimRowsSince is not a function`, or `…lifecycleLeafEndsFor is not a function`, or `CoordStore.lifecycleReclaimRowsSinceSql is not a function`.
- `child-reclaim-leaf-kept-lane`: case 1 fails with `expected [] to deeply equal [ { kind: 'leaf-kept', … } ]`. Cases 3 and 4 fail in `vi.spyOn` (`lifecycleReclaimRowsSince does not exist`). Case 5 fails with `expected [] to have a length of 1`.

None passes by accident. A missing Task 1 or Task 6 export is Step 0's STOP, never a red here.

- [ ] **Step 3: Implement L1.** In `server/src/childReclaimSweep.ts`, extend the `../../shared/api.js` import (`grep -n "CHILD_RECLAIM_KEPT_WORDS, SPAWN_STALL_MS, TERMINAL_RUN_STATES" server/src/childReclaimSweep.ts`) with `CHILD_RUN_ID, LC_LINE_MAX, leafKeptWord, type ChildReclaimLeafKeptAttention, type ChildReclaimLeafKeptMany, type LeafKeptWord, type LifecycleMeas`. Then insert directly after `childReclaimFeedQuiet`'s closing brace:

```ts
// ── Kept leaves (spec §5.6, §5.9) ─────────────────────────────────────────────
//
// ccd's shared reclaim tail keeps a clips directory or a temp root it cannot prove gone, and journals the
// word on the reclaim's `done` row and on the three purge failures, whose act also completed. After a
// `done` ccd has purged the registry row, so this item is derived from the lifecycle mirror alone and
// never filtered by the listing. A REPORT, gating nothing: no verdict, due set, lease or request reads it.

/** The characters ccd's journal `detail` may not carry onto a banner, a chip or a feed row (W8-SEC-2): the C0
 *  controls (a newline among them), DEL and the C1 controls, the two Unicode line and paragraph separators, and the
 *  bidi embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069), which reorder what an operator
 *  reads. Spelled as code points, so no escape sits here for a file write to decode. */
const detailUnsafe = (c: number): boolean =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029
  || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

/** ccd's journal `detail` as banner, chip and feed text (W8-SEC-2): ONE plain line, bounded. The mirror reads
 *  whole lines, `journalparse.ts` takes `detail` as any string, and any session can append a line, so the server
 *  re-imposes what only ccd's encoder enforces. Each run of `detailUnsafe` characters becomes one space, the ends
 *  are trimmed, and past `LC_LINE_MAX` code points (ccd's own line cap, L0) the text is cut and ends in an
 *  ellipsis. Pure. Declared here because this task runs before Task 8, whose stuck sentence calls it too. */
export function childReclaimDetailText(d: string): string {
  let one = '';
  let gap = false;
  for (const ch of d) {
    if (detailUnsafe(ch.codePointAt(0) ?? 0)) { gap = true; continue; }
    if (gap && one !== '') one += ' ';
    gap = false;
    one += ch;
  }
  const cps = [...one.trim()];
  return cps.length <= LC_LINE_MAX ? cps.join('') : `${cps.slice(0, LC_LINE_MAX).join('')}…`;
}

/** The `reclaim` FAILURE tokens whose row carries the two kept-leaf keys: the act completed, and only the
 *  registry purge after it failed. Spelled once, here, and bound by the store's read, never written as a
 *  quoted literal under `coord/`. L1 imports L0 alone, so it cannot import `CHILD_RECLAIM_PURGE_INCOMPLETE`
 *  (Task 6, `coord/childReclaim.ts`); each token is typed against L0's `LcRefusalToken`, and a test case ties
 *  this set to Task 6's word. */
export const CHILD_RECLAIM_LEAF_FAILED_TOKENS =
  ['purge-incomplete', 'purge-mechanism-absent', 'purge-refused'] as const satisfies readonly LcRefusalToken[];

/** How long a kept-leaf item stands after ccd's line (spec §5.9). Past it, the feed row is the record. */
export const CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS = 7 * 24 * 3_600_000;

/** The oldest `at` the kept-leaf read asks for: the store read's bound and this file's horizon, one number. */
export const childReclaimLeafKeptSince = (nowMs: number): number => nowMs - CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS;

/** One `reclaim` row the kept-leaf source read returns (`CoordStore.lifecycleReclaimRowsSince`), declared
 *  HERE by its consumer. `id` is the mirror's own row id, which orders; `at` is ccd's clock and never
 *  null, because the read's window cannot place an undated row. `meas` and `truncated` arrive as the
 *  mirror holds them: `null` with `truncated` means the line was cut, and `null` without it means
 *  nothing was measured. */
export interface ChildReclaimLeafSourceRow {
  readonly id: number;
  readonly sessionId: string;
  readonly at: number;
  readonly outcome: LifecycleOutcome;
  readonly refusal: string | null;
  readonly truncated: boolean;
  readonly meas: LifecycleMeas | null;
  readonly detail: string | null;
}

/** A row that may END a kept-leaf item (`CoordStore.lifecycleLeafEndsFor`): a `done` `create` or `collect`
 *  of the id, with the mirror's id and ccd's nullable clock. */
export interface ChildReclaimLeafEndRow {
  readonly id: number;
  readonly act: Extract<LifecycleAct, 'create' | 'collect'>;
  readonly at: number | null;
}

/** What the MIRROR says of one leaf. There are three answers, never folded:
 *  - `kept`, with ccd's word;
 *  - `none-or-unreported`: the encoder omits an empty value, and an older ccd wrote none, so on the
 *    mirror "nothing kept" and "not reported" are one fact;
 *  - `truncated`: the line was cut to fit and lost its whole `meas`, so whether a leaf was kept is not
 *    known.
 *  The stdout reader (workspace lifecycle's) gives absence another meaning and keeps its own answers.
 *  Only the word classifier is shared. */
export type ChildReclaimMirrorLeaf =
  | { readonly kind: 'kept'; readonly word: LeafKeptWord }
  | { readonly kind: 'none-or-unreported' }
  | { readonly kind: 'truncated' };

/** THE MIRROR READER of one kept-leaf key. A cut line that kept its `meas` (the encoder drops `meas`
 *  LAST) is read from its `meas`. */
export function childReclaimMirrorLeaf(
  row: Pick<ChildReclaimLeafSourceRow, 'truncated' | 'meas'>, key: 'clipsKept' | 'tmpRootKept',
): ChildReclaimMirrorLeaf {
  if (row.meas === null) return row.truncated ? { kind: 'truncated' } : { kind: 'none-or-unreported' };
  const v = row.meas[key];
  // null is this carrier's to read, never the word half's (H8, after 4045): nothing kept, or an older ccd's silence.
  return v === null ? { kind: 'none-or-unreported' } : { kind: 'kept', word: leafKeptWord(v) };
}

const LEAF_DONE: LifecycleOutcome = 'done';
const LEAF_END_CREATE: ChildReclaimLeafEndRow['act'] = 'create';
const LEAF_END_COLLECT: ChildReclaimLeafEndRow['act'] = 'collect';

/** Does this row carry the kept-leaf keys: a `done`, or a failure whose act completed? */
export const childReclaimLeafSource = (r: Pick<ChildReclaimLeafSourceRow, 'outcome' | 'refusal'>): boolean =>
  r.outcome === LEAF_DONE
  || (r.outcome === FAILED && r.refusal !== null
    && (CHILD_RECLAIM_LEAF_FAILED_TOKENS as readonly string[]).includes(r.refusal));

const LEAF_DAYS = CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS / 86_400_000;
/** What each of ccd's words means for a kept leaf, in a person's words. */
const LEAF_PHRASE: Readonly<Record<LeafKeptWord, string>> = {
  refused: 'its removal helper refused it',
  unmeasured: 'whether it could be removed could not be measured',
  'in-use': 'a process still used it after the bounded wait',
};
const LEAF_HORIZON = `This line ends when the id is used for a new workspace, or ${LEAF_DAYS} days after ccd recorded `
  + 'the reclaim; the feed keeps the record.';

/** The kept-leaf item's sentence (spec §5.9): what stands, why, and what ends the line. A cut line says it
 *  was cut. It points to the feed row only when the row carries ccd's `detail`: ccd's last-resort line keeps
 *  neither `meas` nor `detail` (W8-SEC-3), and then the sentence names where to look instead. A temp root that
 *  a later `collect` took is never named as kept, nor as a place to look. */
export function childReclaimLeafKeptSentence(
  sessionId: string, clips: ChildReclaimMirrorLeaf, tmp: ChildReclaimMirrorLeaf | 'collected',
  detail: string | null,
): string {
  if (clips.kind === 'truncated') {
    const where = tmp === 'collected'
      ? `~/.cc-clips/${sessionId}` : `~/.cc-clips/${sessionId} and ~/.cc-tmp/${sessionId}`;
    return 'The reclaim of this child completed, but the journal line ccd wrote for it was cut to fit, so whether '
      + 'its clips directory or its temp root was kept is not known; '
      + (detail !== null && childReclaimDetailText(detail) !== ''
        ? 'the feed row for it carries what ccd said.'
        : `ccd's line kept no detail either, so the feed cannot name it; look for ${where} on the fleet box.`)
      + (tmp === 'collected' ? ' Its temp root has since been collected.' : '') + ` ${LEAF_HORIZON}`;
  }
  const tmpWord = tmp !== 'collected' && tmp.kind === 'kept' ? tmp.word : null;
  const parts = [
    ...(clips.kind === 'kept'
      ? [`its clips directory ~/.cc-clips/${sessionId} (${clips.word}: ${LEAF_PHRASE[clips.word]})`] : []),
    ...(tmpWord === null ? [] : [`its temp root ~/.cc-tmp/${sessionId} (${tmpWord}: ${LEAF_PHRASE[tmpWord]})`]),
  ];
  return `The reclaim of this child completed, but ccd kept ${parts.join(' and ')}. `
    + 'What was kept stays on disk and ccrc deletes nothing more of it; a person removes it once nothing still uses it.'
    + (tmpWord === null ? '' : ' The temp root leaves this line once it is collected.') + ` ${LEAF_HORIZON}`;
}

/** One derived item, with what the lane's feed row needs: the mirror row it came from (the feed's
 *  once-per-row key) and ccd's own line for that row. */
export interface ChildReclaimLeafKept {
  readonly item: ChildReclaimLeafKeptAttention;
  readonly source: number;
  readonly detail: string | null;
}

const leafRunOf = (childOf: string | null): number | null =>
  (childOf !== null && CHILD_RUN_ID.test(childOf) ? Number(childOf) : null);

/** The kept-leaf items (spec §5.6, §5.9). Each is derived per id from its LATEST row (by the mirror's id)
 *  that carries the keys (`childReclaimLeafSource`) and lies inside the horizon. An item is raised on a
 *  kept word for either leaf, or on a line cut to fit.
 *
 *  An end must FOLLOW the row: a higher mirror id, and not a time ccd's own clock puts before the row's.
 *  - A later PLACED `create` (dated, and not ahead of the server's clock) ends both halves: the id is a
 *    new workspace now.
 *  - A later `collect` `done` ends the temp-root half only. The collector never takes a clips directory.
 *
 *  `runId` is `meas.childOf` read through `CHILD_RUN_ID`, else null. The purge failures do not carry it,
 *  and a cut line has no `meas` at all. Ordered by session id. Pure and deterministic, so the coord frame's
 *  byte-equality guard emits once per change. */
export function childReclaimLeafKept(i: {
  readonly rows: readonly ChildReclaimLeafSourceRow[];
  readonly ends: ReadonlyMap<string, readonly ChildReclaimLeafEndRow[]>;
  readonly nowMs: number;
}): ChildReclaimLeafKept[] {
  const since = childReclaimLeafKeptSince(i.nowMs);
  const latest = new Map<string, ChildReclaimLeafSourceRow>();
  for (const r of i.rows) {
    if (r.at < since || !childReclaimLeafSource(r)) continue;
    const had = latest.get(r.sessionId);
    if (had === undefined || r.id > had.id) latest.set(r.sessionId, r);
  }
  const out: ChildReclaimLeafKept[] = [];
  for (const r of latest.values()) {
    const after = (i.ends.get(r.sessionId) ?? []).filter((e) => e.id > r.id && !(e.at !== null && e.at < r.at));
    if (after.some((e) => e.act === LEAF_END_CREATE && e.at !== null && e.at <= i.nowMs)) continue;
    const collected = after.some((e) => e.act === LEAF_END_COLLECT);
    const clips = childReclaimMirrorLeaf(r, 'clipsKept');
    const tmpRead = childReclaimMirrorLeaf(r, 'tmpRootKept');
    const tmp = collected && tmpRead.kind !== 'none-or-unreported' ? 'collected' as const : tmpRead;
    if (clips.kind === 'none-or-unreported' && (tmp === 'collected' || tmp.kind === 'none-or-unreported')) continue;
    out.push({
      item: { kind: 'leaf-kept', sessionId: r.sessionId, runId: leafRunOf(r.meas?.childOf ?? null),
        sentence: childReclaimLeafKeptSentence(r.sessionId, clips, tmp, r.detail), at: r.at },
      source: r.id, detail: r.detail,
    });
  }
  return out.sort((a, b) => childReclaimBySession(a.item, b.item));
}

/** The kept-leaf collapse's word: no kept word, so its line never shares the PWA's React key
 *  (`kept-many <word>`) with another kept-many line. */
export const CHILD_RECLAIM_LEAF_KEPT_MANY_WORD: ChildReclaimLeafKeptMany['word'] = 'leaf-kept';

/** The sentence of a collapsed kept-leaf line (spec §5.9). */
export function childReclaimLeafKeptManySentence(n: number): string {
  return `${n} reclaimed child workspaces have a clips directory or a temp root that ccd kept on disk. `
    + 'Each stays until a person removes it, and the feed row of each names what was kept and why. '
    + `Each one leaves this line when its id is used for a new workspace, or ${LEAF_DAYS} days after ccd recorded its reclaim.`;
}

/** What the kept-leaf items list as (spec §5.9). More than `CHILD_RECLAIM_KEPT_MANY_OVER` items WITH a run
 *  become ONE `kept-many` line. An item with no run always stays single, because the PWA drops a member
 *  whose run is not a number. The singles come first, ordered by session id, then the line. */
export function childReclaimLeafKeptList(items: readonly ChildReclaimLeafKeptAttention[]): ChildReclaimAttention[] {
  const sorted = [...items].sort(childReclaimBySession);
  const withRun = sorted.flatMap((a) => (a.runId === null ? [] : [{ sessionId: a.sessionId, runId: a.runId }]));
  if (withRun.length <= CHILD_RECLAIM_KEPT_MANY_OVER) return sorted;
  return [
    ...sorted.filter((a) => a.runId === null),
    { kind: 'kept-many', word: CHILD_RECLAIM_LEAF_KEPT_MANY_WORD, members: withRun,
      sentence: childReclaimLeafKeptManySentence(withRun.length) },
  ];
}

/** The list with its kept-leaf items (spec §5.9): ONE item per child across every arm. A leaf item yields
 *  to any item the list already holds for the id, as a single or as a collapsed line's member, because
 *  that item is about the row that stands now. The rest are appended after the list, in
 *  `childReclaimLeafKeptList`'s order. */
export function childReclaimAttentionWithLeaves(
  list: readonly ChildReclaimAttention[], leaves: readonly ChildReclaimLeafKeptAttention[],
): ChildReclaimAttention[] {
  const taken = new Set<string>();
  for (const a of list) {
    if (a.kind === 'kept-many') for (const m of a.members) taken.add(m.sessionId);
    else taken.add(a.sessionId);
  }
  return [...list, ...childReclaimLeafKeptList(leaves.filter((l) => !taken.has(l.sessionId)))];
}
```

`FAILED` is the module's existing `const FAILED: LifecycleOutcome = 'failed'` (`:913`). `childReclaimBySession` is the existing one (`:1073`). Neither is redeclared.

- [ ] **Step 4: Implement the store reads.** In `server/src/coord/store.ts`, replace `import type { ChildReclaimCoordinatorClaim } from '../childReclaimSweep.js';` with:

```ts
import {
  CHILD_RECLAIM_LEAF_FAILED_TOKENS, type ChildReclaimCoordinatorClaim, type ChildReclaimLeafEndRow,
  type ChildReclaimLeafSourceRow,
} from '../childReclaimSweep.js';
```

Add `type LifecycleOutcome` to the `shared/api.js` import if it is absent. Then insert directly after `childReclaimEvents`' closing brace:

```ts
  /** THE ONE SPELLING of `lifecycleReclaimRowsSince`'s statement, public so its test runs EXPLAIN over the
   *  text this method runs. `INDEXED BY lifecycle_by_at`, `recentProvenance`'s idiom and its reason: the
   *  table is NEVER PRUNED, and the planner prefers a scan that orders by `id` for free over a seek plus a
   *  sort. `at >= ?` also excludes an undated row, which the horizon cannot place. */
  static lifecycleReclaimRowsSinceSql(): string {
    return `SELECT ${CoordStore.LC_COLS} FROM lifecycle_events INDEXED BY lifecycle_by_at ` +
      'WHERE at >= ? AND act = ? AND sessionId IS NOT NULL ' +
      `AND (outcome = ? OR (outcome = ? AND refusal IN (${placeholders(CHILD_RECLAIM_LEAF_FAILED_TOKENS.length)}))) ` +
      'AND (measJson IS NOT NULL OR truncated = 1) ORDER BY id';
  }

  /**
   * The kept-leaf item's SOURCE (child-reclamation spec §5.6, §5.9): every `reclaim` row ccd dated at or
   * after `atMs` that may carry the two kept-leaf keys. These are a `done`, or a failure whose token is one
   * of `CHILD_RECLAIM_LEAF_FAILED_TOKENS` (the act completed, then only the purge failed), carrying a `meas`
   * or cut to fit. ONE statement, bounded by the window and never by the table. Oldest first, by this
   * table's own `id`.
   *
   * Nothing is decided here: which row of an id stands, what it kept and what ends it are L1's
   * (`childReclaimLeafKept`). Each row keeps `meas` and `truncated` exactly as the mirror holds them, so a
   * cut line and a line with nothing measured never collapse into one value.
   */
  lifecycleReclaimRowsSince(atMs: number): ChildReclaimLeafSourceRow[] {
    const act: LifecycleAct = 'reclaim';
    const done: LifecycleOutcome = 'done';
    const failed: LifecycleOutcome = 'failed';
    const rows = this.db.prepare(CoordStore.lifecycleReclaimRowsSinceSql())
      .all(atMs, act, done, failed, ...CHILD_RECLAIM_LEAF_FAILED_TOKENS) as unknown as
        ({ id: number } & Parameters<typeof CoordStore.reviveLifecycleRow>[0])[];
    return rows.flatMap((r) => {
      // The WHERE excludes both; the row type cannot know it.
      if (r.sessionId === null || r.at === null) return [];
      const e = CoordStore.reviveLifecycleRow(r);
      return [{ id: r.id, sessionId: r.sessionId, at: r.at, outcome: e.outcome, refusal: e.refusal,
        truncated: e.truncated, meas: e.meas, detail: e.detail }];
    });
  }

  /** THE ONE SPELLING of `lifecycleLeafEndsFor`'s statement. `INDEXED BY lifecycle_by_session`, as
   *  `childReclaimEventsSql` is: the cost is bounded by the asked sessions' own histories. */
  static lifecycleLeafEndsSql(sessions: number): string {
    return 'SELECT id, sessionId, act, at FROM lifecycle_events INDEXED BY lifecycle_by_session ' +
      `WHERE sessionId IN (${placeholders(sessions)}) AND act IN (?, ?) AND outcome = ? ORDER BY sessionId, id`;
  }

  /** What may END a kept-leaf item (spec §5.9): each asked id's `done` `create` and `collect` rows, oldest
   *  first, with the mirror's id and ccd's nullable `at`. ONE statement whatever the id count. EVERY asked
   *  id gets an entry, `[]` included (`childReclaimEvents`' rule). Whether a row FOLLOWS an item's source,
   *  and whether a create is placed, are L1's. */
  lifecycleLeafEndsFor(sessionIds: readonly string[]): Map<string, ChildReclaimLeafEndRow[]> {
    const ids = [...new Set(sessionIds)];
    const out = new Map<string, ChildReclaimLeafEndRow[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const create: ChildReclaimLeafEndRow['act'] = 'create';
    const collect: ChildReclaimLeafEndRow['act'] = 'collect';
    const done: LifecycleOutcome = 'done';
    const rows = this.db.prepare(CoordStore.lifecycleLeafEndsSql(ids.length))
      .all(...ids, create, collect, done) as { id: number; sessionId: string; act: string; at: number | null }[];
    for (const r of rows) {
      const act = r.act === create ? create : r.act === collect ? collect : null;
      if (act !== null) out.get(r.sessionId)?.push({ id: r.id, act, at: r.at });
    }
    return out;
  }
```

`ChildReclaimLeafEndRow['act']` is `Extract<LifecycleAct, 'create' | 'collect'>`, so `'collect'` compiles only once wave 7's member is on the branch, which Step 0 (a) checked.

- [ ] **Step 5: Implement the feed row.** In `server/src/coord/childReclaim.ts`, add `type ChildReclaimLeafKept` to the `../childReclaimSweep.js` import (`grep -n "type ChildReclaimSweepSkip, type ChildReclaimSweepVerdict," server/src/coord/childReclaim.ts`). Then insert directly after `recordChildReclaimKeptFeed`'s closing brace:

```ts
/** The title of the one feed row a kept leaf writes (spec §5.9). */
export const CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE = 'child reclaim leaf kept';

/** The kept-leaf feed row's body (spec §5.9): the item's own sentence, then ccd's own line for the row. That
 *  line names what was kept and why, and a line cut to fit usually keeps it, because the encoder drops
 *  `meas` before `detail`, except in its last-resort line, which keeps neither (W8-SEC-3). ccd's line goes
 *  through `childReclaimDetailText` (W8-SEC-2): one line, control and bidi characters replaced, bounded by
 *  `LC_LINE_MAX`. Once the item has ended, this row is the record. */
export function childReclaimLeafKeptFeedBody(k: ChildReclaimLeafKept): string {
  const a = k.item;
  const who = a.runId === null ? a.sessionId : `${a.sessionId}, child of run #${a.runId}`;
  const line = k.detail === null ? '' : childReclaimDetailText(k.detail);
  const said = line === '' ? 'ccd recorded no detail.' : `ccd recorded: ${line}`;
  return `${who}: ${a.sentence} ${said}`;
}

/**
 * ONE feed row for a kept leaf (spec §5.9), in `recordChildReclaimKeptFeed`'s idiom exactly: `kind: 'run'`,
 * recorded and NEVER pushed; a missing log degrades the record and never the sweep; `recordFeedEvent`
 * throws synchronously and is caught; the flush is in a `finally`. The caller decides when to write it:
 * once per source row, per process.
 */
export function recordChildReclaimLeafKeptFeed(
  deps: Pick<ChildReclaimDeps, 'coord' | 'notifyLog'>, k: ChildReclaimLeafKept,
): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: k.item.sessionId, runId: k.item.runId,
      title: CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE, body: childReclaimLeafKeptFeedBody(k) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — child reclaim leaf kept, feed archive degraded`);
  } finally {
    void log.flush();
  }
}
```

- [ ] **Step 6: Wire the lane.** In `server/src/watch.ts`:
- Add `recordChildReclaimLeafKeptFeed` to the `./coord/childReclaim.js` import (`:89-91`).
- Add `childReclaimAttentionWithLeaves, childReclaimLeafKept, childReclaimLeafKeptSince, type ChildReclaimLeafKept` to the `./childReclaimSweep.js` import (`:93-100`).
- Directly after `childReclaimKeptReported`'s declaration, add:

```ts
  /** The kept-leaf items (spec §5.6, §5.9), as the sweep's last successful kept-leaf read derived them.
   *  Kept, never erased, across a read that failed. `[]` until the first pass. Derived from the mirror on
   *  every pass that gets past the fail-shut try, so a restart rebuilds them on its first pass. */
  private childReclaimLeaves: readonly ChildReclaimLeafKept[] = [];
  /** The mirror rows (`ChildReclaimLeafKept.source`) whose kept-leaf feed row this process has written: one
   *  row per source row per process, so a restart writes it once more. Never pruned, because an ended item
   *  never returns. */
  private readonly childReclaimLeafFed = new Set<number>();
```

Insert after the `mirrorArms` statement (the `});` that closes `childReclaimAttention({ latest, live, … })`) and before the `// TWO — the switches` comment:

```ts
    // ONE-b: the kept-leaf items (spec §5.6, §5.9). They are the clips directories and temp roots ccd kept
    // on a reclaim that completed. Read from the mirror ALONE, so a restart rebuilds them, and NEVER filtered
    // by `live`: after a `done`, ccd has purged the registry row, so no listing names the child.
    // ITS OWN TRY, AFTER THE FAIL-SHUT TRY ABOVE. The items gate nothing: no verdict, due set, lease or
    // request reads them. So a failed read here never fails the pass shut. It keeps the last items, as a
    // failed mirror read keeps the whole list, and the pass decides exactly as it would have. When the
    // fail-shut try failed, this read is never reached, and that pass publishes nothing.
    // BEFORE the two early returns below, so a paused or capability-less pass lists them too.
    try {
      const rows = coord.lifecycleReclaimRowsSince(childReclaimLeafKeptSince(now));
      this.childReclaimLeaves = childReclaimLeafKept({
        rows, ends: coord.lifecycleLeafEndsFor(rows.map((r) => r.sessionId)), nowMs: now });
    } catch (err) {
      console.warn(`ccrc-server: sweepChildReclaim could not read the kept leaves (${err instanceof Error ? err.message : String(err)}) — the last kept-leaf items stand, and no reclaim decision reads them`);
    }
    // The feed keeps the record once an item has ended (spec §5.9): one row per source row per process.
    // Recorded, never pushed.
    for (const k of this.childReclaimLeaves) {
      if (this.childReclaimLeafFed.has(k.source)) continue;
      this.childReclaimLeafFed.add(k.source);
      recordChildReclaimLeafKeptFeed({ coord, notifyLog: this.deps.notifyLog }, k);
    }
```

In `childReclaimPublishAttention`, replace `this.childReclaimAttentionList = childReclaimAttentionWithKept(mirrorArms, kept, verdicts);` with:

```ts
    this.childReclaimAttentionList = childReclaimAttentionWithLeaves(
      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves.map((k) => k.item));
```

Then add one bullet to the `childReclaimAttentionList` field's docstring (`grep -n "private childReclaimAttentionList" server/src/watch.ts`): "- Its `leaf-kept` items, and their `kept-many` collapse, come from the mirror on every pass that gets past the fail-shut try. They are never filtered by the listing, and they yield to any other item for the same child."

- [ ] **Step 7: Workspace lifecycle's reader: verify only (H8).** The re-point is Task 1's. If workspace-lifecycle wave 5 was on the branch at Task 0, Task 1's commit moved its word half (`KEPT_LEAF_WORDS`, `KeptLeafWord`, `keptLeafWord`) to L0, made `expireLeafKept` and `archived-expiry-policy.test.ts` call `leafKeptWord`, and derived its `ExpireLeafKept` alias and `LEAF_KEPT_WHY`'s key type from `LeafKeptWord` (W8-SEC-1); Step 0 (e2) checked that no line there still spells the three words. This task edits nothing in `server/src/archivedExpiry.ts`. Only if Step 0 (e) printed `export function expireLeafKept`, run `( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts test/expire-archived.test.ts test/archived-expiry-lane.test.ts )`. Expected: green, with the counts Task 1 left. If Step 0 (e) printed nothing, skip this step.

- [ ] **Step 8: Run the tests to verify they pass, and the neighbours stay green.**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-leaf-kept.test.ts \
  test/child-reclaim-leaf-kept-store.test.ts test/child-reclaim-leaf-kept-lane.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts test/child-reclaim-sweep-policy.test.ts \
  test/child-reclaim-events-store.test.ts test/lifecycle-store.test.ts test/mail-routes.test.ts test/single-definition.test.ts \
  test/child-reclaim-licence-lane.test.ts test/child-reclaim-hold-retired-generation.test.ts \
  test/child-reclaim-birth-removal.test.ts test/child-reclaim-attention-arms.test.ts
```

Expected:
- the first command: `child-reclaim-leaf-kept` 26/26, re-measure (R-j) (the drafted 26, less the three classifier cases that are Task 1's (H8), plus the purge-incomplete tie case, W8-SEC-3's cut-without-detail case and W8-SEC-2's detail-text case), `child-reclaim-leaf-kept-store` 5/5, `child-reclaim-leaf-kept-lane` 6/6;
- the second command: green and unchanged. The shared rig's other users keep the counts Tasks 3, 4 and 5 left, because every rig addition is optional. No existing fixture journals a `reclaim` `done` row with kept keys, or one cut to fit, so no existing list gains an item. `mail-routes`' kebab scanner stays green, because this task writes no new quoted kebab literal under `server/src/coord`: the purge tokens are bound from L1, and `'leaf-kept'` lives in L1.

Run each command in the foreground with a timeout of at least 600000 ms. If `child-reclaim-sweep` reds on a known load flake, re-run it in isolation before calling it a break.

- [ ] **Step 9: The PWA renders the new kind with NO PWA edit.**

```bash
SCRATCH=$(mktemp -d)                                                   # EX7: a fresh temp dir, never the tree
( cd pwa && { test -d node_modules || npm ci; } && ./node_modules/.bin/tsc --noEmit ) ; echo "pwa tsc rc=$?"
git status --porcelain -- pwa/                                         # prints nothing
cat > "$SCRATCH/pwa-reads-leaf-kept.ts" <<EOF
import { childReclaimAttentionOf } from '$(git rev-parse --show-toplevel)/pwa/src/fleet/childReclaimWords.ts';
console.log(JSON.stringify(childReclaimAttentionOf({ childReclaimAttention: [
  { kind: 'leaf-kept', sessionId: 'demo-a', runId: 41, sentence: 's1', at: 1 },
  { kind: 'leaf-kept', sessionId: 'demo-b', runId: null, sentence: 's2', at: 2 },
  { kind: 'kept-many', word: 'leaf-kept', members: [{ sessionId: 'demo-c', runId: 3 }], sentence: 's3' },
] })));
EOF
( cd server && ./node_modules/.bin/tsx "$SCRATCH/pwa-reads-leaf-kept.ts" )
rm -rf "$SCRATCH"
```

`$SCRATCH` is the fresh directory the block's first line makes, never the tree, and the block's last line removes it (EX7). Expected:
- `pwa tsc rc=0`. Task 1's union, with its separate `ChildReclaimLeafKeptMany` arm, compiles through `RenderedAttention = Pick<Extract<ChildReclaimAttention, { readonly sessionId: string }>, …>` (`pwa/src/fleet/childReclaimWords.ts:67`), whose `runId` becomes `number | null`, the type `isAttention` already admits (`:81-82`).
- `git status` prints nothing.
- The script prints all three items, in order: the two singles as given, the null-run one included, and the collapsed line rebuilt as `{"kind":"kept-many","word":"leaf-kept","sentence":"s3","members":[{"sessionId":"demo-c","runId":3}]}`.

The banner keys the line `kept-many leaf-kept` (`ChildReclaimBanner.tsx:141`), which no other kept-many line uses. It keys a single by `sessionId` (`:148`), which `childReclaimAttentionWithLeaves` keeps unique. If `tsx` cannot resolve the PWA file's extensionless `../../../shared/api` import, report that. Do NOT add a PWA test file.

- [ ] **Step 10: Mutation table.** Apply each mutation alone, run its command, see the red, and revert. Every command runs from `server/`. There is no T7.1 or T7.2: the classifier's pins and their mutations are Task 1's (H8).

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T7.3 | `childReclaimMirrorLeaf`: replace `row.truncated ? { kind: 'truncated' } : { kind: 'none-or-unreported' }` with `{ kind: 'none-or-unreported' }` | `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept.test.ts` | "reads a line cut to fit…": `expected { kind: 'none-or-unreported' } to deeply equal { kind: 'truncated' }`; "lists a line cut to fit…": `expected [] to deeply equal [ { item: …, source: …, detail: 'clips kept (refused)' } ]`; and "a line cut to fit that kept no detail either…": `null: expected [] to deeply equal [ '…' ]`. Re-measure (R-j) |
| T7.4 | `childReclaimLeafSource`: delete the `\|\| (r.outcome === FAILED && …)` arm | same | "lists the three purge failures…": `expected [] to deeply equal [ 'demo-p0', 'demo-p1', 'demo-p2' ]` |
| T7.5 | `childReclaimLeafSource`: replace the token test with `r.outcome === FAILED` | same | same case: `expected [ 'demo-p0', 'demo-p1', 'demo-p2', 'demo-x', 'demo-y' ] to deeply equal [ 'demo-p0', 'demo-p1', 'demo-p2' ]` |
| T7.6 | `childReclaimLeafKept`: replace `r.id > had.id` with `true` | same | "reads the LATEST row…": `array order decided "latest": expected [ { item: … } ] to deeply equal []` |
| T7.7 | Replace `e.at !== null && e.at <= i.nowMs` with `(e.at ?? 0) <= i.nowMs` | same | "a create that is not placed…": `expected [] to have a length of 1` (the undated create) |
| T7.8 | Delete `&& e.at <= i.nowMs` | same | the same case: `expected [] to have a length of 1` (the create ahead of the clock) |
| T7.9 | Delete `&& !(e.at !== null && e.at < r.at)` from the `after` filter | same | "a create that does not follow the row…": `clock: expected [] to have a length of 1`; "a collect that does not follow…": `expected [] to deeply equal [ '…' ]` |
| T7.10 | Replace `e.id > r.id` with `true` in the `after` filter | same | the same case: `mirror id: expected [] to have a length of 1` |
| T7.11 | Replace `const clips = childReclaimMirrorLeaf(r, 'clipsKept');` with `const clips: ChildReclaimMirrorLeaf = collected ? { kind: 'none-or-unreported' } : childReclaimMirrorLeaf(r, 'clipsKept');` | same | "a later collect ends the temp-root half only…": `expected [] to deeply equal [ 'The reclaim of this child completed, but ccd kept its clips directory …' ]` |
| T7.12 | Replace `r.at < since` with `r.at <= since` | same | "ends 7 days after…": `expected [] to have a length of 1` |
| T7.13 | `leafRunOf`: replace the body with `(childOf !== null ? Number(childOf) : null)` | same | "takes the run from childOf only when it is a run id": `0: expected +0 to be null` |
| T7.14 | `childReclaimAttentionWithLeaves`: delete `.filter((l) => !taken.has(l.sessionId))` | same | "a leaf item yields…": the diff shows five extra `leaf-kept` items (`demo-t`, `demo-f`, `demo-s`, `demo-k`, `demo-m`) |
| T7.15 | `childReclaimLeafKeptList`: replace `withRun.length <= CHILD_RECLAIM_KEPT_MANY_OVER` with `sorted.length <= CHILD_RECLAIM_KEPT_MANY_OVER` | same | "five with a run and any number without stay single…": the diff shows a `kept-many` line where seven singles were expected |
| T7.16 | `lifecycleReclaimRowsSinceSql`: replace `INDEXED BY lifecycle_by_at` with `NOT INDEXED` | `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept-store.test.ts` | "seeks lifecycle_by_at…": `expected '…NOT INDEXED…' to contain 'INDEXED BY lifecycle_by_at'` |
| T7.17 | Delete ` AND refusal IN (${…})` together with its parentheses and the `...CHILD_RECLAIM_LEAF_FAILED_TOKENS` bind | same | "returns the done and the three purge-failure…": `expected [ 'demo-a', 'demo-b', 'demo-c', 'demo-g' ] to deeply equal [ 'demo-a', 'demo-b', 'demo-c' ]` |
| T7.18 | Delete `AND (measJson IS NOT NULL OR truncated = 1) ` | same | same case: `expected [ 'demo-a', 'demo-b', 'demo-c', 'demo-j' ] to deeply equal […]` |
| T7.19 | Delete `AND act = ? ` and the `act` bind | same | same case: `expected [ 'demo-a', 'demo-b', 'demo-c', 'demo-f' ] to deeply equal […]` |
| T7.20 | `lifecycleLeafEndsSql`: delete ` AND outcome = ?` and the `done` bind | same | "answers every asked id…": `expected [ [ 'create', 1790000000000 ], [ 'create', 1790000000001 ], [ 'create', 1790000000002 ], [ 'collect', null ], [ 'collect', 1790000000003 ] ] to deeply equal [ [ 'create', 1790000000000 ], [ 'collect', null ] ]` |
| T7.21 | `lifecycleLeafEndsFor`: replace the single `prepare(…).all(…)` with a per-id loop of `prepare(CoordStore.lifecycleLeafEndsSql(1)).all(id, create, collect, done)` | same | "spends ONE statement…": `expected "prepare" to be called 2 times, but got 4 times` |
| T7.22 | `watch.ts` ONE-b: in the `catch`, add `this.childReclaimSweepState.clear(); return;` after the `console.warn` | `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept-lane.test.ts` | "a failed kept-leaf read…": `a failed display read failed the pass shut: expected [] to deeply equal [ 'demo-a' ]` |
| T7.23 | In the `catch`, add `this.childReclaimLeaves = [];` | same | the same case: `expected [] to deeply equal [ ObjectContaining{ kind: 'leaf-kept', … } ]` |
| T7.24 | Move the whole ONE-b block (try, catch and feed loop) to directly after the `// TWO` `if` block's closing brace | same | "is listed on a paused pass…": `expected [] to deeply equal [ ObjectContaining{…} ]` |
| T7.25 | Move the ONE-b `try` body to the top of the fail-shut `try` (before `const withReclaim = …`), and delete ONE-b's own `try`/`catch` | same | "a failed kept-leaf read…": `expected [] to deeply equal [ 'demo-a' ]`; "a failed fail-shut read…": `expected "spy" to not be called at all, but actually been called 1 times` |
| T7.26 | Delete `if (this.childReclaimLeafFed.has(k.source)) continue;` | same | "lists a reclaimed child…": `expected [ …(3) ] to have a length of 1` |
| T7.27 | In `childReclaimPublishAttention`, revert to `this.childReclaimAttentionList = childReclaimAttentionWithKept(mirrorArms, kept, verdicts);` | same | "lists a reclaimed child…": `expected [] to deeply equal [ { kind: 'leaf-kept', … } ]` |
| T7.28 | `CHILD_RECLAIM_LEAF_FAILED_TOKENS`: delete `'purge-incomplete', ` | `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept.test.ts` | "the purge-failure set holds Task 6's purge-incomplete word…": `expected [ 'purge-mechanism-absent', 'purge-refused' ] to include 'purge-incomplete'`; "lists the three purge failures…" reds too, on its first `toEqual` |
| T7.29 | `childReclaimLeafKeptSentence`'s truncated arm: replace the whole conditional clause (`detail !== null && … ? … : …`, in its parentheses) with `'the feed row for it carries what ccd said.'` | `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept.test.ts` | "a line cut to fit that kept no detail either…": `null: expected [ 'The reclaim of this child completed, but the journal line …' ] to deeply equal [ 'The reclaim of this child completed, but the journal line …' ]`. Not measured at planning (W8-SEC-3): measure it (R-j) |
| T7.30 | The same arm: replace `detail !== null && childReclaimDetailText(detail) !== ''` with `detail !== null` | same | the same case, on its empty detail: `"": expected [ '…' ] to deeply equal [ '…' ]`. Not measured at planning (W8-SEC-3): measure it (R-j) |
| T7.31 | `childReclaimDetailText`: replace its `return` line with `return cps.join('');` | same | "a 10,000-character detail…": `expected 'xxxxxxxxxx yyyyyyyyyyyyyyyyyyyyyyyyyy…' to have a length of 2049 but got 9999`. Not measured at planning (W8-SEC-2): measure it (R-j) |
| T7.32 | `detailUnsafe`: delete its first disjunct, `c <= 0x1f`, with the or-operator after it | same | the same case: `a newline: expected true to be false`. Not measured at planning (W8-SEC-2): measure it (R-j) |
| T7.33 | `detailUnsafe`: delete the disjunct `(c >= 0x202a && c <= 0x202e)`, with the or-operator before it | same | the same case: `a bidi override: expected true to be false`. Not measured at planning (W8-SEC-2): measure it (R-j) |
| T7.34 | `childReclaimLeafKeptFeedBody`: replace `childReclaimDetailText(k.detail)` with `k.detail` | same | the same case: `expected 'demo-gone: s. ccd recorded: xxxxxxxxxx…' to be 'demo-gone: s. ccd recorded: xxxxxxxxxx…'`. Not measured at planning (W8-SEC-2): measure it (R-j) |
| T7.35 | `childReclaimMirrorLeaf`: replace `return v === null ? { kind: 'none-or-unreported' } : { kind: 'kept', word: leafKeptWord(v) };` with `return { kind: 'kept', word: leafKeptWord(v) };` (the carrier hands `null` to the word half) | `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept.test.ts` | "reads a word on the key as kept": `expected { kind: 'kept', word: 'unmeasured' } to deeply equal { kind: 'none-or-unreported' }`; "reads an absent key as none-or-unreported…" and "reads a cut line that kept its meas from its meas…" red the same way. So do the `childReclaimLeafKept` cases in this file whose rows leave a key absent (an absent key now reads `kept: unmeasured`), e.g. "raises nothing for a done row that kept nothing, or whose ccd did not say" (a non-empty list where `[]` is expected) and "lists a done row that kept the temp root…" (the clips half joins the sentence); record the measured count. The lane's cases are in `child-reclaim-leaf-kept-lane.test.ts`, which this command does not run. Not measured at planning (H8, after 4045): measure it (R-j) |

Revert each mutation, then re-run Step 8's first command: green.

- [ ] **Step 11: Type-check.**

```bash
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd pwa && ./node_modules/.bin/tsc --noEmit )
```

Expected: both print nothing.

- [ ] **Step 12: Commit.**

```bash
git add server/src/childReclaimSweep.ts server/src/coord/store.ts server/src/coord/childReclaim.ts server/src/watch.ts \
  server/test/child-reclaim-leaf-kept.test.ts server/test/child-reclaim-leaf-kept-store.test.ts \
  server/test/child-reclaim-leaf-kept-lane.test.ts server/test/childReclaimGenerationFixture.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): list a kept clips directory or temp root after ccd purged the row

ccd's reclaim tail journals a leaf it could not prove gone on the done row
and on the three purge failures. After a done the registry row is gone, so
no attention arm could name the child. The sweep now reads those rows from
the lifecycle mirror alone, through one bounded read over the last seven
days (INDEXED BY lifecycle_by_at), and lists one leaf-kept item per id.

The mirror reader answers kept:<word>, none-or-unreported or truncated,
through the one word classifier shared with workspace lifecycle. A line cut
to fit raises an item that says so. A later placed create ends the item,
a later collect ends its temp-root half only, and seven days ends it too;
one feed row per row keeps the record. More than five items with a run
collapse into a kept-many line of their own word.

The read sits in its own try after the fail-shut try. It gates nothing, so
its failure keeps the last items and never fails the pass shut, and it runs
before the early returns, so a paused pass still lists them.

ccd's detail reaches the feed as one bounded plain line
(childReclaimDetailText). A line cut to fit that kept no detail either
names where to look on the fleet box instead of pointing at the feed.

A leaf item yields to any other item for the same child, a stuck one
included. The lane cases run on the shared lane rig, which gains an
executor stub, the fleet's verbs, a feed log, a restart over one coord.db
and a journal helper whose uid counter is module-wide.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The `stuck` class: `containment-refuted` gets its own attention item, outranks kept, held and failing, reads `deferred` on the chip and stays quiet in the feed

**Model routing:** `sonnet`, effort `high`. This is not the SAFETY subject: nothing here changes what `ws-reclaim` is licensed against, and the executor's act is untouched. Two things are judgment work: the derivation's precedence, which spans four functions in two files, and the chip arm's position against R41's verdict arm. Step 3 writes both out in full.

**Why:** Wave 7 (run 347) makes ccd print and journal `containment-refuted` when it PROVES that what it would remove is not only the child's own tree: another session's tree or registry row lies at, inside or through it, or the recorded path is not this workspace's worktree. At `226bb881c` the server reads the word as an ordinary resumable failure (`parseChildReclaimResult`, server/src/coord/childReclaim.ts:775; `grep -n "const resume: ChildReclaimResume = isChildReclaimPreCrumbFailed" server/src/coord/childReclaim.ts`). Task 6 (H3) gives the word its own reading, in one commit: `'stuck'` in `ChildReclaimResume`, `CHILD_RECLAIM_STUCK_TOKENS` with its type and guard, the word-first parse arm, the kebab admission, the stuck feed tail and the flip of wave 7's `parseChildReclaimResult` pin. Until THIS task, every other surface still reads it as ordinary:
- The attention list shows the child only after 15 minutes of failures, and then as `failing`, with a sentence that promises a retry ccd will lose every time (`childReclaimAttention`, server/src/childReclaimSweep.ts:1041; `grep -n "^export function childReclaimAttention" server/src/childReclaimSweep.ts`).
- The chip says `deferred`, with the bare word, until the ceiling.

This task implements the rulings for this class, and nothing more:
- **The word (Task 6's, H3).** This task declares, parses, admits and flips none of it. It consumes Task 6's `CHILD_RECLAIM_STUCK_TOKENS`, `isChildReclaimStuckToken` and `resume: 'stuck'`, which the executor passes through unchanged (childReclaim.ts:942; `grep -n "resume: act.resume" server/src/coord/childReclaim.ts`). L1 receives the classifier injected, the way it receives `childReclaimTokenKind`. Task 9 turns the stuck outcome into the tier field.
- **Attention.** Each stuck child gets ONE item, listed at once, with no ceiling. Its sentence carries ccd's word and the journal row's `detail`, which names the tree or row to fix. To make that possible, `ChildReclaimJournalRow` gains `detail`. With no detail, the sentence says the record was cut and points to the feed. The retry clause is conditional. For a child the sweep KEEPS (a kept verdict judged under the run the item names), the sentence drops the retry clause: it says the child is kept and names the kept reason, and never promises a retry the kept word prevents (ruling T8 OPEN4, R41). For a child the sweep HOLDS (a `held` verdict, which carries no run), the sentence drops the retry clause too: it says ccrc does not retry the child while the hold stands, and that the long backoff resumes once the hold lifts (the coordinator's `held` ruling, R41). The `detail` is ccd's text, and any session on the fleet box can append a journal line, so the sentence carries it only through Task 7's `childReclaimDetailText`: one line, with no control, separator or bidi character, cut at `LC_LINE_MAX` characters (W8-SEC-2).
- **Precedence.** `terminal` outranks `stuck`. `stuck` outranks `kept`, `kept-many` and `failing`. A `held` verdict does not withhold it; it swaps the item's retry clause for the hold's (the `held` ruling). `childReclaimKeptItems` excludes stuck ids. Task 7's `leaf-kept` yields to it too (ruling: stuck outranks leaf-kept, through Task 7's DEP1, with no edit here).
- **The chip.** It reads `deferred`, with the stuck item's own sentence, and never `refused`. For a kept child that sentence is the kept variant (T8 OPEN4), which promises no retry, so the switch leaves it as it leaves every kept answer. For a held child it is the held variant (the `held` ruling), which promises no retry while the hold stands; like the hold's own deferred answer it still says the sweep acts once the hold lifts, so the switch turns it to `paused`, as it turns every deferred. `refused` is settled in the PWA, which never re-reads it. Step 5 checks that the PWA needs no edit.
- **The feed.** `childReclaimFeedQuiet` treats a listed stuck item like a failing one, so a retry that finds the same word writes no new row. Task 6's `childReclaimFailedTail` already says the stuck clause; this task re-points that literal to `CHILD_RECLAIM_STUCK_RETRY`, so one spelling remains.
- **Review 341's F9.** The vacuous `isChildReclaimKebab('state-changed')` line (server/test/child-reclaim-pre-crumb.test.ts:61; `grep -n "isChildReclaimKebab('state-changed')" server/test/child-reclaim-pre-crumb.test.ts`) can never fail, because `isChildReclaimToken` admits that word first. It is re-aimed at `isChildReclaimKebab('containment-refuted')`. Only Task 6's stuck-set admission (H3) lets that word through, so the re-aimed line pins that admission directly. (The scanner in `mail-routes.test.ts` needs the admission too, because `CHILD_RECLAIM_STUCK_TOKENS` is a quoted kebab literal under `server/src/coord`.) Task 8 keeps this re-aim (H3).

**Files:**
- Modify: `server/src/coord/childReclaim.ts`. The stuck set, its type and guard, `ChildReclaimResume`'s `'stuck'`, the kebab admission and the parse arm are Task 6's (H3), and this task does not touch them. The edits:
  - in Task 6's `childReclaimFailedTail`, the `case 'stuck':` literal becomes `return CHILD_RECLAIM_STUCK_RETRY;`, the same bytes (`grep -n "^export function childReclaimFailedTail" server/src/coord/childReclaim.ts`);
  - add `'detail'` to `ChildReclaimEvent`'s `Pick` (:1494);
  - add the stuck arm, with its kept variant (T8 OPEN4) and its held variant (the `held` ruling), to `childReclaimStatus` (:1612), between `const marked =` (:1630) and the verdict arm (:1634, `grep -n "if (marked && input.verdict.kind === 'skip')" server/src/coord/childReclaim.ts`);
  - extend the `../childReclaimSweep.js` import (:11-16) and add `isChildReclaimKeptWord` to the `../../../shared/api.js` import (:19-21).
- Modify: `server/src/childReclaimSweep.ts`. The edits:
  - `ChildReclaimJournalRow` gains `detail` (:896-902);
  - `childReclaimJournalRow` returns `detail` (:965, `grep -n "return { sessionId: latest.id" server/src/childReclaimSweep.ts`);
  - `childReclaimTerminalRefusal`'s parameter type is widened (:974; the body is unchanged);
  - new: `CHILD_RECLAIM_STUCK_RETRY`, `childReclaimStuckRow`, `childReclaimStuckKeptClause`, `childReclaimStuckKept`, `CHILD_RECLAIM_STUCK_HELD`, `childReclaimStuckHeld` (the `held` ruling) and `childReclaimStuckSentence` (with its `kept` parameter, T8 OPEN4; it carries ccd's detail through Task 7's `childReclaimDetailText`, W8-SEC-2), placed after `childReclaimFailingWord` (:1003);
  - `ChildReclaimAttentionInput.stuckOf` (:1006-1018);
  - `ChildReclaimJournalAttention` gains `'stuck'` (:1022);
  - `childReclaimAttention`'s loop (:1041-1064);
  - `childReclaimKeptItems`'s terminal set (:1090, `grep -n "const terminal = new Set(i.mirrorArms" server/src/childReclaimSweep.ts`) and its skip (:1097);
  - `childReclaimAttentionWithKept`: a stuck item for a child kept under the run it names takes the kept variant of its sentence (T8 OPEN4), a stuck item for a held child takes the held variant (the `held` ruling), and its docstring (:1130-1135);
  - `ChildReclaimFeedQuiet` and `childReclaimFeedQuiet` (:1149-1171, `grep -n "const failing = listed.find" server/src/childReclaimSweep.ts`).
- Modify: `server/src/watch.ts`. This file only wires. Add `isChildReclaimStuckToken` to the `./coord/childReclaim.js` import (:88-92) and `stuckOf: isChildReclaimStuckToken` to the one `childReclaimAttention({…})` call (:3373-3375, `grep -n "latest, live, kindOf: childReclaimTokenKind" server/src/watch.ts`).
- Modify (F9 re-aim): `server/test/child-reclaim-pre-crumb.test.ts`. One line and that case's title.
- Modify (fixtures the new required fields reach, with no assertion weakened): `server/test/child-reclaim-sweep-policy.test.ts` and `server/test/child-reclaim-status.test.ts`.
- Test (new, R56): `server/test/child-reclaim-stuck.test.ts`.
- NOT edited: anything under `pwa/`, `ccd/`, `agent/`, `shared/` (Task 1 declared the L0 arm), `README.md`, `server/test/single-definition.test.ts`, `server/test/containment-refuted-word.test.ts` (Task 6 flipped its one assertion, H3; Step 4 only runs it), and `server/test/ccd-child-reclaim-prelock-journal.test.ts`. That last file's `childReclaimTerminalRefusal` literal still compiles under the widened parameter.

**Interfaces:**
- Consumes:
  - Wave 7 (run 347, merged to main): `LcRefusalToken`'s `'containment-refuted'` member, `LC_REFUSAL_WORD['containment-refuted']`, and `server/test/containment-refuted-word.test.ts`.
  - Task 1, in shared/api.ts: `ChildReclaimAttention`'s arm `{ readonly kind: 'stuck'; readonly sessionId: string; readonly runId: number | null; readonly token: string; readonly sentence: string; readonly at: number | null }`.
  - Task 2: `ChildReclaimRequest.licenceGeneration: ChildReclaimGenerationKey | { kind: 'none' }` (the feed rig sends close's `{ kind: 'none' }`), and `childReclaimFirstSighting(monoMs, bornAt, markerRunId, generation: ChildReclaimGenerationKey)`. The key is the fourth parameter (H5).
  - Task 6 (H3), all committed before this task starts: `'stuck'` in `ChildReclaimResume` and `CHILD_RECLAIM_RESUME`; `CHILD_RECLAIM_STUCK_TOKENS`, `ChildReclaimStuckToken` and the type guard `isChildReclaimStuckToken(v: unknown): v is ChildReclaimStuckToken`; `parseChildReclaimResult`'s word-first failed arm (`childReclaimFailedResume`), which answers `resume: 'stuck'` whatever `crumb` says; `isChildReclaimKebab`'s admission of the stuck words and `purge-incomplete`; `childReclaimFailedTail`, with its exhaustive `switch (o.resume)` and its `'stuck'` case; and the flip of wave 7's `parseChildReclaimResult` pin. This task declares, parses, admits and flips none of these again.
  - Task 7: whatever parameters it added to `childReclaimKeptItems` or `childReclaimAttentionWithKept` for the leaf-kept arm. Keep them. The edits below touch only the lines they quote.
  - Task 7 (W8-SEC-2): `childReclaimDetailText(d: string): string`, exported from `server/src/childReclaimSweep.ts` (L1; the module the stuck composer lives in, so 3g adds no import for it). It answers ccd's journal `detail` as display text: every C0 or C1 control, line or paragraph separator and bidi embedding, override or isolate character replaced by a space, trimmed, and cut to `LC_LINE_MAX` characters followed by one `…` when longer. This task wraps the stuck sentence's detail in it, and declares nothing of it.
- Produces:
  ```ts
  // server/src/coord/childReclaim.ts
  export type ChildReclaimEvent = Pick<MirroredLifecycleEvent, 'act' | 'outcome' | 'refusal' | 'at' | 'detail'>;
  // childReclaimStatus: a marked child whose latest event is a stuck failure → deferred, ahead of the verdict arm;
  //   a kept verdict takes the kept variant and is never switched to paused (T8 OPEN4);
  //   a held verdict takes the held variant (childReclaimStuckHeld), which the switch turns to paused like every deferred
  // childReclaimFailedTail (Task 6's): case 'stuck' returns CHILD_RECLAIM_STUCK_RETRY (the same bytes)
  // server/src/childReclaimSweep.ts (L1)
  export interface ChildReclaimJournalRow { …; readonly detail: string | null }
  export const CHILD_RECLAIM_STUCK_RETRY: string;
  export const childReclaimStuckRow: <R extends { readonly outcome: string; readonly refusal: string | null }>(
    row: R, stuckOf: (token: string) => boolean) => row is R & { readonly refusal: string };
  export const childReclaimStuckKeptClause: (kept: ChildReclaimKeptWord) => string;
  export const childReclaimStuckKept: (sentence: string, kept: ChildReclaimKeptWord) => string;
  export const CHILD_RECLAIM_STUCK_HELD: string; // the held ruling (R41)
  export const childReclaimStuckHeld: (sentence: string) => string;
  // childReclaimStuckSentence: the detail through Task 7's childReclaimDetailText (W8-SEC-2); a detail that is
  //   empty once made one line reads as a cut record
  export const childReclaimStuckSentence: (token: string, detail: string | null, sentenceFor: (token: string) => string,
    kept: ChildReclaimKeptWord | null) => string;
  export interface ChildReclaimAttentionInput { …; readonly stuckOf: (token: string) => boolean }
  export type ChildReclaimJournalAttention = Extract<ChildReclaimAttention, { readonly kind: 'terminal' | 'stuck' | 'failing' }>;
  export const childReclaimTerminalRefusal: (row: Omit<ChildReclaimJournalRow, 'detail'>, kindOf: …) => boolean; // body unchanged
  // childReclaimAttentionWithKept: a stuck item for a child kept under the run it names → childReclaimStuckKept(sentence, why);
  //   a stuck item for a held child (no run to match: a held verdict carries none) → childReclaimStuckHeld(sentence)
  ```
  - For Task 9: the executor's `failed` outcome carries `resume: 'stuck'` (Task 6's). Task 9 derives `ChildReclaimSweepOutcome`'s `stuck: boolean` from the token, `isChildReclaimStuckToken(o.token)`, in `childReclaimSweepOutcomeOf`. Its restart seeding classifies a journal token with `isChildReclaimStuckToken`, injected into L1 exactly as `stuckOf` is here. Step 3h already imports `isChildReclaimStuckToken` into watch.ts, so Task 9 adds only `childReclaimSweepOutcomeOf` there.

- [ ] **Step 0: Entry check**

Run each check and read its answer:

```bash
test -f server/test/containment-refuted-word.test.ts && echo wave7-test-present
grep -n "  | 'containment-refuted'" shared/api.ts
grep -n "^  'containment-refuted':" shared/api.ts
grep -n "kind: 'stuck'" shared/api.ts
grep -n "^export const CHILD_RECLAIM_STUCK_TOKENS" server/src/coord/childReclaim.ts
grep -n "^export function isChildReclaimStuckToken(v: unknown): v is ChildReclaimStuckToken" server/src/coord/childReclaim.ts
grep -n "^export function childReclaimFailedTail" server/src/coord/childReclaim.ts
grep -n ": never = " server/src/coord/childReclaim.ts
grep -nE "^export (const|function) childReclaimDetailText" server/src/childReclaimSweep.ts
```

- If any of the first three checks prints nothing, wave 7 is not on this branch. STOP and report: Task 0 brought wave 7's tree (H1); no merge mid-wave.
- If the fourth prints nothing, Task 1 is not done. If any of the next four prints nothing, Task 6 is not done (H3: the stuck set, its guard and the failed tail are Task 6's). If the last prints nothing, Task 7 is not done (it declares `childReclaimDetailText`, W8-SEC-2). Stop in any of these cases.

- [ ] **Step 1: Write the failing tests**

Create `server/test/child-reclaim-stuck.test.ts`:

```ts
// Child reclamation, the STUCK class (spec §5.6, §5.9). `containment-refuted` is ccd's word for a
// PROVEN refusal at the tail's removal-time re-ask: another session's tree or registry row lies at,
// inside or through the child, or the recorded path is not this workspace's worktree. The tail stopped
// with the session stopped and nothing further deleted, and every retry finds the same until a person
// moves that tree or row. The server reads it as its own class:
//   - the parse reads the word FIRST, whatever `crumb` says (Task 6's arm, H3; pinned here as a consumer);
//   - ONE attention item per child, at once, carrying the journal row's detail and a conditional retry
//     clause (for a KEPT child, the kept reason in its place: T8 OPEN4; for a HELD child, the hold's clause in
//     its place: the held ruling, R41); ccd's detail as one bounded line (W8-SEC-2); under a terminal refusal
//     and over every kept, kept-many and failing item, and never withheld for a held child;
//   - the chip's `deferred` (an unsettled word the PWA re-reads), with the same sentence — never
//     `refused`;
//   - a feed that does not repeat itself when a retry finds the same word.
// Fixture HOME only (`mkTmp`); the rig's ccd is scripted, never run.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_STATUS_SENTENCE, CHILD_RECLAIM_STUCK_TOKENS, CHILD_RECLAIM_TOKEN_KIND,
  childReclaimStatus, childReclaimTokenKind, isChildReclaimResume, isChildReclaimStuckToken, parseChildReclaimResult,
  reclaimChild,
  type ChildReclaimDeps, type ChildReclaimRequest, type ChildReclaimStatusInput,
} from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_SKIP, CHILD_RECLAIM_STUCK_RETRY,
  childReclaimAttention, childReclaimAttentionWithKept, childReclaimFeedQuiet, childReclaimFirstSighting,
  CHILD_RECLAIM_STUCK_HELD, childReclaimDetailText,
  childReclaimKeptItems, childReclaimKeptList, childReclaimStuckHeld, childReclaimStuckKept, childReclaimStuckKeptClause,
  childReclaimStuckSentence, isChildReclaimPreLockToken,
  type ChildReclaimJournalRow, type ChildReclaimSweepVerdict,
} from '../src/childReclaimSweep.js';
import { refusalSentence } from '../src/wsaudit.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { CHILD_RECLAIM_KEPT_WORDS, LC_LINE_MAX, LC_REFUSAL_WORD, isLcRefusalToken } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const W = 'containment-refuted' as const;
const ID = 'demo-quiet-basin';
const RUN = 7;
const NOW = 1_790_000_000_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const LINE_AT = NOW - 60_000;
const DETAIL = 'registry row demo-twin lies inside /w/demo-quiet-basin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The latest reclaim line of the child's generation: a stuck failure a minute old, far short of the ceiling. */
const row = (over: Partial<ChildReclaimJournalRow> = {}): ChildReclaimJournalRow => ({
  sessionId: ID, outcome: 'failed', refusal: W, at: LINE_AT, failingSince: LINE_AT, detail: DETAIL, ...over,
});
const listOf = (rows: ChildReclaimJournalRow[], live: [string, number | null][] = [[ID, RUN]],
  stuckOf: (t: string) => boolean = isChildReclaimStuckToken) =>
  childReclaimAttention({ latest: rows, live: new Map(live), kindOf: childReclaimTokenKind, stuckOf,
    sentenceFor: refusalSentence, nowMs: NOW });

describe('the stuck set as this task consumes it (Task 6’s, H3; a consumer pin) (spec §5.9)', () => {
  it('is exactly containment-refuted: a journal-only word, never a ws-reclaim word, a pre-lock token or terminal', () => {
    expect([...CHILD_RECLAIM_STUCK_TOKENS]).toEqual([W]);
    for (const t of CHILD_RECLAIM_STUCK_TOKENS) {
      expect(isLcRefusalToken(t), t).toBe(true);
      expect(isChildReclaimStuckToken(t), t).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, t), t).toBe(false);
      expect(childReclaimTokenKind(t), t).toBeNull();
      expect(isChildReclaimPreLockToken(t), t).toBe(false);
    }
  });

  it('admits nothing else: not the resumable word, not the pre-breadcrumb words, not a near miss', () => {
    for (const t of ['worktree-remove-failed', 'probe-unmeasured', 'pin-failed', '', 'Containment-refuted', null]) {
      expect(isChildReclaimStuckToken(t), String(t)).toBe(false);
    }
    expect(isChildReclaimResume('stuck')).toBe(true);
  });
});

describe('parseChildReclaimResult reads the stuck word FIRST, whatever crumb says (Task 6’s arm, H3; a consumer pin) (spec §5.6)', () => {
  it.each([
    ['crumb true', { crumb: true }], ['crumb false', { crumb: false }], ['no crumb', {}], ['a non-boolean crumb', { crumb: 'yes' }],
  ] as const)('%s → stuck, with its token and detail', (_name, extra) => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: W, detail: DETAIL, ...extra }), '')).toEqual({
      kind: 'failed', resume: 'stuck', detail: `${W}: ${DETAIL}`, token: W });
  });

  it('an empty detail reads the bare word, as every failed word does', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: W, detail: '', crumb: true }), ''))
      .toEqual({ kind: 'failed', resume: 'stuck', detail: W, token: W });
  });

  it('control: worktree-remove-failed past the breadcrumb stays resumable', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: 'worktree-remove-failed', detail: 'd', crumb: true }), ''))
      .toMatchObject({ kind: 'failed', resume: 'resumable', token: 'worktree-remove-failed' });
  });
});

describe('the stuck attention item (spec §5.9)', () => {
  it('one item AT ONCE, with ccd’s word, the row’s detail and the conditional retry clause', () => {
    expect(listOf([row()])).toEqual([{ kind: 'stuck', sessionId: ID, runId: RUN, token: W,
      sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, null), at: LINE_AT }]);
    const s = listOf([row()])[0]!.sentence;
    expect(s).toContain(LC_REFUSAL_WORD[W]);
    expect(s).toContain(DETAIL);
    expect(s).toContain(CHILD_RECLAIM_STUCK_RETRY);
  });

  it('the retry clause is conditional, and names the long backoff and the breadcrumb', () => {
    expect(CHILD_RECLAIM_STUCK_RETRY).toBe('While automatic reclamation runs, ccrc retries it on its long backoff; '
      + 'the box resumes from its breadcrumb once the tree or row is fixed.');
  });

  it.each(CHILD_RECLAIM_KEPT_WORDS)('a child kept for %s: the retry clause gives way to the kept clause, which names the reason and promises no retry (T8 OPEN4)', (why) => {
    const plain = childReclaimStuckSentence(W, DETAIL, refusalSentence, null);
    const kept = childReclaimStuckSentence(W, DETAIL, refusalSentence, why);
    expect(plain.endsWith(` ${CHILD_RECLAIM_STUCK_RETRY}`)).toBe(true);
    expect(kept).toBe(`${plain.slice(0, -CHILD_RECLAIM_STUCK_RETRY.length)}${childReclaimStuckKeptClause(why)}`);
    expect(childReclaimStuckKept(plain, why)).toBe(kept);
    expect(childReclaimStuckKeptClause(why)).toContain(CHILD_RECLAIM_SKIP[why].sentence);
    expect(childReclaimStuckKeptClause(why)).not.toMatch(/retr/i);
    expect(kept).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
  });

  it('the hold clause replaces the retry clause for a held child: no retry while the hold stands, the backoff once it lifts (the held ruling, R41)', () => {
    expect(CHILD_RECLAIM_STUCK_HELD).toBe('This workspace carries a hold, so ccrc does not retry it while the hold stands; '
      + 'its long backoff resumes once the hold lifts.');
    const plain = childReclaimStuckSentence(W, DETAIL, refusalSentence, null);
    const held = childReclaimStuckHeld(plain);
    expect(held).toBe(`${plain.slice(0, -CHILD_RECLAIM_STUCK_RETRY.length)}${CHILD_RECLAIM_STUCK_HELD}`);
    expect(held).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(held).toContain(DETAIL);
    // A sentence that does not end with the retry clause (a kept one) is returned as it is.
    const kept = childReclaimStuckSentence(W, DETAIL, refusalSentence, 'coordinating');
    expect(childReclaimStuckHeld(kept)).toBe(kept);
  });

  it('ccd’s detail reaches the sentence as one bounded line: no control or bidi character, at most LC_LINE_MAX characters and one ellipsis (W8-SEC-2)', () => {
    // Any session on the fleet box can append a journal line, so its detail is untrusted text.
    const nonText = (t: string): boolean => [...t].some((c) => {
      const n = c.codePointAt(0)!;
      return n < 0x20 || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029
        || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
    });
    const big = `${'x'.repeat(4_000)}${String.fromCharCode(0x0a, 0x202e)}${'y'.repeat(5_998)}`;
    expect(big).toHaveLength(10_000);
    expect(nonText(big)).toBe(true);
    const s = childReclaimStuckSentence(W, big, refusalSentence, null);
    expect(nonText(s)).toBe(false);
    expect(s).toContain(childReclaimDetailText(big));
    const lead = 'What ccd found in the way: ';
    expect(s).toContain(lead);
    expect(s.endsWith(` ${CHILD_RECLAIM_STUCK_RETRY}`)).toBe(true);
    const part = s.slice(s.indexOf(lead) + lead.length, s.length - ` ${CHILD_RECLAIM_STUCK_RETRY}`.length);
    expect(part.length).toBeLessThanOrEqual(LC_LINE_MAX + 1);
    expect(part.startsWith('x'.repeat(100))).toBe(true);
    // The attention item, which the chip shares, says the same bounded line.
    expect(listOf([row({ detail: big })])[0]!.sentence).toBe(s);
  });

  it.each([null, '', String.fromCharCode(0x0a, 0x202e, 0x20)])('with no detail, or none left once made one line (%j), it says the record was cut and points to the feed', (detail) => {
    const s = listOf([row({ detail })])[0]!.sentence;
    expect(s).toMatch(/record was cut/);
    expect(s).toMatch(/“child reclaim failed” row/);
    expect(s).not.toMatch(/null|undefined/);
    expect(s).toContain(CHILD_RECLAIM_STUCK_RETRY);
  });

  it('past the ceiling it is still stuck, never failing: excluded from the failing-past-ceiling list', () => {
    expect(listOf([row({ failingSince: NOW - C - 1 })]).map((a) => a.kind)).toEqual(['stuck']);
  });

  it('a line ccd could not place (no at) is still listed, at null: it needs no clock', () => {
    expect(listOf([row({ at: null, failingSince: null })])).toMatchObject([{ kind: 'stuck', at: null }]);
  });

  it('a row that left the registry lists nothing', () => {
    expect(listOf([row()], [['demo-other', 9]])).toEqual([]);
  });

  it('a REFUSED line carrying the word is not stuck: ccd journals it only through _lc_fail', () => {
    expect(listOf([row({ outcome: 'refused' })])).toEqual([]);
  });

  it('terminal outranks stuck: a terminal refusal stays terminal under a classifier that calls every word stuck', () => {
    expect(listOf([row({ outcome: 'refused', refusal: 'not-a-child' })], [[ID, RUN]], () => true).map((a) => a.kind))
      .toEqual(['terminal']);
  });

  it('control: another failure word past the ceiling is still failing', () => {
    expect(listOf([row({ refusal: 'worktree-remove-failed', failingSince: NOW - C })]).map((a) => a.kind))
      .toEqual(['failing']);
  });
});

describe('precedence: stuck outranks kept, kept-many and failing, and held never withholds it (spec §5.9)', () => {
  it('a kept verdict gives a stuck child no kept item, and the list shows the stuck item alone', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'coordinating', runId: RUN }]]);
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms: arms });
    expect(kept).toEqual([]);
    expect(childReclaimAttentionWithKept(arms, kept, verdicts).map((a) => a.kind)).toEqual(['stuck']);
  });

  it('a stuck child is never a kept-many member: one past the collapse, minus the stuck one, stays single', () => {
    const ids = Array.from({ length: CHILD_RECLAIM_KEPT_MANY_OVER + 1 }, (_, k) => `demo-kept-${k + 1}`);
    const verdicts = new Map<string, ChildReclaimSweepVerdict>(
      ids.map((id) => [id, { eligible: false, why: 'coordinating', runId: RUN }]));
    const live = new Map<string, number | null>(ids.map((id) => [id, RUN]));
    // Guards the guard: without the stuck line the same children DO collapse.
    expect(childReclaimKeptList(childReclaimKeptItems({ verdicts, live, mirrorArms: [] })).map((a) => a.kind))
      .toEqual(['kept-many']);
    const arms = listOf([row({ sessionId: ids[0]! })], ids.map((id) => [id, RUN]));
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms: arms });
    expect(kept.map((a) => a.sessionId)).toEqual(ids.slice(1));
    expect(childReclaimAttentionWithKept(arms, kept, verdicts).map((a) => a.kind))
      .toEqual(['stuck', ...ids.slice(1).map(() => 'kept')]);
  });

  it('a held verdict withholds a failing item but never a stuck one', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([
      [ID, { eligible: false, why: 'held' }], ['demo-b', { eligible: false, why: 'held' }]]);
    const live = new Map<string, number | null>([[ID, RUN], ['demo-b', 8]]);
    const arms = listOf([row(), row({ sessionId: 'demo-b', refusal: 'worktree-remove-failed', failingSince: NOW - C })],
      [[ID, RUN], ['demo-b', 8]]);
    expect(arms.map((a) => `${a.kind}:${a.sessionId}`)).toEqual([`stuck:${ID}`, 'failing:demo-b']);
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms: arms });
    expect(childReclaimAttentionWithKept(arms, kept, verdicts).map((a) => `${a.kind}:${a.sessionId}`))
      .toEqual([`stuck:${ID}`]);
  });

  it('a KEPT child: its stuck item drops the retry clause and names the kept reason, under its own run only (T8 OPEN4)', () => {
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    const banner = (verdicts: Map<string, ChildReclaimSweepVerdict>) =>
      childReclaimAttentionWithKept(arms, childReclaimKeptItems({ verdicts, live, mirrorArms: arms }), verdicts);
    const own = banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'coordinating', runId: RUN }]]));
    expect(own).toEqual([{ ...arms[0]!, sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, 'coordinating') }]);
    expect(own[0]!.sentence).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(own[0]!.sentence).toContain(CHILD_RECLAIM_SKIP.coordinating.sentence);
    // A kept verdict judged under ANOTHER run's marker is a recycled slug's (spec §5.6): it says nothing of this item.
    expect(banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'coordinating', runId: RUN + 1 }]])))
      .toEqual(arms);
    // `held` drops the retry clause too, for the hold's (the held ruling, R41), with no run to match: a held
    // verdict carries none.
    expect(banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'held' }]])))
      .toEqual([{ ...arms[0]!, sentence: childReclaimStuckHeld(arms[0]!.sentence) }]);
    // A doubt word keeps the retry clause: the sweep reads that child again on its next pass.
    expect(banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'identity-unmeasured' }]])))
      .toEqual(arms);
  });

  it('a HELD child: its stuck item stays listed and drops the retry clause for the hold’s, with no run to match (the held ruling, R41)', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'held' }]]);
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    const out = childReclaimAttentionWithKept(arms, childReclaimKeptItems({ verdicts, live, mirrorArms: arms }), verdicts);
    expect(out).toEqual([{ ...arms[0]!,
      sentence: childReclaimStuckHeld(childReclaimStuckSentence(W, DETAIL, refusalSentence, null)) }]);
    expect(out[0]!.sentence).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(out[0]!.sentence).toContain(CHILD_RECLAIM_STUCK_HELD);
    expect(out[0]!.sentence).toContain(DETAIL);
  });
});

describe('the chip (spec §5.9): deferred, with the stuck item’s sentence, never refused', () => {
  type Ev = NonNullable<ChildReclaimStatusInput['event']>;
  const ev = (over: Partial<Ev> = {}): Ev =>
    ({ act: 'reclaim', outcome: 'failed', refusal: W, at: LINE_AT, detail: DETAIL, ...over });
  const marked: ChildReclaimStatusInput['row'] = { kind: 'row', child: { kind: 'child', runId: RUN } };
  const base = (over: Partial<ChildReclaimStatusInput> = {}): ChildReclaimStatusInput => ({
    run: { id: RUN, state: 'done', sessionId: ID }, event: ev(), row: marked, sessionHasOpenRun: false,
    reviewedRunNotTerminal: false, fleetPaused: false, deferredSince: null, verdict: { kind: 'eligible' },
    sweepFailing: false, journalFailingSince: null, ...over,
  });

  it.each([DETAIL, null])('detail %j: deferred, with the attention item’s own sentence, at the line’s time', (detail) => {
    expect(childReclaimStatus(base({ event: ev({ detail }) }))).toEqual({
      word: 'deferred', sentence: listOf([row({ detail })])[0]!.sentence, at: LINE_AT });
  });

  it('outranks every non-ordinary verdict (a kept word, held, a doubt word) and never reads refused', () => {
    for (const why of ['coordinating', 'held', 'identity-unmeasured'] as const) {
      const plain = childReclaimStuckSentence(W, DETAIL, refusalSentence, why === 'coordinating' ? why : null);
      expect(childReclaimStatus(base({ verdict: { kind: 'skip', why } })), why).toEqual({
        word: 'deferred', sentence: why === 'held' ? childReclaimStuckHeld(plain) : plain, at: LINE_AT });
    }
  });

  it('a kept verdict: the kept variant, never a retry, and the switch leaves it as it leaves every kept answer (T8 OPEN4)', () => {
    for (const why of CHILD_RECLAIM_KEPT_WORDS) {
      const s = childReclaimStatus(base({ verdict: { kind: 'skip', why } }));
      expect(s, why).toEqual({ word: 'deferred', sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, why), at: LINE_AT });
      expect(s!.sentence, why).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
      expect(childReclaimStatus(base({ verdict: { kind: 'skip', why }, fleetPaused: true })), why).toEqual(s);
    }
  });

  it('a HELD verdict on the chip: the hold’s clause, never a retry, the banner’s own sentence, and the switch turns it to paused (the held ruling, R41)', () => {
    const held = { kind: 'skip', why: 'held' } as const;
    const s = childReclaimStatus(base({ verdict: held }));
    expect(s).toEqual({ word: 'deferred',
      sentence: childReclaimStuckHeld(childReclaimStuckSentence(W, DETAIL, refusalSentence, null)), at: LINE_AT });
    expect(s!.sentence).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(s!.sentence).toContain(CHILD_RECLAIM_STUCK_HELD);
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'held' }]]);
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    expect(childReclaimAttentionWithKept(arms, childReclaimKeptItems({ verdicts, live, mirrorArms: arms }), verdicts)[0]!.sentence)
      .toBe(s!.sentence);
    // The hold's own deferred answer is switched (`waiting`), and so is this one: it says the sweep acts once the hold lifts.
    expect(childReclaimStatus(base({ verdict: held, fleetPaused: true })))
      .toEqual({ word: 'paused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.fleetPaused, at: null });
  });

  it('past the ceiling too: the stuck sentence, never the failing one', () => {
    expect(childReclaimStatus(base({ journalFailingSince: NOW - C }))).toMatchObject({
      word: 'deferred', sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, null) });
  });

  it('the fleet-wide switch turns it to paused, as it does every deferred', () => {
    expect(childReclaimStatus(base({ fleetPaused: true })))
      .toEqual({ word: 'paused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.fleetPaused, at: null });
  });

  it('a child that no longer stands as this run’s says nothing of its own', () => {
    expect(childReclaimStatus(base({ row: { kind: 'absent' } }))).toBeNull();
  });

  it('the PWA re-reads a deferred chip: deferred is unsettled there and refused is not (no PWA edit)', () => {
    const line = readFileSync(path.join(root, 'pwa/src/fleet/runWords.ts'), 'utf8')
      .split('\n').find((l) => l.startsWith('const CHILD_RECLAIM_UNSETTLED'));
    expect(line, 'CHILD_RECLAIM_UNSETTLED moved: re-point this pin by content').toBeDefined();
    expect(line).toContain("'deferred'");
    expect(line).not.toContain("'refused'");
  });
});

describe('the lane wires the one classifier (watch.ts wires, never decides)', () => {
  it('injects isChildReclaimStuckToken into the mirror arms, at the one call', () => {
    const calls = readFileSync(path.join(root, 'server/src/watch.ts'), 'utf8').match(/childReclaimAttention\(\{[^}]*\}\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('stuckOf: isChildReclaimStuckToken');
  });
});

/** The pre-crumb suite's rig: a closed minting run and a registry row, a scripted ccd, and the feed. */
const TOK = 'a'.repeat(64);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
const rig = async (verbStdout: string) => {
  const home = mkTmp('ccrc-child-reclaim-stuck-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
    started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const audit = JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, verdict: 'reclaimable', detail: '', token: TOK });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'ws-audit') return { code: 0, stdout: audit, stderr: '' };
    if (args[0] === 'ws-reclaim') return { code: 1, stdout: verbStdout, stderr: '' };
    return { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: CAPS,
    presence: { isVisible: () => false }, notifyLog };
  // Close's request: `licenceGeneration` none (Task 2), so the executor's generation re-read is skipped.
  const req: ChildReclaimRequest = { sessionId: ID, runId, trigger: 'close' as const, deferExpired: false,
    deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'none' } };
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  return { deps, req, bodies };
};

describe('the feed (spec §5.9)', () => {
  const STDOUT = JSON.stringify({ failed: W, detail: DETAIL, crumb: true });

  it('childReclaimFeedQuiet reads a listed stuck item like a failing one: its word, for that child only', () => {
    const entry = childReclaimFirstSighting(NOW, NOW - 3_600_000, RUN, { kind: 'absent' });
    expect(childReclaimFeedQuiet(entry, listOf([row()]), ID)).toEqual({ deferWhy: null, failureToken: W });
    expect(childReclaimFeedQuiet(entry, listOf([row()]), 'demo-other')).toEqual({ deferWhy: null, failureToken: null });
  });

  it('the failed row names what ccd found and says the stuck clause, never "resumes where it stopped"', async () => {
    const s = await rig(STDOUT);
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'stuck', token: W });
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain(`${W}: ${DETAIL}`);
    expect(s.bodies()[0]).toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
    expect(s.bodies()[0]).not.toContain('retried from the start');
  });

  it('a retry that finds the same word while the child is listed stuck writes no new row', async () => {
    const s = await rig(STDOUT);
    const entry = childReclaimFirstSighting(NOW, NOW - 3_600_000, RUN, { kind: 'absent' });
    const req = { ...s.req, feedQuiet: childReclaimFeedQuiet(entry, listOf([row()]), ID) };
    expect(await reclaimChild(s.deps, req)).toMatchObject({ kind: 'failed', resume: 'stuck', token: W });
    expect(s.bodies()).toEqual([]);
  });
});
```

Do not edit `server/test/containment-refuted-word.test.ts`: Task 6 flipped its one `parseChildReclaimResult` assertion to `resume: 'stuck'` in its own commit (H3). Step 4 runs the file as a regression check.

Edit `server/test/child-reclaim-pre-crumb.test.ts`: review 341's F9, re-aimed. Task 8 keeps this re-aim (H3). The line passes at this task's start, because Task 6's admission is already in place: it is a pin, and mutation 4 is its red. In the case `the kebab scanner’s guard admits both pre-breadcrumb words and not pin-failed` (`grep -n "the kebab scanner’s guard admits" server/test/child-reclaim-pre-crumb.test.ts`):
- The title becomes `the kebab scanner’s guard admits probe-unmeasured and the stuck word, and not pin-failed`.
- `    expect(isChildReclaimKebab('state-changed')).toBe(true);` becomes `    expect(isChildReclaimKebab('containment-refuted'), 'admitted only by the stuck set').toBe(true);`.

`state-changed`'s place in the pre-breadcrumb set stays pinned by the case at :37-40.

Edit the two suites that build the types this task widens. Each edit below adds the new required field and weakens no assertion:
- `server/test/child-reclaim-sweep-policy.test.ts`:
  - Add `isChildReclaimStuckToken` to the `import { childReclaimTokenKind } from '../src/coord/childReclaim.js';` line, which becomes `import { childReclaimTokenKind, isChildReclaimStuckToken } from '../src/coord/childReclaim.js';`.
  - In `carries a refusal as it is, with no failure run` (`grep -n "refusal: 'tree-unreadable', at: NOW, failingSince: null });" server/test/child-reclaim-sweep-policy.test.ts`), the expected `{ … at: NOW, failingSince: null }` becomes `{ … at: NOW, failingSince: null, detail: null }`. That `toEqual` pins the row's WHOLE shape, and the `ev` fixture's `detail` is `null`.
  - The `row` helper (`grep -n "sessionId: 'demo-a', outcome: 'refused', refusal: 'tree-unreadable', at: NOW, failingSince: null, ...over" …`) gains `detail: null,` before `...over`.
  - The `refusal` helper (`grep -n "({ sessionId: 'demo-a', outcome: 'refused', refusal: token, at: NOW, failingSince: null })" …`) gains `, detail: null`.
  - The `input` helper's object (`grep -n "^    kindOf,$" …`) gains the line `    stuckOf: isChildReclaimStuckToken,` after `kindOf,`.
  - In `attentionOf` (`grep -n "latest: \[row!\], live, kindOf: childReclaimTokenKind" …`), `kindOf: childReclaimTokenKind,` becomes `kindOf: childReclaimTokenKind, stuckOf: isChildReclaimStuckToken,`.
- `server/test/child-reclaim-status.test.ts`:
  - Add `isChildReclaimStuckToken` to the `../src/coord/childReclaim.js` import.
  - At :403-405 (`grep -n "latest: \[{ sessionId: SID, outcome, refusal, at: EV_AT, failingSince: AT }\]" …`), the row gains `detail: null`, and `kindOf: childReclaimTokenKind,` becomes `kindOf: childReclaimTokenKind, stuckOf: isChildReclaimStuckToken,`.

- [ ] **Step 2: Run the tests to verify they fail**

Run each command in the FOREGROUND, timeout 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-stuck.test.ts
cd server && ./node_modules/.bin/vitest run test/containment-refuted-word.test.ts test/child-reclaim-pre-crumb.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts test/child-reclaim-status.test.ts
```

Expected:
- **`child-reclaim-stuck`:** FAIL.
  - Every case that calls a new L1 export fails with `TypeError: … is not a function`: `childReclaimStuckSentence`, `childReclaimStuckKept`, `childReclaimStuckKeptClause` and `childReclaimStuckHeld`. That covers the sentence-built expectations of the attention, kept-variant, held-variant, bounded-detail, chip and banner cases, the two HELD cases and the third no-detail row included. `CHILD_RECLAIM_STUCK_RETRY`'s `toBe` reads `undefined`, and so does `CHILD_RECLAIM_STUCK_HELD`'s. `childReclaimDetailText` is Task 7's and already exists. The failing count is re-measure (R-j).
  - `childReclaimAttention` has no stuck arm yet, so `listOf` lists nothing for a stuck row. The no-`at` case fails with `expected [] to match object [ { kind: 'stuck', at: null } ]`, the ceiling case with `expected [] to deeply equal [ 'stuck' ]`, and the precedence cases on their first `toEqual`.
  - The rig's feed case fails on `toContain(CHILD_RECLAIM_STUCK_RETRY)`, which reads `undefined`. Its `resume: 'stuck'` and its tail are already Task 6's. The quiet case fails with `expected [ '…' ] to deeply equal []`: no stuck item is listed yet, so `feedQuiet` carries no failure word and the row is written.
  - The wiring case fails with `expected '…' to contain 'stuckOf: isChildReclaimStuckToken'`.
  - These PASS, because each pins what Task 6 already did (H3) or what this task must keep: the stuck-set describe and the parse describe (consumer pins of Task 6's arm), the `worktree-remove-failed` control, `a row that left the registry`, the REFUSED-line case, the terminal-under-an-all-stuck-classifier case, the failing control, the switch-to-paused and no-longer-stands chip cases, and the PWA `CHILD_RECLAIM_UNSETTLED` pin.
- **`containment-refuted-word`:** not edited here; green, as Task 6 left it.
- **`child-reclaim-pre-crumb`:** green. The re-aimed case passes, because Task 6 already admits the word (H3); mutation 4 is its red.
- **`child-reclaim-sweep-policy`:** `carries a refusal as it is, with no failure run` fails, because its `toEqual` diff shows `"detail": null` expected and absent received. Every other case passes: vitest does not typecheck, and nothing yet reads `stuckOf`.

- [ ] **Step 3: Implement**

**3a–3d. None.** The stuck set, its type and guard, `ChildReclaimResume`'s `'stuck'`, the kebab admission and the word-first parse arm are Task 6's, committed before this task starts (H3). Do not declare, re-admit or re-parse any of them here.

**3e. The feed row: one spelling of the retry clause.** Extend the `../childReclaimSweep.js` import block with `CHILD_RECLAIM_STUCK_RETRY, childReclaimStuckHeld, childReclaimStuckRow, childReclaimStuckSentence,`. In Task 6's `childReclaimFailedTail` (`grep -n "^export function childReclaimFailedTail" server/src/coord/childReclaim.ts`), its `case 'stuck':` return

```ts
      return 'While automatic reclamation runs, ccrc retries it on its long backoff; the box resumes from its breadcrumb once the tree or row is fixed.';
```

becomes

```ts
      return CHILD_RECLAIM_STUCK_RETRY;
```

The bytes are identical, so Task 6's exact-text pins in `child-reclaim-failed-arm.test.ts` stay green, and one spelling remains. Add no `'stuck'` case to `childReclaimFeedBody`: its failed arm calls `childReclaimFailedTail`, which already has one. Leave Task 6's comment above the case as it is.

**3f. The chip.** `export type ChildReclaimEvent = Pick<MirroredLifecycleEvent, 'act' | 'outcome' | 'refusal' | 'at'>;` becomes `export type ChildReclaimEvent = Pick<MirroredLifecycleEvent, 'act' | 'outcome' | 'refusal' | 'at' | 'detail'>;`. Add `isChildReclaimKeptWord` to the `../../../shared/api.js` import. In `childReclaimStatus`, between the `const marked = …;` statement and `if (marked && input.verdict.kind === 'skip') {`, add:

```ts
  // STUCK (spec §5.9): ccd PROVED another tree or registry row stands in this workspace's way. The chip
  // says what the attention item says, from the same composer, at the line's own time. `deferred`, never
  // `refused`: the PWA treats `refused` as settled and never re-reads it, and a fixed tree completes on a
  // later pass. It answers ahead of the sweep's verdict, because the stuck item outranks a kept or held
  // item on the banner. Like every failure line, it speaks only for a child that still stands as this
  // run's (`marked`). For a child the sweep KEEPS (T8 OPEN4, R41), the sentence drops the retry clause and
  // names the kept reason instead; it promises no retry, so the switch leaves it as it leaves every kept
  // answer. For a child the sweep HOLDS (the held ruling, R41), the sentence drops the retry clause for the
  // hold's: no retry while the hold stands, the long backoff once it lifts. The same rewrite the banner
  // makes (`childReclaimStuckHeld`). It still says the sweep acts once the hold lifts, so, like the verdict
  // arm's own held answer, the switch turns it to `paused`. Every other stuck answer promises a retry, and
  // the switch turns it to `paused`.
  if (event !== null && marked && childReclaimStuckRow(event, isChildReclaimStuckToken)) {
    const kept = input.verdict.kind === 'skip' && isChildReclaimKeptWord(input.verdict.why) ? input.verdict.why : null;
    const held = input.verdict.kind === 'skip' && input.verdict.why === 'held';
    const sentence = childReclaimStuckSentence(event.refusal, event.detail, refusalSentence, kept);
    const stuck: ChildReclaimStatus = {
      word: 'deferred', sentence: held ? childReclaimStuckHeld(sentence) : sentence, at: event.at };
    return kept === null ? waiting(stuck) : stuck;
  }
```

In the function's numbered docstring, add after rule 2's paragraph:

```ts
 * 2a. STUCK, where the gate holds: the generation's latest event is a failure carrying a stuck word
 *    (`childReclaimStuckRow`) → deferred, with the attention item's own sentence and the line's time.
 *    It outranks the verdict (3) and every remaining event (4), and is never `refused`. A KEPT verdict
 *    swaps the retry clause for the kept reason (T8 OPEN4), and the switch never replaces that answer.
 *    A HELD verdict swaps it for the hold's clause (`childReclaimStuckHeld`, the held ruling), and the
 *    switch replaces that answer as it replaces the hold's own deferred one.
```

**3g. `server/src/childReclaimSweep.ts`.**

`ChildReclaimJournalRow` gains one field after `failingSince`:

```ts
  /** The line's own `detail`: ccd's words for a person, DISPLAY-ONLY. The stuck item's sentence carries
   *  it, because it names the tree or row to fix (spec §5.9). Null when the line carried none. */
  readonly detail: string | null;
```

In `childReclaimJournalRow`, `return { sessionId: latest.id, outcome: latest.outcome, refusal: latest.refusal, at: latest.at, failingSince };` becomes `return { sessionId: latest.id, outcome: latest.outcome, refusal: latest.refusal, at: latest.at, failingSince, detail: latest.detail };`.

`childReclaimTerminalRefusal`'s parameter `row: ChildReclaimJournalRow,` becomes `row: Omit<ChildReclaimJournalRow, 'detail'>,`. The body is unchanged. Add to its docstring: `It reads two fields. It is typed as the row without \`detail\`, so a caller holding a row from before that field still compiles.`

Directly after `childReclaimFailingWord`, add:

```ts
/** What ccrc does next for a STUCK child (spec §5.9), said once for the attention item, the chip and the
 *  feed row. It is CONDITIONAL for `childReclaimFailingSentence`'s reason: while `reclaim-paused` stands,
 *  or the fleet box lacks the reclaim capabilities, the item stays listed and nothing retries it. */
export const CHILD_RECLAIM_STUCK_RETRY =
  'While automatic reclamation runs, ccrc retries it on its long backoff; the box resumes from its breadcrumb once the tree or row is fixed.';

/** A `reclaim` line in the STUCK class (spec §5.9): a FAILURE carrying a stuck word. ccd journals the word
 *  only through `_lc_fail`, so a refusal carrying it is not stuck. `stuckOf` is injected, because L1
 *  imports L0 alone: the set lives in `coord/childReclaim.ts` (`isChildReclaimStuckToken`). A stuck line is
 *  a failure line too (`childReclaimFailureLine`), and is never terminal. */
export const childReclaimStuckRow = <R extends { readonly outcome: string; readonly refusal: string | null }>(
  row: R, stuckOf: (token: string) => boolean,
): row is R & { readonly refusal: string } => row.outcome === FAILED && row.refusal !== null && stuckOf(row.refusal);

/** A sentence end for ccd's detail. An ellipsis ends a detail `childReclaimDetailText` cut (W8-SEC-2), so it takes no stop. */
const childReclaimStuckEnd = (t: string): string => (/[.!?…]$/.test(t) ? t : `${t}.`);

/** What a stuck sentence says in place of the retry clause for a child the sweep KEEPS (ruling T8 OPEN4,
 *  R41): the child is kept, and why, in the sweep table's own kept sentence. It promises no retry, because
 *  a kept child is never asked. */
export const childReclaimStuckKeptClause = (kept: ChildReclaimKeptWord): string =>
  `The sweep keeps this child for a person: ${CHILD_RECLAIM_SKIP[kept].sentence}`;

/** A stuck sentence for a KEPT child (T8 OPEN4): the retry clause, which by construction ends every
 *  `childReclaimStuckSentence` composed with no kept word, gives way to `childReclaimStuckKeptClause`. ONE
 *  rewrite, read by the composer below (the chip) and by `childReclaimAttentionWithKept` (the banner), which
 *  holds the verdicts the mirror arm never sees. A sentence that does not end with the clause is returned
 *  as it is. */
export const childReclaimStuckKept = (sentence: string, kept: ChildReclaimKeptWord): string => {
  const retry = ` ${CHILD_RECLAIM_STUCK_RETRY}`;
  return sentence.endsWith(retry) ? `${sentence.slice(0, -retry.length)} ${childReclaimStuckKeptClause(kept)}` : sentence;
};

/** What a stuck sentence says in place of the retry clause for a child the sweep HOLDS (the coordinator's
 *  held ruling, R41): a held child is never asked while the hold stands, so nothing retries it then, and
 *  its long backoff resumes once the hold lifts. */
export const CHILD_RECLAIM_STUCK_HELD =
  'This workspace carries a hold, so ccrc does not retry it while the hold stands; its long backoff resumes once the hold lifts.';

/** A stuck sentence for a HELD child (the held ruling): the retry clause, which ends every
 *  `childReclaimStuckSentence` composed with no kept word, gives way to `CHILD_RECLAIM_STUCK_HELD`. ONE
 *  rewrite, read by the chip (`childReclaimStatus`) and by `childReclaimAttentionWithKept` (the banner). A
 *  sentence that does not end with the retry clause (a kept one) is returned as it is. */
export const childReclaimStuckHeld = (sentence: string): string => {
  const retry = ` ${CHILD_RECLAIM_STUCK_RETRY}`;
  return sentence.endsWith(retry) ? `${sentence.slice(0, -retry.length)} ${CHILD_RECLAIM_STUCK_HELD}` : sentence;
};

/** The stuck item's sentence (spec §5.9), composed ONCE for the attention item and the chip, so the two
 *  say the same thing of one line. It is ccd's word for the token, then what ccd recorded as standing in
 *  the way, then the conditional retry clause, or, for a child kept under a `kept` word, the kept clause
 *  in its place (T8 OPEN4). The detail is any session's text (identity on the fleet box is attribution), so
 *  it is carried only as Task 7's `childReclaimDetailText` makes it: one line, bounded (W8-SEC-2). A line
 *  with no detail, or none left once made one line, says the record was cut and points to the feed, whose
 *  failed row carries ccd's printed detail. The word's lookup order is `childReclaimFailingWord`'s: the
 *  journal map first, the server's lookup second. */
export const childReclaimStuckSentence = (token: string, detail: string | null,
  sentenceFor: (token: string) => string, kept: ChildReclaimKeptWord | null): string => {
  const word = lcRefusalWord(token) ?? sentenceFor(token);
  const shown = detail === null ? '' : childReclaimDetailText(detail);
  const what = shown === ''
    ? 'The journal record was cut, so it does not name the tree or row in the way; this child’s “child reclaim failed” row in the feed names it.'
    : `What ccd found in the way: ${childReclaimStuckEnd(shown)}`;
  const sentence = `${word} ${what} ${CHILD_RECLAIM_STUCK_RETRY}`;
  return kept === null ? sentence : childReclaimStuckKept(sentence, kept);
};
```

`ChildReclaimAttentionInput` gains one field after `kindOf`:

```ts
  /** The STUCK classifier (`coord/childReclaim.ts`'s `isChildReclaimStuckToken`), injected for `kindOf`'s
   *  reason: L1 imports L0 alone. */
  readonly stuckOf: (token: string) => boolean;
```

`ChildReclaimJournalAttention`'s `{ readonly kind: 'terminal' | 'failing' }` becomes `{ readonly kind: 'terminal' | 'stuck' | 'failing' }`, and its docstring `The two arms` becomes `The three arms`.

Replace `childReclaimAttention`'s loop body, from `    if (!i.live.has(row.sessionId)) continue;` to the end of the `else if (childReclaimFailingPastCeiling…) { … }` block, with:

```ts
    if (!i.live.has(row.sessionId)) continue;
    const runId = i.live.get(row.sessionId) ?? null;
    // TERMINAL first: ccd's settled word. Unplaceable (no `at`) lists nothing.
    if (row.at !== null && childReclaimTerminalRefusal(row, i.kindOf)) {
      out.push({
        kind: 'terminal', sessionId: row.sessionId, runId, token: row.refusal!, sentence: i.sentenceFor(row.refusal!),
        // Since when: the refusal's own line, on ccd's clock.
        at: row.at,
      });
      continue;
    }
    // STUCK (spec §5.9): at once, with no ceiling, because nothing a wait can change is left. It needs no
    // clock to be listed, so a line ccd did not place is listed at `null`. It outranks the failing arm
    // below, so a stuck child never reads "every attempt has failed" with a retry promise that ccd will
    // refuse the same way.
    if (childReclaimStuckRow(row, i.stuckOf)) {
      out.push({
        kind: 'stuck', sessionId: row.sessionId, runId, token: row.refusal,
        // No kept word here: the verdicts are not this derivation's. `childReclaimAttentionWithKept` swaps
        // a kept child's clause (T8 OPEN4).
        sentence: childReclaimStuckSentence(row.refusal, row.detail, i.sentenceFor, null), at: row.at,
      });
      continue;
    }
    // Unplaceable: no `at`, no failing item.
    if (row.at === null) continue;
    if (childReclaimFailingPastCeiling(row, i.nowMs)) {
      const word = childReclaimFailingWord(row.refusal, i.sentenceFor);
      out.push({
        kind: 'failing', sessionId: row.sessionId, runId, token: row.refusal ?? '', sentence: childReclaimFailingSentence(word),
        // Since when: the start of the run of failures, not its latest line.
        at: row.failingSince!,
      });
    }
```

In its docstring, after `…a failure closing a run of failures that has lasted the ceiling,` insert ` or — at once — a failure carrying a STUCK word (\`childReclaimStuckRow\`), which outranks the failing arm,`.

In `childReclaimKeptItems`:
- `  const terminal = new Set(i.mirrorArms.filter((a) => a.kind === 'terminal').map((a) => a.sessionId));` becomes `  const outranks = new Set(i.mirrorArms.filter((a) => a.kind === 'terminal' || a.kind === 'stuck').map((a) => a.sessionId));`.
- `    if (terminal.has(sessionId)) continue;` becomes `    if (outranks.has(sessionId)) continue;`.
- In the docstring, `and that has no \`terminal\` item, because ccd's own terminal word outranks the sweep's, as on the chip.` becomes `and that has no \`terminal\` or \`stuck\` item, because ccd's own word outranks the sweep's, as on the chip. A stuck child is therefore never a kept or a kept-many member.`

`childReclaimAttentionWithKept` changes in one place (T8 OPEN4). In its `return [`, the first element

```ts
    ...mirrorArms.filter((a) => !(a.kind === 'failing' && (keptIds.has(a.sessionId) || heldIds.has(a.sessionId)))),
```

becomes

```ts
    ...mirrorArms.filter((a) => !(a.kind === 'failing' && (keptIds.has(a.sessionId) || heldIds.has(a.sessionId))))
      .map((a) => {
        // A STUCK item for a child the sweep KEEPS under the run the item names (T8 OPEN4, R41): its retry
        // clause gives way to the kept reason. A kept verdict under another run is a recycled slug's (§5.6).
        // A STUCK item for a child the sweep HOLDS (the held ruling, R41): its retry clause gives way to the
        // hold's, because a held child is never asked while the hold stands. No run to match: a held verdict
        // carries none, and `heldIds` withholds the failing item on the same reading.
        if (a.kind !== 'stuck') return a;
        if (heldIds.has(a.sessionId)) return { ...a, sentence: childReclaimStuckHeld(a.sentence) };
        const v = verdicts.get(a.sessionId);
        return v !== undefined && isChildReclaimKeptVerdict(v) && v.runId === a.runId
          ? { ...a, sentence: childReclaimStuckKept(a.sentence, v.why) } : a;
      }),
```

Keep any parameter Task 7 added. Its docstring's last sentence `With no verdict recorded the failing arm stands as it always did.` gains: ` A \`stuck\` item is never filtered: \`held\` never withholds it, and the kept arm never lists its child. For a child kept under the run the item names, its retry clause gives way to the kept reason (\`childReclaimStuckKept\`), so the banner never promises a retry the kept word prevents (R41). For a held child it gives way to the hold's clause (childReclaimStuckHeld), with no run to match, so the banner never promises a retry the hold prevents (the held ruling).`

In `ChildReclaimFeedQuiet`, the `failureToken` docstring becomes: `The token of this child's \`failing\` or \`stuck\` attention item, or null when neither arm lists it, or the failing arm lists it with no token.`

In `childReclaimFeedQuiet`, replace the two lines

```ts
  const failing = listed.find((a) => a.kind === 'failing' && a.sessionId === sessionId);
  const failureToken = failing !== undefined && failing.kind === 'failing' && failing.token !== '' ? failing.token : null;
```

with

```ts
  // A listed STUCK item is read like a failing one (spec §5.9): a retry that finds the same word writes no new row.
  const failing = listed.find((a) => (a.kind === 'failing' || a.kind === 'stuck') && a.sessionId === sessionId);
  const failureToken = failing !== undefined && (failing.kind === 'failing' || failing.kind === 'stuck') && failing.token !== ''
    ? failing.token : null;
```

and in its docstring, `\`failureToken\` is the word of this child's \`failing\` item` becomes `\`failureToken\` is the word of this child's \`failing\` or \`stuck\` item`.

**3h. `server/src/watch.ts`: wiring only.** Add `isChildReclaimStuckToken,` to the `./coord/childReclaim.js` import. Then

```ts
      latest, live, kindOf: childReclaimTokenKind, sentenceFor: refusalSentence, nowMs: now,
```

becomes

```ts
      latest, live, kindOf: childReclaimTokenKind, stuckOf: isChildReclaimStuckToken, sentenceFor: refusalSentence, nowMs: now,
```

- [ ] **Step 4: Run the tests to verify they pass, then tsc**

Run each command in the FOREGROUND, timeout 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-stuck.test.ts test/containment-refuted-word.test.ts test/child-reclaim-pre-crumb.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts test/child-reclaim-status.test.ts test/child-reclaim-verdict-readers.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/ccd-child-reclaim-prelock-journal.test.ts test/lifecycle-refusal-word.test.ts test/child-reclaim-failed-arm.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'
cd server && ./node_modules/.bin/vitest run test/child-reclaim-chip-source.test.ts test/single-definition.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: all green, and `tsc` prints nothing.
- `child-reclaim-stuck`: every case passes.
- `containment-refuted-word`: green as Task 6 left it (not edited here, H3). Its `parseExpireResult` case still reads `resumable: true`.
- `child-reclaim-failed-arm` (Task 6's): green, because the re-pointed `'stuck'` case returns the same bytes.
- `mail-routes`' kebab scanner admits `containment-refuted` through `isChildReclaimKebab`.
- `typecheck-tests` compiles every edited fixture. `ccd-child-reclaim-prelock-journal.test.ts` and wave 7's `childReclaimTerminalRefusal` literal compile unedited, under `Omit<ChildReclaimJournalRow, 'detail'>`.

- [ ] **Step 5: Confirm the PWA needs no edit**

```bash
grep -n "const CHILD_RECLAIM_UNSETTLED" pwa/src/fleet/runWords.ts
grep -n "typeof o.sessionId === 'string' && typeof o.sentence === 'string'" pwa/src/fleet/childReclaimWords.ts
git diff --name-only HEAD -- pwa ccd agent shared
```

Expected:
- The first grep prints the set holding `'pending', 'deferred', 'paused'`. A stuck chip is `deferred`, so `childReclaimRefreshDue` and `childReclaimDoneRefreshDue` re-read the board for it. Both read only this set, at runWords.ts:716 and :742.
- The second grep prints `isAttention`'s check. A stuck item carries a string `sessionId` and `sentence` and a `number | null` `runId`, so `childReclaimAttentionOf` renders it with no change. The reader ignores `kind`, `token` and `at`.
- The diff prints nothing.

- [ ] **Step 6: Mutation check**

Make each mutation alone on the Step 4 tree. Run its command in the FOREGROUND, under 600 s, see the stated red, then revert. STK is `test/child-reclaim-stuck.test.ts`. Every command runs as `cd server && ./node_modules/.bin/vitest run <file> [-t '<case>']`.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 3 | In Task 6's declaration, `CHILD_RECLAIM_STUCK_TOKENS = ['containment-refuted']` becomes `= []` (a consumer pin; Task 6's 'the stuck set is one journal word' reds too) | STK `-t 'is exactly containment-refuted'` | `expected [] to deeply equal [ 'containment-refuted' ]` |
| 4 | Delete `\|\| isChildReclaimStuckToken(v)` from Task 6's `isChildReclaimKebab` line (review 341's F9, re-aimed; H3 keeps this row with Task 8) | `test/child-reclaim-pre-crumb.test.ts -t 'kebab'`; then `test/mail-routes.test.ts -t 'every quoted kebab token'` | `admitted only by the stuck set: expected false to be true`; then `containment-refuted is not a declared MailRejectCode, … dead-coordinator word: expected false to be true` (the second only if no other guard admits the word; see open issues) |
| 5 | In `childReclaimStuckRow`, delete `row.outcome === FAILED && ` | STK `-t 'REFUSED line'` | `expected [ { kind: 'stuck', … } ] to deeply equal []` |
| 6 | Move 3g's stuck block below `if (row.at === null) continue;` | STK `-t 'could not place'` | `expected [] to match object [ { kind: 'stuck', at: null } ]` |
| 7 | Move 3g's stuck block below the failing block (and drop its `continue`) | STK `-t 'past the ceiling it is still stuck'` | `expected [ 'failing', 'stuck' ] to deeply equal [ 'stuck' ]` |
| 8 | Wrap the stuck push in `if (childReclaimFailingPastCeiling(row, i.nowMs)) { … }` | STK `-t 'AT ONCE'` | `expected [] to deeply equal [ { kind: 'stuck', … } ]` |
| 9 | In `childReclaimStuckSentence`, the value arm `` `What ccd found in the way: ${…}` `` becomes `''` | STK `-t 'AT ONCE'` | `expected '…' to contain 'registry row demo-twin lies inside /w/demo-quiet-basin'` |
| 10 | The no-detail arm becomes `''` | STK `-t 'record was cut'` | `expected '…' to match /record was cut/` (every row of the `each`; the count is re-measure (R-j)) |
| 11 | `CHILD_RECLAIM_STUCK_RETRY` loses `While automatic reclamation runs, ` | STK `-t 'conditional'` | `expected 'ccrc retries it on its long backoff; …' to be 'While automatic reclamation runs, …'` |
| 12 | In `childReclaimKeptItems`, `a.kind === 'terminal' \|\| a.kind === 'stuck'` becomes `a.kind === 'terminal'` | STK `-t 'precedence'` | the kept case: `expected [ { kind: 'kept', … } ] to deeply equal []`; the kept-many case: `expected [ 'demo-kept-1', … ] to deeply equal [ 'demo-kept-2', … ]` |
| 13 | In `childReclaimAttentionWithKept`, `a.kind === 'failing' &&` becomes `(a.kind === 'failing' \|\| a.kind === 'stuck') &&` | STK `-t 'held verdict'` | `expected [] to deeply equal [ 'stuck:demo-quiet-basin' ]` |
| 14 | In `childReclaimStatus`, move 3f's stuck block below the verdict arm's closing `}` | STK `-t 'non-ordinary verdict'` | `coordinating: expected { word: 'refused', … } to deeply equal { word: 'deferred', … }` |
| 15 | 3f's `word: 'deferred'` becomes `word: 'refused'` | STK `-t 'the chip'` | `expected { word: 'refused', … } to deeply equal { word: 'deferred', … }` |
| 16 | Delete `marked && ` from 3f's condition | STK `-t 'no longer stands'` | `expected { word: 'deferred', … } to be null` |
| 17 | 3f's `return kept === null ? waiting(stuck) : stuck;` becomes `return stuck;` | STK `-t 'switch turns it to paused'` | `expected { word: 'deferred', … } to deeply equal { word: 'paused', … }` |
| 18 | 3f's sentence becomes `childReclaimFailingSentence(childReclaimFailingWord(event.refusal, refusalSentence))` | STK `-t 'attention item’s own sentence'` | a `toEqual` diff on `sentence`, both `each` rows |
| 19 | In `childReclaimFeedQuiet`, both `(a.kind === 'failing' \|\| a.kind === 'stuck')` become `a.kind === 'failing'` (and the second `failing.kind === 'failing'`) | STK `-t 'the feed'` | `failureToken: null` received where `'containment-refuted'` is expected; then `expected [ '…' ] to deeply equal []` in the retry case |
| 20 | In `childReclaimFailedTail`, `case 'stuck':`'s `return CHILD_RECLAIM_STUCK_RETRY;` becomes `return 'It is retried; the box resumes where it stopped.';` | STK `-t 'names what ccd found'` | `expected '…' to contain 'While automatic reclamation runs, …'` (Task 6's exact-text pins red too) |
| 22 | In watch.ts, `stuckOf: isChildReclaimStuckToken` becomes `stuckOf: () => false` | STK `-t 'injects isChildReclaimStuckToken'` | `expected '…' to contain 'stuckOf: isChildReclaimStuckToken'` |
| 23 | In `childReclaimJournalRow`, drop `, detail: latest.detail` (so `detail` is undefined) | `test/child-reclaim-sweep-policy.test.ts -t 'carries a refusal as it is'` | a `toEqual` diff, `"detail": null` expected |
| 24 | In 3f, the `kept` ternary's value becomes `null` | STK `-t 'kept variant'` | `coordinating: expected { …, sentence: '… While automatic reclamation runs, …' } to deeply equal { …, sentence: '… The sweep keeps this child for a person: …' }` |
| 25 | In 3f, `return kept === null ? waiting(stuck) : stuck;` becomes `return waiting(stuck);` | STK `-t 'kept variant'` | `coordinating: expected { word: 'paused', … } to deeply equal { word: 'deferred', … }` |
| 26 | In `childReclaimAttentionWithKept`, delete the `.map((a) => { … })` | STK `-t 'KEPT child: its stuck item'` | a `toEqual` diff on `sentence`: the retry clause received where the kept clause is expected |
| 27 | In that `.map`, delete `&& v.runId === a.runId` | STK `-t 'KEPT child: its stuck item'` | the another-run line: a `toEqual` diff, `'… The sweep keeps this child for a person: …'` received where `'… While automatic reclamation runs, …'` is expected |
| 28 | In `childReclaimStuckKept`, return `sentence` unchanged | STK `-t 'retry clause gives way'` | `expected '… While automatic reclamation runs, …' to be '… The sweep keeps this child for a person: …'`, every kept word |
| 29 | `childReclaimStuckKeptClause` drops `${CHILD_RECLAIM_SKIP[kept].sentence}` | STK `-t 'retry clause gives way'` | `expected 'The sweep keeps this child for a person: ' to contain '…'`, every kept word |
| 30 | In `childReclaimAttentionWithKept`'s `.map`, delete `if (heldIds.has(a.sessionId)) return { ...a, sentence: childReclaimStuckHeld(a.sentence) };` | STK `-t 'HELD child'`; then STK `-t 'KEPT child: its stuck item'`; then STK `-t 'HELD verdict on the chip'` | a `toEqual` diff on `sentence`: `'… While automatic reclamation runs, …'` received where `'… This workspace carries a hold, …'` is expected (the KEPT case's held line reds the same way; the chip case reds on its banner `toBe`) |
| 31 | In 3f, `sentence: held ? childReclaimStuckHeld(sentence) : sentence` becomes `sentence` | STK `-t 'HELD verdict on the chip'`; then STK `-t 'non-ordinary verdict'` | `expected { word: 'deferred', sentence: '… While automatic reclamation runs, …', … } to deeply equal { …, sentence: '… This workspace carries a hold, …', … }`; the second: the same diff under `held` |
| 32 | In 3f, `return kept === null ? waiting(stuck) : stuck;` becomes `return kept === null && !held ? waiting(stuck) : stuck;` | STK `-t 'HELD verdict on the chip'` | `expected { word: 'deferred', … } to deeply equal { word: 'paused', … }` |
| 33 | `childReclaimStuckHeld` returns `sentence` unchanged | STK `-t 'hold clause replaces'` | `expected '… While automatic reclamation runs, …' to be '… This workspace carries a hold, …'` |
| 34 | In `childReclaimStuckSentence`, `childReclaimDetailText(detail)` becomes `detail` | STK `-t 'one bounded line'` | `expected true to be false` (the control-character scan, its first red) |
| 35 | In `childReclaimStuckSentence`, `shown === ''` becomes a test of the raw `detail` (null or empty) | STK `-t 'record was cut'` | the third `each` row: `expected '… What ccd found in the way: . …' to match /record was cut/` |
| 36 | `childReclaimStuckEnd`'s `/[.!?…]$/` becomes `/[.!?]$/` | STK `-t 'one bounded line'` | `expected 2050 to be less than or equal to 2049` (the numbers are re-measure (R-j); this red needs Task 7's cut to end in `…`) |

Rows 1, 2 and 21 of the draft are gone (H3): the parse arm and the switch's `'stuck'` case are Task 6's, and Task 6's own mutation rows are their reds. Their numbers are not reused.

These mutants have no red of their own, by construction:
- Swapping the terminal and stuck blocks in `childReclaimAttention`, or moving 3f above the settled arm in `childReclaimStatus`. `childReclaimStuckRow` reads `failed` and a terminal refusal reads `refused`, so no line is both. The case `terminal outranks stuck…` pins that disjointness under an all-stuck classifier, and mutation 5 is its red.
- Changing the parameter type of `childReclaimTerminalRefusal`. That is type-only, and `typecheck-tests` holds it.

Revert every mutation, then re-run Step 4 green.

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/childReclaim.ts server/src/childReclaimSweep.ts server/src/watch.ts \
  server/test/child-reclaim-stuck.test.ts \
  server/test/child-reclaim-pre-crumb.test.ts server/test/child-reclaim-sweep-policy.test.ts \
  server/test/child-reclaim-status.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): containment-refuted is the stuck class

ccd prints containment-refuted when it proved that another tree or
registry row stands in the child's workspace. A retry finds the same thing
until a person moves it. Task 6 reads the word as resume 'stuck'; this
commit makes the attention list, the chip and the feed treat it as its
own class.

- The attention list names the child at once, in one stuck item. The item
  carries ccd's word, the journal row's detail (ChildReclaimJournalRow
  gains detail), or "the record was cut" pointing at the feed, and a
  conditional retry clause. A terminal item outranks it. It outranks kept,
  kept-many and failing items, and held never withholds it.
- The chip reads deferred, with the same sentence, never refused, so the
  PWA still re-reads it. No PWA edit.
- For a child the sweep keeps, the stuck sentence drops the retry clause,
  says the child is kept and names the reason, on the chip and the
  banner (R41).
- For a child the sweep holds, the stuck sentence drops the retry clause
  too: ccrc does not retry it while the hold stands, and its long backoff
  resumes once the hold lifts (the held ruling, R41), on the chip and the
  banner.
- ccd's detail reaches the sentence through childReclaimDetailText: one
  line, with no control or bidi character, bounded at LC_LINE_MAX.
- childReclaimFeedQuiet reads a listed stuck item like a failing one, so a
  retry that finds the same word writes no new feed row.

Task 6's failed tail now reads CHILD_RECLAIM_STUCK_RETRY, the one
spelling of the retry clause. Review 341's vacuous state-changed kebab
line is re-aimed at the stuck set's admission.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

---

### Task 9: The persistent tier: entry, exit, pace, restart seeding and deferral (L1), wired in the lane (L4)

**Model routing:** **`opus`, effort `high`**. The tier changes WHEN the lane asks the box to run a destructive verb. Every arm must stay "only slower than today" (spec §5.7's pacing class), and a deferral must leave the presence lease, its episode and its licence exactly as they are. The SAFETY lens reads this diff against those two sentences.

**Why:** Today a child whose every attempt fails is asked again after `min(15 min, 60 s × 2^k)`, for ever (`childReclaimBackoffMs`, server/src/childReclaimSweep.ts:786 at `226bb881c`; `grep -n '^export function childReclaimBackoffMs' server/src/childReclaimSweep.ts`). That pace is held only in memory (`childReclaimSweepState`, server/src/watch.ts:808; `grep -n 'private childReclaimSweepState = new Map' server/src/watch.ts`). The memory is dropped on every restart, every raised `reclaim-paused`, every missing capability, every mirror fail-shut (watch.ts:3360-3362, :3391-3393) and every non-eligible pass (watch.ts:3528, `this.childReclaimSweepState.delete(r.id);`). The pre-flight measured about 23 such clears in 53 h, and each clear restarts the 2-4-8 minute ramp. A word that will not heal by itself is therefore retried about every 15 minutes for ever: wave 7's `containment-refuted` (a tree ccd proved is not the child's own), or the same failure word again and again (the calm-mesa `pin-failed` loop wrote 248 lines in 53 h). This task builds the tier the spec's §5.9 "persistent tier" describes, and nothing else:
- **Entry.** A child enters (a) on a `stuck` answer, or (b) on its 4th consecutive failure carrying the SAME countable word. A null word and every `CHILD_RECLAIM_PRE_LOCK_TOKEN` member never count; that set includes `flock-unavailable` and `lock-unopenable`.
- **Exit.** A child leaves on `reclaimed`, `gone`, any refusal, or a failure with a different countable word.
- **Pace.** `min(4 h, ceiling × 2^j)`. No arm is +∞, and the pace is never shorter than today's ramp.
- **Restart.** Every first sighting is seeded from the mirror's CURRENT generation: membership, word, run and j. `lastFailedAt` stays null and no clock is read, so a re-created entry is asked once on its next due pass.
- **Deferral.** A deferral keeps the tier state, and clears `lastFailedAt` and `consecutiveFailures` exactly as today.
- **Docstrings.** The ones that promise "at least once a ceiling" are rewritten.

**Readings this task takes (each named in the plan's departures, for the coordinator):**
- `tier-uncountable-failure-neutral`. A failure whose word is not countable (null, or a pre-lock word) neither enters, counts, advances nor ENDS the tier. The rulings' "a failure with a different token" is read as a different COUNTABLE token. The evidence's amended text is "Neither a pre-lock token nor a null token ends or advances it" (`attack.json`, R78 population). The reason is the restart: a rejection and a cut-short call are never journaled, and a pre-lock die is journaled as a `refused` line. A rule that let them end the tier would make the live memory and its restart seed disagree. The same holds for two more `refused` lines, because ccd journals EVERY `ws-reclaim` refusal through one emit (`_lc_emit reclaim refused … refusal "$REAP_VERDICT"`, ccd/ccd:30280 at `226bb881c`, and `refused in-progress` at :30183): a box retry refusal (`attached`, `held`, `tree-busy`, `state-changed`, `in-progress`, `reap-in-progress`, `paused`), which the executor answers as a deferral that keeps the tier (`childReclaimRefusal`'s `retry` arm, coord/childReclaim.ts:1019-1021), and a refused word this build cannot classify, which the executor answers as a failure with a null word (coord/childReclaim.ts:749-752), so neutral. The seed reads past both, through the injected `kindOf` (`childReclaimTokenKind`), and ends only at a `terminal` or `gone` refusal, as the live memory does. The agreement case below pins that they agree, journaled box retry refusals and unclassified refused words included.
- `tier-j-from-run`. Live, `j = max(0, run − K)`, the seed's own formula, for (b) members and stuck members alike. So a stuck child is paced at the ceiling for its first four answers, then 30, 60, 120 and 240 minutes. A restart reads back exactly the j the dead process held.
- `tier-seed-carries-short-run`. The seed also carries a NON-member's word and run (fewer than K), so the K-th failure is the same failure live or after a restart.
- `tier-seed-birth-guard`. The seed reads a generation only when its opening `create` is the entry's own `bornAt`. With no placed birth (R75's purge window), it seeds nothing. That direction is faster pacing, never a missed ask.

**Files:**
- Modify: `server/src/childReclaimSweep.ts`. Edits, located by content (Tasks 2 to 8 have moved every line number below):
  - The ceiling's docstring (:18-26; `grep -n 'The same span caps the failure backoff' server/src/childReclaimSweep.ts`): one sentence rewritten.
  - The entry's docstring (:54; `grep -n 'IN MEMORY ONLY: a restart loses' server/src/childReclaimSweep.ts`): one sentence added.
  - `export interface ChildReclaimSweepEntry {` (:123) becomes `export interface ChildReclaimSweepEntry extends ChildReclaimTierState {`.
  - `childReclaimFirstSighting` (:188; `grep -n '^export const childReclaimFirstSighting' server/src/childReclaimSweep.ts`) gains a LAST parameter, `tier`, defaulting to `CHILD_RECLAIM_TIER_NONE`.
  - `ChildReclaimSweepOutcome` (:644; `grep -n '^export type ChildReclaimSweepOutcome' server/src/childReclaimSweep.ts`): its `failed` arm is split out and carries `token` and `stuck`. Add `CHILD_RECLAIM_SWEEP_REJECTED` below it.
  - `childReclaimNextEntry`'s three arms (:726 `case 'failed':`, :732 `case 'refused':`, :738 `case 'deferred': {`).
  - `childReclaimBackoffMs`'s docstring (:781-785; `grep -n 'still asked for at least once a' server/src/childReclaimSweep.ts`) is rewritten. The tier block goes directly below the function.
  - `childReclaimBackoffOver` (:797; `grep -n '^const childReclaimBackoffOver' server/src/childReclaimSweep.ts`) reads `childReclaimFailureWaitMs`.
  - `childReclaimTierSeed` goes directly below `childReclaimJournalRow` (:952; `grep -n '^export function childReclaimJournalRow' server/src/childReclaimSweep.ts`).
- Modify: `server/src/coord/childReclaim.ts`.
  - Add `type ChildReclaimSweepOutcome` to the `../childReclaimSweep.js` import (:11-16; `grep -n "} from '../childReclaimSweep.js';" server/src/coord/childReclaim.ts`).
  - Add `childReclaimSweepOutcomeOf` directly below `export type ChildReclaimOutcome =` (:317-324).
  - Nothing else. `isChildReclaimStuckToken`, `CHILD_RECLAIM_STUCK_TOKENS` and the `'stuck'` resume are Task 6's (H3). This task never declares them again.
- Modify: `server/src/watch.ts`. Four places:
  - The two imports (:88-91 and :93-104; `grep -n "} from './coord/childReclaim.js';\|} from './childReclaimSweep.js';" server/src/watch.ts`).
  - The memory field's docstring (:799-802; `grep -n 'a restart loses it, and losing it can only DELAY a reclaim (two passes' server/src/watch.ts`).
  - Step ONE's mirror read (:3331-3342; `grep -n 'let latest: ChildReclaimJournalRow\[\];' server/src/watch.ts`).
  - The first sighting (:3601-3602; `grep -n 'this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(' server/src/watch.ts`), the answer's write-back (:3696; `grep -n 'this.childReclaimWriteBack(r.id, entry, outcome, ask, answered);' server/src/watch.ts`) and the rejection's (:3709; `grep -n "this.childReclaimWriteBack(r.id, entry, { kind: 'failed' }, ask, answered);" server/src/watch.ts`).
- Modify: `server/test/child-reclaim-sweep-policy.test.ts`. Mechanical only, no expectation changes:
  - every `ChildReclaimSweepOutcome` `failed` literal gains `token: null, stuck: false` (:497, :501, :539, :596, :606, :790, :953, :1667 at `226bb881c`);
  - the first sighting's `toEqual` (:470-472; `grep -n "a first sighting starts no clock" server/test/child-reclaim-sweep-policy.test.ts`) gains the four tier fields.
- Test (new): `server/test/child-reclaim-persistent-tier.test.ts`. L1 rows, the seed, and the projection.
- Modify: `server/test/childReclaimGenerationFixture.ts`, Task 3's shared lane rig (H7). The change is ADDITIVE, and covers only what Tasks 5 and 7 have not already added (Step 0 measures it): the `exec` option, the module-scope uid counter, and `journal`, `advance`, `advanceTo`, `mono`, `now` and `entryOf` on the rig.
- Test (new): `server/test/child-reclaim-tier-lane.test.ts`. The lane runs through the shared `laneFixture` (H7) on a fixture HOME, with the executor stubbed through the fixture's `exec` option. It never builds a second FleetWatcher rig.
- NOT edited: `shared/api.ts` (no L0 insertion, so no README anchor moves), `single-definition.test.ts`, `server/test/containment-refuted-word.test.ts` (Task 6 flipped its one parser assertion, H3; Step 8 runs it only as a regression check), README.md, the PWA, ccd and the agent.

**Interfaces:**
- Produces (`server/src/childReclaimSweep.ts`, L1):
  ```ts
  export const CHILD_RECLAIM_TIER_ENTRY_RUN = 4;
  export const CHILD_RECLAIM_TIER_CAP_MS = 4 * 3600_000;
  export interface ChildReclaimTierState {
    readonly tier: boolean; readonly tierToken: string | null; readonly tierJ: number; readonly tierRun: number;
  }
  export const CHILD_RECLAIM_TIER_NONE: ChildReclaimTierState;
  export interface ChildReclaimSweepEntry extends ChildReclaimTierState { /* … unchanged fields … */ }
  export type ChildReclaimSweepOutcome =
    | { readonly kind: 'reclaimed' | 'gone' }
    | { readonly kind: 'failed'; readonly token: string | null; readonly stuck: boolean }
    | { readonly kind: 'refused'; readonly token: string }
    | { readonly kind: 'deferred'; readonly why: string };
  export const CHILD_RECLAIM_SWEEP_REJECTED: ChildReclaimSweepOutcome; // { kind: 'failed', token: null, stuck: false }
  export const childReclaimTierCountable: (token: string | null) => token is string;
  export function childReclaimTierOf(t: ChildReclaimTierState): ChildReclaimTierState;
  export function childReclaimTierAfterFailure(t: ChildReclaimTierState, token: string | null, stuck: boolean): ChildReclaimTierState;
  export function childReclaimTierPaceMs(j: number): number;
  export function childReclaimFailureWaitMs(entry: ChildReclaimSweepEntry, passIntervalMs: number): number;
  export function childReclaimTierSeed(
    generation: readonly MirroredLifecycleEvent[], bornAt: number | null, stuckOf: (token: string) => boolean,
    kindOf: (token: string) => ChildReclaimTokenKind | null,
  ): ChildReclaimTierState;
  // childReclaimFirstSighting gains a LAST parameter: tier: ChildReclaimTierState = CHILD_RECLAIM_TIER_NONE
  ```
- Produces (`server/src/coord/childReclaim.ts`, L3):
  ```ts
  export function childReclaimSweepOutcomeOf(o: ChildReclaimOutcome): ChildReclaimSweepOutcome;
  ```
- Produces (`server/test/childReclaimGenerationFixture.ts`, additive, H7; each item only if Tasks 5 and 7 did not already add it):
  ```ts
  // LaneOpts gains:
  readonly exec?: (req: ChildReclaimRequest) => ChildReclaimOutcome | Promise<ChildReclaimOutcome>;
  // module scope: `let uidN = 0;`, moved out of laneFixture, so a rig over a reused coord.db never reuses a uid
  // laneFixture's rig gains:
  journal(id: string, act: string, outcome: string, over?: Readonly<Record<string, unknown>>): void;
  advance(ms: number): void; advanceTo(mono: number): void; mono(): number; now(): number;
  entryOf(id: string): ChildReclaimSweepEntry | undefined;
  ```
- Consumes:
  - Task 2's `childReclaimFirstSighting(monoMs, bornAt, markerRunId, generation: ChildReclaimGenerationKey)`, whose generation key is its FOURTH parameter (H5), and its three-key `childReclaimSameGeneration(entry, bornAt, markerRunId, generation: ChildReclaimGenerationKey)`. In watch.ts the key is the loop's `regGeneration`, which Task 2 has already narrowed with `isChildReclaimGenerationKey` above the first sighting. The L1 tests write the key as `{ kind: 'absent' }`.
  - Task 6's names (H3): the `ChildReclaimResume` member `'stuck'`; `CHILD_RECLAIM_STUCK_TOKENS` (typed `satisfies readonly LcRefusalToken[]`); the type guard `isChildReclaimStuckToken(v: unknown): v is ChildReclaimStuckToken`; `parseChildReclaimResult` reading `containment-refuted` as `resume: 'stuck'`; and `CHILD_RECLAIM_PROBE_UNMEASURED`, the exit-1 audit's word. This tier counts that word like any other countable word.
  - Task 8's import of `isChildReclaimStuckToken` into watch.ts (its Step 3h). This task uses that import and never adds a second one.
  - Task 3's shared lane fixture, `server/test/childReclaimGenerationFixture.ts` (`laneFixture`, `G1`, `G2`), as Tasks 5 and 7 left it (H7).
  - Task 3's `'generation-changed'` deferral word. It is only a string here, used as one deferral row.
  - Wave 7's `LcRefusalToken` member `'containment-refuted'`.
  - Existing code at `226bb881c`: `isChildReclaimPreLockToken` and `CHILD_RECLAIM_PRE_LOCK_TOKEN` (childReclaimSweep.ts:920-929), `childReclaimFailureLine` (:936), `ChildReclaimTokenKind` (childReclaimSweep.ts:908), `childReclaimGeneration` (coord/childReclaim.ts:145), `childReclaimTokenKind` (coord/childReclaim.ts:102, already imported by watch.ts at :89) and `CHILD_RECLAIM_SWEEP_MS` (watch.ts).

- [ ] **Step 0: Entry conditions**

Task 0 has already brought wave 7's tree onto this branch (H1), and nothing merges `main` mid-wave. Tasks 2 to 8 must be committed. Task 3's shared lane fixture is needed, and Tasks 5 and 7 may have extended it (H7).

```bash
grep -c "'containment-refuted'" shared/api.ts                                   # >= 1  (wave 7, brought by Task 0: H1)
grep -n 'CHILD_RECLAIM_STUCK_TOKENS' server/src/coord/childReclaim.ts            # Task 6: the set (H3)
grep -n "'stuck'" server/src/coord/childReclaim.ts | grep -i resume              # Task 6: ChildReclaimResume has 'stuck' (H3)
grep -n 'ChildReclaimGenerationKey' server/src/childReclaimSweep.ts              # Task 2: the third key
grep -n 'export function isChildReclaimStuckToken' server/src/coord/childReclaim.ts  # Task 6's guard (H3)
grep -n 'isChildReclaimStuckToken' server/src/watch.ts                          # Task 8's Step 3h import
grep -n -A 2 '^export const childReclaimFirstSighting' server/src/childReclaimSweep.ts  # Task 2: the key is the 4th parameter (H5)
grep -n 'isChildReclaimGenerationKey(regGeneration)' server/src/watch.ts         # Task 2: the narrowing above the first sighting
ls server/test/childReclaimGenerationFixture.ts                                  # Task 3: the shared lane fixture (H7)
```

If any of these finds nothing, STOP and report: Task 0 brought wave 7's tree (H1), and no merge happens mid-wave. If `childReclaimFirstSighting`'s generation key is not its fourth parameter, STOP and report. H5 fixes that order, so never adjust this task's calls to fit.

Then measure what the shared fixture already carries. Tasks 5 and 7 add their options additively, and Step 2a adds only what is still missing:

```bash
grep -n '^let uidN\|readonly exec?:\|const journal = \|const advance = \|const advanceTo = \|mono: () => mono\|now: () => clock\|const entryOf = ' server/test/childReclaimGenerationFixture.ts
```

If one of these is present under its name with the same parameter ORDER and arity as Step 2a's (`journal(id, act, outcome, over?)`, `advance(ms)`, `advanceTo(m)`, `mono()`, `now()`, `entryOf(id)`), reuse it as it stands, whatever its `Readonly` modifiers: Task 5's `journal` takes `over: Readonly<Record<string, unknown>>`, H7's spelling, and that is the same piece. STOP and report only when it has another parameter list (a different order or arity, for example `journal` without the `id` first) or another return type. Never add a second spelling beside it.

- [ ] **Step 1: Write the failing L1 test**

Create `server/test/child-reclaim-persistent-tier.test.ts`:

```ts
// The persistent tier (child-reclamation spec §5.9, "the persistent tier"). A failure that will not heal by itself
// (the stuck class, or the same word four times running) is asked about ever more slowly, and never never:
// min(4 h, ceiling × 2^j). These rows pin the memory (L1, pure), the restart seed that rebuilds it from the
// mirror, and the ONE projection (coord/childReclaim.ts) that carries the stuck class to it. The lane's wiring
// is `child-reclaim-tier-lane.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_PRE_LOCK_TOKEN, CHILD_RECLAIM_SWEEP_REJECTED,
  CHILD_RECLAIM_TIER_CAP_MS, CHILD_RECLAIM_TIER_ENTRY_RUN, CHILD_RECLAIM_TIER_NONE,
  childReclaimBackoffMs, childReclaimDue, childReclaimFailureWaitMs, childReclaimFirstSighting, childReclaimNextEntry,
  childReclaimTierCountable, childReclaimTierOf, childReclaimTierPaceMs, childReclaimTierSeed,
  isChildReclaimPreLockToken,
  type ChildReclaimAsk, type ChildReclaimLaneNow, type ChildReclaimSweepEntry, type ChildReclaimSweepOutcome,
  type ChildReclaimTierState,
} from '../src/childReclaimSweep.js';
import {
  CHILD_RECLAIM_PROBE_UNMEASURED, childReclaimSweepOutcomeOf, childReclaimTokenKind, isChildReclaimStuckToken,
  parseChildReclaimResult,
} from '../src/coord/childReclaim.js';
import type { LifecycleAct, LifecycleOutcome, MirroredLifecycleEvent } from '../../shared/api.js';

const NOW = 1_790_000_000_000;
/** The lane's pass interval, an ARGUMENT to every pacing function (this L1 file imports no L4 constant). */
const PASS = 60_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const CAP = CHILD_RECLAIM_TIER_CAP_MS;
const K = CHILD_RECLAIM_TIER_ENTRY_RUN;
/** The birth of the generation every entry here describes (ccd's clock, compared for equality only). */
const BORN = NOW - 3_600_000;
const RUN = 7;
const A = 'worktree-remove-failed';
const B = 'pin-failed';
const STUCK = 'containment-refuted';

const at = (mono: number): ChildReclaimLaneNow => ({ monoMs: mono, wallMs: mono });
const ask = (mono: number): ChildReclaimAsk => ({ at: at(mono), licensed: false, asHolder: false });
/** A first sighting, keyed as Task 2 keys it: no `.generation` file reads `absent`. */
const fresh = (): ChildReclaimSweepEntry => childReclaimFirstSighting(NOW, BORN, RUN, { kind: 'absent' });
/** A failure as the projection hands it to the memory: ccd's word, and the one stuck spelling. */
const failed = (token: string | null): ChildReclaimSweepOutcome =>
  ({ kind: 'failed', token, stuck: isChildReclaimStuckToken(token) });
/** One answer after another, a pass apart. */
const fold = (entry: ChildReclaimSweepEntry, outcomes: readonly ChildReclaimSweepOutcome[]): ChildReclaimSweepEntry =>
  outcomes.reduce((e, o, k) => childReclaimNextEntry(e, o, ask(NOW + k * PASS), at(NOW + k * PASS), PASS)!, entry);
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);
const tierOf = (e: ChildReclaimTierState): ChildReclaimTierState => childReclaimTierOf(e);

/** One mirrored journal row of `demo-a`, every field the type carries (copy the field list from
 *  `child-reclaim-sweep-policy.test.ts`'s `ev` if `MirroredLifecycleEvent` has gained one). */
const ev = (act: LifecycleAct, outcome: LifecycleOutcome, over: Partial<MirroredLifecycleEvent> = {}):
  MirroredLifecycleEvent => ({
  uid: null, at: NOW, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
  verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal: null, detail: null, truncated: false,
  obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: NOW + 5, ...over,
});
/** What ccd journals for one failed attempt: its `intent`, then the word. A pre-lock die is journaled `refused`
 *  (it never took the lock); a word-less failure is written here as `failed` with no refusal. */
const attempt = (w: string | null): MirroredLifecycleEvent[] => [
  ev('reclaim', 'intent'),
  w !== null && isChildReclaimPreLockToken(w) ? ev('reclaim', 'refused', { refusal: w }) : ev('reclaim', 'failed', { refusal: w }),
];
/** The current generation: its opening create at BORN, then one attempt per word. */
const generation = (...words: (string | null)[]): MirroredLifecycleEvent[] =>
  [ev('create', 'done', { at: BORN }), ...words.flatMap(attempt)];
const seed = (rows: readonly MirroredLifecycleEvent[]): ChildReclaimTierState =>
  childReclaimTierSeed(rows, BORN, isChildReclaimStuckToken, childReclaimTokenKind);
/** What ccd journals for an attempt the box REFUSED with `w`: its `intent`, then the one `refused` emit every
 *  `ws-reclaim` refusal goes through (ccd/ccd:30280). */
const refusedAttempt = (w: string): MirroredLifecycleEvent[] => [ev('reclaim', 'intent'), ev('reclaim', 'refused', { refusal: w })];
/** A refused word no build was compiled to know: `childReclaimTokenKind` answers null for it. */
const UNKNOWN_REFUSAL = 'a-word-this-build-never-knew';
/** mulberry32: a seeded row replays exactly. */
const mulberry32 = (s: number): (() => number) => {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

describe('the persistent tier: its two constants', () => {
  it('K is 4, the failure at which the ordinary ramp first reaches the ceiling, and the cap is four hours', () => {
    // HARDCODED literals on purpose: the mutation controls for the two constants.
    expect(CHILD_RECLAIM_TIER_ENTRY_RUN).toBe(4);
    expect(CHILD_RECLAIM_TIER_CAP_MS).toBe(14_400_000);
    expect(childReclaimBackoffMs(K - 1, PASS)).toBeLessThan(C);
    expect(childReclaimBackoffMs(K, PASS)).toBe(C);
  });
});

describe('entry', () => {
  it('(b) the K-th consecutive failure with the SAME word enters, and the three before it do not', () => {
    expect([1, 2, 3, 4, 5].map((n) => tierOf(fold(fresh(), times(n, failed(A)))))).toEqual([
      { tier: false, tierToken: A, tierJ: 0, tierRun: 1 },
      { tier: false, tierToken: A, tierJ: 0, tierRun: 2 },
      { tier: false, tierToken: A, tierJ: 0, tierRun: 3 },
      { tier: true, tierToken: A, tierJ: 0, tierRun: 4 },
      { tier: true, tierToken: A, tierJ: 1, tierRun: 5 },
    ]);
  });

  it('(a) a stuck answer enters at once, and j counts only past K, as the restart seed counts it', () => {
    expect(tierOf(fold(fresh(), [failed(STUCK)]))).toEqual({ tier: true, tierToken: STUCK, tierJ: 0, tierRun: 1 });
    expect(tierOf(fold(fresh(), times(K + 2, failed(STUCK))))).toEqual({ tier: true, tierToken: STUCK, tierJ: 2, tierRun: K + 2 });
  });

  it('a null word and every pre-lock word never count toward (b), however long they run', () => {
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)).toEqual(expect.arrayContaining(['flock-unavailable', 'lock-unopenable']));
    for (const w of [null, ...Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)]) {
      expect(childReclaimTierCountable(w), String(w)).toBe(false);
      expect(tierOf(fold(fresh(), times(3 * K, failed(w)))), String(w)).toEqual(CHILD_RECLAIM_TIER_NONE);
    }
    expect(childReclaimTierCountable(A)).toBe(true);
    expect(childReclaimTierCountable(CHILD_RECLAIM_PROBE_UNMEASURED), 'Task 6\'s exit-1 audit word counts').toBe(true);
  });

  it('an uncountable failure neither breaks, advances nor ends a run: the tier state stands as it was', () => {
    const member = fold(fresh(), times(K, failed(A)));
    for (const w of [null, ...Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)]) {
      expect(tierOf(fold(member, [failed(w)])), String(w)).toEqual(tierOf(member));
    }
    expect(tierOf(fold(fresh(), [failed(A), failed(A), failed(null), failed('flock-unavailable'), failed(A), failed(A)])))
      .toEqual({ tier: true, tierToken: A, tierJ: 0, tierRun: 4 });
  });

  it('a rejection is written as a failure that names no word, so it is neutral too', () => {
    expect(CHILD_RECLAIM_SWEEP_REJECTED).toEqual({ kind: 'failed', token: null, stuck: false });
  });
});

describe('exit', () => {
  it('a different countable word ends the tier and starts a new run; a stuck word re-enters at once', () => {
    const member = fold(fresh(), times(K + 1, failed(A)));
    expect(tierOf(fold(member, [failed(B)]))).toEqual({ tier: false, tierToken: B, tierJ: 0, tierRun: 1 });
    expect(tierOf(fold(member, [failed(STUCK)]))).toEqual({ tier: true, tierToken: STUCK, tierJ: 0, tierRun: 1 });
  });

  it('any refusal ends it, and reclaimed and gone forget the child', () => {
    const member = fold(fresh(), times(K + 1, failed(A)));
    expect(tierOf(fold(member, [{ kind: 'refused', token: 'tree-unreadable' }]))).toEqual(CHILD_RECLAIM_TIER_NONE);
    for (const kind of ['reclaimed', 'gone'] as const) {
      expect(childReclaimNextEntry(member, { kind }, ask(NOW), at(NOW), PASS), kind).toBeNull();
    }
  });
});

describe('deferral', () => {
  it('keeps the tier (membership, its word, j and the run) and clears the ramp exactly as before', () => {
    const member = fold(fresh(), times(K + 1, failed(A)));
    for (const why of ['presence', 'attached', 'held', 'state-changed', 'generation-changed']) {
      const d = fold(member, [{ kind: 'deferred', why }]);
      expect(tierOf(d), why).toEqual(tierOf(member));
      expect(d, why).toMatchObject({ consecutiveFailures: 0, lastFailedAt: null });
      expect(childReclaimDue(d, NOW, PASS), `${why}: due on its next pass, so the presence lease is unchanged`).toBe(true);
      expect(tierOf(fold(d, [failed(A)])), `${why}: the next failure resumes the tier at j + 1`)
        .toEqual({ tier: true, tierToken: A, tierJ: 2, tierRun: K + 2 });
    }
  });
});

describe('pace', () => {
  it('min(cap, ceiling × 2^j): finite for every j, never below the ceiling', () => {
    const js = [0, 1, 2, 3, 4, 5, 50, 1e6, Infinity, Number.NaN, -3];
    const paces = js.map((j) => childReclaimTierPaceMs(j));
    expect(paces).toEqual([C, 2 * C, 4 * C, 8 * C, CAP, CAP, CAP, CAP, CAP, C, C]);
    for (const p of paces) expect(Number.isFinite(p)).toBe(true);
  });

  it('never faster than today: a member waits at least the ordinary ramp, and a non-member waits exactly it', () => {
    for (let k = 0; k <= 40; k += 1) {
      const e: ChildReclaimSweepEntry = { ...fresh(), consecutiveFailures: k, lastFailedAt: NOW };
      expect(childReclaimFailureWaitMs(e, PASS), `k=${k}`).toBe(childReclaimBackoffMs(k, PASS));
      for (let j = 0; j <= 10; j += 1) {
        expect(childReclaimFailureWaitMs({ ...e, tier: true, tierToken: A, tierJ: j, tierRun: K + j }, PASS), `k=${k} j=${j}`)
          .toBeGreaterThanOrEqual(childReclaimBackoffMs(k, PASS));
      }
    }
  });

  it('childReclaimDue reads the tier pace: a member at j = 1 waits two ceilings where today waits one', () => {
    const base: ChildReclaimSweepEntry = { ...fresh(), consecutiveFailures: 5, lastFailedAt: NOW };
    const member: ChildReclaimSweepEntry = { ...base, tier: true, tierToken: A, tierJ: 1, tierRun: K + 1 };
    expect(childReclaimDue(base, NOW + C, PASS)).toBe(true);
    expect(childReclaimDue(member, NOW + C, PASS)).toBe(false);
    expect(childReclaimDue(member, NOW + 2 * C - 1, PASS)).toBe(false);
    expect(childReclaimDue(member, NOW + 2 * C, PASS)).toBe(true);
  });
});

describe('the restart seed (childReclaimTierSeed)', () => {
  it('seeds nothing with no reclaim outcome in the generation', () => {
    expect(seed([])).toEqual(CHILD_RECLAIM_TIER_NONE);
    expect(seed(generation())).toEqual(CHILD_RECLAIM_TIER_NONE);
    expect(seed([ev('create', 'done', { at: BORN }), ev('reclaim', 'intent')])).toEqual(CHILD_RECLAIM_TIER_NONE);
  });

  it('six failures of one word, read past their intents, seed a member at j = 2', () => {
    expect(seed(generation(...times(6, A)))).toEqual({ tier: true, tierToken: A, tierJ: 2, tierRun: 6 });
  });

  it('a latest word in the stuck class seeds a member at once', () => {
    expect(seed(generation(A, STUCK))).toEqual({ tier: true, tierToken: STUCK, tierJ: 0, tierRun: 1 });
  });

  it('fewer than K seeds no member but carries its run, so the K-th failure is the same failure after a restart', () => {
    const s = seed(generation(A, A, A));
    expect(s).toEqual({ tier: false, tierToken: A, tierJ: 0, tierRun: 3 });
    expect(tierOf(fold({ ...fresh(), ...s }, [failed(A)]))).toMatchObject({ tier: true, tierRun: 4 });
  });

  it('a different word ends the count, so only the latest run is read', () => {
    expect(seed(generation(...times(5, A), B, B))).toEqual({ tier: false, tierToken: B, tierJ: 0, tierRun: 2 });
  });

  it('a pre-lock refusal and a word-less failure are read past, as the live memory is neutral to them', () => {
    expect(seed(generation(A, A, 'flock-unavailable', null, 'token-malformed', A, A)))
      .toEqual({ tier: true, tierToken: A, tierJ: 0, tierRun: 4 });
  });

  it('a journaled box retry refusal and an unclassified refused word are read past, as the live memory keeps the tier through them', () => {
    expect(childReclaimTokenKind('attached')).toBe('retry');
    expect(childReclaimTokenKind(UNKNOWN_REFUSAL)).toBeNull();
    for (const w of ['attached', 'held', 'in-progress', UNKNOWN_REFUSAL]) {
      expect(seed([...generation(A, A), ...refusedAttempt(w), ...attempt(A), ...attempt(A)]), w)
        .toEqual({ tier: true, tierToken: A, tierJ: 0, tierRun: 4 });
    }
  });

  it('any other reclaim outcome ends the walk; another act is read past', () => {
    for (const end of [ev('reclaim', 'refused', { refusal: 'tree-unreadable' }), ev('reclaim', 'refused', { refusal: 'no-such-session' }),
      ev('reclaim', 'done'), ev('reclaim', 'unknown')]) {
      expect(seed([...generation(...times(5, A)), end]), `${end.outcome}:${String(end.refusal)}`).toEqual(CHILD_RECLAIM_TIER_NONE);
    }
    expect(seed([...generation(...times(4, A)), ev('hold', 'done')])).toMatchObject({ tier: true, tierRun: 4 });
  });

  it('reads the entry\'s OWN generation: an opening create at another birth, or no birth, seeds nothing', () => {
    expect(childReclaimTierSeed(generation(...times(6, A)), BORN + 1, isChildReclaimStuckToken, childReclaimTokenKind))
      .toEqual(CHILD_RECLAIM_TIER_NONE);
    expect(childReclaimTierSeed(generation(...times(6, A)), null, isChildReclaimStuckToken, childReclaimTokenKind))
      .toEqual(CHILD_RECLAIM_TIER_NONE);
  });

  it('reads no clock: past the opening create, no row\'s own `at` changes the answer', () => {
    const plain = generation(...times(6, A));
    const skewed = plain.map((e, k) => (k === 0 ? e : { ...e, at: k % 2 === 0 ? null : NOW + 10 * 86_400_000 }));
    expect(seed(skewed)).toEqual(seed(plain));
  });

  it('the seed and the live memory agree on every sequence: a restart reads back what the process that died held', () => {
    const rnd = mulberry32(78);
    const words: readonly (string | null)[] =
      [A, B, STUCK, null, 'flock-unavailable', 'token-malformed', 'defer', 'box-retry', 'refused-unknown'];
    for (let trial = 0; trial < 500; trial += 1) {
      let live = fresh();
      const rows: MirroredLifecycleEvent[] = [ev('create', 'done', { at: BORN })];
      const seq: (string | null)[] = [];
      const n = 1 + Math.floor(rnd() * 14);
      for (let k = 0; k < n; k += 1) {
        const w = words[Math.floor(rnd() * words.length)]!;
        seq.push(w);
        // A deferral is journaled nowhere (a retryable verdict never is), and the memory keeps the tier through it.
        if (w === 'defer') { live = fold(live, [{ kind: 'deferred', why: 'presence' }]); continue; }
        // A box retry refusal IS journaled (`refused attached`), and the executor answers it as a deferral.
        if (w === 'box-retry') {
          live = fold(live, [{ kind: 'deferred', why: 'attached' }]);
          rows.push(...refusedAttempt('attached'));
          continue;
        }
        // A refused word this build cannot classify is journaled too, and answered as a failure that names no word.
        if (w === 'refused-unknown') {
          live = fold(live, [failed(null)]);
          rows.push(...refusedAttempt(UNKNOWN_REFUSAL));
          continue;
        }
        live = fold(live, [failed(w)]);
        rows.push(...attempt(w));
      }
      expect(seed(rows), JSON.stringify(seq)).toEqual(tierOf(live));
    }
  });
});

describe('the one projection, coord/childReclaim.ts → the memory', () => {
  it('carries ccd\'s word and the one stuck spelling, and agrees with the parser\'s stuck class', () => {
    const o = { sessionId: 'demo-a', runId: RUN, detail: 'd' } as const;
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'failed', resume: 'stuck', token: STUCK }))
      .toEqual({ kind: 'failed', token: STUCK, stuck: true });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'failed', resume: 'resumable', token: A }))
      .toEqual({ kind: 'failed', token: A, stuck: false });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'failed', resume: 'resumable', token: null }))
      .toEqual({ kind: 'failed', token: null, stuck: false });
    expect(childReclaimSweepOutcomeOf({ kind: 'gone', sessionId: 'demo-a' })).toEqual({ kind: 'gone' });
    expect(childReclaimSweepOutcomeOf({ kind: 'reclaimed', sessionId: 'demo-a', runId: RUN, wip: { kind: 'none' }, secretsDropped: 0 }))
      .toEqual({ kind: 'reclaimed' });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'refused', token: 'tree-unreadable', sentence: 's' }))
      .toEqual({ kind: 'refused', token: 'tree-unreadable' });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'deferred', why: 'presence' })).toEqual({ kind: 'deferred', why: 'presence' });
    for (const [word, stuck] of [[STUCK, true], [A, false]] as const) {
      const p = parseChildReclaimResult('demo-a', JSON.stringify({ failed: word, detail: 'x', crumb: true }), '');
      if (p.kind !== 'failed') throw new Error(`expected a failed read, got ${p.kind}`);
      expect(p.resume === 'stuck', word).toBe(stuck);
      expect(childReclaimSweepOutcomeOf({ ...p, sessionId: 'demo-a', runId: RUN }), word).toEqual({ kind: 'failed', token: word, stuck });
    }
  });
});

describe('the backoff\'s docstrings', () => {
  it('no longer promise that a failing child is asked at least once a ceiling', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'childReclaimSweep.ts'), 'utf8');
    expect(src).not.toContain('still asked for at least once a');
    expect(src).not.toContain('The same span caps the failure backoff');
  });
});
```

- [ ] **Step 2: Extend the shared lane fixture (H7), then write the failing lane test**

2a. In `server/test/childReclaimGenerationFixture.ts`, Task 3's ONE watcher rig, add each item Step 0's last grep did NOT find. Add nothing else. Every item is additive, so the fixture's other users (Tasks 3, 4, 5 and 7) are unchanged.

(i) The uid counter moves to MODULE scope. Delete `  let uidN = 0;` inside `laneFixture`, and add directly above `export const laneFixture`:

```ts
/** One uid counter for every rig: the mirror inserts OR IGNORE on uid, so a rig over a reused coord.db must
 *  never reuse one (H7). */
let uidN = 0;
```

(ii) `LaneOpts` gains, after `afterRead`:

```ts
  /** Replaces the REAL executor, so a case can script the answer. Each request is still recorded, and so is each
   *  answer the stub returns. */
  readonly exec?: (req: ChildReclaimRequest) => ChildReclaimOutcome | Promise<ChildReclaimOutcome>;
```

In `childReclaimExec`, `const o = await base.queue.run(req.sessionId, () => reclaimChild(` becomes `const o = opts.exec !== undefined ? await opts.exec(req) : await base.queue.run(req.sessionId, () => reclaimChild(`. The continuation line and `outcomes.push(o);` stay as they are.

(iii) Directly above the rig's `return {`, add each declaration below that Step 0's grep did NOT find (Task 5 may already have added `journal` and `advance`, and Task 7 `journal`). `journal` takes H7's `Readonly` spelling, and it increments the MODULE-scope `uidN` from (i), never a rig-local one:

```ts
  /** One ccd journal line for `id`, mirrored at the rig's wall clock, on `plant`'s uid counter. */
  const journal = (id: string, act: string, outcome: string, over: Readonly<Record<string, unknown>> = {}): void => {
    uidN += 1;
    const line = JSON.stringify({ uid: `w8.1.${uidN}`, at: clock, act, outcome, id, ...over });
    coord.ingestJournal({ gen: '1790000000000000000', rows: [parseJournalLine(line)], cursor: uidN * 200,
      size: uidN * 200, at: clock });
  };
  /** Moves the wall clock and the lane's monotonic clock together. */
  const advance = (ms: number): void => { clock += ms; mono += ms; };
  const advanceTo = (m: number): void => { advance(m - mono); };
  const entryOf = (id: string) => watcher.currentChildReclaimDefers().get(id);
```

Then add to the returned object each of these names that is not already a key of it: `journal`, `advance`, `advanceTo`, `mono: () => mono`, `now: () => clock`, `entryOf`. Tasks 5 and 7 have already put some there (`journal`, `advance`, `now`), and a repeated key is TS1117 ("An object literal cannot have multiple properties with the same name"), which `typecheck-tests` reds.

2b. Create `server/test/child-reclaim-tier-lane.test.ts`:

```ts
// The persistent tier, wired (child-reclamation spec §5.9, "the persistent tier"). The L1 rows
// (`child-reclaim-persistent-tier.test.ts`) pin the memory. Only the lane can show these:
//   - a LOST memory (a restart, a raised switch) is re-seeded from the mirror at the next first sighting;
//   - the re-seeded child is asked once on its next due pass, then waits the tier pace, never the 15-minute ramp;
//   - a rejection, which names no word, leaves the tier as it stands.
// FIXTURE HOME only. The rig is the ONE shared lane fixture (`childReclaimGenerationFixture.ts`, H7). Its `exec`
// option stubs the executor at `Deps.childReclaimExec`, so nothing here runs ccd.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimBackoffMs, childReclaimTierPaceMs } from '../src/childReclaimSweep.js';
import type { ChildReclaimOutcome, ChildReclaimRequest } from '../src/coord/childReclaim.js';
import { G1, G2, laneFixture } from './childReclaimGenerationFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

const ID = 'demo-a';
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const A = 'worktree-remove-failed';
const STUCK = 'containment-refuted';

/** The shared lane rig (H7) with the executor stubbed, and its answer switchable per case. Its watcher has never
 *  run, so its memory is a freshly restarted process's. */
const fixture = () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let answer: (req: ChildReclaimRequest) => ChildReclaimOutcome = (req) =>
    ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });
  const f = laneFixture({ exec: (req) => answer(req) });
  const reclaimLine = (outcome: string, over: Record<string, unknown> = {}): void =>
    f.journal(ID, 'reclaim', outcome, { verb: 'ws-reclaim', ...over });
  /** A child of an abandoned run: its row, its marker and wave 7's `.generation` written, and its `create` mirrored. */
  const plantChild = (): void => { f.finishedChild(ID, G1); };
  /** ccd's own record of `n` earlier attempts that each failed with `word`. */
  const failures = (n: number, word: string): void => {
    for (let k = 0; k < n; k += 1) { f.advance(1); reclaimLine('intent'); reclaimLine('failed', { refusal: word }); }
  };
  /** The executor's answer for a failure with `word`, which ccd also journals. */
  const failedAs = (word: string) => (req: ChildReclaimRequest): ChildReclaimOutcome => {
    reclaimLine('failed', { refusal: word });
    return { kind: 'failed', sessionId: req.sessionId, runId: req.runId,
      resume: word === STUCK ? 'stuck' : 'resumable', detail: `${word}: d`, token: word };
  };
  /** ccd's own record of one earlier attempt the box refused with a RETRY word (ccd/ccd:30280's one emit). */
  const boxRetry = (word: string): void => { f.advance(1); reclaimLine('intent'); reclaimLine('refused', { refusal: word }); };
  /** `ws-add` minted the slug again: a new generation, and its `create` mirrored. */
  const remintSlug = (): void => { f.remint(ID, G2); f.journal(ID, 'create', 'done', { verb: 'ws-add' }); };
  return {
    reg: f.reg, requests: f.requests, plantChild, failures, boxRetry, failedAs, remintSlug, pass: f.pass, next: f.next,
    advance: f.advance, advanceTo: f.advanceTo, mono: f.mono,
    answer: (fn: (req: ChildReclaimRequest) => ChildReclaimOutcome) => { answer = fn; },
    entryOf: () => f.entryOf(ID),
  };
};

describe('the persistent tier, wired', () => {
  it('a restart does not fall back to the 15-minute ramp: the seed asks once, then waits the tier pace', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(6, A);
    await f.pass();                                                 // the first sighting, seeded from the mirror
    expect(f.requests).toHaveLength(0);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 6, tierJ: 2, lastFailedAt: null, consecutiveFailures: 0 });
    f.answer(f.failedAs(A));
    f.next();
    const askedAt = f.mono();
    await f.pass();
    expect(f.requests, 'asked once, on its next due pass').toHaveLength(1);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 7, tierJ: 3, consecutiveFailures: 1, lastFailedAt: askedAt });
    const pace = childReclaimTierPaceMs(3);
    expect(pace).toBe(8 * C);
    // today's ramp would ask two passes later, and one ceiling later at the latest
    for (const t of [childReclaimBackoffMs(1, CHILD_RECLAIM_SWEEP_MS), C, pace - 2 * CHILD_RECLAIM_SWEEP_MS]) {
      f.advanceTo(askedAt + t);
      await f.pass();
      expect(f.requests, `at +${t} ms`).toHaveLength(1);
    }
    f.advanceTo(askedAt + pace);
    await f.pass();
    expect(f.requests, 'and asked again at exactly its tier pace').toHaveLength(2);
  });

  it('a memory clear never starves a tier child: the re-sighting asks it once on its next due pass', async () => {
    const f = fixture();
    f.plantChild();
    f.answer(f.failedAs(STUCK));
    await f.pass();
    f.next(); await f.pass();                                       // asked: stuck
    expect(f.requests).toHaveLength(1);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: STUCK, tierJ: 0 });
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    f.next(); await f.pass();
    expect(f.entryOf(), 'the raised switch clears the memory').toBeUndefined();
    rmSync(path.join(f.reg, RECLAIM_PAUSE_MARKER));
    f.next(); await f.pass();                                       // the first sighting again, re-seeded
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: STUCK, tierRun: 1, tierJ: 0, lastFailedAt: null });
    expect(f.requests).toHaveLength(1);
    f.next(); await f.pass();
    expect(f.requests, 'asked once on its next due pass, never a fresh tier wait').toHaveLength(2);
    f.next(); await f.pass();
    expect(f.requests, 'then the tier pace again').toHaveLength(2);
  });

  it('a rejection names no word: the tier and its pace stand', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(4, A);
    await f.pass();
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 4, tierJ: 0 });
    f.answer(() => { throw new Error('a defect the executor could not name'); });
    f.next();
    const askedAt = f.mono();
    await f.pass();
    expect(f.requests).toHaveLength(1);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 4, tierJ: 0, consecutiveFailures: 1, lastFailedAt: askedAt });
    f.advanceTo(askedAt + childReclaimBackoffMs(1, CHILD_RECLAIM_SWEEP_MS));
    await f.pass();
    expect(f.requests, 'the ordinary ramp would have asked here').toHaveLength(1);
    f.advanceTo(askedAt + C);
    await f.pass();
    expect(f.requests).toHaveLength(2);
  });

  it('a journaled box retry refusal never resets the seed: the lane injects the one token kind', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(2, A);
    f.boxRetry('attached');                                         // the executor answered this one as a deferral
    f.failures(2, A);
    await f.pass();                                                 // the first sighting, seeded from the mirror
    expect(f.requests).toHaveLength(0);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 4, tierJ: 0, lastFailedAt: null });
  });

  it('the seed reads the CURRENT generation only: a slug minted again never inherits the old workspace\'s tier', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(6, A);
    f.advance(1_000);
    f.remintSlug();                                                 // ws-add minted the slug again
    await f.pass();
    expect(f.entryOf()).toMatchObject({ tier: false, tierToken: null, tierRun: 0, tierJ: 0 });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-persistent-tier.test.ts test/child-reclaim-tier-lane.test.ts
```

Expected: FAIL, 25 of 25 in `child-reclaim-persistent-tier` and 5 of 5 in `child-reclaim-tier-lane` (both counts re-measure (R-j): the box-retry row case and the box-retry lane case are new, and the persistent-tier file drafted 24 `it(` before them). Vitest binds a missing named export to `undefined`; it does not raise a SyntaxError.
- The constants case fails at `expected undefined to be 4`.
- The rejection case fails at `expected undefined to deeply equal { kind: 'failed', token: null, stuck: false }`.
- Every case that calls a new function fails at `TypeError: … childReclaimTierOf is not a function`, or the same error naming `childReclaimTierCountable`, `childReclaimTierPaceMs`, `childReclaimFailureWaitMs`, `childReclaimTierSeed` or `childReclaimSweepOutcomeOf`.
- The docstring case fails at `expected '…' not to contain 'still asked for at least once a'`.
- Each lane case fails at its first `toMatchObject`, `expected { …(N) } to match object { tier: true, … }` (the last case `{ tier: false, … }`), because the entry carries no tier field yet.

If a lane case fails earlier than that, read the error and STOP before changing the shared fixture beyond Step 2a. For example, it might report no request on the second pass. That means Task 2, 3 or 5 changed the lane's eligibility for a plain child, and the fixture's assumptions must be re-measured. A TypeError that names `exec`, `journal`, `advance`, `advanceTo`, `mono` or `entryOf` means Step 2a missed an item. That is a fixture fault, not this task's red.

- [ ] **Step 4: Implement L1 (`server/src/childReclaimSweep.ts`)**

4a. In the ceiling's docstring, replace the sentence `The same span caps the failure backoff and is how long a run of failures lasts before the child is listed (spec §5.9: "kept failing past the defer ceiling").` (it spans the `*` lines :24-26) with:

```ts
 *  its own safeguard. The same span caps the ORDINARY failure ramp
 *  (`childReclaimBackoffMs`), is the persistent tier's first wait
 *  (`childReclaimTierPaceMs`), and is how long a run of failures lasts before
 *  the child is listed (spec §5.9: "kept failing past the defer ceiling"). */
```

4b. In the entry's docstring, the sentence ending `never cause one.` (:54-56) gains a second sentence directly after it:

```ts
 *  it, and losing it can only DELAY a reclaim, or retry a failing one sooner —
 *  never cause one. The persistent tier is the one part a first sighting reads
 *  back: it is seeded from the mirror's current generation
 *  (`childReclaimTierSeed`), so a lost memory costs a tier child one extra ask,
 *  never a fresh tier wait and never a fall back to the ordinary ramp. …
```

(Keep the rest of that docstring unchanged. Re-wrap only the lines you touched.)

4c. `export interface ChildReclaimSweepEntry {` becomes `export interface ChildReclaimSweepEntry extends ChildReclaimTierState {`.

4d. `childReclaimFirstSighting` gains a LAST parameter, after Task 2's generation key (its fourth, H5), and spreads it. Below is Task 2's literal written out in full. Only `tier` and its spread are new:

```ts
export const childReclaimFirstSighting = (
  monoMs: number, bornAt: number | null, markerRunId: number, generation: ChildReclaimGenerationKey,
  tier: ChildReclaimTierState = CHILD_RECLAIM_TIER_NONE,
): ChildReclaimSweepEntry => ({
  firstEligibleAt: monoMs, firstDeferredAt: null, firstPresenceDeferredAt: null, lastPresenceDeferredAt: null,
  lastPresenceWallAt: null, presenceHeldSince: null,
  consecutiveFailures: 0, lastFailedAt: null, refusedAt: null, lastAskedAt: null, bornAt, markerRunId, generation,
  lastDeferWhy: null, ...childReclaimTierOf(tier),
});
```

In Task 2's docstring, `no clock, no failure, never asked.` becomes `no clock, no failure, never asked, and on the persistent tier as \`tier\` seeds it (\`childReclaimTierSeed\`; none by default).`

4e. Replace `ChildReclaimSweepOutcome` and its docstring:

```ts
/** The executor's outcome, as far as this memory needs it. Projected from
 *  wave 3's `ChildReclaimOutcome` by `childReclaimSweepOutcomeOf`
 *  (`coord/childReclaim.ts`), which this file cannot import (an L3 module).
 *  A `failed` answer carries ccd's own word (`token`, null where ccd named
 *  none) and whether that word is in the stuck class (`stuck`), so the
 *  persistent tier is decided here, from the answer alone. */
export type ChildReclaimSweepOutcome =
  | { readonly kind: 'reclaimed' | 'gone' }
  | { readonly kind: 'failed'; readonly token: string | null; readonly stuck: boolean }
  | { readonly kind: 'refused'; readonly token: string }
  | { readonly kind: 'deferred'; readonly why: string };

/** How the lane writes a REJECTED request (spec §5.7): as a failure. A
 *  rejection is a defect the executor could not name, so it carries no word,
 *  and it leaves the persistent tier exactly as it stands. */
export const CHILD_RECLAIM_SWEEP_REJECTED: ChildReclaimSweepOutcome = { kind: 'failed', token: null, stuck: false };
```

4f. In `childReclaimNextEntry`:

```ts
    case 'failed':
      return {
        ...entry, ...childReclaimTierAfterFailure(entry, outcome.token, outcome.stuck),
        consecutiveFailures: entry.consecutiveFailures + 1, lastFailedAt: ask.at.monoMs,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, lastPresenceWallAt: null, presenceHeldSince: null,
        refusedAt: null, lastAskedAt: ask.at.monoMs, lastDeferWhy: null,
      };
    case 'refused':
      return {
        ...entry, ...CHILD_RECLAIM_TIER_NONE, consecutiveFailures: 0, lastFailedAt: null,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, lastPresenceWallAt: null, presenceHeldSince: null,
        refusedAt: ask.at.monoMs, lastAskedAt: ask.at.monoMs, lastDeferWhy: null,
      };
```

In the `deferred` arm, change nothing in the returned literal. Add this comment directly above `return {`:

```ts
      // THE PERSISTENT TIER STANDS (spec §5.9): `...entry` keeps its membership, its word, j and its run. The ramp
      // is cleared exactly as it always was (`consecutiveFailures`, `lastFailedAt`), so a deferred tier child is due
      // on its next pass, and the presence lease, its episode and its licence are unchanged (spec §5.7).
```

Add one paragraph to the function's docstring after `A DEFERRAL ends any run of failures and clears \`refusedAt\`, and starts the any-kind clock once.`:

```ts
 *  The persistent tier (spec §5.9, `childReclaimTierAfterFailure`) moves only
 *  on a failure, ends on a refusal, and is kept by a deferral.
```

4g. Replace `childReclaimBackoffMs`'s docstring, and insert the tier block directly below the function:

```ts
/** The ORDINARY failure ramp (spec §5.9: "retries back off in between"):
 *  `min(ceiling, passInterval × 2^k)` after k failed attempts in a row — two
 *  intervals after the first failure, doubling, never longer than the
 *  ceiling. `0` with no failure. A child on the PERSISTENT TIER waits longer
 *  (`childReclaimFailureWaitMs`), up to `CHILD_RECLAIM_TIER_CAP_MS`. Neither
 *  wait has an unbounded arm, so a child that keeps failing is always asked
 *  again. */
export function childReclaimBackoffMs(consecutiveFailures: number, passIntervalMs: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(CHILD_RECLAIM_DEFER_CEILING_MS, passIntervalMs * 2 ** consecutiveFailures);
}

/** THE PERSISTENT TIER (spec §5.9, "the persistent tier"). The ordinary ramp
 *  asks a child whose every attempt fails about once a ceiling, for ever. A
 *  word that will not heal by itself gains nothing at that pace but feed and
 *  journal rows. Such a word is a tree ccd proved is not the child's own (the
 *  stuck class), or the same failure word time after time.
 *
 *  ENTRY: a `stuck` answer (the class `coord/childReclaim.ts` spells once, carried here on the answer), or the
 *  `CHILD_RECLAIM_TIER_ENTRY_RUN`-th consecutive failure carrying the SAME countable word. EXIT: a reclaim, a
 *  gone row, any refusal, or a failure with a different countable word. A failure whose word is NOT countable
 *  (`childReclaimTierCountable`: none, or a pre-lock die's, both of which hit every child alike) neither enters,
 *  counts, advances nor ends it, because those are exactly the failures the journal records as no word, or
 *  never at all, and the restart seed must read back what the memory held. A deferral keeps it. PACE:
 *  `childReclaimTierPaceMs(j)`, where `j = max(0, run − K)`, the same j the restart seed derives, so a restarted
 *  process paces a child exactly as the one that died would have. Every count is in this memory. No clock
 *  decides membership.
 *
 *  A stated cost: a cure that is not the child's own (a fleet update, say) is picked up only at the tier's next
 *  ask, up to `CHILD_RECLAIM_TIER_CAP_MS` later. */
export const CHILD_RECLAIM_TIER_ENTRY_RUN = 4;
/** The persistent tier's longest wait: four hours. Finite on purpose, so the tier never stops asking. */
export const CHILD_RECLAIM_TIER_CAP_MS = 4 * 3600_000;

/** One child's place on the persistent tier. Part of `ChildReclaimSweepEntry`, and in memory only like it. */
export interface ChildReclaimTierState {
  /** On the tier: its failure wait is `childReclaimTierPaceMs(tierJ)`, never the ordinary ramp alone. */
  readonly tier: boolean;
  /** The countable word of the current run of failures, or null with no such run. */
  readonly tierToken: string | null;
  /** The tier's exponent, `max(0, tierRun − CHILD_RECLAIM_TIER_ENTRY_RUN)` on the tier, else 0. */
  readonly tierJ: number;
  /** Consecutive failures carrying `tierToken`, counting through deferrals and uncountable failures. */
  readonly tierRun: number;
}

export const CHILD_RECLAIM_TIER_NONE: ChildReclaimTierState = { tier: false, tierToken: null, tierJ: 0, tierRun: 0 };

/** Does this failure word count toward the tier? A word ccd named, and not a pre-lock die's. */
export const childReclaimTierCountable = (token: string | null): token is string =>
  token !== null && !isChildReclaimPreLockToken(token);

/** The tier fields alone, so a spread never carries the rest of an entry. */
export function childReclaimTierOf(t: ChildReclaimTierState): ChildReclaimTierState {
  return { tier: t.tier, tierToken: t.tierToken, tierJ: t.tierJ, tierRun: t.tierRun };
}

/** The ONE derivation of membership and j from a run, shared by the live memory and the restart seed. */
function childReclaimTierFrom(token: string | null, run: number, stuck: boolean): ChildReclaimTierState {
  const tier = stuck || run >= CHILD_RECLAIM_TIER_ENTRY_RUN;
  return { tier, tierToken: token, tierJ: tier ? Math.max(0, run - CHILD_RECLAIM_TIER_ENTRY_RUN) : 0, tierRun: run };
}

/** The tier after one failed answer. */
export function childReclaimTierAfterFailure(t: ChildReclaimTierState, token: string | null, stuck: boolean): ChildReclaimTierState {
  if (!stuck && !childReclaimTierCountable(token)) return childReclaimTierOf(t);   // neutral: the tier stands
  const run = token !== null && token === t.tierToken ? t.tierRun + 1 : 1;         // a different word starts a run
  return childReclaimTierFrom(token, run, stuck);
}

/** The tier's wait after a failure: `min(CHILD_RECLAIM_TIER_CAP_MS, ceiling × 2^j)`. Finite for EVERY input. A
 *  non-positive or non-numeric j reads 0, the ceiling, and an overflowing one reads the cap. */
export function childReclaimTierPaceMs(j: number): number {
  const e = j > 0 ? j : 0;
  return Math.min(CHILD_RECLAIM_TIER_CAP_MS, CHILD_RECLAIM_DEFER_CEILING_MS * 2 ** e);
}

/** The wait after the last failure, the ONE number `childReclaimDue`'s backoff reads: the ordinary ramp, or on
 *  the tier its pace. The pace starts at the ceiling, which the ramp never exceeds, so it is never shorter than
 *  the ramp (spec §5.7: pacing is only ever slower). */
export function childReclaimFailureWaitMs(entry: ChildReclaimSweepEntry, passIntervalMs: number): number {
  return entry.tier ? childReclaimTierPaceMs(entry.tierJ) : childReclaimBackoffMs(entry.consecutiveFailures, passIntervalMs);
}
```

4h. `childReclaimBackoffOver` reads the one wait:

```ts
const childReclaimBackoffOver = (entry: ChildReclaimSweepEntry, monoMs: number, passIntervalMs: number): boolean =>
  entry.lastFailedAt === null
  || monoMs - entry.lastFailedAt >= childReclaimFailureWaitMs(entry, passIntervalMs);
```

In its docstring, `once \`childReclaimBackoffMs\` has elapsed` becomes `once \`childReclaimFailureWaitMs\` has elapsed (the ordinary ramp, or the persistent tier's pace)`. In `childReclaimDue`'s docstring, `the failure backoff (above)` becomes `the failure backoff (above, the persistent tier's pace included)`.

4i. Directly below `childReclaimJournalRow`, add the seed:

```ts
/** THE PERSISTENT TIER'S RESTART SEED (spec §5.9). The memory is lost on a restart, a raised switch, a missing
 *  capability, a mirror fail-shut and every pass that does not find the child eligible. So every first sighting
 *  reads the tier back from ccd's own journal of the CURRENT generation:
 *  - it walks back over `reclaim` lines, reading past `intent`s and other acts;
 *  - it reads past a `refused` line whose word `kindOf` classes neither `terminal` nor `gone`: a box retry
 *    refusal, which the executor answers as a deferral that KEEPS the tier, or a word this build cannot classify,
 *    which it answers as a failure naming no word (neutral). ccd journals every refusal, so without this a
 *    restart would read a shorter run than the memory held;
 *  - it reads past a failure line whose word is not countable, as the memory is neutral to it;
 *  - it counts the latest run of one countable word, and ends at any other outcome or another word.
 *  Membership and j come from `childReclaimTierFrom`, the live memory's own derivation. The caller leaves
 *  `lastFailedAt` null, so a seeded child is asked once on its next due pass, and its tier pace applies from that
 *  answer on. A lost memory costs one extra ask, never a fresh wait.
 *
 *  `generation` is `childReclaimGeneration(events, now)`'s slice. It is read only when its opening `create` is
 *  `bornAt`, the birth the new entry describes, so another workspace's rows never seed this one. No birth seeds
 *  nothing. No clock is read: ccd's `at` places nothing here. `stuckOf` is the stuck class and `kindOf` wave 3's
 *  token kind, both injected (`isChildReclaimStuckToken`, `childReclaimTokenKind`; this file imports L0 alone).
 *  Two residuals:
 *  - The slice can be windowed short (`lifecycleFor`'s page), which only makes a run look younger.
 *  - A recycled slug's rows are read before its new `create` is placed.
 *  Each affects pacing only. */
export function childReclaimTierSeed(
  generation: readonly MirroredLifecycleEvent[], bornAt: number | null, stuckOf: (token: string) => boolean,
  kindOf: (token: string) => ChildReclaimTokenKind | null,
): ChildReclaimTierState {
  const opening = generation[0];
  if (bornAt === null || opening === undefined || opening.at !== bornAt) return CHILD_RECLAIM_TIER_NONE;
  let token: string | null = null;
  let run = 0;
  for (let k = generation.length - 1; k >= 0; k -= 1) {
    const e = generation[k]!;
    if (e.act !== RECLAIM_ACT || e.outcome === INTENT) continue;
    if (e.outcome === REFUSED && e.refusal !== null && !isChildReclaimPreLockToken(e.refusal)) {
      const kind = kindOf(e.refusal);
      // a box retry refusal (the executor's deferral, which keeps the tier) or a word this build cannot classify
      // (a word-less failure, neutral): the live memory's tier stands through both, so the walk reads past them
      if (kind !== 'terminal' && kind !== 'gone') continue;
    }
    if (!childReclaimFailureLine(e)) break;
    if (!childReclaimTierCountable(e.refusal)) continue;
    if (token !== null && e.refusal !== token) break;
    token = e.refusal;
    run += 1;
  }
  return token === null ? CHILD_RECLAIM_TIER_NONE : childReclaimTierFrom(token, run, stuckOf(token));
}
```

- [ ] **Step 5: The projection (`server/src/coord/childReclaim.ts`)**

5a. Add `type ChildReclaimSweepOutcome` to the `../childReclaimSweep.js` import. Directly below the `ChildReclaimOutcome` type, add:

```ts
/** The executor's answer as the sweep's memory needs it (spec §5.9, the persistent tier). The ONE projection:
 *  `failed` carries ccd's own word and whether it is in the stuck class, decided HERE by the class's one spelling
 *  (`isChildReclaimStuckToken`). The lane hands the same predicate, and the same token kind the executor's
 *  refusal arm reads (`childReclaimTokenKind`), to the restart seed (`childReclaimTierSeed`), so the live memory
 *  and the seed never classify one word two ways. Every other arm
 *  carries what the memory reads, and nothing else. */
export function childReclaimSweepOutcomeOf(o: ChildReclaimOutcome): ChildReclaimSweepOutcome {
  switch (o.kind) {
    case 'reclaimed': case 'gone': return { kind: o.kind };
    case 'refused': return { kind: 'refused', token: o.token };
    case 'deferred': return { kind: 'deferred', why: o.why };
    case 'failed': return { kind: 'failed', token: o.token, stuck: isChildReclaimStuckToken(o.token) };
  }
}
```

5b. Nothing else in this file. `isChildReclaimStuckToken` is Task 6's type guard (H3), and it is already exported here. Never declare a second one, and never a copy that returns `boolean`. `childReclaimSweepOutcomeOf` adds no new quoted kebab literal under `server/src/coord`, so `isChildReclaimKebab` needs no admission.

- [ ] **Step 6: Wire the lane (`server/src/watch.ts`)**

6a. Imports:
- add `childReclaimSweepOutcomeOf` ALONE to the `./coord/childReclaim.js` import. `isChildReclaimStuckToken` is already there (Task 8's Step 3h), and importing it again is a duplicate identifier and a tsc error;
- add `CHILD_RECLAIM_SWEEP_REJECTED` and `childReclaimTierSeed` to the `./childReclaimSweep.js` import;
- `childReclaimTokenKind` is already in the `./coord/childReclaim.js` import (wave 4, watch.ts:89 at `226bb881c`), so the seed's `kindOf` needs no import. Never import it again.

6b. In the memory field's docstring (:799-802), after `…which ccd's re-proof on the box makes safe — never cause one.` add `The persistent tier is re-read at every first sighting (\`childReclaimTierSeed\`), so a lost memory costs a tier child one extra ask, never a fresh tier wait.`

6c. Step ONE. Directly below `let claims: …;`, add:

```ts
    // THE PERSISTENT TIER'S SEED (spec §5.9) reads each child's CURRENT generation, the slice this read already
    // cuts: kept per id for the first sightings below, never read again.
    const tierGenerations = new Map<string, readonly MirroredLifecycleEvent[]>();
```

Inside the loop, directly below `const gen = childReclaimGeneration(…);`, add `tierGenerations.set(r.id, gen);`.

6d. The first sighting. Keep Task 2's narrowing (`if (!isChildReclaimGenerationKey(regGeneration)) { … continue; }`), its comment block and its `if` line exactly as they stand. Replace only the `set` line, so that it appends the seed after Task 2's key:

```ts
      if (entry === undefined || !childReclaimSameGeneration(entry, childBornAt, v.runId, regGeneration)) {
        // A LOST MEMORY NEVER RESETS THE PERSISTENT TIER (spec §5.9): the sighting is seeded from the mirror's
        // current generation, with `lastFailedAt` left null, so a tier child is asked once on its next due pass
        // and then waits its tier pace. It never waits a fresh tier pace, and never falls back to the 15-minute ramp.
        this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(mono, childBornAt, v.runId, regGeneration,
          childReclaimTierSeed(tierGenerations.get(r.id) ?? [], childBornAt, isChildReclaimStuckToken, childReclaimTokenKind)));
        continue;
      }
```

6e. The answer: `this.childReclaimWriteBack(r.id, entry, outcome, ask, answered);` becomes `this.childReclaimWriteBack(r.id, entry, childReclaimSweepOutcomeOf(outcome), ask, answered);`.

6f. The rejection: `this.childReclaimWriteBack(r.id, entry, { kind: 'failed' }, ask, answered);` becomes `this.childReclaimWriteBack(r.id, entry, CHILD_RECLAIM_SWEEP_REJECTED, ask, answered);`. Add one sentence to the comment above it: `It names no word, so it leaves the persistent tier as it stands.`

- [ ] **Step 7: Bring the existing policy suite onto the new shapes (no expectation changes)**

```bash
cd server && sed -i \
  -e "s/{ kind: 'failed' as const }/{ kind: 'failed' as const, token: null, stuck: false }/g" \
  -e "s/{ kind: 'failed' }/{ kind: 'failed', token: null, stuck: false }/g" \
  test/child-reclaim-sweep-policy.test.ts
grep -c "{ kind: 'failed' }\|{ kind: 'failed' as const }" test/child-reclaim-sweep-policy.test.ts   # 0
```

In the case `a first sighting starts no clock, counts no failure, and was never asked`, the `toEqual` literal gains `tier: false, tierToken: null, tierJ: 0, tierRun: 0,`. Review `git diff test/child-reclaim-sweep-policy.test.ts`: only those literals change.

- [ ] **Step 8: Run to pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-persistent-tier.test.ts test/child-reclaim-tier-lane.test.ts \
  test/child-reclaim-sweep-policy.test.ts test/child-reclaim-sweep.test.ts test/child-reclaim-status.test.ts \
  test/child-reclaim-runs-route.test.ts test/child-reclaim-paused-at-server.test.ts test/child-reclaim.test.ts \
  test/containment-refuted-word.test.ts
```

Expected: PASS everywhere, with `child-reclaim-persistent-tier` at 25/25 and `child-reclaim-tier-lane` at 5/5 (both re-measure (R-j)), run in the FOREGROUND under 600 s. Every pre-existing case stays green unchanged. They prove that a non-tier child paces exactly as before.

Then run every other user of the shared lane fixture, which Step 2a extended additively:

```bash
cd server && ./node_modules/.bin/vitest run $(grep -l "childReclaimGenerationFixture" test/*.test.ts)
```

Expected: PASS, with each file at the count its own task recorded. A red here comes from Step 2a, never from the other tasks' cases: fix the fixture, not the case.

- [ ] **Step 9: Types**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

`tsc` prints nothing. `typecheck-tests` is a known load flake: if it reds, re-run it alone before reading it as a break. It reds on a `failed` literal Step 7 missed in another file. Fix that file the same way.

- [ ] **Step 10: Mutation check**

Make each mutation alone on the Step 8 tree, run its command (FOREGROUND), see the stated red, then revert. P is `test/child-reclaim-persistent-tier.test.ts` and L is `test/child-reclaim-tier-lane.test.ts`. Every command is `cd server && ./node_modules/.bin/vitest run <file> [-t '<case>']`.

| # | Mutation (exact edit) | File, case | Expected red |
|---|---|---|---|
| 1 | `CHILD_RECLAIM_TIER_ENTRY_RUN = 4` → `= 3` | P `-t 'K is 4'`; P `-t '(b) the K-th'` | `expected 3 to be 4`; the third row of the `toEqual` diff shows `tier: true` |
| 2 | `CHILD_RECLAIM_TIER_CAP_MS = 4 * 3600_000` → `= 8 * 3600_000` | P `-t 'K is 4'` | `expected 28800000 to be 14400000` |
| 3 | Delete the line `if (!stuck && !childReclaimTierCountable(token)) return childReclaimTierOf(t);` | P `-t 'neither breaks'`; P `-t 'never count toward'` | `expected { tier: false, tierToken: null, tierJ: 0, tierRun: 1 } to deeply equal { tier: true, tierToken: 'worktree-remove-failed', … }`; for `flock-unavailable`, `expected { tier: true, … tierRun: 12 } to deeply equal { tier: false, tierToken: null, tierJ: 0, tierRun: 0 }` |
| 4 | In `childReclaimTierCountable`, delete `&& !isChildReclaimPreLockToken(token)` | P `-t 'never count toward'` | `flock-unavailable: expected true to be false` |
| 5 | In `childReclaimTierAfterFailure`, `token !== null && token === t.tierToken ? t.tierRun + 1 : 1` → `t.tierRun + 1` | P `-t 'a different countable word'`; P `-t 'agree on every sequence'` | `expected { tier: true, tierToken: 'pin-failed', tierJ: 2, tierRun: 6 } to deeply equal { tier: false, tierToken: 'pin-failed', tierJ: 0, tierRun: 1 }` |
| 6 | In the `refused` arm, delete `...CHILD_RECLAIM_TIER_NONE, ` | P `-t 'any refusal ends it'` | `expected { tier: true, … } to deeply equal { tier: false, tierToken: null, tierJ: 0, tierRun: 0 }` |
| 7 | In the `deferred` arm, add `...CHILD_RECLAIM_TIER_NONE, ` after `...entry,` | P `-t 'keeps the tier'` | `presence: expected { tier: false, tierToken: null, … } to deeply equal { tier: true, tierToken: 'worktree-remove-failed', tierJ: 1, tierRun: 5 }` |
| 8 | In the `deferred` arm, `lastFailedAt: null` → `lastFailedAt: entry.lastFailedAt` | P `-t 'keeps the tier'` | `presence: expected { …, lastFailedAt: <n>, … } to match object { consecutiveFailures: 0, lastFailedAt: null }` |
| 9 | In `childReclaimTierPaceMs`, return `CHILD_RECLAIM_DEFER_CEILING_MS * 2 ** e` (no `Math.min`) | P `-t 'finite for every j'` | the `toEqual` diff shows `3600000` where `14400000` was expected (j = 4) |
| 10 | In `childReclaimTierPaceMs`, `const e = j > 0 ? j : 0;` → `const e = j;` | P `-t 'finite for every j'` | the diff shows `NaN` and `112500` where `900000` was expected |
| 11 | In `childReclaimTierPaceMs`, `CHILD_RECLAIM_DEFER_CEILING_MS * 2 ** e` → `60_000 * 2 ** e` | P `-t 'never faster than today'` | `k=2 j=0: expected 60000 to be greater than or equal to 240000` |
| 12 | In `childReclaimBackoffOver`, `childReclaimFailureWaitMs(entry, passIntervalMs)` → `childReclaimBackoffMs(entry.consecutiveFailures, passIntervalMs)` | P `-t 'reads the tier pace'`; L `-t 'restart does not fall back'` | `expected true to be false`; `at +900000 ms: expected [ …(2) ] to have a length of 1 but got 2` |
| 13 | In `childReclaimTierSeed`, delete `bornAt === null \|\| ` and `\|\| opening.at !== bornAt` | P `-t "OWN generation"` | `expected { tier: true, tierToken: 'worktree-remove-failed', tierJ: 2, tierRun: 6 } to deeply equal { tier: false, tierToken: null, tierJ: 0, tierRun: 0 }` |
| 14 | In `childReclaimTierSeed`, `if (!childReclaimTierCountable(e.refusal)) continue;` → `break;` | P `-t 'read past, as the live memory'`; P `-t 'agree on every sequence'` | `expected { tier: false, tierToken: 'worktree-remove-failed', tierJ: 0, tierRun: 2 } to deeply equal { tier: true, …, tierRun: 4 }` |
| 15 | In `childReclaimTierSeed`, delete `if (token !== null && e.refusal !== token) break;` | P `-t 'a different word ends the count'` | `expected { tier: true, tierToken: 'worktree-remove-failed', tierJ: 3, tierRun: 7 } to deeply equal { tier: false, tierToken: 'pin-failed', tierJ: 0, tierRun: 2 }` |
| 16 | In `childReclaimTierFrom`, `Math.max(0, run - CHILD_RECLAIM_TIER_ENTRY_RUN)` → `run` | P `-t 'six failures of one word'`; L `-t 'restart does not fall back'` | `expected { …, tierJ: 6, … } to deeply equal { …, tierJ: 2, … }`; `expected { … } to match object { …, tierJ: 2, … }` |
| 17 | In `childReclaimTierSeed`, `stuckOf(token)` → `false` | P `-t 'in the stuck class seeds'` | `expected { tier: false, tierToken: 'containment-refuted', tierJ: 0, tierRun: 1 } to deeply equal { tier: true, … }` |
| 18 | In `childReclaimSweepOutcomeOf`, `stuck: isChildReclaimStuckToken(o.token)` → `stuck: false` | P `-t 'one stuck spelling'`; L `-t 'memory clear never starves'` | `expected { kind: 'failed', token: 'containment-refuted', stuck: false } to deeply equal { …, stuck: true }`; `expected { …, tier: false, … } to match object { tier: true, tierToken: 'containment-refuted', tierJ: 0 }` |
| 19 | In `childReclaimTierSeed`, `if (e.act !== RECLAIM_ACT \|\| e.outcome === INTENT) continue;` → `if (e.act !== RECLAIM_ACT) continue;` | P `-t 'six failures of one word'` | `expected { tier: false, tierToken: 'worktree-remove-failed', tierJ: 0, tierRun: 1 } to deeply equal { tier: true, …, tierRun: 6 }` |
| 20 | In watch.ts's first sighting, delete the `childReclaimTierSeed(…)` argument | L `-t 'restart does not fall back'`; L `-t 'memory clear never starves'` | `expected { …, tier: false, … } to match object { tier: true, tierToken: 'worktree-remove-failed', tierRun: 6, … }` |
| 21 | In watch.ts's first sighting, wrap the seeded entry as `{ ...childReclaimFirstSighting(…), lastFailedAt: mono }` | L `-t 'memory clear never starves'` | `asked once on its next due pass, never a fresh tier wait: expected [ …(1) ] to have a length of 2 but got 1` |
| 22 | `CHILD_RECLAIM_SWEEP_REJECTED`'s `token: null` → `token: 'rejected'` | P `-t 'rejection is written'`; L `-t 'a rejection names no word'` | `expected { kind: 'failed', token: 'rejected', stuck: false } to deeply equal { …, token: null, … }`; `expected { …, tier: false, … } to match object { tier: true, … }` |
| 23 | Restore `still asked for at least once a` in `childReclaimBackoffMs`'s docstring | P `-t 'no longer promise'` | `expected '…' not to contain 'still asked for at least once a'` |
| 24 | In `childReclaimTierSeed`, delete the line `if (kind !== 'terminal' && kind !== 'gone') continue;` | P `-t 'journaled box retry refusal and an unclassified'`; P `-t 'agree on every sequence'`; L `-t 'never resets the seed'` | `attached: expected { tier: false, tierToken: 'worktree-remove-failed', tierJ: 0, tierRun: 2 } to deeply equal { tier: true, …, tierRun: 4 }`; the agreement case reds on a sequence holding `box-retry` or `refused-unknown` (its message prints the sequence); the lane case `expected { …, tier: false, … } to match object { tier: true, …, tierRun: 4, … }` |
| 25 | In `childReclaimTierSeed`, `kind !== 'terminal' && kind !== 'gone'` → `kind !== 'terminal'` | P `-t 'any other reclaim outcome ends the walk'` | `refused:no-such-session: expected { tier: true, tierToken: 'worktree-remove-failed', tierJ: 1, tierRun: 5 } to deeply equal { tier: false, tierToken: null, tierJ: 0, tierRun: 0 }` |
| 26 | In watch.ts's first sighting, the seed's last argument `childReclaimTokenKind` → `() => 'terminal' as const` | L `-t 'never resets the seed'` | `expected { …, tier: false, tierToken: 'worktree-remove-failed', tierRun: 2, … } to match object { tier: true, tierToken: 'worktree-remove-failed', tierRun: 4, … }` |

- [ ] **Step 11: Commit**

```bash
git add server/src/childReclaimSweep.ts server/src/coord/childReclaim.ts server/src/watch.ts \
  server/test/child-reclaim-sweep-policy.test.ts server/test/child-reclaim-persistent-tier.test.ts \
  server/test/child-reclaim-tier-lane.test.ts server/test/childReclaimGenerationFixture.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the persistent tier, seeded from the mirror on every sighting

A child whose reclaim keeps failing with the same word, or with a stuck
word, moves onto a tier that asks min(4 h, ceiling x 2^j). It enters at
once on a stuck answer, or on the fourth consecutive failure with one
countable word. It leaves on a reclaim, a gone row, a refusal, or a
different countable word. A null or pre-lock word neither enters, counts
nor ends it. A deferral keeps the tier and clears the ramp as before, so
the presence lease is unchanged. Every first sighting re-reads the tier
from the current generation's journal and leaves lastFailedAt null. A
restart or a cleared memory therefore costs one extra ask, never a fresh
four-hour wait, and never a return to the 15-minute ramp. The executor's
answer reaches the memory through one projection, which carries ccd's
word and the stuck class. The lane cases run on the shared lane fixture,
which gains additive options only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Docs

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
- Modify: `docs/superpowers/programs/child-reclamation-contract.md`: append "### §15 as built (wave 8, run 348)" at the end of §15 ONLY.
- Modify: `README.md`: the citation tax, and the reclaim lane's paragraph where its behaviour changed. Follow claim 1110's agreement, or wait for it to end.

Write in the spec's voice. It cites no contract rule and carries no `D-` token. Measure every sentence against the code at this branch's tip.

- [ ] **Step 1: The spec**
  - **§5.5:** the licence bound to the generation (sweep, re-read, audit, token), and close's `none`.
  - **§5.7:**
    - the hold-retired memory keyed by generation;
    - the persistent tier: entry, exit, pace, restart seeding and deferral;
    - `child-birth-unplaced`'s two causes.
  - **§5.9:**
    - the readers of `crumb` and of the exit-1 audit;
    - the kept-leaf item for a purged row, with its source, its ends and its collapse;
    - the `stuck` class: attention, precedence, the chip word `deferred`, and the feed;
    - the kept and held variants, which carry no retry clause;
    - that the stuck and kept-leaf sentences carry ccd's `detail` as one bounded plain line (control and bidi characters replaced, at most `LC_LINE_MAX` characters);
    - the sentence that `grep -n "holds no dated creation of its workspace" docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` finds, rewritten to name both causes;
    - `generation-changed` worded by what was measured: the workspace no longer carries the generation the sweep judged it under. It never says "removed and made again".
  - **§7 item 6, the stated residuals:**
    - an older ccd's unlicensed gap;
    - the read follows symlinks;
    - an unreadable generation shows on the chip only;
    - the gather's agent load is unmeasured;
    - a lost new create reads as doubt;
    - there is no fourth resume value, so an audit over an unreadable breadcrumb reads not-resumable;
    - a box-level cure can wait up to the tier's cap;
    - the seed's windowed slice, and the recycled-slug window, affect pacing only.
  - **§8:** this wave's row.
- [ ] **Step 2: The contract's "§15 as built" note.** One note at the end of §15, in the style of "§12 as built". Every departure named by slug gets one sentence. Write each number singly. It also amends R76's "nothing retries it": `purge-incomplete`'s feed tail is conditional, because the sweep asks again if the row's own files still stand.
- [ ] **Step 3: Run the docs scanners**

```bash
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts test/expiry-lane-prose.test.ts test/dead-coordinator-prose.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md docs/superpowers/programs/child-reclamation-contract.md README.md
git commit -F - <<'EOF'
docs(reclaim): the licence bound to its generation, the readers, the stuck class and the tier, as built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Whole-branch verification and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless Step 3 re-measures a citation census, which then goes in its own `docs(census)` commit.

- [ ] **Step 1: The FIRST full run after implementation, in the foreground**

This run's verdict is the wave-done's `suite:` line (worker clause 15). Record it before any fix.

```bash
cd server && npm ci && find test -name '*.test.ts' | wc -l
cd server && ./node_modules/.bin/vitest run --shard=1/24      # … through --shard=24/24, one call each, timeout 600000 ms
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

- Use ONE denominator for the whole set. If a shard overruns 600 s, re-run the whole set at `/48`. Check that the shards' `Test Files` lines sum to the `find` count.
- Re-run a CLAUDE.md load flake in isolation before calling it a break.
- A red that a clean checkout of `origin/main` also shows is reported once as `main-red`.
- The PWA is untouched, and must be green unchanged. That proves the widened attention union and the chip need no PWA edit.

- [ ] **Step 2: Type-check, build, and the deviation and token cross-checks**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa    && npm run build
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/single-definition.test.ts test/topology-clean.test.ts test/lifecycle-refusal-word.test.ts
git log origin/main..HEAD --format=%B | grep -cE 'D-[0-9]'
git log origin/main..HEAD --format=%B | grep -cE '[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'
git diff origin/main...HEAD | grep -nE '^\+.*D-[0-9]+ ?(–|\.\.|-) ?(D-)?[0-9]+'
```

Expected:
- every type-check and build exits 0;
- the vitest files PASS;
- both `grep -c` lines print `0`;
- the last line prints nothing.

- [ ] **Step 3: The citation tax and ownership**

```bash
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND')
```

Expected: PASS.

- [ ] **Step 4: The hard boundary**

```bash
git diff --name-only origin/main...HEAD | grep -vE '^(server/src/|server/test/|shared/api\.ts$|README\.md$|docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design\.md$|docs/superpowers/programs/child-reclamation-contract\.md$)'
git diff --name-only origin/main...HEAD -- ccd/ agent/ pwa/ deploy/ server/src/coord/schema.ts server/src/deadCoordinator.ts
```

Expected: both print nothing.

- [ ] **Step 5: Push and open the PR.**
  - The title is "Child reclamation wave 8: reclaim's server half — the licence bound to its generation, the readers, the stuck class and the tier".
  - The body lists:
    - the tasks and the boundary;
    - the suite verdict;
    - each stated residual;
    - each departure, by slug;
    - the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - The body has no box path and no docserver link.
- [ ] **Step 6: The wave-done**, per the worker skill.

---

## Review lenses

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written (coordinator clause 14). Every finding gets the panel's refuters. A lens that dies or returns nothing is unverified, never approval. Every scratch case uses fakes or fixture HOMEs only.

### 0. SAFETY: what `ws-reclaim` is licensed against (opus, xhigh, MANDATORY)

This is the destructive subject alone (R65). Read these at the tip, against `origin/main`:
- `childReclaimOutcome` whole;
- `parseChildReclaimAudit`;
- `childReclaimGenerationRead`;
- `sweepChildReclaim`'s gather and loop;
- the entry key;
- `childReclaimSameGeneration` and `childReclaimSameGenerationKey`;
- close's request;
- `releaseRetiredChildHold`.

**Re-derive:**
- **The licence chain.** For every route by which a request reaches `childReclaimAct`, construct a same-run re-mint at each point of its life:
  - before the sweep read;
  - between the read and the queue;
  - while queued;
  - between the re-read and the audit;
  - between the audit and the act.

  Also construct an older ccd, an absent and an unreadable generation, two queued requests for one id, the presence-only licence, and close. None may act on a workspace other than the one judged.
- **The gather.** The loop stays synchronous, and an overtaken gather decides nothing.
- **X3.** An unequal key replaces the stored one. The release job re-reads after its step 6.
- **R75.** The row's own unfinished purge never unplaces its birth, and a purge with no uuid does.

### 1. SECURITY (opus, high, MANDATORY)

- the byte-exact read and its stated residuals: symlinks, BOM, trailing LF, NUL;
- the exit-1 audit parse: it can never return a spendable kind;
- the mirror reader's handling of truncated and hostile `meas` values;
- every new sentence that carries ccd's `detail` into the PWA. Is it bounded and plain text, never markup?

### 2. Derivation and wire (opus, high)

- every new type and its single definition;
- `leafKeptWord`'s one home, and its agreement with workspace-lifecycle's;
- the attention union's new arms rendering with no PWA edit;
- the resume value `stuck` through every switch;
- the defer word `generation-changed` and its kind-map pin;
- additive-only and absence-permits for every field wave 7 added.

### 3. Pacing and cost (sonnet, high)

- the tier's pace is never faster than today's;
- a memory clear never starves a tier child;
- a deferral keeps the tier state but not the lease state;
- the gather's per-pass agent load;
- the bounded store reads' cost.

---

## Deviations found

This wave's numbers come from the two blocks the allocator issued for run 348. The coordinator assigns them at the fix round: one per departure, each defined here, singly. A departure the worker finds is named by slug in the wave-done.

## Design

**Posture:** none

The server half of the reclaim lane — licence binding and generation keys. `ChildReclaimBanner` renders the result and keeps its shape.

Declared retrospectively: this plan shipped before the posture convention
reached its programme (`server/test/design-declaration.test.ts`). The guard
asks that the question be answered, never which answer is given.
