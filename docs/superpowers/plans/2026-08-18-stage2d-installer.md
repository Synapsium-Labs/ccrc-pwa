# Stage 2d — `ccrc install`, the stage-2 `install.sh`, and the task-list debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh single Linux box goes from a git clone to a working ccrc install — `bash install.sh` → `ccrc install` converges every artifact, ends with `ccrc doctor`, and re-running converges instead of damaging — while the deferred task-list items that live in the same files (D-81, D-82, gh_auth hostname, adopt HERE, the path/services/config/disk doctor checks, the `/api/fleet/health` annotation, the `CCRC_PROJECTS_ROOT` reconciliation, the notify.sh address seam, the SessionStart/statusLine settings gaps) are paid down in the same slice.

**Architecture:** `cmd_install` joins `ccd/ccrc` as a spine of small `_inst_*` step functions (explicit `|| _ccrc_die` chains — ccrc never runs `-e`), each printing one `install: <step>: <result>` line to stdout. It is the roster→disk converger `ccrc adopt`'s header already promises: seed-once for USER-OWNED files (`accounts.json`, `ccrc.env`), regenerate for ccrc-OWNED files (`accounts.sh`, wrappers, executables, units), temp+chmod+rename for every executable (install_atomic's local shape), and `ccrc doctor` as the final gate whose exit code the verb passes through. `install.sh` at the repo root is bootstrap only: node-floor check (READ from the shipped package.json, never re-typed), `npm ci` + builds, then hand off to the verb. Single-box stage-2 shape: **local fleet mode, localhost, no TLS, no agent** — `ccrc-agent.service` is deliberately not installed (its `EnvironmentFile=` is required-no-dash; installing it without `agent.env` manufactures a failing unit, and local mode never touches the agent).

**Tech Stack:** bash (ccd/ccrc + install.sh + doctor checks), node `.mjs` (gen-wrappers), TypeScript (server config/route), vitest (server + agent suites).

## Global Constraints

Copied from the spec, CLAUDE.md, and the survey of the pinned suites. Every task's requirements implicitly include this section.

