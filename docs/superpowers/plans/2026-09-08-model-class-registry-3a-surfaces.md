# Model-class registry — Plan 3a: surfaces (server routes, PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the model-class registry on every surface an operator touches — `GET /api/accounts` carries each lane's registry, three routes edit it through `ccrc models`, the Accounts screen grows a Models section, the session picker becomes class-driven — and delete the hardcoded model table in `pwa/src/lib/models.ts`.

**Architecture:** The registry itself (`~/.ccrc/models/<accountId>.classes.json`, `shared/models.ts`'s `Registry` type and derivations, the probes and the materialiser) is Plan 1's; the class carry in `ccd` is Plan 2's; the SwapSheet's downgrade choice is Plan 3b's. The doctor check is Plan 2's (mail 286, 2026-09-08): `ccd/ccrc-doctor-checks` is a `ccd/` file PR #62 edits, sourced by `ccrc` through `BASH_SOURCE` and shipped with `ccd` on the agent lane. This plan adds only READERS and one WRITER seam. A new `server/src/models.ts` does ONE readdir of `~/.ccrc/models/` on the same fleet poll that already reads `~/.cc-limits` and `~/.cc-sessions`, parses each lane's registry and catalogue, projects them through `shared/models.ts`'s `deriveModels`/`availableFor`, and adds ONE field to each `RosterWire` row. Every mutation execs a `ccrc models …` verb through the agent — a new, second exec command beside `ccd`, with its own branded argv table — so the server never writes the registry file itself. The PWA reads the wire and writes through those routes; nothing in the browser re-derives a class.

**Tech Stack:** TypeScript (server: Fastify + node 22; PWA: React 18 + zustand + vite), vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-model-class-registry-design.md`, at `d3048253` on branch `feat/model-class-registry` (`git -C <spec-worktree> log -1 --oneline` → `d3048253 docs(models): registry is its own per-account file until account-connections merges; subagent is an explicit class-to-slot choice; discovery scope named apart from selectable; Plan 3 splits behind wave 4`). This plan implements §8 (except its SwapSheet bullet and its last bullet — the doctor check, which is Plan 2's), §9 and §13.4. Read the spec before Task 1; every task cites the section it argues from.

**Skeleton:** the locked skeleton for the plans is `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-skeleton.md`. Its **"Rulings round 2"** (mails 279 and 280, 2026-09-08) OVERRIDES the "Locked interfaces" section above it, and this plan implements the round-2 shape: the `ModelsBlock`-on-the-roster interface is **WITHDRAWN** (the registry is its own per-account file), `shortlist` is **`discovery`**, `subagent` is an **explicit class name**, the verbs are a **top-level `ccrc models` group**, the bash projection has a **third column**, and item 9 is what split the old Plan 3 into this file and `…-3b-swapsheet.md`.

---

## Skeleton deviations (accepted)

Each entry below is a place where the repo forces a reading the locked skeleton — including its **Rulings round 2**, which supersede the skeleton's own "Locked interfaces" — does not literally say. No locked NAME is changed by any of them, and **no `D-<n>` number is allocated**: `server/test/deviation-refs.test.ts` forbids an unallocated marker and none of these needs one.

**C-1 — `AccountModels` rides on `RosterWire`, not on `AccountUsage`.**
The skeleton writes `// on each account row of GET /api/accounts: models: AccountModels | null`.
`AccountsResponse` has two arrays of "account rows" and they are not the same set:
`accounts: AccountUsage[]` is built from `~/.cc-limits/*.json` plus markered-off lanes
(`server/src/limits.ts:110-189`), so **an account telemetry has never measured has no
row there at all** — exactly a freshly connected OpenRouter or `compatible` lane, the
lanes this feature exists for. `roster: RosterWire[]` is every account the box knows,
in roster declaration order (`shared/api.ts:2696-2734`, `server/src/server.ts:1186-1189`).
The field goes there. The type name, the field name and the `null`-for-no-registry rule
are all as locked.

**C-2 — `AccountModels` declares its field types STRUCTURALLY inside `shared/api.ts`.**
Round 2 moves `ClassMap`, `EffortMap`, `ModelClass`, `Discovery` and `ProbeKind` into
`shared/models.ts`. `shared/api.ts` may hold exactly ONE import line and it must be a type
(`server/test/peers-claims-l0.test.ts:155-161` pins it), and that line is already spent on
`import type { Hue } from './roster.js';`. Importing from `./models.js` would be a SECOND
line. So `AccountModels` spells its own field types — `classes` as a four-key object of
`string | null`, `subagent`/`probe` as `string`, `available` as `string[]` — exactly as
`Wrapper` already does in that file (`shared/api.ts:2477-2530`: "a string on the wire,
narrowed at the read site"). Task 1 pins the duplication with an assignability test in both
directions, so a field added on either side is a compile error. **The plan does NOT edit
`shared/roster.ts`** (round 2 item 1 puts it out of bounds), and the L0 pin is untouched.

**C-3 — a `discovery` ARRAY in the PATCH body is diffed server-side.**
The locked body is `{ classes?, subagent?, discovery?, effort? }` with
`Discovery = 'catalogue' | readonly string[]`, but the locked verb surface (spec §10) has no
whole-list setter — only `discovery add <id> | rm <id> | catalogue`. So an array body is
turned into `add`/`rm` calls against the discovery list the same request just read. The verb
surface is unchanged; this is how the locked route reaches the locked verb.

**C-4 — the `ccrc` grant is ONE token wide, `[['models']]`, and the branded argv table is what narrows it.**
`agent/src/whitelist.ts`'s `isExecAllowed` is PREFIX matching, and `REQUIRED_VERB_FLAG`
narrows a verb by pinning the token at index 1. Spec §10 puts the ACCOUNT ID at index 1
(`ccrc models gpt set-class opus <id>`), so no constant second token exists and no
two-token prefix can be written. Measured consequence, stated rather than papered over: the
grant admits every `ccrc models …` form, including `ccrc models litellm <id>`, which renders
LiteLLM's config and restarts it (spec §6.3). That restart is already reachable through the
granted `ccrc models refresh <id>`, which performs the same step when the visible model set
changed — so the grant's blast radius is the one the routes already have. What stays out is
everything that is NOT `models`: `install`, `uninstall`, `update`, `passwd`, `expose`,
`adopt` and `backup` join `UNGRANTABLE_VERBS` (which gates a prefix's FIRST token), making
re-admitting one a compile error and a boot refusal. And no route can BUILD `litellm`,
`init` or `refresh --all`: `Deps.runCcrc` takes a branded `CcrcArgv` that only
`server/src/ccrcargv.ts` can mint, and `server/test/whitelist-subset.test.ts` enumerates that
table in both directions.

**C-5 — "this lane runs Claude Code's own aliases" is read from `telemetry` on the server and from `homeAble` in the browser.**
Round 2 item 1 keeps `exec.provider` off this branch (it is the account-connections
spec's, not on `main`), and item 2 makes `availableFor(reg, catalogue, anthropic)`'s third
argument the CALLER's rule. On `origin/main` the roster's own declared signal is
`telemetry: 'anthropic' | 'none'` (`shared/roster.ts:84-88`) — required by `parseRoster`,
and false exactly for the lanes that do not bill through Anthropic. The server, which holds
the whole `AccountDef`, reads that. `RosterWire` carries no `telemetry` and this plan may add
only ONE field to it (round 2 item 9), so the browser reads `homeAble` instead — "ccd's
least-loaded picker may land a fresh session here", true for every Anthropic account and
false for `gpt` on today's roster — and uses it for one thing only: which read-only copy to
show for a lane with no registry ("client default" versus "no registry on this lane"). Both
collapse into one `provider === 'anthropic'` read when the fold-in of §14 lands. Neither ever
decides ROUTING: `available` is computed from the registry file alone.

**C-6 — the Models section's read-only arm covers TWO lanes, not one.**
Spec §8 names the Anthropic case ("the four classes as 'client default', no controls"). With
no `provider` on the wire, `models === null` also covers a non-Anthropic lane nobody has
seeded yet — which spec §13.1 says is VALID and reads as "all classes unavailable". Both are
read-only and the section renders both, with the copy chosen by C-5's `homeAble`; the second
names the remedy (`ccrc models <id> init <probe>`).

## Gating and ordering (BINDING — spec §14, and the skeleton's Rulings round 2)

1. **Plan 3a starts after Plan 1**, from the implementation worktree Plan 1's Task 1 creates
   **off `origin/main`** (round 2 item 1: no stacking on `ws/gemini-subscription-account-connection`).
   Nothing here is gated on account-pools PR #62: this plan touches no ccd swap/spawn path.
2. **This plan does not edit** `shared/roster.ts`, `shared/roster-json.mjs`,
   `deploy/account-op.mjs` or `ccd/ccrc`'s `cmd_account` (round 2 item 1 — the
   account-connections branch's files, not on `main`; `cmd_account` does not exist there at
   all). It also does not edit `server/src/limits.ts` (account-pools wave 3's).
3. **This plan does not touch `pwa/src/fleet/SwapSheet.tsx`, `pwa/src/fleet/NewSessionSheet.tsx`
   or `pwa/src/stores/fleet.ts`, and creates no `pwa/src/lib/pools.ts`** — account-pools wave 4
   rewrites those, and the SwapSheet's downgrade sentence is **Plan 3b**, gated on that wave's
   merge sha. `pwa/src/lib/api.ts` gains exactly the three model client methods and nothing else.
4. **`shared/api.ts` gains exactly one interface and one optional field** on the account row
   (round 2 item 9). `FleetSession` is NOT touched here — the per-session class reaches the wire
   in Plan 3b.

---

## Global Constraints

Copied verbatim from the spec and the skeleton. Every task's requirements implicitly include this section.

- **Repo root.** All paths are relative to the implementation worktree's repo root, `<repo>` — created by Plan 1 Task 1 as `feat/model-class-registry-impl` **off `origin/main`**. `/home/mfastovets/worktrees/ccrc-pwa/plain-hollow` (account-connections) and `/home/mfastovets/worktrees/ccrc-pwa/clear-meadow` (account-pools wave 2b) are other sessions' live worktrees: READ ONLY, never edit or check out there.
- **The registry is its own per-account file**, `~/.ccrc/models/<accountId>.classes.json`, with `Registry = { probe, classes, subagent, discovery, effort?, baseUrl? }` in `shared/models.ts` (spec §4.1). It is NOT in the roster. Nothing in this plan reads or writes `~/.ccrc/accounts.json` for model data.
- **The catalogue file's discriminator is `probe`, not `provider`** (Plan 1 deviation B-2, round 2 item 10). `~/.ccrc/models/<accountId>.json` is `Catalogue = { probe: ProbeKind; fetchedAt: number; stale: boolean; lastError?: string; models: CatalogueModel[] }`, and `parseCatalogue` refuses a file whose `probe` is missing or is not one of `codex | openrouter | compatible`. Spec §4.2's example still writes `"provider": "openai"`; that spelling is an account-connections `ProviderId` and `shared/providers.ts` is not on `main`, so every catalogue fixture in this plan writes `probe: 'codex'`.
- **Fixture HOMEs only.** Never run `ccd`, `ccrc`, `systemctl`, `deploy/deploy.sh` or a probe against the real `$HOME`; never touch the live `~/.ccrc`. Server tests use `testDeps`/`seedRoster` (`server/test/helpers.ts:60-137`) and `mkTmp` (`server/test/tmpHelpers.ts`).
- **TDD, red first, with a measured mutation check per guard.** Each guard's test is shown failing before the code exists, and a mutation step (flip the guard, observe the named test fail, restore) is written into the task. The idiom to copy is in the tree: `server/test/ccd-default-pool.test.ts:20-52` (2026-09-07) — a header paragraph naming the exact mutation, what it flips and how many named cases go red, plus a per-guard mutate/run/restore step.
- **Tests are vitest.** Run one file with `npx vitest run <path>` **from the package directory** (`server/`, `pwa/`, `agent/`).
- **Commits.** `type(scope): one sentence in the tree's voice`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task; never `git add -A` across unrelated files.
- **No `D-<n>` markers.** `server/test/deviation-refs.test.ts` forbids a `D-` number that was not allocated. This plan allocates none and needs none.
- **Comment discipline.** Comments state measured facts and the WHY. A comment must not spell a helper's name before its definition where a test locates that helper by first occurrence (`deploy/deploy.sh`, `agent/test/deploy-verify.test.ts`).
- **`shared/` is L0.** Files under `shared/` import nothing but other L0 `shared/*` files — pinned by `server/test/peers-claims-l0.test.ts:155-161`. No `node:*` anywhere in `shared/`. `shared/api.ts` keeps exactly ONE import line and it stays `import type { Hue } from './roster.js';`.
- **The four class names.** `CLASSES = ['haiku', 'sonnet', 'opus', 'fable']` (`shared/models.ts`, Plan 1). Class order in code is always `CLASSES` order; class order in every CHOOSER is the reading order `opus, sonnet, fable, haiku`, spelled once as `CLASS_ORDER` (Task 8).
- **`subagent` is an explicit class name**, never derived (spec §4.1, round 2 item 3): the registry names which class `CLAUDE_CODE_SUBAGENT_MODEL` resolves to, and naming a class whose slot is `null` is refused by the verb.
- **`discovery`, never `shortlist`** (round 2 item 4). The word is `discovery` in every type, verb, wire field and piece of UI copy. It is NOT the account-connections `selectable`, which is a picker permission (spec §2).
- **The sentinel.** `UNAVAILABLE_PREFIX = 'ccrc-unavailable-'` (`shared/models.ts`, Plan 1) lives in the settings `env` block and nowhere else. Every branching reader takes availability from `available` (spec §4.3) or from the third column of `<id>.classes.tsv` — never from an env value, and no surface ever shows a sentinel to a human as a model name.
- **Spec §15.2:** auto-swap for a session whose class is unavailable on a lane **skips the lane** — never a silent downgrade. A downgrade is only ever an explicit `--as-class` (Plan 2 + Plan 3b).
- **Spec §13.4:** `pwa/src/lib/models.ts`'s table is **deleted, not kept as a fallback**. The four Anthropic display names (`Opus 5`, `Sonnet 5`, `Fable 5`, `Haiku 4.5`) are the one exception and the file's header says so.
- **Spec §11:** a probe failure keeps the previous catalogue with `stale: true`; a catalogue is never deleted on failure; a retired class id leaves the registry file untouched and is a warning on every surface.
- **PWA design contract.** `pwa/design/DIRECTION.md`. Touch floor `min-height: var(--tap-min)` (44px) on every interactive element. No `opacity` between 0 and 1 on content — express a quiet state with ink tokens. Every new CSS rule must resolve to a registered token pair or the contrast gate refuses it: run `npx vitest run test/contrast.test.ts` from `pwa/` after any stylesheet edit.
- **Do not run `deploy/deploy.sh`.** This plan ends before deploy. No file it touches is newly shipped, so `agent/test/deploy-verify.test.ts` needs no new pin.
- **This plan document is already on the branch.** Plan 1 Task 17 commits all four plans plus the spec into `docs/superpowers/plans/` and `docs/superpowers/specs/` of the implementation worktree, so a reviewer of this plan's PR reads the plan the diff argues from rather than a path in another session's scratchpad. If this file is revised while executing it, re-copy it from `<S>/mcr/docs/superpowers/plans/` and include it in this plan's LAST commit — never in a commit that also carries code.
- **`ccd/ccd` is not edited by this plan**, so the `# ccrc:generated` marker re-stamp (skeleton convention 4) does not apply here.

---

### Task 1: `AccountModels` on the wire

Spec §9's first bullet, shape only. This task adds the one interface and the one row field and nothing that fills them — Task 2 is what computes a value.

**Files:**
- Modify: `shared/api.ts` (add `AccountModels` directly above `export interface RosterWire`, and one field inside `RosterWire` after `pool`)
- Modify: `shared/models.ts` (add `isModelClass` beside Plan 1's `CLASSES` — this plan OWNS that predicate; Plan 1 Task 2 is told not to export it, so Step 2's red is real)
- Create: `server/test/models-wire.test.ts`
- Idiom copied from: `shared/api.ts:2477-2530` (`Wrapper`'s "a string on the wire, narrowed at the read site" doctrine, which C-2 follows); `shared/api.ts:2710-2734` (`hidden`/`pool`'s ADDITIVE-field docstrings, whose reasoning this field's docstring extends); `server/test/peers-claims-l0.test.ts:163-175` (the "a wire literal is total" test shape)

**Interfaces:**
- Consumes (from Plan 1, on the branch when this runs): `shared/models.ts` exports `CLASSES: readonly ['haiku','sonnet','opus','fable']`, `type ModelClass`, `type ClassMap = Record<ModelClass, string | null>`, `type EffortMap = Partial<Record<ModelClass, string>>`, `type ProbeKind = 'codex' | 'openrouter' | 'compatible'`, `type Discovery = 'catalogue' | readonly string[]`, `interface Registry { probe: ProbeKind; classes: ClassMap; subagent: ModelClass; discovery: Discovery; effort?: EffortMap; baseUrl?: string }`, `MODEL_ID_RE`.
- Produces:
  - `shared/api.ts`: `export interface AccountModels { probe: string; classes: { haiku: string | null; sonnet: string | null; opus: string | null; fable: string | null }; subagent: string; discovery: 'catalogue' | string[]; effort: Record<string, string>; catalogue: { fetchedAt: number; stale: boolean; count: number } | null; unclassified: string[]; retired: string[]; available: string[]; labels: Record<string, string> }`
  - `RosterWire` gains `models?: AccountModels | null`
  - `shared/models.ts`: `export function isModelClass(v: unknown): v is ModelClass`

- [ ] **Step 1: Write the failing wire test**

Create `server/test/models-wire.test.ts`:

```ts
// The wire shape §9 declares, pinned as a TOTAL literal rather than a partial
// one: a field added to `AccountModels` and forgotten by a producer is a
// compile error here, which is the whole reason `AccountsResponse` was named
// once rather than restated in three places (`shared/api.ts:2739-2757`).
//
// AND pinned STRUCTURALLY against `shared/models.ts` (C-2). `shared/api.ts` may
// hold exactly one import line, so the wire spells its own field types instead
// of importing `ClassMap`/`Discovery`/`ModelClass`; the assignments below are
// what stop the two drifting.
import { describe, it, expect } from 'vitest';
import type { AccountModels, RosterWire } from '../../shared/api.js';
import { CLASSES, isModelClass } from '../../shared/models.js';
import type { ClassMap, Discovery, Registry } from '../../shared/models.js';

describe('AccountModels — the shape §9 puts on every lane with a registry', () => {
  it('is total: every field the spec names is required, and a literal proves it', () => {
    const m: AccountModels = {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'sonnet',
      discovery: 'catalogue',
      effort: { haiku: 'high', sonnet: 'high', opus: 'max' },
      catalogue: { fetchedAt: 1789000000, stale: false, count: 9 },
      unclassified: ['gpt-6-astra', 'gpt-5.5'],
      retired: [],
      available: ['haiku', 'sonnet', 'opus'],
      labels: { 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-6-astra': 'GPT-6-Astra' },
    };
    expect(m.classes.fable).toBeNull();
    expect(m.available).not.toContain('fable');
    // `subagent` is an explicit CLASS NAME the operator set (spec §4.1,
    // round 2 item 3) — never derived from `classes.sonnet`, which happens to
    // agree here and must not be relied on to.
    expect(m.subagent).toBe('sonnet');
    // `catalogue: null` is NEVER PROBED and is a different fact from a
    // catalogue with an empty model list (spec §4.2) — both must be spellable.
    const neverProbed: AccountModels = { ...m, catalogue: null, unclassified: [], available: [] };
    expect(neverProbed.catalogue).toBeNull();
    // The other `discovery` form: an explicit list, which `openrouter` requires.
    const explicit: AccountModels = { ...m, probe: 'openrouter', discovery: ['anthropic/claude-opus-4.5:beta'] };
    expect(Array.isArray(explicit.discovery)).toBe(true);
  });

  it('accepts every value shared/models.ts can produce — the two shapes agree (C-2)', () => {
    const reg: Registry = {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'sonnet',
      discovery: 'catalogue',
      effort: { opus: 'max' },
    };
    // Each half of the wire assigned FROM the shared type. A `ClassMap` that
    // grew a fifth key, or a `Discovery` that grew a third form, stops
    // compiling here rather than silently never arriving in the browser.
    const classes: AccountModels['classes'] = reg.classes;
    const discovery: AccountModels['discovery'] = [...(reg.discovery === 'catalogue' ? [] : reg.discovery)];
    const probe: AccountModels['probe'] = reg.probe;
    const subagent: AccountModels['subagent'] = reg.subagent;
    expect([classes.opus, discovery.length, probe, subagent])
      .toEqual(['gpt-5.6-sol', 0, 'codex', 'sonnet']);
    // And back: the wire's four-key object IS a ClassMap.
    const backAgain: ClassMap = classes;
    const anyDiscovery: Discovery = reg.discovery;
    expect(backAgain.fable).toBeNull();
    expect(anyDiscovery).toBe('catalogue');
  });

  it('rides on RosterWire, whose rows exist for accounts telemetry never measured (C-1)', () => {
    const row: RosterWire = {
      id: 'gpt', label: 'gpt', hue: 'magenta', homeAble: false, hidden: false, pool: null,
      models: null,
    };
    expect(row.models).toBeNull();
    // ABSENT is a third spelling and must stay legal: an older server, and
    // every existing hand-written literal in the suites, omit the key.
    const older: RosterWire = { id: 'claude', label: 'team·max', hue: 'cyan', homeAble: true, hidden: false, pool: null };
    expect(older.models ?? null).toBeNull();
  });
});

describe('isModelClass', () => {
  it('narrows the wire\'s strings, and answers false for everything else', () => {
    const m: AccountModels['available'] = ['opus', 'ultra'];
    expect(m.filter(isModelClass)).toEqual(['opus']);
    expect(isModelClass(null)).toBe(false);
    expect(isModelClass(4)).toBe(false);
  });

  it('answers true for every class and nothing else — the list is the table, not a copy', () => {
    for (const c of CLASSES) expect(isModelClass(c)).toBe(true);
    expect(CLASSES.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/models-wire.test.ts`
Expected: FAIL — `"AccountModels" is not exported by "../shared/api.ts"`, and `"isModelClass" is not exported by "../shared/models.ts"`.

- [ ] **Step 3: Add `isModelClass` to `shared/models.ts`**

Directly below Plan 1's `CLASSES`/`ModelClass` declarations, add (if Plan 1 already exports it, keep ONE copy and skip this step):

```ts
/** The only way to narrow an untrusted value to a `ModelClass` — the CONSTANT
 *  is cast, never the input, so this is a real type guard rather than an
 *  assertion dressed as one. Same shape as `shared/roster.ts`'s `isHue`.
 *
 *  It exists because the WIRE carries classes as plain strings: `shared/api.ts`
 *  may hold exactly one import line and it must be a type
 *  (`server/test/peers-claims-l0.test.ts` pins that), so no runtime list can
 *  reach it and `AccountModels.available` is `string[]`. Every reader narrows
 *  here — the same arrangement `Wrapper` already documents in that file. */
export function isModelClass(v: unknown): v is ModelClass {
  return typeof v === 'string' && (CLASSES as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Add `AccountModels` to `shared/api.ts`**

Directly ABOVE `export interface RosterWire` (`shared/api.ts:2696`), add:

```ts
/**
 * One lane's model-class registry, as the browser sees it (spec §9).
 *
 * COMPUTED, NEVER STORED. `probe`/`classes`/`subagent`/`discovery`/`effort` are
 * the operator's own `~/.ccrc/models/<id>.classes.json` (spec §4.1), copied
 * through; everything else is derived by `shared/models.ts` from that file and
 * the lane's catalogue, on the server, once per fleet poll. Nothing in the
 * browser re-derives a class — `ccd`'s bash and `shared/models.ts` are already
 * two readers of one rule and a third would drift from both (spec §3, §12's
 * agreement test).
 *
 * THE FIELD TYPES ARE SPELLED HERE rather than imported from
 * `shared/models.ts`. This file may hold exactly ONE import line and it must be
 * a type (`server/test/peers-claims-l0.test.ts` pins it) — a second import line
 * is how a runtime dependency reaches the browser bundle. So `probe` and
 * `subagent` are `string`, `available` is `string[]`, and every read site
 * narrows with `isModelClass` (`shared/models.ts`), which is `Wrapper`'s own
 * doctrine two hundred lines below. `server/test/models-wire.test.ts` assigns
 * each half from the shared type in both directions, so a shape that drifts is
 * a compile error rather than a value that silently never arrives.
 *
 * `catalogue: null` is NEVER PROBED and is a distinct state from a catalogue
 * with an empty `models` array (spec §4.2) — the first says the lane has never
 * been asked, the second says it was asked and advertises nothing, and the
 * Models section renders them differently ("never probed" vs "0 models").
 *
 * `available` is the routing answer and is NOT `Object.keys(classes)` minus the
 * nulls: a class whose id has been RETIRED — absent from a fresh, non-stale
 * catalogue — is unavailable while the registry still names it, because that
 * file is the operator's and ccrc never edits it behind their back (spec §4.3,
 * §11).
 *
 * `labels` is `modelId -> the catalogue's display label`, for the picker and
 * the Models rows. Only ids this lane can show carry an entry; an id the
 * catalogue does not mention (never probed, or retired) simply has none, and
 * every render site falls back to the id itself rather than inventing a name.
 */
export interface AccountModels {
  /** Which catalogue probe this lane runs: `codex | openrouter | compatible`
   *  (spec §5). It names the DISCOVERY mechanism, not an auth provider. */
  probe: string;
  classes: { haiku: string | null; sonnet: string | null; opus: string | null; fable: string | null };
  /** The class `CLAUDE_CODE_SUBAGENT_MODEL` resolves to on this lane — an
   *  explicit choice the operator set, never derived (spec §4.1). */
  subagent: string;
  /** `'catalogue'` (the whole advertised set) or the explicit id list discovery
   *  and classification operate on (spec §4.1). NOT the account-connections
   *  `selectable`, which is a picker permission — the two never alias. */
  discovery: 'catalogue' | string[];
  effort: Record<string, string>;
  catalogue: { fetchedAt: number; stale: boolean; count: number } | null;
  unclassified: string[];
  retired: string[];
  available: string[];
  labels: Record<string, string>;
}
```

- [ ] **Step 5: Add the one row field**

Inside `RosterWire`, after `pool`, add:

```ts
  /** This lane's model-class registry, or `null` when it has none — no
   *  `~/.ccrc/models/<id>.classes.json` on the box (spec §4.1). That covers an
   *  Anthropic lane, whose four aliases are Claude Code's own defaults and
   *  which never has one, and a lane nobody has seeded yet, which spec §13.1
   *  says is VALID and reads as "all classes unavailable". The two are told
   *  apart for DISPLAY by `homeAble` and for nothing else — see
   *  `pwa/src/fleet/ModelsSection.tsx`.
   *
   *  ON THIS ROW AND NOT ON `AccountUsage`, deliberately. `accounts` is built
   *  from `~/.cc-limits/*.json` plus markered-off lanes, so a lane telemetry has
   *  never measured has no row there — which is precisely a freshly connected
   *  OpenRouter or compatible lane. This array is the one that carries every
   *  account the box knows.
   *
   *  OPTIONAL on the type, unlike `hidden` and `pool` above, and the difference
   *  is deliberate: those two are on every row of every roster, so the compiler
   *  is the only thing that can catch a field-by-field rebuild dropping one.
   *  This one is genuinely absent from an older server's payload, and the PWA's
   *  SINGLE reader (`accountModelsOf`, `pwa/src/lib/accounts.ts`) collapses
   *  `undefined` and `null` into "no registry" — the permissive direction. The
   *  handler always sends an explicit `null`, as spec §9 writes it. */
  models?: AccountModels | null;
```

- [ ] **Step 6: Run the wire test and the L0 pin**

Run from `server/`: `npx vitest run test/models-wire.test.ts test/peers-claims-l0.test.ts`
Expected: PASS. `peers-claims-l0` stays green untouched — `shared/api.ts` still has exactly one import line and it is still `import type { Hue } from './roster.js';`.

- [ ] **Step 7: Measured mutation — the guard is `isModelClass`'s constant cast**

Edit `shared/models.ts` and change `isModelClass`'s body to `return typeof v === 'string';`.
Run from `server/`: `npx vitest run test/models-wire.test.ts`
Expected: FAIL — `narrows the wire's strings, and answers false for everything else` fails with `expected [ 'opus', 'ultra' ] to deeply equal [ 'opus' ]`.
Restore the body. Re-run: PASS.

- [ ] **Step 8: Typecheck the three packages**

Run from `<repo>`: `npx tsc -p server --noEmit && npx tsc -p pwa --noEmit && npx tsc -p agent --noEmit`
Expected: no output (exit 0). The new row field is optional, so no existing `RosterWire` literal breaks.

- [ ] **Step 9: Commit**

```bash
git add shared/api.ts shared/models.ts server/test/models-wire.test.ts
git commit -m "feat(wire): every account row can carry its lane's model classes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: the server reads `~/.ccrc/models/` on the accounts poll

Spec §9's first bullet, behaviour. ONE readdir of `~/.ccrc/models/` per `GET /api/accounts`, each lane's registry and catalogue parsed by `shared/models.ts`, one field added to each roster row.

**Files:**
- Create: `server/src/models.ts`
- Create: `server/test/models-derive.test.ts`
- Modify: `server/src/config.ts` (add `modelsDir` to the `CcrcConfig` interface at `:11-32` and to the returned object beside `limitsDir` at `:314`)
- Modify: `server/src/server.ts:1142-1190` (the `/api/accounts` handler — ONE new line after `readLimits`, ONE new field in the `roster:` map)
- Modify: `server/test/helpers.ts:130-137` (`testDeps` gains a roster parameter)
- Modify: `server/test/accounts-route.test.ts` (new describe)
- Modify: `server/test/single-definition.test.ts` (one new describe)
- Idiom copied from: `server/src/limits.ts:110-125` (ONE readdir per poll, then one `readFile` per name — "the registry dir is already being read on every fleet poll and this rides the same trip"); `server/src/limits.ts:170-189` (the roster-membership filter that stops a non-account file becoming a phantom row); `server/test/accounts-route.test.ts:17-44` (`getPayload`, and `AccountsResponse` as the return type rather than a fourth hand-written copy); `server/test/single-definition.test.ts:328-356` (the "constructed in exactly one file" describe shape)

**Interfaces:**
- Consumes (Plan 1): `shared/models.ts`'s `parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry` (throws `RegistryInvalid`), `parseCatalogue(json: unknown): Catalogue` (throws `CatalogueInvalid`), `deriveModels(reg: Registry | null, catalogue: Catalogue | null): DerivedModels` where `DerivedModels = { classified: string[]; unclassified: string[]; retired: string[]; available: ModelClass[] }`, `availableFor(reg: Registry | null, catalogue: Catalogue | null, anthropic: boolean): ModelClass[]`, `interface Catalogue { provider: string; fetchedAt: number; stale: boolean; lastError?: string; models: CatalogueModel[] }`, `interface CatalogueModel { id; label; context; maxContext; efforts: string[]; hidden: boolean; priceIn; priceOut }`. Task 1's `AccountModels`.
- Produces:
  - `server/src/models.ts`: `export interface LaneModels { registry: Registry | null; catalogue: Catalogue | null }`
  - `export async function readModelsDir(io: FleetIO, cfg: CcrcConfig): Promise<Record<string, LaneModels>>`
  - `export function accountModels(lane: LaneModels | undefined): AccountModels | null`
  - `CcrcConfig.modelsDir: string`
  - `testDeps(home?, run?, roster?)` — third parameter, defaulted to `DEFAULT_TEST_ROSTER`

- [ ] **Step 1: Write the failing derivation test**

Create `server/test/models-derive.test.ts`:

```ts
// The one place a `RosterWire.models` value is built. Three questions this file
// answers that no other test can: does ONE readdir serve both file kinds in
// `~/.ccrc/models/`, does an unreadable or absent catalogue read as NEVER
// PROBED rather than as an empty one, and does a lane with no registry file get
// `null` rather than an empty registry it can never fill.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { accountModels, readModelsDir } from '../src/models.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** The gpt lane's registry file as `ccrc models gpt init codex` writes it
 *  (spec §13.1) — luna/terra/sol, no Fable, subagent sonnet. */
const REGISTRY = {
  probe: 'codex',
  classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { haiku: 'high', sonnet: 'high', opus: 'max' },
};

/** Today's Codex catalogue, cut down to what these cases turn on: three classed
 *  ids, one unclassified, one hidden. Spec §1 measured the real nine. */
const CODEX = {
  probe: 'codex', fetchedAt: 1789000000, stale: false,
  models: [
    { id: 'gpt-6-astra', label: 'GPT-6-Astra', context: 272000, maxContext: 872000,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', context: 272000, maxContext: 272000,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', context: 272000, maxContext: 272000,
      efforts: ['low', 'medium', 'high'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', context: 272000, maxContext: 272000,
      efforts: ['low', 'medium', 'high'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-reserve', label: 'GPT reserve', context: null, maxContext: null,
      efforts: ['high'], hidden: true, priceIn: null, priceOut: null },
  ],
};

/** A fixture HOME with `DEFAULT_TEST_ROSTER` (whose `gpt` is the one
 *  non-home-able lane) and whichever of the two model files the case needs. */
function box(over: { registry?: unknown | null; catalogue?: unknown | null } = {}): string {
  const home = mkTmp('ccrc-models-');
  seedRoster(home);
  mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
  const dir = path.join(home, '.ccrc', 'models');
  if (over.registry !== null) writeFileSync(path.join(dir, 'gpt.classes.json'), JSON.stringify(over.registry ?? REGISTRY));
  if (over.catalogue !== null) writeFileSync(path.join(dir, 'gpt.json'), JSON.stringify(over.catalogue ?? CODEX));
  return home;
}

describe('readModelsDir — one readdir, both file kinds, roster members only', () => {
  it('reads a lane\'s registry and catalogue from one listing', async () => {
    const cfg = loadConfig({ CCRC_HOME: box() });
    const lanes = await readModelsDir(localIO, cfg);
    expect(lanes['gpt']?.registry?.classes.opus).toBe('gpt-5.6-sol');
    expect(lanes['gpt']?.catalogue?.models.length).toBe(5);
  });

  it('leaves the materialiser\'s own outputs and an unrostered file out', async () => {
    const home = box();
    const dir = path.join(home, '.ccrc', 'models');
    // The materialiser writes these two beside the registry (spec §6.1, §7).
    writeFileSync(path.join(dir, 'gpt.effort.json'), JSON.stringify({ byModel: {} }));
    writeFileSync(path.join(dir, 'gpt.classes.tsv'), 'haiku\tgpt-5.6-luna\tassigned\n');
    // A catalogue left behind by an account the operator removed.
    writeFileSync(path.join(dir, 'ghost.json'), JSON.stringify(CODEX));
    writeFileSync(path.join(dir, 'ghost.classes.json'), JSON.stringify(REGISTRY));
    const lanes = await readModelsDir(localIO, loadConfig({ CCRC_HOME: home }));
    // `limits.ts`'s own rule, one directory over: a file naming no account must
    // never become a row. There it was `autocompact-disabled`; here it is a
    // stale catalogue and the materialiser's effort map.
    expect(Object.keys(lanes)).toEqual(['gpt']);
    expect(lanes['gpt']?.catalogue?.models.length).toBe(5);
  });

  it('answers a lane with no catalogue file at all as never probed, registry intact', async () => {
    const lanes = await readModelsDir(localIO, loadConfig({ CCRC_HOME: box({ catalogue: null }) }));
    expect(lanes['gpt']?.registry).not.toBeNull();
    expect(lanes['gpt']?.catalogue).toBeNull();
  });

  it('answers null for a catalogue that does not parse, rather than half of one', async () => {
    // Spec §11: a partial catalogue is never written, and a reader that
    // salvaged fields from a broken one would be inventing the very agreement
    // §12's agreement test exists to measure.
    const lanes = await readModelsDir(localIO, loadConfig({ CCRC_HOME: box({ catalogue: { probe: 'codex', models: 'not-a-list' } }) }));
    expect(lanes['gpt']?.catalogue).toBeNull();
  });

  it('answers null for a registry that does not parse — a broken file is not a lane with no classes', async () => {
    const lanes = await readModelsDir(localIO, loadConfig({ CCRC_HOME: box({ registry: { probe: 'codex' } }) }));
    expect(lanes['gpt']?.registry).toBeNull();
  });

  it('answers an empty map when the models directory does not exist', async () => {
    const home = mkTmp('ccrc-models-none-');
    seedRoster(home);
    expect(await readModelsDir(localIO, loadConfig({ CCRC_HOME: home }))).toEqual({});
  });
});

describe('accountModels — what each lane gets', () => {
  it('gives a registered lane its classes, its derived states and its labels', async () => {
    const cfg = loadConfig({ CCRC_HOME: box() });
    const m = accountModels((await readModelsDir(localIO, cfg))['gpt'])!;
    expect(m.probe).toBe('codex');
    expect(m.subagent).toBe('sonnet');
    expect(m.discovery).toBe('catalogue');
    expect(m.classes).toEqual({ haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null });
    expect(m.available).toEqual(['haiku', 'sonnet', 'opus']);
    // The hidden model is NOT unclassified work for the operator (spec §15.6).
    expect(m.unclassified).toEqual(['gpt-6-astra']);
    expect(m.retired).toEqual([]);
    expect(m.catalogue).toEqual({ fetchedAt: 1789000000, stale: false, count: 5 });
    expect(m.labels['gpt-5.6-sol']).toBe('GPT-5.6 Sol');
    expect(m.labels['gpt-6-astra']).toBe('GPT-6-Astra');
  });

  it('gives a lane with NO registry file null — there is nothing to show or edit', async () => {
    const cfg = loadConfig({ CCRC_HOME: box({ registry: null }) });
    expect(accountModels((await readModelsDir(localIO, cfg))['gpt'])).toBeNull();
    // And a lane the directory says nothing about at all.
    expect(accountModels(undefined)).toBeNull();
  });

  it('a never-probed lane keeps its classes and reports no catalogue', async () => {
    const cfg = loadConfig({ CCRC_HOME: box({ catalogue: null }) });
    const m = accountModels((await readModelsDir(localIO, cfg))['gpt'])!;
    expect(m.catalogue).toBeNull();
    expect(m.classes.opus).toBe('gpt-5.6-sol');
    // Nothing is retired, because nothing has been measured: `retired` is a
    // POSITIVE list computed against a catalogue that exists and is fresh
    // (spec §4.3), and inventing one here would take three classes off the air
    // on a box whose first probe has not run yet.
    expect(m.retired).toEqual([]);
    expect(m.labels).toEqual({});
  });

  it('a retired class id makes its class unavailable and names it, registry untouched', async () => {
    // Sol is dropped from the catalogue; the registry still classes opus onto it.
    const gone = { ...CODEX, models: CODEX.models.filter((m) => m.id !== 'gpt-5.6-sol') };
    const cfg = loadConfig({ CCRC_HOME: box({ catalogue: gone }) });
    const m = accountModels((await readModelsDir(localIO, cfg))['gpt'])!;
    expect(m.retired).toContain('gpt-5.6-sol');
    expect(m.available).not.toContain('opus');
    expect(m.classes.opus).toBe('gpt-5.6-sol');   // spec §4.3: the file is the operator's
  });

  it('a stale catalogue retires nothing — the last probe FAILED, it did not report a smaller world', async () => {
    const stale = { ...CODEX, stale: true, models: CODEX.models.filter((m) => m.id !== 'gpt-5.6-sol') };
    const cfg = loadConfig({ CCRC_HOME: box({ catalogue: stale }) });
    const m = accountModels((await readModelsDir(localIO, cfg))['gpt'])!;
    expect(m.retired).toEqual([]);
    expect(m.available).toContain('opus');
    expect(m.catalogue?.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/models-derive.test.ts`
Expected: FAIL — `Failed to resolve import "../src/models.js"`.

- [ ] **Step 3: Add `modelsDir` to the config**

In `server/src/config.ts`, in the `CcrcConfig` interface beside `limitsDir`:

```ts
  /** `~/.ccrc/models` — the per-account registry files the operator owns
   *  (`<id>.classes.json`, spec §4.1) and the catalogue files
   *  `ccrc-models-probe` generates (`<id>.json`, spec §4.2), plus the
   *  materialiser's `<id>.classes.tsv` and `<id>.effort.json`. Sibling of
   *  `accountsPath`, not of `limitsDir`: it is ccrc's own state, not telemetry. */
  modelsDir: string;
```

and in the returned object beside `limitsDir` (`server/src/config.ts:314`):

```ts
    modelsDir: path.join(home, '.ccrc', 'models'),
```

- [ ] **Step 4: Write `server/src/models.ts`**

```ts
import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import type { AccountModels } from '../../shared/api.js';
import {
  availableFor, deriveModels, parseCatalogue, parseRegistry,
  type Catalogue, type Registry,
} from '../../shared/models.js';

/**
 * What `~/.ccrc/models/` holds for one lane: the operator's registry file and
 * the probe's catalogue, each `null` when it is absent or does not parse.
 *
 * A pair rather than two maps because the two are read on one trip and are
 * always consumed together — every derived state (`unclassified`, `retired`,
 * `available`) is a function of both, and a caller holding one without the
 * other would have to invent a rule for the missing half.
 */
export interface LaneModels { registry: Registry | null; catalogue: Catalogue | null }

const CLASSES_SUFFIX = '.classes.json';
const EFFORT_SUFFIX = '.effort.json';

/**
 * Every rostered lane's registry and catalogue, from ONE readdir of
 * `cfg.modelsDir`.
 *
 * `server/src/limits.ts`'s rule, applied to a second directory: one listing per
 * poll, then one read per name it actually needs — never one stat per account.
 * And its OTHER rule, which matters more here: only a name the ROSTER has. The
 * directory also holds `<id>.classes.tsv` and `<id>.effort.json` (the
 * materialiser's own outputs, spec §6.1 and §7) and can hold files left behind
 * by an account the operator removed; none of those is an account, and a reader
 * that turned one into a row would be `limits.ts`'s phantom `autocompact`
 * again.
 *
 * THE ORDER OF THE SUFFIX TESTS IS LOAD-BEARING: `gpt.classes.json` ends in
 * `.json`, so the registry test has to run first or every registry would be
 * offered to `parseCatalogue` and recorded as a corrupt catalogue.
 *
 * A file that does not parse is recorded as `null` — the same value as absent.
 * The two are genuinely different facts (never probed, versus probed and
 * corrupt) and this seam collapses them ON PURPOSE, because the REMEDY is
 * identical (`ccrc models refresh <id>`, or `ccrc models <id> init <probe>`,
 * both of which overwrite) and the surface has one word for each. What must not
 * collapse is either of them into an EMPTY catalogue, which would say the
 * provider advertises nothing — and does not, because `parseCatalogue` throwing
 * lands here rather than in a `{ models: [] }`. `ccrc doctor`'s `models` check
 * is what names a corrupt file specifically.
 */
export async function readModelsDir(
  io: FleetIO, cfg: CcrcConfig,
): Promise<Record<string, LaneModels>> {
  const names = (await io.readdir(cfg.modelsDir)) ?? [];
  const out: Record<string, LaneModels> = {};
  const lane = (id: string): LaneModels => (out[id] ??= { registry: null, catalogue: null });
  for (const n of names) {
    if (n.startsWith('.') || !n.endsWith('.json') || n.endsWith(EFFORT_SUFFIX)) continue;
    const isRegistry = n.endsWith(CLASSES_SUFFIX);
    const id = n.slice(0, -(isRegistry ? CLASSES_SUFFIX : '.json').length);
    if (!cfg.roster.byId.has(id)) continue;
    const text = await io.readFile(path.join(cfg.modelsDir, n));
    if (text === null) { lane(id); continue; }
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRegistry) lane(id).registry = parseRegistry(parsed);
      else lane(id).catalogue = parseCatalogue(parsed);
    } catch {
      // Absent and unparseable read the same here; see this function's header.
      lane(id);
    }
  }
  return out;
}

/**
 * One lane's `RosterWire.models`, or `null` when there is nothing to show.
 *
 * `null` means NO REGISTRY FILE — spec §4.1's "absent file on a non-Anthropic
 * lane = no registry", and the state every Anthropic lane is permanently in,
 * since their four classes are the client's own defaults and never have a file.
 * The two are told apart on the surface by `homeAble`, not by this value.
 *
 * Every derived field comes from `shared/models.ts` — the single definition
 * `ccd`'s bash reader is measured against (spec §12's agreement test) — so this
 * function computes nothing itself and must not start. `availableFor(reg, cat,
 * false)`: the third argument is the CALLER's "is this a lane whose four
 * aliases Claude Code owns" rule (round 2 item 2), and it is `false` by
 * construction here — a lane that HAS a registry file is not one of those.
 */
export function accountModels(lane: LaneModels | undefined): AccountModels | null {
  const reg = lane?.registry ?? null;
  if (reg === null) return null;
  const catalogue = lane?.catalogue ?? null;
  const derived = deriveModels(reg, catalogue);
  // Labels for every id a surface can render — the three derived sets, which
  // between them are exactly the rows the Models section and the picker draw.
  // An id the catalogue does not mention gets no entry and every render site
  // falls back to the id itself, which is the honest display of a model whose
  // name nobody has been told.
  const wanted = new Set<string>([...derived.classified, ...derived.unclassified, ...derived.retired]);
  const labels: Record<string, string> = {};
  if (catalogue !== null) {
    for (const m of catalogue.models) if (wanted.has(m.id)) labels[m.id] = m.label;
  }
  return {
    probe: reg.probe,
    classes: { ...reg.classes },
    subagent: reg.subagent,
    discovery: reg.discovery === 'catalogue' ? 'catalogue' : [...reg.discovery],
    effort: { ...(reg.effort ?? {}) },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    unclassified: derived.unclassified,
    retired: derived.retired,
    available: availableFor(reg, catalogue, false),
    labels,
  };
}
```

- [ ] **Step 5: Run the derivation test**

Run from `server/`: `npx vitest run test/models-derive.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Give `testDeps` a roster parameter**

In `server/test/helpers.ts`, change the signature at `:130`:

```ts
export function testDeps(
  home: string = mkTmp('ccrc-'),
  run: Runner = async () => ({ code: 1, stdout: '', stderr: '' }),
  roster: unknown = DEFAULT_TEST_ROSTER,
): Deps {
  const guarded = guardRunner(run);
  // THE ROSTER IS A PARAMETER because `loadConfig` parses it ONCE, at
  // construction: a test that seeded its own roster and then called `testDeps`
  // had it overwritten by the default before the config ever read it.
  // Defaulted, so every existing caller is byte-identical.
  seedRoster(home, roster);
  const cfg = loadConfig({ CCRC_HOME: home });
  return { cfg, runCcd: ccdRunner(guarded, cfg), tmux: new Tmux(guarded), io: localIO, queue: new KeyedQueue() };
}
```

- [ ] **Step 7: Write the failing route test**

Append to `server/test/accounts-route.test.ts`:

```ts
describe('GET /api/accounts — the model-class registry (spec §9)', () => {
  const REGISTRY = {
    probe: 'codex',
    classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
    subagent: 'sonnet', discovery: 'catalogue', effort: { opus: 'max' },
  };

  const CATALOGUE = {
    probe: 'codex', fetchedAt: 1789000000, stale: false,
    models: [
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', context: 272000, maxContext: 272000,
        efforts: ['low', 'high'], hidden: false, priceIn: null, priceOut: null },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', context: 272000, maxContext: 272000,
        efforts: ['low', 'high'], hidden: false, priceIn: null, priceOut: null },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', context: 272000, maxContext: 272000,
        efforts: ['high', 'max'], hidden: false, priceIn: null, priceOut: null },
      { id: 'gpt-6-astra', label: 'GPT-6-Astra', context: 272000, maxContext: 872000,
        efforts: ['high', 'max', 'ultra'], hidden: false, priceIn: null, priceOut: null },
    ],
  };

  async function modelsBox(): Promise<AccountsResponse> {
    const home = mkTmp('ccrc-accounts-models-');
    mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'models', 'gpt.classes.json'), JSON.stringify(REGISTRY));
    writeFileSync(path.join(home, '.ccrc', 'models', 'gpt.json'), JSON.stringify(CATALOGUE));
    const app = await buildServer(testDeps(home));
    try {
      const res = await app.inject({ method: 'GET', url: '/api/accounts' });
      expect(res.statusCode).toBe(200);
      return res.json() as AccountsResponse;
    } finally {
      await app.close();
    }
  }

  it('carries a classified lane onto the wire, with its derived states and labels', async () => {
    const row = (await modelsBox()).roster.find((r) => r.id === 'gpt');
    expect(row?.models?.probe).toBe('codex');
    expect(row?.models?.subagent).toBe('sonnet');
    expect(row?.models?.classes.opus).toBe('gpt-5.6-sol');
    expect(row?.models?.available).toEqual(['haiku', 'sonnet', 'opus']);
    expect(row?.models?.unclassified).toEqual(['gpt-6-astra']);
    expect(row?.models?.catalogue).toEqual({ fetchedAt: 1789000000, stale: false, count: 4 });
    expect(row?.models?.labels['gpt-5.6-sol']).toBe('GPT-5.6 Sol');
  });

  it('gives every lane with no registry file an explicit null, never an absent key', async () => {
    // Spec §9 writes it as `models: null`, and the PWA's reader collapses
    // `undefined` into it — but the SERVER is not the thing that should be
    // relying on that collapse.
    for (const row of (await modelsBox()).roster.filter((r) => r.id !== 'gpt')) {
      expect(row.models, row.id).toBeNull();
      expect(Object.hasOwn(row, 'models'), row.id).toBe(true);
    }
  });

  it('ships no registry internals the browser has no use for', async () => {
    // `RosterWire`'s own rule, extended: `models` is a DERIVED projection, so
    // the raw `exec` must still not appear anywhere on this response, and
    // neither may a lane's `baseUrl` (spec §4.1's `compatible` credential path).
    const payload = JSON.stringify(await modelsBox());
    expect(payload).not.toContain('configDirSuffix');
    expect(payload).not.toContain('secretsFile');
    expect(payload).not.toContain('baseUrl');
    expect(payload).not.toContain('"kind"');
  });
});
```

Add whatever imports that file does not already carry: `mkdirSync`/`writeFileSync` from `node:fs`, `path`, `mkTmp` from `./tmpHelpers.js`.

- [ ] **Step 8: Run it and watch it fail**

Run from `server/`: `npx vitest run test/accounts-route.test.ts`
Expected: FAIL — the three new cases fail with `expected undefined to be 'codex'` and `expected false to be true` (the handler emits no `models` field yet).

- [ ] **Step 9: Fill the field in the `/api/accounts` handler**

In `server/src/server.ts`, add the import beside the `limits.js` one:

```ts
import { accountModels, readModelsDir } from './models.js';
```

Directly AFTER the existing `const limits = await readLimits(deps.io, deps.cfg);` (`server/src/server.ts:1143`) — that line is not moved, edited or wrapped — add:

```ts
    // ONE READDIR, on the poll that already reads `.cc-limits` and
    // `.cc-sessions`. SEQUENTIAL, not folded into a `Promise.all` with the line
    // above, and that is deliberate rather than lazy: account-pools wave 3
    // lands its untagged-forecast change in this same handler, and a
    // restructured first line is a conflict where an inserted second line is
    // not. The cost is one `readdir` of a directory holding a handful of small
    // JSON files.
    const laneModels = await readModelsDir(deps.io, deps.cfg);
```

and add ONE field to the `roster:` mapping at `server/src/server.ts:1186-1189`, after `pool: a.pool,`:

```ts
        // Spec §9. `accountModels` answers `null` for a lane with no registry
        // file, which is every Anthropic lane and every lane nobody has seeded
        // yet (spec §4.1, §13.1) — the browser tells those two apart with
        // `homeAble`, for display only.
        models: accountModels(laneModels[a.id]),
```

- [ ] **Step 10: Run the route test**

Run from `server/`: `npx vitest run test/accounts-route.test.ts`
Expected: PASS, all cases (the pre-existing ones plus the three new).

- [ ] **Step 11: Measured mutation #1 — the registry suffix is tested before the plain `.json`**

Edit `server/src/models.ts` and move the `isRegistry` computation below the `id` computation so `id` is always `n.slice(0, -'.json'.length)`:
`const id = n.slice(0, -'.json'.length); const isRegistry = n.endsWith(CLASSES_SUFFIX);`
Run from `server/`: `npx vitest run test/models-derive.test.ts`
Expected: FAIL — `reads a lane's registry and catalogue from one listing` fails with `expected undefined to be 'gpt-5.6-sol'`: `gpt.classes.json` is filed under the id `gpt.classes`, which the roster does not have, so the lane loses its registry entirely.
Restore. Re-run: PASS.

- [ ] **Step 12: Measured mutation #2 — the roster-membership filter**

Edit `server/src/models.ts` and delete `if (!cfg.roster.byId.has(id)) continue;`.
Run from `server/`: `npx vitest run test/models-derive.test.ts -t "leaves the materialiser"`
Expected: FAIL — `expected [ 'ghost', 'gpt' ] to deeply equal [ 'gpt' ]`: a removed account's leftovers become a row.
Restore. Re-run: PASS.

- [ ] **Step 13: Add the single-definition pin**

Append to `server/test/single-definition.test.ts`:

```ts
describe('one producer of AccountModels', () => {
  // `shared/models.ts`'s `deriveModels` is the single definition ccd's bash
  // reader is measured against (spec §12's agreement test). A second server
  // file calling it would be a second place the wire shape is assembled, and
  // the two would answer differently the first time one of them grew a field.
  it('deriveModels is called in exactly one file under server/src, and it is models.ts', () => {
    const callers = ALL
      .filter((p) => rel(p).startsWith('server/src/'))
      .filter((p) => /\bderiveModels\s*\(/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(callers).toEqual(['server/src/models.ts']);
  });

  it('and the scan is looking at something — that file really calls it', () => {
    expect(readFileSync(path.join(ccrcRoot, 'server', 'src', 'models.ts'), 'utf8'))
      .toContain('deriveModels(');
  });

  // The BASH corpus is where `holdersOf` looks, and it can never see a `.ts`
  // file (`:1118-1119` keeps only extensionless shebang scripts), so the
  // TypeScript side of "who names ~/.ccrc/models" needs its own assertion or it
  // has none. One spelling, in `config.ts`, reached everywhere else through
  // `cfg.modelsDir` — the arrangement `limitsDir` already has.
  it("~/.ccrc/models is spelled once under server/src, and that once is config.ts", () => {
    const spellers = ALL
      .filter((p) => rel(p).startsWith('server/src/'))
      .filter((p) => readFileSync(p, 'utf8').includes("'.ccrc', 'models'")
                  || readFileSync(p, 'utf8').includes('.ccrc/models'))
      .map(rel);
    expect(spellers).toEqual(['server/src/config.ts']);
  });
});
```

- [ ] **Step 13b: Widen the exact-match list this task's new file reds**

`server/src/models.ts` declares `const CLASSES_SUFFIX = '.classes.json'`, and Plan 1
Task 12's `MODELS_CORPUS` includes `ALL` (every `.tsx?` under `shared/`, `server/src/`,
`pwa/src/`, `agent/src/`), so Plan 1's exact-match case `the REGISTRY file is named by
exactly two files, and edited by one of them` is now RED. That is the guard working. This
file NAMES the registry file and does not edit it — its only fs calls are `io.readdir` and
`io.readFile`, so the describe's neighbouring "who writes it" cases stay untouched. Add
the row, in `rel`'s own sort order:

```ts
    expect(spell('classes.json')).toEqual([
      'deploy/models-op.mjs',   // the verbs' node half — the one WRITER
      'server/src/models.ts',   // the accounts poll's reader (this plan, Task 2)
      'shared/models.ts',       // the type's header names the path
    ]);
```

Do **not** turn the list into a pattern: Plan 1's own comment says it grows by name, and
the case's whole value is that a THIRD writer of the operator's own classification would
have to be added here, by hand, in front of a reviewer.

- [ ] **Step 14: Run the scans and the server files touched here**

Run from `server/`: `npx vitest run test/single-definition.test.ts test/models-derive.test.ts test/accounts-route.test.ts test/models-wire.test.ts`
Expected: PASS — and, before Step 13b, RED on exactly `the REGISTRY file is named by exactly two files, and edited by one of them`.

- [ ] **Step 15: Typecheck and commit**

Run from `<repo>`: `npx tsc -p server --noEmit` — no output.

```bash
git add server/src/models.ts server/src/config.ts server/src/server.ts server/test/models-derive.test.ts server/test/accounts-route.test.ts server/test/helpers.ts server/test/single-definition.test.ts
git commit -m "feat(server): the accounts poll reads each lane's registry and catalogue in one trip, and derives its classes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: the `ccrc` exec seam — grants, branded argv, runner

Spec §9: every mutation "execs `ccrc models <id> …` through the agent (whitelisted verbs)". `ccrc` becomes the SECOND command the agent may exec, beside `ccd`. Grant and builder land together: a grant nothing builds is a dead grant (`server/test/whitelist-subset.test.ts`'s layer 3 fails on one) and a builder with no grant answers `502 forbidden` on the fleet forever.

**Files:**
- Modify: `agent/src/whitelist.ts:134` (`EXEC_COMMANDS`), `:266` (`UNGRANTABLE_VERBS`), `:580-585` (that list's refusal sentence), `:319-405` (`EXEC_WHITELIST`)
- Modify: `agent/src/server.ts:227-229` (`resolveSpawnCmd`)
- Modify: `agent/test/types/ok/legit-whitelist.ts`
- Modify: `agent/test/whitelist.test.ts` (behavioural grants)
- Create: `server/src/ccrcargv.ts`
- Modify: `server/src/lifecycle.ts` (add the ccrc runner beside `ccdRunner`)
- Modify: `server/src/config.ts` (add `ccrcBin` beside `ccdBin`)
- Modify: `server/src/server.ts` (`Deps`), `server/src/index.ts` (both wirings)
- Modify: `server/src/remote/runner.ts:12-17, 92-101, 137-139` (timeouts + `wireCmd`)
- Modify: `server/test/helpers.ts` (`testDeps` gains `runCcrc`)
- Create: `server/test/ccrcargv.test.ts`
- Modify: `server/test/whitelist-subset.test.ts` (layer 2 and layer 3 for `ccrc`)
- Idiom copied from: `server/src/ccdargv.ts:1-47` (the phantom brand + the single `argv()` mint site + `Object.freeze`); `agent/src/whitelist.ts:206-266` (`REQUIRED_VERB_FLAG`'s "two tokens wide, not one" doctrine, and `UNGRANTABLE_VERBS`' "a compile error and a boot failure, not a one-line diff"); `server/test/whitelist-subset.test.ts:82-90` (layer 2's `it.each` over the argv table) and `:113-158` (layer 3's object-reading key and reachability assertions); `agent/test/types/ok/legit-whitelist.ts:44-48` (the EXACT-membership `Equals` assertion)

**Interfaces:**
- Consumes: Plan 1's verbs (spec §10) — `ccrc models <id> set-class <class> <modelId|none>`, `ccrc models <id> set-subagent <class>`, `ccrc models <id> set-effort <class> <level|default>`, `ccrc models <id> discovery add|rm <modelId>`, `ccrc models <id> discovery catalogue`, `ccrc models refresh <id>`. Exit 0 ok, 1 refusal with the reason on stderr, 2 usage.
- Produces:
  - `agent/src/whitelist.ts`: `EXEC_COMMANDS = ['tmux','ccd','ccrc']`, `EXEC_WHITELIST.ccrc = [['models']]`, seven new `UNGRANTABLE_VERBS`
  - `server/src/ccrcargv.ts`: `export type CcrcArgv` (branded) and `export const CCRC_ARGV` with `modelsSetClass`, `modelsSetSubagent`, `modelsSetEffort`, `modelsDiscoveryAdd`, `modelsDiscoveryRm`, `modelsDiscoveryCatalogue`, `modelsRefresh`
  - `server/src/lifecycle.ts`: `export type CcrcRunner = (argv: CcrcArgv) => Promise<CcdResult>` and `export const ccrcRunner: (run: Runner, cfg: CcrcConfig) => CcrcRunner`
  - `Deps.runCcrc: CcrcRunner` (REQUIRED)
  - `CcrcConfig.ccrcBin: string`

- [ ] **Step 1: Write the failing agent grant test**

Append to `agent/test/whitelist.test.ts`:

```ts
describe('the ccrc grants (spec §9 — the server never writes the registry itself)', () => {
  it('permits every model verb the routes build', () => {
    expect(isExecAllowed('ccrc', ['models', 'gpt', 'set-class', 'opus', 'gpt-5.6-sol'])).toBe(true);
    expect(isExecAllowed('ccrc', ['models', 'gpt', 'set-subagent', 'haiku'])).toBe(true);
    expect(isExecAllowed('ccrc', ['models', 'gpt', 'set-effort', 'opus', 'max'])).toBe(true);
    expect(isExecAllowed('ccrc', ['models', 'gpt', 'discovery', 'add', 'gpt-6-astra'])).toBe(true);
    expect(isExecAllowed('ccrc', ['models', 'refresh', 'gpt'])).toBe(true);
  });

  it('permits NOTHING else under ccrc — `models` is the whole grant', () => {
    // Every other verb `ccd/ccrc`'s dispatcher has (measured: `case "$VERB"` at
    // ccd/ccrc:6529-6543). `install`/`update` converge the box from a tree,
    // `uninstall` removes it, `passwd` rotates the auth secret and signs every
    // device out, `expose` rewrites the public surface, `adopt` rewrites the
    // roster from disk, `backup` copies the box's state somewhere.
    for (const argv of [['install'], ['uninstall'], ['update'], ['passwd'], ['expose'],
                        ['adopt'], ['backup'], ['doctor'], ['wrappers'], ['status'],
                        ['logs'], ['version'], []]) {
      expect(isExecAllowed('ccrc', argv), argv.join(' ') || '(empty)').toBe(false);
    }
  });

  it('refuses a path-shaped ccrc, exactly as it refuses a path-shaped ccd', () => {
    // The agent resolves a BARE name against its own home; anything with a
    // slash is a different binary wearing the same last segment.
    expect(isExecAllowed('/tmp/evil/ccrc', ['models', 'refresh', 'gpt'])).toBe(false);
  });

  it('makes the box-changing ccrc verbs ungrantable outright', () => {
    for (const verb of ['install', 'uninstall', 'update', 'passwd', 'expose', 'adopt', 'backup']) {
      expect(() => auditExecWhitelist({ ...EXEC_WHITELIST, ccrc: [[verb]] }), verb)
        .toThrow(/grants the ungrantable verb/);
    }
  });

  it('resolves a bare ccrc to the launcher deploy installs, not to PATH', () => {
    // `deploy/deploy.sh`'s `install_ccrc_shim` writes `~/.local/bin/ccrc`, and
    // a systemd user unit's default PATH does not include it — the same reason
    // `ccd` is resolved explicitly here.
    expect(resolveSpawnCmd('ccrc', '/home/box')).toBe('/home/box/.local/bin/ccrc');
    expect(resolveSpawnCmd('tmux', '/home/box')).toBe('tmux');
  });
});
```

Add to that file's imports whatever it does not already carry: `auditExecWhitelist`, `EXEC_WHITELIST` from `../src/whitelist.js`, and `resolveSpawnCmd` from `../src/server.js`.

- [ ] **Step 2: Run it and watch it fail**

Run from `agent/`: `npx vitest run test/whitelist.test.ts`
Expected: FAIL — the first case fails `expected false to be true` (no `ccrc` key), and `resolveSpawnCmd('ccrc', …)` answers `'ccrc'`.

- [ ] **Step 3: Widen the agent whitelist**

In `agent/src/whitelist.ts`, at `:134`:

```ts
export const EXEC_COMMANDS = ['tmux', 'ccd', 'ccrc'] as const;
```

Directly above it, extend the docstring's closing paragraph with:

```
 * `ccrc` JOINS THE SET (spec §9), and the argument for it is the argument this
 * list makes for `ccd`: the model-class registry is a file only the box may
 * write, the server has no filesystem authority over `~/.ccrc` at all (FleetIO
 * can write nothing outside `~/.cc-clips` and has no unlink), and the
 * alternative — a route that edits `<id>.classes.json` itself — would put a
 * second writer beside `ccrc models` with no lock between them and no
 * re-materialise after it. What keeps the grant narrow is the PREFIX below and
 * `UNGRANTABLE_VERBS`, not the command name: `ccrc` also carries `install`,
 * `uninstall`, `update`, `passwd`, `expose`, `adopt` and `backup`, every one of
 * which changes the box, and every one of which is now ungrantable.
```

Replace `UNGRANTABLE_VERBS` at `:266`:

```ts
export const UNGRANTABLE_VERBS = [
  'ws-rm', 'ws-gc',
  // The `ccrc` half (spec §9). Each of these changes the BOX rather than a
  // session, no route builds any of them, and none ever should. Listing them
  // here makes re-admitting one a compile error and a boot failure rather than
  // a one-line diff that reads as ordinary. None is a `ccd` verb (measured
  // against `ccd/ccd`'s own dispatcher `case` and against `EXEC_WHITELIST.ccd`
  // below), so this widening changes nothing about the ccd grants.
  'install', 'uninstall', 'update', 'passwd', 'expose', 'adopt', 'backup',
] as const;
```

And widen that list's own refusal sentence, which today names only its two ccd
members and would now mislead a reader who tripped it on `ccrc passwd`
(`agent/src/whitelist.ts:580-585`):

```ts
        refuseToBoot(
          `EXEC_WHITELIST['${key}'] grants the ungrantable verb '${verb!}' ` +
          `(${tokens.join(' ')}). ws-rm is the unguarded legacy delete, ws-gc carries --prune, ` +
          'and the seven ccrc verbs listed there each change the BOX — install, uninstall, ' +
          'update, passwd, expose, adopt, backup.',
        );
```

Inside `EXEC_WHITELIST`, after the `ccd:` array, add:

```ts
  // Spec §9. ONE prefix, ONE token wide, and the narrower grant this file's
  // `REQUIRED_VERB_FLAG` doctrine would want CANNOT BE WRITTEN: that mechanism
  // pins the token at index 1, and spec §10 puts the ACCOUNT ID there
  // (`ccrc models gpt set-class opus gpt-5.6-sol`). There is no constant second
  // token to require.
  //
  // What that admits, stated rather than left to be discovered: `ccrc models
  // litellm <id>`, which renders LiteLLM's config and restarts it (spec §6.3),
  // failing every gpt turn in flight once. That restart is ALREADY reachable
  // through the granted `ccrc models refresh <id>`, which performs the same
  // step when the visible model set changed — so the grant's blast radius is
  // the one the routes already have, and it stops at the model registry.
  //
  // What actually keeps `litellm`, `init` and `refresh --all` unreachable is
  // the server side: `Deps.runCcrc` takes a branded `CcrcArgv` that only
  // `server/src/ccrcargv.ts` can mint, that table builds none of them, and
  // `server/test/whitelist-subset.test.ts` enumerates it against this list in
  // both directions.
  ccrc: [
    ['models'],
  ],
```

- [ ] **Step 4: Resolve a bare `ccrc` in the agent**

In `agent/src/server.ts:227-229`:

```ts
/** Resolve a whitelisted bare command to a spawnable path. `ccd` and `ccrc`
 *  both live in `~/.local/bin`, which is NOT on a systemd user unit's default
 *  PATH, so both must be resolved explicitly; `tmux` is a distro binary and
 *  PATH suffices. `~/.local/bin/ccrc` is a LAUNCHER, not the script — it execs
 *  the shipped tree so that bash resolves the check table, the wrapper-shape
 *  library and the shipped package.json relative to it (`deploy/deploy.sh`'s
 *  `install_ccrc_shim` says why). Spawning it is therefore correct and
 *  spawning the tree copy directly would not be. */
export function resolveSpawnCmd(cmd: string, home: string): string {
  return cmd === 'ccd' || cmd === 'ccrc' ? path.join(home, '.local', 'bin', cmd) : cmd;
}
```

- [ ] **Step 5: Update the positive type control**

In `agent/test/types/ok/legit-whitelist.ts`:

```ts
/** EXACT membership, not a subset check: `Equals`, so ADDING a command is a
 *  build failure here as well as in `whitelist.ts`'s disjointness proof. `ccrc`
 *  joined the set for spec §9's routes; a THIRD addition must still break this
 *  line. */
export type ExecCommandIsExactlyTmuxCcdAndCcrc = Assert<Equals<ExecCommand, 'tmux' | 'ccd' | 'ccrc'>>;
```

Give both tables their `ccrc` key (`ExecWhitelist` is `Record<ExecCommand, …>`, so a missing key is TS2741):

```ts
export const good = {
  tmux: [['has-session'], ['capture-pane']],
  ccd: [['start'], ['ws-reap', '--expect']],
  ccrc: [['models']],
} as const satisfies ExecWhitelist;
```

```ts
const lawfulTable = {
  tmux: [['has-session'], ['capture-pane']],
  ccd: [['start'], ['ws-audit', '--session'], ['ws-reap', '--expect']],
  ccrc: [['models']],
} as const satisfies ExecWhitelist;
export const lawful: LawfulGrants<typeof lawfulTable> = lawfulTable;
```

Add the ungrantable assertions beside `ReapNeedsExpect`:

```ts
/** The box-changing ccrc verbs stay unreachable whatever a future route claims
 *  — the only compile-time control on this command, since its account id sits
 *  where `REQUIRED_VERB_FLAG` would need a constant (spec §10). */
export type InstallIsUngrantable = Assert<'install' extends (typeof UNGRANTABLE_VERBS)[number] ? true : false>;
export type PasswdIsUngrantable = Assert<'passwd' extends (typeof UNGRANTABLE_VERBS)[number] ? true : false>;
```

and one live call beside `allowed`:

```ts
export const allowedCcrc: boolean = isExecAllowed('ccrc', ['models', 'gpt', 'set-class', 'opus', 'gpt-5.6-sol']);
```

- [ ] **Step 6: Run the agent suite**

Run from `agent/`: `npx vitest run test/whitelist.test.ts test/whitelist-structural.test.ts test/whitelist-noghosts.test.ts test/exec.test.ts`
Expected: PASS. If `whitelist-noghosts.test.ts` asserts a two-key list, widen its expectation to `['ccd','ccrc','tmux']` in place and keep its `gh` assertions untouched.

Run from `<repo>`: `npx tsc -p agent --noEmit`
Expected: no output.

- [ ] **Step 7: Write the failing argv-table test**

Create `server/test/ccrcargv.test.ts`:

```ts
// `CCRC_ARGV` is the ONLY place a ccrc argv is built, for `CCD_ARGV`'s reason:
// `Deps.runCcrc` takes a branded `CcrcArgv` and nothing outside `ccrcargv.ts`
// can mint one, so "every ccrc argv is built here" is a property of the type
// rather than of a source-text scan (which was defeated four times in four
// rounds — see `server/src/ccdargv.ts`).
//
// It carries MORE weight here than it does for ccd: the agent's ccrc grant is
// one token wide because spec §10 puts the account id where a second constant
// token would have to be (C-4), so this table is the thing that keeps
// `ccrc models litellm`, `ccrc models <id> init` and `ccrc models refresh
// --all` unbuildable.
import { describe, it, expect } from 'vitest';
import { CCRC_ARGV } from '../src/ccrcargv.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';

describe('CCRC_ARGV builds exactly the verbs the routes need', () => {
  it('set-class, with `none` for a cleared slot', () => {
    expect([...CCRC_ARGV.modelsSetClass('gpt', 'opus', 'gpt-5.6-sol')])
      .toEqual(['models', 'gpt', 'set-class', 'opus', 'gpt-5.6-sol']);
    // `null` is the CLEAR, and the verb spells it `none` — the registry's own
    // `classes.<c>: null` in the one vocabulary a bash `case` can match.
    expect([...CCRC_ARGV.modelsSetClass('gpt', 'fable', null)])
      .toEqual(['models', 'gpt', 'set-class', 'fable', 'none']);
  });

  it('set-subagent, which takes a CLASS and never a model id', () => {
    expect([...CCRC_ARGV.modelsSetSubagent('gpt', 'haiku')])
      .toEqual(['models', 'gpt', 'set-subagent', 'haiku']);
  });

  it('set-effort, with `default` for a cleared level', () => {
    expect([...CCRC_ARGV.modelsSetEffort('gpt', 'opus', 'max')])
      .toEqual(['models', 'gpt', 'set-effort', 'opus', 'max']);
    expect([...CCRC_ARGV.modelsSetEffort('gpt', 'haiku', null)])
      .toEqual(['models', 'gpt', 'set-effort', 'haiku', 'default']);
  });

  it('the three discovery forms', () => {
    expect([...CCRC_ARGV.modelsDiscoveryAdd('or', 'anthropic/claude-opus-4.5:beta')])
      .toEqual(['models', 'or', 'discovery', 'add', 'anthropic/claude-opus-4.5:beta']);
    expect([...CCRC_ARGV.modelsDiscoveryRm('or', 'x/y')])
      .toEqual(['models', 'or', 'discovery', 'rm', 'x/y']);
    expect([...CCRC_ARGV.modelsDiscoveryCatalogue('gpt')])
      .toEqual(['models', 'gpt', 'discovery', 'catalogue']);
  });

  it('refresh names ONE lane — never --all, which is the timer\'s entry point', () => {
    expect([...CCRC_ARGV.modelsRefresh('gpt')]).toEqual(['models', 'refresh', 'gpt']);
    const built = Object.values(CCRC_ARGV).map((f) => [...(f as (...a: never[]) => readonly string[])(
      ...(['gpt', 'opus', 'x'] as never[]))]);
    for (const argv of built) expect(argv).not.toContain('--all');
  });

  it('builds no litellm and no init — the two verbs no route may reach (spec §6.3, §13.1)', () => {
    const built = Object.values(CCRC_ARGV).map((f) => [...(f as (...a: never[]) => readonly string[])(
      ...(['gpt', 'opus', 'x'] as never[]))].join(' '));
    for (const argv of built) {
      expect(argv).not.toContain('litellm');
      expect(argv).not.toContain('init');
    }
  });

  it('every entry is frozen at the mint site, so Object.assign cannot rewrite one in place', () => {
    const argv = CCRC_ARGV.modelsRefresh('gpt');
    expect(Object.isFrozen(argv)).toBe(true);
    expect(() => Object.assign(argv as unknown as string[], ['install'])).toThrow();
  });

  it('every entry crosses the agent whitelist — a builder with no grant is a permanent 502', () => {
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsSetClass('gpt', 'opus', 'gpt-5.6-sol')])).toBe(true);
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsSetSubagent('gpt', 'sonnet')])).toBe(true);
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsSetEffort('gpt', 'opus', 'max')])).toBe(true);
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsDiscoveryAdd('gpt', 'a')])).toBe(true);
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsDiscoveryRm('gpt', 'a')])).toBe(true);
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsDiscoveryCatalogue('gpt')])).toBe(true);
    expect(isExecAllowed('ccrc', [...CCRC_ARGV.modelsRefresh('gpt')])).toBe(true);
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run from `server/`: `npx vitest run test/ccrcargv.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ccrcargv.js"`.

