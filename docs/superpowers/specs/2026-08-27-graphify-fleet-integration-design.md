# Graphify fleet integration — design

**Status:** design, awaiting operator review · **Date:** 2026-08-27 · **Branch:** `ws/ccrc-with-graphify-integration`
**Revision:** 2 — mechanism layer rewritten after adversarial review (13 must-fixes applied)

Every project ccrc can place a session in gets a working, current graphify: the engine at a pinned
version, the skill converged into every rostered wrapper HOME, and an AST graph kept fresh without a
human invoking anything. Graphs stay on the fleet box. Nothing is committed into any project repo.

This document records what was **measured**, not what was assumed. Where a number appears without a
command or a `file:line` beside it, it is marked as an estimate. That distinction is load-bearing:
five of the design's decisions reverse the intuition that preceded the measurement, and revision 2
exists because an adversarial review found that four of six components could not be implemented as
revision 1 described them.

---

## 1. The four asks, and where each landed

| Ask | Outcome |
|---|---|
| Skill installed in every home ccrc uses | Rides existing machinery, but SRC must be **assembled**, not pointed at (§B). Fixes measured drift. |
| Graphs local, nothing committed | **Solved structurally** by `.git/info/exclude` — never committed by construction. Needs a named **writer** (§D). |
| Working | Needs a doctor check: today's drift is invisible. |
| **Up to date** | The only part with no mechanism on either side — and the part revision 1 got wrong (§C.1). |

Graphify has no self-update and no version check. ccrc's installer idempotence is a content `diff`,
not a version comparison. The measured consequence: the fleet runs **0.9.9 (2026-07-07) against a
current 0.9.50 (2026-08-25)**, 41 releases behind out of 218.

---

## 2. Operator decisions (settled in session, 2026-08-27)

| Decision | Ruling |
|---|---|
| **Ownership** | **Full bake.** ccrc owns the engine, the skill convergence, and the refresh machinery. Overrules T6 of `2026-08-22-ccrc-tooling-decision-brief.md` — which was a *recommendation-unless-overruled* under that document's own heading, not an operator ruling. |
| **Version** | **Pin, bump by reviewed commit.** |
| **Refresh route** | **Serialized, idle-gated systemd sweep.** Watcher and Claude-Code rebuild hooks rejected (§5). The existing git post-commit hooks are **not** retained unconditionally — see **O6**. |
| **Store** | **Per-tree, `GRAPHIFY_OUT` unset**, graphify's default `<tree>/graphify-out/`, excluded via `<repo>/.git/info/exclude`. |
| **Corpus** | A **pre-build guard**, plus an **ephemeral generated `.graphifyignore`**. |
| **Docs** | **All markdown, plans included.** |
| **Depth** | **AST-only** (Appendix A). |
| **Registry read** | **Granted explicitly** (R2 below). |

### 2.1 The registry-read ruling — R2

`CLAUDE.md` states without qualification: *"NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or
`claude-session@*.service` directly."* The sweep needs an idle signal.

> **R2 (2026-08-27).** `ccd-graph-sweep` may **read** `~/.cc-sessions/*.hookstate.json`, `*.workdir`
> and the live status file. It may not write, create, delete or lock anything under `$REG`; it may
> not touch tmux or any `claude-session@*` unit. Every other actor remains forbidden. A write of any
> kind from the sweep is a defect, not a judgement call.

**Caveat carried into implementation:** hookstate is *not* a general idle signal. It was deliberately
demoted to a pending-question guard (`server/src/watch.ts:165-190`, which names the live status file
"the SOLE idle authority"), `HOOKSTATE_FRESH_MS` is 30 min (`server/src/hookstate.ts:9,216`), and a
live census read **22 files, 7 fresh, 15 `no-state`**. A gate keyed on `hookstate.state` alone
repeats bug F6b, which ccrc already fixed. The gate must read the live status file as its authority
and use hookstate only as a secondary guard.

---

## 3. What was measured

Every item was produced by a command on the live fleet box (`openclaw`) on 2026-08-27, or read from a
cited `file:line`. Claims marked **[re-verified]** were independently re-run by the author after the
review.

### 3.1 Engine and drift

| Fact | Evidence |
|---|---|
| Installed **0.9.9**; latest **0.9.50**, 218 releases | `graphify --version`; PyPI `graphifyy` JSON **[re-verified]** |
| Skill absent from `.claude-dev0` and `.claude-glm`, present in five homes | `cat ~/.claude-*/skills/graphify/.graphify_version` **[re-verified]** |
| **Zero** graphify references in ccrc source | `grep -rin graphify ccd/ccd ccd/ccrc server/src agent/src shared` → 0 **[re-verified]** |
| No doctor check for skills or hooks exists | `CCRC_DOCTOR_CHECKS`, `ccd/ccrc-doctor-checks:166-192` |

### 3.2 Build cost (ccrc, 763 tracked files)

| Metric | Value |
|---|---|
| Cold build | 24.7 s · warm 23.2 s (cache saves **1.46 s / 5.9%**) |
| Peak RSS | 532 MB |
| Graph | 6,741 nodes / 14,047 edges · store 11 MB |
| All 124 markdown | **+2,253 nodes (+50.2%) for +1.13 s**, no LLM |
| Staleness probe, 58 trees | **354 ms** |
| Corpus guard (`detect()` + `git ls-files`) | 1.67 s / 30 MB |

**Unmeasured and load-bearing:** MekWarLive is 5,837 code files (~8× ccrc) and its wall time has
never been observed — the rebuild log carries no timestamps, so any "~3 min" figure is extrapolation
from file count. This sizes O2.

### 3.3 Disk — the finding that inverts the cleanup story

