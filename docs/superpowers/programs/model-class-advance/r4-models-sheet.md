# Wave R4: the Models sheet's write door and the sheet

A task note for the programme ledger (model-class-advance, wave R4: Task 19's POST and Task 20, as re-planned on
2026-11-16 in [the codex-arm plan](../../plans/2026-10-15-model-class-auto-advance-codex-arm.md)). The coordinator
folds what it needs into [the ledger](../model-class-advance.md); this file is not the ledger. The departures are
defined in the plan's "Deviations found" as D-8752 to D-8756, and cited here.

## What landed

- `POST /api/models/:lane`, body exactly `{action: 'hold' | 'release' | 'revert', class}`, registered from its own
  file, `server/src/laneModelsRoutes.ts` (L4, D-8754). Every decision is in `server/src/laneModelsAct.ts` (L1, pure).
  It is session-gated by the global gate (no EXEMPT row) and takes no box token. The box-token census reads its file as
  a door family of its own (`MODELS_DOORS`, both directions). The route count moved 268 -> 269, after merging `main`,
  whose renewal doors took it to 268.
- The answer to a done act carries the lane's `LaneModelsRead`, from a `show` started after the act: it never joins a
  `show` already in flight (D-8756).
- One audit line per op asked, once the op has answered, naming the device the gate measured (`device:<label>`,
  D-5229), never a session id: `ccrc-server: models: <action> <lane> <class> by <actor> -> <outcome>` (D-8753).
- The Models sheet (`pwa/src/accounts/ModelsSheet.tsx`), drawn in the `AccountSheet` shell, opens from a "Models" act
  in a Codex lane card's fold (D-8752), and reads through `useLaneModels`. `asLaneModelsRead` now reads `advance` (R3
  left it to this wave). The sheet reads the lane again after every act, whatever its outcome, and says "nothing was
  changed" only where the verb never ran.
- The hold behind a held lane lock: `server/test/lane-models-hold-race.test.ts`, the real `ccrc` and a real `flock`
  holder, skipped where `flock --version` fails, never passed.
- The spec's ring and context map names the sheet's three PWA files as C1, the context of its server half.

## How each op outcome answers

Every word is one `REFUSAL_STATUS` already had, so `shared/refusal.ts` is unchanged (D-8753). Fastify parses the body
before the handler runs, so a body that is not JSON gets Fastify's own 400 (and a non-JSON content type its own 415)
for any lane; the handler asks the roster about the lane before it reads the parsed body.

| How the op ended | Status | Answer | Did the verb run? |
|---|---|---|---|
| The lane is not in the roster | 404 | `not-found` | no |
| A parsed body off the shape, or the builder refused | 400 | `bad-request`, `why`: `bad-body`, `bad-lane`, `bad-action` or `bad-class` | no |
| `unsupported` (an agent that predates the op, an older agent's `bad-request`, or the bare local io) | 501 | `unsupported`, no cause | no |
| `not-started` | 503 | `unavailable`, `cause: not-started` | no |
| `busy` (the agent's one gate, shared with reads) | 409 | `busy`, `cause: agent-busy` | no |
| `timeout`, `too-large`, `lost` | 502 | `outcome-unknown`, `cause` the arm: never success or failure | unknown |
| exited, a refusal agreeing with its exit code | 409 | `lane-act-refused`, `verbCode` the verb's word; its sentence never crosses | yes: a revert can write its hold before it refuses |
| exited, anything off the grammar | 502 | `outcome-unknown`, `cause: unreadable` | yes |
| exited 0, `ok: true` for this lane, action and class | 200 | `{ok, lane, action, class, changed, partial, models}` | yes |

## Departures

- D-8752: the sheet opens from the fold, on every `codex`-kind lane, managed or not (a departure from D-5198), and
  Hold and Release are two buttons, not a switch.
- D-8753: the POST's words, with the two §3.11 words folded into `unsupported`, the moved statuses, and the audit
  line written after the op.
- D-8754: the POST's own routes file.
- D-8755: the verdict holds the answer's lane id.
- D-8756: no 60 s cache; the read after an act is a fresh `show`.

## Follow-ups (not this wave's)

- `revertOp` (`deploy/models-op.mjs`) writes the class's hold before it can refuse, so a refused Revert can leave the
  class held. The sheet now reads the lane again and words the refusal without claiming nothing changed; a refusal
  grammar that says whether anything was written is the coordinator's follow-up, after #2943.
- Horkos flags this PR `rules-mixed` for the `CLAUDE.md` edit. That edit is the census sentence the box-token census
  requires in the same PR as the door (`MODELS_DOORS` joins `SESSION_ONLY_ALL`, and the census reads the bullet for
  `/api/models/:lane`), so the flag is a false positive here.

## Live acceptance (not this wave's)

One Hold and one Release on lane-a from the sheet, measured in the advance file with an audit line, waits on rollout
and on the server box's roster (owner item 407). No live Revert without a ruling.
