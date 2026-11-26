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
newest model once a test request to it passes. Classes always advance: the one brake is a Revert, whose hold ends by
itself when a newer model appears (the owner's ruling of 2026-11-22, below). `ccrc doctor` says when a class is held,
behind or blocked, and the phone shows it and reverts a class. Codex lanes come first, then Anthropic lanes. OpenRouter
comes later, by the owner's ruling. Nobody runs `set-class` by hand to keep up.

## Done when

The same eight statements are pinned as the programme's definition of done (`ccrc-api goals show model-class-advance`).
Statements 5 and 6 read as modification 94 rewrote them on 2026-11-22.

1. A Codex lane's catalogue lists the models OpenAI offers the current Codex client, and keeps doing so across Codex
   releases with no version raised by hand.
2. On a Codex lane, each class moves to its family's newest model within one hourly refresh of that model appearing,
   only after a passing canary, and never to an older version.
3. `ccrc doctor` warns, by cause, on a held class behind a newer model, a held pin gone from the catalogue, a running
   session still on a replaced model a day after the move, and a lane or class that cannot advance.
4. The console reads a lane's models only through the agent's `models` op; the agent's file-read grant for model files
   is retired.
5. The phone's Models sheet shows each lane's classes, pins and advance state, and reverts a class, which then holds
   until a newer model appears; #1441 is closed.
6. On an Anthropic lane, the class labels and the effort setting follow Claude Code's alias when it resolves to a new
   model, and a class can be reverted.
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
| Follow-up | `usage-user-agent`: the usage poll sends the Codex client version the catalogue probe asks as (D-8781) | #3085 | merged 2026-11-21 |
| Wave 3 | The retire grace, the effort fallback, Revert's refusals before any write, and the release lookup warning (D-8838 to D-8843, D-8865, D-8866) | #3118 | merged 2026-11-22 |
| Wave 8 | ccd on an Anthropic lane: the launch marker, the held id at launch, effort from data, the model id in the record (D-8832, D-8833, D-8846 to D-8859) | #3122 | merged 2026-11-22 |
| Follow-up | `release-lookup-pins`: the release lookup's verdict follows the auth library's record | #3216 | merged 2026-11-22 |
| Follow-up | `effort-fallback-pins`: each term of the effort file's rule pinned, and wave 3's refusals beside a released hold | #3217 | merged 2026-11-22 |
| Follow-up | `doctor-caps-one-reader`: one reader of `ccd caps` in doctor; an unmeasured read is never a PASS | #3222 | merged 2026-11-22 |
| Follow-up | `no-keys-transitive`: the no-key guard follows calls through ccd's own call graph | #3219 | merged 2026-11-22 |
| Follow-up | `cache-row-skip`: one bad row in Claude Code's catalogue cache no longer blinds the whole file | #3223 | merged 2026-11-22 |
| Wave 9 | An Anthropic lane's labels and Models sheet from its aliases file, one push per class move (D-8921 to D-8930) | #3221 | merged 2026-11-22 |
| Follow-up | `revert-ends-itself`: a Revert records what it left and the refresh ends its hold by itself, on both kinds of lane | #3237 | merged 2026-11-23 |
| Follow-up | `typed-repick`: a session behind its class's id is one more reason for the existing idle roll, which types no command | #3238 | merged 2026-11-23 |
| Follow-up | `revert-holds-until-newer` with `ccrcdir-param-drop`: the sheet and its door offer Revert alone, where the box reports that it ends holds (D-8757) | #3246 | merged 2026-11-23; v0.0.1416 is a published prerelease |

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

**Done-when 7, read on 2026-11-21.** A read-only doctor run on the fleet box, on v0.0.1370 and more than a day after the
2026-11-18 moves, read the sessions-behind check PASS on every lane, and the other three model-advance checks PASS too
(doctor's two FAIL lines that day came from other checks). New sessions on both Codex lanes had replied on
`gpt-6.2-sol`; none had yet replied on `gpt-6.2-astra`. The `natural-move` ticket stays open: it watches the next real
release through, with every wave in place.

## Waves

The programme's plan (`ccrc-api plan show model-class-advance`) holds the same epics, tickets and checkpoints. Since
2026-11-21 it also holds four phases, which cover every ticket: the Codex arm, the Anthropic arm, the review follow-ups
and acceptance.

| # | Epic | Ticket | Scope | PRs | State |
|---|---|---|---|---|---|
| 1 | catalogue-current | client-version-now | Raise the catalogue probe's Codex client version to the current Codex release | #3023 | merged; measured |
| 2 | catalogue-current | client-version-tracks | Track that version automatically, with the shipped constant as a floor | #3025 | merged |
| 3 | catalogue-current | backward-move | Explain the step to an older model and back; fix the cause | #3118 | merged 2026-11-22 |
| - | doctor | doctor-land | Land #2943 | #2943 | merged 2026-11-19; the plan's ticket stays open (below) |
| 4 | models-sheet | models-sheet | `POST /api/models/:lane` hold, release and revert, and the Models sheet; closes #1441 | #3028 | merged |
| - | models-sheet | revert-ends-itself | A Revert records the model it left, and the refresh ends its hold by itself when a newer model appears, on both kinds of lane; doctor's hold remedies go | #3237 | merged 2026-11-23 |
| - | models-sheet | revert-holds-until-newer | Hold and Release leave the sheet and the door; Revert returns on Anthropic lanes where the box reports that it ends holds | #3246 | merged 2026-11-23 (run 3475) |
| 5 | read-path | retire-grant | Retire the model-file read grant; an unknown advance state reads `invalid` with the classes kept | #3041 | merged |
| 6 | anthropic-arm | anthropic-plan | Amend the spec's D18 with the measured alias evidence, and plan the arm | #3027 | merged |
| 7 | anthropic-arm | anthropic-writer | The alias file, holds and doctor causes on Anthropic lanes | #3107 | merged 2026-11-20 |
| 8 | anthropic-arm | anthropic-ccd | ccd launches a held class on its pin and carries effort to the new model | #3122 | merged 2026-11-22 |
| 9 | anthropic-arm | anthropic-pwa | Labels and the Models sheet on Anthropic lanes | #3221 | merged 2026-11-22, with no Hold, Release or Revert on an Anthropic lane until #3246 (below) |
| 10 | acceptance | docs-and-issues | The README's context-window rule, the spec's status, #2607, and the Fable-ceiling issue | | building (run 3500) |
| - | catalogue-current | usage-user-agent | The usage reader sends the probe's Codex client version, from one reader | #3085 | merged 2026-11-21 |
| - | models-sheet | transient-beside-kept-answer | The sheet names a transient answer beside a kept one; a session-screen case and two text corrections | #3086 | merged 2026-11-19 |
| - | models-sheet | revert-writes-before-refusing | A refused Revert must not leave the class held | #3118 | folded into wave 3 |
| - | read-path | ccrcdir-param-drop | Drop `readLaneModels`' unread `ccrcDir` parameter (D-8757) | #3246 | merged 2026-11-23, with `revert-holds-until-newer` |
| - | doctor | release-lookup-warn | Doctor warns when the Codex release lookup has failed for over a day | #3118 | folded into wave 3 |
| - | anthropic-arm | repick-landing-notes | Six notes for the id re-pick, read with A3.6's re-check | | dropped: no typed re-pick is built (below) |
| - | acceptance | natural-move | Watch the next real release through: canary, move, a new session, no sessions-behind warning | | watched from wave 1's rollout |
| - | anthropic-arm | cache-row-skip | One bad row in Claude Code's model cache must not make the whole file unreadable (wave 7's review, F5) | #3223 | merged 2026-11-22 |
| - | doctor | doctor-caps-one-reader | One reader of `ccd caps` in doctor; an unmeasured answer is never a PASS (wave 7's review, F6) | #3222 | merged 2026-11-22 |
| - | doctor | effort-fallback-pins | Pin the two terms of the effort-file claim that wave 3's last review found unpinned, with three note corrections | #3217 | merged 2026-11-22 |
| - | anthropic-arm | typed-repick | Move a running Anthropic session onto its class's new id with no hand keystroke: a session behind its class's id is relaunched at idle by the existing roll | #3238 | merged 2026-11-23 |
| - | catalogue-current | effort-level-dropped | A dropped effort level must not stop a lane's hourly refresh (wave 1's review, F2) | #3118 | folded into wave 3 |
| - | doctor | release-lookup-pins | Pin the release lookup's library read with a stand-in library, and two text corrections (wave 3's fifth review) | #3216 | merged 2026-11-22 |
| - | anthropic-arm | no-keys-transitive | Guard passive alias observation against indirect key senders (wave 8's third review) | #3219 | merged 2026-11-22 |
| - | anthropic-arm | entry-comment-seven | The launcher's comment names its seven libraries, with the launcher's next change of substance | | with that change |
| - | acceptance | readme-anthropic-arm | README lines for the Anthropic arm, after the README freeze lifts | | wave 10, run 3500: only as an exact packet the freeze holder has consented to |

Order: waves 3 and 8 merged on 2026-11-22 (#3118, then #3122), and wave 9 built on both and merged that evening
(#3221). Five follow-ups ran beside wave 9, each on files wave 9 did not hold, and all merged the same day. On
2026-11-23 `revert-ends-itself` (#3237) and `typed-repick` (#3238) merged, then `revert-holds-until-newer` with
`ccrcdir-param-drop` (#3246), which had to follow `revert-ends-itself`, because removing Release before a Revert's hold
ends by itself would have left every Codex revert held for good. Wave 10 is last.

## Waiting on the owner

Nothing. On 2026-11-22 the owner ruled that no pull request waits for a human review: a PR lands on its required
checks and the programme's own independent review, and the review judge's codes that ask for a person outside the
author set (`devops-approval-needed`, `code-owner`, `rules-mixed`) hold nothing, and neither does `proof-not-built`. The items that asked
the owner for such reviews were withdrawn: 542 (#3118) and 523 (#3122). Item 522, on #3122's coupled installer and
libraries, closed that day. Item 505, which asked the owner to type one `/model` line so the re-pick could be
measured, was withdrawn under the owner's other ruling of that day, never to hand the operator a chore: `typed-repick`
was re-scoped to need no keystroke (call 176, then call 409, below).

Items 406, 407 and 423 were ticked by the owner and confirmed on 2026-11-18 (the server box on v0.0.1259 or later, both
Codex lanes marked as Codex lanes in its roster, the fleet box on v0.0.1288 or later).

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

  D-8781 was issued on 2026-11-19 for `usage-user-agent`, and #3085 defines it in wave 2's plan. `transient-beside-kept-answer` departed twice, from no plan of its own, so its two
  departures are named by slug in its task note (`model-class-advance/fu-transient-beside-kept-answer.md`):
  `sheet-anthropic-no-transient-line` and `absent-anthropic-key-unreadable`. Waves 3, 8 and 9 define their numbers in
  their PRs' plan edits: D-8838 to D-8843, D-8865 and D-8866 in the Codex arm's plan (#3118); D-8832, D-8833 and
  D-8846 to D-8859 in the Anthropic arm's plan (#3122); D-8921 to D-8930 in the Anthropic arm's plan (#3221).
- **The owner's rulings of 2026-11-22.** Three, each applied to this programme the same day:
  - No pull request waits for a human review (above).
  - Never hand the operator a chore: no item asks the owner to type, tap or run something the system can do.
  - Classes always advance (the settings audit, `docs/superpowers/specs/2026-11-22-settings-audit.md`): the Models
    sheet's Hold and Release go, and a Revert holds a class until a newer model appears. Big call 297 adopted it,
    modification 94 rewrote done-when 5 and 6, and this ledger's PR amends the spec to match.
- **Revert withheld on an Anthropic lane in wave 9 (call 374, big).** Wave 9's review found that a Revert there wrote a
  hold the console could not end: no Release on that lane by the always-advance ruling, and the refresh passes over a
  held class. Wave 9 therefore offers no Hold, Release or Revert on an Anthropic lane (D-8922, D-8930). A class held
  from the shell still reads as held there, and its words name no control the sheet does not draw. Revert returns on
  Anthropic lanes with `revert-holds-until-newer`, offered on both kinds of lane only where the box ends holds.
- **A Revert's hold ends by itself (calls 411 and 412).** A Revert records the model it moved away from. One decider in
  the advance rule ends the hold: on a Codex lane when a newer version of the same family appears, on an Anthropic lane
  when the alias, seen after the hold began, names a third id. A hand hold takes the held id as its baseline and ends at
  the first newer model. A Revert that records nothing reads the class's history for it, on either kind of lane; with no
  usable history, a trustworthy refresh records the candidate as the baseline and does not end the hold on that pass. The refresh clears the
  hold in the same write as the move. A held pin the catalogue has retired ends its hold and takes the move an unheld
  class would take. Doctor warns only when a hold should have ended and still stands. The read gains a fact that the
  box ends holds, and the sheet offers Revert only where it is present, so a new console never strands a hold on an
  older fleet box. No hold stood on the fleet box when this was decided. The work is two runs, the automatic end first.
- **`typed-repick` without a keystroke (calls 176 and 409).** Nothing acts on a running Anthropic session when its
  class's alias moves; any relaunch lands on the new id, because every spawn passes the class alias. Whether a typed
  `/model` re-pick re-resolves the alias in an old process was never measured and may do nothing. So a session behind
  its class's id becomes one more reason for the existing idle roll, which resumes the same conversation and types no
  key, once per target id. `repick-landing-notes` was dropped with the typed arm.
- **Known limits, recorded rather than built.** #3219's call-graph guard stops at these, judged contrived after two
  rounds (call 381): a function whose body is a subshell, `pkg::fn` names, tmux's `pipe-pane -I`, the `tmux paste`
  prefix, option forms before `send` that it does not parse, control-mode here-strings, wrappers held in variables, a
  text-level cutter, the literal `--apply` read, a supervisor started through the service manager, and a bare
  `ccd <verb>`, which is not an edge. #3222's one-reader guard reads the spellings it names, not every way to write a
  second call.
- **What wave 10 reconciled (2026-11-23, run 3500).** The spec's status, §2.2, §2.5.6, §2.8, the section 5 bullets and "Where things stand", and this
  ledger, now describe what shipped rather than the plans' future tense: a normal Codex advance goes strictly forward
  after a passing canary, the one exception being the retirement of a pin the catalogue no longer lists, after six hours of
  continuous fresh sightings counted on the catalogue's own fetch times, with no shortcut by the clock; an Anthropic lane
  follows the resolved class alias with its model and effort, preserves a held id, and moves a running session by the
  existing idle relaunch, typing nothing, and the ledger makes no claim that belongs to the renewal programme (call 452);
  doctor says what the files it reads show, not when the next refresh will act. The README changes only as an exact
  packet the holder of the README claim has consented to.
  The corrected D-8751, the over-cap wording and the strong-timeout limit are in the Anthropic arm's plan (a
  correction under D-8751). The `ccrc-models` test's title was checked and not confirmed stale, so no test changed.
- **The Models sheet and its door after #3246.** They offer Revert only, on a class with explicit literal-`true` support
  read fresh before the act; Hold and Release stay shell and agent verbs. The Anthropic copy predicts no target and the
  Codex copy names it; the fresh read after the act is authoritative. D-8857: released-hold evidence can survive a
  refresh while a Revert's hold stands and is cleared when that hold ends. A trustworthy refresh with no hold standing,
  a later Release, and the first Revert after a Release finding the alias unmoved are other ways it goes; the list is not
  exhaustive, and no time or manual remedy is promised. With the current writers, the first Revert after a Release can
  pick the released id when the alias has moved; a repeat Revert over the resulting Revert hold keeps that id and can
  refresh the hold's timestamp, and the current eligibility rules (previous model, capability, the existing guards) are
  unchanged. Review 3493's counts are in `model-class-advance/fu-revert-holds-until-newer.md`: 246 unit passes in four
  files and 11 browser passes on the successful attempt, with mutations restored green. They are the independent
  review's, distinct from the old head's counts and from the worker's own reported 259, whose file set is unmeasured. Server proof from review 3487 was carried on byte-identical inputs, not rerun. The
  two-call race, the busy preflight and an older console's wording stay recorded limits. Calls 469, 503, 527, 555 and 561
  hold: old holds need usable baseline evidence, a same-ID or effort-only successful Revert is skipped as model-changing
  history, the history scan does not cross episodes, the same write that records a move clears the hold, and the Codex
  retirement exception stays.
- **Issues, as read on 2026-11-23.** #2607's residual (a stale catalogue under a class model with no measured window)
  is named by `clientWindowNotice` (D-8685, #2943) beside #2701's move notice (D-8384), both on `show`, `lanes` and
  doctor's `models` row, each pinned by tests, so this wave's PR closes it. #1441 closed with the sheet (D-8690) and is
  not reopened. No issue for the Fable share ceiling and per-lane effort that D-8690 moved out was found; its text is in
  the wave's task note for the coordinator to file. #2943 landed outside a run, so its plan ticket stays open.
- **Proposed correction to done-when 3, not applied.** The pinned statement says doctor warns on "a held class behind a
  newer model". Since a Revert's hold is a held class behind a newer model until its end comes, the proposed wording is
  "a hold that has come due to end and still stands". The pin is the owner's to change through a modification, so this
  wave only flags it.
- **Carried to later work.** From wave 9: a lane whose kind is unknown is drawn as a Codex lane (the window is narrow,
  and the server refuses behind it); a push dropped for lack of the strong timeout capability writes no log line. From
  `no-keys-transitive` (call 299): `_watchdog_resume_run`'s header comment says it types nothing, which needs a
  correction at `ccd/ccd`'s next change, and the stand-downs of the supervisor's typing paths (auto-compact, the route
  typers) want pins of their own. Wave 10 took D-8751's prose after wave 9's one push per
  class move, and recorded the over-cap log wording and the strong-timeout limit (both in the Anthropic arm's plan); it
  did not confirm the `ccrc-models` test's title as stale. Done-when 3 still says doctor warns on a held class behind a
  newer model, which a Revert's hold is by design until its end comes: the proposed correction is above. Still carried:
  `entry-comment-seven`, the watchdog header and the supervisor stand-down proof, until a substantive edit and actual
  proof. The unread directory argument was dropped in #3246, and the duplicate carry in the live plan was dropped with
  the landing credited to the producer ticket.
- **A pin gone from the catalogue (wave 3, #3118).** Done-when 2's "never to an older version" governs a
  release advance, and wave 3 keeps it: a `newer` move goes only to a version strictly above the pin, and it never
  waits for the grace below. The one step that can still choose an older model is the retirement of a pin the catalogue no longer lists.
  Wave 3 allows it only after six hours of continuous fresh catalogue sightings of that absence, timed by the
  catalogue's own fetch time and never by the wall clock, after a canary like any move. This explains the pinned
  statement and does not rewrite it. The spec's §2.2 and §2.8 described the older rule until wave 10 corrected them.
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
  hand pick stands it down (D-8744). The last round's minor points became a follow-up ticket
  (`repick-landing-notes`), dropped on 2026-11-22 with the typed re-pick itself (below).
- **Two changes were to wait for the Codex bridge's check week to close (2026-11-21); one landed early.** The week reads
  the doctor and the GPT lanes' usage units every day, and a merge reaches the fleet within hours. On 2026-11-19 the
  operator amended D-8689 for #2943: its four checks were measured PASS on both Codex lanes, read-only; the week's
  daily reading counts FAIL lines and `codex` WARN lines only, and the four are WARN-only under their own names; and
  its one refresh change, the reaping of stale catalogue temp files, is smaller than the client-version changes that
  already reached the refresh during the week. So #2943 landed that day. `usage-user-agent` still waits for the week to
  close, because it changes the usage poll the daily reading reads. The week closed at the 2026-11-21 00:03Z
  reading: the bridge's criteria held on all eight readings (both lanes direct with the bridge running and signed in,
  both usage polls fresh, the refresh 24 runs a day with no failure), and no doctor FAIL came from the bridge. Its
  evidence went to the bridge programme's reviewer, and #3085 merged through the queue at 00:31Z. Removing the old runtime waits until the
  owner has seen that evidence (D-8639).
- **Wave 7 leaves the README alone.** Another run's freeze holds `README.md`, and its holder declined wave 7's lines
  (the four Anthropic causes in the doctor section, the aliases file in the models section). They become a follow-up
  after that freeze lifts, named by wave 7's report. Wave 8 carries three exact README hunks under the holder's
  written consent; the Anthropic causes in the doctor section were wave 10's, and its README packet carries them.
- **A parked thread no longer parks the programme (2026-11-21).** The coordinator skill's clause 21 changed that day.
  Wave 3 had been held to absorb `main` after wave 8 landed; with wave 8 waiting on the owner for an unknown time, wave 3
  went ahead alone. Neither wave imports the other's unmerged branch: the second to land absorbs the first from `main`.
- **Doctor reads the release record through its one owner (wave 3, amending its own deviation).** #3085 gave the
  Codex client release record one owner, the Codex auth library (D-8781). Wave 3's doctor check now reads the record
  only through that library's reader, by doctor's existing bounded and isolated Python call, and hands one record to
  its unchanged decision. A missing interpreter or library reads as unavailable and skips; nothing unmeasured passes.
  The box-token test's two source scans had run to the end of the file and caught that isolated call as one of their
  own; they now stop at the end of their section, and the release lookup's isolation has its own assertion.
- **The plan's phases, and a ticket the plan cannot close (2026-11-21).** The plan gained its four phases so that the
  programme page's Work card shows what remains. `doctor-land` stays open there: #2943 landed outside a run, so the landing line
  holds no entry for it and `plan ticket-done` refuses the evidence. One run's evidence closes one ticket, so the three
  tickets folded into wave 3 (`effort-level-dropped`, `release-lookup-warn` and `revert-writes-before-refusing`) are
  dropped from the plan, with that reason, once wave 3's run finishes.
- **Landing without a further review round.** Waves 2, 4 and 6 each ended with a last fix round of minor or
  text-closable findings. The coordinator checked each with two independent Opus readers (one for conformance to the
  rulings, one for correctness) and landed it, rather than spend another review round.
- **Workers and reviews:** each wave is a dispatched worker on its own branch, read by a review run with the held-out
  panel, and merged through the queue by the coordinator. Rollout rides the release lane; nothing here moves a box by hand.
- **Acceptance reads, and the window after a move (2026-11-23, calls 627 and 628).** The acceptance run is read-only.
  Its worker holds one run-bound timer for a later read, and never polls. Both Codex lanes read a 272000-token window
  from the provider's own figure, because three of their models have no measured window. That value is kept, and
  doctor's WARN records it, rather than a hand `set-window`.
- **How the definition of done is proved (2026-11-26, call 1494, a design-level call the owner may overturn).** A
  behaviour that only shows after a Revert or a fault is proved by the merged tests at the installed commit plus a live
  reading of the installed check or surface. It is not staged on the live fleet: a fault warning cannot occur on a
  healthy fleet, and a live Revert holds real sessions on an older model until a newer one appears. A behaviour that a
  real release shows stays a live wait. The other choices were one supervised live Revert on a Codex lane, and waiting
  for a natural event for every line. The evidence, line by line, is in
  `docs/superpowers/programs/model-class-advance/acceptance-evidence.md`.
- **The next read (2026-11-26, call 1495).** The three-day read found no release on either kind of lane. The worker
  holds one more read-only recheck, seven days on. Move history is kept, so a later read loses no evidence.

## Carried constraints

- The fleet tracks `main` closely, so each wave is inert or mixed-version safe at merge.
- The repository is public: lanes are `lane-a` and `lane-b`, hosts are "the server box" and "the fleet box".
- Every head commit on a branch that edits a plan carries a `Ledger-Edit:` trailer, in the same paragraph as
  `Co-Authored-By:` so that git reads it as a trailer.
- D-8693's rulings stand: the argv-grammar refusal words stay `unreadable`. Since wave 5, an advance state word the
  server does not know reads `invalid`, with the classes kept.
- No human review holds a pull request; each lands on its required checks and the programme's own independent
  review, through the merge queue, at the head that review read.
- No remedy, item or brief hands the owner a step the system can take.

## Remaining after wave 10's docs

Merged is not released, released is not installed, and installed is not observed live. On 2026-11-26 both boxes were
measured on v0.0.1486, which holds every wave. Lines 1, 3, 4, 5 and 8 of the definition of done are proved; the
evidence is in `docs/superpowers/programs/model-class-advance/acceptance-evidence.md`. Open:

- `moves-only-forward` (line 2): a move on a build that holds every wave. It waits for a real Codex model release.
- `anthropic-follows` (line 6): labels and effort following an alias that resolves to a new model. It waits for a real
  alias change.
- `natural-move` (line 7) at a real model release: the canary, the move, a new session on the new model, and no
  sessions-behind warning 24 hours later, doctor's evidence.
- The renewal programme's evaluation evidence, which owns any claim about session renewal.

No build is left in the plan. The three open lines wait for the providers, and the acceptance worker reads again on
its timer. Nothing here moves the fleet or asks the owner for a step.
