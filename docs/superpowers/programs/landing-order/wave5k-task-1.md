# Wave 5k, Task 1: the carries from wave 5j

Run 3914, programme `landing-order`, wave 30. Plan: `docs/superpowers/plans/2026-11-26-landing-order-wave5k-console.md`, Task 1.
Base: `origin/main` at `102c31f67a6cdd26ae64ba9d51428c6ab89395e9`.

## What changed

- `server/test/landing-subtractive.test.ts`: a case, `the table list is every landing table the schema creates`, compares
  `sqlite_master`'s tables named `landing_*` (indexes left out by `type = 'table'`) with `TABLES` (D-9110). Seven and seven
  on the base.
- `server/src/coord/landingWrites.ts`: the header's first two lines, as the plan gives them.
- `server/test/landing-doors-route.test.ts`: the comment above the spied-writer case, as the plan gives it.
- `server/test/landing-writes-act.test.ts`: a withdraw whose coordinator is `{ kind: 'run', runId: 7, … }` raises the event
  with `runId: 7` and `sessionId: ''`.
- `server/test/landing-writes.test.ts`: the time formatter's five boundary values, through `landingWithdrawNoticesOf`'s entry
  body, each compared with `new Date(at).toISOString()`.

Nothing the plan cites moved between its baseline and this base for these files.

## C6's exact text

The plan leaves C6's text to the builder. In `isoOf`, `+ Math.floor(doe / 36_524)` became `+ Math.floor(doe / 36_525)`. Measured
in a scratch copy of the function first: with it, `Date.UTC(2100, 2, 1)` prints as `2100-02-29` (the non-leap century gains
29 February), while `0`, the 2024 leap day, `2000-03-01` and the 2026 year end print unchanged.

## Mutation rows, measured

Each row: the file copied to the session's scratch directory and hashed, one replacement applied (the old text occurs once),
the named test run through `ccrc test`, the copy put back and its sha256 checked against the hash taken before.

### C1

- Mutation: in `server/test/landing-subtractive.test.ts`, `  'landing_intents',
] as const;` → `] as const;`
- `test/landing-subtractive.test.ts`: exit 1 (RED)
    - `× withdrawing A changes only its own state, detail and marker, its subject row and the cursor 428ms`
    - `× withdrawing B changes only its own state, detail and marker, its subject row and the cursor 259ms`
    - `× withdrawing C changes only its own state, detail and marker, its subject row and the cursor 224ms`
    - `× withdrawing D changes only its own state, detail and marker, its subject row and the cursor 223ms`
    - `× withdrawing E changes only its own state, detail and marker, its subject row and the cursor 234ms`
    - `× withdrawing F changes only its own state, detail and marker, its subject row and the cursor 210ms`
    - `× withdrawing A changes only its own state, detail and marker, its subject row and the cursor 262ms`
    - `× withdrawing B changes only its own state, detail and marker, its subject row and the cursor 219ms`
- Restored from the saved copy; sha256 after restore `f5197488af46255a275d13828ad72fc800f0866277975e25d9a2c2a91afe48c7` (matches the copy taken before)

### C2

