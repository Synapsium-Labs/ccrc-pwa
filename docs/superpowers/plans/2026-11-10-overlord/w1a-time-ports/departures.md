# W1a time ports: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-time-ports.md`'s "Deviations found" and the index plan. Each
departure is named by its plain-words slug: the coordinator has issued its number on the programme's ledger pull
request, which defines it, so this note does not repeat it. The plan file itself is left unedited, because the ledger
guard refuses an edit to it from a work branch.

## New departures

- **sql-clock-reads-argumentless-date-functions, tightening.** The plan pinned `SQL_CLOCK` ("Keep `SQL_CLOCK` exactly
  as above"). The whole-branch review measured on `node:sqlite` that `datetime()`, `date()`, `time()`, `julianday()`
  and `strftime('<format>')` with no time value all answer the current time, and the plan's pattern let every one of
  them through. `SQL_CLOCK` now also matches those functions called with no argument, and `strftime` with a format
  alone. Called with a time value (`datetime(at, 'unixepoch')`, `strftime('%s', at)`, `date(at)`), they still pass.
  Today's count in `server/src` stays zero, so D-8224's repo-wide scope holds. Fix round 1 added the sibling form:
  `'subsec'` or `'subsecond'` given as the only time value (`unixepoch('subsec')`, `datetime('subsec')`,
  `strftime('%s', 'subsec')`) also answers the current time, and `SQL_CLOCK` now matches it.
- **ambient-scan-sees-abort-timeouts-and-timer-modules, tightening.** `ambientUses` now also reports
  `AbortSignal.timeout(…)` (a timer, and the usual way to bound a `fetch`), and any value import of `node:timers` or
  `node:timers/promises`, by its specifier. A name list cannot catch the second: `scheduler.wait` from
  `node:timers/promises` shares its name with the `Scheduler` port. Fix round 1 widened it again: `process.hrtime`,
  `process.uptime`, `Math.random` and `AbortSignal.timeout` are now read off the syntax tree, with an optional
  `globalThis.` (or `globalThis?.`) before the global and `.` or `?.` before the member. A named or namespace value
  import of `node:process`, and a default import of it bound under any name but `process`, are reported by its
  specifier.
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
- `Deps.time` (D-8226): the tests' typecheck named 73 literals in 25 test files, and `testDeps` holds one more, so
  74 in all. The plan's estimate was about 95 in about 34. Every named literal was edited, and nothing else. (The
  first edition of this note and the Task 5 commit message said 75: one hand-placed site was counted twice.)
- `fakeTime`'s `below(n)` checks its bound before it draws (fix round 1), so a refused call consumes no draw and a
  recorded seed still replays after one.

## Deferred, from the whole-branch review (minor)

- A `warn` that throws inside `systemScheduler`'s catch arms would escape. The default `console.warn` does not throw.
- Only a native `Promise` return is caught. Another thenable, or a promise from another realm, would not be.
- `TIME_PORT_FAMILIES` matches only basenames that start with `overlord` or `continuity`, so a camelCase name such as
  `sessionContinuity.ts` joins only through `TIME_PORT_FILES`.
- Contrived gaps in the scanner: a copy of the global (`const p = process; p.hrtime()`), bracket access (`process["hrtime"]`, `Math['random']`), destructuring
  (`const { hrtime } = process`, `const { random } = Math`), `Intl.DateTimeFormat().format()` and `os.uptime()`.
- The SQL statement finder (`sqlStatementsInFile`) sees no `SELECT` without `FROM`, no `WITH` and no `PRAGMA`, so a
  clock read in one of those is invisible to "no statement in server/src" (review 1780, F4).
- The two pins' regexes miss other spellings: the two-clock shape matches only `interface X { … wall(): number …
  mono(): number }` in that order (not `type X = {…}`, `extends`, `wall: () => number`, or the reverse order), and
  the ceiling pin misses `2 ** 31 - 1` and `0x7fffffff` (review 1780, F6).
