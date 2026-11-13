# Overlord W1a: Renew now, the console's `renewing`, the operator's mark, and the hand-offs to the renewal lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the operator can renew a long-lived session from the console ("Renew now") and choose when soft renewals
happen; the console's prompt answers `renewing` and keeps the draft while a session is between conversations; the
prompt route writes the `operator-at-programme` mark a coordinator's break reads; the roll lane hands long-lived
sessions to the renewal lane once it is armed; the PreCompact arm's route field gets its writer; and a resumed
long-lived session that lost a background task is told so, by the stall watch's existing `restarted` arm.

**Why:** these are the remaining W1a parts of §3.3.8 and §3.3.11 around the renewal act. The roll lane today treats
every session that is not a child as a coordinator and would resume a long-lived session's old conversation (§3.3.8).
W0b measured that a background shell does not survive a swap and that the resumed session takes no turn on Claude
Code's notice (W0-21, Proposal 12); W0b's proposal names two ways, a new nudge or the D5 `restarted` arm, and this plan
takes the second, because the arm is the existing owner of that notice.

**Architecture:** two operator doors (session-gated) and two rows in their tables; one change to the console's prompt
route; one mark; a role input to the roll's target verdict; the generations lane gains one more route field to write;
the stall watch's `restarted` arm widens from run workers to long-lived sessions, as a run-less notice. Two pull
requests: **PR A** (Tasks 1 to 4, the operator's surfaces) and **PR B** (Tasks 5 to 7, the hand-offs).

**Tech Stack:** TypeScript (ESM), React (the PWA), `node:sqlite`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.8 (rolls hand every long-lived role to the renewal
lane; a new install is a soft trigger; any wake is a start), §3.3.9 (C50: a coordinator's operator activity is the
`operator-at-programme` mark the console's prompt route writes, from W1a), §3.3.11 ("Before the message record exists.
In W1a, the console's prompt route answers `renewing` for a session whose generation is in `clearing` or `carded`, and
the console keeps the draft"; "How long a trigger waits"; the Setting "Renew when I'm away" / "Renew on schedule"; the
daily backstop's hour), Table 11.1d (the W1a Settings), Table 11.1e rows "The operator's Renew now" (W1a) and "The mark
`operator-at-programme`" (W1a, 30 minutes); the results note (W0-21, Proposal 12).

## What exists today

- The console's prompt route: `app.post('/api/sessions/:id/prompt', …)` in `server/src/server.ts`, calling
  `server/src/inject/send.ts#sendPrompt`; body `text`, `replaceDraft`, `attachments`, `resume`. No mark is written.
- The roll lane: `server/src/rollLane.ts` (`ROLL_LANE`, `rollPass`), choosing through
  `server/src/coord/rollTarget.ts#rollTargetVerdict(targets, role: SessionRole | null)` and `autoRollVerdict`, with `role`
  from `FleetSession.role` (`sessionRoleOf`, the child axis only). It runs `ccd hibernate --roll <id>`, which resumes.
- The stall watch's `restarted` arm (D5): `server/src/coord/stall.ts#stallRestartedVerdict(s)`, for a run worker whose
  turn marker is `done` with `lostBg > 0` and `restartAt > stopAt`; rung 1 mails the worker, rung 2 its claimant; live
  only with `$REG/stall-watch-w2-live` and the recipient's markers, otherwise shadow. Coordinator notices are run-less
  and found by their mail subject (D-3653).
- The session-gated coordination writes are pinned by `server/test/box-token-census.test.ts`'s `SESSION_ONLY` set and
  the sentence in `CLAUDE.md` that lists them ("The other sixteen are in that file's `SESSION_ONLY` set"), checked in
  both directions.
- The generations lane, its acts and `softRenewalMay` (the generations, renewal-act and renewal-deciders pieces); the
  route field `precompact` (the compaction piece); `routeSet` (`server/src/ccdargv.ts`).

## Global Constraints

- **Architecture (`CLAUDE.md`).** One writer per fact: the Renew now door writes `continuity_renew_requests`, the prompt
  route writes `operator_marks`, the Settings door writes its setting, the generations lane writes generation rows and
  the `precompact` route field. Decide in L1: the roll target verdict gains a role input and a rule; the lane and the
  routes only act. Consolidate: the lost-task notice is the D5 arm, widened, not a second notice; the hand-off is a row
  of the roll's verdict, not a second roll lane. A guard ships with a test that goes red without it. Additive wire.
- **SAFETY (`CLAUDE.md`).** No ccd verb. Renew now is the operator's, session-gated; it enters the same lane, so every
  check the lane makes still applies.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; from `pwa/`: its suite
  for the touched screens. Each task's last run adds both server `tsc` runs (and pwa's for PWA tasks). **Growth check:**
  `server/src/server.ts`, `server/src/coord/routes.ts`, `server/src/watch.ts` and `pwa/src/lib/api.ts` grow at most 40
  net lines each.
- **Mutation floors.** The widened `rollTargetVerdict` and `stallRestartedVerdict` keep their floors (raise if they
  rise).
- **Censuses.** Each new session-gated door: `SESSION_ONLY` in `box-token-census.test.ts`, the sentence in `CLAUDE.md`,
  `server/test/auth-gate.test.ts`, `server/test/rings/fastify-l4.data.ts`. New refusal words through
  `shared/refusal.ts`.
- **Migration slot** re-measured before merge. Cite by symbol or `@anchor`. No private names. No D-number invented;
  departures go in `docs/superpowers/plans/2026-11-10-overlord/w1a-renewal-handoffs/departures.md`.

## Review Focus

1. The roll lane never resumes a long-lived session once the `continuity` row is `live`, and rolls it as today while it
   is `shadow`.
2. The console never loses a draft to a renewal: `renewing` (409) keeps it, and the PWA shows why.
3. The mark is written only for a prompt the operator typed into a session whose programme is measured, and it expires
   by its own time, never by a timer.
4. The widened D5 arm reaches a long-lived session once per restart, shadow until its markers, and never mails a child
   twice.

---

### Task 1: "Renew now"

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `continuity_renew_requests(id INTEGER PRIMARY KEY, sessionId TEXT NOT
  NULL, actor TEXT NOT NULL, at INTEGER NOT NULL)`, written only by the door)
