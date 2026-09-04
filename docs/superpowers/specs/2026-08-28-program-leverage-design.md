# Program leverage: onboarding, trigger hardening, throughput — design

Date: 2026-08-28 · Status: awaiting operator review · Program: `program-leverage` (8 waves)
Origin: a full six-reader verified sweep of the coordination machinery (this session, 2026-08-28)
plus two operator rulings taken the same day (§9).

## 1. Problem

The coordination machinery (programs, waves, mail, claims) is strong, but a project only benefits
from it when four preconditions all hold — skills installed in every wrapper HOME, a committed
ledger, a seeded deviation floor, and an operator who starts a program instead of an ad-hoc
session. Today every one of those is manual, undiagnosed, and fails silently. Separately, the two
trigger paths at the edges of a program's life (the first kickoff, and coordinator resume after
death) are the two paths that bypass the machinery's own discipline, and the mail lane's quiet
window prices a coordinator's wave-boundary turns as if they were a worker's mid-thought turns.

This design covers ten improvements in eight waves. Each feature section states the **measured
current state** (verified against this tree on 2026-08-28, with citations), the **design**, and
the **test obligations** (mutation-table discipline: every guard ships with a test that reds when
the guard is deleted).

## 2. Non-goals

- **Build 9 remnants.** Peers, claims, the deviation allocator, lifecycle provenance and the
  claim-break door all shipped in build 9/9b (`docs/superpowers/plans/2026-08-24-build9b-peers-claims-allocator.md`);
  anything still open there rides its own program, not this one.
- **No new ccd verbs, no FLEET_PROTO bump, no coordinator election.** All standing invariants
  (wire additive-only, zero new coordination verbs, box-token discipline, single-definition) hold
  throughout; where a feature touches an invariant the section says how it complies.
- **No relaxation of worker-side mail gating.** F6 narrows the quiet window for coordinators
  only; workers keep the full mid-thought protection.

## 3. Wave 1 — F1: drift fixes and the coordinator-resume runbook

**Measured current state.**
- Root `CLAUDE.md` says "TWO deliberately ungated operator doors"; shipped source has THREE and
  the test pins the set in both directions (`server/src/coord/routes.ts:1132-1139` "the WHOLE
  unauthenticated write surface of this file"; `server/test/coord-pause-route.test.ts:172`
  `UNGATED = {'/api/coord/pause','/api/runs/:id/abandon','/api/claims/:id/break'}`).
- The coordinator skill's trigger sentence ("…or this workspace's hold reads
  `program:<slug> wave:N/M`", `ccd/coordinator-skill/SKILL.md:3`) describes a state a PWA-started
  coordinator can never be in: it is a main checkout (`workspace === null`,
  `pwa/src/fleet/StartProgramSheet.tsx:89-90`) and `ccd ws-hold` hard-refuses non-workspaces
  (`ccd/ccd:4938-4939`); every `program:` hold lands on the WORKER's workspace. The sentence is
  not test-pinned (only frontmatter shape + the anti-use sentence are,
  `server/test/coordinator-skill.test.ts:130-136`), so it can be corrected without redding a suite.
  (An operator-designated coordinator MAY be a workspace session — this program's own coordinator
  is one — so the fix must not assert main-checkout-ness either.)
- No coordinator-resume runbook exists anywhere in the tree (greps over README + docs/superpowers
  hit only the Build 7 spec's §8 sentence, whose "any fresh session resumes" half is false against
  the shipped `claimed-by-another` guard, `server/src/coord/store.ts:363-371`).
- Stale anchor: `StartProgramSheet.tsx:16` cites `ccd:185` for `_id()`, which now lives at
  `ccd/ccd:1091`.
- The skill's resumability paragraph (`SKILL.md:15-25`) frames the resume constraint as "same
  WORKSPACE"; the invariant is same **session id** (same wrapper+project for a main checkout).