- [ ] **Step 9: Write `server/src/ccrcargv.ts`**

```ts
import type { ModelClass } from '../../shared/models.js';

declare const CcrcArgvBrand: unique symbol;

/**
 * A ccrc argv that provably came from `CCRC_ARGV`. The brand is phantom — it
 * exists only in the type system — so this costs nothing at runtime, and an
 * ordinary `string[]` (however it was built or named) is not assignable to it.
 *
 * `CcdArgv`'s mechanism, in a second file rather than as a second member of the
 * first: they are DIFFERENT capabilities. `Deps.runCcd` and `Deps.runCcrc` bind
 * different binaries with different grants, and one brand covering both would
 * make a ccd argv assignable where a ccrc argv is demanded — which is exactly
 * the confusion a nominal brand exists to prevent.
 *
 * The residual class is `ccdargv.ts`'s and is not restated: a deliberate cast,
 * array covariance, and an `any`-typed value flowing in uncast all still reach
 * a runner, and no stronger brand closes them.
 */
export type CcrcArgv = readonly string[] & { readonly [CcrcArgvBrand]: true };

/** The ONE place a `string[]` becomes a `CcrcArgv`. Frozen for `argv()`'s own
 *  reason in `ccdargv.ts`: without it `Object.assign(CCRC_ARGV.modelsRefresh('gpt'),
 *  ['install'])` types as `CcrcArgv & string[]` — no cast anywhere — and mutates
 *  the real argv in place. */
const argv = (parts: readonly string[]): CcrcArgv => Object.freeze(parts) as CcrcArgv;

/**
 * The ONLY place a ccrc argv is constructed, and — unusually — the primary
 * control on what the routes may run.
 *
 * The agent's grant for `ccrc` is the single prefix `['models']`, one token
 * wide, because `isExecAllowed` is prefix matching and spec §10 puts the
 * ACCOUNT ID at index 1 (`ccrc models gpt set-class …`), where
 * `REQUIRED_VERB_FLAG` would need a constant. So the grant admits every
 * `ccrc models …` form and this table is what the server can actually build.
 * `whitelist-subset.test.ts` enumerates it against `EXEC_WHITELIST.ccrc` in
 * both directions.
 *
 * NO `models litellm`, NO `models <id> init` AND NO `models refresh --all`
 * ENTRY, deliberately. The LiteLLM render restarts a running proxy under live
 * gpt sessions (spec §6.3) and `refresh` performs that step itself when the
 * visible set changed; `init` CREATES a lane's registry file from a seeded
 * mapping and is a migration step the operator runs on the box (spec §13.1);
 * `--all` is `ccrc-models.timer`'s entry point (spec §5), and a route that
 * fired it would probe every provider on one operator's tap.
 */
export const CCRC_ARGV = {
  /** `modelId === null` CLEARS the slot. The registry spells a cleared class
   *  `null`; the verb's positional vocabulary spells it `none`, because a bash
   *  `case` cannot match an absent argument apart from an empty one. The
   *  translation happens here, once. */
  modelsSetClass: (id: string, cls: ModelClass, modelId: string | null) =>
    argv(['models', id, 'set-class', cls, modelId ?? 'none']),
  /** A CLASS NAME, never a model id (spec §4.1): `subagent` is the operator's
   *  explicit class-to-slot choice, and the verb refuses a class whose slot is
   *  null. There is no "clear" form — a lane always resolves
   *  `CLAUDE_CODE_SUBAGENT_MODEL` to some class. */
  modelsSetSubagent: (id: string, cls: ModelClass) =>
    argv(['models', id, 'set-subagent', cls]),
  /** `level === null` returns the class to the provider's own default for that
   *  model (spec §4.1) — `default`, and not the empty string, for
   *  `set-class`'s reason two entries up. */
  modelsSetEffort: (id: string, cls: ModelClass, level: string | null) =>
    argv(['models', id, 'set-effort', cls, level ?? 'default']),
  modelsDiscoveryAdd: (id: string, modelId: string) =>
    argv(['models', id, 'discovery', 'add', modelId]),
  modelsDiscoveryRm: (id: string, modelId: string) =>
    argv(['models', id, 'discovery', 'rm', modelId]),
  modelsDiscoveryCatalogue: (id: string) =>
    argv(['models', id, 'discovery', 'catalogue']),
  /** ONE lane, always named. See the table's own note on `--all`. */
  modelsRefresh: (id: string) => argv(['models', 'refresh', id]),
} as const;
```

