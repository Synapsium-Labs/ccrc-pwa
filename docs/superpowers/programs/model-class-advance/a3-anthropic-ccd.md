# Wave A3: ccd (the Anthropic arm's launch, hold and record)

Programme `model-class-advance`, wave 8 of 10, ticket `anthropic-ccd`, run 2910. Plan
`docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md`, "Wave A3", Tasks A3.0 to A3.6; spec
`docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md` §2.5. Stand-ins: lane-a is the upstream lane,
and `<previous opus id>` and `<current opus id>` are the two opus ids its alias resolved to on the day.

## Task A3.0: the two measurements (D-8748)

### Step 1: the held id (D24): HELD

One print-mode prompt ran on lane-a's wrapper, from a scratch directory outside every work tree. The environment
carried `ANTHROPIC_DEFAULT_OPUS_MODEL=<previous opus id>`, the command passed `--model opus`, and the prompt asked for
one subagent with `model: opus`. A `--resume` of the same session then asked for a second subagent. Session
`56799fe0-5024-4ac3-86bd-0bc3e474351b`.

| Run | Main session's id | Subagent's id |
|---|---|---|
| first prompt | `<previous opus id>` | `<previous opus id>` |
| `--resume` | `<previous opus id>` | `<previous opus id>` (a second subagent) |

The environment key holds the class in all three places. So Task A3.4 builds the env-key form
(`_held_model_env_to`), not the `--model <held id>` fallback, and a respawned held session needs no fresh start.

One finding: the run had to be made with `CLAUDE_CODE_SUBAGENT_MODEL` unset. That variable names the model every
subagent runs on, whatever the subagent asks for, so a session that carries it runs its subagents on that model, held
or not. That is the variable's own meaning; this wave changes nothing about it.

### Step 2: the re-pick: UNMEASURED

A throwaway workspace on lane-a was spawned with `class=default` (`mca-a30-repick`, kept for the owner to reap), and
the owner was asked to type `/model <previous opus id>` there through the console. That typing had not happened when
A3.1 to A3.5 were green: the session's usage sidecar was still the one written at its spawn, reporting
`<current opus id>`. The coordinator ruled the plan's Step 3 fallback (slug `repick-unmeasured-fallback`).

### Step 3: what the result selects

- Step 1 held, so Task A3.4 builds the env-key form.
- Step 2 is unmeasured, and the coordinator ruled the fallback. Task A3.6 builds no typed move. An id change is
  recorded, never typed, and doctor's `model-sessions-behind` names a session left behind, with the relaunch remedy
  (the Anthropic arm reads that from the routing record's class and the session's own reading, Wave A2).
- The typed arm becomes the follow-up ticket `typed-repick`, gated on the owner's typing. It covers `picked=`,
  `_route_id_pending`, `_route_apply_now`'s id arm and the hand-pick read.

## What each task built

- **A3.1:** `ccd/lib/model-aliases.sh`, the seventh pinned library, and its one cached reader. `_alias_facts_to`
  reads one jq fork for all four classes, cached on the bytes of both files. `_lane_class_efforts_to` and
  `_model_id_bare_to` sit beside it. A lane with no aliases file answers `absent` with no fork at all.
- **A3.2:** the launch marker `$REG/<id>.aliaslaunch`, written only by a fresh alias launch, and the tick's own step,
  `_alias_observe`, which fills it once. The capability is `alias-launch-v1`.
- **A3.3:** `_class_takes_no_effort` at the five haiku sites. The lane's files decide first, and the haiku rule answers
  wherever they cannot say. `_route_argv_check` takes an optional first pair, `lane=<wrapper>`.
- **A3.4:** `_held_model_env_to`. A held class's id reaches every launch of the lane as
  `ANTHROPIC_DEFAULT_<CLASS>_MODEL='<id>'`, through both spawn lines, a swap and a resume, and `routeapplied`
  records `held=<class>:<id>[,…]`.
- **A3.5:** under a record's `auto`, a home's orphaned saved level rides `--effort`, while `routeapplied` keeps `auto`.
- **A3.6, the fallback's half:**
  - `_route_applied_set` takes `keep`, which leaves the stamp's mtime where it was.
  - A class change drops `model=` and `picked=` in that one writer.
  - The observe step records `model=` from a fresh reading of this session, strictly later than both the process start
    and the stamp. The class readback records the id it confirmed.
  - Nothing types a model.

Every task's tests were run red first, and every mutation row named by the plan was run and turned a named test red.

## Brief rulings carried out

- **The seventh pinned library.** `ccd/lib/model-aliases.sh` is the seventh library (the door library is the sixth).
  Every site the plan lists counts seven, and so does the redactor test's loader count (`-le 7`).
