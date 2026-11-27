# ccd's Windows twin in Node — design

Status: superseded by `2026-11-24-ccrc-go-core-design.md` for everything ahead (the twin is now a Go core). Design, approved section by section by the operator on 2026-11-22.

## 1. Problem

On Windows, ccrc runs ccd and its sibling scripts under MSYS2. MSYS2 has no `fork()`, so it emulates one:
it starts a new process and copies the parent bash's memory into it. ccd is one bash file of about 49,000
lines (837 functions, 2,111 `$(…)` substitutions), and a single operation starts dozens to hundreds of
processes. Measured on the reference Windows box on 2026-11-22:

| | MSYS2 on Windows | WSL (Linux) |
|---|---|---|
| one process start | 351 ms | 0.6 ms |
| one `$(…)` | 198 ms | 0.4 ms |
| `ccd help` in a fixture HOME | 1,819 ms | 7 ms |

These figures were taken with a test run going in the background, so they are high, but the gap holds on a
quiet box too. The ccd test files run about 23.5 times slower on Windows than on Linux; the TypeScript
suites run at the same speed on both.

The live box pays the same price. The manager's journal for 2026-11-22 (taken under test load, so high):

| unit | runs | median run | total for the day |
|---|---|---|---|
| `ccd-tmp-sweep` (hourly) | 6 | 25 min | 142 min |
| `ccrc-settings` (every 5 min) | 74 | 118 s | 136 min |
| `ccd limit-watchdog` (every minute) | 368 | 16 s | 127 min |
| `ccd-scope-sweep` (every minute) | 368 | 13 s | 98 min |
| `ccd-graph-sweep` | 25 | 138 s | 67 min |
| `ccrc watchdog` (every minute) | 369 | 3.4 s | 29 min |

The session hook and the server tick's ccd calls do not appear in that journal and are measured in wave 0
(§5).

Cygwin, Git Bash and MSYS2 share the one emulation, so none of them is faster. busybox-w32 does not run
bash. WSL2 runs at Linux speed but moves the sessions into Linux, which is not what the Windows port is for.

## 2. Decision

ccd gets a **permanent Node twin on Windows**. Linux keeps bash. The twin is a Node command-line
program that takes the same arguments and gives the same output, exit codes and file effects as the bash
it stands in for, one entry point at a time.

**Operator ruling, 2026-11-22.** This is a deliberate exception to three standing rules:
- one owner per fact;
- consolidate, don't duplicate;
- "Rejected: compiling policy across languages" (2026-10-19, O2 (b)): one rule set is written once.

The "legitimately different" reason is another operating system: there, a process start costs two to three
orders of magnitude more. The exception is bounded by §6's parity tests. Without them the twin is a defect.
The 2026-10-19 rule stands for everything else. The architecture spec's ruling list records this exception.

Two other approaches were weighed and not taken:
- a twin that lives inside the Windows manager, with the CLI and the hook as its clients: fastest, but the
  manager becomes a single point of failure, and every fixture HOME would need the daemon;
- a hybrid that runs only the every-minute passes inside the manager: saves under a second a minute over
  the chosen shape, at the daemon's cost.

The operator also chose speed on the live box, not test speed, as the measure of success.

## 3. Architecture

**The hand-off is the installed launcher, not bash.** `~/.local/bin/ccd` is the direct entry rendered
from `ccd/ccd-entry.py`. It already checks the SHA-256 of the bash body and starts it under `bash -p`.

On Windows the launcher looks the entry point up in the twin's table:
- **listed:** it starts `node` on the twin's bundle, checked by digest the same way as the bash body;
- **not listed:** it starts bash, as now;
- **on Linux:** it always starts bash.

A listed entry point never makes bash parse its 49,000 lines.

Sibling scripts and `ccrc` start from their own installed entries. Each of those entries gains the same
table lookup before bash starts.

This keeps the ruling against runtime-sourced siblings (2026-10-26): the twin is one fixed file with a
checked digest, chosen by a fixed table, as ccd's libraries are.

**Protected verbs.** The protected verbs (`ws-reclaim`, `ws-expire`, `ws-collect`, `ws-orphan`,
`scratch-rescue`, `ws-shed-deps`, `keep-awake`, `ws-lease-mark` and the rest of the direct-entry set)
rely today on `bash -p`, which imports no shell functions. The twin's equivalent is a node started with
`NODE_OPTIONS`, `NODE_PATH` and the other module-loading variables removed from its environment. The
launcher does this for every twin start, and a test pins it.

**Code.** The twin lives in `ccd/node/`, with one module per entry point and one shared layer. The
shared layer covers:
- registry files;
- locks (§4);
- `tmux`, read once per pass with `list-panes -a`, not once per session;
- `git`;
- `systemctl` through the manager's shim.

Modules import the vocabulary from `shared/` (deny rules, caps words) and keep no copy of it.