- [ ] **Step 10: Add `ccrcBin`, the runner and the dependency**

`server/src/config.ts`, in `CcrcConfig` beside `ccdBin`:

```ts
  /** `~/.local/bin/ccrc` — the LAUNCHER `deploy/deploy.sh`'s
   *  `install_ccrc_shim` writes, which execs the shipped tree. Local mode
   *  spawns this path directly; remote mode sends the bare name and the agent
   *  re-resolves it against ITS home (`wireCmd`). */
  ccrcBin: string;
```

and in the returned object beside `ccdBin:`:

```ts
    ccrcBin: path.join(home, '.local', 'bin', 'ccrc'),
```

`server/src/lifecycle.ts`, directly after `ccdRunner`:

```ts
/** Run `ccrc <args...>` through the injected Runner; ok = exit code 0.
 *
 *  `CcdResult` is REUSED rather than twinned: the three facts a caller reads —
 *  did it succeed, what did it say, was it cut short — are measured the same
 *  way for both binaries by the same `Runner`, and a byte-identical second
 *  interface would be a second thing to keep in step with `cutShort`, which is
 *  deliberately the single reader of the `killed`/`signal` pair. */
export async function ccrc(run: Runner, cfg: CcrcConfig, args: CcrcArgv): Promise<CcdResult> {
  const r = await run(cfg.ccrcBin, [...args]);
  return {
    ok: r.code === 0, stdout: r.stdout, stderr: r.stderr,
    killed: r.killed === undefined ? UNMEASURED : r.killed,
    signal: r.signal === undefined ? UNMEASURED : r.signal,
  };
}

/** The single ccrc capability `Deps` carries in place of a raw `Runner` —
 *  `CcdRunner`'s reason, for the second binary. */
export type CcrcRunner = (argv: CcrcArgv) => Promise<CcdResult>;

export const ccrcRunner = (run: Runner, cfg: CcrcConfig): CcrcRunner =>
  (argv) => ccrc(run, cfg, argv);
```

with `import type { CcrcArgv } from './ccrcargv.js';` added at the top of that file.

`server/src/server.ts`, in `Deps` directly under `runCcd`:

```ts
  /** The ONLY path to `ccrc`, on `runCcd`'s terms and for its reason: no raw
   *  `run` here, so the parameter type is the proof of origin. REQUIRED, not
   *  optional — an optional capability with a local fallback is how a second,
   *  differently-configured runner gets built with every suite green (the
   *  `queue` field's own argument). */
  runCcrc: CcrcRunner;
```

with `CCRC_ARGV` imported from `./ccrcargv.js` and `type CcrcRunner`, `ccrcRunner` from `./lifecycle.js`.

`server/src/index.ts`, in BOTH `Deps` literals, add beside `runCcd`:

```ts
    runCcrc: ccrcRunner(fleet.runner, cfg),
```
```ts
    runCcrc: ccrcRunner(realRunner, cfg),
```

with `import { ccdRunner, ccrcRunner } from './lifecycle.js';`.

`server/test/helpers.ts`, in `testDeps`'s return:

```ts
  return {
    cfg, runCcd: ccdRunner(guarded, cfg), runCcrc: ccrcRunner(guarded, cfg),
    tmux: new Tmux(guarded), io: localIO, queue: new KeyedQueue(),
  };
```

with `ccrcRunner` added to that file's `../src/lifecycle.js` import.

- [ ] **Step 11: Teach the remote runner about `ccrc`**

`server/src/remote/runner.ts`:

```ts
const CCD_TIMEOUT_MS = 90_000;
const CCRC_TIMEOUT_MS = 60_000;
```

Beside `CCD_VERB_TIMEOUT_MS`, add:

```ts
/** Per-verb budgets for `ccrc`. `models` is the only granted verb and it is the
 *  one that leaves the box: `refresh` runs the lane's provider probe (spec §5 —
 *  a Codex or OpenRouter HTTP call plus, for a Codex lane whose visible set
 *  changed, the LiteLLM render and restart), so the flat 60 s is wrong for it in
 *  the same way the flat 90 s was wrong for `ws-reap`. 180 s is inside the
 *  agent's own `MAX_EXEC_TIMEOUT_MS` (300 s) with room to spare, and it covers
 *  the local edits (`set-class`, `discovery`) too, which need none of it. */
const CCRC_VERB_TIMEOUT_MS: Record<string, number> = {
  models: 180_000,
};
```

```ts
function timeoutMsFor(cmd: string, args: string[]): number {
  if (cmd === 'ccd') return CCD_VERB_TIMEOUT_MS[args[0] ?? ''] ?? CCD_TIMEOUT_MS;
  if (cmd === 'ccrc') return CCRC_VERB_TIMEOUT_MS[args[0] ?? ''] ?? CCRC_TIMEOUT_MS;
  return TMUX_TIMEOUT_MS;
}
```

```ts
/** The agent's exec whitelist accepts BARE command names only. Local call sites
 *  pass `cfg.ccdBin`/`cfg.ccrcBin` (absolute `~/.local/bin/…` paths — correct
 *  for local exec), so normalize either to its bare name for the wire; the
 *  agent re-resolves it against ITS OWN home. Everything else passes unchanged.
 *
 *  The two names are listed, not derived from "the last segment of any path":
 *  an unrecognised binary must keep travelling as whatever the caller wrote,
 *  so that `isExecAllowed`'s path rejection stays the thing that refuses it. */
export function wireCmd(cmd: string): string {
  const base = cmd.split('/').pop();
  return base === 'ccd' || base === 'ccrc' ? base : cmd;
}
```

- [ ] **Step 12: Run the argv test**

Run from `server/`: `npx vitest run test/ccrcargv.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 13: Extend the cross-package whitelist layers**

In `server/test/whitelist-subset.test.ts`, add the import `import { CCRC_ARGV } from '../src/ccrcargv.js';` and, beside `SAMPLES`:

```ts
/** One representative call per `CCRC_ARGV` entry — `SAMPLES`' contract, for the
 *  second command. Every entry MUST appear; the exhaustive assertion below is
 *  what stops a new route hiding behind an untested one. */
