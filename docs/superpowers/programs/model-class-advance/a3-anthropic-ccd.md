# Wave A3: ccd (the Anthropic arm's launch, hold and record)

Programme `model-class-advance`, wave 8 of 10, ticket `anthropic-ccd`, run 2910. Plan
`docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md`, "Wave A3", Tasks A3.0 to A3.6; spec
`docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md` §2.5. Stand-ins: lane-a is the upstream lane,
and `<previous opus id>` and `<current opus id>` are the two opus ids its alias resolved to on the day.

## Task A3.0: the two measurements (D-8748)

### Step 1: the held id (D24): HELD

One print-mode prompt ran on lane-a's wrapper, from a scratch directory outside every work tree. The environment
carried `ANTHROPIC_DEFAULT_OPUS_MODEL=<previous opus id>`, the command passed `--model opus`, and the prompt asked for
one subagent with `model: opus`. A `--resume` of the same session then asked for a second subagent. The session is
named here by the stand-in `session-1` (its id is in the run's mail, not in tracked text).

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

A throwaway workspace on lane-a was spawned with `class=default` (the stand-in `probe-ws`, kept for the owner to reap), and
the owner was asked to type `/model <previous opus id>` there through the console. That typing had not happened when
A3.1 to A3.5 were green: the session's usage sidecar was still the one written at its spawn, reporting
`<current opus id>`. The coordinator ruled the plan's Step 3 fallback, D-8833 (slug `repick-unmeasured-fallback`).

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
  wherever they cannot say. `_route_argv_check` reads the caller's lane from `ROUTE_ARGV_LANE`, set for that one call, never as a route pair (D-8855).
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
  Every site the plan lists counts seven:
  - the redactor test's loader count (`-le 7`, and the hash count it asserts is 8);
  - not the entry reader's comment (`ccd/ccd-entry.py`), which still says six. This round reverts that edit: it changed
    only a comment, yet made every box replace its live launcher on update, and it added a review-judge blocker. The
    launcher's comment is a follow-up ticket, carried by the next launcher change of substance.
  - the installer (`ccd/ccd-entry-install.py`), whose change is load-bearing. Review 3006 measured that it pins the
    seventh library, stages and publishes it before the body, and re-checks the pin lines. Without it, an install of
    this tree leaves the body's pin unrendered and every ccd start refuses, so body, library and installer cannot be
    split. This is why the judge's `rules-mixed` on it stays.
  - the plan's wave contract;
  - README's libraries paragraph, its restore line and its pins' list, under the README holder's yes to the exact
    three-hunk packet (review 2964 F5).
- **D-8820's hold gate is lifted, as that entry planned** (the plan's D-8820 now records the lift).
  - Removed: `ANTHROPIC_HOLDS_APPLIED`, its refusal `alias-hold-not-applied` and the Models sheet's sentence for it.
  - `server/test/modelsOpCopy.ts` is removed, so the hold, release and revert tests run the shipped op.
  - The codes guard derives its words from the files, so it needed no edit.
  - A held id now reaches every launch on the lane through Task A3.4, in this same branch.
  - The lift takes no number of its own, and no gate replaces it: the op and the ccd that launches are one tree on one
    box.
  - One residual is named in the plan's D-8820: a supervisor still running the previous ccd body after the update's
    supervisor sweep was refused by its preflight respawns or swaps without the held id. The remedy is restarting that
    supervisor, not relaunching the session. Wave A4 carries the user-facing note.
- **F4 (review 2886, then review 2964 F4): a hold's alias move.** Measured first on the Codex arm, in a new case in the
  models op's tests: an advance of a held class is abandoned (`held`), with no history entry, `previous` untouched and no
  push, and it is recorded after the release.
  - While held, the Anthropic arm records no alias move either.
  - At the first trustworthy refresh after the release, it records the move made under the hold once: from the held-at
    id to the alias's id, with `previous` the held-at id, through the existing push (D-8857).
  - A revert in the window reads the alias. Not moved: it holds at `previous` and drops the evidence. Moved: it holds at
    the held-at id and keeps it. A second revert holds where the first did, in every order (review 3006 F1).
  - The first version of this note said the two arms behaved alike after a release. They did not: the Anthropic arm
    then never recorded that move. D-8857 corrects it.
