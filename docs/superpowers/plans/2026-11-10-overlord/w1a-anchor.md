# Overlord W1a: the anchor, the hook's first slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** at every start of a session that is not a child (`startup`, `resume`, `clear`, `compact`), the hook's first
emitter slot carries a short anchor from the server: the role line, the canaries (term, generation, card hash), the
counts, and "read your card". A `fork` gets a one-line refusal. After an automatic compaction that brings no
SessionStart, the next prompt carries a short anchor once. The slot ships dark: the door serves no anchor until the
operator arms the Shadow lanes row `anchor-slot`, which the replay-quiz piece's guard refuses to arm before the replay
baseline is taken (ruling 1 of this programme's fix round).

**Why:** a 15k-token card is about six times the hook's cap, so the card arrives in two parts: an anchor the hook
injects and the card the session reads itself (C38). W0a measured that one hook command's text arrives whole up to
10,000 characters, so a 1,500-character slot stands (W0-01), and that each start's context reaches the next request for
`startup`, `compact` and `fork` (W0-02). W0b measured that a start's context reaches a real model on two lanes
(W0-22). Under the rig, an automatic compaction fired PreCompact `auto` and no SessionStart `compact` (W0-05,
Proposal 2), so the anchor must not wait on that start.

**Architecture:** the anchor is rendered by an L1 function from the card's facts, and served by the card door with
`part=anchor`; the hook fetches it with a short timeout and prints it in a new first slot with its own ceiling. When the
fetch fails, or the door answers that the slot is dark, today's role card prints, so a failure or a dark slot costs
nothing that works today. The switch is a row of the Shadow lanes card (`shared/lane-arm.ts`, D-8274), `anchor-slot`,
seeded `shadow`: in `shadow` the door renders the anchor and records its size but answers `{ dark: true }` with no
text; only `live` serves it. The spec asks for the replay baseline "before any other part of W1a is armed" (W0-28);
the anchor changes what a coordinator sees at every start, so it is such a part. One pull request.

**Tech Stack:** bash (`ccd/session-hook.sh`), TypeScript (ESM), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.3 (C38: the anchor, `ANCHOR_CARD_MAX_CHARS` =
1,500, printed before the standing clip; its content and order; served on `startup`, `resume`, `clear`, `compact`;
`fork` a refusal line; the role subject not served to a long-lived role; the pinned sum 9,951 and the 49 characters
left), §3.3.5 (C40: the canaries; rules version), §3.3.4 (the anchor on the `compact` start sends the session back to
its card); the results note `docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md` (W0-01 to W0-05,
Proposal 2).

## What exists today

- `ccd/session-hook.sh#_hook_emit_context` emits one `additionalContext`. Slots in order: the standing card, clipped at
  `CARD_MAX_CHARS=2400` (the graph, hold, role and ccrc cards); the compact card, `COMPACT_CARD_MAX_CHARS=4000`
  (anchor `emit-context-compact-ceiling`), with `CARD_TOTAL_MAX_CHARS` the clip of the two joined; the roster card,
  `ROSTER_CARD_MAX_CHARS=2048`, after them. Worst case today: 2,400 + 1 + 4,000 + 1 + 2,048 = 8,450.
- `server/test/session-hook.test.ts` greps those constants and asserts `2400 + 1 + 4000 + 1 + ROSTER < 10000`; its "the
  two clip ceilings stay under the harness context-spill budget" asserts `cardMax + compactMax <
  HARNESS_CONTEXT_SPILL_CHARS` (10,000).
- `_hook_role_card` prints nothing when `$CCRC_CARD_OFF`, `$REG/<id>.child` or `$REG/<id>.hold` exists; otherwise it
  tells the session it is the project's coordinator and to load `ccrc-coordinator` (long text on `startup`/`clear`,
  short on `resume`/`fork`/`compact`).
- `_hook_roster_card` calls `_hook_timeout 4 ccrc-api runs list`.
- The card door and `renderCard` (the card piece); the generations rows (the generations piece).
- PreCompact records a `pre` event in `$REG/<id>.compactevents`, after the refusal decision, through
  `_hook_compact_event` (the context-readings piece); a refused PreCompact records `refused` instead (the compaction
  piece).
- `shared/lane-arm.ts#LANE_ARM_LANES` and its door `POST /api/coord/lane-arm` (D-8274), decided in L1 by
  `server/src/coord/laneArm.ts#decideLaneArmPost`; `pwa/src/fleet/ShadowLanesSection.tsx` is a
  `Record<LaneArmLane, …>`.

## Global Constraints

- **Architecture (`CLAUDE.md`).** The anchor's text is decided once, in L1 (`renderAnchor`); the hook prints what the
  door returns and decides nothing but whether the fetch answered. One renderer, two parts: the anchor reads the same
  `CardFacts` as the card. Characterization first: with the fetch failing, every slot prints exactly as today. A guard
  ships with a test that goes red without it.
- **SAFETY (`CLAUDE.md`).** No ccd verb. The hook never blocks a start past its bound. Hook tests use fixture HOMEs and a
  stub `ccrc-api`.
- **Each line is a statement of fact, not an order**, as Claude Code's documentation asks of hook context (C38); the
  one instruction is "read your card".
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. `session-hook*` suites are load-sensitive; re-run a red one alone first.
- **Growth check.** `ccd/session-hook.sh` grows at most 40 net lines.
- **Mutation floors.** `renderAnchor` joins `MUTANT_SETS` and the floors.
- **Migration slot** (the `anchor-slot` seed row) re-measured before merge; tests find it by `findIndex`.
- Cite by symbol or `@anchor`. No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-anchor/departures.md`.

## Review Focus

1. The canaries survive a cut: they come before the counts, and the ceiling cuts from the end.
2. The pinned sum is 9,951, under 10,000, and the test names the 49 characters left.
3. With the server down, or the slot dark, a start prints today's role card and nothing is lost.
4. An automatic compaction with no SessionStart `compact` still sends the session back to its card, once; a refused
   one does not.
5. Nothing reaches a session before the operator arms `anchor-slot`: the merge arms nothing.

---

### Task 1: `renderAnchor` and the door's `part=anchor`

**Files:**
- Modify: `shared/continuity-card.ts` (`ANCHOR_CARD_MAX_CHARS = 1500`, `ANCHOR_PROMPT_MAX_CHARS = 600`)
- Create: `server/src/continuity/anchor.ts` (L1: `renderAnchor(facts, gen, form): string`)
- Modify: `server/src/continuity/routes.ts` (the card door answers `part=anchor` with `{ ok, hash, text }`, no pages and
  no read record)
- Test: `server/test/continuity-anchor.test.ts` (new), `server/test/continuity-card-route.test.ts`

**Content, in order:** the role line (`role: coordinator of prog-a`, or `role: undecided (claim unmeasured)`); the
canaries, one line: `term <t> · generation <n | n+1 starting> · card <first 12 hex of the hash>` (the rules version
joins in W1 with grants); the counts, one line: runs, open items and asks, outstanding mail, notes; the instruction:
"Your card is the server's record of what stands. Read it now with `ccrc-api card`, before anything else." `form:
'start'` is capped at `ANCHOR_CARD_MAX_CHARS`, `form: 'prompt'` at `ANCHOR_PROMPT_MAX_CHARS` (canaries and the
instruction only). The generation canary reads the live generation's `n`; when the session's newest start is not yet
minted, it reads `n+1 starting`.

- [ ] **Step 1: Failing tests:** the four parts in order; a role line of 3,000 characters is cut so the canaries and the
  instruction still print (the role line is clipped first, never the canaries); `prompt` form under 600; the door's
  `part=anchor` answers the same hash as a full card render of the same facts.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** both suites. Green. Register the floor (mutants:
  clip a canary before the role line; drop the instruction; let `prompt` exceed 600; read `n` for an unminted start).
- [ ] **Step 5: Commit.** `feat(continuity): renderAnchor and the card door's anchor part (C38)`

### Task 2: The hook's first slot, behind `anchor-slot`

**Files:**
- Modify: `shared/lane-arm.ts` (`ANCHOR_SLOT_LANE` in `LANE_ARM_LANES`, card words "Anchor at every start"; one
  append-only row, see the index's "Where lanes meet")
- Modify: `server/src/coord/schema.ts` (migration: the lane-arm seed row `anchor-slot`, `shadow`)
- Modify: `pwa/src/fleet/ShadowLanesSection.tsx` (the new lane's entry; one append-only entry)
- Modify: `server/src/continuity/routes.ts` (`part=anchor` answers `{ ok: true, dark: true }` with no text unless the
  row is `live`; in `shadow` it still renders and logs the size once a pass, so the shadow week measures it)
- Modify: `ccd/session-hook.sh` (`ANCHOR_CARD_MAX_CHARS=1500`; `_hook_anchor_card` fetches with `_hook_timeout 4
  ccrc-api card --anchor`, unless `$REG/<id>.child` exists, on `startup`, `resume`, `clear` and `compact`; on `fork` it
  sets the one line "ccrc-anchor: a forked copy is not this session; it has no card."; `_hook_emit_context` prints the
  anchor slot first, clipped at its ceiling, before the standing clip; `_hook_role_card` prints nothing when the anchor
  slot holds text)
- Modify: `ccd/ccrc-api` (`card --anchor`)
- Modify: `server/test/session-hook.test.ts` (the sum: 1500 + 1 + 2400 + 1 + 4000 + 1 + 2048 = 9951, `< 10000`, and a
  case title naming "49 characters left"; the second budget test gains the anchor)
- Test: `server/test/session-hook-anchor.test.ts` (new)

- [ ] **Step 1: Characterize.** With the stub `ccrc-api` failing, record every SessionStart source's output for a
  coordinator fixture on the branch point; the new suite asserts it is unchanged after the edit.
- [ ] **Step 2: Failing tests:** the door with `anchor-slot` `shadow` answers `dark` and no text; the stub answering
  `dark`: every source prints exactly the characterized output; the seed row is `shadow` and the Shadow lanes card lists
  it; with the stub answering text, `clear` prints the anchor first and no role card; `fork`
  prints the refusal line and no anchor fetch is made; a child prints neither; a stub answering 2,000 characters is
  clipped to 1,500 with the canaries intact; the sum test reads all four constants from the source.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the new suite, `test/session-hook.test.ts` and the
  SessionStart suites. Green.
- [ ] **Step 6: Mutation.** Print the anchor after the standing card: the order case goes red. Serve the text in
  `shadow`: the dark case goes red. Revert each.
- [ ] **Step 7: Commit.** `feat(hook): the anchor is the first slot of every non-child start; the role card stands down for it`

### Task 3: An automatic compaction with no SessionStart still re-anchors

**Files:**
- Modify: `ccd/session-hook.sh` (`_hook_compact_event`, when it records `pre` for an `auto` PreCompact, also touches
  `$REG/<id>.anchor-owed`; a `refused` event touches nothing; on SessionStart `compact` remove it after printing the
  anchor; on UserPromptSubmit, if it exists, fetch `card --anchor --form prompt`, emit it as the prompt's
  `additionalContext`, and remove it; a `dark` answer removes it too)
- Test: `server/test/session-hook-anchor.test.ts`

- [ ] **Step 1: Failing tests:** PreCompact `auto` then UserPromptSubmit emits the prompt anchor once and removes the
  mark; PreCompact `auto` then SessionStart `compact` prints the start anchor and the next prompt emits nothing; a
  manual PreCompact sets no mark (a manual compaction fires SessionStart `compact`, W0-05); a refused PreCompact (the
  compaction piece's arm, or its `refused` event stubbed in if that piece has not merged) sets no mark, and the next
  prompt emits nothing; a `dark` answer removes the mark and emits nothing; a failed fetch keeps the mark for the next
  prompt, at most three tries (the count in the mark).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(hook): after an automatic compaction, the next prompt carries the anchor once (Proposal 2)`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **anchor-from-the-card-door** — the anchor is a part of the card door (`part=anchor`), rendered from the same facts,
  not a door of its own.
- **anchor-role-card-fallback** — the role subject stands down only when the anchor printed; a failed fetch prints
  today's role card, so a server outage costs nothing that works today.
- **anchor-owed-mark** — `$REG/<id>.anchor-owed`, one writer (the hook, in `_hook_compact_event`, after the refusal
  decision), carries "an automatic compaction happened" to the next prompt; dot-free, so purged with the row. Table
  3.6a lists it (this programme's spec amendment).
- **anchor-ships-dark** — the anchor slot is the Shadow lanes row `anchor-slot`, seeded `shadow`, whose door refuses
  `live` before the replay baseline is taken (the replay-quiz piece); in `shadow` the door renders and measures but
  serves nothing.
- **rules-version-in-w1** — the anchor's canaries carry term, generation and card hash; the rules version joins with W1's
  grants, the first thing that raises it.
- **prompt-delta-in-w1** — C38's delta on every prompt reads the door process's cache, which is W1's; W1a sends a prompt
  anchor only after an automatic compaction.

## Where things stand

**Needs before it starts:** the card piece, both PRs (the door, the facts, `shared/continuity-card.ts`,
`server/src/continuity/routes.ts`, `server/test/continuity-card-route.test.ts` and `ccrc-api card`, which this piece
then edits: lane C's files, edited only after lane C has merged them), the generations piece (the live `n`), the
context-readings piece (`_hook_compact_event`, which Task 3 extends).

**What depends on it:** the renewal-act piece (the `carded` state's nudge re-sends the start anchor), the compaction
piece (the anchor on the `compact` start is one of the three protections, §3.3.4).

**Open questions for the operator:** none.