const CCRC_SAMPLES: Record<keyof typeof CCRC_ARGV, unknown[]> = {
  modelsSetClass: ['gpt', 'opus', 'gpt-5.6-sol'],
  modelsSetSubagent: ['gpt', 'sonnet'],
  modelsSetEffort: ['gpt', 'opus', 'max'],
  modelsDiscoveryAdd: ['gpt', 'gpt-6-astra'],
  modelsDiscoveryRm: ['gpt', 'gpt-5.5'],
  modelsDiscoveryCatalogue: ['gpt'],
  modelsRefresh: ['gpt'],
};
```

Add a layer-2 describe:

```ts
describe('layer 2 — every ccrc argv the server can build passes the agent whitelist', () => {
  it('has a sample for every CCRC_ARGV entry', () => {
    expect(Object.keys(CCRC_SAMPLES).sort()).toEqual(Object.keys(CCRC_ARGV).sort());
  });

  it.each(Object.keys(CCRC_ARGV) as (keyof typeof CCRC_ARGV)[])('%s', (key) => {
    const build = CCRC_ARGV[key] as (...a: unknown[]) => readonly string[];
    const built = build(...(CCRC_SAMPLES[key] as unknown[]));
    expect(isExecAllowed('ccrc', [...built]), `${key} -> ccrc ${built.join(' ')}`).toBe(true);
  });
});
```

Update layer 3's key assertion and add the reverse-reachability plus the one-prefix pin:

```ts
  it('EXEC_WHITELIST has exactly three keys, and `gh` is not one of them', () => {
    expect(Object.keys(EXEC_WHITELIST).sort(),
      'a gh grant makes EXEC_WHITELIST the sole control between the PWA and `gh pr merge`: ' +
      'the host token carries the repo WRITE scope and there is no second credential')
      .toEqual(['ccd', 'ccrc', 'tmux']);
  });

  it('every ccrc prefix the agent grants is reachable from some CCRC_ARGV entry', () => {
    const granted: readonly (readonly string[])[] = EXEC_WHITELIST.ccrc;
    const built = (Object.keys(CCRC_ARGV) as (keyof typeof CCRC_ARGV)[])
      .map((k) => (CCRC_ARGV[k] as (...a: unknown[]) => readonly string[])(...(CCRC_SAMPLES[k] as unknown[])));
    for (const prefix of granted) {
      expect(prefix.length, 'an empty prefix grants every ccrc verb that exists').toBeGreaterThan(0);
      const reachable = built.some((a) => prefix.every((tok, i) => a[i] === tok));
      expect(reachable, `ccrc ${prefix.join(' ')} is granted but no route builds it`).toBe(true);
    }
  });

  it('the ccrc grant is `models` and nothing else, and the table builds no litellm/init/--all', () => {
    // CROSS-PACKAGE and object-reading, for the reasons the ws-reap assertion
    // above states. The grant cannot be narrowed (C-4: the account id sits
    // where `REQUIRED_VERB_FLAG` needs a constant), so what is asserted is the
    // pair: one prefix on the agent side, and a builder table on this side that
    // reaches none of the three verbs no route may run.
    expect(EXEC_WHITELIST.ccrc).toEqual([['models']]);
    expect(isExecAllowed('ccrc', ['install'])).toBe(false);
    expect(isExecAllowed('ccrc', ['adopt'])).toBe(false);
    const text = (Object.keys(CCRC_ARGV) as (keyof typeof CCRC_ARGV)[])
      .map((k) => (CCRC_ARGV[k] as (...a: unknown[]) => readonly string[])(...(CCRC_SAMPLES[k] as unknown[])).join(' '))
      .join('\n');
    for (const forbidden of ['litellm', 'init', '--all']) expect(text).not.toContain(forbidden);
  });
```

- [ ] **Step 14: Run the cross-package layers**

Run from `server/`: `npx vitest run test/whitelist-subset.test.ts`
Expected: PASS.

- [ ] **Step 15: Measured mutation #1 — the ungrantable list**

Edit `agent/src/whitelist.ts` and remove `'passwd'` from `UNGRANTABLE_VERBS`.
Run from `agent/`: `npx vitest run test/whitelist.test.ts`
Expected: FAIL — `makes the box-changing ccrc verbs ungrantable outright` fails on `passwd` with "expected function to throw an error, but it didn't".
Run from `agent/`: `npx vitest run test/whitelist-structural.test.ts`
Expected: FAIL too — `legit-whitelist.ts`'s `PasswdIsUngrantable` becomes `Assert<false>`, which the structural test reads as a failure of the positive control.
Restore. Re-run both: PASS.

- [ ] **Step 16: Measured mutation #2 — the one-prefix grant**

Edit `agent/src/whitelist.ts` and change `ccrc: [['models']]` to `ccrc: [['models'], ['status']]`.
Run from `server/`: `npx vitest run test/whitelist-subset.test.ts`
Expected: FAIL twice — `every ccrc prefix the agent grants is reachable from some CCRC_ARGV entry` reports `ccrc status is granted but no route builds it`, and the pair assertion fails `expected [ [ 'models' ], [ 'status' ] ] to deeply equal [ [ 'models' ] ]`.
Restore. Re-run: PASS.

- [ ] **Step 17: Measured mutation #3 — `wireCmd`**

Edit `server/src/remote/runner.ts` and revert `wireCmd` to `return cmd.split('/').pop() === 'ccd' ? 'ccd' : cmd;`.
Run from `server/`: `npx vitest run test/routes.test.ts test/ccrcargv.test.ts`
Expected: PASS — no test in this task drives a ccrc argv through `guardRunner`, so this guard is NOT measured yet. That is stated rather than papered over: Task 4 Step 11 re-runs this exact mutation against the PATCH route and expects a red, and until that task lands the `wireCmd` widening rests on the type checker alone.
Restore.

- [ ] **Step 18: Typecheck and run the full server + agent suites once**

Run from `<repo>`: `npx tsc -p server --noEmit && npx tsc -p agent --noEmit`
Expected: no output. A `TS2741: Property 'runCcrc' is missing` names a `Deps` literal Step 10 missed — the known ones are `server/test/helpers.ts` and `server/src/index.ts`'s two branches.

Run from `server/`: `npx vitest run` — PASS. Run from `agent/`: `npx vitest run` — PASS.

- [ ] **Step 19: Commit**

```bash
git add agent/src/whitelist.ts agent/src/server.ts agent/test/whitelist.test.ts agent/test/types/ok/legit-whitelist.ts server/src/ccrcargv.ts server/src/lifecycle.ts server/src/config.ts server/src/server.ts server/src/index.ts server/src/remote/runner.ts server/test/ccrcargv.test.ts server/test/whitelist-subset.test.ts server/test/helpers.ts
git commit -m "feat(exec): ccrc becomes the second command the agent may run, on one prefix and a branded argv

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `PATCH /api/accounts/:id/models`

Spec §9's second bullet. The server validates the shape, turns it into a deterministic sequence of `ccrc models <id> …` calls, stops at the first refusal, and answers with what the box now holds.

**Files:**
- Modify: `server/src/models.ts` (add `modelsPatchPlan`)
- Modify: `server/src/server.ts` (the new route, beside `/api/accounts`)
- Create: `server/test/models-routes.test.ts`
- Idiom copied from: `server/src/server.ts:1851-1858` (the swap route — the gate every session/account mutation copies: the app-wide auth gate plus body validation plus a 502 carrying the verb's own stderr, and nothing else); `server/src/limits.ts:170-189` (its roster-membership filter, the rule this route's `cfg.roster.byId.get(id)` applies to a path segment: a name no account has must never become an argv token)

**Interfaces:**
- Consumes: Task 2's `LaneModels`/`readModelsDir`/`accountModels`; Task 3's `CCRC_ARGV` and `Deps.runCcrc`; `shared/models.ts`'s `CLASSES`, `MODEL_ID_RE`, `isModelClass`; `CcrcConfig.roster.byId` (a `Map<string, AccountDef>`, already built by `parseRoster`) for both the membership test and the lane's declared `telemetry`.
- Produces:
  - `server/src/models.ts`: `export type ModelsPatchPlan = { ok: true; argv: CcrcArgv[] } | { ok: false; detail: string }`
  - `export function modelsPatchPlan(id: string, current: LaneModels | undefined, body: unknown): ModelsPatchPlan`
  - Route `PATCH /api/accounts/:id/models` → `200 AccountModels` | `400 {error:'bad-request',detail}` | `404 {error:'unknown-account'}` | `409 {error:'no-registry',detail}` | `502 {error:'verb-refused',detail}`

- [ ] **Step 1: Write the failing route test**

Create `server/test/models-routes.test.ts`:

```ts
// The three model routes (spec §9). Every one of them execs a `ccrc` verb
// through the SAME guarded runner every other server test uses
// (`helpers.ts`'s `guardRunner`), so an argv the agent would refuse fails here
// rather than on the fleet — which is the failure this repo has shipped once
// already (ws-add/ws-rm, whitelisted-out and dead with every suite green).
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountModels } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { Runner } from '../src/exec.js';

/** Two registered lanes: the seeded Codex one (`discovery: "catalogue"`) and an
 *  OpenRouter one, whose discovery list spec §4.1 REQUIRES to be explicit. */
const GPT_REGISTRY = {
  probe: 'codex',
  classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
  subagent: 'sonnet', discovery: 'catalogue', effort: { opus: 'max' },
};

const OR_REGISTRY = {
  probe: 'openrouter',
  classes: { haiku: null, sonnet: null, opus: null, fable: null },
  subagent: 'sonnet', discovery: ['anthropic/claude-opus-4.5:beta'],
};

const CATALOGUE = {
  probe: 'codex', fetchedAt: 1789000000, stale: false,
  models: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', context: 272000, maxContext: 272000,
      efforts: ['low', 'medium', 'high'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', context: 272000, maxContext: 272000,
      efforts: ['low', 'medium', 'high'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', context: 272000, maxContext: 272000,
      efforts: ['high', 'xhigh', 'max'], hidden: false, priceIn: null, priceOut: null },
    // ITS LABEL IS NOT A SUBSTRING OF ITS ID, deliberately: every other row here
    // would match on the id alone, so a filter that had quietly lost its label
    // clause would still answer every query correctly. This is the one row that
    // can tell the two halves apart (Task 6).
    { id: 'gpt-6-astra', label: 'Codex Nova', context: 272000, maxContext: 872000,
      efforts: ['high', 'max', 'ultra'], hidden: false, priceIn: null, priceOut: null },
    { id: 'gpt-reserve', label: 'GPT reserve', context: null, maxContext: null,
      efforts: ['high'], hidden: true, priceIn: null, priceOut: null },
  ],
};

/** `DEFAULT_TEST_ROSTER` plus one more non-home-able lane, so an OpenRouter
 *  registry has an account to belong to. Spelled here rather than in
 *  `helpers.ts`: it is this file's fixture, not the suite's default. */
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
    { id: 'or', label: 'or', configDirSuffix: '.claude-or',
      exec: { kind: 'generated' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ],
};

interface Box { home: string; calls: string[][] }

/** A fixture box plus a recording `ccrc` runner. `answer` decides what the verb
 *  says; the default is success with an empty transcript. The runner also
 *  APPLIES the edit to the fixture registry for `set-class`, so the route's
 *  "re-read and answer with what the box now holds" is measured against a box
 *  that really changed — a stub that recorded and changed nothing would let a
 *  route that returns its REQUEST pass. */
function box(answer: (argv: string[]) => { code: number; stderr: string } = () => ({ code: 0, stderr: '' })): Box & { deps: ReturnType<typeof testDeps> } {
  const home = mkTmp('ccrc-models-routes-');
  const dir = path.join(home, '.ccrc', 'models');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'gpt.classes.json'), JSON.stringify(GPT_REGISTRY));
  writeFileSync(path.join(dir, 'gpt.json'), JSON.stringify(CATALOGUE));
  writeFileSync(path.join(dir, 'or.classes.json'), JSON.stringify(OR_REGISTRY));
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd.split('/').pop() ?? cmd, ...args]);
    const verdict = answer(args);
    if (verdict.code === 0 && args[0] === 'models' && args[2] === 'set-class') {
      const p = path.join(dir, `${args[1]}.classes.json`);
      const reg = JSON.parse(readFileSync(p, 'utf8')) as { classes: Record<string, string | null> };
      reg.classes[args[3]!] = args[4] === 'none' ? null : args[4]!;
      writeFileSync(p, JSON.stringify(reg));
    }
    return { code: verdict.code, stdout: '', stderr: verdict.stderr };
  };
  return { home, calls, deps: testDeps(home, run, ROSTER) };
}

const ccrcCalls = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'ccrc').map((c) => c.slice(1));

describe('PATCH /api/accounts/:id/models', () => {
  it('turns one class move into the two verb calls it really is, clear before set', async () => {
    // Moving Sol from opus to fable is a clear AND a set, in that order — the
    // UI's radio is per-ROW, so a row changing class vacates the class it held,
    // and clearing first keeps two classes from naming one model in between.
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({
        method: 'PATCH', url: '/api/accounts/gpt/models',
        payload: { classes: { opus: null, fable: 'gpt-5.6-sol' } },
      });
      expect(res.statusCode).toBe(200);
      expect(ccrcCalls(b.calls)).toEqual([
        ['models', 'gpt', 'set-class', 'opus', 'none'],
        ['models', 'gpt', 'set-class', 'fable', 'gpt-5.6-sol'],
      ]);
      const body = res.json() as AccountModels;
      // The ANSWER is re-read from the box, not echoed from the request.
      expect(body.classes.fable).toBe('gpt-5.6-sol');
      expect(body.classes.opus).toBeNull();
    } finally { await app.close(); }
  });

  it('orders the ops so an id is discovered before it is classed, and un-discovered after', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({
        method: 'PATCH', url: '/api/accounts/or/models',
        payload: {
          discovery: ['anthropic/claude-sonnet-5'],
          classes: { sonnet: 'anthropic/claude-sonnet-5' },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(ccrcCalls(b.calls)).toEqual([
        ['models', 'or', 'discovery', 'add', 'anthropic/claude-sonnet-5'],
        ['models', 'or', 'set-class', 'sonnet', 'anthropic/claude-sonnet-5'],
        ['models', 'or', 'discovery', 'rm', 'anthropic/claude-opus-4.5:beta'],
      ]);
    } finally { await app.close(); }
  });

  it('sends `catalogue` as its own op, first, when the body asks for the whole advertised set', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({
        method: 'PATCH', url: '/api/accounts/or/models', payload: { discovery: 'catalogue' },
      });
      expect(res.statusCode).toBe(200);
      expect(ccrcCalls(b.calls)).toEqual([['models', 'or', 'discovery', 'catalogue']]);
    } finally { await app.close(); }
  });

  it('sends set-subagent AFTER the class sets, and set-effort last', async () => {
    // Spec §4.1: naming a class whose slot is null is refused. A body that
    // fills fable and points subagent at it only survives in that order — and
    // an effort level is validated against the classed model's own `efforts`,
    // so the class must already be what the body says it is.
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({
        method: 'PATCH', url: '/api/accounts/gpt/models',
        payload: { classes: { fable: 'gpt-6-astra' }, subagent: 'fable', effort: { opus: 'xhigh', haiku: null } },
      });
      expect(res.statusCode).toBe(200);
      expect(ccrcCalls(b.calls)).toEqual([
        ['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra'],
        ['models', 'gpt', 'set-subagent', 'fable'],
        ['models', 'gpt', 'set-effort', 'haiku', 'default'],
        ['models', 'gpt', 'set-effort', 'opus', 'xhigh'],
      ]);
    } finally { await app.close(); }
  });

  it('stops at the first refusal and hands back the verb\'s own sentence', async () => {
    const b = box((argv) => argv[3] === 'fable'
      ? { code: 1, stderr: 'ccrc: gpt-6-astra is not in this account\'s discovery list' }
      : { code: 0, stderr: '' });
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({
        method: 'PATCH', url: '/api/accounts/gpt/models',
        payload: { classes: { fable: 'gpt-6-astra', sonnet: 'gpt-5.6-luna' } },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({
        error: 'verb-refused',
        detail: "ccrc: gpt-6-astra is not in this account's discovery list",
      });
      // The SECOND op never ran: a sequence that carried on past a refusal
      // would leave the lane in a state neither the operator nor the answer
      // describes.
      expect(ccrcCalls(b.calls)).toEqual([['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra']]);
    } finally { await app.close(); }
  });

  it('refuses a body that names something that is not a class, before any argv is built', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      for (const payload of [
        { classes: { ultra: 'x' } },
        { classes: { opus: 'has a space' } },
        { subagent: 'ultra' },
        { subagent: null },
        { effort: { opus: '' } },
        { discovery: [] },
        { discovery: ['a', 'a'] },
        { discovery: 42 },
        {},
      ]) {
        const res = await app.inject({ method: 'PATCH', url: '/api/accounts/gpt/models', payload });
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect((res.json() as { detail: string }).detail.length).toBeGreaterThan(0);
      }
      expect(b.calls).toEqual([]);
    } finally { await app.close(); }
  });

  it('404s an id the roster does not have, and 409s a lane with no registry to edit', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      expect((await app.inject({ method: 'PATCH', url: '/api/accounts/ghost/models', payload: { discovery: 'catalogue' } })).statusCode).toBe(404);
      // `claude` is an Anthropic lane: spec §4.1 gives it no registry file at
      // all, so there is nothing this route could write.
      const r = await app.inject({ method: 'PATCH', url: '/api/accounts/claude/models', payload: { discovery: 'catalogue' } });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'no-registry' });
      expect((r.json() as { detail: string }).detail).toContain('Claude Code');
      expect(b.calls).toEqual([]);
    } finally { await app.close(); }
  });

  it('409s an UNSEEDED non-Anthropic lane with the init remedy, which is a different sentence', async () => {
    // Spec §13.1: a lane with no registry file is VALID and reads as "all
    // classes unavailable" until seeded. The operator's next move is `init`,
    // and the two 409s must not share one message — one of them has a remedy.
    const b = box();
    const app = await buildServer(b.deps);
    try {
      // `or`'s registry exists in this fixture; remove it for this case only.
      const p = path.join(b.home, '.ccrc', 'models', 'or.classes.json');
      writeFileSync(p, '');
      const r = await app.inject({ method: 'PATCH', url: '/api/accounts/or/models', payload: { discovery: 'catalogue' } });
      expect(r.statusCode).toBe(409);
      expect((r.json() as { detail: string }).detail).toContain('ccrc models or init');
      expect(b.calls).toEqual([]);
    } finally { await app.close(); }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: FAIL — every case gets `404` from Fastify's own not-found handler (`expected 404 to be 200`), because no `PATCH /api/accounts/:id/models` route is registered.

- [ ] **Step 3: Add `modelsPatchPlan` to `server/src/models.ts`**

```ts
import { CCRC_ARGV, type CcrcArgv } from './ccrcargv.js';
import { CLASSES, MODEL_ID_RE, isModelClass, type ModelClass } from '../../shared/models.js';

export type ModelsPatchPlan = { ok: true; argv: CcrcArgv[] } | { ok: false; detail: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A reasoning-effort level as the verb takes it: one non-empty token, no
 *  whitespace. NOT validated against the catalogue here — spec §4.1 says the
 *  level is checked against the classed model's own `efforts` where a catalogue
 *  exists, and the VERB is where that check lives (it has the catalogue and the
 *  registry in one place). This is only the shape check that stops a
 *  shell-hostile or empty token becoming an argv token. */
const EFFORT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/**
 * The `ccrc models <id> …` calls a PATCH body becomes, in the order they must
 * run, or a refusal naming the field.
 *
 * THE ORDER IS PART OF THE CONTRACT, not an implementation detail, because each
 * verb re-validates the WHOLE registry on the box and the intermediate states
 * have to be legal:
 *
 *   1. `discovery catalogue`, if asked — it replaces the list wholesale, so
 *      nothing before it would survive.
 *   2. discovery ADDS — spec §4.1: every non-null class id must be in the
 *      discovery list, so an id must arrive before it is classed.
 *   3. class CLEARS (`none`) — a row changing class vacates the class it held,
 *      and clearing first keeps two classes from naming one model in between.
 *   4. class SETS.
 *   5. discovery REMOVES — removing an id that is still classed is exactly what
 *      the validator refuses, so removals go after the clears that free them.
 *   6. `set-subagent` — spec §4.1 refuses a subagent class whose slot is null,
 *      so the slot must already hold what this body puts in it.
 *   7. `set-effort` — the level is validated against the classed model's own
 *      `efforts`, so the class must already be what the body says it is.
 *
 * C-3: a `discovery` ARRAY is diffed against `current`, because the verb has no
 * whole-list setter — only `add`, `rm` and `catalogue`. The diff is computed
 * against the registry this same request read, so a concurrent CLI edit can
 * make one `rm` refuse; that refusal is the verb's own sentence and reaches the
 * operator as itself, which is the honest outcome for a race this server cannot
 * lock.
 */
export function modelsPatchPlan(
  id: string, current: LaneModels | undefined, body: unknown,
): ModelsPatchPlan {
  if (!isObj(body)) return { ok: false, detail: 'the body must be a JSON object' };
  const { classes, effort, discovery, subagent } = body;
  if (classes === undefined && effort === undefined && discovery === undefined && subagent === undefined) {
    return { ok: false, detail: 'nothing to change: name at least one of classes, subagent, discovery or effort' };
  }

  const setClasses: [ModelClass, string | null][] = [];
  if (classes !== undefined) {
    if (!isObj(classes)) return { ok: false, detail: 'classes must be an object keyed by class' };
    for (const [k, v] of Object.entries(classes)) {
      if (!isModelClass(k)) return { ok: false, detail: `classes: "${k}" is not one of ${CLASSES.join(', ')}` };
      if (v === null) { setClasses.push([k, null]); continue; }
      if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
        return { ok: false, detail: `classes.${k}: not a model id` };
      }
      setClasses.push([k, v]);
    }
  }

  // A CLASS NAME, and there is no "clear" form: a lane always resolves
  // `CLAUDE_CODE_SUBAGENT_MODEL` to some class (spec §6.1), so `null` here is a
  // client bug rather than an instruction.
  if (subagent !== undefined && !isModelClass(subagent)) {
    return { ok: false, detail: `subagent: not one of ${CLASSES.join(', ')}` };
  }

  const setEfforts: [ModelClass, string | null][] = [];
  if (effort !== undefined) {
    if (!isObj(effort)) return { ok: false, detail: 'effort must be an object keyed by class' };
    for (const [k, v] of Object.entries(effort)) {
      if (!isModelClass(k)) return { ok: false, detail: `effort: "${k}" is not one of ${CLASSES.join(', ')}` };
      if (v === null) { setEfforts.push([k, null]); continue; }
      if (typeof v !== 'string' || !EFFORT_RE.test(v)) {
        return { ok: false, detail: `effort.${k}: not an effort level` };
      }
      setEfforts.push([k, v]);
    }
  }

  let wholeCatalogue = false;
  const adds: string[] = [];
  const removes: string[] = [];
  if (discovery !== undefined) {
    if (discovery === 'catalogue') {
      wholeCatalogue = true;
    } else if (Array.isArray(discovery)) {
      if (discovery.length === 0) return { ok: false, detail: 'discovery: an empty list is refused — use "catalogue"' };
      const seen = new Set<string>();
      for (const v of discovery) {
        if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) return { ok: false, detail: 'discovery: not a model id' };
        if (seen.has(v)) return { ok: false, detail: `discovery: "${v}" appears twice` };
        seen.add(v);
      }
      const now = current?.registry?.discovery;
      const before = new Set<string>(Array.isArray(now) ? now : []);
      for (const v of seen) if (!before.has(v)) adds.push(v);
      // `now === 'catalogue'` has nothing to remove: the list was never
      // enumerated, so there is no member this diff can prove is gone.
      if (Array.isArray(now)) for (const v of now) if (!seen.has(v)) removes.push(v);
    } else {
      return { ok: false, detail: 'discovery must be "catalogue" or a list of model ids' };
    }
  }

  // CLASSES order for both class loops, so two bodies naming the same edits in
  // different key orders produce byte-identical argv sequences — a route whose
  // transcript depends on JSON key order is a route whose failures cannot be
  // reproduced from its own log.
  const byClassOrder = (xs: [ModelClass, string | null][]): [ModelClass, string | null][] =>
    [...xs].sort((a, b) => CLASSES.indexOf(a[0]) - CLASSES.indexOf(b[0]));

  const argv: CcrcArgv[] = [];
  if (wholeCatalogue) argv.push(CCRC_ARGV.modelsDiscoveryCatalogue(id));
  for (const m of adds) argv.push(CCRC_ARGV.modelsDiscoveryAdd(id, m));
  for (const [c, v] of byClassOrder(setClasses)) if (v === null) argv.push(CCRC_ARGV.modelsSetClass(id, c, null));
  for (const [c, v] of byClassOrder(setClasses)) if (v !== null) argv.push(CCRC_ARGV.modelsSetClass(id, c, v));
  for (const m of removes) argv.push(CCRC_ARGV.modelsDiscoveryRm(id, m));
  if (isModelClass(subagent)) argv.push(CCRC_ARGV.modelsSetSubagent(id, subagent));
  for (const [c, v] of byClassOrder(setEfforts)) argv.push(CCRC_ARGV.modelsSetEffort(id, c, v));
  return { ok: true, argv };
}
```

- [ ] **Step 4: Register the route**

In `server/src/server.ts`, directly after the `GET /api/accounts` handler:

```ts
  /**
   * The lane's current registry, re-read. Every model route answers with this
   * rather than with the request it was given: the verbs re-validate on the box
   * and may legally do less than was asked (a level clamped to the model's
   * `efforts`, a discovery entry the whitelist check refused), so echoing the
   * request would tell the operator their edit landed when part of it did not.
   */
  const currentModels = async (id: string): Promise<AccountModels | null> =>
    accountModels((await readModelsDir(deps.io, deps.cfg))[id]);

  /** The one gate every model route shares.
   *
   *  `roster.byId.get(id)` is BOTH the membership test and the read of the
   *  lane's declared `telemetry` — the id is about to become an argv token, and
   *  a segment naming no account must never reach `ccrc` (`limits.ts`'s rule for
   *  its own directory). A lane with no registry FILE is 409 and not 404: the
   *  account exists, and telling an operator it does not would send them looking
   *  for the wrong fault.
   *
   *  NO SECOND GATE, deliberately. Spec §9 says these routes are gated as the
   *  account-connections §7 gates account mutation, and that spec is not on this
   *  branch to copy — so the shape being matched is this server's OWN nearest
   *  equivalent, `POST /api/sessions/:id/swap` (its other "change which model
   *  something runs under" write), which carries the app-wide auth gate, a body
   *  check and nothing else. When §7's gate lands, these three routes adopt it
   *  in one place: here.
   *
   *  THE TWO 409 SENTENCES ARE DIFFERENT because the two situations are.
   *  `telemetry === 'anthropic'` is the roster's own declaration that this lane
   *  bills through Anthropic (`shared/roster.ts`), and such a lane never has a
   *  registry file at all (spec §4.1) — there is no remedy to offer. Any other
   *  lane without one has simply not been seeded, which spec §13.1 says is
   *  valid, and `ccrc models <id> init <probe>` is exactly what fixes it. This
   *  is the ONLY place either fact is consulted; `available` is computed from
   *  the registry file alone. */
  const modelsTarget = async (
    reply: FastifyReply, id: string,
  ): Promise<{ lane: LaneModels } | null> => {
    const account = deps.cfg.roster.byId.get(id);
    if (account === undefined) {
      await reply.code(404).send({ error: 'unknown-account' });
      return null;
    }
    const lane = (await readModelsDir(deps.io, deps.cfg))[id];
    if (lane === undefined || lane.registry === null) {
      await reply.code(409).send({
        error: 'no-registry',
        detail: account.telemetry === 'anthropic'
          ? 'this lane runs on Claude Code\'s own model aliases, which ccrc does not set'
          : `this lane has no model-class registry yet — run \`ccrc models ${id} init <codex|openrouter|compatible>\` on the box`,
      });
      return null;
    }
    return { lane };
  };

  app.patch('/api/accounts/:id/models', async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await modelsTarget(reply, id);
    if (target === null) return reply;
    const plan = modelsPatchPlan(id, target.lane, req.body ?? {});
    if (!plan.ok) return reply.code(400).send({ error: 'bad-request', detail: plan.detail });
    for (const argv of plan.argv) {
      const r = await deps.runCcrc(argv);
      if (!r.ok) {
        // STOP AT THE FIRST REFUSAL. The ops are ordered so that each depends
        // on the last (see `modelsPatchPlan`), so carrying on would apply edits
        // whose precondition just failed. `detail` is the verb's OWN sentence —
        // spec §9: "Errors come back as the verb's own sentence" — and the
        // fallback names the argv rather than inventing a reason, for the case
        // where ccrc died before writing to stderr at all.
        return reply.code(502).send({
          error: 'verb-refused',
          detail: r.stderr.trim() || `ccrc ${argv.join(' ')} failed with no message`,
        });
      }
    }
    return currentModels(id);
  });
```

Add `modelsPatchPlan`, `type LaneModels` to the `./models.js` import and `type AccountModels` to the `../../shared/api.js` import in `server.ts`.

- [ ] **Step 5: Run the route test**

Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Measured mutation #1 — the op ordering**

Edit `server/src/models.ts` and move the `set-subagent` push ABOVE the class-sets loop.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t "set-subagent AFTER"`
Expected: FAIL — the received array has `set-subagent fable` before `set-class fable gpt-6-astra`, which on the box is the refusal "subagent names a class whose slot is null".
Restore. Re-run: PASS.

- [ ] **Step 7: Measured mutation #2 — discovery removals go after the class clears**

Edit `server/src/models.ts` and move the `removes` loop ABOVE the class-clears loop.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t "un-discovered after"`
Expected: FAIL — the `discovery rm` line appears before the `set-class` line in the received array.
Restore. Re-run: PASS.

- [ ] **Step 8: Measured mutation #3 — stop-at-first-refusal**

Edit `server/src/server.ts` and replace the loop body's `return reply.code(502)…` with `continue;`.
Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: FAIL — `stops at the first refusal and hands back the verb's own sentence` fails twice: `expected 200 to be 502`, and the recorded calls contain two entries instead of one.
Restore. Re-run: PASS.

- [ ] **Step 9: Measured mutation #4 — the answer is re-read, not echoed**

