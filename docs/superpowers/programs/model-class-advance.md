# Program: model-class-advance

Spec: `docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md` (approved by the operator 2026-10-15).
Plan: `docs/superpowers/plans/2026-10-15-model-class-auto-advance-codex-arm.md`, re-planned by #2918.
Workspace: each wave's child workspace, minted by its dispatch. The coordinator is the session that opened run 2450.

On 2026-10-07 the operator ruled that a lane's model classes follow new model releases on their own: "the ccrc user
should not be doing this kind of stuff by hand". On 2026-11-16 the owner made the coordinating session the operator of
this work, with merge authority. On 2026-11-18 the owner showed a Codex-lane session still on an older model of its
family after a newer one was released, and asked for this work to become a programme with a plan to completion.

## Goal

Every lane's model classes follow new model releases on their own. The hourly refresh moves a class to its family's
newest model once a test request to it passes. A per-class hold is the only brake. `ccrc doctor` says when a class is
held, behind or blocked, and the phone shows and steers it. Codex lanes come first, then Anthropic lanes. OpenRouter
comes later, by the owner's ruling. Nobody runs `set-class` by hand to keep up.

## Done when

The same eight statements are pinned as the programme's definition of done (`ccrc-api goals show model-class-advance`).

1. A Codex lane's catalogue lists the models OpenAI offers the current Codex client, and keeps doing so across Codex
   releases with no version raised by hand.
2. On a Codex lane, each class moves to its family's newest model within one hourly refresh of that model appearing,
   only after a passing canary, and never to an older version.
3. `ccrc doctor` warns, by cause, on a held class behind a newer model, a held pin gone from the catalogue, a running
   session still on a replaced model a day after the move, and a lane or class that cannot advance.
4. The console reads a lane's models only through the agent's `models` op; the agent's file-read grant for model files
   is retired.
5. The phone's Models sheet shows each lane's classes, pins and advance state, and holds, releases and reverts a class;
   #1441 is closed.
6. On an Anthropic lane, the class labels and the effort setting follow Claude Code's alias when it resolves to a new
   model, and a class can be held.
7. At a real new model release, the class moves on its own, a new session replies on the new model, and doctor shows no
   sessions-behind warning 24 hours later.
8. The README and the spec describe what shipped, and #2607 is closed.

## What has shipped

| Step | What | PR | State |
|---|---|---|---|
| Spec and plan | The design and the Codex arm's plan | #713 | merged |
| W1 | The registry's family, hold, previous and history fields; the newest-in-family rule | #867 | merged |
| W2 | The hourly advance with a canary before each move, holds, and the advance file | #1099 | merged, live since v0.0.555 |
| R0 | The re-plan and its rulings | #2918 | merged |
| R1 | Picker labels read from the registry, and the lane kind | #2942 | merged |
| R3 | The agent's `models` op, read first by `GET /api/models/:lane` | #2960 | merged, first in v0.0.1259 |
| R2 | Doctor's four warnings, and the refresh's reaping of stale catalogue temp files | #2943 | merged 2026-11-19; measured before landing, below |
| Wave 1 | The catalogue probe asks as the current Codex client (0.170.0) | #3023 | merged; measured live, below |
| Wave 6 | The spec's D18 amended with the measured alias evidence; the Anthropic arm's plan | #3027 | merged 2026-11-18 |
| Wave 2 | The client version follows published Codex releases, with the shipped constant as a floor (D-8743) | #3025 | merged 2026-11-18; measured live, below |
| Wave 4 | `POST /api/models/:lane` and the phone's Models sheet (D-8752 to D-8756) | #3028 | merged 2026-11-18 |
| Wave 5 | The read grant retired: the console reads a lane's models only through the `models` op (D-8757, D-8758) | #3041 | merged 2026-11-18 |
| Follow-up | `transient-beside-kept-answer`: the picker and the sheet name a transient answer beside a kept one | #3086 | merged 2026-11-19 |
| Wave 7 | The Anthropic arm's aliases file, holds, refresh and doctor causes (D-8818 to D-8822) | #3107 | merged 2026-11-20 |

The hourly advance has moved classes by itself, each move after a passing canary: one class on both Codex lanes on
2026-10-26, and on one lane an opus class that stepped to an older model on 2026-11-10 and back two hours later (wave 3
explains it).

