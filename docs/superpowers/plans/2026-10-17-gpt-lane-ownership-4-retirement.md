# GPT lane ownership — Plan 4: retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **That applies to Parts A and C only.** Task G0 and Part B are a live runbook. The controller session executes them with the operator present, and they are never dispatched to a subagent, a Workflow, a fleet worker or the handoff lane.

**Goal:** Retire the old GPT-lane path now that both live lanes run on ccrc's own. This is spec §15 step 4, after which rolling back to the old path is no longer a few commands.
- **Task G0** reads the gate and runs the read-only census that builds Part B's removal list.
- **Part A (Tasks A1–A3)** is one pull request in the other repository: the GLM wrapper's install notes move into its handoff README, two historical documents are trimmed, its test file is split per method, and its ten GPT-lane files are deleted.
- **Part B (Tasks B1–B3)** is the live cleanup on the fleet box: the census again, then one authorised window that snapshots every listed path and removes it, then a verification.
- **Part C (Tasks C1–C5)** is one ccrc pull request: `_models_litellm`'s external arm and the probe's external fetch are deleted with the pins that only served them, the `BASE_LIVE_SHAPE` rehearsal is retired, citations of the deleted files are repaired, and spec §23 is appended.

**Architecture:** Nothing new runs. Part B drives only `cp -a`, comparisons that print nothing, `rm` on exact paths, one `rm -r` of one drop-in directory, and one `systemctl --user daemon-reload`. Part C deletes the external arm and fetch, and adds only the LiteLLM dispatcher's own refusals (one roster read) and C4's remedy text. The dispatcher's two fall-through answers become refusals: `no-such-account` for an id the roster lacks, `not-codex-kind` for a row that is not codex-kind, and `roster-absent` for a missing roster, all exit 1. On the fleet box's live shape, which has no `external` row, Part C's merge is inert.

**Tech Stack:** bash, Python `unittest` and Markdown in the other repository; `stat`, `cmp`, `diff -rq`, `cp`, `rm`, `systemctl --user`, `/proc` reads and `ccrc doctor` on the box; bash, Node ESM and vitest in this tree.

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`. This plan implements §15 step 4 as §20.9 reshapes it: "once no external lane has a codex registry, it deletes `_models_litellm`'s external arm, the probe's token-directory default, the external probe path's direct `auth.json` read, and the two guards §20.1 and §20.2 add". It argues from Plan 3b's "Carry-forward to Plan 4" (`docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md`) and amends it by measurement where Deviations found says so. C5 appends `## 23. Amendments (Plan 4)` under §19's rules.

> **Measurements.** "The 2026-10-17 census" means read-only measurements taken while this plan was drafted: in this tree at `66b9e1e22` (`origin/main`), in the other repository at its current remote `main`, and on the operator's fleet box. The reports are not tracked. Live values appear here by shape only.

---

## Global Constraints

Every task's requirements implicitly include this section.