Edit `server/src/server.ts` and change the route's last line to `return req.body as AccountModels;`.
Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: FAIL — `turns one class move into the two verb calls it really is, clear before set` fails at `expect(body.classes.fable).toBe('gpt-5.6-sol')` with `undefined`.
Restore. Re-run: PASS.

- [ ] **Step 10: Measured mutation #5 — the 409 arm, and its two sentences**

Edit `server/src/server.ts` and delete the `lane?.registry == null` branch from `modelsTarget`.
Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: FAIL — both 409 cases fail with `expected 502 to be 409`, and the runner has been called for a lane that has no registry to edit.
Restore, then make the second mutation: change the ternary to always emit the Anthropic sentence.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t "UNSEEDED"`
Expected: FAIL — `expected 'this lane runs on Claude Code's own model aliases…' to contain 'ccrc models or init'`.
Restore. Re-run: PASS.

- [ ] **Step 11: Measured mutation #6 — validation before argv**

Edit `server/src/models.ts` and change `if (!isModelClass(k))` in the `classes` loop to `if (false)`.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t "not a class"`
Expected: FAIL — the `{"classes":{"ultra":"x"}}` payload gets a 500 instead of a 400: the cast to `ModelClass` produces `ccrc models gpt set-class ultra x`, which `guardRunner` lets through (the agent's prefix admits it) and the box would refuse — a refusal the route must never need.
Restore. Re-run: PASS.

- [ ] **Step 12: Re-run Task 3's deferred `wireCmd` mutation, which is now measurable**

Edit `server/src/remote/runner.ts` and revert `wireCmd` to `return cmd.split('/').pop() === 'ccd' ? 'ccd' : cmd;`.
Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: FAIL — every PATCH case throws `argv not in the agent EXEC_WHITELIST: /…/.local/bin/ccrc models gpt …` out of `guardRunner`, because an absolute path is not a bare command name.
Restore. Re-run: PASS. Record this in the test file's header as the measured mutation for that guard.

- [ ] **Step 13: Typecheck and commit**

Run from `<repo>`: `npx tsc -p server --noEmit` — no output.

```bash
git add server/src/models.ts server/src/server.ts server/test/models-routes.test.ts
git commit -m "feat(routes): PATCH a lane's classes, subagent, discovery and efforts through ccrc, in an order each verb can survive

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `POST /api/accounts/:id/models/refresh`

Spec §9's third bullet and §5's on-demand half. One verb, one answer.

**Files:**
- Modify: `server/src/server.ts` (the route, beside the PATCH)
- Modify: `server/test/models-routes.test.ts` (new describe)
- Idiom copied from: Task 4's `modelsTarget`/`currentModels` (the shared gate and the re-read answer); `server/src/server.ts:1851-1858` (the swap route's gate)

**Interfaces:**
- Consumes: Task 3's `CCRC_ARGV.modelsRefresh`, Task 4's `modelsTarget`/`currentModels`.
- Produces: Route `POST /api/accounts/:id/models/refresh` → `200 AccountModels` | `404` | `409` | `502 {error:'verb-refused',detail}`

- [ ] **Step 1: Write the failing test**

Append to `server/test/models-routes.test.ts`:

```ts
describe('POST /api/accounts/:id/models/refresh', () => {
  it('runs the lane\'s probe and answers with the catalogue summary that came back', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({ method: 'POST', url: '/api/accounts/gpt/models/refresh' });
      expect(res.statusCode).toBe(200);
      expect(ccrcCalls(b.calls)).toEqual([['models', 'refresh', 'gpt']]);
      expect((res.json() as AccountModels).catalogue).toEqual({
        fetchedAt: 1789000000, stale: false, count: 5,
      });
    } finally { await app.close(); }
  });

  it('names ONE lane — never --all, which is the timer\'s job (spec §5)', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      await app.inject({ method: 'POST', url: '/api/accounts/gpt/models/refresh' });
      for (const c of ccrcCalls(b.calls)) expect(c).not.toContain('--all');
    } finally { await app.close(); }
  });

  it('hands back the probe\'s own failure sentence rather than a bare 502', async () => {
    const b = box(() => ({ code: 1, stderr: 'ccrc: chatgpt.com answered 401 — this lane\'s OAuth has expired' }));
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({ method: 'POST', url: '/api/accounts/gpt/models/refresh' });
      expect(res.statusCode).toBe(502);
      expect((res.json() as { detail: string }).detail).toContain('401');
    } finally { await app.close(); }
  });

  it('404s an unknown account and 409s a lane with nothing to probe, running nothing', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      expect((await app.inject({ method: 'POST', url: '/api/accounts/ghost/models/refresh' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/api/accounts/claude/models/refresh' })).statusCode).toBe(409);
      expect(b.calls).toEqual([]);
    } finally { await app.close(); }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/models-routes.test.ts -t refresh`
Expected: FAIL — `expected 404 to be 200` on the first case (no route registered).

- [ ] **Step 3: Register the route**

In `server/src/server.ts`, directly after the PATCH:

```ts
  app.post('/api/accounts/:id/models/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await modelsTarget(reply, id);
    if (target === null) return reply;
    const r = await deps.runCcrc(CCRC_ARGV.modelsRefresh(id));
    if (!r.ok) {
      // A probe failure is NOT a lost catalogue (spec §11): the verb keeps the
      // previous file and marks it `stale`, so a client that re-reads
      // `/api/accounts` still sees the lane. This 502 says the refresh failed,
      // and the surface's "stale since" says what is left.
      return reply.code(502).send({
        error: 'verb-refused',
        detail: r.stderr.trim() || 'ccrc models refresh failed with no message',
      });
    }
    return currentModels(id);
  });
```

- [ ] **Step 4: Run it**

Run from `server/`: `npx vitest run test/models-routes.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Measured mutation — the gate runs before the verb**

Edit `server/src/server.ts` and move the `const r = await deps.runCcrc(...)` line ABOVE the `modelsTarget` call.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t "404s an unknown account and 409s a lane with nothing to probe"`
Expected: FAIL — `expected [ [ 'models', 'refresh', 'ghost' ], … ] to deeply equal []`: a path segment naming no account reached `ccrc`.
Restore. Re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/test/models-routes.test.ts
git commit -m "feat(routes): the refresh button runs one lane's probe and answers with what came back

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `GET /api/accounts/:id/models/catalogue?q=&limit=&cursor=`

Spec §9's fourth bullet. A READ, not a verb: the catalogue file is already on disk and the search is server-side because OpenRouter's is several hundred entries (§2).

**Files:**
- Modify: `shared/api.ts` (two wire types, structurally declared for C-2's reason)
- Modify: `server/src/models.ts` (add `searchCatalogue`)
- Modify: `server/src/server.ts` (the route)
- Modify: `server/test/models-routes.test.ts` (new describe)
- Modify: `server/test/models-wire.test.ts` (the structural agreement case)
- Modify: `server/test/models-derive.test.ts` (the page-size unit case)
- Idiom copied from: `server/src/server.ts:1132-1139` (`GET /api/notifications/catchup` — a query-string read whose numeric parameter is `Number(...)`-then-`isFinite`-checked rather than trusted)

**Interfaces:**
- Produces:
  - `shared/api.ts`: `export interface CatalogueModelWire { id: string; label: string; context: number | null; maxContext: number | null; efforts: string[]; hidden: boolean; priceIn: number | null; priceOut: number | null }` and `export interface CatalogueSearch { items: CatalogueModelWire[]; next: string | null }`
  - `server/src/models.ts`: `export function searchCatalogue(catalogue: Catalogue | null, q: string, limitRaw: number, cursorRaw: string | null): { items: CatalogueModel[]; next: string | null }`
  - Route `GET /api/accounts/:id/models/catalogue` → `200 CatalogueSearch` | `404` | `409`

- [ ] **Step 1: Write the failing test**

Append to `server/test/models-routes.test.ts`:

```ts
describe('GET /api/accounts/:id/models/catalogue', () => {
  it('lists the whole catalogue, hidden models included — that is the only way to add one (spec §15.6)', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/accounts/gpt/models/catalogue' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: { id: string; hidden: boolean }[]; next: string | null };
      // Catalogue ORDER is the provider's, carried through untouched: an
      // operator reading a list the provider ranked must not be shown a
      // re-sorted one this server invented.
      expect(body.items.map((m) => m.id)).toEqual([
        'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra', 'gpt-reserve',
      ]);
      // The flag rides along so the surface can badge it — EXCLUDED from a
      // `"catalogue"` discovery list, addable explicitly, and a client that
      // could not see the difference would have to guess.
      expect(body.items.find((m) => m.id === 'gpt-reserve')?.hidden).toBe(true);
      expect(body.next).toBeNull();
    } finally { await app.close(); }
  });

  it('filters on id AND label, case-insensitively', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const byId = await app.inject({ method: 'GET', url: '/api/accounts/gpt/models/catalogue?q=ASTRA' });
      expect((byId.json() as { items: { id: string }[] }).items.map((m) => m.id)).toEqual(['gpt-6-astra']);
      // `Codex Nova` is `gpt-6-astra`'s LABEL and appears nowhere in its id, so
      // this query can only be answered by the label half of the filter.
      const byLabel = await app.inject({ method: 'GET', url: '/api/accounts/gpt/models/catalogue?q=nova' });
      expect((byLabel.json() as { items: { id: string }[] }).items.map((m) => m.id)).toEqual(['gpt-6-astra']);
    } finally { await app.close(); }
  });

  it('pages with an opaque cursor, and the last page says so with a null next', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const p1 = await app.inject({ method: 'GET', url: '/api/accounts/gpt/models/catalogue?limit=2' });
      const b1 = p1.json() as { items: { id: string }[]; next: string | null };
      expect(b1.items.map((m) => m.id)).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra']);
      expect(b1.next).not.toBeNull();
      const p2 = await app.inject({
        method: 'GET',
        url: `/api/accounts/gpt/models/catalogue?limit=2&cursor=${encodeURIComponent(b1.next!)}`,
      });
      const b2 = p2.json() as { items: { id: string }[]; next: string | null };
      expect(b2.items.map((m) => m.id)).toEqual(['gpt-5.6-sol', 'gpt-6-astra']);
      const p3 = await app.inject({
        method: 'GET',
        url: `/api/accounts/gpt/models/catalogue?limit=2&cursor=${encodeURIComponent(b2.next!)}`,
      });
      const b3 = p3.json() as { items: { id: string }[]; next: string | null };
      expect(b3.items.map((m) => m.id)).toEqual(['gpt-reserve']);
      expect(b3.next).toBeNull();
    } finally { await app.close(); }
  });

  it('treats a junk limit or cursor as the default rather than answering an error', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const r = await app.inject({ method: 'GET', url: '/api/accounts/gpt/models/catalogue?limit=nope&cursor=nope' });
      expect(r.statusCode).toBe(200);
      expect((r.json() as { items: unknown[] }).items.length).toBe(5);
      const big = await app.inject({ method: 'GET', url: '/api/accounts/gpt/models/catalogue?limit=99999' });
      expect((big.json() as { items: unknown[] }).items.length).toBe(5);
    } finally { await app.close(); }
  });

  it('answers an empty page for a lane that has never been probed — not a 404', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      // `or` has a registry and no catalogue file.
      const r = await app.inject({ method: 'GET', url: '/api/accounts/or/models/catalogue' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ items: [], next: null });
    } finally { await app.close(); }
  });

  it('404s an unknown account and 409s a lane with nothing to search', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/accounts/ghost/models/catalogue' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/accounts/claude/models/catalogue' })).statusCode).toBe(409);
    } finally { await app.close(); }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/models-routes.test.ts -t catalogue`
Expected: FAIL — `expected 404 to be 200`.

- [ ] **Step 3: Declare the wire types**

In `shared/api.ts`, directly under `AccountModels`:

```ts
/**
 * One model as the catalogue advertises it (spec §4.2). Structurally identical
 * to `shared/models.ts`'s `CatalogueModel`, and DECLARED HERE for `AccountModels`'
 * own reason (C-2): this file may hold exactly one import line
 * (`server/test/peers-claims-l0.test.ts` pins it) and that line is spent.
 *
 * The duplication is deliberate and bounded, and `server/test/models-wire.test.ts`
 * is what keeps it honest: it assigns a `CatalogueModel` to a
 * `CatalogueModelWire` and back, so a field added on either side and not the
 * other is a compile error rather than a value that silently never arrives.
 */
export interface CatalogueModelWire {
  id: string; label: string; context: number | null; maxContext: number | null;
  efforts: string[]; hidden: boolean; priceIn: number | null; priceOut: number | null;
}

/** `GET /api/accounts/{id}/models/catalogue`. `next` is an OPAQUE cursor —
 *  clients pass it back untouched and never construct one — and `null` means
 *  this is the last page, which is a different fact from an empty page. */
export interface CatalogueSearch { items: CatalogueModelWire[]; next: string | null }
```

and append to `server/test/models-wire.test.ts`:

```ts
describe('CatalogueModelWire and shared/models.ts agree field for field', () => {
  it('assigns in both directions, so a field added on one side is a compile error', () => {
    const fromShared: CatalogueModel = {
      id: 'gpt-6-astra', label: 'GPT-6-Astra', context: 272000, maxContext: 872000,
      efforts: ['high', 'max', 'ultra'], hidden: false, priceIn: null, priceOut: null,
    };
    const onWire: CatalogueModelWire = fromShared;
    const backAgain: CatalogueModel = onWire;
    expect(backAgain.id).toBe('gpt-6-astra');
  });
});
```

with `import type { CatalogueModelWire } from '../../shared/api.js';` and `import type { CatalogueModel } from '../../shared/models.js';` added at the top.

- [ ] **Step 4: Add `searchCatalogue`**

In `server/src/models.ts`:

```ts
/** How many models one page carries when the caller does not say, and the most
 *  it may ask for. OpenRouter advertises several hundred; the ceiling is this
 *  server's decision, not the provider's. */
const CATALOGUE_PAGE = 25;
const CATALOGUE_PAGE_MAX = 100;

/**
 * A page of a lane's catalogue, filtered.
 *
 * HIDDEN MODELS ARE INCLUDED. They are excluded from a `"catalogue"` DISCOVERY
 * list (spec §15.6) — which is a statement about what a lane routes to — and
 * this route is the one place an operator can find one in order to add it
 * explicitly. `hidden` rides on each row so the surface can say which is which.
 *
 * The cursor is the index of the next unread row, decimal, and it is OPAQUE by
 * contract: the client passes back what it was given. A junk cursor reads as
 * the start rather than as an error, because a stale cursor from a catalogue
 * that has since been refreshed is an ordinary event and a 400 there would turn
 * a refresh into a broken search box.
 */
export function searchCatalogue(
  catalogue: Catalogue | null, q: string, limitRaw: number, cursorRaw: string | null,
): { items: CatalogueModel[]; next: string | null } {
  if (catalogue === null) return { items: [], next: null };
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), CATALOGUE_PAGE_MAX)
    : CATALOGUE_PAGE;
  const startRaw = cursorRaw === null ? 0 : Number(cursorRaw);
  const start = Number.isInteger(startRaw) && startRaw >= 0 ? startRaw : 0;
  const needle = q.trim().toLowerCase();
  const matched = needle === ''
    ? catalogue.models
    : catalogue.models.filter((m) =>
        m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle));
  const items = matched.slice(start, start + limit);
  const end = start + items.length;
  return { items, next: end < matched.length ? String(end) : null };
}
```

with `type CatalogueModel` added to the `../../shared/models.js` import.

- [ ] **Step 5: Register the route**

In `server/src/server.ts`, after the refresh route:

```ts
  app.get('/api/accounts/:id/models/catalogue', async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await modelsTarget(reply, id);
    if (target === null) return reply;
    const q = req.query as { q?: string; limit?: string; cursor?: string };
    return searchCatalogue(
      target.lane.catalogue,
      typeof q.q === 'string' ? q.q : '',
      Number(q.limit),
      typeof q.cursor === 'string' && q.cursor !== '' ? q.cursor : null,
    );
  });
```

Add `searchCatalogue` to the `./models.js` import.

- [ ] **Step 6: Run it**

Run from `server/`: `npx vitest run test/models-routes.test.ts test/models-wire.test.ts`
Expected: PASS, 18 tests across the two files.

- [ ] **Step 7: Measured mutation #1 — hidden models stay in the search**

Edit `server/src/models.ts` and add `.filter((m) => !m.hidden)` after `catalogue.models` in `searchCatalogue`'s `matched`.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t catalogue`
Expected: FAIL — `lists the whole catalogue, hidden models included` fails: the received id list is missing `gpt-reserve`.
Restore. Re-run: PASS.

- [ ] **Step 8: Add the page-size unit case, which no route fixture can reach**

The ceiling cannot bite on a five-model catalogue, so it is measured directly. Append to `server/test/models-derive.test.ts`:

```ts
describe('searchCatalogue clamps its page size', () => {
  it('never returns more than 100 rows, whatever the caller asks for', () => {
    // The page size is THIS SERVER's decision, not the provider's: OpenRouter
    // advertises several hundred models and an unclamped `?limit=99999` would
    // put all of them through one response for a search box.
    const many = { probe: 'codex', fetchedAt: 1, stale: false,
      models: Array.from({ length: 250 }, (_, i) => ({
        id: `m-${i}`, label: `M ${i}`, context: null, maxContext: null,
        efforts: [], hidden: false, priceIn: null, priceOut: null })) };
    expect(searchCatalogue(many, '', 99999, null).items.length).toBe(100);
    expect(searchCatalogue(many, '', Number.NaN, null).items.length).toBe(25);
  });
});
```

with `searchCatalogue` added to that file's `../src/models.js` import.

Run from `server/`: `npx vitest run test/models-derive.test.ts`
Expected: PASS.

- [ ] **Step 9: Measured mutation #2 — the label half of the filter**

Edit `server/src/models.ts` and drop the `|| m.label.toLowerCase().includes(needle)` clause.
Run from `server/`: `npx vitest run test/models-routes.test.ts -t catalogue`
Expected: FAIL — `filters on id AND label, case-insensitively` fails with `expected [] to deeply equal [ 'gpt-6-astra' ]`, because `Codex Nova` appears nowhere in that model's id.
Restore. Re-run: PASS.

- [ ] **Step 10: Measured mutation #3 — the limit ceiling**

Edit `server/src/models.ts` and change `Math.min(Math.floor(limitRaw), CATALOGUE_PAGE_MAX)` to `Math.floor(limitRaw)`.
Run from `server/`: `npx vitest run test/models-derive.test.ts -t "clamps its page size"`
Expected: FAIL — `expected 250 to be 100`.
Restore. Re-run: PASS.

- [ ] **Step 11: Typecheck and commit**

Run from `<repo>`: `npx tsc -p server --noEmit` — no output.
Run from `server/`: `npx vitest run` — PASS.

```bash
git add shared/api.ts server/src/models.ts server/src/server.ts server/test/models-routes.test.ts server/test/models-wire.test.ts server/test/models-derive.test.ts
git commit -m "feat(routes): the catalogue is searchable server-side, hidden models included so one can be added on purpose

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: the PWA client — three methods and their refusal words

Spec §8's controls need a typed client. No store change: `RosterWire` already arrives on the fleet store's own 20 s `/api/accounts` poll and on `AccountsScreen`'s (`pwa/src/screens/AccountsScreen.tsx:35-73`), so `models` rides in with the roster and every screen that needs it already has it. `pwa/src/lib/api.ts` gains these THREE methods and nothing else (round 2 item 9).

**Files:**
- Modify: `pwa/src/lib/api.ts` (a `patchJson` helper, three methods, one error map)
- Modify: `pwa/src/lib/accounts.ts` (two projections)
- Modify: `pwa/test/api.test.ts` (new describe)
- Create: `pwa/test/account-models-projection.test.ts`
- Idiom copied from: `pwa/src/lib/api.ts:304-306` (`postJson` — "a POST whose RESPONSE is JSON… same funnel, so a 401 still raises the one login screen"); `pwa/src/lib/api.ts:417-420` (`revokePasskey`'s `encodeURIComponent` on a path segment, written even where today's charset does not need it); `pwa/src/lib/api.ts:27-50` (`SEND_ERROR_TEXT` — a server code becomes a sentence in exactly one place); `pwa/src/lib/accounts.ts:36-52` (`entryFor` — the ONE roster lookup every projection goes through)

**Interfaces:**
- Consumes: Tasks 4-6's routes and their error bodies; Task 1's `AccountModels`, Task 6's `CatalogueSearch`.
- Produces:
  - `pwa/src/lib/api.ts`: `setAccountModels(id, body): Promise<AccountModels>`, `refreshAccountModels(id): Promise<AccountModels>`, `accountCatalogue(id, opts?): Promise<CatalogueSearch>`, and `modelsErrorText(err: unknown): string`
  - `pwa/src/lib/accounts.ts`: `export function accountModelsOf(roster: readonly RosterWire[], wrapper: string): AccountModels | null` and `export function accountHomeAble(roster: readonly RosterWire[], wrapper: string): boolean`

- [ ] **Step 1: Write the failing client test**

Append to `pwa/test/api.test.ts`:

```ts
describe('the model-class client (spec §9)', () => {
  it('PATCHes the body it is given, as JSON, to the lane\'s models route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { classes: {} }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.setAccountModels('gpt', { classes: { fable: 'gpt-6-astra', opus: null }, subagent: 'fable' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/accounts/gpt/models');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string))
      .toEqual({ classes: { fable: 'gpt-6-astra', opus: null }, subagent: 'fable' });
  });

  it('escapes the account id in the path, for revokePasskey\'s reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.refreshAccountModels('a/b');
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('/api/accounts/a%2Fb/models/refresh');
  });

  it('POSTs a refresh with no body at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.refreshAccountModels('gpt');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/accounts/gpt/models/refresh');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('builds the catalogue query from only the parameters it was given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], next: null }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.accountCatalogue('gpt');
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('/api/accounts/gpt/models/catalogue');
    await api.accountCatalogue('gpt', { q: 'astra x', limit: 5, cursor: '2' });
    expect((fetchImpl.mock.calls[1] as [string])[0])
      .toBe('/api/accounts/gpt/models/catalogue?q=astra+x&limit=5&cursor=2');
  });

  it('turns the routes\' refusal codes into sentences, and passes an unknown one through', () => {
    expect(modelsErrorText(new ApiError(404, { error: 'unknown-account' })))
      .toBe('This box has no account by that name.');
    expect(modelsErrorText(new ApiError(409, { error: 'no-registry', detail: 'this lane has no model-class registry yet — run `ccrc models or init <codex|openrouter|compatible>` on the box' })))
      .toContain('ccrc models or init');
    // A verb refusal is the BOX's own sentence and must reach the operator
    // verbatim (spec §9): it names the field, and rewording it here would put a
    // second vocabulary between the operator and the thing that refused.
    expect(modelsErrorText(new ApiError(502, { error: 'verb-refused', detail: 'ccrc: gpt-6-astra is not in this account\'s discovery list' })))
      .toBe("ccrc: gpt-6-astra is not in this account's discovery list");
    expect(modelsErrorText(new ApiError(400, { error: 'bad-request', detail: 'classes.opus: not a model id' })))
      .toBe('classes.opus: not a model id');
    expect(modelsErrorText(new Error('offline'))).toBe('offline');
    // THE SHAPE THE ORDERING DECIDES: a mapped code arriving WITH the box's own
    // detail. The detail wins, because it names the id and the field and this
    // map does not.
    expect(modelsErrorText(new ApiError(404, { error: 'unknown-account', detail: 'ccrc: no account "ghost"' })))
      .toBe('ccrc: no account "ghost"');
  });
});
```

Add `modelsErrorText` to that file's import from `../src/lib/api`.

- [ ] **Step 2: Run it and watch it fail**

Run from `pwa/`: `npx vitest run test/api.test.ts`
Expected: FAIL — `modelsErrorText is not exported`, and `api.setAccountModels is not a function`.

- [ ] **Step 3: Add the PATCH helper and the three methods**

In `pwa/src/lib/api.ts`, beside `postJson` (`:304`):

```ts
  /** A PATCH whose response is JSON. `postJson`'s twin for the one verb this
   *  client did not have: a partial update of a resource, which is exactly what
   *  spec §9's models body is — naming `classes` alone must not clear `effort`.
   *  Same funnel, so a 401 still raises the one login screen. */
  const patchJson = async <T>(path: string, body: unknown): Promise<T> =>
    (await request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })).json() as Promise<T>;
```

and inside the returned object, beside `accounts:` (`:428`):

```ts
    /** The account id goes in the PATH, so it is `encodeURIComponent`'d, for
     *  `revokePasskey`'s reason: a roster `id` cannot hold `/` today
     *  (`shared/roster.ts`'s `ID_RE`), and "today's values happen not to need
     *  escaping" is how a path injection ships the day the format changes. */
    setAccountModels: (id: string, body: {
      classes?: Record<string, string | null>;
      subagent?: string;
      discovery?: 'catalogue' | string[];
      effort?: Record<string, string | null>;
    }): Promise<AccountModels> =>
      patchJson<AccountModels>(`/api/accounts/${encodeURIComponent(id)}/models`, body),
    refreshAccountModels: (id: string): Promise<AccountModels> =>
      postJson<AccountModels>(`/api/accounts/${encodeURIComponent(id)}/models/refresh`),
    /** `URLSearchParams` rather than hand-built query text: an OpenRouter model
     *  id carries `/` and `:` and a search box carries whatever the operator
     *  types. An absent parameter is OMITTED rather than sent empty, so the
     *  no-argument call is the byte-identical bare URL the route reads as "the
     *  whole catalogue, first page". */
    accountCatalogue: (id: string, opts: { q?: string; limit?: number; cursor?: string } = {}): Promise<CatalogueSearch> => {
      const qs = new URLSearchParams();
      if (opts.q !== undefined && opts.q !== '') qs.set('q', opts.q);
      if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
      if (opts.cursor !== undefined && opts.cursor !== '') qs.set('cursor', opts.cursor);
      const tail = qs.toString();
      return getJson<CatalogueSearch>(
        `/api/accounts/${encodeURIComponent(id)}/models/catalogue${tail === '' ? '' : `?${tail}`}`);
    },
```

with `AccountModels` and `CatalogueSearch` added to the file's `shared/api` type import.

- [ ] **Step 4: Add the error map**

Beside `SEND_ERROR_TEXT` (`pwa/src/lib/api.ts:28`):

```ts
/** The model routes' refusals, spelled once.
 *
 * Only ONE of them is a sentence this client writes: `unknown-account`, which
 * the operator can do nothing about and which no `detail` accompanies. Every
 * other refusal already carries the BOX's own words — the shape validator names
 * the field, the 409 names the remedy verb, the verb names the id and the
 * reason (spec §9: "Errors come back as the verb's own sentence") — and
 * rewording those here would put a second vocabulary between the operator and
 * the thing that actually refused, which is the drift `sendErrorText`'s own map
 * exists inside one file to avoid. */
const MODELS_ERROR_TEXT: Record<string, string> = {
  'unknown-account': 'This box has no account by that name.',
};

export function modelsErrorText(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const body = err.body as { error?: unknown; detail?: unknown };
    if (typeof body.detail === 'string' && body.detail.trim() !== '') return body.detail;
    if (typeof body.error === 'string' && MODELS_ERROR_TEXT[body.error] !== undefined) {
      return MODELS_ERROR_TEXT[body.error]!;
    }
  }
  return apiErrorText(err);
}
```

- [ ] **Step 5: Add the roster projections**

In `pwa/src/lib/accounts.ts`, after `accountHue`:

```ts
/** This lane's model-class registry, or `null` when there is none to show — the
 *  wire's own `null` (no `~/.ccrc/models/<id>.classes.json` on the box), an
 *  ABSENT key (an older server, spec §9's field is additive), and, identically,
 *  a wrapper this roster does not have at all.
 *
 *  Through `entryFor` like every other projection here, so "known to this
 *  roster" stays answered in exactly one place. */
export function accountModelsOf(
  roster: readonly RosterWire[], wrapper: string,
): AccountModels | null {
  return entryFor(roster, wrapper)?.models ?? null;
}

/** Whether ccd's least-loaded picker may land a fresh session on this lane —
 *  and, for the Models section only, the stand-in for "this lane runs Claude
 *  Code's own model aliases" (C-5).
 *
 *  The roster's `telemetry` field is the honest signal and it is not on the
 *  wire; this plan may add exactly one field to `RosterWire` and `models` is
 *  it. `homeAble` is true for every Anthropic account on today's roster and
 *  false for `gpt`, and it decides ONE thing: which read-only copy a lane with
 *  no registry shows. It never decides routing — `available` is computed from
 *  the registry file on the server. When `exec.provider` reaches `main` this
 *  becomes one `provider === 'anthropic'` read (spec §14's fold-in).
 *
 *  `false` for a wrapper this roster does not have: an unknown lane gets the
 *  more cautious copy, which offers no client-default claim about a lane
 *  nothing on this box describes. */
