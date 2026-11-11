# W1a time ports: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-time-ports.md`'s "Deviations found" and the index plan. The
coordinator issued and defined each departure's number on the programme's ledger pull request. This branch was cut
before that pull request merged, and the tree's D-reference guard reads its definitions from this branch's own plans,
so the note names each departure by its plain-words slug. The plan file itself is left unedited, because the ledger
guard refuses an edit to it from a work branch.

## New departures

- **sql-clock-reads-argumentless-date-functions, tightening.** The plan pinned `SQL_CLOCK` ("Keep `SQL_CLOCK` exactly
  as above"). The whole-branch review measured on `node:sqlite` that `datetime()`, `date()`, `time()`, `julianday()`
  and `strftime('<format>')` with no time value all answer the current time, and the plan's pattern let every one of
  them through. `SQL_CLOCK` now also matches those functions called with no argument, and `strftime` with a format
  alone. Called with a time value (`datetime(at, 'unixepoch')`, `strftime('%s', at)`, `date(at)`), they still pass.
  Today's count in `server/src` stays zero, so D-8224's repo-wide scope holds. The fix rounds added the sibling form:
  `'subsec'` or `'subsecond'` standing where the time value goes also answers the current time, with or without
  modifiers after it (`unixepoch('subsec')`, `datetime('subsec', 'localtime')`, `strftime('%s', 'subsec', 'utc')`,
  `unixepoch('subsec', ?)`), and `SQL_CLOCK` matches each. `unixepoch('+1 day', 'subsec')` answers NULL and passes.
- **ambient-scan-sees-abort-timeouts-and-timer-modules, tightening.** `ambientUses` now also reports
  `AbortSignal.timeout(…)` (a timer, and the usual way to bound a `fetch`), and any value import of `node:timers` or
  `node:timers/promises`, by its specifier. A name list cannot catch the second: `scheduler.wait` from
  `node:timers/promises` shares its name with the `Scheduler` port. The fix rounds widened it again: `process.hrtime`,
  `process.uptime`, `Math.random` and `AbortSignal.timeout` are read off the access expression's text, with the global
  reached through its own name, `globalThis` or `global`, inside parentheses or past a non-null `!`, and the member
  through `.` or `?.`. A named or namespace value import of `node:process`, and a default import of it bound under any
  name but `process`, are reported by its specifier. An aliased import of a helper that shares a member's name
  (`import { timeout as t } from './x.js'`) is not followed: a member name is ambient only as a global's member.
- **fake-refuses-re-entry, shape.** `fakeTime`'s `advance` and `restart` throw `RangeError` when a scheduled call
  calls them. Before this change, a firing call that re-entered them moved mono backwards, or counted a restart's
  wall gap twice, and nothing reported it. The simulator piece models a restart as a step it takes between calls,
  never as a call it schedules.

## Rulings within the plan

- `TIME_PORT_SCOPE` is the plan's pattern (`TIME_PORT_FAMILIES`) or one explicit list of single files
  (`TIME_PORT_FILES`), as the coordinator ruled for run 1776. The list is empty today, because the role table's files
  are not on `main` yet. A test also checks that every listed file exists.
- `ambientUses` treats `x instanceof Date` as not ambient, since it is a type test. It reports a later call through an
  aliased import of a global's own name (`import { setTimeout as wait }`) by that name.
- The spec's ring-context row for `time/**` landed as its own commit, after the role-table worker cleared that row.
- `Deps.time` (D-8226): the tests' typecheck named 73 literals in 25 test files, and `testDeps` holds one more, so
  74 in all. The plan's estimate was about 95 in about 34. Every named literal was edited, and nothing else. (The
  first edition of this note and the Task 5 commit message said 75: one hand-placed site was counted twice.)
- `fakeTime`'s `below(n)` checks its bound before it draws, so a refused call consumes no draw and a recorded seed
  still replays after one.

## Deferred, from the whole-branch review (minor)

- A `warn` that throws inside `systemScheduler`'s catch arms would escape. The default `console.warn` does not throw.
- Only a native `Promise` return is caught. Another thenable, or a promise from another realm, would not be.
- `TIME_PORT_FAMILIES` matches only basenames that start with `overlord` or `continuity`, so a camelCase name such as
  `sessionContinuity.ts` joins only through `TIME_PORT_FILES`.
- Gaps in the scanner. It misses:
  - a copy of the global (`const p = process; p.hrtime()`);
  - bracket access (`process["hrtime"]`, `Math['random']`);
  - destructuring (`const { hrtime } = process`, `const { random } = Math`);
  - a comment inside the access (`process /* c */ .hrtime()`);
  - `require('node:process')` and a dynamic `import('node:process')`;
  - `Intl.DateTimeFormat().format()` and `os.uptime()`;
  - a cast before the member, `(process as X).hrtime()`;
  - a global reached through another global, `global.globalThis.Math.random()`;
  - a non-literal SQL modifier after `'subsec'`, such as a column, `date('subsec', col)`.

  It also reports a `typeof` query in type position as ambient (`type T = typeof process.hrtime`).
- The SQL statement finder (`sqlStatementsInFile`) sees no `SELECT` without `FROM`, no `WITH` and no `PRAGMA`, so a
  clock read in one of those is invisible to "no statement in server/src".
- The two pins' regexes miss other spellings:
  - the two-clock shape matches only `interface X { … wall(): number … mono(): number }` in that order, not
    `type X = {…}`, `extends`, `wall: () => number` or the reverse order;
  - the ceiling pin misses `2 ** 31 - 1` and `0x7fffffff`.
