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
  revertable with a previous model; the busy and offline guards are unchanged and cover every class. The PWA's one reader of
  the server's wire (`pwa/src/lib/models.ts#asLaneModelsRead`) keeps `revertHoldEnds` only as literal `true`.
- **The words.** A held row says who made the hold ("Held by a revert since …" or "Held by hand since …") and, where the box
  ends holds, one shared sentence: "It ends by itself once a newer model appears; nothing needs doing." It names no model and
  promises nothing of the next refresh, so a hand hold is not told a Revert's story. The confirm says the hold ends by itself
  and nothing needs doing to lift it; the done line says the same. On a read that does not prove the capability, with the
  advance record read, the lane says "This fleet box's ccrc does not end a revert's hold by itself, so Revert is not
  offered. Updating the fleet box brings it back." Existing holds, including ones the shell wrote, stay visible there with
  no ending sentence and no remedy. Degraded, waiting and transient readings are unchanged.
- **D-8757 (`ccrcdir-param-drop`).** `readLaneModels(io, lane, opts?)`: the unread directory parameter is gone, with the
  route's `ccrcDir` dependency and every caller argument. The two caller lines in files held by other sessions changed only
  by the exact replacements their holders consented to (the GET read and the door's wiring and comment in `server.ts`; the
  typed-repick reader in `watch.ts`).
- **Descriptions.** `CLAUDE.md`'s sentence on the door, the box-token census note and the ring note say Revert only; the
  census still pins the route's one registered path, a POST, session-gated, in no EXEMPT table.

## Proof

Tests ran through `ccrc test` in fixture HOMEs, foreground. No full suite ran locally.

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
| P6 | the confirm's re-check ignores a read that lost the capability | red (1) |

## Known limits, for the ledger

- The capability read and the act are two calls: a fleet box replaced by an older build between them is not caught (no
  atomicity across a box replacement is promised). The op's own refusals still apply to the act.
- On the agent arm a `GET` whose `show` is still in flight makes the capability read answer `busy`, so a revert tapped at
  that moment is refused `busy` before any write, one step earlier than before; the sheet reads again after every act.
- A revert now costs two `show`s (the capability read and the post-act read).
- An older console tapping Hold or Release on the new door is refused as a bad request (`bad-action`). It says nothing was
  changed and re-reads, but its own sentence for that word reads "That action is not hold, release or revert", which is
  inexact for those two; a reload brings the new sheet, which offers neither.
- The refusal sentences an Anthropic Revert can now reach (`alias-source-absent`, `aliases-file-unreadable`,
  `aliases-file-invalid`, `settings-overrides-hold`) were reworded for a Revert (the whole-branch review's one Important
  finding): no hold as the act's reason, no button, no promise that a refresh or a next session records anything.

## Carried, unchanged

- Live acceptance of the sheet after this ships, and rollout, are not part of this wave.
- The launcher-library count and the watchdog header stay carries for the next substantive edit to their files.
