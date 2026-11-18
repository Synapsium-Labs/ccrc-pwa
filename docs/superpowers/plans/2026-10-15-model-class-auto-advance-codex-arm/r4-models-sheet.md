# Wave R4: the Models sheet's write door and the sheet

A task note for the programme ledger (model-class-advance, wave R4: Task 19's POST and Task 20, as re-planned on
2026-11-16). The coordinator folds what it needs into the ledger; this file is not the ledger.

## What landed

- `POST /api/models/:lane`, body exactly `{action: 'hold' | 'release' | 'revert', class}`, registered from its own
  file, `server/src/laneModelsRoutes.ts` (L4). Every decision is in `server/src/laneModelsAct.ts` (L1, pure). It is
  session-gated by the global gate (no EXEMPT row), takes no box token, and the box-token census reads its file as a
  lane source of its own (`MODELS_DOORS`, both directions). The route count moved 265 -> 266.
- The answer to a done act carries the fresh `LaneModelsRead` of the lane, read after the act and only on a done.
- One audit line per op asked, naming the device the gate measured (`device:<label>`, D-5229), never a session id:
  `ccrc-server: models: <action> <lane> <class> by <actor> -> <outcome>`.
- The Models sheet (`pwa/src/accounts/ModelsSheet.tsx`), drawn in the `AccountSheet` shell, reading through
  `useLaneModels`. `asLaneModelsRead` now reads `advance` (R3 left it to this wave).
- The hold racing the hourly commit: `server/test/lane-models-hold-race.test.ts`, through the real local arm, the real
  `ccrc` and a real `flock` holder. It is skipped where `flock --version` fails, never passed.

## How each op outcome answers

Every word is one `REFUSAL_STATUS` already had, so `shared/refusal.ts` is unchanged.

| How the op ended | Status | Answer |
|---|---|---|
| The lane is not in the roster | 404 | `not-found`, before the body is read |
| A body off the shape, or the builder refused | 400 | `bad-request`, `why`: `bad-body`, `bad-lane`, `bad-action` or `bad-class` |
| `unsupported` (the agent predates the op, or the bare local io) | 501 | `unsupported` |
| `not-started` | 503 | `unavailable`, `cause: not-started` |
| `busy` (the agent's one gate) | 409 | `busy`, `cause: agent-busy` |
| `timeout`, `too-large`, `lost` | 502 | `outcome-unknown`, `cause` the arm: never success or failure |
| exited, a refusal agreeing with its exit code | 409 | `lane-act-refused`, `verbCode` the verb's word; its sentence never crosses |
| exited, anything off the grammar | 502 | `outcome-unknown`, `cause: unreadable` |
| exited 0, `ok: true` for this lane, action and class | 200 | `{ok, lane, action, class, changed, partial, models}` |

## Deviations found (slugs; the coordinator numbers them)

- `models-sheet-opens-from-the-fold`: D-8686 says the sheet sits "in the account sheet, not behind a row button", and
  the brief names `pwa/src/accounts/AccountSheet.tsx`. That file is the shared shell the connect, re-auth and switch
  sheets draw in; the Accounts screen has no per-account sheet. Ruled by structured ask on 2026-11-18: a "Models" act
  in a Codex lane card's fold opens a `ModelsSheet` drawn in the `AccountSheet` shell.
- `models-post-reuses-route-words`: the POST answers only words `REFUSAL_STATUS` already holds, with a `cause`,
  `why` or `verbCode` beside the word, rather than §3.11's own table (`no-such-lane`, `agent-predates-op`,
  `verb-missing`, `link-down`, `timeout` as words). The distinctions are all kept; the words are the account routes'.
- `models-post-own-routes-file`: the POST registers from `server/src/laneModelsRoutes.ts`, not beside the GET in
  `server.ts`, so the census can read it as a door family of its own (the brief's "its own door"). The GET stays where
  #2736 put it.
- `models-post-answer-checks-the-lane-id`: the verdict also holds the verb's answer `id` to the lane asked, as
  `readShowAnswer` does for `show`.
- `models-post-no-cache`: §3.11's 60 s cache is not built; #2736's `no-store` stands for the POST too (D-8693).
- `gate-docstring-count-stays-behind`: `server/src/auth/gate.ts`'s docstring numeral moved +1 (262 -> 263), under
  its claim holder's consent for that line only; it was already three behind `auth-gate.test.ts` and stays so.

## Live acceptance (not this wave's)

One Hold and one Release on lane-a from the sheet, measured in the advance file with an audit line, waits on rollout
and on the server box's roster (owner item 407). No live Revert without a ruling.
