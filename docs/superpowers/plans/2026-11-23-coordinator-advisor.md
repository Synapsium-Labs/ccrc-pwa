# Coordinator advisor: plan

Spec: `docs/superpowers/specs/2026-11-23-coordinator-advisor-design.md`. Deviations D-8967..D-8972 (issued).

## The operator's direction of 2026-11-23

Coordinators run on Opus with a Fable advisor for day-to-day work. Every account has Fable on its plan (no usage
credits), so advisor calls count against plan limits that already run near their weekly ceiling: the per-coordinator
daily cap matters. Off until the operator turns it on; a trial names its coordinators in the Settings row.

## Preconditions on the fleet

- The **Launch profiles** lane must be live (Settings › Automation › Shadow lanes). The advisor is a route field that lane
  writes; in shadow it adds none (it still clears one it wrote while live, at the cap, a drop or Off). Arming it also turns auto memory off for every role but plain sessions (its live
  note): the operator decides that before the trial, not this plan (D-8967).
- The roll's Settings row ("Roll idle sessions") not `off`, and no `.no-roll` on a trial coordinator, so a change reaches
  a running coordinator at its next idle; otherwise at its next spawn or renewal.

## Tasks

Each PR red-first with a mutation measured red; fixture HOMEs only; never against the live fleet. Suites run in the
foreground, one file at a time, from inside the package.

### PR A — ccd renders the field (ccd, L0 vocabulary)

1. **Characterization first**: a ccd argv test (`makeCcdHarness`) pinning today's full spawn line for a coordinator row
   with `profile=coordinator` and no `advisor` field, green on `main`; it must stay byte-identical after this PR.
2. `shared/api.ts#ROUTE_WRITABLE_FIELDS`: append `advisor` (after `mailhold`, so `ROUTE_LANE_ONLY_FIELDS`' slice keeps
   it lane-only); its docstring paragraph. `ccd/ccd`: `ROUTE_FIELDS` gains `advisor`; `_route_word_in "$v" "fable opus"`;
   `_route_argv_check` refuses it at the mint and from a session's own `ccd route` (the `mailhold` precedent).
3. `_advisor_spawn_compose` (its own composer, right after `_profile_spawn_compose`): when `_route_get <id> advisor` is a
   word, append `--advisor <word>`. Write `$REG/<id>.advisorspawn` = `<word> <epoch>` at every spawn (`off <epoch>` when
   none, once a record exists). A row the advisor never touched composes nothing, as today.
4. Fast-death fallback (spec §7): if the stamp names a model and its epoch is within `ADVISOR_FAST_DEATH_S=90` of now,
   omit the flag, stamp `off fastdeath <epoch>`, one `advisor-dropped <id>: …` line in `swap.log`.
5. `ccd caps` gains `route-advisor`. Tests: absent = byte-identical argv; `fable` → flag; a bad word → absent and a
   `route-reject` note; the fast-death path; the mint refusal. Mutation: delete the word check → red.

### PR B — the Settings row and the lane writes it (server, PWA)

1. `shared/coordinatorAdvisor.ts` (L0): `ADVISOR_CHOICES = ['off','opus','fable']`, `ADVISOR_CAP_DEFAULT = 12`, scope
   `{kind:'all'}|{kind:'sessions', ids}`, the view type and `COORDINATOR_ADVISOR_TEXT` (legend "Coordinator advisor").
2. `coord.db` migration: one row `advisor_settings` (`CHECK (id = 1)`; choice, cap, scope JSON, updated_at), read back
   through narrowings, no CHECK on the words. One writer `CoordStore.setCoordinatorAdvisor`, one reader
   `CoordStore.coordinatorAdvisorSettings` (a row / absent / unreadable, never one null).
3. `GET`/`POST /api/coord/coordinator-advisor` in `server/src/coord/routes.ts`, the `plain-auto-memory` shape (session-gated
   when armed, record-only feed row with the actor). Add it to `SESSION_ONLY` (`coord-pause-route.test.ts`), the census
   number word and CLAUDE.md's box-token sentence (`box-token-census.test.ts` checks both directions), `auth-gate.test.ts`,
   and a `shared/switches.ts` row `coordinator-advisor`.
