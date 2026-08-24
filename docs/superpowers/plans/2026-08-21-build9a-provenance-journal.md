# Build 9 Plan A — the lifecycle provenance journal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ccrc a shared past tense — an append-only lifecycle journal under `$REG/.lifecycle/` that `_reg_purge` cannot reach, mirrored into `coord.db` by polling — so an operator on a phone can answer *"what happened to workspace X, who killed it, why, and what was lost"* for a workspace that no longer exists, and so `archiveMerged`'s timer and a human's `ws-rm` stop being byte-identical.

**Architecture:** L0 `shared/api.ts` owns the closed vocabularies (`LIFECYCLE_ACTS`, `LIFECYCLE_OUTCOMES`, `ACTOR_CLASSES`, `DecSurface`, the pure `corroboration()` ladder) and the wire shapes; `ccd` is the one writer — `_lc_emit` appends one NDJSON line per act through `_lc_json`, best-effort, never gating the act, from 21 call sites plus the `_reg_purge` backstop, with `_lc_obs` measuring the kernel-observed identity and the caller declaring its own (`obs` vs `dec`, two families that never merge). The server never tails: L1 `journalparse.ts`/`mirrorplan.ts` decide (parse, frame, plan a sweep, record a gap rather than skip it) and L3 `mirror.ts`/`store.ts` execute against `MIGRATIONS[2]`'s three tables on the **existing** `FleetWatcher` tick — no new timer — surfacing `GET /api/lifecycle`, a `/api/fleet/health` block, and the `provenance-mismatch` / `archived-but-live` divergence arms. Waves 5–6 close the loop by making the declaration real: validated `--surface`/`--actor`/`--reason` flags on the five non-deleting workspace verbs (never positionals), negotiated by the `actor-flags-v1` caps token, and `GateDecision.device` carrying attribution — never a decision — from the PWA into the record.

**Tech Stack:** TypeScript ESM (Node `>=22.13.0`, four packages: `server/` `agent/` `pwa/` `shared/`), bash (`ccd/ccd`, 9,815 lines, `set -uo pipefail`), `node:sqlite` `DatabaseSync` in WAL with `user_version` migrations, Fastify (L4 delivery), `python3` (one fork per emit, JSON encoding with `errors='replace'`), vitest (hermetic, fixture HOMEs), `deploy/deploy.sh` over the two-box tailnet topology.

**Spec:** `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`

---

## Global Constraints

Every task inherits these. They are project-wide invariants, not per-task choices.

- **Node `>=22.13.0`, identical across the three engines** (`server/`, `agent/`, `pwa/`), pinned by `server/test/node-floor.test.ts`; if its absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green**.
- **No root `package.json`, no root runner** — four packages, each `"type":"module"`; every command runs `cd`'d into its package (`shared/`'s bare `"type":"module"` marker is load-bearing: without it tsc emits CommonJS into `dist/shared/` and the server dies on startup).
- **The exact vitest command is `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package** — for example `cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle.test.ts`.
- **NEVER the bare global `npx` runner for vitest** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms** — backgrounding hides a hang, and the suites are load-sensitive.
- **Known load flakes** (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`): re-run IN ISOLATION before calling a real break; CI on the quiet box is the arbiter.
- **AGENT-FIRST deploy for anything touching `ccd/`** (also `session-hook.sh`, `ccd/*-skill/`): `bash deploy/deploy.sh agent <host>` ships to the fleet host **before** `bash deploy/deploy.sh` ships the server; executables land via `install_atomic`, and the server lane's final gate is `/health` reporting the shipped sha.
- **Do NOT bump `FLEET_PROTO`** (=1, `FLEET_PROTO_MIN`=1, defined once in `shared/api.ts`) — frames are ADDITIVE and absence-permits, read through a SINGLE reader per field.
- **`coord.db` is synchronous and stays synchronous** — `node:sqlite` `DatabaseSync`, WAL, `user_version` migrations that refuse to start rather than open empty; **do not wrap it async**, and no repository/async interface over `CoordStore`.
- **Zero new ccd verbs** — mutations ride already-granted `CcdArgv` (a brand built at the call site, never table-looked-up); the exec surface stays closed at `EXEC_COMMANDS = ['tmux','ccd']`.
- **The box token gates every coordination WRITE** (`/api/mail*`, `/api/runs*`) — header `x-ccrc-mail-token`, `401` on missing; `GET /api/lifecycle` is readable with that same box token (D16). **Never print secret file CONTENTS** — existence checks by `ls` only; this repo is PUBLIC.
- **`shared/` (L0) imports NOTHING** — not even `node:*`. Ring membership is a property of a file's IMPORTS, not its path: L1 policy = pure decisions with no `fs`/fastify/`reply`; L2 ports are interfaces declared BY THE CONSUMER; L4 delivery owns fastify/sockets/timers but is NOT allowed to DECIDE; L5 is `index.ts` only.
- **No overloaded null at a seam** — two conditions a caller handles differently must not collapse to the same value; that is a defect, not style.
- **An adapter may not narrow a distinction it received** — the highest-yield ring rule.
- **Single-source-of-truth values are enumerated once and derived** — `LIFECYCLE_ACTS = Object.keys(LIFECYCLE_ACT_MAP)`, the `PR_REASON_MAP` idiom; `server/test/single-definition.test.ts` text-scans four roots and fails the build on a 2nd copy. No account-name list outside L0's roster.
- **Every new guard ships WITH a test that goes RED when the guard is deleted or mutated** — measured before/after, not asserted in a comment. TDD red-first. *"A comment is a request; a red suite is a mechanism."*
- **FIXTURE HOMEs only — never the live `$HOME` or the live registry.** `HOME` is the single isolation boundary the whole ccd suite relies on: harness `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`), cleanup in `tmpHelpers.ts`, `ghContainedEnv()` per test.
- **NEVER run destructive `ccd` verbs against the live host** — `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`; `ws-reap` is **human-only by contract**.
- **The reason cap is 512 BYTES and the policy is REFUSE, never truncate** — `LC_REASON_MAX_BYTES` (L0) and `_LC_DEC_MAX` (ccd) are one number in two languages, bound by `lifecycle-constants-twin.test.ts`.
- **The journal is best-effort and NEVER gates an act (D7)** — every `_lc_*` function returns 0 on every path except `_lc_refuse`, which emits and then `die`s; a failed append bumps `.lifecycle/errors`. A fleet that cannot clean up is an outage; one unrecorded destruction is a gap in a record.
- **No carry globals in ccd** — `tip`, `attic` and `tx` are ARGUMENTS (the `LC_TIP=` idiom dies under `set -u` on the first call in a process and appends a blank line nobody notices), and every wrapper binds its positionals with `${1-}`, never `$1`.
- **Deviation ledger (D-N) numbers are global and monotonic across project history** — never reset per plan; `D-N` refs already in source are authoritative history, do not delete them.

---

## Wave map

| Wave | Tasks | Package | Dark? | Delivers |
|---|---|---|---|---|
| **1** | Tasks 1–10 | `shared/` (L0) | **Dark (types only)** | The closed vocabularies (`LIFECYCLE_ACT_MAP`/`ACTS`, `LIFECYCLE_OUTCOMES`, `ACTOR_CLASSES`, `DecSurface`), the pure `corroboration()` ladder, the wire shapes (`LifecycleObs`/`Dec`/`Meas`/`Event`, `MirroredLifecycleEvent`), `LC_REFUSAL_WORD` disjoint from `wsaudit`'s `SENTENCES`, the `LC_*` constants and generation-name readers, plus the single-definition and cross-language pins |
| **2** | Tasks 11–21 | **`ccd/` — agent-first** | **Dark: the journal fills, nothing reads it** | `_lc_emit` (the one writer), `_lc_obs`/`_lc_live`/`_lc_rotate`/`_lc_json`/`_lc_err`, the four wrappers (`_lc_intent`/`_lc_done`/`_lc_refuse`/`_lc_fail`), `_LC_ACTS`, all 21 session and workspace call sites, the `_reg_purge` backstop (D3), the intent/outcome pairs on the four destructive verbs (D4), the write-containment scanner, and `caps += lifecycle-v1` |
| **3** | Tasks 22–26 | **`ccd/` — agent-first** | **Dark** | D15/R4: `ws-rm` takes an attic pin before it deletes anything, `ws-restore` supersedes rather than erases, refused destructions get a record (including the `flock` decline), a validated `--reason` on `ws-rm`/`forget` — refused, never truncated — and the refusal scanner that binds the next editor |
| **4** | Tasks 27–43 | `server/` (+1 `agent/` test, +1 ccd skill corpus file — so agent-first still applies) | **No — problems 2 + 3 solved and queryable** | `MIGRATIONS[2]`'s three tables, L1 `journalparse.ts` + `mirrorplan.ts` (`planSweep` decides, does not act), L3 `mirror.ts` + the `CoordStore` reads/writes, the sweep on the **existing** `FleetWatcher` tick (`LC_SWEEP_MS`), `GET /api/lifecycle` with its EXEMPT entry, the `/api/fleet/health` lifecycle block, `divergence.provenance-mismatch` + `divergence.archived-but-live`, the replay drill, and the agent whitelist test (journal read-allowed, write-FORBIDDEN) |
| **5** | Tasks 44–50 | **`ccd/` — agent-first** | **Dark until 6** | Validated `--surface`/`--actor`/`--reason` flag loops on `ws-archive`/`ws-restore`/`ws-hold`/`ws-release`/`ws-rename` — closed sets, **never positionals** — the parsed `dec` triple threaded into wave 2's emit sites as dotted `dec.*` pairs, the cross-language constants twin, and `caps += actor-flags-v1` |
| **6** | Tasks 51–56 | `server/` | **No — `archiveMerged`'s timer and a human's `ws-rm` stop being byte-identical** | `capSupported` (the token lifted to a parameter, `stopSurfaceSupported` delegating), `ActorFlags`/`decFlags`/`deviceActor` and the five threaded argv builders, `GateDecision.device` as attribution — never a decision — the four human routes declaring `surface pwa`, every unattended lane naming itself, then the server deploy and the verification on the box |

---

### Task 1: Preflight — install the server package's dependencies

This worktree has **no `node_modules` in any package** (measured today: `server/`, `agent/`, `pwa/`
all absent) and there is no root `package.json`. Every later task's test command fails with ENOENT —
not red — until this runs.

**Files:**
- Create: none tracked (`server/node_modules/` is gitignored).
- Modify: none.

**Interfaces:**
- Consumes: nothing.
- Produces: `server/node_modules/.bin/vitest` and `server/node_modules/typescript/bin/tsc`, the two
  binaries every later task in this wave invokes.

- [ ] **Step 1: Install the server package, in the foreground.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && npm ci
  ```
- [ ] **Step 2: Confirm both binaries exist.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ls -l ./node_modules/.bin/vitest ./node_modules/typescript/bin/tsc
  ```
  Both paths must list. If either is missing, STOP — every later red/green measurement in this wave
  is meaningless without them.
- [ ] **Step 3: Confirm the suite runs at all, using a suite this wave never touches.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/prphase.test.ts
  ```
  Expect `Test Files  1 passed`. **Never use bare `npx vitest`** — it resolves a global copy with no
  jsdom and falsely reports "no tests".
- [ ] **Step 4: No commit.** `node_modules/` is not tracked; `git status --porcelain` must be empty.

---

### Task 2: The act and outcome vocabularies (L0)

**Files:**
- Create: `server/test/lifecycle-acts.test.ts`
- Modify: `shared/api.ts` — **append** a new banner section at end of file (currently **3349** lines,
  ending with `PasskeyListResponse`'s closing `}`). Everything Tasks 2–6 add goes in this one
  appended section, in task order.

**Interfaces:**
- Consumes: nothing. L0 imports nothing — `shared/api.ts` has exactly one import,
  `import type { Hue } from './roster.js'` at `:9`, and this task adds none.
- Produces:
  ```ts
  export type LifecycleAct =
    | 'create' | 'claim' | 'purge' | 'supervise' | 'unsupervise'
    | 'destroy' | 'rename' | 'hold' | 'release' | 'archive' | 'restore'
    | 'attic-drop' | 'reap' | 'gc' | 'spawn' | 'start' | 'ensure'
    | 'swap' | 'enable' | 'stop' | 'forget'
    | 'unknown';
  export const LIFECYCLE_ACTS: readonly LifecycleAct[];
  export const LC_ACT_UNKNOWN: LifecycleAct;
  export function isLifecycleAct(v: unknown): v is LifecycleAct;
  export type LifecycleOutcome = 'intent' | 'done' | 'refused' | 'failed' | 'unknown';
  export const LIFECYCLE_OUTCOMES: readonly LifecycleOutcome[];
  export const LC_OUTCOME_UNKNOWN: LifecycleOutcome;
  export function isLifecycleOutcome(v: unknown): v is LifecycleOutcome;
  ```
  `LIFECYCLE_ACT_MAP` and `LIFECYCLE_OUTCOME_MAP` are **module-private** and stay that way — Task 7
  pins it.

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-acts.test.ts`:
  ```ts
  // The journal's two closed vocabularies, pinned the `prphase.test.ts` way:
  // the list under test is derived HERE from the UNION (`Record<LifecycleAct,
  // true>`), not from the runtime constant it is checking, so two independent
  // failures come out of one honest source — add a member to the union and this
  // literal stops compiling (`typecheck-tests.test.ts` compiles this directory),
  // and if `LIFECYCLE_ACT_MAP` in L0 was not updated with it, `isLifecycleAct`
  // answers false for the new key and the first describe below goes red.
  import { describe, it, expect } from 'vitest';
  import {
    LIFECYCLE_ACTS, LC_ACT_UNKNOWN, isLifecycleAct,
    LIFECYCLE_OUTCOMES, LC_OUTCOME_UNKNOWN, isLifecycleOutcome,
    type LifecycleAct, type LifecycleOutcome,
  } from '../../shared/api.js';

  const ALL_ACTS: Record<LifecycleAct, true> = {
    create: true, claim: true, purge: true, supervise: true, unsupervise: true,
    destroy: true, rename: true, hold: true, release: true, archive: true, restore: true,
    'attic-drop': true, reap: true, gc: true, spawn: true, start: true, ensure: true,
    swap: true, enable: true, stop: true, forget: true,
    unknown: true,
  };
  const ACTS = Object.keys(ALL_ACTS) as LifecycleAct[];

  const ALL_OUTCOMES: Record<LifecycleOutcome, true> = {
    intent: true, done: true, refused: true, failed: true, unknown: true,
  };
  const OUTCOMES = Object.keys(ALL_OUTCOMES) as LifecycleOutcome[];

  describe('isLifecycleAct accepts exactly the declared acts', () => {
    it.each(ACTS)('%s', (act) => { expect(isLifecycleAct(act)).toBe(true); });

    it('covers the whole union — the runtime list cannot fall behind the type', () => {
      expect(ACTS.length).toBe(22);
      expect([...LIFECYCLE_ACTS].sort()).toEqual([...ACTS].sort());
    });

    it('is the ONLY door — the constant is cast, never the input', () => {
      // `PrReason`'s rule, and the reason it is a rule: an input asserted to be
      // an act is the very thing the check is asking about.
      for (const v of ['destroyed', 'ws-rm', '', 'CREATE', 0, null, undefined, {}, ['create']]) {
        expect(isLifecycleAct(v), String(v)).toBe(false);
      }
    });
  });

  describe('`unknown` is the READER-side degrade, never a ccd call site', () => {
    it('is a declared member, and LC_ACT_UNKNOWN names it once', () => {
      // Every filter in this repo that excludes the degrade must filter by this
      // constant, not by a literal that can be edited to match a mistake — the
      // shape `SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable')` already
      // wants and does not have.
      expect(LC_ACT_UNKNOWN).toBe('unknown');
      expect(LIFECYCLE_ACTS).toContain(LC_ACT_UNKNOWN);
      expect(LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN)).toHaveLength(21);
    });
  });

  describe('isLifecycleOutcome accepts exactly the declared outcomes', () => {
    it.each(OUTCOMES)('%s', (o) => { expect(isLifecycleOutcome(o)).toBe(true); });

    it('covers the whole union', () => {
      expect(OUTCOMES.length).toBe(5);
      expect([...LIFECYCLE_OUTCOMES].sort()).toEqual([...OUTCOMES].sort());
    });

    it('LC_OUTCOME_UNKNOWN names the outcome degrade once, exactly as the act side does', () => {
      // Both halves of the vocabulary have a degrade, so both halves name it by
      // a constant. Without this the mirror's `outcome: … : 'unknown'` and ccd's
      // `_LC_OUTCOMES` filter would each spell it inline, which is the second
      // home this file exists to prevent.
      expect(LC_OUTCOME_UNKNOWN).toBe('unknown');
      expect(LIFECYCLE_OUTCOMES).toContain(LC_OUTCOME_UNKNOWN);
      expect(LIFECYCLE_OUTCOMES.filter((o) => o !== LC_OUTCOME_UNKNOWN)).toHaveLength(4);
    });

    it('has NO `orphaned` member — an unpaired intent is DERIVED, never stored (D4)', () => {
      // "An `intent` with no sibling at all is a process that died mid-destroy"
      // is a fact about a PAIR of rows. Storing it as a third outcome would
      // require the writer to know the future, and would give the reader two
      // sources for one fact.
      expect(isLifecycleOutcome('orphaned')).toBe(false);
      expect(isLifecycleOutcome('interrupted')).toBe(false);
    });

    it('rejects everything else', () => {
      for (const v of ['refused-destruction', 'ok', '', 1, null, undefined, {}]) {
        expect(isLifecycleOutcome(v), String(v)).toBe(false);
      }
    });
  });
  ```
- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts
  ```
  Expected failure text — the module has no such export yet:
  `SyntaxError: [vite] The requested module '/home/you/worktrees/ccrc-pwa/still-river/shared/api.ts' does not provide an export named 'LIFECYCLE_ACTS'`
- [ ] **Step 3: Write the minimal implementation.** Append to the end of
  `/home/you/worktrees/ccrc-pwa/still-river/shared/api.ts`, after the closing `}` of
  `PasskeyListResponse` (line 3349):
  ```ts

  /* ---------------------------------------------------------------------------
   * THE LIFECYCLE JOURNAL — build 9, §1 (D1-D7). The fleet's PAST TENSE.
   *
   * Every act a session or a human takes on the fleet leaves an append-only
   * NDJSON line in `$REG/.lifecycle/`, a dot-prefixed DIRECTORY that `_reg_purge`
   * (`ccd:458-556`) structurally cannot reach — its suffix filter globs
   * `$REG/<id>.*` and ids never begin with a dot. That is what makes a
   * destruction record possible at all: a new registry FIELD would be destroyed
   * by the loop the day it was added.
   *
   * NAME COLLISION, SAID OUT LOUD SO THE NEXT READER DOES NOT CONFLATE THEM.
   * `SessionLifecycle` / `sessionLifecycle()` / `LifecycleField` /
   * `LifecycleInput` (:963-1260 above) classify a registry row AS IT IS NOW —
   * WHY a session is not alive. Everything below is what was DONE, by whom, and
   * with what result. Two different lifecycles, two different questions. The
   * journal half is prefixed `LC_` / `Lifecycle{Act,Outcome,Obs,Dec,Meas,Event}`
   * and lives here, at the far end of the file, rather than beside them.
   *
   * Nothing here decides anything about the fleet. ccd cannot refuse on identity
   * — single UNIX user, attribution not authentication — and this vocabulary does
   * not pretend otherwise. The record IS the mechanism.
   * ------------------------------------------------------------------------- */

  /**
   * Every act ccd can journal. ONE WORD PER OPERATOR-VISIBLE ACT, named for the
   * verb a person would say and not for the bash function that implements it:
   * `destroy`, because `ws-rm` and `ws-gc --prune` both destroy a workspace and
   * a reader asking "what destroyed this" must not have to know which ran. The
   * verb itself travels separately, in `LifecycleEvent.verb`.
   *
   * `unknown` IS THE READER'S DEGRADE, NEVER A CALL SITE'S CHOICE (D6). A line
   * naming an act this build does not model is ingested as `unknown`, with the
   * token preserved in `LifecycleEvent.badact` and the bytes in `raw`: a byte we
   * saw and could not model is a different fact from a byte that was never
   * there, and both differ from a row we dropped. So ccd's own `_LC_ACTS` holds
   * this list MINUS `unknown` — set-equal in both directions, pinned by
   * `server/test/lifecycle-vocabulary.test.ts`, which EXECUTES the bash array
   * rather than grepping for it.
   *
   * Adding an act is a two-line edit here (union member + map key) and a
   * `_LC_ACTS` entry in ccd. `Record<LifecycleAct, true>` makes forgetting the
   * map a TS2739 and an extra key a TS2353; the cross-language test makes
   * forgetting ccd a red suite. A hand-written `readonly LifecycleAct[]` gives
   * neither, which is why `LIFECYCLE_ACTS` is derived below.
   */
  export type LifecycleAct =
    | 'create'        // ws-add minted a workspace
    | 'claim'         // _reg_claim wrote `started`
    | 'purge'         // _reg_purge is about to unlink the row (the D3 backstop)
    | 'supervise'     // _ws_supervise enabled the unit
    | 'unsupervise'   // _ws_unsupervise disabled it and stamped `.stopped`
    | 'destroy'       // ws-rm / ws-gc --prune removed a workspace
    | 'rename'        // ws-rename moved the branch
    | 'hold' | 'release'
    | 'archive' | 'restore'
    | 'attic-drop'    // ws-attic --drop deleted pinned refs
    | 'reap'          // ws-reap
    | 'gc'            // ws-gc --prune, as a run rather than a per-row destroy
    | 'spawn'         // _spawn_settle, CHANGE-ONLY (§2)
    | 'start' | 'ensure' | 'swap' | 'enable' | 'stop' | 'forget'
    | 'unknown';      // the reader's degrade. NEVER written by a ccd call site.

  /** Derived from the type, never restated beside it — `PR_REASON_MAP`'s idiom
   *  (:299) and its exact guarantee. Module-private: only the derived list and
   *  the guard are exported, so `LIFECYCLE_ACTS.includes(raw as LifecycleAct)`
   *  — asserting the very thing the check asks — has no shorter route than
   *  `isLifecycleAct`. */
  const LIFECYCLE_ACT_MAP: Record<LifecycleAct, true> = {
    create: true, claim: true, purge: true, supervise: true, unsupervise: true,
    destroy: true, rename: true, hold: true, release: true, archive: true, restore: true,
    'attic-drop': true, reap: true, gc: true, spawn: true, start: true, ensure: true,
    swap: true, enable: true, stop: true, forget: true,
    unknown: true,
  };
  export const LIFECYCLE_ACTS: readonly LifecycleAct[] =
    Object.keys(LIFECYCLE_ACT_MAP) as LifecycleAct[];

  /** The one act ccd may never name at a call site. Exported so every filter
   *  that excludes the degrade filters by THIS, not by a literal a later edit
   *  could quietly point at the wrong member — the improvement on
   *  `SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable')`, which spells its
   *  exclusion inline in two suites. */
  export const LC_ACT_UNKNOWN: LifecycleAct = 'unknown';

  /** The only way to narrow an untrusted string to a `LifecycleAct`. The
   *  parameter is `unknown` so nothing can be smuggled in by claiming it is
   *  already an act, and the CONSTANT is cast rather than the input. */
  export function isLifecycleAct(v: unknown): v is LifecycleAct {
    return typeof v === 'string' && (LIFECYCLE_ACTS as readonly string[]).includes(v);
  }

  /**
   * What happened to the act. D4: the destructive verbs (`ws-rm`, `ws-reap`,
   * `ws-gc --prune`, `forget`) write one `intent` line BEFORE the irreversible
   * act and one outcome line after, sharing a `tx`.
   *
   * THERE IS DELIBERATELY NO `orphaned` MEMBER. "An `intent` with a `failed`
   * sibling is a half-destroyed workspace; an `intent` with no sibling at all is
   * a process that died mid-destroy" is a fact about a PAIR of rows, DERIVED BY
   * THE READER and never stored — a writer cannot know it, and storing it would
   * give the reader two sources for one fact.
   *
   * `_lc_obs` gathers the `obs` block once per process and emits nothing, so it
   * contributes no outcome — there is NO `observed` member. If wave 2 finds it
   * must emit, adding one here is the same two-line edit as an act.
   */
  export type LifecycleOutcome =
    | 'intent'    // said before the irreversible act
    | 'done'      // it happened
    | 'refused'   // ccd declined; `LifecycleEvent.refusal` carries the token
    | 'failed'    // it was attempted past the point of no return and did not finish
    | 'unknown';  // the reader's degrade, exactly as `LifecycleAct.unknown`

  const LIFECYCLE_OUTCOME_MAP: Record<LifecycleOutcome, true> = {
    intent: true, done: true, refused: true, failed: true, unknown: true,
  };
  export const LIFECYCLE_OUTCOMES: readonly LifecycleOutcome[] =
    Object.keys(LIFECYCLE_OUTCOME_MAP) as LifecycleOutcome[];

  /** The outcome side's degrade, named once for the same reason `LC_ACT_UNKNOWN`
   *  is: `journalparse.ts`'s `isLifecycleOutcome(raw) ? raw : LC_OUTCOME_UNKNOWN`
   *  and ccd's `_LC_OUTCOMES` (this list minus this member) must not each spell
   *  it inline. Both halves of the vocabulary have a degrade; both name it. */
  export const LC_OUTCOME_UNKNOWN: LifecycleOutcome = 'unknown';

  export function isLifecycleOutcome(v: unknown): v is LifecycleOutcome {
    return typeof v === 'string' && (LIFECYCLE_OUTCOMES as readonly string[]).includes(v);
  }
  ```
- [ ] **Step 4: Run it and watch it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  34 passed` (22 `it.each` acts + 2, then 1, then 5 `it.each`
  outcomes + 4).
- [ ] **Step 5: Measure mutant 1 of 3 — a map key that fell behind the union.**
  Delete `'attic-drop': true,` from `LIFECYCLE_ACT_MAP`, run the Step 4 command, revert.
  Mutant: drop a total-map key -> `covers the whole union` fails with
  `expected [ 'archive', 'claim', … ] to deeply equal [ 'archive', 'attic-drop', … ]`, and Task 10's
  `tsc` run additionally reds with
  `TS2739: Type '{ … }' is missing the following properties from type 'Record<LifecycleAct, true>': 'attic-drop'`.
- [ ] **Step 6: Measure mutant 2 of 3 — a hand-written list beside the type.**
  Replace `export const LIFECYCLE_ACTS: readonly LifecycleAct[] = Object.keys(LIFECYCLE_ACT_MAP) as LifecycleAct[];`
  with a literal array of 21 members (omit `'gc'`), run the Step 4 command, revert.
  Mutant: derive -> hand-write -> `covers the whole union` fails with
  `expected [ 'archive', … ] to deeply equal [ 'archive', … 'gc' … ]`, and Task 7's `DERIVES` guard
  fails with `LIFECYCLE_ACTS is a hand-written array`.
- [ ] **Step 7: Measure mutant 3 of 3 — the degrade constant pointed at the wrong member.**
  Change `LC_ACT_UNKNOWN` to `'purge'` and `LC_OUTCOME_UNKNOWN` to `'failed'`, run the Step 4
  command, revert.
  Mutant: repoint either degrade constant -> `is a declared member, and LC_ACT_UNKNOWN names it once`
  fails with `expected 'purge' to be 'unknown'` and
  `LC_OUTCOME_UNKNOWN names the outcome degrade once` fails with `expected 'failed' to be 'unknown'`.
- [ ] **Step 8: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add shared/api.ts server/test/lifecycle-acts.test.ts \
    && git commit -m "feat(shared): the lifecycle journal's act and outcome vocabularies (build 9 W1)

  LIFECYCLE_ACTS and LIFECYCLE_OUTCOMES derive from total maps, the
  PR_REASON_MAP idiom, so a member added to either union is a TS2739 rather
  than a runtime list one short. \`unknown\` is the reader's degrade in both,
  and LC_ACT_UNKNOWN / LC_OUTCOME_UNKNOWN name it once on each side so no
  reader spells it inline. No \`orphaned\` outcome and no \`observed\` outcome:
  an unpaired intent is derived by the reader (D4), and _lc_obs emits nothing.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 3: `ActorClass`, `DecSurface` and the pure `corroboration()` ladder

The one function in the whole design permitted to relate the `obs` and `dec` identity families (D2).
It reports a contradiction; it never picks a winner.

**Files:**
- Create: `server/test/corroboration.test.ts`
- Modify: `shared/api.ts` — append immediately after Task 2's block (end of file).

**Interfaces:**
- Consumes: `StopSurface` (`shared/api.ts:1135`) and `isStopSurface` (`:1146`), already declared.
  Nothing else.
- Produces:
  ```ts
  export type ActorClass = 'agent' | 'pane' | 'supervisor' | 'login' | 'unknown';
  export const ACTOR_CLASSES: readonly ActorClass[];
  export function isActorClass(v: unknown): v is ActorClass;
  export type DecSurface = StopSurface | 'none';
  export function isDecSurface(v: unknown): v is DecSurface;
  export type Corroboration = 'agrees' | 'disagrees' | 'not-comparable' | 'unmeasured';
  export const CORROBORATIONS: readonly Corroboration[];
  export function isCorroboration(v: unknown): v is Corroboration;
  export function corroboration(obsClass: ActorClass | null, decSurface: DecSurface): Corroboration;
  ```
  **The parameter names `obsClass` and `decSurface` are load-bearing** and are the agreed spelling of
  the DERIVED pair that crosses the L1/L3 seams. The WIRE spells the same two facts `obs.cg` and
  `dec.surface` (Task 4). Two layers, two spellings, one written-down mapping — see the docstring in
  Step 3; do not "fix" either one into the other.
  `ACTOR_CLASS_MAP`, `CORROBORATION_MAP` and `DEC_CORROBORATES` are **module-private**.

- [ ] **Step 1: Write the failing test.** Create `server/test/corroboration.test.ts`:
  ```ts
  // D2's one sanctioned bridge between the kernel-observed and declared identity
  // families, and the four-rung ladder that keeps it honest. PURE and clock-free
  // by construction — `sessionBucket`/`sessionLifecycle`/`spawnVerdict` are the
  // precedents, and like them this is testable with no timers and no fixture.
  //
  // The ladder's ORDER is the whole design, so every rung has its own `it` and
  // its own named mutant: three of the four answers are reachable only because a
  // rung above the table caught them, and collapsing any one of them turns a
  // "we cannot compare these" into a "you lied", which is a divergence an
  // operator would be shown.
  import { describe, it, expect } from 'vitest';
  import {
    corroboration, isActorClass, ACTOR_CLASSES, isDecSurface,
    isCorroboration, CORROBORATIONS, type ActorClass, type Corroboration,
  } from '../../shared/api.js';

  const ALL_CLASSES: Record<ActorClass, true> = {
    agent: true, pane: true, supervisor: true, login: true, unknown: true,
  };
  const CLASSES = Object.keys(ALL_CLASSES) as ActorClass[];

  const ALL_VERDICTS: Record<Corroboration, true> = {
    agrees: true, disagrees: true, 'not-comparable': true, unmeasured: true,
  };

  describe('the two vocabularies', () => {
    it.each(CLASSES)('isActorClass(%s)', (c) => { expect(isActorClass(c)).toBe(true); });

    it('ActorClass is exactly the five cgroup shapes D2 names', () => {
      expect(CLASSES.length).toBe(5);
      expect([...ACTOR_CLASSES].sort()).toEqual([...CLASSES].sort());
      for (const v of ['systemd', 'human', 'pwa', '', null, 0]) {
        expect(isActorClass(v), String(v)).toBe(false);
      }
    });

    it('Corroboration is exactly four answers', () => {
      expect([...CORROBORATIONS].sort()).toEqual([...Object.keys(ALL_VERDICTS)].sort());
      expect(isCorroboration('mismatch')).toBe(false);
    });

    it('DecSurface is ccd`s closed set PLUS `none` — and nothing else', () => {
      // `none` is what the journal writes when NO flag was passed. It is NOT a
      // fifth surface word: `StopSurface` is unchanged (spec §2), and
      // `isDecSurface` derives from `isStopSurface` rather than restating it.
      for (const s of ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none']) {
        expect(isDecSurface(s), s).toBe(true);
      }
      for (const s of ['none ', 'CLI', '', null, undefined, 0]) {
        expect(isDecSurface(s), String(s)).toBe(false);
      }
    });
  });

  describe('rung 1 — an unobserved caller is UNMEASURED, never a disagreement', () => {
    it('answers unmeasured for every declared surface when obs is null', () => {
      // null = no cgroup was read at all (the `/proc` read failed). Distinct
      // from `'unknown'`, which is a cgroup that WAS read and matched none of
      // the four shapes — two conditions a caller handles differently must not
      // collapse to one value.
      for (const s of ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const) {
        expect(corroboration(null, s), s).toBe('unmeasured');
      }
    });
  });

  describe('rung 2 — no flag is UNMEASURED, for every observed class', () => {
    it.each(CLASSES)('%s + none', (c) => {
      expect(corroboration(c, 'none')).toBe('unmeasured');
    });

    it('and `none` beats an unclassifiable cgroup — nothing was declared to compare', () => {
      expect(corroboration('unknown', 'none')).toBe('unmeasured');
    });
  });

  describe('rung 3 — an unrecognised word on EITHER side is NOT-COMPARABLE', () => {
    it('an unclassifiable cgroup cannot disagree with anything', () => {
      expect(corroboration('unknown', 'cli')).toBe('not-comparable');
      expect(corroboration('unknown', 'pwa')).toBe('not-comparable');
    });

    it('a surface word ccd itself rejected cannot disagree either', () => {
      // `ccd:619` maps an out-of-set word to `unknown`. Something WAS declared;
      // it just cannot be lined up.
      expect(corroboration('pane', 'unknown')).toBe('not-comparable');
      expect(corroboration('agent', 'unknown')).toBe('not-comparable');
    });
  });

  describe('rung 4 — `ccd` names a LAYER, not a host, so it corroborates nothing', () => {
    it.each(CLASSES)('%s + ccd', (c) => {
      expect(corroboration(c, 'ccd')).toBe('not-comparable');
    });
  });

  describe('the table — the only place `agrees` and `disagrees` come from', () => {
    it('agrees where the observed host is the one the declaration implies', () => {
      expect(corroboration('agent', 'pwa')).toBe('agrees');   // PWA -> server -> agent -> ccd
      expect(corroboration('agent', 'agent')).toBe('agrees');
      expect(corroboration('pane', 'cli')).toBe('agrees');    // a session`s own Bash tool
      expect(corroboration('login', 'cli')).toBe('agrees');   // a human at a shell
    });

    it('disagrees where it does not — the fact an operator is shown', () => {
      expect(corroboration('pane', 'pwa')).toBe('disagrees');   // a session claiming to be the PWA
      expect(corroboration('pane', 'agent')).toBe('disagrees');
      expect(corroboration('login', 'pwa')).toBe('disagrees');
      expect(corroboration('agent', 'cli')).toBe('disagrees');
      expect(corroboration('supervisor', 'pwa')).toBe('disagrees');
      expect(corroboration('supervisor', 'cli')).toBe('disagrees');
    });

    it('answers one of the four for EVERY input pair — total, no undefined', () => {
      const inputs: (ActorClass | null)[] = [...CLASSES, null];
      const surfaces = ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const;
      let n = 0;
      for (const o of inputs) {
        for (const s of surfaces) {
          expect(isCorroboration(corroboration(o, s)), `${String(o)} + ${s}`).toBe(true);
          n++;
        }
      }
      expect(n, 'the whole input space, 6 classes x 6 surfaces').toBe(36);
    });
  });
  ```
- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/corroboration.test.ts
  ```
  Expected failure text:
  `SyntaxError: [vite] The requested module '/home/you/worktrees/ccrc-pwa/still-river/shared/api.ts' does not provide an export named 'corroboration'`
- [ ] **Step 3: Write the minimal implementation.** Append to `shared/api.ts`, after Task 2's block:
  ```ts

  /**
   * What the KERNEL says about the process that ran ccd, resolved from
   * `/proc/self/cgroup`'s `0::` path (D2). Unforgeable by env — the systemd unit
   * names the session id in the path, which is respawn provenance nothing on
   * this box has today.
   *
   *   `app.slice/ccrc-agent.service`           -> agent
   *   `app.slice/tmux-spawn-<uuid>.scope`      -> pane
   *   `app.slice/claude-session@<id>.service`  -> supervisor
   *   `user.slice/session-N.scope`             -> login
   *
   * TWO SPELLINGS, ONE FACT, AND THE MAPPING IS WRITTEN DOWN HERE SO NOBODY
   * "FIXES" EITHER: on the WIRE this value is `LifecycleObs.cg` (ccd writes
   * `obs.cg`, spec-mandated); as a DERIVED PAIR crossing the L1/L3 seams it is
   * `obsClass`, matching this file's `corroboration(obsClass, decSurface)`
   * parameter names and `ProvenancePair` in `server/src/coord/store.ts`. Same
   * for `LifecycleDec.surface` <-> `decSurface`. Wire names are short because a
   * million lines carry them; seam names are explicit because a reader of one
   * call site has no object to look at.
   *
   * `unknown` means the path WAS read and matched none of the four. It is not
   * the same condition as "no cgroup was read at all", which the wire spells
   * `obs.cg === null` — two conditions a caller handles differently, so two
   * values (`corroboration` answers `not-comparable` for the first and
   * `unmeasured` for the second).
   *
   * A double fork makes a caller ANONYMOUS (`ppid 1`), never someone else. The
   * raw path travels beside this in `obs.cgraw` and is never dropped, so a fifth
   * shape this build cannot name is still recoverable from the record.
   */
  export type ActorClass = 'agent' | 'pane' | 'supervisor' | 'login' | 'unknown';
  const ACTOR_CLASS_MAP: Record<ActorClass, true> = {
    agent: true, pane: true, supervisor: true, login: true, unknown: true,
  };
  export const ACTOR_CLASSES: readonly ActorClass[] =
    Object.keys(ACTOR_CLASS_MAP) as ActorClass[];

  export function isActorClass(v: unknown): v is ActorClass {
    return typeof v === 'string' && (ACTOR_CLASSES as readonly string[]).includes(v);
  }

  /**
   * What the CALLER said (D2, wire `dec.surface`, seam `decSurface`): ccd's own
   * closed set (`ccd:619`) plus `'none'`, which is what the journal writes when
   * no `--surface` flag was passed at all.
   *
   * `StopSurface` IS UNCHANGED (spec §2) — no fifth surface word. `'none'` is a
   * journal-only member, and it is a MEASUREMENT of absence rather than a
   * default: `cmd_stop` defaults its own `surface` to `cli` (`ccd:9607`) and
   * `_ws_unsupervise` defaults its second parameter to `ccd` (`ccd:610-618`,
   * `${2-ccd}` and not `${2:-ccd}`), and NEITHER of those internal defaults may
   * reach this field. Journaling a default as a declaration would manufacture
   * corroboration out of silence, which is the one thing this family exists to
   * prevent.
   */
  export type DecSurface = StopSurface | 'none';

  /** Derived from `isStopSurface` (:1146) rather than restating its list — the
   *  list is module-private there precisely so there is one door. */
  export function isDecSurface(v: unknown): v is DecSurface {
    return v === 'none' || isStopSurface(v);
  }

  /** What `corroboration()` can answer. Four words, because there are four
   *  conditions and a reader handles each differently: only `disagrees` raises
   *  `divergence.provenance-mismatch`. */
  export type Corroboration = 'agrees' | 'disagrees' | 'not-comparable' | 'unmeasured';
  const CORROBORATION_MAP: Record<Corroboration, true> = {
    agrees: true, disagrees: true, 'not-comparable': true, unmeasured: true,
  };
  export const CORROBORATIONS: readonly Corroboration[] =
    Object.keys(CORROBORATION_MAP) as Corroboration[];

  export function isCorroboration(v: unknown): v is Corroboration {
    return typeof v === 'string' && (CORROBORATIONS as readonly string[]).includes(v);
  }

  /**
   * Which declared surfaces the observed host CORROBORATES. Total over
   * `ActorClass` so a sixth class is a TS2739 here rather than a silent
   * `undefined.includes`.
   *
   * `supervisor` and `unknown` map to the empty list, and the two empties are
   * not the same statement: `unknown` is unreachable (rung 3 of the ladder
   * catches it first, and the ladder's own test pins that), while `supervisor`
   * is genuinely reachable and genuinely disagrees with every declaration — the
   * supervisor passes no flags, so a declaration arriving from
   * `claude-session@<id>.service` is a fact worth showing an operator.
   */
  const DEC_CORROBORATES: Record<ActorClass, readonly DecSurface[]> = {
    agent: ['pwa', 'agent'],   // PWA -> server -> agent -> ccd, and the agent itself
    pane: ['cli'],             // a session shelling ccd from its own Bash tool
    login: ['cli'],            // a human at an ssh shell
    supervisor: [],
    unknown: [],
  };

  /**
   * The ONE function permitted to relate the `obs` and `dec` families (D2).
   * PURE, and deliberately clock-free — inputs only, no `fs`, no timers — for
   * the reasons `sessionLifecycle` states at :1242.
   *
   * THE PARAMETER NAMES ARE THE SEAM SPELLING and are load-bearing: callers hand
   * it `obsClass` / `decSurface` (`ProvenancePair`), which are the same two
   * facts the wire spells `obs.cg` / `dec.surface`. Both arguments must be
   * NARROWED, never cast: `isActorClass` and `isDecSurface` are the only doors,
   * and a value that passes neither is not a disagreement — it is a value this
   * build cannot model, which a caller drops rather than reports.
   *
   * IT REPORTS, IT NEVER DECIDES. A `disagrees` raises
   * `divergence.provenance-mismatch` for a human to read; it refuses nothing and
   * picks no winner. ccd cannot authenticate a caller on a single-uid box and
   * this does not pretend to — "a disagreement is a fact the operator sees,
   * never a silently picked winner".
   *
   * The ladder's ORDER is the design. Each rung exists because collapsing it
   * into the table below would turn "we cannot compare these" into "you lied":
   *   1. no observation at all       -> unmeasured
   *   2. no declaration at all       -> unmeasured
   *   3. a word one side cannot name -> not-comparable
   *   4. `ccd` names a LAYER, not a host (ccd re-entering itself: `cmd_swap`'s
   *      `|| cmd_ensure "$id"` fallback at `ccd:9548`, `cmd_enable`'s
   *      `cmd_start "$@"` at `ccd:9587`), so it corroborates nothing about who
   *      was at the keyboard
   *                                  -> not-comparable
   *   5. the table                   -> agrees | disagrees
   */
  export function corroboration(obsClass: ActorClass | null, decSurface: DecSurface): Corroboration {
    if (obsClass === null) return 'unmeasured';
    if (decSurface === 'none') return 'unmeasured';
    if (obsClass === 'unknown' || decSurface === 'unknown') return 'not-comparable';
    if (decSurface === 'ccd') return 'not-comparable';
    return DEC_CORROBORATES[obsClass].includes(decSurface) ? 'agrees' : 'disagrees';
  }
  ```
- [ ] **Step 4: Run it and watch it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/corroboration.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  25 passed`.
- [ ] **Step 5: Measure mutant 1 of 4 — collapse rung 4.**
  Delete `if (decSurface === 'ccd') return 'not-comparable';`, run the Step 4 command, revert.
  Mutant: delete rung 4 -> `rung 4 … supervisor + ccd` fails with
  `expected 'disagrees' to be 'not-comparable'` (and `pane + ccd`, `login + ccd` with it).
- [ ] **Step 6: Measure mutant 2 of 4 — collapse rung 3.**
  Delete `if (obsClass === 'unknown' || decSurface === 'unknown') return 'not-comparable';`, run the
  Step 4 command, revert.
  Mutant: delete rung 3 -> `an unclassifiable cgroup cannot disagree with anything` fails with
  `expected 'disagrees' to be 'not-comparable'`.
- [ ] **Step 7: Measure mutant 3 of 4 — overload the null.**
  Widen rung 1 to `if (obsClass === null || obsClass === 'unknown') return 'unmeasured';`, run the
  Step 4 command, revert.
  Mutant: fold "unobserved" and "observed-but-unclassifiable" into one value -> `rung 3` fails with
  `expected 'unmeasured' to be 'not-comparable'`. This is the collapse the "no overloaded null at a
  seam" rule forbids, and it is why rungs 1 and 3 are separate.
- [ ] **Step 8: Measure mutant 4 of 4 — widen the agreement table.**
  Add `'pwa'` to `pane` in `DEC_CORROBORATES`, run the Step 4 command, revert.
  Mutant: a pane may claim to be the PWA -> `disagrees where it does not` fails with
  `expected 'agrees' to be 'disagrees'`.
- [ ] **Step 9: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add shared/api.ts server/test/corroboration.test.ts \
    && git commit -m "feat(shared): ActorClass, DecSurface and the pure corroboration() ladder (build 9 W1)

  The one function D2 permits to relate the kernel-observed and declared
  identity families. Pure and clock-free, the sessionLifecycle precedent. It
  REPORTS and never decides: a \`disagrees\` raises a divergence for a human,
  it refuses nothing.

  Four rungs above the agreement table, each with its own mutant test, because
  collapsing any of them turns 'we cannot compare these' into 'you lied':
  obs null (unobserved) and obs 'unknown' (observed, unclassifiable) are two
  conditions and stay two values; \`ccd\` as a declared surface names a layer,
  not a host, so it corroborates nothing.

  The two spellings are written down once, in ActorClass's docstring: the wire
  says obs.cg / dec.surface, the derived pair crossing L1/L3 says obsClass /
  decSurface, and corroboration()'s parameter names are the seam spelling.
  Both arguments must be narrowed by isActorClass/isDecSurface, never cast.

  StopSurface is unchanged — DecSurface adds only the journal-only 'none',
  and isDecSurface derives from isStopSurface rather than restating its list.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 4: The wire shapes — `LifecycleObs` / `LifecycleDec` / `LifecycleMeas` / `LifecycleEvent`, and the mirror's `MirroredLifecycleEvent`

Three sibling families that never merge (D2, operator ruling R3): three objects on the wire, three
column families in the mirror, three panes in the PWA. **Nothing computes a single "who".**

**Files:**
- Create: `server/test/lifecycle-wire.test.ts`
- Modify: `shared/api.ts` — append immediately after Task 3's block (end of file).

**Interfaces:**
- Consumes: `LifecycleAct`, `LifecycleOutcome` (Task 2); `ActorClass`, `DecSurface`, `corroboration`
  (Task 3).
- Produces: `LifecycleObs`, `LifecycleDec`, `LifecycleMeas`, `LifecycleEvent`,
  `MirroredLifecycleEvent` — full field lists in Step 3.
  `LifecycleEvent` is the **journal-line** shape: `uid at act badact outcome badoutcome id tx verb
  refusal detail truncated obs dec meas raw` (16 fields). It has **no `gen` and no `ingestedAt`** —
  those are the mirror's own facts and live on `MirroredLifecycleEvent`, which extends it. The
  subject session is spelled **`id`**, never `sessionId`; the refusal field is **`refusal`**, never
  `refused`.
- **Deliberately produces no `reviveLifecycleEvent`.** Parsing a journal line is `parseJournalLine`
  in `server/src/coord/journalparse.ts` (L1, wave 4), which D8 requires to be pure and total. L0
  declares the shapes only.

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-wire.test.ts`:
  ```ts
  // The three identity families as they travel, and the ONE assertion that
  // matters about them: they never merge. Three objects, three nullabilities,
  // nothing that computes a single "who" (D2 / operator ruling R3).
  //
  // TWO INDEPENDENT MECHANISMS, because an interface cannot be red at runtime.
  // The literals below are typed `LifecycleEvent` etc., so a field ADDED to an
  // interface makes the literal missing a property (TS2739) and a field REMOVED
  // makes it an excess property (TS2353) — caught by `typecheck-tests.test.ts`,
  // which compiles this directory. The `Object.keys` assertions then pin the
  // intended shape at runtime, so a reviewer reading only the test still sees
  // the whole field list.
  import { describe, it, expect } from 'vitest';
  import type {
    LifecycleObs, LifecycleDec, LifecycleMeas, LifecycleEvent, MirroredLifecycleEvent,
  } from '../../shared/api.js';
  import { corroboration, isLifecycleAct, isLifecycleOutcome } from '../../shared/api.js';

  const LINE =
    '{"v":1,"uid":"1755000000123456789.4242.1","atNs":"1755000000123456789",'
    + '"at":1755000000,"act":"destroy","outcome":"intent","id":"ccrc-pwa-still-river"}';

  const OBS: LifecycleObs = {
    cg: 'pane', cgraw: '0::/app.slice/tmux-spawn-72be9ee2.scope',
    pid: 4242, ppid: 4100, pane: 'ccrc-pwa-still-river', paneWhy: 'matched',
    tty: false, ssh: null,
  };
  const DEC: LifecycleDec = { surface: 'cli', actor: 'still-river', reason: 'wave 3 cleanup' };
  const MEAS: LifecycleMeas = {
    project: 'ccrc-pwa', workspace: 'still-river', branch: 'ws/still-river',
    uuid: '72be9ee2-0000-4bcc-b60b-0cfc0dc3d199', wrapper: 'claude-corp',
    tip: 'a'.repeat(40), attic: 201, archivedAt: null, archivedReason: null, held: null,
  };
  const EVENT: LifecycleEvent = {
    uid: '1755000000123456789.4242.1', at: 1_755_000_000_123,
    act: 'destroy', badact: null, outcome: 'intent', badoutcome: null,
    id: 'ccrc-pwa-still-river', tx: '1755000000123456789.4242.1',
    verb: 'ws-rm', refusal: null, detail: null, truncated: false,
    obs: OBS, dec: DEC, meas: MEAS, raw: LINE,
  };
  const MIRRORED: MirroredLifecycleEvent = {
    ...EVENT, gen: '1755000000123456789', ingestedAt: 1_755_000_000_456,
  };

  describe('LifecycleObs — kernel-observed, unforgeable by env', () => {
    it('carries exactly D2`s eight fields', () => {
      expect(Object.keys(OBS).sort()).toEqual(
        ['cg', 'cgraw', 'paneWhy', 'pane', 'pid', 'ppid', 'ssh', 'tty'].sort());
    });

    it('keeps the raw cgroup path even when the class is unknown — never dropped', () => {
      const weird: LifecycleObs = { ...OBS, cg: 'unknown', cgraw: '0::/some.slice/new-shape.scope' };
      expect(weird.cgraw).toBe('0::/some.slice/new-shape.scope');
      // A fifth cgroup shape this build cannot name is still recoverable from
      // the record, which is what makes the mirror a re-measurement (D8).
    });

    it('tells an unread cgroup from an unclassifiable one', () => {
      const unread: LifecycleObs = { ...OBS, cg: null, cgraw: null };
      expect(corroboration(unread.cg, 'cli')).toBe('unmeasured');
      expect(corroboration('unknown', 'cli')).toBe('not-comparable');
    });
  });

  describe('LifecycleDec — declared, self-asserted', () => {
    it('carries exactly D2`s three fields', () => {
      expect(Object.keys(DEC).sort()).toEqual(['actor', 'reason', 'surface']);
    });

    it('says `none` when no flag was passed — not a default laundered into a claim', () => {
      const silent: LifecycleDec = { surface: 'none', actor: null, reason: null };
      expect(corroboration('pane', silent.surface)).toBe('unmeasured');
    });
  });

  describe('LifecycleMeas — measured about the SUBJECT, before any destruction', () => {
    it('carries exactly D2`s ten fields', () => {
      expect(Object.keys(MEAS).sort()).toEqual(
        ['archivedAt', 'archivedReason', 'attic', 'branch', 'held', 'project',
         'tip', 'uuid', 'workspace', 'wrapper'].sort());
    });

    it('every field is nullable — null means NOT MEASURED, never zero or empty', () => {
      const nothing: LifecycleMeas = {
        project: null, workspace: null, branch: null, uuid: null, wrapper: null,
        tip: null, attic: null, archivedAt: null, archivedReason: null, held: null,
      };
      expect(Object.values(nothing).every((v) => v === null)).toBe(true);
      // `attic: 0` is "the pin ran and created no refs"; `attic: null` is "no
      // pin was taken". `archivedReason: ''` would be a reason that is blank;
      // null is a row that was never archived. Different facts, different values.
    });

    it('is a CLOSED ten, and a `meas.*` key it does not model lives on in `raw`', () => {
      // The ruling this wave makes for waves 2-4, in one place. ccd writes more
      // `meas.<key>` pairs than these ten (`atticsrc`, `workdir`, `base`, `rc`,
      // `mode`, `from`, `to`, `dropped`, `registered`, `bytes`, `state`, ...).
      // They are NOT silently widened into this interface and they are NOT lost:
      // `LifecycleEvent.raw` holds the line verbatim on every path, so an
      // unmodelled key is re-projectable later without touching the fleet box —
      // exactly the argument `obs.cgraw` already makes. Promoting one is a
      // two-line edit HERE plus its reader; inventing it in journalparse.ts is
      // not.
      expect(Object.keys(MEAS)).not.toContain('atticsrc');
      expect(EVENT.raw.length, 'raw is what makes the closed ten affordable').toBeGreaterThan(0);
    });
  });

  describe('LifecycleEvent — the line', () => {
    it('carries exactly the sixteen fields, and the three families are three fields', () => {
      expect(Object.keys(EVENT).sort()).toEqual(
        ['act', 'at', 'badact', 'badoutcome', 'dec', 'detail', 'id', 'meas', 'obs',
         'outcome', 'raw', 'refusal', 'truncated', 'tx', 'uid', 'verb'].sort());
      // The assertion R3 is actually about: no `who`, no `actorResolved`, no
      // `identity`. Nothing merges the three.
      for (const banned of ['who', 'actor', 'identity', 'actorResolved', 'addressable']) {
        expect(Object.keys(EVENT), banned).not.toContain(banned);
      }
    });

    it('spells the refusal field `refusal` and NEVER `refused`', () => {
      // D15's ruling. `server/test/wsaudit.test.ts:57` scans ccd's TEXT with
      // /"refused":"([a-zA-Z0-9-]+)"/ and holds the result set-equal to
      // wsaudit.ts`s SENTENCES in both directions. An emitter whose format
      // string read `"refused":"%s"` would poison that scan; naming the field
      // here is the L0 half of keeping it green with no edit.
      expect(Object.keys(EVENT)).toContain('refusal');
      expect(Object.keys(EVENT)).not.toContain('refused');
    });

    it('degrades an unmodellable act AND an unmodellable outcome, keeping both tokens (D6)', () => {
      const line = '{"act":"quarantine","outcome":"observed"}';
      const degraded: LifecycleEvent = {
        ...EVENT, act: 'unknown', badact: 'quarantine',
        outcome: 'unknown', badoutcome: 'observed',
        obs: null, dec: null, meas: null, raw: line,
      };
      expect(isLifecycleAct(degraded.act)).toBe(true);
      expect(degraded.badact).toBe('quarantine');
      expect(degraded.badoutcome).toBe('observed');
      expect(degraded.raw).toBe(line);
      // Three different facts, three different fields: what we could model,
      // what we could not, and the bytes we saw. A byte we saw and could not
      // model is a different fact from a byte that was never there — and both
      // halves of the vocabulary get the same treatment, so `badoutcome` is not
      // an afterthought a reader has to go to `raw` for.
    });

    it('a modelled act carries NULL bad-tokens — a token and its degrade cannot both be set', () => {
      expect(EVENT.badact).toBeNull();
      expect(EVENT.badoutcome).toBeNull();
      expect(isLifecycleAct(EVENT.act) && isLifecycleOutcome(EVENT.outcome)).toBe(true);
    });

    it('`truncated` is a MODELLED fact, so a dropped field is not a silence', () => {
      // The emitter drops `dec.reason`, then `obs.cgraw`, then `meas` when a
      // line would exceed LC_LINE_MAX, and says so. Without this field a
      // `meas: null` from truncation and a `meas: null` from "nothing was
      // measured" are one value for two conditions a reader handles
      // differently — the overloaded-null defect, at the seam that exists to
      // record what happened.
      const cut: LifecycleEvent = { ...EVENT, truncated: true, meas: null };
      expect(cut.truncated).toBe(true);
      expect(EVENT.truncated, 'absent on the wire reads as false, never undefined').toBe(false);
    });

    it('uid and at are NULLABLE, raw is NOT — an unparseable line is still a row', () => {
      // A line the parser could not read has no uid and no clock, and it is
      // still ingested (D8): dropping it would make "we saw bytes we could not
      // model" indistinguishable from "there were no bytes". `raw` is therefore
      // present on EVERY path — which is also what makes wave 4's replay drill
      // byte equality rather than resemblance.
      const unparseable: LifecycleEvent = {
        ...EVENT, uid: null, at: null, act: 'unknown', badact: null,
        outcome: 'unknown', badoutcome: null, id: null, tx: null, verb: null,
        refusal: null, detail: null, obs: null, dec: null, meas: null,
        raw: '{"act":"destroy",',
      };
      expect(unparseable.uid).toBeNull();
      expect(unparseable.at).toBeNull();
      expect(unparseable.raw).toBe('{"act":"destroy",');
      expect(typeof EVENT.raw).toBe('string');
    });
  });

  describe('MirroredLifecycleEvent — the mirror`s own two facts, kept off the line', () => {
    it('is the line PLUS `gen` and `ingestedAt`, and the line has neither', () => {
      expect(Object.keys(MIRRORED).sort())
        .toEqual([...Object.keys(EVENT), 'gen', 'ingestedAt'].sort());
      expect(Object.keys(EVENT)).not.toContain('gen');
      expect(Object.keys(EVENT)).not.toContain('ingestedAt');
    });

    it('every mirrored event IS a LifecycleEvent — the extension is one-way', () => {
      const asLine: LifecycleEvent = MIRRORED;   // widening compiles
      expect(asLine.uid).toBe(EVENT.uid);
      // And the reverse does not: `const back: MirroredLifecycleEvent = EVENT;`
      // is TS2739. `gen` is which generation FILE the line was read from and
      // `ingestedAt` is the SERVER's clock; neither is a fact about the act, so
      // neither may travel as one. The replay drill's byte equality excludes
      // exactly `ingestedAt` for this reason.
      expect(MIRRORED.gen).toBe('1755000000123456789');
      expect(MIRRORED.ingestedAt).not.toBe(MIRRORED.at);
    });
  });
  ```
- [ ] **Step 2: Run the typechecker and watch it fail.** The interfaces are types, so `vitest` alone
  would erase the imports and pass vacuously — **the red measurement for this task is the
  typechecker**:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && node ./node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
  ```
  Expected failure text (five errors, one per missing type):
  `test/lifecycle-wire.test.ts(…): error TS2305: Module '"../../shared/api.js"' has no exported member 'LifecycleObs'.`
  …and the same `TS2305` for `LifecycleDec`, `LifecycleMeas`, `LifecycleEvent`,
  `MirroredLifecycleEvent`.
- [ ] **Step 3: Write the minimal implementation.** Append to `shared/api.ts`, after Task 3's block:
  ```ts

  /**
   * D2 — kernel-observed. Unforgeable by env: read from `/proc`, not from
   * argv or the environment. A double fork makes a caller ANONYMOUS
   * (`ppid 1`), never someone else.
   */
  export interface LifecycleObs {
    /** The `0::` path, classified. `null` = no cgroup was read at all;
     *  `'unknown'` = it was read and matched none of the four shapes. The seam
     *  spelling of this same fact is `obsClass` — see `ActorClass`'s docstring. */
    readonly cg: ActorClass | null;
    /** The `0::` path VERBATIM, and it is never dropped even when `cg` names it.
     *  A fifth cgroup shape a later build learns to classify is re-projectable
     *  from this without touching the fleet box — which is what makes the mirror
     *  a re-measurement rather than an authority (D8). */
    readonly cgraw: string | null;
    readonly pid: number | null;
    /** From `/proc/<pid>/status`'s `PPid:` line, NEVER `stat` field 4 — `comm`
     *  can contain spaces, so field-4 parsing is wrong for any process whose
     *  name has one. */
    readonly ppid: number | null;
    /** The tmux `session_name` owning an ancestor pid, from
     *  `tmux list-panes -a -F '#{session_name} #{pane_pid}'` intersected with
     *  the ppid ancestry. `null` when no pane owns this process. */
    readonly pane: string | null;
    /** ccd's own word for HOW the `pane` answer was reached, so a null `pane` is
     *  not overloaded across "no ancestor is a pane", "tmux did not answer" and
     *  "the caller double-forked itself anonymous". DISPLAY-ONLY — nothing
     *  parses it back, exactly as `Divergence.detail` (:1128). */
    readonly paneWhy: string | null;
    /** `[[ -t 0 ]]` — a human was at a terminal. */
    readonly tty: boolean | null;
    /** `$SSH_CONNECTION` verbatim, or null. Environment, so self-asserted in
     *  principle; kept in `obs` because it is read the same way and at the same
     *  moment as the rest, and `corroboration()` does not consult it. */
    readonly ssh: string | null;
  }

  /**
   * D2 — declared. SELF-ASSERTED, and the wire says so by keeping it in its own
   * object: `--surface pwa` means only that the caller said so
   * (`ccd:610-617`'s own words about the same field).
   */
  export interface LifecycleDec {
    /** `'none'` when NO flag was passed. ccd's internal defaults — `cmd_stop`'s
     *  `cli` (`ccd:9607`), `_ws_unsupervise`'s `ccd` (`ccd:618`) — must never
     *  reach this field. Seam spelling: `decSurface`. */
    readonly surface: DecSurface;
    /** `--actor`, free text, or null. Attribution, not authentication. */
    readonly actor: string | null;
    /** `--reason`, <= `LC_REASON_MAX_BYTES` BYTES, or null — and ccd REFUSES a
     *  longer one rather than truncating it, because a 900-byte reason recorded
     *  as 512 reads as the operator's own words. Written verbatim, PARSED
     *  NOWHERE — `cmd_ws_hold`'s standing rule for the same kind of value
     *  (`ccd:2515-2516`). It is free text off the wire, so it must never reach
     *  an arithmetic context, an array subscript, an `eval` or an unquoted
     *  expansion: `ccd:8781-8790` is the paid lesson. */
    readonly reason: string | null;
  }

  /**
   * D2 — measured about the SUBJECT, read BEFORE any destruction. Every field is
   * nullable and `null` MEANS NOT MEASURED — never zero, never empty string.
   * `attic: 0` is a pin that ran and created no refs; `attic: null` is a pin
   * that was never taken. `archivedReason: ''` is a blank reason;
   * `archivedReason: null` is a row that was never archived.
   *
   * THIS TEN IS CLOSED, AND THAT IS A RULING, NOT AN OVERSIGHT. ccd writes more
   * `meas.<key>` pairs than these — `atticsrc`, `workdir`, `base`, `old`, `new`,
   * `rc`, `mode`, `inUnit`, `from`, `to`, `prev`, `dropped`, `was`, `registered`,
   * `manifestBytes`, `bytes`, `resumed`, `tombstone`, `state`, `path`, `slug` —
   * and none of them is silently widened into this interface, nor lost:
   * `LifecycleEvent.raw` carries the line verbatim on EVERY path, so an
   * unmodelled key is re-projectable later without touching the fleet box. That
   * is the same argument `obs.cgraw` makes, and it is what keeps the modelled
   * shape a decision rather than an accumulation. Promoting a key is a two-line
   * edit here plus its reader; minting it in `journalparse.ts` is not.
   */
  export interface LifecycleMeas {
    readonly project: string | null;
    readonly workspace: string | null;
    readonly branch: string | null;
    readonly uuid: string | null;
    readonly wrapper: string | null;
    /** The tip commit as resolved before the act. */
    readonly tip: string | null;
    /** How many `refs/ccrc/attic/<id>/` refs `_ws_attic_pin` created. */
    readonly attic: number | null;
    /** Epoch SECONDS as `_reg_set "$id" archived "$(date +%s)"` wrote it
     *  (`ccd:2753`) — the registry's own unit, carried unconverted so the record
     *  is what the file said. */
    readonly archivedAt: number | null;
    /** `merged:#N | empty | manual` as `ccd:2754` wrote it, or null when the row
     *  carries no reason. Not proven present by any guard — absent is a
     *  legitimate state. */
    readonly archivedReason: string | null;
    /** The `.hold` text, verbatim, or null. */
    readonly held: string | null;
  }

  /**
   * One journal line. NDJSON, UTF-8, LF-terminated, <= `LC_LINE_MAX` bytes, one
   * `printf '%s\n' "$line" >> "$f"` per event — an `O_APPEND` write to a regular
   * file on Linux is serialised under the inode lock, so concurrent writers
   * cannot interleave. The precedent is measured, not assumed: `$REG/swap.log`,
   * 13 concurrent write sites over 49 days, zero corruption.
   *
   * THE THREE IDENTITY FAMILIES ARE THREE FIELDS AND THEY NEVER MERGE (operator
   * ruling R3). There is no `who`. `corroboration(obs.cg, dec.surface)` is the
   * only sanctioned relation between two of them, and it reports rather than
   * resolves.
   *
   * THIS IS THE LINE, NOT THE ROW. `gen` and `ingestedAt` are the MIRROR's own
   * facts and live on `MirroredLifecycleEvent` below; no ccd emit carries
   * either. Two wire fields ccd writes are deliberately NOT modelled here and
   * are read by `parseJournalLine` without being carried: `v` (the envelope's
   * version — the wire is additive-only, so a version is not a fact about the
   * act) and `atNs` (the same clock read `uid`'s prefix already holds). Both
   * survive in `raw`.
   *
   * There is no `reviveLifecycleEvent` here on purpose: parsing a line is
   * `parseJournalLine` in `server/src/coord/journalparse.ts`, which D8 requires
   * to be PURE and TOTAL (no clock, no lookup, no registry, no other row) —
   * that is what makes `lifecycle_events` a re-measurement rather than an
   * authority, and what makes replay from offset 0 idempotent.
   */
  export interface LifecycleEvent {
    /** `<epochNs>.<BASHPID>.<seq>` — INTRINSIC, not positional (D6). `UNIQUE`
     *  in the mirror, inserted `OR IGNORE`, so re-reading a generation from
     *  offset 0 is always no-op-or-catch-up and a truncation is recoverable
     *  rather than fatal. Positional identity (`gen`,`startOffset`) was
     *  rejected: it is not a function of the bytes when the consumer does not
     *  own the tail's offset, and a shifted offset silently collides.
     *
     *  NULL WHEN THE LINE CARRIED NO PARSEABLE UID — an unparseable or
     *  cut-short line is still ingested (`raw` below), and a row with no uid is
     *  simply not deduplicable, so a replay may re-insert it. That is the
     *  honest cost: MINTING a uid the bytes did not contain would fabricate
     *  identity, which is worse than a duplicate a reader can see. */
    readonly uid: string | null;
    /** Epoch MILLISECONDS, ccd's clock. Derived from the SAME clock read as
     *  `uid`'s nanosecond prefix, so the two can never disagree about one event.
     *  Never the server's clock: `MirroredLifecycleEvent.ingestedAt` is the
     *  separate, explicitly server-owned fact and is never read as an event
     *  time. Null when the line carried no readable clock. */
    readonly at: number | null;
    readonly act: LifecycleAct;
    /** The act token ccd wrote when this build cannot name it; null whenever
     *  `act` is not `LC_ACT_UNKNOWN`. The two are never both set. */
    readonly badact: string | null;
    readonly outcome: LifecycleOutcome;
    /** `badact`'s twin on the outcome side; null whenever `outcome` is not
     *  `LC_OUTCOME_UNKNOWN`. Both halves of the vocabulary degrade the same way
     *  and keep the token, so neither sends a reader to `raw` for it. */
    readonly badoutcome: string | null;
    /** The SUBJECT session id, or null for an act about no single row. Spelled
     *  `id` here and on every seam; the mirror's COLUMN is `sessionId`, which is
     *  the one sanctioned rename and is `JournalRow`'s business, not this
     *  type's. */
    readonly id: string | null;
    /** Pairs an `intent` with its outcome (D4). Null for a single-shot act. An
     *  intent with no sibling at all is a process that died mid-destroy —
     *  DERIVED BY THE READER over the pair, never stored as an outcome. */
    readonly tx: string | null;
    /** The ccd verb that ran (`ws-rm`, `ws-gc`, `forget`, ...). */
    readonly verb: string | null;
    /** The refusal token when `outcome === 'refused'`.
     *
     *  SPELLED `refusal`, NEVER `refused`, AND THAT IS LOAD-BEARING (D15).
     *  `server/test/wsaudit.test.ts:57` greps ccd's raw text — comments included
     *  — with /"refused":"([a-zA-Z0-9-]+)"/ and holds the result set-equal in
     *  both directions to `wsaudit.ts`'s SENTENCES. An emitter whose format
     *  string spelled `"refused":"%s"` would inject tokens into that scan and
     *  red it; that suite must stay green WITH NO EDIT, which is itself an
     *  assertion of this program. Journal-only tokens get their word from
     *  `LC_REFUSAL_WORD` below instead. */
    readonly refusal: string | null;
    /** One line for a person. DISPLAY-ONLY — nothing parses it back. */
    readonly detail: string | null;
    /** The emitter hit `LC_LINE_MAX` and dropped fields to fit — `dec.reason`,
     *  then `obs.cgraw`, then `meas`, in that order. FALSE when the wire says
     *  nothing, because absence-permits.
     *
     *  MODELLED RATHER THAN INFERRED, and that is the point: without it a
     *  `meas: null` from truncation and a `meas: null` from "nothing was
     *  measured" would be one value for two conditions a reader handles
     *  differently. `refusal` and `detail` are never in the drop set — a refusal
     *  whose token was dropped would be an untyped refusal. */
    readonly truncated: boolean;
    readonly obs: LifecycleObs | null;
    readonly dec: LifecycleDec | null;
    readonly meas: LifecycleMeas | null;
    /** The line VERBATIM, on EVERY path — parsed, degraded and unparseable
     *  alike. A byte we saw and could not model is a different fact from a byte
     *  that was never there; keeping all of them is what makes wave 4's replay
     *  drill byte EQUALITY rather than resemblance, and what lets an unmodelled
     *  `meas.*` key or a future wire field be re-projected without touching the
     *  fleet box. */
    readonly raw: string;
  }

  /**
   * A journal line AS THE MIRROR HOLDS IT.
   *
   * `gen` (which generation FILE it was read from) and `ingestedAt` (the
   * SERVER's clock, at insert) are facts about the READING, not about the act —
   * no ccd emit carries either, and neither may travel as though it did. They
   * live here so `LifecycleEvent` stays exactly what a line says, and so the
   * replay drill can exclude `ingestedAt` by name and still compare everything
   * else byte for byte.
   *
   * One-way: every `MirroredLifecycleEvent` IS a `LifecycleEvent`; the reverse
   * is a TS2739, which is the compile error that stops a reader inventing a
   * generation for a line that came off the wire.
   */
  export interface MirroredLifecycleEvent extends LifecycleEvent {
    /** The generation's epoch-nanosecond digits — `parseLifecycleGeneration`'s
     *  answer for the file this line was read from. */
    readonly gen: string;
    /** Epoch milliseconds, the SERVER's clock, at insert. Never an event time. */
    readonly ingestedAt: number;
  }
  ```
- [ ] **Step 4: Run the typechecker and watch it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && node ./node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
  ```
  Expect **no output and exit 0**.
- [ ] **Step 5: Run the runtime half and watch it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-wire.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  16 passed`.
- [ ] **Step 6: Measure mutant 1 of 5 — the `refused` spelling.**
  Rename `refusal` to `refused` in `LifecycleEvent`, run Steps 4 and 5, revert.
  Mutant: rename the field -> `tsc` reds with
  `error TS2353: Object literal may only specify known properties, and 'refusal' does not exist in type 'LifecycleEvent'`,
  and after fixing the literal `spells the refusal field 'refusal' and NEVER 'refused'` fails with
  `expected [ 'act', 'at', … ] to include 'refusal'`.
- [ ] **Step 7: Measure mutant 2 of 5 — a merged "who".**
  Add `readonly who: string | null;` to `LifecycleEvent`, run Step 4, then add `who: null` to both
  literals and run Step 5, revert both edits.
  Mutant: merge the three families into one field -> `tsc` reds with
  `error TS2739: Type '{ … }' is missing the following properties from type 'LifecycleEvent': who`,
  and once the literals are fixed `the three families are three fields` fails with
  `expected [ … ] not to contain 'who'`. **This is the mutant that matters** — R3's whole ruling is
  that nothing computes a single "who".
- [ ] **Step 8: Measure mutant 3 of 5 — a mirror fact on the line.**
  Move `readonly gen: string;` from `MirroredLifecycleEvent` up into `LifecycleEvent`, run Steps 4
  and 5, revert.
  Mutant: put the reading's fact on the act -> `tsc` reds with `TS2739 … 'gen'` on the `EVENT`
  literal, and once fixed `is the line PLUS 'gen' and 'ingestedAt'` fails with
  `expected [ …, 'gen', … ] not to contain 'gen'`.
- [ ] **Step 9: Measure mutant 4 of 5 — `raw` made optional again.**
  Change `readonly raw: string;` to `readonly raw: string | null;` and set `raw: null` in `EVENT`,
  run Step 5, revert.
  Mutant: let a parsed line drop its bytes -> `is a CLOSED ten, and a 'meas.*' key it does not model
  lives on in 'raw'` fails with `TypeError: Cannot read properties of null (reading 'length')`, and
  `uid and at are NULLABLE, raw is NOT` fails with `expected 'object' to be 'string'`.
- [ ] **Step 10: Measure mutant 5 of 5 — a non-nullable measurement.**
  Change `readonly attic: number | null;` to `readonly attic: number;`, run Step 4, revert.
  Mutant: make a measurement mandatory -> `tsc` reds on the all-null `LifecycleMeas` literal with
  `error TS2322: Type 'null' is not assignable to type 'number'`.
- [ ] **Step 11: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add shared/api.ts server/test/lifecycle-wire.test.ts \
    && git commit -m "feat(shared): LifecycleObs/Dec/Meas/Event — the three families that never merge (build 9 W1)

  D2 / operator ruling R3: kernel-observed, declared and measured are three
  objects on the wire with three trust levels, and nothing computes a single
  'who'. The test asserts the absence of one by name.

  Every meas field is nullable and null means NOT MEASURED — attic 0 is a pin
  that created no refs, attic null is a pin never taken. The ten are CLOSED:
  ccd writes more meas keys than these, and raw (verbatim, on every path) is
  what makes not modelling them lossless rather than lossy — obs.cgraw's own
  argument. uid and at are nullable because an unparseable line is still a
  row; minting a uid the bytes did not carry would fabricate identity.

  badoutcome mirrors badact and truncated is modelled, not inferred: without
  it a meas:null from a dropped field and a meas:null from nothing measured
  are one value for two conditions a reader handles differently.

  gen and ingestedAt are the MIRROR's facts and live on
  MirroredLifecycleEvent, which extends the line one-way, so the replay drill
  can exclude ingestedAt by name and compare the rest byte for byte.

  The refusal field is spelled 'refusal' and never 'refused' (D15): wsaudit
  .test.ts greps ccd's raw text for the latter and must stay green with no
  edit. No reviveLifecycleEvent — parsing is journalparse.ts (L1, wave 4),
  which D8 requires pure and total.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 5: `LC_REFUSAL_WORD` — the journal-only refusal words, disjoint from `SENTENCES`

**Files:**
- Create: `server/test/lifecycle-refusal-word.test.ts`
- Modify: `shared/api.ts` — append immediately after Task 4's block (end of file).

**Interfaces:**
- Consumes: nothing in L0. The test consumes `SENTENCES` and `refusalSentence` from
  `server/src/wsaudit.ts` (`export const SENTENCES: Record<string, string>` at `:17`,
  `export function refusalSentence` at `:183`) — an L3 read from an L4 test, which is fine;
  **nothing in `shared/` may import it**.
- Produces:
  ```ts
  export type LcRefusalToken =
    | 'scratch-unwritable' | 'tip-unreadable' | 'bad-session-id'
    | 'flock-unavailable' | 'lock-unopenable' | 'is-a-workspace'
    | 'session-live' | 'session-verdict-unknown' | 'spawn-failed';
  export const LC_REFUSAL_WORD: Record<LcRefusalToken, string>;   // EXPORTED DIRECTLY
  export const LC_REFUSAL_TOKENS: readonly LcRefusalToken[];      // derived from it
  export function isLcRefusalToken(v: unknown): v is LcRefusalToken;
  export function lcRefusalWord(token: string): string | null;
  ```
  `LC_REFUSAL_WORD` is declared **once and exported**, with no module-private `…_MAP` twin: it is a
  RENDERING map, not a narrowing map, and `isLcRefusalToken` is the narrowing door. `SENTENCES`
  (`wsaudit.ts:17`) is the precedent and it is exported directly for the same reason.
  `lcRefusalWord` returns **null for a token this map does not hold**, and that null is a POSITIVE
  answer meaning "ask `refusalSentence()` instead" — never an error. The PWA composes
  `lcRefusalWord(t) ?? refusalSentence(t)` in wave 9.

**Measured input this task rests on** (re-run today, both directions): `wsaudit.test.ts`'s four
regexes over `ccd/ccd` yield **54 tokens**, `SENTENCES` holds exactly **54** keys, and it is held
set-equal to them. None of the nine tokens above is among the 54.

**The contract, and WHO ENFORCES IT.** Every token wave 3 passes to `_lc_refuse` / `_lc_fail` must be
a member of `LC_REFUSAL_TOKENS` **or** already a `SENTENCES` key. Wave 1 ships the forward map and
the disjointness guard; the both-directions enforcement is **wave 3's cross-language scan over
`ccd/ccd`** (its refusal-scan task), which already reads that file and asserts every token literal it
passes to `_lc_refuse`/`_lc_fail` is a member of `LC_REFUSAL_TOKENS ∪ Object.keys(SENTENCES)` with a
coverage floor. It cannot be written here, because it would be red until wave 3 lands. If wave 3
needs a tenth token, adding it is a two-line edit (union member + map entry) and
`Record<LcRefusalToken, string>` makes forgetting the word a TS2739.

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-refusal-word.test.ts`:
  ```ts
  // The journal's own refusal copy, and the ONE property that keeps it from
  // becoming a second, drifting copy of `wsaudit.ts`'s SENTENCES: the two maps
  // are DISJOINT. A token with a word in both is exactly the shape the
  // `branch-drift` -> `registry-branch-drift` incident left behind.
  //
  // Why two maps at all, rather than widening SENTENCES: `wsaudit.test.ts` holds
  // SENTENCES set-equal in BOTH directions to tokens grepped from ccd's source
  // by four regexes (`wsaudit.test.ts:57-60`), and a `_lc_refuse` call changes
  // no stdout and no exit contract — it produces no `verdict`/`refused` JSON for
  // those regexes to see. A SENTENCES entry for a journal-only token would
  // therefore red that test's stale-copy direction, and the only fixes would be
  // deleting copy or weakening an approved mechanism (`ccd:2121-2128` records
  // the same argument being had once already). D15 rules it: no SENTENCES entry;
  // journal-only tokens get their word here.
  import { describe, it, expect } from 'vitest';
  import {
    LC_REFUSAL_TOKENS, LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord,
    type LcRefusalToken,
  } from '../../shared/api.js';
  import { SENTENCES, refusalSentence } from '../src/wsaudit.js';

  const ALL_TOKENS: Record<LcRefusalToken, true> = {
    'scratch-unwritable': true, 'tip-unreadable': true, 'bad-session-id': true,
    'flock-unavailable': true, 'lock-unopenable': true, 'is-a-workspace': true,
    'session-live': true, 'session-verdict-unknown': true, 'spawn-failed': true,
  };
  const TOKENS = Object.keys(ALL_TOKENS) as LcRefusalToken[];

  describe('the journal-only refusal vocabulary', () => {
    it.each(TOKENS)('isLcRefusalToken(%s)', (t) => { expect(isLcRefusalToken(t)).toBe(true); });

    it('covers the whole union and derives its list from the map', () => {
      expect(TOKENS.length).toBe(9);
      expect([...LC_REFUSAL_TOKENS].sort()).toEqual([...TOKENS].sort());
    });

    it('every token has a real sentence — no blanks, no bare token echoed back', () => {
      for (const t of LC_REFUSAL_TOKENS) {
        const w = LC_REFUSAL_WORD[t];
        expect(w, t).toBeTruthy();
        expect(w.length, `${t}'s word is too short to be one`).toBeGreaterThan(20);
        expect(w, `${t} echoes its own token at a person`).not.toContain(t);
      }
    });
  });

  describe('DISJOINT from wsaudit`s SENTENCES — one word for one token, once', () => {
    it('shares no key with SENTENCES', () => {
      const both = LC_REFUSAL_TOKENS.filter((t) => t in SENTENCES);
      expect(both, `these have copy in BOTH maps — delete one: ${both.join(', ')}`).toEqual([]);
    });

    it('and the scan is looking at something — SENTENCES really is populated', () => {
      // Guards the guard: an empty SENTENCES would make the filter above
      // vacuously empty and retire the assertion silently. Measured today: 54.
      expect(Object.keys(SENTENCES).length).toBeGreaterThan(50);
      expect(SENTENCES).toHaveProperty('held');
      expect(SENTENCES).toHaveProperty('dirty-tree');
    });

    it('the tokens ccd ALREADY answers in JSON are deliberately NOT here', () => {
      // These nine are the shared rungs — ws-rm and ws-reap both refuse on them
      // — and every one already has a SENTENCES entry. A word here would be the
      // second copy.
      for (const t of ['held', 'dirty-tree', 'no-such-session', 'not-a-workspace',
        'incomplete-registry', 'foreign-worktree', 'tree-unreadable',
        'nested-checkouts-present', 'in-progress']) {
        expect(isLcRefusalToken(t), t).toBe(false);
        expect(refusalSentence(t), `${t} must still be answerable`)
          .not.toBe(`ccrc declined: ${t}.`);
      }
    });
  });

  describe('lcRefusalWord — null is a POSITIVE answer, not a failure', () => {
    it('answers the word for a journal-only token', () => {
      expect(lcRefusalWord('session-live')).toBe(LC_REFUSAL_WORD['session-live']);
    });

    it('answers null for a token wsaudit owns, so the caller falls through to it', () => {
      expect(lcRefusalWord('held')).toBeNull();
      expect(lcRefusalWord('')).toBeNull();
      expect(lcRefusalWord('a-token-nobody-writes')).toBeNull();
      // The composition wave 9 writes: `lcRefusalWord(t) ?? refusalSentence(t)`.
      // L0 cannot import wsaudit (it imports nothing), so the fallthrough is the
      // caller's and the null is how L0 says "not mine".
    });
  });
  ```
- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts
  ```
  Expected failure text:
  `SyntaxError: [vite] The requested module '/home/you/worktrees/ccrc-pwa/still-river/shared/api.ts' does not provide an export named 'LC_REFUSAL_TOKENS'`
- [ ] **Step 3: Write the minimal implementation.** Append to `shared/api.ts`, after Task 4's block:
  ```ts

  /**
   * Refusal tokens that live ONLY in the journal — the ones `_lc_refuse` /
   * `_lc_fail` write and no `"refused":"…"` JSON on ccd's stdout ever carries.
   *
   * DELIBERATELY DISJOINT FROM `wsaudit.ts`'s SENTENCES, and the disjointness is
   * a red suite (`server/test/lifecycle-refusal-word.test.ts`). D15's ruling:
   * `wsaudit.test.ts` holds SENTENCES set-equal IN BOTH DIRECTIONS to the tokens
   * its four regexes grep out of ccd's source, and a `_lc_refuse` call changes
   * no stdout and no exit contract — so it contributes no token to that scan. An
   * entry there for a journal-only token would red the stale-copy direction, and
   * the only fixes would be deleting copy or weakening an approved mechanism
   * (`ccd:2121-2128` records that argument being had once already).
   * `wsaudit.test.ts` must stay green WITH NO EDIT; that is itself an assertion
   * of this program. The shared rungs — `held`, `dirty-tree`, `no-such-session`,
   * `foreign-worktree`, `tree-unreadable`, `nested-checkouts-present`,
   * `in-progress` and the rest of the 54 — keep their single home over there.
   *
   * THE CONTRACT WAVE 3 HONOURS, AND WHAT ENFORCES IT: every token wave 3 hands
   * `_lc_refuse` / `_lc_fail` is a member of this union OR already a SENTENCES
   * key, and wave 3's own cross-language scan over `ccd/ccd` asserts it in both
   * directions with a coverage floor. It cannot live here — it would be red
   * until wave 3 lands. Adding a tenth token is a two-line edit;
   * `Record<LcRefusalToken, string>` makes forgetting its word a TS2739.
   */
  export type LcRefusalToken =
    | 'scratch-unwritable'       // ws-rm could not make the scratch file it reads $workdir with
    | 'tip-unreadable'           // ws-rm could not resolve a tip while the worktree is STILL THERE
    | 'bad-session-id'           // ws-restore / forget: the id is not a shape ccrc mints
    | 'flock-unavailable'        // no util-linux flock — a destructive verb refuses to run unserialised
    | 'lock-unopenable'          // the reap lock could not be opened
    | 'is-a-workspace'           // forget, aimed at a workspace: use the audited path
    | 'session-live'             // forget, on a running session
    | 'session-verdict-unknown'  // tmux did not answer: fail-shut, nothing removed
    | 'spawn-failed';            // _lc_fail: the undo landed, the session did not come back

  /**
   * The word for each. DECLARED ONCE AND EXPORTED — there is no module-private
   * `…_MAP` twin, on purpose. The "total maps stay module-private" rule exists
   * for NARROWING maps, where an exported map gives a second route past the
   * guard (`LIFECYCLE_ACT_MAP[raw]`); this is a RENDERING map, the PWA types its
   * own `Record<LcRefusalToken, …>` renderer against it, and `isLcRefusalToken`
   * is still the only narrowing door. `SENTENCES` (`wsaudit.ts:17`) is the
   * precedent and is exported directly for exactly this reason. An alias
   * declared only to satisfy a guard written for the other case would be a
   * second name for one value.
   */
  export const LC_REFUSAL_WORD: Record<LcRefusalToken, string> = {
    'scratch-unwritable':
      'ccrc could not make a scratch file to read this worktree, so it proved nothing about what removing it would delete. Nothing was touched.',
    'tip-unreadable':
      'ccrc could not resolve this workspace’s tip commit while its worktree is still here, so it could not pin the commits before deleting them. Nothing was touched.',
    'bad-session-id':
      'That is not a shape a ccrc session id can have, so nothing was looked up and nothing was touched.',
    'flock-unavailable':
      'This box has no flock, so ccrc refused to run a destructive verb without serialising it against a concurrent cleanup.',
    'lock-unopenable':
      'ccrc could not open the cleanup lock for this session, so it refused to act unserialised.',
    'is-a-workspace':
      'This is a workspace, and removing one is audited and confirmed. Use the workspace sheet, or ccd ws-rm.',
    'session-live':
      'This session is still running. Stop it first, then try again.',
    'session-verdict-unknown':
      'tmux did not answer, so ccrc cannot tell whether this session is still running. Nothing was removed.',
    'spawn-failed':
      'The undo landed, but the session did not come back up. The workspace and its branch are intact.',
  };

  /** Derived from the map — the `PR_REASON_MAP` idiom, so a member added to the
   *  union is a TS2739 rather than a runtime list one short. */
  export const LC_REFUSAL_TOKENS: readonly LcRefusalToken[] =
    Object.keys(LC_REFUSAL_WORD) as LcRefusalToken[];

  export function isLcRefusalToken(v: unknown): v is LcRefusalToken {
    return typeof v === 'string' && (LC_REFUSAL_TOKENS as readonly string[]).includes(v);
  }

  /**
   * The word for a journal refusal token, or `null`.
   *
   * NULL IS A POSITIVE ANSWER — "this token is not mine, ask
   * `refusalSentence()`" — and never an error. L0 imports nothing, so it cannot
   * fall through to `wsaudit.ts` itself; the caller composes
   * `lcRefusalWord(t) ?? refusalSentence(t)`. Two maps, one lookup order, no
   * token with copy in both.
   */
  export function lcRefusalWord(token: string): string | null {
    return isLcRefusalToken(token) ? LC_REFUSAL_WORD[token] : null;
  }
  ```
- [ ] **Step 4: Run it and watch it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  16 passed`.
- [ ] **Step 5: Measure mutant 1 of 3 — the second home.**
  Add `| 'held'` to `LcRefusalToken` and `held: 'This workspace is held.',` to `LC_REFUSAL_WORD`, run
  the Step 4 command, revert.
  Mutant: give a wsaudit token a second word -> `shares no key with SENTENCES` fails with
  `these have copy in BOTH maps — delete one: held`. **This is the mutant that matters**: it is how
  the vocabulary quietly grows a second home.
- [ ] **Step 6: Measure mutant 2 of 3 — a union member with no word.**
  Delete the `'session-live':` entry from `LC_REFUSAL_WORD` (leaving it in the union), run
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && node ./node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
  ```
  then revert.
  Mutant: drop a rendering-map entry -> `tsc` reds with
  `error TS2741: Property ''session-live'' is missing in type '{ … }' but required in type 'Record<LcRefusalToken, string>'`.
- [ ] **Step 7: Measure mutant 3 of 3 — overload the null.**
  Change `lcRefusalWord`'s body to `return LC_REFUSAL_WORD[token as LcRefusalToken] ?? token;`, run
  the Step 4 command, revert.
  Mutant: echo the token instead of answering null -> `answers null for a token wsaudit owns` fails
  with `expected 'held' to be null`, which is the overloaded return the null exists to prevent.
- [ ] **Step 8: Confirm `wsaudit.test.ts` is still green with ZERO edits** — that is an assertion of
  this program, not a formality:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/wsaudit.test.ts \
    && git -C /home/you/worktrees/ccrc-pwa/still-river status --porcelain server/test/wsaudit.test.ts
  ```
  Expect `Test Files  1 passed` and **no output** from `git status`.
- [ ] **Step 9: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add shared/api.ts server/test/lifecycle-refusal-word.test.ts \
    && git commit -m "feat(shared): LC_REFUSAL_WORD — the journal-only refusal copy (build 9 W1)

  Nine tokens _lc_refuse/_lc_fail write that no ccd stdout JSON carries, with
  their words. Held DISJOINT from wsaudit.ts's SENTENCES by a red suite: a
  token with copy in both maps is the branch-drift incident's own shape.

  The map is declared once and exported, with no module-private twin: the
  'total maps stay private' rule is for NARROWING maps, where an export is a
  second route past the guard. This is a rendering map, SENTENCES is the
  precedent, and isLcRefusalToken is still the only door.

  D15's ruling, restated in the type's docstring: a SENTENCES entry for a
  journal-only token would red wsaudit.test.ts's stale-copy direction, so
  there is none, and wsaudit.test.ts stays green with no edit (verified). The
  both-directions enforcement over ccd's source is wave 3's scan, named here.

  lcRefusalWord returns null for a token wsaudit owns — a positive 'not mine'
  answer the caller composes with refusalSentence, because L0 imports nothing.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 6: The `LC_*` constants and the generation-name readers

**Files:**
- Create: `server/test/lifecycle-journal-constants.test.ts`
- Modify: `shared/api.ts` — append immediately after Task 5's block (end of file).

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const LC_DIR_NAME: '.lifecycle';
  export const LC_GEN_PREFIX: 'journal-';
  export const LC_GEN_SUFFIX: '.ndjson';
  export const LC_ERRORS_NAME: 'errors';
  export const LC_ROTATE_LOCK_NAME: '.rotate.lock';
  export const LC_LINE_MAX: number;              // 2048 BYTES
  export const LC_REASON_MAX_BYTES: number;      // 512 BYTES
  export const LC_GEN_MAX_BYTES: number;         // 4 MiB
  export const LC_GEN_KEEP: number;              // 4
  export const LC_TOTAL_MAX_BYTES: number;       // DERIVED = LC_GEN_MAX_BYTES * LC_GEN_KEEP
  export const LC_SPAWN_QUIET_MS: number;        // 300_000
  export function looksLikeGenerationFile(name: string): boolean;
  export function parseLifecycleGeneration(name: string): string | null;
  export function compareGenerations(a: string, b: string): number;
  ```
  **`LC_SWEEP_MS` is deliberately NOT here.** It is a server tick-gate with no bash twin and no wire
  meaning; it is DEFINED in wave 4 in `server/src/watch.ts`, beside `DIVERGENCE_SWEEP_MS` (`:60`),
  and anything below L4 that needs a derived staleness horizon takes it as a constructor input rather
  than importing upward.
  **`LC_REASON_MAX_BYTES` is BYTES and its policy is REFUSE, never truncate.** ccd's bash twin is
  `_LC_DEC_MAX=512` (wave 3), bound to this constant by `server/test/lifecycle-constants-twin.test.ts`
  (Task 9 of this wave).

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-journal-constants.test.ts`:
  ```ts
  // The journal's names and its ceilings, plus the ONE reader of a generation
  // filename. D1 puts the generation in the NAME, not in a header line: readdir
  // alone then tells the mirror the whole generation set with no second read, a
  // rotation is "a new name appeared" and never "the same file got smaller", and
  // a shrink on an immutably-named generation is unambiguously a truncation.
  // That only holds if exactly one piece of code decides what a generation name
  // is — hence the readers here rather than a regex in the mirror.
  import { describe, it, expect } from 'vitest';
  import { Buffer } from 'node:buffer';
  import {
    LC_DIR_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME,
    LC_LINE_MAX, LC_REASON_MAX_BYTES, LC_GEN_MAX_BYTES, LC_GEN_KEEP,
    LC_TOTAL_MAX_BYTES, LC_SPAWN_QUIET_MS,
    looksLikeGenerationFile, parseLifecycleGeneration, compareGenerations,
  } from '../../shared/api.js';

  const NS = '1755000000123456789';
  const gen = (ns: string): string => `${LC_GEN_PREFIX}${ns}${LC_GEN_SUFFIX}`;

  describe('the names', () => {
    it('are the five D1 spells, and the directory is dot-prefixed', () => {
      expect(LC_DIR_NAME).toBe('.lifecycle');
      expect(LC_DIR_NAME.startsWith('.'), 'a dotted directory matches no $REG/<id>.* glob').toBe(true);
      expect(LC_GEN_PREFIX).toBe('journal-');
      expect(LC_GEN_SUFFIX).toBe('.ndjson');
      expect(LC_ERRORS_NAME).toBe('errors');
      expect(LC_ROTATE_LOCK_NAME).toBe('.rotate.lock');
    });
  });

  describe('the ceilings', () => {
    it('are D1/D7`s numbers', () => {
      expect(LC_LINE_MAX).toBe(2048);
      expect(LC_REASON_MAX_BYTES).toBe(512);
      expect(LC_GEN_MAX_BYTES).toBe(4 * 1024 * 1024);
      expect(LC_GEN_KEEP).toBe(4);
      expect(LC_SPAWN_QUIET_MS).toBe(300_000);
    });

    it('DERIVES the hard ceiling — 16 MiB is not a second number to keep in step', () => {
      expect(LC_TOTAL_MAX_BYTES).toBe(16 * 1024 * 1024);
      expect(LC_TOTAL_MAX_BYTES).toBe(LC_GEN_MAX_BYTES * LC_GEN_KEEP);
    });

    it('a reason cannot fill a line on its own — the cap leaves room for the event', () => {
      expect(LC_REASON_MAX_BYTES).toBeLessThan(LC_LINE_MAX / 2);
    });

    it('the reason cap is BYTES, and bytes are not characters — measured, not asserted', () => {
      // The unit is the whole of B5's ruling: a 200-emoji reason is 800 bytes.
      // Cap it in characters and it passes one surface and is refused by
      // another; cap it in bytes everywhere and there is one number with one
      // meaning. ccd's twin measures the same way (`local LC_ALL=C; ${#s}`).
      const s = '🙂'.repeat(512);
      expect(s.length, 'UTF-16 code units').toBe(1024);
      expect([...s].length, 'code points').toBe(512);
      expect(Buffer.byteLength(s, 'utf8'), 'bytes').toBe(2048);
      expect(Buffer.byteLength(s, 'utf8')).toBeGreaterThan(LC_REASON_MAX_BYTES);
      // And the policy that goes with the unit: an over-cap reason is REFUSED,
      // never silently shortened. A 900-byte reason recorded as 512 reads as
      // the operator's own words, which is the overloaded-value defect at the
      // one seam whose entire job is to record what a person said.
    });
  });

  describe('looksLikeGenerationFile — "is this a generation file at all?"', () => {
    it('says yes for a well-formed name and for a malformed one', () => {
      expect(looksLikeGenerationFile(gen(NS))).toBe(true);
      // A `date +%N` that did not expand yields `journal-1755000000N.ndjson`. It
      // IS a generation file — it just cannot be ordered. Two questions, two
      // readers, so the mirror can record a gap instead of silently ignoring a
      // file full of real events.
      expect(looksLikeGenerationFile(`${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`)).toBe(true);
    });

    it('says no for everything else in the directory', () => {
      for (const n of [LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME, '', 'journal-.ndjson',
        'journal-123', '123.ndjson', 'ournal-123.ndjson', 'journal-123.ndjson.tmp']) {
        expect(looksLikeGenerationFile(n), n).toBe(false);
      }
    });
  });

  describe('parseLifecycleGeneration — "and can it be ordered?"', () => {
    it('returns the digits for a well-formed name', () => {
      expect(parseLifecycleGeneration(gen(NS))).toBe(NS);
      expect(parseLifecycleGeneration(gen('7'))).toBe('7');
    });

    it('returns null for an unorderable name — DISTINCT from "not a generation"', () => {
      expect(parseLifecycleGeneration(`${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`)).toBeNull();
      expect(parseLifecycleGeneration(`${LC_GEN_PREFIX}-1${LC_GEN_SUFFIX}`)).toBeNull();
      expect(parseLifecycleGeneration(`${LC_GEN_PREFIX}1.2${LC_GEN_SUFFIX}`)).toBeNull();
      expect(parseLifecycleGeneration(LC_ERRORS_NAME)).toBeNull();
      // The pair is what makes the distinction usable:
      //   looksLike && !parse  -> a generation the mirror cannot order  -> gap
      //   !looksLike           -> not a generation at all               -> ignore
      const broken = `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`;
      expect(looksLikeGenerationFile(broken) && parseLifecycleGeneration(broken) === null).toBe(true);
      expect(looksLikeGenerationFile(LC_ERRORS_NAME)).toBe(false);
    });

    it('bounds the digits — a 200-digit name is not a generation', () => {
      expect(parseLifecycleGeneration(gen('9'.repeat(25)))).toBe('9'.repeat(25));
      expect(parseLifecycleGeneration(gen('9'.repeat(26)))).toBeNull();
    });
  });

  describe('compareGenerations — "greatest name is live", made a single reader', () => {
    it('orders by magnitude, not lexicographically', () => {
      // The bug this exists to prevent: plain string compare puts a 20-digit
      // name BEFORE a 19-digit one, so the live generation reads as an old one
      // and the mirror ingests a stale file forever.
      expect(compareGenerations('9999999999999999999', '10000000000000000000')).toBeLessThan(0);
      expect('9999999999999999999' < '10000000000000000000').toBe(false);
    });

    it('orders equal-length names lexicographically, which for digits is numerically', () => {
      expect(compareGenerations('1755000000000000001', '1755000000000000002')).toBeLessThan(0);
      expect(compareGenerations('1755000000000000002', '1755000000000000001')).toBeGreaterThan(0);
      expect(compareGenerations(NS, NS)).toBe(0);
    });

    it('sorts a directory listing so the LAST element is the live generation', () => {
      const names = ['journal-1755000000000000003.ndjson', 'journal-999.ndjson',
        'journal-1755000000000000001.ndjson', 'errors', '.rotate.lock'];
      const gens = names.map(parseLifecycleGeneration).filter((g): g is string => g !== null);
      expect(gens.sort(compareGenerations)).toEqual(
        ['999', '1755000000000000001', '1755000000000000003']);
    });
  });
  ```
- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-journal-constants.test.ts
  ```
  Expected failure text:
  `SyntaxError: [vite] The requested module '/home/you/worktrees/ccrc-pwa/still-river/shared/api.ts' does not provide an export named 'LC_DIR_NAME'`
- [ ] **Step 3: Write the minimal implementation.** Append to `shared/api.ts`, after Task 5's block:
  ```ts

  /* --- The journal's names and ceilings. -----------------------------------
   *
   * Every name here has a bash twin in ccd, and the numbers are bound to their
   * twins by `server/test/lifecycle-constants-twin.test.ts`. `LC_SWEEP_MS` is
   * deliberately NOT here: it is a server tick-gate with no bash twin and no
   * wire meaning, and its siblings (`TASK_SWEEP_MS`, `NAME_SWEEP_MS`,
   * `DIVERGENCE_SWEEP_MS`, `MAIL_SWEEP_MS`) all live in `server/src/watch.ts`.
   * One sweep interval in L0 would be a second home for one class of value.
   * ------------------------------------------------------------------------ */

  /** `$REG/.lifecycle/`. A DOT-PREFIXED DIRECTORY, and that is the whole
   *  feature: `_reg_purge`'s suffix filter (`ccd:527-536`) globs `$REG/<id>.*`
   *  and ids never begin with a dot, so no id's purge glob matches it — and
   *  `rm -f` cannot take a directory regardless. Precedent already load-bearing:
   *  `$REG/.reaped/` has survived since Aug 6 with zero deleters in 9,815 lines.
   *  ccd's `$REG` inventory comment (`ccd:1536`) today says SEVEN dot-prefixed
   *  artifacts live there; wave 2 amends it to EIGHT — not nine, because
   *  `.rotate.lock` and the generations live INSIDE `.lifecycle/` and are
   *  counted with it exactly as `.reaped/`'s contents are. An inventory a future
   *  reader trusts and a future writer copies is exactly the defect
   *  `_reg_purge`'s own header records having shipped once. */
  export const LC_DIR_NAME = '.lifecycle';

  /** `journal-<epochNs>.ndjson`. THE GENERATION IS IN THE FILENAME (D1): a
   *  `readdir` alone tells the mirror the whole generation set with no second
   *  read; a rotation is "a new name appeared", never "the same file got
   *  smaller"; and a shrink on an immutably-named generation is unambiguously a
   *  truncation rather than an ambiguity to guess at. */
  export const LC_GEN_PREFIX = 'journal-';
  export const LC_GEN_SUFFIX = '.ndjson';

  /** The counted write-failure file (D7), temp+rename. Surfaced as
   *  `lifecycle.writeErrors` in the fleet health payload, because a silently
   *  stopped journal must not be indistinguishable from a quiet fleet. */
  export const LC_ERRORS_NAME = 'errors';

  /** `_lc_rotate`'s lock. NEVER UNLINKED, not even as cleanup — "unlinking a
   *  lock file while another process holds it is exactly how two processes come
   *  to hold the lock on two different inodes" (`ccd:1531-1534`), and all four
   *  of ccd's existing lock paths already follow that rule. */
  export const LC_ROTATE_LOCK_NAME = '.rotate.lock';

  /** Bytes, not characters — the same char-vs-byte care `MAIL_BODY_MAX_BYTES`
   *  (:2498) and `hookstate.ts:128-135` already take. One event per line, LF
   *  terminated. Over-length lines are not truncated silently: the emitter drops
   *  named fields in a stated order and sets `LifecycleEvent.truncated`. */
  export const LC_LINE_MAX = 2048;

  /** `--reason`'s cap. BYTES, and the policy is REFUSE — an over-cap reason is
   *  declined at the surface that received it, never shortened to fit. A
   *  900-byte reason recorded as 512 reads as the operator's own words, which is
   *  the overloaded-value defect at the one seam whose whole job is to record
   *  what a person said. Free text off the wire: written verbatim, parsed
   *  nowhere. ccd's twin is `_LC_DEC_MAX=512` (wave 3), measured with
   *  `LC_ALL=C` so `${#s}` counts bytes; the two are held equal by
   *  `server/test/lifecycle-constants-twin.test.ts`. */
  export const LC_REASON_MAX_BYTES = 512;

  /** Rotation: 4 MiB per generation, 4 generations. Measured sizing — ~100 acts
   *  a day at ~350 B is ~35 KB/day, so one generation is about three months and
   *  four about a year. RETENTION IS A CEILING, NOT A SCHEDULE, which is the
   *  answer to "is the flat file really still ground truth". Rotation MINTS A
   *  GREATER NAME and never truncates: `agent/src/tail.ts:53-58` treats a shrink
   *  as a reset and hands its reader an `onReset(size)` it must model, so a
   *  truncating rotation would turn every ordinary roll into a reset. */
  export const LC_GEN_MAX_BYTES = 4 * 1024 * 1024;
  export const LC_GEN_KEEP = 4;

  /** The hard ceiling, DERIVED — 16 MiB is not a second number to keep in step
   *  with the two above. A hand-maintained constant beside a computed pair is
   *  how the pair goes out of step, and the failure is silent. */
  export const LC_TOTAL_MAX_BYTES = LC_GEN_MAX_BYTES * LC_GEN_KEEP;

  /** `_spawn_settle` emits CHANGE-ONLY — a differing rc, or this long since this
   *  id's last `spawn` line. Without the rule, `Restart=always` across 18
   *  sessions is the whole disk budget. ccd's twin carries 300, in SECONDS;
   *  wave 2 names it and adds its row to the twin test. */
  export const LC_SPAWN_QUIET_MS = 300_000;

  /**
   * "Is this a generation file at all?" — prefix and suffix only.
   *
   * Deliberately a SEPARATE question from `parseLifecycleGeneration`, because a
   * generation whose name cannot be ordered (a `date +%N` that did not expand
   * would mint `journal-1755000000N.ndjson`) is a file FULL OF REAL EVENTS, not
   * a stray. Collapsing the two into one null would make the mirror ignore it
   * silently; kept apart, `looksLike && !parse` is a gap the reader records.
   */
  export function looksLikeGenerationFile(name: string): boolean {
    return name.startsWith(LC_GEN_PREFIX) && name.endsWith(LC_GEN_SUFFIX)
      && name.length > LC_GEN_PREFIX.length + LC_GEN_SUFFIX.length;
  }

  /** The generation's epoch-nanosecond digits, or null when the name cannot be
   *  ordered. Bounded at 25 digits so a pathological name is refused rather than
   *  compared. */
  export function parseLifecycleGeneration(name: string): string | null {
    if (!looksLikeGenerationFile(name)) return null;
    const mid = name.slice(LC_GEN_PREFIX.length, name.length - LC_GEN_SUFFIX.length);
    return /^[0-9]{1,25}$/.test(mid) ? mid : null;
  }

  /**
   * Orders two parsed generation strings; "greatest name is live" (D1), made a
   * single reader so nobody hand-rolls it — and so nobody reaches for a bare
   * `.sort()` on the filenames, which is the bug below in disguise.
   *
   * BY LENGTH FIRST, and that is the whole point: plain lexicographic compare
   * puts a 20-digit name BEFORE a 19-digit one, so a clock that crossed a digit
   * boundary would make the live generation read as an old one and the mirror
   * would ingest a stale file forever. Equal lengths compare lexicographically,
   * which for digit strings IS numerically — and stays exact past
   * `Number.MAX_SAFE_INTEGER`, which a 19-digit nanosecond epoch is.
   */
  export function compareGenerations(a: string, b: string): number {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  ```
- [ ] **Step 4: Run it and watch it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-journal-constants.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  13 passed`.
- [ ] **Step 5: Measure mutant 1 of 4 — a hand-written ceiling.**
  Replace `export const LC_TOTAL_MAX_BYTES = LC_GEN_MAX_BYTES * LC_GEN_KEEP;` with
  `export const LC_TOTAL_MAX_BYTES = 16 * 1024 * 1024;` and change `LC_GEN_KEEP` to `3`, run the
  Step 4 command, revert both.
  Mutant: stop deriving the ceiling -> `DERIVES the hard ceiling` fails with
  `expected 16777216 to be 12582912`. With the derivation in place the same `LC_GEN_KEEP` edit reds
  only the `are D1/D7's numbers` line and the ceiling follows — which is the point.
- [ ] **Step 6: Measure mutant 2 of 4 — the lexicographic sort.**
  Change `compareGenerations`'s body to `return a < b ? -1 : a > b ? 1 : 0;` (drop the length rung),
  run the Step 4 command, revert.
  Mutant: drop the length rung -> `orders by magnitude, not lexicographically` fails with
  `expected 1 to be less than 0`. **This is the mutant that matters.**
- [ ] **Step 7: Measure mutant 3 of 4 — collapse the two generation questions.**
  Make `parseLifecycleGeneration` return `mid` unconditionally, run the Step 4 command, revert.
  Mutant: answer "orderable" for an unorderable name -> `returns null for an unorderable name` fails
  with `expected '1755000000N' to be null`.
- [ ] **Step 8: Measure mutant 4 of 4 — a loose filename test.**
  Change `looksLikeGenerationFile`'s body to `return name.includes(LC_GEN_PREFIX);`, run the Step 4
  command, revert.
  Mutant: match anywhere instead of at the ends -> `says no for everything else` fails on
  `journal-123.ndjson.tmp` with `expected true to be false`.
- [ ] **Step 9: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add shared/api.ts server/test/lifecycle-journal-constants.test.ts \
    && git commit -m "feat(shared): the journal's names, ceilings and generation readers (build 9 W1)

  LC_DIR_NAME/.rotate.lock/errors and the journal-<epochNs>.ndjson pair, plus
  D1/D7's caps. LC_TOTAL_MAX_BYTES DERIVES from per-generation x keep, so 16
  MiB is not a second number to keep in step.

  LC_REASON_MAX_BYTES is BYTES and its policy is REFUSE, never truncate — one
  number, one unit, one policy, with the byte-vs-character difference measured
  in the suite rather than asserted in a comment. ccd's _LC_DEC_MAX twin is
  bound to it by lifecycle-constants-twin.test.ts.

  Two generation readers, not one, and the split is the design:
  looksLikeGenerationFile answers 'is this a generation at all', parse answers
  'and can it be ordered'. A name a broken date +%N minted is a file full of
  real events — one null for both questions would make the mirror ignore it
  silently; kept apart, looksLike && !parse is a gap the reader records.

  compareGenerations orders by LENGTH first: plain string compare puts a
  20-digit name before a 19-digit one, which would make the mirror ingest a
  stale generation forever. Readers sort WITH it, never with a bare .sort().

  LC_SWEEP_MS is deliberately not here — it is a server tick-gate with no bash
  twin, and lands in watch.ts beside its siblings in wave 4.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 7: The single-definition guards for the new vocabulary

`server/test/single-definition.test.ts` text-scans four source roots and fails the build on a second
copy. Every vocabulary this wave added needs its entry, or the next reader who needs the act list
writes a second one — which is precisely the finding that file exists for.

**Files:**
- Modify: `server/test/single-definition.test.ts` — change the import at `:21`, and append one new
  `describe` at end of file (currently **1198** lines).

**Interfaces:**
- Consumes: `LIFECYCLE_ACTS`, `LC_ACT_UNKNOWN` from `../../shared/api.js`; the file's own module-level
  `ALL` (`:56`), `rel` (`:57`) and `ccrcRoot` (`:26`), and its existing `readFileSync` / `path`
  imports (`:19-20`).
- Produces: no source symbols — guards only.

**Measured before writing** (re-run today over `shared/`, `server/src/`, `pwa/src/`, `agent/src/`):
the `enumerates` predicate over the 22 acts finds **zero** holders, and the highest-scoring
non-holder is `pwa/src/lib/api.ts` at **8 of 22**. So the holder list is exactly `['shared/api.ts']`
with 14 tokens of margin — this guard cannot false-positive on an unrelated file.

**One thing to check before you run it:** Tasks 2–6 append their blocks to `shared/api.ts` **at
column 0**; the two-space indent inside those tasks' fenced blocks is presentation only. The
`^\s*const …` / `^\s*export const …` regexes below tolerate indentation, but the L0 file's own style
does not.

- [ ] **Step 1: Add the import this describe needs.** In
  `server/test/single-definition.test.ts:21`, change:
  ```ts
  import { AUTH_VERDICTS, PR_REASONS, isPrReason } from '../../shared/api.js';
  ```
  to:
  ```ts
  import {
    AUTH_VERDICTS, PR_REASONS, isPrReason, LIFECYCLE_ACTS, LC_ACT_UNKNOWN,
  } from '../../shared/api.js';
  ```
- [ ] **Step 2: Write the failing guards.** Append to `server/test/single-definition.test.ts`:
  ```ts

  describe('Build 9 nouns — the lifecycle journal vocabulary', () => {
    const oneDefinition = (decl: RegExp, name: string): void => {
      const hits = ALL.filter((f) => decl.test(readFileSync(f, 'utf8')));
      expect(hits.map(rel), name).toEqual(['shared/api.ts']);
    };

    it('defines each type and its derived list exactly once, in shared/', () => {
      oneDefinition(/^\s*export type LifecycleAct\b/m, 'LifecycleAct');
      oneDefinition(/^\s*export const LIFECYCLE_ACTS\b/m, 'LIFECYCLE_ACTS');
      oneDefinition(/^\s*export const LC_ACT_UNKNOWN\b/m, 'LC_ACT_UNKNOWN');
      oneDefinition(/^\s*export type LifecycleOutcome\b/m, 'LifecycleOutcome');
      oneDefinition(/^\s*export const LIFECYCLE_OUTCOMES\b/m, 'LIFECYCLE_OUTCOMES');
      oneDefinition(/^\s*export const LC_OUTCOME_UNKNOWN\b/m, 'LC_OUTCOME_UNKNOWN');
      oneDefinition(/^\s*export type ActorClass\b/m, 'ActorClass');
      oneDefinition(/^\s*export const ACTOR_CLASSES\b/m, 'ACTOR_CLASSES');
      oneDefinition(/^\s*export type Corroboration\b/m, 'Corroboration');
      oneDefinition(/^\s*export function corroboration\b/m, 'corroboration');
      oneDefinition(/^\s*export type LcRefusalToken\b/m, 'LcRefusalToken');
      oneDefinition(/^\s*export const LC_REFUSAL_WORD\b/m, 'LC_REFUSAL_WORD');
      oneDefinition(/^\s*export interface LifecycleEvent\b/m, 'LifecycleEvent');
      oneDefinition(/^\s*export interface MirroredLifecycleEvent\b/m, 'MirroredLifecycleEvent');
      oneDefinition(/^\s*export function compareGenerations\b/m, 'compareGenerations');
    });

    it('DERIVES every runtime list from its total map — never a hand-written array', () => {
      // The `PR_REASONS`/`SPAWN_VERDICTS`/`DIVERGENCE_KINDS` guard, applied to
      // the five new vocabularies. A member added to a union with no key in its
      // map is TS2739; a key the union does not have is TS2353. A
      // `readonly X[]` literal beside the type gives neither, and accepts a typo.
      const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
      for (const [list, map] of [
        ['LIFECYCLE_ACTS', 'LIFECYCLE_ACT_MAP'],
        ['LIFECYCLE_OUTCOMES', 'LIFECYCLE_OUTCOME_MAP'],
        ['ACTOR_CLASSES', 'ACTOR_CLASS_MAP'],
        ['CORROBORATIONS', 'CORROBORATION_MAP'],
        // The refusal list derives from the EXPORTED rendering map itself —
        // there is no private twin, and there must not be one: see the third
        // `it` below.
        ['LC_REFUSAL_TOKENS', 'LC_REFUSAL_WORD'],
      ] as const) {
        expect(api, `${list} must derive from ${map}`)
          .toMatch(new RegExp(`export const ${list}[^=]*=\\s*\\n?\\s*Object\\.keys\\(${map}\\)`));
        expect(api, `${list} is a hand-written array`)
          .not.toMatch(new RegExp(`export const ${list}[^=]*=\\s*\\[`));
      }
    });

    it('keeps the NARROWING maps module-private, and the RENDERING map exported', () => {
      // `STOP_SURFACES`' argument (:1140-1148), one level in: with the map
      // unexported, `LIFECYCLE_ACT_MAP[raw]` cannot be written in another file
      // at all, so `isLifecycleAct` is the only narrowing route.
      //
      // LC_REFUSAL_WORD IS THE EXCEPTION, AND THE EXCEPTION IS THE RULE READ
      // CORRECTLY: it renders a token for a person, it narrows nothing, the
      // PWA types its own renderer against it, and `isLcRefusalToken` is still
      // the only door. `SENTENCES` (`wsaudit.ts:17`) is the precedent. A
      // private `LC_REFUSAL_WORD_MAP` twin aliased to an export would be a
      // second name for one value, declared only to satisfy a guard written
      // for the other case — so this test forbids it in BOTH directions.
      const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
      for (const m of ['LIFECYCLE_ACT_MAP', 'LIFECYCLE_OUTCOME_MAP', 'ACTOR_CLASS_MAP',
        'CORROBORATION_MAP', 'DEC_CORROBORATES']) {
        expect(api, `${m} must not be exported`)
          .not.toMatch(new RegExp(`^\\s*export const ${m}\\b`, 'm'));
        expect(api, `${m} must exist`).toMatch(new RegExp(`^\\s*const ${m}\\b`, 'm'));
      }
      expect(api, 'LC_REFUSAL_WORD is the renderer and is exported directly')
        .toMatch(/^\s*export const LC_REFUSAL_WORD\b/m);
      expect(api, 'no LC_REFUSAL_WORD_MAP alias — one value, one name')
        .not.toMatch(/LC_REFUSAL_WORD_MAP/);
    });

    it('enumerates the act vocabulary only where the compiler enforces exhaustiveness', () => {
      // The rule, stated as the assertion: a file may list the WHOLE act
      // vocabulary only if a `Record<LifecycleAct, …>` over it makes a missing
      // member a compile error. One file qualifies today — `shared/api.ts` (the
      // union and `LIFECYCLE_ACT_MAP`). `pwa/src/lib/journalWords.ts` joins it
      // in wave 9, and ONLY because it types its map `Record<LifecycleAct,
      // string>`; add it to this list then, not before.
      //
      // Membership is tested per token in ANY form, quoted or as an object key,
      // the way the `PrReason` scan above does — a quoted-literals-only scan
      // would exclude a map written with unquoted keys by accident rather than
      // by rule.
      const enumerates = (src: string): boolean =>
        LIFECYCLE_ACTS.every((a) => new RegExp(`(?:'${a}'|(?<![\\w'-])${a}\\s*:)`).test(src));
      const holders = ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel).sort();
      expect(holders).toEqual(['shared/api.ts']);
    });

    it('and the act scan is looking at something — guards the guard', () => {
      // A `LIFECYCLE_ACTS` that had gone empty would make `every` vacuously true
      // for EVERY file, turning the assertion above into a list of all 200-odd
      // sources — loud, but for the wrong reason. This fails first, and
      // specifically. Measured when written: the highest-scoring NON-holder is
      // `pwa/src/lib/api.ts` at 8 of 22, so the margin is 14 tokens.
      const enumerates = (src: string): boolean =>
        LIFECYCLE_ACTS.every((a) => new RegExp(`(?:'${a}'|(?<![\\w'-])${a}\\s*:)`).test(src));
      expect(LIFECYCLE_ACTS.length).toBe(22);
      expect(LIFECYCLE_ACTS).toContain(LC_ACT_UNKNOWN);
      expect(enumerates(readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8'))).toBe(true);
      expect(enumerates(readFileSync(path.join(ccrcRoot, 'pwa/src/lib/api.ts'), 'utf8'))).toBe(false);
    });

    it('LC_REFUSAL_WORD has exactly one holder — the second copy is the whole failure mode', () => {
      const tokens = ['scratch-unwritable', 'tip-unreadable', 'bad-session-id',
        'flock-unavailable', 'lock-unopenable', 'is-a-workspace',
        'session-live', 'session-verdict-unknown', 'spawn-failed'];
      const enumerates = (src: string): boolean =>
        tokens.every((t) => src.includes(`'${t}'`));
      expect(ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel))
        .toEqual(['shared/api.ts']);
      expect(tokens.length, 'guards the guard — an empty list passes everything').toBe(9);
    });
  });
  ```
- [ ] **Step 3: Run it and watch it pass** — Tasks 2–6 already satisfy every guard:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/single-definition.test.ts
  ```
  Expect `Test Files  1 passed`. If `defines each type … exactly once` fails with
  `expected [] to deeply equal [ 'shared/api.ts' ]`, a Task 2–6 block was pasted with the fenced
  block's presentation indent in a way the `^\s*` anchors could not reach — check `shared/api.ts`.
- [ ] **Step 4: Measure mutant 1 of 4 — export a narrowing map.**
  In `shared/api.ts`, add `export ` before `const LIFECYCLE_ACT_MAP`, run the Step 3 command, revert.
  Mutant: export the narrowing map -> `keeps the NARROWING maps module-private, and the RENDERING map
  exported` fails with `LIFECYCLE_ACT_MAP must not be exported`.
- [ ] **Step 5: Measure mutant 2 of 4 — re-introduce the alias.**
  In `shared/api.ts`, rename the refusal map to `const LC_REFUSAL_WORD_MAP` and add
  `export const LC_REFUSAL_WORD: Record<LcRefusalToken, string> = LC_REFUSAL_WORD_MAP;` beneath it,
  run the Step 3 command, revert.
  Mutant: alias one value to two names -> the same `it` fails with
  `no LC_REFUSAL_WORD_MAP alias — one value, one name`.
- [ ] **Step 6: Measure mutant 3 of 4 — hand-write a derived list.**
  In `shared/api.ts`, replace `LIFECYCLE_ACTS`'s `Object.keys(LIFECYCLE_ACT_MAP)` derivation with a
  literal array of all 22 members, run the Step 3 command, revert.
  Mutant: stop deriving -> `DERIVES every runtime list from its total map` fails with
  `LIFECYCLE_ACTS is a hand-written array`.
- [ ] **Step 7: Measure mutant 4 of 4 — a second act enumeration.**
  Create `server/src/actwords.ts` (no leading underscores — the walker skips `__`-prefixed entries)
  containing a `Record<string, string>` whose keys are all 22 acts, unquoted; run the Step 3 command;
  then `rm /home/you/worktrees/ccrc-pwa/still-river/server/src/actwords.ts` immediately.
  ```ts
  export const ACT_WORDS: Record<string, string> = {
    create: 'a', claim: 'a', purge: 'a', supervise: 'a', unsupervise: 'a',
    destroy: 'a', rename: 'a', hold: 'a', release: 'a', archive: 'a', restore: 'a',
    'attic-drop': 'a', reap: 'a', gc: 'a', spawn: 'a', start: 'a', ensure: 'a',
    swap: 'a', enable: 'a', stop: 'a', forget: 'a', unknown: 'a',
  };
  ```
  Mutant: a second file enumerating the whole vocabulary with no exhaustiveness check ->
  `enumerates the act vocabulary only where the compiler enforces exhaustiveness` fails with
  `expected [ 'server/src/actwords.ts', 'shared/api.ts' ] to deeply equal [ 'shared/api.ts' ]`.
- [ ] **Step 8: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add server/test/single-definition.test.ts \
    && git commit -m "test(shared): single-definition guards for the journal vocabulary (build 9 W1)

  Each new type and derived list declared once in shared/; every runtime list
  proved to DERIVE from its total map rather than sit beside it as an array a
  typo can enter; every NARROWING map proved module-private, so the isX guard
  is the only route past it.

  LC_REFUSAL_WORD is the stated exception and is pinned in both directions:
  it renders for a person and narrows nothing, SENTENCES is the precedent, and
  a private _MAP alias — one value under two names — is forbidden by name.

  The act vocabulary may be enumerated only where a Record<LifecycleAct, …>
  makes a missing member a compile error — one holder today, and
  pwa/src/lib/journalWords.ts joins it in wave 9 on that condition alone.
  Measured when written: the highest-scoring non-holder in the four source
  roots hits 8 of 22, so the scan has 14 tokens of margin.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 8: `lifecycle-vocabulary.test.ts` — the cross-language pin on ccd's `_LC_ACTS`

The spec's named guard for *"ccd emits an act L0 does not declare"*. It is written in wave 1 and it
must be **green today**, before wave 2 exists — so it asserts a two-world property rather than a
one-world equality: ccd is either wholly in the journal world or wholly out of it, and a
**half-shipped wave 2 is a red suite**.

**Measured today** (`ccd/ccd`, 9815 lines): `.lifecycle` → 0 hits, `_lc_` → 0 hits, `_LC_ACTS` → 0
hits, `cmd_caps` advertises exactly one capability token (`stop-surface`, and
`ccd-archive.test.ts:153`'s `KNOWN_CAPABILITY_TOKENS` is `['stop-surface']`). ccd is cleanly in the
ABSENT world.

**This task READS `ccd/ccd` and never modifies it.** Wave 1 ships no ccd change, so there is no
AGENT-FIRST obligation here; the deploy that carries `_LC_ACTS` is wave 2's.

**Files:**
- Create: `server/test/lifecycle-vocabulary.test.ts`

**Interfaces:**
- Consumes: `LIFECYCLE_ACTS`, `LC_ACT_UNKNOWN`, `LIFECYCLE_OUTCOMES`, `LC_OUTCOME_UNKNOWN`,
  `LC_DIR_NAME` from `../../shared/api.js`; `CCD` (`ccdWsHelpers.ts:21`), `makeCcdHarness` (`:242`),
  `type CcdHarness` (`:219`) from `./ccdWsHelpers.js`.
- Produces: no source symbols. It produces a **contract wave 2 must satisfy**, stated here so the
  wave-2 author has it in one place:
  1. `_LC_ACTS` is a **top-level bash array** in `ccd/ccd`, readable by `declare -p _LC_ACTS` after
     `source ccd`.
  2. Its members are **exactly `LIFECYCLE_ACTS` minus `LC_ACT_UNKNOWN`** — the 21 real acts.
  3. `_LC_OUTCOMES` is a top-level array of **`LIFECYCLE_OUTCOMES` minus `LC_OUTCOME_UNKNOWN`** — the
     4 real outcomes. Both degrades are the READER's and neither is ever a ccd call site's choice.
  4. `_lc_emit` exists as a top-level function (`^_lc_emit\(\)`) and CONSULTS `_LC_ACTS`.
  5. `cmd_caps` advertises `lifecycle-v1`.
  All five ship in the **same** wave-2 commit, or this test is red.

**Harness note:** this file is named `lifecycle-vocabulary.test.ts` (the spec's name) so it does
**not** match `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/` containment scan. It must therefore
reach bash **only** through `h.sh` — never a raw `execFileSync('bash', …)` — because
`makeCcdHarness`'s own runner already applies `ghContainedEnv(home, …, { systemd: true })` on every
call (`ccdWsHelpers.ts:306-309`). A raw spawn here would be uncontained and unscanned.

- [ ] **Step 1: Write the failing test** — the pure world-classifier and its synthetic positive
  controls first, with `journalWorld` deliberately not yet defined. Create
  `server/test/lifecycle-vocabulary.test.ts`:
  ```ts
  // The act vocabulary is ONE vocabulary across bash and TypeScript.
  //
  // `wrapper-roster-fixture.test.ts` states the law this follows: every
  // comparison is a SET equality over ccd's own answer space, "parsed or
  // enumerated", never "each member got a matching answer" — the weaker form
  // only ever asks ccd about acts the mirror already knows, so an act ccd grew
  // on its own is invisible to it. And the answer space here is EXECUTED, not
  // grepped: `declare -p` / `printf '%s\n' "${_LC_ACTS[@]}"` under
  // `makeCcdHarness`, which cannot be fooled by an `echo` a regex did not
  // anticipate.
  //
  // THIS FILE IS GREEN BEFORE WAVE 2 AND GREEN AFTER IT, AND RED IN BETWEEN.
  // ccd is either wholly in the journal world (`_LC_ACTS` + `_lc_emit` + the
  // `lifecycle-v1` cap) or wholly out of it; a half-shipped wave 2 is what the
  // world classifier below asserts against. The classifier is a PURE function
  // pinned FIRST against synthetic inputs and only then pointed at the real ccd
  // — `ccd-die-containment.test.ts:1-25`'s precedent, and for its reason: at
  // this tip the journal population is empty, so an assertion against the real
  // file can only ever pass today.
  //
  // If it goes red on the SET, fix ccd — never LIFECYCLE_ACTS. L0 is where the
  // vocabulary is decided; `_LC_ACTS` is where it is spoken.
  //
  // WAVE 2 OWES THIS FILE FIVE THINGS, IN ONE COMMIT:
  //   1. `_LC_ACTS` as a TOP-LEVEL bash array, readable by `declare -p _LC_ACTS`
  //      after `source ccd` — not a local, not built inside a function.
  //   2. Its members exactly LIFECYCLE_ACTS minus LC_ACT_UNKNOWN (21 acts).
  //   3. `_LC_OUTCOMES`, likewise, exactly LIFECYCLE_OUTCOMES minus
  //      LC_OUTCOME_UNKNOWN (4). Both degrades are the reader's.
  //   4. `_lc_emit()` at the top level, and it must CONSULT `_LC_ACTS` — an act
  //      it cannot find there is written `act:"unknown"` with the token in
  //      `badact` (D6), which is what makes the set equality hold BY
  //      CONSTRUCTION rather than by discipline.
  //   5. `lifecycle-v1` in `cmd_caps`, plus `lifecycle-v1` added to
  //      `ccd-archive.test.ts:153`'s KNOWN_CAPABILITY_TOKENS — omitting the
  //      second makes the token fall into that test's `verbs` partition and reds
  //      it as a phantom verb, which is correct and by design.
  // The BEHAVIOURAL half of (4) — emit a bogus act, assert the line degrades —
  // belongs in wave 2's own ccd test, not here: this file owns the SET.
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
  import {
    LIFECYCLE_ACTS, LC_ACT_UNKNOWN, LIFECYCLE_OUTCOMES, LC_OUTCOME_UNKNOWN, LC_DIR_NAME,
  } from '../../shared/api.js';

  const ccdSrc = readFileSync(CCD, 'utf8');

  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-lc-vocab-'); });
  afterEach(() => { h.cleanup(); });

  const sortedSet = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

  interface JournalEvidence { readonly acts: boolean; readonly cap: boolean; readonly emitter: boolean }

  describe('the world classifier itself — pinned before it is pointed at ccd', () => {
    it('calls all-three-present `present`', () => {
      expect(journalWorld({ acts: true, cap: true, emitter: true })).toBe('present');
    });

    it('calls all-three-absent `absent`', () => {
      expect(journalWorld({ acts: false, cap: false, emitter: false })).toBe('absent');
    });

    it('calls every mixture `half` — all six of them', () => {
      const mixtures: JournalEvidence[] = [
        { acts: true, cap: false, emitter: false },
        { acts: false, cap: true, emitter: false },
        { acts: false, cap: false, emitter: true },
        { acts: true, cap: true, emitter: false },
        { acts: true, cap: false, emitter: true },
        { acts: false, cap: true, emitter: true },
      ];
      for (const m of mixtures) expect(journalWorld(m), JSON.stringify(m)).toBe('half');
      expect(mixtures.length, 'the whole mixed space: 2^3 minus the two pure worlds').toBe(6);
    });
  });
  ```
- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts
  ```
  Expected failure text: `ReferenceError: journalWorld is not defined`
- [ ] **Step 3: Write the classifier.** Insert into `server/test/lifecycle-vocabulary.test.ts`,
  immediately after the `JournalEvidence` interface and before the first `describe`:
  ```ts
  /** Which of the two legal worlds ccd is in, or `half` for the illegal middle.
   *  Pure, so the six mixtures can be pinned without a fixture HOME. */
  const journalWorld = (e: JournalEvidence): 'present' | 'absent' | 'half' => {
    const n = [e.acts, e.cap, e.emitter].filter(Boolean).length;
    return n === 3 ? 'present' : n === 0 ? 'absent' : 'half';
  };
  ```
- [ ] **Step 4: Run it and watch the classifier pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts
  ```
  Expect `Tests  3 passed`.
- [ ] **Step 5: Point it at the real ccd.** Append to `server/test/lifecycle-vocabulary.test.ts`:
  ```ts

  /** ccd's own answer for a top-level ARRAY, EXECUTED. Guarded by `declare -p`
   *  because ccd runs under `set -uo pipefail` (`ccd/ccd:7`) and a bare
   *  `"${arr[@]}"` on an unset array exits the shell — which would read as a
   *  harness failure rather than as "wave 2 has not landed". Returns null for
   *  "not declared". */
  const ccdArray = (name: string): string[] | null => {
    const out = h.sh(
      `if declare -p ${name} >/dev/null 2>&1; then printf '%s\\n' "\${${name}[@]}"; ` +
      'else echo __ABSENT__; fi',
    );
    return out.trim() === '__ABSENT__'
      ? null
      : out.split('\n').map((l) => l.trim()).filter(Boolean);
  };

  const capsTokens = (): string[] =>
    h.sh('cmd_caps').split('\n').map((l) => l.trim()).filter(Boolean);

  const evidence = (): JournalEvidence => ({
    acts: ccdArray('_LC_ACTS') !== null,
    cap: capsTokens().includes('lifecycle-v1'),
    emitter: /^_lc_emit\(\)/m.test(ccdSrc),
  });

  describe('ccd <-> shared: the journal vocabulary', () => {
    it('ccd is in ONE of the two worlds — a half-shipped wave 2 is a red suite', () => {
      const e = evidence();
      expect(journalWorld(e),
        `_LC_ACTS=${e.acts}, caps lifecycle-v1=${e.cap}, _lc_emit=${e.emitter} — ` +
        'wave 2 ships all of them in one commit or none of them',
      ).not.toBe('half');
    });

    it('the ABSENT world is genuinely absent — nothing half-writes the journal', () => {
      if (journalWorld(evidence()) !== 'absent') return;
      // Not a skip: these are the assertions that make "absent" mean absent
      // rather than "the probe found nothing". Measured at this tip: 0 hits
      // each.
      expect(ccdSrc, 'a journal path exists but no emitter does').not.toContain(LC_DIR_NAME);
      expect(ccdSrc).not.toMatch(/_lc_[a-z]/);
    });

    it("_LC_ACTS is exactly LIFECYCLE_ACTS minus the reader's degrade", () => {
      // The derivation and its guard run ABOVE the world branch, on purpose: in
      // the absent world the branch returns early, and a `want` computed after
      // the return could be mutated to `LIFECYCLE_ACTS` with nothing red. Here,
      // the length assertion measures the mutant TODAY.
      const want = LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN);
      expect(want.length, 'guards the guard: an empty want passes everything').toBe(21);
      expect(want, 'the filter must exclude the degrade, not merely run').not.toContain(LC_ACT_UNKNOWN);
      const acts = ccdArray('_LC_ACTS');
      if (acts === null) {
        expect(journalWorld(evidence()), 'the absent world, asserted above').toBe('absent');
        return;
      }
      // The `ccd-session-lifecycle.test.ts:150` shape — `SESSION_LIFECYCLES
      // .filter((s) => s !== 'unmeasurable')` — except the excluded member is
      // named by a constant, so this filter cannot silently become a no-op.
      expect(sortedSet(acts)).toEqual(sortedSet(want));
      expect(acts, 'unknown is the READER`s degrade, never a ccd call site')
        .not.toContain(LC_ACT_UNKNOWN);
    });

    it('_LC_OUTCOMES is exactly LIFECYCLE_OUTCOMES minus the degrade', () => {
      const want = LIFECYCLE_OUTCOMES.filter((o) => o !== LC_OUTCOME_UNKNOWN);
      expect(want.length, 'guards the guard: an empty want passes everything').toBe(4);
      expect(want).not.toContain(LC_OUTCOME_UNKNOWN);
      const outcomes = ccdArray('_LC_OUTCOMES');
      if (outcomes === null) {
        expect(journalWorld(evidence()), 'the absent world, asserted above').toBe('absent');
        return;
      }
      expect(sortedSet(outcomes)).toEqual(sortedSet(want));
    });

    it('_LC_ACTS is READ, not merely declared to satisfy this file', () => {
      if (ccdArray('_LC_ACTS') === null) return;
      // The mutant this kills: declare the array, never consult it, and emit
      // whatever a call site passes. One occurrence is the declaration; a
      // second is the emitter validating against it.
      const uses = ccdSrc.match(/_LC_ACTS/g) ?? [];
      expect(uses.length, '_LC_ACTS is declared but never consulted').toBeGreaterThan(1);
    });

    it('the caps token and the vocabulary ship together', () => {
      const e = evidence();
      expect(capsTokens().includes('lifecycle-v1')).toBe(e.acts);
      // Backstop, and it is a real one: after wave 2,
      // `ccd-archive.test.ts:153`'s KNOWN_CAPABILITY_TOKENS is
      // ['lifecycle-v1', 'stop-surface'] and its capability-equality assertion
      // reds the moment cmd_caps stops advertising the token — so the two
      // worlds cannot both be satisfied by deleting the feature.
    });
  });
  ```
- [ ] **Step 6: Run the whole file and watch it pass in the absent world.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  9 passed`.
- [ ] **Step 7: Measure mutant 1 of 3 — a classifier that tolerates the middle.**
  Change `journalWorld`'s body to `return n >= 1 ? 'present' : 'absent';`, run the Step 6 command,
  revert.
  Mutant: accept a half-shipped world -> `calls every mixture 'half'` fails with
  `expected 'present' to be 'half'`, and `_LC_ACTS is exactly …` fails too, because `evidence()` then
  claims `present` while `ccdArray('_LC_ACTS')` is null.
- [ ] **Step 8: Measure mutant 2 of 3 — drop the degrade filter.**
  Change `const want = LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN);` to
  `const want = LIFECYCLE_ACTS;`, run the Step 6 command, revert.
  Mutant: let the degrade into the bash vocabulary -> `guards the guard: an empty want passes
  everything` fails with `expected 22 to be 21` **today, in the absent world**, because the
  derivation runs above the early return. After wave 2 the set equality fails as well.
- [ ] **Step 9: Measure mutant 3 of 3 — a vacuous set equality.**
  Delete the `expect(want.length …).toBe(21)` line and change `want` to `[]`, run the Step 6 command,
  revert both.
  Mutant: compare against nothing -> the set equality passes vacuously and the suite is green while
  asserting nothing. Confirm the *unmutated* guard reds this by restoring only the length line:
  `expected 0 to be 21`.
- [ ] **Step 10: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add server/test/lifecycle-vocabulary.test.ts \
    && git commit -m "test(shared): pin ccd's _LC_ACTS set-equal to LIFECYCLE_ACTS (build 9 W1)

  The spec's named cross-language guard, written in wave 1 and green before
  wave 2 exists: ccd is either wholly in the journal world (_LC_ACTS +
  _lc_emit + the lifecycle-v1 cap) or wholly out of it, and the illegal middle
  is a red suite. ccd's answer space is EXECUTED under makeCcdHarness, not
  grepped, so an echo a regex did not anticipate cannot fool it. _LC_OUTCOMES
  is pinned the same way — both halves of the vocabulary have a degrade and
  neither degrade is ever a ccd call site's word.

  The world classifier is a pure function pinned FIRST against all six
  synthetic mixtures and only then pointed at the real file — the
  ccd-die-containment precedent, and for its reason: the journal population is
  empty at this tip, so a real-file assertion can only pass today. The
  minus-the-degrade derivations run ABOVE the absent-world return, so their
  guards-the-guard length assertions are measurable now rather than in wave 2.

  Reaches bash only through h.sh: this filename does not match
  ccd-workspaces.test.ts's /^ccd.*\\.ts\$/ containment scan, and the harness's
  own runner is what applies ghContainedEnv({systemd:true}) on every call.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 9: `lifecycle-constants-twin.test.ts` — one number, one unit, bound across the two languages

B5's ruling made a mechanism. `--reason`'s cap had three names, two units and two policies; L0 now
owns the number (`LC_REASON_MAX_BYTES`, Task 6) and ccd owns its twin (`_LC_DEC_MAX`, wave 3). A
comment saying they must agree is a request. This file is the mechanism, and it follows Task 8's
shape exactly: **green before waves 2 and 3, green after them, red in between.**

**This task READS `ccd/ccd` and never modifies it.** No ccd change, so no AGENT-FIRST obligation;
wave 2 and wave 3 carry their own deploys.

**Scope boundary, so this does not collide with wave 5:** this file owns only the **numbers and
names**. `_lc_dec_ok`'s and `_lc_surface_norm`'s BEHAVIOUR — that an over-cap reason is refused
rather than truncated, that the byte count is taken under `LC_ALL=C`, that the locale is restored —
is wave 5's `ccd-actor-flags.test.ts`. Here they appear only as evidence that wave 3 landed.

**Files:**
- Create: `server/test/lifecycle-constants-twin.test.ts`

**Interfaces:**
- Consumes: `LC_DIR_NAME`, `LC_LINE_MAX`, `LC_GEN_MAX_BYTES`, `LC_GEN_KEEP`, `LC_REASON_MAX_BYTES`
  from `../../shared/api.js`; `makeCcdHarness`, `type CcdHarness` from `./ccdWsHelpers.js`.
- Produces: no source symbols. It produces a **contract waves 2 and 3 must satisfy**:
  - **Wave 2**, in one commit: `_LC_DIR` (a path whose BASENAME is `LC_DIR_NAME`), `_LC_LINE_MAX`,
    `_LC_GEN_MAX_BYTES`, `_LC_GEN_KEEP` — all four as top-level scalars equal to their L0 owners.
  - **Wave 3**, in one commit: `_LC_DEC_MAX` (= `LC_REASON_MAX_BYTES`), `_lc_surface_norm`,
    `_lc_dec_ok`.
  - Wave 2 also owes a bash twin for `LC_SPAWN_QUIET_MS` (300, in SECONDS). It is **not pinned here**
    because no name for it is agreed yet; wave 2 names it and adds its row to the `WAVE2` table
    below, converting seconds to milliseconds in the comparison.

**Harness note:** the filename does not match `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
containment scan, so — exactly as `lifecycle-vocabulary.test.ts` — it reaches bash **only** through
`h.sh`, whose runner already applies `ghContainedEnv(home, …, { systemd: true })`
(`ccdWsHelpers.ts:306-309`). Never a raw `execFileSync('bash', …)` here.

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-constants-twin.test.ts`:
  ```ts
  // One number, one unit, two languages — the SUPERVISED_FRESH_MS bash-twin
  // idiom, applied to the journal's ceilings.
  //
  // B5's paid lesson: `--reason`'s cap arrived with three names
  // (LC_REASON_MAX_BYTES / a bare `${reason:0:512}` / _LC_DEC_MAX), two units
  // (bytes and characters) and two policies (truncate and refuse). A 200-emoji
  // reason then passed one destructive verb at 800 bytes and was refused by
  // another. The number is decided in L0; ccd speaks it; this file holds the
  // two equal, and the READER is pinned against synthetic declarations before it
  // is pointed at the real ccd (`ccd-die-containment.test.ts:1-25`'s precedent)
  // so the comparison is measurable TODAY, while ccd still declares none of it.
  //
  // GREEN BEFORE WAVES 2 AND 3, GREEN AFTER THEM, RED IN BETWEEN: each wave's
  // twins are all-or-nothing, so a half-landed wave is the illegal middle.
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import path from 'node:path';
  import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
  import {
    LC_DIR_NAME, LC_LINE_MAX, LC_GEN_MAX_BYTES, LC_GEN_KEEP, LC_REASON_MAX_BYTES,
  } from '../../shared/api.js';

  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-lc-twin-'); });
  afterEach(() => { h.cleanup(); });

  /** ccd's value for a top-level scalar, or null when it is not declared.
   *  `declare -p` rather than a bare expansion because ccd runs under
   *  `set -uo pipefail` (`ccd/ccd:7`) and an unset expansion exits the shell.
   *  `prelude` exists so the reader can be pinned against a SYNTHETIC
   *  declaration before it is pointed at the real file. */
  const scalar = (name: string, prelude = ''): string | null => {
    const out = h.sh(
      `${prelude}\n`
      + `if declare -p ${name} >/dev/null 2>&1; then printf '%s' "\${${name}}"; `
      + "else printf '__ABSENT__'; fi",
    );
    return out === '__ABSENT__' ? null : out;
  };

  /** Declared as EITHER a variable or a function. */
  const declared = (name: string, prelude = ''): boolean =>
    h.sh(
      `${prelude}\n`
      + `if declare -p ${name} >/dev/null 2>&1 || declare -F ${name} >/dev/null 2>&1; `
      + "then printf yes; else printf no; fi",
    ) === 'yes';

  /** All-or-nothing, per wave. `half` is the illegal middle. */
  const twinWorld = (present: readonly boolean[]): 'present' | 'absent' | 'half' => {
    const n = present.filter(Boolean).length;
    return n === present.length ? 'present' : n === 0 ? 'absent' : 'half';
  };

  /** Every mixture of `n` booleans that is neither all-true nor all-false. */
  const mixtures = (n: number): boolean[][] => {
    const out: boolean[][] = [];
    for (let mask = 1; mask < (1 << n) - 1; mask++) {
      out.push(Array.from({ length: n }, (_, i) => (mask & (1 << i)) !== 0));
    }
    return out;
  };

  const WAVE2 = ['_LC_DIR', '_LC_LINE_MAX', '_LC_GEN_MAX_BYTES', '_LC_GEN_KEEP'] as const;
  const WAVE3 = ['_LC_DEC_MAX', '_lc_surface_norm', '_lc_dec_ok'] as const;

  describe('the twin-world classifier, pinned before it is pointed at ccd', () => {
    it('calls all-present `present` and all-absent `absent`', () => {
      expect(twinWorld([true, true, true, true])).toBe('present');
      expect(twinWorld([false, false, false, false])).toBe('absent');
    });

    it('calls every wave-2 mixture `half` — all fourteen of them', () => {
      const ms = mixtures(4);
      for (const m of ms) expect(twinWorld(m), JSON.stringify(m)).toBe('half');
      expect(ms.length, '2^4 minus the two pure worlds').toBe(14);
    });

    it('calls every wave-3 mixture `half` — all six of them', () => {
      const ms = mixtures(3);
      for (const m of ms) expect(twinWorld(m), JSON.stringify(m)).toBe('half');
      expect(ms.length, '2^3 minus the two pure worlds').toBe(6);
    });
  });

  describe('the reader itself, pinned against synthetic declarations', () => {
    it('reads a declared scalar, and answers null for an undeclared one', () => {
      expect(scalar('_LC_LINE_MAX', '_LC_LINE_MAX=2048')).toBe('2048');
      expect(scalar('_LC_LINE_MAX')).toBeNull();
    });

    it('sees a function as declared, and a missing one as not', () => {
      expect(declared('_lc_dec_ok', '_lc_dec_ok() { :; }')).toBe(true);
      expect(declared('_lc_dec_ok')).toBe(false);
    });

    it('a DRIFTED twin is visible — the comparison is not vacuous', () => {
      // This is what makes the whole file worth having before wave 3 exists: the
      // equality below is exercised now, against a value that is right and a
      // value that is wrong, rather than only in a world nobody has built yet.
      expect(Number(scalar('_LC_DEC_MAX', '_LC_DEC_MAX=512'))).toBe(LC_REASON_MAX_BYTES);
      expect(Number(scalar('_LC_DEC_MAX', '_LC_DEC_MAX=256'))).not.toBe(LC_REASON_MAX_BYTES);
    });

    it('a directory twin is compared by BASENAME, never by path', () => {
      // `_LC_DIR` is `$REG/.lifecycle` — an absolute path under the fixture
      // HOME. L0 owns the NAME, not the location, so only the last component is
      // a shared value.
      const dir = scalar('_LC_DIR', '_LC_DIR="$HOME/.cc-sessions/.lifecycle"');
      expect(dir).not.toBeNull();
      expect(path.basename(dir!)).toBe(LC_DIR_NAME);
    });
  });

  describe('wave 2 — the journal`s names and ceilings', () => {
    it('ccd is in ONE world for all four — a half-landed wave 2 is a red suite', () => {
      const present = WAVE2.map((n) => declared(n));
      expect(twinWorld(present),
        WAVE2.map((n, i) => `${n}=${present[i]}`).join(', ')
        + ' — wave 2 ships all four in one commit or none of them',
      ).not.toBe('half');
    });

    it('_LC_DIR`s basename is LC_DIR_NAME', () => {
      const v = scalar('_LC_DIR');
      if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
      expect(path.basename(v)).toBe(LC_DIR_NAME);
    });

    it('_LC_LINE_MAX equals LC_LINE_MAX', () => {
      const v = scalar('_LC_LINE_MAX');
      if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
      expect(Number(v)).toBe(LC_LINE_MAX);
    });

    it('_LC_GEN_MAX_BYTES equals LC_GEN_MAX_BYTES', () => {
      const v = scalar('_LC_GEN_MAX_BYTES');
      if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
      expect(Number(v)).toBe(LC_GEN_MAX_BYTES);
    });

    it('_LC_GEN_KEEP equals LC_GEN_KEEP', () => {
      const v = scalar('_LC_GEN_KEEP');
      if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
      expect(Number(v)).toBe(LC_GEN_KEEP);
    });
  });

  describe('wave 3 — the reason cap, in BYTES, refused and never truncated', () => {
    it('ccd is in ONE world for the cap and its two helpers', () => {
      const present = WAVE3.map((n) => declared(n));
      expect(twinWorld(present),
        WAVE3.map((n, i) => `${n}=${present[i]}`).join(', ')
        + ' — wave 3 ships the cap, _lc_surface_norm and _lc_dec_ok together',
      ).not.toBe('half');
    });

    it('_LC_DEC_MAX equals LC_REASON_MAX_BYTES', () => {
      // The number only. That it is measured in BYTES (`LC_ALL=C`) and that an
      // over-cap reason is REFUSED rather than shortened is wave 5's
      // `ccd-actor-flags.test.ts` — one fact, one owner.
      const v = scalar('_LC_DEC_MAX');
      if (v === null) { expect(twinWorld(WAVE3.map((n) => declared(n)))).toBe('absent'); return; }
      expect(Number(v)).toBe(LC_REASON_MAX_BYTES);
    });
  });
  ```
- [ ] **Step 2: Run it and watch it pass in the absent world.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-constants-twin.test.ts
  ```
  Expect `Test Files  1 passed`, `Tests  14 passed`.
- [ ] **Step 3: Measure mutant 1 of 3 — a classifier that tolerates the middle.**
  Change `twinWorld`'s body to `return n >= 1 ? 'present' : 'absent';`, run the Step 2 command,
  revert.
  Mutant: accept a half-landed wave -> `calls every wave-2 mixture 'half'` fails with
  `expected 'present' to be 'half'`.
- [ ] **Step 4: Measure mutant 2 of 3 — a comparison that cannot see drift.**
  Change the drift control to `expect(Number(scalar('_LC_DEC_MAX', '_LC_DEC_MAX=256'))).toBe(LC_REASON_MAX_BYTES);`,
  run the Step 2 command, revert.
  Mutant: assert the wrong direction -> `a DRIFTED twin is visible` fails with
  `expected 256 to be 512`. This is the assertion that proves the equality is exercised **today**,
  before ccd declares anything.
- [ ] **Step 5: Measure mutant 3 of 3 — compare a directory by path.**
  Change `expect(path.basename(dir!)).toBe(LC_DIR_NAME);` to `expect(dir).toBe(LC_DIR_NAME);`, run
  the Step 2 command, revert.
  Mutant: compare the whole path -> `a directory twin is compared by BASENAME, never by path` fails
  with `expected '<fixture home>/.cc-sessions/.lifecycle' to be '.lifecycle'`.
- [ ] **Step 6: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add server/test/lifecycle-constants-twin.test.ts \
    && git commit -m "test(shared): bind the journal's constants to their bash twins (build 9 W1)

  B5's ruling made a mechanism. --reason's cap had three names, two units and
  two policies; L0 owns the number, ccd speaks it, and this holds the two
  equal — the SUPERVISED_FRESH_MS bash-twin idiom, extended to the line, the
  generation size, the keep count and the journal directory's basename.

  Green before waves 2 and 3, green after, RED in between: each wave's twins
  are all-or-nothing, so a half-landed wave is the illegal middle.

  The reader is pinned against SYNTHETIC declarations before it is pointed at
  the real ccd, including a deliberately drifted value, so the equality is
  measurable today rather than only in a world nobody has built yet.

  Scope boundary stated in the file: this owns the NUMBERS. That the cap is
  taken in bytes under LC_ALL=C and that an over-cap reason is refused rather
  than truncated is wave 5's ccd-actor-flags.test.ts — one fact, one owner.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 10: Wave close — full verification and the additive-diff proof

**Files:** none created or modified. This task measures.

**Interfaces:**
- Consumes: everything Tasks 2–9 shipped.
- Produces: the evidence that wave 1 is dark, plus the handoff every later wave reads.

- [ ] **Step 1: Prove the wave is purely additive to L0** — this is the wave's headline property, and
  it is what makes "no `agent/` run, no `pwa/` run" honest rather than lazy:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git diff ece9687..HEAD -- shared/api.ts | grep -c '^-[^-]'
  ```
  Expect `0`. (`ece9687` is this branch's merge-base with `origin/main`, verified today; re-derive it
  with `git merge-base HEAD origin/main` if the branch has moved.) A non-zero count means an existing
  L0 declaration was changed or removed, wave 1 is no longer dark, and `pwa/` and `agent/` must both
  be installed and run before this wave ships.
- [ ] **Step 2: Confirm the same at the file level** — nothing outside `shared/api.ts` and
  `server/test/` was touched:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git diff --stat ece9687..HEAD
  ```
  Expect exactly nine paths: `shared/api.ts`, `server/test/single-definition.test.ts`, and the seven
  new files `server/test/lifecycle-acts.test.ts`, `corroboration.test.ts`, `lifecycle-wire.test.ts`,
  `lifecycle-refusal-word.test.ts`, `lifecycle-journal-constants.test.ts`,
  `lifecycle-vocabulary.test.ts`, `lifecycle-constants-twin.test.ts`.
  **`ccd/ccd`, `agent/`, `pwa/`, `server/src/` must all be absent from the list.**
- [ ] **Step 3: Typecheck the whole tests-inclusive project, in the foreground.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && node ./node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
  ```
  Expect no output, exit 0.
- [ ] **Step 4: Run every suite this wave wrote or edited, in the foreground, one command.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run \
       test/lifecycle-acts.test.ts \
       test/corroboration.test.ts \
       test/lifecycle-wire.test.ts \
       test/lifecycle-refusal-word.test.ts \
       test/lifecycle-journal-constants.test.ts \
       test/lifecycle-vocabulary.test.ts \
       test/lifecycle-constants-twin.test.ts \
       test/single-definition.test.ts
  ```
  Expect `Test Files  8 passed`.
- [ ] **Step 5: Run the three suites this wave could plausibly have disturbed without editing** — the
  L0 scanners and the token-linkage guard that must stay green **with no edit**:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run \
       test/wsaudit.test.ts test/divergence.test.ts test/module-format.test.ts
  ```
  Expect `Test Files  3 passed`. `wsaudit.test.ts` green with
  `git status --porcelain server/test/wsaudit.test.ts` empty is the D15 assertion;
  `divergence.test.ts` green (its vocabulary `it` at `:303-305` still names exactly three kinds)
  confirms the two new `DivergenceKind` members were correctly deferred to wave 4.
- [ ] **Step 6: Run the full server suite once, in the foreground, timeout 600000 ms.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
  ```
  Four of the five known load flakes are **not** in wave 1's blast radius (`ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `ccd-session-state` are all waves 2/4); `typecheck-tests` is, because it compiles
  the seven new files.
- [ ] **Step 7: If `typecheck-tests` alone was red, re-run it in isolation before calling it a
  break.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```
  A flake CI passes is a flake; a real break prints the `TS####` and the file.
- [ ] **Step 8: Confirm there is nothing to deploy.** `shared/` compiles into the server and PWA
  builds and has no runtime consumer until wave 4, so wave 1 ships with wave 4's
  `bash deploy/deploy.sh`. Wave 1 touches neither `ccd/`, `session-hook.sh` nor `ccd/*-skill/`, so
  **there is no AGENT-FIRST obligation in this wave** — verify with:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git diff --name-only ece9687..HEAD | grep -E '^(ccd/|agent/|pwa/|server/src/)' ; echo "exit=$?"
  ```
  Expect no matching paths and `exit=1` (grep's "no match").
- [ ] **Step 9: Record the handoff.** No commit — this is the wave-close report. State it verbatim,
  because five of these are rulings later waves must NOT quietly "fix":
  - **Naming hazard, noted once.** This wave adds seven test files, five of them `lifecycle-*`,
    beside the four that already exist (`lifecycle.test.ts`, `fleet-lifecycle.test.ts`,
    `session-lifecycle.test.ts`, `ccd-session-lifecycle.test.ts`) — and waves 2–4 add ten more
    (`ccd-lifecycle-*`, `lifecycle-store`, `lifecycle-mirror`, `lifecycle-sweep`, `lifecycle-route`,
    `lifecycle-replay`). Files whose names differ only by a prefix are worth one naming decision at
    the wave-4 close; wave 1 flags it and changes nothing, because renaming the spec's own
    `lifecycle-vocabulary.test.ts` would cost more than it buys.
  - **Wave 2 (ccd, AGENT-FIRST)** owes `lifecycle-vocabulary.test.ts` the five things in its header
    block — `_LC_ACTS`, `_LC_OUTCOMES`, `_lc_emit` consulting `_LC_ACTS`, the `lifecycle-v1` cap, and
    `lifecycle-v1` in `ccd-archive.test.ts:153`'s `KNOWN_CAPABILITY_TOKENS` — in ONE commit, plus
    `lifecycle-constants-twin.test.ts`'s four scalars (`_LC_DIR`, `_LC_LINE_MAX`,
    `_LC_GEN_MAX_BYTES`, `_LC_GEN_KEEP`) in one commit, plus a name for the `LC_SPAWN_QUIET_MS` twin
    and its row in that file's `WAVE2` table. It also amends `ccd:1536`'s inventory from SEVEN
    dot-prefixed artifacts to **EIGHT** — not nine: `.rotate.lock` and the generations live inside
    `.lifecycle/` and are counted with it, as `.reaped/`'s contents are.
  - **Wave 3 (ccd, AGENT-FIRST)** owes `_LC_DEC_MAX = 512`, `_lc_surface_norm` and `_lc_dec_ok`, in
    one commit (`lifecycle-constants-twin.test.ts`'s `WAVE3` world). Every token it passes
    `_lc_refuse` / `_lc_fail` must be a member of `LC_REFUSAL_TOKENS` ∪ `Object.keys(SENTENCES)`, and
    wave 3 ships the cross-language scan that asserts it in both directions. The journal field is
    spelled **`refusal`**, never `refused`. The reason cap is **bytes**, and the policy is
    **refuse** — a truncating `${reason:0:512}` is the defect B5 names.
  - **Wave 4 (server)** DEFINES `const LC_SWEEP_MS = 5_000;` in `server/src/watch.ts` beside
    `DIVERGENCE_SWEEP_MS` (`:60`) — it is **not** in L0 and must not be imported from there. Anything
    under L4 that needs a derived staleness horizon takes it as a constructor input
    (`MirrorDeps.staleAfterMs`), never by importing upward. Wave 4 also adds
    `'provenance-mismatch' | 'archived-but-live'` to `DivergenceKind` / `DIVERGENCE_KIND_MAP` **in
    the same commit** as their `divergence.ts` arms and the `divergence.test.ts:303-305` edit, and
    imports `LC_DIR_NAME` / `LC_GEN_PREFIX` / `LC_GEN_SUFFIX` / `LC_ERRORS_NAME` /
    `LC_ROTATE_LOCK_NAME` / `looksLikeGenerationFile` / `parseLifecycleGeneration` /
    `compareGenerations` from L0 rather than re-declaring any of them.
  - **Three L0 shapes wave 4 must build to, and their compile errors are the mechanism:**
    (a) `LifecycleEvent` carries **`badoutcome`** and **`truncated`** beside `badact` — a literal
    missing either is a TS2739, and that is deliberate: without them an unmodelled outcome token and
    a dropped field are invisible facts. (b) `raw` is **non-nullable** — the line verbatim on every
    path — while `uid` and `at` are **nullable**, because an unparseable line is still a row and
    minting a uid the bytes did not carry would fabricate identity. (c) `gen` and `ingestedAt` live
    on **`MirroredLifecycleEvent`**, never on `LifecycleEvent`; `lifecycleFor()` returns the former.
  - **`LifecycleMeas` is a CLOSED ten, and that is a ruling.** ccd writes more `meas.*` keys
    (`atticsrc`, `workdir`, `base`, `rc`, `mode`, `from`, `to`, `dropped`, `registered`, `bytes`,
    `state`, …). They are not silently widened into the interface and they are not lost: `raw` holds
    the line verbatim, so an unmodelled key is re-projectable later — `obs.cgraw`'s own argument.
    Promoting one is a two-line edit in `shared/api.ts` plus its reader; minting it in
    `journalparse.ts` is not.
  - **Wave 9 (pwa)** may add `pwa/src/lib/journalWords.ts` to the holder list in
    `single-definition.test.ts`'s `enumerates the act vocabulary only where the compiler enforces
    exhaustiveness` — **only** if that file types its map `Record<LifecycleAct, string>`. It composes
    refusal copy as `lcRefusalWord(t) ?? refusalSentence(t)`; L0 imports nothing, so the fallthrough
    is always the caller's.

---

### Task 11: Test-harness foundations — tmux containment and the one journal reader

**Server tests only. No `ccd/ccd` edit, no deploy.** Every task below depends on this one: without the
tmux poison, `_lc_obs` shells the operator's **live** tmux server on every lifecycle test (measured:
`/usr/bin/tmux` 3.4 is installed and `/tmp/tmux-1000/` holds live sockets), and `CLAUDE.md`'s "NEVER
touch tmux" is a project rule with no mechanism behind it. Without the shared reader, seven test files
each hand-roll a `journal()` helper that sorts generation names with a bare `.sort()` — the exact bug
L0's `compareGenerations` exists to prevent.

**Hard cross-wave dependency:** wave 1 is merged before this runs. This task imports `LC_DIR_NAME`,
`LC_GEN_SUFFIX`, `looksLikeGenerationFile`, `parseLifecycleGeneration` and `compareGenerations` from
`../../shared/api.js`. If those exports are absent, stop and raise it — do not re-declare them here
(`server/test/single-definition.test.ts` text-scans four roots and fails the build on a second copy).

**Files:**
- Modify `server/test/ccdWsHelpers.ts` — `ContainOpts` (`:139-146`), `ghContainedEnv`'s early return
  (`:160`) and its poison loop (`:191`), the `CcdHarness` interface (`:219-240`), and
  `makeCcdHarness`'s two `{ systemd: true }` literals (`:267`, the up-front plant, and `:309`, the one
  `sh()` evaluates on every call).
- Create `server/test/lifecycleHelpers.ts`.
- Create `server/test/lifecycle-harness-tmux.test.ts`.

**Interfaces:**
- Consumes: `LC_DIR_NAME`, `LC_GEN_SUFFIX`, `looksLikeGenerationFile`, `parseLifecycleGeneration`,
  `compareGenerations`, `type LifecycleEvent` from `../../shared/api.js` (wave 1).
- Produces (`server/test/ccdWsHelpers.ts`):
  - `ContainOpts.tmux?: boolean` — plant a recording, refusing `tmux` in `harnessBin(home)`.
    Create-if-absent, exactly like the systemd poisons, so a file that plants its own stub first still
    wins; a bash **function** stub always wins, because bash resolves functions before PATH.
  - `CcdHarness.tmuxCalls(): string[]` — every argv the contained `tmux` saw.
  - `makeCcdHarness` asks for `{ systemd: true, tmux: true }`.
- Produces (`server/test/lifecycleHelpers.ts`), the ONE reader every lifecycle test file imports:
  ```ts
  export const lcDir = (home: string): string => string;                     // <home>/.cc-sessions/.lifecycle
  export const readJournal = (home: string): Record<string, unknown>[];      // generation order, then file order
  export const actsOf = (home: string): string[];
  export const outcomesOf = (home: string, act: string): string[];
  export const eventsOf = (home: string, act: string): Record<string, unknown>[];
  export const refusalsOf = (home: string): { act: string; token: string }[];
  export const measOf = (e: Record<string, unknown>): Record<string, string>;
  export const decOf  = (e: Record<string, unknown>): Record<string, string>;
  export const NO_TMUX = 'tmux() { return 1; };';                            // the belt to the harness's braces
  ```

**Steps:**

- [ ] **Step 1: Write the failing containment test.** Create `server/test/lifecycle-harness-tmux.test.ts`:

```ts
// server/test/lifecycle-harness-tmux.test.ts
//
// THE THIRD ISOLATION BOUNDARY, beside HOME and the `gh` poison. `_lc_obs`
// (wave 2) runs `tmux list-panes -a` on every event, and `makeCcdHarness`
// isolates HOME but not PATH or TMUX_TMPDIR — so without this the lifecycle
// suites read the operator's LIVE tmux server, and their answers depend on
// whether vitest happens to be running inside a ccd pane. `CLAUDE.md`'s "NEVER
// touch tmux" is a rule; this is the mechanism.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-tmux-'); });
afterEach(() => { h.cleanup(); });

describe('the ccd harness contains tmux', () => {
  it('resolves a tmux that RECORDS and REFUSES, never /usr/bin/tmux', () => {
    // Mutant: drop `tmux: true` from makeCcdHarness's ghContainedEnv literal ->
    // this fails with `expected '/usr/bin/tmux' to contain '.local/bin'`, and
    // every lifecycle test shells the operator's live tmux server.
    expect(h.sh('command -v tmux')).toContain('.local/bin');
    expect(h.sh('tmux list-panes -a 2>/dev/null; printf "rc=%s" "$?"')).toBe('rc=97');
    expect(h.tmuxCalls()).toEqual(['list-panes -a']);
  });

  it('a shell FUNCTION still wins over the poison — bash resolves functions first', () => {
    // Every existing ccd suite stubs tmux this way; the poison must not displace
    // them, or ~30 files change meaning at once.
    expect(h.sh('tmux() { echo STUB; }; tmux list-panes')).toBe('STUB');
    expect(h.tmuxCalls(), 'a stubbed call must not reach the poison').toEqual([]);
  });

  it('records nothing when nothing called it — absent file is no calls', () => {
    expect(h.tmuxCalls()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && npm ci && ./node_modules/.bin/vitest run test/lifecycle-harness-tmux.test.ts
```

Expected: red. The first case fails with `TypeError: h.tmuxCalls is not a function`; before that,
`expect(h.sh('command -v tmux')).toContain('.local/bin')` fails with
`expected '/usr/bin/tmux' to contain '.local/bin'`.

- [ ] **Step 3: Widen `ContainOpts`.** In `server/test/ccdWsHelpers.ts`, replace the `ContainOpts`
  interface body (`:139-146`) with:

```ts
export interface ContainOpts {
  /** Plant the `systemctl`/`systemd-run` poisons too. ASK FOR THIS IF THE SPAWN
   *  RUNS ccd: every path that can reach `_have_systemctl` or
   *  `_supervised_start` needs it, `makeCcdHarness` asks on behalf of every test
   *  that goes through the harness, and `ccd-workspaces.test.ts`'s source scan
   *  is what says so for the call sites that build their own env. */
  systemd?: boolean;
  /** Plant the `tmux` poison. ASK FOR THIS IF THE SNIPPET CAN REACH `_lc_obs`,
   *  which is every ccd path once wave 2 lands: `_lc_obs` runs
   *  `tmux list-panes -a` and neither `HOME` nor `TMUX_TMPDIR` is isolated by
   *  this harness, so the uncontained call reads the operator's LIVE server.
   *  Same create-if-absent shape as systemd, for the same displaceability
   *  reason, and a bash FUNCTION stub still wins over both. */
  tmux?: boolean;
}
```

- [ ] **Step 4: Plant the poison.** In `server/test/ccdWsHelpers.ts`, inside `ghContainedEnv`, replace
  the two-entry poison table (the `for (const [name, log, rc] of [` header at `:191` through the
  `if (fs.existsSync(p)) continue;` two lines below its close) with a table the `tmux` flag extends:

```ts
  for (const [name, log, rc, want] of [
    ['systemctl', 'systemctl-calls', 'rc=97', !!opts.systemd],
    ['systemd-run', 'systemd-run-calls', 'rc=${SYSTEMD_RUN_RC:-97}', !!opts.systemd],
    // `_lc_obs`'s only shelled read. It must EXIST and REFUSE rather than be
    // absent: `_lc_obs` branches on `command -v tmux`, so removing tmux would
    // send every lifecycle test down the `no-tmux` arm silently — a different
    // answer, reached by a different path, with nothing saying so.
    ['tmux', 'tmux-calls', 'rc=${TMUX_STUB_RC:-97}', !!opts.tmux],
  ] as const) {
    if (!want) continue;
    const p = path.join(bin, name);
    if (fs.existsSync(p)) continue;
```

  and change the early return above it (`:160`, `if (!opts.systemd) return …`) to:

```ts
  if (!opts.systemd && !opts.tmux) return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
```

- [ ] **Step 5: Expose the log and ask for the poison.** In `server/test/ccdWsHelpers.ts`, add to the
  `CcdHarness` interface immediately after `systemdRunCalls()` (`:233`):

```ts
  /** Every argv the contained `tmux` saw (`_lc_obs`'s `list-panes`). */
  tmuxCalls(): string[];
```

  add the implementation beside `systemdRunCalls`'s in `makeCcdHarness`'s returned object:

```ts
    tmuxCalls: () => readLines(path.join(home, 'tmux-calls')),
```

  and change BOTH of `makeCcdHarness`'s opts literals from `{ systemd: true }` to
  `{ systemd: true, tmux: true }` — the up-front plant at `:267`:

```ts
  ghContainedEnv(home, {}, { systemd: true, tmux: true });
```

  and the one `sh()` evaluates on every call, at `:309`:

```ts
          env: ghContainedEnv(home, { ...process.env, HOME: home, ...env }, { systemd: true, tmux: true }) }).trim(),
```

- [ ] **Step 6: Write the shared reader.** Create `server/test/lifecycleHelpers.ts`:

```ts
// server/test/lifecycleHelpers.ts
//
// ONE READER FOR EVERY LIFECYCLE TEST FILE. Seven files in waves 2-3 read the
// journal; seven hand-rolled copies are seven chances to sort generation names
// with a bare `.sort()` — the exact defect `compareGenerations` exists to
// prevent — and `single-definition.test.ts` exists because this repo has paid
// for the second copy before. The names come from L0: a test that hard-codes
// `.lifecycle` or `.ndjson` is a second home for a value wave 1 owns.
import fs from 'node:fs';
import path from 'node:path';
import {
  LC_DIR_NAME, LC_GEN_SUFFIX, compareGenerations, looksLikeGenerationFile,
  parseLifecycleGeneration,
} from '../../shared/api.js';

export const lcDir = (home: string): string =>
  path.join(home, '.cc-sessions', LC_DIR_NAME);

/** Every event in every generation, in GENERATION order then file order. */
export const readJournal = (home: string): Record<string, unknown>[] => {
  const dir = lcDir(home);
  if (!fs.existsSync(dir)) return [];
  const gens = fs.readdirSync(dir)
    .filter((f) => looksLikeGenerationFile(f))
    .map((f) => [parseLifecycleGeneration(f), f] as const)
    .filter((p): p is readonly [string, string] => p[0] !== null)
    .sort((a, b) => compareGenerations(a[0], b[0]))
    .map(([, f]) => f);
  return gens.flatMap((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>));
};

export const actsOf = (home: string): string[] =>
  readJournal(home).map((e) => String(e['act']));

export const eventsOf = (home: string, act: string): Record<string, unknown>[] =>
  readJournal(home).filter((e) => e['act'] === act);

export const outcomesOf = (home: string, act: string): string[] =>
  eventsOf(home, act).map((e) => String(e['outcome']));

/** `refusal` and `detail` are TOP-LEVEL on the wire, never inside `meas` — the
 *  canonical shape, and the one this repo's readers must not "fix". */
export const refusalsOf = (home: string): { act: string; token: string }[] =>
  readJournal(home).filter((e) => e['outcome'] === 'refused')
    .map((e) => ({ act: String(e['act']), token: String(e['refusal']) }));

export const measOf = (e: Record<string, unknown>): Record<string, string> =>
  (e['meas'] ?? {}) as Record<string, string>;

export const decOf = (e: Record<string, unknown>): Record<string, string> =>
  (e['dec'] ?? {}) as Record<string, string>;

/** Belt to the harness's braces: a snippet that must answer `no-tmux` rather
 *  than the harness poison's `not-listed` prepends this. */
export const NO_TMUX = 'tmux() { return 1; };';

/** The generation filenames present, in order. */
export const generationsOf = (home: string): string[] => {
  const dir = lcDir(home);
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => looksLikeGenerationFile(f) && f.endsWith(LC_GEN_SUFFIX))
    .map((f) => [parseLifecycleGeneration(f), f] as const)
    .filter((p): p is readonly [string, string] => p[0] !== null)
    .sort((a, b) => compareGenerations(a[0], b[0]))
    .map(([, f]) => f);
};
```

- [ ] **Step 7: Run the new test to green.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-harness-tmux.test.ts
```

Expected: 3 passed.

- [ ] **Step 8: Measure the blast radius — the whole server suite, foreground.** The tmux poison is a
  harness-wide widening, so it is measured before anything else builds on it.

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
```

Expected: green. `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` and `ccd-session-state` are
the known load flakes — re-run any red one **in isolation** before treating it as a break. **If a suite
reds because a snippet was reaching the live tmux server, the finding is that it was; the fix is a
`tmux() { … }` FUNCTION stub in that file, never removing the poison.** `TMUX_STUB_RC=0` is available
for a case that needs the call to succeed.

- [ ] **Step 9: Commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/test/ccdWsHelpers.ts server/test/lifecycleHelpers.ts server/test/lifecycle-harness-tmux.test.ts && git commit -m "test(w2): contain tmux in the ccd harness, and one shared journal reader" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The `_lc_*` block skeleton — constants, the closed vocabularies, the clock

**AGENT-FIRST, ships DARK.** Nothing in waves 2-3 has a server reader; the journal fills and nothing
reads it until wave 4.

**Two standing rules every ccd task below obeys.**
**(a) `ownership.test.ts` re-stamps or it reds.** `server/test/ownership.test.ts:148-151` gates the
committed `ccd/ccd` on its line-2 `# ccrc:generated 1 sha256=…` marker. Every task that edits `ccd/ccd`
re-stamps before `git add`:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

`markGenerated` is idempotent. Omitting it reds `ownership.test.ts` with
`ccd/ccd was edited without re-stamping its provenance marker`.
**(b) `wsaudit.test.ts` stays green with ZERO edits, in every task.** That is an assertion of this
program. The journal field is spelled `refusal`, never `refused`; no `_lc_*` docstring may contain the
literal `"refused":"`, `"verdict":"`, `_reap_refuse <word>`, or an apostrophe followed by `!`.

**Files:**
- Modify `ccd/ccd` — insert a new block after line **727**'s `}` (which closes `_json_str`; 728 is
  blank, `_ws_status() {` opens at 729).
- Modify `ccd/ccd` — the dot-artifact inventory sentence at lines **1536-1538**.
- Create `server/test/ccd-lifecycle-emit.test.ts`.
- Does NOT touch `server/test/lifecycle-constants-twin.test.ts` — **Task 9 owns that file**. This task is what flips its wave-2 world from `absent` to `present`.

**Interfaces:**
- Consumes: `REG` (`ccd:9`), `set -uo pipefail` (`ccd:7`, no `-e`); from `../../shared/api.js` (wave 1)
  `LIFECYCLE_ACTS`, `LIFECYCLE_OUTCOMES`, `LC_ACT_UNKNOWN`, `LC_LINE_MAX`, `LC_REASON_MAX_BYTES`,
  `LC_GEN_MAX_BYTES`, `LC_GEN_KEEP`.
- Produces (bash, file scope): `_LC_DIR`, `_LC_LINE_MAX`, `_LC_DEC_MAX`, `_LC_GEN_MAX_BYTES`,
  `_LC_GEN_KEEP`, `_LC_SEQ`, `_LC_OBS`; arrays `_LC_ACTS` (= `LIFECYCLE_ACTS` minus `LC_ACT_UNKNOWN`,
  21 members) and `_LC_OUTCOMES` (5 members incl. `unknown`).
- Produces (bash, functions): `_lc_now_ns` — no arguments, 19 ASCII digits on stdout, always rc 0.
  `_lc_tx` — no arguments, `<19-digit ns>.<BASHPID>.<seq>` on stdout, always rc 0.
- Produces (source markers, and they ARE an interface — two test files slice on these literals):
  `# ── lifecycle journal ` … `LC-BEGIN ──` and `# ── end lifecycle journal ` … `LC-END ──`.

**Steps:**

- [ ] **Step 1: Write the failing vocabulary test.** Create `server/test/ccd-lifecycle-emit.test.ts`:

```ts
// server/test/ccd-lifecycle-emit.test.ts
//
// The lifecycle journal's own vocabulary and clock, read by EXECUTING ccd rather
// than grepping it — `wrapper-roster-fixture.test.ts`'s rule: compare a SET
// against ccd's own answer space, BOTH DIRECTIONS, never "each row got an
// answer". `_LC_ACTS` is a declared bash array, so `"${_LC_ACTS[@]}"` is the
// strongest reading available.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES, LC_ACT_UNKNOWN } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-emit-'); });
afterEach(() => { h.cleanup(); });

const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);

describe('_LC_ACTS / _LC_OUTCOMES — the closed vocabularies, bound to L0', () => {
  it('is set-equal to LIFECYCLE_ACTS minus the degrade name, BOTH directions', () => {
    // Mutant: drop `attic-drop` from `_LC_ACTS` -> this fails with
    // `expected [ …20 acts… ] to deeply equal [ …21 acts… ]`, and an act ccd
    // emits would degrade to `unknown` on a build that models it perfectly well.
    const want = LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN);
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(21);
    const got = lines(h.sh('printf "%s\\n" "${_LC_ACTS[@]}"'));
    expect([...got].sort()).toEqual([...want].sort());
    expect(got, 'unknown is the READER\'s degrade, never a call site\'s choice')
      .not.toContain(LC_ACT_UNKNOWN);
  });

  it('spells every act kebab-lowercase', () => {
    for (const a of lines(h.sh('printf "%s\\n" "${_LC_ACTS[@]}"'))) {
      expect(a, `${a} is not kebab-lowercase`).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('is set-equal to LIFECYCLE_OUTCOMES, degrade name INCLUDED', () => {
    // The asymmetry is deliberate: `_lc_emit` writes `outcome:"unknown"` itself,
    // so ccd must know the word; it never writes `act:"unknown"` from a caller's
    // token without also writing `badact`.
    const got = lines(h.sh('printf "%s\\n" "${_LC_OUTCOMES[@]}"'));
    expect([...got].sort()).toEqual([...LIFECYCLE_OUTCOMES].sort());
  });
});

describe('_lc_now_ns — 19 digits, always', () => {
  it('answers 19 ASCII digits on a box whose date supports %N', () => {
    expect(h.sh('_lc_now_ns')).toMatch(/^[0-9]{19}$/);
  });

  it('still answers 19 digits when date cannot do %N — never the literal N', () => {
    // Mutant: delete the `[[ "$ns" =~ ^[0-9]{19}$ ]] ||` fallback rung -> this
    // fails with `expected '1787327575N' to match /^[0-9]{19}$/`, and the
    // generation filename would sort wrong for ever after.
    const out = h.sh('date() { case "$*" in *%N*) echo "1787327575N" ;; *) echo 1787327575 ;; esac; }; _lc_now_ns');
    expect(out).toMatch(/^[0-9]{19}$/);
    expect(out).toBe('1787327575000000000');
  });

  it('answers 19 digits even when date cannot be run at all', () => {
    expect(h.sh('date() { return 127; }; _lc_now_ns')).toMatch(/^[0-9]{19}$/);
  });
});

describe('_lc_tx — a correlation id, minted at the call site, never a global', () => {
  it('is uid-shaped and distinct across two calls in one process', () => {
    const out = h.sh('a=$(_lc_tx); b=$(_lc_tx); printf "%s\\n%s\\n" "$a" "$b"');
    const [a, b] = lines(out);
    expect(a).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect(b).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Confirm Task 9's twin test currently reads the wave-2 world as `absent`.**

  Task 9 already created `server/test/lifecycle-constants-twin.test.ts`, deliberately written to be
  GREEN before this wave, GREEN after it, and RED only in the illegal half-landed middle. Do not
  create a second copy of it — read it, and confirm it currently takes its absent-world branch:

  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-constants-twin.test.ts
  ```

  Expected: PASS, with the wave-2 world classified `absent` (ccd declares none of `_LC_DIR`,
  `_LC_LINE_MAX`, `_LC_GEN_MAX_BYTES`, `_LC_GEN_KEEP` yet). If it is already `present`, this wave
  has been partly applied — stop and reconcile before continuing.

- [ ] **Step 3: Run both and see them fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts
```

Expected: red. The vocabulary cases fail with bash's `_LC_ACTS: unbound variable` on stderr and
`expected [] to deeply equal [ 'archive', … ]`; the clock cases with `_lc_now_ns: command not found`.
`lifecycle-constants-twin.test.ts` stays GREEN throughout — it is Task 9's all-or-nothing world
classifier, and an absent world is legal.

- [ ] **Step 4: Write the block.** In `ccd/ccd`, insert after line **727**'s `}` (i.e. after the blank
  line 728) and before line 729's `_ws_status() {`:

```bash
# ── lifecycle journal ──────────────────────────────────────────── LC-BEGIN ──
# THE APPEND-ONLY RECORD `_reg_purge` CANNOT REACH.
#
# `$REG/.lifecycle/` is a dot-prefixed DIRECTORY, and that is the whole reason
# the feature is possible: `_reg_purge`'s suffix filter globs `$REG/<id>.*` and
# ids never begin with a dot, so no per-session field can hold a destruction
# record but a dotted directory is untouchable. Precedent already load-bearing:
# `$REG/.reaped/` has had zero deleters in this file since Aug 6.
#
# THE INVENTORY AT ccd:1536 IS AMENDED IN THIS SAME COMMIT — it counted seven
# dot-prefixed artifacts and this block adds an eighth. That comment counts
# DIRECTORIES, not their contents (`.reaped/` is one entry, its tombstones are
# not counted), so `.lifecycle/`'s generations, `errors` and `.rotate.lock` are
# counted WITH it. An inventory a future writer copies is exactly the defect
# `_reg_purge`'s own header records having shipped once.
#
# EVERY FUNCTION HERE RETURNS 0 ON EVERY PATH except `_lc_refuse`, which emits
# and then `die`s so refusal and death cannot drift. The journal is best-effort
# and NEVER gates an act: the disk condition that makes an append fail is
# exactly the condition in which `ws-rm`/`ws-gc --prune`/`ws-reap` are the
# recovery tools. One unrecorded destruction is a gap in a record; a fleet that
# cannot clean up is an outage. A failed append bumps `.lifecycle/errors`.
#
# THE WRAPPERS BIND THEIR POSITIONALS WITH `${1-}`, NOT `$1`. ccd runs
# `set -uo pipefail`: a function reading an unset positional EXITS THE SHELL, it
# does not return. With 21 hand-written call sites, one dropped `""` would turn
# a destructive verb into a mid-verb abort — the precise failure "the journal
# never gates an act" exists to prevent, arriving through the journal itself.
#
# `_lc_refuse` therefore enters `ccd-die-containment.test.ts`'s can-die set:
# it must never be wrapped in `$( )`. `_lc_emit`/`_lc_obs`/`_lc_live`/
# `_lc_rotate`/`_lc_tx`/`_lc_json`/`_lc_err`/`_lc_surface_norm`/`_lc_dec_ok`
# are die-free and safe to capture.
#
# NO CARRY GLOBALS. `tip`, `attic` and `tx` are ARGUMENTS. The `LC_TIP=` idiom
# dies under `set -u` on the first call in a process and appends a blank line
# nobody notices. `_LC_SEQ` and `_LC_OBS` are the two exceptions and both are
# initialised HERE at file scope — the `_REG_SET_SEQ` precedent (ccd:434) — so
# `set -u` can never reach an unset read. They carry no event payload.
_LC_DIR="$REG/.lifecycle"
_LC_LINE_MAX=2048                # twin of L0's LC_LINE_MAX      (BYTES)
_LC_DEC_MAX=512                  # twin of L0's LC_REASON_MAX_BYTES (BYTES)
_LC_GEN_MAX_BYTES=4194304        # twin of L0's LC_GEN_MAX_BYTES — 4 MiB
_LC_GEN_KEEP=4                   # twin of L0's LC_GEN_KEEP — ~a year at ~35 KB/day
_LC_SEQ=0
_LC_OBS=""

# THE CLOSED VOCABULARY, and its twin lives in `shared/api.ts` as
# `LIFECYCLE_ACTS`. `server/test/ccd-lifecycle-emit.test.ts` reads THIS array by
# running it and asserts set equality against L0 in both directions. `unknown`
# is DELIBERATELY ABSENT here and present in L0: it is the READER's degrade, not
# a call site's choice. `_lc_emit` maps an unrecognised act to `unknown` plus a
# `badact` field, which is what makes the equality hold by construction rather
# than by everyone remembering.
_LC_ACTS=(archive attic-drop claim create destroy enable ensure forget gc-prune
          hold purge reap release rename restore spawn start stop supervise
          swap unsupervise)
# Outcomes DO include the degrade word, because `_lc_emit` writes it itself.
_LC_OUTCOMES=(intent done refused failed unknown)

_lc_now_ns() {   # -> exactly 19 ASCII digits of epoch nanoseconds, on stdout
  # THREE RUNGS, because `%N` is not portable and its failure is silent and
  # poisonous: busybox `date` emits the literal `N`, which makes a generation
  # FILENAME that sorts wrong for ever (the greatest name is the live one) and
  # a `uid` that collides. The only sub-second precedent in this file is
  # ccd:3383's `+%s%3N`, milliseconds, error-suppressed for the same reason.
  local ns
  ns=$(date +%s%N 2>/dev/null)
  [[ "$ns" =~ ^[0-9]{19}$ ]] || ns="$(date +%s 2>/dev/null)000000000"
  [[ "$ns" =~ ^[0-9]{19}$ ]] || ns=0000000000000000000
  printf '%s' "$ns"
}

_lc_tx() {   # -> a correlation id for ONE intent/outcome pair, on stdout
  # Callers hold it in a `local` and pass it to both halves. It is minted here
  # rather than returned by `_lc_intent` so that the emit itself never runs in a
  # subshell — `_lc_obs`'s memo and `_LC_SEQ` are both lost across `$( )`, and
  # `_lc_obs` reads /proc and shells `tmux list-panes`.
  #
  # UNIQUENESS, honestly: called as `$(_lc_tx)` this runs in a SUBSHELL, so
  # `_LC_SEQ` is 1 every time and the guarantee rests on `$BASHPID` (a subshell
  # pid, distinct from the parent's, so a tx can never collide with an event
  # uid) plus a nanosecond clock read one fork apart.
  _LC_SEQ=$(( _LC_SEQ + 1 ))
  printf '%s.%s.%s' "$(_lc_now_ns)" "$BASHPID" "$_LC_SEQ"
}
# ── end lifecycle journal ────────────────────────────────────────── LC-END ──
```

- [ ] **Step 5: Amend the dot-artifact inventory.** In `ccd/ccd`, replace lines **1536-1538**:

```bash
# NOT reachable this way, and this set IS the boundary — seven dot-prefixed
# artifacts live under `$REG`; the four above are reachable, these three are
# not: `$REG/.reaped/` (a directory, not a `.reaped.<suffix>` file — no id's
```

with:

```bash
# NOT reachable this way, and this set IS the boundary — EIGHT dot-prefixed
# artifacts live under `$REG`; the four above are reachable, these four are
# not: `$REG/.lifecycle/` (the lifecycle journal — a dotted DIRECTORY for
# exactly this reason; see the LC-BEGIN block, and note that its generations,
# `errors` and `.rotate.lock` are counted WITH it, as `.reaped/`'s tombstones
# are counted with `.reaped/`); `$REG/.reaped/` (a directory, not a
# `.reaped.<suffix>` file — no id's
```

- [ ] **Step 6: Run both files to green.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts
```

Expected: green — 6 `it`s in `ccd-lifecycle-emit` and 5 vitest cases in `lifecycle-constants-twin`
(`it.each` expands per row: 4 + 1).

- [ ] **Step 7: Watch the ownership gate work, then re-stamp.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/wsaudit.test.ts test/ownership.test.ts
```

Expected **before** the re-stamp: `ownership.test.ts` RED with
`ccd/ccd was edited without re-stamping its provenance marker`. That red is the gate working.
`wsaudit.test.ts` green with zero edits. Then:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && cd server && ./node_modules/.bin/vitest run test/wsaudit.test.ts test/ownership.test.ts
```

Expected: both green.

- [ ] **Step 8: Commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-lifecycle-emit.test.ts server/test/lifecycle-constants-twin.test.ts && git commit -m "ccd(w2): lifecycle block skeleton — _LC_ACTS, _LC_OUTCOMES, the caps, _lc_now_ns, _lc_tx" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `_lc_obs` and `_lc_obs_json` — the kernel-observed identity, memoised once per process

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — inside the LC block, after `_lc_tx`'s closing `}`, before `# ── end lifecycle journal`.
- Modify `server/test/ccd-lifecycle-emit.test.ts` — append one `describe`.

**Interfaces:**
- Consumes: `_LC_OBS` (Task 12), `/proc/<pid>/cgroup`, `/proc/<pid>/status`, `tmux list-panes`,
  `$SSH_CONNECTION`, `python3`.
- Produces:
  - `_lc_cgroup_read` — no arguments, this process's `0::` cgroup path on stdout, rc 0.
  - `_lc_ppid_of <pid>` — the `PPid:` line's value on stdout, or nothing. rc 0.
  - `_lc_obs_json <cg> <cgraw> <pid> <ppid> <pane> <paneWhy> <tty> <ssh>` — one JSON object on stdout;
    non-zero means python3 could not be run. **This is the second and LAST python3 encoder in this
    block** — it builds the obs FRAGMENT once per process, where `_lc_json` builds an EVENT once per
    line. A third is a defect.
  - `_lc_obs` — no arguments, prints nothing on stdout or stderr, always rc 0, populates `_LC_OBS` with
    one JSON object (or the four bytes `null`) exactly once per process.
- Wire shape (L0's `LifecycleObs`): `cg` ∈ `agent|pane|supervisor|login|unknown`; `cgraw` string;
  `pid`/`ppid` number|null; `pane` string|null; `paneWhy` string|null; `tty` **boolean**|null;
  `ssh` **the `$SSH_CONNECTION` string**|null — not a boolean.

**Steps:**

- [ ] **Step 1: Write the failing test.** Append to `server/test/ccd-lifecycle-emit.test.ts`:

```ts
describe('_lc_obs — kernel-observed, memoised, never a decision', () => {
  const OBS = `_lc_obs_probe() { _lc_obs; printf '%s' "$_LC_OBS"; }`;

  it('classifies a supervisor cgroup and keeps the raw path verbatim', () => {
    const raw = '/user.slice/user-1000.slice/user@1000.service/app.slice/claude-session@ccrc-pwa-still-river.service';
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '${raw}'; }
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['cg']).toBe('supervisor');
    expect(o['cgraw'], 'the raw path is NEVER dropped — it is the unforgeable half').toBe(raw);
  });

  it.each([
    ['/user.slice/x/app.slice/ccrc-agent.service', 'agent'],
    ['/user.slice/x/app.slice/tmux-spawn-3f2a.scope', 'pane'],
    ['/user.slice/user-1000.slice/session-7.scope', 'login'],
    ['/some/thing/nobody/modelled', 'unknown'],
  ])('resolves %s to %s', (raw, want) => {
    const o = JSON.parse(h.sh(`${OBS} _lc_cgroup_read() { printf '%s' '${raw}'; }; _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['cg']).toBe(want);
  });

  it('a pane inside a SUPERVISOR cgroup reads `pane` — the precedence is deliberate', () => {
    // Mutant: move the `claude-session@*.service` arm above the
    // `tmux-spawn-*.scope` one -> this fails with `expected 'supervisor' to be
    // 'pane'`. The supervisor is what STARTED the process; the pane scope is
    // where it is RUNNING, and the innermost fact is the observed one.
    const raw = '/user.slice/user@1000.service/app.slice/claude-session@x.service/tmux-spawn-9.scope';
    const o = JSON.parse(h.sh(`${OBS} _lc_cgroup_read() { printf '%s' '${raw}'; }; _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['cg']).toBe('pane');
  });

  it('says WHY there is no pane rather than answering a bare null', () => {
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      ${NO_TMUX}
      command() { if [[ "$2" == tmux ]]; then return 1; fi; builtin command "$@"; }
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['pane']).toBeNull();
    expect(o['paneWhy'], 'a null with no reason is the overloaded null this file bans').toBe('no-tmux');
  });

  it('says `not-listed` when tmux is there and does not answer — the harness default', () => {
    const o = JSON.parse(h.sh(`${OBS} _lc_cgroup_read() { printf '%s' '/x'; }; _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['paneWhy'], 'the harness plants a REFUSING tmux, so this is the default answer')
      .toBe('not-listed');
    expect(h.tmuxCalls(), 'and it reached the poison, never the live server').toEqual(['list-panes -a -F #{session_name} #{pane_pid}']);
  });

  it('names the tmux session when an ancestor pid is a pane pid', () => {
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      tmux() { echo "cc-claude2 $$"; }
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['pane']).toBe('cc-claude2');
    expect(o['paneWhy']).toBe('ok');
  });

  it('carries ssh as the CONNECTION STRING and tty as a boolean', () => {
    // L0's LifecycleObs: `ssh: string | null`, `tty: boolean | null`. A boolean
    // ssh would throw away the only address the record ever sees.
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      SSH_CONNECTION='10.0.0.2 51000 10.0.0.9 22'
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['ssh']).toBe('10.0.0.2 51000 10.0.0.9 22');
    expect(typeof o['tty']).toBe('boolean');
  });

  it('MEMOISES — /proc and tmux are read once per process, not once per event', () => {
    // Mutant: delete the `[[ -z "$_LC_OBS" ]] || return 0` guard -> this fails
    // with `expected 3 to be 1`, and every emit re-shells `tmux list-panes`.
    const out = h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      tmux() { echo tmuxcall >> "$HOME/obs-calls"; echo "none 999999"; }
      _lc_obs; _lc_obs; _lc_obs
      wc -l < "$HOME/obs-calls"`);
    expect(Number(out.trim())).toBe(1);
  });

  it('answers the four bytes `null` — never a fabricated object — when python3 is gone', () => {
    const out = h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      python3() { return 127; }
      _lc_obs_probe`);
    expect(out.trim()).toBe('null');
  });

  it('never writes to stdout or stderr of its own accord', () => {
    expect(h.sh(`_lc_cgroup_read() { printf '%s' '/x'; }; _lc_obs 2>&1; printf END`)).toBe('END');
  });
});
```

  and extend that file's import block with the shared reader (it is used from Task 15 onward too):

```ts
import { NO_TMUX, readJournal, measOf, decOf } from './lifecycleHelpers.js';
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts
```

Expected: the ten new declarations (13 vitest cases — the `it.each` expands to four) fail; the first
with `_lc_obs: command not found` on stderr and `SyntaxError: Unexpected end of JSON input` from
`JSON.parse('')`.

- [ ] **Step 3: Write the three functions.** In `ccd/ccd`, insert inside the LC block after `_lc_tx`'s
  closing `}`:

```bash
_lc_cgroup_read() {   # -> this process's `0::` cgroup path, verbatim, on stdout
  # Its own function so a test can plant a cgroup without a container. The
  # `0::` line is the unified-hierarchy one; on this box it is the only line.
  sed -n 's/^0:://p' "/proc/$$/cgroup" 2>/dev/null | head -1
}

_lc_ppid_of() {   # pid -> its PPid, on stdout, or nothing
  # `/proc/<pid>/status`'s `PPid:` line, NEVER `stat` field 4: `comm` is field 2
  # and can contain spaces AND parentheses, so every positional read of `stat`
  # is wrong for a process someone named `foo) 1 2 3 (bar`.
  sed -n 's/^PPid:[[:space:]]*//p' "/proc/${1-}/status" 2>/dev/null | head -1
}

_lc_obs_json() {   # cg cgraw pid ppid pane paneWhy tty ssh -> one JSON object
  # THE SECOND AND LAST python3 ENCODER IN THIS BLOCK. `_lc_json` builds an
  # EVENT, once per line; this builds the obs FRAGMENT, once per process. A
  # THIRD encoder in this block is a defect — it is how `"pane":,` gets written
  # by a printf argument list that swallowed `_json_str`'s status (ccd:711-713).
  LC_ALL=C.UTF-8 python3 -c '
import json, sys
k = ["cg", "cgraw", "pid", "ppid", "pane", "paneWhy", "tty", "ssh"]
o = dict(zip(k, sys.argv[1:9]))
for n in ("pid", "ppid"):
    o[n] = int(o[n]) if o[n].isdigit() else None
o["pane"] = o["pane"] or None
o["tty"] = o["tty"] == "true"
# `ssh` IS THE CONNECTION STRING, not a boolean: L0 types it `string | null`,
# and folding it to true/false throws away the only address the record sees.
o["ssh"] = o["ssh"] or None
sys.stdout.write(json.dumps(o, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
' "$@"
}

_lc_obs() {   # populate _LC_OBS once per process. Prints NOTHING. Always 0.
  # THE UNFORGEABLE FAMILY. `dec` is what a caller SAID; this is what the kernel
  # says. Nothing here computes a single "who" — `corroboration()` in L0 relates
  # the two and a disagreement is a fact the operator sees, never a silently
  # picked winner. A double fork makes a caller ANONYMOUS (ppid 1), never
  # someone else.
  [[ -z "$_LC_OBS" ]] || return 0

  local cgraw cg pid ppid pane panewhy tty ssh panes p depth sname spid
  pid=$$
  cgraw=$(_lc_cgroup_read)
  # ORDER IS PRECEDENCE, and the innermost fact wins. A pane started by the
  # supervisor sits inside BOTH cgroups; the scope it is RUNNING in is the
  # observed fact, the unit that started it is provenance the path still
  # carries verbatim in `cgraw`.
  case "$cgraw" in
    */ccrc-agent.service*)        cg=agent ;;
    */tmux-spawn-*.scope*)        cg=pane ;;
    */claude-session@*.service*)  cg=supervisor ;;
    */session-*.scope*)           cg=login ;;
    *)                            cg=unknown ;;
  esac
  ppid=$(_lc_ppid_of "$pid"); [[ "$ppid" =~ ^[0-9]+$ ]] || ppid=""

  # THE PANE IS AN INTERSECTION, and its absence gets a REASON. A bare null
  # would fold "no tmux on this box", "tmux did not answer" and "no ancestor is
  # a pane" into one value a reader cannot act on — the overloaded null at a
  # seam this repo bans by name.
  pane=""; panewhy=no-ancestor
  if ! command -v tmux >/dev/null 2>&1; then
    panewhy=no-tmux
  elif ! panes=$(tmux list-panes -a -F '#{session_name} #{pane_pid}' 2>/dev/null); then
    panewhy=not-listed
  else
    p="$pid"; depth=0
    # The regex runs FIRST and every arithmetic test is downstream of it: `p`
    # comes off /proc, and bash evaluates a variable's CONTENTS as arithmetic
    # (ccd:8784-8787 is the paid lesson). `depth` bounds a /proc that lies.
    while [[ "$p" =~ ^[0-9]+$ ]] && (( p > 1 )) && (( depth < 16 )); do
      while IFS=' ' read -r sname spid; do
        [[ "$spid" == "$p" ]] && { pane="$sname"; break; }
      done <<< "$panes"
      [[ -n "$pane" ]] && { panewhy=ok; break; }
      p=$(_lc_ppid_of "$p")
      depth=$(( depth + 1 ))
    done
  fi

  tty=false; [[ -t 0 ]] && tty=true
  ssh="${SSH_CONNECTION-}"

  # ONE fork for the whole fragment, MEMOISED — not eight `_json_str`
  # substitutions, each of which swallows its own status inside a printf
  # argument list (ccd:711-713) and prints `"pane":,` when the interpreter is
  # gone. NO python3 means the four bytes `null`: not measured is a different
  # fact from measured-as-empty, and `null` is also non-empty, so the memo holds
  # and this whole function does not re-run on every event.
  _LC_OBS=$(_lc_obs_json "$cg" "$cgraw" "$pid" "$ppid" "$pane" "$panewhy" "$tty" "$ssh" 2>/dev/null) \
    || _LC_OBS=null
  [[ -n "$_LC_OBS" ]] || _LC_OBS=null
  return 0
}
```

- [ ] **Step 4: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts
```

Expected: green — 19 vitest cases (6 from Task 12 + 13 here).

- [ ] **Step 5: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-emit.test.ts && git commit -m "ccd(w2): _lc_obs and _lc_obs_json — kernel-observed identity, memoised once per process" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: `_lc_live` and `_lc_rotate` — generations by filename, mint-a-greater-name, never truncate

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — inside the LC block, after `_lc_obs`'s closing `}`.
- Create `server/test/ccd-lifecycle-gen.test.ts`.

**Interfaces:**
- Consumes: `_LC_DIR`, `_LC_GEN_MAX_BYTES`, `_LC_GEN_KEEP`, `_lc_now_ns` (Task 12); `generationsOf`,
  `lcDir` from `./lifecycleHelpers.js` (Task 11).
- Produces:
  - `_lc_live` — no arguments; the live generation's path on stdout, **empty string** when the
    directory cannot be made. Always rc 0.
  - `_lc_rotate <live-path>` — prints nothing, always rc 0. **MINT-A-GREATER-NAME, NEVER TRUNCATE:**
    the full generation is neither renamed nor rewritten; a new, greater name appears beside it.
    Retention prunes the smallest names and **never the greatest**.

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-lifecycle-gen.test.ts`:

```ts
// server/test/ccd-lifecycle-gen.test.ts
//
// The generation is IN THE FILENAME, not in a header line: a `readdir` alone
// tells the mirror the whole generation set with no second read, a rotation is
// "a new name appeared" rather than "the same file got smaller", and a shrink on
// an immutably-named generation is unambiguously a truncation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LC_GEN_PREFIX, LC_GEN_SUFFIX, LC_ROTATE_LOCK_NAME } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { generationsOf, lcDir } from './lifecycleHelpers.js';

let h: CcdHarness;
let dir: string;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-gen-'); dir = lcDir(h.home); });
afterEach(() => { h.cleanup(); });

const gen = (ns: string): string => `${LC_GEN_PREFIX}${ns}${LC_GEN_SUFFIX}`;
const gens = (): string[] => generationsOf(h.home);

describe('_lc_live', () => {
  it('mints the directory and the first generation, and its name is 19 digits', () => {
    const p = h.sh('_lc_live');
    expect(p).toMatch(/\.lifecycle\/journal-\d{19}\.ndjson$/);
    expect(fs.existsSync(p)).toBe(true);
    expect(gens()).toHaveLength(1);
  });

  it('is idempotent — a second call reuses the same generation, it does not mint', () => {
    const a = h.sh('_lc_live'); const b = h.sh('_lc_live');
    expect(b).toBe(a);
    expect(gens()).toHaveLength(1);
  });

  it('picks the GREATEST name, not the newest mtime', () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1000000000000000000', '3000000000000000000', '2000000000000000000']) {
      fs.writeFileSync(path.join(dir, gen(n)), '');
    }
    fs.utimesSync(path.join(dir, gen('1000000000000000000')), new Date(), new Date());
    expect(h.sh('_lc_live')).toBe(path.join(dir, gen('3000000000000000000')));
  });

  it('answers the empty string rather than dying when the directory cannot be made', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.lifecycle'), 'not a directory');
    expect(h.sh('_lc_live; printf END')).toBe('END');
  });
});

describe('_lc_rotate', () => {
  const big = (name: string): string => {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x'.repeat(4 * 1024 * 1024 + 1));
    return p;
  };

  it('does nothing at all below the cap', () => {
    const p = h.sh('_lc_live');
    fs.appendFileSync(p, 'small\n');
    h.sh(`_lc_rotate "${p}"`);
    expect(gens()).toHaveLength(1);
    expect(fs.readFileSync(p, 'utf8')).toBe('small\n');
  });

  it('MINTS A GREATER NAME and leaves the full one byte-identical — it never truncates', () => {
    // Mutant: replace the mint with `: > "$live"` -> this fails with
    // `the full generation must survive byte-for-byte: expected 0 to be 4194305`,
    // and `agent/src/tail.ts:53-58` hands its reader a reset it must model.
    const p = big(gen('1000000000000000000'));
    const before = fs.statSync(p).size;
    h.sh(`_lc_rotate "${p}"`);
    expect(gens()).toHaveLength(2);
    expect(fs.statSync(p).size, 'the full generation must survive byte-for-byte').toBe(before);
  });

  it('drops the OLDEST beyond four generations', () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000000000000`)), 'x');
    }
    const p = big(gen('5000000000000000000'));
    h.sh(`_lc_rotate "${p}"`);
    const left = gens();
    expect(left).toHaveLength(4);
    expect(left).toContain(gen('5000000000000000000'));
    expect(left).not.toContain(gen('1000000000000000000'));
  });

  it('NEVER prunes the generation it just minted, even beside a future-dated name', () => {
    // Mutant: delete the `!= "$live_now"` conjunct -> this fails with
    // `the freshly minted generation was pruned: expected [...] to contain ...`.
    // Production names are monotonic, so this cannot bite today; nothing stated
    // or enforced that, and a rotation that eats its own mint never converges —
    // `_lc_live` picks the full generation again on the very next event.
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000000000000`)), 'x');
    }
    const p = big(gen('9000000000000000000'));   // greater than any clock read
    h.sh(`_lc_rotate "${p}"`);
    const minted = gens().filter((f) => f !== gen('9000000000000000000')
      && !['1', '2', '3', '4'].some((n) => f === gen(`${n}000000000000000000`)));
    expect(minted, 'nothing was minted — the fixture is wrong, not the guard').toHaveLength(1);
    expect(gens(), 'the freshly minted generation was pruned').toContain(minted[0]!);
  });

  it('SKIPS rotation rather than dying when flock is unavailable', () => {
    // Every other flock site in ccd (1760, 3070, 5910) `die`s here. This one
    // must not: D7 forbids the journal from gating anything, so the generation
    // is allowed to grow past its cap instead.
    const p = big(gen('1000000000000000000'));
    const out = h.sh(`command() { if [[ "$2" == flock ]]; then return 1; fi; builtin command "$@"; }
      _lc_rotate "${p}"; printf END`);
    expect(out).toBe('END');
    expect(gens()).toHaveLength(1);
  });

  it('never unlinks the rotate lock', () => {
    const p = big(gen('1000000000000000000'));
    h.sh(`_lc_rotate "${p}"`);
    expect(fs.existsSync(path.join(dir, LC_ROTATE_LOCK_NAME)),
      'unlinking a held lock is how two processes come to hold it on two inodes (ccd:1531-1534)').toBe(true);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-gen.test.ts
```

Expected: all 10 fail; the first with `_lc_live: command not found` on stderr and
`expected '' to match /\.lifecycle\/journal-\d{19}\.ndjson$/`.

- [ ] **Step 3: Write both functions.** In `ccd/ccd`, insert inside the LC block after `_lc_obs`'s
  closing `}`:

```bash
_lc_live() {   # -> the generation to append to, on stdout. Mints one if none.
  # THE GREATEST NAME IS THE LIVE ONE. Fixed-width 19 ASCII digits, so byte
  # order IS numeric order in every locale — which is why `_lc_now_ns` is
  # allowed no shorter answer. The comparison is `LC_ALL=C` for the same reason
  # the prune below is: one ordering claim, one collation, stated twice.
  local f newest="" LC_ALL=C
  mkdir -p -- "$_LC_DIR" 2>/dev/null || { printf '%s' ''; return 0; }
  for f in "$_LC_DIR"/journal-*.ndjson; do
    [[ -f "$f" ]] || continue                      # unmatched glob stays literal: no nullglob here
    [[ -z "$newest" || "$f" > "$newest" ]] && newest="$f"
  done
  if [[ -z "$newest" ]]; then
    newest="$_LC_DIR/journal-$(_lc_now_ns).ndjson"
    # `>>`, never `>`: the create form that CANNOT truncate, even if two
    # processes reach it at once.
    : >> "$newest" 2>/dev/null || { printf '%s' ''; return 0; }
  fi
  printf '%s' "$newest"
}

_lc_rotate() {   # live-path — mint a fresh generation when the live one is full
  # MINT-A-GREATER-NAME, NEVER TRUNCATE: the full generation is neither renamed
  # nor rewritten, and a new, greater name appears beside it. A truncate would
  # shrink a file the mirror is reading, and `agent/src/tail.ts:53-58` hands its
  # reader a RESET it must model; the whole point of putting the generation in
  # the NAME is that a rotation is a new name appearing rather than an old file
  # getting smaller. Retention is a CEILING, not a schedule: 4 x 4 MiB at the
  # measured ~35 KB/day is about a year.
  #
  # DIE-FREE AND REFUSAL-FREE, unlike every other flock site in this file
  # (1760, 3070, 5910, all of which `die` or answer a refusal). D7 forbids the
  # journal from gating an act, so a missing or contested lock SKIPS the
  # rotation and lets the generation grow past its cap. `.rotate.lock` is NEVER
  # unlinked — ccd:1531-1534 is why.
  local live="${1-}" sz lock lfd f n live_now gens=()
  [[ -n "$live" && -f "$live" ]] || return 0
  sz=$(stat -c %s -- "$live" 2>/dev/null)
  [[ "$sz" =~ ^[0-9]+$ ]] || return 0              # regex BEFORE the arithmetic, always
  (( sz >= _LC_GEN_MAX_BYTES )) || return 0

  command -v flock >/dev/null 2>&1 || return 0
  lock="$_LC_DIR/.rotate.lock"
  exec {lfd}>>"$lock" 2>/dev/null || return 0
  flock -n "$lfd" 2>/dev/null || { exec {lfd}>&-; return 0; }

  # Re-measured UNDER the lock: another ccd may have rotated between the test
  # above and the acquisition, and a second mint would burn a generation slot.
  sz=$(stat -c %s -- "$live" 2>/dev/null)
  if [[ "$sz" =~ ^[0-9]+$ ]] && (( sz >= _LC_GEN_MAX_BYTES )); then
    : >> "$_LC_DIR/journal-$(_lc_now_ns).ndjson" 2>/dev/null
  fi

  for f in "$_LC_DIR"/journal-*.ndjson; do [[ -f "$f" ]] && gens+=("$f"); done
  n=${#gens[@]}                                    # bash 5.2: an empty array under set -u is fine
  if (( n > _LC_GEN_KEEP )); then
    # THE LIVE ONE IS NEVER PRUNED, and the guard is not decoration: the mint
    # above is `_lc_now_ns`, so a future-dated name already on disk makes the
    # freshly minted generation the SECOND-smallest and the prune eats it —
    # after which `_lc_live` picks the full generation again and rotation never
    # converges. Re-read rather than reuse the mint's own name: another ccd may
    # have minted a greater one between the two.
    live_now=$(_lc_live)
    while IFS= read -r f; do
      [[ -n "$f" && "$f" != "$live_now" ]] && rm -f -- "$f"
    done < <(printf '%s\n' "${gens[@]}" | LC_ALL=C sort | head -n $(( n - _LC_GEN_KEEP )))
  fi
  # A CONTRACT, NOT HYGIENE (ccd:5932-5937): flock treats two open()s of one
  # path in one process as two strangers, and ccd is SOURCED, so a descriptor
  # left open here refuses the NEXT rotation in the same shell.
  exec {lfd}>&-
  return 0
}
```

- [ ] **Step 4: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-gen.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-gen.test.ts && git commit -m "ccd(w2): _lc_live and _lc_rotate — generations by filename, never truncate" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: `_lc_err`, `_lc_json` and `_lc_emit` — the one writer, one python3 fork, exit 0 on every path

**AGENT-FIRST, ships DARK.** This is the task the whole design rests on.

**Files:**
- Modify `ccd/ccd` — inside the LC block, after `_lc_rotate`'s closing `}`.
- Modify `server/test/ccd-lifecycle-emit.test.ts` — append two `describe`s.
- Create `server/test/ccd-wsaudit-nonpoison.test.ts`.

**Interfaces:**
- Consumes: `_LC_LINE_MAX`, `_LC_ACTS`, `_LC_OUTCOMES`, `_LC_SEQ`, `_LC_OBS` (Task 12); `_lc_obs`
  (Task 13); `_lc_live`, `_lc_rotate` (Task 14).
- Produces:
  - `_lc_err` — no arguments, prints nothing, always rc 0, increments `$_LC_DIR/errors` by temp+rename.
    **It mints `$_LC_DIR` itself**: the error counter must be writable in exactly the state the journal
    is not, and it is the one place besides `_lc_live` that creates the directory.
  - `_lc_json <cap> <uid> <ns> <act> <outcome> <id> <tx> <badact> <badoutcome> <obsjson> [k v]...` —
    one JSON object on stdout. **Non-zero means python3 could not be run and nothing was written.**
    **THE SINGLE-FORK EVENT ENCODER** (the only other python3 in this block is `_lc_obs_json`, which
    builds the obs fragment once per process; a third is a defect).
  - `_lc_emit <act> <outcome> <id> <tx> [key value]...` — **prints nothing on stdout or stderr; returns
    0 on every path.**
- **THE KEY NAMESPACE, and it is the wire contract.** Keys are always dotted and always name their
  family, or are one of five top-level names:
  - `dec.` → the `dec` object: `dec.surface`, `dec.actor`, `dec.reason`.
  - `meas.` → the `meas` object.
  - top-level, exactly: `detail`, `refusal`, `verb`, `badact`, `branchDeleted`.
  - **anything else is DROPPED and NAMED** in a top-level `badkey` string (first offender). That is
    `badact`'s own idiom applied to keys: a key we saw and could not model is a different fact from a
    key that was never passed. `refusal` and `detail` are TOP-LEVEL and are **never** members of the
    drop ladder — an over-cap refusal must still say what it refused.
- **`at` is epoch MILLISECONDS** (`int(ns[:13])`), matching L0's `LifecycleEvent.at`. `atNs` is the
  19-digit string. Both come from ONE clock read, so they cannot disagree about one event.
- A `dec`/`meas` pair whose value is EMPTY is **omitted, not written as `""`** — disclosed and not a
  collapse: every value ccd passes is a `_reg_get` (which `cat`s a missing file to empty) or a git ref
  read, for which "measured as empty" and "not measured" are one condition at this seam.

**Steps:**

- [ ] **Step 1: Write the failing emit tests.** Append to `server/test/ccd-lifecycle-emit.test.ts`:

```ts
describe('_lc_emit — the one writer', () => {
  it('writes one parseable line carrying act, outcome, id, uid, atNs and MILLISECOND at', () => {
    h.sh('_lc_emit destroy intent ccrc-pwa-still-river ""');
    const [e] = readJournal(h.home);
    expect(e!['v']).toBe(1);
    expect(e!['act']).toBe('destroy');
    expect(e!['outcome']).toBe('intent');
    expect(e!['id']).toBe('ccrc-pwa-still-river');
    expect(e!['atNs']).toMatch(/^[0-9]{19}$/);
    // Mutant: `int(ns[:10])` (seconds) -> this fails with
    // `expected 1787327575 to be 1787327575151`, and every event lands 1000x
    // early against a mirror that stores milliseconds.
    expect(e!['at']).toBe(Number(String(e!['atNs']).slice(0, 13)));
    expect(e!['uid']).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
  });

  it('mints a MONOTONIC seq inside one process — two emits never share a uid', () => {
    h.sh('_lc_emit start done a ""; _lc_emit stop done a ""');
    const [x, y] = readJournal(h.home);
    expect(x!['uid']).not.toBe(y!['uid']);
    expect(String(x!['uid']).split('.')[2]).toBe('1');
    expect(String(y!['uid']).split('.')[2], 'the seq lives in _lc_emit\'s own frame, not a subshell').toBe('2');
  });

  it('routes dec.* into dec, meas.* into meas, and defaults surface to "none"', () => {
    h.sh('_lc_emit stop done sess "" dec.surface pwa dec.actor you meas.branch ws/x');
    const [e] = readJournal(h.home);
    expect(e!['dec']).toEqual({ surface: 'pwa', actor: 'you' });
    expect(e!['meas']).toEqual({ branch: 'ws/x' });
    h.sh('_lc_emit stop done sess ""');
    expect(readJournal(h.home)[1]!['dec']).toEqual({ surface: 'none' });
  });

  it('puts refusal, detail, verb and branchDeleted at the TOP LEVEL, never inside meas', () => {
    // Mutant: route bare keys into `meas` -> this fails with
    // `expected undefined to be 'held'`, and wave 4's parser reads `refusal` at
    // the root and finds nothing on EVERY refusal line waves 2-3 write.
    h.sh('_lc_emit destroy refused sess "" refusal held detail "held: program X" verb ws-rm branchDeleted false');
    const [e] = readJournal(h.home);
    expect(e!['refusal']).toBe('held');
    expect(e!['detail']).toBe('held: program X');
    expect(e!['verb']).toBe('ws-rm');
    expect(e!['branchDeleted']).toBe('false');
    expect(e!['meas'], 'nothing top-level leaks into meas').toBeNull();
  });

  it('NAMES a key it cannot model rather than folding it somewhere', () => {
    // badact's own idiom, applied to keys: a key we saw and could not model is
    // a different fact from a key that was never passed.
    h.sh('_lc_emit stop done sess "" nosuchfamily v meas.branch ws/x');
    const [e] = readJournal(h.home);
    expect(e!['badkey']).toBe('nosuchfamily');
    expect(e!['meas']).toEqual({ branch: 'ws/x' });
  });

  it('OMITS a pair whose value is empty — never writes it as ""', () => {
    h.sh('_lc_emit destroy done sess "" meas.branch "" meas.tip 3f2a');
    const [e] = readJournal(h.home);
    expect(e!['meas']).toEqual({ tip: '3f2a' });
    expect(e!['meas']).not.toHaveProperty('branch');
  });

  it('degrades an act L0 never heard of to `unknown` plus badact', () => {
    // Mutant: delete the `_LC_ACTS` membership loop -> this fails with
    // `expected 'teleport' to be 'unknown'`, and lifecycle-vocabulary's set
    // equality stops holding by construction.
    h.sh('_lc_emit teleport done sess ""');
    const [e] = readJournal(h.home);
    expect(e!['act']).toBe('unknown');
    expect(e!['badact']).toBe('teleport');
  });

  it('degrades an unknown outcome the same way', () => {
    h.sh('_lc_emit stop maybe sess ""');
    const [e] = readJournal(h.home);
    expect(e!['outcome']).toBe('unknown');
    expect(e!['badoutcome']).toBe('maybe');
  });

  it('quotes hostile bytes rather than letting them forge a field', () => {
    h.sh(`_lc_emit hold done sess "" dec.reason '","act":"purge","x":"'`);
    const [e] = readJournal(h.home);
    expect(e!['act'], 'a --reason must never be able to forge a field').toBe('hold');
    expect(decOf(e!)['reason']).toBe('","act":"purge","x":"');
  });

  it('keeps every line under LC_LINE_MAX and SAYS SO when it had to drop something', () => {
    h.sh(`_lc_emit hold done sess "" dec.reason '${'z'.repeat(4000)}'`);
    const [e] = readJournal(h.home);
    expect(Buffer.byteLength(JSON.stringify(e), 'utf8')).toBeLessThanOrEqual(2048);
    expect(e!['truncated'], 'a dropped field is a fact, not a silence').toBe(true);
    expect(e!['act']).toBe('hold');
  });

  it('the LAST-RESORT line still carries tx, dec.surface and refusal', () => {
    // Mutant: drop `tx`/`dec`/`refusal` from the fallback dict -> this fails
    // with `expected undefined to be '1787000000000000000.9.1'`, and the pair
    // becomes unjoinable at exactly the moment the payload was interesting.
    h.sh(`t=1787000000000000000.9.1
      _lc_emit destroy refused sess "$t" refusal dirty-tree dec.surface pwa detail '${'d'.repeat(4000)}'`);
    const [e] = readJournal(h.home);
    expect(e!['truncated']).toBe(true);
    expect(e!['tx']).toBe('1787000000000000000.9.1');
    expect(e!['refusal']).toBe('dirty-tree');
    expect(decOf(e!)['surface']).toBe('pwa');
  });

  it('RETURNS 0 AND PRINTS NOTHING when python3 is gone — and counts the error', () => {
    // Mutant: change any `|| { _lc_err; return 0; }` to `|| return 1` -> this
    // fails with a non-zero exit from h.sh, and `cmd_ws_restore`'s emit inside
    // the flock region would leak the reap lock in the sourcing shell for ever.
    const out = h.sh('python3() { return 127; }; _lc_emit stop done sess "" 2>&1; printf "rc=%s" "$?"');
    expect(out).toBe('rc=0');
    expect(fs.readFileSync(path.join(lcDir(h.home), 'errors'), 'utf8').trim()).toBe('1');
  });

  it('returns 0 when the journal directory itself cannot be made', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.lifecycle'), 'not a directory');
    expect(h.sh('_lc_emit stop done sess "" 2>/dev/null; printf "rc=%s" "$?"')).toBe('rc=0');
  });

  it('prints nothing on stdout — a capture around a caller must stay unchanged', () => {
    expect(h.sh('out=$(_lc_emit stop done sess ""; printf VALUE); printf "%s" "$out"')).toBe('VALUE');
  });

  it('APPENDS — a second emit does not replace the first', () => {
    h.sh('_lc_emit start done a ""; _lc_emit stop done b ""; _lc_emit purge done c ""');
    expect(readJournal(h.home).map((e) => e['id'])).toEqual(['a', 'b', 'c']);
  });
});

describe('_lc_err', () => {
  it('MINTS ITS OWN DIRECTORY — the counter must be writable when the journal is not', () => {
    // Mutant: delete `mkdir -p -- "$_LC_DIR"` -> this fails with ENOENT on
    // readFileSync, because on the very path the counter exists for (`_lc_live`
    // could not make the directory) nothing else has created it.
    h.sh('_lc_err; _lc_err');
    expect(fs.readFileSync(path.join(lcDir(h.home), 'errors'), 'utf8').trim()).toBe('2');
  });

  it('restarts at 1 on a corrupt counter rather than reaching arithmetic', () => {
    // Mutant: delete the `[[ "$n" =~ ^[0-9]+$ ]] || n=0` rung -> `n=$(( n + 1 ))`
    // evaluates the FILE'S CONTENTS as arithmetic, where a command substitution
    // inside an array subscript executes (ccd:8784-8787).
    const p = path.join(lcDir(h.home), 'errors');
    h.sh('_lc_err');
    fs.writeFileSync(p, 'a[$(touch $HOME/PWNED)]');
    h.sh('_lc_err');
    expect(fs.readFileSync(p, 'utf8').trim()).toBe('1');
    expect(fs.existsSync(path.join(h.home, 'PWNED'))).toBe(false);
  });
});
```

  and extend that file's imports with `fs`, `path` and the two helpers it now uses:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { NO_TMUX, readJournal, decOf, lcDir } from './lifecycleHelpers.js';
```

- [ ] **Step 2: Write the non-poisoning guard.** Create `server/test/ccd-wsaudit-nonpoison.test.ts`:

```ts
// server/test/ccd-wsaudit-nonpoison.test.ts
//
// `wsaudit.test.ts` computes the refusal-token set by grepping THIS FILE'S TEXT
// with four regexes, comments included, and holds it set-equal to `SENTENCES`.
// The lifecycle emitter is a new writer of refusal-shaped JSON, so it is exactly
// the shape that could poison that scan — which is why the journal field is
// spelled `refusal`, never `refused`. ccd:2120-2126 and ccd:5834-5839 both record
// this class having shipped once already.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan. It reads ccd's TEXT and runs nothing, so it
// is compliant with no stub of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');

const scan = (text: string): string[] => {
  const t = new Set<string>();
  for (const m of text.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) t.add(m[1]!);
  for (const m of text.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) t.add(m[1]!);
  for (const m of text.matchAll(/'!([a-zA-Z0-9-]+)/g)) t.add(m[1]!);
  for (const m of text.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) { if (m[1] !== 'reapable') t.add(m[1]!); }
  return [...t].sort();
};

describe('the lifecycle block cannot poison wsaudit.test.ts\'s scan', () => {
  const from = src.indexOf('# ── lifecycle journal ');
  const to = src.indexOf('# ── end lifecycle journal ');

  it('found the block — an empty slice would pass every assertion below vacuously', () => {
    expect(from, 'LC-BEGIN marker not found in ccd').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to).length).toBeGreaterThan(2000);
  });

  it('carries none of the four harvested shapes, in code OR in a comment', () => {
    // Mutant: spell the journal field `"refused":"` instead of `"refusal"` ->
    // this fails, AND wsaudit.test.ts's reverse direction fails with a token
    // SENTENCES has no copy for.
    const slice = src.slice(from, to);
    for (const shape of [/_reap_refuse\s/, /"refused":"/, /"verdict":"/, /'!/]) {
      expect(slice, `the lifecycle emitter is written in a harvested shape: ${shape}`).not.toMatch(shape);
    }
  });

  it('leaves the whole-file token set at exactly the 54 that shipped before build 9', () => {
    expect(scan(src)).toHaveLength(54);
    expect(scan(src)).toContain('in-progress');
    expect(scan(src)).not.toContain('refusal');
  });
});
```

- [ ] **Step 3: Run both and see the emit cases fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts test/ccd-wsaudit-nonpoison.test.ts
```

Expected: the 17 new cases in `ccd-lifecycle-emit` fail — `_lc_emit: command not found` on stderr, and
`readJournal(h.home)` is `[]` so `e!['v']` throws `Cannot read properties of undefined`.
**`ccd-wsaudit-nonpoison` is GREEN ON ARRIVAL** — it is a guard over Task 12's block, not a test of this
task's code. Confirm its third case reads 54 before proceeding.

- [ ] **Step 4: Write the three functions.** In `ccd/ccd`, insert inside the LC block after
  `_lc_rotate`'s closing `}`:

```bash
_lc_err() {   # bump the counted errors file. Prints nothing. Always 0.
  # IT MINTS THE DIRECTORY ITSELF, and that is the one place besides `_lc_live`
  # that does: this counter exists for exactly the states in which the journal
  # could not be written, and half of those are "the directory was not there".
  # A counter that needs the journal's own directory to already exist records
  # nothing on the path it was written for.
  #
  # Temp+rename, `_reg_set`'s idiom (ccd:435-441), because a half-written
  # counter is a counter. Surfaced by the server as `lifecycle.writeErrors`,
  # which together with `lifecycle.newestAt` is what makes a silently-stopped
  # journal visible rather than indistinguishable from a quiet fleet.
  local n tmp
  mkdir -p -- "$_LC_DIR" 2>/dev/null || return 0
  n=$(cat "$_LC_DIR/errors" 2>/dev/null)
  # THE REGEX IS THE GUARD, not a tidiness check: the next line is an
  # ARITHMETIC context over bytes off disk, and bash evaluates a variable's
  # contents there — a command substitution inside an array subscript EXECUTES.
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  n=$(( n + 1 ))
  tmp="$_LC_DIR/.errors.$BASHPID.tmp"
  printf '%s\n' "$n" > "$tmp" 2>/dev/null && mv -fT -- "$tmp" "$_LC_DIR/errors" 2>/dev/null
  rm -f -- "$tmp" 2>/dev/null
  return 0
}

_lc_json() {   # cap uid ns act outcome id tx badact badoutcome obsjson [k v]...
  # THE SINGLE-FORK EVENT ENCODER, taking fields as argv. The alternative —
  # eight `$(_json_str …)` substitutions inside a printf argument list — is the
  # defect ccd:711-713 records: a bare `$(_json_str …)` swallows its own status
  # by construction, so a missing interpreter prints `"reason":,` and an
  # unparseable line lands in the record. Here a failed interpreter is a
  # NON-ZERO return with empty stdout and the caller writes nothing at all,
  # which is a gap the errors counter records rather than a corrupt line the
  # mirror has to model.
  #
  # The only OTHER python3 encoder in this block is `_lc_obs_json`, which builds
  # the obs FRAGMENT once per process. A third is a defect.
  #
  # NO `_json_str probe … || die` up front, unlike `_ws_manifest` and
  # `cmd_ws_audit`: D7 forbids this path from dying, and the caller's own
  # non-zero branch already covers the same condition.
  LC_ALL=C.UTF-8 python3 -c '
import json, sys
a = sys.argv[1:]
cap = int(a[0])
uid, ns, act, outcome, sid, tx, badact, badoutcome, obs = a[1:10]
rest = a[10:]

# `at` IS MILLISECONDS — L0 types LifecycleEvent.at that way and the mirror
# stores it that way. Both it and `atNs` come from ONE clock read, so the two
# can never disagree about one event.
ev = {"v": 1, "uid": uid, "atNs": ns, "at": int(ns[:13]), "act": act,
      "outcome": outcome, "id": sid}
if tx: ev["tx"] = tx
try:
    ev["obs"] = json.loads(obs) if obs else None
except ValueError:
    ev["obs"] = None

# THE KEY NAMESPACE. Dotted keys name their family; five names are top-level;
# anything else is DROPPED AND NAMED. That last rule is `badact`s own idiom
# applied to keys — a key we saw and could not model is a different fact from a
# key that was never passed — and it is what lets this encoder be TOTAL without
# quietly inventing a home for a typo.
#
# AN EMPTY VALUE OMITS ITS KEY. Disclosed, and it is not an overloaded null:
# every meas value ccd passes is a `_reg_get` (which cats a missing file to
# empty) or a git ref read, so "measured as empty" and "not measured" are ONE
# condition at this seam, not two a caller handles differently.
TOP = ("detail", "refusal", "verb", "badact", "branchDeleted")
dec, meas = {}, {}
for i in range(0, len(rest) - 1, 2):
    k, v = rest[i], rest[i + 1]
    if v == "":
        continue
    if k.startswith("dec."):
        dec[k[4:]] = v
    elif k.startswith("meas."):
        meas[k[5:]] = v
    elif k in TOP:
        ev[k] = v
    elif "badkey" not in ev:
        ev["badkey"] = k
dec.setdefault("surface", "none")
ev["dec"] = dec
ev["meas"] = meas or None
# The ENCODER computes these two, after the loop, so they always win over a
# caller that passed `badact` as a key.
if badact:     ev["badact"] = badact
if badoutcome: ev["badoutcome"] = badoutcome

def line(o):
    return json.dumps(o, ensure_ascii=True, allow_nan=False, separators=(",", ":"))

# THE CAP IS ENFORCED BY DROPPING IN A FIXED ORDER, AND BY SAYING SO. A line
# silently cut at 2048 bytes is a line that does not parse; `truncated` is what
# makes the loss a row rather than a silence. `refusal` and `detail` are NOT in
# the ladder: an over-cap refusal that dropped its own token would be an
# untyped `outcome:"refused"`, which is the one thing the record exists to say.
for drop in (None, "reason", "cgraw", "meas"):
    if drop == "reason":
        ev["dec"].pop("reason", None); ev["truncated"] = True
    elif drop == "cgraw" and isinstance(ev.get("obs"), dict):
        ev["obs"].pop("cgraw", None); ev["truncated"] = True
    elif drop == "meas":
        ev["meas"] = None; ev["truncated"] = True
    s = line(ev)
    if len(s.encode("utf-8")) <= cap:
        sys.stdout.write(s); raise SystemExit(0)

# THE LAST RESORT CARRIES THE JOINABLE MINIMUM. `tx` and `dec.surface` and the
# refusal token are what a reader needs to pair an intent with its outcome and
# to know what was refused; dropping them here loses the record at exactly the
# moment its payload was interesting.
fb = {"v": 1, "uid": uid, "atNs": ns, "at": int(ns[:13]), "act": act,
      "outcome": outcome, "id": sid,
      "dec": {"surface": ev["dec"].get("surface", "none")}, "truncated": True}
if tx: fb["tx"] = tx
if ev.get("refusal"): fb["refusal"] = ev["refusal"]
sys.stdout.write(line(fb))
' "$@"
}

_lc_emit() {   # act outcome id tx [key value]... — THE ONE WRITER. Always 0.
  # NOTHING BUT THIS FUNCTION WRITES INTO `.lifecycle/` (and `_lc_err`/
  # `_lc_live`/`_lc_rotate`, which only it calls). That is scanned by
  # `ccd-lifecycle-contain.test.ts`, and it is the one defect of `swap.log` this
  # design does not copy: ccd:7568 and ccd:9423 redirect a CHILD'S stdout and
  # stderr into that log, which is why ~30% of its lines are untimestamped and
  # unstructured. No `bash -c` or `systemd-run` string in this file may name
  # `.lifecycle`.
  #
  # PRINTS NOTHING on stdout or stderr. Several call sites sit inside functions
  # whose stdout IS the record (`cmd_ws_rename`'s printf, `_ws_gc_prune_row`'s
  # rows, `_ws_reap_tail`'s receipt); one stray byte corrupts a document a
  # consumer parses.
  local act="${1-}" outcome="${2-}" id="${3-}" tx="${4-}"
  shift 4 2>/dev/null || { _lc_err; return 0; }

  local a badact="" badoutcome="" found=0
  for a in "${_LC_ACTS[@]}"; do [[ "$a" == "$act" ]] && { found=1; break; }; done
  (( found )) || { badact="$act"; act=unknown; }
  found=0
  for a in "${_LC_OUTCOMES[@]}"; do [[ "$a" == "$outcome" ]] && { found=1; break; }; done
  (( found )) || { badoutcome="$outcome"; outcome=unknown; }

  _lc_obs
  # The seq increments in THIS frame — a function is not a subshell — so it is
  # genuinely monotonic per process. Only the `date` read forks.
  _LC_SEQ=$(( _LC_SEQ + 1 ))
  local ns; ns=$(_lc_now_ns)
  local uid="$ns.$BASHPID.$_LC_SEQ"

  local live; live=$(_lc_live)
  [[ -n "$live" ]] || { _lc_err; return 0; }

  local line
  line=$(_lc_json "$_LC_LINE_MAX" "$uid" "$ns" "$act" "$outcome" "$id" "$tx" \
                  "$badact" "$badoutcome" "$_LC_OBS" "$@" 2>/dev/null) \
    || { _lc_err; return 0; }
  [[ -n "$line" ]] || { _lc_err; return 0; }

  # ONE `printf … >>` per event. On Linux an O_APPEND write to a regular file is
  # serialised under the inode lock, so concurrent writers cannot interleave —
  # measured, not assumed: `$REG/swap.log` is 13 concurrent write sites over 49
  # days with zero corruption.
  printf '%s\n' "$line" >> "$live" 2>/dev/null || { _lc_err; return 0; }
  _lc_rotate "$live"
  return 0
}
```

- [ ] **Step 5: Run everything to green.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/wsaudit.test.ts
```

Expected: all green, and `wsaudit.test.ts` green **with zero edits**.

- [ ] **Step 6: Prove the die- and arithmetic-containment scanners still hold.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts test/ccd-arith-containment.test.ts
```

Expected: both green. `_lc_emit`/`_lc_json`/`_lc_err` are die-free, so no `$( )` capture of them is a
finding.

- [ ] **Step 7: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-emit.test.ts server/test/ccd-wsaudit-nonpoison.test.ts && git commit -m "ccd(w2): _lc_err, _lc_json and _lc_emit — the one journal writer, exit 0 on every path" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 16: The four wrappers, the declaration helpers, and `caps += lifecycle-v1`

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — inside the LC block, after `_lc_emit`'s closing `}`; the `cmd_caps` comment at
  lines **2446-2448** and its token block at line **2449**.
- Modify `server/test/ccd-archive.test.ts` line **153**.
- Modify `server/test/ccd-lifecycle-emit.test.ts` — append two `describe`s.

**Interfaces:**
- Consumes: `_lc_emit` (Task 15), `_LC_DEC_MAX` (Task 12), `die` (`ccd:148`).
- Produces — **the four caller-facing shapes, and the key/value tail is variadic on all of them:**
  ```
  _lc_intent <act> <id> <tx> [key value]...            outcome intent.  rc 0.
  _lc_done   <act> <id> <tx> [key value]...            outcome done.    rc 0.
  _lc_fail   <act> <id> <tx> <token> <detail> [k v]... outcome failed.  rc 0. DOES NOT DIE.
  _lc_refuse <act> <id> <token> <detail> [k v]...      outcome refused, then `die "$detail"`. NEVER RETURNS.
  ```
  `refusal` and `detail` land at the TOP LEVEL of the line, never inside `meas`.
- Produces — the two declaration helpers, **wave 3 not wave 5** (wave 3's `--reason` needs them first;
  they are pure and have no wave-5 dependency, and the actor-flags wave only verifies and tests them):
  - `_lc_surface_norm <word>` — the DECLARED surface on stdout: one of `cli|pwa|agent|ccd`, `unknown`
    for any other non-empty word, and **the empty string when nothing was declared** (which the encoder
    then omits, so `dec.surface` reads `none`). Always rc 0, never dies.
  - `_lc_dec_ok <text>` — rc 0 iff the text is **≤ `_LC_DEC_MAX` BYTES**. Prints nothing. Never dies.
    Bytes, not characters: a 200-emoji reason is 800 bytes, and character-counting let it pass one
    surface and be refused by the next.
- Produces: `cmd_caps` advertises `lifecycle-v1` on the same channel as `stop-surface`.

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `server/test/ccd-lifecycle-emit.test.ts`:

```ts
describe('the four wrappers', () => {
  it('_lc_intent and _lc_done share a tx so a pair is joinable', () => {
    h.sh('t=$(_lc_tx); _lc_intent destroy sess "$t" meas.branch ws/x; _lc_done destroy sess "$t" meas.attic 7');
    const [a, b] = readJournal(h.home);
    expect(a!['outcome']).toBe('intent');
    expect(b!['outcome']).toBe('done');
    expect(a!['tx']).toBe(b!['tx']);
    expect(String(a!['tx'])).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
  });

  it('an intent with no sibling leaves a tx nothing closes — that IS the orphan signal', () => {
    h.sh('t=$(_lc_tx); _lc_intent reap sess "$t"');
    const es = readJournal(h.home);
    expect(es).toHaveLength(1);
    expect(es[0]!['outcome']).toBe('intent');
  });

  it('_lc_fail records a token and detail at the TOP LEVEL, WITHOUT dying', () => {
    const out = h.sh('t=$(_lc_tx); _lc_fail destroy sess "$t" worktree-remove-failed "git refused"; printf "rc=%s" "$?"');
    expect(out).toBe('rc=0');
    const [e] = readJournal(h.home);
    expect(e!['outcome']).toBe('failed');
    expect(e!['refusal']).toBe('worktree-remove-failed');
    expect(e!['detail']).toBe('git refused');
    expect(measOf(e!), 'refusal and detail are not measurements').not.toHaveProperty('refusal');
  });

  it('_lc_refuse emits THEN dies, so refusal and death cannot drift', () => {
    // Mutant: drop the trailing `die "$msg"` -> this fails with `expected 0 not
    // to be 0`, and a refused destruction would exit 0 with the record still
    // claiming a refusal.
    let code = 0; let stderr = '';
    try { h.sh('_lc_refuse destroy sess held "held: program X — release first"'); }
    catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      code = err.status ?? 1; stderr = String(err.stderr ?? '');
    }
    expect(code).not.toBe(0);
    expect(stderr).toContain('held: program X');
    const [e] = readJournal(h.home);
    expect(e!['outcome']).toBe('refused');
    expect(e!['refusal']).toBe('held');
  });

  it('spells the journal field `refusal` and never `refused`', () => {
    h.sh('t=$(_lc_tx); _lc_fail destroy sess "$t" dirty-tree "uncommitted changes"');
    const [e] = readJournal(h.home);
    expect(e).toHaveProperty('refusal');
    expect(e).not.toHaveProperty('refused');
  });

  it('an ARITY SLIP degrades to a line, never to a dead shell', () => {
    // Mutant: bind the wrappers' positionals as `local a="$1"` instead of
    // `"${1-}"` -> under `set -uo pipefail` an unset positional EXITS THE SHELL
    // (measured: `f(){ local a="$1" b="$2"; }; f one; echo AFTER` never prints
    // AFTER), so this fails with `expected '' to be 'AFTER'` and one dropped
    // `""` at any of 21 call sites turns a destructive verb into a mid-verb
    // abort — the exact failure "the journal never gates an act" exists to stop.
    expect(h.sh('_lc_intent destroy sess 2>/dev/null; printf AFTER')).toBe('AFTER');
    expect(h.sh('_lc_done destroy 2>/dev/null; printf AFTER')).toBe('AFTER');
    expect(h.sh('_lc_fail destroy sess 2>/dev/null; printf AFTER')).toBe('AFTER');
  });
});

describe('_lc_surface_norm and _lc_dec_ok — declaration, validated once', () => {
  it.each([['cli', 'cli'], ['pwa', 'pwa'], ['agent', 'agent'], ['ccd', 'ccd'], ['wharf', 'unknown']])(
    'normalises %s to %s, exactly as ccd:619 does', (word, want) => {
      expect(h.sh(`_lc_surface_norm ${word}`)).toBe(want);
    });

  it('answers EMPTY for nothing declared — never `unknown`, never a default', () => {
    // Mutant: `case "" in … *) unknown` -> this fails with `expected 'unknown'
    // to be ''`, and "no flag was passed" becomes indistinguishable from "a word
    // this build does not model". L0's DecSurface has a member for the first
    // (`none`, via the encoder's omit rule) and `unknown` for the second.
    expect(h.sh('_lc_surface_norm ""')).toBe('');
    expect(h.sh('_lc_surface_norm')).toBe('');
  });

  it('caps the declaration in BYTES, not characters, and restores the caller\'s locale', () => {
    // Mutant: drop `local LC_ALL=C` -> a 200-emoji reason measures 200 and
    // passes at 800 bytes; this fails with `expected 0 to be 1`.
    expect(h.sh(`LC_ALL=C.UTF-8; s=$(printf 'z%.0s' {1..512}); _lc_dec_ok "$s"; printf "rc=%s" "$?"`)).toBe('rc=0');
    expect(h.sh(`LC_ALL=C.UTF-8; s=$(printf 'z%.0s' {1..513}); _lc_dec_ok "$s"; printf "rc=%s" "$?"`)).toBe('rc=1');
    // 200 x U+1F600 is 200 characters and 800 bytes.
    expect(h.sh(`LC_ALL=C.UTF-8; s=$(printf '\\U0001F600%.0s' {1..200}); _lc_dec_ok "$s"; printf "rc=%s" "$?"`)).toBe('rc=1');
    // and the caller's collation is the caller's again afterwards
    expect(h.sh(`LC_ALL=C.UTF-8; s=$'caf\\u00e9'; _lc_dec_ok "$s"; printf '%s' "\${#s}"`)).toBe('4');
  });
});

describe('ccd caps', () => {
  it('advertises lifecycle-v1 on the capability channel', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('lifecycle-v1');
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts
```

Expected: the 10 new declarations (14 vitest cases — the `it.each` expands to five) fail; the first with
`_lc_intent: command not found` and `readJournal(h.home)` empty.

- [ ] **Step 3: Confirm the caps parity test is green before it is touched.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t 'advertises exactly the verbs'
```

Expected: green.

- [ ] **Step 4: Write the wrappers and the two helpers.** In `ccd/ccd`, insert inside the LC block
  after `_lc_emit`'s closing `}` and before `# ── end lifecycle journal`:

```bash
# THE FOUR CALLER-FACING SHAPES. `tx` is an ARGUMENT on all of them: a caller
# that pairs an intent with an outcome mints one with `_lc_tx` into a `local`
# and passes it twice. There is no global to carry it, deliberately.
#
# tx IS FOR ONE PAIR, NEVER FOR A CALL TREE. `cmd_enable` runs `cmd_start`
# in-process (ccd:9587) and `cmd_swap`'s `|| cmd_ensure` fallback fires at
# ccd:9548; each writes its OWN independent event with its own tx, because two
# acts happened and the record says so rather than folding one into the other.
#
# EVERY POSITIONAL IS BOUND `${N-}`, NOT `$N`. ccd runs `set -uo pipefail`, and
# a function that reads an unset positional EXITS THE SHELL rather than
# returning. With 21 hand-written call sites one dropped `""` would abort a
# destructive verb mid-teardown — through the journal, which exists precisely to
# gate nothing. `shift N 2>/dev/null || :` for the same reason.
_lc_intent() { local a="${1-}" i="${2-}" t="${3-}"; shift 3 2>/dev/null || :
               _lc_emit "$a" intent "$i" "$t" "$@"; }
_lc_done()   { local a="${1-}" i="${2-}" t="${3-}"; shift 3 2>/dev/null || :
               _lc_emit "$a" done   "$i" "$t" "$@"; }

_lc_fail() {   # act id tx token detail [k v]... — an act that STARTED and broke
  # Distinct from `_lc_refuse` by WHEN, not by severity: a refusal happens
  # before anything irreversible, a failure after. `cmd_ws_rm`'s
  # `git worktree remove` die at ccd:2053-2054 is a FAILURE — the session is
  # already stopped when it fires — and calling it a refusal would say nothing
  # was touched, which is false.
  local a="${1-}" i="${2-}" t="${3-}" tok="${4-}" msg="${5-}"; shift 5 2>/dev/null || :
  _lc_emit "$a" failed "$i" "$t" refusal "$tok" detail "$msg" "$@"
}

_lc_refuse() {   # act id token detail [k v]... — EMITS, THEN DIES. Never returns.
  # Refusal and death cannot drift because they are one call. Call sites live
  # ONLY inside the destructive verbs, never inside `die` itself — putting it
  # there would fabricate a "refused destruction" for every usage error on every
  # verb in the file.
  #
  # THIS FUNCTION IS IN `ccd-die-containment.test.ts`'s CAN-DIE SET (that suite
  # derives the set by call-graph reachability, so there is no list to edit). It
  # must never be wrapped in `$( )`: the capture demotes a fatal to rc 1 and the
  # verb carries on destroying.
  #
  # The field is `refusal`, never `refused`, and the token is an ARGUMENT rather
  # than a format-string literal — both so `wsaudit.test.ts`'s four-regex scan
  # over this file's text cannot see it. ccd:2120-2126 records what a
  # `"refused":"%s"` helper costs.
  local a="${1-}" i="${2-}" tok="${3-}" msg="${4-}"; shift 4 2>/dev/null || :
  _lc_emit "$a" refused "$i" "" refusal "$tok" detail "$msg" "$@"
  die "$msg"
}

_lc_surface_norm() {   # word -> the DECLARED surface, or NOTHING when none was
  # THREE STATES, THREE ANSWERS, and the empty one is the whole point: "no flag
  # was passed" is a different fact from "a word this build does not model".
  # The encoder omits an empty value, so an undeclared surface reads `none`;
  # `unknown` is reserved for a word that arrived and was not recognised.
  #
  # ccd's OWN DEFAULTS MUST NEVER REACH THIS FIELD — `cmd_stop`'s `cli`,
  # `_ws_unsupervise`'s `ccd`. They are ccd acting on its own account, not a
  # caller's declaration, and laundering one into `dec.surface` is exactly the
  # default-as-declaration defect `none` exists to prevent. The closed set is
  # ccd:619's, so the journal and the `.stopped` stamp agree by construction.
  [[ -n "${1-}" ]] || { printf '%s' ''; return 0; }
  case "$1" in cli|pwa|agent|ccd) printf '%s' "$1" ;; *) printf '%s' unknown ;; esac
  return 0
}

_lc_dec_ok() {   # text -> 0 iff it fits _LC_DEC_MAX *BYTES*. Prints nothing.
  # BYTES, NOT CHARACTERS, and `local LC_ALL=C` is what makes `${#1}` count them
  # — restored on return, because `local` on an exported variable shadows it for
  # this frame only. A 200-emoji reason is 200 characters and 800 bytes; with a
  # character cap it passed `ws-rm` and was refused by `ws-release`, which is
  # one value with two meanings at a provenance seam.
  #
  # THE POLICY IS REFUSE, NEVER TRUNCATE. A 900-byte reason silently recorded as
  # 512 reads as the operator's own words, and the record is the one artefact
  # that outlives the workspace.
  local LC_ALL=C
  (( ${#1} <= _LC_DEC_MAX ))
}
```

- [ ] **Step 5: Add the caps token and repair the comment above it.** In `ccd/ccd`, replace lines
  **2446-2449**:

```bash
  # `server/test/ccd-archive.test.ts`'s caps<->dispatcher parity check knows
  # this one token by name and requires it to stay exactly one token — a
  # third one added here without updating that list fails loudly there.
  echo stop-surface
```

with:

```bash
  # `server/test/ccd-archive.test.ts`'s caps<->dispatcher parity check knows
  # these tokens by name (`KNOWN_CAPABILITY_TOKENS`, that file's line 153) and
  # holds the advertised set EXACTLY equal to it — a token added here without
  # updating that list fails loudly there, in BOTH directions: :175 sees it as
  # a phantom verb, :180 sees the list short one.
  echo stop-surface
  # `lifecycle-v1` says THIS copy of ccd writes `$REG/.lifecycle/`. It gates a
  # SERVER DECISION — sweep at all — not a file: absent means the mirror never
  # sweeps and every surface says "this box's ccd does not write the lifecycle
  # journal", because an old ccd's silence must not read as a quiet fleet.
  # Verb-shaped so it needs no new parsing anywhere, exactly the argument that
  # put `stop-surface` on this channel.
  echo lifecycle-v1
```

- [ ] **Step 6: Update the parity list.** In `server/test/ccd-archive.test.ts`, change line **153**
  from `const KNOWN_CAPABILITY_TOKENS = ['stop-surface'];` to:

```ts
  const KNOWN_CAPABILITY_TOKENS = ['lifecycle-v1', 'stop-surface'];
```

- [ ] **Step 7: Run the three suites to green, then measure both mutants.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts test/ccd-archive.test.ts test/ccd-die-containment.test.ts
```

Expected: all green. **Mutant A:** revert step 6 alone and re-run — `ccd-archive.test.ts` reds at
**:175** with `lifecycle-v1` appearing in the `verbs` partition as a phantom verb. **Mutant B:** revert
step 5 alone and it reds at **:180** instead, the capability set one short. Restore both before
continuing.

- [ ] **Step 8: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-emit.test.ts server/test/ccd-archive.test.ts && git commit -m "ccd(w2): the four wrappers, _lc_surface_norm/_lc_dec_ok, caps += lifecycle-v1" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: The `_reg_purge` backstop — a future verb cannot destroy silently

**AGENT-FIRST, ships DARK.** This is the design's most important guard and it gets its own task, its
own file and its own mutant.

**Files:**
- Modify `ccd/ccd` — insert one emit at line **526**, immediately before `local id="$1" f suffix`.
- Create `server/test/ccd-lifecycle-purge.test.ts`.

**Interfaces:**
- Consumes: `_lc_done` (Task 16), `_reg_get` (`ccd:442`); `readJournal`, `eventsOf`, `measOf` from
  `./lifecycleHelpers.js`.
- Produces: every `_reg_purge` call — `ccd:2088` (ws-rm), `ccd:6774` (ws-reap), `ccd:7253` (ws-gc's
  dead-reg arm), `ccd:9688` (forget), **and every future one** — writes one `act:"purge"` line while
  `meas` is still readable.

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-lifecycle-purge.test.ts`:

```ts
// server/test/ccd-lifecycle-purge.test.ts
//
// D3, and it is the load-bearing guard of the whole design: the line is emitted
// INSIDE `_reg_purge`, BEFORE the unlink loop, while `meas` is still readable.
// Every destruction path on this box terminates there — ws-rm, ws-reap, ws-gc's
// dead-reg arm, forget — so a destructive verb added LATER that forgets to
// journal itself still leaves a record. A silent destruction has to defeat two
// independent emit sites.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan. Every snippet runs through `h.sh`, whose
// harness contains gh, systemd and tmux; nothing here reaches a live service.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-purge-'); });
afterEach(() => { h.cleanup(); });

const seed = (id = 'demo-still-river'): string => {
  h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
    _reg_set ${id} project demo
    _reg_set ${id} workspace still-river
    _reg_set ${id} branch ws/still-river
    _reg_set ${id} wrapper claude-corp
    _reg_set ${id} workdir /data/worktrees/demo/still-river
    _reg_set ${id} archived 1787000000
    _reg_set ${id} archivedreason merged:#42`);
  return id;
};

describe('_reg_purge always journals, and journals BEFORE it unlinks', () => {
  it('records the whole meas family, read while the files still exist', () => {
    const id = seed();
    h.sh(`_reg_purge ${id}`);
    const purges = eventsOf(h.home, 'purge');
    expect(purges, 'the backstop did not fire').toHaveLength(1);
    const m = measOf(purges[0]!);
    expect(purges[0]!['id']).toBe(id);
    expect(m['project']).toBe('demo');
    expect(m['workspace']).toBe('still-river');
    expect(m['branch']).toBe('ws/still-river');
    expect(m['wrapper']).toBe('claude-corp');
    expect(m['uuid']).toBe('72be9ee2-0000-4bcc-b60b-0cfc0dc3d199');
    expect(m['workdir']).toBe('/data/worktrees/demo/still-river');
    expect(m['archivedAt']).toBe('1787000000');
    expect(m['archivedReason']).toBe('merged:#42');
  });

  it('THE MUTANT: an emit moved after the loop reads a stripped registry', () => {
    // Mutant: move the `_lc_done purge …` line from above `local id="$1"` to
    // below the loop's closing `done` -> this fails with
    // `expected undefined to be 'ws/still-river'`, because ccd:535 has already
    // unlinked every field but `archived`/`reaping`. That is the whole reason
    // the emit is where it is.
    const id = seed();
    h.sh(`_reg_purge ${id}`);
    const m = measOf(eventsOf(h.home, 'purge')[0]!);
    expect(m['branch']).toBe('ws/still-river');
    expect(m['workdir']).toBe('/data/worktrees/demo/still-river');
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((n) => n.startsWith(`${id}.`)))
      .toEqual([]);
  });

  it('omits a field that was never measured rather than writing it as ""', () => {
    h.sh(`_reg_set bare-row uuid abc; _reg_purge bare-row`);
    const m = measOf(eventsOf(h.home, 'purge')[0]!);
    expect(m['uuid']).toBe('abc');
    expect(m).not.toHaveProperty('branch');
    expect(m).not.toHaveProperty('archivedReason');
  });

  it('journals a purge for a row that has NOTHING left — the id alone is a record', () => {
    h.sh('_reg_purge never-existed');
    const purges = eventsOf(h.home, 'purge');
    expect(purges).toHaveLength(1);
    expect(purges[0]!['id']).toBe('never-existed');
  });

  it('is unconditional: the emit is not guarded by any condition in the source', () => {
    // The emit must sit at the top of the function body with nothing between it
    // and the opening brace but the header comment. A future `if` around it is
    // exactly how a silent destruction gets back in.
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('_reg_purge() {');
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('_substrate_mark() {'));
    expect(body).toMatch(/_lc_done\s+purge\s+"\$1"/);
    const emitAt = body.indexOf('_lc_done purge');
    const loopAt = body.indexOf('for f in "$REG/$id".*');
    expect(emitAt).toBeGreaterThan(-1);
    expect(loopAt, 'the unlink loop moved — re-measure before trusting this').toBeGreaterThan(-1);
    expect(emitAt, 'the backstop must precede the unlink loop').toBeLessThan(loopAt);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-purge.test.ts
```

Expected: all 5 fail; the first with
`the backstop did not fire: expected [] to have a length of 1 but got +0`.

- [ ] **Step 3: Write the backstop.** In `ccd/ccd`, replace line **526** (`  local id="$1" f suffix`)
  with:

```bash
  # ── THE BACKSTOP (D3) ────────────────────────────────────────────────────
  # HERE, AND NOT ONE LINE LOWER. Every destruction path on this box terminates
  # in this function — ws-rm (ccd:2088), ws-reap (ccd:6774), ws-gc's dead-reg
  # arm (ccd:7253), forget (ccd:9688) — and a destructive verb added LATER that
  # forgets to journal itself still leaves a record. A silent destruction has to
  # defeat two independent emit sites.
  #
  # BEFORE the loop below, because the loop is what makes `meas` unreadable:
  # ccd:535 unlinks every dot-free `$REG/<id>.<suffix>` except `archived` and
  # `reaping`, so an emit placed after it can only report an id. Moving this
  # line down is the mutant `ccd-lifecycle-purge.test.ts` measures.
  #
  # UNCONDITIONAL, and with NO `tx`: this is not half of a pair. It is the
  # terminal fact — the registry entry ceased to exist — and it is worth writing
  # even for a row that has nothing left, where the id alone is the record. No
  # `verb` either: this function cannot see its caller, and guessing one would
  # be the fabricated fact the design exists to refuse.
  # `_lc_done` returns 0 on every path, so nothing here can gate the purge.
  _lc_done purge "$1" "" \
    meas.project        "$(_reg_get "$1" project)" \
    meas.workspace      "$(_reg_get "$1" workspace)" \
    meas.branch         "$(_reg_get "$1" branch)" \
    meas.uuid           "$(_reg_get "$1" uuid)" \
    meas.wrapper        "$(_reg_get "$1" wrapper)" \
    meas.workdir        "$(_reg_get "$1" workdir)" \
    meas.archivedAt     "$(_reg_get "$1" archived)" \
    meas.archivedReason "$(_reg_get "$1" archivedreason)" \
    meas.held           "$(_reg_get "$1" hold)"
  # ─────────────────────────────────────────────────────────────────────────
  local id="$1" f suffix
```

- [ ] **Step 4: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-purge.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Prove the mutant.** Temporarily move the `_lc_done purge …` call (and only it) to sit
  immediately after the loop's closing `done`, re-run:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-purge.test.ts
```

Expected while mutated: `THE MUTANT: an emit moved after the loop reads a stripped registry` fails with
`expected undefined to be 'ws/still-river'`. Restore the line and re-run to green.

- [ ] **Step 6: Confirm the four consumers of `_reg_purge` are unchanged.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-forget.test.ts test/ccd-workspaces.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts
```

Expected: green. `ccd-ws-gc` is a **known load flake** and reaches `_reg_purge` through its dead-reg
arm, which is why it runs alone; re-run it on an idle box before calling a red a break.

- [ ] **Step 7: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-purge.test.ts && git commit -m "ccd(w2): the _reg_purge backstop (D3) — a future verb cannot destroy silently" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Session call sites — supervise, unsupervise, claim, spawn (change-only), start, ensure, enable, stop, swap

**AGENT-FIRST, ships DARK.**

**Files:** Modify `ccd/ccd` at nine sites (lines **591-593**, **618**+**624**, **457**, **8387**,
**8745**, **8832**, **9587**, **9607**+**9613-9615**+**9638**, **9542**). Create
`server/test/ccd-lifecycle-sites.test.ts`.

**Interfaces:**
- Consumes: `_lc_done`, `_lc_surface_norm` (Task 16), `_reg_get` (`ccd:442`).
- Produces: acts `supervise`, `unsupervise`, `claim`, `spawn`, `start`, `ensure`, `enable`, `stop`,
  `swap`.
- **`_ws_unsupervise` grows an optional THIRD positional, `declared`**, and only `cmd_stop` passes it.
  The second positional is the `.stopped` STAMP's word, which defaults to `ccd` — ccd acting on its own
  account — and L0 forbids ccd's own defaults from reaching `dec.surface`. A third argument is how the
  choke point learns what the caller actually declared without changing the stamp's semantics.
- **`_spawn_settle` emits CHANGE-ONLY:** a differing `rc`, or more than 300 s since this id's last
  `spawn` line. Without that rule `Restart=always` × 18 sessions is the entire disk budget.
- **Nothing is emitted from `_reg_set`** (thousands/hour, no forensic value) **or `session-hook.sh`**
  (hot path of every tool call; its exit-0-on-every-path contract is absolute).

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-lifecycle-sites.test.ts`:

```ts
// server/test/ccd-lifecycle-sites.test.ts
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { actsOf, readJournal, eventsOf, measOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-sites-'); });
afterEach(() => { h.cleanup(); });

describe('session call sites', () => {
  it('_ws_supervise and _ws_unsupervise each write one line', () => {
    h.sh('systemctl() { :; }; _ws_supervise sess; _ws_unsupervise sess pwa');
    expect(actsOf(h.home)).toEqual(['supervise', 'unsupervise']);
  });

  it('the STAMP\'s word is not a declaration — a two-argument call reads `none`', () => {
    // Mutant: emit `dec.surface "$surface"` (the stamp's already-defaulted word)
    // -> this fails with `expected 'pwa' to be 'none'` on the first case and
    // `expected 'ccd' to be 'none'` on the second, and ccd's own defaults —
    // cmd_stop's `cli`, this function's `ccd` — are laundered into a field L0
    // reserves for what a CALLER said.
    h.sh('systemctl() { :; }; _ws_unsupervise sess pwa');
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('none');
    h.sh('systemctl() { :; }; _ws_unsupervise other');
    expect(decOf(readJournal(h.home)[1]!)['surface']).toBe('none');
  });

  it('carries a DECLARED surface when the third argument says one was declared', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess pwa pwa');
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('pwa');
  });

  it('records an unrecognised declared word as `unknown`, exactly as ccd:619 does', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess unknown wharf');
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('unknown');
  });

  it('_reg_claim writes one claim line', () => {
    h.sh('_reg_set sess wrapper claude-corp; _reg_claim sess');
    expect(actsOf(h.home)).toEqual(['claim']);
    expect(readJournal(h.home)[0]!['id']).toBe('sess');
    expect(measOf(readJournal(h.home)[0]!)['wrapper']).toBe('claude-corp');
  });

  it('_spawn_settle is CHANGE-ONLY — an unchanged rc inside 300s writes nothing', () => {
    // Mutant: delete the change-only gate -> this fails with `expected 3 to be
    // 1`, and Restart=always x 18 sessions becomes the whole disk budget.
    const stub = `_accept_first_run_prompts() { return 0; }; _tmux() { echo t; };
      tmux() { :; }; date() { echo 1787000000; };`;
    h.sh(`${stub} _spawn_settle sess 0; _spawn_settle sess 0; _spawn_settle sess 0`);
    expect(eventsOf(h.home, 'spawn')).toHaveLength(1);
  });

  it('_spawn_settle DOES emit when the rc changes', () => {
    const stub = (rc: number): string => `_accept_first_run_prompts() { return ${rc}; }; _tmux() { echo t; };
      tmux() { :; }; date() { echo 1787000000; };`;
    h.sh(`${stub(0)} _spawn_settle sess 0`);
    h.sh(`${stub(3)} _spawn_settle sess 0`);
    const spawns = eventsOf(h.home, 'spawn');
    expect(spawns).toHaveLength(2);
    expect(measOf(spawns[0]!)['rc']).toBe('0');
    expect(measOf(spawns[1]!)['rc']).toBe('3');
  });

  it('_spawn_settle DOES emit when 300s have passed at the same rc', () => {
    const stub = (now: number): string => `_accept_first_run_prompts() { return 0; }; _tmux() { echo t; };
      tmux() { :; }; date() { echo ${now}; };`;
    h.sh(`${stub(1787000000)} _spawn_settle sess 0`);
    h.sh(`${stub(1787000301)} _spawn_settle sess 0`);
    expect(eventsOf(h.home, 'spawn')).toHaveLength(2);
  });

  it('cmd_stop writes one stop line carrying the declared surface, and `none` without the flag', () => {
    h.sh(`_reg_set sess uuid u
      _ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; }
      cmd_stop --surface pwa sess`);
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(1);
    expect(decOf(stops[0]!)['surface']).toBe('pwa');

    h.sh(`_reg_set s2 uuid u
      _ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; }
      cmd_stop s2`);
    expect(decOf(eventsOf(h.home, 'stop')[1]!)['surface'],
      'cmd_stop\'s own `cli` default is not a declaration').toBe('none');
  });

  it('cmd_enable and cmd_start write TWO independent events, not one folded pair', () => {
    // The ruling: a re-entrant verb records two acts because two acts happened.
    // `wrapper` and `workdir` are seeded because cmd_start's ladder dies at
    // ccd:8682 and ccd:8694 without them; `claude-corp` is in the harness's
    // home-able roster, so `[[ -x "$WRAPPER_DIR/claude-corp" ]]` (ccd:8683) holds.
    h.sh(`_reg_set sess uuid u; _reg_set sess project demo
      _reg_set sess wrapper claude-corp; _reg_set sess workdir "$HOME"
      _supervised_start() { return 0; }; _reg_claim() { :; }; _spawn_settle() { :; }
      _spawn_start() { SPAWN_FROMSWAP=0; }; _alive() { return 1; }
      cmd_enable sess`);
    const a = actsOf(h.home);
    expect(a).toContain('enable');
    expect(a).toContain('start');
    const [en] = eventsOf(h.home, 'enable');
    const [st] = eventsOf(h.home, 'start');
    expect(en!['tx'], 'no tx is shared across a re-entrant call tree').toBeUndefined();
    expect(st!['tx']).toBeUndefined();
  });
});

describe('the two sites that must NEVER emit', () => {
  const src = readFileSync(CCD, 'utf8');

  it('_reg_set contains no _lc_ call — thousands an hour, no forensic value', () => {
    const from = src.indexOf('_reg_set() {');
    const body = src.slice(from, src.indexOf('_reg_get() {'));
    expect(body.length, 'the slice collapsed').toBeGreaterThan(100);
    expect(body).not.toMatch(/_lc_/);
  });

  it('session-hook.sh contains no _lc_ call — its exit-0 contract is absolute', () => {
    const hook = readFileSync(CCD.replace(/ccd$/, 'session-hook.sh'), 'utf8');
    expect(hook).not.toMatch(/_lc_/);
    expect(hook).not.toMatch(/\.lifecycle/);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts
```

Expected: the nine site cases fail, the first with
`expected [] to deeply equal [ 'supervise', 'unsupervise' ]`; the two never-emit cases pass already.

- [ ] **Step 3: Edit `_ws_supervise`.** In `ccd/ccd`, replace lines **591-593** with:

```bash
_ws_supervise()   { rm -f "$REG/$1.stopped"                                   # supervision supersedes an earlier stop
                    # POSITIONAL, and there is no `$id` in this function: it is
                    # a one-liner with no `local`, so the emit must say `$1`.
                    _lc_done supervise "$1" "" meas.wrapper "$(_reg_get "$1" wrapper)"
                    systemctl --user enable  --now "claude-session@$1" 2>/dev/null \
                      || echo "warn: could not enable unit claude-session@$1" >&2; }
```

- [ ] **Step 4: Edit `_ws_unsupervise`.** In `ccd/ccd`, replace line **618** with:

```bash
  # `$3` IS THE DECLARATION, `$2` IS THE STAMP. The stamp defaults to `ccd`
  # because the four internal callers ARE ccd acting on its own account, and L0
  # forbids ccd's own defaults from reaching `dec.surface`: a default laundered
  # into a declaration is exactly what `none` exists to prevent. `cmd_stop` is
  # the one caller with something declared to pass, and it passes it here.
  local id="$1" surface="${2-ccd}" declared="${3-}"
```

  and insert immediately after line **624** (`  _reg_set "$id" stopped "$(date +%s) $surface"`):

```bash
  # THE CHOKE POINT'S ERASURE OF THE VERB IS REPAIRED UPWARD, HERE. The stamp
  # keeps one field for two words and names a software PATH, never a human;
  # this line carries the same act into a record `_reg_purge` cannot reach.
  # `_lc_surface_norm` answers EMPTY when nothing was declared, and the encoder
  # omits an empty value, so an internal call reads `dec.surface:"none"`.
  _lc_done unsupervise "$id" "" dec.surface "$(_lc_surface_norm "$declared")"
```

- [ ] **Step 5: Edit `_reg_claim`.** In `ccd/ccd`, replace line **457** with:

```bash
_reg_claim() {   # id — THE ONE WRITER of `started`, and now of its record
  # Its name is a trap (§0): this is an idempotent flag, not a compare-and-swap.
  # The journal line is what makes a re-claim distinguishable from a first one.
  # It adds NO second writer of `started` — `ccd-reg-claim.test.ts`'s "exactly
  # one `_reg_set … started` line" must still find exactly one.
  _lc_done claim "$1" "" meas.wrapper "$(_reg_get "$1" wrapper)" \
    meas.project "$(_reg_get "$1" project)"
  _reg_set "$1" started 1
}
```

- [ ] **Step 6: Edit `_spawn_settle` for the change-only rule.** In `ccd/ccd`, replace line **8387**
  (`  _reg_set "$id" spawn "$(date +%s) $prompt_rc"`) with:

```bash
  # CHANGE-ONLY, AND IT MUST BE READ BEFORE THE WRITE BELOW. `_reg_set` is a
  # truncating writer, so this is the last instant the PREVIOUS epoch and rc
  # exist anywhere. Restart=always means this function runs on every supervisor
  # cycle for 18 sessions; a line per cycle is the whole disk budget for no
  # forensic gain, and a spawn whose rc has not changed inside five minutes is
  # not news.
  local _lc_prev _lc_prev_at _lc_prev_rc _lc_now
  _lc_prev=$(_reg_get "$id" spawn)
  _lc_prev_at="${_lc_prev%% *}"; _lc_prev_rc="${_lc_prev##* }"
  _lc_now=$(date +%s)
  # Regex before every arithmetic test: `_lc_prev_at` is bytes off disk.
  if [[ "$_lc_prev_rc" != "$prompt_rc" ]] \
     || ! [[ "$_lc_prev_at" =~ ^[0-9]+$ ]] \
     || (( _lc_now - _lc_prev_at > 300 )); then
    _lc_done spawn "$id" "" meas.rc "$prompt_rc" meas.wrapper "$wrapper"
  fi
  _reg_set "$id" spawn "$_lc_now $prompt_rc"
```

- [ ] **Step 7: Edit `cmd_start`.** In `ccd/ccd`, insert immediately after line **8745**
  (`  rm -f "$REG/$id.stopped"`):

```bash
  # ONE EMIT, AT THE TOP, because this verb has FIVE exits — the supervised
  # arm's (ccd:8756 `return "$rc"`, ccd:8758 `return 0`), the in-unit arm's
  # (ccd:8767's `|| return $?`, ccd:8775 `return "$rc"`, and falling off the end
  # at ccd:8777) — plus `_supervised_start`'s own unsupervised fallbacks. A line
  # per exit misses one. The OUTCOME is not asserted here: `_reg_claim`'s
  # `claim` line and `_spawn_settle`'s `spawn` line (with its rc) are the
  # measured downstream facts, and composing the record from independent
  # measurements is the point.
  _lc_done start "$id" "" meas.mode "$mode" meas.wrapper "$(_reg_get "$id" wrapper)"
```

- [ ] **Step 8: Edit `cmd_ensure`.** In `ccd/ccd`, insert immediately after line **8832**
  (`  rm -f "$REG/$id.stopped"`):

```bash
  # The Restart=always hot path, which is exactly why `_spawn_settle`'s
  # change-only rule exists one function up. This line is cheap — no fork beyond
  # the emitter's own — and it is what tells a respawn from a human's
  # `ccd ensure`, through `obs.cg`: the systemd unit names the id in the cgroup
  # path, which is respawn provenance nothing on this box has today.
  _lc_done ensure "$id" "" meas.inUnit "${CCD_IN_UNIT:-0}"
```

- [ ] **Step 9: Edit `cmd_enable`.** In `ccd/ccd`, replace line **9587**
  (`  cmd_start "$@" || return $?`) with:

```bash
  # TWO EVENTS, NOT ONE. `cmd_start` runs in THIS process and writes its own
  # `start` line; this one records that boot-persistence was asked for. No
  # shared tx: tx is for one intent/outcome PAIR, never for a call tree, and
  # folding these would report one act where two happened.
  _lc_done enable "$id" ""
  cmd_start "$@" || return $?
```

- [ ] **Step 10: Edit `cmd_stop`.** In `ccd/ccd`, replace line **9607** with:

```bash
  local surface=cli declared="" args=()
```

  replace lines **9613-9615**'s two flag arms with:

```bash
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
                   surface="$2"; declared="$2"; shift 2 ;;
      --surface=*) surface="${1#--surface=}"; declared="$surface"; shift ;;
```

  and replace line **9638** with:

```bash
  # The ONLY call site with a DECLARATION to carry, which is why it is the only
  # one that passes a third argument. `$surface` (defaulted to `cli`) is still
  # the stamp's word; `$declared` is empty unless a flag actually arrived, and
  # the journal keeps the two apart.
  _lc_done stop "$id" "" dec.surface "$(_lc_surface_norm "$declared")"
  _ws_unsupervise "$id" "$surface" "$declared"
```

- [ ] **Step 11: Edit `cmd_swap`.** In `ccd/ccd`, insert immediately after line **9542**
  (`  _reg_set "$id" lastswap "$(date +%s)"`):

```bash
  # `cmd_ensure` runs in this same process at ccd:9548, but only when
  # `systemctl --user start` FAILS — the `||` fallback — and it writes its own
  # line WHEN IT FIRES. Two acts, two events, two tx-free records: the same
  # ruling as `cmd_enable`. Without this one a reader would see an `ensure` it
  # could not attribute.
  _lc_done swap "$id" "" meas.from "$cur" meas.wrapper "$target" meas.uuid "$uuid"
```

- [ ] **Step 12: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts
```

Expected: 11 passed.

- [ ] **Step 13: Run the suites these nine sites live under.** `ccd-session-state` is a **known load
  flake** and `_spawn_settle` is the exact path its window sits on, so it runs alone:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-session-state.test.ts
```

Expected: green. Its known window is `expected ['mid-carry:orphan'] to include 'mid-carry:restarting'`;
that string is a flake, anything else is a real break from this task. Then:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-reg-claim.test.ts test/ccd-supervised-start.test.ts test/ccd-swap-refuse.test.ts test/ccd-session-lifecycle.test.ts test/ccd-hold.test.ts
```

Expected: all green. In particular `ccd-reg-claim.test.ts`'s "exactly one `_reg_set … started` line"
must still find exactly one, and every existing `cmd_stop` case must still see the same stdout — the
third argument is additive and the four internal callers pass nothing for it.

- [ ] **Step 14: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-sites.test.ts && git commit -m "ccd(w2): session call sites — supervise, claim, spawn (change-only), start, ensure, enable, stop, swap" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: Workspace call sites — ws-add, ws-rename, ws-hold, ws-release, ws-archive, ws-attic --drop

**AGENT-FIRST, ships DARK.**

**Files:** Modify `ccd/ccd` at six sites (lines **1867**, **2384**, **2572**, **2600**, **2754**,
**3165**). Modify `server/test/ccd-lifecycle-sites.test.ts`.

**Interfaces:**
- Consumes: `_lc_done` (Task 16).
- Produces: acts `create`, `rename`, `hold`, `release`, `archive`, `attic-drop`.
- **`cmd_ws_add`'s locals are measured, not assumed.** The function opens at ccd:1718 and its complete
  local set is `project slug main free hw w why addlock lfd base wt branch common id uuid rc`. There is
  **no `$ws`** and **no `$wrapper`**: the workspace slug is `$slug` and the wrapper is `$hw` (the one
  `_ws_least_loaded` picked, used again in the success line at ccd:1875). Under `set -uo pipefail` a
  reference to either name would EXIT the shell between the lock and the spawn, after the worktree
  exists.
- **`ws-attic --drop` emits AFTER its loop**, because `$n` — the destroyed count — does not exist until
  ccd:3164 has run.

**Steps:**

- [ ] **Step 1: Write the failing test.** Append to `server/test/ccd-lifecycle-sites.test.ts`:

```ts
describe('workspace call sites', () => {
  /** A real worktree on a real branch — cmd_ws_rename's ladder measures
   *  `.uuid`, hold, workspace, project+workdir+branch, `-d workdir`, the
   *  worktree record, detachment, foreignness and branch drift before it
   *  reaches the emit, so a stubbed `git` never gets there. */
  const renameable = (id = 'demo-still-river'): { main: string; wt: string } => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '--allow-empty', '-m', 'base');
    const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo
      _reg_set ${id} workspace still-river; _reg_set ${id} branch ws/still-river
      _reg_set ${id} workdir ${wt}`);
    return { main, wt };
  };

  it('cmd_ws_rename records old and new, and its stdout document is untouched', () => {
    renameable();
    const out = h.sh(`cmd_ws_rename --session demo-still-river --branch ws/new`);
    expect(out, 'the verb refused — the fixture is wrong, not the emit').toContain('"renamed"');
    expect(JSON.parse(out) as Record<string, string>, 'the emit must not add a byte to a document a consumer parses')
      .toEqual({ renamed: 'demo-still-river', old: 'ws/still-river', new: 'ws/new' });
    const [e] = eventsOf(h.home, 'rename');
    expect(e, 'ws-rename wrote no line').toBeTruthy();
    expect(measOf(e!)['old']).toBe('ws/still-river');
    expect(measOf(e!)['branch']).toBe('ws/new');
  });

  it('cmd_ws_hold records the reason verbatim, parsed nowhere', () => {
    h.sh(`_reg_set w uuid u; cmd_ws_hold --session w --reason 'program:build9 wave:2/6'`);
    const [e] = eventsOf(h.home, 'hold');
    expect(decOf(e!)['reason']).toBe('program:build9 wave:2/6');
  });

  it('cmd_ws_release records a release, and records nothing when nothing was held', () => {
    h.sh(`_reg_set w uuid u; cmd_ws_release --session w`);
    expect(eventsOf(h.home, 'release')).toHaveLength(0);
    h.sh(`_reg_set w hold 'program:x'; cmd_ws_release --session w`);
    const rel = eventsOf(h.home, 'release');
    expect(rel).toHaveLength(1);
    expect(measOf(rel[0]!)['held'], 'the text being released is the fact worth keeping').toBe('program:x');
  });

  it('cmd_ws_archive records the closed reason vocabulary, through the VERB', () => {
    // Mutant: emit before ccd:2753-2754 -> this fails with `expected undefined
    // to be 'manual'`, because `$reason` is not decided until ccd:2750-2752.
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '--allow-empty', '-m', 'base');
    const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
    fs.writeFileSync(path.join(wt, 'f.txt'), 'one');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'one');
    h.sh(`_reg_set demo-still-river uuid u; _reg_set demo-still-river project demo
      _reg_set demo-still-river workspace still-river
      _reg_set demo-still-river branch ws/still-river
      _reg_set demo-still-river workdir ${wt}
      _ws_status() { echo idle; }; _ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; }
      cmd_ws_archive --session demo-still-river 2>/dev/null || true`);
    const [e] = eventsOf(h.home, 'archive');
    expect(e, 'ws-archive wrote no line').toBeTruthy();
    expect(measOf(e!)['archivedReason']).toBe('manual');
    expect(measOf(e!)['branch']).toBe('ws/still-river');
  });

  it('ws-attic --drop records HOW MANY refs it destroyed — a count only the loop knows', () => {
    // Mutant: move the emit above the `while … done` loop -> this fails with
    // `expected NaN to be greater than or equal to 2`, because `$n` is 0 before
    // ccd:3164 and a fabricated zero on a destructive verb is a false record.
    const repo = h.makeRepo('demo');
    h.git(repo, 'commit', '--allow-empty', '-m', 'a');
    const one = h.git(repo, 'rev-parse', 'HEAD').trim();
    h.git(repo, 'commit', '--allow-empty', '-m', 'b');
    const two = h.git(repo, 'rev-parse', 'HEAD').trim();
    h.git(repo, 'update-ref', `refs/ccrc/attic/w/${one}`, one);
    h.git(repo, 'update-ref', `refs/ccrc/attic/w/${two}`, two);
    // `_attic_project` reads the registry FIRST (ccd:3137-3145); with no row and
    // no tombstone the verb dies `no such session` at ccd:3153.
    h.sh(`_reg_set w project demo; cmd_ws_attic --drop w`);
    const [e] = eventsOf(h.home, 'attic-drop');
    expect(e, 'ws-attic --drop wrote no line').toBeTruthy();
    expect(Number(measOf(e!)['dropped'])).toBeGreaterThanOrEqual(2);
  });
});
```

  and extend that file's imports with `fs` and `path`:

```ts
import fs from 'node:fs';
import path from 'node:path';
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts
```

Expected: the five new cases fail; the first with `ws-rename wrote no line: expected undefined to be truthy`.

- [ ] **Step 3: Edit `cmd_ws_add`.** In `ccd/ccd`, insert immediately before line **1867**
  (`  _spawn_start "$id" new || return $?`):

```bash
  # BEFORE the spawn, because `_spawn_start` can `return` and the fact worth
  # recording is that this workspace came into existence — the registry has no
  # creation timestamp anywhere (§0), and `.spawn` is the LAST respawn.
  #
  # THE NAMES ARE THIS FUNCTION'S OWN, measured against its local set: the slug
  # is `$slug` and the wrapper is `$hw` (`_ws_least_loaded`'s pick, used again
  # at ccd:1875). There is no `$ws` and no `$wrapper` here, and under
  # `set -uo pipefail` naming one would EXIT the shell between the lock and the
  # spawn, with the worktree already on disk.
  _lc_done create "$id" "" meas.project "$project" meas.workspace "$slug" \
    meas.branch "$branch" meas.base "$base" meas.workdir "$wt" meas.wrapper "$hw"
```

- [ ] **Step 4: Edit `cmd_ws_rename`.** In `ccd/ccd`, insert immediately before line **2384**
  (`  _reg_set "$id" branch "$new"`):

```bash
  # AFTER ccd:2383's `git branch -m` succeeded, so `branch` is the name the
  # repository actually carries now, and `old` is what it carried before.
  _lc_done rename "$id" "" meas.old "$old" meas.branch "$new" \
    meas.project "$(_reg_get "$id" project)"
```

- [ ] **Step 5: Edit `cmd_ws_hold`.** In `ccd/ccd`, insert immediately before line **2572**:

```bash
  # The reason is DECLARED (`dec`), never measured: ccd:2515-2516's contract is
  # "write it verbatim, parse it nowhere", and the journal keeps that promise.
  # `_lc_json` quotes it with `json.dumps`, so it cannot forge a field however
  # it is spelled.
  _lc_done hold "$id" "" dec.reason "$reason"
```

- [ ] **Step 6: Edit `cmd_ws_release`.** In `ccd/ccd`, insert immediately before line **2600**:

```bash
    # INSIDE the `-e` arm (ccd:2586), so a `not held` answer writes nothing: an
    # idempotent no-op is not an act, and recording one would make the record
    # disagree with what happened. Read BEFORE the unlink, which is the only
    # instant the text exists.
    _lc_done release "$id" "" meas.held "$(cat "$REG/$id.hold" 2>/dev/null)"
```

- [ ] **Step 7: Edit `cmd_ws_archive`.** In `ccd/ccd`, insert immediately after line **2754**
  (`  _reg_set "$id" archivedreason "$reason"`):

```bash
  # AFTER both markers, so `reason` is the value that actually landed. It is one
  # of exactly three words (ccd:2750-2752): merged:#N | empty | manual.
  # `.archived` is the one registry field carrying a WHY, and it is measurably
  # false on four live rows right now — which is why the journal records the act
  # rather than trusting the field.
  _lc_done archive "$id" "" meas.archivedReason "$reason" \
    meas.branch "$(_reg_get "$id" branch)" meas.project "$(_reg_get "$id" project)"
```

- [ ] **Step 8: Edit `cmd_ws_attic --drop`.** In `ccd/ccd`, insert immediately before line **3165**
  (`      echo "dropped $n attic ref…`):

```bash
      # AFTER the loop, and that is not style: `$n` is the destroyed count and
      # it does not exist until ccd:3164 has run. An emit above the loop can
      # only report zero, which on a destructive verb is a fabricated
      # measurement — the class this file names by number.
      _lc_done attic-drop "$id" "" meas.dropped "$n" meas.project "$project"
```

- [ ] **Step 9: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts
```

Expected: 16 passed.

- [ ] **Step 10: Run the six verbs' own suites.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/ccd-hold.test.ts test/ccd-archive.test.ts test/ccd-ws-rename.test.ts
```

Expected: all green. In particular `ccd-ws-rename.test.ts` must still see the exact
`{"renamed":…,"old":…,"new":…}` document on stdout — the emit prints nothing.

- [ ] **Step 11: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-sites.test.ts && git commit -m "ccd(w2): workspace call sites — create, rename, hold, release, archive, attic-drop" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: The four destructive verbs get intent/outcome pairs (D4)

**AGENT-FIRST, ships DARK.**

**Files:** Modify `ccd/ccd` in `cmd_ws_rm` (lines **2039**, **2053-2054**, **2089**), `cmd_forget`
(**9686**, **9689**), `_ws_gc_prune_row` (**7252-7254**, **7362**, **7383**, **7385**) and
`_ws_reap_tail` (**6284**, **6774**). Create `server/test/ccd-lifecycle-pairs.test.ts`.

**Interfaces:**
- Consumes: `_lc_tx`, `_lc_intent`, `_lc_done`, `_lc_fail` (Task 16).
- Produces: for acts `destroy` (ws-rm), `forget`, `gc-prune`, `reap` — **one line before the
  irreversible act and one after, sharing a `tx` held in a `local`.** An `intent` with a `failed`
  sibling is a half-destroyed workspace; **an `intent` with no sibling at all is a process that died
  mid-destroy.** Orphan detection is derived by the reader, never stored.
- Produces: the top-level `verb` field — `ws-rm`, `forget`, `ws-gc`, `ws-reap` — on both halves of each
  pair. `act` says WHAT happened; `verb` says which command ran, and they are not the same question.
- **`branchDeleted` has THREE states, not two.** `false` = the branch still exists; `true` = it is gone;
  **absent** = there was no branch to delete. The detached-HEAD workspace is the case this feature
  exists for (`ccd-workspaces.test.ts:970` is its fixture), and answering `true` there is a fabricated
  fact on the one record that outlives the workspace.

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-lifecycle-pairs.test.ts`:

```ts
// server/test/ccd-lifecycle-pairs.test.ts
//
// D4. The measured hole this closes: `$REG/.reap-<id>.lock` — 12 files on the
// live box, one with a lock and no tombstone, a reap attempted and refused,
// recorded nowhere.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-pairs-'); });
afterEach(() => { h.cleanup(); });

const half = (act: string, outcome: string): Record<string, unknown>[] =>
  eventsOf(h.home, act).filter((e) => e['outcome'] === outcome);

/** A real worktree on a real branch, so `_ws_wt_branch` and `git branch -d`
 *  both answer for real. */
const workspace = (id = 'demo-still-river'): { main: string; wt: string } => {
  const main = h.makeRepo('demo');
  h.git(main, 'commit', '--allow-empty', '-m', 'base');
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo
    _reg_set ${id} workspace still-river; _reg_set ${id} branch ws/still-river
    _reg_set ${id} workdir ${wt}`);
  return { main, wt };
};

const STUB = `_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };`;

describe('ws-rm writes an intent/done pair sharing one tx', () => {
  it('brackets the destruction, names the verb, and the intent precedes the teardown', () => {
    workspace();
    h.sh(`_ws_unsupervise() { echo unsup >> "$HOME/order"; }; _tmux() { echo t; }; tmux() { :; }
      cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const i = half('destroy', 'intent'); const d = half('destroy', 'done');
    expect(i, 'no intent line').toHaveLength(1);
    expect(d, 'no done line').toHaveLength(1);
    expect(i[0]!['tx']).toBe(d[0]!['tx']);
    expect(String(i[0]!['tx'])).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect(i[0]!['verb']).toBe('ws-rm');
    expect(fs.existsSync(path.join(h.home, 'order')), 'the teardown really ran').toBe(true);
  });

  it('leaves an intent with NO sibling when the process dies mid-destroy', () => {
    // Mutant: emit both lines adjacently at the end -> this fails with
    // `expected 0 to be 1`, and a half-destroyed workspace becomes
    // indistinguishable from one that was never touched.
    workspace();
    try {
      // `kill -9 $$` kills the SOURCING shell, so execFileSync throws on the
      // signal and `|| true` is never reached. Catching it IS the case.
      h.sh(`_ws_unsupervise() { kill -9 $$; }; _tmux() { echo t; }; tmux() { :; }
        cmd_ws_rm demo-still-river`);
    } catch { /* the point of the case: the process died mid-destroy */ }
    expect(half('destroy', 'intent'), 'the intent must survive the kill').toHaveLength(1);
    expect(half('destroy', 'done'), 'the done line must not exist').toHaveLength(0);
  });

  it('records branchDeleted as a fact when the branch survives', () => {
    const { wt } = workspace();
    fs.writeFileSync(path.join(wt, 'f.txt'), 'unmerged');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'unmerged');
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    expect(measOf(half('destroy', 'done')[0]!)['branchDeleted'], 'git refuses an unmerged branch')
      .toBe('false');
  });

  it('OMITS branchDeleted when there was no branch at all', () => {
    // Mutant: `[[ -n "$branch" ]] && … && echo false || echo true` -> this
    // fails with `expected 'true' to be undefined`. On a detached-HEAD
    // workspace (`ccd-workspaces.test.ts:970` is the fixture) that expression
    // answers "the branch was deleted" about a workspace that never had one —
    // a fabricated fact on the one record that outlives the workspace.
    const { main } = workspace('demo-detached');
    const wt = path.join(h.home, 'worktrees', 'demo', 'detached');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '--detach', wt);
    h.sh(`_reg_set demo-detached workdir ${wt}; rm -f "$REG/demo-detached.branch"
      _reg_set demo-detached workspace detached`);
    h.sh(`${STUB} cmd_ws_rm demo-detached 2>/dev/null || true`);
    const [d] = half('destroy', 'done');
    expect(d, 'no done line for the detached workspace').toBeTruthy();
    expect(measOf(d!)).not.toHaveProperty('branchDeleted');
  });
});

describe('forget writes an intent/done pair', () => {
  it('brackets the purge and names the verb', () => {
    h.sh(`_reg_set s uuid u; _reg_set s wrapper claude-corp
      ${STUB} _session_verdict() { echo gone; }
      cmd_forget s`);
    expect(eventsOf(h.home, 'forget').map((e) => e['outcome'])).toEqual(['intent', 'done']);
    const [i, d] = eventsOf(h.home, 'forget');
    expect(i!['tx']).toBe(d!['tx']);
    expect(i!['verb']).toBe('forget');
  });
});

describe('ws-gc --prune writes a pair per destroyed row', () => {
  it('brackets the dead-reg purge', () => {
    h.sh(`_reg_set demo-slug uuid u; _reg_purge() { :; }
      _gc_reclaimed() { :; }; _gc_declined() { :; }; _gc_row() { :; }
      GC_RECLAIMED=0; GC_DECLINED=0
      _ws_gc_prune_row dead-reg demo slug /nowhere 0`);
    expect(eventsOf(h.home, 'gc-prune').map((e) => e['outcome'])).toEqual(['intent', 'done']);
    expect(eventsOf(h.home, 'gc-prune')[0]!['verb']).toBe('ws-gc');
  });

  it('writes NOTHING for a declined row — a refusal is not a destruction', () => {
    h.sh(`_gc_declined() { :; }; _gc_row() { :; }; GC_RECLAIMED=0; GC_DECLINED=0
      _ws_gc_prune_row foreign-stale demo slug /nowhere 0`);
    expect(eventsOf(h.home, 'gc-prune')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-pairs.test.ts
```

Expected: all 7 fail; the first with `no intent line: expected [] to have a length of 1`.

- [ ] **Step 3: Open ws-rm's pair.** In `ccd/ccd`, insert immediately before line **2039**
  (`  _ws_unsupervise "$id"`):

```bash
  # THE PAIR. `tx` is a `local`, minted here and passed to both halves — there
  # is no global carrying it, and there must not be: the `LC_TIP=` idiom dies
  # under `set -u` on the first call in a process and appends a blank line
  # nobody notices. Everything above this point is the refuse-first ladder, so
  # the intent sits exactly on the boundary of the irreversible.
  local lctx; lctx=$(_lc_tx)
  _lc_intent destroy "$id" "$lctx" verb ws-rm meas.project "$project" \
    meas.workspace "$ws" meas.branch "$branch" meas.workdir "$workdir" \
    meas.registered "$registered"
```

- [ ] **Step 4: Record the post-teardown failure.** In `ccd/ccd`, replace lines **2053-2054** with:

```bash
    git -C "$main" worktree remove "$workdir" \
      || { _lc_fail destroy "$id" "$lctx" worktree-remove-failed \
             "git refused to clear the worktree record for $workdir"
           die "worktree record not cleared for $workdir — the session was stopped; git refused: unlock it (git -C $main worktree unlock $workdir) or clean the tree, then re-run — and if the directory is already gone, git -C $main worktree prune clears the record"; }
```

  `_lc_fail`, not `_lc_refuse`: the session is already stopped when this fires, so calling it a refusal
  would say nothing was touched, which is false. That is also why `_lc_fail` does not die and the `die`
  stays explicit beside it — the one sanctioned bare-`die` shape the Task 26 scanner allows.

- [ ] **Step 5: Close ws-rm's pair.** In `ccd/ccd`, insert immediately before line **2089**
  (`  echo "removed workspace $id"`):

```bash
  # AFTER `_reg_purge`, so the `done` line sits after the terminal act. Note
  # this workspace now has TWO records for one removal — the D3 backstop's
  # `purge` line and this `destroy`/`done` — and that redundancy is the design:
  # a silent destruction has to defeat two independent emit sites.
  #
  # THREE STATES, THREE VALUES. `git branch -d` at ccd:2066 refuses an unmerged
  # branch and that refusal is wanted; an empty `bd` is OMITTED by the encoder,
  # which is how "there was no branch" stays distinct from "the branch is gone".
  # A two-valued expression answers `true` for a detached HEAD — a fabricated
  # fact on the one record that outlives the workspace.
  local bd=""
  if [[ -n "$branch" ]]; then
    if git -C "$main" show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null
    then bd=false; else bd=true; fi
  fi
  _lc_done destroy "$id" "$lctx" verb ws-rm meas.branch "$branch" branchDeleted "$bd"
```

- [ ] **Step 6: Open and close forget's pair.** In `ccd/ccd`, insert immediately before line **9686**
  (`  _ws_unsupervise "$id"`):

```bash
  local lctx; lctx=$(_lc_tx)
  _lc_intent forget "$id" "$lctx" verb forget meas.wrapper "$(_reg_get "$id" wrapper)" \
    meas.project "$(_reg_get "$id" project)" meas.uuid "$(_reg_get "$id" uuid)"
```

  and insert immediately before line **9689** (`  echo "forgot $id — …"`):

```bash
  _lc_done forget "$id" "$lctx" verb forget
```

- [ ] **Step 7: Bracket `_ws_gc_prune_row`'s dead-reg arm.** In `ccd/ccd`, replace lines
  **7252-7254** with:

```bash
    dead-reg)
      # A `local` inside this arm, and the calls are NOT wrapped in `$( )`:
      # ccd:7480-7486 records that a subshell here puts `_gc_reclaimed`'s
      # increment out of reach and the footer reads 0 for every run. `_lc_*`
      # prints nothing, so no capture is needed and none is taken.
      local lctx; lctx=$(_lc_tx)
      _lc_intent gc-prune "$project-$slug" "$lctx" verb ws-gc \
        meas.project "$project" meas.workspace "$slug" meas.state dead-reg
      _reg_purge "$project-$slug"                                          # finding F3
      _lc_done gc-prune "$project-$slug" "$lctx" verb ws-gc
      _gc_reclaimed "dead registry entry $project-$slug" ;;
```

- [ ] **Step 8: Bracket `_ws_gc_prune_row`'s orphan arm.** In `ccd/ccd`, insert immediately before
  line **7362** (`      if git -C "$main" worktree remove "$p" 2>/dev/null; then`):

```bash
      local lctx; lctx=$(_lc_tx)
      _lc_intent gc-prune "$project-$slug" "$lctx" verb ws-gc \
        meas.project "$project" meas.workspace "$slug" meas.state orphan \
        meas.workdir "$p" meas.branch "$branch"
```

  insert immediately after line **7383**'s `fi` (which closes the `git branch -d` block) and before the
  arm's `else`:

```bash
        # `git branch -d` at ccd:7381 has NO else — a refused delete is silent
        # in the report. The `done` line therefore measures it rather than
        # inheriting the report's silence, and omits the key entirely when
        # there was no branch.
        local bd=""
        if [[ -n "$branch" ]]; then
          if git -C "$main" show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null
          then bd=false; else bd=true; fi
        fi
        _lc_done gc-prune "$project-$slug" "$lctx" verb ws-gc \
          meas.workdir "$p" meas.branch "$branch" branchDeleted "$bd"
```

  and insert immediately before line **7385** (`        _gc_declined "git refused to remove $p"`):

```bash
        _lc_fail gc-prune "$project-$slug" "$lctx" worktree-remove-failed \
          "git refused to remove $p"
```

- [ ] **Step 9: Open the reap pair.** In `ccd/ccd`, insert immediately after line **6284**
  (`  bytes=$(_ws_gc_bytes "$workdir"); [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=null`):

```bash
  # THE PAIR, opened after the last measurement and before every destructive
  # step in this function. `resumed` is on the line because an interrupted reap
  # that resumes writes a SECOND intent — two attempts, two records, which is
  # exactly what the 12 orphaned `.reap-<id>.lock` files could not say.
  local lctx; lctx=$(_lc_tx)
  _lc_intent reap "$id" "$lctx" verb ws-reap meas.project "$project" \
    meas.workdir "$workdir" meas.branch "$branch" meas.bytes "$bytes" \
    meas.resumed "$resumed"
```

- [ ] **Step 10: Close the reap pair.** In `ccd/ccd`, insert immediately after line **6774**
  (`  _reg_purge "$id"                                                         # (i) LAST, finding F3`)
  and before the `MUTATION SURVIVOR` comment block at 6775-6780:

```bash
  # `WsTombstone` stays reap's, and this line names it so `GET /api/lifecycle`
  # can join the two through the already-whitelisted `$REG/.reaped/` read —
  # the tombstone's first CONSUMER. No `_ws_tombstone` call is added to any
  # other verb: it dereferences seven `REAP_*` globals set only inside
  # `_ws_reap_eval`, so under `set -uo pipefail` the subshell dies and the
  # promised record is silently absent.
  _lc_done reap "$id" "$lctx" verb ws-reap meas.branch "$branch" \
    meas.tombstone "$tomb" meas.attic "${attic:-0}" meas.bytes "$bytes"
```

- [ ] **Step 11: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-pairs.test.ts
```

Expected: 7 passed.

- [ ] **Step 12: Run the four verbs' own suites.** `ccd-ws-gc` is a known load flake, so it runs alone:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/ccd-forget.test.ts test/ccd-ws-reap.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts
```

Expected: all green. `ccd-ws-gc.test.ts` asserts the `reclaimed N, declined M` footer; if it is red on a
COUNT, an emit was wrapped in `$( )` somewhere — that is a real break, not a flake.

- [ ] **Step 13: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-lifecycle-pairs.test.ts && git commit -m "ccd(w2): intent/outcome pairs on ws-rm, forget, ws-gc --prune, ws-reap (D4)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 21: The write-containment scanner, the `meas` key vocabulary, and the wave-2 agent deploy

**AGENT-FIRST. This task ships wave 2 to the fleet host (BOX 2, the box that runs `ccd`, tmux and
`~/.cc-sessions/`).**

**Files:** Create `server/test/ccd-lifecycle-contain.test.ts`. No `ccd/ccd` edit.

**Interfaces:**
- Consumes: `ccd/ccd`'s `LC-BEGIN`/`LC-END` markers (Task 12), every emit site (Tasks 17-20).
- Produces: D1 as a mechanism — **nothing outside the `_lc_*` block writes into `.lifecycle/`, and no
  `bash -c`/`systemd-run` string in the file names it.**
- Produces: **the `meas` key vocabulary, in one place.** L0's `LifecycleMeas` declares ten members —
  `project workspace branch uuid wrapper tip attic archivedAt archivedReason held`. This wave emits
  **fifteen more**: `workdir base old rc mode inUnit from dropped registered state bytes resumed
  tombstone manifestBytes atticsrc`. **Twenty-five in total, and this test is the list both sides check
  against.** Wave 1 must either widen `LifecycleMeas` with these fifteen or declare an index signature;
  wave 4's `reviveMeas` reads through one list either way, and a key not on it is silently dropped at
  ingest. A twenty-sixth key reds this suite, which is the point.

**Steps:**

- [ ] **Step 1: Write the scanner.** Create `server/test/ccd-lifecycle-contain.test.ts`:

```ts
// server/test/ccd-lifecycle-contain.test.ts
//
// D1's one rule, as a red suite. `$REG/swap.log` is the precedent AND the
// counter-example: 141,762 B over 49 days with zero corruption from 13
// concurrent `printf >>` sites, and ~30% of its lines untimestamped because
// ccd:7568 and ccd:9423 redirect a CHILD'S stdout+stderr into it from inside a
// double-quoted `bash -c` string. That second shape is what this forbids.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');
const BEGIN = '# ── lifecycle journal ';
const END = '# ── end lifecycle journal ';

/** Code lines only. The rule is "nothing outside the block WRITES", not
 *  "nothing outside the block MENTIONS": ccd:1536's dot-artifact inventory
 *  names `.lifecycle/` on purpose, and a scan that cannot tell a comment from a
 *  redirect punishes the documentation this design depends on. */
const code = (s: string): string[] =>
  s.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));

describe('nothing but the _lc_* block writes into .lifecycle/', () => {
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);

  it('found the block, and it is substantial — an empty slice passes everything', () => {
    expect(from, 'LC-BEGIN not found').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to).length,
      'the block collapsed — every assertion below would be vacuous').toBeGreaterThan(4000);
  });

  it('CATCHES a write planted outside the block — the positive control', () => {
    // The scan is weakened to code lines, so it must be shown to still bite.
    // Synthetic source first, ccd second: `ccd-die-containment.test.ts`'s rule.
    const planted = `${src.slice(0, from)}\n  echo x >> "$REG/.lifecycle/probe"\n${src.slice(from)}`;
    const outside = code(planted.slice(0, planted.indexOf(BEGIN)))
      .filter((l) => l.includes('.lifecycle'));
    expect(outside, 'the scanner cannot see a planted write — it is vacuous').toHaveLength(1);
  });

  it('names .lifecycle in no CODE line outside the block', () => {
    // Mutant: add `echo x >> "$REG/.lifecycle/journal-1.ndjson"` to cmd_ws_rm ->
    // this fails naming ccd's line number, and the journal grows a second
    // writer with no cap, no rotation and no uid.
    const before = code(src.slice(0, from));
    const after = code(src.slice(to));
    const hits = [...before, ...after]
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => l.includes('.lifecycle'));
    expect(hits.map(([n, l]) => `${n}: ${l.trim()}`),
      'a .lifecycle WRITE lives outside the _lc_* block').toEqual([]);
  });

  it('never names .lifecycle inside a bash -c or systemd-run string', () => {
    // The swap.log defect exactly: a child's stdout redirected into the log
    // from inside a quoted string produces unstructured, untimestamped lines
    // that no parser can model and no cap can bound.
    for (const line of src.split('\n')) {
      if (/bash -c|systemd-run/.test(line)) {
        expect(line, 'a child process is being pointed at the journal').not.toContain('.lifecycle');
      }
    }
  });

  it('routes every journal write through exactly one printf, inside _lc_emit', () => {
    const block = src.slice(from, to);
    const appends = block.split('\n').filter((l) => /^\s*printf .*>>\s*"\$live"/.test(l));
    expect(appends, 'there must be exactly one append site in the whole file').toHaveLength(1);
  });

  it('forks python3 exactly twice in the block — the event encoder and the obs encoder', () => {
    // Mutant: add a third `python3 -c` -> this fails with `expected 3 to be 2`.
    // `_json_str`'s contract is "non-zero means python3 could not be RUN", and
    // ccd:711-713 records what a third, unchecked encoder costs: `"reason":,`
    // inside a printf argument list that swallowed the status.
    const block = src.slice(from, to);
    expect([...block.matchAll(/python3 -c/g)]).toHaveLength(2);
    expect(block).toContain('_lc_obs_json()');
    expect(block).toContain('_lc_json()');
  });

  it('the agent structurally cannot write it — no write grant is added anywhere', () => {
    const wl = readFileSync(CCD.replace(/ccd\/ccd$/, 'agent/src/whitelist.ts'), 'utf8');
    expect(wl).not.toContain('.lifecycle');
    expect(wl.match(/mode === 'write'/g), 'the write whitelist grew a second arm').toHaveLength(1);
  });
});

describe('the meas key vocabulary is ONE list', () => {
  // L0's LifecycleMeas declares the first ten. The other fifteen are this
  // wave's, and wave 4's `reviveMeas` reads through one list either way — a key
  // not on it is silently dropped at ingest, which is why the list lives in a
  // test rather than in a comment.
  const DECLARED = [
    'project', 'workspace', 'branch', 'uuid', 'wrapper',
    'tip', 'attic', 'archivedAt', 'archivedReason', 'held',
  ];
  const EXTENSIONS = [
    'workdir', 'base', 'old', 'rc', 'mode', 'inUnit', 'from', 'dropped',
    'registered', 'state', 'bytes', 'resumed', 'tombstone', 'manifestBytes', 'atticsrc',
  ];

  it('every meas.<key> ccd writes is on the list, and the list is exactly 25', () => {
    // Mutant: emit `meas.slug` at any call site -> this fails with
    // `an unlisted meas key: [ 'slug' ]`, and wave 4 drops it at ingest with
    // nothing saying so.
    const all = new Set([...DECLARED, ...EXTENSIONS]);
    expect(all.size, 'the list itself has a duplicate').toBe(25);
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect(used.size, 'no meas key found at all — the scan is vacuous').toBeGreaterThan(10);
    expect([...used].filter((k) => !all.has(k)).sort(), 'an unlisted meas key').toEqual([]);
  });

  it('every top-level key ccd writes is one of the five', () => {
    const TOP = ['detail', 'refusal', 'verb', 'badact', 'branchDeleted'];
    const block = src.slice(src.indexOf(BEGIN), src.indexOf(END));
    for (const t of TOP) expect(block, `${t} is not routed by the encoder`).toContain(`"${t}"`);
    expect([...src.matchAll(/^\s*TOP = \(/gm)], 'the TOP tuple moved or was duplicated')
      .toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it — this scanner is a guard over work already done.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts
```

Expected: 9 passed. If any case is red, the finding is real — a second `.lifecycle` writer, a third
python3 fork, or a `meas` key nobody declared.

- [ ] **Step 3: Prove the scanner bites against ccd itself.** Temporarily append
  `echo x >> "$REG/.lifecycle/probe"` inside `cmd_ws_rm` at line 2089, re-run:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts
```

Expected: `names .lifecycle in no CODE line outside the block` fails, naming the line. **Remove the
probe** and re-run to green.

- [ ] **Step 4: Run the whole server suite once, foreground, before shipping anything.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
```

Expected: green. `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` and `ccd-session-state` are
the known load flakes — re-run any red one in isolation before treating it as a break from this wave.

- [ ] **Step 5: Run the agent suite, which must be green with ZERO edits.** The zero-grants property is
  the design's headline.

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/agent && npm ci && npm run test
```

Expected: green, and `whitelist.test.ts` / `whitelist-subset.test.ts` untouched.

- [ ] **Step 6: Commit the scanner.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/test/ccd-lifecycle-contain.test.ts && git commit -m "test(w2): scan that nothing but _lc_emit writes into .lifecycle/, and one meas key list (D1)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: AGENT-FIRST DEPLOY.** Wave 2 touches `ccd/`, so the fleet host ships before the server —
  and the server ships nothing this wave, because wave 2 is DARK: the journal fills and nothing reads it.
  `<fleet-host>` is BOX 2, the box that runs `ccd-agent`, `ccd`, tmux and `~/.cc-sessions/`; it is not
  `<server-host>`, which is the server host.

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && bash deploy/deploy.sh agent <fleet-host>
```

- [ ] **Step 8: Verify on the fleet host, READ-ONLY.**

```bash
ssh <fleet-host> 'ccd caps | grep -x lifecycle-v1; ls -la ~/.cc-sessions/.lifecycle/ 2>/dev/null | head'
```

Expected: `lifecycle-v1` on stdout, and — after the first supervisor cycle — one
`journal-<19 digits>.ndjson`. **Run no destructive verb against the live host to test this.** The
supervisor's own `ensure`/`spawn` traffic is sufficient evidence within one Restart cycle.

---
### Task 22: W3 · R4-1 — `ws-rm` takes an attic pin before it deletes anything

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — `cmd_ws_rm`: the pin block at the blank line **2038** (between `fi` at 2037 and
  Task 20's pair at 2039), the `local reg_branch` declaration at **2057**, and Task 20's
  `_lc_intent destroy` call.
- Create `server/test/ccd-ws-rm-attic.test.ts`.

**Interfaces:**
- Consumes: `_ws_attic_pin <main> <id> <workdir> <tip>` (`ccd:5283`, echoes the count of refs created;
  its own header states it contains no `die`, so a `$( )` capture is safe under
  `ccd-die-containment.test.ts`), `_lc_refuse` (Task 16).
- Produces: `refs/ccrc/attic/<id>/<sha>` for the tip and up to 200 reflog shas, **before**
  `_ws_unsupervise`; the `destroy`/`intent` line gains `meas.tip`, `meas.attic` and `meas.atticsrc`
  (`worktree | registry | none`).
- Produces: the refusal token `tip-unreadable` (L0's `LC_REFUSAL_TOKENS`).

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-ws-rm-attic.test.ts`:

```ts
// server/test/ccd-ws-rm-attic.test.ts
//
// Today a detached-HEAD `ws-rm` leaves commits referenced by nothing on git's
// default two-week fuse, while `ws-gc` refuses that exact case — the sharpest
// reversibility gap in the file. `_ws_attic_pin` already exists for `ws-reap`
// and its own header licenses being called from anywhere.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-wsrm-attic-'); });
afterEach(() => { h.cleanup(); });

const STUB = `_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };`;

/** A real worktree on a real branch with three commits — the shape only the
 *  reflog remembers once one is amended away. */
const fixture = (id = 'demo-still-river'): { main: string; wt: string } => {
  const main = h.makeRepo('demo');
  h.git(main, 'commit', '--allow-empty', '-m', 'base');
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
  for (const m of ['one', 'two', 'three']) {
    fs.writeFileSync(path.join(wt, 'f.txt'), m);
    h.git(wt, 'add', 'f.txt');
    h.git(wt, 'commit', '-m', m);
  }
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace still-river
    _reg_set ${id} branch ws/still-river; _reg_set ${id} workdir ${wt}`);
  return { main, wt };
};

const attic = (main: string, id: string): string[] =>
  h.git(main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${id}/`)
    .split('\n').map((l) => l.trim()).filter(Boolean);

const intentMeas = (): Record<string, string> =>
  measOf(eventsOf(h.home, 'destroy').filter((e) => e['outcome'] === 'intent')[0]!);

describe('ws-rm pins the workspace into the attic before it destroys it', () => {
  it('pins the tip, so an unmerged branch that ws-rm keeps is still reachable by sha', () => {
    // Mutant: delete the `_ws_attic_pin` call -> this fails with
    // `expected [] to have a length of at least 1`, and the commits are on
    // git's default two-week fuse referenced by nothing.
    const { main } = fixture();
    const tip = h.git(main, 'rev-parse', 'ws/still-river').trim();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const refs = attic(main, 'demo-still-river');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.some((r) => r.endsWith(tip)), 'the branch tip itself must be pinned').toBe(true);
  });

  it('THE MUTANT THAT MATTERS: the pin must precede git worktree remove', () => {
    // `git worktree remove` deletes $main/.git/worktrees/<slug>/, which holds
    // the HEAD reflog. `_ws_attic_pin`'s reflog read is guarded by
    // `[[ -d "$workdir" ]]`, so a pin moved below it contributes NOTHING but a
    // pre-resolved tip and the amended-away shas are gone.
    const { main, wt } = fixture();
    fs.writeFileSync(path.join(wt, 'f.txt'), 'amended');
    h.git(wt, 'add', 'f.txt');
    h.git(wt, 'commit', '--amend', '-m', 'three-amended');
    const reflog = h.git(wt, 'reflog', 'show', '--format=%H')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(reflog.length, 'the fixture produced no reflog to lose').toBeGreaterThan(3);

    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    expect(attic(main, 'demo-still-river').length,
      'a pin taken after `git worktree remove` sees no reflog and pins only the tip')
      .toBeGreaterThan(1);
  });

  it('pins UNCONDITIONALLY, even when git branch -d later refuses', () => {
    const { main } = fixture();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    expect(attic(main, 'demo-still-river').length).toBeGreaterThanOrEqual(1);
  });

  it('records the pin count and its source on the destroy intent line', () => {
    fixture();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const m = intentMeas();
    expect(Number(m['attic'])).toBeGreaterThanOrEqual(1);
    expect(m['atticsrc']).toBe('worktree');
    expect(m['tip']).toMatch(/^[0-9a-f]{40}$/);
  });

  it('REFUSES when the tip is unreadable and the directory is still there', () => {
    // ws-rm's contract is "refuses anything it might destroy". A workspace on
    // disk whose tip cannot be resolved is exactly that. The stub is narrowed to
    // the ONE call this block makes: `_ws_common_dir` (ccd:1921-1926) also runs
    // `rev-parse`, and a blanket stub kills it, so ccd:1996-1997 fires first
    // with a different sentence and no journal line at all.
    fixture();
    let stderr = ''; let code = 0;
    try {
      h.sh(`${STUB}
        git() { case "$*" in *"rev-parse HEAD"*) return 1 ;; esac; command git "$@"; }
        cmd_ws_rm demo-still-river`);
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      code = err.status ?? 1; stderr = String(err.stderr ?? '');
    }
    expect(code).not.toBe(0);
    expect(stderr).toContain('could not resolve');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'tip-unreadable' }]);
  });

  it('PROCEEDS with atticsrc "none" when the tip is unreadable and the directory is gone', () => {
    // The deliberate asymmetry: refusing here would wedge cleanup on a
    // workspace with nothing left to protect. A measurement, not a fabricated
    // zero — `none` is recorded, not omitted.
    h.makeRepo('demo');
    h.sh(`_reg_set gone-x uuid u; _reg_set gone-x project demo; _reg_set gone-x workspace x
      _reg_set gone-x workdir ${h.home}/not-here`);
    h.sh(`${STUB} cmd_ws_rm gone-x 2>/dev/null || true`);
    expect(intentMeas()['atticsrc']).toBe('none');
    expect(refusalsOf(h.home), 'a missing directory is not a refusal').toEqual([]);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-rm-attic.test.ts
```

Expected: all 6 fail; the first with `expected [] to have a length of at least 1`.

- [ ] **Step 3: Hoist `reg_branch`.** In `ccd/ccd`, replace line **2057**
  (`  local reg_branch; reg_branch=$(_reg_get "$id" branch)`) with:

```bash
  # DECLARED IN THE R4-1 BLOCK ABOVE NOW, not here: the attic pin needs it to
  # resolve a tip from the registry when the worktree is gone, and a SECOND
  # `local` in the same function re-declares and blanks it. One reader, one place.
```

- [ ] **Step 4: Insert the pin.** In `ccd/ccd`, replace the blank line **2038** (between `fi` at 2037
  and Task 20's `# THE PAIR.` comment) with:

```bash

  # ── R4-1 · THE ATTIC PIN, BEFORE ANYTHING IS TOUCHED ────────────────────
  # `git worktree remove` at ccd:2053 deletes both $workdir and
  # $main/.git/worktrees/<slug>/, and the latter holds the HEAD reflog.
  # `_ws_attic_pin`'s reflog read is guarded by `[[ -d "$workdir" ]]`, so a pin
  # taken after that call sees nothing and contributes only a pre-resolved tip.
  # Placing it above `_ws_unsupervise` rather than merely above 2053 puts it on
  # the near side of EVERY irreversible act, so the intent/done pair below
  # brackets a workspace whose commits are already referenced.
  #
  # UNCONDITIONAL: it runs even when `git branch -d` later refuses at ccd:2066,
  # because that is the case where the commits matter most, and even when
  # `registered != 0` so ccd:2053 never runs at all.
  #
  # `_ws_attic_pin` contains no `die`, which is what makes this `$( )` capture
  # safe under `ccd-die-containment.test.ts`. Nothing added here may die inside
  # a capture.
  local reg_branch; reg_branch=$(_reg_get "$id" branch)
  local tip="" atticsrc=none attic=0
  if [[ -d "$workdir" ]]; then
    tip=$(git -C "$workdir" rev-parse HEAD 2>/dev/null) && atticsrc=worktree || tip=""
    # THE ASYMMETRY, and it is a measurement rather than a fabricated zero:
    # a workspace still on disk whose tip cannot be resolved is exactly what
    # "refuses anything it might destroy" means. Directory already gone is the
    # other case and it is handled below — refusing there would wedge cleanup
    # on a workspace with nothing left to protect.
    [[ -n "$tip" ]] \
      || _lc_refuse destroy "$id" tip-unreadable \
           "could not resolve a tip for $workdir — nothing was touched; the workspace is still on disk and its commits would be unreferenced"
  elif [[ -n "$reg_branch" ]]; then
    tip=$(git -C "$main" rev-parse --verify "refs/heads/$reg_branch" 2>/dev/null) \
      && atticsrc=registry || tip=""
  fi
  if [[ -n "$tip" ]]; then
    attic=$(_ws_attic_pin "$main" "$id" "$workdir" "$tip")
    [[ "$attic" =~ ^[0-9]+$ ]] || attic=0
  fi
  # ─────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 5: Carry the pin onto the intent line.** In `ccd/ccd`, extend Task 20's
  `_lc_intent destroy` call (now immediately below the block above) to read:

```bash
  _lc_intent destroy "$id" "$lctx" verb ws-rm meas.project "$project" \
    meas.workspace "$ws" meas.branch "$branch" meas.workdir "$workdir" \
    meas.registered "$registered" meas.tip "$tip" meas.attic "$attic" \
    meas.atticsrc "$atticsrc"
```

- [ ] **Step 6: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-rm-attic.test.ts test/ccd-lifecycle-pairs.test.ts
```

Expected: 6 + 7 passed.

- [ ] **Step 7: Prove the ordering mutant.** Move the whole `── R4-1` block to sit immediately after
  line 2055's `fi` (below `git worktree remove`), re-run:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-rm-attic.test.ts
```

Expected while mutated: `THE MUTANT THAT MATTERS` fails with
`a pin taken after 'git worktree remove' sees no reflog and pins only the tip: expected 1 to be greater than 1`.
**Restore the block** and re-run to green.

- [ ] **Step 8: Run the verb's own suite and the die-containment scanner.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/ccd-ws-reap.test.ts test/ccd-die-containment.test.ts test/wsaudit.test.ts
```

Expected: all green. `ccd-workspaces.test.ts:970`
(`deletes no branch for a detached HEAD, and still clears the record`) and `:986` are the detached-HEAD
fixtures this feature exists for — they must still pass unchanged. `wsaudit.test.ts` green with **zero
edits**: `tip-unreadable` is `_lc_refuse`'s `$3`, an argument, never a format-string literal, so it
contributes nothing to that scan.

- [ ] **Step 9: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-ws-rm-attic.test.ts && git commit -m "ccd(w3): R4-1 — ws-rm pins the workspace into the attic before it destroys it" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 23: W3 · R4-2 — `ws-restore` supersedes rather than erases

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — `cmd_ws_restore`: one emit immediately before line **3082**'s `rm -f`, and the two
  spawn-failure exits at **3128** and **3130-3132**.
- Create `server/test/ccd-ws-restore-supersede.test.ts` and `server/test/ccd-restore-reap-lock.test.ts`.

**Interfaces:**
- Consumes: `_lc_done`, `_lc_fail` (Task 16), `_reg_get` (`ccd:442`).
- Produces: one `restore` line carrying `meas.archivedAt`, `meas.archivedReason`,
  `meas.manifestBytes`, `meas.workdir` and `meas.branch`, emitted **inside the flock region** (opened
  ccd:3073, closed ccd:3127) and **before** the `rm -f` at ccd:3082.
- Produces: `_lc_fail restore … spawn-failed` on the two exits where the undo landed and the session did
  not come back (L0's word for the token is exactly that). No `tx`: the `restore` line is not an intent.
- **No new registry field.** A 25th per-session field costs a `SessionRecord` field, a
  `reviveFleetSession` literal change and 24 extra agent round-trips per 2 s tick, for a fact the
  journal already carries and `_reg_purge` deletes anyway.
- *Disclosed residual:* the manifest is preserved only as a byte total.

**Steps:**

- [ ] **Step 1: Write the failing supersede test.** Create
  `server/test/ccd-ws-restore-supersede.test.ts`:

```ts
// server/test/ccd-ws-restore-supersede.test.ts
//
// Today archive -> restore is a clean forgery of history: ccd:3082 unlinks
// `.archived`, `.archivedreason` and `.archivemanifest` and nothing anywhere
// records that they existed. Four rows on the live box are stamped `merged:#N`
// while heartbeating right now, so the one field in the registry carrying a WHY
// is false on half the rows that have it.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-restore-sup-'); });
afterEach(() => { h.cleanup(); });

const STUB = `_spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  _ws_supervise() { :; }; _reg_claim() { :; }; tmux() { :; };`;

const archived = (id = 'demo-still-river'): string => {
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(wt, { recursive: true });
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace still-river
    _reg_set ${id} branch ws/still-river; _reg_set ${id} workdir ${wt}
    _reg_set ${id} archived 1787000000
    _reg_set ${id} archivedreason merged:#42
    _reg_set ${id} archivemanifest '{"id":"x","worktreeBytes":4096}'`);
  return id;
};

describe('ws-restore records what it is about to erase', () => {
  it('carries archivedAt, archivedReason and manifestBytes on the restore line', () => {
    // Mutant: delete the emit -> this fails with `expected undefined to be
    // 'merged:#42'`, and archive -> restore is a clean forgery again.
    const id = archived();
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const [e] = eventsOf(h.home, 'restore');
    expect(e, 'ws-restore wrote no line').toBeTruthy();
    const m = measOf(e!);
    expect(m['archivedReason']).toBe('merged:#42');
    expect(m['archivedAt']).toBe('1787000000');
    expect(Number(m['manifestBytes'])).toBeGreaterThan(0);
  });

  it('THE MUTANT: an emit moved below the rm -f reads three files that are gone', () => {
    // Mutant: move the `_lc_done restore` line below ccd:3082 -> this fails
    // with `expected undefined to be 'merged:#42'`.
    const id = archived();
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    expect(measOf(eventsOf(h.home, 'restore')[0]!)['archivedReason']).toBe('merged:#42');
    for (const f of ['archived', 'archivedreason', 'archivemanifest']) {
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.${f}`))).toBe(false);
    }
  });

  it('omits manifestBytes for a manifest that was never written — never 0', () => {
    const id = 'demo-bare';
    const wt = path.join(h.home, 'worktrees', 'demo', 'bare');
    fs.mkdirSync(wt, { recursive: true });
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} workdir ${wt}; _reg_set ${id} archived 1787000000`);
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const m = measOf(eventsOf(h.home, 'restore')[0]!);
    expect(m, 'a fabricated 0 argues that nothing was lost').not.toHaveProperty('manifestBytes');
    expect(m, 'an absent reason is a legitimate state, not an empty one')
      .not.toHaveProperty('archivedReason');
  });

  it('writes NO new registry field — the journal carries it, the registry does not', () => {
    const id = archived();
    const before = new Set(fs.readdirSync(path.join(h.home, '.cc-sessions')));
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const added = fs.readdirSync(path.join(h.home, '.cc-sessions'))
      .filter((f) => !before.has(f) && f.startsWith(`${id}.`));
    expect(added, 'a 25th per-session field costs 24 extra agent round-trips per 2s tick')
      .toEqual([]);
  });

  it('records spawn-failed when the undo landed and the session did not come back', () => {
    // Mutant: delete the `_lc_fail restore … spawn-failed` call -> this fails
    // with `expected [] to have a length of 1`, and the one state a restore can
    // leave behind — stamps gone, session down — is recorded nowhere.
    const id = archived();
    h.sh(`_spawn_start() { return 4; }; _spawn_settle() { :; }; _ws_supervise() { :; }
      _reg_claim() { :; }; tmux() { :; }
      cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const fails = eventsOf(h.home, 'restore').filter((e) => e['outcome'] === 'failed');
    expect(fails).toHaveLength(1);
    expect(fails[0]!['refusal']).toBe('spawn-failed');
  });
});
```

- [ ] **Step 2: Write the flock-region guard.** Create `server/test/ccd-restore-reap-lock.test.ts`:

```ts
// server/test/ccd-restore-reap-lock.test.ts
//
// The emit must be INSIDE the flock region (opened ccd:3073, closed ccd:3127),
// or a concurrent `ws-reap` can change `.archived` between the read and the
// unlink and the record describes a state that never existed at once.
//
// It must also never `return` non-zero from inside that region: ccd:3118-3123
// records that any new `return` between 3073 and 3127 leaks the reap lock in the
// SOURCING shell for ever. `_lc_done` returns 0 on every path, which is exactly
// what makes this site safe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');

describe('ws-restore\'s supersede emit lives inside the reap flock region', () => {
  const from = src.indexOf('cmd_ws_restore() {');
  const body = src.slice(from, src.indexOf('cmd_ws_attic() {'));

  it('found the function body, and it is substantial', () => {
    expect(from, 'cmd_ws_restore not found').toBeGreaterThan(-1);
    expect(body.length, 'the slice collapsed — every assertion below is vacuous')
      .toBeGreaterThan(5000);
  });

  it('emits AFTER the lock is taken and BEFORE the rm -f', () => {
    const lockAt = body.indexOf('flock -n "$lfd"');
    const emitAt = body.indexOf('_lc_done restore');
    const rmAt = body.indexOf('rm -f "$REG/$id.archived"');
    const closeAt = body.indexOf('exec {lfd}>&-', rmAt);
    expect(lockAt).toBeGreaterThan(-1);
    expect(rmAt, 'the erase moved — re-measure before trusting this').toBeGreaterThan(-1);
    expect(emitAt, '_lc_done restore not found in cmd_ws_restore').toBeGreaterThan(-1);
    expect(emitAt, 'the emit must be under the lock').toBeGreaterThan(lockAt);
    expect(emitAt, 'the emit must read the values BEFORE they are unlinked').toBeLessThan(rmAt);
    expect(closeAt, 'the region must still close after the erase').toBeGreaterThan(rmAt);
  });

  it('adds no `return` between the lock and its release', () => {
    // Mutant: give the emit a `|| return 1` -> this fails, and the reap lock is
    // held for ever in the shell that sourced ccd.
    const lockAt = body.indexOf('flock -n "$lfd"');
    const rmAt = body.indexOf('rm -f "$REG/$id.archived"');
    const window = body.slice(lockAt, rmAt);
    expect(window).not.toMatch(/_lc_done restore[\s\S]{0,400}\|\|\s*return/);
    expect(window, 'a refusal inside the region would exit through die, not the close')
      .not.toMatch(/_lc_fail/);
  });

  it('the spawn-failure emits are OUTSIDE the region — after the descriptor is closed', () => {
    const closeAt = body.indexOf('exec {lfd}>&-', body.indexOf('rm -f "$REG/$id.archived"'));
    const failAt = body.indexOf('_lc_fail restore');
    expect(failAt, '_lc_fail restore not found').toBeGreaterThan(-1);
    expect(failAt, 'a spawn-failure emit inside the region would sit on a return path')
      .toBeGreaterThan(closeAt);
  });
});
```

- [ ] **Step 3: Run both and see them fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-restore-supersede.test.ts test/ccd-restore-reap-lock.test.ts
```

Expected: `ccd-ws-restore-supersede` fails all five (`ws-restore wrote no line: expected undefined to be
truthy`); `ccd-restore-reap-lock` fails `emits AFTER the lock is taken` with
`_lc_done restore not found in cmd_ws_restore: expected -1 to be greater than -1`.

- [ ] **Step 4: Write the supersede emit.** In `ccd/ccd`, insert immediately before line **3082**
  (`  rm -f "$REG/$id.archived" …`):

```bash
  # ── R4-2 · SUPERSEDE, DO NOT ERASE ──────────────────────────────────────
  # INLINE AND INSIDE THE FLOCK REGION (opened ccd:3073, closed ccd:3127), so
  # the values recorded are the ones being erased: a concurrent `ws-reap` holds
  # the same `$REG/.reap-<id>.lock` and can change `.archived` underneath an
  # unserialised read.
  #
  # `_lc_done` returns 0 on every path, and that is not a nicety here:
  # ccd:3118-3123 records that any new non-zero `return` between the acquisition
  # and `exec {lfd}>&-` leaks this lock in the SOURCING shell for ever, and ccd
  # is sourced by itself and by its tests.
  #
  # NO NEW REGISTRY FIELD. A 25th per-session field costs a `SessionRecord`
  # field, a `reviveFleetSession` literal change and 24 extra agent round-trips
  # per 2 s tick, for a fact the journal already carries and `_reg_purge`
  # deletes anyway.
  #
  # DISCLOSED RESIDUAL: the manifest is preserved as a BYTE TOTAL only. Read
  # fresh with `stat` because nothing in ccd reads that field back (ccd:2926
  # says so verbatim), and left ABSENT rather than 0 when it cannot be measured
  # — a fabricated 0 would argue that nothing was lost.
  _lc_done restore "$id" "" verb ws-restore \
    meas.archivedAt     "$(_reg_get "$id" archived)" \
    meas.archivedReason "$(_reg_get "$id" archivedreason)" \
    meas.manifestBytes  "$(stat -c %s -- "$REG/$id.archivemanifest" 2>/dev/null)" \
    meas.workdir        "$workdir" \
    meas.branch         "$(_reg_get "$id" branch)"
  # ─────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 5: Record the two spawn failures.** In `ccd/ccd`, replace line **3128**
  (`  [[ "$rc" -eq 0 ]] || return "$rc"`) with:

```bash
  # THE UNDO LANDED AND THE SESSION DID NOT COME BACK — `_lc_fail`, never
  # `_lc_refuse`: the archive stamps are already gone at ccd:3082, so calling
  # this a refusal would say nothing was touched, which is false. AFTER
  # ccd:3127's close, so it sits on no path that still holds the descriptor.
  [[ "$rc" -eq 0 ]] || { _lc_fail restore "$id" "" spawn-failed \
      "the archive stamps were removed but $id did not come back up (spawn rc $rc)"
    return "$rc"; }
```

  and insert immediately before line **3131**
  (`    echo "ccd: ws-restore spawn failed for $id (spawn rc $rc) — see $REG/$id.spawn" >&2`):

```bash
    _lc_fail restore "$id" "" spawn-failed \
      "the archive stamps were removed but $id did not settle (spawn rc $rc)"
```

- [ ] **Step 6: Run and see them pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-restore-supersede.test.ts test/ccd-restore-reap-lock.test.ts
```

Expected: 5 + 4 passed.

- [ ] **Step 7: Prove both placement mutants.** First move the `_lc_done restore` call below the
  `rm -f`, re-run — `THE MUTANT: an emit moved below the rm -f` fails with
  `expected undefined to be 'merged:#42'` and `ccd-restore-reap-lock`'s ordering case fails with
  `the emit must read the values BEFORE they are unlinked`. Then move it above ccd:3070's
  `command -v flock` — `emits AFTER the lock is taken: the emit must be under the lock` fails.
  **Restore the correct position** and re-run to green.

- [ ] **Step 8: Run the restore verb's own suites, including the serialisation fixtures.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts test/ccd-ws-reap.test.ts
```

Expected: green. `ccd-archive.test.ts:1299` pins ws-restore's usage sentence and must be unchanged; the
existing flock-region cases in `ccd-ws-reap.test.ts` (`ws-restore declines while a reap holds the lock`,
`gives the reap lock back…`, `…when the SPAWN FAILS too`) must be unchanged too.

- [ ] **Step 9: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-ws-restore-supersede.test.ts server/test/ccd-restore-reap-lock.test.ts && git commit -m "ccd(w3): R4-2 — ws-restore supersedes rather than erases, inside the reap flock" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 24: W3 · R4-3 — refused destructions get a record, including the `flock` decline

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — five `die`s in `cmd_ws_rm` (**1955**, **1959**, **1960**, **1969-1971**, **2031**),
  the whole `cmd_forget` ladder (**9658**, **9661**, **9662**, **9664-9665**, **9668-9670**, **9680**,
  **9681**), and the two reap sites (the flock decline before **5927**'s `exec {lfd}>&-`, and the single
  JSON point before **6250**'s `printf`).
- Create `server/test/ccd-refusal-record.test.ts`.

**Interfaces:**
- Consumes: `_lc_refuse <act> <id> <token> <detail> [k v]...` (emits then dies) and
  `_lc_emit <act> refused <id> "" refusal <token> detail <msg>` (emits only) — Task 16.
- Produces: exactly one `outcome:"refused"` line per refused destruction, carrying the exact token at
  the TOP LEVEL as `refusal`.
- **`cmd_forget`'s WHOLE ladder is converted**, not only its two liveness rungs: `bad-args`,
  `bad-session-id`, `no-such-session`, `is-a-workspace`, `held`, `session-live`,
  `session-verdict-unknown`. Every one of those tokens is already in L0's `LC_REFUSAL_TOKENS` or in
  `wsaudit.ts`'s `SENTENCES`, so no tenth token is minted. Task 26's scanner is what would otherwise
  find them.
- **`ws-reap` gets exactly TWO emits — the `flock -n` decline and the single point where
  `REAP_VERDICT` becomes JSON — not 36 call sites.** Both return 0 rather than dying, so they call
  `_lc_emit` directly.
- **No `SENTENCES` entry is added.** `_lc_refuse` changes no stdout and no exit contract, so it produces
  no `verdict`/`refused` JSON — the boundary `wsaudit.test.ts`'s own docstring already draws for `die`
  failures. Journal-only tokens get their PWA word from L0's `LC_REFUSAL_WORD` (wave 1).

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-refusal-record.test.ts`:

```ts
// server/test/ccd-refusal-record.test.ts
//
// The measured hole D4 names: `$REG/.reap-<id>.lock` — 12 files on the live box,
// one with a lock and no tombstone, a reap attempted and refused, recorded
// nowhere. Of 18 sessions this box has destroyed and that are still discoverable
// at all, 11 are documented and 7 are not, and WHO and WHY are answerable for
// zero.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-refusal-'); });
afterEach(() => { h.cleanup(); });

const fails = (snippet: string): { code: number; stderr: string } => {
  try { h.sh(snippet); return { code: 0, stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

const STUB = `_ws_unsupervise() { echo unsup >> "$HOME/order"; }; _tmux() { echo t; }; tmux() { :; };`;

describe('ws-rm — five refusals, each exactly one line with the exact token', () => {
  const seed = (id: string, extra = ''): string => {
    h.makeRepo('demo');
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace still-river
      _reg_set ${id} workdir ${h.home}/gone; ${extra}`);
    return id;
  };

  it.each([
    ['no-such-session', (): string => { h.makeRepo('demo'); return 'ghost'; }, 'no such session'],
    ['not-a-workspace', (): string => { h.makeRepo('demo'); h.sh('_reg_set plain uuid u'); return 'plain'; },
      'not a workspace'],
    ['incomplete-registry', (): string => {
      h.makeRepo('demo'); h.sh('_reg_set part uuid u; _reg_set part workspace w'); return 'part';
    }, 'incomplete registry'],
    ['held', (): string => seed('demo-held', `_reg_set demo-held hold 'program:x'`), 'held:'],
  ])('records %s and destroys nothing', (token, setup, sentence) => {
    const id = setup();
    const r = fails(`${STUB} cmd_ws_rm ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(sentence);
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token }]);
    expect(fs.existsSync(path.join(h.home, 'order')), 'a refusal must not reach _ws_unsupervise')
      .toBe(false);
  });

  it('records dirty-tree, and the record is the ONLY thing that changed', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '--allow-empty', '-m', 'base');
    const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
    fs.writeFileSync(path.join(wt, 'f.txt'), 'uncommitted');
    h.git(wt, 'add', 'f.txt');
    h.sh(`_reg_set demo-still-river uuid u; _reg_set demo-still-river project demo
      _reg_set demo-still-river workspace still-river
      _reg_set demo-still-river workdir ${wt}`);

    const r = fails(`${STUB} cmd_ws_rm demo-still-river`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('nothing was touched');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'dirty-tree' }]);
    expect(fs.existsSync(wt), 'the worktree survives a refusal').toBe(true);
    expect(h.reg('demo-still-river', 'uuid')).not.toBeNull();
  });
});

describe('forget — the whole ladder, not only the liveness rungs', () => {
  it.each([
    ['bad-args', 'cmd_forget s extra', 'usage: ccd forget'],
    ['bad-session-id', 'cmd_forget "bad/id"', 'bad session id'],
    ['no-such-session', 'cmd_forget ghost', 'no such session'],
  ])('records %s', (token, call, sentence) => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo gone; }; ${call}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(sentence);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token }]);
  });

  it('records is-a-workspace and does not purge', () => {
    h.sh('_reg_set w uuid u; _reg_set w workspace still-river');
    const r = fails(`${STUB} _session_verdict() { echo gone; }; cmd_forget w`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'is-a-workspace' }]);
    expect(h.reg('w', 'uuid')).not.toBeNull();
  });

  it('records held', () => {
    h.sh(`_reg_set s uuid u; _reg_set s hold 'program:x'`);
    const r = fails(`${STUB} _session_verdict() { echo gone; }; cmd_forget s`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'held' }]);
  });

  it('records session-live and does not purge', () => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo live; }; cmd_forget s`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'session-live' }]);
    expect(h.reg('s', 'uuid')).not.toBeNull();
  });

  it('records session-verdict-unknown — the fail-shut rung, which had no record at all', () => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo unknown; }; cmd_forget s`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'session-verdict-unknown' }]);
  });
});

describe('ws-reap — exactly TWO emits, not thirty-six', () => {
  it('records the flock decline, which is the measured hole this closes', () => {
    // 12 `.reap-<id>.lock` files on the live box; one held a lock and left no
    // tombstone. A reap was attempted and refused and NOTHING recorded it.
    // Mutant: delete this emit -> back to a lock file and silence.
    const out = h.sh(`_reg_set s uuid u; _reg_set s archived 1
      _json_str() { printf '"%s"' "$1"; }
      _ws_reap_eval() { return 0; }
      flock() { return 1; }
      cmd_ws_reap --expect ${'a'.repeat(64)} --session s 2>/dev/null || true`);
    expect(out).toContain('"refused":"in-progress"');
    expect(refusalsOf(h.home)).toEqual([{ act: 'reap', token: 'in-progress' }]);
  });

  it('records the verdict at the ONE point where REAP_VERDICT becomes JSON', () => {
    // `_ws_reap_locked` takes TOKEN FIRST (ccd:5943-5944: `local token="$1" id="$2"`).
    const out = h.sh(`_reg_set s uuid u
      _json_str() { printf '"%s"' "$1"; }
      _ws_reap_eval() { REAP_VERDICT=dirty-tree; REAP_DETAIL="uncommitted changes"; return 1; }
      _reap_paths_json() { echo '[]'; }
      _ws_reap_locked ${'a'.repeat(64)} s 2>/dev/null || true`);
    expect(out).toContain('"refused":');
    const r = refusalsOf(h.home);
    expect(r, 'one emit covers all 35 _reap_refuse tokens').toHaveLength(1);
    expect(r[0]).toEqual({ act: 'reap', token: 'dirty-tree' });
  });

  it('both reap emits return 0 and change no stdout — they are not _lc_refuse', () => {
    // `_lc_refuse` dies. These two answer JSON on stdout at exit 0 and must keep
    // doing exactly that: the PWA reads tokens, not stderr.
    const r = fails(`_reg_set s uuid u; _reg_set s archived 1
      _json_str() { printf '"%s"' "$1"; }
      _ws_reap_eval() { return 0; }
      flock() { return 1; }
      cmd_ws_reap --expect ${'a'.repeat(64)} --session s`);
    expect(r.code, 'a reap refusal is an ANSWER, not a death').toBe(0);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-record.test.ts
```

Expected: 14 vitest cases (two `it.each` expand to four and three), every one failing with
`expected [] to deeply equal [ { act: 'destroy', token: 'no-such-session' } ]` or its sibling; the two
reap cases fail the same way while their stdout assertions already pass.

- [ ] **Step 3: Convert `cmd_ws_rm`'s four pre-teardown `die`s.** In `ccd/ccd`, replace line **1955**
  with:

```bash
  [[ -f "$REG/$id.uuid" ]] || _lc_refuse destroy "$id" no-such-session "no such session: $id"
```

  lines **1959-1960** with:

```bash
  [[ -n "$ws" ]] || _lc_refuse destroy "$id" not-a-workspace \
    "$id is not a workspace — refusing to remove a main checkout"
  [[ -n "$project" && -n "$workdir" ]] || _lc_refuse destroy "$id" incomplete-registry \
    "incomplete registry for '$id'"
```

  and lines **1969-1971** with:

```bash
  if [[ -e "$REG/$id.hold" ]]; then
    _lc_refuse destroy "$id" held \
      "held: $(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>') — release first: ccd ws-release --session $id"
  fi
```

- [ ] **Step 4: Convert `cmd_ws_rm`'s dirty-tree rung.** In `ccd/ccd`, replace line **2031** with:

```bash
    [[ -z "$dirty" ]] || _lc_refuse destroy "$id" dirty-tree \
      "worktree not removed (uncommitted changes?) — nothing was touched: $workdir"
```

  **Do not convert the other four rungs in the `[[ -d "$workdir" ]]` block yet** — `foreign-worktree`
  (1996-1997), `scratch-unwritable` (2026), `tree-unreadable` (2029-2030 and 2033-2034) and
  `nested-checkouts-present` (2035-2036). Task 26's scanner is what forces them, and doing them here
  without the scanner leaves no mechanism proving the set is complete.

- [ ] **Step 5: Convert `cmd_forget`'s whole ladder.** In `ccd/ccd`, replace line **9658** with:

```bash
  [[ $# -eq 1 ]] || _lc_refuse forget "$id" bad-args "usage: ccd forget <id>"
```

  lines **9661-9662** with:

```bash
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || _lc_refuse forget "$id" bad-session-id "bad session id"
  [[ -f "$REG/$id.uuid" ]] || _lc_refuse forget "$id" no-such-session "no such session: $id"
```

  lines **9664-9665** with:

```bash
  [[ -z "$ws" ]] \
    || _lc_refuse forget "$id" is-a-workspace \
         "$id is a workspace — its removal is audited and confirmed: use the workspace sheet (ws-audit/ws-reap), or ccd ws-rm"
```

  lines **9668-9670** with:

```bash
  if [[ -e "$REG/$id.hold" ]]; then
    _lc_refuse forget "$id" held \
      "held: $(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>') — release first: ccd ws-release --session $id"
  fi
```

  and lines **9680-9681** with:

```bash
    live)    _lc_refuse forget "$id" session-live "$id is still running — stop it first: ccd stop $id" ;;
    unknown) _lc_refuse forget "$id" session-verdict-unknown "$id: cannot tell whether it is still running — the tmux server did not answer. Nothing was removed. Check with: tmux ls" ;;
```

- [ ] **Step 6: Add the reap flock decline.** In `ccd/ccd`, inside the `flock -n "$lfd" || { … }` block,
  insert immediately before line **5927**'s `exec {lfd}>&-`:

```bash
    # THE MEASURED HOLE, CLOSED. Twelve `$REG/.reap-<id>.lock` files exist on
    # the live box and one holds a lock with no tombstone beside it: a reap was
    # attempted, refused, and recorded nowhere at all.
    #
    # `_lc_emit` directly, NOT `_lc_refuse`: this path answers JSON on stdout at
    # exit 0 and must keep doing exactly that (the PWA reads tokens, not
    # stderr), whereas `_lc_refuse` dies. The token is an ARGUMENT, so it
    # contributes nothing to `wsaudit.test.ts`'s scan; the literal one line
    # below still does, which is why that test stays green with no edit.
    _lc_emit reap refused "$id" "" verb ws-reap refusal in-progress \
      detail "another ccd process is already reaping $id and still holds the lock"
```

- [ ] **Step 7: Add the single reap verdict emit.** In `ccd/ccd`, inside `_ws_reap_locked`'s
  `if ! _ws_reap_eval "$id"; then` block, insert immediately before line **6250**'s `printf`:

```bash
    # ONE EMIT FOR ALL 35 `_reap_refuse` TOKENS, at the single point where
    # `REAP_VERDICT` becomes JSON. `_ws_reap_eval` never prints — it sets
    # globals through `_reap_refuse` (ccd:4272) — so this is the only place the
    # verdict exists as a value, and journaling the 35 call sites individually
    # would be 35 chances to miss one.
    _lc_emit reap refused "$id" "" verb ws-reap refusal "$REAP_VERDICT" detail "$REAP_DETAIL"
```

- [ ] **Step 8: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-record.test.ts
```

Expected: 14 passed.

- [ ] **Step 9: Prove the mutant.** Revert any one `_lc_refuse` to a bare `die` — say `cmd_ws_rm`'s
  `held` rung — and re-run:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-record.test.ts
```

Expected while mutated: `records held and destroys nothing` fails with
`expected [] to deeply equal [ { act: 'destroy', token: 'held' } ]` — the death still happens, the
record does not. Restore and re-run to green.

- [ ] **Step 10: Prove `wsaudit.test.ts` is untouched, in both directions.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts
```

Expected: both green, and the whole-file token count still exactly 54. `_lc_refuse`'s tokens are
arguments, and `in-progress`/`dirty-tree`/`no-such-session` were all already in the set from the
literals that remain beside them.

- [ ] **Step 11: Run the verbs' suites and the die-containment scanner** — `_lc_refuse` has just
  entered its can-die set:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts test/ccd-workspaces.test.ts test/ccd-forget.test.ts test/ccd-hold.test.ts test/ccd-ws-reap.test.ts
```

Expected: all green. `ccd-die-containment.test.ts` derives the can-die set by call-graph reachability on
every run, so it now knows `_lc_refuse` — if it reds with
`never wraps a fatal thing in a command substitution`, a `$(_lc_refuse …)` slipped in and that is a real
finding.

- [ ] **Step 12: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-refusal-record.test.ts && git commit -m "ccd(w3): R4-3 — refused destructions get a record, incl. the reap flock decline" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 25: W3 · `--reason` on `ws-rm` and `forget` — a validated flag, refused rather than truncated

**AGENT-FIRST, ships DARK.**

**Files:**
- Modify `ccd/ccd` — a flag-stripping loop at the head of `cmd_ws_rm` (line **1954**) and of
  `cmd_forget` (lines **9657-9658**, already `_lc_refuse` after Task 24); and the `dec.reason` tail on
  each verb's own lines.
- Modify `server/test/ccd-forget.test.ts` line **133**.
- Create `server/test/ccd-reason-flag.test.ts`.

**Interfaces:**
- Consumes: `_lc_dec_ok`, `_lc_intent`, `_lc_done`, `_lc_refuse` (Tasks 16, 20, 22, 24).
- Produces: `ccd ws-rm [--reason <text>] <id>` and `ccd forget [--reason <text>] <id>`. The value lands
  as `dec.reason` on that verb's own lines and **nowhere else** — display-only, parsed nowhere.
- **THE POLICY IS REFUSE, NEVER TRUNCATE**, and the cap is `_LC_DEC_MAX` **BYTES** (512, L0's
  `LC_REASON_MAX_BYTES`). A 900-byte reason silently recorded as 512 reads as the operator's own words
  on the one artefact that outlives the workspace; and a character cap let a 200-emoji reason pass
  `ws-rm` at 800 bytes while `ws-release` refused it.
- `CCD_ARGV` threading is **wave 6**, not this task. ccd grows the flag; nothing on the server builds it
  yet.

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `server/test/ccd-reason-flag.test.ts`:

```ts
// server/test/ccd-reason-flag.test.ts
//
// ccd:8780-8791 is the paid lesson and it is quoted in full there: a second
// POSITIONAL on `ensure` was threaded down to `(( … >= bound ))`, where bash
// evaluates a variable's CONTENTS as arithmetic and a command substitution
// inside an array subscript EXECUTES — i.e. any extra argv word a
// prefix-whitelisted verb accepts is a candidate for arbitrary code as the fleet
// user. So `--reason` is a validated FLAG, stripped before the arity rule, and
// its value reaches no arithmetic context anywhere.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, decOf, refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-reason-'); });
afterEach(() => { h.cleanup(); });

const reasonOf = (act: string): string | undefined => decOf(eventsOf(h.home, act)[0] ?? {})['reason'];

const fails = (snippet: string): { code: number; stderr: string } => {
  try { h.sh(snippet); return { code: 0, stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

const STUB = `_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };`;

describe('--reason on ws-rm', () => {
  const seed = (): void => {
    h.makeRepo('demo');
    h.sh(`_reg_set demo-x uuid u; _reg_set demo-x project demo; _reg_set demo-x workspace x
      _reg_set demo-x workdir ${h.home}/gone`);
  };

  it('carries the reason onto the destroy lines', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason 'merged in #42' demo-x 2>/dev/null || true`);
    expect(reasonOf('destroy')).toBe('merged in #42');
  });

  it('accepts --reason=<text> too', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason='wave 3 done' demo-x 2>/dev/null || true`);
    expect(reasonOf('destroy')).toBe('wave 3 done');
  });

  it('STRIPS THE FLAG BEFORE THE ID IS BOUND — the id is never `--reason`', () => {
    // Mutant: strip after `local id="${1:?…}"` -> `$id` becomes the flag word,
    // `_reg_get` answers nothing, and the verb aims at a session that does not
    // exist while the real one keeps running. Same defect cmd_stop's own header
    // (ccd:9592-9596) records for --surface.
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason r demo-x 2>/dev/null || true`);
    expect(eventsOf(h.home, 'destroy')[0]?.['id']).toBe('demo-x');
  });

  it('does not loop for ever on a flag with no value', () => {
    // Under `set -uo pipefail` with NO `-e`, a `shift 2` past the end of argv
    // fails, shifts nothing, and the loop never terminates. The explicit
    // `[[ $# -ge 2 ]]` is what stops that; ccd:9610-9612 states it.
    const r = fails(`${STUB} cmd_ws_rm --reason`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-rm');
  });

  it('REFUSES extra positionals with a RECORD — the flag widening did not open the arity', () => {
    // ws-rm had NO arity guard at all before this task: `ccd ws-rm x y z`
    // silently ignored `y z`.
    seed();
    const r = fails(`${STUB} cmd_ws_rm demo-x extra`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-rm');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'bad-args' }]);
  });

  it('never lets the reason reach an arithmetic context', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason 'a[$(touch $HOME/PWNED)]' demo-x 2>/dev/null || true`);
    expect(fs.existsSync(path.join(h.home, 'PWNED')),
      'a --reason must be display-only, parsed nowhere').toBe(false);
    expect(reasonOf('destroy')).toBe('a[$(touch $HOME/PWNED)]');
  });

  it('REFUSES an over-cap reason rather than truncating it', () => {
    // Mutant: `reason="${reason:0:512}"` instead of `_lc_dec_ok || _lc_refuse`
    // -> this fails with `expected 0 not to be 0`, and a 900-byte note is
    // recorded as 512 bytes of the operator's own words with nothing saying so.
    seed();
    const r = fails(`${STUB} cmd_ws_rm --reason "$(printf 'z%.0s' {1..900})" demo-x`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('longer than 512 bytes');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'bad-args' }]);
  });

  it('measures the cap in BYTES — 200 emoji are 800 bytes and are refused', () => {
    seed();
    const r = fails(`${STUB} cmd_ws_rm --reason "$(printf '\\U0001F600%.0s' {1..200})" demo-x`);
    expect(r.code, 'a character cap would have let this through at 200').not.toBe(0);
  });

  it('accepts exactly 512 bytes', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason "$(printf 'z%.0s' {1..512})" demo-x 2>/dev/null || true`);
    expect(reasonOf('destroy')!.length).toBe(512);
  });
});

describe('--reason on forget', () => {
  it('carries the reason and keeps the exact-arity guard on the residue', () => {
    h.sh('_reg_set s uuid u');
    h.sh(`${STUB} _session_verdict() { echo gone; }; cmd_forget --reason 'stale row' s`);
    expect(reasonOf('forget')).toBe('stale row');
  });

  it('still refuses an extra positional, with a record', () => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo gone; }; cmd_forget s extra`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd forget');
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'bad-args' }]);
  });
});
```

- [ ] **Step 2: Run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-reason-flag.test.ts
```

Expected: all 11 fail. The first with `expected undefined to be 'merged in #42'` — `--reason` is
currently taken as a positional and `ws-rm` has no arity guard at all, so `merged in #42` is silently
ignored and the id becomes `--reason`.

- [ ] **Step 3: Add the loop to `cmd_ws_rm`.** In `ccd/ccd`, replace line **1954**
  (`  local id="${1:?usage: ccd ws-rm <id>}"`) with:

```bash
  # FLAGS ARE STRIPPED BEFORE THE ARITY RULE, and that order is the correctness
  # argument — `cmd_stop`'s own header (ccd:9592-9596) records what the other
  # order costs: with the flag left in argv the verb aims at a session that does
  # not exist while the real one keeps running.
  #
  # A VALIDATED FLAG, NEVER A POSITIONAL. ccd:8780-8791 is the paid lesson: an
  # extra argv word on a prefix-whitelisted verb reached a bash arithmetic
  # context where a command substitution EXECUTES. This value reaches no `(( ))`,
  # no `$(( ))`, no `[[ x -ge y ]]` and no array subscript — it is written
  # verbatim into one journal field and parsed nowhere, `cmd_ws_hold`'s own
  # contract (ccd:2515-2516) applied here.
  #
  # AND IT CLOSES A HOLE ON THE WAY PAST: this verb had NO arity guard at all,
  # so `ccd ws-rm x y z` silently ignored `y z`. The residue is checked below.
  local reason="" args=()
  while (( $# )); do
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates (ccd:9610-9612).
      #
      # A BARE `die` HERE, DELIBERATELY, and `ccd-refusal-scan.test.ts` names
      # this line in its SANCTIONED set: no `$id` exists yet, and a refusal
      # record whose subject is empty says less than the usage line does.
      --reason)   [[ $# -ge 2 ]] || die "usage: ccd ws-rm [--reason <text>] <id>"
                  reason="$2"; shift 2 ;;
      --reason=*) reason="${1#--reason=}"; shift ;;
      *)          args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"    # bash >= 4.4 (the fleet host runs 5.2): an empty array
                         # here is not an unbound-variable error under `set -u`.
  local id="${1:?usage: ccd ws-rm [--reason <text>] <id>}"
  [[ $# -eq 1 ]] || _lc_refuse destroy "$id" bad-args \
    "usage: ccd ws-rm [--reason <text>] <id>" dec.reason "$reason"
  # REFUSED, NOT TRUNCATED, and measured in BYTES. A 900-byte note silently cut
  # to 512 reads as the operator's own words on the one record that outlives the
  # workspace; `_lc_dec_ok` counts bytes under `LC_ALL=C` so a 200-emoji reason
  # cannot pass here and be refused by the next surface. The refusal itself
  # carries NO `dec.reason` — the value is the thing that did not fit.
  _lc_dec_ok "$reason" || _lc_refuse destroy "$id" bad-args \
    "--reason is longer than $_LC_DEC_MAX bytes — nothing was touched"
```

- [ ] **Step 4: Thread it onto ws-rm's own lines.** In `ccd/ccd`, add a trailing `dec.reason "$reason"`
  to `cmd_ws_rm`'s `_lc_intent destroy` call (Tasks 20, 22), its `_lc_done destroy` call (Task 20) and
  every `_lc_refuse destroy` call added in Tasks 22 and 24 — `tip-unreadable`, `no-such-session`,
  `not-a-workspace`, `incomplete-registry`, `held`, `dirty-tree`. The intent line becomes:

```bash
  _lc_intent destroy "$id" "$lctx" verb ws-rm dec.reason "$reason" \
    meas.project "$project" meas.workspace "$ws" meas.branch "$branch" \
    meas.workdir "$workdir" meas.registered "$registered" meas.tip "$tip" \
    meas.attic "$attic" meas.atticsrc "$atticsrc"
```

  and the done line:

```bash
  _lc_done destroy "$id" "$lctx" verb ws-rm dec.reason "$reason" \
    meas.branch "$branch" branchDeleted "$bd"
```

  The refusals take the pair AFTER the detail sentence, because `_lc_refuse` is
  `<act> <id> <token> <detail> [k v]...` — e.g.:

```bash
  [[ -f "$REG/$id.uuid" ]] || _lc_refuse destroy "$id" no-such-session \
    "no such session: $id" dec.reason "$reason"
```

- [ ] **Step 5: Add the loop to `cmd_forget`.** In `ccd/ccd`, replace lines **9657-9658** with:

```bash
  # Same order, same argument, same cap as `cmd_ws_rm` above. The exact-arity
  # guard is RE-ASSERTED on the residue rather than removed: this verb is
  # granted to the agent as the bare `['forget']` prefix (agent/src/whitelist.ts),
  # where "tokens after the prefix are unconstrained", so the arity rule is the
  # only thing bounding what a caller can put here.
  local reason="" args=()
  while (( $# )); do
    case "$1" in
      # SANCTIONED bare `die` — no `$id` is bound yet. See cmd_ws_rm's copy.
      --reason)   [[ $# -ge 2 ]] || die "usage: ccd forget [--reason <text>] <id>"
                  reason="$2"; shift 2 ;;
      --reason=*) reason="${1#--reason=}"; shift ;;
      *)          args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"
  local id="${1:?usage: ccd forget [--reason <text>] <id>}"
  [[ $# -eq 1 ]] || _lc_refuse forget "$id" bad-args \
    "usage: ccd forget [--reason <text>] <id>" dec.reason "$reason"
  _lc_dec_ok "$reason" || _lc_refuse forget "$id" bad-args \
    "--reason is longer than $_LC_DEC_MAX bytes — nothing was removed"
```

- [ ] **Step 6: Thread it onto forget's lines.** In `ccd/ccd`, add a trailing `dec.reason "$reason"` to
  `cmd_forget`'s `_lc_intent forget` and `_lc_done forget` calls (Task 20) and to all six
  `_lc_refuse forget` calls from Task 24 — `bad-session-id`, `no-such-session`, `is-a-workspace`,
  `held`, `session-live`, `session-verdict-unknown` — each **after** the detail sentence.

- [ ] **Step 7: Run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-reason-flag.test.ts test/ccd-refusal-record.test.ts test/ccd-ws-rm-attic.test.ts test/ccd-lifecycle-pairs.test.ts
```

Expected: 11 + 14 + 6 + 7 passed.

- [ ] **Step 8: Run the arithmetic scanner and both verbs' suites, and repair one usage assertion.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-arith-containment.test.ts test/ccd-forget.test.ts test/ccd-workspaces.test.ts
```

Expected: `ccd-arith-containment` and `ccd-workspaces` green. **`ccd-forget.test.ts:133` will be RED**,
asserting `expect(r.stderr).toContain('usage: ccd forget <id>')`. That is a correct red: change that one
line to `expect(r.stderr).toContain('usage: ccd forget');` — the shortest prefix that survives the flag
widening — and re-run to green. Do not weaken any other assertion in that file.

- [ ] **Step 9: Confirm the whitelist is untouched.** This task adds a flag, not a grant; `CCD_ARGV`
  threading is wave 6.

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-brand.test.ts
```

Expected: both green **with zero edits**. `ccdargv.ts`'s `forget: (id) => argv(['forget', id])` is
unchanged, so nothing on the server builds `--reason` yet — the flag ships dark on the fleet host and
the server learns to use it in wave 6.

- [ ] **Step 10: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-reason-flag.test.ts server/test/ccd-forget.test.ts && git commit -m "ccd(w3): --reason on ws-rm and forget — a validated flag, refused over 512 bytes" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 26: W3 · The refusal scanner that binds the next editor, and the wave-3 agent deploy

**AGENT-FIRST. This task ships wave 3 to the fleet host (BOX 2).**

**Files:**
- Create `server/test/ccd-refusal-scan.test.ts`.
- Modify `ccd/ccd` — the four remaining `cmd_ws_rm` rungs (**1996-1997**, **2026**, **2029-2030**,
  **2033-2036**), the whole `cmd_ws_restore` ladder (**3034-3037**, **3070-3071**, **3073**, **3076**,
  **3079**, **3081**), and `cmd_ws_reap`'s two post-probe dies (**5911**, **5913**).

**Interfaces:**
- Consumes: `_lc_refuse`/`_lc_fail` (Task 16), `SENTENCES` (`server/src/wsaudit.ts:17`),
  `LC_REFUSAL_TOKENS` (`shared/api.ts`, wave 1).
- Produces: the standing rule as a mechanism — **every `die "` inside `cmd_ws_rm`, `cmd_forget`,
  `cmd_ws_restore` and `cmd_ws_reap` is reached through `_lc_refuse`, or stands beside an `_lc_fail`,
  or is in a named `SANCTIONED` set of six** — with a coverage floor per body (precedent:
  `ccd:2123-2125`, and `ccd-swap-refuse.test.ts:435-446` is the slicing idiom).
- Produces: the cross-language assertion wave 1 promised as prose — every refusal token literal ccd
  passes to `_lc_refuse`/`_lc_fail` is a member of `LC_REFUSAL_TOKENS ∪ Object.keys(SENTENCES)`.
- **Measured fact this task records rather than acts on:** `_ws_reap_locked` (ccd:5943-6265) and
  `_ws_reap_tail` (ccd:6266-6792) contain **zero** `die "` between them. The reap lane's two emits
  (Task 24) plus the pair in Task 20 are its whole coverage, per D15 — and the scanner pins the zero so
  a `die` added there is caught.

**Steps:**

- [ ] **Step 1: Write the scanner.** Create `server/test/ccd-refusal-scan.test.ts`:

```ts
// server/test/ccd-refusal-scan.test.ts
//
// The mutant this exists for is not a deletion, it is an ADDITION: the next
// editor adding a fresh unrecorded `die` to a destructive verb. Task 24's
// record-tests pin the refusals that exist today; this pins the SHAPE of every
// refusal that will ever exist in these four functions.
//
// A SCANNER OVER SLICED BODIES, WITH A COVERAGE FLOOR, because a scan over an
// empty slice passes everything — `wsaudit.test.ts:65-71` and
// `ccd-swap-refuse.test.ts:435-446` both state that rule and this copies it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LC_REFUSAL_TOKENS } from '../../shared/api.js';
import { SENTENCES } from '../src/wsaudit.js';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');

/** The body of `name`, from its opening line to `until`'s. */
const bodyOf = (name: string, until: string): string => {
  const from = src.indexOf(`${name}() {`);
  const to = src.indexOf(`${until}() {`, from);
  return from > -1 && to > from ? src.slice(from, to) : '';
};

const lineAt = (s: string, i: number): string => {
  const a = s.lastIndexOf('\n', i) + 1;
  const b = s.indexOf('\n', i);
  return s.slice(a, b === -1 ? undefined : b).trim();
};

/** D4's four destructive verbs. Floors are measured minima, not guesses. */
const VERBS: readonly (readonly [string, string, number])[] = [
  ['cmd_ws_rm', 'cmd_ws_rename', 8000],
  ['cmd_forget', 'cmd_ls', 2000],
  ['cmd_ws_restore', 'cmd_ws_attic', 5000],
  ['cmd_ws_reap', '_ws_reap_locked', 7000],
];

/**
 * THE SIX DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.
 * Four are `cmd_ws_reap`'s pre-lock rungs, which D15 leaves alone: three run
 * before `$id` has been validated at all and the fourth is the `_json_str`
 * probe — the emitter itself is what is missing there, so an emit would be the
 * thing being reported. Two are the `--reason` loop arms, which run before any
 * id is bound. The set is EXACT: a seventh sanctioned die reds the count.
 */
const SANCTIONED: readonly string[] = [
  'die "usage: ccd ws-rm [--reason <text>] <id>"',
  'die "usage: ccd forget [--reason <text>] <id>"',
  'die "usage: ccd ws-reap --expect <token> --session <id>"',
  'die "bad token"',
  'die "bad session id"',
  'die "python3 unavailable — cannot quote the reap record safely"',
];

describe('every die in a destructive verb is reached through _lc_refuse or _lc_fail', () => {
  it('found all four bodies, and each is substantial — the coverage floor', () => {
    // Without this, a rename or a refactor that moved one behind an indirection
    // would make every assertion below vacuously true over an empty string, and
    // the suite would stay green while the guard was gone.
    for (const [name, until, floor] of VERBS) {
      expect(bodyOf(name, until).length, `${name}'s body could not be sliced (looked for ${until})`)
        .toBeGreaterThan(floor);
    }
  });

  it('leaves no bare `die "` behind — every one is recorded or sanctioned', () => {
    // Mutant: add `die "nope"` to cmd_ws_rm -> this fails naming the line, and
    // a destruction is refused with nothing in the record to say so.
    const offenders: string[] = [];
    for (const [name, until] of VERBS) {
      const body = bodyOf(name, until);
      for (const m of body.matchAll(/(^|\s|\|\|\s*|;\s*|\{\s*)die "/g)) {
        const line = lineAt(body, m.index!);
        if (SANCTIONED.some((s) => line.includes(s))) continue;
        // The one recorded shape: a `die` inside the same `{ … }` block as an
        // `_lc_fail`, which is how a POST-teardown failure is written — the
        // record first, the death second, both explicit. 400 characters back is
        // enough for `_lc_fail`'s own continuation lines and no more.
        if (/_lc_fail /.test(body.slice(Math.max(0, m.index! - 400), m.index!))) continue;
        offenders.push(`${name}: ${line}`);
      }
    }
    expect(offenders,
      'a destructive verb refuses or fails without a record — route it through '
      + '_lc_refuse (before anything irreversible) or _lc_fail (after)').toEqual([]);
  });

  it('every sanctioned die is STILL THERE — a stale exemption is a hole', () => {
    // Mutant: convert `die "bad token"` and leave it in SANCTIONED -> this fails
    // with `a sanctioned die that no longer exists: [ 'die "bad token"' ]`.
    expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(6);
    const all = VERBS.map(([n, u]) => bodyOf(n, u)).join('\n');
    expect(SANCTIONED.filter((s) => !all.includes(s)), 'a sanctioned die that no longer exists')
      .toEqual([]);
  });

  it('never puts an _lc_refuse inside `die` itself', () => {
    // That would fabricate a "refused destruction" for every usage error on
    // every verb in the file — the exact over-reach D15 forbids by name.
    const dieFn = src.slice(src.indexOf('die() {'), src.indexOf('die() {') + 200);
    expect(dieFn).not.toMatch(/_lc_/);
  });

  it('holds the reap emits at exactly two — one verdict point, one flock decline', () => {
    const reapRegion = src.slice(src.indexOf('cmd_ws_reap() {'), src.indexOf('# ── reclamation'));
    expect(reapRegion.length, 'the reap region could not be sliced').toBeGreaterThan(20000);
    expect([...reapRegion.matchAll(/_lc_emit reap refused/g)],
      'D15 authorises exactly two reap refusal emits; more is scope creep').toHaveLength(2);
  });

  it('the reap lock\'s two inner functions still contain NO die at all', () => {
    // MEASURED, not assumed: `_ws_reap_locked` and `_ws_reap_tail` answer in
    // JSON on stdout at exit 0 and never die, which is why the reap lane needs
    // no conversion. Pinning the zero is what catches a `die` added there later.
    for (const [name, until] of [['_ws_reap_locked', '_ws_reap_tail'],
                                 ['_ws_reap_tail', '_ws_gc_bytes']] as const) {
      const body = bodyOf(name, until);
      expect(body.length, `${name} could not be sliced`).toBeGreaterThan(15000);
      expect([...body.matchAll(/(^|\s|\|\|\s*|;\s*)die "/g)].map((m) => lineAt(body, m.index!)),
        `${name} grew a die — route it through _lc_fail, it is past the teardown`).toEqual([]);
    }
  });
});

describe('every refusal token ccd passes is a token L0 or wsaudit already owns', () => {
  it('holds the vocabularies set-equal in the direction wave 1 could not assert', () => {
    // Wave 1 ships `LC_REFUSAL_WORD` and a disjointness guard but no reverse
    // assertion, because it would be red until wave 3 lands. This is that
    // assertion. Mutant: pass `_lc_refuse destroy "$id" tip-unreadible …` ->
    // this fails with `tokens no vocabulary owns: [ 'tip-unreadible' ]`, and a
    // typo would reach the PWA as an untranslated token.
    const known = new Set<string>([...LC_REFUSAL_TOKENS, ...Object.keys(SENTENCES)]);
    const found = new Set<string>();
    for (const m of src.matchAll(/_lc_refuse\s+[a-z-]+\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_lc_fail\s+[a-z-]+\s+"[^"]*"\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_lc_emit\s+[a-z-]+\s+refused\s+"[^"]*"\s+""\s+verb\s+[a-z-]+\s+refusal\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    expect(found.size, 'the scan found almost no tokens — it is vacuous').toBeGreaterThanOrEqual(14);
    expect([...found].filter((t) => !known.has(t)).sort(), 'tokens no vocabulary owns').toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and read the failure — it is a worklist, not a bug.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts
```

Expected: `leaves no bare die " behind` fails listing the four `cmd_ws_rm` rungs Task 24 deliberately
left, the eight in `cmd_ws_restore`, and `cmd_ws_reap`'s two post-probe lock dies. The other five cases
pass.

- [ ] **Step 3: Convert `cmd_ws_rm`'s remaining four rungs.** In `ccd/ccd`, replace lines **1996-1997**,
  **2026**, **2029-2030** and **2033-2036** respectively — note the key/value tail comes **after** the
  detail sentence, because `_lc_refuse` is `<act> <id> <token> <detail> [k v]...`:

```bash
    (( registered == 0 )) && [[ -n "$main_common" && "$wd_common" == "$main_common" ]] \
      || _lc_refuse destroy "$id" foreign-worktree \
           "$workdir is not a worktree of $main — nothing was touched; move or delete the directory by hand, then re-run (with it gone, ccd clears the leftover record itself; \`git worktree prune\` will not, while the directory is there)" \
           dec.reason "$reason"
```

```bash
    derrf=$(mktemp) || _lc_refuse destroy "$id" scratch-unwritable \
      "could not make a scratch file to read $workdir — nothing was touched" \
      dec.reason "$reason"
```

```bash
    { (( drc == 0 )) && [[ -z "$derr" ]]; } \
      || _lc_refuse destroy "$id" tree-unreadable \
           "could not read $workdir${derr:+ ($derr)} — nothing was touched" \
           dec.reason "$reason"
```

```bash
    nested=$(_ws_nested_checkouts "$workdir") \
      || _lc_refuse destroy "$id" tree-unreadable \
           "could not scan $workdir for nested checkouts${_WS_NESTED_WHY:+ ($_WS_NESTED_WHY)} — nothing was touched" \
           dec.reason "$reason"
    [[ -z "$nested" ]] \
      || _lc_refuse destroy "$id" nested-checkouts-present \
           "worktree not removed — nested checkouts live under it, and ccd deletes no repository it did not create: ${nested//$'\n'/, } — nothing was touched" \
           dec.reason "$reason"
```

- [ ] **Step 4: Convert `cmd_ws_restore`'s whole ladder.** In `ccd/ccd`, replace lines **3034-3037**
  with (the id is bound FIRST so a refusal has a subject; `$2` may be absent, hence `${2-}`):

```bash
  local id="${2-}"
  [[ $# -eq 2 && $1 == --session ]] \
    || _lc_refuse restore "$id" bad-args "usage: ccd ws-restore --session <id>"
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || _lc_refuse restore "$id" bad-session-id "bad session id"
  [[ -f "$REG/$id.uuid" ]]       || _lc_refuse restore "$id" no-such-session "no such session: $id"
```

  lines **3070-3071** with:

```bash
  command -v flock >/dev/null 2>&1 \
    || _lc_refuse restore "$id" flock-unavailable \
         "flock (util-linux) is unavailable — refusing to restore unserialised against ws-reap"
```

  line **3073** with:

```bash
  exec {lfd}>>"$lock" || _lc_refuse restore "$id" lock-unopenable "cannot open the reap lock at $lock"
```

  line **3076** with:

```bash
    _lc_refuse restore "$id" in-progress \
      "another ccd process is reaping $id and still holds the lock — refusing to restore mid-cleanup"
```

  line **3079** with:

```bash
  [[ -f "$REG/$id.archived" ]]   || _lc_refuse restore "$id" not-archived "not archived: $id"
```

  and line **3081** with:

```bash
  [[ -d "$workdir" ]] || _lc_refuse restore "$id" worktree-missing \
    "worktree is gone: $workdir — see: ccd ws-attic --session $id"
```

  **The descriptor is not leaked by any of these:** `_lc_refuse` ends in `die`, which is `echo …; exit`
  (`ccd:148`), and ccd:3118-3123 records that a `die` between the acquisition and the close needs no
  explicit descriptor close. Only a `return` would leak, and `_lc_refuse` never returns.

- [ ] **Step 5: Convert `cmd_ws_reap`'s two post-probe lock dies.** In `ccd/ccd`, replace lines
  **5910-5913** with:

```bash
  command -v flock >/dev/null 2>&1 \
    || _lc_refuse reap "$id" flock-unavailable \
         "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"
  exec {lfd}>>"$lock" \
    || _lc_refuse reap "$id" lock-unopenable "cannot open the reap lock at $lock"
```

  These two are past the `_json_str` probe at ccd:5819-5820, so the emitter is known to work; the four
  rungs above the probe stay bare `die`s in the SANCTIONED set.

- [ ] **Step 6: Run the scanner to green.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts
```

Expected: 7 passed.

- [ ] **Step 7: Prove the scanner can fail.** Add `die "nope"` on its own line inside `cmd_forget`,
  re-run:

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts
```

Expected: `leaves no bare die " behind` fails with `[ 'cmd_forget: die "nope"' ]`. **Remove it** and
re-run to green.

- [ ] **Step 8: Run the whole wave-3 blast radius, and the two suites that must be green with no edit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/ccd-die-containment.test.ts test/ccd-workspaces.test.ts test/ccd-archive.test.ts test/ccd-hold.test.ts test/ccd-forget.test.ts test/ccd-restore-reap-lock.test.ts
```

Expected: all green, `wsaudit.test.ts` with **zero edits** and its token count still 54.
`ccd-archive.test.ts:1299` still sees `usage: ccd ws-restore --session <id>` — the sentence is carried
verbatim into `_lc_refuse`'s detail argument, which is why it is not reworded.

- [ ] **Step 9: Run the full server suite in the foreground before shipping.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
```

Expected: green. Re-run any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
`ccd-session-state` in isolation before treating a red as a break from this wave.

- [ ] **Step 10: Re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" && git add ccd/ccd server/test/ccd-refusal-scan.test.ts && git commit -m "ccd(w3): scan that every die in a destructive verb is recorded (R4-3)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 11: AGENT-FIRST DEPLOY.** Wave 3 touches `ccd/` and nothing else; the server ships nothing.
  `<fleet-host>` is BOX 2 — the box running `ccd-agent`, `ccd`, tmux and `~/.cc-sessions/` — not
  `<server-host>`.

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && bash deploy/deploy.sh agent <fleet-host>
```

- [ ] **Step 12: Verify on the fleet host, READ-ONLY.** **Run no destructive verb against the live
  host** — `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore` and `forget` are all off
  limits, and `ws-reap` is human-only by contract. A bare invocation is a usage refusal, not a
  destruction:

```bash
ssh <fleet-host> 'ccd caps | grep -x lifecycle-v1; ccd ws-rm 2>&1 | head -1; ccd forget 2>&1 | head -1; tail -c 2000 ~/.cc-sessions/.lifecycle/journal-*.ndjson | tail -3'
```

Expected: `lifecycle-v1`; both usage lines reading `usage: ccd ws-rm [--reason <text>] <id>` and
`usage: ccd forget [--reason <text>] <id>`; and three parseable NDJSON lines from the supervisor's own
`ensure`/`spawn`/`claim` traffic.

Waves 2 and 3 are now on the fleet host and dark. The journal fills; nothing reads it until wave 4 ships
`journalparse`, `mirrorplan`, `mirror` and `GET /api/lifecycle`.

---

### Task 27: `MIGRATIONS[2]` — the three lifecycle tables

**Files:**
- Modify `server/src/coord/schema.ts` — insert between `:233` (the closing backtick+comma of migration 1) and `:234` (`];`)
- Modify `server/test/coord-db.test.ts` — `:271` (a stale prose count), `:330-331` (the two absolute version pins), and a new `describe` appended after `:365` (the closing `});` of the `coord.db: migration 1 — runs_by_session` describe, which OPENS at `:318`)

**Interfaces:**
- Consumes: nothing.
- Produces: SQL tables `lifecycle_events`, `lifecycle_generations`, `lifecycle_gaps`; indexes `lifecycle_uid`, `lifecycle_raw_uid`, `lifecycle_by_session`, `lifecycle_by_tx`, `lifecycle_gaps_by_at`. `COORD_SCHEMA_VERSION === 3` is DERIVED (`MIGRATIONS.length`, `schema.ts:239`), never written.

- [ ] **Step 1: Install the package's dependencies.** This worktree has no `node_modules`; without it every later step fails with ENOENT rather than red.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && npm ci
  ```

- [ ] **Step 2: Write the failing migration test.** Append to `server/test/coord-db.test.ts`, after the `});` at `:365`:
  ```ts
  describe('coord.db: migration 2 — the lifecycle journal mirror', () => {
    it('reaches a database ALREADY at user_version 2 — it cannot be an amendment to MIGRATIONS[0] or [1]', () => {
      const p = dbPathIn(mkTmp('ccrc-coord-'));
      mkdirSync(path.dirname(p), { recursive: true });
      const raw = new DatabaseSync(p);
      tx(raw, () => { raw.exec(MIGRATIONS[0]!); raw.exec(MIGRATIONS[1]!); raw.exec('PRAGMA user_version = 2'); });
      raw.close();

      const db = openCoordDb(p);
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
        { name: string }[]).map((r) => r.name).sort();
      expect(tables).toEqual(expect.arrayContaining([
        'lifecycle_events', 'lifecycle_gaps', 'lifecycle_generations',
      ]));
      db.close();
    });

    it('makes `uid` unique, and dedupes a uid-less line on (gen, raw) instead', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      const ins = db.prepare(
        'INSERT OR IGNORE INTO lifecycle_events (uid, gen, at, ingestedAt, act, outcome, raw) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      ins.run('1.2.3', '1755780000000000000', 1, 9, 'unknown', 'unknown', '{"uid":"1.2.3"}');
      ins.run('1.2.3', '1755780000000000000', 1, 9, 'unknown', 'unknown', '{"uid":"1.2.3"}');
      ins.run(null, '1755780000000000000', null, 9, 'unknown', 'unknown', 'not json');
      ins.run(null, '1755780000000000000', null, 9, 'unknown', 'unknown', 'not json');
      ins.run(null, '1755780000000000001', null, 9, 'unknown', 'unknown', 'not json');
      expect((db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(3);
      db.close();
    });

    it('lets two DIFFERENT uid-less lines coexist in one generation — the dedupe is on the bytes, not on a position', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      const ins = db.prepare(
        'INSERT OR IGNORE INTO lifecycle_events (uid, gen, at, ingestedAt, act, outcome, raw) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      ins.run(null, 'g', null, 9, 'unknown', 'unknown', 'garbage a');
      ins.run(null, 'g', null, 9, 'unknown', 'unknown', 'garbage b');
      expect((db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(2);
      db.close();
    });

    it('carries `detail` and `truncated` as their own columns — a dropped field is not a silence', () => {
      // `truncated` is what `_lc_json` writes when it shed fields to fit
      // LC_LINE_MAX. Without the column, "the family was not on the line" and
      // "the family was dropped to fit" collapse to one NULL — an overloaded
      // value at the one seam this whole record exists to keep honest.
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      db.prepare(
        'INSERT INTO lifecycle_events (uid, gen, at, ingestedAt, act, outcome, detail, truncated, raw) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('t.1', 'g', 1, 9, 'unknown', 'unknown', 'a sentence for a person', 1, '{}');
      const row = db.prepare('SELECT detail, truncated FROM lifecycle_events').get() as
        { detail: string | null; truncated: number };
      expect(row).toEqual({ detail: 'a sentence for a person', truncated: 1 });
      db.close();
    });
  });
  ```
  `mkdirSync`, `DatabaseSync`, `MIGRATIONS`, `tx`, `openCoordDb`, `dbPathIn`, `mkTmp` and `path` are all already imported at `coord-db.test.ts:1-15` by the migration-1 describe; add nothing.

- [ ] **Step 3: Update the two absolute version pins and the stale prose.** In `server/test/coord-db.test.ts`, replace `:330-331` with:
  ```ts
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
      expect(COORD_SCHEMA_VERSION).toBe(3);
  ```
  and at `:271` change `// Isolated from \`openCoordDb\` deliberately. \`MIGRATIONS.length === 2\` since` to:
  ```ts
    // Isolated from `openCoordDb` deliberately. `MIGRATIONS.length === 3` since
  ```

- [ ] **Step 4: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/coord-db.test.ts
  ```
  Expected: `AssertionError: expected 2 to be 3` at `coord-db.test.ts:331`, plus `SqliteError: no such table: lifecycle_events` in the three new table tests.

- [ ] **Step 5: Write the migration.** Insert into `server/src/coord/schema.ts` between `:233` and `:234`:
  ```ts
    // ── 3: user_version 2 -> 3 ────────────────────────────────────────────────
    // The lifecycle journal mirror (build 9 §1 D1/D6/D8). `$REG/.lifecycle/
    // journal-<19-digit-epochNs>.ndjson` is APPEND-ONLY on the fleet host and is
    // the one record `_reg_purge` (ccd:458-556) cannot reach; these three tables
    // are the server's copy of it.
    //
    // RE-MEASUREMENT, PROVABLY — the D8 ruling, written here rather than in a
    // plan so nobody later files it as a doctrine violation. `parseJournalLine`
    // is pure and total: no clock, no lookup, no registry, no other row. The
    // ONLY server-owned value in `lifecycle_events` is `ingestedAt`, and it is
    // never read as an event time. `raw` holds the line VERBATIM, so the
    // reconstruction drill (`server/test/lifecycle-replay.test.ts`) is BYTE
    // EQUALITY rather than resemblance, and a field a NEWER ccd writes that this
    // build cannot model is not lost — a later build re-projects it out of `raw`
    // without re-reading the fleet box.
    //
    // NEVER PRUNED, unlike `feed_events`. `feed_events` prunes to 2000 because it
    // backs a UI ring; this table IS the record — bound the producer (`_lc_rotate`
    // caps the journal at LC_GEN_KEEP x LC_GEN_MAX_BYTES), never the record.
    // ~90 MB/year on the SERVER box, inside the `VACUUM INTO` snapshot
    // `deploy.sh` already takes. Row count and byte size are reported through
    // `/api/fleet/health` so the operator sees it coming.
    //
    // A SEPARATE MIGRATION for the reason migration 1 states in full: `db.ts` runs
    // `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, and the server's copy
    // is already at `user_version 2`.
    `
    CREATE TABLE lifecycle_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      -- <epochNs>.<BASHPID>.<seq> (D6). INTRINSIC identity, not positional:
      -- (gen, startOffset) was rejected because an offset is not a function of
      -- the bytes when the consumer does not own the tail, and a shifted offset
      -- silently collides under OR IGNORE. NULL only when the line carried none.
      uid        TEXT,
      gen        TEXT NOT NULL,     -- the 19 digits from the FILENAME, never a header line
      at         INTEGER,           -- CCD's clock, epoch ms, off the line. NULL = the line carried
                                     -- no readable `at`. NEVER 0 -- 0 is a date, not an absence
      ingestedAt INTEGER NOT NULL,  -- THE SERVER'S clock. Never read as an event time (D8)
      act        TEXT NOT NULL,     -- LifecycleAct; 'unknown' is its we-do-not-know member, read
                                     -- back through isLifecycleAct and never cast
      badact     TEXT,              -- the token that degraded to 'unknown'; NULL when none did
      outcome    TEXT NOT NULL,     -- LifecycleOutcome; same we-do-not-know rule
      verb       TEXT,
      sessionId  TEXT,              -- the SUBJECT of the act (ccd's wire field `id`), not the actor
      tx         TEXT,              -- pairs an `intent` with its outcome (D4). An intent with no
                                     -- sibling is a process that died mid-destroy -- DERIVED by the
                                     -- reader, never stored as a flag
      refusal    TEXT,              -- D15: spelled `refusal`, NEVER `refused`. `wsaudit.test.ts`
                                     -- greps ccd for /"refused":"([a-z0-9-]+)"/ and holds the result
                                     -- set-equal to wsaudit.ts's SENTENCES; that test must stay green
                                     -- with NO edit, and this spelling is half of why it does
      detail     TEXT,              -- ccd's one line for a person. DISPLAY-ONLY -- nothing parses it
      truncated  INTEGER NOT NULL DEFAULT 0,
                                    -- the line said `"truncated":true`: `_lc_json` shed fields to fit
                                    -- LC_LINE_MAX. Its own column because otherwise "the family was
                                    -- not on the line" and "the family was dropped to fit" collapse
                                    -- to one NULL, and a reader cannot tell absence from loss
      obsJson    TEXT,              -- the three families that NEVER merge (D2), as validated JSON.
      decJson    TEXT,              -- NULL = the family was not on the line; '{}' would mean it was
      measJson   TEXT,              -- there and empty, which is a different fact. These hold what
                                    -- THIS build could model; anything a newer ccd wrote that it
                                    -- could not is still in `raw`, verbatim, and re-projectable
      raw        TEXT NOT NULL      -- the line VERBATIM. D8's drill is byte equality
    );
    -- TWO PARTIAL UNIQUE INDEXES, and the split is the design. A parsed line
    -- dedupes on its own `uid`. A line with NO usable uid dedupes on its BYTES
    -- within its generation, because generations are immutably named and a
    -- byte offset is exactly the positional identity D6 rejects.
    -- DISCLOSED RESIDUAL: two BYTE-IDENTICAL unparseable lines in one generation
    -- collapse to one row. The alternatives are a positional key (rejected above)
    -- or a content hash, which would put `node:crypto` inside a pure L1 parser.
    CREATE UNIQUE INDEX lifecycle_uid     ON lifecycle_events(uid)      WHERE uid IS NOT NULL;
    CREATE UNIQUE INDEX lifecycle_raw_uid ON lifecycle_events(gen, raw) WHERE uid IS NULL;
    -- `GET /api/lifecycle?session=` is the whole read surface. Ordered by this
    -- table's own id, never by `at`: `at` is CCD's clock and is nullable, and id
    -- is monotonic across a generation rotation the way `feed_events` already
    -- relies on for the same reason.
    CREATE INDEX lifecycle_by_session ON lifecycle_events(sessionId, id);
    CREATE INDEX lifecycle_by_tx      ON lifecycle_events(tx);

    -- The cursor, and it is an OPTIMISATION, NEVER A CORRECTNESS INPUT (D6):
    -- advanced only inside the same tx() as the rows it covers, so it can never
    -- move past uncommitted data, and re-reading a generation from offset 0 is
    -- always no-op-or-catch-up.
    CREATE TABLE lifecycle_generations (
      gen         TEXT PRIMARY KEY,
      firstSeenAt INTEGER NOT NULL,
      lastSweepAt INTEGER NOT NULL,
      cursor      INTEGER NOT NULL,  -- BYTE offset just past the last COMPLETE line ingested
      size        INTEGER NOT NULL,  -- the size the last successful read reported. READ BACK, not
                                     -- decoration: a file truncated to a length still AHEAD of the
                                     -- cursor is invisible to a cursor test and visible to this one
      retired     INTEGER NOT NULL DEFAULT 0
    );

    -- Gaps are RECORDED, never silently skipped (D6). A byte we saw and could
    -- not model is a different fact from a byte that was never there.
    CREATE TABLE lifecycle_gaps (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      at       INTEGER NOT NULL,   -- the server's clock
      gen      TEXT NOT NULL,
      reason   TEXT NOT NULL,      -- rotated-away|shrank|unknown; read back through isLifecycleGapReason
      detail   TEXT NOT NULL,      -- DISPLAY-ONLY -- nothing parses it back
      lostFrom INTEGER,            -- the byte range known lost. NULL where it could not be bounded
      lostTo   INTEGER
    );
    CREATE INDEX lifecycle_gaps_by_at ON lifecycle_gaps(at);
    `,
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/coord-db.test.ts
  ```
  Expected: all green, including `does not justify amending v1 in place any more` (untouched).

- [ ] **Step 7: Mutant check — amend instead of append.** Move the whole `CREATE TABLE lifecycle_events…` block into the `MIGRATIONS[1]` template string and delete the new array element. Re-run step 6.
  Mutant: fold migration 2 into `MIGRATIONS[1]` -> this test fails with `AssertionError: expected 2 to be 3` at `coord-db.test.ts:331`, and `reaches a database ALREADY at user_version 2` fails with `SqliteError: no such table: lifecycle_events` — the behaviour the shipped `does not justify amending v1 in place any more` test already argues for. Restore.

- [ ] **Step 8: Commit.**
  ```bash
  git add server/src/coord/schema.ts server/test/coord-db.test.ts && git commit -m "feat(coord): MIGRATIONS[2] — lifecycle_events/generations/gaps (build9 W4, D6/D8)"
  ```

---
### Task 28: `shared/api.ts` — the wave-4 wire additions, and the two wave-1 nullability corrections

**Files:**
- Modify `shared/api.ts` — one member on `FleetHealth` after `build?: BuildAgreement;` (`:1857`); two field widenings inside wave 1's `LifecycleEvent`; a new banner section immediately after `export type BuildAgreement = 'agreed' | 'skewed' | 'unknown';` (`:1879`)
- Modify `server/test/lifecycle-wire.test.ts` (wave 1 created this file; APPEND — do not create)

**Interfaces:**
- Consumes: wave 1's `LifecycleEvent`, `LifecycleOutcome`, `LC_ACT_UNKNOWN`, `FleetHealth`, `BuildAgreement` (all in `shared/api.ts`). L0 imports nothing.
- Produces, in `shared/api.ts`:
  ```ts
  export const LC_OUTCOME_UNKNOWN: LifecycleOutcome;              // 'unknown'
  export type LifecycleGapReason = 'rotated-away' | 'shrank' | 'unknown';
  export const LIFECYCLE_GAP_REASONS: readonly LifecycleGapReason[];
  export function isLifecycleGapReason(v: unknown): v is LifecycleGapReason;
  export interface LifecycleGap {
    readonly at: number; readonly gen: string; readonly reason: LifecycleGapReason;
    readonly detail: string; readonly lostFrom: number | null; readonly lostTo: number | null;
  }
  export type LifecycleHealthState = 'ok' | 'stale' | 'unavailable' | 'unknown';
  export const LIFECYCLE_HEALTH_STATES: readonly LifecycleHealthState[];
  export function isLifecycleHealthState(v: unknown): v is LifecycleHealthState;
  export interface LifecycleHealth {
    readonly state: LifecycleHealthState;
    readonly newestAt: number | null; readonly horizon: number | null;
    readonly rows: number; readonly generations: number; readonly gaps: number;
    readonly writeErrors: number | null; readonly lastOk: number | null;
  }
  export interface MirroredLifecycleEvent extends LifecycleEvent {
    readonly gen: string; readonly ingestedAt: number; readonly truncated: boolean;
  }
  export interface LifecycleQueryResult {
    readonly events: readonly MirroredLifecycleEvent[];
    readonly gaps: readonly LifecycleGap[];
  }
  // and: FleetHealth.lifecycle?: LifecycleHealth
  // and: LifecycleEvent.uid widens to `string | null`, LifecycleEvent.at widens to `number | null`
  ```
  **`LC_SWEEP_MS` is deliberately NOT produced here.** Wave 1 ruled it out of L0 (it is a server tick-gate with no bash twin and no wire meaning, and its five siblings all live in `server/src/watch.ts`); Task 37 of this wave DEFINES it beside `DIVERGENCE_SWEEP_MS` at `watch.ts:60`. Anything in `server/src/coord/` that needs a staleness window takes it as a dependency, never as an import — an L3 file importing L4 would be a `coord/` -> `watch.ts` cycle.
  **`LifecycleOutcome` gains no sixth member.** `_lc_obs` gathers the `obs` block once per process and emits nothing, so it contributes no outcome; the closed set stays `intent|done|refused|failed|unknown`. A `'observed'` member would red wave 1's `lifecycle-acts.test.ts`.

- [ ] **Step 1: Write the failing wire test.** Append to `server/test/lifecycle-wire.test.ts`:
  ```ts
  // ── wave 4's additions ────────────────────────────────────────────────────
  // The mirror's own vocabulary, pinned the way every other L0 enum in this file
  // is: derived from the union, guarded by an `isX` that casts the CONSTANT and
  // never the input, and carrying a designated we-do-not-know member on every
  // token that is READ BACK OUT OF A COLUMN.
  import {
    LIFECYCLE_GAP_REASONS, LIFECYCLE_HEALTH_STATES, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
    isLifecycleGapReason, isLifecycleHealthState,
  } from '../../shared/api.js';
  import type {
    LifecycleGapReason, LifecycleHealthState, MirroredLifecycleEvent,
  } from '../../shared/api.js';

  const GAP_REASONS: Record<LifecycleGapReason, true> =
    { 'rotated-away': true, shrank: true, unknown: true };
  const HEALTH_STATES: Record<LifecycleHealthState, true> =
    { ok: true, stale: true, unavailable: true, unknown: true };

  describe('LifecycleGapReason', () => {
    it('derives its runtime list from the union, in both directions', () => {
      expect([...LIFECYCLE_GAP_REASONS].sort()).toEqual(Object.keys(GAP_REASONS).sort());
    });
    it('carries a we-do-not-know member, because `lifecycle_gaps.reason` is a column read back', () => {
      expect(isLifecycleGapReason('unknown')).toBe(true);
      expect(isLifecycleGapReason('vacuumed')).toBe(false);
      expect(isLifecycleGapReason(7)).toBe(false);
    });
  });

  describe('LifecycleHealthState', () => {
    it('derives its runtime list from the union, in both directions', () => {
      expect([...LIFECYCLE_HEALTH_STATES].sort()).toEqual(Object.keys(HEALTH_STATES).sort());
    });
    it('tells "no evidence" from "the box does not write a journal" — the two must not share a word', () => {
      // `unavailable` = ccd advertised its caps and `lifecycle-v1` was not among
      // them. `unknown` = nothing has been measured yet. An old ccd's silence
      // must not read as a quiet fleet, and neither may read as `ok`.
      expect(isLifecycleHealthState('unavailable')).toBe(true);
      expect(isLifecycleHealthState('unknown')).toBe(true);
      expect(LIFECYCLE_HEALTH_STATES).not.toContain('none');
    });
  });

  describe('the degrade tokens are named once each', () => {
    it('names the act degrade and the outcome degrade separately, and both are `unknown`', () => {
      // ONE NAME PER DEGRADE, in L0. Eight files in wave 4 read a column back
      // through a guard and fall to one of these two; a bare `'unknown'` literal
      // in any of them would be a second home for the value.
      expect(LC_ACT_UNKNOWN).toBe('unknown');
      expect(LC_OUTCOME_UNKNOWN).toBe('unknown');
    });
  });

  describe('MirroredLifecycleEvent — a journal LINE plus what only the MIRROR knows', () => {
    it('adds exactly gen, ingestedAt and truncated to the wire event, and nothing else', () => {
      // `gen` is the FILENAME's, `ingestedAt` is THE SERVER'S clock, `truncated`
      // is the line's own admission that `_lc_json` shed fields to fit. None of
      // the three belongs on `LifecycleEvent`, which is what ccd wrote; all three
      // are facts about the row a reader must be able to see.
      const mirrored: MirroredLifecycleEvent = {
        uid: null, at: null, act: LC_ACT_UNKNOWN, badact: null, outcome: LC_OUTCOME_UNKNOWN,
        id: null, tx: null, verb: null, refusal: null, detail: null,
        obs: null, dec: null, meas: null, raw: 'ws-rm demo  # not json',
        gen: '1755780000000000000', ingestedAt: 1_060_000, truncated: false,
      };
      expect(Object.keys(mirrored).sort()).toEqual(
        ['act', 'at', 'badact', 'dec', 'detail', 'gen', 'id', 'ingestedAt', 'meas', 'obs',
         'outcome', 'raw', 'refusal', 'truncated', 'tx', 'uid', 'verb'].sort());
      // The nullability wave 4 needs and wave 1 declared too narrowly: the mirror
      // genuinely holds rows whose line carried no `uid` and no readable `at` —
      // that is what `lifecycle_raw_uid` exists for.
      expect(mirrored.uid).toBeNull();
      expect(mirrored.at).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-wire.test.ts
  ```
  Expected: `SyntaxError: [vite] The requested module '/home/you/worktrees/ccrc-pwa/still-river/shared/api.ts' does not provide an export named 'LIFECYCLE_GAP_REASONS'`.

- [ ] **Step 3: Widen the two wave-1 fields.** In `shared/api.ts`, inside `interface LifecycleEvent`, replace `readonly uid: string;` with:
  ```ts
    /** `<epochNs>.<BASHPID>.<seq>` — INTRINSIC, not positional (D6). `UNIQUE`
     *  in the mirror, inserted `OR IGNORE`, so re-reading a generation from
     *  offset 0 is always no-op-or-catch-up and a truncation is recoverable
     *  rather than fatal.
     *
     *  NULL WHEN THE LINE CARRIED NONE, and that is not a widening for
     *  convenience: an unparseable line is INSERTED rather than dropped (a byte
     *  we saw and could not model is a different fact from a byte that was never
     *  there), and such a row has no uid to carry. `lifecycle_raw_uid` dedupes
     *  it on its bytes within its generation instead. */
    readonly uid: string | null;
  ```
  and replace `readonly at: number;` with:
  ```ts
    /** Epoch MILLISECONDS, ccd's clock. Derived from the SAME clock read as
     *  `uid`'s nanosecond prefix, so the two can never disagree about one event.
     *  Never the server's clock: `MirroredLifecycleEvent.ingestedAt` is a
     *  separate, explicitly server-owned value and is never read as an event
     *  time. NULL = the line carried no readable `at`; NEVER 0, which is a date
     *  and not an absence. */
    readonly at: number | null;
  ```
  `raw` stays `string | null` — wave 1's spelling and wave 1's `EVENT` literal both say so, and a narrowing here would red `carries exactly the fourteen fields`'s sibling literal for no gain: the COLUMN is `NOT NULL` and `parseJournalLine` fills it on every path, so a `string` flows into a `string | null` field unchanged.

- [ ] **Step 4: Add the section to `shared/api.ts`,** immediately after `:1879`:
  ```ts
  /** The outcome side's degrade name. Wave 1 named the act side
   *  (`LC_ACT_UNKNOWN`); the mirror reads BOTH columns back through a guard and
   *  falls to a designated member on each, so both names live here rather than
   *  as a bare `'unknown'` literal in eight server files. */
  export const LC_OUTCOME_UNKNOWN: LifecycleOutcome = 'unknown';

  /* ---------------------------------------------------------------------------
   * The lifecycle JOURNAL's MIRROR — build 9's provenance record, server side.
   *
   * DISAMBIGUATION, said out loud because the name is already taken twice in
   * this file: `SessionLifecycle`/`sessionLifecycle()` classify why a REGISTRY
   * ROW is not alive, and `LifecycleField`/`LifecycleInput` are that ladder's
   * inputs. NOTHING below is related to them. These types describe
   * `$REG/.lifecycle/journal-<epochNs>.ndjson` — an append-only file `_reg_purge`
   * cannot reach — and its mirror in `coord.db`.
   * ------------------------------------------------------------------------- */

  /** Why the mirror could not read bytes it knows existed. RECORDED, never
   *  silently skipped (spec D6): a byte we saw and could not model is a
   *  different fact from a byte that was never there.
   *
   *  `rotated-away` — a generation stopped being listed while undrained.
   *  `shrank` — an immutably-named generation got smaller, i.e. a truncation;
   *             the cursor resets to 0 and the whole file is re-read, and `uid`
   *             dedupes what comes back. Only genuinely-lost bytes are lost.
   *  `unknown` — the we-do-not-know member. `lifecycle_gaps.reason` IS a column
   *             read back, so a token a newer build wrote lands here rather than
   *             being switched on and rendered as nothing. It is also what a
   *             name that LOOKS like a generation but cannot be ORDERED gets
   *             (`looksLikeGenerationFile` true, `parseLifecycleGeneration`
   *             null) — the mirror saw a file it could not place in the
   *             sequence, which is a hole and not an absence. */
  export type LifecycleGapReason = 'rotated-away' | 'shrank' | 'unknown';
  const LIFECYCLE_GAP_REASON_MAP: Record<LifecycleGapReason, true> = {
    'rotated-away': true, shrank: true, unknown: true,
  };
  export const LIFECYCLE_GAP_REASONS: readonly LifecycleGapReason[] =
    Object.keys(LIFECYCLE_GAP_REASON_MAP) as LifecycleGapReason[];
  /** The only way to narrow an untrusted string to a `LifecycleGapReason` — the
   *  CONSTANT is cast, never the input, exactly as `isDivergenceKind` above. */
  export function isLifecycleGapReason(v: unknown): v is LifecycleGapReason {
    return typeof v === 'string' && (LIFECYCLE_GAP_REASONS as readonly string[]).includes(v);
  }

  /** One recorded hole in the mirror. `lostFrom`/`lostTo` are BYTE offsets in
   *  the named generation and are `null` together when the range could not be
   *  bounded — never 0, which would claim a measured empty loss. */
  export interface LifecycleGap {
    readonly at: number;
    readonly gen: string;
    readonly reason: LifecycleGapReason;
    /** One actionable line. DISPLAY-ONLY — nothing parses it back. */
    readonly detail: string;
    readonly lostFrom: number | null;
    readonly lostTo: number | null;
  }

  /**
   * Whether the journal is being mirrored, and it is FOUR states rather than a
   * boolean for the reason `roster`/`build` above are three: a second
   * disagreement between the same two boxes gets its own word.
   *
   *   `ok`          — a sweep succeeded recently.
   *   `stale`       — no sweep has succeeded inside the staleness window. A
   *                   silently-stopped mirror must be distinguishable from a
   *                   quiet fleet, which is the whole point of reporting it.
   *   `unavailable` — the fleet host's ccd advertised its caps and
   *                   `lifecycle-v1` was NOT among them. A MEASURED ABSENCE,
   *                   never an empty history.
   *   `unknown`     — nothing has been measured (no caps evidence yet, or no
   *                   sweep has run). Not `ok`, and not `unavailable` either.
   */
  export type LifecycleHealthState = 'ok' | 'stale' | 'unavailable' | 'unknown';
  const LIFECYCLE_HEALTH_STATE_MAP: Record<LifecycleHealthState, true> = {
    ok: true, stale: true, unavailable: true, unknown: true,
  };
  export const LIFECYCLE_HEALTH_STATES: readonly LifecycleHealthState[] =
    Object.keys(LIFECYCLE_HEALTH_STATE_MAP) as LifecycleHealthState[];
  export function isLifecycleHealthState(v: unknown): v is LifecycleHealthState {
    return typeof v === 'string' && (LIFECYCLE_HEALTH_STATES as readonly string[]).includes(v);
  }

  /** The `/api/fleet/health` block. `horizon`/`newestAt` are CCD's clock (event
   *  times); `lastOk` is THE SERVER'S (when a sweep last succeeded) — two clocks,
   *  two fields, never one. `writeErrors` is `$REG/.lifecycle/errors` as last
   *  measured: `null` = never measured, `0` = measured zero. */
  export interface LifecycleHealth {
    readonly state: LifecycleHealthState;
    readonly newestAt: number | null;
    /** The oldest event still mirrored — the reconstruction window's floor
     *  (spec D8: `LC_TOTAL_MAX_BYTES` is roughly one year). Beyond it the mirror
     *  holds history the file no longer does. */
    readonly horizon: number | null;
    readonly rows: number;
    readonly generations: number;
    readonly gaps: number;
    readonly writeErrors: number | null;
    readonly lastOk: number | null;
  }

  /**
   * A journal line AS THE MIRROR HOLDS IT.
   *
   * `LifecycleEvent` is what CCD WROTE. The three fields added here are what only
   * the mirror knows, and keeping them off the wire event is the whole reason
   * this type exists: `gen` comes from the FILENAME (no emit carries it, D1),
   * `ingestedAt` is THE SERVER'S clock and is never read as an event time (D8),
   * and `truncated` is the line's own admission that `_lc_json` shed fields to
   * fit `LC_LINE_MAX` — without it a dropped family and an absent family are the
   * same NULL, which is an overloaded value at the one seam this record exists
   * to keep honest.
   */
  export interface MirroredLifecycleEvent extends LifecycleEvent {
    readonly gen: string;
    readonly ingestedAt: number;
    readonly truncated: boolean;
  }

  /** `GET /api/lifecycle` — one session's past tense, oldest-first. `gaps` rides
   *  alongside the events deliberately: a timeline with a hole in it must say so
   *  in the same answer, not in a second call nobody makes. */
  export interface LifecycleQueryResult {
    readonly events: readonly MirroredLifecycleEvent[];
    readonly gaps: readonly LifecycleGap[];
  }
  ```

- [ ] **Step 5: Add the optional member to `FleetHealth`,** immediately after `build?: BuildAgreement;` (`:1857`) and before that interface's closing `}`:
  ```ts
    /**
     * The lifecycle journal mirror (build 9). Optional for the same
     * absence-permits reason `roster` and `build` are — an older server's
     * response omits it, and a reader must treat an absent block as
     * `state: 'unknown'`, never as `'ok'` and never as an empty history.
     */
    lifecycle?: LifecycleHealth;
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-wire.test.ts test/single-definition.test.ts test/module-format.test.ts
  ```
  Expected: all green. `single-definition` is in the list because it text-scans `shared/`, `server/src`, `pwa/src` and `agent/src` for a second copy of any enumerated vocabulary, and this task adds two enumerations.

- [ ] **Step 7: Typecheck the tests, which is where the interface half is red or green.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && node ./node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
  ```
  Expected: no output, exit 0.

- [ ] **Step 8: Mutant check — drop the we-do-not-know member.** Delete `unknown: true` from `LIFECYCLE_GAP_REASON_MAP` and `| 'unknown'` from the union; re-run step 6.
  Mutant: remove `'unknown'` from `LifecycleGapReason` -> this test fails with `AssertionError: expected [ 'rotated-away', 'shrank' ] to deeply equal [ 'rotated-away', 'shrank', 'unknown' ]`, and step 7 additionally reds with `TS2353` on the `Record<LifecycleGapReason, true>` literal. Restore.

- [ ] **Step 9: Mutant check — fold the mirror's facts onto the wire event.** Move `gen`, `ingestedAt` and `truncated` onto `LifecycleEvent` and make `MirroredLifecycleEvent` an alias; re-run step 7.
  Mutant: put `gen`/`ingestedAt`/`truncated` on `LifecycleEvent` -> wave 1's own `carries exactly the fourteen fields, and the three families are three fields` fails with `TS2739: ... is missing the following properties from type 'LifecycleEvent': gen, ingestedAt, truncated` on its `EVENT` literal. Restore.

- [ ] **Step 10: Commit.**
  ```bash
  git add shared/api.ts server/test/lifecycle-wire.test.ts && git commit -m "feat(shared): lifecycle gap/health/query wire types, MirroredLifecycleEvent, FleetHealth.lifecycle (build9 W4)"
  ```

---
### Task 29: `journalparse.ts` — `parseJournalLine`, pure and total

**Files:**
- Create `server/src/coord/journalparse.ts`
- Create `server/test/journalparse.test.ts`

**Interfaces:**
- Consumes, from `shared/api.js`: `isLifecycleAct`, `isLifecycleOutcome`, `isActorClass`, `isStopSurface`, `LC_ACT_UNKNOWN`, `LC_OUTCOME_UNKNOWN`, `LIFECYCLE_ACTS`, `LIFECYCLE_OUTCOMES`, and the types `LifecycleAct`, `LifecycleOutcome`, `LifecycleObs`, `LifecycleDec`, `LifecycleMeas`. Their shipped shapes:
  ```ts
  interface LifecycleObs { readonly cg: ActorClass | null; readonly cgraw: string | null;
    readonly pid: number | null; readonly ppid: number | null; readonly pane: string | null;
    readonly paneWhy: string | null; readonly tty: boolean | null; readonly ssh: string | null }
  interface LifecycleDec { readonly surface: DecSurface; readonly actor: string | null;
    readonly reason: string | null }                       // DecSurface = StopSurface | 'none'
  interface LifecycleMeas { readonly project: string | null; readonly workspace: string | null;
    readonly branch: string | null; readonly uuid: string | null; readonly wrapper: string | null;
    readonly tip: string | null; readonly attic: number | null; readonly archivedAt: number | null;
    readonly archivedReason: string | null; readonly held: string | null }
  ```
- Produces:
  ```ts
  export interface JournalRow {
    readonly uid: string | null; readonly at: number | null;
    readonly act: LifecycleAct; readonly badact: string | null;
    readonly outcome: LifecycleOutcome;
    readonly verb: string | null; readonly sessionId: string | null;
    readonly tx: string | null; readonly refusal: string | null;
    readonly detail: string | null; readonly truncated: boolean;
    readonly obs: LifecycleObs | null; readonly dec: LifecycleDec | null;
    readonly meas: LifecycleMeas | null;
    readonly raw: string;
  }
  export function parseJournalLine(line: string): JournalRow;   // never throws
  export function reviveObs(v: unknown): LifecycleObs | null;
  export function reviveDec(v: unknown): LifecycleDec | null;
  export function reviveMeas(v: unknown): LifecycleMeas | null;
  ```
  **The one sanctioned rename:** ccd writes the SUBJECT of the act as the wire field `id`; the row calls it `sessionId`, because `id` is `lifecycle_events`' own autoincrement key. One rename, in this file, once — do not "fix" it back anywhere downstream.

- [ ] **Step 1: Write the failing test.** Create `server/test/journalparse.test.ts`:
  ```ts
  // L1, pure and TOTAL: `parseJournalLine` has no clock, no lookup, no registry
  // and no other row, which is the whole of D8's re-measurement proof. Every
  // assertion below is therefore a plain function call — no fixtures, no db.
  import { describe, it, expect } from 'vitest';
  import { parseJournalLine, reviveMeas } from '../src/coord/journalparse.js';
  import {
    LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
  } from '../../shared/api.js';

  /** Taken from the vocabulary rather than written out: this file must not
   *  become a second holder of the act list (`single-definition.test.ts`). */
  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const AN_OUTCOME = LIFECYCLE_OUTCOMES.find((o) => o !== LC_OUTCOME_UNKNOWN)!;

  const line = (over: Record<string, unknown> = {}): string => JSON.stringify({
    uid: '1755780000123456789.31415.7', at: 1_755_780_000_123,
    act: AN_ACT, outcome: AN_OUTCOME, verb: 'ws-rm', id: 'demo-quiet-basin',
    tx: '1755780000123456789.31415', ...over,
  });

  describe('parseJournalLine: it never throws, on anything', () => {
    it.each([
      ['empty', ''],
      ['not json', 'ws-rm demo-quiet-basin'],
      ['a bare array', '[1,2,3]'],
      ['a bare number', '42'],
      ['json null', 'null'],
      ['a truncated object', '{"uid":"1.2.3","act":'],
      ['a lone brace', '{'],
    ])('%s', (_name, raw) => {
      const r = parseJournalLine(raw);
      expect(r.act).toBe(LC_ACT_UNKNOWN);
      expect(r.outcome).toBe(LC_OUTCOME_UNKNOWN);
      expect(r.raw).toBe(raw);          // VERBATIM — D8's drill is byte equality
      expect(r.uid).toBeNull();
      expect(r.truncated).toBe(false);
    });
  });

  describe('parseJournalLine: the vocabulary', () => {
    it('reads a declared act and outcome through', () => {
      const r = parseJournalLine(line());
      expect(r.act).toBe(AN_ACT);
      expect(r.outcome).toBe(AN_OUTCOME);
      expect(r.badact).toBeNull();
      expect(r.sessionId).toBe('demo-quiet-basin');   // the wire says `id`, the row says sessionId
      expect(r.verb).toBe('ws-rm');
      expect(r.at).toBe(1_755_780_000_123);
    });

    it('degrades an act this build does not declare to `unknown` AND KEEPS THE TOKEN', () => {
      // A newer ccd. The row is INSERTED, not dropped: a byte we saw and could
      // not model is a different fact from a byte that was never there.
      const raw = line({ act: 'quarantine' });
      const r = parseJournalLine(raw);
      expect(r.act).toBe(LC_ACT_UNKNOWN);
      expect(r.badact).toBe('quarantine');
      expect(r.raw).toBe(raw);
      expect(r.uid).toBe('1755780000123456789.31415.7');   // still idempotent under replay
    });

    it("keeps ccd's own `badact` when ccd already degraded the act itself", () => {
      const r = parseJournalLine(line({ act: LC_ACT_UNKNOWN, badact: 'quarantine' }));
      expect(r.act).toBe(LC_ACT_UNKNOWN);
      expect(r.badact).toBe('quarantine');
    });

    it('reads the refusal token from `refusal`, never from `refused`', () => {
      // D15: `wsaudit.test.ts` greps ccd for /"refused":"…"/ and holds the result
      // set-equal to SENTENCES. A `refused` key here would mean ccd had written
      // one, which is the poisoning that test exists to catch.
      expect(parseJournalLine(line({ refusal: 'held' })).refusal).toBe('held');
      expect(parseJournalLine(line({ refused: 'held' })).refusal).toBeNull();
    });

    it('carries the top-level `detail` and `truncated` that the emitter writes beside them', () => {
      const r = parseJournalLine(line({ detail: 'held: program:build8 wave:2/4', truncated: true }));
      expect(r.detail).toBe('held: program:build8 wave:2/4');
      expect(r.truncated).toBe(true);
      // `truncated` is a BOOLEAN, three-condition-free: the key is either the
      // literal `true` or it is not there. A string 'true' is not an admission.
      expect(parseJournalLine(line({ truncated: 'true' })).truncated).toBe(false);
    });
  });

  describe('parseJournalLine: the three families never merge', () => {
    it('carries obs, dec and meas as three separate objects', () => {
      const r = parseJournalLine(line({
        obs: { cg: 'pane', cgraw: '0::/user.slice/x.scope', pid: 31415, ppid: 2,
               pane: 'cc-demo', paneWhy: 'ppid-ancestry', tty: true, ssh: null },
        dec: { surface: 'cli', actor: 'you', reason: 'stale wave' },
        meas: { project: 'demo', workspace: 'quiet-basin', branch: 'ws/quiet-basin',
                uuid: 'u', wrapper: 'claude', tip: 'abc', attic: 3,
                archivedAt: null, archivedReason: null, held: null },
      }));
      expect(r.obs?.cg).toBe('pane');
      expect(r.obs?.cgraw).toBe('0::/user.slice/x.scope');
      expect(r.dec?.surface).toBe('cli');
      expect(r.dec?.actor).toBe('you');
      expect(r.meas?.branch).toBe('ws/quiet-basin');
      expect(r.meas?.attic).toBe(3);
    });

    it('says NULL for a family the line did not carry — never an empty object', () => {
      const r = parseJournalLine(line());
      expect(r.obs).toBeNull();
      expect(r.dec).toBeNull();
      expect(r.meas).toBeNull();
    });

    it('tells "no flag was passed" from "a surface word this build cannot model"', () => {
      expect(parseJournalLine(line({ dec: { surface: 'none' } })).dec?.surface).toBe('none');
      expect(parseJournalLine(line({ dec: { surface: 'kiosk' } })).dec?.surface).toBe('unknown');
    });

    it('tells "no cgroup was read" from "one was read and matched nothing" — THREE conditions', () => {
      // `cg: null` is `corroboration` -> 'unmeasured'; `cg: 'unknown'` is
      // 'not-comparable'. Collapsing them would make an unread /proc look like a
      // disagreement the census could raise.
      const unread = parseJournalLine(line({ obs: { cgraw: null } }));
      expect(unread.obs?.cg).toBeNull();
      const unclassifiable = parseJournalLine(line({ obs: { cg: 'kubelet', cgraw: '0::/x' } }));
      expect(unclassifiable.obs?.cg).toBe('unknown');
      expect(unclassifiable.obs?.cgraw).toBe('0::/x');   // never dropped (D2)
    });

    it('says NULL for an `at` the line did not carry — 0 is a date, not an absence', () => {
      expect(parseJournalLine(line({ at: 'yesterday' })).at).toBeNull();
      expect(parseJournalLine(line({ at: undefined })).at).toBeNull();
    });

    it('models the TEN declared meas keys, and leaves anything a newer ccd added in `raw`', () => {
      // DISCLOSED RESIDUAL, made a mechanism rather than a sentence. `meas` is
      // the ten fields `LifecycleMeas` declares. Waves 2-3 emit `meas.*` keys
      // beyond them (`workdir`, `base`, `rc`, …); those do not reach `measJson`,
      // and the record of them is `raw`, verbatim, re-projectable later without
      // re-reading the fleet box.
      const raw = line({ meas: { project: 'demo', workdir: '/w/demo-quiet-basin', rc: '0' } });
      const r = parseJournalLine(raw);
      expect(Object.keys(r.meas!).sort()).toEqual(
        ['archivedAt', 'archivedReason', 'attic', 'branch', 'held', 'project',
         'tip', 'uuid', 'workspace', 'wrapper'].sort());
      expect(r.raw).toContain('"workdir":"/w/demo-quiet-basin"');
      expect(reviveMeas({ project: 'demo' })!.project).toBe('demo');
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/journalparse.test.ts
  ```
  Expected: `Error: Failed to load url ../src/coord/journalparse.js`.

- [ ] **Step 3: Write the parser.** Create `server/src/coord/journalparse.ts`:
  ```ts
  import {
    isActorClass, isLifecycleAct, isLifecycleOutcome, isStopSurface,
    LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
    type LifecycleAct, type LifecycleDec, type LifecycleMeas, type LifecycleObs,
    type LifecycleOutcome,
  } from '../../../shared/api.js';

  /**
   * L1: pure, clock-free, `fs`-free, fastify-free. It imports the vocabulary
   * GUARDS and the two degrade NAMES from `shared/api.js` and nothing else —
   * never the act LIST, because a second enumeration of it here would trip
   * `single-definition.test.ts`'s "enumerated only where the compiler enforces
   * exhaustiveness" rule. It imports neither `./db.js` nor `node:sqlite`, which
   * the coord-ring scan in that same file checks.
   *
   * PURE AND TOTAL, and that is D8's whole re-measurement proof: no clock, no
   * lookup, no registry, no other row, and no path returns anything but a
   * `JournalRow`. `raw` holds the line VERBATIM on every path, so the
   * reconstruction drill is byte equality rather than resemblance, and a field a
   * NEWER ccd writes that this build cannot model is re-projectable later from
   * `raw` without re-reading the fleet box.
   *
   * NOTE THE ONE SANCTIONED WIRE/COLUMN RENAME: ccd writes the SUBJECT of the
   * act as `id`; the row calls it `sessionId`, because `id` is
   * `lifecycle_events`' own autoincrement key. One rename, here, once.
   */
  export interface JournalRow {
    readonly uid: string | null;
    readonly at: number | null;
    readonly act: LifecycleAct;
    readonly badact: string | null;
    readonly outcome: LifecycleOutcome;
    readonly verb: string | null;
    readonly sessionId: string | null;
    readonly tx: string | null;
    readonly refusal: string | null;
    /** ccd's one line for a person. DISPLAY-ONLY — nothing parses it back. */
    readonly detail: string | null;
    /** The line said `"truncated":true` — `_lc_json` shed fields to fit
     *  `LC_LINE_MAX`. Carried so an absent family and a DROPPED family are two
     *  facts rather than one NULL. */
    readonly truncated: boolean;
    readonly obs: LifecycleObs | null;
    readonly dec: LifecycleDec | null;
    readonly meas: LifecycleMeas | null;
    /** NEVER null here, unlike `LifecycleEvent.raw`: this type is what the
     *  parser produces, and it produces the bytes on every path. */
    readonly raw: string;
  }

  type Obj = Record<string, unknown>;

  const rec = (v: unknown): Obj | null =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
  const s = (o: Obj, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const n = (o: Obj, k: string): number | null =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null;
  const b = (o: Obj, k: string): boolean | null => (typeof o[k] === 'boolean' ? (o[k] as boolean) : null);

  /** Each reviver returns an object LITERAL, so a member added to the interface
   *  in `shared/api.ts` and forgotten here is a compile error rather than a
   *  silently-dropped field — the exact mechanism `reviveFleetSession`
   *  (`shared/api.ts:1509-1640`) relies on. They are exported because the STORE
   *  reads the same JSON back out of `obsJson`/`decJson`/`measJson` through
   *  them: one definition, both directions. */
  export function reviveObs(v: unknown): LifecycleObs | null {
    const o = rec(v);
    if (o === null) return null;
    const cg = s(o, 'cg');
    return {
      // THREE CONDITIONS, THREE VALUES, and the split is `corroboration`'s
      // input: `null` = no cgroup was read at all (-> 'unmeasured');
      // `'unknown'` = one was read and matched none of the four shapes
      // (-> 'not-comparable'); a member = what was seen. Collapsing the first
      // two would make an unread /proc look like a disagreement.
      cg: cg === null ? null : isActorClass(cg) ? cg : 'unknown',
      // NEVER DROPPED (D2). `null` means the line carried none; `''` would be a
      // measured-empty cgroup path, which is a different fact.
      cgraw: s(o, 'cgraw'),
      pid: n(o, 'pid'), ppid: n(o, 'ppid'),
      pane: s(o, 'pane'), paneWhy: s(o, 'paneWhy'),
      tty: b(o, 'tty'), ssh: s(o, 'ssh'),
    };
  }

  export function reviveDec(v: unknown): LifecycleDec | null {
    const o = rec(v);
    if (o === null) return null;
    const surface = s(o, 'surface');
    return {
      // `'none'` = ccd passed no flag; a member of `StopSurface` = what was
      // declared; `'unknown'` = a surface word this build cannot model, which
      // is also where a `dec` object carrying no `surface` key at all lands —
      // ccd always writes one, so its absence is a malformed line and not a
      // fourth condition to invent a value for.
      surface: surface === 'none' ? 'none' : isStopSurface(surface) ? surface : 'unknown',
      actor: s(o, 'actor'),
      reason: s(o, 'reason'),
    };
  }

  /** The TEN keys `LifecycleMeas` declares, and only those. Waves 2-3 emit
   *  further `meas.*` keys; the record of those is `raw`, verbatim — pinned by
   *  `journalparse.test.ts`'s `models the TEN declared meas keys` case, so the
   *  residual is a mechanism rather than a sentence. */
  export function reviveMeas(v: unknown): LifecycleMeas | null {
    const o = rec(v);
    if (o === null) return null;
    return {
      project: s(o, 'project'), workspace: s(o, 'workspace'), branch: s(o, 'branch'),
      uuid: s(o, 'uuid'), wrapper: s(o, 'wrapper'), tip: s(o, 'tip'),
      attic: n(o, 'attic'), archivedAt: n(o, 'archivedAt'),
      archivedReason: s(o, 'archivedReason'), held: s(o, 'held'),
    };
  }

  const UNMODELLED: Omit<JournalRow, 'raw'> = {
    uid: null, at: null, act: LC_ACT_UNKNOWN, badact: null, outcome: LC_OUTCOME_UNKNOWN,
    verb: null, sessionId: null, tx: null, refusal: null, detail: null, truncated: false,
    obs: null, dec: null, meas: null,
  };

  export function parseJournalLine(line: string): JournalRow {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return { ...UNMODELLED, raw: line }; }
    const o = rec(parsed);
    if (o === null) return { ...UNMODELLED, raw: line };

    const actRaw = s(o, 'act');
    const act: LifecycleAct = isLifecycleAct(actRaw) ? actRaw : LC_ACT_UNKNOWN;
    const outRaw = s(o, 'outcome');
    const badact = s(o, 'badact');
    return {
      uid: s(o, 'uid'),
      at: n(o, 'at'),
      act,
      // ccd degrades an undeclared act itself and names it in `badact`
      // (`lifecycle-vocabulary.test.ts` is what makes that true). This build
      // degrades a SECOND time for a token ccd knew and it does not, and keeps
      // whichever token is actually there — never both, never neither.
      badact: badact ?? (act === LC_ACT_UNKNOWN ? actRaw : null),
      outcome: isLifecycleOutcome(outRaw) ? outRaw : LC_OUTCOME_UNKNOWN,
      verb: s(o, 'verb'),
      sessionId: s(o, 'id'),
      tx: s(o, 'tx'),
      // `refusal`, NEVER `refused` — D15. The spelling is half of what keeps
      // `wsaudit.test.ts` green with no edit.
      refusal: s(o, 'refusal'),
      detail: s(o, 'detail'),
      truncated: b(o, 'truncated') === true,
      obs: reviveObs(o['obs']), dec: reviveDec(o['dec']), meas: reviveMeas(o['meas']),
      raw: line,
    };
  }
  ```

- [ ] **Step 4: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/journalparse.test.ts
  ```

- [ ] **Step 5: Mutant check — throw instead of degrade.** Replace `catch { return { ...UNMODELLED, raw: line }; }` with `catch (e) { throw e; }`; re-run step 4.
  Mutant: let `JSON.parse` throw -> this test fails with `SyntaxError: Unexpected end of JSON input` in every case of `it never throws, on anything`. Restore.

- [ ] **Step 6: Mutant check — drop the unparseable line instead of inserting it.** Change the return type to `JournalRow | null` and return `null` on the catch; re-run step 4.
  Mutant: return `null` for an unparseable line -> this test fails with `TypeError: Cannot read properties of null (reading 'act')`. Restore.

- [ ] **Step 7: Mutant check — collapse the unread cgroup into `'unknown'`.** Change `cg: cg === null ? null : isActorClass(cg) ? cg : 'unknown',` to `cg: isActorClass(cg) ? cg : 'unknown',`; re-run step 4.
  Mutant: fold "no cgroup read" into "read and unclassifiable" -> this test fails with `AssertionError: expected 'unknown' to be null` in `tells "no cgroup was read" from "one was read and matched nothing"`. Restore.

- [ ] **Step 8: Verify the ring rule holds.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/single-definition.test.ts
  ```
  Expected green — `journalparse.ts` imports neither `./db.js` nor `node:sqlite`, names no database handle on a `coord`/`store` receiver, and enumerates no vocabulary.

- [ ] **Step 9: Commit.**
  ```bash
  git add server/src/coord/journalparse.ts server/test/journalparse.test.ts && git commit -m "feat(coord): parseJournalLine — pure, total, raw verbatim (build9 W4, D6/D8)"
  ```

---
### Task 30: `mirrorplan.ts` — `frameRead`, the framing that has no carry buffer

**Files:**
- Create `server/src/coord/mirrorplan.ts`
- Create `server/test/mirrorplan.test.ts`
- Modify: `server/test/lifecycleHelpers.ts` — **created in Task 11**, which owns `readJournal`/`actsOf`/`refusalsOf`/`measOf`/`decOf`/`lcDir` there. APPEND `genFile` as one more export; do not recreate the file and do not restate its existing exports.

**Interfaces:**
- Consumes, from `shared/api.js` (wave 1): `LC_GEN_PREFIX` (`'journal-'`), `LC_GEN_SUFFIX` (`'.ndjson'`).
- Produces:
  ```ts
  // server/src/coord/mirrorplan.ts
  export interface FramedRead {
    readonly lines: readonly string[];
    readonly nextCursor: number;
    readonly shrank: boolean;
  }
  export function frameRead(cursor: number, data: string, size: number, lastSize: number): FramedRead;
  // server/test/lifecycleHelpers.ts
  export const genFile: (gen: string) => string;   // `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`
  ```
  **There is no `LIFECYCLE_DIR`, `LIFECYCLE_ERRORS_FILE`, `generationOf` or `journalFileName` in this file, deliberately.** Wave 1 already owns every one of those under the names `LC_DIR_NAME`, `LC_ERRORS_NAME`, `looksLikeGenerationFile` + `parseLifecycleGeneration`, and `LC_GEN_PREFIX`+`LC_GEN_SUFFIX`. `single-definition.test.ts` text-scans `shared/`, `server/src`, `pwa/src` and `agent/src` and fails the build on a second copy.

- [ ] **Step 1: Write the shared test helper.** APPEND this one export to `server/test/lifecycleHelpers.ts`, which Task 11 created:
  ```ts
  import { LC_GEN_PREFIX, LC_GEN_SUFFIX } from '../../shared/api.js';

  /** `journal-<gen>.ndjson`, built from L0's two halves rather than from a
   *  literal. Four test files in this wave plant generation files; four spellings
   *  of the name is four chances to differ, in a repo whose
   *  `single-definition.test.ts` exists for exactly that. */
  export const genFile = (gen: string): string => `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`;
  ```

- [ ] **Step 2: Write the failing test.** Create `server/test/mirrorplan.test.ts`:
  ```ts
  // L1, pure. `frameRead` is the whole of D5's "framing is complete inside one
  // call": `readFileFrom` returns [cursor, size) in one shot, a trailing PARTIAL
  // line is not consumed, and the cursor advances only to the end of the last
  // complete line. THERE IS NO CROSS-CALL CARRY BUFFER ANYWHERE IN THE MIRROR,
  // so there is no splice class — and these assertions are what makes that a
  // mechanism rather than a claim.
  import { describe, it, expect } from 'vitest';
  import { frameRead } from '../src/coord/mirrorplan.js';

  describe('frameRead: the partial trailing line is NOT consumed', () => {
    it('takes the complete lines and stops the cursor at the last LF', () => {
      const data = 'a\nbb\nccc';        // 2 + 3 + 3 bytes, last line incomplete
      const r = frameRead(100, data, 110, 100);
      expect(r.lines).toEqual(['a', 'bb']);
      expect(r.nextCursor).toBe(100 + 'a\nbb\n'.length);   // 105, NOT 110
      expect(r.shrank).toBe(false);
    });

    it('consumes nothing at all when no LF has arrived yet', () => {
      const r = frameRead(100, '{"uid":"1.2', 111, 100);
      expect(r.lines).toEqual([]);
      expect(r.nextCursor).toBe(100);
    });

    it('consumes everything when the payload ends on an LF', () => {
      const r = frameRead(0, 'a\nb\n', 4, 0);
      expect(r.lines).toEqual(['a', 'b']);
      expect(r.nextCursor).toBe(4);
    });

    it('answers an empty payload with the cursor unmoved — a cursor at EOF is a POSITIVE answer', () => {
      // `readFileFrom` clamps and returns {data:'', size} when from >= size
      // (`io.ts:101-102`), which is what makes "no cross-call carry buffer" true.
      const r = frameRead(410, '', 410, 410);
      expect(r.lines).toEqual([]);
      expect(r.nextCursor).toBe(410);
      expect(r.shrank).toBe(false);
    });

    it('counts BYTES, not characters — a multibyte line must not shift the cursor', () => {
      const data = '{"reason":"héllo ☃"}\n{"partial":';
      const complete = '{"reason":"héllo ☃"}\n';
      const size = Buffer.byteLength(data, 'utf8');
      const r = frameRead(0, data, size, 0);
      expect(r.lines).toEqual(['{"reason":"héllo ☃"}']);
      expect(r.nextCursor).toBe(Buffer.byteLength(complete, 'utf8'));
      expect(r.nextCursor).not.toBe(complete.length);   // bytes vs chars
    });

    it('drops a blank line without stranding the cursor behind it', () => {
      const r = frameRead(0, 'a\n\nb\n', 5, 0);
      expect(r.lines).toEqual(['a', 'b']);
      expect(r.nextCursor).toBe(5);
    });
  });

  describe('frameRead: a shrink is an ANSWER, not a stall', () => {
    it('reports a shrink and resets the cursor to 0 when size is behind the cursor', () => {
      // An immutably-named generation got smaller: a truncation. `agent/src/
      // tail.ts:53-58` hands the reader a reset it must model, which is exactly
      // why D5 polls instead.
      const r = frameRead(4096, '', 100, 4096);
      expect(r.shrank).toBe(true);
      expect(r.nextCursor).toBe(0);
      expect(r.lines).toEqual([]);
    });

    it('calls a shrink a shrink EVEN WHEN THE NEW SIZE IS STILL AHEAD OF THE CURSOR', () => {
      // The condition a cursor test cannot see. Truncated 4096 -> 200 with the
      // cursor at 100: `size > cursor`, so a cursor-only test reads ordinary
      // growth and the mirror ingests the tail of a DIFFERENT file with no gap
      // row — the silent skip D6 forbids, and the reason
      // `lifecycle_generations.size` is a column that is read back.
      const r = frameRead(100, 'a\n', 200, 4096);
      expect(r.shrank).toBe(true);
      expect(r.nextCursor).toBe(0);
      expect(r.lines).toEqual([]);
    });

    it('does not call an unchanged size a shrink, and does not call growth one either', () => {
      expect(frameRead(100, '', 100, 100).shrank).toBe(false);
      expect(frameRead(100, 'a\n', 4096, 100).shrank).toBe(false);
    });
  });
  ```

- [ ] **Step 3: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/mirrorplan.test.ts
  ```
  Expected: `Error: Failed to load url ../src/coord/mirrorplan.js`.

- [ ] **Step 4: Write it.** Create `server/src/coord/mirrorplan.ts`:
  ```ts
  /**
   * L1: pure, clock-free where it can be (`nowMs` is an INPUT), `fs`-free,
   * fastify-free. It DECIDES what the sweep should do; `mirror.ts` does it.
   *
   * The ring rule this file must keep: no `./db.js`, no `node:sqlite`, and no
   * `store.db` receiver — `single-definition.test.ts`'s coord-ring scan fails
   * the build on any of the three. The names of the journal's files and its
   * ordering are L0's (`LC_DIR_NAME`, `LC_GEN_PREFIX`, `LC_GEN_SUFFIX`,
   * `LC_ERRORS_NAME`, `looksLikeGenerationFile`, `parseLifecycleGeneration`,
   * `compareGenerations`); this file imports them and declares none of them.
   */

  /** What one `readFileFrom` answer means. */
  export interface FramedRead {
    /** The COMPLETE lines in this payload, in order. Blank lines are dropped:
     *  `_lc_emit` writes one `printf '%s\n'` per event, so a blank line carries
     *  no event, and its bytes are still stepped over by `nextCursor`. */
    readonly lines: readonly string[];
    /** The BYTE offset just past the last complete line. `Buffer.byteLength`,
     *  never `String.length` — `hookstate.ts:150` takes the same care with its
     *  own cap, and a multibyte `--reason` would otherwise shift every later
     *  cursor by the difference between chars and bytes. */
    readonly nextCursor: number;
    /** The generation got SMALLER than we last measured it: a truncation on an
     *  immutably-named file. The caller records `gap{reason:'shrank'}` and
     *  re-reads from 0; `uid` dedupes what comes back, so only genuinely-lost
     *  bytes are lost. Separate from an empty payload, which is a cursor at EOF
     *  and a positive answer — two conditions a caller handles differently must
     *  not collapse to one value. */
    readonly shrank: boolean;
  }

  /**
   * FRAMING IS COMPLETE INSIDE ONE CALL (spec D5). `readFileFrom` returns
   * `[cursor, size)` in one shot; a trailing partial line is not consumed and
   * the cursor advances only to the end of the last complete line. There is no
   * cross-call carry buffer anywhere in the mirror, so there is no splice class.
   *
   * `lastSize` is the size the LAST SUCCESSFUL READ reported for this
   * generation, straight off `lifecycle_generations.size`. It is the second half
   * of the shrink test and not decoration: `size < cursor` catches a truncation
   * below the cursor, and `size < lastSize` catches one ABOVE it — a file cut
   * from 4096 to 200 while the cursor sits at 100 is ordinary growth to a
   * cursor-only test, and ingesting its tail as if it were the same file is the
   * silent skip D6 forbids.
   */
  export function frameRead(
    cursor: number, data: string, size: number, lastSize: number,
  ): FramedRead {
    if (size < cursor || size < lastSize) return { lines: [], nextCursor: 0, shrank: true };
    const lastLf = data.lastIndexOf('\n');
    if (lastLf < 0) return { lines: [], nextCursor: cursor, shrank: false };
    const complete = data.slice(0, lastLf + 1);
    return {
      lines: complete.split('\n').slice(0, -1).filter((l) => l !== ''),
      nextCursor: cursor + Buffer.byteLength(complete, 'utf8'),
      shrank: false,
    };
  }
  ```

- [ ] **Step 5: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/mirrorplan.test.ts
  ```

- [ ] **Step 6: Mutant check — consume the partial tail.** Change `const complete = data.slice(0, lastLf + 1);` to `const complete = data;` and the split to `complete.split('\n').filter((l) => l !== '')`; re-run step 5.
  Mutant: consume the trailing partial line -> this test fails with `AssertionError: expected [ 'a', 'bb', 'ccc' ] to deeply equal [ 'a', 'bb' ]` and `expected 108 to be 105`. Restore.

- [ ] **Step 7: Mutant check — count characters.** Change `Buffer.byteLength(complete, 'utf8')` to `complete.length`; re-run step 5.
  Mutant: measure the cursor in characters -> this test fails with `AssertionError: expected 21 to be 24` in `counts BYTES, not characters`. Restore.

- [ ] **Step 8: Mutant check — test the cursor only.** Change the guard to `if (size < cursor) return { lines: [], nextCursor: 0, shrank: true };`; re-run step 5.
  Mutant: drop the `size < lastSize` disjunct -> this test fails with `AssertionError: expected false to be true` in `calls a shrink a shrink EVEN WHEN THE NEW SIZE IS STILL AHEAD OF THE CURSOR`. Restore.

- [ ] **Step 9: Commit.**
  ```bash
  git add server/src/coord/mirrorplan.ts server/test/mirrorplan.test.ts server/test/lifecycleHelpers.ts && git commit -m "feat(coord): frameRead — one-call framing, no carry buffer, shrink above the cursor (build9 W4, D5/D6)"
  ```

---
### Task 31: `mirrorplan.ts` — `planSweep`, and the gap that is recorded rather than skipped

**Files:**
- Modify `server/src/coord/mirrorplan.ts` (append)
- Modify `server/test/mirrorplan.test.ts` (append)

**Interfaces:**
- Consumes, from `shared/api.js` (wave 1): `looksLikeGenerationFile(name: string): boolean`, `parseLifecycleGeneration(name: string): string | null`, `compareGenerations(a: string, b: string): number`, `LC_ERRORS_NAME` (`'errors'`), `LC_ROTATE_LOCK_NAME` (`'.rotate.lock'`), type `LifecycleGapReason`. The first two are a PAIR and the distinction is load-bearing: `looksLike && !parse` is a generation the mirror cannot ORDER (a hole); `!looksLike` is not a generation at all (ignore). `compareGenerations` orders by MAGNITUDE — a plain `.sort()` puts a 20-digit name before a 19-digit one, which is the exact bug it exists to prevent.
- Consumes, from this file (Task 30): nothing.
- Produces:
  ```ts
  export interface KnownGeneration {
    readonly gen: string; readonly cursor: number; readonly size: number; readonly retired: boolean;
  }
  export interface PlannedGap {
    readonly gen: string; readonly reason: LifecycleGapReason; readonly detail: string;
    readonly lostFrom: number | null; readonly lostTo: number | null;
  }
  export interface SweepPlan {
    readonly listed: boolean;
    readonly reads: readonly { readonly gen: string; readonly from: number; readonly lastSize: number }[];
    readonly gaps: readonly PlannedGap[];
    readonly retire: readonly string[];
    readonly unorderable: readonly string[];
  }
  export function planSweep(names: readonly string[] | null, known: readonly KnownGeneration[]): SweepPlan;
  ```

- [ ] **Step 1: Write the failing test.** Append to `server/test/mirrorplan.test.ts`:
  ```ts
  import { planSweep, type KnownGeneration } from '../src/coord/mirrorplan.js';
  import { LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX } from '../../shared/api.js';
  import { genFile } from './lifecycleHelpers.js';

  const G1 = '1755780000000000000';
  const G2 = '1755790000000000000';
  const known = (over: Partial<KnownGeneration> = {}): KnownGeneration =>
    ({ gen: G1, cursor: 0, size: 0, retired: false, ...over });

  describe('planSweep: an unlistable directory is a FAIL-SHUT, not an empty fleet', () => {
    it('plans nothing and retires nothing when readdir answered null', () => {
      const p = planSweep(null, [known({ cursor: 10, size: 400 })]);
      expect(p.listed).toBe(false);
      expect(p.reads).toEqual([]);
      expect(p.gaps).toEqual([]);
      expect(p.retire).toEqual([]);     // an agent WS drop must not retire a live generation
      expect(p.unorderable).toEqual([]);
    });
  });

  describe('planSweep: reads', () => {
    it('ignores every name in the directory that is not a generation', () => {
      const p = planSweep([LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME, 'README', genFile(G1)], []);
      expect(p.reads).toEqual([{ gen: G1, from: 0, lastSize: 0 }]);
      expect(p.unorderable).toEqual([]);
    });

    it('reads a generation it has never seen from offset 0, oldest first', () => {
      const p = planSweep([genFile(G2), genFile(G1), LC_ERRORS_NAME], []);
      expect(p.reads).toEqual([
        { gen: G1, from: 0, lastSize: 0 }, { gen: G2, from: 0, lastSize: 0 },
      ]);
    });

    it('orders by MAGNITUDE, not lexicographically — a 20-digit name is newer, not older', () => {
      // The bug `compareGenerations` exists to prevent: `.sort()` puts
      // '10000000000000000000' before '9999999999999999999', so the live
      // generation reads as an old one and the mirror ingests a stale file
      // forever.
      const big = '10000000000000000000';
      const small = '9999999999999999999';
      expect(planSweep([genFile(big), genFile(small)], []).reads.map((r) => r.gen))
        .toEqual([small, big]);
    });

    it('resumes a known generation at its cursor AND carries its last measured size', () => {
      const p = planSweep([genFile(G1)], [known({ cursor: 410, size: 4096 })]);
      expect(p.reads).toEqual([{ gen: G1, from: 410, lastSize: 4096 }]);
    });

    it('re-reads a generation that came BACK after being retired, and records no new gap', () => {
      const p = planSweep([genFile(G1)], [known({ cursor: 410, size: 410, retired: true })]);
      expect(p.reads).toEqual([{ gen: G1, from: 410, lastSize: 410 }]);
      expect(p.gaps).toEqual([]);
    });
  });

  describe('planSweep: a rotated-away generation is a RECORDED GAP, never a silent skip', () => {
    it('records the undrained bytes and retires the generation', () => {
      const p = planSweep([genFile(G2)], [known({ cursor: 100, size: 4096 })]);
      expect(p.retire).toEqual([G1]);
      expect(p.gaps).toHaveLength(1);
      expect(p.gaps[0]).toMatchObject({
        gen: G1, reason: 'rotated-away', lostFrom: 100, lostTo: 4096,
      });
      expect(p.gaps[0]!.detail).toContain('3996');
    });

    it('retires a FULLY DRAINED generation with no gap — nothing was lost', () => {
      const p = planSweep([genFile(G2)], [known({ cursor: 4096, size: 4096 })]);
      expect(p.retire).toEqual([G1]);
      expect(p.gaps).toEqual([]);
    });

    it('does not re-record a gap for a generation already retired', () => {
      const p = planSweep([genFile(G2)], [known({ cursor: 100, size: 4096, retired: true })]);
      expect(p.gaps).toEqual([]);
      expect(p.retire).toEqual([]);
    });
  });

  describe('planSweep: a name that LOOKS like a generation but cannot be ORDERED', () => {
    it('names it rather than reading it or ignoring it — it is a hole, not an absence', () => {
      // `looksLikeGenerationFile` true, `parseLifecycleGeneration` null: the
      // mirror saw a file it cannot place in the sequence. Reading it would put
      // it in the wrong place; ignoring it would be the silent skip D6 forbids.
      // The caller records ONE gap per name per process (`JournalMirror`).
      const broken = `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`;
      const p = planSweep([broken, genFile(G1)], []);
      expect(p.unorderable).toEqual([broken]);
      expect(p.reads).toEqual([{ gen: G1, from: 0, lastSize: 0 }]);
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/mirrorplan.test.ts
  ```
  Expected: `SyntaxError: The requested module '../src/coord/mirrorplan.js' does not provide an export named 'planSweep'`.

- [ ] **Step 3: Write it.** Append to `server/src/coord/mirrorplan.ts`:
  ```ts
  import {
    compareGenerations, looksLikeGenerationFile, parseLifecycleGeneration,
    type LifecycleGapReason,
  } from '../../../shared/api.js';

  /** One generation as the mirror last left it. */
  export interface KnownGeneration {
    readonly gen: string;
    readonly cursor: number;
    readonly size: number;
    readonly retired: boolean;
  }

  export interface PlannedGap {
    readonly gen: string;
    readonly reason: LifecycleGapReason;
    readonly detail: string;
    readonly lostFrom: number | null;
    readonly lostTo: number | null;
  }

  export interface SweepPlan {
    /** False when `readdir` answered null. NOTHING is read and — the half that
     *  matters — nothing is RETIRED: a dropped agent socket is not evidence
     *  that a generation was rotated away, and it is the same fail-shut
     *  direction `sweepDivergences` takes on its own registry listing. A field
     *  rather than an empty array, because the two are different facts. */
    readonly listed: boolean;
    /** Oldest generation first. `lastSize` is what `lifecycle_generations.size`
     *  said, and `frameRead` needs it to see a truncation that stayed ahead of
     *  the cursor. */
    readonly reads: readonly { readonly gen: string; readonly from: number; readonly lastSize: number }[];
    readonly gaps: readonly PlannedGap[];
    readonly retire: readonly string[];
    /** Names that LOOK like generations and cannot be ORDERED
     *  (`looksLikeGenerationFile` true, `parseLifecycleGeneration` null). Not
     *  read — placing them in the sequence is exactly what cannot be done — and
     *  not ignored either. The caller turns each into ONE gap row per process;
     *  a row per sweep would be an alarm that fires every five seconds, which is
     *  an alarm nobody reads. */
    readonly unorderable: readonly string[];
  }

  /**
   * A rotation is "a new name appeared", never "the same file got smaller" —
   * which is the reason the generation lives in the filename (D1). So a
   * generation that stops being listed can only have been rotated away, and the
   * only question left is whether the mirror had finished draining it.
   *
   * A DRAINED generation that disappears records no gap: `_lc_rotate` deletes
   * oldest-first and only ever removes a generation that stopped growing when
   * the live one was minted, so `cursor === size` means there was nothing left
   * to lose. DISCLOSED RESIDUAL: bytes appended to a drained generation and
   * rotated away inside one sweep interval would be lost unrecorded. That
   * cannot happen while `_lc_rotate` mints rather than appends, and the
   * alternative — a gap row on every ordinary rotation — is an alarm that fires
   * when nothing is wrong.
   */
  export function planSweep(
    names: readonly string[] | null, known: readonly KnownGeneration[],
  ): SweepPlan {
    if (names === null) {
      return { listed: false, reads: [], gaps: [], retire: [], unorderable: [] };
    }

    const unorderable = names.filter(
      (nm) => looksLikeGenerationFile(nm) && parseLifecycleGeneration(nm) === null,
    );
    // TWO QUESTIONS, TWO READERS (wave 1's own rule for this pair): "is it a
    // generation at all" and "can it be ordered". Only names that answer yes to
    // both are read; the ones that answer yes-then-no are reported above.
    const present = [...new Set(
      names.map(parseLifecycleGeneration).filter((g): g is string => g !== null),
    )].sort(compareGenerations);
    const presentSet = new Set(present);

    const gaps: PlannedGap[] = [];
    const retire: string[] = [];
    for (const k of known) {
      if (presentSet.has(k.gen) || k.retired) continue;
      retire.push(k.gen);
      if (k.cursor >= k.size) continue;
      gaps.push({
        gen: k.gen, reason: 'rotated-away',
        detail: `generation ${k.gen} stopped being listed with ${k.size - k.cursor} byte(s) undrained`,
        lostFrom: k.cursor, lostTo: k.size,
      });
    }

    const byGen = new Map(known.map((k) => [k.gen, k]));
    return {
      listed: true,
      reads: present.map((gen) => {
        const k = byGen.get(gen);
        return { gen, from: k?.cursor ?? 0, lastSize: k?.size ?? 0 };
      }),
      gaps, retire, unorderable,
    };
  }
  ```

- [ ] **Step 4: Run it and see it pass, with the ring scan beside it.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/mirrorplan.test.ts test/single-definition.test.ts
  ```
  `single-definition` is run HERE rather than at the end of the wave because this is the task that would have re-declared `.lifecycle`, `journal-`, `.ndjson` and a private generation regex — the four values wave 1 already owns.

- [ ] **Step 5: Mutant check — treat an unlistable directory as empty.** Change the null guard to `if (names === null) names = [];`; re-run step 4.
  Mutant: fold `readdir === null` into "no generations" -> this test fails with `AssertionError: expected [ '1755780000000000000' ] to deeply equal []` on `p.retire` in `plans nothing and retires nothing when readdir answered null` — a dropped socket would have retired a live generation and recorded a fabricated gap. Restore.

- [ ] **Step 6: Mutant check — skip the gap silently.** Delete the `gaps.push({...})` block; re-run step 4.
  Mutant: rotate a generation away without a row -> this test fails with `AssertionError: expected [] to have a length of 1 but got +0` in `records the undrained bytes and retires the generation`. Restore.

- [ ] **Step 7: Mutant check — sort the generation names as strings.** Change `.sort(compareGenerations)` to `.sort()`; re-run step 4.
  Mutant: lexicographic ordering -> this test fails with `AssertionError: expected [ '10000000000000000000', '9999999999999999999' ] to deeply equal [ '9999999999999999999', '10000000000000000000' ]` in `orders by MAGNITUDE, not lexicographically`. Restore.

- [ ] **Step 8: Commit.**
  ```bash
  git add server/src/coord/mirrorplan.ts server/test/mirrorplan.test.ts && git commit -m "feat(coord): planSweep — rotated-away gaps recorded, unlistable fails shut, L0 names (build9 W4, D1/D6)"
  ```

---

### Task 32: `mirrorplan.ts` — `lifecycleState`, the one reader of `lifecycle-v1`

**Files:**
- Modify `server/src/coord/mirrorplan.ts` (append)
- Modify `server/test/mirrorplan.test.ts` (append)

**Interfaces:**
- Consumes: type `LifecycleHealthState` from `shared/api.js` (Task 28) — `'ok' | 'stale' | 'unavailable' | 'unknown'`.
- Produces:
  ```ts
  export const LC_CAP_TOKEN = 'lifecycle-v1';
  export function lifecycleState(input: {
    readonly ccdVerbs: readonly string[] | null;
    readonly lastOkAt: number | null;
    readonly nowMs: number;
    readonly staleAfterMs: number;
  }): LifecycleHealthState;
  export function shouldSweep(state: LifecycleHealthState): boolean;
  ```
  `staleAfterMs` is an INPUT, not a constant read here. The window is three sweep intervals and `LC_SWEEP_MS` lives in `server/src/watch.ts` (L4); an L3 file importing it would be a `coord/` -> `watch.ts` cycle.

- [ ] **Step 1: Write the failing test.** Append to `server/test/mirrorplan.test.ts`:
  ```ts
  import { lifecycleState, shouldSweep, LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';

  const st = (over: Partial<Parameters<typeof lifecycleState>[0]> = {}) => lifecycleState({
    ccdVerbs: ['ws-rm', LC_CAP_TOKEN], lastOkAt: 1_000_000, nowMs: 1_002_000, staleAfterMs: 15_000,
    ...over,
  });

  describe("lifecycleState: an old ccd's silence must not read as a quiet fleet", () => {
    it('says `unavailable` when caps were measured and lifecycle-v1 is not among them', () => {
      expect(st({ ccdVerbs: ['ws-rm', 'stop-surface'] })).toBe('unavailable');
    });

    it('degrades a NULL caps list to the sweep\'s own freshness — never to `unavailable`', () => {
      // `ccdVerbs === null` is local mode, or an agent old enough not to send a
      // list. `verbSupported`'s own default permits on no evidence for the same
      // reason: an absent list must never grey out the fleet. Here the cost of
      // guessing wrong is one readdir per sweep.
      expect(st({ ccdVerbs: null })).toBe('ok');
    });

    it('says `unknown` when there is no caps evidence AND no sweep has succeeded', () => {
      expect(st({ ccdVerbs: null, lastOkAt: null })).toBe('unknown');
    });

    it('says `unknown` before any sweep has succeeded', () => {
      expect(st({ lastOkAt: null })).toBe('unknown');
    });

    it('says `ok` inside the staleness window and `stale` outside it', () => {
      expect(st({ nowMs: 1_014_999 })).toBe('ok');
      expect(st({ nowMs: 1_015_000 })).toBe('stale');
    });

    it('does not call a FUTURE-dated lastOk fresh', () => {
      // The `>= 0` guard `sessionLifecycle` carries for the identical reason —
      // without it a skewed clock reads fresh forever.
      expect(st({ nowMs: 999_000 })).toBe('stale');
    });
  });

  describe('shouldSweep', () => {
    it('sweeps on every state except a MEASURED absence of the capability', () => {
      expect(shouldSweep('unavailable')).toBe(false);
      for (const s of ['ok', 'stale', 'unknown'] as const) expect(shouldSweep(s)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/mirrorplan.test.ts
  ```
  Expected: `SyntaxError: The requested module '../src/coord/mirrorplan.js' does not provide an export named 'lifecycleState'`.

- [ ] **Step 3: Write it.** Append to `server/src/coord/mirrorplan.ts`:
  ```ts
  import type { LifecycleHealthState } from '../../../shared/api.js';

  /**
   * THE ONE READER of this token in the whole server, and it stays one: wave 6
   * lands `capSupported(state, token)` in `ccdargv.ts` with the flag threading
   * that needs it, and this call site becomes its first caller then. A second
   * `verbs.includes('lifecycle-v1')` anywhere before that is a copy.
   *
   * Caps tokens negotiate a SERVER DECISION, not a file (spec §5): `lifecycle-v1`
   * decides "sweep at all".
   */
  export const LC_CAP_TOKEN = 'lifecycle-v1';

  /**
   * PURE, and deliberately clock-free: `nowMs` and `staleAfterMs` are inputs, so
   * the whole table is testable with no timers and this L1 file needs nothing
   * from `watch.ts`.
   *
   * THE NO-EVIDENCE DEFAULT IS NOT `unavailable`, and the three-way split is the
   * point. `unavailable` is a MEASURED absence — ccd answered `caps` and the
   * token was not there — and an operator may act on it. A null caps list is NO
   * EVIDENCE, so it degrades to whatever the sweep's own freshness says;
   * `unknown` is not knowing, and a reader must stay silent on it, exactly as
   * `FleetHealth.roster`'s own docstring requires of its third state.
   */
  export function lifecycleState(input: {
    readonly ccdVerbs: readonly string[] | null;
    readonly lastOkAt: number | null;
    readonly nowMs: number;
    readonly staleAfterMs: number;
  }): LifecycleHealthState {
    if (input.ccdVerbs !== null && !input.ccdVerbs.includes(LC_CAP_TOKEN)) return 'unavailable';
    if (input.lastOkAt === null) return 'unknown';
    const age = input.nowMs - input.lastOkAt;
    // `age >= 0` is not a style tic: without it a future-dated stamp stays
    // "< staleAfterMs" for the life of the process and reads fresh forever.
    // `sessionLifecycle` carries the identical guard, and states why at length.
    return age >= 0 && age < input.staleAfterMs ? 'ok' : 'stale';
  }

  /** Sweep on everything but a measured absence of the capability. `unknown` is
   *  no evidence, and the cost of guessing wrong there is one `readdir` per
   *  sweep that answers null — `verbSupported`'s permit-on-no-evidence trade,
   *  not `stopSurfaceSupported`'s inverted one, because the wrong guess here
   *  costs a cheap failed read rather than a silent success. */
  export function shouldSweep(state: LifecycleHealthState): boolean {
    return state !== 'unavailable';
  }
  ```

- [ ] **Step 4: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/mirrorplan.test.ts
  ```

- [ ] **Step 5: Mutant check — collapse no-evidence into `unavailable`.** Change the first line of `lifecycleState` to `if (input.ccdVerbs === null || !input.ccdVerbs.includes(LC_CAP_TOKEN)) return 'unavailable';`; re-run step 4.
  Mutant: treat a null caps list as a measured absence -> this test fails with `AssertionError: expected 'unavailable' to be 'ok'` in `degrades a NULL caps list to the sweep's own freshness`, and `shouldSweep` would then silence the mirror on every local-mode box. Restore.

- [ ] **Step 6: Mutant check — drop the `>= 0` guard.** Change to `return age < input.staleAfterMs ? 'ok' : 'stale';`; re-run step 4.
  Mutant: allow a future-dated `lastOk` -> this test fails with `AssertionError: expected 'ok' to be 'stale'` in `does not call a FUTURE-dated lastOk fresh`. Restore.

- [ ] **Step 7: Commit.**
  ```bash
  git add server/src/coord/mirrorplan.ts server/test/mirrorplan.test.ts && git commit -m "feat(coord): lifecycleState — measured absence, no evidence and stale are three words (build9 W4)"
  ```

---
### Task 33: `CoordStore` — the writes: `ingestJournal`, `recordGap`, `retireGeneration`

**Files:**
- Modify `server/src/coord/store.ts` — one new import line after `:3`; `type LifecycleGapReason,` added to the existing `shared/api.js` block at `:4-10`; `JournalGeneration` declared immediately above `export class CoordStore` (`:240`); the methods appended before the class's closing `}` at `:1702`
- Create `server/test/lifecycle-store.test.ts`

**Interfaces:**
- Consumes: `JournalRow` from `./journalparse.js` (Task 29); `tx` from `./db.js` (already imported at `store.ts:2`); type `LifecycleGapReason` from `shared/api.js` (Task 28). `CoordStore`'s constructor is `constructor(readonly db: DatabaseSync) {}` (`store.ts:241`) — `s.db` is public, so a test may reach it; `store.ts` is one of the five HANDLE_HOLDERS the coord-ring scan exempts.
- Produces:
  ```ts
  export interface JournalGeneration {
    gen: string; firstSeenAt: number; lastSweepAt: number;
    cursor: number; size: number; retired: boolean;
  }
  // on CoordStore:
  journalGenerations(): JournalGeneration[]
  ingestJournal(input: { readonly gen: string; readonly rows: readonly JournalRow[];
                         readonly cursor: number; readonly size: number; readonly at: number }): number
  recordGap(g: { readonly at: number; readonly gen: string; readonly reason: LifecycleGapReason;
                 readonly detail: string; readonly lostFrom: number | null;
                 readonly lostTo: number | null }): void
  retireGeneration(gen: string, at: number): void
  ```

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-store.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import path from 'node:path';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
  import { mkTmp } from './tmpHelpers.js';
  import { LIFECYCLE_ACTS, LC_ACT_UNKNOWN } from '../../shared/api.js';

  const store = (): CoordStore =>
    new CoordStore(openCoordDb(path.join(mkTmp('ccrc-lc-'), '.ccrc', 'coord.db')));

  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const GEN = '1755780000000000000';

  const row = (uid: string, over: Record<string, unknown> = {}): JournalRow =>
    parseJournalLine(JSON.stringify({
      uid, at: 1_755_780_000_123, act: AN_ACT, outcome: 'done',
      verb: 'ws-rm', id: 'demo-quiet-basin', ...over,
    }));

  describe('CoordStore.ingestJournal', () => {
    it('inserts the rows and advances the cursor, and reports how many landed', () => {
      const s = store();
      const n = s.ingestJournal({ gen: GEN, rows: [row('a.1.1'), row('a.1.2')], cursor: 220, size: 220, at: 9 });
      expect(n).toBe(2);
      expect(s.journalGenerations()).toEqual([
        { gen: GEN, firstSeenAt: 9, lastSweepAt: 9, cursor: 220, size: 220, retired: false },
      ]);
    });

    it('is idempotent on the UID — a replay is no-op-or-catch-up (D6)', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 110, at: 9 });
      const again = s.ingestJournal({ gen: GEN, rows: [row('a.1.1'), row('a.1.2')], cursor: 220, size: 220, at: 11 });
      expect(again).toBe(1);
      expect((s.db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(2);
    });

    it('re-ingests from offset 0 without duplicating anything — the cursor is an OPTIMISATION', () => {
      const s = store();
      const rows = [row('a.1.1'), row('a.1.2')];
      s.ingestJournal({ gen: GEN, rows, cursor: 220, size: 220, at: 9 });
      expect(s.ingestJournal({ gen: GEN, rows, cursor: 220, size: 220, at: 12 })).toBe(0);
      expect((s.db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(2);
    });

    it('THE CURSOR NEVER ADVANCES PAST UNCOMMITTED ROWS', () => {
      // Both halves in ONE tx(). Force a bind failure half way through the row
      // loop and assert that NEITHER the rows NOR the cursor landed. The shipped
      // rollback behaviour is already pinned at `coord-db.test.ts:255-266`.
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 110, at: 9 });
      const poison = { ...row('a.1.2'), raw: (Symbol('unbindable') as unknown as string) };
      expect(() => s.ingestJournal({
        gen: GEN, rows: [row('a.1.2'), poison], cursor: 330, size: 330, at: 11,
      })).toThrow();
      expect((s.db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(1);
      expect(s.journalGenerations()[0]!.cursor, 'the cursor moved past rows that never committed').toBe(110);
    });

    it('inserts an UNPARSEABLE line rather than dropping it, with `raw` verbatim', () => {
      const s = store();
      const junk = 'ws-rm demo-quiet-basin   # not json at all';
      s.ingestJournal({ gen: GEN, rows: [parseJournalLine(junk)], cursor: 42, size: 42, at: 9 });
      const got = s.db.prepare('SELECT act, uid, raw FROM lifecycle_events').all() as
        { act: string; uid: string | null; raw: string }[];
      expect(got).toEqual([{ act: LC_ACT_UNKNOWN, uid: null, raw: junk }]);
    });

    it('stores `detail` and `truncated` so a dropped family is not read as an absent one', () => {
      const s = store();
      s.ingestJournal({
        gen: GEN, cursor: 110, size: 110, at: 9,
        rows: [row('a.1.1', { detail: 'held: program:build8 wave:2/4', truncated: true })],
      });
      const got = s.db.prepare('SELECT detail, truncated FROM lifecycle_events').get() as
        { detail: string | null; truncated: number };
      expect(got).toEqual({ detail: 'held: program:build8 wave:2/4', truncated: 1 });
    });
  });

  describe('CoordStore.recordGap / retireGeneration', () => {
    it('records a gap and retires the generation, leaving the row behind', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 4096, at: 9 });
      s.recordGap({ at: 20, gen: GEN, reason: 'rotated-away',
                    detail: 'undrained', lostFrom: 110, lostTo: 4096 });
      s.retireGeneration(GEN, 20);
      expect(s.journalGenerations()[0]!.retired).toBe(true);
      // RETIRE, NEVER DELETE: the cursor and size are the evidence behind the gap.
      expect(s.journalGenerations()[0]).toMatchObject({ cursor: 110, size: 4096 });
      const gaps = s.db.prepare('SELECT gen, reason, lostFrom, lostTo FROM lifecycle_gaps').all();
      expect(gaps).toEqual([{ gen: GEN, reason: 'rotated-away', lostFrom: 110, lostTo: 4096 }]);
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-store.test.ts
  ```
  Expected: `TypeError: s.ingestJournal is not a function`.

- [ ] **Step 3: Extend `store.ts`'s imports.** Add `type LifecycleGapReason,` to the existing `import { ... } from '../../../shared/api.js';` block at `:4-10`, and add ONE new import line after `:3`:
  ```ts
  import type { JournalRow } from './journalparse.js';
  ```

- [ ] **Step 4: Add the exported row type** immediately above `export class CoordStore` (`store.ts:240`):
  ```ts
  /** One row of `lifecycle_generations`. `retired` is a boolean here and an
   *  INTEGER in the column — the narrowing happens once, in
   *  `journalGenerations`, so no caller ever sees SQLite's 0/1. */
  export interface JournalGeneration {
    gen: string; firstSeenAt: number; lastSweepAt: number;
    cursor: number; size: number; retired: boolean;
  }
  ```

- [ ] **Step 5: Write the methods.** Insert immediately before the final `}` of `class CoordStore` (`store.ts:1702`):
  ```ts
    /* ── the lifecycle journal mirror (build 9) ────────────────────────────── */

    /**
     * Every generation this mirror has ever seen, retired ones included — the
     * retired rows are what make "this generation was rotated away with N bytes
     * undrained" answerable a year later.
     */
    journalGenerations(): JournalGeneration[] {
      const rows = this.db.prepare(
        'SELECT gen, firstSeenAt, lastSweepAt, cursor, size, retired ' +
        'FROM lifecycle_generations ORDER BY gen',
      ).all() as (Omit<JournalGeneration, 'retired'> & { retired: number })[];
      return rows.map((r) => ({ ...r, retired: r.retired !== 0 }));
    }

    /**
     * ONE TRANSACTION FOR THE ROWS AND THE CURSOR, and that is the whole of D6's
     * "the cursor is an optimisation, never a correctness input": it is advanced
     * only inside the same `tx()` as the rows it covers, so it can never move
     * past uncommitted data. A cursor hoisted out of here — even one line above
     * the loop, in its own transaction — is the mutant `lifecycle-store.test.ts`
     * exists to kill.
     *
     * `INSERT OR IGNORE` against the two partial unique indexes is what makes
     * idempotency INTRINSIC rather than positional: a parsed line dedupes on its
     * own `uid`, and a uid-less one on its bytes within its generation. Neither
     * is a function of where in the file the line happened to sit, so re-reading
     * a generation from offset 0 is always no-op-or-catch-up.
     *
     * Returns how many rows actually LANDED — the caller logs nothing on 0,
     * which is the ordinary answer for a sweep that only advanced a cursor.
     */
    ingestJournal(input: {
      readonly gen: string;
      readonly rows: readonly JournalRow[];
      readonly cursor: number;
      readonly size: number;
      readonly at: number;
    }): number {
      return tx(this.db, () => {
        const ins = this.db.prepare(
          'INSERT OR IGNORE INTO lifecycle_events ' +
          '(uid, gen, at, ingestedAt, act, badact, outcome, verb, sessionId, tx, refusal, ' +
          'detail, truncated, obsJson, decJson, measJson, raw) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        let inserted = 0;
        for (const r of input.rows) {
          const res = ins.run(
            r.uid, input.gen, r.at, input.at, r.act, r.badact, r.outcome, r.verb,
            r.sessionId, r.tx, r.refusal, r.detail, r.truncated ? 1 : 0,
            r.obs === null ? null : JSON.stringify(r.obs),
            r.dec === null ? null : JSON.stringify(r.dec),
            r.meas === null ? null : JSON.stringify(r.meas),
            r.raw,
          );
          inserted += Number(res.changes);
        }
        this.db.prepare(
          'INSERT INTO lifecycle_generations (gen, firstSeenAt, lastSweepAt, cursor, size, retired) ' +
          'VALUES (?, ?, ?, ?, ?, 0) ' +
          'ON CONFLICT(gen) DO UPDATE SET lastSweepAt = excluded.lastSweepAt, ' +
          'cursor = excluded.cursor, size = excluded.size, retired = 0',
        ).run(input.gen, input.at, input.at, input.cursor, input.size);
        return inserted;
      });
    }

    /** A hole in the mirror, recorded rather than skipped (D6). Never pruned:
     *  the gap outlives the generation it is about, which is the only reason it
     *  is worth writing down. */
    recordGap(g: {
      readonly at: number; readonly gen: string; readonly reason: LifecycleGapReason;
      readonly detail: string; readonly lostFrom: number | null; readonly lostTo: number | null;
    }): void {
      this.db.prepare(
        'INSERT INTO lifecycle_gaps (at, gen, reason, detail, lostFrom, lostTo) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
      ).run(g.at, g.gen, g.reason, g.detail, g.lostFrom, g.lostTo);
    }

    /** RETIRE, NEVER DELETE. A retired generation's cursor and size are the
     *  evidence behind its gap row; destroying them would destroy the record of
     *  what was lost, which is the same mistake `ws-restore` made until wave 3. */
    retireGeneration(gen: string, at: number): void {
      this.db.prepare(
        'UPDATE lifecycle_generations SET retired = 1, lastSweepAt = ? WHERE gen = ?',
      ).run(at, gen);
    }
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-store.test.ts
  ```

- [ ] **Step 7: Mutant check — hoist the cursor out of the transaction.** Move the `INSERT INTO lifecycle_generations … ON CONFLICT …` statement so it runs *before* `return tx(this.db, () => {`; re-run step 6.
  Mutant: advance the cursor outside the row transaction -> this test fails with `AssertionError: the cursor moved past rows that never committed: expected 330 to be 110`. Restore.

- [ ] **Step 8: Mutant check — drop `OR IGNORE`.** Change to a plain `INSERT INTO lifecycle_events`; re-run step 6.
  Mutant: rely on the caller never replaying -> this test fails with `SqliteError: UNIQUE constraint failed: index 'lifecycle_uid'` in `is idempotent on the UID` — loud, which is the backstop working, but it means a replay would abort the sweep. Restore.

- [ ] **Step 9: Commit.**
  ```bash
  git add server/src/coord/store.ts server/test/lifecycle-store.test.ts && git commit -m "feat(coord): ingestJournal — rows and cursor in ONE tx, OR IGNORE on uid (build9 W4, D6)"
  ```

---
### Task 34: `CoordStore` — the reads: `lifecycleFor`, `lifecycleGaps`, `lifecycleStats`, `recentProvenance`

**Files:**
- Modify `server/src/coord/store.ts` (imports at `:3-10`; `ProvenancePair` + `jsonOrNull` beside `JournalGeneration` above `:240`; the methods appended after Task 33's `retireGeneration`)
- Modify `server/test/lifecycle-store.test.ts` (append)

**Interfaces:**
- Consumes: `reviveObs`, `reviveDec`, `reviveMeas` from `./journalparse.js` (Task 29); from `shared/api.js` — `isLifecycleAct`, `isLifecycleOutcome`, `isLifecycleGapReason`, `LC_ACT_UNKNOWN`, `LC_OUTCOME_UNKNOWN`, and the types `MirroredLifecycleEvent`, `LifecycleGap`.
- Produces:
  ```ts
  export interface ProvenancePair {
    readonly id: string; readonly at: number | null;
    readonly obsClass: string; readonly decSurface: string;
  }
  // on CoordStore:
  static readonly LIFECYCLE_PAGE_MAX = 500
  lifecycleFor(q: { readonly sessionId?: string | null; readonly limit?: number }): MirroredLifecycleEvent[]
  lifecycleGaps(limit?: number): LifecycleGap[]
  lifecycleStats(): { rows: number; oldestAt: number | null; newestAt: number | null;
                      generations: number; gaps: number }
  recentProvenance(sinceAt: number, limit: number): ProvenancePair[]
  ```
  **`ProvenancePair.id`, never `sessionId`.** The column is `sessionId` (because `id` is the table's autoincrement key); the CROSSING type spells it `id`, and the SQL aliases it. This is the one type that names the wire/derived rename in both directions, and its docstring says so.

- [ ] **Step 1: Write the failing test.** Append to `server/test/lifecycle-store.test.ts`:
  ```ts
  describe('CoordStore.lifecycleFor', () => {
    it("answers one session's timeline oldest-first, and nobody else's", () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [
        row('a.1', { id: 'demo-quiet-basin', at: 100 }),
        row('a.2', { id: 'other-session',    at: 110 }),
        row('a.3', { id: 'demo-quiet-basin', at: 120 }),
      ], cursor: 300, size: 300, at: 9 });
      const got = s.lifecycleFor({ sessionId: 'demo-quiet-basin', limit: 50 });
      expect(got.map((e) => e.uid)).toEqual(['a.1', 'a.3']);
      expect(got[0]!.id).toBe('demo-quiet-basin');   // the row says sessionId, the wire says id
      expect(got[0]!.ingestedAt).toBe(9);
      expect(got[0]!.gen).toBe(GEN);
      expect(got[0]!.truncated).toBe(false);
    });

    it('keeps the NEWEST n when limited, still returned oldest-first', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: ['a.1', 'a.2', 'a.3', 'a.4'].map((u) => row(u)),
                        cursor: 400, size: 400, at: 9 });
      expect(s.lifecycleFor({ limit: 2 }).map((e) => e.uid)).toEqual(['a.3', 'a.4']);
    });

    it('clamps a limit it was never going to honour, and survives a NaN', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1')], cursor: 110, size: 110, at: 9 });
      expect(s.lifecycleFor({ limit: 99_999 })).toHaveLength(1);
      expect(s.lifecycleFor({ limit: Number.NaN })).toHaveLength(1);
    });

    it('reads an act token this build does not know as `unknown`, never as a raw string', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1')], cursor: 110, size: 110, at: 9 });
      s.db.prepare('UPDATE lifecycle_events SET act = ?, outcome = ? WHERE uid = ?')
        .run('quarantine', 'partially', 'a.1');
      const e = s.lifecycleFor({ limit: 10 })[0]!;
      expect(e.act).toBe(LC_ACT_UNKNOWN);
      expect(e.outcome).toBe('unknown');
      expect(e.raw).toContain('"uid":"a.1"');   // the bytes survive the degrade
    });

    it('revives the three families as three objects, or null where the line carried none', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1', {
        obs: { cg: 'supervisor', cgraw: '0::/x', pid: 7 },
        dec: { surface: 'pwa', actor: 'nobody', reason: 'r' },
      })], cursor: 110, size: 110, at: 9 });
      const e = s.lifecycleFor({ limit: 10 })[0]!;
      expect(e.obs).toMatchObject({ cg: 'supervisor', cgraw: '0::/x', pid: 7, ppid: null });
      expect(e.dec).toMatchObject({ surface: 'pwa', actor: 'nobody' });
      expect(e.meas).toBeNull();
    });
  });

  describe('CoordStore.lifecycleStats and lifecycleGaps', () => {
    it('reports the horizon, the newest event, and the counts', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('a.1', { at: 100 }), row('a.2', { at: 300 })],
                        cursor: 220, size: 220, at: 9 });
      s.recordGap({ at: 20, gen: GEN, reason: 'shrank', detail: 'truncated',
                    lostFrom: 0, lostTo: 100 });
      expect(s.lifecycleStats()).toEqual({
        rows: 2, oldestAt: 100, newestAt: 300, generations: 1, gaps: 1,
      });
      expect(s.lifecycleGaps(10)).toEqual([{
        at: 20, gen: GEN, reason: 'shrank', detail: 'truncated', lostFrom: 0, lostTo: 100,
      }]);
    });

    it('reads a gap reason this build does not know as `unknown`', () => {
      const s = store();
      s.recordGap({ at: 20, gen: GEN, reason: 'shrank', detail: 'd', lostFrom: null, lostTo: null });
      s.db.prepare('UPDATE lifecycle_gaps SET reason = ?').run('vacuumed');
      expect(s.lifecycleGaps(10)[0]!.reason).toBe('unknown');
    });
  });

  describe('CoordStore.recentProvenance', () => {
    it('returns only rows carrying BOTH an observed class and a declared surface', () => {
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [
        row('a.1', { at: 500, obs: { cg: 'pane' }, dec: { surface: 'agent' } }),
        row('a.2', { at: 500, obs: { cg: 'pane' } }),                    // no dec
        row('a.3', { at: 500, dec: { surface: 'agent' } }),              // no obs
        row('a.4', { at: 100, obs: { cg: 'pane' }, dec: { surface: 'agent' } }),  // too old
      ], cursor: 400, size: 400, at: 9 });
      expect(s.recentProvenance(200, 50)).toEqual([
        { id: 'demo-quiet-basin', at: 500, obsClass: 'pane', decSurface: 'agent' },
      ]);
    });

    it('DROPS a row whose class or surface is not even a string — unmodellable is not a disagreement', () => {
      // A newer ccd writing `"cg": 7`, or a hand-edited row. `json_extract`
      // answers whatever the JSON held, and an adapter that cast it would hand
      // `corroboration` a value it cannot narrow — the "an adapter may not
      // narrow a distinction it received" rule, inverted.
      const s = store();
      s.ingestJournal({ gen: GEN, rows: [row('b.1', { at: 500 })], cursor: 110, size: 110, at: 9 });
      s.db.prepare("UPDATE lifecycle_events SET obsJson = '{\"cg\":7}', decJson = '{\"surface\":\"cli\"}'")
        .run();
      expect(() => s.recentProvenance(200, 50)).not.toThrow();
      expect(s.recentProvenance(200, 50)).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-store.test.ts
  ```
  Expected: `TypeError: s.lifecycleFor is not a function`.

- [ ] **Step 3: Extend the imports.** In `server/src/coord/store.ts`, add `isLifecycleAct, isLifecycleOutcome, isLifecycleGapReason, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,` to the value imports and `type LifecycleGap, type MirroredLifecycleEvent,` to the type imports in the `shared/api.js` block (`:4-10`), and change Task 33's `./journalparse.js` line to:
  ```ts
  import { reviveDec, reviveMeas, reviveObs, type JournalRow } from './journalparse.js';
  ```

- [ ] **Step 4: Add the crossing type and the module helper.** Beside `JournalGeneration`, above `export class CoordStore` (`store.ts:240`):
  ```ts
  /**
   * One `(observed class, declared surface)` pair off a lifecycle row — the only
   * type that crosses the L1/L3 seam carrying two of the three identity
   * families, and the one place their two legitimate spellings are reconciled.
   *
   * THE WIRE/JOURNAL FIELDS ARE `obs.cg` AND `dec.surface`; the DERIVED PAIR is
   * `obsClass`/`decSurface`, matching `corroboration(obsClass, decSurface)`'s own
   * parameter names. Both spellings are correct at their own layer; this
   * docstring is what stops a later reader "fixing" either one. Likewise `id`:
   * the COLUMN is `sessionId` (because `id` is `lifecycle_events`' autoincrement
   * key) and the SQL below aliases it back.
   *
   * Both strings are RAW. Narrowing them is `corroboration`'s job and
   * `divergence.ts`'s call, and this type must not pre-empt it by claiming they
   * are members of anything.
   */
  export interface ProvenancePair {
    readonly id: string;
    readonly at: number | null;
    readonly obsClass: string;
    readonly decSurface: string;
  }

  /** JSON text out of a column back to `unknown`, or null. Never throws: a
   *  column this process wrote can still be a column an older build wrote. */
  const jsonOrNull = (s: string | null): unknown => {
    if (s === null) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  ```

- [ ] **Step 5: Write the reads.** Append inside `class CoordStore`, after Task 33's `retireGeneration`:
  ```ts
    /** Bounded like `FEED_RETENTION` is, and for the same reason: a route that
     *  can be asked for the whole table is a route that can be asked for 90 MB. */
    static readonly LIFECYCLE_PAGE_MAX = 500;

    /** The column list, named ONCE. `SELECT *` is banned in this directory —
     *  naming every column is exactly what makes "an older build ignores unknown
     *  columns" true rather than aspirational. */
    private static readonly LC_COLS =
      'id, uid, gen, at, ingestedAt, act, badact, outcome, verb, sessionId, tx, refusal, ' +
      'detail, truncated, obsJson, decJson, measJson, raw';

    /**
     * One session's past tense, oldest-first, newest-`limit` window.
     *
     * ORDERED BY THIS TABLE'S OWN `id`, NEVER BY `at`. `at` is CCD's clock and is
     * nullable; `id` is monotonic across a generation rotation. `feed_events`
     * already relies on the identical argument for `GET /api/feed`.
     */
    lifecycleFor(q: { readonly sessionId?: string | null; readonly limit?: number }): MirroredLifecycleEvent[] {
      const raw = q.limit ?? CoordStore.LIFECYCLE_PAGE_MAX;
      const n = Number.isFinite(raw) && raw > 0
        ? Math.min(Math.floor(raw), CoordStore.LIFECYCLE_PAGE_MAX)
        : CoordStore.LIFECYCLE_PAGE_MAX;
      const c = CoordStore.LC_COLS;
      const rows = (q.sessionId
        ? this.db.prepare(
            `SELECT ${c} FROM (SELECT ${c} FROM lifecycle_events WHERE sessionId = ? ` +
            'ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
          ).all(q.sessionId, n)
        : this.db.prepare(
            `SELECT ${c} FROM (SELECT ${c} FROM lifecycle_events ORDER BY id DESC LIMIT ?) ` +
            'ORDER BY id ASC',
          ).all(n)) as {
            uid: string | null; gen: string; at: number | null; ingestedAt: number;
            act: string; badact: string | null; outcome: string;
            verb: string | null; sessionId: string | null; tx: string | null;
            refusal: string | null; detail: string | null; truncated: number;
            obsJson: string | null; decJson: string | null; measJson: string | null; raw: string;
          }[];
      return rows.map((r) => ({
        uid: r.uid, gen: r.gen, at: r.at, ingestedAt: r.ingestedAt,
        // Through the guards, never a cast — the same discipline `feedEvents`
        // gives `kind` and `programs()` gives `state`. A token a NEWER build
        // wrote lands somewhere honest, and `raw` still carries the bytes.
        act: isLifecycleAct(r.act) ? r.act : LC_ACT_UNKNOWN,
        badact: r.badact,
        outcome: isLifecycleOutcome(r.outcome) ? r.outcome : LC_OUTCOME_UNKNOWN,
        verb: r.verb,
        // The COLUMN is `sessionId`; the WIRE event is `id`. One rename,
        // declared in `journalparse.ts` and undone here — see `ProvenancePair`.
        id: r.sessionId,
        tx: r.tx, refusal: r.refusal, detail: r.detail,
        truncated: r.truncated !== 0,
        // The SAME revivers the parser used on the way in: one definition, both
        // directions, and each returns a literal so a family gaining a field is
        // a compile error rather than a silently-dropped one.
        obs: reviveObs(jsonOrNull(r.obsJson)),
        dec: reviveDec(jsonOrNull(r.decJson)),
        meas: reviveMeas(jsonOrNull(r.measJson)),
        raw: r.raw,
      }));
    }

    /** The holes, newest-first — a timeline with a hole in it says so. */
    lifecycleGaps(limit = 100): LifecycleGap[] {
      const n = Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), CoordStore.LIFECYCLE_PAGE_MAX)
        : 100;
      const rows = this.db.prepare(
        'SELECT at, gen, reason, detail, lostFrom, lostTo FROM lifecycle_gaps ORDER BY id DESC LIMIT ?',
      ).all(n) as {
        at: number; gen: string; reason: string; detail: string;
        lostFrom: number | null; lostTo: number | null;
      }[];
      return rows.map((r) => ({
        at: r.at, gen: r.gen,
        reason: isLifecycleGapReason(r.reason) ? r.reason : 'unknown',
        detail: r.detail, lostFrom: r.lostFrom, lostTo: r.lostTo,
      }));
    }

    /** What `/api/fleet/health` reports so the operator sees the growth coming
     *  (D8). `oldestAt` IS the reconstruction horizon: below it the mirror holds
     *  history the flat file no longer does. `AS n` and not `AS rows` — `ROWS`
     *  is a SQLite window-frame keyword and only parses here as a fallback
     *  identifier. */
    lifecycleStats(): {
      rows: number; oldestAt: number | null; newestAt: number | null;
      generations: number; gaps: number;
    } {
      const e = this.db.prepare(
        'SELECT count(*) AS n, MIN(at) AS oldestAt, MAX(at) AS newestAt FROM lifecycle_events',
      ).get() as { n: number; oldestAt: number | null; newestAt: number | null };
      const g = this.db.prepare('SELECT count(*) AS c FROM lifecycle_generations').get() as { c: number };
      const p = this.db.prepare('SELECT count(*) AS c FROM lifecycle_gaps').get() as { c: number };
      return { rows: e.n, oldestAt: e.oldestAt, newestAt: e.newestAt, generations: g.c, gaps: p.c };
    }

    /**
     * The pairs `divergence.provenance-mismatch` weighs — rows carrying BOTH a
     * kernel-observed actor class and a declared surface. NOTHING IS DECIDED
     * HERE: `corroboration()` (L0) is the only function allowed to relate the
     * families, and `divergence.ts` is where it is called. This is a read.
     *
     * `json_extract` rather than a second column pair: the families ride as JSON
     * precisely because they never merge, and two more columns would be two more
     * places for a newer ccd's field to be dropped.
     *
     * MAPPED, NOT CAST. `json_extract` answers whatever the JSON held — a
     * number, a boolean, a null — and `as unknown as ProvenancePair[]` would
     * launder that past the only narrowing door there is. A row whose class or
     * surface is not a string cannot be modelled AS A PAIR, and an unmodellable
     * value is not a disagreement, so it is dropped here rather than raised
     * downstream.
     */
    recentProvenance(sinceAt: number, limit: number): ProvenancePair[] {
      const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 500;
      const rows = this.db.prepare(
        "SELECT sessionId AS id, at, json_extract(obsJson, '$.cg') AS obsClass, " +
        "json_extract(decJson, '$.surface') AS decSurface FROM lifecycle_events " +
        'WHERE sessionId IS NOT NULL AND obsJson IS NOT NULL AND decJson IS NOT NULL ' +
        // `lifecycle_events.id`, QUALIFIED: `id` is now an output alias for
        // `sessionId`, and SQLite resolves a bare `ORDER BY id` to the alias —
        // which would order this window by session name instead of by arrival.
        'AND at IS NOT NULL AND at >= ? ORDER BY lifecycle_events.id DESC LIMIT ?',
      ).all(sinceAt, n) as {
        id: string; at: number | null; obsClass: unknown; decSurface: unknown;
      }[];
      return rows.flatMap((r) => (
        typeof r.obsClass === 'string' && typeof r.decSurface === 'string'
          ? [{ id: r.id, at: r.at, obsClass: r.obsClass, decSurface: r.decSurface }]
          : []
      ));
    }
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-store.test.ts test/single-definition.test.ts
  ```

- [ ] **Step 7: Mutant check — cast the act instead of guarding it.** Change `act: isLifecycleAct(r.act) ? r.act : LC_ACT_UNKNOWN,` to `act: r.act as LifecycleAct,`; re-run step 6.
  Mutant: cast the column instead of narrowing it -> this test fails with `AssertionError: expected 'quarantine' to be 'unknown'` in `reads an act token this build does not know as 'unknown'`. Restore.

- [ ] **Step 8: Mutant check — launder the provenance rows through a double cast.** Replace the `flatMap` with `.all(sinceAt, n) as unknown as ProvenancePair[];`; re-run step 6.
  Mutant: `as unknown as ProvenancePair[]` -> this test fails with `AssertionError: expected [ { id: 'demo-quiet-basin', at: 500, obsClass: 7, decSurface: 'cli' } ] to deeply equal []` in `DROPS a row whose class or surface is not even a string`. Restore.

- [ ] **Step 9: Commit.**
  ```bash
  git add server/src/coord/store.ts server/test/lifecycle-store.test.ts && git commit -m "feat(coord): lifecycleFor/Gaps/Stats/recentProvenance — guarded reads, no SELECT *, no casts (build9 W4)"
  ```

---
### Task 35: `mirror.ts` — `JournalMirror`, the L3 executor

**Files:**
- Create `server/src/coord/mirror.ts`
- Create `server/test/lifecycle-mirror.test.ts`

**Interfaces:**
- Consumes: `FleetIO` from `../io.js` — the two members this file uses are `readdir(path): Promise<string[] | null>`, `readFileFrom(path, offset): Promise<{ data: string; size: number } | null>` and `readFileMeasured(path): Promise<{ ok: true; content: string } | { ok: false; reason: 'absent' | 'unreadable' }>`; `CoordStore` (type only) from `./store.js`; `frameRead`, `planSweep`, `lifecycleState`, `shouldSweep` from `./mirrorplan.js`; `parseJournalLine`, `JournalRow` from `./journalparse.js`; from `shared/api.js` — `LC_DIR_NAME`, `LC_ERRORS_NAME`, `LC_GEN_PREFIX`, `LC_GEN_SUFFIX`, type `LifecycleHealth`.
- Produces:
  ```ts
  export interface MirrorDeps {
    readonly io: FleetIO;
    readonly registryDir: string;
    readonly store: CoordStore;
    readonly ccdVerbs: () => readonly string[] | null;
    readonly now: () => number;
    readonly staleAfterMs: number;
  }
  export class JournalMirror {
    constructor(deps: MirrorDeps);
    sweep(): Promise<void>;      // never throws, never rejects
    health(): LifecycleHealth;
  }
  ```
  **No `LC_STALE_AFTER_MS` here.** The window is `LC_SWEEP_MS * 3` and `LC_SWEEP_MS` lives in `server/src/watch.ts` (L4); an L3 file importing L4 would be a `coord/` -> `watch.ts` cycle. It arrives as `staleAfterMs`, from the one construction site.

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-mirror.test.ts`:
  ```ts
  // L3: the mirror EXECUTES `mirrorplan`'s decisions over `FleetIO`. It runs
  // against `localIO` under a fixture HOME — a real directory, real bytes, real
  // partial writes — because the seam it has to get right is the one between a
  // read that returned bytes and a read that returned null.
  import { describe, it, expect } from 'vitest';
  import fs from 'node:fs';
  import path from 'node:path';
  import { localIO, type FleetIO } from '../src/io.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { JournalMirror } from '../src/coord/mirror.js';
  import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
  import { genFile } from './lifecycleHelpers.js';
  import { mkTmp } from './tmpHelpers.js';
  import {
    LC_ACT_UNKNOWN, LC_DIR_NAME, LC_ERRORS_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LIFECYCLE_ACTS,
  } from '../../shared/api.js';

  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const G1 = '1755780000000000000';
  const G2 = '1755790000000000000';
  const STALE_AFTER = 15_000;

  const line = (uid: string, over: Record<string, unknown> = {}): string => JSON.stringify({
    uid, at: 1_755_780_000_123, act: AN_ACT, outcome: 'done', id: 'demo-quiet-basin', ...over,
  });

  interface Rig { mirror: JournalMirror; store: CoordStore; dir: string; registryDir: string; now: { v: number } }

  const rig = (io: FleetIO = localIO, verbs: readonly string[] | null = ['ws-rm', LC_CAP_TOKEN]): Rig => {
    const home = mkTmp('ccrc-mirror-');
    const registryDir = path.join(home, '.cc-sessions');
    const dir = path.join(registryDir, LC_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const store = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const now = { v: 1_000_000 };
    return {
      store, dir, registryDir, now,
      mirror: new JournalMirror({
        io, registryDir, store, ccdVerbs: () => verbs, now: () => now.v, staleAfterMs: STALE_AFTER,
      }),
    };
  };

  describe('JournalMirror.sweep', () => {
    it('ingests one generation and remembers where it stopped', async () => {
      const r = rig();
      const body = `${line('a.1')}\n${line('a.2')}\n`;
      fs.writeFileSync(path.join(r.dir, genFile(G1)), body);
      await r.mirror.sweep();
      expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'a.2']);
      expect(r.store.journalGenerations()[0]).toMatchObject({
        gen: G1, cursor: Buffer.byteLength(body, 'utf8'), retired: false,
      });
    });

    it('LEAVES A PARTIAL TRAILING LINE ALONE and picks it up once it is finished', async () => {
      const r = rig();
      const f = path.join(r.dir, genFile(G1));
      const whole = line('a.1');
      fs.writeFileSync(f, `${whole}\n${line('a.2').slice(0, 20)}`);
      await r.mirror.sweep();
      expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1']);
      expect(r.store.journalGenerations()[0]!.cursor).toBe(Buffer.byteLength(`${whole}\n`, 'utf8'));

      fs.writeFileSync(f, `${whole}\n${line('a.2')}\n`);
      r.now.v += 5000;
      await r.mirror.sweep();
      expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'a.2']);
    });

    it('INSERTS an unparseable line as act:unknown with `raw` verbatim', async () => {
      const r = rig();
      const junk = 'ws-rm demo-quiet-basin  # a child wrote into the log';
      fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n${junk}\n`);
      await r.mirror.sweep();
      const got = r.store.lifecycleFor({ limit: 50 });
      expect(got.map((e) => e.act)).toEqual([AN_ACT, LC_ACT_UNKNOWN]);
      expect(got[1]!.raw).toBe(junk);
    });

    it('RECORDS a gap when a generation is rotated away undrained', async () => {
      const r = rig();
      const f1 = path.join(r.dir, genFile(G1));
      fs.writeFileSync(f1, `${line('a.1')}\n`);
      await r.mirror.sweep();
      // Append past the drained cursor, then rotate the file away entirely.
      fs.appendFileSync(f1, `${line('a.2')}\n`);
      fs.rmSync(f1);
      fs.writeFileSync(path.join(r.dir, genFile(G2)), `${line('b.1')}\n`);
      r.now.v += 5000;
      await r.mirror.sweep();
      const gaps = r.store.lifecycleGaps(10);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toMatchObject({ gen: G1, reason: 'rotated-away' });
      expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'b.1']);
    });

    it('RECORDS a gap on a shrink and re-reads the whole generation in the SAME sweep', async () => {
      const r = rig();
      const f = path.join(r.dir, genFile(G1));
      fs.writeFileSync(f, `${line('a.1')}\n${line('a.2')}\n`);
      await r.mirror.sweep();
      fs.writeFileSync(f, `${line('a.2')}\n`);          // truncated in place
      r.now.v += 5000;
      await r.mirror.sweep();
      expect(r.store.lifecycleGaps(10)[0]).toMatchObject({ gen: G1, reason: 'shrank' });
      // `uid` dedupes, so a.2 is not doubled and a.1 survives from the first pass
      expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'a.2']);
    });

    it('records a gap for a name it cannot ORDER — ONCE, not once per sweep', async () => {
      const r = rig();
      const broken = `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`;
      fs.writeFileSync(path.join(r.dir, broken), `${line('x.1')}\n`);
      fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
      await r.mirror.sweep();
      r.now.v += 5000;
      await r.mirror.sweep();
      const gaps = r.store.lifecycleGaps(10);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toMatchObject({ reason: 'unknown', lostFrom: null, lostTo: null });
      // The orderable generation is still read; one bad name does not stall the lane.
      expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1']);
    });

    it('advances NOTHING when the directory cannot be listed — no loss, no reset dance', async () => {
      const r = rig();
      fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
      await r.mirror.sweep();
      const blind: FleetIO = { ...localIO, readdir: async () => null };
      const m2 = new JournalMirror({
        io: blind, registryDir: r.registryDir, store: r.store,
        ccdVerbs: () => ['ws-rm', LC_CAP_TOKEN], now: () => r.now.v + 5000, staleAfterMs: STALE_AFTER,
      });
      await m2.sweep();
      expect(r.store.journalGenerations()[0]!.retired).toBe(false);
      expect(r.store.lifecycleGaps(10)).toEqual([]);
    });

    it('does not sweep at all when ccd does not advertise lifecycle-v1', async () => {
      const r = rig(localIO, ['ws-rm', 'stop-surface']);
      fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
      await r.mirror.sweep();
      expect(r.store.lifecycleFor({ limit: 50 })).toEqual([]);
      expect(r.mirror.health().state).toBe('unavailable');
    });

    it('never throws, whatever the io does', async () => {
      const boom: FleetIO = {
        ...localIO,
        readdir: async () => { throw new Error('agent went away mid-readdir'); },
      };
      const r = rig(boom);
      await expect(r.mirror.sweep()).resolves.toBeUndefined();
    });
  });

  describe('JournalMirror.health', () => {
    it('reports the counts, the horizon, the server clock and the ccd-side error tally', async () => {
      const r = rig();
      fs.writeFileSync(path.join(r.dir, genFile(G1)),
        `${line('a.1', { at: 100 })}\n${line('a.2', { at: 300 })}\n`);
      fs.writeFileSync(path.join(r.dir, LC_ERRORS_NAME), '4\n');
      await r.mirror.sweep();
      expect(r.mirror.health()).toEqual({
        state: 'ok', newestAt: 300, horizon: 100, rows: 2,
        generations: 1, gaps: 0, writeErrors: 4, lastOk: 1_000_000,
      });
    });

    it('says writeErrors null when the counter has never been written — 0 would be a measured zero', async () => {
      const r = rig();
      fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
      await r.mirror.sweep();
      expect(r.mirror.health().writeErrors).toBeNull();
    });

    it('says `unknown` before any sweep has run', () => {
      expect(rig().mirror.health().state).toBe('unknown');
    });

    it('goes `stale` once three sweep intervals pass with no successful sweep', async () => {
      const r = rig();
      await r.mirror.sweep();
      expect(r.mirror.health().state).toBe('ok');
      r.now.v += STALE_AFTER;
      expect(r.mirror.health().state).toBe('stale');
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-mirror.test.ts
  ```
  Expected: `Error: Failed to load url ../src/coord/mirror.js`.

- [ ] **Step 3: Write it.** Create `server/src/coord/mirror.ts`:
  ```ts
  import path from 'node:path';
  import {
    LC_DIR_NAME, LC_ERRORS_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, type LifecycleHealth,
  } from '../../../shared/api.js';
  import type { FleetIO } from '../io.js';
  import { parseJournalLine, type JournalRow } from './journalparse.js';
  import { frameRead, lifecycleState, planSweep, shouldSweep } from './mirrorplan.js';
  import type { CoordStore } from './store.js';

  /**
   * L3. It EXECUTES `mirrorplan`'s decisions over `FleetIO` and writes them
   * through `CoordStore`; it decides nothing itself, and it holds no database
   * handle (the coord-ring scan in `single-definition.test.ts` forbids one here
   * and forbids a `store.db` receiver too).
   *
   * POLL, DO NOT TAIL (spec D5). Three of the four architect drafts reached for
   * `tailOpen`/`tailClose` and every judge found a silent-loss bug in some
   * draft's tail seam — `resync()` jumping to EOF, `agent/src/tail.ts:53-58`
   * handing the reader a reset it must model, a carry buffer shared between a
   * backfill and a live stream. Lifecycle acts run ~100/day; paying a permanent
   * silent-loss risk for latency nobody will perceive is a bad trade. This rides
   * `FleetWatcher`'s EXISTING tick.
   *
   * THE MIRROR HOLDS NO SUBSCRIPTION. If the agent WS drops mid-sweep,
   * `readdir`/`readFileFrom` answer null, no cursor advances, and the next tick
   * resumes at the same offset — no loss, no duplicates, no reset dance.
   */
  export interface MirrorDeps {
    readonly io: FleetIO;
    readonly registryDir: string;
    readonly store: CoordStore;
    /** Re-read every sweep, not captured: the agent can reconnect with a
     *  different ccd under it, and a mirror that latched the boot-time answer
     *  would stay silent through a deploy that fixed exactly this. */
    readonly ccdVerbs: () => readonly string[] | null;
    readonly now: () => number;
    /** Three sweep intervals — one missed sweep is not an alarm, three is. Same
     *  four-heartbeat reasoning `SUPERVISED_FRESH_MS` states for the supervisor
     *  stamp, one notch tighter because this lane has no jitter. An INPUT
     *  because `LC_SWEEP_MS` lives in `watch.ts` (L4) and this file is L3. */
    readonly staleAfterMs: number;
  }

  export class JournalMirror {
    private lastOkAt: number | null = null;
    /** `null` = the counter file has never been written by ccd. `0` is a
     *  MEASURED zero, and the two must not share a value (D7's mitigation is
     *  only a mitigation if the operator can tell "no errors recorded" from
     *  "never looked"). */
    private writeErrors: number | null = null;
    /** Names that look like generations and cannot be ordered, already recorded.
     *  ONE gap row per name per process: the condition is standing, and a row
     *  every five seconds is an alarm nobody reads. */
    private readonly unorderableSeen = new Set<string>();

    constructor(private deps: MirrorDeps) {}

    private dir(): string { return path.join(this.deps.registryDir, LC_DIR_NAME); }

    /**
     * NEVER THROWS and never rejects — `FleetWatcher` void-dispatches it, and
     * one bad sweep must not kill the poll. Every failure degrades to "no
     * progress this pass", which the next tick retries from the same cursor.
     */
    async sweep(): Promise<void> {
      try { await this.run(); } catch { /* one bad sweep must not kill the poll */ }
    }

    private async run(): Promise<void> {
      if (!shouldSweep(this.state())) return;
      const dir = this.dir();
      const names = await this.deps.io.readdir(dir);
      const known = this.deps.store.journalGenerations();
      const plan = planSweep(names, known);
      // FAIL SHUT. A directory we could not list is not evidence that a
      // generation was rotated away — the same direction `sweepDivergences`
      // takes on its own registry listing, and the reason `listed` is a field
      // rather than an empty array.
      if (!plan.listed) return;

      const at = this.deps.now();
      for (const g of plan.gaps) {
        this.deps.store.recordGap({ at, gen: g.gen, reason: g.reason, detail: g.detail,
                                    lostFrom: g.lostFrom, lostTo: g.lostTo });
      }
      for (const gen of plan.retire) this.deps.store.retireGeneration(gen, at);
      for (const name of plan.unorderable) {
        if (this.unorderableSeen.has(name)) continue;
        this.unorderableSeen.add(name);
        this.deps.store.recordGap({
          at, gen: name, reason: 'unknown',
          detail: `${name} is named like a generation (${LC_GEN_PREFIX}…${LC_GEN_SUFFIX}) but ` +
            'carries no orderable stamp, so the mirror cannot place it in the sequence and ' +
            'will not read it',
          lostFrom: null, lostTo: null,
        });
      }

      for (const r of plan.reads) await this.drain(dir, r.gen, r.from, r.lastSize, at);

      this.writeErrors = await this.readErrors(dir);
      this.lastOkAt = at;
    }

    /** One generation, one pass — and at most TWO reads: the second happens only
     *  when the first proved a truncation, which is the one condition under
     *  which the offset we asked from was wrong. */
    private async drain(
      dir: string, gen: string, from: number, lastSize: number, at: number,
    ): Promise<void> {
      const file = path.join(dir, `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`);
      const first = await this.deps.io.readFileFrom(file, from);
      if (first === null) return;                       // unreadable; retry next tick
      const framed = frameRead(from, first.data, first.size, lastSize);
      if (!framed.shrank) {
        this.commit(gen, framed.lines, framed.nextCursor, first.size, at);
        return;
      }
      // A TRUNCATION on an immutably-named generation. Record it, then re-read
      // from 0: `uid` dedupes what comes back, so only the genuinely-lost bytes
      // are lost — and the loss is a ROW, not a silence. `lostTo` is the LARGER
      // of the cursor and the last measured size, because a file cut to a length
      // still ahead of the cursor lost bytes above it.
      this.deps.store.recordGap({
        at, gen, reason: 'shrank',
        detail: `generation ${gen} shrank to ${first.size} bytes from ${Math.max(from, lastSize)} ` +
          '— truncated in place',
        lostFrom: first.size, lostTo: Math.max(from, lastSize),
      });
      const second = await this.deps.io.readFileFrom(file, 0);
      if (second === null) {
        // The cursor still has to leave the far side of the file, or every later
        // sweep re-records the same gap. Nothing was read, so nothing is ingested.
        this.commit(gen, [], 0, first.size, at);
        return;
      }
      const re = frameRead(0, second.data, second.size, 0);
      this.commit(gen, re.lines, re.nextCursor, second.size, at);
    }

    private commit(gen: string, lines: readonly string[], cursor: number, size: number, at: number): void {
      const rows: JournalRow[] = lines.map(parseJournalLine);
      this.deps.store.ingestJournal({ gen, rows, cursor, size, at });
    }

    /** `$REG/.lifecycle/errors` — ccd's own counted append failures (D7). Read,
     *  reported, and NEVER acted on: the journal is best-effort and never gates
     *  an act, and the errors file is the mitigation, not a kill switch. THREE
     *  CONDITIONS: absent (ccd has never written the counter — `null`),
     *  unreadable (keep the last measurement rather than manufacturing one), and
     *  a number. */
    private async readErrors(dir: string): Promise<number | null> {
      const r = await this.deps.io.readFileMeasured(path.join(dir, LC_ERRORS_NAME));
      if (!r.ok) return r.reason === 'absent' ? null : this.writeErrors;
      const n = Number(r.content.trim());
      return Number.isFinite(n) && n >= 0 ? n : null;
    }

    private state(): LifecycleHealth['state'] {
      return lifecycleState({
        ccdVerbs: this.deps.ccdVerbs(), lastOkAt: this.lastOkAt,
        nowMs: this.deps.now(), staleAfterMs: this.deps.staleAfterMs,
      });
    }

    health(): LifecycleHealth {
      const s = this.deps.store.lifecycleStats();
      return {
        state: this.state(),
        newestAt: s.newestAt, horizon: s.oldestAt, rows: s.rows,
        generations: s.generations, gaps: s.gaps,
        writeErrors: this.writeErrors, lastOk: this.lastOkAt,
      };
    }
  }
  ```

- [ ] **Step 4: Run it and see it pass, with the ring scan beside it.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-mirror.test.ts test/single-definition.test.ts
  ```

- [ ] **Step 5: Mutant check — treat an unlistable directory as empty.** In `mirrorplan.ts`, change `planSweep`'s null arm to `if (names === null) names = [];`; re-run step 4.
  Mutant: fold `readdir === null` into "no generations" -> this test fails with `AssertionError: expected [ { gen: '1755780000000000000', reason: 'rotated-away', … } ] to deeply equal []` in `advances NOTHING when the directory cannot be listed`. Restore.

- [ ] **Step 6: Mutant check — skip the re-read after a shrink.** Delete the second `readFileFrom(file, 0)` block and `return` straight after recording the gap; re-run step 4.
  Mutant: record the shrink and stop -> this test fails with `AssertionError: expected [ 'a.1' ] to deeply equal [ 'a.1', 'a.2' ]` in `RECORDS a gap on a shrink and re-reads the whole generation in the SAME sweep`. Restore.

- [ ] **Step 7: Mutant check — let a bad sweep escape.** Change `sweep()` to `async sweep(): Promise<void> { await this.run(); }`; re-run step 4.
  Mutant: stop swallowing io faults -> this test fails with `Error: agent went away mid-readdir` in `never throws, whatever the io does`. Restore.

- [ ] **Step 8: Mutant check — re-record the unorderable name every sweep.** Delete the `unorderableSeen` guard (both the `if` and the `add`); re-run step 4.
  Mutant: one gap row per sweep for a standing condition -> this test fails with `AssertionError: expected [ …2 gaps… ] to have a length of 1 but got 2` in `records a gap for a name it cannot ORDER — ONCE, not once per sweep`. Restore.

- [ ] **Step 9: Commit.**
  ```bash
  git add server/src/coord/mirror.ts server/test/lifecycle-mirror.test.ts && git commit -m "feat(coord): JournalMirror — poll not tail, gaps recorded, fails shut (build9 W4, D5/D6/D7)"
  ```

---
### Task 36: `lifecycle-replay.test.ts` — the re-measurement drill

**Files:**
- Create `server/test/lifecycle-replay.test.ts`

**Interfaces:**
- Consumes: `JournalMirror`, `MirrorDeps` (Task 35); `CoordStore` (Tasks 33-34); `openCoordDb`; `localIO`; `LC_CAP_TOKEN`; `genFile` from `./lifecycleHelpers.js`; `LC_DIR_NAME`, `LIFECYCLE_ACTS`, `LC_ACT_UNKNOWN` from `shared/api.js`.
- Produces: the executable proof behind D8's "`lifecycle_events` is a RE-MEASUREMENT, provably". No source file changes.
- **This task's RED is measured, not assumed.** Step 2 plants the clock mutant BEFORE the drill is ever seen green, so a drill written vacuously (wrong `COLS`, a snapshot that returns `[]`) cannot read as success. The `toHaveLength(5)` assertion is the second guard.

- [ ] **Step 1: Write the drill.** Create `server/test/lifecycle-replay.test.ts`:
  ```ts
  // D8's claim, executed rather than asserted in a comment: `lifecycle_events` is
  // a RE-MEASUREMENT of the flat file, so losing it and sweeping again must
  // reproduce it EXACTLY — modulo `id` (an autoincrement) and `ingestedAt` (the
  // SERVER'S clock, explicitly labelled as such and never read as an event time).
  //
  // Byte equality rather than resemblance, because `raw` holds the line verbatim.
  import { describe, it, expect } from 'vitest';
  import fs from 'node:fs';
  import path from 'node:path';
  import { localIO } from '../src/io.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { JournalMirror } from '../src/coord/mirror.js';
  import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
  import { genFile } from './lifecycleHelpers.js';
  import { mkTmp } from './tmpHelpers.js';
  import { LC_ACT_UNKNOWN, LC_DIR_NAME, LIFECYCLE_ACTS } from '../../shared/api.js';

  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const G1 = '1755780000000000000';
  const G2 = '1755790000000000000';

  /** A body with every shape the mirror has to model: a full record with all
   *  three families, a refusal with its detail, a line whose act this build does
   *  not declare, and a line that is not JSON at all. */
  const BODY_1 = [
    JSON.stringify({ uid: 'a.1', at: 100, act: AN_ACT, outcome: 'intent', verb: 'ws-rm',
      id: 'demo-quiet-basin', tx: 'a',
      obs: { cg: 'pane', cgraw: '0::/user.slice/session-3.scope', pid: 31415, ppid: 2,
             pane: 'cc-demo', paneWhy: 'ppid-ancestry', tty: true, ssh: null },
      dec: { surface: 'cli', actor: 'you', reason: 'stale wave' },
      meas: { project: 'demo', workspace: 'quiet-basin', branch: 'ws/quiet-basin', uuid: 'u',
              wrapper: 'claude', tip: 'deadbeef', attic: 3, archivedAt: null,
              archivedReason: null, held: null } }),
    JSON.stringify({ uid: 'a.2', at: 110, act: AN_ACT, outcome: 'refused',
      verb: 'ws-rm', id: 'demo-quiet-basin', tx: 'a', refusal: 'held',
      detail: 'held: program:build8 wave:2/4 — release first' }),
    JSON.stringify({ uid: 'a.3', at: 120, act: 'quarantine', outcome: 'done',
      verb: 'ws-rm', id: 'demo-quiet-basin', truncated: true }),
    'ws-rm demo-quiet-basin  # a child wrote into the log',
  ].join('\n') + '\n';

  const BODY_2 = JSON.stringify({ uid: 'b.1', at: 200, act: AN_ACT, outcome: 'done',
    verb: 'forget', id: 'other-session' }) + '\n';

  /** EVERY column except the two that legitimately move. `id` is an
   *  autoincrement; `ingestedAt` is the server's clock and is pinned separately
   *  below, so its exclusion is deliberate rather than quiet. */
  const COLS = 'uid, gen, at, act, badact, outcome, verb, sessionId, tx, refusal, ' +
               'detail, truncated, obsJson, decJson, measJson, raw';

  const snapshot = (s: CoordStore): unknown[] =>
    s.db.prepare(`SELECT ${COLS} FROM lifecycle_events ORDER BY gen, uid, raw`).all();

  const plant = (bodies: readonly (readonly [string, string])[]) => {
    const home = mkTmp('ccrc-replay-');
    const registryDir = path.join(home, '.cc-sessions');
    const dir = path.join(registryDir, LC_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    for (const [gen, body] of bodies) fs.writeFileSync(path.join(dir, genFile(gen)), body);
    const store = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return { home, registryDir, store };
  };

  const mirrorOver = (registryDir: string, store: CoordStore, now: () => number): JournalMirror =>
    new JournalMirror({
      io: localIO, registryDir, store,
      ccdVerbs: () => ['ws-rm', LC_CAP_TOKEN], now, staleAfterMs: 15_000,
    });

  describe('the re-measurement drill (D8)', () => {
    it('reproduces every row byte for byte after the mirror is destroyed and replayed', async () => {
      const w = plant([[G1, BODY_1], [G2, BODY_2]]);
      let now = 1_000_000;
      await mirrorOver(w.registryDir, w.store, () => now).sweep();

      const before = snapshot(w.store);
      expect(before, 'the drill would pass vacuously over an empty table').toHaveLength(5);

      // LOSE THE MIRROR. Both tables: the events AND the cursors, which is what
      // "a lost coord.db reconstructs from the flat files" actually means.
      w.store.db.exec('DELETE FROM lifecycle_events');
      w.store.db.exec('DELETE FROM lifecycle_generations');
      expect(snapshot(w.store)).toEqual([]);

      now += 60_000;                       // a DIFFERENT server clock on replay
      await mirrorOver(w.registryDir, w.store, () => now).sweep();

      expect(snapshot(w.store)).toEqual(before);
      // …and `ingestedAt` is the one value that legitimately moved, which is
      // why it is excluded above rather than quietly ignored.
      expect(w.store.db.prepare('SELECT DISTINCT ingestedAt FROM lifecycle_events').all())
        .toEqual([{ ingestedAt: 1_060_000 }]);
    });

    it('a second sweep with the cursor rewound changes nothing — the cursor is an optimisation', async () => {
      const w = plant([[G1, BODY_1]]);
      let now = 1_000_000;
      const mirror = mirrorOver(w.registryDir, w.store, () => now);
      await mirror.sweep();
      const before = snapshot(w.store);
      expect(before).toHaveLength(4);

      // Wind the cursor back to 0 by hand: re-reading a generation from offset 0
      // must be no-op-or-catch-up, never a duplicate (D6). `size` is wound back
      // with it, or `frameRead` correctly calls the unchanged file a shrink.
      w.store.db.prepare('UPDATE lifecycle_generations SET cursor = 0, size = 0').run();
      now += 5000;
      await mirror.sweep();
      expect(snapshot(w.store)).toEqual(before);
    });
  });
  ```

- [ ] **Step 2: Plant the clock mutant and see the drill go RED.** In `server/src/coord/journalparse.ts`, change `at: n(o, 'at'),` to `at: n(o, 'at') ?? Date.now(),`, then:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-replay.test.ts
  ```
  Mutant: give `parseJournalLine` a clock -> this test fails with `AssertionError: expected [ … ] to deeply equal [ … ]` in `reproduces every row byte for byte`, diffing on the `at` column of the non-JSON line. **This is the task's red measurement** — a drill that passed here would be vacuous.

- [ ] **Step 3: Restore, and see it pass.** Put `at: n(o, 'at'),` back.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-replay.test.ts
  ```

- [ ] **Step 4: Mutant check — stop storing `raw` verbatim.** In `journalparse.ts`, change `raw: line,` to `raw: line.trim(),`; re-run step 3.
  Mutant: normalise the bytes on the way in -> `journalparse.test.ts`'s `empty` case fails with `AssertionError: expected '' to be ''`'s sibling on a padded line, and the drill's `raw` column diverges for any line ccd padded. Restore.

- [ ] **Step 5: Mutant check — dedupe unparseable lines positionally.** In `MIGRATIONS[2]`, change `CREATE UNIQUE INDEX lifecycle_raw_uid ON lifecycle_events(gen, raw)` to `ON lifecycle_events(gen, id)`; re-run step 3.
  Mutant: positional identity for a uid-less line -> this test fails with `AssertionError: expected [ …5 rows… ] to deeply equal [ …4 rows… ]` in `a second sweep with the cursor rewound changes nothing` — the non-JSON line duplicates. Restore.

- [ ] **Step 6: Commit.**
  ```bash
  git add server/test/lifecycle-replay.test.ts && git commit -m "test(coord): the D8 re-measurement drill — replay is byte-identical modulo id/ingestedAt"
  ```

---
### Task 37: `LC_SWEEP_MS`, and the sweep on the EXISTING `FleetWatcher` tick

**Files:**
- Modify `server/src/watch.ts` — `export const LC_SWEEP_MS = 5_000;` immediately after `const DIVERGENCE_SWEEP_MS = 60_000;` (`:60`); one new import; two fields immediately after `private lastDivergenceSweep = 0;` (`:305`); `sweepLifecycle()` + `lifecycleHealth()` inserted after `sweepDivergences`'s closing `}` at `:1618` and BEFORE the `sweepMail` docstring that opens at `:1620`; one dispatch line after `void this.sweepMail().catch(…)` at `:665`
- Create `server/test/lifecycle-sweep.test.ts`

**Interfaces:**
- Consumes: `JournalMirror` from `./coord/mirror.js` (Task 35) — `new JournalMirror({io, registryDir, store, ccdVerbs, now, staleAfterMs})`, `.sweep(): Promise<void>`, `.health(): LifecycleHealth`; `Deps.coord?: CoordStore` (`server.ts:214`), `Deps.io`, `Deps.cfg.registryDir`, `Deps.fleetState?.ccdVerbs: string[] | null` (`fleetstate.ts:39`).
- Produces:
  ```ts
  // server/src/watch.ts, module scope
  export const LC_SWEEP_MS = 5_000;
  // on FleetWatcher
  async sweepLifecycle(): Promise<void>          // public, so a test can await it
  lifecycleHealth(): LifecycleHealth | null
  ```
  `LC_SWEEP_MS` is DEFINED here and imported from `'../src/watch.js'` by anything that needs it. It is not in L0 (wave 1 ruled it out: a server tick-gate with no bash twin and no wire meaning, whose five siblings all live in this file) and it is not in `coord/` (that would be an L3 file importing L4).

- [ ] **Step 1: Write the failing test.** Create `server/test/lifecycle-sweep.test.ts`:
  ```ts
  // The sweep rides the EXISTING tick. Two properties, and the second is the one
  // a reviewer cannot hold in place: no new timer, and `sweepMail` untouched.
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import fs from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { FleetWatcher, LC_SWEEP_MS } from '../src/watch.js';
  import { Bus } from '../src/bus.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
  import { genFile } from './lifecycleHelpers.js';
  import { testDeps } from './helpers.js';
  import { mkTmp } from './tmpHelpers.js';
  import {
    LC_ACT_UNKNOWN, LC_DIR_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LIFECYCLE_ACTS,
  } from '../../shared/api.js';

  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const G1 = '1755780000000000000';
  const NOW = 1_785_300_000_000;

  // `mail-sweep.test.ts:239-245`'s shipped idiom, verbatim: only `Date` is faked,
  // so `fs` and the microtask queue behave. A `vi.setSystemTime` with no
  // `useFakeTimers` throws `Timers are not mocked`.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

  const rig = () => {
    const home = mkTmp('ccrc-lcsweep-');
    const deps = testDeps(home);
    const dir = path.join(deps.cfg.registryDir, LC_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const w = new FleetWatcher(
      { ...deps, coord,
        fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never,
      new Bus(),
    );
    return { w, dir, coord };
  };

  const aLine = (uid: string): string =>
    `${JSON.stringify({ uid, at: 1, act: AN_ACT, outcome: 'done', id: 'demo' })}\n`;

  describe('FleetWatcher.sweepLifecycle', () => {
    it('ingests the journal on the existing tick', async () => {
      const r = rig();
      fs.writeFileSync(path.join(r.dir, genFile(G1)), aLine('a.1'));
      await r.w.sweepLifecycle();
      expect(r.coord.lifecycleFor({ limit: 10 }).map((e) => e.uid)).toEqual(['a.1']);
    });

    it('is GATED — a second call inside LC_SWEEP_MS does no io', async () => {
      const r = rig();
      await r.w.sweepLifecycle();                       // the FIRST sweep always runs
      fs.writeFileSync(path.join(r.dir, genFile(G1)), aLine('a.1'));
      await r.w.sweepLifecycle();
      expect(r.coord.lifecycleFor({ limit: 10 }), 'the gate did not hold').toEqual([]);
      advance(LC_SWEEP_MS + 1);
      await r.w.sweepLifecycle();
      expect(r.coord.lifecycleFor({ limit: 10 }).map((e) => e.uid)).toEqual(['a.1']);
    });

    it('answers a health block once it has swept, and null with no coordination database', async () => {
      const r = rig();
      await r.w.sweepLifecycle();
      expect(r.w.lifecycleHealth()?.state).toBe('ok');
      const bare = new FleetWatcher(testDeps(mkTmp('ccrc-lcsweep-')), new Bus());
      expect(bare.lifecycleHealth()).toBeNull();
    });

    it('builds the mirror ONCE — its in-memory record must survive the tick', async () => {
      // A mirror re-minted per tick forgets everything it holds between sweeps:
      // the recorded-once gap names first of all, so a standing condition would
      // produce a gap row every five seconds forever.
      const r = rig();
      fs.writeFileSync(path.join(r.dir, `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`), aLine('x.1'));
      await r.w.sweepLifecycle();
      advance(LC_SWEEP_MS + 1);
      await r.w.sweepLifecycle();
      advance(LC_SWEEP_MS + 1);
      await r.w.sweepLifecycle();
      expect(r.coord.lifecycleGaps(10), 'the mirror was re-minted between ticks').toHaveLength(1);
    });
  });

  describe('the tick itself', () => {
    const src = fs.readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');

    it('adds NO new timer — the sweep rides the tick that already exists', () => {
      // `start()` is the one place a timer is created in this class (`:484`). A
      // second setInterval/setTimeout would be a second clock nothing stops on
      // close.
      expect(src.match(/setInterval\(/g) ?? []).toHaveLength(1);
      expect(src).not.toContain('lifecycleTimer');
    });

    it('dispatches the sweep from tick(), never awaited', () => {
      expect(src).toContain('void this.sweepLifecycle().catch(');
    });

    it('leaves sweepMail byte-identical — D9 ships a parity test INSTEAD of a refactor', () => {
      // The most load-bearing loop on the box. Wave 4 adds a producer beside it,
      // never inside it. The slice ends on the method's OWN closing brace —
      // `\n  }\n` at two-space indent — rather than on the next member, so it
      // cannot silently widen to four hundred unrelated lines.
      const from = src.indexOf('  async sweepMail(');
      expect(from, 'sweepMail was not found — this assertion would pass vacuously').toBeGreaterThan(-1);
      const to = src.indexOf('\n  }\n', from);
      expect(to, 'sweepMail has no two-space closing brace').toBeGreaterThan(from);
      const body = src.slice(from, to);
      expect(body.length).toBeGreaterThan(2000);
      expect(body).not.toContain('lifecycle');
      expect(body).not.toContain('Lifecycle');
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-sweep.test.ts
  ```
  Expected: `SyntaxError: The requested module '../src/watch.js' does not provide an export named 'LC_SWEEP_MS'`.

- [ ] **Step 3: Define the interval and add the import and the fields.** In `server/src/watch.ts`, immediately after `const DIVERGENCE_SWEEP_MS = 60_000;` (`:60`):
  ```ts
  /** The journal mirror's lane, and it is fast for the one reason the census's is
   *  slow: a sweep is ONE `readdir` plus one `readFileFrom` per live generation,
   *  and a destruction's `intent`/outcome pair should be visible while the
   *  operator is still looking at the screen. DECLARED HERE, beside its five
   *  siblings, and deliberately NOT in `shared/api.ts`: it has no bash twin and
   *  no wire meaning, and one sweep interval in L0 would be a second home for a
   *  class of value that already has one. EXPORTED because `mirror.ts` cannot
   *  import it — that would be L3 importing L4 — so the staleness window is
   *  passed in from the one construction site below. */
  export const LC_SWEEP_MS = 5_000;
  ```
  Add to the imports:
  ```ts
  import { JournalMirror } from './coord/mirror.js';
  ```
  and add `type LifecycleHealth,` to the existing `shared/api.js` import block. Then, immediately after `private lastDivergenceSweep = 0;` (`:305`):
  ```ts
    private lastLifecycleSweep = 0;
    /** Built lazily on the first sweep that has a coordination database — the
     *  mirror holds the cursor, the error tally and the recorded-once gap names
     *  in memory, so there is exactly one instance per process and it must not
     *  be re-minted per tick. */
    private mirror: JournalMirror | null = null;
  ```

- [ ] **Step 4: Add the sweep and the accessor.** Insert immediately after `sweepDivergences`'s closing `}` (`watch.ts:1618`) and before the `sweepMail` docstring that opens at `:1620`:
  ```ts
    /**
     * Mirror `$REG/.lifecycle/` into `coord.db` (build 9 §1 D5).
     *
     * ON THE EXISTING TICK, WITH NO NEW TIMER. Its own clock, like
     * `sweepDivergences` and `sweepNames`: `!== 0` so the FIRST sweep runs
     * immediately after a restart instead of waiting `LC_SWEEP_MS`, which is the
     * shape those two already ship.
     *
     * PUBLIC so a test can await it. `sweepMail` is not touched by this wave, by
     * name (D9): a second producer lands BESIDE the most load-bearing loop on
     * the box, never inside it.
     */
    async sweepLifecycle(): Promise<void> {
      const store = this.deps.coord;
      if (!store) return;
      const now = Date.now();
      if (this.lastLifecycleSweep !== 0 && now - this.lastLifecycleSweep < LC_SWEEP_MS) return;
      this.lastLifecycleSweep = now;
      this.mirror ??= new JournalMirror({
        io: this.deps.io,
        registryDir: this.deps.cfg.registryDir,
        store,
        ccdVerbs: () => this.deps.fleetState?.ccdVerbs ?? null,
        now: () => Date.now(),
        // THREE INTERVALS. One missed sweep is not an alarm, three is — and the
        // multiplication happens HERE, at the one construction site, because
        // `mirror.ts` is L3 and may not import this module.
        staleAfterMs: LC_SWEEP_MS * 3,
      });
      await this.mirror.sweep();
    }

    /** `null` when this box runs no coordination database, or before the first
     *  sweep has built the mirror — `/api/fleet/health` renders that as an
     *  ABSENT block, which reads as `'unknown'`, never as `'ok'`. */
    lifecycleHealth(): LifecycleHealth | null {
      return this.mirror?.health() ?? null;
    }
  ```

- [ ] **Step 5: Dispatch it from the tick.** Insert immediately after `void this.sweepMail().catch(…)` (`watch.ts:665`), before the `// \`records\` PASSED IN` comment at `:666`:
  ```ts
        // NEVER awaited, same reasoning as `sweepDivergences` above: in remote
        // mode this is one agent-WS `readdir` plus one `readFileFrom` per live
        // generation per sweep. Awaiting it would put the dialog detector and
        // the busy->idle push behind a journal read.
        void this.sweepLifecycle().catch(() => { /* one bad sweep must not kill the poll */ });
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-sweep.test.ts
  ```

- [ ] **Step 7: Run the two nearest suites IN ISOLATION.** Both are on the known load-flake list; a failure here is not a break until it has failed on an idle box.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/pr-sweep.test.ts
  ```
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

- [ ] **Step 8: Mutant check — a second timer.** Add `setInterval(() => { void this.sweepLifecycle(); }, LC_SWEEP_MS);` to `start()`; re-run step 6.
  Mutant: give the mirror its own clock -> this test fails with `AssertionError: expected [ 'setInterval(', 'setInterval(' ] to have a length of 1 but got 2` in `adds NO new timer`. Restore.

- [ ] **Step 9: Mutant check — drop the gate.** Delete the `if (this.lastLifecycleSweep !== 0 && …) return;` line; re-run step 6.
  Mutant: sweep on every 2 s tick -> this test fails with `AssertionError: the gate did not hold: expected [ { uid: 'a.1', … } ] to deeply equal []` in `is GATED`. Restore.

- [ ] **Step 10: Mutant check — re-mint the mirror per tick.** Change `this.mirror ??= new JournalMirror({…})` to `this.mirror = new JournalMirror({…})`; re-run step 6.
  Mutant: a fresh mirror every sweep -> this test fails with `AssertionError: the mirror was re-minted between ticks: expected [ …3 gaps… ] to have a length of 1 but got 3` in `builds the mirror ONCE`. Restore.

- [ ] **Step 11: Commit.**
  ```bash
  git add server/src/watch.ts server/test/lifecycle-sweep.test.ts && git commit -m "feat(watch): LC_SWEEP_MS + sweepLifecycle on the existing tick — no new timer, sweepMail untouched (build9 W4, D5/D9)"
  ```

---
### Task 38: `GET /api/lifecycle` — the read surface, its EXEMPT entry and its corpus mention

**THESE FOUR EDITS ARE ONE COMMIT.** Each alone reds a different suite, and there is no ordering of them that is green in between:
- the route without the `EXEMPT` entry → it becomes gated → `auth-gate.test.ts:430` `expect(gated.length).toBe(39)` fails with `expected 40 to be 39`;
- the `EXEMPT` entry without the route → `auth-gate.test.ts:336` `EXEMPT names routes that do not exist`;
- the route without the corpus mention → `coordinator-skill.test.ts:204-205` `GET /api/lifecycle is registered in coord/routes.ts but never named anywhere in SKILL.md or references/wave-lifecycle.md`;
- the corpus mention without the route → `coordinator-skill.test.ts:172` `no server route registers GET /api/lifecycle`.

D16 rules the corpus mention rather than an `EXEMPT`-set entry in that test. The mechanism scans the **coordinator** corpus only (`routeSkillText` = `SKILL.md` + `references/wave-lifecycle.md`, `coordinator-skill.test.ts:44`; `worker-skill.test.ts` has no route parity), so that is the file this wave edits — mechanism satisfied in wave 4, worker-corpus mention deferred to wave 8.

**AGENT-FIRST.** This task edits a file under `ccd/`, so the fleet host ships before the server. The deploy itself is Task 43 step 6; nothing here reaches a box.

**Files:**
- Modify `server/src/coord/routes.ts` — register after the `GET /api/feed` handler's closing `});` (`:1150`), before `registerCoordRoutes`'s own closing `}` (`:1151`); add one type to the existing `shared/api.js` import block (`:17-21`)
- Modify `server/src/auth/gate.ts` — new `EXEMPT` entry at `:189`, after the `['GET /api/runs', …]` entry and before `['POST /api/runs/:id/dispatch',`
- Modify `server/test/auth-gate.test.ts` — `:63`, `:194`, `:195`, `:196`, `:198`, `:309`, `:348-352`, `:353-370`, `:385`, `:398`, `:403-411`, `:428-429`
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` (append)
- Create `server/test/lifecycle-route.test.ts`

**Interfaces:**
- Consumes: `CoordStore.lifecycleFor({sessionId, limit})`, `CoordStore.lifecycleGaps(limit?)` (Task 34); `checkMailToken(token, header)`, `MAIL_TOKEN_HEADER` (both already imported at `routes.ts:10`); `sessionAuth: (req) => GateDecision` (a real parameter of `registerCoordRoutes`, `:230`); `notConfigured(reply)` (`:232`); type `LifecycleQueryResult` (Task 28).
- Produces: `GET /api/lifecycle?session=<id>&limit=<n>` → `200 LifecycleQueryResult` | `401 {ok,error:'unauthenticated',verdict,detail}` | `501 {ok:false,error:'not-configured'}`.

- [ ] **Step 1: Write the failing route test.** Create `server/test/lifecycle-route.test.ts`:
  ```ts
  import { describe, it, expect, afterEach } from 'vitest';
  import path from 'node:path';
  import type { FastifyInstance } from 'fastify';
  import { buildServer, type Deps } from '../src/server.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { parseJournalLine } from '../src/coord/journalparse.js';
  import { testDeps } from './helpers.js';
  import { mkTmp } from './tmpHelpers.js';
  import { LC_ACT_UNKNOWN, LIFECYCLE_ACTS } from '../../shared/api.js';

  const TOKEN = 'f'.repeat(64);
  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const GEN = '1755780000000000000';
  const tok = { 'x-ccrc-mail-token': TOKEN };

  const seeded = async (over: Partial<Deps> = {}, withCoord = true) => {
    const home = mkTmp('ccrc-lcroute-');
    const base = testDeps(home);
    const coord = withCoord
      ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')))
      : undefined;
    if (coord) {
      coord.ingestJournal({
        gen: GEN, cursor: 300, size: 300, at: 9,
        rows: [
          parseJournalLine(JSON.stringify({ uid: 'a.1', at: 100, act: AN_ACT, outcome: 'intent',
                                            verb: 'ws-rm', id: 'demo-quiet-basin' })),
          parseJournalLine(JSON.stringify({ uid: 'a.2', at: 110, act: AN_ACT, outcome: 'refused',
                                            verb: 'ws-rm', id: 'demo-quiet-basin', refusal: 'held' })),
          parseJournalLine(JSON.stringify({ uid: 'b.1', at: 120, act: AN_ACT, outcome: 'done',
                                            verb: 'forget', id: 'other-session' })),
        ],
      });
      coord.recordGap({ at: 20, gen: GEN, reason: 'rotated-away', detail: 'undrained',
                        lostFrom: 0, lostTo: 40 });
    }
    const app = await buildServer({ ...base, mailToken: TOKEN, ...(coord ? { coord } : {}), ...over });
    return { app, coord };
  };

  describe('GET /api/lifecycle', () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => { if (app) await app.close(); app = undefined; });

    it("answers one session's timeline oldest-first, with its gaps", async () => {
      const w = await seeded(); app = w.app;
      const res = await app.inject({
        method: 'GET', url: '/api/lifecycle?session=demo-quiet-basin', headers: tok,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { events: { uid: string; id: string; refusal: string | null }[];
                                   gaps: { reason: string }[] };
      expect(body.events.map((e) => e.uid)).toEqual(['a.1', 'a.2']);
      expect(body.events[0]!.id).toBe('demo-quiet-basin');
      expect(body.events[1]!.refusal).toBe('held');
      expect(body.gaps.map((g) => g.reason)).toEqual(['rotated-away']);
    });

    it('answers the whole fleet when no session is named', async () => {
      const w = await seeded(); app = w.app;
      const body = (await app.inject({ method: 'GET', url: '/api/lifecycle', headers: tok }))
        .json() as { events: { uid: string }[] };
      expect(body.events.map((e) => e.uid)).toEqual(['a.1', 'a.2', 'b.1']);
    });

    it('clamps `limit` rather than trusting it, and survives its absence', async () => {
      const w = await seeded(); app = w.app;
      const two = (await app.inject({ method: 'GET', url: '/api/lifecycle?limit=2', headers: tok }))
        .json() as { events: { uid: string }[] };
      expect(two.events.map((e) => e.uid)).toEqual(['a.2', 'b.1']);
      const huge = (await app.inject({ method: 'GET', url: '/api/lifecycle?limit=99999', headers: tok }))
        .json() as { events: unknown[] };
      expect(huge.events).toHaveLength(3);
      // No `limit` at all: `Number(undefined)` is NaN, which `lifecycleFor`'s
      // `Number.isFinite` guard answers with the page maximum. Pinned so nobody
      // "fixes" the handler into `?? undefined`.
      const none = (await app.inject({ method: 'GET', url: '/api/lifecycle', headers: tok }))
        .json() as { events: unknown[] };
      expect(none.events).toHaveLength(3);
    });

    it('AUTHENTICATES BEFORE ANSWERING 501 — a 501 would publish whether this box runs coordination', async () => {
      const base = testDeps(mkTmp('ccrc-lcroute-'));
      const w = await seeded({ cfg: { ...base.cfg, authEnabled: true } } as Partial<Deps>, false);
      app = w.app;
      const anon = await app.inject({ method: 'GET', url: '/api/lifecycle' });
      expect(anon.statusCode).toBe(401);
      expect(anon.json()).toMatchObject({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
      const withToken = await app.inject({ method: 'GET', url: '/api/lifecycle', headers: tok });
      expect(withToken.statusCode).toBe(501);
      expect(withToken.json()).toEqual({ ok: false, error: 'not-configured' });
    });

    it('is FLAG-AWARE — a dark box behaves exactly as it did before this slice', async () => {
      const w = await seeded(); app = w.app;     // testDeps leaves CCRC_AUTH off
      const res = await app.inject({ method: 'GET', url: '/api/lifecycle' });
      expect(res.statusCode).toBe(200);
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-route.test.ts
  ```
  Expected: every case `AssertionError: expected 404 to be 200` (and `expected 404 to be 401` in the auth case).

- [ ] **Step 3: Register the route.** In `server/src/coord/routes.ts`, insert immediately after the `GET /api/feed` handler's closing `});` (`:1150`) and before `registerCoordRoutes`'s closing `}` (`:1151`):
  ```ts
    /**
     * `GET /api/lifecycle?session=<id>&limit=<n>` — one session's past tense,
     * oldest-first, plus the mirror's own holes.
     *
     * EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled for this route by D16),
     * and the reason is `GET /api/runs`'s exactly: A WORKER MUST BE ABLE TO ASK
     * "WHAT HAPPENED TO MY WORKSPACE" WITHOUT A BROWSER. It runs on the fleet
     * host with no cookie jar, and the answer it needs is about a workspace that
     * may no longer exist — `_reg_purge` (`ccd:458-556`) has already deleted
     * every per-session field by then, which is the whole reason the journal is
     * a dot-prefixed DIRECTORY. Gated, an armed box answers `401 no-session` and
     * the one surface that survives a destruction is unreachable from the box
     * that performed it.
     *
     * AUTHENTICATE BEFORE ANSWERING ANYTHING, INCLUDING `501 not-configured` —
     * on a gated route the hook would have refused before the handler ran, so
     * keeping that order here is by hand. A `501` tells an anonymous tailnet
     * caller whether this box runs coordination at all.
     *
     * EITHER CREDENTIAL, NEVER NEITHER; flag-aware, so a dark box is unchanged;
     * and the refusal carries the session's own `verdict` so the PWA's one login
     * screen keeps working and D-127's expired-vs-no-session survives. All four
     * properties are `GET /api/runs`'s and are pinned the same way.
     *
     * NAMED IN `ccd/coordinator-skill/references/wave-lifecycle.md`, because
     * `coordinator-skill.test.ts` requires every route registered in this file
     * to be named in that corpus minus its own EXEMPT set — and that parity test
     * is this program's rollout-ordering mechanism, not an inconvenience.
     */
    app.get('/api/lifecycle', async (req, reply) => {
      if (deps.cfg.authEnabled) {
        const session = sessionAuth(req);
        if (session.reason !== 'session') {
          const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
          if (token !== 'ok') {
            return reply.code(401).send({
              ok: false,
              error: 'unauthenticated',
              verdict: session.verdict,
              detail: 'GET /api/lifecycle takes a session cookie OR the box token ' +
                `(${MAIL_TOKEN_HEADER}); a worker reads it cookieless from the fleet host`,
            });
          }
        }
      }
      if (!deps.coord) return notConfigured(reply);
      const q = req.query as { session?: string; limit?: string };
      // Clamping is `CoordStore`'s own job, not repeated here — the same division
      // of labour `GET /api/feed`'s `limit` and `GET /api/runs`'s `closed` use.
      // `Number(undefined)` is `NaN` on purpose: `lifecycleFor`'s
      // `Number.isFinite` guard answers that with the page maximum, so an absent
      // `limit` and a garbage one take the same honest path. Do not "fix" this
      // into `?? undefined`.
      const out: LifecycleQueryResult = {
        events: deps.coord.lifecycleFor({ sessionId: q.session ?? null, limit: Number(q.limit) }),
        gaps: deps.coord.lifecycleGaps(),
      };
      return out;
    });
  ```
  and add `type LifecycleQueryResult,` to this file's existing `shared/api.js` type imports (`:17-21`).

- [ ] **Step 4: Add the `EXEMPT` entry.** In `server/src/auth/gate.ts`, insert at `:189` — after the `['GET /api/runs', …]` entry ends and before `['POST /api/runs/:id/dispatch',`:
  ```ts
    ['GET /api/lifecycle',
      "EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled for this route by build 9 D16), the same " +
      'shape as `GET /api/runs` directly above and for a sharper reason: a WORKER asks this route ' +
      'what happened to its own workspace, cookieless, from the fleet host — and the workspace it ' +
      'is asking about may already be gone, since `_reg_purge` deletes every per-session registry ' +
      'field on ws-rm/ws-reap/ws-gc/forget. Gated, the one surface that outlives a destruction is ' +
      'unreachable from the box that performed it. The handler requires a live session OR a valid ' +
      'box token (coord/routes.ts), so nothing is published to the tailnet that was not before'],
  ```

- [ ] **Step 5: Update `auth-gate.test.ts`'s arithmetic pins.** All twelve, measured:
  - `:63` → `const EXEMPT_BUT_AUTHENTICATED = new Set(['GET /api/lifecycle', 'GET /api/runs']);`
  - `:194` → `expect(scanRoutes('coord/routes.ts').length).toBe(14);`
  - `:195` → `expect(ROUTES.length).toBe(59);`
  - `:196` comment → `// …and the three partitions add up: 3 websockets + 56 HTTP.`
  - `:198` → `expect(ROUTES.filter((r) => !isWs(r)).length).toBe(56);`
  - `:309` comment → `// 59 scanned + the static wildcard when the bundle is built.` (the assertion at `:310` is derived from `ROUTES.length` and stays green — checked, not left to wonder about)
  - `:348-352` comment → the exemption census, corrected so the new route is counted ONCE:
    ```ts
      // The whole set, spelled out, so that adding an exemption is a deliberate act
      // that edits this list with a reviewer looking at it. 18 = /health + the 9
      // box-token lanes + /api/notify + login + status + the SPA shell + the two
      // halves of the passkey door + GET /api/runs and GET /api/lifecycle (D-149's
      // pattern, exempt-BUT-authenticated).
    ```
  - `:353-370` array → insert `'GET /api/lifecycle',` between `'GET /api/auth/status',` and `'GET /api/mail',`
  - `:385` title → `it('the ELEVEN box-token lanes in EXEMPT are the eleven that really check the token', () => {`
  - `:398` comment → `// ELEVEN since build 9: GET /api/lifecycle joined GET /api/runs in the` / `// exempt-but-authenticated class, and it is the token half that puts both in`
  - `:403-411` expected array → insert `'GET /api/lifecycle',` before `'GET /api/mail',`, and change the trailing sentence `// …and \`/api/notify\`, the tenth, which lives in server.ts.` to `// …and \`/api/notify\`, the eleventh, which lives in server.ts.`
  - `:428-429` comment → `// 59 scanned − 3 websockets − 17 exempt-and-scanned (18 EXEMPT entries less` / `// \`GET /*\`, which no \`app.get('…')\` registers) = 39.`
  The two assertions at `:430-431` (`toBe(39)` and `toBe(EXEMPT.size - 1)`) are UNCHANGED and are what proves the arithmetic still balances: the new route is exempt, so `gated` does not grow, and `59 − 3 − 39 = 17 = 18 − 1`.

- [ ] **Step 6: Name the route in the coordinator corpus.** Append to `ccd/coordinator-skill/references/wave-lifecycle.md`:
  ```markdown
  ## What happened to a workspace that is gone

  `GET /api/lifecycle?session=<id>` — the provenance journal, oldest-first, with the mirror's own
  gaps beside it. It takes a session cookie or the box token, so it reads cookieless from the fleet
  host the same way `GET /api/runs` does.

  Read it when a workspace has been removed and you need to answer who did it, why, and what was
  lost. It is the only surface that survives a removal: every per-session registry field is deleted
  by the cleanup itself, and the journal is written where that deletion cannot reach.

  Three families sit side by side on every row and they never merge. `obs` is what the kernel saw,
  `dec` is what the caller declared, `meas` is what was measured about the workspace before anything
  was destroyed. When the first two disagree the census raises it as a divergence; nothing picks a
  winner. A `null` in `meas` means it was not measured, never that it was empty.
  ```
  **Check before committing:** the census at `coordinator-skill.test.ts:91-99` requires `ws-reap`, `ws-rm` and `ws-gc` to appear in the whole corpus ONLY inside contract clause 3. The paragraphs above deliberately say "removed", "removal" and "the cleanup", and name no destructive verb. (`ws-rename`, already in this file, is not a `ws-rm` substring.)

- [ ] **Step 7: Run all four suites and see them pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-route.test.ts test/auth-gate.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts
  ```

- [ ] **Step 8: Mutant check — 501 before the auth.** Move `if (!deps.coord) return notConfigured(reply);` above the `if (deps.cfg.authEnabled)` block; re-run step 7.
  Mutant: answer `not-configured` to an anonymous caller -> this test fails with `AssertionError: expected 501 to be 401` in `AUTHENTICATES BEFORE ANSWERING 501`. Restore.

- [ ] **Step 9: Mutant check — refuse the box token.** Delete the inner `checkMailToken` check so the handler refuses on `session.reason !== 'session'` alone; re-run step 7.
  Mutant: cookie only -> `auth-gate.test.ts`'s `it.each([...EXEMPT_BUT_AUTHENTICATED])` sweep (`:469`) fails for `GET /api/lifecycle`, which probes exempt routes with the box token precisely because a gate refusal and a handler refusal are otherwise indistinguishable. Restore.

- [ ] **Step 10: Mutant check — drop the corpus paragraph.** Delete the section added in step 6; re-run step 7.
  Mutant: register a coordinator-domain route the corpus does not name -> this test fails with `AssertionError: GET /api/lifecycle is registered in coord/routes.ts but never named anywhere in SKILL.md or references/wave-lifecycle.md: expected false to be true` at `coordinator-skill.test.ts:204`. Restore.

- [ ] **Step 11: Commit — all four edits together.**
  ```bash
  git add server/src/coord/routes.ts server/src/auth/gate.ts server/test/auth-gate.test.ts server/test/lifecycle-route.test.ts ccd/coordinator-skill/references/wave-lifecycle.md && git commit -m "feat(coord): GET /api/lifecycle — cookie OR box token, EXEMPT entry, corpus mention (build9 W4, D16)"
  ```

---
### Task 39: the `/api/fleet/health` lifecycle block

**Files:**
- Modify `server/src/server.ts` — inside the `/api/fleet/health` handler that opens at `:986`; both return arms
- Modify `server/test/fleet-health.test.ts` (append; and eight new imports)

**Interfaces:**
- Consumes: `FleetWatcher.lifecycleHealth(): LifecycleHealth | null` (Task 37); `FleetHealth.lifecycle?: LifecycleHealth` (Task 28); `buildServer(deps: Deps, bus = new Bus(), watcher?: FleetWatcher)` — the shipped signature at `server.ts:233`, so the appended describe builds its own app with all three arguments.
- Produces: `/api/fleet/health` answering an optional `lifecycle` block on BOTH arms.

- [ ] **Step 1: Add the imports the new block needs.** `server/test/fleet-health.test.ts` has no `openApp` helper — it builds apps inline from `testDeps`/`remoteDeps` — so the appended describe does the same. Add to its import block (`:1-16`):
  ```ts
  import { mkdirSync } from 'node:fs';
  import { Bus } from '../src/bus.js';
  import { FleetWatcher } from '../src/watch.js';
  import { CoordStore } from '../src/coord/store.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
  import { genFile } from './lifecycleHelpers.js';
  import { LC_ACT_UNKNOWN, LC_DIR_NAME, LIFECYCLE_ACTS } from '../../shared/api.js';
  ```
  (`writeFileSync`, `path`, `buildServer`, `testDeps`, `mkTmp` are already imported at `:1-16`.)

- [ ] **Step 2: Write the failing test.** Append to `server/test/fleet-health.test.ts`:
  ```ts
  describe('/api/fleet/health: the lifecycle block (build 9)', () => {
    const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
    const G1 = '1755780000000000000';

    it('reports the mirror once the watcher has swept', async () => {
      const home = mkTmp('ccrc-fh-lc-');
      const deps = testDeps(home);
      const dir = path.join(deps.cfg.registryDir, LC_DIR_NAME);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, genFile(G1)),
        `${JSON.stringify({ uid: 'a.1', at: 100, act: AN_ACT, outcome: 'done', id: 'demo' })}\n`);
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      const full = { ...deps, coord,
        fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never;
      const bus = new Bus();
      const watcher = new FleetWatcher(full, bus);
      const app = await buildServer(full, bus, watcher);
      try {
        await watcher.sweepLifecycle();
        const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as
          { lifecycle?: { state: string; rows: number; horizon: number | null; gaps: number } };
        expect(body.lifecycle).toMatchObject({ state: 'ok', rows: 1, horizon: 100, gaps: 0 });
      } finally { await app.close(); }
    });

    it('OMITS the block entirely when there is no watcher — absent reads as `unknown`, never as `ok`', async () => {
      const app = await buildServer(testDeps(mkTmp('ccrc-fh-lc-')));
      try {
        const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as
          Record<string, unknown>;
        expect('lifecycle' in body && body['lifecycle'] !== undefined).toBe(false);
      } finally { await app.close(); }
    });
  });
  ```

- [ ] **Step 3: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/fleet-health.test.ts
  ```
  Expected: `AssertionError: expected undefined to match object { state: 'ok', rows: 1, horizon: 100, gaps: 0 }`.

- [ ] **Step 4: Read the block once, above the mode branch.** In `server/src/server.ts`, inside the `/api/fleet/health` handler (`:986`), insert immediately before `if (deps.cfg.fleetMode === 'remote' && deps.fleetState) {`:
  ```ts
      // Read ONCE, off the watcher, exactly the way `/api/fleet` reads
      // `watcher?.currentPending()` — the mirror's cursor, error tally and
      // recorded-once gap names live in memory ON IT, and no route may re-mint
      // one. `undefined` when this box has no watcher or has not swept yet,
      // which the wire renders as an ABSENT block: absence-permits, and a reader
      // must treat it as `'unknown'`, never as `'ok'` and never as an empty
      // history.
      const lifecycle = watcher?.lifecycleHealth() ?? undefined;
  ```

- [ ] **Step 5: Spread it into BOTH arms.** In the same handler, add `...(lifecycle ? { lifecycle } : {}),` as the last member of the **remote** return object (after `build: buildAgreement(...)`,) and the identical spread as the last member of the **local** return object (after `roster: 'unknown', build: 'unknown',`), with this comment above the local one:
  ```ts
      // BOTH ARMS. Local mode drives ccd on this same box and mirrors the same
      // journal — there is no second box to disagree with, but there is still a
      // journal, and a block that appeared only in remote mode would make the
      // dev box permanently unable to see its own mirror stall.
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/fleet-health.test.ts
  ```

- [ ] **Step 7: Mutant check — the return-type annotation is load-bearing.** Change the remote arm's spread to `...(lifecycle ? { lifecycle: { ...lifecycle, state: 'unknowable' } } : {}),` and run:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
  ```
  Mutant: an invented state word on the health block -> this fails with `TS2322: Type '"unknowable"' is not assignable to type 'LifecycleHealthState'` — the same measurement `server.ts:975-985` already records for `roster`, and the reason this handler carries a `Promise<FleetHealth>` annotation at all. Restore.

- [ ] **Step 8: Mutant check — one arm only.** Delete the spread from the LOCAL arm; re-run step 6.
  Mutant: report the mirror in remote mode only -> this test fails with `AssertionError: expected undefined to match object { state: 'ok', … }` in `reports the mirror once the watcher has swept` (`testDeps` builds a local-mode config). Restore.

- [ ] **Step 9: Commit.**
  ```bash
  git add server/src/server.ts server/test/fleet-health.test.ts && git commit -m "feat(server): /api/fleet/health lifecycle block on both arms (build9 W4, D7/D8)"
  ```

---
### Task 40: `divergence.provenance-mismatch` and `divergence.archived-but-live`

**Files:**
- Modify `shared/api.ts` — the `DivergenceKind` union and its total map (`:1104-1110`); two paragraphs appended to the standing rejected-kinds docstring that opens at `:1080`
- Modify `server/src/divergence.ts` — the header docstring (`:3-6`); the import line (`:1`); `DivergenceInput.records[]` and two new members before the interface's closing `}` (`:65`); two arms before `return out;` (`:296`)
- Modify `server/test/divergence.test.ts` — `rec()` (`:7-11`), `input()` (`:22-30`), the describe title at `:32`, the exact-kinds pin and its title (`:303-305`); new describes appended

**Interfaces:**
- Consumes, from `shared/api.js`: `corroboration(obsClass: ActorClass | null, decSurface: DecSurface): Corroboration` — **the parameter types are exact and load-bearing**; `isActorClass(v: unknown): v is ActorClass`; `isDecSurface(v: unknown): v is DecSurface` (`DecSurface = StopSurface | 'none'`); `ACTOR_CLASSES: readonly ActorClass[]`; `SUPERVISED_FRESH_MS = 120_000` (`shared/api.ts:1166`). `Corroboration` is `'agrees' | 'disagrees' | 'not-comparable' | 'unmeasured'`.
- Consumes: `SessionRecord.supervisedAt: number | null` (`registry.ts:185`), fed in by Task 41.
- Produces:
  ```ts
  // shared/api.ts
  DivergenceKind += 'provenance-mismatch' | 'archived-but-live'
  // server/src/divergence.ts — DivergenceInput gains:
  readonly nowMs: number;
  // records[] gains:
  readonly supervisedAt: number | null;
  // and a new top-level member, structurally identical to CoordStore.ProvenancePair:
  readonly provenance: readonly {
    readonly id: string; readonly at: number | null;
    readonly obsClass: string; readonly decSurface: string;
  }[];
  ```
  `divergence.ts` is L1 and declares this shape INLINE rather than importing `ProvenancePair` from `coord/store.ts` (L3). `ProvenancePair` is structurally assignable to it, which Task 41 relies on.

- [ ] **Step 1: Write the failing tests.** Append to `server/test/divergence.test.ts`, and extend its `shared/api.js` import at `:4` with `ACTOR_CLASSES, corroboration, isDecSurface, SUPERVISED_FRESH_MS,`:
  ```ts
  const NOW = 1_785_300_000_000;

  /** `STOP_SURFACES` is MODULE-PRIVATE by design (its docstring says so at
   *  length: with the list unexported, `STOP_SURFACES.includes(raw as
   *  StopSurface)` is TS2459 before the casts are even considered). So this
   *  file spells the surfaces — and then checks its own copy, so the copy
   *  cannot silently drift into a subset. */
  const SURFACES = ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const;
  const CLASSES = ACTOR_CLASSES;

  /** Found by ASKING `corroboration`, never hard-coded: the table is wave 1's and
   *  this file must not become a second copy of it. */
  const pairs = CLASSES.flatMap((c) => SURFACES.map((s) => [c, s] as const));
  const DISAGREES = pairs.find(([c, s]) => corroboration(c, s) === 'disagrees')!;
  const AGREES = pairs.find(([c, s]) => corroboration(c, s) === 'agrees')!;

  describe('divergences — provenance-mismatch', () => {
    it('has a fixture for both directions — otherwise every assertion below is vacuous', () => {
      expect(SURFACES.every(isDecSurface), 'the local surface list drifted from DecSurface').toBe(true);
      expect(DISAGREES, 'no (class, surface) pair disagrees; the arm cannot be tested').toBeDefined();
      expect(AGREES, 'no (class, surface) pair agrees; the arm cannot be tested').toBeDefined();
    });

    it('raises when the kernel field contradicts the declared surface', () => {
      const out = divergences(input({
        provenance: [{ id: 'demo-quiet-basin', at: NOW - 1000,
                       obsClass: DISAGREES[0], decSurface: DISAGREES[1] }],
      }));
      expect(out.map((d) => d.kind)).toEqual(['provenance-mismatch']);
      expect(out[0]!.id).toBe('demo-quiet-basin');
      expect(out[0]!.detail).toContain(DISAGREES[0]);
      expect(out[0]!.detail).toContain(DISAGREES[1]);
    });

    it('raises on `disagrees` and ONLY on `disagrees` — not-comparable and unmeasured are not disagreements', () => {
      // The whole cross product, so a fourth answer added to `corroboration`
      // later cannot silently start raising divergences.
      for (const [obsClass, decSurface] of pairs) {
        const out = divergences(input({
          provenance: [{ id: 'demo-quiet-basin', at: NOW, obsClass, decSurface }],
        })).filter((d) => d.kind === 'provenance-mismatch');
        expect(out.length, `${obsClass} vs ${decSurface}`)
          .toBe(corroboration(obsClass, decSurface) === 'disagrees' ? 1 : 0);
      }
    });

    it('raises NOTHING on a pair this build cannot even model — unmodellable is not a disagreement', () => {
      // A newer ccd's fifth cgroup shape, or a hand-edited row. The guard is
      // `isActorClass`/`isDecSurface`, never a cast: laundering an unvalidated
      // string past the only narrowing door wave 1 built is the "an adapter may
      // not narrow a distinction it received" rule inverted.
      expect(divergences(input({
        provenance: [{ id: 'demo-quiet-basin', at: NOW, obsClass: 'martian', decSurface: 'kiosk' }],
      }))).toEqual([]);
      expect(divergences(input({
        provenance: [{ id: 'demo-quiet-basin', at: NOW, obsClass: 'martian', decSurface: DISAGREES[1] }],
      }))).toEqual([]);
    });

    it('names a session ONCE however many times it disagreed', () => {
      const out = divergences(input({
        provenance: [
          { id: 'demo-quiet-basin', at: NOW - 3000, obsClass: DISAGREES[0], decSurface: DISAGREES[1] },
          { id: 'demo-quiet-basin', at: NOW - 1000, obsClass: DISAGREES[0], decSurface: DISAGREES[1] },
        ],
      })).filter((d) => d.kind === 'provenance-mismatch');
      expect(out).toHaveLength(1);
    });

    it('raises nothing at all when the mirror supplied no pairs', () => {
      expect(divergences(input({ provenance: [] }))).toEqual([]);
    });
  });

  describe('divergences — archived-but-live', () => {
    it('flags a row stamped archived that is heartbeating right now', () => {
      // The four measured rows (spec §0): `.archived` is cleared only by
      // ws-restore and _reg_purge, never by start/ensure, so half the rows that
      // carry a `why` carry a false one. This names the contradiction; it does
      // NOT clear the field, because clearing it destroys the archive record.
      const out = divergences(input({
        records: [rec({ archivedAt: 1_785_200_000, supervisedAt: NOW - 30_000 })],
        worktrees: [], headBranch: new Map(),
      }));
      expect(out.map((d) => d.kind)).toEqual(['archived-but-live']);
      expect(out[0]!.id).toBe('demo-quiet-basin');
    });

    it('says nothing about an archived row whose supervisor stamp is stale or absent', () => {
      for (const supervisedAt of [null, NOW - SUPERVISED_FRESH_MS, NOW - 86_400_000]) {
        expect(divergences(input({
          records: [rec({ archivedAt: 1_785_200_000, supervisedAt })],
          worktrees: [], headBranch: new Map(),
        }))).toEqual([]);
      }
    });

    it('does not call a FUTURE-dated heartbeat live', () => {
      expect(divergences(input({
        records: [rec({ archivedAt: 1_785_200_000, supervisedAt: NOW + 60_000 })],
        worktrees: [], headBranch: new Map(),
      }))).toEqual([]);
    });

    it('says nothing about a live row that was never archived', () => {
      expect(divergences(input({ records: [rec({ supervisedAt: NOW - 1000 })] }))).toEqual([]);
    });
  });
  ```
  Then extend the two fixture helpers at the top of the file — `rec()` (`:7-11`) gains `supervisedAt: null as number | null,` and `input()` (`:22-30`) gains `nowMs: NOW,` and `provenance: [],`. Move the `const NOW = 1_785_300_000_000;` declaration above `input()` so both can see it. Retitle the two stale headers: `:32` `describe('divergences — the three kinds, individually'` → `describe('divergences — the original three kinds, individually'`, and `:303` `it('is exactly three kinds — …'` → `it('is exactly five kinds — dead-row/unsupervised/not-boot-persistent are still DELETED', …`. Update the exact-kinds pin at `:304-305`:
  ```ts
      expect([...DIVERGENCE_KINDS].sort()).toEqual(
        ['archived-but-live', 'branch-drift', 'claim-divergence',
         'provenance-mismatch', 'unregistered-worktree']);
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/divergence.test.ts
  ```
  Expected: `AssertionError: expected [ 'branch-drift', 'claim-divergence', 'unregistered-worktree' ] to deeply equal [ 'archived-but-live', 'branch-drift', 'claim-divergence', 'provenance-mismatch', 'unregistered-worktree' ]`, and the typecheck half reds with `TS2353: Object literal may only specify known properties, and 'provenance' does not exist in type 'DivergenceInput'`.

- [ ] **Step 3: Grow the wire type.** In `shared/api.ts`, replace `:1104-1110`:
  ```ts
  export type DivergenceKind =
    | 'unregistered-worktree'   // git records a worktree no registry row claims
    | 'branch-drift'            // registry `.branch` != the worktree's own HEAD
    | 'claim-divergence'        // a hold with no open run, or an open run with no hold
    | 'provenance-mismatch'     // the kernel field contradicts the declared surface
    | 'archived-but-live';      // a row stamped archived that is heartbeating now
  const DIVERGENCE_KIND_MAP: Record<DivergenceKind, true> = {
    'unregistered-worktree': true, 'branch-drift': true, 'claim-divergence': true,
    'provenance-mismatch': true, 'archived-but-live': true,
  };
  ```
  and append two paragraphs to the standing rejected-kinds docstring (opens `:1080`), before its closing `*/`:
  ```
   * `provenance-mismatch` (build 9 D2). `corroboration()` is the ONE pure
   * function allowed to relate the three identity families, and a `disagrees` is
   * a fact the operator sees, never a silently picked winner. ccd cannot refuse
   * on identity — single UNIX user, attribution not authentication — and does
   * not pretend to, so the record IS the mechanism. NOT a boolean on the event
   * row: a disagreement is about the pair, and the census is where pairs are
   * weighed.
   *
   * `archived-but-live` (build 9 D9). Four rows measured on the live box are
   * stamped `merged:#N` and heartbeating. `.archived` is cleared only by
   * ws-restore and `_reg_purge`, never by start/ensure, so the one registry
   * field carrying a WHY is false on half the rows that have it — and a field
   * that is silently false reads as authoritative, which is worse than absence.
   * This kind names the contradiction with ZERO ccd semantic change. It does not
   * clear the stamp: clearing it destroys the archive record exactly as
   * `ws-restore` did until wave 3.
  ```

- [ ] **Step 4: Run the wire half and see the kinds pin go green.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/divergence.test.ts
  ```
  Expected: `is exactly five kinds` passes; the two new describes still fail with `expected [] to deeply equal [ … ]`.

- [ ] **Step 5: Grow `DivergenceInput` and correct the header docstring.** In `server/src/divergence.ts`, replace `:1`:
  ```ts
  import {
    corroboration, isActorClass, isDecSurface, SUPERVISED_FRESH_MS, type Divergence,
  } from '../../shared/api.js';
  ```
  and replace the header docstring's first sentence (`:3-6`) with:
  ```ts
  /**
   * L1: pure, clock-free, `fs`-free, fastify-free — it imports L0 TYPES and
   * three L0 PURE VALUES (`corroboration`, the two guards it needs to call it
   * honestly, and `SUPERVISED_FRESH_MS`) and nothing else. THE CLOCK IS AN INPUT
   * (`nowMs`), never read here. Gathering is L4's job
   * (`FleetWatcher.sweepDivergences`), THE CENSUS'S SINGLE PRODUCER.
   *
   * Deliberately NOT under `server/src/coord/`: it holds no DB handle and has no
   * business near the coord-ring scanner in `single-definition.test.ts`. That is
   * also why `provenance` below is declared INLINE rather than imported as
   * `ProvenancePair` from `coord/store.ts` — L1 may not reach into L3, and the
   * two shapes are structurally identical so the sweep can hand one straight in.
   */
  ```
  Add `readonly supervisedAt: number | null;` to the `records[]` member list (after `archivedAt`), and append two members to `DivergenceInput` before its closing `}` (`:65`):
  ```ts
    /**
     * The clock, as an INPUT. This module is pure and stays pure —
     * `sessionLifecycle` takes `nowMs` the same way and for the same reason: the
     * whole table is then testable with no timers, and the census cannot drift
     * against the ladder by reading a different `Date.now()`.
     */
    readonly nowMs: number;
    /**
     * `(observed actor class, declared surface)` pairs off recent lifecycle
     * rows, from the journal mirror. Both are RAW strings: narrowing them is
     * `corroboration`'s job, and an input that pre-narrowed them would be an
     * adapter deciding.
     *
     * EMPTY WHEN THE MIRROR IS UNAVAILABLE, and that is the safe direction — an
     * absence is never a disagreement, the same rule `headBranch`'s own
     * docstring states for a null HEAD.
     */
    readonly provenance: readonly {
      readonly id: string;
      readonly at: number | null;
      readonly obsClass: string;
      readonly decSurface: string;
    }[];
  ```

- [ ] **Step 6: Write the two arms.** In `divergences()`, insert immediately before `return out;` (`:296`):
  ```ts
    // 4 — the kernel field contradicts the declared surface (build 9 D2). ONE
    // per session however many times it disagreed: the census is a list of
    // things to look at, and 500 rows about one session is a list nobody reads.
    // `corroboration` is the only function allowed to relate the families, and
    // `not-comparable`/`unmeasured` raise NOTHING — not knowing is not a
    // disagreement.
    const named = new Set<string>();
    for (const p of input.provenance) {
      if (named.has(p.id)) continue;
      // THE GUARDS, NEVER A CAST. `as never` on either argument would launder an
      // unvalidated string past the only narrowing door L0 built, which is "an
      // adapter may not narrow a distinction it received" inverted. A value this
      // build cannot model is not a disagreement — it is a value this build
      // cannot model, and the row is in `GET /api/lifecycle` either way.
      if (!isActorClass(p.obsClass) || !isDecSurface(p.decSurface)) continue;
      if (corroboration(p.obsClass, p.decSurface) !== 'disagrees') continue;
      named.add(p.id);
      out.push({
        kind: 'provenance-mismatch', id: p.id, path: null,
        detail: `the cgroup says ${p.obsClass}, the caller declared ${p.decSurface}`,
      });
    }

    // 5 — a row stamped archived that is heartbeating right now (build 9 D9).
    // Four such rows were measured on the live box, every one of them stamped
    // `merged:#N`. THE HEARTBEAT IS THE EVIDENCE, not tmux: `.supervised` is
    // re-stamped every 30 s by the supervisor, so a fresh stamp on an archived
    // row is a supervisor watching a workspace the registry says is gone.
    //
    // `>= 0` is the same guard `sessionLifecycle` carries and states at length:
    // without it a future-dated stamp reads fresh forever, and a skewed clock
    // would flag every archived row on the box.
    for (const r of input.records) {
      if (r.archivedAt === null || r.supervisedAt === null) continue;
      const age = input.nowMs - r.supervisedAt;
      if (age < 0 || age >= SUPERVISED_FRESH_MS) continue;
      out.push({
        kind: 'archived-but-live', id: r.id, path: r.workdir,
        detail: `stamped archived, and the supervisor heartbeat is ${Math.round(age / 1000)}s old`,
      });
    }
  ```

- [ ] **Step 7: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/divergence.test.ts
  ```

- [ ] **Step 8: Mutant check — raise on `not-comparable` too.** Change the guard to `if (corroboration(p.obsClass, p.decSurface) === 'agrees') continue;`; re-run step 7.
  Mutant: treat everything that is not agreement as disagreement -> this test fails with `AssertionError: <class> vs <surface>: expected 1 to be +0` in `raises on 'disagrees' and ONLY on 'disagrees'`. Restore.

- [ ] **Step 9: Mutant check — cast instead of guarding.** Replace the two-guard line with `if (corroboration(p.obsClass as never, p.decSurface as never) !== 'disagrees') continue;`; re-run step 7.
  Mutant: `as never` casts -> this test fails with `TypeError: Cannot read properties of undefined (reading 'includes')` in `raises NOTHING on a pair this build cannot even model`. `corroboration`'s last rung is `DEC_CORROBORATES[obsClass].includes(decSurface)` and that table is total over `ActorClass` ONLY — laundering `'martian'` past `isActorClass` indexes it with a key it does not have. The cast does not merely lose a distinction; it crashes the census. Then delete the two guards outright (no cast) and run `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`: `TS2345: Argument of type 'string' is not assignable to parameter of type 'ActorClass | null'` — the guards are load-bearing at BOTH levels. Restore.

- [ ] **Step 10: Mutant check — drop the `>= 0` guard.** Change `if (age < 0 || age >= SUPERVISED_FRESH_MS) continue;` to `if (age >= SUPERVISED_FRESH_MS) continue;`; re-run step 7.
  Mutant: allow a future-dated heartbeat -> this test fails with `AssertionError: expected [ { kind: 'archived-but-live', … } ] to deeply equal []` in `does not call a FUTURE-dated heartbeat live`. Restore.

- [ ] **Step 11: Commit.**
  ```bash
  git add shared/api.ts server/src/divergence.ts server/test/divergence.test.ts && git commit -m "feat(divergence): provenance-mismatch and archived-but-live arms, guarded not cast (build9 W4, D2/D9)"
  ```

---
### Task 41: feed the two new arms from `sweepDivergences`

**Files:**
- Modify `server/src/watch.ts` — `PROVENANCE_WINDOW_MS` beside `LC_SWEEP_MS` (after `:60`); one type import; the provenance read inserted immediately before `const classifierInput = {` (`:1591`); the `classifierInput` literal itself (`:1591-1601`)
- Modify `server/test/divergence-sweep.test.ts` (append; and six new imports)

**Interfaces:**
- Consumes: `CoordStore.recentProvenance(sinceAt: number, limit: number): ProvenancePair[]` (Task 34); `ProvenancePair {id, at, obsClass, decSurface}` — structurally identical to `DivergenceInput['provenance'][number]`, which is why L1 can take it without importing it; `SessionRecord.supervisedAt: number | null` (`registry.ts:185`), already measured every tick by `readRegistry`.
- Consumes, from `divergence-sweep.test.ts`'s own shipped rig: `watcherFixture(cfg?)` (`:50`) returning `{home, bus, watcher, coord, projectsRoot, hooks, cfgObj, ccdCalls, reads, plantRecord, plantWorktreeRecord, records}`; `sweep(h)` (`:139`) = `h.watcher.sweepDivergences(await h.records())`; `jump(minutes)` (`:145`). There is NO `rig`, NO `r.w` and NO `r.records` array in that file — use these.
- Produces: no new signature. The sweep now supplies `nowMs`, `records[].supervisedAt` and `provenance`.

- [ ] **Step 1: Write the failing test.** Append to `server/test/divergence-sweep.test.ts`, and add these imports at the top:
  ```ts
  import { parseJournalLine } from '../src/coord/journalparse.js';
  import { ACTOR_CLASSES, corroboration, LC_ACT_UNKNOWN, LIFECYCLE_ACTS } from '../../shared/api.js';
  import type { Divergence } from '../../shared/api.js';
  ```
  then the block:
  ```ts
  describe('sweepDivergences feeds the build-9 arms from what it has already read', () => {
    const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
    const SURFACES = ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const;
    const DISAGREES = ACTOR_CLASSES.flatMap((c) => SURFACES.map((s) => [c, s] as const))
      .find(([c, s]) => corroboration(c, s) === 'disagrees')!;

    it('takes the provenance pairs from the mirror, bounded to the recent window', async () => {
      const h = await watcherFixture();
      h.plantRecord('demo-quiet-basin');
      const now = Date.now();
      h.coord!.ingestJournal({
        gen: '1755780000000000000', cursor: 200, size: 200, at: now,
        rows: [parseJournalLine(JSON.stringify({
          uid: 'a.1', at: now - 1000, act: AN_ACT, outcome: 'done', id: 'demo-quiet-basin',
          obs: { cg: DISAGREES[0] }, dec: { surface: DISAGREES[1] },
        }))],
      });
      const seen: Divergence[][] = [];
      h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
      await sweep(h);
      expect(seen.at(-1)!.map((d) => d.kind)).toContain('provenance-mismatch');
    });

    it('leaves a pair OUTSIDE the window alone — the census is a list of things to look at now', async () => {
      const h = await watcherFixture();
      h.plantRecord('demo-quiet-basin');
      const now = Date.now();
      h.coord!.ingestJournal({
        gen: '1755780000000000000', cursor: 200, size: 200, at: now,
        rows: [parseJournalLine(JSON.stringify({
          uid: 'a.1', at: now - 7_200_000, act: AN_ACT, outcome: 'done', id: 'demo-quiet-basin',
          obs: { cg: DISAGREES[0] }, dec: { surface: DISAGREES[1] },
        }))],
      });
      const seen: Divergence[][] = [];
      h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
      await sweep(h);
      expect(seen.at(-1) ?? []).not.toContainEqual(
        expect.objectContaining({ kind: 'provenance-mismatch' }));
    });

    it('reads the heartbeat off the SAME records the tick already measured — no second registry read', () => {
      // The lane takes one registry listing per sweep interval and no more; a
      // `supervisedAt` re-read here would be a whole-fleet field read a minute.
      // The slice ends on the method's OWN two-space closing brace (`:1618`),
      // not on the next member, so it cannot silently widen.
      const src = readFileSync(path.join(ccrcRoot, 'server/src/watch.ts'), 'utf8');
      const from = src.indexOf('  async sweepDivergences(');
      expect(from, 'sweepDivergences was not found — this assertion would pass vacuously')
        .toBeGreaterThan(-1);
      const body = src.slice(from, src.indexOf('\n  }\n', from));
      expect(body.length, 'the slice collapsed — this assertion would pass vacuously')
        .toBeGreaterThan(2000);
      expect(body).toContain('supervisedAt: r.supervisedAt');
      expect(body.match(/readRegistry\(/g) ?? []).toHaveLength(0);
    });

    it('supplies an EMPTY provenance list when the coordination database refuses, never a stale one', async () => {
      const h = await watcherFixture();
      h.plantRecord('demo-quiet-basin');
      h.coord!.db.exec('DROP TABLE lifecycle_events');
      const seen: Divergence[][] = [];
      h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
      await expect(sweep(h)).resolves.toBeUndefined();
      expect(seen.at(-1) ?? []).not.toContainEqual(
        expect.objectContaining({ kind: 'provenance-mismatch' }));
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/divergence-sweep.test.ts
  ```
  Expected: `AssertionError: expected [ 'unregistered-worktree' ] to contain 'provenance-mismatch'` at runtime, and `TS2739: Type '{ records: …; }' is missing the following properties from type 'DivergenceInput': nowMs, provenance` under `tsc -p test/tsconfig.tests.json`.

- [ ] **Step 3: Declare the window.** In `server/src/watch.ts`, immediately after Task 37's `export const LC_SWEEP_MS = 5_000;`:
  ```ts
  /** How far back the census weighs provenance pairs. One hour, not the whole
   *  table: a divergence the operator has already dealt with must stop being
   *  reported, and the durable record is `GET /api/lifecycle`. */
  const PROVENANCE_WINDOW_MS = 3_600_000;
  ```
  and add the type import:
  ```ts
  import type { ProvenancePair } from './coord/store.js';
  ```

- [ ] **Step 4: Read the pairs, degrading rather than returning.** In `sweepDivergences`, insert immediately BEFORE `const classifierInput = {` (`:1591`) — i.e. after the `// THE REGISTRY'S \`.branch\`, never the assembled …` comment block, which is about `records` and must keep its own subject:
  ```ts
      // EMPTY ON REFUSAL, never stale: an absence is not a disagreement, and the
      // same one-bad-read-must-not-kill-the-poll rule the `runs()` arm above
      // states — except this one DEGRADES rather than returning, because the
      // other four kinds are unaffected by a mirror this lane could not read.
      let provenance: ProvenancePair[] = [];
      try {
        provenance = this.deps.coord?.recentProvenance(now - PROVENANCE_WINDOW_MS, 500) ?? [];
      } catch (err) {
        console.warn(`ccrc-server: sweepDivergences recentProvenance failed (${err instanceof Error ? err.message : String(err)}) — no provenance findings this pass`);
      }
  ```

- [ ] **Step 5: Feed the arms.** Replace the `classifierInput` literal (`watch.ts:1591-1601`) with:
  ```ts
      const classifierInput = {
        records: records.map((r) => ({
          id: r.id, project: r.project, workspace: r.workspace, workdir: r.workdir,
          branch: r.branch, held: r.held, archivedAt: r.archivedAt,
          // OFF THE RECORDS THIS SWEEP WAS HANDED, never a second read. The tick
          // already measured `.supervised` for every row (`registry.ts:185`), and
          // a re-read here would be a whole-fleet field sweep a minute for a
          // number sitting in scope.
          supervisedAt: r.supervisedAt,
        })),
        worktrees, headBranch, openRunSessionIds,
        // THE REGISTRY'S OWN DIRECTORY LISTING — the evidence that a workspace
        // mid-`ws-add` is claimed before its row parses (see
        // `unclaimedWorktrees`), taken above AFTER git's records for the ordering
        // reason stated there.
        registryNames,
        // THE CLOCK, HANDED IN. `divergence.ts` is pure and reads no clock of its
        // own, so the census and the ladder cannot drift against each other by
        // reading two different `Date.now()`s.
        nowMs: now,
        // THE PAIRS, NOT THE VERDICT. `corroboration` is L0's and is called in
        // `divergence.ts`; this lane only reads rows. Bounded to the last hour so
        // a standing disagreement is re-reported while it stands and drops off
        // once the session has been restarted honestly — the census is a list of
        // things to look at now, not an archive (that is `GET /api/lifecycle`).
        provenance,
      };
  ```

- [ ] **Step 6: Run it and see it pass.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/divergence-sweep.test.ts test/divergence.test.ts
  ```

- [ ] **Step 7: Mutant check — re-read the registry for the heartbeat.** Replace `supervisedAt: r.supervisedAt` with a fresh `(await readRegistry(this.deps.io, this.deps.cfg)).find((x) => x.id === r.id)?.supervisedAt ?? null` lookup; re-run step 6.
  Mutant: a second whole-fleet registry read per census -> this test fails with `AssertionError: expected [ 'readRegistry(' ] to have a length of 0 but got 1` in `reads the heartbeat off the SAME records the tick already measured`. Restore.

- [ ] **Step 8: Mutant check — let a failed mirror read kill the sweep.** Delete the try/catch and call `recentProvenance` bare; re-run step 6.
  Mutant: no guard around the mirror read -> this test fails with `SqliteError: no such table: lifecycle_events` in `supplies an EMPTY provenance list when the coordination database refuses` — the whole census stops on a lane that has nothing to do with the other four kinds. Restore.

- [ ] **Step 9: Mutant check — unbound the window.** Change `now - PROVENANCE_WINDOW_MS` to `0`; re-run step 6.
  Mutant: weigh the whole table -> this test fails with `AssertionError: expected [ { kind: 'provenance-mismatch', … } ] not to contain an object matching { kind: 'provenance-mismatch' }` in `leaves a pair OUTSIDE the window alone`. Restore.

- [ ] **Step 10: Commit.**
  ```bash
  git add server/src/watch.ts server/test/divergence-sweep.test.ts && git commit -m "feat(watch): feed provenance pairs and the heartbeat into the census (build9 W4, D2/D9)"
  ```

---

### Task 42: `agent/test/whitelist.test.ts` — the journal is read-allowed and write-FORBIDDEN

Spec §2 says the only agent-side delta in this whole build is a **test**, and §4's table names it: *"Agent cannot write the journal | widen the write whitelist | `agent/test/whitelist.test.ts` — journal path read-allowed, write-forbidden."* Nothing else in wave 4 touches `agent/`, and `whitelist-subset.test.ts` still ships with ZERO edits — that remains the zero-grants proof.

**Files:**
- Modify `agent/test/whitelist.test.ts` — append one `it` inside the existing `describe('whitelist.checkPath')` (opens `:29`, closes `:93`), before that closing `});`; extend the import block (`:1-10`)

**Interfaces:**
- Consumes: `checkPath(targetPath: string, cfg: {home, projectsRoot}, mode: 'read' | 'write'): Promise<string | null>` (`agent/src/whitelist.ts:64`); the file's own `seed()` helper (`:41`), which mints a fresh `$HOME` with `.cc-sessions`, `.cc-limits`, `.cc-clips`, `.claude`, `.claude-corp`; `LC_DIR_NAME`, `LC_GEN_PREFIX`, `LC_GEN_SUFFIX`, `LC_ERRORS_NAME` from `shared/api.js` (`agent/tsconfig.json`'s `include` already carries `../shared/**/*.ts`).
- Produces: no source change anywhere. This is a pin over shipped behaviour.

- [ ] **Step 1: Write the test.** Add to `agent/test/whitelist.test.ts`'s import block:
  ```ts
  import { LC_DIR_NAME, LC_ERRORS_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX } from '../../shared/api.js';
  ```
  and append inside `describe('whitelist.checkPath')`, before its closing `});` (`:93`):
  ```ts
    it('the lifecycle journal is READ-allowed and WRITE-forbidden — the agent cannot corrupt the log it reads', async () => {
      // Build 9 spec §2/§4. The server mirrors `$HOME/.cc-sessions/.lifecycle/`
      // over the agent's EXISTING read grant — `.cc-sessions` is read-whitelisted
      // (`whitelist.ts:84`) and `canonicalize` walks up to the longest existing
      // prefix, so the path resolves before the directory exists. The whole
      // agent-side delta of this build is this test: zero new grants, zero new
      // frames, zero new capabilities.
      seed();
      const cfg = { home, projectsRoot };
      const lc = path.join(home, '.cc-sessions', LC_DIR_NAME);
      const journal = path.join(lc, `${LC_GEN_PREFIX}1755780000000000000${LC_GEN_SUFFIX}`);
      const errors = path.join(lc, LC_ERRORS_NAME);

      for (const p of [lc, journal, errors]) {
        expect(await checkPath(p, cfg, 'read'), `${p} must be readable`).not.toBeNull();
        // THE HALF THAT MATTERS. The write arm is `.cc-clips` and nothing else
        // (`whitelist.ts:79-80`), so the agent is STRUCTURALLY incapable of
        // truncating, appending to or rotating the record it serves — which is
        // what makes "a shrink is a truncation ccd did" a sound inference on
        // the server side, and it is a property of the whitelist rather than of
        // anyone's restraint.
        expect(await checkPath(p, cfg, 'write'), `${p} must NOT be writable`).toBeNull();
      }
    });
  ```

- [ ] **Step 2: Install the agent's dependencies and run it.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/agent && npm ci
  ```
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/agent && ./node_modules/.bin/vitest run test/whitelist.test.ts
  ```
  Expected: green. This test pins behaviour that already ships; its value is the mutant below, which is the only thing standing between the journal and a widened write arm.

- [ ] **Step 3: Mutant check — widen the write arm.** In `agent/src/whitelist.ts:79-80`, change the write arm to:
  ```ts
    if (mode === 'write') {
      return isUnder(canonicalTarget, path.join(canonicalHome, '.cc-clips'))
        || isUnder(canonicalTarget, path.join(canonicalHome, '.cc-sessions'))
        ? canonicalTarget : null;
    }
  ```
  and re-run step 2.
  Mutant: add `.cc-sessions` to the write arm -> this test fails with `AssertionError: <path>/.cc-sessions/.lifecycle must NOT be writable: expected '…/.lifecycle' to be null`, and the shipped `restricts writes to .cc-clips only` case (`:66`) reds beside it. Restore.

- [ ] **Step 4: Prove the zero-grants property is untouched.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/agent && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/whitelist-noghosts.test.ts
  ```
  ```bash
  git diff --stat main -- agent/test/whitelist-subset.test.ts
  ```
  Expected: both suites green, and the `git diff --stat` prints NOTHING — `whitelist-subset.test.ts` staying green with no edit is what proves this wave adds no grant.

- [ ] **Step 5: Commit.**
  ```bash
  git add agent/test/whitelist.test.ts && git commit -m "test(agent): the lifecycle journal is read-allowed and write-forbidden (build9 W4, spec §2/§4)"
  ```

---
### Task 43: whole-suite verification, then the AGENT-FIRST deploy

**Files:** none.

**Interfaces:**
- Consumes: everything Tasks 27-42 shipped.
- Produces: a green server suite, a green agent suite with zero agent-source edits, and a live `/api/fleet/health` reporting `lifecycle.state === 'ok'`.
- **AGENT-FIRST.** Task 38 edits `ccd/coordinator-skill/references/wave-lifecycle.md`, and anything under `ccd/` ships to the fleet host BEFORE the server. `deploy.sh agent <host>` falls back to `$CCRC_BOX` when the host argument is omitted (`deploy/deploy.sh:19`), so the two commands below name it that way rather than carrying a literal.

- [ ] **Step 1: Typecheck the source.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
  ```
  Expected: no output, exit 0.

- [ ] **Step 2: Typecheck the tests** — `server/tsconfig.json`'s `include` is `["src/**/*.ts","../shared/**/*.ts"]`, so `test/` is only compiled by its own project.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && node ./node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
  ```
  Expected: no output, exit 0.

- [ ] **Step 3: Run the server suite in the FOREGROUND, timeout >= 600000 ms.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
  ```

- [ ] **Step 4: Re-run each known load-flake suite IN ISOLATION.** Four of the five are in this wave's blast radius, and a failure in one of them is not a break until it has failed on an idle box.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts
  ```
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/pr-sweep.test.ts
  ```
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-session-state.test.ts
  ```
  `ccd-session-state`'s known window is *the supervisor heartbeat > a swap re-stamps while it carries* (`expected ['mid-carry:orphan'] to include 'mid-carry:restarting'`); measured 0/6 on an idle box, so **a single green isolated run is not proof it was the load**. CI on the quiet box is the arbiter.

- [ ] **Step 5: Prove the agent's source is untouched.** Task 42 edited exactly one agent TEST file and no agent source.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/agent && npm run test
  ```
  ```bash
  git diff --stat main -- agent/src
  ```
  Expected: the suite green, and `git diff --stat` prints NOTHING. Zero grants, zero frames, zero capabilities — `$HOME/.cc-sessions/.lifecycle/…` is read-allowed before the directory exists because `whitelist.ts` walks up to the longest existing prefix, which Task 42 pins.

- [ ] **Step 6: Prove `wsaudit.test.ts` is green with NO edit** — itself an assertion of this program (D15). Nothing in wave 4 writes a `"refused":` literal; the journal field is spelled `refusal` everywhere.
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/wsaudit.test.ts
  ```
  ```bash
  git diff --stat main -- server/test/wsaudit.test.ts
  ```
  Expected: green, and the diff prints nothing.

- [ ] **Step 7: Deploy the fleet host FIRST.** `ccd/coordinator-skill/references/wave-lifecycle.md` changed, and anything under `ccd/` is agent-first by contract.
  ```bash
  bash deploy/deploy.sh agent "$CCRC_BOX"
  ```

- [ ] **Step 8: Deploy the server.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river && bash deploy/deploy.sh
  ```
  The server lane's final gate is `/health` reporting the shipped sha.

- [ ] **Step 9: Confirm the mirror woke up.**
  ```bash
  curl -s -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" http://<server-host>:7788/api/fleet/health | head -c 400
  ```
  Expected: a `lifecycle` block with `"state":"ok"` and a non-zero `rows` — waves 2-3 have been filling the journal dark. `"state":"unavailable"` means the fleet host is running a ccd that predates wave 2: deploy the AGENT lane again, not the server. `"state":"unknown"` immediately after a restart is correct and clears on the first sweep. A non-zero `gaps` is worth reading before anything else — `GET /api/lifecycle` returns them beside the events.

- [ ] **Step 10: Verify the read surface answers from the fleet host, cookieless** — the property D16 exists for.
  ```bash
  ssh "$CCRC_BOX" 'curl -s -H "x-ccrc-mail-token: $(cat ~/.cc-secrets/ccrc-mail.token)" "http://<server-host>:7788/api/lifecycle?limit=5" | head -c 600'
  ```
  Expected: a `{"events":[…],"gaps":[…]}` body. A `401` here means the EXEMPT entry did not ship; a `501` means the server box has no `coord.db`, which it does.

- [ ] **Step 11: Record the one irreversible step.** `MIGRATIONS[2]` has run. Rolling the server back to the previous build leaves the three tables in place and unread: `db.ts` warns, reads, and refuses only to MIGRATE, and `SELECT *` is banned in `coord/` so the unknown tables are simply never named. Harmless — and it is the only step of this wave that does not roll back. Note it in the wave's handoff mail rather than leaving it to be rediscovered.

---

### Task 44: verify wave 3's dec validators, and bind `_LC_DEC_MAX` across the language boundary

> **Standing note for every ccd task in this group (AUDIT m7).** `ccd-actor-flags.test.ts` matches
> `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/` containment scan. It is compliant because it never
> spawns bash itself — every ccd invocation goes through `h.sh` (`makeCcdHarness`, which builds its own
> `ghContainedEnv`), so the scan's `execFileSync\(('bash'|BASH)[,)]/` regex matches nothing in it. Do not
> add a direct `execFileSync('bash', …)` to this file; if you ever need one, it must carry
> `ghContainedEnv(` and `{ systemd: true }` in the twelve lines around it.
>
> **Standing note on `_lc_obs` and tmux (HEAD AUDIT w23, M-A).** Wave 2's `_lc_obs` shells the real
> `tmux` if one is on PATH, and `makeCcdHarness` does not remove the system PATH or set `TMUX_TMPDIR`.
> Until the harness grows a `tmux` poison, **every snippet in this group that can reach an emit site is
> prefixed with `tmux() { return 1; };`**, so `obs.paneWhy` is deterministically `not-listed` and no test
> in this file ever touches the live tmux server (CLAUDE.md SAFETY).

**Files:**
- Create `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-actor-flags.test.ts`
- Does NOT touch `server/test/lifecycle-constants-twin.test.ts` — **Task 9 owns that file**. This task is what flips its wave-3 world from `absent` to `present`.
- **No `ccd/ccd` edit.** AUDIT **B5** moved `_LC_DEC_MAX` / `_lc_surface_norm` / `_lc_dec_ok` out of wave 5
  and into **wave 3**, because Task 24's `--reason` on `ws-rm`/`forget` needs them first. This task
  verifies they landed and pins their contract; it writes no bash.

**Interfaces:**
- *Consumes* (all shipped by wave 3, in `ccd/ccd`):
  - `_LC_DEC_MAX` — file-scope integer, `512`.
  - `_lc_surface_norm <word>` → prints `<word>` when it is a member of `ccd:619`'s closed set
    `cli|pwa|agent|ccd`, else prints `unknown`. Exit 0 on every path, **never `die`s** — it is called
    inside `$( )`, and `ccd-die-containment.test.ts:350` treats a fatal thing wrapped in a command
    substitution as a defect.
  - `_lc_dec_ok <value>` → exit **0** iff `<value>` is non-blank after a whitespace strip **and** at most
    `_LC_DEC_MAX` **BYTES**. Prints nothing and **never `die`s** — every caller spells
    `_lc_dec_ok "$x" || die …`, so the refusal is the verb's, not the predicate's.
- *Consumes* (wave 1, `shared/api.ts`): `LC_REASON_MAX_BYTES` (512), `LC_LINE_MAX` (2048),
  `LC_GEN_MAX_BYTES` (4 MiB), `LC_GEN_KEEP` (4).
- *Consumes* (shipped today): `makeCcdHarness`, `type CcdHarness`, `CCD` from `server/test/ccdWsHelpers.ts`.
- *Produces:*
  - `server/test/ccd-actor-flags.test.ts`, exporting nothing but declaring two file-local helpers that
    Tasks 45–49 append to: `shFail(snippet) => { code, stderr, stdout }` and
    `seedWorkspace(id?) => string`.
  - `server/test/lifecycle-constants-twin.test.ts` — the cross-language binding AUDIT **B5** requires.

**Steps:**

- [ ] **Step 1: confirm wave 3 landed the three helpers, and stop if it did not.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && grep -n '^_LC_DEC_MAX=\|^_lc_surface_norm() {\|^_lc_dec_ok() {' ccd/ccd
```
Expected: exactly three lines, one per symbol. If the output is empty, **wave 3 has not landed B5's move
— stop here and say so**; nothing in this group can be written against a `ccd/ccd` that has no `_lc_*`.
(Measured at `ws/still-river` `52a3cf7`, before waves 2–3: `grep -c '_lc_' ccd/ccd` → `0`, which is why
every ccd anchor in this group is expressed as a **grep**, never as a line number — waves 2 and 3 insert
several hundred lines above every verb this group touches.)

- [ ] **Step 2: write the pin file.** Create `server/test/ccd-actor-flags.test.ts`:

```ts
// server/test/ccd-actor-flags.test.ts
//
// Wave 5 — the `--surface`/`--actor`/`--reason` flag loops on the five
// non-deleting workspace verbs, and wave 5's pins over the three validators
// WAVE 3 ships (`_LC_DEC_MAX`, `_lc_surface_norm`, `_lc_dec_ok`). Three
// properties are pinned here that no other suite can see:
//
//   1. GIVENNESS IS NOT VALUE. `--surface` absent is `none`; `--surface ''` is
//      `unknown`. Collapsing them is `ccd:618`'s `${2-ccd}` vs `${2:-ccd}`
//      distinction broken in a new place.
//   2. THE CAP IS BYTES, AND THE POLICY IS REFUSE. 512 BYTES, never 512
//      characters and never a silent truncation: a 900-byte reason recorded as
//      512 reads as the operator's own words (AUDIT B5).
//   3. ONLY LENGTHS REACH ARITHMETIC. `--actor`/`--reason` are free text off
//      the wire; `ccd:8780-8791` records what a hostile argv word does once it
//      lands in a `(( ))` or an array subscript.
//
// CONTAINMENT: every ccd call here goes through `h.sh`, so this file spawns no
// bash of its own and `ccd-workspaces.test.ts:1045`'s scan matches nothing in
// it. Snippets that can reach an emit site stub `tmux` (HEAD AUDIT w23 M-A).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-actorflags-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh` throws on a non-zero exit; this reports the exit code, stdout and
 *  stderr instead, which is what every refusal assertion below needs. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** A workspace row complete enough for the five verbs to get past `no such
 *  session` / `not a workspace` and reach their own bodies. */
const seedWorkspace = (id = 'demo-quiet-basin'): string => {
  h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
    _reg_set ${id} project demo
    _reg_set ${id} workspace quiet-basin
    _reg_set ${id} workdir ${h.home}/worktrees/demo/quiet-basin
    _reg_set ${id} branch ws/quiet-basin
    _reg_set ${id} wrapper claude`);
  return id;
};

describe('_lc_surface_norm — ccd:619 closed set, spelled once more and never a third time', () => {
  it.each(['cli', 'pwa', 'agent', 'ccd'])('passes %s through unchanged', (word) => {
    expect(h.sh(`_lc_surface_norm ${word}`)).toBe(word);
  });

  it('answers `unknown` for a word outside the set, including the empty string', () => {
    expect(h.sh(`_lc_surface_norm zzz`)).toBe('unknown');
    expect(h.sh(`_lc_surface_norm ''`)).toBe('unknown');
    // `none` is the ABSENT marker, so a caller that literally says `--surface
    // none` has said a word this ccd does not know — not "no flag".
    expect(h.sh(`_lc_surface_norm none`)).toBe('unknown');
  });

  it('never dies — it is called inside $( ), where a die kills only the subshell', () => {
    // `ccd-die-containment.test.ts:350` is the standing guard; this is the
    // behavioural half for the one helper wave 5 wraps in a substitution.
    expect(h.sh(`x=$(_lc_surface_norm ''); printf 'AFTER:%s' "$x"`)).toBe('AFTER:unknown');
  });
});

describe('_lc_dec_ok — a declaration that says nothing is not a declaration', () => {
  it('accepts ordinary free text', () => {
    expect(shFail(`_lc_dec_ok 'device:Mozilla/5.0 (iPhone)'`).code).toBe(0);
  });

  it('refuses blank and whitespace-only values (cmd_ws_hold ccd:2537 polarity)', () => {
    expect(shFail(`_lc_dec_ok ''`).code).not.toBe(0);
    expect(shFail(`_lc_dec_ok '   '`).code).not.toBe(0);
    expect(shFail(`_lc_dec_ok "$(printf '\\t')"`).code).not.toBe(0);
  });

  it('measures BYTES, not characters — and REFUSES rather than truncating', () => {
    // AUDIT B5: one number, one unit, one policy. 512 one-byte characters sits
    // at the cap and is accepted; 513 is refused.
    expect(shFail(`_lc_dec_ok "$(printf 'a%.0s' {1..512})"`).code).toBe(0);
    expect(shFail(`_lc_dec_ok "$(printf 'a%.0s' {1..513})"`).code).not.toBe(0);
    // 200 four-byte characters = 800 BYTES but only 200 CHARACTERS. A character
    // cap would accept this and hand `_lc_json` an 800-byte field — over a
    // third of `LC_LINE_MAX` spent on one declaration.
    expect(shFail(`_lc_dec_ok "$(printf '\\U0001F600%.0s' {1..200})"`).code).not.toBe(0);
  });

  it('prints nothing and never dies — the refusal belongs to the VERB', () => {
    const r = shFail(`_lc_dec_ok ''; printf 'AFTER:%s' "$?"`);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('AFTER:1');
  });

  it('never evaluates the value — only its length reaches an arithmetic context', () => {
    const canary = `${h.home}/pwned`;
    expect(shFail(`_lc_dec_ok 'x[$(touch ${canary})]'`).code).toBe(0);
    expect(shFail(`_lc_dec_ok '$(touch ${canary})'`).code).toBe(0);
    expect(h.sh(`[[ -e '${canary}' ]] && echo yes || echo no`)).toBe('no');
  });

  it('scopes its byte measurement — the caller keeps counting what it counted', () => {
    // AUDIT M2: an absolute `4` here is environment-dependent. Measured on this
    // box: `LANG=en_US.UTF-8` -> 4, `env -u LANG -u LC_ALL bash` -> 5, and
    // `makeCcdHarness` inherits `process.env`, so the answer depended on
    // whoever launched vitest. The PROPERTY is that `_lc_dec_ok`'s
    // `local LC_ALL=C` is restored when the local goes out of scope, so the pin
    // is BEFORE == AFTER, under a locale this snippet sets itself.
    const out = h.sh(
      `LC_ALL=C.UTF-8; s=$'caf\\u00e9'; before=\${#s}; _lc_dec_ok "$s"; after=\${#s}; ` +
      `printf '%s %s' "$before" "$after"`);
    const [before, after] = out.split(' ');
    expect(after, 'the helper leaked its LC_ALL into the caller').toBe(before);
    expect(before, 'under the locale this snippet pinned, and only there').toBe('4');
  });
});

describe('the closed set is spelled exactly twice in ccd', () => {
  it('appears at _ws_unsupervise and in _lc_surface_norm, and nowhere else', () => {
    // ONE more copy than shipped, deliberately, and never a third. Five inline
    // `case "$surface" in cli|pwa|agent|ccd)` copies — one per wave-5 verb — is
    // the drift shape `wsaudit.test.ts` exists to catch, one language over: a
    // fifth surface word added to `_ws_unsupervise` and to four of the five
    // verbs is green everywhere and wrong on one verb forever.
    const hits = readFileSync(CCD, 'utf8').split('\n')
      .filter((l) => l.includes('cli|pwa|agent|ccd'));
    expect(hits, `the closed set is spelled ${hits.length} times:\n${hits.join('\n')}`)
      .toHaveLength(2);
  });
});
```

- [ ] **Step 3: run it.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts
```
Expected: **green on arrival, and that is stated rather than hidden.** This task is a PIN over wave 3's
code (AUDIT B5), not a new implementation — there is no red to open on, so its red is measured by the
three mutants in steps 4–6. Do not "make it red first" by deleting wave 3's helpers.

- [ ] **Step 4: mutant — the unit.** In `ccd/ccd`, change `_lc_dec_ok`'s `local LC_ALL=C` to
`local LC_ALL=C.UTF-8` and re-run the command in step 3.
Mutant: `local LC_ALL=C` → `local LC_ALL=C.UTF-8` -> `measures BYTES, not characters — and REFUSES
rather than truncating` fails with `expected 0 not to be 0` (the 200-emoji value is accepted at 200
characters). Restore the line and re-run to green.

- [ ] **Step 5: mutant — the blank guard.** Delete `_lc_dec_ok`'s
`[[ -n "${1//[[:space:]]/}" ]] || return 1` line and re-run.
Mutant: drop the blank guard -> `refuses blank and whitespace-only values` fails with
`expected 0 not to be 0`. Restore and re-run to green.

- [ ] **Step 6: mutant — the closed-set count.** Add a third inline
`case "$s" in cli|pwa|agent|ccd) ;; esac` anywhere in `ccd/ccd` and re-run.
Mutant: a third inline copy -> `appears at _ws_unsupervise and in _lc_surface_norm, and nowhere else`
fails with `expected [ …3 lines… ] to have a length of 2 but got 3`. Remove it and re-run to green.

- [ ] **Step 7: Confirm Task 9's twin test now reads the wave-3 world as `present`.**

  `server/test/lifecycle-constants-twin.test.ts` was created in Task 9 and is the ONE place the
  number lives in two languages. Do not write a second copy of it. Wave 3 declared `_LC_DEC_MAX`,
  `_lc_surface_norm` and `_lc_dec_ok`, so its wave-3 world must now classify `present`:

  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/lifecycle-constants-twin.test.ts
  ```

  Expected: PASS. A `half` verdict here means wave 3 landed only partly — that is the illegal middle
  the classifier exists to catch, and it must be reconciled before this wave continues.

- [ ] **Step 8: run the twin.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-constants-twin.test.ts
```
Expected: green. Mutant: change `_LC_DEC_MAX=512` to `_LC_DEC_MAX=256` in `ccd/ccd` and re-run ->
`_LC_DEC_MAX equals its L0 twin` fails with `expected 256 to be 512`. Restore and re-run to green.

- [ ] **Step 9: commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/test/ccd-actor-flags.test.ts server/test/lifecycle-constants-twin.test.ts && git commit -m "test(wave5): pin wave 3's dec validators, and bind _LC_DEC_MAX to L0

B5's ruling made concrete: one number, one unit (BYTES), one policy
(REFUSE). The closed set stays spelled exactly twice; _lc_dec_ok's
LC_ALL is scoped, measured as before==after rather than as an absolute
character count that depends on who launched vitest."
```

---

### Task 45: the flag loop on `ws-archive`

**AGENT-FIRST.** This task edits `ccd/`, so nothing it produces reaches the fleet until Task 50's
`bash deploy/deploy.sh agent "$CCRC_BOX"`. No server change may ship before that deploy (Task 56 states
the ordering as a hard gate).

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/ccd/ccd` — insert inside `cmd_ws_archive`,
  immediately **above** its arity guard. Locate it (the line number moves once waves 2–3 land; measured
  at `52a3cf7` it was `ccd:2647`):
  `grep -n 'die "usage: ccd ws-archive --session <id>"' ccd/ccd`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-actor-flags.test.ts`

**Interfaces:**
- *Consumes:* `_lc_surface_norm`, `_lc_dec_ok`, `_LC_DEC_MAX` (wave 3); `shFail`, `seedWorkspace` (Task 44).
- *Produces:* `cmd_ws_archive` accepts `[--surface <word>] [--actor <text>] [--reason <text>]` in any
  position and in the `--flag=value` form, and leaves three function-locals set for Task 49:
  - `lc_surface` — a member of `cli|pwa|agent|ccd`, or `unknown`, or `none` when no flag was given.
  - `lc_actor` — the declared actor, or `''` when absent.
  - `lc_reason` — the declared reason, or `''` when absent.

**Steps:**

- [ ] **Step 1: write the failing tests.** Append to `server/test/ccd-actor-flags.test.ts`:

```ts
/** Stubs every irreversible thing `cmd_ws_archive` does, so these cases measure
 *  ARGV PARSING and nothing else. `tmux` is stubbed for wave 2's `_lc_obs`
 *  (HEAD AUDIT w23 M-A) — without it these snippets shell the live tmux. */
const ARCHIVE_STUBS = `tmux() { return 1; }; _ws_unsupervise() { :; };
  _ws_idle_ok() { return 0; }; _ws_status() { echo idle; }; _ws_archive_manifest() { echo '{}'; };`;

describe('ws-archive accepts the dec flags in any position', () => {
  it.each([
    ['before the required flag', `--surface pwa --session ID`],
    ['after the required flag',  `--session ID --surface pwa`],
    ['in the --flag=value form', `--session ID --surface=pwa`],
    ['with all three flags',     `--session ID --surface pwa --actor 'device:iPhone' --reason 'tidy'`],
  ])('parses --surface %s', (_name, tail) => {
    const id = seedWorkspace();
    expect(shFail(`${ARCHIVE_STUBS} cmd_ws_archive ${tail.replace('ID', id)} >/dev/null`).code).toBe(0);
  });

  it('treats a blank --surface as a word it does not know, never as no flag', () => {
    const id = seedWorkspace();
    // `--surface ''` is ACCEPTED (a caller may honestly not know its own
    // surface) and normalises to `unknown`. What it must never do is normalise
    // to `none`, which is the marker for "no flag was given at all". The
    // recorded VALUE is asserted on the journal line in Task 49; here the pin is
    // that the verb neither refuses it nor treats it as the absent case.
    expect(shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --surface '' >/dev/null`).code).toBe(0);
    expect(h.sh(`_lc_surface_norm ''`)).toBe('unknown');
  });

  it('refuses a --surface with no value rather than looping forever', () => {
    // `shift 2` past the end of argv FAILS under `set -uo pipefail` with no
    // `-e`: it shifts nothing and the loop never terminates (ccd:9610-9612 says
    // so about `cmd_stop`'s identical loop).
    const id = seedWorkspace();
    const r = shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --surface`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-archive');
  });

  it('refuses a blank --actor, and an over-long one, naming the flag', () => {
    const id = seedWorkspace();
    const blank = shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --actor ''`);
    expect(blank.code).not.toBe(0);
    expect(blank.stderr).toContain('--actor');
    const long = shFail(
      `${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --actor "$(printf 'a%.0s' {1..513})"`);
    expect(long.code).not.toBe(0);
    expect(long.stderr).toContain('--actor');
  });

  it('still refuses extra positionals — the arity rule survives the strip', () => {
    const id = seedWorkspace();
    const r = shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} extra`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-archive --session <id>');
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts -t 'ws-archive accepts the dec flags'
```
Expected failure: `parses --surface before the required flag` fails with `expected 1 to be 0`, and the
snippet's stderr carries `ccd: usage: ccd ws-archive --session <id>` — today the flags are extra argv,
so `[[ $# -eq 2 ]]` fails and the verb `die`s.

- [ ] **Step 3: write the implementation.** In `ccd/ccd`, insert immediately **above** the line
`  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-archive --session <id>"`:

```bash
  # WAVE 5 — THE DEC FLAGS ARE STRIPPED BEFORE THE ARITY RULE, and that order
  # is the whole correctness argument, exactly as `cmd_stop` states it in its
  # own header (grep `FLAGS ARE STRIPPED BEFORE THE ARITY RULE`): this verb's
  # guard is EXACT arity on `--session <id>`, so a flag left in argv is not a
  # wider call, it is a REFUSED one — `ccd ws-archive --session x --surface pwa`
  # would die in the usage check while the server reads the non-zero as "the
  # archive failed on the box".
  #
  # THREE `given` FLAGS, not three value tests. `--surface ''` and no
  # `--surface` at all are two different facts: nobody declared a surface
  # (`none`), versus a caller declared a word this ccd does not know
  # (`unknown`). Testing `[[ -n "$lc_surface" ]]` instead would collapse them,
  # which is `ccd:618`'s `${2-ccd}` vs `${2:-ccd}` distinction broken in a new
  # place. Same for `--actor ''` and `--reason ''`, which are REFUSED rather
  # than silently read as absent — one policy, everywhere (AUDIT B5).
  local lc_surface=none lc_actor='' lc_reason='' lc_gs=0 lc_ga=0 lc_gr=0 lc_args=()
  while (( $# )); do
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates (`cmd_stop` carries the
      # same three lines over the same hazard).
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-archive [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-archive [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      --reason)    [[ $# -ge 2 ]] || die "usage: ccd ws-archive [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
                   lc_gr=1; lc_reason="$2"; shift 2 ;;
      --reason=*)  lc_gr=1; lc_reason="${1#--reason=}"; shift ;;
      *)           lc_args+=("$1"); shift ;;
    esac
  done
  # bash >= 4.4 (the fleet host runs 5.2, ccd:9393-9394): an empty array here
  # is not an unbound-variable error under `set -u`.
  set -- "${lc_args[@]}"
  if (( lc_gs )); then lc_surface=$(_lc_surface_norm "$lc_surface"); fi
  if (( lc_ga )); then _lc_dec_ok "$lc_actor"  || die "--actor must be non-blank and at most $_LC_DEC_MAX bytes"; fi
  if (( lc_gr )); then _lc_dec_ok "$lc_reason" || die "--reason must be non-blank and at most $_LC_DEC_MAX bytes"; fi
```

- [ ] **Step 4: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts
```
Expected: green.

- [ ] **Step 5: run the three suites this verb already has, and see them unchanged.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/wsaudit.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts
```
Expected: all three green **with zero edits**. `wsaudit.test.ts` green is the assertion that this task
added no refusal token. `ccd-refusal-scan.test.ts` (wave 3) green is the assertion that `cmd_ws_archive`
is **not** one of its four sliced bodies — measured, its VERBS list is
`['cmd_ws_rm','cmd_ws_rename'] ['cmd_forget','cmd_ls'] ['cmd_ws_restore','cmd_ws_attic'] ['cmd_ws_reap','_ws_reap_locked']`
(AUDIT M5), so a bare `die` is legal here and is **not** legal in Task 46's verb.

- [ ] **Step 6: mutant — the strip order.** Move the `set -- "${lc_args[@]}"` line *below* the arity
guard and re-run step 4.
Mutant: strip after the arity rule -> `parses --surface before the required flag` fails with
`expected 1 to be 0` and stderr `usage: ccd ws-archive --session <id>`. Restore.

- [ ] **Step 7: mutant — givenness.** Replace `if (( lc_ga ))` with `if [[ -n "$lc_actor" ]]` and re-run.
Mutant: value-test instead of given-test -> `refuses a blank --actor, and an over-long one, naming the
flag` fails with `expected 0 not to be 0`. Restore.

- [ ] **Step 8: re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-actor-flags.test.ts && git commit -m "ccd(wave5): --surface/--actor/--reason on ws-archive

Flags stripped BEFORE the exact-arity rule (cmd_stop's order). Givenness
is not value: --surface absent is none, --surface '' is unknown. Blank and
over-long declarations are REFUSED, never truncated (B5)."
```

---

### Task 46: the flag loop on `ws-restore` — its refusals ride `_lc_refuse`

**AGENT-FIRST.** Ships with Task 50's agent deploy.

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/ccd/ccd` — insert inside `cmd_ws_restore`,
  immediately **above** its arity refusal. Locate it (measured at `52a3cf7` it was the bare
  `die "usage: ccd ws-restore --session <id>"` at `ccd:3034`; **wave 3 has since converted it** to
  `_lc_refuse restore "" bad-args …`, per AUDIT B1):
  `grep -n 'usage: ccd ws-restore --session <id>' ccd/ccd`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-actor-flags.test.ts`

**Interfaces:**
- *Consumes:* `_lc_surface_norm`, `_lc_dec_ok`, `_LC_DEC_MAX` (wave 3);
  `_lc_refuse <act> <id> <token> <detail> [key value]...` (wave 2; emits a `refused` line, then `die`s) —
  the canonical signature from AUDIT **B4**; `shFail`, `seedWorkspace` (Task 44).
- *Produces:* `cmd_ws_restore` accepts the same three flags as Task 45 and leaves the same three locals,
  and **every refusal it adds is a `_lc_refuse restore "" bad-args …`, never a bare `die "`.**

**Steps:**

- [ ] **Step 1: confirm this body is scanned, so the shape is forced rather than chosen.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts -t 'cmd_ws_restore'
```
Expected: green today. `cmd_ws_restore` **is** one of wave 3's four sliced bodies (AUDIT M5's VERBS list
pairs it with `cmd_ws_attic` as the terminator — measured, `cmd_ws_restore` opens at `ccd:3026` and
`cmd_ws_attic` at `ccd:3147` in the pre-wave tree), so a bare `die "` added below would red it. That is
the whole reason this verb gets its own task instead of sharing Task 45's.

- [ ] **Step 2: write the failing tests.** Append to `server/test/ccd-actor-flags.test.ts`:

```ts
describe('ws-restore takes the same three flags, and refuses through _lc_refuse', () => {
  const RESTORE_STUBS = `tmux() { return 1; }; flock() { return 0; };
    _ws_supervise() { :; }; _spawn() { :; };`;

  it('refuses a valueless --surface with its OWN usage sentence', () => {
    const id = seedWorkspace();
    const r = shFail(`${RESTORE_STUBS} cmd_ws_restore --session ${id} --surface`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-restore');
  });

  it('refuses a blank --actor, naming the flag', () => {
    const id = seedWorkspace();
    const r = shFail(`${RESTORE_STUBS} cmd_ws_restore --session ${id} --actor ''`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--actor');
  });

  it('adds NO bare `die "` to a body wave 3 scans', () => {
    // The mechanism, not the instance: `ccd-refusal-scan.test.ts` slices
    // `cmd_ws_restore` and requires every fatal refusal in it to go through
    // `_lc_refuse`, so that a destroyed-or-refused act leaves a record. This
    // assertion is the local half, so the failure names THIS task's block
    // rather than arriving as a scanner red four files away.
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('\ncmd_ws_restore() {');
    const to = src.indexOf('\ncmd_ws_attic() {', from);
    expect(from, 'cmd_ws_restore was not found').toBeGreaterThan(-1);
    expect(to, 'cmd_ws_attic was not found — the slice has no end').toBeGreaterThan(from);
    const body = src.slice(from, to).split('\n');
    expect(body.length, 'the slice collapsed').toBeGreaterThan(50);
    const bare = body.filter((l) => /\bdie "/.test(l) && !/^\s*#/.test(l))
      .filter((l) => l.includes('--surface') || l.includes('--actor') || l.includes('--reason'));
    expect(bare, `wave-5 flag refusals must ride _lc_refuse:\n${bare.join('\n')}`).toEqual([]);
  });
});
```

- [ ] **Step 3: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts -t 'ws-restore takes the same three flags'
```
Expected failure: `refuses a valueless --surface with its OWN usage sentence` fails with
`expected '' to contain 'usage: ccd ws-restore'` — today an unknown flag is just an extra positional, so
the verb's own arity refusal fires first and its sentence has already been reworded by wave 3.

- [ ] **Step 4: write the implementation.** In `ccd/ccd`, insert immediately **above**
`cmd_ws_restore`'s arity refusal (the line found by step 1's grep):

```bash
  # WAVE 5 — THE DEC FLAGS, stripped before the exact-arity rule for Task 45's
  # reason, and REFUSED THROUGH `_lc_refuse` rather than through `die` for a
  # second reason that is specific to this verb: `ccd-refusal-scan.test.ts`
  # (wave 3) slices `cmd_ws_restore`'s body and requires every fatal refusal in
  # it to leave a journal line first. A bare `die` here would be a refusal on a
  # destructive-adjacent verb that nothing can read afterwards, which is the
  # hole D4 exists to close.
  #
  # `""` FOR THE ID, deliberately: this loop runs BEFORE `local id=$2`, so
  # there is no session to name yet. An empty id is "no subject was measured",
  # which is a different fact from a wrong one.
  #
  # `bad-args` IS THE TOKEN, the one this file already spells (`cmd_ws_rename`'s
  # inline literals, and `wsaudit.ts`'s SENTENCES entry for it). Inventing
  # `bad-surface` would need new copy in `SENTENCES` and would red
  # `wsaudit.test.ts` in both directions.
  local lc_surface=none lc_actor='' lc_reason='' lc_gs=0 lc_ga=0 lc_gr=0 lc_args=()
  while (( $# )); do
    case "$1" in
      --surface)   [[ $# -ge 2 ]] || _lc_refuse restore "" bad-args "usage: ccd ws-restore [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || _lc_refuse restore "" bad-args "usage: ccd ws-restore [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      --reason)    [[ $# -ge 2 ]] || _lc_refuse restore "" bad-args "usage: ccd ws-restore [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
                   lc_gr=1; lc_reason="$2"; shift 2 ;;
      --reason=*)  lc_gr=1; lc_reason="${1#--reason=}"; shift ;;
      *)           lc_args+=("$1"); shift ;;
    esac
  done
  set -- "${lc_args[@]}"
  if (( lc_gs )); then lc_surface=$(_lc_surface_norm "$lc_surface"); fi
  if (( lc_ga )); then _lc_dec_ok "$lc_actor"  || _lc_refuse restore "" bad-args "--actor must be non-blank and at most $_LC_DEC_MAX bytes"; fi
  if (( lc_gr )); then _lc_dec_ok "$lc_reason" || _lc_refuse restore "" bad-args "--reason must be non-blank and at most $_LC_DEC_MAX bytes"; fi
```

**Do NOT move this block below the reap-lock acquisition** (`exec {lfd}>>"$lock"`, measured at `ccd:3073`
in the pre-wave tree; find it with `grep -n 'cannot open the reap lock' ccd/ccd`). Everything in this
block can end the process, and `ccd`'s own note there says the `die`s above the lock need no close of
their own precisely because the kernel closes what exits — a fatal path *inside* the region would leave
the descriptor open in a sourcing shell and answer `in-progress` to every later `ws-reap` on that id.

- [ ] **Step 5: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-restore-supersede.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-restore-reap-lock.test.ts
```
Expected: all four green.

- [ ] **Step 6: mutant — the refusal shape.** Change the first `_lc_refuse restore "" bad-args "usage: …"`
to `die "usage: …"` and re-run step 5.
Mutant: `_lc_refuse` -> `die` -> `adds NO bare 'die "' to a body wave 3 scans` fails with
`wave-5 flag refusals must ride _lc_refuse:` naming the line, and `ccd-refusal-scan.test.ts` reds on the
same line. Restore.

- [ ] **Step 7: mutant — the lock ordering.** Move the whole block below the `exec {lfd}>>"$lock"` line
and re-run `test/ccd-restore-reap-lock.test.ts`.
Mutant: strip inside the lock region -> the reap-lock suite fails with a leaked descriptor
(`in-progress` on a second `ws-reap` in the same shell). Restore.

- [ ] **Step 8: re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-actor-flags.test.ts && git commit -m "ccd(wave5): the dec flags on ws-restore, refusing through _lc_refuse

This body is one of wave 3's four scanned slices, so a flag refusal here
has to leave a record before it dies. Above the reap lock, never inside
it: a fatal path in the region leaks the descriptor in a sourcing shell."
```

---

### Task 47: the flag loop on `ws-hold` and `ws-release` — one reason, not two

**AGENT-FIRST.** Ships with Task 50's agent deploy.

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/ccd/ccd` — two inserts. Locate them:
  `grep -n 'usage: ccd ws-hold --session <id> --reason <text>' ccd/ccd` (measured at `52a3cf7`:
  `ccd:2517-2518`, with `local id=$2 reason=$4` at `ccd:2519`) and
  `grep -n 'usage: ccd ws-release --session <id>' ccd/ccd` (measured: `ccd:2582`).
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-actor-flags.test.ts`

**Interfaces:**
- *Consumes:* `_lc_surface_norm`, `_lc_dec_ok`, `_LC_DEC_MAX`; `shFail`, `seedWorkspace`; `h.reg(id, field)`
  from `ccdWsHelpers.ts`.
- *Produces:*
  - `cmd_ws_hold` accepts `[--surface <word>] [--actor <text>]` — **two flags, not three** — and leaves
    `lc_surface`, `lc_actor`, and `lc_reason=$reason` (the hold's own reason, `$4`).
  - `cmd_ws_release` accepts all three flags and leaves the same three locals as Task 45.

**Steps:**

- [ ] **Step 1: write the failing tests.** Append to `server/test/ccd-actor-flags.test.ts`:

```ts
describe('ws-hold keeps ONE reason — its own', () => {
  const HOLD_STUBS = `tmux() { return 1; };`;

  it('accepts --surface/--actor around the existing --session/--reason pair', () => {
    const id = seedWorkspace();
    const out = h.sh(`${HOLD_STUBS} cmd_ws_hold --surface pwa --session ${id} --reason 'program:x wave:1/4' --actor 'device:iPhone'`);
    expect(out).toBe(`held ${id}: program:x wave:1/4`);
    expect(h.reg(id, 'hold')).toBe('program:x wave:1/4');
  });

  it('does NOT strip --reason: the hold reason is still positional and still mandatory', () => {
    // If the loop stripped `--reason`, the residue would be `--session <id>`,
    // arity 2, the exact-arity guard would refuse a call that is correct, and
    // it would be impossible to hold a workspace at all.
    const id = seedWorkspace();
    const r = shFail(`${HOLD_STUBS} cmd_ws_hold --session ${id} --surface pwa`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-hold --session <id> --reason <text>');
  });

  it('still refuses a whitespace-only hold reason — ccd:2537 is untouched', () => {
    const id = seedWorkspace();
    const r = shFail(`${HOLD_STUBS} cmd_ws_hold --session ${id} --reason '   ' --actor 'device:iPhone'`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('empty reason');
    expect(h.reg(id, 'hold')).toBeNull();
  });

  it('refuses a --actor with no value rather than looping forever', () => {
    const id = seedWorkspace();
    const r = shFail(`${HOLD_STUBS} cmd_ws_hold --session ${id} --reason 'program:x wave:1/4' --actor`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-hold');
  });
});

describe('ws-release takes all three flags and stays idempotent', () => {
  const REL_STUBS = `tmux() { return 1; };`;

  it('releases with the flags, then releases again', () => {
    const id = seedWorkspace();
    h.sh(`${REL_STUBS} cmd_ws_hold --session ${id} --reason 'program:x wave:1/4'`);
    const out = h.sh(`${REL_STUBS} cmd_ws_release --session ${id} --surface pwa --actor 'device:iPhone' --reason 'wave landed'`);
    expect(out).toBe(`released ${id}`);
    expect(h.reg(id, 'hold')).toBeNull();
    expect(h.sh(`${REL_STUBS} cmd_ws_release --session ${id} --surface pwa`)).toContain(id);
  });

  it('refuses an over-long --reason rather than truncating it (B5)', () => {
    const id = seedWorkspace();
    const r = shFail(`${REL_STUBS} cmd_ws_release --session ${id} --reason "$(printf 'a%.0s' {1..513})"`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--reason');
    expect(r.stderr).toContain('512');
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts -t 'ws-hold keeps ONE reason'
```
Expected failure: `accepts --surface/--actor around the existing --session/--reason pair` throws
`Command failed` with stderr `ccd: usage: ccd ws-hold --session <id> --reason <text>` — four extra argv
words break `[[ $# -eq 4 ]]`.

- [ ] **Step 3: write `cmd_ws_hold`'s loop.** Insert immediately **above** its arity guard:

```bash
  # WAVE 5 — TWO FLAGS, NOT THREE, AND THAT IS THE DESIGN. `--reason` on this
  # verb is already the HOLD's reason: mandatory, positional (`$4`), and the
  # display on every ccrc surface. Stripping it here would leave the residue at
  # arity 2, refuse every correct call, and make the workspace unholdable; and
  # accepting a SECOND `--reason` would put two different reasons on one verb
  # with nothing to say which one a reader is looking at. Spec D2's `dec.reason`
  # is therefore this same string — one reason, one meaning.
  #
  # Stripped BEFORE the exact-arity rule, `cmd_stop`'s order.
  local lc_surface=none lc_actor='' lc_gs=0 lc_ga=0 lc_args=()
  while (( $# )); do
    case "$1" in
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-hold [--surface <word>] [--actor <text>] --session <id> --reason <text>"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-hold [--surface <word>] [--actor <text>] --session <id> --reason <text>"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      *)           lc_args+=("$1"); shift ;;
    esac
  done
  set -- "${lc_args[@]}"
  if (( lc_gs )); then lc_surface=$(_lc_surface_norm "$lc_surface"); fi
  if (( lc_ga )); then _lc_dec_ok "$lc_actor" || die "--actor must be non-blank and at most $_LC_DEC_MAX bytes"; fi
```

- [ ] **Step 4: name the shared reason.** Immediately **after** `cmd_ws_hold`'s
`local id=$2 reason=$4` line, add:

```bash
  # `dec.reason` IS the hold reason — see the note above. Named separately so
  # Task 49's emit site reads ONE variable on every verb rather than a special
  # case here, and so a future editor cannot "add the missing --reason".
  local lc_reason=$reason
```

- [ ] **Step 5: write `cmd_ws_release`'s loop.** Insert Task 45's block **verbatim** above
`cmd_ws_release`'s arity guard, with `ws-archive` replaced by `ws-release` in the three usage sentences
and in the comment's example. Release takes all three flags — it has no reason of its own.

- [ ] **Step 6: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-hold.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts
```
Expected: green.

- [ ] **Step 7: mutant — the second reason.** Add a `--reason)` arm to `cmd_ws_hold`'s loop and re-run.
Mutant: `--reason` stripped on ws-hold -> `does NOT strip --reason: the hold reason is still positional
and still mandatory` fails with `expected 0 not to be 0`, and `accepts --surface/--actor around the
existing --session/--reason pair` fails with
`expected 'held demo-quiet-basin: ' to be 'held demo-quiet-basin: program:x wave:1/4'`. Restore.

- [ ] **Step 8: re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-actor-flags.test.ts && git commit -m "ccd(wave5): --surface/--actor on ws-hold, all three on ws-release

ws-hold takes TWO flags: its --reason is already the hold reason and is
spec D2's dec.reason. A second --reason would be two reasons on one verb
with nothing to say which one a reader is looking at."
```

---

### Task 48: the flag loop on `ws-rename` — a JSON refusal, and no new token

**AGENT-FIRST.** Ships with Task 50's agent deploy.

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/ccd/ccd` — insert inside `cmd_ws_rename`,
  **below** its `_json_str probe` and **above** its exact-arity refusal. Locate both:
  `grep -n 'python3 unavailable — cannot quote the rename answer safely' ccd/ccd` (the probe's `die`;
  measured at `52a3cf7`: `ccd:2138-2139`, with a blank at `2140`, its rationale at `2130-2137`) and
  `grep -n 'if \[\[ \$# -ne 4 || \$1 != --session || \$3 != --branch \]\]; then' ccd/ccd` (measured:
  `ccd:2145`).
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-actor-flags.test.ts`

**Interfaces:**
- *Consumes:* `_lc_surface_norm`, `_lc_dec_ok`, `_LC_DEC_MAX`; `_json_str <value>` (prints a JSON string
  literal; **non-zero means python3 could not be run**, which is why the verb probes it once up front);
  `shFail`, `seedWorkspace`.
- *Produces:* `cmd_ws_rename` accepts all three flags; every flag refusal is
  `{"refused":"bad-args","detail":<quoted>,"paths":[]}` on stdout at **exit 0**, reusing the existing
  `bad-args` token.

**Steps:**

- [ ] **Step 1: write the failing tests.** Append to `server/test/ccd-actor-flags.test.ts`:

```ts
describe('ws-rename answers flag refusals the way it answers every other refusal', () => {
  const RENAME_STUBS = `tmux() { return 1; }; _ws_branch_valid() { return 0; };
    _ws_wt_branch() { echo ws/quiet-basin; return 0; };`;

  it('refuses a valueless --surface as JSON at exit 0, never as a die', () => {
    const id = seedWorkspace();
    const r = shFail(`${RENAME_STUBS} cmd_ws_rename --session ${id} --branch ws/new --surface`);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(j).toMatchObject({ refused: 'bad-args', paths: [] });
    expect(String(j['detail'])).toContain('--surface');
  });

  it('refuses a blank --actor as JSON at exit 0', () => {
    const id = seedWorkspace();
    const r = shFail(`${RENAME_STUBS} cmd_ws_rename --session ${id} --branch ws/new --actor ''`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toMatchObject({ refused: 'bad-args' });
  });

  it('refuses an over-long --reason as JSON at exit 0, and says the cap in bytes', () => {
    const id = seedWorkspace();
    const r = shFail(
      `${RENAME_STUBS} cmd_ws_rename --session ${id} --branch ws/new --reason "$(printf 'a%.0s' {1..513})"`);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(j).toMatchObject({ refused: 'bad-args' });
    expect(String(j['detail'])).toContain('512');
  });

  it('adds NO new refusal token to ccd — the wsaudit scan sees exactly what it saw', () => {
    // `server/test/wsaudit.test.ts:53-63` greps THIS FILE'S TEXT with four
    // regexes and holds the result set-equal to `wsaudit.ts`'s SENTENCES, in
    // both directions. A wave-5 token like `bad-surface` would need a sentence;
    // reusing `bad-args` needs nothing. ccd's own note above the verb
    // (`THE TOKENS ARE INLINE LITERALS`) records the same rule for the
    // helper-vs-literal question.
    const src = readFileSync(CCD, 'utf8');
    const tokens = new Set<string>();
    for (const m of src.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/'!([a-zA-Z0-9-]+)/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) {
      if (m[1] !== 'reapable') tokens.add(m[1]!);
    }
    // The floor guards the scan itself: a refactor that hid every refusal
    // behind one indirection would make this assertion vacuously true.
    expect(tokens.size).toBeGreaterThan(30);
    expect(tokens.has('bad-args')).toBe(true);
    for (const invented of ['bad-surface', 'bad-actor', 'bad-flag', 'bad-dec']) {
      expect(tokens.has(invented), `${invented} needs a SENTENCES entry — reuse bad-args`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts -t 'ws-rename answers flag refusals'
```
Expected failure: `refuses a valueless --surface as JSON at exit 0, never as a die` fails with
`expected '…usage: ccd ws-rename --session <id> --branch <name>' to contain '--surface'` — today the
extra argv makes `$# -ne 4` true and the verb answers its generic `bad-args` detail.

- [ ] **Step 3: write the implementation.** Insert after the `_json_str probe … || die` line and the
blank that follows it, **above** the `if [[ $# -ne 4 …` guard:

```bash
  # WAVE 5 — THE DEC FLAGS, STRIPPED HERE AND NOT ONE LINE EARLIER. Below the
  # `_json_str` probe, because every refusal in this verb is a QUOTED JSON
  # answer at exit 0 and an unquotable detail is a parse error rather than the
  # refusal it actually was. Above the arity rule, because the rule is exact and
  # a flag left in argv would refuse a correct call.
  #
  # `break`, NOT a refusal in the loop body: a `return` inside the `while` would
  # leave the remaining argv unread, and the answer this verb owes is one
  # document. The first fault wins and the loop stops; `lc_bad` carries it out.
  #
  # THE TOKEN IS `bad-args`, THE ONE THIS VERB ALREADY SPELLS, and that is not
  # tidiness: `server/test/wsaudit.test.ts:53-63` greps this file's raw text for
  # `"refused":"<token>"` and holds the result set-equal to `wsaudit.ts`'s
  # SENTENCES in both directions, so a `bad-surface` invented here is a red
  # suite whose only fixes are new copy or a weakened mechanism.
  local lc_surface=none lc_actor='' lc_reason='' lc_gs=0 lc_ga=0 lc_gr=0 lc_args=() lc_bad=''
  while (( $# )); do
    case "$1" in
      --surface)   if [[ $# -ge 2 ]]; then lc_gs=1; lc_surface="$2"; shift 2
                   else lc_bad='--surface needs a value'; break; fi ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     if [[ $# -ge 2 ]]; then lc_ga=1; lc_actor="$2"; shift 2
                   else lc_bad='--actor needs a value'; break; fi ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      --reason)    if [[ $# -ge 2 ]]; then lc_gr=1; lc_reason="$2"; shift 2
                   else lc_bad='--reason needs a value'; break; fi ;;
      --reason=*)  lc_gr=1; lc_reason="${1#--reason=}"; shift ;;
      *)           lc_args+=("$1"); shift ;;
    esac
  done
  set -- "${lc_args[@]}"
  if (( lc_gs )); then lc_surface=$(_lc_surface_norm "$lc_surface"); fi
  if [[ -z "$lc_bad" ]] && (( lc_ga )) && ! _lc_dec_ok "$lc_actor"; then
    lc_bad="--actor must be non-blank and at most $_LC_DEC_MAX bytes"
  fi
  if [[ -z "$lc_bad" ]] && (( lc_gr )) && ! _lc_dec_ok "$lc_reason"; then
    lc_bad="--reason must be non-blank and at most $_LC_DEC_MAX bytes"
  fi
  if [[ -n "$lc_bad" ]]; then
    printf '{"refused":"bad-args","detail":%s,"paths":[]}\n' "$(_json_str "$lc_bad")"
    return 0
  fi
```

- [ ] **Step 4: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/wsaudit.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-ws-rename.test.ts
```
Expected: green. `wsaudit.test.ts` green **with zero edits** is the load-bearing one.

- [ ] **Step 5: mutant — the token.** Change `"refused":"bad-args"` in the new block to
`"refused":"bad-surface"` and re-run `test/wsaudit.test.ts`.
Mutant: a new token -> `every token ccd can emit has a non-fallback sentence` fails naming
`bad-surface`, and `adds NO new refusal token to ccd` fails with
`bad-surface needs a SENTENCES entry — reuse bad-args: expected true to be false`. Restore.

- [ ] **Step 6: mutant — the answer shape.** Replace the `printf … ; return 0` pair with
`die "$lc_bad"` and re-run `test/ccd-actor-flags.test.ts`.
Mutant: die instead of a JSON refusal -> `refuses a valueless --surface as JSON at exit 0, never as a
die` fails with `expected 1 to be 0`. Restore.

- [ ] **Step 7: re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-actor-flags.test.ts && git commit -m "ccd(wave5): the dec flags on ws-rename, refusing as JSON at exit 0

Below the _json_str probe, above the exact-arity rule. Reuses bad-args:
wsaudit.test.ts greps this file's text and a new token needs new copy."
```

---

### Task 49: thread the parsed `dec` triple into wave 2's emit sites

**AGENT-FIRST.** Ships with Task 50's agent deploy — deliberately **before** it, so the fleet host gets
the flags and the record in one shipment. AUDIT **M10**: this task is no longer BLOCKED and no longer
deferred past wave 6. AUDIT **B4** settled the emitter's signature, so no wave-2 header read is needed;
the previous draft's BLOCKED note is deleted, not answered.

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/ccd/ccd` — the wave-2 emit sites inside
  `cmd_ws_archive`, `cmd_ws_restore`, `cmd_ws_hold`, `cmd_ws_release`, `cmd_ws_rename`. Enumerate them:
  `awk '/^cmd_ws_(archive|restore|hold|release|rename)\(\) \{/,/^\}/' ccd/ccd | grep -n '_lc_'`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-actor-flags.test.ts`

**Interfaces:**
- *Consumes:*
  - `lc_surface`, `lc_actor`, `lc_reason` — the three function-locals Tasks 45–48 leave set.
  - Wave 2's emitters, in the canonical **dotted key/value** form (AUDIT B4):
    `_lc_intent <act> <id> <tx> [key value]...` · `_lc_done <act> <id> <tx> [key value]...` ·
    `_lc_refuse <act> <id> <token> <detail> [key value]...` ·
    `_lc_fail <act> <id> <tx> <token> <detail> [key value]...`.
    Keys are always dotted and always name their family: `dec.surface`, `dec.actor`, `dec.reason`.
    An **empty value is omitted by the encoder** (`_lc_json`), which is why `lc_actor=''` records no
    `dec.actor` rather than an empty one.
  - `readJournal(home: string): readonly Record<string, unknown>[]` from
    `server/test/lifecycleHelpers.ts` (wave 2, per HEAD AUDIT w23 **M-H**) — the parsed lines of every
    generation under `$REG/.lifecycle`, in `compareGenerations` order. It reads `LC_DIR_NAME` /
    `LC_GEN_PREFIX` / `LC_GEN_SUFFIX` from L0; **do not hand-roll an eighth copy here** (AUDIT m3).
- *Produces:* the journal line each of the five verbs writes carries `dec.surface` always, plus
  `dec.actor` and `dec.reason` when the caller declared them (spec D2).

**Steps:**

- [ ] **Step 1: enumerate the five verbs' emit sites, so the edit list is measured and not guessed.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && awk '/^cmd_ws_(archive|restore|hold|release|rename)\(\) \{/,/^\}/' ccd/ccd | grep -n '_lc_'
```
Expected: one line per `_lc_intent` / `_lc_done` / `_lc_refuse` / `_lc_fail` call inside those five
bodies. Write the list down — it is this task's whole worklist.

- [ ] **Step 2: write the failing tests.** Append to `server/test/ccd-actor-flags.test.ts` (and add
`import { readJournal } from './lifecycleHelpers.js';` to the file's import block):

```ts
/** The `dec` object of a journal line, narrowed by `typeof` rather than cast.
 *  An unmodellable `dec` is `null` here — not a disagreement, and not a crash. */
const decOf = (e: Record<string, unknown>): Record<string, unknown> | null => {
  const d = e['dec'];
  return d !== null && typeof d === 'object' ? (d as Record<string, unknown>) : null;
};
const lastDec = (): Record<string, unknown> | null => {
  const decs = readJournal(h.home).map(decOf).filter((d): d is Record<string, unknown> => d !== null);
  expect(decs.length, 'no journal line carried a dec at all').toBeGreaterThan(0);
  return decs[decs.length - 1]!;
};

describe('the declared triple reaches the journal', () => {
  const STUBS = `tmux() { return 1; };`;

  it('records what the caller said on ws-hold, and the surface it said it from', () => {
    const id = seedWorkspace();
    h.sh(`${STUBS} cmd_ws_hold --session ${id} --reason 'program:x wave:1/4' --surface pwa --actor 'device:iPhone'`);
    expect(lastDec()).toMatchObject({
      surface: 'pwa', actor: 'device:iPhone', reason: 'program:x wave:1/4',
    });
  });

  it('records `none` for an absent surface and `unknown` for a blank one — never the same word', () => {
    const a = seedWorkspace('demo-quiet-basin');
    h.sh(`${STUBS} cmd_ws_release --session ${a}`);
    expect(lastDec()).toMatchObject({ surface: 'none' });

    const b = seedWorkspace('demo-still-mesa');
    h.sh(`${STUBS} cmd_ws_release --session ${b} --surface ''`);
    expect(lastDec()).toMatchObject({ surface: 'unknown' });
  });

  it('omits dec.actor entirely when no --actor was given — never an empty one', () => {
    // `''` and "nobody said" are two facts. The encoder drops an empty value,
    // so the ABSENCE of the key is the record, and a reader that sees
    // `actor: ''` is reading a caller who declared nothing usable — which ccd
    // refuses at the flag (Tasks 45-48), so it cannot happen.
    const id = seedWorkspace();
    h.sh(`${STUBS} cmd_ws_release --session ${id} --surface pwa`);
    const dec = lastDec()!;
    expect(dec['surface']).toBe('pwa');
    expect(Object.keys(dec)).not.toContain('actor');
  });

  it('cannot be forged through --reason: the value is quoted, never interpolated', () => {
    const id = seedWorkspace();
    h.sh(`${STUBS} cmd_ws_release --session ${id} --reason '","surface":"cli","actor":"root'`);
    const dec = lastDec()!;
    // `_lc_json` quotes the whole value into one JSON string, so a reason shaped
    // like a field separator lands as TEXT — spec §3's "a caller lies" row,
    // closed at the encoder rather than at a sanitiser.
    expect(dec['surface']).toBe('none');
    expect(String(dec['reason'])).toContain('surface');
  });
});
```

- [ ] **Step 3: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts -t 'the declared triple reaches the journal'
```
Expected failure: `records what the caller said on ws-hold, and the surface it said it from` fails with
`no journal line carried a dec at all: expected +0 to be greater than +0` — wave 2's emit sites pass no
`dec.*` keys, so the encoder writes no `dec` object.

- [ ] **Step 4: thread the triple.** At **every** site step 1 listed, append the three dotted pairs to
the existing variadic tail — nothing else on the line changes:

```bash
  dec.surface "$lc_surface" dec.actor "$lc_actor" dec.reason "$lc_reason"
```
So, for example, `cmd_ws_hold`'s `done` site becomes:

```bash
  _lc_done hold "$id" "" meas.workspace "$(_reg_get "$id" workspace)" meas.held "$reason" \
    dec.surface "$lc_surface" dec.actor "$lc_actor" dec.reason "$lc_reason"
```
Three rules, all of them load-bearing:
1. **Dotted keys, always** (AUDIT B4). `dec.surface`, never a positional third argument and never a bare
   `surface` — bare keys are the top-level family (`detail`, `refusal`, `verb`, `badact`,
   `branchDeleted`) and a bare `surface` would land as a `meas` member about the subject.
2. **No carry globals.** Pass the locals as arguments at every site. Spec §2: *"`tip`/`attic`/`tx` are
   arguments, because the `LC_TIP=` idiom dies under `set -u` on the first call in a process, appending
   a blank line nobody notices."*
3. **`cmd_ws_hold` reads `lc_reason` like every other verb** — Task 47 step 4 already bound it to
   `$reason`, so this line is identical on all five verbs and no site carries a special case.

- [ ] **Step 5: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-lifecycle-pairs.test.ts
```
Expected: green.

- [ ] **Step 6: mutant — a laundered default.** Replace `"$lc_surface"` at `cmd_ws_hold`'s emit site
with the literal `none` and re-run.
Mutant: `dec.surface "$lc_surface"` -> `dec.surface none` -> `records what the caller said on ws-hold,
and the surface it said it from` fails with
`expected { surface: 'none', … } to match object { surface: 'pwa', … }`. Restore.

- [ ] **Step 7: mutant — the key family.** Change one site's `dec.surface` to bare `surface` and re-run.
Mutant: an undotted key -> the value lands in `meas`, `dec` loses its only always-present member, and
`records \`none\` for an absent surface and \`unknown\` for a blank one` fails with
`no journal line carried a dec at all`. Restore.

- [ ] **Step 8: re-stamp and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-actor-flags.test.ts && git commit -m "ccd(wave5): the parsed dec triple reaches the journal

Dotted key/value pairs on the existing variadic tail, no carry globals,
one spelling on all five verbs. A --reason shaped like a field separator
lands as text, because _lc_json quotes rather than interpolates."
```

---

### Task 50: `caps += actor-flags-v1`, the parity list, and the agent deploy

**AGENT-FIRST — this is the task that ships it.** Everything in Tasks 44–49 reaches the fleet host here,
and **no wave-6 server work may be deployed until step 9 prints the token** (CLAUDE.md's agent-first
rule; the server must not send a flag before the box parses it).

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/ccd/ccd` — `cmd_caps`: the three-line comment
  above `echo stop-surface`, and one new `echo` before the closing `}`. Locate them:
  `grep -n 'echo stop-surface' ccd/ccd` (measured at `52a3cf7`: `ccd:2449`, comment `ccd:2446-2448`,
  closing `}` at `ccd:2450`; wave 2 has since added `echo lifecycle-v1`).
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/ccd-archive.test.ts` — line `153`,
  `const KNOWN_CAPABILITY_TOKENS = …`.

**Interfaces:**
- *Consumes:* nothing.
- *Produces:* `ccd caps` prints `actor-flags-v1` as a capability token. This is the exact value
  `capSupported(state, 'actor-flags-v1')` reads in Tasks 52–55.

**Steps:**

- [ ] **Step 1: confirm what wave 2 left behind, rather than assuming it.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && sed -n '150,156p' server/test/ccd-archive.test.ts && sed -n "/^cmd_caps() {/,/^}/p" ccd/ccd | tail -20
```
Expected after wave 2: `const KNOWN_CAPABILITY_TOKENS = ['lifecycle-v1', 'stop-surface'];` and `cmd_caps`
ending with `echo stop-surface` plus `echo lifecycle-v1`. If it still reads `['stop-surface']`, wave 2
has not landed — stop.

- [ ] **Step 2: write the failing test.** Edit `server/test/ccd-archive.test.ts:153` to add the third
token, alphabetically first:

```ts
  const KNOWN_CAPABILITY_TOKENS = ['actor-flags-v1', 'lifecycle-v1', 'stop-surface'];
```

- [ ] **Step 3: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t 'advertises exactly the verbs'
```
Expected failure: the capability half at `ccd-archive.test.ts:180` reds with
`expected [ 'lifecycle-v1', 'stop-surface' ] to deeply equal [ 'actor-flags-v1', 'lifecycle-v1', 'stop-surface' ]`.
`cmd_caps` does not print the token yet.

- [ ] **Step 4: repair the stale inventory comment.** Replace `cmd_caps`'s three-line note above
`echo stop-surface` — AUDIT/HEAD-AUDIT **M-G**: after wave 2 it already said "exactly one token" about a
set of two, and this task makes it three:

```bash
  # `server/test/ccd-archive.test.ts`'s caps<->dispatcher parity check knows
  # these tokens by name (`KNOWN_CAPABILITY_TOKENS`, ccd-archive.test.ts:153)
  # and holds the advertised set EXACTLY equal to that list — a token added
  # here without updating it falls into the `verbs` partition and reds as a
  # phantom verb (:175), and one added to that list without being echoed here
  # reds the capability equality (:180). Both directions are covered, so a new
  # token is a deliberate visible edit and never a silent drift.
```

- [ ] **Step 5: write the implementation.** Add the new `echo` after `echo lifecycle-v1`, immediately
before `cmd_caps`'s closing `}`:

```bash
  # `actor-flags-v1` decides ONE server-side thing: whether to APPEND
  # `--surface`/`--actor`/`--reason` to the five workspace verbs. The server
  # answers FALSE on no evidence (`capSupported`, server/src/ccdargv.ts) because
  # the wrong guess here is a SILENT SUCCESS — a ccd without this token meets
  # the flags in an exact-arity guard, and where it does not die, `runCcdOr502`
  # renders exit 0 as `200 {ok:true}` for a call that recorded nothing. Same
  # argument, same polarity, as `stop-surface` above.
  echo actor-flags-v1
```

- [ ] **Step 6: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
```
Expected: green.

- [ ] **Step 7: mutants — both directions of the parity check.** Delete `echo actor-flags-v1` and re-run:
Mutant: token echoed nowhere -> `advertises exactly the verbs the dispatcher implements, plus the known
capability tokens` fails at `:180` with
`expected [ 'lifecycle-v1', 'stop-surface' ] to deeply equal [ 'actor-flags-v1', … ]`. Restore. Then move
`echo actor-flags-v1` **above** the heredoc's `EOF` (making it a verb line) and re-run:
Mutant: token as a verb -> the same test fails at `:175` with `actor-flags-v1` present in `verbs` and
absent from the dispatcher's arms. Restore.

- [ ] **Step 8: re-stamp, run the whole server suite, and commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
cd /home/you/worktrees/ccrc-pwa/still-river && git add ccd/ccd server/test/ccd-archive.test.ts && git commit -m "ccd(wave5): caps += actor-flags-v1

The parity list moves from two tokens to three, and cmd_caps's stale
'exactly one token' note is repaired in the same commit. False on no
evidence server-side, because the wrong guess is a silent success."
```
Run `npm run test` in the FOREGROUND with a timeout of at least 600000 ms. On a red in
`typecheck-tests`, re-run that one suite in isolation on an idle box before calling it a break
(CLAUDE.md's flake list; waves 5–6 touch that suite and no other flake).

- [ ] **Step 9: deploy to the fleet host, and verify the token is live.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && bash deploy/deploy.sh agent "$CCRC_BOX"
ssh "$CCRC_BOX" '~/.local/bin/ccd caps' | grep -x 'actor-flags-v1'
```
`$CCRC_BOX` is the fleet host (BOX 2) as named in `deploy/ccrc.env`; `deploy/deploy.sh:17-20` falls back
to it when the host argument is omitted. Expected output: `actor-flags-v1`.
**If it is absent, do not start wave 6** — `capSupported` would correctly answer false and every wave-6
task would ship a no-op.

---

### Task 51: `capSupported` — the token lifted to a parameter, the default left where it was

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/ccdargv.ts` — insert after
  `verbSupported`'s closing `}` (`:139`); amend `stopSurfaceSupported`'s docstring (`:141-182`) and
  replace its body (`:183-187`).
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/readme-holds.test.ts` — `:209-210`.
- Create `/home/you/worktrees/ccrc-pwa/still-river/server/test/capsupported.test.ts`

**Interfaces:**
- *Consumes:* `FleetState` (`server/src/fleetstate.ts`, already imported at `ccdargv.ts:1`);
  `verbSupported`, `CCD_ARGV` (same file).
- *Produces:*
  - `export const ACTOR_FLAGS_CAP = 'actor-flags-v1';` — the token, spelled **once** in `server/src`.
    (Not yet in the AUDIT's canonical name table; it is added here rather than letting `ccdargv.ts` and
    `server.ts` each carry a literal, which is the second-copy shape `single-definition.test.ts` exists
    for.)
  - `export function capSupported(state: Pick<FleetState, 'ccdVerbs'> | undefined, token: string): boolean`
    — membership in `ccdVerbs`; **false** when `ccdVerbs` is `null` or `state` is `undefined`.
  - `stopSurfaceSupported(state)` keeps its exported name and its signature, and delegates.

**Steps:**

- [ ] **Step 1: write the failing test.** Create `server/test/capsupported.test.ts`:

```ts
// server/test/capsupported.test.ts
//
// `capSupported` is `stopSurfaceSupported`'s body with the token lifted to a
// parameter — and, critically, WITH ITS DEFAULT UNMOVED. The asymmetry is the
// whole point and `ccdargv.ts`'s own docstring argues it at length: for every
// gated VERB, guessing wrong on no evidence costs a loud failure, so
// `verbSupported` permits; for a FLAG it costs a silent success, so this
// refuses.
import { describe, it, expect } from 'vitest';
import {
  ACTOR_FLAGS_CAP, CCD_ARGV, capSupported, stopSurfaceSupported, verbSupported,
} from '../src/ccdargv.js';

const state = (ccdVerbs: string[] | null) => ({ ccdVerbs });

describe('capSupported', () => {
  it('answers true only when the deployed ccd advertised the token', () => {
    expect(capSupported(state(['ws-archive', ACTOR_FLAGS_CAP]), ACTOR_FLAGS_CAP)).toBe(true);
    expect(capSupported(state(['ws-archive']), ACTOR_FLAGS_CAP)).toBe(false);
  });

  it('REFUSES on no evidence — a null list and an absent state alike', () => {
    // THE MUTANT THIS EXISTS FOR: flip either branch to `true` and an old ccd
    // starts receiving `--surface pwa` it parses as argv it does not know.
    expect(capSupported(state(null), ACTOR_FLAGS_CAP)).toBe(false);
    expect(capSupported(undefined, ACTOR_FLAGS_CAP)).toBe(false);
    expect(capSupported(state([]), ACTOR_FLAGS_CAP)).toBe(false);
  });

  it('is the OPPOSITE of verbSupported on the same no-evidence input', () => {
    // Stated as an assertion rather than a comment, because the two functions
    // are one line apart and the next editor's instinct is to unify them.
    expect(verbSupported(state(null), CCD_ARGV.ensure('x'))).toBe(true);
    expect(capSupported(state(null), 'stop-surface')).toBe(false);
  });

  it('stopSurfaceSupported is capSupported bound to its own token', () => {
    for (const verbs of [null, [], ['stop'], ['stop', 'stop-surface']]) {
      expect(stopSurfaceSupported(state(verbs))).toBe(capSupported(state(verbs), 'stop-surface'));
    }
    expect(stopSurfaceSupported(undefined)).toBe(capSupported(undefined, 'stop-surface'));
  });

  it('spells the actor-flags token exactly once in server/src', () => {
    // The other two spellings are deliberate and elsewhere: ccd's own `echo`
    // and `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS, which is the pin.
    expect(ACTOR_FLAGS_CAP).toBe('actor-flags-v1');
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/capsupported.test.ts
```
Expected failure: collection fails with
`SyntaxError: The requested module '../src/ccdargv.js' does not provide an export named 'ACTOR_FLAGS_CAP'`
(and `capSupported` with it).

- [ ] **Step 3: write the implementation.** In `server/src/ccdargv.ts`, insert immediately after
`verbSupported`'s closing brace (`:139`):

```ts
/** The `ccd caps` token that says this box parses `--surface`/`--actor`/
 *  `--reason` on the five workspace verbs (wave 5). Spelled ONCE in
 *  `server/src`: `sweepDec` and `server.ts`'s `pwaDec` both read it from here,
 *  because a capability token copied into two files is the drift shape
 *  `single-definition.test.ts` exists for. ccd's own `echo actor-flags-v1` and
 *  `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two
 *  spellings, and the parity check between them keeps all three equal. */
export const ACTOR_FLAGS_CAP = 'actor-flags-v1';

/**
 * Whether the DEPLOYED ccd advertised a CAPABILITY token — a verb-shaped string
 * in the same `ccd caps` list `verbSupported` reads, naming a FLAG on an
 * existing verb rather than a second dispatchable command.
 *
 * THE NO-EVIDENCE DEFAULT IS FALSE, and it is deliberately the opposite of
 * `verbSupported`'s. That asymmetry is argued in full on
 * {@link stopSurfaceSupported} below and is not restated here — what matters at
 * this seam is that generalising the FUNCTION must not generalise the DEFAULT
 * along with it. For a gated VERB, a wrong guess on no evidence costs a loud
 * failure (ccd's own `die "usage: ..."`, a 502, never a lie). For a FLAG, a
 * wrong guess costs a SILENT SUCCESS: an old ccd meets the flag inside an
 * exact-arity guard, and on the paths where it does not die, `runCcdOr502`
 * renders its exit 0 as `200 {ok:true}` for a call that recorded nothing. Same
 * input, categorically different blast radius.
 *
 * This is sound only because local mode measures its OWN ccd at boot
 * (`localcaps.ts`, `index.ts`) rather than leaving `ccdVerbs` permanently null
 * there — otherwise a refusing default would kill the feature outright in the
 * DEFAULT deployment mode.
 */
export function capSupported(
  state: Pick<FleetState, 'ccdVerbs'> | undefined,
  token: string,
): boolean {
  const verbs = state?.ccdVerbs ?? null;
  if (verbs === null) return false;
  return verbs.includes(token);
}
```

- [ ] **Step 4: delegate, and repair the sentence the delegation makes false.** In
`stopSurfaceSupported`'s docstring, the paragraph that today ends

```
 * The asymmetry is why this function does not delegate its null case to
 * `verbSupported` — it re-implements the same membership check with the
 * opposite default instead.
```
now describes code that no longer exists. Replace those three lines with:

```
 * The asymmetry is why this function does not delegate to `verbSupported`. It
 * delegates to {@link capSupported} instead (wave 6), which is that same
 * membership check with this opposite default — one implementation of the
 * refusing branch, not two, and `readme-holds.test.ts` pins BOTH halves so a
 * quiet re-implementation here with the permitting default still reds.
 *
 * It stays a NAMED EXPORT rather than becoming a call site: `verb-gate.test.ts`
 * text-searches a call site's enclosing function for `verbSupported(`, and
 * inlining `capSupported(state, 'stop-surface')` at `stop`'s call sites would
 * change what that scanner sees about a verb that is correctly ungated.
```
Then replace the body (`:183-187`):

```ts
export function stopSurfaceSupported(state: Pick<FleetState, 'ccdVerbs'> | undefined): boolean {
  return capSupported(state, 'stop-surface');
}
```

- [ ] **Step 5: move the pin in `server/test/readme-holds.test.ts`.** Lines `209-210` today read:

```ts
    const fn = ccdargv.slice(ccdargv.indexOf('export function stopSurfaceSupported'));
    expect(fn, 'the no-evidence branch must refuse, not permit').toMatch(/if \(verbs === null\) return false;/);
```
Replace with:

```ts
    // WAVE 6: the refusing branch moved into `capSupported`, which
    // `stopSurfaceSupported` now delegates to. BOTH halves are pinned, because
    // either one alone goes green on a real regression: slicing only
    // `capSupported` misses a `stopSurfaceSupported` that quietly stops
    // delegating and re-implements the check with the permitting default.
    const cap = ccdargv.slice(ccdargv.indexOf('export function capSupported'));
    expect(cap, 'the no-evidence branch must refuse, not permit').toMatch(/if \(verbs === null\) return false;/);
    expect(ccdargv, 'stopSurfaceSupported must delegate, not re-implement')
      .toMatch(/return capSupported\(state, 'stop-surface'\);/);
```

- [ ] **Step 6: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/capsupported.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/verb-gate.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle.test.ts
```
Expected: green, all four.

- [ ] **Step 7: mutant — the default.** Change `capSupported`'s `if (verbs === null) return false;` to
`return true;` and re-run step 6's first two commands.
Mutant: refusing branch -> permitting -> `REFUSES on no evidence — a null list and an absent state
alike` fails with `expected true to be false`, and `readme-holds.test.ts` fails with
`the no-evidence branch must refuse, not permit`. Restore.

- [ ] **Step 8: mutant — a silent re-implementation.** Give `stopSurfaceSupported` an inline
`const verbs = state?.ccdVerbs ?? null; if (verbs === null) return false; return verbs.includes('stop-surface');`
and re-run `test/readme-holds.test.ts`.
Mutant: delegation -> re-implementation -> fails with `stopSurfaceSupported must delegate, not
re-implement`. Restore.

- [ ] **Step 9: commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/src/ccdargv.ts server/test/capsupported.test.ts server/test/readme-holds.test.ts && git commit -m "server(wave6): capSupported — the token lifted, the default not

stopSurfaceSupported keeps its name (verb-gate's scanner reads call
sites) and delegates; its docstring's 're-implements instead' sentence is
corrected in the same commit. Both halves pinned: a silent
re-implementation with the permitting default reds too."
```

---

### Task 52: `ActorFlags`, `decFlags`, `deviceActor`, and the five threaded argv builders

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/ccdargv.ts` — add three declarations
  above `CCD_ARGV` (`:57`); replace the five table entries at `:106`, `:107`, `:111`, `:112`, `:118`.
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/capsupported.test.ts`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/whitelist-subset.test.ts` —
  `:13`, `:28-35`, `:182`, `:297-298`, `:307`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/lifecycle.test.ts:572`

**Interfaces:**
- *Consumes:* `StopSurface` (`shared/api.ts:1135` — **unchanged**; spec §2: *"`StopSurface`, `WsTombstone`
  and `FLEET_PROTO` are unchanged"*), already imported at `ccdargv.ts:2`; `DecSurface` (`shared/api.ts`,
  wave 1) for the type-level pin only; `isExecAllowed` (`agent/src/whitelist.ts`).
- *Produces:*
  - `export interface ActorFlags { readonly surface: StopSurface; readonly actor: string; readonly reason: string | null; }`
  - `const decFlags = (dec: ActorFlags | null): readonly string[]` (module-private)
  - `export function deviceActor(device: string | null): string`
  - `wsArchive(id: string, dec: ActorFlags | null)` · `wsRestore(id, dec)` · `wsHold(id, reason, dec)` ·
    `wsRelease(id, dec)` · `wsRename(id, branch, dec)` — `null` omits all three flags and reproduces the
    pre-wave argv token for token; the flags always ride **after** the granted
    `['<verb>','--session']` prefix.

**Steps:**

- [ ] **Step 1: write the failing tests.** Append to `server/test/capsupported.test.ts`, and extend its
import block with `deviceActor, type ActorFlags` from `'../src/ccdargv.js'`, plus two new imports:
`import { isExecAllowed } from '../../agent/src/whitelist.js';` and
`import type { DecSurface } from '../../shared/api.js';`.

```ts
const DEC: ActorFlags = { surface: 'pwa', actor: 'device:iPhone', reason: null };

describe('ActorFlags is the PRODUCER shape of L0`s LifecycleDec', () => {
  it('its surface is assignable to DecSurface, so the record can widen but not narrow', () => {
    // AUDIT M9. Two shapes, one triple, and the relationship written down as a
    // TYPE rather than as prose: `ActorFlags.surface` is `StopSurface` and
    // NEVER `'none'` (absence is `dec: null`, which omits the flags entirely);
    // `LifecycleDec.surface` is `DecSurface = StopSurface | 'none'`, the RECORD
    // shape, where `'none'` is what ccd writes when no flag arrived. `actor` is
    // mandatory here because `deviceActor`/`sweepDec` always measure one, and
    // nullable there because an older ccd may have written none.
    const surface: DecSurface = ({} as ActorFlags).surface;
    expect(typeof surface).toBe('undefined');   // a TYPE-level pin; the value is irrelevant
  });
});

describe('the dec flags ride AFTER the granted prefix, and need no new grant', () => {
  it('omits every flag for a null dec — the byte-identical pre-wave argv', () => {
    expect(CCD_ARGV.wsArchive('demo-quiet-basin', null))
      .toEqual(['ws-archive', '--session', 'demo-quiet-basin']);
    expect(CCD_ARGV.wsHold('demo-quiet-basin', 'program:x wave:1/4', null))
      .toEqual(['ws-hold', '--session', 'demo-quiet-basin', '--reason', 'program:x wave:1/4']);
  });

  it('appends the flags after the required ones, never before', () => {
    expect(CCD_ARGV.wsArchive('demo-quiet-basin', DEC))
      .toEqual(['ws-archive', '--session', 'demo-quiet-basin', '--surface', 'pwa', '--actor', 'device:iPhone']);
    expect(CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', { ...DEC, reason: 'ai title' }))
      .toEqual(['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/x',
                '--surface', 'pwa', '--actor', 'device:iPhone', '--reason', 'ai title']);
  });

  it('every flagged argv still passes the agent whitelist — ZERO new grants', () => {
    // `isExecAllowed` is PREFIX-matching, and every grant for these five verbs
    // is `['<verb>','--session']` (agent/src/whitelist.ts:335-367): flags after
    // the prefix are "tokens after the prefix are unconstrained". This is the
    // proof of the design's headline zero-grants property.
    for (const argv of [
      CCD_ARGV.wsArchive('demo-quiet-basin', DEC),
      CCD_ARGV.wsRestore('demo-quiet-basin', DEC),
      CCD_ARGV.wsHold('demo-quiet-basin', 'program:x wave:1/4', DEC),
      CCD_ARGV.wsRelease('demo-quiet-basin', DEC),
      CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', DEC),
    ]) {
      expect(isExecAllowed('ccd', [...argv]), `ccd ${argv.join(' ')}`).toBe(true);
    }
  });

  it('sends ONE --reason on ws-hold, and it is the hold`s own', () => {
    const argv = CCD_ARGV.wsHold('demo-quiet-basin', 'program:x wave:1/4', { ...DEC, reason: 'ignored' });
    expect(argv.filter((t) => t === '--reason')).toHaveLength(1);
    expect(argv).toEqual(['ws-hold', '--session', 'demo-quiet-basin', '--reason', 'program:x wave:1/4',
                          '--surface', 'pwa', '--actor', 'device:iPhone']);
  });

  it('omits --reason when it is null, rather than sending an empty one', () => {
    // ccd REFUSES `--reason ''` (a declaration that says nothing is not a
    // declaration, AUDIT B5). Sending one would be a 502 on every sweep.
    expect(CCD_ARGV.wsRelease('demo-quiet-basin', DEC)).not.toContain('--reason');
  });
});

describe('deviceActor', () => {
  it('names the device when the gate measured one', () => {
    expect(deviceActor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'))
      .toBe('device:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
  });

  it('says `unmeasured`, never a fabricated device, when there is no session', () => {
    // A dark box (the shipped default) has no session layer, so every route
    // measures null. `unmeasured` and a UA-less browser's own `unknown device`
    // are two different facts and must not collapse — the "no overloaded null
    // at a seam" rule, at the seam that carries provenance.
    expect(deviceActor(null)).toBe('device:unmeasured');
    expect(deviceActor('unknown device')).toBe('device:unknown device');
  });

  it('cannot exceed ccd`s 512-byte --actor cap, even for astral user-agents', () => {
    const astral = '\u{1F600}'.repeat(200);
    expect(Buffer.byteLength(deviceActor(astral), 'utf8')).toBeLessThanOrEqual(512);
  });

  it('flattens control characters, so no actor can carry a line break into NDJSON', () => {
    expect(deviceActor('a\nb\tc')).toBe('device:a b c');
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/capsupported.test.ts
```
Expected failure: collection fails with
`SyntaxError: The requested module '../src/ccdargv.js' does not provide an export named 'deviceActor'`.

- [ ] **Step 3: write the three declarations.** In `server/src/ccdargv.ts`, immediately above
`export const CCD_ARGV = {` (`:57`):

```ts
/**
 * The DECLARED half of a provenance record (spec D2's `dec`), as the three ccd
 * flags carry it. Self-asserted by construction — ccd cannot authenticate a
 * caller on a single-uid box and does not pretend to; the kernel-observed half
 * (`obs`) is measured on the box and the two are COMPARED, never merged.
 *
 * THE PRODUCER SHAPE, and `LifecycleDec` (L0) is the RECORD shape it lands as.
 * They differ in exactly two places and both differences are deliberate:
 * `surface` here is `StopSurface` and NEVER `'none'` (absence is `dec: null`,
 * which omits the flags entirely), while the record's is
 * `DecSurface = StopSurface | 'none'`; and `actor` here is MANDATORY because
 * `deviceActor`/`sweepDec` always measure one, while the record's is nullable
 * because an older ccd may have written none. `capsupported.test.ts` pins the
 * assignability so nobody "unifies" the two later.
 *
 * `reason: null` OMITS the flag. It is not `''`: ccd refuses a blank
 * declaration (`_lc_dec_ok`), on the same argument `cmd_ws_hold` has always
 * made about an empty hold reason — a flag that says nothing is a different
 * fact from no flag, and collapsing them records "nobody said" for a caller
 * that said something unusable.
 */
export interface ActorFlags {
  readonly surface: StopSurface;
  readonly actor: string;
  readonly reason: string | null;
}

/**
 * The flag tokens for a dec, or NOTHING for `null`.
 *
 * `null` is a real, deliberate choice and not "unset" — it is what a caller
 * passes when the deployed ccd is not known to understand the flags
 * (`capSupported(state, ACTOR_FLAGS_CAP)`), and it produces the argv that
 * shipped before this wave, token for token. Exactly `stopId`'s
 * `surface: null` contract, for exactly its reason (`ccdargv.ts:76-91`).
 */
const decFlags = (dec: ActorFlags | null): readonly string[] =>
  dec === null
    ? []
    : ['--surface', dec.surface, '--actor', dec.actor,
       ...(dec.reason === null ? [] : ['--reason', dec.reason])];

/**
 * The session's own device label as an `--actor` value.
 *
 * TWO CONDITIONS, TWO WORDS. `null` means the gate measured no session at all
 * (a dark box, or an exempt route reached without a cookie) — `unmeasured`. A
 * UA-less browser that DID present a live session already carries
 * `'unknown device'` from `deviceLabel` and keeps it verbatim. Folding both
 * into one word would tell an operator "we do not know which browser" for a
 * call where we do not know there was a browser.
 *
 * `\p{Cc}` flattens every control character and the label is re-truncated, both
 * belt and braces: `deviceLabel` already slices to 120 UTF-16 units, and ccd
 * quotes the value through `_lc_json` (which escapes a newline rather than
 * breaking the line). A producer that can cheaply guarantee it never emits a
 * line break into a line-oriented file should. 7 + 120*3 = 367 bytes worst
 * case, inside ccd's 512-byte `--actor` cap. The unicode property escape is
 * used rather than an explicit code-point range so this source file contains no
 * control characters of its own.
 *
 * DISCLOSED RESIDUAL (AUDIT m5): `slice(0, 120)` counts UTF-16 units, so it can
 * split a surrogate pair and leave a lone surrogate at the end. Harmless in
 * both directions — `JSON.stringify` escapes it, and ccd's `_lc_json` decodes
 * with `errors='replace'`, so it lands as U+FFFD — and it is written down here
 * rather than left for someone to rediscover.
 */
export function deviceActor(device: string | null): string {
  if (device === null) return 'device:unmeasured';
  return `device:${device.replace(/\p{Cc}/gu, ' ').slice(0, 120)}`;
}
```

- [ ] **Step 4: thread the five table entries.** Keep every existing docstring; change only the
signatures and the bodies:

```ts
  wsArchive: (id: string, dec: ActorFlags | null) =>
               argv(['ws-archive', '--session', id, ...decFlags(dec)]),
  wsRestore: (id: string, dec: ActorFlags | null) =>
               argv(['ws-restore', '--session', id, ...decFlags(dec)]),
```
```ts
  /** The dec flags ride AFTER `--reason`, and `--reason` is NOT one of them: on
   *  `ws-hold` the hold reason IS the declared reason (ccd's `cmd_ws_hold` says
   *  so in its own comment), so there is one reason on this verb, not two. The
   *  `{ ...dec, reason: null }` is what enforces it here — a caller that passes
   *  a dec carrying a reason gets it dropped, pinned in `capsupported.test.ts`. */
  wsHold:    (id: string, reason: string, dec: ActorFlags | null) =>
               argv(['ws-hold', '--session', id, '--reason', reason,
                     ...decFlags(dec === null ? null : { ...dec, reason: null })]),
  wsRelease: (id: string, dec: ActorFlags | null) =>
               argv(['ws-release', '--session', id, ...decFlags(dec)]),
```
and `wsRename` (`:118`):
```ts
  wsRename:  (id: string, branch: string, dec: ActorFlags | null) =>
               argv(['ws-rename', '--session', id, '--branch', branch, ...decFlags(dec)]),
```

- [ ] **Step 5: update `server/test/whitelist-subset.test.ts` — five edits, all measured.**
`:13`, widen the SAMPLES value type. `EXPECTED` at `:286` stays `Record<…, string[]>`: every expected
argv is still all-strings, and widening it would weaken the one table that pins tokens.

```ts
// `unknown[]`, not `string[]`, since wave 6: `wsArchive` and its four siblings
// take an `ActorFlags | null` argument, so a sample is no longer all-strings.
// The call site below already casts through `unknown[]`; this widens the
// declaration to match what the table accepts. EXPECTED stays `string[]` — an
// argv is still tokens.
const SAMPLES: Record<keyof typeof CCD_ARGV, unknown[]> = {
```
`:28-35`, give the five entries their new argument — four `null`s and one real dec, so both arms are
exercised:

```ts
  wsArchive: ['demo-quiet-basin', null],
  wsRestore: ['demo-quiet-basin', null],
  wsAudit: ['demo-quiet-basin'],
  wsReap: ['a'.repeat(64), 'demo-quiet-basin'],
  wsAttic: ['demo-quiet-basin'],
  // The one sample that carries a dec, so layer 2's `isExecAllowed` check
  // actually proves the FLAGGED shape is reachable under the granted
  // `['ws-hold','--session']` prefix rather than only the bare one.
  wsHold: ['demo-quiet-basin', 'program:agent-evals wave:1/4',
           { surface: 'pwa', actor: 'device:iPhone', reason: null }],
  wsRelease: ['demo-quiet-basin', null],
  wsRename: ['demo-quiet-basin', 'ws/brainstorm-helix-and-slide-notes', null],
```
`:182`, the standalone `ws-rename` grant case — **missed by the previous draft, and a compile error
without it**:

```ts
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', null)])).toBe(true);
```
`:297-298`, the `prOpen` comment now names a type that changed:

```ts
    // SAMPLES.prOpen's fourth element is the STRING 'false' (SAMPLES is typed
    // unknown[] since wave 6, and the call site casts through `unknown[]`), which
```
`:307`, EXPECTED's `wsHold` grows the two flag pairs its sample now sends:

```ts
    wsHold: ['ws-hold', '--session', 'demo-quiet-basin', '--reason', 'program:agent-evals wave:1/4',
             '--surface', 'pwa', '--actor', 'device:iPhone'],
```
`:302`, `:303`, `:308`, `:309` are **unchanged** — their samples pass `null`, so the argv is
byte-identical to what shipped, and that is the regression pin.

- [ ] **Step 6: update `server/test/lifecycle.test.ts:572`.**

```ts
    expect(await ccdRunner(run, cfg)(CCD_ARGV.wsArchive(ID, null)))
```

- [ ] **Step 7: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/capsupported.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/ccdargv-brand.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/verb-gate.test.ts
```
Expected: green. `tsc --noEmit` is **expected to be red at this point** — the fourteen production call
sites still pass one argument too few — and is run in Task 55 step 6, once Tasks 54 and 55 have threaded
them. Do not run it here and do not fix those call sites out of order.

- [ ] **Step 8: mutant — flag position.** Move `...decFlags(dec)` in `wsArchive` to before `'--session'`
and re-run `test/whitelist-subset.test.ts`.
Mutant: flags before the granted prefix -> layer 2's `wsArchive` case still passes (its sample is
`null`), and **layer 4** fails with
`expected [ 'ws-archive', '--surface', ... ] to deeply equal [ 'ws-archive', '--session', ... ]`. Restore.

- [ ] **Step 9: mutant — the second reason.** Delete the `{ ...dec, reason: null }` spread in `wsHold`
and re-run `test/capsupported.test.ts`.
Mutant: ws-hold forwards the dec's reason -> `sends ONE --reason on ws-hold, and it is the hold's own`
fails with `expected [ '--reason', '--reason' ] to have a length of 1 but got 2`. Restore.

- [ ] **Step 10: commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/src/ccdargv.ts server/test/capsupported.test.ts server/test/whitelist-subset.test.ts server/test/lifecycle.test.ts && git commit -m "server(wave6): ActorFlags, deviceActor, and the five threaded argv builders

Flags ride after the granted ['<verb>','--session'] prefix, so zero new
grants — whitelist-subset proves it, including its standalone ws-rename
case at :182. null omits every flag and reproduces the pre-wave argv
token for token. ActorFlags' docstring states its relationship to L0's
LifecycleDec and a type-level pin holds it."
```

---

### Task 53: `GateDecision.device` — attribution, never a decision

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/auth/sessions.ts` — insert
  `verifyMeasured` immediately above `verify` (`:245-261`) and rewrite `verify` as a one-line derivation.
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/auth/gate.ts` — `:329-331` (the
  union), its docstring, and the **seven** construction sites: `:343`, `:382`, `:387`, `:408`, `:414`,
  `:416-417`, `:457-461`.
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/auth-gate.test.ts` — the six
  whole-decision assertions at `:941`, `:949`, `:995`, `:1015`, `:1046`, `:1051`, and one appended
  `describe` at the end of the file (the file is 1057 lines).

**Interfaces:**
- *Consumes:* `SessionRecord.label` (`auth/sessions.ts:98-99` — *"A human-facing note (the device that
  logged in). Not used in any decision."*); `AuthVerdict`, `sha256hex`, `isExpired`, `timingSafeEqual`
  (all already in `sessions.ts`).
- *Produces:*
  - `SessionStore.verifyMeasured(token: string, currentGeneration: number, now: number): { verdict: AuthVerdict; label: string | null }`
    — the same single loop, answering the matched row as well as the verdict. `verify` keeps its exact
    signature and derives from it.
  - `GateDecision` gains `device: string | null` on **both** union arms, **non-optional**.

**Steps:**

- [ ] **Step 1: write the failing test.** Append to `server/test/auth-gate.test.ts`. It builds its own
fixtures from the shipped ones — `auth-gate.test.ts` has **no** `liveDeps`/`mintSession`/`withCookie`
helper (measured: the pure-decision describe at `:933` declares a local `req(method, url, cookie?)`, a
`store`, and a `secretOk`, and mints sessions with `live.create('probe', 3, 1_000)`), so this describe
repeats that idiom rather than importing a helper that does not exist.

```ts
// ── wave 6: the device the gate measured ─────────────────────────────────

describe('GateDecision.device — attribution, never a decision input', () => {
  const req = (method: string, url: string | undefined, cookie?: string): GateRequest =>
    ({ method, routeOptions: { url }, headers: cookie === undefined ? {} : { cookie } });
  const secretOk = { kind: 'ok' as const, secret: { n: 2, r: 8, p: 1, saltB64: '', hashB64: '', generation: 3 } };

  const liveStore = async (): Promise<SessionStore> => {
    const s = new SessionStore(path.join(mkTmp('ccrc-auth-device-'), 'sessions.json'));
    await s.load();
    return s;
  };

  it('carries the session row`s own label on the one arm that verified a credential', async () => {
    const store = await liveStore();
    const { token } = await store.create('Mozilla/5.0 (iPhone)', 3, 1_000);
    const deps = { enabled: true, secret: secretOk, store };
    expect(sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${token}`), deps, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'session', device: 'Mozilla/5.0 (iPhone)' });
  });

  it('is null on every arm that did NOT verify a credential', async () => {
    // SEVEN construction sites, and each one must SAY it measured nothing
    // rather than omit the field: an optional `device?` would let a site forget
    // it, and a reader cannot tell a forgotten field from a measured absence —
    // which is exactly what a genuinely deviceless allow already means.
    const store = await liveStore();
    const deps = { enabled: true, secret: secretOk, store };
    expect(authVerdict(req('GET', '/api/accounts'), { ...deps, enabled: false }, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'flag-off', device: null });
    expect(authVerdict(req('GET', '/health'), deps, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'exempt', device: null });
    expect(sessionVerdict(req('GET', '/api/accounts'), { ...deps, secret: SECRET_UNREAD }, 1_000))
      .toEqual({ allow: false, verdict: 'unconfigured', reason: 'refused', device: null });
    expect(sessionVerdict(req('GET', '/api/accounts'), deps, 1_000))
      .toEqual({ allow: false, verdict: 'no-session', reason: 'refused', device: null });
    expect(sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=junk`), deps, 1_000))
      .toEqual({ allow: false, verdict: 'expired', reason: 'refused', device: null });
    expect(NO_SESSION)
      .toEqual({ allow: false, verdict: 'no-session', reason: 'refused', device: null });
  });

  it('never becomes a decision input — allow and reason are unchanged by the label', async () => {
    const store = await liveStore();
    const deps = { enabled: true, secret: secretOk, store };
    const a = await store.create('iPhone', 3, 1_000);
    const b = await store.create('', 3, 1_000);
    const da = sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${a.token}`), deps, 1_000);
    const db = sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${b.token}`), deps, 1_000);
    expect([da.allow, da.reason]).toEqual([db.allow, db.reason]);
    expect(da.device).not.toBe(db.device);
  });

  it('verifyMeasured is the primitive and verify derives — one loop, not two lookups', async () => {
    const store = await liveStore();
    const { token } = await store.create('iPhone', 3, 1_000);
    expect(store.verifyMeasured(token, 3, 1_000)).toEqual({ verdict: 'ok', label: 'iPhone' });
    expect(store.verify(token, 3, 1_000)).toBe('ok');
    // No row matched ⇒ nothing was measured. `null`, never `''`: an empty label
    // is a row that logged in from a UA-less browser, which is a different fact.
    expect(store.verifyMeasured('nope', 3, 1_000)).toEqual({ verdict: 'no-session', label: null });
    expect(store.verifyMeasured(token, 4, 1_000)).toEqual({ verdict: 'expired', label: null });
  });
});
```
Add `NO_SESSION` to the existing `'../src/auth/gate.js'` import block at `:22-25` (measured: it currently
imports `EXEMPT, SECRET_UNREAD, authVerdict, exemptKey, installGate, measureSecret, sessionVerdict, type GateRequest`).
`path`, `mkTmp`, `SessionStore` and `SESSION_COOKIE` are already imported by the file.

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/auth-gate.test.ts -t 'GateDecision.device'
```
Expected failure: `carries the session row's own label on the one arm that verified a credential` fails
with
`expected { allow: true, verdict: 'ok', reason: 'session' } to deeply equal { allow: true, verdict: 'ok', reason: 'session', device: 'Mozilla/5.0 (iPhone)' }`.

- [ ] **Step 3: write `verifyMeasured`.** In `server/src/auth/sessions.ts`, insert immediately above
`verify` and rewrite `verify` as a derivation, keeping `verify`'s existing docstring where it is and
appending one line to it (*"Derives from {@link verifyMeasured} since wave 6 — same loop, same effects,
the verdict half."*):

```ts
  /**
   * {@link verify}'s answer PLUS the matched row's device label — one loop, one
   * read, exactly as before. `readFileMeasured`/`readFile` in `server/src/io.ts`
   * is the same shape and the same argument: the RICHER answer is the primitive
   * and the narrow one derives from it, so there is never a SECOND lookup and
   * never two readers of the same rows that could disagree.
   *
   * `label` is `null` for every non-`'ok'` verdict, and that is not a stand-in
   * for the empty string: no row was matched, so nothing was measured. Still
   * SYNCHRONOUS and still no I/O — the property that lets the hottest path in
   * the server stay pure (`gate.ts`'s `GateDeps`).
   *
   * NOT A DECISION INPUT, here or anywhere downstream. The label is
   * attacker-controlled text (`server.ts`'s `deviceLabel` truncates a
   * user-agent) and it exists to be RECORDED, never to be compared.
   */
  verifyMeasured(
    token: string, currentGeneration: number, now: number,
  ): { verdict: AuthVerdict; label: string | null } {
    const presented = Buffer.from(sha256hex(token), 'hex');
    for (const rec of this.records) {
      const stored = Buffer.from(rec.idHash, 'hex');
      // length-check FIRST (coord/token.ts:220-228): equal-length sha256 always,
      // but a garbled stored hash of the wrong length would make
      // `timingSafeEqual` throw a RangeError rather than answering "no". Skip
      // such a row, do not crash.
      if (stored.length !== presented.length) continue;
      if (!timingSafeEqual(stored, presented)) continue;
      if (rec.generation !== currentGeneration) return { verdict: 'expired', label: null };
      if (isExpired(rec, now)) return { verdict: 'expired', label: null };
      rec.lastSeenAt = now;
      this.dirty = true;
      return { verdict: 'ok', label: rec.label };
    }
    return { verdict: 'no-session', label: null };
  }

  verify(token: string, currentGeneration: number, now: number): AuthVerdict {
    return this.verifyMeasured(token, currentGeneration, now).verdict;
  }
```
Every one of `auth-sessions.test.ts`'s `store.verify(...)` assertions stays green with **zero edits**,
which is the point of deriving rather than widening.

- [ ] **Step 4: widen the union and its docstring.** `gate.ts:329-331`:

```ts
export type GateDecision =
  | { allow: true; verdict: 'ok'; reason: GateAllowReason; device: string | null }
  | { allow: false; verdict: AuthVerdict; reason: 'refused'; device: string | null };
```
and append to its docstring:

```
 * `device` is ATTRIBUTION, never authentication and never an input to `allow`.
 * It is the matched session row's own label — the browser that logged in — and
 * it is `null` on every arm that did not verify a credential, including the two
 * allows that are true for reasons other than a session. NON-OPTIONAL on both
 * arms deliberately: `device?` would let a construction site forget the field,
 * and a reader cannot tell a forgotten field from a measured absence. Its one
 * consumer is `ccdargv.ts`'s `deviceActor`, which turns it into the `--actor` a
 * workspace verb records — which is exactly why it must never widen into a
 * decision: an attacker-controlled user-agent that could change what a route
 * ALLOWS would be a hole, while one that changes what a route RECORDS is the
 * feature (spec D2: `dec` is self-asserted, and `corroboration()` is what
 * catches a lie).
```

- [ ] **Step 5: give each of the seven construction sites an explicit `device`.**

```ts
// :343
export const NO_SESSION: GateDecision = { allow: false, verdict: 'no-session', reason: 'refused', device: null };
// :382
  if (!deps.enabled) return { allow: true, verdict: 'ok', reason: 'flag-off', device: null };
// :387 — keep the existing `reason: 'exempt', NEVER 'session'` comment and extend it with:
//   "…and `device: null` for the same reason — this arm returns before the cookie has been read."
  if (key !== null && EXEMPT.has(key)) return { allow: true, verdict: 'ok', reason: 'exempt', device: null };
// :408
    return { allow: false, verdict: 'unconfigured', reason: 'refused', device: null };
// :414
  if (token === undefined || token === '') return { allow: false, verdict: 'no-session', reason: 'refused', device: null };
// :416-417
  const measured = deps.store.verifyMeasured(token, deps.secret.secret.generation, now);
  const verdict = measured.verdict;
  if (verdict === 'ok') return { allow: true, verdict, reason: 'session', device: measured.label };
// :457-461
  return {
    allow: false,
    verdict: verdict === 'no-session' ? 'expired' : verdict,
    reason: 'refused',
    // A cookie that matched nothing measured no row, so there is no device —
    // and saying so is not the same as saying `''`.
    device: null,
  };
```

- [ ] **Step 6: extend the six existing whole-decision assertions.** Add `device: null` to the expected
object at `auth-gate.test.ts:941`, `:949`, `:995`, `:1015` and `:1046`. `:1051` is the one that verified
a credential — it reads
`expect(sessionVerdict(withCookie, deps, 1_000)).toEqual({ allow: true, verdict: 'ok', reason: 'session' });`
and its fixture minted the session with `live.create('probe', 3, 1_000)`, so it becomes:

```ts
    expect(sessionVerdict(withCookie, deps, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'session', device: 'probe' });
```

- [ ] **Step 7: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/auth-gate.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/auth-sessions.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/auth-routes.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/coord-routes.test.ts
```
Expected: green. `auth-sessions.test.ts` green **with zero edits** is the assertion that `verify` was
derived and not widened.

- [ ] **Step 8: mutant — the optional field.** Change `device: string | null` to `device?: string` on
both arms and delete `device` from the `:414` literal, then re-run `test/auth-gate.test.ts`.
Mutant: non-optional -> optional -> `is null on every arm that did NOT verify a credential` fails with
`expected { allow: false, verdict: 'no-session', reason: 'refused' } to deeply equal { …, device: null }`
**and** `tsc` stays clean — which is the whole reason the field is non-optional. Restore.

- [ ] **Step 9: mutant — the measured label.** Make `sessionVerdict`'s `'ok'` arm return `device: null`
and re-run.
Mutant: `device: measured.label` -> `device: null` -> `carries the session row's own label on the one arm
that verified a credential` fails with `expected { …, device: null } to deeply equal { …, device:
'Mozilla/5.0 (iPhone)' }`. Restore.

- [ ] **Step 10: commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/src/auth/gate.ts server/src/auth/sessions.ts server/test/auth-gate.test.ts && git commit -m "server(wave6): GateDecision.device — attribution, never a decision

verifyMeasured is the primitive and verify derives from it (io.ts's
readFileMeasured shape): one loop, one read, no second lookup on the
hottest path. Non-optional on both union arms, so all seven construction
sites had to decide; auth-sessions stays green with zero edits."
```

---

### Task 54: the four human routes declare `surface pwa` and the device

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/server.ts` — extend the `ccdargv.js`
  import at `:24`; add `pwaDec` immediately after `sessionAuth`'s closing `}, Date.now());` (`:435`); the
  four call sites at `:1694`, `:1711`, `:1756`, `:1769`.
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/test/lifecycle.test.ts`

**Interfaces:**
- *Consumes:* `ACTOR_FLAGS_CAP`, `capSupported`, `deviceActor`, `type ActorFlags`,
  `CCD_ARGV.wsArchive|wsRestore|wsHold|wsRelease` (Tasks 51–52); `sessionAuth(req): GateDecision`
  (`server.ts:433-435`), whose `device` Task 53 added; `makeApp({ ccdVerbs })`, `ID`
  (`server/test/lifecycle.test.ts:17`, `:38-64`).
- *Produces:* `POST /api/sessions/:id/{archive,restore,hold,release}` append
  `--surface pwa --actor device:<label>` **iff** the deployed ccd advertised `actor-flags-v1`.
  **No request-body change**, so the PWA is untouched.

**Steps:**

- [ ] **Step 1: write the failing test.** Append to `server/test/lifecycle.test.ts`:

```ts
describe('wave 6 — the dec flags are sent only to a ccd that says it parses them', () => {
  // THE HEADLINE CASE. An old ccd meets `--surface pwa` inside
  // `cmd_ws_archive`'s exact-arity guard; on the paths where it does not die,
  // `runCcdOr502` renders exit 0 as `200 {ok:true}` for a call that recorded
  // nothing. Guessing wrong here costs a SILENT SUCCESS, which is why
  // `capSupported` refuses on no evidence.
  it('an OLD ccd (no actor-flags-v1) receives the bare argv, byte for byte', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['ws-archive', 'ws-restore', 'ws-hold', 'ws-release'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID]]);
    await app.close();
  });

  it('NO EVIDENCE AT ALL is treated as an old ccd, never as a new one', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: null });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID]]);
    await app.close();
  });

  it('a NEW ccd receives --surface pwa and the device actor', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['ws-archive', 'actor-flags-v1'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    // The gate is DARK in this harness (`CCRC_AUTH` unset), so `secretNow()` is
    // SECRET_UNREAD, `sessionVerdict` refuses at the `kind !== 'ok'` arm, and
    // its `device` is null — the record says `unmeasured` rather than naming a
    // browser nobody saw.
    expect(calls).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID,
                            '--surface', 'pwa', '--actor', 'device:unmeasured']]);
    await app.close();
  });

  it('hold keeps its own --reason first, and never grows a second one', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['ws-hold', 'actor-flags-v1'] });
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/hold`, payload: { reason: 'program:x wave:1/4' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'ws-hold', '--session', ID, '--reason', 'program:x wave:1/4',
                            '--surface', 'pwa', '--actor', 'device:unmeasured']]);
    expect(calls[0]!.filter((t) => t === '--reason')).toHaveLength(1);
    await app.close();
  });

  it('restore and release send the same pair', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['ws-restore', 'ws-release', 'actor-flags-v1'] });
    await app.inject({ method: 'POST', url: `/api/sessions/${ID}/restore`, payload: {} });
    await app.inject({ method: 'POST', url: `/api/sessions/${ID}/release`, payload: {} });
    expect(calls).toEqual([
      [cfg.ccdBin, 'ws-restore', '--session', ID, '--surface', 'pwa', '--actor', 'device:unmeasured'],
      [cfg.ccdBin, 'ws-release', '--session', ID, '--surface', 'pwa', '--actor', 'device:unmeasured'],
    ]);
    await app.close();
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'wave 6'
```
Expected failure: `a NEW ccd receives --surface pwa and the device actor` fails with
`expected [ [ '…/ccd', 'ws-archive', '--session', 'claude2-MekWarLive' ] ] to deeply equal [ [ …, '--surface', 'pwa', '--actor', 'device:unmeasured' ] ]`.
The three "old ccd" cases pass already, and that is correct — they are regression pins.

- [ ] **Step 3: extend the import at `server.ts:24`.**

```ts
import { ACTOR_FLAGS_CAP, CCD_ARGV, capSupported, deviceActor, stopSurfaceSupported, verbSupported,
         type ActorFlags, type CcdArgv } from './ccdargv.js';
```

- [ ] **Step 4: add `pwaDec`.** Insert immediately after `sessionAuth`'s closing `}, Date.now());`
(`server.ts:435`) — **after `sessionAuth`, not after `deviceLabel`**, so the helper sits below the value
it reads and no reader has to reason about a temporal dead zone:

```ts
  /**
   * The dec a HUMAN-DRIVEN route declares, or `null` when the deployed ccd is
   * not known to parse the flags (`capSupported`, false on no evidence).
   *
   * `surface: 'pwa'` because that is what this lane looks like from the box —
   * the same word `POST /api/sessions/:id/stop` already sends, and it is a
   * DECLARATION rather than an authentication either way (`StopSurface`'s own
   * docstring). `actor` comes from what the GATE MEASURED (`sessionAuth(req)`),
   * never from `deviceLabel(req)`: the request's own `user-agent` is a claim,
   * the session row's label is a claim that was presented with a live
   * credential, and only the second is worth recording as provenance.
   * `reason: null` because these routes take no reason on the wire and
   * inventing one would put a sentence the operator never wrote into a
   * provenance record; `--reason` exists on ccd for the CLI callers wave 5
   * serves. Nothing about the REQUEST BODY changes, so the PWA is untouched.
   */
  const pwaDec = (req: FastifyRequest): ActorFlags | null =>
    capSupported(deps.fleetState, ACTOR_FLAGS_CAP)
      ? { surface: 'pwa', actor: deviceActor(sessionAuth(req).device), reason: null }
      : null;
```

- [ ] **Step 5: thread the four call sites — one line each, nothing else on them changes.**

```ts
// :1694
    const argv = CCD_ARGV.wsArchive(id, pwaDec(req));
// :1711
    const argv = CCD_ARGV.wsRestore(id, pwaDec(req));
// :1756
    const argv = CCD_ARGV.wsHold(id, body.reason, pwaDec(req));
// :1769
    const argv = CCD_ARGV.wsRelease(id, pwaDec(req));
```

- [ ] **Step 6: run and see it pass.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/lifecycle.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/hold-gate.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/verb-gate.test.ts
```
Expected: green. `hold-gate.test.ts:128`'s
`expect(calls).toContainEqual(['ws-archive', '--session', 'demo-quiet-basin'])` stays green **with zero
edits** — its harness seeds no `fleetState`, so `capSupported(undefined, …)` is false and the argv is
unchanged. That is the inverted default doing its job on a real existing suite.

- [ ] **Step 7: mutant — the gate.** In `pwaDec`, replace
`capSupported(deps.fleetState, ACTOR_FLAGS_CAP)` with `true` and re-run step 6's first two commands.
Mutant: ungated -> `an OLD ccd (no actor-flags-v1) receives the bare argv, byte for byte` and
`NO EVIDENCE AT ALL is treated as an old ccd, never as a new one` both fail with
`expected [ …, '--surface', 'pwa', … ] to deeply equal [ …, '--session', 'claude2-MekWarLive' ]`, and
`hold-gate.test.ts` fails too. Restore.

- [ ] **Step 8: mutant — the wrong device.** Swap `deviceActor(sessionAuth(req).device)` for
`deviceActor(deviceLabel(req))` and re-run.
Mutant: measured device -> claimed device -> `a NEW ccd receives --surface pwa and the device actor`
fails with `expected …'device:unknown device'… to deeply equal …'device:unmeasured'…` — proving the
route records what the GATE MEASURED, not what the request merely claimed. Restore.

- [ ] **Step 9: commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/src/server.ts server/test/lifecycle.test.ts && git commit -m "server(wave6): the four session routes declare surface pwa and the device

Gated on capSupported, false on no evidence: an old ccd gets the argv it
always got, byte for byte. The actor is what the gate measured, never the
request's own user-agent. No request-body change, so the PWA is untouched."
```

---

### Task 55: every unattended ccd lane names itself

**Files:**
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/ccdargv.ts` — add `sweepDec`
  immediately after `deviceActor`.
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/watch.ts` — `:1382`, `:1418`, `:2389`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/coord/close.ts` — `:181`, `:183`,
  `:284`, `:289`, `:307`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/coord/dispatch.ts` — `:420`
- Modify `/home/you/worktrees/ccrc-pwa/still-river/server/src/coord/routes.ts` — `:795`
- Create `/home/you/worktrees/ccrc-pwa/still-river/server/test/unattended-actor.test.ts`

**Interfaces:**
- *Consumes:* `ACTOR_FLAGS_CAP`, `capSupported`, `ActorFlags`, `CCD_ARGV.*` (Tasks 51–52);
  `deps.fleetState` — measured present on every one of the four files' deps
  (`close.ts:23`, `dispatch.ts:54`, `routes.ts:831/855/888`, and `this.deps.fleetState` in `watch.ts`).
- *Produces:*
  `export function sweepDec(state: Pick<FleetState,'ccdVerbs'> | undefined, actor: string): ActorFlags | null`
  in `server/src/ccdargv.ts` — `surface: 'agent'`, the given actor, `reason: null`; `null` on no evidence.

**Steps:**

- [ ] **Step 1: write the failing test.** Create `server/test/unattended-actor.test.ts`:

```ts
// server/test/unattended-actor.test.ts
//
// Wave 6's headline sentence: "archiveMerged's timer and a human's ws-rm stop
// being byte-identical." The `--surface` word alone cannot carry that — the
// closed set has four members and none of them means "a server sweep" — so the
// distinguisher is the ACTOR, and that is why `ActorFlags.actor` is not
// optional. This file pins that every unattended lane names itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR_FLAGS_CAP, CCD_ARGV, sweepDec } from '../src/ccdargv.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const NEW = { ccdVerbs: [ACTOR_FLAGS_CAP] };
const FILES = ['watch.ts', 'coord/close.ts', 'coord/dispatch.ts', 'coord/routes.ts'];
const BUILDERS = /CCD_ARGV\.(wsArchive|wsRestore|wsHold|wsRelease|wsRename)\(/;

describe('sweepDec', () => {
  it('declares the agent lane and names the sweep', () => {
    expect(sweepDec(NEW, 'sweep:archive-merged'))
      .toEqual({ surface: 'agent', actor: 'sweep:archive-merged', reason: null });
  });

  it('is null on no evidence, exactly as the human lane is', () => {
    expect(sweepDec({ ccdVerbs: null }, 'sweep:names')).toBeNull();
    expect(sweepDec(undefined, 'sweep:names')).toBeNull();
    expect(sweepDec({ ccdVerbs: ['ws-rename'] }, 'sweep:names')).toBeNull();
  });

  it('builds an argv whose actor survives to the flags', () => {
    expect(CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', sweepDec(NEW, 'sweep:names')))
      .toEqual(['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/x',
                '--surface', 'agent', '--actor', 'sweep:names']);
  });
});

describe('every unattended ccd call site names itself', () => {
  it('leaves no hand-written `null` dec at a site that has a lane to declare', () => {
    // A source scan, and the reason is that the alternative pins nothing: a
    // sweep threaded with `null` compiles, runs, and records exactly what the
    // pre-wave build recorded — a byte-identical act with no way to tell whose
    // it was, which is the defect this wave exists to remove. The `null`s that
    // remain are the CAPABILITY answer (`sweepDec`/`pwaDec` return it), never a
    // hand-written one. The window is three lines because two of these call
    // sites already wrap (`close.ts:181-183`).
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(path.join(srcRoot, f), 'utf8').split('\n');
      src.forEach((line, i) => {
        if (!BUILDERS.test(line)) return;
        if (/,\s*null\s*\)/.test(src.slice(i, i + 3).join('\n'))) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `these unattended sites record nothing about who acted: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('found the call sites at all — a scan over nothing passes everything', () => {
    let n = 0;
    for (const f of FILES) {
      n += readFileSync(path.join(srcRoot, f), 'utf8').split('\n')
        .filter((l) => BUILDERS.test(l)).length;
    }
    expect(n, 'the scan matched no unattended ccd call site at all').toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: run and see it fail.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts
```
Expected failure: collection fails with
`SyntaxError: The requested module '../src/ccdargv.js' does not provide an export named 'sweepDec'`.

- [ ] **Step 3: add `sweepDec`.** In `server/src/ccdargv.ts`, immediately after `deviceActor`:

```ts
/**
 * The dec an UNATTENDED server lane declares — a sweep, a run close, a dispatch.
 *
 * `surface: 'agent'` is the least-wrong member of ccd's four-word closed set,
 * and the residual is DISCLOSED rather than papered over: the word names the
 * agent LANE, not the ccrc-agent process, so it cannot on its own tell the
 * agent apart from the server's own timers. That is precisely why `actor` is
 * NOT optional on `ActorFlags` — the actor is what makes `archiveMerged`'s
 * timer and an operator's tap distinguishable — and why a fifth surface word is
 * not the fix: spec §2 says `StopSurface` is unchanged, and widening a closed
 * set that `ccd:619` also spells would be one enumeration in two languages
 * drifting apart.
 *
 * `reason: null`: a sweep's reason is its name, and repeating it in a second
 * field would be one fact in two places with nothing keeping them equal.
 */
export function sweepDec(
  state: Pick<FleetState, 'ccdVerbs'> | undefined,
  actor: string,
): ActorFlags | null {
  return capSupported(state, ACTOR_FLAGS_CAP)
    ? { surface: 'agent', actor, reason: null }
    : null;
}
```

- [ ] **Step 4: thread `watch.ts`'s three sites.** Add `sweepDec` to the existing `./ccdargv.js` import,
then:

```ts
// :1382
      if (!verbSupported(this.deps.fleetState,
                         CCD_ARGV.wsRename(r.id, born, sweepDec(this.deps.fleetState, 'sweep:names')))) continue;
// :1418
      const res = await this.deps.queue.run(r.id, () => this.deps.runCcd(
        CCD_ARGV.wsRename(r.id, branch, sweepDec(this.deps.fleetState, 'sweep:names'))));
// :2389
      const argv = CCD_ARGV.wsArchive(r.id, sweepDec(this.deps.fleetState, 'sweep:archive-merged'));
```

- [ ] **Step 5: thread `coord/`'s seven sites.** All five `close.ts` sites live inside
`closeRun(id, …)` (`close.ts:91`, `const run = coord.run(id)` at `:96`), so `id` — the run id — is in
scope at every one of them and no second reader of the same value is introduced:

```ts
// close.ts:181-183
      const argv = survivor !== null && !release
        ? CCD_ARGV.wsHold(run.sessionId,
            holdReason(survivor.program, survivor.wave, survivor.waveOf, survivor.id),
            sweepDec(deps.fleetState, `run:${id} close`))
        : CCD_ARGV.wsRelease(run.sessionId, sweepDec(deps.fleetState, `run:${id} close`));
// close.ts:284
    const argv = CCD_ARGV.wsArchive(run.sessionId, sweepDec(deps.fleetState, `run:${id} close`));
// close.ts:289
    const argv = CCD_ARGV.wsRelease(run.sessionId, sweepDec(deps.fleetState, `run:${id} close`));
// close.ts:307
    const argv = CCD_ARGV.wsHold(run.sessionId, nextReason, sweepDec(deps.fleetState, `run:${id} close`));
// dispatch.ts:420 — `run.id` is what this function names the run
  const holdArgv = CCD_ARGV.wsHold(sessionId,
    holdReason(run.program, run.wave, run.waveOf, run.id),
    sweepDec(deps.fleetState, `run:${run.id} dispatch`));
// coord/routes.ts:795 — `opened.id` is what this handler names the run it just opened
      const argv = CCD_ARGV.wsHold(sessionId,
        holdReason(program, wave, waveOfVal, opened.id),
        sweepDec(deps.fleetState, `run:${opened.id} open`));
```
Add `sweepDec` to each file's existing `ccdargv.js` import; none of them needs a new import statement.

- [ ] **Step 6: run and see it pass, then typecheck the whole server.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```
Expected: green, and `tsc` silent. This is the first point at which `tsc` can be clean — all fourteen
production call sites now pass the new argument. If `typecheck-tests` is red, re-run it in isolation on
an idle box before calling it a break (CLAUDE.md's flake list).

- [ ] **Step 7: run the suites that pin an exact unattended argv.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/close-route.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/run-routes.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/name-sweep.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/hold-gate.test.ts
cd /home/you/worktrees/ccrc-pwa/still-river/server && ./node_modules/.bin/vitest run test/dispatch.test.ts
```
Any of those that pins an exact argv **and** seeds a `fleetState` containing `actor-flags-v1` needs its
expectation EXTENDED with the two flag pairs; one that seeds no `fleetState`, or seeds one without the
token, stays green untouched because `sweepDec` answers `null`. **Extend, never delete**, and name in
the commit body which suites were extended and which were untouched.

- [ ] **Step 8: mutant — a hand-written null.** Change `watch.ts:2389`'s
`sweepDec(this.deps.fleetState, 'sweep:archive-merged')` to `null` and re-run
`test/unattended-actor.test.ts`.
Mutant: `sweepDec(...)` -> `null` -> `leaves no hand-written 'null' dec at a site that has a lane to
declare` fails with `these unattended sites record nothing about who acted: watch.ts:2389`. Restore.

- [ ] **Step 9: mutant — a timer claiming to be a person.** Change `sweepDec`'s `surface` to `'pwa'` and
re-run.
Mutant: `'agent'` -> `'pwa'` -> `declares the agent lane and names the sweep` fails with
`expected 'pwa' to be 'agent'` — the pin that stops a timer claiming to be a person. Restore.

- [ ] **Step 10: commit.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && git add server/src/ccdargv.ts server/src/watch.ts server/src/coord/close.ts server/src/coord/dispatch.ts server/src/coord/routes.ts server/test/unattended-actor.test.ts && git commit -m "server(wave6): every unattended ccd lane names itself

sweepDec declares surface agent and the sweep's own name. The surface
word cannot carry this (four members, none means 'a server timer'), which
is why actor is not optional — a source scan reds any site threaded with
a hand-written null."
```

---

### Task 56: full suites, deploy the server, verify the record on the box

**Files:** none.

**Interfaces:** *Consumes:* everything above. *Produces:* waves 5 and 6 live on `<server-host>`, and the
**wave-6 exit criterion** measured on the real box: *a `ws-hold` driven from the PWA produces a journal
line whose `dec.surface` is `pwa`* (AUDIT **M10** — the criterion is about the RECORD, not the argv, and
Task 49 is what makes it true).

**Steps:**

- [ ] **Step 1: run the three package suites, in the foreground, timeout at least 600000 ms.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
cd /home/you/worktrees/ccrc-pwa/still-river/agent  && npm run test
cd /home/you/worktrees/ccrc-pwa/still-river/pwa    && npm run test
```
`agent/` and `pwa/` must be green **with zero edits from this group** — waves 5 and 6 change no wire
type, no frame, no grant and no request body, and that is the check that says so. On a red in
`typecheck-tests`, re-run that one suite in isolation on an idle box before treating it as a break; it
is the only entry on CLAUDE.md's flake list this group touches.

- [ ] **Step 2: confirm the agent lane is already ahead of the server.**

```bash
ssh "$CCRC_BOX" '~/.local/bin/ccd caps' | grep -x 'actor-flags-v1'
```
Expected: `actor-flags-v1`, from Task 50's deploy. **If it is absent, STOP** — deploying the server first
would send flags the box refuses, which is the exact ordering CLAUDE.md's agent-first rule exists to
prevent.

- [ ] **Step 3: deploy the server.**

```bash
cd /home/you/worktrees/ccrc-pwa/still-river && bash deploy/deploy.sh
```

- [ ] **Step 4: verify the shipped sha through `/health`** — the server lane's own final gate.

```bash
curl -sS http://<server-host>:7788/health
```
Expected: an `ok` body whose build sha matches the sha the deploy printed on its final line.

- [ ] **Step 5: measure the wave-6 exit criterion end to end, with one non-destructive act.**
From the PWA (or with one authenticated `POST`), put a `ws-hold` on a workspace you already own, then
release it, then read the record back:

```bash
curl -sS -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" \
  'http://<server-host>:7788/api/lifecycle?limit=10' | head -c 2000
```
Expected: a `hold` event whose `dec` reads
`{"surface":"pwa","actor":"device:<the browser that logged in>"}` — **`surface: "pwa"` is the criterion**.
A sweep's own line in the same window reads `{"surface":"agent","actor":"run:… close"}`, and the two
being different words on two acts that used to be byte-identical is what wave 6 delivered.
Never print the token's contents; the `$(cat …)` substitution is the only place it appears and it goes
straight into a header.

- [ ] **Step 6: do not verify with a destructive verb.** `ws-rm`, `ws-reap`, `ws-gc --prune`,
`ws-archive` and `ws-restore` against the live host are the standing prohibition (CLAUDE.md SAFETY), and
every one of them is already exercised under a fixture HOME by `ccd-actor-flags.test.ts`. `ws-hold` and
`ws-release` are the two non-destructive verbs in this group's set, which is why step 5 uses them.

---

## Summary of edits, for the reviewer

| File | Wave | What |
|---|---|---|
| `server/test/ccd-actor-flags.test.ts` | 5 | **new** — pins wave 3's validators (givenness, byte cap, refuse-not-truncate, arithmetic containment, locale scoping), the flag loops on all five verbs, the JSON refusal shape, wsaudit non-poisoning, and the journal round-trip |
| `server/test/lifecycle-constants-twin.test.ts` | 5 | **new** — AUDIT B5's cross-language binding: four ccd constants set-equal to their L0 twins |
| `ccd/ccd` | 5 | flag loops in `cmd_ws_archive` / `cmd_ws_restore` (via `_lc_refuse`) / `cmd_ws_hold` / `cmd_ws_release` / `cmd_ws_rename`; the dec triple threaded into wave 2's emit sites as dotted `dec.*` pairs; `echo actor-flags-v1` + the repaired caps comment |
| `server/test/ccd-archive.test.ts:153` | 5 | `KNOWN_CAPABILITY_TOKENS` -> three tokens |
| `server/src/ccdargv.ts` | 6 | `ACTOR_FLAGS_CAP`, `capSupported`, `ActorFlags`, `decFlags`, `deviceActor`, `sweepDec`; five table signatures; `stopSurfaceSupported` delegates and its docstring is corrected |
| `server/src/auth/gate.ts` | 6 | `GateDecision.device` + seven construction sites |
| `server/src/auth/sessions.ts` | 6 | `verifyMeasured`; `verify` derives |
| `server/src/server.ts` | 6 | `pwaDec` + four route call sites |
| `server/src/watch.ts`, `coord/close.ts`, `coord/dispatch.ts`, `coord/routes.ts` | 6 | ten unattended call sites |
| `server/test/{capsupported,unattended-actor}.test.ts` | 6 | **new** |
| `server/test/{readme-holds,whitelist-subset,lifecycle,auth-gate}.test.ts` | 6 | stated, visible edits (incl. `whitelist-subset.test.ts:182`, which the earlier draft missed) |

**Green with zero edits, and that is an assertion of this group:** `server/test/wsaudit.test.ts`,
`server/test/auth-sessions.test.ts`, `server/test/hold-gate.test.ts`, `agent/` in full (zero grants,
zero frames, zero agent code), `pwa/` in full (no wire change, no request-body change).

---

## Deviations found

*(none yet — implementers append numbered D-N entries here as they are discovered; allocate from
the next free global D-number, checking origin/main for what has landed since this branch was cut)*
