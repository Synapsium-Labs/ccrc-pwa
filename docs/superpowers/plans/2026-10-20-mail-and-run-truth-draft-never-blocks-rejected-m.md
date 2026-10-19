# Mail and run truth: a draft never blocks, a parked mail comes back, a worker has a heartbeat — Implementation Plan

> **For agentic workers:** seven PRs, Tasks P1a to P1g, in the order of §Gates. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m-design.md` (rev 0). Its status line: approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision.

**Issues:** #600 (Tasks P1a to P1d), #125 (Task P1e), #119 (Tasks P1f and P1g).

**Status:** rev 0 (2026-10-20).

**Base:** `origin/main` `397be1ec5`. Anchors, each a hint (`≈:`) beside a name:
- `server/src/inject/send.ts`: `sendPrompt` ≈:835, `draftOfMeasured` ≈:183, `DIM_SPAN` ≈:152, the `draft-present` return ≈:988, `clearBox` ≈:418, `boxText` ≈:1347;
- `server/src/watch.ts`: `sweepMail` ≈:7071, its `sendPrompt` call ≈:7630, the lifecycle park ≈:7487, the `draft-present` back-off and `tellSender` ≈:7765–7781, the idle compact nudge ≈:6714, `sweepStalls` ≈:6067 (its `arming.disabled` return ≈:6084), `judgeStall` ≈:6222;
- `server/src/coord/dispatch.ts`: the `/clear` ≈:1137;
- `server/src/coord/store.ts`: `ABANDONED_PARK_SQL` ≈:1292, `OUTSTANDING_OR_ABANDONED_SQL` ≈:1391, `requeueAbandonedMail` ≈:2360, `advance` ≈:2465, `unreadMailCount` ≈:4183, `itemTally` ≈:4703, `rejectDelivery` ≈:5566;
- `server/src/coord/routes.ts`: `POST /api/runs/:id/advance` ≈:1765;
- `server/src/coord/schema.ts`: `MIGRATIONS` (26 entries);
- `shared/api.ts`: `RunSummary` ≈:6329, `RUN_TRANSITIONS` ≈:4811;
- `ccd/ccd`: `_pane_box_draft` ≈:21736.

**Deploy class.** SERVER and SKILLS. No `agent/` file is edited. `ccd/ccd` is edited only if Task P1a's parity row reds, and then it deploys agent-first like any ccd change. The skills (Task P1d, and Task P1g's reference) reach homes through `ccrc update`'s install spine. No session is restarted to apply anything.

## Gates

**D1** is the in-flight change "mail is never parked while the recipient lives". It is not on `origin/main` at `397be1ec5`, and no open PR or branch carries it by that name. Each gate below waits for it to merge, or this plan's task rebases onto its branch.

The open PRs at `397be1ec5` were measured with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files`. None of them touches a file this plan edits, except:
- #722 and #435, which edit `README.md` (no task here edits it);
- #737, which edits `server/test/single-definition.test.ts` (no task here edits it: each new pin lives in its own suite).