- **R1 (review 2886, then review 2964 F7).** `_dr_ma_blocked_fix`'s advance-file arm has an Anthropic branch. It says:
  - repair the file;
  - until then, hold, release and revert on the lane are refused;
  - a hold ccd can no longer read does not reach a launch, and one it can still read keeps applying;
  - removing the file loses the holds and the move history, and nothing refills them.

  Wave 3 consented to the lines; it does not touch this arm. `DR_MA_ANTHROPIC` is computed in `_dr_ma_read`, so every
  model-advance check sees it.
- **F12(c) (review 2886).** The "Anthropic row beside a Codex row does not SKIP" doctor case plants a launch marker
  between its refreshes and asserts the class's `use` evidence.
- **The census guard's library list.** `server/test/consolidationCensus.ts`'s `CCD_LIB_FILES` gains
  `ccd/lib/model-aliases.sh`, because the census guard needs the entry (measured: two cases red without it). Another
  run's freeze covers the file. That run's coordinator accepted this one-line packet as sent (sha256 `30e48bf3…`), so
  it lands here.

## Departures

Each is defined in the plan's "Deviations found", with its reason and its cost.

| Number | Slug | In short |
|---|---|---|
| D-8832 | (growth waiver) | the library's growth, Growth below |
| D-8833 | `repick-unmeasured-fallback` | A3.6 on Step 3's fallback; the typed arm is `typed-repick` |
| D-8846 | `contexts-edges-a3` | the context-map edges the wave's calls need |
| D-8847 | `observe-memo-read` | the sidecar's bytes read with a bounded `read -r -N 4096` |
| D-8848 | `effort-barred-helper` | one helper for the five sites; the refusal names the model, the held id under a hold |
| D-8849 | `reader-no-file-no-fork` | the steady reader answers without jq with no aliases file; a launch reads the advance file alone |
| D-8850 | `held-unread-wider` | `held-unread` for every answer ccd cannot use |
| D-8851 | `held-word-one-pair-list` | one `held=` word listing every held class |
| D-8852 | `orphan-level-listed-only` | an orphaned level only when the current row lists it |
| D-8853 | `readback-records-id` | the class readback records the id it confirmed |
| D-8854 | `model-files-guards-admit-reader` | two exact-holder guards name the library as a read-only reader |
| D-8855 | `route-effort-intent` | the trusted lane rides apart from the user's pairs; a pair is judged only on a class or effort change |
| D-8856 | `hold-survives-alias-absence` | a stored hold reaches a launch with no aliases file |
| D-8857 | `held-release-reconcile` | a hold's alias move recorded once at the first trustworthy refresh after release |
| D-8858 | `observe-transcript-retry` | an undecided fill retries cheaply until the transcript appears |
| D-8859 | `orphan-only-usable-alias` | no orphaned level for a held class or an unusable id |

**A3.6's tests.** The recording, readback and "never typed" cases are built: 22 cases in
`server/test/ccd-route-model-id.test.ts`, the vacuous acknowledgement case deleted (`ccd-route-apply`'s "project-k shape"
case pins that path), plus the tick-budget cases. The pending, re-pick and hand-pick cases go with `typed-repick`, and
so do the two tick-budget cases that plant `picked=`.

**Unknown-lane fallback.** `_route_argv_check` with no known lane (`ccd start <id>`, `ws-add` without `--wrapper`)
applies the haiku rule. So it can accept a pair that `ccd route`, which knows the session's lane, would bar. Such a pair
is filtered at spawn with its floored note (review 2964 F13d).