4. `server/src/continuity/profileFor.ts`: `advisorFor(reading, setting, facts)` (L1, spec §4) → `fable|opus|clear|null`
   (null = leave the field alone). Facts: lane kind, route class, measured main-loop family, today's count, today's
   `dropped`. `ProfileRoute` gains `advisor`.
5. `profileLane.ts`: `advisor` joins `PROFILE_ROUTE_FIELDS`; the field enters a row's diff ONLY when `ccdCan(…, 'routeAdvisor')`
   (an older ccd refuses an unknown field for the whole call, which would cost the profile fields too). New skip counters
   for an unmeasured fact. Tests: each eligibility rule red when removed; absent setting = no `advisor` in any diff.
6. PWA: `pwa/src/fleet/CoordinatorAdvisorSection.tsx` under `AutomationSection` after Auto memory for plain sessions;
   `settingsText.ts` entry; `lib/api.ts` get/post. Choice, cap, scope (all / named sessions picked from the coordinators
   the fleet lists); shadow text while Launch profiles is not live.

### PR C — counting and the cap

1. `server/src/transcript/parse.ts#advisorFactsOf(line)`: calls (`server_tool_use` named `advisor` with id; the
   `advisor_tool_result` content type), `advisor_message` iterations (model, four token counts, message id), the
   `advisor_tool` attachment (`available`, `model`), a main-loop request (an assistant line, not sidechain, distinct
   message id), the line's timestamp; an unparseable line is a counted `unreadable`, never dropped.
2. `server/src/transcript/advisorRead.ts` (L3): forward ranged reads (`READ_FROM_MAX_BYTES`) from a kept offset of the
   file `TranscriptResolver` names; a file it has no place in (a first read, a new path after a swap, a rewrite) starts at
   its tail (`ADVISOR_TAIL_BYTES`), never at byte 0 (call ids dedupe).
3. `coord.db`: `advisor_calls` (session_id, call_id, day, at, model, tokens; PK session_id+call_id), `advisor_reads`
   (session_id, file, offset, spawn start, main-loop requests since spawn, availability word and time). One writer:
   the count lane. Prune rows older than 14 days.
4. The count lane (L4, a `LANE_SCHEDULE` row, every minute, single flight): only sessions whose route or stamp names an
   advisor. Legitimately different from the tailer and the usage sweep (D-8971).
5. `server/src/registry.ts`: the one reader of `$REG/<id>.advisor` (listed-only, measured), as `browsermcp`.
6. Roll reason `advisor-stale` in `coord/rollTarget.ts#autoRollVerdict`: the route's word ≠ the stamp's word, both
   measured (unmeasured is never behind); `rollLane.ts` passes it. Tests: stale → roll at idle; busy → skip; unmeasured
   → current.

### PR D — the readout

1. `advisorStateOf` (L1, server) → spec §6 words; `FleetSession.advisor?` (additive, through `reviveFleetSession`) with
   state, model, today's calls, cap, overrun, tokens, and which path applies a change (roll / renewal / next spawn).
2. `pwa/src/fleet/advisorWords.ts` (the one reader); a fact in `SessionDetails.tsx`; the Settings section's summary
   lists every in-scope coordinator with the same words.

### Follow-up PR (not this programme)

Coordinator guidance on when to consult the advisor, in the skill's references, not its pinned clauses (D-8972).

## Deviations found

- **D-8967 (2026-11-23)** — advisor-rides-the-launch-profile-lane. The advisor is a lane-only route field, `advisor`,
  written by the launch-profile lane from `advisorFor` (`server/src/continuity/advisorPolicy.ts`) and a Settings row in the
  `plain-auto-memory` shape, rendered by `_advisor_spawn_compose` beside `_profile_spawn_compose`. Not the Models sheet: its class registry is per account and every session of the account
  reads it, while the advisor is per role and per session with a cap and a trial scope. Consequence: the advisor applies
  only where the Launch profiles lane is live, and arming that lane turns auto memory off for non-plain roles. A clear is
  the exception: it narrows a launch, so the lane writes it alone whatever its mode and the steer marker.
