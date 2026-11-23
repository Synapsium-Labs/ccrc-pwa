# An early reset on an account with no session, and on a session that waits: plan

A follow-up to `2026-11-22-limit-row-early-reset.md` (D-8942), which let a ccd session whose reading changed lower
its account's limit row after the provider reset the account early. That plan's "Known limits" named two cases it
did not cure. This plan closes the part of each that the code can close today, and says what stays open.

There is no spec: the rules are stated here and in the comments of the three files they touch.

## Gap 1: an account with no session on it

### What was measured

- An account's row has one writer, `ccd/statusline-command.sh`, and it only runs when something renders on the
  account. An account at the ceiling is the one every session has left, so nothing renders there.
- `ccd/ccd-telemetry-keepalive` is the only other reader. Its timer runs a pass every 15 minutes over every
  measured account (`CCRC_MEASURED`). It has no gate on the row's figure, so it does probe an account at the
  ceiling. Its gates are: no wrapper, a dead credential, a session on the account, a row younger than
  `CCRC_KEEPALIVE_FRESH` (30 minutes), the attempt throttle (the same 30 minutes) and the failure backoff (up
  to one attempt a day).
- Its turn has no ccd id and no history, so the writer dropped its lower reading as older (D-8942, rule 4).

### The rule (D-8943)

1. The keepalive exports `CCRC_KEEPALIVE_PROBE`, the second the turn starts, in the turn's own subshell.
2. The writer takes that as the proof of change for a reading the row calls older, and publishes it with the
   marks of D-8942, when all of these hold: the render has no ccd id; the value is a number of 9 to 12 digits;
   it is not ahead of the writer's clock and not more than 600 seconds behind it.
3. Nothing else changes: a render before the first API response carries no figure and writes nothing, the two
   arms that protect a live 5h figure are not relaxed, and the keepalive's gates, cadence, backoff, lock and
   credential handling are untouched.

Why the turn's reading is new: the process was started for this turn and made one API call, so the figures it
renders are that call's. A long-lived session's snapshot can be days old; this one cannot.

Why a session cannot set the marker by accident: it is exported only inside `_ka_turn`'s subshell, which execs
the account's wrapper, and no session is a child of the keepalive. If the variable did reach a session's
environment, the writer ignores it for any render with a ccd id, and ten minutes after its value for every
render.

Cost: none added. The keepalive takes the turns it took before, at the cadence it had. A probe of an account
that is still exhausted publishes the same or a higher figure, or fails and counts toward the backoff.

No keys: the turn is `claude -p` with stdin closed, in a process of its own. It has no pane, and nothing here
reads or types into one.

### What stays open

- **The keepalive measures nothing on a fleet today.** A `-p` turn renders no statusline (recorded in
  `docs/superpowers/specs/2026-10-21-auto-swap-reliability-design.md` §2.7), and the source that would give it
  one (that spec's §3.7, D-6185) waits on an operator measurement. Re-measured on a fleet on 2026-11-22: the
  last ten passes held no `refreshed` outcome. So this rule is the half that the writer and the keepalive owe:
  once a keepalive turn's figures reach the writer, by a render or by D-6185's pipe, a lower one lands. Until
  then an account with no session on it still waits for its old window's end. D-6185's pipe must run the writer
  with the same marker.
- **An account whose only sessions are blocked ones.** The keepalive refuses a turn on an account a session sits
  on, and a session waiting at a limit makes no API call, so its own reading never changes. Relaxing that
  refusal is the same spec's §3.7 occupancy question, which is the operator's. When every account is exhausted
  and every session waits on its own, an early reset of all of them is seen by nobody.
- **The backoff.** An exhausted account whose probes fail is asked once a day after about nine failures, so an
  early reset can go unseen for up to a day even with a source.

## Gap 2: a session told to wait until the reset

### What was measured

`_watchdog_resume_here` (`ccd/ccd`) restarts a waiting session in place when `now >= reset`, the date the
record was opened with, and the account has measured room. After an early reset the row shows room days before
that date, and the session kept waiting.

The date gate is there for a reason the code states: a row that reads low while the session is blocked is a
stale low reading, or a limit the two windows do not show, and a restart on it lands on the limit again.

### The rule (D-8944)

1. The writer stamps `resetSeen` on the row: the second of the publish that lowered it. It rides along with the
   marks of D-8942 on later publishes and is dropped with them.
2. Before its date, a wait ends when the row of the session's own account carries a `resetSeen` that is later
   than the start of the limit episode and not ahead of now. The start is `.limitsign`'s `since`, or the wait
   record's `since` when that is the earlier one or the only one.
3. From there the restart is the dated one: both windows measured under the ceiling, no move under way, a clean
   turn boundary, the per-pass cap, the same transient unit. It sends no key.
4. A wait with no date (`reset=-`) is not ended by a reading. It stays the operator's, as before.

Why `resetSeen` and not the row's `ts` or the marks: `ts` is newer after any publish, including one that only
repeats a low figure, which is the stale low reading. The marks say the row was lowered once, not when, and they
ride along for the rest of the window, so a session blocked later in that window by a limit the row does not
show would be restarted into it on every pass. A lowering after the block began is the one fact that says the
limit the session met was lifted.

Why the episode's start and not the record's: the record opens five minutes or more after the block, and only
when no other account has room. A reset inside those minutes is after the block and before the record.

An absent, unreadable or unstamped row decides nothing: the wait goes on to its date.

### `_limit_dated`

It answers whether the session's newest transcript row is a limit row, which stays true after an early reset:
the session has stopped. Its date feeds two things. The limit wait's date is the gap closed here. The rescue
waits (`near`, `chain`) are five-hour ones and end within minutes of their reset, and a no-room rescue wait ends
the moment another account has room. So nothing there waits days, and it is left as it is.

### What stays open

- A reset inside the first minute of a block, before the watchdog's first pass saw the sign, is dated before
  the episode and does not end the wait.
- A wait on a banner or menu sign that opens after the row was already lowered records no date (`reset=-`), by
  the stale-low-reading rule, and stays the operator's.
- A lowering needs a ccd session with a changed reading on the account, or a keepalive probe. With neither
  (see Gap 1), the wait ends at its date as before.

## Tasks

1. Tests first: `statusline-script.test.ts` (the probe marker's five cases, `resetSeen`'s three),
   `telemetry-keepalive.test.ts` (the keepalive through the real writer), `ccd-limit-watchdog.test.ts` (the
   early end of a wait, and each thing that must not end it).
2. `ccd/statusline-command.sh`: the marker arm and `resetSeen`. `ccd/ccd-telemetry-keepalive`: the export.
   `ccd/ccd`: the arm in `_watchdog_resume_here`.
3. Remove each new condition in turn and read the red tests.

## Deviations found

- **D-8943 (2026-11-22)** — keepalive-probe-lowers-row. The keepalive marks its turn as a new reading, and the
  account row's writer lets that reading lower a row with no session on the account.
- **D-8944 (2026-11-22)** — limit-wait-ends-on-measured-room. A limit wait ends before its date when the
  account's row was lowered by a new reading after the block began; the row dates that lowering.
