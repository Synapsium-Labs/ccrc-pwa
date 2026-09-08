# Model-class registry — Plan 1: registry, probes, materialiser, effort shim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every model any lane can run into one of four classes — haiku, sonnet, opus, fable — as a per-account registry file this design owns; discover each provider's catalogue on a timer; project the registry into the lane's own `settings.json` env block, into a three-column bash projection, into LiteLLM's model list and into a per-lane effort map the gpt shim reads per request.

**Architecture:** Five units, four of them in the `ccrc-pwa` repo and one in the monorepo. **Registry** — `~/.ccrc/models/<accountId>.classes.json`, its own user-owned file (ruling 280: the account-connections branch's `exec.models` is not on `main` and this plan does not stack on it), with the `Registry` type, `parseRegistry` and the derived states in `shared/models.ts` plus a bare-`node` twin `shared/models.mjs`. **Probes** — one bash executable, `ccd/ccrc-models-probe`, with one arm per PROBE KIND (`codex | openrouter | compatible`, keyed by `registry.probe`, never by a roster provider), writing `~/.ccrc/models/<id>.json` atomically and keeping the previous catalogue marked `stale` on any failure. **Materialiser** — `shared/modelenv.mjs` turns a registry into the eight env variables (the eighth, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, written only when a non-stale catalogue measures the resolved default model's context — spec §6.1, amended 2026-09-08), a three-column `.classes.tsv` and a `.effort.json`, and ships with a single-writer pin; `deploy/models-op.mjs` is the node half of the verbs and `ccd/ccrc`'s new top-level `cmd_models` is the bash half. **Shim** — the monorepo's `ccgpt-proxy` maps the client's `output_config.effort` (or the lane default from `~/.ccrc/models/gpt.effort.json`) onto Codex's `reasoning.effort`, and `ccgpt`/`claude-glm` stop exporting model ids the settings block already decides.

**Tech Stack:** TypeScript (`shared/*.ts`, bundled by the PWA — import-free or `shared/*.ts`-only), bare-`node` ESM (`shared/*.mjs` + hand-written `.d.mts`), bash 5 (`ccd/ccrc`, `ccd/ccrc-models-probe`), python 3 (embedded in the probe; `infra/handoff/ccgpt-proxy`), vitest (`server/test`, `agent/test`), systemd --user timers, LiteLLM.

**Spec:** `docs/superpowers/specs/2026-09-08-model-class-registry-design.md`, at commit **`d3048253`** ("docs(models): registry is its own per-account file until account-connections merges; subagent is an explicit class-to-slot choice; discovery scope named apart from selectable; Plan 3 splits behind wave 4"). Read §4, §5, §6 (including §6.4), §10, §11 and §13.1–13.3 before starting; this plan argues from them and cites them by section. Nothing below may be reconciled against an older tip of that file.

**Skeleton:** the locked skeleton for the plans is `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-skeleton.md`. Its **"Rulings round 2"** section overrides the "Locked interfaces" above it, and this plan implements the round-2 shape: the `ModelsBlock`-on-the-roster interface is **WITHDRAWN**, `shortlist` is **`discovery`**, `subagent` is an **explicit class name**, the verbs are a **top-level `ccrc models` group**, and the bash projection has a **third column**.

**Base commit:** the implementation branch `feat/model-class-registry-impl` is cut from **`origin/main`** — NOT from `ws/gemini-subscription-account-connection`. Ruling 280 (mail 280, 2026-09-08): that branch has no PR open, 9 of 29 tasks done, a three-file conflict with `main` awaiting an operator decision, and a tip moving under review. This plan therefore touches **none** of `shared/roster.ts`, `shared/roster-json.mjs`, `deploy/account-op.mjs`, `ccd/ccrc`'s `cmd_account`, `shared/providers.ts`, `ApiKeyModels`, `ModelMap`, `MODEL_ALIASES` or `exec.models` — none of which exist on `main`. `/home/mfastovets/worktrees/ccrc-pwa/plain-hollow` is that branch's live worktree: **READ ONLY**, consulted only to keep this design's names distinct from its landed `ApiKeyModels`/`selectable`/`provider`, and to copy `MODEL_ID_RE` verbatim (Task 2 does, with a comment naming its origin).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Paths in every task from Task 2 on are relative to the repo root of the implementation worktree**, which is `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl` — except Tasks 13–16, which are relative to the monorepo root `/mnt/HC_Volume_105751470/projects/OpenClawHetzner` and say so in their own **Files** block. Run every `npx vitest` from the package directory named in the step (`server/`, `agent/`).
- **The registry is a FILE, not a roster field.** `~/.ccrc/models/<accountId>.classes.json`, created by `ccrc models <id> init <probe>` and edited only by the verbs. Nothing in this plan writes `~/.ccrc/accounts.json`. `deploy/models-op.mjs` READS the roster (for `configDirSuffix`, `telemetry` and "does this id exist") through `shared/roster-json.mjs` and never writes it.
- **Fixture HOMEs only.** Never run `ccd`, `ccrc`, `ccrc-models-probe`, `deploy.sh`, `systemctl` or a probe against the real `$HOME`. Never touch the live `~/.ccrc`, `~/.cc-limits`, `~/.cc-sessions` or `~/.handoff`. ccrc tests build a throwaway HOME with `mkTmp` and run the tool through `<home>/ccrc/ccd/ccrc` — the `installCcrc()` / `ghContainedEnv` / `runCcrc()` shape at `server/test/ccrc-doctor-graphify.test.ts:70-110`, which is `main`'s idiom for exercising `ccd/ccrc` from a fixture box.
- **TDD, red first, with a measured mutation check per guard.** Each guard's test is written and shown failing before the code exists, and every guard carries a mutation step: flip the guard, run the named file, observe the named case go red, restore. The repo's idiom for recording a mutation is `server/test/ccd-default-pool.test.ts:20-52` — that file **is on `origin/main`** (measured 2026-09-08: `ls server/test/ccd-default-pool.test.ts` in the `origin/main` checkout lists it), so read it in the worktree, copy its header shape, and do not `import` from it.
- **No `D-<n>` deviation numbers may be invented.** `server/test/deviation-refs.test.ts` forbids an unallocated marker. Where a deviation is genuinely needed, write "(deviation to be allocated at execution via `~/.local/bin/ccrc-api ledger allocate`)". This plan needs none.
- **Provenance markers.** After ANY edit to a file whose line 2 is a `# ccrc:generated` marker, re-stamp it. Measured 2026-09-08 on `origin/main`: `ccd/ccd` carries one (`sed -n 2p ccd/ccd`), `ccd/ccrc` does **not**. This plan edits `ccd/ccrc` and never `ccd/ccd`, so no re-stamp is required; check with `sed -n 2p <file>` before assuming that for any file you add.
- **Single definition.** `server/test/single-definition.test.ts` registers every SECOND READER of a file by name (`holdersOf(needle)` over the bash corpus; the idiom is its "one bash reader of ~/.ccrc/build.json" describe). Task 12 registers every path this plan gives a second reader.
- **Commit per task**, message `type(scope): one sentence in the tree's voice`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `git add -A` across unrelated files — every commit step below lists its paths.
- **Comment discipline.** Comments state measured facts and the WHY. A comment must not spell a helper's name before its definition when a test locates that helper by first occurrence — `deploy/deploy.sh` and `agent/test/deploy-verify.test.ts` both do this.
- **Alias-only rule (spec §6.1).** Settings files may name only `haiku|sonnet|opus|fable|default` in `model`, `CLAUDE_CODE_SUBAGENT_MODEL` and any `ANTHROPIC_*MODEL` key. Concrete ids live in the registry file and reach a lane only through the env block the materialiser owns. Task 3 makes this a test.
- **The sentinel lives in the env block and nowhere else (spec §6.1).** `ccrc-unavailable-<class>` is written into `settings.json` so an in-session `/model fable` on a lane with no Fable fails with a name that says what is missing. **No branching reader may ever test for it.** Availability comes from `available` (the `DerivedModels` field) in TypeScript and node, and from the **third column of `<id>.classes.tsv`** in bash. A test that greps for the sentinel to decide anything is a bug in the test.
- **Exit codes for every ccrc verb:** 0 ok; 1 the tool ran and the answer was bad; 2 a usage error. `ccd/ccrc:1153-1157` (`_ccrc_die`, `_ccrc_usage_die`) are the two shapes on `main`; this plan's `cmd_models` adds `_models_refuse <class> <code> <detail>`, whose contract is exactly one JSON object on stdout with the human remedy on stderr.
- **Non-goals in this plan** (and in every plan of this design): the Gemini provider; per-model effort controls in the UI; an Anthropic catalogue probe; the K3 lane; `_ws_least_loaded`'s scoring. Plan 2 owns ccd's class carry and `ccd swap --as-class`; Plan 3a owns the server routes, the PWA surfaces and `ccrc doctor`; Plan 3b owns `SwapSheet.tsx`.

## Skeleton deviations (accepted)

Settled 2026-09-08 by the round-2 revision pass over Plans 1, 2, 3a and 3b. Each
entry below is a place where the repo genuinely forces a reading the skeleton's
round-2 rulings do not literally say. No locked NAME is changed by any of them,
and **no `D-<n>` number is allocated**.

**WITHDRAWN by rulings round 2** — do not look for these in any plan, and remove
any reference a reviewer's notes still carry: **A-1** (`deploy/models-op.mjs` was
justified by conflict-avoidance against `deploy/account-op.mjs`; that file is not
on `main` at all, so the reason is now simply "this design's node half has no
existing file to live in" — see B-0 below); **A-3**, **A-4**, **A-5**, **A-6**
(all about `RosterWire`, `provider` on the wire, `isModelClass` and a `shortlist`
array in a PATCH body — the roster no longer carries the registry, and `shortlist`
is `discovery`; Plan 3a restates whatever it needs); **A-7** (the mutation-check
idiom was to be read on `origin/main` because the base branch lacked
`ccd-default-pool.test.ts`; the base IS `origin/main` now, and the file is in the
tree).

**A-2 — `shared/litellm.mjs` + `shared/litellm.d.mts`, the pure §6.3 renderer.** (owned by Plan 1)
The skeleton names `deploy/litellm-config.template.yaml` and the verb
`ccrc models litellm <id>` but not the function that renders one into the other.
A pure function is what lets the render be tested without writing `~/.handoff/`.
Plans 2, 3a and 3b never reference it.

**A-8 — Plan 2's class guard sits on `_swap_target`'s single `_avail "$cand" || continue` rung.** (owned by Plan 2)
Kept as written: the skeleton says the rotation skips a lane "both brackets", and
the measured post-#62 shape has ONE candidate loop with the `best`/`obest` split
happening after it. Plan 1 does not touch that file.

**B-0 — `deploy/models-op.mjs` is a NEW file with no predecessor.** (owned by Plan 1)
`deploy/account-op.mjs` does not exist on `origin/main`; it is the
account-connections branch's. So this design's node half is simply a new file. It
still copies, and cites, the idioms `main` already uses for a node helper `ccrc`
shells out to: `deploy/gen-accounts.mjs`'s "print the remedy on stderr, exit
non-zero" contract (`ccd/ccrc:3955-3962` reads it verbatim) and `ccrc-adopt`'s
`--out PATH` / unknown-flag-is-exit-2 argument loop (`ccd/ccrc-adopt:97-105`).

**B-1 — an UNSEEDED registry is legal on disk.** (owned by Plan 1)
Spec §10 says `init <probe>` "creates the registry file" for all three probe
kinds, and only `codex` carries a seed mapping. A registry with four null classes
cannot satisfy the round-2 rules "`subagent`'s slot is non-null" and "`discovery`
is a non-empty list" as written, so `init openrouter` would have nothing legal to
write. The two rules are therefore CONDITIONAL on the registry being seeded:
**when every class is null, `subagent` may name any class and `discovery` may be
the empty list**; the moment any class is non-null both rules apply in full. An
unseeded registry materialises to nothing (`modelEnvBlock` still refuses "a lane
needs at least one class", so no env block is written and `materialise` answers
`wrote: null`) and reads as "every class unavailable" — which is exactly §13.1's
migration state. Nothing else in the round-2 validator moves.

**B-2 — the catalogue's provider field is `probe: ProbeKind`.** (owned by Plan 1)
Spec §4.2's example writes `"provider": "openai"`, but `openai` is an
account-connections `ProviderId` and `shared/providers.ts` is not on `main`;
round-2 ruling 10 keys probes by `registry.probe` and not by a roster provider.
The catalogue therefore records **which probe produced it** — `codex |
openrouter | compatible` — under the key `probe`. Plan 3a's wire summary is
`{fetchedAt, stale, count}` and never carries this field, so the rename is
internal to this plan and the probe.

**B-3 — "is this an Anthropic lane?" is `telemetry === 'anthropic'`.** (all plans)
`availableFor(reg, catalogue, anthropic)` takes the answer as a boolean because
the roster on `main` has no `exec.provider` to derive it from (`shared/roster.ts:65-68`:
`ExecSpec` is `upstream | generated | external`, with no provider field). The
roster's own declaration of an Anthropic account is `telemetry: 'anthropic'`
(`shared/roster.ts:84-88`, the field `limits.ts` scores on), and `gpt` carries
`telemetry: 'none'`. Every caller in this plan computes the boolean that way, in
one place per program, and says so in a comment.

**B-4 — `refresh` and `litellm` are reserved words in `ccrc models`' first slot.** (owned by Plan 1)
Spec §10's grammar is `ccrc models <id> <sub>` for the per-lane verbs and
`ccrc models refresh|litellm …` for the box-wide ones, and an account id may
legally be the string `refresh` (`ID_RE` is `^[a-z][a-z0-9-]{0,31}$`). The first
token after `models` is therefore read as a box-wide subcommand when it is one of
those two words, and as an account id otherwise; an account actually named
`refresh` or `litellm` is refused by name, at exit 2, with the collision stated.
Task 7 tests both halves.

## Gating and ordering (BINDING — skeleton rulings, rounds 1 and 2)

1. **Plan 1 is NOT gated on anything.** It branches from `origin/main` and
   touches neither ccd's swap/spawn path nor the account-connections branch
   (spec §14). Ruling 280 is what put it on `origin/main`; a later decision to
   fold `classes` into `exec.models` as an optional sibling is a separate
   change, after that branch merges, with its owner.
2. **Plan 2 is gated on account-pools PR #62 being MERGED AND DEPLOYED**, adds
   `class` to wave 2b's registry field inventory before any write site exists,
   reads it through a dedicated `_reg_read_class` rather than `_reg_get`'s fold,
   and writes the class filter as the THIRD predicate in `_swap_target`'s
   composed chain after reading wave 2b's crossing section. Plan 1 must leave
   `_swap_target`, `cmd_swap`, `cmd_start`, `cmd_enable`, `cmd_prefer` and
   `cmd_ensure` alone — it does: it edits `ccd/ccrc`, never `ccd/ccd`.
3. **Plan 3a follows Plan 1**; **Plan 3b is gated on account-pools wave 4's
   merge sha.** Plan 1 creates nothing under `server/src` or `pwa/src`.
4. **Null and retired stay distinct.** A retired id never empties a class slot;
   `retired` is a positive derived list, `available` is what routing consumes,
   and the TSV's third column is where bash reads it. No task writes code that
   nulls a slot on retirement.

---

## Task 1: The implementation worktree, from `origin/main`, and a green baseline

**Files:**
- Create (worktree): `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl`
- Read only: `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/deploy-clone` (the clone of `Synapsium-Labs/ccrc-pwa`; `git remote -v` there names `https://github.com/Synapsium-Labs/ccrc-pwa.git`)
- Test: `server/test/roster.test.ts` (run, not edited)

**Interfaces:**
- Consumes: nothing.
- Produces: the worktree every later task in this plan and in Plans 2, 3a and 3b works in, on branch `feat/model-class-registry-impl` cut from `origin/main`; three installed `node_modules` trees (`server/`, `pwa/`, `agent/`).

- [ ] **Step 1: Fetch and create the worktree from `origin/main`**

```bash
git -C /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/deploy-clone fetch origin && git -C /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/deploy-clone worktree add -b feat/model-class-registry-impl /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl origin/main
```

Expected: `Preparing worktree (new branch 'feat/model-class-registry-impl')` followed by `HEAD is now at <sha> …`.

**Do NOT branch from `ws/gemini-subscription-account-connection`.** Ruling 280 settled that: no PR open, 9 of 29 tasks done, a three-file conflict with `main` awaiting an operator decision, and a tip moving under review. If a previous run of this plan created the worktree from that branch, remove it (`git -C <deploy-clone> worktree remove --force <path>` and `git -C <deploy-clone> branch -D feat/model-class-registry-impl`) and redo this step.

- [ ] **Step 2: Gate on the base being what this plan was written against**

This plan writes a NEW file for the registry and touches none of the
account-connections types. The check below is the inverse of the old one: it
proves those types are ABSENT, so a stray rebase onto that branch is caught here
rather than as a mystifying type error in Task 2.

```bash
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl && \
  test ! -e shared/providers.ts && \
  test ! -e deploy/account-op.mjs && \
  ! grep -q "ApiKeyModels" shared/roster.ts && \
  ! grep -q "ACCT_SUBS=" ccd/ccrc && \
  test -f server/test/ccd-default-pool.test.ts && \
  test -f shared/roster-json.mjs && \
  echo "BASELINE OK (origin/main): $(git rev-parse --short HEAD)"
```

Expected: `BASELINE OK (origin/main): <sha>`.

If any check fails, **STOP the whole plan** and report which: a present
`shared/providers.ts` or `deploy/account-op.mjs` means the worktree is on the
account-connections branch, which ruling 280 forbids as a base; a missing
`server/test/ccd-default-pool.test.ts` means the base is older than the
2026-09-07 overflow work and every mutation-check step's cited idiom is absent.

- [ ] **Step 3: Install dependencies in the three packages**

```bash
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl/server && npm ci
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl/pwa && npm ci
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl/agent && npm ci
```

Expected: each ends with `added N packages …` and exit 0.

- [ ] **Step 4: Prove the baseline is green with one named test file**

```bash
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl/server && npx vitest run test/roster.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  N passed (N)` with N > 40, exit 0. A red baseline means `origin/main` is broken; stop and report rather than "fixing" it inside this plan.

- [ ] **Step 5: Record the baseline sha in the task report**

```bash
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl && git log --oneline -1
```

Expected: one line, the tip of `origin/main`. Write that sha into your task report — every later task's diff is read against it. No commit in this task: creating a worktree is not a tree change.

---

## Task 2: `shared/models.ts` — the Registry, the catalogue, the derived states, and the bare-`node` twin

**Files:**
- Create: `shared/models.ts`, `shared/models.mjs`, `shared/models.d.mts`
- Create: `server/test/fixtures/modelCases.ts`, `server/test/models.test.ts`
- Test: `server/test/models.test.ts`

**Interfaces:**
- Consumes: nothing. `shared/models.ts` is L0 and imports NO module at all — not `node:*`, not a sibling. `shared/providers.ts` does not exist on `origin/main`, and `CLASSES` lives here rather than in `shared/roster.ts` because ruling 280 keeps this design out of the roster entirely.
- Produces, exported from `shared/models.ts` and mirrored in `shared/models.mjs`:
  ```ts
  export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
  export type ModelClass = (typeof CLASSES)[number];
  export type ClassMap = Record<ModelClass, string | null>;
  export type EffortMap = Partial<Record<ModelClass, string>>;
  export const PROBE_KINDS = ['codex', 'openrouter', 'compatible'] as const;
  export type ProbeKind = (typeof PROBE_KINDS)[number];
  export type Discovery = 'catalogue' | readonly string[];
  export const MODEL_ID_RE: RegExp;
  export interface Registry { probe: ProbeKind; classes: ClassMap; subagent: ModelClass;
    discovery: Discovery; effort?: EffortMap; baseUrl?: string }
  export class RegistryInvalid extends Error { readonly field: string }
  export function parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry;
  export interface CatalogueModel { id: string; label: string; context: number | null; maxContext: number | null;
    efforts: string[]; hidden: boolean; priceIn: number | null; priceOut: number | null }
  export interface Catalogue { probe: ProbeKind; fetchedAt: number; stale: boolean; lastError?: string; models: CatalogueModel[] }
  export class CatalogueInvalid extends Error {}
  export function parseCatalogue(json: unknown): Catalogue;
  export interface DerivedModels { classified: string[]; unclassified: string[]; retired: string[]; available: ModelClass[] }
  export function resolveDiscovery(reg: Registry, catalogue: Catalogue | null): string[];
  export function deriveModels(reg: Registry | null, catalogue: Catalogue | null): DerivedModels;
  export function availableFor(reg: Registry | null, catalogue: Catalogue | null, anthropic: boolean): ModelClass[];
  export function familyClassOf(anthropicModelId: string): ModelClass | null;
  export function classOfModel(reg: Registry, modelId: string): ModelClass | null;
  export const UNAVAILABLE_PREFIX = 'ccrc-unavailable-';
  ```
  Task 3's materialiser, Task 6's node half, Plan 2's `ccd/ccd` bash reader and Plan 3a's server and PWA all consume these names.
  **Do NOT also export `isModelClass` here.** That runtime predicate is Plan 3a Task 1's to add (its Step 2 measures `shared/models.ts` NOT exporting it as the red), and nothing in this plan needs it: every class check below is `CLASSES.includes(...)` at the site that makes it.

- [ ] **Step 1: Write the shared case table**

Create `server/test/fixtures/modelCases.ts`:

```ts
// ONE table, THREE readers: `shared/models.ts`, `shared/models.mjs`, and (from
// Plan 2) `ccd/ccd`'s bash reader of the TSV this same registry produces.
// `server/test/fixtures/leastLoaded.ts`'s pattern and its reason: two
// implementations compared to the same expectation AND to each other, so a
// change to either alone reds.
//
// The Codex rows are the catalogue measured 2026-09-08 (spec §1): nine models,
// of which `gpt-reserve` and `codex-auto-review` are hidden.
import type { Catalogue, DerivedModels, Registry } from '../../../shared/models.js';

const m = (id: string, hidden = false, efforts: string[] = ['low', 'medium', 'high', 'xhigh', 'max']) =>
  ({ id, label: id, context: 272000, maxContext: 272000, efforts, hidden, priceIn: null, priceOut: null });

export const CODEX: Catalogue = {
  probe: 'codex', fetchedAt: 1789000000, stale: false,
  models: [
    { ...m('gpt-6-astra'), maxContext: 872000, efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    m('gpt-5.6-sol'), m('gpt-5.6-terra'), m('gpt-5.6-luna'),
    m('gpt-5.5'), m('gpt-5.4-mini'),
    { ...m('gpt-5.3-codex-spark'), context: 128000, maxContext: 128000 },
    m('gpt-reserve', true), m('codex-auto-review', true),
  ],
};

/** The same catalogue, marked stale — the previous one kept after a failed
 *  probe (§11). `retired` must go EMPTY on it: absence from a catalogue
 *  nobody could refresh is not evidence a model is gone. */
export const CODEX_STALE: Catalogue = { ...CODEX, stale: true, lastError: 'HTTP 401' };

/** Today's seeded gpt registry (§13.1): luna/terra/sol, fable null, subagent
 *  the SONNET slot by explicit choice (§4.1, ruling 5c — never derived). */
export const SEEDED: Registry = {
  probe: 'codex',
  classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },
};

/** What `ccrc models <id> init openrouter` writes: a legal but UNSEEDED
 *  registry (deviation B-1). Every class null, so the "subagent's slot is
 *  non-null" and "discovery is non-empty" rules stand down until one is set. */
export const UNSEEDED: Registry = {
  probe: 'openrouter',
  classes: { haiku: null, sonnet: null, opus: null, fable: null },
  subagent: 'sonnet',
  discovery: [],
};

export interface ModelCase {
  why: string;
  reg: Registry | null;
  catalogue: Catalogue | null;
  expect: DerivedModels;
}

export const modelCases: readonly ModelCase[] = [
  {
    why: 'the seeded gpt lane against today\'s catalogue: four unclassified, no fable',
    reg: SEEDED, catalogue: CODEX,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
      unclassified: ['gpt-6-astra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: [],
      available: ['haiku', 'sonnet', 'opus'],
    },
  },
  {
    why: 'hidden models are excluded from a "catalogue" discovery list',
    reg: { probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null },
      subagent: 'sonnet', discovery: 'catalogue' },
    catalogue: CODEX,
    expect: {
      classified: [],
      unclassified: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
        'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: [],
      available: [],
    },
  },
  {
    why: 'a classed id absent from a fresh catalogue is retired, and its class unavailable',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.5-mini', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'haiku', discovery: 'catalogue',
    },
    catalogue: CODEX,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.5-mini', 'gpt-5.6-sol'],
      unclassified: ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: ['gpt-5.5-mini'],
      available: ['haiku', 'opus'],
    },
  },
  {
    why: 'a STALE catalogue retires nothing — absence is not evidence when the probe failed',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.5-mini', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'haiku', discovery: 'catalogue',
    },
    catalogue: CODEX_STALE,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.5-mini', 'gpt-5.6-sol'],
      unclassified: ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: [],
      available: ['haiku', 'sonnet', 'opus'],
    },
  },
  {
    why: 'never probed: a "catalogue" discovery list resolves to nothing, and nothing retires',
    reg: SEEDED, catalogue: null,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
      unclassified: [], retired: [],
      available: ['haiku', 'sonnet', 'opus'],
    },
  },
  {
    why: 'an explicit discovery list survives a never-probed lane',
    reg: {
      probe: 'openrouter',
      classes: { haiku: 'v/h', sonnet: 'v/s', opus: null, fable: null },
      subagent: 'sonnet', discovery: ['v/h', 'v/s', 'v/x'],
    },
    catalogue: null,
    expect: {
      classified: ['v/h', 'v/s'], unclassified: ['v/x'], retired: [],
      available: ['haiku', 'sonnet'],
    },
  },
  {
    why: 'no registry file at all reads as every class unavailable (§13.1)',
    reg: null, catalogue: CODEX,
    expect: { classified: [], unclassified: [], retired: [], available: [] },
  },
  {
    why: 'an UNSEEDED registry is the same answer, and is not an error',
    reg: UNSEEDED, catalogue: null,
    expect: { classified: [], unclassified: [], retired: [], available: [] },
  },
  {
    why: 'a hidden model that is EXPLICITLY discovered is offered, and is not retired',
    reg: {
      probe: 'codex',
      classes: { haiku: null, sonnet: null, opus: null, fable: 'gpt-reserve' },
      subagent: 'fable', discovery: ['gpt-reserve'],
    },
    catalogue: CODEX,
    expect: { classified: ['gpt-reserve'], unclassified: [], retired: [], available: ['fable'] },
  },
  {
    why: 'every class retired leaves available EMPTY without nulling a single slot',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gone-a', sonnet: 'gone-b', opus: 'gone-c', fable: 'gone-d' },
      subagent: 'sonnet', discovery: ['gone-a', 'gone-b', 'gone-c', 'gone-d'],
    },
    catalogue: CODEX,
    expect: {
      classified: ['gone-a', 'gone-b', 'gone-c', 'gone-d'],
      unclassified: [],
      retired: ['gone-a', 'gone-b', 'gone-c', 'gone-d'],
      available: [],
    },
  },
];
```

- [ ] **Step 2: Write the failing test file**

Create `server/test/models.test.ts`:

```ts
// `shared/models.ts` — the registry file's type and validator (§4.1), the
// catalogue's (§4.2) and the derived states (§4.3) — and its bare-`node` twin.
// The twin exists because `ccd/ccrc-models-probe`'s helpers, `deploy/
// models-op.mjs` and (Plan 2) ccd's own reader all run under a bare `node`
// that cannot load a `.ts`; the `.ts` is what the server and the PWA bundle.
// Neither is allowed to differ: both are driven over `modelCases` and compared
// to each other, `shared/wrapper.mjs` / `shared/generate.mjs`'s arrangement in
// this tree and its reason — a twin that is stricter in one direction refuses
// a lane the other routes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASSES, CatalogueInvalid, PROBE_KINDS, RegistryInvalid, UNAVAILABLE_PREFIX,
  availableFor, classOfModel, deriveModels, familyClassOf, parseCatalogue,
  parseRegistry, resolveDiscovery,
} from '../../shared/models.js';
import {
  availableFor as availableForMjs, classOfModel as classOfModelMjs,
  deriveModels as deriveModelsMjs, familyClassOf as familyClassOfMjs,
  parseCatalogue as parseCatalogueMjs, parseRegistry as parseRegistryMjs,
  resolveDiscovery as resolveDiscoveryMjs,
} from '../../shared/models.mjs';
import { CODEX, SEEDED, UNSEEDED, modelCases } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const clone = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe('the case table this drives is real', () => {
  it('covers every derived state in both directions', () => {
    // A table where nothing is ever retired, or every lane is available, lets
    // half the derivation be deleted silently. `single-definition.test.ts`'s
    // "the name list this scans is real" reasoning.
    expect(modelCases.length).toBeGreaterThanOrEqual(10);
    expect(modelCases.some((c) => c.expect.retired.length > 0)).toBe(true);
    expect(modelCases.some((c) => c.expect.retired.length === 0)).toBe(true);
    expect(modelCases.some((c) => c.expect.available.length === 3)).toBe(true);
    expect(modelCases.some((c) => c.expect.available.length === 0)).toBe(true);
    expect(modelCases.some((c) => c.expect.unclassified.length > 0)).toBe(true);
    expect(modelCases.some((c) => c.catalogue?.stale === true)).toBe(true);
    expect(modelCases.some((c) => c.catalogue === null)).toBe(true);
    expect(modelCases.some((c) => c.reg === null)).toBe(true);
  });
});

describe('deriveModels', () => {
  it.each(modelCases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    expect(deriveModels(c.reg, c.catalogue)).toEqual(c.expect);
  });

  it('the bare-node twin answers identically, row for row', () => {
    for (const c of modelCases) {
      expect(deriveModelsMjs(c.reg, c.catalogue), c.why).toEqual(c.expect);
      expect(deriveModelsMjs(c.reg, c.catalogue), `twins disagree: ${c.why}`)
        .toEqual(deriveModels(c.reg, c.catalogue));
    }
  });

  it('a retired class NEVER empties its slot — retirement is a separate fact', () => {
    // Ruling 4 of the skeleton, and §4.3: `retired` is positive, `available` is
    // what routing consumes, and the operator's own assignment survives a
    // provider withdrawing a model.
    const c = modelCases.find((x) => x.expect.retired.length === 4)!;
    expect(deriveModels(c.reg, c.catalogue).available).toEqual([]);
    expect(c.reg!.classes.opus).toBe('gone-c');
  });
});

describe('availableFor — the ONE place "anthropic lanes have all four" lives', () => {
  it('is all four on an anthropic lane, whatever the registry says', () => {
    // §4.1, decision 4: their classes are Claude Code's own defaults and there
    // is no registry file. The boolean comes from the CALLER because the roster
    // on main has no provider field to derive it from (deviation B-3).
    expect(availableFor(null, null, true)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
    expect(availableFor(SEEDED, CODEX, true)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });

  it('is deriveModels\' answer on every other lane', () => {
    expect(availableFor(SEEDED, CODEX, false)).toEqual(['haiku', 'sonnet', 'opus']);
    expect(availableFor(null, CODEX, false)).toEqual([]);
    expect(availableFor(UNSEEDED, null, false)).toEqual([]);
  });

  it('the twin agrees on all four', () => {
    expect(availableForMjs(null, null, true)).toEqual(availableFor(null, null, true));
    expect(availableForMjs(SEEDED, CODEX, false)).toEqual(availableFor(SEEDED, CODEX, false));
  });
});

describe('resolveDiscovery', () => {
  it('"catalogue" is the VISIBLE ids, in catalogue order', () => {
    expect(resolveDiscovery(SEEDED, CODEX)).toEqual([
      'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
    ]);
  });

  it('"catalogue" with no catalogue is EMPTY, not "everything"', () => {
    // Absent file = never probed, a distinct state from an empty catalogue
    // (§4.2). Resolving it to the classed ids would make `unclassified`
    // silently empty and hide the whole reason this design exists.
    expect(resolveDiscovery(SEEDED, null)).toEqual([]);
  });

  it('an explicit list is returned as written', () => {
    const reg = { ...UNSEEDED, discovery: ['b', 'a'] };
    expect(resolveDiscovery(reg, CODEX)).toEqual(['b', 'a']);
  });

  it('the twin agrees on all three', () => {
    expect(resolveDiscoveryMjs(SEEDED, CODEX)).toEqual(resolveDiscovery(SEEDED, CODEX));
    expect(resolveDiscoveryMjs(SEEDED, null)).toEqual([]);
  });
});

describe('parseRegistry (§4.1)', () => {
  const good = (): Record<string, unknown> => clone(SEEDED) as Record<string, unknown>;

  it('round-trips the seeded gpt registry', () => {
    expect(parseRegistry(good())).toEqual(SEEDED);
    expect(parseRegistryMjs(good())).toEqual(SEEDED);
  });

  it('round-trips an UNSEEDED registry — every class null is legal (deviation B-1)', () => {
    expect(parseRegistry(clone(UNSEEDED))).toEqual(UNSEEDED);
  });

  it.each(['haiku', 'sonnet', 'opus', 'fable'] as const)(
    'refuses a registry missing the %s slot, naming it', (cls) => {
      const r = good();
      const classes = { ...(r['classes'] as Record<string, unknown>) };
      delete classes[cls];
      r['classes'] = classes;
      expect(() => parseRegistry(r)).toThrow(new RegExp(`classes\\.${cls}`));
    });

  it.each([
    ['a leading slash', '/vendor/opus'],
    ['a space', 'vendor/opus 1'],
    ['a quote', 'vendor/"opus"'],
    ['the empty string', ''],
  ] as const)('refuses %s as a class id', (_why, bad) => {
    const r = good();
    (r['classes'] as Record<string, unknown>)['opus'] = bad;
    expect(() => parseRegistry(r)).toThrow(/classes\.opus/);
  });

  it('accepts the punctuation OpenRouter ids are made of', () => {
    const r = good();
    (r['classes'] as Record<string, unknown>)['opus'] = 'anthropic/claude-opus-4.5:beta';
    expect(parseRegistry(r).classes.opus).toBe('anthropic/claude-opus-4.5:beta');
  });

  it('refuses an unknown probe kind, naming the three', () => {
    const r = good(); r['probe'] = 'gemini';
    expect(() => parseRegistry(r)).toThrow(/codex, openrouter, compatible/);
  });

  it('requires baseUrl when the probe is compatible, and refuses it as empty', () => {
    // Round-2 ruling 10: `compatible` reads its endpoint from the registry file
    // until `exec.baseUrl` exists on main — nothing else on this box knows one.
    const r = good(); r['probe'] = 'compatible';
    expect(() => parseRegistry(r)).toThrow(/baseUrl/);
    r['baseUrl'] = '';
    expect(() => parseRegistry(r)).toThrow(/baseUrl/);
    r['baseUrl'] = 'https://api.cortecs.ai';
    expect(parseRegistry(r).baseUrl).toBe('https://api.cortecs.ai');
  });

  it('accepts baseUrl on a codex or openrouter registry but never requires it', () => {
    expect(parseRegistry(good()).baseUrl).toBeUndefined();
  });

  it('refuses a subagent that is not a class', () => {
    const r = good(); r['subagent'] = 'sonnet-class';
    expect(() => parseRegistry(r)).toThrow(/subagent/);
  });

  it('refuses a subagent naming a NULL slot on a seeded registry (§4.1)', () => {
    // The env block resolves CLAUDE_CODE_SUBAGENT_MODEL to classes[subagent]
    // (§6.1). A subagent pointing at a null slot is a lane whose subagents run
    // on a sentinel.
    const r = good(); r['subagent'] = 'fable';
    expect(() => parseRegistry(r)).toThrow(/subagent/);
  });

  it('ALLOWS a subagent naming a null slot when EVERY slot is null (deviation B-1)', () => {
    expect(() => parseRegistry(clone(UNSEEDED))).not.toThrow();
  });

  it('there is no `selectable` field, and an unknown key is refused by name', () => {
    // `selectable` is the account-connections branch's picker PERMISSION and
    // is deliberately NOT this design's `discovery` (§2, ruling 280). A file
    // carrying it is a file somebody confused the two in.
    const r = good(); r['selectable'] = ['gpt-5.5'];
    expect(() => parseRegistry(r)).toThrow(/selectable/);
  });

  it('refuses an empty discovery list on a SEEDED registry', () => {
    const r = good(); r['discovery'] = [];
    expect(() => parseRegistry(r)).toThrow(/discovery/);
  });

  it('refuses a duplicate in the discovery list', () => {
    const r = good(); r['discovery'] = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-sol'];
    expect(() => parseRegistry(r)).toThrow(/gpt-5\.6-sol/);
  });

  it('refuses a non-null class id the explicit discovery list does not offer', () => {
    // A routing target nothing discovered is a lane that answers `/model opus`
    // with a model no surface ever showed (§4.1).
    const r = good(); r['discovery'] = ['gpt-5.6-luna', 'gpt-5.6-terra'];
    expect(() => parseRegistry(r)).toThrow(/gpt-5\.6-sol/);
  });

  it('does not require a NULL slot to be discovered', () => {
    const r = good(); r['discovery'] = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];
    expect(() => parseRegistry(r)).not.toThrow();
  });

  it('refuses discovery "catalogue" on openrouter, naming the field', () => {
    // Several hundred models is not a discovery scope (§2).
    const r = good(); r['probe'] = 'openrouter'; r['discovery'] = 'catalogue';
    expect(() => parseRegistry(r)).toThrow(/openrouter requires an explicit discovery list/);
  });

  it('accepts discovery "catalogue" on codex and on compatible', () => {
    expect(parseRegistry(good()).discovery).toBe('catalogue');
    const r = good(); r['probe'] = 'compatible'; r['baseUrl'] = 'https://x.example';
    expect(parseRegistry(r).discovery).toBe('catalogue');
  });

  it('refuses an effort key that is not a class', () => {
    const r = good(); r['effort'] = { subagent: 'high' };
    expect(() => parseRegistry(r)).toThrow(/effort\.subagent/);
  });

  it('refuses an empty effort level', () => {
    const r = good(); r['effort'] = { opus: '' };
    expect(() => parseRegistry(r)).toThrow(/effort\.opus/);
  });

  it('validates an effort level AGAINST the catalogue when one is handed in', () => {
    // Luna has no `ultra`; Astra does (§4.1). A lane default the provider
    // rejects turns every turn on that class into a 400.
    const r = good(); (r['effort'] as Record<string, string>)['haiku'] = 'ultra';
    expect(() => parseRegistry(r, CODEX)).toThrow(/effort\.haiku/);
    expect(() => parseRegistry(r, null)).not.toThrow();
  });

  it('accepts an unvalidatable level when the catalogue lists the model with NO efforts', () => {
    // An empty `efforts` is "unknown", never "none offered" — every OpenRouter
    // and `compatible` row is like that.
    const bare = { ...CODEX, models: CODEX.models.map((m) => ({ ...m, efforts: [] })) };
    const r = good(); (r['effort'] as Record<string, string>)['haiku'] = 'ultra';
    expect(() => parseRegistry(r, bare)).not.toThrow();
  });

  it('names the field on RegistryInvalid, not only in the message', () => {
    // The verbs answer "refuses, with the field named" (§10); a machine-readable
    // field is what lets the PATCH route in Plan 3a point at the right control.
    try {
      const r = good(); r['subagent'] = 'fable';
      parseRegistry(r);
      expect.unreachable('parseRegistry accepted a subagent on a null slot');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryInvalid);
      expect((e as RegistryInvalid).field).toBe('subagent');
    }
  });

  it('the twin refuses every one of those too', () => {
    const bad: Record<string, unknown>[] = [];
    const push = (mut: (r: Record<string, unknown>) => void): void => {
      const r = good(); mut(r); bad.push(r);
    };
    push((r) => { r['probe'] = 'gemini'; });
    push((r) => { r['subagent'] = 'fable'; });
    push((r) => { r['discovery'] = []; });
    push((r) => { delete r['classes']; });
    push((r) => { r['selectable'] = ['x']; });
    push((r) => { r['probe'] = 'openrouter'; });
    for (const r of bad) {
      expect(() => parseRegistry(r), JSON.stringify(r)).toThrow();
      expect(() => parseRegistryMjs(r), `twin accepted ${JSON.stringify(r)}`).toThrow();
    }
  });
});

describe('familyClassOf', () => {
  it.each([
    ['claude-fable-5-1', 'fable'],
    ['claude-opus-5-20260801', 'opus'],
    ['claude-sonnet-5-20260514', 'sonnet'],
    ['claude-haiku-4-5-20250101', 'haiku'],
  ] as const)('%s is %s-class', (id, cls) => {
    expect(familyClassOf(id)).toBe(cls);
    expect(familyClassOfMjs(id)).toBe(cls);
  });

  it('a model id with no family token is not classified', () => {
    expect(familyClassOf('gpt-5.6-sol')).toBeNull();
    expect(familyClassOfMjs('gpt-5.6-sol')).toBeNull();
  });

  it('the tokens are matched with their DASHES, so a bare word does not match', () => {
    // `-opus-` and not `opus`: without the dashes a vendor id like `opusml/x`
    // would classify as an Anthropic family.
    expect(familyClassOf('opusml/x')).toBeNull();
    expect(familyClassOf('vendor/sonnetish')).toBeNull();
  });

  it('order is fable, opus, sonnet, haiku — the FIRST match wins', () => {
    expect(familyClassOf('claude-fable-opus-hybrid-1')).toBe('fable');
  });
});

describe('classOfModel', () => {
  it('reverse-looks an id up in the four slots', () => {
    expect(classOfModel(SEEDED, 'gpt-5.6-terra')).toBe('sonnet');
    expect(classOfModelMjs(SEEDED, 'gpt-5.6-terra')).toBe('sonnet');
  });

  it('answers null for an id no class holds, and never matches a null slot', () => {
    expect(classOfModel(SEEDED, 'gpt-6-astra')).toBeNull();
    expect(classOfModel(SEEDED, '')).toBeNull();
  });

  it('the first class in CLASSES order wins when two slots hold one id', () => {
    const both = { ...SEEDED, classes: { haiku: 'x', sonnet: 'x', opus: null, fable: null } };
    expect(classOfModel(both, 'x')).toBe('haiku');
    expect(CLASSES[0]).toBe('haiku');
  });
});

describe('parseCatalogue', () => {
  const good = clone(CODEX);

  it('round-trips a written catalogue', () => {
    expect(parseCatalogue(good)).toEqual(CODEX);
    expect(parseCatalogueMjs(good)).toEqual(CODEX);
  });

  it.each([
    ['a non-object', 7],
    ['an unknown probe kind', { ...CODEX, probe: 'gemini' }],
    ['the account-connections provider spelling', { ...CODEX, probe: 'openai' }],
    ['a missing fetchedAt', { ...CODEX, fetchedAt: undefined }],
    ['a non-array models', { ...CODEX, models: {} }],
    ['a model with no id', { ...CODEX, models: [{ label: 'x' }] }],
    ['a model with a non-string id', { ...CODEX, models: [{ id: 7, label: 'x' }] }],
  ] as const)('refuses %s', (_why, bad) => {
    expect(() => parseCatalogue(bad)).toThrow(CatalogueInvalid);
    expect(() => parseCatalogueMjs(bad)).toThrow();
  });

  it('fills the optional fields rather than demanding them', () => {
    const bare = { probe: 'compatible', fetchedAt: 1, stale: false, models: [{ id: 'x' }] };
    expect(parseCatalogue(bare).models[0]).toEqual({
      id: 'x', label: 'x', context: null, maxContext: null,
      efforts: [], hidden: false, priceIn: null, priceOut: null,
    });
  });
});

describe('the sentinel prefix', () => {
  it('is what the materialiser writes for a null slot (§6.1)', () => {
    expect(UNAVAILABLE_PREFIX).toBe('ccrc-unavailable-');
    for (const c of CLASSES) expect(`${UNAVAILABLE_PREFIX}${c}`).toMatch(/^ccrc-unavailable-[a-z]+$/);
  });

  it('is NOT what anything here branches on', () => {
    // §6.1: the sentinel lives in a SINK. Availability is `available` in TS and
    // node and the TSV's third column in bash. A reader that tested for the
    // string would be a second, silent definition of "unavailable".
    const src = readFileSync(path.join(REPO, 'shared/models.ts'), 'utf8');
    const uses = src.split('\n').filter((l) => l.includes('UNAVAILABLE_PREFIX'));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain('export const UNAVAILABLE_PREFIX');
  });
});

describe('shared/models.ts is L0', () => {
  it('imports NOTHING — the PWA bundles this file and no sibling exists to need', () => {
    const src = readFileSync(path.join(REPO, 'shared/models.ts'), 'utf8');
    expect([...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]!)).toEqual([]);
  });

  it('the twin carries the class list, and it is CLASSES element for element', () => {
    // Source-derived, `server/test/source-bytes.test.ts:5-15`'s rule: the twin
    // cannot import the `.ts`, so the constants it copies are compared as TEXT.
    // The last regex hand-copied between these two languages shipped as raw
    // control bytes with every suite green.
    const src = readFileSync(path.join(REPO, 'shared/models.mjs'), 'utf8');
    const m = /const CLASSES = \[([^\]]*)\];/.exec(src);
    expect(m, 'shared/models.mjs must declare `const CLASSES = [...];`').not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual([...CLASSES]);
  });

  it('the twin carries PROBE_KINDS, element for element', () => {
    const src = readFileSync(path.join(REPO, 'shared/models.mjs'), 'utf8');
    const m = /const PROBE_KINDS = \[([^\]]*)\];/.exec(src);
    expect(m, 'shared/models.mjs must declare `const PROBE_KINDS = [...];`').not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual([...PROBE_KINDS]);
  });

  it('MODEL_ID_RE is the account-connections regex, SOURCE for source, in both files', () => {
    // Round-2 ruling 2: copy that branch's regex with a comment naming its
    // origin, do not import from the branch. Both copies are compared as text
    // to the ONE literal this plan pins, for `source-bytes.test.ts`'s reason.
    const LITERAL = String.raw`/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/`;
    for (const f of ['shared/models.ts', 'shared/models.mjs']) {
      const src = readFileSync(path.join(REPO, f), 'utf8');
      expect(src, `${f} must spell MODEL_ID_RE exactly`).toContain(`MODEL_ID_RE = ${LITERAL}`);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && npx vitest run test/models.test.ts`
Expected: FAIL with `Failed to resolve import "../../shared/models.js"` (and the same for `models.mjs`).

- [ ] **Step 4: Write `shared/models.ts`**

```ts
// The model-class REGISTRY (spec §4.1), the CATALOGUE (§4.2) and the DERIVED
// states (§4.3) — the one place "unclassified", "retired" and "available" are
// computed, so the server, the PWA, the verbs and (Plan 2) ccd's bash reader
// cannot come to three different answers about the same lane.
//
// ── WHY THE REGISTRY IS ITS OWN FILE ─────────────────────────────────────
// `~/.ccrc/models/<accountId>.classes.json`, user-owned, created by
// `ccrc models <id> init <probe>` and edited only by the verbs. Ruling 280
// (2026-09-08): `exec.models`' shape belongs to the account-connections spec,
// whose branch is not on `main`, and any change there is additive and lands
// after that branch merges. So this design restates none of that shape and
// carries its own. If `classes` later folds into `exec.models` as an optional
// sibling, this file becomes the generated mirror's type and nothing here has
// to be re-argued.
//
// ── L0, AND IT IMPORTS NOTHING ───────────────────────────────────────────
// The PWA bundles this file, so no `node:*` and no fs. The catalogue and the
// registry arrive here already parsed from JSON: whoever reads the files off
// disk does the `readFile` and hands the value in. There is no sibling to
// import either — `CLASSES` lives here, not in `shared/roster.ts`, because
// ruling 280 keeps this design out of the roster entirely.
// `server/test/models.test.ts` asserts the empty import list.
//
// Its bare-`node` twin is `shared/models.mjs`, driven over the same case table
// in the same suite.

/** The four classes every model any lane can run is classified into, and the
 *  ONE order every walk over them uses — `classOfModel`'s reverse lookup, the
 *  four lines of `classesTsv`, the env block's key order, and the bash reader
 *  in `ccd/ccd` (Plan 2) all depend on it being the same sequence in each. */
export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type ModelClass = (typeof CLASSES)[number];

/** The four slots, ALWAYS all four keys. `null` means *this class is
 *  unavailable on this lane by nature*, never "use a default" and never
 *  "retired" — retirement is its own derived list (§4.3). The materialiser
 *  writes `ccrc-unavailable-<class>` for a null slot (§6.1), because an UNSET
 *  alias falls through to Anthropic's own id and the proxied backend answers
 *  with an opaque 404: today's Fable-on-gpt failure, measured 2026-09-08. */
export type ClassMap = Record<ModelClass, string | null>;

/** The lane's DEFAULT reasoning effort per class, used when a request names
 *  none (§6.4). Validated against the classed model's own `efforts` only when
 *  a catalogue is handed in — accepted unvalidated otherwise, and flagged by
 *  doctor once one appears (§4.1). */
export type EffortMap = Partial<Record<ModelClass, string>>;

/** Which catalogue PROBE runs for this lane (§5). It names the DISCOVERY
 *  mechanism, not the account-connections `provider` (auth and connection):
 *  round-2 ruling 10 keys probes here and nowhere else. Once `exec.provider`
 *  exists on `main` this defaults from it and a mismatch is a doctor finding. */
export const PROBE_KINDS = ['codex', 'openrouter', 'compatible'] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

/** What discovery and classification operate on. The literal `'catalogue'`
 *  means the whole advertised set (hidden models excluded — §4.2), and is the
 *  default for `codex` and `compatible`; an explicit list is REQUIRED for
 *  `openrouter`, which advertises several hundred models and would make an
 *  "unclassified" badge pure noise (§2).
 *
 *  It is NOT the account-connections `selectable`, which is a picker PERMISSION
 *  (ruling 280): narrowing what an operator may pick must never narrow what the
 *  prober classifies. The two never alias, and a registry file carrying a
 *  `selectable` key is refused by name. */
export type Discovery = 'catalogue' | readonly string[];

/** A model id, as the account-connections branch defines it.
 *
 *  COPIED, not imported: that branch is not on `main` (ruling 280) and this
 *  design must not depend on it. Its origin is `shared/roster.ts:97` on branch
 *  `ws/gemini-subscription-account-connection`, whose own comment records the
 *  reason for the charset — an account id becomes a filename and a bash `case`
 *  pattern and so cannot hold `/`, `.` or `:`, while an OpenRouter model id is
 *  `anthropic/claude-opus-4.5:beta` and holds all three. Capped at 128
 *  characters. `server/test/models.test.ts` compares this literal to the twin's
 *  SOURCE for source, because the last regex hand-copied in this tree shipped
 *  as raw control bytes with every suite green. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

/** One lane's class registry — the whole content of
 *  `~/.ccrc/models/<accountId>.classes.json`. */
export interface Registry {
  probe: ProbeKind;
  classes: ClassMap;
  /** A CLASS NAME, default `sonnet`: what `CLAUDE_CODE_SUBAGENT_MODEL`
   *  resolves to on this lane (§6.1). It is a routing destination the operator
   *  SETS — a class-to-slot map — and never a derivation (ruling 5c). */
  subagent: ModelClass;
  discovery: Discovery;
  effort?: EffortMap;
  /** Required iff `probe` is `compatible`, which ships no default endpoint —
   *  only the operator can know one. Round-2 ruling 10; it moves to
   *  `exec.baseUrl` once that exists on `main`. */
  baseUrl?: string;
}

/** Thrown by `parseRegistry`. Carries the offending FIELD as data, not only in
 *  the sentence: the verbs' contract is "refuses, with the field named" (§10),
 *  and Plan 3a's PATCH route points a UI control at it. */
export class RegistryInvalid extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'RegistryInvalid';
    this.field = field;
  }
}

/** One model as a probe recorded it. Everything but `id` is best effort: an
 *  OpenRouter row has prices and no efforts, a Codex row has efforts and no
 *  prices, and a `compatible` `/v1/models` row has neither. `null` is
 *  "unknown", never "zero". */
export interface CatalogueModel {
  id: string;
  label: string;
  context: number | null;
  maxContext: number | null;
  efforts: string[];
  hidden: boolean;
  priceIn: number | null;
  priceOut: number | null;
}

/** `~/.ccrc/models/<accountId>.json`. An ABSENT file is "never probed" and is
 *  a distinct state from an empty `models` — which is why every function here
 *  takes `Catalogue | null` rather than defaulting one. `stale: true` means the
 *  last probe failed and this is the previous catalogue (§11).
 *
 *  `probe`, not `provider`: spec §4.2's example predates round-2 ruling 10,
 *  and `openai` is an account-connections `ProviderId` this branch has no
 *  access to. The field records WHICH PROBE PRODUCED THIS FILE (deviation
 *  B-2), which is the only thing any reader here asks of it. */
export interface Catalogue {
  probe: ProbeKind;
  fetchedAt: number;
  stale: boolean;
  lastError?: string;
  models: CatalogueModel[];
}

/** Thrown by `parseCatalogue`. A GENERATED file, so a bad one is a bug in the
 *  probe and not an operator's typo — there is no field to name and no remedy
 *  to offer beyond "re-probe". */
export class CatalogueInvalid extends Error {
  constructor(message: string) { super(message); this.name = 'CatalogueInvalid'; }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Validates a catalogue read off disk and fills its optional fields. Refuses
 *  the WHOLE file on a model with no `id` (§11): a partial catalogue would
 *  retire every model the probe happened to drop, which is a warning on every
 *  surface about models that answer fine. */
export function parseCatalogue(json: unknown): Catalogue {
  if (!isObj(json)) throw new CatalogueInvalid('a catalogue must be an object');
  const probe = json['probe'];
  if (typeof probe !== 'string' || !(PROBE_KINDS as readonly string[]).includes(probe)) {
    throw new CatalogueInvalid(
      `unknown catalogue probe ${JSON.stringify(probe)}: it must be one of ${PROBE_KINDS.join(', ')}`);
  }
  const fetchedAt = json['fetchedAt'];
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    throw new CatalogueInvalid('a catalogue needs a numeric fetchedAt');
  }
  const modelsRaw = json['models'];
  if (!Array.isArray(modelsRaw)) throw new CatalogueInvalid('a catalogue needs a models array');
  const models: CatalogueModel[] = modelsRaw.map((raw, i) => {
    if (!isObj(raw) || typeof raw['id'] !== 'string' || raw['id'].length === 0) {
      throw new CatalogueInvalid(`catalogue models[${i}] has no id`);
    }
    const id = raw['id'];
    const label = typeof raw['label'] === 'string' && raw['label'].length > 0 ? raw['label'] : id;
    const efforts = Array.isArray(raw['efforts'])
      ? raw['efforts'].filter((e): e is string => typeof e === 'string')
      : [];
    return {
      id, label,
      context: num(raw['context']),
      maxContext: num(raw['maxContext']),
      efforts,
      hidden: raw['hidden'] === true,
      priceIn: num(raw['priceIn']),
      priceOut: num(raw['priceOut']),
    };
  });
  const lastError = json['lastError'];
  return {
    probe: probe as ProbeKind, fetchedAt, stale: json['stale'] === true, models,
    ...(typeof lastError === 'string' ? { lastError } : {}),
  };
}

const REGISTRY_KEYS: readonly string[] = ['probe', 'classes', 'subagent', 'discovery', 'effort', 'baseUrl'];

/**
 * Validates `~/.ccrc/models/<id>.classes.json`, naming the offending field.
 *
 * `catalogue` is OPTIONAL and changes exactly one rule: with it, an `effort`
 * level must be one the classed model actually offers; without it, the level is
 * accepted unvalidated and doctor flags it once a catalogue appears (§4.1). No
 * other rule reads the catalogue — a registry that stopped parsing because a
 * catalogue was stale would take the server down for a fact about the network.
 *
 * THE UNSEEDED CASE (deviation B-1): a registry whose four slots are ALL null
 * is what `ccrc models <id> init openrouter` writes, and it is legal. On it the
 * "subagent's slot is non-null" and "discovery is non-empty" rules stand down —
 * there is nothing yet to point at. Both apply in full the moment any slot is
 * filled, and the materialiser refuses to write an env block for such a lane
 * anyway ("a lane needs at least one class"), so nothing routes to it meanwhile.
 */
export function parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry {
  if (!isObj(json)) {
    throw new RegistryInvalid('', 'a class registry must be a JSON object');
  }
  for (const key of Object.keys(json)) {
    if (!REGISTRY_KEYS.includes(key)) {
      throw new RegistryInvalid(key,
        `unknown field "${key}" in the class registry. It holds ${REGISTRY_KEYS.join(', ')}. `
        + '"selectable" is the account-connections picker permission and is deliberately not this '
        + 'file\'s "discovery" scope — the two never alias.');
    }
  }

  const probe = json['probe'];
  if (typeof probe !== 'string' || !(PROBE_KINDS as readonly string[]).includes(probe)) {
    throw new RegistryInvalid('probe',
      `probe ${JSON.stringify(probe)} is not a probe kind: it must be one of ${PROBE_KINDS.join(', ')}.`);
  }

  const classesRaw = json['classes'];
  if (!isObj(classesRaw)) {
    throw new RegistryInvalid('classes',
      `classes is missing or is not an object. It needs all four of ${CLASSES.join(', ')}, each a `
      + 'model id or null.');
  }
  for (const key of Object.keys(classesRaw)) {
    if (!(CLASSES as readonly string[]).includes(key)) {
      throw new RegistryInvalid(`classes.${key}`,
        `classes has an unknown key "${key}" — the four are ${CLASSES.join(', ')}. "subagent" is not `
        + 'one of them: it is a sibling field naming which of those four the subagents run as.');
    }
  }
  const classes: Record<string, string | null> = {};
  for (const cls of CLASSES) {
    const v = classesRaw[cls];
    if (v === null) { classes[cls] = null; continue; }
    if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
      throw new RegistryInvalid(`classes.${cls}`,
        `classes.${cls} is ${JSON.stringify(v)}, which is not a model id. Set it to a letter or `
        + 'digit followed by up to 127 of letters, digits, ".", "_", ":", "/" and "-", or to null — '
        + 'null means this class is unavailable on this lane.');
    }
    classes[cls] = v;
  }
  const seeded = CLASSES.some((c) => classes[c] !== null);

  const subagent = json['subagent'];
  if (typeof subagent !== 'string' || !(CLASSES as readonly string[]).includes(subagent)) {
    throw new RegistryInvalid('subagent',
      `subagent is ${JSON.stringify(subagent)}, which is not a class: it must be one of `
      + `${CLASSES.join(', ')}. It is the class SUBAGENTS run as on this lane, set deliberately and `
      + 'never derived.');
  }
  if (seeded && classes[subagent] === null) {
    throw new RegistryInvalid('subagent',
      `subagent names "${subagent}", whose slot is null — CLAUDE_CODE_SUBAGENT_MODEL would resolve `
      + `to a sentinel and every subagent on this lane would fail. Assign ${subagent} a model, or `
      + 'point subagent at a class that has one.');
  }

  const discoveryRaw = json['discovery'];
  let discovery: Discovery;
  if (discoveryRaw === 'catalogue') {
    if (probe === 'openrouter') {
      throw new RegistryInvalid('discovery',
        'openrouter requires an explicit discovery list: it advertises several hundred models, and '
        + 'an "unclassified" badge over all of them is noise. Build one with '
        + "'ccrc models <id> discovery add <modelId>'.");
    }
    discovery = 'catalogue';
  } else if (Array.isArray(discoveryRaw)) {
    if (discoveryRaw.length === 0 && seeded) {
      throw new RegistryInvalid('discovery',
        'discovery is an empty list on a registry that already classifies models — an empty list '
        + 'offers nothing to classify. Add the classed ids, or set it to "catalogue".');
    }
    const seen = new Set<string>();
    for (const [i, entry] of discoveryRaw.entries()) {
      if (typeof entry !== 'string' || !MODEL_ID_RE.test(entry)) {
        throw new RegistryInvalid(`discovery[${i}]`,
          `discovery[${i}] is ${JSON.stringify(entry)}, which is not a model id.`);
      }
      if (seen.has(entry)) {
        throw new RegistryInvalid('discovery',
          `discovery lists ${JSON.stringify(entry)} twice. Remove the duplicate.`);
      }
      seen.add(entry);
    }
    for (const cls of CLASSES) {
      const target = classes[cls];
      if (target !== null && target !== undefined && !seen.has(target)) {
        throw new RegistryInvalid('discovery',
          `${cls} routes to ${JSON.stringify(target)}, which the discovery list does not offer — a `
          + 'routing target no surface ever showed. Add it to discovery, or point classes.'
          + `${cls} at a model the list already offers.`);
      }
    }
    discovery = discoveryRaw as readonly string[];
  } else {
    throw new RegistryInvalid('discovery',
      `discovery is ${JSON.stringify(discoveryRaw)}. Set it to the string "catalogue" (the whole `
      + 'advertised set) or to a list of model ids.');
  }

  const baseUrlRaw = json['baseUrl'];
  let baseUrl: string | undefined;
  if (baseUrlRaw !== undefined) {
    if (typeof baseUrlRaw !== 'string' || baseUrlRaw.length === 0) {
      throw new RegistryInvalid('baseUrl', 'baseUrl must be a non-empty string when it is present.');
    }
    baseUrl = baseUrlRaw;
  }
  if (probe === 'compatible' && baseUrl === undefined) {
    throw new RegistryInvalid('baseUrl',
      'probe "compatible" needs a baseUrl: it ships no default endpoint, so only you can say where '
      + 'this lane talks to.');
  }

  const effortRaw = json['effort'];
  if (effortRaw === undefined) {
    return { probe: probe as ProbeKind, classes: classes as ClassMap,
      subagent: subagent as ModelClass, discovery, ...(baseUrl !== undefined ? { baseUrl } : {}) };
  }
  if (!isObj(effortRaw)) {
    throw new RegistryInvalid('effort',
      'effort must be an object keyed by class, or absent — absent means the provider\'s own default '
      + 'for each model.');
  }
  const byId = new Map((catalogue?.models ?? []).map((m) => [m.id, m]));
  const effort: Record<string, string> = {};
  for (const [key, value] of Object.entries(effortRaw)) {
    if (!(CLASSES as readonly string[]).includes(key)) {
      throw new RegistryInvalid(`effort.${key}`,
        `effort has an unknown key "${key}" — the keys are ${CLASSES.join(', ')}.`);
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new RegistryInvalid(`effort.${key}`,
        `effort.${key} is ${JSON.stringify(value)}. Set it to one of the classed model's own effort `
        + "levels — run 'ccrc models <id> show' to see them.");
    }
    const target = classes[key];
    const row = target === null || target === undefined ? undefined : byId.get(target);
    // A level is refused only when the catalogue POSITIVELY contradicts it. An
    // absent catalogue, or a row with an EMPTY `efforts` (every OpenRouter and
    // `compatible` row), leaves it alone: unknown is not "none offered".
    if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(value)) {
      throw new RegistryInvalid(`effort.${key}`,
        `effort.${key} is "${value}", which "${target}" does not offer. It offers: `
        + `${row.efforts.join(', ')}.`);
    }
    effort[key] = value;
  }
  return { probe: probe as ProbeKind, classes: classes as ClassMap,
    subagent: subagent as ModelClass, discovery, effort: effort as EffortMap,
    ...(baseUrl !== undefined ? { baseUrl } : {}) };
}

/** What discovery and classification operate on. `'catalogue'` resolves to the
 *  catalogue's VISIBLE ids — hidden Codex models are excluded (§4.2, decision
 *  6) and reachable only by an explicit discovery entry. With no catalogue it
 *  resolves to NOTHING, never to "everything": never-probed is a state, and a
 *  list invented from the classed ids would make `unclassified` silently empty
 *  on exactly the lane nobody has ever looked at. */
export function resolveDiscovery(reg: Registry, catalogue: Catalogue | null): string[] {
  if (reg.discovery !== 'catalogue') return [...reg.discovery];
  if (catalogue === null) return [];
  return catalogue.models.filter((m) => !m.hidden).map((m) => m.id);
}

export interface DerivedModels {
  classified: string[];
  unclassified: string[];
  retired: string[];
  available: ModelClass[];
}

function classIds(classes: ClassMap): string[] {
  const out: string[] = [];
  for (const c of CLASSES) {
    const v = classes[c];
    if (v !== null && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The four derived states, from a lane's registry and its catalogue (§4.3).
 *
 *  - `reg === null` — no registry file — → every class unavailable. That is
 *    §13.1's migration state on a non-Anthropic lane, and it is deliberately
 *    not "all four": a lane nobody has seeded routes nowhere, and doctor says
 *    so. **An Anthropic lane is the CALLER's business** — see `availableFor`.
 *  - `retired` is computed only against a catalogue that EXISTS and is NOT
 *    stale. Absence from a catalogue nobody could refresh is not evidence.
 *  - A retired id NEVER empties its slot. It stays classified, stays in the
 *    registry, and the class simply stops being available until the operator
 *    reassigns (§4.3, ruling 4).
 */
export function deriveModels(reg: Registry | null, catalogue: Catalogue | null): DerivedModels {
  if (reg === null) {
    return { classified: [], unclassified: [], retired: [], available: [] };
  }
  const classified = classIds(reg.classes);
  const discovery = resolveDiscovery(reg, catalogue);
  const unclassified = discovery.filter((id) => !classified.includes(id));
  const retired: string[] = [];
  if (catalogue !== null && !catalogue.stale) {
    // Against the WHOLE catalogue including hidden models: a hidden model the
    // operator discovered explicitly still exists upstream, and calling it
    // retired would warn on every surface about a model that answers fine.
    const live = new Set(catalogue.models.map((m) => m.id));
    for (const id of [...classified, ...discovery]) {
      if (!live.has(id) && !retired.includes(id)) retired.push(id);
    }
  }
  const available = CLASSES.filter((c) => {
    const id = reg.classes[c];
    return id !== null && !retired.includes(id);
  });
  return { classified, unclassified, retired, available: [...available] };
}

/**
 * Which classes routing may use on this lane — the ONE implementation of
 * "an Anthropic lane has all four" (round-2 ruling 2).
 *
 * `anthropic` is a parameter and not a field because the roster on `main` has
 * no `exec.provider` to derive it from: `ExecSpec` is `upstream | generated |
 * external` and nothing more. Every caller computes it from the roster's own
 * declaration, `telemetry === 'anthropic'` (deviation B-3), in one place per
 * program. On such a lane the four classes are Claude Code's own defaults, the
 * registry file does not exist, and there is nothing to classify.
 */
export function availableFor(
  reg: Registry | null, catalogue: Catalogue | null, anthropic: boolean,
): ModelClass[] {
  if (anthropic) return [...CLASSES];
  return deriveModels(reg, catalogue).available;
}

/** The four family tokens, in match order — an id is FABLE-class before it is
 *  opus-class, so a hybrid name resolves the way its most specific token says.
 *  Matched WITH their dashes: `opus` bare would classify `opusml/x`. Plan 2's
 *  `_session_class` implements the same rule in bash and is pinned against
 *  this one by that plan's agreement test. */
const FAMILY_TOKENS: readonly (readonly [string, ModelClass])[] = [
  ['-fable-', 'fable'], ['-opus-', 'opus'], ['-sonnet-', 'sonnet'], ['-haiku-', 'haiku'],
];

export function familyClassOf(anthropicModelId: string): ModelClass | null {
  for (const [token, cls] of FAMILY_TOKENS) {
    if (anthropicModelId.includes(token)) return cls;
  }
  return null;
}

/** Reverse lookup: which class does this lane route to `modelId`? The FIRST
 *  class in `CLASSES` order wins, so two slots holding one id resolve
 *  deterministically rather than by object key order. A `null` slot never
 *  matches — `classOfModel(reg, '')` is null, not "haiku". */
export function classOfModel(reg: Registry, modelId: string): ModelClass | null {
  if (modelId.length === 0) return null;
  for (const c of CLASSES) {
    if (reg.classes[c] === modelId) return c;
  }
  return null;
}

/** What the materialiser writes into the env block for a `null` slot (§6.1).
 *  Never left unset: unset, the alias falls through to Anthropic's own id and
 *  the proxied backend answers with an opaque 404.
 *
 *  IT LIVES IN A SINK. Nothing branches on it — not here, not in ccd, not in
 *  the API, not in the UI. Availability is `DerivedModels.available` in
 *  TypeScript and node, and the THIRD COLUMN of `<id>.classes.tsv` in bash. */
export const UNAVAILABLE_PREFIX = 'ccrc-unavailable-';
```

- [ ] **Step 5: Write `shared/models.mjs`**

```js
// shared/models.mjs — the registry, the catalogue and the derived states (§4)
// for the callers that run under a BARE `node`: `deploy/models-op.mjs`,
// `shared/modelenv.mjs`, and (Plan 2) the reader ccd shells out to. None of
// them can import `shared/models.ts` — no build step, no `tsx`, no compiled
// `dist/` — exactly `shared/wrapper.mjs`'s constraint in this tree.
//
// TWIN, NOT COPY. `server/test/models.test.ts` drives both over
// `server/test/fixtures/modelCases.ts` and compares them to EACH OTHER, so a
// change to either alone reds. The constants that must be duplicated —
// `CLASSES`, `PROBE_KINDS` and `MODEL_ID_RE` — are compared to the TypeScript
// SOURCE for source, not behaviourally, because the last constant hand-copied
// between these two languages shipped as raw control bytes with every suite
// green (`server/test/source-bytes.test.ts:5-15`).
//
// It imports nothing, not even `node:*`.

/** Mirrors `shared/models.ts`'s `CLASSES`, in the same order. */
const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'];

/** Mirrors `shared/models.ts`'s `PROBE_KINDS`, in the same order. */
const PROBE_KINDS = ['codex', 'openrouter', 'compatible'];

/** Mirrors `shared/models.ts`'s `MODEL_ID_RE`, itself copied from the
 *  account-connections branch's `shared/roster.ts:97`. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

const REGISTRY_KEYS = ['probe', 'classes', 'subagent', 'discovery', 'effort', 'baseUrl'];

export class RegistryInvalid extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'RegistryInvalid';
    this.field = field;
  }
}

export class CatalogueInvalid extends Error {
  constructor(message) { super(message); this.name = 'CatalogueInvalid'; }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `(json: unknown) => Catalogue` — the same checks, the same order, the same
 *  filled defaults as `shared/models.ts`'s `parseCatalogue`. */
export function parseCatalogue(json) {
  if (!isObj(json)) throw new CatalogueInvalid('a catalogue must be an object');
  const probe = json['probe'];
  if (typeof probe !== 'string' || !PROBE_KINDS.includes(probe)) {
    throw new CatalogueInvalid(
      `unknown catalogue probe ${JSON.stringify(probe)}: it must be one of ${PROBE_KINDS.join(', ')}`);
  }
  const fetchedAt = json['fetchedAt'];
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    throw new CatalogueInvalid('a catalogue needs a numeric fetchedAt');
  }
  const modelsRaw = json['models'];
  if (!Array.isArray(modelsRaw)) throw new CatalogueInvalid('a catalogue needs a models array');
  const models = modelsRaw.map((raw, i) => {
    if (!isObj(raw) || typeof raw['id'] !== 'string' || raw['id'].length === 0) {
      throw new CatalogueInvalid(`catalogue models[${i}] has no id`);
    }
    const id = raw['id'];
    const label = typeof raw['label'] === 'string' && raw['label'].length > 0 ? raw['label'] : id;
    const efforts = Array.isArray(raw['efforts'])
      ? raw['efforts'].filter((e) => typeof e === 'string')
      : [];
    return {
      id, label,
      context: num(raw['context']),
      maxContext: num(raw['maxContext']),
      efforts,
      hidden: raw['hidden'] === true,
      priceIn: num(raw['priceIn']),
      priceOut: num(raw['priceOut']),
    };
  });
  const out = { probe, fetchedAt, stale: json['stale'] === true, models };
  if (typeof json['lastError'] === 'string') out.lastError = json['lastError'];
  return out;
}

/** `(json: unknown, catalogue?: Catalogue | null) => Registry` — the same rules,
 *  in the same order, with the same field names on `RegistryInvalid`. */
export function parseRegistry(json, catalogue) {
  if (!isObj(json)) throw new RegistryInvalid('', 'a class registry must be a JSON object');
  for (const key of Object.keys(json)) {
    if (!REGISTRY_KEYS.includes(key)) {
      throw new RegistryInvalid(key,
        `unknown field "${key}" in the class registry. It holds ${REGISTRY_KEYS.join(', ')}. `
        + '"selectable" is the account-connections picker permission and is deliberately not this '
        + 'file\'s "discovery" scope — the two never alias.');
    }
  }
  const probe = json['probe'];
  if (typeof probe !== 'string' || !PROBE_KINDS.includes(probe)) {
    throw new RegistryInvalid('probe',
      `probe ${JSON.stringify(probe)} is not a probe kind: it must be one of ${PROBE_KINDS.join(', ')}.`);
  }
  const classesRaw = json['classes'];
  if (!isObj(classesRaw)) {
    throw new RegistryInvalid('classes',
      `classes is missing or is not an object. It needs all four of ${CLASSES.join(', ')}, each a `
      + 'model id or null.');
  }
  for (const key of Object.keys(classesRaw)) {
    if (!CLASSES.includes(key)) {
      throw new RegistryInvalid(`classes.${key}`,
        `classes has an unknown key "${key}" — the four are ${CLASSES.join(', ')}. "subagent" is not `
        + 'one of them: it is a sibling field naming which of those four the subagents run as.');
    }
  }
  const classes = {};
  for (const cls of CLASSES) {
    const v = classesRaw[cls];
    if (v === null) { classes[cls] = null; continue; }
    if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
      throw new RegistryInvalid(`classes.${cls}`,
        `classes.${cls} is ${JSON.stringify(v)}, which is not a model id. Set it to a letter or `
        + 'digit followed by up to 127 of letters, digits, ".", "_", ":", "/" and "-", or to null — '
        + 'null means this class is unavailable on this lane.');
    }
    classes[cls] = v;
  }
  const seeded = CLASSES.some((c) => classes[c] !== null);

  const subagent = json['subagent'];
  if (typeof subagent !== 'string' || !CLASSES.includes(subagent)) {
    throw new RegistryInvalid('subagent',
      `subagent is ${JSON.stringify(subagent)}, which is not a class: it must be one of `
      + `${CLASSES.join(', ')}. It is the class SUBAGENTS run as on this lane, set deliberately and `
      + 'never derived.');
  }
  if (seeded && classes[subagent] === null) {
    throw new RegistryInvalid('subagent',
      `subagent names "${subagent}", whose slot is null — CLAUDE_CODE_SUBAGENT_MODEL would resolve `
      + `to a sentinel and every subagent on this lane would fail. Assign ${subagent} a model, or `
      + 'point subagent at a class that has one.');
  }

  const discoveryRaw = json['discovery'];
  let discovery;
  if (discoveryRaw === 'catalogue') {
    if (probe === 'openrouter') {
      throw new RegistryInvalid('discovery',
        'openrouter requires an explicit discovery list: it advertises several hundred models, and '
        + 'an "unclassified" badge over all of them is noise. Build one with '
        + "'ccrc models <id> discovery add <modelId>'.");
    }
    discovery = 'catalogue';
  } else if (Array.isArray(discoveryRaw)) {
    if (discoveryRaw.length === 0 && seeded) {
      throw new RegistryInvalid('discovery',
        'discovery is an empty list on a registry that already classifies models — an empty list '
        + 'offers nothing to classify. Add the classed ids, or set it to "catalogue".');
    }
    const seen = new Set();
    discoveryRaw.forEach((entry, i) => {
      if (typeof entry !== 'string' || !MODEL_ID_RE.test(entry)) {
        throw new RegistryInvalid(`discovery[${i}]`,
          `discovery[${i}] is ${JSON.stringify(entry)}, which is not a model id.`);
      }
      if (seen.has(entry)) {
        throw new RegistryInvalid('discovery',
          `discovery lists ${JSON.stringify(entry)} twice. Remove the duplicate.`);
      }
      seen.add(entry);
    });
    for (const cls of CLASSES) {
      const target = classes[cls];
      if (target !== null && target !== undefined && !seen.has(target)) {
        throw new RegistryInvalid('discovery',
          `${cls} routes to ${JSON.stringify(target)}, which the discovery list does not offer — a `
          + 'routing target no surface ever showed. Add it to discovery, or point classes.'
          + `${cls} at a model the list already offers.`);
      }
    }
    discovery = [...discoveryRaw];
  } else {
    throw new RegistryInvalid('discovery',
      `discovery is ${JSON.stringify(discoveryRaw)}. Set it to the string "catalogue" (the whole `
      + 'advertised set) or to a list of model ids.');
  }

  const baseUrlRaw = json['baseUrl'];
  let baseUrl;
  if (baseUrlRaw !== undefined) {
    if (typeof baseUrlRaw !== 'string' || baseUrlRaw.length === 0) {
      throw new RegistryInvalid('baseUrl', 'baseUrl must be a non-empty string when it is present.');
    }
    baseUrl = baseUrlRaw;
  }
  if (probe === 'compatible' && baseUrl === undefined) {
    throw new RegistryInvalid('baseUrl',
      'probe "compatible" needs a baseUrl: it ships no default endpoint, so only you can say where '
      + 'this lane talks to.');
  }

  const out = { probe, classes, subagent, discovery };
  const effortRaw = json['effort'];
  if (effortRaw !== undefined) {
    if (!isObj(effortRaw)) {
      throw new RegistryInvalid('effort',
        'effort must be an object keyed by class, or absent — absent means the provider\'s own '
        + 'default for each model.');
    }
    const byId = new Map(((catalogue && catalogue.models) || []).map((m) => [m.id, m]));
    const effort = {};
    for (const [key, value] of Object.entries(effortRaw)) {
      if (!CLASSES.includes(key)) {
        throw new RegistryInvalid(`effort.${key}`,
          `effort has an unknown key "${key}" — the keys are ${CLASSES.join(', ')}.`);
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new RegistryInvalid(`effort.${key}`,
          `effort.${key} is ${JSON.stringify(value)}. Set it to one of the classed model's own `
          + "effort levels — run 'ccrc models <id> show' to see them.");
      }
      const target = classes[key];
      const row = target === null || target === undefined ? undefined : byId.get(target);
      if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(value)) {
        throw new RegistryInvalid(`effort.${key}`,
          `effort.${key} is "${value}", which "${target}" does not offer. It offers: `
          + `${row.efforts.join(', ')}.`);
      }
      effort[key] = value;
    }
    out.effort = effort;
  }
  if (baseUrl !== undefined) out.baseUrl = baseUrl;
  return out;
}

/** `(reg, catalogue) => string[]` — visible ids for `'catalogue'`, the list as
 *  written otherwise, and EMPTY when there is no catalogue at all. */
export function resolveDiscovery(reg, catalogue) {
  if (reg.discovery !== 'catalogue') return [...reg.discovery];
  if (catalogue === null || catalogue === undefined) return [];
  return catalogue.models.filter((m) => !m.hidden).map((m) => m.id);
}

function classIds(classes) {
  const out = [];
  for (const c of CLASSES) {
    const v = classes[c];
    if (v !== null && v !== undefined && !out.includes(v)) out.push(v);
  }
  return out;
}

/** `(reg, catalogue) => { classified, unclassified, retired, available }` */
export function deriveModels(reg, catalogue) {
  if (reg === null || reg === undefined) {
    return { classified: [], unclassified: [], retired: [], available: [] };
  }
  const classified = classIds(reg.classes);
  const discovery = resolveDiscovery(reg, catalogue ?? null);
  const unclassified = discovery.filter((id) => !classified.includes(id));
  const retired = [];
  if (catalogue !== null && catalogue !== undefined && !catalogue.stale) {
    const live = new Set(catalogue.models.map((m) => m.id));
    for (const id of [...classified, ...discovery]) {
      if (!live.has(id) && !retired.includes(id)) retired.push(id);
    }
  }
  const available = CLASSES.filter((c) => {
    const id = reg.classes[c];
    return id !== null && id !== undefined && !retired.includes(id);
  });
  return { classified, unclassified, retired, available };
}

/** `(reg, catalogue, anthropic: boolean) => ModelClass[]` — the one place
 *  "an anthropic lane has all four" lives. See the `.ts`'s comment for why the
 *  boolean is a parameter. */
export function availableFor(reg, catalogue, anthropic) {
  if (anthropic) return [...CLASSES];
  return deriveModels(reg, catalogue).available;
}

const FAMILY_TOKENS = [
  ['-fable-', 'fable'], ['-opus-', 'opus'], ['-sonnet-', 'sonnet'], ['-haiku-', 'haiku'],
];

/** `(anthropicModelId: string) => ModelClass | null` — first token wins. */
export function familyClassOf(anthropicModelId) {
  for (const [token, cls] of FAMILY_TOKENS) {
    if (anthropicModelId.includes(token)) return cls;
  }
  return null;
}

/** `(reg, modelId) => ModelClass | null` — first class in CLASSES order. */
export function classOfModel(reg, modelId) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  for (const c of CLASSES) {
    if (reg.classes[c] === modelId) return c;
  }
  return null;
}

export const UNAVAILABLE_PREFIX = 'ccrc-unavailable-';
```

- [ ] **Step 6: Write `shared/models.d.mts`**

```ts
// shared/models.d.mts — hand-written, in `shared/wrapper.d.mts`'s shape and for
// its job: the `.mjs` beside it is what runs, and this is what lets a
// TypeScript caller import it with types. The names and the shape are
// `shared/models.ts`'s exactly.
import type {
  Catalogue, CatalogueModel, DerivedModels, ModelClass, Registry,
} from './models.js';

export type { Catalogue, CatalogueModel, DerivedModels, ModelClass, Registry };
export declare const MODEL_ID_RE: RegExp;
export declare class RegistryInvalid extends Error { readonly field: string }
export declare class CatalogueInvalid extends Error {}
export declare function parseCatalogue(json: unknown): Catalogue;
export declare function parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry;
export declare function resolveDiscovery(reg: Registry, catalogue: Catalogue | null): string[];
export declare function deriveModels(reg: Registry | null, catalogue: Catalogue | null): DerivedModels;
export declare function availableFor(
  reg: Registry | null, catalogue: Catalogue | null, anthropic: boolean,
): ModelClass[];
export declare function familyClassOf(anthropicModelId: string): ModelClass | null;
export declare function classOfModel(reg: Registry, modelId: string): ModelClass | null;
export declare const UNAVAILABLE_PREFIX: string;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd server && npx vitest run test/models.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 8: Measured mutation check — stale catalogues retire nothing**

In `shared/models.ts`, change `if (catalogue !== null && !catalogue.stale)` to `if (catalogue !== null)`. Run `cd server && npx vitest run test/models.test.ts`.
Expected: two cases red — `a STALE catalogue retires nothing …` under `deriveModels` and `the bare-node twin answers identically, row for row` (which now also reports `twins disagree`). Restore and re-run; expected PASS. Repeat the same mutation in `shared/models.mjs` and confirm the twin row alone goes red, then restore.

- [ ] **Step 9: Measured mutation check — hidden models are excluded from a "catalogue" discovery list**

In `shared/models.ts`'s `resolveDiscovery`, drop the `.filter((m) => !m.hidden)`. Run `cd server && npx vitest run test/models.test.ts`.
Expected: three cases red — `hidden models are excluded from a "catalogue" discovery list`, `"catalogue" is the VISIBLE ids, in catalogue order`, and the twin row. Restore and re-run; expected PASS.

- [ ] **Step 10: Measured mutation check — never-probed resolves to nothing**

Change `if (catalogue === null) return [];` in `resolveDiscovery` to `if (catalogue === null) return classIds(reg.classes);`. Run `cd server && npx vitest run test/models.test.ts`.
Expected: two cases red — `"catalogue" with no catalogue is EMPTY, not "everything"` and the twin row. Restore and re-run; expected PASS.

- [ ] **Step 11: Measured mutation check — the subagent slot guard, in both directions**

In `shared/models.ts`'s `parseRegistry`, change `if (seeded && classes[subagent] === null)` to `if (false)`. Run `cd server && npx vitest run test/models.test.ts`.
Expected: three cases red — `refuses a subagent naming a NULL slot on a seeded registry (§4.1)`, `names the field on RegistryInvalid, not only in the message`, and `the twin refuses every one of those too` (the `.ts` now accepts what the twin refuses). Then change it to `if (classes[subagent] === null)` — dropping the `seeded` half — and re-run: expected TWO DIFFERENT cases red — `round-trips an UNSEEDED registry …` and `ALLOWS a subagent naming a null slot when EVERY slot is null (deviation B-1)`. Restore the conjunction and re-run; expected PASS. (Both directions are measured because B-1 is an asymmetry, and only a mutation each way shows the asymmetry is load-bearing.)

- [ ] **Step 12: Measured mutation check — `availableFor` is the only place "all four" is spelled**

In `shared/models.ts`'s `deriveModels`, change the `reg === null` early return's `available: []` to `available: [...CLASSES]`. Run `cd server && npx vitest run test/models.test.ts`.
Expected: three cases red — `no registry file at all reads as every class unavailable (§13.1)`, `is deriveModels' answer on every other lane` (`availableFor(null, CODEX, false)` is no longer `[]`), and the twin row. Restore and re-run; expected PASS.

- [ ] **Step 13: Measured mutation check — the openrouter discovery rule**

Change `if (probe === 'openrouter')` inside the `'catalogue'` branch to `if (false)`. Run `cd server && npx vitest run test/models.test.ts`.
Expected: two cases red — `refuses discovery "catalogue" on openrouter, naming the field` and `the twin refuses every one of those too`. Restore and re-run; expected PASS.

- [ ] **Step 14: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no output.

- [ ] **Step 15: Commit**

```bash
git add shared/models.ts shared/models.mjs shared/models.d.mts \
        server/test/models.test.ts server/test/fixtures/modelCases.ts
git commit -m "$(cat <<'MSG'
feat(models): the per-account class registry, its catalogue, and the derived states

The registry is its own file — ~/.ccrc/models/<id>.classes.json — because the
account-connections branch's exec.models is not on main and any change there is
additive and lands after that branch merges (ruling 280). It carries probe,
classes, an EXPLICIT subagent class, discovery and an optional effort map;
`subagent` is a routing destination the operator sets, never a derivation, and
`discovery` is deliberately not that branch's `selectable`, which is a picker
permission.

Three rules are guards with measured mutations: hidden models are excluded from a
"catalogue" discovery list, a never-probed lane resolves to NOTHING rather than to
its own classed ids, and a stale catalogue retires nothing — absence from a
catalogue nobody could refresh is not evidence a model is gone. A retired id never
empties its slot; `available` is what routing consumes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: The materialiser's pure half — `shared/modelenv.mjs`, the three-column TSV, and the single-writer pin

**Files:**
- Create: `shared/modelenv.mjs`, `shared/modelenv.d.mts`
- Create: `server/test/modelenv.test.ts`
- Create: `server/test/fixtures/settings/project.settings.json`
- Create: `server/test/settings-aliases.test.ts`
- Create: `server/test/modelenv-single-writer.test.ts`
- Test: `server/test/modelenv.test.ts`, `server/test/settings-aliases.test.ts`, `server/test/modelenv-single-writer.test.ts`

**Interfaces:**
- Consumes: `UNAVAILABLE_PREFIX`, `deriveModels` from `shared/models.mjs` (Task 2); `CLASSES` mirrored as in that twin.
- Produces:
  ```js
  export class ModelEnvInvalid extends Error {}
  export const MODEL_ENV_KEYS                                       // → the eight key names, frozen
  export function modelEnvBlock(registry, catalogue)                // → up to eight env keys
  export function mergeSettingsEnv(settingsPath, block)              // → { changed: boolean }
  export function clearSettingsEnv(settingsPath, keys)               // → { changed: boolean }
  export function effortFile(registry, catalogue)                    // → { byModel: { [modelId]: level } }
  export function classesTsv(registry, catalogue)                    // → 'haiku\t<id>\tassigned\n' × 4
  ```
  Tasks 6–10 call `modelEnvBlock`, `effortFile` and `classesTsv`; Plan 2 reads `classesTsv`'s output from bash and branches on its THIRD column; the monorepo shim (Task 13) reads `effortFile`'s output. `clearSettingsEnv` is `ccrc models <id> rm`'s whole settings step (Task 6): called with `MODEL_ENV_KEYS` so the eight names are spelled once, at their point of origin, rather than a second time at every call site (spec §4.1 Lifecycle, §10, §11). `modelEnvBlock`'s eighth key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (spec §6.1, amended 2026-09-08), is written only when `catalogue` is non-null, not stale, and lists the model `ANTHROPIC_MODEL` resolves to with a numeric `context`; every other case OMITS the key — there is no "unavailable" reading for a context window, only "unknown", and Claude Code's own 200k default already means "unknown" to the client. Because the key can disappear on a re-materialise (a catalogue going stale, or the default model changing to one with no measured context), Task 6's `materialise` step also clears it when absent from the freshly computed block — see Task 6's Interfaces for which function does that.

- [ ] **Step 1: Write the failing test file**

Create `server/test/modelenv.test.ts`:

```ts
// `shared/modelenv.mjs` — the pure half of the materialiser (§6.1, §6.4, §7).
// Pure in the sense that matters here: `modelEnvBlock`, `effortFile` and
// `classesTsv` touch no disk at all, and `mergeSettingsEnv` touches exactly
// one path the caller names. Every case below runs against a `mkTmp` HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
} from '../../shared/modelenv.mjs';
import { CODEX, SEEDED, UNSEEDED } from './fixtures/modelCases.js';

let home: string;
beforeEach(() => { home = mkTmp('ccrc-modelenv-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (over: Record<string, unknown>): Record<string, unknown> =>
  ({ ...JSON.parse(JSON.stringify(SEEDED)), ...over });

describe('modelEnvBlock', () => {
  it('is the seven variables, byte for byte, for the seeded gpt registry (§6.1)', () => {
    expect(modelEnvBlock(SEEDED, null)).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.6-luna',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.6-terra',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
      ANTHROPIC_MODEL: 'gpt-5.6-sol',
      ANTHROPIC_SMALL_FAST_MODEL: 'gpt-5.6-luna',
      CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-5.6-terra',
    });
  });

  it('writes a SENTINEL for every null slot, never leaves the key unset', () => {
    // Unset, the alias falls through to Anthropic's own id and the proxied
    // backend answers with an opaque 404 — today's Fable-on-gpt failure. The
    // sentinel makes `/model fable` fail with a name that says what is missing.
    const only = reg({ classes: { haiku: null, sonnet: null, opus: 'x', fable: null },
      subagent: 'opus', discovery: ['x'], effort: {} });
    const b = modelEnvBlock(only, null);
    expect(b.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('ccrc-unavailable-haiku');
    expect(b.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('ccrc-unavailable-sonnet');
    expect(b.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(Object.keys(b)).toHaveLength(7);
  });

  it('CLAUDE_CODE_SUBAGENT_MODEL is classes[subagent] — the registry\'s explicit choice', () => {
    // Round-2 ruling 3: `subagent` is a class name the operator sets, never a
    // derivation. Pointing it at opus must move the variable, with no other
    // key changing.
    const onOpus = reg({ subagent: 'opus' });
    expect(modelEnvBlock(onOpus, null).CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-sol');
    const onHaiku = reg({ subagent: 'haiku' });
    expect(modelEnvBlock(onHaiku, null).CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-luna');
    expect(modelEnvBlock(onHaiku, null).ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
  });

  it('REFUSES when subagent names a null slot, rather than writing a sentinel there', () => {
    // §6.1: "refused if that slot is null". A sentinel in this one variable
    // would make every subagent on the lane fail at the provider, one turn at a
    // time, with nothing having said so at materialise time.
    const bad = reg({ subagent: 'fable' });
    expect(() => modelEnvBlock(bad, null)).toThrow(ModelEnvInvalid);
    expect(() => modelEnvBlock(bad, null)).toThrow(/subagent/);
  });

  it('ANTHROPIC_MODEL falls opus → sonnet → haiku', () => {
    const noOpus = reg({ classes: { haiku: 'h', sonnet: 's', opus: null, fable: null },
      subagent: 'sonnet', discovery: ['h', 's'], effort: {} });
    expect(modelEnvBlock(noOpus, null).ANTHROPIC_MODEL).toBe('s');
    const haikuOnly = reg({ classes: { haiku: 'h', sonnet: null, opus: null, fable: null },
      subagent: 'haiku', discovery: ['h'], effort: {} });
    expect(modelEnvBlock(haikuOnly, null).ANTHROPIC_MODEL).toBe('h');
  });

  it('ANTHROPIC_SMALL_FAST_MODEL falls haiku → sonnet', () => {
    const noHaiku = reg({ classes: { haiku: null, sonnet: 's', opus: 'o', fable: null },
      subagent: 'sonnet', discovery: ['s', 'o'], effort: {} });
    expect(modelEnvBlock(noHaiku, null).ANTHROPIC_SMALL_FAST_MODEL).toBe('s');
  });

  it('neither fallback chain ever reaches `fable`, and a fable-only lane is refused', () => {
    // The two chains are spelled in §6.1 and STOP where they stop, deliberately:
    // a lane whose only class is Fable would otherwise silently run every
    // unqualified request — including the small-fast ones — on the most
    // expensive model it has.
    const fableOnly = reg({ classes: { haiku: null, sonnet: null, opus: null, fable: 'f' },
      subagent: 'fable', discovery: ['f'], effort: {} });
    expect(() => modelEnvBlock(fableOnly, null)).toThrow(ModelEnvInvalid);
    expect(() => modelEnvBlock(fableOnly, null)).toThrow(/a lane needs at least one class/);
  });

  it('refuses an UNSEEDED registry (§11) — it is legal on disk and materialises to nothing', () => {
    expect(() => modelEnvBlock(UNSEEDED, null)).toThrow(/a lane needs at least one class/);
  });

  it('CLAUDE_CODE_MAX_CONTEXT_TOKENS is ANTHROPIC_MODEL\'s context, as a STRING (§6.1, amended 2026-09-08)', () => {
    // ANTHROPIC_MODEL resolves opus ?? sonnet ?? haiku — SEEDED's opus slot is
    // gpt-5.6-sol, and CODEX lists it with context 272000. Env values are
    // strings everywhere else in this block; a bare number here would be the
    // one key that reads differently from the other seven.
    const b = modelEnvBlock(SEEDED, CODEX);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
    expect(Object.keys(b)).toHaveLength(8);
  });

  it('is ABSENT when the catalogue is stale — a stale window is not a measured one', () => {
    const b = modelEnvBlock(SEEDED, { ...CODEX, stale: true });
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(Object.keys(b)).toHaveLength(7);
  });

  it('is ABSENT with no catalogue at all — never probed is not "assume 200k is fine"', () => {
    const b = modelEnvBlock(SEEDED, null);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(Object.keys(b)).toHaveLength(7);
  });

  it('is ABSENT when the catalogue lists the resolved model with context: null', () => {
    const noContext = { ...CODEX,
      models: CODEX.models.map((m) => (m.id === 'gpt-5.6-sol' ? { ...m, context: null } : m)) };
    const b = modelEnvBlock(SEEDED, noContext);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(Object.keys(b)).toHaveLength(7);
  });
});

describe('mergeSettingsEnv', () => {
  const settings = (): string => path.join(home, '.claude-gpt', 'settings.json');

  it('creates the file when it is absent, with the env block and nothing else', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    const r = mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    expect(r).toEqual({ changed: true });
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(Object.keys(j)).toEqual(['env']);
    expect(j.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
  });

  it('ADDS and UPDATES, and never removes another key — the lane owns its own settings', () => {
    // `ccgpt`'s `_sync_gpt_config` mirrors an allow-list into this same file
    // and never removes the lane's own keys (measured, spec §1). The
    // materialiser has to be equally careful in the other direction.
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({
      alwaysThinkingEnabled: true,
      env: { DISABLE_TELEMETRY: '1', ANTHROPIC_DEFAULT_OPUS_MODEL: 'stale-id' },
    }, null, 2));
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(j.alwaysThinkingEnabled).toBe(true);
    expect(j.env.DISABLE_TELEMETRY).toBe('1');
    expect(j.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.6-sol');
  });

  it('PRUNES CLAUDE_CODE_MAX_CONTEXT_TOKENS when a re-materialise\'s block stops emitting it', () => {
    // The eighth key can go from present to absent — a catalogue going stale,
    // or the lane's default model changing to one with no measured context —
    // and unlike every other key here it carries no sentinel: leaving the
    // STALE number on disk would misstate the window rather than merely miss
    // one. This is the one member of MODEL_ENV_KEYS this function ever
    // deletes on its own; the case above shows a key OUTSIDE that set is
    // still never touched.
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, CODEX));
    expect(JSON.parse(fs.readFileSync(settings(), 'utf8')).env.CLAUDE_CODE_MAX_CONTEXT_TOKENS)
      .toBe('272000');
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(Object.keys(j.env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
    expect(j.env.ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
  });

  it('reports changed:false on a second identical call, and rewrites nothing', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const before = fs.statSync(settings()).mtimeMs;
    const r = mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    expect(r).toEqual({ changed: false });
    expect(fs.statSync(settings()).mtimeMs).toBe(before);
  });

  it('writes 2-space indent and a trailing newline', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const text = fs.readFileSync(settings(), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "env": {');
  });

  it('leaves no temp file behind — the write is atomic', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    expect(fs.readdirSync(path.join(home, '.claude-gpt'))).toEqual(['settings.json']);
  });

  it('refuses a settings file that is not JSON, rather than overwriting it', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), '{ this is not json');
    expect(() => mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null))).toThrow(ModelEnvInvalid);
    expect(fs.readFileSync(settings(), 'utf8')).toBe('{ this is not json');
  });

  it('refuses a settings file whose top level is not an object', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), '[]');
    expect(() => mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null))).toThrow(ModelEnvInvalid);
  });
});

describe('MODEL_ENV_KEYS', () => {
  it('is the eight keys modelEnvBlock can write, frozen, so a caller never spells them twice', () => {
    // Against a catalogue that names ANTHROPIC_MODEL's context (§6.1,
    // amended 2026-09-08), all eight keys are live at once.
    expect([...MODEL_ENV_KEYS].sort()).toEqual(Object.keys(modelEnvBlock(SEEDED, CODEX)).sort());
    expect(Object.isFrozen(MODEL_ENV_KEYS)).toBe(true);
  });
});

describe('clearSettingsEnv — ccrc models <id> rm\'s whole settings step (§4.1 Lifecycle, §10)', () => {
  const settings = (): string => path.join(home, '.claude-gpt', 'settings.json');

  it('clears exactly the eight keys, leaving every other env key untouched', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({
      alwaysThinkingEnabled: true,
      env: { ...modelEnvBlock(SEEDED, CODEX), DISABLE_TELEMETRY: '1' },
    }, null, 2));
    const r = clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    expect(r).toEqual({ changed: true });
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(j.alwaysThinkingEnabled).toBe(true);
    expect(j.env).toEqual({ DISABLE_TELEMETRY: '1' });
  });

  it('removes env entirely once emptied by the deletion, rather than writing {}', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({ env: modelEnvBlock(SEEDED, null) }, null, 2));
    clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(Object.keys(j)).toEqual([]);
  });

  it('a missing settings file is changed:false, and nothing is written', () => {
    const r = clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    expect(r).toEqual({ changed: false });
    expect(fs.existsSync(settings())).toBe(false);
  });

  it('a second call is idempotent — changed:false, and rewrites nothing', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({ env: modelEnvBlock(SEEDED, null) }, null, 2));
    clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    const before = fs.statSync(settings()).mtimeMs;
    const r = clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    expect(r).toEqual({ changed: false });
    expect(fs.statSync(settings()).mtimeMs).toBe(before);
  });

  it('refuses a settings file that is not JSON, rather than overwriting it', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), '{ this is not json');
    expect(() => clearSettingsEnv(settings(), MODEL_ENV_KEYS)).toThrow(ModelEnvInvalid);
    expect(fs.readFileSync(settings(), 'utf8')).toBe('{ this is not json');
  });
});

describe('classesTsv — three columns, availability as its own marker (§7)', () => {
  it('is four lines in CLASSES order: class, modelId, state', () => {
    expect(classesTsv(SEEDED, CODEX)).toBe(
      'haiku\tgpt-5.6-luna\tassigned\n'
      + 'sonnet\tgpt-5.6-terra\tassigned\n'
      + 'opus\tgpt-5.6-sol\tassigned\n'
      + 'fable\t\tunassigned\n');
  });

  it('a RETIRED class keeps its id in column 2 and says so in column 3', () => {
    // Round-2 ruling 6 and §4.3: retirement never empties a slot, and ccd reads
    // column 3 rather than inferring unavailability from an empty field — the
    // two states are different and the operator's assignment is theirs.
    const retired = { ...SEEDED,
      classes: { ...SEEDED.classes, sonnet: 'gpt-5.5-mini' },
      discovery: 'catalogue' as const };
    expect(classesTsv(retired, CODEX)).toContain('sonnet\tgpt-5.5-mini\tretired\n');
  });

  it('a stale catalogue retires nothing here either', () => {
    const retired = { ...SEEDED, classes: { ...SEEDED.classes, sonnet: 'gpt-5.5-mini' } };
    expect(classesTsv(retired, { ...CODEX, stale: true })).toContain('sonnet\tgpt-5.5-mini\tassigned\n');
  });

  it('with NO catalogue every non-null class is assigned, never retired', () => {
    expect(classesTsv(SEEDED, null)).toBe(
      'haiku\tgpt-5.6-luna\tassigned\n'
      + 'sonnet\tgpt-5.6-terra\tassigned\n'
      + 'opus\tgpt-5.6-sol\tassigned\n'
      + 'fable\t\tunassigned\n');
  });

  it('is four lines even when every slot is null', () => {
    expect(classesTsv(UNSEEDED, null)).toBe(
      'haiku\t\tunassigned\nsonnet\t\tunassigned\nopus\t\tunassigned\nfable\t\tunassigned\n');
    expect(classesTsv(UNSEEDED, null).split('\n').filter(Boolean)).toHaveLength(4);
  });

  it('the second field is empty ONLY when the state is unassigned', () => {
    // The invariant Plan 2's bash reader depends on: `cut -f2` is meaningful
    // exactly when `cut -f3` is not `unassigned`.
    for (const [r, c] of [[SEEDED, CODEX], [SEEDED, null], [UNSEEDED, null]] as const) {
      for (const line of classesTsv(r, c).split('\n').filter(Boolean)) {
        const [, id, state] = line.split('\t');
        expect(state, line).toMatch(/^(assigned|unassigned|retired)$/);
        expect(id === '', `${line} — empty id with state ${state}`).toBe(state === 'unassigned');
      }
    }
  });

  it('never emits the sentinel — that string lives in the env block alone (§6.1)', () => {
    expect(classesTsv(SEEDED, CODEX)).not.toContain('ccrc-unavailable-');
  });
});

describe('effortFile', () => {
  it('keys the lane defaults by MODEL ID, so the shim never parses the registry (§6.4)', () => {
    expect(effortFile(SEEDED, CODEX)).toEqual({
      byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' },
    });
  });

  it('drops a class whose slot is null — there is no model to key it on', () => {
    // SEEDED's `effort.fable` is 'max' and its `classes.fable` is null.
    expect(Object.keys(effortFile(SEEDED, CODEX).byModel)).not.toContain('');
    expect(Object.keys(effortFile(SEEDED, CODEX).byModel)).toHaveLength(3);
  });

  it('drops a level the catalogue says that model does not offer', () => {
    // Luna has no `ultra`; Astra does (§4.1). A lane default the provider
    // rejects turns every turn on that class into a 400.
    const bad = { ...SEEDED, effort: { ...SEEDED.effort, haiku: 'ultra' } };
    expect(effortFile(bad, CODEX).byModel['gpt-5.6-luna']).toBeUndefined();
    expect(effortFile(bad, CODEX).byModel['gpt-5.6-terra']).toBe('high');
  });

  it('keeps an unvalidatable level when there is no catalogue at all', () => {
    // §4.1: accepted unvalidated when no catalogue exists, flagged by doctor
    // once one appears. Dropping it would silently un-configure a lane the
    // operator has never been able to probe.
    expect(effortFile(SEEDED, null).byModel['gpt-5.6-sol']).toBe('max');
  });

  it('keeps a level when the catalogue lists the model with NO efforts at all', () => {
    // An OpenRouter or `compatible` row carries no effort list; an empty
    // `efforts` is "unknown", not "none offered".
    const noEfforts = { ...CODEX, models: CODEX.models.map((m) => ({ ...m, efforts: [] })) };
    expect(effortFile(SEEDED, noEfforts).byModel['gpt-5.6-sol']).toBe('max');
  });

  it('is an empty byModel when the registry has no effort map', () => {
    const { effort: _drop, ...noEffort } = SEEDED;
    expect(effortFile(noEffort, CODEX)).toEqual({ byModel: {} });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run test/modelenv.test.ts`
Expected: FAIL with `Failed to resolve import "../../shared/modelenv.mjs"`.

- [ ] **Step 3: Write `shared/modelenv.mjs`**

```js
// shared/modelenv.mjs — the materialiser's pure half (§6.1, §6.4, §7): a lane's
// class registry turned into the eight environment variables Claude Code reads,
// the THREE-column TSV ccd reads (Plan 2), and the effort map `ccgpt-proxy`
// reads per request.
//
// `.mjs` because every caller runs under a bare `node`: `deploy/models-op.mjs`
// (the verbs' node half) and, when the account-connections wave's settings-block
// writer lands, that writer too — its plan's Task 25 calls this function rather
// than growing a second copy. One writer of these bytes, pinned by
// `server/test/modelenv-single-writer.test.ts` because the single-definition
// scan filters `.tsx?` and is blind to a second `.mjs` writer.
//
// WHY THE SENTINEL EXISTS AT ALL, measured 2026-09-08 and recorded in spec §1:
// with `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL` set, `--model
// <alias>` leaves the client as that value; UNSET, the alias falls through to
// Anthropic's own id and a proxied backend answers with an opaque 404. So a
// null slot is written as `ccrc-unavailable-<class>` rather than omitted: the
// failure then names what is missing. A settings-file `env` block also BEATS
// the shell env for the same variable (probed), which is why the wrapper's own
// exports become dead code once this block lands (§6.2).
//
// AND THE SENTINEL GOES NOWHERE ELSE. `classesTsv` never emits it; its third
// column is the positive availability marker every bash reader branches on.
// The EIGHTH key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (spec §6.1, amended
// 2026-09-08), gets neither treatment: it is OMITTED, never sentinelled, when
// no measured window exists — there is no "unavailable" reading for a context
// size, only "unknown", and Claude Code's own 200k default already means
// "unknown" to the client. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_
// ENFORCEMENT` is never set by this file or by anything this design writes:
// that proactive compaction is what keeps an unexpectedly large lane from
// hitting the provider's 400 ("input exceeds the context window").

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { UNAVAILABLE_PREFIX, deriveModels } from './models.mjs';

/** Mirrors `shared/models.ts`'s `CLASSES`, in the same order — see
 *  `shared/models.mjs`'s copy for why this is duplicated rather than imported
 *  from the TypeScript, and how the two are compared. */
const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'];

export class ModelEnvInvalid extends Error {
  constructor(message) { super(message); this.name = 'ModelEnvInvalid'; }
}

/** The eight keys `modelEnvBlock` can write, frozen so a caller iterates them
 *  rather than spelling them a second time. `clearSettingsEnv(path,
 *  MODEL_ENV_KEYS)` is `ccrc models <id> rm`'s whole settings step (spec §4.1
 *  Lifecycle, §10, §11) — the single-writer pin below counts this export as
 *  the one place these eight names originate, so a caller that respelled them
 *  would be a second definition and not merely a second writer. The eighth,
 *  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, is the one entry `modelEnvBlock` may
 *  OMIT from a given answer (§6.1 amendment) — `mergeSettingsEnv` below is
 *  what deletes it off a lane's settings when a re-materialise stops emitting
 *  it, which is why this list, and not just `modelEnvBlock`'s return value,
 *  is the set that function treats as its own. */
export const MODEL_ENV_KEYS = Object.freeze([
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
]);

const slot = (registry, cls) => {
  const v = registry.classes[cls];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

/**
 * `(registry: Registry, catalogue: Catalogue | null) => Record<string, string>`
 * — the seven MANDATORY variables of §6.1, plus an eighth,
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, written only when `catalogue` can measure
 * it (§6.1, amended 2026-09-08).
 *
 * The two fallback chains STOP where §6.1 stops them, and that is deliberate:
 * `ANTHROPIC_MODEL` is opus ?? sonnet ?? haiku and `ANTHROPIC_SMALL_FAST_MODEL`
 * is haiku ?? sonnet, so neither ever reaches `fable`. A lane whose only class
 * were Fable would otherwise run every unqualified request — including the
 * small-fast ones — on the most expensive model it has. That lane is refused
 * instead, by the same guard that refuses an all-null registry.
 *
 * `CLAUDE_CODE_SUBAGENT_MODEL` is `classes[registry.subagent]` — the operator's
 * explicit class-to-slot choice (§4.1, ruling 5c), never `classes.sonnet` by
 * derivation. A subagent naming a null slot is REFUSED rather than sentinelled:
 * a sentinel there fails one subagent turn at a time, at the provider, with
 * nothing having said so when the lane was configured. `parseRegistry` refuses
 * the same shape; this is the second gate, for a caller that built a registry
 * object in memory rather than reading one off disk.
 *
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` exists because Claude Code 2.1.263 assumes
 * a 200k window for any model id it does not know, and compacts proactively at
 * that window; the catalogue knows the real one. It is written ONLY when
 * `catalogue` is non-null, NOT stale (§11: a stale catalogue is the previous
 * one kept after a failed probe, and a stale window is not a measured one),
 * lists the model `ANTHROPIC_MODEL` resolved to above, and that row's
 * `context` is a number — every other case OMITS the key (never a sentinel:
 * there is no "unavailable" reading for a context window, only "unknown", and
 * the client's own 200k default already means "unknown"). The value is
 * written as a STRING: every other value in this block is one, env vars are
 * always strings on the wire, and a bare number here would be the one key
 * that differs. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is
 * never written by this function, or anywhere else in this design (§6.1): the
 * proactive compaction it would disable is what keeps a lane whose default
 * model has no measured window from hitting the provider's own 400 instead.
 *
 * @throws {ModelEnvInvalid} when no class among opus/sonnet/haiku is set, or
 *   when the subagent class's slot is null.
 */
export function modelEnvBlock(registry, catalogue) {
  const haiku = slot(registry, 'haiku');
  const sonnet = slot(registry, 'sonnet');
  const opus = slot(registry, 'opus');
  const fable = slot(registry, 'fable');
  const primary = opus ?? sonnet ?? haiku;
  if (primary === null) {
    throw new ModelEnvInvalid(
      'a lane needs at least one class among opus, sonnet and haiku: ANTHROPIC_MODEL cannot be '
      + 'derived, so every unqualified request on this lane would have no model at all');
  }
  const subagentClass = registry.subagent;
  if (!CLASSES.includes(subagentClass)) {
    throw new ModelEnvInvalid(
      `subagent is ${JSON.stringify(subagentClass)}, which is not one of ${CLASSES.join(', ')}`);
  }
  const subagentId = slot(registry, subagentClass);
  if (subagentId === null) {
    throw new ModelEnvInvalid(
      `subagent names "${subagentClass}", whose slot is null: CLAUDE_CODE_SUBAGENT_MODEL would be a `
      + 'sentinel and every subagent on this lane would fail at the provider, one turn at a time. '
      + `Assign ${subagentClass} a model, or point subagent at a class that has one.`);
  }
  const sentinel = (cls) => `${UNAVAILABLE_PREFIX}${cls}`;
  const block = {
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku ?? sentinel('haiku'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet ?? sentinel('sonnet'),
    ANTHROPIC_DEFAULT_OPUS_MODEL: opus ?? sentinel('opus'),
    ANTHROPIC_DEFAULT_FABLE_MODEL: fable ?? sentinel('fable'),
    ANTHROPIC_MODEL: primary,
    ANTHROPIC_SMALL_FAST_MODEL: haiku ?? sonnet ?? sentinel('haiku'),
    CLAUDE_CODE_SUBAGENT_MODEL: subagentId,
  };
  if (catalogue !== null && catalogue !== undefined && !catalogue.stale) {
    const row = catalogue.models.find((m) => m.id === primary);
    if (row !== undefined && typeof row.context === 'number') {
      block.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(row.context);
    }
  }
  return block;
}

/**
 * `(settingsPath: string, block: Record<string,string>) => { changed: boolean }`
 *
 * ADD AND UPDATE for every key `block` carries; for the REST of `MODEL_ENV_KEYS`
 * — today, only `CLAUDE_CODE_MAX_CONTEXT_TOKENS` can be absent from a given
 * `block` — DELETE it if present. Every other key, owned by nobody this
 * function knows about, is never touched: `ccgpt`'s own `_sync_gpt_config`
 * mirrors an allow-list into this same file and is equally careful in the
 * other direction (measured, §1), and a lane's `settings.json` carries the
 * operator's own edits. The eighth key is the one exception because it alone
 * has no sentinel (§6.1 amendment): a catalogue going stale, or the lane's
 * default model changing to one with no measured context, must not leave a
 * STALE number on disk — omission from `block` has to reach the file as a
 * deletion, or a re-materialise could only ever add this key, never retract
 * it.
 *
 * A file that is not JSON, or whose top level is not an object, is a REFUSAL
 * and not an overwrite: the alternative is destroying a hand-edited settings
 * file to fix a model id.
 *
 * Written tmp + rename, this repo's rule for any file another process reads —
 * Claude Code reads this one at launch.
 *
 * @throws {ModelEnvInvalid}
 */
export function mergeSettingsEnv(settingsPath, block) {
  let json = {};
  let existed = false;
  try {
    const text = readFileSync(settingsPath, 'utf8');
    existed = true;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ModelEnvInvalid(
        `${settingsPath} is not valid JSON (${e.message}), so this run will not rewrite it. Fix the `
        + 'file by hand, then re-run — nothing was written.');
    }
  } catch (e) {
    if (e instanceof ModelEnvInvalid) throw e;
    if (e.code !== 'ENOENT') {
      throw new ModelEnvInvalid(`${settingsPath} could not be read: ${e.message}. Nothing was written.`);
    }
  }
  if (existed && (typeof json !== 'object' || json === null || Array.isArray(json))) {
    throw new ModelEnvInvalid(
      `${settingsPath} does not hold a JSON object, so it is not a Claude Code settings file. `
      + 'Nothing was written.');
  }
  const env = (typeof json.env === 'object' && json.env !== null && !Array.isArray(json.env))
    ? json.env : {};
  let changed = false;
  for (const [k, v] of Object.entries(block)) {
    if (env[k] !== v) { env[k] = v; changed = true; }
  }
  // The eighth key can drop OUT of `block` between two materialisations (a
  // catalogue going stale, or the default model changing to one with no
  // measured context). It carries no sentinel, so a STALE value left on disk
  // would misstate the window rather than merely go missing — this is the
  // one member of MODEL_ENV_KEYS this function ever deletes on its own, and
  // it never deletes a key `block` did not have the chance to name.
  for (const k of MODEL_ENV_KEYS) {
    if (!(k in block) && Object.prototype.hasOwnProperty.call(env, k)) {
      delete env[k];
      changed = true;
    }
  }
  if (json.env === undefined) { json.env = env; changed = true; }
  else json.env = env;
  if (!changed && existed) return { changed: false };
  const tmp = `${settingsPath}.ccrc.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, settingsPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    throw new ModelEnvInvalid(`${settingsPath} could not be written: ${e.message}.`);
  }
  return { changed: true };
}

/**
 * `(settingsPath: string, keys: readonly string[]) => { changed: boolean }`
 *
 * `ccrc models <id> rm`'s whole settings step (spec §4.1 Lifecycle, §10, §11):
 * deletes exactly the given keys from a lane's settings `env`, and nothing
 * else. Other env keys are left untouched and every other top-level key is
 * left untouched too — the same "this lane owns its own settings" rule
 * `mergeSettingsEnv` keeps, in the other direction. An `env` left EMPTY by the
 * deletion is removed rather than kept as `{}`, so a fully-reaped lane's
 * settings file carries no trace of the block.
 *
 * A MISSING settings file is not an error: there is nothing to clear, nothing
 * is written, and `{ changed: false }` comes back — `rm` is idempotent, and a
 * second call against an already-reaped lane must be silent.
 *
 * Written tmp + rename, the same atomicity `mergeSettingsEnv` uses.
 *
 * @throws {ModelEnvInvalid} on a settings file that is not JSON, or whose top
 *   level is not an object — the same refusal `mergeSettingsEnv` makes, for
 *   the same reason: the alternative is destroying a hand-edited file to
 *   reap eight keys from it.
 */
export function clearSettingsEnv(settingsPath, keys) {
  let json;
  try {
    const text = readFileSync(settingsPath, 'utf8');
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ModelEnvInvalid(
        `${settingsPath} is not valid JSON (${e.message}), so this run will not rewrite it. Fix the `
        + 'file by hand, then re-run — nothing was written.');
    }
  } catch (e) {
    if (e instanceof ModelEnvInvalid) throw e;
    if (e.code === 'ENOENT') return { changed: false };
    throw new ModelEnvInvalid(`${settingsPath} could not be read: ${e.message}. Nothing was written.`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ModelEnvInvalid(
      `${settingsPath} does not hold a JSON object, so it is not a Claude Code settings file. `
      + 'Nothing was written.');
  }
  const env = (typeof json.env === 'object' && json.env !== null && !Array.isArray(json.env))
    ? json.env : {};
  let changed = false;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(env, k)) { delete env[k]; changed = true; }
  }
  if (!changed) return { changed: false };
  if (Object.keys(env).length === 0) delete json.env;
  else json.env = env;
  const tmp = `${settingsPath}.ccrc.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, settingsPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    throw new ModelEnvInvalid(`${settingsPath} could not be written: ${e.message}.`);
  }
  return { changed: true };
}

/**
 * `(registry: Registry, catalogue: Catalogue | null) => { byModel: Record<string,string> }`
 *
 * The lane's default effort per class, re-keyed BY MODEL ID so `ccgpt-proxy`
 * can answer a request from the body's own `model` field and never parse the
 * registry (§6.4).
 *
 * A level the catalogue positively contradicts is DROPPED rather than written:
 * Luna has no `ultra` and Astra does, and a lane default the provider rejects
 * turns every turn on that class into a 400. "Positively contradicts" is the
 * whole rule — an ABSENT catalogue, or a model listed with an EMPTY `efforts`
 * (every OpenRouter and `compatible` row), leaves the level alone, because
 * unknown is not "none offered". §4.1 states the same asymmetry for the
 * validator: accepted unvalidated, flagged by doctor once a catalogue appears.
 */
export function effortFile(registry, catalogue) {
  const byModel = {};
  const effort = registry.effort ?? {};
  const byId = new Map(((catalogue && catalogue.models) || []).map((m) => [m.id, m]));
  for (const cls of CLASSES) {
    const id = slot(registry, cls);
    const level = effort[cls];
    if (id === null || typeof level !== 'string' || level.length === 0) continue;
    const row = byId.get(id);
    if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(level)) continue;
    byModel[id] = level;
  }
  return { byModel };
}

/**
 * `(registry: Registry, catalogue: Catalogue | null) => string` — four lines in
 * `CLASSES` order, `<class>\t<modelId>\t<state>`, with
 * `state ∈ assigned | unassigned | retired`, and a trailing newline.
 *
 * THREE COLUMNS, because availability is its own marker and is never inferred
 * from an empty field (round-2 ruling 6). A retired class keeps its model id in
 * column 2 — the roster is the operator's and retirement does not empty a slot
 * (§4.3) — and column 3 is what Plan 2's `_lane_classes` reads. The second
 * field is empty EXACTLY when the state is `unassigned`, which is the invariant
 * a `cut -f2` reader depends on.
 *
 * Four lines always, even on an unseeded registry: a fixed line count is what
 * lets a bash reverse lookup answer "no class holds this id" without deciding
 * whether a short file means "not classified" or "not written yet".
 *
 * The sentinel never appears here. It lives in the env block, in a sink.
 */
export function classesTsv(registry, catalogue) {
  const retired = new Set(deriveModels(registry, catalogue ?? null).retired);
  return `${CLASSES.map((c) => {
    const id = slot(registry, c);
    if (id === null) return `${c}\t\tunassigned`;
    return `${c}\t${id}\t${retired.has(id) ? 'retired' : 'assigned'}`;
  }).join('\n')}\n`;
}
```

- [ ] **Step 4: Write `shared/modelenv.d.mts`**

```ts
// shared/modelenv.d.mts — hand-written, `shared/wrapper.d.mts`'s shape and job.
// The `.mjs` beside it is what runs.
import type { Catalogue, Registry } from './models.js';

export interface ModelEnv {
  ANTHROPIC_DEFAULT_HAIKU_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL: string;
  ANTHROPIC_DEFAULT_FABLE_MODEL: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_SMALL_FAST_MODEL: string;
  CLAUDE_CODE_SUBAGENT_MODEL: string;
  // §6.1, amended 2026-09-08: present only when `catalogue` is non-null, not
  // stale, and names ANTHROPIC_MODEL's resolved model with a numeric context.
  CLAUDE_CODE_MAX_CONTEXT_TOKENS?: string;
}
export declare class ModelEnvInvalid extends Error {}
export declare const MODEL_ENV_KEYS: readonly string[];
export declare function modelEnvBlock(registry: Registry, catalogue: Catalogue | null): ModelEnv;
export declare function mergeSettingsEnv(
  settingsPath: string, block: Record<string, string>,
): { changed: boolean };
export declare function clearSettingsEnv(
  settingsPath: string, keys: readonly string[],
): { changed: boolean };
export declare function effortFile(
  registry: Registry, catalogue: Catalogue | null,
): { byModel: Record<string, string> };
export declare function classesTsv(registry: Registry, catalogue: Catalogue | null): string;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npx vitest run test/modelenv.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 6: Write the single-writer pin (round-2 ruling 7)**

Create `server/test/modelenv-single-writer.test.ts`:

```ts
// §6.1 and §12: `shared/modelenv.mjs` is the ONLY file in this tree that writes
// `ANTHROPIC_DEFAULT_*_MODEL` keys, or the eighth key
// `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (§6.1, amended 2026-09-08), into a settings
// file.
//
// It needs its own test because `server/test/single-definition.test.ts`'s scan
// filters `.tsx?` and would never see a second `.mjs` writer — and a second
// writer is exactly what the account-connections wave's settings-block writer
// would be if it grew its own copy instead of calling this one, which its plan's
// Task 25 says it will. Two writers of these eight variables is two opinions
// about what a lane routes to, resolved by whichever ran last.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** Every tracked source file, whatever its language. `git ls-files` rather than
 *  a directory walk so nothing generated, ignored or vendored can enter — and
 *  deliberately NOT filtered by extension, which is the blind spot this exists
 *  to close. */
function tracked(): string[] {
  return execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((p) => !p.startsWith('docs/') && !p.endsWith('.md'));
}

/** A file WRITES the block if it spells one of the four alias variables OR the
 *  eighth key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (§6.1 amendment), AND reaches
 *  a settings file in the same breath. Spelling one in a comment, an
 *  assertion or an expected value is not writing it, which is why the second
 *  half of the conjunction is here — the test corpus names these variables
 *  constantly. */
export function writesTheBlock(src: string): boolean {
  if (!/(ANTHROPIC_DEFAULT_(HAIKU|SONNET|OPUS|FABLE)_MODEL|CLAUDE_CODE_MAX_CONTEXT_TOKENS)/.test(src)) {
    return false;
  }
  return /(writeFileSync|renameSync|mergeSettingsEnv\s*\()/.test(src)
    && /settings\.json/.test(src);
}

describe('§6.1 — one writer of the model env block', () => {
  it('is shared/modelenv.mjs, and nothing else in the tree', () => {
    const holders = tracked()
      .filter((rel) => {
        try { return writesTheBlock(readFileSync(path.join(REPO, rel), 'utf8')); }
        catch { return false; }
      })
      .filter((rel) => !rel.startsWith('server/test/') && !rel.startsWith('pwa/test/')
        && !rel.startsWith('agent/test/'))
      .sort();
    expect(holders).toEqual(['shared/modelenv.mjs']);
  });

  it('the predicate is not vacuous — it catches a second writer and ignores prose', () => {
    // Guards the guard: a `writesTheBlock` that answered false for everything
    // would make the row above pass over any tree at all.
    expect(writesTheBlock(
      'writeFileSync(p, JSON.stringify({env:{ANTHROPIC_DEFAULT_OPUS_MODEL:x}}));\n'
      + '// p is a settings.json')).toBe(true);
    expect(writesTheBlock(
      'writeFileSync(p, JSON.stringify({env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:"1"}}));\n'
      + '// p is a settings.json')).toBe(true);
    expect(writesTheBlock('// ANTHROPIC_DEFAULT_OPUS_MODEL is written by the materialiser'))
      .toBe(false);
    expect(writesTheBlock('writeFileSync(p, "hello"); // settings.json')).toBe(false);
  });

  it('the corpus is real: it holds the writer itself', () => {
    expect(tracked()).toContain('shared/modelenv.mjs');
  });
});

// §4.1 Lifecycle and §10: `ccrc models <id> rm` deletes the same eight keys
// `clearSettingsEnv` owns — a SECOND function that deleted them (rather than
// calling `clearSettingsEnv`) would be a second opinion about what "reaped"
// means, resolved by whichever ran last, exactly like a second writer. This
// is its own describe rather than folded into the one above: the two
// predicates ask different questions of the same corpus and a single holders
// list conflating "writes" and "deletes" would stop naming which one broke.
/** A file DELETES the block if it spells `MODEL_ENV_KEYS` — the frozen export
 *  that is the one place these eight names originate — AND reaches a settings
 *  file in the same breath, either by deleting a key off an `env` object or by
 *  rewriting the file outright. Importing or logging the export is not
 *  deleting it, which is why the second half of the conjunction is here too. */
export function deletesTheBlock(src: string): boolean {
  if (!/MODEL_ENV_KEYS/.test(src)) return false;
  return /(delete\s+env\[|writeFileSync|renameSync)/.test(src) && /settings\.json/.test(src);
}

describe('§4.1 Lifecycle, §10 — one deleter of the model env block\'s keys', () => {
  it('is also shared/modelenv.mjs, and nothing else in the tree', () => {
    const holders = tracked()
      .filter((rel) => {
        try { return deletesTheBlock(readFileSync(path.join(REPO, rel), 'utf8')); }
        catch { return false; }
      })
      .filter((rel) => !rel.startsWith('server/test/') && !rel.startsWith('pwa/test/')
        && !rel.startsWith('agent/test/'))
      .sort();
    expect(holders).toEqual(['shared/modelenv.mjs']);
  });

  it('the predicate is not vacuous — it catches a second deleter and ignores prose', () => {
    expect(deletesTheBlock(
      'import { MODEL_ENV_KEYS } from "./modelenv.mjs";\n'
      + 'for (const k of MODEL_ENV_KEYS) { delete env[k]; }\n'
      + "// env belongs to a lane's settings.json")).toBe(true);
    expect(deletesTheBlock('// MODEL_ENV_KEYS is the export clearSettingsEnv iterates'))
      .toBe(false);
    expect(deletesTheBlock('writeFileSync(p, "hello"); // settings.json')).toBe(false);
  });
});
```

- [ ] **Step 7: Run the pin to verify it passes**

Run: `cd server && npx vitest run test/modelenv-single-writer.test.ts`
Expected: PASS, 5 tests. If either `holders` comes back with an extra path, read that file — a second writer or deleter is either a bug to fix or a call whose file also happens to mention the variables, in which case tighten the predicate rather than adding an exception, and record which you did.

- [ ] **Step 8: Measured mutation check — the single-writer pin catches a second writer**

Create a throwaway `deploy/second-writer.mjs`:

```js
import { writeFileSync } from 'node:fs';
export function bad(p) {
  writeFileSync(p, JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'x' } }));
}
// p is a lane's settings.json
```

then `git add deploy/second-writer.mjs` (the scan is over TRACKED files) and run `cd server && npx vitest run test/modelenv-single-writer.test.ts`.
Expected: one case red — `is shared/modelenv.mjs, and nothing else in the tree`, reporting `[ 'deploy/second-writer.mjs', 'shared/modelenv.mjs' ]`. Then `git rm -f --cached deploy/second-writer.mjs && rm deploy/second-writer.mjs` and re-run; expected PASS.

- [ ] **Step 8b: Measured mutation check — the single-writer pin catches a second deleter**

Create a throwaway `deploy/second-deleter.mjs`:

```js
import { MODEL_ENV_KEYS } from '../shared/modelenv.mjs';
export function bad(env) {
  for (const k of MODEL_ENV_KEYS) delete env[k];
}
// env came from a lane's settings.json
```

then `git add deploy/second-deleter.mjs` and run `cd server && npx vitest run test/modelenv-single-writer.test.ts`.
Expected: one case red — `is also shared/modelenv.mjs, and nothing else in the tree`, reporting `[ 'deploy/second-deleter.mjs', 'shared/modelenv.mjs' ]`. Then `git rm -f --cached deploy/second-deleter.mjs && rm deploy/second-deleter.mjs` and re-run; expected PASS.

- [ ] **Step 9: Write the alias-only fixture and its guard**

Create `server/test/fixtures/settings/project.settings.json` — a settings file in the shape the repo's own projects use, which the guard below scans:

```json
{
  "model": "opus",
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet"
  }
}
```

Create `server/test/settings-aliases.test.ts`:

```ts
// §6.1's rule, as a mechanism: a settings file may name ALIASES only
// (`haiku|sonnet|opus|fable|default`) in `model`, in
// `CLAUDE_CODE_SUBAGENT_MODEL` and in any `ANTHROPIC_*MODEL` key. Concrete ids
// live in the per-account registry file and reach a lane only through the env
// block the materialiser owns.
//
// THE CORPUS IS TRACKED FILES ONLY, and that is the whole distinction: the
// materialiser writes concrete ids into a LANE's `~/<configDirSuffix>/
// settings.json`, which is generated, per box, and never in git. What this
// scans is what ships — the settings a checkout carries and a fixture home is
// seeded from. A test that scanned generated homes would fail on the
// materialiser doing its job.
//
// The liveness row is not decoration: this corpus was EMPTY on the branch this
// task was written from (`git ls-files | grep settings.json` → nothing, measured
// 2026-09-08 on origin/main), and a scan over an empty list passes everything.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

const ALIASES: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable', 'default'];
const MODEL_KEY = /^ANTHROPIC_.*MODEL$/;

/** Every tracked path ending in `settings.json`. */
function corpus(): string[] {
  return execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter((p) => p.endsWith('settings.json'));
}

/** The offending `key: value` pairs in one parsed settings object, at the top
 *  level and inside `env`. An empty array is a clean file. */
export function aliasViolations(json: unknown): string[] {
  const out: string[] = [];
  const check = (where: string, obj: unknown): void => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const governed = k === 'model' || k === 'CLAUDE_CODE_SUBAGENT_MODEL' || MODEL_KEY.test(k);
      if (!governed) continue;
      if (typeof v !== 'string' || !ALIASES.includes(v)) {
        out.push(`${where}${k} = ${JSON.stringify(v)}`);
      }
    }
  };
  check('', json);
  check('env.', (json as Record<string, unknown>)['env']);
  return out;
}

describe('§6.1 — settings files name aliases, never concrete model ids', () => {
  it('the corpus is real: the scan is looking at at least one tracked settings file', () => {
    expect(corpus()).toContain('server/test/fixtures/settings/project.settings.json');
  });

  it('every tracked settings file is alias-only', () => {
    for (const rel of corpus()) {
      const json = JSON.parse(readFileSync(path.join(REPO, rel), 'utf8')) as unknown;
      expect(aliasViolations(json), rel).toEqual([]);
    }
  });

  it('the predicate is not vacuous — a concrete id is caught, at both levels', () => {
    expect(aliasViolations({ model: 'claude-sonnet-5' })).toEqual(['model = "claude-sonnet-5"']);
    expect(aliasViolations({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol' } }))
      .toEqual(['env.ANTHROPIC_DEFAULT_OPUS_MODEL = "gpt-5.6-sol"']);
    expect(aliasViolations({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-5.6-terra' } }))
      .toEqual(['env.CLAUDE_CODE_SUBAGENT_MODEL = "gpt-5.6-terra"']);
    // …and `fable` is in the vocabulary, which is the alias this whole design
    // exists to make routable off an Anthropic lane.
    expect(aliasViolations({ model: 'fable' })).toEqual([]);
    // …and an unrelated key is not governed.
    expect(aliasViolations({ env: { DISABLE_TELEMETRY: '1' } })).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the guard to verify it passes**

Run: `cd server && npx vitest run test/settings-aliases.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 11: Measured mutation check — the alias rule catches a concrete id in a tracked file**

Edit `server/test/fixtures/settings/project.settings.json` and change `"model": "opus"` to `"model": "claude-sonnet-5"`. Run `cd server && npx vitest run test/settings-aliases.test.ts`.
Expected: one case red — `every tracked settings file is alias-only`, reporting `server/test/fixtures/settings/project.settings.json` and `[ 'model = "claude-sonnet-5"' ]`. Restore `"opus"` and re-run; expected PASS.

- [ ] **Step 12: Measured mutation check — the sentinel**

In `shared/modelenv.mjs`, change `ANTHROPIC_DEFAULT_FABLE_MODEL: fable ?? sentinel('fable')` to `...(fable !== null ? { ANTHROPIC_DEFAULT_FABLE_MODEL: fable } : {})`. Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: three cases red — `is the seven variables, byte for byte …`, `writes a SENTINEL for every null slot …` (on the `Object.keys(b)).toHaveLength(7)` assertion) and `creates the file when it is absent …`. Restore and re-run; expected PASS.

- [ ] **Step 12b: Measured mutation check — the eighth key respects staleness (§6.1 amendment)**

In `modelEnvBlock`'s eighth-key block, change `if (catalogue !== null && catalogue !== undefined && !catalogue.stale) {` to `if (catalogue !== null && catalogue !== undefined) {` (dropping the staleness check). Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `is ABSENT when the catalogue is stale — a stale window is not a measured one`, now returning `CLAUDE_CODE_MAX_CONTEXT_TOKENS: '272000'` instead of `undefined`. Restore and re-run; expected PASS.

- [ ] **Step 13: Measured mutation check — the subagent is read from the registry, not derived**

Change `CLAUDE_CODE_SUBAGENT_MODEL: subagentId` to `CLAUDE_CODE_SUBAGENT_MODEL: sonnet ?? sentinel('sonnet')` and delete the two guards above it. Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: two cases red — `CLAUDE_CODE_SUBAGENT_MODEL is classes[subagent] — the registry's explicit choice` and `REFUSES when subagent names a null slot, rather than writing a sentinel there`. Restore and re-run; expected PASS. (This is the mutation that makes ruling 5c load-bearing: the pre-round-2 code derived this variable from the sonnet slot, and the two spellings agree on the seeded gpt lane and nowhere else.)

- [ ] **Step 14: Measured mutation check — the TSV's third column is computed, not constant**

In `classesTsv`, change `retired.has(id) ? 'retired' : 'assigned'` to `'assigned'`. Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `a RETIRED class keeps its id in column 2 and says so in column 3`. Then change it to `retired.has(id) ? 'retired' : 'unassigned'` and re-run: expected THREE different cases red — `is four lines in CLASSES order: class, modelId, state`, `with NO catalogue every non-null class is assigned, never retired`, and `the second field is empty ONLY when the state is unassigned`. Restore and re-run; expected PASS.

- [ ] **Step 15: Measured mutation check — mergeSettingsEnv never removes another key**

Change `const env = (…) ? json.env : {};` to `const env = {};`. Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `ADDS and UPDATES, and never removes another key …`, failing on `expect(j.env.DISABLE_TELEMETRY).toBe('1')`. Restore and re-run; expected PASS.

- [ ] **Step 15b: Measured mutation check — mergeSettingsEnv prunes the eighth key when block omits it**

In `mergeSettingsEnv`, change `if (!(k in block) && Object.prototype.hasOwnProperty.call(env, k)) {` to `if (false) {` (disabling the new prune loop). Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `PRUNES CLAUDE_CODE_MAX_CONTEXT_TOKENS when a re-materialise's block stops emitting it`, on `expect(Object.keys(j.env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS')` (the stale value survives the second call). Restore and re-run; expected PASS.

- [ ] **Step 16: Measured mutation check — the catalogue-contradicted effort level is dropped**

Change `if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(level)) continue;` to `if (false) continue;`. Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `drops a level the catalogue says that model does not offer`. Then change it to `if (row === undefined || !row.efforts.includes(level)) continue;` and re-run: expected two DIFFERENT cases red — `keeps an unvalidatable level when there is no catalogue at all` and `keeps a level when the catalogue lists the model with NO efforts at all`. Restore the original and re-run; expected PASS. (Both directions are measured because the rule is an asymmetry, and only a mutation in each direction shows the asymmetry is load-bearing.)

- [ ] **Step 16b: Measured mutation check — clearSettingsEnv deletes ONLY the given keys**

In `clearSettingsEnv`, change `for (const k of keys) {` to `for (const k of Object.keys(env)) {` (deleting every env key rather than the ones named). Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `clears exactly the eight keys, leaving every other env key untouched`, on `expect(j.env).toEqual({ DISABLE_TELEMETRY: '1' })` (now `{}`). Restore and re-run; expected PASS.

- [ ] **Step 16c: Measured mutation check — an emptied env is removed, not left as `{}`**

Change `if (Object.keys(env).length === 0) delete json.env; else json.env = env;` to `json.env = env;`. Run `cd server && npx vitest run test/modelenv.test.ts`.
Expected: one case red — `removes env entirely once emptied by the deletion, rather than writing {}`, on `expect(Object.keys(j)).toEqual([])` (now `['env']`). Restore and re-run; expected PASS.

- [ ] **Step 17: Commit**

```bash
git add shared/modelenv.mjs shared/modelenv.d.mts server/test/modelenv.test.ts \
        server/test/modelenv-single-writer.test.ts server/test/settings-aliases.test.ts \
        server/test/fixtures/settings/project.settings.json
git commit -m "$(cat <<'MSG'
feat(models): the materialiser's pure half — env block, three-column TSV, effort map

A null class writes `ccrc-unavailable-<class>` and is never left unset: unset,
the alias falls through to Anthropic's own id and the proxied backend 404s
opaquely, which is exactly today's Fable-on-gpt failure. The two fallback chains
stop short of `fable` on purpose, and a lane with nothing but Fable is refused
rather than silently run on its most expensive model.

CLAUDE_CODE_SUBAGENT_MODEL is classes[subagent] — the registry's explicit
class-to-slot choice, never the sonnet slot by derivation — and a subagent naming
a null slot is refused rather than sentinelled: a sentinel there fails one
subagent turn at a time, at the provider, with nothing having said so.

The bash projection gains a third column: assigned | unassigned | retired, so
availability is a positive marker rather than an inference from an empty field,
and a retired class keeps the id the operator assigned it.

The §6.1 alias-only rule becomes a test over every TRACKED settings file, and the
env block gains a single-writer pin the .tsx?-filtered single-definition scan
could never have caught.

`clearSettingsEnv` and its frozen `MODEL_ENV_KEYS` are `ccrc models <id> rm`'s
whole settings step (Task 6): deletes exactly the eight keys the materialiser
owns, off ANY lane's env, and removes an env left empty by the deletion — nothing
else in that file moves. The single-writer pin now also pins the single DELETER
of those keys, for the same reason a second writer would be two opinions about
what a lane routes to.

An eighth key, CLAUDE_CODE_MAX_CONTEXT_TOKENS (spec §6.1, amended 2026-09-08),
is written only when a non-stale catalogue measures ANTHROPIC_MODEL's resolved
model — every other case omits it, never sentinels it, because there is no
"unavailable" reading for a context window. Because omission has to survive a
re-materialise, mergeSettingsEnv now also PRUNES this one key off a lane's env
when a fresh block stops naming it; every other key it still only adds or
updates, which the mutation checks pin in both directions.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: The probe — spine, Codex arm, atomic write, stale-on-failure

**Files:**
- Create: `ccd/ccrc-models-probe`
- Create: `server/test/fixtures/catalogues/codex-raw-2026-09-08.json`
- Create: `server/test/models-probe.test.ts`
- Test: `server/test/models-probe.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime (it is a standalone executable); its OUTPUT is `Catalogue` JSON as `shared/models.ts`'s `parseCatalogue` defines it (Task 2), and the test asserts that by parsing what it writes through that function.
- Produces:
  - the executable `ccd/ccrc-models-probe`, invoked as
    `ccrc-models-probe <accountId> <probe> [--base-url <url>] [--out <path>]`, where `<probe>` is a **PROBE KIND** — `codex | openrouter | compatible` — and never a roster provider (round-2 ruling 10);
  - the file `~/.ccrc/models/<accountId>.json`, written tmp + `mv -f`;
  - exit codes: 0 wrote a fresh catalogue; 1 the fetch or the response failed and the PREVIOUS catalogue was kept and marked `stale` (or, when there was none, nothing was written); 2 usage.
  - the test seam `CCRC_MODELS_PROBE_FIXTURE`, documented below.

- [ ] **Step 1: Record the Codex response as a fixture**

Create `server/test/fixtures/catalogues/codex-raw-2026-09-08.json` — the RAW shape `GET https://chatgpt.com/backend-api/codex/models?client_version=0.160.0` answers with, in the field names the live probe read on 2026-09-08 (`slug`, `display_name`, `context_window`, `max_context_window`, `visibility`, `supported_reasoning_levels`, `default_reasoning_level`, `description`), carrying the nine models spec §1 records and the numbers spec §4.2 records:

```json
{
  "models": [
    {
      "slug": "gpt-6-astra",
      "display_name": "GPT-6-Astra",
      "description": "our most capable model",
      "context_window": 272000,
      "max_context_window": 872000,
      "visibility": "show",
      "default_reasoning_level": "high",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"},
        {"effort": "xhigh"}, {"effort": "max"}, {"effort": "ultra"}
      ]
    },
    {
      "slug": "gpt-5.6-sol",
      "display_name": "GPT-5.6 Sol",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "show",
      "default_reasoning_level": "max",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"},
        {"effort": "xhigh"}, {"effort": "max"}
      ]
    },
    {
      "slug": "gpt-5.6-terra",
      "display_name": "GPT-5.6 Terra",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "show",
      "default_reasoning_level": "high",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"},
        {"effort": "xhigh"}, {"effort": "max"}
      ]
    },
    {
      "slug": "gpt-5.6-luna",
      "display_name": "GPT-5.6 Luna",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "show",
      "default_reasoning_level": "high",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"},
        {"effort": "xhigh"}, {"effort": "max"}
      ]
    },
    {
      "slug": "gpt-5.5",
      "display_name": "GPT-5.5",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "show",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"}
      ]
    },
    {
      "slug": "gpt-5.4-mini",
      "display_name": "GPT-5.4 mini",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "show",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"}
      ]
    },
    {
      "slug": "gpt-5.3-codex-spark",
      "display_name": "GPT-5.3 Codex Spark",
      "description": "",
      "context_window": 128000,
      "max_context_window": 128000,
      "visibility": "show",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        {"effort": "low"}, {"effort": "medium"}, {"effort": "high"}
      ]
    },
    {
      "slug": "gpt-reserve",
      "display_name": "GPT Reserve",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "hide",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [{"effort": "medium"}]
    },
    {
      "slug": "codex-auto-review",
      "display_name": "Codex Auto Review",
      "description": "",
      "context_window": 272000,
      "max_context_window": 272000,
      "visibility": "hide",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [{"effort": "medium"}]
    }
  ]
}
```

- [ ] **Step 2: Write the failing test file**

Create `server/test/models-probe.test.ts`:

```ts
// `ccd/ccrc-models-probe` — the catalogue fetcher (§5), its atomic write and
// its stale-on-failure rule (§11).
//
// IT IS KEYED BY PROBE KIND, not by a roster provider (round-2 ruling 10): the
// three arms are `codex`, `openrouter` and `compatible`, which is exactly the
// `probe` field of `~/.ccrc/models/<id>.classes.json`.
//
// ── HOW THE FIXTURE CONTAINS IT ──────────────────────────────────────────
//  1. HOME is a throwaway `mkTmp` directory. The probe writes
//     `$HOME/.ccrc/models/<id>.json` and nothing else; the live `~/.ccrc` on
//     the box this suite runs on holds the operator's real catalogues.
//  2. `ghContainedEnv` plants the poisoned `gh`, and this file plants a
//     poisoned `curl` beside it. Every case asserts the curl log is EMPTY:
//     the probe must reach the network through NOTHING in these tests.
//  3. `CCRC_MODELS_PROBE_FIXTURE` is the one seam that makes (2) possible —
//     it replaces the FETCH with a `cat` of the named file and touches no
//     other line of the probe. A missing file through that seam is exactly a
//     failed fetch, which is how the stale path below is driven.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { parseCatalogue } from '../../shared/models.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const PROBE = path.join(REPO, 'ccd', 'ccrc-models-probe');
const CODEX_RAW = path.join(here, 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

let home: string;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home, ...extra });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-poison"\n'
    + 'echo "the probe must never reach the network under test" >&2\nexit 97\n', { mode: 0o755 });
  return e;
}

interface Result { code: number; stdout: string; stderr: string }
function run(args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [PROBE, ...args], { env: env(extra), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const curlCalls = (): string[] => {
  const p = path.join(home, 'curl-poison');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

const catalogueAt = (id: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', `${id}.json`), 'utf8'));

beforeEach(() => { home = mkTmp('ccrc-models-probe-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('usage', () => {
  it('with no arguments exits 2 and prints the usage line', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage: ccrc-models-probe <accountId> <probe>/);
  });

  it('refuses an unknown probe kind at exit 2, naming the three', () => {
    const r = run(['gpt', 'gemini']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/codex, openrouter, compatible/);
  });

  it('refuses `openai` by name — that is the account-connections PROVIDER spelling', () => {
    // Round-2 ruling 10: probes are keyed by `registry.probe`. `openai` is a
    // ProviderId on a branch that is not on main, and accepting it here would
    // let a stale caller write a catalogue this build cannot parse.
    const r = run(['gpt', 'openai']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/the Codex probe kind is spelled "codex"/);
  });

  it('refuses `anthropic` with its own sentence — those classes are the client\'s defaults (§5)', () => {
    const r = run(['claude', 'anthropic']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/anthropic lanes have no catalogue/);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models'))).toBe(false);
  });

  it('refuses an account id that is not an id', () => {
    const r = run(['../escape', 'codex']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/account id/);
  });
});

describe('the Codex arm (§5)', () => {
  it('writes the nine models, hidden flagged, efforts carried', () => {
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(curlCalls()).toEqual([]);
    const cat = parseCatalogue(catalogueAt('gpt'));
    expect(cat.probe).toBe('codex');
    expect(cat.stale).toBe(false);
    expect(cat.models.map((m) => m.id)).toEqual([
      'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
      'gpt-reserve', 'codex-auto-review',
    ]);
    expect(cat.models.filter((m) => m.hidden).map((m) => m.id))
      .toEqual(['gpt-reserve', 'codex-auto-review']);
    const astra = cat.models[0]!;
    expect(astra.label).toBe('GPT-6-Astra');
    expect(astra.context).toBe(272000);
    expect(astra.maxContext).toBe(872000);
    expect(astra.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    // Luna has no `ultra` and Astra does — the asymmetry §4.1 validates
    // `effort` against, so it has to survive the probe.
    expect(cat.models.find((m) => m.id === 'gpt-5.6-luna')!.efforts).not.toContain('ultra');
    // A Codex row carries no prices.
    expect(astra.priceIn).toBeNull();
    expect(astra.priceOut).toBeNull();
  });

  it('stamps fetchedAt with a plausible epoch second, not a millisecond', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const cat = parseCatalogue(catalogueAt('gpt'));
    const now = Math.floor(Date.now() / 1000);
    expect(cat.fetchedAt).toBeGreaterThan(now - 120);
    expect(cat.fetchedAt).toBeLessThanOrEqual(now + 1);
  });

  it('writes atomically — no temp file survives, and the mode is 0600', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readdirSync(path.join(home, '.ccrc', 'models'))).toEqual(['gpt.json']);
    const mode = fs.statSync(path.join(home, '.ccrc', 'models', 'gpt.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('--out redirects the write and leaves the default path alone', () => {
    const out = path.join(home, 'elsewhere.json');
    const r = run(['gpt', 'codex', '--out', out], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });

  it('never touches the lane\'s REGISTRY file', () => {
    // The probe writes catalogues. The registry is the operator's, written only
    // by the verbs (§4.1) — a probe that could rewrite it would be a second
    // opinion about what a lane routes to.
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    const regPath = path.join(home, '.ccrc', 'models', 'gpt.classes.json');
    fs.writeFileSync(regPath, '{"kept":true}');
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readFileSync(regPath, 'utf8')).toBe('{"kept":true}');
  });
});

describe('failure keeps the previous catalogue and marks it stale (§11)', () => {
  it('a failed fetch rewrites the previous file with stale:true and lastError, and NOTHING else changes', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = parseCatalogue(catalogueAt('gpt'));
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'no-such-file') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/keeping the previous catalogue/);
    const after = parseCatalogue(catalogueAt('gpt'));
    expect(after.stale).toBe(true);
    expect(after.lastError).toBeTruthy();
    expect(after.models).toEqual(before.models);
    expect(after.fetchedAt).toBe(before.fetchedAt);
  });

  it('a failed fetch with NO previous catalogue writes nothing at all', () => {
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'no-such-file') });
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });

  it('a SUCCESSFUL probe clears the stale flag and the error', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const cat = parseCatalogue(catalogueAt('gpt'));
    expect(cat.stale).toBe(false);
    expect(cat.lastError).toBeUndefined();
  });
});

describe('schema drift refuses the WHOLE response (§11)', () => {
  const bad = (name: string, body: unknown): string => {
    const p = path.join(home, name);
    fs.writeFileSync(p, JSON.stringify(body));
    return p;
  };

  it.each([
    ['no models array', { data: [] }],
    ['a model with no slug', { models: [{ display_name: 'x' }] }],
    ['a model that is not an object', { models: ['gpt-5.6-sol'] }],
    ['a body that is not an object', [1, 2, 3]],
  ] as const)('refuses %s, keeping the previous catalogue', (why, body) => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = catalogueAt('gpt');
    const r = run(['gpt', 'codex'],
      { CCRC_MODELS_PROBE_FIXTURE: bad(`drift-${why.replace(/\W+/g, '-')}.json`, body) });
    expect(r.code).toBe(1);
    const after = parseCatalogue(catalogueAt('gpt'));
    expect(after.stale).toBe(true);
    expect(after.models).toEqual(parseCatalogue(before).models);
  });

  it('a partial catalogue is never written — one bad model kills the whole file', () => {
    // Eight good rows and one with no slug. Writing the eight would RETIRE the
    // ninth on every surface (§4.3), which is a warning about a model that
    // answers fine.
    const raw = JSON.parse(fs.readFileSync(CODEX_RAW, 'utf8')) as { models: unknown[] };
    raw.models.push({ display_name: 'no slug here' });
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: bad('partial.json', raw) });
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });
});

describe('the test seam is a seam and not a second code path', () => {
  it('CCRC_MODELS_PROBE_FIXTURE is read in exactly one place', () => {
    // A seam that appeared in two branches would be a second implementation of
    // "fetch", and the network arm would stop being the thing under test.
    const src = fs.readFileSync(PROBE, 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => l.includes('CCRC_MODELS_PROBE_FIXTURE'))).toHaveLength(1);
  });

  it('the probe is executable and has a bash shebang', () => {
    expect(fs.statSync(PROBE).mode & 0o111).toBeGreaterThan(0);
    expect(fs.readFileSync(PROBE, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bash');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && npx vitest run test/models-probe.test.ts`
Expected: FAIL — every case, because `ccd/ccrc-models-probe` does not exist (`spawnSync` returns status null → `code` -1, and `the probe is executable…` throws ENOENT on `statSync`).

- [ ] **Step 4: Write `ccd/ccrc-models-probe`**

```bash
#!/usr/bin/env bash
# ccrc-models-probe — fetch one lane's model catalogue and write it to
# ~/.ccrc/models/<accountId>.json (spec §5).
#
# KEYED BY PROBE KIND, NOT BY PROVIDER. Round-2 ruling 10: `codex`,
# `openrouter`, `compatible` — exactly the `probe` field of that lane's
# ~/.ccrc/models/<accountId>.classes.json. `openai` is the account-connections
# branch's ProviderId, that branch is not on main, and this tool refuses the
# spelling by name so a stale caller fails loudly rather than writing a
# catalogue nothing here can parse.
#
# ONE EXECUTABLE, ONE ARM PER KIND, because the three fetches have nothing in
# common but their answer: Codex needs the lane's OAuth through LiteLLM's own
# `Authenticator` (the token refresh lives there, and `ccgpt-usage` already
# reaches it exactly this way — read that file, it is the model this arm
# copies); OpenRouter's list needs no credential at all; a `compatible`
# endpoint needs the lane's token and may not answer at all. What they share is
# the NORMALISER and the WRITE, and those are single here.
#
# ── THE WRITE IS ATOMIC AND THE FAILURE IS NOT DESTRUCTIVE ────────────────
# The catalogue is read by another process (the server's fleet poll, ccd, the
# verbs), so it lands tmp + `mv -f` — this repo's rule for any such file. And a
# failed probe NEVER deletes a catalogue: it rewrites the previous one with
# `stale: true` and the error text in `lastError` (§11), because "the network
# was down for an hour" must not read on every surface as "every model this lane
# had is retired".
#
# IT NEVER TOUCHES <accountId>.classes.json. That file is the operator's
# registry, written only by the verbs (§4.1).
#
# ── THE ONE TEST SEAM ─────────────────────────────────────────────────────
# `CCRC_MODELS_PROBE_FIXTURE`, when set, replaces the FETCH — and only the
# fetch — with a read of the named file. It exists so the suite can drive every
# arm, the normaliser and both failure paths without a packet leaving the box;
# a missing file through it is exactly a failed fetch, which is how the stale
# path is driven. It is read in ONE place, and `server/test/models-probe.test.ts`
# asserts that: a seam in two branches would be a second implementation of
# "fetch" and the network arm would stop being the thing under test.
set -uo pipefail

PROG="ccrc-models-probe"
# The client version the Codex catalogue endpoint is asked for. A CONSTANT,
# bumped deliberately (§5): OpenAI's backend keys what it advertises on it, so
# tracking it automatically would change this box's model set without anybody
# deciding to.
CODEX_CLIENT_VERSION="0.160.0"
# `shared/roster.ts`'s ID_RE, in bash. An account id becomes a filename here.
ID_RE='^[a-z][a-z0-9-]{0,31}$'

die() { echo "$PROG: $*" >&2; exit 1; }
usage() {
  echo "usage: $PROG <accountId> <probe> [--base-url <url>] [--out <path>]" >&2
  echo "       <probe> is codex, openrouter or compatible — the registry file's own probe kind" >&2
}
usage_die() { echo "$PROG: $*" >&2; usage; exit 2; }

ACCOUNT=""; PROBE_KIND=""; BASE_URL=""; OUT=""
[ $# -ge 1 ] || usage_die "an account id is required"
ACCOUNT="$1"; shift
[ $# -ge 1 ] || usage_die "a probe kind is required"
PROBE_KIND="$1"; shift
while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) [ $# -ge 2 ] || usage_die "--base-url needs a value"; BASE_URL="$2"; shift 2 ;;
    --out)      [ $# -ge 2 ] || usage_die "--out needs a value";      OUT="$2";      shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) usage_die "unknown argument: $1" ;;
  esac
done

[[ "$ACCOUNT" =~ $ID_RE ]] \
  || usage_die "\"$ACCOUNT\" is not an account id: a lowercase letter followed by up to 31 of letters, digits and \"-\". The id becomes a filename under ~/.ccrc/models, which is why the charset is narrow."

case "$PROBE_KIND" in
  codex|openrouter|compatible) : ;;
  openai) usage_die "the Codex probe kind is spelled \"codex\", not \"openai\": this tool is keyed by the registry file's probe kind and not by an account's provider (spec §4.1). Nothing was written." ;;
  anthropic) usage_die "anthropic lanes have no catalogue to probe — their four classes are Claude Code's own defaults and they carry no registry file (spec §5). Nothing was written." ;;
  *) usage_die "unknown probe kind \"$PROBE_KIND\": it must be one of codex, openrouter, compatible" ;;
esac

MODELS_DIR="$HOME/.ccrc/models"
[ -n "$OUT" ] || OUT="$MODELS_DIR/$ACCOUNT.json"

TMPD="$(mktemp -d "${TMPDIR:-/tmp}/ccrc-models-probe.XXXXXX")" || die "could not make a temp directory"
trap 'rm -rf "$TMPD"' EXIT
RAW="$TMPD/raw.json"
NORM="$TMPD/catalogue.json"

# ── the fetch ────────────────────────────────────────────────────────────
# Each arm writes the provider's RAW body to $RAW and returns non-zero when it
# could not. Nothing here interprets the body; that is the normaliser's job, in
# one place, for all three.
_fetch_codex() {
  # `ccgpt-usage`'s own preamble, verbatim in intent: the venv python beside the
  # litellm binary, falling back to the system one, and the token directory the
  # wrapper exports. `Authenticator().get_access_token()` REFRESHES an expired
  # token, which is the whole reason this arm goes through LiteLLM rather than
  # reading auth.json itself.
  local venv_py token_dir
  venv_py="$(dirname "$(readlink -f "$(command -v litellm)" 2>/dev/null)")/python"
  [ -x "$venv_py" ] || venv_py="python3"
  token_dir="${CHATGPT_TOKEN_DIR:-$HOME/.handoff/chatgpt-auth}"
  [ -f "$token_dir/auth.json" ] \
    && CHATGPT_TOKEN_DIR="$token_dir" CODEX_CLIENT_VERSION="$CODEX_CLIENT_VERSION" \
       "$venv_py" - > "$RAW" <<'PY'
import json, os, sys, urllib.request
from litellm.llms.chatgpt.authenticator import Authenticator

token_dir = os.environ["CHATGPT_TOKEN_DIR"]
account_id = json.load(open(os.path.join(token_dir, "auth.json"))).get("account_id", "")
token = Authenticator().get_access_token()
headers = {"Authorization": f"Bearer {token}", "User-Agent": "codex-cli"}
if account_id:
    headers["ChatGPT-Account-Id"] = account_id
url = ("https://chatgpt.com/backend-api/codex/models?client_version="
       + os.environ["CODEX_CLIENT_VERSION"])
req = urllib.request.Request(url, headers=headers)
sys.stdout.write(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
PY
}

_fetch() {
  # THE ONE READ OF THE SEAM. Everything below it is the real network.
  if [ -n "${CCRC_MODELS_PROBE_FIXTURE:-}" ]; then cat "$CCRC_MODELS_PROBE_FIXTURE" > "$RAW"; return; fi
  case "$PROBE_KIND" in
    codex) _fetch_codex ;;
    *) echo "$PROG: probe kind \"$PROBE_KIND\" has no fetch arm in this build" >&2; return 1 ;;
  esac
}

# ── the normaliser ───────────────────────────────────────────────────────
# ONE python program for every arm: it reads the raw body on stdin, the probe
# kind on argv, and writes `Catalogue` JSON (shared/models.ts) on stdout. It
# REFUSES THE WHOLE RESPONSE on a model with no id (§11) — writing the good
# rows would retire the bad one on every surface, which is a warning about a
# model that answers fine.
_normalise() {
  python3 - "$PROBE_KIND" < "$RAW" > "$NORM" <<'PY'
import json, sys, time

probe = sys.argv[1]

def fail(msg):
    sys.stderr.write(msg + "\n")
    raise SystemExit(3)

try:
    raw = json.load(sys.stdin)
except ValueError as e:
    fail("the provider's response is not JSON: %s" % e)

def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

def codex_models(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("models"), list):
        fail("the Codex catalogue has no `models` array — the endpoint's shape has drifted")
    out = []
    for i, m in enumerate(raw["models"]):
        if not isinstance(m, dict):
            fail("Codex models[%d] is not an object" % i)
        mid = m.get("slug") or m.get("id")
        if not isinstance(mid, str) or not mid:
            fail("Codex models[%d] has no slug" % i)
        levels = m.get("supported_reasoning_levels") or m.get("reasoning_levels") or []
        efforts = []
        for e in levels if isinstance(levels, list) else []:
            name = e.get("effort") if isinstance(e, dict) else e
            if isinstance(name, str) and name:
                efforts.append(name)
        label = m.get("display_name") or m.get("name") or mid
        out.append({
            "id": mid, "label": label,
            "context": num(m.get("context_window")),
            "maxContext": num(m.get("max_context_window")),
            "efforts": efforts,
            "hidden": m.get("visibility") == "hide",
            "priceIn": None, "priceOut": None,
        })
    return out

ARMS = {"codex": codex_models}
if probe not in ARMS:
    fail("no normaliser arm for probe kind %r in this build" % probe)

json.dump({
    "probe": probe,
    "fetchedAt": int(time.time()),
    "stale": False,
    "models": ARMS[probe](raw),
}, sys.stdout)
PY
}

# ── stale-on-failure ─────────────────────────────────────────────────────
# Rewrites the EXISTING catalogue with `stale: true` and `lastError`, keeping
# its models and its `fetchedAt` — the reader needs to know how old the data it
# is looking at really is, so the timestamp must not be refreshed by a run that
# fetched nothing.
_mark_stale() {   # <reason>
  [ -f "$OUT" ] || {
    echo "$PROG: $1 — and this lane has no previous catalogue, so nothing was written." >&2
    return 1
  }
  local why="$1"
  CCRC_STALE_WHY="$why" python3 - "$OUT" "$TMPD/stale.json" <<'PY' || return 1
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
try:
    cat = json.load(open(src))
except ValueError:
    raise SystemExit(1)
cat["stale"] = True
cat["lastError"] = os.environ["CCRC_STALE_WHY"]
json.dump(cat, open(dst, "w"))
PY
  mv -f "$TMPD/stale.json" "$OUT" || return 1
  echo "$PROG: $why — keeping the previous catalogue, marked stale." >&2
  return 1
}

mkdir -p "$(dirname "$OUT")" || die "could not create $(dirname "$OUT")"

if ! _fetch 2>"$TMPD/fetch.err"; then
  _mark_stale "the $PROBE_KIND catalogue fetch for \"$ACCOUNT\" failed: $(tr '\n' ' ' < "$TMPD/fetch.err" | cut -c1-300)"
  exit 1
fi
if ! _normalise 2>"$TMPD/norm.err"; then
  _mark_stale "the $PROBE_KIND response for \"$ACCOUNT\" was refused: $(tr '\n' ' ' < "$TMPD/norm.err" | cut -c1-300)"
  exit 1
fi

# 0600 before the rename, not after: the file is world-readable for the width of
# an fchmod otherwise, and an OpenRouter catalogue carries the lane's price list.
chmod 600 "$NORM" || die "could not set the mode on the new catalogue"
mv -f "$NORM" "$OUT" || die "could not move the new catalogue into place at $OUT"
exit 0
```

- [ ] **Step 5: Make it executable and run the test**

```bash
chmod 755 ccd/ccrc-models-probe
cd server && npx vitest run test/models-probe.test.ts
```
Expected: PASS. Note the `a failed fetch with NO previous catalogue writes nothing at all` case depends on `_mark_stale` returning 1 without creating the file — if it fails, the `[ -f "$OUT" ] ||` early return is wrong.

- [ ] **Step 6: Measured mutation check — the write is atomic**

Replace `mv -f "$NORM" "$OUT"` with `cp "$NORM" "$OUT"` and add `: > "$OUT.ccrc.tmp"` before it. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: one case red — `writes atomically — no temp file survives, and the mode is 0600`, failing with `expected [ 'gpt.json', 'gpt.json.ccrc.tmp' ] to deeply equal [ 'gpt.json' ]`. Restore both lines and re-run; expected PASS.

- [ ] **Step 7: Measured mutation check — stale never refreshes `fetchedAt`**

In `_mark_stale`'s python, add `cat["fetchedAt"] = int(__import__("time").time())` after `cat["stale"] = True`. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: one case red — `a failed fetch rewrites the previous file with stale:true …`, on `expect(after.fetchedAt).toBe(before.fetchedAt)`. Restore and re-run; expected PASS.

- [ ] **Step 8: Measured mutation check — the whole response is refused, not the bad row**

In the normaliser's `codex_models`, change `fail("Codex models[%d] has no slug" % i)` to `continue`. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: two cases red — `refuses a model with no slug, keeping the previous catalogue` and `a partial catalogue is never written — one bad model kills the whole file`. Restore and re-run; expected PASS.

- [ ] **Step 9: Measured mutation check — `openai` is refused, not aliased**

Change the `openai)` arm of the probe-kind `case` to `openai) PROBE_KIND=codex ;;`. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: one case red — `refuses `openai` by name — that is the account-connections PROVIDER spelling`. Restore and re-run; expected PASS. (Aliasing would look harmless and would let a caller keep the pre-round-2 spelling alive across the whole tree.)

- [ ] **Step 10: Prove the executable carries no provenance marker to re-stamp**

Run: `sed -n 2p ccd/ccrc-models-probe`
Expected: the comment line beginning `# ccrc-models-probe — fetch one lane's model catalogue`, NOT a `# ccrc:generated` line. Nothing to re-stamp.

- [ ] **Step 11: Commit**

```bash
git add ccd/ccrc-models-probe server/test/models-probe.test.ts \
        server/test/fixtures/catalogues/codex-raw-2026-09-08.json
git commit -m "$(cat <<'MSG'
feat(models): the catalogue probe, keyed by probe kind, with a failure that keeps what it had

One executable, one arm per PROBE KIND — codex, openrouter, compatible — which is
the registry file's own `probe` field and never an account's provider. The Codex
arm reaches the lane's OAuth through LiteLLM's own Authenticator, exactly as
ccgpt-usage does, because that is where the token refresh lives.

A failed probe never deletes a catalogue: it rewrites the previous one with
stale:true and the error text, keeping its fetchedAt so a reader can still tell
how old the data really is. Schema drift refuses the WHOLE response — writing the
good rows would retire the bad one on every surface, which is a warning about a
model that answers fine. And nothing here ever writes the lane's registry file.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: The probe's OpenRouter and compatible arms, and the whitelist endpoints mode

**Files:**
- Modify: `ccd/ccrc-models-probe` (a second and third `_fetch` arm, two normaliser arms, and the `--endpoints` mode)
- Create: `server/test/fixtures/catalogues/openrouter-raw-page.json`, `server/test/fixtures/catalogues/compatible-raw.json`, `server/test/fixtures/catalogues/openrouter-endpoints-raw.json`
- Test: `server/test/models-probe.test.ts` (three new describes)

**Interfaces:**
- Consumes: the spine, the normaliser dispatch table and `_mark_stale` from Task 4.
- Produces: `ccrc-models-probe <id> openrouter`, `ccrc-models-probe <id> compatible --base-url <url>`, and `ccrc-models-probe <id> openrouter --endpoints <modelId> --out <path>` — the last writes the RAW endpoints body (not a catalogue) and is what Task 8's `discovery add` hands to `deploy/models-op.mjs` for the ownership-whitelist check (§5, §8).

- [ ] **Step 1: Record the two catalogue fixtures and the endpoints fixture**

`server/test/fixtures/catalogues/openrouter-raw-page.json` — the shape `GET https://openrouter.ai/api/v1/models` answers with (`data[]`, each with `id`, `name`, `context_length`, `top_provider.max_completion_tokens`, `pricing.prompt`/`pricing.completion` as decimal strings):

```json
{
  "data": [
    {
      "id": "anthropic/claude-opus-4.5",
      "name": "Anthropic: Claude Opus 4.5",
      "context_length": 200000,
      "top_provider": {"max_completion_tokens": 64000},
      "pricing": {"prompt": "0.000005", "completion": "0.000025"}
    },
    {
      "id": "z-ai/glm-5.2",
      "name": "Z.AI: GLM 5.2",
      "context_length": 131072,
      "top_provider": {"max_completion_tokens": 32768},
      "pricing": {"prompt": "0.0000006", "completion": "0.0000022"}
    },
    {
      "id": "qwen/qwen3.5-9b",
      "name": "Qwen: Qwen3.5 9B",
      "context_length": 32768,
      "top_provider": {"max_completion_tokens": null},
      "pricing": {"prompt": "0", "completion": "0"}
    }
  ]
}
```

`server/test/fixtures/catalogues/compatible-raw.json` — the OpenAI-shaped `/v1/models` body a `compatible` endpoint answers with:

```json
{
  "object": "list",
  "data": [
    {"id": "glm-5.2", "object": "model", "owned_by": "cortecs"},
    {"id": "qwen3.5-9b", "object": "model", "owned_by": "cortecs"}
  ]
}
```

`server/test/fixtures/catalogues/openrouter-endpoints-raw.json` — the shape `GET /api/v1/models/{author}/{slug}/endpoints` answers with, trimmed to the one field the whitelist check reads:

```json
{
  "data": {
    "id": "z-ai/glm-5.2",
    "name": "Z.AI: GLM 5.2",
    "endpoints": [
      {"name": "Cortecs | z-ai/glm-5.2", "provider_name": "Cortecs", "context_length": 131072},
      {"name": "Z.AI | z-ai/glm-5.2", "provider_name": "Z.AI", "context_length": 131072}
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

Append to `server/test/models-probe.test.ts`:

```ts
const OPENROUTER_RAW = path.join(here, 'fixtures', 'catalogues', 'openrouter-raw-page.json');
const COMPATIBLE_RAW = path.join(here, 'fixtures', 'catalogues', 'compatible-raw.json');
const ENDPOINTS_RAW = path.join(here, 'fixtures', 'catalogues', 'openrouter-endpoints-raw.json');

describe('the OpenRouter arm (§5)', () => {
  it('carries ids, labels, context and PRICES, and flags nothing hidden', () => {
    const r = run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    expect(r.code).toBe(0);
    expect(curlCalls()).toEqual([]);
    const cat = parseCatalogue(catalogueAt('router'));
    expect(cat.probe).toBe('openrouter');
    expect(cat.models.map((m) => m.id))
      .toEqual(['anthropic/claude-opus-4.5', 'z-ai/glm-5.2', 'qwen/qwen3.5-9b']);
    const opus = cat.models[0]!;
    expect(opus.label).toBe('Anthropic: Claude Opus 4.5');
    expect(opus.context).toBe(200000);
    expect(opus.maxContext).toBe(64000);
    expect(opus.priceIn).toBeCloseTo(0.000005, 12);
    expect(opus.priceOut).toBeCloseTo(0.000025, 12);
    // OpenRouter advertises no reasoning levels — an EMPTY list, which
    // `effortFile` reads as "unknown", never as "none offered".
    expect(opus.efforts).toEqual([]);
    expect(cat.models.every((m) => !m.hidden)).toBe(true);
  });

  it('a null max_completion_tokens is null, not zero', () => {
    run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    const cat = parseCatalogue(catalogueAt('router'));
    expect(cat.models.find((m) => m.id === 'qwen/qwen3.5-9b')!.maxContext).toBeNull();
  });

  it('a zero price is ZERO, not null — a free model is a fact, not a gap', () => {
    run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    const cat = parseCatalogue(catalogueAt('router'));
    expect(cat.models.find((m) => m.id === 'qwen/qwen3.5-9b')!.priceIn).toBe(0);
  });

  it('refuses a body with no data array', () => {
    const p = path.join(home, 'no-data.json');
    fs.writeFileSync(p, JSON.stringify({ models: [] }));
    expect(run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: p }).code).toBe(1);
  });
});

describe('the compatible arm (§5)', () => {
  it('needs a base URL', () => {
    const r = run(['lane', 'compatible']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--base-url/);
  });

  it('carries the ids and nothing else — a bare /v1/models says nothing more', () => {
    const r = run(['lane', 'compatible', '--base-url', 'https://api.cortecs.ai'],
      { CCRC_MODELS_PROBE_FIXTURE: COMPATIBLE_RAW });
    expect(r.code).toBe(0);
    const cat = parseCatalogue(catalogueAt('lane'));
    expect(cat.probe).toBe('compatible');
    expect(cat.models).toEqual([
      { id: 'glm-5.2', label: 'glm-5.2', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null },
      { id: 'qwen3.5-9b', label: 'qwen3.5-9b', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null },
    ]);
  });

  it('a 404 leaves "never probed" — no file, exit 1 (§5)', () => {
    const r = run(['lane', 'compatible', '--base-url', 'https://api.cortecs.ai'],
      { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'lane.json'))).toBe(false);
  });
});

describe('--endpoints: the ownership-whitelist question (§5, §8)', () => {
  it('writes the RAW endpoints body to --out and no catalogue at all', () => {
    const out = path.join(home, 'endpoints.json');
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', out],
      { CCRC_MODELS_PROBE_FIXTURE: ENDPOINTS_RAW });
    expect(r.code).toBe(0);
    const body = JSON.parse(fs.readFileSync(out, 'utf8')) as { data: { endpoints: unknown[] } };
    expect(body.data.endpoints).toHaveLength(2);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'router.json'))).toBe(false);
  });

  it('requires --out — the body is an ANSWER to one question, not a lane\'s catalogue', () => {
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2'],
      { CCRC_MODELS_PROBE_FIXTURE: ENDPOINTS_RAW });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--endpoints needs --out/);
  });

  it('is refused on any probe kind but openrouter', () => {
    const r = run(['gpt', 'codex', '--endpoints', 'gpt-5.6-sol', '--out', path.join(home, 'e.json')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--endpoints is an OpenRouter question/);
  });

  it('a failed fetch under --endpoints never marks any catalogue stale', () => {
    run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    const before = fs.readFileSync(path.join(home, '.ccrc', 'models', 'router.json'), 'utf8');
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', path.join(home, 'e.json')],
      { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    expect(r.code).toBe(1);
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'router.json'), 'utf8')).toBe(before);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd server && npx vitest run test/models-probe.test.ts`
Expected: FAIL — the OpenRouter and compatible cases fail at exit 1 ("no normaliser arm for probe kind 'openrouter' in this build"), and every `--endpoints` case fails at exit 2 ("unknown argument: --endpoints").

- [ ] **Step 4: Add the `--endpoints` flag to the argument loop**

In `ccd/ccrc-models-probe`, add to the declarations `ENDPOINTS=""`, add the arm to the `while` loop:

```bash
    --endpoints) [ $# -ge 2 ] || usage_die "--endpoints needs a model id"; ENDPOINTS="$2"; shift 2 ;;
```

and add the two gates immediately after the probe-kind `case`:

```bash
# `--endpoints` is a DIFFERENT QUESTION and gets a different answer shape: not
# "what does this lane advertise" but "which providers serve this one model",
# which is what the ownership whitelist is checked against at discovery-add
# (§5). It writes the provider's raw body and never a catalogue, so it must
# name its own destination and must never be able to touch a lane's file.
if [ -n "$ENDPOINTS" ]; then
  [ "$PROBE_KIND" = "openrouter" ] \
    || usage_die "--endpoints is an OpenRouter question: only its /models/{author}/{slug}/endpoints route answers which providers serve a model"
  [ -n "$OUT" ] \
    || usage_die "--endpoints needs --out: the body is the answer to one question, not this lane's catalogue, and writing it to ~/.ccrc/models/$ACCOUNT.json would destroy one"
fi
```

and update the usage line:

```bash
usage() {
  echo "usage: $PROG <accountId> <probe> [--base-url <url>] [--endpoints <modelId>] [--out <path>]" >&2
  echo "       <probe> is codex, openrouter or compatible — the registry file's own probe kind" >&2
}
```

- [ ] **Step 5: Add the compatible base-url gate**

Immediately after the probe-kind `case`, before the `--endpoints` block:

```bash
# `compatible` ships NO default endpoint — only the operator can know one, which
# is why the registry file carries `baseUrl` for it (round-2 ruling 10) — so an
# absent base URL is a refusal rather than a fall-through. `openrouter` has a
# default and takes none.
[ "$PROBE_KIND" != "compatible" ] || [ -n "$BASE_URL" ] \
  || usage_die "probe kind \"compatible\" needs --base-url: it ships no default endpoint, so only the lane's registry file can say where it talks to"
```

- [ ] **Step 6: Add the two fetch arms**

Replace `_fetch`'s `case` with:

```bash
  case "$PROBE_KIND" in
    codex) _fetch_codex ;;
    openrouter)
      # The LIST needs no credential (§5). `--fail` so a 4xx/5xx is a non-zero
      # exit rather than an error page written into $RAW as if it were a
      # catalogue; `-sS` so the transcript carries the reason and not a
      # progress bar.
      if [ -n "$ENDPOINTS" ]; then
        curl -sS --fail --max-time 30 \
          "https://openrouter.ai/api/v1/models/$ENDPOINTS/endpoints" > "$RAW"
      else
        curl -sS --fail --max-time 30 'https://openrouter.ai/api/v1/models' > "$RAW"
      fi
      ;;
    compatible)
      # The lane's own token, when the box has one. Best effort by design: a
      # 404 leaves "never probed" and the discovery list has to be explicit (§5).
      local auth=()
      [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ] || auth=(-H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN")
      curl -sS --fail --max-time 30 ${auth[@]+"${auth[@]}"} "${BASE_URL%/}/v1/models" > "$RAW"
      ;;
    *) echo "$PROG: probe kind \"$PROBE_KIND\" has no fetch arm in this build" >&2; return 1 ;;
  esac
```

- [ ] **Step 7: Short-circuit the endpoints mode past the normaliser**

Replace the tail of the file (from the `if ! _fetch …` line down) with:

```bash
mkdir -p "$(dirname "$OUT")" || die "could not create $(dirname "$OUT")"

if ! _fetch 2>"$TMPD/fetch.err"; then
  # `--endpoints` NEVER marks a catalogue stale: it did not ask about the
  # catalogue, and a whitelist question that could not be answered must not
  # change what the surfaces say about a lane's models.
  if [ -n "$ENDPOINTS" ]; then
    echo "$PROG: the OpenRouter endpoints call for \"$ENDPOINTS\" failed: $(tr '\n' ' ' < "$TMPD/fetch.err" | cut -c1-300)" >&2
    exit 1
  fi
  _mark_stale "the $PROBE_KIND catalogue fetch for \"$ACCOUNT\" failed: $(tr '\n' ' ' < "$TMPD/fetch.err" | cut -c1-300)"
  exit 1
fi

if [ -n "$ENDPOINTS" ]; then
  chmod 600 "$RAW" || die "could not set the mode on the endpoints answer"
  mv -f "$RAW" "$OUT" || die "could not move the endpoints answer into place at $OUT"
  exit 0
fi

if ! _normalise 2>"$TMPD/norm.err"; then
  _mark_stale "the $PROBE_KIND response for \"$ACCOUNT\" was refused: $(tr '\n' ' ' < "$TMPD/norm.err" | cut -c1-300)"
  exit 1
fi

chmod 600 "$NORM" || die "could not set the mode on the new catalogue"
mv -f "$NORM" "$OUT" || die "could not move the new catalogue into place at $OUT"
exit 0
```

- [ ] **Step 8: Add the two normaliser arms**

In the embedded python, above the `ARMS` table, add:

```python
def _price(v):
    # OpenRouter prices are decimal STRINGS ("0.000005", "0"). A zero price is
    # a fact — a free model — and must survive as 0 rather than becoming None,
    # which every surface renders as "price unknown".
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str) and v.strip():
        try:
            return float(v)
        except ValueError:
            return None
    return None

def openrouter_models(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
        fail("the OpenRouter catalogue has no `data` array — the endpoint's shape has drifted")
    out = []
    for i, m in enumerate(raw["data"]):
        if not isinstance(m, dict):
            fail("OpenRouter data[%d] is not an object" % i)
        mid = m.get("id")
        if not isinstance(mid, str) or not mid:
            fail("OpenRouter data[%d] has no id" % i)
        top = m.get("top_provider") if isinstance(m.get("top_provider"), dict) else {}
        pricing = m.get("pricing") if isinstance(m.get("pricing"), dict) else {}
        out.append({
            "id": mid, "label": m.get("name") or mid,
            "context": num(m.get("context_length")),
            "maxContext": num(top.get("max_completion_tokens")),
            # OpenRouter advertises no reasoning levels: EMPTY is "unknown",
            # which `effortFile` reads as "leave the operator's level alone".
            "efforts": [],
            "hidden": False,
            "priceIn": _price(pricing.get("prompt")),
            "priceOut": _price(pricing.get("completion")),
        })
    return out

def compatible_models(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
        fail("the /v1/models response has no `data` array")
    out = []
    for i, m in enumerate(raw["data"]):
        if not isinstance(m, dict):
            fail("/v1/models data[%d] is not an object" % i)
        mid = m.get("id")
        if not isinstance(mid, str) or not mid:
            fail("/v1/models data[%d] has no id" % i)
        # A bare /v1/models says the id and nothing more. Everything else is
        # null rather than guessed: a fabricated context window would be sized
        # against by Claude Code's auto-compaction, which is exactly the class
        # of lie the [1m] suffix incident was (infra/handoff/ccgpt:108-113).
        out.append({
            "id": mid, "label": mid, "context": None, "maxContext": None,
            "efforts": [], "hidden": False, "priceIn": None, "priceOut": None,
        })
    return out
```

and widen the table:

```python
ARMS = {
    "codex": codex_models,
    "openrouter": openrouter_models,
    "compatible": compatible_models,
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/models-probe.test.ts`
Expected: PASS, all describes.

- [ ] **Step 10: Measured mutation check — a zero price is not null**

In `_price`, change `if isinstance(v, str) and v.strip():` to `if isinstance(v, str) and v.strip() and float(v) != 0:`. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: one case red — `a zero price is ZERO, not null — a free model is a fact, not a gap`. Restore and re-run; expected PASS.

- [ ] **Step 11: Measured mutation check — `--endpoints` never touches a catalogue**

Delete the `if [ -n "$ENDPOINTS" ]; then … exit 1; fi` guard inside the fetch-failure branch. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: one case red — `a failed fetch under --endpoints never marks any catalogue stale`, because `router.json` now carries `"stale":true`. Restore and re-run; expected PASS.

- [ ] **Step 12: Measured mutation check — the compatible base-url gate**

Delete the `[ "$PROBE_KIND" != "compatible" ] || [ -n "$BASE_URL" ] || usage_die …` line. Run `cd server && npx vitest run test/models-probe.test.ts`.
Expected: one case red — `needs a base URL`. Restore and re-run; expected PASS.

- [ ] **Step 13: Commit**

```bash
git add ccd/ccrc-models-probe server/test/models-probe.test.ts \
        server/test/fixtures/catalogues/openrouter-raw-page.json \
        server/test/fixtures/catalogues/compatible-raw.json \
        server/test/fixtures/catalogues/openrouter-endpoints-raw.json
git commit -m "$(cat <<'MSG'
feat(models): the OpenRouter and compatible arms, and the endpoints question

OpenRouter carries prices — a zero price stays zero, because a free model is a
fact and every surface renders null as "unknown". A bare /v1/models says the id
and nothing more, so a `compatible` row is nulls rather than guesses: a
fabricated context window is exactly the class of lie the [1m] suffix was. That
arm reads its endpoint from --base-url, which the registry file's own `baseUrl`
supplies until exec.baseUrl exists on main.

`--endpoints` is a different question with a different answer shape. It writes
the raw body to a destination it is required to name, and a failure there never
marks a lane's catalogue stale — it did not ask about the catalogue.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: `deploy/models-op.mjs` — the verbs' node half, over the registry file

**Files:**
- Create: `deploy/models-op.mjs`
- Create: `server/test/models-op.test.ts`
- Test: `server/test/models-op.test.ts`

**Interfaces:**
- Consumes: `rosterFromJson`, `RosterInvalid` from `shared/roster-json.mjs` (already on `main`, READ ONLY — nothing here writes the roster); `parseRegistry`, `parseCatalogue`, `deriveModels`, `availableFor`, `RegistryInvalid`, `CatalogueInvalid`, `MODEL_ID_RE` from `shared/models.mjs` (Task 2); `modelEnvBlock`, `mergeSettingsEnv`, `clearSettingsEnv`, `MODEL_ENV_KEYS`, `effortFile`, `classesTsv`, `ModelEnvInvalid` from `shared/modelenv.mjs` (Task 3).
- Produces, as a CLI invoked `node deploy/models-op.mjs <op> [--key value]…`:

  | op | keys | answer |
  |---|---|---|
  | `lanes` | `--file` | `{ok, op, lanes: [{id, configDirSuffix, anthropic, hasRegistry, registryInvalid, catalogueInvalid, probe, baseUrl}]}` |
  | `show` | `--file --id` | `{ok, op, id, anthropic, registry, derived, catalogue, settingsDrift, orphan?}` |
  | `init` | `--file --id --probe [--base-url]` | the `show` answer, plus `created` |
  | `set-class` | `--file --id --class --model` | the `show` answer, plus `moved` |
  | `set-subagent` | `--file --id --class` | the `show` answer |
  | `set-effort` | `--file --id --class --level` | the `show` answer |
  | `discovery` | `--file --id --action [--model] [--endpoints]` | the `show` answer, plus `servedBy` |
  | `materialise` | `--file --id` | `{ok, op, id, wrote: {settings, classes, effort} \| null}` |
  | `rm` | `--file --id` | `{ok, op, id, removed: string[], settings: 'cleared'\|'unchanged'\|'orphan'}` |

  Exit 0 on an answer, 1 on a refusal with a body, 2 on bad argv. Every mutation re-materialises before it answers. Tasks 7–10 call it through `ccd/ccrc`. `rm` is a REAP, not a mutation (spec §4.1 Lifecycle, §10, §11): it deletes, in order, the registry, the catalogue, the TSV and the effort file — each `rm -f`, absent is fine — then `clearSettingsEnv`s the lane's settings when the roster has a row for `<id>`; an ORPHAN id (no roster row) skips that step and reports `settings: 'orphan'`. `rm` is idempotent (a second run answers `removed: []`) and runs before the `no-such-account` gate below, on files alone, never through the registry or catalogue validators — a file that does not even parse is still reaped. `show` on an orphan id (a registry file whose id the roster has no row for) answers rather than refusing: `orphan: true`, every class unavailable, no `settingsDrift` to report. Every op that answers `show`'s shape already loads the catalogue file once (to compute `derived` and `settingsDrift`); `materialise` — and every mutation, which re-materialises on success — passes that SAME parsed `Catalogue | null` into `modelEnvBlock` (Task 3) rather than reading `<id>.json` a second time, so the eighth key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (spec §6.1, amended 2026-09-08), is written when that catalogue is fresh and measures `ANTHROPIC_MODEL`'s resolved model, and `mergeSettingsEnv` prunes it off the lane's settings the moment a re-materialise's block stops carrying it.

- [ ] **Step 1: Write the failing test file**

Create `server/test/models-op.test.ts`:

```ts
// `deploy/models-op.mjs` — the node half of the `ccrc models` verb group (§10).
// It owns the REGISTRY FILE's read, the mutation, the re-validation, the atomic
// write and the re-materialisation, so the bash verb above it is a dispatcher
// and nothing else.
//
// IT NEVER WRITES THE ROSTER. Ruling 280: the registry is its own per-account
// file, `~/.ccrc/models/<id>.classes.json`, and `exec.models` belongs to the
// account-connections spec. The roster is read for three facts and nothing more
// — does this id exist, what is its configDirSuffix, and is it an Anthropic
// lane (`telemetry === 'anthropic'`, deviation B-3).
//
// EVERY CASE RUNS AGAINST A `mkTmp` HOME. This program writes ~/.ccrc/models
// and a lane's settings.json; the live ones on the box this suite runs on are
// the operator's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const OP = path.join(REPO, 'deploy', 'models-op.mjs');

let home: string;
const rosterPath = (): string => path.join(home, '.ccrc', 'accounts.json');

/** A roster with the three shapes this file has to tell apart: the upstream
 *  account, an Anthropic lane (`telemetry: 'anthropic'`), and the two
 *  non-Anthropic lanes the design exists for. `exec` carries no provider —
 *  `origin/main`'s ExecSpec has none. */
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
    { id: 'router', label: 'router', configDirSuffix: '.claude-router',
      exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ],
};

function seed(roster: unknown = ROSTER): void {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(rosterPath(), `${JSON.stringify(roster, null, 2)}\n`);
}

interface Result { code: number; body: Record<string, unknown>; stderr: string; stdout: string }
function op(...args: string[]): Result {
  const r = spawnSync(process.execPath, [OP, ...args],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const stdout = r.stdout ?? '';
  // THE CONTRACT: exactly one JSON object on stdout, newline-terminated. A
  // helper rather than a `JSON.parse` per call site, because a progress line
  // before the answer would still parse at a call site that took
  // `.split('\n')[0]`.
  const lines = stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return { code: r.status ?? -1, body: JSON.parse(lines[0]!), stderr: r.stderr ?? '', stdout };
}

const regPath = (id: string): string => path.join(home, '.ccrc', 'models', `${id}.classes.json`);
const registryOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(regPath(id), 'utf8'));
const classesOf = (id: string): Record<string, unknown> =>
  registryOf(id)['classes'] as Record<string, unknown>;
const settingsOf = (suffix: string): { env: Record<string, string> } =>
  JSON.parse(fs.readFileSync(path.join(home, suffix, 'settings.json'), 'utf8'));

const writeCatalogue = (id: string, cat: unknown = CODEX): void => {
  fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(cat));
};

beforeEach(() => { home = mkTmp('ccrc-models-op-'); seed(); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('argv', () => {
  it('an unknown op refuses at exit 2 with a body, never an empty stdout', () => {
    const r = op('frobnicate', '--file', rosterPath());
    expect(r.code).toBe(2);
    expect(r.body['ok']).toBe(false);
    expect(r.body['error']).toBe('bad-argv');
  });

  it('an unknown --key is a refusal, not a silently dropped flag', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'gpt', '--wat', 'x');
    expect(r.code).toBe(2);
    expect(r.body['error']).toBe('bad-argv');
  });

  it('a value that itself starts with -- is refused rather than shifting every pair', () => {
    const r = op('show', '--file', '--id', 'gpt');
    expect(r.code).toBe(2);
    expect(r.body['error']).toBe('bad-argv');
  });

  it('a missing required key is named', () => {
    const r = op('show', '--file', rosterPath());
    expect(r.code).toBe(2);
    expect(String(r.body['detail'])).toContain('--id');
  });
});

describe('the roster read', () => {
  it('an absent roster refuses with the install remedy', () => {
    fs.rmSync(rosterPath());
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('roster-absent');
  });

  it('an invalid roster carries the validator\'s own remedy VERBATIM', () => {
    seed({ version: 1, accounts: [{ id: 'x' }] });
    const r = op('show', '--file', rosterPath(), '--id', 'x');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('roster-invalid');
    expect(String(r.body['detail']).length).toBeGreaterThan(40);
  });

  it('an id the roster does not have refuses by name', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('no-such-account');
  });

  it('NOTHING here ever rewrites the roster', () => {
    // Ruling 280, as a mechanism: every mutation below runs, and the roster's
    // bytes are compared at the end. `exec.models` is the account-connections
    // spec's and does not exist on this branch.
    const before = fs.readFileSync(rosterPath(), 'utf8');
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-6-astra');
    op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus');
    op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--level', 'xhigh');
    op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'catalogue');
    expect(fs.readFileSync(rosterPath(), 'utf8')).toBe(before);
  });
});

describe('lanes', () => {
  it('lists every account that can carry a registry, and flags the anthropic ones', () => {
    const r = op('lanes', '--file', rosterPath());
    expect(r.code).toBe(0);
    expect(r.body['lanes']).toEqual([
      { id: 'gpt', configDirSuffix: '.claude-gpt', anthropic: false, hasRegistry: false, probe: null, baseUrl: null },
      { id: 'router', configDirSuffix: '.claude-router', anthropic: false, hasRegistry: false, probe: null, baseUrl: null },
    ]);
  });

  it('reports probe and baseUrl once a registry exists', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://api.cortecs.ai');
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    expect(lanes.find((l) => l['id'] === 'router')).toEqual({
      id: 'router', configDirSuffix: '.claude-router', anthropic: false,
      hasRegistry: true, probe: 'compatible', baseUrl: 'https://api.cortecs.ai',
    });
  });

  it('an upstream account is never a lane a registry can sit on', () => {
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as { id: string }[];
    expect(lanes.map((l) => l.id)).not.toContain('claude');
  });
});

describe('show', () => {
  it('a lane with no registry reads as every class unavailable (§13.1)', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['registry']).toBeNull();
    expect(r.body['anthropic']).toBe(false);
    expect(r.body['derived']).toEqual({ classified: [], unclassified: [], retired: [], available: [] });
    expect(r.body['catalogue']).toBeNull();
  });

  it('an anthropic lane answers registry:null and all four classes available', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'claude-a');
    expect(r.code).toBe(0);
    expect(r.body['registry']).toBeNull();
    expect(r.body['anthropic']).toBe(true);
    expect((r.body['derived'] as { available: string[] }).available)
      .toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });

  it('summarises the catalogue rather than shipping it', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.body['catalogue']).toEqual({ fetchedAt: CODEX.fetchedAt, stale: false, count: 9 });
    expect((r.body['derived'] as { unclassified: string[] }).unclassified)
      .toEqual(['gpt-6-astra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']);
  });

  it('a catalogue file that is not a catalogue refuses rather than reading as never-probed', () => {
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'models', 'gpt.json'), '{"probe":"gemini"}');
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('catalogue-invalid');
  });

  it('a registry file that is not a registry refuses, naming the field', () => {
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(regPath('gpt'), JSON.stringify({ probe: 'codex', classes: {} }));
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('registry-invalid');
    expect(r.body['field']).toBe('subagent');
  });

  it('names the settings keys that have drifted from the registry (§11)', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const p = path.join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'gpt-5.5';
    delete j.env.ANTHROPIC_SMALL_FAST_MODEL;
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['settingsDrift'])
      .toEqual(['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']);
  });

  it('reports NO drift right after a materialise, and none on a lane with no registry', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(op('show', '--file', rosterPath(), '--id', 'gpt').body['settingsDrift']).toEqual([]);
    expect(op('show', '--file', rosterPath(), '--id', 'router').body['settingsDrift']).toEqual([]);
  });

  it('an ORPHAN registry — no roster row for this id — answers orphan:true, no class available (§11)', () => {
    // §11: `ccrc account remove` deliberately never deletes under
    // ~/.ccrc/models/, so a registry can outlive the roster row it was
    // classified for. There is no account to route a session through, so
    // every class reads as unavailable regardless of what the registry itself
    // assigns, and there is no settings.json to compare it against.
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath('gpt'), 'utf8'));
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(0);
    expect(r.body['orphan']).toBe(true);
    expect((r.body['derived'] as { available: string[] }).available).toEqual([]);
    expect(r.body['settingsDrift']).toEqual([]);
  });
});

describe('init (§10, §13.1)', () => {
  it('seeds today\'s gpt registry for probe codex', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(registryOf('gpt')).toEqual({
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'sonnet',
      discovery: 'catalogue',
      effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },
    });
  });

  it('materialises on success: the env block, the three-column TSV and the effort file', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const s = settingsOf('.claude-gpt');
    expect(s.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(s.env.ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
    expect(s.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-terra');
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toBe('haiku\tgpt-5.6-luna\tassigned\nsonnet\tgpt-5.6-terra\tassigned\n'
        + 'opus\tgpt-5.6-sol\tassigned\nfable\t\tunassigned\n');
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' } });
  });

  it('is idempotent — a second init changes nothing and says so', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const before = fs.readFileSync(regPath('gpt'), 'utf8');
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(false);
    expect(fs.readFileSync(regPath('gpt'), 'utf8')).toBe(before);
  });

  it('refuses to CHANGE the probe kind of a registry that exists', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'openrouter');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('probe-declared');
    expect(registryOf('gpt')['probe']).toBe('codex');
  });

  it('writes an UNSEEDED registry for openrouter, and materialises nothing (deviation B-1)', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(registryOf('router')).toEqual({
      probe: 'openrouter',
      classes: { haiku: null, sonnet: null, opus: null, fable: null },
      subagent: 'sonnet',
      discovery: [],
    });
    expect(String(r.body['remedy'])).toMatch(/discovery add/);
    expect(fs.existsSync(path.join(home, '.claude-router', 'settings.json'))).toBe(false);
    // …and the TSV still exists, four lines, all unassigned: ccd reads it on
    // every spawn and an absent file is a different question from an empty lane.
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'router.classes.tsv'), 'utf8'))
      .toBe('haiku\t\tunassigned\nsonnet\t\tunassigned\nopus\t\tunassigned\nfable\t\tunassigned\n');
  });

  it('an unseeded compatible registry keeps the baseUrl it was given', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://api.cortecs.ai');
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai');
    expect(registryOf('router')['discovery']).toBe('catalogue');
  });

  it('refuses compatible with no --base-url, and writes nothing', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('baseUrl');
    expect(fs.existsSync(regPath('router'))).toBe(false);
  });

  it('refuses an anthropic lane by name', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'claude-a', '--probe', 'codex');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('anthropic-lane');
    expect(fs.existsSync(regPath('claude-a'))).toBe(false);
  });

  it('refuses an unknown probe kind', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'openai');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('probe');
  });
});

describe('set-class', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('assigns a class and re-materialises', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-6-astra');
    expect(r.code).toBe(0);
    expect(classesOf('gpt')['fable']).toBe('gpt-6-astra');
    expect(settingsOf('.claude-gpt').env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('gpt-6-astra');
  });

  it('`none` clears a class and puts the sentinel back', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'none');
    expect(r.code).toBe(0);
    expect(classesOf('gpt')['opus']).toBeNull();
    const env = settingsOf('.claude-gpt').env;
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('ccrc-unavailable-opus');
    // …and ANTHROPIC_MODEL falls to sonnet rather than going missing.
    expect(env.ANTHROPIC_MODEL).toBe('gpt-5.6-terra');
  });

  it('ASSIGNING A CLASS CLEARS IT FROM THE MODEL THAT HAD IT — one model, one class', () => {
    // §8's radio-across-the-row rule, enforced here rather than only in the UI:
    // the verb exists for scripts and for doctor's remedies, and a script that
    // left one model in two classes would produce a lane where `/model opus`
    // and `/model sonnet` are the same thing with nothing saying so.
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-5.6-terra');
    expect(r.code).toBe(0);
    expect(classesOf('gpt')['opus']).toBe('gpt-5.6-terra');
    expect(classesOf('gpt')['sonnet']).toBeNull();
    expect((r.body['moved'] as string[]).join(' ')).toContain('sonnet');
  });

  it('refuses a class that is not one of the four', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'subagent', '--model', 'gpt-5.5');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-class');
  });

  it('refuses a model the CATALOGUE does not list, naming it', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-9-nope');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('not-in-catalogue');
    expect(String(r.body['detail'])).toContain('gpt-9-nope');
  });

  it('accepts a model no catalogue can vouch for when there is NO catalogue at all', () => {
    fs.rmSync(path.join(home, '.ccrc', 'models', 'gpt.json'));
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-9-future');
    expect(r.code).toBe(0);
  });

  it('refuses an id that is not a model id', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', '/nope');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-model-id');
  });

  it('adds the model to an EXPLICIT discovery list rather than refusing the assignment', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'a/b');
    const r = op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'a/c');
    expect(r.code).toBe(0);
    expect(registryOf('router')['discovery']).toEqual(['a/b', 'a/c']);
  });

  it('refuses clearing the LAST class rather than writing a lane that routes nowhere (§11)', () => {
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'none');
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku', '--model', 'none');
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--model', 'none');
    expect(r.code).toBe(1);
    expect(String(r.body['detail'])).toMatch(/a lane needs at least one class/);
    // …and the registry is UNCHANGED: a refusal never half-writes.
    expect(classesOf('gpt')['sonnet']).toBe('gpt-5.6-terra');
  });

  it('refuses clearing the class the SUBAGENT points at, naming set-subagent', () => {
    // The seeded registry's subagent is `sonnet`. Clearing that slot would make
    // CLAUDE_CODE_SUBAGENT_MODEL a sentinel (§6.1) — refused at the validator
    // and again at the materialiser, with nothing written.
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--model', 'none');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('subagent');
    expect(String(r.body['detail'])).toMatch(/set-subagent/);
    expect(classesOf('gpt')['sonnet']).toBe('gpt-5.6-terra');
  });

  it('CLAUDE_CODE_MAX_CONTEXT_TOKENS tracks the default model\'s catalogue context, and drops out when it cannot (§6.1, amended 2026-09-08)', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-5.6-sol');
    expect(r.code).toBe(0);
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
    // Switching the default to a model no catalogue can vouch for — the same
    // "accepts a model no catalogue can vouch for" situation as above — leaves
    // nothing to measure a window from, and the STALE '272000' must not
    // survive the re-materialise: the eighth key carries no sentinel, so a
    // left-behind number would misstate the window rather than merely miss.
    fs.rmSync(path.join(home, '.ccrc', 'models', 'gpt.json'));
    const r2 = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-9-future');
    expect(r2.code).toBe(0);
    expect(classesOf('gpt')['opus']).toBe('gpt-9-future');
    expect(Object.keys(settingsOf('.claude-gpt').env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  });
});

describe('set-subagent (§10, ruling 5c)', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('moves CLAUDE_CODE_SUBAGENT_MODEL to the named class\'s model', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus');
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['subagent']).toBe('opus');
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-sol');
  });

  it('refuses a class whose slot is null, naming set-class as the remedy', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('subagent');
    expect(String(r.body['detail'])).toMatch(/set-class fable/);
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
  });

  it('refuses a word that is not a class', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'subagent');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-class');
  });
});

describe('set-effort', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('sets a level the catalogue offers, and it reaches the effort file', () => {
    const r = op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--level', 'xhigh');
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'xhigh', 'gpt-5.6-sol': 'max' } });
  });

  it('refuses a level the classed model does not offer, naming both', () => {
    // Luna has no `ultra`; Astra does (§4.1).
    const r = op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku', '--level', 'ultra');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('effort.haiku');
    expect(String(r.body['detail'])).toContain('gpt-5.6-luna');
    expect(String(r.body['detail'])).toContain('ultra');
  });

  it('`default` removes the entry', () => {
    op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--level', 'default');
    expect((registryOf('gpt')['effort'] as Record<string, unknown>)['opus']).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8'))
      .byModel['gpt-5.6-sol']).toBeUndefined();
  });

  it('refuses an effort on a class whose slot is null — there is no model to set it on', () => {
    const r = op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--level', 'max');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('class-unassigned');
  });
});

describe('discovery (§10) — the set discovery and classification operate on', () => {
  beforeEach(() => {
    writeCatalogue('router', { ...CODEX, probe: 'openrouter' });
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
  });

  it('add builds the explicit list an openrouter lane requires', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5');
    expect(r.code).toBe(0);
    expect(registryOf('router')['discovery']).toEqual(['gpt-5.5']);
  });

  it('add is idempotent and never duplicates', () => {
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5');
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5');
    expect(registryOf('router')['discovery']).toEqual(['gpt-5.5']);
  });

  it('rm removes, and refuses to remove one a class still routes to', () => {
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5');
    op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'gpt-5.5');
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'rm', '--model', 'gpt-5.5');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('discovery');
    expect(registryOf('router')['discovery']).toEqual(['gpt-5.5']);
  });

  it('catalogue is refused on an openrouter lane', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'catalogue');
    expect(r.code).toBe(1);
    expect(String(r.body['detail'])).toMatch(/openrouter requires an explicit discovery list/);
  });

  it('catalogue is accepted on a codex lane', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'add', '--model', 'gpt-5.5');
    const r = op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'catalogue');
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['discovery']).toBe('catalogue');
  });

  it('an unknown action is a usage error', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'purge');
    expect(r.code).toBe(2);
  });
});

describe('the ownership whitelist at discovery-add (§5, §11)', () => {
  const whitelist = (providers: string[]): void => {
    fs.mkdirSync(path.join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(path.join(home, '.handoff', 'providers-whitelist.json'),
      JSON.stringify({ providers }));
  };
  const endpoints = (names: string[]): string => {
    const p = path.join(home, 'endpoints.json');
    fs.writeFileSync(p, JSON.stringify({ data: { endpoints: names.map((n) => ({ provider_name: n })) } }));
    return p;
  };
  beforeEach(() => { op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter'); });

  it('admits a model a whitelisted provider serves, and reports which', () => {
    whitelist(['fireworks', 'together']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'z-ai/glm-5.2', '--endpoints', endpoints(['Fireworks', 'Z.AI']));
    expect(r.code).toBe(0);
    expect(r.body['servedBy']).toEqual(['fireworks']);
  });

  it('refuses when NO allowed provider serves it, naming the ones that do', () => {
    whitelist(['fireworks']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'z-ai/glm-5.2', '--endpoints', endpoints(['Z.AI', 'Cortecs']));
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('no-allowed-provider');
    expect(String(r.body['detail'])).toContain('Z.AI');
    expect(registryOf('router')['discovery']).toEqual([]);
  });

  it('refuses when the whitelist file is absent — the proxy would refuse every request anyway', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'z-ai/glm-5.2', '--endpoints', endpoints(['Fireworks']));
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('whitelist-absent');
  });

  it('normalises a provider name to the whitelist\'s slug form', () => {
    // The whitelist holds slugs (`google-ai-studio`); the endpoints body holds
    // display names (`Google AI Studio`). A check that compared them raw would
    // refuse every model on the list.
    whitelist(['google-ai-studio']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'x/y', '--endpoints', endpoints(['Google AI Studio']));
    expect(r.code).toBe(0);
    expect(r.body['servedBy']).toEqual(['google-ai-studio']);
  });
});

describe('the registry write', () => {
  it('is atomic — no temp file survives a success', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(fs.readdirSync(path.join(home, '.ccrc', 'models')).sort())
      .toEqual(['gpt.classes.json', 'gpt.classes.tsv', 'gpt.effort.json']);
  });

  it('keeps 2-space indent and a trailing newline', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const text = fs.readFileSync(regPath('gpt'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "classes": {');
  });

  it('is 0600 — a compatible lane\'s registry names its endpoint', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(fs.statSync(regPath('gpt')).mode & 0o777).toBe(0o600);
  });

  it('re-VALIDATES before writing: a mutation that would break the registry writes nothing', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const before = fs.readFileSync(regPath('gpt'), 'utf8');
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'has space');
    expect(r.code).toBe(1);
    expect(fs.readFileSync(regPath('gpt'), 'utf8')).toBe(before);
  });
});

describe('materialise', () => {
  it('rewrites the three generated files from the registry and the catalogue', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    fs.rmSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'));
    writeCatalogue('gpt');
    const r = op('materialise', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['wrote']).toEqual({
      settings: `${home}/.claude-gpt/settings.json`,
      classes: `${home}/.ccrc/models/gpt.classes.tsv`,
      effort: `${home}/.ccrc/models/gpt.effort.json`,
    });
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(true);
    // The catalogue this run just wrote (init ran before it existed, so init's
    // own materialise could not have) — proves `materialise` reads the SAME
    // freshly-parsed catalogue it used for `derived`, not a stale one (§6.1
    // amendment).
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
  });

  it('on a lane with NO registry writes nothing and says so', () => {
    const r = op('materialise', '--file', rosterPath(), '--id', 'router');
    expect(r.code).toBe(0);
    expect(r.body['wrote']).toBeNull();
    expect(fs.existsSync(path.join(home, '.claude-router', 'settings.json'))).toBe(false);
  });

  it('on an UNSEEDED registry writes the TSV and no env block', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('materialise', '--file', rosterPath(), '--id', 'router');
    expect(r.code).toBe(0);
    expect((r.body['wrote'] as Record<string, unknown>)['settings']).toBeNull();
    expect(fs.existsSync(path.join(home, '.claude-router', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'router.classes.tsv'))).toBe(true);
  });

  it('on an anthropic lane refuses — its classes are the client\'s own', () => {
    const r = op('materialise', '--file', rosterPath(), '--id', 'claude-a');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('anthropic-lane');
  });
});

describe('rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('removes all four generated files, in order, and clears exactly the eight env keys', () => {
    const p = path.join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.DISABLE_TELEMETRY = '1';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    // The beforeEach's `init` ran against a written catalogue, so the eighth
    // key is live before `rm` runs — this is the case that shows `rm` reaps
    // it too, not just the seven keys that predate the §6.1 amendment.
    expect(j.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
    const r = op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['removed']).toEqual([
      regPath('gpt'),
      path.join(home, '.ccrc', 'models', 'gpt.json'),
      path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'),
      path.join(home, '.ccrc', 'models', 'gpt.effort.json'),
    ]);
    expect(r.body['settings']).toBe('cleared');
    expect(fs.existsSync(regPath('gpt'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'))).toBe(false);
    const after = settingsOf('.claude-gpt');
    expect(after.env['DISABLE_TELEMETRY']).toBe('1');
    expect(Object.keys(after.env)).not.toContain('ANTHROPIC_MODEL');
    expect(Object.keys(after.env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  });

  it('is idempotent: a second call removes nothing and reports settings:unchanged', () => {
    op('rm', '--file', rosterPath(), '--id', 'gpt');
    const r = op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['removed']).toEqual([]);
    expect(r.body['settings']).toBe('unchanged');
  });

  it('on an id the roster has no row for — an ORPHAN — skips the settings step and says so', () => {
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath('gpt'), 'utf8'));
    const r = op('rm', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(0);
    expect(r.body['removed']).toEqual([regPath('ghost')]);
    expect(r.body['settings']).toBe('orphan');
    // …and the still-live gpt lane, whose id the roster DOES have, is untouched.
    expect(fs.existsSync(regPath('gpt'))).toBe(true);
  });

  it('reaps a registry that does not even parse — rm -f semantics, not a validated read', () => {
    fs.writeFileSync(regPath('gpt'), '{ this is not json');
    const r = op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(fs.existsSync(regPath('gpt'))).toBe(false);
  });

  it('never touches the roster', () => {
    const before = fs.readFileSync(rosterPath(), 'utf8');
    op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(fs.readFileSync(rosterPath(), 'utf8')).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run test/models-op.test.ts`
Expected: FAIL — `spawnSync` cannot find `deploy/models-op.mjs`, so `stdout` is empty and the one-object expectation reports `stdout carried 0 lines, not one`.

- [ ] **Step 3: Write `deploy/models-op.mjs`**

```js
#!/usr/bin/env node
// models-op — the node half of the `ccrc models` verb group (spec §10). It owns
// the REGISTRY FILE's read, the mutation, the RE-VALIDATION, the atomic write
// and the re-materialisation; `ccd/ccrc` above it is a dispatcher and nothing
// else.
//
// ── WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
// The roster. Ruling 280 (2026-09-08): the class registry is its own
// per-account file, `~/.ccrc/models/<id>.classes.json`, and `exec.models` is
// the account-connections spec's — a branch that is not on `main`. The roster
// is READ for exactly three facts and never written: does this id exist, what
// is its `configDirSuffix`, and is it an Anthropic lane
// (`telemetry === 'anthropic'` — `origin/main`'s `ExecSpec` has no provider
// field to ask, deviation B-3).
//
// ── THE THREE RULES EVERY OP OBEYS ───────────────────────────────────────
//  1. ONE JSON OBJECT ON STDOUT, always, including on a refusal. The caller
//     parses stdout; an exit code with an empty body is "the box said no" and
//     "this build cannot answer you" arriving as the same two bytes.
//  2. RE-VALIDATE BEFORE WRITING. Every mutation runs the MUTATED registry back
//     through `parseRegistry` before the rename and answers the validator's own
//     sentence, with its `field`. The one thing a verb must never do is leave a
//     file the server refuses to read.
//  3. MATERIALISE ON SUCCESS. `mergeSettingsEnv`, `<id>.classes.tsv` and
//     `<id>.effort.json` are rewritten after every accepted mutation, so no
//     surface can read a registry the lane's own settings do not match.
//
// `rm` (spec §4.1 Lifecycle, §10, §11) is a DELIBERATE exception to rules 2 and
// 3: it is a REAP, not a mutation, and re-validating or materialising a
// registry it is about to delete would be pointless — worse, it would refuse to
// reap a registry that no longer parses, which is exactly the file this verb
// exists to clean up. It still obeys rule 1.
//
// It borrows two idioms `main` already uses for a node helper `ccrc` shells out
// to, and cites them: `deploy/gen-accounts.mjs`'s "the remedy reaches stderr
// verbatim" contract (`ccd/ccrc:3955-3962` reads it that way), and
// `ccd/ccrc-adopt:97-105`'s argument loop, where an unknown flag is exit 2.
//
// Bare `node` — no build step, no `tsx`, no compiled `dist/` — which is why
// every import below is a `.mjs`.

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';
import {
  CatalogueInvalid, MODEL_ID_RE, RegistryInvalid, availableFor, deriveModels,
  parseCatalogue, parseRegistry,
} from '../shared/models.mjs';
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
} from '../shared/modelenv.mjs';

const SELF = 'models-op';
const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'];
const PROBE_KINDS = ['codex', 'openrouter', 'compatible'];

/** What `init` plants per probe kind.
 *
 *  `codex`'s is TODAY'S gpt mapping (§13.1) — luna/terra/sol with `fable: null`
 *  and `subagent: 'sonnet'` — so behaviour is unchanged until the operator
 *  classifies Astra. The other two seed an UNSEEDED registry (deviation B-1):
 *  four null classes, a `discovery` scope the probe kind allows, and nothing
 *  routable — only the operator can know which of several hundred OpenRouter
 *  models belongs in which class. Such a registry is legal, materialises to a
 *  TSV and no env block, and reads as "every class unavailable". */
const SEEDS = {
  codex: {
    probe: 'codex',
    classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
    subagent: 'sonnet',
    discovery: 'catalogue',
    effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },
  },
  openrouter: {
    probe: 'openrouter',
    classes: { haiku: null, sonnet: null, opus: null, fable: null },
    subagent: 'sonnet',
    discovery: [],
  },
  compatible: {
    probe: 'compatible',
    classes: { haiku: null, sonnet: null, opus: null, fable: null },
    subagent: 'sonnet',
    discovery: 'catalogue',
  },
};

const HOME = process.env['HOME'] ?? '';
const modelsDir = () => path.join(HOME, '.ccrc', 'models');
const cataloguePath = (id) => path.join(modelsDir(), `${id}.json`);
const registryPath = (id) => path.join(modelsDir(), `${id}.classes.json`);
// `rm` names these two directly — `materialise` builds the same two paths off
// an `account`, which an ORPHAN id has none of.
const classesTsvPath = (id) => path.join(modelsDir(), `${id}.classes.tsv`);
const effortPath = (id) => path.join(modelsDir(), `${id}.effort.json`);

function out(o) { process.stdout.write(`${JSON.stringify(o)}\n`); }

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The envelope: machine-readable on stdout, the human sentence on stderr, one
 *  shape on every path. It RETURNS the exit class, so each op's
 *  `return refuse(1, …)` is the whole control flow. `field` is carried when
 *  there is one — the verbs' contract is "refuses, with the field named", and
 *  Plan 3a's PATCH route points a UI control at it. */
function refuse(code, error, detail, field) {
  out({ ok: false, error, detail, ...(field === undefined ? {} : { field }) });
  process.stderr.write(`${SELF}: ${detail} (${error})\n`);
  return code;
}

/** A `RegistryInvalid` turned into a refusal, with the ONE verb-level remedy
 *  the validator cannot know: which subcommand fixes this field. */
const FIELD_REMEDY = {
  subagent: "Run 'ccrc models <id> set-subagent <class>' to point it at a class that has a model.",
  discovery: "Run 'ccrc models <id> discovery add <modelId>' or 'discovery catalogue'.",
};
function refuseRegistry(e, id) {
  const extra = FIELD_REMEDY[e.field] ?? '';
  const remedy = extra === '' ? '' : ` ${extra.replace('<id>', id)}`;
  return refuse(1, 'registry-invalid', `${e.message}${remedy}`, e.field);
}

/** THE ONE ROSTER READ, and it is READ-ONLY. Absent and unreadable are two
 *  codes: the remedies differ. */
function readRoster(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { err: ['roster-absent',
        `${file} does not exist, so this box has no account roster yet. Run 'ccrc install' — it `
        + 'seeds one and never overwrites an existing one.'] };
    }
    return { err: ['roster-unreadable',
      `${file} exists and could not be read: ${e.message}. Regenerating it will not help; fix its `
      + 'permissions.'] };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { err: ['roster-invalid', `${file} is not valid JSON: ${e.message}`] };
  }
  try {
    rosterFromJson(json);
  } catch (e) {
    const remedy = e instanceof RosterInvalid && typeof e.remedy === 'string' ? ` ${e.remedy}` : '';
    return { err: ['roster-invalid', `${file}: ${e.message}${remedy}`] };
  }
  return { json };
}

function findAccount(json, id) {
  const accounts = Array.isArray(json.accounts) ? json.accounts : [];
  return accounts.find((a) => isObj(a) && a.id === id) ?? null;
}

/** Deviation B-3: `origin/main`'s roster has no `exec.provider`, and
 *  `telemetry: 'anthropic'` is its own declaration that an account is an
 *  Anthropic subscription lane — the field `limits.ts` scores on. `gpt` carries
 *  `telemetry: 'none'`. This is the one place the boolean is computed here. */
const isAnthropicLane = (account) => account.telemetry === 'anthropic';

/** A lane a registry can sit on at all: not upstream (that entry names the
 *  Claude Code binary and ccrc never writes its launcher) and not Anthropic. */
const canCarryRegistry = (account) =>
  isObj(account.exec) && account.exec.kind !== 'upstream' && !isAnthropicLane(account);

/** The lane's catalogue, or null when it has never been probed. A file that
 *  EXISTS and is not a catalogue is a refusal, never "never probed": the two
 *  are different states and folding them would hide a broken probe behind an
 *  empty screen. */
function readCatalogue(id) {
  let raw;
  try {
    raw = readFileSync(cataloguePath(id), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { catalogue: null };
    return { err: ['catalogue-unreadable', `${cataloguePath(id)} could not be read: ${e.message}.`] };
  }
  try {
    return { catalogue: parseCatalogue(JSON.parse(raw)) };
  } catch (e) {
    const why = e instanceof CatalogueInvalid ? e.message : `${e.message}`;
    return { err: ['catalogue-invalid',
      `${cataloguePath(id)} is not a catalogue this build understands: ${why}. Re-run `
      + `'ccrc models refresh ${id}'.`] };
  }
}

/** The lane's registry, or null when it has none. Same asymmetry as the
 *  catalogue: absent is a STATE (§13.1's "every class unavailable"), and a file
 *  that exists and does not parse is a refusal that names its field. */
function readRegistry(id, catalogue) {
  let raw;
  try {
    raw = readFileSync(registryPath(id), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { registry: null };
    return { err: ['registry-unreadable', `${registryPath(id)} could not be read: ${e.message}.`] };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { err: ['registry-invalid', `${registryPath(id)} is not valid JSON: ${e.message}`] };
  }
  try {
    return { registry: parseRegistry(json, catalogue) };
  } catch (e) {
    if (e instanceof RegistryInvalid) return { invalid: e };
    throw e;
  }
}

/** tmp + rename, 0600, this repo's rule for any file another process reads —
 *  the server's fleet poll and Plan 3a's routes read this one, and a
 *  `compatible` lane's registry names its endpoint. 2-space indent and a
 *  trailing newline, the shape every hand-editable ccrc file has. */
function writeRegistry(id, registry) {
  const p = registryPath(id);
  const tmp = `${p}.ccrc.tmp`;
  try {
    mkdirSync(modelsDir(), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return null;
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    return ['registry-unwritable', `${p} could not be written: ${e.message}. Nothing was changed.`];
  }
}

/** §6.1 + §6.4 + §7's TSV, from a lane's registry and its catalogue. Returns
 *  the three paths, `settings` NULL when the registry is unseeded — such a lane
 *  has no env block to write ("a lane needs at least one class") but still gets
 *  its TSV, because ccd reads that file on every spawn and an ABSENT file is a
 *  different question from a lane with nothing assigned. `wrote` is null only
 *  when there is no registry at all. */
function materialise(account, registry, catalogue) {
  if (registry === null) return { wrote: null };
  const settings = path.join(HOME, account.configDirSuffix, 'settings.json');
  const classes = path.join(modelsDir(), `${account.id}.classes.tsv`);
  const effort = path.join(modelsDir(), `${account.id}.effort.json`);
  let block = null;
  try {
    // `catalogue` is the SAME parsed value the caller already loaded to
    // compute `derived`/`settingsDrift` (spec §6.1 amendment) — never a
    // second read of `<id>.json`, so a materialise never disagrees with the
    // `show` answer it is bundled with about whether the catalogue is stale.
    block = modelEnvBlock(registry, catalogue);
  } catch (e) {
    if (!(e instanceof ModelEnvInvalid)) throw e;
    // An UNSEEDED lane routes nowhere and gets no env block. A lane that is
    // seeded but unroutable is refused by the MUTATION path before it ever
    // reaches here, so this branch only ever means "nothing assigned yet".
    if (CLASSES.some((c) => registry.classes[c] !== null)) {
      return { err: ['unroutable-lane', e.message] };
    }
  }
  try {
    mkdirSync(modelsDir(), { recursive: true });
    if (block !== null) {
      mkdirSync(path.dirname(settings), { recursive: true });
      mergeSettingsEnv(settings, block);
    }
    // Both generated files land tmp + rename: ccd reads the TSV on every spawn
    // (Plan 2) and `ccgpt-proxy` re-reads the effort file whenever its mtime
    // moves, so a half-written one is a live wrong answer rather than a
    // transient.
    for (const [p, text] of [[classes, classesTsv(registry, catalogue)],
      [effort, `${JSON.stringify(effortFile(registry, catalogue))}\n`]]) {
      const tmp = `${p}.ccrc.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, p);
    }
  } catch (e) {
    if (e instanceof ModelEnvInvalid) return { err: ['settings-unwritable', e.message] };
    return { err: ['materialise-failed', `${e.message}`] };
  }
  return { wrote: { settings: block === null ? null : settings, classes, effort } };
}

/** §11's last bullet: which of the materialiser's (up to) eight keys the
 *  lane's own settings.json no longer agrees with. A MISSING key counts as
 *  drifted — for the first seven, an unset alias falls through to Anthropic's
 *  own id and the backend 404s opaquely, which is the exact failure the
 *  sentinel exists to prevent, so "absent" and "wrong" are the same finding
 *  here. The eighth key is the one where "absent from `want`" is the CORRECT
 *  answer whenever the catalogue cannot measure it (§6.1 amendment) — `want`
 *  simply does not carry the key then, so the `Object.keys(want)` filter below
 *  never asks about it, and a settings file that also lacks it drifts on
 *  nothing.
 *
 *  Returned in `modelEnvBlock`'s own key order rather than sorted, so two boxes
 *  reporting the same drift print the same list. Read-only: `show` NAMES the
 *  drift and never repairs it, because a read verb that silently rewrote a
 *  hand-edited settings file would destroy the edit before its author saw the
 *  report. Every mutation re-materialises, so the remedy is any of them.
 *
 *  Takes the SAME `catalogue` the caller already parsed for `derived` — never
 *  a second read — because `modelEnvBlock` needs it to know whether the
 *  eighth key belongs in `want` at all. */
function settingsDrift(account, registry, catalogue) {
  if (registry === null) return [];
  let want;
  try {
    want = modelEnvBlock(registry, catalogue);
  } catch {
    // An unseeded (or unroutable) lane has no expected block to compare against.
    return [];
  }
  let env = {};
  try {
    const j = JSON.parse(readFileSync(path.join(HOME, account.configDirSuffix, 'settings.json'), 'utf8'));
    if (isObj(j) && isObj(j.env)) env = j.env;
  } catch {
    // An absent settings file means every key is missing, which the filter
    // below reports one by one — a more useful answer than a single "no file".
    env = {};
  }
  return Object.keys(want).filter((k) => env[k] !== want[k]);
}

/** The `show` answer, which every mutation also returns so a caller sees the
 *  state it produced without a second call. */
function describe(account, registry, catalogue) {
  const anthropic = isAnthropicLane(account);
  const derived = deriveModels(registry, catalogue);
  return {
    id: account.id,
    anthropic,
    registry,
    derived: { ...derived, available: availableFor(registry, catalogue, anthropic) },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    settingsDrift: settingsDrift(account, registry, catalogue),
  };
}

/** §11's ORPHAN: a registry file whose id is in no roster row — typically
 *  after `ccrc account remove`, which deliberately never deletes under
 *  ~/.ccrc/models/ and names `ccrc models <id> rm` as the remedy. There is no
 *  ACCOUNT here to read a `configDirSuffix` or a `telemetry` field from, so
 *  every class reads as UNAVAILABLE regardless of what the registry itself
 *  assigns — nothing routes a session to this id — and `settingsDrift` is
 *  meaningless with no settings.json to compare the registry against. */
function orphanDescribe(id, registry, catalogue) {
  const derived = deriveModels(registry, catalogue);
  return {
    id,
    orphan: true,
    anthropic: false,
    registry,
    derived: { ...derived, available: [] },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    settingsDrift: [],
  };
}

/** `--endpoints` + the ownership whitelist (§5). The whitelist holds SLUGS
 *  (`google-ai-studio`); an endpoints body holds DISPLAY NAMES
 *  (`Google AI Studio`), so the two are compared through one normalisation and
 *  not raw — raw, the check would refuse every model on the list. */
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function whitelistCheck(endpointsFile) {
  const wl = path.join(HOME, '.handoff', 'providers-whitelist.json');
  let allowed;
  try {
    const parsed = JSON.parse(readFileSync(wl, 'utf8'));
    allowed = new Set((Array.isArray(parsed.providers) ? parsed.providers : []).map(slugify));
  } catch (e) {
    return { err: ['whitelist-absent',
      `${wl} could not be read (${e.message}), so this box cannot say which providers are allowed `
      + 'to serve a model — and handoff-proxy injects that list as provider.only on every request, '
      + 'so the lane would refuse anyway. Nothing was written.'] };
  }
  let names;
  try {
    const body = JSON.parse(readFileSync(endpointsFile, 'utf8'));
    const eps = body?.data?.endpoints;
    if (!Array.isArray(eps)) throw new Error('no data.endpoints array');
    names = eps.map((e) => (isObj(e) ? e.provider_name ?? e.name : null)).filter((n) => typeof n === 'string');
  } catch (e) {
    return { err: ['endpoints-invalid',
      `${endpointsFile} is not an OpenRouter endpoints answer: ${e.message}. Nothing was written.`] };
  }
  const servedBy = [...new Set(names.map(slugify))].filter((s) => allowed.has(s));
  if (servedBy.length === 0) {
    return { err: ['no-allowed-provider',
      `no ownership-whitelisted provider serves this model. It is served by: ${names.join(', ')}. `
      + `Add one of those to ${wl} if it belongs there, or pick a different model.`] };
  }
  return { servedBy };
}

/** DATA: one row per op naming the keys it takes and which of them are
 *  required. */
const OPS = {
  lanes: { keys: ['file'], required: ['file'] },
  show: { keys: ['file', 'id'], required: ['file', 'id'] },
  init: { keys: ['file', 'id', 'probe', 'base-url'], required: ['file', 'id', 'probe'] },
  'set-class': { keys: ['file', 'id', 'class', 'model'], required: ['file', 'id', 'class', 'model'] },
  'set-subagent': { keys: ['file', 'id', 'class'], required: ['file', 'id', 'class'] },
  'set-effort': { keys: ['file', 'id', 'class', 'level'], required: ['file', 'id', 'class', 'level'] },
  discovery: { keys: ['file', 'id', 'action', 'model', 'endpoints'], required: ['file', 'id', 'action'] },
  materialise: { keys: ['file', 'id'], required: ['file', 'id'] },
  rm: { keys: ['file', 'id'], required: ['file', 'id'] },
};

/** `--key value` pairs, refused rather than ignored, with a strict `i += 2`
 *  walk: a value that itself starts with `--` is refused, because accepting it
 *  would consume the NEXT token as a key and shift every following pair by one
 *  slot silently instead of failing loudly. */
function readPairs(argv, spec) {
  const got = {};
  for (let i = 3; i < argv.length; i += 2) {
    const k = argv[i];
    if (typeof k !== 'string' || !k.startsWith('--')) {
      return { err: `${JSON.stringify(k ?? '')} is not a --key` };
    }
    const name = k.slice(2);
    if (!spec.keys.includes(name)) return { err: `unknown key --${name}` };
    const v = argv[i + 1];
    if (typeof v !== 'string') return { err: `--${name} needs a value` };
    if (v.startsWith('--')) return { err: `--${name}'s value must not start with "--" (got ${v})` };
    got[name] = v;
  }
  for (const need of spec.required) {
    if (got[need] === undefined) return { err: `--${need} is required` };
  }
  return { got };
}

function main(argv) {
  const opName = argv[2];
  const spec = OPS[opName];
  if (spec === undefined) {
    return refuse(2, 'bad-argv',
      `unknown op ${JSON.stringify(opName ?? '')}. This build has: ${Object.keys(OPS).join(', ')}.`);
  }
  const pairs = readPairs(argv, spec);
  if (pairs.err !== undefined) return refuse(2, 'bad-argv', pairs.err);
  const a = pairs.got;

  const r = readRoster(a.file);
  if (r.err !== undefined) return refuse(1, r.err[0], r.err[1]);
  const json = r.json;

  if (opName === 'lanes') {
    const lanes = [];
    for (const acc of (json.accounts ?? [])) {
      if (!isObj(acc) || !canCarryRegistry(acc)) continue;
      const cat = readCatalogue(acc.id);
      const reg = cat.err !== undefined ? { registry: null } : readRegistry(acc.id, cat.catalogue);
      const registry = reg.registry ?? null;
      lanes.push({
        id: acc.id, configDirSuffix: acc.configDirSuffix, anthropic: false,
        hasRegistry: registry !== null || reg.invalid !== undefined,
        probe: registry === null ? null : registry.probe,
        baseUrl: registry === null || registry.baseUrl === undefined ? null : registry.baseUrl,
      });
    }
    out({ ok: true, op: 'lanes', lanes });
    return 0;
  }

  const account = findAccount(json, a.id);

  if (opName === 'rm') {
    // REAP, not a mutation (spec §4.1 Lifecycle, §10, §11): deletes the four
    // generated files this design owns and clears exactly the eight settings
    // keys `modelEnvBlock` can write — nothing else in that file. It runs BEFORE
    // the no-such-account and anthropic-lane gates below, and never routes the
    // registry or catalogue through their validators: `rm -f` semantics apply
    // to each of the four files on its own, so a broken (unparseable)
    // registry or catalogue is still reaped rather than blocking the one verb
    // that exists to clean it up. `ccrc account remove` deliberately never
    // deletes under ~/.ccrc/models/ and names this verb as the remedy, so an
    // ORPHAN — no roster row for this id — is the expected case, not an
    // error: there is no configDirSuffix to find a settings.json through, so
    // the settings step is skipped, and the answer says so.
    const removed = [];
    for (const p of [registryPath(a.id), cataloguePath(a.id), classesTsvPath(a.id), effortPath(a.id)]) {
      try {
        unlinkSync(p);
        removed.push(p);
      } catch (e) {
        if (e.code !== 'ENOENT') return refuse(1, 'unwritable', `${p} could not be removed: ${e.message}.`);
      }
    }
    let settings = 'orphan';
    if (account !== null) {
      const settingsPath = path.join(HOME, account.configDirSuffix, 'settings.json');
      try {
        settings = clearSettingsEnv(settingsPath, MODEL_ENV_KEYS).changed ? 'cleared' : 'unchanged';
      } catch (e) {
        if (e instanceof ModelEnvInvalid) return refuse(1, 'settings-unwritable', e.message);
        throw e;
      }
    }
    out({ ok: true, op: 'rm', id: a.id, removed, settings });
    return 0;
  }

  if (account === null) {
    if (opName === 'show') {
      // §11's ORPHAN: a registry file exists for an id the roster has no row
      // for. Not an error — `ccrc account remove` leaves it there on purpose —
      // so `show` answers rather than refusing, with every class read as
      // unavailable: there is no account to route a session through, whatever
      // the registry itself assigns.
      const cat0 = readCatalogue(a.id);
      if (cat0.err !== undefined) return refuse(1, cat0.err[0], cat0.err[1]);
      const reg0 = readRegistry(a.id, cat0.catalogue);
      if (reg0.err !== undefined) return refuse(1, reg0.err[0], reg0.err[1]);
      if (reg0.invalid !== undefined) return refuseRegistry(reg0.invalid, a.id);
      if (reg0.registry !== null) {
        out({ ok: true, op: 'show', ...orphanDescribe(a.id, reg0.registry, cat0.catalogue) });
        return 0;
      }
    }
    return refuse(1, 'no-such-account',
      `${a.file} has no account "${a.id}". Its ids are: `
      + `${(json.accounts ?? []).map((x) => x.id).join(', ')}.`);
  }
  if (isAnthropicLane(account)) {
    // Every op but `show` is refused on such a lane. `show` answers, because
    // "this lane has all four classes and they are the client's own" is a
    // useful answer and the one every surface renders (§4.1, decision 4).
    if (opName !== 'show') {
      return refuse(1, 'anthropic-lane',
        `account "${a.id}" is an Anthropic lane (telemetry: anthropic): its four classes are Claude `
        + 'Code\'s own defaults, shown read-only, and it carries no class registry. Nothing was '
        + 'written.');
    }
  }

  const cat = readCatalogue(a.id);
  if (cat.err !== undefined) return refuse(1, cat.err[0], cat.err[1]);
  const catalogue = cat.catalogue;

  const reg = readRegistry(a.id, catalogue);
  if (reg.err !== undefined) return refuse(1, reg.err[0], reg.err[1]);
  if (reg.invalid !== undefined) return refuseRegistry(reg.invalid, a.id);
  let registry = reg.registry;

  if (opName === 'show') {
    out({ ok: true, op: 'show', ...describe(account, registry, catalogue) });
    return 0;
  }

  if (opName === 'materialise') {
    const mat = materialise(account, registry, catalogue);
    if (mat.err !== undefined) return refuse(1, mat.err[0], mat.err[1]);
    out({ ok: true, op: 'materialise', id: a.id, wrote: mat.wrote });
    return 0;
  }

  let extra = {};

  if (opName === 'init') {
    if (!PROBE_KINDS.includes(a.probe)) {
      return refuse(1, 'unknown-probe',
        `"${a.probe}" is not a probe kind: it must be one of ${PROBE_KINDS.join(', ')}. The Codex `
        + 'probe is spelled "codex".', 'probe');
    }
    if (registry !== null) {
      if (registry.probe !== a.probe) {
        return refuse(1, 'probe-declared',
          `account "${a.id}" already has a class registry whose probe is "${registry.probe}", and `
          + `this run was asked for "${a.probe}". Changing a lane's probe kind is not an init — `
          + `remove ${registryPath(a.id)} deliberately if that is what you mean.`, 'probe');
      }
      out({ ok: true, op: 'init', created: false, ...describe(account, registry, catalogue) });
      return 0;
    }
    const seed = JSON.parse(JSON.stringify(SEEDS[a.probe]));
    if (a['base-url'] !== undefined) seed.baseUrl = a['base-url'];
    try {
      registry = parseRegistry(seed, catalogue);
    } catch (e) {
      if (e instanceof RegistryInvalid) return refuseRegistry(e, a.id);
      throw e;
    }
    const w = writeRegistry(a.id, registry);
    if (w !== null) return refuse(1, w[0], w[1]);
    const mat = materialise(account, registry, catalogue);
    if (mat.err !== undefined) return refuse(1, mat.err[0], mat.err[1]);
    const answer = { ok: true, op: 'init', created: true, ...describe(account, registry, catalogue) };
    if (CLASSES.every((c) => registry.classes[c] === null)) {
      answer.remedy = `probe "${a.probe}" ships no seed mapping — only you can say which of its `
        + `models belongs in which class. Build the lane with 'ccrc models ${a.id} discovery add `
        + `<modelId>' and 'ccrc models ${a.id} set-class <class> <modelId>'.`;
    }
    out(answer);
    return 0;
  }

  // Every remaining op MUTATES an existing registry.
  if (registry === null) {
    return refuse(1, 'no-registry',
      `account "${a.id}" has no class registry yet. Run 'ccrc models ${a.id} init `
      + `<${PROBE_KINDS.join('|')}>' first — it creates ${registryPath(a.id)}.`);
  }
  const next = JSON.parse(JSON.stringify(registry));

  if (opName === 'set-class') {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class',
        `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}. "subagent" is not one of `
        + `them — run 'ccrc models ${a.id} set-subagent <class>' to choose which class subagents `
        + 'run as.');
    }
    if (a.model === 'none') {
      next.classes[a.class] = null;
    } else {
      if (!MODEL_ID_RE.test(a.model)) {
        return refuse(1, 'bad-model-id',
          `"${a.model}" is not a model id: a letter or digit followed by up to 127 of letters, `
          + 'digits, ".", "_", ":", "/" and "-".');
      }
      if (catalogue !== null && !catalogue.models.some((m) => m.id === a.model)) {
        // Only when a catalogue EXISTS. With none, the operator is the only
        // source of truth about what this lane serves, and refusing would make
        // a never-probed lane unconfigurable.
        return refuse(1, 'not-in-catalogue',
          `"${a.model}" is not in account "${a.id}"'s catalogue. Run 'ccrc models refresh ${a.id}' `
          + 'if it is new, or check the spelling.');
      }
      // ONE MODEL, ONE CLASS — §8's radio-across-the-row rule, enforced in the
      // verb because the verb exists for scripts and for doctor's remedies.
      const moved = [];
      for (const c of CLASSES) {
        if (c !== a.class && next.classes[c] === a.model) { next.classes[c] = null; moved.push(c); }
      }
      next.classes[a.class] = a.model;
      // An explicit discovery list has to offer what a class routes to, and the
      // operator asked for this model by name — so the list GAINS it rather
      // than the assignment being refused for a reason the caller cannot act on.
      if (Array.isArray(next.discovery) && !next.discovery.includes(a.model)) {
        next.discovery = [...next.discovery, a.model];
      }
      extra = { moved };
    }
  } else if (opName === 'set-subagent') {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class',
        `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}.`);
    }
    if (next.classes[a.class] === null) {
      // Refused HERE, with the remedy that names the class the caller asked
      // for — the validator's own sentence cannot know which class was meant.
      return refuse(1, 'class-unassigned',
        `account "${a.id}" routes ${a.class} to nothing, so subagents cannot run as it: `
        + 'CLAUDE_CODE_SUBAGENT_MODEL would be a sentinel and every subagent on this lane would '
        + `fail. Run 'ccrc models ${a.id} set-class ${a.class} <modelId>' first.`, 'subagent');
    }
    next.subagent = a.class;
  } else if (opName === 'set-effort') {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class',
        `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}.`);
    }
    if (a.level === 'default') {
      if (isObj(next.effort)) delete next.effort[a.class];
      if (isObj(next.effort) && Object.keys(next.effort).length === 0) delete next.effort;
    } else {
      if (next.classes[a.class] === null) {
        return refuse(1, 'class-unassigned',
          `account "${a.id}" routes ${a.class} to nothing, so there is no model to set an effort `
          + `on. Run 'ccrc models ${a.id} set-class ${a.class} <modelId>' first.`);
      }
      next.effort = { ...(isObj(next.effort) ? next.effort : {}), [a.class]: a.level };
    }
  } else if (opName === 'discovery') {
    if (a.action === 'catalogue') {
      next.discovery = 'catalogue';
    } else if (a.action === 'add' || a.action === 'rm') {
      if (a.model === undefined) {
        return refuse(2, 'bad-argv', `discovery ${a.action} needs --model`);
      }
      if (!MODEL_ID_RE.test(a.model)) {
        return refuse(1, 'bad-model-id', `"${a.model}" is not a model id.`);
      }
      const current = Array.isArray(next.discovery) ? [...next.discovery] : [];
      if (a.action === 'add') {
        if (a.endpoints !== undefined) {
          const w = whitelistCheck(a.endpoints);
          if (w.err !== undefined) return refuse(1, w.err[0], w.err[1]);
          extra = { servedBy: w.servedBy };
        }
        next.discovery = current.includes(a.model) ? current : [...current, a.model];
      } else {
        next.discovery = current.filter((m) => m !== a.model);
      }
    } else {
      return refuse(2, 'bad-argv',
        `discovery takes add, rm or catalogue, and got ${JSON.stringify(a.action)}`);
    }
  }

  // RULE 2. The MUTATED registry goes back through the validator — with the
  // catalogue, so an effort level the lane cannot serve is refused here too —
  // and then through the env-block derivation, so a mutation that leaves the
  // lane routing nowhere (§11's "all four slots null") is refused with nothing
  // on disk changed.
  let validated;
  try {
    validated = parseRegistry(next, catalogue);
  } catch (e) {
    if (e instanceof RegistryInvalid) return refuseRegistry(e, a.id);
    throw e;
  }
  if (CLASSES.some((c) => validated.classes[c] !== null)) {
    try {
      // The eighth key can never throw (it is written or omitted, never
      // refused), so `catalogue` only matters here for consistency with every
      // other call — this check is purely "does the lane route anywhere".
      modelEnvBlock(validated, catalogue);
    } catch (e) {
      if (e instanceof ModelEnvInvalid) return refuse(1, 'unroutable-lane', e.message);
      throw e;
    }
  } else if (CLASSES.some((c) => registry.classes[c] !== null)) {
    // Going from seeded to unseeded is the one transition that would silently
    // un-route a live lane, so it is refused with the materialiser's own
    // sentence rather than accepted as "an unseeded registry, which is legal".
    return refuse(1, 'unroutable-lane',
      'a lane needs at least one class among opus, sonnet and haiku: clearing this one would leave '
      + `account "${a.id}" with no model at all for an unqualified request.`);
  }
  const w = writeRegistry(a.id, validated);
  if (w !== null) return refuse(1, w[0], w[1]);
  const mat = materialise(account, validated, catalogue);
  if (mat.err !== undefined) return refuse(1, mat.err[0], mat.err[1]);
  out({ ok: true, op: opName, ...extra, ...describe(account, validated, catalogue) });
  return 0;
}

process.exit(main(process.argv));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run test/models-op.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 5: Measured mutation check — the re-validation before the write**

Change the `let validated; try { validated = parseRegistry(next, catalogue); } catch …` block to `const validated = next;`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: three cases red — `rm removes, and refuses to remove one a class still routes to`, `re-VALIDATES before writing: a mutation that would break the registry writes nothing`, and `refuses clearing the class the SUBAGENT points at, naming set-subagent`. Restore and re-run; expected PASS.

- [ ] **Step 6: Measured mutation check — the unroutable-lane gate**

Comment out the whole `if (CLASSES.some(...)) { try { modelEnvBlock(validated, catalogue); } … } else if (…)` block. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `refuses clearing the LAST class rather than writing a lane that routes nowhere (§11)`. Restore and re-run; expected PASS.

- [ ] **Step 7: Measured mutation check — one model, one class**

Delete the `for (const c of CLASSES) { if (c !== a.class && next.classes[c] === a.model) …` loop. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `ASSIGNING A CLASS CLEARS IT FROM THE MODEL THAT HAD IT — one model, one class`, on `expect(classesOf('gpt')['sonnet']).toBeNull()`. Restore and re-run; expected PASS.

- [ ] **Step 8: Measured mutation check — an unseeded registry still gets its TSV**

In `materialise`, move the `for (const [p, text] of [[classes, …], [effort, …]])` loop inside `if (block !== null) { … }`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: two cases red — `writes an UNSEEDED registry for openrouter, and materialises nothing (deviation B-1)` (its TSV assertion) and `on an UNSEEDED registry writes the TSV and no env block`. Restore and re-run; expected PASS. (An absent TSV and a four-`unassigned` TSV are different answers to ccd's question, and only one of them is true.)

- [ ] **Step 9: Measured mutation check — the whitelist slug normalisation**

Change `slugify` to `const slugify = (s) => String(s);`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: two cases red — `admits a model a whitelisted provider serves, and reports which` and `normalises a provider name to the whitelist's slug form`, both now refusing with `no-allowed-provider` on a case that should have succeeded. Restore and re-run; expected PASS.

- [ ] **Step 10: Measured mutation check — a catalogue that exists but is not one**

Change `readCatalogue`'s final `catch` to `return { catalogue: null };`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `a catalogue file that is not a catalogue refuses rather than reading as never-probed`. Restore and re-run; expected PASS.

- [ ] **Step 11: Measured mutation check — the roster is never written**

At the end of `main`'s mutation path, add `writeFileSync(a.file, JSON.stringify(json, null, 2) + '\n');` just before the `out(...)`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `NOTHING here ever rewrites the roster`. Remove the line and re-run; expected PASS. (Ruling 280 is the whole reason this plan exists in its current shape; the rule deserves a mechanism, not a comment.)

- [ ] **Step 11b: Measured mutation check — `rm` actually deletes**

In the `rm` op's loop, comment out `unlinkSync(p);` (keep `removed.push(p);`). Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `removes all four generated files, in order, and clears exactly the eight env keys`, on the `fs.existsSync(...)` assertions (the body still reports every path as `removed`). Restore and re-run; expected PASS.

- [ ] **Step 11c: Measured mutation check — the settings step is skipped ONLY for a true orphan**

Change `if (account !== null) {` (in the `rm` op) to `if (false) {`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `removes all four generated files, in order, and clears exactly the eight env keys`, now reporting `settings: 'orphan'` for a lane the roster DOES have a row for. Restore and re-run; expected PASS.

- [ ] **Step 11d: Measured mutation check — an orphan `show` answers rather than refusing**

Change `if (reg0.registry !== null) {` (in the `account === null` branch) to `if (false) {`. Run `cd server && npx vitest run test/models-op.test.ts`.
Expected: one case red — `an ORPHAN registry — no roster row for this id — answers orphan:true, no class available (§11)`, now getting `no-such-account` at exit 1 instead of an answer. Restore and re-run; expected PASS.

- [ ] **Step 12: Commit**

```bash
chmod 755 deploy/models-op.mjs
git add deploy/models-op.mjs server/test/models-op.test.ts
git commit -m "$(cat <<'MSG'
feat(models): the verbs' node half — read, mutate, re-validate, write, materialise

It owns ~/.ccrc/models/<id>.classes.json and never the roster: ruling 280 keeps
exec.models with the account-connections spec, so the roster is read for three
facts — does this id exist, what is its configDirSuffix, and is it an Anthropic
lane — and written by nothing here. A test asserts that by byte comparison after
every mutation.

Every mutation runs the MUTATED registry back through the validator with the
catalogue before the rename, and derives the env block before the write, so a
change that would leave a lane routing nowhere is refused with nothing on disk
touched. Every success re-materialises. An unseeded registry — what init writes
for openrouter and compatible — is legal, gets its four-`unassigned` TSV, and
gets no env block: an absent TSV and a TSV of unassigned rows are different
answers to ccd's question.

Assigning a class clears it from the model that had it — §8's radio rule lives in
the verb, because the verb is what scripts and doctor's remedies use.

`rm` reaps rather than mutates (spec §4.1 Lifecycle, §11): it runs before the
no-such-account and anthropic-lane gates, deletes the four generated files by
`rm -f` semantics alone — never through the registry or catalogue validators —
and clears exactly the eight settings keys `clearSettingsEnv` owns, skipping that
step for an ORPHAN id the roster has no row for. `show` on such an id answers
rather than refusing, with every class read as unavailable.

`materialise` now passes the SAME parsed catalogue `show` already loaded into
`modelEnvBlock`, rather than reading `<id>.json` a second time, so the eighth
key — `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (spec §6.1, amended 2026-09-08) — is
written exactly when that catalogue can measure the default model's context,
and `settingsDrift` takes the same catalogue so it never treats a correctly
omitted eighth key as drift.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: The top-level `ccrc models` verb group — the dispatcher, `init` and `show`

**Files:**
- Modify: `ccd/ccrc` — a new file-scope `MODELS_SUBS` / `MODELS_BOX_SUBS` / `MODELS_RESERVED` / `MODELS_PROBES` / `MODELS_CLASSES`, the new helpers `_models_refuse` / `_models_node` / `_models_answer` / `_models_summary` / `cmd_models`, the `models)` arm of the top-level `case "$VERB"`, and `usage()`'s brace list plus a new `models` paragraph
- Modify: `server/test/ccrc-cli.test.ts` (the usage-line regex at `:179`, and one new per-verb line)
- Create: `server/test/ccrc-models.test.ts`
- Test: `server/test/ccrc-models.test.ts`, `server/test/ccrc-cli.test.ts`

**Interfaces:**
- Consumes: `deploy/models-op.mjs`'s `show` and `init` ops (Task 6); `_ccrc_die` (`ccd/ccrc:1153`), `CCRC_HERE` (`:842-844`), `_plat_mktemp` (`:303`) as they already exist on `main`.
- Produces:
  ```
  ccrc models <id> show [--json]
  ccrc models <id> init <codex|openrouter|compatible> [--base-url <url>]
  ```
  a **top-level verb group**, not a subcommand of `ccrc account` — that verb is the account-connections branch's and is not on `main` (round-2 ruling 5). Exactly one JSON object on stdout on every path; the human summary goes to STDERR, and `--json` suppresses it. Exit 0 ok, 1 refusal with a body, 2 usage. Tasks 8, 9 and 10 extend the same dispatcher. `show` also answers, rather than refusing, on an ORPHAN id — the roster has no row for it, but a registry file exists (spec §11): `orphan: true`, every class unavailable. Task 8's `rm` is the remedy.

- [ ] **Step 1: Write the failing test file**

Create `server/test/ccrc-models.test.ts`:

```ts
// `ccrc models …` (§10) — what the verb group DOES.
// `server/test/ccrc-cli.test.ts` owns its DISCOVERABILITY (the usage line),
// which is the split that file states verb by verb.
//
// A TOP-LEVEL VERB, not `ccrc account models`: round-2 ruling 5, because
// `cmd_account` is the account-connections branch's and is not on `main`.
//
// The fixture is `ccrc-doctor-graphify.test.ts`'s box, for its reasons: HOME is
// a throwaway `mkTmp`; `ccrc` is invoked through `<home>/ccrc/ccd/ccrc`, the
// shape a deployed box has (deploy.sh rsyncs `ccd` whole) and the shape
// `CCRC_HERE` resolves `../deploy/models-op.mjs` against; `gh`, `curl`,
// `systemctl` and `launchctl` are poisoned beside it. This verb shells out to
// node and to the probe and to nothing else, which the cases below assert.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CODEX_RAW = join(here, 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
    { id: 'router', label: 'router', configDirSuffix: '.claude-router',
      exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ],
};

let home: string;

/** A box carrying the tree `ccrc` resolves against — `ccrc-doctor-graphify.
 *  test.ts`'s `installCcrc`, with `ccrc-models-probe` added to the symlinked
 *  `ccd/` set because `ccrc models refresh` execs it out of `$CCRC_HERE`.
 *  `deploy` and `shared` are symlinked WHOLE: `deploy/models-op.mjs` imports
 *  three `../shared/*.mjs` modules and node resolves them through the link's
 *  realpath. */
function box(roster: unknown = ROSTER): string {
  const h = mkTmp('ccrc-models-verb-');
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  env(h);
  return h;
}

function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(h, { ...process.env, HOME: h, ...extra });
  const poison = (name: string, says: string): void =>
    fs.writeFileSync(join(h, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
  return e;
}

interface Result { code: number; stdout: string; stderr: string }
function run(args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(home, extra), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. */
function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(r.stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const poisonLog = (name: string): string[] => {
  const p = join(home, `${name}-poison`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

const registryOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), 'utf8'));

const writeCatalogue = (id: string, cat: unknown = CODEX): void => {
  fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(cat));
};

beforeEach(() => { home = box(); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the models dispatcher', () => {
  it('spells its per-lane subcommand list once, at file scope', () => {
    // The dispatcher below and the refusal that lists what this build
    // implements must read ONE string, or a subcommand can dispatch while the
    // refusal claims it does not exist.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['init', 'show']);
  });

  it('spells the reserved first-token words once, at file scope', () => {
    // Deviation B-4: `refresh` and `litellm` are box-wide subcommands in the
    // slot an account id otherwise occupies, and an account id may legally BE
    // one of those words.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_RESERVED="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_RESERVED').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['litellm', 'refresh']);
  });

  it('with nothing after it refuses at exit 2 with a body', () => {
    const r = run(['models']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('missing-argument');
  });

  it('with an id and no subcommand names the ones this build has', () => {
    const r = run(['models', 'gpt']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('missing-subcommand');
    expect(String(b['detail'])).toContain('show');
  });

  it('an unknown subcommand refuses at exit 2 rather than reaching node', () => {
    const r = run(['models', 'gpt', 'frobnicate']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-subcommand');
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('an id that is not an id refuses at exit 2, before node', () => {
    const r = run(['models', '../escape', 'show']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('bad-account-id');
  });

  it('REFUSES an account literally named `refresh`, naming the collision (deviation B-4)', () => {
    // `ID_RE` allows it, and the grammar cannot allow both readings. The
    // refusal is at exit 2, on the ROSTER, and names the fix.
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      { id: 'refresh', label: 'refresh', configDirSuffix: '.claude-refresh',
        exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' }] });
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('reserved-account-id');
    expect(String(b['detail'])).toContain('rename');
  });

  it('a reserved word this build has no arm for yet says so, and does not read it as an id', () => {
    // Tasks 9 and 10 replace this expectation with the real arms. Until then
    // the grammar is already in force: `refresh` is never an account id here.
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-subcommand');
  });
});

describe('ccrc models <id> show', () => {
  it('answers one JSON object and a human summary on STDERR', () => {
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['id']).toBe('gpt');
    expect(b['registry']).toBeNull();
    // The verb's contract is one object on stdout; a person still needs a
    // sentence, so it goes where a sentence goes.
    expect(r.stderr).toMatch(/never probed/);
    expect(r.stderr).toMatch(/no class registry yet/);
  });

  it('--json prints the object and NOTHING on stderr', () => {
    const r = run(['models', 'gpt', 'show', '--json']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(r.stderr).toBe('');
  });

  it('summarises a probed, seeded lane: the four unclassified, the missing fable, the subagent', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect((b['derived'] as { unclassified: string[] }).unclassified).toHaveLength(4);
    expect(r.stderr).toContain('gpt-6-astra');
    expect(r.stderr).toMatch(/fable\s+—/);
    expect(r.stderr).toMatch(/subagents run as sonnet/);
  });

  it('an anthropic lane answers read-only and says why', () => {
    const r = run(['models', 'claude-a', 'show']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['registry']).toBeNull();
    expect(r.stderr).toMatch(/Claude Code's own defaults/);
  });

  it('names a drifted settings key in the summary, with the remedy', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.ANTHROPIC_MODEL = 'wrong';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'show']);
    expect(oneObject(r)['settingsDrift']).toEqual(['ANTHROPIC_MODEL']);
    expect(r.stderr).toMatch(/settings\.json has drifted/);
  });

  it('an ORPHAN registry — no roster row for this id — answers orphan:true rather than refusing (§11)', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['orphan']).toBe(true);
    expect((b['derived'] as { available: string[] }).available).toEqual([]);
  });

  it('a refusal still carries exactly one JSON object on stdout', () => {
    fs.rmSync(join(home, '.ccrc', 'accounts.json'));
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-absent');
  });

  it('reaches node and NOTHING else — no curl, no systemctl, no gh', () => {
    run(['models', 'gpt', 'show']);
    expect(poisonLog('curl')).toEqual([]);
    expect(poisonLog('systemctl')).toEqual([]);
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('takes only --json', () => {
    const r = run(['models', 'gpt', 'show', '--wat']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> init', () => {
  it('seeds the gpt registry and materialises, at exit 0', () => {
    const r = run(['models', 'gpt', 'init', 'codex']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['created']).toBe(true);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBe('gpt-5.6-sol');
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
  });

  it('needs a probe kind', () => {
    const r = run(['models', 'gpt', 'init']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('probe');
  });

  it('refuses an unknown probe kind at exit 2, before node runs', () => {
    const r = run(['models', 'gpt', 'init', 'gemini']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-probe');
  });

  it('refuses `openai` with its own sentence — that is a PROVIDER, not a probe kind', () => {
    const r = run(['models', 'gpt', 'init', 'openai']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/spelled "codex"/);
  });

  it('refuses `anthropic` with its own sentence', () => {
    const r = run(['models', 'claude-a', 'init', 'anthropic']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes --base-url through for a compatible lane', () => {
    const r = run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    expect(r.code).toBe(0);
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai');
  });

  it('an openrouter lane is created unseeded and prints the remedy', () => {
    const r = run(['models', 'router', 'init', 'openrouter']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['created']).toBe(true);
    expect(String(b['remedy'])).toMatch(/discovery add/);
  });

  it('takes no extra argument', () => {
    const r = run(['models', 'gpt', 'init', 'codex', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run test/ccrc-models.test.ts`
Expected: FAIL — the three source-scan cases fail on `expect(m).toBeTruthy()`, and every `run(['models', …])` case exits 2 with `ccrc: unknown argument: models` on stderr and nothing on stdout, so `oneObject` reports `stdout carried 0 lines, not one`.

- [ ] **Step 3: Declare the verb group's constants**

In `ccd/ccrc`, immediately after the `PROG=` / usage block's constants (any file-scope spot above `cmd_doctor` will do; keep them together), add:

```bash
# ── the model-class registry (spec §10) ───────────────────────────────────
# The per-lane subcommands this build implements, spelled ONCE at file scope:
# the dispatcher and the refusal that lists what exists must read one string,
# or a subcommand can dispatch while the refusal claims it does not exist.
MODELS_SUBS="init show"

# The BOX-WIDE subcommands this build implements — a different question from a
# lane's own classes, on a different cadence (§5).
MODELS_BOX_SUBS=""

# The words that are never read as an account id in `ccrc models <here>`.
# It is the GRAMMAR and not the implementation, so it lists both box-wide
# subcommands from the start: `ID_RE` allows an account literally named
# `refresh`, and one reading has to win. An account with such an id is refused
# by name (deviation B-4) rather than being silently unreachable.
MODELS_RESERVED="refresh litellm"

# The probe kinds a lane's registry can name (spec §4.1). Here so `init` can
# refuse a typo at exit 2 — a USAGE error — before node is asked to interpret
# it as a box condition.
MODELS_PROBES="codex openrouter compatible"

# The four classes, in `shared/models.ts`'s CLASSES order.
MODELS_CLASSES="haiku sonnet opus fable"
```

- [ ] **Step 4: Add the refusal envelope, the node bridge and the summary**

In `ccd/ccrc`, immediately after `_ccrc_usage_die` (`:1157`), add:

```bash
# The models verbs' refusal envelope: exactly one JSON object on stdout, the
# human sentence on stderr, on EVERY path. An exit code with an empty body is
# "the box said no" and "this build cannot answer you" arriving as the same two
# bytes, and the server parses stdout.
_models_refuse() {   # <error> <exit code> <detail…>
  local err="$1" code="$2"; shift 2
  printf '{"ok":false,"error":"%s","detail":%s}\n' "$err" "$(printf '%s' "$*" | jq -Rs .)"
  echo "$PROG: $*" >&2
  exit "$code"
}
```

and, immediately after `_plat_mktemp_d` (`:306`), the bridge:

```bash
# `deploy/models-op.mjs` is this design's node half — a NEW file, because
# `main` has no node helper for account state to add ops to (`deploy/
# account-op.mjs` is the account-connections branch's and is not here).
# `$CCRC_HERE/..` is `cmd_wrappers`' idiom (:2276): true in a checkout and at
# ~/ccrc on a deployed box, because both deploy lanes land `deploy/` there.
#
# NOTHING IS RE-WORDED HERE: stdout is the caller's answer and stderr is the
# caller's remedy.
_models_node() { node "$CCRC_HERE/../deploy/models-op.mjs" "$@"; }

# The empty-body seam: a half-updated box can carry a ccrc that knows `models`
# beside a `deploy/models-op.mjs` that does not, and that condition must not
# reach the caller as a bare exit code.
_models_answer() {
  local body rc
  body="$(_models_node "$@")"; rc=$?
  [ -n "$body" ] \
    || _models_refuse no-answer 1 "deploy/models-op.mjs exited $rc without writing an answer to '$1', so this run has nothing to tell you. ccrc and deploy/models-op.mjs ship together and must be one build. Re-run the install (or redeploy), then re-run this. Nothing was written."
  printf '%s\n' "$body"
  return "$rc"
}
```

- [ ] **Step 5: Write `cmd_models`, its summary, and the two arms**

In `ccd/ccrc`, immediately before `cmd_install` (`:3681`), add:

```bash
# ── cmd_models — the model-class registry's verb group (spec §10) ─────────
# A TOP-LEVEL verb, not a subcommand of `ccrc account`: that verb belongs to the
# account-connections branch and is not on `main` (round-2 ruling 5, mail 280).
#
# The grammar is two-shaped, and the shape is decided by the FIRST token:
#   ccrc models <id> <sub> …     — one lane's own classes
#   ccrc models refresh|litellm … — the catalogues those classes are classified
#                                   against, and the config generated from them
# `$MODELS_RESERVED` is what makes that decidable; an account whose id is one of
# those words is refused by name rather than silently unreachable.
_models_deps() {
  # `cmd_install`'s guard (:3734), for this verb: node runs the JSON emitter, so
  # its absence is the ONE refusal this verb cannot phrase as JSON. jq is
  # checked second, with node already proven present.
  command -v node >/dev/null 2>&1 \
    || _ccrc_die "node is required by 'ccrc models' — it runs ${CCRC_HERE%/*}/deploy/models-op.mjs, the only thing on this box that writes this verb's JSON — but is not on PATH. Install Node (this repo's floor is in server/package.json's \"engines\") or put it on PATH, then re-run. Nothing on this box was written or changed, and this is the one refusal this verb cannot phrase as JSON."
  command -v jq >/dev/null 2>&1 \
    || _ccrc_die "jq is required by 'ccrc models' — it renders this verb's answers and reads its own JSON back — but is not on PATH. Install jq, then re-run. Nothing was written."
}

# `$HOME/.ccrc/accounts.json`, spelled the way every other reader in this file
# spells it (`cmd_wrappers` at :2362, `cmd_install` at :3960) — a helper rather
# than eleven copies, because five functions below need it and `models-op.mjs`
# is handed it as `--file`. No override: this file has no `CCRC_ROSTER` idiom,
# and inventing one here would be a second way to name the roster.
_models_roster_path() { printf '%s' "$HOME/.ccrc/accounts.json"; }

_models_summary() {   # <json body> — the human sentences, on STDERR
  # STDERR, not stdout, and that is the whole point: this verb's contract is
  # exactly one JSON object on stdout (the server parses it), and a person still
  # needs a sentence. `--json` suppresses this function; it does not change what
  # stdout carries.
  printf '%s' "$1" | jq -r '
    "account \(.id)\(if .anthropic then " — an Anthropic lane" else "" end)",
    (if .registry == null then
       (if .anthropic then
          "  the four classes are Claude Code'"'"'s own defaults on this lane; there is nothing to classify."
        else
          "  no class registry yet — every class is unavailable. Run: ccrc models \(.id) init <codex|openrouter|compatible>"
        end)
     else
       ("  probe: \(.registry.probe)"),
       (["haiku","sonnet","opus","fable"]
         | map("  \(.)\t\($reg.classes[.] // "—")") | .[]),
       ("  subagents run as \(.registry.subagent) (\($reg.classes[.registry.subagent] // "—"))")
     end),
    (if .catalogue == null then "  catalogue: never probed — run: ccrc models refresh \(.id)"
     else "  catalogue: \(.catalogue.count) models\(if .catalogue.stale then " (STALE)" else "" end)" end),
    (if (.derived.unclassified | length) > 0 then
       "  unclassified (\(.derived.unclassified | length)): \(.derived.unclassified | join(", "))" else empty end),
    (if (.derived.retired | length) > 0 then
       "  RETIRED, and unavailable for routing: \(.derived.retired | join(", "))" else empty end),
    (if (.derived.available | length) == 0 and (.anthropic | not) then
       "  no class is available, so ccd will place nothing here" else empty end),
    (if (.settingsDrift | length) > 0 then
       "  this lane'"'"'s settings.json has drifted from the registry on: \(.settingsDrift | join(", ")) — re-materialise by running any models mutation, e.g. ccrc models \(.id) set-subagent \(.registry.subagent)"
     else empty end)
  ' --argjson reg "$(printf '%s' "$1" | jq -c '.registry // {classes:{}}')" >&2
}

_models_id_ok() {   # <token> — a usage-level gate, before node
  local id="$1" w
  for w in $MODELS_RESERVED; do
    [ "$w" = "$id" ] && return 1
  done
  [[ "$id" =~ ^[a-z][a-z0-9-]{0,31}$ ]] || return 2
  return 0
}

_models_lane_sub() {   # <accountId> <subcommand> [args…]
  local id="$1" sub="$2" file; shift 2
  file="$(_models_roster_path)"
  case "$sub" in
    show)
      local as_json=0
      case "${1:-}" in --json) as_json=1; shift ;; esac
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id show takes only --json, and got \"$1\""
      # THE BODY IS PRINTED FIRST AND UNCONDITIONALLY, so the "exactly one JSON
      # object on stdout" contract holds on a refusal as much as on an answer.
      # The summary is only attempted for a successful body, because there is
      # nothing to summarise otherwise.
      local body rc
      body="$(_models_answer show --file "$file" --id "$id")"; rc=$?
      printf '%s\n' "$body"
      [ "$rc" -eq 0 ] || return "$rc"
      [ "$as_json" -eq 1 ] || _models_summary "$body"
      return 0
      ;;
    init)
      local probe="${1:-}"
      [ -n "$probe" ] || _models_refuse missing-argument 2 "ccrc models $id init needs a probe kind: one of ${MODELS_PROBES// /, }"
      shift
      local base=""
      case "${1:-}" in
        --base-url) [ $# -ge 2 ] || _models_refuse missing-argument 2 "--base-url needs a value"; base="$2"; shift 2 ;;
      esac
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id init takes a probe kind and an optional --base-url, and got \"$1\""
      # A TYPO IS A USAGE ERROR AND IS ANSWERED HERE, at exit 2, before node is
      # asked to interpret it as a fact about the box. The two near-misses get
      # their own sentences, because each is a real name for something else and
      # "unknown" would be a lie about this box's vocabulary.
      [ "$probe" != "openai" ] \
        || _models_refuse unknown-probe 2 "\"openai\" is a PROVIDER on the account-connections branch, not a probe kind: the Codex probe is spelled \"codex\" (spec §4.1). Nothing was written."
      [ "$probe" != "anthropic" ] \
        || _models_refuse unknown-probe 2 "anthropic lanes carry no class registry: those four classes are Claude Code's own defaults, shown read-only. Nothing was written."
      local ok=0 p
      for p in $MODELS_PROBES; do [ "$p" = "$probe" ] && ok=1; done
      [ "$ok" -eq 1 ] \
        || _models_refuse unknown-probe 2 "\"$probe\" is not a probe kind this build knows: use one of ${MODELS_PROBES// /, }"
      if [ -n "$base" ]; then
        _models_answer init --file "$file" --id "$id" --probe "$probe" --base-url "$base" || exit $?
      else
        _models_answer init --file "$file" --id "$id" --probe "$probe" || exit $?
      fi
      return 0
      ;;
    *) _models_refuse internal-no-arm 1 "ccrc models lists \"$sub\" as implemented and has no arm for it — this is a bug in ccrc, not a fact about your box, and nothing was written" ;;
  esac
}

cmd_models() {
  case "${1:-}" in
    -h|--help) usage; exit 0 ;;
  esac
  _models_deps
  local first="${1:-}"
  [ -n "$first" ] \
    || _models_refuse missing-argument 2 "ccrc models needs a lane id or a subcommand: ccrc models <id> {${MODELS_SUBS// /|}}, or ccrc models {${MODELS_RESERVED// /|}}"
  shift

  # THE RESERVED WORDS DECIDE THE GRAMMAR (deviation B-4). An account whose id
  # is one of them is refused by name here — before anything reads the roster
  # for a different purpose — so the collision is a sentence and not a lane
  # nobody can reach.
  local w
  for w in $MODELS_RESERVED; do
    if [ "$w" = "$first" ]; then
      if jq -e --arg id "$w" '.accounts // [] | any(.id == $id)' "$(_models_roster_path)" >/dev/null 2>&1; then
        _models_refuse reserved-account-id 2 "this box has an account named \"$w\", and \"$w\" is also a subcommand of 'ccrc models' — so 'ccrc models $w …' cannot mean both. Rename that account in $(_models_roster_path) (it is yours; nothing else on this box depends on the name), or address it through the PWA. Nothing was written."
      fi
      local known=0 s
      for s in $MODELS_BOX_SUBS; do [ "$s" = "$w" ] && known=1; done
      [ "$known" -eq 1 ] \
        || _models_refuse unknown-subcommand 2 "ccrc models has no subcommand \"$w\" in this build. It implements: ${MODELS_BOX_SUBS:-(none yet)}"
      _models_box_sub "$w" "$@"
      return 0
    fi
  done

  _models_id_ok "$first"
  case $? in
    2) _models_refuse bad-account-id 2 "\"$first\" is not an account id: a lowercase letter followed by up to 31 of letters, digits and \"-\". Run 'ccrc status' to see this box's accounts." ;;
  esac
  local sub="${1:-}"
  [ -n "$sub" ] || _models_refuse missing-subcommand 2 "ccrc models $first needs a subcommand. This build implements: $MODELS_SUBS"
  shift
  local known=0 s
  for s in $MODELS_SUBS; do [ "$s" = "$sub" ] && known=1; done
  [ "$known" -eq 1 ] \
    || _models_refuse unknown-subcommand 2 "ccrc models has no subcommand \"$sub\". This build implements: $MODELS_SUBS"
  _models_lane_sub "$first" "$sub" "$@"
}
```

Task 9 adds `_models_box_sub` and its `refresh` arm; Task 10 adds `litellm`. Until then `MODELS_BOX_SUBS` is empty and the reserved words are refused by the `known` check above, which is what the `a reserved word this build has no arm for yet` case asserts.

- [ ] **Step 6: Wire the verb and its usage**

In the top-level `case "$VERB"` (`ccd/ccrc`, the dispatcher at the foot of the file), add after the `wrappers)` line:

```bash
  models)  cmd_models "$@" ;;
```

In `usage()` (`:1073`), change the brace list from

```
usage: $PROG {doctor|status|adopt|wrappers|install|update|uninstall|backup|logs|passwd|expose|version}
```

to

```
usage: $PROG {doctor|status|adopt|wrappers|models|install|update|uninstall|backup|logs|passwd|expose|version}
```

and add a paragraph after `wrappers`':

```
  models    the model-class registry: which concrete model each of the four
            classes (haiku, sonnet, opus, fable) means on a lane, and which
            class subagents run as. "ccrc models <id> show" reports it,
            "init" seeds it, and set-class/set-subagent/set-effort/discovery
            change it — each re-writing that lane's own settings.json.
            "ccrc models refresh <id>|--all" probes the provider catalogues
            those classes are classified against
```

In `server/test/ccrc-cli.test.ts:179`, change the pinned regex to:

```ts
    expect(r.stdout).toMatch(/usage: ccrc \{doctor\|status\|adopt\|wrappers\|models\|install\|update\|uninstall\|backup\|logs\|passwd\|expose\|version\}/);
```

and add, beside the other per-verb lines at `:180-185`:

```ts
    expect(r.stdout).toMatch(/^ {2}models {4}the model-class registry/m);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/ccrc-models.test.ts test/ccrc-cli.test.ts`
Expected: PASS, both files. If `ccrc-cli.test.ts` reds on the `models` paragraph's regex, adjust the added lines' indentation to two spaces + the paragraph's continuation indent rather than loosening the assertion.

- [ ] **Step 8: Measured mutation check — the subcommand list is one string**

Change `for s in $MODELS_SUBS; do` in `cmd_models` to `for s in init show; do` and remove `show` from `MODELS_SUBS`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `spells its per-lane subcommand list once, at file scope`, reporting a one-element list while every `show` case still passes. Restore both and re-run; expected PASS. (This is the mutation that makes "one string" load-bearing rather than decorative: without it, a subcommand can dispatch while the refusal claims it does not exist.)

- [ ] **Step 9: Measured mutation check — the reserved-word collision**

Delete the `if jq -e --arg id "$w" … _models_refuse reserved-account-id …` block. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `REFUSES an account literally named `refresh`, naming the collision (deviation B-4)`, which now gets `unknown-subcommand` instead. Restore and re-run; expected PASS.

- [ ] **Step 10: Measured mutation check — the JSON contract survives a refusal**

In the `show` arm, move `printf '%s\n' "$body"` below the `[ "$rc" -eq 0 ] || return "$rc"` line. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `a refusal still carries exactly one JSON object on stdout`, failing in `oneObject` with `stdout carried 0 lines, not one`. Restore the order and re-run; expected PASS.

- [ ] **Step 11: Check for a provenance marker**

Run: `sed -n 2p ccd/ccrc`
Expected: a comment line, NOT a `# ccrc:generated` line. No re-stamp, and `server/test/ownership.test.ts` needs no run for this file.

- [ ] **Step 12: Commit**

```bash
git add ccd/ccrc server/test/ccrc-models.test.ts server/test/ccrc-cli.test.ts
git commit -m "$(cat <<'MSG'
feat(ccrc): the top-level `models` verb group, with show and init

A top-level verb and not `ccrc account models`: that verb belongs to the
account-connections branch and is not on main (ruling 280). The grammar is
decided by the first token — a lane id, or one of two reserved box-wide words —
and an account literally named `refresh` is refused by name rather than left
silently unreachable, because ID_RE allows that id and one reading has to win.

The verb's contract is exactly one JSON object on stdout, so the sentences a
person needs go to stderr and --json suppresses those rather than changing what
stdout carries. A probe typo is answered in bash, at exit 2, before node is asked
to interpret it as a fact about the box; `openai` and `anthropic` get their own
sentences, because each is a real name for something else.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 8: `ccrc models <id> set-class | set-subagent | set-effort | discovery | rm`

**Files:**
- Modify: `ccd/ccrc` — `MODELS_SUBS`, five new arms in `_models_lane_sub`, and two new helpers `_models_class_ok` / `_models_endpoints`
- Test: `server/test/ccrc-models.test.ts` (five new describes)

**Interfaces:**
- Consumes: `_models_answer`, `_models_lane_sub`, `MODELS_SUBS`, `MODELS_CLASSES`, `_models_refuse` (Task 7); `deploy/models-op.mjs`'s `set-class`, `set-subagent`, `set-effort`, `discovery` and `rm` ops (Task 6); `ccd/ccrc-models-probe --endpoints` (Task 5).
- Produces:
  ```
  ccrc models <id> set-class <haiku|sonnet|opus|fable> <modelId|none>
  ccrc models <id> set-subagent <haiku|sonnet|opus|fable>
  ccrc models <id> set-effort <haiku|sonnet|opus|fable> <level|default>
  ccrc models <id> discovery add <modelId> | rm <modelId> | catalogue
  ccrc models <id> rm
  ```
  Each of the first four re-materialises on success (the node half does it) and refuses with the field named on any validation failure. `discovery add` on a lane whose registry names `openrouter` runs the endpoints call first and refuses when no ownership-whitelisted provider serves the model (§5). `ccrc models <id> rm` (spec §4.1 Lifecycle, §10, §11) takes no arguments and is a REAP, not a mutation: it delegates straight to the node op and answers with its JSON — the registry, catalogue, TSV and effort file are deleted and the eight settings keys are cleared, idempotently, and it skips the settings step (and says so) on an ORPHAN id the roster has no row for.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccrc-models.test.ts`:

```ts
describe('ccrc models <id> set-class', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('assigns a class and rewrites the lane\'s settings.json and TSV', () => {
    const r = run(['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('gpt-6-astra');
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('fable\tgpt-6-astra\tassigned\n');
  });

  it('`none` clears it', () => {
    const r = run(['models', 'gpt', 'set-class', 'opus', 'none']);
    expect(r.code).toBe(0);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBeNull();
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('opus\t\tunassigned\n');
  });

  it('refuses a class that is not one of the four, at exit 2, before node', () => {
    const r = run(['models', 'gpt', 'set-class', 'subagent', 'gpt-5.5']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
    expect(String(oneObject(r)['detail'])).toMatch(/set-subagent/);
  });

  it('needs both a class and a model', () => {
    expect(run(['models', 'gpt', 'set-class', 'fable']).code).toBe(2);
    expect(run(['models', 'gpt', 'set-class']).code).toBe(2);
  });

  it('takes no third argument', () => {
    const r = run(['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> set-subagent', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('moves CLAUDE_CODE_SUBAGENT_MODEL, and nothing else in the block', () => {
    const before = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    const r = run(['models', 'gpt', 'set-subagent', 'opus']);
    expect(r.code).toBe(0);
    const after = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(after.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-sol');
    expect(after.env.ANTHROPIC_MODEL).toBe(before.env.ANTHROPIC_MODEL);
    expect(after.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(before.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  });

  it('refuses a class whose slot is null, naming set-class', () => {
    const r = run(['models', 'gpt', 'set-subagent', 'fable']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toMatch(/set-class fable/);
  });

  it('refuses a word that is not a class, at exit 2', () => {
    const r = run(['models', 'gpt', 'set-subagent', 'sonnet-class']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
  });

  it('needs a class', () => {
    expect(run(['models', 'gpt', 'set-subagent']).code).toBe(2);
  });
});

describe('ccrc models <id> set-effort', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('sets a level and it reaches the effort file the shim reads', () => {
    const r = run(['models', 'gpt', 'set-effort', 'sonnet', 'xhigh']);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8'))
      .byModel['gpt-5.6-terra']).toBe('xhigh');
  });

  it('refuses a level the classed model does not offer', () => {
    const r = run(['models', 'gpt', 'set-effort', 'haiku', 'ultra']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toContain('gpt-5.6-luna');
  });

  it('refuses a class that is not one of the four, at exit 2', () => {
    const r = run(['models', 'gpt', 'set-effort', 'subagent', 'high']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
  });
});

describe('ccrc models <id> discovery', () => {
  const whitelist = (providers: string[]): void => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(join(home, '.handoff', 'providers-whitelist.json'), JSON.stringify({ providers }));
  };
  const endpointsFixture = (names: string[]): string => {
    const p = join(home, 'endpoints-fixture.json');
    fs.writeFileSync(p, JSON.stringify({ data: { endpoints: names.map((n) => ({ provider_name: n })) } }));
    return p;
  };

  it('add and rm on a codex lane, with no whitelist question asked', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'discovery', 'add', 'gpt-5.5']);
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['discovery']).toEqual(['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']
      .filter((x) => (registryOf('gpt')['discovery'] as string[]).includes(x)));
    expect(fs.existsSync(join(home, '.handoff', 'providers-whitelist.json'))).toBe(false);
    expect(run(['models', 'gpt', 'discovery', 'catalogue']).code).toBe(0);
    expect(registryOf('gpt')['discovery']).toBe('catalogue');
  });

  it('an unknown action is a usage error naming the three', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'router', 'discovery', 'purge']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('catalogue');
  });

  it('catalogue takes no model id', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'router', 'discovery', 'catalogue', 'gpt-5.5']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  describe('the ownership whitelist, on an openrouter lane only (§5)', () => {
    beforeEach(() => { run(['models', 'router', 'init', 'openrouter']); });

    it('admits a model a whitelisted provider serves, and says which', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks', 'Z.AI']) });
      expect(r.code).toBe(0);
      expect(oneObject(r)['servedBy']).toEqual(['fireworks']);
      expect(registryOf('router')['discovery']).toEqual(['z-ai/glm-5.2']);
    });

    it('refuses when no whitelisted provider serves it, and writes nothing', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Z.AI']) });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('no-allowed-provider');
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('refuses when the endpoints call itself fails, and writes nothing', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: join(home, 'nope') });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('rm never asks the whitelist question — removing needs no permission', () => {
      whitelist(['fireworks']);
      run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks']) });
      const r = run(['models', 'router', 'discovery', 'rm', 'z-ai/glm-5.2']);
      expect(r.code).toBe(0);
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('leaves no endpoints temp file behind', () => {
      whitelist(['fireworks']);
      run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks']) });
      expect(fs.readdirSync(home).filter((f) => f.includes('endpoints') && f !== 'endpoints-fixture.json'))
        .toEqual([]);
    });
  });
});

describe('ccrc models <id> rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('removes all four files and clears exactly the eight env keys, leaving another env key', () => {
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.DISABLE_TELEMETRY = '1';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'rm']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect((b['removed'] as string[]).length).toBe(4);
    expect(b['settings']).toBe('cleared');
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.classes.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.effort.json'))).toBe(false);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.env.DISABLE_TELEMETRY).toBe('1');
    expect(Object.keys(after.env)).not.toContain('ANTHROPIC_MODEL');
  });

  it('a second run exits 0 with removed: []', () => {
    run(['models', 'gpt', 'rm']);
    const r = run(['models', 'gpt', 'rm']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['removed']).toEqual([]);
  });

  it('refuses an argument at exit 2', () => {
    const r = run(['models', 'gpt', 'rm', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  it('an orphan — a registry for an id the fixture roster has no row for — reports settings: orphan', () => {
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'rm']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['settings']).toBe('orphan');
  });
});
```

Also update the `spells its per-lane subcommand list once, at file scope` case's expected list to the full seven:

```ts
    expect(m![1]!.split(' ').filter(Boolean).sort())
      .toEqual(['discovery', 'init', 'rm', 'set-class', 'set-effort', 'set-subagent', 'show']);
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run test/ccrc-models.test.ts`
Expected: FAIL — the subcommand-list case reports the two-element list, and every new case gets `unknown-subcommand` at exit 2 because the five subcommands are not in `MODELS_SUBS` yet.

- [ ] **Step 3: Widen `MODELS_SUBS`**

```bash
MODELS_SUBS="discovery init rm set-class set-effort set-subagent show"
```

- [ ] **Step 4: Add the class gate and the endpoints helper**

In `ccd/ccrc`, immediately after `_models_summary`, add:

```bash
# A class typo is a USAGE error and is answered here, at exit 2, before node is
# asked to interpret it as a box condition — and "subagent" gets a sentence of
# its own, because it is a real field of the registry (the class subagents run
# as) and refusing it as merely "unknown" would be a lie about this file's
# vocabulary.
_models_class_ok() {   # <class>
  local c
  for c in $MODELS_CLASSES; do [ "$c" = "$1" ] && return 0; done
  [ "$1" != "subagent" ] \
    || _models_refuse unknown-class 2 "\"subagent\" is not a class: the four are ${MODELS_CLASSES// /, }. It is a FIELD naming which of those four subagents run as — run 'ccrc models <id> set-subagent <class>' to change it."
  _models_refuse unknown-class 2 "\"$1\" is not a class: the four are ${MODELS_CLASSES// /, }."
}

# The OpenRouter ownership question (§5), asked ONCE per discovery-add and only
# on a lane whose registry names `openrouter`: that is the only lane whose
# traffic goes through `handoff-proxy`'s `provider.only` injection, so it is the
# only lane on which "which providers serve this model" decides anything. The
# probe does the network; node does the whitelist comparison. The answer lands
# in a temp file that is removed on every path, because it is one question's
# answer and not state.
# It sets a GLOBAL rather than printing the path, and the caller invokes it
# directly rather than in `$( )`. That is not style: `_models_refuse` ends in
# `exit`, and an `exit` inside a command substitution kills only the SUBSHELL —
# the caller would carry on with the refusal's own JSON as the "temp file
# path". Every helper in this group that can refuse is called this way.
MODELS_ENDPOINTS_TMP=""
_models_endpoints() {   # <accountId> <modelId> -> sets MODELS_ENDPOINTS_TMP
  local probe="$CCRC_HERE/ccrc-models-probe"
  [ -x "$probe" ] \
    || _models_refuse install-incomplete 1 "the model probe is missing or not executable: $probe — is this a complete ccrc install? Nothing was written."
  local tmp
  tmp="$(_plat_mktemp)" || _models_refuse unwritable 1 "could not create a temp file for the OpenRouter endpoints answer. Nothing was written."
  if ! "$probe" "$1" openrouter --endpoints "$2" --out "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    _models_refuse endpoints-unreachable 1 "the OpenRouter endpoints call for \"$2\" failed, so this box cannot say which providers serve it — and the ownership whitelist is what decides whether it may be added at all. Nothing was written."
  fi
  MODELS_ENDPOINTS_TMP="$tmp"
}
```

- [ ] **Step 5: Add the five arms**

In `_models_lane_sub`'s `case "$sub"`, before the `*)` arm:

```bash
    set-class)
      local cls="${1:-}" model="${2:-}"
      [ -n "$cls" ] && [ -n "$model" ] \
        || _models_refuse missing-argument 2 "ccrc models $id set-class needs a class and a model: ccrc models $id set-class <${MODELS_CLASSES// /|}> <modelId|none>"
      shift 2
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id set-class takes a class and a model, and got \"$1\""
      _models_class_ok "$cls"
      _models_answer set-class --file "$file" --id "$id" --class "$cls" --model "$model" || exit $?
      return 0
      ;;
    set-subagent)
      local cls="${1:-}"
      [ -n "$cls" ] \
        || _models_refuse missing-argument 2 "ccrc models $id set-subagent needs a class: ccrc models $id set-subagent <${MODELS_CLASSES// /|}>"
      shift
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id set-subagent takes one class, and got \"$1\""
      _models_class_ok "$cls"
      _models_answer set-subagent --file "$file" --id "$id" --class "$cls" || exit $?
      return 0
      ;;
    set-effort)
      local cls="${1:-}" level="${2:-}"
      [ -n "$cls" ] && [ -n "$level" ] \
        || _models_refuse missing-argument 2 "ccrc models $id set-effort needs a class and a level: ccrc models $id set-effort <${MODELS_CLASSES// /|}> <level|default>"
      shift 2
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id set-effort takes a class and a level, and got \"$1\""
      _models_class_ok "$cls"
      _models_answer set-effort --file "$file" --id "$id" --class "$cls" --level "$level" || exit $?
      return 0
      ;;
    discovery)
      local action="${1:-}"
      [ -n "$action" ] \
        || _models_refuse missing-argument 2 "ccrc models $id discovery needs an action: add <modelId>, rm <modelId>, or catalogue"
      shift
      case "$action" in
        catalogue)
          [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id discovery catalogue takes no model id, and got \"$1\" — it means the WHOLE advertised set"
          _models_answer discovery --file "$file" --id "$id" --action catalogue || exit $?
          ;;
        add|rm)
          local model="${1:-}"
          [ -n "$model" ] \
            || _models_refuse missing-argument 2 "ccrc models $id discovery $action needs a model id"
          shift
          [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id discovery $action takes one model id, and got \"$1\""
          # THE OWNERSHIP CHECK IS OPENROUTER'S, IS ADD'S ALONE, AND HAPPENS
          # BEFORE THE WRITE. The lane's probe kind is read from its own
          # registry rather than assumed, so a Codex or `compatible` lane never
          # pays for a question that decides nothing about it — and `rm` never
          # asks it, because removing a model needs no permission.
          local probe showbody
          # The show body is captured WHOLE and then read, rather than piped
          # straight into jq: `_models_answer`'s own refusal exits with a
          # non-zero status, and a pipe would hand jq that refusal's JSON and
          # succeed on it, losing the failure.
          showbody="$(_models_answer show --file "$file" --id "$id")" \
            || _models_refuse no-answer 1 "could not read account \"$id\"'s probe kind before changing its discovery list. Nothing was written."
          probe="$(printf '%s' "$showbody" | jq -r '.registry.probe // ""')"
          if [ "$action" = "add" ] && [ "$probe" = "openrouter" ]; then
            _models_endpoints "$id" "$model"
            _models_answer discovery --file "$file" --id "$id" --action add --model "$model" --endpoints "$MODELS_ENDPOINTS_TMP"
            local rc=$?
            rm -f "$MODELS_ENDPOINTS_TMP"
            [ "$rc" -eq 0 ] || exit "$rc"
          else
            _models_answer discovery --file "$file" --id "$id" --action "$action" --model "$model" || exit $?
          fi
          ;;
        *) _models_refuse unknown-action 2 "ccrc models $id discovery has no action \"$action\": it takes add <modelId>, rm <modelId>, or catalogue" ;;
      esac
      return 0
      ;;
    rm)
      # A REAP, not a mutation (spec §4.1 Lifecycle, §10, §11): no arguments,
      # and no class or endpoints gate above it — it delegates straight to the
      # node op and answers with its own JSON, on an ORPHAN id exactly as much
      # as on one the roster has a row for.
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id rm takes no arguments, and got \"$1\""
      _models_answer rm --file "$file" --id "$id" || exit $?
      return 0
      ;;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/ccrc-models.test.ts`
Expected: PASS, every describe.

- [ ] **Step 7: Measured mutation check — the ownership check is not skippable**

In the `add|rm` arm, change `if [ "$action" = "add" ] && [ "$probe" = "openrouter" ]; then` to `if false; then`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: three cases red — `admits a model a whitelisted provider serves, and says which` (no `servedBy` in the body), `refuses when no whitelisted provider serves it, and writes nothing` (exit 0 and the model added), and `refuses when the endpoints call itself fails, and writes nothing`. Then change it to `if [ "$probe" = "openrouter" ]; then` — dropping the `add` half — and re-run: expected one DIFFERENT case red, `rm never asks the whitelist question — removing needs no permission`. Restore the conjunction and re-run; expected PASS.

- [ ] **Step 8: Measured mutation check — the endpoints temp file is always removed**

Delete both `rm -f` lines (the `rm -f "$tmp"` in `_models_endpoints`'s failure path and the `rm -f "$MODELS_ENDPOINTS_TMP"` after the answer). Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `leaves no endpoints temp file behind`. Restore both and re-run; expected PASS. (If `_plat_mktemp` honours `$TMPDIR` and the file lands outside `$HOME`, tighten the assertion to check `$TMPDIR` instead of `home`, and record which it was.)

- [ ] **Step 9: Measured mutation check — the class gate**

Change `_models_class_ok`'s loop to `return 0` unconditionally. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: three cases red — `refuses a class that is not one of the four, at exit 2, before node` under `set-class` (which now gets exit 1 and `unknown-class` from node), and the equivalents under `set-subagent` and `set-effort`. Restore and re-run; expected PASS.

- [ ] **Step 9b: Measured mutation check — `rm` takes no arguments**

In the `rm` arm, change `[ $# -eq 0 ] || _models_refuse unknown-argument 2 …` to `:`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `refuses an argument at exit 2`, under `ccrc models <id> rm`, which now runs the node op instead of refusing. Restore and re-run; expected PASS.

- [ ] **Step 10: Commit**

```bash
git add ccd/ccrc server/test/ccrc-models.test.ts
git commit -m "$(cat <<'MSG'
feat(ccrc): set-class, set-subagent, set-effort, discovery and rm

`discovery` names the set discovery and classification operate on, and it is
deliberately NOT the account-connections branch's `selectable`, which is a picker
PERMISSION: narrowing what an operator may pick must never narrow what the prober
classifies (spec §2, ruling 280). `set-subagent` is explicit: the class subagents
run as is a routing destination the operator sets, so it has a verb rather than a
derivation.

`discovery add` on an OpenRouter lane asks which providers serve the model and
refuses when none of them is ownership-whitelisted — the proxy injects that same
list as provider.only on every request, so a model no allowed provider serves is
a discovery entry that could never answer. The question is asked only on `add`,
only on that lane, and its answer is a temp file removed on every path.

A class typo is a usage error answered in bash, at exit 2, and "subagent" gets a
sentence of its own: it is a real field of the registry, and refusing it as
merely unknown would be a lie about this file's vocabulary.

`rm` (spec §4.1 Lifecycle, §11) is a reap and takes no arguments: it delegates
straight to the node op, idempotently, and works the same on an orphan id — one
the roster has no row for — as on a live lane, skipping only the settings step
that id has no configDirSuffix for.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: `ccrc models refresh [<id> | --all]`

**Files:**
- Modify: `ccd/ccrc` — `MODELS_BOX_SUBS`, a new `_models_box_sub` with its `refresh` arm, and a new `_models_refresh_one`
- Test: `server/test/ccrc-models.test.ts` (a new describe, and one expectation replaced)

**Interfaces:**
- Consumes: `deploy/models-op.mjs`'s `lanes` and `materialise` ops (Task 6); `ccd/ccrc-models-probe` (Tasks 4–5); `_models_node` / `_models_answer` / `_models_refuse` / `_models_roster_path` (Task 7).
- Produces: `ccrc models refresh [<id> | --all]` — probes one lane or every lane that HAS a registry (the probe kind lives in the registry file, so a lane without one has no probe to run), re-materialises each lane it refreshed, and prints one JSON object summarising the run: `{ok, op: "refresh", refreshed: rows}`, where a successful row is `{id, probe, ok: true, count}` and a failed row is `{id, probe, ok: false, reason}` (a lane whose registry itself does not parse/validate never reaches the probe at all, and is reported as `{id, ok: false, reason}` with no `probe`). Exit 0 when every probed lane succeeded, 1 when any failed (the others still ran), 2 usage. Task 10 adds the `litellm` subcommand and the "run it when the visible set changed" step; the timer in Task 11 calls `ccrc models refresh --all`.

- [ ] **Step 1: Replace Task 7's placeholder expectation and write the new tests**

In `server/test/ccrc-models.test.ts`, DELETE the case `a reserved word this build has no arm for yet says so, and does not read it as an id` — Task 7 wrote it to hold the grammar in force before an arm existed, and this task is the arm. Update the reserved-words source scan to also assert the implemented set:

```ts
  it('spells the implemented box-wide subcommands once, at file scope', () => {
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_BOX_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_BOX_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['refresh']);
  });
```

Then append:

```ts
describe('ccrc models refresh', () => {
  it('with no argument is a usage error naming both forms', () => {
    const r = run(['models', 'refresh']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('--all');
  });

  it('refreshes one lane and writes its catalogue', () => {
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['refreshed']).toEqual([{ id: 'gpt', probe: 'codex', ok: true, count: 9 }]);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
  });

  it('re-materialises the lane it refreshed, so the effort file tracks the new catalogue', () => {
    // Seeded with NO catalogue, so `effort.opus: max` was written unvalidated
    // and `effort.fable: max` was dropped for having no model. The refresh is
    // the run that first learns what the lane really offers.
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' } });
  });

  it('re-materialises the TSV too, so a RETIRED class is visible to ccd', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'gpt', 'set-class', 'sonnet', 'gpt-5.5-mini']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('sonnet\tgpt-5.5-mini\tretired\n');
  });

  it('--all probes every lane that HAS a registry, and no others', () => {
    // The probe kind lives in the registry file (round-2 ruling 10), so a lane
    // without one has no probe to run — asking would be a question with no
    // answer. `router` is initialised too, so this run is a MIXED result:
    // its normaliser refuses a Codex body.
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const refreshed = oneObject(r)['refreshed'] as { id: string }[];
    expect(refreshed.map((x) => x.id)).toEqual(['gpt', 'router']);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'claude-a.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'claude.json'))).toBe(false);
  });

  it('--all with NO registries anywhere is an empty, successful run', () => {
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['refreshed']).toEqual([]);
  });

  it('--all exits 1 when any lane failed, and still reports the ones that worked', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const rows = oneObject(r)['refreshed'] as { id: string; ok: boolean }[];
    expect(rows.find((x) => x.id === 'gpt')!.ok).toBe(true);
    expect(rows.find((x) => x.id === 'router')!.ok).toBe(false);
  });

  it('refuses an id the roster does not have', () => {
    const r = run(['models', 'refresh', 'ghost']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-lane');
  });

  it('refuses a lane with no registry, naming init', () => {
    const r = run(['models', 'refresh', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-lane');
    expect(String(oneObject(r)['detail'])).toMatch(/init/);
  });

  it('refuses an anthropic lane by name — there is nothing to probe (§5)', () => {
    const r = run(['models', 'refresh', 'claude-a']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes a compatible lane\'s baseUrl to the probe', () => {
    run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    const r = run(['models', 'refresh', 'router'], { CCRC_MODELS_PROBE_FIXTURE: COMPAT_RAW });
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'router.json'), 'utf8')).probe)
      .toBe('compatible');
  });

  it('a single-lane failure exits 1 and leaves the previous catalogue stale, not deleted', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: join(home, 'nope') });
    expect(r.code).toBe(1);
    const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.json'), 'utf8'));
    expect(cat.stale).toBe(true);
    expect(cat.models).toHaveLength(9);
  });

  it('takes one lane id or --all and nothing more', () => {
    const r = run(['models', 'refresh', 'gpt', '--all']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});
```

Add the one missing constant beside `CODEX_RAW` at the head of the file:

```ts
const COMPAT_RAW = join(here, 'fixtures', 'catalogues', 'compatible-raw.json');
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run test/ccrc-models.test.ts`
Expected: FAIL — the `MODELS_BOX_SUBS` scan reports an empty list, and every `models refresh` case gets exit 2 with `unknown-subcommand` because `MODELS_BOX_SUBS` is empty.

- [ ] **Step 3: Widen `MODELS_BOX_SUBS`**

```bash
MODELS_BOX_SUBS="refresh"
```

- [ ] **Step 4: Write `_models_refresh_one` and `_models_box_sub`**

In `ccd/ccrc`, immediately after `_models_lane_sub`, add:

```bash
_models_refresh_one() {   # <id> <probe> <baseUrl> -> 0 iff the probe wrote a fresh catalogue
  local probe="$CCRC_HERE/ccrc-models-probe" args=()
  [ -x "$probe" ] \
    || _models_refuse install-incomplete 1 "the model probe is missing or not executable: $probe — is this a complete ccrc install? Nothing was written."
  [ -z "$3" ] || args=(--base-url "$3")
  "$probe" "$1" "$2" ${args[@]+"${args[@]}"} >/dev/null
}

# The box-wide half of the verb group: the CATALOGUES the class registries are
# classified against, which is a different question from a lane's own classes
# and runs on a different cadence — a timer runs `--all` hourly
# (`deploy/systemd/ccrc-models.timer`), and the PWA's refresh button runs one
# lane. `ccgpt-usage.timer` is untouched: telemetry and catalogue are different
# questions on different cadences (§5).
_models_box_sub() {   # <subcommand> [args…]
  local sub="$1"; shift
  local file; file="$(_models_roster_path)"
  case "$sub" in
    refresh)
      local target="${1:-}"
      [ -n "$target" ] \
        || _models_refuse missing-argument 2 "ccrc models refresh needs a lane id or --all: ccrc models refresh <id> | --all"
      shift
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models refresh takes one lane id or --all, and got \"$1\""

      # THE LANE LIST COMES FROM THE ONE OP THAT KNOWS WHICH LANES HAVE A
      # REGISTRY AT ALL. An anthropic lane has none by design, and a lane
      # nobody has run `init` on has no PROBE KIND — round-2 ruling 10 puts
      # that on the registry file, so probing such a lane would be asking a
      # question with no answer.
      local lanes
      lanes="$(_models_answer lanes --file "$file")" || exit $?
      lanes="$(printf '%s' "$lanes" | jq -c '[.lanes[] | select(.hasRegistry)]')"

      local wanted="$lanes"
      if [ "$target" != "--all" ]; then
        wanted="$(printf '%s' "$lanes" | jq -c --arg id "$target" 'map(select(.id == $id))')"
        [ "$(printf '%s' "$wanted" | jq 'length')" -eq 1 ] \
          || _models_refuse no-such-lane 1 "\"$target\" is not a lane with a class registry on this box. Anthropic lanes have none — their four classes are Claude Code's own defaults, so there is nothing to probe. For any other lane run 'ccrc models $target init <${MODELS_PROBES// /|}>' first; 'ccrc status' lists the ids this box has. Nothing was written."
      fi

      local rows=() failed=0 n i id probe baseurl count ok
      n="$(printf '%s' "$wanted" | jq 'length')"
      i=0
      while [ "$i" -lt "$n" ]; do
        id="$(printf '%s' "$wanted" | jq -r ".[$i].id")"
        probe="$(printf '%s' "$wanted" | jq -r ".[$i].probe")"
        baseurl="$(printf '%s' "$wanted" | jq -r ".[$i].baseUrl // \"\"")"
        if _models_refresh_one "$id" "$probe" "$baseurl"; then
          ok=true
          # Re-materialise: the effort map is validated against the catalogue
          # (§4.1) and the TSV's third column is derived from it (§7), so a lane
          # whose catalogue just changed can have a lane default that has
          # stopped being offered and a class that has just been retired — and
          # the files ccd and the shim read have to learn that in the same run.
          _models_node materialise --file "$file" --id "$id" >/dev/null 2>&1 || true
          count="$(jq '.models | length' "$HOME/.ccrc/models/$id.json" 2>/dev/null || echo 0)"
        else
          ok=false; failed=1; count=0
        fi
        rows+=("$(jq -cn --arg id "$id" --arg p "$probe" --argjson ok "$ok" --argjson c "$count" \
          '{id:$id, probe:$p, ok:$ok, count:$c}')")
        i=$((i + 1))
      done

      # ONE JSON OBJECT, on every path — including the mixed one. A run where
      # three lanes refreshed and one did not is not a failure to report; it is
      # four facts, and the exit code says whether any of them was bad.
      printf '%s\n' "$(jq -cn --argjson rows "$(printf '%s\n' "${rows[@]+${rows[@]}}" | jq -cs 'map(select(. != null))')" \
        '{ok: ($rows | all(.ok)), op: "refresh", refreshed: $rows}')"
      [ "$failed" -eq 0 ] || return 1
      return 0
      ;;
    *) _models_refuse internal-no-arm 1 "ccrc models lists \"$sub\" as implemented and has no arm for it — this is a bug in ccrc, not a fact about your box, and nothing was written" ;;
  esac
}
```

Note the `map(select(. != null))` in the final `jq -cs`: with no rows at all, `printf '%s\n' ""` feeds one empty line to `jq -cs`, and this is what keeps `refreshed` an empty array rather than `[null]`.

- [ ] **Step 5: Extend the `models` usage paragraph**

The paragraph added in Task 7 already names `refresh`; no change is needed. Confirm with:

Run: `cd server && npx vitest run test/ccrc-cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/ccrc-models.test.ts test/ccrc-cli.test.ts`
Expected: PASS, both files.

- [ ] **Step 7: Measured mutation check — the lane list is the lanes with a registry**

Change `lanes="$(printf '%s' "$lanes" | jq -c '[.lanes[] | select(.hasRegistry)]')"` to `lanes="$(printf '%s' "$lanes" | jq -c '.lanes')"`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `refuses a lane with no registry, naming init`, which now reaches the probe with `probe: null` and answers something else. Restore and re-run; expected PASS.

- [ ] **Step 8: Measured mutation check — a mixed run still reports the successes**

Change the loop's `else ok=false; failed=1; count=0` to `else exit 1`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: two cases red — `--all exits 1 when any lane failed, and still reports the ones that worked` and `--all probes every lane that HAS a registry, and no others`, both failing in `oneObject` with `stdout carried 0 lines, not one`. Restore and re-run; expected PASS.

- [ ] **Step 9: Measured mutation check — refresh re-materialises**

Delete the `_models_node materialise …` line. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: two cases red — `re-materialises the lane it refreshed, so the effort file tracks the new catalogue` and `re-materialises the TSV too, so a RETIRED class is visible to ccd`. Restore and re-run; expected PASS.

- [ ] **Step 10: Measured mutation check — the baseUrl reaches the probe**

In `_models_refresh_one`, change `[ -z "$3" ] || args=(--base-url "$3")` to `args=()`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `passes a compatible lane's baseUrl to the probe`, which now fails at the probe's own `--base-url` gate. Restore and re-run; expected PASS.

- [ ] **Step 11: Commit**

```bash
git add ccd/ccrc server/test/ccrc-models.test.ts
git commit -m "$(cat <<'MSG'
feat(ccrc): models refresh, one lane or every lane that has a registry

The lane list comes from the one op that knows which lanes have a class registry
at all — and that is the same as knowing which have a PROBE KIND, because ruling
10 puts the probe on the registry file. An anthropic lane has none by design, and
a lane nobody has run init on has nothing to ask.

A mixed run is N facts and not a failure to report: every lane's result is in the
one JSON object, and the exit code says whether any of them was bad. Each
refreshed lane is re-materialised in the same run, because a catalogue that just
changed can have retired the effort level the shim is still being handed and the
class ccd is still routing to.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 10: LiteLLM's model list is generated — `ccrc models litellm <id>`

**Files:**
- Create: `shared/litellm.mjs`, `shared/litellm.d.mts`, `deploy/litellm-config.template.yaml`
- Create: `server/test/litellm-render.test.ts`
- Modify: `deploy/models-op.mjs` (a `litellm` op), `ccd/ccrc` (`MODELS_BOX_SUBS`, a `litellm` arm in `_models_box_sub`, the refresh loop's litellm step, and `usage()`'s `models` paragraph)
- Test: `server/test/litellm-render.test.ts`, `server/test/ccrc-models.test.ts`

**Interfaces:**
- Consumes: `parseCatalogue` shape from `shared/models.mjs` (Task 2); `readCatalogue`, `out`, `refuse`, `OPS`, `readPairs` in `deploy/models-op.mjs` (Task 6); `_models_box_sub`, `_models_answer`, `_models_roster_path` (Tasks 7, 9).
- Produces: `shared/litellm.mjs`'s `MODEL_LIST_MARKER`, `LitellmTemplateInvalid` and `renderLitellmConfig(templateText, catalogue)`; the `litellm` op; the verb `ccrc models litellm <id>`; and the refresh loop's per-lane `litellm` field (`rendered | unchanged | skipped` — fix round 1: a lane whose restart fails is a FAILED ROW, `{id, ok:false, reason}`, not a fourth `litellm` value).

- [ ] **Step 1: Write the template**

Create `deploy/litellm-config.template.yaml`:

```yaml
# LiteLLM proxy config — the GENERATED half is the model list; everything else
# here is carried verbatim into ~/.handoff/litellm-config.yaml by
# `ccrc models litellm <id>` (spec §6.3).
#
# DO NOT EDIT THE DEPLOYED COPY. Edit this file and re-run the verb; the
# generator overwrites ~/.handoff/litellm-config.yaml and keeps the previous
# bytes beside it as .prev.
#
# THERE ARE NO `reasoning` KEYS IN THIS FILE, and that is the whole point of
# regenerating it. Effort has exactly one owner — `ccgpt-proxy`, which sets
# `reasoning.effort` per request from the client's own `output_config.effort`
# or from the lane default in ~/.ccrc/models/<id>.effort.json (§6.4). A static
# `reasoning` here would put a second owner in the path and make
# config-versus-request precedence inside LiteLLM decide the answer, which is
# exactly why `/effort` in a gpt session changed nothing before this design.
#
# `mode: responses` is required by this provider, and it only parses STREAMED
# responses — a non-streaming probe fails with "Unknown items".
model_list:
# ccrc:model-list
litellm_settings:
  # The ChatGPT backend rejects max_tokens/metadata; drop unsupported params
  # instead of erroring, because Claude Code always sends max_tokens.
  drop_params: true

general_settings:
  # Local-only proxy on 127.0.0.1; the master key comes from the env at start.
  master_key: os.environ/LITELLM_MASTER_KEY
```

- [ ] **Step 2: Write the failing render test**

Create `server/test/litellm-render.test.ts`:

```ts
// §6.3 — LiteLLM's model list is generated from the lane's catalogue, and the
// rest of its config is carried verbatim from a template in `deploy/`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LitellmTemplateInvalid, MODEL_LIST_MARKER, renderLitellmConfig } from '../../shared/litellm.mjs';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const TEMPLATE = readFileSync(path.join(REPO, 'deploy', 'litellm-config.template.yaml'), 'utf8');

describe('the shipped template', () => {
  it('carries the marker exactly once, on its own line', () => {
    const lines = TEMPLATE.split('\n').filter((l) => l.trim() === MODEL_LIST_MARKER);
    expect(lines).toHaveLength(1);
  });

  it('carries NO reasoning key — effort has exactly one owner, the shim (§6.3)', () => {
    // A substring ban, so it covers prose as well as YAML: a comment naming a
    // `reasoning:` key is the first move of somebody adding one back.
    expect(TEMPLATE).not.toContain('reasoning:');
  });

  it('carries drop_params and the master key, which the generator must not invent', () => {
    expect(TEMPLATE).toContain('drop_params: true');
    expect(TEMPLATE).toContain('master_key: os.environ/LITELLM_MASTER_KEY');
  });
});

describe('renderLitellmConfig', () => {
  const rendered = (): string => renderLitellmConfig(TEMPLATE, CODEX);

  it('emits one entry per VISIBLE model and its [1m] alias, and nothing for hidden ones', () => {
    const out = rendered();
    for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']) {
      expect(out, id).toContain(`  - model_name: ${id}\n`);
      expect(out, `${id}[1m]`).toContain(`  - model_name: ${id}[1m]\n`);
      expect(out, id).toContain(`litellm_params: {model: chatgpt/${id}}`);
    }
    expect(out).not.toContain('gpt-reserve');
    expect(out).not.toContain('codex-auto-review');
  });

  it('is 14 entries for today\'s catalogue — seven visible, each twice', () => {
    expect(rendered().split('\n').filter((l) => l.startsWith('  - model_name: '))).toHaveLength(14);
  });

  it('gives every entry mode: responses — the provider requires it', () => {
    expect(rendered().split('\n').filter((l) => l.includes('model_info: {mode: responses}')))
      .toHaveLength(14);
  });

  it('emits NO reasoning key, for any model', () => {
    expect(rendered()).not.toContain('reasoning');
  });

  it('carries the template\'s other two blocks verbatim, in order', () => {
    const out = rendered();
    expect(out).toContain('litellm_settings:\n  # The ChatGPT backend rejects');
    expect(out).toContain('drop_params: true');
    expect(out).toContain('master_key: os.environ/LITELLM_MASTER_KEY');
    expect(out.indexOf('model_list:')).toBeLessThan(out.indexOf('litellm_settings:'));
    expect(out.indexOf('litellm_settings:')).toBeLessThan(out.indexOf('general_settings:'));
  });

  it('the marker line itself is gone from the output', () => {
    expect(rendered()).not.toContain(MODEL_LIST_MARKER);
  });

  it('is deterministic — the same catalogue renders the same bytes', () => {
    expect(rendered()).toBe(rendered());
  });

  it('refuses a template with no marker rather than appending to the end', () => {
    expect(() => renderLitellmConfig('model_list: []\n', CODEX)).toThrow(LitellmTemplateInvalid);
  });

  it('refuses a template with TWO markers — the destination must be unambiguous', () => {
    expect(() => renderLitellmConfig(`${MODEL_LIST_MARKER}\n${MODEL_LIST_MARKER}\n`, CODEX))
      .toThrow(LitellmTemplateInvalid);
  });

  it('refuses a catalogue with no visible models — a config with an empty list serves nothing', () => {
    const hiddenOnly = { ...CODEX, models: CODEX.models.map((m) => ({ ...m, hidden: true })) };
    expect(() => renderLitellmConfig(TEMPLATE, hiddenOnly)).toThrow(LitellmTemplateInvalid);
  });

  it('refuses a model id carrying a character YAML would reinterpret', () => {
    // The ids go into an unquoted YAML scalar. `:` followed by a space, `#`
    // preceded by a space, and a leading `-` all change what the line means.
    // A catalogue that carried one would produce a config LiteLLM parses into
    // something else, silently.
    const nasty = { ...CODEX, models: [{ ...CODEX.models[0]!, id: 'gpt: 6', hidden: false }] };
    expect(() => renderLitellmConfig(TEMPLATE, nasty)).toThrow(LitellmTemplateInvalid);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && npx vitest run test/litellm-render.test.ts`
Expected: FAIL with `Failed to resolve import "../../shared/litellm.mjs"`.

- [ ] **Step 4: Write `shared/litellm.mjs`**

```js
// shared/litellm.mjs — §6.3's renderer: a Codex catalogue plus the template in
// `deploy/` become `~/.handoff/litellm-config.yaml`.
//
// PURE, and that is why it is a module rather than a block of `ccrc`: the whole
// render can be measured without writing into `~/.handoff`, which is a live
// directory on the box this suite runs on.
//
// `.mjs` because its caller is `deploy/models-op.mjs`, under a bare `node`.
// It imports nothing at all.
//
// WHY THE MODEL LIST IS GENERATED. The shipped config drifted: measured
// 2026-09-08 it still listed `gpt-5.5-mini` and `gpt-5.4`, both gone from the
// account's catalogue, and lacked four of the nine models the backend
// advertises. A hand-kept list of somebody else's catalogue is a list that is
// wrong the day after it is written.

/** The one line the template reserves for the generated entries. Its own line,
 *  exactly once: a marker that appeared twice would make the destination
 *  ambiguous, and one that appeared nowhere would send the entries to the end
 *  of the file, past `general_settings`. Both are refusals. */
export const MODEL_LIST_MARKER = '# ccrc:model-list';

export class LitellmTemplateInvalid extends Error {
  constructor(message) { super(message); this.name = 'LitellmTemplateInvalid'; }
}

/** A model id safe to write as an UNQUOTED YAML scalar. `: ` opens a mapping,
 *  ` #` opens a comment and a leading `-` opens a sequence item — a catalogue
 *  carrying any of them would produce a config LiteLLM parses into something
 *  else, silently. Narrower than `shared/models.ts`'s MODEL_ID_RE, which every
 *  id in a catalogue already satisfies; this is the second gate, on the
 *  writer's side, because the catalogue is a generated file and a probe bug
 *  must not become a config bug. */
const YAML_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/;

/**
 * `(templateText: string, catalogue: Catalogue) => string`
 *
 * One `chatgpt/<id>` entry per VISIBLE model and one for its `[1m]` alias —
 * Claude Code appends that suffix to render a 1M context window and the backend
 * has no such name, so the suffixed name has to map back (`infra/handoff/
 * litellm-config.yaml`'s own note). Hidden models are excluded, matching what a
 * `"catalogue"` discovery list offers (§4.2, decision 6).
 *
 * NO `reasoning` KEY, for any model. Effort has exactly one owner — the shim
 * (§6.4) — so config-versus-request precedence inside LiteLLM never decides
 * anything.
 *
 * @throws {LitellmTemplateInvalid}
 */
export function renderLitellmConfig(templateText, catalogue) {
  const lines = templateText.split('\n');
  const at = lines.reduce((acc, l, i) => (l.trim() === MODEL_LIST_MARKER ? [...acc, i] : acc), []);
  if (at.length === 0) {
    throw new LitellmTemplateInvalid(
      `the template carries no ${MODEL_LIST_MARKER} line, so there is nowhere to put the generated `
      + 'model list — appending it to the end would put it past general_settings');
  }
  if (at.length > 1) {
    throw new LitellmTemplateInvalid(
      `the template carries ${at.length} ${MODEL_LIST_MARKER} lines; the destination must be one place`);
  }
  const visible = catalogue.models.filter((m) => !m.hidden);
  if (visible.length === 0) {
    throw new LitellmTemplateInvalid(
      'this catalogue has no visible models, and a LiteLLM config with an empty model_list serves '
      + 'nothing — the lane would 404 every request. Nothing was rendered.');
  }
  const entries = [];
  for (const m of visible) {
    if (!YAML_SAFE_ID.test(m.id)) {
      throw new LitellmTemplateInvalid(
        `model id ${JSON.stringify(m.id)} is not safe to write as an unquoted YAML scalar, so this `
        + 'catalogue cannot be rendered. Nothing was written.');
    }
    for (const name of [m.id, `${m.id}[1m]`]) {
      entries.push(`  - model_name: ${name}`);
      entries.push('    model_info: {mode: responses}');
      entries.push(`    litellm_params: {model: chatgpt/${m.id}}`);
    }
  }
  return [...lines.slice(0, at[0]), ...entries, ...lines.slice(at[0] + 1)].join('\n');
}
```

- [ ] **Step 5: Write `shared/litellm.d.mts`**

```ts
// shared/litellm.d.mts — hand-written, `shared/wrapper.d.mts`'s shape.
import type { Catalogue } from './models.js';

export declare const MODEL_LIST_MARKER: string;
export declare class LitellmTemplateInvalid extends Error {}
export declare function renderLitellmConfig(templateText: string, catalogue: Catalogue): string;
```

- [ ] **Step 6: Run the render test to verify it passes**

Run: `cd server && npx vitest run test/litellm-render.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 7: Measured mutation check — hidden models stay out of the config**

Change `const visible = catalogue.models.filter((m) => !m.hidden);` to `const visible = catalogue.models;`. Run `cd server && npx vitest run test/litellm-render.test.ts`.
Expected: two cases red — `emits one entry per VISIBLE model and its [1m] alias, and nothing for hidden ones` and `is 14 entries for today's catalogue — seven visible, each twice`. Restore and re-run; expected PASS.

- [ ] **Step 8: Measured mutation check — the YAML-safety gate**

Change `if (!YAML_SAFE_ID.test(m.id))` to `if (false)`. Run `cd server && npx vitest run test/litellm-render.test.ts`.
Expected: one case red — `refuses a model id carrying a character YAML would reinterpret`. Restore and re-run; expected PASS.

- [ ] **Step 9: Add the `litellm` op to `deploy/models-op.mjs`**

Add the import at the top:

```js
import { LitellmTemplateInvalid, renderLitellmConfig } from '../shared/litellm.mjs';
```

Add the row to `OPS`:

```js
  litellm: { keys: ['file', 'id', 'template', 'out'], required: ['file', 'id', 'template', 'out'] },
```

and add the arm in `main`, immediately after the `show` arm:

```js
  if (opName === 'litellm') {
    // §6.3. The DESTINATION and the TEMPLATE are both passed in rather than
    // resolved here, so this op can be measured against a fixture HOME and so
    // `ccd/ccrc` stays the one place that knows where a deployed box keeps its
    // LiteLLM config.
    //
    // It is the CODEX lane's, keyed on the registry's probe kind (round-2
    // ruling 10): rendering `chatgpt/<id>` entries from another provider's
    // catalogue would produce a config naming models the backend has never
    // heard of.
    if (registry === null || registry.probe !== 'codex') {
      return refuse(1, 'not-a-codex-lane',
        `account "${a.id}" has `
        + `${registry === null ? 'no class registry' : `probe "${registry.probe}"`}. The LiteLLM `
        + 'model list is the Codex lane\'s, and rendering it from another probe\'s catalogue would '
        + 'produce a config that names models the backend has never heard of.');
    }
    if (catalogue === null) {
      return refuse(1, 'never-probed',
        `account "${a.id}" has never been probed, so there is no catalogue to render a model list `
        + `from. Run 'ccrc models refresh ${a.id}' first. Nothing was written.`);
    }
    let text;
    try {
      text = renderLitellmConfig(readFileSync(a.template, 'utf8'), catalogue);
    } catch (e) {
      if (e instanceof LitellmTemplateInvalid) return refuse(1, 'template-invalid', e.message);
      return refuse(1, 'template-unreadable', `${a.template} could not be read: ${e.message}`);
    }
    let previous = null;
    try { previous = readFileSync(a.out, 'utf8'); } catch { previous = null; }
    if (previous === text) {
      out({ ok: true, op: 'litellm', id: a.id, path: a.out, changed: false });
      return 0;
    }
    try {
      mkdirSync(path.dirname(a.out), { recursive: true });
      // The PREVIOUS bytes are kept beside the new ones (§11): if LiteLLM will
      // not come back up on the rendering, the operator needs the config that
      // was working, and `ccrc doctor` needs something to compare against.
      if (previous !== null) writeFileSync(`${a.out}.prev`, previous, { mode: 0o600 });
      const tmp = `${a.out}.ccrc.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, a.out);
    } catch (e) {
      return refuse(1, 'config-unwritable', `${a.out} could not be written: ${e.message}`);
    }
    out({ ok: true, op: 'litellm', id: a.id, path: a.out, changed: true,
      models: catalogue.models.filter((m) => !m.hidden).length });
    return 0;
  }
```

- [ ] **Step 10: Write the failing verb tests**

Append to `server/test/ccrc-models.test.ts`, and widen the `MODELS_BOX_SUBS` source scan to `['litellm', 'refresh']`:

```ts
describe('ccrc models litellm', () => {
  const configPath = (): string => join(home, '.handoff', 'litellm-config.yaml');

  /** A `pgrep` that answers "LiteLLM is running" or "it is not", and records
   *  its argv — the probe `ccrc` uses to decide whether a restart is owed. */
  const pgrep = (running: boolean): void =>
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/pgrep-calls"\n${running ? 'echo 4242\nexit 0' : 'exit 1'}\n`,
      { mode: 0o755 });

  /** A `ccgpt` that records its argv instead of stopping a real proxy. */
  const ccgpt = (): void =>
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 0\n', { mode: 0o755 });

  const calls = (name: string): string[] => {
    const p = join(home, `${name}-calls`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  };

  beforeEach(() => {
    pgrep(false); ccgpt();
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    fs.rmSync(join(home, 'ccgpt-calls'), { force: true });
    fs.rmSync(configPath(), { force: true });
    fs.rmSync(`${configPath()}.prev`, { force: true });
  });

  it('renders the config from the lane\'s catalogue, with no reasoning key', () => {
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['changed']).toBe(true);
    const yaml = fs.readFileSync(configPath(), 'utf8');
    expect(yaml).not.toContain('reasoning');
    expect(yaml).toContain('  - model_name: gpt-6-astra');
    expect(yaml).toContain('  - model_name: gpt-6-astra[1m]');
    expect(yaml).not.toContain('gpt-reserve');
  });

  it('is idempotent — a second run reports changed:false and touches nothing', () => {
    run(['models', 'litellm', 'gpt']);
    const before = fs.statSync(configPath()).mtimeMs;
    const r = run(['models', 'litellm', 'gpt']);
    expect(oneObject(r)['changed']).toBe(false);
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
  });

  it('keeps the previous config beside the new one', () => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(configPath(), 'model_list: []\n');
    run(['models', 'litellm', 'gpt']);
    expect(fs.readFileSync(`${configPath()}.prev`, 'utf8')).toBe('model_list: []\n');
  });

  it('does NOT restart LiteLLM when it is not running', () => {
    run(['models', 'litellm', 'gpt']);
    expect(calls('ccgpt')).toEqual([]);
  });

  it('restarts LiteLLM when it IS running and the config changed, and says it did', () => {
    pgrep(true);
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    expect(calls('ccgpt')).toEqual(['stop']);
    expect(r.stderr).toMatch(/stopped the running LiteLLM proxy/);
  });

  it('does NOT restart when the config did not change, even if it is running', () => {
    run(['models', 'litellm', 'gpt']);
    pgrep(true);
    fs.rmSync(join(home, 'ccgpt-calls'), { force: true });
    run(['models', 'litellm', 'gpt']);
    expect(calls('ccgpt')).toEqual([]);
  });

  it('refuses a never-probed lane rather than rendering an empty list', () => {
    fs.rmSync(join(home, '.ccrc', 'models', 'gpt.json'));
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('never-probed');
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('refuses a lane whose probe is not codex', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'litellm', 'router']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('not-a-codex-lane');
  });

  it('needs an id', () => {
    expect(run(['models', 'litellm']).code).toBe(2);
  });
});

describe('refresh runs the litellm step for a codex lane (§5)', () => {
  const configPath = (): string => join(home, '.handoff', 'litellm-config.yaml');
  beforeEach(() => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('a first refresh of the gpt lane renders the config', () => {
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(fs.existsSync(configPath())).toBe(true);
    expect((oneObject(r)['refreshed'] as { litellm: string }[])[0]!.litellm).toBe('rendered');
  });

  it('a second refresh with the same catalogue leaves it alone', () => {
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = fs.statSync(configPath()).mtimeMs;
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
    expect((oneObject(r)['refreshed'] as { litellm: string }[])[0]!.litellm).toBe('unchanged');
  });

  it('a non-Codex lane\'s refresh never touches the LiteLLM config', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const orRaw = join(here, 'fixtures', 'catalogues', 'openrouter-raw-page.json');
    run(['models', 'refresh', 'router'], { CCRC_MODELS_PROBE_FIXTURE: orRaw });
    expect(fs.existsSync(configPath())).toBe(false);
  });
});
```

- [ ] **Step 11: Run to verify they fail**

Run: `cd server && npx vitest run test/ccrc-models.test.ts`
Expected: FAIL — every `models litellm` case gets exit 2 `unknown-subcommand`, and the three refresh cases fail because no config is rendered and `refreshed[0].litellm` is `undefined`.

- [ ] **Step 12: Add the `litellm` arm to `_models_box_sub`**

In `ccd/ccrc`, change `MODELS_BOX_SUBS="refresh"` to `MODELS_BOX_SUBS="refresh litellm"`, and add beside `_models_refresh_one`:

```bash
# Where a box keeps LiteLLM's config, and the template it is rendered from. The
# destination is the ONE thing `ccgpt` and this verb must agree about
# (`infra/handoff/ccgpt:20` reads `${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}`),
# so the same override is honoured here.
_models_litellm_path()     { printf '%s' "${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}"; }
_models_litellm_template() { printf '%s' "$CCRC_HERE/../deploy/litellm-config.template.yaml"; }

# "Is LiteLLM up against this config?" — `pgrep -f`, matching the argv `ccgpt`
# starts it with (`infra/handoff/ccgpt:95`: `litellm --config "$CONFIG" …`).
# NOT a port check: the port answering says something is listening, not that it
# is listening on THESE bytes, and the question here is exactly whether the
# process holds a config this run just replaced.
_models_litellm_running() { pgrep -f "litellm .*$(_models_litellm_path)" >/dev/null 2>&1; }

# STOP-THEN-WRITE (fix round 1, controller ruling): restart is owed only when
# BOTH halves are true — the bytes changed AND a proxy is holding the old
# ones — but deciding that and acting on it has to happen BEFORE the new
# bytes land on disk, or a stop that fails leaves the config already
# rewritten: the next run compares equal bytes, reports "unchanged", and
# never retries, while the box keeps serving the stale rendering with no
# operator signal. So this is TWO calls into the op: PHASE 1 asks it to
# render and compare only (no `--commit`, never writes); if a restart is
# owed and cannot be had, this function REFUSES here — `restart-failed`,
# nothing written — before PHASE 2 (`--commit true`, the write) is ever
# asked for, so the next run sees the same difference and retries. In-flight
# gpt turns fail once and retry (§6.3), which is a cost worth paying for a
# config that has changed and not one for a config that has not.
_models_litellm() {   # <accountId> -> prints exactly one JSON object: the op's final answer, or a refusal
  local file check crc
  file="$(_models_roster_path)"
  check="$(_models_answer litellm --file "$file" --id "$1" \
             --template "$(_models_litellm_template)" --out "$(_models_litellm_path)")"; crc=$?
  [ "$crc" -eq 0 ] || { printf '%s\n' "$check"; return "$crc"; }
  if [ "$(printf '%s' "$check" | jq -r '.changed')" != "true" ]; then
    printf '%s\n' "$check"
    return 0
  fi
  local restarted=false
  if _models_litellm_running; then
    if command -v ccgpt >/dev/null 2>&1 && ccgpt stop >/dev/null 2>&1; then
      restarted=true
      echo "$PROG: stopped the running LiteLLM proxy — it was holding the previous rendering; the next gpt session starts it again on the new one." >&2
    else
      _models_refuse restart-failed 1 "the LiteLLM proxy is running on the PREVIOUS config and could not be stopped. Run 'ccgpt stop' by hand, then re-run this command — until then this box serves the old model list. Nothing was written."
    fi
  fi
  local body
  body="$(_models_answer litellm --file "$file" --id "$1" \
            --template "$(_models_litellm_template)" --out "$(_models_litellm_path)" --commit true)"; crc=$?
  if [ "$crc" -eq 0 ]; then
    printf '%s\n' "$(printf '%s' "$body" | jq -c --argjson r "$restarted" '. + {restarted: $r}')"
  else
    printf '%s\n' "$body"
  fi
  return "$crc"
}
```

`deploy/models-op.mjs`'s `litellm` op gains an OPTIONAL `commit` key (`OPS.litellm.keys`, not `required`):
omitted or anything but the literal string `"true"` renders and reports `changed` WITHOUT writing;
`--commit true` performs the write (the `.prev` copy and the atomic rename, unchanged from Step 9).

and add the arm to `_models_box_sub`'s `case "$sub"`, before its `*)`:

```bash
    litellm)
      local id="${1:-}"
      [ -n "$id" ] || _models_refuse missing-argument 2 "ccrc models litellm needs a lane id: ccrc models litellm <id>"
      shift
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models litellm takes one lane id, and got \"$1\""
      _models_litellm "$id" || exit $?
      return 0
      ;;
```

- [ ] **Step 13: Hook the litellm step into the refresh loop**

In `_models_box_sub`'s refresh loop's `elif _models_refresh_one …` branch (kept as an `elif`, alongside
the pre-existing `reginvalid` and probe-failure branches — not collapsed into a single `ok` variable),
after the existing `materialise`/`count` lines, add the litellm step. Fix round 1 (controller ruling):
`_models_litellm` now REFUSES (stop-then-write, Step 12) rather than returning 1 after already printing
an `ok:true` body, so a lane whose restart fails becomes a FAILED ROW — `{id, ok:false, reason}`, same
shape as every other failed row in this loop — and `failed=1`, not a fourth `litellm` value:

```bash
          lit="skipped"
          local lreason=""
          if [ "$probe" = "codex" ]; then
            local lbody
            if lbody="$(_models_litellm "$id" 2>/dev/null)"; then
              [ "$(printf '%s' "$lbody" | tail -n1 | jq -r '.changed')" = "true" ] \
                && lit="rendered" || lit="unchanged"
            else
              lreason="$(printf '%s' "$lbody" | tail -n1 | jq -r '.detail')"
            fi
          fi
          if [ -n "$lreason" ]; then
            row="$(jq -cn --arg id "$id" --arg reason "$lreason" '{id:$id, ok:false, reason:$reason}')"
            failed=1
          else
            row="$(jq -cn --arg id "$id" --arg p "$probe" --argjson c "$count" --arg lit "$lit" \
              '{id:$id, probe:$p, ok:true, count:$c, litellm:$lit}')"
          fi
```

add `lit` to the loop's `local` declaration (`local rows=() failed=0 n i id probe baseurl count reginvalid
row lit`); the catalogue probe and materialise for this lane already succeeded and their effects stand —
only the litellm step's own refusal turns the row `ok:false`, via `.detail` off `_models_litellm`'s own
refusal body, the same `tail -n1` idiom the success path already uses.

The `refreshes one lane and writes its catalogue` case from Task 9 now expects the extra field; update its expectation to

```ts
    expect(b['refreshed']).toEqual([{ id: 'gpt', probe: 'codex', ok: true, count: 9, litellm: 'rendered' }]);
```

and give that case the `pgrep`/`ccgpt` stubs its `beforeEach` needs (copy the two `writeFileSync` lines from the describe above).

- [ ] **Step 14: Extend the `models` usage paragraph**

Append to the `models` paragraph in `usage()`:

```
            . "ccrc models litellm <id>" regenerates the Codex lane's
            LiteLLM model list from that catalogue — one entry per visible
            model and no reasoning keys, because effort has exactly one
            owner — and restarts the proxy only if it is holding the
            previous rendering
```

- [ ] **Step 15: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/ccrc-models.test.ts test/litellm-render.test.ts test/ccrc-cli.test.ts`
Expected: PASS, all three.

- [ ] **Step 16: Measured mutation check — the restart needs BOTH halves**

Change `if [ "$(printf '%s' "$body" | jq -r '.changed')" = "true" ] && _models_litellm_running; then` to `if _models_litellm_running; then`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `does NOT restart when the config did not change, even if it is running`. Then change it to `if [ "$(printf '%s' "$body" | jq -r '.changed')" = "true" ]; then` and re-run: expected one DIFFERENT case red — `does NOT restart LiteLLM when it is not running`. Restore the conjunction and re-run; expected PASS.

- [ ] **Step 17: Measured mutation check — the `.prev` copy**

Delete the `if (previous !== null) writeFileSync(`${a.out}.prev`, …)` line in `deploy/models-op.mjs`. Run `cd server && npx vitest run test/ccrc-models.test.ts`.
Expected: one case red — `keeps the previous config beside the new one`. Restore and re-run; expected PASS.

- [ ] **Step 18: Commit**

```bash
git add shared/litellm.mjs shared/litellm.d.mts deploy/litellm-config.template.yaml \
        deploy/models-op.mjs ccd/ccrc \
        server/test/litellm-render.test.ts server/test/ccrc-models.test.ts
git commit -m "$(cat <<'MSG'
feat(models): LiteLLM's model list is generated, and carries no reasoning key

The shipped config had drifted — it still listed two models the account no longer
has and lacked four of the nine it does — because a hand-kept copy of somebody
else's catalogue is wrong the day after it is written. It is now rendered from
the lane's own catalogue into a template that carries drop_params and the master
key verbatim, and the lane is chosen by the registry's PROBE KIND: only a codex
lane gets chatgpt/<id> entries.

No `reasoning` key, for any model: effort has exactly one owner, the shim, so
config-versus-request precedence inside LiteLLM never decides anything — which is
why /effort in a gpt session changed nothing before this design.

The proxy is restarted only when the bytes changed AND a process is holding the
old ones; the previous config is kept beside the new one for the case where it
will not come back up.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---
## Task 11: Ship it — the timer, the agent lane, and the deploy-verify pins

**Files:**
- Create: `deploy/systemd/ccrc-models.service`, `deploy/systemd/ccrc-models.timer`
- Modify: `deploy/deploy.sh` (the agent lane: one `install_atomic`, one `cp` in `AGENT_BUILD_CMD`, one `enable --now` in `AGENT_CMD`)
- Modify: `agent/test/deploy-verify.test.ts` (three pins, beside the cap-scopes and graph-sweep ones)
- Test: `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: `ccd/ccrc-models-probe` (Tasks 4–5) and `ccrc models refresh --all` (Tasks 9–10).
- Produces: a fleet host that carries `~/.local/bin/ccrc-models-probe` and runs `ccrc models refresh --all` hourly under `ccrc-models.timer`, enabled by the agent lane exactly as `ccd-cap-scopes.timer` is.
- **The plan ends before deploy. `deploy/deploy.sh` is never RUN here.**

- [ ] **Step 1: Write the failing pins**

In `agent/test/deploy-verify.test.ts`, in `the agent deploy installs every systemd artifact the fleet host actually runs`:

add to the repo-file list (after the graph-sweep pair at `:530-531`):

```ts
      // The model-class registry's catalogue timer (spec §5, §13.5), shipped
      // the same way and for the same reason: a repo that cannot reproduce its
      // own box is the defect the whole stage exists to close.
      'systemd/ccrc-models.service',
      'systemd/ccrc-models.timer',
```

add beside the two executable-existence assertions at `:535-538`:

```ts
    expect(existsSync(path.join(deployDir, '..', 'ccd', 'ccrc-models-probe')),
      'the model catalogue probe is not in the repo').toBe(true);
```

add to the `buildLinks` needle list (after the graph-sweep `cp` at `:557`):

```ts
      'cp ~/ccrc/deploy/systemd/ccrc-models.service ~/ccrc/deploy/systemd/ccrc-models.timer ~/.config/systemd/user/',
```

add after the `sweepTimerAt` assertions at `:576-577`:

```ts
    // A third timer, needing the same daemon-reload to have already picked up
    // the unit AGENT_BUILD_CMD installed.
    const modelsTimerAt = restartLinks.findIndex((l) => l.includes('enable --now ccrc-models.timer'));
    expect(modelsTimerAt, 'the models timer is never enabled').toBeGreaterThan(reloadAt);
```

and add beside the `install_atomic` assertions at `:592-595`:

```ts
    expect(deploySh).toContain('install_atomic ccd/ccrc-models-probe .local/bin/ccrc-models-probe 755');
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd agent && npx vitest run test/deploy-verify.test.ts`
Expected: FAIL — `systemd/ccrc-models.service is not in the repo`, then (after the units exist) the three `deploy.sh` assertions.

- [ ] **Step 3: Write the units**

`deploy/systemd/ccrc-models.service`:

```ini
[Unit]
Description=Refresh every lane's model catalogue (model-class registry, added 2026-09-08)
[Service]
Type=oneshot
# user units carry no ~/.local/bin on PATH (measured on the fleet host); ccgpt
# and litellm live only there, so the codex-lane step needs it spelled out.
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
# one probe per registered lane at --max-time 30, plus a codex render/restart;
# a multi-lane pass can outrun the 90s default and get SIGTERM'd mid-run
TimeoutStartSec=300
ExecStart=%h/.local/bin/ccrc models refresh --all
```

(Fix round 1, Finding 1 + Folded Minor B: `Environment=PATH=` and `TimeoutStartSec=300` were added
after the reviewer measured the fleet host's user-unit PATH directly — see the fix-round section at
the end of this task.)

`deploy/systemd/ccrc-models.timer`:

```ini
[Unit]
Description=Probe each provider's model catalogue hourly
[Timer]
OnBootSec=3min
OnUnitActiveSec=60min
AccuracySec=5min
[Install]
WantedBy=timers.target
```

The cadence is spec §5's and decision 3's: 60 minutes plus an on-demand button. `ccgpt-usage.timer` (20 min) is untouched — telemetry and catalogue are different questions on different cadences.

- [ ] **Step 4: Ship the probe on the agent lane**

In `deploy/deploy.sh`, beside `install_atomic ccd/ccd-graph-sweep .local/bin/ccd-graph-sweep 755` (`:640`), add:

```bash
  # The model-class registry's catalogue probe (spec §5), unconditional here
  # exactly as its two siblings above: the agent lane only ever ships to a
  # fleet host, so there is no server-role branch to gate it against. The
  # rsync of `ccd/` above ALSO lands it at ~/ccrc/ccd/, which is where the
  # verbs resolve it from; this copy is the one an operator can run by hand.
  install_atomic ccd/ccrc-models-probe .local/bin/ccrc-models-probe 755
```

(Fix round 1, Folded Minor A: the original comment's closing clause — "and the one the timer's
ExecStart reaches through the ccrc launcher" — was false. The launcher execs `~/ccrc/ccd/ccrc`,
`CCRC_HERE` resolves to `~/ccrc/ccd`, and the verbs run `$CCRC_HERE/ccrc-models-probe` — the rsync'd
copy, not this one. Deleted.)

- [ ] **Step 5: Install and enable the timer**

In `AGENT_BUILD_CMD`, after the graph-sweep `cp` line:

```
    && cp ~/ccrc/deploy/systemd/ccrc-models.service ~/ccrc/deploy/systemd/ccrc-models.timer ~/.config/systemd/user/'
```

(keep the closing quote on the last line of the chain; the graph-sweep line loses its closing quote and gains ` \`).

In `AGENT_CMD`, after `&& systemctl --user enable --now ccd-graph-sweep.timer \`:

```
    && systemctl --user enable --now ccrc-models.timer \
```

- [ ] **Step 6: Run the pins to verify they pass**

Run: `cd agent && npx vitest run test/deploy-verify.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 7: Verify the comment discipline the suite enforces**

Run: `grep -n "stamp_build\|install_ccrc_shim" deploy/deploy.sh | head`
Expected: the FIRST occurrence of each name is its real invocation, not a comment. The comment added in Step 4 deliberately names neither helper — `deploy.sh:604-612` and `:651-660` record that two `deploy-verify` assertions locate those calls with `indexOf(<name>, agentBranchStart)`, so an earlier prose mention shadows the invocation and makes the suite "prove" an ordering the shell never runs. If the grep shows a comment first, delete the name from your comment.

- [ ] **Step 8: Measured mutation check — the timer must be enabled after the reload**

In `AGENT_CMD`, move `&& systemctl --user enable --now ccrc-models.timer \` above `&& systemctl --user daemon-reload`. Run `cd agent && npx vitest run test/deploy-verify.test.ts`.
Expected: one case red — `the agent deploy installs every systemd artifact the fleet host actually runs`, on `the models timer is never enabled` / `expected 0 to be greater than 1`. Restore and re-run; expected PASS.

- [ ] **Step 9: Confirm nothing was run against the real box**

Run: `git diff --stat` and confirm the only changed files are `deploy/deploy.sh`, `agent/test/deploy-verify.test.ts` and the two new units. Then confirm no deploy happened:

```bash
git status --porcelain
```
Expected: only the four paths, `M`/`??`. **Do not run `deploy/deploy.sh` or any `systemctl` command in this task or anywhere in this plan.**

- [ ] **Step 10: Commit**

```bash
git add deploy/systemd/ccrc-models.service deploy/systemd/ccrc-models.timer \
        deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "$(cat <<'MSG'
feat(deploy): the fleet host carries the catalogue probe and refreshes hourly

A third timer beside cap-scopes and graph-sweep, installed in the build half and
enabled in the restart half after the daemon-reload that picks its unit up —
the ordering deploy-verify pins for the other two. `ccgpt-usage.timer` is
untouched: telemetry and catalogue are different questions on different cadences.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---


## Task 12: Register every new second reader in `single-definition.test.ts`

**Files:**
- Modify: `server/test/single-definition.test.ts` (one new describe)
- Test: `server/test/single-definition.test.ts`

**Interfaces:**
- Consumes: `holdersOf`, `codeLines`, `ALL`, `BASH`, `rel` as they already exist in that file (its "one bash reader of ~/.ccrc/build.json" describe is the idiom); the paths this plan gave readers and writers.
- Produces: nothing other tasks consume; Plans 2 and 3a EXTEND this describe — Plan 2's own task adds `'ccd/ccd'` to the `.ccrc/models` holder list (it becomes the second bash reader of `~/.ccrc/models/<id>.classes.tsv` and `<id>.json`) beside its agreement test, and Plan 3a's adds `'ccd/ccrc-doctor-checks'`. Both edits are steps in those plans; this task leaves the list at its measured two rows.

- [ ] **Step 1: Write the failing describe**

Append to `server/test/single-definition.test.ts`, after the `one ~/.ccrc/build.json …` describe:

```ts
// — The model-class registry (spec §4.1, §4.2, §6.1, §6.4, §7) —
describe('the model files, and who reads each one', () => {
  // FOUR paths, each with a writer and a set of readers, and the whole reason
  // to register them here is that they cross LANGUAGES: the catalogue is
  // written by bash-and-python and read by TypeScript; the TSV is written by
  // node and read (from Plan 2) by bash; the effort map is written by node and
  // read by python in another repository. None of those pairs can share a
  // constant, so agreement has to be a red suite instead.
  //
  // THIS DESCRIBE BUILDS ITS OWN CORPUS, and that is load-bearing. `ALL` comes
  // from `sources()`, which filters `/\.tsx?$/` — so `shared/models.mjs` and
  // `shared/modelenv.mjs` are invisible to it — and `deploy/` is not one of the
  // bash roots, so `deploy/models-op.mjs` is invisible to `BASH` too. A rule
  // about "who writes this file" run over either corpus alone would pass by
  // looking at nothing at all, which is this suite's own oldest lesson.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...walk(p)); continue; }
      if (/\.(tsx?|mjs|mts)$/.test(p)) out.push(p);
    }
    return out;
  };
  const MODELS_CORPUS = [...new Set([
    ...ALL, ...BASH,
    ...walk(path.join(ccrcRoot, 'shared')),
    ...walk(path.join(ccrcRoot, 'deploy')),
  ])];
  /** Comments stripped for bash, kept otherwise — `codeLines`' own rule, and
   *  the reason the probe (which says in a COMMENT that it never touches the
   *  registry) is not a holder of that path. */
  const codeOf = (f: string): string =>
    (BASH.includes(f) ? codeLines(f).join('\n') : readFileSync(f, 'utf8'));
  const spell = (needle: string): string[] =>
    MODELS_CORPUS.filter((f) => codeOf(f).includes(needle)).map(rel).sort();

  it('the corpus is real: it holds the four files this design added', () => {
    // Guards every row below: a corpus that had gone empty would make each of
    // them pass over nothing.
    const names = MODELS_CORPUS.map(rel);
    for (const f of ['shared/models.mjs', 'shared/modelenv.mjs',
      'deploy/models-op.mjs', 'ccd/ccrc-models-probe']) {
      expect(names, `${f} is outside the corpus this describe scans`).toContain(f);
    }
  });

  // THESE LISTS GROW WITH PLANS 2 AND 3a, deliberately and BY NAME — each of
  // those plans has a step that edits the rows below by hand:
  //   Plan 2 adds `'ccd/ccd'`               (the class carry's reader of the
  //     TSV's third column and of the catalogue), beside its agreement test.
  //   Plan 3a adds `'ccd/ccrc-doctor-checks'` (the doctor's per-lane check,
  //     which reads the catalogue and the settings block through the shipped
  //     `shared/models.mjs` / `shared/modelenv.mjs`).
  // So the settled end state of the first assertion is the four-row list
  //   ['ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-doctor-checks', 'ccd/ccrc-models-probe']
  // in `holdersOf`'s own sort order. It is left at TWO rows here on purpose:
  // an exact match that is widened by the plan that widens the code is the
  // guard; a list written ahead of the code is a list nobody measured. Turning
  // any row into a pattern would retire the guard outright.

  it('the models directory is spelled by exactly these bash tools', () => {
    expect(holdersOf('.ccrc/models')).toEqual([
      'ccd/ccrc',              // cmd_models and its helpers — the verbs
      'ccd/ccrc-models-probe', // the catalogue's writer
    ]);
  });

  it('the probe is the ONLY thing that writes a catalogue', () => {
    // A second writer is how a box would carry a catalogue no probe stands
    // behind — and `deriveModels` retires every model a catalogue omits, so a
    // wrong catalogue is a warning on every surface about models that answer
    // fine.
    const probe = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-models-probe'), 'utf8');
    expect(probe).toContain('mv -f "$NORM" "$OUT"');
    for (const f of ['ccd/ccrc', 'deploy/deploy.sh']) {
      const code = codeLines(path.join(ccrcRoot, f));
      expect(code.filter((l) => /\.ccrc\/models\/[^ ]*\.json/.test(l) && /(>|mv |cp |tee )/.test(l)),
        `${f} writes a catalogue directly instead of running the probe`).toEqual([]);
    }
  });

  it('the REGISTRY file is named by exactly two files, and edited by one of them', () => {
    // `<id>.classes.json` is the operator's own file (§4.1), edited only
    // through the verbs — so the verbs' node half is the one program that
    // writes it, and every write passes the validator. `shared/models.ts` names
    // the path in its header because that is where the type is defined; it
    // holds no fs call at all (it is L0 and imports nothing). A bash holder
    // would be a second, unvalidated editor of the same bytes.
    expect(spell('classes.json')).toEqual(['deploy/models-op.mjs', 'shared/models.ts']);
  });

  it('the LiteLLM config path is spelled once, in one tool, through one helper', () => {
    // `ccgpt` (another repository) reads the same path from its own
    // `${CCGPT_CONFIG:-…}` default, which is why the helper here honours the
    // same override rather than hardcoding the default: two tools, one file,
    // and only one of them is in this repo to be pinned.
    expect(holdersOf('.handoff/litellm-config.yaml')).toEqual(['ccd/ccrc']);
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    expect(code.filter((l) => l.includes('.handoff/litellm-config.yaml'))).toEqual([
      '_models_litellm_path()     { printf \'%s\' "${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}"; }',
    ]);
  });

  it('the ownership whitelist is read by exactly one thing in this repo', () => {
    // `handoff-proxy` and `claude-glm` read it too — in the monorepo, which
    // this scan cannot see. Within this repo it must stay one reader, because
    // a second one would be a second opinion about which providers may serve.
    expect(spell('providers-whitelist.json')).toEqual(['deploy/models-op.mjs']);
  });

  it('the four class names are enumerated only where a walk needs the sequence', () => {
    // A file may list all four ONLY if it walks them in order. Five do — the
    // TypeScript source, its bare-`node` twin, the materialiser, the verbs'
    // node half, and `ccd/ccrc` (whose bash walk is what answers a class typo
    // at exit 2). A sixth is a copy.
    const enumerates = (src: string): boolean =>
      ['haiku', 'sonnet', 'opus', 'fable'].every((c) =>
        new RegExp(`(?:'${c}'|"${c}"|(?<![\\w'-])${c}\\s*:|(?<![\\w-])${c}(?![\\w-]))`).test(src));
    const holders = MODELS_CORPUS.filter((f) => enumerates(codeOf(f))).map(rel).sort();
    expect(holders).toEqual([
      'ccd/ccrc',              // MODELS_CLASSES — the usage-error gate
      'deploy/models-op.mjs',  // CLASSES — the mutation walk
      'shared/modelenv.mjs',   // the env block's key order and the TSV's
      'shared/models.mjs',     // the twin's mirrored list
      'shared/models.ts',      // CLASSES — the definition, and FAMILY_TOKENS
    ]);
  });

  it('and the scan is looking at something — the four really are in the definition', () => {
    // Guards the guard: an `enumerates` that had gone vacuous would turn the
    // list above into every source in the tree.
    const src = readFileSync(path.join(ccrcRoot, 'shared/models.ts'), 'utf8');
    expect(src).toContain("export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;");
  });
});
```

- [ ] **Step 2: Run to verify it fails or, where it passes, that it passes for a reason**

Run: `cd server && npx vitest run test/single-definition.test.ts`
Expected: at least the class-enumeration case fails on its exact list — the `enumerates` predicate is deliberately loose (it matches a bare word too), so the measured holder list will differ from the one written above. **Do not loosen the assertion.** Run the case, read the actual list vitest prints, and reconcile it: for every file in the actual list that is NOT in the expected one, decide whether it is a legitimate walk (add it to the expected list WITH a trailing comment saying what walks there) or an accidental match (tighten the predicate's word-boundary arm until it stops matching prose). Record which you did in the task report.

Measured 2026-09-08 on `origin/main`, every name this describe borrows is a module-scope const of that file and is therefore in scope for an appended describe: `ccrcRoot` (:27), `ALL` (:58), `rel` (:59), `BASH` (:1139), `codeLines` (:1142), `holdersOf` (:1144), plus `readdirSync`/`statSync`/`readFileSync` and `path` from its imports. If any has been renamed since, use the file's own current spelling — this task adds a describe to an existing suite and must not introduce a second spelling of its helpers.

- [ ] **Step 3: Make it pass**

Apply the reconciliation from Step 2. Run: `cd server && npx vitest run test/single-definition.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 4: Measured mutation check — a second catalogue writer is caught**

In `ccd/ccrc`, add a line inside `_models_box_sub`'s refresh arm: `echo '{}' > "$HOME/.ccrc/models/$id.json"`. Run `cd server && npx vitest run test/single-definition.test.ts`.
Expected: one case red — `the probe is the ONLY thing that writes a catalogue`, naming `ccd/ccrc`. Remove the line and re-run; expected PASS.

- [ ] **Step 5: Measured mutation check — a second registry writer is caught**

In `ccd/ccrc`, add `: > "$HOME/.ccrc/models/$id.classes.json"` inside the same arm. Run `cd server && npx vitest run test/single-definition.test.ts`.
Expected: one case red — `the REGISTRY file is named by exactly two files, and edited by one of them`, reporting `[ 'ccd/ccrc', 'deploy/models-op.mjs', 'shared/models.ts' ]`. Remove the line and re-run; expected PASS.

- [ ] **Step 5b: Measured mutation check — the corpus really reaches `.mjs` and `deploy/`**

Change `MODELS_CORPUS` to `[...new Set([...ALL, ...BASH])]`. Run `cd server && npx vitest run test/single-definition.test.ts`.
Expected: three cases red — `the corpus is real: it holds the four files this design added`, `the REGISTRY file is named by exactly two files, and edited by one of them` (now `[ 'shared/models.ts' ]`), and `the ownership whitelist is read by exactly one thing in this repo` (now `[]`). Restore and re-run; expected PASS. (This is the mutation that makes the custom corpus load-bearing: over `ALL` alone, two of these rules pass by looking at nothing.)

- [ ] **Step 6: Measured mutation check — a second spelling of the LiteLLM path is caught**

In `ccd/ccrc`, change `_models_litellm_running`'s body to `pgrep -f "litellm .*$HOME/.handoff/litellm-config.yaml" >/dev/null 2>&1`. Run `cd server && npx vitest run test/single-definition.test.ts`.
Expected: one case red — `the LiteLLM config path is spelled once, in one tool, through one helper`, reporting two lines instead of one. Restore and re-run; expected PASS.

- [ ] **Step 7: Run the whole server and agent suites**

```bash
cd server && npx vitest run
cd ../agent && npx vitest run
```
Expected: both green. Anything red that this plan did not touch is a base-branch artifact — report it rather than patching around it.

- [ ] **Step 8: Commit**

```bash
git add server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
test(models): register every model file and who reads it

Five paths that cross languages — a catalogue written by bash-and-python and read
by TypeScript, a three-column TSV written by node and read by bash, an effort map
written by node and read by python in another repository. None of those pairs can
share a constant, so agreement is a red suite instead of a comment.

The registry file gets its own row: `<id>.classes.json` is the operator's, edited
only through the verbs, so exactly one program writes it and every write passes
the validator. A bash writer would be a second, unvalidated editor of those bytes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---
## Task 13: The effort shim — `ccgpt-proxy` maps effort onto Codex (MONOREPO)

**Files — all paths in Tasks 13–16 are relative to the MONOREPO root `/mnt/HC_Volume_105751470/projects/OpenClawHetzner`, not to the ccrc-pwa worktree:**
- Modify: `infra/handoff/ccgpt-proxy`
- Create: `infra/handoff/test_ccgpt_proxy.py`
- Branch: `feat/ccgpt-effort-shim`, cut from `main` in that checkout. **Never commit on `main`.**

**Interfaces:**
- Consumes: `~/.ccrc/models/<CCGPT_ACCOUNT_ID>.effort.json`, whose shape is `shared/modelenv.mjs`'s `effortFile` output — `{ "byModel": { "<modelId>": "<level>" } }` (defined in **Task 3**), written to disk by `deploy/models-op.mjs`'s `materialise` (**Task 6**), which every `ccrc models` mutation from Task 7 on calls on success.
- Produces: a shim that, for every `/v1/messages` body, sets `reasoning.effort` from the client's own `output_config.effort` when that is one of `low|medium|high|xhigh|max`, else from the lane default for the request's model, else not at all — and ALWAYS removes `output_config`. It reads `CCGPT_ACCOUNT_ID` (default `gpt`), which Task 14 makes the wrapper export.

- [ ] **Step 1: Create the branch**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
git status --porcelain
git checkout -b feat/ccgpt-effort-shim
git branch --show-current
```
Expected: `git status --porcelain` prints nothing (a clean tree at the start), then `feat/ccgpt-effort-shim`. If the tree is dirty, STOP and report — this task must not fold somebody else's work into its commit.

- [ ] **Step 2: Write the failing unittest**

Create `infra/handoff/test_ccgpt_proxy.py`:

```python
#!/usr/bin/env python3
"""Tests for ccgpt-proxy's effort mapping (model-class registry spec §6.4).

WHY THIS FILE EXISTS AT ALL. Until this change the shim only folded `system`,
and the reasoning effort was a STATIC `reasoning` object in each of
litellm-config.yaml's `litellm_params`. Measured 2026-09-08: Claude Code sends
its own effort with every request — the body carries
`output_config: {"effort": "high"}` and `thinking: {"type": "adaptive"}` under
the `effort-2025-11-24` beta header — and LiteLLM's `drop_params` discards it,
so the static config decided and `/effort xhigh` in a gpt session changed
nothing. The shim is now the ONE owner of that field, and the generated LiteLLM
config carries no `reasoning` key at all.

RUN IT:  python3 -m unittest infra.handoff.test_ccgpt_proxy   (from the repo root)
    or:  python3 infra/handoff/test_ccgpt_proxy.py

The module under test has a dash in its name and no `.py` suffix, so it is
loaded by path. Importing it is safe: the server only starts under
`if __name__ == "__main__"`.
"""
import importlib.util
import json
import os
import tempfile
import unittest
from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))
_loader = SourceFileLoader("ccgpt_proxy", os.path.join(HERE, "ccgpt-proxy"))
_spec = importlib.util.spec_from_loader(_loader.name, _loader)
proxy = importlib.util.module_from_spec(_spec)
_loader.exec_module(proxy)


class EffortBase(unittest.TestCase):
    """Every case runs against a throwaway HOME. The shim resolves its effort
    file under `~`, and the real one on this box is the operator's."""

    def setUp(self):
        self._home = tempfile.mkdtemp(prefix="ccgpt-proxy-test-")
        self._saved = {k: os.environ.get(k) for k in ("HOME", "CCGPT_ACCOUNT_ID")}
        os.environ["HOME"] = self._home
        os.environ.pop("CCGPT_ACCOUNT_ID", None)
        # The cache is module state; a stale entry from a previous case would
        # make these tests order-dependent.
        proxy._effort_cache["key"] = None
        proxy._effort_cache["byModel"] = {}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def write_effort(self, by_model, account="gpt"):
        d = os.path.join(self._home, ".ccrc", "models")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, account + ".effort.json")
        with open(p, "w") as f:
            json.dump({"byModel": by_model}, f)
        return p


class TestClientEffort(EffortBase):
    def test_each_level_passes_through_unchanged(self):
        # low|medium|high|xhigh|max are all Codex levels (§6.4).
        for level in ("low", "medium", "high", "xhigh", "max"):
            body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                        "output_config": {"effort": level}})
            self.assertEqual(body["reasoning"], {"effort": level}, level)

    def test_output_config_is_always_removed(self):
        body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                    "output_config": {"effort": "high"}})
        self.assertNotIn("output_config", body)

    def test_output_config_is_removed_even_when_it_decides_nothing(self):
        body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                    "output_config": {"effort": "auto"}})
        self.assertNotIn("output_config", body)

    def test_the_client_wins_over_the_lane_default(self):
        self.write_effort({"gpt-5.6-sol": "max"})
        body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                    "output_config": {"effort": "low"}})
        self.assertEqual(body["reasoning"], {"effort": "low"})

    def test_auto_falls_through_to_the_lane_default(self):
        self.write_effort({"gpt-5.6-sol": "max"})
        body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                    "output_config": {"effort": "auto"}})
        self.assertEqual(body["reasoning"], {"effort": "max"})

    def test_ultra_from_a_client_is_not_honoured(self):
        # `ultra` is a Codex level ABOVE max and is reachable as a LANE default
        # only: the client's enum has no such level, so a body claiming one did
        # not come from the picker and must not be trusted into the request.
        self.write_effort({"gpt-5.6-sol": "high"})
        body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                    "output_config": {"effort": "ultra"}})
        self.assertEqual(body["reasoning"], {"effort": "high"})

    def test_a_non_string_effort_is_ignored(self):
        body = proxy._apply_effort({"model": "gpt-5.6-sol",
                                    "output_config": {"effort": 7}})
        self.assertNotIn("reasoning", body)


class TestLaneDefault(EffortBase):
    def test_absent_output_config_uses_the_lane_default(self):
        self.write_effort({"gpt-5.6-terra": "high"})
        body = proxy._apply_effort({"model": "gpt-5.6-terra"})
        self.assertEqual(body["reasoning"], {"effort": "high"})

    def test_no_default_for_this_model_means_no_field_at_all(self):
        # …and the provider's own default then applies (§6.4).
        self.write_effort({"gpt-5.6-terra": "high"})
        body = proxy._apply_effort({"model": "gpt-5.6-luna"})
        self.assertNotIn("reasoning", body)

    def test_no_effort_file_at_all_means_no_field(self):
        body = proxy._apply_effort({"model": "gpt-5.6-sol"})
        self.assertNotIn("reasoning", body)

    def test_the_1m_alias_resolves_to_the_bare_model(self):
        # Claude Code appends `[1m]` and LiteLLM's config maps the suffixed name
        # back to the same backend model; the effort file is keyed on bare ids,
        # so the lookup has to strip it or every aliased request loses its
        # lane default silently.
        self.write_effort({"gpt-5.6-sol": "max"})
        body = proxy._apply_effort({"model": "gpt-5.6-sol[1m]"})
        self.assertEqual(body["reasoning"], {"effort": "max"})

    def test_the_account_id_comes_from_the_environment(self):
        self.write_effort({"m": "max"}, account="other")
        os.environ["CCGPT_ACCOUNT_ID"] = "other"
        body = proxy._apply_effort({"model": "m"})
        self.assertEqual(body["reasoning"], {"effort": "max"})

    def test_a_malformed_effort_file_is_ignored_rather_than_fatal(self):
        d = os.path.join(self._home, ".ccrc", "models")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "gpt.effort.json"), "w") as f:
            f.write("{ not json")
        body = proxy._apply_effort({"model": "gpt-5.6-sol"})
        self.assertNotIn("reasoning", body)

    def test_a_byModel_that_is_not_an_object_is_ignored(self):
        d = os.path.join(self._home, ".ccrc", "models")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "gpt.effort.json"), "w") as f:
            json.dump({"byModel": []}, f)
        body = proxy._apply_effort({"model": "gpt-5.6-sol"})
        self.assertNotIn("reasoning", body)

    def test_the_file_is_re_read_when_its_mtime_moves(self):
        # The materialiser rewrites it on every roster edit, and the shim is a
        # long-lived process: a cache that never noticed would serve the effort
        # the lane had at boot for ever.
        p = self.write_effort({"gpt-5.6-sol": "high"})
        self.assertEqual(proxy._apply_effort({"model": "gpt-5.6-sol"})["reasoning"],
                         {"effort": "high"})
        with open(p, "w") as f:
            json.dump({"byModel": {"gpt-5.6-sol": "max"}}, f)
        st = os.stat(p)
        os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
        self.assertEqual(proxy._apply_effort({"model": "gpt-5.6-sol"})["reasoning"],
                         {"effort": "max"})

    def test_a_deleted_effort_file_clears_the_cache(self):
        p = self.write_effort({"gpt-5.6-sol": "high"})
        proxy._apply_effort({"model": "gpt-5.6-sol"})
        os.remove(p)
        body = proxy._apply_effort({"model": "gpt-5.6-sol"})
        self.assertNotIn("reasoning", body)


class TestFoldingStillWorks(EffortBase):
    """The shim's original job — the Codex backend REJECTS system messages, and
    Claude Code delivers its whole behaviour spec in the top-level `system`
    field. None of that may change."""

    def test_system_is_folded_into_a_leading_user_turn(self):
        body = proxy._fold_system({"system": "be good",
                                   "messages": [{"role": "user", "content": "hi"}]})
        self.assertNotIn("system", body)
        self.assertEqual(body["messages"][0]["content"], "be good\n\nhi")

    def test_system_as_content_blocks_is_joined(self):
        body = proxy._fold_system({"system": [{"type": "text", "text": "a"},
                                              {"type": "text", "text": "b"}],
                                   "messages": []})
        self.assertEqual(body["messages"][0]["content"], "a\n\nb")

    def test_folding_and_effort_compose(self):
        self.write_effort({"gpt-5.6-sol": "max"})
        data = proxy._apply_effort(proxy._fold_system(
            {"system": "be good", "model": "gpt-5.6-sol",
             "messages": [{"role": "user", "content": "hi"}]}))
        self.assertNotIn("system", data)
        self.assertNotIn("output_config", data)
        self.assertEqual(data["reasoning"], {"effort": "max"})
        self.assertEqual(data["messages"][0]["content"], "be good\n\nhi")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it to verify it fails**

```bash
python3 infra/handoff/test_ccgpt_proxy.py
```
Expected: FAIL — `AttributeError: module 'ccgpt_proxy' has no attribute '_effort_cache'` at `setUp`, so every case errors. The `TestFoldingStillWorks` cases would pass on their own; they are here as the negative control that this change does not move the shim's original job.

- [ ] **Step 4: Add the effort mapping to `infra/handoff/ccgpt-proxy`**

Extend the module docstring's second paragraph:

```
It also owns the REASONING EFFORT (model-class registry spec §6.4). Measured
2026-09-08: Claude Code sends `output_config: {"effort": …}` with every request
under the `effort-2025-11-24` beta header, and LiteLLM's `drop_params` discards
it — so before this change a static `reasoning` object in litellm-config.yaml
decided, and `/effort xhigh` in a gpt session changed nothing. Now the client's
own level wins, the lane's default (from ~/.ccrc/models/<account>.effort.json,
written by ccrc's materialiser) fills in when it names none, and the generated
LiteLLM config carries no `reasoning` key at all — one owner, no precedence
question.
```

After the `HOP` set, add:

```python
# The five levels Claude Code's own enum can produce, and the five Codex
# accepts unchanged. `ultra` is deliberately NOT here: it is a Codex level
# above `max` and is reachable as a LANE DEFAULT only, because the client's
# enum has no such level — a request body claiming one did not come from the
# picker.
EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")


def _effort_path():
    """The lane's default-effort map, written by ccrc's materialiser. Resolved
    per call rather than at import: the account id is an environment variable
    the wrapper exports, and a long-lived shim must not pin `~` at boot."""
    account = os.environ.get("CCGPT_ACCOUNT_ID", "gpt")
    return os.path.join(os.path.expanduser("~"), ".ccrc", "models", account + ".effort.json")


# Keyed on (path, mtime_ns) so the map is re-read when the materialiser rewrites
# it — this process outlives many roster edits, and a cache that never noticed
# would serve the effort the lane had at boot for ever. The PATH is part of the
# key because the account id can change under us.
_effort_cache = {"key": None, "byModel": {}}


def _effort_map():
    path = _effort_path()
    try:
        key = (path, os.stat(path).st_mtime_ns)
    except OSError:
        # Absent is a normal state: a lane nobody has classified yet, and the
        # provider's own default then applies.
        _effort_cache["key"] = None
        _effort_cache["byModel"] = {}
        return {}
    if _effort_cache["key"] != key:
        try:
            with open(path) as f:
                data = json.load(f)
            by = data.get("byModel")
            _effort_cache["byModel"] = by if isinstance(by, dict) else {}
        except (OSError, ValueError):
            # A malformed generated file must not take the lane down: every
            # request would fail, for a fact about a cache.
            _effort_cache["byModel"] = {}
        _effort_cache["key"] = key
    return _effort_cache["byModel"]


def _base_model(name):
    """`gpt-5.6-sol[1m]` -> `gpt-5.6-sol`. Claude Code appends the suffix to
    render a 1M context window and LiteLLM's config maps the suffixed name back
    to the same backend model; the effort map is keyed on bare ids, so without
    this every aliased request would lose its lane default silently."""
    if isinstance(name, str) and name.endswith("[1m]"):
        return name[:-4]
    return name


def _apply_effort(data):
    """Set `reasoning.effort` and drop `output_config` (spec §6.4).

    Three arms, in order: the client's own level when it is one Codex takes;
    else the lane's default for this model; else nothing at all, and the
    provider's default applies. `output_config` is removed on every one of them
    — it is an Anthropic-shaped field the Codex backend has no use for, and
    leaving it would depend on LiteLLM's drop_params to hide it.
    """
    oc = data.pop("output_config", None)
    eff = oc.get("effort") if isinstance(oc, dict) else None
    if isinstance(eff, str) and eff in EFFORT_LEVELS:
        data["reasoning"] = {"effort": eff}
        return data
    lane = _effort_map().get(_base_model(data.get("model")))
    if isinstance(lane, str) and lane:
        data["reasoning"] = {"effort": lane}
    return data
```

and replace the body-rewriting block inside `_relay`:

```python
        if body and path_only.endswith("/messages"):
            try:
                data = json.loads(body)
                if isinstance(data, dict):
                    # BOTH transforms now, and unconditionally: the effort arm
                    # has to run on a body with no `system` too, which is every
                    # turn after the first in a session.
                    if "system" in data:
                        data = _fold_system(data)
                    body = json.dumps(_apply_effort(data)).encode()
            except ValueError:
                pass  # forward as-is if not JSON
```

- [ ] **Step 5: Run the unittest to verify it passes**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 infra/handoff/test_ccgpt_proxy.py -v
```
Expected: `OK`, with 20 tests run and none skipped.

- [ ] **Step 6: Measured mutation check — the client wins over the lane default**

Swap the two arms of `_apply_effort`: move the `lane = …` lookup above the `if isinstance(eff, str) …` check and return on it first. Run the unittest.
Expected: two cases red — `test_the_client_wins_over_the_lane_default` and `test_each_level_passes_through_unchanged` (the latter only for models with a default; if it stays green, that is the measurement — record it and rely on the first). Restore and re-run; expected `OK`.

- [ ] **Step 7: Measured mutation check — `ultra` is not honoured from a client**

Add `"ultra"` to `EFFORT_LEVELS`. Run the unittest.
Expected: one case red — `test_ultra_from_a_client_is_not_honoured`. Restore and re-run; expected `OK`.

- [ ] **Step 8: Measured mutation check — the `[1m]` alias**

Change `_base_model` to `return name`. Run the unittest.
Expected: one case red — `test_the_1m_alias_resolves_to_the_bare_model`. Restore and re-run; expected `OK`.

- [ ] **Step 9: Measured mutation check — the cache notices an edit**

Change `_effort_cache`'s key comparison to `if _effort_cache["key"] is None:`. Run the unittest.
Expected: one case red — `test_the_file_is_re_read_when_its_mtime_moves`. Restore and re-run; expected `OK`.

- [ ] **Step 10: Confirm the shim still parses and starts nothing on import**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 -c "
import importlib.util
from importlib.machinery import SourceFileLoader
l = SourceFileLoader('p', 'infra/handoff/ccgpt-proxy')
m = importlib.util.module_from_spec(importlib.util.spec_from_loader('p', l))
l.exec_module(m)
print('imported, no server started')"
```
Expected: `imported, no server started`, and the command returns immediately (it must not block on `serve_forever`).

- [ ] **Step 11: Commit (monorepo)**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
git add infra/handoff/ccgpt-proxy infra/handoff/test_ccgpt_proxy.py
git commit -m "$(cat <<'MSG'
feat(handoff): the shim owns the reasoning effort, so /effort finally does something

Claude Code sends output_config.effort with every request and LiteLLM's
drop_params discards it, so until now a static `reasoning` object in
litellm-config.yaml decided and /effort xhigh in a gpt session changed nothing.
The shim now sets reasoning.effort from the client's own level, or from the
lane's default in ~/.ccrc/models/<account>.effort.json, or not at all — and
always removes output_config.

`ultra` is a Codex level above max and stays a LANE DEFAULT only: the client's
enum has no such level, so a body claiming one did not come from the picker.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 14: `ccgpt` exports its account id and stops deciding models (MONOREPO)

**Files:**
- Modify: `infra/handoff/ccgpt` (lines 105–138 of the file as measured at `main`)
- Test: `infra/handoff/test_ccgpt_proxy.py` (a new class, source assertions over the wrapper)

**Interfaces:**
- Consumes: the shim's `CCGPT_ACCOUNT_ID` (Task 13).
- Produces: a wrapper that exports `CCGPT_ACCOUNT_ID` and no longer exports `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL` (§6.2). It keeps `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, the telemetry flags and the whole LiteLLM lifecycle.

**IMPORTANT — sequencing:** this file is NOT installed to `~/.local/bin` by this plan. The exports may only be dropped once the lane's `settings.json` carries the materialised env block (§13.3, "never earlier"); until then the lane would have no model at all. Task 16 stages, and Task 17's runbook installs, in the right order.

- [ ] **Step 1: Write the failing source assertions**

Append to `infra/handoff/test_ccgpt_proxy.py`:

```python
class TestWrappersStoppedDecidingModels(unittest.TestCase):
    """§6.2 — the lane's settings.json `env` block wins over a shell export for
    the same variable (probed 2026-09-08: project settings `probe-settings` vs
    exported `probe-shell-env` -> the request left as `probe-settings`), so the
    wrappers' own model exports became dead code that misleads the next reader
    about where a model comes from.

    Source assertions, not behaviour: these are bash scripts that exec Claude
    Code, and running one is exactly what a test may not do."""

    def _src(self, name):
        with open(os.path.join(HERE, name)) as f:
            return f.read()

    def _export_lines(self, name):
        return [l.strip() for l in self._src(name).splitlines()
                if l.strip().startswith("export ")]

    GONE = ("ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL")

    def test_ccgpt_exports_no_model_variable(self):
        for line in self._export_lines("ccgpt"):
            for var in self.GONE:
                self.assertFalse(line.startswith("export " + var + "="),
                                 "ccgpt still exports %s: %s" % (var, line))

    def test_ccgpt_exports_the_account_id_the_shim_reads(self):
        self.assertIn('export CCGPT_ACCOUNT_ID="${CCGPT_ACCOUNT_ID:-gpt}"',
                      self._src("ccgpt"))

    def test_ccgpt_keeps_the_four_things_it_still_owns(self):
        # The endpoint, the local master key, the config dir and the telemetry
        # flags are the lane's own and have nothing to do with model choice.
        src = self._src("ccgpt")
        for needle in ('export ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT"',
                       'export ANTHROPIC_AUTH_TOKEN="$LITELLM_MASTER_KEY"',
                       'export CLAUDE_CONFIG_DIR="$HOME/.claude-gpt"',
                       "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
                       "export DISABLE_TELEMETRY=1"):
            self.assertIn(needle, src)

    def test_ccgpt_keeps_the_litellm_lifecycle(self):
        src = self._src("ccgpt")
        for needle in ("ccgpt login", "_wait_port", "$LITELLM_BIN", "_sync_gpt_config"):
            self.assertIn(needle, src)

    def test_ccgpt_no_longer_names_a_concrete_model_in_a_default(self):
        # `${CCGPT_MODEL:-gpt-5.6-sol}` and its two siblings were the wrapper
        # deciding the lane's classes. The roster decides now.
        src = self._src("ccgpt")
        for needle in ("CCGPT_MODEL:-", "CCGPT_SONNET_MODEL:-", "CCGPT_SMALL_MODEL:-"):
            self.assertNotIn(needle, src)

    def test_claude_glm_exports_no_model_variable(self):
        for line in self._export_lines("claude-glm"):
            for var in self.GONE:
                self.assertFalse(line.startswith("export " + var + "="),
                                 "claude-glm still exports %s: %s" % (var, line))

    def test_ccgpt_usage_is_untouched_by_this_change(self):
        # It answers a DIFFERENT question on a different cadence (telemetry, not
        # catalogue), and nothing in this design gives it a reason to change.
        src = self._src("ccgpt-usage")
        self.assertIn("x-codex-primary-used-percent", src)
        self.assertNotIn("CCGPT_ACCOUNT_ID", src)
        self.assertNotIn("effort", src)
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 infra/handoff/test_ccgpt_proxy.py -v 2>&1 | tail -20
```
Expected: FAIL — `test_ccgpt_exports_no_model_variable` ("ccgpt still exports ANTHROPIC_MODEL"), `test_ccgpt_exports_the_account_id_the_shim_reads`, `test_ccgpt_no_longer_names_a_concrete_model_in_a_default` and `test_claude_glm_exports_no_model_variable`. `test_ccgpt_usage_is_untouched_by_this_change` and the two "keeps" cases pass already, which is what makes them a control.

- [ ] **Step 3: Edit `infra/handoff/ccgpt`**

Replace lines 105–138 (the tier-mapping comment block, the three `model=`/`sonnet=`/`small=` assignments and the six exports) with:

```bash
# THE LANE'S MODELS ARE NOT DECIDED HERE ANY MORE (model-class registry §6.2).
# They live in the roster's class registry for this account and reach Claude
# Code through the `env` block ccrc materialises into
# ~/.claude-gpt/settings.json — which BEATS a shell export for the same
# variable (probed 2026-09-08: project settings `probe-settings` against an
# exported `probe-shell-env`, and the request left as `probe-settings`). The
# exports this block used to carry were therefore already dead, and dead code
# that names a model is worse than none: it tells the next reader the wrapper
# decides, and the wrapper has not decided since the block landed.
#
# `_sync_gpt_config` above mirrors an allow-list of keys and NEVER removes the
# lane's own, so that block survives every launch — which is why this works at
# all. To change what this lane routes where:
#     ccrc models gpt show
#     ccrc models gpt set-class fable gpt-6-astra
#
# WHAT STAYS, and why each: the endpoint and the local master key (this lane
# talks to the shim on loopback, not to Anthropic), the config dir (the lane's
# identity), and the two telemetry flags. None of them is a model choice.
#
# THE [1m] SUFFIX IS STILL A LIE ON THIS LANE, and the reason is worth keeping:
# Claude Code reads it as "this model has a 1M context window" and sizes its
# auto-compaction against it, so a session sat at a comfortable-looking "ctx
# 37%" while one turn from the wall, then every request 400'd — including
# /compact, which has to send the whole conversation to summarise it. Dead end
# with no way out but /clear (measured 2026-07-26). On the ChatGPT-subscription
# surface these models' max_context_window equals their context_window, so
# there is nothing to opt into; the catalogue carries both numbers now
# (~/.ccrc/models/gpt.json) and that is where to check before ever changing it.
export CLAUDE_CONFIG_DIR="$HOME/.claude-gpt"
_sync_gpt_config "$CLAUDE_CONFIG_DIR"   # faithful-peer: plugins, statusbar, hooks & UX from the primary config
export ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT"
export ANTHROPIC_AUTH_TOKEN="$LITELLM_MASTER_KEY"
# Which roster account this lane IS, for the shim: it reads this lane's default
# efforts from ~/.ccrc/models/$CCGPT_ACCOUNT_ID.effort.json (§6.4). Overridable
# so a second Codex lane is a matter of one variable rather than a second file.
export CCGPT_ACCOUNT_ID="${CCGPT_ACCOUNT_ID:-gpt}"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export DISABLE_TELEMETRY=1
```

Leave lines 1–104 and the final `exec "$HOME/.local/bin/claude" "$@"` untouched.

- [ ] **Step 4: Check the wrapper still parses**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && bash -n infra/handoff/ccgpt && echo "ccgpt parses"
```
Expected: `ccgpt parses`. **Do not RUN `ccgpt`** — it would start LiteLLM and a Claude Code session against the real HOME.

- [ ] **Step 5: Run the tests**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 infra/handoff/test_ccgpt_proxy.py -v 2>&1 | tail -20
```
Expected: every case in `TestWrappersStoppedDecidingModels` passes except `test_claude_glm_exports_no_model_variable`, which is Task 15's.

- [ ] **Step 6: Measured mutation check — the export scan really scans**

Add `export ANTHROPIC_MODEL="gpt-5.6-sol"` back at the end of the block. Run the tests.
Expected: one case red — `test_ccgpt_exports_no_model_variable`, naming the line. Remove it and re-run; expected the same result as Step 5.

- [ ] **Step 7: Commit (monorepo)**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
git add infra/handoff/ccgpt infra/handoff/test_ccgpt_proxy.py
git commit -m "$(cat <<'MSG'
feat(handoff): ccgpt stops naming models, and says which account it is

The lane's settings.json env block beats a shell export for the same variable,
so these six exports have been dead since ccrc started writing that block — and
dead code that names a model is worse than none, because it tells the next
reader the wrapper decides. The roster's class registry decides.

What replaces them is one variable: CCGPT_ACCOUNT_ID, which is how the shim finds
this lane's default efforts. The [1m] warning stays, pointed at the catalogue
that now carries both context numbers.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## Task 15: `claude-glm` stops deciding models (MONOREPO)

**Files:**
- Modify: `infra/handoff/claude-glm` (lines 49–57 of the file as measured at `main`)
- Test: `infra/handoff/test_ccgpt_proxy.py` (`test_claude_glm_exports_no_model_variable`, already written in Task 14)

**Interfaces:**
- Consumes: nothing new.
- Produces: a wrapper that keeps its provider switch, its credential handling and its whitelist-proxy lifecycle, and stops exporting the six model variables. §15's decision 1b applies to its effort — the shim maps it only if the backend accepts a reasoning field, which is out of this plan's scope; this task removes the model exports and nothing else.

**Its guard, and where the guard's mutation lives.** The guard is `test_claude_glm_exports_no_model_variable`, written in Task 14 and shown red in Step 1 here. Its measured mutation is Step 5b below — the symmetric twin of Task 14 Step 6, which mutated `ccgpt` and reds `test_ccgpt_exports_no_model_variable`; neither run covers the other wrapper's case, so both are needed.

- [ ] **Step 1: Run the one failing case**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 -m unittest infra.handoff.test_ccgpt_proxy.TestWrappersStoppedDecidingModels.test_claude_glm_exports_no_model_variable -v 2>&1 | tail -5
```
If the dotted path does not import (the directory is not a package), use:
```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 infra/handoff/test_ccgpt_proxy.py TestWrappersStoppedDecidingModels.test_claude_glm_exports_no_model_variable -v 2>&1 | tail -5
```
Expected: FAIL — "claude-glm still exports ANTHROPIC_MODEL: export ANTHROPIC_MODEL=\"$model\"".

- [ ] **Step 2: Edit `infra/handoff/claude-glm`**

Replace lines 49–57 (the two `export ANTHROPIC_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` lines, the three-line "Remap ALL Claude aliases" comment and the four alias exports) with:

```bash
# THE LANE'S MODELS ARE NOT DECIDED HERE ANY MORE (model-class registry §6.2).
# The reason the aliases had to be remapped at all is unchanged and still
# important: project `.claude/agents/*.md` files pin `model: haiku|sonnet|opus`,
# and an unmapped alias makes such a subagent request a REAL Claude model
# through the gateway at list price — both catalogs serve Claude. What changed
# is WHERE the mapping lives. ccrc materialises it into this lane's own
# settings.json `env` block from the roster's class registry, and that block
# beats a shell export for the same variable (probed 2026-09-08), so these
# exports were already dead.
#
# So a `claude-glm` lane MUST be declared and classified before it is used:
#     ccrc models <id> init compatible     # or openrouter
#     ccrc models <id> set-class sonnet <modelId>
# An unclassified lane gets `ccrc-unavailable-<class>` sentinels rather than a
# silent fall-through to a real Claude id, which is the whole point of the
# sentinel (§6.1).
#
# `$model` and `$small` above are still what the provider switch computes, and
# they stay: they are what a reader needs to know which backend this lane talks
# to, and the `openrouter` arm's `$model` is what handoff-proxy's whitelist is
# applied to.
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export DISABLE_TELEMETRY=1
```

Note the `model=`/`small=` assignments inside the `case` (lines 38–46) are NOT removed — only the six `export`s are.

- [ ] **Step 3: Check it parses and the variables are still assigned**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && bash -n infra/handoff/claude-glm && grep -n 'model=\|small=' infra/handoff/claude-glm
```
Expected: no output from `bash -n`, then four assignment lines (two per `case` arm). **Do not RUN `claude-glm`.**

- [ ] **Step 4: Run the tests**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 infra/handoff/test_ccgpt_proxy.py -v 2>&1 | tail -5
```
Expected: `OK`, all cases.

- [ ] **Step 5: Confirm shellcheck-clean unused variables are intentional**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && command -v shellcheck >/dev/null && shellcheck -S warning infra/handoff/claude-glm || echo "shellcheck not installed — skipping"
```
Expected: either `shellcheck not installed — skipping`, or SC2034 ("model appears unused") on the four assignments. That warning is EXPECTED and is what the comment added in Step 2 answers: the values document which backend the lane talks to. Do not silence it by deleting the assignments — deleting them would remove the only place a reader learns the provider switch's outcome. If the repo gates on shellcheck, add `# shellcheck disable=SC2034` immediately above each `case` arm with the same one-line reason.

- [ ] **Step 5b: Measured mutation check — the scan really scans `claude-glm`**

Add one export back at the end of the block Step 2 emptied:

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
printf 'export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"\n' >> infra/handoff/claude-glm
python3 -m unittest infra.handoff.test_ccgpt_proxy -v 2>&1 | tail -5
```
Expected: exactly ONE case red — `test_claude_glm_exports_no_model_variable`, its message naming `ANTHROPIC_DEFAULT_OPUS_MODEL` and the line it sits on. `test_ccgpt_exports_no_model_variable` stays green, which is the half that proves the two wrappers' cases are independent and that Task 14 Step 6 did not already cover this one.

Restore, and re-measure:

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
sed -i '$d' infra/handoff/claude-glm
git diff --stat infra/handoff/claude-glm
python3 -m unittest infra.handoff.test_ccgpt_proxy -v 2>&1 | tail -5
```
Expected: the `git diff --stat` shows only Step 2's own deletions, and the run is `OK` again.

- [ ] **Step 6: Commit (monorepo)**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
git add infra/handoff/claude-glm
git commit -m "$(cat <<'MSG'
feat(handoff): claude-glm stops remapping the aliases, and says where the mapping went

The reason the remap existed is unchanged — a project agent pinned to
`model: opus` would otherwise request a real Claude model through the gateway at
list price, because both catalogs serve Claude. What changed is where the mapping
lives: the roster's class registry, materialised into this lane's own
settings.json, which beats a shell export for the same variable.

An unclassified lane now gets `ccrc-unavailable-<class>` sentinels instead of a
silent fall-through to a real Claude id. That is the whole point of the sentinel.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---
## Task 16: Stage the deployed copies, and measure exactly what will change (MONOREPO)

**Files:**
- Read only: `~/.local/bin/ccgpt`, `~/.local/bin/ccgpt-proxy`, `~/.local/bin/claude-glm`, `~/.local/bin/ccgpt-usage`, `~/.handoff/litellm-config.yaml`
- Create: `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/handoff-staging/` (three staged files and one diff transcript)

**Interfaces:**
- Consumes: the three edited monorepo files (Tasks 13–15).
- Produces: a measured, reviewable statement of what installing them would change, and the exact `install`/`cmp` commands Task 17's runbook runs **after** the seed. Nothing under `~/.local/bin` or `~/.handoff` is written by this task.

**No guard, so no mutation step.** This task writes no code and adds no assertion: it `diff`s and stages, and every command below is a measurement whose output IS the deliverable. The guards that keep the staged bytes honest are the two export scans, each already mutated where it was written — `ccgpt`'s at Task 14 Step 6, `claude-glm`'s at Task 15 Step 5b.

**Why this task installs nothing.** §13.3: the wrappers lose their exports "in the same change set as the block lands on the boxes, never earlier". The block lands when an operator runs `ccrc models gpt init codex` against the live roster — which this plan may not do (Global Constraints: no `ccrc` against the real HOME, and the migration happens after merge). Installing the new `ccgpt` before that seed would leave the gpt lane with no model at all: no exports, and no `env` block to replace them. So this task stages and measures; Task 17's runbook installs, in the order that keeps the lane alive.

- [ ] **Step 1: Confirm the deployed copies still match `main`'s bytes**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
for f in ccgpt ccgpt-proxy claude-glm ccgpt-usage; do
  printf '%s: ' "$f"
  if diff -q ~/.local/bin/$f <(git show main:infra/handoff/$f) >/dev/null; then echo "matches main"; else echo "DRIFTED"; fi
done
diff -q ~/.handoff/litellm-config.yaml <(git show main:infra/handoff/litellm-config.yaml) >/dev/null \
  && echo "litellm-config.yaml: matches main" || echo "litellm-config.yaml: DRIFTED"
```
Expected (measured 2026-09-08, all five identical): five `matches main` lines. A `DRIFTED` line means somebody hand-edited a deployed copy; STOP and report which, with the diff — the runbook's install would silently destroy that edit.

- [ ] **Step 2: Stage the three files this branch changes**

```bash
STAGE=/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/handoff-staging
mkdir -p "$STAGE"
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
for f in ccgpt ccgpt-proxy claude-glm; do install -m 755 infra/handoff/$f "$STAGE/$f"; done
ls -l "$STAGE"
```
Expected: three files, mode `-rwxr-xr-x`.

- [ ] **Step 3: Prove the staged bytes ARE the branch's bytes**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
for f in ccgpt ccgpt-proxy claude-glm; do cmp "$STAGE/$f" infra/handoff/$f && echo "$f: identical to the branch"; done
```
Expected: three `identical to the branch` lines, no `cmp` output.

- [ ] **Step 4: Record exactly what installing them would change**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
{ for f in ccgpt ccgpt-proxy claude-glm; do
    echo "=== ~/.local/bin/$f ==="
    diff -u ~/.local/bin/$f "$STAGE/$f" || true
  done; } | tee "$STAGE/pending-install.diff" | tail -40
wc -l "$STAGE/pending-install.diff"
```
Expected: a unified diff showing exactly three changes — `ccgpt-proxy` gains `EFFORT_LEVELS`/`_effort_path`/`_effort_cache`/`_effort_map`/`_base_model`/`_apply_effort` and the rewritten `_relay` block; `ccgpt` loses the six model exports and gains `CCGPT_ACCOUNT_ID`; `claude-glm` loses six exports. Nothing else. Read the whole diff before continuing.

- [ ] **Step 5: Assert the diff touches no credential, endpoint or lifecycle line**

```bash
grep -E '^[-+]' "$STAGE/pending-install.diff" | grep -E 'AUTH_TOKEN|BASE_URL|API_KEY|LITELLM_MASTER_KEY|CHATGPT_TOKEN_DIR|_wait_port|nohup' || echo "no credential, endpoint or lifecycle line changes"
```
Expected: `no credential, endpoint or lifecycle line changes`. If anything prints, one of Tasks 13–15 went further than it was asked to; revert that hunk before continuing.

- [ ] **Step 6: Confirm `ccgpt-usage` is untouched, on the branch and on the box**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
git diff main --stat -- infra/handoff/ccgpt-usage
cmp ~/.local/bin/ccgpt-usage infra/handoff/ccgpt-usage && echo "ccgpt-usage: unchanged, and the box matches"
```
Expected: no output from `git diff --stat`, then `ccgpt-usage: unchanged, and the box matches`. §5: telemetry and catalogue are different questions on different cadences, and `ccgpt-usage.timer` is explicitly out of scope.

- [ ] **Step 7: Write the install commands into the branch, where the runbook can cite them**

Create `infra/handoff/INSTALL-model-class-registry.md`:

```markdown
# Installing the model-class-registry change to a box

These three files are copied by hand — there is no deploy lane for
`infra/handoff/`. **The ORDER below is not a suggestion:** `ccgpt` and
`claude-glm` stop exporting the model variables, and until the lane's own
`settings.json` carries ccrc's materialised `env` block there is nothing to
replace them with. Installing them early leaves the lane with no model at all.

Run these on each box that has `~/.local/bin/ccgpt`, from a checkout of
`feat/ccgpt-effort-shim`:

1. **Seed and materialise the lane first** (ccrc side; see the plan's runbook):
   `ccrc models gpt init codex && ccrc models refresh gpt`
   Then check the block landed:
   `jq '.env | {ANTHROPIC_MODEL, ANTHROPIC_DEFAULT_FABLE_MODEL}' ~/.claude-gpt/settings.json`

2. **The shim** — safe at any point, and safest first: with no effort file it
   sets no `reasoning` field at all.
   ```
   diff -u ~/.local/bin/ccgpt-proxy infra/handoff/ccgpt-proxy
   install -m 755 infra/handoff/ccgpt-proxy ~/.local/bin/ccgpt-proxy
   cmp ~/.local/bin/ccgpt-proxy infra/handoff/ccgpt-proxy && echo installed
   ```

3. **The LiteLLM config** — regenerate it so no `reasoning` key is left to
   compete with the shim:
   `ccrc models litellm gpt`

4. **The wrappers** — only after step 1 is verified:
   ```
   diff -u ~/.local/bin/ccgpt infra/handoff/ccgpt
   install -m 755 infra/handoff/ccgpt ~/.local/bin/ccgpt
   cmp ~/.local/bin/ccgpt infra/handoff/ccgpt && echo installed
   diff -u ~/.local/bin/claude-glm infra/handoff/claude-glm
   install -m 755 infra/handoff/claude-glm ~/.local/bin/claude-glm
   cmp ~/.local/bin/claude-glm infra/handoff/claude-glm && echo installed
   ```

5. **Restart the proxies** so the running ones are the installed ones:
   `ccgpt stop` (the next gpt session starts both again).

`ccgpt-usage` is untouched by this change. `~/.local/bin/gpt` is a symlink to
`ccgpt` and needs nothing.

Rollback for any of the three: `git show main:infra/handoff/<f> > /tmp/<f> &&
install -m 755 /tmp/<f> ~/.local/bin/<f>`, then `ccgpt stop`.
```

- [ ] **Step 8: Commit (monorepo)**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner
git add infra/handoff/INSTALL-model-class-registry.md
git commit -m "$(cat <<'MSG'
docs(handoff): the install order, because the wrappers must go last

ccgpt and claude-glm stop exporting the model variables, and until the lane's own
settings.json carries ccrc's materialised env block there is nothing to replace
them with — installing them early leaves the lane with no model at all. The shim
is safe first: with no effort file it sets no reasoning field.

Staged and diffed against the deployed copies; nothing installed. The three
copies on this box match main byte for byte, so the recorded diff is the whole
change.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 9: Report the branch state**

```bash
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && git log --oneline main..feat/ccgpt-effort-shim && git status --porcelain
```
Expected: four commits (Tasks 13, 14, 15, 16) and a clean status. **Do not push and do not open a PR** — the monorepo branch lands with the ccrc-pwa one, in the order the runbook states.

---


## Task 17: The operator runbook, written into the plan and shipped with the branch

**Files:**
- Create (in the ccrc-pwa implementation worktree): `docs/superpowers/specs/2026-09-08-model-class-registry-design.md` and ALL FOUR plan documents — `docs/superpowers/plans/2026-09-08-model-class-registry-1-registry-probes-materialiser.md`, `…-2-ccd-class-carry.md`, `…-3a-surfaces.md`, `…-3b-swapsheet.md`
- Read only: this plan document, and the other three in `<S>/mcr/docs/superpowers/plans/`

**Interfaces:**
- Consumes: everything Tasks 1–16 built.
- Produces: the four plan documents and the spec, runbook included, committed on `feat/model-class-registry-impl` so the sequence travels with the code that needs it. All four ship here, in one commit, because Plans 2, 3a and 3b continue on THIS worktree and each of their reviewers needs the plan its diff argues from; a plan revised after this task runs is re-copied by the plan that revised it, in its own last commit. **No step of the runbook is executed by this plan** — the migration happens after both PRs merge, against a real box, by an operator.

**No guard, so no mutation step** — except Step 2's, which is itself a scan with a stated failure mode: if its `grep -nE` prints lines rather than `clean`, a round-2 rename was missed and the commit does not happen.

- [ ] **Step 1: Copy the plan and the spec into the implementation worktree**

```bash
S=/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad
mkdir -p "$S/mcr-impl/docs/superpowers/plans" "$S/mcr-impl/docs/superpowers/specs"
for f in 1-registry-probes-materialiser 2-ccd-class-carry 3a-surfaces 3b-swapsheet; do
  cp "$S/mcr/docs/superpowers/plans/2026-09-08-model-class-registry-$f.md" \
     "$S/mcr-impl/docs/superpowers/plans/"
done
cp "$S/mcr/docs/superpowers/specs/2026-09-08-model-class-registry-design.md" \
   "$S/mcr-impl/docs/superpowers/specs/"
ls "$S/mcr-impl/docs/superpowers/plans/"
```

Expected: the four plan filenames, one per line.

The spec travels too, so every plan's `§`-citations resolve inside the branch, and all four plans travel because Plans 2, 3a and 3b build on this same worktree — a reviewer of their PR reads the plan the diff argues from, not a path in another session's scratchpad.

- [ ] **Step 2: Verify the copied plan is the one this branch implements**

```bash
S=/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad
P="$S/mcr-impl/docs/superpowers/plans/2026-09-08-model-class-registry-1-registry-probes-materialiser.md"
grep -c "OPERATOR RUNBOOK" "$P"
grep -c "d3048253" "$P"
# And every plan on the branch cites the same spec tip, so no reviewer reads a
# plan written against an older §-numbering.
for f in "$S"/mcr-impl/docs/superpowers/plans/2026-09-08-model-class-registry-*.md; do
  printf '%s: ' "$(basename "$f")"; grep -c "d3048253" "$f"
done
# The round-2 renames, checked as INSTRUCTIONS rather than as mentions: the
# withdrawn terms appear in this plan only where it says they are withdrawn or
# contrasts them with the names that replaced them, so counting mentions proves
# nothing. What must be zero is any of them appearing in a code block as a
# declaration, a field or a verb.
grep -nE "^(export )?(interface|type) ModelsBlock|shortlist[:?]|shortlist \(add|models: ModelsBlock|ccrc account models" \
  "$S"/mcr-impl/docs/superpowers/plans/2026-09-08-model-class-registry-*.md \
  && echo "FAIL: a round-2 rename was missed at the lines above" || echo "clean"
```
Expected: `1`, `1`, a `: 1` line for each of the four plans, then `clean`. If the grep prints lines instead, a round-2 rename was missed there; fix it before committing.

- [ ] **Step 3: Commit**

```bash
cd /tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-impl
git add docs/superpowers/plans/2026-09-08-model-class-registry-1-registry-probes-materialiser.md \
        docs/superpowers/plans/2026-09-08-model-class-registry-2-ccd-class-carry.md \
        docs/superpowers/plans/2026-09-08-model-class-registry-3a-surfaces.md \
        docs/superpowers/plans/2026-09-08-model-class-registry-3b-swapsheet.md \
        docs/superpowers/specs/2026-09-08-model-class-registry-design.md
git commit -m "$(cat <<'MSG'
docs(models): the four plans and the spec travel with the branch that implements them

Including the operator runbook: the migration is an ORDER, not a set of steps,
and the order is what keeps the gpt lane alive across it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 4: Final gate — the whole suite, all three packages, one more time**

```bash
S=/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad
cd "$S/mcr-impl/server" && npx vitest run
cd "$S/mcr-impl/agent" && npx vitest run
cd "$S/mcr-impl/pwa" && npx vitest run
# The shim's suite lives in the MONOREPO, not in this worktree — Tasks 13-16 are
# the only tasks in this plan whose files are outside `mcr-impl`, and this is the
# one command that has to leave it. Run it from the monorepo root, the way
# Task 13 Step 3 and Task 15 Step 1 do; from `mcr-impl/pwa` there is no
# `infra/handoff/` and the run would pass by finding nothing.
cd /mnt/HC_Volume_105751470/projects/OpenClawHetzner && python3 -m unittest infra.handoff.test_ccgpt_proxy -v
```
Expected: three green vitest runs and one `OK`. The `pwa` suite is included because `shared/models.ts` is bundled by the PWA; this plan adds no PWA source and touches no existing shared type, so it must be green without edits — if it is red, report what, rather than patching a PWA file this plan does not own.

- [ ] **Step 5: Report, and stop**

Report to the caller: the two branch names (`feat/model-class-registry-impl` in the ccrc-pwa worktree, cut from `origin/main`; `feat/ccgpt-effort-shim` in the monorepo), the commit count on each, and the fact that NOTHING was deployed, installed or run against the real box. Plans 2, 3a and 3b continue on the same ccrc-pwa worktree.

---

## OPERATOR RUNBOOK — after both PRs merge

**Nothing in this section is executed by this plan.** It is the sequence an operator follows on a real box, once `feat/model-class-registry-impl` and `feat/ccgpt-effort-shim` have merged. It is an ORDER, not a set of steps: §13.3 is explicit that the wrappers lose their exports "in the same change set as the block lands on the boxes, never earlier", and every gate below exists to keep the gpt lane answering across the migration.

Run it on the FLEET HOST first, then the server box (§13.5, deploy agent-first).

- [ ] **R1. Deploy the agent lane.** `deploy/deploy.sh agent <box>`. This ships `ccd/ccrc`, `ccd/ccrc-models-probe`, the rsync'd `deploy/` and `shared/` trees, and enables `ccrc-models.timer`.
- [ ] **R2. Prove the verb is there.** `ccrc models refresh --all` — expect one JSON object. On a box where no lane has a registry yet this is an EMPTY, successful run: refresh walks the lanes that have a registry, and the registry is what carries the probe kind.
- [ ] **R3. Seed the gpt lane's registry.** `ccrc models gpt init codex`. This writes `~/.ccrc/models/gpt.classes.json` with today's mapping — luna/terra/sol, `fable: null`, `subagent: sonnet`, `discovery: "catalogue"` — so behaviour is unchanged, and materialises it. §13.1.
- [ ] **R4. Probe, and check the catalogue landed.** `ccrc models refresh gpt`, then `jq '.probe, .stale, (.models|length)' ~/.ccrc/models/gpt.json` — expect `"codex"`, `false`, and the count the backend advertises (nine on 2026-09-08). A `true` for stale means the probe failed; read `.lastError` before going further, and do not continue until it is `false`.
- [ ] **R5. Verify the block landed in the lane's own settings.** `jq '.env' ~/.claude-gpt/settings.json` — expect the eight variables, with `ANTHROPIC_DEFAULT_FABLE_MODEL` reading `ccrc-unavailable-fable`, `ANTHROPIC_MODEL` reading `gpt-5.6-sol` and `CLAUDE_CODE_SUBAGENT_MODEL` reading `gpt-5.6-terra`. **This is the gate for R8. Do not install the wrappers until this shows the block.**
- [ ] **R6. Verify the two generated side files.** `cat ~/.ccrc/models/gpt.classes.tsv` — four lines, three columns; `fable` reads `fable<TAB><TAB>unassigned`. `jq . ~/.ccrc/models/gpt.effort.json` — `byModel` with three entries.
- [ ] **R7. Install the shim and regenerate LiteLLM's config.** From a checkout of `feat/ccgpt-effort-shim`, follow `infra/handoff/INSTALL-model-class-registry.md` steps 2 and 3: install `ccgpt-proxy`, then `ccrc models litellm gpt`. Check with `grep -c reasoning ~/.handoff/litellm-config.yaml` — expect `0`.
- [ ] **R8. Install the two wrappers.** `INSTALL-model-class-registry.md` step 4. Only after R5 showed the block.
- [ ] **R9. Restart the proxies.** `ccgpt stop`. The next gpt session starts both on the new bytes.
- [ ] **R10. Smoke-test the lane end to end.** Start a gpt session and check four things: an unqualified turn answers (the `ANTHROPIC_MODEL` path); `/model sonnet` answers (the alias path through the env block); a subagent runs (the `CLAUDE_CODE_SUBAGENT_MODEL` path, now Terra); `/model fable` fails with a message naming `ccrc-unavailable-fable` (the sentinel, doing exactly its job — this is a PASS, not a regression).
- [ ] **R11. Classify Astra, and watch Fable become routable.** `ccrc models gpt set-class fable gpt-6-astra`, then `jq '.env.ANTHROPIC_DEFAULT_FABLE_MODEL' ~/.claude-gpt/settings.json` — expect `"gpt-6-astra"`. Re-run R10's fourth check: `/model fable` now answers. §13.2.
- [ ] **R12. Choose the subagent class, if Sonnet is not what you want.** `ccrc models gpt set-subagent haiku` — then `jq '.env.CLAUDE_CODE_SUBAGENT_MODEL' ~/.claude-gpt/settings.json` reads Luna. It is an explicit choice per lane and is never derived (§4.1, ruling 5c); pointing it at a class with no model is refused by name.
- [ ] **R13. Set the lane defaults you want.** `ccrc models gpt set-effort fable ultra` (Astra offers it; Luna does not, and the verb refuses that by name). Check `jq . ~/.ccrc/models/gpt.effort.json`.
- [ ] **R14. Confirm `/effort` now does something.** In a gpt session, `/effort xhigh`, then one turn. The shim sets `reasoning.effort: xhigh`; before this change LiteLLM's static config decided and the picker was decorative (§1).
- [ ] **R15. Confirm the timer is live.** `systemctl --user list-timers ccrc-models.timer` — expect a next-elapse within the hour. `systemctl --user status ccrc-models.service` after it first fires — expect a clean oneshot exit.
- [ ] **R16. Confirm `ccgpt-usage.timer` is untouched.** `systemctl --user list-timers ccgpt-usage.timer` — still every 20 minutes. Telemetry and catalogue are different questions on different cadences (§5).
- [ ] **R17. Rollback, if any gate fails.** The registry file is the operator's and is never rewritten by a deploy: `ccrc models gpt set-class fable none` undoes R11, and the wrappers roll back with the command at the bottom of `INSTALL-model-class-registry.md`. Deleting `~/.ccrc/models/gpt.classes.json` returns the lane to "no registry" — every class unavailable, and the wrapper's own exports are what it had before R8, so roll the wrappers back too if you do that. The catalogue and the two side files are generated and safe to delete; the next `ccrc models refresh gpt` rebuilds them. The one thing to restore by hand is `~/.handoff/litellm-config.yaml`, whose previous bytes are at `~/.handoff/litellm-config.yaml.prev`.

Plans 2, 3a and 3b have their own runbooks: Plan 2's covers the ccd class carry (the statusline writer, the registry `class` field, rotation), Plan 3a's the server routes and the Accounts screen's Models section, and Plan 3b's the SwapSheet downgrade choice.