**Where data changes behaviour at merge.** The coordinator ruled these changes "safe at merge" (review 3006 F4): they
are the wave's purpose, ruled, pinned and safe beside an older build.
- **A Codex lane** that already has its registry and catalogue takes a level for a haiku class whose pin lists levels
  (D-8750's relaxation; review 2964 F13e).
- **An Anthropic lane** whose aliases file has ids takes a haiku effort level, at the route verb and at spawn, when the
  model's row lists levels (D-8750).
- **An Anthropic lane** whose aliases file records an orphaned saved level carries it on `--effort` under a record's
  `auto` (D-8746, D-8852, D-8859).

**What the reader does not check.**
- ccd's effort-token rule is stricter than the shared parser's (`isStr`): an effort string with a space or `+` makes ccd
  answer `invalid …row` for that class, while doctor passes. Real levels are words, so this is unreached.
- The reader reads the aliases and catalogue files whole with no size cap, as the shared `_file_read_to` does. The op
  writes them `0600` at a few KB, and a same-user writer is already inside the trust boundary.

Review 2964 F13b and F13h name both, and neither is redesigned here.

**The narrow `keep` writer.** `_route_applied_put` is a writer beside `_reg_set`, and is legitimately different: only it
can carry the old file's mtime across the rename. That mtime is the stamp the readback judges a reading against. Every
write that is not kept is `_reg_set`'s, and `keep` never creates a missing record.

**Test-side repairs found on the way:**
- The tick-diet static guard's `E1c` was red after A3.1, because its five out-variable forms were missing from the
  runner's planned and landed lists. They are added, with the later tasks' forms.
- `_route_pair_note` is vendored into the tick-diet legacy fixture with its pin.
- A3.2's no-fork trace now matches subshell levels, and has a positive control.
- Three test files' advance casts now typecheck.
- `ccd-limit-no-keys` now scans every function of the library too.

**The lease gap.** This run's claims on most of the branch's paths reached their hard cap at 15:57Z on 2026-11-20 and
were taken again at 16:35Z. No commit on main touched any of those paths in that window.

## The six notes asked by the brief

Re-checked against A3.0: Step 1 held, Step 2 is unmeasured, and the fallback is ruled. So notes 2, 4 and 5 belong to
the typed arm and carry to `typed-repick` by number. Notes 1, 3 and 6 are answered for what this branch builds.

1. **Memos.** The undecided re-ask is not built here; it carries to `typed-repick`. Two steps read the sidecar in this
   branch, and they share no memo:
   - The launch marker's fill uses `_ALIAS_JUDGED`, keyed `<born epoch>:<bytes>`.
   - The `model=` recording uses its own `_ALIAS_MODEL_JUDGED`, keyed `<record>|<uuid>|<bytes>`. It drops its entry
     when tmux or the stamp cannot say, so the next tick asks again.

   Neither suppresses the other. Two mutation rows were run (review 2964 F11f):
   - Renaming the recording's memo to the marker's array reds the read-count pin, `an unchanged sidecar is read once
     for the recording, a changed one again`.
   - Sharing the array and the marker's key reds that pin, and `a marker judged on the same bytes does not stop the
     recording, nor the recording the marker`, too.

   The marker's undecided fill (D-8858) is memoed in the marker's own array, with the transcript's path kept beside it
   in `_ALIAS_TWAIT`. When `typed-repick` builds the hand-pick re-ask, it takes a value of its own, never one of these.
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
   - The caveat `typed-repick` must carry (review 2964 F13i): "after the stamp" holds only until another write moves
     the stamp. An effort change, a compaction or subagent write and a promotion all rewrite `routeapplied` without
     `keep`. So the follow-up must not rely on the stamp alone to place a pre-rollout `/model`; it needs the journal, or
     a stamp of its own.

## Growth

Measured armed, against the merge-base with `origin/main` fetched, at the end of fix round 1:

| File | Net code lines |
|---|---|
| `ccd/ccd` | +14 (+11 at the first close; +2 for the shellcheck reason lines, +1 for review 2964 F1/F2) |
| `ccd/ccrc-doctor-checks` | +3 |
| `ccd/ccrc` | +1 (the seventh library's backup line; the uninstall list and its echo edited in place) |
| `ccd/lib/model-aliases.sh` | +321 (new; +302 at the first close) |
| `ccd (program)` | +335 |
| `deploy/models-anthropic.mjs` (not a listed file) | +46 for D-8857 |

The library carries the whole wave so that `ccd/ccd` grows only by its call sites. Its waiver, D-8832
(`server/test/growth-waivers/D-8832-ccd-lib-model-aliases.json`), raises the program row's limit by the same figure. Its
maxDelta was 302 at the first close. The coordinator raised it to 321 in fix round 1 for the F3, F8, F9, F13a and F13c
fixes: the program row's limit is 40 + 321 = 361.

## Fix round 2 (review 3006): what ran

Mutation rows, each run for real from a saved copy and restored, checked with `cmp`:

| Finding | Mutation | Red |
|---|---|---|
| F1 | keep the evidence when the alias has not moved | the not-moved-then-moved second-revert case |
| F1 | drop the rule that a revert over the revert's hold holds again | the moved-back case and the unreadable-file case |
| F1 | (round 1 rows again) record the move at release; revert picks from history | 11 and 3 tests |
| F2 | a `_route_type_model` call in `_alias_model_observe` | `_alias_model_observe contains no key sender` |
| F8 | drop `model-aliases.sh` from the loader's file list and pin array | `a hashing tool that answers the loader and then prints an empty digest answers redactor-mismatch` |

Run alone through the fleet test lane, all green:

| Area | Suites |
|---|---|
| Models op | models-op 548, ccrc-models 204, ccrc-doctor-model-advance 85, lane-models-hold-race 4, lane-models-post 65, model-advance-file 134 |
| ccd | ccd-alias-launch 30, ccd-limit-no-keys 35, ccd-docs-helper-redactor 61, ccd-route-model-id 22, ccd-tick-budget 46, ccd-lib-load 103, ccd-model-aliases-read 17, ccd-spawn-held-model 19 |
| Installer | ccd-entry-install 136, install-census 76, ccd-install-stamp 18 |
| Agent | ccd-entry-exec 1, deploy-verify 120 |

The growth check is run armed at the tip; Growth above holds its figures.

## The live gate (read-only)

- **The branch's four model-advance doctor checks** were run from the work tree against the fleet box's own files, with
  no install and no `--fix`. Run at the first close, and again at each fix round's tip, all four PASS:
  - `model-advance-held-back`
  - `model-held-behind`
  - `model-sessions-behind`
  - `model-advance-blocked`

  Between the first two runs, the box's aliases refresh had started writing aliases files.
- **What the new branches meet at merge, read-only** (behaviour only, no lane and no count):
  - **No hold anywhere.** No held key is spliced and no `held=` word is written.
  - **Some aliases files have no id for any class yet.** On those lanes every new branch answers today's behaviour: the
    reader answers `facts -`, the effort rule keeps the haiku rule, and no orphaned level is carried. A fresh alias
    launch is marked and stays unfilled until a reading names an id.
  - **Some lanes have ids, and their haiku row lists levels.** By D-8750 a haiku class there takes an effort level, at
    the route verb and at spawn.
  - **Some lanes carry an orphaned saved level.** Under a record whose effort is `auto`, those sessions launch with it on
    `--effort` (D23, D-8852, D-8859), and `routeapplied` keeps `auto`.
  - **Lanes with no aliases file:** every new branch answers today's behaviour, as each task's "no file" tests pin.
- **Rollout.** The marker is written from the first spawn after install. The fleet box goes first at rollout.
