# Model-Class Registry — Plan 2: class carried across swaps and restarts (ccd) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a session's model CLASS survive an account swap and a restart — ccd records the class each session is running, spawns with `--model <class>`, and never rotates a session onto a lane that cannot run its class — and give `ccrc doctor` a `models` check, one PASS/WARN/FAIL per non-Anthropic lane.

**Architecture:** `ccd/statusline-command.sh` is the only process on the box that sees Claude Code's own `session_id` and concrete `model.id` together, so it publishes one file per session uuid under `~/.cc-sessions/model/`. `ccd/ccd` maps its registry `uuid` back through that file to a concrete id, turns the id into one of the four classes (the family token on an Anthropic lane; a reverse lookup in the materialised `~/.ccrc/models/<account>.classes.tsv` — three columns, `class<TAB>modelId<TAB>state` — on every other lane), stores the answer in a new registry field `class`, and consults it in three places: the spawn line, the rotation's candidate filter, and the manual `ccd swap` gate. All of it reads files Plan 1's `ccrc models` verbs write; nothing here writes the roster, and nothing here reads it. A second `ccd/` file, `ccd/ccrc-doctor-checks`, gets its own `models` check the same way (Task 12): read via node, the same registry and catalogue files, and `shared/models.mjs`/`shared/modelenv.mjs` as the single definitions of what is retired and what the env block should hold — the doctor check moved here from Plan 3a (mail 286, 2026-09-08) because `ccd/ccrc-doctor-checks` is a `ccd/` file PR #62 edits and is shipped with `ccd` on the agent lane.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `ccd/statusline-command.sh`, `ccd/ccrc-doctor-checks`), `jq` 1.7 (the `ccd ls` unclassified COUNT only — availability is read out of the tsv's third column and needs no JSON at all), node ESM `.mjs` twins for the bash doctor reader (`shared/models.mjs`, `shared/modelenv.mjs`, Plan 1's), vitest 4 (`server/test/*.test.ts`, `agent/test/*.test.ts`) driving the real scripts against fixture HOMEs through `makeCcdHarness`.

**Spec:** `docs/superpowers/specs/2026-09-08-model-class-registry-design.md`, at its current tip **`d3048253`** ("docs(models): registry is its own per-account file until account-connections merges; subagent is an explicit class-to-slot choice; discovery scope named apart from selectable; Plan 3 splits behind wave 4", measured 2026-09-08 with `git -C <this worktree> log -1 --oneline`) — this plan implements **§7 in full**, the `ccd ls` lane line (§7 last bullet), `ccd swap <id> <wrapper> --as-class <class>` (§10, last line), and **§8's last bullet** (`ccrc doctor`'s `models` check, moved here from Plan 3a, mail 286, 2026-09-08). §4.3's derived states are consumed here; they are COMPUTED in Plan 1 and reach ccd already computed, in the third column of `<account>.classes.tsv`.

**Skeleton:** `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-skeleton.md`. Its "ccd registry (Plan 2)" section is this plan's contract **as amended by its final section, "Rulings round 2" (mails 279 and 280, 2026-09-08), which overrides everything above it**: no roster `ModelsBlock` (WITHDRAWN — the registry is its own per-account file), `discovery` everywhere the skeleton wrote `shortlist`, an EXPLICIT `subagent` class, a top-level `ccrc models` verb group, and a THREE-COLUMN `<account>.classes.tsv` whose third column carries availability as its own marker.

---

## Where this runs, and what already exists

- **Repository:** the implementation worktree Plan 1 Task 1 created, on branch `feat/model-class-registry-impl`, **cut from `origin/main`** (ruling 280, 2026-09-08 — the earlier "stack on the account-connections branch" instruction is WITHDRAWN, skeleton "Rulings round 2" item 1). Its Task 1 command is
  `git -C <deploy-clone> worktree add -b feat/model-class-registry-impl <S>/mcr-impl origin/main`.
  **No task in this plan reads or edits `shared/roster.ts`, `shared/roster-json.mjs`, `deploy/account-op.mjs` or `ccd/ccrc`'s `cmd_account`** — those live on the account-connections branch and are not on `main`.
- **Every path in every task below is RELATIVE TO THAT REPOSITORY ROOT.** Get there with `cd "$(git rev-parse --show-toplevel)"`. Package-relative commands say which package directory to run them from (`server/`, `agent/`).
- `<worktree>/plain-hollow` (account-connections) and `<worktree>/clear-meadow` (account-pools wave 2b, PR #62) are **other sessions' live worktrees and are READ ONLY**. Do not edit them, do not check anything out in them, do not run anything in them that writes. `clear-meadow` is named throughout because every post-rebase `ccd/ccd` line quoted below was measured on its **committed tip `9e9ebd1c`** ("Merge origin/main (PR #61, the overflow-lane reversal) into ws/clear-meadow") — read it with `git -C <worktree>/clear-meadow show 9e9ebd1c:ccd/ccd`, **not** with `cat` on the worktree: measured 2026-09-08, that worktree's `git status --porcelain` shows ` M ccd/ccd`, ` M ccd/ccrc-doctor-checks` and ` M server/test/ccd-auto-swap-pool.test.ts`, and its uncommitted state shifts every line number by about thirty. That is one more reason every anchor here is re-located by its text. `plain-hollow` is named ONLY as the origin of `MODEL_ID_RE`, which Plan 1 copies into `shared/models.ts` with a comment naming it; this plan neither imports from it nor names any type it defines.
- **THIS PLAN IS GATED. Task 1 is the gate and Task 2 is the rebase.** Account-pools
  PR #62 must be MERGED and DEPLOYED before any task below runs (skeleton, "Rulings
  received after the writers started"; spec §14). After Task 2's rebase the base is no
  longer `origin/main`'s tip but #62's merge commit on `main`, and `ccd/ccd` carries #62's shape:
  the two-bracket `_swap_target`, the roster-wide `_default_pool`, and
  `server/test/ccd-default-pool.test.ts` in the tree. **Every `ccd/ccd` line number
  quoted below was measured on `clear-meadow`'s tip `9e9ebd1c` — the shape the rebase
  brings — and must be re-located after the rebase by the surrounding text, never by
  the number.**
- **Plan 1 has landed on this branch before this plan starts.** This plan assumes these exist and does not re-create them, in the names skeleton "Rulings round 2" fixes:
  - `shared/models.ts` (+ `shared/models.mjs`, `shared/models.d.mts`) exporting `CLASSES`, `ModelClass`, `ClassMap`, `EffortMap`, `ProbeKind`, `Discovery`, `Registry` (`{ probe, classes, subagent, discovery, effort?, baseUrl? }`), `RegistryInvalid`, `parseRegistry`, `Catalogue`, `CatalogueModel`, `CatalogueInvalid`, `parseCatalogue`, `resolveDiscovery`, `deriveModels(reg, catalogue)`, `availableFor(reg, catalogue, anthropic)`, `familyClassOf`, `classOfModel`, `UNAVAILABLE_PREFIX`.
  - `shared/modelenv.mjs` exporting `modelEnvBlock(registry)`, `mergeSettingsEnv`, `effortFile`, **`classesTsv(registry, catalogue)`**.
  - the top-level **`ccrc models`** verb group (`init|show|set-class|set-subagent|set-effort|discovery`, plus `refresh` and `litellm` — spec §10; there is no `ccrc account models`), which WRITES the three generated files this plan reads: the registry `~/.ccrc/models/<accountId>.classes.json`, its bash projection `~/.ccrc/models/<accountId>.classes.tsv`, and the probe's catalogue `~/.ccrc/models/<accountId>.json`.
- **`~/.ccrc/models/<accountId>.classes.tsv` has THREE columns** (skeleton "Rulings round 2" item 6): `class<TAB>modelId<TAB>state`, four lines in CLASSES order, `state ∈ assigned | unassigned | retired`. `modelId` is empty **only** when the state is `unassigned`. **ccd takes availability from column 3 and never infers it from an empty id** — that is the whole reason the column exists, and it is why nothing in this plan opens the catalogue to decide whether a class is routable.
- **The registry file itself (`<accountId>.classes.json`) is NOT read by ccd.** Its `probe`, `subagent`, `discovery` and `effort` fields are Plan 1's and Plan 3a's; ccd's whole view of it is the projection above.
- **Nothing in this plan runs against the real `$HOME`.** No `deploy.sh`, no `systemctl`, no live `ccd`/`ccrc`, no probe. Every test builds its own fixture HOME through `makeCcdHarness` (`server/test/ccdWsHelpers.ts:281`) or `seed()` (`server/test/statusline-script.test.ts:86`).

---

## Skeleton deviations (accepted)

Settled 2026-09-08 by the cross-plan consistency pass, and **re-settled after the
round-2 rulings** (mails 279 and 280) rewrote the base this plan sits on. Each entry
is a place where the repo forces a reading the skeleton does not literally say. Entries
marked WITHDRAWN were deviations from a skeleton clause the rulings themselves removed;
they are kept, struck, rather than renumbered, because Plans 1, 3a and 3b cite these
labels. No locked NAME is changed by any of them, and **no `D-<n>` number is
allocated**: `server/test/deviation-refs.test.ts` forbids an unallocated marker and none
of these needs one.

**A-1 — WITHDRAWN.** It read "`deploy/models-op.mjs` is a NEW file, not new ops on
`deploy/account-op.mjs`". Ruling 280 forbids Plan 1 from touching `deploy/account-op.mjs`
at all, so there is no longer a deviation to take: the new file is simply the only file.
Plan 2 never referenced it and still does not.

**A-2 — `shared/litellm.mjs` + `shared/litellm.d.mts`, the pure §6.3 renderer.** (owned by Plan 1)
The skeleton names `deploy/litellm-config.template.yaml` and the verb
`ccrc models litellm <id>` but not the function that renders one into the other. A
pure function is what lets the render be tested without writing `~/.handoff/`.
Plans 2, 3a and 3b never reference it.

**A-3 — `AccountModels` rides on `RosterWire`, not on `AccountUsage`.** (owned by Plan 3a)
`AccountsResponse` has two arrays of "account rows" and they are not the same set:
`accounts: AccountUsage[]` is built from `~/.cc-limits/*.json` plus markered-off lanes,
so **an account telemetry has never measured has no row there at all** — exactly a
freshly connected OpenRouter or `compatible` lane, the lanes this feature exists for.
`roster: RosterWire[]` is every account the box knows, in roster declaration order. The
field goes there. The type name, the field name and the `null`-for-Anthropic rule are all
as locked. Plan 2 reads no wire type and is unaffected.

**A-4 — WITHDRAWN as Plan 2 saw it.** It read "`RosterWire` also gains
`provider: ProviderId | null`". `provider` is an account-connections field that is not on
`main`, and round-2 item 10 replaces its role here with the registry file's own `probe`.
Whether Plan 3a still needs a wire discriminator between "Anthropic lane" and "external
lane with no registry file" is Plan 3a's to settle against the spec's §9; Plan 2 neither
reads nor writes either.

**A-5 — the wire name for the class is `modelClass`; the registry FIELD ccd writes is
`class`.** (shape owned by Plan 3a; the half that binds Plan 2 is the second clause)
`shared/api.ts` may hold exactly one import line and it must be a type
(`server/test/peers-claims-l0.test.ts:155-161` pins it), so its revivers cannot call a
runtime guard: a class on the wire is a `string`, narrowed at each read site by a
predicate that lives where the runtime list lives — `isModelClass`, added beside `CLASSES`
in **`shared/models.ts`** (round 2 moved `CLASSES` there from the withdrawn roster block).
**The registry field ccd writes is spelled `class`, everywhere, in this plan** —
`modelClass` is the wire name only, and the two are joined in exactly one place, which is
Plan 3a's server reader.

**A-6 — WITHDRAWN.** It read "a `shortlist` ARRAY in the PATCH body is diffed
server-side". `shortlist` no longer exists under any name in any plan: round 2 renames the
concept `discovery` throughout, and the PATCH body's `discovery` is Plan 3a's to reconcile
with the `discovery add|rm|catalogue` verb surface. Plan 2 touches neither.

**A-7 — WITHDRAWN, and its problem with it.** It read "the mutation-check idiom is read on
`origin/main`, not on the base branch", because `server/test/ccd-default-pool.test.ts` was
absent from the account-connections branch this plan used to be cut from. Ruling 280 cuts
the implementation branch from `origin/main`, **where that file is present**, so the
idiom is read where the skeleton's convention 3 says to read it:
`server/test/ccd-default-pool.test.ts` in this worktree, `git show HEAD:server/test/ccd-default-pool.test.ts | sed -n '20,52p'`.
Copy its shape: a header paragraph naming the exact mutation, what it flips, and how many
named cases go red, plus a per-guard mutate/run/restore step.

**A-8 — Plan 2's class filter is the THIRD predicate of `_swap_target`'s composed chain,
written INTO the chain and never as a standalone skip.** (owned by Plan 2 — binding,
skeleton "Rulings round 2" item 8)
The composed chain, quoted verbatim from `ws/clear-meadow`'s tip `9e9ebd1c`
(`ccd/ccd:12126-12128`, inside the single `for cand in $(_pool_for "$id"); do` loop that
opens at `:12111` and inside `_swap_target`, `:12019-12167`):

```bash
    _pool_ok "$cand" "$pps" || continue
    _account_ok "$cand" || continue
    _avail "$cand" || continue
```

and the bracket split that reads its survivors, twenty-eight lines further down
(`ccd/ccd:12156-12162`):

```bash
    if _is_home_able "$cand"; then
      [[ "$sc" -lt "$best_score" ]] && { best="$cand"; best_score="$sc"; }
    else
      [[ "$sc" -lt "$obest_score" ]] && { obest="$cand"; obest_score="$sc"; }
    fi
```

So the chain is, in the order the rulings name it: **#61's overflow bracket** (the
`best`/`obest` split above, which is a RANKING over whatever survives the rungs) →
**#62's pool predicate** (`_pool_ok`, the first rung, and the one whose composition with
#61 the wave-2b plan documents as its own ruled state — read its section "The composed
rule: an untagged overflow lane is in every pool (ruled 2026-09-08)" before touching this
function) → **class** (`_class_ok "$id" "$cand" || continue`, appended to the rungs
immediately after `_avail`). Placed there it filters BOTH brackets with one line, because
both brackets read the same loop's survivors; a filter placed inside either bracket would
cover one and not the other, and a filter placed before `_pool_ok` would answer a class
question about a lane #62 has already refused.

**The final shape is RE-MEASURED after Task 2's rebase**, never assumed: the quotes above
are `clear-meadow`'s tip, and #62's merge commit is what actually lands. Locate the chain
by its text (`_avail "$cand" || continue` inside `_swap_target`), never by these numbers,
and if the merge landed a different rung order, keep every existing rung and put
`_class_ok` last. Task 7 Step 1's structural case is what proves you did: it slices
`_swap_target`'s body and asserts that *every* line equal to `_avail "$cand" || continue`
is followed by the guard, with a coverage floor of one — so a future `_swap_target` with a
second candidate loop reds instead of being half-covered.

**A-9 — `server/test/ccd-default-pool.test.ts` is cited, never extended.** (owned by Plan 2)
The brief asked Plan 2 to extend that file. It creates
`server/test/ccd-class-rotation.test.ts` instead and copies that file's harness usage
verbatim — the `writeLimits` / `writeWeeklyOnly` / `install` / `disable` helpers and the
`DEFAULT_TEST_ROSTER`-derived `HOME_ABLE` string. The reason that survives A-7's
withdrawal: the class filter is a different guard from the default-pool one, so a separate
file keeps each file's mutation header honest about which guard its cases stand behind.
`DEFAULT_TEST_ROSTER`'s `gpt` is non-home-able and `makeCcdHarness` deliberately does not
install it, so every case that needs the lane calls `install('gpt')`, exactly as that file
does.

**A-10 — ccd computes no derived state from the catalogue for ROUTING.** (owned by Plan 2)
The skeleton's original "ccd registry (Plan 2)" section had `_lane_classes` compute
retirement itself, by reading `~/.ccrc/models/<wrapper>.json` with jq. Round-2 item 6
moves that computation to the materialiser and ships the answer as the tsv's third column,
so **`_model_retired` is not written at all** and availability needs no JSON reader. The
one place ccd still opens the catalogue is `_lane_unclassified_count`, whose only consumer
is a `ccd ls` display string that nothing routes on — and which answers EMPTY, never `0`,
when it cannot know.

## Gating and ordering (BINDING — skeleton "Rulings received…" item 1 and "Rulings round 2" item 8)

From `ccrc-pwa-amber-summit` (account-pools coordinator, mail 275, 2026-09-08), and
carried in the spec at §7 and §14:

