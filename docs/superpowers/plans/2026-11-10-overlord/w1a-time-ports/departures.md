# W1a time ports: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-time-ports.md`'s "Deviations found" and the index plan. Each
departure has a plain-words slug and no number; the coordinator issues the numbers. The plan file itself is left
unedited, because the ledger guard refuses an edit to it from a work branch.

## New departures

- **sql-clock-reads-argumentless-date-functions, tightening.** The plan pinned `SQL_CLOCK` ("Keep `SQL_CLOCK` exactly
  as above"). The whole-branch review measured on `node:sqlite` that `datetime()`, `date()`, `time()`, `julianday()`
  and `strftime('<format>')` with no time value all answer the current time, and the plan's pattern let every one of
  them through. `SQL_CLOCK` now also matches those functions called with no argument, and `strftime` with a format
  alone. Called with a time value (`datetime(at, 'unixepoch')`, `strftime('%s', at)`, `date(at)`), they still pass.
  Today's count in `server/src` stays zero, so D-8224's repo-wide scope holds.
- **ambient-scan-sees-abort-timeouts-and-timer-modules, tightening.** `ambientUses` now also reports
  `AbortSignal.timeout(…)` (a timer, and the usual way to bound a `fetch`), and any value import of `node:timers` or
  `node:timers/promises`, by its specifier. A name list cannot catch the second: `scheduler.wait` from
  `node:timers/promises` shares its name with the `Scheduler` port.
- **fake-refuses-re-entry, shape.** `fakeTime`'s `advance` and `restart` throw `RangeError` when a scheduled call
  calls them. Before this change, a firing call that re-entered them moved mono backwards, or counted a restart's
  wall gap twice, and nothing reported it. The simulator piece models a restart as a step it takes between calls,
  never as a call it schedules.

## Rulings within the plan

- `TIME_PORT_SCOPE` is the plan's pattern (`TIME_PORT_FAMILIES`) or one explicit list of single files
  (`TIME_PORT_FILES`), as the coordinator ruled for run 1776. The list is empty today, because the role table's files
  are not on `main` yet. A test also checks that every listed file exists.
- `ambientUses` treats `x instanceof Date` as not ambient, since it is a type test. It reports a later call through an
  aliased timer import by the name that import brings in.
- The spec's ring-context row for `time/**` landed as its own commit, after the role-table worker cleared that row.
- `Deps.time` (D-8226): the tests' typecheck named 75 literals in 25 files. The plan's estimate was about 95 in about
  34. Every named literal was edited, and nothing else.

## Deferred, from the whole-branch review (minor)

- A `warn` that throws inside `systemScheduler`'s catch arms would escape. The default `console.warn` does not throw.
- Only a native `Promise` return is caught. Another thenable, or a promise from another realm, would not be.
- `TIME_PORT_FAMILIES` matches only basenames that start with `overlord` or `continuity`, so a camelCase name such as
  `sessionContinuity.ts` joins only through `TIME_PORT_FILES`.
- `system.ts`'s header says its timer is "a deadline inside one adapter call". The handle outlives the call through
  its Cancel, so the honest reason it is L3 is that it is an adapter that decides nothing.
- Contrived gaps in the scanner: destructuring `hrtime` or `random`, `Math['random']`, `Intl.DateTimeFormat().format()`
  and `os.uptime()`.
