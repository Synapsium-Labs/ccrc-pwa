# Final reaper safety report

Date: 2026-09-29

## Superseded historical validation

This report originally accepted a Linux `HOME` plus argv predicate before fixture
teardown signaled a persisted PID. That conclusion is superseded. An identity read
and a later `process.kill(pid)` are separated by a PID-reuse race, so even an exact
fixture-shaped process is not teardown authority. Earlier references to Darwin
fail-closed parsing or happy-path product stops do not make that numeric-PID
teardown safe.

The historical removal of the cross-run registry, ambient process sweep, recursive
cleanup, and Vitest `globalSetup` remains valid. This correction goes further: no
fixture cleanup derives signal authority from any persisted numeric PID on any
platform.

## Current safety contract

`server/test/laneReaper.ts` is observation-only: `psArgs` supports assertions and
has no signal helper. `killLaneProcesses(home)` has only current-run authority:

1. it takes and clears registered callbacks, then invokes every callback
   best-effort while roster, lane, and fake-manager state still exist; a callback
   can request a named current-run manager stop through the real fixture product
   stop path;
2. it then terminates directly held current-run `ChildProcess` handles. A
   reparented fake LiteLLM tier is owned through a directly held Python supervisor;
   that supervisor retains its direct child, terminates it, waits/reaps it, and
   exits.

Every fake-manager unit has a separate Python supervisor. Fake `systemd-run` writes
the unit's `starting` state, observed PID zero and `spawned` marker before it
backgrounds that supervisor; from then on only the supervisor writes the unit's state
and PID, so a descheduled launcher cannot overwrite them. The supervisor holds exactly
one direct `subprocess.Popen` tier. It writes `active` and the tier's PID as soon as
the tier exists, before any wait, and writes `inactive`, PID zero and completion only
after its exact wait on that child returns. Once a unit is marked spawned, it remains
manager-owned even while that supervisor is starting: `systemctl` validates the named
unit directory, creates its stop request and waits for its completion; it never
reclassifies that path as a seeded unit. Fake `systemctl` carries no signal vocabulary
at all: no `kill` in any spelling, no `pkill`, `killall` or `os.kill`, and no `/proc`
read, which a structural test pins over both its source constant and its planted bytes.

The supervisor's control of its child never depends on evidence files. Every event,
state, PID and completion write is best-effort, so a deleted unit directory or fixture
HOME cannot stop it signalling or reaping that child. Four conditions take one stop
path: a stop request; a vanished unit directory, which is what `afterAll` deleting a
fixture HOME under a still-running unit looks like; a TERM, HUP or INT delivered to the
supervisor; and its expiry, a finite 120-second default (above the normal 90-second
readiness bound; focused cases can shorten it) that works with the HOME gone. On that
path it sends TERM, waits six seconds, records TIMEOUT and sends KILL only after
`TimeoutExpired`, then performs the final exact wait unconditionally. Where the
evidence can still be written, responsive children record `TERM`, `WAIT:-15` and
TERM-resistant children record `TERM`, `TIMEOUT`, `KILL`, `WAIT:-9`; `WAIT:<status>`
is written only after the exact wait returns. After completion the supervisor lingers
for three seconds and reaps nothing more, so a skipped final wait would leave a zombie
that the TERM-resistant manager test observes. An ordinary passing run therefore
leaves no fixture process behind.

A seeded `fakeUnit` has no supervisor/control channel and becomes inactive without
signalling its observed PID. Persisted systemd, unit, fake-process, lane PID,
request, completion, and event files are observations or local control protocol
data only; none grants signal authority outside the Python supervisor's held exact
child. Callback failure cannot replace an earlier test failure, prevent later
callbacks, or stop direct-handle teardown. Later registration with the same
fixture HOME and stable key replaces the callback, making explicit cleanup followed
by `afterEach` idempotent.

The accepted cost is deliberate and narrow. A fake-manager supervisor that is itself
SIGKILLed, or that dies in an interrupted run, can orphan its child. A SIGKILLed or
otherwise interrupted Vitest run can also leave a directly spawned fixture child, or a
reparented stand-in's supervisor and tier, none of which carries an expiry. Each such
process is cleaned up by hand. A later run never gains authority to scan, recover, or
signal it. There is no ambient or cross-run authority.

## Evidence

The final implementation is in `server/test/codexLaneFixture.ts`. Focused manager
ownership, self-expiry, vanished-unit-directory stop, expiry with the fixture HOME
removed, TERM to a directly held supervisor, launcher write order, signal-vocabulary
and report-integrity checks are in `server/test/ccrc-codex.test.ts`; the current-run
direct-supervisor protocol remains covered there as well. The vanished-directory,
HOME-removed, supervisor-TERM and launcher-order cases each use a tier that also exits
on its own, and observe its recorded PID only through `ps`. This report records the
safety contract these tracked tests exercise. The correction changes fixture code,
tests and documents only; it starts, stops or reconfigures no live service or unit.