1. **Plan 2 is gated on account-pools PR #62 being MERGED AND DEPLOYED.** Its Task 1 is
   a measured gate (`gh -R Synapsium-Labs/ccrc-pwa pr view 62 --json state,mergeCommit`
   reads `MERGED`; `~/.local/bin/ccd version` on the fleet host carries that merge sha —
   a read-only check). Until then Plan 2 does not start, and **nothing may edit
   `_swap_target`, `cmd_swap`, `cmd_start`, `cmd_enable`, `cmd_prefer` or `cmd_ensure`**.
   Plan 2's Task 2 rebases `feat/model-class-registry-impl` onto that merge sha
   (`git rebase <sha>`; conflicts resolved in favour of #62's structure).
2. **The per-session `class` registry field is DECLARED in wave 2b's registry field
   inventory** before any write site exists. **Located and measured 2026-09-08 on
   `ws/clear-meadow`** (READ ONLY), which is what PR #62 merges:
   - the inventory itself is `_reg_purge`'s dot-free inventory comment,
     **`<worktree>/clear-meadow/ccd/ccd:1619-1634`**, opening
     ``  # The dot-free claim, measured against every registry file a session has`` and
     listing today's thirty-one fields — `` `archived` `` through `` `wrapper` `` — with
     wave 2b's own three (`` `crosspool` ``, `` `stranded` ``, `` `strandnotify` ``)
     already in it;
   - its mechanism is
     **`<worktree>/clear-meadow/server/test/ccd-auto-swap-pool.test.ts:659-675`**,
     ``describe('_reg_purge`s dot-free inventory', …)`` → ``it('names the three per-id
     fields this build adds', …)``, which does
     ``src.indexOf('The dot-free claim, measured against every registry file')``, slices
     1400 characters, and asserts each of
     ``['`crosspool`', '`stranded`', '`strandnotify`']`` appears;
   - the task that produced both is that wave's plan,
     **`<worktree>/clear-meadow/docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md:1880`**,
     "Task 7: the registry field inventory, and the hold rung measured in place".

   Plan 2's Task 2 adds `` `class` `` to **both** — the comment and that test's list —
   following Task 7 as its template, one field instead of three.
3. **The `class` field is read by a dedicated `_reg_read_class <id>`, never by
   `_reg_get`'s fold.** `_reg_get` is `cat "$REG/$1.$2" 2>/dev/null` (`origin/main:ccd/ccd:1538`) and
   folds absent, unreadable and empty into one empty string. `_reg_read_class`
   distinguishes: absent → `""` (no class recorded); readable → the value, validated
   ∈ `CCD_CLASSES`; present-but-unreadable, or present with a value that is not one of
   the four → **refuse the operation** with the path in the message. Routing never acts
   on a fold. Plan 2's Task 4 defines it and Tasks 6, 7 and 9 are its only callers.
4. **Null and retired stay distinct.** A retired id never empties a class slot; `retired`
   is a positive derived list and `available` is what routing consumes. No plan writes
   code that nulls a slot on retirement.

5. **The class filter is written INTO `_swap_target`'s composed chain as its THIRD
   predicate** (skeleton "Rulings round 2" item 8), never as a standalone skip: #61's
   overflow bracket → #62's pool predicate → class. The chain as it stands on
   `ws/clear-meadow`'s tip is quoted in deviation **A-8** above, which also records that
   its final shape is re-measured after Task 2's rebase. The wave-2b plan's crossing
   section ("The composed rule: an untagged overflow lane is in every pool", ruled
   2026-09-08) is required reading before Task 7 — it is where the state neither #61 nor
   #62 produces alone is documented, and it is why `_pool_ok` stays a hard `continue`
   ahead of all bracketing.

**Plans 1, 3a and 3b are NOT gated on #62** — none touches ccd's swap/spawn path (spec
§14). Plan 1 is cut from `origin/main` and is gated on nothing; Plan 3a may still need to
sequence behind account-pools **wave 3** if that wave touches `server/src/limits.ts` or
the `/api/accounts` assembly, and Plan 3b is gated on account-pools **wave 4**'s merge sha
with a measured gate task of its own, exactly like this plan's Task 1.

---

## Global Constraints

Copied from the spec and from the skeleton's Conventions; every task's requirements implicitly include this section.

1. **The four classes are `haiku sonnet opus fable`, in that order** (`export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const` — in **`shared/models.ts`**, where skeleton "Rulings round 2" item 2 moves it from the withdrawn roster block). Every list this plan prints, every file it walks, and every agreement assertion uses that order.
2. **Aliases only, never a concrete id, on any command line.** Spec §7: "`_spawn_start` appends `--model <class>` … Aliases only — the destination's env block resolves them." A concrete model id must never reach a `--model` flag from ccd.
3. **`null` means the class is unavailable on that lane, never "use a default"** (spec §4.1). In `<account>.classes.tsv` that `null` is the **state word `unassigned` in column 3**, and the empty `modelId` in column 2 is its consequence, not its marker.
4. **Availability comes from column 3 and is never inferred** (skeleton "Rulings round 2" item 6; spec §6.1's "every reader that does branch … takes availability from its own positive marker … never from an env value"). `state ∈ assigned | unassigned | retired`; **exactly `assigned` is routable**. ccd computes neither retirement nor availability — `classesTsv(registry, catalogue)` did that in Plan 1 — and ccd reads the catalogue for one display-only count and nothing else.
5. **Retired = a classed id absent from a catalogue that EXISTS and is NOT stale** (spec §4.3), computed by the materialiser and delivered as the state word `retired` — with the model id STILL IN COLUMN 2, because a retired class id empties nothing. A retired class counts as **unavailable for routing**, and the roster is never edited to fix it.
5b. **The catalogue file's discriminator is `probe`, not `provider`** (Plan 1 deviation B-2, skeleton "Rulings round 2" item 10). `~/.ccrc/models/<accountId>.json` is `Catalogue = { probe: ProbeKind; fetchedAt; stale; lastError?; models }` with `probe ∈ codex | openrouter | compatible`; spec §4.2's `"provider": "openai"` example is a spelling that belongs to the account-connections branch and is not on `main`. Every catalogue fixture in this plan writes `probe: 'codex'`. ccd itself opens that file only for `_lane_unclassified_count`, and reads `.models[].id`, never the discriminator.
6. **The sentinel (`ccrc-unavailable-<class>`, §6.1) lives in the settings `env` block and nowhere else.** It is a SINK value, forwarded by Claude Code and branched on by nobody. No line of shell in `ccd/ccd` may name it; the Definition of done greps for exactly that.
7. **Unknown carries nothing.** Spec §7: "Unknown → `""` (carry nothing, today's behaviour)." An empty or unrecognised class must never block a swap, strand a rescue, or add a flag.
8. **Never silently downgrade.** Spec §15 decision 2: "skip the lane (never silently downgrade)". A manual swap that would change the class refuses unless the operator passed `--as-class`.
9. **Fixture HOMEs only.** Never run ccd, ccrc, systemctl, deploy.sh or a probe against the real `$HOME`; never touch the live `~/.ccrc` or `~/.cc-sessions`.
10. **TDD, red first, with a measured mutation check per guard.** Each guard's test is shown failing before the code exists, and each task carries a mutation step (flip the guard with an exact `sed -i`, run the exact command, see the exact failure, restore with the exact reverse `sed -i`). Idiom copied from `server/test/ccd-default-pool.test.ts` (2026-09-07), which is in this branch's tree from the first commit because the branch is cut from `origin/main` (deviation A-7) — its header states each mutation and the measured count of cases it reds.
11. **Re-stamp `ccd/ccd` after ANY edit to it**, from the repository root:
   ```bash
   node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
   ```
   then run `server/test/ownership.test.ts`. `ccd/statusline-command.sh` carries **no** marker (`sed -n 2p ccd/statusline-command.sh` prints `# ~/.claude/statusline-command.sh`, a path comment) — do not stamp it.
   A mutation step's `sed -i` invalidates the marker for as long as the mutation stands; that is expected, and the reverse `sed -i` restores the exact bytes and with them the marker. Do not run `ownership.test.ts` while a mutation is in place.
12. **`_spawn_start` must never grow a `return <non-zero>`** — `server/test/ccd-arith-containment.test.ts` ("`_spawn_start`'s only failure mode is die") pins that every `|| return $?` caller's `_reg_claim` stays reachable.
13. **No `_reg_del` / `_reg_unset`.** `server/test/ccd-reg-claim.test.ts:54` asserts `ccd` matches neither name. The `class` field is written, never cleared.
14. **No arithmetic on a registry- or file-sourced value** without a `=~ ^[0-9]+$` guard first inside the same `[[ ]]` (`server/test/ccd-arith-containment.test.ts`). Nothing in this plan needs arithmetic; the one count it prints is compared as a string.
15. **Commits:** `type(scope): one sentence in the tree's voice`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task; name the files, never `git add -A`.
16. **Comment discipline:** comments state measured facts and the WHY.
17. **This plan document is already on the branch.** Plan 1 Task 17 commits all four plans plus the spec into `docs/superpowers/plans/` and `docs/superpowers/specs/` of the implementation worktree, so a reviewer of this plan's PR reads the plan the diff argues from rather than a path in another session's scratchpad. If this file is revised while executing it, re-copy it from `<S>/mcr/docs/superpowers/plans/` and include it in this plan's LAST commit — never in a commit that also carries code.

---

## File Structure

| File | Created / Modified | Responsibility |
|---|---|---|
| `server/test/ccd-auto-swap-pool.test.ts` | Modify | Task 2: wave 2b's registry field inventory names `class` before anything writes it. |
| `ccd/statusline-command.sh` | Modify | Publish `~/.cc-sessions/model/<session_id>` — one line, the concrete `model.id`, atomic, change-only. The only writer. |
| `ccd/ccd` | Modify | Task 2: `class` in `_reg_purge`'s dot-free inventory. Then the whole read side: two path constants, the class predicates, `_reg_read_class`, the tsv readers, the spawn flag, the rotation filter (third predicate of `_swap_target`'s chain), the swap gate, the `ccd ls` lane line, the `class` registry field. |
| `server/test/statusline-script.test.ts` | Modify | The statusline's new side-effect: content, atomicity, change-only, the separator refusal, the absent-field case. |
| `server/test/ccd-session-class.test.ts` | Create | `_family_class_of`, `_session_model_id`, `_session_class`. |
| `server/test/ccd-lane-classes.test.ts` | Create | `_lane_classes`, `_class_available` over three-column tsv fixtures, and `_lane_unclassified_count` over catalogue fixtures. |
| `server/test/ccd-spawn-model-flag.test.ts` | Create | `--model '<class>'` present in both spawn lines iff the class is carried AND available. |
| `server/test/ccd-spawn-split.test.ts` | Modify | Its byte-exact `expectedCommand` gains the model slot (four existing cases depend on it). |
| `server/test/ccd-class-rotation.test.ts` | Create | `_class_ok`, `_swap_target`'s candidate filter and home-recovered branch, `_auto_swap_check`'s re-check, and the structural pin that survives a rebase. |
| `server/test/ccd-class-record.test.ts` | Create | `_record_class`, and that `cmd_swap` / `cmd_ensure` / `cmd_stop` each call it. |
| `server/test/ccd-swap-as-class.test.ts` | Create | The refusal sentence, `--as-class`, its validation, and the detached re-entry carrying the flag. |
| `server/test/ccd-ls-lane-classes.test.ts` | Create | `_lane_class_note` and the `ccd ls` lane line. |
| `server/test/ccd-models-agreement.test.ts` | Create | ccd's bash reader and `shared/models.ts`'s `availableFor` / `familyClassOf` / `classOfModel` answer identically over one fixture set, with the tsv written by the real `classesTsv(registry, catalogue)`. |
| `server/test/single-definition.test.ts` | Modify | Register ccd as the second reader: one spelling per tool of each generated path, and the agreement test named by path. Task 12 widens the `.ccrc/models` holder list with `ccd/ccrc-doctor-checks`. |
| `agent/test/whitelist.test.ts` | Modify | `--as-class` rides the existing `['swap']` prefix grant; no new grant. |
| `ccd/ccrc-doctor-checks` | Modify | Task 12 (moved from Plan 3a, mail 286): `models` in `CCRC_DOCTOR_CHECKS` directly after `pools`, and `_check_models` — a fresh catalogue, no retired class id, an env block that matches the registry, and an orphaned registry file with no roster row (spec §11, mail 284). |
| `server/test/ccrc-doctor.test.ts` | Modify | Task 12: the `describe('ccrc doctor: models', …)` — twelve cases — plus the widened `RosterEntry` (`telemetry`) and bumped `HEALTHY_SKIPS`. |

**Not touched by this plan, deliberately:** `deploy/deploy.sh` and `agent/test/deploy-verify.test.ts` (this plan ships no new file — `ccd/ccd` and `ccd/statusline-command.sh` are already installed by the agent lane, `deploy/deploy.sh:649` `install_atomic ccd/statusline-command.sh .claude/statusline-command.sh 755`, pinned at `agent/test/deploy-verify.test.ts:595`); `agent/src/whitelist.ts` (the `['swap']` prefix at `agent/src/whitelist.ts:323` already permits every token after it, and `swap` is not in `REQUIRED_VERB_FLAG` at `agent/src/whitelist.ts:240-242`); the whole PWA and every server route (Plans 3a and 3b); `ccd/ccrc` (Plan 1, which owns the whole `ccrc models` verb group); `shared/roster.ts`, `shared/roster-json.mjs`, `deploy/account-op.mjs` and `cmd_account` (the account-connections branch's, not on `main`, and forbidden to every plan in this program by ruling 280).

---

### Task 1: the measured gate — PR #62 is merged AND deployed

**Files:**
- Modify: none. This task writes no code. It is the binding ruling from mail 275
  (skeleton, "Rulings received after the writers started"; spec §14) turned into two
  commands whose output is the evidence.

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded merge sha, `$MERGE_SHA`, that Task 2 rebases onto. Nothing in
  Tasks 2-12 may run until every checkbox here is ticked.

**Why a whole task.** Until #62 is merged and on the boxes, every one of this plan's
write sites is a file another wave is actively editing: `_swap_target`, `cmd_swap`,
`cmd_start`, `cmd_enable`, `cmd_prefer` and `cmd_ensure` all belong to account-pools
wave 2b, and the per-session registry field this plan adds has to be declared in that
wave's own inventory (Task 2) rather than at its first write site. A plan that starts
early does not merely conflict — it lands a registry field no inventory names, on a
function whose shape is about to change under it.

---

- [ ] **Step 1: Measure the PR's state**

Run, from anywhere:
```bash
gh -R Synapsium-Labs/ccrc-pwa pr view 62 --json number,state,mergeCommit,headRefName
```
Expected: `"state":"MERGED"` and a non-null `"mergeCommit":{"oid":"<sha>"}`.

Measured 2026-09-08 while this plan was written: `{"headRefName":"ws/clear-meadow","mergeCommit":null,"number":62,"state":"OPEN"}`
— i.e. **the gate was shut**. If it is still `OPEN`, STOP: report the gate as shut and
do nothing else in this plan. Plans 1 and 3 are not gated and can proceed meanwhile
(spec §14).

Record the sha:
```bash
MERGE_SHA=$(gh -R Synapsium-Labs/ccrc-pwa pr view 62 --json mergeCommit -q .mergeCommit.oid)
[ -n "$MERGE_SHA" ] || { echo "GATE SHUT: PR #62 is not merged"; exit 1; }
echo "MERGE_SHA=$MERGE_SHA"
```

- [ ] **Step 2: Measure that the merge is DEPLOYED on the fleet host**

The ruling is "merged AND deployed": this plan's `ccd/ccd` edits sit on top of #62's
`_swap_target`, and a box still running the pre-#62 copy would answer a swap with the
old shape while the tree describes the new one.

Run, READ-ONLY, from anywhere:
```bash
~/.local/bin/ccd version
```
Expected: a build line whose sha is `$MERGE_SHA` or a descendant of it. Confirm the
descendant case in the repository, without checking anything out:
```bash
git -C "$(git rev-parse --show-toplevel)" fetch origin main
git -C "$(git rev-parse --show-toplevel)" merge-base --is-ancestor "$MERGE_SHA" <the sha ccd version printed> && echo DEPLOYED
```
Expected: `DEPLOYED`. If it prints nothing, the boxes are behind the merge: STOP and
report that, exactly as for a shut gate. **Do not run `deploy/deploy.sh`** — deploying
is not this plan's to do (Global Constraint 7).

- [ ] **Step 3: Record the gate in the branch, so a reader of the history can see it was measured**

```bash
git commit --allow-empty -m "chore(models): gate measured — account-pools PR #62 merged at $MERGE_SHA and deployed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: rebase onto #62, and declare `class` in wave 2b's registry field inventory

**Files:**
- Modify: `ccd/ccd` — `_reg_purge`'s dot-free inventory comment. **Measured
  2026-09-08 at `ccd/ccd:1619-1634` on `ws/clear-meadow`'s tip `9e9ebd1c`**, which is what
  #62 merges; locate it after the rebase by its first line, `The dot-free claim, measured
  against every registry file`, never by that number.
- Test: `server/test/ccd-auto-swap-pool.test.ts:659-675` (measured on the same tip) — the
  ``describe('_reg_purge`s dot-free inventory', …)`` / ``it('names the three per-id fields
  this build adds', …)`` pair, which slices 1400 characters from that string and asserts
  each field name appears

**Idioms copied (read these before writing):**
- The inventory task itself: account-pools wave 2b's plan,
  `<worktree>/clear-meadow/docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md:1880`
  (READ ONLY), "Task 7: the registry field inventory, and the hold rung measured in
  place" — the template this task follows, one field instead of three. Its Step 3 shows
  the comment before and after; its Step 5 re-runs `ccd-auto-swap-hold.test.ts` unedited
  as the standing proof that the hold rung did not move, and this task does the same.
- That wave's crossing section, "The composed rule: an untagged overflow lane is in every
  pool (ruled 2026-09-08)" (same file, above its wave map). Read it now, not at Task 7:
  it is the state neither #61 nor #62 produces alone, it is why `_pool_ok` is a hard
  `continue` ahead of all bracketing, and Task 7's class filter is composed onto exactly
  that chain.
- `server/test/ccd-auto-swap-pool.test.ts`'s existing case, which reads
  `src.indexOf('The dot-free claim, measured against every registry file')` and then
  `src.slice(from, from + 1400)`.

**Interfaces:**
- Consumes: Task 1's `$MERGE_SHA`.
- Produces: a branch whose `ccd/ccd` is #62's shape — `_swap_target`'s three-rung
  eligibility chain (`_pool_ok` → `_account_ok` → `_avail`) feeding ONE
  `best`/`obest` bracket split (A-8), a roster-wide `_default_pool`, and
  `server/test/ccd-auto-swap-pool.test.ts` carrying the inventory case. And an inventory
  that names `class` **before Task 8 writes the field for the first time**.
  `server/test/ccd-default-pool.test.ts` is already in the tree before the rebase, since
  the branch is cut from `origin/main` (A-7).

---

- [ ] **Step 1: Rebase the implementation branch onto the merge commit**

From the repository root:
```bash
git fetch origin main
git rebase "$MERGE_SHA"
```
Expected: `Successfully rebased and updated refs/heads/feat/model-class-registry-impl.`

**Resolve every conflict in favour of #62's structure** (the ruling's own words): keep
#62's `_swap_target`, `_default_pool`, `cmd_swap` and registry shape, and re-apply
Plan 1's additions on top of them.

Where a conflict is EXPECTED, and where one is a finding:
- `ccd/ccrc`, `server/test/single-definition.test.ts`, `deploy/deploy.sh` and
  `agent/test/deploy-verify.test.ts` — expected: Plan 1 adds the `ccrc models` verb group,
  its probe and its timer, and #62 edits the same files' neighbourhoods.
- `ccd/ccd` — **not expected**: Plan 1 does not edit it at all (its own File Structure
  says so; ccd's read side is entirely this plan's). A conflict *inside* `ccd/ccd` means
  something came in with the rebase that neither plan describes — read it before resolving
  it, and do not resolve it by taking either side wholesale.
- `shared/roster.ts`, `shared/roster-json.mjs`, `deploy/account-op.mjs` — **impossible**
  under ruling 280: no plan in this program touches them. A conflict there means the
  branch is not the one this plan describes; stop and report it.

- [ ] **Step 2: Re-stamp `ccd/ccd` and prove the tree is green after the rebase**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run
```
Expected: PASS, whole suite — Plan 1's files and #62's together. A red here is a rebase
resolution to fix, never a test to edit.

- [ ] **Step 2b: Re-measure `_swap_target`'s composed chain, which A-8's quotes describe**

The rebase is the moment A-8's "re-measured after rebase" clause comes due. Run, from the
repository root:
```bash
awk '/^_swap_target\(\)/,/^}/' ccd/ccd | grep -n '|| continue\|_is_home_able "\$cand"\|for cand in'
```
Expected: the loop opener, then the three eligibility rungs in order — `_pool_ok "$cand"
"$pps" || continue`, `_account_ok "$cand" || continue`, `_avail "$cand" || continue` —
then `if _is_home_able "$cand"; then`, the bracket split. **Write down what it actually
printed**; Task 7 appends `_class_ok "$id" "$cand" || continue` after the LAST rung, and
Task 7 Step 1's structural case pins that placement whatever the numbers turned out to be.
If the printed order differs from A-8's quote, keep every rung the merge landed and still
put `_class_ok` last — the ruling fixes the class filter's POSITION IN THE CHAIN (third,
after #62's pool predicate), not any line number.

- [ ] **Step 3: Write the failing inventory test**

In `server/test/ccd-auto-swap-pool.test.ts`, in the dot-free-inventory `describe` #62
added, add `` '`class`' `` to the list the existing case walks:

```ts
    for (const f of ['`class`', '`crosspool`', '`stranded`', '`strandnotify`']) {
      expect(block, `${f} is written by this build and missing from the inventory`).toContain(f);
    }
```

- [ ] **Step 4: Run it to verify it fails**

Run, from `server/`:
```bash
npx vitest run test/ccd-auto-swap-pool.test.ts -t 'dot-free inventory'
```
Expected: FAIL —
```
AssertionError: `class` is written by this build and missing from the inventory
expected '  # The dot-free claim, measured against every registry file…' to contain '`class`'
```

- [ ] **Step 5: Declare the field in the inventory comment**

In `ccd/ccd`, inside `_reg_purge`'s dot-free inventory comment, insert `` `class`, ``
into the alphabetical list — between `` `branch`, `` and `` `crosspool`, ``. The comment
reads, at `ws/clear-meadow`'s tip (`ccd/ccd:1619-1627`, measured 2026-09-08):

```bash
  # The dot-free claim, measured against every registry file a session has
  # today: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
  # `pool`, `prcheckedat`, `prhistory`, `prnumber`, `prphase`, `project`, `rc`,
  # `reaping`, `setup`, `spawn`, `started`, `stopped`, `stranded`,
  # `strandnotify`, `substrate`, `supervised`, `swapblocked`, `uuid`,
  # `workdir`, `workspace`, `wrapper`. Note that `pool` here is the per-session
  # CANDIDATE LIST `_pool_for` reads, NOT an account pool name — two meanings
  # of one word in one file, disclosed rather than renamed. That is a WIDER
```

Rewrap it to:

```bash
  # The dot-free claim, measured against every registry file a session has
  # today: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `class`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`,
  # `lastswap`, `pool`, `prcheckedat`, `prhistory`, `prnumber`, `prphase`,
  # `project`, `rc`, `reaping`, `setup`, `spawn`, `started`, `stopped`,
  # `stranded`, `strandnotify`, `substrate`, `supervised`, `swapblocked`,
  # `uuid`, `workdir`, `workspace`, `wrapper`. Note that `pool` here is the
  # per-session CANDIDATE LIST `_pool_for` reads, NOT an account pool name —
  # two meanings of one word in one file, disclosed rather than renamed. That
  # is a WIDER
```

Every word after `wrapper`. is wave 2b's and is carried through unchanged — only the
wrapping moves, because one field name was inserted into a filled paragraph.

`class` ∈ `haiku|sonnet|opus|fable` and is one dot after the id, so it purges with the
row and needs no lifecycle-manifest entry of its own — which is exactly the claim this
comment is the only place to make. It is declared HERE, three tasks before Task 8 first
writes it, because an inventory that is updated at the write site is one a future reader
trusts and a future writer copies (wave 2b's own words).

- [ ] **Step 6: Re-stamp and run it to verify it passes**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-auto-swap-pool.test.ts test/ownership.test.ts
```
Expected: PASS — both files.

- [ ] **Step 7: Mutation check — the inventory is load-bearing**

Break it, from the repository root:
```bash
sed -i 's/^  # `class`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`,$/  # `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`,/' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-auto-swap-pool.test.ts -t 'dot-free inventory'
```
Expected: FAIL — ``AssertionError: `class` is written by this build and missing from the inventory``.

Restore, from the repository root:
```bash
sed -i 's/^  # `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`,$/  # `class`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`,/' ccd/ccd
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`: `npx vitest run test/ccd-auto-swap-pool.test.ts test/ownership.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-auto-swap-pool.test.ts
git commit -m "docs(ccd): the registry field inventory names \`class\`, before anything writes it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: the statusline publishes each session's concrete model id

**Files:**
- Modify: `ccd/statusline-command.sh` — insert one block between the rate-limits side-effect (its `mv -f` at `origin/main`'s line 251) and the `# ── Assemble single-line output ───` header (line 254). Both measured on `origin/main` 2026-09-08; locate them by their text.
- Test: `server/test/statusline-script.test.ts` — widen `run()` and add one `describe`

**Idioms copied (read these before writing):**
- The atomic-write idiom: `ccd/statusline-command.sh:250-251` — `printf … > "$HOME/.cc-limits/.$acct_id.tmp" && mv -f "$HOME/.cc-limits/.$acct_id.tmp" "$HOME/.cc-limits/$acct_id.json"`. Temp file beside the destination, dot-prefixed, `mv -f`. This block copies it exactly.
- The jq extraction idiom: `ccd/statusline-command.sh:133` — `model=$(printf '%s' "$input" | jq -r '.model.display_name // empty' 2>/dev/null)`. `// empty` so an absent field is an empty string, `2>/dev/null` so a malformed payload costs a segment and not the status bar.
- The test harness: `server/test/statusline-script.test.ts:68-77` (`run()`), `:86` (`seed()`), `:42` (`ROSTER`) — measured on `origin/main`.

**Interfaces:**
- Consumes: nothing from another task.
- Produces: the file `~/.cc-sessions/model/<claudeSessionUuid>` — **one line, the concrete `model.id`, trailing newline**, written atomically, rewritten only when the value changes. Task 4's `_session_model_id` is its only reader.

---

- [ ] **Step 1: Widen the test harness's `run()` so a case can supply its own payload**

`server/test/statusline-script.test.ts` currently spawns the script with one module-scope `PAYLOAD`. Replace the whole of `function run` (`origin/main` lines 68-77, docstring included) with:

```ts
/** Runs the real script with `HOME` relocated — the single isolation boundary
 *  the whole ccd suite relies on. `cfgDir` becomes `CLAUDE_CONFIG_DIR`;
 *  `undefined` leaves it unset, which is how the upstream account runs.
 *
 *  `payload` defaults to the module-scope `PAYLOAD` every pre-existing case
 *  uses, so widening it changes no existing answer. The §7 cases below need
 *  fields `PAYLOAD` deliberately does not carry — `session_id` and
 *  `model.id` — and a second spawn helper would be a second place for the
 *  environment scrubbing above to drift. */
function run(home: string, cfgDir?: string, payload: string = PAYLOAD): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env['CLAUDE_CONFIG_DIR'];
  if (cfgDir !== undefined) env['CLAUDE_CONFIG_DIR'] = cfgDir;
  const r = spawnSync('bash', [SCRIPT], { input: payload, encoding: 'utf8', env });
  return { out: r.stdout ?? '', code: r.status ?? -1 };
}
```

Then widen the node:fs import at the top of the file — replace

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
```

with

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Write the failing tests**

Append to `server/test/statusline-script.test.ts`:

```ts
// ── spec §7, "Recording": the one place on the box that sees Claude Code's
// own session uuid and the CONCRETE model id in the same payload.
//
// The status bar above prints `.model.display_name` — a LABEL ("Opus 5") no
// client accepts as `--model`. `.model.id` is the id the request actually
// used, and `.session_id` is the uuid ccd's registry already stores per
// session, so this hook can say "session <uuid> is running <id>" without
// asking any provider. `ccd` reads it to carry the CLASS across a swap.

/** The two fields §7 depends on and the shipped `PAYLOAD` deliberately omits. */
const modelPayload = (sessionId: string, modelId: string): string => JSON.stringify({
  session_id: sessionId,
  model: { display_name: 'Opus 5', id: modelId },
  workspace: { current_dir: '/nonexistent-for-this-test' },
});

const SID = 'aaaaaaaa-0000-4000-8000-000000000001';

const modelDir = (home: string): string => path.join(home, '.cc-sessions', 'model');
const modelFile = (home: string, sid: string): string | null => {
  const p = path.join(modelDir(home), sid);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

describe('statusline-command.sh publishes the session model id for ccd (spec §7)', () => {
  it('writes ~/.cc-sessions/model/<session_id> holding the concrete id and nothing else', () => {
    const home = seed('ccrc-statusline-model-');
    const r = run(home, path.join(home, '.zeta'), modelPayload(SID, 'claude-fable-5-1'));
    expect(r.code).toBe(0);
    // One line, the id, trailing newline — the shape `_session_model_id`
    // reads with a single `read -r`. Not the display name: "Opus 5" is not a
    // thing any client can be started with.
    expect(modelFile(home, SID)).toBe('claude-fable-5-1\n');
  });

  it('leaves no temp file behind — the write is tmp + mv -f, like the limits row', () => {
    const home = seed('ccrc-statusline-model-atomic-');
    run(home, path.join(home, '.zeta'), modelPayload(SID, 'gpt-5.6-sol'));
    // ccd reads this file from another process; a half-written line reads as
    // a model id that does not exist. The directory holding exactly one entry
    // is what says the rename happened rather than a plain redirect.
    expect(readdirSync(modelDir(home))).toEqual([SID]);
  });

  it('rewrites the file when the model changes, and leaves it untouched when it does not', () => {
    const home = seed('ccrc-statusline-model-change-');
    run(home, path.join(home, '.zeta'), modelPayload(SID, 'claude-opus-5-20260101'));
    const p = path.join(modelDir(home), SID);
    expect(statSync(p).mtimeMs).toBeGreaterThan(0);
    // The clock is forced to the epoch so "unchanged" cannot pass by being
    // fast: this hook runs on EVERY render of EVERY session's status bar, so
    // an unconditional write is one rename per render per session forever.
    utimesSync(p, new Date(0), new Date(0));
    run(home, path.join(home, '.zeta'), modelPayload(SID, 'claude-opus-5-20260101'));
    expect(statSync(p).mtimeMs).toBe(0);
    run(home, path.join(home, '.zeta'), modelPayload(SID, 'claude-fable-5-1'));
    expect(statSync(p).mtimeMs).toBeGreaterThan(0);
    expect(readFileSync(p, 'utf8')).toBe('claude-fable-5-1\n');
  });

  it('refuses a session_id carrying a path separator — the name is a NAME, not a path', () => {
    const home = seed('ccrc-statusline-model-traversal-');
    // `session_id` arrives as JSON from a process this script does not own,
    // and the value becomes a file name in a directory ccd reads. A value
    // holding `/` would put the write outside that directory entirely.
    const r = run(home, path.join(home, '.zeta'), modelPayload('../../PWNED', 'claude-opus-5-20260101'));
    expect(r.code).toBe(0);
    expect(existsSync(path.join(home, 'PWNED'))).toBe(false);
    expect(existsSync(modelDir(home))).toBe(false);
  });

  it('writes nothing at all when the payload carries no model id', () => {
    const home = seed('ccrc-statusline-model-absent-');
    const r = run(home, path.join(home, '.zeta'),
      JSON.stringify({ session_id: SID, model: { display_name: 'Opus 5' } }));
    expect(r.code).toBe(0);
    // Absent is a distinct state from "some model": a directory created for a
    // session whose id was never known would be a file ccd could not attribute.
    expect(existsSync(modelDir(home))).toBe(false);
  });

  it('writes nothing when the payload carries no session id', () => {
    const home = seed('ccrc-statusline-model-nosid-');
    const r = run(home, path.join(home, '.zeta'),
      JSON.stringify({ model: { display_name: 'Opus 5', id: 'claude-opus-5-20260101' } }));
    expect(r.code).toBe(0);
    expect(existsSync(modelDir(home))).toBe(false);
  });

  it('still prints the status bar it always printed', () => {
    // The side-effect must not be able to cost the operator their status bar:
    // this hook's whole history (see the file header) is a silence that only
    // showed up somewhere else.
    const home = seed('ccrc-statusline-model-bar-');
    const out = plain(run(home, path.join(home, '.zeta'), modelPayload(SID, 'claude-fable-5-1')).out);
    expect(out).toContain('🤖 Opus 5');
    expect(out).toContain('zeta·one');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run, from `server/`:
```bash
npx vitest run test/statusline-script.test.ts
```
Expected: the six new `spec §7` cases FAIL (the seventh, "still prints the status bar it always printed", passes already — it is the negative control). The first reads:
```
AssertionError: expected null to be 'claude-fable-5-1\n'
```
because nothing writes the file yet. Every pre-existing case in the file still passes.

- [ ] **Step 4: Write the implementation**

In `ccd/statusline-command.sh`, insert the block below **between** the end of the limits side-effect and the `# ── Assemble single-line output` header — i.e. immediately after the line

```bash
    > "$HOME/.cc-limits/.$acct_id.tmp" && mv -f "$HOME/.cc-limits/.$acct_id.tmp" "$HOME/.cc-limits/$acct_id.json"
fi
```

and immediately before

```bash
# ── Assemble single-line output ───────────────────────────────────────────
```

The block:

```bash
# ── Side-effect: publish this session's CONCRETE model id for ccd's class carry ──
#    Spec §7 ("Recording"). Section 1 above prints `.model.display_name`, which
#    is a LABEL — "Opus 5" — and not something any client accepts as `--model`.
#    The same payload carries `.model.id`, the id the request actually used,
#    and `.session_id`, Claude Code's own uuid, which is exactly the key ccd's
#    registry already stores per session (`_reg_get <id> uuid`). So this hook is
#    the one process on the box that can say "session <uuid> is running <id>"
#    without asking a provider, and `ccd`'s `_session_model_id` is the only
#    reader. Neither field was used here before 2026-09-08.
#
#    THE NAME IS A NAME, NOT A PATH. `session_id` arrives as JSON from a process
#    this script does not own, and it becomes a file name inside a directory
#    `ccd` reads. `${sid##*/}` strips everything up to the last slash, so a value
#    that survives that strip unchanged contains no separator at all — and the
#    directory is not even created for a value that fails it.
#
#    CHANGE-ONLY. This hook runs on EVERY render of EVERY session's status bar
#    (see the file header), so an unconditional write would be one rename per
#    render per session, forever, for a value that changes a handful of times a
#    day. `read -r` is the cheapest read that gets the first line.
#
#    ATOMIC, exactly as the limits row above and for the same reason: `ccd`
#    reads this from another process, and a half-written line reads as a model
#    id that does not exist.
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
mid=$(printf '%s' "$input" | jq -r '.model.id // empty' 2>/dev/null)
if [ -n "$sid" ] && [ -n "$mid" ] && [ "$sid" = "${sid##*/}" ]; then
  mdir="$HOME/.cc-sessions/model"
  prev=""
  [ -r "$mdir/$sid" ] && IFS= read -r prev < "$mdir/$sid"
  if [ "$prev" != "$mid" ]; then
    mkdir -p "$mdir"
    printf '%s\n' "$mid" > "$mdir/.$sid.tmp" && mv -f "$mdir/.$sid.tmp" "$mdir/$sid"
  fi
fi
```

- [ ] **Step 5: Run the tests to verify they pass**

Run, from `server/`:
```bash
npx vitest run test/statusline-script.test.ts
```
Expected: PASS — every case in the file, the seven new ones included.

- [ ] **Step 6: Mutation check — the path-separator guard**

Break it, from the repository root:
```bash
sed -i 's@if \[ -n "$sid" \] \&\& \[ -n "$mid" \] \&\& \[ "$sid" = "${sid##\*/}" \]; then@if [ -n "$sid" ] \&\& [ -n "$mid" ]; then@' ccd/statusline-command.sh
grep -c 'sid##\*/' ccd/statusline-command.sh
```
Expected: `1` — the guard's own explanation in the comment survives; the code line no longer holds it. Confirm with:
```bash
grep -n 'if \[ -n "$sid" \]' ccd/statusline-command.sh
```
Expected: one line, without the `${sid##*/}` comparison.

Run, from `server/`:
```bash
npx vitest run test/statusline-script.test.ts -t 'path separator'
```
Expected: FAIL —
```
AssertionError: expected true to be false
```
on `expect(existsSync(path.join(home, 'PWNED'))).toBe(false)`: with the guard gone the script writes `$HOME/.cc-sessions/model/../../PWNED`, i.e. `$HOME/PWNED`.

Restore, from the repository root:
```bash
sed -i 's@if \[ -n "$sid" \] \&\& \[ -n "$mid" \]; then@if [ -n "$sid" ] \&\& [ -n "$mid" ] \&\& [ "$sid" = "${sid##*/}" ]; then@' ccd/statusline-command.sh
```

Run, from `server/`:
```bash
npx vitest run test/statusline-script.test.ts -t 'path separator'
```
Expected: PASS.

- [ ] **Step 7: Mutation check — the change-only gate**

Break it, from the repository root:
```bash
sed -i 's@  if \[ "$prev" != "$mid" \]; then@  if true; then@' ccd/statusline-command.sh
```

Run, from `server/`:
```bash
npx vitest run test/statusline-script.test.ts -t 'rewrites the file when the model changes'
```
Expected: FAIL —
```
AssertionError: expected <a number greater than 0> to be +0
```
on `expect(statSync(p).mtimeMs).toBe(0)`: the second run with the SAME model id rewrote the file anyway.

Restore, from the repository root:
```bash
sed -i 's@  if true; then@  if [ "$prev" != "$mid" ]; then@' ccd/statusline-command.sh
```

Run, from `server/`:
```bash
npx vitest run test/statusline-script.test.ts
```
Expected: PASS, whole file.

- [ ] **Step 8: Commit**

From the repository root:
```bash
git add ccd/statusline-command.sh server/test/statusline-script.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the statusline publishes each session's concrete model id

Claude Code hands this hook `session_id` and `model.id` on every render and
neither was used; ccd needs both to carry a session's model CLASS across a
swap (spec §7). One file per uuid under ~/.cc-sessions/model, written the way
the limits row beside it is written — atomically, and only when the value
changes, because this runs on every render of every session's status bar.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: ccd derives a session's class from the id the statusline published

**Files:**
- Modify: `ccd/ccd` — one constants block (insert after the `CLAUDE_AI_BASE=…` line, `origin/main:830`, and before `mkdir -p "$REG"` at `:831`) and one helpers block (insert after `_reg_get`, `origin/main:1538`). Both re-located after Task 2's rebase by their text.
- Test: `server/test/ccd-session-class.test.ts` (create)

**Idioms copied (read these before writing):**
- Constant placement and the "derived from HOME with no env override" rule: `ccd/ccd:765-828` — `REG` (`:765`), `WRAPPER_DIR` (`:766`), `PROJECTS_ROOT` (`:771`), `GPT_DISABLE_FILE` (`:828`). Note that `GPT_DISABLE_FILE` spells `"$HOME/.cc-sessions/gpt-disabled"` in full even though `REG` exists two lines above: that is the spelling `single-definition.test.ts` scans for, and Task 11 depends on it.
- Roster membership predicates: `ccd/ccd:1305` `_is_valid_wrapper`, `ccd/ccd:1310` `_is_home_able` — a `for v in "${ARRAY[@]}"` loop returning 0/1, never echoing.
- Registry read: `ccd/ccd:1538` `_reg_get() { cat "$REG/$1.$2" 2>/dev/null; }`; the write side is `_reg_set` at `:1531`.
- Defence-in-depth on a field that becomes a path or an operand: the D-299 header at `server/test/ccd-arith-containment.test.ts:1-25` — "validate the bytes before they are used, not after", and the threat model is a torn or hand-edited registry field, not a wire caller.
- Harness: `server/test/ccdWsHelpers.ts:281` `makeCcdHarness`, `:345` `sh()` (which `.trim()`s and throws on non-zero), `:349` `reg()`.

**Interfaces:**
- Consumes: Task 3's `~/.cc-sessions/model/<uuid>` file; Plan 1's `~/.ccrc/models/<accountId>.classes.tsv` (four lines, CLASSES order, three tab-separated columns `class<TAB>modelId<TAB>state`, `state ∈ assigned | unassigned | retired` — `classesTsv(registry, catalogue)` in `shared/modelenv.mjs`).
- Produces, for Tasks 5-10:
  - `CCD_MODELS_DIR` — `"$HOME/.ccrc/models"`, the ONE spelling in `ccd/ccd`.
  - `CCD_SESSION_MODEL_DIR` — `"$HOME/.cc-sessions/model"`, the ONE spelling in `ccd/ccd`.
  - `CCD_CLASSES` — bash array `(haiku sonnet opus fable)`.
  - `_is_class <word>` → exit 0 iff the word is one of the four.
  - `_family_class_of <anthropicModelId>` → echoes `fable|opus|sonnet|haiku` or nothing; always exits 0.
  - `_session_model_id <ccdSessionId>` → echoes the concrete model id or nothing; always exits 0.
  - `_session_class <ccdSessionId>` → echoes one of the four classes or nothing; always exits 0.
  - `_reg_read_class <ccdSessionId>` → the MEASURED read of the registry `class` field
    (binding ruling, mail 275 item 3): absent → echoes nothing, exit 0; readable and one of
    the four → echoes it, exit 0; unreadable, or readable but not one of the four → echoes
    nothing, exit **1**, with the path on stderr. It is the ONLY reader of that field —
    `_reg_get "$id" class` must appear nowhere in `ccd/ccd`, and Task 11 pins that.

---

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-session-class.test.ts`:

```ts
// Spec §7, "Deriving the class". ccd maps its own session id -> the registry
// `uuid` -> the file `ccd/statusline-command.sh` publishes -> a concrete model
// id -> one of the four CLASSES. Two rules meet here and must not be confused:
//
//   - a HOME-ABLE account is an Anthropic one, where the four aliases resolve
//     to Anthropic's own ids, so the family token IN the id is the class and
//     there is no classes.tsv to consult at all (spec §4.1: an anthropic
//     account carries no `models` block);
//   - every other lane is an external backend whose classes are the
//     operator's assignment, read out of the materialised
//     `~/.ccrc/models/<account>.classes.tsv` (three columns; this function
//     matches on column 2 and does not care about column 3 — see the
//     implementation's own note on why).
//
// Unknown answers EMPTY on every path (spec §7: "Unknown -> '' (carry nothing,
// today's behaviour)"), because the alternative — guessing — is the silent
// downgrade this whole design exists to make impossible.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;
const sh = (s: string): string => h.sh(s);

const UUID = 'deadbeef-0000-4000-8000-000000000000';

/** `ccd/statusline-command.sh`'s own output shape: one line, the concrete id,
 *  trailing newline. Written by hand here rather than by running the hook, so
 *  this file states the format it depends on. */
const publishModel = (uuid: string, modelId: string): void => {
  const d = path.join(home, '.cc-sessions', 'model');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, uuid), `${modelId}\n`);
};

/** `classesTsv(registry, catalogue)`'s output shape (shared/modelenv.mjs, and
 *  skeleton "Rulings round 2" item 6): always four lines, in CLASSES order,
 *  THREE tab-separated columns `class<TAB>modelId<TAB>state`, with
 *  `state ∈ assigned | unassigned | retired`. Any class not named in `ids` is
 *  `unassigned` with an empty id; a class named in `retired` keeps its id and
 *  gets the `retired` word, because a retired id empties nothing (spec §4.3).
 *  Written by hand here rather than by calling `classesTsv`, so this file
 *  states the format it depends on; `ccd-models-agreement.test.ts` is where the
 *  real writer is fed to the real reader. */
const seedClasses = (
  account: string, ids: Record<string, string>, retired: readonly string[] = [],
): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`),
    `${['haiku', 'sonnet', 'opus', 'fable'].map((c) => {
      const id = ids[c] ?? '';
      // The THIRD column is the whole point: `unassigned` iff there is no id,
      // otherwise `retired` when the caller says the provider stopped listing
      // it, otherwise `assigned`. ccd branches on this word and on nothing
      // else — an id with no state word is not a state ccd can produce.
      const state = id === '' ? 'unassigned' : (retired.includes(c) ? 'retired' : 'assigned');
      return `${c}\t${id}\t${state}`;
    }).join('\n')}\n`);
};

/** The harness installs the roster's HOME-ABLE wrappers only; `gpt` is
 *  non-home-able in DEFAULT_TEST_ROSTER and deliberately absent, so a case
 *  that needs the lane installs it (ccd-default-pool.test.ts's idiom). */
const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-session-class-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_family_class_of: the Anthropic family token IS the class', () => {
  it('reads each of the four families out of a real id', () => {
    expect(sh("_family_class_of 'claude-haiku-4-5-20260101'")).toBe('haiku');
    expect(sh("_family_class_of 'claude-sonnet-5-20260101'")).toBe('sonnet');
    expect(sh("_family_class_of 'claude-opus-5-20260101'")).toBe('opus');
    expect(sh("_family_class_of 'claude-fable-5-1-20260101'")).toBe('fable');
  });

  it('answers empty for an id carrying no family token at all', () => {
    expect(sh("_family_class_of 'gpt-5.6-sol'")).toBe('');
    expect(sh("_family_class_of ''")).toBe('');
  });

  it('requires the token to be hyphen-delimited on both sides', () => {
    // `shared/models.ts`'s `familyClassOf` scans for '-fable-' | '-opus-' |
    // '-sonnet-' | '-haiku-' — TOKENS, not substrings. A vendor id that merely
    // ends in a family word is not an Anthropic model of that family, and
    // guessing one would put a session on a model nobody chose.
    expect(sh("_family_class_of 'some-model-opus'")).toBe('');
    expect(sh("_family_class_of 'opusculum-1'")).toBe('');
  });

  it('is exit-0 on every input — it is a lookup, not a decision', () => {
    // Every caller composes it (`$( )`) rather than branching on it. A
    // non-zero exit under `set -o pipefail` would turn "unknown" into a
    // failure the caller has to handle, which is the shape §7 rules out.
    expect(sh("_family_class_of 'nope'; echo rc=$?")).toBe('rc=0');
  });
});

describe('_session_model_id: the registry uuid names the file the statusline wrote', () => {
  it('returns the concrete id the statusline published', () => {
    sh(`_reg_set demo-a uuid ${UUID}`);
    publishModel(UUID, 'claude-fable-5-1');
    expect(sh('_session_model_id demo-a')).toBe('claude-fable-5-1');
  });

  it('answers empty when the session has never rendered a status bar', () => {
    sh(`_reg_set demo-a uuid ${UUID}`);
    expect(sh('_session_model_id demo-a')).toBe('');
  });

  it('answers empty for a row with no uuid at all', () => {
    expect(sh('_session_model_id demo-nothing')).toBe('');
  });

  it('refuses to build a path out of a torn uuid field', () => {
    // The field is ccd's own write, but this is the one function that turns it
    // into a PATH — the same defence-in-depth direction as D-299's arithmetic
    // guards, and the same threat model: a torn or hand-edited registry file,
    // not a wire caller. Without the regex guard the first line of any file
    // reachable from the models directory comes back as a "model id".
    fs.writeFileSync(path.join(home, 'secret'), 'TOPSECRET\n');
    sh("_reg_set demo-a uuid '../../secret'");
    expect(sh('_session_model_id demo-a')).toBe('');
  });

  it('reads only the first line of the file', () => {
    sh(`_reg_set demo-a uuid ${UUID}`);
    const d = path.join(home, '.cc-sessions', 'model');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, UUID), 'claude-opus-5-20260101\nclaude-haiku-4-5\n');
    expect(sh('_session_model_id demo-a')).toBe('claude-opus-5-20260101');
  });
});

describe('_session_class: the family token on an Anthropic lane, the tsv everywhere else', () => {
  it('reads the class off the id itself on a home-able account', () => {
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper claude-a`);
    publishModel(UUID, 'claude-fable-5-1');
    expect(sh('_session_class demo-a')).toBe('fable');
  });

  it('never consults a classes file for a home-able account', () => {
    // A home-able account is Anthropic's; §4.1 says an Anthropic lane never
    // has a registry file at all. If a stray tsv ever appeared it must not win
    // over the id.
    seedClasses('claude-a', { opus: 'claude-fable-5-1' });
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper claude-a`);
    publishModel(UUID, 'claude-fable-5-1');
    expect(sh('_session_class demo-a')).toBe('fable');
  });

  it('reverse-looks the id up in the lane classes on a non-home-able account', () => {
    install('gpt');
    seedClasses('gpt', { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' });
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper gpt`);
    publishModel(UUID, 'gpt-5.6-sol');
    expect(sh('_session_class demo-a')).toBe('opus');
  });

  it('answers empty for a model the lane has not classified', () => {
    // Spec §4.2/§8: a newly advertised model is SURFACED, never auto-classed.
    // Astra is exactly that model today.
    install('gpt');
    seedClasses('gpt', { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' });
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper gpt`);
    publishModel(UUID, 'gpt-6-astra');
    expect(sh('_session_class demo-a')).toBe('');
  });

  it('answers empty when the lane has no classes file at all', () => {
    // Spec §13.1: a non-Anthropic lane with no registry file yet is a valid
    // state and reads as "all classes unavailable" until `ccrc models <id>
    // init <probe>` seeds one.
    install('gpt');
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper gpt`);
    publishModel(UUID, 'gpt-5.6-sol');
    expect(sh('_session_class demo-a')).toBe('');
  });

  it('takes the FIRST class in CLASSES order when two slots name one model', () => {
    // `shared/models.ts`'s `classOfModel` is "first class in CLASSES order
    // whose id === modelId"; the tsv is written in that order, so reading it
    // top-down is the same rule. Both readers must pick the same slot —
    // ccd-models-agreement.test.ts is where that is asserted across the two.
    install('gpt');
    seedClasses('gpt', { sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-terra' });
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper gpt`);
    publishModel(UUID, 'gpt-5.6-terra');
    expect(sh('_session_class demo-a')).toBe('sonnet');
  });

  it('never opens a classes file for a wrapper the roster does not know', () => {
    // The `wrapper` field is ccd's own write, but it becomes a path here too,
    // and a row naming an account since dropped from the roster is an
    // ordinary state (`_default_pool`'s own note). Roster membership first.
    seedClasses('ghost', { opus: 'gpt-5.6-sol' });
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper ghost`);
    publishModel(UUID, 'gpt-5.6-sol');
    expect(sh('_session_class demo-a')).toBe('');
  });

  it('answers empty when the session has published no model yet', () => {
    install('gpt');
    seedClasses('gpt', { opus: 'gpt-5.6-sol' });
    sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper gpt`);
    expect(sh('_session_class demo-a')).toBe('');
  });
});

// ── the MEASURED read of the `class` registry field ────────────────────────
// Binding ruling, mail 275 item 3 (and spec §7): the field is read by
// `_reg_read_class`, never by `_reg_get`, because `_reg_get` is
// `cat "$REG/$1.$2" 2>/dev/null` and folds absent, unreadable and empty into
// one empty string. Routing consumes this value, and a fold that reads as
// "carries no class" is how a Fable session lands on a lane with no Fable.
//
// THREE CASES, one per outcome, because "tests cover all three" is the ruling's
// own acceptance criterion.
describe('_reg_read_class distinguishes absent, readable and unreadable', () => {
  /** Runs the helper capturing stdout, stderr and the exit code separately —
   *  `sh()` throws on non-zero and trims, and two of the cases below ARE non-zero.
   *  `REG` is `$HOME/.cc-sessions` (`ccd/ccd:765`), so the field's file is
   *  `<home>/.cc-sessions/<id>.class`. */
  const read = (id: string): { out: string; err: string; code: number } => {
    const r = spawnSync('bash', ['-c', `source ${JSON.stringify(CCD)} >/dev/null 2>&1; _reg_read_class ${id}`],
      { encoding: 'utf8', cwd: home, env: { ...process.env, HOME: home } });
    return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status ?? -1 };
  };

  it('absent: no class has ever been recorded — empty, exit 0, nothing on stderr', () => {
    sh('_reg_set demo-a wrapper claude');
    const r = read('demo-a');
    expect(r).toEqual({ out: '', err: '', code: 0 });
  });

  it('readable and one of the four: the value, exit 0', () => {
    sh('_reg_set demo-a wrapper claude; _reg_set demo-a class fable');
    const r = read('demo-a');
    expect(r.out).toBe('fable');
    expect(r.code).toBe(0);
  });

  it('present but unreadable: exit 1, and the PATH is in the message', () => {
    // The case `_reg_get` cannot express at all. Not skipped when running as
    // root: the harness HOME is a fixture directory and the suite does not run
    // as root (`server/test/ccdWsHelpers.ts` asserts it at import time).
    sh('_reg_set demo-a wrapper claude; _reg_set demo-a class opus');
    fs.chmodSync(path.join(home, '.cc-sessions', 'demo-a.class'), 0o000);
    const r = read('demo-a');
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('cannot read the recorded class for demo-a');
    expect(r.err).toContain('demo-a.class');
    fs.chmodSync(path.join(home, '.cc-sessions', 'demo-a.class'), 0o600);
  });

  it('readable but not one of the four: exit 1, naming the value and the path', () => {
    // A torn write or a hand edit. Refusing is the point: the previous reading
    // of this field made every lane eligible, which is routing on a fold.
    sh(`_reg_set demo-a wrapper claude; _reg_set demo-a class 'ultra'`);
    const r = read('demo-a');
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('is not one of haiku sonnet opus fable');
    expect(r.err).toContain('ultra');
    expect(r.err).toContain('demo-a.class');
  });

  it('empty file: reads as absent, exit 0 — `_reg_set … class ""` never happens, but a torn write can', () => {
    sh(`_reg_set demo-a wrapper claude; _reg_set demo-a class ''`);
    expect(read('demo-a')).toEqual({ out: '', err: '', code: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts
```
Expected: every case FAILS with a thrown `execFileSync` error, because none of the four functions exists:
```
Command failed: bash -c source ".../ccd/ccd"; _family_class_of 'claude-haiku-4-5-20260101'
bash: line 1: _family_class_of: command not found
```
and the `_reg_read_class` cases fail on the exit code instead, because a missing
function is `127`, not `0` or `1`:
```
AssertionError: expected { out: '', err: '…_reg_read_class: command not found\n', code: 127 } to deeply equal { out: '', err: '', code: 0 }
```

- [ ] **Step 3: Add the constants**

In `ccd/ccd`, insert immediately AFTER the line

```bash
CLAUDE_AI_BASE="https://claude.ai/code"   # by-name discovery: pick the session whose name == the id
```

and BEFORE `mkdir -p "$REG"`:

```bash
# ── the model-class registry, READ side (spec §7) ───────────────────────
# TWO generated directories, each spelled ONCE in this file, for the reason
# `single-definition.test.ts` exists: ccd is the SECOND reader of both, and a
# second spelling is how a reader and a writer come to mean two different files.
#
#   CCD_MODELS_DIR holds, per account: `<id>.classes.tsv` — the materialiser's
#   bash projection of the registry file `<id>.classes.json`, four lines in
#   CLASSES order, THREE columns `class<TAB>modelId<TAB>state` with
#   `state` one of `assigned`, `unassigned`, `retired` — and `<id>.json`, the
#   provider catalogue a probe wrote. Both are `ccrc`'s writes (`ccrc models
#   set-class`, `ccrc models refresh`); ccd only ever reads them, and it reads
#   the REGISTRY FILE ITSELF never — `probe`, `subagent`, `discovery` and
#   `effort` are no business of the box's mover.
#
#   THE THIRD COLUMN IS WHY AVAILABILITY NEEDS NO JSON HERE. It carries the
#   answer `classesTsv(registry, catalogue)` computed, so ccd branches on a
#   word instead of
#   re-deriving retirement from a catalogue with a second jq of its own — two
#   derivations of one rule being exactly what `ccd-models-agreement.test.ts`
#   would then have to hold together. An empty `modelId` is a CONSEQUENCE of
#   `unassigned`, never the marker for it.
#
#   CCD_SESSION_MODEL_DIR holds one file per CLAUDE CODE session uuid, carrying
#   the concrete model id that session last rendered. Written by
#   `ccd/statusline-command.sh`, which spells the same path in full because it
#   has no `$REG` of its own — the same shape, and the same reason, as
#   GPT_DISABLE_FILE above.
#
# Derived from HOME with no environment override, exactly as REG and
# WRAPPER_DIR are: HOME is the single isolation boundary the test harness sets.
CCD_MODELS_DIR="$HOME/.ccrc/models"
CCD_SESSION_MODEL_DIR="$HOME/.cc-sessions/model"
# The four classes, in the order `shared/models.ts`'s CLASSES declares them.
# That order is load-bearing three times over: it is the order the materialiser
# writes the tsv in, so reading the tsv top-down IS `classOfModel`'s
# "first class in CLASSES order" rule; it is the order `_lane_classes` emits
# and `availableFor` returns, which is what makes the two comparable; and it is
# the order every surface prints. It is NOT the order `_family_class_of` scans
# in — see there.
CCD_CLASSES=(haiku sonnet opus fable)
```

- [ ] **Step 4: Add the helpers**

In `ccd/ccd`, insert immediately AFTER the line

```bash
_reg_get() { cat "$REG/$1.$2" 2>/dev/null; }                # id field
```

the block:

```bash
# ── the class a session is running (spec §7, "Deriving the class") ──────
_is_class() {   # word -> success iff it is one of the four classes
  # The gate in front of every place a class becomes ARGV (`_spawn_start`'s
  # --model) or a file lookup. `class` is a registry field: ccd writes it, but
  # a torn or hand-edited one must not reach a command line.
  local c="$1" v
  for v in "${CCD_CLASSES[@]}"; do [[ "$c" == "$v" ]] && return 0; done
  return 1
}

_family_class_of() {   # anthropic model id -> its class, or "" — the bash twin of shared/models.ts's familyClassOf
  # An Anthropic id carries its family as a HYPHEN-DELIMITED TOKEN
  # (`claude-fable-5-1`, `claude-opus-5-20260101`), which is why the patterns
  # are `*-<c>-*` and not `*<c>*`: a vendor id that merely ends in a family
  # word is not an Anthropic model of that family, and guessing one would put a
  # session on a model nobody chose.
  #
  # FIRST MATCH IN THIS ORDER — fable, opus, sonnet, haiku — because that is the
  # order the TypeScript twin scans in, and `ccd-models-agreement.test.ts` feeds
  # both the same ids. It is deliberately NOT CCD_CLASSES' order: the two
  # answers only coincide while no id carries two family tokens, and pinning
  # the scan order is what makes that stop mattering.
  #
  # ALWAYS EXIT 0. Every caller composes this (`$( )`) rather than branching on
  # it; "unknown" is an empty answer, not a failure (§7).
  local id="$1" c
  for c in fable opus sonnet haiku; do
    case "$id" in *-"$c"-*) echo "$c"; return 0 ;; esac
  done
  return 0
}

_session_model_id() {   # id -> the CONCRETE model id that session last rendered, or ""
  local uuid line=""
  uuid=$(_reg_get "$1" uuid)
  # THE FIELD BECOMES A PATH HERE, and nowhere else in this file. Same
  # defence-in-depth direction as the D-299 arithmetic guards: validate the
  # bytes before they are used, not after. A torn `uuid` holding `../../secret`
  # would otherwise make this echo the first line of a file that is not a
  # model id at all.
  [[ "$uuid" =~ ^[0-9a-zA-Z][0-9a-zA-Z._-]*$ ]] || return 0
  [[ -r "$CCD_SESSION_MODEL_DIR/$uuid" ]] || return 0
  # One line is the whole format (statusline-command.sh writes exactly one),
  # and `read -r` is the cheapest read that gets it. Its non-zero on a file
  # with no trailing newline is not an error here — `line` is set either way,
  # and this file has no `set -e`.
  IFS= read -r line < "$CCD_SESSION_MODEL_DIR/$uuid"
  echo "$line"
}

_session_class() {   # id -> the class the session was last seen running, or ""
  local id="$1" wrapper mid tsv cls val state
  mid=$(_session_model_id "$id"); [[ -n "$mid" ]] || return 0
  wrapper=$(_reg_get "$id" wrapper); [[ -n "$wrapper" ]] || return 0
  # A HOME-ABLE ACCOUNT IS AN ANTHROPIC ONE. Its four aliases resolve to
  # Anthropic's own ids through the client's own defaults, so the family token
  # IN the id is the class and there is nothing under ~/.ccrc/models to read —
  # §4.1: "Anthropic lanes never have one: their four classes are the client's
  # own defaults, shown read-only."
  if _is_home_able "$wrapper"; then _family_class_of "$mid"; return 0; fi
  # Roster membership BEFORE the path: a row naming an account since dropped
  # from the roster is an ordinary state (see `_default_pool`), and `wrapper`
  # becomes a file name on the next line.
  _is_valid_wrapper "$wrapper" || return 0
  tsv="$CCD_MODELS_DIR/$wrapper.classes.tsv"
  [[ -r "$tsv" ]] || return 0
  # TOP-DOWN IS `classOfModel`'s RULE, not an implementation detail: the
  # materialiser writes the four lines in CLASSES order, so the first match
  # walking the file is "the first class in CLASSES order whose id is this
  # one". Two slots may name one model, and both readers must pick the same.
  #
  # COLUMN 3 IS READ AND IGNORED HERE, deliberately. This function answers
  # "which class was the session RUNNING", a question about the past, and a
  # class whose model the provider has since retired is still the class that
  # session was on — the id is in column 2 whatever the state word says (§4.3:
  # a retired id empties nothing). Availability is a different question, asked
  # by `_lane_classes` about the DESTINATION, and it is the only place the
  # state word decides anything. `state` is named in `read` rather than left to
  # fall into `$val` — a two-variable `read` would put "gpt-5.6-sol\tassigned"
  # in `val` and match nothing, silently.
  while IFS=$'\t' read -r cls val state; do
    [[ -n "$val" && "$val" == "$mid" ]] && { echo "$cls"; return 0; }
  done < "$tsv"
  return 0
}

_reg_read_class() {   # id -> echo the recorded class or ""; exit 1 (message on stderr) if the field is unusable
  # A MEASURED READ, and it exists because `_reg_get` cannot do this job.
  # `_reg_get` is `cat "$REG/$1.$2" 2>/dev/null`: absent,
  # unreadable and empty all come back as one empty string. That fold is
  # harmless for `wrapper` (a missing row is a missing row) and NOT harmless
  # here, because routing consumes this value: an unreadable `class` file
  # folded to "" reads as "this session carries no class", and the rotation
  # then puts a Fable session on a lane with no Fable — which is the exact
  # defect this whole design exists to make impossible. Binding ruling, mail
  # 275 item 3: "Routing never acts on a fold."
  #
  # THREE OUTCOMES, and every caller gets to see which one it got:
  #   absent   -> echo nothing, exit 0. No class has ever been recorded for
  #               this row: §7's "Unknown -> '' (carry nothing)".
  #   readable
  #   and one
  #   of four  -> echo it, exit 0.
  #   anything
  #   else     -> echo nothing, exit 1, and NAME THE PATH on stderr. That
  #               covers a file that exists and cannot be read (permissions, a
  #               filesystem error) and a file that reads as something other
  #               than the four classes (torn write, hand edit). Both are
  #               faults, and a fault that routes is worse than a fault that
  #               refuses: the caller stops, the operator sees the path, and
  #               `ccrc doctor` is not needed to find it.
  #
  # `-e` before `-r`: "present but unreadable" and "absent" are different
  # answers and a single `-r` test would fold them back together.
  local f="$REG/$1.class" c
  [[ -e "$f" ]] || return 0
  if [[ ! -r "$f" ]]; then
    printf 'ccd: cannot read the recorded class for %s: %s\n' "$1" "$f" >&2
    return 1
  fi
  c=$(cat "$f" 2>/dev/null) || { printf 'ccd: cannot read the recorded class for %s: %s\n' "$1" "$f" >&2; return 1; }
  [[ -n "$c" ]] || return 0
  _is_class "$c" || {
    printf 'ccd: recorded class for %s is not one of %s: %s (%s)\n' "$1" "${CCD_CLASSES[*]}" "$c" "$f" >&2
    return 1
  }
  printf '%s' "$c"
}
```

- [ ] **Step 5: Re-stamp `ccd/ccd` and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts test/ownership.test.ts
```
Expected: PASS — both files.

- [ ] **Step 6: Mutation check — the torn-uuid path guard**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ "$uuid" =~ ^[0-9a-zA-Z][0-9a-zA-Z._-]*$ ]] || return 0'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, '  [[ -n "$uuid" ]] || return 0'))
MUT
grep -c 'uuid" =~' ccd/ccd
```
Expected: `0` — the guard is gone.

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts -t 'torn uuid'
```
Expected: FAIL —
```
AssertionError: expected 'TOPSECRET' to be ''
```

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ -n "$uuid" ]] || return 0'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(
    s.replace(old, '  [[ "$uuid" =~ ^[0-9a-zA-Z][0-9a-zA-Z._-]*$ ]] || return 0'))
