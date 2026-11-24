# Follow-up: Revert holds until something newer (revert-holds-until-newer)

Programme `model-class-advance`, epic `models-sheet`, ticket `revert-holds-until-newer`, with `ccrcdir-param-drop` (D-8757)
riding along. Run 3475. Built on `main` at #3237 (`revert-ends-itself`, merged), whose op ends a revert's hold by itself
once a newer model appears and whose `show` carries the constant `revertHoldEnds: true`. It carries the owner's ruling in
the settings audit's Models sheet row (`docs/superpowers/specs/2026-11-22-settings-audit.md`): classes always advance, and
Revert is the one brake on the sheet, a hold that ends on a newer model with no Release. Calls 411 and 412, and this
follow-up, supersede the references to the old sheet controls; calls 469, 503 and 527 (baseline evidence, the Codex
retirement exception, the persisted-writer proof, the history-scan limit) are preserved: this wave changes no hold ending,
launch, refresh or doctor policy.

## What changed

- **The write door takes Revert only** (`server/src/laneModelsAct.ts`, `server/src/laneModelsRoutes.ts`). The body is
  exactly `{action: 'revert', class}`. `hold`, `release` and `show` are refused as a bad request (`why: 'bad-action'`, the
  existing word for an action this door does not take, as `show` was already refused) after the lane is judged and before
  any read or write. Hold and Release stay the shell's and the agent's verbs (`ccrc models <lane> hold|release`); the
  builder in `shared/agent-protocol.ts` is unchanged.
- **A fresh capability read before every revert.** The route reads the lane through the one reader (`readLaneModels`,
  `{fresh: true}`, a `show` of its own) and asks a pure verdict, `revertGateVerdict`, before the act. It writes only on a
  `read` that carries `revertHoldEnds: true`, decoded as literal `true` by the one server decoder
  (`server/src/laneModels.ts#revertHoldEndsOf`). Every other answer refuses with no write, no audit line, and a word the
  existing vocabulary already has, so an older console reads each as "nothing was changed":

  | Fresh read | Refusal |
  |---|---|
  | `read` without the capability (absent, or any value but literal `true`) | 501 `unsupported`, cause `revert-hold-ends` |
  | `unsupported` (an agent that predates the op) | 501 `unsupported` |
  | `not-started` | 503 `unavailable`, cause `not-started` |
  | `busy` | 409 `busy`, cause `agent-busy` |
  | `refused` | 400 `bad-request`, the builder's `why` |
  | `unreadable` | 503 `unavailable`, cause `lane-unreadable` |
  | `absent` | 503 `unavailable`, cause `lane-absent` |

  So a stale sheet, a direct POST or an older console cannot strand a hold on a box that does not end holds, or on a lane
  that cannot be read. The act, its verdict, the audit line (one per write op asked), the post-act fresh read and the
  unknown-outcome arms are unchanged; nothing is retried. A done revert answers `changed: null`; the key stays on the wire.