export function accountHomeAble(roster: readonly RosterWire[], wrapper: string): boolean {
  return entryFor(roster, wrapper)?.homeAble === true;
}
```

with `AccountModels` added to the `shared/api` type import.

- [ ] **Step 6: Write the failing projection test**

Create `pwa/test/account-models-projection.test.ts`:

```ts
// `accountModelsOf`/`accountHomeAble` — the two projections every models
// surface goes through, so an unarrived roster, an older wire and an unrostered
// wrapper degrade in ONE place rather than in each component.
import { describe, it, expect } from 'vitest';
import type { RosterWire } from '../../shared/api';
import { accountHomeAble, accountModelsOf } from '../src/lib/accounts';
import { TEST_ROSTER } from './rosterFixture';

const withModels: RosterWire[] = TEST_ROSTER.map((a) => a.id !== 'gpt' ? a : {
  ...a,
  models: {
    probe: 'codex',
    classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
    subagent: 'sonnet', discovery: 'catalogue', effort: { opus: 'max' },
    catalogue: { fetchedAt: 1789000000, stale: false, count: 4 },
    unclassified: ['gpt-6-astra'], retired: [], available: ['haiku', 'sonnet', 'opus'],
    labels: { 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-6-astra': 'GPT-6-Astra' },
  },
});

describe('accountModelsOf / accountHomeAble', () => {
  it('finds a lane\'s registry', () => {
    expect(accountModelsOf(withModels, 'gpt')?.classes.opus).toBe('gpt-5.6-sol');
    expect(accountModelsOf(withModels, 'gpt')?.subagent).toBe('sonnet');
  });

  it('answers null for a lane with no registry, for an unrostered wrapper, before the roster arrives, and for an older wire', () => {
    expect(accountModelsOf(withModels, 'claude')).toBeNull();     // key absent — the fixture's default
    expect(accountModelsOf(withModels, 'nobody')).toBeNull();
    expect(accountModelsOf([], 'gpt')).toBeNull();
    expect(accountModelsOf(withModels.map((a) => ({ ...a, models: null })), 'gpt')).toBeNull();
  });

  it('reads homeAble, and answers false for a wrapper this roster does not have', () => {
    expect(accountHomeAble(withModels, 'claude')).toBe(true);
    expect(accountHomeAble(withModels, 'gpt')).toBe(false);
    expect(accountHomeAble(withModels, 'nobody')).toBe(false);
    expect(accountHomeAble([], 'claude')).toBe(false);
  });
});
```

`pwa/test/rosterFixture.ts` needs NO change: `models` is optional on `RosterWire` (Task 1), and an absent key is exactly the "no registry" state every existing test should keep seeing.

- [ ] **Step 7: Run the PWA tests**

Run from `pwa/`: `npx vitest run test/api.test.ts test/account-models-projection.test.ts`
Expected: PASS.

Run from `pwa/`: `npx vitest run test/accounts-screen.test.tsx test/swap-sheet.test.tsx test/stores.test.ts`
Expected: PASS — untouched, because the new field is optional.

- [ ] **Step 8: Measured mutation — the verb's own sentence must win**

Edit `pwa/src/lib/api.ts` and move the `MODELS_ERROR_TEXT[body.error]` lookup ABOVE the `body.detail` return in `modelsErrorText`.
Run from `pwa/`: `npx vitest run test/api.test.ts -t "turns the routes"`
Expected: FAIL — `expected 'This box has no account by that name.' to be 'ccrc: no account "ghost"'`: the box's own sentence, which names the id, would be replaced by this file's generic one.
Restore. Re-run: PASS.

- [ ] **Step 9: Typecheck and commit**

Run from `<repo>`: `npx tsc -p pwa --noEmit` — no output.

```bash
git add pwa/src/lib/api.ts pwa/src/lib/accounts.ts pwa/test/api.test.ts pwa/test/account-models-projection.test.ts
git commit -m "feat(pwa): a typed client for the three model routes, and the two roster projections every surface reads through

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: the session picker becomes data — and the hardcoded table goes

Spec §8's second bullet and §13.4. `modelOptions` stops branching on a wrapper STRING and starts reading the lane's registry. The gpt rows are deleted in this edit; the four Anthropic display names stay, under a header that says they are the last ones.

**Files:**
- Modify: `pwa/src/lib/models.ts` (rewrite `modelOptions`, widen `PickOption`, re-point `effortOptions`)
- Modify: `pwa/src/session/PickSheet.tsx` (render an unavailable row)
- Modify: `pwa/src/screens/SessionScreen.tsx:403, 411` (pass the registry)
- Modify: `pwa/src/session/chat.css` (one rule for the unavailable row)
- Modify: `server/test/single-definition.test.ts` (Plan 1 Task 12's class-enumeration list — Step 6b)
- Create: `pwa/test/model-options.test.tsx`
- Idiom copied from: `pwa/src/lib/models.ts:12-20` (the existing `PickOption` and the loose `current` match — kept, because a statusline display name really does carry suffixes like "(1M context)"); `pwa/src/session/PickSheet.tsx:19-42` (the `.opt` chrome and the `❯`/`●` active pair)

**Interfaces:**
- Consumes: Task 1's `AccountModels`; Task 7's `accountModelsOf`; `shared/models.ts`'s `type ModelClass`.
- Produces:
  - `pwa/src/lib/models.ts`: `PickOption` gains `disabled?: boolean`; `modelOptions(models: AccountModels | null, current: string | null): PickOption[]`; `effortOptions(models: AccountModels | null, effort: string | null, ultracode: boolean): PickOption[]`; `export const ANTHROPIC_CLASS_NAMES: Record<ModelClass, string>`, `export const CLASS_ORDER: readonly ModelClass[]`, `export const CLASS_TITLE: Record<ModelClass, string>`

- [ ] **Step 1: Write the failing picker test**

Create `pwa/test/model-options.test.tsx`:

```tsx
// The session picker, after spec §8 turned it into data. Two halves, both here
// because the rows and the chrome that renders them are one contract: a row
// marked unavailable that the sheet still lets you tap is not a disabled row.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AccountModels } from '../../shared/api';
import { modelOptions, effortOptions } from '../src/lib/models';
import { PickSheet } from '../src/session/PickSheet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const gpt = (over: Partial<AccountModels> = {}): AccountModels => ({
  probe: 'codex',
  classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { opus: 'max' },
  catalogue: { fetchedAt: 1789000000, stale: false, count: 4 },
  unclassified: ['gpt-6-astra'], retired: [], available: ['haiku', 'sonnet', 'opus'],
  labels: {
    'gpt-5.6-luna': 'GPT-5.6 Luna', 'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-6-astra': 'GPT-6-Astra',
  },
  ...over,
});

describe('modelOptions on a lane with NO registry (models === null)', () => {
  it('is the four client defaults plus Default, and every row sends a bare alias', () => {
    const rows = modelOptions(null, 'Opus 5 (1M context)');
    expect(rows.map((r) => r.label)).toEqual(['Opus 5', 'Sonnet 5', 'Fable 5', 'Haiku 4.5', 'Default']);
    expect(rows.map((r) => r.command)).toEqual([
      '/model opus', '/model sonnet', '/model fable', '/model haiku', '/model default',
    ]);
    // The loose match survives: the statusline display name carries suffixes.
    expect(rows.find((r) => r.label === 'Opus 5')?.active).toBe(true);
    expect(rows.some((r) => r.disabled === true)).toBe(false);
  });
});

describe('modelOptions on a CLASSED lane', () => {
  it('labels each class with the lane\'s own model, from the catalogue', () => {
    const rows = modelOptions(gpt(), 'GPT-5.6 Sol');
    expect(rows.map((r) => r.label)).toEqual([
      'Opus-class · GPT-5.6 Sol',
      'Sonnet-class · GPT-5.6 Terra',
      'Fable-class',
      'Haiku-class · GPT-5.6 Luna',
      'Default',
    ]);
    expect(rows[0]?.active).toBe(true);
    expect(rows[3]?.active).toBe(false);
  });

  it('disables an UNASSIGNED class and says why — the sentinel is never shown as a model name', () => {
    const fable = modelOptions(gpt(), null).find((r) => r.label === 'Fable-class')!;
    expect(fable.disabled).toBe(true);
    expect(fable.sublabel).toBe('no model is assigned to Fable-class on this account');
    expect(JSON.stringify(fable)).not.toContain('ccrc-unavailable');
  });

  it('disables a RETIRED class and names the id the provider stopped advertising', () => {
    const rows = modelOptions(gpt({ retired: ['gpt-5.6-sol'], available: ['haiku', 'sonnet'] }), null);
    const opus = rows.find((r) => r.label.startsWith('Opus-class'))!;
    expect(opus.disabled).toBe(true);
    expect(opus.sublabel).toBe('GPT-5.6 Sol is no longer advertised by this provider');
  });

  it('falls back to the id when the catalogue has no label for it — never invents a name', () => {
    const rows = modelOptions(gpt({ labels: {} }), null);
    expect(rows[0]?.label).toBe('Opus-class · gpt-5.6-sol');
  });

  it('matches the current model by label OR id, because the statusline gives one or the other', () => {
    expect(modelOptions(gpt(), 'GPT-5.6 Terra')[1]?.active).toBe(true);
    expect(modelOptions(gpt(), 'gpt-5.6-terra')[1]?.active).toBe(true);
  });
});

describe('effortOptions', () => {
  it('offers Ultracode on a lane the client owns, and not on a classed one', () => {
    // UNCHANGED ROWS (spec §8): the six levels are what they were. What moved is
    // the predicate that decides whether Ultracode — a client super-mode, not a
    // provider level — is one of them: from a hardcoded `wrapper !== 'gpt'` to
    // "this lane has no class registry", which is the same answer for today's
    // fleet and the right one for every lane added after it.
    expect(effortOptions(null, 'high', false).map((r) => r.label))
      .toEqual(['Low', 'Medium', 'High', 'Xhigh', 'Ultracode', 'Max', 'Auto']);
    expect(effortOptions(gpt(), 'high', false).map((r) => r.label))
      .toEqual(['Low', 'Medium', 'High', 'Xhigh', 'Max', 'Auto']);
  });
});

describe('PickSheet renders an unavailable row as unavailable', () => {
  it('marks it aria-disabled, shows its reason, and swallows the tap', () => {
    const onPick = vi.fn();
    render(
      <PickSheet
        open onClose={vi.fn()} eyebrow="model" title="Choose a model"
        options={modelOptions(gpt(), null)} onPick={onPick}
      />,
    );
    const row = screen.getByRole('button', { name: /Fable-class/ });
    // `aria-disabled`, NOT the `disabled` attribute: a disabled button is not
    // focusable, so a screen-reader user would never hear the reason the row is
    // there to give. The row stays reachable and says why it cannot be taken.
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).not.toHaveAttribute('disabled');
    expect(row.textContent).toContain('no model is assigned to Fable-class on this account');
    fireEvent.click(row);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('still sends the command for an available row', () => {
    const onPick = vi.fn();
    render(
      <PickSheet
        open onClose={vi.fn()} eyebrow="model" title="Choose a model"
        options={modelOptions(gpt(), null)} onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Opus-class/ }));
    expect(onPick).toHaveBeenCalledWith('/model opus');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `pwa/`: `npx vitest run test/model-options.test.tsx`
Expected: FAIL — `modelOptions` is called with an `AccountModels` where it takes a wrapper string, so the classed cases receive the Anthropic table (`['Opus 5','Sonnet 5','Fable 5','Haiku 4.5','Default']`), and `aria-disabled` is absent.

- [ ] **Step 3: Rewrite `pwa/src/lib/models.ts`**

Replace the whole file:

```ts
// Model + effort option lists for the session pickers.
//
// DATA, NOT A TABLE (spec §8). This file used to branch on the wrapper STRING
// and carry `GPT-5.6 Sol/Terra/Luna` inline — three concrete model names, in a
// browser bundle, for one lane, with no Fable row at all, going stale the day
// the provider shipped anything (it had: the Codex catalogue moved and this
// list did not, spec §1). The rows are now the four CLASSES, labelled from the
// lane's own registry off `GET /api/accounts`; a lane with no registry
// (`models === null`) is one Claude Code owns the aliases for.
//
// THE FOUR NAMES BELOW ARE THE LAST HARDCODED MODEL NAMES IN THIS TREE, and
// spec §8 says so explicitly: on an Anthropic lane the four aliases resolve to
// the client's own current defaults, there is no catalogue probe for that
// provider (spec §15.4), and nothing on the box can tell us what `opus` means
// today. Bump one when a family's newest name changes; the alias never moves.
// `pwa/test/model-table-deleted.test.ts` is what stops a fifth name joining
// them.
//
// `/model <alias>` and `/effort <level>` are still what gets sent — the lane's
// settings `env` block is what resolves an alias to a concrete id (spec §6.1),
// so the picker never names one.
import type { AccountModels } from '../../../shared/api';
import type { ModelClass } from '../../../shared/models';

export interface PickOption {
  label: string;
  sublabel?: string;
  command: string; // slash command sent to the session, e.g. "/model opus"
  active: boolean; // matches the session's current model/effort
  /** This row cannot be taken on this lane, and `sublabel` says why. Rendered
   *  `aria-disabled` and inert rather than with the `disabled` attribute — see
   *  `PickSheet`. */
  disabled?: boolean;
}

/** The client's own current defaults, per class. See the header: these four are
 *  the exception spec §8 grants and the only concrete model names left here. */
export const ANTHROPIC_CLASS_NAMES: Record<ModelClass, string> = {
  opus: 'Opus 5', sonnet: 'Sonnet 5', fable: 'Fable 5', haiku: 'Haiku 4.5',
};

/** Reading order for every class CONTROL in this app — the picker's rows, the
 *  Models section's radios, the SwapSheet's substitute ranking (Plan 3b). NOT
 *  `CLASSES` order: that one is cheapest-first, because it is the order the
 *  registry and every refusal message walk in, and a chooser reads best
 *  strongest-first.
 *
 *  EXPORTED, and the other files that need it import it rather than spelling
 *  their own four-element array — one order in three copies is exactly the
 *  drift `server/test/single-definition.test.ts` exists for. */
export const CLASS_ORDER: readonly ModelClass[] = ['opus', 'sonnet', 'fable', 'haiku'];

/** Capitalised class word for a label — `Opus-class · GPT-6-Astra` is spec §8's
 *  own example. Exported for the same reason `CLASS_ORDER` is. */
export const CLASS_TITLE: Record<ModelClass, string> = {
  opus: 'Opus', sonnet: 'Sonnet', fable: 'Fable', haiku: 'Haiku',
};

/**
 * Model chooser rows.
 *
 * `models` is the lane's registry (`RosterWire.models`, via `accountModelsOf`)
 * or `null` for a lane that has none — an Anthropic account, which never has a
 * registry file (spec §4.1), or one nobody has seeded yet. `current` is the pane
 * statusline's display name ("Opus 5 (1M context)", "GPT-5.6 Sol"), matched
 * LOOSELY because of exactly that suffix; on a classed lane it is matched
 * against the catalogue label AND the id, because a lane that has never been
 * probed has no label to match.
 */
export function modelOptions(models: AccountModels | null, current: string | null): PickOption[] {
  const c = (current ?? '').toLowerCase();
  const rows: PickOption[] = CLASS_ORDER.map((cls) => {
    if (models === null) {
      return {
        label: ANTHROPIC_CLASS_NAMES[cls],
        command: `/model ${cls}`,
        active: c.includes(cls),
      };
    }
    const id = models.classes[cls];
    const label = id === null ? null : (models.labels[id] ?? id);
    const available = models.available.includes(cls);
    const reason = id === null
      ? `no model is assigned to ${CLASS_TITLE[cls]}-class on this account`
      : `${label} is no longer advertised by this provider`;
    return {
      label: id === null ? `${CLASS_TITLE[cls]}-class` : `${CLASS_TITLE[cls]}-class · ${label}`,
      // The reason IS the sublabel: one string, in the slot the sheet already
      // renders under a row's name, rather than a second field saying the same
      // thing in a second place.
      ...(available ? {} : { sublabel: reason, disabled: true }),
      command: `/model ${cls}`,
      active: id !== null && available
        && (c.includes((label ?? '').toLowerCase()) || c.includes(id.toLowerCase())),
    };
  });
  return [...rows, { label: 'Default', command: '/model default', active: false }];
}

/**
 * Effort chooser rows.
 *
 * THE ROWS ARE UNCHANGED (spec §8). What moved is the predicate that decides
 * whether Ultracode is offered: it is xhigh plus workflow orchestration, a
 * CLIENT super-mode rather than a provider level, so it belongs to lanes Claude
 * Code owns the aliases for — `models === null` — and not to a hardcoded `gpt`.
 * Byte-identical for today's fleet once the gpt lane is seeded (spec §13.1), and
 * correct for the next lane somebody connects.
 *
 * The five real levels now TAKE EFFECT on a classed lane, which they did not
 * before: `ccgpt-proxy` reads the request's `output_config.effort` and sets
 * Codex's `reasoning.effort` from it (spec §6.4).
 */
export function effortOptions(
  models: AccountModels | null,
  effort: string | null,
  ultracode: boolean,
): PickOption[] {
  const e = (effort ?? '').toLowerCase();
  const opts: PickOption[] = [
    { label: 'Low', command: '/effort low', active: e === 'low' },
    { label: 'Medium', command: '/effort medium', active: e === 'medium' },
    { label: 'High', command: '/effort high', active: e === 'high' },
    { label: 'Xhigh', command: '/effort xhigh', active: e === 'xhigh' && !ultracode },
    { label: 'Max', command: '/effort max', active: e === 'max' },
    { label: 'Auto', command: '/effort auto', active: e === 'auto' },
  ];
  if (models === null) {
    opts.splice(4, 0, {
      label: 'Ultracode',
      sublabel: 'xhigh + workflow orchestration',
      command: '/effort ultracode',
      active: ultracode,
    });
  }
  return opts;
}
```

- [ ] **Step 4: Render an unavailable row in `PickSheet`**

In `pwa/src/session/PickSheet.tsx`, replace the button:

```tsx
        {options.map((o) => (
          <button
            key={o.command}
            type="button"
            className={o.disabled === true ? 'opt opt--unavailable' : (o.active ? 'opt opt--selected' : 'opt')}
            /* `aria-disabled`, NEVER the `disabled` attribute. A `disabled`
               button is removed from the tab order, so the one reader who most
               needs the row's reason — "no model is assigned to Fable-class on
               this account" — is the one who can never reach it. The row stays
               focusable, announces itself as unavailable, and swallows the tap
               here rather than sending a `/model` the lane would answer with an
               opaque provider 404 (spec §6.1's sentinel exists for exactly that
               request; ccd refuses earlier still, §7). */
            aria-disabled={o.disabled === true ? true : undefined}
            onClick={() => { if (o.disabled !== true) onPick(o.command); }}
          >
            <span className="opt-glyph" aria-hidden="true">{o.active ? '❯' : ''}</span>
            <span className="opt-body">
              <span className="opt-label">{o.label}</span>
              {o.sublabel && <span className="opt-desc">{o.sublabel}</span>}
            </span>
            {o.active && (
              <span className="opt-enter" aria-hidden="true">●</span>
            )}
          </button>
        ))}
```

In `pwa/src/session/chat.css`, beside the `.opt--selected` rule:

```css
/* An unavailable row stands down through INK, never through opacity: a fade
   composites the ground into the text after the token pair was chosen, which
   pushes the label below AA and is what `pwa/design/DIRECTION.md` bans by name.
   The row keeps its full tap target — it is focusable and it has something to
   say. */
.opt--unavailable {
  color: var(--ink-disabled);
  cursor: default;
}
```

- [ ] **Step 5: Pass the registry from `SessionScreen`**

`pwa/src/screens/SessionScreen.tsx:403` and `:411`:

```tsx
        options={modelOptions(accountModelsOf(roster, wrapper), live?.model ?? null)}
```
```tsx
        options={effortOptions(accountModelsOf(roster, wrapper), live?.effort ?? null, live?.ultracode ?? false)}
```

`roster` and `wrapper` are already in scope (`SessionScreen.tsx:77` and `:139`). Add `accountModelsOf` to the existing `../lib/accounts` import.

- [ ] **Step 6: Run the tests**

Run from `pwa/`: `npx vitest run test/model-options.test.tsx`
Expected: PASS, 10 tests.

Run from `pwa/`: `npx vitest run test/contrast.test.ts test/chat.test.tsx test/tap-targets.test.tsx`
Expected: PASS. If the contrast gate refuses `.opt--unavailable`, it is because `--ink-disabled` over the sheet ground is not a registered pair — register it in `pwa/design/audit.mjs`'s pair list beside the existing `.opt` pair rather than changing the token.

- [ ] **Step 6b: Widen the class-enumeration list this task's constants red**

`pwa/src/lib/models.ts` now declares three walks of all four classes —
`ANTHROPIC_CLASS_NAMES`, `CLASS_ORDER` and `CLASS_TITLE` — and Plan 1 Task 12's
`MODELS_CORPUS` includes `ALL`, which covers `pwa/src/`. Its exact-match case `the four
class names are enumerated only where a walk needs the sequence` is therefore RED. Three
walks in one file is exactly what that case permits ("a file may list all four ONLY if it
walks them in order"), so the fix is one row, in `rel`'s own sort order — keeping whatever
rows the plans that ran before this one added (Plan 2 adds `'ccd/ccd'`):

```ts
    expect(holders).toEqual([
      'ccd/ccd',               // CCD_CLASSES (Plan 2, if it has landed)
      'ccd/ccrc',              // MODELS_CLASSES — the usage-error gate
      'deploy/models-op.mjs',  // CLASSES — the mutation walk
      'pwa/src/lib/models.ts', // ANTHROPIC_CLASS_NAMES / CLASS_ORDER / CLASS_TITLE (this plan, Task 8)
      'shared/modelenv.mjs',   // the env block's key order and the TSV's
      'shared/models.mjs',     // the twin's mirrored list
      'shared/models.ts',      // CLASSES — the definition, and FAMILY_TOKENS
    ]);
```

Run from `server/`: `npx vitest run test/single-definition.test.ts -t "the four class names are enumerated"`
Expected: PASS after the edit, and before it, FAIL naming `pwa/src/lib/models.ts` in the
received list. If the run reports a row this step did not name — `ModelsSection.tsx` and
`SwapSheet.tsx` are the candidates, and both IMPORT `CLASS_ORDER` rather than declaring a
list — read the file before deciding: add it with a comment saying what walks there, or
tighten the predicate's word-boundary arm so it stops matching prose. Never loosen the
assertion into a pattern.

- [ ] **Step 7: Measured mutation #1 — the tap really is swallowed**

Edit `pwa/src/session/PickSheet.tsx` and change the handler to `onClick={() => onPick(o.command)}`.
Run from `pwa/`: `npx vitest run test/model-options.test.tsx -t "swallows the tap"`
Expected: FAIL — `expected "spy" not to be called at all, but it was called with '/model fable'`.
Restore. Re-run: PASS.

- [ ] **Step 8: Measured mutation #2 — retired is not the same as unassigned**

Edit `pwa/src/lib/models.ts` and change `modelOptions`'s `available` to `const available = id !== null;`.
Run from `pwa/`: `npx vitest run test/model-options.test.tsx`
Expected: FAIL — `disables a RETIRED class and names the id the provider stopped advertising` fails with `expected undefined to be true`: a class whose id the provider no longer advertises would be offered, and the request would die at the provider with an opaque error.
Restore. Re-run: PASS.

- [ ] **Step 9: Measured mutation #3 — the Ultracode predicate**

Edit `pwa/src/lib/models.ts` and change `if (models === null)` in `effortOptions` to `if (true)`.
Run from `pwa/`: `npx vitest run test/model-options.test.tsx -t effortOptions`
Expected: FAIL — the classed-lane list gains `Ultracode`, and `expected [ 'Low', …, 'Ultracode', 'Max', 'Auto' ] to deeply equal [ 'Low', …, 'Max', 'Auto' ]`.
Restore. Re-run: PASS.

- [ ] **Step 10: Typecheck and commit**

Run from `<repo>`: `npx tsc -p pwa --noEmit` — no output. A `TS2345` here names a `modelOptions(wrapper, …)` call site Step 5 missed.

```bash
git add pwa/src/lib/models.ts pwa/src/session/PickSheet.tsx pwa/src/session/chat.css pwa/src/screens/SessionScreen.tsx pwa/test/model-options.test.tsx server/test/single-definition.test.ts
git commit -m "feat(pwa): the session picker reads the lane's classes instead of a table of model names

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: the Models section — badges, the class radio, the subagent chooser, Refresh

Spec §8's first bullet, minus each row's numbers and the discovery Add (Task 10). One row per discovery-listed model, a class radio across the row, the lane's subagent chooser, the badges, a Refresh button, and the two read-only arms (C-6).

**Files:**
- Create: `pwa/src/fleet/ModelsSection.tsx`
- Modify: `pwa/src/screens/AccountsScreen.tsx` (render it inside the account card)
- Modify: `pwa/src/fleet/fleet.css` (the section's rules)
- Modify: `pwa/test/tap-targets.test.tsx` (the CSS scrape + one render)
- Create: `pwa/test/models-section.test.tsx`
- Idiom copied from: `pwa/src/fleet/CapsControl.tsx:159-205` (the `role="group"` + labelled fields + the ALWAYS-MOUNTED `role="status"` note, and its docstring's reason: a live region inserted at the moment its text appears is announced unreliably); `pwa/src/components/QuickConfirm.tsx` (a consequence sentence before a commitment); `pwa/src/screens/AccountsScreen.tsx:182-236` (the account card's own `<section className="accounts-row">` and its `.accounts-fresh` meta voice); `pwa/src/fleet/formatReset.ts`'s `formatAge`

**Interfaces:**
- Consumes: Task 7's `api.setAccountModels`/`api.refreshAccountModels`/`api.accountCatalogue`/`modelsErrorText`, `accountModelsOf`/`accountHomeAble`; Task 8's `ANTHROPIC_CLASS_NAMES`/`CLASS_ORDER`/`CLASS_TITLE`; `shared/models.ts`'s `CLASSES`, `type ModelClass`, `isModelClass`.
- Produces:
  - `pwa/src/fleet/ModelsSection.tsx`: `export interface ModelsClient { setAccountModels; refreshAccountModels; accountCatalogue }`, `export function modelRows(models: AccountModels): string[]`, `export function classHolding(models: AccountModels, id: string): ModelClass | null`, `export function ModelsSection(props: ModelsSectionProps): ReactNode`
  - `ModelsSectionProps = { wrapper: string; homeAble: boolean; models: AccountModels | null; client?: ModelsClient; nowSec?: number }`

- [ ] **Step 1: Write the failing render test**

Create `pwa/test/models-section.test.tsx`:

```tsx
// The Models section (spec §8). Rendered inside the account card, so its
// contract is the accessibility one every card control here carries: a control
// is reachable by ROLE and NAME, a state change is ANNOUNCED in a live region
// that was already mounted, and a destructive-looking edit states its
// consequence before it commits.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AccountModels } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import { ModelsSection, classHolding, modelRows } from '../src/fleet/ModelsSection';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MODELS = (over: Partial<AccountModels> = {}): AccountModels => ({
  probe: 'codex',
  classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { opus: 'max' },
  catalogue: { fetchedAt: 1789000000, stale: false, count: 5 },
  unclassified: ['gpt-6-astra'],
  retired: [],
  available: ['haiku', 'sonnet', 'opus'],
  labels: {
    'gpt-5.6-luna': 'GPT-5.6 Luna', 'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-6-astra': 'GPT-6-Astra',
  },
  ...over,
});

/** A client whose three methods are spies; `set` resolves to whatever the test
 *  says the box now holds, so the section's own re-render is measured rather
 *  than assumed. */
const client = (over: Partial<{
  set: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; catalogue: ReturnType<typeof vi.fn>;
}> = {}) => {
  const set = over.set ?? vi.fn().mockResolvedValue(MODELS());
  const refresh = over.refresh ?? vi.fn().mockResolvedValue(MODELS());
  const catalogue = over.catalogue ?? vi.fn().mockResolvedValue({ items: [], next: null });
  return { spies: { set, refresh, catalogue },
    client: { setAccountModels: set, refreshAccountModels: refresh, accountCatalogue: catalogue } };
};

const mount = (models: AccountModels | null, homeAble = false, c = client()) => {
  render(<ModelsSection wrapper="gpt" homeAble={homeAble} models={models}
                        client={c.client as never} nowSec={1789003600} />);
  return c;
};

describe('modelRows / classHolding — the row set, derived once', () => {
  it('lists classified models first in reading order, then unclassified, then retired, deduped', () => {
    expect(modelRows(MODELS({ retired: ['gpt-5.5'] })))
      .toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-5.5']);
  });

  it('a retired id that is STILL CLASSED appears once, in its class position', () => {
    // Spec §4.3: a retired class id empties nothing in the registry. It must not
    // render as two rows saying different things about one model.
    const m = MODELS({ retired: ['gpt-5.6-sol'], available: ['haiku', 'sonnet'] });
    expect(modelRows(m).filter((id) => id === 'gpt-5.6-sol').length).toBe(1);
    expect(modelRows(m)[0]).toBe('gpt-5.6-sol');
  });

  it('answers which class holds a model, and null for one that holds none', () => {
    expect(classHolding(MODELS(), 'gpt-5.6-sol')).toBe('opus');
    expect(classHolding(MODELS(), 'gpt-6-astra')).toBeNull();
  });
});

describe('ModelsSection — the two read-only arms (C-6)', () => {
  it('renders the four client defaults for a home-able lane with no registry', () => {
    mount(null, true);
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
    for (const name of ['Opus 5', 'Sonnet 5', 'Fable 5', 'Haiku 4.5']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText(/client default/i)).toBeInTheDocument();
    // No controls at all: there is nothing on this lane ccrc may set.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('names the init remedy for a NON-home-able lane with no registry (spec §13.1)', () => {
    mount(null, false);
    expect(screen.getByText(/ccrc models gpt init/)).toBeInTheDocument();
    expect(screen.queryByText(/client default/i)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('ModelsSection — what a registered lane renders', () => {
  it('renders one row per discovery-listed model, each with a five-way class radio', () => {
    mount(MODELS());
    for (const label of ['GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-6-Astra']) {
      expect(screen.getByRole('group', { name: `Class for ${label}` })).toBeInTheDocument();
    }
    const solRow = screen.getByRole('group', { name: 'Class for GPT-5.6 Sol' });
    expect(within(solRow).getAllByRole('radio')).toHaveLength(5);
    expect(within(solRow).getByRole('radio', { name: 'Opus' })).toBeChecked();
    const astra = screen.getByRole('group', { name: 'Class for GPT-6-Astra' });
    expect(within(astra).getByRole('radio', { name: 'No class' })).toBeChecked();
  });

  it('falls back to the id when the catalogue named no label for a model', () => {
    mount(MODELS({ labels: {} }));
    expect(screen.getByRole('group', { name: 'Class for gpt-5.6-sol' })).toBeInTheDocument();
  });
});

describe('ModelsSection — the badges (spec §8)', () => {
  it('counts the unclassified', () => {
    mount(MODELS());
    expect(screen.getByText('1 unclassified')).toBeInTheDocument();
  });

  it('says NEVER PROBED, which is not the same as an empty catalogue', () => {
    mount(MODELS({ catalogue: null, unclassified: [], available: [] }));
    expect(screen.getByText('never probed')).toBeInTheDocument();
    expect(screen.queryByText(/stale since/)).not.toBeInTheDocument();
  });

  it('says STALE SINCE with the age of the last good probe', () => {
    // fetchedAt 1789000000, now 1789003600 — one hour.
    mount(MODELS({ catalogue: { fetchedAt: 1789000000, stale: true, count: 5 } }));
    expect(screen.getByText(/stale since 1h/)).toBeInTheDocument();
  });

  it('names every retired id, one badge each', () => {
    mount(MODELS({ retired: ['gpt-5.6-sol', 'gpt-5.5'], available: ['haiku', 'sonnet'] }));
    expect(screen.getByText('retired: GPT-5.6 Sol')).toBeInTheDocument();
    expect(screen.getByText('retired: gpt-5.5')).toBeInTheDocument();
  });
});

describe('ModelsSection — moving a class between rows', () => {
  it('sends the clear AND the set in one PATCH, and announces what moved', async () => {
    const c = mount(MODELS());
    const astra = screen.getByRole('group', { name: 'Class for GPT-6-Astra' });
    await act(async () => { fireEvent.click(within(astra).getByRole('radio', { name: 'Fable' })); });
    expect(c.spies.set).toHaveBeenCalledWith('gpt', { classes: { fable: 'gpt-6-astra' } });
    expect(screen.getByRole('status').textContent).toContain('GPT-6-Astra is now Fable-class');
  });

  it('a row LEAVING a class clears it in the same body', async () => {
    const c = mount(MODELS());
    const sol = screen.getByRole('group', { name: 'Class for GPT-5.6 Sol' });
    await act(async () => { fireEvent.click(within(sol).getByRole('radio', { name: 'Fable' })); });
    // Clear the class this row held, set the class it is taking — the pair the
    // route then orders (clears before sets) so no intermediate state has two
    // classes naming one model.
    expect(c.spies.set).toHaveBeenCalledWith('gpt', { classes: { opus: null, fable: 'gpt-5.6-sol' } });
  });

  it('SAYS SO BEFORE SAVING when the class is already held by another model', async () => {
    const c = mount(MODELS());
    const astra = screen.getByRole('group', { name: 'Class for GPT-6-Astra' });
    await act(async () => { fireEvent.click(within(astra).getByRole('radio', { name: 'Opus' })); });
    // Nothing has been written yet — spec §8: "the UI says so before saving".
    expect(c.spies.set).not.toHaveBeenCalled();
    expect(screen.getByText(/GPT-5.6 Sol stops being Opus-class/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move' })); });
    expect(c.spies.set).toHaveBeenCalledWith('gpt', { classes: { opus: 'gpt-6-astra' } });
  });

  it('cancelling the confirm writes nothing and leaves the radio where it was', async () => {
    const c = mount(MODELS());
    const astra = screen.getByRole('group', { name: 'Class for GPT-6-Astra' });
    await act(async () => { fireEvent.click(within(astra).getByRole('radio', { name: 'Opus' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /cancel/i })); });
    expect(c.spies.set).not.toHaveBeenCalled();
    expect(within(screen.getByRole('group', { name: 'Class for GPT-6-Astra' }))
      .getByRole('radio', { name: 'No class' })).toBeChecked();
  });

  it('a refusal reaches the operator as the box\'s own sentence, and nothing re-renders as if it worked', async () => {
    // A REAL `ApiError`: `modelsErrorText` narrows with `instanceof`, so a
    // look-alike object would fall through to `apiErrorText` and this case would
    // pass for the wrong reason.
    const set = vi.fn().mockRejectedValue(
      new ApiError(502, { error: 'verb-refused', detail: "ccrc: gpt-6-astra is not in this account's discovery list" }));
    const c = mount(MODELS(), false, client({ set }));
    const astra = screen.getByRole('group', { name: 'Class for GPT-6-Astra' });
    await act(async () => { fireEvent.click(within(astra).getByRole('radio', { name: 'Fable' })); });
    expect(screen.getByRole('status').textContent).toContain("not in this account's discovery list");
    expect(within(screen.getByRole('group', { name: 'Class for GPT-6-Astra' }))
      .getByRole('radio', { name: 'No class' })).toBeChecked();
    expect(c.spies.set).toHaveBeenCalledTimes(1);
  });
});

describe('ModelsSection — the subagent chooser (spec §4.1, §6.1)', () => {
  it('shows the lane\'s explicit choice, with the model it resolves to', () => {
    mount(MODELS());
    const sel = screen.getByRole('combobox', { name: /subagent class/i }) as HTMLSelectElement;
    expect(sel.value).toBe('sonnet');
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Opus · GPT-5.6 Sol', 'Sonnet · GPT-5.6 Terra', 'Fable · unassigned', 'Haiku · GPT-5.6 Luna',
    ]);
  });

  it('offers an unavailable class as a DISABLED option — the verb refuses a null slot', () => {
    mount(MODELS());
    const sel = screen.getByRole('combobox', { name: /subagent class/i });
    const fable = [...sel.querySelectorAll('option')].find((o) => o.value === 'fable')!;
    expect(fable.hasAttribute('disabled')).toBe(true);
  });

  it('writes the class name and announces the model it resolves to', async () => {
    const c = mount(MODELS());
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: /subagent class/i }), { target: { value: 'haiku' } });
    });
    expect(c.spies.set).toHaveBeenCalledWith('gpt', { subagent: 'haiku' });
    expect(screen.getByRole('status').textContent).toContain('Subagents run Haiku-class (GPT-5.6 Luna)');
  });
});

describe('ModelsSection — Refresh', () => {
  it('runs the lane\'s probe and announces what came back', async () => {
    const refresh = vi.fn().mockResolvedValue(MODELS({ unclassified: ['gpt-6-astra', 'gpt-5.5'] }));
    const c = mount(MODELS(), false, client({ refresh }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /refresh/i })); });
    expect(c.spies.refresh).toHaveBeenCalledWith('gpt');
    expect(screen.getByRole('status').textContent).toMatch(/2 unclassified/);
    expect(screen.getByText('2 unclassified')).toBeInTheDocument();
  });

  it('says why it could not, and keeps showing the catalogue it already had (spec §11)', async () => {
    const refresh = vi.fn().mockRejectedValue(
      new ApiError(502, { error: 'verb-refused', detail: 'ccrc: chatgpt.com answered 401' }));
    mount(MODELS(), false, client({ refresh }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /refresh/i })); });
    expect(screen.getByRole('status').textContent).toContain('401');
    expect(screen.getByText('1 unclassified')).toBeInTheDocument();
  });

  it('has a live region mounted BEFORE anything happens in it', () => {
    // `CapsControl`'s rule: a `role="status"` inserted at the same moment its
    // text appears is announced unreliably, so the region exists from the first
    // render and only its contents change.
    mount(MODELS());
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `pwa/`: `npx vitest run test/models-section.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/fleet/ModelsSection"`.

- [ ] **Step 3: Write `pwa/src/fleet/ModelsSection.tsx`**

```tsx
// The Models section of an account card (spec §8) — one row per discovery-listed
// model, a class radio across each row, the lane's subagent choice, the badges,
// and a Refresh button.
//
// IT WRITES THROUGH THE ROUTES AND DERIVES NOTHING. Every state this renders
// (`unclassified`, `retired`, `available`) is computed on the server by
// `shared/models.ts`, which is the single definition `ccd`'s bash reader is
// measured against (spec §12). What this file computes is presentation order
// and one reverse lookup, both of which are about ROWS rather than about
// routing.
//
// THE RADIO IS PER ROW, and that is the whole shape of the control: a model
// carries at most one class, so the five choices across a row (four classes and
// "no class") are mutually exclusive by construction — which is what a radio
// group means, and why this is not four checkboxes. Assigning a class that
// another model holds MOVES it, and spec §8 requires the UI to say so before
// saving, so that case goes through a confirm.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountModels } from '../../../shared/api';
import { CLASSES, isModelClass, type ModelClass } from '../../../shared/models';
import { QuickConfirm } from '../components/QuickConfirm';
import { api, modelsErrorText } from '../lib/api';
// `CLASS_ORDER`/`CLASS_TITLE` are IMPORTED, not respelled: one reading order in
// three files is the drift `single-definition.test.ts` exists for.
import { ANTHROPIC_CLASS_NAMES, CLASS_ORDER, CLASS_TITLE } from '../lib/models';
import { formatAge } from './formatReset';
import './fleet.css';

/** The three calls this section makes, named as a type so a test can hand it
 *  spies without a module mock — `SessionScreen`'s `store` prop is the same
 *  arrangement. */
export interface ModelsClient {
  setAccountModels: typeof api.setAccountModels;
  refreshAccountModels: typeof api.refreshAccountModels;
  accountCatalogue: typeof api.accountCatalogue;
}

export interface ModelsSectionProps {
  wrapper: string;
  /** Whether ccd's least-loaded picker may land a session here — used for ONE
   *  thing (C-5): which read-only copy a lane with NO registry shows. It never
   *  decides routing or availability. */
  homeAble: boolean;
  models: AccountModels | null;
  /** Injectable for tests; defaults to the app-wide client. */
  client?: ModelsClient;
  /** Injectable for tests, so "stale since 1h" is a fact and not a clock race. */
  nowSec?: number;
}

/** Which class holds this model, or `null`. First class in `CLASSES` order
 *  whose id matches — the same reverse lookup `shared/models.ts`'s
 *  `classOfModel` performs for ROUTING, restated here over the WIRE shape
 *  because that function takes a `Registry` this component never sees.
 *  DELIBERATELY A DIFFERENT NAME: two functions answering one question over two
 *  shapes must not share an identifier, or a future import fixes itself against
 *  the wrong one. The two cannot disagree — both read the same four slots, and
 *  a slot holds at most one id. */
export function classHolding(models: AccountModels, id: string): ModelClass | null {
  for (const c of CLASSES) if (models.classes[c] === id) return c;
  return null;
}

/**
 * The models this section draws a row for, in render order: every CLASSED model
 * first (strongest class first, so the row an operator most often changes is at
 * the top), then everything discovery advertises and nobody has classed, then
 * anything retired that is not already above.
 *
 * DEDUPED, and that is not cosmetic: a RETIRED id that is still classed appears
 * in both `classes` and `retired` (spec §4.3 — a retired id empties nothing in
 * the registry), and two rows for one model would carry two radios claiming
 * different things about it.
 */
export function modelRows(models: AccountModels): string[] {
  const out: string[] = [];
  const push = (id: string): void => { if (!out.includes(id)) out.push(id); };
  for (const c of CLASS_ORDER) { const id = models.classes[c]; if (id !== null) push(id); }
  for (const id of models.unclassified) push(id);
  for (const id of models.retired) push(id);
  return out;
}

const labelOf = (models: AccountModels, id: string): string => models.labels[id] ?? id;

export function ModelsSection({
  wrapper, homeAble, models, client = api, nowSec = Math.floor(Date.now() / 1000),
}: ModelsSectionProps): ReactNode {
  /** What the last write or refresh said the box now holds. Preferred over the
   *  prop until the prop itself changes, because the poll that feeds the prop
   *  runs on its own 20 s clock and an edit must show immediately. */
  const [override, setOverride] = useState<AccountModels | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** A pending class move that needs the operator to see its consequence
   *  first — `{ id, cls }`, `null` while nothing is pending. */
  const [pending, setPending] = useState<{ id: string; cls: ModelClass } | null>(null);

  // The prop is the authority again the moment a fresh poll lands; keeping a
  // stale override would show an edit that a later CLI change has undone.
  useEffect(() => { setOverride(null); }, [models]);

  const shown = override ?? models;

  if (shown === null) {
    // NO REGISTRY FILE. Two different facts, one read-only section (C-6): a
    // home-able lane runs Claude Code's own aliases and there is nothing ccrc
    // could set; any other lane has simply not been seeded, which spec §13.1
    // says is valid — and `init` is the remedy, so it is named.
    return (
      <section className="models-section" aria-labelledby={`models-${wrapper}`}>
        <div className="models-head">
          <h3 className="auth-block-sub" id={`models-${wrapper}`}>Models</h3>
        </div>
        {homeAble ? (
          <>
            <p className="accounts-fresh">
              Claude Code chooses these itself on this account — ccrc sets no model here.
            </p>
            <ul className="models-readonly">
              {CLASS_ORDER.map((c) => (
                <li key={c}>
                  <span className="acct-win">{CLASS_TITLE[c]}</span>
                  <span className="models-name">{ANTHROPIC_CLASS_NAMES[c]}</span>
                  <span className="accounts-fresh">client default</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="accounts-fresh">
            {`No model-class registry on this lane yet, so every class reads as unavailable. `
             + `Seed it on the box: ccrc models ${wrapper} init <codex|openrouter|compatible>`}
          </p>
        )}
      </section>
    );
  }

  const send = async (
    body: Parameters<ModelsClient['setAccountModels']>[1], said: string,
  ): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      setOverride(await client.setAccountModels(wrapper, body));
      setNote(said);
    } catch (err) {
      // The box's own sentence, verbatim (spec §9). Nothing is re-rendered as
      // if it worked: `override` is untouched, so the radios snap back to what
      // the last known state says.
      setNote(modelsErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Apply a row's class change. `cls === null` is "no class". */
  const move = (id: string, cls: ModelClass | null): void => {
    const from = classHolding(shown, id);
    if (from === cls) return;
    const classes: Record<string, string | null> = {};
    if (from !== null) classes[from] = null;
    if (cls !== null) classes[cls] = id;
    const said = cls === null
      ? `${labelOf(shown, id)} has no class now.`
      : `${labelOf(shown, id)} is now ${CLASS_TITLE[cls]}-class.`;
    void send({ classes }, said);
  };

  const onPick = (id: string, cls: ModelClass | null): void => {
    // Spec §8: assigning a class to a model clears it from the model that had
    // it, and the UI says so BEFORE saving. Only that case confirms — a move
    // that displaces nobody is one tap, as it should be.
    const holder = cls === null ? null : shown.classes[cls];
    if (cls !== null && holder !== null && holder !== id) { setPending({ id, cls }); return; }
    move(id, cls);
  };

  const refresh = (): void => {
    setBusy(true);
    setNote('');
    void (async () => {
      try {
        const next = await client.refreshAccountModels(wrapper);
        setOverride(next);
        setNote(next.catalogue === null
          ? 'Probed, and this lane advertises no catalogue.'
          : `Probed: ${next.catalogue.count} models, ${next.unclassified.length} unclassified.`);
      } catch (err) {
        // Spec §11: a failed probe keeps the previous catalogue, so the section
        // goes on showing what it had. The note is the only thing that changes.
        setNote(modelsErrorText(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  const badges: string[] = [];
  if (shown.catalogue === null) badges.push('never probed');
  else if (shown.catalogue.stale) badges.push(`stale since ${formatAge(nowSec - shown.catalogue.fetchedAt)}`);
  if (shown.unclassified.length > 0) badges.push(`${shown.unclassified.length} unclassified`);
  for (const id of shown.retired) badges.push(`retired: ${labelOf(shown, id)}`);

  const pendingHolder = pending === null ? null : shown.classes[pending.cls];

  return (
    <section className="models-section" aria-labelledby={`models-${wrapper}`}>
      <div className="models-head">
        <h3 className="auth-block-sub" id={`models-${wrapper}`}>Models</h3>
        <button type="button" className="models-refresh" disabled={busy} onClick={refresh}>
          {busy ? 'Working…' : 'Refresh'}
        </button>
      </div>

      {badges.length > 0 && (
        <ul className="models-badges">
          {badges.map((b) => <li key={b} className="models-badge">{b}</li>)}
        </ul>
      )}

      <ul className="models-rows">
        {modelRows(shown).map((id) => {
          const held = classHolding(shown, id);
          return (
            <li key={id} className="models-row">
              <span className="models-name">{labelOf(shown, id)}</span>
              {/* `role="group"` with an accessible name comes free from
                  fieldset+legend, and the legend is what a screen reader reads
                  before the five choices — "Class for GPT-6-Astra", then Opus,
                  Sonnet, Fable, Haiku, No class. */}
              <fieldset className="models-classes">
                <legend className="sr-only">{`Class for ${labelOf(shown, id)}`}</legend>
                {CLASS_ORDER.map((c) => (
                  <label key={c} className="models-class">
                    <input
                      type="radio" name={`class-${wrapper}-${id}`} value={c}
                      checked={held === c} disabled={busy}
                      onChange={() => onPick(id, c)}
                    />
                    <span>{CLASS_TITLE[c]}</span>
                  </label>
                ))}
                <label className="models-class">
                  <input
                    type="radio" name={`class-${wrapper}-${id}`} value=""
                    checked={held === null} disabled={busy}
                    onChange={() => onPick(id, null)}
                  />
                  {/* "No class" and not an em dash: the dash is the printed
                      form, and a screen reader would announce it as nothing at
                      all. `aria-hidden` on the glyph, the words on the input. */}
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">No class</span>
                </label>
              </fieldset>
            </li>
          );
        })}
      </ul>

      {/* The lane's subagent class (spec §4.1). A LANE control, not a row one:
          it names a CLASS, and `CLAUDE_CODE_SUBAGENT_MODEL` resolves through
          `classes[subagent]` (spec §6.1). Each option shows the model the class
          currently resolves to, because "subagents run Sonnet-class" is a
          promise about a concrete model and the operator is entitled to see
          which. A class whose slot is null is DISABLED rather than hidden: the
          verb refuses it (spec §4.1), and a chooser that silently omitted a
          class would look like the class does not exist. */}
      <div className="models-subagent">
        <label className="models-subagent-label" htmlFor={`subagent-${wrapper}`}>Subagent class</label>
        <select
          id={`subagent-${wrapper}`} className="models-effort-select" disabled={busy}
          value={shown.subagent}
          onChange={(e) => {
            const cls = e.target.value;
            if (!isModelClass(cls)) return;
            const id = shown.classes[cls];
            void send({ subagent: cls },
              `Subagents run ${CLASS_TITLE[cls]}-class (${id === null ? 'unassigned' : labelOf(shown, id)}).`);
          }}
        >
          {CLASS_ORDER.map((c) => {
            const id = shown.classes[c];
            return (
              <option key={c} value={c} disabled={id === null}>
                {`${CLASS_TITLE[c]} · ${id === null ? 'unassigned' : labelOf(shown, id)}`}
              </option>
            );
          })}
        </select>
      </div>

      {/* ONE note element, ALWAYS MOUNTED, and it is the live region — a
          `role="status"` inserted at the same moment its text appears is
          announced unreliably (`CapsControl` measured this). This is the whole
          of the section's feedback: a successful class move re-renders radios,
          which says nothing out loud. */}
      <p className="models-note" role="status">{note}</p>

      <QuickConfirm
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending === null ? '' : `Move ${CLASS_TITLE[pending.cls]}-class?`}
        consequence={pending === null || pendingHolder === null ? '' :
          `${labelOf(shown, pendingHolder)} stops being ${CLASS_TITLE[pending.cls]}-class and `
          + `${labelOf(shown, pending.id)} takes it. Sessions already running keep the model they `
          + 'have until they next start.'}
        confirmLabel="Move"
        onConfirm={() => { if (pending !== null) move(pending.id, pending.cls); }}
      />
    </section>
  );
}
```

- [ ] **Step 4: Add the stylesheet rules**

Append to `pwa/src/fleet/fleet.css`:

```css
/* ── the Models section of an account card (spec §8) ─────────────────────── */
.models-section { display: grid; gap: var(--sp-2); margin-top: var(--sp-3); }
.models-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
/* The one control in the header. `--tap-min` and not a smaller "secondary"
   height: a 44px floor is the spec acceptance criterion and applies to every
   control, not only to primary ones. */
.models-refresh {
  min-height: var(--tap-min);
  padding: 0 var(--sp-3);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  color: var(--ink-primary);
  font: var(--text-sm) / 1 var(--font-ui);
}
.models-refresh:disabled { color: var(--ink-disabled); }
.models-badges { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin: 0; padding: 0; list-style: none; }
.models-badge {
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--ink-secondary);
  font: var(--text-xs) / 1.6 var(--font-mono);
}
.models-rows, .models-readonly { display: grid; gap: var(--sp-1); margin: 0; padding: 0; list-style: none; }
.models-row, .models-readonly li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
.models-name { color: var(--ink-primary); font: var(--text-sm) / 1.4 var(--font-mono); }
.models-classes { display: flex; gap: var(--sp-1); border: 0; margin: 0; padding: 0; }
.models-class {
  display: flex; align-items: center; gap: 4px;
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  color: var(--ink-secondary);
  font: var(--text-xs) / 1 var(--font-ui);
}
.models-subagent { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.models-subagent-label { color: var(--ink-secondary); font: var(--text-xs) / 1.6 var(--font-ui); }
.models-effort-select {
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  color: var(--ink-primary);
  font: var(--text-sm) / 1 var(--font-ui);
}
/* `:empty` takes the note OUT OF FLOW rather than merely to zero height — a
   zero-height flex item still forms a line and still pays the container's row
   gap — and deliberately not `display: none`, which would take the live region
   back out of the accessibility tree and undo the point. */
.models-note { margin: 0; color: var(--ink-secondary); font: var(--text-xs) / 1.6 var(--font-ui); }
.models-note:empty { position: absolute; height: 0; }
```

- [ ] **Step 5: Render it in the account card**

In `pwa/src/screens/AccountsScreen.tsx`, inside each `<section key={wrapper} className="accounts-row">`, after the existing per-account block:

```tsx
              {/* Spec §8 puts this in the account card, below health. A lane
                  with no registry renders its read-only arm rather than
                  nothing, because "this lane has no registry" is a fact an
                  operator looking for the Models section needs told. */}
              <ModelsSection
                wrapper={wrapper}
                homeAble={accountHomeAble(roster, wrapper)}
                models={accountModelsOf(roster, wrapper)}
                nowSec={nowSec}
              />
```

with `import { ModelsSection } from '../fleet/ModelsSection';` and `accountHomeAble, accountModelsOf` added to the existing `../lib/accounts` import.

- [ ] **Step 6: Run the tests**

Run from `pwa/`: `npx vitest run test/models-section.test.tsx`
Expected: PASS, 18 tests.

Run from `pwa/`: `npx vitest run test/accounts-screen.test.tsx test/contrast.test.ts test/tap-targets.test.tsx test/fleet-css.test.ts test/polish.test.tsx`
Expected: PASS. If the contrast gate refuses `.models-badge`, `.models-class` or `.models-subagent-label`, register the token pair in `pwa/design/audit.mjs` beside the existing `.accounts-fresh` pair rather than changing a token value.

- [ ] **Step 7: Add the tap-target scrape**

In `pwa/test/tap-targets.test.tsx`, add to the CSS-scrape describe:

```ts
  it('.models-refresh, .models-class and .models-effort-select carry the shared tap token, not a literal', () => {
    // Both halves, per this file's own header: the SCRAPE proves the rule is
    // written against `--tap-min` (so it follows the token), and the render
    // below proves an element still carries the class — a rule with no matching
    // element silently stops applying.
    expect(declValue(ruleIn(fleetCss, '.models-refresh'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.models-class'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.models-effort-select'), 'min-height')).toBe('var(--tap-min)');
  });
```

and, in that file's render describe, one mount of `ModelsSection` with `models-section.test.tsx`'s `MODELS()` fixture, asserting `document.querySelector('.models-refresh')`, `.models-class` and `.models-effort-select` are present.

- [ ] **Step 8: Measured mutation #1 — the confirm before an eviction**

Edit `pwa/src/fleet/ModelsSection.tsx` and change `onPick`'s guard to `if (false) { setPending({ id, cls }); return; }`.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "SAYS SO BEFORE SAVING"`
Expected: FAIL — `expected "spy" not to be called at all, but it was called with 'gpt', { classes: { opus: 'gpt-6-astra' } }`.
Restore. Re-run: PASS.

- [ ] **Step 9: Measured mutation #2 — the clear travels with the set**

Edit `pwa/src/fleet/ModelsSection.tsx` and delete `if (from !== null) classes[from] = null;` from `move`.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "a row LEAVING a class"`
Expected: FAIL — `expected 'gpt', { classes: { fable: 'gpt-5.6-sol' } } to equal 'gpt', { classes: { opus: null, fable: 'gpt-5.6-sol' } }`: the model would hold two classes.
Restore. Re-run: PASS.

- [ ] **Step 10: Measured mutation #3 — a refusal does not re-render as success**

Edit `pwa/src/fleet/ModelsSection.tsx` and, in `send`'s `catch`, add `setOverride({ ...shown, classes: { ...shown.classes, ...(body.classes as never) } });` before `setNote`.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "own sentence"`
Expected: FAIL — the `No class` radio for GPT-6-Astra is no longer checked (`expected element to be checked`), because a refused edit was rendered as if it had landed.
Restore. Re-run: PASS.

- [ ] **Step 11: Measured mutation #4 — dedup in `modelRows`**

Edit `pwa/src/fleet/ModelsSection.tsx` and change `push` to `out.push(id)` unconditionally.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "STILL CLASSED"`
Expected: FAIL — `expected 2 to be 1`.
Restore. Re-run: PASS.

- [ ] **Step 12: Measured mutation #5 — a null slot cannot be chosen as the subagent class**

Edit `pwa/src/fleet/ModelsSection.tsx` and drop `disabled={id === null}` from the subagent `<option>`.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "DISABLED option"`
Expected: FAIL — `expected false to be true`: the chooser would offer Fable-class on a lane whose fable slot is null, and the verb would refuse the write (spec §4.1).
Restore. Re-run: PASS.

- [ ] **Step 13: Typecheck and commit**

Run from `<repo>`: `npx tsc -p pwa --noEmit` — no output.

```bash
git add pwa/src/fleet/ModelsSection.tsx pwa/src/fleet/fleet.css pwa/src/screens/AccountsScreen.tsx pwa/test/models-section.test.tsx pwa/test/tap-targets.test.tsx
git commit -m "feat(pwa): an account card can classify its lane's models and pick its subagent class, and says what a move displaces before it saves

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: the Models section — each row's context and price, per-class effort, and the discovery Add

Spec §8's first bullet in full — "label, context window, price when known, and a class control" — plus its Effort bullet, its Add-model clause, and §15.5 (OpenRouter's discovery list is explicit, and the whitelist check runs at add time). Task 9 drew the label and the class control; this task adds the readings that need the catalogue.

**Files:**
- Modify: `pwa/src/fleet/ModelsSection.tsx`
- Modify: `pwa/src/fleet/fleet.css`
- Modify: `pwa/test/models-section.test.tsx` (two new describes)
- Idiom copied from: `pwa/src/fleet/CapsControl.tsx:159-172` (a labelled field beside its readout, and the `htmlFor`/`id` pair that gives it an accessible name); `pwa/src/lib/api.ts:417-420` (`encodeURIComponent` on anything that becomes a path or a query value); `pwa/src/fleet/useProjectedHome.ts:96-110` (the `live` flag that stops a resolved fetch writing state after unmount)

**Interfaces:**
- Consumes: Task 6's `GET …/models/catalogue` through Task 7's `api.accountCatalogue`; Task 9's `ModelsSection` internals.
- Produces: no new exports — each row gains its context and price, a classed row gains an effort `<select>`, and a lane whose discovery list is an explicit array gains an Add-model search.

- [ ] **Step 1: Write the failing tests**

Append to `pwa/test/models-section.test.tsx`:

```tsx
describe('ModelsSection — per-class effort (spec §8, §6.4)', () => {
  const EFFORTS: Record<string, string[]> = {
    'gpt-5.6-sol': ['high', 'xhigh', 'max'],
    'gpt-5.6-terra': ['low', 'medium', 'high'],
    'gpt-5.6-luna': ['low', 'medium', 'high'],
  };

  /** The catalogue route, answering one exact-id query at a time — which is how
   *  this section asks: at most a handful of rows, against a catalogue that can
   *  be several hundred entries on OpenRouter. */
  const cataloguing = () => vi.fn().mockImplementation(async (_id: string, opts: { q?: string }) => ({
    items: opts?.q !== undefined && EFFORTS[opts.q] !== undefined
      ? [{ id: opts.q, label: opts.q, context: 272000, maxContext: 272000,
           efforts: EFFORTS[opts.q], hidden: false, priceIn: null, priceOut: null }]
      : [],
    next: null,
  }));

  const settle = async (): Promise<void> => {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  };

  it('offers each classed model its own levels, from the catalogue, plus the lane default', async () => {
    const c = client({ catalogue: cataloguing() });
    render(<ModelsSection wrapper="gpt" homeAble={false} models={MODELS()}
                          client={c.client as never} nowSec={1789003600} />);
    await settle();
    // ONE QUERY PER ROW and no more — never a bare listing, which on OpenRouter
    // is several hundred entries for a section that draws a handful of rows.
    expect(c.spies.catalogue.mock.calls.map((call) => (call[1] as { q: string }).q).sort())
      .toEqual(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra']);
    const sol = screen.getByRole('combobox', { name: 'Effort for GPT-5.6 Sol' });
    expect([...sol.querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['lane default', 'high', 'xhigh', 'max']);
    // The registry already says opus runs at max.
    expect((sol as HTMLSelectElement).value).toBe('max');
  });

  it('shows each row its context window and its price when the catalogue knows them', async () => {
    // Spec §8's first bullet: "label, context window, price when known". The
    // label is on the wire (`AccountModels.labels`); these two are not, because
    // the wire carries the ROUTING state and this is shopping information — so
    // they come from the same per-row catalogue query the effort control makes.
    const priced = vi.fn().mockImplementation(async (_id: string, opts: { q?: string }) => ({
      items: opts?.q === 'gpt-5.6-sol'
        ? [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', context: 272000, maxContext: 272000,
             efforts: ['max'], hidden: false, priceIn: 1.25, priceOut: 10 }]
        : [],
      next: null,
    }));
    const c = client({ catalogue: priced });
    render(<ModelsSection wrapper="gpt" homeAble={false} models={MODELS()}
                          client={c.client as never} nowSec={1789003600} />);
    await settle();
    const row = screen.getByRole('group', { name: 'Class for GPT-5.6 Sol' }).closest('li')!;
    expect(row.textContent).toContain('272k');
    expect(row.textContent).toContain('$1.25');
    // A row the catalogue said nothing about shows NO numbers rather than
    // zeroes: "we were not told" and "it is free" are different facts.
    const astra = screen.getByRole('group', { name: 'Class for GPT-6-Astra' }).closest('li')!;
    expect(astra.textContent).not.toMatch(/\$|\dk\b/);
  });

  it('offers no effort control for an unclassified model — there is no class to write it to', async () => {
    const c = client({ catalogue: cataloguing() });
    render(<ModelsSection wrapper="gpt" homeAble={false} models={MODELS()}
                          client={c.client as never} nowSec={1789003600} />);
    await settle();
    expect(screen.queryByRole('combobox', { name: 'Effort for GPT-6-Astra' })).not.toBeInTheDocument();
  });

  it('writes effort[class], never effort[model], and announces it', async () => {
    const c = client({ catalogue: cataloguing() });
    render(<ModelsSection wrapper="gpt" homeAble={false} models={MODELS()}
                          client={c.client as never} nowSec={1789003600} />);
    await settle();
    const sol = screen.getByRole('combobox', { name: 'Effort for GPT-5.6 Sol' });
    await act(async () => { fireEvent.change(sol, { target: { value: 'xhigh' } }); });
    expect(c.spies.set).toHaveBeenCalledWith('gpt', { effort: { opus: 'xhigh' } });
    expect(screen.getByRole('status').textContent).toContain('Opus-class runs at xhigh');
  });

  it('clears back to the provider default with null, not with an empty string', async () => {
    const c = client({ catalogue: cataloguing() });
    render(<ModelsSection wrapper="gpt" homeAble={false} models={MODELS()}
                          client={c.client as never} nowSec={1789003600} />);
    await settle();
    const sol = screen.getByRole('combobox', { name: 'Effort for GPT-5.6 Sol' });
    await act(async () => { fireEvent.change(sol, { target: { value: '' } }); });
    expect(c.spies.set).toHaveBeenCalledWith('gpt', { effort: { opus: null } });
  });

  it('renders no effort control at all when the catalogue could not say what the levels are', async () => {
    // Never probed, or a probe that failed: a select populated with a guessed
    // list would offer levels the provider refuses, and the refusal would arrive
    // as an opaque error on the next turn rather than here.
    const c = client({ catalogue: vi.fn().mockResolvedValue({ items: [], next: null }) });
    render(<ModelsSection wrapper="gpt" homeAble={false} models={MODELS({ catalogue: null })}
                          client={c.client as never} nowSec={1789003600} />);
    await settle();
    // The SUBAGENT chooser is also a combobox and is always there, so this asks
    // for the effort ones by name.
    expect(screen.queryByRole('combobox', { name: /^Effort for/ })).not.toBeInTheDocument();
  });
});

describe('ModelsSection — Add model, for a lane whose discovery list is explicit', () => {
  const OR = (over: Partial<AccountModels> = {}): AccountModels => MODELS({
    probe: 'openrouter',
    classes: { haiku: null, sonnet: null, opus: null, fable: null },
    discovery: ['anthropic/claude-opus-4.5:beta'],
    effort: {}, unclassified: ['anthropic/claude-opus-4.5:beta'], available: [],
    labels: { 'anthropic/claude-opus-4.5:beta': 'Claude Opus 4.5 (beta)' },
    ...over,
  });

  const typeAndSettle = async (value: string): Promise<void> => {
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox', { name: /add a model/i }), { target: { value } });
      await new Promise((r) => setTimeout(r, 400));
    });
  };

  it('shows no Add control on a lane that already takes the whole catalogue', () => {
    // `discovery: "catalogue"` means every visible model is already in scope
    // (spec §4.1), so there is nothing an Add could do.
    mount(MODELS());
    expect(screen.queryByRole('searchbox', { name: /add a model/i })).not.toBeInTheDocument();
  });

  it('searches the catalogue route as you type, and lists what came back', async () => {
    const catalogue = vi.fn().mockResolvedValue({
      items: [{ id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', context: 200000,
                maxContext: 200000, efforts: [], hidden: false, priceIn: 3, priceOut: 15 }],
      next: null,
    });
    const c = client({ catalogue });
    render(<ModelsSection wrapper="or" homeAble={false} models={OR()}
                          client={c.client as never} nowSec={1789003600} />);
    await typeAndSettle('sonnet');
    expect(c.spies.catalogue).toHaveBeenCalledWith('or', { q: 'sonnet', limit: 25 });
    const row = screen.getByRole('button', { name: /Add Claude Sonnet 5/ });
    expect(row.textContent).toContain('200k');
    expect(row.textContent).toContain('$3');
  });

  it('adding sends the WHOLE list — the route diffs it — and announces the addition', async () => {
    const catalogue = vi.fn().mockResolvedValue({
      items: [{ id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', context: 200000,
                maxContext: 200000, efforts: [], hidden: false, priceIn: null, priceOut: null }],
      next: null,
    });
    const c = client({ catalogue });
    render(<ModelsSection wrapper="or" homeAble={false} models={OR()}
                          client={c.client as never} nowSec={1789003600} />);
    await typeAndSettle('sonnet');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add Claude Sonnet 5/ })); });
    expect(c.spies.set).toHaveBeenCalledWith('or', {
      discovery: ['anthropic/claude-opus-4.5:beta', 'anthropic/claude-sonnet-5'],
    });
    expect(screen.getByRole('status').textContent).toContain('Claude Sonnet 5 added');
  });

  it('a whitelist refusal is shown as the box wrote it (spec §5, §11)', async () => {
    const catalogue = vi.fn().mockResolvedValue({
      items: [{ id: 'x/y', label: 'X Y', context: null, maxContext: null, efforts: [],
                hidden: false, priceIn: null, priceOut: null }],
      next: null,
    });
    const set = vi.fn().mockRejectedValue(
      new ApiError(502, { error: 'verb-refused', detail: 'ccrc: no whitelisted provider serves x/y' }));
    const c = client({ catalogue, set });
    render(<ModelsSection wrapper="or" homeAble={false} models={OR()}
                          client={c.client as never} nowSec={1789003600} />);
    await typeAndSettle('x');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add X Y/ })); });
    expect(screen.getByRole('status').textContent).toBe('ccrc: no whitelisted provider serves x/y');
    expect(c.spies.set).toHaveBeenCalledTimes(1);
  });

  it('does not search on an empty box, so clearing it costs no request', async () => {
    const c = client();
    render(<ModelsSection wrapper="or" homeAble={false} models={OR({ classes: { haiku: null, sonnet: null, opus: null, fable: null }, unclassified: [] })}
                          client={c.client as never} nowSec={1789003600} />);
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox', { name: /add a model/i }), { target: { value: 'a' } });
      fireEvent.change(screen.getByRole('searchbox', { name: /add a model/i }), { target: { value: '' } });
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(c.spies.catalogue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run from `pwa/`: `npx vitest run test/models-section.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "combobox" and name /^Effort for/`, and the same for `"searchbox"`.

- [ ] **Step 3: Add the per-row catalogue lookup and the effort control**

In `pwa/src/fleet/ModelsSection.tsx`, add state and the lookup above the early return:

```tsx
  /** `modelId -> the catalogue's own row for it`. Loaded lazily, ONE QUERY PER
   *  ROW, and it supplies two different things: the context window and price a
   *  row displays (spec §8's first bullet) and the effort levels a classed
   *  row's select offers.
   *
   *  ONE QUERY PER MODEL rather than one listing, and the reason is the
   *  catalogue's own size: Codex advertises nine, OpenRouter several hundred
   *  (spec §2), while this section draws the discovery list. `q` is an exact id
   *  and the answer is filtered to an exact match, so a substring hit on a
   *  longer id cannot supply the wrong row.
   *
   *  ABSENT MEANS "we could not be told": the row shows no numbers (never
   *  zeroes — "we were not told" and "it is free" are different facts) and the
   *  effort control is not rendered at all, because a select populated with a
   *  guessed list would offer levels the provider refuses, and that refusal
   *  would surface as an opaque error on the session's next turn instead of
   *  here. */
  const [catRows, setCatRows] = useState<Record<string, CatalogueModelWire>>({});

  /** A STRING key, not the array: `useEffect`'s dependency comparison is by
   *  reference and the row list is a fresh array on every render, so a raw
   *  dependency would re-fetch the catalogue on every keystroke in the search
   *  box below. */
  const rowKey = shown === null ? '' : modelRows(shown).join(' ');

  useEffect(() => {
    if (rowKey === '') return undefined;
    let live = true;
    void (async () => {
      const found: Record<string, CatalogueModelWire> = {};
      for (const id of rowKey.split(' ')) {
        try {
          const page = await client.accountCatalogue(wrapper, { q: id, limit: 5 });
          const exact = page.items.find((m) => m.id === id);
          if (exact !== undefined) found[id] = exact;
        } catch {
          // Silent: the numbers and the effort control simply do not appear. A
          // section that shouted about a catalogue read would be shouting on
          // every lane that has never been probed, which is the ordinary first
          // state of one.
        }
      }
      if (live) setCatRows(found);
    })();
    return () => { live = false; };
  }, [wrapper, rowKey, client]);
```

and inside the row `<li>`, immediately after `<span className="models-name">` and before the `<fieldset>`:

```tsx
              {/* Spec §8's "context window, price when known". Each half is
                  omitted independently: a provider that publishes a context and
                  no price gets one number, not a zero. */}
              {catRows[id] !== undefined && (
                <span className="accounts-fresh">
                  {[
                    catRows[id]!.context === null ? null : `${Math.round(catRows[id]!.context! / 1000)}k`,
                    catRows[id]!.priceIn === null ? null : `$${catRows[id]!.priceIn}/M in`,
                    catRows[id]!.priceOut === null ? null : `$${catRows[id]!.priceOut}/M out`,
                  ].filter((x): x is string => x !== null).join(' - ')}
                </span>
              )}
```

and after the `</fieldset>`:

```tsx
              {held !== null && (catRows[id]?.efforts.length ?? 0) > 0 && (
                <span className="models-effort">
                  <label className="sr-only" htmlFor={`effort-${wrapper}-${id}`}>
                    {`Effort for ${labelOf(shown, id)}`}
                  </label>
                  <select
                    id={`effort-${wrapper}-${id}`}
                    className="models-effort-select"
                    disabled={busy}
                    value={shown.effort[held] ?? ''}
                    onChange={(e) => {
                      const level = e.target.value === '' ? null : e.target.value;
                      // `effort[CLASS]`, never `effort[model]` — spec §4.1: the
                      // registry keys effort by class, so re-classing a model
                      // carries its lane default with the class rather than
                      // stranding it on an id nothing routes to.
                      void send({ effort: { [held]: level } }, level === null
                        ? `${CLASS_TITLE[held]}-class runs at the provider's default.`
                        : `${CLASS_TITLE[held]}-class runs at ${level}.`);
                    }}
                  >
                    {/* The empty value is the CLEAR, spelled as words rather
                        than as a blank row: "no lane default" is a real choice
                        with a real effect (spec §6.4 — the provider's own
                        default applies), not the absence of one. */}
                    <option value="">lane default</option>
                    {(catRows[id]?.efforts ?? []).map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                  </select>
                </span>
              )}
```

with `CatalogueModelWire` added to the file's `shared/api` type import.

- [ ] **Step 4: Add the discovery Add search**

Add state beside `catRows`:

```tsx
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CatalogueModelWire[]>([]);
```

and the debounced effect:

```tsx
  // 250 ms, and NO request at all for an empty box: clearing a search is the
  // commonest keystroke in it, and a bare listing of an OpenRouter catalogue is
  // the most expensive answer this route gives.
  useEffect(() => {
    const q = query.trim();
    if (q === '') { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      void client.accountCatalogue(wrapper, { q, limit: 25 })
        .then((page) => { if (live) setFound(page.items); })
        .catch(() => { if (live) setFound([]); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [wrapper, query, client]);
```

and, after the rows list and before the subagent chooser, the control:

```tsx
      {/* Spec §8 names this for `openrouter`; the CONDITION is the discovery
          list's own shape rather than the probe name, and that is not a
          widening. `discovery: "catalogue"` means every visible model is already
          in scope (spec §4.1), so there is nothing an Add could do on such a
          lane, while any lane with an explicit list — which openrouter is
          REQUIRED to have — has exactly this need. Deriving the condition from
          the data keeps a fourth probe kind from needing a line here. */}
      {Array.isArray(shown.discovery) && (
        <div className="models-add">
          <label className="sr-only" htmlFor={`models-add-${wrapper}`}>Add a model to this lane</label>
          <input
            id={`models-add-${wrapper}`} className="models-add-input" type="search"
            placeholder="Add a model" value={query} disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
          />
          {found.length > 0 && (
            <ul className="models-found">
              {found.map((m) => (
                <li key={m.id}>
                  <button
                    type="button" className="models-add-row" disabled={busy}
                    onClick={() => {
                      // The WHOLE list, and the route diffs it (C-3): the verb
                      // has add/rm/catalogue and no whole-list setter, and the
                      // diff belongs on the side that just read the current
                      // list rather than in a browser holding a 20 s-old copy.
                      const next = [...(shown.discovery as readonly string[]), m.id];
                      void send({ discovery: next }, `${m.label} added to this lane's discovery list.`);
                    }}
                  >
                    {`Add ${m.label}`}
                    <span className="accounts-fresh">
                      {[
                        m.hidden ? 'hidden' : null,
                        m.context === null ? null : `${Math.round(m.context / 1000)}k`,
                        m.priceIn === null ? null : `$${m.priceIn}/M in`,
                        m.priceOut === null ? null : `$${m.priceOut}/M out`,
                      ].filter((s): s is string => s !== null).join(' - ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
```

- [ ] **Step 5: Add the stylesheet rules**

Append to `pwa/src/fleet/fleet.css`:

```css
.models-add-input {
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  color: var(--ink-primary);
  font: var(--text-sm) / 1 var(--font-ui);
}
.models-add { display: grid; gap: var(--sp-1); }
.models-found { display: grid; gap: var(--sp-1); margin: 0; padding: 0; list-style: none; }
.models-add-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2);
  width: 100%;
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  color: var(--ink-primary);
  font: var(--text-sm) / 1.4 var(--font-ui);
  text-align: left;
}
```

- [ ] **Step 6: Run the tests**

Run from `pwa/`: `npx vitest run test/models-section.test.tsx`
Expected: PASS, 29 tests.

Run from `pwa/`: `npx vitest run test/contrast.test.ts test/tap-targets.test.tsx test/fleet-css.test.ts`
Expected: PASS. If the contrast gate refuses one of the new rules, register the token pair in `pwa/design/audit.mjs` beside the existing `.acct-row` pair rather than changing a token value.

- [ ] **Step 7: Measured mutation #1 — effort is keyed by class**

Edit `pwa/src/fleet/ModelsSection.tsx` and change the select's `send` body to `{ effort: { [id]: level } }`.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "writes effort"`
Expected: FAIL — `expected "spy" to have been called with [ 'gpt', { effort: { opus: 'xhigh' } } ] but got [ 'gpt', { effort: { 'gpt-5.6-sol': 'xhigh' } } ]`.
Restore. Re-run: PASS.

- [ ] **Step 8: Measured mutation #2 — no control without measured levels**

Edit `pwa/src/fleet/ModelsSection.tsx` and change the effort render guard to `held !== null &&` alone, with `{(catRows[id]?.efforts ?? ['low', 'medium', 'high']).map(...)}` supplying the options.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "could not say what the levels are"`
Expected: FAIL — `expected null not to be null` on the `queryByRole('combobox', { name: /^Effort for/ })` assertion: the section offers three guessed levels for a lane nobody has probed.
Restore. Re-run: PASS.

- [ ] **Step 9: Measured mutation #3 — the empty-box short circuit**

Edit `pwa/src/fleet/ModelsSection.tsx` and delete the `if (q === '')` early return.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "does not search on an empty box"`
Expected: FAIL — `expected "spy" not to be called at all, but it was called with [ 'or', { q: '', limit: 25 } ]`.
Restore. Re-run: PASS.

- [ ] **Step 10: Measured mutation #4 — Add only on an explicit discovery list**

Edit `pwa/src/fleet/ModelsSection.tsx` and change the Add block's condition to `true`.
Run from `pwa/`: `npx vitest run test/models-section.test.tsx -t "already takes the whole catalogue"`
Expected: FAIL — `expected null not to be null`: a lane that already carries every visible model would offer an Add that can add nothing.
Restore. Re-run: PASS.

- [ ] **Step 11: Typecheck and commit**

Run from `<repo>`: `npx tsc -p pwa --noEmit` — no output.

```bash
git add pwa/src/fleet/ModelsSection.tsx pwa/src/fleet/fleet.css pwa/test/models-section.test.tsx
git commit -m "feat(pwa): a lane default per class, and an explicit-discovery lane can search its catalogue for one more model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: the hardcoded table is deleted, and stays deleted

Spec §13.4: "`pwa/src/lib/models.ts`'s table is deleted, not kept as a fallback." Task 8 removed it; this task is the mechanism that stops it coming back, plus the last sweep for stragglers.

**Files:**
- Create: `pwa/test/model-table-deleted.test.ts`
- Modify: `pwa/src/lib/models.ts` (only if the sweep finds something)
- Idiom copied from: `server/test/single-definition.test.ts:1-17` (the header's own honest limit — "these scan TEXT, deliberately… the bar is 'a reasonable person adding a fourth copy in the ordinary way is stopped before review', not 'unforgeable'") and `:40-57` (`sources()`, the recursive `.ts`/`.tsx` walk that skips `__`-prefixed transient mutants)

**Interfaces:**
- Consumes: Task 8's `ANTHROPIC_CLASS_NAMES`.
- Produces: `pwa/test/model-table-deleted.test.ts` — no source exports.

- [ ] **Step 1: Write the failing scan**

Create `pwa/test/model-table-deleted.test.ts`:

```ts
// Spec §13.4: the wrapper-keyed model table is DELETED, not kept as a fallback.
//
// It was three concrete model names in a browser bundle, keyed on the string
// `'gpt'`, with no Fable row at all — and it went stale exactly as predicted:
// the Codex catalogue moved (spec §1) and this list did not, so the picker
// offered Sol/Terra/Luna while the provider advertised nine models including
// one this fleet had no way to reach. A comment asking the next reader not to
// re-add it is a request; this file is a mechanism.
//
// IT SCANS TEXT, and that limit is stated rather than implied
// (`server/test/single-definition.test.ts`'s own header makes the same
// admission): a determined author can defeat it by building the strings
// character by character. The bar is that a reasonable person re-adding a model
// name in the ordinary way is stopped before review.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ANTHROPIC_CLASS_NAMES } from '../src/lib/models';

const PWA_SRC = path.join(import.meta.dirname, '..', 'src');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('__')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const ALL = sources(PWA_SRC);
const rel = (p: string): string => path.relative(path.join(PWA_SRC, '..', '..'), p);

/** Model-id shapes this tree must not spell in the browser: a Codex slug, an
 *  OpenRouter `author/slug`, and the Anthropic API ids. Deliberately NOT a
 *  general "looks like a model id" regex — that would fire on every ordinary
 *  hyphenated word. These are the families the fleet actually runs. */
const CONCRETE_ID = [
  /\bgpt-\d/i,
  /\bclaude-(opus|sonnet|haiku|fable)-\d/i,
  /\banthropic\/claude-/i,
];

describe('the wrapper-keyed model table is gone (spec §13.4)', () => {
  it('found the source tree it is scanning', () => {
    // A scan over an empty list passes everything — `single-definition.test.ts`
    // states the discipline outright and this is its positive control.
    expect(ALL.length).toBeGreaterThan(40);
    expect(ALL.map(rel)).toContain('pwa/src/lib/models.ts');
  });

  it('names no concrete provider model id anywhere under pwa/src', () => {
    const hits: string[] = [];
    for (const p of ALL) {
      const src = readFileSync(p, 'utf8');
      for (const re of CONCRETE_ID) {
        if (re.test(src)) hits.push(`${rel(p)} matches ${re}`);
      }
    }
    expect(hits, 'a concrete model id in the browser bundle is exactly the table spec §13.4 deleted; '
      + 'the lane\'s registry arrives on GET /api/accounts and the picker reads it')
      .toEqual([]);
  });

  it('branches on no wrapper NAME to decide what models a lane has', () => {
    // `'gpt'` was the key of the deleted table and of `effortOptions`' Ultracode
    // arm. Both now read the lane's registry instead. The string may still
    // appear in a TEST fixture (it is a real account id) — this scan is over
    // `src/` only, which is what ships.
    const hits = ALL
      .filter((p) => /===\s*'gpt'|===\s*"gpt"|wrapper\s*!==\s*'gpt'/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it('spells the four Anthropic display names ONCE, in the file whose header explains why', () => {
    const holders = ALL
      .filter((p) => Object.values(ANTHROPIC_CLASS_NAMES).every((n) => readFileSync(p, 'utf8').includes(n)))
      .map(rel);
    expect(holders).toEqual(['pwa/src/lib/models.ts']);
  });

  it('and that file SAYS they are the last ones, so the exception is documented where it lives', () => {
    const src = readFileSync(path.join(PWA_SRC, 'lib', 'models.ts'), 'utf8');
    expect(src).toContain('LAST HARDCODED MODEL NAMES');
    // Spec §15.4: there is no Anthropic catalogue probe, which is WHY the
    // exception exists — a reader who does not know that will try to delete
    // these four next.
    expect(src).toMatch(/no catalogue probe|spec §15\.4|client's own current defaults/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `pwa/`: `npx vitest run test/model-table-deleted.test.ts`
Expected: FAIL on `names no concrete provider model id anywhere under pwa/src` if any straggler remains, and on the last case if Task 8's header wording differs. Both failures name the file.

- [ ] **Step 3: Clear whatever the scan found**

Read each named file and remove the concrete id. The expected result after Task 8 is ZERO hits — Task 8 replaced the gpt rows and the header. If a hit is in a COMMENT (a docstring naming `GPT-5.6 Sol` as an example), reword it to name the class instead: the scan cannot tell a comment from a table, and a comment that spells a model name is how the next table gets written.

If the last two cases fail, make Task 8's header contain the exact phrase `LAST HARDCODED MODEL NAMES` and a sentence naming spec §15.4's "no Anthropic catalogue probe".

- [ ] **Step 4: Run it green**

Run from `pwa/`: `npx vitest run test/model-table-deleted.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Measured mutation — the scan can actually fail**

Edit `pwa/src/lib/models.ts` and add, inside `modelOptions`, the line `const legacy = 'gpt-5.6-sol';` (unused).
Run from `pwa/`: `npx vitest run test/model-table-deleted.test.ts`
Expected: FAIL — `expected [ 'pwa/src/lib/models.ts matches /\bgpt-\d/i' ] to deeply equal []`.
Restore that line, then add `const isGpt = ('x' === 'gpt');` instead.
Run again.
Expected: FAIL — `branches on no wrapper NAME` reports `pwa/src/lib/models.ts`.
Restore. Re-run: PASS.

- [ ] **Step 6: Run the whole PWA, server and agent suites**

Run from `pwa/`: `npx vitest run` — PASS.
Run from `server/`: `npx vitest run` — PASS.
Run from `agent/`: `npx vitest run` — PASS.
Run from `<repo>`: `npx tsc -p server --noEmit && npx tsc -p pwa --noEmit && npx tsc -p agent --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add pwa/test/model-table-deleted.test.ts pwa/src/lib/models.ts
git commit -m "test(pwa): the deleted model table cannot come back, and the four Anthropic names say why they stayed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## What this plan does NOT do

Stated so a reviewer does not go looking for it, and so the next plan writer does not assume it landed here.

- **The registry, the probes and the materialiser** — `~/.ccrc/models/<id>.classes.json`, `shared/models.ts`/`.mjs` (`Registry`, `parseRegistry`, `parseCatalogue`, `deriveModels`, `availableFor`, `resolveDiscovery`, `classesTsv`, `MODEL_ID_RE`), `shared/modelenv.mjs` and its single-writer pin, `ccd/ccrc-models-probe`, `ccrc models <id> init|show|set-class|set-subagent|set-effort|discovery`, `ccrc models refresh|litellm`, `ccrc-models.timer`, and the `ccgpt-proxy` effort shim: **Plan 1**.
- **The class carry in ccd** — the registry `class` field and its `_reg_read_class` measured read, `_session_class`, `_lane_classes` (which reads the third column of `<id>.classes.tsv`), `_spawn_start`'s `--model <class>`, the class predicate in `_swap_target`'s composed chain, `cmd_swap`'s `--as-class` parse, and `ccd ls`'s lane line: **Plan 2**, gated on account-pools PR #62 being merged AND deployed.
- **The SwapSheet's downgrade sentence and `--as-class`** — including `FleetSession.modelClass`, the registry read that fills it, `CCD_ARGV.swap`'s third argument, the swap route's `asClass` body field and `api.swap`'s third argument: **Plan 3b**, gated on account-pools wave 4's merge sha.
- **`shared/roster.ts`, `shared/roster-json.mjs`, `deploy/account-op.mjs`, `ccd/ccrc`'s `cmd_account`** — the account-connections branch's, not on `main` (spec §14, ruling 280). Nothing here touches them, and no `models` block is added to the roster; the fold-in of `classes` into `exec.models` is a separate decision after that branch merges.
- **`server/src/limits.ts` and `pwa/src/stores/fleet.ts`** — account-pools waves 3 and 4's. This plan's `/api/accounts` change adds one line after `readLimits` and one field to the `roster:` map, and moves no existing line.
- **Deploy.** No file this plan touches is newly shipped, and this plan runs no deploy step. `ccrc-models.timer` is enabled by Plan 1's agent lane.
- **Gemini as a provider, per-model effort controls, cost accounting per class, an Anthropic catalogue probe, and the K3 lane** — spec §16's out-of-scope list, unchanged.