**All parts**
- **This repository is PUBLIC (AGPL-3.0).** No tracked byte, PR body, commit message or ticket names the other repository or its layout, a lane id, an account or login name, an email, a host, a port, a live-box version, a real model id or a count that sizes the operator's fleet. The other repository's two remaining wrappers are "the GLM wrapper" and "the K3 wrapper". "The other repository's handoff directory" means its tracked directory; `~/.handoff` means the box's runtime directory, which the other repository's tooling also uses. Live values are parameters: `<lane-1-id>`, `<lane-2-id>`, `<UTC>` (a `%Y%m%dT%H%M%SZ` stamp), `<tag>` (a backup's label).
- **Part C's fixture vocabulary is Plan 3a's** (`codex-a`, `codex-b`, `ext-a`, `ext-b`, `gen-a`, `test-token-not-a-secret`, `gpt-x`, `probe-model`) plus the ids `ccrc-models.test.ts` already uses.
- **Deviation numbers are issued, never chosen.** This plan's departures carry the numbers the ledger allocator issued when it was published. A departure found during execution is written `⟦D:<short-slug>⟧` and the controller mints its number. Never write a number nobody issued, a `D-TBD`, or reserve a range.
- **Secrets are never printed, logged, stored in `$P4` or hashed.** That covers `auth.json`, any `runtime.env`, `~/.handoff/env`, any unit's `Environment=` and the usage drop-in's `path.conf`. The only reads of them allowed are `stat`, a comparison that prints nothing (`cmp -s`, `diff -rq`, which prints names only), a `cp -a` into Part B's `0700` snapshot, and G0's Exec-line filter, which prints `Exec*` values only. Never `systemctl cat`, which prints drop-ins and `Environment=` lines.
- **Never stop a lane's tiers by name, and never match loosely.** ccrc's live tiers are `ccgpt-<lane-id>-{litellm,shim}.service`, both lanes' shims run `~/.local/bin/ccgpt-proxy.py`, and ccrc's usage publisher runs `~/.local/bin/ccgpt-usage.py`. So `ccgpt stop`, `systemctl --user stop 'ccgpt-*'`, `pkill`, `killall`, an unanchored `pgrep -f`, and any glob over `~/.local/bin/ccgpt*` or `~/.handoff/*` are forbidden in every part. `~/.local/bin/ccgpt` is a prefix of ccrc's own file names, so a path matches only as a whole token. One lane's id may be a prefix of another's, so a lane's files are named by their full recorded names, never by a prefix filter.
- **Never run the destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`, `ws-reclaim`, `ws-expire`, `ws-collect`). Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit, except to read.
- **No rollout, update or deploy by hand.** Part C reaches the boxes through the updater when it merges.
- **Docs links.** A tracked file or a PR body links a document by its GitHub `blob/main` URL.

**G0 and Part B (the live runbook)**
- **Controller-executed only, with the operator present,** under the authorisations in [Authorisation shapes](#authorisation-shapes).
- **`$P4` is `~/.ccrc-p4`** (`0700`, outside every tree, so a scratch sweep cannot take it). It holds `values.sh` (`0600`), `rulings.txt`, the census script and its output, `remove.list`, the baselines and the dates. Real values live only there and in the snapshot.
- **Every removal names one path from `remove.list`,** which the operator reads before B2. No glob, no `rm -r` except the usage drop-in directory, and no path that is not on the list.
- **Snapshot before remove.** Every listed path is copied into `~/.ccgpt-retired-<UTC>/` (`0700`) and proved equal before anything is removed. A rollback restores from it.

**Part A (the other repository)**
- **A fresh worktree at the other repository's current remote `main`.** Its existing checkout sits on a local `main` many commits behind its remote and carries another session's uncommitted edits: never edit, stash, check out or commit in that working tree. Fetch, then `git worktree add <scratch>/retire -b <branch> origin/main`. The branch name is chosen there and recorded only in that repository's PR.
- **Its tests run per the module's docstring,** from the repository root, with `python3 -m unittest`. That repository has no CI for them. The current test file's GPT-lane cases exec its launcher, so the file is never run before A2's split; only counted.
- **No email and no account name is added.** After Part A, an email regex (`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}`) over every file Part A touched finds no address.
- **The PR is reviewed there and merged by the operator.**

**Part C (the ccrc PR)**
- **Plan 3b Part A's code conventions hold:** fixture HOMEs only; suites in the foreground from inside their package with a timeout of at least 600000 ms, as `./node_modules/.bin/vitest run test/<file>.test.ts`; `server/test/ccrc-doctor.test.ts` in its three `-t` parts; `test/typecheck-tests.test.ts` after a test-file edit; the known load flakes re-run in isolation; never spell `writeFileSync` in `ccd/ccrc`; commits on the workspace's own branch with the noreply identity and the `Co-Authored-By` trailer the executing session's attribution instruction gives, messages passed as `git commit -F - <<'EOF' … EOF`; squash-merged with `--admin`.
- **Mutation-table discipline.** Every new refusal and ratchet ships with a mutation row measured both ways, with counts. A row that does not red is reported, never forced.
- **Each of C1–C3 records its case decisions** in `cases.tsv` in the plan's SDD workspace directory (git-ignored): old case, `deleted` or `re-seated`, new case name, the spec mutation-table row it carried. Its commit message carries the same table. C5 reads the file to write §23.5.
- **Three files are not edited, whatever their comments say:**
  - `deploy/litellm-config.template.yaml`. Its header is copied into each lane's rendered `litellm.yaml`, so one byte changes both renders, and the next hourly refresh restarts each lane's running LiteLLM tier.
  - the placed unit files under `deploy/systemd/`, which a byte change re-places on every box.
  - `ccd/ccd`, which is generated.
- **Spec amendments are appended, never inserted.** C5 appends §23 after the spec's last line and makes only same-line pointer edits above it, in the form the spec's earlier amendments use: ` (amended: §23.N, D-NNNN)`.

## Review Focus

Five failure modes the spec implies that no earlier task exercised, most likely first. Items 1 and 5 are live-runbook failure modes, pinned by G0's census and Part B's stop conditions; items 2–4 are pinned by Part C's tests.

1. **A loose match in the cleanup reaching ccrc's live lane.** ccrc's tiers are named `ccgpt-<lane-id>-*` and run `ccgpt-proxy.py`, its publisher runs `ccgpt-usage.py`, and unit files spell paths as `%h/…`. An unanchored `pgrep -f ccgpt`, a `ccgpt*` glob, a text match against `systemctl cat`, or the carried list's ".py copies" would stop or delete the live lane, or see nothing and read as clean. Expected: nothing ccrc ships, runs or places is on the list, and a census that cannot see is never mistaken for a clean box. **Pinned by G0's census:** argv, `exe`, `fd` and `maps` matched as whole paths; the old LiteLLM path not running (b2); every `Exec*` value read with specifiers expanded, from loaded units and from unit files; a byte-compare against ccrc's whole shipped tree and every file it places; a KEEP-set check by name. Each of (a), (b), (c) and (f) has a control that must see ccrc's own files or live users, or the census stops.
2. **A remedy that names a probe nothing places.** `deploy/models-op.mjs` tells the operator to run `ccrc-models-probe` by name. ccrc stopped placing it on PATH in Plan 3a, so the name resolves to a stale copy that B2 removes, and then to nothing. Expected: the remedy names a command that exists. **Pinned by C4:** the remedy names `ccrc models <id> discovery add`, the verb that runs the probe ccrc ships.
3. **A non-codex row that still holds a codex registry, meeting the hourly refresh after the arm is gone.** On the live flow the probe runs first and refuses (`no-token-dir`, or `runtime-absent` when the row's secrets file sets `CHATGPT_TOKEN_DIR`). With a probe answer in hand, the dispatcher refuses `not-codex-kind`. Expected: either way the row is `ok:false`, nothing is rendered, stopped or written, and `ccrc models refresh --all` exits 1. **Pinned by C1** (the dispatcher's refusal, with the probe fixture) **and C2** (the probe's refusal, without it, through `--all`).
4. **An inherited `CHATGPT_TOKEN_DIR`, or a populated retired default token directory, on a non-codex row's codex probe.** The deleted `_fetch_codex` used that directory as a default. Expected: a row that nothing hands a directory refuses `no-token-dir`; a row whose secrets file sets one refuses `runtime-absent`, because its interpreter is withheld; neither reads the directory. **Pinned by C2.**
5. **A rollback after removal.** Expected: every removed path comes back byte-equal, with its type, mode, mtime and link target, from the snapshot alone, and a rollback run twice, or onto something that came back, never nests a directory or writes through a link. **Pinned by B2:** Step 3 rehearses the restore into a scratch directory before anything is removed, and the rollback restores only into absence.

---

## The gate, and the order of the parts

**Plan 4 starts only when operator ruling R-O9-REPLACED's items hold and the operator gives an explicit go** (spec §2.11's standing authorisation of the eventual removal, plus that go). R-O9-REPLACED (2026-10-17) replaced Plan 3b's calendar soak (D-5303). Its items:
- (i) Part B's removal list is corrected and checked read-only: no path on it is byte-equal to a file in ccrc's shipped tree or `CODEX_LANE_BINS`, run by a ccrc unit's `ExecStart`, or named by a running process. Checked at drafting (the 2026-10-17 census), run as G0's census before Part A, and re-run in B1 and B2.
- (ii) Lane 1's credential refresh after the ruling passed cleanly: its `auth.json` was written since its previous write, with 0 failed usage publishes, 0 `login-required` refresh rows and 0 device-sign-in lines in the lane's tier logs (counted) since, and a completed turn on the lane afterwards. Read by the controller's box-local check from Plan 3b's execution (untracked), which measures exactly those four things.
- (iii) Both lanes' soak samples (Plan 3b Task B4 Step 3's sampler) answer `rc=0` on the day of the go, and again in B1.
- (iv) The server box's roster agreement reads `agreed` (the operator, in the PWA).
- (v) The weekly-cap path is waived by name (it was never observed on ccrc's path).

| Gate | Read by | Before |
|---|---|---|
| R-O9-REPLACED (i)–(v), then the operator's go after reading G0's census | the controller (G0, read-only) and the operator | Task A1 |
| Part A's PR merged | the operator | Task B1 |
| B1's census clean, and the operator has read `remove.list` and named the window | the controller and the operator | Task B2 |
| Part B verified (`$P4/verified`) | the controller | Task C5 |
| No non-codex row holds a codex registry, and roster agreement reads `agreed` (re-measured) | the controller (read-only) and the operator | C5 Step 7's push, and again the operator's merge |

**Order.** Part A first: it removes the source a reinstall could come from. Part B after Part A's PR merges. C1–C4 may be written from G0 on, and pushed as a draft PR for early review. C5 runs after Part B is verified, because §23 records Parts A and B as done.

## Operator rulings to confirm at plan review

Each has a recommendation, stands unless the operator rules otherwise, and is recorded verbatim in `$P4/rulings.txt` at G0.
- **R4-1, the other repository's LiteLLM virtual environments, its user-site LiteLLM and the `~/.local/bin/litellm` link:** keep. The carried text leaves the venv alone unless ruled otherwise, and no process uses them (the 2026-10-17 census). G0's census still stops if one does.
- **R4-2, the other repository's old LiteLLM and shim logs under `~/.handoff`:** keep. They are history and not on the carried list.
- **R4-3, Z3 (a codex registry is created on a codex-kind row only):** keep (D-5308).
- **R4-4, Part B's "both lanes still serve a turn":** read from each lane's next completed turn after the window (turn markers, read-only), with an immediate tier-status read right after the removal; no dedicated verification turn.
- **R4-5, D-3721's "sentence order":** reorder its "Departs from" bullet to the order its headline and spec §20.5 already use (the codex arm's render restart first, then the byte-replacement trigger), and leave the headline as it is. No tracked text records more about the defect than "sentence order", so this is the plan's reading. The alternative is to leave D-3721's text untouched and record only the reading in §23.

---

## Task G0: the gate, the values file and the census (read-only)

**Files:** none tracked. Creates `$P4`.

**Interfaces:**
- Consumes: R-O9-REPLACED's items.
- Produces: `$P4/values.sh`, `$P4/rulings.txt`, `$P4/remove.list` (one absolute path per line, in removal order), and `$P4/p4-census.sh <list> [--only <checks>]` (exit 0 clean, 2 a guard fired or something is unmeasured, 64 usage), which B1, B2, B3 and the rollback re-run.

- [ ] **Step 1: The state directory and the values file.** `install -d -m 700 "$HOME/.ccrc-p4"`. Write `values.sh` (`0600`), stopping at any value that is not found exactly once:
  - `L1=<lane-1-id>`, `L2=<lane-2-id>`, and `CCGPT_SHA256`, copied from Plan 3b's values file;
  - for each lane `L`, `PRE_<n>=~/.local/bin/$L.pre-ccrc-<UTC>`, where `<UTC>` is the stamp in that lane's Plan 3b window directory `~/.ccrc-3b/$L-<UTC>`. Match the full id followed by `-` or `.pre-ccrc-`, never a prefix: one lane's id may be a prefix of another's;
  - `R_O7_FILE`: the one `ccgpt.*` file in `~/.ccgpt-launcher-r-o7/`;
  - `CFG=~/.handoff/litellm-config.yaml`, `CFG_L2=~/.handoff/litellm-config-$L2.yaml`, and `CFG_BACKUPS`: each file in `~/.handoff` whose name is `CFG`'s name followed by `.prev` or by a `.pre-` stamp, or `CFG`'s stem followed by `.pre-<tag>.yaml`, listed by full name;
  - `VENVS`: the other repository's LiteLLM venv directories under `~/.venvs` and the user-site LiteLLM directory (`$(python3 -c 'import site; print(site.getusersitepackages())')/litellm`), each by full path;
  - each lane's `exec.authDir`, read from the roster with `jq`;
  - the absolute paths of the gate's instruments: Plan 3b's values file, its soak sampler and the two lanes' gate directories, and the controller's lane-1 refresh check.

  Record R4-1 to R4-5's answers in `rulings.txt`.

- [ ] **Step 2: Read the gate.** The lane-1 refresh check answers met, and both soak samples answer `rc=0`. The operator confirms item (iv) and the waiver (v). Otherwise stop.

- [ ] **Step 3: Build `remove.list` from those exact paths,** writing each one that exists, in this order (units first, so the reload comes before the files they named go):
  1. `~/.config/systemd/user/ccgpt-usage.service`, `ccgpt-usage.timer`, `ccgpt-usage@.service`, `ccgpt-usage@.timer`, then the directory `~/.config/systemd/user/ccgpt-usage.service.d`;
  2. `PRE_1` (lane 1's moved-aside entry, a symlink; the link is removed, never its target), then `PRE_2`;
  3. `~/.local/bin/ccgpt`, `~/.local/bin/ccgpt-proxy`, `~/.local/bin/ccgpt-usage` (the dotless files only);
  4. the other repository's backups of its launcher, shim and publisher: `ls -1 ~/.local/bin | grep -E '^ccgpt(-proxy|-usage)?\.(bak|pre)-'`, each written as an absolute path (critic #18). This pattern cannot match `ccgpt-proxy.py`, `ccgpt-usage.py` or another account's backups;
  5. `~/.local/bin/ccrc-models-probe`, ccrc's own stale PATH copy (ccrc runs `$CCRC_HERE/ccrc-models-probe`);
  6. `CFG`, `CFG_L2` and each of `CFG_BACKUPS`.

  Show the operator items 4 and 6 by name, and flag the config backup that has no copy outside the snapshot (the pre-registry one).

  **KEEP, never listed:** `CODEX_LANE_BINS` (`~/.local/bin/ccgpt-proxy.py`, `ccgpt-usage.py`, `ccgpt-runtime`, `ccrc-codex`; ccrc's own, D-5304), both lanes' current entry files `~/.local/bin/<lane-1-id>` and `<lane-2-id>` (ccrc's generated wrappers), every file ccrc places, `~/.handoff/env`, both authDirs, the rest of `~/.handoff`, `VENVS` and the logs (R4-1, R4-2), and every other account's `.bak-*`/`.pre-*` file.

- [ ] **Step 4: Write `$P4/p4-census.sh <list> [--only <a,b,b2,c,d,e,f,g,h|controls>]`.** Without `--only`, every check and every control runs. Rules:
  - It reads the list from its file argument, and never passes a listed path to another process as an argument: patterns go through `grep -F -x -f <file>` or awk reading the file, and `cmp`/`sha256sum` read a listed file by redirection (`cmp -s - "$other" <"$p"`).
  - It prints counts and paths only, never an argv or a file's contents.
  - A listed path that is absent is reported `absent` and skipped.
  - **Unmeasured.** An own-uid process whose `cmdline` cannot be read (other than one that has exited) is unmeasured: exit 2. A process whose `fd`, `exe` or `maps` is not owned by the census's uid is non-dumpable (the user manager's PAM helper and `gpg-agent` always are). It is measured by argv alone, and the census prints one line, `non-dumpable: <n> (<comm>, …)`, which the operator reads. Any other failed read or probe is unmeasured: exit 2, never "none".

  Checks:
  - **(a) Not ccrc's.** For each regular file on the list, and each file inside a listed directory, `cmp` against: every regular file of the same size under `$(readlink -f ~/ccrc)/` and each `~/ccrc-versions/*/` (`node_modules` pruned); the four placed `CODEX_LANE_BINS`; every file named in the installed tree's uninstall list (`cmd_uninstall` in `$(readlink -f ~/ccrc)/ccd/ccrc`: its `~/.local/bin` names and `~/.local/libexec/ccrc/ccd`); every unit file in `~/.config/systemd/user` whose name is in `$(readlink -f ~/ccrc)/deploy/systemd/`; and both lanes' current entry files. Any equal pair fires.
  - **(b) No user.** Skip the census's own session (every pid whose session id, field 6 of `/proc/<pid>/stat`, equals the census's). For each own-uid process, count it against a listed path when an argv element (`cmdline` split on NUL) equals the path, or contains it preceded by start, `=` or whitespace and followed by end or a character outside `[A-Za-z0-9._-]`; or when its `exe` link, an `fd/*` link or a `maps` line's pathname field equals the path. Any count above 0 fires.
  - **(b2) The old path is not running.** The same scan, counting processes whose `exe`, an argv element or a `maps` pathname lies under any of `VENVS`, or equals `~/.local/bin/litellm`. Any count above 0 fires. ccrc's tiers run their own runtime with `python -I`, so this cannot match them.
  - **(c) No unit runs it.** First `systemctl --user show-environment >/dev/null` answers 0. Then two arms:
    - **loaded units** (`systemctl --user list-units --all --plain --no-legend`, transient units included): `systemctl --user show -p FragmentPath,ExecCondition,ExecStartPre,ExecStart,ExecStartPost,ExecReload,ExecStop,ExecStopPost --value -- <unit>`, taking each `path=` value and each `argv[]=` element;
    - **unit files** (the regular files and links in `~/.config/systemd/user`, `~/.local/share/systemd/user` and `/etc/systemd/user`, templates included, never a `*.d/` drop-in directory): only each file's own `Exec*=` values, with `%h` replaced by `$HOME`.

    Each value is matched against the listed paths with (b)'s bounded rule, with a quote also accepted before the path. A match fires, unless that unit's own file is on the list.
  - **(d) No usage timer.** `systemctl --user is-enabled` for `ccgpt-usage.timer` and each `ccgpt-usage@<lane-id>.timer` answers one of `disabled`, `static`, `not-found`; `is-active` for those timers and their services answers `inactive`; and no `ccgpt-usage*` entry exists in any `~/.config/systemd/user/*.wants/` or `*.requires/`.
  - **(e) R-O7 holds the launcher.** While `~/.local/bin/ccgpt` exists (G0, B1, B2 Step 1): `sha256sum <"$R_O7_FILE"` equals `CCGPT_SHA256`, and `cmp` of `R_O7_FILE` with `~/.local/bin/ccgpt` answers 0.
  - **(f) KEEP is not listed.** No listed path equals, or is a parent directory of, a KEEP path: the four `CODEX_LANE_BINS`, both lanes' current entry files, `~/.handoff/env`, both authDirs, `VENVS`, and every name (a)'s uninstall-list and `deploy/systemd/` sources give. No listed basename is in that name set, except `ccrc-models-probe`, which is named.
  - **(g) No schedule names it.** `crontab -l` contains no listed path in its absolute, `~/`, `$HOME/` or `%h/` spelling, matched with (b)'s bounded rule.
  - **(h) No registry would re-create a listed config.** For every `~/.ccrc/models/<id>.classes.json` whose `.probe` is `codex`, roster row `<id>` exists with `exec.kind` `codex`, and no roster row has `exec.kind` `external`. Until Part C merges, the external arm would re-render `CFG` at the next hourly refresh for any such row. Any violation fires.

  Controls (`--only controls` runs these alone):
  - (a) run once on `~/.local/bin/ccgpt-proxy.py` finds at least one equal file in the tree (`ccd/ccgpt-proxy.py`);
  - (b) run once on `~/.local/bin/ccgpt-proxy.py` counts exactly as many processes as there are lanes whose `ccrc codex status <lane-id> --json` reads the shim tier running, measured in the same run;
  - (c)'s loaded arm finds `~/.local/bin/ccgpt-proxy.py` in one loaded unit per running shim, and its file arm finds `~/.local/bin/ccgpt-usage.py` in `~/.config/systemd/user/ccrc-codex-usage@.service` (a template is never a loaded unit);
  - (f)'s name set contains the four `CODEX_LANE_BINS`, `ccd` and `ccrc`.

  A control that misses exits 2.

- [ ] **Step 5: Run it.** `"$P4/p4-census.sh" "$P4/remove.list"; echo "rc=$?"`. Expected: every control line, the `non-dumpable` line, and `rc=0`. A guard that fires stops Plan 4 until the operator rules; a path comes off the list only by that ruling.

- [ ] **Step 6: The operator's go.** The operator reads `remove.list` (paths only), the census output and its `non-dumpable` line, and gives the go for Plan 4. Record it in `rulings.txt`.

---

## Part A — the other repository's pull request

### Task A1: the GLM wrapper's install notes move into the handoff README, and two historical documents are trimmed in place

**Files (in the other repository):**
- Modify: the handoff directory's `README.md` (a new GLM install section, and the GLM row of its "Pieces" table).
- Modify: the 2026-07-22 box-swap runbook plan and the 2026-07-22 box-role-swap migration design.
- Read only: `INSTALL-model-class-registry.md` (A3 deletes it).

**Interfaces:**
- Consumes: nothing.
- Produces: a README that carries every GLM install, order and rollback note the INSTALL doc carries, which A3's deletion relies on (D-5306).

- [ ] **Step 1: List what the README is missing.** Write `<scratch>/a1-missing.tsv` with two columns: each GLM line of the INSTALL doc, and a distinctive token for it. The 2026-10-17 census found these, and the list must cover at least them: run from the repository root (the install paths are relative to it); install the wrapper only after its lane is in the roster and classified (`ccrc models <id> init …`, then `set-class`); the seven-key check of the lane's `settings.json` env block and the conditional eighth key; no GLM lane in the roster, no install; the wrapper refuses to exec without `env.ANTHROPIC_MODEL`, and `jq` must be on PATH; the `diff -u` / `install -m 755` / `cmp` commands; the order (wrappers last, after the env block exists); the rollback through `git show main:<path>`; and the caveat that the env block beats a shell export, so routing changes through `ccrc models <id> set-class` or `rm`.

- [ ] **Step 2: Add a "GLM wrapper: install and rollback" section** carrying every line of `a1-missing.tsv`, reworded only where it named a GPT-lane step. Correct the GLM row of the "Pieces" table, which still says every Claude alias is remapped to cheap models: the wrapper now reads its model from the lane's `settings.json` env block.

- [ ] **Step 3: Prove the README is complete.** `grep -F` each token of column 2 in the README. Expected: every token found. A miss is fixed in Step 2.

- [ ] **Step 4: Trim the two historical documents in place.** Under each title add: "> Superseded for the GPT lane (`ccgpt`): ccrc owns both GPT lanes since 2026-10-07, and this repository's copy of the lane is retired by the pull request that adds this note." Then:
  - remove the `ccgpt`, `ccgpt-proxy`, `ccgpt-usage` and `ccgpt-usage.{service,timer}` items from every list that names them (the runbook's disable, wrapper-copy, unit-copy and `enable --now` lines; the design's "Runs" row, units line, wrapper-copy line, freeze step, respawn step and credential-rotation risk row);
  - remove each step that drives the other repository's LiteLLM directly (the runbook's kill of the old LiteLLM by its port, the design's venv mention);
  - keep every line that names a lane's config home (`~/.claude-<lane-id>`): ccrc still uses those homes.

  Delete neither file (R-O8).

- [ ] **Step 5: Check.** `git grep -n ccgpt -- <the two documents>` lists only the two superseded notes, and `git diff --stat` touches only the README and the two documents.

- [ ] **Step 6: Commit.**

  ```bash
  git add <README> <the two documents>
  git commit -F - <<'EOF'
  docs(handoff): GLM wrapper install notes move into the README; the GPT lane's steps are marked superseded

  The GPT lane now runs on ccrc's own copy. The model-class install doc that is about to go also held the GLM wrapper's only install, order and rollback notes, so they move first.
  EOF
  ```

### Task A2: the test file is split per method, and what remains is renamed

**Files (in the other repository):**
- Modify, then rename: `test_ccgpt_proxy.py`, to a name that says what remains (the GLM and K3 wrappers' gates and the provider allow-list), named in that repository's PR (D-5311).
- Modify: `.gitignore` (its comment names the test file).

**Interfaces:**
- Consumes: nothing.
- Produces: a test module that imports nothing A3 deletes and passes on its own.

- [ ] **Step 1: Record the before counts, without running the file.** Count with `ast`: module-level class definitions holding at least one `test_` method. Cross-check with `python3 -c "import unittest; print(unittest.defaultTestLoader.loadTestsFromName('<module path>').countTestCases())"` from the worktree root, which loads but does not run. Expected (the 2026-10-17 census): 15 classes, 101 methods.

- [ ] **Step 2: Write the mapping (critic #19).** One row per GPT-lane method to delete in `<scratch>/a2-mapping.tsv`: the method, then the ccrc case covering its behaviour (`server/test/<file>.test.ts` and the case name), or `stale-nohup-pin` where it pins the `nohup` launch lines spec §14 says to replace, or `none` with one line on why ccrc deliberately does not have that behaviour (D-5312). The PR body gives the counts: methods deleted, and rows of each kind. The mapping stays in the other repository's PR, never in this repository: its method names carry lane ids.

- [ ] **Step 3: Delete the GPT-lane methods.** The census grouping:
  - **Delete (86):** every method of the twelve GPT-lane-only classes, the seven GPT-lane methods of the mixed wrappers class (the publisher's SHA-256 pin among them: it goes with the publisher), and the one GPT-lane method of the mixed model-gate class.
  - **Keep unchanged (9):** the GLM wrapper's two cases, the K3 wrapper's ownership case, and the six provider-policy and allow-list cases.
  - **Keep, edited (6):** the model-gate cases that loop over both wrappers drop the `ccgpt` arm of their tuple.
  - Delete the module's import-time `SourceFileLoader` of `ccgpt-proxy`, the helper classes no kept method reaches (the effort base class and the fake upstream), and every constant and import only the deleted methods used. Keep the gate helpers the kept cases call (`_extract_gate_function`, `_run_gate`, `_run_gate_without_jq`).

- [ ] **Step 4: Rename and re-point.** `git mv` the file to its new name; rewrite its docstring and run lines for the new name and scope; update the `.gitignore` comment to name it.

- [ ] **Step 5: Run it.** `python3 -m unittest <new module path>` from the repository root. Expected: `Ran 15 tests` and `OK`; and Step 1's two counts give 3 classes and 15 methods.

- [ ] **Step 6: Commit.**

  ```bash
  git add -A <the old and new test paths> .gitignore
  git commit -F - <<'EOF'
  test(handoff): the GPT-lane cases leave with the GPT lane; the wrapper gates stay

  101 methods in 15 classes become 15 in 3. This PR's body maps the 86 deleted methods to the ccrc cases that replaced them.
  EOF
  ```

### Task A3: the ten GPT-lane files are deleted, references are repaired, and the PR is opened

**Files (in the other repository's handoff directory):**
- Delete: `ccgpt`, `ccgpt-proxy`, `ccgpt-usage`, `ccgpt-usage.service`, `ccgpt-usage.timer`, `ccgpt-usage@.service`, `ccgpt-usage@.timer`, the second lane's per-lane launcher, `litellm-config.yaml` and `INSTALL-model-class-registry.md` (D-5305).

**Interfaces:**
- Consumes: A1's README and A2's renamed module.
- Produces: the merged deletion, recorded by date in `$P4` (D-5309).

- [ ] **Step 1: Re-measure.** `git ls-files <handoff directory>` lists all ten. If one is absent or an eleventh GPT-lane file has appeared, stop and re-rule the list.

- [ ] **Step 2: Delete them.** `git rm` the ten paths, one argument each.

- [ ] **Step 3: Repair references.** `git grep -n -i ccgpt` over the whole tree. Expected: hits only in A1's two superseded notes. Any other hit is repaired, or marked superseded the same way if it is a historical record. Lines naming a lane's config home stay.

- [ ] **Step 4: Check scope, tests and addresses.** `git diff --stat "$(git merge-base origin/main HEAD)"` (the two-argument form, so the staged deletions and any unstaged repair appear) lists only the README, the two documents, `.gitignore`, the renamed module and the ten deletions, plus any Step 3 repair; the GLM and K3 wrappers and the handoff runner scripts do not appear. A2 Step 5's run: `Ran 15 tests`, `OK`. The email regex over every touched file: no address.

- [ ] **Step 5: Commit, push and open the PR there.**

  ```bash
  git add <any Step 3 repair>
  git commit -F - <<'EOF'
  chore(handoff): retire the GPT lane's files — ccrc owns the lane

  The launcher, the shim, the usage publisher, its flat and template unit pairs, the second lane's launcher, the static LiteLLM seed and the model-class install doc. The GLM wrapper's install notes moved into the README first.
  EOF
  git push -u origin <branch>
  ```

  Open the PR in that repository with A2's counts. The operator reviews and merges it there, and the controller then appends `PART_A_MERGED=<YYYY-MM-DD>` to `$P4/values.sh`.

---

## Part B — the live cleanup

### Task B1: the census again, and the operator reads the list (read-only)

**Files:** none tracked. Writes only under `$P4`.

**Interfaces:**
- Consumes: G0's values, list and census; Part A merged.
- Produces: the operator's window, recorded in `$P4/window`.

- [ ] **Step 1: Re-read.** Both soak samples answer `rc=0`. Rebuild the list by G0 Step 3 into `$P4/remove.list.b1`, and `diff` it against `remove.list`; any difference is shown to the operator, and `remove.list` changes only by their ruling. Then `"$P4/p4-census.sh" "$P4/remove.list"` answers `rc=0` with every control.

- [ ] **Step 2: The refresh times.** Record each lane's `auth.json` mtime (`stat` only) in `$P4/refresh.last`, and its next expected refresh (that mtime plus the measured ten-day spacing) in `$P4/refresh.next`. A lane whose `refresh.next` is in the past, or falls within the planned window plus one hour, is shown to the operator. The window then waits until that lane's `auth.json` mtime has moved, or until the operator rules by name that it may go ahead first.

- [ ] **Step 3: The operator names the window.** They read `remove.list` (paths only), the census output and the refresh times, and name a window that avoids the hourly `ccrc-models.timer` fire. Write its planned start and end (UTC) to `$P4/window`; B1 Step 2 and B2 Step 1 read the end, and B3 Step 4 reads the start. This is B2's authorisation.

### Task B2: snapshot, then remove (live; the Part B authorisation)

**Files:** none tracked. Creates `~/.ccgpt-retired-<UTC>/`; removes the listed paths.

**Interfaces:**
- Consumes: B1's list and window.
- Produces: the snapshot (its path recorded as `SNAPSHOT` in `$P4/values.sh`), with `remove.list`, `MANIFEST` and `removed.log` inside it; the removal.

- [ ] **Step 1: Inside the window, re-measure everything B3 compares against.**
  - No update is in flight (`~/.ccrc/update.lock` absent), no loaded unit reads `NeedDaemonReload=yes`, and the next `ccrc-models.timer` fire falls outside the window.
  - `p4-census.sh` answers `rc=0` with every control.
  - Then take the baselines:
    - `ccrc version`'s version line into `$P4/stamp.before`;
    - `sha256sum` of the four `CODEX_LANE_BINS` files and both lanes' entry files into `$P4/keep.sha256`;
    - `stat -c '%n %F %a %s %Y'` of `~/.handoff/env` and both authDirs, and `stat -c '%n %F %a %i'` of each authDir's `auth.json`, into `$P4/stat.before`;
    - the classes of `ccrc doctor` (`PASS|WARN|FAIL <check>:`, sorted, unique) into `$P4/doctor.before`;
    - a names-only listing into `$P4/names.before`: `find ~/.local/bin ~/.config/systemd/user ~/.handoff -maxdepth 1 -printf '%p %y %m\n' | sort`.

- [ ] **Step 2: Snapshot every path.**
  - `R="$HOME/.ccgpt-retired-<UTC>"; install -d -m 700 "$R"`, append `SNAPSHOT=$R` to `$P4/values.sh`, and copy `$P4/remove.list` to `$R/remove.list`. Every later step and the rollback read `$R` from `values.sh`.
  - For each line: `cp -a --parents -- "$p" "$R/"`.
  - Prove each path with one function, testing in this order:
    - if `[ -L "$p" ]`, require `[ -L "$R$p" ]` and `[ "$(readlink "$p")" = "$(readlink "$R$p")" ]`;
    - else if `[ -d "$p" ]`, `diff -rq "$p" "$R$p"`;
    - else `cmp -s "$p" "$R$p"`.

    In every arm, `stat -c '%F %a %s %Y'` of the two paths (without `-L`) must also be equal.
  - Write `$R/MANIFEST`: the window's UTC start, then one line per path with `stat -c '%n %F %a %s %Y'`, nothing from inside a file.
  - Any mismatch stops the window with nothing removed.

- [ ] **Step 3: Rehearse the restore (Review Focus 5).** `install -d -m 700 "$P4/rehearsal-<UTC>"`. With `cp -a -T`, copy `~/.local/bin/ccgpt-proxy` and lane 1's moved-aside link (`PRE_1`) from `$R` into it, and check each against its live original with Step 2's function. Expected: equal. The rehearsal copies are kept, like the snapshot.

- [ ] **Step 4: Remove, in list order.** Before each `rm`, `printf 'rm\t%s\n' "$p" >> "$R/removed.log"`; after it succeeds, `printf 'done\t%s\n' "$p" >> "$R/removed.log"`.
  - The four unit files: `rm -- "<path>"`, one path per call. Then the drop-in directory: `rm -r -- "$HOME/.config/systemd/user/ccgpt-usage.service.d"`, its one `rm -r`.
  - `systemctl --user daemon-reload`.
  - Every other path: `rm -- "<path>"`, one per call. For lane 1's moved-aside link `PRE_1`, `rm` removes the link and never follows it. The lane's current entry file `~/.local/bin/<lane-1-id>` is KEEP and is never named.
  - Any `rm` that fails stops the step: report it, and leave the rest in place.

- [ ] **Rollback (only on the operator's word).** The paths are the lines of `$R/removed.log` that start `rm<TAB>` (`awk -F'\t' '$1=="rm"{print $2}'`). For each, in order:
  - If something is at the path (`[ -e "$p" ] || [ -L "$p" ]`), skip it when it already equals the snapshot by Step 2's function. Otherwise stop and name it, never overwriting.
  - Else `cp -a -T -- "$R$p" "$p"`, then Step 2's function, stopping on a mismatch.
  - A stop at the drop-in directory with no `done` line is a partial `rm -r`. The operator may then run `cp -a -n -T -- "$R$p" "$p"`, which adds only the missing files, and re-run the rollback.

  Whenever a unit file was restored, `systemctl --user daemon-reload` runs before the rollback reports, even after a stop. Then `p4-census.sh "$R/remove.list" --only c,d` reads the units back. This plan never removes the snapshot.

### Task B3: verify, and record

**Files:** none tracked.

**Interfaces:**
- Consumes: B2's removal.
- Produces: `$P4/verified` (the UTC time of a clean verification) and `PART_B_DONE=<YYYY-MM-DD>` in `$P4/values.sh`, which C5 reads.

- [ ] **Step 1: Right after the removal.**
  - Every `rm<TAB>` path in `removed.log` answers `[ ! -e "$p" ] && [ ! -L "$p" ]`.
  - `systemctl --user show-environment >/dev/null` answers 0, and then `systemctl --user list-unit-files --no-legend 'ccgpt-usage*' | wc -l` answers 0.
  - `p4-census.sh "$R/remove.list" --only controls` answers `rc=0`, and `ccrc codex status <lane-id> --json` reads both tiers running for each lane.
  - The names-only listing, taken again: while `ccrc version` equals `stamp.before`, it differs from `names.before` by exactly the removed paths. If the version moved, the difference is the removed paths plus only names in the new tree's placed set (G0's (a) sources), shown to the operator.

- [ ] **Step 2: Nothing kept moved.**
  - Each `CODEX_LANE_BINS` file is a regular file, mode 755, and `cmp -s` equal to `~/ccrc/ccd/<name>`; that holds across an update.
  - Each lane's entry file is a regular file, mode 755.
  - While `ccrc version` still equals `stamp.before`, `sha256sum -c "$P4/keep.sha256"` also answers `OK` for every line.
  - `~/.handoff/env` and both authDirs equal their `stat.before` lines.
  - Each `auth.json` keeps its type, mode and inode. A moved mtime or size is reported on its own line as the library's refresh, checked against `refresh.next`, and never as a Part B fault.

- [ ] **Step 3: Doctor.** `ccrc doctor`: no `FAIL`. Its WARN classes are a subset of `doctor.before`. If `ccrc version` moved, an update landed in the window, and any new WARN class is read against that release before the subset test. The `wrappers` WARN stays a WARN for the GLM and K3 wrappers, and its sentence no longer names `ccgpt`.

- [ ] **Step 4: Both lanes still serve (R4-4).** Wait for a completed turn on each lane after the window: a session on that lane whose turn marker reads `state: done`, with `turnAt` later than the `MANIFEST`'s start. If either lane has none within six hours, report to the operator and keep waiting. Then one soak sample per lane: `rc=0`.

- [ ] **Step 5: Record.** Write the UTC time to `$P4/verified`, and append `PART_B_DONE=<YYYY-MM-DD>` to `$P4/values.sh`. Append one line to this plan's execution record (by shape only), and one to Plan 3b's box-local verification record (Plan 3b Task B6). Report to the operator: the number of paths removed, the snapshot directory, the doctor result and the two lanes' turns.

---

## Part C — the ccrc pull request

C1–C4 are one commit each, with their own tests. Every red-first test names "(Plan 4)" in its title. After C1, `ccrc-install.test.ts`'s "Plan 3a Task 10 — the cutover rehearsal" describe is red until C3 retires it: C1 and C2 run their scoped files, and C3 runs that whole file green.

### Task C1: the external LiteLLM arm is deleted, and the dispatcher refuses for itself

**Files:**
- Modify: `ccd/ccrc` (`_models_litellm`'s dispatcher and external arm, `_models_litellm_path`, `_models_litellm_running`, `_models_litellm_stop_blocked`, and their headers).
- Modify: `server/test/ccrc-models.test.ts`, `server/test/models-op.test.ts`, `server/test/single-definition.test.ts`, `server/test/ccrc-install.test.ts` (its "ruling Z4" case).

**Interfaces:**
- Consumes: nothing.
- Produces: `_models_litellm <id>` answers `no-such-account` for an id the roster lacks, `not-codex-kind` for a row that is not codex-kind, `roster-invalid` for a roster it cannot read, and `roster-absent` for a missing one. Each exits 1, before anything is rendered, stopped or written. `not-codex-kind` is the dispatcher's own word: models-op's `not-a-codex-lane` keeps its meaning (a codex-kind row whose registry is absent or not a codex probe). `_models_litellm_path <id>` keeps only its id form.

- [ ] **Step 1: Write the failing tests.**
  - In `ccrc-models.test.ts`'s codex-kind describe, on a box whose roster adds `EXT_A_ROW` and a generated row `gen-a` (`{id:'gen-a', label:'gen-a', configDirSuffix:'.claude-gen-a', exec:{kind:'generated'}, homeAble:false, telemetry:'none'}`), each seeded with `seedCodex(id)` and `writeCatalogue(id, SYNTHETIC_LITELLM_CATALOGUE)` (the "C1 box"):
    - `it.each(['ext-a','gen-a'])('a %s row that is not codex-kind gets no LiteLLM config: not-codex-kind, and nothing is rendered, stopped or written (Plan 4)')`: `run(['models','litellm',id])` → code 1, `oneObject(r).error` `'not-codex-kind'`, the detail names the id; `boxGlobal()` absent; `poisonLog('pgrep')`, `poisonLog('ccgpt')` and `poisonLog('systemd-run')` all `[]`.
    - `it('an id the roster does not have is the dispatcher\'s own no-such-account (Plan 4)')`: `run(['models','litellm','no-such-lane'])` → error `no-such-account`, the detail matches `/has no account "no-such-lane", so there is no lane to render a LiteLLM config for/`, and `boxGlobal()` and `lanePath('no-such-lane')` are absent. (Today models-op's own read answers `no-such-account` with another detail, which is why this case is red first.)
    - `it('a non-codex row with a codex registry fails its hourly refresh row: not-codex-kind, never ok:true (Plan 4)')`: `run(['models','refresh','ext-a'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW })` → code 1. The row equals `{ id: 'ext-a', ok: false, reason: expect.any(String) }`, and its reason, which carries the refusal's `.detail`, matches `/^account ext-a is not exec\.kind "codex"/`. `boxGlobal()` is absent, and the three poison logs are `[]` (Review Focus 3).
  - Re-pin "an ABSENT roster is not undecidable: the dispatcher answers the external arm's roster-absent, never roster-invalid (Plan 3b Task A1)" as `it('an ABSENT roster is refused by the dispatcher itself: roster-absent, never roster-invalid (Plan 4)')`: as today, plus the detail matches `/no lane's LiteLLM config can be rendered/`.
  - In `single-definition.test.ts`, replace "the LiteLLM config path is spelled once, in one tool, through one helper" with `it('no bash code line spells the retired box-global LiteLLM config path or its override (Plan 4)')`: `holdersOf('.handoff/litellm-config.yaml')` and `holdersOf('CCGPT_CONFIG')` both `toEqual([])`. Beside it, `it('ccrc never runs the other repository\'s launcher (Plan 4)')`: `codeLines(path.join(ccrcRoot,'ccd','ccrc'))` has no line matching `/\bccgpt (stop|start|login)\b|command -v ccgpt\b/`.

- [ ] **Step 2: Run them; expect red.** `./node_modules/.bin/vitest run test/ccrc-models.test.ts -t 'Plan 4'` and `test/single-definition.test.ts -t 'Plan 4'`. Expected: the new cases FAIL. The arm renders the box-global file; the refresh row is `ok:true`; a typo gets models-op's detail, not the dispatcher's; and the ratchets find `ccd/ccrc`.

- [ ] **Step 3: Delete the arm, and give the dispatcher its refusals.** In `_models_litellm`'s `case "$kind"`:
  - `1)`: read membership with `jq -e --arg id "$1" 'any((.accounts // [])[] | objects; .id == $id)' "$(_models_roster_path)"`, and branch on its exit code:
    - 1 refuses `no-such-account`: "`$HOME/.ccrc/accounts.json` has no account "$1", so there is no lane to render a LiteLLM config for. 'ccrc status' lists the ids this box has. Nothing was rendered, stopped or written."
    - any other non-zero refuses `roster-invalid` with the `*)` arm's sentence.
    - 0 refuses `not-codex-kind`: "account $1 is not exec.kind "codex", so ccrc renders no LiteLLM config for it (an external lane's box-global config was retired by Plan 4). If it is a Codex lane, its roster row needs exec.kind "codex". Nothing was rendered, stopped or written."
  - `3)` refuses `roster-absent`: "`$HOME/.ccrc/accounts.json` does not exist, so no lane's LiteLLM config can be rendered. Run 'ccrc install' — it seeds one and never overwrites an existing one."
  - `*)`: in both of its sentences, replace everything from "and neither LiteLLM arm was taken" through "rendered as a codex one" with "and no LiteLLM config was rendered". Update that case's `toContain` pin.
  - Delete everything after the `esac` that served the external arm, and `_models_litellm_running` and `_models_litellm_stop_blocked`. `_models_litellm_path` becomes its id form only, `_codex_litellm_yaml "$1"`. Reword the STOP-THEN-WRITE header so it describes the codex arm; the doctrine stays.

- [ ] **Step 4: Classify the collateral cases.** `git grep` the cases that seed a codex registry on a row that is not codex-kind, and state the count at the start of the step. For each:
  - **Deleted:** a case whose subject is the external arm's own behaviour: its render, `pgrep`, the bare stop, `restarted`, and Z4, including the Z4 describe's undecidable-roster case. That case's dispatcher subject is already held by the "refused … before either arm" case and the refresh-row case.
  - **Re-seated on `codex-a`** with the codex arm's stubs, keeping its assertions: a case whose subject still exists (the refresh loop, A4's exit-code fallback, the secrets-file sourcing). A refresh-loop case that stays green on its external row is re-seated too, and asserts no `~/.ccrc/codex/<id>/litellm.yaml` rather than the box-global path.
  - **Moved to `models-op.test.ts`:** "refuses a lane whose probe is not codex" (an openrouter registry on a generated row), which after C1 the dispatcher answers instead of models-op. As a direct op case: `op('init', …, '--id', 'router', '--probe', 'openrouter')`, then `op('litellm', '--file', rosterPath(), '--id', 'router', '--template', TEMPLATE, '--out', out())` → code 1, error `not-a-codex-lane`, detail `/has probe "openrouter"/`. It is then the pin of models-op's probe-kind guard.
  - **Not C1's:** the two `CHATGPT_TOKEN_DIR` scrub cases, which C2 re-aims.
  - **Kept:** the harness's `CCGPT_CONFIG` drop and its `pgrep`/`ccgpt` poisons. They cost nothing, and they keep any return of the arm loud.

  Delete `ccrc-install.test.ts`'s "ruling Z4" case. Record every decision in `cases.tsv`.

- [ ] **Step 5: Run green.** `test/ccrc-models.test.ts`, `test/models-op.test.ts`, `test/single-definition.test.ts` and `test/typecheck-tests.test.ts`: PASS. `git grep -n 'ruling Z4' -- server/test/ccrc-install.test.ts` lists nothing.

- [ ] **Step 6: Mutation rows,** one backup per file, restore proved by `git diff --quiet -- <file>`:
  - (m1) restore `1) ;;`: the `not-codex-kind` and refresh-row cases red;
  - (m2) add back a `ccgpt stop` code line: the launcher scan reds;
  - (m3) add back `"${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}"` as code: the ratchet reds;
  - (m4) restore the old `roster-absent` wording: the roster-absent case reds;
  - (m5) delete the membership read: the `no-such-account` case reds;
  - (m6) drop models-op's `registry.probe !== 'codex'` test: the moved models-op case reds.

- [ ] **Step 7: Commit:** `fix(models): the external LiteLLM arm leaves with the other repository's lane; the dispatcher refuses for itself (Plan 4)`.

### Task C2: the probe's external fetch and the lane-kind marker are deleted

**Files:**
- Modify: `ccd/ccrc-models-probe` (`_fetch_codex`, `_fetch`'s `codex)` line, the child's scrub of `CCRC_PROBE_LANE_KIND`, and the comments that describe them).
- Modify: `ccd/ccrc` (`_models_probe_codex_env`'s export and unsets of the marker, its rc 3 sentence, and its header).
- Modify: `server/test/models-probe.test.ts`, `server/test/ccrc-models.test.ts`.

**Interfaces:**
- Consumes: C1's box and refusals (the `--all` case runs on the C1 box).
- Produces: `_fetch`'s `codex)` arm is `_fetch_codex_lane` for every caller. With no directory handed to it, it refuses `no-token-dir`; with a directory but no interpreter, `runtime-absent`. No shipped probe code opens an `auth.json`, which closes D-3161 everywhere.

- [ ] **Step 1: Write the failing tests.**
  - In `models-probe.test.ts`'s describe "the Codex arm: a codex lane gets no default token directory…" (the one that exercises `_fetch_codex_lane`), whose `beforeEach` plants the PATH `litellm` stand-in and the `python` recorder: `it('a codex probe handed no lane inputs refuses no-token-dir, and never reads the retired default directory (Plan 4)')`. Read the retired default's directory off spec §9 item 1's code span (`/\$\{CHATGPT_TOKEN_DIR:-\$HOME\/([^}]+)\}/` on the spec file), plant `auth.json` (`{}`) there, and never spell the directory. Then `run(['ext-a','codex'], { CHATGPT_TOKEN_DIR: '', CCRC_CODEX_PYTHON: '', CCRC_PROBE_LANE_KIND: '' })` → code 1, `/no-token-dir/` in stderr, `poisonRan()` false, `probeArgv0(pr.rec)` `[]`, and no `<home>/.ccrc/models/ext-a.json` (Review Focus 4).
  - In the same file: `it('the probe\'s code reads no auth.json and has no token-directory default or lane-kind marker (Plan 4)')`. Its code lines containing `auth.json` are exactly the three that remain (the `[ ! -f "$token_dir/auth.json" ]` test, its `not-logged-in` sentence and the `login-required` sentence); no code line matches `/CHATGPT_TOKEN_DIR:?-[^}]/`; and no code line of `ccd/ccrc-models-probe` or `ccd/ccrc` contains `CCRC_PROBE_LANE_KIND`.
  - In `ccrc-models.test.ts`, the "_models_run_probe hands a codex row its own authDir, runtime and marker; every other row gets neither marker nor runtime" case (Plan 4):
    - drop `CCRC_PROBE_LANE_KIND` from its `ambient` map and from the secrets file it writes, and assert that no row's child environment carries the name;
    - for the two non-codex rows, also run `sourced('_models_run_probe <id> "$CCRC_HERE/ccrc-models-probe" <id> codex', [], ambient)` with no probe fixture → code 1, with `/runtime-absent/` in stderr for the row whose secrets file sets `CHATGPT_TOKEN_DIR`, and `/no-token-dir/` for the one with none; the runtime recorder never ran.
  - In `ccrc-models.test.ts`, on the C1 box: `it('a non-codex row with a codex registry fails the hourly refresh at the probe, and --all exits 1 (Plan 4)')`: `run(['models','refresh','--all'])` with no fixture → code 1; `ext-a`'s row is `{ id: 'ext-a', probe: 'codex', ok: false, reason }` with `/no-token-dir/` in its reason; `boxGlobal()` and `lanePath('ext-a')` absent; the three poison logs `[]` (Review Focus 3).

- [ ] **Step 2: Run them; expect red.** `test/models-probe.test.ts -t 'Plan 4'` and `test/ccrc-models.test.ts -t 'Plan 4'`. Expected: the new cases FAIL (the probe falls to `_fetch_codex`; the scan finds the read, the default and the marker; the child carries the marker).

- [ ] **Step 3: Delete.**
  - `_fetch_codex` and its D-3161 comment go.
  - `_fetch`'s line becomes `codex) _fetch_codex_lane ;;`, and its comment says why there is one arm.
  - The probe child's `unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND` becomes `unset CCRC_CODEX_PYTHON`.
  - In `ccd/ccrc`, `_models_probe_codex_env` stops exporting and unsetting the marker, and **keeps** its `unset CCRC_CODEX_PYTHON` on the non-codex arm: that unset is what makes a non-codex row whose secrets file sets `CHATGPT_TOKEN_DIR` fail closed as `runtime-absent`. A row that nothing hands a directory refuses `no-token-dir` first.
  - Its rc 3 sentence's middle clause becomes "its probe does not run: a lane nobody read is never probed".

- [ ] **Step 4: Retire and re-aim.**
  - Delete the default-directory case.
  - Replace the marker-`''`-or-`'external'` case ("without the codex-lane marker the arm is today's …") with Step 1's first case.
  - The `codex()` helper stops passing the marker. Retitle that describe without "; every other caller keeps today's arm", and replace its header comment's last bullet ("WITHOUT the marker, today's arm, byte for byte") with one line saying every caller now takes the codex-lane arm (Plan 4).
  - The two `CHATGPT_TOKEN_DIR` scrub cases stay on their non-codex rows and assert the refresh row's reason matches `/no-token-dir/`. That word proves the ambient value was scrubbed: a leaked value would refuse `runtime-absent` instead.

  Record every decision in `cases.tsv`.

- [ ] **Step 5: Run green.** `test/models-probe.test.ts`, `test/ccrc-models.test.ts`, `test/typecheck-tests.test.ts`: PASS.

- [ ] **Step 6: Mutation rows.**
  - (m7) restore the two-arm dispatch line, with a `_fetch_codex` stub that uses the default directory: the `no-token-dir` case reds.
  - (m8) add back a `json.load(open(os.path.join(token_dir, "auth.json")))` code line: the scan reds.
  - (m9) re-add the marker export in `ccd/ccrc`: the scan and the child-environment case red.
  - (m10) delete either branch's `unset … CHATGPT_TOKEN_DIR` in `_models_run_probe`: its scrub case reds.

- [ ] **Step 7: Commit:** `fix(probe): one codex fetch for every caller; nothing ccrc ships opens an auth.json (Plan 4, D-3161 closed)`.

### Task C3: the `BASE_LIVE_SHAPE` rehearsal is retired

**Files:**
- Modify: `server/test/ccrc-install.test.ts`. Delete `BASE_LIVE_SHAPE` and its docstring, `baseInstalled`, `REHEARSAL_ENV`, `liveBox`, `ASIDE`, `INIT_EXTERNAL_REFUSAL`, `FLIP_BACK_LEFTOVER_CLASS`, `LiveShapeMeasure`, and the imports of every deleted fixture name; rewrite `flipCodexA` as below. Rename the describe "Plan 3a Task 10 — the cutover rehearsal" to what it still holds.
- Modify: `server/test/codexLaneFixture.ts`. Delete `plantLiveShape`, `liveShapeRefreshes`, `observeHourlyRefresh`, `withForeignProxyRunning`, `spawnForeignProxyStandIn`, `stopForeignProxyStandIn`, `restoreForeignConfig`, `foreignSnapshot`, `foreignCcgptCalls`, `foreignProbeCalls`, `assertForeignFront`, `FOREIGN_MARK`, `FOREIGN_PATHS`, `PROBE_ENV_VALUES`, `REHEARSAL_LANES` and the foreign file table, each once nothing uses it.
- Modify: `server/test/ccrc-update.test.ts` ("a real update leaves every foreign byte and link…", its describe title and its import of `plantLiveShape` and `foreignSnapshot`).

**Interfaces:**
- Consumes: C1's and C2's refusals.
- Produces: no golden of a shape that no longer exists.

- [ ] **Step 1: Apply the classification.**

  | Case | Decision | How |
  |---|---|---|
  | "the base tree: BASE_LIVE_SHAPE is its measured answer…" | retire | it measures the external live shape, which is gone; re-measuring it would measure a fiction |
  | "live shape: two installs, both hourly refreshes, doctor and uninstall do exactly what the base did, and init codex on an external lane refuses" | retire | the same; its Z3 half is held by the models-op and ccrc-models Z3 cases |
  | "the flip back…" | retire | Part C removes the external rollback path |
  | the MF-3 describe (`assertForeignFront`'s own cases) | retire | its helper goes |
  | "fresh fleet box" | re-seat | `freshBox(prefix)`, `gitInit(treeRoot(home))`, the two `.ccrc/agent.env` lines `liveBox` writes, and `plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' })`. Plant no fleet token, generation or sync file (the case tests their absence), never call `plantLiveShape`, and run with `READY` in place of `REHEARSAL_ENV`. Keep every box-token, exit-0 and no-FAIL assertion; drop only the `BASE_LIVE_SHAPE` class map. |
  | "the flip…" | re-seat | rewrite `flipCodexA` without its flat-timer-link and aside-rename steps; plant `plantForeignUsage(home,'codex-b')` and no flat-timer link; drop the aside assertions; keep the roster edit, wrappers, catalogue stand-in, `models litellm`, install, start and publisher row |
  | "out of order…" | re-seat | as "the flip", and drop the `codex-b` rename and the `foreignSnapshot` line |
  | ccrc-update's "a real update leaves every foreign byte and link…" | re-seat | on a box whose roster has no codex lane, without `plantLiveShape`/`foreignSnapshot`, retitled `a real update on a box with no codex lane names no ccgpt- unit in a state-changing verb, and builds nothing (Plan 4)`, its describe retitled to match; keep its `stateCallsNaming(/\bccgpt-/)`, spine-run, runtime and lane-state assertions |

  Record each in `cases.tsv`.

- [ ] **Step 2: Delete the helpers.** After each, `git grep -n '<name>' -- server/test` lists no consumer.

- [ ] **Step 3: Run green.** `test/ccrc-install.test.ts` whole, `test/ccrc-update.test.ts -t 'no codex lane names no ccgpt-'` (expect `1 passed`), `test/install-census.test.ts` and `test/typecheck-tests.test.ts`: PASS. For each re-seated case, the mutation its old row named, measured on the new seat.

- [ ] **Step 4: Commit:** `test(install): the external live-shape rehearsal retires with the external lane (Plan 4)`.

### Task C4: the remedy, citations of deleted files, and comments that went false

**Files:**
- Modify: `deploy/models-op.mjs` (the openrouter `endpoints-required` remedy; the comments on `pgrep` and `ccgpt` as box-level concerns).
- Modify the comments, citations and prose of:
  - `ccd/ccrc-models-probe` (a citation of the deleted launcher in its compatible arm);
  - `server/src/limits.ts` (a citation of the deleted publisher);
  - `shared/litellm.mjs` (its header's render destination);
  - `ccd/ccrc-codex` (its header);
  - `ccd/ccrc` (comments that describe the other repository's files or units as present);
  - `deploy/deploy.sh` (its "removed by hand at the box cleanup (Plan 4)" comments);
  - `pwa/src/lib/models.ts` (its comment that the fable alias is set in the deleted launcher's exports);
  - `README.md` (its Z3 sentence);
  - the test-file comments that cite the deleted publisher (`server/test/ccd-limits.test.ts`, `server/test/fixtures/rollover.ts`, `server/test/modelenv.test.ts`).
- Test: `server/test/models-op.test.ts`.

**Interfaces:**
- Consumes: Part A's deletion.
- Produces: no shipped or test comment cites a file Part A deleted, and the remedy names a command that exists (D-5310).

- [ ] **Step 1: Re-pin the existing case, red first.** In `models-op.test.ts`, "openrouter discovery add without --endpoints refuses" today asserts `toMatch(/ccrc-models-probe/)`. Replace that with `toContain('ccrc models router discovery add')` and `expect(/Run 'ccrc-models-probe /.test(detail)).toBe(false)`, and add "(Plan 4)" to its title. Run it: FAIL. Record it in `cases.tsv` as re-seated.

- [ ] **Step 2: Fix the remedy:** `account "${a.id}" is an openrouter lane: discovery add needs the probe's endpoints answer. Run 'ccrc models ${a.id} discovery add <author/slug>' — it runs the probe ccrc ships and passes its answer here — or pass --endpoints <path> holding that probe's answer.` Run the case: PASS.

- [ ] **Step 3: Repair the citations and comments.**
  - A citation of a deleted file is re-pointed: the probe's launcher citation to spec §8's `[1m]` bullet, `limits.ts`' to `ccd/ccgpt-usage.py`.
  - A comment that describes the other repository's files or units as present on a box is put in the past tense with "(retired by Plan 4)".
  - A comment that justifies a guard which stays keeps its reason in the present ("a box may still carry another repository's `ccgpt`") and adds "(the fleet box's copy was removed by Plan 4)". The guards that stay are D-3478's reservation of the `ccgpt` id, `_check_wrappers`' FAIL for a launcher that execs `ccgpt`, and the foreign usage-timer withhold and WARNs.
  - README's Z3 sentence: "…so a codex registry anywhere else fails its probe (`no-token-dir`) on every hourly refresh".
  - The three files in Global Constraints are not edited.

- [ ] **Step 4: Check.** `git grep -n -E '[A-Za-z0-9_-]+/handoff/[A-Za-z0-9_.@-]+' -- ccd deploy server shared agent/src pwa/src` lists no citation of a deleted file. `test/models-op.test.ts`, `test/single-definition.test.ts`, `test/topology-clean.test.ts`, `test/session-hook.test.ts` (its citation census) and `test/typecheck-tests.test.ts`: PASS.

- [ ] **Step 5: Commit:** `docs(tree): citations follow the retired GPT-lane files; the openrouter remedy names the verb that runs the probe (Plan 4)`. The branch may now be pushed and opened as a draft PR for review.

### Task C5: spec §23, the gate, and the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` (same-line pointers above §23, then the appended §23).
- Modify: `docs/superpowers/plans/2026-09-30-gpt-lane-ownership-3a-before-the-flip.md` (D-3705's definition, and D-3721's "Departs from" bullet per R4-5, in place).

**Interfaces:**
- Consumes: C1–C4, `cases.tsv`, `$P4/verified`, `PART_A_MERGED` and `PART_B_DONE`.
- Produces: the PR, ready to merge.

- [ ] **Step 1: Wait for Part B.** `$P4/verified` exists. Read both dates.

- [ ] **Step 2: Same-line pointers.** Append ` (amended: §23.N, D-NNNN)` to each line above §23 that the deletion makes untrue. It names the §23 subsection that says what is now true and, where one drives it, this plan's deviation. In a table row, the pointer goes inside the last cell, before its closing `|`. The lines:
  - §8's `pgrep` and bare-stop lines;
  - §9 item 1, and its closing sentence on reading OAuth files;
  - §19.6's external-arm bullet;
  - §20.1's marker bullet, its two external-fetch lines and its Z3 bullet;
  - §20.2's three bullets;
  - §20.9's rehearsal sentence and its §15-step-4 bullet;
  - §20.10's rows that name a deleted, retired or renamed case (the `_models_run_probe` row, the two models-probe Z1 rows, "the base tree", "live shape", the Z4 rows, "the flip back", the re-seated update case, the MF-3 describe);
  - §21.1's bullets 1, 3 and 4;
  - §21.7's external bullet;
  - §21.9's "Plan 4 removes it";
  - §21.12's A1 row.

  No other edit above §23.

- [ ] **Step 3: Append §23** (`## 23. Amendments (Plan 4)`), with an intro naming this plan:
  - **23.1 The cutover and the deletion are done.** Both lanes flipped (Plan 3b, D-4046..D-4057 and D-4665..D-4674). The other repository deleted its copy on `PART_A_MERGED` (D-5309), and the fleet box's installed copy was removed on `PART_B_DONE`, with every removed path kept in a box-local snapshot (D-5307).
  - **23.2 The external arm and fetch are gone.** What C1 and C2 deleted; the dispatcher's own refusals (`no-such-account`, `not-codex-kind`, `roster-invalid`, `roster-absent`); D-3161 closed everywhere. §9's "Nothing in ccrc — doctor, installer, publisher, probe or test — ever reads the contents of an OAuth file" now holds without condition for ccrc's own code. The LiteLLM library's read and write of a lane's `auth.json` (§21.7) stand.
  - **23.3 Z3 stays** (R4-3, D-5308).
  - **23.4 The rehearsal.** §20.9's and D-3705's "measures the base on the same fixture" was never what the tree did: the rehearsal compared the tip against a golden measured once, `BASE_LIVE_SHAPE`. Plan 4 retired it (C3).
  - **23.5 Who holds each mutation-table row Plan 4 changed.** From `cases.tsv`: each §20.10 and §21.12 row whose case C1–C4 deleted, re-seated, moved or added, with its new case name. A row whose guard Plan 4 deletes (Z4's stop guard, D-3753; MF-3's front; the external probe path) is marked retired, with no holder. §21.12's A1 row drops the Z4 describe's undecidable-roster case, and §20.10's Z3 row drops the retired live-shape case.
  - **23.6 D-3721's sentence order** is the plan's reading (R4-5).

- [ ] **Step 4: The two plan-3a edits.** D-3705's definition: "measures the base on the same fixture" becomes "compares the tip against a golden measured once on the base (`BASE_LIVE_SHAPE`, retired by Plan 4)". D-3721: per R4-5.

- [ ] **Step 5: The gate.** `git fetch origin main`, and merge it if it moved. Then Plan 3b A7's diff check: every hunk above §23 is a same-line edit. Expected: `R: <the spec's line count before §23> lines above §23 unmoved; <the number of lines Step 2 names> pointer-only edits; <m> lines appended`, then `rc=0`. At drafting, those two numbers were 1259 and 27. Then `test/deviation-refs.test.ts`, `test/dtbd.test.ts`, `test/topology-clean.test.ts`, `test/single-definition.test.ts`, the server suite in its twelve shards, `test (agent)` and `test (pwa)`. Expected: green, or only the known load flakes, each re-run in isolation and green.

- [ ] **Step 6: The precondition, re-measured (read-only).** `p4-census.sh "$SNAPSHOT/remove.list" --only h` answers `rc=0`: every codex-probe registry belongs to a codex-kind row, and no row is `external`. The operator confirms that the server box's roster agreement reads `agreed` (its roster is the fleet box's mirror, D-4672). Record the result by shape only. Any violation stops the merge.

- [ ] **Step 7: Push and mark ready.** The PR body says what was deleted, the counts of retired, re-seated and moved cases, and that the merge is inert on a roster with no external row, and it links this plan by its `blob/main` URL. Just before the operator merges with `--admin`, re-run Step 6.

---

## Authorisation shapes

- **Plan 4 as a whole:** the operator's explicit go at G0, under spec §2.11's standing authorisation of the eventual removal.
- **G0 and B1:** read-only.
- **Part A:** an ordinary PR in the other repository, reviewed and merged there by the operator.
- **Part B:** one authorisation, given at B1 Step 3 when the operator reads `remove.list` and names the window. It covers B2's snapshot, removals and one `daemon-reload`, and nothing else. A rollback runs only on the operator's word.
- **Part C:** an ordinary ccrc PR, merged by the operator with `--admin`. Its merge is a release both boxes follow.

## Known limits and Later

- **A short interval with a broken remedy.** Between B2 and Part C's merge, the openrouter remedy names `ccrc-models-probe`, which no longer resolves on PATH. It fails loudly instead of running a stale probe. C4 fixes it.
- **Stale comments that stay.** The LiteLLM template's header and two placed unit files' comments still describe the other repository's files. Editing them restarts both lanes' LiteLLM tiers, or re-places the units, for a comment; they change with those files' next real edit.
- **The foreign usage-timer reads stay.** `_inst_codex_usage`'s withhold arm and doctor's two WARNs about the other repository's usage timers cannot fire once Part B removes those units, unless something reinstalls them. They stay as a fail-safe.
- **The snapshots are never pruned by this plan.** `~/.ccgpt-retired-<UTC>/`, R-O7's `~/.ccgpt-launcher-r-o7/` and `~/.ccrc-p4` stay until the operator removes them.
- **Both lanes' authDirs sit under `~/.handoff`,** a directory the other repository's tooling also uses. Moving them is a credential move, which spec decision 5 rules out for adoption; it would need its own design.
- **Later:** an operator ruling to remove the other repository's venvs and logs (R4-1, R4-2).

---

## Deviations found

Each entry was issued its number by the ledger allocator when this plan was published. A code comment or later document that cites one of these numbers points here.

### D-5303 — Plan 4's start gate is ruling R-O9-REPLACED, not Plan 3b's soak clock

- **Departs from:** Plan 3b's R-O9 ("one full weekly usage window on both lanes before Plan 4, reset to reset") and its B6 Step 7 clock.
- **Why:** the provider reset both lanes' weekly windows early, together, about every two days, so the first resets the clock recorded never happened, one lane's recorded end went stale, and no seven-day window completed. The operator replaced the window with five measured items (The gate).
- **Cost if wrong:** a defect that only a full week at the weekly cap would show reaches Plan 4. The cap path is waived by name, and Part B's snapshot keeps the old files recoverable.

### D-5304 — the carried list's ".py copies" are ccrc's own live files, and stay

- **Departs from:** Plan 3b's carried Task 4 list: "`ccgpt-proxy` and `ccgpt-usage`, with their `.py` copies".
- **Why:** `~/.local/bin/ccgpt-proxy.py` and `ccgpt-usage.py` are two of ccrc's four `CODEX_LANE_BINS`, placed by its installer and byte-equal to its tree. Both lanes' shims run the first, and ccrc's usage publisher runs the second every fifteen minutes. Removing them stops both lanes.
- **Cost if wrong:** none; the files are ccrc's.

### D-5305 — the usage unit template pair is tracked in the other repository, so Part A deletes ten files

- **Departs from:** Plan 3b's carried amendment that the `ccgpt-usage@.{timer,service}` pair "is not in that repository's git tree", and its Task 4's "box-only" template.
- **Why:** that was measured on a checkout many commits behind the other repository's remote `main`. At its current `main` the pair is tracked, with a test asserting on it, as are the second lane's launcher and the model-class install doc. The count is the carried "ten files deleted plus one split".
- **Cost if wrong:** none beyond A3 Step 1's re-measure.

### D-5306 — the GLM wrapper's install notes move into the README before the install doc is deleted

- **Departs from:** the carried Task 1, which says the handoff README already carries the GLM row and that a grep proves the notes are complete there before any line goes.
- **Why:** the README carries the row, but not the notes. They live only in the model-class install doc, which Part A deletes, so the carried grep would fail. A1 moves them, and corrects the row, which describes behaviour the wrapper no longer has.
- **Cost if wrong:** a longer README.

### D-5307 — Part B snapshots every path it removes, and its list includes the config and publisher backups

- **Departs from:** the carried Task 4, which verifies only R-O7's launcher snapshot before any `rm`, and lists the box-global config, its per-lane copies, and backups of the launcher and shim.
- **Why:** the 2026-10-17 census found paths on the list with no copy in any git tree or snapshot: the usage drop-in's `path.conf`, the box-global LiteLLM config, lane 2's copy, the render's `.prev`, a pre-registry backup, and one publisher backup whose only copy is an unreferenced git object. Copying every path is simpler than proving which need it, and makes Part B reversible from the snapshot alone. The list also takes the publisher's backups and the three config backups, which the carried text does not name, because they belong to the same retired files.
- **Cost if wrong:** a few hundred kilobytes in a `0700` directory.

### D-5308 — Z3 stays

- **Departs from:** the carried Task 5's "Z3's and Z4's guards go with their pins", and spec §20.9's "and the two guards §20.1 and §20.2 add".
- **Why:** Z4 guards the external arm's bare stop, which C1 deletes. Z3 refuses `ccrc models <id> init codex` on a row that is not codex-kind. Without it, that verb would create a registry whose every hourly refresh then fails at the probe. The guard costs nothing and keeps the refusal at the verb that causes it (R4-3).
- **Cost if wrong:** one refusal the operator would rather not see.

### D-5309 — the other repository's deletion is cited by date, not by commit

- **Departs from:** the carried "Record that the cutover and the deletion are done, citing the other repository's deletion commit".
- **Why:** this repository is public and names no private repository or its refs; a commit id is such a ref.
- **Cost if wrong:** a reader with access to the other repository finds the commit by date.

### D-5310 — the openrouter remedy names the verb that runs the probe

- **Departs from:** nothing carried; an addition the census found.
- **Why:** `deploy/models-op.mjs` tells the operator to run `ccrc-models-probe` by name. ccrc stopped placing it on PATH in Plan 3a, so the name resolves to a stale copy that Part B removes, and then to nothing. `ccrc models <id> discovery add` runs the probe ccrc ships and passes its answer.
- **Cost if wrong:** none.

### D-5311 — the remaining test file is renamed

- **Departs from:** nothing carried; it makes the carried check true.
- **Why:** after the split, the file's name, its docstring and the `.gitignore` comment still say `ccgpt`, so the carried "`git grep ccgpt` hits only superseded records" could not pass. The 15 methods left test the GLM and K3 wrappers' gates and the provider allow-list, and the new name says so.
- **Cost if wrong:** a rename in a repository with no CI for the file.

### D-5312 — a deleted test method may map to nothing in ccrc

- **Departs from:** critic #19's carried mapping, in which each deleted method maps to a ccrc case or to a stale `nohup` pin.
- **Why:** some deleted methods pin behaviour the old launcher had and ccrc deliberately does not, such as deriving a lane's paths and ports from its id instead of its roster row, or merging its settings by a heredoc. Each such row gives its one-line reason, and the PR body counts them.
- **Cost if wrong:** a lost behaviour hidden under `none`, bounded by the per-row reason and the count.

---

## Execution record

The controller appends here, by shape only: the gate's readings, Part A's merge date (never its PR number, URL or commit; D-5309), Part B's window, removal count and verification, and Part C's PR (this repository's `#n`).
