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
| R2 | Doctor's four warnings | #2943 | built and green; a draft until 2026-11-21 |

The hourly advance has moved classes by itself, each move after a passing canary: one class on both Codex lanes on
2026-10-26, and on one lane an opus class that stepped to an older model on 2026-11-10 and back two hours later (wave 3
explains it).

## Waves

The programme's plan (`ccrc-api plan show model-class-advance`) holds the same epics, tickets and checkpoints.

| # | Epic | Ticket | Scope | PRs | State |
|---|---|---|---|---|---|
| 1 | catalogue-current | client-version-now | Raise the catalogue probe's Codex client version to the current Codex release | | open (run 2450) |
| 2 | catalogue-current | client-version-tracks | Track that version automatically: a recorded fallback, and a doctor warning when it lags | | planned |
| 3 | catalogue-current | backward-move | Explain the step to an older model and back; fix the cause | | planned |
| - | doctor | doctor-land | Land #2943 after the Codex bridge check week | #2943 | built; lands after 2026-11-21 |
| 4 | models-sheet | models-sheet | `POST /api/models/:lane` hold, release and revert, and the Models sheet; closes #1441 | | planned |
| 5 | read-path | retire-grant | Retire the model-file read grant; an unknown advance state reads `invalid` with the classes kept | | planned; waits on item 406 |
| 6 | anthropic-arm | anthropic-plan | Amend the spec's D18 with the measured alias evidence, and plan the arm | | planned |
| 7 | anthropic-arm | anthropic-writer | The alias file, holds and doctor causes on Anthropic lanes | | planned |
| 8 | anthropic-arm | anthropic-ccd | ccd launches a held class on its pin and carries effort to the new model | | planned |
| 9 | anthropic-arm | anthropic-pwa | Labels and the Models sheet on Anthropic lanes | | planned |
| 10 | acceptance | docs-and-issues | The README's context-window rule, the spec's status, #2607, and the Fable-ceiling issue | | planned |
| - | acceptance | natural-move | Watch the next real release through: canary, move, a new session, no sessions-behind warning | | watched from wave 1's rollout |

Order: wave 2 builds on wave 1's constant; wave 3 runs beside wave 2. Wave 4 can start now (it needs only R3). Wave 5
waits on item 406. Wave 6 is docs and can run beside waves 1 to 4. Wave 7 waits on #2943 (the same doctor file and
writer), wave 8 on wave 7, and wave 9 on waves 4 and 7. Wave 10 is last.

## Waiting on the owner

- **Item 406:** confirm the server box runs v0.0.1259 or later. Wave 5 waits on it.
- **Item 407:** both Codex lanes marked as Codex lanes in the server box's roster. The phone's move notices and wave 4's
  sheet need it.

## Decisions & deviations

- **Deviation block:** six numbers, 8743 to 8748, issued 2026-11-18 at run 2450's open. Each is defined in the plan of
  the wave that departs, never here first.
- **The catalogue's client version (2026-11-18).** A Codex-lane session reported its class on an older model of its
  family after a newer release. The lane's catalogue was fresh (read hourly, 24 runs a day, no failures) and did not
  list the newer model. `ccd/ccrc-models-probe` asks the Codex catalogue as client `0.160.0`, a constant since
  2026-09-09 (#71), whose own comment says the backend keys what it advertises on that version; the published Codex CLI
  was at `0.170.0` that day. The working cause is that the backend withholds models that need a newer client. It is
  not yet measured: a hand-run fetch at a newer version was refused by the session hook as an account act, so wave 1's
  release and the next hourly refresh are the measurement.
- **Ruling, to be defined in wave 2's plan:** the client version follows published Codex releases. This reverses the
  registry spec's "bumped deliberately" rule (§5) under the operator's 2026-10-07 rule. Its cost if wrong: a new client
  version can list a model the bridge serves badly; each move still waits on a passing canary, and a hold stops a class.
- **Workers and reviews:** each wave is a dispatched worker on its own branch, read by a review run with the held-out
  panel, and merged through the queue by the coordinator. Rollout stays the owner's.

## Carried constraints

- The fleet tracks `main` closely, so each wave is inert or mixed-version safe at merge.
- The repository is public: lanes are `lane-a` and `lane-b`, hosts are "the server box" and "the fleet box".
- Every head commit on a branch that edits a plan carries a `Ledger-Edit:` trailer.
- D-8693's rulings stand: the argv-grammar refusal words stay `unreadable`, and an unknown advance state stays
  `unreadable` until wave 5. No wave adds an advance state word before wave 5 lands.
- #2943 is never rebased: its README bytes were consented exactly as they are.

## Next-wave brief (wave 1)

- Ticket `client-version-now`. In `ccd/ccrc-models-probe`, raise `CODEX_CLIENT_VERSION` from `0.160.0` to the current
  published Codex release, and update anything that pins the old value. Change nothing else.
- Tests run through `ccrc test`, including the models-probe suite.
- After merge and the fleet's update, the coordinator reads the next hourly catalogue for a newer model in a followed
  family, and the class history for a canary-passed move.
