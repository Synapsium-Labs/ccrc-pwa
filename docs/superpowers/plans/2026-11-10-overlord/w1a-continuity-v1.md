# Overlord W1a: the capability word `continuity-v1` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the server advertises `continuity-v1` once every W1a machine piece has merged, and the hook reads it: on a
node whose server does not advertise it (an older server, or a rollback), the hook sends no start report, fetches no
anchor and keeps no spool, which is today's path.

**Why:** each wave has one capability word, and "the word is missing: today's path" (Table 11.1d). W1's designate and
rebind doors refuse `capability-missing` without the wave's words. The hook's start report and anchor fetch are the
fleet-box half of W1a; a server rolled back below them must not leave the hook spooling reports nobody reads.

**Architecture:** one row of `shared/api.ts#SERVER_CAP_MAP`; the update sync already writes the server capability file
on each node (`~/.ccrc/server-caps`), and the hook already reads it through `_hook_server_cap`. One pull request, the
last of W1a.

**Tech Stack:** TypeScript (ESM), bash (`ccd/session-hook.sh`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` Table 11.1d (capability words, one per wave:
`continuity-v1` (W1a); "The word is missing: today's path. A door of a later wave refuses `capability-missing` and names
its word"), §11.5 (an older server reads the newer database), §14 (Table 14, W1a row).

## What exists today

- `shared/api.ts#SERVER_CAP_MAP` / `SERVER_CAPS` / `ServerCap` (`dispatch-live-gate-v1`, `hook-main-state-v1`,
  `ask-pairing-v1`, `questions-v1`, `review-rounds-v1`, `goals-read-v1`, `calls-v1`, `plan-v1`).
- `server/src/update/serverCaps.ts` renders the file (`SERVER_CAPS_FILE`, mode 0600) on the `serverCaps` lane; on a
  fleet node `ccd-update-sync` writes `~/.ccrc/server-caps` every minute.
- `ccd/session-hook.sh#_hook_server_cap <word>` answers 0 when the word is advertised and current (a 180 s lease), 1
  otherwise.
- Before this piece, three network calls run with no server-word gate: `_hook_start_report` (the report and its
  folded resend, with its spool `$REG/<id>.startpending`, whose first line carries the back-off stamp and the drop
  count), the anchor's start fetch (`_hook_anchor_card`) and the anchor's prompt fetch after an automatic compaction
  (the `anchor-owed` path on UserPromptSubmit). The anchor is dark on the server until the operator arms the
  `anchor-slot` row, so before this piece the fetches answer `dark` and the role card prints; against a server rolled
  back past W1a they fail, bounded, and the role card prints.

## Global Constraints

- **Architecture (`CLAUDE.md`).** One list of server words, derived from its map; the hook's gate is the existing reader,
  not a second one. Absence permits today's path. A guard ships with a test that goes red without it.
- **Land last.** This pull request merges after every other W1a machine piece; its description lists them with their
  merge commits, measured on `origin/main` at the time.
- **SAFETY (`CLAUDE.md`).** No ccd verb. Hook tests use fixture HOMEs.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. **Growth check:** `ccd/session-hook.sh` grows at most 40 net lines.
- No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-continuity-v1/departures.md`.

## Review Focus

1. With the word absent or stale, a start prints exactly what it printed before W1a (the role card, no anchor) and
   writes no spool.
2. A spool left from before a rollback is not resent while the word is absent. It is never dropped while the gate
   skips the function: it waits for the word to return, when the next pass drains it, or for `_reg_purge` to remove it
   with its row (m9).
3. With the word absent, a standing `anchor-owed` mark makes no prompt fetch and is kept (ruling R10).

---

### Task 1: The word

**Files:**
- Modify: `shared/api.ts` (`SERVER_CAP_MAP` gains `'continuity-v1'` with its comment: "W1a: generations, the start
  report, the card, anchor, note and probe doors")
- Test: the suites that pin `SERVER_CAPS` (measure: `grep -rln 'SERVER_CAPS\b' server/test`)

- [ ] **Step 1: Failing test:** the pinned list gains the word. **Step 2: Run.** Red. **Step 3: Implement.**
  **Step 4: Run** the suites and both `tsc` runs and pwa's `tsc`. Green.
- [ ] **Step 5: Commit.** `feat(caps): the server advertises continuity-v1`

### Task 2: The hook follows the word

**Files:**
- Modify: `ccd/session-hook.sh` (`_hook_start_report` (the report and its folded resend, as #2740 builds it),
  `_hook_anchor_card` and the anchor's prompt fetch run only when `_hook_server_cap continuity-v1` answers 0; the
  `anchor-owed` mark is still written at PreCompact, a local file, and kept until the word returns or the row is purged)
- Test: `server/test/session-hook-start-report.test.ts`, `server/test/session-hook-anchor.test.ts`

- [ ] **Step 1: Failing tests:** with no `server-caps` file, a stale one, or one without the word: no report, no spool,
  no anchor, the role card as before; a standing spool is neither sent nor changed; a UserPromptSubmit with
  `anchor-owed` standing makes no fetch and keeps the mark; with the word: as the start-report and anchor pieces
  specify.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** both suites and the SessionStart suites. Green.
- [ ] **Step 5: Mutation.** Skip the gate on the resend: the stale-file case resends; red. Skip the gate on the prompt
  fetch: the `anchor-owed` case fetches; red. Revert each.
- [ ] **Step 6: Commit.** `feat(hook): the start report and the anchor follow the server's continuity-v1`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **hook-follows-continuity-v1** — the word also gates the hook's own W1a arms, not only W1's doors, so a rollback
  returns the fleet box to today's path within the word's 180 s lease.
- **gate-the-anchors-prompt-fetch** — the gate covers the anchor's prompt fetch too, and the start report as #2740
  folds it (one function); a spool or mark left by a rollback is kept, never dropped by the gate (ruling R10, m9).

## Where things stand

**Needs before it starts:** every other W1a machine piece merged (clause 21's piece included, which waits for the
replay baseline).

**What depends on it:** W1's designate and rebind doors (`capability-missing` names `continuity-v1`), and any later
reader that must know the continuity machine is present.

**Open questions for the operator:** none.
