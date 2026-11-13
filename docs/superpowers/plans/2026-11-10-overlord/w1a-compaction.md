# Overlord W1a: compaction instructions by role, and the PreCompact refusal arm (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every session's compaction carries instructions written for its role: ccd's auto-compact types
`/compact <the role's text>`, and history W3's one PreCompact print carries the same text as a section where W3 is
armed. A long-lived session's proactive automatic compaction can be refused once a turn and turned into a soft renewal,
an arm that ships dark until the renewal-act piece arms it.

**Why:** auto-compact types a bare `/compact` today (Table 3.3.9b), so a summary keeps whatever the model picks.
Summaries of summaries lose ids and paths, and errors become canon (§3.3). The instructions keep what each role needs
(C51), and renewal comes before compaction for a long-lived role (C39). W0a measured that a PreCompact refusal of
`trigger: auto` is honoured once a turn and the turn runs on uncompacted (W0-13, W0-14). History W3-1 (#2510) shipped
the PreCompact print this piece adds a section to; the spec orders this piece after it (C53), and it has merged.

**Architecture:** the text is a column of `FLEET_ROLES` (L0), read through `compactInstructionsFor(role)` (L1). It
reaches ccd as a field of the launch-profile projection (`ccd/lib/launch-profiles.json`), keyed by the route's
`profile` field, so ccd and the hook read one copy. Two carriers, one source: ccd's auto-compact and the hook's
PreCompact print. The refusal arm is a decision inside that same print, reading a route field the renewal-act piece
writes; its refusals are journalled in the compactions journal, where `renewalDue` reads them. One pull request.

**Tech Stack:** TypeScript (ESM), bash (`ccd/ccd`, `ccd/session-hook.sh`), `jq`, vitest with `makeCcdHarness`.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.4 (C39: renewal before compaction; a proactive
compaction becomes a renewal, inside history W3's one print; the soft budget spent lets it through, counted; two
compactions make a renewal due), §3.3.9 (C51: instructions by role, `compactInstructionsFor`, `auditor` and `replay`
take `plain`'s text, what a coordinator's and a worker's keep, tool output dropped, the operator's own standing
instructions followed), §3.3.10 (C53: one PreCompact print, owned by history; the role instructions ride inside it as a
section the role table supplies; while W3 is not armed for a session's backend, only the typed `/compact` carries
them; this part waits for history W3-1), §14 (Figure 8).

## What exists today

- `ccd/ccd#_auto_compact_check` types a bare `/compact` (`_tmx send-keys -t "$t" -l "/compact"`, then Enter), at the
  route's `compact` threshold (`COMPACT_THRESHOLD=50` by default), behind `_pane_type_ready` and the kill switch
  `~/.cc-sessions/autocompact-disabled`.
- `ccd/session-hook.sh#_hook_history_pre` (history W3-1) prints `HS_TEXT`, the "ccrc history archive entry" steer that
  asks for a `<ccrc-leaf v="1">` block, at the anchor `compact-arm-emit-call`, armed per session by the file
  `~/.ccrc/history/steer-on/<id>`, which nothing in the tree writes. Its text comes from
  `ccd/history/lib.mjs#composeSteerFile` or `HISTORY_STEER_GENERIC`. It has no role section. Its plan is
  `docs/superpowers/plans/2026-10-29-ccrc-history-w3-steering.md`; W3-2 (the breaker) and W3-3 (arming) are pending.
- `shared/fleetRoles.ts#FLEET_ROLES` has `compactInstructions: null` (D-8209). The launch-profiles piece adds
  `ccd/lib/launch-profiles.json` and the route field `profile`.
- The compactions journal and its `pre` line (the context-readings piece); `renewalDue`'s `two-compactions` and
  `compaction-refused` rows (the renewal-deciders piece).

## Global Constraints

- **Architecture (`CLAUDE.md`).** One source, two carriers: the text lives in `FLEET_ROLES`, the projection carries it
  to ccd and the hook, and a test holds the projection equal (the launch-profiles piece's test, extended). No second
  PreCompact writer: the role section and the refusal are inside `_hook_history_pre`'s one print path (C53). ccd decides
  nothing about roles: it types the text the route's profile names. A guard ships with a test that goes red without it.
- **Peer protocol first.** Before Task 3 edits `_hook_history_pre`, mail the history programme's coordinator (find it
  with `ccrc-api peers list`), say what the section and the arm add and where, and claim `ccd/session-hook.sh` and
  `ccd/history/lib.mjs` by `ccrc-api claims take`; a 409 names the holder, who is the address (§3.3.9: "each fix extends
  its owner").
- **SAFETY (`CLAUDE.md`).** No ccd verb. ccd tests use fixture HOMEs. The text is typed only by ccd's existing typer,
  behind `_pane_type_ready`. Nothing writes `steer-on` or any other history marker (the operator's).
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. `session-hook*` and `ccd-*` suites are load-sensitive; re-run a red one alone first.
- **Growth check.** `ccd/ccd` and `ccd/session-hook.sh` each grow at most 40 net lines.
- **Mutation floors.** `compactInstructionsFor` and `precompactDecision` (L1, Task 4's TypeScript twin used by the
  simulator) join `MUTANT_SETS` and the floors.
- Cite by symbol or `@anchor`. No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-compaction/departures.md`.

## Review Focus

1. One text per role, two carriers, byte-identical: the projection test and a hook test that compares the printed
   section with the typed text.
2. A session whose route names no profile compacts exactly as today (bare `/compact`; the print unchanged).
3. The refusal arm is dark: with the route field absent, nothing is refused. Armed, it refuses only `trigger: auto`,
   once per turn, and journals each refusal.
4. Nothing types a multi-line or quote-bearing text into a pane: the text is one line, checked by the test.

---

### Task 1: The text, a column of the role table

**Files:**
- Modify: `shared/fleetRoles.ts` (`compactInstructions: string` on every row; `auditor` and `replay` reuse `plain`'s
  constant)
- Create: `server/src/continuity/compaction.ts` (L1: `compactInstructionsFor(role: FleetRole): string`)
- Modify: `server/test/fleet-roles.test.ts`
- Test: `server/test/continuity-compaction.test.ts` (new)

**The texts** (one line each, at most 600 characters, no quote characters, ending with the history instruction):
- `coordinator`: "Compaction instructions (coordinator): keep, verbatim, every run id and its wave, each plan path and the step it is
  at, every claim id and path, every operator or Overlord ruling with its date, every open ask and item id, and every
  mail you have not answered. Drop tool output. End the summary with the history node of this conversation and the
  line: check what you recall against ccrc history or the server before you act on it."
- `worker` / `reviewer`: "… keep the plan path, the task and step, the failing test or command and its last output line,
  every deviation slug or number, and the branch tip sha. Drop tool output. End with the history node …"
- `plain`: "… keep every id, path and sha you were given, and every instruction the operator gave with its words. Drop
  tool output. End with the history node …"
- `overlord`: the coordinator's list plus "every request id, every operator message id you answered or owe an answer";
  its other rows are W1's.

- [ ] **Step 1: Failing tests:** every role has text; each is one line, at most 600 characters, has no `'` or `"`, and
  ends with the history instruction; `auditor` and `replay` equal `plain`; `compactInstructionsFor` is total. The role
  table suite's null assertion for `compactInstructions` is replaced.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** both suites, both `tsc` runs and pwa's `tsc`. Green.
  Register the floor.
- [ ] **Step 5: Commit.** `feat(roles): compaction instructions by role, a column of FLEET_ROLES (C51)`

### Task 2: ccd types `/compact` with the role's text

**Files:**
- Modify: `server/test/launch-profiles-file.test.ts` and `ccd/lib/launch-profiles.json` (the projection gains
  `compactText`)
- Modify: `ccd/ccd` (`_auto_compact_check`: read `compactText` for the route's `profile` from the projection; type
  `/compact <text>` when present, bare `/compact` otherwise; an unreadable file types bare `/compact` and warns)
- Test: `server/test/ccd-auto-compact.test.ts`

- [ ] **Step 1: Characterize.** `test/ccd-auto-compact.test.ts` green on the branch point; a recorded send for a route
  with no `profile` is the bare `/compact`.
- [ ] **Step 2: Failing tests:** `profile=coordinator` sends `/compact Compaction instructions (coordinator): …` as one
  literal send, then Enter; no profile sends bare `/compact`; a missing projection sends bare `/compact` and warns.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the auto-compact and launch-profile suites. Green.
- [ ] **Step 6: Mutation.** Send the text without `-l`: the literal-send assertion goes red. Revert.
- [ ] **Step 7: Commit.** `feat(ccd): auto-compact types the role's compaction instructions (C51)`

### Task 3: The same text rides inside history's PreCompact print

**Files:**
- Modify: `ccd/session-hook.sh` (`_hook_history_pre`: when the print fires and the route names a profile, append one
  section, a blank line then `ccrc-role-compaction: <compactText>`, inside the same print)
- Test: the history W3 print suite (measure: `grep -ln '_hook_history_pre\|compact-arm-emit-call' server/test`)

- [ ] **Step 1: Peer protocol** (Global Constraints): mail and claim; wait for the answer only if the claim is refused.
- [ ] **Step 2: Failing tests:** with `steer-on` present in the fixture and `profile=coordinator`, the print ends with the
  section whose text equals what Task 2 types; with no profile, the print is byte-identical to today's; with `steer-on`
  absent, nothing prints (as today).
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the print suite and `test/session-hook*.test.ts`
  that touch PreCompact. Green.
- [ ] **Step 6: Commit.** `feat(hook): the role's compaction instructions ride inside history's one PreCompact print (C53)`

### Task 4: The refusal arm, dark

**Files:**
- Modify: `ccd/ccd` (`ROUTE_FIELDS` gains `precompact`, values `refuse|allow`; the renewal-act piece is its one writer)
- Modify: `ccd/session-hook.sh` (inside `_hook_history_pre`'s path, before the print: when `trigger` is `auto` and the
  route's `precompact` is `refuse` and no refusal was journalled for this turn, answer PreCompact's block decision and
  journal `{at, trigger, transcript, phase: "refused"}` through the journal's one append; otherwise fall through to the
  print; the route field is read whether or not `steer-on` exists, since the refusal is the arm's decision, not the
  steer's)
- Modify: `server/src/continuity/compactions.ts` (`CompactionLine.phase` gains `refused`; `compactionsSince` does not count
  it; `refusedSince(lines, sinceMs): boolean` for `renewalDue`'s `compactionRefused` input)
- Create: `server/src/continuity/precompact.ts` (L1 `precompactDecision(trigger, field, refusedThisTurn)`, the twin the
  simulator and a parity test use)
- Test: `server/test/session-hook-precompact-refuse.test.ts` (new), `server/test/continuity-compactions.test.ts`

- [ ] **Step 1: Failing tests:** field absent: no refusal (dark); `refuse` + `auto`: blocked once, one `refused` line;
  the same turn's second PreCompact passes; `manual` is never refused; `allow` passes; `compactionsSince` ignores
  `refused`, `refusedSince` sees it; the bash arm and `precompactDecision` agree on every input (a parity table run
  through both).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** Measure the PreCompact block decision's exact JSON from the W0a
  scenario (`server/test/delegation-rig/scenarios-overlord/`) and cite it. **Step 4: Run.** Green. Register the floor.
- [ ] **Step 5: Mutation.** Refuse `manual` too: red. Revert.
- [ ] **Step 6: Commit.** `feat(hook): the PreCompact refusal arm, dark until the route says refuse (C39, W0-13)`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **compaction-text-rides-the-profile-projection** — ccd and the hook read the role's text from
  `ccd/lib/launch-profiles.json`, keyed by the route's `profile`, one copy held equal to `FLEET_ROLES` by a test.
- **refusal-reads-a-route-field** — the arm reads the route field `precompact`; absent is dark. Its writer is the
  renewal-act piece, which knows the soft budget.
- **refusal-journalled-as-a-phase** — a refusal is a `refused` line in the compactions journal, read by the server as
  `renewalDue`'s `compactionRefused` input; no new door.
- **instructions-one-line** — each text is one line of at most 600 characters with no quotes, so it can be typed as one
  literal send.

## Where things stand

**Needs before it starts:** the launch-profiles piece (PR A: the projection and the `profile` route field), the
context-readings piece (the journal's append and reader), history W3-1 (merged, #2510).

**What depends on it:** the renewal-act piece (it writes `precompact`); history W3-3's arming (the operator's), which
turns the second carrier on per backend.

**Open questions for the operator:** none in this piece; arming history's steer stays the operator's, per backend.
