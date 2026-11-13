# Overlord W1a: the context readings the renewal triggers need Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the server can read, for one session, how many tokens its context holds and how big its window is, and how
many compactions its current conversation has had, each as a measured answer that tells a reading from absent,
unreadable, malformed and stale.

**Why:** the renewal triggers read the context (the hard cap, the idle floor, the wave boundary, a resumed long
conversation) and count compactions (two in one generation) (spec Table 3.3.11b). Today the statusline sidecar carries
only a percentage, and nothing on the server reads the compactions journal. W0a measured the fields Claude Code's
statusline already carries (W0-18, the results note's Proposal 8) and that an automatic compaction under the rig fired
PreCompact `auto` with no SessionStart `compact` after it (W0-05, Proposal 2). A stale sample is unmeasured, never
"below" (Table 3.3.11b).

**Architecture:** two fleet-box writers gain fields (the statusline script, the hook's compaction journal); two L3
readers on the server read them through `FleetIO`, each keeping every distinction it receives; one L1 function counts
compactions from journal lines. No decision about renewal is made here: the renewal-deciders piece reads these
answers. One pull request.

**Tech Stack:** bash (`ccd/statusline-command.sh`, `ccd/session-hook.sh`), TypeScript (ESM), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` Table 3.3.11b (rows "Hard cap", "Two compactions in
one generation"), Table 3.6a (the statusline sidecar and the compactions journal: one writer each, "unmeasured" when
stale), §3.3.4; the results note `docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md` (W0-05, W0-18,
Proposals 2 and 8).

## What exists today

- **The sidecar.** `ccd/statusline-command.sh` writes `~/.cc-sessions/usage/<id>.json` atomically, with `ts`, `uuid`,
  `account`, `model` (`.model.id`), `effort`, `ctxPct` (`.context_window.used_percentage`), `cost`, `cacheExpiresAt`
  and `agent`. Claude Code's payload also carries `context_window.total_input_tokens` (input plus cache read plus cache
  creation) and `context_window.context_window_size` (W0-18).
- **Its reader.** `server/src/usage.ts#parseUsageSidecar` returns `{ kind: 'reading', usage }` or `malformed`;
  `readUsageMeasured` adds `absent` and `unreadable`; `readUsage` folds them to `null`, deliberately, for the fleet
  wire's one slot. `shared/api.ts#SessionUsage` carries `ts, model, class, effort, ctxPct, cost, cacheExpiresAt?,
  stale`. `stale` is `nowS - ts > USAGE_FRESH_S`. Tests: `server/test/usage-sidecar.test.ts`,
  `server/test/statusline-script.test.ts`.
- **The compactions journal.** `ccd/session-hook.sh#_hook_compact_post` appends `{at, trigger, transcript}` to
  `$REG/<id>.compactions` on PostCompact, under `.<id>.compactions.lock`. `_hook_compact_pre` runs on PreCompact and
  writes no journal line. The only reader is `ccd/history/sweep.mjs` (the transcript paths). Nothing in `server/src` or
  `agent/src` reads it. Tests: `server/test/session-hook-compact-carry.test.ts` and the hook suites
  (measure: `grep -ln 'compactions' server/test`).
- `usageSidecarPath` notes that the agent's `.cc-sessions/` read root covers the sidecar; the journal sits in the same
  root, so the remote adapter needs no whitelist change (measure in Task 3 Step 1).

## Global Constraints

- **Architecture (`CLAUDE.md`).** One writer per file: the statusline script for the sidecar, the hook for the
  journal. The readers are L3 and keep every distinction (`absent`, `unreadable`, `malformed`, `stale`); the counter is
  L1 and pure. New modules live in `server/src/continuity/` (context C3), which the time-ports scan covers by its
  family pattern (`server/test/single-definition/time-ports.test.ts#TIME_PORT_FAMILIES`); the first piece that creates
  the directory adds `continuity/**` to C3's row of the ring-context table in
  `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (read by `server/test/rings/ringContextMap.ts`).
  Additive wire: `SessionUsage` gains two optional fields with one reader each, and an older sidecar without them
  reads `null`. A guard ships with a test that goes red without it.
- **SAFETY (`CLAUDE.md`).** No ccd verb is added. Hook and statusline tests run against fixture HOMEs only. Nothing
  reads a credential.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs through `ccrc test --`. `session-hook*` suites are load-sensitive; re-run a red one alone first.
- **Growth check.** `ccd/session-hook.sh` grows at most 40 net lines (`server/test/growthCheck.ts#GROWTH_LIMIT`).
- **Mutation floors.** `compactionsSince` is a new L1 function: it joins `MUTANT_SETS` and
  `server/test/sim/mutation-floors.json`.
- Cite by symbol or `@anchor`. No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-context-readings/departures.md`.

## Review Focus

1. A stale or absent sample is never read as a low context: the reader answers it as such, and nothing folds it to 0.
2. An automatic compaction that fires PreCompact but no PostCompact is still counted, and one that fires both is
   counted once.
3. The sidecar keeps its atomic write and its existing fields byte for byte.

---

### Task 1: The sidecar carries the token count and the window size

**Files:**
- Modify: `ccd/statusline-command.sh` (two fields in the sidecar's `jq` composition: `ctxTokens` from
  `.context_window.total_input_tokens // null`, `ctxWindow` from `.context_window.context_window_size // null`)
- Test: `server/test/statusline-script.test.ts`

- [ ] **Step 1: Characterize.** Run `test/statusline-script.test.ts`. Expected: green; it stays green, unedited.
- [ ] **Step 2: Failing test.** Feed the script a payload with `context_window: { total_input_tokens: 71000,
  context_window_size: 1000000, used_percentage: 7 }`: the sidecar has `ctxTokens: 71000`, `ctxWindow: 1000000`, and
  every existing field unchanged. A payload without `context_window` writes both as `null`.
- [ ] **Step 3: Run.** Expected: red.
- [ ] **Step 4: Implement** in the existing composition, beside `ctxPct`.
- [ ] **Step 5: Run.** Expected: green.
- [ ] **Step 6: Commit.** `feat(statusline): the sidecar carries the context's token count and window size (W0-18)`

### Task 2: The usage reader reads them

**Files:**
- Modify: `shared/api.ts` (`SessionUsage` gains `ctxTokens?: number | null` and `ctxWindow?: number | null`, each
  with a comment naming W0-18 and "optional because an older sidecar omits it")
- Modify: `server/src/usage.ts` (`parseUsageSidecar` reads both with its `num` helper)
- Test: `server/test/usage-sidecar.test.ts`

- [ ] **Step 1: Failing tests.** Both read; a string or a negative is `null`; an old sidecar without them reads
  `null` for both and every other field as before.
- [ ] **Step 2: Run.** Expected: red. **Step 3: Implement.** **Step 4: Run** this suite, `test/rings/wire-totality.test.ts`
  and both `tsc` runs. Expected: green.
- [ ] **Step 5: Commit.** `feat(usage): SessionUsage reads the context's token count and window size`

### Task 3: The hook journals a PreCompact too

**Files:**
- Modify: `ccd/session-hook.sh` (`_hook_compact_pre` appends `{at, trigger, transcript, phase: "pre"}` through the same
  locked append `_hook_compact_post` uses; factor that append into one function, so the journal keeps one writer)
- Test: the hook's compaction suite (measure which one pins the journal line's shape)

- [ ] **Step 1: Measure.** Read `_hook_compact_pre` and `_hook_compact_post`; name the append and its lock in the
  departures note. Confirm the agent's read whitelist covers `$REG/<id>.compactions`.
- [ ] **Step 2: Failing test** (fixture HOME): a PreCompact `auto` event appends one line with `phase: "pre"`; a
  PostCompact appends one line with no `phase`, exactly as today; `ccd/history/sweep.mjs`'s reader still finds its
  transcripts (its suite stays green).
- [ ] **Step 3: Run.** Expected: red. **Step 4: Implement.** **Step 5: Run** the hook's compaction suites and the history
  sweep's suite. Expected: green.
- [ ] **Step 6: Mutation.** Append the pre line outside the lock: the suite's concurrent-append case (if it has one) goes
  red; if it has none, add one. Revert.
- [ ] **Step 7: Commit.** `feat(hook): PreCompact journals a pre line, so an automatic compaction is counted (W0-05)`

### Task 4: The server reads the journal and counts compactions

**Files:**
- Create: `server/src/continuity/compactions.ts` (L3 `readCompactionsMeasured(io, registryDir, id)` and L1
  `compactionsSince(lines, sinceMs)`, in two exported functions; the L1 function imports nothing that does I/O)
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (C3's row gains `continuity/**`, if no
  earlier piece added it)
- Test: `server/test/continuity-compactions.test.ts` (new)

**Interfaces:**

```ts
export interface CompactionLine { readonly at: number; readonly trigger: 'auto' | 'manual' | 'other'; readonly phase: 'pre' | 'post' }
export type CompactionsRead =
  | { readonly kind: 'lines'; readonly lines: readonly CompactionLine[]; readonly skipped: number }  // skipped: malformed lines
  | { readonly kind: 'absent' } | { readonly kind: 'unreadable' };
export async function readCompactionsMeasured(io: FleetIO, registryDir: string, id: string): Promise<CompactionsRead>;
/** One compaction per `pre`; a `post` with the same trigger within COMPACTION_PAIR_MS after a `pre` is the same one;
 *  a `post` with no such `pre` is one more. Lines before `sinceMs` are not counted. */
export function compactionsSince(lines: readonly CompactionLine[], sinceMs: number): number;
export const COMPACTION_PAIR_MS = 600_000;
```

- [ ] **Step 1: Failing tests.** The reader: absent file `absent`; an EACCES `unreadable`; a malformed line counted in
  `skipped`, never thrown. The counter, over every sequence of up to four lines from {pre auto, post auto, post
  manual} at two times: a pre and its post count one; a pre alone counts one; a post alone counts one; two pres count
  two; a post eleven minutes after a pre counts two; lines before `sinceMs` count none. Monotonic: appending a line
  never lowers the count.
- [ ] **Step 2: Run.** Expected: red. **Step 3: Implement.** The file's `at` unit is the hook's (measure; convert to ms
  once, in the reader). **Step 4: Run** this suite, `test/rings/*.test.ts`, `test/single-definition/time-ports.test.ts`
  and both `tsc` runs. Expected: green.
- [ ] **Step 5: Floor.** Register `compactionsSince` with mutants (pair across triggers; `<=` to `<` on the window;
  count posts only). Run `test/sim/mutation-floors.test.ts`.
- [ ] **Step 6: Commit.** `feat(continuity): the server reads the compactions journal and counts compactions`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **compaction-counted-by-pre** — an automatic compaction is counted from PreCompact, paired with a PostCompact within
  ten minutes (Proposal 2: a real automatic compaction's SessionStart and PostCompact are unmeasured).
- **context-tokens-are-total-input** — the context's size is `total_input_tokens` (input plus cache read plus cache
  creation), the figure the statusline itself renders.

## Where things stand

**Needs before it starts:** nothing beyond `main`.

**What depends on it:** the renewal-deciders piece (the hard cap, the idle floor, the wave boundary, the resumed long
conversation, two compactions) and the probes piece (a spot probe each 50k tokens).

**Open questions for the operator:** none.