| Fact | Evidence |
|---|---|
| 41 `graphify-out` dirs, **5,454 MB** | `find` + `du -sc` **[re-verified]** |
| **239 dated backup dirs = 4,863 MB (89%)** | `find -regex '.*/[0-9]{4}-[0-9]{2}-[0-9]{2}$'` **[re-verified]** |
| Live artifacts | **~591 MB** |
| Never pruned, 2026-07-07 → 2026-08-27 | oldest/newest dir names |
| Writer is graphify, and **conditional** | `export.py:33 backup_if_protected` — fires only when `.graphify_semantic_marker` exists or labels are hand-edited (`export.py:51-61`) **[re-verified]** |
| Disable | `GRAPHIFY_NO_BACKUP=1`, `export.py:45` **[re-verified]** |

**Consequence.** Disk is not a reason to share a store. The replication penalty for full per-tree
isolation is a fraction of 591 MB on a 492 GB volume with 339 GB free. On an AST-only graph the
backup path never arms — which is also why §9's test for it needs a fixture that arms it (row 5).

### 3.4 Store topology — three measured results

**Cache sharing is inexpressible.** `cache_dir` derives solely from `GRAPHIFY_OUT`
(`cache.py:337-339`) — there is no separate cache path. "Isolate output, share cache" is not a
configuration that exists. The prize would have been 1.46 s of 24.7 s.

**A shared per-project store livelocks.** `graph.json` carries one `built_at_commit`; worktrees sit on
different branches. Measured: two trees, one shared store, four idle passes, **zero** source changes →
**8 rebuilds out of 8 visits**, `built_at_commit` alternating forever. Isolated stores → 2 rebuilds,
then permanent skip.

**An ignored in-tree store needs no cleanup code.** Verified on git 2.43.0 **[re-verified]**:

| Store state | `git status --porcelain` | `git worktree remove` | Outcome |
|---|---|---|---|
| **Ignored** | clean | succeeds without `--force` | **deleted with the tree** |
| **Un-ignored** | 1 line | `fatal: contains modified or untracked files` | **tree cannot be removed** |

ccd deliberately never passes `--force` (`ccd/ccd:3451`, *"Still no --force"*), so an un-ignored store
wedges `cmd_ws_rm`, the reap tail (`ccd:9298`) and gc's orphan arm (`ccd:9989`) at once. An ignored
store is collected by all three for free and cannot orphan.

### 3.5 Corpus — clean here, not clean by design

| Fact | Evidence |
|---|---|
| Live built-out checkout: 763 tracked, 25,379 on disk, 24,664 gitignored | `git ls-files`, `find` |
| `detect()` returned **727 corpus files, 0 untracked** | `graphify.detect.detect()` |
| …with `server/dist` (81 files) present | `ls` |
| Planted fixtures admitted **167 of 681** files from `cdk.out`, `vendor`, `htmlcov`, `bin`, `obj`, `logs`, `tmp` | none in `_SKIP_DIRS` (`detect.py:696`) |
| One 130 KB minified bundle → **4,000 nodes, 52.6% of the graph** | planted-fixture build |
| graphify **never consults git** | `grep` for `check-ignore`/`ls-files`/`pathspec`/`info/exclude` → **0 hits** **[re-verified]** |

ccrc's cleanliness is a property of ccrc's `.gitignore`, not of the tool. The deliverable is a
**guard**, not a list.

### 3.6 The `.graphifyignore` negation defect (upstream)

`detect.py:824-827` claims a `.graphifyignore` *"can only ever exclude MORE, never re-include a
.gitignore-excluded file"* — while the preceding clause says `!` negations win by last-match-wins. The
two contradict; the second is false. Measured **[re-verified]**:

| Config | Corpus |
|---|---|
| `.gitignore` only (`secrets.py`, `private.md` ignored) | `main.py` |
| `+ .graphifyignore` with `!secrets.py`, `!private.md` | **`main.py`, `private.md`, `secrets.py`** |

`.env`/`.token` files are unaffected — not corpus types — but **`deploy/reference-fleet.md` is
gitignored at `.gitignore:41` and is a `.md`**, which is. It is absent from this worktree and present
on the live boxes, holding the fleet's real hostnames and SSH coordinates. Graph artifacts embed file
contents.

**Rule, absolute: no ccrc-generated `.graphifyignore` may contain a `!` line.** Pinned by §9 row 3.

### 3.7 What the box does *not* have (found by review, decisive for §A)

| Fact | Evidence |
|---|---|
| No `pip`, `pip3`, `pipx` or `uv` on PATH | `command -v` each → absent **[re-verified]** |
| `python3 -m pip` → *"No module named pip"* | **[re-verified]** |
| PEP 668: `/usr/lib/python3.12/EXTERNALLY-MANAGED` exists, root-owned | **[re-verified]** |
| `command -v graphify` → `/usr/local/bin/graphify`, a **root-owned symlink** → `~/.local/bin/graphify` | `ls -la` **[re-verified]** |

The last one is the trap: an unprivileged `ccrc install` can neither update nor remove that symlink,
so the box could be "upgraded" while every `command -v graphify` caller still reaches 0.9.9.

---

## 4. Architecture

```
ccrc install / ccrc update / deploy.sh agent      [roles: fleet, both]
   ├── A. engine provisioning   → ~/.ccrc/graphify-venv, pinned, absolute-path resolved
   ├── B. skill convergence     → assembled SRC → rostered wrapper HOMEs
   └── D'. exclude writer       → graphify-out/ + .graphifyignore into each repo's common-dir exclude

systemd --user (fleet box only)
   └── ccd-graph-sweep.timer → ccd-graph-sweep
            ├── precondition:  git check-ignore -q graphify-out   (else refused-no-exclude)
            ├── probe:         built_at_commit != HEAD || engine_stamp != PIN
            ├── pre-build:     write .graphifyignore → corpus guard → REFUSE BUILD on breach
            ├── build:         graphify update (serialized, niced, capped, timeout)
            ├── post-build:    write .graphify_engine stamp; remove .graphifyignore
            └── census:        ~/.ccrc/graph-sweep.json (atomic, per-tree outcomes)

ccrc doctor
   └── _check_graphify (multi-condition, _dr_join) → engine, skills, excludes, census
```

