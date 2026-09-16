# Project-scoped memory — design

**Status:** approved 2026-09-08
**Author:** `ccrc-pwa-brisk-cove`
**Scope:** `ccd/session-hook.sh`, `ccd/ccrc` (install + a migration verb), `ccd/ccrc-doctor-checks`, tests.
**Deploy class:** AGENT-FIRST (`ccd/` changes ship to the fleet host before the server).

---

## The defect

ccrc exists to **follow a session across an account/wrapper swap**. Claude Code's own file-based
memory does not follow it. The memory directory is
`$CLAUDE_CONFIG_DIR/projects/<slug>/memory/`, and each wrapper account has its own
`CLAUDE_CONFIG_DIR`, so a session that swaps accounts mid-run keeps its transcript, its workspace, its
hold and its branch — and silently changes memory stores.

Measured on the fleet host, **re-taken 2026-09-09**, for this one project:

| HOME | memory files for `ccrc-pwa` | in roster? | session hook? |
|---|---|---|---|
| `.claude` | 30 | yes (`claude`) | yes |
| `.claude-corp` | 15 | yes (`claude-corp`) | yes |
| `.claude-dev0` | 10 | yes (`claude-dev0`) | yes |
| `.claude-personal` | 6 | yes (`claude2`) | yes |
| `.claude-expoai` | 5 | yes (`claude-expoai`) | yes |
| `.claude-gpt` | 0 | yes (`gpt`) | yes |
| `.claude-glm` | 0 | **no** | **no** |
| `.claude-kimi` | 0 | **no** | **no** |

**An earlier draft of this table was wrong in three ways, and the error is itself a design input.** It
listed five homes, not eight; it reported `.claude-expoai` as empty when it holds five files; and it
recorded a home called `.claude2` as absent. There is no `~/.claude2` — the roster entry `claude2`
declares `configDirSuffix: .claude-personal`. The homes had been enumerated **by account id** instead
of by the roster's own `configDirSuffix`, which is the "derive, never hand-maintain" rule this repo
already enforces elsewhere. Any implementation that enumerates homes must derive them, and §4 says
from what.

The failure is not theoretical and not cosmetic. On 2026-09-08 a session swapped to `claude-dev0`
mid-run and read an index from 06:05 that still said the account-health branch needed 29 deviation
numbers minted — work that had been merged and deployed hours earlier. **A durable record written by
this session, about this session's own work, was invisible to it after the swap.** Memory that
contradicts reality is worse than absent memory, because it is acted on.

Fleet-wide the fragmentation is **40 real memory directories across 8 agent homes covering 13 distinct
projects**, plus **8 directories that are already symlinks** (§ "prior art" below).

**The roster is not a census of agent homes, and this is not a temporary state.** Two homes on disk —
`.claude-glm` and `.claude-kimi` — are in no roster entry. They are Claude Code pointed at other
model providers (GLM via Cortecs, Kimi K3), and more will follow: the fleet's own model-routing policy
names an overflow tier and a handoff lane, and both arrive as new `CLAUDE_CONFIG_DIR`s. Any design
that enumerates "the accounts" rather than "the homes" is already incomplete on the day it ships.

### The fork mechanism — measured, not assumed

The first hypothesis was that the harness rewrites `memory/` as a plain directory and clobbers any
symlink. **That is false**, and the evidence against it is unusually strong: two memory directories in
`.claude-corp` have been symlinks since **2026-07-15 22:06** and are intact 55 days later, with a
write through one of them at 21:20 on 2026-09-08. (The two project slugs are deliberately not named:
`topology-clean.test.ts`'s `fleet account label` class forbids one of them in tracked text, and the
count and the dates are the whole of the evidence — the names carried none of it.)

The real mechanism is quieter: **the harness creates a plain `memory/` directory in any home that does
not already have one.** `.claude-dev0` holds a real, empty `custom-tools/memory` — created *after* the
`.claude-corp` symlinks were made, in the one home nobody converged.

This is the fact the design turns on. A fork needs no clobbering and produces no error. **Any home you
do not converge forks on its first session**, and new wrapper accounts arrive over time — so a
one-time sweep is structurally insufficient.

### A second defect in the existing prior art

The hand-made symlinks are more numerous than first measured — **8 of them, across 2 homes**
(`.claude-corp` × 2, `.claude-personal` × 6), covering 7 distinct projects. Every one points at
`~/.claude/projects/<slug>/memory`, which makes **one account's HOME the master** for every other.
Retire, reset or lose `.claude` and every shared store on the box goes with it. No script owns them;
they were made by hand on 2026-07-15 and never extended to a third home.