**Design.**
1. Correct root `CLAUDE.md`'s door count to three, naming the third
   (`POST /api/claims/:id/break`). (After wave 5 lands, wave 5's worker bumps it to four — F5
   carries that obligation so the count is corrected exactly once per change, by the wave that
   changes it.)
2. Reword the coordinator skill's trigger arm to point at the run record ("this session is the
   `claimedBy` of an open run — `GET /api/runs`") rather than a hold it cannot carry, and fix the
   resumability paragraph's "same workspace" to "same session id". The worker skill's trigger
   keeps its hold arm (the hold genuinely lives on the worker's workspace).
3. New reference `ccd/coordinator-skill/references/resume.md` — the coordinator-resume runbook:
   the id-preserving revives (`ccd start <id>` one-argument form, `ccd/ccd:12117-12129`; the
   PWA's dead-session "Restart session" → `POST /api/sessions/:id/ensure`), the wave-N re-kickoff
   text template (today's only machine kickoff hardcodes "open the run for wave 1"), why a
   different placement wedges `claimed-by-another` permanently, and a pointer to the
   reconstruction drill as the terminal recovery. CONSTRAINT: the census test requires the three
   destructive verbs to appear ONLY inside clause 3 across SKILL.md + all references
   (`coordinator-skill.test.ts:97-105`) — the runbook must not name them.
4. Fix the `StartProgramSheet.tsx:16` stale anchor.

**Tests.** The trigger-sentence rewording and the runbook's existence + key sentences get pins in
`coordinator-skill.test.ts` (same verbatim style as the ten clauses, small set); CLAUDE.md is
prose and gets none. Deploy is **AGENT-FIRST** (touches `ccd/coordinator-skill/`).

## 4. Wave 2 — F2: dispatch-time skill preflight + synchronous deviation-floor seeding

**Measured current state.**
- A worker dispatched onto a HOME whose installer never ran has only the brief's one
  belt-and-braces branch sentence — the design admits this ("a skill reaches a home only once its
  installer has run there", `ccd/coordinator-skill/SKILL.md:80-87`). Nothing measures skill
  presence at dispatch; the dispatch response carries `adopted`/`spawnState` but no skill fact
  (`server/src/coord/dispatch.ts:544-582`).
- A new project's first `POST /api/ledger/deviations` answers 409 `not-seeded` until the hourly
  floor sweep has measured it (`ccd/coordinator-skill/references/peer-protocol.md:111-143`); the
  coordinator's pinned contract is then "report, don't invent" — i.e. the first program on every
  new project eats a stall.

**Design.**
1. **Skill preflight (measure, never refuse).** After dispatch binds the worker session id, read
   `<worker configDir>/skills/ccrc-worker/SKILL.md` via a measured FleetIO read (the configDir
   derivation `server/src/livestate.ts` already owns). Surface
   `skillState: 'present' | 'absent' | 'unmeasurable'` additively on the dispatch response beside
   `spawnState`, and a `run_events` detail row. Absence-permits: an `absent` never refuses the
   dispatch (the brief still works, degraded); the coordinator skill's dispatch-response table
   documents the new field and tells the coordinator to report `absent` to the operator before
   treating the wave as briefed.
2. **Synchronous floor seed.** The allocator, on an unseeded project, runs the same floor
   measurement the hourly sweep uses, inline and bounded, then proceeds; 409 `not-seeded` remains
   only for the case where that measurement itself fails. Response shape unchanged otherwise.

**Tests.** skillState: three-way mutation test (present/absent/unmeasurable fixtures through the
fixture-HOME harness); a test that deletes the preflight and reds on the missing field. Seeding:
first-allocation-on-fresh-project succeeds test; measurement-failure still answers `not-seeded`.

## 5. Wave 3 — F3: the program-ready badge

**Measured current state.** Nothing surfaces, per project, whether the four program preconditions
hold; the operator discovers a missing one mid-wave. The registry-durability program's F-1 (both
skills teaching a broken token read) was found only when the coordinator's own first call failed.

**Design.** A per-project readiness measurement, computed server-side from reads the server
already owns: worker+coordinator skill present in every rostered wrapper HOME (FleetIO measured
reads), deviation floor seeded (coord.db), box token configured (already measured at boot), and
coordination DB available (`not-configured` arm). Shipped **additively** on an existing read the
/runs board already consumes (`GET /api/runs` summary or the coord status emit,
`server/src/registry.ts:775-783` — the wave's plan picks the seam; wire discipline: additive
field, single reader, older-server omission tolerated). PWA: a compact per-project badge on the
/runs board ("program-ready" / list of missing preconditions). No new ccd verbs; reads only.

**Tests.** Each precondition's measurement gets an unmeasurable arm distinct from false (no
overloaded null at the seam); a mutation test per precondition (delete the measurement → red).

## 6. Wave 4 — F4: the kickoff rides the mail lane

**Measured current state.** The program kickoff is the ONE machine injection that bypasses the
delivery lane's discipline: `StartProgramSheet.finish()` fires `api.prompt` the instant the new
session's row appears in a `/ws/fleet` frame → `POST /api/sessions/:id/prompt` → direct
`sendPrompt` tmux injection with NO idle gate, no spawn-readiness check, racing ccd's cold-start
prompt-clearing (the sheet's own B-1 comment, `StartProgramSheet.tsx:447-464`); a failed kickoff
is a toast ("finish the kickoff by hand") with no retry, no durable record. Wave briefs
deliberately refuse this exact path ("as MAIL, never injected directly — a fresh pane is
`working` for its first seconds", `server/src/coord/dispatch.ts:100-104`).

**Design.** The kickoff becomes durable system mail, delivered by the same idle-gated lane that
delivers briefs:
- A session-surface route (the wave's plan picks between a `kickoff` field on `POST
  /api/sessions` and a sibling `POST /api/sessions/:id/kickoff`; the PWA holds no box token, so
  it must be a PWA-surface route, ordinary non-exempt write under the auth gate) queues
  `queueSystemMail` to the new session — subject `program-kickoff`, body the kickoff text.
- The sheet stops calling `api.prompt` for the kickoff; the D-292 hijack protections
  (wrapper-scoped, freshness-checked target) move with the addressing, not the injection.
- Failure modes become the mail lane's honest ones: parked deliveries are visible (F7 surfaces
  them), `draft-present`/`enter-ignored` semantics replace the silent race.
- The nudge-then-fetch shape is acceptable for a coordinator kickoff (the session fetches the
  body by deliveryId exactly as it fetches any mail); the kickoff text itself still names the
  `ccrc-coordinator` skill.

**Tests.** Route: gate posture pinned (dark vs armed, exact status equality per the stage-3a
convention); queue-not-inject pinned (the kickoff path calls `queueSystemMail`, never
`sendPrompt` — a test that reds if a `sendPrompt` call site returns). PWA: sheet no longer
imports/calls `prompt` for kickoff.

## 7. Wave 5 — F5: coordinator resume — the reclaim door and the PWA affordance

**Measured current state.** `claimedBy` is written once by `openRun`'s INSERT and no code path
rewrites it (no `UPDATE runs SET claimedBy` in server/src or ccd); a dead coordinator whose id
cannot be re-landed wedges the program `claimed-by-another` permanently
(`server/src/coord/store.ts:363-371`; `SKILL.md:15-25` admits it). StartProgramSheet can mint a
DIFFERENT id for a dead coordinator (its own docstring's `claude2-ccrc-pwa` example,
`StartProgramSheet.tsx:154-164`). The only escape is the hand-run reconstruct drill (rebuilds
runs `claimedBy` NULL, "lives HERE and ships nowhere").

**Design.** (Operator ruling 2026-08-28: ungated + dead-proof.)
1. **`POST /api/runs/:id/reclaim`** — the FOURTH ungated operator door, same D-282 logic as
   abandon (the release valve for a wedge must not sit behind the wedged party's key). Its guard
   is a re-measurement, not a credential: it refuses (`claimant-alive`) unless the current
   `claimedBy` session is measured dead/absent — registry row proven absent (listed directory,
   name missing) or present with a tmux verdict of gone/dead; an unmeasurable registry refuses
   `registry-unmeasurable`, never proceeds. Body carries `{claimedBy: <new id>}` (shape-checked;
   the new claimant must exist in the registry). It rewrites `claimedBy` on the program's
   non-terminal runs in one transaction, each with a `run_events` attribution row
   (`causedBy:'operator'` — hardcoded like abandon's, never read from the body beyond the new id).
2. **Ungated-set obligations:** `coord-pause-route.test.ts`'s `UNGATED` grows to four; the door
   is NOT in the auth gate's EXEMPT table (armed boxes put it behind the session gate,
   strengthening D-282 exactly as the existing three); the skill corpus must NOT name it (join
   the parity-EXEMPT set and the forbid-mention pin, like `/api/claims/:id/break`); root
   CLAUDE.md's door count moves to four (this wave's obligation, per F1's rule).
3. **PWA resume affordance.** The /runs board detects an open run whose `claimedBy` session is
   dead and offers, in order: revive-same-id (`ensure`), wave-aware re-kickoff (F4's mail-lane
   kickoff, text template from F1's runbook), and — only when the id itself cannot be revived —
   reclaim onto a named live session. StartProgramSheet refuses to start a NEW program for a
   project that has an open run (today it only refuses on a live main checkout).

**Tests.** Reclaim: dead-proof mutation table (alive → `claimant-alive`; unmeasurable →
`registry-unmeasurable`; dead → rewritten + event rows; terminal runs untouched); UNGATED-set
two-direction pin updated; forbid-mention pin; gate-posture pin (dark open, armed session-gated).

## 8. Wave 6 — F6+F7a: coordinator quiet window and the caps route

**Measured current state.**
- The mail lane's composed wake floor is ~60–74s per wave event and at most one machine wake per
  ~2 minutes (`MAIL_QUIET_MS=60_000`, `MAIL_COOLDOWN_MS=120_000`, `server/src/watch.ts:176-188`);
  right for a worker mid-thought, wrong for a coordinator idling AT a wave boundary by design
  (clause 7 mandates it end its turn and wait).
- Caps (`maxConcurrentWorkers=3`, `maxSessionsPerDay=12`, `server/src/coord/schema.ts:187-194`)
  change only by hand-editing sqlite: `CoordStore.setCaps` has NO caller in server/src.

**Design.**
1. **`COORD_QUIET_MS` (proposed 15s) for coordinator recipients.** In `sweepMail`, a recipient
   that is the `claimedBy` of a non-terminal run (one read per sweep, cached for the sweep) uses
   `COORD_QUIET_MS` in place of `MAIL_QUIET_MS`, and `COORD_COOLDOWN_MS` (proposed 30s) in place
   of the 120s cooldown. Workers (run `sessionId`s) and every other session are untouched. Single
   reader; both constants defined once beside the existing pair with the same docstring style.
2. **Caps become an operator control.** `POST /api/coord/caps` — an ordinary PWA-surface write
   (session-gated when armed, open dark; NOT box-token: it is an operator dial, not a machine
   lane; NOT ungated: raising caps is not a release valve). Body partial
   `{maxConcurrentWorkers?, maxSessionsPerDay?}`, bounds-checked; wires `setCaps`; a `run_events`
   row is wrong here (no run) — a feed event records the change. PWA control beside the /runs
   board's pause control, showing current usage vs cap (`capsUsage` already computed).

**Tests.** Quiet window: a sweep test proving a coordinator recipient delivers inside
`MAIL_QUIET_MS` but respects `COORD_QUIET_MS` (and that a worker does NOT get the narrow
window — the guard's mutation direction); caps route: gate posture, bounds, and a
setCaps-now-has-exactly-one-caller pin.

## 9. Wave 7 — F7: program health on the board

**Measured current state.** Every wedge is discovered forensically: parked deliveries
(`rejected('undeliverable')`) are visible only by reading /mail; replay counts approaching the
20-ceiling, repeated `stale-tip` rejections, `briefQueued:false` dispatches, and an un-briefed
coordinator (open run, no dispatch, kickoff never acked) surface nowhere.

**Design.** Additive health facts on the /runs board's existing reads: per run — outstanding vs
parked delivery counts (excluding the benign `run closed` parks), max `replayCount`
high-water, count + last code of done-claim rejections (from `mail_rejections`/run_events),
`briefQueued`/`clearError` already on the dispatch response made durable and re-readable; per
program — un-briefed-coordinator detection (open run, `dispatchedAt` null, kickoff delivery
unacked past a threshold). PWA renders a compact warn row per run; no polling changes (the data
rides frames/reads the board already makes). All fields additive, absence tolerated, single
reader each.

**Tests.** Each health fact: a fixture that manufactures the wedge and asserts the fact appears;
delete-the-measurement mutation direction; wire-revive tolerance (older server omits → PWA
renders nothing, never a lie).

## 10. Wave 8 — F8: measured-read completion and mail terminality

**Measured current state** (root CLAUDE.md "Open on main", verified in-tree):
- `FleetIO.readFile`, `readFileB64`, `readFileFrom` still fold every failure to one `null`; the
  agent's `readFileB64` folds a THIRD condition (over-cap) into it, and the agent's `stat` op
  answers EACCES as `{missing: true}` (D-114; `readFileMeasured` shipped for the one seam
  registry-durability wave 1 needed, the rest remain).
- `MailDeliveryState` terminality: the `state NOT IN ('acked','rejected')` guard exists on the
  store's writers (`store.ts:1475-1640`), but CLAUDE.md still records "some writers lack the
  guard" — this wave AUDITS all writers (including any outside store.ts), fixes any that lack it,
  and either retires the CLAUDE.md line or records precisely which writer remains and why.

**Design.** Extend the measured-read pattern (`MeasuredRead`/`ReadFailure`) to `readFileB64` and
`readFileFrom` with the same consumer-by-consumer migration rule the registry-durability program
pinned (migrate a call site only where semantics are provably identical); agent half: the wire's
absent-marker gains an additive failure field (older agent omits → reader folds to today's
behavior — absence-permits, fail-shut to `unreadable` never `absent`); the agent `stat` EACCES
lie fixed the same way. Terminality: audit + guard + red test per writer. **AGENT-FIRST deploy.**

**Tests.** Per-seam three-way fixtures (absent/unreadable/over-cap where applicable); older-agent
frame-omission tolerance test; terminality: a writer-by-writer mutation table.

## 11. Operator rulings (2026-08-28, this session)

1. **Reclaim door: ungated + dead-proof** (F5.1's design as stated; measured-dead is the guard).
2. **Wave 1 dispatch holds for operator spec review** — the run is opened, the ledger committed,
   and dispatch waits for the operator's go on this document.

## 12. Program mechanics

- Program slug `program-leverage`, project `ccrc-pwa`, 8 waves, coordinator = this session
  (`ccrc-pwa-brisk-meadow`, an operator-designated workspace-resident coordinator).
- Per repo convention the ledger + this spec live on the coordinator's own branch
  (`ws/brisk-meadow`, pushed) until close; each wave's worker commits its own plan on its
  workspace branch (registry-durability precedent). Briefs name this spec by its in-repo path and
  the fetchable ref.
- TWO programs are active concurrently (battlescape-operational is live on MekWarLive): every
  `toId:'coordinator'` mail in this program MUST carry the `runId` (the runId-less form requires
  exactly one active program). Briefs restate this beside the branch-discipline sentence.
- Wave order is the leverage order: drift (1) → onboarding (2–3) → triggers (4–5) → throughput
  (6) → visibility (7) → debt (8). Waves 1, 8 are AGENT-FIRST deploys; wave 5 depends on 4 (the
  re-kickoff affordance uses the mail-lane kickoff) and on 1 (the runbook's template text).