### 4.1 Role matrix

ccrc is a two-box product. `ccrc install` records `CCRC_ROLE` (`both` default, `fleet` on a fleet
host, `server` exists). `_inst_units` currently ships `ccd-cap-scopes.{service,timer}` **role-blind** —
cloning that would put a graph sweep on a server box with no `~/worktrees`, where §C's
"a pass that probes zero trees is an error" rule makes every pass an error and doctor red forever.

| Component | `fleet` | `both` | `server` |
|---|---|---|---|
| A. engine venv | install | install | **skip** |
| B. skill convergence | install | install | **skip** |
| D'. exclude writer | run | run | **skip** |
| Sweep unit + timer | install + enable | install + enable | **skip** |
| Doctor check | evaluate | evaluate | **`_dr_skip` (rc 3)** — not PASS, not FAIL |

**Tree enumeration is a definition, not a glob:** trees = every path under `$PROJECTS_ROOT` and
`$WORKTREES_ROOT` that is a git working tree (`git rev-parse --is-inside-work-tree` succeeds). A box
with **no** trees configured exits with a distinct `no-trees-configured` status — separate from
`probed-zero`, which remains an error on a box that *has* trees.

### A. Engine provisioning

**Target: a ccrc-owned venv at `~/.ccrc/graphify-venv`**, created with `python3 -m venv`, into which
`graphifyy==<pin>` is installed. This is immune to PEP 668, removable with one `rm -rf`, and
independent of a future python3.13 reshuffle that would orphan `~/.local/lib/python3.12/site-packages`.

**Resolution is by absolute interpreter path, never `command -v`.** Every caller — the sweep, the skill
installer's SRC derivation, the doctor check — uses `~/.ccrc/graphify-venv/bin/graphify` and
`~/.ccrc/graphify-venv/bin/python`. §3.7's root-owned `/usr/local/bin` symlink makes `command -v`
actively wrong: it can report a version ccrc did not install and cannot change.

**A doctor sub-condition reports PATH shadowing** — when an earlier `graphify` on PATH resolves outside
the venv — printing the root-owned symlink as the remedy, since only the operator can clear it.

The pin lives in **one** place and is derived everywhere else. **Correction to revision 1:** "network
at install time is new for ccrc" was false — `ccrc install` already reaches the network. What is
genuinely new is that ccrc becomes responsible for *which third-party package version* runs on the
fleet, which is the consequence of the full-bake ruling and is argued on its own terms.

Install is **fail-closed and loud**: `_inst_skills` wraps each installer in `|| _ccrc_die`, so a
failure is a hard install failure, not a silent skip.

> **Open — O1.** The pin's initial value. 0.9.9 is what every measurement in §3 was taken against.
> 0.9.50 is current. Adopting 0.9.50 invalidates §3 and requires re-measurement. Recommendation: **pin
> 0.9.9 to ship on measured ground, then bump to 0.9.50 as its own reviewed change** with the corpus
> guard and the engine-staleness test as acceptance criteria.

### B. Skill convergence

**SRC is assembled, not pointed at.** Revision 1 said "clone `install-worker-skill.sh` line-for-line
and point SRC at the package." Both halves were wrong:

- `<pkg>/skills/claude/` contains **only `references/*.md`** (8 files, verified). The skill body is
  `<pkg>/skill.md` — 38,050 bytes at the package root, named by
  `_PLATFORM_CONFIG['claude']['skill_file']` and read at `__main__.py:323-324`. Revision 1 cited
  `__main__.py:285`, which is inside `_packaged_skill_refs_dir`, the *sidecar* resolver.
- `.graphify_version` is **not shipped in the package at all** — graphify's installer writes it from
  `__version__` at install time (`__main__.py:368`). A `cp -a` clone would leave every home unstamped
  and §F's doctor read would have no writer.
- "Cloned line-for-line" specifies the opposite of the intent: `install-worker-skill.sh:27` defaults
  SRC to a **vendored** copy under `$HOME/.cc-sessions/`, and `_inst_skills` forces
  `CCRC_SKILL_SRC="$HOME/.cc-sessions/$name"` — joining that loop vendors by construction, defeating
  all four consequences §B claims.

**The staging step.** `ccd/install-graphify-skill.sh` assembles a staged tree, then installs it:

| Staged path | Source |
|---|---|
| `<staged>/SKILL.md` | `<venv-pkg>/skill.md` |
| `<staged>/references/` | `<venv-pkg>/skills/claude/references/` |
| `<staged>/.graphify_version` | written from the pin |

The staged tree is **byte-identical to what lands in `$dest`**, so `diff -r -q "$SRC" "$dest"`
converges and the installer is idempotent. Without this, every `ccrc install`, `ccrc update` and agent
deploy re-swaps all five homes and accretes a `~/ccrc-backups/<ts>/`.

**Deltas from the worker installer**, stated rather than implied: SRC derived from the pinned
interpreter's `graphify.__file__`; **no** `CCRC_SKILL_SRC` default into `$REG`; a call site **outside**
`_inst_skills`' `for name in` loop; `NAME=graphify`; **realpath de-duplication** (which
`install-worker-skill.sh` does not have — `.claude-gpt` and `.claude-kimi` symlink `skills/` into
`~/.claude/skills`); and a real graphify arm in `ccrc uninstall` (`:4581-4583` hardcodes the
worker/coordinator filenames and removes nothing from rostered homes).

**ccrc's installer is the only sanctioned writer of `<home>/skills/graphify/`.** graphify's own
`graphify claude install` writes the byte-identical path and its `_install_skill_references`
`os.replace`s `references/` underneath. Two writers to one path is a drift generator.

### C. The refresh sweep

`ccd-graph-sweep` + `.timer`, systemd `--user`, following `ccd/ccd-cap-scopes`.

#### C.1 Staleness is two-dimensional — the fix for the headline ask