That they were never extended is the point. Hand convergence does not keep up with a fleet that grows
new homes, which is precisely why §2 puts convergence in a mechanism rather than in an operator's
memory.

### A third defect: two homes the mechanism could never reach

`.claude-glm` and `.claude-kimi` carry a `settings.json` that does **not** reference
`~/.cc-sessions/session-hook.sh`. The hook is a single shared file, referenced per home — so a home
that does not reference it never runs it, and would never converge no matter how correct §2 is.
`.claude-glm` already holds one memory directory.

This is the same shape as the original defect one level up: **a home nobody wired in forks silently.**
§4 is what makes it audible, and it is why §4 must enumerate the filesystem rather than the roster.

---

## Design

### 1. Layout

One store per project, in ccrc's own state directory:

    ~/.ccrc/memory/<slug>/

`<slug>` is the same slug Claude Code uses for `~/.claude*/projects/<slug>/` — a pure function of the
project path. Each wrapper's `$CLAUDE_CONFIG_DIR/projects/<slug>/memory` becomes a symlink to it.

**Only the `memory` subdirectory is shared.** Session transcripts (`*.jsonl`) sit beside it in the same
`projects/<slug>/` directory and stay per-account: they are that account's own records, and merging
them would be a different feature with different risks.

Why `~/.ccrc/` and not a wrapper HOME: it is neutral (no account is the master), it is ccrc-owned state
alongside `accounts.json` and `build.json`, and it can never enter a git repo — which matters because
this repo is bound for public release and memory carries operational detail.

### 2. The hook converges, and never merges

`ccd/session-hook.sh` already runs on SessionStart and is an artifact ccrc owns outright. It resolves
`(CLAUDE_CONFIG_DIR, project dir) → slug` and ensures the link.

**Corrected 2026-09-09 (R32, whole-branch review) — the design's own premise about "project dir" was
wrong for a git worktree, and this is the one finding that changed a shipped rule rather than adding
to one.** The implementation shipped first (D-2178) took the shortest path to "resolves … → slug":
read the slug the harness already computed, off `dirname(transcript_path)`. That is correct only
because Claude Code's transcript and memory directories are normally the same directory. They are
not inside a git worktree: the harness files the **transcript** under the session's **cwd** slug and
the **memory** directory under the **repository's main-checkout** slug. Measured read-only on the
fleet: 248 worktree-shaped slugs across 8 homes, not one holding a `memory/` entry, sitting beside
project directories that hold memory files and zero transcripts — every worktree session on this
fleet was converging the wrong pair. The mechanism minted an empty, permanent store per workspace
ever created, left the real pair forked forever, and made the census print `converged` for a pair
that does not exist beside `forked` for the one that does. "Project dir" therefore means the
**project root** — the parent of `git rev-parse --git-common-dir` (the main checkout's `.git` from
anywhere inside the repository, worktree or subdirectory alike; `--show-toplevel` would answer the
worktree instead) — not the transcript's own parent directory, and the slug is now computed from it
rather than read off the payload. Computing it is safe only because of the existence check already in
§2's table: `<config dir>/projects/<slug>` must already exist before the hook acts, so a derivation
that misses names a directory the harness never made, and the pair is skipped — the `remember`
plugin's own #294 failure mode (D-2178's original reason for reading rather than computing) reduced
to a silent no-op instead of a junk-store factory.

It acts **only where there is nothing to lose**:

| State of `<HOME>/projects/<slug>/memory` | Action |
|---|---|
| symlink to the correct store | no-op |
| absent | create store if needed, create symlink |
| plain directory, **empty** | replace with symlink |
| plain directory, **non-empty** | **do not touch** — report |
| symlink pointing elsewhere | **do not touch** — report |

The last two rows are the whole safety argument: **a hook that fires on every session start must never
merge data.** Migration is an explicit operator act (§3). The steady-state cost is one `[ -L ]` test,
so it stays free across ~20 concurrent sessions.

The hook must also degrade silently when `CLAUDE_CONFIG_DIR` is unset (a non-wrapper session) rather
than guessing a home.

### 3. Migration is an explicit operator act

A `ccrc` verb performs the one-time union of the 28 existing directories into the 13 stores.