- Mutation: in `server/src/coord/schema.ts`, `  CREATE INDEX landing_intents_by_key ON landing_intents(project, key);
` → `  CREATE INDEX landing_intents_by_key ON landing_intents(project, key);
  CREATE TABLE landing_mutant (id INTEGER);
`
- `test/landing-subtractive.test.ts`: exit 1 (RED)
    - `× the table list is every landing table the schema creates 197ms`
    - `Tests  1 failed | 24 passed (25)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-subtractive.test.ts > the table list (D-9110) > the table list is every landing table the schema creates`
    - `AssertionError: expected [ 'landing_authority', …(7) ] to deeply equal [ 'landing_authority', …(6) ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `6d83584cb972368a74bb49428c10c0a110bfc8317acce43136d127e6ca44b5a7` (matches the copy taken before)

### C3

- Mutation: in `server/src/coord/landingWrites.ts`, `(journal seq ${String(result.seq)})`, runId: null } };` → `(journal seq ${String(result.seq)})`, runId: 0 } };`
- `test/landing-writes-act.test.ts`: exit 1 (RED)
    - `× a pause: answers the pause shape and raises landing-paused; an unchanged pause raises nothing 25ms`
    - `Tests  1 failed | 5 passed (6)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-writes-act.test.ts > actLandingWrite (wave 5j-b) > a pause: answers the pause shape and raises landing-paused; an unchanged pause raises nothing`
    - `AssertionError: expected [ { …(2) } ] to deeply equal [ { mode: 'record-only', …(1) } ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2837e737ba5580a6072f057aa29d9b2321b19a76327e9793ee3ea731bc2a72e8` (matches the copy taken before)

### C4

- Mutation: in `server/src/coord/landingWrites.ts`, `return { due: true, event: { kind: 'coord', sessionId: '', title: `landing-withdrawn:` → `return { due: true, event: { kind: 'coord', sessionId: command.actor, title: `landing-withdrawn:`
- `test/landing-writes-act.test.ts`: exit 1 (RED)
    - `× a withdraw: answers the withdraw shape and raises landing-withdrawn 27ms`
    - `× a withdraw whose coordinator is a run raises the event with that run and no session (D-9110 carry) 2ms`
    - `Tests  2 failed | 4 passed (6)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-writes-act.test.ts > actLandingWrite (wave 5j-b) > a withdraw: answers the withdraw shape and raises landing-withdrawn`
    - `AssertionError: expected [ { …(2) } ] to deeply equal [ { mode: 'record-only', …(1) } ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2837e737ba5580a6072f057aa29d9b2321b19a76327e9793ee3ea731bc2a72e8` (matches the copy taken before)

### C5

- Mutation: in `server/src/coord/landingWrites.ts`, `runId: result.coordinator.kind === 'run' ? result.coordinator.runId : null } };` → `runId: null } };`
- `test/landing-writes-act.test.ts`: exit 1 (RED)
    - `× a withdraw whose coordinator is a run raises the event with that run and no session (D-9110 carry) 9ms`
    - `Tests  1 failed | 5 passed (6)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-writes-act.test.ts > actLandingWrite (wave 5j-b) > a withdraw whose coordinator is a run raises the event with that run and no session (D-9110 carry)`
    - `AssertionError: expected [ { …(2) } ] to deeply equal [ { mode: 'record-only', …(1) } ]`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2837e737ba5580a6072f057aa29d9b2321b19a76327e9793ee3ea731bc2a72e8` (matches the copy taken before)

### C6

- Mutation: in `server/src/coord/landingWrites.ts`, `+ Math.floor(doe / 36_524)` → `+ Math.floor(doe / 36_525)`
- `test/landing-writes.test.ts`: exit 1 (RED)
    - `× the entry notice writes 4107542400000 as its ISO instant 11ms`
    - `Tests  1 failed | 109 passed (110)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-writes.test.ts > landingWithdrawNoticesOf (wave 5j-b, D-9050) > the entry notice writes 4107542400000 as its ISO instant`
    - `AssertionError: expected 'The operator withdrew project-a #1 (e…' to contain 'at 2100-03-01T00:00:00.000Z,'`
    - `- Expected`
    - `+ Received`
- Restored from the saved copy; sha256 after restore `2837e737ba5580a6072f057aa29d9b2321b19a76327e9793ee3ea731bc2a72e8` (matches the copy taken before)

### C7

- Mutation: in `server/src/coord/landingWrites.ts`, `p(rem % 1000, 3)` → `p(rem % 1000, 2)`
- `test/landing-writes.test.ts`: exit 1 (RED)
    - `× the entry notice says what happened, that nothing chose a successor, the candidate drop and the retreat first 10ms`
    - `× the entry notice writes 0 as its ISO instant 3ms`
    - `× the entry notice writes 951868800000 as its ISO instant 1ms`
    - `× the entry notice writes 4107542400000 as its ISO instant 1ms`
    - `Tests  4 failed | 106 passed (110)`
    - `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯`
    - `FAIL  test/landing-writes.test.ts > landingWithdrawNoticesOf (wave 5j-b, D-9050) > the entry notice says what happened, that nothing chose a successor, the candidate drop and the retreat first`
    - `AssertionError: The operator withdrew project-a #1 (entry 101, state pinned, pinned at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) at 2026-11-25T14:30:05.007Z, journal seq 9.: expected 'The operator wit`
- Restored from the saved copy; sha256 after restore `2837e737ba5580a6072f057aa29d9b2321b19a76327e9793ee3ea731bc2a72e8` (matches the copy taken before)


C1 also reds the fifteen subtractive cases (their table snapshot no longer reads `landing_intents`), and its census case
reds with `expected [ 'landing_authority', …(6) ] to deeply equal [ 'landing_authority', …(5) ]` (re-run alone to read it).

## Runs, green after every restore

From `server/`, one file per process, through `ccrc test`: `landing-subtractive` (25), `landing-writes` (110),
`landing-writes-act` (6), `landing-doors-route` (15), `citations` (4), `anchors` (9).
