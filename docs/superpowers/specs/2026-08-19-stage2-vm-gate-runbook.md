# Stage 2 VM gate — the operator's fresh-install proof

**Scope note (2026-08-20):** steps 1–9 are the stage-2 install proof this document was written for.
**Step 10 arms the stage-3a session gate on the same box** — off by default, so a run that stops at
step 9 is complete on its own terms. Step 10's proof is `localhost`-scoped by design; read "What this
run does NOT prove" before deciding what it buys you.

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

### 10. Arm the session gate (stage 3a)

**Not part of the stage-2 timing above** — steps 1–9 are the install proof, and this step is the
stage-3a one bolted onto the same fresh box, because a gate is only meaningfully proven on a machine
that was built by the documented path. Everything below is off by default: a box that stops at step 9
is a box with no gate, which is the shipped state and a legitimate one.

Before you start, know what this step does and does not prove — see **"What this run does NOT prove"**
below. In short: it proves the MECHANISM on `localhost`. The passkey you enrol here will not work
against stage 3b's public name, and that is by design, not a defect.

#### 10a. Set the passphrase

```bash
ccrc passwd
```

It prompts twice with echo off (Ctrl-C aborts, and aborts cleanly — nothing is written and nothing is
echoed), requires at least 12 characters, and writes `~/.ccrc/auth.scrypt` at 0600. It refuses to run
outside a terminal, refuses without `node`, and refuses on a box with no server build — all three
BEFORE prompting, so you never type a passphrase into a command that was going to fail anyway.

Expect a result line naming the generation:

```
gen-auth-hash: wrote /home/<you>/.ccrc/auth.scrypt (0600, scrypt N=65536,r=8,p=1, generation 1 —
first passphrase on this box); read back and verified before installing
```

**"generation 1 — first passphrase on this box"** is the fresh-file case; a later run reads
`generation 2 — was generation 1`, and that bump is the whole logout mechanism. **"read back and
verified before installing"** is not decoration: the helper wrote a temp file, re-read it through the
server's own parser, and proved your passphrase against it, before renaming it into place. That is
what makes it impossible for this command to write a line the server will not boot on.

Three `ccrc:` lines follow it. Read all three — they are the same three facts this step is about.

```bash
ccrc doctor
```

Expect the `auth` line to PASS and to say the gate is still off:

```
PASS auth: /home/<you>/.ccrc/auth.scrypt holds a usable passphrase (N=65536,r=8,p=1,gen=1), but the
gate is OFF (CCRC_AUTH is not "on" in /home/<you>/.ccrc/ccrc.env), so no request is gated yet
```

**A passphrase on its own changes nothing.** Nothing is gated until step 10b.

#### 10b. Arm the flag — and set the other two keys IN THE SAME EDIT

> **`CCRC_RP_ID` and `CCRC_ORIGIN` must be set in the same change that arms `CCRC_AUTH`.**

This is the one step in this document that fails silently if you do half of it. With `CCRC_AUTH=on`
and the other two unset, the defaults are `rpId: localhost` and `origin: http://localhost:<CCRC_PORT>`
— and every non-exempt write and every `/ws/*` upgrade arriving from the origin you are actually
using is refused, giving a console that loads, reads, and cannot act. **There is no boot warning for
it.** The pair is internally coherent, so the boot check that catches a malformed or disagreeing pair
passes it; and a self-check that tried to catch it was investigated and judged not implementable —
behind `tailscale serve` the server cannot learn the hostname it is reached under, so every arm of
such a check has to fail shut on correctly-configured boxes too. The only signals are one journal
line per refused request and a `foreign-origin` failure on every write in the PWA.

On this VM, all three values in one edit of `~/.ccrc/ccrc.env`:

```
CCRC_AUTH=on
CCRC_RP_ID=localhost
CCRC_ORIGIN=http://localhost:7788
```

**`localhost`, not `127.0.0.1`, and it matters here.** Step 8's `curl` used the loopback IP, which
is fine for `curl`; for the browser half of this step you must reach the box at
`http://localhost:7788/`. WebAuthn will not scope a credential to an IP address. Both wrong turns
are now caught at boot, with passkeys 501 and the passphrase login still working:
`CCRC_ORIGIN=http://127.0.0.1:7788` with `CCRC_RP_ID=localhost` is a disagreeing pair, and
"fixing" it by setting `CCRC_RP_ID=127.0.0.1` is refused as an IP literal (D-134 — until this task
that second one was accepted by the server and rejected by every browser, with nothing in the
journal). Keep both on `localhost`.

If your `CCRC_PORT` is not 7788, `CCRC_ORIGIN` must carry the port you actually set — the default
origin is built from `CCRC_PORT`, but an explicit one is taken literally. No trailing slash, no path.

#### 10c. Restart

