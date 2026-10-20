# Mail and run truth: a draft never blocks, a parked mail comes back, a worker has a heartbeat — Implementation Plan

> **For agentic workers:** seven PRs, Tasks P1a to P1g, in the order of §Gates. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m-design.md` (rev 1). Its status line: approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision.

**Issues:** #600 (Tasks P1a to P1d), #125 (Task P1e), #119 (Tasks P1f and P1g).

**Status:** rev 1 (2026-10-20): rev 0 with one review applied (§Review log).

**Base:** `origin/main` `643c76cd4`, with D1 = #821 (open) read from its branch. Anchors, each a hint (`≈:`) beside a name:
- `server/src/inject/send.ts`: `sendPrompt` ≈:835, `draftOfMeasured` ≈:183, `DIM_SPAN` ≈:152, the `draft-present` return ≈:988, `clearBox` ≈:418, `boxText` ≈:1347;
- `server/src/watch.ts`: `sweepMail` ≈:7071, its `sendPrompt` call ≈:7630, the lifecycle park ≈:7487, the `draft-present` back-off and `tellSender` ≈:7765–7781, the idle compact nudge ≈:6714, `sweepStalls` ≈:6067 (its `arming.disabled` return ≈:6084), `judgeStall` ≈:6222;
- `server/src/coord/dispatch.ts`: the `/clear` ≈:1137;
- `server/src/coord/store.ts`: `ABANDONED_PARK_SQL` ≈:1292, `OUTSTANDING_OR_ABANDONED_SQL` ≈:1391, `requeueAbandonedMail` ≈:2360, `advance` ≈:2465, `unreadMailCount` ≈:4183, `itemTally` ≈:4703, `rejectDelivery` ≈:5566;
- `server/src/coord/routes.ts`: `POST /api/runs/:id/advance` ≈:1765;
- `server/src/coord/schema.ts`: `MIGRATIONS` (26 entries on `main`; #821 takes 27, so each task re-measures the next free slot);
- `shared/api.ts`: `RunSummary` ≈:6329, `RUN_TRANSITIONS` ≈:4811, `lifecycleIsDead` ≈:2644;
- `server/src/coord/stall.ts`: `TURN_MARK_STATES` ≈:1512, `StallDeliveryRow` ≈:197;
- `ccd/ccd`: `_pane_box_plain` ≈:21732, `_pane_box_draft` ≈:21736.

**Deploy class.** SERVER, SKILLS and ccd. No `agent/` file is edited. `ccd/ccd` is edited by Task P1a (its dim rule), with the generated-stamp restamp, and deploys agent-first like any ccd change. The skills (Task P1d, and Task P1g's reference) reach homes through `ccrc update`'s install spine. No session is restarted to apply anything.

## Gates

**D1 is #821** (open: "park a live recipient's mail instead of rejecting it undeliverable", #754). It edits `server/src/inject/send.ts` (after `hasContentBelowMarker`, ≈:1347), `watch.ts`, `coord/store.ts`, `coord/schema.ts` (migration 27), `shared/api.ts` and `ccd/coordinator-skill/references/mail-envelope.md`. Spec §7 says what the gate holds.

The open PRs were measured with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files`. Besides #821, the overlaps are:
- #740, #722 and #435, which edit `ccd/ccd` (Task P1a edits its dim rule);
- #722 and #435 also edit `README.md`, and #737 edits `server/test/single-definition.test.ts` (no task here edits either).

