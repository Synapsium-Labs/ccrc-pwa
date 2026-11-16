# The delegation broker's Rider: build notes (run 2237)

Plan: [`2026-11-16-delegation-broker-rider.md`](../2026-11-16-delegation-broker-rider.md). These notes are for the
coordinator to fold into the programme ledger; they do not edit it.

## T1. Census of the seven verbs' callers

Read on `main` before any edit. "Entry" is the installed direct entry (`~/.local/bin/ccd`, `ccd/ccd-entry.py`); "body"
is `ccd/ccd` started directly (`bash ccd/ccd …`, or `"$0"` from inside the body).

| Verb | Caller | How it starts ccd | Relies on startup state `-p` drops? |
|---|---|---|---|
| `ws-archive` | server: the archive route (`server.ts`), the failed-run close (`coord/close.ts`), the stale-archive sweep (`coord/staleArchive.ts`), all through `CCD_ARGV.wsArchive` | the agent's `exec` op (`resolveSpawnCmd` gives `~/.local/bin/ccd`), or the server's local runner with `cfg.ccdBin`, the same path: **the entry** | No. The agent and the server run as systemd units whose environment carries no `BASH_ENV`, `ENV`, exported function, `SHELLOPTS`, `BASHOPTS`, `CDPATH` or `GLOBIGNORE`, and the body reads none of them (it sets `CDPATH=` and `POSIXLY_CORRECT` itself where it needs them) |
| `ws-restore` | server: the restore route (`server.ts`), through `CCD_ARGV.wsRestore` | **the entry**, as above | No, as above. The verb starts the session through `_spawn_start` (tmux) and `_ws_supervise` (the unit); a tmux server it starts gets the entry's cleaned environment, which lacks only the startup variables |
| `ws-reap` | server: the reap route (`server.ts`), through `CCD_ARGV.wsReap`, gated `--expect` in the agent whitelist | **the entry**, as above | No, as above |
| `ws-rm` | the operator, by hand; no server or agent composer (ungrantable in `agent/src/whitelist.ts`) | the entry from a shell, or the body directly | No: the body defines and imports nothing from startup |
| `ws-gc` | the operator, by hand (listing and `--prune`); the body's own disk-floor message points at it; no server or agent composer (ungrantable) | the entry from a shell, or the body directly | No. The listing still runs under `-p` (row below) |
| `roll` | none: **no `roll` verb exists in the body** (D-8667) | an unknown verb either way | n/a |
| `claude` | none: **no `claude` verb exists in the body** (D-8667) | an unknown verb either way | n/a |

Tests: every suite of these verbs (`ccd-ws-rm-*`, `ccd-ws-reap*`, `ccd-ws-gc*`, `ccd-ws-archive-*`, `ccd-ws-restore-*`,
`ccd-archive`) starts the body directly, so none is affected. The tests that name `~/.local/bin/ccd` with these verbs
(`routes.test.ts`, `remote-runner.test.ts`, `lifecycle.test.ts`, `agent/test/exec.test.ts`) stub the runner and start no
entry. No `ccrc`, deploy script, timer or unit runs any of the seven. No caller hit a stop condition of the brief.

## T2/T3. The rows

The build: `ccd/ccd-entry.py` gains `PROTECTED_START_ONLY`, a tuple of its own, checked in `is_protected` with the same
`folds_to` as the other protected verbs, and "WHAT IS PROTECTED" names the group (D-8666, D-8668). The body's
direct-entry refusal is unchanged.