- **D-8820's hold gate is lifted.**
  - `ANTHROPIC_HOLDS_APPLIED` and its refusal are gone from `deploy/models-anthropic.mjs`, with the Models sheet's
    `alias-hold-not-applied` sentence and the codes guard's entry.
  - `server/test/modelsOpCopy.ts` is removed, so the hold, release and revert tests run the shipped op.
  - A held id now reaches every launch on the lane through Task A3.4, in this same branch.
  - The lift keeps the number D-8820.
- **F4 (review 2886): a held class records no alias move.**
  - Measured first on the Codex arm, in a new case in the models op's tests: an advance of a held class is abandoned
    (`held`), with no history entry, `previous` untouched and no push.
  - The Anthropic arm's aliases refresh now does the same. A held class's alias move writes no history and leaves
    `previous`, so a second revert holds where the first did.
  - The aliases file still records where the alias went, which is how doctor names the class held behind.
  - The asymmetry this leaves, on both arms alike: a move made while the class was held is never recorded or pushed
    after the release. The class follows the alias's current id from its next fresh launch.
- **R1 (review 2886).** `_dr_ma_blocked_fix`'s advance-file arm has an Anthropic branch:
  - Repair the file. Until then no hold reaches a launch.
  - Removing the file loses the holds and the move history, and nothing refills them.

  Wave 3 consented to the lines; it does not touch this arm. `DR_MA_ANTHROPIC` is now computed in `_dr_ma_read`, so
  every model-advance check sees it, not only the held-behind check.
- **F12(c) (review 2886).** The "Anthropic row beside a Codex row does not SKIP" doctor case plants a launch marker
  between its refreshes and asserts the class's `use` evidence.
- **The census guard's library list.** `server/test/consolidationCensus.ts`'s `CCD_LIB_FILES` gains
  `ccd/lib/model-aliases.sh`, because the census guard needs the entry (measured: two cases red without it). Another
  run's freeze covers the file. That run's coordinator accepted this one-line packet as sent (sha256 `30e48bf3…`), so
  it lands here.

## Departures, by slug (the coordinator allocates numbers)

- `repick-unmeasured-fallback`: A3.0 Step 2 is unmeasured and Task A3.6 is built as the plan's Step 3 fallback; the
  typed arm is the follow-up `typed-repick` (above). Of A3.6's test list, the recording, readback and "never typed"
  cases are built (22 cases in `server/test/ccd-route-model-id.test.ts`, plus one `ccd-tick-budget` case at the
  `idle-home` figure); the pending, re-pick and hand-pick cases, and the two tick-budget cases that plant `picked=`, go
  with `typed-repick`.
- `readme-seventh-library`: README's libraries paragraph, its restore line and its count of pins still say six. The
  holder of README's lines has not consented, and no test needs them; a follow-up updates them.
- `contexts-edges-a3`: the plan names no context-map edges, and the map's guard needed each new cross-context call
  as an edge: `_spawn_start -> _alias_launch_mark`, `cmd_supervise -> _alias_observe`, the readers' registry edges,
  `_route_applied_put -> _reg_set`, and the rest the guard listed.
- `observe-memo-read`: the observe step's steady-state read of the sidecar's bytes is `read -r -N 4096`, a bounded
  builtin, where the plan says `read -r -d ''`.
- `effort-barred-helper`: A3.3 adds one function the plan does not name, `_class_effort_barred_to`. It wraps
  `_class_takes_no_effort`, applies the haiku rule on its rc 2 and names the refusal's subject, so each of the five
  sites is one line. The refusal now names the model (`model <id> takes no effort level …`) when the lane's data
  decided, and still says `class haiku` when the standing rule did; three pins moved with the wording.
- `reader-no-file-no-fork`: the reader's first cut forked one jq per process to answer `absent`, which raised every
  `TICK_BUDGET` through `_route_effort_for_to`. A file that is not a regular readable file now answers without jq,
  with the same words the jq program gives, and no `TICK_BUDGET` figure moved.
- `held-unread-wider`: the `held-unread` line, floored per session, is written for any answer other than `facts` or
  `absent`. That covers an unreadable or invalid aliases file and a refused `hold.model` as well as an unreadable
  advance file, because a hold ccd cannot read should never be silent.
- `held-word-one-pair-list`: `routeapplied` carries one word, `held=<class>:<id>[,<class>:<id>…]`, listing every held
  class in `ROUTE_CLASSES` order, since every held class rides the launch environment. It is written only for a session
  with a routing record.
- `orphan-level-listed-only`: A3.5 carries an orphaned level only when the current row lists it, or the row has no
  effort field. A level Claude Code would refuse never stops a launch, and a model that takes none takes no carried
  level.
- `readback-records-id`: the class readback records `model=<bare id>` (with `keep`) after its class write. Four
  expectations in the route-apply tests now read `class=… model=…` after a sidecar readback.