**Wave 1, measured (2026-11-18).** The fleet box moved to v0.0.1291 at 12:13Z. Its next hourly refresh, at 12:28Z,
listed two models the lanes had never seen, `gpt-6.2-sol` and `gpt-6.2-astra` (twelve ids, up from ten). On both Codex
lanes the opus class moved from `gpt-6.1-sol` to `gpt-6.2-sol` and the fable class from `gpt-6-astra` to
`gpt-6.2-astra`, each move after a passing canary, recorded with cause `newer`. This confirms the cause recorded
below: the backend had been withholding models that need a newer client. Done-when 1 and 2 hold for this release;
wave 2 keeps the version current from now on, and wave 3 adds the "never to an older version" half of 2. It also
starts Done-when 7: a new Codex-lane session on the new model, and no sessions-behind warning a day later, are still
owed. The second needs #2943's check.

**Wave 2, measured (2026-11-18).** The fleet box updated itself to v0.0.1297, which carries wave 2. Its refresh at
21:28Z ran the new lookup: the published Codex client read 0.170.0, with no error, and both Codex lanes' catalogues
record that they were fetched as 0.170.0 (twelve ids). Done-when 1's "across releases" half is shown at the next
Codex client release. On 2026-11-19 the fleet box is on v0.0.1320, which carries waves 2, 4 and 5.

**R2, measured before landing (2026-11-19).** The branch's four checks ran from the worker's worktree against the fleet
box's lane files, read-only and with no install: all four read PASS on both Codex lanes, and a system-call trace showed
no write under the live home. #2943 then merged through the queue, two days before the Codex bridge's check week
closed (the amendment to D-8689, below). Its sessions-behind check is what Done-when 7's second half reads.

## Waves

The programme's plan (`ccrc-api plan show model-class-advance`) holds the same epics, tickets and checkpoints.

| # | Epic | Ticket | Scope | PRs | State |
|---|---|---|---|---|---|
| 1 | catalogue-current | client-version-now | Raise the catalogue probe's Codex client version to the current Codex release | #3023 | merged; measured |
| 2 | catalogue-current | client-version-tracks | Track that version automatically, with the shipped constant as a floor | #3025 | merged |
| 3 | catalogue-current | backward-move | Explain the step to an older model and back; fix the cause | #3118 | in review, round 4 (run 2455) |
| - | doctor | doctor-land | Land #2943 | #2943 | merged 2026-11-19 |
| 4 | models-sheet | models-sheet | `POST /api/models/:lane` hold, release and revert, and the Models sheet; closes #1441 | #3028 | merged |
| 5 | read-path | retire-grant | Retire the model-file read grant; an unknown advance state reads `invalid` with the classes kept | #3041 | merged |
| 6 | anthropic-arm | anthropic-plan | Amend the spec's D18 with the measured alias evidence, and plan the arm | #3027 | merged |
| 7 | anthropic-arm | anthropic-writer | The alias file, holds and doctor causes on Anthropic lanes | #3107 | merged 2026-11-20 |
| 8 | anthropic-arm | anthropic-ccd | ccd launches a held class on its pin and carries effort to the new model | #3122 | in review, round 2 (run 2910) |
| 9 | anthropic-arm | anthropic-pwa | Labels and the Models sheet on Anthropic lanes | | planned |
| 10 | acceptance | docs-and-issues | The README's context-window rule, the spec's status, #2607, and the Fable-ceiling issue | | planned |
| - | catalogue-current | usage-user-agent | The usage reader sends the probe's Codex client version, from one reader | #3085 | reviewed and accepted (run 2821); lands after 2026-11-21 |
| - | models-sheet | transient-beside-kept-answer | The sheet names a transient answer beside a kept one; a session-screen case and two text corrections | #3086 | merged 2026-11-19 |
| - | models-sheet | revert-writes-before-refusing | A refused Revert must not leave the class held | #3118 | folded into wave 3 |
| - | read-path | ccrcdir-param-drop | Drop `readLaneModels`' unread `ccrcDir` parameter (D-8757) | | after waves 3 and 8 |
| - | doctor | release-lookup-warn | Doctor warns when the Codex release lookup has failed for over a day | #3118 | folded into wave 3 |
| - | anthropic-arm | repick-landing-notes | Six notes for the id re-pick, read with A3.6's re-check | #3122 | read in wave 8, whose A3.0 left the re-pick unmeasured |
| - | acceptance | natural-move | Watch the next real release through: canary, move, a new session, no sessions-behind warning | | watched from wave 1's rollout |
| - | anthropic-arm | cache-row-skip | Wave 7's review finding F5, carried as the plan's ticket of that name | | after wave 8 |
| - | doctor | doctor-caps-one-reader | Wave 7's review finding F6, carried as the plan's ticket of that name | | after wave 8 |
| - | anthropic-arm | typed-repick | The re-pick measured with a hand-typed `/model`, which wave 8's A3.0 left unmeasured | | after wave 8; the owner types it |