| File | Rows | On `main` before the change |
|---|---|---|
| `server/test/ccd-ws-lease-mark-reach.test.ts` | the shared table gains the `entry` class (8 shapes: `ws-rm`, `ws-reap`, `ws-gc`, `ws-gc --fast`, `ws-archive`, `ws-restore`, `roll --to 1.2.3`, `claude mem`): the launcher starts each under `-p` with its argv exact; a new case asserts the body does NOT refuse an unprivileged start of them; the `both` class keeps its refusal pin. Case variants (ASCII and non-ASCII: `ws-archİve`, `wſ-rm`, `RoŁl`, `Clåude`) with `BASHOPTS=nocasematch` start under `-p`; controls (`ws-rmx`, `ws-r`, `caps ws-rm`, `rolls`, `claude-x`, …) stay ordinary | 9 red: the 8 launcher rows and the case-variant row |
| `server/test/ccd-forbidden-verbs-entry.test.ts` (new; reworked in fix round 1, below) | the REAL body behind the rendered launcher, `BASHOPTS=nocasematch` and `LC_ALL=C.UTF-8`: 10 variants (`WS-RM demo-x`, `Ws-Rm --reason r demo-x`, `WS-REAP --expect … --session demo-x`, `WS-GC`, `Ws-Gc --prune`, `WS-ARCHIVE --session demo-x`, `ws-archİve --session demo-x`, `WS-RESTORE --session demo-x`, `ROLL --to 1.2.3`, `Claude mem`) each exit 1 with the dispatcher's unknown-verb usage and leave every file under the fixture HOME unchanged; the exact spellings still reach their own verbs; `ws-gc` and `ws-gc --fast` still list under `-p` | 8 red: each `ws-*` variant reached its verb (`ws-archİve` too: Bash folds U+0130 in `case` as in `[[`). The `roll` and `claude` rows were green on `main`, since there is no verb to reach (D-8667); their launcher rows above are their red |
| `agent/test/ccd-entry-exec.test.ts` | the agent's real `exec` op: `ws-archive --session`, `ws-restore --session` and `ws-reap --expect … --session` start under `-p`. `ws-rm` and `ws-gc` are ungrantable and `roll` and `claude` have no grant, so their rows are the server suite's | red at `ws-archive` |

`single-definition/switches-history.test.ts` pins the existing tuple's line byte for byte; it stays green because the
seven verbs are a separate tuple (D-8668).

## Mutation table

Each verb deleted from `PROTECTED_START_ONLY`, then both server files run against the mutated entry (the tracked file
restored from git after each run):

| Deleted | Rows that went red |
|---|---|
| `ws-rm` | `ws-rm alone` (launcher, `-p`); the case-variant row; `WS-RM demo-x` and `Ws-Rm --reason r demo-x` (real body) |
| `ws-reap` | `ws-reap alone`; the case-variant row; `WS-REAP …` (real body) |
| `ws-gc` | `ws-gc alone`, `ws-gc --fast`; the case-variant row; `WS-GC` and `Ws-Gc --prune` (real body) |
| `ws-archive` | `ws-archive alone`; the case-variant row; `WS-ARCHIVE …` and `ws-archİve …` (real body) |
| `ws-restore` | `ws-restore alone`; the case-variant row; `WS-RESTORE …` (real body) |
| `roll` | `roll with a tail`; the case-variant row |
| `claude` | `claude with a tail`; the case-variant row |

The same seven deletions and the deletion of the group's check in `is_protected`, run in memory by the coordinator
skill's `mutation-run.py` against `is_protected` directly: 8 of 8 killed.

## Fix round 1 (review 2313, at 9dd9a1e9c)

The coordinator's rulings: F1 fixed here; A1, A2, A3, A4 and A7 fixed; A5 and A6 no change (README's two edits are the
consented text; A6 predates this branch), carried in the ledger; A8 no action.

### F1: the census of FORBIDDEN_CCD_VERBS against the entry

`server/test/single-definition/ask-digest.test.ts` (the approval guard's area: `FORBIDDEN_CCD_VERBS` lives in
`server/src/coord/approvalguard.ts`) gains one block, appended. It derives each head from `FORBIDDEN_CCD_VERBS` (the
first word, so `ws-gc --prune` is `ws-gc`), loads `ccd/ccd-entry.py` as a Python module and asks its own `is_protected`
(both tuples) about each head, bare, upper-cased and with a tail word: no third hand-kept list. Its controls run the same
classifier on an extended list and on the source with each head deleted from whichever tuple names it.

Mutation rows, each run against the real files and restored from git after it:

| Mutation | Census row |
|---|---|
| `ws-rm` deleted from `PROTECTED_START_ONLY` | red |
| `keep-awake` deleted from the first tuple | red |
| the `PROTECTED_START_ONLY` check deleted from `is_protected` | red |
| `ws-title` added to `FORBIDDEN_CCD_VERBS` (an unprotected verb) | red |

The block's own controls repeat the deletion for every one of the 16 heads, and the addition for an invented verb.