Revision 1 defined staleness as `built_at_commit != HEAD` alone. **That defeats the entire purpose of
pinning.** Measured: `graph.json`'s top-level keys are `['directed','multigraph','graph','nodes',
'links','hyperedges','built_at_commit']` and `d['graph']` is `{}` — **there is no engine or schema
field**. After a pin bump, every tree probes *fresh* at unchanged HEAD and is skipped, so the fleet
keeps serving graphs built by the previous engine until each tree's HEAD happens to move — which for a
quiet repo is never. A bad bump would also be unrollbackable, there being no stamp to invalidate.

**Fix:** the sweep writes `<tree>/graphify-out/.graphify_engine` (the pin string) on every successful
build, and the probe becomes:

```
stale = (built_at_commit != HEAD) || (engine_stamp != PIN)
```

A pin bump therefore costs **one full-fleet rebuild pass**, which must be sized against O2's budget.

#### C.2 The build

Per stale tree, **serialized, one at a time**:

```
cd "$tree" && \
  GRAPHIFY_NO_BACKUP=1 PYTHONHASHSEED=0 GRAPHIFY_MAX_WORKERS=<n> \
  nice -n 15 timeout 600 ~/.ccrc/graphify-venv/bin/graphify update .
```

`graphify update` with `changed_paths=None` re-extracts the full corpus (`watch.py:676-681`), so this
one command serves both cold builds and refreshes — no second verb is needed.

**Five preconditions, each from a measured failure. None optional.**

1. **`git check-ignore -q graphify-out`** must succeed (§D). Written by D', not by the sweep.
2. **`cd` into each tree.** `_git_head()` (`export.py:475`) shells `git rev-parse HEAD` with **no
   `cwd=`** — measured stamping a `/tmp` non-repo with an unrelated repo's HEAD. Without the chdir the
   sweep reads every tree as stale forever.
3. **`GRAPHIFY_NO_BACKUP=1`** — §3.3.
4. **`timeout` + `TimeoutStartSec=`.** `graphify update` passes `block_on_lock=True`; SIGALRM exists
   only in `hooks.py`.
5. **`GRAPHIFY_MAX_WORKERS` + a `MemoryMax` slice.** The pool is `min(cpu_count, files)`
   (`extract.py:16206-16238`) — 16 on this box. `ccd-cap-scopes` exists because 15 parallel workers
   once stalled the fleet ~25 minutes.

#### C.3 The census — one counter per outcome

§6 forbids collapsing conditions a caller handles differently. `_rebuild_code` returns `False` — and
`graphify update` exits 1 — for *at least three* conditions beyond a build error, including
`to_json`'s node-shrink refusal, which returns `False` **without writing `graph.json`**, leaving
`built_at_commit` at its old value so the tree probes stale forever. The census therefore enumerates:

`fresh` · `stale-rebuilt` · `skipped-idle` · `skipped-locked` · `refused-no-exclude` ·
`refused-by-guard` · `refused-shrink` · `never-built` · `unstamped` · `timed-out` · `failed`

The sweep probes `<tree>/graphify-out/.rebuild.lock` **non-blockingly** before invoking `graphify
update`, so a held lock is `skipped-locked` and `timeout 600` again means only "wedged".
`never-built` triggers a cold build subject to the per-pass budget (O2).

**Sink:** `~/.ccrc/graph-sweep.json`, written atomically at end of pass —
`{started, finished, pin, trees:[{path, outcome, reason, at, duration_ms}]}`, last N passes. Doctor
reads that file. An aggregate count cannot answer *"why does THIS tree never refresh"*; per-tree
granularity can.

#### C.4 The sweep must prove it did something

`ccd-cap-scopes`' own header records that its first version **"NEVER CAPPED ANYTHING"** — string-built
cgroup paths all missed, `capped` stayed 0, nothing printed, the unit exited 0, and the timer logged
success every 60 seconds **for 13 days**, until a runaway process stalled the fleet. This design
inherits that failure mode exactly: a probe that silently matches nothing is indistinguishable from a
fleet with no stale graphs. Therefore **a pass that probes zero trees on a box that has trees is an
error**, distinct from `no-trees-configured` (§4.1).

#### C.5 The idle gate

Per R2, read-only. Authority is the live status file, with hookstate as a secondary guard (§2.1).
Skip trees whose session is working, with a staleness escape hatch so the busiest repo does not starve
(O3).

### D. Store, and D'. the exclude writer

`GRAPHIFY_OUT` is **left unset**. graphify's default is the relative literal `graphify-out`, resolved
against the tree root (`paths.py:23`, `cache.py:337-339`), so per-tree isolation is what you get by
doing nothing. Workspace store `<workdir>/graphify-out/`; main-checkout store
`<projects-root>/<repo>/graphify-out/`; AST cache inside each store, never shared, never copied.

No `~/.ccrc/graphs`, no env injection at the spawn line (`ccd/ccd:10960` and its retry twin `:11001`
are pinned by `server/test/ccd-spawn-split.test.ts`), no symlinks.

Self-ingestion is already handled: `_SKIP_DIRS` contains the literal `"graphify-out"`
(`detect.py:696`).

**D' — the writer.** Revision 1 named no producer for the exclude entry, so the sweep would have
refused `ccrc-pwa` (which fails the check today, D-2, with 5 live worktrees) **forever**, and O2's
cold builds would never happen. The writer is:

- `ccrc install` / `ccrc update` — append once per repo **common dir** for every enumerated tree;
- `ccd ws-add` — the same at workspace creation.

Both idempotent (grep-then-append). One append covers every present and future worktree of that repo.
**Both `graphify-out/` and `.graphifyignore` are appended** — see §E for why the second is required.

**One predicate everywhere.** Revision 1 spelled the gate two incompatible ways (membership in
`.git/info/exclude` vs success of `git check-ignore`). The gate is
**`git -C <tree> check-ignore -q graphify-out`** — mechanism-agnostic, so a repo that solved it via
`.gitignore` also passes. `.git/info/exclude` is named only as *ccrc's* writing mechanism.

### E. The corpus guard — pre-build, not pre-publish

**There is no publish seam to refuse.** `graphify update` → `_rebuild_code` → `export.to_json` opens
`graphify-out/graph.json` and writes it **in place** — no temp file, no rename, no staging. By the time
a post-hoc guard could run, the poisoned graph is already on disk.

The guard is therefore a **pre-build precondition** on the same footing as the exclude check:

1. write the ephemeral `.graphifyignore`;
2. run `detect()`;
3. assert every corpus path appears in `git ls-files`;
4. on breach, **refuse to run `graphify update` at all**, report the offending paths, and leave the
   previous still-valid graph untouched — which is also the safer failure.

"Refuse the publish" is reworded to "refuse the build" throughout.

**One exemption, and it is mandatory:** `detect()` explicitly re-adds `<tree>/graphify-out/memory/` to
its scan set (`detect.py:1101`), which is untracked by design. Without exempting it the guard has a
permanent false positive on every tree that has ever answered a query.

**Ephemeral `.graphifyignore`.** For the two genuine-noise *tracked* directories
(`server/test/fixtures/panes/` — 9 raw tmux pane dumps; `pwa/public/icons/` — 5 renderings of one app
icon), ccrc generates the file immediately before the build and removes it after.

- Removal via `trap … EXIT INT TERM`. **SIGKILL, OOM-kill and reboot leave it behind** — revision 1
  claimed a crashed build "cannot leave one behind" *and* that a trap does not survive SIGKILL, which
  cannot both be true.
- Because a leftover is untracked, it would recreate the exact `git worktree remove` wedge §3.4 exists
  to prevent — for the duration of *every* build, not just after a crash. **This is why D' appends
  `.graphifyignore` to the exclude as well.** With that line present a leftover is harmless at all
  three seams, and the SIGKILL hazard is reduced to cosmetic.
- A stray file is additionally a sweep cleanup target.
- **It may never contain a `!` line** (§3.6).

### F. The doctor check

One **multi-condition** `_check_graphify` on the `_check_wrappers`/`_check_fleet` shape using
`_dr_join` — one verdict line per condition, returning the worst class per `ccd/ccrc:1259-1274`.
`_dr_need_bin` is used *only* for the engine-on-PATH sub-condition: its own header describes it as
*"the one shape shared by the six 'is this binary installed' checks"* — one binary, one verdict,
`return` — and cannot carry four remedies.

Conditions: engine present at the venv path and `--version` matching the pin; PATH shadowing (§A);
each rostered home's `.graphify_version` against the pin, naming the missing; `check-ignore` coverage
per tree; and the last-pass census from `~/.ccrc/graph-sweep.json`. On `CCRC_ROLE=server`, `_dr_skip`
(rc 3).

This also fills a gap the repo admits: `README.md` advertises hook registration that no check
implements, and doctor has **no** skills or hooks check at all.

---

## 5. What is deliberately not built

| Not built | Why |
|---|---|
| **Persistent watcher** | `watchdog` not installed (`graphify watch .` exits 1). Needs **258,671 inotify watches against a 244,190 limit** (an independent re-measure put it *higher*, at 265,272) and cannot prune — `observer.schedule(recursive=True)` places the watch before the ignore test runs. `watch.py:1186` calls `_rebuild_code` with no `changed_paths` — a **full** rebuild per batch, despite docs calling it incremental. No nice, no memory limit, no timeout. Fires on save, so builds from mid-edit trees. |
| **Claude-Code rebuild hooks** | No cheap fire: one-file 21.6 s, **zero-file 20.6 s** (552 of 585 ccrc files bypass the AST cache). ~3.4 concurrent full rebuilds steady-state across 19 sessions. |
| **Claude-Code nudge hooks driving session-side extraction** | Rejected on four measured grounds — Appendix B. |
| **Claude-Code PreToolUse nudges** (`graphify claude install`) | Real and shipped — live in 6 project `settings.json`, 0 wrapper HOMEs — but it is **query steering, not freshness**: `hook-guard` stats `graph.json` and prints a nudge, never rebuilds. Orthogonal; per-Read fleet token cost unmeasured. |
| **Shared/per-project store** | Livelocks (§3.4). |
| **Shared extraction cache** | Inexpressible (§3.4). |
| **A vendored skill copy** | §B. |
| **A new ccd verb / exec-whitelist entry** | Nothing here needs one. |
| **Semantic extraction** | Appendix A. |

**Extending git hooks to `ccrc-pwa` is out of scope**: highest-churn repo, no ignore rule today, and
the sweep already covers it.

---

## 6. Ring placement and invariants

| Component | Placement | Constraint |
|---|---|---|
| Sweep, installers, exclude writer | Fleet-box shell (`ccd/`), outside the ring model like `ccd-cap-scopes` | AGENT-FIRST deploy |
| Doctor check | `ccd/ccrc-doctor-checks` | verdict/return-code agreement (`ccd/ccrc:1252-1274`) |
| Lifecycle manifest | `shared/lifecycle.ts` — **does not exist yet**, see §7 | L0: imports nothing, not even `node:*` |
| Version pin | one canonical home | §9 row 10 |

**No server or PWA code.** `EXEC_COMMANDS = ['tmux','ccd']` stays closed.

**AGENT-FIRST.** Everything touches `ccd/`, so it ships to the fleet box before the server.

**No overloaded null at a seam** — the eleven sweep outcomes in §C.3 are the shape that keeps the
conditions distinct.

---

## 7. Artifact lifecycle declarations

`docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md` §1.2 makes an unassigned artifact
class a **defect**. **`shared/lifecycle.ts` does not exist** — the policy's §4(a) manifest has never
been built, so this work creates it.

Revision 1 assigned `project-graph-store` pattern **P**, which in the policy means *programme-bound
(ledger)* — states `open → closed → compacted`, keyed to `closeRun`. That describes nothing about a
regenerable AST store. Corrected to **O** (operator-permanent), whose entry the policy requires to
carry an affordability note and a non-empty `ruling` whenever `collector` is null.

| Class | Root | Pattern | Creators | Collector | Bound | Tier / affordability |
|---|---|---|---|---|---|---|
| `workspace-graph-store` | `<workdir>/graphify-out/` | **W** | sweep; managed git hook | the worktree's three existing collectors (`ccd:3451`, `:9298`, `:9989`) | workspace lifetime | ~11 MB/tree |
| `project-graph-store` | `<projects-root>/<repo>/graphify-out/` | **O** | sweep | *none* — `ruling` required | repo lifetime | ~11 MB/repo, AST-only, backups off |
| `graph-corpus-filter` | `<tree>/.graphifyignore` | **E** | sweep | sweep (trap + stray sweep) | one build | <1 KB |
| `graph-build-lock` | `<tree>/graphify-out/.rebuild.lock` | **E** | graphify | graphify | one build | negligible |
| `graph-sweep-census` | `~/.ccrc/graph-sweep.json` | **R** (ring-capped) | sweep | sweep, last N passes | rolling | bounded by N |

`workspace-graph-store` **cannot orphan** — it lives inside the directory the collector deletes.

`project-graph-store` has **no collector** because a project directory has no death event. That is a
declared, bounded permanence, not an oversight — and per the policy it needs an operator `ruling`
string, which is **O7** below.

### 7.1 Uninstall

`cmd_uninstall` carries an explicit REMOVES / PRESERVES / REFUSES contract enumerated file-by-file, and
`_uninst_units` deletes only units it names by literal path. Silence would leave an uninstalled box
running a timer that rebuilds graphs for a ccrc that is gone.

| Artifact | Disposition | Precedent |
|---|---|---|
| `ccd-graph-sweep.{service,timer}` | add to the literal disable list (`:4463`) and `rm -f` list (`:4472`) | `ccd-cap-scopes` |
| Engine venv `~/.ccrc/graphify-venv` | removed with `~/.ccrc` under `--purge`; kept otherwise | `~/.ccrc` handling |
| Per-tree graph stores | **never removed** — worktrees are sessions' work | the existing rule |
| ccrc-appended `.git/info/exclude` lines | **left in place**; operator remedy printed | `_uninst_keep_asides` prints its `mv` lines |
| Census `~/.ccrc/graph-sweep.json` | removed with `~/.ccrc` under `--purge` | as above |
| Converged skills in rostered homes | removed by the graphify arm added to `ccrc uninstall` (§B) | worker/coordinator arms |

---

## 8. Failure modes and guards

| Failure | Guard |
|---|---|
| **A pin bump refreshes nothing** | Two-dimensional staleness with `.graphify_engine` (§C.1) |
| Sweep silently enforces nothing (`ccd-cap-scopes`' 13-day failure) | Zero trees probed on a box with trees is an **error** (§C.4) |
| Un-ignored store wedges `ws-rm`/`ws-reap`/`ws-gc` | Exclude is a precondition **with a named writer** (D') |
| Leftover `.graphifyignore` wedges the same three seams | It is excluded too (D', §E) |
| `built_at_commit` stamped from the wrong repo | `cd` into each tree (`export.py:475`) |
| Shrink-refusal leaves a tree permanently "stale" | `refused-shrink` is its own census outcome (§C.3) |
| One wedged tree stops the timer forever | non-blocking lock probe + `timeout 600` + `TimeoutStartSec=` |
| Rebuild storm starves the fleet | serialized + `nice 15` + `GRAPHIFY_MAX_WORKERS` + `MemoryMax` |
| Unbounded backup accrual | `GRAPHIFY_NO_BACKUP=1`; AST-only never arms the path |
| Generated artifacts poison a graph | Pre-build corpus guard **refuses the build** (§E) |
| Guard false-positives forever on `graphify-out/memory/` | Explicit exemption (§E) |
| A gitignored secret enters a graph | **No `!` lines**, pinned (§9 row 3) |
| Engine upgraded but callers still reach the old one | Absolute venv paths; doctor PATH-shadowing sub-check (§A) |
| Sweep runs on a server-role box | Role matrix (§4.1) |
| Graph destroyed on `ws-rm` | **Intended.** The store is regenerable |
| Doctor PASSes while the graph volume fills | D-1 (§10) |

---

## 9. Test plan — mutation-table discipline

*A comment is a request; a red suite is a mechanism.* Every guard ships with a test measured RED before
and GREEN after. TDD, red first. Fixture HOMEs only (`makeCcdHarness`), never the live `$HOME`.

| # | Guard | Test goes red when |
|---|---|---|
| 1 | Exclude precondition | precondition deleted; a tree failing `check-ignore` is built |
| 2 | Corpus guard (pre-build) | an untracked path is planted and the **build** still runs |
| 3 | No `!` in generated `.graphifyignore` | a `!` line is introduced (fixture: a gitignored `.md` re-entering the corpus) |
| 4 | `cd` into tree | chdir removed; `built_at_commit` stamped from the wrong repo |
| 5 | `GRAPHIFY_NO_BACKUP=1` | **fixture arms the path** (plant `.graphify_semantic_marker`): env present ⇒ no dated dir; env dropped ⇒ dated dir. *Without the fixture this row is unfalsifiable under an AST-only ruling and would be a spelling pin, not a behavioural one.* |
| 6 | Serialization | serializer mutated; two builds overlap |
| 7 | `timeout` wrapper | timeout removed; a wedged fixture hangs the pass |
| 8 | Census non-empty | probe mutated to match nothing; pass still exits 0 |
| 9 | Installer symlink de-dup | de-dup removed; a symlinked home written twice |
| 10 | Version pin single definition | **a new `describe` block** regexing the literal `graphifyy==` spelling. `single-definition.test.ts` has *no generic duplicate detector* — every rule is a bespoke hand-written block, so a new pinned value gets no coverage automatically in either half. Its bash half (`:740`, roots `ccd/` + `deploy/` + `install.sh`) does cover a bash-side pin. |
| 11a | `.graphifyignore` trap | trap removed; non-zero exit or SIGTERM leaves the file |
| 11b | Leftover harmlessness | `.graphifyignore` exclude line removed; a leftover makes `git worktree remove` refuse |
| 12 | Doctor verdict/return-code agreement | a non-PASS path returns 0 |
| **13** | **Engine staleness** | pin mutated; a pass over a fixture at **unchanged HEAD** does not rebuild |
| **14** | **Staged-SRC idempotence** | staging removed; a second run re-swaps homes (inode/mtime change) |
| **15** | **Exclude writer** | writer removed; a fresh repo never becomes buildable |
| **16** | **Role scoping** | role gate removed; the sweep unit installs on a `server`-role box |

---

## 10. Defects found during design

Deviation numbers are allocated from `POST /api/ledger/deviations` **at plan time**; the floor is
**895** (`docs/superpowers/plans/2026-08-27-git-email-policy.md:38`). Numbering a spec against a plan's
ledger caused two prior collisions.

**ccrc defects (will take D-numbers):**

- **D-1 — doctor watches the wrong filesystem.** `_check_disk` runs `df -Pk "$HOME"`
  (`ccd/ccrc-doctor-checks:1725-1766`), but graph data lands under `~/worktrees` / `~/projects`, on a
  **different device** (`$HOME` on `/dev/sda1`; worktrees a bind mount of `/dev/sdb`). The graph volume
  could fill to 100% while doctor reports PASS. ccd's own `CCD_DISK_FLOOR_GB` (`ccd/ccd:2807-2810`)
  *does* check `WORKTREES_ROOT` — the pre-spawn floor sees what doctor cannot.
- **D-2 — `ccrc-pwa` has no `graphify-out` ignore rule.** Neither `.gitignore` nor `.git/info/exclude`;
  `git check-ignore graphify-out/` exits 1 today with 5 live worktrees. Any graph built in one would
  make that workspace unremovable at three seams.
- **D-3 — skill drift is invisible.** Absent from `.claude-dev0` and `.claude-glm`, present in five
  homes, and no check can see it.

**Upstream graphify defects (recorded, worth reporting; not ccrc D-numbers):**

- **U1** — `detect.py:824-827`'s docstring is false and self-contradictory (§3.6).
- **U2** — `backup_if_protected` has no retention and no prune verb.
- **U3** — `_git_head` (`export.py:475`) shells `git rev-parse HEAD` with no `cwd=`.
- **U4** — docs describe `--watch` as incremental; `watch.py:1186` does a full rebuild. `--watch` is
  also not a flag (it is `graphify watch`), and `references/hooks.md` omits the PreToolUse system.
- **U5** — `to_json` writes `graph.json` in place with no staging, so a failed build can leave no
  usable artifact and a poisoned corpus is on disk before anything can inspect it.

---

## 11. Open decisions

- **O1 — the pin's initial value** (§A). Recommendation: 0.9.9, then bump as its own change.
- **O2 — sweep scope and per-pass budget.** First pass is ~19 cold builds plus ~15 refreshes. ccrc
  costs 24.7 s; **MekWarLive's wall time is unmeasured**. Recommendation: all trees, serialized, with a
  per-pass rebuild budget so the first pass drains over hours rather than blocking. Note C.1 makes a
  pin bump cost a full pass too.
- **O3 — sweep interval and idle-gate strength.** A tree goes stale exactly when its session commits —
  precisely when it is not idle. The staleness SLA has never been stated.
- **O4 — a console surface.** ccrc's thesis is that it is the operating console; a silent background
  mutator nothing in the PWA can see or stop is a design smell even though it violates no invariant.
  Precedent exists (`$REG/coordinator-paused`, raised and lowered from a phone). Recommendation: a
  **pause file** the sweep honours; PWA door deferred.
- **O5 — `_ws_ignored_digest` interaction.** It hashes size records, so an unattended rebuild between a
  human's `ws-audit` and their `ws-reap` invalidates the consent token as `state-changed`
  (`ccd/ccd:6300`). Does the sweep respect an outstanding audit token?
- **O6 — the git post-commit hooks (new in revision 2).** Revision 1 retained them as a "latency
  accelerator". Measured, they satisfy **none** of §C.2's five preconditions: the installed hook
  launches a **detached** rebuild (`subprocess.Popen(start_new_session=True)`) with no `nice`, no
  `MemoryMax`, no slice, no `GRAPHIFY_NO_BACKUP=1`, and a `GRAPHIFY_MAX_WORKERS` cap applied only under
  Windows — i.e. exactly the 16-way fan-out C.2.5 exists to prevent, on the path that fires *during a
  wave* when N workers commit at once. It also pins its own interpreter at install time
  (`_PINNED='/usr/bin/python3'`), which will not be the venv. Options: **(a)** `ccrc install` brings
  managed hooks under the same containment — rewrite `_PINNED` to the venv interpreter, inject the env,
  wrap in `systemd-run --user --slice=…`; or **(b)** drop the accelerator entirely and let the sweep be
  the only writer. Recommendation: **(b)**, on YAGNI — the sweep covers every tree, and (a) means ccrc
  rewriting third-party hook files in repos it does not own.
- **O7 — the `project-graph-store` permanence ruling** (§7). The policy requires a non-empty `ruling`
  string wherever `collector` is null. Needs one sentence from the operator.

---

## Appendix A — the semantic layer: measured, and declined

**Operator ruling: AST-only.** *"If we have to pick one or the other, it's clearly AST."*

**The capability has never been produced.** Across all three semantic graphs on this box, edges linking
a `.md` file to a source file: **0, 0, and 0**. Doc↔code edges of any kind: 1, 2, 8 (0.01–0.04%) —
every one linking YAML or HTML to markdown, never a spec to a symbol. The spec↔code bridge is the
entire reason to want semantics on an SDD corpus.

**What 1,104,895 measured tokens bought** (synapsium-platform, `cost.json`): 300 of 3,954 nodes (7.6%)
and **47 of 5,087 edges (0.92%)**, ~40 of those from five PNG screenshots. **262 of 300 semantic nodes
have degree 0** — unreachable by `explain`, `path`, `affected`. expoAI: **1,244/1,264 orphaned (98%)**.

**What AST gives free:** markdown extracted deterministically into a heading tree
(`extract.py:12848`); 951 of synapsium's 979 document nodes are AST-origin. `affected "FleetSession"`
returns 27+ rows with `file:line`. Those are the SKILL's two **highest-precision** commands, at full
fidelity, no LLM. Community labels are a red herring: the good conceptual ones come from the host
agent's Step 5 over AST communities.

**Where semantics fail, AST fails identically.** `path` from a markdown plan to a code symbol returns
"No path found" on **both**.

**Correction to the record.** "The semantic layer is never refreshed" — which shaped the discussion —
was **half wrong**. The semantic cache is content-hash keyed (`cache.py:156-200`), so `graphify
extract` re-extracts changed files: `cache-check` over 5 docs after editing one returned
`Cache: 4 hit, 1 miss`, the miss being exactly the edited file. It is `graphify update` — the sweep's
verb — that is AST-only.

**Untested, not disproven.** Every semantic graph here was built by the Claude-Code subagent path. The
orphan rate has a plausible *fixable* cause: `extraction-spec.md` warns that an edge endpoint emitted
as a basename rather than graphify's ID format creates orphan ghost nodes, later dropped as dangling.
The intermediates that would settle it (`.graphify_chunk_*.json`) are deleted by SKILL Step 9.

**If reopened, there are now three backends, not two.** `--backend claude-cli` (`llm.py:164`) routes
through the local `claude` CLI via `-p --output-format json`, *"billed to the plan, not
pay-as-you-go API credit"*, `pricing: {input: 0.0, output: 0.0}`. It is excluded from autodetect
(`llm.py:2254`) so it must be passed explicitly, and is forced to `max_concurrency=1` unless
`GRAPHIFY_CLAUDE_CLI_PARALLEL=1` (`llm.py:1904`) — an exact fit for a serialized sweep. This gives a
**headless, subscription-billed** semantic path with zero live-session context cost. Note the
subscription pools are the ones `~/.cc-limits` tracks: "free" means "spent somewhere you already
watch." GLM via OpenRouter is `needs-env-config`; one full ccrc semantic build ≈ **$2.10** (measured
corpus: 124 markdown files, 8,127,477 chars, 467 slice-units ≈ 2.05M input tokens; code never reaches
the LLM, `__main__.py:4678`). Fleet-wide ≈ **$75, extrapolated not measured**.

**The reason to decline is the measured 0.92% edge yield, not the price.** A cheaper backend does not
make the layer produce the bridge it has never produced.

---

## Appendix B — why hook-driven session-side extraction was rejected

The operator proposed that a Claude-Code hook could trigger semantic extraction using the session
itself as the LLM. Mechanically coherent — a hook cannot dispatch subagents but *can* inject context,
as `hook-guard` already does. Rejected on four measured grounds:

1. **A dispatch deadlock.** A graphify turn flips hookstate to `working`, and dispatch refuses on
   exactly that — `worker-busy`, `server/src/coord/dispatch.ts:482-483`. The coordinator has already
   ended its turn (clause 7 forbids polling) and is asleep, so nothing retries. The program wedges with
   nobody awake to clear it.
2. **It halts unattended anyway.** `SKILL.md` Step 2: over 500 files, *"Wait for the user's answer
   before proceeding."* ccrc has **763 tracked files**. A fleet worker has no human to answer.
3. **Pinned-clause conflicts.** Worker clauses 6, 9 and 11 (`ccd/worker-skill/SKILL.md:63,66,68`) and
   coordinator clause 7 (`:61`) all exclude it; every clause is pinned verbatim by
   `server/test/{worker,coordinator}-skill.test.ts`, so accommodating the nudge means editing a pinned
   clause — a red suite by construction.
4. **It compacts the wave's context.** ESTIMATE: ~25 subagents at ~46k input tokens each, with the host
   paying ~80–120k. ccd auto-compacts an idle session past `COMPACT_THRESHOLD=50` after
   `COMPACT_QUIET=60` (`ccd/ccd:142-144`). The refresh would trigger a `/compact` of exactly the
   working context the wave cannot afford to lose.

Also noted: `SessionStart` is the worst possible placement — dispatch injects `/clear` for wave ≥ 2
(`dispatch.ts:485`), and a hook there would inject into the window D-1 exists to keep clean.

---

## Appendix C — provenance

Six parallel investigations on the live fleet box, 2026-08-27: install machinery and constraints
(6 lanes); refresh route with adversarial per-route verifiers (5 lanes + 4 refuters + judge); store
topology (3 lanes); corpus policy (3 lanes + measurement); semantic depth (4 lanes); hook-driven
extraction (3 lanes). Then an adversarial spec review (5 lanes + verifying synthesiser) which returned
**13 must-fixes** and, importantly, **5 false positives it caught in its own lanes** — including one
asserted independently by three of them.

Claims marked **[re-verified]** in §3 were re-run by the author against the live box. Three dossier
claims were **corrected** by that re-run and appear here in corrected form: the "unidentified snapshot
writer" is `export.py:33 backup_if_protected`; T6 of the tooling brief is a
recommendation-unless-overruled, not an operator ruling; and revision 1's own `__main__.py:285`
citation for the skill source pointed at the sidecar resolver rather than the skill body.
