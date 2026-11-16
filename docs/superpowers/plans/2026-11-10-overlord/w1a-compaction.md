# Overlord W1a: compaction instructions by role, and the PreCompact refusal arm (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every session's compaction carries instructions written for its role: ccd's auto-compact types
`/compact <the role's text>`, and history W3's one PreCompact print carries the same text as a section where W3 is
armed. A long-lived session's proactive automatic compaction can be refused once a turn and turned into a soft renewal,
an arm that ships dark until the generations lane writes its route field (the renewal hand-offs piece).

**Why:** auto-compact types a bare `/compact` today (Table 3.3.9b), so a summary keeps whatever the model picks.
Summaries of summaries lose ids and paths, and errors become canon (§3.3). The instructions keep what each role needs
(C51), and renewal comes before compaction for a long-lived role (C39). W0a measured that a PreCompact refusal of
`trigger: auto` is honoured once a turn and the turn runs on uncompacted (W0-13, W0-14). History W3-1 (#2510) shipped
the PreCompact print this piece adds a section to; the spec orders this piece after it (C53), and it has merged.

**Architecture:** the text is a column of `FLEET_ROLES` (L0), read through `compactInstructionsFor(role)` (L1). It
reaches ccd as a field of the launch-profile projection (`ccd/lib/launch-profiles.json`), looked up under the route's
`profile` field, so ccd and the hook read one copy. Both carriers use it only when the route also carries
`compactwindow`, the field the launch-profile lane writes only while `continuity` is live (that piece's
`compaction-follows-continuity`), so arming `launch-profile` alone changes no `/compact` text (ruling R8). Two
carriers, one source: ccd's auto-compact and the hook's PreCompact print. The refusal arm is a verdict function of its
own, `_hook_compact_refuse`, called from the PreCompact arm ahead of `_hook_history_pre`, so no history switch turns it
off (ruling R7b); it reads a route field the generations lane writes (through the renewal hand-offs piece, Task 6) and
refuses a main-scope compaction only. Its refusals are recorded in the hook's compaction events file (the
context-readings piece), never in the PostCompact journal, and `renewalDue` reads them from there. One pull request.

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
  asks for a `<ccrc-leaf v="1">` block, below the anchor `compact-arm-emit-call` (that anchor is the SessionStart emit),
  armed per session by the file
  `~/.ccrc/history/steer-on/<id>`, which nothing in the tree writes. Its text comes from
  `ccd/history/lib.mjs#composeSteerFile` or `HISTORY_STEER_GENERIC`. It has no role section. Its plan is
  `docs/superpowers/plans/2026-10-29-ccrc-history-w3-steering.md`; W3-2 (the breaker) and W3-3 (arming) are pending.
- `shared/fleetRoles.ts#FLEET_ROLES` has `compactInstructions: null` (D-8209). The launch-profiles piece adds
  `ccd/lib/launch-profiles.json` and the route field `profile`.