MUT
grep -c 'uuid" =~' ccd/ccd
```
Expected: `1`.

- [ ] **Step 7: Mutation check — the roster-membership gate on the wrapper**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  _is_valid_wrapper "$wrapper" || return 0'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(
    s.replace(old, '  : # roster gate removed for the mutation check'))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts -t 'wrapper the roster does not know'
```
Expected: FAIL —
```
AssertionError: expected 'opus' to be ''
```
— the unrostered `ghost` lane's hand-planted tsv was read.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  : # roster gate removed for the mutation check'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(
    s.replace(old, '  _is_valid_wrapper "$wrapper" || return 0'))
MUT
```

- [ ] **Step 8: Mutation check — the hyphen-delimited family token**

Break it, from the repository root:
```bash
sed -i 's@    case "$id" in \*-"$c"-\*) echo "$c"; return 0 ;; esac@    case "$id" in *"$c"*) echo "$c"; return 0 ;; esac@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts -t 'hyphen-delimited'
```
Expected: FAIL —
```
AssertionError: expected 'opus' to be ''
```
on `_family_class_of 'some-model-opus'`.

Restore, from the repository root:
```bash
sed -i 's@    case "$id" in \*"$c"\*) echo "$c"; return 0 ;; esac@    case "$id" in *-"$c"-*) echo "$c"; return 0 ;; esac@' ccd/ccd
```

- [ ] **Step 9: Mutation check — `_reg_read_class` refuses rather than folding**

This is the binding ruling's own guard (mail 275 item 3), so it gets its own
mutation. Break it back into `_reg_get`'s shape, from the repository root:

```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ -e "$f" ]] || return 0\n  if [[ ! -r "$f" ]]; then'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(
    s.replace(old, '  [[ -e "$f" ]] || return 0\n  if false; then'))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts -t 'present but unreadable'
```
Expected: FAIL —
```
AssertionError: expected 0 to be 1
```
— the unreadable file folded to "" and exit 0, which is exactly the fold the ruling
forbids.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ -e "$f" ]] || return 0\n  if false; then'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(
    s.replace(old, '  [[ -e "$f" ]] || return 0\n  if [[ ! -r "$f" ]]; then'))
MUT
```

And once more, on the value validation:

```bash
sed -i 's@^  _is_class "$c" || {$@  false \&\& {@' ccd/ccd
```

Run, from `server/`: `npx vitest run test/ccd-session-class.test.ts -t 'not one of the four'`
Expected: FAIL — `AssertionError: expected 0 to be 1`.

Restore, from the repository root:
```bash
sed -i 's@^  false \&\& {$@  _is_class "$c" || {@' ccd/ccd
```

- [ ] **Step 10: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-session-class.test.ts test/ownership.test.ts test/single-definition.test.ts
```
Expected: PASS — all three.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-session-class.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): derive a session's model class from the id the statusline published

Two spellings, once each, of the generated files ccd now reads, and the three
lookups spec §7 needs: the Anthropic family token, the registry uuid -> model
file hop, and the reverse lookup in the materialised classes tsv. Unknown
answers empty everywhere, because guessing a class is the silent downgrade
this design exists to make impossible.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: which classes a lane can actually run (`_lane_classes`)

**Files:**
- Modify: `ccd/ccd` — append three helpers to the block Task 4 created (after `_session_class`)
- Test: `server/test/ccd-lane-classes.test.ts` (create)

**Idioms copied (read these before writing):**
- Membership loops that return 0/1: `ccd/ccd:1305` and `:1310` (`_is_valid_wrapper`, `_is_home_able`) — a `for v in "${ARRAY[@]}"` loop returning 0/1, never echoing.
- Space-joined lists consumed by word-splitting: `_pool_for` and its caller in `_swap_target`. `_lane_classes` is the same interface, and every token it emits is one of four literals.
- ccd reads JSON with `grep -oE`, not jq, everywhere it exists today (`ccd/ccd:11750` `_limit_json_num`, `:11761` `_limit_has_key`). **Neither idiom is used for availability here, because availability is not JSON any more**: skeleton "Rulings round 2" item 6 puts it in the tsv's third column. The one function below that still opens the catalogue is `_lane_unclassified_count`, a display-only count for `ccd ls`, and it uses jq because `.models[].hidden` is nested and `grep -oE` would answer confidently and wrongly.

**Interfaces:**
- Consumes: Task 4's `CCD_MODELS_DIR`, `CCD_CLASSES`, `_is_class`, and ccd's own `_is_home_able` / `_is_valid_wrapper`. From Plan 1, the file `~/.ccrc/models/<account>.classes.tsv`: four lines, CLASSES order, `class<TAB>modelId<TAB>state`, `state ∈ assigned | unassigned | retired`.
- Produces, for Tasks 6-10:
  - `_lane_classes <wrapper>` → echoes the AVAILABLE classes, space-separated, in `CCD_CLASSES` order; empty when none. Home-able lanes always echo all four.
  - `_class_available <wrapper> <class>` → exit 0 iff that class is in `_lane_classes <wrapper>`.
  - `_lane_unclassified_count <wrapper>` → echoes a decimal count of VISIBLE catalogue models carrying no class, or nothing when it cannot be known.
- **Deliberately NOT produced: `_model_retired`.** An earlier draft of this plan had ccd re-derive retirement from the catalogue with jq. Round-2 item 6 moved that computation to `classesTsv(registry, catalogue)` in Plan 1 and ships the answer as the state word, so the retirement RULE — "absent from a catalogue that exists and is not stale" (§4.3) — is tested exactly once, in Plan 1, and ccd reads a word. Deviation A-10.

---

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-lane-classes.test.ts`:

```ts
// Spec §4.3's "available classes", as ccd READS them — not as anyone computes
// them. `classesTsv(registry, catalogue)` (Plan 1) is where a class slot
// becomes one of three words; this file pins that ccd branches on that word
// and on nothing else.
//
// THE RULE THAT COSTS THE MOST TO GET WRONG is inferring availability from the
// id column. A `retired` row KEEPS its model id — §4.3: "A retired class id
// empties nothing in the roster (the roster is the operator's)" — so a reader
// that treats "has an id" as "is available" routes onto a model the provider
// has stopped serving, and a reader that treats "is retired" as "has no id"
// loses the id the operator has to reassign. Both mistakes are one column
// apart, and the cases below are what tell them apart.
//
// MUTATION CHECKS, written down the way ccd-default-pool.test.ts writes them:
//   #1 the state gate becomes an id test (`[[ -n "$val" ]]`): the `retired`
//      case goes red and nothing else does — which is the whole point of the
//      third column.
//   #2 the `_is_class` guard is deleted: the torn-class-word case goes red.
//   #3 the hidden-model filter is deleted from the count: one count case reds.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;
const sh = (s: string): string => h.sh(s);

/** One catalogue model, spec §4.2's shape. The return type is INFERRED, not
 *  annotated `Record<string, unknown>`: the fixtures below filter on `m.id`,
 *  and an `unknown`-typed field there is a compile error under this repo's
 *  strict settings. */
const model = (id: string, hidden = false) => ({
  id, label: id.toUpperCase(), context: 272_000, maxContext: 272_000,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], hidden, priceIn: null, priceOut: null,
});

/** Today's Codex catalogue, measured 2026-09-08 and quoted in spec §1: nine
 *  advertised models of which `gpt-reserve` is hidden. Trimmed here to the
 *  five this file's assertions actually name. */
const CODEX = {
  probe: 'codex', fetchedAt: 1_789_000_000, stale: false,
  models: [model('gpt-6-astra'), model('gpt-5.6-sol'), model('gpt-5.6-terra'),
    model('gpt-5.6-luna'), model('gpt-reserve', true)],
};

const seedCatalogue = (account: string, cat: unknown): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.json`), JSON.stringify(cat));
};

/** `classesTsv(registry, catalogue)`'s output shape: four lines, CLASSES order,
 *  `class<TAB>modelId<TAB>state` with `state ∈ assigned | unassigned | retired`.
 *  A class in `retired` keeps its id and loses only its availability. */
const seedClasses = (
  account: string, ids: Record<string, string>, retired: readonly string[] = [],
): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`),
    `${['haiku', 'sonnet', 'opus', 'fable'].map((c) => {
      const id = ids[c] ?? '';
      // The THIRD column is the whole point: `unassigned` iff there is no id,
      // otherwise `retired` when the caller says the provider stopped listing
      // it, otherwise `assigned`. ccd branches on this word and on nothing
      // else — an id with no state word is not a state ccd can produce.
      const state = id === '' ? 'unassigned' : (retired.includes(c) ? 'retired' : 'assigned');
      return `${c}\t${id}\t${state}`;
    }).join('\n')}\n`);
};

/** A tsv nobody's materialiser would write — the torn-file cases. */
const seedRawTsv = (account: string, body: string): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`), body);
};

/** Today's seeded gpt mapping (spec §6.2/§13.1): luna/terra/sol, fable null. */
const GPT_TODAY = { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' };

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-lane-classes-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_lane_classes on an Anthropic (home-able) lane', () => {
  it('is all four, in CLASSES order, with no files anywhere', () => {
    // §4.1: "Anthropic lanes never have one: their four classes are the
    // client's own defaults." Nothing to read, and nothing to classify.
    expect(sh('_lane_classes claude')).toBe('haiku sonnet opus fable');
    expect(sh('_lane_classes claude-d')).toBe('haiku sonnet opus fable');
  });

  it('stays all four even if a classes file for it somehow exists', () => {
    seedClasses('claude-a', { opus: 'claude-opus-5-20260101' });
    expect(sh('_lane_classes claude-a')).toBe('haiku sonnet opus fable');
  });
});

describe('_lane_classes on an external lane: column 3, and only column 3', () => {
  it('is empty when the lane has never been given a classes file', () => {
    // §13.1: a non-Anthropic lane with no registry file reads as "all classes
    // unavailable" until `ccrc models gpt init codex` seeds one.
    install('gpt');
    expect(sh('_lane_classes gpt')).toBe('');
  });

  it('is empty for a wrapper the roster does not know', () => {
    // `wrapper` becomes a file name on the next line; roster membership first.
    seedClasses('ghost', GPT_TODAY);
    expect(sh('_lane_classes ghost')).toBe('');
  });

  it("is today's three when three slots read `assigned`", () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_lane_classes gpt')).toBe('haiku sonnet opus');
  });

  it('drops a class whose row reads `retired`, and the row KEEPS its id', () => {
    // §4.3: the class counts as unavailable for routing until the operator
    // reassigns, and nothing empties the slot. Both halves in one case: the
    // class is gone from the answer, and `gpt-5.6-sol` is still in the file
    // for `ccd ls` (Task 10) to name and for the operator to see.
    install('gpt');
    seedClasses('gpt', GPT_TODAY, ['opus']);
    expect(sh('_lane_classes gpt')).toBe('haiku sonnet');
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('opus\tgpt-5.6-sol\tretired');
  });

  it('drops a class whose row reads `unassigned`', () => {
    // Today's `fable: null` on the gpt lane. §4.1: null means "unavailable on
    // this lane by nature", never "use a default".
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_class_available gpt fable && echo yes || echo no')).toBe('no');
  });

  it('drops every class when every row is retired or unassigned', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY, ['haiku', 'sonnet', 'opus']);
    expect(sh('_lane_classes gpt')).toBe('');
  });

  it('ignores a row whose state word is not one of the three', () => {
    // A torn write or a hand edit. `assigned` is a POSITIVE marker: anything
    // that is not that word is not availability, and the answer to an
    // unreadable row is to leave the class out rather than to guess.
    install('gpt');
    seedRawTsv('gpt', 'haiku\tgpt-5.6-luna\tassigned\nsonnet\tgpt-5.6-terra\t\nopus\tgpt-5.6-sol\tASSIGNED\nfable\t\tunassigned\n');
    expect(sh('_lane_classes gpt')).toBe('haiku');
  });

  it('ignores a row naming something that is not one of the four classes', () => {
    // The tokens this function emits are word-split by `_class_available` and
    // reach `--model` through the registry field, so a stray first column must
    // not become a class name anybody can route on.
    install('gpt');
    seedRawTsv('gpt', 'haiku\tgpt-5.6-luna\tassigned\nultra\tgpt-6-astra\tassigned\n');
    expect(sh('_lane_classes gpt')).toBe('haiku');
  });

  it('never depends on the lane being installed — availability is not enablement', () => {
    // `_account_ok` answers "may a session run here"; this answers "can this
    // lane run that class". Two questions, two mechanisms — the same
    // separation `ccd-default-pool.test.ts` pins between the pool and the
    // kill-switch.
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_lane_classes gpt')).toBe('haiku sonnet opus');
  });

  it('never opens the catalogue to answer this question at all', () => {
    // Round-2 item 6, stated as a test: a catalogue that lists NONE of the
    // classed ids would once have retired all three. It now changes nothing,
    // because retirement is the materialiser's answer and reaches ccd as a
    // word. If this case ever goes red, ccd has grown a second derivation of
    // §4.3 and `ccd-models-agreement.test.ts` is about to start lying.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seedCatalogue('gpt', { ...CODEX, models: [model('gpt-6-astra')] });
    expect(sh('_lane_classes gpt')).toBe('haiku sonnet opus');
  });
});

describe('_class_available', () => {
  it('answers for each of the four on a seeded external lane', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_class_available gpt opus && echo yes || echo no')).toBe('yes');
    expect(sh('_class_available gpt haiku && echo yes || echo no')).toBe('yes');
    expect(sh('_class_available gpt fable && echo yes || echo no')).toBe('no');
  });

  it('is false for a retired class', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY, ['opus']);
    expect(sh('_class_available gpt opus && echo yes || echo no')).toBe('no');
  });

  it('is true for all four on a home-able lane', () => {
    expect(sh('_class_available claude fable && echo yes || echo no')).toBe('yes');
  });

  it('is false for every class on a lane with no classes file', () => {
    install('gpt');
    expect(sh('_class_available gpt opus && echo yes || echo no')).toBe('no');
  });

  it('is false for a word that is not a class at all', () => {
    expect(sh('_class_available claude ultra && echo yes || echo no')).toBe('no');
  });
});