- Test-side repairs found on the way:
  - The tick-diet static guard's `E1c` was red after A3.1, because its five out-variable forms were missing from the
    runner's planned and landed lists. They are added, with the later tasks' forms.
  - `_route_pair_note` is vendored into the tick-diet legacy fixture with its pin.
  - A3.2's no-fork trace now matches subshell levels; it matched none before.
  - Three test files' advance casts now typecheck.

## The six notes asked by the brief

Re-checked against A3.0: Step 1 held, Step 2 is unmeasured, and the fallback is ruled. So notes 2, 4 and 5 belong to
the typed arm and carry to `typed-repick` by number. Notes 1, 3 and 6 are answered for what this branch builds.

1. **Memos.** The undecided re-ask is not built here; it carries to `typed-repick`. Two steps read the sidecar in this
   branch, and they share no memo:
   - The launch marker's fill uses `_ALIAS_JUDGED`, keyed `<born epoch>:<bytes>`.
   - The `model=` recording uses its own `_ALIAS_MODEL_JUDGED`, keyed `<record>|<uuid>|<bytes>`. It drops its entry
     when tmux or the stamp cannot say, so the next tick asks again.

   Neither suppresses the other. The test `a marker judged on the same bytes does not stop the recording` pins that,
   and the mutation "share A3.2's memo" reds it. When `typed-repick` builds the undecided re-ask, it takes a third
   value of its own, never either of these.
2. **A fresh reading of ccd's own picked id is exempt from the positive hand pick:** no hand-pick read is built here.
   Carried to `typed-repick`.
3. **The builtin match on the bare picked id:** nothing in this branch writes `picked=` or matches a `picked` id.
   - The one place it is named: a class change drops `picked=` beside `model=`, so the key's lifecycle is already right
     when the follow-up writes it.
   - The recording step leaves a single, commented seam where the landed-re-pick branch (`picked=` differs from
     `model=` and the reading names `picked`) goes.
   - When it is built, the builtin match on the memo's bytes must re-compare the parsed model with `picked` after
     `_usage_sidecar_read`, because a byte match can sit in another field.

   Carried to `typed-repick`.
4. **"A failed re-pick does not wedge a newer one":** typed arm only. It carries to `typed-repick` with its mutation
   row (spend the old target's retries first).
5. **Spec §2.5.6's wording:** the list of positive hand picks naming the `/fast` and undatable rows, and A3.6's case
   count, belong to the typed arm and carry to `typed-repick`.

   The one part that is about this branch is the steady-state sentence. The observe step's steady state reads the
   sidecar's bytes with one builtin read whenever the sidecar is newer than `routeapplied` and no `model=` is
   recorded; it forks nothing once `model=` is recorded or when no `routeapplied` exists. The spec edit itself is for
   the coordinator's ledger pull request, since this branch edits no spec.
6. **Rollout edge:** a session hand-picked on an older id before rollout records that id as `model=` on its first fresh
   reading. **Decided: the first recording does not need the hand-pick read.**
   - `model=` records what the session renders, which is true whoever picked it.
   - In this branch nothing acts on `model=`: no move is typed, and doctor judges a session behind from its own
     reading and its class.
   - When `typed-repick` lands, its pending check asks the hand-pick read before any keystroke. A pre-rollout
     `/model` sits after the stamp of the spawn it was typed in, and the journal does not explain it, so the follow-up
     stands down there. It protects the operator's choice at the one point where something acts.
   - Gating the recording on the hand-pick read would instead leave `model=` absent for every undecided session, and
     an absent `model=` is never pending. That turns "unreadable transcript" into "never moved", and it puts a
     transcript read on the recording's path, which the steady tick must not pay.

## Growth

Measured armed, against the merge-base with `origin/main` fetched:

| File | Net code lines |
|---|---|
| `ccd/ccd` | +11 |
| `ccd/ccrc-doctor-checks` | +3 |
| `ccd/ccrc` | +1 (the seventh library's backup line; the uninstall list and its echo edited in place) |
| `ccd/lib/model-aliases.sh` | +302 (new) |
| `ccd (program)` | +313 |

The library carries the whole wave so that `ccd/ccd` grows only by its call sites. Its waiver, GROWTH_WAIVER, raises
the program row's limit by the same figure.

## The live gate (read-only)

- **The branch's four model-advance doctor checks** were run from the work tree against the fleet box's own files,
  with no install and no `--fix`. All four PASS, across 2 lanes:
  - `model-advance-held-back`
  - `model-held-behind`
  - `model-sessions-behind`
  - `model-advance-blocked`
- **No aliases file.** The fleet box has no aliases file yet, so on every Anthropic lane:
  - The reader answers `absent`, with no fork.
  - No marker is filled, no held key is spliced, and no orphaned level is carried.
  - The effort rule keeps the haiku rule.
  - Every new branch answers today's behaviour, which each task's "no file" tests pin.
- **Rollout.** The marker is written from the first spawn after install. The fleet box goes first at rollout.