### A1–A4, A7: the real-body rows

- A1: `ccd-forbidden-verbs-entry.test.ts`'s header now says the `roll` and `claude` real-body rows cannot go red until the
  body has those verbs (D-8667), and that the launcher rows in `ccd-ws-lease-mark-reach.test.ts` are their pin.
- A2: the `ws-gc` listing row's title says only what it checks: exit 0 and its own output (the `-p` start is the launcher
  rows' pin).
- A3: the `ws-archİve` row first asks this box's Bash whether it folds U+0130 into `ws-archive` under the forced locale.
  Where it does not, the row is skipped, and its title names the reason. Measured: with the locale forced to a name that
  does not exist, the row reports skipped with that reason, never passed.
- A4: the fixture now plants what the variants name: a live workspace (through `ws-add`), an archived one, and one whose
  directory was removed by hand. Every variant row compares every file under HOME, before its exit status and output.
  Against `main`'s entry, five rows went red on that comparison, so only those five claim it in their titles:
  `WS-RM` and `Ws-Rm --reason r` tore the live workspace down (36 paths), `WS-REAP` refused but wrote its lock and a
  lifecycle journal row, `Ws-Gc --prune` reclaimed the hand-removed workspace (16 paths), and `WS-RESTORE` removed the
  archived one's stamps (6 paths). The others claim only the unknown verb: `WS-GC` without `--prune` writes nothing even
  when it runs; `WS-ARCHIVE` and `ws-archİve` stop at `status-unknown` in a fixture HOME, because the session probe needs
  a user service bus that the harness withholds on purpose, so they changed nothing on `main` either; and `ROLL` and
  `Claude` reach no verb on `main` (D-8667). All nine variants and the U+0130 row went red on `main` (on the fixture or on
  the unknown-verb line), except `ROLL` and `Claude`.
- A7: the `entry` class's body half in `ccd-ws-lease-mark-reach.test.ts` runs the real body through `spawnSyncGroup`, as
  the sibling file does.

### Fix round 2 (the merge queue's `test (server)`, at be23d08e7)

`ccd-workspaces.test.ts`'s containment scan ("routes EVERY bash call site in every ccd test file through ALL THREE
poisons") refused A3's fold probe, which spawned a bare `bash -c` at module load. The probe now runs inside the U+0130 row,
through `spawnSyncGroup` and `ghContainedEnv` with systemd and tmux contained, and the row skips at run time with the
reason as its note (`ctx.skip(note)`). Measured: with the locale forced to a name that does not exist, the row reports
skipped with that note; against `main`'s entry it is still red.

## T4. README

- "The switch's card: Settings › Automation › Worktrees left behind": the sentence owed since PR8d (`pr8d.md`, "Owed to
  README"), set in parentheses so the sentence's comma list stays readable; the wording is the owed one.
- "Only the launcher starts a reclaim.": the sentence the README's holder agreed to, appended at the paragraph's end.

`CLAUDE.md` has no list of the protected set; the body's own header comment in `ccd/ccd` lists the verbs its guard
refuses, which this change leaves as they are, and says the launcher classifies a superset, so it stays true.

## Deviations found

- **D-8667 (2026-11-16)** — `roll` and `claude` are not verbs of the body on `main`: the dispatcher has no arm for
  either, so `ccd roll` and `ccd claude …` reach its unknown-verb usage line (exit 1). They are on
  `FORBIDDEN_CCD_VERBS` ahead of the Claude Code build lifecycle's verbs (spec 2026-10-18 §7.6), which are not built. The
  entry starts their spelling under `-p` anyway, so the verbs are covered the day they land; until then only the
  launcher rows can tell a protected start of them, and their real-body rows pass on `main` as well.
- **D-8668 (2026-11-16)** — the seven verbs go in a tuple of their own, `PROTECTED_START_ONLY`, rather than in
  `is_protected`'s existing tuple, as the plan's design put it. One reason is the different rule: the group starts
  protected but the body does not refuse it. The other is that `single-definition/switches-history.test.ts` pins the
  existing tuple's line byte for byte, as the one place a non-shell file names `delegation-adopt`, and that pin stays
  unchanged. The match is the same `folds_to` over `argv[0]`, with any tail.