describe('_lane_unclassified_count', () => {
  it("counts today's four unclassified Codex models", () => {
    // Spec §4.3 names them: gpt-6-astra, gpt-5.5, gpt-5.4-mini,
    // gpt-5.3-codex-spark. Four visible models minus the three classed here.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seedCatalogue('gpt', {
      ...CODEX,
      models: [...CODEX.models, model('gpt-5.5'), model('gpt-5.4-mini'), model('gpt-5.3-codex-spark')],
    });
    expect(sh('_lane_unclassified_count gpt')).toBe('4');
  });

  it('excludes hidden models from the count', () => {
    // §4.2: hidden models are excluded from "catalogue"-mode DISCOVERY lists,
    // so a hidden model is not something the operator has failed to classify.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seedCatalogue('gpt', CODEX);
    expect(sh('_lane_unclassified_count gpt')).toBe('1');
  });

  it('counts a RETIRED id as classified, not as unclassified', () => {
    // The id is still in column 2, and the operator has classified it — it is
    // the provider that changed its mind. Counting it again under
    // "unclassified" would double-report one problem `ccd ls` already names.
    install('gpt');
    seedClasses('gpt', GPT_TODAY, ['opus']);
    seedCatalogue('gpt', CODEX);
    expect(sh('_lane_unclassified_count gpt')).toBe('1');
  });

  it('answers nothing when there is no catalogue to count', () => {
    // "Unknowable" is an empty answer, never `0`: a printed `0 unclassified`
    // would claim the operator has nothing left to classify when the honest
    // answer is "nobody has probed this lane yet".
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_lane_unclassified_count gpt')).toBe('');
  });

  it('answers nothing for a stale catalogue', () => {
    // §11: a stale catalogue is the PREVIOUS answer kept after a failed probe.
    // It is fine for naming models and wrong for counting what is missing.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seedCatalogue('gpt', { ...CODEX, stale: true });
    expect(sh('_lane_unclassified_count gpt')).toBe('');
  });

  it('answers nothing when the catalogue is unreadable garbage', () => {
    // Schema drift or a torn write. §11 refuses a partial catalogue at the
    // probe; this is the reader's matching fail-safe direction.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    const d = path.join(home, '.ccrc', 'models');
    fs.writeFileSync(path.join(d, 'gpt.json'), 'not json at all');
    expect(sh('_lane_unclassified_count gpt')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts
```
Expected: every case FAILS with
```
bash: line 1: _lane_classes: command not found
```
(and the same for `_class_available` and `_lane_unclassified_count`).

- [ ] **Step 3: Write the implementation**

In `ccd/ccd`, append immediately AFTER `_session_class`'s closing `}` (the block Task 4 added):

```bash
_lane_classes() {   # wrapper -> the classes AVAILABLE on that lane, space-separated, in CCD_CLASSES order
  # §4.3's "available classes". THIS IS NOT `_account_ok`: that answers "may a
  # session RUN here" (installed, not kill-switched) and this answers "can this
  # lane run that CLASS". Two questions, two mechanisms — the same separation
  # the pool keeps from the kill-switch.
  #
  # COLUMN 3 IS THE ANSWER, AND NOTHING ELSE IS. `classesTsv(registry,
  # catalogue)` already applied §4.3 — a slot is `assigned`, `unassigned`
  # (null: unavailable on this lane by nature) or `retired` (classed, but the
  # provider stopped listing it in a catalogue that exists and is not stale).
  # ccd reads the word. It does NOT re-derive retirement from
  # `<wrapper>.json`, which is why this function opens no JSON and needs no jq:
  # two derivations of one rule, in two languages, is the thing
  # `ccd-models-agreement.test.ts` would then have to hold together forever.
  #
  # `assigned` is a POSITIVE marker (§6.1: "every reader that does branch takes
  # availability from its own positive marker"). Anything else — `retired`,
  # `unassigned`, an empty word, a torn line — is not availability, and a class
  # whose row this loop cannot read is simply left out.
  local w="$1" tsv cls val state out=""
  # An Anthropic lane's four aliases are the client's own defaults, so all four
  # exist and no file describes them (§4.1: such a lane has no registry file).
  if _is_home_able "$w"; then echo "${CCD_CLASSES[*]}"; return 0; fi
  # Roster membership BEFORE the path: a row naming an account since dropped
  # from the roster is an ordinary state (see `_default_pool`), and `$w`
  # becomes a file name on the next line.
  _is_valid_wrapper "$w" || return 0
  tsv="$CCD_MODELS_DIR/$w.classes.tsv"
  [[ -r "$tsv" ]] || return 0     # §13.1: no registry file yet reads as "all classes unavailable"
  # The tsv's own order IS CCD_CLASSES' order (the materialiser writes it that
  # way), so walking it top-down emits the classes in the order `availableFor`
  # returns them — which is what makes the two answers comparable at all.
  while IFS=$'\t' read -r cls val state; do
    _is_class "$cls" || continue          # a torn first column must not become a routable class name
    [[ "$state" == "assigned" ]] || continue
    out="${out:+$out }$cls"
  done < "$tsv"
  echo "$out"
}

_class_available() {   # wrapper class -> success iff that class can be run on that lane
  # Word-splitting the space-joined answer is the interface, exactly as
  # `_swap_target` consumes `_pool_for`: every token is one of four literals.
  local w="$1" c="$2" v
  for v in $(_lane_classes "$w"); do [[ "$v" == "$c" ]] && return 0; done
  return 1
}

_lane_unclassified_count() {   # wrapper -> how many VISIBLE catalogue models carry no class, or "" when unknowable
  # §4.3's "unclassified": the resolved DISCOVERY list minus the classified
  # ids. `ccd ls` prints it and NOTHING ROUTES ON IT — which is the only reason
  # this function is allowed to open the catalogue at all when `_lane_classes`
  # above is not. "Unknowable" (no catalogue, a stale one, unparseable JSON, or
  # no jq) is an empty answer rather than a zero: a printed `0 unclassified`
  # would claim the operator has nothing left to classify.
  #
  # jq, unlike every other JSON read in this file. The catalogue is a nested
  # document (`.models[].id`, `.models[].hidden`, `.stale`) and
  # `_limit_json_num`'s `grep -oE` reads a flat top-level number; pointing it
  # here would answer confidently and wrongly.
  #
  # CLASSIFIED IS COLUMN 2, not column 3: a `retired` id was classified by the
  # operator and it is the provider that changed its mind, so counting it as
  # unclassified would double-report one problem the lane line already names.
  #
  # HIDDEN MODELS ARE EXCLUDED, matching `resolveDiscovery`: a hidden model is
  # not in a "catalogue"-mode discovery list, so it is not something anyone has
  # failed to classify.
  local w="$1" catf="$CCD_MODELS_DIR/$w.json" tsv="$CCD_MODELS_DIR/$w.classes.tsv"
  [[ -r "$catf" && -r "$tsv" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  jq -r --rawfile tsv "$tsv" '
    if (.stale == true) then empty
    else
      ($tsv | split("\n") | map(split("\t") | .[1] // "") | map(select(. != ""))) as $classed
      | [.models[]? | select(.hidden != true) | .id] - $classed | length
    end' "$catf" 2>/dev/null
}
```

- [ ] **Step 4: Re-stamp and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts test/ccd-session-class.test.ts test/ownership.test.ts
```
Expected: PASS — all three files.

- [ ] **Step 5: Mutation check — availability is the state word, not the id**

This is the mutation the third column exists to red. Break it, from the repository root:
```bash
sed -i 's@^    \[\[ "$state" == "assigned" \]\] || continue$@    [[ -n "$val" ]] || continue@' ccd/ccd
grep -c '\[\[ "\$state" == "assigned" \]\]' ccd/ccd
```
Expected: `0` — the state gate is gone and an id is being read as availability.

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts
```
Expected: FAIL — exactly two cases, and they are the two that separate the columns:
```
 × _lane_classes on an external lane: column 3, and only column 3 > drops a class whose row reads `retired`, and the row KEEPS its id
   AssertionError: expected 'haiku sonnet opus' to be 'haiku sonnet'
 × _lane_classes on an external lane: column 3, and only column 3 > drops every class when every row is retired or unassigned
   AssertionError: expected 'haiku sonnet opus' to be ''
```
Every other case survives, including the whole `_class_available` describe's positive
rows — which is what says these two are measuring the column and not the function.

Restore, from the repository root:
```bash
sed -i 's@^    \[\[ -n "$val" \]\] || continue$@    [[ "$state" == "assigned" ]] || continue@' ccd/ccd
```

- [ ] **Step 6: Mutation check — a torn first column is not a class**

Break it, from the repository root:
```bash
sed -i 's@^    _is_class "$cls" || continue          # a torn first column.*$@    : # class-name guard removed for the mutation check@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts -t 'not one of the four classes'
```
Expected: FAIL —
```
AssertionError: expected 'haiku ultra' to be 'haiku'
```

Restore, from the repository root:
```bash
sed -i 's@^    : # class-name guard removed for the mutation check$@    _is_class "$cls" || continue          # a torn first column must not become a routable class name@' ccd/ccd
```

- [ ] **Step 7: Mutation check — hidden models are excluded from the count**

Break it, from the repository root:
```bash
sed -i 's@      | \[.models\[\]? | select(.hidden != true) | .id\] - $classed | length@      | [.models[]? | .id] - $classed | length@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts -t 'excludes hidden models from the count'
```
Expected: FAIL —
```
AssertionError: expected '2' to be '1'
```

Restore, from the repository root:
```bash
sed -i 's@      | \[.models\[\]? | .id\] - $classed | length@      | [.models[]? | select(.hidden != true) | .id] - $classed | length@' ccd/ccd
```

- [ ] **Step 8: Mutation check — a stale catalogue is not counted**

Break it, from the repository root:
```bash
sed -i 's@    if (.stale == true) then empty@    if (false) then empty@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts -t 'answers nothing for a stale catalogue'
```
Expected: FAIL —
```
AssertionError: expected '1' to be ''
```

Restore, from the repository root:
```bash
sed -i 's@    if (false) then empty@    if (.stale == true) then empty@' ccd/ccd
```

- [ ] **Step 9: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-lane-classes.test.ts test/ownership.test.ts
```
Expected: PASS.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-lane-classes.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): which classes a lane can actually run, read out of the state column

Availability is a word the materialiser wrote, not a shape ccd infers: the
classes tsv's third column says assigned, unassigned or retired, and only
`assigned` routes. A retired row keeps its model id — the operator's
classification is not deleted by the provider changing its mind — so no reader
here may treat "has an id" as "is available".

The catalogue is opened for exactly one thing, the `ccd ls` unclassified count,
which nothing routes on and which answers empty rather than zero when it cannot
know.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `_spawn_start` starts the session on its class

**Files:**
- Modify: `ccd/ccd` — `_spawn_start`'s `local` line (`origin/main:12497`), one new block after the `rcflag` block (`:12537-12538`), and BOTH spawn command strings (`:12546` primary, `:12587` the `--session-id` retry). All four measured on `origin/main` 2026-09-08 and re-located after the rebase by their text.
- Modify: `server/test/ccd-spawn-split.test.ts` — its byte-exact `expectedCommand` helper (`origin/main:684-686`)
- Test: `server/test/ccd-spawn-model-flag.test.ts` (create)

**Idioms copied (read these before writing):**
- `ccd/ccd:12537-12538` — how `$rcflag` is computed ONCE, before either spawn line, "so the two can never disagree: a resume that died and retried inside the same call must not come back a different KIND of pane than the one it was replacing". `$mflag` copies that rule exactly and for the same reason.
- `ccd/ccd:12497` — the `local` line is where every one of this function's variables is declared; `set -u` is on.
- `server/test/ccd-spawn-split.test.ts:684-686` — `expectedCommand`, and the docstring above it at `:672-683`. Read that docstring first: the argv is pinned WHOLE and IN ORDER because a `toContain` passed just as happily with `$rcflag` moved after `$sidflag` (measured, 81/81 green). Adding a flag to those lines therefore REQUIRES editing that helper; there is no way to add it without touching this file.
- `server/test/ccd-spawn-split.test.ts:47-58` (`TMUX`), `:80` (`newSessions`), `:82-86` (`seed`).

**Interfaces:**
- Consumes: Task 4's `_is_class`, Task 5's `_class_available`; the registry field `class` (written by Task 8, `--as-class` in Task 9).
- Produces: both spawn command strings carry `$mflag` between `$sidflag`/`--session-id '<uuid>'` and `--dangerously-skip-permissions`. `$mflag` is `--model '<class>'` or empty.

---

- [ ] **Step 1: Update the byte-exact argv pin so it can express the model slot**

In `server/test/ccd-spawn-split.test.ts`, replace `expectedCommand` and its docstring (`origin/main:672-686`) with:

```ts
  /** WHAT THE REFERENCE FLEET RUNS TODAY, spelled out once. The RC-on argv must
   *  be BYTE-IDENTICAL to what `e645215`'s unconditional literal produced — that
   *  is the whole risk of that task, and `toBe` against this string is what
   *  makes it a suite mechanism rather than a reviewer's one-off measurement.
   *
   *  ORDER IS PART OF IT. A `toContain("--remote-control 'myid'")` passes just
   *  as happily with `$rcflag` moved after `$sidflag` (measured: 81/81 green),
   *  so the substring form pinned the flag's PRESENCE and nothing about the
   *  command it composes.
   *
   *  THE MODEL SLOT (spec §7) is the third parameter and defaults to absent,
   *  which is what every case in THIS file passes. An empty `$mflag` collapses
   *  the same way an empty `$rcflag` does — to a DOUBLE SPACE, not an empty
   *  argv word — so "no class carried" is a pinned string here rather than an
   *  assumption. `ccd-spawn-model-flag.test.ts` is where the non-null values
   *  are asserted. */
  const expectedCommand = (sidflag: string, rc: boolean, model: string | null = null): string =>
    `cd '${h.home}' && exec env COLORTERM=truecolor '${h.home}/.local/bin/claude' `
    + `${rc ? "--remote-control 'myid' " : ' '}${sidflag} ${model === null ? '' : `--model '${model}'`} --dangerously-skip-permissions`;
```

Nothing else in that file changes: all four call sites keep passing two arguments and now expect the double-space form the new `ccd` produces.

- [ ] **Step 2: Write the failing test**

Create `server/test/ccd-spawn-model-flag.test.ts`:

```ts
// Spec §7, "Spawning": `_spawn_start` appends `--model <class>` when the
// registry's `class` is non-empty AND the class is available on the
// destination lane. Aliases only — the destination's settings `env` block
// (§6.1) is what resolves them into a concrete id.
//
// THE SECOND CONDITION IS THE WHOLE POINT. Without it, a Fable-class session
// swapped onto today's gpt lane would be started with `--model fable`, which
// on that lane resolves to the `ccrc-unavailable-fable` SENTINEL and 404s on
// the first turn — a session that comes back dead instead of coming back as
// Opus. Skipping the flag lets the lane's own default answer, which is the
// behaviour that shipped before this wave.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

/** The tmux substrate modelled by ONE file, $HOME/pane-up — the
 *  ccd-spawn-verdict.test.ts idiom, copied from ccd-spawn-split.test.ts:47. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;

const UUID = 'deadbeef-0000-4000-8000-000000000000';

const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));

const seed = (id: string, wrapper: string): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${home}'
        _reg_set ${id} uuid ${UUID}`);
};

const seedClasses = (
  account: string, ids: Record<string, string>, retired: readonly string[] = [],
): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`),
    `${['haiku', 'sonnet', 'opus', 'fable'].map((c) => {
      const id = ids[c] ?? '';
      // The THIRD column is the whole point: `unassigned` iff there is no id,
      // otherwise `retired` when the caller says the provider stopped listing
      // it, otherwise `assigned`. ccd branches on this word and on nothing
      // else — an id with no state word is not a state ccd can produce.
      const state = id === '' ? 'unassigned' : (retired.includes(c) ? 'retired' : 'assigned');
      return `${c}\t${id}\t${state}`;
    }).join('\n')}\n`);
};

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

const GPT_TODAY = { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' };

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-spawn-model-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_spawn_start carries the session class onto the new pane', () => {
  it('adds no --model at all when no class has ever been recorded', () => {
    // The pre-wave behaviour, unchanged: a row with no `class` field starts
    // exactly as it always did, and the destination's own default answers.
    seed('myid', 'claude');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(newSessions()).toHaveLength(1);
    expect(newSessions()[0]).not.toContain('--model');
  });

  it("adds --model '<class>' on a home-able lane, which can run all four", () => {
    seed('myid', 'claude');
    h.sh("_reg_set myid class fable");
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    // The ALIAS, in single quotes, exactly as $rcflag quotes its operand: the
    // string is composed into a shell command tmux runs.
    expect(newSessions()[0]).toContain("--model 'fable'");
  });

  it('adds it on an external lane that HAS the class', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seed('myid', 'gpt');
    h.sh('_reg_set myid class opus');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(newSessions()[0]).toContain("--model 'opus'");
  });

  it('adds NOTHING on an external lane that lacks the class', () => {
    // Today's gpt lane, with `fable: null`. `--model fable` here resolves to
    // the ccrc-unavailable-fable sentinel and 404s; no flag lets the lane's
    // own default answer.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seed('myid', 'gpt');
    h.sh('_reg_set myid class fable');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(newSessions()[0]).not.toContain('--model');
  });

  it('adds nothing on an external lane whose classed model has been retired', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    fs.writeFileSync(path.join(home, '.ccrc', 'models', 'gpt.json'), JSON.stringify({
      probe: 'codex', fetchedAt: 1_789_000_000, stale: false,
      models: [{ id: 'gpt-6-astra', label: 'A', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null }],
    }));
    seed('myid', 'gpt');
    h.sh('_reg_set myid class opus');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(newSessions()[0]).not.toContain('--model');
  });

  it('REFUSES on a torn class field, and never puts its bytes on the command line', () => {
    // `class` is ccd's own write, but this composes a shell command string, and
    // `_reg_read_class` is the gate: without it a hand-edited field is argv.
    //
    // A REFUSAL, not a silent "no flag" — binding ruling mail 275 item 3,
    // "routing never acts on a fold". A file that exists and reads as something
    // other than the four classes is a FAULT; spawning on the lane's default
    // and saying nothing is how a Fable session comes back as Opus. `die` is
    // `_spawn_start`'s documented only failure mode.
    seed('myid', 'claude');
    h.sh(`_reg_set myid class "opus'; touch \\"\\$HOME/PWNED\\"; :'"`);
    const r = spawnSync('bash', ['-c', `source ${JSON.stringify(CCD)}; ${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`],
      { encoding: 'utf8', cwd: home, env: { ...process.env, HOME: home } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('is not one of haiku sonnet opus fable');
    // Nothing was spawned at all, so nothing carries the bytes.
    expect(newSessions().join('\n')).not.toContain('PWNED');
    expect(fs.existsSync(path.join(home, 'PWNED'))).toBe(false);
  });

  it('puts the same flag on the --session-id RETRY line', () => {
    // The retry replaces a pane that did not come up; it must not come back a
    // differently-shaped pane than the attempt it replaces. That is why
    // $mflag, like $rcflag, is computed once before either line.
    const RESUME_DIES = `sleep() { :; };
      tmux() {
        echo "tmux $*" >> "$HOME/ccd-calls"
        case "$1" in
          new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
          has-session)  [[ -e "$HOME/pane-up" ]] ;;
        esac
      };`;
    seed('myid', 'claude');
    h.sh('_reg_set myid class opus');
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
    const news = newSessions();
    expect(news).toHaveLength(2);
    expect(news[0]).toContain("--model 'opus'");
    expect(news[1]).toContain("--model 'opus'");
    expect(news[1]).toContain(`--session-id '${UUID}'`);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run, from `server/`:
```bash
npx vitest run test/ccd-spawn-model-flag.test.ts test/ccd-spawn-split.test.ts
```
Expected:
- `ccd-spawn-model-flag.test.ts`: the five cases that assert a flag PRESENT fail —
  ```
  AssertionError: expected 'tmux new-session -d -s cc-myid -x 220 …' to contain "--model 'fable'"
  ```
  The three `not.toContain('--model')` cases pass already; they are the negative controls.
- `ccd-spawn-split.test.ts`: FOUR cases fail (`no flag file — the primary spawn argv…`, `flag file 'on' — …`, and the two RETRY cases) —
  ```
  AssertionError: expected "…--session-id 'deadbeef-…' --dangerously-skip-permissions" to be "…--session-id 'deadbeef-…'  --dangerously-skip-permissions"
  ```
  because the helper now expects the double space the implementation has not yet produced. That is the pin doing its job: the argv cannot change without this file saying so.

- [ ] **Step 4: Write the implementation**

In `ccd/ccd`, `_spawn_start`:

**(a)** Replace the `local` line

```bash
  local id="$1" mode="$2" wrapper workdir uuid tname sidflag rcflag
```

with

```bash
  local id="$1" mode="$2" wrapper workdir uuid tname sidflag rcflag mflag cls
```

**(b)** Immediately AFTER the line

```bash
  _rc_enabled && [[ "$(_reg_get "$id" rc)" != "off" ]] && rcflag="--remote-control '$id'"
```

insert:

```bash
  # THE CLASS CARRY (spec §7, "Spawning"), and it is computed HERE — once,
  # before either spawn line — for the same reason `$rcflag` above is: a resume
  # that died and retried inside this same call must not come back a
  # differently-shaped pane than the one it is replacing.
  #
  # TWO CONDITIONS, and the second is the whole point. A session that was last
  # seen on Fable comes back on Fable wherever it lands — but only where the
  # destination CAN run Fable. On today's gpt lane (`fable: null`) the alias
  # resolves through §6.1's sentinel, `ccrc-unavailable-fable`, and the backend
  # 404s: passing it would turn "comes back as Opus" into "comes back dead".
  # No flag lets the lane's own default answer, which is exactly the behaviour
  # that shipped before this wave.
  #
  # THE ALIAS, NEVER A CONCRETE ID. The destination's settings `env` block is
  # what maps `opus` to a model on that lane, and it is the only thing that
  # knows the mapping.
  #
  # `_is_class` before either: `class` is a registry field and this composes a
  # shell command string that tmux runs.
  mflag=""
  # `_reg_read_class`, NEVER `_reg_get` (binding ruling, mail 275 item 3): an
  # unreadable or torn `class` file must not fold into "no class recorded" and
  # spawn on the lane's own default. It validates the four for us, so `_is_class`
  # is not repeated here. `die` is `_spawn_start`'s documented only failure mode
  # (`server/test/ccd-arith-containment.test.ts`), and the helper has already put
  # the path on stderr.
  cls=$(_reg_read_class "$id") || die "refusing to spawn $id: its recorded class is unusable (see above)"
  if [[ -n "$cls" ]] && _class_available "$wrapper" "$cls"; then
    mflag="--model '$cls'"
  fi
```

**(c)** Replace the primary spawn line

```bash
    "cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' $rcflag $sidflag --dangerously-skip-permissions"
```

with

```bash
    "cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' $rcflag $sidflag $mflag --dangerously-skip-permissions"
```

**(d)** Replace the retry spawn line

```bash
        "cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' $rcflag --session-id '$uuid' --dangerously-skip-permissions"
```

with

```bash
        "cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' $rcflag --session-id '$uuid' $mflag --dangerously-skip-permissions"
```

- [ ] **Step 5: Re-stamp and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-spawn-model-flag.test.ts test/ccd-spawn-split.test.ts test/ccd-rc-flag.test.ts test/ccd-arith-containment.test.ts test/ownership.test.ts
```
Expected: PASS — all five files. (`ccd-arith-containment.test.ts` is in the list because it holds "`_spawn_start`'s only failure mode is die": the new block adds no `return`.)

- [ ] **Step 6: Mutation check — the availability condition**

Break it, from the repository root:
```bash
sed -i 's@^  if \[\[ -n "$cls" \]\] \&\& _class_available "$wrapper" "$cls"; then$@  if [[ -n "$cls" ]]; then@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-spawn-model-flag.test.ts -t 'adds NOTHING on an external lane that lacks the class'
```
Expected: FAIL —
```
AssertionError: expected "…'/…/.local/bin/gpt'  --session-id 'deadbeef-…' --model 'fable' --dangerously-skip-permissions" not to contain '--model'
```

Restore, from the repository root:
```bash
sed -i 's@^  if \[\[ -n "$cls" \]\]; then$@  if [[ -n "$cls" ]] \&\& _class_available "$wrapper" "$cls"; then@' ccd/ccd
```

- [ ] **Step 7: Mutation check — the measured read is what keeps a torn field off the command line**

Break it back to the fold, from the repository root:
```bash
sed -i 's@^  cls=$(_reg_read_class "$id") || die "refusing to spawn $id: its recorded class is unusable (see above)"$@  cls=$(_reg_get "$id" class)@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-spawn-model-flag.test.ts -t 'torn class field'
```
Expected: FAIL — the spawn no longer refuses, and the torn bytes reach the composed
command string:
```
AssertionError: expected 0 not to be 0
```
and, with `--reporter=verbose`, the follow-on
```
AssertionError: expected "…--model 'opus'; touch \"$HOME/PWNED\"; :'' …" not to contain 'PWNED'
```

Restore, from the repository root:
```bash
sed -i 's@^  cls=$(_reg_get "$id" class)$@  cls=$(_reg_read_class "$id") || die "refusing to spawn $id: its recorded class is unusable (see above)"@' ccd/ccd
```

- [ ] **Step 8: Mutation check — the retry line carries the flag too**

Break it, from the repository root:
```bash
sed -i "s@--session-id '\$uuid' \$mflag --dangerously-skip-permissions@--session-id '\$uuid' --dangerously-skip-permissions@" ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-spawn-model-flag.test.ts -t 'RETRY line'
```
Expected: FAIL —
```
AssertionError: expected "tmux new-session -d -s cc-myid -x 220 -y 50 cd '…' && exec env COLORTERM=truecolor '…/claude'  --session-id 'deadbeef-…' --dangerously-skip-permissions" to contain "--model 'opus'"
```

Restore, from the repository root:
```bash
sed -i "s@--session-id '\$uuid' --dangerously-skip-permissions@--session-id '\$uuid' \$mflag --dangerously-skip-permissions@" ccd/ccd
```
Confirm the restore touched exactly the retry line and not the primary one (the primary uses `\$sidflag`, not the literal `--session-id`):
```bash
grep -c "session-id '\$uuid' \$mflag" ccd/ccd
```
Expected: `1`.

- [ ] **Step 9: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-spawn-model-flag.test.ts test/ccd-spawn-split.test.ts test/ccd-rc-flag.test.ts test/ownership.test.ts
```
Expected: PASS.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-spawn-model-flag.test.ts server/test/ccd-spawn-split.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): start a session on the class it was last seen running

_spawn_start composes --model '<class>' once, before either spawn line, and
only when the destination lane can actually run that class: the alias on a
lane with a null slot resolves to §6.1's sentinel and 404s, so no flag — and
the lane's own default — is the correct answer there. The byte-exact argv pin
in ccd-spawn-split.test.ts gains the slot; nothing else about the line moves.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: rotation is class-aware — `_swap_target` and `_auto_swap_check` skip a lane that cannot run the class

**Files:**
- Modify: `ccd/ccd` — one new helper `_class_ok` (append to the block Task 5 ended), one guard in `_swap_target`'s "home recovered" branch, one guard in its candidate loop, one guard in `_auto_swap_check`
- Test: `server/test/ccd-class-rotation.test.ts` (create)

**Idioms copied (read these before writing):**
- `server/test/ccd-default-pool.test.ts` on `main` (2026-09-07) — the whole harness usage: `writeLimits` (`:63-66`), `writeWeeklyOnly` (`:68-72`, "the real `~/.cc-limits/gpt.json` on the reference box, not an invented one"), `install` (`:74-75`), `disable` (`:77-78`), and the derived `HOME_ABLE` string (`:80-82`, "Derived, not hand-typed, so a roster edit cannot silently drift this file's expectations"). Its header (`:1-50`) is also the model for how a mutation check is written down: name the mutant, name the count of cases it reds, name the ones that must SURVIVE. **That file is on `main` and not on this branch** — see this plan's "Skeleton deviations". Read it there (`/tmp/claude-1000/…/scratchpad/mcr/server/test/ccd-default-pool.test.ts`) and copy the helpers into the new file.
- `server/test/ccd-account-ok.test.ts`'s `|| true` idiom for capturing the empty stdout of a `_swap_target` that answers nothing without throwing — quoted at `ccd-default-pool.test.ts:181-184`.
- `ccd/ccd:12019-12167` — `_swap_target` (measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase), including the `force` contract, the composed-rule header quoted in A-8, and the "unmeasured ranks last, not first" note.
- `ccd/ccd:12178` — `_auto_swap_check` (measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase), including its `_avail "$target" || return 0` re-check at `:12292` after `_swap_target` answers.
- The wave-2b plan's crossing section, "The composed rule: an untagged overflow lane is in every pool (ruled 2026-09-08)"
  (`<worktree>/clear-meadow/docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md`,
  READ ONLY, above its wave map). **Required reading before this task**, by skeleton
  "Rulings round 2" item 8. Two things in it bind the guard below: `_pool_ok` is "a hard
  `continue` ahead of all bracketing", which is why a class filter placed after it covers
  both brackets; and the composed state it documents — every in-pool home-able account at
  the ceiling, healthy accounts in another pool, an untagged lane installed, so the
  rotation lands on the overflow lane — is exactly the state in which a Fable-class
  session would otherwise reach a lane whose `fable` slot is null.

**Interfaces:**
- Consumes: Task 5's `_lane_classes` / `_class_available`, Task 4's `_is_class`.
- Produces: `_class_ok <id> <wrapper>` → exit 0 unless the session HAS a recognised class the lane cannot run. Used by `_swap_target` (twice) and `_auto_swap_check` (once).

---

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-class-rotation.test.ts`:

```ts
// Spec §7, "Rotation is class-aware": `_swap_target` for a session of class C
// skips any lane where C is unavailable, in both the home-able bracket and the
// overflow bracket. Today's gpt lane (`fable: null`) therefore never receives
// a Fable-class session until Astra is classified — "comes back as Opus"
// becomes IMPOSSIBLE rather than merely rarer.
//
// §15 decision 2 is what makes this a skip rather than a downgrade: an
// automatic mover may not quietly change which model a session runs. A manual
// `ccd swap --as-class` is the only way to accept that trade, and it is the
// operator's word (ccd-swap-as-class.test.ts).
//
// UNKNOWN CARRIES NOTHING, and that direction is load-bearing: a row with no
// `class` field — every row that has not rendered a status bar since this
// wave landed — must be eligible everywhere it was eligible before, or the
// rescue loop stops being an escape route. The negative-control cases below
// are the ones that pin it.
//
// MUTATION CHECKS, measured and written down the way ccd-default-pool.test.ts
// writes them down:
//   #1 `_class_ok` deleted from `_swap_target`'s candidate loop: the two cases
//      in `_swap_target skips a lane…` go red ("skips the overflow lane…",
//      "…and still takes it for a class it CAN run" survives, because that one
//      never needed the guard).
//   #2 `_class_ok` deleted from the "home recovered" branch: one case goes red
//      ("does not send a session home to a lane that cannot run its class").
//   #3 `_class_ok` deleted from `_auto_swap_check`: one case goes red ("refuses
//      a target its own _swap_target picked"), and its positive control
//      ("dispatches when the class fits") stays green either way — which is
//      what says the case is discriminating rather than merely present.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string): string => h.sh(s);
const now = (): number => Math.floor(Date.now() / 1000);

/** The Anthropic shape `statusline-command.sh` writes: both windows, fresh. */
const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now() }));

/** The Codex shape `ccgpt-usage` writes: weekly only, `five` null. */
const writeWeeklyOnly = (w: string, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five: null, seven, ts: now(), fiveResetAt: null, sevenResetAt: now() + 400_000 }));

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

const seedClasses = (
  account: string, ids: Record<string, string>, retired: readonly string[] = [],
): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`),
    `${['haiku', 'sonnet', 'opus', 'fable'].map((c) => {
      const id = ids[c] ?? '';
      // The THIRD column is the whole point: `unassigned` iff there is no id,
      // otherwise `retired` when the caller says the provider stopped listing
      // it, otherwise `assigned`. ccd branches on this word and on nothing
      // else — an id with no state word is not a state ccd can produce.
      const state = id === '' ? 'unassigned' : (retired.includes(c) ? 'retired' : 'assigned');
      return `${c}\t${id}\t${state}`;
    }).join('\n')}\n`);
};

/** Today's seeded gpt mapping (spec §6.2): luna/terra/sol, fable null. */
const GPT_TODAY = { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' };

/** Derived, not hand-typed, so a roster edit cannot silently drift this
 *  file's expectations out of step with what the harness seeds. */
const HOME_ABLE = DEFAULT_TEST_ROSTER.accounts.filter((a) => a.homeAble).map((a) => a.id);

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-class-rotation-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_class_ok: unknown carries nothing, a known class is a requirement', () => {
  it('is true for a row with no class field at all', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_class_ok demo-a gpt && echo yes || echo no')).toBe('yes');
  });

  it('is FALSE for a torn class field — a fault refuses, it does not route', () => {
    // Binding ruling, mail 275 item 3: "Routing never acts on a fold." A field
    // that exists and is not one of the four is a FAULT, and the answer is to
    // take the destination away and let the row strand loudly — `swapblocked`
    // plus the banner the operator already knows how to read, with the path on
    // stderr — rather than to hand back "eligible" and rotate a session whose
    // class nobody knows.
    //
    // NOTE THE ASYMMETRY with the case above, and it is the ruling's own: an
    // ABSENT field means "carry nothing" (§7) and stays eligible; only a field
    // that EXISTS and is wrong refuses. The escape route stays open for every
    // row that never recorded a class, which is every row that has not rendered
    // a status bar since this wave landed.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh("_reg_set demo-a class 'ultra'");
    expect(sh('_class_ok demo-a gpt && echo yes || echo no')).toBe('no');
  });

  it('is FALSE for a class field that exists and cannot be read', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set demo-a class opus');
    fs.chmodSync(path.join(home, '.cc-sessions', 'demo-a.class'), 0o000);
    expect(sh('_class_ok demo-a gpt 2>/dev/null && echo yes || echo no')).toBe('no');
    fs.chmodSync(path.join(home, '.cc-sessions', 'demo-a.class'), 0o600);
  });

  it('is false only for a real class the lane cannot run', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set demo-a class fable');
    expect(sh('_class_ok demo-a gpt && echo yes || echo no')).toBe('no');
    sh('_reg_set demo-a class opus');
    expect(sh('_class_ok demo-a gpt && echo yes || echo no')).toBe('yes');
    expect(sh('_class_ok demo-a claude-a && echo yes || echo no')).toBe('yes');
  });
});

describe('_swap_target skips a lane that cannot run the session class', () => {
  it('skips the overflow lane for a Fable-class session even when it is the only candidate left', () => {
    // The exact shape of §7's promise. Every home-able account is over the
    // ceiling, gpt is installed, enabled and reporting zero — the state in
    // which a session lands on gpt today — and this session is Fable-class.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set claude-demo class fable');
    sh('_reg_set claude-demo pool "claude-a claude-b claude-d gpt"');
    for (const w of HOME_ABLE) writeLimits(w, 99, 99);
    writeLimits('claude', 99, 99);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_swap_target claude-demo claude claude || true')).toBe('');
  });

  it('...and still takes it for a class it CAN run', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set claude-demo class opus');
    sh('_reg_set claude-demo pool "claude-a claude-b claude-d gpt"');
    for (const w of HOME_ABLE) writeLimits(w, 99, 99);
    writeLimits('claude', 99, 99);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_swap_target claude-demo claude claude')).toBe('gpt');
  });

  it('...and still takes it for a session carrying no class at all', () => {
    // The negative control: nothing about the pre-wave rescue may change for
    // a row that has never rendered a status bar.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set claude-demo pool "claude-a claude-b claude-d gpt"');
    for (const w of HOME_ABLE) writeLimits(w, 99, 99);
    writeLimits('claude', 99, 99);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_swap_target claude-demo claude claude')).toBe('gpt');
  });

  it('picks the next home-able account instead, when one has headroom', () => {
    // A Fable-class session leaving a pinned home lands on an Anthropic
    // account, which can run all four — the ordinary case, unchanged.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set claude-demo class fable');
    sh('_reg_set claude-demo pool "claude-a claude-b claude-d gpt"');
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 40, 40);
    writeLimits('claude-b', 99, 99);
    writeLimits('claude-d', 99, 99);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('does not send a session home to a lane that cannot run its class', () => {
    // The "home recovered: go back" branch is a DESTINATION like any other. A
    // session homed on the overflow lane, moved off it, and now Fable-class
    // must not be pulled back the instant the lane reports headroom.
    //
    // The answer is EMPTY — "stay put" — not another lane: with the go-back
    // branch skipped, the next rung is `_avail "$cur"`, and cur (claude-a) is
    // under the ceiling, so `_swap_target` returns 0 having printed nothing.
    // Staying is the right outcome; the assertion is that it is not `gpt`.
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set gpt-demo class fable');
    sh('_reg_set gpt-demo pool "claude-a gpt"');
    writeWeeklyOnly('gpt', 0);
    writeLimits('claude-a', 10, 10);
    expect(sh('_swap_target gpt-demo claude-a gpt')).toBe('');
  });

  it('...and still sends it home when the class fits', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set gpt-demo class opus');
    sh('_reg_set gpt-demo pool "claude-a gpt"');
    writeWeeklyOnly('gpt', 0);
    writeLimits('claude-a', 10, 10);
    expect(sh('_swap_target gpt-demo claude-a gpt')).toBe('gpt');
  });
});

