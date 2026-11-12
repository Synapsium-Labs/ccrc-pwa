# Coord-DB migrations that merge in either order (design)

**Spec** · 2026-11-11 · D-8338 · Status: **approved by the operator 2026-11-12, option 2 in its smallest form** (§0).
Docs only: no code ships with it. The plan is `docs/superpowers/plans/2026-11-12-coord-db-commuting-migrations.md`.
Facts about the tree in §1 to §9 were read on `origin/main` `6c857a1ab`, where `server/src/coord/schema.ts` held 60
migrations; §0 says what changed since. Choices marked **Design call** are the author's. Choices marked **Operator
decision** were the operator's (§9, ruled in §0) · Refs #2668 · Related: `server/src/coord/schema.ts` and `server/src/coord/db.ts` (the migrations and the runner
this changes), `deploy/coordination-snapshot.mjs` (a reader of the schema version),
`server/src/coord/routes.ts` `POST /api/ledger/deviations` (the D-number allocator option 1 would reuse).

## In short

Every change to the coordination database (`coord.db`) is a numbered entry in one list, and the database records how
far along that list it has got as a single number. So two pull requests that each add a change both claim the next
number. Whichever merges second has to move its change to the following number and edit every test and comment that
names it. On 2026-11-11 five pull requests wanted the next number at once, and each merge sent the others back for
another rebase, another CI run and another trip through the merge queue.

This design compares three fixes: reserving numbers in advance through the ledger (§4), naming each new change instead
of numbering it (§5), and a script that renumbers a branch for you (§6). It recommends **naming** (§7): the 60
numbered changes stay as they are, each new change is its own file named for what it does, and the database records
which named changes it has applied. Two pull requests that each add a file never touch the same line, so they merge in
either order with nothing to renumber. Existing installs (at version 60) move over on their next start without any
step from the operator (§7.4).

## 0. The approval (2026-11-12)

The operator approved **option 2 in its smallest form** on 2026-11-12: each migration has a stable name and declared
dependencies, the applied set is stored by name, and the existing numbered positions stay as a frozen prefix. That rules
O1 (option 2) and, because the smallest form is §7.2 as written, O2 (one `.sql` file per new migration), O3 (the list
closes at whatever `main` holds) and O4 (`user_version` becomes a count) as §9 recommends. §4 and §6 stay below as the
record of what was weighed and why it lost.