- **HARD OWNERSHIP FENCE: this plan makes ZERO edits to `ccd/ccd`.** A parallel session owns that file right now (sweep Tasks 16–17). Everything here lives in `ccd/ccrc*`, `ccd/install-session-hooks.sh`, `deploy/`, `shared/`, `server/src/`, `install.sh`, and tests. If a task appears to need a `ccd/ccd` edit, it is BLOCKED — report, do not edit.
- **In tests, FIXTURE HOMEs only — never run ccd or ccrc against the live `$HOME`.** `mkTmp` + the ccrc-doctor/ccrc-wrappers containment patterns (`ghContainedEnv`, poison bins, `CCRC_*` env deleted by name). Never `npx vitest`; run `./node_modules/.bin/vitest run <file>` from inside the package, foreground, timeout ≥600000ms.
- **Idempotent means measured:** byte no-op (install-session-hooks precedent), stable inode (install-coordinator-skill precedent), or stable mtime (ccrc-wrappers precedent). Every converger task ships a second-run assertion.
- **Mutation-table discipline:** every new guard ships WITH a test measured RED with the guard deleted/mutated. Near-miss fixtures + negative wording assertions per the doctor "third arm" example (ccrc-doctor.test.ts:847-873).
- **Seed-once vs regenerate:** `~/.ccrc/accounts.json` and `~/.ccrc/ccrc.env` are USER-OWNED — create if missing, NEVER overwrite, validate a seed BEFORE placing it (deploy.sh F1). `~/.ccrc/accounts.sh`, wrappers, executables, units are ccrc-OWNED — regenerate/converge every run.
- **Upstream/external accounts are NEVER written** (the stage-2c four-lock rule). Install reuses `cmd_wrappers`; it must not invent a second wrapper-writing path.
- **The stdout/stderr registers and exit table of `ccd/ccrc`:** results on stdout; `$PROG: ` refusals on stderr exit 1; usage errors exit 2; verdict+remedy adjacency for doctor-style lines. No `set -e` in ccrc, ever.
- **Pinned-suite awareness:** `server/test/single-definition.test.ts` scans the bash corpus (`ccd/` + `deploy/` + any new `install.sh` with a bash shebang joins automatically) — `.ccrc/build.json` may be spelled only in its pinned files; ccrc spells it ONCE (`BOX_STAMP_FILE=`) and holds exactly one `jq -r`. `agent/test/deploy-verify.test.ts` pins `deploy/deploy.sh` as text (function-body regexes truncate at a column-1 `}`; ordering assertions locate helper calls by `indexOf`, so comments must not spell helper names before the call). `server/test/ccrc-cli.test.ts:147` pins the usage verb list — adding `install` edits both by design. New `cmd_` functions in ccrc must not put `}` in column 1 mid-body (single-definition's `/cmd_x\(\) \{([\s\S]*?)\n\}/` probes).
- **`${BASH_SOURCE[0]}` + `%/*`, never `$0`/`dirname`,** for self-location in every bash file this plan touches (dirname is a PATH lookup; the doctor fixture PATH has no system dirs).
- **Node floor:** read `engines.node` from the shipped `server/package.json` wherever install.sh needs it — never carry a copy (node-floor.test.ts pins the three package.jsons identical; assertion 3 is absolute).
- **No new dependencies in any `package.json`.**
- TDD red-first throughout; commit at every green step; suites: `cd server && ./node_modules/.bin/vitest run <file>`; full server suite + agent suite + pwa suite before the branch is declared done.

## File structure

- `ccd/ccrc` — modify: usage(), dispatch case, new `cmd_install` + `_inst_*` step functions; the D-81 bash arm in `cmd_wrappers`' decision table.
- `ccd/ccrc-doctor-checks` — modify: `_check_gh_auth` hostname fix, `wr_absent` split, new `_check_path`/`_check_services`/`_check_config`/`_check_disk` + table entries.
- `ccd/ccrc-adopt` — modify: line 124 HERE resolution.
- `ccd/install-session-hooks.sh` — modify: SessionStart event, statusLine set-if-absent.
- `deploy/gen-wrappers.mjs` — modify: `oversize` classification (statSync gate).
- `deploy/notify.sh` — modify: `CCRC_ADDR` fallback chain (env > ccrc.env > legacy IP).
- `server/src/server.ts` — modify: typed `/api/fleet/health` handler.
- `server/src/config.ts` — modify: `CCRC_PROJECTS_ROOT` default → `$HOME/projects`.
- `install.sh` — create (repo root, bash shebang; joins the single-definition bash corpus).
- Tests: `server/test/ccrc-install.test.ts` (create); modify `ccrc-cli.test.ts`, `ccrc-doctor.test.ts`, `ccrc-wrappers.test.ts`, `gen-wrappers.test.ts`, `install-session-hooks.test.ts`, `fleet-health.test.ts` (or config test), plus a small `server/test/install-sh.test.ts` (create) for install.sh's refusal/floor logic.

---

### Task 1: Doctor seam fixes — `gh_auth --hostname`, the D-82 `wr_absent` split, adopt's HERE

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (gh invocation ~:406, case :424-435; `_dr_wr_present` :614-641; bucket assembly :1007-1023; the "one check, two classes" header :54-69)
- Modify: `ccd/ccrc-adopt:124`
- Test: `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Produces: a third dynamically-scoped bucket `wr_absent` in `_check_wrappers`; `_dr_wr_present <id> <bucket>` where `<bucket>` is a nameref (`local -n`) to `wr_absent` or `wr_hard`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: RED — multi-host gh fixture.** In `ccrc-doctor.test.ts`, next to `GH_OK` (:296-303), add a fixture whose `gh auth status` output has a `github.com` section WITHOUT `'repo'` followed by a `ghe.example.com` section WITH `'repo'` (`Token scopes: 'repo'`). Assert `FAIL gh_auth` with the existing no-repo-scope sentence. Run: it must FAIL (today the GHE section's `'repo'` produces a false PASS). Also extend `ghStub` so `gh auth status --hostname github.com` answers ONLY the github.com section (record argv; unknown argv still exit 90).
- [ ] **Step 2: GREEN — fix the check.** In `_check_gh_auth`, change the invocation to `gh auth status --hostname github.com` (keeping the `timeout "$CCRC_DOCTOR_GH_TIMEOUT"` bound and `2>&1`). The three-state case logic stays verbatim — the hostname flag bounds both the exit code and the greps to the one host the remedy already names (`gh auth refresh -h github.com -s repo`). Update existing single-host fixtures to answer the new argv. Run the gh_auth block green.
- [ ] **Step 3: RED — the D-82 absent-vs-disagreement fixtures.** Add two tests: (a) a roster-declared `generated` account with NO file at `$HOME/.local/bin/<id>` → doctor emits a FAIL `wrappers` line whose remedy matches `/run: ccrc wrappers/` and does NOT match `/ccrc adopt/`; (b) one run holding BOTH an absent finding and a disagreement finding (e.g. a second generated account with a wrong `configDirSuffix` wrapper) → TWO FAIL lines, the absent line's remedy naming `ccrc wrappers`, the disagreement line's remedy still the verbatim `:1011` roster sentence (the pin at :1073 stays true). Both must fail today (single bucket, single remedy).
- [ ] **Step 4: GREEN — split the bucket.** In `_check_wrappers`: declare `local wr_absent=()` beside `wr_hard`/`wr_soft` (:714). Change `_dr_wr_present` to take a second argument and append via nameref:

```bash
_dr_wr_present() {   # id bucketname — presence probe; absent-class findings go to the NAMED bucket
  local id="$1"
  local -n _wrp_bucket="$2"
  local p="$WRAPPER_BIN_DIR/$id"
  if [ -L "$p" ] && [ ! -e "$p" ]; then
    _wrp_bucket+=("$id's \$HOME/.local/bin/$id is a symlink to a path that does not exist")
    return 1
  fi
  if [ ! -e "$p" ]; then
    _wrp_bucket+=("$id has no executable at \$HOME/.local/bin/$id")
    return 1
  fi
  # present-but-wrong stays DISAGREEMENT class regardless of caller: a file
  # ccrc wrappers would refuse is not fixed by running ccrc wrappers.
  if [ ! -f "$p" ]; then
    wr_hard+=("$id's \$HOME/.local/bin/$id is not a regular file"); return 1
  fi
  if [ ! -x "$p" ]; then
    wr_hard+=("$id's \$HOME/.local/bin/$id is not executable"); return 1
  fi
  return 0
}
```

  Call sites: the `generated`-account path passes `wr_absent` (absent and dangling-symlink are exactly what `ccrc wrappers` writes — its decision table's `absent` arm writes, and `mv -f` over a dangling symlink replaces it); the direct `external|upstream` call at :939 passes `wr_hard` (ccrc wrappers never creates those — the roster remedy is correct for them). Verdict assembly gains a third block BEFORE the `wr_hard` block:

```bash
  if [ "${#wr_absent[@]}" -gt 0 ]; then
    _dr_fail wrappers \
      "$(_dr_join ${wr_absent[@]+"${wr_absent[@]}"})" \
      "run: ccrc wrappers — nothing exists on disk for it to refuse; it creates \$HOME/.local/bin and writes every generated account's wrapper"
    rc=1
  fi
```

  Extend the header's "ONE CHECK MAY ANSWER IN TWO CLASSES" wording to cover two FAIL lines (`cmd_doctor` counts verdict LINES and cross-checks only the worst class — two FAILs from one check is legal today, ccd/ccrc:845-905). Run the new tests green; run the whole wrappers describe block.
- [ ] **Step 5: Mutation measurement.** Re-merge the `wr_absent` block into `wr_hard` (revert the split in the working tree only): both Step-3 tests must go RED. Restore. Record the measurement in the test comments.
- [ ] **Step 6: adopt HERE.** In `ccd/ccrc-adopt`, replace line 124:

```bash
HERE="$(cd "${_ADOPT_SELF%/*}" && pwd)"
```

  (`_ADOPT_SELF` is already computed with the correct `BASH_SOURCE` + `*/*` guard idiom at :70-75.) Add one test in `ccrc-cli.test.ts`'s adopt block: invoke `ccrc-adopt` through a symlink placed in a fixture dir (`ln -s <checkout>/ccd/ccrc-adopt <home>/elsewhere/ccrc-adopt`) with `--out /tmp/...`-style args that reach self-validation — with `$0`-based HERE this resolved `GEN_ACCOUNTS` beside the symlink and refused; with the fix it resolves beside the real file. Mark the RED measurement (run the test before the fix).
- [ ] **Step 7: Full doctor suite + commit.** `./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/ccrc-cli.test.ts` green. Commit: `fix(doctor): gh_auth measures github.com alone; absent wrappers get the ccrc-wrappers remedy (D-82); adopt resolves HERE via BASH_SOURCE`

### Task 2: New doctor checks — `path`, `services`, `config`, `disk`

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (table :142-155 + four `_check_*` functions)
- Test: `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Produces: table entries `path services config disk` (append after `linger`, before `wrappers`); each check keeps the contract — `PASS|WARN|FAIL|SKIP <name>: <measurement>`, non-pass followed by exactly one `  remedy:` line, return 0/2/1/3, PASS details name what was measured.
- Consumes: `_dr_pass/_dr_warn/_dr_fail/_dr_skip`, `_box_env_value` (ccd/ccrc:381-405 — available because doctor runs inside ccrc; ccrc-doctor-checks may call it only when sourced from ccrc, so guard with `declare -F _box_env_value >/dev/null` and degrade to a self-contained key read if absent, following the wrapper-shape absence-tolerance pattern at :707-711).

Remember: adding a check = one table entry + one function + one test; ccrc-doctor.test.ts:499's bijection test reds the build if either half is forgotten, and :515 requires one verdict line per entry on the healthy fixture — so the `healthy()` fixture must be extended to make all four PASS (add `~/.local/bin` to fixture PATH; stub `df`; write fixture unit files + `writeCcrcEnv`; extend `stubSystemctl` with an `is-active`/`list-unit-files`-shaped read for the units the services check probes — keep the exit-90-on-unknown-argv discipline).

- [ ] **Step 1: RED — four table-driven tests first.** For each check add its red/green pair BEFORE the implementation (the bijection test itself reds on a table entry with no function — that is the first red). Fixtures:
  - `path`: fixture PATH without `<home>/.local/bin` → WARN naming the dir; with it → PASS naming its position.
  - `services`: no unit files under `<home>/.config/systemd/user/` → SKIP ("no ccrc units installed — a dev checkout or a box ccrc install never touched"); `ccrc.service` file present + `is-active` answers `inactive` → FAIL, remedy `systemctl --user enable --now ccrc.service`; active → PASS; `ccd-cap-scopes.timer` present-but-inactive → WARN.
  - `config`: no `~/.ccrc/ccrc.env` → WARN ("defaults apply: local mode on 127.0.0.1:7788"), remedy names `ccrc install`; `CCRC_FLEET=remote` with empty `CCRC_AGENT_URL` or `CCRC_AGENT_TOKEN` → FAIL (the server exits at boot in exactly this state, server/src/index.ts:75-79), remedy: set both or set `CCRC_FLEET=local`; coherent file → PASS naming the mode.
  - `disk`: stub `df` answering a `df -Pk` table; avail < 2 GiB → FAIL; < 10 GiB → WARN; else PASS naming GiB free; `df` missing from PATH → WARN "cannot measure".
- [ ] **Step 2: GREEN — implement the four checks.** Sketches (implementer refines against the file's idiom — pure parameter expansion, no external binaries except the measured subject):

```bash
_check_path() {
  local want="$HOME/.local/bin" p rest="$PATH:" i=0
  while [ -n "$rest" ]; do
    p="${rest%%:*}"; rest="${rest#*:}"; i=$((i+1))
    [ "$p" = "$want" ] && { _dr_pass path "\$HOME/.local/bin is in \$PATH (position $i)"; return 0; }
  done
  _dr_warn path "\$HOME/.local/bin is not in \$PATH — ccrc, ccd and every remedy this doctor prints resolve there" \
    "add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to ~/.profile (or ~/.bashrc), then log in again"
  return 2
}

_check_services() {
  local u="$HOME/.config/systemd/user" have=0 st rc=0
  [ -f "$u/ccrc.service" ] || [ -f "$u/ccd-cap-scopes.timer" ] || {
    _dr_skip services "no ccrc units installed — a dev checkout, or a box ccrc install never touched"; return 3; }
  if [ -f "$u/ccrc.service" ]; then
    st="$(systemctl --user is-active ccrc.service 2>/dev/null)"
    if [ "$st" = "active" ]; then
      _dr_pass services "ccrc.service is active"
    else
      _dr_fail services "ccrc.service is installed but ${st:-not active}" \
        "systemctl --user enable --now ccrc.service, then systemctl --user status ccrc.service"
      rc=1
    fi
  fi
  if [ -f "$u/ccd-cap-scopes.timer" ]; then
    st="$(systemctl --user is-active ccd-cap-scopes.timer 2>/dev/null)"
    [ "$st" = "active" ] || { _dr_warn services "ccd-cap-scopes.timer is installed but ${st:-not active} — spawned panes run uncapped" \
        "systemctl --user enable --now ccd-cap-scopes.timer"; [ "$rc" -eq 1 ] || rc=2; }
  fi
  return "$rc"
}
```

  `_check_config` reads `CCRC_FLEET`/`CCRC_AGENT_URL`/`CCRC_AGENT_TOKEN` out of `$HOME/.ccrc/ccrc.env` by name with the never-source discipline (reuse `_box_env_value` when `declare -F` finds it, else an inline copy of its whitespace-set parse — note WHY in a comment, citing the token hazard at ccd/ccrc:355-380). `_check_disk` parses `df -Pk "$HOME"` last-line field 4 (KiB avail) with `read -r` over `$( )`, floors at 2 GiB FAIL / 10 GiB WARN, PASS names GiB free and the filesystem.
  XDG note: `_check_services` relies on `systemctl --user`; reuse the XDG defaults idiom `_box_units` uses (ccd/ccrc:516-533).
- [ ] **Step 3: Mutation measurements.** For each check, delete its table entry (bijection test red), and break its fixture the specific way each red test asserts (e.g. services: flip fixture-unit-ccrc.service to `inactive` and confirm the exact FAIL sentence; disk: shrink the stubbed avail below each floor). Record measurements in test comments.
- [ ] **Step 4: Contract regression + commit.** Run the whole `ccrc-doctor.test.ts` (the output-contract block :2243+ sweeps the new checks automatically — line grammar, remedy adjacency, summary arithmetic). Commit: `feat(doctor): path, services, config and disk join the check table`

### Task 3: D-81 — the `oversize` sixth classification, node and bash together

**Files:**
- Modify: `deploy/gen-wrappers.mjs` (`classify()` :186-194; the manifest-grammar comment :40-52)
- Modify: `ccd/ccrc` (`cmd_wrappers` decision table :1002-1013 + action arms :1268-1335)
- Test: `server/test/gen-wrappers.test.ts`, `server/test/ccrc-wrappers.test.ts`

**Interfaces:**
- Produces: manifest rows may now carry `wrapper\t<id>\toversize\tno`; constant `OVERSIZE_BYTES = 1024 * 1024` defined once in gen-wrappers.mjs (a ccrc wrapper is ~300 bytes; the realistic trigger is the ~304 MB upstream binary misdeclared `generated`).
- Consumes: nothing from other tasks.

- [ ] **Step 1: RED — node side.** In `gen-wrappers.test.ts`: create a fixture bin dir whose `<id>` file is made large without disk cost (`fs.open` + `fs.ftruncate` to `OVERSIZE_BYTES + 1`, or `truncateSync` on an empty file — sparse); declare `<id>` as `generated` in the roster. Assert the manifest row is `wrapper\t<id>\toversize\tno`. Today this asserts against `ccrc-edited`/`unreadable` and fails.
- [ ] **Step 2: GREEN — statSync gate before any read:**

```js
const OVERSIZE_BYTES = 1024 * 1024; // a generated wrapper is ~300 bytes; anything
// past this is categorically not a wrapper, and past V8's string cap readFileSync
// THROWS — which used to misclassify a perfectly readable big file as unreadable (D-81).

function classify(path, staged) {
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    return { classify: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', equal: 'no' };
  }
  if (st.size > OVERSIZE_BYTES) return { classify: 'oversize', equal: 'no' };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { classify: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', equal: 'no' };
  }
  return { classify: verifyMarker(text), equal: text === staged ? 'yes' : 'no' };
}
```

  Keep the ENOENT-vs-other shape in BOTH catches (a file deleted between stat and read still answers `absent`). A dangling symlink stats ENOENT → `absent`, unchanged. Update the manifest-grammar comment to name six classifications.
- [ ] **Step 3: RED — bash side.** In `ccrc-wrappers.test.ts`: same sparse-file fixture through the real verb — assert `ccrc wrappers` REFUSES the id under every flag (`--force` included) with a remedy that names the size and never suggests `--force`, and exit 1. Today bash's decision-table catch-all refuses the unknown `oversize` token with its generic manifest-distrust message — the test pins the SPECIFIC arm's sentence, so it is red until the arm exists. (This is the ship-together proof inverted: node emitting a token bash refuses is exactly what the catch-all is for.)
- [ ] **Step 4: GREEN — the bash arm.** Add `oversize` to `cmd_wrappers`' decision table beside `unreadable`: REFUSE under every flag, remedy naming both escape hatches:

```bash
    oversize)
      echo "REFUSED $id: \$HOME/.local/bin/$id is over 1 MiB — categorically not a ccrc wrapper"
      echo "  remedy: if $id should be generated, move the big file aside and re-run; if that file is the upstream binary, set its roster entry to exec.kind \"upstream\""
      refused=1 ;;
```

  (Match the existing arms' exact output register and `refused` bookkeeping; the implementer mirrors the `unreadable` arm's mechanics.) Also check `_wrap_parse_shape`'s read path in `ccd/ccrc-wrapper-shape`: if it reads a candidate file unbounded, give the doctor's shape loop the same cheap size gate (skip + count as disagreement) — verify with a sparse-file doctor fixture; if its line-reads are already bounded, record that in the task report instead.
- [ ] **Step 5: Mutation measurements.** (a) Delete the node statSync gate → Step-1 red. (b) Delete the bash arm → Step-3 red (falls to catch-all wording). Record both.
- [ ] **Step 6: Commit.** `feat(wrappers): oversize is the sixth classification — statSync gates the read, bash refuses by name (D-81)`

### Task 4: Small seams — typed fleet-health, projects-root default, notify.sh address chain

**Files:**
- Modify: `server/src/server.ts:201-228` (+ the `shared/api.js` import block :46-53)
- Modify: `server/src/config.ts:151`
- Modify: `deploy/notify.sh` (the `CCRC_ADDR` fallback :35-40)
- Test: `server/test/fleet-health.test.ts`, the config suite, `agent/test/` or `server/test/` for notify.sh (wherever token-extraction tests for notify.sh live today — locate with `git grep -l notify.sh -- '*test*'`; if none exists, add `server/test/notify-addr.test.ts`)

**Interfaces:** none produced/consumed across tasks.

- [ ] **Step 1: fleet-health annotation.** Add `type FleetHealth` to the existing `shared/api.js` import in server.ts; annotate the handler `async (): Promise<FleetHealth> =>`. Both returns already conform. Proof is the compile: `./node_modules/.bin/tsc --noEmit` in server/. Then the RED measurement the honest way: temporarily change `roster: 'unknown'` to `roster: 'unknowable'` and confirm tsc now REFUSES (it compiled green before the annotation — that is the defect); revert.
- [ ] **Step 2: RED — projects-root default.** Find the config test pinning the default (`git grep -n '/data/projects' server/test server/src`); write/adjust a test asserting `loadConfig({})` yields `projectsRoot === path.join(home, 'projects')`. Red today.
- [ ] **Step 3: GREEN.** `server/src/config.ts:151`: default `/data/projects` → `path.join(home, 'projects')` — this is spec §2's three-way reconciliation (agent and ccd already default to `$HOME/projects`); the reference fleet sets `CCRC_PROJECTS_ROOT` explicitly in both env files, so no deployed behavior changes. Update any test that pinned the old default, citing spec §2 in the test comment. Run config + fleet suites.
- [ ] **Step 4: RED — notify.sh chain.** Test: with `CCRC_ADDR` unset and a fixture `~/.ccrc/ccrc.env` carrying `CCRC_HOST=127.0.0.1` / `CCRC_PORT=7788`, notify.sh must POST to `127.0.0.1:7788` (assert via a recorded curl stub on a fixture PATH); with neither env nor file, the legacy IP; with `CCRC_ADDR` set, it wins. Red today (baked IP ignores the file).
- [ ] **Step 5: GREEN — the chain in notify.sh.** Above the curl, derive the address without ever sourcing the env file (it carries tokens — same discipline as `_box_env_value`, ccd/ccrc:355-380):

```bash
# Address resolution: CCRC_ADDR env > ~/.ccrc/ccrc.env's CCRC_HOST+CCRC_PORT >
# the reference fleet's legacy IP (kept one generation so a hook shipped ahead
# of the config file cannot go dark — same tolerance as the token above).
# The env file is grepped, never sourced: it holds tokens (ccd/ccrc:355-380).
ADDR="${CCRC_ADDR:-}"
if [ -z "$ADDR" ] && [ -r "$HOME/.ccrc/ccrc.env" ]; then
  _h="$(grep -E '^[[:space:]]*CCRC_HOST=' "$HOME/.ccrc/ccrc.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  _p="$(grep -E '^[[:space:]]*CCRC_PORT=' "$HOME/.ccrc/ccrc.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$_h" ] && [ -n "$_p" ] && ADDR="$_h:$_p"
fi
ADDR="${ADDR:-203.0.113.7:7788}"
```

  and the curl line targets `http://${ADDR}/api/notify`. (last-assignment-wins via `tail -n1` matches `_box_env_value`'s rule.)
- [ ] **Step 6: Commit.** `fix(seams): fleet-health is typed at the producer; projects-root defaults agree three ways; notify.sh reads its address from the box config`

### Task 5: settings.json convergers — SessionStart registers, statusLine lands set-if-absent

**Files:**
- Modify: `ccd/install-session-hooks.sh` (`EVENTS_JSON` :19-20, `JQ_PROGRAM`)
- Test: `server/test/install-session-hooks.test.ts`

**Interfaces:**
- Produces: settings.json gains a managed SessionStart hook entry and (only when absent) a `statusLine` key `{type:"command", command:"bash \"$HOME/.claude/statusline-command.sh\""}`.
- Consumes: nothing.

- [ ] **Step 1: RED — SessionStart.** Test: run the installer against a fixture home; assert `.hooks.SessionStart` holds the managed entry. Red today — `EVENTS_JSON` omits SessionStart even though `session-hook.sh:62-73` handles it (the F1 fix: a just-started session writes state=done so its first coordination brief can deliver; on a fresh install that handler is dead code without registration).
- [ ] **Step 2: GREEN.** Add `"SessionStart"` to `EVENTS_JSON`. Re-run the existing convergence tests (managed-sweep semantics make this additive on live boxes: the next installer run inserts it).
- [ ] **Step 3: RED — statusLine.** Tests: (a) fixture home with no `statusLine` in settings.json → after run, `.statusLine == {type:"command", command:"bash \"$HOME/.claude/statusline-command.sh\""}` ($HOME single-quoted-unexpanded exactly like `HOOK_CMD`); (b) fixture home whose settings.json already carries a DIFFERENT statusLine command → byte-identical after the run (set-if-absent: an operator's customized statusline is user-owned; converge-not-damage); (c) second run remains a byte no-op.
- [ ] **Step 4: GREEN.** Extend `JQ_PROGRAM` (or a second jq pass in the same write cycle — one write either way, preserving the byte-level converge check) with: `if has("statusLine") then . else .statusLine = {type:"command", command:$sl} end`, passing `--arg sl 'bash "$HOME/.claude/statusline-command.sh"'`. Update the file's header comment: it now converges hooks AND seeds the statusline pointer — and WHY the statusline is load-bearing, not cosmetic (it writes `~/.cc-limits` telemetry consumed by auto-swap and server placement; nothing else in the repo has ever written this key — settings entries on the reference fleet are hand-made history).
- [ ] **Step 5: Mutation + commit.** Delete the `has("statusLine")` guard → test (b) red (customized statusline clobbered). Restore, record, run the full file suite. Commit: `feat(hooks): SessionStart registers; the statusline pointer is seeded, never overwritten`

### Task 6: `ccrc install` — verb skeleton and the seeding steps

**Files:**
- Modify: `ccd/ccrc` (usage :121-147, dispatch :1496-1528, new `cmd_install` + `_inst_banner`, `_inst_roster`, `_inst_accounts_sh`, `_inst_env`)
- Test: `server/test/ccrc-cli.test.ts` (:147 usage regex), create `server/test/ccrc-install.test.ts`

**Interfaces:**
- Produces: `cmd_install` spine — every later task adds `_inst_*` functions and one call line in `cmd_install`'s fixed sequence; step output register `install: <step>: <result>` on stdout; failures via `_ccrc_die` (stderr, exit 1). `_inst_*` functions return 0 or die; `cmd_install` takes no flags except `-h|--help` (usage exit 0, flag-ful-verb rule ccd/ccrc:183-192).
- Consumes: Task 5's installer semantics (unchanged interface).

Test harness for `ccrc-install.test.ts` (used by Tasks 6-9): the deployed-box fixture from `ccrc-doctor.test.ts` (`installCcrc`-style tree at `<home>/ccrc/ccd/` — but for install, prefer a COPIED tree over symlinks where the test exercises tree-relative writes) + `ghContainedEnv` + hand-planted recording stubs for `systemctl`, `loginctl`, `rsync`(pass-through to real rsync if present, else skip-marked), `node` (real), poison `curl`. Delete `CCRC_*` env by name in the runner (add any new vars this verb reads to the delete list — ccrc-cli.test.ts:93's rule). Run via `spawnSync('bash', [CCRC_IN_FIXTURE, 'install'], {env})`.

- [ ] **Step 1: RED — usage + dispatch.** Update `ccrc-cli.test.ts:147`'s regex to `\{doctor\|status\|adopt\|wrappers\|install\|version\}` — red (usage doesn't know install). Add dispatch tests: `ccrc install -h` → usage on stdout exit 0; `ccrc install --bogus` → exit 2.
- [ ] **Step 2: GREEN — skeleton.** usage() gains:

```
  install   converge this box from the shipped tree: seed ~/.ccrc config
            (never overwriting yours), install executables, units and hooks,
            generate wrappers, then run doctor. Single-box, localhost.
            Re-running converges; it never damages an existing install
```

  Dispatch case gains `install)  cmd_install "$@" ;;`. `cmd_install` v1: flag loop (`-h|--help` → usage exit 0; anything else `_ccrc_usage_die`), then the three seeding steps below in order. No `}` in column 1 inside any new function body.
- [ ] **Step 3: RED — seeding semantics.** In `ccrc-install.test.ts`:
  - fresh HOME → after `ccrc install` (with later steps not yet existing, the verb runs what exists): `~/.ccrc/accounts.json` exists and equals `deploy/accounts.default.json` byte-for-byte; `~/.ccrc/accounts.sh` exists, carries the `# ccrc:generated 1 sha256=` marker, and `bash -n` parses it; `~/.ccrc/ccrc.env` exists with `CCRC_FLEET=local`, `CCRC_HOST=127.0.0.1`, `CCRC_PORT=7788`, `CCRC_PROJECTS_ROOT=<home>/projects`.
  - pre-existing `accounts.json` (the migration roster) → byte-identical after the run, and `accounts.sh` is generated FROM IT (contains `claude-corp`), not from the default seed.
  - pre-existing `ccrc.env` with custom content → byte-identical after the run.
  - an INVALID pre-existing `accounts.json` → the run dies (exit 1) with the generator's remedy passed through, and writes NOTHING (validate-before-generate; a broken roster must fail before any mutation — deploy F1's local translation).
  - second run on a converged home → `accounts.json`/`ccrc.env` byte-identical, `accounts.sh` mtime unchanged when content converged (compare regenerated bytes before writing).
- [ ] **Step 4: GREEN — the three steps.**

```bash
_inst_roster() {   # seed-once: validate the SEED before placing it (deploy F1);
  # an existing roster is USER-OWNED and is never overwritten.
  local seed="$CCRC_HERE/../deploy/accounts.default.json" dest="$HOME/.ccrc/accounts.json"
  mkdir -p "$HOME/.ccrc" || _ccrc_die "cannot create \$HOME/.ccrc"
  if [ -e "$dest" ]; then
    echo "install: roster: kept (user-owned, never overwritten)"
    return 0
  fi
  [ -f "$seed" ] || _ccrc_die "no roster seed at $seed — run install from inside the shipped tree"
  node "$CCRC_HERE/../deploy/gen-accounts.mjs" "$seed" >/dev/null \
    || _ccrc_die "the shipped roster seed does not validate — refusing to seed a box with it"
  local tmp="$dest.tmp.$$"
  cp "$seed" "$tmp" && mv -f "$tmp" "$dest" || { rm -f "$tmp"; _ccrc_die "seeding $dest failed"; }
  echo "install: roster: seeded single-account default"
}

_inst_accounts_sh() {   # ccrc-OWNED: regenerated every run FROM THE INSTALLED roster
  # (the local translation of deploy's read-back-over-ssh rule), atomically,
  # write-skipped when converged so idempotence is measurable on mtime.
  local dest="$HOME/.ccrc/accounts.sh" out tmp
  out="$(node "$CCRC_HERE/../deploy/gen-accounts.mjs" "$HOME/.ccrc/accounts.json")" \
    || _ccrc_die "\$HOME/.ccrc/accounts.json does not validate — fix it (or move it aside to reseed) and re-run"
  if [ -f "$dest" ] && [ "$out" = "$(cat "$dest")" ]; then
    echo "install: accounts.sh: converged"
    return 0
  fi
  tmp="$dest.tmp.$$"
  printf '%s\n' "$out" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$dest" \
    || { rm -f "$tmp"; _ccrc_die "installing $dest failed"; }
  echo "install: accounts.sh: generated from \$HOME/.ccrc/accounts.json"
}

_inst_env() {   # seed-once, exactly like the roster: the env file is the box's
  # ONE machine-config file, holds operator secrets once configured, and is
  # never sourced and never overwritten by tooling.
  local dest="$HOME/.ccrc/ccrc.env"
  if [ -e "$dest" ]; then
    echo "install: ccrc.env: kept (user-owned, never overwritten)"
    return 0
  fi
  local tmp="$dest.tmp.$$"
  {
    printf '%s\n' "# ccrc box config — written once by ccrc install; edit freely, ccrc never rewrites it."
    printf '%s\n' "# Keys and defaults: deploy/ccrc.env.example in the shipped tree."
    printf '%s\n' "CCRC_HOST=127.0.0.1"
    printf '%s\n' "CCRC_PORT=7788"
    printf '%s\n' "CCRC_FLEET=local"
    printf '%s\n' "CCRC_PROJECTS_ROOT=$HOME/projects"
  } > "$tmp" && mv -f "$tmp" "$dest" || { rm -f "$tmp"; _ccrc_die "writing $dest failed"; }
  echo "install: ccrc.env: written (localhost, local fleet mode)"
}
```

  Order inside `cmd_install`: `_inst_roster` → `_inst_accounts_sh` → `_inst_env`. Roster validation failing must abort before anything else runs (the die inside `_inst_accounts_sh` covers the pre-existing-invalid case because `_inst_roster` keeps it and the generator then refuses).
- [ ] **Step 5: Mutation measurements.** (a) Make `_inst_roster` overwrite unconditionally → pre-existing-roster test red. (b) Drop the seed validation call → invalid-seed test needs its own arm: corrupt the SHIPPED seed copy in the fixture tree and assert the die fires before `accounts.json` exists. Record both.
- [ ] **Step 6: Commit.** `feat(ccrc): install exists — seed-once roster and env, regenerated accounts.sh`

### Task 7: `ccrc install` — tree, executables, files, stamp

**Files:**
- Modify: `ccd/ccrc` (`_inst_tree`, `_inst_bins`, `_inst_files`, `_inst_stamp`; wired into `cmd_install` after `_inst_env`)
- Test: `server/test/ccrc-install.test.ts`; possibly extend `server/test/single-definition.test.ts` deliberately (see Step 4)

**Interfaces:**
- Produces: `_inst_atomic <src> <dest> <mode>` — the local install_atomic (cp to `<dest>.tmp.$$` sibling, chmod, `mv -f`, stray sweep `rm -f <dest>.tmp.*` after) used by every executable/file step here and in Task 8.
- Consumes: Task 6's spine.

- [x] **Step 1: RED — tree + dist preflight.** Tests: running `ccrc install` from a fixture CHECKOUT tree (not `<home>/ccrc`) whose `server/dist/server/src/index.js` or `server/dist-pwa/index.html` is missing → dies naming the missing artifact with remedy "build first: bash install.sh (or npm run build in server/ and pwa/)". With both present → `<home>/ccrc/{server,agent,shared,deploy,ccd}` exists afterward, node_modules and `.git` and `*.env` and `ccrc-mail.token` excluded, dist and dist-pwa INCLUDED. Running from `<home>/ccrc/ccd` itself → no rsync invoked (self-copy guard; assert via the recording rsync stub) and no error.
- [x] **Step 2: GREEN — `_inst_tree`.**

```bash
_inst_tree() {   # place the shipped tree at ~/ccrc — the layout every sibling
  # contract assumes (shim target, _dr_pkg_candidates, BASH_SOURCE siblings).
  # Runs BEFORE executables so the shim's target exists when the shim lands.
  local src dest="$HOME/ccrc"
  src="$(cd "$CCRC_HERE/.." && pwd)" || _ccrc_die "cannot resolve the running tree"
  [ -f "$src/server/dist/server/src/index.js" ] \
    || _ccrc_die "no server build at $src/server/dist — build first: bash install.sh (or npm run build in server/ and pwa/)"
  [ -f "$src/server/dist-pwa/index.html" ] \
    || _ccrc_die "no PWA bundle at $src/server/dist-pwa — build first: bash install.sh (or npm run build in pwa/)"
  if [ "$src" = "$dest" ]; then
    echo "install: tree: already running from \$HOME/ccrc"
  else
    command -v rsync >/dev/null 2>&1 || _ccrc_die "rsync is required to place the tree — sudo apt install rsync"
    mkdir -p "$dest" || _ccrc_die "cannot create $dest"
    rsync -a --delete \
      --exclude node_modules --exclude .git --exclude '*.env' --exclude ccrc-mail.token \
      "$src/server" "$src/agent" "$src/shared" "$src/deploy" "$src/ccd" "$dest/" \
      || _ccrc_die "placing the tree at $dest failed"
    echo "install: tree: placed at \$HOME/ccrc"
  fi
  ( cd "$dest/server" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
    || _ccrc_die "npm ci in \$HOME/ccrc/server failed — the service cannot start without runtime deps"
  echo "install: tree: server runtime deps in place"
}
```

  Divergence from deploy recorded here as a comment: deploy builds ON the box because it ships sources across boxes; install IS the box, so it ships the checkout's build and installs runtime deps only.
- [x] **Step 3: RED — executables + files.** Tests: after install, `<home>/.local/bin/ccd` is an executable byte-copy of the tree's `ccd/ccd`; `<home>/.local/bin/ccrc` is the two-line shim whose bytes EQUAL what deploy.sh's `install_ccrc_shim` heredoc generates (extract deploy.sh's heredoc in the test the way deploy-verify.test.ts:1470-1496 does, run both generators, compare output bytes — the agreement pin that lets the shim exist twice without drifting); `<home>/.local/bin/ccd-cap-scopes`, `.cc-sessions/{session-hook.sh,install-session-hooks.sh,notify.sh}`, `~/.tmux.conf` (644), `~/.claude/statusline-command.sh` (755) all present with correct modes; second run leaves every converged file's mtime unchanged (compare bytes before writing, like `_inst_accounts_sh`).
- [x] **Step 4: GREEN — `_inst_atomic`, `_inst_bins`, `_inst_files`, `_inst_stamp`.** `_inst_atomic` compares bytes first (converged → no write), else temp-sibling + chmod + `mv -f` + stray sweep. `_inst_bins` installs `ccd/ccd`→`.local/bin/ccd` 755, `ccd/ccd-cap-scopes`→`.local/bin/ccd-cap-scopes` 755, and generates the shim into `.local/bin/ccrc` 755 (its own `mkdir -p ~/.local/bin`); the shim body is the same two-line semantics as deploy's — refuse by name when `$HOME/ccrc/ccd/ccrc` is missing, else `exec` it — using `if`, never a column-1 `}`. `_inst_files` installs `session-hook.sh`, `install-session-hooks.sh` (755, into `.cc-sessions/`), `deploy/notify.sh`→`.cc-sessions/notify.sh` 755, `ccd/tmux.conf`→`.tmux.conf` 644, `ccd/statusline-command.sh`→`.claude/statusline-command.sh` 755 (mkdir -p `~/.claude` first). `_inst_stamp`: if `git -C "$CCRC_HERE/.." rev-parse HEAD` succeeds, write `{"sha","ref","builtAt","dirty"}` to `"$BOX_STAMP_FILE"` via temp+mv (dirty measured with `git diff --quiet` pair, ref via `--abbrev-ref`); else print `install: stamp: skipped (not a git checkout — ccrc version will say unstamped)`. **Write the stamp path ONLY as `"$BOX_STAMP_FILE"`** — never the literal. Then run `./node_modules/.bin/vitest run test/single-definition.test.ts`: if the only-writer/reader assertions red, extend them DELIBERATELY with the named-exclusion idiom (the writer list grows ccrc's variable-mediated write; cite this task in the exclusion comment). If they stay green, record that in the task report.
- [x] **Step 5: Order + wiring.** `cmd_install` sequence so far: roster → accounts_sh → env → tree → bins → files → stamp. accounts.sh landing BEFORE the ccd copy preserves deploy's "roster before ccd" doctrine (every ccd invocation dies without it).
- [x] **Step 6: Commit.** `feat(ccrc): install places the tree, the executables and the stamp — converge, never damage`

### Task 8: `ccrc install` — units, enablement, linger, hooks, wrappers, doctor-at-end

**Files:**
- Modify: `ccd/ccrc` (`_inst_units`, `_inst_enable`, `_inst_linger`, `_inst_dirs`, `_inst_hooks`, `_inst_wrappers`, doctor tail of `cmd_install`)
- Test: `server/test/ccrc-install.test.ts`

**Interfaces:**
- Consumes: Tasks 6-7 spine; Task 5's installer; `cmd_wrappers` (same file — called as a function).
- Produces: the complete `cmd_install`.

- [ ] **Step 1: RED — units.** Tests (recording systemctl stub — extend the ccrc-doctor `stubSystemctl` shape with recording arms for `daemon-reload`, `enable --now <unit>`, keeping exit-90-on-unknown-argv): after install, `~/.config/systemd/user/` holds `ccrc.service`, `claude-session@.service`, `ccd-cap-scopes.service`, `ccd-cap-scopes.timer`, drop-in dirs `claude-session@.service.d/limits.conf`, `app-claude\x2dsession.slice.d/limits.conf` (the `\x2d` escape in the DESTINATION dir name — without it systemd never reads the drop-in), and NOT `ccrc-agent.service` (single-box local mode: its EnvironmentFile is required-no-dash; installing it without agent.env manufactures a failing unit). systemctl calls recorded: `daemon-reload` once, `enable --now ccrc.service`, `enable --now ccd-cap-scopes.timer` — in that order, all AFTER every unit file landed.
- [ ] **Step 2: GREEN — `_inst_units` + `_inst_enable`.** `_inst_units` copies via `_inst_atomic` (644) from the tree: `deploy/ccrc.service`, `ccd/claude-session@.service`, `deploy/systemd/ccd-cap-scopes.{service,timer}`, `deploy/systemd/claude-session@.service.d/limits.conf`, and `deploy/systemd/app-claude-session.slice.d/limits.conf` into `app-claude\x2dsession.slice.d/` (mkdir the escaped name). `_inst_enable` exports the XDG default the way `_box_units` does, then `systemctl --user daemon-reload`, `enable --now ccrc.service`, `enable --now ccd-cap-scopes.timer`, each `|| _ccrc_die` with a remedy naming `systemctl --user status <unit>`; then, when `deploy/verify-service.sh` exists in the tree, `bash "$CCRC_HERE/../deploy/verify-service.sh" ccrc.service` (honoring `CCRC_VERIFY_*` knobs so tests set them to 0) — its failure is a die (a service that won't stay up is a failed install).
- [ ] **Step 3: RED+GREEN — linger, dirs, hooks, wrappers.** `_inst_linger`: `loginctl enable-linger "$UID"` via a recording loginctl stub; on failure print `install: linger: could not enable — run: sudo loginctl enable-linger $UID` and CONTINUE (doctor reports it; an install that half-works without sudo is better than one that aborts at the end). `_inst_dirs`: source `"$HOME/.ccrc/accounts.sh"` in a SUBSHELL and `mkdir -p` each account's `_ccrc_cfg_dir` (closes the hooks installer's skip-absent-dirs gap on a fresh box). `_inst_hooks`: `bash "$HOME/.cc-sessions/install-session-hooks.sh"` — run from the INSTALLED path, exactly like deploy. `_inst_wrappers`: call `cmd_wrappers` directly (same file, no flags — the converger's own refusal output and exit 1 propagate; a refused wrapper is a failed install step: `cmd_wrappers || _ccrc_die "wrapper convergence refused — read the lines above"`). Tests: each records its calls; the default single-`claude` roster produces ZERO generated wrappers (upstream only — assert `cmd_wrappers` ran and wrote nothing into `.local/bin` beyond ccd/ccrc/cap-scopes).
- [ ] **Step 4: RED+GREEN — the tail.** After all steps, `cmd_install` prints the landing block and runs doctor:

```bash
  echo "install: done — every step above converged"
  echo "install: PWA: http://127.0.0.1:7788/ (CCRC_HOST/CCRC_PORT in ~/.ccrc/ccrc.env change this)"
  echo "install: next: add your first session with: ccd menu   (and read ~/.ccrc/ccrc.env)"
  cmd_doctor
```

  `cmd_install`'s exit code is doctor's exit code (the spec's "ends with ccrc doctor": a box whose doctor fails is not a finished install, exit 1 per the house table; the install STEPS' own failures already died earlier). The URL line reads the host/port back from `~/.ccrc/ccrc.env` via `_box_env_value` when available rather than hardcoding — one source of truth; fall back to the literal default only when the file lacks the keys. Tests: full-run fixture where every doctor stub is healthy → exit 0 and `summary:` present; one broken doctor fixture (e.g. linger no) → exit 1 while every `install: <step>:` line still printed.
- [ ] **Step 5: Idempotence, whole-verb.** Test: run the COMPLETE `ccrc install` twice on one fixture; second run: `accounts.json`/`ccrc.env` bytes identical, `accounts.sh` + every `_inst_atomic` target mtime-stable, settings.json byte-identical, systemctl recording shows the same idempotent-safe calls (enable --now twice is fine), zero `.tmp.` strays anywhere under the fixture HOME.
- [ ] **Step 6: Commit.** `feat(ccrc): install converges units, hooks, wrappers and linger, then hands the verdict to doctor`

### Task 9: `install.sh` bootstrap + the end-to-end proof + README pointer

**Files:**
- Create: `install.sh` (repo root)
- Create: `server/test/install-sh.test.ts`
- Modify: `README.md` (one short "Install (single box)" section pointing at install.sh; the full guide is Stage 5)
- Test: end-to-end additions in `server/test/ccrc-install.test.ts`

**Interfaces:**
- Consumes: `ccd/ccrc install` (Task 8 complete).

- [ ] **Step 1: RED — floor + refusal tests.** `install-sh.test.ts`: run `bash install.sh` with a stub `node` reporting a version below the floor read from `server/package.json` `engines.node` → refuses, names both versions, exit 1, runs NO npm (recording npm stub); with node absent → refuses with the install remedy; with `--help` → usage, exit 0.
- [ ] **Step 2: GREEN — install.sh.**

```bash
#!/usr/bin/env bash
# install.sh — stage-2 bootstrap: build from this checkout, then hand off to
# `ccrc install` (ccd/ccrc), which owns every converge decision. This script
# never touches ~/.ccrc, ~/.local/bin or systemd — bootstrap builds, the verb
# installs. Re-running is safe: npm ci and the builds are idempotent and the
# verb converges.
set -euo pipefail
HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)"
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "install.sh: node is not installed — install Node (nodesource or nvm), then re-run" >&2; exit 1; }
# The floor is READ from the shipped package.json — never a second copy
# (node-floor.test.ts pins the three package.jsons identical; the server does
# not degrade below it, it fails to boot on node:sqlite).
floor="$(node -e 'process.stdout.write(require(process.argv[1]).engines.node)' "$ROOT/server/package.json" 2>/dev/null)" \
  || { echo "install.sh: cannot read engines.node from $ROOT/server/package.json — is this a complete checkout?" >&2; exit 1; }
node -e '
const floor = process.argv[1].replace(/^>=/,"").trim();
const cur = process.versions.node;
const at = s => s.split(".").map(Number);
const [a,b,c] = at(cur), [x,y,z] = at(floor);
const ok = a>x || (a===x && (b>y || (b===y && c>=z)));
if (!ok) { console.error(`install.sh: node ${cur} is below the required ${floor}`); process.exit(1); }
' "$floor" || exit 1

echo "install.sh: building (server deps, PWA bundle, server dist)…"
( cd "$ROOT/server" && npm ci --no-audit --no-fund )
( cd "$ROOT/pwa" && npm ci --no-audit --no-fund && npm run build )
( cd "$ROOT/server" && npm run build )

exec bash "$ROOT/ccd/ccrc" install
```

  (npm invocations are the recording stub's seam in tests; the exec'd final line is asserted by argv recording on a stub bash? No — simpler: the tests for the full path stub `npm` to succeed instantly and replace `ccd/ccrc` in a COPIED fixture tree with a recorder. install.sh must locate ccrc relative to ITSELF so the fixture copy controls it.)
- [ ] **Step 3: single-definition sweep.** `install.sh` has a bash shebang → it joined the scanned corpus. Run `./node_modules/.bin/vitest run test/single-definition.test.ts`; it must be green (install.sh spells no pinned strings — the floor is read, not typed; the stamp path never appears).
- [ ] **Step 4: End-to-end convergence proof (CI-runnable).** In `ccrc-install.test.ts`: the fresh-box→converged→re-run scenario of Task 8 Step 5, but entered through `bash install.sh` with stubbed npm — proving the bootstrap→verb handoff. Plus the README section (5-8 lines: clone, `bash install.sh`, what doctor green means, where the PWA answers) — and RETIRE the now-false README:607 bullet saying "`ccrc install` does not exist yet" (grep the whole README for other sentences the new verb makes false). The real-VM proof (spec: "Fresh VM → install.sh → doctor green → real session runs (RC off) → PWA on localhost, under 15 minutes") is the OPERATOR's stage gate and requires Stage 2e's RC-off work — record it as pending in the ledger, do not claim it.
- [ ] **Step 5: Full suites + commit.** All three suites foreground green (`server`, `agent`, `pwa`). Commit: `feat(install): install.sh bootstraps a single box from a clone and hands off to ccrc install`

---

## Deviations found

(D-N numbering continues the project-global sequence; next free number at plan time: **D-84**. Add entries as execution finds them.)

- **D-84** — Task 1's brief predicted the adopt-HERE fix could be pinned by invoking `ccrc-adopt` through a symlink: measured impossible. For a directly-invoked script, `$0` and `${BASH_SOURCE[0]}` are byte-identical through a symlink in all three invocation shapes (direct exec, `bash <path>`, PATH lookup) — verified independently by implementer and reviewer. The shipped test pins the property the fix's own comment names instead: `dirname` is a PATH lookup, measured with a lying-`dirname` planted on the fixture PATH. The `$0`-vs-`BASH_SOURCE` half of the idiom remains guarded only under `source` (ccrc-cli's source-guard pattern), which is the one shape where they genuinely differ.

- **D-85** — Task 2's brief specified `_check_config` should read `~/.ccrc/ccrc.env` "with `_box_env_value` when `declare -F` finds it, else an inline copy of its whitespace-set parse". The inline copy is refused, and the path is not re-spelled either: `ccrc:91-101` declares `BOX_ENV_FILE` once and its own comment names **doctor** as one of the three readers that must not re-spell it, while `_box_env_value`'s subset-of-systemd parse (`ccrc:355-380`) is load-bearing in one direction — a second copy is exactly the drift this file's header objects to for the wrapper shape. The check instead guards on both (`[ -z "${BOX_ENV_FILE:-}" ] || ! declare -F _box_env_value`) and reports the absence as a bug in ccrc in a verdict line, which is the shape `_check_fleet` already uses for the same condition; pinned by "says so, rather than guessing, when ccrc's own config reader is not loaded". Same task, two smaller corrections to brief-supplied text, both measured rather than assumed: the `disk` FAIL remedy does **not** say "coord backups will start failing" (there are none — `server/src/coord/db.ts:144-145,221-222` states outright that `deploy.sh` backs up the shipped tree under `~/ccrc-backups/` and never `coord.db`), and `_check_services`' sketch printed no verdict at all for a box holding only the timer, which the runner reports as "the check printed no verdict line of its own".

- **D-86** — Task 2's brief specified `_check_config`'s absent-file arm as a flat WARN ("defaults apply: local mode on 127.0.0.1:7788", remedy `ccrc install`). The topology says that is wrong on one of the two boxes: **the fleet host has no `ccrc.env` and is not missing one** — it carries `~/.ccrc/agent.env` and has no reason to know where the server is (`_check_fleet` says so in its own SKIP, and this repo's CLAUDE.md topology section says so again) — while `ccrc` ships there all the same (`deploy/deploy.sh:401`). So every doctor run on the live fleet host printed a sentence about a server that does not run there, with the remedy `ccrc install`, which is the single-box SERVER-role installer: wrong sentence and wrong instruction, on the one box in the topology that has neither. Found by the Task 2 review (Important, fix round 1). What shipped: when `ccrc.env` is absent the arm decides on the box's **unit-file topology** — the same file-presence evidence `_check_services` reads, and the only thing on a box that records its role at all (D-73) — SKIPping with the measurement named when `ccrc.service`'s unit file is absent *and* `ccrc-agent.service`'s is present, and keeping the WARN otherwise. Both halves of that conjunction are required and both are pinned by mutation: dropping the `ccrc-agent.service` half turns a dev checkout with no units into a false "fleet role" SKIP. The unit directory became file-scope (`CCRC_UNIT_DIR`) rather than a second `local` copy, for the reason `ccrc-wrapper-shape` gives about `WRAPPER_BIN_DIR`.

- **D-87** — Task 3's brief left HOW to gate `_wrap_parse_shape`'s unbounded doctor-side read open ("give the doctor's shape loop the same cheap size gate"). Measured before choosing: bash's `read -N n` — the mechanism `_wrap_is_script`'s own two-byte gate already uses, and the obvious pure-bash reach for a bounded read — is **not** NUL-safe. `read -N n var < f` counts only NON-NUL characters toward `n`; on a NUL-heavy candidate (a sparse file, or any binary with zero-padding — exactly the realistic shape a misdeclared big file takes) it keeps consuming raw bytes hunting for `n` non-null ones, up to and including the WHOLE file if fewer than `n` non-null bytes exist anywhere in it. Measured directly: `read -N 1048577` against an all-NUL 5 MiB fixture consumed the entire file (rc=1, empty result) rather than stopping at byte 1,048,577 — the exact unboundedness D-81 exists to close, reintroduced through the "cheap" fix. The shipped gate instead calls `stat -c%s`, guarded by `command -v stat` and falling back to the pre-fix unbounded read when absent — the same trade `ccrc-doctor-checks` already makes for `df`/`git`/`gh`/`node`/`systemctl`/`loginctl` (all guarded external tools), and consistent with `stat` already appearing unguarded in `ccd/ccd` (`:580,5112,6420,8486`). This does NOT touch `ccd/ccrc-wrapper-shape`'s own "no external binary" invariant (its header's reasoning is scoped to `_wrap_is_script`/`_wrap_declares_config_dir`/`_wrap_parse_shape` themselves) — the new gate lives in `ccrc-doctor-checks`'s call site, one file over, which was already in the external-tool business. (Review addendum: the same `read -N` mechanism ALREADY bites `_wrap_is_script`'s own two-byte gate, `ccd/ccrc-wrapper-shape:75-89` — its "two bytes and never a third" is false for a NUL-leading file, measured 41.5 s to consume a 200 MiB all-NUL candidate, and it is the FIRST gate in both `_check_wrappers` and `ccrc-adopt`. Pre-existing, untouched by this task; carried as a deferred item alongside `_wrap_declares_config_dir`'s unbounded read in the candidate scan — reachable, measured a linear stall not a hang, disjoint from the shipped fix.)

- **D-88** — Task 6's brief supplied `_inst_env` verbatim with `local dest="$HOME/.ccrc/ccrc.env"`. Shipped as `local dest="$BOX_ENV_FILE"` instead: `ccd/ccrc:91-101` declares that path exactly once and its own comment gives the reason — "three copies of a path is how two of them end up reading a file the third does not write" — a sentence written when all three verbs were READERS. Task 6 makes this file the file's WRITER, which is the case that sentence was warning about, so a second spelling in the writer is precisely the drift D-85 already refused for doctor's reader. Same rule Task 7's brief states independently for the stamp ("write the stamp path ONLY as `\"$BOX_STAMP_FILE\"`"), applied one task earlier to the file install actually writes first. The variable's docblock now records that it has a writer; pinned by a text scan in `ccrc-install.test.ts` ("the env file is named once in the whole CLI" — code lines naming `.ccrc/ccrc.env` must be exactly the `BOX_ENV_FILE=` line, and `_inst_env`'s body must still contain `BOX_ENV_FILE`, so deleting the step does not satisfy it), measured red when the literal is put back. The other two step functions ship byte-for-byte as briefed: `$HOME/.ccrc/accounts.json` and `accounts.sh` are already spelled inline at eight sites in this file and carry no single-spelling rule.

- **D-89** — Task 7's brief supplied `_inst_tree` verbatim with `local src dest="$HOME/ccrc"` and a self-copy guard of `[ "$src" = "$dest" ]`, where `src` is `$(cd "$CCRC_HERE/.." && pwd)` and `dest` is the raw literal. Shipped with two changes, one for D-88's reason and one because the briefed guard fails OPEN. (1) `BOX_TREE_DIR="$HOME/ccrc"` joins `BOX_STAMP_FILE`/`BOX_ENV_FILE` at file scope: `_inst_tree` PLACES the tree and `_inst_bins`/`_inst_files` install OUT of it (Task 8 adds three more readers), so this is exactly the "a tree placed at one path and read from another" case the neighbouring block's comment already warns about — five spellings by the end of Task 8 otherwise. The one place the path is written out again is the launcher heredoc, which is DATA (bytes destined for a file on the box, pinned equal to deploy.sh's copy) rather than a path this file resolves, and the variable's docblock says so. (2) The guard compares `pwd -P` on BOTH sides, not a resolved path against a literal: the two spellings arrive by different routes (`$HOME`, and `$CCRC_HERE`'s parent via `${BASH_SOURCE[0]}`), so one symlinked component in either — `/home -> /export/home` is the classic — makes the textual comparison answer "different" for one directory. What is on the other side of that answer is `rsync -a --delete "$src/…" "$dest/"` with source and destination the same tree: a copy of `~/ccrc` into `~/ccrc/ccrc` followed by a `--delete` pass over the live tree it is reading from. Pinned by "does not copy the tree onto itself when it IS $HOME/ccrc" (a fixture whose tree lives at `<home>/ccrc`, asserting the recording rsync stub was never invoked at all); mutation-measured, guard deleted -> 1 red.

- **D-90** — Task 7's brief specified `_inst_atomic` as "compares bytes first (converged -> no write), else temp-sibling + chmod + `mv -f` + stray sweep". Shipped with the converged arm running `chmod "$mode" "$dest"` before it returns rather than returning immediately. Bytes-equal-and-mode-wrong is a REAL state on a box, not a hypothetical: `ccd/statusline-command.sh` is 0644 in the repository and 0755 on a box, a `cp` that preserved the source mode leaves a statusline that never runs, and a `~/.local/bin/ccd` left at 0600 is EACCES for every `claude-session@` supervisor on the host. deploy's `install_atomic` never has this problem because it always writes (scp + chmod, every run); the moment a local converger skips the write on byte equality, the mode stops being converged with it. `chmod` moves ctime and never mtime, so the repair costs nothing the idempotence assertion measures — the two properties are pinned by two tests that must BOTH stay green ("a second run rewrites none of them" on mtime, "repairs a mode someone changed — without rewriting the file" on mode *and* mtime), and deleting the byte-compare reddens both.

- **D-91** — `_inst_keep_aside` is an addition Task 7's brief did not specify. Two of the files `_inst_files` installs land in the OPERATOR's namespace rather than in ccrc's own — `~/.tmux.conf` and `~/.claude/statusline-command.sh` — and `deploy.sh:386-387` overwrites both with no backup, correctly, because it runs against a box that is by definition a fleet host. `ccrc install` runs against whatever machine somebody typed it on, where a `~/.tmux.conf` predating ccrc by years is an ordinary thing to find; eating it is precisely the damage `usage()`'s own promise ("Re-running converges; it never damages an existing install") disclaims. What shipped: when the destination exists and its bytes DIFFER from the shipped file, it is copied to `<dest>.pre-ccrc-<UTC>` with `cp -p` (`cmd_wrappers`' backup naming and its `cp -p`) and the copy is reported on the transcript before the replacement happens. The byte comparison is what makes it fire exactly once — after the first install the file at that path IS the shipped one — pinned by "keeps a personal ~/.tmux.conf aside before replacing it" and "a second run makes no second copy". Nothing in `~/.local/bin`, `~/.cc-sessions` or `~/.ccrc` is treated this way: those paths are ccrc's own namespace, and `~/ccrc-backups/` (deploy's answer) does not exist on a self-installed box.

## Deferred out of this plan, recorded so nothing is inherited as a surprise

- **`ccd version`'s python3 stamp reader** (F-survey item 3): the fix edits `ccd/ccd:2087-2109`, which a parallel session owns. Queued behind that session's merge; the seam and fix shape are documented in the survey report.
- **D-72** (roster fingerprint blind to `secretsFile` semantics) and **D-76** (single-definition sees only `.tsx?` + bash-corpus caveats) — own blast radius, unchanged.
- **D-73** (fleet-role box has no `ccrc.env`): the single-box installer writes one; deciding a fleet-role box's env content and shipping it in the agent lane stays open.
- **`CCRC_REMOTE_CONTROL`** — Stage 2e (config default off + pane-heuristic validation in BOTH modes; ccd hardcodes `--remote-control` at both spawn sites today and `_accept_first_run_prompts`' `/rc active` marker is one of five alternatives).
- **Doctor checks not in spec §5**: mail-token validity (today: boot refusal is the only surface), cert/name (Stage 3b).
- **`ccrc install --dry-run`**, role flags (`--role server|fleet`), the release-tarball path, `ccrc update`/`uninstall` — Stage 4 surface.
- **First-run spawn defects (a) and (b)**: VERIFIED CLOSED on main by Build 8 Wave 1 (survey D §5 with per-path cites: claim precedes settle on every live path; `_accept_first_run_prompts` has terminal rc 3/4/5). No task needed — verification recorded here.