describe('_auto_swap_check re-checks the class on the target it was handed', () => {
  /** The tick, with everything that touches the world stubbed out and the
   *  dispatch RECORDING instead of acting. `_swap_target` is stubbed to a
   *  fixed answer so this describe tests the CALLER's own gate rather than
   *  re-testing the picker above. */
  const tick = (extra = ''): string => sh(
    '_swap_target() { echo gpt; }; _pane_hard_blocked() { return 0; };'
    + ' _home_for() { echo claude; }; _avail() { return 0; };'
    + ' tmux() { printf "%s" "API Error: 429"; };'
    + ' _dispatch_swap() { echo "DISPATCH $2" >> "$HOME/ccd-calls"; };'
    + ` ${extra} _auto_swap_check demo-a; echo tick-done`);

  beforeEach(() => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    sh('_reg_set demo-a wrapper claude; _reg_set demo-a home claude');
  });

  it('refuses a target its own _swap_target picked but the class cannot run', () => {
    sh('_reg_set demo-a class fable');
    expect(tick()).toContain('tick-done');
    expect(h.calls()).not.toContain('DISPATCH gpt');
  });

  it('dispatches when the class fits', () => {
    sh('_reg_set demo-a class opus');
    expect(tick()).toContain('tick-done');
    expect(h.calls()).toContain('DISPATCH gpt');
  });

  it('dispatches for a session carrying no class', () => {
    expect(tick()).toContain('tick-done');
    expect(h.calls()).toContain('DISPATCH gpt');
  });
});