- **D-8968 (2026-11-23)** — the-build-kills-a-refused-advisor-launch. In build 2.1.331 an interactive launch with
  `--advisor` exits when the main model has no advisor rank, or when the advisor would bill to usage credits on that
  account and was never enabled there; a ccd pane is interactive, and five deaths in 120 s leave the unit FAILED. The
  operator says every account has Fable on its plan, so the credits arm is not expected; the rank arm stands, and the
  eligibility rule takes only an Opus 5 or later main model when its id is measured. With
  the feature gate off (`CLAUDE_CODE_DISABLE_ADVISOR_TOOL`, non-essential traffic or feature flags disabled, a
  non-first-party provider, the remote flag off) the flag is skipped silently. Hence the eligibility rule (Anthropic
  lane, Opus main measured) and ccd's fast-death fallback. ccd's session spawn sets none of the disabling variables in
  this tree (`ccrc-codex` does, on a lane that is never eligible).
- **D-8969 (2026-11-23)** — the-advisor-transcript-shape. Found in the build's strings: `server_tool_use` named
  `advisor`, `advisor_tool_result` with `advisor_result` / `advisor_redacted_result` / `advisor_tool_result_error`,
  `usage.iterations[]` entries of type `advisor_message` carrying `model` and token counts, and the `advisor_tool`
  attachment with `available`. A local transcript shows `usage.iterations` is persisted; no local transcript holds an
  advisor call, so the persisted line is Trial step 1.
- **D-8970 (2026-11-23)** — the-cap-clears-the-route-and-the-roll-drops-it. A running session can drop the advisor only
  by `/advisor off` (typing, refused) or a restart. At the cap the lane clears `advisor`, and the roll gains the reason
  `advisor-stale`, so `ccd hibernate --roll` restarts the session in place at its next idle (90 minutes quiet). Calls
  between the cap and that roll are counted as overrun and shown; the trial measures them. Under a live continuity lane
  the renewal applies it instead. So the cap is enforced at the next idle restart or renewal, not at the call that reaches
  it: a coordinator that never idles keeps the advisor until then, and the readout shows each call over the cap. A drop
  (fast death or `available:false`) holds for the rest of its UTC day across restarts, and is retried the next day.
- **D-8971 (2026-11-23)** — a-viewer-free-forward-reader. The counter shares `parse.ts`'s parser and the resolver, but
  is its own reader: the tailer exists only while a stream is open (another lifetime), and the usage sweep runs every 4
  hours, per account, offline (a daily cap needs minutes). It starts a file it has no place in at its tail: read from
  byte 0, a transcript of tens of MB on a new path after a swap would take hours to reach today's calls.
- **D-8972 (2026-11-23)** — no-experimental-switch-and-no-skill-clause. `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL`
  is rejected: it bypasses the build's pairing and rank checks. The coordinator skill's pinned clauses are unchanged;
  Claude Code's advisor prompt already says when to consult (before an approach, on recurring errors, before done), and
  ccrc-specific guidance is a follow-up PR.

## The trial

**Who.** Two coordinators of comparable programmes, both on Opus, both on Anthropic lanes, chosen by the operator at
the start and named in the Settings row's scope (operator data, not this repository). Coordinator A and coordinator B.

**Design: a crossover, 10 working days.** Days 1–5: A has the Fable advisor (cap 12), B has none. Days 6–10: swap. The
swap cancels the difference in the programmes' difficulty.

**Step 1 (day 1, before anything is compared).** Confirm on A's transcript: the persisted shape of a call and its
`advisor_message` usage (D-8969), the `advisor_tool` attachment, the readout reaching `live`, no `advisor-dropped` line
in `swap.log`. Any difference from the spec's shape is fixed in the reader before day 2.

**Compared, per coordinator per day, arm against arm:**
- review rounds per merged PR (the reviewer runs per work run);
- rework: PRs that needed a fix round after review, and PRs reverted within 7 days;
- limit usage: the account's seven-day window change per day (`~/.cc-limits`), and the advisor's own tokens;
- advisor calls per day, days the cap was hit, overrun calls, and time to the roll after a cap (the cap is enforced at
  the next idle restart, D-8970, so the overrun is the measure of how far it lags).

**Decision rule.**
- **Keep Fable on for every coordinator** when the advised arm shows at least 15% fewer review rounds per merged PR, or
  at least 25% less rework, and the advisor's share of an account's weekly window stays under 10% per coordinator.
- **Switch to an Opus advisor** when the quality gain holds but the usage share is 10% or more.
- **Turn it off** when neither quality measure moves by those margins.
- **Stop the trial at once** on a fast death, a `dropped` on two days, or an overrun above half the cap on three days.