- **The Models sheet offers Revert only** (`pwa/src/accounts/modelsSheetWords.ts`, `ModelsSheet.tsx`). No Hold and no
  Release control, sentence or remedy. Revert is offered on Codex and Anthropic lanes alike (D-8930's withholding ends)
  where `revertHoldEndsOn(read)`, the one predicate, holds (the read is `read` and carries literal `true`), and the class is
  revertable with a previous model (the card's "A revert would put back …" line now shows only where Revert is offered, on a
  Codex lane); the busy and offline guards are unchanged and cover every class. The PWA's one reader of
  the server's wire (`pwa/src/lib/models.ts#asLaneModelsRead`) keeps `revertHoldEnds` only as literal `true`.
- **The words.** A held row says who made the hold ("Held by a revert since …" or "Held by hand since …") and, where the box
  ends holds, one shared sentence: "It ends by itself once a newer model appears; nothing needs doing." It names no model and
  promises nothing of the next refresh, so a hand hold is not told a Revert's story. The confirm says the hold ends by itself
  and nothing needs doing to lift it; the done line says the same. On a read that does not prove the capability, with the
  advance record read, the lane says "This fleet box's ccrc does not end a revert's hold by itself, so Revert is not
  offered. Updating the fleet box brings it back." Existing holds, including ones the shell wrote, stay visible there with
  no ending sentence and no remedy. Degraded, waiting and transient readings are unchanged.
- **Fix round 1 (call 555, review 3487 F1).** On an Anthropic lane the Revert confirm names the class, the hold and its
  automatic ending, and no model: "Put the <class> class on <lane> back to an earlier model and hold it there. The fleet box
  picks that model from its own record, and the sheet shows it once it has read the lane again." The card no longer says "A
  revert would put back …" there either. A Codex lane keeps its exact target in both places ("Put back <model> and hold …").
  The read after the act shows the model the revert put back. No wire, gate, writer, shell verb or hold policy changed.
- **D-8757 (`ccrcdir-param-drop`).** `readLaneModels(io, lane, opts?)`: the unread directory parameter is gone, with the
  route's `ccrcDir` dependency and every caller argument. The two caller lines in files held by other sessions changed only
  by the exact replacements their holders consented to (the GET read and the door's wiring and comment in `server.ts`; the
  typed-repick reader in `watch.ts`).
- **Descriptions.** `CLAUDE.md`'s sentence on the door, the box-token census note and the ring note say Revert only; the
  census still pins the route's one registered path, a POST, session-gated, in no EXEMPT table.

## Proof

Tests ran through `ccrc test` in fixture HOMEs, foreground. No full suite ran locally. The counts in this section are
the worker's, taken on the head before fix round 1; the review's own counts follow it, under "What review 3493
measured", and are a different set.

- Server, door: new `lane-models-revert-door.test.ts` (the verdict over every read arm; Codex and Anthropic `show` bodies
  with the capability, without it and with `'true'`, `1`, `false`, `null`, `{}`; every pre-read arm with no write and no
  audit line; an older console's Hold and Release with no io call; success with the fresh read; timeout, lost, too-large
  and unreadable outcomes with exactly one revert call). The post, audit and hold-race files were moved to Revert; the
  hold-race file keeps every persisted-file assertion of the lock-order proof, issuing Hold through the same local-arm op the
  door's act runs on, and adds the door refusing Hold with the file unchanged. Red first: 88 failed before the door changed;
  then 124 passed in the four door files.
- Server, neighbours: box-token census, auth gate, verb codes, rings, single definition, anchors, citations and the
  CLAUDE.md readers: 56 files, 2,890 passed, and 4 files, 94 passed, after the D-8757 change. Typecheck clean for the server
  and its tests (the test tree's only output is the agent package's missing dependency in this worktree).
- PWA: the reader, words and sheet files red first (1, 15 and 71 failures), then 275 passed across six files with the
  accounts screen and the census scans; 142 passed after the follow-ups; `tsc` clean. Both Models sheet browser fixtures ran
  headless: 11 passed (the Codex fixture with two Revert controls, the Anthropic fixture with one, widths and containment
  unchanged).
- One unrelated slow case: the drawer's secret-masker case "a long path, a URL, a git sha…" timed out at 20 s under load
  once; the file is untouched here, and alone it passed (96 passed, 1 skipped).

### Mutation rows

Each row edited one source line in place, ran the named tests, and restored the file; the restored tree is green.

| Row | Mutation | Result |
|---|---|---|
| S1 | the gate acts on a read without the capability | red (15) |
| S2 | the route does not apply the gate's refusal | red (25) |
| S3 | the door lets Hold and Release through | red (6) |
| S4 | the server reader takes any truthy capability | red (7) |
| S5 | the capability read joins a read in flight instead of its own | red (2) |
| P1 | the PWA reader takes any truthy capability | red (1) |
| P2 | a card offers Revert without the capability | red (7) |
| P3 | the capability predicate is inferred from a read alone | red (5) |
| P4 | a held row promises its ending on a box that does not end holds | red (3) |
| P5 | the lane note on an older box is never drawn | red (3) |
| P6 | the withdrawal of an open confirm ignores a read that lost the capability | red (1): it covers withdrawing a confirm that is no longer eligible, not the Yes handler's defensive re-check, which the render guard makes unreachable |

## Known limits, for the ledger

- The capability read and the act are two calls: a fleet box replaced by an older build between them is not caught (no
  atomicity across a box replacement is promised). The op's own refusals still apply to the act.
- On the agent arm a `GET` whose `show` is still in flight makes the capability read answer `busy`, so a revert tapped at
  that moment is refused `busy` before any write, one step earlier than before; the sheet reads again after every act.
- A revert now costs two `show`s (the capability read and the post-act read).
- The post-Release window (D-8857): after a shell Release, an Anthropic Revert puts back the released hold's id when the
  alias has moved off it, not the read's `previous`. The released-hold evidence may outlast a refresh, when a Revert hold
  stands at that refresh. It is cleared when that hold ends. Other ways it goes, none of them exhaustive: a trustworthy
  refresh with no hold standing records the move from the released id and clears it; a later Release replaces it; and the
  first Revert after a Release that finds the alias unmoved clears it. No time and no manual remedy is promised. The act is
  correct and the read after it shows what happened; the read carries no release evidence, so the Anthropic confirm and
  card predict no target (fix round 1). On the current writers, the first Revert after a Release can pick the released id
  when the alias has moved off it. A repeat Revert over the resulting Revert hold keeps that id and can refresh the hold's
  timestamp; it cannot change the model. It stays offered because the sheet's read carries no release evidence, so the
  sheet cannot tell a first Revert from a repeat, and eligibility is the unchanged one (a previous model, the capability
  and the existing guards). No UI changed.
- An older console reads the new refusal cause `revert-hold-ends` (501 `unsupported`) as its generic sentence that the fleet
  agent predates the act: the same remedy (update the fleet box), and nothing written.
- An older console tapping Hold or Release on the new door is refused as a bad request (`bad-action`). It says nothing was
  changed and re-reads, but its own sentence for that word reads "That action is not hold, release or revert", which is
  inexact for those two; a reload brings the new sheet, which offers neither.
- The refusal sentences an Anthropic Revert can now reach (`alias-source-absent`, `aliases-file-unreadable`,
  `aliases-file-invalid`, `settings-overrides-hold`) were reworded for a Revert (the whole-branch review's one Important
  finding): no hold as the act's reason, no button, no promise that a refresh or a next session records anything.

## What review 3493 measured

Review 3493 read fix round 1's head (call 555) and is the evidence for the counts below. They are the reviewer's, not the
worker's counts above, and not the old head's. The worker's own reported count at fix round 1's head was 259 focused
passes; it is recorded here as that report only, with its file set unmeasured, and is a different set from 246 and 11.

- **Unit and screen files:** 246 passes across `models`, `models-sheet-words`, `models-sheet` and `accounts-screen`.
- **Browser:** 11 passes on the successful attempt (both Models sheet fixtures, headless).
- **Mutations**, each restored to green afterwards:

  | Mutation | Result |
  |---|---|
  | the old Revert confirm wording | two intended reds |
  | the old card prediction ("A revert would put back …" on an Anthropic lane) | one red |
  | the confirm call drops the Anthropic lane-kind flag (M3) | one red |
  | the screen's Anthropic lane-kind flag forced false (M4) | the units stay green; the Anthropic browser case reds, 3 of 3 |

  M3 and M4 mutate the lane-kind flag (the lane's telemetry being Anthropic), not the fleet's literal-`true` support
  capability. M4 shows where the screen's lane-kind wiring is proved: the units stay green when the screen's flag is
  forced false, and the Anthropic browser case is what turns red. The support capability's own proof is the reader,
  predicate and door rows above.
- **Server proof carried, not rerun.** Review 3487 measured the door, the gate and the persisted-file assertions. Fix
  round 1 changed no server file, so that proof stands on byte-identical inputs and was not rerun.
- **P6 is the withdrawal announcement, not the Yes handler.** Per review 3493, losing the withdrawal announcement gives
  one red while the render guard still removes the dialog, and disabling the defensive Yes re-check gives no red, since
  the render guard makes it unreachable. This is historical measured evidence, not a rerun on this docs branch.
- **Limits preserved,** unchanged by the review: the two-call race (the capability read and the act are two calls), the
  busy preflight one step earlier, and an older console's wording for the new refusals.

## Cross-checked against calls 469, 503, 527, 555 and 561

This follow-up changes no hold ending. What those calls fixed together still stands, and this note adds none of it (the
calls are read as a set here, not row by row):

- an old hold ends only on usable baseline evidence: with none, it waits, and the refresh stamps what it can observe;
- a successful Revert to the same model ID, or one that changed only the effort, is skipped when the model-changing
  history is read, and an earlier qualifying Revert still counts;
- the history scan does not cross episodes, a limit that stays;
- doctor names no deadline it cannot measure: it says what the files show, not when a refresh will act;
- the producer proof is the same write: the one write that records a move clears the hold, and the Codex retirement
  exception stays, a held pin missing past six hours of continuous fresh sightings ending its hold;
- the sheet and its write endpoint offer Revert alone, on a class with explicit literal-`true` support; Hold and Release
  stay shell and agent verbs; an Anthropic Revert's copy predicts no target and a Codex Revert's names it, the fresh read
  after the act being the authority.

## Carried, unchanged

- Live acceptance of the sheet after this ships, and rollout, are not part of this wave.
- The launcher-library count and the watchdog header stay carries for the next substantive edit to their files.
