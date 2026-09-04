# Account pools — design

**Status:** design rev 1 — nine operator rulings settled 2026-09-04; awaiting operator review of this document · **Date:** 2026-09-04 · **Branch:** `ws/amber-summit` (based on `origin/main` `f6fb08f2`)
**Revision:** 1 — the design panel's winning approach with the three judges' grafts applied, and the ten findings of the one adversarial review that completed folded in (§12). Two adversarial lenses never ran (§14.1); their questions are answered in §6 and §11 by the author.

An account carries an optional **pool name**. A project carries an optional **pool name**. An account may
serve a project when either side is untagged or the names agree. Every place `ccd` chooses an account
for a session — fresh placement, the 5-second auto-swap tick, a manual swap or start — applies that one
rule, and so does the server before it builds the argv. Retagging a project moves its running
sessions into the right pool on the auto-swapper's own clock. An empty pool strands loudly rather than
crossing. A deliberate crossing needs its own flag and leaves a record.

This document records what was **measured**, not what was assumed: every mechanism below is anchored
to a `file:line` in the tree at `f6fb08f2` (the `ccd/ccd` script did not change between the panel's
measurement at `1c19787f` and this revision, so its anchors are exact; server and shared anchors were
re-verified at `f6fb08f2`). Pool names, account ids and labels in this document are **fixture names**
(`pool-a`, `pool-b`, `acct-a`, `demo`). The operator's real names are runtime data and appear in no
shipped file, no test, and no design document.

---

## 1. The three asks, and where each landed

| Ask | Outcome |
|---|---|
| Mark accounts as corporate or personal | A named `pool` field on the roster (`~/.ccrc/accounts.json`), **emitted into `accounts.sh`** so a disagreement between the two hand-owned copies is visible to `rosterAgreement` (§5.3). Names, not a binary, by ruling 1. |
| Label each project corporate or personal | A one-file marker per project at `~/.cc-sessions/pools/<project>` on the fleet box, written by a new whitelisted verb from the phone or by a shell (§5.4). Chosen over two alternatives by a lensed panel (§4). |
| Auto-swap rotation honours the labels | One bash predicate at **every** account decision in `ccd` (§5.5), mirrored by one pure server module for the forecast and the 409 (§5.6). Retag moves running sessions (§5.5.4), empty pool strands loudly (§5.8), crossings are explicit and recorded (§5.7). |

---

## 2. Operator rulings (settled in session, 2026-09-04)

| # | Question | Ruling |
|---|---|---|
| 1 | Binary corporate/personal or named pools? | **Named pools.** Each side carries an optional name. Rule: serve iff either untagged or names equal. |
| 2 | Where is a project tagged? | **From the PWA** (tap the project card, pick a pool) and by shell on the fleet box. Needs a new whitelisted verb. |
| 3 | What does untagged mean? | **Unconstrained** — today's behaviour. Tagging only tightens. The PWA flags untagged projects. Nothing strands on rollout. |
| 4 | Manual cross-pool swaps? | **Refused, with a deliberate override.** PWA hides mismatched accounts by default; API answers 409 with a named slug; a separate explicit flag distinct from the transcript-loss `--force`; every crossing logged. |
| 5 | Retag while sessions run? | **Move them automatically.** A wrong-pool current account is a must-leave; move at the next idle turn boundary (immediately if hard-blocked); re-seed the pinned home inside the pool. |
| 6 | Pool has no account with headroom? | **Stay in pool, make it loud.** Never cross. Visible stranded state (marker, log line, chips, notify banner); resumes when an in-pool account regains headroom. |
| 7 | Where does the project tag live? | **`~/.cc-sessions/pools/<project>`** — a registry subdirectory marker (§4, approach B). |
| 8 | What does a deliberate crossing mean afterwards? | **It sticks until a retag or a move.** A per-session marker records it; the pool machinery leaves the session alone while the project's pool and the account are unchanged; automatic moves never cross. |
| 9 | Two adversarial lenses (seams, rollout) never ran. | **Fold into the spec's self-review**, no re-run. §6 (seams) and §11 (rollout) are that review. |

**Interpretation of ruling 8 the operator should confirm (§14, O1).** The crossing marker suppresses
the **pool** machinery's reaction — the must-leave force, the home re-seed, the in-unit refusal. It does
not suppress the **pre-existing** home affinity: a session moved by `swap --cross-pool` still returns
home at the next idle boundary once home recovers, exactly as any manual swap does today, and that
return ends the crossing. An operator who wants the session to *stay* crossed through a home recovery
moves its home too, with `prefer --cross-pool`. Two levels, matching the existing `swap`/`prefer`
distinction; no new semantics for either verb beyond the flag.

---

## 3. What was measured

### 3.1 Where `ccd` chooses an account today (all fleet box, all project-blind)

| Decision point | Anchor | What it does |
|---|---|---|
| Fresh placement | `cmd_ws_add` `ccd/ccd:3613` → `_ws_least_loaded` `:3530` (zero-arg) → `_ws_seed_home` `:1449` | Iterates `CCRC_HOME_ABLE`, keeps accounts passing `_account_ok` (`:1028` — executable and no `$REG/<w>-disabled`), picks the minimum `_limit_score` (`:11076`), ties to roster order. Seeds `.home` once. |
| Start / enable | `cmd_start` `:12123`, `cmd_enable` `:13170` | Argument checked only by `_is_valid_wrapper` (`:1086`). **The registry wins over the argument** when a row exists (`:12160`), so the two-arg form is a revival path as well as a creation path, and `POST /api/sessions` always uses it. |
| Auto-swap tick | `_auto_swap_check` `:11209`, every 5 s from `cmd_supervise` `:12384` | Reads `wrapper` and `home` (`:11214`), gates on `lastswap` (`SWAP_COOLDOWN=900`, `:805`) and `swapblocked` (`SWAPBLOCK_COOLDOWN=1800`, `:806`), asks `_swap_target` (`:11142`), dispatches via `_dispatch_swap` (`:10986`) which `systemd-run`s **the on-disk `ccd`** re-entering `cmd_swap`. |
| Candidate set | `_pool_for` `:10984` → registry `pool` field **(no writer in the tree)** else `_default_pool` `:10960` | The registry `pool` field is a space-separated *candidate list*, not a pool name — a collision of vocabulary this design must live beside (§12, P-7). |
| Manual swap | `cmd_swap` `:12964` | Accepts **any** valid wrapper; `--force` means "accept transcript loss" only. Guard slot: after the `wrapper missing` check, before the detach arm. |
| Manual home | `cmd_prefer` `:13161` | Shell-only, no whitelist entry, the only unconditional `.home` writer. **Never journalled** (P-2). |

### 3.2 The silent strand that already exists

When a pane is hard-blocked (`_pane_hard_blocked` `:11200`) and `_swap_target` answers empty, `_auto_swap_check` returns at `:11242`-`:11243` with **no log line, no marker, no cooldown stamp**, and retries every 5 s forever. `ccd-account-ok.test.ts:133-145` reaches it with every account at ceiling. Ruling 6 makes this loud for tagged *and* untagged projects (§5.8). P-3.

### 3.3 The roster is two hand-owned copies, and only emitted fields are drift-detectable

`~/.ccrc/accounts.json` exists once per box, seeded once by `ship_roster` (`deploy/deploy.sh:468-474`), never overwritten. `rosterAgreement` (`server/src/fleetstate.ts`) compares digests of the **generated `accounts.sh`**, so a JSON-only field produces byte-identical output and a green banner. A pool field that is not emitted is a pool field whose cross-box drift nobody sees. Probed, not inferred (design panel, gap 6). `server/src/config.ts:197-201` still claims deploy ships the same file to both boxes — false (P-4).

### 3.4 The bash mirror of the roster parser is laxer than it promises

`shared/roster-json.mjs` (`checkAccount`, `:127`) says "stricter, never laxer" and never learned `hidden` — it accepts `hidden: "false"`, which the server then refuses at boot behind a green deploy. Closed in the same act as adding `pool` (P-1).

### 3.5 The project is a directory name, and nothing per-project exists

A project is the name of a directory under `$PROJECTS_ROOT` (`ccd/ccd:771`; `server/src/config.ts:323`; agent `resolveProjectsRoot`). `listProjects` (`server/src/lifecycle.ts:126-160`) is a readdir. The registry carries `project` per session; the server falls back `project ?? id`. There is **no per-project metadata store**; the only per-project hook is `$main/.ccrc/workspace.sh`, executed by `ws-add` (`ccd/ccd:3812`). Four projects are not git repositories.

### 3.6 Both deciders can read the registry, and a registry subdirectory crosses the agent

The agent's read roots are `.cc-sessions`, `.cc-limits`, `.cc-clips`, the projects root and `.claude*` (`agent/src/whitelist.ts:58-59`; prefix test, so subdirectory depth is unrestricted). The `.lifecycle/` mirror already readdirs a `$REG` subdirectory through the agent (`server/src/coord/mirror.ts`). The write root is `.cc-clips` only. `~/.ccrc` is deliberately **not** a read root (`agent.env` holds the bearer token).

### 3.7 `readdir` still folds absent into unlistable; measured reads do not

At `f6fb08f2` the measured-read family grew (`readFileMeasured`, `readFileFromMeasured`, `readFileB64Measured`, `statMeasured`; `server/src/io.ts:43-96`) and `ReadFailure` moved to `shared/agent-protocol.ts`. `readdir` still answers `string[] | null` (`io.ts:96`) — no measured variant. The design resolves that collapse with the parent listing the tick already takes (§5.4.4), the same technique `readLimits` uses for lane markers.

### 3.8 Running supervisors execute the pre-deploy inode

`deploy.sh` installs `ccd` (`:617`) and restarts `claude-session@*` units only in the final sweep behind the `KillMode=process` preflight. Between the two, each running supervisor's `_auto_swap_check` is the **old** code while `_dispatch_swap`'s transient unit runs the **new** `ccd`. This window is where the adversarial review found a new silent strand (§5.8.4, P-14).

### 3.9 Version skew rides the caps channel

`ccd caps` lists verbs plus tokens (`stop-surface`, `lifecycle-v1`, `actor-flags-v1`; `ccd/ccd:4719-4804`). `verbSupported` permits on no evidence; `capSupported` refuses on no evidence. `KNOWN_CAPABILITY_TOKENS` (`server/test/ccd-archive.test.ts:154`) pins the token set exactly.

---

## 4. The fork: where the project tag lives

The tag must be readable by `ccd` on the fleet box, readable by the server through the agent's whitelist, and writable from the phone through a whitelisted verb. Three homes were designed in full and judged under three lenses (safety invariants; operability on the real two-box fleet; test pinnability and architecture fit). Scores out of 10.

| Approach | Home | Invariants | Operability | Pinnability |
|---|---|---|---|---|
| A | `$PROJECTS_ROOT/<project>/.ccrc/pool` in the project's main checkout | 4 | 6.5 | 7.5 |
| **B** | **`~/.cc-sessions/pools/<project>`** — a dotless registry subdirectory | **8** | **8** | **8** |
| C | `~/.ccrc/projects.json` on the fleet box, shipped on the agent handshake plus a new op | 5 | 5.5 | 6 |

**Why not A.** The policy file sits inside the working tree every Claude Code session runs in (`cmd_start` defaults the workdir to `$PROJECTS_ROOT/$project`, `ccd/ccd:12180-12186`). It is ignored via `info/exclude`, not tracked, so an agent's `git clean -fdx` deletes it and the project silently reverts to unconstrained — the only signal is the ruling-3-normal untagged chip. Before the exclude lands, `git add -A` commits a pool name into a public repository and makes the tag branch-dependent. A project-level fact would also ride every `FleetSession` row into the persisted state cache.

