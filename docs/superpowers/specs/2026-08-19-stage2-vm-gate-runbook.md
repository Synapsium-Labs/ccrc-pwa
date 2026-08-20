# Stage 2 VM gate — the operator's fresh-install proof

**Status: PENDING-OPERATOR.** Everything this document depends on is shipped and tested — `bash
install.sh`, `ccrc install`, `ccrc doctor`'s A2-NEW remedy, the per-box `--remote-control` flag
(D-99..D-101), the dialog fix (D-102) — but every claim behind those commits is a hermetic-suite
measurement over a fixture `$HOME`, never a real box. This document is the instrument that closes
the gap: an operator runs it once, against one real machine, and either the gate passes for real or
this document tells them exactly what a failure means. Until that run happens, "stage 2 works" is a
claim about source code, not about a computer.

## The key question this run answers

Every RC-off pane fixture in this repository (`server/test/fixtures/panes/`, the invented
`RC_OFF_READY_PANE` in `server/test/ccd-rc-flag.test.ts`) is **hand-built**, because no one has
`tmux capture-pane`d a real Claude Code session that was launched *without* `--remote-control`. The
whole first-run-detection path (`ccd`'s `_accept_first_run_prompts`) depends on a specific claim
about what such a pane renders: that the permission-mode footer —
`⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents` — appears on an RC-off pane the same
way it does today's RC-on captures, with no `/rc active` anywhere near it.

**If that claim is wrong** — if a real RC-off pane renders some *other* set of ready markers, or
none of the ones `ccd`'s marker regex already matches — then `_accept_first_run_prompts` sits out
its full ~15-minute window and answers **rc 4** on *every* spawn on *every* fresh install. That is
not a cosmetic gap: it is the difference between "the installer works" and "the installer times out
on its first session, always."

This document exists to convert that invented fixture into a measured one, once, on a real box. See
"The deliverable beyond pass/fail" below for exactly what to capture and where it goes.

## Prerequisites

- A fresh Ubuntu VM (or container with systemd — `ccrc install` enables user linger and systemd
  user units, so a systemd-less environment will not converge). No prior ccrc/Claude Code state.
- `node` at or above the floor `server/package.json`'s `engines.node` declares. `install.sh` reads
  that value itself and refuses with the actual number if the box is below it — do not hand-copy the
  version here; let the script tell you.
- `git`, `rsync` (a hard by-name dependency of `ccrc install` — absent, the install refuses naming
  the package rather than failing opaquely mid-copy), and normal build tooling for `npm ci`.
- `diff` (diffutils). It joined the by-name set with the skills step below: both skill installers
  refuse rather than rewrite a skill directory blind without it, and their refusal is fatal to the
  install. It ships in a base Ubuntu, so this is a note about containers stripped below that, not
  about an ordinary VM.
- A way to install Claude Code on this box when the time comes (however you normally obtain the
  `claude` binary) — deliberately not scripted here; this repo does not install Claude Code and the
  doctor remedy below tells you what path it needs to land at.
- A tmux and terminal you can watch the spawned session in, and a browser (or `curl`) that can reach
  the box's `127.0.0.1:7788` — directly on the box, or tunneled if you provisioned a remote VM.

## Steps

### 1. Clone

```bash
git clone <this repo> ccrc && cd ccrc
```

### 2. `bash install.sh`

```bash
bash install.sh
```

**Expected result: exit 1.** This is not a failure of the run — it is the first measurement. A
truly fresh VM has a roster (the seeded default, one `upstream` account named `claude`) but no
Claude Code binary yet, so the closing `ccrc doctor` inside the install finds nothing at
`$HOME/.local/bin/claude` and fails on it. Confirm the transcript reads exactly this
(the sentence is quoted verbatim from `ccd/ccrc-doctor-checks:1568`;
`server/test/ccrc-install.test.ts`'s A2-NEW case pins the `FAIL wrappers: ` prefix, the
`claude has no executable at $HOME/.local/bin/claude` substring, and that the remedy names
`install Claude Code` and not `ccrc adopt` — not the full remedy sentence byte-for-byte):

```
FAIL wrappers: claude has no executable at $HOME/.local/bin/claude
  remedy: install Claude Code so its binary lands at $HOME/.local/bin/claude — that path is
  literally what ccd execs, and nothing here installs it for you; then re-run 'ccrc doctor'. If
  it lives elsewhere, symlink it there
```

and that every other `install: <step>: ...` line above it converged, closing with
`install: done — every step above converged`. **That sentence — "install Claude Code" — is the UX
this whole workstream (A2-NEW) exists to ship.** Before it, this same box got a roster-sync remedy
("`ccrc adopt`") that could not fix an absent binary and pointed a fresh operator at the wrong file.
If your transcript instead names `ccrc adopt`, or fails on a different step, stop — that is a real
regression, not an expected state, and belongs in a bug report, not a checkbox.

One of the lines above it is `install: skills: ...`, and it is the step that makes this box able to
run a coordinated program at all. It places both skill trees from the tree it just installed —
`ccd/coordinator-skill` and `ccd/worker-skill` — into `~/.cc-sessions/`, exactly where
`deploy/deploy.sh agent <host>` rsyncs them on the fleet host, and then runs each installer from the
copy it just placed there. Each installer walks the roster and converges
`<config dir>/skills/ccrc-coordinator` and `<config dir>/skills/ccrc-worker` for every rostered
account. On this box the seeded roster has one account, so confirm two paths:
`ls ~/.claude*/skills/ccrc-{coordinator,worker}/SKILL.md` — two per rostered account config dir, and
five accounts on the reference fleet host makes ten there. Both, not one: a session is placed with
no pinned account, so a swap must never land a coordinator — or a worker — on a home that has no
protocol for it, and until this step existed a self-installed box had neither skill anywhere while
the fleet lane had been shipping the coordinator's since Build 7.

Also confirm, further up the same transcript, the RC line:

```
PASS rc: off
```

**PASS is correct here even though the run exits 1 overall** — `rc` is its own check (D-101) and it
is *always* PASS: a fresh box that has never been told to run `--remote-control` is not a defect, it
is the shipped default (D-99's whole point). **Bare `off`, not `off (default)`** — by the time doctor
runs, `_inst_rc` has already written `off\n` to the flag file (`cmd_install` runs `_inst_rc` before
its closing `cmd_doctor`, in the same process), so `_dr_rc_state`'s absent-file guard is already
false and it falls through to reporting the file's actual contents. `off (default)` is a different,
narrower claim — "nobody has written this file at all" — and only appears on a box that has *not yet*
run `ccrc install` (a bare `_dr_rc_state` probe on a dev checkout, say); it will never appear in this
runbook's own transcript, because installing is what this step does.

### 3. Install Claude Code

Get a `claude` binary onto this box by whatever means you normally would, so that it — or a symlink
to it — lands at `$HOME/.local/bin/claude`. This repository does not do this step for you; the
remedy line above is the whole instruction.

### 4. `ccrc doctor` — expect green

```bash
ccrc doctor
```

Expect exit 0, and the `wrappers` line to now read a PASS. Nothing else about the box changed
between steps 2 and 4, so every other check that converged in step 2 should still converge here —
if something else goes red now, that is new information, not something this run predicted.

### 5. Decide RC, and edit the flag if wanted

The default is `off`, seeded by `_inst_rc` during install — correct for a solo, single-box install,
which has made no claim to claude.ai about running a remotely-driven session. If you want this box
discoverable at claude.ai (the reference-fleet behavior), turn it on:

```bash
printf 'on\n' > ~/.ccrc/remote-control
```

**The trailing newline is load-bearing, not decorative.** `_rc_enabled`'s reader is a bounded
`read -r` of the first line; bash's `read` returns non-zero at EOF-before-delimiter, so
`printf 'on' > ~/.ccrc/remote-control` (no newline) reads as **off** — silently. `ccrc doctor`'s
`rc` check would then report `PASS rc: off (unparseable — the file must hold one line reading 'on'
or 'off')` rather than a deliberate `off`, which is exactly the tell that the edit did not take.
Re-run `ccrc doctor` after any manual edit and read the `rc` line back before trusting it.

This runbook's own gate is the **off** path — a fresh single-box install's default, and the one no
capture exists for yet (see the key question above). If you turn RC on here, you are proving a
different, already-fixture-covered path (`ask-user-question-real.txt` and its siblings are real
RC-on captures); do the off-path run described below at least once regardless.

### 6. Spawn the first session

```bash
ccd start claude <project-name>
```

(`ccd menu` alone will not create anything on an empty registry — it refuses with `no sessions yet
— create one with: ccd start <wrapper> <project>`. `start` is what actually spawns; `menu` lists and
attaches to what already exists, which is useful for every session after this one.)

Watch it come up — first-run prompts (trust-folder, login) may need answering interactively the
first time, same as any fresh Claude Code install. Once you have a stable, idle prompt on screen,
continue.

### 7. Verify RC is really off, via the process itself — not the doctor's word for it

```bash
pid=$(tmux list-panes -t "cc-<project's session id>" -F '#{pane_pid}')
ps -o args= -p "$pid"
```

The command line ccd's `_spawn_start` handed to `exec` should be present in full — expect
`--dangerously-skip-permissions` and `--session-id '<uuid>'` (this is a fresh spawn — step 6 is this
id's first-ever `ccd start`, so `_spawn_start`'s mode is `new` and `sidflag` is unconditionally
`--session-id`; a *later* `ccd start` on this same id, once it has already run once, would carry
`--resume '<uuid>'` instead), and expect **no** `--remote-control` anywhere in it. This is the ground
truth: it is what the OS actually launched, independent of what any doctor check or flag-file read
claims.

### 8. PWA answers

```bash
curl -s http://127.0.0.1:7788/health
```

Expect `{"ok":true,...}`. Then load `http://127.0.0.1:7788/` in a browser (tunnel it if this VM
isn't local) and confirm the session from step 6 shows up on the board.

### 9. Timing

The whole sequence, steps 1 through 8, should complete in **under 15 minutes** wall-clock on a
reasonably provisioned VM (network-bound: `npm ci` twice and cloning Claude Code itself dominate).
Note the actual wall-clock time in your run notes — this document does not get to claim the number,
only report it once someone has watched a clock.

## The deliverable beyond pass/fail

A clean pass/fail on the above is necessary but is not, by itself, the reason this gate exists — the
existing test suites already prove the mechanical half hermetically. What only a real run can
produce is the measured pane. **Before tearing the VM down:**

```bash
tmux capture-pane -p -t "cc-<project's session id>" > ready-rc-off-real.txt
```

Check that file into `server/test/fixtures/panes/ready-rc-off-real.txt`, following the naming and
comment conventions the directory already uses (every other file there is a real capture; this one
would be the first RC-off real capture in the set). Then open
`server/test/ccd-rc-flag.test.ts` and update the test
`'returns 0 on the permission-mode footer alone, and sends NO keystrokes'` (in the
`_accept_first_run_prompts: a session on an RC-OFF box still reads as up` block) to read the pane
from the new fixture file instead of the hand-built `RC_OFF_READY_PANE` constant, and update that
constant's doc comment (currently: *"AN INVENTED FIXTURE, and it is labelled so deliberately… THE
STAGE-2 VM GATE REPLACES THIS with a genuine `capture-pane` of an RC-off session"*) to point at the
fixture that replaced it rather than describing a still-open gap. Re-run the file
(`./node_modules/.bin/vitest run test/ccd-rc-flag.test.ts` from `server/`) green against the real
bytes before committing.

**If the pane does NOT answer the key question the way the invented fixture assumed** — if the
permission-mode footer is missing, or the pane renders some other ready state entirely — do not
force the fixture to match the assumption. Capture what the pane actually shows, file it as the
finding (a new deviation entry in the Stage 2e plan's ledger, or a fresh issue if the plan has since
closed), and treat `_accept_first_run_prompts`'s marker set as needing a real fix, not a fixture
update. The invented fixture was always a stand-in for this measurement, never a substitute for it.

## On failure

Every doctor remedy printed anywhere in this run is meant to be followable as written — that is the
point of the A2-NEW work this gate is proving. If a step above does not converge:

- **Read the remedy line, not just the FAIL/WARN line above it.** `ccrc doctor`'s contract is verdict
  immediately followed by remedy — every FAIL and WARN in this codebase carries one, and none of them
  is "reinstall from scratch."
- **Re-running is safe.** `bash install.sh` and `ccrc install` both converge rather than damage an
  existing install; there is no state in this sequence that a repeat run corrupts.
- **A remedy that does not work is a bug in this repository, not a bug in your box.** File it with
  the exact FAIL/WARN line, the remedy text, and what you did in response — that gap is exactly what
  this document exists to surface while the workstream that shipped the remedy is still fresh.
- **A timeout at step 6** (the spawned session never reaches a ready state, `_accept_first_run_prompts`
  answers rc 4) is the single most consequential possible failure of this whole run — it is the "key
  question" above answered against you. Capture the pane anyway (`tmux capture-pane -p`), file it as
  described in "the deliverable beyond pass/fail," and treat it as a stop-ship finding for RC-off
  fresh installs, not a retry-until-it-passes situation.

## What this run does NOT prove

- **The fleet (agent) deploy lane.** `deploy/deploy.sh agent <host>` seeding the RC flag `on` *before*
  the ccd it gates lands is proven today only as source order (D-99's own words: "IN CODE AND
  SOURCE-ORDER ONLY... it becomes lifted in fact at the first `bash deploy/deploy.sh agent <host>`").
  This runbook is the single-box `install.sh` path; it says nothing about that separate real run.
- **Per-worker RC.** This slice is a per-box flag. The 2026-08-13 ruling (orchestrator task #37) that
  dispatched workers spawn without RC regardless of the box's setting is a *narrower* granularity a
  per-box flag cannot express — see the plan's ledger for why that stays open.
- **RC-on, on a fresh box.** Steps 5-9 describe the off path deliberately, because that is the path
  with no real capture yet. An RC-on run on the same box is worth doing too, but it is proving an
  already-measured path (the existing real captures in `server/test/fixtures/panes/` are all RC-on),
  not closing a gap.
