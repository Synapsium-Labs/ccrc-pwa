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

Measured on the fleet host, 2026-09-08, for this one project:

| HOME | memory files for `ccrc-pwa` |
|---|---|
| `.claude` | 29 |
| `.claude-corp` | 15 |
| `.claude-dev0` | 9 |
| `.claude-expoai` | 0 (directory present, empty) |
| `.claude2` | absent |

The failure is not theoretical and not cosmetic. On 2026-09-08 a session swapped to `claude-dev0`
mid-run and read an index from 06:05 that still said the account-health branch needed 29 deviation
numbers minted — work that had been merged and deployed hours earlier. **A durable record written by
this session, about this session's own work, was invisible to it after the swap.** Memory that
contradicts reality is worse than absent memory, because it is acted on.

Fleet-wide the fragmentation is **28 real memory directories across 5 homes covering 13 distinct
projects**.

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

Those two hand-made symlinks point at `~/.claude/projects/<slug>/memory` — which makes **one account's
HOME the master** for every other. Retire, reset or lose `.claude` and every shared store on the box
goes with it. No script owns those links; they were made by hand and never extended.

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

`MEMORY.md` is the one exemption, and it is exempt because it is **derivable**: it is an index of
one line per memory file, and every memory file carries its own `name` and `description` in
frontmatter. It is therefore **rebuilt** from the union rather than merged. This also removes the
steady-state risk that sharing introduces (§6).

Measured against today's data for `ccrc-pwa`: 47 distinct files, of which **43 are unique to one home**
and union trivially. **Four filenames appear in more than one home**; one of those four is
byte-identical across homes and also unions trivially, and **three differ**. Of the three that differ,
`MEMORY.md` is rebuilt rather than merged, which leaves exactly **two files needing a human**:
`account-pools-program.md` and `graph-sweep-exit-code-is-a-claim.md`.

The two pre-existing symlinks are re-pointed from `.claude` to the neutral store as part of this.

### 4. `ccrc doctor` makes a fork loud

A check that walks every wrapper HOME against every project with a known store and reports any
unconverged pair.

This is the most load-bearing piece in the design, and it is worth being explicit about why: **the
entire defect existed because a fork is currently silent.** Nothing on the box reports that two homes
disagree about a project's memory. A convergence mechanism without a detector would simply move the
silence one layer down — the next un-converged home would fork exactly as `.claude-dev0` did, and
nothing would say so.

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
3. The union's shape for `ccrc-pwa`: 47 distinct files, 43 unique to one home, 4 colliding by name,
   3 of those differing in content (the migration's real cost). Re-take it — other sessions write
   memory continuously, so these numbers move.

Behavioural cases that must be pinned, in fixture HOMEs only — never against the live `$HOME`:

- Each row of §2's table, including both **do-not-touch** rows, which are the ones a careless
  refactor would turn into data loss.
- The hook is a no-op in the steady state, and does not fail when `CLAUDE_CONFIG_DIR` is unset.
- The migration keeps both copies of a differing file and never picks a winner.
- `MEMORY.md` rebuilt from frontmatter reproduces one line per memory file.
- The doctor check FAILs on an unconverged pair and PASSes once converged.

## Open questions

None blocking. One judgement is deliberately deferred to the plan: whether the doctor check should
enumerate every wrapper HOME × every store, or only the homes named in the roster. The roster is the
smaller and more honest set, but a home outside the roster is exactly where an un-noticed fork would
live.