```bash
systemctl --user restart ccrc.service
systemctl --user status ccrc.service --no-pager
journalctl --user -u ccrc.service -n 40 --no-pager
```

The gate is read at boot, so nothing above takes effect until this runs. Confirm the unit is
`active (running)`, and read the journal tail for two lines that must NOT be there:

- `ccrc-server: WebAuthn config is refused — …` — the `rpId`/`origin` pair disagrees or is
  malformed. Passkeys are disabled (the ceremony routes answer 501); the passphrase door still works.
- `ccrc-server: CCRC_AUTH=on but no passphrase file at …` — you armed the flag without step 10a.
  Every route answers 401 and no login can succeed. `ccrc passwd` fixes it with no restart (the gate
  re-reads the file per request).
- `ccrc-server: CCRC_ORIGIN is plain http (…) and the session cookie is still marked Secure` — the
  cookie warning (D-133). **On this localhost VM you WILL see this one**, and it is the point of
  step 10d: see there for what to do. It is the only signal that failure has, which is why the
  server now emits it.

And one that means the unit did not start at all: `REFUSING TO BOOT — … exists and this process
cannot use it`. That is a present-but-unusable `auth.scrypt`; the remedy is in 10f. The message names
the file and the state and deliberately prints no byte of its contents.

Then measure the gate from outside the browser:

```bash
curl -s http://127.0.0.1:7788/health                 # still {"ok":true,...} — /health is EXEMPT
curl -s http://127.0.0.1:7788/api/auth/status        # {"authed":false,"passkeysEnrolled":0,"mode":"passphrase"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7788/api/fleet   # 401
```

`/health` staying open is deliberate — `deploy/deploy.sh`'s final gate reads the shipped sha out of
it from a shell with no cookie, so a gated `/health` would fail every deploy the moment the flag was
armed. `mode` flipping from `off` to `passphrase` is the single clearest confirmation that the flag
took; the 401 on `/api/fleet` is the gate itself. If `/api/auth/status` still reads `"mode":"off"`,
the unit did not pick up the edit — check the file path (`~/.ccrc/ccrc.env`, which
`ccrc.service` reads as `EnvironmentFile=-%h/.ccrc/ccrc.env`) and that the value is the exact string
`on`; `1`, `true`, `yes` and `ON` are all OFF, deliberately.

Re-run `ccrc doctor`. **Expect the `fleet` line to become a SKIP**, and expect that rather than
reading it as a fault:

```
SKIP fleet: the server at 127.0.0.1:7788 refused this check because its session gate is ARMED and
/api/fleet/health is behind it (see the 'auth' check) — nothing is wrong at either end, but the two
boxes cannot be compared from outside the gate, so build skew and roster divergence are NOT being
measured on this box; compare by hand with 'ccrc version' on each
```

That route is gated on purpose — it publishes roster digests, build stamps and divergence — and
`ccrc doctor` carries no session cookie, so an armed box refuses it and both parties are behaving
correctly. **The cost is real and is not cosmetic:** doctor stops reporting build skew and roster
divergence on an armed box, so its silence there is not evidence that the two boxes agree. On the
reference two-box fleet, compare `ccrc version` on each box by hand after a deploy. On this
single-box VM there is no second box, so nothing is lost. (This runs in local mode anyway; the SKIP
above is what you would see on a remote-mode box, and on this one the check may skip for the
local-mode reason instead.)

Then expect the `auth` line to have changed tense:

```
PASS auth: CCRC_AUTH=on in /home/<you>/.ccrc/ccrc.env, and /home/<you>/.ccrc/auth.scrypt holds a
usable passphrase (N=65536,r=8,p=1,gen=1) — logins are gated
```

#### 10d. Log in

Load `http://localhost:7788/` in a browser. Expect a full-screen login asking for the passphrase,
with the sentence *"Sign in to reach this box."* Enter the passphrase from step 10a. You should land
on the board from step 8.

**If the login POST succeeds and the login screen comes straight back**, the browser declined to
store the cookie because it is marked `Secure` and this VM is plain http — the boot warning in 10c
predicted exactly this. Add:

```
CCRC_COOKIE_INSECURE=on
```

…to the same `~/.ccrc/ccrc.env`, restart, and the warning goes with the symptom. **This is a
localhost-development opt-out and belongs nowhere else** — on any box reached over TLS, leaving it
set earns the mirror-image warning, because a `Secure`-less cookie there travels over any plain-http
request to the same host.

Sessions last 30 days absolute, 4 days idle.

#### 10e. Enrol a passkey (optional)

Navigate to `/accounts` in the PWA. The **Passkeys** section reads *"No passkey is enrolled on this
box — the passphrase is the only way in."* and offers **"Add a passkey on this device"** if this
browser can run the enrolment ceremony. Tap it, complete the platform prompt, and expect
*"Passkey added. It can sign you in from now on."*