| Task | D1 (#821) | Earlier tasks | Open PRs | Other |
|---|---|---|---|---|
| P1a box reader corpus | line-disjoint in `send.ts` (rule 6) | none | #740, #722, #435 in `ccd/ccd`: line-disjoint, restamp | agent-first deploy |
| P1b stash carrier | **merged** (`send.ts`, and the park the refusals feed) | P1a | none | Step 0's probe |
| P1c lane callers on `stash` | **merged** (it edits D1's `sweepMail`) | P1b | none | none |
| P1d protocol text | **merged** (it rewrites `mail-envelope.md` after D1's edit) | P1c merged (the text must describe live behaviour) | none | none |
| P1e revive parked mail | **merged** (same lane, `store.ts`, a migration slot) | P1c (the one `watch.ts` series at a time) | none | next free migration slot |
| P1f heartbeat | **merged** (migration slot, `shared/api.ts`) | P1e (the `watch.ts` series) | none | next free migration slot; W1a's C1f if in flight |
| P1g `dispatched → working` | **merged** | P1f (it reads the first pass's map) | none | none |

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
6. **Single owners.** There is one typing helper (`sendPrompt`), one lifecycle predicate (`lifecycleIsDead`) shared by the park and the revive, one marker read per worker per sweep, one pane corpus (`fixtures/panes/`), and no new notifier: the long-wait notice is D1's `mail-parked` push.
7. **Stale snapshots.** No write in the sweep acts on a state it read before an `await` without re-checking it inside its transaction (`advanceFrom`).
8. **The operator's switch.** Nothing that writes run or session state runs ahead of `stall-watch-disabled`; only the read-only heartbeat does.

## Tasks

### Task P1a: the box reader's corpus, and the placeholder reads empty (D-5910; spec §2.2)

**Routing:** band 3, native: this is pane grammar, the K8 seam. **Lane:** SERVER and ccd. **Needs:** rule-6 line-disjointness with #821 in `send.ts` and with #740, #722 and #435 in `ccd/ccd`.

**Files:**
- Create `server/test/fixtures/panes/box/` (inside the existing corpus, never a second one) with captured ANSI panes, and a verdict table beside them in ARCH-24's per-caller verdict-column shape: one column for the TS `draftOfMeasured` (`box` and `draft`) and one for ccd's `_pane_box_draft` (the last marker row only, which is all it answers):
  - `placeholder-dim.ansi`, `placeholder-dim-combined.ansi` (a `\e[2;…m` open), `placeholder-dim22.ansi` (closed by `\e[22m`);
  - `draft-one-line.ansi`, `draft-multi-line.ansi`, `draft-paste-chip.ansi`, `draft-image-chip.ansi`;
  - `stranded-clear.ansi`, `box-taller-than-capture.ansi`, `empty-nbsp.ansi`.
- Create `server/test/send-box-corpus.test.ts`.
- Modify `server/src/inject/send.ts`: `DIM_SPAN` (≈:152) accepts every dim encoding the corpus holds. `draftOfMeasured`'s shape is unchanged.
- Modify `server/test/ccd-pane-box-draft.test.ts`: it runs ccd's `_pane_box_draft` over the same captures and holds the ccd column.
- Modify `ccd/ccd` `_pane_box_plain` (≈:21732): its dim strip takes the same encodings as the widened `DIM_SPAN`. This edit is unconditional: `_pane_box_plain` uses today's bare-pair rule, so the ccd column reds as soon as the corpus holds a combined-dim capture. Restamp the generated stamp.

**Steps:**
- [ ] **Step 0: Re-ground.** Read `DIM_SPAN`'s comment and `send.test.ts`'s `LIVE_CU_FRAMES`. Capture the placeholder variants from a disposable local Claude Code session at the version the fleet runs (`claude --version` on a development machine), and record the version in the corpus README line of the test.
- [ ] **Step 1: Red.** Write these cases:
  - "each placeholder capture reads `{box:'present', draft:''}`";
  - "each draft capture reads its own text";
  - "the paste chip reads as its chip row";
  - "the taller box reads `absent`";
  - "`empty-nbsp` reads empty";
  - "ccd's `_pane_box_draft` answers its column on every capture" (the ccd column: marker row only; no `absent`, no multi-line, no below-marker verdict is asked of it).

  At least the combined-dim and `\e[22m` captures must be red on `main`. If no capture is red, record that in §Deviations and keep the corpus as the pin.
- [ ] **Step 2: Green.** Widen `DIM_SPAN`, and ccd's `_pane_box_plain` dim strip to match. Nothing else.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `DIM_SPAN` back to the bare pair | send-box-corpus | "each placeholder capture reads … ''" |
  | the strip removed | send-box-corpus | the same, and "each draft capture reads its own text" for chips |
  | last-`❯` scan changed to first | send-box-corpus | "each draft capture" (scrollback turn) |
  | ccd's dim strip back to the bare pair | ccd-pane-box-draft | "ccd's `_pane_box_draft` answers its column" |

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
  - the stash path's submit proof, `stashAwareStill(needle, stashed)` (spec §2.1 step 5): a box equal to the stashed draft is submitted-and-restored, a box that could be the restored draft gets no retry Enter, and only a box that cannot be it is "still ours";
  - `SendResult`: the additive refusal words `stash-occupied` and `stash-failed`, and on the ok arm the additive `draftRestore?: 'restored' | 'restore-unverified'`. The name is decided: never `draft`, which the refusal arm uses for the box text. One reader.
- Modify `server/src/server.ts` ≈:2103: `onDraft: body.replaceDraft === true ? 'replace' : 'refuse'`. The request body is unchanged.
- Create `server/test/send-stash.test.ts`.
- Create `server/test/fixtures/panes/box/stash-*.ansi`, Step 0's captures: the box after `C-s`, the held-stash indicator if one renders, and the box after submit with "Draft restored".

**Steps:**
- [ ] **Step 0: Probe, on a disposable local session, never the fleet.** Measure five things on the version Task P1a recorded, and commit the captures:
  - (a) `C-s` on a non-empty box empties it, and the capture shows "stashed · ctrl+s to restore";
  - (b) a submit restores the draft ("Draft restored"), with a paste chip and with a multi-line draft;
  - (c) `/clear` followed by Enter restores it;
  - (d) whether a held stash renders an indicator while the box holds new text;
  - (e) `C-s` on an empty box with a stash pops it.

  **If (d) finds no indicator,** the carrier ships **disarmed** (it answers `stash-occupied` and presses nothing), spec §8 O1 is raised to the operator, and this is recorded in §Deviations. **If (a) or (b) fails** on that version, stop and report: the spec's mechanism does not hold.
- [ ] **Step 1: Red.** Write these cases:
  - "a draft pane: `C-s`, then the text, then Enter, in that order; the result is `ok` with `draftRestore:'restored'`";
  - "a stashed `/clear` draft is not submitted by the `/clear` send's retry Enter";
  - "a restored draft that starts with the needle gets no second Enter";
  - "a restore that lands between the last capture and the pop: no `C-s` is sent";
  - "a dialog open at the pop's capture: no `C-s` is sent";
  - "the box not empty after `C-s`: `stash-failed`, and nothing typed";
  - "a held-stash indicator: `stash-occupied`, and no key sent";
  - "restore missing, box empty: one `C-s` pop, then verified";
  - "restore still missing: `ok` with `draftRestore:'restore-unverified'`, and a warn line";
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
  | the stash path uses plain `stillStartsWith` | send-stash | "a stashed `/clear` draft is not submitted …" and "… no second Enter" |
  | the pop's fresh capture removed | send-stash | "a restore that lands between …" and "a dialog open at the pop's capture" |
  | default `onDraft` set to `stash` | send-stash | "`onDraft` omitted: `draft-present`" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/send-stash.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/send.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/send-paste-chip.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/routes.test.ts --maxWorkers=2
      cd server && npx tsc --noEmit -p .

### Task P1c: every lane typing site on `stash`; the mail lane's draft arm deleted (D-5912; spec §2.3, §2.4) — GATED: #821 merged, P1b

**Routing:** band 3, native. **Lane:** SERVER. **Needs:** #821 merged, P1b.

**Files:**
- Modify `server/src/watch.ts`:
  - `sweepMail`'s `sendPrompt` (≈:7630) passes `onDraft:'stash'`;
  - the `draft-present` `tellSender` and its back-off arm (≈:7777) are deleted;
  - `stash-failed` and `stash-occupied` are recorded as the delivery's gate (`gated(d, word)`, typed words), and feed #821's park exactly as `dialog-open` does;
  - the idle compact nudge (≈:6714) passes `onDraft:'stash'`;
  - the comment block ≈:6998–7012 ("`replaceDraft` IS NEVER PASSED") is rewritten to the new rule.
- Modify `server/src/coord/dispatch.ts` ≈:1137: the `/clear` passes `onDraft:'stash'`. The comments at ≈:1159 and ≈:1234 are updated.
- `server/src/coord/stall.ts` is **not** edited: its delivery port carries no `lastError` (D-792, `stall-session.test.ts`'s type-level pin), and the long-wait notice is #821's push (spec §2.4).
- Create `server/test/lane-draft-never-blocks.test.ts`, including the call-site table: every `sendPrompt(` call in `server/src`, by file and enclosing function, with its policy (lanes → `stash`; the PWA's send → `refuse`/`replace`).
- Modify `server/test/mail-sweep.test.ts` and `server/test/idle-compact-nudge-lane.test.ts`: their `draft-present` expectations become stash expectations.
- Modify `server/test/stall-bodies.test.ts`: one case that a `mail-stuck` body for a row whose last gate is `stash-failed` names it through the existing "Its last gate:" sentence (no body change).

**Steps:**
- [ ] **Step 0: Re-ground** on #821's merged `sweepMail`: its park, its `mail-parked` push and latch, its 24 h ceiling and its `enter-ignored` hold. List every `sendPrompt` call in `server/src` with `git grep -n "sendPrompt("`, confirm the sites in spec §1.1, and classify each one into the table (a new site found here is classified, not exempted).
- [ ] **Step 1: Red.** Write these cases:
  - "an idle recipient with a draft: the mail lands within one sweep and the box reads the draft back" (acceptance 1 and 5);
  - "a sweep over a draft pane never writes `lastError:'draft-present'`" (acceptance 2);
  - "dispatch's `/clear` with a draft: cleared conversation, draft restored" (acceptance 3);
  - "the idle compact nudge with a draft: typed, draft restored" (acceptance 3);
  - "every `sendPrompt` call matches its row in the call-site table, and an unlisted call is red" (acceptance 2 and 3);
  - "`stash-failed` to the attempts ceiling parks `queued` under #821 with that reason, and #821's push fires once naming the recipient and the word" (acceptance 6);
  - "#821's `enter-ignored` hold still presses nothing on unchanged human text";
  - "`stall-session.test.ts`'s D-792 pin is unchanged" (run, not edited).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `sweepMail` without `onDraft` | lane-draft-never-blocks | "the mail lands … draft back", and the source scan |
  | the `draft-present` arm restored | lane-draft-never-blocks | "never writes `lastError:'draft-present'`" |
  | dispatch's `/clear` without `onDraft` | lane-draft-never-blocks | "dispatch's `/clear` with a draft" |
  | a new `sendPrompt` call added unlisted | lane-draft-never-blocks | "an unlisted call is red" |
  | `gated(d, 'stash-failed')` removed | stall-bodies | "names it through … Its last gate:" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/lane-draft-never-blocks.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/idle-compact-nudge-lane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-bodies.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-session.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/dispatch-route.test.ts --maxWorkers=2

### Task P1d: the protocol text says a draft never blocks (D-5913; spec §2.5) — GATED: P1c merged

**Routing:** band 1–2. The edits are literal text plus their verbatim pins. A `/handoff` worker can do it with `--runner opencode` (literal-change task); the orchestrator reviews the diff. **Lane:** SKILLS. **Needs:** P1c merged (and so #821, whose `mail-envelope.md` text this edits on top of).

**Files:**
- Modify `ccd/coordinator-skill/references/mail-envelope.md`, as #821 left it: the section "`lastError: "draft-present"` — the recipient's input box is occupied" (≈:93 on `main`) and the back-off note (≈:148), re-located at Step 0. #821's park text (a park is not a give-up; re-send only a rejected delivery) is kept word for word.
- Modify `ccd/worker-skill/SKILL.md`: clause 4, and the note ≈:281.
- Modify `ccd/reviewer-skill/SKILL.md`: clause 9's draft sentence.
- Modify `server/test/worker-skill.test.ts`, `server/test/reviewer-skill.test.ts` and `server/test/coordinator-skill.test.ts`: the verbatim pins.

**Steps:**
- [ ] **Step 0: Re-locate** the three passages on the merged `main` (`git grep -n "draft-present" ccd/`), and list every suite that reads these files (`git grep -l "mail-envelope\|worker-skill/SKILL\|reviewer-skill/SKILL" server/test`); run each listed suite in Step 4.
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

### Task P1e: a parked mail comes back with its recipient, and `unreadMail` counts it once (D-5914; spec §3) — GATED: #821 merged, P1c

**Routing:** band 3, native: it touches delivery terminality and a shared read fragment. **Lane:** SERVER. **Needs:** #821 merged, P1c.

**Files:**
- Create `server/src/coord/mailRevive.ts` (L1, imports nothing from fastify or `fs`): `revivable(row, reading)`, the pure decider over the row's columns and the recipient's reading. "Reads live" is `listed && registryPresent && !lifecycleIsDead(sessionLifecycle(row))`, calling the existing `lifecycleIsDead` (`shared/api.ts` ≈:2644). **No second lifecycle predicate is written.**
- Modify `server/src/coord/schema.ts`: the next free `MIGRATIONS` slot (re-measured at Step 0; #821 takes 27) adds `mail_deliveries.revivedFrom INTEGER`, nullable.
- Modify `server/src/watch.ts`: `sweepMail`'s first act calls `store.reviveParkedDeliveries(liveIds, now)` and tells each sender once (`mail-revived-<deliveryId>`). The park arm is unchanged: it keeps `lifecycleIsDead`.
- Modify `server/src/coord/store.ts`:
  - `HAS_HEIR_SQL` = `EXISTS (SELECT 1 FROM mail_deliveries h WHERE h.revivedFrom = d.id)`, one fragment;
  - `ABANDONED_PARK_SQL` gains `AND NOT HAS_HEIR_SQL`;
  - `reviveParkedDeliveries(liveIds, now): {revived: number[]}` selects with `NOT HAS_HEIR_SQL`, the current-wave bound (the mail's `m.at >= rr.dispatchedAt`; a delivery row has no time of its own), the open-run clause and the kind bound (no stall-prefixed subject, no server system notice), and writes the heir with `revivedFrom` set. It shares its heir loop with `requeueAbandonedMail` through one private helper, extracted;
  - `requeueAbandonedMail`'s coordinator arm sees a revived heir.
- Modify the `RunSummary` assembly docstring for `items`: it counts acked work items, which the coordinator settles after a verified advance (spec §3.3).
- Create `server/test/mail-revive.test.ts`.
- Modify `server/test/mail-hardening.test.ts`: the writer scan admits the new writer's guard.

**Steps:**
- [ ] **Step 0: Re-ground** on #821's merged park arm and its 24 h ceiling's `lastError` text. Measure the next free migration slot (`git show origin/main:server/src/coord/schema.ts | grep -c user_version`, as #821's schema comment requires). List `ABANDONED_PARK_SQL`'s readers with `git grep -n ABANDONED_PARK_SQL server/src`, and write one case per reader into Step 1.
- [ ] **Step 1: Red.** Write these cases:
  - "a lifecycle park on an open run is revived once its recipient reads live";
  - "not while `lifecycleIsDead` reads it dead, nor while it is unlisted";
  - "a closed run's park is never revived";
  - "a park created before the run's `dispatchedAt` is never revived";
  - "a stall nudge and a server system notice are never revived";
  - "the replay-ceiling park, a deliberate cancel, `recipient not in registry` and #821's `parked 24 h, never delivered:` reject are never revived";
  - "a legacy `draft-present` park and a legacy `enter-ignored` park on an open run are revived";
  - "`unreadMail`: 1 before, 1 after the revive (the heir), 0 after the heir's ack";
  - "two sweeps revive once";
  - "a heir that parks again is revived once, not twice";
  - "a revived heir to a later-displaced coordinator is requeued to the new coordinator";
  - "a revived heir repointed to a new coordinator: the parent stays retired";
  - "the revive calls `lifecycleIsDead`, and `server/src` defines no other lifecycle-dead predicate" (a source pin);
  - "the sender is told once".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `NOT HAS_HEIR_SQL` dropped from `ABANDONED_PARK_SQL` | mail-revive | "`unreadMail` … 1 after the revive" |
  | the heir clause keyed on `mailId`/`toId` instead of `revivedFrom` | mail-revive | "a revived heir repointed … the parent stays retired" |
  | the open-run filter dropped | mail-revive | "a closed run's park is never revived" |
  | the current-wave bound dropped | mail-revive | "a park created before the run's `dispatchedAt`" |
  | the kind bound dropped | mail-revive | "a stall nudge … never revived" |
  | the dedupe dropped | mail-revive | "two sweeps revive once" |
  | the revive using its own lifecycle test | mail-revive | the source pin |
  | an `UPDATE` of the parked row added | mail-hardening | the writer scan |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-revive.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts --maxWorkers=2

### Task P1f: `workerLastSeen` and `workerTurn` from the turn marker, read ahead of the disabled gate (D-5915; spec §4.1) — GATED: #821 merged, P1e

**Routing:** band 2. It is spec-able (a migration, a writer, a field and a hoisted read), but it edits `watch.ts`'s stall sweep, so it is native unless the weekly pace says otherwise. The orchestrator reviews either way. **Lane:** SERVER. **Needs:** #821 merged (migration slot, `shared/api.ts`), P1e (the `watch.ts` series), and W1a's C1f merged or not yet started (it also adds a `MIGRATIONS` entry).

**Files:**
- Modify `server/src/coord/schema.ts`: the next free `MIGRATIONS` slot, re-measured at Step 0 and again before merge, adds `runs.workerSeenAt INTEGER` and `runs.workerTurn TEXT`, both nullable.
- Modify `server/src/coord/store.ts`: `noteWorkerSeen(runId, at, turn): {changed: boolean}`, which updates only when `at` advances; the run read carries the two columns.
- Modify `shared/api.ts`: `TURN_MARK_STATES` and `TurnMarkState` move here from `server/src/coord/stall.ts` (≈:1512), because `shared/` never imports from `server/src`. `RunSummary` gains `workerLastSeen: number | null` and `workerTurn: TurnMarkState | null`, each with a docstring that says "fleet clock".
- Modify `server/src/coord/stall.ts`: it imports `TURN_MARK_STATES` and `TurnMarkState` from `shared/api.ts` (one definition; `single-definition.test.ts` holds it).
- Modify `server/src/watch.ts` `sweepStalls`:
  - `store.stallCandidates()` is read ahead of the `arming.disabled` return, **without** stamping `lastStallJudgedAt` (D-3750's gap rule unchanged);
  - a first pass over those candidates' workers reads each marker once into a per-sweep map and calls `noteWorkerSeen`, **before** the `arming.disabled` return. It is read-only towards sessions and runs: it writes nothing but the heartbeat columns;
  - `judgeStall` takes its marker from the map.
- Create `server/test/run-heartbeat.test.ts`.
- Modify `server/test/coord-store.test.ts`: the schema round-trip asserts the two new columns. No fixed migration count is pinned.

**Steps:**
- [ ] **Step 0: Re-ground.** Read `stallMarkRead` and `stallUuid`, and count the agent reads per sweep before and after on a fixture fleet of three runs: the number must not rise while the lane is enabled.
- [ ] **Step 1: Red.** Write these cases:
  - "a worker's marker sets `workerLastSeen` and `workerTurn`";
  - "a newer marker advances it";
  - "an older one does not";
  - "`stall-watch-disabled`: still recorded, and nothing else is written (no run event, no stall row, no `lastStallJudgedAt`)";
  - "a foreign marker and a stale marker record nothing";
  - "the enabled sweep reads each marker once" (a counted fake `FleetIO`);
  - "`GET /api/runs` ships both fields";
  - "an older row (migration 26 shape) reads `null`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the pass after the disabled return | run-heartbeat | "`stall-watch-disabled`: still recorded" |
  | the hoisted candidate read stamps `lastStallJudgedAt` | run-heartbeat | "… nothing else is written" |
  | `judgeStall` reading again | run-heartbeat | "reads each marker once" |
  | the writer not monotonic | run-heartbeat | "an older one does not" |
  | a foreign marker accepted | run-heartbeat | "a foreign marker … record nothing" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/run-heartbeat.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-session.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && npx tsc --noEmit -p .

### Task P1g: a run leaves `dispatched` on the worker's first ack, and `{"to":"working"}` on a working run is `ok` (D-5916; spec §4.2) — GATED: P1f

**Routing:** band 3, native: it writes run transitions. **Lane:** SERVER and SKILLS. **Needs:** P1f.

**Files:**
- Create `server/src/coord/runTruth.ts` (L1): `workerUnderway(run, firstAckAt)`.
- Modify `server/src/coord/store.ts`:
  - `firstAckOnRun(runId, sessionId, since): number | null`, a read;
  - `advanceFrom(runId, from, to, causedBy): AdvanceResult`, a compare-and-set sharing `advanceInner`'s body inside one transaction; it refuses `stale-from` when the current state is not `from`.
- Modify `server/src/watch.ts`: `sweepStalls`, **after** the `arming.disabled` return, calls `workerUnderway` and `store.advanceFrom(runId, 'dispatched', 'working', 'worker-underway')`. A `stale-from` answer is not an error: the coordinator moved the run first.
- Modify `server/src/coord/routes.ts` ≈:1765: `{"to":"working"}` on a run already `working` answers `{ok:true, from:'working', to:'working', unchanged:true}`, with no row and no event.
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` §4: the server moves a run to `working` on the worker's first ack, and `{"to":"working"}` stays harmless.
- Create `server/test/run-underway.test.ts`.
- Modify each suite Step 0 finds pinning `wave-lifecycle.md` §4 text.

**Steps:**
- [ ] **Step 0: Re-ground.** `git grep -l wave-lifecycle server/test` (at this plan's base: `asks-routes`, `auth-passkey`, `ccrc-api-closed`, `ccrc-install-graphify`, `ccrc-install`, `child-reclaim-refusals`, `coordinator-skill`, `expiry-lane-prose`, `install-coordinator-skill`, `pr-queue-lane`, `reviewer-skill`, `run-routes`, `worker-skill`). Run each listed suite before and after the edit, one at a time.
- [ ] **Step 1: Red.** Write these cases:
  - "a `dispatched` run moves to `working` on the worker's first ack after `dispatchedAt`";
  - "not on an ack before `dispatchedAt`";
  - "not on another session's ack";
  - "a review run follows its own `transitionsFor` table";
  - "the move takes no cap check and changes no `ACTIVE_RUN_STATES` count";
  - "a run that reached `awaiting-review` between the read and the write is not moved" (`stale-from`);
  - "`stall-watch-disabled`: no run is moved";
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
  | `advanceFrom`'s from-check dropped (a plain `advance`) | run-underway | "a run that reached `awaiting-review` … is not moved" |
  | the executor ahead of the disabled return | run-underway | "`stall-watch-disabled`: no run is moved" |
  | the idempotent arm before the review-in-flight check, for `awaiting-review` | run-underway | "send-back unchanged" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/run-underway.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/run-states.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-fingerprint.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      (and every suite Step 0 listed, one at a time)

## Operator acts

- **Spec §8 O1**, only if Task P1b's probe finds no held-stash indicator. The carrier ships disarmed, so a draft behaves as under #821 alone (parked `queued`, woken on a box change, the operator pushed once, rejected after 24 h parked) until the operator rules on the question.
- Rev 0's act for acceptance 6 (the stall-watch level to wave 2) is withdrawn: acceptance 6 is #821's push.
- **None of these acts touches a fleet box from this plan.** Deploys are the operator's usual agent-first `ccrc update`.

## Rollback

- **Every task is a plain revert.**
- **The two migrations** (P1e's `revivedFrom`, P1f's heartbeat columns, each in the next free slot) are additive. A revert leaves unused nullable columns, which an older server ignores. A reverted P1e also loses the heir clause, so a revived parent counts again beside its heir until the heir is acked; that is the pre-P1e count, not a new defect.
- **Wire fields** (`workerLastSeen`, `workerTurn`, `unchanged`, `draftRestore`) are additive. An older server omits them, and every reader treats absence as unknown.
- **The skills** revert at the next `ccrc update`.
- **Revived heirs** stay valid queued mail after a revert: they are ordinary deliveries.

## Deviations and decisions

### Issued for this work and defined here

The block issued for this plan is D-5910 to D-5919. This plan defines D-5910 to D-5916 for its seven tasks; the last three are issued and unused, listed bare at the end of this block.

- **D-5910** — `box-reader-corpus` (Task P1a; spec §2.2): the box reader's dim rule covers every dim encoding Claude Code emits for the placeholder hint, pinned by a captured-pane corpus that ccd's `_pane_box_draft` is held to as well; a placeholder reads as an empty box, never as a draft.
- **D-5911** — `send-on-draft-stash` (Task P1b; spec §2.1, §2.3): `sendPrompt`'s draft handling becomes one option, `onDraft: 'refuse' | 'replace' | 'stash'`, default `refuse`; `stash` saves a draft with Claude Code's own prompt stash (`C-s`), verifies the box emptied, sends, and verifies Claude Code restored the draft, refusing `stash-occupied` or `stash-failed` with no key typed onto unstashed text; on the stash path the submit proof never reads a box that could be the restored draft as our unsubmitted text (no retry Enter onto it), and the ok arm's `draftRestore` is a field of its own; disarmed if the probe finds no held-stash indicator (spec §8 O1).
- **D-5912** — `lanes-stash-drafts` (Task P1c; spec §2.3, §2.4): every server lane that types into a pane (the mail lane, dispatch's `/clear`, the idle compact nudge) passes `onDraft:'stash'`, the mail lane's `draft-present` back-off and sender notice are deleted, every `sendPrompt` call is held to a classified call-site table, the two stash refusals are recorded as gate words and take #821's park, and the long-wait notice is #821's existing `mail-parked` push (no notifier added; `mail-stuck` and its D-792 pin unchanged).
- **D-5913** — `skills-draft-never-blocks` (Task P1d; spec §2.5): the coordinator's mail-envelope reference and the worker and reviewer skills stop telling a session to keep its box empty and say that a draft is stashed and restored around a delivery.
- **D-5914** — `revive-lifecycle-parks` (Task P1e; spec §3): a delivery parked because its recipient's lifecycle read dead (or a legacy `draft-present` or `enter-ignored` park), on an open run, sent in the run's current wave and not a system nudge, gets one heir delivery naming it in `revivedFrom` when the recipient reads live (listed, present, and not `lifecycleIsDead`, the predicate the park already uses); #821's 24 h ceiling reject is not revived; `unreadMail` stops counting a park that has an heir through one shared `HAS_HEIR_SQL` fragment, with no terminal row written; `items.done` stays an ack count.
- **D-5915** — `run-worker-heartbeat` (Task P1f; spec §4.1): `RunSummary.workerLastSeen` and `workerTurn` come from the worker's turn marker, stored monotonically in the next free migration slot, read once per worker per stall sweep ahead of the `stall-watch-disabled` gate; that read and its heartbeat write are the only work ahead of the gate, which narrows the switch's coverage by that one observation and nothing else; the candidate read moves with it without stamping `lastStallJudgedAt`; `TurnMarkState` moves to `shared/`.
- **D-5916** — `run-underway-on-ack` (Task P1g; spec §4.2): a run moves `dispatched → working` when its worker first acks mail on it at or after `dispatchedAt`, both on the server's clock, written as a compare-and-set (`advanceFrom`, refusing `stale-from`) behind the `stall-watch-disabled` gate; a coordinator's `{"to":"working"}` on a run already `working` answers `ok` with `unchanged:true` and writes nothing.
- **D-5917** — `unused`: issued to this plan; no task took it.
- **D-5918** — `unused`: issued to this plan; no task took it.
- **D-5919** — `unused`: issued to this plan; no task took it.

### Departures, one number each

- **D-6006** (Task P1a) `dim-open-after-reset` — the dim open also takes a code that resets first (`\e[0;2m`, optionally `\e[0;1;2m`), beyond the spec's `\e[2;…m` forms, pinned by an added capture `placeholder-dim-after-reset.ansi`: tmux 3.7c writes any attribute removal as a reset, so dim after a bold cell captures as `\e[1m…\e[0;2m` (measured on a scratch pane), and a placeholder after a bold marker would otherwise read as a draft. The same rule applies mid-run: an attribute that drops inside a dim run (an italic hint, a dim+inverse cursor cell, bold-dim then dim) captures as a reset that turns dim straight back on (`\e[2;3mTry\e[0;2m …`, measured), so both readers first rewrite `\e[0;(1;)?2(;…)?m` to a bare `\e[2m` and it continues the run instead of closing it (derived capture `placeholder-dim-mid-reset.ansi`, provenance as D-6007's derived captures). The TS close also takes a parameterless `\e[m`, as ccd's did.
- **D-6007** (Task P1a) `box-corpus-provenance` — Claude Code 2.1.303 renders the placeholder with the bare pair only, so `placeholder-dim-combined` and `placeholder-dim22` are derived from the recorded `placeholder-dim` with only the placeholder's codes substituted (tmux 3.7c emits the combined open itself and never emits `\e[22m`, both measured); 2.1.303 caps a tall box at 20 rows with `❯` on the first, so `box-taller-than-capture` is the fleet's measured 2026-09-18 shape (`send.test.ts`'s `BOX_TALLER_THAN_THE_WINDOW`) with neutral text, and the 2.1.303 capped shape is added as `box-capped-tall.ansi`, which reads `present` with its first visible row as the draft (a non-empty read, so it refuses).

## Review log

One review of rev 0 (2026-10-20). Each finding was checked against the code at the new base and against #821's branch.

| # | Finding | Verdict | Where it went |
|---|---|---|---|
| 1 | D1 is #821 and the spec models it wrongly (queued park, its own push, 24 h ceiling, overlapping files) | **Applied**, except sub-point (d): #821 adds no `sendPrompt` call; its resume rides the mail lane's existing call with `resumeIfOwn` (two calls in its `watch.ts`, as on `main`) | spec In short, §1.1, §2.3, §2.4, §3.1, §7, §8; §Gates |
| 2 | Migration 27 is taken by #821; W1a's C1f adds another | **Applied**: next free slot, re-measured; no fixed count pinned | spec §4.1; P1e, P1f; Rollback |
| 3 | The stash path's `stillStartsWith` proof can press Enter on a restored draft | **Applied**: `stashAwareStill`, two red cases and a mutant | spec §2.1 step 5; P1b |
| 4 | P1g's `advance` acts on a stale snapshot and can send a run under review back to work | **Applied**: `advanceFrom` compare-and-set, case and mutant | spec §4.2; P1g |
| 5 | Reading `lastError` in `mail-stuck` breaks D-792's pin | **Applied** by withdrawal: `stall.ts` is not edited; the refusal words are gates, and the long-wait notice is #821's push | spec §2.4; P1c |
| 6 | `fixtures/box/` is a second corpus; the parity row cannot be written; the ccd edit is certain | **Applied**: `fixtures/panes/box/` with per-caller columns; ccd edit unconditional; rule-6 gate on #740, #722, #435 | spec §2.2; P1a; §Gates |
| 7 | `lifecycleParks` duplicates `lifecycleIsDead`; "reads live" undefined | **Applied**: the revive calls `lifecycleIsDead`; "reads live" defined; a source pin forbids a second predicate | spec §3.1; P1e |
| 8 | The heir clause keyed on `toId` breaks on repoint; revive dedupe and read clause differ | **Applied**: `revivedFrom` column and one `HAS_HEIR_SQL` fragment; two cases | spec §3.2; P1e |
| 9 | The run transition ahead of the disabled gate changes the switch's contract; the candidate read hoist is unstated | **Applied**: only the read-only heartbeat is ahead; the executor is behind; hoist stated without stamping | spec §4.1, §4.2; P1f, P1g |
| 10 | The revive re-sends old and system mail; excluding `enter-ignored` has no reason | **Applied**: current-wave and kind bounds; legacy `enter-ignored` parks included | spec §3.1; P1e |
| 11 | `TurnMarkState` lives in `server/src` and `shared/` cannot import it | **Applied**: moved to `shared/api.ts` | spec §4.1; P1f |
| 12 | Stale citations (consolidation rev, "#600 first", base) | **Applied**: rev 2.1 on `main` via #819, CLAUDE.md #818 cited, the "#600 first" claim removed, rebased onto `643c76cd4` | spec header, §6 |
| 13 | A file-exemption source scan is fragile | **Applied**: an explicit call-site table; an unlisted call is red | spec §2.3; P1c |
| 14 | The restore pop acts on a capture a late restore can overtake | **Applied**: a fresh capture checks dialog and empty box immediately before the pop; two cases | spec §2.1 step 6; P1b |
| 15 | `draft` would carry two meanings | **Applied**: `draftRestore` | spec §2.1; P1b; Rollback |
| 16 | P1g has no Step 0 for `wave-lifecycle.md`'s readers | **Applied**: Step 0 lists and runs them; P1d gains the same | P1d, P1g |

## Out of scope

- **Branch progress on the run row.** It is a C4 workspace fact and gets its own issue.
- **The PWA's display of the heartbeat.** That is consolidation W7.
- **ccd's own pane typing at session start.**
- **An out-of-box channel into Claude Code.**
- **Widening the delivery-row writers that still return `void`.**
- **K6's `notify()` funnel.** That is W1a.
- **K3's `readSession` and K10's `RunBinding`,** which later absorb the revive's `lifecycleIsDead` reading and its run-to-worker key.