- Modify: `server/src/continuity/routes.ts` (`POST /api/sessions/:id/renew`, session-gated: refuses a session whose role
  is not long-lived `renew-not-long-lived`, and one with a request the lane has not read yet `renew-pending`)
- Modify: `server/src/continuity/generationsLane.ts` (reads requests after its `continuity_cursor` row `renew-requests`;
  a request sets `renewNow` for that session's live generation, and the cursor advances in the same transaction as the
  `due` write, so a request is read once)
- Modify: `pwa/src/` (one button on the session screen's actions for a long-lived session; measure the screen)
- Modify: the census files and `CLAUDE.md`'s sentence
- Test: `server/test/continuity-renew-now.test.ts` (new), the PWA screen's suite

- [ ] **Step 1: Failing tests:** the door's 200, its two refusals, the auth gate; the lane renews (live) or records
  (shadow) on the request; a request behind the cursor is not read again.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): Renew now, the operator's door into the renewal lane`

### Task 2: The prompt route answers `renewing`, and the console keeps the draft

**Files:**
- Modify: `server/src/server.ts` (the prompt route reads the session's live generation; in `clearing` or `carded` it
  answers `409 { ok: false, error: 'renewing' }` before `sendPrompt`)
- Modify: `shared/refusal.ts` (`renewing`, 409)
- Modify: `pwa/src/` (the composer: on `renewing`, keep the text, show "Renewing — your message is kept; send it again
  in a moment."; measure the composer and its draft store)
- Test: `server/test/continuity-prompt-renewing.test.ts` (new), the composer's PWA suite

- [ ] **Step 1: Failing tests:** `clearing` and `carded` answer 409 and do not type; `active`, `draining`, `probing` and
  no generation type as today; the PWA keeps the draft on 409 `renewing`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(console): a prompt to a session between conversations answers renewing and keeps the draft`

### Task 3: The `operator-at-programme` mark

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `operator_marks(programme TEXT PRIMARY KEY, at INTEGER NOT NULL)`)
- Modify: `server/src/server.ts` (after a prompt is typed, the route upserts the mark for the programme the session
  coordinates or serves, measured from its runs; a session with no programme writes none)
- Modify: `server/src/continuity/generationsLane.ts` (a coordinator's `lastOperatorActivityMs` is `now - mark.at` for its
  programme; no mark is "no activity", a read failure is `unmeasured`)
- Modify: `shared/continuity.ts` (`OPERATOR_MARK_MS = 1_800_000`, the mark's 30 minutes, Table 11.1e)
- Test: `server/test/continuity-operator-mark.test.ts` (new)

- [ ] **Step 1: Failing tests:** a prompt into a coordinator of `prog-a` marks `prog-a`; into a worker of `prog-a` marks
  `prog-a`; into a session with no programme marks nothing; a soft renewal of `prog-a`'s coordinator waits while the mark
  is younger than 20 minutes and starts after; a mark older than 30 minutes reads as no activity.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): the prompt route writes the operator-at-programme mark (C50)`

### Task 4: When soft renewals happen, a Settings row

**Files:**
- Modify: `shared/switches.ts` (row `renewal-mode`: setting, `when-away` | `on-schedule`, default `when-away`, owner
  `C3`, writer `POST /api/coord/renewal-mode`)
- Modify: `server/src/coord/routes.ts` (the session-gated door, `roll-idle`'s shape)
- Modify: `server/src/continuity/generationsLane.ts` (passes the stored mode to `softRenewalMay`)
- Modify: `pwa/src/screens/settings/` (the row beside "Roll idle sessions")
- Modify: the census files and `CLAUDE.md`'s sentence
- Test: `server/test/renewal-mode-route.test.ts` (new), the PWA settings suite

The daily backstop's hour and time zone (Table 11.1d, W1a) have no consumer before the Overlord exists (its row is the
Overlord's only), so they ship with W1's Settings, recorded below.

- [ ] **Step 1: Failing tests;** **Step 2: Run** (red); **Step 3: Implement;** **Step 4: Run** (green).
- [ ] **Step 5: Commit.** `feat(settings): when soft renewals happen, when I'm away or on schedule (R19)`

**PR A ends here.**

### Task 5: The roll lane hands long-lived sessions to the renewal lane

**Files:**
- Modify: `server/src/coord/rollTarget.ts` (`rollTargetVerdict` and `autoRollVerdict` take `longLived: boolean | null`
  and `continuityLive: boolean`; a long-lived session while the row is `live` is skipped with the reason
  `renewal-owns`; `null` (an undecided role) is skipped as `role-unknown`, as an unknown `SessionRole` is today)
- Modify: `server/src/rollLane.ts` (gathers `longLived` with `roleFactsOf` and `FLEET_ROLES[role].longLived`)
- Test: `server/test/roll-target.test.ts` (measure its name), `server/test/roll-lane*.test.ts`

The new install the roll would have answered is the `new-install` soft row of `renewalDue` for a coordinator, so it is
renewed from canonical state instead of resumed (§3.3.8).

- [ ] **Step 1: Characterize:** the roll's suites green on the branch point; with `continuityLive: false` every case
  answers as today.
- [ ] **Step 2: Failing tests:** a coordinator with the row `live` is skipped `renewal-owns`; a plain session is rolled
  as today (its role is not long-lived); the exhaustive verdict test grows the two inputs.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green.
- [ ] **Step 6: Mutation.** Skip the `continuityLive` check: the shadow case goes red. Revert.
- [ ] **Step 7: Commit.** `feat(roll): a long-lived session is the renewal lane's once it is armed (§3.3.8)`

### Task 6: The PreCompact arm's field, and the hibernate wake as a start

**Files:**
- Modify: `server/src/continuity/generationsLane.ts` (for a live long-lived generation, while the row is `live`: write
  `precompact=refuse` while `softRenewalMay` has budget left, `allow` once it is spent, through `routeSet`, only on a
  change; `shadow` writes nothing)
- Test: `server/test/continuity-generations-lane.test.ts`, `server/test/continuity-hibernate-wake.test.ts` (new)

- [ ] **Step 1: Failing tests:** live with budget writes `refuse` once; spent writes `allow`; shadow writes nothing.
  A hibernate wake (a `resume` start report after a sleep) mints a generation with `resumed: true`, and with the context
  above half the hard cap it is due `resumed-long` (hard); below, it is probed and goes on (the wake needs no other
  change: any wake is a start).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): the lane writes the PreCompact arm's field; a wake is a start`

### Task 7: A resumed long-lived session is told it lost a background task (the D5 arm, widened)

**Files:**
- Modify: `server/src/coord/stall.ts` (`stallRestartedVerdicts` also judges a session whose role is long-lived and that
  is not a run worker: rung 1 only, a run-less notice keyed on its mail subject, `restarted: <restartAt>`; the arm's
  existing markers decide shadow or live, unchanged)
- Modify: the stall watch's caller in `server/src/watch.ts` (passes the long-lived sessions, from `roleFactsOf`)
- Test: `server/test/stall-restarted*.test.ts` (measure), `server/test/stall-vocabulary.test.ts`

- [ ] **Step 1: Characterize:** the arm's suites green; a run worker's verdicts unchanged.
- [ ] **Step 2: Failing tests:** a coordinator whose marker is `done`, `lostBg 1`, `restartAt > stopAt` gets one rung-1
  notice (shadow without the markers, mail with them); a second sweep sends nothing (the subject key); a plain session
  gets none; a run worker's rung 2 to its claimant is unchanged.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green.
- [ ] **Step 6: Commit.** `feat(stall): the restarted arm also tells a resumed long-lived session it lost a background task (W0-21)`

**PR B ends here.**

## Deviations found

None yet. Decisions this plan takes, by slug:

- **lost-task-nudge-is-the-d5-arm** — Proposal 12's nudge is the D5 `restarted` arm widened to long-lived sessions, run-less;
  arming it for the Overlord's role follows in W1, with the role.
- **renew-request-read-by-cursor** — the lane reads Renew now requests from a cursor row of its own, so the request
  table keeps one writer, the door.
- **backstop-setting-in-w1** — the daily backstop's hour and time zone ship with W1, where the Overlord's row first reads
  them (Table 11.1d lists them in W1a).
- **mark-for-any-session-of-the-programme** — a prompt into any session of a programme marks the programme.
- **roll-skips-long-lived-when-live** — the roll's hand-off is a skip reason, `renewal-owns`, read only while the
  `continuity` row is `live`.

## Where things stand

**Needs before it starts:** the renewal-act piece (the acts and the arming), the compaction piece (the `precompact`
field), the generations piece.

**What depends on it:** the `continuity-v1` piece; W1's Overlord (Restart the Overlord; the backstop setting; the D5
arm for its role).

**Open questions for the operator:** none beyond the renewal-act piece's arming question.