Then, on the same screen, tap **Sign out** (under **This session**) and expect the login screen —
now offering **"Sign in with a passkey"** above the passphrase field. Complete the ceremony and
expect to land on the board without typing the passphrase. That round trip — enrol, sign out, sign
back in with the key — is the whole passkey proof.

**Sign out ends this browser's session only.** Other devices stay signed in and enrolled passkeys
are untouched; it is `revokeThis`, not `revokeAll`. To end every session at once, rotate the
passphrase (10f). And note what it does NOT do: signing out does not un-enrol the key you just
added, which is exactly why the lost-device procedure below starts with Revoke and not with this
button.

Enrolling requires being signed in already; that is the load-bearing exemption decision behind the
whole design, not an inconvenience. Revocation is in the same place: each enrolled key gets a
**Revoke** button.

#### 10f. Operator procedures worth rehearsing once, on this VM

These are the procedures a real incident needs, and the only cheap time to run them is on a box you
are about to destroy.

**Ending your own session.** Accounts → **This session** → **Sign out**. It revokes this session
server-side and returns you to the login screen; other devices are unaffected. (An empty cookie jar
— a private window, or clearing the cookie in devtools — gets you to the same screen without
revoking anything, which is the difference worth knowing on a shared machine.)

**Lost or stolen device.** `ccrc passwd` invalidates **sessions, not passkeys** — a rotation bumps the
generation, every logged-in browser is expired at once with no restart, and every enrolled
authenticator keeps working. That is deliberate (a passkey carries no generation stamp). So the order
is fixed:

1. **Revoke the passkey in the PWA** — Accounts → Passkeys → Revoke, on the row for that device.
2. **Then** `ccrc passwd`, to expire the sessions that device already holds.

Doing it the other way round logs the thief out and leaves them a working key. And do NOT reach for
`rm ~/.ccrc/passkeys.json` on a running server: the store is loaded once at boot and rewritten from
memory on the next accepted assertion, so the deleted row comes back. The PWA's Revoke button takes
effect in-process, immediately, with no restart.

**A corrupt or unreadable `auth.scrypt`.** With the flag armed the server REFUSES TO BOOT on it —
present-but-unusable is not "no passphrase", and starting on it would be the fail-open the flag
exists to prevent. The journal line names the file and the remedy but deliberately prints no byte of
the file's contents (it would quote the field it choked on, and the plausible way to get an unusable
`auth.scrypt` is a misplaced copy of some other secret). `ccrc doctor`'s `auth` check reports the same
state on a box that has NOT yet been armed — "a boot refusal waiting to happen". The remedy, from
either:

```bash
mv ~/.ccrc/auth.scrypt ~/.ccrc/auth.scrypt.broken && rm -f ~/.ccrc/sessions.json && ccrc passwd
```

All three parts are needed. `ccrc passwd` REFUSES to overwrite a file it cannot read — the generation
cannot be read out of it either, and writing a fresh one under an invented generation would
*revalidate* the very sessions the command exists to expire — so the `mv` comes first. And the fresh
file restarts at **generation 1**, which is the generation any session minted on this box's first
passphrase carries, so `~/.ccrc/sessions.json` has to go with it or a stale cookie from the box's
first life would revalidate. Losing that file costs nothing but logging in again; it is a flat file
precisely so it can be thrown away.

**Disarming.** Set `CCRC_AUTH=` (or remove the line) and restart. The passphrase file stays where it
is and nothing reads it; `ccrc doctor` goes back to reporting a usable passphrase behind an off gate.
That is the rollback for this whole step and it needs no other undo.

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
- **The gate at a real name, or behind real TLS.** Step 10's proof runs on **localhost**, and that is
  a deliberate scope, not a shortcut. What it proves is the MECHANISM: that the flag arms, that the
  passphrase door works, that a passkey can be enrolled and can then sign in, that revocation takes
  effect without a restart, that a rotation expires sessions and leaves keys alone. What it does NOT
  carry forward is the deployment. **A passkey enrolled here does not work at stage 3b's public
  name** — a credential records the `rpId` it was enrolled under, so the same authenticator against
  `<name>.duckdns.org` is refused with "enrolled for localhost — re-enrol". That is the designed
  behaviour (it is how a rename fails loudly instead of silently), and it means the enrolment step
  has to be repeated once on the real name. Likewise `Secure` behind a TLS-terminating proxy, and the
  `trustProxy` / `X-Forwarded-Proto` decision that goes with it, is stage 3b's work: this run either
  ships `Secure` over plain-http localhost or opts out of it, and neither is the production answer.
- **More than one operator.** The session layer carries a single identity — there are no users, no
  roles, and no per-person audit. That is the team-edition seam, held open deliberately; this slice
  ships one operator.