- The compaction events file `$REG/<id>.compactevents` (32 lines, then rotated to `$REG/<id>.compacteventsprev`) and
  its `pre` line, which carries the hook's scope verdict, written by `_hook_compact_pre_line` after
  `_hook_history_pre` (the context-readings piece, which follows #2739's code); the PostCompact journal
  `$REG/<id>.compactions`, which takes no new line shape (ask 367); `renewalDue`'s `two-compactions` and
  `compaction-refused` rows (the renewal-deciders piece).

## Global Constraints

- **Architecture (`CLAUDE.md`).** One source, two carriers: the text lives in `FLEET_ROLES`, the projection carries it
  to ccd and the hook, and a test holds the projection equal (the launch-profiles piece's test, extended). No second
  PreCompact print: the role section is inside `_hook_history_pre`'s one print path (C53). The refusal is a block
  decision, not a print: `_hook_compact_refuse` decides it ahead of `_hook_history_pre`, which then prints nothing for
  that event, so one event still has one stdout payload. ccd decides nothing about roles: it types the text the
  route's profile names, and only when the route carries `compactwindow`. A guard ships with a test that goes red without it.
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
  simulator) join `MUTANT_SETS` and the floors, with named mutants (ruling R11): for `compactInstructionsFor`, every
  role answers `plain`'s text, and `coordinator` and `worker` swap texts; for `precompactDecision`, `manual` is
  refused, `refusedThisTurn` is ignored, an absent field refuses, and a `subagent` or `ambiguous` scope refuses.
- Cite by symbol or `@anchor`. No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-compaction/departures.md`.

## Review Focus

1. One text per role, two carriers, byte-identical: the projection test and a hook test that compares the printed
   section with the typed text.
2. A session whose route names no profile, or a profile without `compactwindow` (`continuity` not live), compacts
   exactly as today (bare `/compact`; the print unchanged).
3. The refusal arm is dark: with the route field absent, nothing is refused. Armed, it refuses only `trigger: auto`
   in main scope, once per turn (the turn key is defined in Task 4), and journals each refusal. No history switch
   turns it off.
4. Nothing types a multi-line or quote-bearing text into a pane: the text is one line, checked by the test.

---

### Task 1: The text, a column of the role table

**Files:**
- Modify: `shared/fleetRoles.ts` (`compactInstructions: string` on every row; `auditor` and `replay` reuse `plain`'s
  constant)
- Create: `server/src/continuity/compaction.ts` (L1: `compactInstructionsFor(role: FleetRole): string`)
- Modify: `server/test/fleet-roles.test.ts`
- Assumes: card PR A's commit that lays `FLEET_ROLES` out one column per line and splits
  `server/test/fleet-roles.test.ts`'s null-columns case one column per line, and its C3 row `continuity/**`; this
  piece edits only its own column's lines in both files
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
- Modify: `ccd/ccd` (`_auto_compact_check`: when the route carries `compactwindow`, read `compactText` for the
  route's `profile` from the projection and type `/compact <text>` when present; bare `/compact` otherwise, a route
  with `profile` but no `compactwindow` included; an unreadable file types bare `/compact` and warns)
- Test: `server/test/ccd-auto-compact.test.ts`

- [ ] **Step 1: Characterize.** `test/ccd-auto-compact.test.ts` green on the branch point; a recorded send for a route
  with no `profile` is the bare `/compact`.
- [ ] **Step 2: Failing tests:** `profile=coordinator` with `compactwindow=350000` sends `/compact Compaction
  instructions (coordinator): …` as one literal send, then Enter; `profile=coordinator` with no `compactwindow` (the
  `launch-profile` row live, `continuity` shadow) sends bare `/compact`; no profile sends bare `/compact`; a missing
  projection sends bare `/compact` and warns.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the auto-compact and launch-profile suites. Green.
- [ ] **Step 6: Mutation.** Send the text without `-l`: the literal-send assertion goes red. Key the text on `profile`
  alone: the "no `compactwindow`" case goes red. Revert each.
- [ ] **Step 7: Commit.** `feat(ccd): auto-compact types the role's compaction instructions (C51)`

### Task 3: The same text rides inside history's PreCompact print

**Files:**
- Modify: `ccd/session-hook.sh` (`_hook_history_pre`: when the print fires and the route names a profile and carries
  `compactwindow`, append one section, a blank line then `ccrc-role-compaction: <compactText>`, inside the same print)
- Test: the history W3 print suite (measure: `grep -ln '_hook_history_pre\|compact-arm-emit-call' server/test`)

- [ ] **Step 1: Peer protocol** (Global Constraints): mail and claim; wait for the answer only if the claim is refused.
- [ ] **Step 2: Failing tests:** with `steer-on` present in the fixture and `profile=coordinator`, the print ends with the
  section whose text equals what Task 2 types (with `compactwindow` set); with `profile=coordinator` and no
  `compactwindow`, and with no profile, the print is byte-identical to today's; with `steer-on` absent, nothing prints
  (as today). Mutation: key the section on `profile` alone: the no-`compactwindow` case goes red; revert.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the print suite and `test/session-hook*.test.ts`
  that touch PreCompact. Green.
- [ ] **Step 6: Commit.** `feat(hook): the role's compaction instructions ride inside history's one PreCompact print (C53)`

### Task 4: The refusal arm, dark

**Files:**
- Modify: `ccd/ccd` (`ROUTE_FIELDS` gains `precompact`, values `refuse|allow`; the generations lane, through the
  renewal hand-offs piece's Task 6, is its one writer. `_route_any` skips it as it skips `browser` (D-8121): it
  decides nothing about model, effort or placement, so a row that names only `precompact` still gets
  `_route_seed_default` and composes no route flags, as today; slug `route-fields-outside-route-any`)
- Modify, the route vocabulary, so the server can write and read the field back (each a one-line, append-only row):
  `shared/api.ts` (`ROUTE_WRITABLE_FIELDS` and `parseRouteFields`'s accepted fields, in the route region),
  `server/src/ccdargv.ts` (`routeSet`'s filter follows the list), `server/src/registry.ts` (its route read follows the
  list), the PWA's route display if it enumerates fields (measure: `grep -rn 'ROUTE_WRITABLE_FIELDS' pwa/src`)
- Modify: `ccd/session-hook.sh` (a new verdict function `_hook_compact_refuse`, called from the PreCompact arm after
  `_hook_compact_pre` and ahead of `_hook_history_pre`, so `history-off`, `history-steer-off`, recall off, a bad
  `psid` and a missing `steer-on`, which all return `_hook_history_pre` early, never turn the arm off (ruling R7b).
  It refuses when `trigger` is `auto`, the hook's scope verdict is `main` (`CS_SCOPE`, asking `_hook_compact_scope`
  itself when `_hook_compact_pre` returned before computing it; `subagent` and `ambiguous` are never refused, ruling
  R7a), the route's `precompact` is `refuse`, and no refusal was recorded for this turn. Refusing, it prints
  PreCompact's block decision and sets `CS_REFUSED=1`; `_hook_history_pre` then prints nothing for this event, and
  `_hook_compact_pre_line` (the context-readings piece's writer, extended here) writes `"phase":"refused"` in place of
  `"pre"`. **The turn key** (ruling R11): a turn runs from one main-thread UserPromptSubmit to the next. The arm takes
  the turn's start from the turn marker `$REG/<id>.turn.json`, whose `at` every UserPromptSubmit rewrites (D-3675).
  Step 1 measures whether a later event of the same turn rewrites `at`; if one does, the UserPromptSubmit arm also
  writes the start as `turnAt` in the marker's line (one more key, additive, read by nothing else), and the arm reads
  that. A `refused` line in either events file whose `at` is at or after the turn's start is this turn's. A marker
  that cannot be read answers "refused already", so the arm lets the compaction through rather than refuse twice)
- Modify: `server/src/continuity/compactions.ts` (`CompactionLine.phase` gains `refused`; `compactionsSince` does not
  count it, and a `refused` line never cancels a `pre`; `refusedSince(lines, sinceMs): boolean`, main scope only, for
  `renewalDue`'s `compactionRefused` input)
- Create: `server/src/continuity/precompact.ts` (L1 `precompactDecision(trigger, scope, field, refusedThisTurn)`, the
  twin the simulator and a parity test use)
- Test: `server/test/session-hook-precompact-refuse.test.ts` (new), `server/test/continuity-compactions.test.ts`,
  `server/test/ccd-route-fields.test.ts` (its pin of `ROUTE_FIELDS` gains one field, `precompact`, last: one more than
  the pin holds at this piece's merge, twelve after launch profiles A),
  `server/test/single-definition/update-stall.test.ts` (it guards the list; measure whether it needs a row)

- [ ] **Step 1: Measure** the turn marker (which events of one turn rewrite its `at`) and name the answer in the
  departures note. **Failing tests:** field absent: no refusal (dark); `refuse` + `auto` + main scope: blocked once,
  one `refused` line in `compactevents` and no `pre` line for that event, history's print absent for it; the
  PostCompact journal untouched; the same turn's second PreCompact passes and records `pre`; the next turn's first is
  refused again; an unreadable turn marker passes; `manual` is never refused; a `subagent` or `ambiguous` scope is
  never refused and records `pre`; `allow` passes; with `history-off`, with `steer-on` absent and with a bad `psid`,
  the refusal still fires; `compactionsSince` counts no `refused` line, a `refused` line never cancels a `pre` (a
  `pre`, then a `refused` within ten minutes, counts one; a `refused` alone counts zero; `refused`, `pre`, `post`
  counts one: the cases moved here from the context-readings piece, whose line type has no `refused`);
  `refusedSince` sees a main-scope refusal only; a row with only `precompact` set still gets `_route_seed_default`;
  the route vocabulary: `routeSet(id, {precompact: 'refuse'})` builds its argv, the registry reads the field back, and
  an unknown value is refused; the bash arm and `precompactDecision` agree on every input (a parity table run through
  both).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** Measure the PreCompact block decision's exact JSON from the W0a
  scenario (`server/test/delegation-rig/scenarios-overlord/`) and cite it. **Step 4: Run.** Green. Register the floor.
- [ ] **Step 5: Mutation.** Refuse `manual` too: red. Refuse a `subagent` scope: red. Ignore the turn key: the
  second-PreCompact case goes red. Call the verdict from inside `_hook_history_pre`: the `history-off` case goes red.
  Let a `refused` line cancel the latest `pre`: the pre-then-refused case goes red. Count `precompact` in
  `_route_any`: the seed case goes red. Revert each.
- [ ] **Step 6: Commit.** `feat(hook): the PreCompact refusal arm, dark until the route says refuse (C39, W0-13)`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **compaction-text-rides-the-profile-projection** — ccd and the hook read the role's text from
  `ccd/lib/launch-profiles.json`, looked up under the route's `profile`, one copy held equal to `FLEET_ROLES` by a test.
- **compaction-text-follows-continuity** — both carriers use the role's text only when the route carries
  `compactwindow`, which the launch-profile lane writes only while `continuity` is live, so arming `launch-profile`
  changes no `/compact` text and the three places that say that arm moves no compaction stay true (the coordinator's
  ruling on R8).
- **refusal-its-own-verdict** — the refusal is `_hook_compact_refuse`, called from the PreCompact arm ahead of
  `_hook_history_pre`, so history's switches never turn it off (ruling R7b).
- **refusal-main-scope-only** — only a `main`-scope automatic compaction is refused; `subagent` and `ambiguous` pass
  and record `pre` (ruling R7a).
- **turn-is-the-turn-marker** — "this turn" starts at the main thread's last UserPromptSubmit, read from the turn
  marker; an unreadable marker lets the compaction through (ruling R11).
- **route-fields-outside-route-any** — `precompact` is skipped by `_route_any`, as `browser` is (m-B9).
- **refusal-reads-a-route-field** — the arm reads the route field `precompact`; absent is dark. Its writer is the
  generations lane (the renewal hand-offs piece's Task 6), which knows the soft budget.
- **refusal-journalled-as-a-phase** — a refusal is a `refused` line in the compaction events file, written by
  `_hook_compact_pre_line` in place of the event's `pre` line, never cancelling another line, and read by the server as `renewalDue`'s `compactionRefused` input; the PostCompact
  journal takes no new line shape (ask 367); no new door.
- **instructions-one-line** — each text is one line of at most 600 characters with no quotes, so it can be typed as one
  literal send.

## Where things stand

**Needs before it starts:** the launch-profiles piece (PR A: the projection and the `profile` route field), the
context-readings piece (the events file, its writer `_hook_compact_pre_line` and the reader), history W3-1 (merged,
#2510).

**What depends on it:** the renewal hand-offs piece (its Task 6 has the generations lane write `precompact`); history W3-3's arming (the operator's), which
turns the second carrier on per backend.

**Open questions for the operator:** none in this piece; arming history's steer stays the operator's, per backend.