**The conflict rule is: no silent winner.** Files unique to one home move across unchanged. A
same-named file whose content **differs** between homes is not resolved — **both are kept**, the
incoming copy suffixed with its home, so nothing is ever chosen on the operator's behalf. A backup of
each source directory is taken before it is replaced.

`MEMORY.md` is the one exemption, and it is exempt because it is **derivable**: it is an index of one
line per memory file, derived from each file's own `name`/`description` frontmatter. **Corrected
2026-09-09 (whole-branch review):** not every memory file carries that frontmatter — measured 6 of
801 fleet-wide — and "derivable" does not mean "universal": a file with no `name:` line is dropped
from the index (there is nothing to derive a line from) but is never silently lost from the run's own
report, and no name is invented for it — the rebuild counts what it dropped and names the count and
the store in a `NOTE:` line, the same discipline §3's conflict rule already applies to a suffixed
copy. It is therefore **rebuilt** from the union rather than merged. This also removes the
steady-state risk that sharing introduces (§6).

Measured against `ccrc-pwa` across the **five** homes that hold it (re-taken 2026-09-09): 66 file
instances, **57 distinct filenames**, of which **52 are unique to one home** and union trivially.
**Five filenames appear in more than one home**; two of those are byte-identical and also union
trivially, and **three differ**. Of the three, `MEMORY.md` is rebuilt rather than merged, leaving
exactly **two files needing a human**: `account-pools-program.md` and
`graph-sweep-exit-code-is-a-claim.md`.

That the human-judgement count stayed at two while the file count grew from 47 to 57 is the useful
signal here: **divergence is broad but shallow.** Homes accumulate different memories far more often
than they contradict each other, which is what makes a union the right primitive and a silent winner
the wrong one.

The **8** pre-existing symlinks are re-pointed from `.claude` to the neutral store as part of this.

### 4. `ccrc doctor` makes a fork loud — and enumerates the DISK, not the roster

A check that walks every agent home against every project with a known store and reports any
unconverged pair.

**It discovers homes from the filesystem** — every `~/.claude*` carrying a `projects/` directory —
**and not from the roster.** This was left open in the first draft and the measurement closed it:
`.claude-glm` and `.claude-kimi` exist, hold memory, and are in no roster entry. A roster-driven check
would have reported PASS while the exact homes most likely to fork went unexamined. The roster
describes accounts ccrc *places work on*; it was never a census of homes on the box, and using it as
one is how the first draft's own table came to be wrong.

The check must therefore report three distinct things, never collapsing them:

| condition | meaning |
|---|---|
| home has a correct symlink | converged |
| home has a plain `memory/` dir | **forked or about to fork** — name the home and project |
| home does not reference the session hook | **unreachable by §2** — FAIL, name the home |

**Corrected 2026-09-09 (R33, controller ruling, whole-branch review): the two FAIL rows do not carry
the same severity.** `cmd_install` ends every role arm with `cmd_doctor`, and `cmd_doctor` returns
non-zero the moment any check FAILs — so a FAIL on the forked row hard-dies `cmd_update` *before* its
supervisor sweep runs, on every box that has ever run more than one agent home, until the operator
runs the one irreversible `ccrc memory --apply`. A fork is that box's expected *pre-migration* state,
not a misconfiguration; an unreachable home is a misconfiguration nothing repairs on its own. The
forked row is therefore a **WARN** (remedy: `ccrc memory --apply`) and only the unreachable row stays
a **FAIL** — the check still reports three conditions and never collapses them, but two severities
now carry the difference the two remedies always implied.

The third row is what `.claude-glm` and `.claude-kimi` need, and it is a different failure from the
second: a home can be perfectly converged today and still be unable to *stay* converged.

This is the most load-bearing piece in the design, and it is worth being explicit about why: **the
entire defect existed because a fork is currently silent.** Nothing on the box reports that two homes
disagree about a project's memory. A convergence mechanism without a detector would simply move the
silence one layer down — the next un-converged home would fork exactly as `.claude-dev0` did, and
nothing would say so.

### 4a. New homes, and agents that are not Claude Code

Two different futures, and they are not the same problem.

**More `CLAUDE_CONFIG_DIR`s — already happening, and handled.** `gpt`, `glm` and `kimi` are Claude
Code pointed at other providers. The memory layout is identical because it is a property of the
harness, not of the model, so §1–§4 cover them with no special case: everything keys on
`CLAUDE_CONFIG_DIR` and the slug, and nothing anywhere reads a model or provider name. A new home
converges on its first session **provided its `settings.json` references the shared session hook** —
which is exactly the gap §4's third row exists to catch, and which `ccrc install` is the natural place
to close.

