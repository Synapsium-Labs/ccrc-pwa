# Landing order, wave 3b — the conflict radar, `ccd-land-probe` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec stage 3, the read-only conflict radar, on the fleet box. For each project the operator opts in, a timer-driven sibling executable, `ccd/ccd-land-probe`, measures every five minutes:
- which open PRs conflict with the base, and with each other;
- whether the base's required checks are green;
- each workspace branch's lineage of clean base merges.

It writes those measurements, and the opt-in mirror stage 4 reads, under `$REG/landing/<project>/`.

**Why:** Coordinators send sync and order mail without a measured conflict: spec §10's stage 3 row counts about 14 of 629 feed rows. They also investigate reds that `main` gave them. And stage 4 cannot accept a clean main merge without a lineage someone measured (spec §9: "stage 4 needs stage 3's lineage").

**Architecture:**
- **One new executable, `ccd/ccd-land-probe`.** A bash head handles the arguments, the knobs, the global pause, one `flock` and the tool check. It then hands over to one embedded Python program (`python3 -I`), which does every git, gh and file act.
  - Python gives each child a deadline, kills its whole process group, and renames atomically with no GNU spelling. `macos-platform.test.ts` scans every shipped `ccd/*` script whole.
- **Read-only by code, in three layers.**
  1. Every git call goes through `git_ro`. It owns a fixed hardening prefix, and refuses any subcommand outside two literal allowlists and any caller option that could run code or re-point the repository.
  2. gh is reached through exactly two call sites, `gh_get` (`api --method GET`) and `gh_pr_list`. Both name the repository explicitly.
  3. A literal source pin forbids `push`, a PR merge, `update-branch`, any gh method or field flag but GET, and any third git or gh call site. A validate-only self-test proves `git_ro`'s refusals without running git.

  Each layer is shown red by planting.
- **A per-tick scratch repository.** A bare repository under `$TMPDIR` borrows the project's object store as an alternate (the `ccd/lib/disk-retention.sh` nested-rescue precedent). It receives the fetch and every `merge-tree` object, and it is removed on every exit path, SIGTERM included. The project repository is only read. Its object count before and after each tick is recorded for doctor (spec §5.3, §12).
- **Four outputs, all JSON with `"v": 1`:** `probe`, `main-health`, `<id>.lineage` and the opt-in mirror `enabled`. Each is created exclusively beside its final name and renamed into place, only inside real, owned directories. The formats below are the interface stage 4 (wave 4) reads.
- **Units and their wiring:** the units, the install spine (units on the `fleet` and `both` roles, Linux), uninstall, the fallback `deploy.sh`, and doctor.

No server, wire, PWA, skill, hook or `ccd` verb change. Spec §5.3's server reader, wire fields and PWA chip move to wave 4b, planned after wave 4's acceptance (D-4329).

**Tech Stack:** bash 5.2, Python 3.12 (standard library only), git 2.43 (`merge-tree --write-tree --name-only --no-messages`, 2.40 or later), gh 2.45, systemd user units, TypeScript and vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, these sections:
- §5.3, the whole stage.
- §5.4: the lineage table these files serve, and the marker's sentence.
- §5.7.3: what "passing" means for a required check. main-health applies it.
- §6: the `ccd/ccd-land-probe` and `deploy/systemd/ccd-land-probe.{service,timer}` row.
- §7: "read-only by code, pinned".
- §9: stage 3 comes next, and it is AGENT-FIRST.
- §10's stage 3 row.
- §12: "The probe's scratch objects grow: bounded per tick, measured by doctor."

**Other sources:**
- The programme ledger, `docs/superpowers/programs/landing-order.md`: row 3b (scope "`ccd-land-probe`, the read-only conflict radar, and its opt-in mirror"; deploy class "ccd, deploy"; run 310, block 4326–4335) and the carried constraints.
- The siblings this script copies:
  - `ccd/ccd-tmp-sweep`: the pause, flock and knob order, and its `lstat`/uid/`O_NOFOLLOW` discipline.
  - `ccd/ccd-pool-sync`: no GNU spelling, and the python3 `os.rename`.
  - `ccd/ccd-scope-sweep`: a pause file under `$REG`, and doctor's freshness check.
  - `ccd/lib/disk-retention.sh`: the alternates scratch.
- In `ccd/ccd`:
  - `READ_PREFIX`, `FETCH_PREFIX`, `PINNED_KEYS` and `FETCH_KEEP`: the git hardening this probe copies.
  - `_gh_repo_slug`: the repository from origin's URL.
  - `_pr_landing_rules`: the two required-check GETs, with a `%2F`-encoded base.
- `deploy/measure-landing.py`'s `required_contexts` and `required_state`.

**Plan review.** Three Opus lenses (spec fidelity, executability, safety) reviewed the plan, with a Sonnet refuter per serious finding. They returned 18 important and 6 minor findings, none refuted, and all are folded in below. A second Opus pass confirmed every one resolved, and found 4 important and 4 minor problems in the revision itself. A third pass confirmed those, and found 1 important and 4 minor more. All of them are folded in.

