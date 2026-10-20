# Coordinator durability, the tail: the programme ledger, the drift reconciler (D7) and the claimant's uuid (D8) — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Workers do not edit §Deviations and decisions. Vitest only as `./node_modules/.bin/vitest run <file> --maxWorkers=2`, one suite at a time.

**Spec:** `docs/superpowers/specs/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md` (rev 2). Its §3 to §9 bind this plan in full.

**Status:** rev 2 (2026-10-20): rev 1 with a second review applied (§Review log, rev 2 table); rev 1 was rev 0 with the first review applied; approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision.

**Issues:** #752 (epic), #760 (D7), #761 (D8). **Ledger:** `docs/superpowers/programs/coordinator-durability.md`.

**Inputs.** The consolidation spec (`2026-10-19-ccrc-consolidation-wave-design.md`, rev 2.1, on `main` since #819; rev 2 approved by the operator 2026-10-19) and its W1a plan (`2026-10-19-consolidation-w1a-switches-notify.md`, on `main`, Tasks C1c and C1f); `CLAUDE.md`'s architecture direction (#818: one owner per job): C5, C6; K5, K6, K10, K11, K12; waves W1a (§5.3), W1b (§5.4), W3 (§5.6), W6 (§5.9) and its rules (§5.1). Coordinator-first routing (D-5300's digest; `coord/heldFor.ts`). The stall watch (`coord/stall.ts`). The skins W3 screens plan's Tasks P4a (`inboxTarget.ts`, a record's target; merged as #701) and P7 (not merged) (`DigestScreen.tsx` on the scaffold). D1's open PR #853 (#754): the park columns on `mail_deliveries`, the `'parked'` gate and its once-per-park push.

**Base:** `origin/main` `643c76cd4` (rev 1 used `0843cbc9a`; the code between them changes only the PWA settings screen, so every anchor holds). Anchors: `sweepDigest` `server/src/watch.ts` ≈:8891; `sweepAsks` ≈:8649; `heldAsks` ≈:796; `primed` ≈:1327; `hold()` ≈:9093; `LEDGER_RECONCILE_SWEEP_MS` ≈:414; `buildDigest` `server/src/coord/digest.ts` ≈:106; `parentOfSession` `server/src/coord/store.ts` ≈:6940; `reclaimProgram` ≈:1975; `openRun`'s `attribution` rung `server/src/coord/openRun.ts` ≈:300; `askNotifyAt` `server/src/askwindow.ts` ≈:54; `DigestAnswer` `shared/api.ts` ≈:11578; the `asks` table `server/src/coord/schema.ts` ≈:814; `COORD_SCHEMA_VERSION` ≈:1722 (26 migrations on the base; #853 takes 27; re-measure the slot).

**Deploy class.** DT1 to DT3, DT5 to DT7: server lane. DT4: PWA (served by the server). No fleet-box change, no `ccd` change, no restart of any session.

**Names.** Tasks **DT0** to **DT7**.

---

## Gates

Measured on 2026-10-20 with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` against `4c3f5ac95`. Open PRs touching this plan's files: **#853** (D1, #754, the single-commit recut of the closed #821 with identical content: `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts` with migration 27, `shared/api.ts`); **#846** (the outward-edge import drain: `server/src/coord/digest.ts`, `server/src/coord/routes.ts`, `server/src/coord/store.ts`, `server/src/watch.ts`, `server/test/single-definition.test.ts`; import lines and comments only, so DT1 to DT5 rebase onto it, rule 6); **#850** (`server/src/coord/schema.ts` with its own migration, `server/src/coord/routes.ts`, `shared/api.ts`, `server/test/single-definition.test.ts`: DT2's and DT6's migration slot is re-measured after it); **#848** (`server/src/coord/routes.ts`, refusal codes: line-disjoint from DT7's `openRun` refusal; re-check); **#832** (`server/src/watch.ts`, the delegation flush: line-disjoint from DT2's lane and DT5's `detectDialogs`; re-check); and **#737** (`server/test/single-definition.test.ts`). #833 (`store.ts`) merged as `4c3f5ac95`; #813 (`openRun.ts`) merged as `ee6154dc7`. Neither W1a's C1c nor W1b is on `main` yet. No open PR touches `server/src/coord/reclaim.ts`, `server/src/coord/openRun.ts` or `pwa/src/screens/DigestScreen.tsx`. Re-measure at each task's Step 0.

| Task | Open PRs | Consolidation wave | Other |
|---|---|---|---|
| DT0 docs (this plan, the spec, the ledger) | — | — | — |
| DT1 drift decider | **#853 merged** (its park columns are DT1's input); #737 only if DT1 edits `single-definition.test.ts` (it should not) | — | — |
| DT2 reconciler lane, table, pushes | #853 merged (migration slot after 27, and after #850's if it lands first) | **W1a's C1c merged** (the `notify` funnel; not C1f, not OA-C3); **W1b merged** (`LANE_SCHEDULE`) | DT1 |
| DT3 digest, server | — | — | DT2 |
| DT4 digest, PWA | — | — | DT3; skins W3 **P7** merged (P4a merged as #701) |
| DT5 held questions across a restart | rule 6 against #853 on `watch.ts` (line-disjoint: #853 edits the mail lane, DT5 `detectDialogs` and `sweepApprovals`; re-check at Step 0); #832 line-disjoint on `watch.ts`; #846 imports and comments only (rule 6) | none; a W3 series open on `watch.ts` rebases onto DT5 (rule 6) | — |
| DT6 claimant uuid column | — (#813 merged) | **W6 merged** | DT2 (for the `claimant-revived` kind) |
| DT7 `claimant-revived` refinement, `openRun` only | — | W6 | DT6; **the 30-day rule** with its floor (§DT7) |

## Landing order

```
DT0 (docs)
[#853] ── DT1 (decider) ──[W1a C1c, W1b]── DT2 (lane, table, pushes) ── DT3 (digest server) ──[skins P7]── DT4 (digest PWA)
DT5 (held questions across a restart)                      (independent)
[W6] ── DT6 (claimant uuid; the revived count) ──[floor of 5, then 30 days, ≥ 1 finding]── DT7 (openRun refinement)   or close #761's remainder
```

## Global constraints

- **The reconciler never acts.** It reads, records `drift_findings` (`recordDriftPass`, `markDriftPushed`), and pushes through the funnel (whose own `recordFeedEvent` archive write is the funnel's, not the lane's). It never mails a session, never calls a door, never closes, abandons, reclaims, re-dispatches or restarts (#760's "must not").
- **No claim moves implicitly** (#761). `claimant-revived` refines a refusal and offers; only the operator's confirmed reclaim moves a claim.
- **Account switching and the auto-swap are never blocked; no herd restarts; hibernation's contract; coordinator-first routing's hold rule; the ccrc SAFETY rules.** Nothing here writes a marker, a unit or a pane.
- **No new arming marker** (the consolidation's K12) **and no new clock**: the lane is a W1b `LANE_SCHEDULE` row.
- **Wire additive, absence-permits.** `DigestAnswer.drift` and the `409 claimant-revived` refinement of `claimed-by-another` are additive; `FLEET_PROTO` is not bumped.
- **D-2169 stands.** The held-question carrier stays in memory; DT5 only re-seeds it from rows.
- **Migrations are additive and append-only.** Re-measure the slot before the PR and before merge: `git fetch origin main && git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`.
- **Public repo.** Fixtures use `lane-a`, `project-a` and neutral session ids; finding details pass `redactCommand`.
- **Operator acts OA-D2 and OA-D6** (the ledger) are not tasks here and no task assumes them.

## Review focus

1. **A reconciler that acts.** Any store writer other than `recordDriftPass`, `markDriftPushed` and the funnel's own archive write reachable from the lane; any door called (DT2).
2. **A push storm.** The first-pass summary (marked `pushedVia 'summary'`, spending no daily budget), 3 per pass, 12 per day counted from `pushedVia 'item'` rows (so a restart keeps it), `pushedAt` as the once-only authority across a restart and a clear-and-return, the stall-overlap suppression (live observations only) and D1's `parkEscalatedAt` (DT2). **A push that opens nothing:** every push carries a `url`, and a run kind's its `runId` (DT2).
3. **An unmeasurable registry read as gone.** `claimant-gone` only on `ClaimantVerdict` `state: 'dead'`, never `unmeasurable` (DT1).
4. **A settle on doubt, or a second row.** DT5 settles a held row `stale` only on a measured pane that paints no dialog or another one; a pane measured late re-seeds from the pending set before `tryHold`, never minting a second row (DT5).
5. **A claim that moves without the operator.** DT7's `openRun` keeps refusing on `revived`; its success path is byte-unchanged; it pushes nothing.
6. **A uuid from the body.** DT6's reclaim writes the heir's uuid measured from the registry, never from the request.

## Tasks

### Task DT0: the spec, this plan and the programme ledger (D-5920)

**Routing:** native (docs). **Lane:** none.

**Files:**
- Create `docs/superpowers/specs/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md`.
- Create `docs/superpowers/plans/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon.md`.
- Create `docs/superpowers/programs/coordinator-durability.md`.

- [ ] **Step 1: Verify.** From `server/`: `git fetch -q origin main`, then `deviation-refs`, `dtbd`, `topology-clean`, `single-definition` and `docs-grammar`, each alone.

### Task DT1: the drift decider (D-5921; spec §4.1, §4.2) — GATED: after #853

**Routing:** band 2 (a pure decider over fixtures, fully specified). **Lane:** server. **Needs:** #853 (D1) merged: `mail-parked` and `mail-held` read its park columns.

**Files:**
- Modify `shared/api.ts`: `DRIFT_KIND_MAP` (`run-quiet`, `claimant-gone`, `mail-parked`, `mail-held`, `parent-mismatch`, `review-waiting`, `question-orphaned`), `DriftKind`, `DRIFT_KINDS = Object.keys(DRIFT_KIND_MAP)`, `isDriftKind`, and `DriftFinding { key, kind, subject, detail, factAt, runId, sessionId }`.
- Create `server/src/coord/drift.ts`: `driftFindings(input: DriftInput, now: number): DriftFinding[]`, pure, and the thresholds `RUN_QUIET_MS` (72 h), `MAIL_DRIFT_MS` (1 h), `REVIEW_WAITING_MS` (24 h), `DRIFT_PUSH_AGE_MS` (24 h), `DRIFT_ASK_MARGIN_MS` (20 s). `DriftInput` is plain rows: **active** runs (`ACTIVE_RUN_STATES`; `planned` and `awaiting-review` excluded, spec §4.2) with the `at` of their last **act** row (spec §4.2: rows `parseStallDetail` reads and lane rows caused by `'operator'` excluded); each claimant's reading from `measureClaimant` (`coord/reclaim.ts`; no second liveness vocabulary), typed as `ClaimantReading` with `ClaimantDeadCause` from `server/src/deadCoordinator.ts` (L1); outstanding deliveries with `state`, `lastGate`, `gateSince`, `parkedAt`, `parkEscalatedAt`; each worker's `ChildMark` run id beside `parentOfSession`'s answer and that run's `claimedBy`; awaiting-review runs with the `at` of their transition into `awaiting-review` and the `at` of the claimant's last mail naming the run; held and answering `asks` rows (`at`, `state`); the boot snapshot's approval ids whose child is measured still painting a prompt past `notifyAt + DRIFT_ASK_MARGIN_MS` with no `heldApprovals` entry (the watcher supplies that fact from DT5's snapshot; never a `released` row read from the store). Each run-kind finding carries `runId` (the programme's newest open run for `claimant-gone`) and each session-kind finding `sessionId`, for the push target (spec §4.4). Imports L0, `askNotifyAt` and `ASK_ANSWERING_MAX_MS` from `askwindow.ts`, and `ClaimantReading` and `ClaimantDeadCause` from `deadCoordinator.ts`; **never** `coord/reclaim.ts` (it imports IO).
- Modify `server/src/coord/store.ts`: the read methods the watcher needs, each a `{ ok: true, rows } | { ok: false, detail }` union (no overloaded null): `driftOpenRuns()`, `driftOutstandingDeliveries()`, `driftAwaitingReview()`, `driftHeldQuestions()`.
- Create `server/test/drift-findings.test.ts`.

- [ ] **Step 0: Re-ground** #853's merged column names and its `'parked'` gate word; the `ClaimantVerdict` shape; the `run_events` writers' `causedBy` values (`git grep -n "recordRunEvent(" server/src`).
- [ ] **Step 1: Red.** Per kind, "fires one past its threshold" and "does not fire one under it"; "an `unmeasurable` verdict is no `claimant-gone`"; "each dead `cause` (absent, stopped, orphan, never-started) fires and names itself"; "a swapped session (same id, same uuid, alive) is no finding of any kind"; "stall observation rows and operator rows do not reset `run-quiet`"; "`review-waiting` measures from the transition, and a claimant mail naming the run after it clears it"; "a parked delivery is `mail-parked` and never also `mail-held`"; "a terminal `rejected` delivery is no finding"; "`parent-mismatch` names the worker, not the run"; "a `planned` run is no finding"; "an `awaiting-review` run is `review-waiting` only"; "a run-kind finding carries its `runId`, and `claimant-gone` the programme's newest open run"; "`drift.ts` imports no IO module" (an import scan, as the ring suites do); "a `held` ask fires past `askNotifyAt(at) + DRIFT_ASK_MARGIN_MS` and not before"; "an `answering` ask inside `ASK_ANSWERING_MAX_MS` past its margin is no finding"; "keys are stable across two calls on the same input"; "`factAt` is the fact's own time where it has one"; and the investigation's cases as fixtures: "a weeks-old open run", "an archived claimant" (whatever `measureClaimant` answers for it), "an absent claimant", "a 27 h held delivery", "a parked delivery to a live worker", "the reused-name parent mismatch (#746)", "an 18-day awaiting-review run", "a held ask after a restart".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `unmeasurable` treated as dead | drift-findings | "an `unmeasurable` verdict is no `claimant-gone`" |
  | `RUN_QUIET_MS` 24 h | drift-findings | `run-quiet` "does not fire one under it" |
  | observation rows count as acts | drift-findings | "stall observation rows … do not reset `run-quiet`" |
  | parked rows not excluded from `mail-held` | drift-findings | "never also `mail-held`" |
  | key built with `now` | drift-findings | "keys are stable" |
  | `factAt` always null | drift-findings | "`factAt` is the fact's own time" |
  | `answering` uses the `held` margin | drift-findings | "an `answering` ask inside `ASK_ANSWERING_MAX_MS`" |
  | every non-terminal run is `run-quiet`'s | drift-findings | "a `planned` run is no finding" |
  | `awaiting-review` kept in `run-quiet` | drift-findings | "`review-waiting` only" |
  | `runId` left null on a run kind | drift-findings | "carries its `runId`" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `drift-findings.test.ts` alone; `coord-reclaim.test.ts` alone (the reading types stay equal); `single-definition.test.ts` alone (one home for `DRIFT_KIND_MAP`).

### Task DT2: the reconciler lane, `drift_findings` and the push budget (D-5922; spec §4.3 to §4.5) — GATED: after W1a's C1c, W1b and DT1

**Routing:** band 3, native (a new lane on the watcher; push volume to the operator). **Lane:** server. **Needs:** DT1; the consolidation's W1a Task C1c merged (the `notify(event, mode)` funnel; C1f and OA-C3 are **not** needed); W1b merged (`LANE_SCHEDULE`, `runLane`).

**Files:**
- Modify `server/src/coord/schema.ts`: one additive migration (the slot after #853's 27, re-measured), `drift_findings` with `pushedAt` and `pushedVia` (spec §4.3), `drift_findings_open` and `drift_findings_pushed`.
- Modify `server/src/coord/store.ts`: `recordDriftPass(findings, now)` (one transaction: upsert keeping `firstSeenAt` and `pushedAt`, re-open a returning key, clear the rest, prune cleared rows older than 30 days); `markDriftPushed(keys, now, via: 'item' | 'summary')` (compare-and-set on `pushedAt IS NULL`, writes `pushedVia`, returns the keys it changed); `openDriftFindings()`; `driftFindingsOpenAt(ms)`; `driftPushesOnDay(dayStartMs)` (the daily cap's count: `pushedVia = 'item'` only).
- Modify `server/src/watch.ts`: `sweepDrift(records, names)`, one `LANE_SCHEDULE` row at `DRIFT_SWEEP_MS = 900_000`: gather `DriftInput`, call `driftFindings`, `recordDriftPass`; then choose the pushes: findings with `pushedAt` NULL whose age passes `DRIFT_PUSH_AGE_MS`, excluding `question-orphaned`, a subject with a stall operator-rung observation whose `parseStallDetail` mode is `'live'` (a `'shadow'` one never suppresses), a `mail-parked` delivery with `parkEscalatedAt` set, and `claimant-gone` while `deadCoordinatorLaneArmed(names)` reads true (spec §4.4); on a pass that found the table empty, one summary push (`url` the day's digest path) and every such finding marked with `via 'summary'`; otherwise at most 3 this pass and `12 - driftPushesOnDay(today)` today. For each chosen key: `markDriftPushed([key], now, 'item')`, and only when it returns the key, `notify({ kind: 'coord', sessionId: <the session kind's id, else ''>, runId: <the run kind's id, else null>, … }, 'push', { url })`, `url` `/runs` for a run kind and `/s/<id>` for a session kind. Never throws: one bad read warns once and the next pass retries.
- Create `server/test/drift-lane.test.ts`.

- [ ] **Step 0: Re-ground** C1c's `notify` signature and W1b's `LANE_SCHEDULE` row shape on `origin/main`; the migration slot; rule 6 against any open PR on `watch.ts`.
- [ ] **Step 1: Red.** "a pass records found keys and clears the rest"; "a key cleared and found again keeps its `pushedAt`"; "a cleared row older than 30 days is pruned"; "the first pass sends one summary push, no per-item push, and writes no feed row per finding"; "4 crossings in one pass push 3, the 4th next pass"; "13 crossings in a day push 12, and a restart mid-day does not reset the count"; "a first-pass summary over 30 old findings leaves today's per-item budget at 12"; "a restart re-finds a key and does not push it again"; "a live stall rung-3 observation on the run suppresses `run-quiet`'s push"; "a shadow-mode rung-3 observation does not suppress `run-quiet`'s push"; "`claimant-gone` pushes while the dead-coordinator lane is unarmed and not once it is armed"; "every push carries a `url`; a run kind's push carries its `runId` and its Inbox row resolves to `/runs` through `inboxTarget`"; "a delivery with `parkEscalatedAt` set is not pushed"; "`question-orphaned` never pushes"; "the lane calls no store writer but `recordDriftPass` and `markDriftPushed` outside the funnel, and mails nothing" (a spy on the notify sink, every `CoordStore` writer and the mail queue; the funnel's own `recordFeedEvent` archive write is the one allowed exception, asserted as coming from inside `notify`); "an unreadable registry listing records nothing and clears nothing".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | no first-pass summary | drift-lane | "the first pass sends one summary push" |
  | per-pass cap removed | drift-lane | "4 crossings … push 3" |
  | daily count kept in memory | drift-lane | "a restart mid-day does not reset the count" |
  | `pushedAt` not read before the push | drift-lane | "does not push it again" |
  | re-open resets `pushedAt` | drift-lane | "keeps its `pushedAt`" |
  | stall suppression removed | drift-lane | its case |
  | stall mode ignored (shadow suppresses) | drift-lane | "a shadow-mode rung-3 observation does not suppress" |
  | daily count includes `'summary'` | drift-lane | "leaves today's per-item budget at 12" |
  | `url` or `runId` dropped | drift-lane | "every push carries a `url`" |
  | armed lane ignored | drift-lane | "not once it is armed" |
  | `parkEscalatedAt` ignored | drift-lane | its case |
  | clear on an unreadable listing | drift-lane | "records nothing and clears nothing" |
  | the lane queues a mail | drift-lane | "mails nothing" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `drift-lane.test.ts`, `mail-hardening.test.ts`, `stall-sweep.test.ts` and `single-definition.test.ts`, each alone.

### Task DT3: the digest's drift section, server (D-5923; spec §4.6) — GATED: after DT2

**Routing:** band 2. **Lane:** server. **Needs:** DT2.

**Files:**
- Modify `shared/api.ts`: `DigestAnswer.drift?: { totals: Record<DriftKind, number>; lines: readonly DriftLine[] }` and `DriftLine { key, kind, subject, detail, ageMs, sessionId, runId }` (`sessionId` the session a session kind names, `runId` the run a run kind names, the programme's newest open run for `claimant-gone`; each null where it does not apply; the PWA maps them to a target through P4a's model, spec §4.5); `v` stays 1.
- Modify `server/src/coord/digest.ts`: `buildDigest` reads `driftFindingsOpenAt(toMs)` and fills `drift`; `digestPushCopy` names the drift count only when non-zero.
- Modify `server/test/digest.test.ts`; modify `server/test/digest-routes.test.ts`.

- [ ] **Step 1: Red.** "a finding open at the window's end is a line"; "a finding cleared before the window's end is not"; "a zero-decision day with drift claims `count` 0 and sends no digest push"; "the push body names drift only when non-zero"; "a run-kind line carries its `runId`"; "the route's answer carries `drift`, and an answer without it parses on the old reader".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | open-at test uses `firstSeenAt` only | digest | "cleared before the window's end is not" |
  | drift counted into `count` | digest | "claims `count` 0" |
  | drift always in the body | digest | "only when non-zero" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `digest.test.ts` and `digest-routes.test.ts`, each alone.

### Task DT4: the digest's "Out of step" section, PWA (D-5924; spec §4.5, §4.6) — GATED: after DT3 and skins W3 P4a and P7

**Routing:** band 2. **Lane:** PWA. **Needs:** DT3; the skins W3 plan's P7 (the digest on `PageScaffold`; `DigestScreen.tsx` does not use it yet). P4a (`pwa/src/fleet/inboxTarget.ts`, a record's target) has merged as #701.

**Files:**
- Modify `pwa/src/screens/DigestScreen.tsx` and `pwa/src/screens/digest.css`: a section under the decisions, one row per line: the kind in words, the subject, the age; a tap navigates to the line's target by calling `inboxTarget` with the line adapted to its `NotifyEvent` input (`sessionId`, `runId`): run kinds to `/runs`, session kinds to `/s/<id>`, none with its reason as a quiet word (spec §4.5). No copy of the target rule. No sheet is opened directly and no route is added. No section when `drift` is absent, empty or malformed.
- Create `pwa/src/fleet/driftWords.ts`: the kind → words map, total over `DriftKind`, with a neutral fallback word for a kind this build does not know (a newer server).
- Modify `pwa/src/screens/DigestScreen.tsx` (≈:30, where `asDigestAnswer` lives): `asDigestAnswer` gains a wire guard for `drift` (each line checked with `isDriftKind`-or-unknown, numbers finite; a malformed field drops the section, never the digest).
- Create `pwa/test/digest-drift.test.tsx`; modify `pwa/test/digest-screen.test.tsx` only if a shared fixture moves.

- [ ] **Step 1: Red.** "an answer without `drift` renders no section"; "a malformed `drift` renders no section and the decisions still render"; "each kind reads in words, never its token"; "an unknown kind reads the fallback word"; "a run kind with a known `runId` opens /runs and a session kind opens /s/<id>, both through `inboxTarget`"; "a row is one line: kind, subject, age" (a card is a glance).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | kind token rendered | digest-drift | "reads in words" |
  | no fallback for an unknown kind | digest-drift | "an unknown kind reads the fallback word" |
  | section rendered on absence | digest-drift | "renders no section" |
  | wire guard removed | digest-drift | "a malformed `drift`" |
  | target built without P4a | digest-drift | "a run kind opens /runs" |

- [ ] **Step 4: Per width × skin × mode:** 360, 390, 1280 and 1920 px × refined and instrument × dark and light (16 cells), screenshots in the PR.
- [ ] **Step 5: Verify.** `cd pwa && ./node_modules/.bin/tsc --noEmit`; `digest-drift.test.tsx` and `digest-screen.test.tsx`, each alone.

### Task DT5: held questions and approvals survive a restart (D-5925; spec §5)

**Routing:** band 3, native (the ask lane's deferred push; coordinator-first). **Lane:** server. **Needs:** nothing; rule 6 against #853 on `watch.ts` (re-check line ranges at Step 0).

**Files:**
- Modify `server/src/coord/store.ts`: `heldQuestionRows()` over `asks` in `held` or `answering`, and `heldApprovalRowsByChild()` over main-thread `approvals` rows in state `held` **only** (never `released`: `lapseApproval` records no time or reason, so a pre-restart lapse cannot be told apart), each a result union.
- Modify `server/src/watch.ts`:
  - extract `askHoldPayload(r, hs, dialog, actions)`, a small pure builder of the ask push that `hold()` builds inline today (≈:9136), and call it from `hold()` (a pure move, its own commit);
  - a bounded `pendingReseed` (child id → its newest held `asks` row and the ids of its `held` approval rows), filled on the boot's unprimed tick inside `detectDialogs` (≈:2446), before `sweepApprovals` (≈:2519) runs on that tick (older held ask rows of the same child settled `stale` at once); the snapshot's approval ids re-seed whatever state a later tick finds them in;
  - in `detectDialogs`, on every tick and before `tryHold` or the same-dialog branch runs for a child in `pendingReseed`: on a **measured** pane painting the row's `dialogId` whose hookstate ask hashes to the row's `askKey`, re-stamp `askAt` through `restampAsk`, re-seed `heldAsks` (`until = askNotifyAt(at)`, `answeringSince = null`, `ev = askHoldPayload(…)`), set `dialogIds`, and drop the entry; on a measured pane painting a permission prompt, re-seed `heldApprovals` from the child's snapshot ids (spec §5.3); on a measured pane painting no dialog or another, settle the ask row `stale` through `staleAsk`, drop the entry and continue as today; on an unmeasured pane, leave it; on a child measured absent from the registry, settle and drop;
  - correct the `heldAsks` and `heldApprovals` docstrings to say what a restart does now, keeping D-2169's reason.
- Create `server/test/ask-restart.test.ts`.

- [ ] **Step 0: Re-ground** `detectDialogs`' two branches, `restampAsk`'s compare-and-set arguments, `sweepApprovals`' lapse and push order, and the lapse's `releaseReason` word.
- [ ] **Step 1: Red.** "a held row whose dialog is still painted re-seeds and pushes once at `askNotifyAt(at)`"; "a bumped `askAt` with the same dialog and `askKey` still re-seeds and is re-stamped"; "a held row past its deadline at boot pushes on the first primed sweep"; "a measured pane with another dialog settles `stale` and pushes nothing"; "an unmeasured pane leaves the row `held`"; "a pane unmeasured at boot and measured later re-seeds with no second `insertAsk` and no second parent mail"; "no `coord.db`: nothing re-seeded, today's behaviour"; "an `answering` row re-seeds with `answeringSince` null"; "a parent's answer after the re-seed wins as before" (late answer wins, D-5289); "`hold()` and the re-seed build the same payload"; "a permission prompt painted across a restart is pushed once its rows are no longer held"; "a row released and pushed before the restart is not pushed again".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | re-seed without the `dialogId` match | ask-restart | "another dialog settles `stale`" |
  | match requires `askAt` equality | ask-restart | "a bumped `askAt` … still re-seeds" |
  | re-seed only on the boot tick | ask-restart | "measured later re-seeds with no second `insertAsk`" |
  | settle on an unmeasured pane | ask-restart | "leaves the row `held`" |
  | `until` from boot time | ask-restart | "past its deadline at boot pushes" |
  | `answeringSince` kept from nothing | ask-restart | its case |
  | approvals not re-seeded | ask-restart | "a permission prompt painted across a restart" |
  | `released` rows selected at boot | ask-restart | "released and pushed before the restart is not pushed again" |
  | snapshot taken after `sweepApprovals` | ask-restart | "a permission prompt painted across a restart" (a row lapsed on the boot tick is missed) |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `ask-restart.test.ts`, `asks-sweep.test.ts`, `asks-mint.test.ts`, `ask-instance-guard.test.ts` and `approvals-sweep.test.ts` (or the approvals suite Step 0 names), each alone.

### Task DT6: the coordinator's uuid on the claim (D-5926; spec §6.1, §6.3, §6.5) — GATED: after W6 and DT2

**Routing:** band 3, native (the claim's writers). **Lane:** server and PWA (one words entry). **Needs:** the consolidation's W6 merged (`RunBinding`'s key and writers); DT2 (for the new kind); DT4 if merged (its words map gains the kind). #813 has merged.

**Files:** (re-measured against W6's merge; the names below are today's)
- Modify `server/src/coord/schema.ts`: one additive migration, `ALTER TABLE runs ADD COLUMN claimedByUuid TEXT` (NULL: never stored).
- Modify `server/src/coord/openRun.ts` and the binding's writer W6 leaves for it: store the uuid the `attribution` rung checked (NULL on an unattributed open).
- Modify `server/src/coord/reclaim.ts` and `CoordStore.reclaimProgram`: the heir's uuid, measured from the registry (`<to>.uuid`) inside the existing ladder, written in the existing transaction; an unmeasurable uuid writes NULL and refuses nothing new.
- Modify `shared/api.ts` (`DRIFT_KIND_MAP` gains `claimant-revived`), `server/src/coord/drift.ts` (a dead claimant whose stored uuid is listed under another live id; key `claimant-revived:<program>:<heir>`; `runId` the programme's newest open run; and the pure `claimantContinuity(stored, caller)` that DT7's door will share), and the lane's daily record of the 30-day rule's denominator (open programmes with a non-null `claimedByUuid`, in the pass's summary detail; no new table), and, if DT4 has merged, `pwa/src/fleet/driftWords.ts` (its words; a run kind, so its target is `/runs`).
- Modify the spec's §4.2 `parent-mismatch` row if W6 retired or moved that kind (W6's exit owns the move).
- Create `server/test/claimant-uuid.test.ts`; modify `server/test/drift-findings.test.ts`; modify `pwa/test/digest-drift.test.tsx` if DT4 has merged.

- [ ] **Step 1: Red.** "an attributed open stores the uuid"; "an unattributed open stores NULL"; "a reclaim stores the heir's registry uuid, and a body `claimedByUuid` is ignored"; "a swap (same id) changes nothing"; "`claimant-revived` fires when the stored uuid is listed under another live id, and never on NULL"; "`claimantContinuity`: swap `same`, new id with the stored uuid `revived`, NULL stored `other`"; "the denominator counts only programmes with a non-null `claimedByUuid`"; "the migration is additive (an older build reads the file)"; and, with DT4 merged, "`claimant-revived` reads in words".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | uuid taken from the body | claimant-uuid | "a body `claimedByUuid` is ignored" |
  | NULL matches NULL | drift-findings | "never on NULL" |
  | reclaim leaves the old uuid | claimant-uuid | "stores the heir's registry uuid" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `claimant-uuid.test.ts`, `drift-findings.test.ts`, `coord-reclaim.test.ts`, `reclaim-route.test.ts` and `open-run-preconditions.test.ts`, each alone; with DT4 merged, `pwa` `tsc --noEmit` and `digest-drift.test.tsx`.

### Task DT7: `claimant-revived`, the door refinement (D-5927; spec §6.2, §6.4) — GATED: after DT6 and the 30-day rule

**Routing:** band 3, native (the programme claim's door). **Lane:** server. **Needs:** DT6 deployed; **the 30-day rule:** the 30 days start on the first day the reconciler measures at least 5 open programmes with a non-null `claimedByUuid` (the floor); build DT7 only if at least one `claimant-revived` finding is recorded in those 30 days. With none, the coordinator closes #761's remainder as not needed and records the count **with its denominator** in the ledger, keeping DT6's column. If the floor is never reached, the remainder stays open and the ledger says why. **Scope:** `openRun` only; the asks and approvals doors are out (spec §6.2: their rows hold no uuid, `asks.runId` is nullable provenance, and their 180 s and 60 s windows leave no measured case).

**Files:**
- Modify `server/src/coord/openRun.ts` (and `CoordStore`'s `claimed-by-another` refusal it reads): call DT6's `claimantContinuity` (`coord/drift.ts`) with the run row's `claimedByUuid`; on `revived`, answer `409 claimant-revived` with a detail naming the reclaim.
- No push from the door: the reconciler's `claimant-revived` finding (DT6) is the one push. No PWA file: the push and the digest line already open `/runs` (DT4).
- Modify `shared/api.ts`: the additive error code and detail type.
- Create `server/test/claimant-revived.test.ts`.

- [ ] **Step 1: Red.** "a matching uuid under a new id answers `409 claimant-revived` and moves nothing"; "a different uuid keeps today's refusal byte-identical"; "the success path's response is byte-identical"; "a swap reads `same`"; "a NULL stored uuid is `other` and keeps today's refusal"; "the door sends no push".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `revived` reclaims | claimant-revived | "moves nothing" |
  | `revived` on the success path | claimant-revived | "byte-identical" |
  | ids compared, uuid ignored | claimant-revived | "a different uuid keeps today's refusal" |
  | NULL matches a NULL caller uuid | claimant-revived | "a NULL stored uuid is `other`" |
  | the door pushes | claimant-revived | "the door sends no push" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `claimant-revived.test.ts`, `box-token-census.test.ts`, `open-run-preconditions.test.ts` and `coord-reclaim.test.ts`, each alone. `routes.ts`, the asks and the approvals suites are untouched (no edit there).

## Operator acts

None in this plan. The ledger's OA-D2 (arm the `busy` mail gate) and OA-D6 (arm the dead-coordinator lane) are the operator's, after their shadow reviews; DT2's `claimant-gone` findings are evidence for OA-D6's review.

## Rollback

Each task is a plain revert. DT2's and DT6's migrations are additive: a revert leaves an unused table or column. DT3's field is additive: an older PWA ignores it. DT5's revert restores today's restart behaviour (a held question waits for its parent).

## Deviations and decisions

### Issued for this work and defined here

This programme's block is D-5920 to 5929. This plan defines D-5920 to D-5927, one per task. 5928 and 5929 are issued and unused, written without the prefix so they seed no floor.

- **D-5920** — `durability-ledger-order` (Task DT0; spec §3): the epic's build order is D1 → D3 → D2 → D4 → D5, then D7; D6 and D8 are recorded as inputs to the consolidation's W6 `RunBinding`, not built beside it; arming the `busy` gate (D2) and the dead-coordinator lane (D6) are the operator's acts after their shadow reviews.
- **D-5921** — `drift-decider-pure` (Task DT1; spec §4.1, §4.2): drift is decided by one pure L1 function over plain rows with seven kinds in one L0 map; liveness is the reclaim ladder's verdict, typed through `deadCoordinator.ts`'s L1 `ClaimantReading` so the decider imports no IO, and `unmeasurable` is never a `claimant-gone`; `run-quiet` covers active runs only; the mail kinds read D1's park columns (#853).
- **D-5922** — `drift-lane-records-and-pushes-once` (Task DT2; spec §4.1, §4.3 to §4.5): a separate 15-minute lane, not a stall arm, records findings in `drift_findings` (cleared only by re-measurement), and pushes once per finding past 24 h, once-only held by its own `pushedAt` column and the push sent through W1a's `notify` funnel (C1c), bounded by a first-pass summary, 3 per pass and 12 per UTC day counted from the table, the daily count over per-item pushes only (`pushedVia`), with live-stall-overlap, armed-dead-coordinator and D1-escalation suppression, and a `url` (and a run kind's `runId`) on every push; it runs as one W1b `LANE_SCHEDULE` row and acts through no door.
- **D-5923** — `digest-drift-additive` (Task DT3; spec §4.6): the digest carries the findings open at its window's end as an additive `drift` field; the day's claim and `count` are unchanged.
- **D-5924** — `digest-out-of-step-section` (Task DT4; spec §4.6): the digest screen's "Out of step" rows are glances that open their target through the skins plan's P4a model (`/runs` or `/s/<id>`), never a sheet directly and never a new route.
- **D-5925** — `held-question-reseed` (Task DT5; spec §5): held and lapsed-ask state stays in the `asks` and `approvals` tables with no new column; the boot's unprimed tick fills a bounded pending set that every tick consumes before `tryHold`, re-seeding `heldAsks` (matched on `dialogId` and `askKey`, `askAt` re-stamped) and `heldApprovals` (by child, from a boot snapshot of `held` rows only, never `released` ones) on a measured matching pane, settling `stale` on a measured mismatch and leaving the row on doubt; D-2169's in-memory carrier stands.
- **D-5926** — `claimant-uuid-on-claim` (Task DT6; spec §6.1, §6.3): the coordinator's uuid is stored beside `runs.claimedBy`, not in the worker's incarnation key, by the claim's existing writers; the heir's uuid is measured from the registry at reclaim; queued mail keeps moving through `reclaimProgram` unchanged.
- **D-5927** — `claimant-revived-offer` (Task DT7; spec §6.2, §6.5): `openRun`'s `claimed-by-another` is refined to `409 claimant-revived` through the L1 `claimantContinuity` in `coord/drift.ts`; the asks and approvals doors are not refined (no stored uuid, no measured case); the door pushes nothing (the reconciler's `claimant-revived` finding is the one push); built only if a revival is recorded within 30 days that start once 5 open programmes carry a stored uuid, with the denominator recorded beside the count.

**Issued and unused** (Task DT1's spares, without the prefix): 6014, 6015.

## Out of scope

D1 to D5 (their own specs); D6's design (W6's `bindingOf`); the consolidation's waves themselves; arming any lane or gate; auto-acting on a finding; a "resolve" button on a finding; changing the stall watch's arms or the digest's correction door.

## Review log

One review of rev 0 (`f4caa45eb`), applied in rev 1. Each finding was re-checked against `origin/main` `0843cbc9a`, #821's diff and the consolidation branch.

| # | Sev | Finding | Checked | Outcome |
|---|---|---|---|---|
| 1 | high | #821 (D1) redefines parked mail (`queued` + `parkedAt`, gate `'parked'`, its own push, migration 27); `mail-parked`/`mail-held` and the gates table were wrong against it | #821's diff: migration 27, `parkEscalatedAt`, `gated(d, 'parked')` | Applied: DT1 and DT2 gated on #821; `mail-parked` = queued with `parkedAt` > 1 h; parked rows excluded from `mail-held`; terminal `rejected` dropped; `parkEscalatedAt` suppresses the lane's push; slot after 27 (spec §4.2, §4.4; Gates) |
| 2 | high | W1a's funnel never dedupes itself (C1f, D-5860, gated on OA-C3); once-only, the summary marking and the daily cap were unspecified | W1a plan C1f and D-5860 | Applied: `drift_findings.pushedAt` with `markDriftPushed`'s compare-and-set is the authority; the daily cap counts from it; the summary marks a column, not feed rows; kind `'coord'`, `sessionId` `''`; DT2 needs C1c only (spec §4.3, §4.4; DT2) |
| 3 | medium | The consolidation spec was cited as rev 1, not ruled | branch header: rev 2.1, rev 2 approved 2026-10-19 | Applied: cited rev 2.1; the false dependency risk dropped; the residual is W6's own gates |
| 4 | medium | DT5 matched on the drifting `askAt` | `restampAsk(dialogId, askKey, askAt)`, D-2403 | Applied: match on `dialogId` + `askKey`, re-stamp through `restampAsk`; test and mutant added (spec §5.2; DT5) |
| 5 | medium | Re-seed ran only on the boot tick; a pane measured later would mint a second row through `tryHold` | `detectDialogs`' `last !== dialog.id` branch | Applied: a bounded pending set consumed by every tick before `tryHold`; test for no second `insertAsk` or parent mail (spec §5.2; DT5) |
| 6 | medium | "Approvals degrade to an early push" is false: the unprimed tick stamps `dialogIds` and the same-dialog branch never raises | `detectDialogs(this.primed, …)`; `heldApprovals` the only carrier | Applied: §1.2 corrected; `heldApprovals` re-seeded by child (spec §5.3); `question-orphaned`'s approval arm redefined; test added |
| 7 | medium | DT1 invented a liveness vocabulary beside `ClaimantVerdict` | `coord/reclaim.ts` `ClaimantVerdict`, `measureClaimant` | Applied: `DriftInput` carries `ClaimantVerdict`; `claimant-gone` on `dead` with its cause; no "archived" verdict |
| 8 | medium | `run-quiet` counted observation rows; `review-waiting` keyed on a `causedBy` that is never the claimant id | `insertStallObservation`; `recordRunEvent(id, 'coordinator', …)` | Applied: act rows only; `review-waiting` from the transition plus no claimant mail naming the run; fixtures added |
| 9 | medium | Two of DT7's four doors have no claimant refusal; the asks door's refusal is `403 not-parent` | `POST /api/mail` refusal list; `/intent` body; `routes.ts` `not-parent` | Applied: DT7 = `openRun` (409 refinement) + asks and approvals (403 kept, additive detail); `/api/mail` and `/intent` dropped (spec §6.2) |
| 10 | medium | Remedy deep links open sheets no route reaches; P4a owns a record's target | `ResumeSheet` mounted from `RunsScreen` state only; P4a `inboxTarget.ts` | Applied: targets through P4a (`/runs`, `/s/<id>`); DT4 gated on P4a; the heir pre-fill dropped, and DT7's offer is the reconciler's push to `/runs` (spec §4.5, §6.2) |
| 11 | low | DT6's new kind touched no PWA file; `asDigestAnswer` passes a malformed `drift` through | `asDigestAnswer` spreads the answer | Applied: DT4 adds the wire guard, `driftWords.ts` and an unknown-kind fallback; DT6 adds the words entry and its test when DT4 has merged |
| 12 | low | DT2 before W1b would be a clock outside W1b's census; no off switch | W1b's clock census; W1a's `SWITCHES` | Applied in part: DT2 gated on W1b, one `LANE_SCHEDULE` row. **Rejected:** a mute switch — the budget bounds pushes at 12 a day, and a new switch is a new `SWITCHES` row nobody asked for; recorded as an operator default (spec §10) |
| 13 | low | #813 merged; base stale | `ee6154dc7` on main | Applied: base `0843cbc9a`, #813 marked merged, #821 added, gates re-measured |
| 14 | low | "One sweep" is no constant; an `answering` row may run 60 s past its deadline | `ASK_SWEEP_MS` 10 s, `ASK_ANSWERING_MAX_MS` 60 s | Applied: `DRIFT_ASK_MARGIN_MS` (20 s), plus `ASK_ANSWERING_MAX_MS` for `answering` rows; both tested |
| 15 | low | `hold()` builds its payload inline; there is no builder to reuse | `watch.ts` ≈:9136 | Applied: DT5 extracts `askHoldPayload` as a pure move, with an equality test |
| 16 | low | `parent-mismatch` reads `parentOfSession`, which W6 shrinks into `bindingOf` | consolidation K10, W6 | Applied: W6's exit moves `parent-mismatch` onto `bindingOf` or retires it (spec §4.2, §7; DT6) |


### Rev 2

A second review of rev 1 (`1e9199eb9`, PR #827), applied in rev 2. Each finding was re-checked against `origin/main` `643c76cd4`.

| # | Sev | Finding | Checked | Outcome |
|---|---|---|---|---|
| 1 | medium | The approvals re-seed selected rows "released by the lapse while the server had no entry", which cannot be measured; a pre-restart lapse already pushed would push again | `lapseApproval` (`store.ts` ≈:7590): `UPDATE … SET state='released'`, no time, no reason; `detectDialogs` ≈:2446 runs before `sweepApprovals` ≈:2519 | Applied: a boot-tick snapshot of `held` main-thread rows by id, taken inside `detectDialogs`; `released` rows are never selected; `question-orphaned`'s approval arm is redefined on the snapshot; red test and two mutants (spec §4.2, §5.3; DT1, DT5) |
| 2 | medium | The first-pass summary's markings spend the 12/day budget, or the exclusion is unimplementable | no column records the summary | Applied: `drift_findings.pushedVia` (`'item'`/`'summary'`), written by `markDriftPushed`; `driftPushesOnDay` counts `'item'` only; red test "a first-pass summary over 30 old findings leaves today's per-item budget at 12" and its mutant (spec §4.3, §4.4; DT2) |
| 3 | medium | Pushes and digest lines carry no `runId` or `url`, so `inboxTarget` answers `none` for run kinds and the service worker opens `/` | `inboxTarget(ev, …)` reads `eventRunId(ev)`; `NotifyEvent.runId`; `push-sw.js` ≈:149 | Applied: findings and `DriftLine` carry `runId` (the programme's newest open run for `claimant-gone`/`claimant-revived`) and `sessionId`; every push carries `url` (`/runs`, `/s/<id>`, the digest path for the summary); DT4 adapts the line to `inboxTarget`'s input; tests and mutants (spec §4.4 to §4.6; DT1 to DT4) |
| 4 | medium | `run-quiet` covered `planned` runs and double-fired with `review-waiting` on `awaiting-review` | `ACTIVE_RUN_STATES` (`shared/api.ts` ≈:4851) = `dispatched`, `working`, `unknown` | Applied: `run-quiet` over `ACTIVE_RUN_STATES` only; tests "a `planned` run is no finding" and "`awaiting-review` is `review-waiting` only", a mutant each (spec §4.2; DT1) |
| 5 | medium | Stall suppression fired on shadow observations the operator never received | `parseStallDetail` (`stall.ts` ≈:169-175) reads `stall:` and `stall-shadow:` into `mode` | Applied: suppress only on mode `'live'` at the arm's operator rung; red test and mutant (spec §4.4; DT2) |
| 6 | medium | DT7's asks and approvals doors had no source for the stored uuid and almost no reachable case; DT7 did not run the approvals suite | `routes.ts` ≈:3950, ≈:4543, ≈:4628 refuse on `parentId`; `asks.runId` nullable provenance (`schema.ts` ≈:819); `ASK_GRACE_MS` 180 s, `APPROVAL_COUNTDOWN_WINDOW_MS` 60 s | Applied by the first option: DT7 cut to `openRun` alone, the reason recorded (spec §6.2); `routes.ts` and its suites untouched, so no approvals suite to add; a NULL-stored test added |
| 7 | low | `drift.ts` (L1) imported `ClaimantVerdict` from IO-importing `coord/reclaim.ts`; `claimantContinuity` was "pure L1" in that file | `deadCoordinator.ts` ≈:49-53 exports `ClaimantReading`, `ClaimantDeadCause` | Applied: `drift.ts` imports them from `deadCoordinator.ts`; `claimantContinuity` moves to `coord/drift.ts` (built in DT6, used by DT7); an import-scan test (spec §4.1, §6.2; DT1, DT6) |
| 8 | low | "No store writer but `recordDriftPass` and `markDriftPushed`" cannot hold: the funnel archives through `recordFeedEvent` | W1a plan C1c: the funnel prints and archives through `recordFeedEvent` | Applied: the funnel's archive write is the one named exception, asserted as coming from inside `notify` (spec §9; DT2, Global constraints, Review focus) |
| 9 | low | `asDigestAnswer` is in `DigestScreen.tsx`; P4a has merged, P7 has not | `DigestScreen.tsx` ≈:30; `inboxTarget.ts` on `main` (#701); no `PageScaffold` in `DigestScreen.tsx` | Applied: DT4 edits the guard in `DigestScreen.tsx`; P4a marked merged; DT4 gated on P7 only |
| 10 | low | Stale citations: base, the consolidation spec and W1a plan now on `main`, #833 missing, PR already open | `git log origin/main`; `gh pr view 833`: `server/src/coord/store.ts` | Applied: rebased on `643c76cd4`; consolidation spec and W1a plan cited on `main` (#819); `CLAUDE.md` #818 cited; #833 in the gates (line-disjoint); "not pushed" no longer claimed |
| 11 | low | One dead claimant gave two operator notices (the dead-coordinator lane and `claimant-gone`) | `deadCoordinator.ts` ≈:18-23: in shadow the lane writes a feed row and an attention entry, no push; `deadCoordinatorLaneArmed` ≈:136 | Applied, a rule chosen: while the lane is shadow both are kept (its record is OA-D6's evidence, the drift push is the only ping); once armed, `claimant-gone` is listed, not pushed; tested both ways (spec §4.4; DT2) |
| 12 | low | The 30-day rule could close #761 on a measurement blind to pre-DT6 rows | rows before DT6 read `claimedByUuid` NULL | Applied: the 30 days start once 5 open programmes carry a stored uuid; the denominator is recorded beside the count; floor never reached keeps the remainder open (spec §6.5; DT6, DT7) |

### Rev 2.1

A third pass over rev 2 found every finding of the second review already applied (each row above re-checked in the text). Only the gates moved: `main` advanced to `4c3f5ac95` (merged in, no conflict, no `D-5920` to `D-5929` collision); #821 closed and was recut unchanged as #853, so every live reference names #853; #833 merged; #846 (imports and comments only), #850 (a migration of its own), #848 and #832 are added to the gates table, each re-measured at its task's Step 0.