**Why not C.** `_project_pool` validates the whole document, so one hand-typed trailing comma makes every project unreadable: no placement and no rescue fires anywhere on the box until fixed — ruling 3's "nothing strands" becomes "everything strands". Shell edits reach the server only on the 60 s caps lane against ≤2 s for A and B. A python3 spawn per session per 5 s tick would be the **first interpreter on the supervisor's hot loop** (`_limit_json_num` is grep/head; the only python3 in that region is inside `cmd_swap`). Largest edit set: a new agent op, a new handshake field, a mode fork, a required `FleetState` field touching ~16 test files.

**Why B.** The tag lives outside every git tree and every session cwd, beside the switches the operator already hand-touches (`<w>-disabled` `ccd/ccd:1024`, `coordinator-paused` `:5083`, `mail-disabled`). One `ls ~/.cc-sessions/pools/` shows every tag; `echo pool-a > pools/demo` and `rm` are the 2 am idiom; a typo strands **one project**. Both deciders read the same file at request-time freshness with no grant change. The namespace claim was verified against the source: every registry glob is suffix-shaped (`_reg_purge` `:1294` and `_ws_slug_free` `:3492` glob `"$REG/$id".*`; the only bare globs are `*.uuid` and `*.workspace` at `:6112, :10464, :13342, :13373`), `readRegistryMeasured` mints ids from `.uuid`, `readLimits` keys markers off `-disabled`, and `ccrc uninstall` removes only named files — so a dotless directory is invisible to every namespace reader. `$REG/<project>.pool` was ruled out by a real collision: ids are `<wrapper>-<project>`, so a project named `acct-a-demo` would produce the per-session `pool` field of session `acct-a-demo`. Dot-leading `.pools/` was ruled out because dot-leading is `ccd`'s private namespace and ruling 2 makes this marker operator-touchable.