The twin is still the anti-corruption layer: it alone names tmux, the registry layout and Claude Code's
files. The server still reaches it only through `CcdArgv` and the agent link. Nothing on the server side
changes, and there is no port over ccd (the architecture spec's ruling list rejects one).

**The table.** `ccd/node/verbs.json` lists every entry point the twin owns: a ccd verb, or a sibling script
such as `ccd-scope-sweep` or `ccrc watchdog`. For each it names the bash functions it stands in for and
the test files that pin it. Three readers use it, and it is their only source:
- the launcher;
- the parity guard (§6);
- `ccd caps`, which reports `node:<entry>` for each listed entry so that the server and doctor can see which
  implementation runs it.

doctor gets one check: the twin bundle's digest matches the one shipped.

## 4. Data, locks and failure

**Same files, same bytes.** The twin reads and writes `~/.cc-sessions`, `~/.cc-limits`, `.prhistory` and
`$REG/*` in exactly the formats the bash writes, because both run on the same box at the same time. The
twin adds no files and no formats.

**Locks are the main risk.** ccd takes `flock` in about 107 places. Under MSYS2, `flock` is Cygwin's own
emulation, which a Windows Node process cannot see. The twin therefore takes each lock through the same
MSYS2 `flock` binary, which it holds as a child process for the length of the critical section. That costs
one process start per lock, not hundreds per operation.

A shared `mkdir` lock in both implementations was considered and rejected, because it would change Linux.

The first PR of wave 1 is the cross-implementation test: bash and Node compete for one lock, and neither
may enter while the other holds it.

**Failure.**
- The launcher picks the implementation once, before the start.
- When the twin fails, it fails with its own exit code and message, and nothing retries the operation in
  bash: a half-done operation redone by the other implementation would act twice on the registry.

**Off switch.**
- The file `$REG/ccd-node-off` sends every entry point back to bash. A line in it naming an entry point sends
  only that one back.
- Like the other kill switches, nothing in the tree writes it: the operator touches or removes it by hand.

## 5. Waves

**Wave 0 — measure.** While the marker `$REG/ccd-entry-timing` stands, the launcher appends one line per
run to `~/.ccrc/ccd-entry-timing.log`: the entry point and its duration. It records no arguments, because
they can carry paths. Like the off switch, the marker has no writer in the tree.

Two more measurements fill the gaps the manager's journal leaves:
- the session hook's duration per tool call;
- the server tick's ccd calls.

After one day this gives the cost table that orders the waves.

**Provisional order**, from what is already measured. Wave 0 may reorder it.

1. The session hook. It runs on every tool call in every session.
2. `ccd limit-watchdog` and `ccd-scope-sweep`. Each runs every minute and takes 13 to 16 s.
3. The ccd calls behind the server tick: `caps` and the state reads. The tick takes 13 to 24 s now.
4. `ccrc watchdog` and `ccrc settings`. The settings run's 118 s median looks like a timeout, so it is
   investigated as a defect before it is ported.
5. `ccd-tmp-sweep` and `ccd-graph-sweep`.

A wave is done when all three hold:
- CI is green in both modes (§6);
- the Windows bench is green in Node mode;
- the targets below are met on the live box for the entry points the wave moved.

Green tests with a missed target do not close a wave.

**Targets.** They are measured on a healthy box: no orphaned test processes, and memory not near its commit
limit. Those conditions are recorded beside every figure.
- the hook, under 300 ms per call;
- the server tick, under 3 s;
- each every-minute timer, under 2 s.

## 6. Tests and parity

**One set of tests for both implementations.**
- The harness (`makeCcdHarness`) takes `CCD_IMPL=bash|node` and starts ccd through the launcher's own
  choice, so a test does not know which implementation answered.
- Tests at the command-line level run in both modes for each listed entry point.
- Tests that call bash functions directly (`ccdSource()`, `CCD_HARNESS_SRC`) cannot run against Node. Before
  an entry point moves, they are written again as characterization tests of its Node module, with the same
  inputs and outputs, green against the bash first.
- The plan counts both kinds for each entry point.

**Parity in Linux CI.** The twin is Node, so it runs on Linux too. Each listed entry point's test files run
twice in Linux CI, once with `bash` and once with `node`, so parity needs no Windows runner. In the fast
pull-request run, both modes run when a change touches any of:
- `ccd/node/**`;
- `verbs.json`;
- a bash function that `verbs.json` assigns to an entry point.

**Guards**, each with a test that goes red when the guard is removed:
- every entry point in `verbs.json` names test files that really run in both modes;
- a change to a bash function that `verbs.json` assigns to an entry point, with no change to that entry
  point's Node module, is red unless the pull request records that the behaviour did not change;
- the twin holds no copy of `shared/` vocabulary; the existing `single-definition` scans cover `ccd/node/`.

**On Windows**, after each wave:
- the bench runs the same files in Node mode;
- the live box's unit timings and the hook measurement are taken again, and set against wave 0.

## 7. Out of scope

- Linux: it keeps bash, and nothing here changes how it runs.
- WSL2 as a way to run ccrc on a Windows machine.
- A Go or Java version of any part of ccd.
- Making the bash itself start fewer processes. It would help both platforms, but it is a separate change.