| Task | D1 | Earlier tasks | Open PRs | Other |
|---|---|---|---|---|
| P1a box reader corpus | no | none | none overlap | none |
| P1b stash carrier | no | P1a | none overlap | Step 0's probe |
| P1c lane callers on `stash` | **yes** (it edits D1's `sweepMail` arm) | P1b | none overlap | none |
| P1d protocol text | no | P1c merged (the text must describe live behaviour) | none overlap | none |
| P1e revive parked mail | **yes** (same lane) | P1c (the one `watch.ts` series at a time) | none overlap | none |
| P1f heartbeat | no | P1e (the `watch.ts` series) | none overlap | none |
| P1g `dispatched → working` | no | P1f (it shares the first pass) | none overlap | none |

If the consolidation's W1a series has started on `watch.ts` when a task here is ready, the two series interleave by consolidation rule 6: one `watch.ts` series at a time, and the later one rebases.

## Global constraints

- **Public repository.** No host, IP, account or lane name, other project name, absolute home path, email or private tracker id in any file, commit or PR. Cite issues by GitHub `#n`. Fixtures use `project-a`, `lane-a` and similar.
- **Red first, measured.** Every guard ships with a test that is red before the change and green after, and each mutation row is RUN, not argued.
- **Vitest** only with `--maxWorkers=2`, one suite at a time. Worktrees live under a non-indexed directory.
- **ccrc SAFETY.** No test touches a fleet box, a `ws-*` verb, a unit or a live tmux. Pane tests run against a fake `Tmux` over captured fixtures. Task P1b's probe runs on a disposable local Claude Code session on a development machine, never on the fleet, and its captures are committed with neutral names.
- **Wire discipline.** Every new field is additive, absence-permits and has a single reader. `FLEET_PROTO` is unchanged.
- **Delivery terminality.** No task writes a terminal delivery row. Every new store writer returns a typed result, never `void`.
- **No `pwa/` file** is edited by any task (consolidation rule 8).
- **Commits:** the repository's public no-reply identity, never a personal email, with the `Co-Authored-By` trailer the session's attribution names. Landing goes through the queue with `gh pr merge --match-head-commit`.

## Review focus

1. **Typing onto a human's draft.** Ask of every path in `sendPrompt`: can a key be sent while the box holds text the server has not stashed or proven its own? The answer must be no.
2. **A destroyed stash.** `C-s` is never pressed while a stash may be held (spec §2.1 step 2, §8 O1).
3. **A placeholder retyped as text.** No path may restore anything by typing.
4. **Terminal rows.** The revive writes a new row and never reopens an old one. `unreadMail`'s change is a derived read.
5. **Clock mixing.** `dispatched → working` compares only server-clock columns. `workerLastSeen` is shipped as the fleet clock and labelled so.
6. **Single owners.** There is one typing helper (`sendPrompt`), one lifecycle predicate shared by the park and the revive, one marker read per worker per sweep, and one long-wait notice (`mail-stuck`).

## Tasks

### Task P1a: the box reader's corpus, and the placeholder reads empty (D-5910; spec §2.2)

**Routing:** band 3, native: this is pane grammar, the K8 seam. **Lane:** SERVER (ccd only if the parity row reds). **Needs:** nothing.

**Files:**
- Create `server/test/fixtures/box/` with captured ANSI panes:
  - `placeholder-dim.ansi`, `placeholder-dim-combined.ansi` (a `\e[2;…m` open), `placeholder-dim22.ansi` (closed by `\e[22m`);
  - `draft-one-line.ansi`, `draft-multi-line.ansi`, `draft-paste-chip.ansi`, `draft-image-chip.ansi`;
  - `stranded-clear.ansi`, `box-taller-than-capture.ansi`, `empty-nbsp.ansi`.
- Create `server/test/send-box-corpus.test.ts`.
- Modify `server/src/inject/send.ts`: `DIM_SPAN` (≈:152) accepts every dim encoding the corpus holds. `draftOfMeasured`'s shape is unchanged.
- Modify `server/test/ccd-pane-box-draft.test.ts`: one parity row runs ccd's `_pane_box_draft` over the same corpus.
- Modify `ccd/ccd` `_pane_box_draft` (≈:21736) **only if** that parity row reds.

**Steps:**
- [ ] **Step 0: Re-ground.** Read `DIM_SPAN`'s comment and `send.test.ts`'s `LIVE_CU_FRAMES`. Capture the placeholder variants from a disposable local Claude Code session at the version the fleet runs (`claude --version` on a development machine), and record the version in the corpus README line of the test.
- [ ] **Step 1: Red.** Write these cases:
  - "each placeholder capture reads `{box:'present', draft:''}`";
  - "each draft capture reads its own text";
  - "the paste chip reads as its chip row";
  - "the taller box reads `absent`";
  - "`empty-nbsp` reads empty";
  - "ccd's reader agrees with `draftOfMeasured` on every capture" (the parity row).

  At least the combined-dim and `\e[22m` captures must be red on `main`. If no capture is red, record that in §Deviations and keep the corpus as the pin.
- [ ] **Step 2: Green.** Widen `DIM_SPAN`, and only it.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `DIM_SPAN` back to the bare pair | send-box-corpus | "each placeholder capture reads … ''" |
  | the strip removed | send-box-corpus | the same, and "each draft capture reads its own text" for chips |
  | last-`❯` scan changed to first | send-box-corpus | "each draft capture" (scrollback turn) |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/send-box-corpus.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/send.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/send-paste-chip.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-pane-box-draft.test.ts --maxWorkers=2

### Task P1b: `onDraft: 'stash'` in `sendPrompt` (D-5911; spec §2.1, §2.3)

**Routing:** band 3, native, **two reviewers**: it sends keys into a box that may hold a human's text. **Lane:** SERVER. **Needs:** P1a.

**Files:**
- Modify `server/src/inject/send.ts`:
  - `sendPrompt`'s options: `replaceDraft?: boolean` becomes `onDraft?: 'refuse' | 'replace' | 'stash'` (default `'refuse'`);
  - the stash carrier (spec §2.1 steps 2 to 6);
  - `SendResult`: the additive refusal words `stash-occupied` and `stash-failed`, and on the ok arm the additive `draft?: 'restored' | 'restore-unverified'` (a separate field name from the refusal arm's `draft` string if review prefers; one reader either way).
- Modify `server/src/server.ts` ≈:2103: `onDraft: body.replaceDraft === true ? 'replace' : 'refuse'`. The request body is unchanged.
- Create `server/test/send-stash.test.ts`.
- Create `server/test/fixtures/box/stash-*.ansi`, Step 0's captures: the box after `C-s`, the held-stash indicator if one renders, and the box after submit with "Draft restored".

**Steps:**
- [ ] **Step 0: Probe, on a disposable local session, never the fleet.** Measure five things on the version Task P1a recorded, and commit the captures:
  - (a) `C-s` on a non-empty box empties it, and the capture shows "stashed · ctrl+s to restore";
  - (b) a submit restores the draft ("Draft restored"), with a paste chip and with a multi-line draft;
  - (c) `/clear` followed by Enter restores it;
  - (d) whether a held stash renders an indicator while the box holds new text;
  - (e) `C-s` on an empty box with a stash pops it.

  **If (d) finds no indicator,** the carrier ships **disarmed** (it answers `stash-occupied` and presses nothing), spec §8 O1 is raised to the operator, and this is recorded in §Deviations. **If (a) or (b) fails** on that version, stop and report: the spec's mechanism does not hold.
- [ ] **Step 1: Red.** Write these cases:
  - "a draft pane: `C-s`, then the text, then Enter, in that order; the result is `ok` with `draft:'restored'`";
  - "the box not empty after `C-s`: `stash-failed`, and nothing typed";
  - "a held-stash indicator: `stash-occupied`, and no key sent";
  - "restore missing, box empty: one `C-s` pop, then verified";
  - "restore still missing: `ok` with `draft:'restore-unverified'`, and a warn line";
  - "the auto-continue hold and `turn-running` refuse before `C-s`";
  - "`dialog-open` refuses before `C-s`";
  - "`resumeIfOwn`, `clearMailResidue` and `ownStrandedClear` still win over `stash`";
  - "an unproven `/clear` is stashed, not cleared";
  - "`onDraft` omitted: `draft-present`, as today";
  - "the PWA route maps `replaceDraft:true` to `replace`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the post-`C-s` verify removed | send-stash | "the box not empty after `C-s`" |
  | the held-stash guard removed | send-stash | "a held-stash indicator" |
  | `C-s` before the auto-continue check | send-stash | "the auto-continue hold … refuse before `C-s`" |
  | `stash` checked before `ownStrandedClear` | send-stash | "… still win over `stash`" |
  | the restore verify removed | send-stash | "restore missing, box empty" |
  | default `onDraft` set to `stash` | send-stash | "`onDraft` omitted: `draft-present`" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/send-stash.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/send.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/send-paste-chip.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/routes.test.ts --maxWorkers=2
      cd server && npx tsc --noEmit -p .

### Task P1c: every lane typing site on `stash`; the mail lane's draft arm deleted (D-5912; spec §2.3, §2.4) — GATED: D1, P1b

**Routing:** band 3, native. **Lane:** SERVER. **Needs:** D1, P1b.

**Files:**
- Modify `server/src/watch.ts`:
  - `sweepMail`'s `sendPrompt` (≈:7630) passes `onDraft:'stash'`;
  - the `draft-present` `tellSender` and its back-off arm (≈:7777) are deleted;
  - the idle compact nudge (≈:6714) passes `onDraft:'stash'`;
  - the comment block ≈:6998–7012 ("`replaceDraft` IS NEVER PASSED") is rewritten to the new rule.
- Modify `server/src/coord/dispatch.ts` ≈:1137: the `/clear` passes `onDraft:'stash'`. The comments at ≈:1159 and ≈:1234 are updated.
- Modify `server/src/coord/stall.ts`: the `mail-stuck` notice body names the delivery's `lastError` word.
- Create `server/test/lane-draft-never-blocks.test.ts`.
- Modify `server/test/mail-sweep.test.ts` and `server/test/idle-compact-nudge-lane.test.ts`: their `draft-present` expectations become stash expectations.
- Modify `server/test/stall-bodies.test.ts`: the body names the reason.

**Steps:**
- [ ] **Step 0: Re-ground** on D1's merged `sweepMail`. List every `sendPrompt` call in `server/src` with `git grep -n "sendPrompt("`, and confirm the four sites in spec §1.1.
- [ ] **Step 1: Red.** Write these cases:
  - "an idle recipient with a draft: the mail lands within one sweep and the box reads the draft back" (acceptance 1 and 5);
  - "a sweep over a draft pane never writes `lastError:'draft-present'`" (acceptance 2);
  - "dispatch's `/clear` with a draft: cleared conversation, draft restored" (acceptance 3);
  - "the idle compact nudge with a draft: typed, draft restored" (acceptance 3);
  - "a source scan: every `sendPrompt` call in `server/src` other than `server.ts`'s PWA route passes `onDraft:'stash'`" (acceptance 3);
  - "`stash-failed` backs off and never parks while the recipient lives" (D1's rule);
  - "`mail-stuck` fires once past `MAIL_STUCK_MS` on `stash-failed`, naming it" (acceptance 6).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `sweepMail` without `onDraft` | lane-draft-never-blocks | "the mail lands … draft back", and the source scan |
  | the `draft-present` arm restored | lane-draft-never-blocks | "never writes `lastError:'draft-present'`" |
  | dispatch's `/clear` without `onDraft` | lane-draft-never-blocks | "dispatch's `/clear` with a draft" |
  | the reason dropped from the notice body | stall-bodies | "names the reason" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/lane-draft-never-blocks.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/idle-compact-nudge-lane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-bodies.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/dispatch-route.test.ts --maxWorkers=2

### Task P1d: the protocol text says a draft never blocks (D-5913; spec §2.5) — GATED: P1c merged

**Routing:** band 1–2. The edits are literal text plus their verbatim pins. A `/handoff` worker can do it with `--runner opencode` (literal-change task); the orchestrator reviews the diff. **Lane:** SKILLS. **Needs:** P1c merged.

**Files:**
- Modify `ccd/coordinator-skill/references/mail-envelope.md`: the section "`lastError: "draft-present"` — the recipient's input box is occupied" (≈:93) and the back-off note (≈:148).
- Modify `ccd/worker-skill/SKILL.md`: clause 4, and the note ≈:281.
- Modify `ccd/reviewer-skill/SKILL.md`: clause 9's draft sentence.
- Modify `server/test/worker-skill.test.ts`, `server/test/reviewer-skill.test.ts` and `server/test/coordinator-skill.test.ts`: the verbatim pins.

**Steps:**
- [ ] **Step 1: Red.** Update the pins to the new text first, so the suites are red against the old skills. Each clause count stays the same: seventeen for the worker and coordinator, ten for the reviewer.
- [ ] **Step 2: Green.** Edit the skills. The new contract is: a draft never stops mail; the lane stashes it, and Claude Code restores it after the delivery ("Draft restored"); keep using your box normally. The reviewer's subagent-brief rule keeps its other sentences word for word.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the old clause 4 text restored | worker-skill | clause 4 verbatim |
  | the reviewer's old sentence restored | reviewer-skill | clause 9 verbatim |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/install-worker-skill.test.ts --maxWorkers=2

### Task P1e: a parked mail comes back with its recipient, and `unreadMail` counts it once (D-5914; spec §3) — GATED: D1, P1c

**Routing:** band 3, native: it touches delivery terminality and a shared read fragment. **Lane:** SERVER. **Needs:** D1, P1c.

**Files:**
- Create `server/src/coord/mailRevive.ts` (L1, imports nothing from fastify or `fs`), holding two functions:
  - `lifecycleParks(lc)`, the one predicate the park arm (≈:7487) and the revive both call;
  - `revivable(row, liveIds)`.
- Modify `server/src/watch.ts`: the park arm calls `lifecycleParks`, and `sweepMail`'s first act calls `store.reviveParkedDeliveries(liveIds, now)` and tells each sender once (`mail-revived-<deliveryId>`).
- Modify `server/src/coord/store.ts`:
  - `reviveParkedDeliveries(liveIds, now): {revived: number[]}`, which shares its heir loop with `requeueAbandonedMail` through one private helper, extracted;
  - `ABANDONED_PARK_SQL` gains the heir `NOT EXISTS` clause;
  - `requeueAbandonedMail`'s coordinator arm sees a revived heir.
- Modify `server/src/coord/store.ts`'s `RunSummary` assembly docstring for `items`: it counts acked work items, which the coordinator settles after a verified advance (spec §3.3).
- Create `server/test/mail-revive.test.ts`.
- Modify `server/test/mail-hardening.test.ts`: the writer scan admits the new writer's guard.

**Steps:**
- [ ] **Step 0: Re-ground** on D1's park arm. List `ABANDONED_PARK_SQL`'s readers with `git grep -n ABANDONED_PARK_SQL server/src`, and write one case per reader into Step 1.
- [ ] **Step 1: Red.** Write these cases:
  - "a lifecycle park on an open run is revived once its recipient reads live";
  - "not while it reads dead";
  - "a closed run's park is never revived";
  - "the replay-ceiling park, a deliberate cancel, `enter-ignored` and `recipient not in registry` are never revived";
  - "a legacy `draft-present` park on an open run is revived";
  - "`unreadMail`: 1 before, 1 after the revive (the heir), 0 after the heir's ack";
  - "two sweeps revive once";
  - "a revived heir to a later-displaced coordinator is requeued to the new coordinator";
  - "the park arm and the revive share `lifecycleParks`" (a source pin);
  - "the sender is told once".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the heir clause dropped from `ABANDONED_PARK_SQL` | mail-revive | "`unreadMail` … 1 after the revive" |
  | the open-run filter dropped | mail-revive | "a closed run's park is never revived" |
  | the dedupe dropped | mail-revive | "two sweeps revive once" |
  | the revive using its own lifecycle test | mail-revive | the shared-predicate pin |
  | an `UPDATE` of the parked row added | mail-hardening | the writer scan |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-revive.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts --maxWorkers=2

### Task P1f: `workerLastSeen` and `workerTurn` from the turn marker, read ahead of the disabled gate (D-5915; spec §4.1) — GATED: P1e

**Routing:** band 2. It is spec-able (a migration, a writer, a field and a hoisted read), but it edits `watch.ts`'s stall sweep, so it is native unless the weekly pace says otherwise. The orchestrator reviews either way. **Lane:** SERVER. **Needs:** P1e (the `watch.ts` series).

**Files:**
- Modify `server/src/coord/schema.ts`: migration 27 adds `runs.workerSeenAt INTEGER` and `runs.workerTurn TEXT`, both nullable.
- Modify `server/src/coord/store.ts`: `noteWorkerSeen(runId, at, turn): {changed: boolean}`, which updates only when `at` advances; the run read carries the two columns.
- Modify `shared/api.ts`: `RunSummary` gains `workerLastSeen: number | null` and `workerTurn: TurnMarkState | null`, each with a docstring that says "fleet clock". The `TurnMarkState` words are imported, never re-spelled.
- Modify `server/src/watch.ts` `sweepStalls`:
  - a first pass over the open runs' workers reads each marker once into a per-sweep map and calls `noteWorkerSeen`, **before** the `arming.disabled` return;
  - `judgeStall` takes its marker from the map.
- Create `server/test/run-heartbeat.test.ts`.
- Modify `server/test/coord-store.test.ts`: the migration count and the schema round-trip.

**Steps:**
- [ ] **Step 0: Re-ground.** Read `stallMarkRead` and `stallUuid`, and count the agent reads per sweep before and after on a fixture fleet of three runs: the number must not rise while the lane is enabled.
- [ ] **Step 1: Red.** Write these cases:
  - "a worker's marker sets `workerLastSeen` and `workerTurn`";
  - "a newer marker advances it";
  - "an older one does not";
  - "`stall-watch-disabled`: still recorded";
  - "a foreign marker and a stale marker record nothing";
  - "the enabled sweep reads each marker once" (a counted fake `FleetIO`);
  - "`GET /api/runs` ships both fields";
  - "an older row (migration 26 shape) reads `null`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the pass after the disabled return | run-heartbeat | "`stall-watch-disabled`: still recorded" |
  | `judgeStall` reading again | run-heartbeat | "reads each marker once" |
  | the writer not monotonic | run-heartbeat | "an older one does not" |
  | a foreign marker accepted | run-heartbeat | "a foreign marker … record nothing" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/run-heartbeat.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-session.test.ts --maxWorkers=2
      cd server && npx tsc --noEmit -p .

### Task P1g: a run leaves `dispatched` on the worker's first ack, and `{"to":"working"}` on a working run is `ok` (D-5916; spec §4.2) — GATED: P1f

**Routing:** band 3, native: it writes run transitions. **Lane:** SERVER and SKILLS. **Needs:** P1f.

**Files:**
- Create `server/src/coord/runTruth.ts` (L1): `workerUnderway(run, firstAckAt)`.
- Modify `server/src/coord/store.ts`: `firstAckOnRun(runId, sessionId, since): number | null`, a read.
- Modify `server/src/watch.ts`: P1f's first pass calls `workerUnderway` and `store.advance(runId, 'working', 'worker-underway')`.
- Modify `server/src/coord/routes.ts` ≈:1765: `{"to":"working"}` on a run already `working` answers `{ok:true, from:'working', to:'working', unchanged:true}`, with no row and no event.
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` §4: the server moves a run to `working` on the worker's first ack, and `{"to":"working"}` stays harmless.
- Create `server/test/run-underway.test.ts`.
- Modify `server/test/coordinator-skill.test.ts` only if it pins the §4 text.

**Steps:**
- [ ] **Step 1: Red.** Write these cases:
  - "a `dispatched` run moves to `working` on the worker's first ack after `dispatchedAt`";
  - "not on an ack before `dispatchedAt`";
  - "not on another session's ack";
  - "a review run follows its own `transitionsFor` table";
  - "the move takes no cap check and changes no `ACTIVE_RUN_STATES` count";
  - "one `run_events` row, `causedBy:'worker-underway'`";
  - "the coordinator's `{"to":"working"}` on a working run: `ok`, `unchanged:true`, no event row";
  - "`{"to":"working"}` from `awaiting-review` still writes its event" (send-back unchanged);
  - "`run-states.test.ts` green".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the `>= dispatchedAt` bound dropped | run-underway | "not on an ack before `dispatchedAt`" |
  | the session filter dropped | run-underway | "not on another session's ack" |
  | the idempotent arm writes an event | run-underway | "no event row" |
  | the idempotent arm before the review-in-flight check, for `awaiting-review` | run-underway | "send-back unchanged" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/run-underway.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/run-states.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-fingerprint.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2

## Operator acts

- **Spec §8 O1**, only if Task P1b's probe finds no held-stash indicator. The carrier ships disarmed, so delivery waits on a draft (never parks) until the operator rules on the question.
- **For acceptance 6 to push** rather than record, the stall-watch level in Settings must include wave 2. That is the operator's existing control; if it already does, nothing is needed.
- **None of these acts touches a fleet box from this plan.** Deploys are the operator's usual agent-first `ccrc update`.

## Rollback

- **Every task is a plain revert.**
- **Migration 27** is additive. A revert leaves two unused nullable columns, which an older server ignores.
- **Wire fields** (`workerLastSeen`, `workerTurn`, `unchanged`, `draft:'restored'`) are additive. An older server omits them, and every reader treats absence as unknown.
- **The skills** revert at the next `ccrc update`.
- **Revived heirs** stay valid queued mail after a revert: they are ordinary deliveries.

## Deviations and decisions

### Issued for this work and defined here

The block issued for this plan is D-5910 to D-5919. This plan defines D-5910 to D-5916 for its seven tasks; the last three are issued and unused, listed bare at the end of this block.

- **D-5910** — `box-reader-corpus` (Task P1a; spec §2.2): the box reader's dim rule covers every dim encoding Claude Code emits for the placeholder hint, pinned by a captured-pane corpus that ccd's `_pane_box_draft` is held to as well; a placeholder reads as an empty box, never as a draft.
- **D-5911** — `send-on-draft-stash` (Task P1b; spec §2.1, §2.3): `sendPrompt`'s draft handling becomes one option, `onDraft: 'refuse' | 'replace' | 'stash'`, default `refuse`; `stash` saves a draft with Claude Code's own prompt stash (`C-s`), verifies the box emptied, sends, and verifies Claude Code restored the draft, refusing `stash-occupied` or `stash-failed` with no key typed onto unstashed text; disarmed if the probe finds no held-stash indicator (spec §8 O1).
- **D-5912** — `lanes-stash-drafts` (Task P1c; spec §2.3, §2.4): every server lane that types into a pane (the mail lane, dispatch's `/clear`, the idle compact nudge) passes `onDraft:'stash'`, the mail lane's `draft-present` back-off and sender notice are deleted, and a long wait is reported once, with its reason word, by the stall watch's existing `mail-stuck` arm.
- **D-5913** — `skills-draft-never-blocks` (Task P1d; spec §2.5): the coordinator's mail-envelope reference and the worker and reviewer skills stop telling a session to keep its box empty and say that a draft is stashed and restored around a delivery.
- **D-5914** — `revive-lifecycle-parks` (Task P1e; spec §3): a delivery parked because its recipient's lifecycle read dead (or a legacy `draft-present` park) gets one heir delivery when the recipient reads live again and its run is still open; the park and the revive share one lifecycle predicate; `unreadMail` stops counting a park that has an heir, derived in the read, with no terminal row written; `items.done` stays an ack count.
- **D-5915** — `run-worker-heartbeat` (Task P1f; spec §4.1): `RunSummary.workerLastSeen` and `workerTurn` come from the worker's turn marker, stored monotonically by migration 27, read once per worker per stall sweep ahead of the `stall-watch-disabled` gate.
- **D-5916** — `run-underway-on-ack` (Task P1g; spec §4.2): a run moves `dispatched → working` when its worker first acks mail on it at or after `dispatchedAt`, both on the server's clock; a coordinator's `{"to":"working"}` on a run already `working` answers `ok` with `unchanged:true` and writes nothing.
- **D-5917** — `unused`: issued to this plan; no task took it.
- **D-5918** — `unused`: issued to this plan; no task took it.
- **D-5919** — `unused`: issued to this plan; no task took it.

## Out of scope

- **Branch progress on the run row.** It is a C4 workspace fact and gets its own issue.
- **The PWA's display of the heartbeat.** That is consolidation W7.
- **ccd's own pane typing at session start.**
- **An out-of-box channel into Claude Code.**
- **Widening the delivery-row writers that still return `void`.**
- **K6's `notify()` funnel.** That is W1a.
- **K3's `readSession` and K10's `RunBinding`,** which later absorb this plan's lifecycle predicate and its run-to-worker key.