**Grafts from the losers, all applied below.** From A: the empty-project guard; the single word-answer reader; the route re-reads the marker and answers a measured state; `FleetHealth.projectPools` plus a banner arm; a text-extraction parity test between the bash and TypeScript literals; die messages and aria-labels carry the full path; the `--pool` existence check accepts a registry-only project. From C: the never-`die`s pin for a reader that runs inside the supervisor loop; the remote-mode isolation pin; the fixture-count floor on parity suites; the edit-set entries both A and B missed (`auth-gate.test.ts` hard literals, `gate.ts:8`'s route count).

---

## 5. Architecture

### 5.1 Role matrix

| Actor | Box | Reads | Writes | Decides |
|---|---|---|---|---|
| `ccd` (bash) | fleet | `accounts.sh` (`_ccrc_pool`), `$REG/pools/<project>`, registry fields | `$REG/pools/<project>` (verb), `.home` (re-seed, prefer), `.stranded`, `.crosspool`, `.strandnotify`, `swap.log`, `.lifecycle/` | **The authority.** Placement, auto-swap, manual verbs. |
| Operator shell | fleet | anything | `$REG/pools/<project>`, `accounts.json` (both boxes) | — |
| Agent | fleet | `$REG/**` through the whitelist; `accounts.sh` digest outside it | nothing new (write root stays `.cc-clips`) | Nothing. Executes granted argv. |
| Server | server | roster (boot), `pools/` via agent, registry via agent | nothing on the fleet box | The 409 pre-check, the forecast, wire composition. **Refuses; never places.** |
| PWA | phone | wire only | — | Display and the tap. Hides mismatched rows behind a disclosure. |

`EXEC_COMMANDS = ['tmux','ccd']` stays closed. No `gh` grant. The server never SSHes. Every change under `ccd/` deploys **agent-first**.

### 5.2 The rule, spelled once per language

> An account **a** may serve a project **p** iff `pool(a)` is null, or `pool(p)` is null, or `pool(a) == pool(p)`.
> If `pool(p)` cannot be read, **nobody decides**: creation refuses naming the file, the auto-swapper holds and marks a strand if the session is hard-blocked, the server answers 503.

Three spellings, one fixture table (`server/test/fixtures/poolRule.ts`, `POOL_RULE_CASES`) driven through all three: bash `_pool_ok` (§5.5.1), TypeScript `poolVerdict` (§5.6), PWA `splitByPool` (§5.10).

### 5.3 The account side

**`~/.ccrc/accounts.json` — per-account optional key `"pool": "<name>"`.** Grammar `POOL_NAME_RE = ^[a-z][a-z0-9-]{0,31}$`, the `ID_RE` shape, exported once from `shared/roster.ts` beside `ID_RE` with a docstring saying why the two coincide: the value is embedded unquoted in a generated bash `case` arm and printed with `echo`, and a leading lowercase letter is what makes `echo` safe (the same reasoning `shared/generate.mjs` gives for labels). `AccountDef.pool: string | null` is **required on the type** (`null` = untagged), so every constructor answers. `ACCOUNT_KEYS` (`roster.ts:238`) gains `'pool'`. `parseAccount` refuses `""`, `null`, non-string, or off-grammar with a `RosterError` whose remedy names the file and the fix — never coerces (adapter-may-not-narrow). An older server reading a `pool`-carrying file warns-and-drops through `warnUnknownKeys` — absence-permits.

**`shared/roster-json.mjs` mirrors it** in `checkAccount`, `bad()` on the same shapes, and **returns** `pool` so the generator can emit it. Same act: the missing `hidden` boolean check (P-1). `shared/roster-json.d.mts` gains `pool: string | null`.

**`~/.ccrc/accounts.sh` — one new emission**, always present, after `_ccrc_hue()`:

```bash
_ccrc_pool() {
  case "$1" in
    acct-a) echo pool-a ;;      # one arm per TAGGED account, byIdLengthDesc order like _ccrc_cfg_dir
  esac
}
```

Emitted even with zero tagged accounts (an empty `case`), so `declare -F _ccrc_pool` is a version probe and a new `ccd` never hits `command not found`. Contract: empty stdout, rc 0, for an untagged or unknown id — the caller decides what silence means (`_ccrc_cfg_dir`'s rule). This emission is what `bodyDigest` sees, so a pool disagreement between the two boxes reads `rosterAgreement: divergent` with the banner's existing remedy. During every agent-first deploy that adds pools the banner will show for the minutes between the two lanes — expected; the deploy output says so. `hidden` stays outside the digest; the doctor's D-72 note (`ccd/ccrc-doctor-checks:3278`) must say `pool` is covered and `hidden` is not.

**`RosterWire.pool: string | null`** on `GET /api/accounts` (`server/src/server.ts:1142`), additive; **one** PWA reader `accountPool(roster, w)` in `pwa/src/lib/accounts.ts` (`typeof a.pool === 'string' ? a.pool : null`), so an older server omitting the key reads as untagged. `accounts-route.test.ts`'s key-set pin gains `'pool'`.

### 5.4 The project side — `~/.cc-sessions/pools/<project>`

#### 5.4.1 Storage

| | |
|---|---|
| Path | `$REG/pools/<project>` on the fleet box; `ccd` constant `POOLS_DIR="$REG/pools"` beside `REG=` (`ccd/ccd:765`); server `path.join(cfg.registryDir, POOLS_DIR_NAME)` with `POOLS_DIR_NAME = 'pools'` spelled once in `server/src/pools.ts`. In `CCRC_FLEET=local` the server reads its own box's directory, the one that box's `ccd` reads. |
| Filename | the project name exactly as the registry `project` field and `$PROJECTS_ROOT/<project>` spell it; `_ws_project_valid` (`:3462`) is the grammar — refuses `..`, `.`, dot-leading, whitespace, slashes, so the joined path can never leave `pools/`. |
| Content | one token matching `POOL_NAME_RE`, written `printf '%s'` with no trailing newline (the `_reg_set` convention `:1263`); every reader strips trailing whitespace so a shell `echo pool-a > …` is legal (ruling 2). |
| Absent file | untagged = unconstrained (ruling 3). Absent directory: nobody has tagged anything. The directory is created lazily by the first `--pool` and never removed. |
| Atomicity | `$REG/pools/.<project>.$BASHPID.tmp` then `_plat_mv_notdir` (`:75`). A SIGKILL between the two leaks one dot-leading tmp — the same disclosed price `_reg_set` pays. Every reader skips dot-leading entries; exact, since no project may lead with a dot. |
| Lifecycle | `shared/lifecycle.ts` `LIFECYCLE` gains `project-pool-tag`, pattern **O**, collector null with the required ruling sentence (§9). `_reg_purge`, `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`, `forget` never name `pools/` — a project's tag outlives every one of its workspaces by design. |
| Not persisted server-side | not in `~/.ccrc/state-cache.json`, not in the PWA offline snapshot. A cached tag rendered as live policy would lie; absent = unknown, the PWA stays silent. |
| Not backed up | `deploy.sh`'s backup list does not include registry markers; same as every other marker; documented in README beside the lane markers. |

#### 5.4.2 The writer verb — `ccd project-pool --project <p> --pool <name>` / `--clear`

Modelled line for line on `cmd_coord_pause` (`ccd/ccd:5083-5117`): flag-led, exact arity (`usage` die otherwise), `_ws_project_valid "$project" || die`, `[[ -d "$REG" ]] || die`, pool-name grammar via `_pool_name_valid` (one bash literal `POOL_NAME_RE=`, pinned against the TypeScript regex by text extraction, §11 row 5). **Existence check on `--pool` only**: `[[ -d "$PROJECTS_ROOT/$project" ]] || grep -qxF -- "$project" "$REG"/*.project` — so the four non-git projects and registry-only custom-workdir projects are taggable, and `--clear` skips it so a stale tag for a deleted project is always removable (the doctor's remedy must always work). Both arms **checked** with the coord-pause polarity — `|| die "could not write the pool tag for $project — it is NOT tagged"` / `"… it is STILL tagged"` — because `ccd` runs `set -uo pipefail` with no `-e` (`:9`). Echoes `tagged <p> <name>` / `untagged <p>` for a human; appends one `swap.log` line `<date> pool-tag <p>: <old|-> -> <new|->` (the retag is the *cause* of the `rehome`/`auto-pool` lines that follow it; §12 P-11 records that this puts a project where every other line puts an id). Warns on stderr when no rostered account carries the name — a warning, not a refusal, because this pool may be about to gain an account and the fleet's roster copy is the authority. No `_lc_done` line: the lifecycle vocabulary is per-session, and `cmd_coord_pause` journals nothing.

**Grant.** `agent/src/whitelist.ts`: `EXEC_WHITELIST.ccd` gains `['project-pool', '--project']` and `REQUIRED_VERB_FLAG` (`:240`) gains `'project-pool': '--project'` — the enrolment is what makes the two-token grant actually two tokens wide, since `isExecAllowed` is prefix-matching and tokens after the prefix are unconstrained. Dropping the flag from the grant is a compile error on the `LawfulGrants` proof line (`IllegalGrant`, `:273`) and a boot refusal. `cmd_caps` heredoc gains `project-pool`; dispatcher arm beside `coord-pause) shift; …` (`:13449`). No new capability token for the tag route: the verb and every reader ship in one `ccd` inode, so the verb's presence in `ccdVerbs` **is** the evidence (§5.11).

**Route.** `POST /api/projects/:project/pool` `{ pool: string | null }`, registered in `server/src/server.ts` beside `/api/projects/:project/workspaces` (`:1714`). `body.pool` neither `null` nor string → 400 `bad-request`; string failing `POOL_NAME_RE` (imported from `shared/roster.ts`) → 400 `bad-pool-name`. The ternary picks the **entry**: `CCD_ARGV.projectPoolClear(project)` or `CCD_ARGV.projectPoolSet(project, pool)` (two entries, not a parameter — `ccdargv.ts:180`'s `start`/`enable` rule; both enumerated by `whitelist-subset`). `if (!verbSupported(deps.fleetState, argv)) return 501 unsupported` — the literal `verbSupported(` inside the handler is what `verb-gate.test.ts`'s text scan requires; the verb is new and skew-exposed, so it must **not** join `UNGATED_BY_DECISION`. `runCcdOr502` (`:1645`) → 502 `{stderr}` with `ccd`'s own die text. **On success the route re-reads the marker through the agent** and answers `200 { ok: true, pool: <ProjectPoolWire>, warning?: 'unknown-pool' }` — a measured state, not `requested`: unlike `$REG/coordinator-paused`, this file *is* under a read root, so the truthful answer is available before the 200 leaves (graft from A). `warning: 'unknown-pool'` when the server's roster has no account in that pool — a warning, because the server's copy can lag the fleet's (§3.3). The `:project` param is passed to `ccd` unvalidated, as `/workspaces` does — `_ws_project_valid` on the box is the authority; the server's reader never joins a request-supplied name into a path (Map lookup after a listing), so `isSafeProjectSegment`'s stricter grammar does not enter. Not in `auth/gate.ts` `EXEMPT` — session-gated when armed, open dark, like `/workspaces` and `/swap`. No box token: this is fleet control, not a coordination write. The route lives in `server.ts`, outside `coord-pause-route.test.ts`'s census by placement — the `kickoff` situation CLAUDE.md describes; the route count literals move by one (§11 row 27).

#### 5.4.3 The `ccd` reader — one function, four words, never dies

```bash
_project_pool_state() {   # project -> "named <n>" | untagged | unreadable | malformed ; always rc 0
  local f v; [[ -n "${1-}" ]] || { echo untagged; return 0; }        # a row with no .project field must never resolve to the DIRECTORY (graft from A)
  f="$POOLS_DIR/$1"
  [[ -e "$f" ]] || { echo untagged; return 0; }
  v=$(cat -- "$f" 2>/dev/null) || { echo unreadable; return 0; }       # EACCES, EISDIR (a directory where the file belongs), ELOOP
  v=${v%"${v##*[![:space:]]}"}                                          # strip trailing whitespace: a shell echo is a legal writer
  _pool_name_valid "$v" && { echo "named $v"; return 0; }
  echo malformed
}
```

Placed beside `_lane_enabled` (`:1024`). It is the **only** reader in `ccd`; every decider calls it once per decision and passes the word to `_pool_ok` (§5.5.1). It runs inside the long-lived `cmd_supervise` loop, so it may never `die` — pinned by sourcing `ccd` with `die() { echo DIED; exit 99; }` interposed (graft from C). `unreadable` and `malformed` are distinct words with distinct remedies (permissions versus rewrite the file), and neither is ever folded into `untagged` — folding would silently lift the constraint, the overloaded-null defect this tree names.

#### 5.4.4 The server reader — `server/src/pools.ts` (L3)

`readProjectPools(io, cfg, rootNames): ProjectPoolsRead` and `poolFor(read, project): ProjectPoolWire`. Imports `FleetIO`, `node:path`, `CcrcConfig`, L0 types. Algorithm:

1. `rootNames === null` → `{ listed: false }` (the registry root itself is unlistable).
2. `!rootNames.includes('pools')` → `{ listed: true, tags: new Map() }` — the directory is **measured absent**, every project untagged.
3. `names = await io.readdir(join(registryDir, 'pools'))`; `null` → `{ listed: false }` — present at the root but unlistable (a regular file planted at that path, or EACCES).
4. For each `n` not starting with `.`: `io.readFileMeasured(join(dir, n))` — `absent` → skip (deleted between list and read; absence is untag); `unreadable` → `{state:'unreadable'}`; `ok` → strip trailing whitespace, `POOL_NAME_RE` pass → `{state:'tagged', name}`, fail → `{state:'malformed'}`.

`poolFor` = `listed ? tags.get(project) ?? {state:'untagged'} : {state:'unreadable'}`. This is how the `readdir` absent/unlistable collapse (§3.7) is resolved **without a protocol change**: the root listing that `readRegistryMeasured` already returns as `RegistryRead.names` (`server/src/registry.ts:788`; used at `server/src/watch.ts:693-702`) tells absent from unlistable one level up, the same trick `readLimits` plays for `-disabled` markers. A remote `forbidden` reply maps to `unreadable`, never `absent` (`server/src/remote/io.ts:46`), so a whitelist regression shows as every project `unreadable`, not as a fleet of untagged projects. `poolsEnforcement(ccdVerbs)` = `null → 'unknown'`, includes `'project-pool'` → `'enforced'`, else `'unavailable'` — the `lifecycleState` three-state shape (`server/src/coord/mirrorplan.ts:207`).

Callers: `GET /api/projects` (`server.ts:1667`, with its own root readdir, composing `pool` per row exactly as it composes `readiness` — `listProjects` itself stays pool-free, the split `lifecycle.test.ts` pins); the watcher tick (`watch.ts:693`, with `registryRead.names` — zero extra root readdirs); the swap and sessions routes at request time (§5.6); `GET /api/fleet` for first paint (additive `pools?`).

#### 5.4.5 Wire

`shared/api.ts` (L0):

```ts
export type ProjectPoolWire =
  | { state: 'tagged'; name: string } | { state: 'untagged' } | { state: 'malformed' } | { state: 'unreadable' };
export type ProjectPoolsWire =
  | { listed: true; byProject: Record<string, ProjectPoolWire>; enforcement: PoolsEnforcement }
  | { listed: false; enforcement: PoolsEnforcement };
export type PoolsEnforcement = 'enforced' | 'unavailable' | 'unknown';
```

`ProjectRow.pool?: ProjectPoolWire` (`:1367`, beside `readiness?` with its three-valued docstring extended: key absent = older server = unknown, never flag). `FleetMsg` gains `| { type: 'pools'; pools: ProjectPoolsWire }` (`:2650`, the `divergence` frame's argument: a fleet-level fact must not ride `FleetSession`, or `reviveFleetSession` becomes a second producer). Emitted from the watcher tick with a byte-equality change guard (the `emitCoord` idiom, `watch.ts:702`). `FleetHealth.projectPools?: PoolsEnforcement` on `GET /api/fleet/health` (`server.ts:1040`) — health is where the PWA already reads skew. **No `FleetSession` field for the project pool** and no `reviveFleetSession` change; the PWA derives a session's project pool from the frame by `s.project`. `FLEET_PROTO` stays 1.

#### 5.4.6 Doctor

`ccd/ccrc-doctor-checks`: `pools` added to `CCRC_DOCTOR_CHECKS` (`:166`); `_dr_check_pools` on the roster-vs-wrappers template — reports, resolves nothing. Verdicts, each its own line with its own remedy: WARN `pools-stale` (no directory and no `*.project` row for the name; remedy `ccd project-pool --project <p> --clear`); FAIL `pools-malformed` (rewrite as one token); WARN `pools-orphan-pool` (no account in `accounts.json` carries the name — this pool is empty and will strand, ruling 6); WARN `pools-tmp-leak` (a dot-leading entry; `rm`); FAIL `pools-unlistable` / `pools-unreadable <p>` (permissions). No directory → PASS "no project pools tagged".

### 5.5 The deciders in `ccd`

#### 5.5.1 One predicate

```bash
_acct_pool() { declare -F _ccrc_pool >/dev/null 2>&1 && _ccrc_pool "$1"; return 0; }   # old accounts.sh -> "" -> untagged, no rc 127
_pool_ok() {   # wrapper pool-state -> 0 serve | 1 mismatch | 2 undecidable ; pool-state is a _project_pool_state word
  local ap pp; ap=$(_acct_pool "$1")
  case "$2" in
    untagged)  return 0 ;;
    "named "*) pp=${2#named } ;;
    *)         return 2 ;;                     # unreadable | malformed: nobody decides
  esac
  [[ -z "$ap" || "$ap" == "$pp" ]]
}
```

Beside `_is_home_able` (`:1090`). Callers obtain the state **once** per decision (`pps=$(_project_pool_state "$project")`) and pass the word, so a loop over five candidates costs one `cat`, not five. Under `set -uo pipefail` without `-e`, `declare -F` on an undefined function short-circuits cleanly and no array is touched, so a new `ccd` over an old `accounts.sh` reads every account as untagged — today's behaviour — with no stderr noise.

#### 5.5.2 Placement — `_ws_least_loaded [project]` and `cmd_ws_add`

`_ws_least_loaded` (`:3530`) gains an optional positional. Zero-arg keeps today's meaning (`${1:-}` → `untagged`), so the parity harness's existing calls stay green. With a project: `pps=$(_project_pool_state "$1")`; if `_pool_ok` would answer 2 the function returns `""` at once (no placement — the caller names why); in the loop, after `_account_ok || continue` (`:3585`), `_pool_ok "$w" "$pps" || continue`. The `first` fallback (`:3586`) sits after that line, so an all-unmeasured in-pool set falls back to the first **in-pool** account (verified by the adversarial review). `cmd_ws_add` passes `"$project"` at `:3707`; its refusal loop (`:3710-3713`) gains `$w:pool=<name>` and `tag:<unreadable|malformed> $POOLS_DIR/<p>` reasons; the die names the pool, the in-pool remedies (`rm $REG/<w>-disabled`, tag another account into the pool, untag the project) and "nothing was touched". The dispatch path (`CCD_ARGV.wsAddWorker`, `server/src/coord/dispatch.ts`) inherits this: a pool-empty refusal surfaces as `!res.ok` stderr; a pre-check at dispatch is deliberately not built (§14, O2).

#### 5.5.3 The auto-swap target — `_swap_target` (`:11142`)

Reads `project` and `pps` once. Then, unless the row carries a **valid** crossing marker (§5.7.2):

- `_pool_ok "$cur" "$pps"` → 1 (wrong pool) sets `force=pool`, skipping both "stay" shortcuts — a wrong-pool current account is a must-leave (ruling 5); → 2 (undecidable) returns nothing and lets the caller mark a strand if hard-blocked.
- The "home recovered: go back" branch (`:11162`) is guarded by `_pool_ok "$home" "$pps"` — never return to a wrong-pool home.
- The candidate loop (`:11166-11169`) filters `_pool_ok "$cand" "$pps" || continue` **after** `for cand in $(_pool_for "$id")` — inside `_swap_target`, not inside `_default_pool`, because a hand-set `$REG/<id>.pool` list bypasses `_default_pool` entirely (`:10984`). Automatic moves therefore **never cross**, marker or no marker.

The function's stdout overload (empty = "stay, fine" and "must leave, nowhere") is **not** changed; the caller disambiguates on `$hard_blocked` as it does today (P-10). `ccd-auto-swap-hold.test.ts` pins the two arms and the hold rung; none moves.

#### 5.5.4 The tick — `_auto_swap_check` (`:11209`)

Insertions, in order:

1. **Home re-seed** (ruling 5), after `home=$(_home_for "$id")` (`:11214`) and **before** the `lastswap` gate, so it runs on every live tick regardless of cooldowns and is idempotent once `.home` is in-pool: `project=$(_reg_get "$id" project); pps=$(_project_pool_state "$project")`; if `_pool_ok "$home" "$pps"` answers 1 and no valid crossing marker exempts the row, `new=$(_ws_least_loaded "$project")`; when non-empty, `_reg_set "$id" home "$new"`, journal `_lc_done rehome "$id" "" meas.from "$home" meas.home "$new" meas.reason pool meas.pool "<name>"`, log `rehome <id>: home <old> -> <new> [pool=<p>]`, and continue the tick with `home=$new`. Rows with no `.home` file (pre-2026-07-28) get one written for the first time. `_ws_seed_home` never clobbers and is not used here. `rehome` joins `_LC_ACTS` (`:1670`), `LifecycleAct`/`LIFECYCLE_ACT_MAP` (`shared/api.ts:4609/:4638`) and `ACT_WORD` (`pwa/src/session/journalWords.ts:27`) — `lifecycle-vocabulary.test.ts` executes `_LC_ACTS` and reds unless both sides agree.
2. **Crossing-marker validity** (§5.7.2) is evaluated here, before the re-seed consults it.
3. **Strand clear on a healthy pane**: right after `_pane_hard_blocked` (`:11241`), `[[ -z "$hard_blocked" ]] && _strand_clear "$id"` — `_strand_clear` tests `[[ -e ]]` first (§5.8.2), so the steady state of a healthy session writes nothing.
4. **Strand mark** (ruling 6): the silent `|| return 0` at `:11243` becomes a branch — empty target and `hard_blocked` → `_strand_mark "$id" "$wrapper" "$project"`; a target → `_strand_clear "$id"` then the existing arms.
5. **Log verb**: when the affinity arm (`:11278-11295`) moves a session whose current account failed `_pool_ok`, the `swap.log` verb is `auto-pool`, not `auto-home` — the move's reason was a retag.

The hold rung (`:11278`) is **not** moved: a retag is an affinity-class relocation and a held mid-wave worker stays put until release (§14, O3). A hard-blocked wrong-pool session still rescues via the arm at `:11254`, which precedes the hold rung. **Timing the operator should know:** the move goes through the `lastswap` (900 s) and `swapblocked` (1800 s) gates, which sit before `_swap_target` is consulted; a session that swapped in the last 15 min, or was refused in the last 30 min, keeps running on the wrong-pool account until its gate opens. The re-seed itself is unaffected. Retag does **not** bypass `SWAP_COOLDOWN` — that would reopen the storm the gate exists for.

#### 5.5.5 Manual verbs — `cmd_swap`, `cmd_start`, `cmd_enable`, `cmd_prefer`

All four strip `--cross-pool` anywhere in argv (the `cmd_swap` flag-loop shape, `:12975-12983`). `_is_valid_wrapper` (`:1086`) is the second lock: ids match `ID_RE`, so a leading `-` can never bind as a wrapper on any `ccd`, old or new. `cmd_swap_self` forwards no flags and so cannot cross by accident.

- **`cmd_swap`** (`:12964`): guard after the `wrapper missing` check (`:12990`) and **before** the detach arm (`:12997`), so it dies synchronously — the PWA gets a 502 with `ccd`'s sentence, a shell gets stderr, the transient unit's stderr lands in `swap.log`. `project=$(_reg_get "$id" project); pps=$(_project_pool_state "$project")`; `_pool_ok "$target" "$pps"` → 1 without `$cross` → `die "pool-mismatch: <target> is in pool '<a>' and project '<p>' is in pool '<b>' — to cross on purpose: ccd swap --cross-pool <id> <target>"`; → 2 → `die "pool tag for <p> is <unreadable|malformed>: $POOLS_DIR/<p> — fix or clear it; nothing was touched"`. The detach arm carries `${cross:+--cross-pool}` beside `${force:+--force}`, so the detached retry keeps the operator's decision. The `cross-pool` log line and `meas.crosspool 1` on `_lc_done swap` are written **once, at the success tail** (`:13138`) — not at the guard, which runs twice when the swap re-execs itself detached (adversarial finding, minor). The success tail also writes the crossing marker (§5.7.2) and removes `.stranded`. `--force` still means transcript loss only; `--force --cross-pool` compose; `_swap_refuse`'s hint (`:12960`) must not suggest one for the other's condition.
- **`cmd_start`** (`:12123`): the guard goes **after** the registry-wins block (`:12160`), gated on creation — `if [[ -z "$regw" ]]` — because at the earlier slot `wrapper` is the argument the registry is about to overwrite (adversarial finding, moderate). A revival with a wrong-pool registry wrapper is **not** refused (ruling 5's auto path moves it at the next boundary); at most a `warn:` line. The creating form with a mismatch dies `pool-mismatch: … ccd start --cross-pool <w> <p>`; with `--cross-pool` it seeds `home=<w>` and writes the marker. Revival removes `.stranded` (`:12222`).
- **`cmd_enable`** (`:13170`): strips **before** `id=$(_id "$1" "$2")` (`:13182`) — otherwise it journals `enable` for an id like `--cross-pool-<w>` (verified) — then delegates `cmd_start ${cross:+--cross-pool} "$@"`.
- **`cmd_prefer`** (`:13161`): after `_is_valid_wrapper` (`:13164`), `_pool_ok "$w" "$pps"` → 1 without `$cross` → die naming `ccd prefer --cross-pool`. With the flag: writes `.home` and the marker (§5.7.2). For the first time journals `_lc_done rehome "$id" "" meas.from "$old" meas.home "$w" meas.reason prefer ${cross:+meas.crosspool 1}` (P-2). Stays shell-only — no grant, no `CCD_ARGV` entry.
- **`cmd_ensure`** (`:12281`): `rm -f "$REG/$id.stranded"` goes **inside** the existing `[[ "${CCD_IN_UNIT:-}" != 1 && "${CCD_KEEP_SWAPBLOCK:-}" != 1 ]]` block (`:12324`), sharing `swapblocked`'s argument verbatim: a supervisor re-entering its own unit is not a revival, and clearing there would re-mark and re-banner within one tick (adversarial finding, moderate — the panel's design had said three incompatible things about this line).

### 5.6 The server's mirror — `server/src/poolrule.ts` (L1) and the routes

Pure module, type-only imports, purity-scanned like `coord-caps-policy.test.ts:124-172` (no clock, no `node:`, no `reply`, no store):

```ts
export type PoolVerdict =
  | { ok: true;  why: 'untagged-project' | 'untagged-account' | 'same-pool' | 'account-not-in-roster' }
  | { ok: false; reason: 'pool-mismatch'; accountPool: string; projectPool: string }
  | { ok: false; reason: 'pool-undecidable'; state: 'unreadable' | 'malformed' };
export function poolVerdict(roster: Roster, wrapper: string, pool: ProjectPoolWire): PoolVerdict;
export function poolEligible(roster: Roster, pool: ProjectPoolWire): AccountDef[];   // roster.homeAble filtered by poolVerdict().ok
export type ProjectPlacement = { kind: 'projected'; wrapper: string; score: number } | { kind: 'none'; pool: string | null } | { kind: 'unmeasurable' };
export function projectPlacement(roster: Roster, limits: Record<string, AccountLimits>, pool: ProjectPoolWire): ProjectPlacement;
```

An account absent from **this** server's roster passes through as `account-not-in-roster` — `ccd`'s `_is_valid_wrapper` is the authority and the PWA already offers live non-roster wrappers. `projectHome(roster, limits, pool)` (`server/src/limits.ts:96`) gains the third argument and computes `live` over `poolEligible`; `limits.ts` imports `node:path`, so the decision stays in `poolrule.ts` and `limits.ts` only composes. `GET /api/accounts`'s global `projected` is **kept** and re-documented as the forecast for an untagged project (`projectHome(roster, limits, {state:'untagged'})`); per-project placement lands additively on `ProjectRow.placement` — `unmeasurable` for an unreadable tag is a **value**, not a null.

**Routes.** `POST /api/sessions/:id/swap` (`server.ts:1850`) and `POST /api/sessions` (`:1694`) gain `crossPool?: boolean`. Swap: registry lookup for the row (`readRegistry`, the existing idiom; 404 `unknown-session` if absent) → `readProjectPools` **at request time** (one root readdir, one `pools/` readdir, K reads — graft from A: the 409 decides on the same freshness `cmd_swap` does) → `poolFor(read, rec.project)`. If `body.crossPool === true`: `capSupported(fleetState, POOLS_CAP)` or 501 `unsupported` (refuse on no evidence — a mis-bound flag on an old `ccd` is the silent-success class), then `CCD_ARGV.swapCross(id, wrapper)`. Else `poolVerdict`: `pool-mismatch` → **409** `{ ok:false, error:'pool-mismatch', accountPool, projectPool }` (the established "refused, overridable" shape); `pool-undecidable` → **503** `{ error:'pool-unreadable', state }`; ok → `CCD_ARGV.swap`. Sessions route: identical over `body.project`/`body.wrapper` with `startCross`/`enableCross`, **and creation-only**: a registry hit for `<wrapper>-<project>` means revival, so the plain argv passes through and `ccd` applies ruling 5 (mirror of §5.5.5's `cmd_start` fix). Builders in `CCD_ARGV` (`ccdargv.ts:180`): `swapCross`, `startCross`, `enableCross` with a **leading** `--cross-pool` — a trailing flag on an old `ccd`'s `start w p wd` would be a silently ignored fourth positional, while a leading one dies at `_is_valid_wrapper` (loud). `export const POOLS_CAP = 'pools-v1'` beside `ACTOR_FLAGS_CAP`. Both routes are non-EXEMPT in `auth/gate.ts`, so armed, the override sits behind the session gate — this design rules that sufficient authorization for a cross-pool tap.

### 5.7 The override — `--cross-pool`, distinct from `--force`, and the marker that makes it stick

#### 5.7.1 Why a distinct token

`--force` means "accept transcript loss" (`cmd_swap` `:13046-13049`, `:13100-13108`). Overloading it would make a transcript-loss acceptance also a pool crossing, or vice versa. `--cross-pool` is stripped by the four verbs, rejected as a wrapper by `_is_valid_wrapper`, rides the detach arm, and is journalled as `meas.crosspool 1`.

#### 5.7.2 The marker — ruling 8

Without it, the design's own mechanisms undo every crossing: the re-seed rewrites `.home` on the next 5 s tick, `_swap_target`'s `force=pool` treats the crossed account as a must-leave, and the affinity arm moves the session back at the next idle boundary — `prefer --cross-pool` would be a no-op within 5 s (adversarial finding, severe).

`$REG/<id>.crosspool = "<epoch> <project-pool-at-crossing> <account>"` — one dot-free field, so `_reg_purge`'s one-dot rule (`:1294`) purges it with the row; written by `cmd_swap --cross-pool` (success tail), `cmd_start --cross-pool` (creation) and `cmd_prefer --cross-pool` (beside the `.home` write). Registry field inventory comment (`:1316-1320`) gains it.

**Validity**, evaluated by `_auto_swap_check` each tick before the re-seed: the marker is valid while `_project_pool_state "$project"` still reads `named <stored-pool>` **and** the stored account equals the current `wrapper` (a `swap`/`start` crossing) **or** the current `home` (a `prefer` crossing). While valid: the re-seed does not rewrite `.home`; `_swap_target` does not set `force=pool` for the crossed `cur` and the home guard admits the crossed home; `cmd_swap`'s in-unit guard (§5.8.4) does not refuse a target equal to the stored account. The candidate loop **stays pool-filtered** in every case, so any automatic move lands in-pool and, by the account clause, ends the crossing. When validity fails — a retag, an untag, a move off the account — the tick removes the marker and writes one `swap.log` line `crosspool-ended <id>: <reason>`. Under the interpretation in §2, a `swap --cross-pool` session still returns home when home recovers, exactly as today; that return is a move off the account and ends the crossing.

Every crossing writes one `swap.log` line `cross-pool <id>: <cur> -> <target> [project=<p> pool=<pp> target-pool=<ap>]`.

### 5.8 The strand — ruling 6

#### 5.8.1 The marker

`$REG/<id>.stranded = "<epoch> <reason>"` (the `swapblocked` shape), written by `_strand_mark <id> <wrapper> <project>` (new, beside `_swap_refuse` `:12883`) at the one place the information is discarded today (§3.2): `hard_blocked` set and `_swap_target` empty — **regardless of whether the project is tagged**, so the pre-existing all-at-ceiling strand becomes loud too. Write-once while it stands: presence is the debounce, so a 5 s tick cannot spam. One `swap.log` line `stranded <id>: <w> (blocked) -> nowhere [pool=<p|->] (<why>)` and one `notify.sh` banner `cc swap STRANDED: <id> is blocked on <w> and no account in pool <p|(untagged)> can take it — <why>` (deliberately not matching the per-session `moved` regex; the server's `/api/notify` emits it fleet-wide). `_strand_why` walks `$(_pool_for "$id")` — the set the decision was actually about, not the whole roster — and annotates each candidate with the first failing predicate in loop order: `pool=<name>`, `disabled`/`missing`, `limit`, or `tag:<unreadable|malformed> $POOLS_DIR/<p>` when the state was undecidable. No `lastswap` stamp, so ruling 6's auto-resume needs no new code: the first tick on which an in-pool candidate passes `_account_ok` and `_avail` goes straight down the rescue arm (verified).

#### 5.8.2 Clearing, and the two floors

```bash
_strand_clear() { [[ -e "$REG/$1.stranded" ]] || return 0; rm -f -- "$REG/$1.stranded"; echo "$(date '+%F %T') unstranded $1" >> "$REG/swap.log"; }
```

The `-e` test is load-bearing: the clear is called on every healthy tick, and without it ~20 sessions would write ~240 `unstranded` lines a minute (adversarial finding, moderate). Clear sites: a healthy pane (§5.5.4 step 3); `_swap_target` answering a destination; `cmd_swap`'s success tail beside `rm -f swapblocked` (`:13139`); revival in `cmd_start` (`:12222`) and inside `cmd_ensure`'s two-guard block (`:12324`). **Notify floor**: `_pane_hard_blocked` greps the last eight pane lines, so a scrolling banner can flip `hard_blocked` per tick; each flip is a legitimate mark→clear→mark. The marker follows the truth; the **banner** is suppressed when `$REG/<id>.strandnotify` (epoch of the last banner, one dot-free field) is younger than `SWAPBLOCK_COOLDOWN` — the same 1800 s floor the refusal channel already carries ("one refusal would produce 720 banners an hour", `:11218-11222`). Test: ten alternating blocked/clear ticks → one notify line.

#### 5.8.3 Server and PWA

`SessionRecord.stranded` read with `fieldMeasured` (`server/src/registry.ts:359`) **fail-shut**: absent → `null`; `ok` → `packedStamp`, empty rest → `STRANDED_NO_REASON`; unreadable → `{ at: 0, reason: STRANDED_UNREADABLE }` (the `substrate` arm's idiom) — "not stranded" over a flagged row is the destructive direction. `FleetSession.stranded: { at, reason } | null` after `swapBlocked` (`shared/api.ts:181`), additive, revived by `reviveStranded` with `reviveSwapBlocked`'s exact contract (absent → null, malformed → reject the session), documented as an axis not a state. PWA: `.sess-stranded` cell beside `.sess-swapblocked` in `SessionLine` (reason verbatim in `title`; suppressed on a `dead` row like `away`), `N stranded` on `ProjectCard` via a new `groupFleet` count, styled with the warn colour — this is the loud cell.

#### 5.8.4 The deploy-window strand, and `CCD_SWAP_AUTO=1`

`_dispatch_swap` runs the **on-disk** `ccd` (`:11001`) while the supervisor that chose the target keeps the pre-deploy inode (§3.8). An old pool-blind `_swap_target` picks the cheapest account regardless of pool; `_auto_swap_check` stamps `lastswap` first (`:11259/:11293`); the **new** `cmd_swap` in the unit dies `pool-mismatch` — stderr into `swap.log`, exit 1, no marker, no notify, `lastswap` not cleared — and the same choice repeats every 900 s for as long as that supervisor lives, which `deploy.sh` says can be days, while the session sits hard-blocked. A hand `install_atomic` with no sweep produces the same. This is a silent strand of exactly the class ruling 6 forbids, and `_strand_mark` never fires because the old supervisor does not have it (adversarial finding, severe; P-14).

Fix: `_dispatch_swap` sets `CCD_SWAP_AUTO=1` in the unit's `bash -c` environment (dynamically visible like `CCD_SWAP_DETACHED`). In `cmd_swap`'s pool guard, when `CCD_SWAP_AUTO=1` and no `--cross-pool` and no valid crossing marker for that target, call `_strand_mark "$id" "$cur" "$project"` (marker, one line, one banner, floor-debounced) before `exit 1`. `lastswap` stays stamped — the storm argument stands. The next successful swap after the sweep clears it at the success tail. The pre-filter in `_swap_target` and the guard in `cmd_swap` call the **same** predicate, so after the sweep they can disagree only across a retag racing a dispatched unit's ≤120 s jitter — accepted and ledgered (P-8).

### 5.9 Wire discipline, in one place

Additive fields only, no `FLEET_PROTO` bump, one reader per field: `RosterWire.pool` (reader `accountPool`), `ProjectRow.pool?` and `ProjectRow.placement?` (absent = older server = unknown; the PWA never flags untagged on absence), the `pools` frame (an old PWA's `asFleetMsg` drops an unknown type), `FleetHealth.projectPools?`, `FleetSession.stranded` (`reviveStranded`). Nothing about pools is persisted server-side or in the PWA offline snapshot. A session's project pool is **derived** in the PWA from the frame by project name — never carried per session, never revived.

### 5.10 PWA surfaces

| Surface | Change |
|---|---|
| `ProjectCard` | `proj-card-pool` chip beside `proj-card-pin` (`pwa/src/fleet/ProjectCard.tsx:242`): the name; a flagged **no pool** chip for a measured `untagged` (ruling 3's worklist); distinct warning chips with distinct aria-labels for `malformed` and `unreadable`, each carrying the full path `~/.cc-sessions/pools/<project>`; dimmed with "fleet ccd predates pools" under `enforcement: 'unavailable'`; **nothing** when the frame has not arrived or the server is older. `N stranded` cell. Tap → `PoolSheet`. The `addLabel` copy names in-pool labels ("nothing in pool X is placeable — <labels> all disabled") via `poolLabelList`, never "all accounts". |
| `PoolSheet` (new) | The `SwapSheet` shape. Options = **distinct** `RosterWire[].pool` values plus "none", derived at render (no pool-name list in source). Posts `{pool}`; toasts `warning: 'unknown-pool'`; renders the measured `pool` from the 200 and settles on the next `pools` frame. Creating a brand-new pool name no account carries is a shell-only act — a free-text field is the shortest path to the empty-pool strand. |
| `SwapSheet` | `splitByPool(roster, pickableWrappers(…), projectPool)` → eligible rows shown; a **show other pools (N)** disclosure reveals the crossing rows, each with a `pool · <name>` chip; picking one sets `cross`; the confirm sentence names the crossing; `api.swap(id, w, {crossPool: true})` only then — an eligible pick posts the byte-identical `{wrapper}` body. Unknown project pool (older server, `unreadable`) → **all** rows, no disclosure, a one-line "pool not known from here" note: hiding on unknown would be inventing a rule. |
| `NewSessionSheet` | Step 2 splits projects by `ProjectRow.pool` against `accountPool(roster, wrapper)`; mismatched under the same disclosure; `createSession({…, crossPool: true})` for those. |
| `SessionLine` | `.sess-stranded` cell; computed `data-offpool` on `.sess-acct` when the session's account pool and its project's pool (from the frame) are both known and differ — aria "running on X (pool A), project is pool B". This is the visible state of a session waiting on a cooldown gate or a hold. |
| `FleetHostBanner` | An arm on `health.projectPools === 'unavailable'`: "the fleet host's ccd does not honour project pools yet — redeploy the agent lane". Silent on `unknown`. |
| `api.ts` | `setProjectPool`, `swap(id, w, opts?)`, `createSession` with `crossPool`; `API_ERROR_TEXT` gains `pool-mismatch`, `pool-unreadable`, `bad-pool-name`; 501 already renders `UNSUPPORTED_VERB_TEXT`. |
| `stores/fleet.ts` | `pools` slot (null = unknown, never persisted) and a `case 'pools'` frame handler. |

### 5.11 Version skew and deploy order

**Agent-first is mandatory** (this touches `ccd/`). Within one agent deploy: roster (`accounts.sh`) before `ccd`, then the agent restart (a fresh `ready` carries the new `rosterFp` and `ccdVerbs` including `project-pool` and `pools-v1`), then the supervisor sweep behind the `KillMode=process` preflight. Remote servers see the new caps within `CAPS_REFRESH_MS` = 60 s (`watch.ts:171`); local mode measures once at boot.

| State | Behaviour |
|---|---|
| New server, old `ccd` | Tag route 501 (`verbSupported`); `crossPool: true` 501 (`capSupported`); hand-written tags **display** with `enforcement: 'unavailable'` (chips dimmed, banner up) while nothing on the fleet enforces them; the server's 409 pre-check still refuses mismatched PWA swaps by its own roster and the tag it reads — a refusal, never a wrong placement; `rosterAgreement: divergent` if the server's roster has pools (its generator emits `_ccrc_pool`, the fleet's file does not) — true, with the right remedy. |
| Old agent (no `ccdVerbs`), new server, new `ccd` | `ccdVerbs === null` → the route proceeds; the old agent's whitelist lacks the grant → `forbidden` → 502 for every tag write. Closed inside one deploy run by the agent-first ordering. |
| New `ccd`, old server | `ccd` enforces everywhere and strands loudly; the old server's PWA sends plain `swap id w` and a mismatch dies `pool-mismatch:` → 502 with `ccd`'s sentence; no PWA override until the server ships; old `parseRoster` warns-and-drops `pool`; `projected` may name an account `ws-add` then declines in favour of an in-pool one (forecast wrong, act right); `rehome` ingests as `unknown` with `badact` preserved; `.stranded` visible only in `swap.log`/notify until the server deploys. |
| New `ccd`, old `accounts.sh` | `declare -F _ccrc_pool` fails → every account untagged → today's behaviour, no noise. |
| Mid-deploy (old supervisor inode, new on-disk `ccd`) | Tags bind new placements and manual verbs at once; running sessions' auto-swapper is the old code until each unit restarts; the in-unit refusal is **loud** (§5.8.4). One deploy long. |
| Two `accounts.json` copies disagree | `rosterAgreement: divergent` → banner + doctor FAIL — the detection the emission exists for. Meanwhile `ccd` enforces the fleet copy, the server 409s by the server copy; a move one side allows and the other refuses is loud in either direction. The project tag has one copy and cannot skew. |
| Old PWA bundle | Ignores the new keys, keeps sending `{wrapper}`; the server now 409s a mismatch with a slug the old bundle toasts raw — legible, not silent. |

`echo pools-v1` in `cmd_caps` after `:4804`; `KNOWN_CAPABILITY_TOKENS` gains it; `caps-token-shape.test.ts` covers it by derivation. The **one** server decision the token gates is "may I build a `--cross-pool` argv". The tag route is gated by the verb's presence. The 409 pre-check and the forecast are the server's own decisions over data it reads and are not gated.

---

## 6. Seam contracts — the "seams" lens, answered by the author (ruling 9)

Every seam, what crosses it, and why no two conditions a caller handles differently share a value.

| Seam | Carrier | Conditions kept distinct | Where a collapse would have been |
|---|---|---|---|
| `_ccrc_pool <id>` → `_acct_pool` | stdout | name / empty | Empty folds *untagged* and *unknown id*; accepted because `_is_valid_wrapper` gates every id before any pool question is asked. Documented in the generator. |
| `_project_pool_state <p>` → callers | one word | `named <n>` / `untagged` / `unreadable` / `malformed` | The panel's rc-based reader (0/1/2 plus caller grammar) split the fourth state across two functions; a `$(…)` capture that forgot `$?` read unreadable as empty = untagged. Word answer, always rc 0. |
| `_pool_ok <w> <state>` → deciders | rc | 0 serve / 1 mismatch / 2 undecidable | A boolean would fold undecidable into one side. Callers branch three ways. |
| `_ws_least_loaded [p]` → `cmd_ws_add` | stdout | placement / empty | Empty is *both* "all at ceiling" and "undecidable tag" — an overload at this seam, resolved by the caller re-reading the state to name the reason in its refusal loop. Recorded (P-13). |
| `_swap_target` → `_auto_swap_check` | stdout | destination / empty | Pre-existing overload ("stay, fine" vs "must leave, nowhere"), resolved by the caller on `$hard_blocked`; not widened here (P-10). |
| `.stranded` → `SessionRecord.stranded` | `fieldMeasured` | null / `{at, reason}` / `{at:0, reason: STRANDED_UNREADABLE}` | `field()` would fold unreadable into absent = "not stranded". |
| `.crosspool` validity | tick-evaluated | valid / invalid → removed + logged | A never-removed marker would make a stale crossing indistinguishable from a live one; the account clause makes any move end it. |
| `readProjectPools` → `poolFor` | `ProjectPoolsRead` | `listed:false` / `listed:true` + Map | `readdir`'s null folds absent and unlistable; the parent listing splits them one level up. Residual: `pools` present at the root but a regular file → `listed:false` → every project `unreadable` — correct polarity, disclosed. |
| `poolVerdict` | union | ok(4 whys) / mismatch / undecidable(2 states) | `unreadable` must never permit or refuse — 503, `unmeasurable`. |
| Routes | HTTP | 400 shape / 400 grammar / 404 / 409 mismatch / 501 skew / 502 ccd / 503 undecidable / 200 measured | `requested` on the 200 would echo intent, not state. |
| `ProjectRow.pool?` | wire | absent (older server) / four states | `pool ?? {state:'untagged'}` in the PWA would flag every project on a pre-upgrade server. |
| `pools` frame `enforcement` | wire | enforced / unavailable / unknown | Two states would make "we cannot tell" look like one of the other two. |
| `RosterWire.pool` | wire | string / null; key absent → null via the single reader | An older server omitting the key is untagged, correctly permissive. |
| `.strandnotify` | epoch field | banner suppressed / allowed | Suppressing the *marker* would hide the truth; only the banner is floored. |

**Two-decider agreement.** `ccd` and the server read the **same file** at request-time freshness for the project pool, and different **copies** of the roster for the account pool (§3.3). Disagreement on the account side is detected by `rosterAgreement` and is loud in both directions (409 with a slug, or 502 with `ccd`'s sentence). The server never places — it refuses or forecasts — so no disagreement can produce a wrong placement.

---

## 7. Data flow walkthroughs

**Retag from the phone.** Tap card → `PoolSheet` → `POST /api/projects/demo/pool {pool:'pool-a'}` → 400 checks → `verbSupported` → `CCD_ARGV.projectPoolSet` → agent `isExecAllowed` (`['project-pool','--project']`) → `ccd project-pool --project demo --pool pool-a` → `_ws_project_valid`, grammar, existence, `mkdir -p pools`, tmp + rename, `swap.log pool-tag` line → route re-reads `$REG/pools/demo` through the agent → `200 {ok, pool:{state:'tagged', name:'pool-a'}}` → next 2 s tick emits the `pools` frame → chip. Within one 5 s tick each session of `demo` whose `.home` fails `_pool_ok` is re-seeded to `_ws_least_loaded demo` and journals `rehome`; each whose `wrapper` fails it shows `data-offpool` and moves at its next idle boundary once its cooldown gates open (`auto-pool` line), or at once if hard-blocked (`auto-rescue`), or after release if held.

**Auto-swap tick, tagged project, wrong-pool current.** `_auto_swap_check` → re-seed (if needed) → gates → `_pane_hard_blocked` → `_swap_target` with `force=pool` → candidate loop filtered → destination → `lastswap` stamp → `_dispatch_swap` (`CCD_SWAP_AUTO=1`) → new `cmd_swap` re-checks the same predicate → carry → success tail clears `.stranded`, writes `_lc_done swap`.

**Manual swap from the PWA to a mismatched account.** Default sheet hides it. Operator opens "show other pools", picks, confirms the sentence naming the crossing → `POST …/swap {wrapper, crossPool:true}` → `capSupported(POOLS_CAP)` → `swapCross` → `ccd swap --cross-pool id w` → guard passes → carry → success tail writes `.crosspool`, `cross-pool` line, `meas.crosspool 1`. Later, home recovers → affinity arm returns the session home → the account clause invalidates the marker → `crosspool-ended`. Without the disclosure a plain `{wrapper}` for that account gets **409 `pool-mismatch`** and the PWA toasts the sentence.

**Pool empty.** Every in-pool account disabled or at ceiling; session hard-blocked → `_swap_target` empty → `_strand_mark` → `.stranded`, one `stranded` line, one banner (floored) → PWA cell + `N stranded` → operator enables a lane or tags another account into the pool → next tick's rescue arm moves it → `_strand_clear` → `unstranded`. Fresh `ws-add` into that pool dies naming the pool and the remedies, touching nothing; the coordinator's dispatch sees `!res.ok` with that stderr.

**Unreadable tag.** `chmod 000 pools/demo` by mistake → `ccd`: creation dies naming the path; the auto-swapper holds and marks a strand only if hard-blocked, with `tag:unreadable` in the reason → server: `poolFor` → `unreadable` → 503 on swap/start, `placement: unmeasurable`, warning chip with the path → doctor FAIL `pools-unreadable demo`. Nobody decides, nobody crosses.

---

## 8. Ring placement and invariants

| Component | Ring | Constraint |
|---|---|---|
| `shared/roster.ts` `POOL_NAME_RE`, `AccountDef.pool`; `shared/api.ts` wire types; `shared/lifecycle.ts` entry | L0 | import nothing, not even `node:*` (the PWA bundles them) |
| `shared/generate.mjs`, `shared/roster-json.mjs` | deploy-side mirrors | may use `node:*`; stricter-never-laxer than `parseRoster` |
| `server/src/poolrule.ts` | **L1** | pure decisions; type-only imports; purity-scanned |
| `server/src/pools.ts` | L3 | `FleetIO` + `node:path`; **may not narrow** — four states in, four states out |
| `server/src/limits.ts` `projectHome` | L3/L4 | composes `poolEligible`; decides nothing new |
| `server/src/registry.ts` `stranded` | L3 | `fieldMeasured`, fail-shut arm |
| `server/src/server.ts` routes, `server/src/watch.ts` frame | L4 | own fastify/timers; call `poolVerdict`, never re-derive it |
| `ccd/ccd`, `ccd/ccrc-doctor-checks` | fleet shell | outside the ring model; **agent-first** |
| `agent/src/whitelist.ts` grant | agent | two-token prefix, enrolled; write root unchanged |
| PWA | display | `accountPool`/`splitByPool` are the only readers; no second derivation of eligibility |

**Single definition.** Pool-name grammar: one TS regex (`shared/roster.ts`), one bash literal (`ccd/ccd`), pinned equal by text extraction. Directory name: `POOLS_DIR_NAME` (TS) and `POOLS_DIR=` (bash), pinned the same way plus a fixture-HOME round trip. Pool-rule truth table: one fixture file, three consumers. No pool name, account id or label in any shipped source or test.

**No overloaded null at a seam** — §6 is the census.

---

## 9. Artifact lifecycle declarations

`docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md` §1.2 makes an unassigned artifact class a defect.

| Class | Root | Pattern | Creators | Collector | Bound | Tier |
|---|---|---|---|---|---|---|
| `project-pool-tag` | `~/.cc-sessions/pools/<project>` | **O** | `ccd project-pool`; operator shell | *none* — ruling required | until cleared | <64 bytes per tagged project, one file per project |
| `session-stranded` | `$REG/<id>.stranded` | per-id field | `_strand_mark` | `_strand_clear`; `_reg_purge` with the row | while stranded | <128 bytes |
| `session-strandnotify` | `$REG/<id>.strandnotify` | per-id field | `_strand_mark` | `_reg_purge` with the row | row lifetime | <16 bytes |
| `session-crosspool` | `$REG/<id>.crosspool` | per-id field | the three override verbs | the tick on invalidity; `_reg_purge` with the row | while valid | <96 bytes |

**Ruling for `project-pool-tag`** (proposed text for the manifest): *"Operator intent on the record: persists until `ccd project-pool --project <p> --clear` or `rm`. A tag whose project directory and registry rows are both gone is inert — no lane reads it — and `ccrc doctor` lists it as WARN `pools-stale`."* `lifecycle.test.ts` requires a non-empty ruling wherever `collector` is null.

The three per-id fields need no manifest entry of their own: they are registry fields under the one-dot rule and purge with the row, like `swapblocked` and `lastswap`. `ccrc uninstall` removes named files only and leaves `pools/` in place, like `-disabled` markers — operator intent survives an uninstall (verified against `ccd/ccrc`'s `_uninst_cc_sessions`).

---

## 10. Failure modes and guards

| Failure | Guard |
|---|---|
| Tag silently lifted because a read failed | Four-word reader; `_pool_ok` rc 2; `readFileMeasured`; `unreadable ≠ untagged` pinned on both sides |
| A legacy row without `.project` resolves to the `pools/` directory → EISDIR → fail-shut strand | `[[ -n "$1" ]] || untagged` in the reader (§5.4.3) |
| Marker collides with a session id's fields | Dotless subdirectory; the `acct-a-demo` collision test (§11 row 9) |
| Hand-typed tag with two tokens or uppercase | `malformed`; creation refuses naming the file; doctor FAIL; the verb cannot write it |
| Pool named that no account carries | Route `warning: 'unknown-pool'`; verb stderr; doctor WARN `pools-orphan-pool`; strand is loud when it bites |
| Project directory renamed or removed | Tag orphaned; doctor WARN `pools-stale`; running sessions stay constrained under the registry's old `project` string (the safer direction); `--clear` never checks existence |
| Crossing undone by the pool machinery | `.crosspool` marker with validity (§5.7.2) |
| `cmd_start` refuses a revival, or revives wrong-pool unchecked | Guard after the registry-wins block, creation-only; server mirrors (§5.5.5, §5.6) |
| `cmd_enable` journals a flag as an id | Strip before `_id` |
| In-unit refusal during the deploy window strands silently for days | `CCD_SWAP_AUTO=1` + `_strand_mark` in `cmd_swap`'s guard (§5.8.4) |
| `unstranded` spam on every healthy tick | `_strand_clear` tests `-e` first; byte-identical `swap.log` over ten ticks pinned |
| Banner storm from a scrolling limit banner | `.strandnotify` floor at `SWAPBLOCK_COOLDOWN`; marker unfloored |
| Supervisor re-entering its unit erases the strand and re-banners | Clear inside the `CCD_IN_UNIT` guard |
| Two `cross-pool` log lines per crossing | Log at the success tail only |
| `_strand_why` names accounts that were never candidates | Walks `_pool_for`, not `CCRC_ACCOUNTS` |
| A hand-set registry `pool` list bypasses the filter | Filter inside `_swap_target`'s loop after `_pool_for` |
| `--force` accepted as the override | Guard tests `$cross` only; `--force`-alone-to-other-pool still dies |
| Old `ccd` mis-binds `--cross-pool` | Leading flag + `capSupported` gate; `_is_valid_wrapper` second lock |
| Tag route grant grows wider than two tokens | `REQUIRED_VERB_FLAG` enrolment; g10 bypass fixture must not compile |
| Server writes the marker in some future refactor | `checkPath('<REG>/pools/x', 'write') === null` pinned; remote-mode isolation pin |
| PWA flags untagged on an older server | `pool` undefined renders nothing; pinned |
| A cached tag renders as live policy | Nothing pooled is persisted; store slot null on load |
| Retag under a hold or a cooldown looks stuck | `data-offpool` marker; §5.5.4 timing documented in README |
| Retag racing an in-flight `ws-add` | Placement lands wrong-pool; ruling 5 moves it at the next boundary; the verb deliberately does not take the ws-add lock |
| Registry root unlistable | Every project `unreadable` on the PWA (silent chips) while `ccd` keeps enforcing locally; `readRegistryMeasured` already logs the collapse on entry/exit |
| Pool names typed into source | `single-definition` and `topology-clean` residue scans; fixtures use `pool-a`/`pool-b` |

---

## 11. Test plan — mutation-table discipline

*A comment is a request; a red suite is a mechanism.* Every guard ships with a test measured RED before and GREEN after, red first. Fixture HOMEs only (`makeCcdHarness`), never the live `$HOME`. `_swap_target` and `_auto_swap_check` stay **real** in the pool suites; only tmux, `_dispatch_swap`, `_avail` and `notify.sh` are stubbed (the `ccd-auto-swap-hold.test.ts` shape).

| # | Guard | Test | Goes red when |
|---|---|---|---|
| 1 | `parseRoster` refuses invalid `pool` | `roster.test.ts` (the `hidden` trio's template) | the throw or `POOL_NAME_RE.test` is deleted |
| 2 | `roster-json.mjs` mirrors `pool` and `hidden` | `gen-accounts.test.ts` REJECT rows `pool:'Corp'`, `''`, `7`, `'a$(id)'`, `hidden:'false'` — CLI exits non-zero, writes no bash | either `bad()` is deleted (the `hidden` row is red on `main` today) |
| 3 | `_ccrc_pool` emitted, arms for tagged only, always defined | `roster-generate.test.ts` | emission removed, made conditional, or an untagged account gets an arm |
| 4 | CLI and TS generator agree byte-for-byte with pools | `gen-accounts.test.ts` ACCEPT row `POOLED_ROSTER` | `roster-json.mjs` stops returning `pool` |
| 5 | Bash literals equal TS literals | **new** `pool-name-parity.test.ts`: extract the one `POOL_NAME_RE=` and one `POOLS_DIR=` from `ccd/ccd` (assert exactly one occurrence each), compare to `POOL_NAME_RE.source` and `POOLS_DIR_NAME` (the `CCRC_RC_FILE` extraction precedent, `single-definition.test.ts`) | either literal drifts or is duplicated |
| 6 | `_pool_ok` = "either untagged or equal", rc 2 on undecidable | `ccd-pool-ok.test.ts` over `POOL_RULE_CASES` | any disjunct removed, comparison inverted, or `*)` arm returns 0/1 |
| 7 | The same rule in L1 and in the PWA | `pools.test.ts` `poolVerdict` over the same table; `pwa/test/accounts-pool.test.ts` `splitByPool` over the same table; fixture-count floor `>= N` with at least one reject per rule | either drifts, or a fixture class is deleted |
| 8 | `poolrule.ts` is pure L1 | purity scan copied from `coord-caps-policy.test.ts:124-172` | a value import, `Date.now`, or `reply` appears |
| 9 | Marker namespace cannot collide | `ccd-project-pool.test.ts`: project `acct-a-demo` tagged while session `acct-a-demo` exists → `_pool_for` returns the default pool, `_reg_purge` and `forget` leave the tag byte-identical; project `pools` with session `pools-quiet-basin` → `_ws_slug_free`, `_reg_purge` unaffected | the marker is relocated to `$REG/<project>.<anything>` |
| 10 | Four-word reader, never dies | `ccd-project-pool.test.ts`: absent → `untagged`; `chmod 000` → `unreadable` (skip as root); directory at the path → `unreadable`; `Corp orate` → `malformed`; `printf 'pool-a\n'` → `named pool-a`; empty project → `untagged`; sourced with `die() { echo DIED; exit 99; }` → never `DIED` | any arm folds into another; the `-n "$1"` guard is removed; a `die` is introduced |
| 11 | Verb validates before touching the filesystem | `--project ../x`, `.hidden`, `'a b'`, `''` all die with no file anywhere under `$HOME` | `_ws_project_valid` call removed |
| 12 | Checked write/unlink polarity | read-only `pools/` → `--pool` exits non-zero with `NOT tagged`; undeletable file → `--clear` says `STILL tagged` | either `|| die` removed |
| 13 | `--clear` idempotent, existence-free | twice on an absent tag → 0; on a project with no dir and no row → 0 and the file is gone | existence check applied to `--clear` |
| 14 | Written bytes have no newline; shell newline tolerated | byte assertion after the verb; `echo` then read | writer switches to `echo`; reader drops the strip |
| 15 | Two-token grant is really two tokens | g10 bypass fixture `[['start'],['project-pool']]` must not compile (`whitelist-structural.test.ts` `EXPECTED`); `isExecAllowed('ccd',['project-pool','demo'])` false | enrolment removed |
| 16 | Every built argv is admitted; every grant is reachable | `whitelist-subset.test.ts` layers 2/3 with `projectPoolSet`, `projectPoolClear`, `swapCross`, `startCross`, `enableCross` in `SAMPLES` | a grant or builder is deleted; a sample omitted (tsc) |
| 17 | Server never writes the marker; remote mode ignores the server box | `agent/test/whitelist.test.ts` `checkPath('<home>/.cc-sessions/pools/demo','write') === null`; a `pools/` planted in the server box's own `~/.cc-sessions` is invisible under `CCRC_FLEET=remote` | write root widened; a `localIO` shortcut introduced |
| 18 | Tag route gated on the verb; caps parity | `verb-gate.test.ts` named pin gains `project-pool`; `project-pool-route.test.ts` 501 case; `ccd-archive.test.ts` caps ↔ dispatcher equality | `verbSupported(` literal removed; heredoc or dispatcher arm missing |
| 19 | Route answers a measured state | stub runner that writes nothing → `200 {pool:{state:'untagged'}}`; a runner that writes → `tagged` | the route echoes `requested` |
| 20 | Absent dir = untagged, unlistable = unreadable | `project-pools-read.test.ts`: root names without `pools` → all untagged; root names with `pools` but `readdir` null (regular file planted) → all `unreadable`; root null → `listed:false`; dot-leading skipped; `absent` mid-read skipped | the `rootNames.includes('pools')` gate is deleted, or the null-readdir arm returns an empty map |
| 21 | `GET /api/projects` composes `pool` and `placement`; `listProjects` stays pool-free | `lifecycle.test.ts` new cases mirroring its `readiness` pair | composition moved into `listProjects` or dropped |
| 22 | `pools` frame additive, change-only | two identical ticks → one frame; a change → a second; `FLEET_PROTO` untouched | byte-equality guard deleted; proto bumped |
| 23 | Health carries enforcement; banner arms on `unavailable` only | `fleet-health` cases; `FleetHostBanner` test | derivation folds a state; banner shows on `unknown` |
| 24 | PWA never flags untagged on absence | `project-card.test.tsx`: `pool` undefined → nothing; `{state:'untagged'}` → flag; `malformed` vs `unreadable` aria differ and carry the path | `pool ?? untagged` default |
| 25 | `PoolSheet` derives options | roster `a,b,a` → `a,b,none`; posts `{pool:null}` for none | a list is enumerated |
| 26 | `SwapSheet` hides mismatched, crossing explicit on the wire; unknown never hides | `swap-sheet.test.tsx`: default rows exclude other-pool; disclosure reveals with chips; confirm posts `{wrapper, crossPool:true}`; eligible pick posts byte-identical `{wrapper}`; unknown → all rows, no disclosure, note | split removed; `crossPool:true` on an eligible pick; null treated as a pool |
| 27 | Route census literals | `auth-gate.test.ts` `scanRoutes('server.ts').length` and `ROUTES.length` each +1; `gate.ts:8` prose count +1 (measure at implementation, do not copy these words) | the new route is registered without them |
| 28 | `_ws_least_loaded <p>` skips other-pool lanes and `projectHome` agrees; zero-arg unchanged | `projected-home.test.ts` fixture cases `pool-filters-cheapest`, `untagged-account-serves-tagged-project`, `tagged-account-serves-untagged-project`, `pool-empty-all-disabled`; existing zero-arg assertions | either side drops the filter; positional made required |
| 29 | `cmd_ws_add` refuses pool-empty and undecidable naming the reason, touching nothing | `ccd-pool-ok.test.ts` | reason arm removed; `"$project"` not passed |
| 30 | `_swap_target`: wrong-pool cur is must-leave; never returns to wrong-pool home; loop filtered after `_pool_for` | mirrors of `ccd-limits.test.ts`'s force matrix and `:219`; a registry `pool` list naming an other-pool wrapper still cannot land | any of the three insertions deleted or the filter moved into `_default_pool` |
| 31 | Re-seed within one tick, journals `rehome`, writes a first `.home` | `ccd-auto-swap-pool.test.ts` (a) | block deleted; uses `_ws_seed_home`; omits `_lc_done` |
| 32 | `rehome` in both vocabularies | `lifecycle-vocabulary.test.ts`; TS2739 on `ACT_WORD`/`LIFECYCLE_ACT_MAP` | either side lacks it |
| 33 | Retag moves on the affinity arm (hold defers) with verb `auto-pool`; hard-blocked rescues | `ccd-auto-swap-pool.test.ts` (b)(c) with the hold fixture | hold rung moved; verb stays `auto-home` |
| 34 | Strand once, notify once, clear on recovery, fires when untagged | (d)(e)(f): ten ticks → one `.stranded`, one notify line, one `stranded` line; pane clear → `unstranded`; untagged all-at-ceiling → stranded | debounce removed; clear removed; mark gated on a tag |
| 35 | No `unstranded` spam | ten ticks on a healthy never-stranded session → `swap.log` byte-identical | `-e` test removed from `_strand_clear` |
| 36 | Banner floor | ten alternating blocked/clear ticks → one notify line, marker toggles each time | `.strandnotify` check removed |
| 37 | Strand cleared by swap success and revival, not by the supervisor re-entering | `cmd_swap` tail; `cmd_start`; `cmd_ensure`; `CCD_IN_UNIT=1 cmd_ensure` keeps it | `rm -f` placed outside the two-guard block or omitted at the tail |
| 38 | `_strand_why` walks the candidate set | reason names only `_pool_for` members with the first failing predicate | walks `CCRC_ACCOUNTS` |
| 39 | Strand reads fail-shut on the server | `registry.test.ts`: unreadable → `STRANDED_UNREADABLE`, never null; field-count assertion updated | `field()` used; unreadable arm returns null |
| 40 | `FleetSession.stranded` additive | revive tests (the `swapBlocked` twin) | tolerates malformed or becomes required-on-read |
| 41 | `cmd_swap` refuses cross-pool before the detach arm; flag rides the detached retry; logs once | die text starts `pool-mismatch:`; with the flag: one `cross-pool` line, `crosspool` on the lifecycle row, `--cross-pool` in the `systemd-run` command line | guard moved below the detach arm; `${cross:+…}` dropped; line logged at the guard |
| 42 | `--force` alone does not cross | `swap --force` to an other-pool target still dies `pool-mismatch` | guard tests `$force` |
| 43 | `cmd_start` creation-only guard; `cmd_enable` strips before `_id`; `cmd_prefer` guards and journals | creating-form die; revival with wrong-pool `regw` proceeds with a warn; `enable --cross-pool w p` journals for id `w-p`; `prefer` writes `rehome` | guard before the registry-wins block; strip after `_id`; journal omitted |
| 44 | Crossing marker: written by the three verbs, exempts the row, invalidated by retag or move, auto moves never cross | `ccd-crosspool.test.ts`: after `swap --cross-pool` ten ticks leave `.home` and `wrapper` unchanged; a retag removes the marker and logs `crosspool-ended`; a rescue lands in-pool and ends it; `prefer --cross-pool` survives the re-seed | re-seed ignores the marker; validity omits the account clause; loop filter relaxed |
| 45 | In-unit refusal is loud | `_dispatch_swap` stubbed to run `cmd_swap` in-process with `CCD_SWAP_AUTO=1` against a wrong-pool target → `.stranded` present, one notify line, `lastswap` still stamped | `_strand_mark` call removed from the guard; `CCD_SWAP_AUTO` unset in the unit |
| 46 | Server 409s a mismatch and does not call `ccd`; 503 on undecidable; revival passes through; `crossPool` gated by `pools-v1` | `swap-route-pool.test.ts`: 409 body; `runCcd` never invoked; `ccdVerbs: null` → 501; `['swap','pools-v1']` → `swapCross` argv; sessions route with a registry hit → plain argv | verdict branch removed; `verbSupported` used for the cap; revival refused |
| 47 | `pools-v1` pinned three ways | `KNOWN_CAPABILITY_TOKENS` exact equality + `toContain(POOLS_CAP)`; `caps-token-shape` | `echo` removed; constant misspelled |
| 48 | `projected` is the untagged forecast; `placement` per project; `unmeasurable` is a value | `projects-route-placement.test.ts` | `unmeasurable` collapsed; global `projected` takes a project |
| 49 | Doctor names each class with its own remedy | `ccrc-doctor.test.ts` `pools` cases; two-verdict-lines convention | classes joined; check dropped from `CCRC_DOCTOR_CHECKS` |
| 50 | Lifecycle manifest entry carries a ruling | `lifecycle.test.ts` existing collector-null assertion | ruling emptied |
| 51 | No operator names in source | `single-definition`, `topology-clean` residue classes | a real pool or account name is typed |
| 52 | README prose about manual bypass is true | `readme-holds`-style pin: README no longer claims `swap`/`start`/`prefer` bypass placement policy; names `--cross-pool` | the sentence is left unedited |

---

## 12. Defects found during design

Deviation numbers are allocated from `POST /api/ledger/deviations` **at plan time** and defined in the same act; none is predicted here. Provisional labels `P-N` are this document's own and must not be copied into a plan as if they were ledger numbers.

| | Defect | Source |
|---|---|---|
| P-1 | `shared/roster-json.mjs` never mirrored `hidden`; accepts `hidden: "false"` behind a green deploy | probe (§3.4) |
| P-2 | `cmd_prefer` writes `.home` and never journals | design |
| P-3 | Silent strand at `ccd/ccd:11243` — reachable today with every account at ceiling | adversarial review |
| P-4 | `server/src/config.ts:197-201` claims deploy ships one `accounts.json` to both boxes; it seeds once | probe |
| P-5 | `ccd/ccd:3547-3552` says telemetry does not reach bash; `CCRC_MEASURED` does | probe |
| P-6 | `README.md` account-entry sentence lacks `hidden` | design |
| P-7 | Registry `pool` field (a candidate list, no writer) vs roster `pool` name — two meanings of one word in one file; renaming the field is out of scope | design |
| P-8 | Retag racing a dispatched unit's ≤120 s jitter can stall ≤900 s; accepted rather than clearing `lastswap` | adversarial review |
| P-9 | `README.md` "manual placement bypasses the gate entirely" superseded | design |
| P-10 | `_swap_target`'s stdout overload resolved at the caller, not the callee | design |
| P-11 | `swap.log` gains lines with a project where every other line has an id (`pool-tag`) | design |
| P-12 | Two-language spelling of `pools` and `POOL_NAME_RE`, pinned by text extraction | design |
| P-13 | `_ws_least_loaded`'s empty answer folds "all at ceiling" and "undecidable tag"; resolved in the caller's reason | author (§6) |
| P-14 | Deploy-window strand: old supervisor inode + new on-disk `ccd` → silent in-unit refusal every 900 s | adversarial review |
| P-15 | Rulings 4 and 5 conflicted as first designed; reconciled by the crossing marker (ruling 8) | adversarial review |
| P-16 | `isSafeProjectSegment` refuses a leading `-`/`_` that `_ws_project_valid` accepts; not on this design's path (Map lookup), recorded for alignment | judges |
| P-17 | `cmd_ensure` strand-clear placement was specified three incompatible ways in the panel's design; resolved inside the guard | adversarial review |

Also corrected from the panel's designs (line anchors that were wrong, substance true): `REQUIRED_VERB_FLAG` is at `agent/src/whitelist.ts:240`, not `:230`; the PWA's unknown-frame drop is `asFleetMsg` in `pwa/src/stores/fleet.ts`; `FleetClient.state`'s literal is at `server/src/remote/client.ts:85-87`; `swap.log` has one comment mention in shipped source, not two; `auth-gate.test.ts`'s route table is **not** derived (hard literals at `:195` and `:204`).

---

## 13. What is deliberately not built

| Not built | Why |
|---|---|
| A data boundary between pools | Accounts are billing pools today; swaps carry transcripts across config dirs and rung 6 reads across pools. If wanted later, `--cross-pool` is the single place to refuse or scrub. |
| A dispatch-time pre-check for an empty pool | `ccd`'s `ws-add` refuses with a named reason and dispatch already surfaces `!res.ok`; a coordination-side behaviour change belongs to its own design (O2). |
| Retag overriding a program hold | The strand-a-wedged-wave argument (`ccd-auto-swap-hold.test.ts:98-107`); the `data-offpool` marker makes the deferral visible (O3). |
| Retag bypassing `SWAP_COOLDOWN` | Reopens the storm the gate exists for. |
| A free-text pool field in the PWA | Shortest path to an empty pool; the shell can create a new name, or tag an account first. |
| A detail string for unreadable/malformed on the wire | The chip carries the path; the doctor carries the bytes. |
| A new agent op, handshake field, or `FleetSession.projectPool` | Approach B needs none; the `pools` frame is the fleet-level carrier. |
| A `pool-tag` lifecycle act | The vocabulary is per-session; `cmd_coord_pause` journals nothing. |
| Renaming the registry `pool` field | Out of scope; P-7 records the collision. |
| Provenance flags on the verb | Additive later (tokens after the granted prefix are unconstrained); the session gate is the authorization today. |
| `fs.watch` on `pools/` | The 2 s tick and the request-time re-read make it unnecessary. |

---

## 14. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| O1 | Ruling 8's interpretation (§2): a `swap --cross-pool` still returns home when home recovers; `prefer --cross-pool` is the way to stay crossed | **Accept.** Matches the existing `swap`/`prefer` split; no new semantics. |
| O2 | Should dispatch refuse a program whose project's pool is empty before creating the run? | **Not now.** Surface the stderr; revisit with a per-project `placement` on the runs board. |
| O3 | Should a retag move a held mid-wave worker? | **No.** Hold defers; marker shows it. |
| O4 | `unknown-pool` as a warning or a refusal on the tag route? | **Warning** until account pools are in `accounts.sh` on both boxes and `rosterAgreement === 'agreed'` can gate a refusal. |
| O5 | Doctor `pools-orphan-pool`: WARN or FAIL? | **WARN.** The pool may be about to gain an account. |
| O6 | `meas.crosspool` or `dec.crosspool` on the lifecycle row? | The dec flags use `dec.*` for a *declared* operator choice; a crossing is declared. **`dec.crosspool`.** |
| O7 | Fixture pool names in tests | `pool-a`, `pool-b`; accounts `acct-a`…; never the operator's names. Run `topology-clean` after adding any label-like literal. |

### 14.1 What was not adversarially reviewed

Of three refuters, one (bash decision paths) completed; **seams** and **rollout** failed on usage credits. Ruling 9 folded them into this document: §6 is the seam census and §11/§5.11 the rollout analysis, both written by the author, not by an adversary. A reviewer of this spec should read those two sections as the least-tested.

---

## 15. Rollout onto the live fleet — the "rollout" lens, answered by the author (ruling 9)

Nothing changes until something is tagged. Every step below is reversible by untagging.

1. **Ship the code, nothing tagged.** Agent lane first (`accounts.sh` with an empty `_ccrc_pool`, new `ccd`, agent restart, supervisor sweep), then the server. Zero behaviour change: every account untagged, `pools/` absent, `declare -F` guards hold. Expected transient: `rosterAgreement: divergent` between the two lanes.
2. **Tag accounts.** Edit both `accounts.json` copies, `deploy.sh agent <host>`, `deploy.sh`. Still no behaviour change — no project is tagged, so `_pool_ok` answers 0 everywhere. The `divergent` banner shows between the two deploys and clears after.
3. **Check the pools exist.** `ccrc doctor` `pools` → PASS; `GET /api/accounts` shows `pool` per account; `PoolSheet` lists the names.
4. **Tag projects one at a time from the phone**, starting with projects whose pool has headroom. Per project, within one tick: `rehome` lines for its sessions whose home was out of pool; `data-offpool` on sessions whose wrapper is; moves follow at idle boundaries once cooldown gates open (≤900 s after a landed swap, ≤1800 s after a refused one), immediately for hard-blocked sessions, after release for held ones. Watch `swap.log` for `rehome`/`auto-pool`/`auto-rescue` and the cards for `N stranded`.
5. **Expect strands where a pool is thin.** With five accounts split across pools, a pool of one or two accounts at ceiling strands its hard-blocked sessions loudly instead of crossing — that is ruling 6 working. Remedy in the banner: enable a lane, tag another account into the pool, or untag the project.
6. **Rollback** is `ccd project-pool --project <p> --clear` (nothing moves; untagged = unconstrained) or, for the account side, removing `pool` keys and redeploying agent-first. The `.stranded`, `.crosspool`, `.strandnotify` fields purge with their rows and are harmless if left.

**Plan shape.** Five waves, each its own PR, each agent-first where it touches `ccd/`: (1) roster field, mirrors, generator, `RosterWire`; (2) `ccd` reader, verb, predicate, deciders, strand, crossing marker, caps, doctor; (3) server L1/L3, registry, routes, watcher frame, health; (4) PWA; (5) README, CLAUDE.md invariants, `config.ts` and `ccd` comment corrections. Deviations allocated per wave from the ledger, `deviation-refs.test.ts` against `origin/main` before each merge.

---

## Appendix A — provenance

- Understanding pass: 15-agent workflow `wf_4251d5c8-f8e` (six maps, six contradictions, eight gaps, eight answers), 2026-09-04.
- Design panel: 10-agent workflow `wf_ebbaba5b-f34` — three tag-home designers, one shared-mechanics designer, three lensed judges, three adversarial refuters (one completed). Scores in §4; judges unanimous.
- Operator rulings 1–6 by structured questions during brainstorming; 7–9 after the panel. Recorded in the session scratchpad and in §2 here.
- Anchors re-verified against `f6fb08f2` on 2026-09-04; `ccd/ccd` unchanged since `1c19787f`.
