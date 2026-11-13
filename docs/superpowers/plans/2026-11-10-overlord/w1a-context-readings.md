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

**Architecture:** one fleet-box writer gains fields (the statusline script) and the hook gains one bounded file of
its own, the compaction events file, beside the PostCompact journal it leaves untouched (ask 367's ruling); two L3
readers on the server read them through `FleetIO`, each keeping every distinction it receives; one L1 function counts
compactions from both. No decision about renewal is made here: the renewal-deciders piece reads these
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
- **The compactions journal.** `ccd/session-hook.sh#_hook_compact_post` appends one record to `$REG/<id>.compactions`
  on PostCompact, under `.<id>.compactions.lock`. A record has exactly sixteen keys (`JOURNAL_RECORD_PRED`: `agent`,
  `at`, `built`, `chars`, `cited`, `cwd`, `fences`, `filesChars`, `liveAgents`, `parentLive`, `scope`, `served`,
  `setSize`, `steered`, `transcript`, `trigger`), `scope` one of `main`, `subagent` or `ambiguous`; and
  `JOURNAL_STAGE_PRED` re-checks every line of the staged file at each commit, so one line of any other shape makes
  every later PostCompact for that session fail to commit, and history's sweep loses its transcript paths. The journal
  therefore takes no new line shape (ask 367). The only reader is `ccd/history/sweep.mjs`. Nothing in `server/src` or
  `agent/src` reads it. Tests: `server/test/session-hook-compact-carry.test.ts` and the hook suites (measure:
  `grep -ln 'compactions' server/test`).
- **PreCompact.** The hook's PreCompact arm runs `_hook_compact_pre` (at `if [[ "$event" == PreCompact ]]`), then
  `_hook_history_pre` later in the file; the compaction piece's refusal is decided in `_hook_history_pre`.
  `_hook_compact_pre` returns early on `COMPACT_CARD_OFF`, on a scope failure and on a lock miss, so a line written
  inside it can be missing without error.
- **Registry files.** `ccd/ccd#_reg_purge` removes every dot-free `$REG/<id>.<field>` file with its row, and
  `_ws_slug_residue` lists them; its inventory comment names them (53 today). A dot-led `.<id>.<x>` file is in
  `_ws_private_family` instead.
- `usageSidecarPath` notes that the agent's `.cc-sessions/` read root covers the sidecar; the journal sits in the same
  root, so the remote adapter needs no whitelist change (measure in Task 3 Step 1).

## Global Constraints

- **Architecture (`CLAUDE.md`).** One writer per file: the statusline script for the sidecar, the hook for the
  journal. The readers are L3 and keep every distinction (`absent`, `unreadable`, `malformed`, `stale`); the counter is
  L1 and pure. New modules live in `server/src/continuity/` (context C3), which the time-ports scan covers by its
  family pattern (`server/test/single-definition/time-ports.test.ts#TIME_PORT_FAMILIES`); card PR A owns
  `continuity/**` in C3's row of the ring-context table in
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
   counted once. A refused PreCompact is never counted (the pre record is written only after the refusal decision).
   A subagent's compaction is not the session's.
3. The PostCompact journal keeps its sixteen-key records byte for byte; nothing new is written into it.
4. The sidecar keeps its atomic write and its existing fields byte for byte.

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

### Task 3: The hook records a PreCompact in its own events file

**Files:**
- Modify: `ccd/session-hook.sh` (a new function `_hook_compact_event <phase>` appends one line
  `{"at":<epoch s>,"trigger":"auto"|"manual","transcript":<path>,"phase":"pre"}` to `$REG/<id>.compactevents` under
  `.<id>.compactions.lock`, keeping at most `COMPACT_EVENTS_MAX` (64) lines, oldest dropped first, through a staged
  file and a rename; the PreCompact arm calls it on its own line AFTER `_hook_history_pre`, so it sits outside
  `_hook_compact_pre`'s early returns and after the place where the compaction piece decides a refusal)
- Modify: `ccd/ccd` (`_reg_purge`'s inventory comment gains `compactevents`: 54)
- Test: `server/test/session-hook-compact-events.test.ts` (new), the `_reg_purge` suite (measure:
  `grep -ln '_reg_purge\|_ws_slug_residue' server/test`)

- [ ] **Step 1: Measure.** Read `_hook_compact_pre`, `_hook_compact_post`, their lock helper (`_hook_lock_acquire`)
  and the PreCompact arm's order; name them in the departures note. Confirm the agent's read whitelist covers
  `$REG/<id>.compactevents` (the `.cc-sessions/` root).
- [ ] **Step 2: Failing tests** (fixture HOME):
  - a PreCompact `auto` event appends one `pre` line to `compactevents`; so does one with `COMPACT_CARD_OFF` present,
    and one whose scope resolution fails (the early returns do not skip it);
  - a PostCompact appends its sixteen-key record to `compactions` exactly as today, and `compactions` never holds a
    `phase` key; `ccd/history/sweep.mjs`'s suite stays green, unedited;
  - the 65th line drops the oldest, so the file holds 64;
  - a lock miss writes nothing and exits 0 (the counter then reads one fewer: a missed record is a hook that could not
    lock, not a refusal, and the reader cannot see it; the departures note says so);
  - `_reg_purge` removes `$REG/<id>.compactevents` with the row, and `_ws_slug_residue` lists it while it stands.
- [ ] **Step 3: Run.** Expected: red. **Step 4: Implement.** **Step 5: Run** the new suite, the hook's compaction
  suites, the purge suite and the history sweep's suite. Expected: green.
- [ ] **Step 6: Mutation.** Call `_hook_compact_event` inside `_hook_compact_pre` instead of on its own line: the
  `COMPACT_CARD_OFF` case goes red. Write the line to `compactions`: the "never a `phase` key" case goes red. Revert
  each.
- [ ] **Step 7: Commit.** `feat(hook): PreCompact records a pre event in its own file, so an automatic compaction is counted (W0-05)`

### Task 4: The server reads the journal and counts compactions

**Files:**
- Create: `server/src/continuity/compactions.ts` (L3 `readCompactionsMeasured(io, registryDir, id)`, which reads
  both `$REG/<id>.compactions` and `$REG/<id>.compactevents`, and L1 `compactionsSince(lines, sinceMs)`, in two
  exported functions; the L1 function imports nothing that does I/O)
- Assumes: the C3 row's `continuity/**` (card PR A owns it; if this piece merges first, it adds the same
  byte-identical edit to `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`)
- Test: `server/test/continuity-compactions.test.ts` (new)

**Interfaces:**

```ts
/** `post` lines come from the journal's sixteen-key records (`scope` kept); `pre` lines from the events file, whose
 *  `scope` is `main` when the line's transcript is the session's main transcript and `subagent` otherwise. */
export interface CompactionLine {
  readonly at: number; readonly trigger: 'auto' | 'manual' | 'other'; readonly phase: 'pre' | 'post';
  readonly scope: 'main' | 'subagent' | 'ambiguous';
}
/** Each file is read on its own, so one absent or unreadable file is never folded into the other's answer. */
export type FileRead =
  | { readonly kind: 'lines'; readonly lines: readonly CompactionLine[]; readonly skipped: number }  // skipped: malformed lines
  | { readonly kind: 'absent' } | { readonly kind: 'unreadable' };
export interface CompactionsRead { readonly journal: FileRead; readonly events: FileRead }
export async function readCompactionsMeasured(io: FleetIO, registryDir: string, id: string, mainTranscript: string | null): Promise<CompactionsRead>;
/** Counts `scope: main` only. One compaction per `pre`; a `post` with the same trigger within COMPACTION_PAIR_MS
 *  after a `pre` is the same one; a `post` with no such `pre` is one more. Lines before `sinceMs` are not counted. */
export function compactionsSince(lines: readonly CompactionLine[], sinceMs: number): number;
export const COMPACTION_PAIR_MS = 600_000;
```

- [ ] **Step 1: Failing tests.** The reader, per file: absent `absent`; an EACCES `unreadable`; a malformed line
  counted in `skipped`, never thrown; one file absent and the other read answers each as it is. The caller (the
  generations lane) treats the count as unmeasured when either file is `unreadable`, and an absent file as no lines.
  The counter, over every sequence of up to four lines from {pre auto, post auto, post manual} at two times: a pre and
  its post count one; a pre alone counts one; a post alone counts one; two pres count two; a post eleven minutes after
  a pre counts two; lines before `sinceMs` count none; a `subagent` or `ambiguous` line counts none. A refused
  PreCompact writes no `pre` (Task 3's order; the compaction piece's `refused` line is never counted), so the
  pre+refused case reads: a `refused` alone counts zero; `refused`, then `pre`, then `post` counts one. Monotonic:
  appending a line never lowers the count.
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
- **compaction-events-file** — the pre and refused records live in their own bounded, dot-free file
  `$REG/<id>.compactevents` (64 lines), written under `.<id>.compactions.lock` outside `_hook_compact_pre`'s early
  returns and after the refusal decision, and purged with the row; the PostCompact journal takes no new line shape
  (ask 367).
- **context-tokens-are-total-input** — the context's size is `total_input_tokens` (input plus cache read plus cache
  creation), the figure the statusline itself renders.

## Where things stand

**Needs before it starts:** nothing beyond `main`.

**What depends on it:** the renewal-deciders piece (the hard cap, the idle floor, the wave boundary, the resumed long
conversation, two compactions) and the probes piece (a spot probe each 50k tokens).

**Open questions for the operator:** none.