describe('structural: the guard sits in every candidate loop _swap_target has', () => {
  // THE PIN THAT SURVIVES A REBASE, and the mechanism behind the ruling that
  // the class filter is the THIRD PREDICATE of a composed chain rather than a
  // standalone skip (skeleton "Rulings round 2" item 8).
  //
  // Measured on ws/clear-meadow's committed tip 9e9ebd1c, the post-#62 shape
  // Task 2 rebases onto: `_swap_target` (ccd/ccd:12019-12167) has ONE
  // `for cand in $(_pool_for "$id")` loop (:12111) whose three eligibility
  // rungs are `_pool_ok` (:12126, #62's pool predicate), `_account_ok`
  // (:12127) and `_avail` (:12128); PR #61's home-able / overflow bracket
  // split happens twenty-eight lines LATER, at the ranking (:12156-12162), and
  // reads whatever survived those rungs. So the class guard, appended after
  // `_avail`, filters BOTH brackets with one line — and that is the only
  // placement that does. Inside either bracket it would cover one; before
  // `_pool_ok` it would answer a class question about a lane #62 has already
  // refused.
  //
  // `ccd/ccd` has a SECOND `for cand in $(_pool_for "$id")` loop on that tip
  // (:14134, inside `_strand_why`), which is why this scan is scoped to
  // `_swap_target`'s body rather than to the file — and why the loop is worth
  // pinning at all: if a future rebase brings a `_swap_target` with a second
  // candidate loop, this goes red naming the gap instead of the guard silently
  // covering half the function.
  //
  // A COVERAGE FLOOR, because a scan over an empty slice passes everything —
  // the rule `wsaudit.test.ts` and `ccd-refusal-scan.test.ts` both state.
  const src = fs.readFileSync(CCD, 'utf8');

  // `_pane_hard_blocked` is the function immediately after `_swap_target` on
  // that tip (ccd/ccd:12169) and is the slice's end marker. If the rebase
  // lands a different neighbour, change the marker — never widen the slice to
  // the whole file, which is how a scan starts passing on lines that are not
  // in this function at all.
  const bodyLines = (name: string, until: string): string[] => {
    const from = src.indexOf(`${name}() {`);
    const to = src.indexOf(`${until}() {`, from);
    expect(from, `ccd/ccd has no ${name}`).toBeGreaterThan(-1);
    expect(to, `ccd/ccd has no ${until} after ${name}`).toBeGreaterThan(from);
    return src.slice(from, to).split('\n').map((l) => l.trim());
  };

  it('every `_avail "$cand" || continue` in _swap_target is followed by the class guard', () => {
    const body = bodyLines('_swap_target', '_pane_hard_blocked');
    const at = body.reduce<number[]>((acc, l, i) => (l === '_avail "$cand" || continue' ? [...acc, i] : acc), []);
    expect(at.length, 'no `_avail "$cand" || continue` line in _swap_target — the anchor moved').toBeGreaterThanOrEqual(1);
    for (const i of at) {
      expect(body[i + 1],
        'a candidate loop in _swap_target does not skip a lane that cannot run the session class')
        .toBe('_class_ok "$id" "$cand" || continue');
    }
  });

  it('the home-recovered branch carries it too', () => {
    // THE ARM SPANS LINES after the #62 rebase (`ws/clear-meadow`
    // `ccd/ccd:12068-12069`): `_account_ok … _pool_ok …` on one line,
    // `&& _avail "$home" && { echo "$home"; return 0; }  # home recovered` on
    // the next, joined by a trailing backslash. So the slice is taken from the
    // comment BACKWARDS over the continued lines rather than from the one line
    // the comment sits on — a single-line search here passed on the pre-rebase
    // shape and would silently pass on the post-rebase one with no guard at all.
    const body = bodyLines('_swap_target', '_pane_hard_blocked');
    const end = body.findIndex((l) => l.includes('# home recovered: go back'));
    expect(end, 'the home-recovered branch has moved or lost its comment').toBeGreaterThan(-1);
    let start = end;
    while (start > 0 && body[start - 1]!.endsWith('\\')) start -= 1;
    const arm = body.slice(start, end + 1).join(' ');
    expect(arm, 'the home-recovered branch does not skip a lane that cannot run the session class')
      .toContain('_class_ok "$id" "$home"');
    // …and it is a conjunct of the SAME arm, not a stray line above it.
    expect(arm.indexOf('_class_ok "$id" "$home"'))
      .toBeLessThan(arm.indexOf('_avail "$home"'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts
```
Expected: FAIL. The `_class_ok` describe's first two cases fail with
```
AssertionError: expected 'no' to be 'yes'
```
(the snippet's own `|| echo no` catches bash's `_class_ok: command not found`, so the assertion is what reports it).
The `_swap_target skips a lane…` cases fail on the answers — the first with
```
AssertionError: expected 'gpt' to be ''
```
The two structural cases fail with
```
AssertionError: expected '# UNMEASURED RANKS LAST, not first. This was `: "${sc:=0}"` until review' to be '_class_ok "$id" "$cand" || continue'
```
The `_auto_swap_check` describe's first case fails on `expect(h.calls()).not.toContain('DISPATCH gpt')`; its two controls pass already.

- [ ] **Step 3: Write the helper**

In `ccd/ccd`, append immediately AFTER `_lane_unclassified_count`'s closing `}`:

```bash
_class_ok() {   # id wrapper -> success UNLESS the session carries a class that lane cannot run
  # §7's rotation rule, and §15 decision 2 ("skip the lane, never silently
  # downgrade"). THREE ANSWERS, and the split between the last two is the
  # binding ruling of mail 275 item 3:
  #
  #   - no `class` field at all — every row that has not rendered a status bar
  #     since this wave landed — is eligible exactly where it was eligible
  #     before. §7: "Unknown -> '' (carry nothing, today's behaviour)." This
  #     is what keeps the ESCAPE ROUTE open for the whole pre-wave fleet.
  #   - a class this box RECOGNISES, on a lane that provably cannot run it —
  #     ineligible. That is the rule this function exists for.
  #   - a `class` file that EXISTS and is unusable (unreadable, or reading as
  #     something other than the four) — ineligible, loudly. "Routing never
  #     acts on a fold": handing back "eligible" here would rotate a session
  #     whose class nobody knows, which is the defect, and stranding the row
  #     raises `swapblocked` and a banner the operator already reads, with the
  #     path on stderr. An absent field and a torn one are DIFFERENT FACTS and
  #     `_reg_get` cannot tell them apart, which is why this reads through
  #     `_reg_read_class`.
  local c
  # `_reg_read_class`, NEVER `_reg_get` (binding ruling, mail 275 item 3). Its
  # non-zero exit is a FAULT — the file exists and cannot be read, or reads as
  # something that is not one of the four — and the answer to a fault here is to
  # take the destination away, not to hand back "eligible". That strands the row
  # loudly (`swapblocked` + the banner the operator already knows how to read)
  # rather than routing on a fold, which is the ruling's whole point. Note the
  # asymmetry: an ABSENT field means "carry nothing" (§7) and stays eligible;
  # only a field that exists and is wrong takes a lane away.
  c=$(_reg_read_class "$1") || return 1
  [[ -n "$c" ]] || return 0
  _class_available "$2" "$c"
}
```

- [ ] **Step 4: Guard `_swap_target`'s two destination decisions**

**(a)** In `_swap_target`'s home-recovered arm, replace (measured on `ws/clear-meadow`
`ccd/ccd:12068-12069`, i.e. the shape Task 2's rebase brings — locate it by the trailing
`# home recovered: go back` comment, never by the line number)

```bash
    _account_ok "$home" && { [[ -n "$cross_home" ]] || _pool_ok "$home" "$pps"; } \
      && _avail "$home" && { echo "$home"; return 0; }                       # home recovered: go back
```

with

```bash
    # `_class_ok` here for the same reason it is in the candidate loop below:
    # home is a DESTINATION on this branch, not a "stay". A session homed on
    # the overflow lane, moved off it and since seen on a class that lane
    # cannot run, must not be pulled back the instant the lane reports
    # headroom (spec §7).
    #
    # AFTER the pool gate and BEFORE `_avail`, deliberately: the pool gate is
    # #62's and answers "may this row be here at all", which is a prior
    # question; `_avail` is the expensive one (it reads the lane's limits
    # file), and there is no reason to measure headroom on a lane the session
    # cannot use.
    _account_ok "$home" && { [[ -n "$cross_home" ]] || _pool_ok "$home" "$pps"; } \
      && _class_ok "$id" "$home" \
      && _avail "$home" && { echo "$home"; return 0; }                       # home recovered: go back
```

If the rebase in Task 2 landed a different home-recovered arm than the one quoted, keep
its every existing conjunct and insert `_class_ok "$id" "$home" &&` immediately before
`_avail "$home"`. The structural case in Step 1 (`the home-recovered branch carries it
too`) is what proves you did.

**(b)** In `_swap_target`'s candidate loop, append the class filter as the LAST
eligibility rung — the third predicate of the composed chain (skeleton "Rulings round 2"
item 8; A-8). The chain reads, on `ws/clear-meadow`'s committed tip
(`ccd/ccd:12126-12128`):

```bash
    _pool_ok "$cand" "$pps" || continue
    _account_ok "$cand" || continue
    _avail "$cand" || continue
```

Replace it with:

```bash
    _pool_ok "$cand" "$pps" || continue
    _account_ok "$cand" || continue
    _avail "$cand" || continue
    # THE CLASS FILTER (spec §7), and it is the THIRD PREDICATE OF A COMPOSED
    # CHAIN rather than a skip of its own — the ruling's own words. Read this
    # with wave 2b's "The composed rule: an untagged overflow lane is in every
    # pool" section beside it, which is where the interaction the two waves
    # produce together is written down.
    #
    # THE ORDER OF THE THREE, and why this one is last:
    #   1. #61's OVERFLOW BRACKET is the ranking below (`best` for home-able
    #      candidates, `obest` for the rest), and it reads whatever survives
    #      these rungs. One line here therefore filters BOTH brackets; a line
    #      inside either would filter one.
    #   2. #62's POOL PREDICATE (`_pool_ok`, first rung) answers a PRIOR
    #      question — may this row be on this lane at all. Asking about a class
    #      ahead of it would answer about a lane the pool has already refused.
    #   3. CLASS, here: a lane that cannot run this session's class is not a
    #      destination, however it would have scored. `_avail` sits above it
    #      because it is the expensive rung (it reads the lane's limits file)
    #      and there is no reason to measure headroom on a lane the session
    #      cannot use.
    #
    # Today's gpt lane (`fable: null`) therefore never receives a Fable-class
    # session, which is what turns "comes back as Opus" from rare into
    # impossible — including in the composed state wave 2b documents, where the
    # in-pool home-able bracket is empty and the untagged overflow lane is the
    # only candidate left.
    _class_ok "$id" "$cand" || continue
```

If the rebase landed a different rung order, keep every rung it landed and still put
`_class_ok` last; the ruling fixes the filter's position IN THE CHAIN, not a line number.
Step 1's structural case is what proves you did.

- [ ] **Step 5: Guard `_auto_swap_check`'s own re-check**

In `_auto_swap_check`, replace

```bash
  _avail "$target" || return 0
```

with

```bash
  _avail "$target" || return 0
  # The caller's own re-check, beside the availability one it already had.
  # `_swap_target` is not this function's only possible source of a target —
  # the two have been edited apart before — and a mover that cannot say why it
  # chose a lane must at least be able to say the session can run there.
  _class_ok "$id" "$target" || return 0
```

- [ ] **Step 6: Re-stamp and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts test/ccd-account-ok.test.ts test/ccd-auto-swap-hold.test.ts test/ccd-login-screen.test.ts test/ccd-limits.test.ts test/ownership.test.ts
```
Expected: PASS — all six. The four pre-existing rotation suites are in the list because they are the ones that would notice a rescue that stopped finding a destination; none of their rows carries a `class` field, so `_class_ok` answers 0 for all of them.

- [ ] **Step 7: Mutation check — the candidate-loop guard**

Break it, from the repository root:
```bash
sed -i 's@^    _class_ok "$id" "$cand" || continue$@    : # candidate guard removed for the mutation check@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts
```
Expected: FAIL — exactly two cases:
```
 × _swap_target skips a lane that cannot run the session class > skips the overflow lane for a Fable-class session even when it is the only candidate left
   AssertionError: expected 'gpt' to be ''
 × structural: the guard sits in every candidate loop _swap_target has > every `_avail "$cand" || continue` in _swap_target is followed by the class guard
   AssertionError: expected ': # candidate guard removed for the mutation check' to be '_class_ok "$id" "$cand" || continue'
```
Every other case in the file stays green — including "...and still takes it for a class it CAN run", which never needed the guard, and the whole `_auto_swap_check` describe, whose own guard is untouched.

Restore, from the repository root:
```bash
sed -i 's@^    : # candidate guard removed for the mutation check$@    _class_ok "$id" "$cand" || continue@' ccd/ccd
```

- [ ] **Step 8: Mutation check — the home-recovered guard**

The arm is a CONTINUED LINE after Task 2's rebase, so this one is python and not `sed`
— a `sed -i` over one physical line cannot see the conjunct it has to remove.

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '      && _class_ok "$id" "$home" \\\n'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, ''))
MUT
grep -c '_class_ok "$id" "$home"' ccd/ccd
```
Expected: `0` — the guard is gone.

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts
```
Expected: FAIL — exactly two cases:
```
 × _swap_target skips a lane that cannot run the session class > does not send a session home to a lane that cannot run its class
   AssertionError: expected 'gpt' to be ''
 × structural: the guard sits in every candidate loop _swap_target has > the home-recovered branch carries it too
   AssertionError: the home-recovered branch does not skip a lane that cannot run the session class
   expected '_account_ok "$home" && { [[ -n "$cross_home" ]] || _pool_ok "$home" "$pps"; } \ && _avail "$home" && { echo "$home"; return 0; }                       # home recovered: go back' to contain '_class_ok "$id" "$home"'
```

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '      && _avail "$home" && { echo "$home"; return 0; }'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(
    s.replace(old, '      && _class_ok "$id" "$home" \\\n' + old))
MUT
grep -c '_class_ok "$id" "$home"' ccd/ccd
```
Expected: `1`.

- [ ] **Step 9: Mutation check — `_auto_swap_check`'s re-check**

Break it, from the repository root:
```bash
sed -i 's@^  _class_ok "$id" "$target" || return 0$@  : # tick guard removed for the mutation check@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts -t 'refuses a target its own _swap_target picked'
```
Expected: FAIL —
```
AssertionError: expected [ 'DISPATCH gpt' ] not to contain 'DISPATCH gpt'
```
And its positive control stays green, which is what says the case discriminates:
```bash
npx vitest run test/ccd-class-rotation.test.ts -t 'dispatches when the class fits'
```
Expected: PASS (with the mutation still in place).

Restore, from the repository root:
```bash
sed -i 's@^  : # tick guard removed for the mutation check$@  _class_ok "$id" "$target" || return 0@' ccd/ccd
```

- [ ] **Step 10: Mutation check — unknown must carry nothing**

Break it, from the repository root (make `_class_ok` demand a class of every row):
```bash
sed -i 's@^  \[\[ -n "$c" \]\] || return 0$@  [[ -n "$c" ]] || return 1@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts test/ccd-login-screen.test.ts
```
Expected: FAIL — the three "no class" negative controls in the new file
(`is true for a row with no class field at all`, `...and still takes it for a session carrying no class at all`, `dispatches for a session carrying no class`), plus `ccd-login-screen.test.ts`'s "evacuates even though home carries zero telemetry" case, which is the rescue with no destination this polarity exists to protect.

Restore, from the repository root:
```bash
sed -i 's@^  \[\[ -n "$c" \]\] || return 1$@  [[ -n "$c" ]] || return 0@' ccd/ccd
```

- [ ] **Step 11: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-rotation.test.ts test/ccd-account-ok.test.ts test/ccd-auto-swap-hold.test.ts test/ccd-login-screen.test.ts test/ownership.test.ts
```
Expected: PASS.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-class-rotation.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the rotation skips a lane that cannot run the session's class

One guard on _swap_target's eligibility rungs — before any ranking, so it
covers every bracket the ranking may grow — plus the home-recovered branch and
_auto_swap_check's own re-check. A Fable-class session no longer lands on a
lane whose fable slot is null; §15 decision 2 says skip, never downgrade, and
a manual `swap --as-class` is the only way to accept that trade.

Unknown still carries nothing: a row with no class, or a torn one, stays
eligible everywhere it was, because the rescue loop is an escape route.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: the class is recorded at swap, ensure and stop

**Files:**
- Modify: `ccd/ccd` — one new helper `_record_class` (append after `_class_ok`), and one call each in `cmd_swap`, `cmd_ensure` and `cmd_stop`
- Test: `server/test/ccd-class-record.test.ts` (create)

**Idioms copied (read these before writing):**
- `ccd/ccd:1285-1291` `_reg_set` — the atomic registry write (`tmp` + `_plat_mv_notdir`), and its header on why the field name must not appear in a tmp name.
- `ccd/ccd:1293-1300`'s note that `started` has ONE writer while the CALLERS stay authoritative about WHEN. `class` is the same shape: one writer, three deliberate moments.
- `server/test/ccd-reg-claim.test.ts:42-56` — "monotone WITHIN A ROW; the only eraser is `_reg_purge`", and the scan at `:54` that forbids the names `_reg_del` / `_reg_unset`. `_record_class` must never clear the field.
- `ccd/ccd:14736` `cmd_stop`, `ccd/ccd:13391` `cmd_ensure`, `ccd/ccd:14392` `cmd_swap` (all measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase) — where each verb's argv is settled and the row is known to exist.
- `server/test/ccd-refusal-scan.test.ts:19-24` — the `bodyOf(name, until)` slicing idiom this task's structural case copies.

**Interfaces:**
- Consumes: Task 4's `_session_class`.
- Produces: `_record_class <id>` → writes the registry field `class` when, and only when, `_session_class` has an answer; always exits 0. The registry field `class` ∈ `haiku|sonnet|opus|fable` — read by `_spawn_start` (Task 6), `_class_ok` (Task 7) and `cmd_swap`'s gate (Task 9).

---

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-class-record.test.ts`:

```ts
// Spec §7, "Deriving the class", last sentence: "The result is stored in the
// registry as `class` at every swap, `ensure` and `stop`, so a session that
// was last seen on Fable restarts on Fable."
//
// Those three moments are chosen because they are the ones where the pane is
// still alive (swap, stop) or is about to be replaced (ensure) — i.e. the last
// and first instants at which the file the statusline wrote still describes
// the session ccd is about to move.
//
// WRITE-ON-KNOWN ONLY. There is no registry unset in ccd at all
// (`ccd-reg-claim.test.ts` greps this file for one and pins zero hits), and an
// empty answer means "the statusline has not rendered this session", never
// "this session has no class". Clearing on empty would erase a good carry
// every time a session was stopped before its first render.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;
const sh = (s: string): string => h.sh(s);

const UUID = 'deadbeef-0000-4000-8000-000000000000';
const ID = 'claude-demo';

const publishModel = (uuid: string, modelId: string): void => {
  const d = path.join(home, '.cc-sessions', 'model');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, uuid), `${modelId}\n`);
};

const seedRow = (wrapper = 'claude'): void => {
  sh(`_reg_set ${ID} uuid ${UUID}
      _reg_set ${ID} wrapper ${wrapper}
      _reg_set ${ID} workdir '${home}'`);
};

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-class-record-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_record_class', () => {
  it('writes the class the session is currently running', () => {
    seedRow();
    publishModel(UUID, 'claude-fable-5-1');
    sh(`_record_class ${ID}`);
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('leaves an existing value alone when there is no answer to record', () => {
    // The case the write-on-known rule exists for: a session stopped before it
    // ever rendered a status bar must not lose the class it carried in.
    seedRow();
    sh(`_reg_set ${ID} class opus`);
    sh(`_record_class ${ID}`);
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('writes nothing at all for a row that has no class and no model file', () => {
    seedRow();
    sh(`_record_class ${ID}`);
    expect(h.reg(ID, 'class')).toBeNull();
  });

  it('updates a stale value when the session has moved to another class', () => {
    seedRow();
    sh(`_reg_set ${ID} class opus`);
    publishModel(UUID, 'claude-haiku-4-5-20260101');
    sh(`_record_class ${ID}`);
    expect(h.reg(ID, 'class')).toBe('haiku');
  });

  it('is exit-0 even for a row that does not exist', () => {
    // It is called on the argv path of three verbs, two of which accept an id
    // they have not yet proven exists. Under `set -o pipefail` a non-zero here
    // would be a verb that fails for a reason unrelated to what it was asked.
    expect(sh('_record_class no-such-row; echo rc=$?')).toBe('rc=0');
  });
});

describe('the three verbs that record it', () => {
  const bodyOf = (name: string, until: string): string => {
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf(`${name}() {`);
    const to = src.indexOf(`${until}() {`, from);
    expect(from, `ccd/ccd has no ${name}`).toBeGreaterThan(-1);
    expect(to, `ccd/ccd has no ${until} after ${name}`).toBeGreaterThan(from);
    return src.slice(from, to);
  };

  it('cmd_swap, cmd_ensure and cmd_stop each call _record_class', () => {
    // A scan rather than three end-to-end runs, because two of the three
    // verbs' full bodies reach systemd and tmux, and the property being pinned
    // is "the moment is not missed" rather than "the write works" — which the
    // describe above already measures. The pairs are (function, the next
    // function in the file), the ccd-refusal-scan.test.ts slicing idiom.
    for (const [fn, until] of [
      ['cmd_swap', 'cmd_swap_self'],
      ['cmd_ensure', 'cmd_supervise'],
      ['cmd_stop', 'cmd_forget'],
    ] as const) {
      expect(bodyOf(fn, until), `${fn} does not record the session class`)
        .toContain('_record_class "$id"');
    }
  });

  it('cmd_stop records the class before it tears the session down', () => {
    // End-to-end on the cheapest of the three: `_ws_unsupervise` and `tmux`
    // log instead of acting (the ccd-workspaces.test.ts idiom), everything
    // else runs for real.
    seedRow();
    publishModel(UUID, 'claude-fable-5-1');
    const out = sh(`_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };`
      + ` tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; cmd_stop ${ID}`);
    expect(out).toContain(`stopped ${ID}`);
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('cmd_ensure records the class on a session that is already alive', () => {
    seedRow();
    publishModel(UUID, 'claude-opus-5-20260101');
    const out = sh('_alive() { return 0; }; _resupervise_live() { :; };'
      + ` cmd_ensure ${ID}`);
    expect(out).toContain(`alive: ${ID}`);
    expect(h.reg(ID, 'class')).toBe('opus');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `server/`:
```bash
npx vitest run test/ccd-class-record.test.ts
```
Expected: FAIL. The `_record_class` describe throws
```
Command failed: bash -c source ".../ccd/ccd"; _record_class claude-demo
bash: line 1: _record_class: command not found
```
and the structural case fails with
```
AssertionError: cmd_swap does not record the session class
```

- [ ] **Step 3: Write the helper**

In `ccd/ccd`, append immediately AFTER `_class_ok`'s closing `}`:

```bash
_record_class() {   # id — mirror the class the session is CURRENTLY running into the registry
  # §7: recorded at every swap, `ensure` and `stop` — the three moments where
  # the pane is still alive (swap, stop) or about to be replaced (ensure), i.e.
  # the last and first instants at which the file the statusline wrote still
  # describes the session ccd is about to move.
  #
  # WRITE-ON-KNOWN ONLY, and it is not tidiness. There is no registry unset in
  # this file at all — `ccd-reg-claim.test.ts` greps for one and pins zero hits
  # — and an empty answer here means "the statusline has not rendered this
  # session since the model file was introduced", never "this session has no
  # class". Clearing on empty would erase a good carry every time a session was
  # stopped before its first render, which is exactly the row a restart most
  # needs the carry for.
  #
  # ALWAYS EXIT 0: three verbs call it on their argv path, two of them before
  # they have proven the row exists, and ccd runs under `set -o pipefail`.
  local c
  c=$(_session_class "$1")
  [[ -n "$c" ]] && _reg_set "$1" class "$c"
  return 0
}
```

- [ ] **Step 4: Call it from `cmd_stop`**

In `cmd_stop`, replace

```bash
  _lc_done stop "$id" "" dec.surface "$(_lc_surface_norm "$declared")"
```

with

```bash
  # BEFORE the teardown, and that order is the whole point: `_ws_unsupervise`
  # and the pane kill below end the session, and the model file it published is
  # the only record of what it was running. §7's "a session that was last seen
  # on Fable restarts on Fable" is decided here, not at the restart.
  _record_class "$id"
  _lc_done stop "$id" "" dec.surface "$(_lc_surface_norm "$declared")"
```

- [ ] **Step 5: Call it from `cmd_ensure`**

In `cmd_ensure`, replace

```bash
  local id="${1:?usage: ccd ensure <id>}"
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id' (run ccd start first)"
```

with

```bash
  local id="${1:?usage: ccd ensure <id>}"
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id' (run ccd start first)"
  # §7, and it must precede BOTH branches below. On the already-alive branch
  # this is a live session telling the registry what it is running; on the
  # respawn branch it is the last chance to read the model file before
  # `_spawn_start` decides which `--model` to pass. One call, before the fork,
  # rather than one per branch that could later be edited apart.
  _record_class "$id"
```

- [ ] **Step 6: Call it from `cmd_swap`**

In `cmd_swap`, replace

```bash
  [[ -x "$WRAPPER_DIR/$target" ]] || die "wrapper missing: $WRAPPER_DIR/$target"
```

with

```bash
  [[ -x "$WRAPPER_DIR/$target" ]] || die "wrapper missing: $WRAPPER_DIR/$target"
  # §7, and BEFORE the detach arm below: the pane is alive at this instant, so
  # the model file describes this session, and the detached re-entry two
  # seconds later runs against a session that is being killed. Also before
  # anything that can refuse, so a refused swap still leaves the row knowing
  # what it was running.
  _record_class "$id"
```

- [ ] **Step 7: Re-stamp and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-record.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-session-lifecycle.test.ts test/ccd-reg-claim.test.ts test/ccd-refusal-scan.test.ts test/ownership.test.ts
```
Expected: PASS — all seven. (`ccd-reg-claim.test.ts` is in the list for its `_reg_del`/`_reg_unset` scan and its "`_reg_set … started` appears once" count, neither of which this change touches; `ccd-refusal-scan.test.ts` because `cmd_stop`'s body moved.)

- [ ] **Step 8: Mutation check — write-on-known**

Break it, from the repository root:
```bash
sed -i 's@^  \[\[ -n "$c" \]\] \&\& _reg_set "$1" class "$c"$@  _reg_set "$1" class "$c"@' ccd/ccd
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-record.test.ts -t 'leaves an existing value alone'
```
Expected: FAIL —
```
AssertionError: expected '' to be 'opus'
```
— the empty answer overwrote a good carry.

Restore, from the repository root:
```bash
sed -i 's@^  _reg_set "$1" class "$c"$@  [[ -n "$c" ]] \&\& _reg_set "$1" class "$c"@' ccd/ccd
```

- [ ] **Step 9: Mutation check — the moment in `cmd_stop` is before the teardown**

Break it, from the repository root — delete `cmd_stop`'s call, identified by its unique two-line neighbour (the bare string `_record_class "$id"` appears three times, once per verb):
```bash
python3 - <<'PY'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  _record_class "$id"\n  _lc_done stop "$id" "" dec.surface'
new = '  _lc_done stop "$id" "" dec.surface'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-record.test.ts -t 'cmd_stop records the class'
```
Expected: FAIL —
```
AssertionError: expected null to be 'fable'
```
and the structural case fails too:
```bash
npx vitest run test/ccd-class-record.test.ts -t 'each call _record_class'
```
Expected: FAIL — `AssertionError: cmd_stop does not record the session class`.

Restore, from the repository root:
```bash
python3 - <<'PY'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  _lc_done stop "$id" "" dec.surface'
new = '  _record_class "$id"\n  _lc_done stop "$id" "" dec.surface'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
```

- [ ] **Step 10: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-class-record.test.ts test/ccd-swap.test.ts test/ownership.test.ts
```
Expected: PASS.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-class-record.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): record the session's class at swap, ensure and stop

The three moments §7 names, and the three where the model file the statusline
published still describes the session ccd is about to move. Write-on-known
only: ccd has no registry unset, and an empty answer means "not rendered yet",
never "no class" — clearing on empty would erase the carry from exactly the
row a restart most needs it for.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: `ccd swap <id> <wrapper> --as-class <class>`, and the refusal without it

**Files:**
- Modify: `ccd/ccd` — `cmd_swap`'s flag loop, the class gate after the pre-flight validations, and the two places the detach arm re-spells the command
- Test: `server/test/ccd-swap-as-class.test.ts` (create)
- Test: `agent/test/whitelist.test.ts` — one case that the new flag rides the existing grant

**Idioms copied (read these before writing):**
- `ccd/ccd:14420-14427` — `cmd_swap`'s flag loop (`--force)` at `:14423`, `--cross-pool)` at `:14424`; measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase), and its header's rule: "Flags are stripped BEFORE the positional parse, so `ccd swap <id> <target> --force` and `ccd swap --force <id> <target>` mean the same thing and neither lets `--force` land in `$1` or `$2`".
- `ccd/ccd:14758-14760` — `cmd_stop`'s `--surface` arm (measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase): the EXPLICIT arity check in front of `shift 2` ("ccd runs under `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails, shifts nothing, and this loop never terminates"), and the `--surface=*` sibling arm. `--as-class` copies both.
- `ccd/ccd:924` `die() { echo "ccd: $*" >&2; exit 1; }` — every pre-teardown refusal in `cmd_swap` is a `die` (`unknown wrapper`, `no registry for`, `already on`, `wrapper missing`). The class gate joins them because, like them, it runs before anything has been torn down. `_swap_refuse` is for a swap that has already stopped the unit; this is not one. (`cmd_swap` is NOT one of `ccd-refusal-scan.test.ts`'s four scanned verbs, so no refusal record is required.)
- `ccd/ccd:14499` — the detached re-entry's command string and its `${force:+--force} ${cross:+--cross-pool}` idiom (measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase). **#62 already put a second flag through this string**, so `--as-class` follows a shape that exists rather than inventing one; the retry sentence at `:14501` carries the same flags and must carry `--as-class` too.
- `server/test/ccd-swap.test.ts:30-38` — the `SWAP` stub set and `{ TMUX: '' }` at the call site: "so the detached-self-swap branch — which re-execs ccd under `systemd-run` — can never be taken from a suite that may itself be running inside tmux".
- `server/test/ccd-spawn-split.test.ts:33-43` `shStatus` — the ONLY way to observe a `die`: no `$( )`, no `( )`, no trailing `; :`, and `exec 2>&1` merges the streams by rebinding the current shell's fd.
- `agent/src/whitelist.ts:323` — `['swap']` is a one-token PREFIX grant, and `swap` is absent from `REQUIRED_VERB_FLAG` (`agent/src/whitelist.ts:240-242`), so tokens after it are unconstrained. **No new grant is added by this task**; the test below is what says so out loud.

**Interfaces:**
- Consumes: Task 4's `_is_class` and `CCD_CLASSES`, Task 5's `_class_available` / `_lane_classes`, Task 8's `_record_class`.
- Produces: `ccd swap [--force] [--as-class <class>] <id> <target-wrapper>` — exit 1 with a named remedy when the carried class cannot run on the target and no `--as-class` was given.

**`cmd_swap_self` is deliberately NOT widened.** `ccd swap-self <target>` (`ccd/ccd:14655`, measured on `ws/clear-meadow`'s tip `9e9ebd1c`, the post-#62 shape Task 2's rebase brings; locate it by its text after the rebase) takes one positional and forwards it as `cmd_swap "$id" "$target"`, so a self-swap onto a lane that cannot run the session's class now REFUSES — which is the correct answer, and the remedy the refusal prints (`Re-run with --as-class <class>`) works from outside the session, where a swap-self's caller is about to be killed anyway. Do not add a second flag surface to that verb as part of this task; §10 names the flag on `swap` alone.

---

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-swap-as-class.test.ts`:

```ts
// Spec §7, "Manual swap may downgrade, explicitly":
//
//   `ccd swap <id> <wrapper> --as-class <c>` sets the class before spawning;
//   the PWA's SwapSheet offers it when C is unavailable on the chosen lane,
//   naming the substitute. Without the flag the swap refuses with the same
//   sentence.
//
// The gate runs BEFORE any teardown — the same place `cmd_swap`'s other
// pre-flight refusals run — so a refusal costs nothing and leaves the session
// alive on the account that still holds its history. That is why it is a
// `die` and not a `_swap_refuse`: nothing has been stopped, so there is no
// banner to raise and no restart to perform.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const ID = 'claude-demo';

/** systemd and tmux log instead of acting; `sleep` is stubbed because
 *  cmd_swap's flush wait is a second of real time per case. TMUX is emptied at
 *  the call site so the detached-self-swap branch can never be taken from a
 *  suite that may itself be running inside tmux. */
const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; };'
  + ' tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';

/** `h.sh`, minus the two things that make it unable to see a fatal `die`: it
 *  throws on non-zero and gives back no status. Nothing may wrap the snippet —
 *  `exit` inside `$( )` or `( )` kills only that subshell and the assertion
 *  would pass either way. `exec 2>&1` rebinds this shell's fd and starts no
 *  subshell. (ccd-spawn-split.test.ts's idiom, verbatim.) */
const shStatus = (snippet: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: home,
        env: ghContainedEnv(home, { ...process.env, HOME: home, TMUX: '', ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const publishModel = (uuid: string, modelId: string): void => {
  const d = path.join(home, '.cc-sessions', 'model');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, uuid), `${modelId}\n`);
};

const seedClasses = (
  account: string, ids: Record<string, string>, retired: readonly string[] = [],
): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`),
    `${['haiku', 'sonnet', 'opus', 'fable'].map((c) => {
      const id = ids[c] ?? '';
      // The THIRD column is the whole point: `unassigned` iff there is no id,
      // otherwise `retired` when the caller says the provider stopped listing
      // it, otherwise `assigned`. ccd branches on this word and on nothing
      // else — an id with no state word is not a state ccd can produce.
      const state = id === '' ? 'unassigned' : (retired.includes(c) ? 'retired' : 'assigned');
      return `${c}\t${id}\t${state}`;
    }).join('\n')}\n`);
};

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

const GPT_TODAY = { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' };

/** The registry row cmd_swap reads, on the home-able upstream account. */
const seedRow = (): void => {
  const wd = path.join(home, 'projects', 'demo');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir ${wd}`);
};

/** The lane every refusal case targets: installed, enabled, three classes,
 *  no fable — today's gpt lane exactly (spec §6.2). */
const seedGptLane = (): void => { install('gpt'); seedClasses('gpt', GPT_TODAY); };

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-as-class-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('a swap that would change the session model refuses, and says what to do', () => {
  it('refuses a Fable-class session onto a lane with no fable-class model', () => {
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    const r = shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("'gpt' has no fable-class model");
    expect(r.out).toContain('--as-class');
    // The remedy names what IS available, so the operator does not have to go
    // and look it up.
    expect(r.out).toContain('haiku sonnet opus');
  });

  it('leaves the session exactly where it was — nothing is torn down', () => {
    // The gate runs before `_svc_stop` and the pane kill, so a refusal costs
    // nothing: the registry still names the source account and no systemd call
    // was made at all.
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(h.calls()).toEqual([]);
    expect(h.systemctlCalls()).toEqual([]);
  });

  it('records the class it refused over, so the row still knows what it was running', () => {
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('says so differently when the lane has no classified models at all', () => {
    seedRow(); install('gpt');
    publishModel(UUID, 'claude-fable-5-1');
    const r = shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("'gpt' has no fable-class model");
    expect(r.out).toContain('none');
  });

  it('refuses onto a class the destination has RETIRED, not only an unassigned one', () => {
    // §4.3: a retired class is unavailable for routing until the operator
    // reassigns, and this is the routing gate a human stands in front of. The
    // slot is not empty — `gpt-5.6-sol` is still in column 2 — so a gate that
    // asked "does this class have an id" would let the swap through and land
    // the session on a model the provider no longer serves.
    seedRow(); install('gpt');
    seedClasses('gpt', GPT_TODAY, ['opus']);
    publishModel(UUID, 'claude-opus-5-20260101');
    const r = shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("'gpt' has no opus-class model");
    expect(r.out).toContain('haiku sonnet');
  });

  it('does not refuse when the class fits', () => {
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-opus-5-20260101');
    const r = shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(r.out).not.toContain('--as-class');
    // It goes on to the ordinary transcript pre-flight, which has nothing to
    // find in this fixture — that refusal is `cmd_swap`'s own and predates
    // this task.
    expect(r.out).toContain(`no transcript found for ${UUID}`);
  });

  it('does not refuse a session carrying no class', () => {
    seedRow(); seedGptLane();
    const r = shStatus(`${SWAP} cmd_swap ${ID} gpt`);
    expect(r.out).not.toContain('--as-class');
    expect(r.out).toContain(`no transcript found for ${UUID}`);
  });

  it('does not refuse a swap onto a home-able lane, which can run all four', () => {
    seedRow();
    publishModel(UUID, 'claude-fable-5-1');
    const r = shStatus(`${SWAP} cmd_swap ${ID} claude-d`);
    expect(r.out).not.toContain('--as-class');
    expect(r.out).toContain(`no transcript found for ${UUID}`);
  });
});

describe('--as-class is the operator accepting the change, explicitly', () => {
  it('sets the class and lets the swap proceed', () => {
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    const r = shStatus(`${SWAP} cmd_swap --as-class opus ${ID} gpt`);
    expect(r.out).not.toContain("has no fable-class model");
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('is position-independent, exactly as --force is', () => {
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    shStatus(`${SWAP} cmd_swap ${ID} gpt --as-class opus`);
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('takes the --as-class=<c> spelling too', () => {
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    shStatus(`${SWAP} cmd_swap --as-class=sonnet ${ID} gpt`);
    expect(h.reg(ID, 'class')).toBe('sonnet');
  });

  it('never lets the flag land in the positional slots', () => {
    // The rule cmd_swap's header states for --force: with the flag left in
    // argv, `$1`/`$2` become the flag and the swap aims at a session or a
    // wrapper that does not exist.
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    const r = shStatus(`${SWAP} cmd_swap --as-class opus ${ID} gpt`);
    expect(r.out).not.toContain("unknown wrapper '--as-class'");
    expect(r.out).not.toContain("no registry for '--as-class'");
  });

  it('refuses a word that is not one of the four classes', () => {
    seedRow(); seedGptLane();
    const r = shStatus(`${SWAP} cmd_swap --as-class ultra ${ID} gpt`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("unknown class 'ultra'");
    expect(r.out).toContain('haiku sonnet opus fable');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('refuses a class the DESTINATION cannot run either', () => {
    // `--as-class fable` onto today's gpt lane is the same impossible thing
    // the bare swap refuses; the flag is consent to a downgrade, not a
    // licence to name a model that is not there.
    seedRow(); seedGptLane();
    const r = shStatus(`${SWAP} cmd_swap --as-class fable ${ID} gpt`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("'gpt' has no fable-class model");
    expect(r.out).toContain('ccrc models gpt set-class fable');
  });

  it('refuses a bare --as-class with nothing after it, without hanging', () => {
    // The arity check in front of `shift 2`: ccd runs under `set -uo
    // pipefail` with no `-e`, so a shift past the end of argv shifts nothing
    // and the loop spins forever. A 20s test timeout is how that failure
    // would otherwise present.
    seedRow();
    const r = shStatus(`${SWAP} cmd_swap ${ID} gpt --as-class`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('usage: ccd swap');
    expect(r.out).toContain('--as-class');
  });
});

describe('the detached self-swap carries the flag through', () => {
  it('re-spells --as-class in the command it hands systemd-run', () => {
    // The detached process re-enters cmd_swap in a FRESH shell two seconds
    // later, where it runs `_record_class` again against a session that is
    // being killed. Without the flag on that command line the operator's
    // choice would be silently re-derived away.
    seedRow(); seedGptLane();
    publishModel(UUID, 'claude-fable-5-1');
    const r = shStatus(
      `${SWAP} _svc_run_detached() { echo "detached: $*" >> "$HOME/ccd-calls"; };`
      + ` tmux() { case "$1" in display-message) echo "cc-${ID}" ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };`
      + ` cmd_swap --as-class opus ${ID} gpt`,
      { TMUX: '/tmp/x,1,0' });
    expect(r.status).toBe(0);
    const detached = h.calls().find((c) => c.startsWith('detached:'));
    expect(detached, 'the self-swap arm was not taken').toBeTruthy();
    expect(detached!).toContain("--as-class 'opus'");
    expect(detached!).toContain(`'${ID}'`);
    expect(detached!).toContain("'gpt'");
  });
});
```

- [ ] **Step 2: Write the whitelist case**

In `agent/test/whitelist.test.ts`, inside the existing `describe('whitelist.isExecAllowed', …)`, append:

```ts
  it("allows `ccd swap … --as-class <class>` on the existing one-token prefix", () => {
    // Spec §10 adds a FLAG to an existing verb, not a verb. `ccd: [['swap']]`
    // is a one-token prefix and `swap` is absent from REQUIRED_VERB_FLAG, so
    // tokens after it are unconstrained — this task adds NO grant, and this
    // case is what says so out loud rather than leaving a reader to infer it
    // from the absence of a diff.
    expect(isExecAllowed('ccd', ['swap', 'claude-demo', 'gpt', '--as-class', 'opus'])).toBe(true);
    expect(isExecAllowed('ccd', ['swap', '--as-class', 'opus', 'claude-demo', 'gpt'])).toBe(true);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts
```
Expected: FAIL. The refusal cases fail because the swap proceeds —
```
AssertionError: expected 'ccd: no transcript found for b7001948-… under claude' to contain "'gpt' has no fable-class model"
```
The `--as-class` cases fail on the flag landing in a positional —
```
AssertionError: expected 1 to be 0
…
ccd: unknown wrapper '--as-class' (valid: claude claude-a claude-b gpt claude-d)
```

Run, from `agent/`:
```bash
npx vitest run test/whitelist.test.ts
```
Expected: PASS — the new case passes immediately, because the grant already covers it. That is the point of the case, and it is written here rather than skipped so a future narrowing of the `swap` grant reds it.

- [ ] **Step 4: Add the flag to the parse loop**

In `cmd_swap`, replace the flag-stripping loop (measured on `ws/clear-meadow`
`ccd/ccd:14420-14428` — the shape Task 2's rebase brings; `--cross-pool` is #62's own
flag and this task must keep it)

```bash
  local force="" cross="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)      force=1; shift ;;
      --cross-pool) cross=1; shift ;;
      --)      shift; args+=("$@"); break ;;
      *)       args+=("$1"); shift ;;
    esac
  done
```

with

```bash
  local force="" cross="" asclass="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)      force=1; shift ;;
      --cross-pool) cross=1; shift ;;
      # An EXPLICIT arity check, not a bare `shift 2` — cmd_stop's `--surface`
      # arm and its reason, verbatim: ccd runs under `set -uo pipefail` with NO
      # `-e`, so a shift past the end of argv fails, shifts NOTHING, and this
      # loop never terminates. `--force` and `--cross-pool` above take no
      # operand and so need no such check; this is the first flag on this verb
      # that does.
      --as-class)   [[ $# -ge 2 ]] || die "usage: ccd swap [--force] [--cross-pool] [--as-class <class>] <id> <target-wrapper>"
                    asclass="$2"; shift 2 ;;
      --as-class=*) asclass="${1#--as-class=}"; shift ;;
      --)      shift; args+=("$@"); break ;;
      *)       args+=("$1"); shift ;;
    esac
  done
```

This loop's own header states why it must stay ABOVE the `local id=… target=…` reads:
once it has run, nothing downstream on this verb sees a flag sitting in `$1` or `$2`.
`--as-class` inherits that property and adds nothing to it.

And update the two `${1:?…}` usage strings on the line below `set -- "${args[@]}"`:

```bash
  local id="${1:?usage: ccd swap [--force] [--cross-pool] [--as-class <class>] <id> <target-wrapper>}" target="${2:?usage: ccd swap [--force] [--cross-pool] [--as-class <class>] <id> <target-wrapper>}"
```

- [ ] **Step 5: Add the class gate**

In `cmd_swap`, replace the `_record_class "$id"` block Task 8 added — i.e.

```bash
  [[ -x "$WRAPPER_DIR/$target" ]] || die "wrapper missing: $WRAPPER_DIR/$target"
  # §7, and BEFORE the detach arm below: the pane is alive at this instant, so
  # the model file describes this session, and the detached re-entry two
  # seconds later runs against a session that is being killed. Also before
  # anything that can refuse, so a refused swap still leaves the row knowing
  # what it was running.
  _record_class "$id"
```

with

```bash
  [[ -x "$WRAPPER_DIR/$target" ]] || die "wrapper missing: $WRAPPER_DIR/$target"
  # §7, and BEFORE the detach arm below: the pane is alive at this instant, so
  # the model file describes this session, and the detached re-entry two
  # seconds later runs against a session that is being killed. Also before
  # anything that can refuse, so a refused swap still leaves the row knowing
  # what it was running.
  _record_class "$id"
  # THE CLASS GATE (spec §7, "Manual swap may downgrade, explicitly"). Order:
  # record what the session IS running, let the operator's `--as-class`
  # override it, then ask the destination whether it can run the result.
  #
  # A `die`, not a `_swap_refuse`. Every other refusal above this line is one
  # too, for the same reason: nothing has been torn down yet — no unit stopped,
  # no pane killed — so the session is alive on the account that still holds
  # its history, and there is no banner to raise and no restart to perform. A
  # `swapblocked` stamp here would also gate a legitimate auto-rescue for
  # SWAPBLOCK_COOLDOWN seconds over a refusal that has nothing to do with
  # carrying a conversation.
  #
  # AND IT REFUSES RATHER THAN DOWNGRADING, which is §15 decision 2 applied to
  # the one path a human is standing in front of: "comes back as Opus" is the
  # defect, and quietly doing it because a human typed the command does not
  # make it less of one. `--as-class` is the operator saying the sentence out
  # loud.
  local swapcls avail=""
  if [[ -n "$asclass" ]]; then
    _is_class "$asclass" || die "unknown class '$asclass' (valid: ${CCD_CLASSES[*]})"
    avail=$(_lane_classes "$target")
    _class_available "$target" "$asclass" \
      || die "'$target' has no $asclass-class model (available on $target: ${avail:-none}) — classify one with: ccrc models $target set-class $asclass <modelId>"
    _reg_set "$id" class "$asclass"
  fi
  # `_reg_read_class`, NEVER `_reg_get` (binding ruling, mail 275 item 3): a
  # swap that routed on a fold is exactly the "comes back as Opus" defect, and
  # this is the one path a human is standing in front of.
  swapcls=$(_reg_read_class "$id") || die "refusing to swap $id: its recorded class is unusable (see above)"
  if [[ -n "$swapcls" ]] && ! _class_available "$target" "$swapcls"; then
    avail=$(_lane_classes "$target")
    die "'$target' has no $swapcls-class model — the swap would silently change the model this session runs. Re-run with --as-class <class> (available on $target: ${avail:-none})"
  fi
```

- [ ] **Step 6: Carry the flag through the detached re-entry**

In `cmd_swap`'s self-swap arm, replace

```bash
    if ! _svc_run_detached bash -c "sleep 2; CCD_SWAP_DETACHED=1 exec '$HOME/.local/bin/ccd' swap ${force:+--force} ${cross:+--cross-pool} '$id' '$target' >>'$REG/swap.log' 2>&1"; then
```

with

```bash
    # `$asclass` rides along for the same reason `$force` does, and for a
    # sharper one: the detached process re-enters this function in a fresh
    # shell and runs `_record_class` again, against a session that is by then
    # being killed. Without the flag on this command line the operator's
    # explicit choice would be silently re-derived away. The value is validated
    # against CCD_CLASSES above, so it is one of four literals here.
    if ! _svc_run_detached bash -c "sleep 2; CCD_SWAP_DETACHED=1 exec '$HOME/.local/bin/ccd' swap ${force:+--force} ${cross:+--cross-pool} ${asclass:+--as-class '$asclass'} '$id' '$target' >>'$REG/swap.log' 2>&1"; then
```

and, three lines below, replace the operator-facing retry line

```bash
      echo "ccd: could not detach the swap of $id ($cur -> $target): systemd-run failed. Nothing was moved and this session is untouched — retry from OUTSIDE the session: ccd swap ${force:+--force }${cross:+--cross-pool }$id $target" >&2
```

with

```bash
      echo "ccd: could not detach the swap of $id ($cur -> $target): systemd-run failed. Nothing was moved and this session is untouched — retry from OUTSIDE the session: ccd swap ${force:+--force }${cross:+--cross-pool }${asclass:+--as-class $asclass }$id $target" >&2
```

- [ ] **Step 7: Re-stamp and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-swap-carry.test.ts test/ccd-class-record.test.ts test/ownership.test.ts
```
Expected: PASS — all six.

Run, from `agent/`:
```bash
npx vitest run test/whitelist.test.ts test/whitelist-noghosts.test.ts test/whitelist-structural.test.ts
```
Expected: PASS — all three.

- [ ] **Step 8: Mutation check — the refusal itself**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  if [[ -n "$swapcls" ]] && ! _class_available "$target" "$swapcls"; then'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, '  if false; then'))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts -t 'refuses a Fable-class session'
```
Expected: FAIL —
```
AssertionError: expected 1 to be 0
```
followed by the message assertion — the swap ran on past the gate to its ordinary transcript refusal.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  if false; then'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  if [[ -n "$swapcls" ]] && ! _class_available "$target" "$swapcls"; then'))
MUT
```

- [ ] **Step 9: Mutation check — `--as-class` must not admit a class the destination lacks**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '    _class_available "$target" "$asclass" \\\n      || die '
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, '    true \\\n      || die ', 1))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts -t 'refuses a class the DESTINATION cannot run'
```
Expected: FAIL —
```
AssertionError: expected 1 to be 0
```
— `--as-class fable` was accepted onto a lane whose fable slot is null, which is the very state `_spawn_start` then has to work around.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '    true \\\n      || die '
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '    _class_available "$target" "$asclass" \\\n      || die ', 1))
MUT
```

- [ ] **Step 10: Mutation check — the arity check in front of `shift 2`**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '      --as-class)   [[ $# -ge 2 ]] || die "usage: ccd swap [--force] [--as-class <class>] <id> <target-wrapper>"\n                    asclass="$2"; shift 2 ;;'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '      --as-class)   asclass="${2:-}"; shift 2 ;;'))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts -t 'bare --as-class with nothing after it'
```
Expected: FAIL — the case times out at the suite's 20s ceiling:
```
Error: Test timed out in 20000ms.
```
which is exactly how a `while` loop that shifts nothing presents.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '      --as-class)   asclass="${2:-}"; shift 2 ;;'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '      --as-class)   [[ $# -ge 2 ]] || die "usage: ccd swap [--force] [--as-class <class>] <id> <target-wrapper>"\n'
  '                    asclass="$2"; shift 2 ;;'))
MUT
```

- [ ] **Step 11: Mutation check — the flag reaches the detached re-entry**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = "swap ${force:+--force} ${asclass:+--as-class '$asclass'} '$id' '$target'"
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, "swap ${force:+--force} '$id' '$target'"))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts -t 're-spells --as-class'
```
Expected: FAIL —
```
AssertionError: expected "detached: bash -c sleep 2; CCD_SWAP_DETACHED=1 exec '…/ccd' swap  'claude-demo' 'gpt' >>'…/swap.log' 2>&1" to contain "--as-class 'opus'"
```

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = "swap ${force:+--force} '$id' '$target'"
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  "swap ${force:+--force} ${asclass:+--as-class '$asclass'} '$id' '$target'"))
MUT
```

- [ ] **Step 12: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-swap-as-class.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ownership.test.ts
```
Expected: PASS.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-swap-as-class.test.ts agent/test/whitelist.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): swap refuses a silent model change, and --as-class is the consent

A manual swap onto a lane that cannot run the session's class now refuses
before anything is torn down, naming the classes that lane does have; passing
--as-class is the operator saying the substitution out loud. The flag rides
the existing one-token `swap` grant, so the agent whitelist is unchanged —
asserted rather than left to be inferred from a missing diff.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: the `ccd ls` lane line grows the classes

**Files:**
- Modify: `ccd/ccd` — one new helper `_lane_class_note` (append after `_record_class`), and `cmd_ls`'s lane line
- Test: `server/test/ccd-ls-lane-classes.test.ts` (create)

**Idioms copied (read these before writing):**
- `ccd/ccd:14151` — `cmd_ls`'s lane line, and the comment that owns the footer above it: the lane is "the one place a lane is still named, and deliberately", the footer is skipped entirely when the roster has no `gpt` account, and `_gpt_status`'s exact strings are pinned elsewhere.
- `server/test/ccd-limits.test.ts` — the cases that pin `_gpt_status`'s strings verbatim (`_gpt_status` itself is `ccd/ccd:1255`) (`'enabled, available'`, `'Codex weekly cap reached (99%, resets in 2h)'`, …). **This task must not change any of them.**
- `server/test/ccd-session-state.test.ts:434-446` — `'gpt overflow lane: not installed  —  0 session(s) currently on it'`, asserted with `toContain` and with TWO spaces on each side of the em dash. **That spacing is load-bearing and stays.** The class note is inserted between `_gpt_status`'s output and the `  —  `, exactly where spec §7's example puts it, and it is EMPTY when the lane has no classes file — which is the state that test's fixture is in.
- Spec §7, last bullet, for the target string:
  `gpt overflow lane: enabled, available (classes: haiku sonnet opus; fable unassigned; 4 unclassified) — 0 session(s) currently on it`

**Interfaces:**
- Consumes: Task 5's `_lane_classes` and `_lane_unclassified_count`; Task 4's `CCD_MODELS_DIR` and `_is_class`.
- Produces: `_lane_class_note <wrapper>` → echoes ` (classes: …)` with a LEADING space, or nothing when the lane has no classes file. Plan 3a's doctor check reads none of this; the note is `ccd ls`'s alone.

---

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-ls-lane-classes.test.ts`:

```ts
// Spec §7, last bullet: "`ccd ls`'s lane line grows the available classes:
//
//   gpt overflow lane: enabled, available (classes: haiku sonnet opus; fable
//   unassigned; 4 unclassified) — 0 session(s) currently on it"
//
// THE NOTE IS EMPTY WHEN THERE IS NOTHING TO SAY, and that is not tidiness:
// `ccd-session-state.test.ts` asserts the trailer verbatim on a fixture with
// no classes file, and `ccd-limits.test.ts` pins every one of `_gpt_status`'s
// eight sentences. Neither may move. The note is a suffix on `_gpt_status`'s
// output, inserted where §7's example puts it, and it collapses to nothing on
// a lane nobody has classified — which is every fixture that predates this
// wave.
//
// RETIRED CLASSES ARE NAMED HERE TOO. §4.3 says a retired id is "a warning on
// every surface", and `ccd ls` is a surface; a class silently missing from the
// list with no reason given is the one shape that would send an operator to
// re-read the roster and find nothing wrong with it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;
const sh = (s: string): string => h.sh(s);

/** One catalogue model, spec §4.2's shape; the return type is inferred so the
 *  filters below can read `m.id` as a string. */
const model = (id: string, hidden = false) => ({
  id, label: id.toUpperCase(), context: 272_000, maxContext: 272_000,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], hidden, priceIn: null, priceOut: null,
});

/** Today's Codex catalogue as spec §1 measured it, trimmed to the ids these
 *  assertions name: three classed, four unclassified, one hidden. */
const CODEX = {
  probe: 'codex', fetchedAt: 1_789_000_000, stale: false,
  models: [model('gpt-5.6-luna'), model('gpt-5.6-terra'), model('gpt-5.6-sol'),
    model('gpt-6-astra'), model('gpt-5.5'), model('gpt-5.4-mini'),
    model('gpt-5.3-codex-spark'), model('gpt-reserve', true)],
};

const seedCatalogue = (account: string, cat: unknown): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.json`), JSON.stringify(cat));
};

const seedClasses = (
  account: string, ids: Record<string, string>, retired: readonly string[] = [],
): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`),
    `${['haiku', 'sonnet', 'opus', 'fable'].map((c) => {
      const id = ids[c] ?? '';
      // The THIRD column is the whole point: `unassigned` iff there is no id,
      // otherwise `retired` when the caller says the provider stopped listing
      // it, otherwise `assigned`. ccd branches on this word and on nothing
      // else — an id with no state word is not a state ccd can produce.
      const state = id === '' ? 'unassigned' : (retired.includes(c) ? 'retired' : 'assigned');
      return `${c}\t${id}\t${state}`;
    }).join('\n')}\n`);
};

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

const GPT_TODAY = { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' };

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ls-classes-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_lane_class_note', () => {
  it('is empty for a lane with no classes file — every fixture predating this wave', () => {
    install('gpt');
    expect(sh('_lane_class_note gpt')).toBe('');
  });

  it("is spec §7's sentence for today's gpt lane against today's catalogue", () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seedCatalogue('gpt', CODEX);
    // `sh()` trims, so the leading space the helper emits is not visible here;
    // the composed line below is where it is asserted.
    expect(sh('_lane_class_note gpt'))
      .toBe('(classes: haiku sonnet opus; fable unassigned; 4 unclassified)');
  });

  it('emits the leading space that joins it to _gpt_status', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('printf "[%s]" "$(_lane_class_note gpt)"'))
      .toBe('[ (classes: haiku sonnet opus; fable unassigned)]');
  });

  it('drops the unclassified count when there is no catalogue to count', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    expect(sh('_lane_class_note gpt')).toBe('(classes: haiku sonnet opus; fable unassigned)');
  });

  it('drops the unassigned clause when all four are classed', () => {
    install('gpt');
    seedClasses('gpt', { ...GPT_TODAY, fable: 'gpt-6-astra' });
    seedCatalogue('gpt', CODEX);
    expect(sh('_lane_class_note gpt'))
      .toBe('(classes: haiku sonnet opus fable; 3 unclassified)');
  });

  it('lists several unassigned classes together', () => {
    install('gpt');
    seedClasses('gpt', { opus: 'gpt-5.6-sol' });
    expect(sh('_lane_class_note gpt')).toBe('(classes: opus; haiku sonnet fable unassigned)');
  });

  it('names a retired model, and drops its class from the available list', () => {
    // §4.3: a retired class id empties nothing; it is a warning on every
    // surface, and the class is unavailable for routing until the operator
    // reassigns. The `retired` STATE WORD is what the materialiser wrote
    // (Plan 1's `classesTsv(registry, catalogue)`); the catalogue here is
    // seeded only so the unclassified count has something to count, and the
    // note's retired clause does not come from it.
    install('gpt');
    seedClasses('gpt', GPT_TODAY, ['opus']);
    seedCatalogue('gpt', { ...CODEX, models: CODEX.models.filter((m) => m.id !== 'gpt-5.6-sol') });
    expect(sh('_lane_class_note gpt'))
      .toBe('(classes: haiku sonnet; fable unassigned; retired: gpt-5.6-sol; 4 unclassified)');
  });

  it('names a retired model even with no catalogue on the box at all', () => {
    // The clause is read out of column 3, so it survives a lane that has been
    // classified and then never re-probed — the state the note would once have
    // been silent in, because retirement used to be computed here.
    install('gpt');
    seedClasses('gpt', GPT_TODAY, ['opus']);
    expect(sh('_lane_class_note gpt'))
      .toBe('(classes: haiku sonnet; fable unassigned; retired: gpt-5.6-sol)');
  });

  it('says `none` rather than nothing when every class is unavailable', () => {
    install('gpt');
    seedClasses('gpt', {});
    expect(sh('_lane_class_note gpt'))
      .toBe('(classes: none; haiku sonnet opus fable unassigned)');
  });
});

describe('ccd ls', () => {
  const ID = 'gpt-demo';

  const seedRow = (wrapper: string): void => {
    h.sh(`_reg_set ${ID} uuid u
      _reg_set ${ID} wrapper ${wrapper}
      _reg_set ${ID} workdir /data/projects/demo
      _reg_set ${ID} started 1`);
  };

  it('prints the lane line exactly as §7 spells it', () => {
    install('gpt');
    seedClasses('gpt', GPT_TODAY);
    seedCatalogue('gpt', CODEX);
    seedRow('gpt');
    const out = sh('_alive() { return 1; }; cmd_ls');
    expect(out).toContain(
      'gpt overflow lane: enabled, available (classes: haiku sonnet opus; fable unassigned; 4 unclassified)'
      + '  —  1 session(s) currently on it');
  });

  it('leaves the trailer byte-identical on a lane with no classes file', () => {
    // The exact string ccd-session-state.test.ts asserts. The class note must
    // be able to add nothing at all, or every fixture in the suite that has
    // never heard of ~/.ccrc/models changes its answer.
    seedRow('claude-d');
    const out = sh('_alive() { return 1; }; cmd_ls');
    expect(out).toContain('gpt overflow lane: not installed  —  0 session(s) currently on it');
  });

  it('keeps _gpt_status\'s own sentence untouched in front of the note', () => {
    install('gpt');
    fs.writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
    seedClasses('gpt', GPT_TODAY);
    seedRow('claude-d');
    const out = sh('_alive() { return 1; }; cmd_ls');
    expect(out).toContain('gpt overflow lane: DISABLED (kill-switch;');
    expect(out).toContain('(classes: haiku sonnet opus; fable unassigned)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `server/`:
```bash
npx vitest run test/ccd-ls-lane-classes.test.ts
```
Expected: FAIL. The `_lane_class_note` cases throw
```
bash: line 1: _lane_class_note: command not found
```
The `ccd ls` cases fail with
```
AssertionError: expected 'ID …\ngpt overflow lane: enabled, available  —  1 session(s) currently on it\n…' to contain 'gpt overflow lane: enabled, available (classes: …'
```
except `leaves the trailer byte-identical…`, which passes already — the negative control.

- [ ] **Step 3: Write the helper**

In `ccd/ccd`, append immediately AFTER `_record_class`'s closing `}`:

```bash
_lane_class_note() {   # wrapper -> " (classes: …)" for `ccd ls`, or "" when the lane has no class data at all
  # §7's last bullet. A SUFFIX on `_gpt_status`'s output, not a rewrite of it:
  # `ccd-limits.test.ts` pins all eight of that function's sentences verbatim
  # and none of them moves here.
  #
  # EMPTY WHEN THERE IS NOTHING TO SAY, and that is load-bearing rather than
  # tidy: `ccd-session-state.test.ts` asserts the whole trailer byte-for-byte
  # on a fixture with no classes file, and every fixture in the suite that
  # predates this wave is in that state.
  #
  # RETIRED IDS ARE NAMED. §4.3 makes a retired id "a warning on every
  # surface", and this is one; a class silently missing from the list with no
  # reason given would send an operator to re-read a registry file that is
  # correct — the provider is what changed.
  #
  # The leading space is the helper's, so the caller composes
  # `$(_gpt_status)$(_lane_class_note gpt)` with no conditional of its own.
  # THE THREE STATE WORDS ARE THE THREE THINGS THIS LINE SAYS, and it reads
  # them rather than re-deriving any of them: `assigned` rows are already in
  # `_lane_classes`' answer, `unassigned` rows are named by CLASS (there is no
  # id to name), and `retired` rows are named by MODEL ID — which is the id the
  # operator has to reassign, and the reason §4.3 keeps it in column 2.
  local w="$1" tsv avail unassigned="" retired="" cls val state n parts
  tsv="$CCD_MODELS_DIR/$w.classes.tsv"
  [[ -r "$tsv" ]] || return 0
  avail=$(_lane_classes "$w")
  while IFS=$'\t' read -r cls val state; do
    _is_class "$cls" || continue
    case "$state" in
      unassigned) unassigned="${unassigned:+$unassigned }$cls" ;;
      retired)    retired="${retired:+$retired }$val" ;;
    esac
  done < "$tsv"
  n=$(_lane_unclassified_count "$w")
  parts="classes: ${avail:-none}"
  [[ -n "$unassigned" ]] && parts="$parts; $unassigned unassigned"
  [[ -n "$retired" ]] && parts="$parts; retired: $retired"
  # A STRING COMPARISON, not `-gt`: `$n` comes out of a file-derived jq run,
  # and `[[ x -gt y ]]` is an arithmetic context (D-299). Nothing here needs to
  # know whether 4 is more than 3 — only whether the count is worth printing,
  # and a printed `0 unclassified` would claim the operator has nothing left
  # to do when the honest answer may be "no catalogue yet".
  [[ -n "$n" && "$n" != 0 ]] && parts="$parts; $n unclassified"
  echo " ($parts)"
}
```

- [ ] **Step 4: Compose it into the lane line**

In `cmd_ls`, replace

```bash
    && echo "gpt overflow lane: $(_gpt_status)  —  $gpt_here session(s) currently on it"