Order: #2943 merged on 2026-11-19, which opened waves 3 and 7. They share five files: the models op
(`deploy/models-op.mjs`), the advance rule (`shared/model-advance.mjs`), the registry reader (`shared/models.mjs`),
doctor's checks (`ccd/ccrc-doctor-checks`) and `ccd/ccrc`. Wave 7 went first, because it starts the longest chain:
wave 8 waits on wave 7, wave 9 on waves 4 and 7, and wave 10 is last. Wave 3 dispatches when wave 7 lands, or beside
wave 8 with its holder's consent on the files they share. Wave 5 built on wave 4 (the same server reader and word
lists). The three follow-ups marked "after wave 7" touch wave 7's files too, so they follow it or fold into wave 3.

Wave 7 merged on 2026-11-20 (#3107). Waves 3 and 8 then ran side by side, each built on `main` after #3107. They share
the advance rule, its declaration file, `ccd/ccrc` and two test files, and each edits only the hunks the other's worker
consented to in writing, one round at a time; a consent releases no claim. Wave 3 is in its fourth review round and wave
8 in its second. Wave 3 lands only after the Codex bridge's check week has closed and its evidence is handed over;
`usage-user-agent` (#3085) waits for the same handoff.

## Waiting on the owner

Nothing. Items 406 (the server box on v0.0.1259 or later), 407 (both Codex lanes marked as Codex lanes in the server
box's roster) and 423 (the fleet box on v0.0.1288 or later) were ticked by the owner and confirmed on 2026-11-18. A
session cannot read the server box's roster, so 407 was confirmed on the owner's tick and the fleet box's copy. Wave
4's sheet is its first live check: if a Codex lane reads as unmanaged there, a new item goes to the owner.

Coming: the review judge marks waves 3 and 8 as infrastructure changes, so each lands only after an approving review
from the DevOps team, outside its author set, on its final head (`devops-approval-needed`). An item asks for it once
that head has passed review. Item 517 asked for one on wave 3's round-3 head and was withdrawn when that round sent the
head back for a fix.

## Decisions & deviations

- **Deviation numbers:** 8743 to 8748 were issued 2026-11-18 at run 2450's open, and 8750 to 8756 and 8757 to 8758
  later the same day (8749 went to another programme). Each is defined in the plan of the wave that departs, never
  here first:
  - D-8743 in wave 2's plan (`docs/superpowers/plans/2026-11-18-model-class-advance-w2-client-version.md`);
  - D-8744 to D-8748, D-8750 and D-8751 in the Anthropic arm's plan
    (`docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md`);
  - D-8752 to D-8756 in the codex-arm plan's Deviations found, for wave 4;
  - D-8757 and D-8758 in the same Deviations found, for wave 5;
  - D-8818 to D-8822 in the Anthropic arm's plan, for wave 7 (#3107).

  One more number was issued on 2026-11-19, for `usage-user-agent`; it is defined in that ticket's PR (#3085) and
  named here once that PR lands. `transient-beside-kept-answer` departed twice, from no plan of its own, so its two
  departures are named by slug in its task note (`model-class-advance/fu-transient-beside-kept-answer.md`):
  `sheet-anthropic-no-transient-line` and `absent-anthropic-key-unreadable`. Waves 3 and 8 were issued numbers of
  their own, defined in their PRs' plan edits (#3118 in the Codex arm's plan, #3122 in the Anthropic arm's plan); they
  are named here once those PRs land.
- **A pin gone from the catalogue (wave 3, in review as #3118).** Done-when 2's "never to an older version" governs a
  release advance, and wave 3 keeps it: a `newer` move goes only to a version strictly above the pin, and it never
  waits for the grace below. The one step that can still choose an older model is the retirement of a pin the catalogue no longer lists.
  Wave 3 allows it only after six hours of continuous fresh catalogue sightings of that absence, timed by the
  catalogue's own fetch time and never by the wall clock, after a canary like any move. This explains the pinned
  statement and does not rewrite it. The spec's §2.2 and §2.8 still describe the older rule until wave 10 corrects
  them.
- **The catalogue's client version (2026-11-18).** A Codex-lane session reported its class on an older model of its
  family after a newer release. The lane's catalogue was fresh (read hourly, 24 runs a day, no failures) and did not
  list the newer model. `ccd/ccrc-models-probe` asked the Codex catalogue as client `0.160.0`, a constant since
  2026-09-09 (#71), whose own comment says the backend keys what it advertises on that version; the published Codex CLI
  was at `0.170.0` that day. The cause was that the backend withholds models that need a newer client. Wave 1's
  release measured it: the first refresh on that build listed the two newer models (above).
- **The client version follows published Codex releases (D-8743, wave 2).** This reverses the registry spec's "bumped
  deliberately" rule (§5) under the operator's 2026-10-07 rule. A lookup of npm's latest `@openai/codex`, once an hour
  per box, bounded at 10 s and about 30 s at worst, never below the shipped floor and never failing the catalogue fetch.
  Its cost if wrong: a new client version can list a model the bridge serves badly; each move still waits on a passing
  canary, and a hold stops a class.
- **Where the Models sheet opens (wave 4, D-8752).** A ruled ask placed it as a "Models" act in a lane card's fold,
  opening in the shared `AccountSheet` shell. This clarifies D-8686's "in the account sheet, not behind a row button",
  which assumed a per-lane account sheet. The sheet shows on every Codex lane by roster kind, managed or not, because it
  acts on the lane's model registry, not on its launcher.
- **The Anthropic arm's re-pick (wave 6).** The plan's step that moves a running Anthropic session to its class's new
  id took six review rounds. Rounds 3 to 6 each found a defect in a guard the previous round had added. Round 5 replaced
  those guards with one bound: a `picked=` key, so a given id is acted on at most once per session, and only a positive
  hand pick stands it down (D-8744). The last round's minor points are a follow-up ticket (`repick-landing-notes`), read
  with A3.6's re-check against the A3.0 measurements before wave 8 dispatches.
- **Two changes were to wait for the Codex bridge's check week to close (2026-11-21); one landed early.** The week reads
  the doctor and the GPT lanes' usage units every day, and a merge reaches the fleet within hours. On 2026-11-19 the
  operator amended D-8689 for #2943: its four checks were measured PASS on both Codex lanes, read-only; the week's
  daily reading counts FAIL lines and `codex` WARN lines only, and the four are WARN-only under their own names; and
  its one refresh change, the reaping of stale catalogue temp files, is smaller than the client-version changes that
  already reached the refresh during the week. So #2943 landed that day. `usage-user-agent` still waits for the week to
  close, because it changes the usage poll the daily reading reads.
- **Wave 7 leaves the README alone.** Another run's freeze holds `README.md`, and its holder declined wave 7's lines
  (the four Anthropic causes in the doctor section, the aliases file in the models section). They become a follow-up
  after that freeze lifts, named by wave 7's report. Wave 8 carries three exact README hunks under the holder's
  written consent; the Anthropic causes in the doctor section stay wave 10's.
- **Landing without a further review round.** Waves 2, 4 and 6 each ended with a last fix round of minor or
  text-closable findings. The coordinator checked each with two independent Opus readers (one for conformance to the
  rulings, one for correctness) and landed it, rather than spend another review round.
- **Workers and reviews:** each wave is a dispatched worker on its own branch, read by a review run with the held-out
  panel, and merged through the queue by the coordinator. Rollout stays the owner's.

## Carried constraints

- The fleet tracks `main` closely, so each wave is inert or mixed-version safe at merge.
- The repository is public: lanes are `lane-a` and `lane-b`, hosts are "the server box" and "the fleet box".
- Every head commit on a branch that edits a plan carries a `Ledger-Edit:` trailer, in the same paragraph as
  `Co-Authored-By:` so that git reads it as a trailer.
- D-8693's rulings stand: the argv-grammar refusal words stay `unreadable`. Since wave 5, an advance state word the
  server does not know reads `invalid`, with the classes kept.
- #2943's files were held for it until it merged on 2026-11-19. They are open now. Waves 3 and 8 share several of
  them (Order, above), and neither edits a shared hunk without the other's written consent.

## Next-wave brief (wave 9, after wave 8)

- Ticket `anthropic-pwa` (epic anthropic-arm): the class labels and the Models sheet on Anthropic lanes. It waits for
  wave 8 to merge, because it reads what wave 8's launch and hold record, and it builds on wave 4's sheet.
- It carries two findings from wave 7's review: the notification's wording, and one push per class move rather than
  one per lane.
- It states, without adding a gate, the caveat wave 8 documents for a degraded supervisor sweep.
- Each change carries a test that reds without it, and the wave is safe in the mixed-version window at merge.