**The frozen prefix is every numbered entry on `main` when the build starts, not 1 to 60.** `main` added entry 61 after
this design was measured (`nodes.reportedSweep`, D-8386, merged in #2699), so on 2026-11-12 the prefix is positions 1
to 61. A numbered entry that lands on `main` before the runner's pull request merges joins the prefix too: the length
is re-measured on `origin/main` before that pull request and before its merge, never chosen by hand. Below, read every
"60" that names the legacy length (§5, §7.2 items 1, 5 and 7, §7.4, §8 tests 1, 2 and 9) as *L*, the prefix's
length at that moment.

Writing the plan settled three details that §7.2 left open. Each keeps §7's behaviour and its tests:

1. **The frozen entries have names too.** Entry *k* of the prefix is `legacy-<k>` with three digits (`legacy-001` to
   `legacy-061`), and it is declared after `legacy-<k-1>`. Every named migration is after `legacy-<L>` without saying
   so. The applied set (`coord_migrations`) therefore names every migration a file holds. It is filled once from the
   current schema version: the first migration this build applies to a file writes `legacy-001` to `legacy-<v>` for
   the file's `user_version` *v*, in that migration's own transaction. Nothing is written when nothing is missing, and
   a fresh install whose first migration fails still leaves no file behind. *a* in §7.2 item 4 then counts every name,
   and the count rule of item 5 reads `user_version = |applied set|`, the same number as *L* plus the named ones.
2. **Up to the prefix's end the version is the authority.** While `user_version` is at or below *L*, the applied set
   is exactly `legacy-001` to `legacy-<v>`, whatever rows the table holds, and the backfill writes it so. No build
   writes such a file with any other rows (a row and its version commit together, and the version only goes up), so
   this only meets a test that rewinds a file by hand (`run-close-switch.test.ts`'s rewind to 53) or a fixture built
   without the runner. Both keep working unchanged.
3. **The apply order is topological with a fixed tiebreak.** The runner orders the missing migrations by their
   declared dependencies (Kahn's algorithm), choosing among the ready ones by name in byte order. The chain on the
   frozen entries makes them apply in position order, exactly as today's loop does. A dependency that names no
   migration, a cycle, a bad name or two migrations that share a name refuse to start before the file is touched.
4. **Above the prefix's end, trigger (b) of §7.2 item 4 reads "the version and the applied set disagree"**, in either
   direction. A version above the set's size is a newer build's file, as §7.2 says. A version below it is a file no
   build writes; it too is read as it is with the same warning and migrated no further, because rule 3 never refuses
   to read and a write over a file the runner cannot explain could only make it worse.

## 1. The problem, measured

### 1.1 How a migration works today

- `MIGRATIONS` in `server/src/coord/schema.ts` is one array of SQL strings. Entry *k* takes the database from
  `user_version k-1` to `k`. `COORD_SCHEMA_VERSION` is `MIGRATIONS.length` and nothing else.
- `openCoordDb` (`server/src/coord/db.ts`) reads `PRAGMA user_version` and runs
  `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, each entry in its own transaction together with the
  `PRAGMA user_version = v + 1` that records it. A database above the build's version is read as it is and migrated no
  further (rule 3: a rollback may refuse to migrate, never to read).
- **The frozen-entry rule.** Because the loop starts at the stored version, an edit to an entry a live database has
  already passed never runs there. Every entry from 4 on says so in prose, and the order is the only identity an entry
  has.
- **No reserved or no-op entries exist today.** Every one of the 60 entries does real work. The word "reserved" in
  `schema.ts` appears only for the `linear-sync` programme row that entry 59 inserts.
- 44 of the 60 entries (every one from 39 on, and most from 14 on) carry the same instruction: re-measure the slot
  before the PR and before merge with
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` (it must print *k-1*).

### 1.2 What a migration pull request touches

Measured on the last five migration PRs (#2606, #2638, #2644, #2661, #2665). Each one edited the first three spots
below, and #2661 and #2665 edited the fourth too:

| Spot | What names the slot |
|---|---|
| The end of `MIGRATIONS` in `schema.ts` | The new entry goes just before `];`, with its banner (`── 60: user_version 59 -> 60`), its "must print 59" line, and sometimes prose naming the slots that went first (entry 59: "slots 55 to 58 went first … so it is 59") |
| `server/test/coord-db.test.ts` | `expect(COORD_SCHEMA_VERSION).toBe(60)` twice, `expect(MIGRATIONS.length).toBe(60)`, and two comment lists naming every entry by index; the banner test (one banner per entry, numbered 1..N) |
| `server/test/run-close-switch.test.ts` | The test of entry 54 rewinds a fresh database to version 53 by dropping every later entry's tables and columns by hand, so each new entry adds its own `DROP` and the comment that lists them |
| Constants in the entry's own tests | `PLAN_SLOT = 59` in `plan-store.test.ts` ("the plan's own number was 57; slots 55 to 58 went first"). Most newer tests already find their slot by searching the DDL (`MIGRATIONS.findIndex(...) + 1`) |

Two pull requests that both add an entry both insert lines in the same place in each of these files, so git reports a
conflict. In the merge queue a conflict ejects the pull request; the fix is a rebase, a renumber, a fresh CI run and a
new place at the back of the queue.

### 1.3 The 2026-11-11 pile-up

| Change | Slot it wanted | Slot it got |
|---|---|---|
| `coordinator_calls` | 55 | 55 |
| `lane_arm_settings` | 56 | 56 |
| `testbox_events` | 57 | 57 |
| `practice_cases` (the Overlord) | 58 | 58 |
| The Linear plan model | 57 | 59 (renumbered twice: 57, 58, 59) |
| `claude_builds` | 58 | 60 |

The plan model was renumbered twice and `claude_builds` moved from 58 to 60. Every renumber meant another full CI run
and another queue entry for a change whose SQL had not moved.

### 1.4 Why the number cannot simply be agreed in advance

`user_version` is a high-water mark. A database at 62 will never run entry 61, whatever entry 61 later turns out to
hold. So any scheme in which a change's identity is its position works only if changes **land in position order**.
Two independent changes do not have an order, and the queue picks one at random. This is the fact that decides between
the options below.

## 2. Goal

Two pull requests that each add a coord-DB migration merge in either order, through the merge queue, with no
renumbering and no conflict, and every install (fresh, at version 60, or further behind) ends with both applied.

## 3. Constraints every option must keep

- **Rule 1 to rule 4 of `openCoordDb`** stay true: forward-only, each migration in its own transaction, refuse to start
  loudly rather than start empty, a newer database is read but not migrated, the markdown ledger stays the
  disaster-recovery record.
- **Additive only.** A migration adds tables, columns, indexes and seed rows. It never rebuilds or drops. This is what
  lets an older build read a newer database.
- **Nothing on a live install is renumbered.** The 60 entries every install has already run keep their numbers and
  bytes.
- **The snapshot keeper keeps working.** `deploy/coordination-snapshot.mjs` reads `user_version` straight from the file
  header and keeps one backup "from before a schema migration" (`uv < refUv`). Whatever replaces the counter must still
  move that number up when a migration is applied.
- **Code is machine-neutral and installer-reusable**: nothing names a box, a path outside the repo, or an account.

## 4. Option 1: reserve slots through the ledger

**What it is.** The D-number allocator (`POST /api/ledger/deviations`, `CoordStore.allocateDeviations`, the
`ledger_alloc` table keyed by project and number) gains a second kind, `migration-slot`, with its own counter. A pull
request reserves its slot when it starts and writes that number into its entry. If a reservation is abandoned, someone
fills its slot with a no-op entry (`SELECT 1;` with a banner saying so) so later slots still line up.

**What it costs.** Little code: a kind column or a second project key on the allocator, a `ccrc-api ledger allocate`
flag, and a no-op entry template.

**Why it does not reach the goal.**

- It removes renumbering only when pull requests merge **in reservation order** (§1.4). If slot 62 is ready first, it
  cannot land without something at 61. Landing a no-op at 61 burns that slot on every install that runs the build, so
  the real slot-61 change can never use it and has to move to a new slot anyway. Holding 62 until 61 lands turns
  independent changes into a queue.
- The textual conflicts in §1.2 stay. Both pull requests still add lines just before `];` and still edit the same
  count tests, so git still conflicts and the queue still ejects the second, even when the numbers agree.
- No-op entries pile up for good, and each one is itself a pull request that edits the same spots.
- The allocator is behind the box token. A contributor outside the fleet cannot reserve, and this is a public repo.

**Path for existing installs.** None needed: positions and `user_version` mean what they mean today.

## 5. Option 2: name each migration and record which names were applied

**What it is.**

- The 60 numbered entries become the **legacy prefix**. `MIGRATIONS` is closed: no entry 61 is ever added, and a test
  holds its length at the number `origin/main` has when this lands.
- Each new migration is **one file**: `server/src/coord/migrations/<name>.sql`. The name is its identity forever. A
  first comment line may declare what it must come after: `-- after: <name>, <name>`. Every named migration comes after
  the whole legacy prefix without saying so.
- A new table, `coord_migrations (name TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL, build TEXT)`, records which named
  migrations a database has applied.
- `openCoordDb` runs the legacy loop exactly as today while `user_version` is below the legacy length. It then reads the
  applied names and applies every named migration not yet applied, in dependency order with ties broken by name. Each
  is one transaction: its SQL, the `INSERT` into `coord_migrations`, and `PRAGMA user_version = <legacy length> +
  <number of applied names>`. A file whose version is above that sum, or whose applied set holds a name this build
  does not ship, came from a newer build and takes rule 3 (§7.2 item 4).

**Why it reaches the goal.** Two pull requests add two different files. Neither edits a line the other edits, so git
merges them in either order and the queue never sees a conflict. An install that already applied A applies B on its
next start, an install that applied B applies A, and a fresh install applies both. Nothing names a position, so there
is nothing to renumber.

**What it costs.**

- About sixty lines in `db.ts` (the loader and the second loop) and a small census test file.
- `tsc` does not copy `.sql` files, so the server build needs a copy step (`npm run build` becomes `tsc` plus a copy
  of `src/coord/migrations/` into `dist/`), and `deploy/build-release.sh` gains one check that the copied directory
  exists. Tests read the source directory directly.
- A named migration is plain SQL. It cannot interpolate a TypeScript constant the way entry 44 does with
  `TERMINAL_RUN_STATES`. One that needs such a value writes it literally, and its test checks the literal against the
  constant.
- Two installs can apply two independent migrations in different orders. If both add a column to the same table, the
  columns can end up in a different order on different installs. This is harmless because `SELECT *` is already banned
  in `server/src/coord` and every `INSERT` names its columns; it is written down here so that nobody relies on column
  order later.

**What it risks, and what catches it.**

| Risk | Caught by |
|---|---|
| B uses a table A creates but does not declare `-- after: A`; an install that runs B first refuses to start | The isolation test (§8, test 6) applies each migration on the legacy prefix plus only what it declares, so a missing `after` fails in the PR's own CI |
| A and B both add a column or table with the same name | Both files merge cleanly, but the merge group holds both and its "apply everything on a fresh database" test fails, so the queue stops it before `main` |
| Someone edits or deletes a migration that has already landed | A CI check refuses a modification or deletion under `server/src/coord/migrations/` against the merge base: only additions. This makes the frozen-entry rule a mechanism instead of a sentence |
| A release is built without the copy step | `build-release.sh` checks the directory; a build that still lost it would find applied names it does not know and take rule 3 (read, migrate nothing, warn), never apply a partial set |

**Path for existing installs.** §7.4.

## 6. Option 3: a rebase helper that renumbers for you

**What it is.** A script under `server/scripts/` that runs after a rebase conflict in `schema.ts`. It measures the
count on `origin/main`, moves the branch's entries after it, and rewrites everything that names their numbers: the
banners, the "must print" lines, the `toBe(60)` counts and comment lists, the `PLAN_SLOT`-style constants. The merge
queue's keeper could run it on ejection, so no person has to.

**What it costs.** A few hundred lines of pattern matching over prose and tests, and the patterns must follow every new
way a test names a slot.

**Why it does not reach the goal.**

- It makes renumbering automatic, not unnecessary. Every collision still costs an ejection, a rebase, a full CI run
  and a new queue entry; with *k* pull requests waiting, the last one goes round *k - 1* times. The CI time and queue
  churn measured in §1.3 stay.
- Some edits are not mechanical. The rewind test in `run-close-switch.test.ts` needs a `DROP` written for the new
  table, and prose like "slots 55 to 58 went first" needs a person to reword it.
- A wrong rewrite of an entry that has already landed is worse than the conflict it tried to avoid.

**Path for existing installs.** None needed.

## 7. Recommendation: option 2, in its smallest form

### 7.1 Why

Option 2 is the only one of the three that fixes the cause. Options 1 and 3 keep a change's identity as its position,
and §1.4 shows a position cannot be agreed between two changes that have no order. Option 2 gives each change an
identity of its own and records which ones a database holds, so order stops mattering except where a change declares
it.

### 7.2 The smallest change that meets the goal

1. **Close the legacy list.** `MIGRATIONS` stays exactly as it is. A test pins its length at the number on `main` when
   this lands (60 today). The banner test and the frozen-entry prose are unchanged.
2. **One file per new migration** in `server/src/coord/migrations/`. **Design call:** names are
   `<yyyy-mm-dd>-<kebab-words>`, the date being the day it was written, so the tie-break order is roughly the order they
   were written in and a name says when it came from. The file name is the name; the grammar is
   `^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$`.
3. **The applied set** `coord_migrations`. The runner creates it with `CREATE TABLE IF NOT EXISTS` inside the first
   named migration's transaction, so it needs no slot of its own.
4. **The second loop** in `openCoordDb`, after the legacy loop. Write *L* for the legacy length (60) and *a* for the
   number of names in `coord_migrations` (0 when the table does not exist yet).
   - **Rule 3 has two triggers**, and either one is enough. (a) `coord_migrations` holds a name this build does not
     ship. (b) `user_version` is above *L + a*: the version says more migrations ran than the applied set accounts
     for, whether every applied name is known or the table is missing altogether (a file at 67 with no
     `coord_migrations` is this case). Either way a newer build has been here: warn once with the same sentence as
     today's warning, read as it is, migrate nothing and write nothing. This check replaces today's
     `current > COORD_SCHEMA_VERSION`, and it runs before either loop.
   - Otherwise apply each missing migration in dependency order, ties by name, each in one transaction with its
     `coord_migrations` row and the new `user_version`.
   - **The version only goes up.** The runner writes `user_version` in exactly one place: inside a named migration's
     transaction, as *L + a* counted after that migration's row went in. It gets there only when trigger (b) did not
     fire, so the stored value was at most *L + a* before the migration and the write raises it by at least one. When
     nothing is missing it writes nothing. So no path writes the version downward, which is what §3 requires of rule 3.
   - On failure, refuse to start with `CoordDbUnmigratable`, naming the migration and the ones that already committed
     this start (the named form of `describeMigrationProgress`).
   - A malformed directory (a bad name, an `after` that names nothing, a cycle) also refuses to start. It is a build
     defect, and the tests below stop it before a release.
5. **`user_version` becomes a count.** **Design call:** after the legacy prefix it is `legacy length + applied
   names`. It no longer identifies a migration, but it still goes up by one per migration. That keeps the snapshot
   keeper's "before a schema migration" backup working unchanged, and it means a build from before this design (one
   that knows 60) opening a file at 61 or above takes today's rule 3: it warns, reads and migrates nothing.
   `COORD_SCHEMA_VERSION` keeps the meaning every test already gives it, "the version a file fully migrated by this
   build has": it becomes `LEGACY_MIGRATION_COUNT + NAMED_MIGRATIONS.length`, where `LEGACY_MIGRATION_COUNT` is
   `MIGRATIONS.length` (pinned at 60) and `NAMED_MIGRATIONS` is the directory's contents, loaded and exported by
   `schema.ts` so the runner and the tests read one list.
6. **The build copies the directory** into `dist/`, and `build-release.sh` checks the copy.
7. **Three test edits, once**, all in the pull request that adds the runner (line numbers as on `6c857a1ab`):
   - The count tests in `coord-db.test.ts` (`toBe(60)` at lines 718, 719 and 806) become "the legacy list is closed":
     `LEGACY_MIGRATION_COUNT` is 60, and `COORD_SCHEMA_VERSION` is `LEGACY_MIGRATION_COUNT + NAMED_MIGRATIONS.length`.
   - The rewind in `run-close-switch.test.ts` builds a version-53 database from `MIGRATIONS[0..52]` (the pattern the
     newer entry tests already use) instead of dropping later tables by hand.
   - The `buildAt` helper in `coord-db.test.ts` (line 938), which mocks `schema.js` with a cut `MIGRATIONS` to stand in
     for an older build, also sets `NAMED_MIGRATIONS: []`. Every build it imitates predates named migrations; without
     the edit, a build cut at entry 54 would run the named migrations over a partial legacy prefix.

   **Unchanged, and still valid:**
   - `PLAN_SLOT` stays: it names a legacy entry, which never moves again.
   - The eight rule-3 tests that fake a newer build by raising `user_version` alone: `coord-db.test.ts` lines 152
     (`COORD_SCHEMA_VERSION + 7`), 1620, 2377 and 2441 (`+ 3` each), `landing-line-migration.test.ts:104`,
     `landing-journal-migration.test.ts:114`, `collect-lane-migration.test.ts:107` and `ledgers-migration.test.ts:127`
     (`+ 1` each). Each one first opens the file with this build, so every shipped name is applied and *a* is the
     number shipped; it then sets the version to `COORD_SCHEMA_VERSION + k`, which is *L + a + k*. Trigger (b) of item
     4 fires: one warning with today's sentence ("this build knows …", "reading it as-is and migrating nothing"),
     nothing migrated, and the version left where the test put it, never written down. Without trigger (b) these
     tests would fail. With every applied name known, trigger (a) stays silent, so no warning comes. And on a file
     with no `coord_migrations` at *L + k* (what these tests build while no named migration has shipped yet), the
     runner would apply every named migration and write *L + n*, which is downward whenever *n* is below *k*.
   - The 45 assertions in 13 test files that a fresh or migrated open reaches `COORD_SCHEMA_VERSION`, because the
     constant now counts the named migrations too.
8. **The guard on landed files**: a CI step (beside the ledger guard) that refuses any status other than "added" for a
   path under `server/src/coord/migrations/` in the diff against the merge base.

No operator act is added. Migrations still run by themselves at start, and a failure still turns into a failed deploy
with the journal tail, as today, so no console control is needed.

### 7.3 What a migration pull request looks like afterwards

It adds `server/src/coord/migrations/2026-11-12-practice-reviews.sql` and its own test, which finds the migration by
name. It edits no shared count, banner, rewind list or constant. If it builds on an earlier named migration, it says
`-- after: 2026-11-09-practice-cases` on its first line.

### 7.4 Path for existing installs

| Install | What happens on its first start with this build |
|---|---|
| At version 60 (every live install today) | The legacy loop has nothing to do. `coord_migrations` does not exist, so nothing is applied. Every named migration runs, the table is created with the first one, and `user_version` ends at 60 plus their number |
| Behind (below 60) | The legacy loop runs to 60 exactly as today, then the named migrations run |
| Fresh | Legacy 1 to 60, then every named migration |
| Rolled back to a build from before this design | It sees a version above 60 and takes rule 3: reads, migrates nothing, warns. The new tables are unknown to it and ignored |
| Rolled back to an older build from after this design | The applied set holds names it does not ship, so rule 3 again (trigger a) |
| Version above what its applied set explains (above *L + a*, with or without `coord_migrations`) | Rule 3, trigger (b): warns, reads, migrates nothing, and leaves the version where it is |
| Restored from a snapshot | `VACUUM INTO` copies `coord_migrations` with everything else, so the applied set travels with the data it describes |

Pull requests open when this lands that still add a numbered entry 61 fail the "legacy list is closed" test on their
next CI run. The conversion is mechanical: move the SQL into a named file, drop the banner and the count edits.
**Operator decision O3** covers when the cut happens.

## 8. Tests that would prove it

In `server/test/`, failing first:

1. **Either order.** A fixture directory with two independent migrations A and B, passed to the runner. Database at
   legacy 60: apply {A}, reopen with {A, B}; separately apply {B}, reopen with {A, B}. Both end with the same applied
   set, the same `sqlite_master` (compared by name and normalised SQL), and `user_version` 62.
2. **Existing install.** A database built from `MIGRATIONS[0..59]` at `user_version 60`, with no `coord_migrations`,
   opens with this build: the table exists, every shipped name is in it, `user_version` is 60 plus their number, and
   every row written before the open is still there.
3. **Fresh and behind.** A new file, and one stopped at version 53, both end with the legacy prefix complete and every
   named migration applied.
4. **Rule 3, every trigger, and the version never goes down.** Each of these is read, warned about exactly once and
   not migrated, with the version and the applied set unchanged:
   - a file whose applied set holds a name this build does not ship (trigger a);
   - a file this build fully migrated, then raised to `COORD_SCHEMA_VERSION + 1` and `+ 7` (trigger b with every
     applied name known, the state the existing rule-3 tests build);
   - a file at *L + 7* with no `coord_migrations` table, opened by a build that ships two named migrations (trigger b
     with the table missing). This is the case that, without trigger (b), would apply both and write the version
     down to *L + 2*.

   And after any named migration `user_version` is above the legacy length, which is exactly the condition
   (`current > COORD_SCHEMA_VERSION` with 60) under which a pre-design build reads without migrating. Across tests 1, 2,
   3 and 5, every value the runner writes to `user_version` is above the one stored before it.
5. **Each migration in its own transaction.** A fixture migration that throws halfway leaves no table, no
   `coord_migrations` row and no version change; the refusal names it and the migrations that committed before it.
6. **Isolation (declared dependencies are enough).** For every shipped named migration: a database at legacy 60 plus
   only what it declares in `after` (and their own `after`, in order) applies it without error.
7. **Order does not matter where nothing is declared.** All shipped named migrations applied in dependency order with
   ties by name, and again with ties in reverse name order, give the same `sqlite_master`.
8. **The directory census.** Every file name matches the grammar, every `after` names a shipped migration, there is no
   cycle, and the directory holds only `.sql` files.
9. **The legacy list is closed.** `MIGRATIONS.length` is 60 (or the number fixed by O3), and the banner test is
   unchanged.
10. **No test names a position past the legacy list.** A census over `server/test/` refuses a `user_version` literal
    above the legacy length and a `MIGRATIONS[n]` index at or past it. The point of the design is that no shared line
    names a position, and this keeps it so.
11. **The guard on landed files.** Given a merge base and a head in a temporary repository, the CI step passes an added
    file and refuses a modified, renamed or deleted one.
12. **The build copy.** After `npm run build`, `dist/` holds the same set of migration files as `src/` (or
    `build-release.sh`'s check, exercised by its existing test).

The CI census and ratchet tests that read `server/src/coord` (the mail-routes word census among them) must stay green.
The runner's new refusal words go through a declared union with a guard, as every other word in that directory does.

## 9. Decisions for the operator

- **O1: which option.** Recommended: option 2 (§7). Option 1 is cheaper to build but does not make merge order
  irrelevant (§4). Option 3 automates the renumber but keeps every CI round and ejection (§6).
- **O2: one file per migration, or one list of named entries.** Recommended: one `.sql` file each, because two pull
  requests then never touch the same line. A single TypeScript list of `{ name, after, sql }` needs no build copy, but
  two pull requests would both append to its end, git would conflict, and the queue would eject one: renaming would be
  gone but not the ejection.
- **O3: when the legacy list closes.** Recommended: at whatever length `main` holds when this lands, with any open pull
  request holding a numbered entry converting on its next rebase. The alternative is to hold the runner until the open
  numbered pull requests have landed, which keeps them from rebasing once more but delays the fix by however long they
  take.
- **O4: what `user_version` means afterwards.** Recommended: a count (§7.2 item 5), so the snapshot keeper and
  rollbacks to a pre-design build keep working with no change. The alternative, freezing it at 60, would make a
  pre-design build silently miss that newer tables exist and would need the snapshot keeper to read the new table.

## 10. Decisions recorded

- D-8338 (allocated 2026-11-11; its ledger line is in the plan named in the header) — coord-DB migrations merge in
  either order: new migrations are named files with declared dependencies and an applied-set table, the numbered
  entries on `main` when the build starts stay as a closed, frozen prefix whose entries are named too, and
  `user_version` becomes a count that the runner only ever writes upward, with a version that disagrees with the
  applied set read as rule 3. The operator approved option 2 in its smallest form on 2026-11-12 (§0).