```

with

```bash
    && echo "gpt overflow lane: $(_gpt_status)$(_lane_class_note gpt)  —  $gpt_here session(s) currently on it"
```

- [ ] **Step 5: Re-stamp and run the tests**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-ls-lane-classes.test.ts test/ccd-limits.test.ts test/ccd-session-state.test.ts test/ownership.test.ts
```
Expected: PASS — all four. `ccd-limits.test.ts` and `ccd-session-state.test.ts` are the two files whose verbatim strings this change stands next to.

- [ ] **Step 6: Mutation check — the note must collapse to nothing**

Break it, from the repository root (make the helper answer even with no classes file):
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  tsv="$CCD_MODELS_DIR/$w.classes.tsv"\n  [[ -r "$tsv" ]] || return 0\n  avail='
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  tsv="$CCD_MODELS_DIR/$w.classes.tsv"\n  avail='))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-ls-lane-classes.test.ts test/ccd-session-state.test.ts
```
Expected: FAIL — three cases:
```
 × _lane_class_note > is empty for a lane with no classes file — every fixture predating this wave
   AssertionError: expected '(classes: none)' to be ''
 × ccd ls > leaves the trailer byte-identical on a lane with no classes file
   AssertionError: expected '…gpt overflow lane: not installed (classes: none)  —  0 session(s)…' to contain 'gpt overflow lane: not installed  —  0 session(s) currently on it'
 × ccd ls > replaces the ALIVE column with STATE and leaves the gpt trailer verbatim   (ccd-session-state.test.ts)
   AssertionError: expected '…' to contain 'gpt overflow lane: not installed  —  0 session(s) currently on it'
```

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  tsv="$CCD_MODELS_DIR/$w.classes.tsv"\n  avail='
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  tsv="$CCD_MODELS_DIR/$w.classes.tsv"\n  [[ -r "$tsv" ]] || return 0\n  avail='))
MUT
```

- [ ] **Step 7: Mutation check — the unclassified count is omitted, not printed as zero**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ -n "$n" && "$n" != 0 ]] && parts="$parts; $n unclassified"'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  parts="$parts; ${n:-0} unclassified"'))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-ls-lane-classes.test.ts -t 'drops the unclassified count'
```
Expected: FAIL —
```
AssertionError: expected '(classes: haiku sonnet opus; fable unassigned; 0 unclassified)' to be '(classes: haiku sonnet opus; fable unassigned)'
```
— a lane that has never been probed was reported as fully classified.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  parts="$parts; ${n:-0} unclassified"'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  [[ -n "$n" && "$n" != 0 ]] && parts="$parts; $n unclassified"'))
MUT
```

- [ ] **Step 8: Mutation check — a retired id is named**

Break it, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ -n "$retired" ]] && parts="$parts; retired: $retired"\n'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, ''))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-ls-lane-classes.test.ts -t 'names a retired model'
```
Expected: FAIL —
```
AssertionError: expected '(classes: haiku sonnet; fable unassigned; 4 unclassified)' to be '(classes: haiku sonnet; fable unassigned; retired: gpt-5.6-sol; 4 unclassified)'
```
— the class had vanished from the line with no reason given.

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  [[ -n "$unassigned" ]] && parts="$parts; $unassigned unassigned"\n'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  old + '  [[ -n "$retired" ]] && parts="$parts; retired: $retired"\n'))
MUT
```

- [ ] **Step 9: Re-stamp, re-run, commit**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run test/ccd-ls-lane-classes.test.ts test/ccd-limits.test.ts test/ccd-session-state.test.ts test/ownership.test.ts
```
Expected: PASS.

From the repository root:
```bash
git add ccd/ccd server/test/ccd-ls-lane-classes.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the ls lane line says which classes the lane can run

§7's sentence, as a suffix on _gpt_status rather than a rewrite of it: its
eight pinned strings and the trailer's exact spacing both stand. The note
collapses to nothing on a lane nobody has classified, which is every fixture
that predates this wave, and it names a retired id rather than letting a
class disappear from the list with no reason given (§4.3).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: register ccd as a second reader, and pin that it agrees with `shared/models.ts`

**Files:**
- Create: `server/test/ccd-models-agreement.test.ts`
- Modify: `server/test/single-definition.test.ts` — append one `describe`

**Idioms copied (read these before writing):**
- `server/test/single-definition.test.ts:1218-1221` — `holdersOf(needle)`, and `codeLines(f)` above it: "Prose may discuss the path anywhere; only a LINE OF SHELL is a toucher."
- `server/test/single-definition.test.ts:1332-1400` — the `~/.ccrc/remote-control` describe. It is the exact template: an exact-match holder list with a **comment naming each file and its role**, an "every one of the four resolves to the same file" case that extracts each tool's spelling and compares them as a `Set`, and a per-file spelling COUNT so no tool holds two lines naming the path.
- `server/test/single-definition.test.ts:1332-1338` — the rule this task's agreement test satisfies: when agreement cannot be structural (two tools, two languages), the mechanism that holds it instead is a test that feeds both the same fixtures.
- `server/test/base-url.test.ts` — the repo's model for a `.ts` / `.mjs` twin agreeing on shared fixtures. This task is its cross-LANGUAGE cousin: TypeScript against bash.

**Interfaces:**
- Consumes: everything Tasks 3-10 produced; Plan 1's `shared/models.ts` exports `Registry`, `Catalogue`, `CatalogueModel`, `availableFor(reg, catalogue, anthropic)`, `familyClassOf`, `classOfModel`, and `shared/modelenv.mjs`'s `classesTsv(registry, catalogue)`.
- Produces: nothing new for later tasks. This is the registration the skeleton's convention 5 requires ("a new bash reader of a JSON the server reads must be registered there with an agreement test").

---

- [ ] **Step 1: Write the failing agreement test**

Create `server/test/ccd-models-agreement.test.ts`:

```ts
// THE TWO READERS OF ONE PAIR OF FILES, fed the same fixtures.
//
// `shared/models.ts` computes §4.3's derived states for the server and the
// PWA; `ccd/ccd` computes them again, in bash, on the box, for the spawn line
// and the rotation. They read the same `~/.ccrc/models/<id>.classes.tsv` and
// the same `~/.ccrc/models/<id>.json`, and nothing structural can make them
// agree — two languages, two processes, one of them shipped as a copy under
// `~/.local/bin`. This file is the mechanism that holds it instead, and it is
// what `single-definition.test.ts` names when it registers ccd as the second
// reader.
//
// THE TSV IS WRITTEN BY THE REAL WRITER. Every other test file in this plan
// hand-writes the three columns, deliberately, so each states the format it
// depends on. This one calls `classesTsv(registry, catalogue)` itself — that
// is what makes it an agreement test rather than a second hand-written format
// checked against a first. If the writer's columns ever move, the bash reader
// goes red HERE and nowhere else, which is the point.
//
// The fixtures are the cross-product that matters, not an exhaustive one:
// every class slot state (classed / null), every catalogue state (absent /
// fresh / stale), retirement, and a hidden model that is classed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { classesTsv } from '../../shared/modelenv.mjs';
import { availableFor, familyClassOf, classOfModel } from '../../shared/models.js';
import type { Catalogue, CatalogueModel, Registry } from '../../shared/models.js';

let h: CcdHarness;
let home: string;
const sh = (s: string): string => h.sh(s);

const model = (id: string, hidden = false): CatalogueModel => ({
  id, label: id.toUpperCase(), context: 272_000, maxContext: 272_000,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], hidden, priceIn: null, priceOut: null,
});

const catalogue = (ids: readonly CatalogueModel[], stale = false): Catalogue => ({
  probe: 'codex', fetchedAt: 1_789_000_000, stale, models: [...ids],
});

const ALL = [model('gpt-5.6-luna'), model('gpt-5.6-terra'), model('gpt-5.6-sol'),
  model('gpt-6-astra'), model('gpt-reserve', true)];

/** A registry file for the gpt lane, spec §4.1's shape (skeleton "Rulings
 *  round 2" item 2): `probe` names the DISCOVERY mechanism, `subagent` is an
 *  explicit class name and never a derivation, and `discovery: 'catalogue'` is
 *  the codex default. `subagent` is `haiku` on the all-null fixture because a
 *  `subagent` naming a null slot is refused by `parseRegistry` — the fixture
 *  has to be a registry the validator would accept. */
const registry = (
  classes: Partial<Record<'haiku' | 'sonnet' | 'opus' | 'fable', string>>,
  // Fix round 2A (N11): narrowed to the two classes fix round 1, v2
  // (2026-09-09) allows `subagent` to name — `opus`/`fable` are refused, at
  // write and at render, so a fixture typed to offer them would advertise a
  // value the doctor check's `modelEnvBlock` call throws on.
  subagent: 'haiku' | 'sonnet' = 'sonnet',
): Registry => ({
  probe: 'codex',
  classes: {
    haiku: classes.haiku ?? null, sonnet: classes.sonnet ?? null,
    opus: classes.opus ?? null, fable: classes.fable ?? null,
  },
  subagent,
  discovery: 'catalogue',
});

const GPT_TODAY = { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol' };

/** Writes the two generated files EXACTLY as the materialiser and the probe
 *  write them — `classesTsv` for the first, `JSON.stringify` of the catalogue
 *  for the second — so the bash reader is fed the real artefacts and not a
 *  hand-typed approximation of them. */
const materialise = (account: string, reg: Registry, cat: Catalogue | null): void => {
  const d = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  // The catalogue is passed to `classesTsv` because the THIRD COLUMN is where
  // retirement lands (§4.3, skeleton "Rulings round 2" item 6). ccd never sees
  // that computation — it sees the word — so this call is the only place in
  // the pair where the catalogue and the classes meet.
  fs.writeFileSync(path.join(d, `${account}.classes.tsv`), classesTsv(reg, cat));
  if (cat !== null) fs.writeFileSync(path.join(d, `${account}.json`), JSON.stringify(cat));
};

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

interface Fixture { name: string; registry: Registry; catalogue: Catalogue | null }

const FIXTURES: readonly Fixture[] = [
  { name: 'all four classed, fresh catalogue listing them',
    registry: registry({ ...GPT_TODAY, fable: 'gpt-6-astra' }), catalogue: catalogue(ALL) },
  { name: "today's three, fable null, fresh catalogue",
    registry: registry(GPT_TODAY), catalogue: catalogue(ALL) },
  { name: "today's three, never probed",
    registry: registry(GPT_TODAY), catalogue: null },
  { name: 'one classed id the fresh catalogue has dropped',
    registry: registry(GPT_TODAY), catalogue: catalogue(ALL.filter((m) => m.id !== 'gpt-5.6-sol')) },
  { name: 'the same catalogue, but STALE — nothing is retired',
    registry: registry(GPT_TODAY), catalogue: catalogue(ALL.filter((m) => m.id !== 'gpt-5.6-sol'), true) },
  { name: 'a classed model the catalogue marks hidden',
    registry: registry({ ...GPT_TODAY, fable: 'gpt-reserve' }), catalogue: catalogue(ALL) },
  { name: 'no class at all — every slot null',
    registry: registry({}, 'haiku'), catalogue: catalogue(ALL) },
  { name: 'every classed id retired at once',
    registry: registry(GPT_TODAY), catalogue: catalogue([model('gpt-6-astra')]) },
];

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-models-agree-'); home = h.home; install('gpt'); });
afterEach(() => { h.cleanup(); });

describe('availableFor() and ccd _lane_classes answer identically', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      materialise('gpt', f.registry, f.catalogue);
      const ts = availableFor(f.registry, f.catalogue, false);
      const bash = sh('_lane_classes gpt').split(' ').filter((s) => s !== '');
      expect(bash, `bash and TypeScript disagree on: ${f.name}`).toEqual(ts);
    });
  }

  it('agrees on an Anthropic lane, where the answer is all four and no file is read', () => {
    // `availableFor(null, null, true)` is all four (skeleton "Rulings round 2"
    // item 2: "available = all four is the CALLER's rule for home-able/upstream
    // lanes, implemented once in shared/models.ts as availableFor"), and ccd's
    // `_is_home_able` short-circuit is the bash spelling of the same rule. Fed
    // no files at all, deliberately: both must answer without one.
    const ts = availableFor(null, null, true);
    expect(sh('_lane_classes claude').split(' ')).toEqual(ts);
  });

  it('agrees that an external lane with no registry file has nothing available', () => {
    // `reg === null` → available [] (round 2 item 2), and ccd's unreadable-tsv
    // return is the same answer. This is §13.1's state before
    // `ccrc models gpt init codex` has ever run.
    const ts = availableFor(null, null, false);
    expect(sh('_lane_classes gpt').split(' ').filter((s) => s !== '')).toEqual(ts);
  });
});

describe('familyClassOf and ccd _family_class_of answer identically', () => {
  const IDS = [
    'claude-haiku-4-5-20260101', 'claude-sonnet-5-20260101', 'claude-opus-5-20260101',
    'claude-fable-5-1-20260101', 'claude-fable-5-1', 'gpt-5.6-sol', 'some-model-opus',
    'opusculum-1', 'claude-3-5-sonnet-20241022', '',
  ];
  for (const id of IDS) {
    it(`agrees on ${id === '' ? '(the empty id)' : id}`, () => {
      expect(sh(`_family_class_of '${id}'`)).toBe(familyClassOf(id) ?? '');
    });
  }
});

describe('classOfModel and ccd _session_class answer identically on an external lane', () => {
  const UUID = 'deadbeef-0000-4000-8000-000000000000';
  const CASES: readonly { r: Registry; id: string }[] = [
    { r: registry(GPT_TODAY), id: 'gpt-5.6-sol' },
    { r: registry(GPT_TODAY), id: 'gpt-5.6-luna' },
    { r: registry(GPT_TODAY), id: 'gpt-6-astra' },
    // Two slots naming one model: both readers must pick the FIRST in CLASSES
    // order, which is `sonnet`.
    { r: registry({ sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-terra' }), id: 'gpt-5.6-terra' },
    { r: registry({}, 'haiku'), id: 'gpt-5.6-sol' },
    // A RETIRED id still names its class: `_session_class` answers "what was
    // this session running", and column 3 does not change column 2.
    { r: registry(GPT_TODAY), id: 'gpt-5.6-sol' },
  ];
  for (const [i, c] of CASES.entries()) {
    it(`case ${i}: ${c.id}`, () => {
      materialise('gpt', c.r, i === CASES.length - 1 ? catalogue([model('gpt-6-astra')]) : null);
      fs.mkdirSync(path.join(home, '.cc-sessions', 'model'), { recursive: true });
      fs.writeFileSync(path.join(home, '.cc-sessions', 'model', UUID), `${c.id}\n`);
      sh(`_reg_set demo-a uuid ${UUID}; _reg_set demo-a wrapper gpt`);
      expect(sh('_session_class demo-a')).toBe(classOfModel(c.r, c.id) ?? '');
    });
  }
});
```

- [ ] **Step 2: Run the agreement test**

Run, from `server/`:
```bash
npx vitest run test/ccd-models-agreement.test.ts
```
Expected: PASS. Every function it compares was implemented in Tasks 4 and 5 against the same spec sections `shared/models.ts` was implemented against in Plan 1, so this file is expected to be green on its first run — it exists to stay green, not to turn green.

**If any case is RED, that is the finding this task exists for.** Do not adjust the fixture to match one side. Read `shared/models.ts`'s rule and this plan's Global Constraints, decide which reader is wrong against the spec, fix THAT one, and note in the commit body which of the two moved. The two most likely disagreements, and what the spec says:
- **ordering** — both must emit CLASSES order (`haiku sonnet opus fable`); Global Constraint 1.
- **a stale catalogue** — retires nothing; spec §11. Under round 2 that rule lives in `classesTsv`, so a disagreement here means the WRITER is wrong and the fix is Plan 1's `classesTsv`, not ccd. ccd reading `retired` and excluding the class is correct by construction.
- **an id that is classed twice** — first class in CLASSES order wins, in both readers; Global Constraint 1 again.

- [ ] **Step 3: Write the failing single-definition registration**

Append to the end of `server/test/single-definition.test.ts`:

```ts
// — Model-class registry, plan 2: ccd is the SECOND READER of two generated
//   files, and the one that runs on the box where nothing runs a test suite —
describe('the class-carry files are spelled once per tool', () => {
  // Neither of these files can be shared through a variable. ccd is a COPY
  // under ~/.local/bin; `statusline-command.sh` is installed on its own into
  // ~/.claude and is handed a CLAUDE_CONFIG_DIR and nothing else; and the
  // writer of the models directory is `ccrc`, a third tool. So the agreement
  // is held by these assertions and by
  // `server/test/ccd-models-agreement.test.ts`, which feeds the bash reader
  // and `shared/models.ts` the same fixtures — the mechanism this file's
  // `~/.ccrc/remote-control` describe above establishes for exactly this
  // shape of problem.
  const CCD_PATH = path.join(ccrcRoot, 'ccd', 'ccd');

  it('~/.cc-sessions/model is touched by exactly two bash tools, each named here BY NAME', () => {
    expect(holdersOf('.cc-sessions/model')).toEqual([
      'ccd/ccd',                     // CCD_SESSION_MODEL_DIR — the reader
      'ccd/statusline-command.sh',   // the writer; it has no $REG of its own
    ]);
  });

  it('each of the two spells it on exactly one line of shell', () => {
    // Prose may discuss the path anywhere — both files do, at length; only a
    // LINE OF SHELL is a toucher.
    for (const [f, want] of [
      ['ccd/ccd', 1],                     // CCD_SESSION_MODEL_DIR="$HOME/.cc-sessions/model"
      ['ccd/statusline-command.sh', 1],   // mdir="$HOME/.cc-sessions/model"
    ] as const) {
      const lines = codeLines(path.join(ccrcRoot, f)).filter((l) => l.includes('.cc-sessions/model'));
      expect(lines.length, `${f} names .cc-sessions/model on ${lines.length} lines of shell:\n${lines.join('\n')}`)
        .toBe(want);
    }
  });

  it('and both spellings resolve to the same box path', () => {
    const reader = /^CCD_SESSION_MODEL_DIR="([^"]+)"$/m.exec(readFileSync(CCD_PATH, 'utf8'));
    expect(reader, 'ccd/ccd declares no CCD_SESSION_MODEL_DIR').toBeTruthy();
    const writer = codeLines(path.join(ccrcRoot, 'ccd', 'statusline-command.sh'))
      .find((l) => l.includes('.cc-sessions/model'));
    expect(writer, 'statusline-command.sh never names the directory').toBeTruthy();
    expect(writer!).toContain(reader![1]!);
  });

  it('ccd names ~/.ccrc/models on exactly one line of shell, through CCD_MODELS_DIR', () => {
    // The catalogue and the classes tsv are `ccrc`'s writes and ccd's reads.
    // A second spelling in ccd is how the reader and the writer would come to
    // mean two different directories — and this is the tool that ships as a
    // copy to a box with no test suite on it.
    const lines = codeLines(CCD_PATH).filter((l) => l.includes('.ccrc/models'));
    expect(lines).toEqual(['CCD_MODELS_DIR="$HOME/.ccrc/models"']);
  });

  it('`class` has exactly one reader, and it is the measured one', () => {
    // Binding ruling, mail 275 item 3. `_reg_get` folds absent, unreadable and
    // empty into one empty string, and routing consumes this field — so a
    // second reader that used `_reg_get` would put the fold back on the path
    // this whole helper exists to keep it off. Text, not types: the scan is
    // what stops the ordinary way of adding a fourth reader.
    const code = codeLines(CCD_PATH);
    expect(code.filter((l) => /_reg_get\s+"\$[A-Za-z_0-9]+"\s+class/.test(l)),
      'ccd reads the class field through _reg_get instead of _reg_read_class').toEqual([]);
    expect(code.filter((l) => l.includes('_reg_read_class() {')).length,
      'there is not exactly one definition of _reg_read_class').toBe(1);
    // Three callers, named: `_spawn_start`, `_class_ok`, `cmd_swap`. A fourth
    // is fine — it just has to go through the same helper, which is what the
    // first assertion above holds.
    expect(code.filter((l) => l.includes('_reg_read_class "')).length).toBeGreaterThanOrEqual(3);
  });

  it('the agreement test that makes that second reader safe exists', () => {
    // Convention: a new bash reader of a file the server also reads is
    // registered here WITH an agreement test. Naming the file by path is what
    // stops the registration outliving the mechanism.
    expect(existsSync(path.join(ccrcRoot, 'server', 'test', 'ccd-models-agreement.test.ts'))).toBe(true);
  });

  it('ccd reads those files and never writes them', () => {
    // The materialiser owns both (`ccrc models set-class …`, `ccrc models
    // refresh …`). A write from ccd would be a second writer of the operator's
    // own classification, on the box, with no registry file behind it.
    const body = readFileSync(CCD_PATH, 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => l.includes('$CCD_MODELS_DIR'));
    expect(body.length, 'ccd stopped reading the models directory').toBeGreaterThan(0);
    for (const l of body) {
      expect(l, `ccd writes into the models directory: ${l}`).not.toMatch(/>\s*"\$CCD_MODELS_DIR/);
      expect(l, `ccd writes into the models directory: ${l}`).not.toMatch(/\b(mv|cp|rm|mkdir|tee)\b[^#]*\$CCD_MODELS_DIR/);
    }
  });
});
```

- [ ] **Step 3b: Widen the holder list Plan 1 Task 12 wrote**

`ccd/ccd` now spells `.ccrc/models` on one line of shell, so Plan 1's exact-match
assertion in the `the generated model files, and who reads each one` describe — the one
that reads

```ts
    expect(holdersOf('.ccrc/models')).toEqual([
      'ccd/ccrc',              // _models_litellm / cmd_models — the verbs
      'ccd/ccrc-models-probe', // the writer
    ]);
```

is now RED. That is the guard working, and the fix is to add this plan's row, in
`holdersOf`'s own sort order (`server/test/single-definition.test.ts:1144-1145` sorts the
result). Replace it with:

```ts
    expect(holdersOf('.ccrc/models')).toEqual([
      'ccd/ccd',               // CCD_MODELS_DIR — the class carry's reader (Plan 2)
      'ccd/ccrc',              // _models_litellm / cmd_models — the verbs
      'ccd/ccrc-models-probe', // the writer
    ]);
```

Do **not** turn the list into a pattern: Plan 1's own comment says it grows by name, and
Plan 3a adds `'ccd/ccrc-doctor-checks'` to the same three lines when its doctor check
lands.

- [ ] **Step 3c: Widen the class-enumeration list in the same describe**

The second exact-match list Plan 1 Task 12 left for later plans is the one in
`the four class names are enumerated only where a walk needs the sequence`. `ccd/ccd` now
declares `CCD_CLASSES=(haiku sonnet opus fable)` (Task 4), which is a WALK — `_is_class`,
`_lane_classes`, `_lane_class_note` and the agreement test all iterate it in that order —
so the file belongs in the list rather than being made invisible to the predicate. Its
`MODELS_CORPUS` includes `BASH`, so the case reds the moment Task 4 lands. Add one row,
in the same sorted position `rel` puts it:

```ts
    expect(holders).toEqual([
      'ccd/ccd',               // CCD_CLASSES — the spawn flag, _lane_classes, ccd ls
      'ccd/ccrc',              // MODELS_CLASSES — the usage-error gate
      'deploy/models-op.mjs',  // CLASSES — the mutation walk
      'shared/modelenv.mjs',   // the env block's key order and the TSV's
      'shared/models.mjs',     // the twin's mirrored list
      'shared/models.ts',      // CLASSES — the definition, and FAMILY_TOKENS
    ]);
```

If the run reports a row this plan did not add, do NOT delete it and do NOT loosen the
predicate: read the file it names, and either add it with a comment saying what walks
there or tighten the predicate's word-boundary arm — Plan 1 Task 12 Step 2's instruction,
unchanged.

- [ ] **Step 4: Run it to verify it fails, then passes**

Run, from `server/`:
```bash
npx vitest run test/single-definition.test.ts
```
Expected: PASS **after Steps 3b and 3c**, and RED before them — the two reds are Plan 1's
exact-match holder list and its exact-match class-enumeration list, which are exactly the
guards this plan is required to widen by hand. Every
other case in the new describe is green on its first run: Tasks 3-10 already put exactly
one spelling in each file, so the rest of this describe is a tripwire, not a driver.

To prove it is a tripwire rather than a tautology, break it once, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  tsv="$CCD_MODELS_DIR/$w.classes.tsv"\n  [[ -r "$tsv" ]] || return 0\n  avail='
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  tsv="$HOME/.ccrc/models/$w.classes.tsv"\n  [[ -r "$tsv" ]] || return 0\n  avail='))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/single-definition.test.ts -t 'through CCD_MODELS_DIR'
```
Expected: FAIL —
```
AssertionError: expected [ 'CCD_MODELS_DIR="$HOME/.ccrc/models"', 'tsv="$HOME/.ccrc/models/$w.classes.tsv"' ] to deeply equal [ 'CCD_MODELS_DIR="$HOME/.ccrc/models"' ]
```

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = '  tsv="$HOME/.ccrc/models/$w.classes.tsv"\n  [[ -r "$tsv" ]] || return 0\n  avail='
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old,
  '  tsv="$CCD_MODELS_DIR/$w.classes.tsv"\n  [[ -r "$tsv" ]] || return 0\n  avail='))
MUT
```

- [ ] **Step 5: Mutation check — the agreement test discriminates**

Break ccd's ordering, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = 'CCD_CLASSES=(haiku sonnet opus fable)'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, 'CCD_CLASSES=(fable opus sonnet haiku)'))
MUT
```

Run, from `server/`:
```bash
npx vitest run test/ccd-models-agreement.test.ts -t 'agrees on an anthropic lane'
```
Expected: FAIL —
```
AssertionError: expected [ 'fable', 'opus', 'sonnet', 'haiku' ] to deeply equal [ 'haiku', 'sonnet', 'opus', 'fable' ]
```

Restore, from the repository root:
```bash
python3 - <<'MUT'
import io
p = 'ccd/ccd'
s = io.open(p, encoding='utf-8').read()
old = 'CCD_CLASSES=(fable opus sonnet haiku)'
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, 'CCD_CLASSES=(haiku sonnet opus fable)'))
MUT
```

- [ ] **Step 6: Re-stamp and run the whole ccd surface**

From the repository root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Run, from `server/`:
```bash
npx vitest run
```
Expected: PASS — the whole server suite. This is the first run of the full suite in this plan and it is the one that catches a ccd change reaching a file no task named.

Run, from `agent/`:
```bash
npx vitest run
```
Expected: PASS.

Run, from `pwa/`:
```bash
npx vitest run
```
Expected: PASS — this plan touches no PWA file, so this run is a control on that claim.

- [ ] **Step 7: Commit**

From the repository root:
```bash
git add server/test/ccd-models-agreement.test.ts server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
test(ccd): register ccd as the second reader of the models files, with the agreement

Two languages, two processes, one pair of files — and the bash half ships as a
copy to a box where nothing runs a suite, so agreement cannot be structural.
One spelling per tool of each path, and a fixture set fed to both
shared/models.ts and ccd's bash: every class-slot state, every catalogue
state, retirement, staleness and a classed hidden model.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: `ccrc doctor` gains a `models` check

Gated like every Plan 2 task on PR #62 merged and deployed; register the check AFTER #62's fix round rewrote `_dr_warn pools …` at `ccd/ccrc-doctor-checks:2985` and its comment at `:2928` (mail 286).

Spec §8's last bullet: one check per non-Anthropic lane — catalogue present and not stale, no retired class ids, and a sentinel-free env block that matches the registry, with re-materialise as the remedy.

**Files:**
- Modify: `ccd/ccrc-doctor-checks:166-196` (the table — `models` goes after `pools`) and its check bodies (add `_check_models` after `_check_wrappers`)
- Modify: `server/test/ccrc-doctor.test.ts` (new describe; `RosterEntry`; `HEALTHY_SKIPS`)
- Modify: `server/test/single-definition.test.ts` — Plan 1's `.ccrc/models` holder list gains `'ccd/ccrc-doctor-checks'` (Step 10b)
- Idiom copied from: `ccd/ccrc-doctor-checks`'s `_check_wrappers` (its roster ladder — the node reader, the distinct exit codes, and the TSV whose control bytes are escaped because the verdict line is read by a human on a terminal that ACTS on them); `ccd/ccrc-doctor-checks:203-207` (`_dr_pass`/`_dr_warn`/`_dr_fail`/`_dr_skip`, and the contract that a non-PASS carries exactly one remedy line); `server/test/ccrc-doctor.test.ts:1088-1116` (the table census, which makes a table entry with no `_check_<name>` function red)

**Interfaces:**
- Consumes: Plan 1's `shared/models.mjs` (`parseRegistry`, `parseCatalogue`, `deriveModels`, `availableFor`) and `shared/modelenv.mjs` (`modelEnvBlock(registry)`, which throws `ModelEnvInvalid` when every class is null or the subagent slot is null) — both reached at `${CCRC_HERE%/*}/shared/…`, the same relative shape the shipped tree already uses to reach a sibling module; the registry file `~/.ccrc/models/<id>.classes.json`, the catalogue `~/.ccrc/models/<id>.json`, and the materialised three-column `~/.ccrc/models/<id>.classes.tsv`, all written by Plan 1's `ccrc models` verbs. This plan's own Task 1 (the measured gate — PR #62 merged and deployed) and Task 2 (the rebase onto #62's merge sha, after which every `ccd/ccrc-doctor-checks` line number below is re-located by its text, never by the number).
- Produces: `CCRC_DOCTOR_CHECKS` gains `models`; `_check_models` in `ccd/ccrc-doctor-checks`.

- [ ] **Step 1: Write the failing doctor tests**

Append to `server/test/ccrc-doctor.test.ts`:

```ts
// ── the models check (spec §8's last bullet) ──────────────────────────────
// Four findings, two classes, and the split is the point: a lane the box
// cannot ROUTE to (a retired class id, an env block that disagrees with the
// registry) is a FAIL, while a lane that is merely UNTOLD (never probed, stale,
// unseeded) — or carrying disk debris (an ORPHANED registry file, spec §11,
// mail 284) — is a WARN. Collapsing them would either cry wolf on a fresh box
// or report a healthy one while `--model fable` dies at the provider.
//
// SCOPE IS `telemetry: "none"`, declared in the roster — the box's own
// statement that this lane does not bill through Anthropic, so it is the lane
// whose four aliases the materialiser owns. An entry with no `telemetry` at
// all is a roster `parseRoster` would refuse and the `wrappers` check above
// owns — this check skips it rather than reporting a second fault for one
// cause, which is also why every OTHER fixture in this file keeps its
// existing verdict counts. THE ORPHAN FINDING IS THE ONE EXCEPTION: it scans
// against the WHOLE roster, because an id `ccrc account remove` dropped is
// gone from the roster entirely, not merely reclassified — telemetry:"none"
// has nothing to say about a lane that no longer exists.

/** An openai lane, its registry, its catalogue and its settings env block, as
 *  the materialiser leaves them (spec §6.1). Each test starts from `healthy()`
 *  and breaks exactly ONE of them. */
function seedClassedLane(home: string, over: {
  registry?: unknown | null; catalogue?: unknown | null; env?: Record<string, string> | null;
} = {}): void {
  writeRoster(home, [UPSTREAM, {
    id: 'gpt', configDirSuffix: '.claude-gpt', exec: { kind: 'external' }, telemetry: 'none',
  }]);
  mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  if (over.registry !== null) {
    writeFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), JSON.stringify(over.registry ?? {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'sonnet', discovery: 'catalogue',
    }));
  }
  if (over.catalogue !== null) {
    writeFileSync(join(home, '.ccrc', 'models', 'gpt.json'), JSON.stringify(over.catalogue ?? {
      probe: 'codex', fetchedAt: 1789000000, stale: false,
      models: [
        { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', context: null, maxContext: null, efforts: ['high'], hidden: false, priceIn: null, priceOut: null },
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', context: null, maxContext: null, efforts: ['high'], hidden: false, priceIn: null, priceOut: null },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', context: null, maxContext: null, efforts: ['max'], hidden: false, priceIn: null, priceOut: null },
      ],
    }));
  }
  if (over.env !== null) {
    mkdirSync(join(home, '.claude-gpt'), { recursive: true });
    writeFileSync(join(home, '.claude-gpt', 'settings.json'), JSON.stringify({
      env: over.env ?? {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.6-luna',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.6-terra',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
        ANTHROPIC_MODEL: 'gpt-5.6-sol',
        ANTHROPIC_SMALL_FAST_MODEL: 'gpt-5.6-luna',
        CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
      },
    }, null, 2));
  }
  writeBinary(home, 'gpt');
}