**Prerequisite:** wave 3 merged (#248, `9a255a74`), which holds. This wave's workspace is a fresh child from `main`. The open wave 3e (#1127) touches skills only. Its worker's claim holds `README.md`, which Task 4 edits, so Task 4 waits for that claim to be released, or asks its holder for a disjoint-hunk consent.

## Global Constraints

- **Public repository.** No private host, path, account, lane, person, other project or tracker id goes in code, tests, docs, commits or the PR. Fixtures use neutral names: `proj-a`, `ws/alpha`, `o/r`, `ci/test`, `lane-a`.
- **Words the file never contains, not even in a comment:**
  - `update-branch` (`update-branch-absent.test.ts`, and R6 below);
  - the word `push`;
  - a PR merge, spelled `pr` then `merge`.

  The header says "never sends a ref anywhere", "never lands a PR" and "never updates a PR's branch".
- **Read-only by code.**
  - The probe writes only regular files under real, owned directories below `$REG/landing/`, and inside its own scratch directory.
  - It never writes the project repository: not its refs, config, object store, index, hooks, `FETCH_HEAD`, commit-graph or maintenance state.
  - It never sends a ref anywhere, and never calls a gh method other than GET.
- **No GNU-only spelling** in the file (`macos-platform.test.ts`): no bare `timeout`, `stat -c`, `du -b`, `date -d`, `mv -fT` or template-less `mktemp`.
- **Fixture HOMEs only.**
  - Every probe spawn is in a `server/test/ccd*.ts` file, so `ccd-workspaces.test.ts`'s spawn scan reads it. It uses `makeCcdHarness` and spells `ghContainedEnv(h.home, {...}, {systemd: true, tmux: true, net: true})` at the call site.
  - The real `gh` is never reached. A functional stub is given through `CCD_LAND_PROBE_GH` (D-4331). The harness's poison `gh` stays on PATH, and its record is asserted empty after each case.
- **Install every package's modules once, before Task 1:** `(cd server && npm ci) && (cd agent && npm ci) && (cd ui && npm ci) && (cd pwa && npm ci)`.
- **Suites run in the foreground**, with a timeout of at least 600000 ms, package-local, one file per process: `(cd server && ./node_modules/.bin/vitest run test/<file>)`. Cases that run slow wrappers carry an explicit 60 s case timeout (`server/vitest.config` sets 20 s on Linux).
- **Repo-wide guards in every task's suite run:**
  - `update-branch-absent`, `macos-platform`, `topology-clean` and `ccd-workspaces`;
  - `single-definition/*` and `single-definition-pin`;
  - `citations`, `deviation-refs` and `typecheck-tests`.

  Task 3 adds `install-census`, `gen-wrappers`, `ccrc-install-*`, `ccrc-uninstall`, `ccrc-doctor-*`, `ccrc-settings-census`, `pool-name-parity`, `timer-first-run` and `agent/test/deploy-verify.test.ts`.
- **No numeric line citation on an added line outside `docs/`** (`citations.test.ts`).
- **Branch discipline:** commit on the workspace's own branch. Never a feature branch, a rebase or a force push.
- **Each new guard ships with a red**, measured and named in the wave-done. Mutations run sequentially, are restored from a saved copy (sha checked), and are bounded by `timeout -k` and a measured process cap.
- **Deviation numbers** come from run 310's block, 4326–4335. This plan defines 4326–4334. A worker names a departure in the wave-done mail and never calls the allocator.

## Review Focus

1. **The project repository is never written.**
   - The fetch lands in the scratch only.
   - `merge-tree` objects land in the scratch store, never the alternate.
   - No hook or fsmonitor runs.
   - A test snapshots the project's `for-each-ref`, `count-objects -v`, `config --list` and `.git/hooks` before and after a probe run, and expects them unchanged. A fixture global `core.hooksPath` hook writes a canary that must stay absent.
2. **A failed or partial measurement is `unmeasured`, never `clean` or `green`.**
   - A failed or timed-out fetch writes `probe`, `main-health` and every lineage as `unmeasured`.
   - A `merge-tree` that exits other than 0 or 1 is unmeasured.
   - So is a required check that is queued, running or not completed, or one pinned to an App that shows only as a status.
3. **The opt-in mirror fails closed.**
   - `enabled` carries its own time. Stage 4 trusts it only while it is fresh and neither pause marker exists.
   - Every tick that runs removes it for a missing, invalid or `lineage=off` conf, and for a paused project too.
   - Uninstall removes it.
4. **A lineage step is accepted only when all three hold:**
   - it is a two-parent merge;
   - its second parent is on the base fetched this tick;
   - its tree equals `merge-tree(P1, P2)`'s clean tree.

   Anything else stops the chain.
5. **The tick is bounded, and leaves nothing behind.**
   - Each child has a deadline that kills its process group.
   - Each project has a budget, and the whole tick has one below the unit's `TimeoutStartSec`.
   - SIGTERM runs the cleanup.
   - The pairwise set is at most 10 heads, and the lineage at most 8 steps.
   - A crashed tick's scratch is removed by the next tick: only a real, owned directory holding a regular sentinel file.

---

## Design: the files, their grammar and their meaning

This section is the contract. Tasks 1 and 2 implement it, and the plans for waves 4 and 4b read it as written.

### Paths

| Path | Writer | Meaning |
|---|---|---|
| `~/.ccrc/landing/<project>.conf` | the operator, by hand; no writer in the tree | opts `<project>` into the radar (D-4327) |
| `$REG/land-probe-paused` | the operator, by hand; no writer in the tree | global pause: the probe exits 0 before its lock (D-4326) |
| `$REG/landing/<project>/paused` | the operator, by hand; no writer in the tree | this project is not measured (D-4326) |
| `~/.ccrc/land-probe.lock` | the probe | one tick at a time (`flock -n`) |
| `$REG/landing/<project>/probe` | the probe | the radar |
| `$REG/landing/<project>/main-health` | the probe | the base tip's required checks |
| `$REG/landing/<project>/<id>.lineage` | the probe | one registry row's workspace-branch lineage |
| `$REG/landing/<project>/enabled` | the probe | the mirror of `lineage=on` (spec §5.4) |
| `$TMPDIR/ccd-land-probe.<random>/` | the probe | the per-tick scratch, holding the regular file `.ccd-land-probe-scratch` |

- `$REG` is `$HOME/.cc-sessions`. The projects root is `$HOME/projects`, as `ccd/ccd`'s `PROJECTS_ROOT` has it.
- `<project>` matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
- **Every directory the probe writes into, or deletes from,** must pass two checks: `os.lstat` shows a real directory (not a symlink), and `st_uid == os.getuid()`. This covers `$REG/landing/`, each `$REG/landing/<project>/`, and the scratch. The probe creates a missing directory with mode `0o755`. A directory that fails either check is skipped, with one log line, and nothing under it is touched.
- **The tmp file** is created with `tempfile.mkstemp(dir=<that directory>, prefix='.lp.')`, which opens with `O_CREAT|O_EXCL`. The short fixed prefix keeps the tmp name under `NAME_MAX` for the longest id a registry row can carry, 247 characters, because `$REG/<id>.project` must fit. It is written, `fsync`ed and renamed onto the final name. A deletion touches only a regular file (lstat) named `enabled` or `*.lineage` in such a directory.

### The conf

- UTF-8 lines of `key=value`, with no spaces around `=`. Blank lines and `#` lines are ignored.
- Keys:

  | Key | Values | Default | Meaning |
  |---|---|---|---|
  | `base` | a branch name matching `^[A-Za-z0-9._/-]+$`, not starting with `-` | `main` | the branch the radar measures against |
  | `lineage` | `on` or `off` | `off` | whether stage 4 may accept a lineage for this project |

- **`conf-invalid`** covers a repeated key, an unknown key, a bad value, an unreadable file, a non-UTF-8 byte, and a conf that is not a regular file (lstat). For that project the tick:
  - does not measure;
  - removes `enabled`;
  - logs one line that names the reason and never the bytes.
- An empty conf means the radar is on and lineage is off.

### The repository

- The slug comes from `git_ro('project', ['config', '--get', 'remote.origin.url'])`, restating every rule of `ccd/ccd`'s `_gh_repo_slug`:
  - exactly one of the prefixes `https://github.com/`, `git@github.com:` and `ssh://git@github.com/`;
  - an optional `.git` suffix stripped;
  - exactly two segments, each ASCII `[A-Za-z0-9._-]+`;
  - no `.` or `..` segment, and no owner starting with `.`.

  Anything else makes the project `unmeasured` with `why: repo-unreadable`. The worker reads `_gh_repo_slug` and its docs-helper twin `slug_from_url`, and runs the probe's copy over the same verdict corpus they share where one exists. Any difference is a departure.
- Every gh call names `--repo <slug>` (`pr list`) or `repos/<slug>/…` (`api`). The gh child's environment drops `GH_REPO` and `GH_HOST`.
- `<base>` is `%2F`-encoded in REST paths, as `_pr_landing_rules` does it.
- The fetch URL is `git_ro('project', ['ls-remote', '--get-url', 'origin'])`, which applies `insteadOf`. The fixture uses `insteadOf` to point a `github.com` origin at a local bare repository, on the `makeGhRepo` harness's pattern.

### `probe`

```json
{"v":1,"project":"proj-a","at":"2026-10-27T09:00:00Z","state":"measured",
 "base":{"ref":"main","sha":"<40 hex>"},
 "heads":[{"pr":12,"head":"<40 hex>","branch":"ws/alpha","id":"lane-a-proj-a-alpha",
           "base":{"state":"clean"}},
          {"pr":13,"head":"<40 hex>","branch":"feature/x","id":null,
           "base":{"state":"conflict","paths":["README.md"],"pathsCut":false}},
          {"pr":14,"head":"<40 hex>","branch":"ws/beta","id":"lane-a-proj-a-beta",
           "base":{"state":"unmeasured","why":"budget"}}],
 "headsCut":false,
 "pairs":[{"a":12,"b":14,"state":"conflict","paths":["src/x.ts"],"pathsCut":false}],
 "pairHeads":[14,12],"pairsCut":false,
 "store":{"before":{"count":0,"size":0,"inPack":0,"packs":0},"after":{"count":0,"size":0,"inPack":0,"packs":0}},
 "scratch":{"sizeKiB":0},
 "elapsedMs":1234}
```

- **`state`** is `measured` or `unmeasured`. An `unmeasured` probe carries `why` (`fetch-failed`, `fetch-timeout`, `gh-failed`, `repo-unreadable` or `budget`) and empty `heads` and `pairs`.
- **The open heads** come from `gh pr list --repo <slug> --state open --base <base> --limit 100 --json number,headRefName,headRefOid,isCrossRepository`.
  - Cross-repository heads are dropped.
  - `headsCut` is true when 100 rows came back.
  - Heads are ordered by PR number, descending.
- **`id`** is the one registry id whose `$REG/<id>.project` is `<project>` and whose `$REG/<id>.branch` equals `headRefName`, or `null`. Registry files are read with `O_NOFOLLOW`, regular files only.
- **The pairwise set** is the bound heads in PR-number order, descending, at most `CCD_LAND_PROBE_PAIR_HEADS` of them (default and maximum 10). Each unordered pair is measured once, with `a < b`. `pairsCut` is true when more bound heads exist (D-4330).
- **A merge-tree answer** comes from `merge-tree --write-tree --name-only --no-messages <a> <b>`:
  - exit 0 with a 40-hex first line is `clean`;
  - exit 1 with a 40-hex first line is `conflict`, whose `paths` are the non-empty lines after line 1, deduplicated in order, at most 20 (`pathsCut`);
  - anything else is `unmeasured` with a `why`: `timeout`, `rc-<n>`, `no-tree` or `budget`.
- **`store` and `scratch`.** `store` is the project's `count-objects -v` (`count`, `size`, `in-pack`, `packs`) just before and just after the project's tick. `scratch.sizeKiB` is the scratch's size just before removal. Both are the doctor measurement (D-4332).

### `main-health`

```json
{"v":1,"project":"proj-a","at":"…","sha":"<40 hex>","state":"green",
 "required":[{"name":"build","app":null},{"name":"test","app":15368}],"failing":[],"pending":[]}
```

- **The required set** is the union of two reads, each name carrying the App it is pinned to (`null`, or `-1`, means no App), per §5.7.3 (D-4328):
  - every `required_status_checks` rule's `parameters.required_status_checks[]` (`context` and `integration_id`) in `GET repos/<slug>/rules/branches/<base>`;
  - `protection.required_status_checks.checks[]` (`context`, `app_id`), plus any `.contexts[]` with no App, in `GET repos/<slug>/branches/<base>`.

  A name pinned to two different Apps is `unmeasured`, with `why: app-conflict`.
- **The evidence** on the base tip `sha` (the fetched base) is `GET repos/<slug>/commits/<sha>/check-runs?per_page=100` (`--paginate`) and `GET repos/<slug>/commits/<sha>/status` (its `statuses`).
- **Judging a name:**
  - Take its newest check run (highest `id`). Where the name is pinned, take only runs whose `app.id` equals the pin.
  - A run passes when `status == "completed"` and its `conclusion` is `success`, `neutral` or `skipped`.
  - A run fails when `status == "completed"` and its `conclusion` is `failure`, `timed_out`, `cancelled`, `action_required`, `startup_failure` or `stale`.
  - Anything else is pending.
  - A name with no qualifying run falls back to the newest status, but only when no App is named. A status passes on `success`, fails on `failure` or `error`, and is pending otherwise.
  - A pinned name seen only as a status is `unmeasured`, with `why: app-unverifiable`, never green.
  - A name with neither a run nor a status is pending.
- **`state`:** `red` if any name fails; `green` if the set is non-empty and every name passes; otherwise `unmeasured`, with `why` set to `no-required-set`, `pending`, `app-unverifiable`, `app-conflict`, `gh-failed`, `fetch-failed` or `budget`.

### `<id>.lineage`

```json
{"v":1,"project":"proj-a","id":"lane-a-proj-a-alpha","at":"…","state":"measured",
 "branch":"ws/alpha","tip":"<40 hex>","base":"<40 hex>",
 "chain":[{"merge":"<40 hex>","p1":"<40 hex>","p2":"<40 hex>"}],
 "stop":"not-a-merge"}
```

- **One file per registry row of `<project>`** (D-4333). The row qualifies when all of these hold:
  - the `id` passes `shared/api.ts`'s `isRegistryId` rule, restated in Python: at most 255 characters, only `[A-Za-z0-9._-]`, and not starting with `.` or `-`;
  - `$REG/<id>.project` equals `<project>`;
  - `$REG/<id>.branch` starts with `ws/`;
  - `refs/heads/<branch>` resolves in the project repository.
- **`tip`** is the local branch tip when the walk started. **`base`** is the fetched base sha.
- **The walk** starts at `c = tip` and runs at most `CCD_LAND_PROBE_LINEAGE_STEPS` steps (default and maximum 8). For each step:
  1. If `c` does not have exactly two parents, stop with `not-a-merge`.
  2. Take the parents `P1`, `P2`. If `P2` is not an ancestor of, or equal to, `base`, stop with `second-parent-not-on-base`.
  3. If `merge-tree(P1, P2)` exits 1, stop with `conflict`. If it is unmeasured, stop with `unmeasured`.
  4. If `c^{tree}` is not the clean tree, stop with `tree-differs`.
  5. Otherwise append `{merge: c, p1: P1, p2: P2}` and set `c = P1`.

  After the last allowed step, the stop is `limit`.
- **`state`** is `measured` unless a git call failed, timed out or ran out of budget. Then it is `unmeasured` with a `why`, and `chain` holds what was proven first.
- **On a failed or timed-out fetch,** every qualifying row's lineage is rewritten as `{state: "unmeasured", why: "fetch-failed", tip: <local tip>, chain: []}`.
- **Stale files.** A regular `*.lineage` file whose id no longer names a qualifying row is removed each tick.
- **What stage 4 reads (§5.4),** for a claim `T` and a live tip `L`:

  | File | Answer |
  |---|---|
  | absent | `lineage-unmeasured` (not yet ticked) |
  | unreadable, malformed, or `v` not 1 | `lineage-unmeasured`, detail `lineage-unreadable` |
  | `tip != L` | `lineage-unmeasured` (older than the live tip's ref) |
  | `tip == L` and `T` is some entry's `p1` | accept, `measured.via: 'base-only-merge'`, whatever `state` says, because each step in `chain` was proven |
  | `tip == L`, `state == "unmeasured"`, `T` not in `chain` | `lineage-unmeasured` |
  | `tip == L`, `state == "measured"`, `T` not in `chain` | `stale-tip` / `stale-review` (no such chain) |

### `enabled`

```json
{"v":1,"project":"proj-a","at":"2026-10-27T09:00:00Z"}
```

- **Written** on a tick where the conf parsed, `lineage=on`, and the project is not paused.
- **Removed** on every tick that runs where any of these holds:
  - the conf is absent or invalid;
  - the conf says `lineage=off`;
  - the project is paused. A pause stops acceptance as well as measurement.
  - the directory under `$REG/landing/` has no conf at all.
- **`ccrc uninstall`** removes every regular `$REG/landing/*/enabled` file.
- **Stage 4 trusts `enabled` only when** it is a regular file, parses, its `project` matches, its `at` is within `LAND_PROBE_ENABLED_FRESH_S` (wave 4 states the bound: four timer intervals, 1200 s, amended 2026-10-28 after review 1109), and neither `$REG/land-probe-paused` nor `$REG/landing/<project>/paused` exists.
  - In every other case stage 4 answers as for an absent or unreadable marker: `stale-tip` / `stale-review`, as today. The detail is `landing-marker-unreadable` for an unreadable marker, and `landing-marker-stale` for a stale one.
  - So a tick that never runs (global pause, bad knob, crash, dead timer) cannot keep acceptance alive.

### The tick

1. **The bash head.** In order:
   - Any argument is a usage error, exit 2.
   - Knobs are validated (`_lp_die`, exit 1). Each is listed with its default and range:
     - `CCD_LAND_PROBE_FETCH_TIMEOUT`: 120 (1–3600)
     - `CCD_LAND_PROBE_GIT_TIMEOUT`: 20 (1–600)
     - `CCD_LAND_PROBE_GH_TIMEOUT`: 15 (1–600)
     - `CCD_LAND_PROBE_BUDGET`: 240 (10–3600), per project. Each project's effective budget is `min(CCD_LAND_PROBE_BUDGET, tick.remaining())`, and every child's deadline is capped at the project budget that remains.
     - `CCD_LAND_PROBE_TICK_BUDGET`: 780 (30–840), the whole tick. The range keeps it below the unit's `TimeoutStartSec=900` with a margin.
     - `CCD_LAND_PROBE_PAIR_HEADS`: 10 (0–10)
     - `CCD_LAND_PROBE_LINEAGE_STEPS`: 8 (0–8)
     - `CCD_LAND_PROBE_GH`: default `gh` (D-4331)
     - `CCD_LAND_PROBE_SELFTEST`: unset, or `git_ro` (D-4334)
   - With `CCD_LAND_PROBE_SELFTEST=git_ro`, `exec python3 -I` at once, before the pause check, the `mkdir` and the lock. The self-test reads no pause, takes no lock and creates no file.
   - If `$REG/land-probe-paused` exists, log `paused` and exit 0.
   - `command -v git python3 flock`, else exit 1.
   - `mkdir -p ~/.ccrc`; `exec 9>~/.ccrc/land-probe.lock || exit 1`; `flock -n 9 || exit 0`.
   - `exec python3 -I - <<'PY' … PY`. fd 9 stays open, so the lock holds.
2. **Signals.** SIGTERM and SIGINT raise `SystemExit`. The one `finally` that removes the scratch (step 4.4.10 is that `finally`) first sends `SIGKILL` to the process group of the child in flight, if any, and waits for it. Only then does it remove the scratch, so no fetch helper is still writing into the directory.
3. **Clear stale scratch.** Remove each `$TMPDIR/ccd-land-probe.*` that is a real, owned directory holding a regular `.ccd-land-probe-scratch`, and that is older than one hour.
4. **For each `~/.ccrc/landing/*.conf`,** sorted, while the tick budget lasts:
   1. Validate the name and parse the conf.
   2. A paused project is not measured: remove its `enabled`, write nothing else.
   3. Check that `$HOME/projects/<project>` is a git main checkout: `os.lstat` shows `<repo>/.git` as a real directory. This is not a git call.
   4. Within the project budget:
      1. Record `store.before`.
      2. Make the scratch and its alternate.
      3. Read the open heads, then fetch the base and every head into the scratch.
      4. Measure base × head, then the pairs.
      5. Write `probe`.
      6. Write `main-health`.
      7. Write each lineage, and remove stale ones.
      8. Write or remove `enabled`.
      9. Record `store.after` and `scratch.sizeKiB`, and rewrite `probe` with them.
      10. Remove the scratch.

   A project starts only while the tick's remainder is at least 10 s (the per-project minimum). A project not started keeps its files. Its `probe` is not rewritten, so its `at` ages, which doctor and stage 4 read.
5. **Every directory under `$REG/landing/` with no conf** has its `enabled` removed.
6. **Exit 0.** A per-project failure goes into that project's files and the log.

**Children.** Every child runs with `start_new_session=True`. On its deadline the whole process group gets `SIGKILL` (`os.killpg`), and the answer is a timeout.

**The fetch.**
- One call per project tick, holding every refspec: `+refs/heads/<base>:refs/probe/base +refs/pull/<n>/head:refs/probe/pull/<n>…`.
- Run under `CCD_LAND_PROBE_FETCH_TIMEOUT`, with `--no-tags --no-write-fetch-head --no-recurse-submodules`.
- **Env scrub.** Every child's environment drops every `GIT_*` variable except `ccd/ccd`'s `FETCH_KEEP` set, and the fetch keeps that set: `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_SSL_CAINFO` and `GIT_SSL_CAPATH`. Then `GIT_TERMINAL_PROMPT=0` is set.

### `git_ro`

`git_ro(where, args, timeout)` runs:

```text
git --no-pager -c core.hooksPath=/dev/null -c core.fsmonitor=false [--no-optional-locks] -C <dir> [fetch prefix] <args…>
```

- `--no-optional-locks` is used on `project` only. The fetch prefix is `-c gc.auto=0 -c maintenance.auto=false -c transfer.unpackLimit=1 -c fetch.writeCommitGraph=false`, used on the scratch's `fetch` only.
- The prefix is a literal tuple in the file, which R5 pins. `-C <dir>` is the project repository or the scratch, chosen by `where`. A caller never supplies either the prefix or the directory.

| `where` | `args[0]` may be |
|---|---|
| `project` | `rev-parse`, `rev-list`, `for-each-ref`, `cat-file`, `merge-base`, `count-objects`, `ls-remote` (only `['--get-url', 'origin']`), `config` (only `['--get', 'remote.origin.url']`) |
| `scratch` | `init` (only `['-q', '--bare', <the scratch path>]`), `fetch`, `merge-tree`, `merge-base`, `rev-parse`, `rev-list`, `cat-file` |

`git_check(where, args)` is the validator, and `git_ro` calls it first. Each rule raises `ProbeRefused` with its own reason:
- `subcommand <x>`, when `args[0]` is outside its row;
- `form <x>`, when a restricted subcommand's arguments differ from the exact form;
- `option <opt>`, when any later element of `args` starts with `-c`, `--config-env`, `-C`, `--git-dir`, `--work-tree`, `--exec`, `--upload-pack`, `--receive-pack` or `-u`;
- `key <k>`, when any element contains `core.hooksPath` or `core.fsmonitor`, in any case.

The rules are checked in that order, and the first that applies answers. Option prefixes match case-sensitively: `-c` is not `-C`.

**The self-test (D-4334).** With `CCD_LAND_PROBE_SELFTEST=git_ro`, the program reads JSON lines `[where, args]` from stdin and prints `allowed`, or `refused <reason>`, for each, using `git_check` only. The bash head execs it before the pause and the lock. It runs no child, takes no lock, writes nothing, and then exits 0.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `ccd/ccd-land-probe` | new: the probe | 1, 2 |
| `server/test/ccd-land-probe.test.ts` | new: behaviour, fixture git, a stub gh | 1, 2 |
| `server/test/ccd-land-probe-readonly.test.ts` | new: the literal source pins and the self-test | 1 |
| `server/test/ccdLandProbeFixture.ts` | new: fixture origin and project, registry rows, conf, stub gh and the spawn | 1, 2 |
| `deploy/systemd/ccd-land-probe.service`, `deploy/systemd/ccd-land-probe.timer` | new | 3 |
| `ccd/ccrc` | `_inst_bins` and both install-census echoes; `_inst_units`; the enable step; `_uninst_wrappers`' exclusion `case`; uninstall's disable loop, unit and bin removal lists, the `enabled` sweep, and its final census | 3 |
| `ccd/ccrc-doctor-checks` | `_check_services` (`known` and its `why`), and `_check_land-probe`, registered in the check list | 3 |
| `deploy/deploy.sh`, `deploy/gen-wrappers.mjs` (`TOOLCHAIN_EXECUTABLES`) | ship the probe and its units; the wrapper orphan scan learns its name | 3 |
| `server/test/ccrc-installFixture.ts`, `ccrc-install-role.test.ts`, `ccrc-install-tree.test.ts`, `ccrc-install-units.test.ts`, `ccrc-install-landing.test.ts`, `ccrc-uninstall.test.ts`, `ccrc-doctor-core.test.ts`, `ccrc-doctorFixture.ts` (`HEALTHY_SKIPS`), `ccrc-settings-census.test.ts`, `timer-first-run.test.ts`, `agent/test/deploy-verify.test.ts` | the rows for the new bin, units, timer, check and knob | 3 |
| `README.md` | the units table row, and a `### Conflict radar (ccd-land-probe)` section | 4 |
| this plan | Deviations found | 1–4 |

## Task order

Task 1 → Task 2 → Task 3 → Task 4. Tasks 1 and 2 share the probe and its test, so they never run in parallel. Task 3 touches nothing Task 2 does and may start once Task 1 is committed. Task 4 waits for `README.md` to be free (Prerequisite).

## Pre-flight findings (measured while planning; not deviations)

1. git on the fleet box is 2.43.0, gh is 2.45.0 and python3 is 3.12.3.
2. git 2.43 `merge-tree --write-tree --name-only` on a conflict exits 1 and prints the tree id, the conflicted names, a blank line, then informational lines (`Auto-merging …`, `CONFLICT (content): …`). With `--no-messages` it prints only the tree id and the names. A clean merge exits 0 with the tree id alone. Measured by the plan review in a scratch repository.
3. No code reads or writes `~/.ccrc/landing/`, `$REG/landing/` or `ccd-land-probe`.
   - The PR-landing checks lane uses `$REG/pr-landing/`, `$REG/landing-disabled` and `$REG/landing-checks-live` (`shared/switches.ts`).
   - The probe's names cannot collide with those: a directory named `landing` and a file `land-probe-paused`.
4. `agent/src/whitelist.ts`'s `checkPath` lets the server read anything under `~/.cc-sessions`, so waves 4 and 4b need no whitelist change. `~/.ccrc/landing/` is not server-readable, which is why the marker is mirrored.
5. `update-branch-absent.test.ts` reads `git ls-files`, so it sees the probe only once the probe is in the index (Task 1 Step 4's `git add -N`). R6 reads the file directly.
6. No sibling calls gh or `git fetch` today. `ccd/ccd`'s hardening (`READ_PREFIX`, `FETCH_PREFIX`, `PINNED_KEYS`, `FETCH_KEEP`) is the model `git_ro` copies.
7. `ccd-land-probe` matches `WRAPPER_ID_RE` (`ccd/ccrc-wrapper-shape`). So `install-census.test.ts` requires it in all three of these, equally:
   - `_inst_bins`' id-shaped placements;
   - `TOOLCHAIN_EXECUTABLES`;
   - `_uninst_wrappers`' exclusion `case`.

   `ccd-tmp-sweep`'s bin is placed on every role, and only its units and timer are role-gated. The bin must never sit inside `_inst_bins`' GPT-lane `if [ "$INST_ROLE" != server ]; then` block.
8. On the doctor side, three constraints apply:
   - `healthy()` writes no landing conf, so `land-probe` SKIPs there, and `HEALTHY_SKIPS` (`ccrc-doctorFixture.ts`) rises by one.
   - `ccrc-settings-census.test.ts` reds an unclassed `CCRC_` name.
   - `pool-name-parity.test.ts` reds a `.cc-sessions/<segment>` literal on a code line of `ccrc-doctor-checks`, so the check spells `reg="$HOME/.cc-sessions"` and then `$reg/…`, as `_check_scope-sweep` does.
9. `timer-first-run.test.ts`'s census accepts `OnBootSec=` and `OnActiveSec=` alike. Only a per-timer case pins which one is used.

---

### Task 1: The probe's skeleton, the radar, and the read-only pins

**Files:**
- Create: `ccd/ccd-land-probe` (755), `server/test/ccdLandProbeFixture.ts`, `server/test/ccd-land-probe.test.ts`, `server/test/ccd-land-probe-readonly.test.ts`

**Interfaces:**
- Produces, in the Python program:
  - `git_check(where: str, args: list[str]) -> None` (raises `ProbeRefused`);
  - `git_ro(where: str, args: list[str], timeout: int) -> Result`;
  - `gh_get(path: str) -> Result` and `gh_pr_list(slug: str, base: str) -> Result`;
  - `write_json(dirpath: str, name: str, doc: dict) -> None`;
  - `remove_own(dirpath: str, name: str) -> None`;
  - `merge_answer(a: str, b: str) -> dict`;
  - `repo_slug(url: str) -> str | None`;
  - `class Budget(seconds)`, with `remaining()` and `spent()`.

  `Result` is `(rc: int | None, out: str)`, where `rc` is `None` on a timeout or a spawn failure.
- Produces, in the fixture: `makeLandFixture(h, opts)`, returning:
  - `origin` and `repo`;
  - `addHead(n, files)`, `addRow(id, branch)`, `conf(project, text)` and `pause(scope)`;
  - `stubGh(answers)`;
  - `run(env?)`, which spawns `bash ccd/ccd-land-probe` under the contained env, with `TMPDIR` a fixture directory and `CCD_LAND_PROBE_GH` the stub, and returns `{status, stdout, stderr}`;
  - `selftest(lines)`, which runs the self-test.

  The project's origin is `https://github.com/o/r.git`, with `url.<file:///…bare>.insteadOf` in the fixture HOME's `~/.gitconfig`.

- [ ] **Step 1: The fixture and the failing tests**

  Behaviour (`ccd-land-probe.test.ts`):
  - `a project with no conf is not probed, and nothing is written under $REG/landing`.
  - `base × each head: clean, conflict with only its paths, and the PR order`: three heads; `paths` equals `['README.md']` exactly; heads are in descending order; `base.sha` is origin's `main`.
  - `the pairwise set is the bound heads, newest first, at most 10`: twelve bound heads plus one unbound; `pairHeads.length === 10`, `pairsCut === true`, `pairs.length === 45`, no pair names the unbound PR, and the `src/x.ts` pair conflicts. Timeout 60 s.
  - `a failed fetch writes probe, main-health and every lineage unmeasured`: origin removed; `probe.why === 'fetch-failed'` with no heads; `main-health.state === 'unmeasured'`; each row's lineage is `{state:'unmeasured', why:'fetch-failed', chain:[]}`; exit 0.
  - `a merge-tree past its deadline is unmeasured, and its process group is gone`: a `git` wrapper first on PATH on `merge-tree` forks a `sleep 30` that records its pid, then sleeps. With `CCD_LAND_PROBE_GIT_TIMEOUT=1`, the head reads `why: 'timeout'` and the recorded pid is no longer alive. Timeout 60 s.
  - `the project budget marks what it did not reach as unmeasured`: `CCD_LAND_PROBE_BUDGET=10`, 6 s per merge-tree, three heads; at least one `why: 'budget'`. Timeout 60 s.
  - `the tick budget leaves an unreached project's files as they were`: two projects, `CCD_LAND_PROBE_TICK_BUDGET=30`, and a slow first project; the second project's `probe` mtime is unchanged. Timeout 90 s.
  - `the tick budget clips the project budget`: `CCD_LAND_PROBE_TICK_BUDGET=30`, `CCD_LAND_PROBE_BUDGET=240`, one project, 6 s per merge-tree, eight heads. Its probe lists `why: 'budget'` for the heads the tick did not reach, its `main-health` reads `why: 'budget'` if the GETs were not reached, and the run ends within 45 s. Timeout 90 s.
  - `SIGTERM mid-tick leaves no scratch, and no writer survives`: the `git` wrapper on `fetch` forks a child that keeps appending to a file inside the scratch and records its pid. SIGTERM goes to the probe once that file exists. Afterwards there is no `ccd-land-probe.*` under `TMPDIR`, and the recorded pid is not alive. Timeout 60 s.
  - `enabled mirrors lineage=on, carries its time, and every other answer removes it`: `lineage=on` gives JSON with `v`, `project` and an `at` within 60 s of now. Then each of these removes it in turn: `lineage=off`; an unknown key (logging `conf-invalid`); a symlinked conf; a deleted conf; and the project's own pause.
  - `the global pause exits 0 before the lock and writes nothing`: status 0; `$REG/landing` is absent; `~/.ccrc/land-probe.lock` was never created.
  - `a held lock exits 0 quietly`.
  - `an argument is a usage error`: status 2.
  - `a bad knob refuses`: `CCD_LAND_PROBE_PAIR_HEADS=11` gives status 1 and names the variable.
  - `the project repository is not written, and no hook or fsmonitor runs`: every fixture repository is built with `GIT_CONFIG_GLOBAL=/dev/null`. Immediately before `run()`, the fixture adds `core.hooksPath` to the HOME's `~/.gitconfig`, keeping its `insteadOf` line. The hooks directory it names has `reference-transaction` and `post-checkout` hooks that write a canary. The fixture asserts that no canary exists yet, and the case asserts `probe.state === 'measured'`, so the fetch really ran. After a full run (heads, pairs, lineage), the clone's `for-each-ref`, `count-objects -v`, `config --list` and `.git/hooks` listing are unchanged, and the canary is absent.
  - `a second remote does not change the repository measured`: the fixture adds an `upstream` remote; the stub's recorded argv all name `--repo o/r` or `repos/o/r/`.
  - `the slug follows _gh_repo_slug`: `ssh://git@github.com/o/r.git` is measured. `https://github.com/o/..`, `https://github.com/.x/y` and `https://example.com/o/r` are each `unmeasured` with `why: 'repo-unreadable'`.
  - `the scratch is removed, and only an owned, sentineled old scratch is cleared`: after a run `TMPDIR` holds no `ccd-land-probe.*`. Of four planted directories two hours old, only the first is gone; the other three are untouched, and so is the symlink's target:
    1. a real directory with a regular sentinel;
    2. one with no sentinel;
    3. one whose sentinel is a symlink;
    4. a symlink to a directory with a sentinel.
  - `a symlinked $REG/landing/proj-a is left alone`: it points at a fixture directory; the probe writes nothing through it, logs one line, and the target is unchanged.
  - `only the two read forms reached gh, and the poison saw nothing`: every recorded argv starts `api --method GET repos/o/r/` or `pr list --repo o/r --state open`, and `ghPoisonAt(h.home)` is empty.

  Pins and self-test (`ccd-land-probe-readonly.test.ts`), over `ccd/ccd-land-probe`'s whole text unless a row says otherwise:
  - `R1 never says push`: `/\bpush\b/i` has no match.
  - `R2 never names a PR merge`: `/\bpr\b[\s'",]*\bmerge\b/i` has no match.
  - `R3 gh has exactly two call sites, the two read forms, and none in the bash head's code`:
    - `/\[GH,/g` matches exactly twice: one is `[GH, 'api', '--method', 'GET', path]`, with `+ ['--paginate']` allowed; the other is `[GH, 'pr', 'list', '--repo', slug, …]`;
    - in the bash head (before `<<'PY'`), with whole-line `#` comments dropped first, `/(^|[\s;|&(])gh\s/m` has no match.
  - `R4 no method or field flag but GET`: none of these match: `/['"]--method['"],\s*['"](?!GET['"])/`, `/--method=(?!GET\b)/i`, `/['"]-X/`, `/['"]--(raw-)?field/`, `/['"]--input/`, `/['"]-[fF]['"]/`.
  - `R5 git has one call site, its prefix and its allowlists are the plan's`:
    - `/\[['"]git['"]/g` matches exactly once, inside `git_ro`;
    - the prefix tuple and the fetch-prefix tuple equal the Design section's;
    - the two allowlist tables equal the Design section's;
    - each is read by a regex over its literal.
  - `R6 never names update-branch`: `/update[-_]branch|updatePullRequestBranch/i` has no match.
  - `S1 the self-test allows the plan's calls and refuses the rest, each by its own rule`: through `selftest(lines)`, every call the program makes is `allowed`. Each case below must be refused with exactly the printed reason given, and each is one only that rule catches:
    - `subcommand`: `['project', ['fetch', 'x']]`, `['project', ['init']]` and `['project', ['-c', 'x=y', 'rev-parse']]`;
    - `form`: `['project', ['config', 'remote.origin.url', 'x']]` and `['scratch', ['init', '-q', '--bare', '/elsewhere']]`;
    - `option -c`: `['scratch', ['merge-tree', '-c', 'x=y', 'a', 'b']]` and `['project', ['rev-parse', '-cfoo']]`;
    - `option --upload-pack`: `['scratch', ['fetch', '--upload-pack=x', 'u']]`; `option -u`: `['scratch', ['fetch', '-u', 'x', 'u']]`;
    - `option --git-dir`: `['project', ['rev-parse', '--git-dir=/tmp']]`; `option -C`: `['project', ['for-each-ref', '--format=%(refname)', '-C', '/']]`;
    - `key`: `['scratch', ['merge-tree', 'core.hooksPath', 'b']]`.

    A self-test run with `~/.ccrc/land-probe.lock` held by the test and `$REG/land-probe-paused` present still prints every verdict, creates no lock file if none existed, and leaves `TMPDIR` and `$REG` unchanged.

- [ ] **Step 2: Run both files; see them fail**

  Run `(cd server && ./node_modules/.bin/vitest run test/ccd-land-probe.test.ts)` and `(cd server && ./node_modules/.bin/vitest run test/ccd-land-probe-readonly.test.ts)`. Expected: FAIL, because there is no probe yet.

- [ ] **Step 3: Write `ccd/ccd-land-probe`**

  The bash head follows "The tick" step 1. Its header comment states:
  - why this is a sibling, not a `ccd` verb (`ccd` makes no network call, as `ccd-pool-sync`'s header argues);
  - that it is read-only by code, through three layers;
  - the paths table;
  - that nothing in the tree writes the conf or either pause marker.

  The program implements the Design section.

- [ ] **Step 4: Put the probe in the index, then run both files and the repo-wide guards; see them pass**

  `git add -N ccd/ccd-land-probe` comes first, so `update-branch-absent`'s `git ls-files` sees the file. Then run every case and every guard.

- [ ] **Step 5: Mutations, each measured red, then restored**

  | # | Mutation | Expected red |
  |---|---|---|
  | M1 | add `# push` to the header | R1 |
  | M2 | add a third call site, `run([GH, 'pr', 'merge', '1'])` | R2, R3 |
  | M3 | `gh_get`'s `'GET'` → `'PATCH'` | R3, R4 |
  | M4 | add `'-f', 'x=1'` to `gh_get`'s argv | R3, R4 |
  | M5 | append `'--method=PATCH'` to `gh_get`'s argv | R3, R4 |
  | M6 | a comment naming `update-branch` | R6, `update-branch-absent` |
  | M7 | add `'push'` to the project allowlist | R1, R5 |
  | M8 | `git_check` stops refusing a later `-c` | S1's `option -c` cases |
  | M9 | `git_check` stops refusing `fetch` against the project | S1's `subcommand` case |
  | M10 | drop `-c core.hooksPath=/dev/null` from the prefix | R5, the not-written case |
  | M11 | drop `--no-messages` | the conflict-paths case |
  | M12 | `merge_answer` reads rc 1 as `clean` | the conflict-paths case |
  | M13 | the fetch-failure path writes `measured` | the failed-fetch case |
  | M14 | drop the `enabled` removal on a paused project | the mirror case |
  | M15 | remove the scratch `finally` | the scratch case, the SIGTERM case |
  | M16 | no SIGTERM handler | the SIGTERM case |
  | M17 | deadline kill by `proc.kill()` instead of `os.killpg` | the deadline case |
  | M18 | the global pause check after the lock | the global pause case |
  | M19 | gh resolves the repository itself (drop `--repo`) | the second-remote case, R3 |
  | M20 | no lstat check on `$REG/landing/<project>` | the symlinked directory case |
  | M21 | stale-scratch removal without the uid and symlink checks | the scratch case |
  | M22 | add a real `gh api x` line to the bash head | R3 |
  | M23 | the project budget not clipped to the tick's remainder | the tick-clips-project case |
  | M24 | the `finally` removes the scratch without killing the child in flight | the SIGTERM case (its writer survives) |
  | M25 | the self-test branch placed after the lock | S1's held-lock case |

- [ ] **Step 6: Commit**

  ```bash
  git add ccd/ccd-land-probe server/test/ccdLandProbeFixture.ts server/test/ccd-land-probe.test.ts server/test/ccd-land-probe-readonly.test.ts
  git commit -m "feat(ccd): ccd-land-probe, the read-only conflict radar (landing order wave 3b, Task 1)"
  ```

### Task 2: Lineage and main-health

**Files:**
- Modify: `ccd/ccd-land-probe`, `server/test/ccd-land-probe.test.ts`, `server/test/ccdLandProbeFixture.ts`

**Interfaces:**
- Consumes: Task 1's `git_ro`, `gh_get`, `write_json`, `remove_own`, `merge_answer` and `Budget`.
- Produces:
  - `walk_lineage(tip: str, base: str, steps: int, budget: Budget) -> dict`;
  - `required_set(rules: list, branch: dict) -> list[dict]`, each `{name, app}`;
  - `judge_required(required: list[dict], runs: list[dict], statuses: list[dict]) -> dict`.
- Produces, in the fixture:
  - `mergeBase(branch)`, which first advances origin's `main` by one commit and then merges it into the branch, so every merge is a real two-parent merge;
  - `handMerge(branch, edit)`, `conflictMerge(branch)`, `mergeOther(branch, other)`, `rebaseOnto(branch)`;
  - `stubChecks({rules, branch, runs, statuses})`.

- [ ] **Step 1: The failing tests**

  Lineage cases:
  - `a clean merge of the fetched base is one chain step, and the old tip is its p1`.
  - `a hand-edited merge stops at tree-differs`.
  - `a resolved conflict stops at conflict`.
  - `a merge of another workspace branch stops at second-parent-not-on-base`.
  - `a rebase leaves a single-parent tip: not-a-merge, empty chain`.
  - `nine clean base merges stop at limit after eight`.
  - `CCD_LAND_PROBE_LINEAGE_STEPS=0 writes an empty chain with stop limit`.
  - `a row of another project, a branch outside ws/, an id isRegistryId refuses, or a missing ref, writes no lineage`. A 247-character valid id, the longest a registry row can carry, DOES get one.
  - `a lineage file whose row is gone is removed; a symlink named x.lineage and a file not named *.lineage are not touched`.

  main-health cases:
  - `the required set is the union of the rules and the branch view, with each name's App`.
  - `every required name passing on a completed run is green`.
  - `a failing completed run is red, and names it`.
  - `a queued, in-progress or completed-without-conclusion required run is unmeasured pending, never green`.
  - `a run that reports success before it completes is pending`: two required names, `ci/early` and `ci/queued`. Each has exactly one run: `{status: 'in_progress', conclusion: 'success'}` and `{status: 'queued', conclusion: 'success'}` respectively. `state` is `unmeasured`, and `pending` equals `['ci/early', 'ci/queued']`.
  - `an App-pinned name passes only on that App's run`: a same-named run from another App leaves it pending.
  - `an App-pinned name seen only as a status is unmeasured app-unverifiable`.
  - `an unpinned name seen only as a status counts; a failing status is red`.
  - `a name pinned to two Apps is unmeasured app-conflict`.
  - `an empty required set is unmeasured no-required-set`.
  - `the newest run of a name wins`.
  - `a gh failure is unmeasured gh-failed`.
  - `a base with a slash is %2F-encoded in both REST paths`.

- [ ] **Step 2: Run; see the Task 2 cases fail, and Task 1's still pass**

- [ ] **Step 3: Implement** `walk_lineage`, `required_set` and `judge_required`, and wire them into the tick exactly as the Design section says.

- [ ] **Step 4: Run the file and the repo-wide guards; see them pass**

- [ ] **Step 5: Mutations, each measured red, then restored**

  | # | Mutation | Expected red |
  |---|---|---|
  | L1 | drop the tree-equality test | the hand-edited case |
  | L2 | drop the second-parent-on-base test | the other-branch case |
  | L3 | accept rc 1 as a clean step | the resolved-conflict case |
  | L4 | the step limit `<=` instead of `<` | the nine-merges case |
  | L5 | skip the stale-file removal | the row-gone case |
  | L6 | the id rule capped at 128 | the 247-character case |
  | L7 | the tmp prefix `.<name>.` instead of `.lp.` | the 247-character case |
  | H1 | treat `in_progress` as passing | the pending case |
  | H2 | an empty required set reads `green` | the empty-set case |
  | H3 | ignore statuses | the unpinned-status case |
  | H4 | the oldest run wins | the newest-run case |
  | H5 | ignore the App pin | the other-App case |
  | H6 | let a status satisfy a pinned name | the app-unverifiable case |
  | H7 | skip the `status == "completed"` test | the success-before-completed case |

- [ ] **Step 6: Commit**

  ```bash
  git add ccd/ccd-land-probe server/test/ccd-land-probe.test.ts server/test/ccdLandProbeFixture.ts
  git commit -m "feat(ccd): the probe's lineage walk and main-health (landing order wave 3b, Task 2)"
  ```

### Task 3: Units, the install spine, uninstall, the fallback deploy, and doctor

**Files:**
- Create: `deploy/systemd/ccd-land-probe.service`, `deploy/systemd/ccd-land-probe.timer`
- Modify: `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh`, `deploy/gen-wrappers.mjs`, and the tests in the File Structure row.

**Interfaces:**
- Consumes: Tasks 1 and 2's formats, which doctor reads.
- Produces: the doctor check `land-probe`, with its words `land-probe-not-yet`, `land-probe-never`, `land-probe-unreadable`, `land-probe-stale` and `land-probe-unmeasured`, and the knob `CCRC_LAND_PROBE_STALE_S` (default 1200).

- [ ] **Step 1: The failing rows**
  - `ccrc-installFixture.ts`: `UNIT_FILES` gains both units.
  - `ccrc-install-role.test.ts`:
    - the bin is placed on every role, beside `ccd-tmp-sweep`'s, outside the GPT-lane block;
    - both units and the enabled timer are placed on `fleet` and `both`;
    - neither unit is placed on `server`.
  - `ccrc-install-tree.test.ts`: the installed bytes equal `ccd/ccd-land-probe`.
  - `ccrc-install-landing.test.ts`: its exact bin set gains `ccd-land-probe`.
  - `install-census.test.ts` passes once `ccd-land-probe` is in `_inst_bins`, in `TOOLCHAIN_EXECUTABLES` and in `_uninst_wrappers`' exclusion `case`.
  - `ccrc-uninstall.test.ts`:
    - uninstall disables the timer and service, and removes both units and the bin;
    - it removes `$REG/landing/proj-a/enabled`, but leaves `probe` and a symlink named `enabled` in another project's directory.
  - `agent/test/deploy-verify.test.ts`: `deploy.sh` installs the bin (755) and both units (644), and enables the timer.
  - `timer-first-run.test.ts`: a per-timer case says `ccd-land-probe.timer` has `OnActiveSec=3min` and `OnUnitActiveSec=5min`, and no `OnBootSec=`.
  - `ccrc-doctor-core.test.ts`:
    - the `services` row for an inactive timer;
    - `land-probe` SKIPs on a `server` role, with no conf, and while `$REG/land-probe-paused` exists;
    - it WARNs `land-probe-not-yet` inside ten minutes of the timer unit's mtime, and `land-probe-never` after;
    - it WARNs `land-probe-unreadable`, `land-probe-stale` and `land-probe-unmeasured`, each with its `why`;
    - it PASSes with `proj-a: 3 heads, 1 conflicting with main, main green; store +0 objects, scratch 12 KiB this tick`.
  - `ccrc-doctorFixture.ts`: `HEALTHY_SKIPS` rises by one, with a `RAISED BY ONE` note naming `land-probe`.
  - `ccrc-settings-census.test.ts`: an `ENV_ONLY` row for `CCRC_LAND_PROBE_STALE_S` (class `call-bound`, as `CCRC_SCOPE_SWEEP_STALE_S` has it).

- [ ] **Step 2: Run them; see them fail**

- [ ] **Step 3: Write the units, the spine rows and the check**

  `ccd-land-probe.service`:
  - `Type=oneshot`
  - `ExecStart=%h/.local/bin/ccd-land-probe`
  - `TimeoutStartSec=900`
  - `MemoryMax=1G`
  - `Nice=10`
  - `IOSchedulingClass=idle`

  `ccd-land-probe.timer`:
  - `OnActiveSec=3min`
  - `OnUnitActiveSec=5min`
  - `AccuracySec=30s`
  - `WantedBy=timers.target`

  Each unit has a header comment, and the timer's cites D-1981.

  The bin goes beside `ccd-tmp-sweep`'s. The units and `_inst_enable_timer land-probe ccd-land-probe.timer` are gated `[ "$INST_ROLE" != server ]`. Uninstall's `enabled` sweep removes only regular files named `enabled`, one level under a real `$REG/landing/` directory.

  The doctor check follows `_check_scope-sweep`'s shape:
  - It SKIPs on darwin, on a `server` role (`_box_env_value`) and while paused.
  - It spells the registry as `reg="$HOME/.cc-sessions"` and then `$reg/…`.
  - It reads each conf's `probe` and `main-health`, and never runs git or gh.

- [ ] **Step 4: Run them and the repo-wide guards; see them pass**

- [ ] **Step 5: Mutations, each measured red, then restored**

  | # | Mutation | Expected red |
  |---|---|---|
  | I1 | the unit rows gated `= fleet` instead of `!= server` | install-role on `both` |
  | I2 | drop `ccd-land-probe` from `_uninst_wrappers`' exclusion `case` | install-census |
  | I3 | uninstall forgets the timer | ccrc-uninstall |
  | I4 | uninstall's `enabled` sweep follows a symlink | ccrc-uninstall |
  | I5 | the timer `OnBootSec=3min` | the per-timer case in timer-first-run |
  | I6 | doctor reads a stale `at` as fresh | the stale row |
  | I7 | doctor PASSes an unmeasured probe | the unmeasured row |

- [ ] **Step 6: Commit**

  ```bash
  git add deploy/systemd/ccd-land-probe.service deploy/systemd/ccd-land-probe.timer ccd/ccrc ccd/ccrc-doctor-checks deploy/deploy.sh deploy/gen-wrappers.mjs server/test agent/test/deploy-verify.test.ts
  git commit -m "feat(install): ccd-land-probe's units, install, uninstall and doctor check (landing order wave 3b, Task 3)"
  ```

### Task 4: README, the gate, the PR and the wave-done; then the deploy and the live proof

**Files:**
- Modify: `README.md`, and this plan's Deviations found.

- [ ] **Step 1: README**
  - The units table gains a `ccd-land-probe.timer` row: roles `fleet` and `both`; runs every 5 min; pause files `~/.cc-sessions/land-probe-paused` and `~/.cc-sessions/landing/<project>/paused`.
  - A new `### Conflict radar (ccd-land-probe)` section covers:
    - what the probe measures and where it writes;
    - the conf grammar;
    - the pauses;
    - the read-only layers and their pins;
    - that nothing reads the files yet but doctor and a person: wave 4 adds the lineage acceptance, and wave 4b the server reader and the chip.
  - Run the README citation and docs-parity suites.

- [ ] **Step 2: The gate**
  - Every file this wave added or touched runs whole, one process per file, in a fixed order, in the foreground, plus the repo-wide guards.
  - Then the full server suite once, and `agent` and `pwa` in full.
  - A known load flake is re-run in isolation and named.

- [ ] **Step 3: The PR and the wave-done**
  - Title: `feat(ccd): ccd-land-probe, the read-only conflict radar (landing order wave 3b)`.
  - The body states:
    - what the probe measures and writes;
    - the read-only layers and their reds;
    - that nothing arms it: it runs only for a project with a conf, which nobody in the tree writes;
    - the deploy class: AGENT-FIRST, through ccrc's updater.
  - Scan the body for private names before posting.
  - Send the wave-done the worker skill describes. It names every mutation's measured red count and every departure.

- [ ] **Step 4: The deploy and the live proof (the coordinator's, after the merge)**
  - ccrc's updater moves the fleet box first. Doctor's `services` and `land-probe` lines then read SKIP, because there is no conf.
  - **The live proof needs one operator act:** writing `~/.ccrc/landing/ccrc-pwa.conf` with `lineage=off`. After the next tick, the coordinator reads, read-only:
    - `probe` is `measured`, and every conflict it lists reproduces with `git merge-tree --write-tree --name-only --no-messages` in a scratch clone;
    - `main-health`'s `state` agrees with the required checks GitHub reports on `main`'s tip;
    - `enabled` is absent;
    - `store` shows the project's store unchanged by the tick;
    - doctor PASSes.
  - The proof never sets `lineage=on`: that is stage 4's to arm.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator, per wave, at that wave's run-open. **A worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail: what departed, why, and the evidence. The coordinator assigns its number from the wave's block when it records the ruling.

Run 310's block is 4326–4335. This plan defines 4326–4334; 4335 is spare.

- **D-4326** — `pause-markers-in-the-registry` (Design): the probe's two pause markers live under `$REG`, not at `~/.ccrc/<name>-paused` as most siblings' do. Stage 4 answers "probe paused for this project" from the server, which reads `$REG` through the agent but not `~/.ccrc`. The global marker counts as paused for every project. `ccd-scope-sweep`'s `$REG/scope-sweep-paused` is the precedent. Neither marker has a writer in the tree.
- **D-4327** — `conf-grammar-and-the-lineage-key` (Design): the spec names `~/.ccrc/landing/<project>.conf` and says "the lineage path runs only for a project whose landing conf opts in". This plan gives the conf two keys, `base` and `lineage`, and mirrors only `lineage=on` as `enabled`. So a project can run the radar without widening stage 4's acceptance. `enabled` carries its time, and stage 4 trusts it only while fresh and unpaused. An invalid conf, a paused project and uninstall remove it.
- **D-4328** — `main-health-is-section-5-7-3s-judge` (Design): the spec says "the REQUIRED contexts' check-runs". The probe judges each required name as §5.7.3 defines passing:
  - a completed run with a passing conclusion, from the App the rule names;
  - a commit status only for a name no App is named for;
  - a pinned name seen only as a status is unverifiable, never green.

  The required set is the union of the rules and the branch view.
- **D-4329** — `server-half-moves-to-wave-4b` (Architecture): spec §5.3 also names the server's reviving reader in `FleetWatcher`, the optional `FleetSession.landing` and `RunSummary.landing` wire fields, and the PWA's predicted-conflict chip. The ledger's row 3b scopes this wave to "ccd, deploy", so those three move out. They go to wave 4b, a plan of their own after wave 4's acceptance, because they share no code with acceptance, and one PR for both would mix a fingerprint change with a display change.
- **D-4330** — `the-pairwise-set` (Design): "pairwise across heads (at most 10)" does not say which ten. They are the heads a registry row of the project binds, newest PR first, with `pairsCut` when more exist. Unbound heads are still measured against the base.
- **D-4331** — `the-gh-knob` (Global Constraints): `CCD_LAND_PROBE_GH` names the gh the probe runs, default `gh`. It is the door for a functional stub in tests: the harness re-poisons `~/.local/bin/gh` on every `ghContainedEnv` call, and `GH_STUB` is a bash function that a Python child cannot see.
- **D-4332** — `count-objects-in-the-probe-file` (Design): spec §5.3's "`git count-objects` before and after a cycle is a doctor measurement" is recorded by the probe in `probe.store`, with the scratch's size, and doctor shows it. Doctor does not FAIL on growth, because fleet worktrees commit into the same store during a tick. The read-only proof is Task 1's not-written case, on a quiet fixture.
- **D-4333** — `lineage-for-registered-workspaces` (Design): spec §5.3 step 4 reads "each workspace branch's lineage (`refs/heads/ws/*` …)". The lineage set is the registry rows' `ws/*` branches, not every `refs/heads/ws/*`, because `<id>.lineage` is keyed by registry id and stage 4 answers per session. An unregistered `ws/*` ref has no claimant to answer.
- **D-4334** — `the-validate-only-self-test` (Design): `CCD_LAND_PROBE_SELFTEST=git_ro` runs `git_check` over stdin lines and prints each verdict. It runs no child, takes no lock and writes nothing. It is the only way to show `git_ro`'s refusals red, because the probe's real calls never attempt a refused one.