**A genuinely different harness — Codex CLI (`CODEX_HOME`), Gemini, or another agent — is OUT OF
SCOPE, deliberately.** Such an agent has its own memory layout, its own slug function, and possibly no
per-project memory at all; inventing a neutral abstraction over a layout nobody has yet measured would
be designing against an imagined interface. What this design owes the future is narrower and
achievable: **the store must not be named after Claude.** `~/.ccrc/memory/<slug>/` is a ccrc-owned
path with no harness in its name, so a second harness can be pointed at the same per-project store
later without moving anything or migrating a second time. That is the whole commitment — a path that
does not have to change, not a mechanism built before its requirements exist.

### 5. What this does not do

- It does not touch transcripts, and does not merge them.
- It does not touch the `remember` plugin's store (`<project>/.remember/`). That store is **already**
  project-scoped and already survives swaps; it is not part of this defect.
- It does not write to any `CLAUDE.md` at any level, and does not modify any operator-authored file —
  the 2026-09-02 ruling. The integration lives in `ccd/session-hook.sh`, `ccd/ccrc` and
  `ccd/ccrc-doctor-checks`, all ccrc-owned.
- It does not attempt cross-machine memory. The store is machine-local, exactly as the wrapper HOMEs
  it replaces are.

### 6. The risk this introduces, stated

Sharing **widens write contention**. Today a store is isolated per account, so concurrent sessions
collide only within one home. Shared, every session on a project — across all five accounts — writes
one `MEMORY.md`, and a read-modify-write on a single index file can lose a line.

This is a widening of an existing risk rather than a new class: several sessions already share
`.claude`'s store today. The mitigation is §3's derivability rule — treat `MEMORY.md` as a rebuildable
index rather than an authored file, and a clobbered index **self-heals** instead of silently dropping
a line. That is the same failure mode that produced this design, so it must not be reintroduced by the
fix.

---

## Verification

Every guard ships with its mutation measured RED (mutation-table discipline).

The measurements this design rests on, to be re-taken before implementation since the fleet moves:

1. The two `.claude-corp` symlinks are intact and written through (durability evidence).
2. `.claude-dev0`'s empty `custom-tools/memory` exists (the fork mechanism).
3. The union's shape for `ccrc-pwa`: 57 distinct files, 52 unique to one home, 5 colliding by name,
   3 of those differing in content (the migration's real cost).
4. The home census itself — **derived from `configDirSuffix` AND from the filesystem, never from
   account ids** — and which homes reference the session hook.

**Re-take all four before implementing.** They have already moved once between the first draft and
this one, in a single day: five homes became eight, 28 directories became 40, 47 files became 57, and
two pre-existing symlinks became eight. A census in this document is a snapshot, and the plan that
follows must measure rather than quote it.

Behavioural cases that must be pinned, in fixture HOMEs only — never against the live `$HOME`:

- Each row of §2's table, including both **do-not-touch** rows, which are the ones a careless
  refactor would turn into data loss.
- The hook is a no-op in the steady state, and does not fail when `CLAUDE_CONFIG_DIR` is unset.
- The migration keeps both copies of a differing file and never picks a winner.
- `MEMORY.md` rebuilt from frontmatter reproduces one line per memory file.
- The doctor check WARNs on a forked pair and FAILs on a home the hook cannot reach (corrected
  2026-09-09, R33 — see §4), and reports PASS once every pair is converged and reachable.

## Open questions

**Resolved 2026-09-09 by measurement, not judgement.** The first draft deferred one question: should
the doctor check enumerate every home, or only roster-named homes? It reasoned that "the roster is the
smaller and more honest set, but a home outside the roster is exactly where an un-noticed fork would
live." The second half was right and the first half was wrong: `.claude-glm` and `.claude-kimi` are on
disk, hold memory, and are in no roster entry. §4 enumerates the filesystem. There was no judgement to
make once the homes were counted.

No open questions remain. Two items are deliberately scoped OUT rather than deferred, and are recorded
so a later reader does not mistake absence for oversight:

- **A non-Claude-Code harness** (Codex, Gemini) — §4a. The commitment is a harness-neutral store path,
  not a mechanism.
- **Cross-machine memory** — §5. The store is machine-local, exactly as the wrapper HOMEs it replaces
  are. Making memory survive the box is a different feature with different failure modes.