describe('ccrc doctor: models', () => {
  it('SKIPS a box with no lane to classify — there is nothing to measure', () => {
    // The healthy fixture is one upstream account. PASS would claim an
    // agreement nobody measured; WARN would report a fault there is none.
    const r = runDoctor(healthy('ccrc-doctor-models-skip-'));
    expect(anyVerdictFor(r.stdout, 'models')).toMatch(/^SKIP models: /);
  });

  it('PASSES a lane whose catalogue is fresh, whose classes are all advertised, and whose env matches', () => {
    const home = healthy('ccrc-doctor-models-ok-');
    seedClassedLane(home);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'models'), out).toMatch(/^PASS models: /);
    expect(lineFor(out, 'models')).toContain('gpt');
  });

  it('WARNS a lane that has never been probed, and names the verb that fixes it', () => {
    const home = healthy('ccrc-doctor-models-unprobed-');
    seedClassedLane(home, { catalogue: null });
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'models')).toMatch(/^WARN models: .*never probed/);
    expect(remedyAfter(out, 'models')).toContain('ccrc models refresh');
  });

  it('WARNS a stale catalogue, naming the lane', () => {
    const home = healthy('ccrc-doctor-models-stale-');
    seedClassedLane(home, { catalogue: {
      probe: 'codex', fetchedAt: 1789000000, stale: true, lastError: '401',
      models: [{ id: 'gpt-5.6-luna', label: 'L', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null }],
    } });
    expect(lineFor(runDoctor(home).stdout, 'models')).toMatch(/^WARN models: .*stale/);
  });

  it('WARNS a lane with NO registry file at all, and names init (spec §13.1)', () => {
    const home = healthy('ccrc-doctor-models-unseeded-');
    seedClassedLane(home, { registry: null, catalogue: null, env: null });
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'models')).toMatch(/^WARN models: .*no model-class registry/);
    expect(remedyAfter(out, 'models')).toContain('ccrc models <id> init');
  });

  it('FAILS a class whose id the provider no longer advertises, naming id AND class', () => {
    const home = healthy('ccrc-doctor-models-retired-');
    seedClassedLane(home, { catalogue: {
      probe: 'codex', fetchedAt: 1789000000, stale: false,
      models: [
        { id: 'gpt-5.6-luna', label: 'L', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null },
        { id: 'gpt-5.6-terra', label: 'T', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null },
      ],
    } });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'models');
    expect(line).toMatch(/^FAIL models: /);
    expect(line).toContain('gpt-5.6-sol');
    expect(line).toContain('opus');
    // Spec §4.3: the registry file is the operator's, so the remedy is to
    // REASSIGN, never "ccrc will clear it for you".
    expect(remedyAfter(out, 'models')).toContain('ccrc models <id> set-class');
  });

  it('FAILS an env block that disagrees with the registry, naming the key', () => {
    const home = healthy('ccrc-doctor-models-drift-');
    seedClassedLane(home, { env: {
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.6-luna',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.6-terra',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.5',            // hand-edited on the box
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
      ANTHROPIC_MODEL: 'gpt-5.6-sol',
      ANTHROPIC_SMALL_FAST_MODEL: 'gpt-5.6-luna',
      CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
    } });
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'models')).toMatch(/^FAIL models: .*ANTHROPIC_DEFAULT_OPUS_MODEL/);
    expect(remedyAfter(out, 'models')).toContain('ccrc models');
  });

  it('FAILS a settings file the materialiser has never written', () => {
    const home = healthy('ccrc-doctor-models-nosettings-');
    seedClassedLane(home, { env: null });
    expect(lineFor(runDoctor(home).stdout, 'models')).toMatch(/^FAIL models: .*settings/);
  });

  it('FAILS a catalogue file that exists and does not parse — which is NOT "never probed"', () => {
    // `server/src/models.ts` collapses the two on the wire because the remedy is
    // the same there; doctor is the surface whose whole job is to name the
    // difference, so it must not collapse them.
    const home = healthy('ccrc-doctor-models-corrupt-');
    seedClassedLane(home);
    writeFileSync(join(home, '.ccrc', 'models', 'gpt.json'), '{ not json');
    expect(lineFor(runDoctor(home).stdout, 'models')).toMatch(/^FAIL models: .*cannot be read/);
  });

  it('FAILS a registry file that exists and does not parse — which is NOT "no registry"', () => {
    const home = healthy('ccrc-doctor-models-badreg-');
    seedClassedLane(home, { registry: { probe: 'codex' } });
    expect(lineFor(runDoctor(home).stdout, 'models')).toMatch(/^FAIL models: .*registry.*cannot be read|does not parse/);
  });

  it('FAILS a lane whose every class is null — the materialiser cannot derive ANTHROPIC_MODEL', () => {
    // Spec §11: "All four slots null: the materialiser refuses the edit."
    const home = healthy('ccrc-doctor-models-allnull-');
    seedClassedLane(home, { registry: {
      probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null },
      subagent: 'sonnet', discovery: 'catalogue',
    } });
    expect(lineFor(runDoctor(home).stdout, 'models')).toMatch(/^FAIL models: .*no class/);
  });

  it('WARNS an orphaned registry file whose id is in no roster row, and names the remedy (spec §11, mail 284)', () => {
    // No `seedClassedLane` at all — the roster stays `healthy()`'s single
    // upstream account, and the ONLY thing on disk is a registry file
    // `ccrc account remove` left behind. This is deliberately the box's ONLY
    // finding: the orphan scan is NOT scoped to telemetry:"none" lanes (there
    // isn't one here) and must not be folded into the "nothing to classify"
    // SKIP — an orphan is disk debris, not a lane's fault, and it is a
    // finding even when no lane needs classifying today.
    const home = healthy('ccrc-doctor-models-orphan-');
    mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'), JSON.stringify({
      probe: 'codex', classes: { haiku: 'gpt-5.6-luna', sonnet: null, opus: null, fable: null },
      subagent: 'haiku', discovery: 'catalogue',
    }));
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'models')).toMatch(/^WARN models: .*ghost.*no roster row/);
    expect(remedyAfter(out, 'models')).toContain('ccrc models <id> rm');
  });
});
```

Widen the fixture's roster entry type so a test can declare a lane's telemetry (`writeRoster` already spreads every field it is given):

```ts
interface RosterEntry {
  id: string;
  configDirSuffix?: string;
  exec: { kind: 'upstream' | 'generated' | 'external'; secretsFile?: string };
  /** Declared only by the tests that are ABOUT it — the `models` check's scope
   *  is `telemetry: "none"` (spec §4.1: an Anthropic lane never has a registry
   *  file), and every other fixture in this file leaves the field absent, which
   *  that check skips. */
  telemetry?: 'anthropic' | 'none';
}
```

Add the one helper this describe needs, beside `lineFor`:

```ts
/** The remedy line that must immediately follow a non-PASS verdict — the
 *  contract `ccrc-doctor-checks`' header states and `_dr_warn`/`_dr_fail`
 *  enforce by printing both lines themselves. */
const remedyAfter = (out: string, name: string): string => {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^(WARN|FAIL) ${name}: `).test(l));
  return i === -1 ? '' : (lines[i + 1] ?? '');
};
```

and bump the skip count, whose comment now covers two cases:

```ts
/** How many checks a HEALTHY fixture skips. `models` is one on EVERY platform:
 *  `healthy()` is a single upstream account, so there is no `telemetry: "none"`
 *  lane to classify and the check answers SKIP — a PASS there would be a verdict
 *  nobody measured, the forgery class this repo bans by name. On macOS `scopes`
 *  skips too: cgroup throttling is a Linux mechanism, so a Darwin box has no
 *  such fault to find. */
const HEALTHY_SKIPS = process.platform === 'darwin' ? 2 : 1;
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t models`
Expected: FAIL — every case gets `undefined` from `lineFor`/`anyVerdictFor` (no such check).

- [ ] **Step 3: Add the table entry**

In `ccd/ccrc-doctor-checks`, in `CCRC_DOCTOR_CHECKS`, directly after `pools`:

```
  models
```

- [ ] **Step 4: Run the table census and watch THAT fail**

Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t "every name in the table"`
Expected: FAIL — the census reports `MISSING _check_models`. This is the mechanism that stops a table entry shipping without an implementation, and seeing it red is the proof it works.

- [ ] **Step 5: Write `_check_models`**

In `ccd/ccrc-doctor-checks`, directly after `_check_wrappers`:

```bash
# ── models — the class registry on every non-Anthropic lane (design spec §8) ──
#
# FOUR FINDINGS, TWO CLASSES, and the split is the whole design of this check:
#
#   FAIL — the box cannot ROUTE what the registry says it can. A class id the
#          provider no longer advertises (`--model opus` dies at the provider
#          with an opaque 404); an `env` block that disagrees with the registry
#          (someone hand-edited the lane's settings, and the settings WIN over
#          the shell, measured spec §1); no settings file at all; a registry or
#          catalogue file that exists and cannot be read; a lane whose every
#          class is null, where `modelEnvBlock` cannot derive ANTHROPIC_MODEL at
#          all.
#   WARN — the box is merely UNTOLD, or carrying disk debris rather than a fault
#          on a live lane: never probed; a stale catalogue (the last probe
#          failed and this is the previous one, spec §11); a lane with no
#          registry file yet, which spec §13.1 says is VALID and reads as "all
#          classes unavailable" until seeded; and an ORPHANED registry file —
#          a `<id>.classes.json` whose id is in NO roster row at all, left
#          behind by `ccrc account remove` (spec §11, "Orphan registry", mail
#          284) — reported here because nothing reaps it automatically.
#
# Collapsing them would either cry wolf on a fresh box — where "never probed" is
# the ordinary first state — or report a healthy box while a class is dead.
#
# SCOPE IS `telemetry: "none"`, which the roster DECLARES — for every finding
# EXCEPT the orphan scan, which walks the models directory itself and checks
# each id against the WHOLE roster, not just its telemetry:"none" rows: an
# orphan is disk debris regardless of what kind of lane the id used to be, and
# it is a finding even on a box with zero classed lanes today, so it is never
# folded into the "nothing to classify" SKIP below. An Anthropic lane
# never has a registry file (spec §4.1) and its four aliases are Claude Code's
# own, so it has nothing here to measure; a lane whose entry omits `telemetry`
# altogether is a roster `parseRoster` would refuse, and the `wrappers` check
# above owns that fault — reporting it twice sends an operator to fix two
# things. The limit is stated rather than hidden: an Anthropic account whose
# operator set `telemetry: "none"` would be asked to seed a registry it does not
# need, and would answer WARN until they did.
#
# READ BY NODE, THROUGH THE SHIPPED SHARED MODULES. `shared/models.mjs` and
# `shared/modelenv.mjs` are the SINGLE definitions of "what is retired" and
# "what belongs in the env block"; a jq reimplementation here would be a third
# reader of the same rule (the server and ccd are the other two) and would drift
# from both the first time a rule moved. They are reached relative to this
# file's own directory.
_check_models() {
  local roster="$HOME/.ccrc/accounts.json"
  if [ ! -f "$roster" ] || [ ! -r "$roster" ]; then
    _dr_skip models "there is no readable account roster at \$HOME/.ccrc/accounts.json, so the wrappers check above owns that fault and there is nothing here to measure"
    return 3
  fi
  if ! command -v node >/dev/null 2>&1; then
    _dr_fail models "node is not on PATH, so the class registry cannot be read" \
      "install Node first — see the 'node' check above"
    return 1
  fi

  local out rc
  out="$(CCRC_DOCTOR_MODELS_ROSTER="$roster" CCRC_DOCTOR_MODELS_DIR="$HOME/.ccrc/models" \
         CCRC_DOCTOR_MODELS_HOME="$HOME" CCRC_DOCTOR_MODELS_SHARED="${CCRC_HERE%/*}/shared" \
         node --input-type=module -e '
    import { readFileSync, readdirSync } from "node:fs";
    import path from "node:path";
    const shared = process.env.CCRC_DOCTOR_MODELS_SHARED;
    const { parseRegistry, parseCatalogue, deriveModels } = await import(path.join(shared, "models.mjs"));
    const { modelEnvBlock } = await import(path.join(shared, "modelenv.mjs"));
    let text;
    try { text = readFileSync(process.env.CCRC_DOCTOR_MODELS_ROSTER, "utf8"); }
    catch { process.exit(5); }
    let j; try { j = JSON.parse(text); } catch { process.exit(3); }
    if (!j || typeof j !== "object" || !Array.isArray(j.accounts)) process.exit(4);
    if (j.accounts.length === 0) process.exit(6);
    // Every control byte escaped, and the backslash escaped first so the
    // rendering is INJECTIVE — `_check_wrappers` learned both the hard way, and
    // for the same two reasons: this TSV would otherwise gain fields, and the
    // verdict line is read by a human on a terminal that ACTS on control bytes.
    const esc = (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0");
    const s = (v) => (typeof v === "string"
      ? v.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "\\r")
         .replace(/\n/g, "\\n").replace(/[\x00-\x1f\x7f]/g, esc)
      : "");
    const dir = process.env.CCRC_DOCTOR_MODELS_DIR;
    const rows = [];
    for (const a of j.accounts) {
      const o = (a && typeof a === "object") ? a : {};
      const e = (o.exec && typeof o.exec === "object") ? o.exec : {};
      if (e.kind === "upstream" || o.telemetry !== "none") continue;
      const id = s(o.id);
      // ── the registry ─────────────────────────────────────────────────────
      let reg = null;
      const rp = path.join(dir, o.id + ".classes.json");
      let rawReg = null;
      try { rawReg = readFileSync(rp, "utf8"); }
      catch (err) {
        if (err.code === "ENOENT") { rows.push([id, "no-registry", ""].join("\t")); continue; }
        rows.push([id, "registry-unreadable", s(rp)].join("\t")); continue;
      }
      try { reg = parseRegistry(JSON.parse(rawReg)); }
      catch { rows.push([id, "registry-unreadable", s(rp)].join("\t")); continue; }
      // ── the catalogue ────────────────────────────────────────────────────
      let cat = null, catState = "ok";
      const cp = path.join(dir, o.id + ".json");
      let rawCat = null;
      try { rawCat = readFileSync(cp, "utf8"); }
      catch (err) { catState = err.code === "ENOENT" ? "never-probed" : "unreadable"; }
      if (rawCat !== null) {
        try { cat = parseCatalogue(JSON.parse(rawCat)); } catch { catState = "unreadable"; }
      }
      if (catState !== "ok") rows.push([id, catState, s(cp)].join("\t"));
      else if (cat.stale) rows.push([id, "stale", String(cat.fetchedAt)].join("\t"));
      // ── retired class ids ────────────────────────────────────────────────
      if (cat !== null && !cat.stale) {
        const d = deriveModels(reg, cat);
        for (const bad of d.retired) {
          const cls = ["haiku", "sonnet", "opus", "fable"].find((c) => reg.classes[c] === bad);
          if (cls !== undefined) rows.push([id, "retired", s(bad) + " " + cls].join("\t"));
        }
      }
      // ── the env block against the registry ───────────────────────────────
      let want;
      try { want = modelEnvBlock(reg); }
      catch { rows.push([id, "no-classes", ""].join("\t")); continue; }
      const sp = path.join(process.env.CCRC_DOCTOR_MODELS_HOME, o.configDirSuffix ?? "", "settings.json");
      let env = null;
      try { env = (JSON.parse(readFileSync(sp, "utf8")) || {}).env ?? {}; }
      catch { rows.push([id, "settings-unreadable", s(sp)].join("\t")); }
      if (env !== null) {
        for (const [k, v] of Object.entries(want)) {
          if (env[k] !== v) rows.push([id, "env-drift", s(k)].join("\t"));
        }
      }
      if (rows.filter((r) => r.startsWith(id + "\t")).length === 0) rows.push([id, "ok", ""].join("\t"));
    }
    // ── orphaned registry files (spec §11, "Orphan registry", mail 284) ──────
    // A `<id>.classes.json` whose id is in NO roster row at all — independent
    // of the loop above, and checked against every account, not just
    // telemetry:"none" ones, because an id `ccrc account remove` dropped is
    // gone from the roster entirely, not merely reclassified as upstream.
    const rosterIds = new Set(j.accounts
      .map((a) => (a && typeof a === "object" ? a.id : undefined))
      .filter((v) => typeof v === "string"));
    let entries = [];
    try { entries = readdirSync(dir); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.endsWith(".classes.json")) continue;
      const oid = entry.slice(0, -".classes.json".length);
      if (!rosterIds.has(oid)) rows.push([s(oid), "orphan", ""].join("\t"));
    }
    process.stdout.write(rows.join("\n"));
  ' 2>/dev/null)"; rc=$?

  case "$rc" in
    0) ;;
    5) _dr_fail models "\$HOME/.ccrc/accounts.json cannot be read, so no lane's classes could be checked" \
         "fix its mode/ownership — check with: ls -l \$HOME/.ccrc/accounts.json"; return 1 ;;
    3) _dr_fail models "\$HOME/.ccrc/accounts.json does not parse as JSON" \
         "the wrappers check above owns this fault too — fix the roster once"; return 1 ;;
    4|6) _dr_fail models "\$HOME/.ccrc/accounts.json declares no accounts" \
         "rebuild it from disk: ccrc adopt --out /tmp/accounts.json"; return 1 ;;
    *) _dr_fail models "reading the class registry exited $rc — this check does not know what that means" \
         "this is a bug in ccrc, not a fact about your box — see _check_models in $CCRC_HERE/ccrc-doctor-checks"; return 1 ;;
  esac

  local -a fails=() warns=() lanes=()
  local line id code detail
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    id="${line%%$'\t'*}"; line="${line#*$'\t'}"
    code="${line%%$'\t'*}"; detail="${line#*$'\t'}"
    case " ${lanes[*]} " in *" $id "*) ;; *) lanes+=("$id") ;; esac
    case "$code" in
      ok) ;;
      no-registry)         warns+=("$id has no model-class registry, so every class on it reads as unavailable") ;;
      never-probed)        warns+=("$id has never been probed") ;;
      stale)               warns+=("$id's catalogue is stale since epoch $detail — the last probe failed") ;;
      orphan)              warns+=("$id has a model-class registry file but is in no roster row — probably left behind by ccrc account remove") ;;
      registry-unreadable) fails+=("$id's registry at $detail exists and cannot be read") ;;
      unreadable)          fails+=("$id's catalogue at $detail exists and cannot be read") ;;
      settings-unreadable) fails+=("$id's settings at $detail cannot be read, so its env block could not be compared") ;;
      retired)             fails+=("$id classes ${detail% *} as ${detail#* }-class and the provider no longer advertises it") ;;
      env-drift)           fails+=("$id's settings env disagrees with the registry on $detail") ;;
      no-classes)          fails+=("$id has no class the materialiser can build an env block from") ;;
      *)                   fails+=("$id reported \"$code\", which this check does not understand") ;;
    esac
  done <<< "$out"

  if [ "${#lanes[@]}" -eq 0 ]; then
    _dr_skip models "this box declares no lane with telemetry \"none\", so there is nothing to classify — an Anthropic account's four classes are Claude Code's own defaults"
    return 3
  fi

  # A FAIL and a WARN are printed as SEPARATE lines with their own remedies —
  # the header's "one check may answer in two classes" rule — and the WORSE
  # class is returned, because an operator who fixes the retired id still has a
  # stale catalogue to refresh.
  local worst=0
  if [ "${#fails[@]}" -gt 0 ]; then
    _dr_fail models "$(IFS='; '; echo "${fails[*]}")" \
      "reassign the class and re-materialise: ccrc models <id> set-class <class> <modelId> (the registry file is yours — ccrc never clears a class for you)"
    worst=1
  fi
  if [ "${#warns[@]}" -gt 0 ]; then
    _dr_warn models "$(IFS='; '; echo "${warns[*]}")" \
      "probe the lane: ccrc models refresh <id> — seed an unregistered lane first with ccrc models <id> init <codex|openrouter|compatible> — or remove an orphaned registry file with ccrc models <id> rm"
    [ "$worst" -eq 0 ] && worst=2
  fi
  if [ "$worst" -eq 0 ]; then
    _dr_pass models "$(IFS=', '; echo "${lanes[*]}") — catalogue fresh, every class advertised, env block matches the registry"
  fi
  return "$worst"
}
```

- [ ] **Step 6: Run the doctor tests**

Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts`
Expected: PASS — the twelve new cases, the table census, and every pre-existing summary count (which `HEALTHY_SKIPS` now accounts for).

- [ ] **Step 7: Measured mutation #1 — the FAIL/WARN split**

Edit `ccd/ccrc-doctor-checks` and move `retired)` from the `fails+=` arm to the `warns+=` arm.
Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t "no longer advertises"`
Expected: FAIL — `expected 'WARN models: gpt classes gpt-5.6-sol…' to match /^FAIL models: /`.
Restore. Re-run: PASS.

- [ ] **Step 8: Measured mutation #2 — the env comparison**

Edit `ccd/ccrc-doctor-checks` and change the env loop's condition to `if (false)`.
Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t "disagrees with the registry"`
Expected: FAIL — `expected 'PASS models: gpt — catalogue fresh…' to match /^FAIL models: .*ANTHROPIC_DEFAULT_OPUS_MODEL/`: a box whose settings were hand-edited would be reported healthy while every session on the lane ran the wrong model.
Restore. Re-run: PASS.

- [ ] **Step 9: Measured mutation #3 — SKIP is not PASS**

Edit `ccd/ccrc-doctor-checks` and change the `${#lanes[@]} -eq 0` arm to `_dr_pass models "nothing to check"; return 0`.
Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t "SKIPS a box with no lane"`
Expected: FAIL — `expected 'PASS models: nothing to check' to match /^SKIP models: /`. The summary tests that count verdicts go red too, which is the point: a PASS over an empty set is a verdict nobody measured.
Restore. Re-run: PASS.

- [ ] **Step 10: Measured mutation #4 — a stale catalogue retires nothing**

Edit `ccd/ccrc-doctor-checks` and change the retired guard from `if (cat !== null && !cat.stale)` to `if (cat !== null)`.
Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t "WARNS a stale catalogue"`
Expected: FAIL — the line becomes `FAIL models: gpt classes gpt-5.6-terra as sonnet-class…`, because the stale one-model catalogue is read as the world shrinking rather than as a probe that failed (spec §11).
Restore. Re-run: PASS.

- [ ] **Step 10b: Measured mutation #5 — the orphan scan**

Edit `ccd/ccrc-doctor-checks` and change the orphan loop's condition from `if (!rosterIds.has(oid))` to `if (false)`.
Run from `server/`: `npx vitest run test/ccrc-doctor.test.ts -t "orphaned registry file"`
Expected: FAIL — `expected 'SKIP models: this box declares no lane with telemetry "none"…' to match /^WARN models: .*ghost.*no roster row/`: with the scan disabled, the box has no telemetry:"none" lane and no orphan finding either, so `lanes` stays empty and the check answers SKIP — a registry file `ccrc account remove` left behind would sit on disk forever with no operator ever told.
Restore. Re-run: PASS.

- [ ] **Step 11: Provenance and the scans**

`ccd/ccrc-doctor-checks` carries no `# ccrc:generated` line, so nothing is re-stamped and `server/test/ownership.test.ts` needs no run for it. Confirm the premise:

Run from `<repo>`: `sed -n 2p ccd/ccrc-doctor-checks`
Expected: the file's own header comment, not a `# ccrc:generated` marker.

- [ ] **Step 12: Widen the holder list Plan 1 wrote**

`ccd/ccrc-doctor-checks` now spells `.ccrc/models` on one line of shell
(`CCRC_DOCTOR_MODELS_DIR="$HOME/.ccrc/models"`), so Plan 1's exact-match assertion in
`server/test/single-definition.test.ts` — the "the generated model files, and who reads
each one" describe — is now RED. That is the guard working; add this plan's row in
`holdersOf`'s own sort order, keeping whatever rows the plans that ran before this one
already added:

```ts
    expect(holdersOf('.ccrc/models')).toEqual([
      'ccd/ccd',                 // the class carry's reader (Plan 2, if it has landed)
      'ccd/ccrc',                // cmd_models — the verbs
      'ccd/ccrc-doctor-checks',  // the per-lane models check (this plan)
      'ccd/ccrc-models-probe',   // the writer
    ]);
```

Four rows, all bash, and **no `'server/src/models.ts'` row** — measured on `origin/main`
at `server/test/single-definition.test.ts:1139-1145`: the module-scope `holdersOf` filters
`BASH`, which is `bashRoots.flatMap(bashFiles)` plus `install.sh`, and `bashFiles` keeps
only extensionless files whose first line is a `#!…sh` shebang (`:1118-1119` rejects
anything with an extension outright). A `.ts` file can never appear in that list, so
adding the row would red the case it is meant to satisfy. The TypeScript reader is
single-defined a different way and by a different assertion: `server/src/models.ts`
reaches the directory through `cfg.modelsDir` (Task 2 added it to `server/src/config.ts`
beside `limitsDir`) and never spells `.ccrc/models` itself — pinned by Task 2 Step 13's
`one producer of AccountModels` describe, whose third case asserts the path is spelled
once under `server/src` and that once is `config.ts`.

If Plan 2 has not landed yet, omit its `'ccd/ccd'` row — the list states what the tree
holds, and Plan 2 puts its row in when it lands. Do **not** turn the list into a pattern:
Plan 1's comment says it grows by name.

- [ ] **Step 12b: Confirm the other two exact-match lists are already widened**

Plan 1 Task 12's describe holds two more exact-match lists this plan's code reds, and each
was widened in the task whose code red it, not here: `spell('classes.json')` gained
`'server/src/models.ts'` in **Task 2 Step 13b**, and the class-enumeration list gained
`'pwa/src/lib/models.ts'` in **Task 8 Step 6b**. Nothing to edit in this step — verify:

Run from `server/`: `npx vitest run test/single-definition.test.ts -t "the REGISTRY file is named"`
Run from `server/`: `npx vitest run test/single-definition.test.ts -t "the four class names are enumerated"`
Expected: both PASS. A red here means the earlier task's widening was skipped; go back and
do it there rather than patching it in this commit, so each list moves with the code that
moved it.

- [ ] **Step 13: Run the scans**

Run from `server/`: `npx vitest run test/single-definition.test.ts test/deviation-refs.test.ts test/source-bytes.test.ts`
Expected: PASS — after Step 12, and RED before it on exactly one case, the bash holder
list. The other two lists Plan 1 Task 12 left for later plans were widened in Tasks 2 and
8; Step 12b is the check that they were.

- [ ] **Step 14: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/single-definition.test.ts
git commit -m "feat(doctor): one check per classed lane — a fresh catalogue, no retired class, and an env block that matches the registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Definition of done

Run from the repository root unless a line says otherwise. Every one of these is a command whose output is the evidence; none of them is a judgement call.

- [ ] Twelve commits, one per task (Task 1's is the empty gate commit), each naming only its own files (`git log --oneline -12`).
- [ ] `sed -n 2p ccd/ccd` prints a `# ccrc:generated 1 sha256=…` line, and from `server/`: `npx vitest run test/ownership.test.ts` PASSES — i.e. `ccd/ccd` was re-stamped after the last edit to it.
- [ ] From `server/`: `npx vitest run` PASSES (the whole suite).
- [ ] From `agent/`: `npx vitest run` PASSES.
- [ ] From `pwa/`: `npx vitest run` PASSES — this plan touches no PWA file, so a failure here is a change that escaped its task.
- [ ] `git status --porcelain` is empty: every mutation check restored the exact bytes it broke.
- [ ] `grep -v '^[[:space:]]*#' ccd/ccd | grep -c 'ccrc-unavailable'` prints `0` — no LINE OF SHELL in ccd names §6.1's sentinels (Global Constraint 6). (One comment in `_spawn_start` explains why the flag is withheld and does name one; that is prose, and the `grep -v` is what separates the two.)
- [ ] `grep -c '\[\[ "$state" == "assigned" \]\]' ccd/ccd` prints `1` — availability is read from the tsv's third column, in one place (Global Constraint 4).
- [ ] `grep -v '^[[:space:]]*#' ccd/ccd | grep -c '\.classes\.tsv'` prints `4` — one spelling each in `_session_class`, `_lane_classes`, `_lane_unclassified_count` and `_lane_class_note`, every one of them built from `$CCD_MODELS_DIR` (which `single-definition.test.ts` pins as the file's only `.ccrc/models` literal), and none anywhere else.
- [ ] `grep -c '_model_retired' ccd/ccd` prints `0` — retirement is `classesTsv(registry, catalogue)`'s answer in Plan 1 and reaches ccd as a word; a second derivation of §4.3 in bash is the thing deviation A-10 forbids.
- [ ] `awk '/^_lane_classes\(\)/,/^}/' ccd/ccd | grep -c jq` prints `0` — the routing answer is read out of the tsv and never out of JSON; the only jq call this plan adds is `_lane_unclassified_count`'s, a display-only count nothing routes on (`awk '/^_lane_unclassified_count\(\)/,/^}/' ccd/ccd | grep -c 'jq -r'` prints `1`).
- [ ] `grep -c 'ccrc account models' ccd/ccd` prints `0` — the verb group is the top-level `ccrc models` (spec §10); `ccrc account` is the account-connections branch's and is not on `main`.
- [ ] `grep -cF "mflag=\"--model '" ccd/ccd` prints `1` — one composer of the flag, read by both spawn lines through `$mflag`.
- [ ] `grep -cE '_reg_set "\$(id|1)" class' ccd/ccd` prints `2` — `_record_class` and `cmd_swap`'s `--as-class` arm are the only writers of the field, and there is no `_reg_del`/`_reg_unset` to clear it (`server/test/ccd-reg-claim.test.ts:54`).
- [ ] `gh -R Synapsium-Labs/ccrc-pwa pr view 62 --json state -q .state` prints `MERGED`, and `git merge-base --is-ancestor "$MERGE_SHA" HEAD` exits 0 — the gate Task 1 measured is still true of the branch Task 2 rebased.
- [ ] `grep -c '_reg_get "$id" class\|_reg_get "$1" class' ccd/ccd` prints `0`, and `grep -c '_reg_read_class() {' ccd/ccd` prints `1` — the `class` field has exactly one reader and it is the measured one (binding ruling, mail 275 item 3).
- [ ] `sed -n '/The dot-free claim/,/That is a WIDER/p' ccd/ccd | grep -c '`class`'` prints `1` — wave 2b's registry field inventory names the field this plan writes (its own Task 7's mechanism, extended by one field).
- [ ] From `server/`: `npx vitest run test/ccd-class-rotation.test.ts -t 'every `_avail \"$cand\" || continue` in _swap_target is followed by the class guard'` PASSES — the class filter is the third predicate of `_swap_target`'s composed chain and covers both of #61's brackets (A-8).
- [ ] The spec's §7 example line appears verbatim in a passing assertion: from `server/`, `npx vitest run test/ccd-ls-lane-classes.test.ts -t "exactly as §7 spells it"` PASSES.
- [ ] `grep -A1 "^  pools\$" ccd/ccrc-doctor-checks | tail -1` prints `  models` — the doctor table lists `models` directly after `pools` (Task 12).
- [ ] From `server/`: `npx vitest run test/ccrc-doctor.test.ts` PASSES, including the `ccrc doctor: models` describe's twelve cases (spec §8 last bullet, §11's orphan finding, mail 284).
- [ ] `grep -c '^_check_models() {' ccd/ccrc-doctor-checks` prints `1`, and `sed -n 2p ccd/ccrc-doctor-checks` prints the file's own header comment, never a `# ccrc:generated` marker (Task 12 Step 11 — this file is not stamped).
- [ ] `expect(holdersOf('.ccrc/models')).toEqual([...])` in `server/test/single-definition.test.ts` names `'ccd/ccrc-doctor-checks'` beside `'ccd/ccd'`: from `server/`, `npx vitest run test/single-definition.test.ts -t "the generated model files"` PASSES.

## What this plan deliberately leaves to Plans 1, 3a and 3b

- **Plan 1** — the whole WRITE side: the registry file `~/.ccrc/models/<id>.classes.json` and its validator (`parseRegistry`, `RegistryInvalid`), the probes, `classesTsv(registry, catalogue)` (which is where §4.3's retirement rule is computed and tested, once), `modelEnvBlock(registry)` and its single-writer pin, the `.effort.json` the shim reads, the LiteLLM render, and the `ccrc models` verb group this plan's refusal sentences point the operator at.
- **Plan 3a** — the disabled picker rows (spec §8), every server route and the `AccountModels` wire field (§9), and `pwa/src/lib/models.ts`'s deletion (§13.4). `ccrc doctor`'s per-lane `models` check (§8 last bullet) moved here, to this plan's Task 12 (mail 286, 2026-09-08): `ccd/ccrc-doctor-checks` is a `ccd/` file PR #62 edits, so it sits with the rest of this plan's ccd work rather than with Plan 3a's server/PWA surfaces.
- **Plan 3b** — the SwapSheet's downgrade sentence. This plan makes `ccd swap --as-class` exist and refuse without it; the UI that offers the choice rewrites `SwapSheet.tsx` and is gated on account-pools wave 4.

Nothing in those depends on a decision this plan defers — they depend on files this plan already reads.
