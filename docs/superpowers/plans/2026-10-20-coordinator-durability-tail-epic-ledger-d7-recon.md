# Coordinator durability, the tail: the programme ledger, the drift reconciler (D7) and the claimant's uuid (D8) — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Workers do not edit §Deviations and decisions. Vitest only as `./node_modules/.bin/vitest run <file> --maxWorkers=2`, one suite at a time.

**Spec:** `docs/superpowers/specs/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md` (rev 0). Its §3 to §9 bind this plan in full.

**Status:** rev 0 (2026-10-20), approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision.

**Issues:** #752 (epic), #760 (D7), #761 (D8). **Ledger:** `docs/superpowers/programs/coordinator-durability.md`.

**Inputs.** The consolidation spec (`2026-10-19-ccrc-consolidation-wave-design.md`, rev 1 on `docs/consolidation-wave-spec`): C5, C6; K5, K6, K10, K11, K12; waves W1a (§5.3), W1b (§5.4), W3 (§5.6), W6 (§5.9) and its rules (§5.1). Coordinator-first routing (D-5300's digest; `coord/heldFor.ts`). The stall watch (`coord/stall.ts`). The skins W3 screens plan's Task P7 (`DigestScreen.tsx` on the scaffold).

**Base:** `origin/main` `4bc6c756d`. Anchors: `sweepDigest` `server/src/watch.ts` ≈:8891; `sweepAsks` ≈:8649; `heldAsks` ≈:796; `primed` ≈:1327; `hold()` ≈:9093; `LEDGER_RECONCILE_SWEEP_MS` ≈:414; `buildDigest` `server/src/coord/digest.ts` ≈:106; `parentOfSession` `server/src/coord/store.ts` ≈:6940; `reclaimProgram` ≈:1975; `openRun`'s `attribution` rung `server/src/coord/openRun.ts` ≈:300; `askNotifyAt` `server/src/askwindow.ts` ≈:54; `DigestAnswer` `shared/api.ts` ≈:11578; the `asks` table `server/src/coord/schema.ts` ≈:814; `COORD_SCHEMA_VERSION` ≈:1722 (26 migrations on the base, re-measure the slot).

**Deploy class.** DT1 to DT3, DT5 to DT7: server lane. DT4: PWA (served by the server). No fleet-box change, no `ccd` change, no restart of any session.

**Names.** Tasks **DT0** to **DT7**.

---

## Gates

Measured on 2026-10-20 with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` against `4bc6c756d`. Open PRs touching this plan's files: **#813** (`server/src/coord/openRun.ts`, a tracker-id scrub of comments) and **#737** (`server/test/single-definition.test.ts`). No open PR touches `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts`, `server/src/coord/digest.ts`, `server/src/coord/reclaim.ts`, `server/src/coord/routes.ts`, `shared/api.ts` or `pwa/src/screens/DigestScreen.tsx`. #397, #436 and #762 merged on 2026-10-19.

| Task | Open PRs | Consolidation wave | Other |
|---|---|---|---|
| DT0 docs (this plan, the spec, the ledger) | — | — | — |
| DT1 drift decider | #737 only if DT1 edits `single-definition.test.ts` (it should not) | — | — |
| DT2 reconciler lane, table, pushes | — | **W1a merged** (the funnel and `dedupeKey`); W1b's `LANE_SCHEDULE` if merged, else the throttle pattern | DT1 |
| DT3 digest, server | — | — | DT2 |
| DT4 digest, PWA | — | — | DT3; skins W3 **P7** merged |
| DT5 held questions across a restart | — | none; a W3 series open on `watch.ts` rebases onto DT5 (rule 6) | — |
| DT6 claimant uuid column | **#813** merged or line-disjoint | **W6 merged** | DT2 (for the `claimant-revived` kind) |
| DT7 `claimant-revived` door refinement | — | W6 | DT6; **the 30-day rule** (§DT7) |

## Landing order

```
DT0 (docs)
DT1 (decider) ──[W1a]── DT2 (lane, table, pushes) ── DT3 (digest server) ──[skins P7]── DT4 (digest PWA)
DT5 (held questions across a restart)                      (independent)
[W6] ── DT6 (claimant uuid; the revived count) ──[30 days, ≥ 1 finding]── DT7 (door refinement)   or close #761's remainder
```

## Global constraints

- **The reconciler never acts.** It reads, records `drift_findings`, and pushes through the funnel. It never mails a session, never calls a door, never closes, abandons, reclaims, re-dispatches or restarts (#760's "must not").
- **No claim moves implicitly** (#761). `claimant-revived` refines a refusal and offers; only the operator's confirmed reclaim moves a claim.
- **Account switching and the auto-swap are never blocked; no herd restarts; hibernation's contract; coordinator-first routing's hold rule; the ccrc SAFETY rules.** Nothing here writes a marker, a unit or a pane.
- **No new arming marker** (the consolidation's K12).
- **Wire additive, absence-permits.** `DigestAnswer.drift` and the `409 claimant-revived` code are additive; `FLEET_PROTO` is not bumped.
- **D-2169 stands.** The held-question carrier stays in memory; DT5 only re-seeds it from rows.
- **Migrations are additive and append-only.** Re-measure the slot before the PR and before merge: `git fetch origin main && git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`.
- **Public repo.** Fixtures use `lane-a`, `project-a` and neutral session ids; finding details pass `redactCommand`.
- **Operator acts OA-D2 and OA-D6** (the ledger) are not tasks here and no task assumes them.

## Review focus

1. **A reconciler that acts.** Any store writer other than `recordDriftPass` reachable from the lane; any door called (DT2).
2. **A push storm.** The first-pass summary, 3 per pass, 12 per day, the funnel's `dedupeKey` across a restart, and the stall-overlap suppression (DT2).
3. **An unmeasurable registry read as gone.** `claimant-gone` only on a measured archived, stopped or absent verdict (DT1).
4. **A settle on doubt.** DT5 settles a held row `stale` only on a measured pane that paints no dialog or another one.
5. **A claim that moves without the operator.** DT7's doors keep refusing on `revived`; the success paths are byte-unchanged.
6. **A uuid from the body.** DT6's reclaim writes the heir's uuid measured from the registry, never from the request.

## Tasks

### Task DT0: the spec, this plan and the programme ledger (D-5920)

**Routing:** native (docs). **Lane:** none.

**Files:**
- Create `docs/superpowers/specs/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md`.
- Create `docs/superpowers/plans/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon.md`.
- Create `docs/superpowers/programs/coordinator-durability.md`.

- [ ] **Step 1: Verify.** From `server/`: `git fetch -q origin main`, then `deviation-refs`, `dtbd`, `topology-clean`, `single-definition` and `docs-grammar`, each alone.

### Task DT1: the drift decider (D-5921; spec §4.1, §4.2)

**Routing:** band 2 (a pure decider over fixtures, fully specified). **Lane:** server. **Needs:** nothing.

**Files:**
- Modify `shared/api.ts`: `DRIFT_KIND_MAP` (`run-quiet`, `claimant-gone`, `mail-parked`, `mail-held`, `parent-mismatch`, `review-waiting`, `question-orphaned`), `DriftKind`, `DRIFT_KINDS = Object.keys(DRIFT_KIND_MAP)`, `isDriftKind`, and `DriftFinding { key, kind, subject, detail, factAt }`.
- Create `server/src/coord/drift.ts`: `driftFindings(input: DriftInput, now: number): DriftFinding[]`, pure, and the thresholds `RUN_QUIET_MS` (72 h), `MAIL_DRIFT_MS` (1 h), `REVIEW_WAITING_MS` (24 h), `DRIFT_PUSH_AGE_MS` (24 h). `DriftInput` is plain rows: open runs with their last event `at`; each claimant's measured registry verdict (`live | archived | stopped | absent | unknown`); outstanding deliveries with `state`, `lastGate`, `gateSince`, `deliveredAt`, the recipient's verdict; each worker's `ChildMark` run id beside `parentOfSession`'s answer and that run's `claimedBy`; awaiting-review runs with the claimant's last act; held `asks` rows (`at`) and `approvals` rows (`notifyAt`). Imports L0 and `askNotifyAt` only.
- Modify `server/src/coord/store.ts`: the read methods the watcher needs, each a `{ ok: true, rows } | { ok: false, detail }` union (no overloaded null): `driftOpenRuns()`, `driftOutstandingDeliveries()`, `driftAwaitingReview()`, `driftHeldQuestions()`.
- Create `server/test/drift-findings.test.ts`.

- [ ] **Step 1: Red.** Per kind, "fires one past its threshold" and "does not fire one under it"; "an `unknown` registry verdict is no `claimant-gone`"; "a swapped session (same id, same uuid, live) is no finding of any kind"; "a parked delivery to a dead recipient is not `mail-parked`"; "`parent-mismatch` names the worker, not the run"; "`question-orphaned` fires one sweep past `askNotifyAt(at)` and not before"; "keys are stable across two calls on the same input"; "`factAt` is the fact's own time where it has one"; and the investigation's cases as fixtures: "a weeks-old open run", "an archived claimant", "an absent claimant", "a 27 h held delivery", "a parked delivery to a live worker", "the reused-name parent mismatch (#746)", "an 18-day awaiting-review run", "a held ask after a restart".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `unknown` treated as absent | drift-findings | "an `unknown` registry verdict is no `claimant-gone`" |
  | `RUN_QUIET_MS` 24 h | drift-findings | `run-quiet` "does not fire one under it" |
  | the recipient's liveness check removed | drift-findings | "a parked delivery to a dead recipient" |
  | key built with `now` | drift-findings | "keys are stable" |
  | `factAt` always null | drift-findings | "`factAt` is the fact's own time" |
  | `question-orphaned` at the deadline, not one sweep past | drift-findings | its case |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `drift-findings.test.ts` alone; `single-definition.test.ts` alone (one home for `DRIFT_KIND_MAP`).

### Task DT2: the reconciler lane, `drift_findings` and the push budget (D-5922; spec §4.3 to §4.5) — GATED: after W1a and DT1

**Routing:** band 3, native (a new lane on the watcher; push volume to the operator). **Lane:** server. **Needs:** DT1; the consolidation's W1a merged (`notify(event, mode)` and the notice `dedupeKey`).

**Files:**
- Modify `server/src/coord/schema.ts`: one additive migration, `drift_findings` (spec §4.3) and `drift_findings_open`.
- Modify `server/src/coord/store.ts`: `recordDriftPass(findings, now)` (one transaction: upsert, clear, prune cleared rows older than 30 days), `openDriftFindings()`, `driftFindingsOpenAt(ms)`.
- Modify `server/src/watch.ts`: `sweepDrift(records, names)`, a 15-minute pass (`DRIFT_SWEEP_MS = 900_000`, a `LANE_SCHEDULE` row if W1b has merged, else the monotonic throttle pattern): gather `DriftInput`, call `driftFindings`, `recordDriftPass`, then pushes through `notify` mode `push` with `dedupeKey = 'drift:' + key` for findings whose age first passes `DRIFT_PUSH_AGE_MS`, bounded: one summary push on a pass that finds the table empty (every finding older than 24 h marked pushed without its own), at most 3 per pass and 12 per UTC day; no push for `question-orphaned`; no push where the subject already carries a stall operator-rung observation (`parseStallDetail`). Never throws: one bad read warns once and the next pass retries.
- Create `server/test/drift-lane.test.ts`.

- [ ] **Step 1: Red.** "a pass records found keys and clears the rest"; "a cleared row older than 30 days is pruned"; "the first pass sends one summary push and no per-item push"; "4 crossings in one pass push 3, the 4th next pass"; "13 crossings in a day push 12"; "a restart re-finds a key and does not push it again"; "a stall rung-3 observation on the run suppresses `run-quiet`'s push"; "`question-orphaned` never pushes"; "the lane calls no store writer but `recordDriftPass` and mails nothing" (a spy over every `CoordStore` writer and the mail queue); "an unreadable registry listing records nothing and clears nothing".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | no first-pass summary | drift-lane | "the first pass sends one summary push" |
  | per-pass cap removed | drift-lane | "4 crossings … push 3" |
  | `dedupeKey` omitted | drift-lane | "does not push it again" |
  | stall suppression removed | drift-lane | its case |
  | clear on an unreadable listing | drift-lane | "records nothing and clears nothing" |
  | the lane queues a mail | drift-lane | "mails nothing" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `drift-lane.test.ts`, `mail-hardening.test.ts`, `stall-sweep.test.ts` and `single-definition.test.ts`, each alone.

### Task DT3: the digest's drift section, server (D-5923; spec §4.6) — GATED: after DT2

**Routing:** band 2. **Lane:** server. **Needs:** DT2.

**Files:**
- Modify `shared/api.ts`: `DigestAnswer.drift?: { totals: Record<DriftKind, number>; lines: readonly DriftLine[] }` and `DriftLine { key, kind, subject, detail, ageMs, remedy }` (`remedy` names the place: `run`, `resume`, `archive`, `mail`); `v` stays 1.
- Modify `server/src/coord/digest.ts`: `buildDigest` reads `driftFindingsOpenAt(toMs)` and fills `drift`; `digestPushCopy` names the drift count only when non-zero.
- Modify `server/test/digest.test.ts`; modify `server/test/digest-routes.test.ts`.

- [ ] **Step 1: Red.** "a finding open at the window's end is a line"; "a finding cleared before the window's end is not"; "a zero-decision day with drift claims `count` 0 and sends no digest push"; "the push body names drift only when non-zero"; "the route's answer carries `drift`, and an answer without it parses on the old reader".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | open-at test uses `firstSeenAt` only | digest | "cleared before the window's end is not" |
  | drift counted into `count` | digest | "claims `count` 0" |
  | drift always in the body | digest | "only when non-zero" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `digest.test.ts` and `digest-routes.test.ts`, each alone.

### Task DT4: the digest's "Out of step" section, PWA (D-5924; spec §4.6) — GATED: after DT3 and skins W3 P7

**Routing:** band 2. **Lane:** PWA. **Needs:** DT3; the skins W3 plan's P7 (the digest on `PageScaffold`).

**Files:**
- Modify `pwa/src/screens/DigestScreen.tsx` and `pwa/src/screens/digest.css`: a section under the decisions, one row per line: the kind in words, the subject, the age; a tap opens the remedy's sheet (`ResumeSheet` for `resume`, the run sheet for `run`, the archive sheet for `archive`, the mail screen for `mail`). No section when `drift` is absent or empty.
- Create `pwa/test/digest-drift.test.tsx`; modify `pwa/test/digest-screen.test.tsx` only if a shared fixture moves.

- [ ] **Step 1: Red.** "an answer without `drift` renders no section"; "each kind reads in words, never its token"; "a row opens its remedy"; "a row is one line: kind, subject, age" (a card is a glance).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | kind token rendered | digest-drift | "reads in words" |
  | section rendered on absence | digest-drift | "renders no section" |

- [ ] **Step 4: Per width × skin × mode:** 360, 390, 1280 and 1920 px × refined and instrument × dark and light (16 cells), screenshots in the PR.
- [ ] **Step 5: Verify.** `cd pwa && ./node_modules/.bin/tsc --noEmit`; `digest-drift.test.tsx` and `digest-screen.test.tsx`, each alone.

### Task DT5: held questions survive a restart (D-5925; spec §5)

**Routing:** band 3, native (the ask lane's deferred push; coordinator-first). **Lane:** server. **Needs:** nothing.

**Files:**
- Modify `server/src/coord/store.ts`: `heldQuestionRows()` over `asks` in `held` or `answering`, a result union.
- Modify `server/src/watch.ts`: in the boot's unprimed tick, after `detectDialogs` has measured every pane: for each held row whose child is measured painting the same `dialogId` with the same `askAt`, re-seed `heldAsks` (`until = askNotifyAt(at)`, `answeringSince = null`, the payload rebuilt by the same builder `hold()` uses, from this sighting); a measured pane painting no dialog or another settles the row `stale` through the existing `staleAsk`; an unmeasured pane leaves the row. `heldAsks`' docstring gains one sentence naming the re-seed and D-2169's unchanged reason.
- Create `server/test/ask-restart.test.ts`.

- [ ] **Step 1: Red.** "a held row whose dialog is still painted re-seeds and pushes once at `askNotifyAt(at)`"; "a held row past its deadline at boot pushes on the first primed sweep"; "a measured pane with another dialog settles `stale` and pushes nothing"; "an unmeasured pane leaves the row `held`"; "no `coord.db`: nothing re-seeded, today's behaviour"; "an `answering` row re-seeds with `answeringSince` null"; "a parent's answer after the re-seed wins as before" (late answer wins, D-5289).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | re-seed without the `dialogId` match | ask-restart | "another dialog settles `stale`" |
  | settle on an unmeasured pane | ask-restart | "leaves the row `held`" |
  | `until` from boot time | ask-restart | "past its deadline at boot pushes" |
  | `answeringSince` kept from nothing | ask-restart | its case |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `ask-restart.test.ts`, `asks-sweep.test.ts`, `asks-mint.test.ts` and `ask-instance-guard.test.ts`, each alone.

### Task DT6: the coordinator's uuid on the claim (D-5926; spec §6.1, §6.3, §6.5) — GATED: after W6, DT2 and #813

**Routing:** band 3, native (the claim's writers). **Lane:** server. **Needs:** the consolidation's W6 merged (`RunBinding`'s key and writers); DT2 (for the new kind); #813 merged or line-disjoint in `openRun.ts`.

**Files:** (re-measured against W6's merge; the names below are today's)
- Modify `server/src/coord/schema.ts`: one additive migration, `ALTER TABLE runs ADD COLUMN claimedByUuid TEXT` (NULL: never stored).
- Modify `server/src/coord/openRun.ts` and the binding's writer W6 leaves for it: store the uuid the `attribution` rung checked (NULL on an unattributed open).
- Modify `server/src/coord/reclaim.ts` and `CoordStore.reclaimProgram`: the heir's uuid, measured from the registry (`<to>.uuid`) inside the existing ladder, written in the existing transaction; an unmeasurable uuid writes NULL and refuses nothing new.
- Modify `shared/api.ts` (`DRIFT_KIND_MAP` gains `claimant-revived`) and `server/src/coord/drift.ts` (a `claimant-gone` subject whose stored uuid is listed under another live id).
- Create `server/test/claimant-uuid.test.ts`; modify `server/test/drift-findings.test.ts`.

- [ ] **Step 1: Red.** "an attributed open stores the uuid"; "an unattributed open stores NULL"; "a reclaim stores the heir's registry uuid, and a body `claimedByUuid` is ignored"; "a swap (same id) changes nothing"; "`claimant-revived` fires when the stored uuid is listed under another live id, and never on NULL"; "the migration is additive (an older build reads the file)".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | uuid taken from the body | claimant-uuid | "a body `claimedByUuid` is ignored" |
  | NULL matches NULL | drift-findings | "never on NULL" |
  | reclaim leaves the old uuid | claimant-uuid | "stores the heir's registry uuid" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `claimant-uuid.test.ts`, `drift-findings.test.ts`, `coord-reclaim.test.ts`, `reclaim-route.test.ts` and `open-run-preconditions.test.ts`, each alone.

### Task DT7: `claimant-revived`, the door refinement and the offer (D-5927; spec §6.2, §6.4) — GATED: after DT6 and the 30-day rule

**Routing:** band 3, native (four attributed doors). **Lane:** server. **Needs:** DT6 deployed; **the 30-day rule:** build DT7 only if the reconciler has recorded at least one `claimant-revived` finding in the 30 days after DT6 deployed. With none, the coordinator closes #761's remainder as not needed, records the count in the ledger and keeps DT6's column.

**Files:**
- Modify `server/src/coord/reclaim.ts`: `claimantContinuity(stored, caller): 'same' | 'revived' | 'other'`, pure.
- Modify `server/src/coord/openRun.ts`, `server/src/coord/routes.ts` (`POST /api/mail`, `POST /api/coordinators/:session/intent`, `POST /api/asks/:id/answer`, `POST /api/approvals/:id/rule`): on each existing refusal that a different claimant causes, call `claimantContinuity`; on `revived`, answer `409 claimant-revived` with a detail naming the reclaim, and send one operator push through `notify` (`dedupeKey = 'revived:' + program + ':' + callerId`) opening the programme's `ResumeSheet` with the heir filled in. Success paths unchanged.
- Create `server/test/claimant-revived.test.ts`.

- [ ] **Step 1: Red.** Per door: "a matching uuid under a new id answers `409 claimant-revived` and moves nothing"; "a different uuid keeps today's refusal"; "the success path's response is byte-identical"; "a swap reads `same`"; "one push per programme and heir across repeated calls"; "NULL stored uuid is `other`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `revived` reclaims | claimant-revived | "moves nothing" |
  | `revived` on the success path | claimant-revived | "byte-identical" |
  | ids compared, uuid ignored | claimant-revived | "a different uuid keeps today's refusal" |
  | `dedupeKey` per call | claimant-revived | "one push per programme and heir" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; `claimant-revived.test.ts`, `asks-routes.test.ts`, `box-token-census.test.ts` and `open-run-preconditions.test.ts`, each alone.

## Operator acts

None in this plan. The ledger's OA-D2 (arm the `busy` mail gate) and OA-D6 (arm the dead-coordinator lane) are the operator's, after their shadow reviews; DT2's `claimant-gone` findings are evidence for OA-D6's review.

## Rollback

Each task is a plain revert. DT2's and DT6's migrations are additive: a revert leaves an unused table or column. DT3's field is additive: an older PWA ignores it. DT5's revert restores today's restart behaviour (a held question waits for its parent).

## Deviations and decisions

### Issued for this work and defined here

This programme's block is D-5920 to 5929. This plan defines D-5920 to D-5927, one per task. 5928 and 5929 are issued and unused, written without the prefix so they seed no floor.

- **D-5920** — `durability-ledger-order` (Task DT0; spec §3): the epic's build order is D1 → D3 → D2 → D4 → D5, then D7; D6 and D8 are recorded as inputs to the consolidation's W6 `RunBinding`, not built beside it; arming the `busy` gate (D2) and the dead-coordinator lane (D6) are the operator's acts after their shadow reviews.
- **D-5921** — `drift-decider-pure` (Task DT1; spec §4.1, §4.2): drift is decided by one pure L1 function over plain rows with seven kinds in one L0 map; an unmeasurable registry is never a `claimant-gone`.
- **D-5922** — `drift-lane-records-and-pushes-once` (Task DT2; spec §4.1, §4.3 to §4.5): a separate 15-minute lane, not a stall arm, records findings in `drift_findings` (cleared only by re-measurement), and pushes once per finding past 24 h through W1a's funnel with a `dedupeKey`, bounded by a first-pass summary, 3 per pass and 12 per day, with stall-overlap suppression; it acts through no door.
- **D-5923** — `digest-drift-additive` (Task DT3; spec §4.6): the digest carries the findings open at its window's end as an additive `drift` field; the day's claim and `count` are unchanged.
- **D-5924** — `digest-out-of-step-section` (Task DT4; spec §4.6): the digest screen's "Out of step" rows are glances that open the remedy's existing sheet.
- **D-5925** — `held-question-reseed` (Task DT5; spec §5): held and lapsed-ask state stays in the `asks` and `approvals` tables with no new column; the boot's unprimed tick re-seeds the in-memory carrier from rows on a measured matching pane, settles `stale` on a measured mismatch and leaves the row on doubt; D-2169's in-memory carrier stands.
- **D-5926** — `claimant-uuid-on-claim` (Task DT6; spec §6.1, §6.3): the coordinator's uuid is stored beside `runs.claimedBy`, not in the worker's incarnation key, by the claim's existing writers; the heir's uuid is measured from the registry at reclaim; queued mail keeps moving through `reclaimProgram` unchanged.
- **D-5927** — `claimant-revived-offer` (Task DT7; spec §6.2, §6.5): four attributed doors refine their claimant refusal to `409 claimant-revived` and offer the existing reclaim through one push; built only if a revival is recorded within 30 days of DT6.

## Out of scope

D1 to D5 (their own specs); D6's design (W6's `bindingOf`); the consolidation's waves themselves; arming any lane or gate; auto-acting on a finding; a "resolve" button on a finding; changing the stall watch's arms or the digest's correction door.
